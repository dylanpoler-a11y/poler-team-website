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
export const OUTBOUND_TYPES = new Set(['Email Sent', 'Call', 'Meeting', 'WhatsApp', 'SMS', 'Note']);   // Note = a HUMAN note (Kevin/Rosa/Flash real call) counts as "we acted"
export const NO_ANSWER_RE   = /no atendi|no contest|buz[oó]n|voicemail|voice mail|no answer|missed|left a (voice)?message|dej[eé] mensaje|no contiene conversaci|sin conversaci|colg[oó]|hung up|se cort[oó]|dropped|sin audio|test call|no fue posible conversar/i;
export const WAITING_ON_RE  = /^Waiting on:\s*(.+)$/m;
export const INBOUND_TYPES  = new Set(['Reply', 'Positive Reply']);
// A courtesy close is not a message that needs an answer (Kevin 2026-09-20, Joel: "thank you." after
// the keep-warm email showed as "needs my reply"). Short inbound bodies made only of a closer, and
// any "Not Now" reply, leave the ball on THEIR side as "waiting", never "needs_reply".
export const CLOSER_RE = /^(?:re:\s*)?(?:ok(?:ay)?|k|thanks?(?: you)?(?: so much| a lot| kevin)?|thank you kevin|ty|got it|sounds good|perfect|great|noted|will do|understood|cheers|no problem|np|you too|same to you|gracias(?: kevin)?|muchas gracias|perfecto|listo|de acuerdo|vale|ok gracias|entendido|recibido|igualmente|dale)[.!\s]*$/i;
export function isCourtesyClose(title = '', details = '') {
    if (/^not now reply/i.test(title)) return true;
    const body = String(details || '').split(/\n\[mid:/)[0].split(/\n(?:on .* wrote:|el .* escribi)/i)[0].replace(/\s+/g, ' ').trim();
    return body.length <= 40 && CLOSER_RE.test(body);
}
export const BOT_AGENTS     = /\b(responder bot|thread sync|sammy|claudia|site|import|railway|summary)\b/i;   // 'summary' = the auto convo notes (never our last word)
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
        for (const f of ['At', 'Type', 'Lead', 'Agent', 'Title', 'Details']) params.append('fields[]', f);
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
    const lastIn = new Map(), lastOut = new Map(), lastOutTitle = new Map();
    for (const r of activityRecords || []) {
        const f = r.fields || {};
        const t = f['Type'];
        const at = Date.parse(f['At'] || r.createdTime || '');
        if (!at || at > now.getTime() + 60_000) continue;   // a Meeting booked for next week is not "our last word"
        
        const inbound  = INBOUND_TYPES.has(t);
        // "thank you." / "ok" / a Not Now reply = their close, not their question: it does not take our turn
        // and does not put the ball on Kevin. Recorded as an inbound that counts like our last word.
        const closer   = inbound && isCourtesyClose(f['Title'], f['Details']);
        // A no-answer / hang-up note (Flash) is an attempt, not contact — it does not take our turn.
        const attemptOnly = t === 'Note' && NO_ANSWER_RE.test(`${f['Title'] || ''} ${(f['Details'] || '').slice(0, 300)}`);
        const outbound = OUTBOUND_TYPES.has(t) && !BOT_AGENTS.test(f['Agent'] || '') && !attemptOnly;
        if (!inbound && !outbound) continue;
        for (const id of f['Lead'] || []) {
            const m = (inbound && !closer) ? lastIn : lastOut;
            if (!m.has(id) || at > m.get(id)) { m.set(id, at); if (outbound || closer) lastOutTitle.set(id, closer ? `They closed: ${(f['Details'] || '').split('\n')[0].slice(0, 60)}` : (f['Title'] || '')); }
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
        // One line of "what we are waiting on" (Kevin 2026-09-20): the Sonnet-written `Waiting on:` line
        // in Summary (refreshed by log-leadgen-activity on every human send), else the summary's Next:,
        // else the title of our last outbound row.
        const wo = WAITING_ON_RE.exec(l.summary || '');
        const nx = /^Next:\s*(.+)$/m.exec(l.summary || '');
        l.waitingOn = (wo && wo[1].trim()) || (nx && nx[1].trim()) || (lastOutTitle.get(l.id) || '').replace(/^Email sent:\s*/i, 'Sent: ') || '';
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

// ── LeadGen Tasks helpers (2026-09-20) ────────────────────────────────────────
export const TASK_TYPES = ['Call', 'Email', 'Meeting', 'Follow-up', 'Other'];
export function etDay(iso) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
/** Hour of day in ET + weekday index for an instant. */
function etParts(d) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false, weekday: 'short' }).formatToParts(d);
    const hour = Number(f.find(p => p.type === 'hour')?.value || 0) % 24;
    const wd = f.find(p => p.type === 'weekday')?.value || 'Mon';
    return { hour, weekend: wd === 'Sat' || wd === 'Sun' };
}
/**
 * When should Kevin answer a positive reply? Kevin 2026-09-20: "a reminder to reply set up
 * immediately." Reply lands on a weekday before 3 PM ET → due 3 h later (same day); otherwise
 * the next weekday at 10:00 AM ET.
 */
