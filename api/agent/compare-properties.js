/**
 * /api/agent/compare-properties.js — side-by-side comparison.
 * Body: { mlsIds: ['A1...', 'A2...'] }   2-6 listings.
 */

export const config = { runtime: 'edge' };

import { authorize } from '../_auth.js';

const FIELDS = 'ListingId,ListPrice,UnparsedAddress,City,BedroomsTotal,BathroomsTotalInteger,LivingArea,LotSizeSquareFeet,YearBuilt,AssociationFee,WaterfrontYN,PoolFeatures,DaysOnMarket,PropertySubType,Media,PublicRemarks,StandardStatus';

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }});
    }
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    let body;
    try { body = await req.json(); } catch { return json({ error: 'Bad body' }, 400); }
    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);

    const { mlsIds } = body;
    if (!Array.isArray(mlsIds) || mlsIds.length < 2 || mlsIds.length > 6) {
        return json({ error: 'mlsIds must be an array of 2-6 MLS IDs' }, 400);
    }

    const token = process.env.BRIDGE_API_TOKEN;
    const params = new URLSearchParams({
        access_token: token,
        'ListingId.in': mlsIds.join(','),
        fields: FIELDS,
        limit: String(mlsIds.length),
    });
    const res = await fetch(`https://api.bridgedataoutput.com/api/v2/miamire/listings?${params}`);
    if (!res.ok) return json({ error: 'Bridge fetch failed', status: res.status }, 502);
    const data = await res.json();
    const records = data.bundle || data.value || [];
    const lookup = {};
    for (const r of records) lookup[r.ListingId] = r;

    const comparison = mlsIds.map(id => {
        const r = lookup[id];
        if (!r) return { mlsId: id, missing: true };
        return {
            mlsId:        r.ListingId,
            price:        r.ListPrice || 0,
            pricePerSqft: r.LivingArea > 0 ? Math.round((r.ListPrice || 0) / r.LivingArea) : 0,
            beds:         r.BedroomsTotal || 0,
            baths:        r.BathroomsTotalInteger || 0,
            sqft:         r.LivingArea || 0,
            lotSqft:      r.LotSizeSquareFeet || 0,
            yearBuilt:    r.YearBuilt || null,
            hoa:          r.AssociationFee || null,
            propertyType: r.PropertySubType || '',
            address:      r.UnparsedAddress || '',
            city:         r.City || '',
            waterfront:   !!r.WaterfrontYN,
            pool:         (r.PoolFeatures || []).length > 0,
            daysOnMarket: r.DaysOnMarket || 0,
            status:       r.StandardStatus || '',
            photo:        (r.Media || [])[0]?.MediaURL || null,
            url:          `https://homesinsoflorida.com/listing?id=${r.ListingId}`,
        };
    });

    // Quick ranking signals
    const found = comparison.filter(c => !c.missing);
    const bestPpsf = found.length ? Math.min(...found.map(c => c.pricePerSqft || Infinity)) : 0;
    const newestYear = found.length ? Math.max(...found.map(c => c.yearBuilt || 0)) : 0;
    const summary = {
        cheapestPerSqft: found.find(c => c.pricePerSqft === bestPpsf)?.mlsId || null,
        newest:          found.find(c => c.yearBuilt === newestYear)?.mlsId || null,
        anyWaterfront:   found.filter(c => c.waterfront).map(c => c.mlsId),
        anyPool:         found.filter(c => c.pool).map(c => c.mlsId),
    };

    return json({ comparison, summary });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
