/**
 * /api/get-activity.js — Vercel Edge Function
 * Fetches lead activity from Airtable "Lead Activity" table for CRM.
 *
 * Required Vercel env vars:
 *   AIRTABLE_API_KEY, AIRTABLE_BASE_ID, CRM_PASSWORD
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

    if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

    const apiKey  = process.env.AIRTABLE_API_KEY;
    const baseId  = process.env.AIRTABLE_BASE_ID;
    const crmPass = process.env.CRM_PASSWORD;

    const url      = new URL(req.url);
    const password = url.searchParams.get('password');
    const email    = url.searchParams.get('email');

    if (!authorize(req, null).ok) return json({ error: 'Unauthorized' }, 401);
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);
    if (!email) return json({ error: 'Email required' }, 400);

    try {
        const tableUrl = `https://api.airtable.com/v0/${baseId}/Lead%20Activity`;
        const params = new URLSearchParams({
            filterByFormula: `{Lead Email}="${email}"`,
            'sort[0][field]': 'Timestamp',
            'sort[0][direction]': 'desc',
            pageSize: '50',
        });

        const res = await fetch(`${tableUrl}?${params}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            if (err.error?.type === 'TABLE_NOT_FOUND') return json({ activities: [] });
            return json({ error: 'Failed to fetch activity' }, 500);
        }

        const data = await res.json();
        const activities = (data.records || []).map(r => ({
            id: r.id,
            activityType: r.fields['Activity Type'] || '',
            details: r.fields['Details'] || '',
            timestamp: r.fields['Timestamp'] || '',
        }));

        return json({ activities });
    } catch (err) {
        console.error('get-activity error:', err);
        return json({ error: err.message }, 500);
    }
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
