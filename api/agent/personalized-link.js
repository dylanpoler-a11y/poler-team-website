/**
 * /api/agent/personalized-link.js
 * Build a /listing URL with pre-applied filters + auto-login token for a lead.
 *
 * Body: { leadId | leadEmail, filters?: { city, priceMin, priceMax, bedsMin, bathsMin, waterfront, propertyType } }
 *
 * Returns: { url, expiresHint } — URL the lead can tap on phone, auto-logs them in,
 * shows the filtered results.
 */

export const config = { runtime: 'edge' };

import { authorize } from '../_auth.js';

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }});
    }
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    let body;
    try { body = await req.json(); } catch { return json({ error: 'Bad body' }, 400); }
    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);

    const { leadId, leadEmail, filters = {} } = body;
    if (!leadId && !leadEmail) return json({ error: 'leadId or leadEmail required' }, 400);

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const headers = { 'Authorization': `Bearer ${apiKey}` };

    let lead;
    if (leadId) {
        const r = await fetch(`https://api.airtable.com/v0/${baseId}/Leads/${leadId}`, { headers });
        if (!r.ok) return json({ error: 'Lead not found' }, 404);
        lead = (await r.json()).fields;
    } else {
        const formula = encodeURIComponent(`{Email}='${leadEmail.replace(/'/g, "\\'")}'`);
        const r = await fetch(`https://api.airtable.com/v0/${baseId}/Leads?filterByFormula=${formula}&maxRecords=1`, { headers });
        if (!r.ok) return json({ error: 'Airtable error', status: r.status }, r.status);
        const d = await r.json();
        if (!d.records?.[0]) return json({ error: 'Lead not found' }, 404);
        lead = d.records[0].fields;
    }

    const email = lead.Email || '';
    const token = lead['Alert Token'] || '';
    const params = new URLSearchParams();
    if (email) params.set('email', email);
    if (token) params.set('t', token);

    // Map filter keys to /listing URL params (mirror how listing.html reads them)
    if (filters.city)         params.set('city', filters.city);
    if (filters.priceMin)     params.set('priceMin', String(filters.priceMin));
    if (filters.priceMax)     params.set('priceMax', String(filters.priceMax));
    if (filters.bedsMin)      params.set('bedsMin', String(filters.bedsMin));
    if (filters.bathsMin)     params.set('bathsMin', String(filters.bathsMin));
    if (filters.waterfront)   params.set('waterfront', '1');
    if (filters.propertyType) params.set('type', filters.propertyType);

    const url = `https://homesinsoflorida.com/listing?${params}`;
    return json({
        url,
        expiresHint: 'Token does not expire; rotate by regenerating Alert Token in Airtable if leaked.',
        params: Object.fromEntries(params),
    });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
