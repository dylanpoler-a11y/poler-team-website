/**
 * /api/update-consulting-partner.js — Vercel Edge Function
 * PATCH a partner.
 *
 * Body: { id, password, ...fields }
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'PATCH, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        });
    }
    if (req.method !== 'PATCH') return json({ error: 'Method not allowed' }, 405);

    const apiKey  = process.env.AIRTABLE_API_KEY;
    const baseId  = process.env.AIRTABLE_BASE_ID;
    const crmPass = process.env.CRM_PASSWORD;

    let body;
    try { body = await req.json(); }
    catch { return json({ error: 'Invalid request body' }, 400); }

    const { id, password, ...input } = body;
    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);
    if (!id) return json({ error: 'Partner id is required' }, 400);

    const fields = {};
    if (input.name        !== undefined) fields['Partner Name'] = String(input.name);
    if (input.type        !== undefined) fields['Partner Type'] = input.type;
    if (input.contactInfo !== undefined) fields['Contact Info'] = String(input.contactInfo);
    if (input.notes       !== undefined) fields['Notes']        = String(input.notes);
    if (input.defaultRevenueShare !== undefined) {
        const n = Number(input.defaultRevenueShare);
        if (!isNaN(n)) fields['Default Revenue Share'] = n > 1 ? n / 100 : n;
    }

    if (Object.keys(fields).length === 0) {
        return json({ error: 'No fields to update' }, 400);
    }

    const res = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Partners`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type':  'application/json',
        },
        body: JSON.stringify({ records: [{ id, fields }], typecast: true }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to update partner' }, 500);
    }
    return json({ success: true });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
