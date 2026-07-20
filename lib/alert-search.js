/**
 * lib/alert-search.js — Single source of truth for property-alert search.
 *
 * Used by:
 *   - api/send-alerts.js       (daily cron)
 *   - api/send-test-alert.js   (CRM manual preview)
 *   - api/agent/audit-alerts.js (read-only audit across all leads)
 *
 * Returns an instrumented result so callers can tell WHY a search returned 0:
 *
 *   {
 *     listings: Listing[],           // final, deduped, capped to count
 *     debug: {
 *       perProfile: [
 *         {
 *           name, types, cities, priceMin, priceMax, bedsMin, bathsMin,
 *           features, polygonPresent, polygonValid,
 *           bridgeRequests,          // # of city × type requests fired
 *           rawBridge,               // raw listings returned by Bridge (pre-dedupe)
 *           afterFeature,
 *           afterKeyword,
 *           afterPolygon,
 *           droppedBy,               // 'feature' | 'keyword' | 'polygon' | 'bridge' | null
 *         }
 *       ],
 *       totalRawBridge,
 *       totalAfterDedupe,
 *       finalCount,
 *       droppedBy,                   // overall: which step zeroed the lead out
 *     }
 *   }
 */

const SOUTH_FL_CITIES = [
    { name: 'Miami Beach', lat: 25.790, lng: -80.130 },
    { name: 'Sunny Isles Beach', lat: 25.951, lng: -80.123 },
    { name: 'Aventura', lat: 25.956, lng: -80.139 },
    { name: 'Hallandale Beach', lat: 25.981, lng: -80.148 },
    { name: 'Hollywood', lat: 26.011, lng: -80.149 },
    { name: 'Fort Lauderdale', lat: 26.122, lng: -80.137 },
    { name: 'North Miami Beach', lat: 25.933, lng: -80.162 },
    { name: 'North Miami', lat: 25.890, lng: -80.186 },
    { name: 'Miami', lat: 25.761, lng: -80.191 },
    { name: 'Coral Gables', lat: 25.721, lng: -80.268 },
    { name: 'Doral', lat: 25.819, lng: -80.355 },
    { name: 'Hialeah', lat: 25.857, lng: -80.278 },
    { name: 'Miami Gardens', lat: 25.942, lng: -80.245 },
    { name: 'Bal Harbour', lat: 25.891, lng: -80.127 },
    { name: 'Surfside', lat: 25.878, lng: -80.126 },
    { name: 'Bay Harbor Islands', lat: 25.887, lng: -80.131 },
    { name: 'Key Biscayne', lat: 25.693, lng: -80.163 },
    { name: 'Brickell', lat: 25.759, lng: -80.192 },
    { name: 'Coconut Grove', lat: 25.714, lng: -80.241 },
    { name: 'Pompano Beach', lat: 26.237, lng: -80.124 },
    { name: 'Boca Raton', lat: 26.358, lng: -80.083 },
    { name: 'Deerfield Beach', lat: 26.318, lng: -80.099 },
    { name: 'Lauderdale By The Sea', lat: 26.192, lng: -80.096 },
    { name: 'Oakland Park', lat: 26.172, lng: -80.132 },
    { name: 'Wilton Manors', lat: 26.160, lng: -80.139 },
    { name: 'Opa Locka', lat: 25.902, lng: -80.250 },
    { name: 'Homestead', lat: 25.468, lng: -80.477 },
    { name: 'Kendall', lat: 25.679, lng: -80.317 },
    { name: 'Palmetto Bay', lat: 25.621, lng: -80.325 },
    { name: 'Pinecrest', lat: 25.665, lng: -80.308 },
];

const TYPE_MAP = {
    'Single Family': 'Single Family Residence',
    'Condo':         'Condominium',
    'Townhouse':     'Townhouse',
    'Multi Family':  'Multi Family',
};

