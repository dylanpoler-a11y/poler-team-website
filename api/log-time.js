/**
 * /api/log-time.js — Vercel Edge Function
 *
 * Increments a lead's "Total Time Spent" (seconds) on the website.
 * Called by track-time.js every 30s while the lead is active, plus a final
 * sendBeacon flush on page unload.
 *
 * Body: { email, password?, seconds }
 *   - We accept either email alone (auto-login already trusts the device)
 *     or email+password (extra validation). The frontend always sends both.
 *   - seconds: positive integer of additional active seconds since last ping.
 *
 * Also bumps "Last Login" so the CRM stays fresh.
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
    if (!apiKey || !baseId) return json({ error: 'Not configured' }, 500);

    let body;
    try { body = await req.json(); } catch { return json({ error: 'Invalid body' }, 400); }

    const email    = (body.email || '').trim();
    const seconds  = Math.max(0, Math.min(3600, Number(body.seconds) || 0)); // cap a single ping to 1 hour
    if (!email || seconds <= 0) return json({ error: 'Missing email or seconds' }, 400);

    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    try {
        // Lookup the lead by email
        const formula = encodeURIComponent(`{Email}="${email.replace(/"/g, '\\"')}"`);
        const lookupRes = await fetch(
            `https://api.airtable.com/v0/${baseId}/Leads?filterByFormula=${formula}&maxRecords=1`,
            { headers }
        );
        if (!lookupRes.ok) return json({ error: 'Lookup failed' }, 500);
        const lookupData = await lookupRes.json();
        const record = lookupData.records?.[0];
        if (!record) return json({ error: 'Lead not found' }, 404);

        const current = Number(record.fields['Total Time Spent'] || 0);
        const updated = current + seconds;

        await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({
                records: [{
                    id: record.id,
                    fields: {
                        'Total Time Spent': updated,
                        'Last Login': new Date().toISOString(),
                    },
                }],
            }),
        });

        return json({ success: true, totalSeconds: updated });
    } catch (err) {
        return json({ error: err.message }, 500);
    }
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
