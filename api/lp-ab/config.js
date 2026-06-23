/**
 * /api/lp-ab/config.js — GET the live landing-page A/B config (Node serverless).
 * The /listing client reads this to assign its sticky variant + tag events with
 * the current round. Returns champion/challenger letters, split %, round, status.
 * Fail-safe: on any error, returns the champion-only default so the page never
 * shows the challenger treatment when config is unreachable.
 */
import { getConfig } from '../../lib/lp-ab.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const cfg = await getConfig();
    return res.status(200).json({
      champion: cfg.champion || 'a',
      challenger: cfg.challenger || '',
      split: cfg.split || 0,
      round: cfg.round || 1,
      status: cfg.status || 'running',
    });
  } catch (e) {
    // fail-safe → everyone gets the champion, no experiment
    return res.status(200).json({ champion: 'a', challenger: '', split: 0, round: 1, status: 'error' });
  }
}
