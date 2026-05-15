/**
 * /api/agent-trigger-resync.js — proxy from CRM page (CRM_PASSWORD auth) to the
 * cron endpoint (which requires CRON_SECRET). Lets Kevin click "Resync email"
 * in the dashboard without exposing CRON_SECRET to the browser.
 *
 * Body: { password, since? }  — since defaults to "1d"
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';

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

    // Accept password via query string (CRM page passes it that way) OR body
    const url = new URL(req.url);
    const passwordQ = url.searchParams.get('password') || '';
    const sinceQ = url.searchParams.get('since') || '1d';

    let body = {};
    try { body = await req.json(); } catch { /* empty body OK */ }
    body.password = body.password || passwordQ;

    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);

    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) return json({ error: 'CRON_SECRET not configured' }, 500);

    // Call the cron endpoint with the bearer secret
    const since = (body.since || sinceQ || '1d').toString().replace(/[^a-z0-9]/gi, '') || '1d';
    const cronUrl = `https://www.homesinsoflorida.com/api/cron/process-emails?since=${since}`;

    const res = await fetch(cronUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${cronSecret}`,
            'Content-Type': 'application/json',
        },
    });

    const text = await res.text();
    return new Response(text, {
        status: res.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
