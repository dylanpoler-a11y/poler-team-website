/**
 * /api/lp-ab/track.js — landing-page A/B event ingest + auto-promotion (Node serverless).
 * POST { visitorId, variant, type, round?, dwellMs?, maxScroll? }
 * type ∈ view | lead | leave
 *
 * Conversion-optimized: once both arms clear the view threshold, a statistically
 * significant conversion-rate difference auto-promotes the winner (Kevin opted in
 * to auto-promote 2026-06-22). High traffic, so NO per-view Slack (would spam) —
 * Slack fires only on a promotion. Tracking must never throw user-visibly.
 */
import {
  getConfig, updateConfig, insertEvent, listRoundEvents,
  aggregateVariant, evaluatePromotion, convPValue, isBot,
} from '../../lib/lp-ab.js';

const DASH = 'https://www.homesinsoflorida.com/lpdash';

async function slackPost(text) {
  // Dedicated LP webhook if set, else fall back to the existing VV webhook so a
  // promotion is never silent (promotions are rare — once per round).
  const hook = process.env.LP_SLACK_WEBHOOK || process.env.VV_SLACK_WEBHOOK;
  if (!hook) return;
  await fetch(hook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

async function postPromotion(cfg, result, aAgg, bAgg) {
  const winnerLetter = result.winner; // 'a' | 'b'
  const winnerId = winnerLetter === 'b' ? cfg.challenger : cfg.champion;
  const changed = winnerLetter === 'b';
  const head = changed
    ? `:white_check_mark: *Landing-page A/B — challenger "${winnerId}" WON Round ${cfg.round}*`
    : `:checkered_flag: *Landing-page A/B — Round ${cfg.round} ended, champion "${cfg.champion}" held*`;
  await slackPost([
    head,
    `_${result.reason}_`,
    `*A (${cfg.champion})*: ${aAgg.viewers} visitors · ${aAgg.leads} leads · *${aAgg.convRate}%*`,
    `*B (${cfg.challenger})*: ${bAgg.viewers} visitors · ${bAgg.leads} leads · *${bAgg.convRate}%*`,
    changed ? `:rocket: "${winnerId}" is now live for all traffic. Round ${cfg.round + 1} awaiting a new challenger.`
            : `No significant lift — page unchanged. Round ${cfg.round + 1} awaiting a new challenger.`,
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
    const variant = String(body.variant || '').toLowerCase().slice(0, 8);
    const type = String(body.type || '');
    const visitorId = String(body.visitorId || '').slice(0, 64);
    if (!variant || !['view', 'lead', 'leave'].includes(type) || !visitorId) {
      return res.status(400).json({ error: 'missing/invalid fields' });
    }

    // Drop crawlers / link-preview bots — never count them or promote on them.
    if (isBot(req.headers['user-agent'])) return res.status(200).json({ ok: true, bot: true });

    // Cheap abuse guard so fabricated events can't stuff a false promotion: only
    // accept events that came from our own site. sendBeacon may omit a referer, so
    // an EMPTY referer is allowed; a foreign one is dropped.
    // Anchor the domain to the ROOT so a spoof like "homesinsoflorida.com.evil.com"
    // is rejected: must be https?://[optional subdomains.]homesinsoflorida.com then
    // end / path / query / fragment.
    const ref = String(req.headers.referer || '');
    if (ref && !/^https?:\/\/([^.]+\.)*homesinsoflorida\.com($|[/?#])/i.test(ref)) {
      return res.status(200).json({ ok: true, ignored: 'referer' });
    }

    const cfg = await getConfig();

    // Tag the event with the client's ASSIGNED round when valid, so a visitor's
    // late 'leave' after a mid-session promotion stays in the round they converted
    // in (cleaner than vv-ab, which always uses the server round).
    let round = Number(body.round);
    if (!Number.isFinite(round) || round < 1 || round > cfg.round) round = cfg.round;

    await insertEvent({
      'Visitor ID': visitorId,
      Variant: variant,
      Type: type,
      Round: round,
      'Dwell Ms': Math.max(0, Math.min(Number(body.dwellMs || 0), 86400000)),
      'Max Scroll': Math.max(0, Math.min(Number(body.maxScroll || 0), 100)),
      UA: String(req.headers['user-agent'] || '').slice(0, 250),
      'Created At': new Date().toISOString(),
    });

    // Promotion check ONLY on a lead (conversion) event — the only signal that moves
    // the conversion rate. This keeps the expensive full-round read off the hot
    // view/leave path (~98% of traffic), avoiding Airtable rate limits at ad volume.
    // A view-count threshold crossing is picked up at the next lead — no material delay.
    if (type === 'lead' && cfg.status === 'running' && cfg.challenger) {
      const events = await listRoundEvents(cfg.round);
      const aAgg = aggregateVariant(events, cfg.champion || 'a');
      const bAgg = aggregateVariant(events, cfg.challenger);
      const result = evaluatePromotion(aAgg, bAgg, cfg);
      if (result.promote) {
        const winnerId = result.winner === 'b' ? cfg.challenger : cfg.champion;
        let history = [];
        try { history = cfg.history ? JSON.parse(cfg.history) : []; } catch { history = []; }
        history.push({
          round: cfg.round, ts: new Date().toISOString(),
          champion: cfg.champion, challenger: cfg.challenger,
          winner: winnerId, reason: result.reason, pValue: result.pValue,
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
        try { await postPromotion(cfg, result, aAgg, bAgg); } catch (e) { /* never block */ }
        return res.status(200).json({ ok: true, promoted: true, winner: winnerId, round: cfg.round });
      }
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    // tracking must never throw user-visibly
    return res.status(200).json({ ok: false, error: String(e && e.message || e) });
  }
}
