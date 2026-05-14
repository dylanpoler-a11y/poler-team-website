/**
 * /api/log-activity.js — Vercel Edge Function
 * Logs lead activity (searches, property views) to Airtable "Lead Activity" table.
 * Also updates Last Login and Properties Viewed on the Leads record.
 *
 * Accepts either { email } or { token } to identify the lead.
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

    const { email, token, activityType, details } = body;
    if ((!email && !token) || !activityType) return json({ error: 'Missing required fields' }, 400);

    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    try {
        // Look up Lead record by email OR token
        let leadRecord = null;
        let leadEmail = email || '';

        if (token) {
            const tokenUrl = `https://api.airtable.com/v0/${baseId}/Leads?filterByFormula=${encodeURIComponent(`{Alert Token}="${token}"`)}`;
            const tokenRes = await fetch(tokenUrl, { headers });
            const tokenData = tokenRes.ok ? await tokenRes.json() : { records: [] };
            leadRecord = tokenData.records?.[0] || null;
            if (leadRecord) leadEmail = leadRecord.fields['Email'] || leadEmail;
        } else if (email) {
            const leadUrl = `https://api.airtable.com/v0/${baseId}/Leads?filterByFormula=${encodeURIComponent(`{Email}="${email}"`)}`;
            const leadRes = await fetch(leadUrl, { headers });
            const leadData = leadRes.ok ? await leadRes.json() : { records: [] };
            leadRecord = leadData.records?.[0] || null;
        }

        const leadId = leadRecord?.id;
        const now = new Date().toISOString();

        // 1. Log to Lead Activity table
        const activityFields = {
            'Lead Email': leadEmail,
            'Activity Type': activityType,
            'Details': typeof details === 'string' ? details : JSON.stringify(details || {}),
            'Timestamp': now,
        };
        if (leadId) activityFields['Lead Record ID'] = [leadId];

        const tableUrl = `https://api.airtable.com/v0/${baseId}/Lead Activity`;
        await fetch(tableUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({ records: [{ fields: activityFields }] }),
        }).catch(() => {});

        // 2. Update Lead record: Last Login + Properties Viewed
        if (leadId && activityType === 'Property View' && details) {
            const updateFields = { 'Last Login': now };

            // Append to Properties Viewed JSON array
            try {
                const existingViewed = leadRecord.fields['Properties Viewed'] || '[]';
                let viewedArr = [];
                try { viewedArr = JSON.parse(existingViewed); } catch { viewedArr = []; }
                if (!Array.isArray(viewedArr)) viewedArr = [];

                const detailObj = typeof details === 'string' ? JSON.parse(details) : details;
                const newView = {
                    mlsId: detailObj.mlsId || '',
                    address: detailObj.address || '',
                    price: detailObj.price || 0,
                    viewedAt: now,
                };

                // Always add (track every view, even revisits)
                viewedArr.unshift(newView); // newest first
                // Keep max 100 entries
                if (viewedArr.length > 100) viewedArr = viewedArr.slice(0, 100);

                updateFields['Properties Viewed'] = JSON.stringify(viewedArr);
                // Count unique properties
                const uniqueMls = new Set(viewedArr.map(v => v.mlsId).filter(Boolean));
                updateFields['Total Properties Viewed'] = uniqueMls.size;
            } catch (e) {
                // If parsing fails, just update Last Login
            }

            await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ records: [{ id: leadId, fields: updateFields }] }),
            }).catch(() => {});
        } else if (leadId) {
            // For non-property-view activities, just update Last Login
            await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ records: [{ id: leadId, fields: { 'Last Login': now } }] }),
            }).catch(() => {});
        }

        return json({ success: true });
    } catch (err) {
        console.error('log-activity error:', err);
        return json({ error: err.message }, 500);
    }
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
