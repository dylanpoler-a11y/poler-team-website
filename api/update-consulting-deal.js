/**
 * /api/update-consulting-deal.js — Vercel Edge Function
 * PATCH a deal. If Stage changes, advance Stage Entered At + log Stage Change activity.
 * If Stage becomes Won/Lost, set Closed At = today.
 *
 * Body: { id, password, agent?, ...fields }
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

    let body;
    try { body = await req.json(); }
    catch { return json({ error: 'Invalid request body' }, 400); }

    const { id, password, agent = '', ...input } = body;
    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);
    if (!id) return json({ error: 'Deal id is required' }, 400);

    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    const today = new Date().toISOString().slice(0, 10);

    // 1. Fetch current state to detect stage transitions
    const currentRes = await fetch(
        `https://api.airtable.com/v0/${baseId}/Consulting%20Deals/${id}`,
        { headers }
    );
    if (!currentRes.ok) {
        return json({ error: 'Deal not found' }, 404);
    }
    const current = await currentRes.json();
    const previousStage = current.fields?.['Stage'] || '';
    const previousCompany = (current.fields?.['Company'] || [])[0] || '';

    // 2. Build PATCH payload
    const fields = {};
    if (input.dealName     !== undefined) fields['Deal Name']    = String(input.dealName);
    if (input.stage        !== undefined) fields['Stage']        = input.stage;
    if (input.serviceType  !== undefined) fields['Service Type'] = Array.isArray(input.serviceType) ? input.serviceType : [];
    if (input.dealValue    !== undefined) fields['Deal Value']   = Number(input.dealValue) || 0;
    if (input.probability  !== undefined) fields['Probability']  = Number(input.probability) || 0;
    if (input.owner        !== undefined) fields['Owner']        = input.owner;
    if (input.startedAt    !== undefined) fields['Started At']   = input.startedAt || null;
    if (input.closedAt     !== undefined) fields['Closed At']    = input.closedAt || null;
    if (input.description  !== undefined) fields['Description']  = String(input.description);

    // v3 additions
    if (input.lastContact         !== undefined) fields['Last Contact']         = input.lastContact || null;
    if (input.expectedCloseDate   !== undefined) fields['Expected Close Date']  = input.expectedCloseDate || null;
    if (input.partnerId           !== undefined) fields['Partner']              = input.partnerId ? [input.partnerId] : [];
    if (input.timeline            !== undefined) fields['Timeline']             = input.timeline || null;
    if (input.diagnosticFee       !== undefined) fields['Diagnostic Fee']       = Number(input.diagnosticFee) || 0;
    if (input.monthlyRecurringFee !== undefined) fields['Monthly Recurring Fee']= Number(input.monthlyRecurringFee) || 0;
    if (input.successFee          !== undefined) {
        const n = Number(input.successFee);
        // Accept either 0–1 or 0–100; store as 0–1 for percent type
        if (!isNaN(n)) fields['Success Fee'] = n > 1 ? n / 100 : n;
    }
    if (input.feeNotes            !== undefined) fields['Fee Notes']            = String(input.feeNotes);
    if (input.contractStartDate   !== undefined) fields['Contract Start Date']  = input.contractStartDate || null;
    if (input.endType             !== undefined) fields['End Type']             = input.endType || null;
    if (input.contractEndDate     !== undefined) fields['Contract End Date']    = input.contractEndDate || null;
    if (input.noticePeriod        !== undefined) fields['Notice Period']        = String(input.noticePeriod);

    // 3. If stage is changing, set Stage Entered At + closed-out logic
    const stageChanged = input.stage !== undefined && input.stage !== previousStage;
    if (stageChanged) {
        fields['Stage Entered At'] = today;
        if (input.stage === 'Won' || input.stage === 'Lost') {
            fields['Closed At'] = today;
        }
    }

    if (Object.keys(fields).length === 0) {
        return json({ error: 'No fields to update' }, 400);
    }

    const patchRes = await fetch(
        `https://api.airtable.com/v0/${baseId}/Consulting%20Deals`,
        {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ records: [{ id, fields }], typecast: true }),
        }
    );

    if (!patchRes.ok) {
        const err = await patchRes.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to update deal' }, 500);
    }

    // 4. Auto-log Stage Change activity (must await — Edge fire-and-forget kills it)
    if (stageChanged && previousCompany) {
        await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Activity`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                records: [{
                    fields: {
                        'Title':   `Stage moved: ${previousStage || '—'} → ${input.stage}`,
                        'Type':    'Stage Change',
                        'Company': [previousCompany],
                        'Deal':    [id],
                        'Details': '',
                        'Agent':   agent,
                    },
                }],
                typecast: true,
            }),
        }).catch(err => console.error('Activity log failed:', err));
    }

    return json({ success: true });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
