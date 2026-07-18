#!/usr/bin/env node
// scripts/audit-alerts-local.mjs — local one-shot verifier for the shared
// search module. No HTTP layer. Reads Airtable + Bridge directly, prints the
// per-lead audit so we can confirm Luis Rodriguez's failure mode before deploy.
//
// Usage:
//   node scripts/audit-alerts-local.mjs                  # all active leads
//   node scripts/audit-alerts-local.mjs --only-zero      # only zero-result leads
//   node scripts/audit-alerts-local.mjs --lead recXXX    # one lead by id
//   node scripts/audit-alerts-local.mjs --name luis      # search by name fragment
//
// Env: reads .env.production (canonical) then .env.local (override). Needs
// AIRTABLE_API_KEY, AIRTABLE_BASE_ID, BRIDGE_API_TOKEN.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchListingsForLead, explainDroppedBy } from '../lib/alert-search.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function loadEnv(filePath) {
    if (!fs.existsSync(filePath)) return;
    for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (!m) continue;
        let v = m[2].trim();
        if (/^"(.*)"$/.test(v) || /^'(.*)'$/.test(v)) v = v.slice(1, -1);
        if (!process.env[m[1]]) process.env[m[1]] = v;
    }
}
loadEnv(path.join(projectRoot, '.env.production'));
loadEnv(path.join(projectRoot, '.env.local'));

const args = process.argv.slice(2);
const onlyZero = args.includes('--only-zero');
const leadIdx = args.indexOf('--lead');
const leadIdArg = leadIdx >= 0 ? args[leadIdx + 1] : null;
const nameIdx = args.indexOf('--name');
const nameArg = nameIdx >= 0 ? args[nameIdx + 1].toLowerCase() : null;

const apiKey = process.env.AIRTABLE_API_KEY;
const baseId = process.env.AIRTABLE_BASE_ID;
const bridge = process.env.BRIDGE_API_TOKEN;
if (!apiKey || !baseId || !bridge) {
    console.error('Missing env: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, BRIDGE_API_TOKEN');
    process.exit(1);
}
const headers = { Authorization: `Bearer ${apiKey}` };

async function fetchLeads() {
    if (leadIdArg) {
        const res = await fetch(`https://api.airtable.com/v0/${baseId}/Leads/${leadIdArg}`, { headers });
        if (!res.ok) throw new Error(`Airtable ${res.status}`);
        return [await res.json()];
    }
    const all = [];
    let offset = null;
    const params = new URLSearchParams({
        filterByFormula: '{Alert Active}=TRUE()',
        pageSize: '100',
    });
    for (let p = 0; p < 10; p++) {
        if (offset) params.set('offset', offset); else params.delete('offset');
        const res = await fetch(`https://api.airtable.com/v0/${baseId}/Leads?${params}`, { headers });
        if (!res.ok) throw new Error(`Airtable list ${res.status}`);
        const data = await res.json();
        all.push(...(data.records || []));
        if (!data.offset) break;
        offset = data.offset;
    }
    return all;
}

function fmt(n) { return String(n ?? '').padStart(4, ' '); }

(async () => {
    const records = await fetchLeads();
    console.log(`Loaded ${records.length} active-alert leads (or 1 by id).`);

    const filtered = nameArg
        ? records.filter(r => {
              const f = r.fields || {};
              const name = `${f['First Name'] || ''} ${f['Last Name'] || ''} ${f['Name'] || ''}`.toLowerCase();
              return name.includes(nameArg);
          })
        : records;
    console.log(`Auditing ${filtered.length} lead(s)…\n`);

    const rows = [];
    for (const record of filtered) {
        const f = record.fields || {};
        const lead = {
            id:        record.id,
            firstName: f['First Name'] || '',
            email:     (f['Email'] || '').trim(),
            cities:    f['Alert Cities'] || '',
            types:     f['Alert Property Types'] || [],
            priceMin:  f['Alert Price Min'] || 0,
            priceMax:  f['Alert Price Max'] || 0,
            bedsMin:   f['Alert Beds Min'] || 0,
            bathsMin:  f['Alert Baths Min'] || 0,
            count:     f['Alert Count'] || 5,
            polygon:   f['Alert Polygon'] || '',
            profiles:  f['Alert Profiles'] || '',
        };
        let result;
        try {
            result = await searchListingsForLead(bridge, lead, { skipShuffle: true });
        } catch (err) {
            rows.push({ id: record.id, name: f['Name'] || '(unnamed)', finalCount: 0, droppedBy: 'error', reason: err.message });
            continue;
        }
        const reason = explainDroppedBy(result.debug.droppedBy, result.debug);
        rows.push({
            id: record.id,
            name: f['Name'] || `${f['First Name'] || ''} ${f['Last Name'] || ''}`.trim() || '(unnamed)',
            email: lead.email,
            cities: lead.cities || '(none)',
            types: (lead.types || []).join('|') || '(none)',
            price: `$${lead.priceMin}-$${lead.priceMax}`,
            polygon: lead.polygon ? 'Y' : 'N',
            multiProfile: lead.profiles ? 'Y' : 'N',
            lastSent: f['Alert Last Sent'] || '(never)',
            zeroRuns: f['Alert Zero Runs'] || 0,
            finalCount: result.debug.finalCount,
            droppedBy: result.debug.droppedBy || '-',
            reason,
            perProfile: result.debug.perProfile,
        });
    }

    const display = onlyZero ? rows.filter(r => r.finalCount === 0) : rows;
    display.sort((a, b) => a.finalCount - b.finalCount);

    console.log('Lead'.padEnd(28), 'Final', 'Drop', 'LastSent  ', '0Runs', 'Filters');
    console.log('-'.repeat(110));
    for (const r of display) {
        const left = (r.name || '').slice(0, 26).padEnd(28);
        const filters = `${r.types}; ${r.price}; cities=${r.cities}; poly=${r.polygon}; multi=${r.multiProfile}`;
        console.log(left, fmt(r.finalCount), (r.droppedBy || '-').padEnd(8), (r.lastSent || '').padEnd(10), fmt(r.zeroRuns), filters.slice(0, 65));
    }

    if (leadIdArg || nameArg) {
        console.log('\n=== Per-profile detail ===');
        for (const r of display) {
            console.log(`\n${r.name} (${r.id})`);
            console.log(`  reason: ${r.reason}`);
            console.log(`  profiles (${r.perProfile.length}):`);
            for (const p of r.perProfile) {
                console.log(`   - "${p.name}": raw=${p.rawBridge} → feature=${p.afterFeature} → kw=${p.afterKeyword} → poly=${p.afterPolygon} | droppedBy=${p.droppedBy} | requests=${p.bridgeRequests} | unmappedTypes=${JSON.stringify(p.unmappedTypes)} | polyValid=${p.polygonValid}`);
            }
        }
    }

    const zero = rows.filter(r => r.finalCount === 0).length;
    console.log(`\nSummary: ${rows.length} audited, ${zero} returning 0 listings.`);
})().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
});
