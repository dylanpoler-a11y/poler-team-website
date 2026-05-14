/**
 * /api/agent/lead-viewed.js
 * Returns properties this lead has viewed on /listing.
 * Pulls from the Lead's "Properties Viewed" field (JSON array of MLS IDs with timestamps).
 * Query: leadEmail OR leadId, limit (default 30)
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
    const leadEmail = url.searchParams.get('leadEmail');
    const leadId    = url.searchParams.get('leadId');
    const limit     = Math.min(parseInt(url.searchParams.get('limit') || '30', 10), 100);
    if (!leadEmail && !leadId) return json({ error: 'leadEmail or leadId required' }, 400);

    const apiKey      = process.env.AIRTABLE_API_KEY;
    const baseId      = process.env.AIRTABLE_BASE_ID;
    const bridgeToken = process.env.BRIDGE_API_TOKEN;
    const headers = { 'Authorization': `Bearer ${apiKey}` };

    let lead;
    if (leadId) {
        const r = await fetch(`https://api.airtable.com/v0/${baseId}/Leads/${leadId}`, { headers });
        if (!r.ok) return json({ error: 'Lead not found' }, 404);
        lead = (await r.json()).fields;
    } else {
        const formula = encodeURIComponent(`{Email}='${leadEmail.replace(/'/g, "\\'")}'`);
        const r = await fetch(`https://api.airtable.com/v0/${baseId}/Leads?filterByFormula=${formula}&maxRecords=1`, { headers });
        if (!r.ok) return json({ error: 'Airtable error', status: r.status }, r.status);
        const data = await r.json();
        if (!data.records?.[0]) return json({ viewed: [], note: 'Lead not found' });
        lead = data.records[0].fields;
    }

    let views = [];
    try {
        const raw = lead['Properties Viewed'] || '[]';
        views = JSON.parse(raw);
        // Each entry is typically { mls, ts } or just mlsId string
    } catch { views = []; }

    if (!Array.isArray(views) || views.length === 0) {
        return json({ count: 0, viewed: [] });
    }

    // Newest first, dedupe
    const seen = new Set();
    const ordered = [];
    for (let i = views.length - 1; i >= 0; i--) {
        const v = views[i];
        const mls = typeof v === 'string' ? v : (v.mls || v.mlsId || '');
        if (!mls || seen.has(mls)) continue;
        seen.add(mls);
        ordered.push({ mls, ts: typeof v === 'object' ? (v.ts || v.viewedAt) : null });
        if (ordered.length >= limit) break;
    }

    const mlsIds = ordered.map(o => o.mls);
    if (mlsIds.length === 0) return json({ count: 0, viewed: [] });

    const params = new URLSearchParams({
        access_token: bridgeToken,
        'ListingId.in': mlsIds.join(','),
        fields: 'ListingId,ListPrice,UnparsedAddress,BedroomsTotal,BathroomsTotalInteger,LivingArea,City,Media,StandardStatus',
        limit: String(mlsIds.length),
    });
    const r2 = await fetch(`https://api.bridgedataoutput.com/api/v2/miamire/listings?${params}`);
    const data2 = r2.ok ? await r2.json() : { bundle: [] };
    const lookup = {};
    for (const l of (data2.bundle || data2.value || [])) lookup[l.ListingId] = l;

    const viewed = ordered.map(o => {
        const l = lookup[o.mls];
        if (!l) return { mlsId: o.mls, viewedAt: o.ts, missing: true };
        return {
            mlsId:    l.ListingId,
            viewedAt: o.ts,
            price:    l.ListPrice || 0,
            beds:     l.BedroomsTotal || 0,
            baths:    l.BathroomsTotalInteger || 0,
            sqft:     l.LivingArea || 0,
            address:  l.UnparsedAddress || '',
            city:     l.City || '',
            photo:    (l.Media || [])[0]?.MediaURL || null,
            status:   l.StandardStatus || '',
            url:      `https://homesinsoflorida.com/listing?id=${l.ListingId}`,
        };
    });

    return json({ count: viewed.length, viewed });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
