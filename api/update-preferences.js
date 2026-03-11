/**
 * /api/update-preferences.js — Vercel Edge Function
 * Updates a lead's property alert preferences in Airtable.
 *
 * Auth options (in JSON body):
 *   { token, ...fields }           — Lead self-service access
 *   { id, password, ...fields }    — CRM admin access
 *
 * Accepted fields:
 *   alertActive, propertyTypes, cities, priceMin, priceMax,
 *   bedsMin, bathsMin, frequency, count, preferredLanguage
 *
 * Required env vars: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, CRM_PASSWORD
 */

export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'PATCH, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        });
    }

    if (req.method !== 'PATCH') {
        return json({ error: 'Method not allowed' }, 405);
    }

    const apiKey  = process.env.AIRTABLE_API_KEY;
    const baseId  = process.env.AIRTABLE_BASE_ID;
    const crmPass = process.env.CRM_PASSWORD;

    if (!apiKey || !baseId) {
        return json({ error: 'Airtable not configured' }, 500);
    }

    let body;
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Invalid request body' }, 400);
    }

    const { token, id, password, ...prefs } = body;
    let recordId;

    if (token) {
        // Lead self-service: look up record ID by token
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
        recordId = data.records[0].id;

    } else if (id && password) {
        if (!crmPass || password !== crmPass) {
            return json({ error: 'Unauthorized' }, 401);
        }
        recordId = id;

    } else {
        return json({ error: 'Token or ID+password required' }, 400);
    }

    // Map incoming field names to Airtable field names
    const fields = {};
    if (prefs.alertActive !== undefined)      fields['Alert Active']         = !!prefs.alertActive;
    if (prefs.propertyTypes !== undefined)     fields['Alert Property Types'] = Array.isArray(prefs.propertyTypes) ? prefs.propertyTypes : [];
    if (prefs.cities !== undefined)            fields['Alert Cities']         = String(prefs.cities);
    if (prefs.priceMin !== undefined)          fields['Alert Price Min']      = Number(prefs.priceMin) || 0;
    if (prefs.priceMax !== undefined)          fields['Alert Price Max']      = Number(prefs.priceMax) || 0;
    if (prefs.bedsMin !== undefined)           fields['Alert Beds Min']       = Number(prefs.bedsMin) || 0;
    if (prefs.bathsMin !== undefined)          fields['Alert Baths Min']      = Number(prefs.bathsMin) || 0;
    if (prefs.frequency !== undefined)         fields['Alert Frequency']      = prefs.frequency;
    if (prefs.count !== undefined)             fields['Alert Count']          = Number(prefs.count) || 5;
    if (prefs.preferredLanguage !== undefined) fields['Preferred Language']   = prefs.preferredLanguage;

    // If activating alerts and no next due date is set, set it to now (send on next cron run)
    if (prefs.alertActive && !prefs.alertNextDue) {
        fields['Alert Next Due'] = new Date().toISOString().split('T')[0];
    }

    if (Object.keys(fields).length === 0) {
        return json({ error: 'No preferences to update' }, 400);
    }

    const res = await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type':  'application/json',
        },
        body: JSON.stringify({ records: [{ id: recordId, fields }] }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to update preferences' }, 500);
    }

    return json({ success: true });
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
