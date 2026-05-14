/**
 * /api/save-lead.js — Vercel Edge Function
 * Saves a verified lead to Airtable after OTP verification.
 *
 * Required Vercel env vars:
 *   AIRTABLE_API_KEY   — Personal access token from airtable.com/create/tokens
 *   AIRTABLE_BASE_ID   — Base ID from airtable.com/api (starts with app...)
 */

export const config = { runtime: 'edge' };

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

    const {
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

    // Build UTM summary string for CRM (e.g. "facebook / cpc / miami-luxury-q1")
    const utmParts = [utm_source, utm_medium, utm_campaign].filter(Boolean);
    const utmSummary = utmParts.length ? utmParts.join(' / ') : '';

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
        'Status':          'New',
        'Created At':      new Date().toISOString(),
        'Alert Token':     alertToken,
        'Access Password': accessPassword,
        'Preferred Language': language,
        ...(timeline && { 'Timeline': timeline }),
    };

    // Detect country: prefer ISO code from dropdown, fallback to phone prefix
    const country = (countryIso && ISO_COUNTRY[countryIso.toUpperCase()]) || detectCountry(phone);

    // Auto-assign agent: Portuguese/Brazil → Rosa, others → 50/50 Kevin/Rosa
    let assignedTo = '';
    if (country === 'Brazil' || language === 'pt' || country === 'Portugal') {
        assignedTo = 'Rosa';
    } else {
        // 50/50 split between Kevin and Rosa (deterministic hash)
        const hash = (email || first || last || phone || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
        assignedTo = hash % 2 === 0 ? 'Kevin' : 'Rosa';
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

    // Try with UTM fields first; if Airtable rejects unknown fields, retry without
    let res = await fetch(airtableUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ records: [{ fields: { ...coreFields, ...utmFields } }] }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (err.error?.type === 'UNKNOWN_FIELD_NAME') {
            // UTM fields don't exist in Airtable yet — retry with core fields only
            res = await fetch(airtableUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify({ records: [{ fields: coreFields }] }),
            });
        }
        if (!res.ok) {
            const retryErr = await res.json().catch(() => ({}));
            // Still return password so the user sees their credentials even if CRM save failed
            return json({ error: retryErr.error?.message || 'Failed to save lead', password: accessPassword, token: alertToken }, 500);
        }
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
        if (email) {
            const subjects = { en: 'Your Account — The Poler Team', es: 'Tu Cuenta — The Poler Team', pt: 'Sua Conta — The Poler Team' };
            emailPromises.push(
                fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: resendHeaders,
                    body: JSON.stringify({
                        from: `The Poler Team <${fromEmail}>`,
                        to: [email],
                        subject: subjects[lang] || subjects.en,
                        html: buildWelcomeEmail(first, email, accessPassword, lang),
                    }),
                }).catch(err => console.error('Welcome email failed:', err))
            );
        }

        // 2. New lead notification → Kevin, Rosa, Dylan
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
            timeline, utmSummary,
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

        // Await both before returning — Edge runtime kills pending fetches on response
        await Promise.allSettled(emailPromises);
    }

    return json({ success: true, id: data.records?.[0]?.id, token: alertToken, password: accessPassword });
}

function buildWelcomeEmail(firstName, email, password, lang) {
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
      <a href="https://www.homesinsoflorida.com/listing" style="display:inline-block;padding:14px 36px;background:#c8a55a;color:#1a2744;text-decoration:none;border-radius:8px;font-size:15px;font-weight:700;">${t.browse} →</a>
    </div>
  </td></tr>
  <tr><td style="background:#f1f5f9;padding:20px;text-align:center;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;">
    ${t.footer}
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

function buildNotificationEmail({ first, last, email, phone, listingAddress, listingPrice, sourceUrl, country, assignedTo, timeline, utmSummary }) {
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
