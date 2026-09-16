// api/agent/derive-profile.js — build (or refresh) a lead's alert profile from what
// they viewed, saved and searched on the site. Called by the WhatsApp monitor
// (Railway) right before a lead's first property drip, and by the backfill tool.
//
// Body: { leadId, dryRun?: bool, backfill?: bool }
//   dryRun   → compute and return, write nothing
//   backfill → stamp autoBackfill:true on the profile (the drip's no-backfill gate
//              honors that flag for leads created before DRIP_ACTIVATED_AT)
// Never overwrites a human-set or lead-confirmed profile (returns ok:false, reason).
import { authorize } from '../_auth.js';
import { fetchListingsByMls } from '../../lib/bridge-listing.js';
import { parseAlertProfiles } from '../../lib/alert-search.js';
import { computeAlertFields } from '../../lib/alert-profile-fields.js';
import { deriveAutoProfile, parseSearchParams, describeProfile, sameCriteria } from '../../lib/derive-profile.js';

export const config = { runtime: 'edge' };

const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

const SEARCH_WINDOW_DAYS = 30;

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        } });
    }
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    let body = {};
    try { body = await req.json(); } catch { /* empty body ok */ }
    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);

    const leadId = String(body.leadId || '');
    if (!/^rec[A-Za-z0-9]{14}$/.test(leadId)) return json({ error: 'leadId required' }, 400);
    const dryRun = body.dryRun === true;
    const backfill = body.backfill === true;

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const bridgeToken = process.env.BRIDGE_API_TOKEN;
    if (!apiKey || !baseId || !bridgeToken) return json({ error: 'Not configured' }, 500);
    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    // 1. The lead
    const r = await fetch(`https://api.airtable.com/v0/${baseId}/Leads/${leadId}`, { headers });
    if (!r.ok) return json({ error: 'Lead not found' }, 404);
    const f = (await r.json()).fields || {};

    // 2. Never overwrite a human-set or confirmed profile
    const parsed = parseAlertProfiles(f['Alert Profiles'] || '');
    const p1 = parsed.profiles[0] || null;
    const hasFlat = Boolean(String(f['Alert Cities'] || '').trim() || Number(f['Alert Price Max']) > 0
        || Number(f['Alert Price Min']) > 0 || Number(f['Alert Beds Min']) > 0
        || (Array.isArray(f['Alert Property Types']) && f['Alert Property Types'].length));
    const isAutoUnconfirmed = p1 && p1.auto === true && p1.autoConfirmed !== true;
    if (p1 && !isAutoUnconfirmed) return json({ ok: false, reason: p1.autoConfirmed ? 'confirmed_profile' : 'human_profile' });
    if (!p1 && hasFlat) return json({ ok: false, reason: 'human_profile' });

    // 3. Signals: views, favorites, searches (last 30d), signup listing
    let viewedIds = [];
    try {
        const arr = JSON.parse(f['Properties Viewed'] || '[]');
        if (Array.isArray(arr)) viewedIds = arr.map(v => (typeof v === 'string' ? v : (v && (v.mlsId || v.mls)) || '')).filter(Boolean);
    } catch { /* none */ }
    let favoriteIds = [];
    try { const arr = JSON.parse(f['Saved Properties'] || '[]'); if (Array.isArray(arr)) favoriteIds = arr.filter(Boolean).map(String); } catch { /* none */ }
    const sourceMls = (String(f['Source URL'] || '').match(/[?&]mls=([A-Za-z0-9_-]{4,20})/) || [])[1] || null;

    let searches = [];
    const email = String(f['Email'] || '').trim();
    if (email && /^[^\s@'"\\]+@[^\s@'"\\]+\.[^\s@'"\\]+$/.test(email)) {
        try {
            const since = new Date(Date.now() - SEARCH_WINDOW_DAYS * 86400000).toISOString();
            const formula = `AND({Lead Email}="${email}", {Activity Type}="Search", IS_AFTER({Timestamp}, "${since}"))`;
            const params = new URLSearchParams({
                filterByFormula: formula,
                'sort[0][field]': 'Timestamp', 'sort[0][direction]': 'desc',
                pageSize: '30',
            });
            const ar = await fetch(`https://api.airtable.com/v0/${baseId}/Lead%20Activity?${params}`, { headers });
            if (ar.ok) {
                const data = await ar.json();
                searches = (data.records || []).map(rec => parseSearchParams(rec.fields['Details'])).filter(Boolean);
            }
        } catch { /* searches are optional */ }
    }

    // 4. Listing facts from Bridge (favorites first so they survive the cap)
    const wanted = [...new Set([...favoriteIds, ...viewedIds, sourceMls].filter(Boolean))].slice(0, 20);
    let listings = new Map();
    try { listings = await fetchListingsByMls(bridgeToken, wanted); }
    catch (e) { return json({ ok: false, reason: 'bridge_failed', detail: e.message }, 502); }

    const derived = deriveAutoProfile({ viewedIds, favoriteIds, searches, sourceMls, listings, timeline: f['Timeline'] || '' });
    if (!derived) return json({ ok: false, reason: 'no_signal', summary: { viewed: viewedIds.length, favorites: favoriteIds.length, searches: searches.length, sourceMls } });

    const unchanged = isAutoUnconfirmed && sameCriteria(p1, derived.profile);
    const description = describeProfile(derived.profile, 'es');
    const result = {
        ok: true, basis: derived.basis, profile: derived.profile, sources: derived.sources,
        summary: derived.summary, description, unchanged, written: false, dryRun,
    };
    if (dryRun || unchanged) return json(result);

    // 5. Write through the shared field logic (flat columns + wrapper + auto metadata)
    const nowIso = new Date().toISOString();
    const autoMeta = {
        auto: true, autoBasis: derived.basis, autoSources: derived.sources,
        autoConfirmed: false, autoUpdatedAt: nowIso,
    };
    if (backfill || (p1 && p1.autoBackfill === true)) autoMeta.autoBackfill = true;
    const fields = computeAlertFields({ ...derived.profile, autoMeta }, f);
    const wr = await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ records: [{ id: leadId, fields }], typecast: true }),
    });
    if (!wr.ok) {
        const err = await wr.json().catch(() => ({}));
        return json({ ok: false, reason: 'airtable_write_failed', detail: err.error?.message || wr.status }, 500);
    }
    result.written = true;

    // 6. CRM note (crm-note-format: Convo/Next bullets; log-note stamps the header)
    const origin = new URL(req.url).origin;
    const agentToken = process.env.SAMMY_ENGINE_TOKEN || (process.env.AGENT_API_TOKEN || '').split(',')[0].trim();
    const s = derived.summary;
    const what = derived.basis === 'browsing'
        ? `lo que vio en la web (${s.viewed} propiedades vistas, ${s.favorites} guardadas, ${s.searches} búsquedas)`
        : 'la propiedad del anuncio con la que se registró (no buscó nada más)';
    const note = `Convo:\n• Perfil de alertas ${p1 ? 'actualizado' : 'generado'} automáticamente según ${what}: ${description}.\nNext:\n• Claudia pregunta en el próximo envío si son el tipo de propiedades que busca; si contesta con otros criterios, el perfil se reemplaza.`;
    if (agentToken) {
        try {
            await fetch(`${origin}/api/agent/log-note`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${agentToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ leadId, note, agent: 'Sitio web (perfil automático)' }),
            });
            result.noted = true;
        } catch { result.noted = false; }
    }
    return json(result);
}
