/**
 * lib/bridge-listing.js — fetch one or many MLS listings from Bridge by ListingId.
 *
 * Shared by api/agent/get-property.js (one full record) and
 * api/agent/derive-profile.js (a batch of light records). Bridge returns 400 on any
 * field that doesn't exist on the miamire schema, so callers pass a known-good
 * field list (FULL_FIELDS / LIGHT_FIELDS below) rather than guessing.
 */

export const FULL_FIELDS = [
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
];

// Enough to describe what a buyer looked at: where, how much, what kind, how big.
export const LIGHT_FIELDS = [
    'ListingId','ListPrice','City','PropertySubType','PropertyType',
    'BedroomsTotal','BathroomsTotalInteger','UnparsedAddress','StandardStatus',
];

const MLS_ID_RE = /^[A-Za-z0-9_-]{4,20}$/;

/**
 * Batch fetch by ListingId (max 50 per call; Bridge caps `limit` at 200 but the
 * `.in` list gets long). Unknown / malformed ids are dropped, not sent.
 * @returns {Promise<Map<string, object>>} ListingId → listing
 */
export async function fetchListingsByMls(token, ids, fields = LIGHT_FIELDS) {
    const clean = [...new Set((ids || []).map(s => String(s || '').trim()).filter(s => MLS_ID_RE.test(s)))].slice(0, 50);
    const out = new Map();
    if (!token || clean.length === 0) return out;
    const params = new URLSearchParams({
        access_token: token,
        'ListingId.in': clean.join(','),
        fields: fields.join(','),
        limit: String(clean.length),
    });
    const res = await fetch(`https://api.bridgedataoutput.com/api/v2/miamire/listings?${params}`);
    if (!res.ok) throw new Error(`Bridge ${res.status}`);
    const data = await res.json();
    for (const l of (data.bundle || data.value || [])) if (l && l.ListingId) out.set(l.ListingId, l);
    return out;
}

/** One listing with the full field set, or null when Bridge has no such id. */
export async function fetchListingByMls(token, mlsId, fields = FULL_FIELDS) {
    const m = await fetchListingsByMls(token, [mlsId], fields);
    return m.get(String(mlsId).trim()) || null;
}
