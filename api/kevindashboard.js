/**
 * /api/kevindashboard.js — password gate for Kevin's private life dashboard at
 * homesinsoflorida.com/kevindashboard
 *
 * DESIGN: this route does NOT contain the dashboard. It authenticates, then
 * fetches the rendered page server-side from the life-dashboard deployment and
 * streams it back. That keeps this production site out of the dashboard's
 * 15-minute rebuild cycle — otherwise every refresh would redeploy the live
 * lead-capture site ~96x a day.
 *
 * The upstream dashboard has its own ?key= gate; that key lives only in this
 * project's Vercel env (LIFE_DASHBOARD_KEY) and is never sent to the browser.
 *
 * Env required (Vercel prod):
 *   KEVINDASH_PASSWORD   — the password Kevin types
 *   LIFE_DASHBOARD_URL   — https://life-dashboard-xi-neon.vercel.app
 *   LIFE_DASHBOARD_KEY   — the upstream ?key= value
 *
 * NOTE: the page carries CRM lead names/phones and email subjects, on a public
 * domain. Hence: noindex, no-store, HttpOnly+Secure cookie, constant-time
 * compare, and a generic failure message that never says whether the password
 * merely "looks" wrong.
 */

export const config = { runtime: 'edge' };

const COOKIE = 'kevindash';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

async function sha256Hex(input) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string compare (equal-length hex digests only). */
function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

function readCookie(req, name) {
    const raw = req.headers.get('cookie') || '';
    for (const part of raw.split(';')) {
        const i = part.indexOf('=');
        if (i > -1 && part.slice(0, i).trim() === name) {
            try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
        }
    }
    return null;
}

const PRIVATE_HEADERS = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
};

function loginPage(error) {
    return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Sign in</title>
<style>
:root{color-scheme:light dark}
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;
 background:#f6f7f9;color:#16181d;padding:24px;
 font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
@media(prefers-color-scheme:dark){body{background:#0f1115;color:#e8eaed}form{background:#171a21!important;border-color:#272b34!important}input{background:#0f1115!important;color:#e8eaed!important;border-color:#272b34!important}}
form{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:26px 24px;
 width:100%;max-width:340px;box-shadow:0 1px 3px rgba(0,0,0,.07)}
h1{font-size:17px;font-weight:640;margin-bottom:4px}
p.hint{font-size:13px;color:#6b7280;margin-bottom:16px}
input{width:100%;padding:11px 12px;font-size:16px;border:1px solid #d8dbe0;
 border-radius:8px;margin-bottom:10px}
button{width:100%;padding:11px;font-size:15px;font-weight:600;color:#fff;
 background:#2f6df6;border:0;border-radius:8px;cursor:pointer}
.err{color:#c0392b;font-size:13px;margin-bottom:10px}
</style></head><body>
<form method="POST" action="/kevindashboard">
  <h1>Kevin's dashboard</h1>
  <p class="hint">Private. Enter your password to continue.</p>
  ${error ? `<p class="err">${error}</p>` : ''}
  <input type="password" name="password" placeholder="Password" autofocus
         autocomplete="current-password" required>
  <button type="submit">Sign in</button>
</form></body></html>`;
}

export default async function handler(req) {
    const password = process.env.KEVINDASH_PASSWORD || '';
    const upstream = process.env.LIFE_DASHBOARD_URL || '';
    const upstreamKey = process.env.LIFE_DASHBOARD_KEY || '';

    if (!password || !upstream || !upstreamKey) {
        return new Response('Dashboard not configured.', {
            status: 503, headers: { 'Content-Type': 'text/plain', ...PRIVATE_HEADERS },
        });
    }

    const expected = await sha256Hex(password);

    // ---- POST: verify the password, set the cookie -------------------------
    if (req.method === 'POST') {
        let supplied = '';
        try {
            const form = await req.formData();
            supplied = String(form.get('password') || '');
        } catch { /* fall through to failure */ }

        if (!safeEqual(await sha256Hex(supplied), expected)) {
            return new Response(loginPage('Incorrect password.'), {
                status: 401,
                headers: { 'Content-Type': 'text/html; charset=utf-8', ...PRIVATE_HEADERS },
            });
        }
        return new Response(null, {
            status: 303,
            headers: {
                Location: '/kevindashboard',
                'Set-Cookie': `${COOKIE}=${expected}; Max-Age=${MAX_AGE}; Path=/kevindashboard; HttpOnly; Secure; SameSite=Lax`,
                ...PRIVATE_HEADERS,
            },
        });
    }

    // ---- GET: cookie or login form -----------------------------------------
    if (!safeEqual(readCookie(req, COOKIE) || '', expected)) {
        return new Response(loginPage(null), {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8', ...PRIVATE_HEADERS },
        });
    }

    // Authenticated: pull the current dashboard from the upstream deployment.
    try {
        const res = await fetch(
            `${upstream.replace(/\/$/, '')}/?key=${encodeURIComponent(upstreamKey)}`,
            { headers: { 'User-Agent': 'poler-kevindashboard' } },
        );
        if (!res.ok) {
            return new Response(
                `Dashboard upstream returned ${res.status}. The dashboard itself may be mid-deploy — try again in a minute.`,
                { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...PRIVATE_HEADERS } },
            );
        }
        return new Response(await res.text(), {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8', ...PRIVATE_HEADERS },
        });
    } catch (e) {
        return new Response(`Could not reach the dashboard: ${e.message}`, {
            status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...PRIVATE_HEADERS },
        });
    }
}