export function replyDueAt(replyIso, now = new Date()) {
    const base = new Date(Math.max(Date.parse(replyIso || '') || 0, now.getTime()));
    const { hour, weekend } = etParts(base);
    if (!weekend && hour >= 7 && hour < 15) return new Date(base.getTime() + 3 * 3_600_000).toISOString();
    // next weekday 10:00 AM ET: walk day by day from the ET calendar day of `base`
    let d = new Date(base.getTime());
    for (let i = 0; i < 4; i++) {
        d = new Date(d.getTime() + 86_400_000);
        if (!etParts(d).weekend) break;
    }
    const day = etDay(d.toISOString());
    // 10:00 ET is 14:00Z in EDT, 15:00Z in EST; pick by testing which one renders as 10 in ET
    for (const hh of ['14', '15']) {
        const cand = new Date(`${day}T${hh}:00:00Z`);
        if (etParts(cand).hour === 10) return cand.toISOString();
    }
    return new Date(`${day}T14:00:00Z`).toISOString();
}
export async function createTask({ leadId, title, type = 'Follow-up', dueAt, owner = 'Kevin', notes = '' }) {
    const fields = { 'Title': title, 'Type': TASK_TYPES.includes(type) ? type : 'Follow-up', 'Status': 'Open', 'Owner': owner };
    if (dueAt && !isNaN(Date.parse(dueAt))) { fields['Due'] = new Date(dueAt).toISOString(); fields['Due At'] = etDay(dueAt); }
    if (notes) fields['Notes'] = String(notes).slice(0, 5000);
    if (leadId) fields['Lead'] = [leadId];
    return createRecord(TABLES.tasks, fields);
}
/** Open tasks for one lead (client-side filter: linked-record formulas are unreliable). */
export async function openTasksFor(leadId) {
    const res = await listAll(TABLES.tasks, { filter: `{Status} = 'Open'`, maxPages: 20 });
    if (!res.ok) return [];
    return res.records.filter(r => (r.fields?.['Lead'] || []).includes(leadId)).map(mapTask);
}
/** Kevin answered → close the "Reply to …" reminder(s) for that lead (Kevin 2026-09-20). */
export async function closeReplyTasks(leadId) {
    const open = await openTasksFor(leadId);
    let n = 0;
    for (const t of open) if (/^Reply to\b/i.test(t.title || '')) { const r = await updateRecord(TABLES.tasks, t.id, { 'Status': 'Done' }); if (r.ok) n++; }
    return n;
}
/**
 * Rewrite the `Waiting on:` line of a lead's Summary from the last few activity rows (Sonnet).
 * Called after a human outbound row lands. Never throws; returns the line or ''.
 */
