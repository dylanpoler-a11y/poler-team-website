/**
 * /api/get-listing-notes.js — list Listing Notes for one MLS listing.
 *
 * Auth: ?password= or body.password
 * Query: ?mlsId=A11898011
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }});
    }

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);

    const url = new URL(req.url);
    const body = req.method === 'POST'
        ? await req.json().catch(() => ({}))
        : { password: url.searchParams.get('password') || '' };
    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);

    const mlsId = url.searchParams.get('mlsId') || body.mlsId || '';
    const params = new URLSearchParams({ pageSize: '100' });
    if (mlsId) {
        params.set('filterByFormula', `{MLS ID}='${mlsId.replace(/'/g, "\\'")}'`);
    }
    params.append('sort[0][field]', 'Created At');
    params.append('sort[0][direction]', 'desc');

    const res = await fetch(`https://api.airtable.com/v0/${baseId}/Listing%20Notes?${params}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to fetch', status: res.status }, 500);
    }
    const data = await res.json();
    const notes = (data.records || []).map(r => ({
        id:           r.id,
        title:        r.fields?.['Title'] || '',
        mlsId:        r.fields?.['MLS ID'] || '',
        listingTitle: r.fields?.['Listing Title'] || '',
        type:         r.fields?.['Type']?.name || r.fields?.['Type'] || 'Note',
        details:      r.fields?.['Details'] || '',
        agent:        r.fields?.['Agent']?.name || r.fields?.['Agent'] || '',
        createdAt:    r.fields?.['Created At'] || r.createdTime,
    }));
    return json({ count: notes.length, notes });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
