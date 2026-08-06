/**
 * /api/agent/send-map-props.js — Vercel Edge Function
 *
 * Sends a HAND-PICKED set of properties — selected by Kevin directly on the
 * lead-panel property-alerts MAP (crm.js selectedMapProps) — to one lead via
 * Email and/or WhatsApp. Unlike send-alerts.js / send-test-alert.js, this does
 * NOT run a profile search: it fetches EXACTLY the listings Kevin selected, in
 * the order he selected them.
 *
 * POST body: { leadId, mlsIds: string[], channels: { email?, whatsapp? }, password?, agentName? }
 * Auth: authorize() — Bearer AGENT_API_TOKEN or body.password === CRM_PASSWORD
 *
 * Email reuses buildAlertEmail exported from send-test-alert.js (same card
 * layout/login-link logic as every other alert email) with a "hand-picked"
 * subject line. WhatsApp reuses sendWhatsappAlert exported from send-alerts.js
 * — but that function packs its OWN listings into Twilio's 5/3/1-slot PROPS
 * templates internally, so a raw N=2 or N=4 selection would silently drop the
 * extra listing. Packing is handled OUTSIDE it here (see sendWhatsappPacked):
 *   N ∈ {1,3,5} → one call (sendWhatsappAlert's own slot math matches exactly)
 *   N = 2       → two PROPS1 calls (one listing each)
 *   N = 4       → one PROPS3 call (first 3) + one PROPS1 call (the 4th)
 *
 * After ANY successful channel: logs an 'Alert Sent' Lead Activity row (same
 * shape send-alerts.js's logActivity/getSentListingIds expect) so the weekly
 * alert engine excludes these hand-picked listings from future auto-sends,
 * then a short CRM note via /api/agent/log-note per the crm-note-format skill.
 *
 * Do NOT modify send-alerts.js (per project instruction — already fixed/live).
 * buildAlertEmail was exported from send-test-alert.js with a minimal `export`
 * keyword addition (no logic changed) so both callers share one email builder.
 *
 * Required env vars:
 *   AIRTABLE_API_KEY, AIRTABLE_BASE_ID, BRIDGE_API_TOKEN, SITE_BASE_URL
 *   RESEND_API_KEY, ALERT_FROM_EMAIL                         (email channel)
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM,
 *   TWILIO_WA_TPL_PROPS1/3/5[_EN], SAMMY_ENGINE_TOKEN         (whatsapp channel,
 *                                                               via send-alerts.js)
 */

export const config = { runtime: 'edge' };

import { authorize } from '../_auth.js';
import { buildAlertEmail } from '../send-test-alert.js';
import { sendWhatsappAlert } from '../send-alerts.js';

