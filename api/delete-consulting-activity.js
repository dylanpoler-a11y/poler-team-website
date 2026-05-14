/**
 * /api/delete-consulting-activity.js — delete one Consulting Activity row.
 *
 * Body: { id, password? }   Auth: Bearer token or body password.
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            },
        });
    }
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;

    let body;
    try { body = await req.json(); }
    catch { return json({ error: 'Invalid request body' }, 400); }

    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);

    const { id } = body;
    if (!id) return json({ error: 'id is required' }, 400);

    const res = await fetch(
        `https://api.airtable.com/v0/${baseId}/Consulting%20Activity/${id}`,
        {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${apiKey}` },
        },
    );
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to delete', status: res.status }, 500);
    }
    return json({ success: true });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
    });
}
