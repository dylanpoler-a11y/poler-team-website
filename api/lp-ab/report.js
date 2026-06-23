/**
 * /api/lp-ab/report.js — landing-page A/B dashboard data (Node serverless, GET).
 * Returns the live config + current-round aggregates for both arms + the
 * two-proportion p-value + a plain-English verdict, for lpdash.html.
 */
import {
  getConfig, listRoundEvents, aggregateVariant, convPValue, evaluatePromotion,
} from '../../lib/lp-ab.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const cfg = await getConfig({ fresh: true });
    const events = await listRoundEvents(cfg.round);
    const a = aggregateVariant(events, cfg.champion || 'a');
    const b = cfg.challenger ? aggregateVariant(events, cfg.challenger) : null;
    const pValue = b ? convPValue(a, b) : 1;
    const promo = b ? evaluatePromotion(a, b, cfg) : { reason: 'no challenger', promote: false };

    let verdict;
    if (!b) verdict = 'No live challenger — round awaiting a new variant.';
    else if (a.viewers < cfg.threshold || b.viewers < cfg.threshold) {
      const need = cfg.threshold;
      verdict = `Collecting — need ${need} visitors/arm (A ${a.viewers}, B ${b.viewers}).`;
    } else if (pValue < 0.05) {
      const lead = b.convRate > a.convRate ? `B (${cfg.challenger})` : `A (${cfg.champion})`;
      verdict = `Significant — ${lead} wins (p=${pValue}).`;
    } else {
      verdict = `No significant difference yet (p=${pValue}).`;
    }

    let history = [];
    try { history = cfg.history ? JSON.parse(cfg.history) : []; } catch { history = []; }

    let lift = null;
    if (b && a.convRate > 0) lift = +(((b.convRate - a.convRate) / a.convRate) * 100).toFixed(1);

    return res.status(200).json({
      round: cfg.round,
      status: cfg.status,
      champion: cfg.champion,
      challenger: cfg.challenger,
      split: cfg.split,
      threshold: cfg.threshold,
      a, b, pValue, lift, verdict, promo,
      history: history.slice(-10).reverse(),
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(200).json({ error: String(e && e.message || e) });
  }
}
