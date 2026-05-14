/**
 * /api/get-consulting-deals.js — Vercel Edge Function
 * Fetches all consulting deals (engagements) from Airtable.
 *
 * Query params:
 *   password    (required) — CRM_PASSWORD
 *   companyId   (optional) — filter to one Company record id
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
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        });
    }
    if (req.method !== 'GET') {
        return json({ error: 'Method not allowed' }, 405);
    }

    const apiKey  = process.env.AIRTABLE_API_KEY;
    const baseId  = process.env.AIRTABLE_BASE_ID;
    const crmPass = process.env.CRM_PASSWORD;

    const url       = new URL(req.url);
    const password  = url.searchParams.get('password');
    const companyId = url.searchParams.get('companyId');

    if (!authorize(req, null).ok) {
        return json({ error: 'Unauthorized' }, 401);
    }
    if (!apiKey || !baseId) {
        return json({ error: 'Airtable not configured' }, 500);
    }

    let allDeals = [];
    let offset = null;

    for (let page = 0; page < 10; page++) {
        const params = new URLSearchParams({
            'sort[0][field]':     'Stage Entered At',
            'sort[0][direction]': 'desc',
            'pageSize':           '100',
        });
        if (offset) params.set('offset', offset);
        if (companyId) {
            // Filter by linked Company record id (FIND() over array of record ids)
            params.set('filterByFormula', `FIND('${companyId}', ARRAYJOIN({Company}))`);
        }

        const res = await fetch(
            `https://api.airtable.com/v0/${baseId}/Consulting%20Deals?${params}`,
            { headers: { 'Authorization': `Bearer ${apiKey}` } }
        );

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            return json({ error: err.error?.message || 'Failed to fetch deals', deals: [] }, res.status);
        }

        const data = await res.json();
        const records = data.records || [];

        allDeals = allDeals.concat(records.map(r => ({
            id:                   r.id,
            dealName:             r.fields['Deal Name']            || '',
            companyId:            (r.fields['Company']             || [])[0] || '',
            stage:                r.fields['Stage']                || 'Pitching',
            serviceType:          r.fields['Service Type']         || [],
            dealValue:            r.fields['Deal Value']           || 0,
            probability:          r.fields['Probability']          ?? null,
            owner:                r.fields['Owner']                || '',
            stageEnteredAt:       r.fields['Stage Entered At']     || '',
            startedAt:            r.fields['Started At']           || '',
            closedAt:             r.fields['Closed At']            || '',
            lastContact:          r.fields['Last Contact']         || '',
            expectedCloseDate:    r.fields['Expected Close Date']  || '',
            partnerId:            (r.fields['Partner']             || [])[0] || '',
            timeline:             r.fields['Timeline']             || '',
            diagnosticFee:        r.fields['Diagnostic Fee']       || 0,
            monthlyRecurringFee:  r.fields['Monthly Recurring Fee']|| 0,
            successFee:           r.fields['Success Fee']          ?? null,
            feeNotes:             r.fields['Fee Notes']            || '',
            contractStartDate:    r.fields['Contract Start Date']  || '',
            endType:              r.fields['End Type']             || '',
            contractEndDate:      r.fields['Contract End Date']    || '',
            noticePeriod:         r.fields['Notice Period']        || '',
            description:          r.fields['Description']          || '',
            contracts:            r.fields['Contracts']            || [],
            deliverables:         r.fields['Deliverables']         || [],
            spreadsheets:         r.fields['Spreadsheets']         || [],
            misc:                 r.fields['Misc']                 || [],
            createdAt:            r.createdTime                    || '',
        })));

        if (!data.offset) break;
        offset = data.offset;
    }

    return json({ deals: allDeals });
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
