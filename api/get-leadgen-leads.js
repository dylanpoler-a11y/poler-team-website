/**
 * /api/get-leadgen-leads.js — Vercel Edge Function
 *
 * Lists Lead Generation leads for the CRM's Leads + Pipeline views.
 * Newest reply first.
 *
 *   GET ?password=…            → { leads: [...] }
 *   GET ?status=New            → filter by pipeline stage
 *   GET ?channel=Email         → filter by source channel (Email|Facebook|LinkedIn|WhatsApp|LoopNet|Manual)
 *   GET ?sentiment=Positive    → filter by reply sentiment
 *   GET ?campaign=exec_search  → filter by campaign slug
 *   GET ?id=recXXXX            → exactly one lead (Flash coach)
 *   GET ?inbox=1               → adds ball / waitingDays / hot per lead + inbox {needsReply, waiting, hot} (2026-09-20)
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';
import { TABLES, creds, json, preflight, listAll, mapLead, esc, listActivityLite, computeInbox } from './_leadgen.js';

export default async function handler(req) {
    if (req.method === 'OPTIONS') return preflight('GET');
    if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    if (!authorize(req, null).ok) return json({ error: 'Unauthorized' }, 401);

    const { apiKey, baseId } = creds();
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured', leads: [] }, 500);

    const url = new URL(req.url);
    const clauses = [];
    for (const [param, field] of [['status', 'Status'], ['channel', 'Channel'], ['campaign', 'Campaign'], ['sentiment', 'Sentiment']]) {
        const v = url.searchParams.get(param);
        if (v) clauses.push(`{${field}} = '${esc(v)}'`);
    }
    // ?id=recXXXX → exactly one lead (Flash coach uses this; the CRM UI lists all).
    const id = url.searchParams.get('id');
    if (id) clauses.push(`RECORD_ID() = '${esc(id)}'`);
    const filter = clauses.length > 1 ? `AND(${clauses.join(',')})`
                 : clauses.length === 1 ? clauses[0]
                 : undefined;

    const res = await listAll(TABLES.leads, { sortField: 'Reply At', sortDir: 'desc', filter, maxPages: 40 });   // 4,000 rows; the generic 1,000 cap truncates silently
    if (!res.ok) return json({ error: res.error, leads: [] }, res.status || 502);

    const leads = res.records.map(mapLead);

    // Stage counts drive the Pipeline view's column headers.
    const byStatus = leads.reduce((acc, l) => {
        acc[l.status] = (acc[l.status] || 0) + 1;
        return acc;
    }, {});

    // ?inbox=1 (2026-09-20): whose turn is it? Derived from the activity log on every
    // read — ball / waitingDays / hot on each lead + the three Inbox lists (ids, ordered).
    let inbox;
    if (/^(1|true|yes)$/i.test(url.searchParams.get('inbox') || '')) {
        const act = await listActivityLite();
        if (!act.ok) return json({ error: act.error, leads: [] }, act.status || 502);
        inbox = computeInbox(leads, act.records);
        inbox.activityRows = act.records.length;
    }

    return json({ leads, total: leads.length, byStatus, ...(inbox ? { inbox } : {}) });
}
