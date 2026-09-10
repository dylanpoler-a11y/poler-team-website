/**
 * /api/save-lead.js — Vercel Edge Function
 * Saves a verified lead to Airtable after OTP verification.
 *
 * Required Vercel env vars:
 *   AIRTABLE_API_KEY   — Personal access token from airtable.com/create/tokens
 *   AIRTABLE_BASE_ID   — Base ID from airtable.com/api (starts with app...)
 */

export const config = { runtime: 'edge' };

import { sendCapiEvent } from './_capi.js';
import { authorize } from './_auth.js';

// ISO 2-letter code → country name (matches listing.html dropdown)
const ISO_COUNTRY = {
    US:'United States',AL:'Albania',AG:'Antigua and Barbuda',AR:'Argentina',AW:'Aruba',
    AT:'Austria',BS:'Bahamas',BB:'Barbados',BE:'Belgium',BZ:'Belize',BO:'Bolivia',
    BR:'Brazil',BG:'Bulgaria',CA:'Canada',KY:'Cayman Islands',CL:'Chile',CO:'Colombia',
    CR:'Costa Rica',HR:'Croatia',CU:'Cuba',CW:'Curacao',CY:'Cyprus',CZ:'Czech Republic',
    DK:'Denmark',DM:'Dominica',DO:'Dominican Republic',EC:'Ecuador',SV:'El Salvador',
    EE:'Estonia',FI:'Finland',FR:'France',DE:'Germany',GR:'Greece',GD:'Grenada',
    GT:'Guatemala',GY:'Guyana',HT:'Haiti',HN:'Honduras',HU:'Hungary',IS:'Iceland',
    IE:'Ireland',IT:'Italy',JM:'Jamaica',LV:'Latvia',LT:'Lithuania',LU:'Luxembourg',
    MT:'Malta',MX:'Mexico',NL:'Netherlands',NI:'Nicaragua',NO:'Norway',PA:'Panama',
    PY:'Paraguay',PE:'Peru',PL:'Poland',PT:'Portugal',PR:'Puerto Rico',RO:'Romania',
    RS:'Serbia',SK:'Slovakia',SI:'Slovenia',ES:'Spain',KN:'Saint Kitts and Nevis',
    LC:'Saint Lucia',VC:'Saint Vincent',SR:'Suriname',SE:'Sweden',CH:'Switzerland',
    TT:'Trinidad and Tobago',TR:'Turkey',UA:'Ukraine',UK:'United Kingdom',UY:'Uruguay',
    VE:'Venezuela',
};

// Detect country from phone number country code
function detectCountry(phone) {
    if (!phone) return '';
    const p = phone.replace(/[\s\-().]/g, '');
    // Order matters: check longer prefixes first to avoid false matches
    // Puerto Rico area codes (+1787, +1939) must come before +1
    const codes = [
        ['+1787', 'Puerto Rico'],
        ['+1939', 'Puerto Rico'],
        ['+55',  'Brazil'],
        ['+504', 'Honduras'],
        ['+502', 'Guatemala'],
        ['+503', 'El Salvador'],
        ['+505', 'Nicaragua'],
        ['+506', 'Costa Rica'],
        ['+507', 'Panama'],
        ['+52',  'Mexico'],
        ['+53',  'Cuba'],
        ['+57',  'Colombia'],
        ['+58',  'Venezuela'],
        ['+54',  'Argentina'],
        ['+56',  'Chile'],
        ['+51',  'Peru'],
        ['+591', 'Bolivia'],
        ['+593', 'Ecuador'],
        ['+595', 'Paraguay'],
        ['+598', 'Uruguay'],
        ['+1',   'United States'],
        ['+44',  'United Kingdom'],
        ['+34',  'Spain'],
        ['+351', 'Portugal'],
        ['+33',  'France'],
        ['+49',  'Germany'],
        ['+39',  'Italy'],
        ['+81',  'Japan'],
        ['+86',  'China'],
        ['+91',  'India'],
        ['+61',  'Australia'],
        ['+972', 'Israel'],
    ];
    for (const [prefix, country] of codes) {
        if (p.startsWith(prefix)) return country;
    }
    return '';
}

