/**
 * /api/agent/gmail-send.js — Outbound email through an authorized Gmail inbox.
 *
 * Lets any Claude agent send email as one of the team members using the same
 * OAuth refresh_token already collected for the inbound pipeline (gmail.send scope).
 *
 * POST body:
 *   {
 *     from: "rosadasilvapoler@gmail.com",     // must be a row in Team Inboxes
 *     to:   "client@example.com" | ["a@x.com","b@x.com"],
 *     subject: "...",
 *     html?: "<p>...</p>",                     // either html or text required
 *     text?: "plain body",
 *     cc?:  string | string[],
 *     bcc?: string | string[],
 *     replyTo?: string,
 *     leadId?: string,            // if provided, auto-log a note on the lead
 *     companyId?: string,         // if provided, auto-log Email Logged activity
 *     dealId?: string             // optional, linked when companyId is set
 *   }
 *
 * Auth: Authorization: Bearer <AGENT_API_TOKEN>
 */

export const config = { runtime: 'edge' };

import { authorize } from '../_auth.js';
import { listActiveInboxes } from '../../lib/team-inboxes.js';
import { refreshAccessToken } from '../../lib/gmail.js';

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

    let body;
    try { body = await req.json(); } catch { return json({ error: 'Invalid request body' }, 400); }
    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);

    const { from, to, subject, html, text, cc, bcc, replyTo, leadId, companyId, dealId } = body;

    if (!from) return json({ error: 'from required (must match a Team Inboxes row email)' }, 400);
    if (!to) return json({ error: 'to required' }, 400);
    if (!subject) return json({ error: 'subject required' }, 400);
    if (!html && !text) return json({ error: 'html or text required' }, 400);

    // Find the inbox row
    let inboxes;
    try { inboxes = await listActiveInboxes(); }
    catch (err) { return json({ error: err.message }, 500); }

    const inbox = inboxes.find(i => i.email.toLowerCase() === String(from).toLowerCase());
    if (!inbox) {
        return json({ error: `No active Team Inboxes row for ${from}. Authorize first at /api/agent/gmail-oauth-start?email=${encodeURIComponent(from)}` }, 404);
    }

    let accessToken;
    try { accessToken = await refreshAccessToken(inbox.refreshToken); }
    catch (err) { return json({ error: `token refresh: ${err.message}` }, 500); }

    // Build RFC 2822 message
    const rfc822 = buildRfc822({ from, to, subject, html, text, cc, bcc, replyTo });
    const raw = b64urlEncode(rfc822);

    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
    });
    if (!sendRes.ok) {
        const errText = await sendRes.text();
        return json({ error: `Gmail send failed: ${sendRes.status} ${errText}` }, 500);
    }
    const sendData = await sendRes.json();

    // Optional CRM logging
    const logResults = await logToCrm({ leadId, companyId, dealId, inbox, to, subject, text, html });

    return json({
        ok: true,
        gmailMessageId: sendData.id,
        threadId: sendData.threadId,
        from: inbox.email,
        owner: inbox.owner,
        crmLog: logResults,
    });
}

// ── RFC 2822 builder ───────────────────────────────────────────────────────────

function buildRfc822({ from, to, subject, html, text, cc, bcc, replyTo }) {
    const toLine = Array.isArray(to) ? to.join(', ') : to;
    const ccLine = cc ? (Array.isArray(cc) ? cc.join(', ') : cc) : '';
    const bccLine = bcc ? (Array.isArray(bcc) ? bcc.join(', ') : bcc) : '';

    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const lines = [];
    lines.push(`From: ${from}`);
    lines.push(`To: ${toLine}`);
    if (ccLine) lines.push(`Cc: ${ccLine}`);
    if (bccLine) lines.push(`Bcc: ${bccLine}`);
    if (replyTo) lines.push(`Reply-To: ${replyTo}`);
    lines.push(`Subject: ${encodeHeader(subject)}`);
    lines.push('MIME-Version: 1.0');

    if (html && text) {
        // multipart/alternative
        lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
        lines.push('');
        lines.push(`--${boundary}`);
        lines.push('Content-Type: text/plain; charset=UTF-8');
        lines.push('Content-Transfer-Encoding: 7bit');
        lines.push('');
        lines.push(text);
        lines.push(`--${boundary}`);
        lines.push('Content-Type: text/html; charset=UTF-8');
        lines.push('Content-Transfer-Encoding: 7bit');
        lines.push('');
        lines.push(html);
        lines.push(`--${boundary}--`);
    } else if (html) {
        lines.push('Content-Type: text/html; charset=UTF-8');
        lines.push('Content-Transfer-Encoding: 7bit');
        lines.push('');
        lines.push(html);
    } else {
        lines.push('Content-Type: text/plain; charset=UTF-8');
        lines.push('Content-Transfer-Encoding: 7bit');
        lines.push('');
        lines.push(text);
    }

    return lines.join('\r\n');
}

function encodeHeader(s) {
    // RFC 2047 encoded-word for non-ASCII subjects
    // eslint-disable-next-line no-control-regex
    if (/^[\x00-\x7F]*$/.test(s)) return s;
    return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(s)))}?=`;
}

function b64urlEncode(s) {
    const b64 = btoa(unescape(encodeURIComponent(s)));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── CRM logging ────────────────────────────────────────────────────────────────

async function logToCrm({ leadId, companyId, dealId, inbox, to, subject, text, html }) {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    if (!apiKey || !baseId) return { skipped: 'airtable not configured' };

    const agent = inbox.owner || 'Email Bot';
    const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    const toLine = Array.isArray(to) ? to.join(', ') : to;
    const bodyPreview = (text || stripTags(html || '')).slice(0, 400);

    const results = {};

    if (leadId) {
        try {
            const cur = await fetch(`https://api.airtable.com/v0/${baseId}/Leads/${leadId}`, { headers });
            if (cur.ok) {
                const existing = (await cur.json()).fields?.['Notes'] || '';
                const dateStr = new Date().toLocaleString('en-US', {
                    month: 'numeric', day: 'numeric', year: 'numeric',
                    hour: 'numeric', minute: '2-digit', hour12: true,
                });
                const entry = `[${dateStr} — ${agent}] Sent email to ${toLine} — "${subject}"\n${bodyPreview}`;
                const newNotes = existing ? `${entry}\n\n${existing}` : entry;
                const patch = await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
                    method: 'PATCH', headers,
                    body: JSON.stringify({ records: [{ id: leadId, fields: { 'Notes': newNotes } }] }),
                });
                results.leadNote = patch.ok ? 'ok' : `failed: ${patch.status}`;
            } else {
                results.leadNote = `lead not found: ${leadId}`;
            }
        } catch (err) { results.leadNote = `error: ${err.message}`; }
    }

    if (companyId) {
        try {
            const fields = {
                'Title': `Email to ${toLine}: ${subject}`.slice(0, 250),
                'Type': 'Email Logged',
                'Company': [companyId],
                'Details': bodyPreview,
                'Agent': agent,
            };
            if (dealId) fields['Deal'] = [dealId];
            const actRes = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Activity`, {
                method: 'POST', headers,
                body: JSON.stringify({ records: [{ fields }], typecast: true }),
            });
            results.consultingActivity = actRes.ok ? 'ok' : `failed: ${actRes.status}`;
        } catch (err) { results.consultingActivity = `error: ${err.message}`; }
    }

    return results;
}

function stripTags(html) {
    return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
