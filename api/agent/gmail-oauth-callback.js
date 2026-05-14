/**
 * /api/agent/gmail-oauth-callback.js — receives ?code=&state= from Google,
 * exchanges code for tokens, confirms email, upserts into Airtable Team Inboxes.
 * NO manual paste step.
 */

export const config = { runtime: 'edge' };

import { upsertInbox } from '../../lib/team-inboxes.js';

export default async function handler(req) {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const redirectUri = process.env.OAUTH_REDIRECT_URI
        || 'https://www.homesinsoflorida.com/api/agent/gmail-oauth-callback';

    if (!clientId || !clientSecret) return html(500, 'Google OAuth not configured.');

    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const stateParam = url.searchParams.get('state') || '';
    const errParam = url.searchParams.get('error');

    if (errParam) return html(400, `OAuth error from Google: ${escapeHtml(errParam)}`);
    if (!code) return html(400, 'Missing ?code= from Google.');

    let stateData = {};
    try { stateData = JSON.parse(b64urlDecode(stateParam)); } catch { /* ignore */ }
    const ownerHint = stateData.owner || '';
    const emailHint = stateData.email || '';

    const tokenBody = new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri, grant_type: 'authorization_code',
    });

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody,
    });

    if (!tokenRes.ok) return html(500, `Token exchange failed: ${tokenRes.status}<br><pre>${escapeHtml(await tokenRes.text())}</pre>`);

    const tokens = await tokenRes.json();
    const refreshToken = tokens.refresh_token;

    if (!refreshToken) {
        return html(400, `
            No refresh_token returned. This happens when Google has already issued one for this client+account combo.
            Revoke access at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>
            and retry the OAuth flow.
        `);
    }

    let confirmedEmail = emailHint;
    try {
        const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (profileRes.ok) {
            const p = await profileRes.json();
            if (p.emailAddress) confirmedEmail = p.emailAddress;
        }
    } catch { /* non-fatal */ }

    if (!confirmedEmail) return html(500, 'Could not determine Gmail address. Try again.');

    try {
        const result = await upsertInbox({
            email: confirmedEmail,
            owner: ownerHint,
            refreshToken,
        });

        return html(200, `
            <h1 style="color:#1a2744;">Gmail Connected ✅</h1>
            <p><strong>${escapeHtml(confirmedEmail)}</strong> is now syncing to the CRM.</p>
            <p style="color:#475569;">
                ${result.created ? 'Added to Team Inboxes.' : 'Updated existing Team Inboxes row.'}
                Owner: <strong>${escapeHtml(ownerHint || '(unset)')}</strong>.
            </p>
            <p style="color:#475569;">
                Emails from CRM contacts will be auto-logged. Forwards from teammates will be parsed for the original sender.
            </p>
            <p style="color:#64748b;font-size:13px;margin-top:30px;">
                Revoke access anytime at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>,
                or uncheck the Active box on the Team Inboxes row to pause without revoking.
            </p>
        `);
    } catch (err) {
        return html(500, `
            <h1 style="color:#b91c1c;">Saved to Google, but Airtable write failed.</h1>
            <p>Error: <code>${escapeHtml(err.message)}</code></p>
            <p>Refresh token (back it up before retrying — it won't be shown again):</p>
            <pre style="background:#fef3c7;padding:10px;border-radius:6px;white-space:pre-wrap;word-break:break-all;border:1px solid #c8a55a;">${escapeHtml(refreshToken)}</pre>
        `);
    }
}

function html(status, body) {
    return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Gmail OAuth</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1e293b;line-height:1.5;}</style>
</head><body>${body}</body></html>`, {
        status, headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
}

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function b64urlDecode(s) {
    if (!s) return '';
    const norm = s.replace(/-/g, '+').replace(/_/g, '/');
    const padded = norm + '==='.slice((norm.length + 3) % 4);
    return atob(padded);
}
