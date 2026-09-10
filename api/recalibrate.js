/**
 * /api/recalibrate.js — Vercel Edge Function (deliberately PUBLIC — called by the
 * /listing recalibration popup; the caller is identified by their own Alert
 * Token / email, and the endpoint can only touch that one lead's alert fields).
 *
 * The 2nd popup on /listing (Kevin 2026-09-10, consensus + debate in
 * ~/business/real-estate/active/research/listing-ux-consensus/): a captured
 * lead who shows intent (2nd listing view, a favorite, 3 filter changes, or 5
 * min active) gets ONE tap question — "What's stopping you from booking a
 * showing?" — and the answer is ROUTED, not stored:
 *
 *   price      → lower Alert Price Max to 85% (rounded to $5k) + queue a fresh
 *                Sammy property send at the new ceiling (engine /admin/queue-props)
 *   area       → Alert Needs Review = true + Slack ping (needs a human to re-scope)
 *   financing  → Slack ping + email Kevin (no-SSN / foreign-national financing = hot)
 *   talk       → Slack ping + email Kevin with the phone + WhatsApp link (hottest)
 *   browsing   → note only
 *
 * Every answer: one 'Lead Activity' row (Activity Type "Recalibration") + one
 * CRM note via /api/agent/log-note in the crm-note-format shape.
 *
 * Body: { token?, email?, answer, mls?, page?, lang? }   (token OR email required)
 * Returns: { ok, routed: [...] } — never leaks lead data back to the browser.
 *
 * Required Vercel env vars: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AGENT_API_TOKEN
 * (SAMMY_ENGINE_TOKEN preferred for the engine call), SLACK_WEBHOOK_URL,
 * RESEND_API_KEY (+ optional ALERT_FROM_EMAIL).
 */
import { getOwnerSlackWebhook, sendSlackPing } from '../lib/slack.js';
import { profilesFromLead } from '../lib/alert-search.js';

export const config = { runtime: 'edge' };

