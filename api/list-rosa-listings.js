/**
 * /api/list-rosa-listings.js — Vercel Edge Function (CRM-facing version)
 * Returns Rosa Poler's active MLS listings.
 *
 * Auth: ?password=<CRM_PASSWORD>  or  body.password  (matches other CRM endpoints).
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';

const FIELDS = [
    'ListingId','ListPrice','City','PropertySubType','BedroomsTotal','BathroomsTotalInteger',
    'LivingArea','LotSizeSquareFeet','UnparsedAddress','PublicRemarks','Media','PhotosCount',
    'StandardStatus','FeedTypes','ListAgentEmail','ModificationTimestamp',
].join(',');

const ROSA_MLS_AGENT_ID = '3268052';

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }});
    }

    // For GET, accept password as a query param via the body-like shape _auth expects.
    const url = new URL(req.url);
    const body = req.method === 'POST'
        ? await req.json().catch(() => ({}))
        : { password: url.searchParams.get('password') || '' };

    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);

    const token = process.env.BRIDGE_API_TOKEN;
    if (!token) return json({ error: 'Bridge token not configured' }, 500);

    const params = new URLSearchParams({
        access_token: token,
        StandardStatus: 'Active',
        ListAgentMlsId: ROSA_MLS_AGENT_ID,
        sortBy: 'ListPrice',
        order: 'desc',
        limit: '50',
        fields: FIELDS,
    });

    const res = await fetch(`https://api.bridgedataoutput.com/api/v2/miamire/listings?${params}`);
    if (!res.ok) return json({ error: 'Bridge fetch failed', status: res.status }, 502);
    const data = await res.json();
    const listings = (data.bundle || data.value || []).map(r => ({
        mlsId:        r.ListingId,
        price:        r.ListPrice || 0,
        beds:         r.BedroomsTotal || 0,
        baths:        r.BathroomsTotalInteger || 0,
        sqft:         r.LivingArea || 0,
        propertyType: r.PropertySubType || '',
        address:      r.UnparsedAddress || '',
        city:         r.City || '',
        description:  (r.PublicRemarks || '').slice(0, 600),
        photo:        (r.Media || [])[0]?.MediaURL || null,
        photosCount:  r.PhotosCount || 0,
        status:       r.StandardStatus || '',
        idxAllowed:   (r.FeedTypes || []).includes('IDX'),
        url:          `https://homesinsoflorida.com/listing?id=${r.ListingId}`,
    }));
    return json({ count: listings.length, listings });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
