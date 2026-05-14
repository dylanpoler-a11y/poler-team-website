/**
 * /api/agent/log-note.js — Vercel Edge Function
 * Append a single timestamped note to a lead's Notes field.
 *
 * Body: { leadId, note, agent? }
 * Auth: Authorization: Bearer <AGENT_API_TOKEN>  (or password)
 *
 * Format matches the existing CRM convention:
 *   [M/D/YYYY, h:MM AM — agent] note text
 *   followed by previous notes (newest on top)
 */

export const config = { runtime: 'edge' };

import { authorize } from '../_auth.js';

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            },
        });
    }
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;

    let body;
    try { body = await req.json(); }
    catch { return json({ error: 'Invalid request body' }, 400); }

    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);

    const { leadId, note, agent = 'Agent' } = body;
    if (!leadId || !note?.trim()) {
        return json({ error: 'leadId and note are required' }, 400);
    }

    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    // Fetch existing notes
    const cur = await fetch(`https://api.airtable.com/v0/${baseId}/Leads/${leadId}`, { headers });
    if (!cur.ok) return json({ error: 'Lead not found' }, 404);
    const existing = (await cur.json()).fields?.['Notes'] || '';

    // Build prefix matching the saveLead() convention in crm.js
    const now = new Date();
    const dateStr = now.toLocaleString('en-US', {
        month: 'numeric', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
    });
    const entry = `[${dateStr} — ${agent}] ${note.trim()}`;
    const newNotes = existing ? `${entry}\n\n${existing}` : entry;

    const patchRes = await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ records: [{ id: leadId, fields: { 'Notes': newNotes } }] }),
    });

    if (!patchRes.ok) {
        const err = await patchRes.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to update notes' }, 500);
    }

    return json({ success: true, entry });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
