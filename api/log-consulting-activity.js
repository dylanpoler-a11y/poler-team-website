/**
 * /api/log-consulting-activity.js — Vercel Edge Function
 * Logs an activity row (note, call summary, email logged, etc) for a
 * Consulting Company and optionally a Deal.
 *
 * Body: { password, companyId, dealId?, type, title, details?, agent? }
 *
 * Required env vars: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, CRM_PASSWORD
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';

const VALID_TYPES = [
    'Note', 'Stage Change', 'Doc Upload', 'Call Logged',
    'Email Logged', 'Task Completed', 'WhatsApp', 'Deal Created',
];

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

    const apiKey  = process.env.AIRTABLE_API_KEY;
    const baseId  = process.env.AIRTABLE_BASE_ID;
    const crmPass = process.env.CRM_PASSWORD;

    let body;
    try { body = await req.json(); }
    catch { return json({ error: 'Invalid request body' }, 400); }

    const { password } = body;
    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);

    const {
        companyId = '',
        dealId    = '',
        type      = 'Note',
        title     = '',
        details   = '',
        agent     = '',
    } = body;

    if (!companyId) return json({ error: 'companyId is required' }, 400);
    if (!VALID_TYPES.includes(type)) {
        return json({ error: `type must be one of ${VALID_TYPES.join(', ')}` }, 400);
    }
    if (!title.trim()) return json({ error: 'title is required' }, 400);

    const fields = {
        'Title':   title.trim().substring(0, 250),
        'Type':    type,
        'Company': [companyId],
        'Details': details,
        'Agent':   agent,
    };
    if (dealId) fields['Deal'] = [dealId];

    const res = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Activity`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type':  'application/json',
        },
        body: JSON.stringify({ records: [{ fields }], typecast: true }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to log activity' }, 500);
    }

    const data = await res.json();
    return json({ success: true, id: data.records?.[0]?.id });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