// Profile type 'Land' queries PropertyType=Land/Boat Docks instead of Residential.
// Verified against the live feed 2026-07-03: 4,442 active listings whose PropertySubType
// splits into Residential (lots) + Agriculture (Redlands-style acreage) + 1 Dockominium —
// querying the two real land subtypes explicitly keeps boat docks out of buyer alerts.
const LAND_PROPERTY_TYPE = 'Land/Boat Docks';
const LAND_SUBTYPES = ['Residential', 'Agriculture'];

const FEATURE_FIELDS = [
    'ListingId','ListingKey','ListPrice','City','PropertySubType',
    'BedroomsTotal','BathroomsTotalInteger','LivingArea','LotSizeSquareFeet',
    'AssociationFee','YearBuilt','Latitude','Longitude','PublicRemarks',
    'UnparsedAddress','WaterfrontYN','WaterfrontFeatures','View','PoolFeatures',
    'PatioAndPorchFeatures','CommunityFeatures','AssociationAmenities',
    'MIAMIRE_Restrictions','ArchitecturalStyle','Media','ListOfficeName',
    'ModificationTimestamp','StateOrProvince','PropertyCondition',
].join(',');

// The miamire feed marks preconstruction via the PropertyCondition array; only these
// two values are in live use ("Preconstruction"/"Proposed"/"To Be Built" = 0, probed
// 2026-07-10). Same filter search_preconstructions uses.
const PRECON_CONDITIONS = ['New Construction', 'Under Construction'];

function toTitleCase(str) {
    return String(str || '').toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
}

function getCitiesNearPoint(lat, lng) {
    const maxDist = 15; // km
    const nearby = SOUTH_FL_CITIES
        .map(c => ({
            name: c.name,
            dist: Math.sqrt(
                Math.pow((c.lat - lat) * 111, 2) +
                Math.pow((c.lng - lng) * 111 * Math.cos(lat * Math.PI / 180), 2),
            ),
        }))
        .filter(c => c.dist < maxDist)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 8)
        .map(c => c.name);
    return nearby.length > 0
        ? nearby
        : ['Miami Beach', 'Sunny Isles Beach', 'Aventura', 'North Miami Beach', 'Fort Lauderdale'];
}

