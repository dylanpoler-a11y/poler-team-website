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
import { parseAlertProfiles, serializeAlertProfiles } from '../../lib/alert-search.js';

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
    // Comma+space, NEVER newline (Kevin 2026-07-16): newline-joined values render as one
    // glued word in the CRM panel's single-line input ("Boca RatonFort Lauderdale") and the
    // email engine's comma-only split treated the whole thing as ONE unmatchable city.
    if (Array.isArray(profile.cities)) fields['Alert Cities'] = profile.cities.map(c => String(c).trim()).filter(Boolean).join(', ');
    if (profile.priceMin !== undefined) fields['Alert Price Min'] = Number(profile.priceMin) || 0;
    if (profile.priceMax !== undefined) fields['Alert Price Max'] = Number(profile.priceMax) || 0;
    if (profile.bedsMin !== undefined) fields['Alert Beds Min'] = Number(profile.bedsMin) || 0;
    if (profile.bathsMin !== undefined) fields['Alert Baths Min'] = Number(profile.bathsMin) || 0;
    if (Array.isArray(profile.propertyTypes)) fields['Alert Property Types'] = profile.propertyTypes;
    if (profile.frequency !== undefined) fields['Alert Frequency'] = profile.frequency;
    if (profile.count !== undefined) fields['Alert Count'] = Number(profile.count) || 5;

    // Alert Profiles wrapper: profiles[] and/or channels{email,whatsapp}. When only
    // one is provided, preserve the other from the record's current value so a
    // channel toggle never drops profiles (and vice-versa).
    const wantsProfiles = Array.isArray(profile.profiles);
    const wantsChannels = profile.channels && typeof profile.channels === 'object';
    // Flat features can only live inside the wrapper (no flat Airtable column) — fold
    // them into profile #1. When the caller sends profiles[] too, those win untouched:
    // features there belong per-profile.
    const wantsFeatures = !wantsProfiles && Array.isArray(profile.features);
    if (wantsProfiles || wantsChannels || wantsFeatures) {
        let curRaw = '';
        let curFields = {};
        try {
            const cur = await fetch(`https://api.airtable.com/v0/${baseId}/Leads/${leadId}`, {
                headers: { 'Authorization': `Bearer ${apiKey}` },
            });
            if (cur.ok) {
                curFields = (await cur.json()).fields || {};
                curRaw = curFields['Alert Profiles'] || '';
            }
        } catch (_) { /* fall through with defaults */ }
        const parsed = parseAlertProfiles(curRaw);
        let nextProfiles = wantsProfiles
            ? profile.profiles.slice(0, 5).filter(p => p && typeof p === 'object')
            : parsed.profiles;
        if (wantsFeatures) {
            const feats = profile.features.map(f => String(f).trim()).filter(Boolean).slice(0, 15);
            if (nextProfiles.length > 0) {
                nextProfiles = nextProfiles.map((p, i) => (i === 0 ? { ...p, features: feats } : p));
            } else {
                // Flat-only lead: synthesize the single profile the engine would have
                // built from the flat fields (profilesFromLead), request values first,
                // stored values as fallback, plus the features.
                nextProfiles = [{
                    types:    Array.isArray(profile.propertyTypes) ? profile.propertyTypes : (curFields['Alert Property Types'] || []),
                    cities:   fields['Alert Cities'] !== undefined ? fields['Alert Cities'] : (curFields['Alert Cities'] || ''),
                    priceMin: profile.priceMin !== undefined ? (Number(profile.priceMin) || 0) : (curFields['Alert Price Min'] || 0),
                    priceMax: profile.priceMax !== undefined ? (Number(profile.priceMax) || 0) : (curFields['Alert Price Max'] || 0),
                    bedsMin:  profile.bedsMin  !== undefined ? (Number(profile.bedsMin)  || 0) : (curFields['Alert Beds Min']  || 0),
                    bathsMin: profile.bathsMin !== undefined ? (Number(profile.bathsMin) || 0) : (curFields['Alert Baths Min'] || 0),
                    features: feats,
                }];
            }
        }
        const nextChannels = wantsChannels
            ? { email: profile.channels.email !== false, whatsapp: !!profile.channels.whatsapp }
            : parsed.channels;
        fields['Alert Profiles'] = serializeAlertProfiles(nextProfiles, nextChannels);
    }

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
