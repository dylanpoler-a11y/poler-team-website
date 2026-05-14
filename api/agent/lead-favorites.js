/**
 * /api/agent/lead-favorites.js
 * Returns the properties a lead has favorited/saved on /listing.
 * Query: leadEmail OR leadId
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
    if (!leadEmail && !leadId) return json({ error: 'leadEmail or leadId required' }, 400);

    const apiKey      = process.env.AIRTABLE_API_KEY;
    const baseId      = process.env.AIRTABLE_BASE_ID;
    const bridgeToken = process.env.BRIDGE_API_TOKEN;

    // Find the lead record
    let lead;
    if (leadId) {
        const r = await fetch(`https://api.airtable.com/v0/${baseId}/Leads/${leadId}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        if (!r.ok) return json({ error: 'Lead not found' }, 404);
        lead = (await r.json()).fields;
    } else {
        const formula = encodeURIComponent(`{Email}='${leadEmail.replace(/'/g, "\\'")}'`);
        const r = await fetch(`https://api.airtable.com/v0/${baseId}/Leads?filterByFormula=${formula}&maxRecords=1`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        if (!r.ok) return json({ error: 'Airtable error', status: r.status }, r.status);
        const data = await r.json();
        if (!data.records?.[0]) return json({ favorites: [], note: 'Lead not found' });
        lead = data.records[0].fields;
    }

    // Parse the Saved Properties JSON array
    let saved = [];
    try {
        saved = JSON.parse(lead['Saved Properties'] || '[]');
    } catch { saved = []; }

    if (saved.length === 0) {
        return json({ count: 0, favorites: [] });
    }

    // Batch-fetch listing details from Bridge MLS
    const mlsIds = saved.filter(Boolean).slice(0, 50);
    const params = new URLSearchParams({
        access_token: bridgeToken,
        'ListingId.in': mlsIds.join(','),
        fields: 'ListingId,ListPrice,UnparsedAddress,BedroomsTotal,BathroomsTotalInteger,LivingArea,City,Media,StandardStatus',
        limit: '50',
    });
    const r2 = await fetch(`https://api.bridgedataoutput.com/api/v2/miamire/listings?${params}`);
    const data2 = r2.ok ? await r2.json() : { bundle: [] };
    const listings = (data2.bundle || data2.value || []).map(l => ({
        mlsId:   l.ListingId,
        price:   l.ListPrice || 0,
        beds:    l.BedroomsTotal || 0,
        baths:   l.BathroomsTotalInteger || 0,
        sqft:    l.LivingArea || 0,
        address: l.UnparsedAddress || '',
        city:    l.City || '',
        photo:   (l.Media || [])[0]?.MediaURL || null,
        status:  l.StandardStatus || '',
        url:     `https://homesinsoflorida.com/listing?id=${l.ListingId}`,
    }));

    return json({ count: listings.length, favorites: listings });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
