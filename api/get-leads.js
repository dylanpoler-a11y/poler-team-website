/**
 * /api/get-leads.js — Vercel Edge Function
 * Fetches all leads from Airtable for the CRM dashboard.
 *
 * Required Vercel env vars:
 *   AIRTABLE_API_KEY
 *   AIRTABLE_BASE_ID
 *   CRM_PASSWORD
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';

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

    const url      = new URL(req.url);
    const password = url.searchParams.get('password');

    if (!authorize(req, null).ok) {
        return json({ error: 'Unauthorized' }, 401);
    }

    if (!apiKey || !baseId) {
        return json({ error: 'Airtable not configured' }, 500);
    }

    // Paginate through ALL records (Airtable max 100/page). Was capped at 10
    // pages (1,000 records) — same silent-truncation bug fixed in
    // get-reminders.js 2026-07-16: sorted newest-first, the OLDEST leads would
    // silently vanish from the CRM once the table passed 1,000 rows. The
    // 200-page bound (20k) is just a runaway safety net. (Audit 2026-07-17.)
    let allLeads = [];
    let offset   = null;

    for (let page = 0; page < 200; page++) {
        const params = new URLSearchParams({
            'sort[0][field]':     'Created At',
            'sort[0][direction]': 'desc',
            'pageSize':           '100',
        });
        if (offset) params.set('offset', offset);

        const res = await fetch(
            `https://api.airtable.com/v0/${baseId}/Leads?${params}`,
            { headers: { 'Authorization': `Bearer ${apiKey}` } }
        );

        // Hard fail loud instead of silently returning empty — used to swallow
        // 429 (Airtable quota exhausted) and 401/403 and just return { leads:[] }.
        // Now surfaces the real error so the CRM UI shows what's broken.
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            const msg = err.error?.message || err.errors?.[0]?.message || `Airtable ${res.status}`;
            return json({ error: msg, status: res.status, leads: [] }, res.status);
        }

        const data = await res.json();
        const records = data.records || [];

        allLeads = allLeads.concat(records.map(r => ({
            id:             r.id,
            name:           r.fields['Name']            || '',
            firstName:      r.fields['First Name']      || '',
            lastName:       r.fields['Last Name']       || '',
            email:          r.fields['Email']           || '',
            phone:          r.fields['Phone']           || '',
            sourceUrl:      r.fields['Source URL']      || '',
            listingAddress: r.fields['Listing Address'] || '',
            listingPrice:   r.fields['Listing Price']   || 0,
            status:         r.fields['Status']          || 'New',
            notes:          r.fields['Notes']           || '',
            flashRecordings: r.fields['Flash Recordings'] || '[]',
            createdAt:      r.fields['Created At']      || r.createdTime || '',
            // Alert preferences
            alertActive:        !!r.fields['Alert Active'],
            alertPropertyTypes: r.fields['Alert Property Types'] || [],
            alertCities:        r.fields['Alert Cities'] || '',
            alertPriceMin:      r.fields['Alert Price Min'] || 0,
            alertPriceMax:      r.fields['Alert Price Max'] || 0,
            alertBeds:          r.fields['Alert Beds Min'] || 0,
            alertBaths:         r.fields['Alert Baths Min'] || 0,
            alertFrequency:     r.fields['Alert Frequency'] || 'Weekly',
            alertCount:         r.fields['Alert Count'] || 5,
            alertLastSent:      r.fields['Alert Last Sent'] || '',
            alertNextDue:       r.fields['Alert Next Due'] || '',
            alertToken:         r.fields['Alert Token'] || '',
            accessPassword:     r.fields['Access Password'] || '',
            alertPolygon:       r.fields['Alert Polygon'] || '',
            alertProfiles:      r.fields['Alert Profiles'] || '[]',
            alertNeedsReview:    !!r.fields['Alert Needs Review'],
            alertZeroRuns:       Number(r.fields['Alert Zero Runs'] || 0),
            alertLastSkipReason: r.fields['Alert Last Skip Reason'] || '',
            preferredLanguage:  r.fields['Preferred Language'] || 'en',
            country:            r.fields['Country'] || '',
            timeline:           r.fields['Timeline'] || '',
            assignedTo:         r.fields['Assigned To'] || '',
            lastLogin:          r.fields['Last Login'] || '',
            propertiesViewed:   r.fields['Properties Viewed'] || '[]',
            totalPropertiesViewed: r.fields['Total Properties Viewed'] || 0,
            savedProperties:    r.fields['Saved Properties'] || '[]',
            totalTimeSpent:     r.fields['Total Time Spent'] || 0,
        })));

        if (!data.offset) break;
        offset = data.offset;
    }

    return json({ leads: allLeads });
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