export async function refreshWaitingOn(leadId) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return '';
    try {
        const lead = await listAll(TABLES.leads, { filter: `RECORD_ID() = '${esc(leadId)}'` });
        const rec = lead.ok && lead.records[0];
        if (!rec) return '';
        const acts = await listAll(TABLES.activity, { filter: `FIND('${esc(leadId)}', ARRAYJOIN({Lead Record ID}))`, sortField: 'At', sortDir: 'desc', maxPages: 1 });
        const rows = (acts.ok ? acts.records : []).slice(0, 8).reverse().map(r => {
            const f = r.fields || {};
            return `[${(f['At'] || '').slice(0, 16)}] ${f['Type']} by ${f['Agent'] || '?'}: ${f['Title'] || ''}\n${String(f['Details'] || '').replace(/\n+/g, ' ').slice(0, 500)}`;
        }).join('\n\n');
        const summary = String(rec.fields?.['Summary'] || '').replace(WAITING_ON_RE, '').trim();
        const prompt = [
            `Kevin Poler (real-estate broker / outreach) is tracking a lead: ${rec.fields?.['Name'] || '?'}${rec.fields?.['Company'] ? ' at ' + rec.fields['Company'] : ''} (status ${rec.fields?.['Status'] || 'New'}).`,
            summary ? `Conversation summary:\n"""${summary.slice(0, 1200)}"""` : '',
            `Most recent activity, oldest first:\n"""${rows.slice(0, 5000)}"""`,
            '',
            'In ONE line (max 140 characters, plain text, no quotes, no leading label), say exactly what Kevin is waiting on from this lead right now',
            'and what was agreed, e.g. "Told him Keystone closed; coffee when he is back in Miami" or "Sent the recap after the 9/9 call; he picks a time to start".',
            'If Kevin owes the reply instead, start with "Kevin owes:".',
        ].filter(Boolean).join('\n');
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 120, messages: [{ role: 'user', content: prompt }] }),
        });
        if (!res.ok) return '';
        const data = await res.json();
        const line = (data.content || []).map(c => c.text || '').join('').split('\n')[0].replace(/^waiting on:\s*/i, '').trim().slice(0, 160);
        if (!line) return '';
        const next = (summary ? summary + '\n' : '') + 'Waiting on: ' + line;
        await updateRecord(TABLES.leads, leadId, { 'Summary': next });
        return line;
    } catch { return ''; }
}

// ── Conversation notes + one reminder per lead (Kevin 2026-09-20) ─────────────────────────
// "Every communication we have, there should be a summary of the communication with the same
//  rules as the real-estate lead: bulleted, with next-step recommendations. And every lead needs
//  a reminder." One Note row per communication (Convo: / Next:, the crm-note-format shape), written
// by Sonnet from that row + the thread so far; the same pass rewrites the `Waiting on:` line and
// makes sure the lead has ONE open reminder (queued cadence touches do not count).
export const CONVO_NOTE_AGENT = 'Summary';
export const QUEUED_TASK_RE = /^Queued touch\b/i;
export const NOTE_TYPES = new Set(['Email Sent', 'Reply', 'Positive Reply', 'Call', 'Meeting', 'WhatsApp', 'SMS']);
const BULLET = '•';
function etIsoFromLocal(str) {
    // "2026-09-23 10:00" (ET) → ISO. Tries EDT then EST and keeps the one that renders at that hour in ET.
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(String(str || '').trim());
    if (!m) return '';
    for (const off of ['-04:00', '-05:00']) {
        const d = new Date(`${m[1]}T${m[2]}:${m[3]}:00${off}`);
        const h = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(d);
        if (Number(h) % 24 === Number(m[2])) return d.toISOString();
    }
    return new Date(`${m[1]}T${m[2]}:${m[3]}:00-04:00`).toISOString();
}
/** Default reminder when the model gives none: next weekday 10:00 AM ET, `days` business days out. */
function defaultDue(days = 2, now = new Date()) {
    let d = new Date(now.getTime());
    let left = days;
    while (left > 0) { d = new Date(d.getTime() + 86_400_000); if (!etParts(d).weekend) left--; }
    return etIsoFromLocal(`${etDay(d.toISOString())} 10:00`);
}
/**
 * Write the conversation note for one activity row (or, with no focus row, a catch-up note for the
 * whole thread), refresh `Waiting on:`, and ensure one open reminder. Never throws.
 * Returns { note, waitingOn, reminder } (fields present when written).
 */
