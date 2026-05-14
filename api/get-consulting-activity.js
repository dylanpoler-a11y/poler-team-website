/**
 * /api/get-consulting-activity.js — Vercel Edge Function
 * Chronological activity feed for a Company or Deal.
 *
 * Query: password, companyId? (one of), dealId? (one of)
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

    if (!authorize(req, null).ok) return json({ error: 'Unauthorized' }, 401);
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);

    const filters = [];
    if (companyId) filters.push(`FIND('${companyId}', ARRAYJOIN({Company}))`);
    if (dealId)    filters.push(`FIND('${dealId}', ARRAYJOIN({Deal}))`);

    let allActivity = [];
    let offset = null;

    for (let page = 0; page < 10; page++) {
        const params = new URLSearchParams({
            'sort[0][field]':     'Created',
            'sort[0][direction]': 'desc',
            'pageSize':           '100',
        });
        // Note: Airtable doesn't expose a "Created" field unless one exists,
        // so we use createdTime client-side fallback — sort by anything that
        // exists. Switch sort to Title if Created not present.
        // Actually safer: rely on Airtable's record createdTime (returned but
        // not sortable). Sort by Title desc as stable secondary.
        if (offset) params.set('offset', offset);
        if (filters.length) params.set('filterByFormula', `AND(${filters.join(',')})`);

        // Override sort: use "Title" since Created isn't a queryable field.
        params.delete('sort[0][field]');
        params.set('sort[0][field]', 'Title');
        params.set('sort[0][direction]', 'desc');

        const res = await fetch(
            `https://api.airtable.com/v0/${baseId}/Consulting%20Activity?${params}`,
            { headers: { 'Authorization': `Bearer ${apiKey}` } }
        );

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            return json({ error: err.error?.message || 'Failed to fetch activity', activity: [] }, res.status);
        }

        const data = await res.json();
        const records = data.records || [];

        allActivity = allActivity.concat(records.map(r => ({
            id:         r.id,
            title:      r.fields['Title']   || '',
            type:       r.fields['Type']    || 'Note',
            companyId:  (r.fields['Company'] || [])[0] || '',
            dealId:     (r.fields['Deal']    || [])[0] || '',
            details:    r.fields['Details'] || '',
            agent:      r.fields['Agent']   || '',
            createdAt:  r.createdTime       || '',
        })));

        if (!data.offset) break;
        offset = data.offset;
    }

    // Sort newest first by createdTime (reliable)
    allActivity.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    return json({ activity: allActivity });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
