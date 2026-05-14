/**
 * lib/gmail.js — Gmail API helpers for Edge runtime.
 *
 * Uses raw fetch (no googleapis SDK — not Edge-compatible).
 * All functions take an accessToken; call refreshAccessToken first.
 */

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export async function refreshAccessToken(refreshToken) {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('Google OAuth client not configured');
    if (!refreshToken) throw new Error('refresh_token required');

    const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
    });

    const res = await fetch(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Token refresh failed: ${res.status} ${err}`);
    }
    const data = await res.json();
    return data.access_token;
}

export async function listRecentMessages(accessToken, query = 'newer_than:1h', maxResults = 50) {
    const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
    const res = await fetch(`${GMAIL_BASE}/messages?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`listMessages failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.messages || [];
}

export async function fetchMessage(id, accessToken) {
    const res = await fetch(`${GMAIL_BASE}/messages/${id}?format=full`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`fetchMessage failed: ${res.status} ${await res.text()}`);
    return res.json();
}

/**
 * Parse the most useful bits out of a Gmail message payload.
 */
export function parseMessage(msg) {
    const headers = msg.payload?.headers || [];
    const headerMap = {};
    for (const h of headers) headerMap[h.name.toLowerCase()] = h.value;

    const from = parseAddress(headerMap['from'] || '');
    const plainText = extractPlainText(msg.payload) || msg.snippet || '';
    const attachments = extractAttachmentRefs(msg.payload);

    return {
        id: msg.id,
        threadId: msg.threadId,
        labelIds: msg.labelIds || [],
        from,
        fromRaw: headerMap['from'] || '',
        to: headerMap['to'] || '',
        subject: headerMap['subject'] || '',
        date: headerMap['date'] || '',
        snippet: msg.snippet || '',
        plainText: plainText.slice(0, 12000),
        attachments,
    };
}

/**
 * NEW: When sender is internal AND subject looks like a forward, scan body for
 * the original (external) sender. Returns an ordered list of email addresses
 * found in From:/To:/Cc: lines in the forwarded text, lowercased + deduped.
 *
 * Heuristics cover Gmail/Outlook/Apple Mail forward formats:
 *   From: Name <foo@bar.com>
 *   From: foo@bar.com
 *   To: 'Person' <p@x.com>
 *   "On Mon, May 11, 2026, at 3:13 PM, Foo wrote:" — preceded by quoted block
 */
export function parseForwardedSenders(plainText, internalDomains = []) {
    if (!plainText) return [];
    const found = [];
    const seen = new Set();

    // Match: "From: <anything> <email@domain>"  OR  "From: email@domain"
    // Also handles "To:", "Cc:", "Bcc:" lines inside forwarded text.
    const re = /(?:^|\n)\s*(?:>+\s*)?(?:From|To|Cc|Bcc|Reply-To):\s*([^\n]+)/gi;
    let m;
    while ((m = re.exec(plainText)) !== null) {
        const line = m[1];
        // Extract email addresses from the line (handles "Name <email@x>" and bare emails)
        const emailRe = /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;
        let em;
        while ((em = emailRe.exec(line)) !== null) {
            const e = em[1].toLowerCase();
            if (seen.has(e)) continue;
            seen.add(e);
            const domain = e.split('@')[1] || '';
            const isInternal = internalDomains.some(d => domain === d || domain.endsWith('.' + d));
            if (!isInternal) found.push(e);
        }
    }
    return found;
}

export function isForwardSubject(subject = '') {
    return /^\s*(?:re:\s*)?fwd?:\s*/i.test(subject) || /^\s*(?:re:\s*)?fw:\s*/i.test(subject);
}

export function extractAttachmentRefs(payload) {
    const out = [];
    walk(payload);
    return out;
    function walk(part) {
        if (!part) return;
        const filename = part.filename || '';
        const attachmentId = part.body?.attachmentId || '';
        if (filename && attachmentId) {
            const headers = part.headers || [];
            const disposition = (headers.find(h => h.name.toLowerCase() === 'content-disposition')?.value || '').toLowerCase();
            if (!disposition.startsWith('inline')) {
                out.push({
                    filename,
                    mimeType: part.mimeType || 'application/octet-stream',
                    attachmentId,
                    size: part.body?.size || 0,
                });
            }
        }
        if (part.parts) for (const p of part.parts) walk(p);
    }
}

export async function fetchAttachment(messageId, attachmentId, accessToken) {
    const res = await fetch(`${GMAIL_BASE}/messages/${messageId}/attachments/${attachmentId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`fetchAttachment failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return base64UrlToBase64(data.data || '');
}

function base64UrlToBase64(s) {
    const norm = s.replace(/-/g, '+').replace(/_/g, '/');
    return norm + '==='.slice((norm.length + 3) % 4);
}

const labelIdCache = new Map();

export async function ensureLabel(name, accessToken) {
    const cacheKey = `${accessToken.slice(0, 12)}:${name}`;
    if (labelIdCache.has(cacheKey)) return labelIdCache.get(cacheKey);

    const listRes = await fetch(`${GMAIL_BASE}/labels`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!listRes.ok) throw new Error(`labels.list failed: ${listRes.status}`);
    const listData = await listRes.json();
    const existing = (listData.labels || []).find(l => l.name === name);
    if (existing) {
        labelIdCache.set(cacheKey, existing.id);
        return existing.id;
    }

    const createRes = await fetch(`${GMAIL_BASE}/labels`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
    });
    if (!createRes.ok) throw new Error(`labels.create failed: ${createRes.status} ${await createRes.text()}`);
    const created = await createRes.json();
    labelIdCache.set(cacheKey, created.id);
    return created.id;
}

export async function applyLabel(messageId, labelName, accessToken) {
    const labelId = await ensureLabel(labelName, accessToken);
    const res = await fetch(`${GMAIL_BASE}/messages/${messageId}/modify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ addLabelIds: [labelId] }),
    });
    if (!res.ok) throw new Error(`applyLabel failed: ${res.status} ${await res.text()}`);
    return res.json();
}

export function parseAddress(addr) {
    if (!addr) return { name: '', email: '' };
    const m = addr.match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/);
    if (m) return { name: (m[1] || '').trim(), email: m[2].trim().toLowerCase() };
    return { name: '', email: addr.trim().toLowerCase() };
}

function extractPlainText(payload) {
    if (!payload) return '';
    if (payload.mimeType === 'text/plain' && payload.body?.data) return b64urlDecode(payload.body.data);
    if (payload.parts) {
        for (const p of payload.parts) {
            if (p.mimeType === 'text/plain' && p.body?.data) return b64urlDecode(p.body.data);
        }
        for (const p of payload.parts) {
            const r = extractPlainText(p);
            if (r) return r;
        }
        for (const p of payload.parts) {
            if (p.mimeType === 'text/html' && p.body?.data) return stripHtml(b64urlDecode(p.body.data));
        }
    }
    if (payload.mimeType === 'text/html' && payload.body?.data) return stripHtml(b64urlDecode(payload.body.data));
    return '';
}

function b64urlDecode(s) {
    try {
        const norm = s.replace(/-/g, '+').replace(/_/g, '/');
        const padded = norm + '==='.slice((norm.length + 3) % 4);
        const bin = atob(padded);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder('utf-8').decode(bytes);
    } catch {
        return '';
    }
}

function stripHtml(html) {
    return html
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
}
