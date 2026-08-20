/**
 * /api/_leadgen.js — shared helpers for the CRM "Lead Generation" module.
 *
 * Lead Generation holds AGENCY (KPS) outbound prospects who gave a POSITIVE reply
 * — Instantly (all campaigns), Facebook outreach, and the LoopNet responder.
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

export const STATUSES = ['New', 'Contacted', 'Meeting Booked', 'Won', 'Lost'];
export const CHANNELS  = ['Instantly', 'Facebook', 'LoopNet', 'Manual'];