export default async function handler(req, context) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        });
    }

    if (req.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405);
    }

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;

    if (!apiKey || !baseId) {
        return json({ error: 'Airtable not configured' }, 500);
    }

    let body;
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Invalid request body' }, 400);
    }

    let {
        first = '',
        last  = '',
        email = '',
        phone = '',
        listingAddress = '',
        listingPrice   = 0,
        sourceUrl      = '',
        utm_source     = '',
        utm_medium     = '',
        utm_campaign   = '',
        utm_content    = '',
        utm_term       = '',
        fbclid         = '',
        language       = 'en',
        timeline       = '',
        countryIso     = '',
    } = body;

    // The MCP create_lead tool (api/mcp.js + poler-team-mcp) sends firstName/lastName —
    // accept both shapes so agent-created leads don't lose their name.
    if (!first && typeof body.firstName === 'string') first = body.firstName;
    if (!last  && typeof body.lastName  === 'string') last  = body.lastName;

    // ── Manual CRM entry (the crm.html "+ Add Contact" button) ──
    // Someone Kevin types in himself is NOT a website lead: it must never auto-fire the
    // "here are your login credentials" welcome email at a contact he already knows, and
    // the internal "New Lead" blast is noise when he is the one entering it. Both become
    // opt-in, and the flag only counts when the caller holds CRM auth — otherwise the
    // public form endpoint could be used to silently suppress lead notifications.
    const manualEntry = body.manualEntry === true && authorize(req, body).ok;
    const sendWelcome = manualEntry ? body.sendWelcomeEmail === true : true;
    const notifyTeam  = manualEntry ? body.notifyTeam       === true : true;

    // A hand-added contact defaults to "Contacted", NOT "New". The Sammy/Claudia engine's
    // new-lead funnel only picks up status === "New", and its 954 signup intro opens with
    // "You just signed up on our website" — false and off-key for someone Kevin already
    // knows. Defaulting off "New" keeps a manual add out of that funnel entirely, with no
    // change needed in the engine. Kevin can still choose "New" in the modal to opt a
    // manual contact INTO the automated funnel on purpose.
    // Root: 2026-08-18 — Pepe Wong (a client of years, Peru) was added by hand and got the
    // English cold-lead intro from the 954 within 60 seconds.
    const leadStatus = manualEntry
        ? ((typeof body.status === 'string' && body.status.trim()) || 'Contacted')
        : 'New';

    // Build UTM summary string for CRM (e.g. "facebook / cpc / miami-luxury-q1")
    const utmParts = [utm_source, utm_medium, utm_campaign].filter(Boolean);
    const utmSummary = utmParts.length ? utmParts.join(' / ') : '';

    // ── TCPA / WhatsApp consent record ──
    // Exact disclosure text shown on the form (mirror of i18n.js `consentDisclosure`).
    // Clicking submit = the affirmative act; we store time + IP + exact text as the record.
    const CONSENT_TEXT = {
        en: 'By submitting, you agree to be contacted by The Poler Team via call, text, and WhatsApp — including by automated or AI-assisted means — at the number provided. Consent isn’t required to buy or sell.',
        es: 'Al enviar, aceptas recibir llamadas, mensajes de texto y WhatsApp de The Poler Team, incluyendo por medios automatizados o asistidos por IA, al número que proporcionas. El consentimiento no es necesario para comprar o vender.',
        pt: 'Ao enviar, você concorda em receber ligações, mensagens de texto e WhatsApp da The Poler Team, inclusive por meios automatizados ou assistidos por IA, no número fornecido. O consentimento não é necessário para comprar ou vender.',
    };
    const consentLang = CONSENT_TEXT[language] ? language : 'en';
    const consentIp = (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '').split(',')[0].trim();
    const consentRecord = `${new Date().toISOString()} | IP: ${consentIp || 'unknown'} | lang: ${consentLang} | src: ${sourceUrl || 'listing'} | "${CONSENT_TEXT[consentLang]}"`;

    // Generate a unique token for lead self-service preferences page
    const tokenArray = new Uint8Array(24);
    crypto.getRandomValues(tokenArray);
    const alertToken = Array.from(tokenArray, b => b.toString(16).padStart(2, '0')).join('');

    // Generate a simple, memorable access password
    const namePrefix = (first || 'User').substring(0, 3).charAt(0).toUpperCase() + (first || 'User').substring(1, 3).toLowerCase();
    const phoneSuffix = (phone || '').replace(/\D/g, '').slice(-4) || '0000';
    const randDigits = String(Math.floor(Math.random() * 90) + 10);
    const accessPassword = namePrefix + phoneSuffix + randDigits;

    // Core fields that always exist in Airtable
    const coreFields = {
        'Name':            `${first} ${last}`.trim(),
        'First Name':      first,
        'Last Name':       last,
        'Email':           email,
        'Phone':           phone,
        'Source URL':      sourceUrl,
        'Listing Address': listingAddress,
        'Listing Price':   Number(listingPrice) || 0,
        'Status':          leadStatus,
        'Created At':      new Date().toISOString(),
        'Alert Token':     alertToken,
        'Access Password': accessPassword,
        'Preferred Language': language,
        ...(timeline && { 'Timeline': timeline }),
        ...(typeof body.notes === 'string' && body.notes.trim() && { 'Notes': body.notes }),
    };

    // Detect country: explicit full name (MCP create_lead) > ISO code from dropdown > phone prefix
    const country = (typeof body.country === 'string' && body.country.trim())
        || (countryIso && ISO_COUNTRY[countryIso.toUpperCase()])
        || detectCountry(phone);

    // Auto-assign agent: explicit (MCP create_lead) > Portuguese/Brazil → Rosa > 75/25 Kevin/Rosa
    let assignedTo = (typeof body.assignedTo === 'string' && body.assignedTo.trim()) || '';
    if (assignedTo) {
        // explicit assignment from an agent tool — keep as-is
    } else if (country === 'Brazil' || language === 'pt' || country === 'Portugal') {
        assignedTo = 'Rosa';
    } else {
        // 75/25 split Kevin/Rosa (Kevin's instruction 2026-07-15 — was 50/50).
        // Deterministic hash so a duplicate submit assigns the same agent:
        // hash % 4 → 0,1,2 = Kevin (75%), 3 = Rosa (25%).
        const hash = (email || first || last || phone || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
        assignedTo = hash % 4 === 3 ? 'Rosa' : 'Kevin';
    }
    coreFields['Assigned To'] = assignedTo;

    // Country is core data — always save it
    if (country) {
        coreFields['Country'] = country;
    }

    // Optional fields (may not exist in Airtable yet — graceful fallback below)
    const utmFields = {
        ...(utmSummary   && { 'UTM Campaign': utmSummary }),
        ...(utm_source   && { 'UTM Source': utm_source }),
        ...(utm_medium   && { 'UTM Medium': utm_medium }),
        ...(utm_content  && { 'UTM Content': utm_content }),
        ...(fbclid       && { 'Facebook Click ID': fbclid }),
    };

    const airtableUrl = `https://api.airtable.com/v0/${baseId}/Leads`;
    const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
    };

    // Write order degrades gracefully on missing optional columns: full → drop UTM (keep
    // consent) → core only. Consent persists whenever its column exists, independent of UTM,
    // and lead capture NEVER breaks on a missing optional column.
    const postFields = (fields) => fetch(airtableUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ records: [{ fields }] }),
    });
    const isUnknownField = async (r) => ((await r.clone().json().catch(() => ({}))).error?.type === 'UNKNOWN_FIELD_NAME');

    let res = await postFields({ ...coreFields, ...utmFields, 'TCPA Consent': consentRecord });
    if (!res.ok && await isUnknownField(res)) {
        res = await postFields({ ...coreFields, ...utmFields });   // drop consent col if absent, keep UTM
        if (!res.ok && await isUnknownField(res)) {
            res = await postFields(coreFields);                    // last resort — core only
        }
    }
    if (!res.ok) {
        const retryErr = await res.json().catch(() => ({}));
        // Still return password so the user sees their credentials even if CRM save failed
        return json({ error: retryErr.error?.message || 'Failed to save lead', password: accessPassword, token: alertToken }, 500);
    }

    const data = await res.json();

    // Send emails via Resend — must be awaited before returning, Edge runtime
    // terminates immediately on response and kills any pending fire-and-forget fetches.
    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.ALERT_FROM_EMAIL || 'alerts@homesinsoflorida.com';
    if (resendKey) {
        const lang = language || 'en';
        const resendHeaders = { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' };
        const emailPromises = [];

        // 1. Welcome email → new lead (with login credentials)
        if (email && sendWelcome) {
            const subjects = { en: 'Your Account — The Poler Team', es: 'Tu Cuenta — The Poler Team', pt: 'Sua Conta — The Poler Team' };
            emailPromises.push(
                fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: resendHeaders,
                    body: JSON.stringify({
                        from: `The Poler Team <${fromEmail}>`,
                        to: [email],
                        subject: subjects[lang] || subjects.en,
                        html: buildWelcomeEmail(first, email, accessPassword, lang, alertToken),
                    }),
                }).catch(err => console.error('Welcome email failed:', err))
            );
        }

        // 2. New lead notification → Kevin, Rosa, Dylan
        if (notifyTeam) {
            const notifyRecipients = [
                'kevinpolermiami@gmail.com',
                'rosadasilvapoler@gmail.com',
                'rosapoler@hotmail.com',
                'dylan@poler.org',
            ];
            const notifyHtml = buildNotificationEmail({
                first, last, email, phone,
                listingAddress, listingPrice,
                sourceUrl, country, assignedTo,
                timeline, utmSummary, consentRecord,
            });
            emailPromises.push(
                fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: resendHeaders,
                    body: JSON.stringify({
                        from: `New Lead <${fromEmail}>`,
                        to: notifyRecipients,
                        subject: `New Lead: ${first} ${last}${country ? ` (${country})` : ''}`,
                        html: notifyHtml,
                    }),
                }).then(async r => {
                    if (!r.ok) {
                        const body = await r.json().catch(() => ({}));
                        console.error('Notification email failed:', r.status, JSON.stringify(body));
                    }
                }).catch(err => console.error('Notification email error:', err))
            );
        }

        // Await both before returning — Edge runtime kills pending fetches on response
        await Promise.allSettled(emailPromises);
    }

    // Server-side Meta Conversions API mirror of the browser 'Lead' pixel event (listing.js
    // completeLead()). No-ops entirely unless META_CAPI_ACCESS_TOKEN is set. A CAPI failure
    // must NEVER break the lead save, which has already fully succeeded by this point.
    // Prefer context.waitUntil (Vercel Edge prod) so the CAPI fetch runs AFTER the response
    // is sent — zero added latency. If waitUntil is ever absent, fall back to awaiting so the
    // event is never silently dropped (token-less it returns instantly anyway). The trailing
    // .catch(()=>{}) guarantees a late CAPI error can never surface.
    const _capiCall = sendCapiEvent({
        eventName: 'Lead',
        eventId: body.metaEventId || 'srv-' + (data.records?.[0]?.id || Date.now()),
        eventSourceUrl: body.pageUrl || sourceUrl || req.headers.get('referer') || '',
        userData: {
            email,
            phone,
            firstName: first,
            lastName:  last,
            country:   countryIso,
            fbp:       body.fbp,
            fbc:       body.fbc,
        },
        customData: {
            content_category: 'Real Estate',
            currency: 'USD',
            value: Number(body.listPrice) || Number(listingPrice) || 0,
        },
        req,
    }).catch(() => {});
    if (typeof context?.waitUntil === 'function') { context.waitUntil(_capiCall); }
    else { try { await _capiCall; } catch (_) {} }

    return json({ success: true, id: data.records?.[0]?.id, token: alertToken, password: accessPassword });
}

