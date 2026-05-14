/**
 * /api/update-consulting-contact.js — Vercel Edge Function
 * PATCH a contact.
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
    if (!id) return json({ error: 'Contact id is required' }, 400);

    const fields = {};
    if (input.name     !== undefined) fields['Name']     = String(input.name);
    if (input.role     !== undefined) fields['Role']     = String(input.role);
    if (input.email    !== undefined) fields['Email']    = String(input.email);
    if (input.phone    !== undefined) fields['Phone']    = String(input.phone);
    if (input.primary  !== undefined) fields['Primary']  = !!input.primary;
    if (input.language !== undefined) fields['Language'] = input.language;
    if (input.notes    !== undefined) fields['Notes']    = String(input.notes);

    if (Object.keys(fields).length === 0) {
        return json({ error: 'No fields to update' }, 400);
    }

    const res = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Contacts`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type':  'application/json',
        },
        body: JSON.stringify({ records: [{ id, fields }], typecast: true }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to update contact' }, 500);
    }

    return json({ success: true });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
