// node tools/test-derive-profile.mjs — pure-function cases for lib/derive-profile.js
// and lib/alert-profile-fields.js (no network, no Airtable).
import assert from 'node:assert/strict';
import { deriveAutoProfile, parseSearchParams, describeProfile, sameCriteria, alertTypeFor } from '../lib/derive-profile.js';
import { computeAlertFields } from '../lib/alert-profile-fields.js';
import { parseAlertProfiles } from '../lib/alert-search.js';

let passed = 0;
const ok = (name) => { passed++; console.log(`  ok  ${name}`); };

const L = (id, City, ListPrice, PropertySubType, BedroomsTotal, PropertyType = 'Residential') =>
    [id, { ListingId: id, City, ListPrice, PropertySubType, BedroomsTotal, PropertyType }];
const listings = new Map([
    L('A1', 'Miami', 1_200_000, 'Single Family Residence', 4),
    L('A2', 'Doral', 950_000, 'Single Family Residence', 3),
    L('A3', 'Miami', 700_000, 'Condominium', 2),
    L('A4', 'Sunny Isles Beach', 2_400_000, 'Condominium', 3),
    L('B26028693', 'Miami', 2_950_000, 'Single Family Residence', 5),
    L('LND1', 'Homestead', 400_000, 'Unimproved Land', 0, 'Land/Boat Docks'),
]);

