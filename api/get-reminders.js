/**
 * /api/get-reminders.js — Vercel Edge Function
 * Fetches all reminders from Airtable for the CRM dashboard.
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
    let allReminders = [];
    let offset = null;

    for (let page = 0; page < 10; page++) {
        const params = new URLSearchParams({
            'sort[0][field]':     'Due At',
            'sort[0][direction]': 'asc',
            'pageSize':           '100',
        });
        if (offset) params.set('offset', offset);

        const res = await fetch(
            `https://api.airtable.com/v0/${baseId}/Reminders?${params}`,
            { headers: { 'Authorization': `Bearer ${apiKey}` } }
        );

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            const msg = err.error?.message || err.errors?.[0]?.message || `Airtable ${res.status}`;
            return json({ error: msg, status: res.status, reminders: [] }, res.status);
        }

        const data = await res.json();
        const records = data.records || [];

        allReminders = allReminders.concat(records.map(r => ({
            id:            r.id,
            name:          r.fields['Name'] || '',
            leadRecordId:  r.fields['Lead Record ID'] || '',
            leadName:      r.fields['Lead Name'] || '',
            leadEmail:     r.fields['Lead Email'] || '',
            leadPhone:     r.fields['Lead Phone'] || '',
            agentName:     r.fields['Agent Name'] || '',
            agentEmail:    r.fields['Agent Email'] || '',
            actionType:    r.fields['Action Type'] || '',
            dueAt:         r.fields['Due At'] || '',
            note:          r.fields['Note'] || '',
            status:        r.fields['Reminder Status'] || 'Pending',
            createdAt:     r.fields['Created At'] || r.createdTime || '',
        })));

        if (!data.offset) break;
        offset = data.offset;
    }

    return json({ reminders: allReminders });
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
