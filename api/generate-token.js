/**
 * /api/generate-token.js — Vercel Edge Function
 * Generates a unique access token for a lead's self-service preferences page.
 *
 * Auth: { id, password } in JSON body (CRM admin only)
 *
 * Required env vars: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, CRM_PASSWORD, SITE_BASE_URL
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

    const apiKey   = process.env.AIRTABLE_API_KEY;
    const baseId   = process.env.AIRTABLE_BASE_ID;
    const crmPass  = process.env.CRM_PASSWORD;
    const siteBase = process.env.SITE_BASE_URL || 'https://www.homesinsoflorida.com';

    if (!apiKey || !baseId) {
        return json({ error: 'Airtable not configured' }, 500);
    }

    let body;
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Invalid request body' }, 400);
    }

    const { id, password } = body;

    if (!crmPass || password !== crmPass) {
        return json({ error: 'Unauthorized' }, 401);
    }

    if (!id) {
        return json({ error: 'Lead ID required' }, 400);
    }

    // Generate a cryptographic random token (48 hex chars)
    const array = new Uint8Array(24);
    crypto.getRandomValues(array);
    const token = Array.from(array, b => b.toString(16).padStart(2, '0')).join('');

    // Save token to Airtable
    const res = await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type':  'application/json',
        },
        body: JSON.stringify({
            records: [{ id, fields: { 'Alert Token': token } }],
        }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to generate token' }, 500);
    }

    const prefsUrl = `${siteBase}/preferences.html?token=${token}`;

    return json({ success: true, token, url: prefsUrl });
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
