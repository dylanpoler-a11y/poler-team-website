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
import { getEmailIndex, getClientList, getDealList, findClientMentions, findDealMentions, hasNewClientSignals } from '../../lib/crm-contacts.js';
import { extractEmailUpdate, extractTeamDiscussion, classifyByHeuristic } from '../../lib/email-extract.js';
import { sendSlackMessage, getOwnerSlackWebhook } from '../../lib/slack.js';

// Bridge MLS — Rosa's listings (used by team-discussion extractor for listing references)
const ROSA_MLS_AGENT_ID = '3268052';
async function getRosaListings() {
    const token = process.env.BRIDGE_API_TOKEN;
    if (!token) return [];
    try {
        const params = new URLSearchParams({
            access_token: token,
            StandardStatus: 'Active',
            ListAgentMlsId: ROSA_MLS_AGENT_ID,
            limit: '50',
            fields: 'ListingId,UnparsedAddress,City,ListPrice,PropertySubType',
        });
        const res = await fetch(`https://api.bridgedataoutput.com/api/v2/miamire/listings?${params}`);
        if (!res.ok) return [];
        const data = await res.json();
        return (data.bundle || data.value || []).map(r => ({
            mlsId: r.ListingId,
            title: `${r.UnparsedAddress || 'Unknown address'}${r.City ? ', ' + r.City : ''}`,
            price: r.ListPrice || 0,
            type: r.PropertySubType || '',
        }));
    } catch (err) {
        console.error('[bridge] listings fetch failed:', err.message);
        return [];
    }
}

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

    // Query window: 2h default (was 30m — too aggressive given cron-job.org
    // glitches + occasional Vercel cold-start delays). Manual resync can pass
    // ?since=24h or any Gmail duration string ('1d','7d','3h') for catch-up.
    const reqUrl = new URL(req.url);
    const sinceRaw = (reqUrl.searchParams.get('since') || '2h').toLowerCase();
    const sinceClean = sinceRaw.replace(/[^a-z0-9]/g, '') || '2h';
    const query = `in:inbox newer_than:${sinceClean} -label:CRM_PROCESSED -label:CRM_UNMATCHED -label:CRM_NEEDS_REVIEW`;

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
                        // Internal sender, NOT a forward → ALWAYS run Sonnet team-discussion.
                        // (Removed the regex pre-filter — Sonnet decides what's CRM-worthy,
                        // not a brittle keyword check that kept missing edge cases like
                        // "Toyosa" vs "Intermex / Toyosa" or "Royal" vs "MR9 Holdings".)
                        // Cost impact: ~$0.017 per internal team email. Worth it.
                        try {
                            const [clientList, dealList, listings] = await Promise.all([
                                getClientList(),
                                getDealList(),
                                getRosaListings(),
                            ]);
                            const writeSummary = await processTeamDiscussion({
                                email: m, clientList, dealList, listings, inbox, accessToken,
                            });
                            if (writeSummary?.wroteSomething) {
                                inboxResult.matched++; results.matched++;
                                inboxResult.writes++; results.writes++;
                            } else {
                                inboxResult.skipped++; results.skipped++;
                            }
                            await applyLabel(m.id, 'CRM_PROCESSED', accessToken).catch(() => {});
                            continue;
                        } catch (err) {
                            console.error(`Team-discussion extract failed for msg ${m.id}:`, err.message);
                            inboxResult.errors++; results.errors++;
                            await applyLabel(m.id, 'CRM_NEEDS_REVIEW', accessToken).catch(() => {});
                            continue;
                        }
                    }
                }

                const match = emailIndex.get((effectiveSenderEmail || '').toLowerCase());

                if (!match) {
                    inboxResult.unmatched++; results.unmatched++;
                    await applyLabel(m.id, 'CRM_UNMATCHED', accessToken).catch(e => console.error('label CRM_UNMATCHED failed:', e));
                    // Slack-ping for visibility: external sender we don't know yet.
                    // Skip if it looks like marketing/newsletter (already passed the
                    // SKIP_DOMAINS + noreply filters, but heuristics for content).
                    await notifyUnmatchedSlack({
                        owner: inbox.owner || 'Email Bot',
                        fromName: m.from.name || '',
                        fromEmail: m.from.email || effectiveSenderEmail || '',
                        subject: m.subject || '(no subject)',
                        snippet: (m.plainText || m.snippet || '').slice(0, 240),
                        isForward,
                    }).catch(err => console.error('notifyUnmatchedSlack failed:', err.message));
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

    // Track everything we write for a consolidated WhatsApp notification at the end.
    const writeSummary = {
        noteWritten: false,
        attachmentsUploaded: [], // [{filename, category}]
        attachmentsFailed: [],   // [{filename, reason}]
        remindersCreated: [],    // {title, actionType, dueAt, note}
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
        writeSummary.noteWritten = true;
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
        writeSummary.noteWritten = true;

        // NOTE: We intentionally do NOT also append to Company.Notes anymore.
        // Each email is one Consulting Activity row (= one note card in the UI).
        // The Company.Notes textarea is reserved for Kevin's manual notes only,
        // so it doesn't become a giant concatenated thread.
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
                    writeSummary.attachmentsUploaded.push({ filename: att.filename, category: 'Documents' });
                } else {
                    await uploadAirtableAttachment({ recordId: match.companyId, field: category, filename: att.filename, contentType: att.mimeType, base64, apiKey, baseId });
                    writeSummary.attachmentsUploaded.push({ filename: att.filename, category });
                }
            } catch (err) {
                console.error(`Attachment upload failed (${att.filename}):`, err.message);
                writeSummary.attachmentsFailed.push({ filename: att.filename, reason: err.message });
            }
        }
    }

    // Reminders extracted from the email content (zoom dates, follow-up commitments, etc).
    // Conservative — only when Sonnet found a concrete date/time.
    if (Array.isArray(extracted.reminders) && extracted.reminders.length > 0) {
        for (const rem of extracted.reminders) {
            try {
                if (match.recordType === 'lead') {
                    await createLeadReminder({
                        leadRecordId: match.recordId,
                        leadName: match.recordName,
                        leadEmail: email.from.email,
                        title: rem.title,
                        actionType: rem.actionType,
                        dueAt: rem.dueAt,
                        note: rem.note,
                        agent,
                        apiKey, baseId,
                    });
                } else {
                    await createConsultingTask({
                        companyId: match.companyId,
                        title: rem.title,
                        type: rem.actionType,
                        dueAt: rem.dueAt,
                        notes: rem.note,
                        owner: agent,
                        apiKey, baseId,
                    });
                }
                writeSummary.remindersCreated.push(rem);
            } catch (err) {
                console.error(`Reminder create failed (${rem.title}):`, err.message);
            }
        }
    }

    // ── Consolidated WhatsApp notification (one per email) ─────────────────
    // Only fire if anything actually got stored. If we wrote nothing (rare —
    // would mean everything errored out), skip the ping.
    const wroteSomething =
        writeSummary.noteWritten ||
        writeSummary.attachmentsUploaded.length > 0 ||
        writeSummary.remindersCreated.length > 0;
    if (wroteSomething) {
        await notifyOwner({
            owner: agent,
            writeSummary,
            fromName: email.from.name || email.from.email,
            fromEmail: email.from.email,
            effectiveSenderEmail: effectiveSenderEmail || email.from.email,
            isForward: !!isForward,
            recordName: match.recordName,
            recordType: match.recordType,
            subject: email.subject || '(no subject)',
        });
    }
}

