/**
 * /api/create-reminder.js — Vercel Edge Function
 * Creates a new reminder in the Airtable Reminders table.
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
        leadRecordId = '',
        leadName     = '',
        leadEmail    = '',
        leadPhone    = '',
        agentName    = '',
        agentEmail   = '',
        actionType   = 'Follow Up',
        dueAt        = '',
        note         = '',
    } = body;

    if (!leadRecordId || !dueAt) {
        return json({ error: 'leadRecordId and dueAt are required' }, 400);
    }

    const fields = {
        'Name':            `${actionType} - ${leadName}`.substring(0, 100),
        'Lead Record ID':  leadRecordId,
        'Lead Name':       leadName,
        'Lead Email':      leadEmail,
        'Lead Phone':      leadPhone,
        'Agent Name':      agentName,
        'Agent Email':     agentEmail,
        'Action Type':     actionType,
        'Due At':          dueAt,
        'Note':            note,
        'Reminder Status': 'Pending',
        'Created At':      new Date().toISOString(),
    };

    const airtableUrl = `https://api.airtable.com/v0/${baseId}/Reminders`;

    const res = await fetch(airtableUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type':  'application/json',
        },
        body: JSON.stringify({ records: [{ fields }] }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to create reminder' }, 500);
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
