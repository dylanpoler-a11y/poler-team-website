/**
 * /api/send-test-alert.js — Vercel Edge Function
 * Sends a single property alert email for one lead (manual trigger from CRM).
 *
 * POST body: { id, password }
 *
 * Required env vars:
 *   AIRTABLE_API_KEY, AIRTABLE_BASE_ID, CRM_PASSWORD,
 *   RESEND_API_KEY, ALERT_FROM_EMAIL, BRIDGE_API_TOKEN, SITE_BASE_URL
 */

export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        });
    }

    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const apiKey     = process.env.AIRTABLE_API_KEY;
    const baseId     = process.env.AIRTABLE_BASE_ID;
    const crmPass    = process.env.CRM_PASSWORD;
    const resendKey  = process.env.RESEND_API_KEY;
    const bridgeToken = process.env.BRIDGE_API_TOKEN;
    const fromEmail  = process.env.ALERT_FROM_EMAIL || 'alerts@homesinsoflorida.com';
    const siteBase   = process.env.SITE_BASE_URL || 'https://www.homesinsoflorida.com';

    if (!apiKey || !baseId || !resendKey || !bridgeToken) {
        return json({ error: 'Missing required environment variables' }, 500);
    }

    let body;
    try { body = await req.json(); } catch { return json({ error: 'Invalid request body' }, 400); }

    const { id, password } = body;
    if (!id || !password || password !== crmPass) {
        return json({ error: 'Unauthorized' }, 401);
    }

    // Fetch lead from Airtable
    const leadRes = await fetch(`https://api.airtable.com/v0/${baseId}/Leads/${id}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!leadRes.ok) return json({ error: 'Lead not found' }, 404);
    const leadData = await leadRes.json();
    const f = leadData.fields;

    if (!f['Email']) return json({ error: 'Lead has no email address' }, 400);

    const lead = {
        id:        leadData.id,
        firstName: f['First Name'] || f['Name']?.split(' ')[0] || 'there',
        email:     f['Email'],
        cities:    f['Alert Cities'] || '',
        types:     f['Alert Property Types'] || [],
        priceMin:  f['Alert Price Min'] || 0,
        priceMax:  f['Alert Price Max'] || 0,
        bedsMin:   f['Alert Beds Min'] || 0,
        bathsMin:  f['Alert Baths Min'] || 0,
        count:     f['Alert Count'] || 5,
        token:     f['Alert Token'] || '',
        language:  f['Preferred Language'] || 'en',
        polygon:   f['Alert Polygon'] || '',
        profiles:  f['Alert Profiles'] || '',
    };

    // Determine profiles to fetch — multi-profile or legacy single
    let profilesToFetch = [];
    if (lead.profiles) {
        try {
            const parsed = JSON.parse(lead.profiles);
            if (Array.isArray(parsed) && parsed.length > 0) profilesToFetch = parsed;
        } catch (e) { /* bad JSON */ }
    }
    if (profilesToFetch.length === 0) {
        profilesToFetch = [{
            types: lead.types, cities: lead.cities,
            priceMin: lead.priceMin, priceMax: lead.priceMax,
            bedsMin: lead.bedsMin, bathsMin: lead.bathsMin,
            polygon: lead.polygon,
        }];
    }

    // Fetch listings for each profile and combine
    let allListings = [];
    for (const profile of profilesToFetch) {
        const profileLead = {
            ...lead,
            types: profile.types || lead.types,
            cities: profile.cities || lead.cities,
            priceMin: profile.priceMin || lead.priceMin,
            priceMax: profile.priceMax || lead.priceMax,
            bedsMin: profile.bedsMin || lead.bedsMin,
            bathsMin: profile.bathsMin || lead.bathsMin,
            polygon: profile.polygon || '',
            features: profile.features || [],
            sqftMin: profile.sqftMin || 0,
            sqftMax: profile.sqftMax || 0,
            lotSizeMin: profile.lotSizeMin || 0,
            yearBuiltMin: profile.yearBuiltMin || 0,
            keywords: profile.keywords || '',
        };
        let profileListings = await fetchBridgeListings(bridgeToken, profileLead);
        console.log(`[ALERT DEBUG] Profile "${profile.name || 'default'}": ${profileListings.length} listings from Bridge, cities="${profileLead.cities}", types=${JSON.stringify(profileLead.types)}, priceMin=${profileLead.priceMin}, priceMax=${profileLead.priceMax}`);

        const polyStr = profile.polygon || '';
        if (polyStr && profileListings.length > 0) {
            try {
                const geo = JSON.parse(polyStr);
                let rings = [];
                if (Array.isArray(geo)) {
                    rings = geo.filter(g => g && g.type === 'Polygon' && g.coordinates).map(g => g.coordinates[0]);
                } else if (geo && geo.type === 'Polygon' && geo.coordinates) {
                    rings = [geo.coordinates[0]];
                }
                if (rings.length > 0) {
                    profileListings = profileListings.filter(l => {
                        const lat = l.Latitude;
                        const lng = l.Longitude;
                        // If listing has no coordinates, include it (don't penalize missing data)
                        if (lat == null || lng == null) return true;
                        return rings.some(ring => pointInPolygon(lat, lng, ring));
                    });
                }
            } catch (e) { console.log(`[ALERT DEBUG] Polygon parse error:`, e.message); }
            console.log(`[ALERT DEBUG] After polygon filter: ${profileListings.length} listings remain`);
        }
        allListings.push(...profileListings);
    }

    // Deduplicate by ListingId
    const seen = new Set();
    let listings = allListings.filter(l => {
        const id = l.ListingId;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    }).slice(0, lead.count || 5);

    if (listings.length === 0) {
        return json({ error: 'No matching properties found for this lead\'s preferences' }, 404);
    }

    // Build and send email
    const html = buildAlertEmail(lead, listings, siteBase);
    const subject = getSubject(lead.language, listings.length);

    const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from: `The Poler Team <${fromEmail}>`,
            to: [lead.email],
            subject,
            html,
        }),
    });

    if (!emailRes.ok) {
        const err = await emailRes.text();
        return json({ error: `Resend error: ${err}` }, 500);
    }

    return json({ success: true, propertiesSent: listings.length });
}

// ── BRIDGE API ────────────────────────────────────────────────────────────────

// South Florida cities with approximate center coordinates
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

function getCitiesNearPoint(lat, lng) {
    // Return cities within ~15km of the point
    const maxDist = 15;
    const nearby = SOUTH_FL_CITIES
        .map(c => ({ name: c.name, dist: Math.sqrt(Math.pow((c.lat - lat) * 111, 2) + Math.pow((c.lng - lng) * 111 * Math.cos(lat * Math.PI / 180), 2)) }))
        .filter(c => c.dist < maxDist)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 8)
        .map(c => c.name);
    // Always return at least a few cities if none found nearby
    return nearby.length > 0 ? nearby : ['Miami Beach', 'Sunny Isles Beach', 'Aventura', 'North Miami Beach', 'Fort Lauderdale'];
}

function toTitleCase(str) {
    return str.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
}

// Ray-casting point-in-polygon test
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

async function fetchBridgeListings(token, lead) {
    const cities = (lead.cities || '').split(',').map(s => s.trim()).filter(Boolean).map(toTitleCase);
    const count = lead.count || 5;
    const hasPolygon = !!(lead.polygon);
    const hasFeatures = (lead.features || []).length > 0;
    const hasKeywords = !!(lead.keywords);
    const needsClientFilter = hasPolygon || hasFeatures || hasKeywords;

    const typeMap = {
        'Single Family': 'Single Family Residence',
        'Condo':         'Condominium',
        'Townhouse':     'Townhouse',
        'Multi Family':  'Multi Family',
    };

    const baseParams = new URLSearchParams({
        access_token:   token,
        limit:          String(needsClientFilter ? 100 : count * 2), // fetch many when client-side filtering is needed
        sortBy:         'ModificationTimestamp',
        order:          'desc',
        PropertyType:   'Residential',
        StandardStatus: 'Active',
    });

    if (lead.priceMin > 0) baseParams.set('ListPrice.gte', String(lead.priceMin));
    if (lead.priceMax > 0) baseParams.set('ListPrice.lte', String(lead.priceMax));
    if (lead.bedsMin > 0) baseParams.set('BedroomsTotal.gte', String(lead.bedsMin));
    if (lead.bathsMin > 0) baseParams.set('BathroomsTotalInteger.gte', String(lead.bathsMin));
    if (lead.sqftMin > 0) baseParams.set('LivingArea.gte', String(lead.sqftMin));
    if (lead.sqftMax > 0) baseParams.set('LivingArea.lte', String(lead.sqftMax));
    if (lead.lotSizeMin > 0) baseParams.set('LotSizeSquareFeet.gte', String(lead.lotSizeMin));
    if (lead.yearBuiltMin > 0) baseParams.set('YearBuilt.gte', String(lead.yearBuiltMin));

    // When polygon exists but no cities, derive cities from polygon bounding box center
    let polygonCities = [];
    if (hasPolygon && cities.length === 0) {
        try {
            const geo = JSON.parse(lead.polygon);
            let allCoords = [];
            if (Array.isArray(geo)) {
                allCoords = geo.flatMap(g => g.coordinates ? g.coordinates[0] : []);
            } else if (geo && geo.coordinates) {
                allCoords = geo.coordinates[0];
            }
            if (allCoords.length > 0) {
                const lats = allCoords.map(c => c[1]);
                const lngs = allCoords.map(c => c[0]);
                const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
                const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
                // Map center coordinates to South Florida cities
                polygonCities = getCitiesNearPoint(centerLat, centerLng);
            }
        } catch (e) { /* invalid polygon */ }
    }

    // Map property types to API values
    const mappedTypes = (lead.types || []).map(t => typeMap[t] || t).filter(Boolean);
    const effectiveCities = cities.length > 0 ? cities : (polygonCities.length > 0 ? polygonCities : [null]);

    // Build one request per city × type combination for targeted results
    const requests = [];
    for (const city of effectiveCities) {
        if (mappedTypes.length > 0) {
            for (const subType of mappedTypes) {
                const p = new URLSearchParams(baseParams);
                p.set('PropertySubType', subType);
                if (city) p.set('City', city);
                requests.push(
                    fetch(`https://api.bridgedataoutput.com/api/v2/miamire/listings?${p}`)
                        .then(r => r.ok ? r.json() : { bundle: [] })
                        .then(d => (d.success !== false && Array.isArray(d.bundle)) ? d.bundle : [])
                        .catch(() => [])
                );
            }
        } else {
            const p = new URLSearchParams(baseParams);
            if (city) p.set('City', city);
            requests.push(
                fetch(`https://api.bridgedataoutput.com/api/v2/miamire/listings?${p}`)
                    .then(r => r.ok ? r.json() : { bundle: [] })
                    .then(d => (d.success !== false && Array.isArray(d.bundle)) ? d.bundle : [])
                    .catch(() => [])
            );
        }
    }

    const results = await Promise.all(requests);
    console.log(`[ALERT DEBUG] ${requests.length} requests made, results per request: ${results.map(r => r.length).join(', ')}`);
    let allListings = results.flat();
    console.log(`[ALERT DEBUG] Total raw listings: ${allListings.length}, hasCoords: ${allListings.filter(l => l.Latitude && l.Longitude).length}`);
    allListings.sort((a, b) => new Date(b.ModificationTimestamp || 0) - new Date(a.ModificationTimestamp || 0));

    // Deduplicate
    const seen = new Set();
    const unique = [];
    for (const l of allListings) {
        if (!seen.has(l.ListingId)) {
            seen.add(l.ListingId);
            unique.push(l);
        }
        if (!needsClientFilter && unique.length >= count) break;
    }

    // Client-side feature filtering
    let filtered = unique;
    const features = lead.features || [];
    if (features.length > 0) {
        filtered = filtered.filter(l => {
            return features.every(feat => matchesFeature(l, feat));
        });
        console.log(`[ALERT DEBUG] After feature filter (${features.join(', ')}): ${filtered.length} remain`);
    }

    // Client-side keyword filtering (check PublicRemarks)
    if (lead.keywords) {
        const kws = lead.keywords.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
        if (kws.length > 0) {
            filtered = filtered.filter(l => {
                const remarks = (l.PublicRemarks || '').toLowerCase();
                return kws.some(kw => remarks.includes(kw));
            });
            console.log(`[ALERT DEBUG] After keyword filter ("${lead.keywords}"): ${filtered.length} remain`);
        }
    }

    return filtered;
}

