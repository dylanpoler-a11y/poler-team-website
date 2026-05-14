/**
 * /api/get-consulting-tasks.js — Vercel Edge Function
 * Fetch consulting tasks. Optional filters via query params.
 *
 * Query: password, companyId?, dealId?, status?, owner?
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
    const dealId    = url.searchParams.get('dealId');
    const statusF   = url.searchParams.get('status');
    const ownerF    = url.searchParams.get('owner');

    if (!authorize(req, null).ok) return json({ error: 'Unauthorized' }, 401);
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);

    const filters = [];
    if (companyId) filters.push(`FIND('${companyId}', ARRAYJOIN({Company}))`);
    if (dealId)    filters.push(`FIND('${dealId}', ARRAYJOIN({Deal}))`);
    if (statusF)   filters.push(`{Status}='${statusF}'`);
    if (ownerF)    filters.push(`{Owner}='${ownerF}'`);

    let allTasks = [];
    let offset = null;

    for (let page = 0; page < 10; page++) {
        const params = new URLSearchParams({
            'sort[0][field]':     'Due At',
            'sort[0][direction]': 'asc',
            'pageSize':           '100',
        });
        if (offset) params.set('offset', offset);
        if (filters.length) params.set('filterByFormula', `AND(${filters.join(',')})`);

        const res = await fetch(
            `https://api.airtable.com/v0/${baseId}/Consulting%20Tasks?${params}`,
            { headers: { 'Authorization': `Bearer ${apiKey}` } }
        );

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            return json({ error: err.error?.message || 'Failed to fetch tasks', tasks: [] }, res.status);
        }

        const data = await res.json();
        const records = data.records || [];

        allTasks = allTasks.concat(records.map(r => ({
            id:        r.id,
            title:     r.fields['Title']  || '',
            type:      r.fields['Type']   || 'Other',
            dueAt:     r.fields['Due At'] || '',
            status:    r.fields['Status'] || 'Pending',
            owner:     r.fields['Owner']  || '',
            companyId: (r.fields['Company'] || [])[0] || '',
            dealId:    (r.fields['Deal']    || [])[0] || '',
            notes:     r.fields['Notes']  || '',
            createdAt: r.createdTime      || '',
        })));

        if (!data.offset) break;
        offset = data.offset;
    }

    return json({ tasks: allTasks });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
