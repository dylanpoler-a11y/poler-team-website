/**
 * /api/agent/update-note.js — Vercel Edge Function
 * EDIT an existing note in a lead's Notes blob via exact find/replace.
 *
 * Built 2026-07-01 (Kevin: Sammy must be able to EDIT its "awaiting reply" note
 * once the lead replies, instead of stacking a new note per message). The Notes
 * field is a single text blob (see log-note.js), so an "edit" is a literal
 * find/replace that must match EXACTLY ONCE — anything else is refused so a bad
 * match can never corrupt history. Callers fall back to log-note (append) on 409.
 *
 * Body: { leadId, find, replace, agent? }
 *   find    — the exact existing note BODY text to replace (must occur exactly once)
 *   replace — the new text that takes its place
 * Auth: Authorization: Bearer <AGENT_API_TOKEN>  (or password)
 *
 * Responses:
 *   200 { success: true, matches: 1 }
 *   409 { error: 'find text must match exactly once', matches: N }  → caller appends
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

    const { leadId, find, replace } = body;
    if (!leadId || !find?.trim() || typeof replace !== 'string' || !replace.trim()) {
        return json({ error: 'leadId, find and replace are required' }, 400);
    }

    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    // Fetch existing notes
    const cur = await fetch(`https://api.airtable.com/v0/${baseId}/Leads/${leadId}`, { headers });
    if (!cur.ok) return json({ error: 'Lead not found' }, 404);
    const existing = (await cur.json()).fields?.['Notes'] || '';

    // The find text must occur EXACTLY once — otherwise refuse (caller appends instead).
    const matches = existing.split(find).length - 1;
    if (matches !== 1) {
        return json({ error: 'find text must match exactly once', matches }, 409);
    }

    const newNotes = existing.replace(find, replace);

    const patchRes = await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ records: [{ id: leadId, fields: { 'Notes': newNotes } }] }),
    });

    if (!patchRes.ok) {
        const err = await patchRes.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to update notes' }, 500);
    }

    return json({ success: true, matches: 1 });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
