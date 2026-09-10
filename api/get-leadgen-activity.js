/**
 * /api/get-leadgen-activity.js — Vercel Edge Function
 *
 * Chronological activity feed for the Lead Generation module (newest first).
 * Powers the Activity view and the per-lead panel timeline.
 *
 *   GET ?password=…      → { activity: [...] }
 *   GET ?leadId=recXXXX  → one lead's timeline
 *   GET ?limit=50        → cap the feed
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';
import { TABLES, creds, json, preflight, listAll, mapActivity } from './_leadgen.js';

export default async function handler(req) {
    if (req.method === 'OPTIONS') return preflight('GET');
    if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    if (!authorize(req, null).ok) return json({ error: 'Unauthorized' }, 401);

    const { apiKey, baseId } = creds();
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured', activity: [] }, 500);

    const url    = new URL(req.url);
    const leadId = url.searchParams.get('leadId');
    const limit  = parseInt(url.searchParams.get('limit') || '0', 10);

    // Filter by lead SERVER-side ({Lead Record ID} = lookup of RECORD_ID(); ARRAYJOIN({Lead})
    // yields NAMES, not ids): listAll caps at 1,000 rows and the thread sync
    // (every email in/out per lead) pushes the table well past that.
    const filter = /^rec[A-Za-z0-9]{14}$/.test(leadId || '')
        ? `FIND('${leadId}', ARRAYJOIN({Lead Record ID}))` : undefined;
    const res = await listAll(TABLES.activity, { sortField: 'At', sortDir: 'desc', filter });
    if (!res.ok) return json({ error: res.error, activity: [] }, res.status || 502);

    let activity = res.records.map(mapActivity);
    if (leadId) activity = activity.filter(a => a.leadIds.includes(leadId));
    if (limit > 0) activity = activity.slice(0, limit);

    return json({ activity, total: activity.length });
}
