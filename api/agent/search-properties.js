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
 *   preconstruction    — "true" → only new-development inventory (New Construction
 *                        OR Under Construction per miamire PropertyCondition)
 *   constructionStatus — "New Construction" | "Under Construction" — narrow to one
 *                        stage (overrides preconstruction)
 *   status             — comma-sep StandardStatus list (default Active). Accepts
 *                        Active/Pending/ActiveUnderContract/"Coming Soon"/Closed
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
    'FeedTypes','PropertyCondition','NewConstructionYN',
].join(',');

// miamire MLS marks preconstruction / new-development inventory via the
// PropertyCondition array. Verified live 2026-07-10: the only values in use are
// "New Construction" (~4,155 active) and "Under Construction" (~1,188 active);
// "Preconstruction"/"Proposed"/"To Be Built" return 0. NewConstructionYN is a
// separate boolean (~3,289 active) that overlaps but is NOT identical.
const PRECON_CONDITIONS = ['New Construction', 'Under Construction'];
const STATUS_ALIAS = {
    'active': 'Active', 'pending': 'Pending', 'closed': 'Closed',
    'undercontract': 'ActiveUnderContract', 'activeundercontract': 'ActiveUnderContract',
    'comingsoon': 'Coming Soon', 'coming soon': 'Coming Soon',
};

const PROPERTY_TYPE_ALIAS = {
    'sfh':       'Single Family Residence',
    'sf':        'Single Family Residence',
    'house':     'Single Family Residence',
    // Airtable alert-profile vocabulary (Alert Property Types multi-select) — the
    // drip/blast/button engines pass these values verbatim; an unmapped value
    // becomes a PropertySubType Bridge doesn't know and the send silently finds
    // 0 matches (Cristian Rojas 2026-07-13). Keep in sync with lib/alert-search.js TYPE_MAP.
    'single family': 'Single Family Residence',
    'multi family':  'Multi Family',
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
        // Pool is post-filtered (see below) — over-fetch 3x so the caller still gets
        // ~their asked count after non-pool rows are dropped.
        limit:          String(Math.min((parseInt(q.get('limit') || '25', 10) || 25) * (q.get('pool') === 'true' ? 3 : 1), 100)),
        sortBy:         'ModificationTimestamp',
        order:          'desc',
        fields:         FEATURE_FIELDS,
    });

    // Status — defaults to Active (for-sale). Accepts a comma-separated list of
    // Active / Pending / ActiveUnderContract / "Coming Soon" / Closed (aliases ok).
    const statusRaw = (q.get('status') || '').split(',').map(s => s.trim()).filter(Boolean);
    const statuses = statusRaw.map(s => STATUS_ALIAS[s.toLowerCase()] || s);
    if (statuses.length === 1)      params.set('StandardStatus', statuses[0]);
    else if (statuses.length > 1)   params.set('StandardStatus.in', statuses.join(','));
    else                            params.set('StandardStatus', 'Active');

    // Sort
    const sort = q.get('sort');
    if (sort === 'price_low')  { params.set('sortBy', 'ListPrice'); params.set('order', 'asc'); }
    if (sort === 'price_high') { params.set('sortBy', 'ListPrice'); params.set('order', 'desc'); }
    if (sort === 'sqft')       { params.set('sortBy', 'LivingArea'); params.set('order', 'desc'); }

    // PropertyType — FOR-SALE only, always. PropertyType=Residential is set even
    // when a PropertySubType filter is given: subtypes like "Condominium" also
    // exist under "Residential Lease", so dropping the Residential guard let
    // RENTALS leak into lead sends (Kevin 2026-07-02, Carlos Dennis drip).
    params.set('PropertyType', 'Residential');
    const propTypeRaw = q.get('propertyType');
    if (propTypeRaw) {
        const normalized = PROPERTY_TYPE_ALIAS[propTypeRaw.toLowerCase()] || propTypeRaw;
        params.set('PropertySubType', normalized);
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

    // Waterfront — prefilter at API level
    if (q.get('waterfront') === 'true') params.set('WaterfrontYN', 'true');
    // Pool is a POST-filter, never a Bridge prefilter: PoolPrivateYN is false on many
    // real pool homes in this feed (e.g. A12036650 Marlin Dr and A12017311 Genoa St —
    // both with in-ground pools per PoolFeatures + remarks, both PoolPrivateYN=false),
    // so filtering on it returned 0 for "Coral Gables pool homes" that exist. The
    // response's own `pool` field maps from PoolFeatures (reliable); filter on that
    // after mapping. Found 2026-08-26 via Gabriel Carrion.
    const wantPool = q.get('pool') === 'true';

    // Preconstruction / new-development filter.
    //   preconstruction=true  → New Construction OR Under Construction
    //   constructionStatus=…  → narrow to ONE stage ("New Construction" |
    //                           "Under Construction"); overrides preconstruction.
    const conStatusRaw = (q.get('constructionStatus') || '').trim();
    const conStatus = STATUS_ALIAS[conStatusRaw.toLowerCase()] // reuse spacing/case norms
        || PRECON_CONDITIONS.find(c => c.toLowerCase() === conStatusRaw.toLowerCase())
        || conStatusRaw;
    if (conStatus) {
        params.set('PropertyCondition', conStatus);           // array-contains match
    } else if (q.get('preconstruction') === 'true') {
        params.set('PropertyCondition.in', PRECON_CONDITIONS.join(','));
    }

    const res = await fetch(
        `https://api.bridgedataoutput.com/api/v2/miamire/listings?${params}`
    );
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        return json({ error: 'Bridge API error', status: res.status, detail: txt.slice(0, 300) }, 502);
    }
    const data = await res.json();
    const records = data.bundle || data.value || [];

    let listings = records.map(r => ({
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
        constructionStatus: r.PropertyCondition || [],
        preconstruction: (r.PropertyCondition || []).some(c => PRECON_CONDITIONS.includes(c)) || !!r.NewConstructionYN,
        newConstruction: !!r.NewConstructionYN,
        completionYear: (((r.PropertyCondition || []).some(c => PRECON_CONDITIONS.includes(c))) && r.YearBuilt) ? r.YearBuilt : null,
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
    if (wantPool) listings = listings.filter(l => l.pool);

    return json({ count: listings.length, listings });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
