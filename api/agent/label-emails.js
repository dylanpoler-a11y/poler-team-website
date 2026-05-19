/**
 * /api/agent/label-emails.js — bulk Gmail labeling endpoint.
 *
 * Built for the background labeling agent that classifies all of Kevin's
 * inbox under flat top-level labels (Consulting Client - X, Real Estate
 * Lead, Team Internal, Promotional, Personal/Financial, etc.).
 *
 * The Gmail MCP available to Claude/Claude Code is read-only — to apply
 * labels we need gmail.modify scope, which the cron's OAuth flow already
 * has. This endpoint borrows that scope server-side.
 *
 * Auth: AGENT_API_TOKEN bearer OR CRM_PASSWORD (same pattern as the rest of
 * the agent endpoints).
 *
 * Request:
 *   POST /api/agent/label-emails
 *   { "operations": [
 *       { "threadIds": ["abc","def"], "addLabels": ["Consulting Client - Toyosa"], "removeLabels": [] },
 *       { "threadIds": ["ghi"],       "addLabels": ["Promotional"] }
 *     ],
 *     "inboxEmail": "kevinpolermiami@gmail.com"  // optional, defaults to first active
 *   }
 *
 * Response: { ok, applied: N, errors: [...] }
 *
 * Safety: refuses to operate on the CRM_* system labels (CRM_PROCESSED,
 * CRM_UNMATCHED, CRM_NEEDS_REVIEW, CRM_REPROCESSED) — those are owned by the
 * cron and shouldn't be touched by the labeling agent.
 */

export const config = { runtime: 'edge' };

import { authorize } from '../_auth.js';
import { listActiveInboxes } from '../../lib/team-inboxes.js';
import { refreshAccessToken, ensureLabel } from '../../lib/gmail.js';