/**
 * Fire-and-(mostly-)forget consolidated Slack notification for one processed email.
 * Lists what was stored (note, attachments, reminders) in a single message.
 * Routes to a per-owner webhook if SLACK_WEBHOOK_<OWNER> is set, else the
 * shared SLACK_WEBHOOK_URL (recommended: a single #crm-updates channel).
 * No-op if neither env var is configured.
 */
async function notifyOwner({
    owner, writeSummary, fromName, fromEmail, effectiveSenderEmail, isForward,
    recordName, recordType, subject,
}) {
    const webhookUrl = getOwnerSlackWebhook(owner);
    if (!webhookUrl) return; // no Slack configured — silently skip

    const lines = [`🔔 *CRM update for ${owner}*`];

    // Who + what record
    const recordLabel = recordType === 'lead' ? 'Lead' : 'Company';
    lines.push(`*${recordLabel}:* ${recordName}`);
    if (isForward) {
        lines.push(`*From (forwarded):* ${effectiveSenderEmail}`);
    } else {
        lines.push(`*From:* ${fromName}`);
    }
    if (subject) lines.push(`*Subject:* ${truncate(subject, 80)}`);
    lines.push(''); // blank line

    // Note
    if (writeSummary.noteWritten) {
        lines.push('📝 Note added');
    }

    // Attachments grouped by category
    if (writeSummary.attachmentsUploaded.length > 0) {
        const byCat = {};
        for (const a of writeSummary.attachmentsUploaded) {
            byCat[a.category] = (byCat[a.category] || 0) + 1;
        }
        const parts = Object.entries(byCat).map(([cat, n]) => `${n} → ${cat}`);
        lines.push(`📎 ${writeSummary.attachmentsUploaded.length} file${writeSummary.attachmentsUploaded.length > 1 ? 's' : ''}: ${parts.join(', ')}`);
    }
    if (writeSummary.attachmentsFailed.length > 0) {
        lines.push(`⚠️ ${writeSummary.attachmentsFailed.length} attachment upload(s) failed — review in Gmail`);
    }

    // Reminders (each one listed since these are time-sensitive)
    if (writeSummary.remindersCreated.length > 0) {
        lines.push(`⏰ ${writeSummary.remindersCreated.length} reminder${writeSummary.remindersCreated.length > 1 ? 's' : ''}:`);
        for (const rem of writeSummary.remindersCreated) {
            const due = new Date(rem.dueAt);
            const dueStr = isNaN(due.getTime()) ? rem.dueAt : due.toLocaleString('en-US', {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                hour12: true, timeZone: 'America/New_York',
            });
            lines.push(`  • ${rem.actionType}: ${rem.title} — ${dueStr} ET`);
        }
    }

    lines.push('');
    lines.push('<https://www.homesinsoflorida.com/crm|Open CRM →>');

    await sendSlackMessage({ webhookUrl, text: lines.join('\n') });
}

