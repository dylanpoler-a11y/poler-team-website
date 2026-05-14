/**
 * /api/agent/update-alerts.js — Vercel Edge Function
 * Update a lead's alert preferences with cleaner field names than the underlying
 * `update-preferences.js` (which uses Airtable field names directly).
 *
 * Body: {
 *   leadId,
 *   profile: {
 *     active?: bool,
 *     cities?: ['Miami Beach', ...],
 *     priceMin?: number,
 *     priceMax?: number,
 *     bedsMin?: number,
 *     bathsMin?: number,
 *     propertyTypes?: ['Condo', 'Single Family', ...],
 *     features?: ['Pool', 'Waterfront', ...],
 *     frequency?: 'Daily' | 'Every 3 Days' | 'Weekly' | 'Bi-Weekly' | 'Monthly',
 *     count?: number   // properties per alert
 *   }
 * }
 *
 * Auth: Bearer token (or password)
 */

export const config = { runtime: 'edge' };

import { authorize } from '../_auth.js';

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            },
        });
    }
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;

    let body;
    try { body = await req.json(); }
    catch { return json({ error: 'Invalid request body' }, 400); }

    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);

    const { leadId, profile = {} } = body;
    if (!leadId) return json({ error: 'leadId required' }, 400);

    const fields = {};
    if (profile.active !== undefined) fields['Alert Active'] = !!profile.active;
    if (Array.isArray(profile.cities)) fields['Alert Cities'] = profile.cities.join('\n');
    if (profile.priceMin !== undefined) fields['Alert Price Min'] = Number(profile.priceMin) || 0;
    if (profile.priceMax !== undefined) fields['Alert Price Max'] = Number(profile.priceMax) || 0;
    if (profile.bedsMin !== undefined) fields['Alert Beds Min'] = Number(profile.bedsMin) || 0;
    if (profile.bathsMin !== undefined) fields['Alert Baths Min'] = Number(profile.bathsMin) || 0;
    if (Array.isArray(profile.propertyTypes)) fields['Alert Property Types'] = profile.propertyTypes;
    if (profile.frequency !== undefined) fields['Alert Frequency'] = profile.frequency;
    if (profile.count !== undefined) fields['Alert Count'] = Number(profile.count) || 5;

    if (Object.keys(fields).length === 0) {
        return json({ error: 'profile must contain at least one field to update' }, 400);
    }

    const res = await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type':  'application/json',
        },
        body: JSON.stringify({
            records: [{ id: leadId, fields }],
            typecast: true,
        }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to update alerts' }, 500);
    }

    return json({ success: true, updated: Object.keys(fields) });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
