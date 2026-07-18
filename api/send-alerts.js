/**
 * /api/send-alerts.js — Vercel Edge Function (Cron-triggered)
 * Runs daily at 14:00 UTC. Finds all leads with Alert Active = true and
 * Alert Next Due <= today, fetches matching properties from Bridge API,
 * sends email via Resend, and updates Airtable timestamps.
 *
 * Auth: Vercel Cron automatically sends CRON_SECRET header.
 *
 * Required env vars:
 *   AIRTABLE_API_KEY, AIRTABLE_BASE_ID, CRON_SECRET,
 *   RESEND_API_KEY, ALERT_FROM_EMAIL, BRIDGE_API_TOKEN, SITE_BASE_URL
 *
 * Bridge search logic lives in lib/alert-search.js — shared with
 * api/send-test-alert.js and api/agent/audit-alerts.js so all three can
 * never drift apart.
 */

export const config = { runtime: 'edge' };

import { searchListingsForLead, explainDroppedBy, channelsFromLead } from '../lib/alert-search.js';

const ZERO_RUNS_BEFORE_REVIEW = 3;

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
    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

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
        const email = (f['Email'] || '').replace(/[^\x20-\x7E]/g, '').trim();
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
            password:  f['Access Password'] || '',
            phone:     f['Phone'] || '',
            language:  f['Preferred Language'] || 'en',
            polygon:   f['Alert Polygon'] || '',
            profiles:  f['Alert Profiles'] || '',
        };
        const priorZeroRuns = Number(f['Alert Zero Runs'] || 0);

        try {
            // Exclude listings already emailed to this lead so they never see
            // repeats (fail-safe: [] on any read error → old behavior).
            const excludeIds = await getSentListingIds(baseId, headers, email);
            const { listings, pickedIds, debug } = await searchListingsForLead(bridgeToken, lead, { excludeIds });

            if (listings.length === 0) {
                // Track the silent zero so future Luises don't go dark for a month.
                const newZeroRuns = priorZeroRuns + 1;
                const needsReview = newZeroRuns >= ZERO_RUNS_BEFORE_REVIEW;
                const reasonText = explainDroppedBy(debug.droppedBy, debug) || 'no matching listings';
                const nextDue = computeNextDue(today, lead.frequency);
                // Update Alert Next Due first (required so the lead isn't stuck).
                try {
                    await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
                        method: 'PATCH',
                        headers,
                        body: JSON.stringify({
                            records: [{ id: record.id, fields: { 'Alert Next Due': nextDue } }],
                        }),
                    });
                } catch (_) { /* non-fatal */ }
                // Track zero-runs separately so missing-field errors don't
                // block the date advance.
                const trackFields = {
                    'Alert Zero Runs':        newZeroRuns,
                    'Alert Last Skip Reason': reasonText.slice(0, 250),
                };
                if (needsReview) trackFields['Alert Needs Review'] = true;
                try {
                    await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
                        method: 'PATCH',
                        headers,
                        body: JSON.stringify({ records: [{ id: record.id, fields: trackFields }] }),
                    });
                } catch (_) { /* non-fatal — Airtable fields may not exist yet */ }

                await logActivity(baseId, headers, {
                    leadId: record.id,
                    email,
                    activityType: 'Alert Zero Result',
                    details: {
                        zeroRuns: newZeroRuns,
                        droppedBy: debug.droppedBy,
                        reason: reasonText,
                        totalRawBridge: debug.totalRawBridge,
                        needsReview,
                    },
                });

                results.skipped++;
                results.details.push({
                    id: record.id, email,
                    status: 'skipped',
                    reason: reasonText,
                    droppedBy: debug.droppedBy,
                    zeroRuns: newZeroRuns,
                    needsReview,
                    nextDue,
                });
                continue;
            }

            // Per-lead delivery channels (email default-on; whatsapp opt-in) —
            // stored inside the Alert Profiles wrapper (backward-compatible).
            const channels = channelsFromLead(lead);

            let emailSent = false;
            const channelOutcome = {};

            // ── EMAIL ──────────────────────────────────────────────────────────
            if (channels.email) {
                // Ensure every email has a password
                if (!lead.password) {
                    lead.password = generateFallbackPassword(lead.firstName, lead.phone);
                    try {
                        await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
                            method: 'PATCH',
                            headers,
                            body: JSON.stringify({
                                records: [{ id: record.id, fields: { 'Access Password': lead.password } }],
                            }),
                        });
                    } catch (_) { /* non-fatal */ }
                }

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
                    // Email failure is only terminal when it's the sole channel;
                    // otherwise fall through and let WhatsApp still go out.
                    const err = await emailRes.text();
                    channelOutcome.email = { status: 'error', reason: err };
                    if (!channels.whatsapp) {
                        results.errors++;
                        results.details.push({ id: record.id, email, status: 'error', reason: err });
                        continue;
                    }
                } else {
                    emailSent = true;
                    channelOutcome.email = { status: 'sent' };
                }
            }

            // ── WHATSAPP ───────────────────────────────────────────────────────
            // Best-effort — a WhatsApp failure must NEVER block the email or the loop.
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
                // Nothing went out (e.g. whatsapp-only lead whose send failed).
                results.errors++;
                results.details.push({
                    id: record.id, email, status: 'error',
                    reason: 'no channel delivered', channels: channelOutcome,
                });
                continue;
            }

            // Success: stamp send first (always required), then reset
            // zero-run counters separately so missing-field errors on the
            // new Airtable columns can't undo the stamp.
            const nextDue = computeNextDue(today, lead.frequency);
            try {
                await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify({
                        records: [{
                            id: record.id,
                            fields: { 'Alert Last Sent': today, 'Alert Next Due': nextDue },
                        }],
                    }),
                });
            } catch (_) { /* non-fatal */ }
            try {
                await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify({
                        records: [{
                            id: record.id,
                            fields: {
                                'Alert Zero Runs':        0,
                                'Alert Last Skip Reason': '',
                                'Alert Needs Review':     false,
                            },
                        }],
                    }),
                });
            } catch (_) { /* non-fatal — Airtable fields may not exist yet */ }

            // Record which listings were sent so future runs can exclude them
            // (this is the memory that prevents repeats). Best-effort, never throws.
            if (pickedIds && pickedIds.length) {
                await logActivity(baseId, headers, {
                    leadId: record.id,
                    email,
                    activityType: 'Alert Sent',
                    details: { ids: pickedIds, count: pickedIds.length, date: today },
                });
            }

            results.sent++;
            results.details.push({ id: record.id, email, status: 'sent', properties: listings.length, fresh: debug.totalFresh, nextDue, channels: channelOutcome });

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

