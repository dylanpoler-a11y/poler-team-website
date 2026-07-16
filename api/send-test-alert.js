/**
 * /api/send-test-alert.js — Vercel Edge Function
 * Sends a single property alert email for one lead (manual trigger from CRM).
 *
 * POST body: { id, password }   (password OR Bearer token)
 *
 * Uses the shared search logic in lib/alert-search.js so the preview cannot
 * disagree with the scheduled cron in api/send-alerts.js.
 *
 * When the search returns 0 listings the response now includes a `debug`
 * block that explains which step zeroed it out (Bridge, feature filter,
 * keyword filter, polygon) so Kevin can fix the lead's profile without
 * guessing.
 *
 * Required env vars:
 *   AIRTABLE_API_KEY, AIRTABLE_BASE_ID, CRM_PASSWORD,
 *   RESEND_API_KEY, ALERT_FROM_EMAIL, BRIDGE_API_TOKEN, SITE_BASE_URL
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';
import { searchListingsForLead, explainDroppedBy, channelsFromLead } from '../lib/alert-search.js';
import { sendWhatsappAlert } from './send-alerts.js';

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            },
        });
    }

    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const apiKey      = process.env.AIRTABLE_API_KEY;
    const baseId      = process.env.AIRTABLE_BASE_ID;
    const resendKey   = process.env.RESEND_API_KEY;
    const bridgeToken = process.env.BRIDGE_API_TOKEN;
    const fromEmail   = process.env.ALERT_FROM_EMAIL || 'alerts@homesinsoflorida.com';
    const siteBase    = process.env.SITE_BASE_URL || 'https://www.homesinsoflorida.com';

    if (!apiKey || !baseId || !resendKey || !bridgeToken) {
        return json({ error: 'Missing required environment variables' }, 500);
    }

    let body;
    try { body = await req.json(); } catch { return json({ error: 'Invalid request body' }, 400); }

    const { id, dryRun } = body;
    if (!authorize(req, body).ok) {
        return json({ error: 'Unauthorized' }, 401);
    }
    if (!id) {
        return json({ error: 'id required' }, 400);
    }

    // Fetch lead from Airtable
    const leadRes = await fetch(`https://api.airtable.com/v0/${baseId}/Leads/${id}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!leadRes.ok) return json({ error: 'Lead not found' }, 404);
    const leadData = await leadRes.json();
    const f = leadData.fields;

    const lead = {
        id:        leadData.id,
        firstName: f['First Name'] || f['Name']?.split(' ')[0] || 'there',
        email:     (f['Email'] || '').replace(/[^\x20-\x7E]/g, '').trim(),
        cities:    f['Alert Cities'] || '',
        types:     f['Alert Property Types'] || [],
        priceMin:  f['Alert Price Min'] || 0,
        priceMax:  f['Alert Price Max'] || 0,
        bedsMin:   f['Alert Beds Min'] || 0,
        bathsMin:  f['Alert Baths Min'] || 0,
        count:     f['Alert Count'] || 5,
        token:     f['Alert Token'] || '',
        password:  f['Access Password'] || '',
        phone:     f['Phone'] || '',
        language:  f['Preferred Language'] || 'en',
        polygon:   f['Alert Polygon'] || '',
        profiles:  f['Alert Profiles'] || '',
    };

    // Honor the lead's checked channels (Kevin 2026-07-16): the test button sends
    // through whichever boxes are checked — email, WhatsApp, or both. Same per-lead
    // channel prefs the weekly cron uses (stored in the Alert Profiles wrapper).
    const channels = channelsFromLead(lead);
    if (!channels.email && !channels.whatsapp) {
        return json({ error: 'No alert channel selected — check Email and/or WhatsApp on the lead.' }, 400);
    }
    if (channels.email && !lead.email && !channels.whatsapp) {
        return json({ error: 'Email channel is on but the lead has no email address.' }, 400);
    }
    if (channels.whatsapp && !lead.phone && !channels.email) {
        return json({ error: 'WhatsApp channel is on but the lead has no phone number.' }, 400);
    }

    // Access password is only used for the email login links; only generate it
    // when the email channel is actually being sent.
    if (channels.email && lead.email && !lead.password) {
        const safeName = (lead.firstName || 'User').toString();
        const namePrefix = safeName.substring(0, 3).charAt(0).toUpperCase() + safeName.substring(1, 3).toLowerCase();
        const phoneSuffix = (lead.phone || '').toString().replace(/\D/g, '').slice(-4) || '0000';
        const randDigits = String(Math.floor(Math.random() * 90) + 10);
        lead.password = namePrefix + phoneSuffix + randDigits;
        try {
            await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    records: [{ id: leadData.id, fields: { 'Access Password': lead.password } }],
                }),
            });
        } catch (_) { /* non-fatal */ }
    }

    const { listings, debug } = await searchListingsForLead(bridgeToken, lead);

    if (listings.length === 0) {
        return json({
            error: 'No matching properties found for this lead\'s preferences',
            reason: explainDroppedBy(debug.droppedBy, debug),
            debug,
        }, 404);
    }

    // Dry-run mode: return what WOULD be sent without actually sending.
    if (dryRun) {
        return json({
            success: true,
            dryRun: true,
            channels,
            propertiesSent: listings.length,
            preview: listings.map(l => ({
                id: l.ListingId,
                city: l.City,
                price: l.ListPrice,
                subType: l.PropertySubType,
            })),
            debug,
        });
    }

    // Send through EACH checked channel (Kevin 2026-07-16). Per-channel outcome is
    // returned so the CRM can show exactly what went where — success if ANY channel
    // delivered.
    const channelOutcome = {};
    let emailSent = false;

    // ── EMAIL ──────────────────────────────────────────────────────────────────
    if (channels.email && lead.email) {
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
            channelOutcome.email = { status: 'error', reason: await emailRes.text() };
        } else {
            emailSent = true;
            channelOutcome.email = { status: 'sent', to: lead.email };
        }
    } else if (channels.email && !lead.email) {
        channelOutcome.email = { status: 'skipped', reason: 'no email address' };
    }

    // ── WHATSAPP ─────────────────────────────────────────────────────────────────
    // Reuses the EXACT sender the weekly cron uses (Claudia's 954, approved PROPS
    // templates, tokenized share-property links). Best-effort — a WhatsApp failure
    // never blocks the email. GOTCHA: Meta blocks WhatsApp MARKETING templates to
    // US (+1) numbers (Twilio err 63049) → status:'error' for US leads; keep those
    // on Email. (WhatsApp alerts work for LATAM/foreign numbers.)
    if (channels.whatsapp) {
        if (!lead.phone) {
            channelOutcome.whatsapp = { status: 'skipped', reason: 'no phone' };
        } else {
            try {
                channelOutcome.whatsapp = await sendWhatsappAlert({ lead, listings, siteBase });
            } catch (waErr) {
                channelOutcome.whatsapp = { status: 'error', reason: waErr.message };
            }
        }
    }

    const anySent = emailSent || channelOutcome.whatsapp?.status === 'sent';
    if (!anySent) {
        return json({
            error: 'No channel delivered the test alert.',
            channels: channelOutcome,
            propertiesMatched: listings.length,
            debug,
        }, 502);
    }

    return json({ success: true, propertiesSent: listings.length, channels: channelOutcome, debug });
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

    const authParams = [];
    if (lead.email)    authParams.push(`e=${encodeURIComponent(lead.email)}`);
    if (lead.password) authParams.push(`p=${encodeURIComponent(lead.password)}`);
    if (lead.token)    authParams.push(`t=${encodeURIComponent(lead.token)}`);
    const authQS = authParams.join('&');
    const appendAuth = (url) => {
        if (!authQS) return url;
        return url + (url.includes('?') ? '&' : '?') + authQS;
    };

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
            : (listing.LotSizeSquareFeet
                ? Number(listing.LotSizeSquareFeet).toLocaleString('en-US') + ' sqft lot'
                : ''); // land listings: show lot size where a house shows living area
        const mlsId = listing.ListingId || '';
        const listingUrl = appendAuth(`${siteBase}/listing?id=${mlsId}`);

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

    const prefsUrl = appendAuth(
        lead.token
            ? `${siteBase}/preferences?token=${lead.token}&lang=${lang}`
            : `${siteBase}/preferences?lang=${lang}`
    );

    const searchUrl = appendAuth(buildSearchUrl(siteBase, lead));

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
      ${lead.password ? `
      <div style="background:#eff6ff;border:2px solid #3b82f6;border-radius:10px;padding:18px 20px;margin-bottom:24px;">
        <div style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;text-align:center;">${lead.language === 'es' ? 'TUS CREDENCIALES DE ACCESO' : lead.language === 'pt' ? 'SUAS CREDENCIAIS DE ACESSO' : 'YOUR LOGIN CREDENTIALS'}</div>
        <div style="font-size:14px;color:#1e3a5f;line-height:1.8;text-align:center;">
          <strong>${lead.language === 'es' ? 'Correo' : 'Email'}:</strong> ${lead.email}<br>
          <strong>${lead.language === 'es' ? 'Contraseña' : lead.language === 'pt' ? 'Senha' : 'Password'}:</strong> <span style="font-size:17px;font-weight:800;color:#1e40af;letter-spacing:0.5px;">${lead.password}</span>
        </div>
        <div style="font-size:11px;color:#94a3b8;margin-top:8px;text-align:center;">${lead.language === 'es' ? 'Tocar cualquier enlace en este correo te conecta automáticamente.' : lead.language === 'pt' ? 'Tocar em qualquer link deste e-mail te conecta automaticamente.' : 'Tapping any link in this email logs you in automatically.'}</div>
      </div>
      ` : ''}
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
        📞 (954) 235-4046 · ✉️ rosadasilvapoler@gmail.com
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