// (a) 3 listings, 2 cities → both cities, band spans them, types = set seen
{
    const r = deriveAutoProfile({ viewedIds: ['A1', 'A2', 'A3'], listings, timeline: '0-3 months' });
    assert.equal(r.basis, 'browsing');
    assert.deepEqual(r.profile.cities, ['Miami', 'Doral']);
    assert.equal(r.profile.priceMin, 595_000);      // 700k * .85 = 595k
    assert.equal(r.profile.priceMax, 1_375_000);    // 1.2M * 1.15 = 1.38M → 25k step → 1,375,000
    assert.deepEqual(r.profile.propertyTypes, ['Single Family', 'Condo']);
    assert.equal(r.profile.bedsMin, 1);             // min beds 2 - 1
    assert.equal(r.profile.frequency, 'Weekly');
    assert.equal(r.profile.count, 3);
    ok('browsing: 3 views / 2 cities');
}
// (b) 1 favorite + views → band/types from the favorite, cities from all
{
    const r = deriveAutoProfile({ viewedIds: ['A1', 'A2', 'A3'], favoriteIds: ['A4'], listings, timeline: '6-12 months' });
    assert.equal(r.basis, 'browsing');
    assert.equal(r.profile.cities[0], 'Miami');                     // most frequent first
    assert.ok(r.profile.cities.includes('Sunny Isles Beach'));
    assert.equal(r.profile.priceMin, 2_050_000);                    // 2.4M*.85=2.04M → 2,050,000
    assert.equal(r.profile.priceMax, 2_750_000);                    // 2.4M*1.15=2.76M → 2,750,000
    assert.deepEqual(r.profile.propertyTypes, ['Condo']);
    assert.equal(r.profile.bedsMin, 2);
    assert.equal(r.profile.frequency, 'Bi-Weekly');
    ok('browsing: favorite dominates');
}
// (c) only the ad listing → signup basis, 70–120%
{
    const r = deriveAutoProfile({ viewedIds: ['B26028693'], sourceMls: 'B26028693', listings, timeline: '12+ months' });
    assert.equal(r.basis, 'signup');
    assert.deepEqual(r.profile.cities, ['Miami']);
    assert.equal(r.profile.priceMin, 2_075_000);   // 2.95M*.7=2.065M → 2,075,000
    assert.equal(r.profile.priceMax, 3_550_000);   // 2.95M*1.2=3.54M → 3,550,000
    assert.deepEqual(r.profile.propertyTypes, ['Single Family']);
    assert.equal(r.profile.bedsMin, 4);
    assert.equal(r.profile.frequency, 'Monthly');
    ok('signup basis from the ad listing');
}
// (d) search overrides: Ricardo-style $1M+ single family/townhouse search
{
    const s = parseSearchParams(JSON.stringify({ params: { limit: 50, StandardStatus: 'Active', PropertyType: 'Residential', 'PropertySubType.in': 'Single Family Residence,Townhouse', 'ListPrice.gte': 1000000, _cities: ['Coral Gables'] }, resultCount: 50 }));
    assert.deepEqual(s, { cities: ['Coral Gables'], priceMin: 1_000_000, types: ['Single Family', 'Townhouse'] });
    const r = deriveAutoProfile({ viewedIds: ['A3'], searches: [s], listings, timeline: '' });
    assert.equal(r.basis, 'browsing');
    assert.equal(r.profile.priceMin, 1_000_000);
    assert.equal(r.profile.priceMax, 0);           // view ceiling (805k) < search floor → open
    assert.deepEqual(r.profile.propertyTypes, ['Single Family', 'Townhouse']);
    assert.ok(r.profile.cities.includes('Coral Gables') && r.profile.cities.includes('Miami'));
    ok('search filters override inferred price/types');
}
// (e) nothing usable → null
{
    assert.equal(deriveAutoProfile({ viewedIds: ['ZZZ'], listings }), null);
    assert.equal(deriveAutoProfile({ listings }), null);
    ok('no signal → null');
}
// (f) land + type map
{
    assert.equal(alertTypeFor(listings.get('LND1')), 'Land');
    assert.equal(alertTypeFor({ PropertySubType: 'Villa' }), 'Townhouse');
    assert.equal(alertTypeFor({ PropertySubType: 'Duplex' }), 'Multi Family');
    ok('type map');
}
// (g) describe + sameCriteria
{
    const p = { cities: ['Miami', 'Doral'], priceMin: 595_000, priceMax: 1_375_000, bedsMin: 1, propertyTypes: ['Single Family', 'Condo'] };
    assert.equal(describeProfile(p), 'Miami, Doral · $595k–$1.38M · 1+ hab · Single Family, Condo');
    assert.ok(sameCriteria(p, { cities: 'Doral, Miami', priceMin: 595000, priceMax: 1375000, bedsMin: 1, types: ['Condo', 'Single Family'] }));
    assert.ok(!sameCriteria(p, { ...p, priceMax: 1_400_000 }));
    ok('describeProfile / sameCriteria');
}
// (h) computeAlertFields: autoMeta on a flat-only lead synthesizes profile #1 with meta
{
    const meta = { auto: true, autoBasis: 'browsing', autoSources: ['A1'], autoConfirmed: false, autoUpdatedAt: '2026-09-16T00:00:00.000Z' };
    const f = computeAlertFields({ active: true, cities: ['Miami'], priceMin: 1, priceMax: 2, bedsMin: 1, propertyTypes: ['Condo'], frequency: 'Weekly', count: 3, autoMeta: meta }, {});
    assert.equal(f['Alert Active'], true);
    assert.equal(f['Alert Cities'], 'Miami');
    assert.equal(f['Alert Frequency'], 'Weekly');
    const w = parseAlertProfiles(f['Alert Profiles']);
    assert.equal(w.profiles.length, 1);
    assert.equal(w.profiles[0].auto, true);
    assert.equal(w.profiles[0].autoBasis, 'browsing');
    assert.equal(w.profiles[0].cities, 'Miami');
    assert.deepEqual(w.profiles[0].types, ['Condo']);
    ok('computeAlertFields: autoMeta synthesizes wrapper');
}
// (i) autoProfileConfirm flips profile #1, keeps criteria, leaves profile #2 alone
{
    const cur = { 'Alert Profiles': JSON.stringify([{ types: ['Condo'], cities: 'Miami', priceMin: 1, priceMax: 2, auto: true, autoConfirmed: false }, { types: ['Land'], cities: 'Homestead' }]) };
    const f = computeAlertFields({ autoProfileConfirm: true }, cur);
    const w = parseAlertProfiles(f['Alert Profiles']);
    assert.equal(w.profiles[0].auto, false);
    assert.equal(w.profiles[0].autoConfirmed, true);
    assert.ok(w.profiles[0].autoConfirmedAt);
    assert.equal(w.profiles[0].cities, 'Miami');
    assert.deepEqual(w.profiles[1], { types: ['Land'], cities: 'Homestead' });
    assert.equal(f['Alert Active'], undefined);
    ok('autoProfileConfirm');
}
// (j) autoProfileConfirm on a lead with no wrapper → no wrapper written
{
    const f = computeAlertFields({ autoProfileConfirm: true }, {});
    assert.deepEqual(f, {});
    ok('autoProfileConfirm without profile is a no-op');
}
// (k) legacy behaviors preserved: profiles[] replaces; features fold; flat criteria merge into #1
{
    const cur = { 'Alert Profiles': JSON.stringify({ channels: { email: true, whatsapp: true }, profiles: [{ types: ['Condo'], cities: 'Miami', priceMax: 500000, auto: true }] }) };
    let f = computeAlertFields({ priceMax: 600000, features: ['pool'] }, cur);
    let w = parseAlertProfiles(f['Alert Profiles']);
    assert.equal(w.profiles[0].priceMax, 600000);
    assert.deepEqual(w.profiles[0].features, ['pool']);
    assert.equal(w.profiles[0].auto, false);         // 2026-09-16 PM: a human criteria write clears the site-derived flag (lib/qualified-lead.js)
    assert.equal(w.profiles[0].setBy, 'human');
    assert.equal(w.channels.whatsapp, true);
    f = computeAlertFields({ profiles: [{ types: ['Land'], cities: 'Homestead' }] }, cur);
    w = parseAlertProfiles(f['Alert Profiles']);
    assert.deepEqual(w.profiles, [{ types: ['Land'], cities: 'Homestead' }]);
    f = computeAlertFields({ profiles: [] }, cur);
    assert.ok('Alert Profiles' in f);                 // explicit clear still writes
    ok('legacy update-alerts folding preserved');
}

