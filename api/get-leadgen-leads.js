/**
 * /api/get-leadgen-leads.js — Vercel Edge Function
 *
 * Lists Lead Generation leads for the CRM's Leads + Pipeline views.
 * Newest positive reply first.
 *
 *   GET ?password=…            → { leads: [...] }
 *   GET ?status=New            → filter by pipeline stage
 *   GET ?channel=Instantly     → filter by source channel
 *   GET ?campaign=exec_search  → filter by campaign slug
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';
import { TABLES, creds, json, preflight, listAll, mapLead, esc } from './_leadgen.js';

export default async function handler(req) {
    if (req.method === 'OPTIONS') return preflight('GET');
    if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    if (!authorize(req, null).ok) return json({ error: 'Unauthorized' }, 401);

    const { apiKey, baseId } = creds();
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured', leads: [] }, 500);

    const url = new URL(req.url);
    const clauses = [];
    for (const [param, field] of [['status', 'Status'], ['channel', 'Channel'], ['campaign', 'Campaign']]) {
        const v = url.searchParams.get(param);
        if (v) clauses.push(`{${field}} = '${esc(v)}'`);
    }
    const filter = clauses.length > 1 ? `AND(${clauses.join(',')})`
                 : clauses.length === 1 ? clauses[0]
                 : undefined;

    const res = await listAll(TABLES.leads, { sortField: 'Reply At', sortDir: 'desc', filter });
    if (!res.ok) return json({ error: res.error, leads: [] }, res.status || 502);

    const leads = res.records.map(mapLead);

    // Stage counts drive the Pipeline view's column headers.
    const byStatus = leads.reduce((acc, l) => {
        acc[l.status] = (acc[l.status] || 0) + 1;
        return acc;
    }, {});

    return json({ leads, total: leads.length, byStatus });
}
