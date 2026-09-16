/**
 * lib/derive-profile.js — PURE: turn what a lead did on the site into an alert profile.
 *
 * Kevin, 2026-09-16: "build the alert off the signup listing only if the person
 * doesn't search for more properties; if so build the alert with the properties he
 * searched and looked at. Send similar properties to the ones he's looking at
 * (price range, types of properties, areas)."
 *
 * Two bases:
 *   browsing — ≥ 2 distinct listings viewed, or any favorite, or any search.
 *              Favorites weigh most: when any exist, the price band and the types
 *              come from them and views only add cities. Explicit search filters
 *              (price min/max, subtypes, beds) override what the listings imply.
 *   signup   — only the ad listing was ever seen: its city, 70–120% of its price,
 *              its type, beds − 1.
 *
 * No I/O here so the rules are unit-testable; api/agent/derive-profile.js gathers
 * the inputs (Airtable + Bridge) and writes the result through the same
 * update-alerts field logic every other writer uses.
 */

// Bridge PropertySubType → the CRM's Alert Property Types vocabulary
// (crm.html checkboxes: Single Family / Condo / Townhouse / Multi Family / Land).
const SUBTYPE_TO_ALERT = {
    'single family residence': 'Single Family',
    'condominium':             'Condo',
    'apartment':               'Condo',
    'townhouse':               'Townhouse',
    'villa':                   'Townhouse',
    'multi family':            'Multi Family',
    'duplex':                  'Multi Family',
    'triplex':                 'Multi Family',
    'quadruplex':              'Multi Family',
};
export function alertTypeFor(listing) {
    if (!listing) return null;
    if (String(listing.PropertyType || '').toLowerCase().startsWith('land')) return 'Land';
    return SUBTYPE_TO_ALERT[String(listing.PropertySubType || '').toLowerCase()] || null;
}

const MAX_CITIES = 4;
const MAX_TYPES  = 3;
// With this many observations a value seen only once is noise (one stray click), not a preference.
const SINGLETON_DROP_AT = 6;

function roundPrice(n) {
    if (!(n > 0)) return 0;
    const step = n >= 1_000_000 ? 25_000 : n >= 200_000 ? 5_000 : 1_000;
    return Math.round(n / step) * step;
}

function uniq(arr) {
    const seen = new Set();
    return arr.filter(v => { const k = String(v).toLowerCase(); if (!v || seen.has(k)) return false; seen.add(k); return true; });
}

// Most-frequent-first, capped. Ties keep first-seen order. Once there are enough
// observations, values seen only once are dropped (unless nothing else remains).
function topByCount(values, cap) {
    const counts = new Map();
    let total = 0;
    for (const v of values) if (v) { counts.set(v, (counts.get(v) || 0) + 1); total++; }
    let entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (total >= SINGLETON_DROP_AT) {
        const repeated = entries.filter(e => e[1] >= 2);
        if (repeated.length) entries = repeated;
    }
    return entries.slice(0, cap).map(e => e[0]);
}

// Robust price core: with 4+ prices use the 25th–75th percentiles so one $50M click
// (or one $300k one) doesn't stretch the band across the whole market.
function priceCore(prices) {
    const sorted = [...prices].sort((a, b) => a - b);
    if (sorted.length < 4) return [sorted[0], sorted[sorted.length - 1]];
    const q = f => {
        const pos = (sorted.length - 1) * f, lo = Math.floor(pos), hi = Math.ceil(pos);
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
    };
    return [q(0.25), q(0.75)];
}

export function frequencyForTimeline(timeline) {
    const t = String(timeline || '').toLowerCase();
    if (t.includes('0-3') || t.includes('3-6')) return 'Weekly';
    if (t.includes('6-12')) return 'Bi-Weekly';
    return 'Monthly';
}

/** Parse one logged Search row's Details (listing.js buildSearchParams shape). */
export function parseSearchParams(details) {
    let d = details;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return null; } }
    const p = d && typeof d === 'object' ? (d.params && typeof d.params === 'object' ? d.params : d) : null;
    if (!p) return null;
    const out = {};
    if (Array.isArray(p._cities) && p._cities.length) out.cities = p._cities.map(s => String(s).trim()).filter(Boolean);
    const gte = Number(p['ListPrice.gte']); if (gte > 0) out.priceMin = gte;
    const lte = Number(p['ListPrice.lte']); if (lte > 0) out.priceMax = lte;
    const beds = Number(p['BedroomsTotal.gte']); if (beds > 0) out.bedsMin = beds;
    const sub = p['PropertySubType.in'] || p.PropertySubType;
    if (sub) {
        const types = String(sub).split(',').map(s => SUBTYPE_TO_ALERT[s.trim().toLowerCase()]).filter(Boolean);
        if (types.length) out.types = uniq(types);
    }
    if (String(p.PropertyType || '').toLowerCase().startsWith('land')) out.types = ['Land'];
    return Object.keys(out).length ? out : null;
}

/**
 * @param {object} p
 * @param {string[]} p.viewedIds     distinct MLS ids the lead viewed (newest first)
 * @param {string[]} p.favoriteIds   MLS ids the lead saved
 * @param {object[]} p.searches      parsed search filters (parseSearchParams), newest first
 * @param {string|null} p.sourceMls  the listing the lead signed up on
 * @param {Map<string,object>} p.listings  ListingId → Bridge listing (LIGHT_FIELDS)
 * @param {string} p.timeline        Airtable Timeline value
 * @returns {{basis:'browsing'|'signup', profile:object, sources:string[], summary:object}|null}
 */
