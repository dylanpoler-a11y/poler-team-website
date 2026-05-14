/**
 * /api/agent/list-rosa-listings.js
 * Returns Rosa Poler's active MLS listings (filtered by ListAgentEmail).
 */

export const config = { runtime: 'edge' };

import { authorize } from '../_auth.js';

const FIELDS = [
    'ListingId','ListPrice','City','PropertySubType','BedroomsTotal','BathroomsTotalInteger',
    'LivingArea','LotSizeSquareFeet','UnparsedAddress','PublicRemarks','Media','PhotosCount',
    'StandardStatus','FeedTypes','ListAgentEmail','ModificationTimestamp',
].join(',');

// Rosa's MLS agent ID — more reliable than email (Bridge stores her listings under
// rosapoler@hotmail.com, not her primary contact email). The MLS ID never changes.
const ROSA_MLS_AGENT_ID = '3268052';

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

    const token = process.env.BRIDGE_API_TOKEN;
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
        description:  (r.PublicRemarks || '').slice(0, 400),
        photo:        (r.Media || [])[0]?.MediaURL || null,
        photosCount:  r.PhotosCount || 0,
        idxAllowed:   (r.FeedTypes || []).includes('IDX'),
        url:          `https://homesinsoflorida.com/listing?id=${r.ListingId}`,
    }));

    return json({ count: listings.length, listings });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
