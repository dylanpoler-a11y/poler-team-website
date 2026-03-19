/**
 * /api/send-alerts.js — Vercel Edge Function (Cron-triggered)
 * Runs daily at 9am. Finds all leads with Alert Active = true and
 * Alert Next Due <= today, fetches matching properties from Bridge API,
 * sends email via Resend, and updates Airtable timestamps.
 *
 * Auth: Vercel Cron automatically sends CRON_SECRET header.
 *
 * Required env vars:
 *   AIRTABLE_API_KEY, AIRTABLE_BASE_ID, CRON_SECRET,
 *   RESEND_API_KEY, ALERT_FROM_EMAIL, BRIDGE_API_TOKEN, SITE_BASE_URL
 */

export const config = { runtime: 'edge' };

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

    // Auth: Vercel Cron sends this header automatically
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get('authorization');
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return json({ error: 'Unauthorized' }, 401);
    }

    const apiKey      = process.env.AIRTABLE_API_KEY;
    const baseId      = process.env.AIRTABLE_BASE_ID;
    const resendKey   = process.env.RESEND_API_KEY;
    const bridgeToken = process.env.BRIDGE_API_TOKEN;
    const fromEmail   = process.env.ALERT_FROM_EMAIL || 'alerts@homesinsoflorida.com';
    const siteBase    = process.env.SITE_BASE_URL || 'https://www.homesinsoflorida.com';

    if (!apiKey || !baseId || !resendKey || !bridgeToken) {
        return json({ error: 'Missing required environment variables' }, 500);
    }

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Fetch all leads with Alert Active = true and Alert Next Due <= today
    const formula = `AND({Alert Active}=TRUE(), OR({Alert Next Due}='', {Alert Next Due}<=TODAY()))`;
    const params = new URLSearchParams({
        'filterByFormula': formula,
        'pageSize': '100',
    });

    let dueLeads = [];
    let offset = null;

    for (let page = 0; page < 5; page++) {
        if (offset) params.set('offset', offset);
        const res = await fetch(
            `https://api.airtable.com/v0/${baseId}/Leads?${params}`,
            { headers: { 'Authorization': `Bearer ${apiKey}` } }
        );
        if (!res.ok) break;
        const data = await res.json();
        dueLeads = dueLeads.concat(data.records || []);
        if (!data.offset) break;
        offset = data.offset;
    }

    const results = { sent: 0, skipped: 0, errors: 0, details: [] };

    for (const record of dueLeads) {
        const f = record.fields;
        const email = f['Email'];
        if (!email) {
            results.skipped++;
            results.details.push({ id: record.id, status: 'skipped', reason: 'no email' });
            continue;
        }

        const lead = {
            id:        record.id,
            firstName: f['First Name'] || f['Name']?.split(' ')[0] || 'there',
            email,
            cities:    f['Alert Cities'] || '',
            types:     f['Alert Property Types'] || [],
            priceMin:  f['Alert Price Min'] || 0,
            priceMax:  f['Alert Price Max'] || 0,
            bedsMin:   f['Alert Beds Min'] || 0,
            bathsMin:  f['Alert Baths Min'] || 0,
            count:     f['Alert Count'] || 5,
            frequency: f['Alert Frequency'] || 'Weekly',
            token:     f['Alert Token'] || '',
            language:  f['Preferred Language'] || 'en',
            polygon:   f['Alert Polygon'] || '',
            profiles:  f['Alert Profiles'] || '',
        };

        try {
            // Determine profiles to fetch — multi-profile or legacy single
            let profilesToFetch = [];
            if (lead.profiles) {
                try {
                    const parsed = JSON.parse(lead.profiles);
                    if (Array.isArray(parsed) && parsed.length > 0) profilesToFetch = parsed;
                } catch (e) { /* bad JSON */ }
            }
            // Fall back to single legacy profile if no multi-profiles
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
                };
                let profileListings = await fetchBridgeListings(bridgeToken, profileLead);

                // Apply polygon filter for this profile (supports single Polygon or array of Polygons)
                const polyStr = profile.polygon || '';
                if (polyStr && profileListings.length > 0) {
                    try {
                        const geo = JSON.parse(polyStr);
                        let rings = [];
                        if (Array.isArray(geo)) {
                            // New format: array of polygon geometries
                            rings = geo.filter(g => g && g.type === 'Polygon' && g.coordinates).map(g => g.coordinates[0]);
                        } else if (geo && geo.type === 'Polygon' && geo.coordinates) {
                            // Legacy format: single polygon
                            rings = [geo.coordinates[0]];
                        }
                        if (rings.length > 0) {
                            profileListings = profileListings.filter(l => {
                                const lat = l.Latitude;
                                const lng = l.Longitude;
                                if (!lat || !lng) return false;
                                // Property must be inside ANY of the drawn areas
                                return rings.some(ring => pointInPolygon(lat, lng, ring));
                            });
                        }
                    } catch (e) { /* invalid polygon */ }
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
            });

            // Limit to requested count
            listings = listings.slice(0, lead.count || 5);

            if (listings.length === 0) {
                results.skipped++;
                results.details.push({ id: record.id, email, status: 'skipped', reason: 'no matching listings' });
                continue;
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
                    to: [email],
                    subject,
                    html,
                }),
            });

            if (!emailRes.ok) {
                results.errors++;
                const err = await emailRes.text();
                results.details.push({ id: record.id, email, status: 'error', reason: err });
                continue;
            }

            // Update Airtable: set Alert Last Sent = today, compute Alert Next Due
            const nextDue = computeNextDue(today, lead.frequency);
            await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    records: [{
                        id: record.id,
                        fields: {
                            'Alert Last Sent': today,
                            'Alert Next Due':  nextDue,
                        },
                    }],
                }),
            });

            results.sent++;
            results.details.push({ id: record.id, email, status: 'sent', properties: listings.length, nextDue });

        } catch (err) {
            results.errors++;
            results.details.push({ id: record.id, email, status: 'error', reason: err.message });
        }
    }

    return json({
        success: true,
        date: today,
        totalDue: dueLeads.length,
        ...results,
    });
}

