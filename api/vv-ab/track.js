/**
 * /api/vv-ab/track.js — event ingest + auto-promotion (Node serverless).
 * POST { visitorId, variant, type, dwellMs?, maxScroll?, ctaCalls?, ctaScans? }
 * type ∈ view | leave | lead | cta_call | cta_scan
 * On each event, if both arms hit Threshold visitors → auto-promote winner.
 */
import {
  getConfig, updateConfig, insertEvent, listRoundEvents,
  aggregateVariant, decideWinner, isBot,
} from '../../lib/vv-ab.js';

// ---- Slack alert helpers (#qr-scans) ----
const DASH = 'https://www.homesinsoflorida.com/vvdash';
const GA = 'https://analytics.google.com/analytics/web/#/p540835135/realtime/overview';

function visitorMeta(req) {
  const h = req.headers;
  const dec = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
  const city = h['x-vercel-ip-city'] ? dec(h['x-vercel-ip-city']) : '';
  const region = h['x-vercel-ip-country-region'] || '';
  const country = h['x-vercel-ip-country'] || '';
  const loc = [city, region || country].filter(Boolean).join(', ') || 'Unknown location';
  const ua = String(h['user-agent'] || '');
  const device = /iphone/i.test(ua) ? 'iPhone' : /ipad/i.test(ua) ? 'iPad'
    : /android/i.test(ua) ? 'Android' : /macintosh|mac os/i.test(ua) ? 'Mac'
    : /windows/i.test(ua) ? 'Windows' : 'Other device';
  return { loc, device };
}
function variantLabel(variant, cfg) {
  return variant === (cfg.challenger || 'b') ? 'B — $1,475,000 hero' : 'A — "What’s Your Home Worth?" hero';
}
function fmtDur(ms) {
  const s = Math.round((Number(ms) || 0) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}
async function slackPost(text) {
  await fetch(process.env.VV_SLACK_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

// Arrival ping — fires the instant someone scans (no dwell time yet).
async function postSlackScan(req, variant, cfg, aAgg, bAgg) {
  const { loc, device } = visitorMeta(req);
  const totals = `A: ${aAgg ? aAgg.viewers : 0} visitors / ${aAgg ? aAgg.medianDwellSec : 0}s median`
    + (bAgg ? `   ·   B: ${bAgg.viewers} visitors / ${bAgg.medianDwellSec}s median` : '');
  await slackPost([
    `:iphone: *New Via Ventura QR scan* — Variant ${variantLabel(variant, cfg)}`,
    `:round_pushpin: ${loc} · ${device}`,
    `:hourglass_flowing_sand: _Time on page will post when they leave._`,
    `Round ${cfg.round} so far → ${totals}`,
    `<${DASH}|:bar_chart: Dashboard>   ·   <${GA}|:chart_with_upwards_trend: GA Realtime>`,
  ].join('\n'));
}

// Departure ping — fires when the visitor leaves, with THEIR time on the page.
async function postSlackLeave(req, variant, cfg, body, aAgg, bAgg) {
  const { loc, device } = visitorMeta(req);
  const scroll = Number(body.maxScroll || 0);
  const reach = scroll >= 75 ? 'reached the form :white_check_mark:' : `scrolled ${scroll}% down`;
  const taps = Number(body.ctaCalls || 0);
  const tapTxt = taps > 0 ? ` · ${taps} call/text tap${taps > 1 ? 's' : ''} :telephone_receiver:` : '';
  const med = `A ${aAgg ? aAgg.medianDwellSec : 0}s · B ${bAgg ? bAgg.medianDwellSec : 0}s`;
  await slackPost([
    `:stopwatch: *Visitor left* — Variant ${variantLabel(variant, cfg)}`,
    `:round_pushpin: ${loc} · ${device}`,
    `*This visitor spent ${fmtDur(body.dwellMs)} on the page* · ${reach}${tapTxt}`,
    `Round ${cfg.round} median time on page → ${med}`,
    `<${DASH}|:bar_chart: Dashboard>`,
  ].join('\n'));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const variant = String(body.variant || '').toLowerCase();
    const type = String(body.type || '');
    const visitorId = String(body.visitorId || '').slice(0, 64);
    if (!variant || !type || !visitorId) return res.status(400).json({ error: 'missing fields' });

    // Drop search crawlers / link-preview bots — never count them or ping Slack.
    if (isBot(req.headers['user-agent'])) return res.status(200).json({ ok: true, bot: true });

    const cfg = await getConfig();

    await insertEvent({
      'Visitor ID': visitorId,
      Variant: variant,
      Type: type,
      Round: cfg.round,
      'Dwell Ms': Number(body.dwellMs || 0),
      'Max Scroll': Number(body.maxScroll || 0),
      'CTA Calls': Number(body.ctaCalls || 0),
      'CTA Scans': Number(body.ctaScans || 0),
      UA: String(req.headers['user-agent'] || '').slice(0, 250),
      'Created At': new Date().toISOString(),
    });

    // Compute current KPIs (for Slack alert + promotion)
    let aAgg = null, bAgg = null;
    if (type === 'view' || type === 'lead' || type === 'leave') {
      const events = await listRoundEvents(cfg.round);
      aAgg = aggregateVariant(events, cfg.champion || 'a');
      bAgg = cfg.challenger ? aggregateVariant(events, cfg.challenger) : null;
    }

    // Slack ping on every QR scan (view)
    if (type === 'view' && process.env.VV_SLACK_WEBHOOK) {
      try { await postSlackScan(req, variant, cfg, aAgg, bAgg); } catch (e) { /* never block tracking */ }
    }

    // Slack ping when a visitor leaves — with THEIR time on the page.
    if (type === 'leave' && process.env.VV_SLACK_WEBHOOK) {
      try { await postSlackLeave(req, variant, cfg, body, aAgg, bAgg); } catch (e) { /* never block tracking */ }
    }

    // Auto-promotion check (only while running with a live challenger)
    if (cfg.status === 'running' && cfg.challenger && aAgg && bAgg) {
      if (aAgg.viewers >= cfg.threshold && bAgg.viewers >= cfg.threshold) {
        const winner = decideWinner(aAgg, bAgg);
        const winnerId = winner === 'b' ? cfg.challenger : cfg.champion;
        let history = [];
        try { history = cfg.history ? JSON.parse(cfg.history) : []; } catch { history = []; }
        history.push({
          round: cfg.round, ts: new Date().toISOString(),
          champion: cfg.champion, challenger: cfg.challenger, winner: winnerId,
          a: aAgg, b: bAgg,
        });
        await updateConfig(cfg.recordId, {
          Champion: winnerId,
          Challenger: '',
          Split: 0,
          Round: cfg.round + 1,
          Status: 'awaiting_challenger',
          History: JSON.stringify(history).slice(0, 99000),
          'Updated At': new Date().toISOString(),
        });
        return res.status(200).json({ ok: true, promoted: true, winner: winnerId, round: cfg.round });
      }
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    // tracking must never throw user-visibly
    return res.status(200).json({ ok: false, error: String(e && e.message || e) });
  }
}
