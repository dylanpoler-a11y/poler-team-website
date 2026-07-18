#!/usr/bin/env node
// scripts/dupe-check.mjs — VERIFY duplicate-property bug in alert emails.
// Runs the real search for active-alert leads and reports:
//   (A) exact duplicate ListingId in the final (post-dedup) set  [should be 0]
//   (B) duplicate normalized ADDRESS with DIFFERENT ListingIds   [relisting bug]
// Read-only. No emails sent.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchListingsForLead } from '../lib/alert-search.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
function loadEnv(fp){ if(!fs.existsSync(fp))return; for(const line of fs.readFileSync(fp,'utf8').split('\n')){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(!m)continue;let v=m[2].trim();if(/^["'].*["']$/.test(v))v=v.slice(1,-1);if(!process.env[m[1]])process.env[m[1]]=v;}}
loadEnv(path.join(root,'.env.production')); loadEnv(path.join(root,'.env.local'));

const apiKey=process.env.AIRTABLE_API_KEY, baseId=process.env.AIRTABLE_BASE_ID, bridge=process.env.BRIDGE_API_TOKEN;
const headers={Authorization:`Bearer ${apiKey}`};

// Keep the unit number — only normalize punctuation/casing/whitespace so two
// DIFFERENT units in the same tower stay distinct. True dupe = identical full address.
function normAddr(s){return String(s||'').toLowerCase().replace(/[.,]/g,' ').replace(/#/g,' unit ').replace(/\bapt\b|\bste\b|\bsuite\b/g,'unit').replace(/\bunit\s+unit\b/g,'unit').replace(/\s+/g,' ').trim();}

const all=[]; let offset=null;
const params=new URLSearchParams({filterByFormula:'{Alert Active}=TRUE()',pageSize:'100'});
for(let p=0;p<10;p++){ if(offset)params.set('offset',offset);
  const res=await fetch(`https://api.airtable.com/v0/${baseId}/Leads?${params}`,{headers});
  if(!res.ok){console.error('Airtable',res.status);break;}
  const d=await res.json(); all.push(...(d.records||[])); if(!d.offset)break; offset=d.offset; }
console.log(`Active-alert leads: ${all.length}\n`);

let leadsWithExactDupe=0, leadsWithAddrDupe=0, examined=0;
for(const rec of all){
  const f=rec.fields||{};
  const lead={id:rec.id,firstName:f['First Name']||'',email:(f['Email']||'').trim(),
    cities:f['Alert Cities']||'',types:f['Alert Property Types']||[],
    priceMin:f['Alert Price Min']||0,priceMax:f['Alert Price Max']||0,
    bedsMin:f['Alert Beds Min']||0,bathsMin:f['Alert Baths Min']||0,
    count:f['Alert Count']||5,polygon:f['Alert Polygon']||'',profiles:f['Alert Profiles']||''};
  let r; try{ r=await searchListingsForLead(bridge,lead,{skipShuffle:true,capCount:false}); }catch(e){continue;}
  const L=r.listings; if(!L.length)continue; examined++;
  // What the lead would actually receive (capped to count) — check dupes in THAT slice too
  const idCount={}, addrMap={};
  for(const l of L){
    idCount[l.ListingId]=(idCount[l.ListingId]||0)+1;
    const a=normAddr(l.UnparsedAddress);
    if(a){(addrMap[a]=addrMap[a]||new Set()).add(l.ListingId);}
  }
  const exactDupes=Object.entries(idCount).filter(([,n])=>n>1);
  const addrDupes=Object.entries(addrMap).filter(([,ids])=>ids.size>1);
  if(exactDupes.length){leadsWithExactDupe++;
    console.log(`❌ EXACT DUPE  ${f['Name']||lead.email} → ${exactDupes.map(([id,n])=>`${id}×${n}`).join(', ')}`);}
  if(addrDupes.length){leadsWithAddrDupe++;
    console.log(`⚠️  ADDR DUPE   ${f['Name']||lead.email}`);
    for(const [a,ids] of addrDupes) console.log(`        "${a}" → MLS# ${[...ids].join(' , ')}`);}
}
console.log(`\n── RESULT ──`);
console.log(`Leads with matches examined: ${examined}`);
console.log(`(A) exact ListingId dupes in final set: ${leadsWithExactDupe} leads`);
console.log(`(B) same-address / different-MLS# dupes: ${leadsWithAddrDupe} leads`);
