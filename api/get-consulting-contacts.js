/**
 * /api/get-consulting-contacts.js — Vercel Edge Function
 * Fetch consulting contacts. Optional filter by companyId.
 *
 * Query: password, companyId?
 * Required env vars: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, CRM_PASSWORD
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
    const password  = url.searchParams.get('password');
    const companyId = url.searchParams.get('companyId');

    if (!authorize(req, null).ok) return json({ error: 'Unauthorized' }, 401);
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);

    let allContacts = [];
    let offset = null;

    for (let page = 0; page < 10; page++) {
        const params = new URLSearchParams({ pageSize: '100' });
        if (offset) params.set('offset', offset);
        if (companyId) params.set('filterByFormula', `FIND('${companyId}', ARRAYJOIN({Company}))`);

        const res = await fetch(
            `https://api.airtable.com/v0/${baseId}/Consulting%20Contacts?${params}`,
            { headers: { 'Authorization': `Bearer ${apiKey}` } }
        );
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            return json({ error: err.error?.message || 'Failed to fetch contacts', contacts: [] }, res.status);
        }
        const data = await res.json();
        const records = data.records || [];
        allContacts = allContacts.concat(records.map(r => ({
            id:        r.id,
            name:      r.fields['Name']     || '',
            companyId: (r.fields['Company'] || [])[0] || '',
            role:      r.fields['Role']     || '',
            email:     r.fields['Email']    || '',
            phone:     r.fields['Phone']    || '',
            primary:   !!r.fields['Primary'],
            language:  r.fields['Language'] || '',
            notes:     r.fields['Notes']    || '',
            createdAt: r.createdTime        || '',
        })));
        if (!data.offset) break;
        offset = data.offset;
    }

    return json({ contacts: allContacts });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