async function createLeadReminder({ leadRecordId, leadName, leadEmail, title, actionType, dueAt, note, agent, apiKey, baseId }) {
    const res = await fetch(`https://api.airtable.com/v0/${baseId}/Reminders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            records: [{
                fields: {
                    'Name': title,
                    'Lead Record ID': leadRecordId,
                    'Lead Name': leadName || '',
                    'Lead Email': leadEmail || '',
                    'Action Type': actionType,
                    'Due At': dueAt,
                    'Note': note || '',
                    'Status': 'Pending',
                    'Reminder Status': 'Pending',
                    'Agent Name': agent,
                    'Created At': new Date().toISOString(),
                },
            }],
            typecast: true,
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Reminder POST: ${err.error?.message || res.status}`);
    }
}

async function createConsultingTask({ companyId, title, type, dueAt, notes, owner, apiKey, baseId }) {
    const res = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            records: [{
                fields: {
                    'Title': title,
                    'Type': type,
                    'Due At': dueAt,
                    'Status': 'Pending',
                    'Owner': owner,
                    'Company': [companyId],
                    'Notes': notes || '',
                },
            }],
            typecast: true,
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Consulting Task POST: ${err.error?.message || res.status}`);
    }
}

/**
 * Internal team-discussion handler.
 *
 * Called when an internal team email (Noel/Dylan/Kevin/Rosa) doesn't look
 * like a forward but the body mentions one or more known CRM clients.
 * Sonnet extracts structured client references + per-person task assignments
 * + scheduled meetings. We then write each piece to the right CRM record.
 *
 * Returns { wroteSomething, summary } so the caller can log + Slack-notify.
 */
async function processTeamDiscussion({ email: m, clientList, dealList = [], listings = [], inbox, accessToken }) {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const agent = inbox.owner || 'Email Bot';

    const extracted = await extractTeamDiscussion({
        fromName: m.from.name || m.from.email,
        subject: m.subject,
        plainTextBody: m.plainText,
        clientList,    // already filtered to Type!=Partner
        dealList,
        listings,
    });

    if (!extracted) return { wroteSomething: false };

    const summary = {
        clientNotesWritten: 0,
        listingNotesWritten: 0,
        tasksCreated: [],   // [{assignee, title, companyId, dueAt}]
        meetingsCreated: [], // [{title, companyId, dueAt}]
        clientReferences: extracted.clientReferences || [],
        listingReferences: extracted.listingReferences || [],
        newClientsCreated: [], // [{name, id}]
    };

    const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    const subjectLine = m.subject ? ` Re: "${truncate(m.subject, 80)}"` : '';
    const fromLabel = `${m.from.name || m.from.email}`;

    // (0) Auto-create new Consulting Clients for HIGH-confidence newClientCandidates.
    // Medium/low: just include in Slack notification, don't auto-create — Kevin can
    // create them manually if real.
    for (const cand of (extracted.newClientCandidates || [])) {
        if (cand.confidence !== 'high') continue;
        // Skip if a same-named client already exists (case-insensitive)
        const dupe = clientList.find(c => c.name.toLowerCase().trim() === cand.name.toLowerCase().trim());
        if (dupe) {
            // Treat as existing client reference instead
            summary.clientReferences.push({
                companyId: dupe.id,
                companyName: dupe.name,
                excerpt: cand.evidence || '',
            });
            continue;
        }
        try {
            const createRes = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Clients`, {
                method: 'POST', headers,
                body: JSON.stringify({
                    records: [{
                        fields: {
                            'Company': cand.name,
                            'Type': 'Client',
                            'Status': 'Lead',
                            'Owner': agent,
                            'Source': `Auto-created from team email by ${fromLabel}`,
                            'Country': cand.country || '',
                            'Primary Contact': cand.primaryContact || '',
                            'Notes': `[${nowDateStr()} — ${agent}] AUTO-CREATED from team email: ${cand.evidence || '(no detail)'}`,
                            'Started At': new Date().toISOString().slice(0, 10),
                        },
                    }],
                    typecast: true,
                }),
            });
            if (createRes.ok) {
                const data = await createRes.json();
                const newId = data.records?.[0]?.id;
                if (newId) {
                    summary.newClientsCreated.push({ name: cand.name, id: newId, evidence: cand.evidence });
                    // Treat it as a client reference for the activity log below
                    summary.clientReferences.push({
                        companyId: newId,
                        companyName: cand.name,
                        excerpt: cand.evidence || '',
                    });
                    // Also push into Sonnet's reference list so attached tasks find it
                    extracted.clientReferences.push({
                        companyId: newId,
                        companyName: cand.name,
                        excerpt: cand.evidence || '',
                    });
                }
            } else {
                const err = await createRes.json().catch(() => ({}));
                console.error(`Auto-create client '${cand.name}' failed:`, err.error?.message || createRes.status);
            }
        } catch (err) {
            console.error(`Auto-create client exception (${cand.name}):`, err.message);
        }
    }

    // (1) For each referenced client, log a Note activity with the excerpt
    for (const ref of extracted.clientReferences) {
        const noteTitle = `Team note from ${fromLabel}: ${truncate(ref.excerpt || extracted.summary || m.subject || '(no subject)', 200)}`;
        const noteBody = `[via Gmail/${inbox.email} (team discussion from ${fromLabel})]${subjectLine}\n\n${ref.excerpt || extracted.summary}`;
        const res = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Activity`, {
            method: 'POST', headers,
            body: JSON.stringify({
                records: [{
                    fields: {
                        'Title': noteTitle.slice(0, 250),
                        'Type': 'Note',
                        'Company': [ref.companyId],
                        'Details': noteBody,
                        'Agent': agent,
                    },
                }],
                typecast: true,
            }),
        });
        if (res.ok) {
            summary.clientNotesWritten++;
        } else {
            console.error(`Team-discussion note write failed for ${ref.companyId}:`,
                (await res.json().catch(() => ({}))).error?.message || res.status);
        }
    }

    // (1b) Listing references — write to Listing Notes table
    for (const lref of (extracted.listingReferences || [])) {
        try {
            const matched = listings.find(l => String(l.mlsId) === String(lref.listingMlsId));
            const title = `Email note: ${truncate(lref.excerpt || extracted.summary || m.subject || '(no subject)', 200)}`;
            const body = `[via Gmail/${inbox.email} (team discussion from ${fromLabel})]${subjectLine}\n\n${lref.excerpt || extracted.summary}`;
            const res = await fetch(`https://api.airtable.com/v0/${baseId}/Listing%20Notes`, {
                method: 'POST', headers,
                body: JSON.stringify({
                    records: [{
                        fields: {
                            'Title': title.slice(0, 250),
                            'MLS ID': String(lref.listingMlsId),
                            'Listing Title': matched?.title || lref.listingTitle || '',
                            'Type': 'Email Logged',
                            'Details': body,
                            'Agent': agent,
                            'Created At': new Date().toISOString(),
                        },
                    }],
                    typecast: true,
                }),
            });
            if (res.ok) {
                summary.listingNotesWritten++;
            } else {
                console.error(`Listing note write failed for ${lref.listingMlsId}:`,
                    (await res.json().catch(() => ({}))).error?.message || res.status);
            }
        } catch (err) {
            console.error(`Listing note exception (${lref.listingMlsId}):`, err.message);
        }
    }

    // (2) Tasks assigned to specific team members
    for (const task of extracted.tasksAssigned) {
        try {
            await createConsultingTask({
                companyId: task.companyId || (extracted.clientReferences[0]?.companyId), // fallback to first ref
                title: task.title,
                type: 'Other',
                dueAt: task.dueAt || null,
                notes: task.notes ? `${task.notes}\n\n(Assigned by ${fromLabel} via team email)` : `Assigned by ${fromLabel}`,
                owner: task.assignee,
                apiKey, baseId,
            });
            summary.tasksCreated.push(task);
        } catch (err) {
            console.error(`Team task create failed (${task.title}):`, err.message);
        }
    }

    // (3) Meetings — also Consulting Tasks but Type=Meeting
    for (const meeting of extracted.meetingsScheduled) {
        try {
            await createConsultingTask({
                companyId: meeting.companyId || (extracted.clientReferences[0]?.companyId),
                title: meeting.title,
                type: 'Meeting',
                dueAt: meeting.dueAt,
                notes: meeting.notes ? `${meeting.notes}\n\n(Set up via team email from ${fromLabel})` : `Set up via team email from ${fromLabel}`,
                owner: agent, // default to the sender's owner; could refine
                apiKey, baseId,
            });
            summary.meetingsCreated.push(meeting);
        } catch (err) {
            console.error(`Team meeting create failed (${meeting.title}):`, err.message);
        }
    }

    const wroteSomething =
        summary.clientNotesWritten > 0 ||
        summary.listingNotesWritten > 0 ||
        summary.tasksCreated.length > 0 ||
        summary.meetingsCreated.length > 0 ||
        (summary.newClientsCreated && summary.newClientsCreated.length > 0);

    if (wroteSomething) {
        await notifyOwnerTeamDiscussion({
            owner: agent,
            fromLabel,
            subject: m.subject || '(no subject)',
            extracted,
            summary,
        });
    }

    return { wroteSomething, summary };
}

