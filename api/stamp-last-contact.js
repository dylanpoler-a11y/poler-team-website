/**
 * /api/stamp-last-contact.js — Vercel Edge Function
 * Auto-stamps Last Contact = today on an Opportunity, AND logs a Call Logged /
 * Email Logged / WhatsApp activity row. Called by Call/Email/WhatsApp buttons.
 *
 * Body: { id, password, channel: 'Call' | 'Email' | 'WhatsApp', agent? }
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';

const CHANNEL_TO_TYPE = {
    Call:     'Call Logged',
    Email:    'Email Logged',
    WhatsApp: 'WhatsApp',
};

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
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const apiKey  = process.env.AIRTABLE_API_KEY;
    const baseId  = process.env.AIRTABLE_BASE_ID;
    const crmPass = process.env.CRM_PASSWORD;

    let body;
    try { body = await req.json(); }
    catch { return json({ error: 'Invalid request body' }, 400); }

    const { id, password, channel = 'Call', agent = '' } = body;
    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);
    if (!id) return json({ error: 'Opportunity id is required' }, 400);
    if (!CHANNEL_TO_TYPE[channel]) {
        return json({ error: `channel must be one of ${Object.keys(CHANNEL_TO_TYPE).join(', ')}` }, 400);
    }

    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    const today = new Date().toISOString().slice(0, 10);

    // Fetch the deal to know the Company link
    const cur = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Deals/${id}`, { headers });
    if (!cur.ok) return json({ error: 'Opportunity not found' }, 404);
    const curData = await cur.json();
    const companyId = (curData.fields?.['Company'] || [])[0] || '';
    const dealName  = curData.fields?.['Deal Name'] || '';

    // 1. PATCH Last Contact = today
    const patchRes = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Deals`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
            records: [{ id, fields: { 'Last Contact': today } }],
        }),
    });

    if (!patchRes.ok) {
        const err = await patchRes.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to stamp Last Contact' }, 500);
    }

    // 2. Log activity (must await per Edge runtime rule)
    if (companyId) {
        await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Activity`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                records: [{
                    fields: {
                        'Title':   `${channel} logged on ${dealName || 'opportunity'}`,
                        'Type':    CHANNEL_TO_TYPE[channel],
                        'Company': [companyId],
                        'Deal':    [id],
                        'Agent':   agent,
                    },
                }],
                typecast: true,
            }),
        }).catch(err => console.error('Activity log failed:', err));
    }

    return json({ success: true, lastContact: today });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
