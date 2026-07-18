/**
 * /api/update-lead.js — Vercel Edge Function
 * Updates a lead's status and/or notes in Airtable.
 *
 * Required Vercel env vars:
 *   AIRTABLE_API_KEY
 *   AIRTABLE_BASE_ID
 *   CRM_PASSWORD
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';
import { sendCapiEvent } from './_capi.js';

// Status → funnel rank, used ONLY to detect an UPWARD transition (advancement, not a
// re-set/downgrade) for the server-side Meta CAPI quality-signal event below.
const STATUS_RANK = { '': 0, New: 0, Contacted: 1, Warm: 2, Hot: 3, Client: 4 };
// rank → Meta event name fired on advancement into that rank.
const STATUS_CAPI_EVENT = { 1: 'Contact', 2: 'QualifiedLead', 3: 'QualifiedLead', 4: 'Purchase' };

export default async function handler(req, context) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'PATCH, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        });
    }

    if (req.method !== 'PATCH') {
        return json({ error: 'Method not allowed' }, 405);
    }

    const apiKey  = process.env.AIRTABLE_API_KEY;
    const baseId  = process.env.AIRTABLE_BASE_ID;
    const crmPass = process.env.CRM_PASSWORD;

    if (!apiKey || !baseId) {
        return json({ error: 'Airtable not configured' }, 500);
    }

    let body;
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Invalid request body' }, 400);
    }

    const { id, status, notes, assignedTo, firstName, lastName, email, phone, password } = body;

    if (!authorize(req, body).ok) {
        return json({ error: 'Unauthorized' }, 401);
    }

    if (!id) {
        return json({ error: 'Record ID required' }, 400);
    }

    const fields = {};
    if (status     !== undefined) fields['Status']      = status;
    if (notes      !== undefined) fields['Notes']       = notes;
    if (assignedTo !== undefined) fields['Assigned To'] = assignedTo;
    if (firstName  !== undefined) fields['First Name']  = firstName;
    if (lastName   !== undefined) fields['Last Name']   = lastName;
    if (email      !== undefined) fields['Email']       = email;
    if (phone      !== undefined) fields['Phone']       = phone;

    // Fetch the CURRENT record before applying any update whenever we need to read
    // something from prior state: the OTHER name component (existing behavior), or the
    // prior Status (new — to detect an upward transition for the CAPI event below).
    // Wrapped so a fetch failure just skips those two dependent features, never the update.
    let cur = null;
    if (firstName !== undefined || lastName !== undefined || status !== undefined) {
        try {
            const curRes = await fetch(`https://api.airtable.com/v0/${baseId}/Leads/${id}`, {
                headers: { 'Authorization': `Bearer ${apiKey}` },
            });
            if (curRes.ok) cur = await curRes.json();
        } catch (_) { /* cur stays null — name-recompute / CAPI transition just skipped below */ }
    }

    // Recompute primary "Name" if first or last changed (matches the convention
    // already in save-lead.js / Airtable formula).
    if (cur && (firstName !== undefined || lastName !== undefined)) {
        const fn = firstName !== undefined ? firstName : (cur.fields?.['First Name'] || '');
        const ln = lastName  !== undefined ? lastName  : (cur.fields?.['Last Name']  || '');
        fields['Name'] = `${fn} ${ln}`.trim();
    }

    if (Object.keys(fields).length === 0) {
        return json({ error: 'Nothing to update' }, 400);
    }

    const res = await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type':  'application/json',
        },
        body: JSON.stringify({ records: [{ id, fields }], typecast: true }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to update lead' }, 500);
    }

    // Server-side Meta CAPI "quality signal" event — fires ONLY on an UPWARD status
    // transition (New→Contacted, →Warm/Hot, →Client), never on a re-set or downgrade.
    // `cur` was snapshotted BEFORE this PATCH, above. No-ops entirely unless
    // META_CAPI_ACCESS_TOKEN is set; sendCapiEvent() never throws. Server-only event — no
    // browser counterpart, so no event_id / dedup needed. Wrapped defensively so a CAPI
    // failure can never break the update, which has already fully succeeded by this point.
    if (status !== undefined && cur) {
        try {
            const oldRank = STATUS_RANK[cur.fields?.['Status'] || ''] ?? 0;
            const newRank = STATUS_RANK[status] ?? 0;
            if (newRank >= 1 && newRank > oldRank) {
                const capiEventName = STATUS_CAPI_EVENT[newRank];
                if (capiEventName) {
                    const f = cur.fields || {};
                    // Prefer context.waitUntil (Vercel Edge prod) so the CAPI fetch runs AFTER
                    // the response — zero added latency; fall back to awaiting so the event is
                    // never silently dropped. Trailing .catch keeps any late error from surfacing.
                    const _capiCall = sendCapiEvent({
                        eventName: capiEventName,
                        userData: {
                            email:     f['Email'],
                            phone:     f['Phone'],
                            firstName: f['First Name'],
                            lastName:  f['Last Name'],
                            country:   f['Country'],
                        },
                        customData: capiEventName === 'Purchase'
                            ? { currency: 'USD', value: Number(f['Listing Price']) || 0 }
                            : { content_category: 'Real Estate' },
                        req,
                    }).catch(() => {});
                    if (typeof context?.waitUntil === 'function') { context.waitUntil(_capiCall); }
                    else { try { await _capiCall; } catch (_) {} }
                }
            }
        } catch (_) { /* never break the update on a CAPI failure */ }
    }

    return json({ success: true });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
    });
}
