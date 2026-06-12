/**
 * lib/slack.js — send messages to Slack via Incoming Webhooks.
 *
 * Required env vars (set ONE of these patterns):
 *
 *   Option A — shared team channel (recommended for CRM-updates visibility):
 *     SLACK_WEBHOOK_URL  = 'https://hooks.slack.com/services/T.../B.../...'
 *     All notifications land in whichever channel that webhook is bound to
 *     (e.g. #crm-updates). Owner is mentioned in the message body.
 *
 *   Option B — per-owner channels (optional override):
 *     SLACK_WEBHOOK_KEVIN, SLACK_WEBHOOK_NOEL,
 *     SLACK_WEBHOOK_DYLAN, SLACK_WEBHOOK_ROSA
 *     If a per-owner URL exists it wins over SLACK_WEBHOOK_URL.
 *     Use this if you want personal-channel routing later.
 *
 * Setup (one-time, 5 min):
 *   1. https://api.slack.com/apps → Create New App → From scratch
 *   2. App name: "Poler CRM Bot" — pick your workspace
 *   3. In the app, click "Incoming Webhooks" → enable
 *   4. "Add New Webhook to Workspace" → pick a channel (e.g. #crm-updates)
 *   5. Slack gives you a webhook URL — paste that as SLACK_WEBHOOK_URL env var
 */

/**
 * Returns the Slack webhook URL for a given owner, falling back to the shared
 * SLACK_WEBHOOK_URL. Returns null if neither is configured.
 */
export function getOwnerSlackWebhook(owner) {
    const perOwner = (process.env[`SLACK_WEBHOOK_${(owner || '').toUpperCase()}`] || '').trim();
    if (perOwner) return perOwner;
    const shared = (process.env.SLACK_WEBHOOK_URL || '').trim();
    return shared || null;
}

/**
 * Send a single Slack message via Incoming Webhook. Returns true on success,
 * false on failure. NEVER throws — meant to be best-effort from the cron.
 *
 * @param {object} args
 * @param {string} args.webhookUrl  — full Slack webhook URL
 * @param {string} args.text        — message body (Slack mrkdwn supported)
 */
export async function sendSlackMessage({ webhookUrl, text }) {
    return (await sendSlackPing({ webhookUrl, text })) === 'ok';
}

/**
 * Like sendSlackMessage but returns a machine-readable OUTCOME string instead
 * of a boolean, so callers can persist whether a ping actually landed:
 *   'ok'              — webhook accepted (HTTP 2xx)
 *   'fail-nowebhook'  — no webhook URL configured
 *   'fail-notext'     — empty message body
 *   'fail-<status>'   — webhook returned a non-2xx HTTP status
 *   'fail-error'      — fetch threw (network / DNS / timeout)
 * NEVER throws. Added 2026-06-12 (slack_coverage instrumentation — every CRM
 * write must produce exactly one recorded ping outcome).
 */
export async function sendSlackPing({ webhookUrl, text }) {
    if (!webhookUrl) {
        console.warn('[slack] no webhook URL provided');
        return 'fail-nowebhook';
    }
    if (!text) return 'fail-notext';

    try {
        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text.slice(0, 4000) }),
        });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            console.error(`[slack] webhook ${res.status}: ${txt.slice(0, 300)}`);
            return `fail-${res.status}`;
        }
        return 'ok';
    } catch (err) {
        console.error('[slack] send failed:', err.message);
        return 'fail-error';
    }
}
