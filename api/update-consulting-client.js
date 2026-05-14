/**
 * /api/update-consulting-client.js — Vercel Edge Function
 * Updates a consulting client record in Airtable.
 *
 * Body: { id, password, ...fields }
 * Accepted fields: company, country, status, serviceType, primaryContact,
 *                  email, phone, projectValue, startedAt, lastContact, notes
 *
 * Required env vars: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, CRM_PASSWORD
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';

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

    const { id, password, ...input } = body;
    if (!authorize(req, body).ok) {
        return json({ error: 'Unauthorized' }, 401);
    }
    if (!id) {
        return json({ error: 'Client id is required' }, 400);
    }

    // Map incoming field names to Airtable field names
    const fields = {};
    if (input.company        !== undefined) fields['Company']         = String(input.company);
    if (input.country        !== undefined) fields['Country']         = input.country || null;
    if (input.status         !== undefined) fields['Status']          = input.status;
    if (input.owner          !== undefined) fields['Owner']           = input.owner;
    if (input.website        !== undefined) fields['Website']         = input.website || null;
    if (input.source         !== undefined) fields['Source']          = String(input.source);
    if (input.serviceType    !== undefined) fields['Service Type']    = Array.isArray(input.serviceType) ? input.serviceType : [];
    if (input.primaryContact !== undefined) fields['Primary Contact'] = String(input.primaryContact);
    if (input.email          !== undefined) fields['Email']           = String(input.email);
    if (input.phone          !== undefined) fields['Phone']           = String(input.phone);
    if (input.notes          !== undefined) fields['Notes']           = String(input.notes);
    // 'type', 'projectValue', 'startedAt', 'lastContact' deprecated in v3 — handled at Opportunity level now

    if (Object.keys(fields).length === 0) {
        return json({ error: 'No fields to update' }, 400);
    }

    const res = await fetch(
        `https://api.airtable.com/v0/${baseId}/Consulting%20Clients`,
        {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type':  'application/json',
            },
            body: JSON.stringify({ records: [{ id, fields }], typecast: true }),
        }
    );

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to update client' }, 500);
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
