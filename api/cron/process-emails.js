/**
 * /api/cron/process-emails.js — Vercel Edge Function, triggered every 5 min by cron-job.org.
 *
 * For each active row in the Team Inboxes Airtable table:
 *   1. Refresh access_token using stored refresh_token
 *   2. List recent INBOX messages not already labeled CRM_PROCESSED/UNMATCHED/NEEDS_REVIEW
 *   3. For each message:
 *        - Parse From address
 *        - If internal sender AND subject looks like a forward:
 *            scan body for first non-internal email → use as effective sender
 *        - Else if internal sender or obvious noreply: skip
 *        - Match effective sender against CRM email index
 *        - If match: summarize via Anthropic, write note + activity, upload attachments,
 *          label CRM_PROCESSED
 *        - If no match: label CRM_UNMATCHED
 *        - On Anthropic error: fall back to heuristic, still try to write/upload
 *   4. Stamp Last Polled on the inbox row
 */

export const config = { runtime: 'edge' };

import { listActiveInboxes, stampLastPolled } from '../../lib/team-inboxes.js';
import {
    refreshAccessToken, listRecentMessages, fetchMessage,
    parseMessage, applyLabel, fetchAttachment,
    parseForwardedSenders, isForwardSubject,
} from '../../lib/gmail.js';
import { getEmailIndex } from '../../lib/crm-contacts.js';
import { extractEmailUpdate, classifyByHeuristic } from '../../lib/email-extract.js';

// Internal: skip-by-default UNLESS forwarded
const INTERNAL_DOMAINS = ['poler.org', 'homesinsoflorida.com', 'investoros1.com'];

// Local-parts to skip regardless of forwarding (noreply variants).
// Match either exact `noreply` or anything ending in `-noreply` / `_noreply`
// (covers LinkedIn's jobs-noreply, security-noreply, etc).
function isNoreplyLocal(local) {
    const lc = (local || '').toLowerCase();
    if (!lc) return true;
    const noreplyTerms = ['noreply', 'no-reply', 'do-not-reply', 'mailer-daemon', 'postmaster', 'notifications'];
    for (const t of noreplyTerms) {
        if (lc === t) return true;
        if (lc.startsWith(t + '+')) return true;          // plus-addressing
        if (lc.endsWith('-' + t) || lc.endsWith('_' + t)) return true; // suffix
        if (lc.startsWith(t + '-') || lc.startsWith(t + '_')) return true; // prefix
    }
    return false;
}

