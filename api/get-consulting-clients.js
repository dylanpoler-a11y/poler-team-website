/**
 * /api/get-consulting-clients.js — Vercel Edge Function
 * Fetches all consulting clients from Airtable for the CRM dashboard.
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

    // Paginate through all records
    let allClients = [];
    let offset = null;

    for (let page = 0; page < 10; page++) {
        const params = new URLSearchParams({
            'sort[0][field]':     'Last Contact',
            'sort[0][direction]': 'desc',
            'pageSize':           '100',
        });
        if (offset) params.set('offset', offset);

        const res = await fetch(
            `https://api.airtable.com/v0/${baseId}/Consulting%20Clients?${params}`,
            { headers: { 'Authorization': `Bearer ${apiKey}` } }
        );

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            return json({ error: err.error?.message || 'Failed to fetch clients', clients: [] }, res.status);
        }

        const data = await res.json();
        const records = data.records || [];

        allClients = allClients.concat(records.map(r => ({
            id:              r.id,
            company:         r.fields['Company']           || '',
            country:         r.fields['Country']           || '',
            status:          r.fields['Status']            || 'Lead',
            owner:           r.fields['Owner']             || '',
            website:         r.fields['Website']           || '',
            source:          r.fields['Source']            || '',
            serviceType:     r.fields['Service Type']      || [],
            // Legacy single-contact fields preserved for migration / display fallback;
            // Contacts table is the new canonical source.
            primaryContact:  r.fields['Primary Contact']   || '',
            email:           r.fields['Email']             || '',
            phone:           r.fields['Phone']             || '',
            notes:           r.fields['Notes']             || '',
            contracts:       r.fields['Contracts']         || [],
            deliverables:    r.fields['Deliverables']      || [],
            spreadsheets:    r.fields['Spreadsheets']      || [],
            misc:            r.fields['Misc']              || [],
            createdAt:       r.fields['Created At']        || r.createdTime || '',
        })));

        if (!data.offset) break;
        offset = data.offset;
    }

    return json({ clients: allClients });
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
