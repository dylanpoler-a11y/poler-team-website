/**
 * /api/delete-consulting-doc.js — Vercel Edge Function
 * Removes a single attachment from a Consulting Clients record.
 *
 * Airtable doesn't support deleting a single attachment in-place — instead we
 * fetch the current attachments, filter out the target, and PATCH the array.
 *
 * Body: { id, password, field, attachmentId }
 *
 * Required env vars: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, CRM_PASSWORD
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';

const ALLOWED_FIELDS = ['Contracts', 'Deliverables', 'Spreadsheets', 'Misc'];

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

    if (!apiKey || !baseId) {
        return json({ error: 'Airtable not configured' }, 500);
    }

    let body;
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Invalid request body' }, 400);
    }

    const { id, password, field, attachmentId, targetType = 'company' } = body;
    if (!authorize(req, body).ok) {
        return json({ error: 'Unauthorized' }, 401);
    }
    if (!id || !field || !attachmentId) {
        return json({ error: 'id, field, and attachmentId are required' }, 400);
    }
    if (!ALLOWED_FIELDS.includes(field)) {
        return json({ error: `field must be one of ${ALLOWED_FIELDS.join(', ')}` }, 400);
    }
    if (!['company', 'deal'].includes(targetType)) {
        return json({ error: "targetType must be 'company' or 'deal'" }, 400);
    }

    const tableName = targetType === 'deal' ? 'Consulting%20Deals' : 'Consulting%20Clients';

    // 1. Fetch current attachments for this field
    const recordUrl = `https://api.airtable.com/v0/${baseId}/${tableName}/${id}`;
    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    const getRes = await fetch(recordUrl, { headers });
    if (!getRes.ok) {
        const err = await getRes.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to fetch record' }, 500);
    }
    const recordData = await getRes.json();
    const current = recordData.fields?.[field] || [];

    // 2. Filter out the target attachment (Airtable requires keeping {id} entries for the rest)
    const remaining = current
        .filter(a => a.id !== attachmentId)
        .map(a => ({ id: a.id }));

    // 3. PATCH back the remaining attachments
    const patchRes = await fetch(`https://api.airtable.com/v0/${baseId}/${tableName}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
            records: [{ id, fields: { [field]: remaining } }],
        }),
    });

    if (!patchRes.ok) {
        const err = await patchRes.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to delete attachment' }, 500);
    }

    const patchData = await patchRes.json();
    const attachments = patchData.records?.[0]?.fields?.[field] || [];
    return json({ success: true, attachments });
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
