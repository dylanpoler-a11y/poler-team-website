/**
 * lib/lp-ab.js — Landing-page (listing popup) A/B test helpers (Airtable-backed).
 * Used by api/lp-ab/{config,track,report}.js
 *
 * Sibling of lib/vv-ab.js but a SEPARATE experiment (the cold-ad /listing popup),
 * with its own tables so the two auto-promote loops never collide, and a
 * CONVERSION-primary winner (the door-knock test optimizes dwell; this one
 * optimizes lead conversion rate — we have the ad volume to reach significance).
 *
 * Tables (base = process.env.AIRTABLE_BASE_ID):
 *   "LP AB Config"  — single row Key='active' { Champion, Challenger, Split, Round, Threshold(min views/arm), Status, History, Updated At }
 *   "LP AB Events"  — one row per visitor event { Visitor ID, Variant, Type, Round, Dwell Ms, Max Scroll, UA, Created At }
 */

const BASE = process.env.AIRTABLE_BASE_ID;
const KEY = process.env.AIRTABLE_API_KEY;
const API = 'https://api.airtable.com/v0';
const CONFIG_T = encodeURIComponent('LP AB Config');
const EVENTS_T = encodeURIComponent('LP AB Events');

// Promotion needs a significant conversion difference (p<0.05) once BOTH arms
// clear Threshold views. If they reach FORCE_MULT×Threshold with no significant
// difference, the test is called for the incumbent champion (no change) so a dead
// heat can't run forever. Tunable: raise Threshold in the config row for more power.
const SIG_P = 0.05;
const FORCE_MULT = 4;

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${KEY}`, ...extra };
}

// ---- Bot filter (same token set as vv-ab) ----
const BOT_RE = /bot\b|crawl|spider|slurp|mediapartners|googlebot|bingbot|duckduckbot|baiduspider|yandex|facebookexternalhit|facebot|ia_archiver|headlesschrome|phantomjs|python-requests|wget|curl\/|axios|node-fetch|go-http|semrush|ahrefs|petalbot|gptbot|claudebot|ccbot|bytespider|applebot|amazonbot/i;
function isBot(ua) { return BOT_RE.test(String(ua || '')); }

// ---- Config (cached in warm lambda for 15s) ----
let _cfgCache = null;
let _cfgAt = 0;

async function getConfig({ fresh = false } = {}) {
  if (!fresh && _cfgCache && Date.now() - _cfgAt < 15000) return _cfgCache;
  const url = `${API}/${BASE}/${CONFIG_T}?filterByFormula=${encodeURIComponent("{Key}='active'")}&maxRecords=1`;
  const r = await fetch(url, { headers: authHeaders() });
  const j = await r.json();
  const rec = (j.records || [])[0];
  if (!rec) throw new Error('no active LP config row');
  const f = rec.fields;
  const cfg = {
    recordId: rec.id,
    champion: (f.Champion || 'a').toLowerCase(),
    challenger: (f.Challenger || '').toLowerCase(),
    split: Number(f.Split ?? 50),
    round: Number(f.Round ?? 1),
    threshold: Number(f.Threshold ?? 1500),
    status: f.Status || 'running',
    history: f.History || '',
  };
  _cfgCache = cfg;
  _cfgAt = Date.now();
  return cfg;
}

async function updateConfig(recordId, fields) {
  const r = await fetch(`${API}/${BASE}/${CONFIG_T}/${recordId}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ fields, typecast: true }),
  });
  _cfgCache = null; // bust cache
  return r.json();
}

