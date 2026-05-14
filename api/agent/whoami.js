/**
 * /api/agent/whoami.js — Vercel Edge Function
 * Returns which user the current Bearer token belongs to. Useful for Claude
 * to know its identity when operating on behalf of Kevin / Dylan / Noel / Rosa.
 *
 * Token-to-name mapping is held in env var AGENT_TOKEN_NAMES as a JSON object,
 * e.g. {"<token1>":"Kevin","<token2>":"Dylan"}. If absent, returns "unknown".
 *
 * Auth: Bearer token (or password)
 */

export const config = { runtime: 'edge' };

import { authorize } from '../_auth.js';

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            },
        });
    }
    if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

    const auth = authorize(req, null);
    if (!auth.ok) return json({ error: 'Unauthorized' }, 401);

    let name = 'unknown';
    if (auth.token) {
        try {
            const map = JSON.parse(process.env.AGENT_TOKEN_NAMES || '{}');
            if (map[auth.token]) name = map[auth.token];
        } catch { /* ignore */ }
    } else if (auth.mode === 'password') {
        name = 'web-ui';
    }

    return json({
        authenticated: true,
        mode: auth.mode,
        user: name,
        capabilities: ['real-estate-leads', 'reminders', 'mls-search', 'consulting-companies', 'consulting-deals', 'consulting-tasks'],
    });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