function buildWelcomeEmail(firstName, email, password, lang, alertToken) {
    // ?t= = popup-bypass token (2026-09-10): the bare /listing link re-gated every
    // lead who clicked it from a device/browser without their localStorage.
    const browseUrl = 'https://www.homesinsoflorida.com/listing' + (alertToken ? `?t=${alertToken}` : '');
    const i = {
        en: { hi: `Hi ${firstName}!`, msg: 'Your account has been created. Here are your login credentials:', emailLabel: 'Email', passLabel: 'Password', note: 'Use these credentials to browse properties without registering again. You\'ll also find them in every property alert email.', browse: 'Browse Properties', footer: 'Rosa Poler · The Poler Team · (954) 235-4046 · rosadasilvapoler@gmail.com' },
        es: { hi: `¡Hola ${firstName}!`, msg: 'Tu cuenta ha sido creada. Aquí están tus credenciales:', emailLabel: 'Correo', passLabel: 'Contraseña', note: 'Usa estas credenciales para ver propiedades sin registrarte de nuevo. También las encontrarás en cada alerta de propiedades.', browse: 'Explorar Propiedades', footer: 'Rosa Poler · The Poler Team · (954) 235-4046 · rosadasilvapoler@gmail.com' },
        pt: { hi: `Olá ${firstName}!`, msg: 'Sua conta foi criada. Aqui estão suas credenciais:', emailLabel: 'Email', passLabel: 'Senha', note: 'Use estas credenciais para ver imóveis sem se registrar novamente. Você também as encontrará em cada alerta de imóveis.', browse: 'Explorar Imóveis', footer: 'Rosa Poler · The Poler Team · (954) 235-4046 · rosadasilvapoler@gmail.com' },
    };
    const t = i[lang] || i.en;
    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 0;">
<table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <tr><td style="background:#1a2744;padding:24px 30px;text-align:center;">
    <span style="font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:700;color:#fff;">The Poler Team</span><br>
    <span style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Optimar International Realty</span>
  </td></tr>
  <tr><td style="padding:30px;">
    <div style="font-size:20px;font-weight:700;color:#1a2744;margin-bottom:8px;">${t.hi}</div>
    <div style="font-size:14px;color:#475569;margin-bottom:24px;">${t.msg}</div>
    <div style="background:#eff6ff;border:2px solid #3b82f6;border-radius:12px;padding:20px 24px;margin-bottom:20px;">
      <div style="font-size:13px;font-weight:700;color:#1e40af;margin-bottom:10px;">🔑 LOGIN</div>
      <div style="font-size:15px;color:#1e3a5f;line-height:2.2;">
        <strong>${t.emailLabel}:</strong> ${email}<br>
        <strong>${t.passLabel}:</strong> <span style="font-size:20px;font-weight:800;color:#1e40af;letter-spacing:1px;">${password}</span>
      </div>
    </div>
    <div style="font-size:13px;color:#64748b;margin-bottom:24px;">${t.note}</div>
    <div style="text-align:center;">
      <a href="${browseUrl}" style="display:inline-block;padding:14px 36px;background:#c8a55a;color:#1a2744;text-decoration:none;border-radius:8px;font-size:15px;font-weight:700;">${t.browse} →</a>
    </div>
  </td></tr>
  <tr><td style="background:#f1f5f9;padding:20px;text-align:center;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;">
    ${t.footer}
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

function buildNotificationEmail({ first, last, email, phone, listingAddress, listingPrice, sourceUrl, country, assignedTo, timeline, utmSummary, consentRecord }) {
    const name = `${first} ${last}`.trim() || 'Unknown';
    const price = listingPrice ? `$${Number(listingPrice).toLocaleString()}` : '—';
    const row = (label, value) => value
        ? `<tr><td style="padding:6px 0;font-size:13px;color:#64748b;width:140px;vertical-align:top;">${label}</td><td style="padding:6px 0;font-size:13px;color:#1a2744;font-weight:500;">${value}</td></tr>`
        : '';
    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 0;">
<table width="100%" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <tr><td style="background:#1a2744;padding:20px 30px;">
    <span style="font-size:18px;font-weight:700;color:#fff;">🔔 New Lead — The Poler Team</span>
  </td></tr>
  <tr><td style="padding:28px 30px;">
    <div style="font-size:22px;font-weight:700;color:#1a2744;margin-bottom:20px;">${name}</div>
    <table cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #e2e8f0;">
      ${row('Email', email ? `<a href="mailto:${email}" style="color:#3b82f6;">${email}</a>` : '')}
      ${row('Phone', phone ? `<a href="tel:${phone}" style="color:#3b82f6;">${phone}</a>` : '')}
      ${row('Country', country)}
      ${row('Assigned To', assignedTo)}
      ${row('Timeline', timeline)}
      ${row('Interested In', listingAddress)}
      ${row('Listing Price', listingAddress ? price : '')}
      ${row('Source', utmSummary)}
      ${row('Page URL', sourceUrl ? `<a href="${sourceUrl}" style="color:#3b82f6;word-break:break-all;">${sourceUrl}</a>` : '')}
      ${row('Consent', consentRecord ? `<span style="font-size:11px;color:#64748b;word-break:break-word;">${consentRecord}</span>` : '')}
    </table>
    <div style="margin-top:24px;text-align:center;">
      <a href="https://www.homesinsoflorida.com/crm" style="display:inline-block;padding:12px 32px;background:#1a2744;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Open CRM →</a>
    </div>
  </td></tr>
  <tr><td style="background:#f1f5f9;padding:16px 30px;text-align:center;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0;">
    The Poler Team · homesinsoflorida.com
  </td></tr>
</table>
</td></tr></table></body></html>`;
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