// Ray-casting point-in-polygon. ring is GeoJSON: [[lng, lat], ...]
function pointInPolygon(lat, lng, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][1], yi = ring[i][0];
        const xj = ring[j][1], yj = ring[j][0];
        if ((yi > lng) !== (yj > lng) && lat < (xj - xi) * (lng - yi) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

function parsePolygonRings(polyStr) {
    if (!polyStr) return { rings: [], valid: false };
    try {
        const geo = JSON.parse(polyStr);
        let rings = [];
        if (Array.isArray(geo)) {
            rings = geo
                .filter(g => g && g.type === 'Polygon' && g.coordinates)
                .map(g => g.coordinates[0]);
        } else if (geo && geo.type === 'Polygon' && geo.coordinates) {
            rings = [geo.coordinates[0]];
        }
        const valid = rings.length > 0 && rings.every(r => Array.isArray(r) && r.length >= 3);
        return { rings, valid };
    } catch {
        return { rings: [], valid: false };
    }
}

function matchesFeature(listing, feature) {
    const arrContains = (arr, ...terms) => {
        if (!Array.isArray(arr)) return false;
        const lower = arr.map(s => (s || '').toLowerCase());
        return terms.some(t => lower.some(v => v.includes(t.toLowerCase())));
    };
    const remarks = (listing.PublicRemarks || '').toLowerCase();
    switch (feature) {
        case 'Waterfront / Ocean View':
            return listing.WaterfrontYN === true
                || arrContains(listing.View, 'ocean', 'water', 'bay', 'intracoastal', 'lake')
                || arrContains(listing.WaterfrontFeatures, 'ocean', 'water', 'bay', 'lake', 'canal');
        case 'Waterfront / Beach':
            return arrContains(listing.WaterfrontFeatures, 'ocean', 'beach')
                || arrContains(listing.View, 'ocean', 'beach', 'direct ocean');
        case 'Waterfront / Bay':
            return arrContains(listing.WaterfrontFeatures, 'bay', 'intracoastal')
                || arrContains(listing.View, 'bay', 'intracoastal');
        case 'Waterfront / Lake':
            return arrContains(listing.WaterfrontFeatures, 'lake')
                || arrContains(listing.View, 'lake')
                || remarks.includes('lake');
        case 'Waterfront / Canal':
            return arrContains(listing.WaterfrontFeatures, 'canal')
                || arrContains(listing.View, 'canal');
        case 'Balcony / Terrace':
            return arrContains(listing.PatioAndPorchFeatures, 'balcony', 'terrace', 'deck', 'lanai');
        case 'Pool':
            return Array.isArray(listing.PoolFeatures) && listing.PoolFeatures.length > 0;
        case 'Short-Term Rental Allowed': {
            const restrictions = listing.MIAMIRE_Restrictions || [];
            const hasDaily = arrContains(restrictions, 'Daily Rentals Allowed');
            const noRestrictions = arrContains(restrictions, 'No Restrictions');
            const noDaily = arrContains(restrictions, 'No Daily Rentals');
            const strInRemarks = remarks.includes('short term rental')
                || remarks.includes('short-term rental')
                || remarks.includes('airbnb')
                || remarks.includes('vrbo')
                || remarks.includes('daily rental')
                || remarks.includes('hotel program')
                || remarks.includes('nightly rental');
            if (noDaily) return false;
            if (hasDaily || noRestrictions || strInRemarks) return true;
            return false;
        }
        case 'Gated Community':
            return arrContains(listing.CommunityFeatures || listing.AssociationAmenities, 'gated', 'guard', 'security')
                || remarks.includes('gated') || remarks.includes('guard gate') || remarks.includes('private community');
        case 'Golf Course':
            return arrContains(listing.CommunityFeatures || listing.AssociationAmenities, 'golf')
                || remarks.includes('golf');
        case 'Large Lot':
            return (listing.LotSizeSquareFeet && listing.LotSizeSquareFeet >= 21780);
        case 'High Rise':
            return arrContains(listing.ArchitecturalStyle, 'high rise', 'highrise');
        case 'Penthouse':
            return arrContains(listing.ArchitecturalStyle, 'penthouse') || remarks.includes('penthouse');
        case 'No HOA': {
            const fee = parseFloat(listing.AssociationFee);
            return !fee || fee === 0;
        }
        case 'Preconstruction':
            return arrContains(listing.PropertyCondition, ...PRECON_CONDITIONS);
        default:
            return true;
    }
}

// Run the Bridge query for a SINGLE profile and return raw + filtered listings + per-step counts.
async function searchProfile(bridgeToken, profile, profileMeta) {
    // Split on comma OR newline — Airtable holds comma-separated values when typed in the
    // CRM UI, but legacy API writes stored newline-joined cities; a comma-only split glued
    // those into ONE unmatchable Bridge City → silent zero-match alerts (found 2026-07-16).
    const cities = (profile.cities || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean).map(toTitleCase);
    const count = profile.count || 5;
    const features = profile.features || [];
    const hasPolygon = !!profile.polygon;
    const hasFeatures = features.length > 0;
    const hasKeywords = !!profile.keywords;
    const needsClientFilter = hasPolygon || hasFeatures || hasKeywords;
    const isRental = (profile.types || []).includes('For Rent');

    const baseParams = new URLSearchParams({
        access_token:   bridgeToken,
        // Fetch a WIDE window (not just count*2) so the caller can exclude
        // already-sent listings and still have a large fresh pool to draw from —
        // otherwise the same handful of most-recently-modified listings recycle
        // every send and leads see repeats (José Bendayan, 2026-07-15).
        limit:          String(needsClientFilter ? 200 : 150),
        sortBy:         'ModificationTimestamp',
        order:          'desc',
        PropertyType:   isRental ? 'Residential Lease' : 'Residential',
        StandardStatus: 'Active',
        fields:         FEATURE_FIELDS,
    });

    const waterfrontFeats = features.filter(f => f.startsWith('Waterfront'));
    if (waterfrontFeats.length > 0) baseParams.set('WaterfrontYN', 'true');
    if (features.includes('Pool')) baseParams.set('PoolPrivateYN', 'true');
    // Push preconstruction to the API level so the whole fetch window is precon
    // inventory (client-side matchesFeature alone would filter a mostly-resale window).
    if (features.includes('Preconstruction')) {
        baseParams.set('PropertyCondition.in', PRECON_CONDITIONS.join(','));
    }

    if (profile.priceMin > 0) baseParams.set('ListPrice.gte', String(profile.priceMin));
    if (profile.priceMax > 0) baseParams.set('ListPrice.lte', String(profile.priceMax));
    if (profile.bedsMin > 0) baseParams.set('BedroomsTotal.gte', String(profile.bedsMin));
    if (profile.bathsMin > 0) baseParams.set('BathroomsTotalInteger.gte', String(profile.bathsMin));
    if (profile.sqftMin > 0) baseParams.set('LivingArea.gte', String(profile.sqftMin));
    if (profile.sqftMax > 0) baseParams.set('LivingArea.lte', String(profile.sqftMax));
    if (profile.lotSizeMin > 0) baseParams.set('LotSizeSquareFeet.gte', String(profile.lotSizeMin));
    if (profile.hoaMin > 0) baseParams.set('AssociationFee.gte', String(profile.hoaMin));
    if (profile.hoaMax > 0) baseParams.set('AssociationFee.lte', String(profile.hoaMax));
    if (profile.yearBuiltMin > 0) baseParams.set('YearBuilt.gte', String(profile.yearBuiltMin));

    // Polygon → derive cities from bounding-box center when no explicit city set
    const polyParsed = parsePolygonRings(profile.polygon);
    let polygonCities = [];
    if (hasPolygon && polyParsed.valid && cities.length === 0) {
        const allCoords = polyParsed.rings.flat();
        if (allCoords.length > 0) {
            const lats = allCoords.map(c => c[1]);
            const lngs = allCoords.map(c => c[0]);
            const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
            const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
            polygonCities = getCitiesNearPoint(centerLat, centerLng);
        }
    }

    const rawTypes = (profile.types || []).filter(t => t !== 'For Rent');
    const wantsLand = rawTypes.includes('Land');
    const mappedTypes = rawTypes
        .filter(t => t !== 'Land')
        .map(t => TYPE_MAP[t] || t)
        .filter(Boolean);
    const effectiveCities = cities.length > 0 ? cities : (polygonCities.length > 0 ? polygonCities : [null]);

    const requests = [];
    for (const city of effectiveCities) {
        if (mappedTypes.length > 0 || wantsLand) {
            for (const subType of mappedTypes) {
                const p = new URLSearchParams(baseParams);
                p.set('PropertySubType', subType);
                if (city) p.set('City', city);
                requests.push(p);
            }
            if (wantsLand) {
                for (const landSub of LAND_SUBTYPES) {
                    const p = new URLSearchParams(baseParams);
                    p.set('PropertyType', LAND_PROPERTY_TYPE);
                    p.set('PropertySubType', landSub);
                    // Vacant land has no beds/baths/living area/year built — leaving the
                    // residential filters on would zero out every land match.
                    p.delete('BedroomsTotal.gte');
                    p.delete('BathroomsTotalInteger.gte');
                    p.delete('LivingArea.gte');
                    p.delete('LivingArea.lte');
                    p.delete('YearBuilt.gte');
                    if (city) p.set('City', city);
                    requests.push(p);
                }
            }
        } else {
            const p = new URLSearchParams(baseParams);
            if (city) p.set('City', city);
            requests.push(p);
        }
    }

    const results = await Promise.all(
        requests.map(p =>
            fetch(`https://api.bridgedataoutput.com/api/v2/miamire/listings?${p}`)
                .then(r => r.ok ? r.json() : { bundle: [] })
                .then(d => (d.success !== false && Array.isArray(d.bundle)) ? d.bundle : [])
                .catch(() => [])
        )
    );

    let all = results.flat();
    all.sort((a, b) => new Date(b.ModificationTimestamp || 0) - new Date(a.ModificationTimestamp || 0));

    const seen = new Set();
    const unique = [];
    for (const l of all) {
        if (!seen.has(l.ListingId)) {
            seen.add(l.ListingId);
            unique.push(l);
        }
    }
    const rawBridge = unique.length;

    // Feature filter
    let filtered = unique;
    if (hasFeatures) {
        filtered = filtered.filter(l => features.every(feat => matchesFeature(l, feat)));
    }
    const afterFeature = filtered.length;

    // Keyword filter
    if (hasKeywords) {
        const kws = profile.keywords.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
        if (kws.length > 0) {
            const joinField = v => v ? (Array.isArray(v) ? v.join(' ') : String(v)) : '';
            filtered = filtered.filter(l => {
                const searchText = [
                    l.PublicRemarks || '',
                    joinField(l.ArchitecturalStyle),
                    joinField(l.CommunityFeatures),
                    joinField(l.AssociationAmenities),
                    joinField(l.MIAMIRE_Restrictions),
                ].join(' ').toLowerCase();
                return kws.some(kw => searchText.includes(kw));
            });
        }
    }
    const afterKeyword = filtered.length;

    // Polygon filter
    if (hasPolygon && polyParsed.valid) {
        filtered = filtered.filter(l => {
            const lat = l.Latitude;
            const lng = l.Longitude;
            if (lat == null || lng == null) return true; // don't penalize missing coords
            return polyParsed.rings.some(ring => pointInPolygon(lat, lng, ring));
        });
    }
    const afterPolygon = filtered.length;

    // Identify which step zeroed it out (first step from raw that hit 0)
    let droppedBy = null;
    if (rawBridge === 0) droppedBy = 'bridge';
    else if (hasFeatures && afterFeature === 0) droppedBy = 'feature';
    else if (hasKeywords && afterKeyword === 0) droppedBy = 'keyword';
    else if (hasPolygon && afterPolygon === 0) droppedBy = 'polygon';

    return {
        listings: filtered,
        debug: {
            name: profileMeta?.name || 'default',
            types: profile.types || [],
            cities: cities,
            polygonCities: polygonCities,
            priceMin: profile.priceMin || 0,
            priceMax: profile.priceMax || 0,
            bedsMin: profile.bedsMin || 0,
            bathsMin: profile.bathsMin || 0,
            features: features,
            polygonPresent: hasPolygon,
            polygonValid: hasPolygon ? polyParsed.valid : null,
            bridgeRequests: requests.length,
            rawBridge,
            afterFeature,
            afterKeyword,
            afterPolygon,
            droppedBy,
            unmappedTypes: (profile.types || []).filter(t => t !== 'For Rent' && t !== 'Land' && !TYPE_MAP[t]),
        },
    };
}

// ── ALERT-PROFILES WRAPPER (backward-compatible) ───────────────────────────────
// The 'Alert Profiles' Airtable field stores EITHER:
//   • Legacy: a plain JSON array of profile objects  → channels = email-only.
//   • New:    { channels: {email, whatsapp}, profiles: [...] }.
// These helpers are the single source of truth for reading/writing that field so
// no consumer has to know which shape is on disk. (No new Airtable field — schema
// scope isn't available on the current PAT; see 2026-07-15 learning.)
const DEFAULT_CHANNELS = { email: true, whatsapp: false };

// Normalize a raw 'Alert Profiles' value (string OR already-parsed) to
// { channels: {email, whatsapp}, profiles: [...] }.
export function parseAlertProfiles(raw) {
    if (!raw) return { channels: { ...DEFAULT_CHANNELS }, profiles: [] };
    let parsed = raw;
    if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); }
        catch { return { channels: { ...DEFAULT_CHANNELS }, profiles: [] }; }
    }
    if (Array.isArray(parsed)) {
        return { channels: { ...DEFAULT_CHANNELS }, profiles: parsed };
    }
    if (parsed && typeof parsed === 'object') {
        const ch = parsed.channels || {};
        const profiles = Array.isArray(parsed.profiles) ? parsed.profiles : [];
        return { channels: { email: ch.email !== false, whatsapp: !!ch.whatsapp }, profiles };
    }
    return { channels: { ...DEFAULT_CHANNELS }, profiles: [] };
}

