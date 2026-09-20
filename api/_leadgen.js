/**
 * /api/_leadgen.js — shared helpers for the CRM "Lead Generation" module.
 *
 * Lead Generation holds every outbound prospect who REPLIED to outreach — any
 * sentiment except auto-replies/OOO/bounces (Kevin 2026-09-10). Sources: the
 * Railway cloud-sender (all cold-email campaigns incl. Keystone/Abrams; the
 * earlier rows predating Sept 2026 are backfilled under the same `Email` channel),
 * Facebook DMs, LinkedIn DMs, the LoopNet responder. Consulting-client outreach
 * (Plaza San Miguel / Atrio, Mara & CSC) is routed to the Consulting module by
 * api/agent/leadgen-reply.js instead — see CONSULTING_CAMPAIGNS there.
 * It is deliberately SEPARATE from the real-estate `Leads` table: that one is the
 * brokerage pipeline and Sammy's WhatsApp drip targets it. Never cross-write.
 *
 * Airtable table ids (base appJhWtGCXGgAuS0r), created 2026-07-25:
 *   LeadGen Leads    tblK1nzerZMMUajCF
 *   LeadGen Tasks    tblyxcTO2x4h5vrwS
 *   LeadGen Activity tbl5yTjB0NTS8JugA
 *
 * Mirrors the consulting module's conventions: Vercel Edge runtime, shared
 * ./_auth.js (Bearer AGENT_API_TOKEN for agents, CRM_PASSWORD for the web UI).
 */

export const TABLES = {
    leads:    'LeadGen%20Leads',
    tasks:    'LeadGen%20Tasks',
    activity: 'LeadGen%20Activity',
};

export function creds() {
    return {
        apiKey: process.env.AIRTABLE_API_KEY,
        baseId: process.env.AIRTABLE_BASE_ID,
    };
}

export function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
    });
}

export function preflight(methods) {
    return new Response(null, {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': `${methods}, OPTIONS`,
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
    });
}

