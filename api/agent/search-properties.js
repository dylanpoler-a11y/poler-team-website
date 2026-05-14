/**
 * /api/agent/search-properties.js — Vercel Edge Function
 * Search the Bridge MLS for active South Florida listings matching filters.
 *
 * Query params (all optional):
 *   city               — comma-separated list of cities (e.g. "Miami Beach,Sunny Isles")
 *   priceMin, priceMax — currency
 *   bedsMin, bathsMin  — integer
 *   sqftMin, sqftMax   — interior living area
 *   propertyType       — "Single Family Residence" | "Condominium" | "Townhouse" | etc
 *                        OR shorthand: "SFH" | "Condo" | "Townhome"
 *   waterfront         — "true" filters to waterfront-only
 *   pool               — "true" filters to private-pool-only
 *   yearBuiltMin       — integer, only listings with YearBuilt >= this
 *   yearBuiltMax       — integer, only listings with YearBuilt <= this
 *   listingId          — fetch one specific MLS#
 *   limit              — default 25, max 100
 *   sort               — "newest" (default), "price_low", "price_high", "sqft"
 *
 * Auth: Bearer token (or password)
 * Returns: { count, listings: [{ mlsId, address, city, price, beds, baths, sqft,
 *           pricePerSqft, lotSqft, propertyType, waterfront, pool, yearBuilt,
 *           description, photos[], lat, lng, url }] }
 */

export const config = { runtime: 'edge' };

import { authorize } from '../_auth.js';

const FEATURE_FIELDS = [
    'ListingId','ListingKey','ListPrice','City','PropertySubType',
    'BedroomsTotal','BathroomsTotalInteger','LivingArea','LotSizeSquareFeet',
    'AssociationFee','YearBuilt','Latitude','Longitude','PublicRemarks',
    'UnparsedAddress','WaterfrontYN','WaterfrontFeatures','View','PoolFeatures',
    'PatioAndPorchFeatures','CommunityFeatures','AssociationAmenities',
    'MIAMIRE_Restrictions','ArchitecturalStyle','Media','ListOfficeName',
    'ModificationTimestamp','PropertyType','StandardStatus','PhotosCount',
    'FeedTypes',
].join(',');

