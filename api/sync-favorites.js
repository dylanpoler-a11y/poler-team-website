/**
 * /api/sync-favorites.js — Vercel Edge Function
 * Syncs a lead's saved/favorited properties to Airtable.
 * Called from listing.js when a lead hearts/unhearts a property.
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
    if (!apiKey || !baseId) return json({ error: 'Not configured' }, 500);

    let body;
    try { body = await req.json(); } catch { return json({ error: 'Invalid body' }, 400); }

    const { email, savedProperties } = body;
    if (!email || savedProperties === undefined) return json({ error: 'Missing fields' }, 400);

    // Find lead by email
    const formula = encodeURIComponent(`{Email} = '${email.replace(/'/g, "\\'")}'`);
    const searchRes = await fetch(
        `https://api.airtable.com/v0/${baseId}/Leads?filterByFormula=${formula}&maxRecords=1`,
        { headers: { 'Authorization': `Bearer ${apiKey}` } }
    );

    if (!searchRes.ok) return json({ error: 'Lookup failed' }, 500);
    const searchData = await searchRes.json();
    if (!searchData.records?.length) return json({ error: 'Lead not found' }, 404);

    const recordId = searchData.records[0].id;

    // Update saved properties
    const updateRes = await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            records: [{ id: recordId, fields: { 'Saved Properties': savedProperties } }],
        }),
    });

    if (!updateRes.ok) return json({ error: 'Update failed' }, 500);

    return json({ success: true });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
