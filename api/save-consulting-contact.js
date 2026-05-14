/**
 * /api/save-consulting-contact.js — Vercel Edge Function
 * Create a contact for a Company.
 *
 * Body: { password, companyId, name, role?, email?, phone?, primary?, language?, notes? }
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
        name      = '',
        role      = '',
        email     = '',
        phone     = '',
        primary   = false,
        language  = '',
        notes     = '',
    } = body;

    if (!companyId || !name.trim()) {
        return json({ error: 'companyId and name are required' }, 400);
    }

    const fields = { 'Name': name.trim(), 'Company': [companyId] };
    if (role)     fields['Role']    = role;
    if (email)    fields['Email']   = email;
    if (phone)    fields['Phone']   = phone;
    if (primary)  fields['Primary'] = true;
    if (language) fields['Language'] = language;
    if (notes)    fields['Notes']   = notes;

    const res = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Contacts`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type':  'application/json',
        },
        body: JSON.stringify({ records: [{ fields }], typecast: true }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to create contact' }, 500);
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
