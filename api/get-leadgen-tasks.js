/**
 * /api/get-leadgen-tasks.js — Vercel Edge Function
 *
 * Lists Lead Generation tasks for the CRM's Tasks view.
 * Soonest due first (open work at the top).
 *
 *   GET ?password=…        → { tasks: [...] }
 *   GET ?status=Open       → only open tasks
 *   GET ?leadId=recXXXX    → tasks for one lead
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';
import { TABLES, creds, json, preflight, listAll, mapTask, esc } from './_leadgen.js';

export default async function handler(req) {
    if (req.method === 'OPTIONS') return preflight('GET');
    if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    if (!authorize(req, null).ok) return json({ error: 'Unauthorized' }, 401);

    const { apiKey, baseId } = creds();
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured', tasks: [] }, 500);

    const url    = new URL(req.url);
    const status = url.searchParams.get('status');
    const leadId = url.searchParams.get('leadId');

    const res = await listAll(TABLES.tasks, {
        sortField: 'Due',
        sortDir:   'asc',
        filter:    status ? `{Status} = '${esc(status)}'` : undefined,
    });
    if (!res.ok) return json({ error: res.error, tasks: [] }, res.status || 502);

    // Linked-record filtering is done here rather than in filterByFormula —
    // ARRAYJOIN on a link field is unreliable across Airtable field configs.
    let tasks = res.records.map(mapTask);
    if (leadId) tasks = tasks.filter(t => t.leadIds.includes(leadId));

    return json({ tasks, total: tasks.length });
}
