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
    // Whitelist before either value reaches filterByFormula (same regexes as
    // api/remember.js / api/recalibrate.js) — this endpoint is public.
    if (token && !/^[A-Za-z0-9_-]{10,80}$/.test(String(token))) return json({ error: 'Invalid token' }, 400);
    if (email && !(/^[^\s@'"\\]+@[^\s@'"\\]+\.[^\s@'"\\]+$/.test(String(email)) && String(email).length <= 254)) return json({ error: 'Invalid email' }, 400);

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
        // NO 'Lead Record ID' — the Lead Activity table has no such field; including
        // it 422s the whole write silently (the 2026-08-06 no-repeat-memory outage).
        // Rows are keyed by Lead Email.
        const activityFields = {
            'Lead Email': leadEmail,
            'Activity Type': activityType,
            'Details': typeof details === 'string' ? details : JSON.stringify(details || {}),
            'Timestamp': now,
        };

        const tableUrl = `https://api.airtable.com/v0/${baseId}/Lead Activity`;
        try {
            const actRes = await fetch(tableUrl, {
                method: 'POST',
                headers,
                // typecast: 'Activity Type' is a single-select — without it Airtable
                // 422s any NEW type (the 2026-08-06 'Email Sent' silent no-op); with it
                // the option is created on first use (probed live 2026-09-10).
                body: JSON.stringify({ records: [{ fields: activityFields }], typecast: true }),
            });
            if (!actRes.ok) console.error(`log-activity write failed ${actRes.status}: ${(await actRes.text()).slice(0, 200)}`);
        } catch (err) { console.error(`log-activity write error: ${err.message}`); }

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
                // Stored values are rendered in the CRM — strip quotes/control
                // chars and cap length so a hostile caller can't plant markup.
                const clean = (v, n) => String(v == null ? '' : v).replace(/[<>"'`\\\u0000-\u001f]/g, '').slice(0, n);
                const newView = {
                    mlsId: clean(detailObj.mlsId, 40),
                    address: clean(detailObj.address, 200),
                    price: Number(detailObj.price) || 0,
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