const ANSWERS = {
    price:     { label: 'Price too high',            crm: 'Precio muy alto' },
    area:      { label: 'Wrong area',                crm: 'Zona equivocada' },
    financing: { label: 'Needs no-SSN financing',    crm: 'Necesita financiamiento sin SSN' },
    browsing:  { label: 'Just browsing',             crm: 'Solo mirando' },
    talk:      { label: 'Wants to talk to a person', crm: 'Quiere hablar con una persona' },
};
const TOKEN_RE = /^[A-Za-z0-9_-]{10,80}$/;
const MLS_RE   = /^[A-Za-z0-9_-]{3,40}$/;
const ENGINE_BASE = process.env.SAMMY_ENGINE_BASE || 'https://sammy-engine-production.up.railway.app';
const KEVIN_EMAIL = 'kevinpolermiami@gmail.com';

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        });
    }
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);

    let body = {};
    try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

    // 1. Validate inputs first
    const answer = String(body.answer || '').trim().toLowerCase();
    if (!ANSWERS[answer]) return json({ error: 'bad answer' }, 400);
    const token = String(body.token || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    if (token && !TOKEN_RE.test(token)) return json({ error: 'bad token' }, 400);
    if (email && (email.length > 254 || !/^[^\s@'"\\]+@[^\s@'"\\]+\.[^\s@'"\\]+$/.test(email))) {
        return json({ error: 'bad email' }, 400);
    }
    if (!token && !email) return json({ error: 'token or email required' }, 400);
    const mls  = MLS_RE.test(String(body.mls || '')) ? String(body.mls) : '';
    const page = String(body.page || '').slice(0, 300);
    const lang = ['en', 'es', 'pt'].includes(body.lang) ? body.lang : 'en';

    // 2. Identify the lead (token first — it is unique; email as fallback)
    const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    const formula = token ? `{Alert Token}='${token}'` : `LOWER({Email})='${email}'`;
    const lead = await findLead(baseId, headers, formula);
    if (!lead) return json({ ok: false, error: 'lead not found' }, 404);
    const f = lead.fields || {};
    const leadId = lead.id;
    const leadEmail = f['Email'] || email;
    const name = f['Name'] || [f['First Name'], f['Last Name']].filter(Boolean).join(' ') || leadEmail;
    const phone = f['Phone'] || '';
    const routed = [];
    const now = new Date().toISOString();
    const agentToken = (process.env.SAMMY_ENGINE_TOKEN || (process.env.AGENT_API_TOKEN || '').split(',')[0]).trim();
    const origin = new URL(req.url).origin;

    // 3. Lead Activity row (same table + field names as /api/log-activity)
    await fetch(`https://api.airtable.com/v0/${baseId}/Lead%20Activity`, {
        method: 'POST', headers,
        body: JSON.stringify({ records: [{ fields: {
            'Lead Email':    leadEmail,
            'Activity Type': 'Recalibration',
            'Details':       JSON.stringify({ answer, label: ANSWERS[answer].label, mls, page, lang }),
            'Timestamp':     now,
        } }], typecast: true }),
    }).catch(() => {});

    // 4. Route by answer
    const leadPatch = {};
    let next = '';
    if (answer === 'price') {
        // The engine prefers the Alert Profiles wrapper over the flat column
        // (2026-08-10 learning), so read the ceiling wrapper-first and write it
        // through /api/agent/update-alerts, which keeps both in sync.
        const prof = profilesFromLead({ profiles: f['Alert Profiles'], priceMax: f['Alert Price Max'] })[0] || {};
        const cur = Number(prof.priceMax) || Number(f['Alert Price Max']) || 0;
        if (cur > 0 && agentToken) {
            const lowered = Math.max(50000, Math.floor((cur * 0.85) / 5000) * 5000);
            const ok = await fetch(`${origin}/api/agent/update-alerts`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${agentToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ leadId, profile: { priceMax: lowered } }),
            }).then(r => r.ok).catch(() => false);
            if (ok) {
                next = `Tope de alertas bajado a $${lowered.toLocaleString('en-US')} (antes $${cur.toLocaleString('en-US')}); Sammy envía 3 propiedades al nuevo tope.`;
                routed.push('alert_price_max');
            } else {
                leadPatch['Alert Needs Review'] = true;
                next = `Quiso bajar el tope ($${cur.toLocaleString('en-US')}) pero la actualización falló — bajar manualmente.`;
                routed.push('alert_needs_review');
            }
        } else {
            leadPatch['Alert Needs Review'] = true;
            next = 'Sin tope de precio en alertas — revisar criterio y bajar precio manualmente.';
            routed.push('alert_needs_review');
        }
    } else if (answer === 'area') {
        leadPatch['Alert Needs Review'] = true;
        next = 'Preguntar por WhatsApp qué zona busca y ajustar Alert Cities.';
        routed.push('alert_needs_review');
    } else if (answer === 'financing') {
        next = 'Kevin: llamar hoy — explicar opción sin SSN / foreign-national lender.';
    } else if (answer === 'talk') {
        next = 'Kevin: contactar AHORA por WhatsApp/llamada.';
    } else {
        next = 'Seguir drip de Sammy; sin acción inmediata.';
    }

    if (Object.keys(leadPatch).length) {
        const r = await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
            method: 'PATCH', headers,
            body: JSON.stringify({ records: [{ id: leadId, fields: leadPatch }] }),
        }).catch(() => null);
        if (!r || !r.ok) routed.push('lead_patch_failed');
    }

    // 5. CRM note (crm-note-format: Convo / Next, no header — log-note stamps it)
    const ctx = mls ? ` (viendo MLS ${mls})` : '';
    const note = `Convo:\n• Popup del sitio${ctx}: "${ANSWERS[answer].crm}".\nNext:\n• ${next}`;
    if (agentToken) {
        await fetch(`${origin}/api/agent/log-note`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${agentToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ leadId, note, agent: 'Site popup' }),
        }).then(r => { if (r.ok) routed.push('note'); }).catch(() => {});
    }

    // 6. Sammy re-send at the new ceiling (price only, and only if the patch landed)
    if (answer === 'price' && routed.includes('alert_price_max')) {
        await fetch(`${ENGINE_BASE}/admin/queue-props`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${agentToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ leadId }),
        }).then(r => { if (r.ok) routed.push('sammy_queued'); }).catch(() => {});
    }

    // 7. Kevin pings — Slack for everything actionable, email for the two hot ones
    const hot = answer === 'talk' || answer === 'financing';
    if (answer !== 'browsing') {
        const crmLink = `https://www.homesinsoflorida.com/crm?lead=${leadId}`;
        const wa = phone ? ` · WhatsApp: https://wa.me/${String(phone).replace(/\D/g, '')}` : '';
        const text = `${hot ? ':rotating_light: HOT — ' : ':compass: '}*${name}* tapped *"${ANSWERS[answer].label}"* on /listing${ctx}.\n` +
            `Next: ${next}\n<${crmLink}|Open in CRM>${wa}`;
        const outcome = await sendSlackPing({ webhookUrl: getOwnerSlackWebhook('kevin'), text });
        if (outcome === 'ok') routed.push('slack');
    }
    if (hot) {
        const resendKey = process.env.RESEND_API_KEY;
        const fromEmail = process.env.ALERT_FROM_EMAIL || 'alerts@homesinsoflorida.com';
        if (resendKey) {
            const subj = `HOT lead: ${name} — ${ANSWERS[answer].label}`;
            const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1a2744;line-height:1.5">
<p><strong>${escHtml(name)}</strong> tapped <strong>"${ANSWERS[answer].label}"</strong> on the listing page${escHtml(ctx)}.</p>
<p>${escHtml(leadEmail)}${phone ? ' · ' + escHtml(phone) : ''}</p>
<p><strong>Next:</strong> ${escHtml(next)}</p>
<p><a href="https://www.homesinsoflorida.com/crm?lead=${leadId}">Open in CRM</a>${phone ? ` · <a href="https://wa.me/${String(phone).replace(/\D/g, '')}">WhatsApp</a>` : ''}</p>
</div>`;
            await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ from: `The Poler Team <${fromEmail}>`, to: [KEVIN_EMAIL], subject: subj, html }),
            }).then(r => { if (r.ok) routed.push('email'); }).catch(() => {});
        }
    }

    return json({ ok: true, routed });
}

async function findLead(baseId, headers, formula) {
    const fields = ['Email', 'Name', 'First Name', 'Last Name', 'Phone', 'Alert Price Max', 'Alert Profiles', 'Alert Token'];
    const url = `https://api.airtable.com/v0/${baseId}/Leads?maxRecords=1` +
        `&filterByFormula=${encodeURIComponent(formula)}` +
        fields.map(x => `&fields%5B%5D=${encodeURIComponent(x)}`).join('');
    try {
        const r = await fetch(url, { headers });
        if (!r.ok) return null;
        return (await r.json()).records?.[0] || null;
    } catch { return null; }
}

function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
    });
}