// ── COMPUTE NEXT DUE DATE ─────────────────────────────────────────────────────

function computeNextDue(fromDateStr, frequency) {
    const d = new Date(fromDateStr + 'T12:00:00Z'); // noon to avoid timezone issues
    const freqDays = {
        'Daily':       1,
        'Every 3 Days': 3,
        'Weekly':      7,
        'Bi-Weekly':   14,
        'Monthly':     30,
    };
    const days = freqDays[frequency] || 7;
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
}

// ── BRIDGE API ────────────────────────────────────────────────────────────────

function toTitleCase(str) {
    return str.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
}

// Ray-casting point-in-polygon test
// ring is GeoJSON format: [[lng, lat], [lng, lat], ...]
function pointInPolygon(lat, lng, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][1], yi = ring[i][0]; // lat, lng
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

    const typeMap = {
        'Single Family': 'Single Family Residence',
        'Condo':         'Condominium',
        'Townhouse':     'Townhouse',
        'Multi Family':  'Multi Family',
    };

    const baseParams = new URLSearchParams({
        access_token:   token,
        limit:          String(count * 2),
        sortBy:         'ModificationTimestamp',
        order:          'desc',
        PropertyType:   'Residential',
        StandardStatus: 'Active',
    });

    if (lead.priceMin > 0) baseParams.set('ListPrice.gte', String(lead.priceMin));
    if (lead.priceMax > 0) baseParams.set('ListPrice.lte', String(lead.priceMax));
    if (lead.bedsMin > 0) baseParams.set('BedroomsTotal.gte', String(lead.bedsMin));
    if (lead.bathsMin > 0) baseParams.set('BathroomsTotalInteger.gte', String(lead.bathsMin));

    // Map property types to API values
    const mappedTypes = (lead.types || []).map(t => typeMap[t] || t).filter(Boolean);
    const effectiveCities = cities.length > 0 ? cities : [null]; // null = no city filter

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
            // No type filter — fetch all residential
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
    let allListings = results.flat();
    allListings.sort((a, b) => new Date(b.ModificationTimestamp || 0) - new Date(a.ModificationTimestamp || 0));

    // Deduplicate
    const seen = new Set();
    const unique = [];
    for (const l of allListings) {
        if (!seen.has(l.ListingId)) {
            seen.add(l.ListingId);
            unique.push(l);
        }
        if (unique.length >= count) break;
    }

    return unique;
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
        : siteBase;

    const searchUrl = buildSearchUrl(siteBase, lead);

    return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Inter',Arial,Helvetica,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#1a2744;">
  <tr>
    <td style="padding:20px 30px;text-align:center;">
      <span style="font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">The Poler Team</span>
      <br>
      <span style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Optimar International Realty</span>
    </td>
  </tr>
</table>

<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">
  <tr>
    <td style="padding:30px 20px 10px;">
      <div style="font-size:18px;color:#1a2744;font-weight:600;margin-bottom:6px;">${i18n.greeting.replace('{name}', lead.firstName)}</div>
      <div style="font-size:14px;color:#475569;line-height:1.6;margin-bottom:24px;">${i18n.intro}</div>
    </td>
  </tr>

  ${propertyCards}

  <tr>
    <td style="padding:10px 0 30px;text-align:center;">
      <a href="${searchUrl}" style="display:inline-block;padding:14px 36px;background:#c8a55a;color:#1a2744;text-decoration:none;border-radius:8px;font-size:15px;font-weight:700;letter-spacing:0.3px;">${i18n.browseAll} →</a>
    </td>
  </tr>
</table>

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
    if (listing.Media && listing.Media.length > 0) return listing.Media[0].MediaURL || '';
    if (listing.photos && listing.photos.length > 0) return listing.photos[0] || '';
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
