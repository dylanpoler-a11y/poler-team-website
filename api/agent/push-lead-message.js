/**
 * /api/agent/push-lead-message.js
 * Append a system message into a lead's AI chat conversation. Will appear the
 * next time the lead opens /listing.
 *
 * Body: { leadEmail, message, sender? }
 *   sender defaults to 'assistant' (looks like a normal bot message in the UI).
 */

export const config = { runtime: 'edge' };

import { authorize } from '../_auth.js';

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }});
    }
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    let body;
    try { body = await req.json(); } catch { return json({ error: 'Bad body' }, 400); }
    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);

    const { leadEmail, message, sender = 'assistant' } = body;
    if (!leadEmail || !message?.trim()) {
        return json({ error: 'leadEmail and message required' }, 400);
    }

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    // Fetch existing conversation
    const formula = encodeURIComponent(`{Lead Email}='${leadEmail.replace(/'/g, "\\'")}'`);
    const getRes = await fetch(`https://api.airtable.com/v0/${baseId}/Conversations?filterByFormula=${formula}&maxRecords=1`, { headers });
    if (!getRes.ok) {
        const err = await getRes.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Airtable error', status: getRes.status }, getRes.status);
    }
    const data = await getRes.json();
    const existing = data.records?.[0];

    let messages = [];
    if (existing) {
        try { messages = JSON.parse(existing.fields?.['Messages'] || '[]'); }
        catch { messages = []; }
    }

    messages.push({
        role: sender,
        content: message.trim(),
        timestamp: new Date().toISOString(),
        pushed_by_agent: true,
    });

    const fields = {
        'Lead Email':    leadEmail,
        'Messages':      JSON.stringify(messages),
        'Last Updated':  new Date().toISOString(),
    };

    let res;
    if (existing) {
        res = await fetch(`https://api.airtable.com/v0/${baseId}/Conversations`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ records: [{ id: existing.id, fields }] }),
        });
    } else {
        res = await fetch(`https://api.airtable.com/v0/${baseId}/Conversations`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ records: [{ fields }], typecast: true }),
        });
    }

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to save conversation', status: res.status }, res.status);
    }

    return json({ success: true, messageCount: messages.length });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
