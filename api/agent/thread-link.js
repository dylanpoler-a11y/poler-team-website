// api/agent/thread-link.js — returns the token-gated URL of Claudia's live
// WhatsApp conversation page (Railway /thread/<digits>?t=…) for one lead.
// Called by the CRM lead panel's "Hilo Claudia" button (Kevin 2026-07-20) so
// the same link that arrives in every #claudia-whatsapp Slack ping is one
// click away while he's on calls. The view token is DERIVED server-side
// (HMAC of TWILIO_AUTH_TOKEN, mirroring twilio-whatsapp.js threadToken()) —
// it never ships in the public crm.js.
import { authorize } from '../_auth.js';

export const config = { runtime: 'edge' };

const ENGINE_HOST = process.env.SAMMY_ENGINE_HOST || 'sammy-engine-production.up.railway.app';

const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            // CORS: the CRM runs on www.homesinsoflorida.com but its fetches go to
            // CRM_API_BASE (poler-team-website-two.vercel.app) — cross-origin, so a
            // JSON POST triggers a preflight. Without these the browser reports
            // "Failed to fetch". Mirrors queue-props.js / send-map-props.js.
            'Access-Control-Allow-Origin': '*',
        },
    });

// Must produce EXACTLY twilio-whatsapp.js threadToken():
// createHmac('sha256', TWILIO_AUTH_TOKEN).update('sammy-thread-view').digest('hex').slice(0,24)
// Site env holds the ENGINE account's TWILIO_AUTH_TOKEN (fixed 2026-07-17), so
// the HMAC matches. Edge runtime → Web Crypto, not Node crypto.
async function threadToken() {
    const secret = process.env.TWILIO_AUTH_TOKEN || 'x';
    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('sammy-thread-view'));
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

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
    let body = {};
    try { body = await req.json(); } catch { /* empty body ok */ }

    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);

    const leadId = String(body.leadId || '').trim();
    if (!/^rec\w{10,}$/.test(leadId)) return json({ error: 'Valid leadId required' }, 400);

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);

    const leadRes = await fetch(`https://api.airtable.com/v0/${baseId}/Leads/${leadId}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!leadRes.ok) return json({ error: 'Lead not found' }, 404);
    const lead = await leadRes.json();
    const digits = String(lead.fields?.['Phone'] || '').replace(/\D/g, '');
    if (!digits || digits.length < 7) return json({ error: 'Lead has no phone' }, 400);

    const t = await threadToken();
    return json({ ok: true, url: `https://${ENGINE_HOST}/thread/${digits}?t=${t}` });
}
