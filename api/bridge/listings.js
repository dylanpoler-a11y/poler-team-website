/**
 * /api/bridge/listings — server-side proxy for the Bridge MLS API.
 *
 * WHY (security audit 2026-07-17): the production Bridge access token was
 * hardcoded in PUBLIC client JS (listing.js, crm.js, str.html) — extractable by
 * any visitor, unmetered direct MLS access under our license. This proxy keeps
 * the token server-side (Vercel env BRIDGE_API_TOKEN, same one the alert
 * engine uses) and lets the public pages call a same-origin endpoint instead.
 *
 * Scope is deliberately narrow — exactly what the three public pages need:
 *   • GET only, /listings only (no other Bridge endpoints)
 *   • client-supplied access_token is stripped (never forwarded)
 *   • limit capped at 200 (the largest any page requests today)
 *   • cross-site browser calls (foreign Origin) are rejected; requests with no
 *     Origin/Referer (privacy browsers, curl) are allowed — same data the
 *     public site already renders, so the win is token custody + future
 *     rate-limiting, not secrecy of active-listing data
 *   • CDN-cached 120s (s-maxage) — listings data tolerates 2-min staleness and
 *     repeat queries (hero property, popular searches) get faster, not slower
 */

export const config = { runtime: 'edge' };

const BRIDGE_BASE = 'https://api.bridgedataoutput.com/api/v2/miamire';
const ALLOWED_HOSTS = [
    'homesinsoflorida.com',
    'www.homesinsoflorida.com',
    'localhost',
    '127.0.0.1',
];

function foreignBrowserOrigin(req) {
    // Only reject when a browser SENT an origin/referer and it's not ours.
    // Absent headers stay allowed — stripping them is common (privacy modes),
    // and blocking would break real buyers on the lead page.
    for (const h of ['origin', 'referer']) {
        const v = req.headers.get(h);
        if (!v) continue;
        try {
            const host = new URL(v).hostname;
            if (!ALLOWED_HOSTS.includes(host) && !host.endsWith('.vercel.app')) return true;
        } catch { /* unparseable header — ignore */ }
    }
    return false;
}

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        });
    }
    if (req.method !== 'GET') {
        return json({ error: 'Method not allowed' }, 405);
    }

    const token = process.env.BRIDGE_API_TOKEN;
    if (!token) return json({ error: 'Bridge not configured' }, 500);

    if (foreignBrowserOrigin(req)) {
        return json({ error: 'Forbidden' }, 403);
    }

    const url = new URL(req.url);
    const params = new URLSearchParams(url.search);
    params.delete('access_token');                    // never trust/forward client tokens
    const limit = parseInt(params.get('limit') || '0', 10);
    if (!limit || limit > 200) params.set('limit', '200');
    params.set('access_token', token);

    let upstream;
    try {
        upstream = await fetch(`${BRIDGE_BASE}/listings?${params}`, {
            headers: { 'User-Agent': 'homesinsoflorida-proxy' },
        });
    } catch (e) {
        return json({ error: 'Bridge unreachable', detail: e.message }, 502);
    }

    const body = await upstream.text();
    return new Response(body, {
        status: upstream.status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            // CDN cache: same query within 2 min = instant, no Bridge hit.
            'Cache-Control': 's-maxage=120, stale-while-revalidate=600',
        },
    });
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
