/**
 * /api/agent/log-call.js — Vercel Edge Function
 * Log a phone-call summary as a Lead Activity row (existing pattern).
 *
 * Body: { leadId, summary, durationMin?, agent? }
 * Auth: Bearer token (or password)
 */

export const config = { runtime: 'edge' };

import { authorize } from '../_auth.js';

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

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;

    let body;
    try { body = await req.json(); }
    catch { return json({ error: 'Invalid request body' }, 400); }

    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);

    const { leadId, summary, durationMin, agent = 'Agent' } = body;
    if (!leadId || !summary?.trim()) {
        return json({ error: 'leadId and summary are required' }, 400);
    }

    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    // Need lead's email to write activity (Lead Activity table is keyed by email)
    const cur = await fetch(`https://api.airtable.com/v0/${baseId}/Leads/${leadId}`, { headers });
    if (!cur.ok) return json({ error: 'Lead not found' }, 404);
    const lead = await cur.json();
    const email = lead.fields?.['Email'] || '';
    if (!email) return json({ error: 'Lead has no email — cannot link activity' }, 400);

    const details = durationMin
        ? `Duration: ${durationMin}m\n\n${summary.trim()}`
        : summary.trim();

    const res = await fetch(`https://api.airtable.com/v0/${baseId}/Lead Activity`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            records: [{
                fields: {
                    'Lead Email':    email,
                    'Activity Type': 'Call',
                    'Details':       details,
                    'Timestamp':     new Date().toISOString(),
                },
            }],
            typecast: true,
        }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to log call' }, 500);
    }

    return json({ success: true });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
