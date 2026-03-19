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
        };
        let profileListings = await fetchBridgeListings(bridgeToken, profileLead);

        const polyStr = profile.polygon || '';
        if (polyStr && profileListings.length > 0) {
            try {
                const geo = JSON.parse(polyStr);
                if (geo && geo.type === 'Polygon' && geo.coordinates) {
                    const ring = geo.coordinates[0];
                    profileListings = profileListings.filter(l => {
                        const lat = l.Latitude;
                        const lng = l.Longitude;
                        return lat && lng && pointInPolygon(lat, lng, ring);
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
