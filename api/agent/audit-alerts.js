/**
 * /api/agent/audit-alerts.js — read-only audit across every alert-active lead.
 *
 * GET (Bearer-token or ?password=): runs the SAME search the daily cron would
 * run, but writes nothing — no email, no Airtable mutation. Returns one row
 * per lead with the per-step debug counts so Kevin can see in one glance who
 * is silently getting 0 results and why.
 *
 * Query params:
 *   ?leadId=recXXX   audit a single lead instead of all active ones
 *   ?onlyZero=1      return only leads whose audit returned 0 listings
 *   ?limit=N         cap at N leads (default: all)
 *
 * Response:
 *   {
 *     auditedAt: ISO,
 *     totalActive, totalAudited, totalZero, totalNeedsReview,
 *     leads: [
 *       {
 *         id, name, email,
 *         alertActive, alertLastSent, alertNextDue,
 *         alertZeroRuns, alertNeedsReview, alertLastSkipReason,
 *         filters: { cities, types, priceMin, priceMax, bedsMin, bathsMin, polygonPresent },
 *         finalCount,
 *         droppedBy,
 *         reason,
 *         perProfile: [...]   // full debug from lib/alert-search.js
 *       }
 *     ]
 *   }
 *
 * Required env:
 *   AGENT_API_TOKEN, AIRTABLE_API_KEY, AIRTABLE_BASE_ID, BRIDGE_API_TOKEN
 */

export const config = { runtime: 'edge' };

import { authorize } from '../_auth.js';
import { searchListingsForLead, explainDroppedBy } from '../../lib/alert-search.js';

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            },
        });
    }

    if (!authorize(req, {}).ok) return json({ error: 'Unauthorized' }, 401);

    const apiKey      = process.env.AIRTABLE_API_KEY;
    const baseId      = process.env.AIRTABLE_BASE_ID;
    const bridgeToken = process.env.BRIDGE_API_TOKEN;
    if (!apiKey || !baseId || !bridgeToken) {
        return json({ error: 'Missing required environment variables' }, 500);
    }

    const url = new URL(req.url);
    const singleLeadId = url.searchParams.get('leadId') || '';
    const onlyZero     = url.searchParams.get('onlyZero') === '1';
    const limitParam   = parseInt(url.searchParams.get('limit') || '0', 10);
    const headers      = { 'Authorization': `Bearer ${apiKey}` };

    // Pull leads.
    let leadRecords = [];
    if (singleLeadId) {
        const res = await fetch(`https://api.airtable.com/v0/${baseId}/Leads/${singleLeadId}`, { headers });
        if (!res.ok) return json({ error: 'Lead not found' }, 404);
        leadRecords = [await res.json()];
    } else {
        const formula = `{Alert Active}=TRUE()`;
        const params  = new URLSearchParams({ filterByFormula: formula, pageSize: '100' });
        let offset = null;
        for (let page = 0; page < 10; page++) {
            if (offset) params.set('offset', offset);
            const res = await fetch(`https://api.airtable.com/v0/${baseId}/Leads?${params}`, { headers });
            if (!res.ok) break;
            const data = await res.json();
            leadRecords = leadRecords.concat(data.records || []);
            if (!data.offset) break;
            offset = data.offset;
        }
    }

    const totalActive = leadRecords.length;
    const sliceLimit = limitParam > 0 ? Math.min(limitParam, leadRecords.length) : leadRecords.length;
    const audited = [];
    let totalZero = 0;
    let totalNeedsReview = 0;

    for (let i = 0; i < sliceLimit; i++) {
        const record = leadRecords[i];
        const f = record.fields || {};
        const email = (f['Email'] || '').replace(/[^\x20-\x7E]/g, '').trim();

        const lead = {
            id:        record.id,
            firstName: f['First Name'] || f['Name']?.split(' ')[0] || 'there',
            email,
            cities:    f['Alert Cities'] || '',
            types:     f['Alert Property Types'] || [],
            priceMin:  f['Alert Price Min'] || 0,
            priceMax:  f['Alert Price Max'] || 0,
            bedsMin:   f['Alert Beds Min'] || 0,
            bathsMin:  f['Alert Baths Min'] || 0,
            count:     f['Alert Count'] || 5,
            polygon:   f['Alert Polygon'] || '',
            profiles:  f['Alert Profiles'] || '',
        };

        let row;
        try {
            // Skip the random shuffle so the audit is deterministic.
            const { listings, debug } = await searchListingsForLead(bridgeToken, lead, { skipShuffle: true });
            const finalCount = listings.length;
            if (finalCount === 0) totalZero++;
            if (f['Alert Needs Review']) totalNeedsReview++;

            row = {
                id:    record.id,
                name:  f['Name'] || `${f['First Name'] || ''} ${f['Last Name'] || ''}`.trim() || '(unnamed)',
                email,
                alertActive:         !!f['Alert Active'],
                alertLastSent:       f['Alert Last Sent'] || null,
                alertNextDue:        f['Alert Next Due'] || null,
                alertFrequency:      f['Alert Frequency'] || 'Weekly',
                alertZeroRuns:       Number(f['Alert Zero Runs'] || 0),
                alertNeedsReview:    !!f['Alert Needs Review'],
                alertLastSkipReason: f['Alert Last Skip Reason'] || '',
                filters: {
                    cities:          lead.cities,
                    types:           lead.types,
                    priceMin:        lead.priceMin,
                    priceMax:        lead.priceMax,
                    bedsMin:         lead.bedsMin,
                    bathsMin:        lead.bathsMin,
                    polygonPresent:  !!lead.polygon,
                    hasMultiProfile: !!lead.profiles,
                },
                finalCount,
                droppedBy: debug.droppedBy,
                reason:    explainDroppedBy(debug.droppedBy, debug),
                totalRawBridge:   debug.totalRawBridge,
                totalAfterDedupe: debug.totalAfterDedupe,
                perProfile:       debug.perProfile,
            };
        } catch (err) {
            row = {
                id:    record.id,
                name:  f['Name'] || '(unnamed)',
                email,
                finalCount: 0,
                droppedBy:  'error',
                reason:     `Audit error: ${err.message}`,
            };
        }

        if (!onlyZero || row.finalCount === 0) audited.push(row);
    }

    audited.sort((a, b) => a.finalCount - b.finalCount);

    return json({
        auditedAt:        new Date().toISOString(),
        totalActive,
        totalAudited:     audited.length,
        totalZero,
        totalNeedsReview,
        leads:            audited,
    });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