/**
 * Consolidated Slack notification for a processed team-discussion email.
 */
async function notifyOwnerTeamDiscussion({ owner, fromLabel, subject, extracted, summary }) {
    const webhookUrl = getOwnerSlackWebhook(owner);
    if (!webhookUrl) return;

    const lines = [`📋 *Team discussion — auto-logged to CRM*`];
    lines.push(`*From:* ${fromLabel}`);
    if (subject) lines.push(`*Subject:* ${truncate(subject, 80)}`);
    lines.push('');

    if (extracted.summary) lines.push(`_${extracted.summary}_`);
    lines.push('');

    if (summary.newClientsCreated && summary.newClientsCreated.length > 0) {
        lines.push(`🆕 *New clients auto-created:* ${summary.newClientsCreated.map(c => c.name).join(', ')}`);
    }
    if (summary.clientReferences.length > 0) {
        lines.push(`*Clients referenced:* ${summary.clientReferences.map(r => r.companyName).join(', ')}`);
    }
    if (summary.listingReferences.length > 0) {
        lines.push(`*Listings referenced:* ${summary.listingReferences.map(r => r.listingTitle).join(', ')}`);
    }
    if (summary.clientNotesWritten > 0) {
        lines.push(`📝 ${summary.clientNotesWritten} client note${summary.clientNotesWritten > 1 ? 's' : ''} added`);
    }
    if (summary.listingNotesWritten > 0) {
        lines.push(`🏠 ${summary.listingNotesWritten} listing note${summary.listingNotesWritten > 1 ? 's' : ''} added`);
    }
    if (summary.tasksCreated.length > 0) {
        lines.push(`⏰ ${summary.tasksCreated.length} task${summary.tasksCreated.length > 1 ? 's' : ''}:`);
        for (const t of summary.tasksCreated) {
            const due = t.dueAt ? new Date(t.dueAt) : null;
            const dueStr = due && !isNaN(due.getTime()) ? due.toLocaleString('en-US', {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                hour12: true, timeZone: 'America/New_York',
            }) + ' ET' : 'no due date';
            lines.push(`  • *${t.assignee}* → ${t.title} — ${dueStr}`);
        }
    }
    if (summary.meetingsCreated.length > 0) {
        lines.push(`📅 ${summary.meetingsCreated.length} meeting${summary.meetingsCreated.length > 1 ? 's' : ''}:`);
        for (const m of summary.meetingsCreated) {
            const due = new Date(m.dueAt);
            const dueStr = isNaN(due.getTime()) ? 'no time' : due.toLocaleString('en-US', {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                hour12: true, timeZone: 'America/New_York',
            }) + ' ET';
            lines.push(`  • ${m.title} ${m.companyName ? `(${m.companyName})` : ''} — ${dueStr}`);
        }
    }

    lines.push('');
    lines.push('<https://www.homesinsoflorida.com/crm|Open CRM →>');

    await sendSlackMessage({ webhookUrl, text: lines.join('\n') });
}

