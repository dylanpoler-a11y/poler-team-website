/**
 * /api/update-leadgen-task.js — Vercel Edge Function
 *
 * Marks a Lead Generation task done/skipped, or edits its title/due date/notes.
 *
 *   PATCH { id, status?, title?, type?, dueAt?, owner?, notes? }
 *   → { ok, task }
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';
import { TABLES, creds, json, preflight, updateRecord, mapTask } from './_leadgen.js';

const STATUS = ['Open', 'Done', 'Skipped'];
const TYPES  = ['Call', 'Email', 'Meeting', 'Follow-up', 'Other'];

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

    if (body.status && !STATUS.includes(body.status)) {
        return json({ error: `status must be one of: ${STATUS.join(', ')}` }, 400);
    }

    const fields = {};
    if (body.status !== undefined) fields['Status'] = body.status;
    if (body.title  !== undefined) fields['Title']  = body.title;
    if (body.owner  !== undefined) fields['Owner']  = body.owner;
    if (body.notes  !== undefined) fields['Notes']  = body.notes;
    if (body.type   !== undefined && TYPES.includes(body.type)) fields['Type'] = body.type;
    if (body.dueAt  !== undefined) {
        const ok = body.dueAt && !isNaN(Date.parse(body.dueAt));
        fields['Due']    = ok ? new Date(body.dueAt).toISOString() : null;
        fields['Due At'] = ok ? String(body.dueAt).slice(0, 10) : null;
    }

    if (!Object.keys(fields).length) return json({ error: 'nothing to update' }, 400);

    const res = await updateRecord(TABLES.tasks, body.id, fields);
    if (!res.ok) return json({ error: res.error }, res.status || 502);

    return json({ ok: true, task: mapTask(res.record) });
}