export function deriveAutoProfile({ viewedIds = [], favoriteIds = [], searches = [], sourceMls = null, listings = new Map(), timeline = '' }) {
    const get = id => listings.get(id) || null;
    const viewed = uniq(viewedIds).map(get).filter(Boolean);
    const favs   = uniq(favoriteIds).map(get).filter(Boolean);
    const distinctSeen = uniq([...viewedIds, ...favoriteIds]).length;
    const hasSearch = searches.some(Boolean);
    const browsing = distinctSeen >= 2 || favs.length > 0 || hasSearch;

    let basisListings, cities, basis;
    if (browsing) {
        basis = 'browsing';
        basisListings = favs.length ? favs : viewed;
        cities = topByCount([
            ...favs.map(l => l.City),
            ...viewed.map(l => l.City),
            ...searches.flatMap(s => (s && s.cities) || []),
        ].map(c => String(c || '').trim()).filter(Boolean), MAX_CITIES);
    } else {
        basis = 'signup';
        const src = sourceMls ? get(sourceMls) : (viewed[0] || null);
        if (!src) return null;
        basisListings = [src];
        cities = src.City ? [String(src.City).trim()] : [];
    }

    const prices = basisListings.map(l => Number(l.ListPrice)).filter(n => n > 0);
    const beds   = basisListings.map(l => Number(l.BedroomsTotal)).filter(n => n > 0);
    let priceMin = 0, priceMax = 0;
    if (prices.length) {
        const [lo, hi] = priceCore(prices);
        priceMin = roundPrice(lo * (basis === 'signup' ? 0.70 : 0.85));
        priceMax = roundPrice(hi * (basis === 'signup' ? 1.20 : 1.15));
    }
    let types = topByCount(basisListings.map(alertTypeFor), MAX_TYPES);
    let bedsMin = beds.length ? Math.max(0, Math.min(...beds) - 1) : 0;

    // Explicit search filters are the lead's own words — they override the inference.
    const latest = key => { for (const s of searches) if (s && s[key] !== undefined) return s[key]; return undefined; };
    if (basis === 'browsing') {
        const sMin = latest('priceMin'), sMax = latest('priceMax'), sBeds = latest('bedsMin'), sTypes = latest('types');
        if (sMin > 0) priceMin = sMin;
        if (sMax > 0) priceMax = sMax;
        if (sMin > 0 && !(sMax > 0) && priceMax) {
            priceMax = priceMax < sMin ? 0 : Math.max(priceMax, roundPrice(sMin * 1.5));   // "$1M+" → open, or ≥ 1.5× the floor
        }
        if (sMax > 0 && !(sMin > 0) && priceMin > sMax) priceMin = 0;
        if (sBeds > 0) bedsMin = sBeds;
        if (Array.isArray(sTypes) && sTypes.length) types = sTypes.slice(0, MAX_TYPES);
    }
    if (priceMin && priceMax && priceMin >= priceMax) priceMin = 0;

    if (!cities.length && !priceMax && !priceMin && !types.length) return null;   // nothing to search on

    const profile = {
        active: true,
        cities,
        priceMin,
        priceMax,
        bedsMin,
        propertyTypes: types,
        frequency: frequencyForTimeline(timeline),
        count: 3,
    };
    const sources = uniq([...favoriteIds, ...viewedIds, sourceMls].filter(Boolean)).slice(0, 20);
    return {
        basis,
        profile,
        sources,
        summary: { viewed: viewed.length, favorites: favs.length, searches: searches.filter(Boolean).length, distinctSeen },
    };
}

/** Human line for the CRM note / Slack: "Miami, Doral · $850k–$1.4M · 2+ hab · Condo, Single Family". */
export function describeProfile(profile, lang = 'es') {
    const money = n => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n % 1_000_000 ? 2 : 0).replace(/\.?0+$/, '')}M` : `$${Math.round(n / 1000)}k`;
    const parts = [];
    if (profile.cities && profile.cities.length) parts.push(profile.cities.join(', '));
    if (profile.priceMin && profile.priceMax) parts.push(`${money(profile.priceMin)}–${money(profile.priceMax)}`);
    else if (profile.priceMax) parts.push(lang === 'en' ? `up to ${money(profile.priceMax)}` : `hasta ${money(profile.priceMax)}`);
    else if (profile.priceMin) parts.push(`${money(profile.priceMin)}+`);
    if (profile.bedsMin > 0) parts.push(`${profile.bedsMin}+ ${lang === 'en' ? 'bd' : 'hab'}`);
    if (profile.propertyTypes && profile.propertyTypes.length) parts.push(profile.propertyTypes.join(', '));
    return parts.join(' · ');
}

/** Same searchable criteria? (used to skip a no-op re-derive) */
export function sameCriteria(a, b) {
    if (!a || !b) return false;
    const norm = p => JSON.stringify({
        c: (Array.isArray(p.cities) ? p.cities : String(p.cities || '').split(',')).map(s => String(s).trim().toLowerCase()).filter(Boolean).sort(),
        min: Number(p.priceMin) || 0, max: Number(p.priceMax) || 0, beds: Number(p.bedsMin) || 0,
        t: (p.propertyTypes || p.types || []).map(s => String(s).toLowerCase()).sort(),
    });
    return norm(a) === norm(b);
}
