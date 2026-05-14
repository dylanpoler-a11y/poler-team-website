/**
 * /api/get-consulting-partners.js — Vercel Edge Function
 * Fetch all consulting partners.
 *
 * Query: password
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        });
    }
    if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

    const apiKey  = process.env.AIRTABLE_API_KEY;
    const baseId  = process.env.AIRTABLE_BASE_ID;
    const crmPass = process.env.CRM_PASSWORD;

    const url = new URL(req.url);
    const password = url.searchParams.get('password');

    if (!authorize(req, null).ok) return json({ error: 'Unauthorized' }, 401);
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);

    let allPartners = [];
    let offset = null;

    for (let page = 0; page < 5; page++) {
        const params = new URLSearchParams({ pageSize: '100' });
        if (offset) params.set('offset', offset);

        const res = await fetch(
            `https://api.airtable.com/v0/${baseId}/Consulting%20Partners?${params}`,
            { headers: { 'Authorization': `Bearer ${apiKey}` } }
        );
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            return json({ error: err.error?.message || 'Failed to fetch partners', partners: [] }, res.status);
        }
        const data = await res.json();
        const records = data.records || [];
        allPartners = allPartners.concat(records.map(r => ({
            id:                  r.id,
            name:                r.fields['Partner Name']           || '',
            type:                r.fields['Partner Type']           || '',
            contactInfo:         r.fields['Contact Info']           || '',
            defaultRevenueShare: r.fields['Default Revenue Share']  ?? null,
            notes:               r.fields['Notes']                  || '',
            createdAt:           r.createdTime                      || '',
        })));
        if (!data.offset) break;
        offset = data.offset;
    }

    return json({ partners: allPartners });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
