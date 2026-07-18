/**
 * /api/vv-ab/report.js — KPI JSON for the dashboard (Node serverless).
 * GET → { config, round, threshold, variants:{a,b}, pValue, recommendation, confidence, history }
 */
import {
  getConfig, listRoundEvents, aggregateVariant, convPValue, dwellPValue, decideWinner,
} from '../../lib/vv-ab.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const cfg = await getConfig({ fresh: true });
    const events = await listRoundEvents(cfg.round);
    const aAgg = aggregateVariant(events, cfg.champion || 'a');
    const bAgg = cfg.challenger ? aggregateVariant(events, cfg.challenger) : null;

    let history = [];
    try { history = cfg.history ? JSON.parse(cfg.history) : []; } catch { history = []; }

    let pValue = 1, leadPValue = 1, recommendation = '', confidence = 'collecting', winner = null;
    if (bAgg) {
      pValue = dwellPValue(aAgg, bAgg);       // primary: time-on-site
      leadPValue = convPValue(aAgg, bAgg);    // secondary: leads
      const bothReady = aAgg.viewers >= cfg.threshold && bAgg.viewers >= cfg.threshold;
      winner = decideWinner(aAgg, bAgg);
      const wName = winner === 'b' ? 'Variant B' : 'Variant A';
      const hi = Math.max(aAgg.medianDwellSec, bAgg.medianDwellSec);
      const lo = Math.min(aAgg.medianDwellSec, bAgg.medianDwellSec);
      const gap = +(hi - lo).toFixed(1);
      if (!bothReady) {
        const need = Math.max(0, cfg.threshold - aAgg.viewers) + Math.max(0, cfg.threshold - bAgg.viewers);
        confidence = 'collecting';
        recommendation = `Collecting — need ${need} more visitor(s) to reach ${cfg.threshold}/arm before a call.`;
      } else if (pValue <= 0.05) {
        confidence = 'significant';
        recommendation = `${wName} wins on time-on-site — ${hi}s vs ${lo}s median (p=${pValue}).`;
      } else if (gap >= 10) {
        confidence = 'directional';
        recommendation = `${wName} leads on time-on-site (${hi}s vs ${lo}s median) but it's directional, not significant (p=${pValue}). More traffic = firmer call.`;
      } else {
        confidence = 'tie';
        recommendation = `Effectively a tie on time-on-site (${hi}s vs ${lo}s, p=${pValue}). Auto-promote will pick ${wName} on tiebreak.`;
      }
    } else if (cfg.status === 'awaiting_challenger') {
      recommendation = 'Round complete — champion promoted. Awaiting a new challenger variant (Claude generates + deploys it).';
      confidence = 'awaiting_challenger';
    }

    res.status(200).json({
      ok: true,
      generatedAt: new Date().toISOString(),
      config: {
        champion: cfg.champion, challenger: cfg.challenger,
        split: cfg.split, round: cfg.round, threshold: cfg.threshold, status: cfg.status,
      },
      variants: { a: aAgg, b: bAgg },
      metric: 'time-on-site',
      pValue, leadPValue, winner, confidence, recommendation,
      history,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message || e) });
  }
}
