/**
 * /api/create-consulting-task.js — Vercel Edge Function
 * Create a task linked to a Company and optionally a Deal.
 *
 * Body: { password, companyId, dealId?, title, type?, dueAt?, owner?, notes? }
 *
 * Required env vars: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, CRM_PASSWORD
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';

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
        title     = '',
        type      = 'Follow Up',
        dueAt     = '',
        owner     = '',
        notes     = '',
    } = body;

    if (!companyId || !title.trim()) {
        return json({ error: 'companyId and title are required' }, 400);
    }

    const fields = {
        'Title':   title.trim(),
        'Type':    type,
        'Status':  'Pending',
        'Company': [companyId],
    };
    if (dueAt) fields['Due At'] = dueAt;
    if (owner) fields['Owner'] = owner;
    if (notes) fields['Notes'] = notes;
    if (dealId) fields['Deal'] = [dealId];

    const res = await fetch(
        `https://api.airtable.com/v0/${baseId}/Consulting%20Tasks`,
        {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type':  'application/json',
            },
            body: JSON.stringify({ records: [{ fields }], typecast: true }),
        }
    );

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to create task' }, 500);
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
