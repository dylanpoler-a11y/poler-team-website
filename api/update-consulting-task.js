/**
 * /api/update-consulting-task.js — Vercel Edge Function
 * PATCH a task. On Status → Completed, log a Task Completed activity row.
 *
 * Body: { id, password, agent?, status?, ...fields }
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
    if (req.method !== 'PATCH') return json({ error: 'Method not allowed' }, 405);

    const apiKey  = process.env.AIRTABLE_API_KEY;
    const baseId  = process.env.AIRTABLE_BASE_ID;
    const crmPass = process.env.CRM_PASSWORD;

    let body;
    try { body = await req.json(); }
    catch { return json({ error: 'Invalid request body' }, 400); }

    const { id, password, agent = '', ...input } = body;
    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);
    if (!id) return json({ error: 'Task id is required' }, 400);

    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    // Fetch current state to know company/deal links + previous status
    const cur = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Tasks/${id}`, { headers });
    if (!cur.ok) return json({ error: 'Task not found' }, 404);
    const curData = await cur.json();
    const previousStatus = curData.fields?.['Status'] || 'Pending';
    const companyId = (curData.fields?.['Company'] || [])[0] || '';
    const dealId    = (curData.fields?.['Deal']    || [])[0] || '';
    const taskTitle = curData.fields?.['Title'] || '';

    const fields = {};
    if (input.title  !== undefined) fields['Title']  = String(input.title);
    if (input.type   !== undefined) fields['Type']   = input.type;
    if (input.dueAt  !== undefined) fields['Due At'] = input.dueAt || null;
    if (input.status !== undefined) fields['Status'] = input.status;
    if (input.owner  !== undefined) fields['Owner']  = input.owner;
    if (input.notes  !== undefined) fields['Notes']  = String(input.notes);

    if (Object.keys(fields).length === 0) {
        return json({ error: 'No fields to update' }, 400);
    }

    const patchRes = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Tasks`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ records: [{ id, fields }], typecast: true }),
    });

    if (!patchRes.ok) {
        const err = await patchRes.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to update task' }, 500);
    }

    // If we just transitioned to Completed, log activity
    const completedNow = input.status === 'Completed' && previousStatus !== 'Completed';
    if (completedNow && companyId) {
        const linkFields = { Company: [companyId] };
        if (dealId) linkFields.Deal = [dealId];
        await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Activity`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                records: [{
                    fields: {
                        'Title':   `Task completed: ${taskTitle}`,
                        'Type':    'Task Completed',
                        'Details': '',
                        'Agent':   agent,
                        ...linkFields,
                    },
                }],
                typecast: true,
            }),
        }).catch(err => console.error('Activity log failed:', err));
    }

    return json({ success: true });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
