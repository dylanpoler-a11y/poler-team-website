/**
 * /api/agent/gmail-oauth-start.js
 *
 * Initiates Google OAuth consent flow for a Gmail inbox.
 *
 * Query:
 *   ?email=<gmailAddressToAuthorize>   (e.g. kevinpolermiami@gmail.com)
 *   &owner=<Kevin|Noel|Dylan|Rosa>     (which team member owns this inbox)
 *
 * Each Gmail account gets its own row in the Team Inboxes Airtable table —
 * so Rosa (or anyone) can OAuth multiple accounts, each owned by her.
 *
 * Scopes:
 *   gmail.readonly — list + read messages
 *   gmail.modify   — apply CRM_PROCESSED / CRM_UNMATCHED labels
 *   gmail.send     — send outbound on behalf of the inbox (for the outbound endpoint)
 */

export const config = { runtime: 'edge' };

export default async function handler(req) {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const redirectUri = process.env.OAUTH_REDIRECT_URI
        || 'https://www.homesinsoflorida.com/api/agent/gmail-oauth-callback';

    if (!clientId) {
        return new Response(
            'Google OAuth not configured. Set GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET in Vercel env.',
            { status: 500 }
        );
    }

    const url = new URL(req.url);
    const email = (url.searchParams.get('email') || '').trim();
    const owner = (url.searchParams.get('owner') || '').trim();

    if (!email) {
        return new Response(
            'Missing ?email=<yourGmailAddress>&owner=<Kevin|Noel|Dylan|Rosa>. ' +
            'Example: /api/agent/gmail-oauth-start?email=rosadasilvapoler@gmail.com&owner=Rosa',
            { status: 400 }
        );
    }

    // state carries email+owner so the callback can write the right row.
    const state = b64url(JSON.stringify({ email, owner }));

    const scopes = [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/gmail.send',
    ].join(' ');

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes,
        access_type: 'offline',
        prompt: 'consent',
        login_hint: email,
        state,
        include_granted_scopes: 'true',
    });

    return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
}

function b64url(s) {
    return btoa(unescape(encodeURIComponent(s)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
