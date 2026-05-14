/**
 * /api/_auth.js — shared auth helper.
 *
 * Accepts ANY of:
 *   1. Authorization: Bearer <token>  — preferred for agents
 *   2. ?token=<token> query string    — for Claude.ai connectors that can't set headers
 *   3. { password: "..." } in body    — legacy web UI
 *
 * AGENT_API_TOKEN env var can be a single token OR a comma-separated list
 * (per-user audit trail). Any match passes.
 * CRM_PASSWORD env var is the single web-UI password.
 *
 * Returns { ok: true, mode: 'bearer'|'token-query'|'password', token? } on success
 *      or { ok: false } on failure.
 */

export function authorize(req, body) {
    const tokensRaw = process.env.AGENT_API_TOKEN || '';
    const tokens = tokensRaw.split(',').map(t => t.trim()).filter(Boolean);
    const crmPass = process.env.CRM_PASSWORD;

    // 1. Authorization: Bearer <token>
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || '';
    if (authHeader.startsWith('Bearer ')) {
        const t = authHeader.slice(7).trim();
        if (tokens.includes(t)) return { ok: true, mode: 'bearer', token: t };
    }

    // 2. ?token= query
    try {
        const u = new URL(req.url);
        const qt = u.searchParams.get('token');
        if (qt && tokens.includes(qt)) return { ok: true, mode: 'token-query', token: qt };
    } catch { /* not a URL — ignore */ }

    // 3. body.password (legacy)
    if (body && typeof body === 'object' && crmPass && body.password === crmPass) {
        return { ok: true, mode: 'password' };
    }

    return { ok: false };
}
