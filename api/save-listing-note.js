/**
 * /api/save-listing-note.js — create OR delete a Listing Note row.
 *
 * Body: { password, mlsId, listingTitle?, type?, details, agent? }   → create
 *   OR  { password, id, _delete: true }                                → delete
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }});
    }
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);

    let body;
    try { body = await req.json(); } catch { return json({ error: 'Invalid body' }, 400); }
    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);

    // Delete path
    if (body._delete && body.id) {
        const res = await fetch(`https://api.airtable.com/v0/${baseId}/Listing%20Notes/${body.id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            return json({ error: err.error?.message || 'Failed to delete', status: res.status }, 500);
        }
        return json({ success: true, deleted: body.id });
    }

    // Create path
    const { mlsId, listingTitle, type = 'Note', details, agent } = body;
    if (!mlsId || !details) return json({ error: 'mlsId and details required' }, 400);

    const title = details.length > 80 ? details.slice(0, 80) + '…' : details;
    const res = await fetch(`https://api.airtable.com/v0/${baseId}/Listing%20Notes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            records: [{
                fields: {
                    'Title': title,
                    'MLS ID': String(mlsId),
                    'Listing Title': listingTitle || '',
                    'Type': type,
                    'Details': details,
                    'Agent': agent || 'Kevin',
                    'Created At': new Date().toISOString(),
                },
            }],
            typecast: true,
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to save', status: res.status }, 500);
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
