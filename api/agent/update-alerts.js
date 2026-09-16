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
 *     propertyTypes?: ['Condo', 'Single Family', 'Land', ...],
 *     features?: ['Pool', 'Preconstruction', 'Short-Term Rental Allowed', ...],
 *                      // Same vocabulary as the CRM panel's Features checkboxes
 *                      // (lib/alert-search.js matchesFeature). 'Preconstruction' =
 *                      // new-development units only (PropertyCondition New/Under
 *                      // Construction). Stored on the FIRST wrapper profile (one is
 *                      // synthesized from the flat fields if none exists) because
 *                      // there is no flat Airtable features column.
 *     frequency?: 'Daily' | 'Every 3 Days' | 'Weekly' | 'Bi-Weekly' | 'Monthly',
 *     count?: number,  // properties per alert
 *     channels?: { email?: bool, whatsapp?: bool },  // delivery channels (default email-only).
 *                      // Stored inside the Alert Profiles wrapper; setting one preserves profiles.
 *     autoProfileConfirm?: true,  // 2026-09-16: lead confirmed (or restated) a site-derived
 *                      // auto profile → profile #1 gets auto:false, autoConfirmed:true
 *     profiles?: [     // MULTI-PROFILE (e.g. a house budget AND a land budget):
 *       { name?, types: ['Single Family'|'Condo'|'Townhouse'|'Multi Family'|'Land'|'For Rent'],
 *         cities: 'Miramar, Homestead',  // comma-separated STRING (engine format)
 *         priceMin?, priceMax?, bedsMin?, bathsMin?, features? }
 *     ]                // stored as JSON in 'Alert Profiles'; when present the alert
 *                      // engine uses it INSTEAD of the flat fields (lib/alert-search.js).
 *                      // Pass [] to clear back to the flat single profile.
 *   }
 * }
 *
 * Auth: Bearer token (or password)
 */

export const config = { runtime: 'edge' };

import { authorize } from '../_auth.js';
import { computeAlertFields, needsCurrentRecord } from '../../lib/alert-profile-fields.js';

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

    // All folding rules (flat columns ↔ Alert Profiles wrapper, features, auto metadata)
    // live in lib/alert-profile-fields.js — shared with api/agent/derive-profile.js.
    let curFields = {};
    if (needsCurrentRecord(profile)) {
        try {
            const cur = await fetch(`https://api.airtable.com/v0/${baseId}/Leads/${leadId}`, {
                headers: { 'Authorization': `Bearer ${apiKey}` },
            });
            if (cur.ok) curFields = (await cur.json()).fields || {};
        } catch (_) { /* fall through with defaults */ }
    }
    const fields = computeAlertFields(profile, curFields);

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