// ── SENT-LISTING HISTORY (best-effort, never throws) ───────────────────────────
// Reads this lead's recent "Alert Sent" activity rows and unions the ListingIds
// that have already been emailed, so the next send can exclude them. Capped so
// the exclusion set stays bounded (oldest sent eventually cycle back in).
const SENT_HISTORY_CAP = 400;

async function getSentListingIds(baseId, headers, email) {
    try {
        if (!email) return [];
        const ids = new Set();
        const formula = `AND({Lead Email}='${email.replace(/'/g, "\\'")}', {Activity Type}='Alert Sent')`;
        const params = new URLSearchParams({
            filterByFormula: formula,
            pageSize: '100',
            'sort[0][field]': 'Timestamp',
            'sort[0][direction]': 'desc',
        });
        let offset = null;
        for (let page = 0; page < 4 && ids.size < SENT_HISTORY_CAP; page++) {
            if (offset) params.set('offset', offset);
            const res = await fetch(
                `https://api.airtable.com/v0/${baseId}/Lead Activity?${params}`,
                { headers: { 'Authorization': headers.Authorization } }
            );
            if (!res.ok) break;
            const data = await res.json();
            for (const rec of (data.records || [])) {
                let det = rec.fields?.Details;
                if (typeof det === 'string') { try { det = JSON.parse(det); } catch { det = null; } }
                for (const id of (det?.ids || [])) {
                    ids.add(id);
                    if (ids.size >= SENT_HISTORY_CAP) break;
                }
            }
            if (!data.offset) break;
            offset = data.offset;
        }
        return Array.from(ids);
    } catch (_) {
        return []; // fail-safe: no exclusion → prior behavior, never blocks a send
    }
}