export async function writeConvoNote(leadId, { focusActivityId = '', catchUp = false } = {}) {
    const out = {};
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || !leadId) return out;
    try {
        const lead = await listAll(TABLES.leads, { filter: `RECORD_ID() = '${esc(leadId)}'` });
        const rec = lead.ok && lead.records[0];
        if (!rec) return out;
        const lf = rec.fields || {};
        const acts = await listAll(TABLES.activity, { filter: `FIND('${esc(leadId)}', ARRAYJOIN({Lead Record ID}))`, sortField: 'At', sortDir: 'desc', maxPages: 1 });
        const all = (acts.ok ? acts.records : []);
        const comms = all.filter(r => NOTE_TYPES.has(r.fields?.['Type']));
        if (!comms.length) return out;
        const focus = focusActivityId ? all.find(r => r.id === focusActivityId) : comms[0];
        const fmt = r => { const f = r.fields || {}; return `[${(f['At'] || '').slice(0, 16)}Z] ${f['Type']} by ${f['Agent'] || '?'}${f['Subject'] ? ' · ' + f['Subject'] : ''}: ${f['Title'] || ''}\n${String(f['Details'] || '').replace(/\n+/g, ' ').slice(0, 700)}`; };
        const history = comms.slice(0, 12).reverse().map(fmt).join('\n\n');
        const openTasks = (await openTasksFor(leadId)).filter(t => !QUEUED_TASK_RE.test(t.title || ''));
        const queued = (await openTasksFor(leadId)).filter(t => QUEUED_TASK_RE.test(t.title || '')).map(t => `${t.title} (due ${(t.dueAt || '').slice(0, 10)})`);
        const summary = String(lf['Summary'] || '').replace(WAITING_ON_RE, '').trim();
        // Language = what the LEAD wrote (deterministic, the model kept picking Spanish for English leads)
        const theirText = comms.filter(r => /reply/i.test(r.fields?.['Type'] || '')).map(r => String(r.fields?.['Details'] || '')).join(' ').toLowerCase()
            || String(lf['First Reply'] || '').toLowerCase() || comms.map(r => String(r.fields?.['Details'] || '')).join(' ').toLowerCase();
        const esHits = (theirText.match(/\b(el|la|de|que|para|con|por|gracias|hola|buenos|puedes|podemos|estoy|semana|llamada|interesa)\b/g) || []).length;
        const enHits = (theirText.match(/\b(the|and|you|call|thanks|happy|works|for|with|please|me|let)\b/g) || []).length;
        const lang = esHits > enHits ? 'es' : 'en';
        const nowEt = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
        const prompt = [
            `You write CRM notes for Kevin Poler (real-estate broker in Miami who also sells outreach / ads / website services). Now: ${nowEt} ET.`,
            `Lead: ${lf['Name'] || '?'}${lf['Company'] ? ' at ' + lf['Company'] : ''} · status ${lf['Status'] || 'New'} · sentiment ${lf['Sentiment'] || '?'} · campaign ${lf['Campaign'] || '?'}.`,
            summary ? `Running summary so far:\n"""${summary.slice(0, 1200)}"""` : '',
            `Communications, oldest first (the last one is the newest):\n"""${history.slice(0, 9000)}"""`,
            focus && !catchUp ? `THE COMMUNICATION TO SUMMARIZE (write the note about THIS one, using the rest only as context):\n"""${fmt(focus).slice(0, 2500)}"""` : 'Write ONE catch-up note covering the whole conversation so far.',
            openTasks.length ? `Open reminders already on this lead: ${openTasks.map(t => `${t.title} (due ${(t.dueAt || '').slice(0, 16)})`).join('; ')}` : 'No open reminder on this lead.',
            queued.length ? `Automated follow-up emails already queued: ${queued.join('; ')}` : '',
            '',
            'Return ONLY a JSON object, no prose, with:',
            ' "convo": 1 to 4 short bullets (strings, no bullet characters) summarizing the substance: what we sent / what they said, a brief key quote if useful. Never "sent an email"; say what it was about. Never paste the message.',
            ' "next": 1 to 3 short bullets with the concrete recommended next actions for Kevin (who does what, by when).',
            ' "waiting_on": one line, max 140 chars, what Kevin is waiting on from this lead and what was agreed; start with "Kevin owes:" if the next move is his.',
            ' "reminder": null if an open reminder already covers the next step, else {"type": one of Call|Email|Meeting|Follow-up, "due": "YYYY-MM-DD HH:MM" in ET on a weekday between 09:00 and 18:00, "title": short imperative, e.g. "Call Edy re pricing PDF"}. If a follow-up email is already queued for that step, prefer a Call reminder 1 business day after the last queued touch, or the concrete date the lead gave. Live conversation (contact in the last 10 days) → 1 to 3 business days out. Lead said not now / went silent for weeks → 3 to 5 weeks out, titled as a check-in. Never in the past.',
            lang === 'es' ? 'ESCRIBE TODOS LOS BULLETS Y EL TITULO DEL REMINDER EN ESPAÑOL (tú, nunca usted). Números como cifras. Sin rayas largas.' : 'WRITE EVERY BULLET AND THE REMINDER TITLE IN ENGLISH (the lead writes in English). Numbers as numerals. No em dashes.',
            'Keep it tight: each bullet under 22 words, at most 4 convo bullets and 2 next bullets. Do not wrap the JSON in code fences.',
        ].filter(Boolean).join('\n');
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 1600, messages: [{ role: 'user', content: prompt }] }),
        });
        if (!res.ok) { out.error = `anthropic ${res.status}`; return out; }
        const data = await res.json();
        const text = (data.content || []).map(c => c.text || '').join('');
        const jm = /\{[\s\S]*\}/.exec(text);
        if (!jm) { out.error = 'no json: ' + text.slice(0, 200); return out; }
        let j; try { j = JSON.parse(jm[0]); } catch { out.error = 'bad json: ' + jm[0].slice(-200); return out; }
        const convo = (Array.isArray(j.convo) ? j.convo : []).map(x => String(x).trim()).filter(Boolean).slice(0, 4);
        const next  = (Array.isArray(j.next)  ? j.next  : []).map(x => String(x).trim()).filter(Boolean).slice(0, 3);
        if (convo.length) {
            const body = `Convo:\n${convo.map(b => `${BULLET} ${b}`).join('\n')}\nNext:\n${(next.length ? next : ['Esperar respuesta.']).map(b => `${BULLET} ${b}`).join('\n')}`;
            const ff = focus?.fields || {};
            const chan = ({ 'Email Sent': 'email', 'Reply': 'reply', 'Positive Reply': 'reply', 'Call': 'call', 'Meeting': 'meeting', 'WhatsApp': 'WhatsApp', 'SMS': 'SMS' })[ff['Type']] || 'thread';
            const noteAt = catchUp ? new Date().toISOString() : (ff['At'] || new Date().toISOString());
            const cr = await createRecord(TABLES.activity, {
                'Title': `${catchUp ? 'Catch-up' : 'Note'} · ${chan}`, 'Type': 'Note', 'Lead': [leadId],
                'Details': body, 'Agent': `${CONVO_NOTE_AGENT} (${chan})`, 'At': noteAt,
            });
            if (cr.ok) out.note = body;
        }
        const line = String(j.waiting_on || '').split('\n')[0].replace(/^waiting on:\s*/i, '').trim().slice(0, 160);
        if (line) { await updateRecord(TABLES.leads, leadId, { 'Summary': (summary ? summary + '\n' : '') + 'Waiting on: ' + line }); out.waitingOn = line; }
        if (!openTasks.length && !['Prospect', 'Lost', 'Won'].includes(lf['Status'] || '')) {
            const r = j.reminder && typeof j.reminder === 'object' ? j.reminder : null;
            const dueAt = etIsoFromLocal(r?.due) || defaultDue(2);
            const title = String(r?.title || `Follow up with ${lf['Name'] || 'lead'}`).slice(0, 120);
            const type = TASK_TYPES.includes(r?.type) ? r.type : 'Follow-up';
            const t = await createTask({ leadId, title, type, dueAt, notes: next.join('\n') });
            if (t.ok) out.reminder = { title, type, dueAt };
        }
    } catch (e) { out.error = String(e?.message || e).slice(0, 200); }
    return out;
}