const PROPERTY_TYPE_ALIAS = {
    'sfh':       'Single Family Residence',
    'sf':        'Single Family Residence',
    'house':     'Single Family Residence',
    'condo':     'Condominium',
    'condominium': 'Condominium',
    'townhome':  'Townhouse',
    'townhouse': 'Townhouse',
};

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            },
        });
    }
    if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

    if (!authorize(req, null).ok) return json({ error: 'Unauthorized' }, 401);

    const bridgeToken = process.env.BRIDGE_API_TOKEN;
    if (!bridgeToken) return json({ error: 'Bridge MLS not configured' }, 500);

    const url = new URL(req.url);
    const q = url.searchParams;

    const params = new URLSearchParams({
        access_token:   bridgeToken,
        limit:          String(Math.min(parseInt(q.get('limit') || '25', 10) || 25, 100)),
        sortBy:         'ModificationTimestamp',
        order:          'desc',
        StandardStatus: 'Active',
        fields:         FEATURE_FIELDS,
    });

    // Sort
    const sort = q.get('sort');
    if (sort === 'price_low')  { params.set('sortBy', 'ListPrice'); params.set('order', 'asc'); }
    if (sort === 'price_high') { params.set('sortBy', 'ListPrice'); params.set('order', 'desc'); }
    if (sort === 'sqft')       { params.set('sortBy', 'LivingArea'); params.set('order', 'desc'); }

    // PropertyType
    const propTypeRaw = q.get('propertyType');
    if (propTypeRaw) {
        const normalized = PROPERTY_TYPE_ALIAS[propTypeRaw.toLowerCase()] || propTypeRaw;
        params.set('PropertySubType', normalized);
    } else {
        params.set('PropertyType', 'Residential');
    }

    // Specific listing
    const listingId = q.get('listingId');
    if (listingId) params.set('ListingId', listingId);

    // Cities (Bridge accepts comma-separated via City.in)
    const cities = q.get('city');
    if (cities) {
        const list = cities.split(',').map(s => s.trim()).filter(Boolean);
        if (list.length === 1) params.set('City', list[0]);
        else if (list.length > 1) params.set('City.in', list.join(','));
    }

    // Price / beds / baths / sqft
    const priceMin = parseInt(q.get('priceMin') || '', 10);
    const priceMax = parseInt(q.get('priceMax') || '', 10);
    const bedsMin  = parseInt(q.get('bedsMin')  || '', 10);
    const bathsMin = parseInt(q.get('bathsMin') || '', 10);
    const sqftMin  = parseInt(q.get('sqftMin')  || '', 10);
    const sqftMax  = parseInt(q.get('sqftMax')  || '', 10);
    if (priceMin > 0) params.set('ListPrice.gte', String(priceMin));
    if (priceMax > 0) params.set('ListPrice.lte', String(priceMax));
    if (bedsMin  > 0) params.set('BedroomsTotal.gte', String(bedsMin));
    if (bathsMin > 0) params.set('BathroomsTotalInteger.gte', String(bathsMin));
    if (sqftMin  > 0) params.set('LivingArea.gte', String(sqftMin));
    if (sqftMax  > 0) params.set('LivingArea.lte', String(sqftMax));

    const yearBuiltMin = parseInt(q.get('yearBuiltMin') || '', 10);
    const yearBuiltMax = parseInt(q.get('yearBuiltMax') || '', 10);
    if (yearBuiltMin > 0) params.set('YearBuilt.gte', String(yearBuiltMin));
    if (yearBuiltMax > 0) params.set('YearBuilt.lte', String(yearBuiltMax));

    // Waterfront / pool — prefilter at API level
    if (q.get('waterfront') === 'true') params.set('WaterfrontYN', 'true');
    if (q.get('pool') === 'true')       params.set('PoolPrivateYN', 'true');

    const res = await fetch(
        `https://api.bridgedataoutput.com/api/v2/miamire/listings?${params}`
    );
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        return json({ error: 'Bridge API error', status: res.status, detail: txt.slice(0, 300) }, 502);
    }
    const data = await res.json();
    const records = data.bundle || data.value || [];

    const listings = records.map(r => ({
        mlsId:        r.ListingId || '',
        address:      r.UnparsedAddress || '',
        city:         r.City || '',
        price:        r.ListPrice || 0,
        beds:         r.BedroomsTotal || 0,
        baths:        r.BathroomsTotalInteger || 0,
        sqft:         r.LivingArea || 0,
        pricePerSqft: r.LivingArea > 0 ? Math.round((r.ListPrice || 0) / r.LivingArea) : 0,
        lotSqft:      r.LotSizeSquareFeet || 0,
        propertyType: r.PropertySubType || r.PropertyType || '',
        waterfront:   !!r.WaterfrontYN,
        waterfrontFeatures: r.WaterfrontFeatures || [],
        pool:         (r.PoolFeatures || []).length > 0,
        yearBuilt:    r.YearBuilt || null,
        hoa:          r.AssociationFee || null,
        description:  (r.PublicRemarks || '').slice(0, 600),
        photos:       (r.Media || []).slice(0, 6).map(m => m.MediaURL || m.MediaThumbnailURL).filter(Boolean),
        photosCount:  r.PhotosCount || 0,
        lat:          r.Latitude || null,
        lng:          r.Longitude || null,
        listOffice:   r.ListOfficeName || '',
        idxAllowed:   (r.FeedTypes || []).includes('IDX'),
        url:          r.ListingId ? `https://homesinsoflorida.com/listing?id=${r.ListingId}` : '',
    }));

    return json({ count: listings.length, listings });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
