/**
 * /api/vv-ab/route.js — Via Ventura A/B splitter (Node serverless).
 * The QR points at /via-ventura, which vercel.json rewrites here.
 * Sticky 50/50 (cookie vv_v), config-driven, FAIL-SAFE: any error → serve champion.
 */
import { getConfig } from '../../lib/vv-ab.js';

function parseCookies(h = '') {
  const out = {};
  h.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

async function serveVariant(req, res, variant) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const html = await fetch(`${proto}://${host}/vv-${variant}`).then((r) => r.text());
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.status(200).send(html);
}

export default async function handler(req, res) {
  let variant = 'a';
  try {
    const cfg = await getConfig();
    const live = [cfg.champion, cfg.challenger].filter(Boolean);
    const cookies = parseCookies(req.headers.cookie);
    let v = (cookies.vv_v || '').toLowerCase();

    if (!live.includes(v)) {
      // assign
      if (cfg.status !== 'running' || !cfg.challenger) {
        v = cfg.champion;
      } else {
        v = Math.random() * 100 < cfg.split ? cfg.challenger : cfg.champion;
      }
      res.setHeader('Set-Cookie', `vv_v=${v}; Path=/; Max-Age=2592000; SameSite=Lax`);
    }
    variant = v || cfg.champion;
    await serveVariant(req, res, variant);
  } catch (e) {
    // FAIL-SAFE — never break the QR. Serve champion 'a' page directly.
    try {
      await serveVariant(req, res, 'a');
    } catch (_) {
      res.setHeader('Location', '/vv-a.html');
      res.status(302).end();
    }
  }
}