// Serialize back to a storable string. Writes the plain-array legacy shape when
// channels are the default (email-only) to avoid churning existing records; only
// promotes to the object wrapper when whatsapp is on or email is off.
export function serializeAlertProfiles(profiles, channels) {
    const list = Array.isArray(profiles) ? profiles.filter(p => p && typeof p === 'object') : [];
    const ch = {
        email:    channels ? channels.email !== false : true,
        whatsapp: !!(channels && channels.whatsapp),
    };
    const isDefault = ch.email === true && ch.whatsapp === false;
    if (isDefault) return list.length ? JSON.stringify(list) : '';
    return JSON.stringify({ channels: ch, profiles: list });
}

// Read a lead's delivery channels from its 'Alert Profiles' field.
// lead.profiles is the raw string (or object) from f['Alert Profiles'].
export function channelsFromLead(lead) {
    return parseAlertProfiles(lead && lead.profiles).channels;
}

// Build the list of profiles to fetch from a lead's Airtable record fields.
export function profilesFromLead(lead) {
    let profilesToFetch = [];
    if (lead.profiles) {
        const { profiles } = parseAlertProfiles(lead.profiles);
        if (Array.isArray(profiles) && profiles.length > 0) profilesToFetch = profiles;
    }
    if (profilesToFetch.length === 0) {
        profilesToFetch = [{
            types: lead.types,
            cities: lead.cities,
            priceMin: lead.priceMin,
            priceMax: lead.priceMax,
            bedsMin: lead.bedsMin,
            bathsMin: lead.bathsMin,
            polygon: lead.polygon,
        }];
    }
    return profilesToFetch;
}

