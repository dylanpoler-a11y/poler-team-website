/**
 * /api/log-leadgen-activity.js — Vercel Edge Function
 *
 * Appends an activity row to a Lead Generation lead — a sent reply, a call,
 * a meeting, or a manual note. Called by the responders after a send, and by
 * the CRM UI's "log note" box.
 *
 *   POST { title, leadId, type?, details?, agent?, at?, stampContact? }
 *   → { ok, activity }
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';
import {
    TABLES, creds, json, preflight, createRecord, updateRecord, mapActivity,
} from './_leadgen.js';

const TYPES = ['Positive Reply', 'Reply', 'Email Sent', 'Call', 'Meeting', 'Note', 'Status Change'];

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

    const at = body.at || new Date().toISOString();

    const res = await createRecord(TABLES.activity, {
        'Title':   title,
        'Type':    TYPES.includes(body.type) ? body.type : 'Note',
        'Lead':    body.leadId ? [body.leadId] : undefined,
        'Details': body.details || '',
        'Agent':   body.agent || 'Kevin',
        'At':      at,
    });
    if (!res.ok) return json({ error: res.error }, res.status || 502);

    // Touching a lead counts as contact — keeps the Leads view's Last Contact honest.
    if (body.stampContact && body.leadId) {
        await updateRecord(TABLES.leads, body.leadId, { 'Last Contact': at.slice(0, 10) });
    }

    return json({ ok: true, activity: mapActivity(res.record) });
}