/**
 * Lightweight Slack ping for an external email whose sender isn't in CRM.
 * No Sonnet call — keeps cost at zero per ping. Includes a heuristic skip
 * for likely-newsletter content so we don't blast Slack with marketing junk
 * that slipped past the SKIP_DOMAINS filter.
 */
async function notifyUnmatchedSlack({ owner, fromName, fromEmail, subject, snippet, isForward }) {
    const webhookUrl = getOwnerSlackWebhook(owner);
    if (!webhookUrl) return;

    // Heuristic skip: if the body looks like a newsletter/mass blast, skip the ping.
    // We've already gated by SKIP_DOMAINS + isNoreplyLocal, but some marketing emails
    // sneak through. Common giveaways:
    const newsletterSignals = [
        'unsubscribe', 'view in browser', 'view this email in your browser',
        'manage your preferences', 'opt out', 'mass email', 'do not reply',
        'this is a marketing', 'promotional email',
    ];
    const lc = (snippet || '').toLowerCase();
    if (newsletterSignals.some(s => lc.includes(s))) return;

    const lines = [`⚠️ *Unmatched email — not in CRM yet*`];
    lines.push(`*From:* ${fromName ? fromName + ' ' : ''}<${fromEmail}>`);
    if (isForward) lines.push(`_Forwarded by team_`);
    lines.push(`*Subject:* ${truncate(subject, 100)}`);
    if (snippet) {
        lines.push('');
        lines.push(`> ${truncate(snippet.replace(/\n+/g, ' '), 220)}`);
    }
    lines.push('');
    lines.push('If this is a real lead/contact, add them to the CRM. Otherwise ignore.');
    lines.push('<https://www.homesinsoflorida.com/crm|Open CRM →>');

    await sendSlackMessage({ webhookUrl, text: lines.join('\n') });
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
