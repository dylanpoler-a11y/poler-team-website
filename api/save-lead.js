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
    } = body;

    const res = await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type':  'application/json',
        },
        body: JSON.stringify({
            records: [{
                fields: {
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
                },
            }],
        }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to save lead' }, 500);
    }

    const data = await res.json();
    return json({ success: true, id: data.records?.[0]?.id });
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
