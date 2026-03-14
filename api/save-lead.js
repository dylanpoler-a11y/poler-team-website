/**
 * /api/save-lead.js — Vercel Edge Function
 * Saves a verified lead to Airtable after OTP verification.
 *
 * Required Vercel env vars:
 *   AIRTABLE_API_KEY   — Personal access token from airtable.com/create/tokens
 *   AIRTABLE_BASE_ID   — Base ID from airtable.com/api (starts with app...)
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
    };

    // Optional UTM fields (may not exist in Airtable yet)
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
