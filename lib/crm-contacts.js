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

/**
 * For the team-discussion regex pre-filter + Sonnet prompt: returns the list
 * of REAL clients (Type=Client, excludes Partners). Partners (Conduit, tooling
 * vendors, etc.) are excluded because they're not the entity we're doing
 * work FOR — they're tools we use IN service of an actual client.
 *
 * Each entry: { id, name, type, emails: [] }.
 */
export async function getClientList() {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    if (!apiKey || !baseId) throw new Error('Airtable not configured');

    const [companies, contacts] = await Promise.all([
        fetchAll(apiKey, baseId, 'Consulting%20Clients', ['Name', 'Company', 'Email', 'Type']),
        fetchAll(apiKey, baseId, 'Consulting%20Contacts', ['Email', 'Name', 'Company']),
    ]);

    // Map companyId → contact emails
    const contactsByCompany = new Map();
    for (const c of contacts) {
        const email = (c.fields?.['Email'] || '').toLowerCase().trim();
        const companyId = (c.fields?.['Company'] || [])[0];
        if (!email || !companyId) continue;
        if (!contactsByCompany.has(companyId)) contactsByCompany.set(companyId, []);
        contactsByCompany.get(companyId).push(email);
    }

    return companies.map(c => {
        const name = c.fields?.['Company'] || c.fields?.['Name'] || '';
        const type = (c.fields?.['Type']?.name) || c.fields?.['Type'] || ''; // Airtable returns singleSelect as {name,id,color} or just a string
        const directEmail = (c.fields?.['Email'] || '').toLowerCase().trim();
        const contactEmails = contactsByCompany.get(c.id) || [];
        const emails = directEmail ? [directEmail, ...contactEmails] : contactEmails;
        return { id: c.id, name, type, emails: [...new Set(emails)] };
    }).filter(c => c.name && c.type !== 'Partner'); // exclude Partners
}

/**
 * Consulting Deals — used to enrich the team-discussion pre-filter (so a body
 * mentioning "Royal South Beach" or "Dream Inn" hits, even though those aren't
 * company names — they're deals under MR9 Holdings).
 *
 * Each entry: { id, name, companyId, companyName }.
 */
export async function getDealList() {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    if (!apiKey || !baseId) throw new Error('Airtable not configured');

    const [deals, companies] = await Promise.all([
        fetchAll(apiKey, baseId, 'Consulting%20Deals', ['Deal Name', 'Company', 'Stage']),
        fetchAll(apiKey, baseId, 'Consulting%20Clients', ['Name', 'Company']),
    ]);

    const companyNameById = new Map();
    for (const c of companies) {
        companyNameById.set(c.id, c.fields?.['Company'] || c.fields?.['Name'] || '');
    }

    return deals.map(d => ({
        id: d.id,
        name: d.fields?.['Deal Name'] || '',
        companyId: (d.fields?.['Company'] || [])[0] || '',
        companyName: companyNameById.get((d.fields?.['Company'] || [])[0] || '') || '',
        stage: d.fields?.['Stage']?.name || d.fields?.['Stage'] || '',
    })).filter(d => d.name && d.companyId);
}

/**
 * Cheap synchronous regex pre-filter: does the email body mention ANY known
 * client (by name or by contact email)? Used to gate the expensive Sonnet call
 * on internal team-discussion emails.
 *
 * Returns the list of matched client entries (may be empty).
 */
export function findClientMentions(plainText, clientList) {
    if (!plainText || !Array.isArray(clientList)) return [];
    const lc = plainText.toLowerCase();
    const matched = [];
    for (const c of clientList) {
        // Try the company name first (case-insensitive substring).
        // Skip very-short names (<= 3 chars) to avoid false positives like "Ten" matching "frequently".
        const nameLc = (c.name || '').toLowerCase();
        const nameHit = nameLc.length >= 4 && lc.includes(nameLc);
        // Then any contact email.
        const emailHit = c.emails.some(e => e && lc.includes(e.toLowerCase()));
        if (nameHit || emailHit) matched.push(c);
    }
    return matched;
}

/**
 * Also check deal names AND a hand-curated alias map (for project/listing
 * shorthand like "Royal", "Dream Inn", "Lauderdale" which don't match any
 * client or deal name verbatim but DO refer to known records).
 *
 * Returns matched deals (with companyId/companyName so callers can route writes
 * up to the parent company).
 */
export function findDealMentions(plainText, dealList) {
    if (!plainText || !Array.isArray(dealList)) return [];
    const lc = plainText.toLowerCase();
    const matched = new Map(); // dedupe by deal id

    // Strict: substring of full deal name (length >= 5 to avoid noise).
    for (const d of dealList) {
        const nameLc = (d.name || '').toLowerCase();
        if (nameLc.length >= 5 && lc.includes(nameLc)) matched.set(d.id, d);
    }

    // Loose alias map — project shorthand → match if the deal name contains the alias word.
    // Avoids hardcoding company-specific knowledge in the cron itself.
    const ALIASES = [
        'royal south beach', 'royal', 'dream inn', 'polly lux',
        'lauderdale boutique', 'the lauderdale', '505 se 16th',
    ];
    for (const alias of ALIASES) {
        if (!lc.includes(alias)) continue;
        for (const d of dealList) {
            const nameLc = (d.name || '').toLowerCase();
            if (nameLc.includes(alias.split(' ')[0])) matched.set(d.id, d);
        }
    }
    return [...matched.values()];
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
