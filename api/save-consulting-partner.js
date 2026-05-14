/**
 * /api/save-consulting-partner.js — Vercel Edge Function
 * Create a partner.
 *
 * Body: { password, name, type?, contactInfo?, defaultRevenueShare?, notes? }
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
        name                = '',
        type                = 'Individual',
        contactInfo         = '',
        defaultRevenueShare = null,
        notes               = '',
    } = body;

    if (!name.trim()) return json({ error: 'name is required' }, 400);

    const fields = { 'Partner Name': name.trim(), 'Partner Type': type };
    if (contactInfo) fields['Contact Info'] = contactInfo;
    if (defaultRevenueShare != null && defaultRevenueShare !== '') {
        // Airtable percent expects 0–1 (e.g. 25% = 0.25). Accept either.
        const n = Number(defaultRevenueShare);
        fields['Default Revenue Share'] = n > 1 ? n / 100 : n;
    }
    if (notes) fields['Notes'] = notes;

    const res = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Partners`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type':  'application/json',
        },
        body: JSON.stringify({ records: [{ fields }], typecast: true }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to create partner' }, 500);
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
