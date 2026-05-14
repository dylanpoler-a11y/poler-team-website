/**
 * /api/migrate-consulting-v3.js — Vercel Edge Function
 * One-time v3 migration:
 *  1. Map legacy Company.Status values (Active/On Hold/etc) to new (Lead/Active Client/Dormant/Closed Lost)
 *  2. Map legacy Deal.Stage values (Prospect/Diagnostic/etc) to new (Pitching/Active/etc)
 *  3. Country fixes: Solution Malls → Argentina, Grupo Giordano → Chile
 *  4. Auto-create one Contact per Company that has Primary Contact / Email / Phone data
 *  5. Rename "Royal & Dream Inn (Mitch Rodriguez)" → "MR9 Holdings", split its single
 *     auto-migrated Deal into TWO: "Royal South Beach Acquisition" + "Dream Inn STR Portfolio"
 *
 * Idempotent: skips work that's already been done. Safe to re-run.
 *
 * Query: password=$CRM_PASSWORD
 *
 * Returns counts of what was migrated.
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';

// Status mapping: old → new
const STATUS_MAP = {
    'New':         'Lead',
    'Active':      'Active Client',
    'On Hold':     'Dormant',
    'Completed':   'Active Client',  // closed-out work but still a relationship
    'Closed Lost': 'Closed Lost',
    'Lead':        'Lead',
    'Active Client': 'Active Client',
    'Dormant':     'Dormant',
};

// Stage mapping: old → new
const STAGE_MAP = {
    'Prospect':          'Pitching',
    'Intro':             'Pitching',
    'Negotiation':       'Proposal Sent',
    'Engagement Signed': 'Signed',
    'Pre-Diagnostic':    'Active',
    'Diagnostic':        'Active',
    'Implementation':    'Active',
    'Won':               'Completed',
    'Lost':              'Closed Lost',
    'Pitching':          'Pitching',
    'Proposal Sent':     'Proposal Sent',
    'Verbal Commitment': 'Verbal Commitment',
    'Signed':            'Signed',
    'Active':            'Active',
    'Completed':         'Completed',
};

const COUNTRY_FIXES = {
    'Solution Malls':   'Argentina',
    'Grupo Giordano':   'Chile',
};

export default async function handler(req) {
    const apiKey  = process.env.AIRTABLE_API_KEY;
    const baseId  = process.env.AIRTABLE_BASE_ID;
    const crmPass = process.env.CRM_PASSWORD;

    const url = new URL(req.url);
    const password = url.searchParams.get('password');
    if (!authorize(req, null).ok) return json({ error: 'Unauthorized' }, 401);
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);

    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    const result = {
        companiesUpdated: 0,
        dealsUpdated:     0,
        contactsCreated:  0,
        countryFixes:     0,
        mr9Renamed:       false,
        mr9DealsCreated:  0,
        errors:           [],
    };

    // 1. Pull all Companies
    const compsRes = await fetch(
        `https://api.airtable.com/v0/${baseId}/Consulting%20Clients?pageSize=100`,
        { headers }
    );
    if (!compsRes.ok) return json({ error: 'Failed to fetch companies' }, 500);
    const comps = (await compsRes.json()).records || [];

    // 2. Pull existing contacts to skip companies that already have one
    const contactsRes = await fetch(
        `https://api.airtable.com/v0/${baseId}/Consulting%20Contacts?pageSize=100&fields%5B%5D=Company`,
        { headers }
    );
    const existingContacts = contactsRes.ok ? (await contactsRes.json()).records || [] : [];
    const companiesWithContact = new Set(
        existingContacts.flatMap(r => (r.fields?.Company || []))
    );

    // 3. Migrate each Company
    for (const comp of comps) {
        const company = comp.fields?.['Company'] || '';
        const oldStatus = comp.fields?.['Status'] || '';
        const newStatus = STATUS_MAP[oldStatus] || 'Lead';
        const country = comp.fields?.['Country'] || '';

        const updates = {};
        if (oldStatus !== newStatus) updates['Status'] = newStatus;
        if (COUNTRY_FIXES[company] && country !== COUNTRY_FIXES[company]) {
            updates['Country'] = COUNTRY_FIXES[company];
            result.countryFixes++;
        }

        if (Object.keys(updates).length > 0) {
            const r = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Clients`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({
                    records: [{ id: comp.id, fields: updates }],
                    typecast: true,
                }),
            });
            if (!r.ok) {
                const e = await r.json().catch(() => ({}));
                result.errors.push({ stage: 'company-update', companyId: comp.id, error: e.error?.message || 'unknown' });
            } else {
                result.companiesUpdated++;
            }
        }

        // Auto-create Contact if Company has Primary Contact or Email or Phone, and no existing Contact
        const primaryName = comp.fields?.['Primary Contact'] || '';
        const email       = comp.fields?.['Email'] || '';
        const phone       = comp.fields?.['Phone'] || '';
        if (
            (primaryName || email || phone) &&
            !companiesWithContact.has(comp.id)
        ) {
            const contactFields = {
                'Name':    primaryName || (email ? email.split('@')[0] : 'Primary Contact'),
                'Company': [comp.id],
                'Primary': true,
            };
            if (email) contactFields['Email'] = email;
            if (phone) contactFields['Phone'] = phone;
            const r = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Contacts`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ records: [{ fields: contactFields }], typecast: true }),
            });
            if (!r.ok) {
                const e = await r.json().catch(() => ({}));
                result.errors.push({ stage: 'contact-create', companyId: comp.id, error: e.error?.message || 'unknown' });
            } else {
                result.contactsCreated++;
            }
        }
    }

    // 4. Migrate Deal stages
    const dealsRes = await fetch(
        `https://api.airtable.com/v0/${baseId}/Consulting%20Deals?pageSize=100`,
        { headers }
    );
    if (!dealsRes.ok) {
        result.errors.push({ stage: 'fetch-deals', error: 'failed' });
        return json(result);
    }
    const deals = (await dealsRes.json()).records || [];

    for (const deal of deals) {
        const oldStage = deal.fields?.['Stage'] || '';
        const newStage = STAGE_MAP[oldStage] || oldStage;
        if (oldStage && oldStage !== newStage) {
            const r = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Deals`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({
                    records: [{ id: deal.id, fields: { 'Stage': newStage } }],
                    typecast: true,
                }),
            });
            if (!r.ok) {
                const e = await r.json().catch(() => ({}));
                result.errors.push({ stage: 'deal-update', dealId: deal.id, error: e.error?.message || 'unknown' });
            } else {
                result.dealsUpdated++;
            }
        }
    }

    // 5. MR9 Holdings split
    const mr9Co = comps.find(c =>
        (c.fields?.['Company'] || '').toLowerCase().includes('royal') &&
        (c.fields?.['Company'] || '').toLowerCase().includes('dream')
    );
    if (mr9Co) {
        const currentName = mr9Co.fields?.['Company'] || '';
        if (currentName !== 'MR9 Holdings') {
            // Rename
            const r = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Clients`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({
                    records: [{ id: mr9Co.id, fields: { 'Company': 'MR9 Holdings' } }],
                }),
            });
            if (r.ok) {
                result.mr9Renamed = true;
            } else {
                const e = await r.json().catch(() => ({}));
                result.errors.push({ stage: 'mr9-rename', error: e.error?.message || 'unknown' });
            }

            // Split deal: find the one auto-migrated deal under this company
            const mr9Deals = deals.filter(d =>
                ((d.fields?.['Company'] || [])[0]) === mr9Co.id
            );
            const expectedNames = ['Royal South Beach Acquisition', 'Dream Inn STR Portfolio'];
            const alreadyHas = expectedNames.every(n =>
                mr9Deals.some(d => d.fields?.['Deal Name'] === n)
            );

            if (!alreadyHas) {
                const today = new Date().toISOString().slice(0, 10);
                for (const newName of expectedNames) {
                    if (mr9Deals.some(d => d.fields?.['Deal Name'] === newName)) continue;
                    const r2 = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Deals`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                            records: [{
                                fields: {
                                    'Deal Name':        newName,
                                    'Company':          [mr9Co.id],
                                    'Stage':            'Pitching',
                                    'Stage Entered At': today,
                                    'Service Type':     ['Hotel Operations'],
                                },
                            }],
                            typecast: true,
                        }),
                    });
                    if (r2.ok) {
                        result.mr9DealsCreated++;
                    } else {
                        const e = await r2.json().catch(() => ({}));
                        result.errors.push({ stage: 'mr9-deal-create', name: newName, error: e.error?.message || 'unknown' });
                    }
                }

                // Mark the original auto-migrated deal as Closed Lost (replaced by the two new ones)
                const original = mr9Deals.find(d =>
                    !expectedNames.includes(d.fields?.['Deal Name'])
                );
                if (original) {
                    await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Deals`, {
                        method: 'PATCH',
                        headers,
                        body: JSON.stringify({
                            records: [{
                                id: original.id,
                                fields: {
                                    'Deal Name':   `${original.fields?.['Deal Name'] || 'Original'} (replaced by split)`,
                                    'Stage':       'Closed Lost',
                                    'Closed At':   today,
                                    'Description': 'Replaced by split: Royal South Beach Acquisition + Dream Inn STR Portfolio',
                                },
                            }],
                            typecast: true,
                        }),
                    }).catch(err => result.errors.push({ stage: 'mr9-original-close', error: err.message }));
                }
            }
        }
    }

    return json(result);
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