// (l) many heterogeneous views → IQR price core, singleton cities/types dropped, cities capped at 4
{
    const many = new Map([
        L('M1', 'Miami', 300_000, 'Condominium', 1),
        L('M2', 'Miami', 800_000, 'Condominium', 2),
        L('M3', 'Doral', 900_000, 'Single Family Residence', 3),
        L('M4', 'Doral', 1_000_000, 'Single Family Residence', 4),
        L('M5', 'Miami', 1_100_000, 'Single Family Residence', 3),
        L('M6', 'Aventura', 1_200_000, 'Condominium', 2),
        L('M7', 'Aventura', 1_300_000, 'Condominium', 3),
        L('M8', 'Jupiter', 50_000_000, 'Single Family Residence', 8),
        L('M9', 'Boca Raton', 2_000_000, 'Townhouse', 3),
    ]);
    const r = deriveAutoProfile({ viewedIds: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9'], listings: many, timeline: '' });
    assert.deepEqual(r.profile.cities, ['Miami', 'Doral', 'Aventura']);        // Jupiter + Boca seen once → dropped
    assert.deepEqual(r.profile.propertyTypes, ['Condo', 'Single Family']);     // Townhouse once → dropped
    assert.ok(r.profile.priceMin >= 700_000 && r.profile.priceMin <= 800_000, `min ${r.profile.priceMin}`);   // Q1 900k*.85
    assert.ok(r.profile.priceMax >= 1_400_000 && r.profile.priceMax <= 1_600_000, `max ${r.profile.priceMax}`); // Q3 1.3M*1.15
    assert.equal(r.profile.bedsMin, 0);                                         // min beds 1 - 1
    ok('IQR band + singleton drop on heterogeneous browsing');
}
// (m) floor-only search with views above the floor → ceiling at least 1.5× the floor
{
    const r = deriveAutoProfile({ viewedIds: ['A1', 'A2'], searches: [{ priceMin: 1_000_000 }], listings, timeline: '' });
    assert.equal(r.profile.priceMin, 1_000_000);
    assert.equal(r.profile.priceMax, 1_500_000);      // views cap at 1.38M < 1.5M floor headroom
    ok('floor-only search keeps 1.5× headroom');
}

console.log(`\n${passed} passed`);
