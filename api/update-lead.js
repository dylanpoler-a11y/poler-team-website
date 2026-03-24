/**
 * /api/update-lead.js — Vercel Edge Function
 * Updates a lead's status and/or notes in Airtable.
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

    const { id, status, notes, assignedTo, password } = body;

    if (!crmPass || password !== crmPass) {
        return json({ error: 'Unauthorized' }, 401);
    }

    if (!id) {
        return json({ error: 'Record ID required' }, 400);
    }

    const fields = {};
    if (status     !== undefined) fields['Status']      = status;
    if (notes      !== undefined) fields['Notes']       = notes;
    if (assignedTo !== undefined) fields['Assigned To'] = assignedTo;

    if (Object.keys(fields).length === 0) {
        return json({ error: 'Nothing to update' }, 400);
    }

    const res = await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type':  'application/json',
        },
        body: JSON.stringify({ records: [{ id, fields }] }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to update lead' }, 500);
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