function isInternalDomain(domain) {
    const d = (domain || '').toLowerCase();
    return INTERNAL_DOMAINS.some(x => d === x || d.endsWith('.' + x));
}

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            },
        });
    }

    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get('authorization') || '';
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return json({ error: 'Unauthorized' }, 401);
    }

    const startedAt = Date.now();
    const results = {
        inboxes: 0, messagesScanned: 0, matched: 0, unmatched: 0,
        skipped: 0, errors: 0, writes: 0, forwardsMatched: 0, perInbox: [],
    };

    let inboxes = [];
    try { inboxes = await listActiveInboxes(); } catch (err) { return json({ error: err.message }, 500); }
    results.inboxes = inboxes.length;

    if (inboxes.length === 0) return json({ ok: true, message: 'No active inboxes', results });

    let emailIndex;
    try { emailIndex = await getEmailIndex(); } catch (err) { return json({ error: `CRM index failed: ${err.message}` }, 500); }

    const query = 'in:inbox newer_than:30m -label:CRM_PROCESSED -label:CRM_UNMATCHED -label:CRM_NEEDS_REVIEW';

    for (const inbox of inboxes) {
        const inboxResult = {
            email: inbox.email, owner: inbox.owner,
            scanned: 0, matched: 0, unmatched: 0, skipped: 0,
            errors: 0, writes: 0, forwardsMatched: 0,
        };

        let accessToken;
        try { accessToken = await refreshAccessToken(inbox.refreshToken); }
        catch (err) {
            inboxResult.errors++;
            inboxResult.error = `token refresh: ${err.message}`;
            results.errors++;
            results.perInbox.push(inboxResult);
            continue;
        }

        let messages;
        try { messages = await listRecentMessages(accessToken, query, 15); }
        catch (err) {
            inboxResult.errors++;
            inboxResult.error = `list messages: ${err.message}`;
            results.errors++;
            results.perInbox.push(inboxResult);
            continue;
        }

        for (const msgRef of messages) {
            inboxResult.scanned++;
            results.messagesScanned++;
            try {
                const raw = await fetchMessage(msgRef.id, accessToken);
                const m = parseMessage(raw);

                const fromEmail = m.from.email || '';
                const [fromLocal, fromDomain] = fromEmail.split('@');

                // (A) Cheap noreply skip — applies regardless of internal/external.
                if (isNoreplyLocal(fromLocal || '')) {
                    inboxResult.skipped++; results.skipped++;
                    continue;
                }

                // (B) Internal sender: try forward detection. If subject looks like a
                // forward, scan body for the first external email address and use that
                // as the effective sender for CRM matching.
                let effectiveSenderEmail = fromEmail;
                let isForward = false;
                if (isInternalDomain(fromDomain) || INTERNAL_DOMAINS.includes(fromDomain)) {
                    if (isForwardSubject(m.subject)) {
                        const candidates = parseForwardedSenders(m.plainText, INTERNAL_DOMAINS);
                        const external = candidates.find(c => {
                            const [lp, dm] = c.split('@');
                            return !isNoreplyLocal(lp) && !isInternalDomain(dm);
                        });
                        if (external) {
                            effectiveSenderEmail = external;
                            isForward = true;
                        } else {
                            // Internal-only forward (Noel→Kevin, no external client). Skip.
                            inboxResult.skipped++; results.skipped++;
                            continue;
                        }
                    } else {
                        // Internal sender, not a forward — skip.
                        inboxResult.skipped++; results.skipped++;
                        continue;
                    }
                }

                const match = emailIndex.get((effectiveSenderEmail || '').toLowerCase());

                if (!match) {
                    inboxResult.unmatched++; results.unmatched++;
                    await applyLabel(m.id, 'CRM_UNMATCHED', accessToken).catch(e => console.error('label CRM_UNMATCHED failed:', e));
                    continue;
                }

                let extracted;
                try {
                    extracted = await extractEmailUpdate({
                        fromEmail: m.from.email,
                        fromName: m.from.name,
                        subject: m.subject,
                        plainTextBody: m.plainText,
                        attachments: m.attachments || [],
                        effectiveSender: isForward ? effectiveSenderEmail : undefined,
                        crmContext: {
                            recordType: match.recordType,
                            recordId: match.recordId,
                            recordName: match.recordName,
                            currentStatus: match.currentStatus,
                            companyName: match.companyName,
                        },
                    });
                } catch (err) {
                    console.error(`Anthropic extract failed for msg ${m.id}:`, err.message);
                    extracted = {
                        summary: m.subject || '(no subject)',
                        noteText: `Email from ${m.from.name || m.from.email}: ${m.subject || '(no subject)'}. (Auto-summary failed; review email directly.)`,
                        confidence: 'low',
                        attachmentClassifications: (m.attachments || []).map(a => ({
                            filename: a.filename,
                            category: classifyByHeuristic(a.filename, a.mimeType),
                        })),
                    };
                    inboxResult.errors++; results.errors++;
                }

                try {
                    await writeCrmUpdate({ match, extracted, inbox, email: m, accessToken, effectiveSenderEmail, isForward });
                    inboxResult.writes++; inboxResult.matched++;
                    results.writes++; results.matched++;
                    if (isForward) { inboxResult.forwardsMatched++; results.forwardsMatched++; }
                    await applyLabel(m.id, 'CRM_PROCESSED', accessToken).catch(e => console.error('label processed failed:', e));
                } catch (err) {
                    console.error(`CRM write failed for msg ${m.id}:`, err.message);
                    inboxResult.errors++; results.errors++;
                    await applyLabel(m.id, 'CRM_NEEDS_REVIEW', accessToken).catch(() => {});
                }
            } catch (err) {
                console.error(`Message ${msgRef.id} fatal:`, err.message);
                inboxResult.errors++; results.errors++;
            }
        }

        await stampLastPolled(inbox.id);
        results.perInbox.push(inboxResult);
    }

    results.elapsedMs = Date.now() - startedAt;
    return json({ ok: true, results });
}

