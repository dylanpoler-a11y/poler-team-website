/**
 * lib/crm-contacts.js — cached lookup of CRM contact emails.
 *
 * Merges Leads + Consulting Contacts + Consulting Clients (companies with an email
 * field set) into a single email→record index. Cache TTL: 5 minutes per Edge instance.
 *
 * Each lookup returns:
 *   {
 *     recordType: 'lead' | 'consulting-contact' | 'consulting-company',
 *     recordId, recordName,
 *     currentStatus?, companyId?, companyName?,
 *     lastTouchedAt
 *   }
 *
 * If the same email is on multiple records, the most-recently-touched wins.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = { at: 0, map: null };

export async function getEmailIndex() {
    const now = Date.now();
    if (cache.map && now - cache.at < CACHE_TTL_MS) return cache.map;

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    if (!apiKey || !baseId) throw new Error('Airtable not configured');

    const [leads, contacts, companies] = await Promise.all([
        fetchAll(apiKey, baseId, 'Leads', ['Email', 'Name', 'First Name', 'Last Name', 'Status', 'Created At']),
        fetchAll(apiKey, baseId, 'Consulting%20Contacts', ['Email', 'Name', 'Company']),
        fetchAll(apiKey, baseId, 'Consulting%20Clients', ['Name', 'Company', 'Email']),
    ]);

    const companyNameById = new Map();
    for (const c of companies) {
        const nm = c.fields?.['Company'] || c.fields?.['Name'] || '';
        companyNameById.set(c.id, nm);
    }

    const map = new Map();

    for (const r of leads) {
        const email = (r.fields?.['Email'] || '').toLowerCase().trim();
        if (!email) continue;
        const lastTouchedAt = parseTime(r.fields?.['Created At']) || parseTime(r.createdTime) || 0;
        const entry = {
            recordType: 'lead',
            recordId: r.id,
            recordName: r.fields?.['Name'] || [r.fields?.['First Name'], r.fields?.['Last Name']].filter(Boolean).join(' ') || email,
            currentStatus: r.fields?.['Status'] || '',
            lastTouchedAt,
        };
        const existing = map.get(email);
        if (!existing || entry.lastTouchedAt > existing.lastTouchedAt) map.set(email, entry);
    }

    for (const c of contacts) {
        const email = (c.fields?.['Email'] || '').toLowerCase().trim();
        if (!email) continue;
        const companyId = (c.fields?.['Company'] || [])[0] || '';
        const lastTouchedAt = parseTime(c.createdTime) || 0;
        const entry = {
            recordType: 'consulting-contact',
            recordId: c.id,
            recordName: c.fields?.['Name'] || email,
            companyId,
            companyName: companyNameById.get(companyId) || '',
            lastTouchedAt,
        };
        const existing = map.get(email);
        if (!existing || entry.lastTouchedAt > existing.lastTouchedAt) map.set(email, entry);
    }

    // Companies with a primary email — treat the company itself as the match
    // (writes go to Company.Notes + Consulting Activity, no contact required)
    for (const c of companies) {
        const email = (c.fields?.['Email'] || '').toLowerCase().trim();
        if (!email) continue;
        const lastTouchedAt = parseTime(c.createdTime) || 0;
        const companyName = c.fields?.['Company'] || c.fields?.['Name'] || '';
        const entry = {
            recordType: 'consulting-contact', // Treat same way for the writer
            recordId: c.id,                    // …but recordId IS the company
            recordName: companyName,
            companyId: c.id,
            companyName,
            lastTouchedAt,
            companyDirect: true,               // flag for debugging
        };
        const existing = map.get(email);
        if (!existing || entry.lastTouchedAt > existing.lastTouchedAt) map.set(email, entry);
    }

    cache = { at: now, map };
    return map;
}

export function invalidateCache() {
    cache = { at: 0, map: null };
}

async function fetchAll(apiKey, baseId, table, fields) {
    const all = [];
    let offset = null;
    for (let page = 0; page < 20; page++) {
        const params = new URLSearchParams({ pageSize: '100' });
        for (const f of fields) params.append('fields[]', f);
        if (offset) params.set('offset', offset);

        const res = await fetch(`https://api.airtable.com/v0/${baseId}/${table}?${params}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) {
            console.error(`fetchAll ${table} failed: ${res.status}`);
            return all;
        }
        const data = await res.json();
        all.push(...(data.records || []));
        if (!data.offset) break;
        offset = data.offset;
    }
    return all;
}

function parseTime(s) {
    if (!s) return 0;
    const t = Date.parse(s);
    return isNaN(t) ? 0 : t;
}
