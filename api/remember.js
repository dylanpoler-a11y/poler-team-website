/**
 * /api/remember.js — Vercel Edge Function (deliberately PUBLIC — no agent auth;
 * it only ever sets a cookie for a token/email that already exists in Airtable).
 *
 * Fixes the "site keeps asking me to sign up" problem (Kevin 2026-09-10): the
 * lead gate remembered visitors via localStorage only, which Safari ITP purges
 * after 7 days, in-app webviews (IG/FB/WhatsApp) never share, and the welcome
 * email's bare /listing link never restored. A SERVER-set first-party cookie
 * survives all three, so listing.js calls this after every capture / ?t= visit
 * and reads the cookie on boot.
 *
 * Three modes (one POST body each):
 *   { token }            → validate the Alert Token exists → Set-Cookie poler_lt
 *   { email }            → "Already registered?" lookup → Set-Cookie poler_lt
 *                           (returns { ok } only — never the token, so the email
 *                           form can't be used to enumerate tokens)
 *   { team: true, password } → CRM login (authorize()) → Set-Cookie poler_team
 *                           so Kevin / Rosa / Dylan never see the gate on that device
 *
 * Cookies: 1 year, Path=/, Secure, SameSite=Lax, Domain=.homesinsoflorida.com
 * when served from the live domain (apex + www share it), host-only otherwise.
 * Not HttpOnly on purpose — listing.js reads poler_lt synchronously at boot so
 * there is no popup flash while waiting on a round-trip.
 *
 * Required Vercel env vars: AIRTABLE_API_KEY, AIRTABLE_BASE_ID
 */
import { authorize } from './_auth.js';

export const config = { runtime: 'edge' };

const YEAR = 60 * 60 * 24 * 365;
const TOKEN_RE = /^[A-Za-z0-9_-]{10,80}$/;

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

    let body = {};
    try { body = await req.json(); } catch { /* empty body ok */ }

    const host = (req.headers.get('host') || '').toLowerCase();

    // ── Team device ────────────────────────────────────────────────────────
    if (body.team) {
        if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);
        return json({ ok: true, team: true }, 200, [cookie('poler_team', '1', host)]);
    }

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);
    const headers = { Authorization: `Bearer ${apiKey}` };

    // ── Token (after capture, or a ?t= alert/share link) ───────────────────
    const token = String(body.token || '').trim();
    if (token) {
        if (!TOKEN_RE.test(token)) return json({ ok: false, error: 'bad token' }, 400);
        const found = await findLead(baseId, headers, `{Alert Token}='${token}'`);
        if (!found) return json({ ok: false }, 404);
        return json({ ok: true }, 200, [cookie('poler_lt', token, host)]);
    }

    // ── Email ("Already registered?" on the gate) ──────────────────────────
    const email = String(body.email || '').trim().toLowerCase();
    if (email) {
        if (email.length > 254 || !/^[^\s@'"\\]+@[^\s@'"\\]+\.[^\s@'"\\]+$/.test(email)) {
            return json({ ok: false, error: 'bad email' }, 400);
        }
        const found = await findLead(baseId, headers, `LOWER({Email})='${email}'`);
        const t = found?.fields?.['Alert Token'];
        if (!found || !t || !TOKEN_RE.test(t)) return json({ ok: false }, 404);
        return json({ ok: true }, 200, [cookie('poler_lt', t, host)]);
    }

    return json({ error: 'token, email or team required' }, 400);
}

async function findLead(baseId, headers, formula) {
    const url = `https://api.airtable.com/v0/${baseId}/Leads?maxRecords=1` +
        `&filterByFormula=${encodeURIComponent(formula)}` +
        `&fields%5B%5D=${encodeURIComponent('Alert Token')}`;
    try {
        const r = await fetch(url, { headers });
        if (!r.ok) return null;
        const d = await r.json();
        return d.records?.[0] || null;
    } catch { return null; }
}

function cookie(name, value, host) {
    const domain = host.endsWith('homesinsoflorida.com') ? '; Domain=.homesinsoflorida.com' : '';
    return `${name}=${value}; Max-Age=${YEAR}; Path=/; Secure; SameSite=Lax${domain}`;
}

function json(data, status = 200, setCookies = []) {
    const h = new Headers({
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
    });
    for (const c of setCookies) h.append('Set-Cookie', c);
    return new Response(JSON.stringify(data), { status, headers: h });
}