// ── ACTIVITY LOG (best-effort, never throws) ───────────────────────────────────

async function logActivity(baseId, headers, { leadId, email, activityType, details }) {
    try {
        const fields = {
            'Lead Email':    email || '',
            'Activity Type': activityType,
            'Details':       typeof details === 'string' ? details : JSON.stringify(details),
            'Timestamp':     new Date().toISOString(),
        };
        if (leadId) fields['Lead Record ID'] = [leadId];
        await fetch(`https://api.airtable.com/v0/${baseId}/Lead Activity`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ records: [{ fields }] }),
        });
    } catch (_) { /* non-fatal */ }
}

// ── FALLBACK PASSWORD ─────────────────────────────────────────────────────────

function generateFallbackPassword(firstName, phone) {
    const safeName = (firstName || 'User').toString();
    const namePrefix = safeName.substring(0, 3).charAt(0).toUpperCase() + safeName.substring(1, 3).toLowerCase();
    const phoneSuffix = (phone || '').toString().replace(/\D/g, '').slice(-4) || '0000';
    const randDigits = String(Math.floor(Math.random() * 90) + 10);
    return namePrefix + phoneSuffix + randDigits;
}

// ── COMPUTE NEXT DUE DATE ─────────────────────────────────────────────────────

function computeNextDue(fromDateStr, frequency) {
    const d = new Date(fromDateStr + 'T12:00:00Z');
    const freqDays = {
        'Daily':        1,
        'Every 3 Days': 3,
        'Weekly':       7,
        'Bi-Weekly':    14,
        'Monthly':      30,
    };
    const days = freqDays[frequency] || 7;
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
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
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr><td style="background:#f0f9ff;border:2px solid #1a2744;border-radius:10px;padding:16px 20px;text-align:center;">
          <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;margin-bottom:8px;">${lang === 'es' ? 'TUS CREDENCIALES DE ACCESO' : lang === 'pt' ? 'SUAS CREDENCIAIS DE ACESSO' : 'YOUR LOGIN CREDENTIALS'}</div>
          <div style="font-size:15px;color:#1a2744;margin-bottom:4px;"><strong>${lang === 'es' ? 'Email' : lang === 'pt' ? 'Email' : 'Email'}:</strong> ${lead.email}</div>
          <div style="font-size:18px;color:#1a2744;font-weight:800;letter-spacing:0.5px;"><strong>${lang === 'es' ? 'Contraseña' : lang === 'pt' ? 'Senha' : 'Password'}:</strong> ${lead.password}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:8px;">${lang === 'es' ? 'Tocar cualquier enlace en este correo te conecta automáticamente.' : lang === 'pt' ? 'Tocar em qualquer link deste e-mail te conecta automaticamente.' : 'Tapping any link in this email logs you in automatically.'}</div>
        </td></tr>
      </table>` : ''}
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

// ── WHATSAPP ALERT ─────────────────────────────────────────────────────────────

// PURE — no network. Builds the Twilio Content-template payload for a lead.
// shareUrlFn(listing) -> tokenized listing URL (string, resolved by the caller).
// Returns { templateSid, vars, toPhone, templateKey } or null when nothing to send.
// Template pick by listing count: n>=5 -> PROPS5 (5 slots), n>=3 -> PROPS3 (3 slots),
// else PROPS1 (1 slot); listings are sliced to the slot count so Twilio never sees
// an empty {{n}} (which it rejects). English (_EN) template when the lead's language
// starts with "en", otherwise the Spanish template.
export function buildWhatsappAlert(lead, listings, shareUrlFn) {
    const list = (listings || []).filter(Boolean);
    if (list.length === 0) return null;

    const isEnglish = String(lead.language || '').toLowerCase().startsWith('en');
    const suffix = isEnglish ? '_EN' : '';

    let slots, tplKey;
    if (list.length >= 5)      { slots = 5; tplKey = 'PROPS5'; }
    else if (list.length >= 3) { slots = 3; tplKey = 'PROPS3'; }
    else                       { slots = 1; tplKey = 'PROPS1'; }

    const chosen = list.slice(0, slots);
    const templateKey = `${tplKey}${suffix}`;
    const templateSid = process.env[`TWILIO_WA_TPL_${templateKey}`] || '';

    const vars = { '1': lead.firstName || 'there' };
    chosen.forEach((listing, i) => {
        const label = whatsappListingLabel(listing);
        const url = shareUrlFn(listing) || '';
        // One property per slot, collapsed to a SINGLE line — Meta rejects
        // newlines inside a template variable.
        vars[String(i + 2)] = `${label}: ${url}`.replace(/\s+/g, ' ').trim();
    });

    const toPhone = String(lead.phone || '').replace(/\D/g, '');
    return { templateSid, vars, toPhone, templateKey };
}

function whatsappListingLabel(listing) {
    const beds  = listing.BedroomsTotal;
    const baths = listing.BathroomsTotalInteger;
    const type  = listing.PropertySubType || '';
    const city  = listing.City || '';
    const price = listing.ListPrice ? '$' + Number(listing.ListPrice).toLocaleString('en-US') : '';
    const bb = [beds ? `${beds}BR` : '', baths ? `${baths}BA` : ''].filter(Boolean).join('/');
    const head = [bb, type].filter(Boolean).join(' ');
    const loc = [head, city].filter(Boolean).join(', ');
    return [loc, price].filter(Boolean).join(' — ');
}

// Network wrapper around buildWhatsappAlert. Resolves one tokenized, popup-bypassing
// URL per listing via /api/agent/share-property, then sends the approved template
// from Claudia's 954 line. Never throws to the caller in a way that blocks the loop.
export async function sendWhatsappAlert({ lead, listings, siteBase }) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authTok    = process.env.TWILIO_AUTH_TOKEN;
    const fromWa     = process.env.TWILIO_WHATSAPP_FROM;
    // Machine token for the internal share-property call. The old code sent the
    // ENTIRE comma-separated AGENT_API_TOKEN list as one Bearer string — never a
    // valid member — so the tokenized popup-bypass links silently never generated
    // and leads got popup-gated fallback links. (Audit 2026-07-17.)
    const agentToken = (process.env.SAMMY_ENGINE_TOKEN || (process.env.AGENT_API_TOKEN || '').split(',')[0]).trim();
    if (!accountSid || !authTok || !fromWa) {
        return { status: 'skipped', reason: 'twilio not configured' };
    }

    const slots = listings.length >= 5 ? 5 : listings.length >= 3 ? 3 : 1;
    const chosen = listings.slice(0, slots);

    const urlMap = new Map();
    for (const listing of chosen) {
        const mlsId = listing.ListingId;
        if (!mlsId) continue;
        try {
            const r = await fetch(`${siteBase}/api/agent/share-property`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${agentToken}`,
                },
                body: JSON.stringify({ leadId: lead.id, mlsId, channel: 'whatsapp' }),
            });
            if (r.ok) {
                const d = await r.json();
                if (d.url) urlMap.set(mlsId, d.url);
            }
        } catch (_) { /* skip this listing's link; fall back below */ }
    }

    const payload = buildWhatsappAlert(
        lead,
        chosen,
        (l) => urlMap.get(l.ListingId) || `${siteBase}/listing?mls=${l.ListingId}`,  // ?mls= is the listing page's real param (?id= 404'd the detail view)
    );
    if (!payload) return { status: 'skipped', reason: 'no listings' };
    if (!payload.toPhone) return { status: 'skipped', reason: 'no phone' };
    if (!payload.templateSid) return { status: 'skipped', reason: `missing template ${payload.templateKey}` };

    const form = new URLSearchParams({
        To: `whatsapp:+${payload.toPhone}`,
        From: fromWa,
        ContentSid: payload.templateSid,
        ContentVariables: JSON.stringify(payload.vars),
    });

    const twRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + btoa(`${accountSid}:${authTok}`),
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: form.toString(),
        },
    );

    if (!twRes.ok) {
        const err = await twRes.text();
        return { status: 'error', reason: (err || '').slice(0, 250) };
    }
    const d = await twRes.json().catch(() => ({}));
    return { status: 'sent', sid: d.sid || null, template: payload.templateKey, count: chosen.length };
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
