/**
 * /api/save-consulting-deal.js — Vercel Edge Function
 * Creates a new deal (engagement) for a Consulting Company.
 *
 * Body: { password, companyId, dealName, stage?, serviceType?, dealValue?,
 *         probability?, owner?, startedAt?, description? }
 *
 * On success: writes a "Deal Created" Activity row alongside the deal.
 *
 * Required env vars: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, CRM_PASSWORD
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        });
    }
    if (req.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405);
    }

    const apiKey  = process.env.AIRTABLE_API_KEY;
    const baseId  = process.env.AIRTABLE_BASE_ID;
    const crmPass = process.env.CRM_PASSWORD;

    let body;
    try { body = await req.json(); }
    catch { return json({ error: 'Invalid request body' }, 400); }

    const { password } = body;
    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);

    const {
        companyId         = '',
        dealName          = '',
        stage             = 'Pitching',
        serviceType       = [],
        dealValue         = 0,
        probability       = 10,
        owner             = '',
        startedAt         = '',
        description       = '',
        partnerId         = '',
        expectedCloseDate = '',
        agent             = '',
    } = body;

    if (!companyId || !dealName.trim()) {
        return json({ error: 'companyId and dealName are required' }, 400);
    }

    const today = new Date().toISOString().slice(0, 10);

    const fields = {
        'Deal Name':        dealName.trim(),
        'Company':          [companyId],
        'Stage':            stage,
        'Stage Entered At': today,
    };
    if (Array.isArray(serviceType) && serviceType.length) fields['Service Type'] = serviceType;
    if (dealValue)         fields['Deal Value']           = Number(dealValue) || 0;
    if (probability != null && probability !== '') fields['Probability'] = Number(probability) || 0;
    if (owner)             fields['Owner']                = owner;
    if (startedAt)         fields['Started At']           = startedAt;
    if (description)       fields['Description']          = description;
    if (partnerId)         fields['Partner']              = [partnerId];
    if (expectedCloseDate) fields['Expected Close Date']  = expectedCloseDate;

    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    const res = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Deals`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ records: [{ fields }], typecast: true }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to create deal' }, 500);
    }

    const data = await res.json();
    const dealId = data.records?.[0]?.id;

    // Auto-log "Deal Created" activity (must await per Edge runtime rule)
    if (dealId) {
        await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Activity`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                records: [{
                    fields: {
                        'Title':   `Deal created: ${dealName}`,
                        'Type':    'Deal Created',
                        'Company': [companyId],
                        'Deal':    [dealId],
                        'Details': description || '',
                        'Agent':   agent || '',
                    },
                }],
                typecast: true,
            }),
        }).catch(err => console.error('Activity log failed:', err));
    }

    return json({ success: true, id: dealId });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
