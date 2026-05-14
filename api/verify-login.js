/**
 * /api/verify-login.js — Vercel Edge Function
 * Validates a returning lead's email + password against Airtable.
 *
 * Required Vercel env vars:
 *   AIRTABLE_API_KEY   — Personal access token
 *   AIRTABLE_BASE_ID   — Base ID (starts with app...)
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

    const { email, password } = body;
    if (!email || !password) {
        return json({ error: 'Email and password required' }, 400);
    }

    // Search Airtable for lead with matching email
    const formula = encodeURIComponent(`{Email} = '${email.replace(/'/g, "\\'")}'`);
    const airtableUrl = `https://api.airtable.com/v0/${baseId}/Leads?filterByFormula=${formula}&maxRecords=1`;

    try {
        const res = await fetch(airtableUrl, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
        });

        if (!res.ok) {
            return json({ error: 'Failed to verify credentials' }, 500);
        }

        const data = await res.json();
        if (!data.records || data.records.length === 0) {
            return json({ error: 'not_found' }, 401);
        }

        const record = data.records[0];
        const storedPassword = record.fields['Access Password'] || '';

        if (storedPassword && storedPassword === password) {
            return json({
                success: true,
                token: record.fields['Alert Token'] || '',
                firstName: record.fields['First Name'] || '',
            });
        } else {
            return json({ error: 'invalid_password' }, 401);
        }
    } catch (err) {
        return json({ error: 'Network error' }, 500);
    }
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