// Check if a listing matches a feature tag
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
            return arrContains(listing.ArchitecturalStyle, 'penthouse')
                || remarks.includes('penthouse');
        default:
            return true;
    }
}

// ── EMAIL TEMPLATE ────────────────────────────────────────────────────────────

function getSubject(lang, count) {
    const subjects = {
        en: `🏡 ${count} New Properties Matching Your Search`,
        es: `🏡 ${count} Nuevas Propiedades que Coinciden con Tu Búsqueda`,
        pt: `🏡 ${count} Novas Propriedades que Correspondem à Sua Busca`,
    };
    return subjects[lang] || subjects.en;
}

function buildAlertEmail(lead, listings, siteBase) {
    const lang = lead.language || 'en';
    const i18n = getEmailStrings(lang);

    const propertyCards = listings.map(listing => {
        const photo = getListingPhoto(listing);
        const price = listing.ListPrice
            ? '$' + Number(listing.ListPrice).toLocaleString('en-US')
            : 'Price TBD';
        const address = listing.UnparsedAddress || listing.City || 'South Florida';
        const city = listing.City || '';
        const state = listing.StateOrProvince || 'FL';
        const beds = listing.BedroomsTotal || '—';
        const baths = listing.BathroomsTotalInteger || '—';
        const sqft = listing.LivingArea
            ? Number(listing.LivingArea).toLocaleString('en-US') + ' sqft'
            : '';
        const mlsId = listing.ListingId || '';
        const tokenParam = lead.token ? `&t=${lead.token}` : '';
        const listingUrl = `${siteBase}/listing?id=${mlsId}${tokenParam}`;

        return `
        <tr><td style="padding:0 0 20px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
            <tr>
              <td>
                ${photo ? `<img src="${photo}" alt="${address}" width="100%" style="display:block;max-height:220px;object-fit:cover;" />` : `<div style="height:180px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:14px;">No Photo Available</div>`}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 20px;">
                <div style="font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:700;color:#1a2744;margin-bottom:4px;">${price}</div>
                <div style="font-size:14px;color:#475569;margin-bottom:8px;">${address}${city ? ', ' + city : ''}, ${state}</div>
                <div style="font-size:13px;color:#64748b;margin-bottom:14px;">
                  ${beds} ${i18n.beds} &nbsp;·&nbsp; ${baths} ${i18n.baths}${sqft ? ' &nbsp;·&nbsp; ' + sqft : ''}${mlsId ? ' &nbsp;·&nbsp; MLS# ' + mlsId : ''}
                </div>
                <a href="${listingUrl}" style="display:inline-block;padding:10px 24px;background:#1a2744;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">${i18n.viewDetails} →</a>
              </td>
            </tr>
          </table>
        </td></tr>`;
    }).join('');

    const prefsUrl = lead.token
        ? `${siteBase}/preferences?token=${lead.token}&lang=${lang}`
        : `${siteBase}`;

    const searchUrl = buildSearchUrl(siteBase, lead);

    return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Inter',Arial,Helvetica,sans-serif;">

<!-- Header -->
<table width="100%" cellpadding="0" cellspacing="0" style="background:#1a2744;">
  <tr>
    <td style="padding:20px 30px;text-align:center;">
      <span style="font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">The Poler Team</span>
      <br>
      <span style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Optimar International Realty</span>
    </td>
  </tr>
</table>

<!-- Body -->
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">
  <tr>
    <td style="padding:30px 20px 10px;">
      <div style="font-size:18px;color:#1a2744;font-weight:600;margin-bottom:6px;">${i18n.greeting.replace('{name}', lead.firstName)}</div>
      <div style="font-size:14px;color:#475569;line-height:1.6;margin-bottom:24px;">${i18n.intro}</div>
    </td>
  </tr>

  <!-- Property Cards -->
  ${propertyCards}

  <!-- Browse All CTA -->
  <tr>
    <td style="padding:10px 0 30px;text-align:center;">
      <a href="${searchUrl}" style="display:inline-block;padding:14px 36px;background:#c8a55a;color:#1a2744;text-decoration:none;border-radius:8px;font-size:15px;font-weight:700;letter-spacing:0.3px;">${i18n.browseAll} →</a>
    </td>
  </tr>
</table>

<!-- Footer -->
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;border-top:1px solid #e2e8f0;">
  <tr>
    <td style="padding:24px 20px;text-align:center;max-width:600px;margin:0 auto;">
      <div style="font-size:13px;color:#475569;margin-bottom:8px;">
        <strong>Rosa Poler</strong> · The Poler Team<br>
        📞 (954) 235-4046 · ✉️ rosa@homesinsoflorida.com
      </div>
      <div style="font-size:12px;color:#94a3b8;margin-bottom:12px;">
        Optimar International Realty · South Florida
      </div>
      <div style="font-size:12px;">
        <a href="${prefsUrl}" style="color:#1a2744;text-decoration:underline;">${i18n.updatePrefs}</a>
        &nbsp;&nbsp;·&nbsp;&nbsp;
        <a href="${prefsUrl}&unsubscribe=1" style="color:#94a3b8;text-decoration:underline;">${i18n.unsubscribe}</a>
      </div>
    </td>
  </tr>
</table>

</body>
</html>`;
}

function getListingPhoto(listing) {
    if (listing.Media && listing.Media.length > 0) {
        return listing.Media[0].MediaURL || '';
    }
    if (listing.photos && listing.photos.length > 0) {
        return listing.photos[0] || '';
    }
    return '';
}

function buildSearchUrl(siteBase, lead) {
    const params = new URLSearchParams();
    if (lead.cities) params.set('city', lead.cities.split(',')[0]?.trim() || '');
    if (lead.priceMin > 0) params.set('pmin', String(lead.priceMin));
    if (lead.priceMax > 0) params.set('pmax', String(lead.priceMax));
    if (lead.bedsMin > 0) params.set('beds', String(lead.bedsMin));
    return `${siteBase}/listing?${params}`;
}

function getEmailStrings(lang) {
    const strings = {
        en: {
            greeting: 'Hi {name},',
            intro: 'Here are your latest property matches based on your preferences. Click any property to view full details, photos, and schedule a tour.',
            beds: 'Beds',
            baths: 'Baths',
            viewDetails: 'View Details',
            browseAll: 'Browse All Properties',
            updatePrefs: 'Update Preferences',
            unsubscribe: 'Unsubscribe',
        },
        es: {
            greeting: 'Hola {name},',
            intro: 'Aquí están las últimas propiedades que coinciden con tus preferencias. Haz clic en cualquier propiedad para ver los detalles completos, fotos y agendar una visita.',
            beds: 'Hab.',
            baths: 'Baños',
            viewDetails: 'Ver Detalles',
            browseAll: 'Ver Todas las Propiedades',
            updatePrefs: 'Actualizar Preferencias',
            unsubscribe: 'Cancelar suscripción',
        },
        pt: {
            greeting: 'Olá {name},',
            intro: 'Aqui estão as últimas propriedades que correspondem às suas preferências. Clique em qualquer propriedade para ver detalhes completos, fotos e agendar uma visita.',
            beds: 'Quartos',
            baths: 'Banhos',
            viewDetails: 'Ver Detalhes',
            browseAll: 'Ver Todas as Propriedades',
            updatePrefs: 'Atualizar Preferências',
            unsubscribe: 'Cancelar inscrição',
        },
    };
    return strings[lang] || strings.en;
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
    });
}