async function writeCrmUpdate({ match, extracted, inbox, email, accessToken, effectiveSenderEmail, isForward }) {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    if (!apiKey || !baseId) throw new Error('Airtable not configured');

    const agent = inbox.owner || 'Email Bot';
    const headers = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
    };

    const attachmentNames = (email.attachments || []).map(a => a.filename);
    const attachLine = attachmentNames.length > 0 ? ` [Attachments: ${attachmentNames.join(', ')}]` : '';
    const subjectLine = email.subject ? `Re: "${truncate(email.subject, 80)}"` : '';
    const forwardLine = isForward ? ` (forwarded by ${email.from.email}, original sender ${effectiveSenderEmail})` : '';
    const noteCore = [extracted.noteText, subjectLine].filter(Boolean).join(' — ');
    const note = `[via Gmail/${inbox.email}${forwardLine}] ${noteCore}${attachLine}`;

    if (match.recordType === 'lead') {
        // Prepend to Lead.Notes
        const cur = await fetch(`https://api.airtable.com/v0/${baseId}/Leads/${match.recordId}`, { headers });
        if (!cur.ok) throw new Error(`Lead ${match.recordId} not found`);
        const existing = (await cur.json()).fields?.['Notes'] || '';
        const dateStr = nowDateStr();
        const entry = `[${dateStr} — ${agent}] ${note}`;
        const newNotes = existing ? `${entry}\n\n${existing}` : entry;
        const patchRes = await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
            method: 'PATCH', headers,
            body: JSON.stringify({ records: [{ id: match.recordId, fields: { 'Notes': newNotes } }] }),
        });
        if (!patchRes.ok) throw new Error(`Lead PATCH: ${(await patchRes.json().catch(() => ({}))).error?.message || patchRes.status}`);
    } else if (match.recordType === 'consulting-contact') {
        if (!match.companyId) throw new Error('contact has no companyId');

        // (1) Log to Consulting Activity (Email Logged type)
        const title = `Email from ${match.recordName}: ${truncate(extracted.summary || email.subject || '(no subject)', 200)}`;
        const actRes = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Activity`, {
            method: 'POST', headers,
            body: JSON.stringify({
                records: [{
                    fields: {
                        'Title': title.slice(0, 250),
                        'Type': 'Email Logged',
                        'Company': [match.companyId],
                        'Details': note,
                        'Agent': agent,
                    },
                }],
                typecast: true,
            }),
        });
        if (!actRes.ok) throw new Error(`Activity log: ${(await actRes.json().catch(() => ({}))).error?.message || actRes.status}`);

        // (2) Prepend to Company.Notes
        const cur = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Clients/${match.companyId}`, { headers });
        if (cur.ok) {
            const existing = (await cur.json()).fields?.['Notes'] || '';
            const entry = `[${nowDateStr()} — ${agent}] ${note}`;
            const newNotes = existing ? `${entry}\n\n${existing}` : entry;
            await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Clients`, {
                method: 'PATCH', headers,
                body: JSON.stringify({ records: [{ id: match.companyId, fields: { 'Notes': newNotes } }] }),
            }).catch(err => console.error('Company Notes append failed:', err.message));
        }
    } else {
        throw new Error(`Unknown recordType: ${match.recordType}`);
    }

    // Attachments
    if ((email.attachments || []).length > 0) {
        const classMap = new Map();
        for (const c of (extracted.attachmentClassifications || [])) classMap.set(c.filename, c.category);

        for (const att of email.attachments) {
            try {
                const base64 = await fetchAttachment(email.id, att.attachmentId, accessToken);
                const category = classMap.get(att.filename) || classifyByHeuristic(att.filename, att.mimeType);

                if (match.recordType === 'lead') {
                    await uploadAirtableAttachment({ recordId: match.recordId, field: 'Documents', filename: att.filename, contentType: att.mimeType, base64, apiKey, baseId });
                } else {
                    await uploadAirtableAttachment({ recordId: match.companyId, field: category, filename: att.filename, contentType: att.mimeType, base64, apiKey, baseId });
                }
            } catch (err) {
                console.error(`Attachment upload failed (${att.filename}):`, err.message);
            }
        }
    }
}

async function uploadAirtableAttachment({ recordId, field, filename, contentType, base64, apiKey, baseId }) {
    const url = `https://content.airtable.com/v0/${baseId}/${recordId}/${encodeURIComponent(field)}/uploadAttachment`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contentType: contentType || 'application/octet-stream',
            file: base64, filename,
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Doc upload (${field}): ${err.error?.message || res.status}`);
    }
}

function truncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function nowDateStr() {
    return new Date().toLocaleString('en-US', {
        month: 'numeric', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
    });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