// Main entry point. Returns { listings, debug }.
//   bridgeToken: Bridge API token
//   lead: object with .types, .cities, .priceMin, .priceMax, .bedsMin, .bathsMin,
//         .count, .polygon, .profiles (JSON string of multi-profile config)
//   options: { skipShuffle: bool, capCount: bool }
export async function searchListingsForLead(bridgeToken, lead, options = {}) {
    const profiles = profilesFromLead(lead);
    const perProfile = [];
    const perProfileListings = [];
    let allListings = [];

    for (const rawProfile of profiles) {
        const profile = {
            types:        rawProfile.types || lead.types,
            cities:       rawProfile.cities || lead.cities,
            priceMin:     rawProfile.priceMin || lead.priceMin,
            priceMax:     rawProfile.priceMax || lead.priceMax,
            bedsMin:      rawProfile.bedsMin || lead.bedsMin,
            bathsMin:     rawProfile.bathsMin || lead.bathsMin,
            polygon:      rawProfile.polygon || '',
            features:     rawProfile.features || [],
            sqftMin:      rawProfile.sqftMin || 0,
            sqftMax:      rawProfile.sqftMax || 0,
            lotSizeMin:   rawProfile.lotSizeMin || 0,
            hoaMin:       rawProfile.hoaMin || 0,
            hoaMax:       rawProfile.hoaMax || 0,
            yearBuiltMin: rawProfile.yearBuiltMin || 0,
            keywords:     rawProfile.keywords || '',
            count:        lead.count || 5,
        };
        const { listings, debug } = await searchProfile(bridgeToken, profile, { name: rawProfile.name });
        perProfile.push(debug);
        perProfileListings.push(listings);
        allListings.push(...listings);
    }

    // Dedup across profiles by ListingId
    const seen = new Set();
    let unique = allListings.filter(l => {
        if (seen.has(l.ListingId)) return false;
        seen.add(l.ListingId);
        return true;
    });
    const totalAfterDedupe = unique.length;

    if (!options.skipShuffle) {
        for (let i = unique.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [unique[i], unique[j]] = [unique[j], unique[i]];
        }
    }

    // Exclude already-sent listings so leads don't see repeats across emails.
    // Fresh (never-sent) listings lead; if the fresh pool is exhausted we fall
    // back to previously-sent ones so an email is never empty. The caller
    // supplies options.excludeIds (from the lead's Alert-Sent history).
    const excl = new Set(options.excludeIds || []);
    if (excl.size > 0) {
        const fresh = unique.filter(l => !excl.has(l.ListingId));
        const stale = unique.filter(l => excl.has(l.ListingId));
        unique = [...fresh, ...stale];
    }
    const totalFresh = unique.filter(l => !excl.has(l.ListingId)).length;

    const count = lead.count || 5;
    let finalListings;
    if (options.capCount === false) {
        finalListings = unique;
    } else if (perProfileListings.length > 1) {
        // Multi-profile fairness: when a lead runs >1 profile (e.g. houses AND land),
        // guarantee each profile with matches at least one slot in the capped email —
        // otherwise the shuffle lets the bigger pool (30 houses) crowd out the rare
        // land match nearly every send. Newest match per profile leads, shuffle fills.
        const picked = [];
        const pickedIds = new Set();
        for (const plist of perProfileListings) {
            // Prefer a fresh (never-sent) candidate per profile; fall back to any.
            const candidate = plist.find(l => l && !pickedIds.has(l.ListingId) && !excl.has(l.ListingId))
                           || plist.find(l => l && !pickedIds.has(l.ListingId));
            if (candidate) { picked.push(candidate); pickedIds.add(candidate.ListingId); }
        }
        const rest = unique.filter(l => !pickedIds.has(l.ListingId)); // unique already fresh-first
        finalListings = [...picked, ...rest].slice(0, count);
    } else {
        finalListings = unique.slice(0, count); // unique already fresh-first
    }

    // Overall droppedBy: if final is 0, surface the first profile's droppedBy that's non-null.
    // If every profile returned listings but dedupe stripped to 0 (impossible since dedupe never invents 0),
    // fall back to 'bridge'.
    let overallDroppedBy = null;
    if (finalListings.length === 0) {
        const profilesWithReason = perProfile.filter(p => p.droppedBy);
        if (profilesWithReason.length === perProfile.length && perProfile.length > 0) {
            // every profile failed; pick the most common reason
            const counts = {};
            for (const p of profilesWithReason) counts[p.droppedBy] = (counts[p.droppedBy] || 0) + 1;
            overallDroppedBy = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
        } else if (profilesWithReason.length > 0) {
            overallDroppedBy = profilesWithReason[0].droppedBy;
        } else {
            overallDroppedBy = 'unknown';
        }
    }

    const totalRawBridge = perProfile.reduce((a, p) => a + p.rawBridge, 0);

    return {
        listings: finalListings,
        pickedIds: finalListings.map(l => l.ListingId).filter(Boolean),
        debug: {
            perProfile,
            totalRawBridge,
            totalAfterDedupe,
            totalFresh,
            excludedCount: excl.size,
            finalCount: finalListings.length,
            droppedBy: overallDroppedBy,
        },
    };
}

// Human-readable explanation of a droppedBy reason — used in Airtable + CRM display.
export function explainDroppedBy(droppedBy, debug) {
    if (!droppedBy) return '';
    switch (droppedBy) {
        case 'bridge': {
            const profile = debug?.perProfile?.[0];
            const unmapped = profile?.unmappedTypes || [];
            if (unmapped.length > 0) {
                return `Bridge returned 0 — property type "${unmapped.join(', ')}" not in MIAMIRE feed (valid: Single Family, Condo, Townhouse, Multi Family, Land)`;
            }
            return 'Bridge MLS returned 0 matches for these filters';
        }
        case 'feature':
            return 'Bridge had matches but feature filter (pool/waterfront/etc) excluded all of them';
        case 'keyword':
            return 'Keyword filter excluded every match';
        case 'polygon':
            return 'Polygon (map area) excluded every match — area may be too small or in the wrong place';
        case 'unknown':
            return 'Unknown — likely empty profile or all-zero filters';
        default:
            return droppedBy;
    }
}