const MAX_LISTINGS = 5;

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            },
        });
    }
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const apiKey      = process.env.AIRTABLE_API_KEY;
    const baseId      = process.env.AIRTABLE_BASE_ID;
    const bridgeToken = process.env.BRIDGE_API_TOKEN;
    const resendKey   = process.env.RESEND_API_KEY;
    const fromEmail   = process.env.ALERT_FROM_EMAIL || 'alerts@homesinsoflorida.com';
    const siteBase    = process.env.SITE_BASE_URL || 'https://www.homesinsoflorida.com';

    if (!apiKey || !baseId || !bridgeToken) {
        return json({ error: 'Missing required environment variables' }, 500);
    }

    let body;
    try { body = await req.json(); } catch { return json({ error: 'Invalid request body' }, 400); }

    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);

    const { leadId, mlsIds, channels, agentName } = body;

    if (typeof leadId !== 'string' || !/^rec\w{10,}$/.test(leadId)) {
        return json({ error: 'Valid leadId required' }, 400);
    }
    // MLS ids are strict alphanumerics — the regex blocks comma injection into
    // Bridge's ListingId.in (a crafted "A123,B999" would fetch+send an unselected
    // listing). Cold QA 2026-07-17.
    const ids = (Array.isArray(mlsIds)
        ? Array.from(new Set(mlsIds.map(id => String(id || '').trim()).filter(Boolean)))
        : []
    ).filter(id => /^[A-Za-z0-9_-]+$/.test(id));
    if (ids.length === 0 || ids.length > MAX_LISTINGS) {
        return json({ error: `mlsIds must have 1–${MAX_LISTINGS} entries` }, 400);
    }
    const wantEmail    = !!(channels && channels.email);
    const wantWhatsapp = !!(channels && channels.whatsapp);
    if (!wantEmail && !wantWhatsapp) {
        return json({ error: 'At least one channel (email or whatsapp) is required' }, 400);
    }

    // ── Fetch lead (same shape as send-test-alert.js) ─────────────────────────
    const leadRes = await fetch(`https://api.airtable.com/v0/${baseId}/Leads/${leadId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!leadRes.ok) return json({ error: 'Lead not found' }, 404);
    const leadData = await leadRes.json();
    const f = leadData.fields;

    const lead = {
        id:        leadData.id,
        name:      f['Name'] || [f['First Name'], f['Last Name']].filter(Boolean).join(' ') || 'there',
        firstName: f['First Name'] || f['Name']?.split(' ')[0] || 'there',
        email:     (f['Email'] || '').replace(/[^\x20-\x7E]/g, '').trim(),
        phone:     f['Phone'] || '',
        language:  f['Preferred Language'] || 'en',
        token:     f['Alert Token'] || '',
        password:  f['Access Password'] || '',
    };

    if (wantEmail && !lead.email && !wantWhatsapp) {
        return json({ error: 'Email channel selected but this lead has no email address.' }, 400);
    }
    if (wantWhatsapp && !lead.phone && !wantEmail) {
        return json({ error: 'WhatsApp channel selected but this lead has no phone number.' }, 400);
    }

    // ── Fetch EXACTLY these listings from Bridge, preserve Kevin's order ──────
    const FIELDS = [
        'ListingId', 'ListingKey', 'ListPrice', 'UnparsedAddress', 'City',
        'StateOrProvince', 'BedroomsTotal', 'BathroomsTotalInteger', 'LivingArea',
        'LotSizeSquareFeet', 'PropertySubType', 'YearBuilt', 'Media',
    ].join(',');
    const bridgeParams = new URLSearchParams({
        access_token: bridgeToken,
        'ListingId.in': ids.join(','),
        fields: FIELDS,
        limit: String(Math.max(ids.length, 5)),
    });

    let rawListings = [];
    try {
        const bRes = await fetch(`https://api.bridgedataoutput.com/api/v2/miamire/listings?${bridgeParams}`);
        const bData = await bRes.json();
        if (bData && bData.success !== false && Array.isArray(bData.bundle)) rawListings = bData.bundle;
    } catch (_) { /* rawListings stays [] — handled by the empty check below */ }

    const byId = new Map(rawListings.map(l => [String(l.ListingId), l]));
    const ordered = ids.map(id => byId.get(String(id))).filter(Boolean);

    if (ordered.length === 0) {
        return json({ error: "None of the selected listings could be found on Bridge (may be off-market)." }, 404);
    }

    // ── EMAIL ───────────────────────────────────────────────────────────────
    const channelOutcome = {};

    if (wantEmail) {
        if (!lead.email) {
            channelOutcome.email = { status: 'skipped', reason: 'no email address' };
        } else if (!resendKey) {
            channelOutcome.email = { status: 'error', reason: 'Resend not configured' };
        } else {
            if (!lead.password) {
                lead.password = generateFallbackPassword(lead.firstName, lead.phone);
                try {
                    await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
                        method: 'PATCH',
                        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ records: [{ id: leadData.id, fields: { 'Access Password': lead.password } }] }),
                    });
                } catch (_) { /* non-fatal */ }
            }

            try {
                const html = buildAlertEmail(lead, ordered, siteBase);
                const subject = getMapPropsSubject(lead.language);
                const emailRes = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ from: `The Poler Team <${fromEmail}>`, to: [lead.email], subject, html }),
                });
                if (emailRes.ok) {
                    channelOutcome.email = { status: 'sent', to: lead.email };
                } else {
                    channelOutcome.email = { status: 'error', reason: (await emailRes.text()).slice(0, 250) };
                }
            } catch (e) {
                channelOutcome.email = { status: 'error', reason: e.message };
            }
        }
    }

    // ── WHATSAPP (packed outside sendWhatsappAlert — see file header) ─────────
    if (wantWhatsapp) {
        if (!lead.phone) {
            channelOutcome.whatsapp = { status: 'skipped', reason: 'no phone' };
        } else {
            try {
                channelOutcome.whatsapp = await sendWhatsappPacked({ lead, listings: ordered, siteBase });
            } catch (waErr) {
                channelOutcome.whatsapp = { status: 'error', reason: waErr.message };
            }
        }
    }

    const emailOk    = channelOutcome.email?.status === 'sent';
    const waStatus   = channelOutcome.whatsapp?.status;
    const whatsappOk = waStatus === 'sent' || waStatus === 'partial';
    const anySent = emailOk || whatsappOk;

    if (!anySent) {
        return json({ ok: false, error: 'No channel delivered.', channels: channelOutcome }, 502);
    }

    // ── Log 'Alert Sent' activity — dedupe memory for the weekly engine ───────
    await logMapSendActivity(baseId, apiKey, {
        leadId: lead.id,
        email: lead.email,
        activityType: 'Alert Sent',
        details: {
            ids: ordered.map(l => l.ListingId),
            count: ordered.length,
            date: new Date().toISOString().slice(0, 10),
            source: 'crm-map',
        },
    });

    // ── Log a short CRM note (crm-note-format skill: headerless Convo/Next) ──
    const sentChannels = [];
    if (emailOk) sentChannels.push('email');
    if (whatsappOk) sentChannels.push('WhatsApp');
    const channelLabel = sentChannels.join(' y ');
    const n = ordered.length;
    const note = `Convo:\n• Le envié ${n} propiedad${n === 1 ? '' : 'es'} elegida${n === 1 ? '' : 's'} a mano desde el mapa (${channelLabel}).\nNext:\n• Esperar respuesta.`;
    await logMapPropsNote({ siteBase, leadId: lead.id, note, agentName });

    return json({ ok: true, channels: channelOutcome, listingsSent: ordered.map(l => l.ListingId) });
}

