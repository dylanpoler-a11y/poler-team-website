/**
 * /api/cron/daily-audit.js — runs once a day (Vercel cron, Hobby-allowed daily).
 *
 * Two jobs:
 *
 *   1. Health check: read Last Polled on every active Team Inboxes row.
 *      If any has been stale > 30 min, fire a Slack alert so Kevin knows
 *      cron-job.org may have stopped firing the 5-min polling cron.
 *
 *   2. Audit: scan every Gmail message labeled CRM_UNMATCHED in the last 24h.
 *      Sonnet decides which ones look like real missed opportunities (lead /
 *      consulting client / partner) vs noise (newsletters, automated alerts).
 *      Post a Slack summary so Kevin can decide what to add to CRM.
 *
 * Triggered by Vercel cron (vercel.json) — no external scheduler needed for
 * the daily run.
 *
 * Auth: Vercel cron sends Authorization: Bearer $CRON_SECRET.
 */

export const config = { runtime: 'edge' };

import { listActiveInboxes } from '../../lib/team-inboxes.js';
import { refreshAccessToken, listRecentMessages, fetchMessage, parseMessage } from '../../lib/gmail.js';
import { sendSlackMessage, getOwnerSlackWebhook } from '../../lib/slack.js';

const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 min

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

    const inboxes = await listActiveInboxes().catch(err => ({ error: err.message }));
    if (inboxes?.error) return json({ error: inboxes.error }, 500);
    if (!Array.isArray(inboxes) || inboxes.length === 0) {
        return json({ ok: true, message: 'No active inboxes', healthOk: true, auditedCount: 0 });
    }

    // ── (1) HEALTH CHECK ──────────────────────────────────────────────────────
    const now = Date.now();
    const stale = inboxes.filter(i => {
        const polledAt = i.lastPolled ? Date.parse(i.lastPolled) : 0;
        return !polledAt || (now - polledAt) > STALE_THRESHOLD_MS;
    });

    if (stale.length > 0) {
        // Send health alert via the shared webhook (no per-owner — this is infra)
        const webhookUrl = process.env.SLACK_WEBHOOK_URL;
        if (webhookUrl) {
            const lines = ['🚨 *CRM email-sync health alert*'];
            for (const i of stale) {
                const ageMin = i.lastPolled ? Math.round((now - Date.parse(i.lastPolled)) / 60000) : 'never';
                lines.push(`• ${i.email} (owner: ${i.owner}) — last polled ${ageMin === 'never' ? 'NEVER' : `${ageMin} min ago`}`);
            }
            lines.push('');
            lines.push('The 5-min polling cron may have stopped firing. Check cron-job.org for the *Poler CRM email sync* job.');
            lines.push('<https://cron-job.org/en/members/jobs/|Open cron-job.org →>');
            await sendSlackMessage({ webhookUrl, text: lines.join('\n') });
        }
    }

    // ── (2) AUDIT UNMATCHED EMAILS ────────────────────────────────────────────
    // For each inbox, list CRM_UNMATCHED emails from the last 24h, then ask
    // Sonnet to flag any that look like real missed opportunities.
    const auditResults = [];
    for (const inbox of inboxes) {
        let accessToken;
        try { accessToken = await refreshAccessToken(inbox.refreshToken); }
        catch (err) { console.error(`[daily-audit] token refresh failed for ${inbox.email}:`, err.message); continue; }

        let messages;
        try {
            messages = await listRecentMessages(accessToken, 'label:CRM_UNMATCHED newer_than:1d', 30);
        } catch (err) {
            console.error(`[daily-audit] list failed for ${inbox.email}:`, err.message);
            continue;
        }
        if (!messages || messages.length === 0) continue;

        const headerLines = [];
        for (const msgRef of messages.slice(0, 25)) {
            try {
                const raw = await fetchMessage(msgRef.id, accessToken);
                const m = parseMessage(raw);
                headerLines.push(`From: ${m.from.name ? m.from.name + ' ' : ''}<${m.from.email}>\nSubject: ${m.subject}\nSnippet: ${(m.snippet || '').slice(0, 200)}\n---`);
            } catch (err) { /* skip individual fetch errors */ }
        }
        if (headerLines.length === 0) continue;

        const auditText = await runAuditSummary(headerLines.join('\n'), inbox.owner);
        if (auditText) auditResults.push({ inbox: inbox.email, owner: inbox.owner, count: headerLines.length, summary: auditText });
    }

    // Post one consolidated Slack message for all inboxes
    if (auditResults.length > 0) {
        const webhookUrl = process.env.SLACK_WEBHOOK_URL;
        if (webhookUrl) {
            const lines = ['📊 *Daily inbox audit — possible missed leads/clients*'];
            for (const r of auditResults) {
                lines.push('');
                lines.push(`*${r.inbox}* (${r.count} unmatched emails reviewed):`);
                lines.push(r.summary);
            }
            lines.push('');
            lines.push('<https://www.homesinsoflorida.com/crm|Open CRM →>');
            await sendSlackMessage({ webhookUrl, text: lines.join('\n') });
        }
    }

    return json({
        ok: true,
        healthOk: stale.length === 0,
        staleInboxes: stale.length,
        auditedInboxes: auditResults.length,
    });
}

async function runAuditSummary(headerListText, owner) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-5-20250514',
            max_tokens: 800,
            system: `You are auditing yesterday's unmatched inbound emails for The Poler Team CRM. The team handles South Florida luxury real estate + LATAM consulting. Look through the list of unmatched senders + subjects + snippets, and identify the ones that look like REAL missed opportunities — actual leads (someone interested in property), actual consulting prospects, or known business contacts who should be in CRM. SKIP newsletters, mass marketing, automated systems, recruiter spam, course sales.

Output: a short Slack-friendly bullet list (max 6 items) of the top missed opportunities, formatted like:
• <email> — <one-line reason this looks real>

If none look like real opportunities, say "No actionable leads in this batch." Plain text only, no JSON, no markdown headers.`,
            messages: [{ role: 'user', content: `Owner: ${owner}\n\nUnmatched emails from last 24h:\n\n${headerListText}` }],
        }),
    });
    if (!res.ok) {
        console.error(`[daily-audit] Anthropic ${res.status}`);
        return null;
    }
    const data = await res.json();
    return data.content?.[0]?.text || null;
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
