/**
 * /api/save-conversation.js — Vercel Edge Function
 * Saves/updates AI chat conversation in Airtable "Conversations" table.
 *
 * Required Vercel env vars:
 *   AIRTABLE_API_KEY, AIRTABLE_BASE_ID
 */

export const config = { runtime: 'edge' };

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

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);

    let body;
    try { body = await req.json(); } catch { return json({ error: 'Invalid body' }, 400); }

    const { email, messages, sessionId } = body;
    if (!email || !sessionId || !messages) return json({ error: 'Missing required fields' }, 400);

    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    const tableUrl = `https://api.airtable.com/v0/${baseId}/Conversations`;

    try {
        // Look up existing conversation by sessionId
        const findUrl = `${tableUrl}?filterByFormula=${encodeURIComponent(`{Session ID}="${sessionId}"`)}`;
        const findRes = await fetch(findUrl, { headers });
        const findData = findRes.ok ? await findRes.json() : { records: [] };
        const existing = findData.records?.[0];

        // Look up Lead record by email for linking
        const leadUrl = `https://api.airtable.com/v0/${baseId}/Leads?filterByFormula=${encodeURIComponent(`{Email}="${email}"`)}`;
        const leadRes = await fetch(leadUrl, { headers });
        const leadData = leadRes.ok ? await leadRes.json() : { records: [] };
        const leadId = leadData.records?.[0]?.id;

        const fields = {
            'Lead Email': email,
            'Messages': JSON.stringify(messages).slice(0, 100000),
            'Last Updated': new Date().toISOString(),
            'Session ID': sessionId,
        };
        if (leadId) fields['Lead Record ID'] = [leadId];

        if (existing) {
            // Update existing conversation
            const res = await fetch(`${tableUrl}/${existing.id}`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ fields }),
            });
            if (!res.ok) return json({ error: 'Failed to update conversation' }, 500);
        } else {
            // Create new conversation
            const res = await fetch(tableUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify({ records: [{ fields }] }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                // Table might not exist yet — fail gracefully
                console.error('Save conversation error:', err);
                return json({ error: 'Failed to save conversation' }, 500);
            }
        }

        return json({ success: true });
    } catch (err) {
        console.error('save-conversation error:', err);
        return json({ error: err.message }, 500);
    }
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
