/**
 * /api/log-leadgen-activity.js — Vercel Edge Function
 *
 * Appends an activity row to a Lead Generation lead — a sent reply, a call,
 * a meeting, or a manual note. Called by the responders after a send, and by
 * the CRM UI's "log note" box.
 *
 *   POST { title, leadId, type?, details?, agent?, at?, stampContact?,
 *          subject?, mailbox?, messageId?, attachments?: [{ filename, contentType, base64 }] }
 *   → { ok, activity, created, attachmentsUploaded, attachmentsFailed }
 *
 * Email thread sync (2026-09-10): `messageId` (RFC Message-ID) makes the call
 * idempotent — a row with that Message ID (or a legacy `[mid:<id>]` tag in
 * Details) is UPDATED instead of duplicated, and any attachments not yet on it
 * are uploaded. Attachments are base64, ≤ 4 MB each (Vercel body cap is 4.5 MB
 * per request — send big files one per call).
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';
import {
    TABLES, creds, json, preflight, createRecord, updateRecord, mapActivity, listAll, esc, uploadAttachment,
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
    const messageId = String(body.messageId || '').trim().slice(0, 500);

    const fields = {
        'Title':   title,
        'Type':    TYPES.includes(body.type) ? body.type : 'Note',
        'Lead':    body.leadId ? [body.leadId] : undefined,
        'Details': body.details || '',
        'Agent':   body.agent || 'Kevin',
        'At':      at,
    };
    if (body.subject !== undefined) fields['Subject'] = String(body.subject || '').slice(0, 500);
    if (body.mailbox !== undefined) fields['Mailbox'] = String(body.mailbox || '').trim().toLowerCase();
    if (messageId) fields['Message ID'] = messageId;

    // Idempotency: an existing row for this Message-ID is updated, never duplicated.
    let record = null, created = true;
    if (messageId) {
        const dup = await listAll(TABLES.activity, {
            filter: `OR({Message ID} = '${esc(messageId)}', FIND('[mid:${esc(messageId)}]', {Details}))`,
        });
        if (dup.ok && dup.records.length) {
            const existing = dup.records[0];
            created = false;
            // Only enrich: subject / mailbox / Message ID, and a LONGER body. Never
            // rewrite Title/Type/Agent/At that the original producer set.
            const patch = { 'Message ID': messageId };
            if (fields['Subject'] && !existing.fields['Subject']) patch['Subject'] = fields['Subject'];
            if (fields['Mailbox'] && !existing.fields['Mailbox']) patch['Mailbox'] = fields['Mailbox'];
            if (fields.Details && fields.Details.length > (existing.fields['Details'] || '').length) patch['Details'] = fields.Details;
            if (body.leadId && !(existing.fields['Lead'] || []).length) patch['Lead'] = [body.leadId];
            const upd = await updateRecord(TABLES.activity, existing.id, patch);
            record = upd.ok ? upd.record : existing;
        }
    }
    if (!record) {
        const res = await createRecord(TABLES.activity, fields);
        if (!res.ok) return json({ error: res.error }, res.status || 502);
        record = res.record;
    }

    // Attachments — skip files already on the row (same filename + size).
    const attachmentsUploaded = [], attachmentsFailed = [];
    const have = new Set((record.fields?.['Attachments'] || []).map(a => `${a.filename}|${a.size || ''}`));
    for (const att of Array.isArray(body.attachments) ? body.attachments.slice(0, 10) : []) {
        if (!att || !att.filename || !att.base64) continue;
        const approxBytes = Math.floor(att.base64.length * 3 / 4);
        if (have.has(`${att.filename}|${approxBytes}`) || [...have].some(k => k.startsWith(`${att.filename}|`))) continue;
        const up = await uploadAttachment(record.id, 'Attachments', att);
        if (up.ok) attachmentsUploaded.push(att.filename); else attachmentsFailed.push({ filename: att.filename, error: up.error });
    }

    // Touching a lead counts as contact — keeps the Leads view's Last Contact honest.
    if (body.stampContact && body.leadId) {
        await updateRecord(TABLES.leads, body.leadId, { 'Last Contact': at.slice(0, 10) });
    }

    return json({ ok: true, created, activity: mapActivity(record), attachmentsUploaded, attachmentsFailed });
}