// Only system + cron-managed labels are protected from REMOVAL. We allow
// removal of CRM_PROCESSED / CRM_UNMATCHED / CRM_NEEDS_REVIEW / CRM_REPROCESSED
// so threads can be re-queued for the cron without going through the heavy
// reprocess batch flow. We still BLOCK ADDING these (cron owns adding them).
const REMOVE_ONLY_CRM_LABELS = new Set([
    'CRM_PROCESSED', 'CRM_UNMATCHED', 'CRM_NEEDS_REVIEW', 'CRM_REPROCESSED',
]);
const PROTECTED_LABELS = new Set([
    'INBOX', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'IMPORTANT', 'STARRED', 'UNREAD',
]);

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

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

    // Auth — also accept password via query string for convenience
    let body = {};
    try { body = await req.json(); } catch { /* empty OK */ }
    const url = new URL(req.url);
    if (!body.password && url.searchParams.get('password')) body.password = url.searchParams.get('password');
    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);

    // Color-update mode: { colorUpdates: [{ labelName, textColor, backgroundColor }, ...] }
    // Uses cron's OAuth (which has gmail.modify) to apply Gmail label colors.
    const hasColorUpdates = Array.isArray(body.colorUpdates) && body.colorUpdates.length > 0;
    const hasOperations = Array.isArray(body.operations) && body.operations.length > 0;
    if (!hasColorUpdates && !hasOperations) {
        return json({ error: 'operations or colorUpdates array required' }, 400);
    }

    // Find the inbox to operate on
    const inboxes = await listActiveInboxes().catch(err => ({ error: err.message }));
    if (inboxes?.error) return json({ error: inboxes.error }, 500);
    if (!Array.isArray(inboxes) || inboxes.length === 0) {
        return json({ error: 'No active inboxes' }, 500);
    }
    const targetEmail = (body.inboxEmail || inboxes[0].email).toLowerCase();
    const inbox = inboxes.find(i => (i.email || '').toLowerCase() === targetEmail);
    if (!inbox) return json({ error: `Inbox not found: ${body.inboxEmail}` }, 404);

    let accessToken;
    try { accessToken = await refreshAccessToken(inbox.refreshToken); }
    catch (err) { return json({ error: `token refresh: ${err.message}` }, 500); }

    let applied = 0;
    let threadsProcessed = 0;
    let colorsApplied = 0;
    const errors = [];

    // Color-update pass FIRST (independent of operations)
    if (hasColorUpdates) {
        // Load existing labels once to resolve names → ids
        const labelsRes = await fetch(`${GMAIL_BASE}/labels`, { headers: { Authorization: `Bearer ${accessToken}` } });
        const labelsData = labelsRes.ok ? await labelsRes.json() : { labels: [] };
        const labelByName = new Map((labelsData.labels || []).map(l => [l.name, l]));

        for (const upd of body.colorUpdates) {
            const lab = labelByName.get(upd.labelName);
            if (!lab) {
                errors.push({ colorUpdate: upd, error: `Label not found: ${upd.labelName}` });
                continue;
            }
            try {
                const patchRes = await fetch(`${GMAIL_BASE}/labels/${lab.id}`, {
                    method: 'PATCH',
                    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        color: { textColor: upd.textColor, backgroundColor: upd.backgroundColor },
                    }),
                });
                if (!patchRes.ok) {
                    const errText = await patchRes.text();
                    errors.push({ colorUpdate: upd, error: `${patchRes.status}: ${errText.slice(0, 200)}` });
                    continue;
                }
                colorsApplied++;
            } catch (err) {
                errors.push({ colorUpdate: upd, error: err.message });
            }
        }
    }

    if (!hasOperations) {
        return json({ ok: errors.length === 0, colorsApplied, errors });
    }

    for (const op of body.operations) {
        const threadIds = Array.isArray(op.threadIds) ? op.threadIds : [];
        const addLabelNames = (Array.isArray(op.addLabels) ? op.addLabels : []).filter(Boolean);
        const removeLabelNames = (Array.isArray(op.removeLabels) ? op.removeLabels : []).filter(Boolean);

        // System labels (INBOX/SENT/etc) — never touchable.
        const allLabels = [...addLabelNames, ...removeLabelNames];
        const blockedSystem = allLabels.find(l => PROTECTED_LABELS.has(l));
        if (blockedSystem) {
            errors.push({ op, error: `Refused: label "${blockedSystem}" is a Gmail system label` });
            continue;
        }
        // CRM_* labels — REMOVE allowed (re-queue), ADD blocked (cron-owned).
        const blockedAdd = addLabelNames.find(l => REMOVE_ONLY_CRM_LABELS.has(l));
        if (blockedAdd) {
            errors.push({ op, error: `Refused: cannot add "${blockedAdd}" — owned by cron. Removal is allowed.` });
            continue;
        }

        // Resolve label names → IDs (creates if missing)
        let addLabelIds, removeLabelIds;
        try {
            addLabelIds = await Promise.all(addLabelNames.map(n => ensureLabel(n, accessToken)));
            removeLabelIds = await Promise.all(removeLabelNames.map(n => ensureLabel(n, accessToken)));
        } catch (err) {
            errors.push({ op, error: `label resolve: ${err.message}` });
            continue;
        }

        // Apply to each thread
        for (const threadId of threadIds) {
            try {
                const res = await fetch(`${GMAIL_BASE}/threads/${threadId}/modify`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ addLabelIds, removeLabelIds }),
                });
                if (!res.ok) {
                    const errText = await res.text();
                    errors.push({ threadId, error: `${res.status}: ${errText.slice(0, 200)}` });
                    continue;
                }
                threadsProcessed++;
                applied += (addLabelIds.length + removeLabelIds.length);
            } catch (err) {
                errors.push({ threadId, error: err.message });
            }
        }
    }

    return json({
        ok: errors.length === 0,
        threadsProcessed,
        labelOperationsApplied: applied,
        errors: errors.slice(0, 50), // cap so the response stays small
        errorCount: errors.length,
    });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
