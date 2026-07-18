/**
 * /api/_capi.js — Meta Conversions API (CAPI) helper — shared, NOT a route (leading underscore).
 *
 * Server-side mirror of the browser Meta Pixel events (Lead / Contact / QualifiedLead / Purchase)
 * fired from listing.js. This module is completely INERT (no-op) until META_CAPI_ACCESS_TOKEN is
 * set in Vercel env — that is the hard gate for the whole feature. `sendCapiEvent()` can NEVER
 * throw and is time-bounded (4s) so it can never meaningfully delay a caller.
 *
 * Runtime note: this project runs on Vercel EDGE functions (`export const config = { runtime:
 * 'edge' }`, package.json `"type":"module"`) — there is no Node `require`/`module.exports` and no
 * Node `crypto` module here. Hashing uses the Web Crypto API (`crypto.subtle`), which is a global
 * in both the Edge runtime and Node 18+ — no new npm dependency needed.
 *
 * Required Vercel env vars:
 *   META_CAPI_ACCESS_TOKEN — Graph API access token for the pixel/dataset. REQUIRED —
 *                            everything in this file is a no-op without it.
 *   META_PIXEL_ID          — optional; defaults to the pixel already hardcoded in listing.html
 *                            ('1221841166090741').
 *   META_CAPI_TEST_CODE    — optional; Meta Events Manager "Test Events" code. When set, it's
 *                            attached to every event so you can verify delivery in Test Events
 *                            without affecting live attribution.
 */

const DEFAULT_PIXEL_ID = '1221841166090741';
const GRAPH_VERSION = 'v21.0';
const FETCH_TIMEOUT_MS = 4000;

// SHA-256 hex digest via Web Crypto — available globally, no Node `crypto` import needed.
async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function normalizeText(v) {
    return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

// Meta wants digits-only (E.164 minus the leading '+') before hashing.
function normalizePhoneDigits(v) {
    return typeof v === 'string' ? v.replace(/\D/g, '') : '';
}

// Pull one cookie's value out of a raw `Cookie` request header string.
function getCookieFromHeader(cookieHeader, name) {
    if (!cookieHeader) return '';
    const parts = cookieHeader.split(';').map(s => s.trim());
    const hit = parts.find(s => s.startsWith(`${name}=`));
    if (!hit) return '';
    try {
        return decodeURIComponent(hit.slice(name.length + 1));
    } catch {
        return hit.slice(name.length + 1);
    }
}

// Hash the fields Meta accepts hashed. Only includes a field when the raw value is present.
async function buildHashedUserData(userData = {}) {
    const out = {};

    const email = normalizeText(userData.email);
    if (email) out.em = await sha256Hex(email);

    const phone = normalizePhoneDigits(userData.phone);
    if (phone) out.ph = await sha256Hex(phone);

    const fn = normalizeText(userData.firstName);
    if (fn) out.fn = await sha256Hex(fn);

    const ln = normalizeText(userData.lastName);
    if (ln) out.ln = await sha256Hex(ln);

    const country = normalizeText(userData.country);
    if (country) out.country = await sha256Hex(country);

    return out;
}

/**
 * Fire one server-side CAPI event. NEVER throws — every failure is caught, logged with
 * console.error, and swallowed. Callers should still wrap in their own try/catch defensively,
 * but a bug in here can never break the caller's real work (lead save / lead update).
 *
 * @param {object} opts
 * @param {string} opts.eventName        - Meta event name: 'Lead' | 'Contact' | 'QualifiedLead' | 'Purchase' | ...
 * @param {string} [opts.eventId]        - Dedup id shared with the browser fbq(...,{eventID}) call.
 *                                         Omit for server-only events with no browser counterpart.
 * @param {string} [opts.eventSourceUrl] - Page URL the action happened on.
 * @param {object} [opts.userData]       - { email, phone, firstName, lastName, country, fbp, fbc }
 * @param {object} [opts.customData]     - custom_data passthrough (content_category, currency, value, ...)
 * @param {Request} [opts.req]           - The incoming Fetch API Request (Edge runtime). Used ONLY to
 *                                         derive client_ip_address / client_user_agent / _fbp/_fbc
 *                                         cookies when they weren't already supplied in userData.
 * @returns {Promise<{sent:boolean, reason?:string}>} — for logging only; callers should ignore this.
 */
export async function sendCapiEvent({ eventName, eventId, eventSourceUrl, userData = {}, customData = {}, req } = {}) {
    // Inert until a token is configured — the whole feature no-ops here. First statement,
    // OUTSIDE the try, so the gate can never be affected by anything below it.
    const accessToken = process.env.META_CAPI_ACCESS_TOKEN;
    if (!accessToken) return { sent: false, reason: 'no_token' };

    try {
        const pixelId = process.env.META_PIXEL_ID || DEFAULT_PIXEL_ID;

        if (!eventName) return { sent: false, reason: 'no_event_name' };

        // Derive ip / ua / cookies from the request when present — never throw on a malformed req.
        let clientIp = '';
        let clientUa = '';
        let fbp = userData.fbp || '';
        let fbc = userData.fbc || '';
        if (req && req.headers && typeof req.headers.get === 'function') {
            const xff = req.headers.get('x-forwarded-for') || '';
            clientIp = (xff.split(',')[0] || req.headers.get('x-real-ip') || '').trim();
            clientUa = req.headers.get('user-agent') || '';
            if (!fbp || !fbc) {
                const cookieHeader = req.headers.get('cookie') || '';
                if (!fbp) fbp = getCookieFromHeader(cookieHeader, '_fbp');
                if (!fbc) fbc = getCookieFromHeader(cookieHeader, '_fbc');
            }
        }

        const hashedUserData = await buildHashedUserData(userData);
        if (fbp) hashedUserData.fbp = fbp;
        if (fbc) hashedUserData.fbc = fbc;
        if (clientIp) hashedUserData.client_ip_address = clientIp;
        if (clientUa) hashedUserData.client_user_agent = clientUa;

        const eventPayload = {
            event_name: eventName,
            event_time: Math.floor(Date.now() / 1000),
            action_source: 'website',
            ...(eventId ? { event_id: eventId } : {}),
            ...(eventSourceUrl ? { event_source_url: eventSourceUrl } : {}),
            user_data: hashedUserData,
            custom_data: customData,
        };

        const requestBody = { data: [eventPayload] };
        const testCode = process.env.META_CAPI_TEST_CODE;
        if (testCode) requestBody.test_event_code = testCode;

        const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`;

        // Bound worst-case latency so a slow/hanging Graph API call can never meaningfully
        // delay the caller (lead save / lead update).
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        let res;
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeout);
        }

        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            console.error('[capi] Graph API error', eventName, res.status, errText);
            return { sent: false, reason: `http_${res.status}` };
        }

        return { sent: true };
    } catch (err) {
        console.error('[capi] sendCapiEvent failed', eventName, err && err.message ? err.message : err);
        return { sent: false, reason: 'exception' };
    }
}
