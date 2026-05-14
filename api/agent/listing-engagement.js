/**
 * /api/agent/listing-engagement.js
 * How many leads viewed / favorited / asked about a specific MLS#.
 * Query: ?mlsId=
 */

export const config = { runtime: 'edge' };

import { authorize } from '../_auth.js';

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }});
    }
    if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    if (!authorize(req, null).ok) return json({ error: 'Unauthorized' }, 401);

    const url = new URL(req.url);
    const mlsId = url.searchParams.get('mlsId');
    if (!mlsId) return json({ error: 'mlsId required' }, 400);

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const headers = { 'Authorization': `Bearer ${apiKey}` };

    // Paginate all Leads to scan Saved Properties + Properties Viewed for this MLS#
    let leads = [];
    let offset = null;
    for (let page = 0; page < 10; page++) {
        const params = new URLSearchParams({
            pageSize: '100',
            'fields[]': 'Email',
        });
        params.append('fields[]', 'Name');
        params.append('fields[]', 'Saved Properties');
        params.append('fields[]', 'Properties Viewed');
        if (offset) params.set('offset', offset);
        const r = await fetch(`https://api.airtable.com/v0/${baseId}/Leads?${params}`, { headers });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            return json({ error: err.error?.message || 'Airtable error', status: r.status }, r.status);
        }
        const d = await r.json();
        leads = leads.concat(d.records || []);
        if (!d.offset) break;
        offset = d.offset;
    }

    const favoritedBy = [];
    const viewedBy = [];

    for (const lead of leads) {
        const f = lead.fields || {};
        let saved = [];
        let viewed = [];
        try { saved = JSON.parse(f['Saved Properties'] || '[]'); } catch {}
        try { viewed = JSON.parse(f['Properties Viewed'] || '[]'); } catch {}

        const savedSet = new Set(saved.filter(Boolean));
        if (savedSet.has(mlsId)) {
            favoritedBy.push({ leadId: lead.id, email: f.Email || '', name: f.Name || '' });
        }
        const viewedSet = new Set();
        for (const v of viewed) {
            const m = typeof v === 'string' ? v : (v.mls || v.mlsId);
            if (m) viewedSet.add(m);
        }
        if (viewedSet.has(mlsId)) {
            viewedBy.push({ leadId: lead.id, email: f.Email || '', name: f.Name || '' });
        }
    }

    return json({
        mlsId,
        favoritedCount: favoritedBy.length,
        viewedCount:    viewedBy.length,
        favoritedBy:    favoritedBy.slice(0, 50),
        viewedBy:       viewedBy.slice(0, 50),
    });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