// ── WHATSAPP PACKING ─────────────────────────────────────────────────────────
// sendWhatsappAlert picks its OWN slot count (5/3/1) from listings.length, which
// is exactly right for N=1/3/5 but would DROP the extra listing for N=2 or N=4
// (it slices to the nearest slot below). Split those two cases into multiple
// template sends instead so nothing selected is ever silently dropped.
async function sendWhatsappPacked({ lead, listings, siteBase }) {
    const n = listings.length;
    let batches;
    if (n === 2)      batches = [listings.slice(0, 1), listings.slice(1, 2)];
    else if (n === 4) batches = [listings.slice(0, 3), listings.slice(3, 4)];
    else              batches = [listings]; // n === 1, 3, or 5

    const sends = [];
    for (const batch of batches) {
        try {
            sends.push(await sendWhatsappAlert({ lead, listings: batch, siteBase }));
        } catch (e) {
            sends.push({ status: 'error', reason: e.message });
        }
    }

    const allSent = sends.length > 0 && sends.every(s => s.status === 'sent');
    const anySent = sends.some(s => s.status === 'sent');
    return {
        status: allSent ? 'sent' : (anySent ? 'partial' : (sends[0]?.status || 'error')),
        sends,
        count: n,
    };
}

// ── CRM NOTE (best-effort, never blocks the response) ────────────────────────
// Calls the shared /api/agent/log-note endpoint (same Bearer pattern
// sendWhatsappAlert already uses for share-property — SAMMY_ENGINE_TOKEN first,
// AGENT_API_TOKEN's first member as fallback) so the auto-stamp + note format
// stay centralized in one place.
async function logMapPropsNote({ siteBase, leadId, note, agentName }) {
    try {
        const agentToken = (process.env.SAMMY_ENGINE_TOKEN || (process.env.AGENT_API_TOKEN || '').split(',')[0]).trim();
        if (!agentToken) return;
        await fetch(`${siteBase}/api/agent/log-note`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${agentToken}` },
            body: JSON.stringify({ leadId, note, agent: `${agentName || 'Kevin'} (mapa)` }),
        });
    } catch (_) { /* non-fatal */ }
}

// ── ACTIVITY LOG (best-effort, never throws) — mirrors send-alerts.js's ──────
// private logActivity so getSentListingIds (also in send-alerts.js) sees these
// hand-picked sends the same way it sees weekly-cron sends.
async function logMapSendActivity(baseId, apiKey, { leadId, email, activityType, details }) {
    try {
        const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
        // NO 'Lead Record ID' — the Lead Activity table has no such field; including
        // it 422s the whole write silently (the 2026-08-06 no-repeat-memory outage).
        const fields = {
            'Lead Email':    email || '',
            'Activity Type': activityType,
            'Details':       typeof details === 'string' ? details : JSON.stringify(details),
            'Timestamp':     new Date().toISOString(),
        };
        const res = await fetch(`https://api.airtable.com/v0/${baseId}/Lead Activity`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ records: [{ fields }] }),
        });
        if (!res.ok) console.error(`logMapSendActivity failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
    } catch (err) { console.error(`logMapSendActivity error: ${err.message}`); }
}

function generateFallbackPassword(firstName, phone) {
    const safeName = (firstName || 'User').toString();
    const namePrefix = safeName.substring(0, 3).charAt(0).toUpperCase() + safeName.substring(1, 3).toLowerCase();
    const phoneSuffix = (phone || '').toString().replace(/\D/g, '').slice(-4) || '0000';
    const randDigits = String(Math.floor(Math.random() * 90) + 10);
    return namePrefix + phoneSuffix + randDigits;
}

function getMapPropsSubject(lang) {
    const l = String(lang || 'en').toLowerCase();
    if (l.startsWith('en')) return 'Properties picked for you';
    if (l.startsWith('pt')) return 'Propriedades selecionadas para você';
    return 'Propiedades seleccionadas para ti';
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
    });
}