async function at(path, init = {}) {
    const { apiKey, baseId } = creds();
    const res = await fetch(`https://api.airtable.com/v0/${baseId}/${path}`, {
        ...init,
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...(init.headers || {}),
        },
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
}

/** Fetch every record from a table (bounded at maxPages × 100 rows; default 10 pages / 1000 rows). */
export async function listAll(table, { sortField, sortDir = 'desc', filter, maxPages = 10 } = {}) {
    let out = [];
    let offset = null;

    for (let page = 0; page < maxPages; page++) {
        const params = new URLSearchParams({ pageSize: '100' });
        if (sortField) {
            params.set('sort[0][field]', sortField);
            params.set('sort[0][direction]', sortDir);
        }
        if (filter) params.set('filterByFormula', filter);
        if (offset) params.set('offset', offset);

        const { ok, status, body } = await at(`${table}?${params}`);
        if (!ok) return { ok: false, status, error: body.error?.message || 'Airtable fetch failed' };

        out = out.concat(body.records || []);
        if (!body.offset) break;
        offset = body.offset;
    }
    return { ok: true, records: out };
}

export async function createRecord(table, fields) {
    const { ok, status, body } = await at(table, {
        method: 'POST',
        body: JSON.stringify({ fields, typecast: true }),
    });
    return ok
        ? { ok: true, record: body }
        : { ok: false, status, error: body.error?.message || 'Airtable create failed' };
}

export async function updateRecord(table, id, fields) {
    const { ok, status, body } = await at(`${table}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields, typecast: true }),
    });
    return ok
        ? { ok: true, record: body }
        : { ok: false, status, error: body.error?.message || 'Airtable update failed' };
}

/** Escape a value for safe interpolation into a filterByFormula string literal. */
export function esc(v) {
    return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Find an existing lead by Source Lead ID first, then Email.
 * This is what makes the responders' writes idempotent — a re-run or a second
 * positive reply from the same person updates the row instead of duplicating it.
 */
export async function findLead({ sourceLeadId, email }) {
    const clauses = [];
    if (sourceLeadId) clauses.push(`{Source Lead ID} = '${esc(sourceLeadId)}'`);
    if (email)        clauses.push(`LOWER({Email}) = '${esc(String(email).toLowerCase())}'`);
    if (!clauses.length) return { ok: true, record: null };

    const filter = clauses.length > 1 ? `OR(${clauses.join(',')})` : clauses[0];
    const res = await listAll(TABLES.leads, { filter });
    if (!res.ok) return res;

    // Prefer an exact Source Lead ID hit over an email-only match.
    const byId = sourceLeadId
        ? res.records.find(r => (r.fields['Source Lead ID'] || '') === sourceLeadId)
        : null;
    return { ok: true, record: byId || res.records[0] || null };
}

/** Shape an Airtable lead record for the CRM UI / MCP consumers. */
export function mapLead(r) {
    const f = r.fields || {};
    return {
        id:            r.id,
        name:          f['Name']            || '',
        email:         f['Email']           || '',
        company:       f['Company']         || '',
        title:         f['Title']           || '',
        phone:         f['Phone']           || '',
        contactedFrom: f['Contacted From']   || '',
        channel:       f['Channel']         || '',
        campaign:      f['Campaign']        || '',
        status:        f['Status']          || 'New',
        replySnippet:  f['Reply Snippet']   || '',
        replyAt:       f['Reply At']        || '',
        sentiment:     f['Sentiment']       || '',
        firstReply:    f['First Reply']     || '',
        summary:       f['Summary']         || '',
        lastReplyAt:   f['Last Reply At']   || f['Reply At'] || '',
        replyCount:    Number(f['Reply Count'] || 0),
        owner:         f['Owner']           || '',
        sourceLeadId:  f['Source Lead ID']  || '',
        website:       f['Website']         || '',
        notes:         f['Notes']           || '',
        createdAt:     f['Created At']      || r.createdTime || '',
        lastContact:   f['Last Contact']    || '',
        taskIds:       f['LeadGen Tasks']    || [],
        activityIds:   f['LeadGen Activity'] || [],
    };
}

export function mapTask(r) {
    const f = r.fields || {};
    return {
        id:     r.id,
        title:  f['Title']  || '',
        type:   f['Type']   || '',
        // `Due` (dateTime, 2026-09-10) carries the time; `Due At` (date) is the legacy field.
        dueAt:  f['Due'] || f['Due At'] || '',
        status: f['Status'] || 'Open',
        owner:  f['Owner']  || '',
        leadIds: f['Lead']  || [],
        notes:  f['Notes']  || '',
    };
}

export function mapActivity(r) {
    const f = r.fields || {};
    return {
        id:      r.id,
        title:   f['Title']   || '',
        type:    f['Type']    || '',
        leadIds: f['Lead']    || [],
        details: f['Details'] || '',
        agent:   f['Agent']   || '',
        at:      f['At']      || r.createdTime || '',
        // Email thread sync (2026-09-10): full emails live here — subject, our mailbox,
        // the RFC Message-ID (idempotency key) and any files that travelled with it.
        subject:     f['Subject']    || '',
        mailbox:     f['Mailbox']    || '',
        messageId:   f['Message ID'] || '',
        attachments: (f['Attachments'] || []).map(a => ({
            id: a.id, filename: a.filename, url: a.url, size: a.size || 0, type: a.type || '',
        })),
    };
}

/**
 * Upload one file onto an attachment field of an existing record via Airtable's
 * content endpoint (base64 in, ≤5 MB per file). Same call the email cron uses.
 */
export async function uploadAttachment(recordId, field, { filename, contentType, base64 }) {
    const { apiKey, baseId } = creds();
    const res = await fetch(`https://content.airtable.com/v0/${baseId}/${recordId}/${encodeURIComponent(field)}/uploadAttachment`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: contentType || 'application/octet-stream', file: base64, filename }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { ok: false, status: res.status, error: err.error?.message || `upload ${res.status}` };
    }
    return { ok: true };
}

/** Best-effort activity row. Never let a logging failure break the caller. */
export async function logActivity({ title, type, leadId, details, agent = 'Responder Bot', at }) {
    try {
        return await createRecord(TABLES.activity, {
            'Title':   title,
            'Type':    type,
            'Lead':    leadId ? [leadId] : undefined,
            'Details': details || '',
            'Agent':   agent,
            'At':      at || new Date().toISOString(),
        });
    } catch (e) {
        return { ok: false, error: String(e) };
    }
}

// 'Prospect' (2026-09-20) = a row that has NOT replied (LoopNet visitor companies, sourced
// contacts). It sits BELOW New so the upgrade-only ladders promote it to New on the first
// real reply, and the Inbox / "Untouched" counts ignore it.
export const STATUSES   = ['Prospect', 'New', 'Contacted', 'Meeting Booked', 'Won', 'Lost'];
// 'Email' covers all cold-email outreach, past and present, sent through the Railway cloud sender.
export const CHANNELS   = ['Email', 'Facebook', 'LinkedIn', 'WhatsApp', 'LoopNet', 'Manual'];
export const SENTIMENTS = ['Positive', 'Question', 'Neutral', 'Not Now', 'Negative'];

// ---------------------------------------------------------------------------
// Ball / Inbox (Kevin 2026-09-20: "I'm very confused as to who I've sent emails to,
// who I'm waiting a reply on, who are my hottest leads"). Status says how far a lead
// got; BALL says whose turn it is. It is DERIVED from the activity log on every read
// (no Airtable field — the prod PAT has no schema scope), so nothing has to be kept
// by hand: thread_sync (10 min), the cadence runner, the post-send hook and the CRM
// all write activity rows and the Inbox follows.
// ---------------------------------------------------------------------------
export const OUTBOUND_TYPES = new Set(['Email Sent', 'Call', 'Meeting']);
export const INBOUND_TYPES  = new Set(['Reply', 'Positive Reply']);
export const BOT_AGENTS     = /\b(responder bot|thread sync|sammy|claudia|site|import|railway)\b/i;
export const INBOX_STALE_DAYS = 14;
/** Statuses that never appear in the Inbox lists. */
export const INBOX_EXCLUDED = new Set(['Prospect', 'Lost', 'Won']);

/**
 * Pull the activity rows the Inbox needs — only At / Type / Lead / Agent, newest first,
 * outbound + inbound types only. Own pager (the generic listAll caps at 1,000 rows and
 * the activity table is already at ~980).
 */
export async function listActivityLite({ maxPages = 40 } = {}) {
    const types = [...OUTBOUND_TYPES, ...INBOUND_TYPES].map(t => `{Type} = '${esc(t)}'`).join(',');
    let out = [];
    let offset = null;
    for (let page = 0; page < maxPages; page++) {
        const params = new URLSearchParams({ pageSize: '100', filterByFormula: `OR(${types})` });
        params.set('sort[0][field]', 'At');
        params.set('sort[0][direction]', 'desc');
        for (const f of ['At', 'Type', 'Lead', 'Agent']) params.append('fields[]', f);
        if (offset) params.set('offset', offset);
        const { ok, status, body } = await at(`${TABLES.activity}?${params}`);
        if (!ok) return { ok: false, status, error: body.error?.message || 'Airtable fetch failed' };
        out = out.concat(body.records || []);
        if (!body.offset) break;
        offset = body.offset;
    }
    return { ok: true, records: out };
}

/**
 * Attach ball / waitingDays / hot to each mapped lead, and return the three Inbox lists
 * (actionable = traffic within INBOX_STALE_DAYS; older ones are only counted).
 *   ball: 'needs_reply' (their message is the last word) | 'waiting' (our message is the
 *         last word) | 'none' (no traffic on record). stale=true when the last traffic is
 *         older than INBOX_STALE_DAYS.
 * Fallbacks when a lead has no activity rows: Last Reply At counts as inbound, Last
 * Contact (date-only, stamped by Flash/notes) as outbound at end of that day ET.
 */
export function computeInbox(leads, activityRecords, now = new Date()) {
    const lastIn = new Map(), lastOut = new Map();
    for (const r of activityRecords || []) {
        const f = r.fields || {};
        const t = f['Type'];
        const at = Date.parse(f['At'] || r.createdTime || '');
        if (!at || at > now.getTime() + 60_000) continue;   // a Meeting booked for next week is not "our last word"
        
        const inbound  = INBOUND_TYPES.has(t);
        const outbound = OUTBOUND_TYPES.has(t) && !BOT_AGENTS.test(f['Agent'] || '');
        if (!inbound && !outbound) continue;
        for (const id of f['Lead'] || []) {
            const m = inbound ? lastIn : lastOut;
            if (!m.has(id) || at > m.get(id)) m.set(id, at);
        }
    }
    const nowMs = now.getTime();
    const DAY = 86_400_000;
    const inbox = { needsReply: [], waiting: [], hot: [], staleNeedsReply: 0, staleWaiting: 0 };
    for (const l of leads) {
        let inAt  = lastIn.get(l.id)  || 0;
        let outAt = lastOut.get(l.id) || 0;
        const replyFallback = Date.parse(l.lastReplyAt || l.replyAt || '') || 0;
        if (replyFallback > inAt) inAt = replyFallback;
        if (!outAt && l.lastContact) {
            // date-only stamp → 11:59 PM ET that day (ET = UTC-4/-5; use -4, the error is 1 h)
            const d = Date.parse(`${l.lastContact}T23:59:00-04:00`);
            if (d) outAt = d;
        }
        const last = Math.max(inAt, outAt);
        l.lastInAt  = inAt  ? new Date(inAt).toISOString()  : '';
        l.lastOutAt = outAt ? new Date(outAt).toISOString() : '';
        l.ball = !last ? 'none' : (inAt > outAt ? 'needs_reply' : 'waiting');
        l.ballSince = last ? new Date(last).toISOString() : '';
        l.waitingDays = last ? Math.floor((nowMs - last) / DAY) : null;
        l.stale = !!last && (nowMs - last) > INBOX_STALE_DAYS * DAY;
        const status = l.status || 'New';
        const excluded = INBOX_EXCLUDED.has(status);
        l.hot = !excluded && !l.stale && (l.sentiment === 'Positive' || l.sentiment === 'Question' || status === 'Meeting Booked');
        if (excluded) continue;
        // The lists are the ACTIONABLE set: traffic in the last INBOX_STALE_DAYS. Older rows keep
        // their ball chip in the table and are counted here so the UI can say "+N older".
        // A "no thanks" (Negative) never needs a reply — the triage sweep moves those to Lost.
        if (l.ball === 'needs_reply' && l.sentiment !== 'Negative') {
            if (l.stale) inbox.staleNeedsReply++; else inbox.needsReply.push(l.id);
        } else if (l.ball === 'waiting') {
            if (l.stale) inbox.staleWaiting++; else inbox.waiting.push(l.id);
        }
        if (l.hot) inbox.hot.push(l.id);
    }
    const byId = new Map(leads.map(l => [l.id, l]));
    const since = (id) => Date.parse(byId.get(id).ballSince || '') || 0;   // '' → NaN → 0, keeps the sort stable
    const oldestFirst = (a, b) => since(a) - since(b);
    inbox.needsReply.sort(oldestFirst);
    inbox.waiting.sort(oldestFirst);
    inbox.hot.sort((a, b) => since(b) - since(a));
    return inbox;
}

/** Normalize a caller-supplied channel to one of the canonical values. */
export function normChannel(v) {
    const c = String(v || '').trim();
    if (/^(gmail|smtp|railway|email)$/i.test(c)) return 'Email';
    const hit = CHANNELS.find(x => x.toLowerCase() === c.toLowerCase());
    return hit || 'Manual';
}

// ---------------------------------------------------------------------------
// Phone extraction from reply text (signatures) — Kevin 2026-09-10: "usually the
// phone number is in the signature … make sure it gets added for leads moving forward".
// Deterministic on purpose: label-scored regex, our own numbers and quoted mail excluded.
// ---------------------------------------------------------------------------
// Our own lines — never a lead's phone even when a reply quotes our signature.
const OWN_PHONES = new Set([
    '3057997290', '13057997290',   // Kevin cell / WhatsApp
    '7864500711', '17864500711',   // 786 second line
    '9548335106', '19548335106',   // Claudia / Twilio 954
    '9542354046', '19542354046',   // Rosa
]);
const QUOTE_CUT = /^(>|On .{0,120}wrote:|From:|De:|Sent:|Enviado:|-{2,}\s*Original Message|-{2,}\s*Mensaje original|El .{0,120}escribió:)/im;
const PHONE_RE  = /(?<![\w+])(?:\+ ?\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?|\d{2,4}[ .-])\d{3,4}[ .-]?\d{3,4}(?:[ .-]?\d{2,4})?(?: *(?:x|ext\.?|extensi[óo]n|extension) *\d{1,5})?(?!\w)|(?<![\w+])\+?\d{10,13}(?!\w)/gi;
const LABEL_HI  = /(mobile|mobil|cell|celular|m[óo]vil|whatsapp|direct|directo|\bm\s*[:.]|\bc\s*[:.]|\bd\s*[:.])\s*$/i;
const LABEL_MID = /(phone|tel[eé]fono|tel\.?|\bt\s*[:.]|\bp\s*[:.]|\bph\s*[:.]|office|oficina|\bo\s*[:.]|call|ll[áa]mame|contact)\s*$/i;
const LABEL_NO  = /(fax|\bf\s*[:.]|zip|suite|ste\.?|#|mls|lic\.?|license|licencia|nit|rut|ein|acct|account|order|invoice|ref|po box|apt|unit)/i;

/**
 * Best phone number found in a reply body, or ''.
 * Skips quoted/forwarded sections, fax lines, our own numbers, URLs/emails, dollar amounts and dates.
 */
export function extractPhone(text) {
    if (!text) return '';
    let body = String(text);
    const cut = body.search(QUOTE_CUT);
    if (cut > 0) body = body.slice(0, cut);
    // Strip things that look like numbers but aren't phones.
    body = body
        .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
        .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, ' ')
        .replace(/\$\s?[\d,.]+/g, ' ')
        .replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, ' ');

    let best = null;
    for (const m of body.matchAll(PHONE_RE)) {
        const raw = m[0].trim();
        const digits = raw.replace(/\D/g, '');
        if (digits.length < 10 || digits.length > 15) continue;
        if (OWN_PHONES.has(digits)) continue;
        if (/^(\d)\1+$/.test(digits)) continue;                // 0000000000
        const before = body.slice(Math.max(0, m.index - 40), m.index);
        // Only the field this number sits in (after the last separator) decides its label.
        const seg = before.split(/[\n|•·;]/).pop();
        if (LABEL_NO.test(seg.slice(-14))) continue;   // the immediate label only
        let score = 1;
        if (LABEL_HI.test(seg)) score = 3;
        else if (LABEL_MID.test(seg)) score = 2;
        // A number that starts at line start in the signature block is a decent signal too.
        if (score === 1 && /(^|\n)\s*[|•·]?\s*$/.test(before)) score = 1.5;
        if (!best || score > best.score) best = { raw, score };
    }
    return best ? best.raw.replace(/\s+/g, ' ') : '';
}
