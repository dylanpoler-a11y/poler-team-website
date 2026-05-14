/**
 * /api/update-reminder.js — Vercel Edge Function
 * Updates a reminder's status (Complete / Cancel) in Airtable.
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

    let body;
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Invalid request body' }, 400);
    }

    const { password, id, status, dueAt, agentName, agentEmail } = body;

    if (!authorize(req, body).ok) {
        return json({ error: 'Unauthorized' }, 401);
    }

    if (!apiKey || !baseId) {
        return json({ error: 'Airtable not configured' }, 500);
    }

    if (!id) {
        return json({ error: 'id is required' }, 400);
    }

    if (!status && !dueAt && !agentName && !agentEmail) {
        return json({ error: 'status, dueAt, or agent is required' }, 400);
    }

    const fields = {};

    if (status) {
        const validStatuses = ['Pending', 'Completed', 'Cancelled'];
        if (!validStatuses.includes(status)) {
            return json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }, 400);
        }
        fields['Reminder Status'] = status;
    }

    if (dueAt) {
        fields['Due At'] = dueAt;
    }

    if (agentName) {
        fields['Agent Name'] = agentName;
    }

    if (agentEmail) {
        fields['Agent Email'] = agentEmail;
    }

    const airtableUrl = `https://api.airtable.com/v0/${baseId}/Reminders`;

    const res = await fetch(airtableUrl, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type':  'application/json',
        },
        body: JSON.stringify({
            records: [{
                id,
                fields,
            }],
        }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to update reminder' }, 500);
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
