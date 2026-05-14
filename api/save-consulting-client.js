/**
 * /api/save-consulting-client.js — Vercel Edge Function
 * Creates a new consulting client in the Airtable Consulting Clients table.
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
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        });
    }

    if (req.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405);
    }

    const apiKey  = process.env.AIRTABLE_API_KEY;
    const baseId  = process.env.AIRTABLE_BASE_ID;
    const crmPass = process.env.CRM_PASSWORD;

    let body;
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Invalid request body' }, 400);
    }

    const { password } = body;
    if (!authorize(req, body).ok) {
        return json({ error: 'Unauthorized' }, 401);
    }

    if (!apiKey || !baseId) {
        return json({ error: 'Airtable not configured' }, 500);
    }

    const {
        company        = '',
        country        = '',
        status         = 'Lead',
        owner          = '',
        website        = '',
        source         = '',
        serviceType    = [],
        primaryContact = '',
        email          = '',
        phone          = '',
        notes          = '',
    } = body;

    if (!company.trim()) {
        return json({ error: 'Company is required' }, 400);
    }

    const fields = {
        'Company': company,
        'Status':  status,
        'Notes':   notes,
    };
    if (country)        fields['Country']         = country;
    if (owner)          fields['Owner']           = owner;
    if (website)        fields['Website']         = website;
    if (source)         fields['Source']          = source;
    if (Array.isArray(serviceType) && serviceType.length) fields['Service Type'] = serviceType;
    if (primaryContact) fields['Primary Contact'] = primaryContact;
    if (email)          fields['Email']           = email;
    if (phone)          fields['Phone']           = phone;

    const airtableUrl = `https://api.airtable.com/v0/${baseId}/Consulting%20Clients`;

    const res = await fetch(airtableUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type':  'application/json',
        },
        body: JSON.stringify({ records: [{ fields }], typecast: true }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to create client' }, 500);
    }

    const data = await res.json();
    return json({ success: true, id: data.records?.[0]?.id });
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
