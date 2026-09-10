/**
 * /api/_leadgen.js — shared helpers for the CRM "Lead Generation" module.
 *
 * Lead Generation holds every outbound prospect who REPLIED to outreach — any
 * sentiment except auto-replies/OOO/bounces (Kevin 2026-09-10). Sources: the
 * Railway cloud-sender (all cold-email campaigns incl. Keystone/Abrams; the
 * pre-Aug-2026 Instantly era is backfilled under the same `Email` channel),
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

/** Fetch every record from a table (bounded at 10 pages / 1000 rows). */
export async function listAll(table, { sortField, sortDir = 'desc', filter } = {}) {
    let out = [];
    let offset = null;

    for (let page = 0; page < 10; page++) {
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
        dueAt:  f['Due At'] || '',
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
    };
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

export const STATUSES   = ['New', 'Contacted', 'Meeting Booked', 'Won', 'Lost'];
// 'Email' covers both the Railway cloud-sender and the retired Instantly era —
// Kevin 2026-09-10: Instantly must not appear as a label anywhere in the CRM.
export const CHANNELS   = ['Email', 'Facebook', 'LinkedIn', 'WhatsApp', 'LoopNet', 'Manual'];
export const SENTIMENTS = ['Positive', 'Question', 'Neutral', 'Not Now', 'Negative'];

/** Normalize a caller-supplied channel — legacy 'Instantly' → 'Email'. */
export function normChannel(v) {
    const c = String(v || '').trim();
    if (/^instantly$/i.test(c) || /^(gmail|smtp|railway|email)$/i.test(c)) return 'Email';
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
