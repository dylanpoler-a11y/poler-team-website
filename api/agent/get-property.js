/**
 * /api/agent/get-property.js — Full Bridge MLS details for one listing.
 * Body: { mlsId } or query ?mlsId=
 */

export const config = { runtime: 'edge' };

import { authorize } from '../_auth.js';

// Bridge MLS fields that actually exist. Removed:
//   UnparsedFirstLineAddress, MIAMIRE_TypeofGoverningBodies, MIAMIRE_LPAmtSqFt
// (Bridge returns 400 BadRequest if any field doesn't exist on the schema.)
const FULL_FIELDS = [
    'ListingId','ListingKey','ListPrice','City','PropertySubType','PropertyType',
    'BedroomsTotal','BathroomsTotalInteger','LivingArea','LotSizeSquareFeet','LotSizeAcres',
    'AssociationFee','AssociationAmenities','YearBuilt','Latitude','Longitude','PublicRemarks',
    'UnparsedAddress','PostalCode','StateOrProvince','CountyOrParish',
    'WaterfrontYN','WaterfrontFeatures','View','PoolFeatures','PoolPrivateYN',
    'PatioAndPorchFeatures','CommunityFeatures','MIAMIRE_Restrictions',
    'ArchitecturalStyle','Media','ListOfficeName','ListAgentFullName','ListAgentEmail','ListAgentDirectPhone',
    'ModificationTimestamp','CloseDate','OnMarketDate','DaysOnMarket',
    'PhotosCount','FeedTypes','StandardStatus','PreviousListPrice','OriginalListPrice',
    'TaxAnnualAmount','TaxYear','ParcelNumber','StreetName','StreetNumber',
].join(',');

export default async function handler(req) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors() });
    if (!['GET','POST'].includes(req.method)) return json({ error: 'Method not allowed' }, 405);

    let mlsId;
    if (req.method === 'GET') {
        mlsId = new URL(req.url).searchParams.get('mlsId');
        if (!authorize(req, null).ok) return json({ error: 'Unauthorized' }, 401);
    } else {
        let body;
        try { body = await req.json(); } catch { return json({ error: 'Bad body' }, 400); }
        if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);
        mlsId = body.mlsId;
    }
    if (!mlsId) return json({ error: 'mlsId required' }, 400);

    const token = process.env.BRIDGE_API_TOKEN;
    const res = await fetch(
        `https://api.bridgedataoutput.com/api/v2/miamire/listings?access_token=${token}&ListingId=${mlsId}&fields=${FULL_FIELDS}`
    );
    if (!res.ok) return json({ error: 'Bridge fetch failed', status: res.status }, 502);
    const data = await res.json();
    const listing = (data.bundle || data.value || [])[0];
    if (!listing) return json({ error: 'Listing not found' }, 404);

    return json({ listing });
}

function cors() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
}
function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
