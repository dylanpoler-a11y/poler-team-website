/**
 * /api/_auth.js — shared auth helper for all consulting + lead endpoints.
 *
 * Two ways to authenticate:
 *   1. Authorization: Bearer <AGENT_API_TOKEN>   (for agents — Claude, Claude Code, scripts)
 *   2. password: <CRM_PASSWORD> in body or ?password=  (for the web UI — same as before)
 *
 * Either works. The web UI keeps using password. New agent integrations use the token.
 *
 * Usage in an endpoint:
 *   import { authorize } from './_auth.js';
 *   if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);
 */

export function authorize(req, body) {
    // AGENT_API_TOKEN can be a single token OR a comma-separated list of
    // user-specific tokens (e.g. "kevinTOKEN,dylanTOKEN,noelTOKEN,rosaTOKEN").
    // Each colleague gets their own so we can rotate/revoke individually.
    const tokens = (process.env.AGENT_API_TOKEN || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    const pw = process.env.CRM_PASSWORD;

    // Bearer token (agents)
    const header = req.headers.get('authorization') || '';
    if (header.startsWith('Bearer ')) {
        const presented = header.slice(7);
        if (tokens.includes(presented)) {
            return { ok: true, mode: 'token', token: presented };
        }
    }

    // Token via query string (for Claude.ai connector — its UI only supports
    // OAuth or no-auth, so we embed the token in the URL itself).
    try {
        const url = new URL(req.url);
        const qsToken = url.searchParams.get('token');
        if (qsToken && tokens.includes(qsToken)) {
            return { ok: true, mode: 'token-qs', token: qsToken };
        }
    } catch { /* ignore */ }

    // Body password (POST/PATCH from web UI)
    if (pw && body && body.password === pw) {
        return { ok: true, mode: 'password' };
    }

    // Query param password (GET from web UI)
    try {
        const url = new URL(req.url);
        if (pw && url.searchParams.get('password') === pw) {
            return { ok: true, mode: 'password' };
        }
    } catch {
        /* ignore */
    }

    return { ok: false };
}
