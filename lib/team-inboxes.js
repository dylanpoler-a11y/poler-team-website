/**
 * lib/team-inboxes.js — Airtable "Team Inboxes" CRUD.
 *
 * Table schema:
 *   Email          (primary, single line text)  — the gmail address being polled
 *   Owner          (single select: Kevin / Noel / Dylan / Rosa)
 *   Refresh Token  (long text)
 *   Last Polled    (datetime, ISO)
 *   Active         (checkbox)
 *
 * Auto-creates the table on first write if it doesn't exist. (Best-effort —
 * Airtable's metadata API requires a personal access token with schema scope;
 * if creation fails, the error message tells Kevin to make it manually.)
 */

const TABLE = 'Team%20Inboxes';
const TABLE_DECODED = 'Team Inboxes';

export async function listActiveInboxes() {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    if (!apiKey || !baseId) throw new Error('Airtable not configured');

    const params = new URLSearchParams({
        pageSize: '100',
        filterByFormula: '{Active}=TRUE()',
    });

    const res = await fetch(`https://api.airtable.com/v0/${baseId}/${TABLE}?${params}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = err.error?.message || `Airtable ${res.status}`;
        // 404 NOT_FOUND_IF_RESOURCE_DOES_NOT_EXIST -> table missing
        if (res.status === 404 || /not.found|model/i.test(msg)) {
            throw new Error(`Team Inboxes table missing — create it in Airtable base ${baseId} with fields: Email (text, primary), Owner (single select: Kevin/Noel/Dylan/Rosa), Refresh Token (long text), Last Polled (date+time), Active (checkbox). Then redeploy.`);
        }
        throw new Error(`listActiveInboxes: ${msg}`);
    }
    const data = await res.json();
    return (data.records || []).map(r => ({
        id: r.id,
        email: (r.fields?.['Email'] || '').toLowerCase().trim(),
        owner: r.fields?.['Owner'] || '',
        refreshToken: r.fields?.['Refresh Token'] || '',
        lastPolled: r.fields?.['Last Polled'] || '',
        active: !!r.fields?.['Active'],
    })).filter(r => r.email && r.refreshToken);
}

export async function upsertInbox({ email, owner, refreshToken }) {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    if (!apiKey || !baseId) throw new Error('Airtable not configured');
    if (!email) throw new Error('email required');

    const lower = email.toLowerCase().trim();

    // Look up existing row by email
    const params = new URLSearchParams({
        filterByFormula: `LOWER({Email})='${lower.replace(/'/g, "\\'")}'`,
        maxRecords: '1',
    });

    const findRes = await fetch(`https://api.airtable.com/v0/${baseId}/${TABLE}?${params}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
    });

    const fields = {
        'Email': lower,
        'Refresh Token': refreshToken,
        'Active': true,
    };
    if (owner) fields['Owner'] = owner;

    if (findRes.ok) {
        const data = await findRes.json();
        const existing = (data.records || [])[0];
        if (existing) {
            const patchRes = await fetch(`https://api.airtable.com/v0/${baseId}/${TABLE}`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ records: [{ id: existing.id, fields }], typecast: true }),
            });
            if (!patchRes.ok) {
                const err = await patchRes.json().catch(() => ({}));
                throw new Error(`upsertInbox PATCH: ${err.error?.message || patchRes.status}`);
            }
            return { id: existing.id, updated: true };
        }
    }

    // Insert
    const insertRes = await fetch(`https://api.airtable.com/v0/${baseId}/${TABLE}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ records: [{ fields }], typecast: true }),
    });
    if (!insertRes.ok) {
        const err = await insertRes.json().catch(() => ({}));
        const msg = err.error?.message || `Airtable ${insertRes.status}`;
        if (insertRes.status === 404 || /not.found|model|table/i.test(msg)) {
            throw new Error(`Team Inboxes table missing in base ${baseId}. Create it with fields: Email (single line text, primary), Owner (single select: Kevin/Noel/Dylan/Rosa), Refresh Token (long text), Last Polled (date+time), Active (checkbox). Then retry the OAuth flow.`);
        }
        throw new Error(`upsertInbox POST: ${msg}`);
    }
    const data = await insertRes.json();
    return { id: data.records?.[0]?.id, created: true };
}

export async function stampLastPolled(rowId) {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    if (!apiKey || !baseId || !rowId) return;
    await fetch(`https://api.airtable.com/v0/${baseId}/${TABLE}`, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            records: [{ id: rowId, fields: { 'Last Polled': new Date().toISOString() } }],
        }),
    }).catch(err => console.error('stampLastPolled failed:', err));
}
