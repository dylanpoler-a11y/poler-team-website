// node tools/test-qualified-lead.mjs — pure-function tests for lib/qualified-lead.js,
// lib/lead-quality.js and the human-set rule in lib/alert-profile-fields.js.
import assert from 'node:assert/strict';
import { profileQualifies, alreadyQualified, stampQualified, markHumanSet, isUnconfirmedAutoProfile } from '../lib/qualified-lead.js';
import { leadQualifies, timelineQualifies, timelineIsNearTerm } from '../lib/lead-quality.js';
import { computeAlertFields } from '../lib/alert-profile-fields.js';

const ok = { ok: true };
let n = 0; const t = (name, fn) => { fn(); n++; console.log('  ✓', name); };

console.log('lead-quality (Lead gate)');
t('valid phone + 12+ months fires Lead (revert)', () => assert.equal(leadQualifies({ phoneQuality: ok, timeline: '12+ months' }), true));
t('valid phone + 0-3 months fires Lead', () => assert.equal(leadQualifies({ phoneQuality: ok, timeline: '0-3 months' }), true));
t('valid phone + blank timeline fires Lead', () => assert.equal(leadQualifies({ phoneQuality: ok, timeline: '' }), true));
t('"Just exploring" never fires Lead', () => assert.equal(leadQualifies({ phoneQuality: ok, timeline: 'Just exploring' }), false));
t('junk phone never fires Lead', () => assert.equal(leadQualifies({ phoneQuality: { ok: false }, timeline: '0-3 months' }), false));
t('timelineIsNearTerm is 0-12 only', () => { assert.equal(timelineIsNearTerm('6-12 months'), true); assert.equal(timelineIsNearTerm('12+ months'), false); });
t('timelineQualifies only rejects exploring', () => { assert.equal(timelineQualifies('12+ months'), true); assert.equal(timelineQualifies('just exploring'), false); });

console.log('qualified-lead');
const auto = JSON.stringify([{ types: ['Single Family'], cities: 'North Miami Beach', priceMin: 2450000, priceMax: 4200000, bedsMin: 3, auto: true, autoBasis: 'signup' }]);
const confirmed = JSON.stringify([{ types: ['Single Family'], cities: 'North Miami Beach', priceMin: 1000000, priceMax: 1500000, bedsMin: 3, auto: false, autoConfirmed: true }]);
const human = JSON.stringify([{ cities: 'Aventura', priceMax: 900000, auto: false, setBy: 'human' }]);
t('site-derived unconfirmed profile does NOT qualify', () => assert.equal(profileQualifies({ 'Alert Active': true, 'Alert Profiles': auto, 'Alert Cities': 'North Miami Beach', 'Alert Price Max': 4200000 }), false));
t('lead-confirmed profile qualifies', () => assert.equal(profileQualifies({ 'Alert Active': true, 'Alert Profiles': confirmed, 'Alert Price Max': 1500000 }), true));
t('human-set profile qualifies', () => assert.equal(profileQualifies({ 'Alert Active': true, 'Alert Profiles': human }), true));
t('flat-only criteria (legacy lead, no wrapper) qualifies', () => assert.equal(profileQualifies({ 'Alert Active': true, 'Alert Cities': 'Miami Beach', 'Alert Price Max': 800000 }), true));
t('no criteria does not qualify', () => assert.equal(profileQualifies({ 'Alert Active': true }), false));
t('alerts off does not qualify', () => assert.equal(profileQualifies({ 'Alert Active': false, 'Alert Profiles': human }), false));
t('isUnconfirmedAutoProfile', () => { assert.equal(isUnconfirmedAutoProfile({ auto: true }), true); assert.equal(isUnconfirmedAutoProfile({ auto: true, autoConfirmed: true }), false); assert.equal(isUnconfirmedAutoProfile(null), false); });

t('stampQualified writes capiQualifiedAt on profile #1 and keeps channels', () => {
    const raw = JSON.stringify({ channels: { email: true, whatsapp: true }, profiles: [{ cities: 'A', priceMax: 1 }, { cities: 'B', priceMax: 2 }] });
    const out = JSON.parse(stampQualified({ 'Alert Profiles': raw }, '2026-09-16T20:00:00.000Z'));
    assert.equal(out.profiles[0].capiQualifiedAt, '2026-09-16T20:00:00.000Z');
    assert.equal(out.profiles[1].capiQualifiedAt, undefined);
    assert.equal(out.channels.whatsapp, true);
});
t('stampQualified returns null for a flat-only lead', () => assert.equal(stampQualified({ 'Alert Cities': 'X' }), null));
t('alreadyQualified reads the marker', () => {
    assert.equal(alreadyQualified({ 'Alert Profiles': JSON.stringify([{ cities: 'A', capiQualifiedAt: 'x' }]) }), true);
    assert.equal(alreadyQualified({ 'Alert Profiles': human }), false);
});
t('markHumanSet clears auto:true only', () => {
    const out = JSON.parse(markHumanSet(auto));
    assert.equal(out[0].auto, false); assert.equal(out[0].setBy, 'human'); assert.equal(out[0].autoBasis, 'signup');
    assert.equal(markHumanSet(human), human);
    assert.equal(markHumanSet(''), '');
});

console.log('alert-profile-fields human-set rule');
t('MCP/CRM criteria write clears auto on profile #1', () => {
    const f = computeAlertFields({ priceMin: 1000000, priceMax: 1500000 }, { 'Alert Profiles': auto });
    const p = JSON.parse(f['Alert Profiles'])[0];
    assert.equal(p.auto, false); assert.equal(p.priceMax, 1500000); assert.equal(p.setBy, 'human');
});
t('derive-profile write (autoMeta) keeps auto:true', () => {
    const f = computeAlertFields({ cities: ['Aventura'], priceMax: 900000, autoMeta: { auto: true, autoBasis: 'browsing' } }, {});
    assert.equal(JSON.parse(f['Alert Profiles'])[0].auto, true);
});
t('active/frequency-only write leaves the profile untouched', () => {
    const f = computeAlertFields({ frequency: 'Weekly' }, { 'Alert Profiles': auto });
    assert.equal(f['Alert Profiles'], undefined);
});
t('autoProfileConfirm marks confirmed', () => {
    const f = computeAlertFields({ autoProfileConfirm: true }, { 'Alert Profiles': auto });
    const p = JSON.parse(f['Alert Profiles'])[0];
    assert.equal(p.auto, false); assert.equal(p.autoConfirmed, true);
});

console.log(`\n${n} passed`);
