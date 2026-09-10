/**
 * /api/create-leadgen-task.js — Vercel Edge Function
 *
 * Creates a task against a Lead Generation lead ("call Randy Tuesday",
 * "send the deck", "follow up if no reply by Thursday").
 *
 *   POST { title, leadId?, type?, dueAt?, owner?, notes? }
 *   → { ok, task }
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';
import { TABLES, creds, json, preflight, createRecord, mapTask } from './_leadgen.js';

const TYPES = ['Call', 'Email', 'Meeting', 'Follow-up', 'Other'];

export default async function handler(req) {
    if (req.method === 'OPTIONS') return preflight('POST');
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    let body;
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Invalid JSON body' }, 400);
    }

    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);

    const { apiKey, baseId } = creds();
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);

    const title = (body.title || '').trim();
    if (!title) return json({ error: 'title is required' }, 400);

    const fields = {
        'Title':  title,
        'Type':   TYPES.includes(body.type) ? body.type : 'Follow-up',
        'Status': 'Open',
        'Owner':  body.owner || 'Kevin',
    };
    if (body.dueAt && !isNaN(Date.parse(body.dueAt))) {
        fields['Due']    = new Date(body.dueAt).toISOString();   // full date+time
        fields['Due At'] = String(body.dueAt).slice(0, 10);      // legacy date-only
    }
    if (body.notes)  fields['Notes']  = body.notes;
    if (body.leadId) fields['Lead']   = [body.leadId];

    const res = await createRecord(TABLES.tasks, fields);
    if (!res.ok) return json({ error: res.error }, res.status || 502);

    return json({ ok: true, task: mapTask(res.record) });
}
