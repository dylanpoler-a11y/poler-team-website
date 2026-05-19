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
 *
 * Captures every participant header so callers can match CRM contacts that
 * appear anywhere on the email — FROM, TO, CC, BCC, Reply-To, or embedded in
 * a forwarded body. Returns address lists as arrays of {name, email}.
 */
export function parseMessage(msg) {
    const headers = msg.payload?.headers || [];
    const headerMap = {};
    for (const h of headers) headerMap[h.name.toLowerCase()] = h.value;

    const from = parseAddress(headerMap['from'] || '');
    const replyTo = headerMap['reply-to'] ? parseAddress(headerMap['reply-to']) : null;
    const toList = parseAddressList(headerMap['to'] || '');
    const ccList = parseAddressList(headerMap['cc'] || '');
    const bccList = parseAddressList(headerMap['bcc'] || '');
    const deliveredTo = (headerMap['delivered-to'] || '').trim().toLowerCase();
    const rawText = extractPlainText(msg.payload) || msg.snippet || '';
    const plainText = stripSignature(rawText);
    const attachments = extractAttachmentRefs(msg.payload);

    return {
        id: msg.id,
        threadId: msg.threadId,
        labelIds: msg.labelIds || [],
        // Gmail returns internalDate as a string of ms-since-epoch (when Gmail
        // received it). Used by the cron's NEEDS_REVIEW retry-window filter to
        // skip messages younger than 1h or older than 24h. Parse defensively —
        // some test fixtures omit it.
        internalDate: msg.internalDate ? Number(msg.internalDate) : null,
        from,
        fromRaw: headerMap['from'] || '',
        replyTo,
        toList,
        ccList,
        bccList,
        deliveredTo,
        to: headerMap['to'] || '', // kept for backwards compat with any existing callers
        subject: headerMap['subject'] || '',
        date: headerMap['date'] || '',
        snippet: msg.snippet || '',
        plainText: plainText.slice(0, 12000),
        attachments,
    };
}

/**
 * Split a comma-separated address-list header into [{name, email}] entries.
 * Comma-aware: commas inside `<>` or `""` are preserved.
 */
export function parseAddressList(headerVal) {
    if (!headerVal) return [];
    const out = [];
    let depth = 0;       // < > depth
    let inQuote = false; // inside "..."
    let cur = '';
    for (let i = 0; i < headerVal.length; i++) {
        const ch = headerVal[i];
        if (ch === '"' && headerVal[i - 1] !== '\\') inQuote = !inQuote;
        else if (!inQuote && ch === '<') depth++;
        else if (!inQuote && ch === '>') depth--;
        if (ch === ',' && depth === 0 && !inQuote) {
            const parsed = parseAddress(cur.trim());
            if (parsed.email) out.push(parsed);
            cur = '';
        } else {
            cur += ch;
        }
    }
    if (cur.trim()) {
        const parsed = parseAddress(cur.trim());
        if (parsed.email) out.push(parsed);
    }
    return out;
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
/**
 * Scan a forwarded body for addresses appearing on From/To/Cc/Bcc/Reply-To
 * lines. Returns ALL externals (not just first) with role tags so the caller
 * can preserve who-was-where context when matching against CRM.
 *
 * Backwards-compat: when called with only one arg or without role-extraction
 * needs, the returned objects still flatten via `.email` on each entry.
 *
 * @returns Array<{ email: string, role: 'from'|'to'|'cc'|'bcc'|'reply-to' }>
 */
export function parseForwardedSenders(plainText, internalDomains = []) {
    if (!plainText) return [];
    const found = [];
    const seen = new Set();

    const re = /(?:^|\n)\s*(?:>+\s*)?(From|To|Cc|Bcc|Reply-To):\s*([^\n]+)/gi;
    let m;
    while ((m = re.exec(plainText)) !== null) {
        const role = m[1].toLowerCase(); // 'from' | 'to' | 'cc' | 'bcc' | 'reply-to'
        const line = m[2];
        const emailRe = /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;
        let em;
        while ((em = emailRe.exec(line)) !== null) {
            const e = em[1].toLowerCase();
            if (seen.has(e)) continue;
            seen.add(e);
            const domain = e.split('@')[1] || '';
            const isInternal = internalDomains.some(d => domain === d || domain.endsWith('.' + d));
            if (!isInternal) found.push({ email: e, role });
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

/**
 * Remove a label from a message. Used by the ?reprocess=needs_review mode of
 * the cron to clear CRM_NEEDS_REVIEW before re-running normal processing.
 */
export async function removeLabel(messageId, labelName, accessToken) {
    const labelId = await ensureLabel(labelName, accessToken);
    const res = await fetch(`${GMAIL_BASE}/messages/${messageId}/modify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeLabelIds: [labelId] }),
    });
    if (!res.ok) throw new Error(`removeLabel failed: ${res.status} ${await res.text()}`);
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

/**
 * Strip email signatures + mobile/disclaimer footers before passing the body
 * to Sonnet. Keeps name/title/company sig blocks because they're useful CRM
 * context; removes the standard `-- ` separator, mobile "Sent from" lines,
 * and long legal disclaimers ("confidential" + "intended recipient").
 *
 * Conservative — if we're not sure, we leave content in. Better to keep a
 * little noise than to amputate a real client paragraph.
 */
export function stripSignature(text) {
    if (!text) return '';
    let s = text;

    // 1) RFC 3676 standard separator: a line that's exactly "-- " (dash dash space).
    //    Everything after is the signature. Cut it.
    const sepIdx = s.search(/(^|\n)-- ?\n/);
    if (sepIdx >= 0) s = s.slice(0, sepIdx);

    // 2) Common mobile-mailer footers (last line / last few lines only — don't
    //    accidentally strip the body if these words appear mid-content).
    const mobilePatterns = [
        /\n+\s*Sent from my (iPhone|Android|Galaxy|iPad|mobile device|BlackBerry)[^\n]*$/i,
        /\n+\s*Get Outlook for (iOS|Android)[^\n]*$/i,
        /\n+\s*Enviado desde mi (iPhone|Android|Galaxy|iPad|móvil|celular)[^\n]*$/i,
    ];
    for (const re of mobilePatterns) {
        s = s.replace(re, '');
    }

    // 3) Long legal disclaimer blocks. Heuristic: lines containing "confidential"
    //    AND "intended recipient" usually start a disclaimer. Strip from there.
    const disclaimerStart = s.search(/(?:^|\n)[^\n]{0,200}confidential[^\n]*intended recipient/i);
    if (disclaimerStart > 0) s = s.slice(0, disclaimerStart);
    const disclaimerStart2 = s.search(/(?:^|\n)[^\n]{0,200}intended recipient[^\n]*confidential/i);
    if (disclaimerStart2 > 0) s = s.slice(0, disclaimerStart2);

    // 4) "Unsubscribe" / "manage preferences" footers — these are mass-mail
    //    signals that escaped earlier filters. Cut from the line that has them.
    const unsubIdx = s.search(/(?:^|\n)[^\n]*unsubscribe[^\n]*$/im);
    if (unsubIdx > 0 && unsubIdx > s.length * 0.5) s = s.slice(0, unsubIdx);

    return s.trimEnd();
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
