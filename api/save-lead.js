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
            return json({ error: retryErr.error?.message || 'Failed to save lead' }, 500);
        }
    }

    const data = await res.json();
    return json({ success: true, id: data.records?.[0]?.id, token: alertToken });
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
