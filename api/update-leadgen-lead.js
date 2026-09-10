/**
 * /api/update-leadgen-lead.js — Vercel Edge Function
 *
 * Updates a Lead Generation lead — pipeline stage drags, notes, owner,
 * last-contact stamps. Logs a Status Change activity row when the stage moves.
 *
 *   PATCH { id, status?, notes?, owner?, name?, email?, company?, title?,
 *           phone?, contactedFrom?, website?, campaign?, sentiment?, summary?, stampContact?, agent? }
 *   → { ok, lead }
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';
import {
    TABLES, creds, json, preflight, listAll, updateRecord,
    mapLead, logActivity, STATUSES, SENTIMENTS, esc,
} from './_leadgen.js';

export default async function handler(req) {
    if (req.method === 'OPTIONS') return preflight('PATCH, POST');
    if (req.method !== 'PATCH' && req.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405);
    }

    let body;
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Invalid JSON body' }, 400);
    }

    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);

    const { apiKey, baseId } = creds();
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);
    if (!body.id) return json({ error: 'id is required' }, 400);

    if (body.status && !STATUSES.includes(body.status)) {
        return json({ error: `status must be one of: ${STATUSES.join(', ')}` }, 400);
    }
    if (body.sentiment && !SENTIMENTS.includes(body.sentiment)) {
        return json({ error: `sentiment must be one of: ${SENTIMENTS.join(', ')}` }, 400);
    }

    // Read the current stage first so the activity row can say "X → Y".
    let prevStatus = '';
    if (body.status) {
        const cur = await listAll(TABLES.leads, { filter: `RECORD_ID() = '${esc(body.id)}'` });
        if (cur.ok && cur.records[0]) prevStatus = cur.records[0].fields?.['Status'] || '';
    }

    const fields = {};
    const put = (k, v) => { if (v !== undefined) fields[k] = v; };
    put('Status',   body.status);
    put('Notes',    body.notes);
    put('Owner',    body.owner);
    put('Name',     body.name);
    put('Email',    body.email);
    put('Company',  body.company);
    put('Title',    body.title);
    put('Phone',    body.phone);
    put('Contacted From', body.contactedFrom);
    put('Website',  body.website);
    put('Campaign', body.campaign);
    put('Sentiment', body.sentiment);
    put('Summary',   body.summary);
    if (body.stampContact) fields['Last Contact'] = new Date().toISOString().slice(0, 10);

    if (!Object.keys(fields).length) return json({ error: 'nothing to update' }, 400);

    const res = await updateRecord(TABLES.leads, body.id, fields);
    if (!res.ok) return json({ error: res.error }, res.status || 502);

    if (body.status && body.status !== prevStatus) {
        await logActivity({
            title:   `Stage: ${prevStatus || '—'} → ${body.status}`,
            type:    'Status Change',
            leadId:  body.id,
            details: body.notes || '',
            agent:   body.agent || 'Kevin',
        });
    }

    return json({ ok: true, lead: mapLead(res.record) });
}
