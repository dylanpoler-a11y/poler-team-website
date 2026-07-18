/**
 * lib/vv-ab.js — Via Ventura A/B test helpers (Airtable-backed).
 * Used by api/vv-ab/{route,track,report}.js
 *
 * Tables (base = process.env.AIRTABLE_BASE_ID):
 *   "VV AB Config"  — single row Key='active' { Champion, Challenger, Split, Round, Threshold, Status, History }
 *   "VV AB Events"  — one row per visitor event { Visitor ID, Variant, Type, Round, Dwell Ms, Max Scroll, CTA Calls, CTA Scans, UA, Created At }
 */

const BASE = process.env.AIRTABLE_BASE_ID;
const KEY = process.env.AIRTABLE_API_KEY;
const API = 'https://api.airtable.com/v0';
const CONFIG_T = encodeURIComponent('VV AB Config');
const EVENTS_T = encodeURIComponent('VV AB Events');

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${KEY}`, ...extra };
}

// ---- Bot filter ----
// Search crawlers / link-preview fetchers / scripts that render JS and would
// otherwise count as "visitors" and fire Slack pings. Real iOS/Android browsers
// never match these tokens.
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
  if (!rec) throw new Error('no active config row');
  const f = rec.fields;
  const cfg = {
    recordId: rec.id,
    champion: (f.Champion || 'a').toLowerCase(),
    challenger: (f.Challenger || '').toLowerCase(),
    split: Number(f.Split ?? 50),
    round: Number(f.Round ?? 1),
    threshold: Number(f.Threshold ?? 20),
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
    body: JSON.stringify({ fields }),
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
  for (let i = 0; i < 20; i++) { // hard cap 2000 rows
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
function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function stdev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}

function aggregateVariant(events, variant) {
  const rows = events.filter((e) => (e.Variant || '').toLowerCase() === variant);
  const viewers = new Set();
  const leads = new Set();
  const dwell = [];
  let scrollToForm = 0;
  let bounces = 0;
  let callTaps = 0;
  const leaveByVisitor = {};
  rows.forEach((e) => {
    const vid = e['Visitor ID'];
    const type = e.Type;
    if (type === 'view') viewers.add(vid);
    if (type === 'lead') leads.add(vid);
    if (type === 'cta_call') callTaps += 1;
    if (type === 'leave') {
      viewers.add(vid);
      leaveByVisitor[vid] = e;
    }
  });
  Object.values(leaveByVisitor).forEach((e) => {
    const ms = Number(e['Dwell Ms'] || 0);
    const scroll = Number(e['Max Scroll'] || 0);
    callTaps += Number(e['CTA Calls'] || 0);
    if (ms > 0) dwell.push(ms);
    if (scroll >= 75) scrollToForm += 1;
    if (ms < 10000 && scroll < 25) bounces += 1;
  });
  const v = viewers.size;
  const c = leads.size;
  const leaves = Object.keys(leaveByVisitor).length || 1;
  const dwellSec = dwell.map((ms) => ms / 1000);
  return {
    viewers: v,
    leads: c,
    convRate: v ? +(100 * c / v).toFixed(1) : 0,
    medianDwellSec: +median(dwellSec).toFixed(1),
    meanDwellSec: +mean(dwellSec).toFixed(1),
    stdDwellSec: +stdev(dwellSec).toFixed(1),
    dwellN: dwellSec.length,
    scrollToFormPct: +(100 * scrollToForm / leaves).toFixed(0),
    bouncePct: +(100 * bounces / leaves).toFixed(0),
    callTaps,
  };
}

// two-proportion z-test p-value (normal approx) for conversion difference
function convPValue(a, b) {
  const n1 = a.viewers, n2 = b.viewers, x1 = a.leads, x2 = b.leads;
  if (n1 < 1 || n2 < 1) return 1;
  const p1 = x1 / n1, p2 = x2 / n2;
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se === 0) return 1;
  const z = Math.abs(p1 - p2) / se;
  // two-sided p ~ erfc(z/sqrt2)
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return +(2 * prob).toFixed(3);
}

// Welch's t-test (two-sided) on mean time-on-site → approx p-value.
// Normal approximation of the t tail; fine for the ~20+/arm samples we promote at.
function dwellPValue(a, b) {
  const n1 = a.dwellN, n2 = b.dwellN;
  if (n1 < 2 || n2 < 2) return 1;
  const se = Math.sqrt((a.stdDwellSec ** 2) / n1 + (b.stdDwellSec ** 2) / n2);
  if (se === 0) return 1;
  const z = Math.abs(a.meanDwellSec - b.meanDwellSec) / se;
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return +(2 * prob).toFixed(3);
}

function decideWinner(aAgg, bAgg) {
  // primary: median time-on-site (the metric we optimize); tiebreak: conversion
  // rate (leads); then incumbent champion ('a').
  if (bAgg.medianDwellSec > aAgg.medianDwellSec) return 'b';
  if (aAgg.medianDwellSec > bAgg.medianDwellSec) return 'a';
  if (bAgg.convRate > aAgg.convRate) return 'b';
  return 'a';
}

export {
  getConfig, updateConfig, insertEvent, listRoundEvents,
  aggregateVariant, convPValue, dwellPValue, decideWinner, isBot,
};