// ---- Events ----
async function insertEvent(fields) {
  const r = await fetch(`${API}/${BASE}/${EVENTS_T}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ fields, typecast: true }),
  });
  return r.json();
}

async function listRoundEvents(round) {
  const out = [];
  let offset = '';
  for (let i = 0; i < 60; i++) { // hard cap 6000 rows (a round shouldn't exceed this)
    const u = `${API}/${BASE}/${EVENTS_T}?filterByFormula=${encodeURIComponent(`{Round}=${round}`)}&pageSize=100${offset ? `&offset=${offset}` : ''}`;
    const r = await fetch(u, { headers: authHeaders() });
    const j = await r.json();
    (j.records || []).forEach((rec) => out.push(rec.fields));
    if (!j.offset) break;
    offset = j.offset;
  }
  return out;
}

// ---- KPI aggregation ----
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function aggregateVariant(events, variant) {
  const rows = events.filter((e) => (e.Variant || '').toLowerCase() === variant);
  const viewers = new Set();
  const leads = new Set();
  const leaveByVisitor = {};
  rows.forEach((e) => {
    const vid = e['Visitor ID'];
    const type = e.Type;
    if (type === 'view') viewers.add(vid);
    if (type === 'lead') { leads.add(vid); viewers.add(vid); }
    if (type === 'leave') { viewers.add(vid); leaveByVisitor[vid] = e; }
  });
  const dwell = [];
  let scrollToForm = 0;
  Object.values(leaveByVisitor).forEach((e) => {
    const ms = Number(e['Dwell Ms'] || 0);
    const scroll = Number(e['Max Scroll'] || 0);
    if (ms > 0) dwell.push(ms);
    if (scroll >= 75) scrollToForm += 1;
  });
  const v = viewers.size;
  const c = leads.size;
  const leaves = Object.keys(leaveByVisitor).length || 1;
  const dwellSec = dwell.map((ms) => ms / 1000);
  return {
    viewers: v,
    leads: c,
    convRate: v ? +(100 * c / v).toFixed(2) : 0,
    medianDwellSec: +median(dwellSec).toFixed(1),
    dwellN: dwellSec.length,
    scrollToFormPct: +(100 * scrollToForm / leaves).toFixed(0),
  };
}

// two-proportion z-test p-value (normal approx) for the conversion difference.
function convPValue(a, b) {
  const n1 = a.viewers, n2 = b.viewers, x1 = a.leads, x2 = b.leads;
  if (n1 < 1 || n2 < 1) return 1;
  const p1 = x1 / n1, p2 = x2 / n2;
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se === 0) return 1;
  const z = Math.abs(p1 - p2) / se;
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return +(2 * prob).toFixed(4);
}

// Conversion-primary winner. Returns an ARM LABEL, not a content letter:
//   'a' = champion arm (aAgg), 'b' = challenger arm (bAgg).
// The caller maps arm→content via `winner==='b' ? cfg.challenger : cfg.champion`,
// so 'a' ALWAYS resolves to the current champion in any round (do NOT change these
// to cfg.champion/cfg.challenger here — that would invert the mapping). Higher
// convRate wins; an exact tie keeps the incumbent champion arm ('a').
function decideWinner(aAgg, bAgg) {
  if (bAgg.convRate > aAgg.convRate) return 'b';
  return 'a';
}

/**
 * Promotion gate (conversion). Returns { promote, winner('a'|'b'), reason, pValue }.
 * - Both arms must clear `threshold` views before ANYTHING can promote.
 * - Then a significant difference (p < SIG_P) promotes the higher-converting arm.
 * - If both arms reach FORCE_MULT×threshold with no significant difference, the
 *   round is called for the incumbent champion 'a' (no real change) so it ends.
 */
function evaluatePromotion(aAgg, bAgg, cfg) {
  const min = Math.max(1, Number(cfg.threshold) || 1500);
  const force = min * FORCE_MULT;
  if (aAgg.viewers < min || bAgg.viewers < min) {
    return { promote: false, winner: null, reason: 'collecting', pValue: convPValue(aAgg, bAgg) };
  }
  const p = convPValue(aAgg, bAgg);
  if (p < SIG_P) {
    const w = decideWinner(aAgg, bAgg);
    return { promote: true, winner: w, reason: `significant (p=${p})`, pValue: p };
  }
  if (aAgg.viewers >= force && bAgg.viewers >= force) {
    // winner 'a' = champion arm → caller keeps the CURRENT champion (correct any round)
    return { promote: true, winner: 'a', reason: `inconclusive at ${force}/arm — keep champion`, pValue: p };
  }
  return { promote: false, winner: null, reason: 'collecting (not yet significant)', pValue: p };
}

export {
  getConfig, updateConfig, insertEvent, listRoundEvents,
  aggregateVariant, convPValue, decideWinner, evaluatePromotion, isBot,
};
