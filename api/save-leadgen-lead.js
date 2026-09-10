/**
 * /api/save-leadgen-lead.js — Vercel Edge Function
 *
 * THE responder entry point. Creates (or idempotently updates) a Lead Generation
 * lead from a POSITIVE outreach reply, and writes the matching Activity row.
 *
 * Called by: outreach-machine/autoresponder/respond.py, the Lauderdale +
 * insurance responders, the Facebook reply handler, and the LoopNet responder —
 * on the classifier's positive verdict, BEFORE the reply draft hits Telegram.
 *
 * Idempotent: matches on Source Lead ID, then Email. A re-run, a second positive
 * reply, or two responders seeing the same lead all land on ONE row.
 *
 *   POST { name, email, company?, title?, phone?, channel, campaign?,
 *          replySnippet?, replyAt?, sourceLeadId?, website?, notes?, owner? }
 *   → { ok, created: bool, lead }
 *
 * Auth: Bearer AGENT_API_TOKEN (agents) or password (web UI) — see ./_auth.js
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';
import {
    TABLES, creds, json, preflight, createRecord, updateRecord,
    findLead, mapLead, logActivity, STATUSES, normChannel,
} from './_leadgen.js';

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

    const name  = (body.name  || '').trim();
    const email = (body.email || '').trim();
    if (!name && !email) return json({ error: 'name or email is required' }, 400);

    const channel = normChannel(body.channel);
    const status  = STATUSES.includes(body.status)  ? body.status  : 'New';
    const replyAt = body.replyAt || new Date().toISOString();

    // ---- idempotent lookup -------------------------------------------------
    const found = await findLead({ sourceLeadId: body.sourceLeadId, email });
    if (!found.ok) return json({ error: found.error }, found.status || 502);

    // Only write fields the caller actually supplied, so an update from a thin
    // payload can never blank out data a richer earlier write already stored.
    const fields = {};
    const put = (k, v) => { if (v !== undefined && v !== null && v !== '') fields[k] = v; };
    put('Name',           name);
    put('Email',          email);
    put('Company',        body.company);
    put('Title',          body.title);
    put('Phone',          body.phone);
    put('Campaign',       body.campaign);
    put('Reply Snippet',  body.replySnippet);
    put('Website',        body.website);
    put('Notes',          body.notes);
    put('Owner',          body.owner || 'Kevin');
    fields['Channel']      = channel;
    fields['Reply At']     = replyAt;
    fields['Last Contact'] = replyAt.slice(0, 10);
    if (body.sourceLeadId) fields['Source Lead ID'] = body.sourceLeadId;

    // ---- update existing ---------------------------------------------------
    if (found.record) {
        // Never regress a lead Kevin has already advanced (Meeting Booked / Won).
        const current = found.record.fields?.['Status'] || 'New';
        if (STATUSES.indexOf(current) < STATUSES.indexOf(status)) fields['Status'] = status;

        const res = await updateRecord(TABLES.leads, found.record.id, fields);
        if (!res.ok) return json({ error: res.error }, res.status || 502);

        await logActivity({
            title:   `Another positive reply — ${channel}`,
            type:    'Positive Reply',
            leadId:  found.record.id,
            details: body.replySnippet || '',
            at:      replyAt,
        });

        return json({ ok: true, created: false, lead: mapLead(res.record) });
    }

    // ---- create new --------------------------------------------------------
    fields['Status']     = status;
    fields['Created At'] = new Date().toISOString();

    const res = await createRecord(TABLES.leads, fields);
    if (!res.ok) return json({ error: res.error }, res.status || 502);

    await logActivity({
        title:   `Positive reply — ${channel}${body.campaign ? ` / ${body.campaign}` : ''}`,
        type:    'Positive Reply',
        leadId:  res.record.id,
        details: body.replySnippet || '',
        at:      replyAt,
    });

    return json({ ok: true, created: true, lead: mapLead(res.record) });
}
