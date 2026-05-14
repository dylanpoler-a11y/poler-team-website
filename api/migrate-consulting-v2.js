/**
 * /api/migrate-consulting-v2.js — Vercel Edge Function
 * One-time migration: split each existing Consulting Clients row's pipeline
 * data (Status, Project Value, Started At, Service Type) into a new Deal row
 * in the Consulting Deals table. Idempotent (skips companies that already
 * have at least one Deal linked).
 *
 * Query params: password=$CRM_PASSWORD
 *
 * Returns { migrated: N, skipped: M, errors: [] }
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';

export default async function handler(req) {
    const apiKey  = process.env.AIRTABLE_API_KEY;
    const baseId  = process.env.AIRTABLE_BASE_ID;
    const crmPass = process.env.CRM_PASSWORD;

    const url = new URL(req.url);
    const password = url.searchParams.get('password');
    if (!authorize(req, null).ok) return json({ error: 'Unauthorized' }, 401);
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);

    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    // 1. Pull all existing Consulting Clients
    const compsRes = await fetch(
        `https://api.airtable.com/v0/${baseId}/Consulting%20Clients?pageSize=100`,
        { headers }
    );
    if (!compsRes.ok) {
        const err = await compsRes.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to fetch companies' }, 500);
    }
    const comps = (await compsRes.json()).records || [];

    // 2. Pull all existing Consulting Deals to skip companies that already have one
    const dealsRes = await fetch(
        `https://api.airtable.com/v0/${baseId}/Consulting%20Deals?pageSize=100&fields%5B%5D=Company`,
        { headers }
    );
    const existing = dealsRes.ok ? (await dealsRes.json()).records || [] : [];
    const companiesWithDeal = new Set(
        existing.flatMap(r => (r.fields?.Company || []))
    );

    const today = new Date().toISOString().slice(0, 10);
    const migrated = [];
    const skipped = [];
    const errors = [];

    for (const comp of comps) {
        if (companiesWithDeal.has(comp.id)) {
            skipped.push({ id: comp.id, reason: 'already has deal' });
            continue;
        }

        const status      = comp.fields?.['Status']         || '';
        const serviceType = comp.fields?.['Service Type']   || [];
        const value       = comp.fields?.['Project Value']  || 0;
        const startedAt   = comp.fields?.['Started At']     || '';
        const company     = comp.fields?.['Company']        || 'Untitled';

        // Skip if there's truly nothing to migrate
        if (!status && !serviceType.length && !value && !startedAt) {
            skipped.push({ id: comp.id, reason: 'no pipeline data' });
            continue;
        }

        // Map legacy status to new Stage. Active → Diagnostic (mid-pipeline).
        // Companies with status "New" become Prospect, Completed → Won, etc.
        const stageMap = {
            'New':         'Prospect',
            'Active':      'Diagnostic',
            'On Hold':     'Negotiation',
            'Completed':   'Won',
            'Closed Lost': 'Lost',
        };
        const stage = stageMap[status] || 'Prospect';

        const fields = {
            'Deal Name':        `${company} — Initial Engagement`,
            'Company':          [comp.id],
            'Stage':            stage,
            'Stage Entered At': today,
        };
        if (serviceType.length) fields['Service Type'] = serviceType;
        if (value)              fields['Deal Value']   = Number(value) || 0;
        if (startedAt)          fields['Started At']   = startedAt;
        if (stage === 'Won' || stage === 'Lost') fields['Closed At'] = today;

        const res = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Deals`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ records: [{ fields }], typecast: true }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            errors.push({ id: comp.id, error: err.error?.message || 'unknown' });
        } else {
            const data = await res.json();
            migrated.push({ companyId: comp.id, dealId: data.records?.[0]?.id });
        }
    }

    return json({
        migrated: migrated.length,
        skipped:  skipped.length,
        errors:   errors.length,
        details: { migrated, skipped, errors },
    });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
