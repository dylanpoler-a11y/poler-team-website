/**
 * /api/get-preferences.js — Vercel Edge Function
 * Retrieves a lead's property alert preferences.
 *
 * Auth options:
 *   ?token=xxx           — Lead self-service access (public, no password)
 *   ?id=xxx&password=yyy — CRM admin access
 *
 * Required env vars: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, CRM_PASSWORD
 */

export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        });
    }

    if (req.method !== 'GET') {
        return json({ error: 'Method not allowed' }, 405);
    }

    const apiKey  = process.env.AIRTABLE_API_KEY;
    const baseId  = process.env.AIRTABLE_BASE_ID;
    const crmPass = process.env.CRM_PASSWORD;

    if (!apiKey || !baseId) {
        return json({ error: 'Airtable not configured' }, 500);
    }

    const url      = new URL(req.url);
    const token    = url.searchParams.get('token');
    const id       = url.searchParams.get('id');
    const password = url.searchParams.get('password');

    let record;

    if (token) {
        // Lead self-service: look up by Alert Token
        const params = new URLSearchParams({
            'filterByFormula': `{Alert Token}="${token}"`,
            'maxRecords': '1',
        });
        const res = await fetch(
            `https://api.airtable.com/v0/${baseId}/Leads?${params}`,
            { headers: { 'Authorization': `Bearer ${apiKey}` } }
        );
        if (!res.ok) return json({ error: 'Failed to fetch' }, 500);
        const data = await res.json();
        if (!data.records?.length) return json({ error: 'Invalid or expired token' }, 404);
        record = data.records[0];

    } else if (id && password) {
        // CRM admin access
        if (!crmPass || password !== crmPass) {
            return json({ error: 'Unauthorized' }, 401);
        }
        const res = await fetch(
            `https://api.airtable.com/v0/${baseId}/Leads/${id}`,
            { headers: { 'Authorization': `Bearer ${apiKey}` } }
        );
        if (!res.ok) return json({ error: 'Lead not found' }, 404);
        record = await res.json();

    } else {
        return json({ error: 'Token or ID+password required' }, 400);
    }

    const f = record.fields || {};
    return json({
        success: true,
        preferences: {
            id:               record.id,
            firstName:        f['First Name'] || '',
            lastName:         f['Last Name'] || '',
            email:            f['Email'] || '',
            alertActive:      !!f['Alert Active'],
            alertPropertyTypes: f['Alert Property Types'] || [],
            alertCities:      f['Alert Cities'] || '',
            alertPriceMin:    f['Alert Price Min'] || 0,
            alertPriceMax:    f['Alert Price Max'] || 0,
            alertBeds:        f['Alert Beds Min'] || 0,
            alertBaths:       f['Alert Baths Min'] || 0,
            alertFrequency:   f['Alert Frequency'] || 'Weekly',
            alertCount:       f['Alert Count'] || 5,
            alertLastSent:    f['Alert Last Sent'] || '',
            alertNextDue:     f['Alert Next Due'] || '',
            preferredLanguage: f['Preferred Language'] || 'en',
        },
    });
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
