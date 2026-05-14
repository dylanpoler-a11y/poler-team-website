/**
 * /api/get-account.js — Vercel Edge Function
 *
 * Returns a lead's account profile + saved properties + recent searches +
 * recent property views. Used by account.html.
 *
 * Body: { email, password }
 *   Both are required so we don't leak account data to drive-by URLs.
 *
 * Response: {
 *   success: true,
 *   profile: { firstName, lastName, email, phone, country, language, createdAt, totalTimeSpent },
 *   savedMlsIds: [...],
 *   propertiesViewed: [{ mlsId, address, price, viewedAt }, ...],
 *   recentSearches: [{ details, timestamp }, ...],
 *   alertProfiles: [...],
 * }
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

    const email    = (body.email    || '').trim();
    const password = (body.password || '').trim();
    if (!email || !password) return json({ error: 'Email and password required' }, 401);

    const headers = { 'Authorization': `Bearer ${apiKey}` };

    try {
        // Find lead by email
        const formula = encodeURIComponent(`{Email}="${email.replace(/"/g, '\\"')}"`);
        const leadRes = await fetch(
            `https://api.airtable.com/v0/${baseId}/Leads?filterByFormula=${formula}&maxRecords=1`,
            { headers }
        );
        if (!leadRes.ok) return json({ error: 'Lookup failed' }, 500);
        const leadData = await leadRes.json();
        const record = leadData.records?.[0];
        if (!record) return json({ error: 'not_found' }, 404);

        const stored = record.fields['Access Password'] || '';
        if (stored && stored !== password) return json({ error: 'invalid_password' }, 401);

        // Parse JSON-ish fields safely
        const safeParse = (raw, fallback) => {
            try {
                if (!raw) return fallback;
                const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                return parsed ?? fallback;
            } catch { return fallback; }
        };

        const savedMlsIds      = safeParse(record.fields['Saved Properties'], []);
        const propertiesViewed = safeParse(record.fields['Properties Viewed'], []);
        const alertProfiles    = safeParse(record.fields['Alert Profiles'], []);

        // Pull recent search activity from Lead Activity table
        const activityFormula = encodeURIComponent(
            `AND({Lead Email}="${email.replace(/"/g, '\\"')}", {Activity Type}="Search")`
        );
        let recentSearches = [];
        try {
            const actRes = await fetch(
                `https://api.airtable.com/v0/${baseId}/Lead Activity?filterByFormula=${activityFormula}&sort[0][field]=Timestamp&sort[0][direction]=desc&maxRecords=20`,
                { headers }
            );
            if (actRes.ok) {
                const actData = await actRes.json();
                recentSearches = (actData.records || []).map(r => ({
                    timestamp: r.fields['Timestamp'] || '',
                    details:   safeParse(r.fields['Details'], {}),
                }));
            }
        } catch (_) { /* non-fatal */ }

        return json({
            success: true,
            profile: {
                firstName:      record.fields['First Name'] || '',
                lastName:       record.fields['Last Name']  || '',
                email:          record.fields['Email']      || '',
                phone:          record.fields['Phone']      || '',
                country:        record.fields['Country']    || '',
                language:       record.fields['Preferred Language'] || 'en',
                createdAt:      record.fields['Created At'] || '',
                totalTimeSpent: Number(record.fields['Total Time Spent'] || 0),
                lastLogin:      record.fields['Last Login'] || '',
                alertActive:    !!record.fields['Alert Active'],
            },
            savedMlsIds,
            propertiesViewed,
            recentSearches,
            alertProfiles,
        });
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
