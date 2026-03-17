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

    if (!crmPass || password !== crmPass) {
        return json({ error: 'Unauthorized' }, 401);
    }

    if (!apiKey || !baseId) {
        return json({ error: 'Airtable not configured' }, 500);
    }

    // Paginate through all records (Airtable max 100/page)
    let allLeads = [];
    let offset   = null;

    for (let page = 0; page < 10; page++) {
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

        if (!res.ok) break;

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
            alertPolygon:       r.fields['Alert Polygon'] || '',
            preferredLanguage:  r.fields['Preferred Language'] || 'en',
            country:            r.fields['Country'] || '',
            timeline:           r.fields['Timeline'] || '',
            assignedTo:         r.fields['Assigned To'] || '',
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
