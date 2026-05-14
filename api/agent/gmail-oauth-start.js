/**
 * /api/agent/gmail-oauth-start.js — initiates Google OAuth consent flow.
 *
 * Query:
 *   ?email=<gmailAddressToAuthorize>
 *   &owner=<Kevin|Noel|Dylan|Rosa>
 *
 * Scopes: gmail.readonly + gmail.modify + gmail.send
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
            'Example: /api/agent/gmail-oauth-start?email=kevinpolermiami@gmail.com&owner=Kevin',
            { status: 400 }
        );
    }

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
