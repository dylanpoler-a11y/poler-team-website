/**
 * /api/agent/top-listings.js
 * Most-viewed and most-favorited MLS listings across all leads.
 * Query: ?days=7 (default 7) — limits to viewed-within-last-N-days
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

    const days = parseInt(new URL(req.url).searchParams.get('days') || '7', 10);
    const cutoff = Date.now() - days * 86400000;

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const bridgeToken = process.env.BRIDGE_API_TOKEN;
    const headers = { 'Authorization': `Bearer ${apiKey}` };

    // Paginate leads
    let leads = [];
    let offset = null;
    for (let page = 0; page < 10; page++) {
        const params = new URLSearchParams({ pageSize: '100' });
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

    const viewCount = {};       // mlsId → count
    const recentViewCount = {}; // mlsId → count (within `days`)
    const favoriteCount = {};

    for (const lead of leads) {
        const f = lead.fields || {};
        let saved = [];
        let viewed = [];
        try { saved = JSON.parse(f['Saved Properties'] || '[]'); } catch {}
        try { viewed = JSON.parse(f['Properties Viewed'] || '[]'); } catch {}

        for (const m of saved) {
            if (!m) continue;
            favoriteCount[m] = (favoriteCount[m] || 0) + 1;
        }
        const perLeadViewed = new Set();
        const perLeadRecent = new Set();
        for (const v of viewed) {
            const m = typeof v === 'string' ? v : (v.mls || v.mlsId);
            const ts = typeof v === 'object' ? (v.ts || v.viewedAt) : null;
            if (!m) continue;
            perLeadViewed.add(m);
            if (ts && new Date(ts).getTime() >= cutoff) perLeadRecent.add(m);
        }
        for (const m of perLeadViewed) viewCount[m] = (viewCount[m] || 0) + 1;
        for (const m of perLeadRecent) recentViewCount[m] = (recentViewCount[m] || 0) + 1;
    }

    const topRecent = Object.entries(recentViewCount)
        .map(([mls, n]) => ({ mlsId: mls, views: n, favorites: favoriteCount[mls] || 0 }))
        .sort((a, b) => b.views - a.views || b.favorites - a.favorites)
        .slice(0, 15);
    const topFavorites = Object.entries(favoriteCount)
        .map(([mls, n]) => ({ mlsId: mls, favorites: n, views: viewCount[mls] || 0 }))
        .sort((a, b) => b.favorites - a.favorites || b.views - a.views)
        .slice(0, 15);

    // Enrich with Bridge metadata for the top items
    const allTopMls = [...new Set([...topRecent.map(t => t.mlsId), ...topFavorites.map(t => t.mlsId)])];
    let lookup = {};
    if (allTopMls.length) {
        const p = new URLSearchParams({
            access_token: bridgeToken,
            'ListingId.in': allTopMls.join(','),
            fields: 'ListingId,ListPrice,UnparsedAddress,City,Media,StandardStatus',
            limit: String(allTopMls.length),
        });
        const r = await fetch(`https://api.bridgedataoutput.com/api/v2/miamire/listings?${p}`);
        if (r.ok) {
            const d = await r.json();
            for (const l of (d.bundle || d.value || [])) lookup[l.ListingId] = l;
        }
    }
    const enrich = (entry) => {
        const l = lookup[entry.mlsId];
        if (!l) return { ...entry, missing: true };
        return {
            ...entry,
            price:   l.ListPrice || 0,
            address: l.UnparsedAddress || '',
            city:    l.City || '',
            photo:   (l.Media || [])[0]?.MediaURL || null,
            status:  l.StandardStatus || '',
            url:     `https://homesinsoflorida.com/listing?id=${l.ListingId}`,
        };
    };

    return json({
        days,
        topRecentViews:   topRecent.map(enrich),
        topAllTimeFavorites: topFavorites.map(enrich),
    });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
