/**
 * /api/preconstructions.js — Vercel Edge Function (PUBLIC, no auth)
 * Curated South Florida new-development / preconstruction BUILDINGS directory.
 * Backs both the public /preconstruction page and the MCP tools.
 *
 * Query params (all optional):
 *   id             — one building by id (returns just that building)
 *   area           — comma-sep areas, e.g. "Brickell,Downtown Miami"
 *   priceMin       — min entry price (matches building.priceFrom >= )
 *   priceMax       — max entry price (matches building.priceFrom <= )
 *   deliveryYearMax— only buildings delivering on/before this year
 *   deliveryYearMin— only buildings delivering on/after this year
 *   bedsMin        — building offers at least this bedroom count
 *   developer      — case-insensitive substring match on developer
 *   waterfront     — "true" → waterfront only
 *   shortTermRental— "true" → daily/short-term-rental-friendly only
 *   badge          — exact badge match (e.g. "BEST VALUE")
 *   sort           — "price_low" (default) | "price_high" | "delivery" | "name"
 * Returns: { count, buildings: [...] }
 */

export const config = { runtime: 'edge' };

import { PRECONSTRUCTIONS, PRECON_AREAS, PRECON_DEVELOPERS } from '../lib/preconstructions-data.js';

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors() });
  }
  const url = new URL(req.url);
  const q = url.searchParams;

  const id = (q.get('id') || '').trim();
  if (id) {
    const one = PRECONSTRUCTIONS.find(b => b.id === id);
    return json(one ? { count: 1, buildings: [one] } : { count: 0, buildings: [] });
  }

  let list = PRECONSTRUCTIONS.slice();

  const areas = (q.get('area') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (areas.length) list = list.filter(b => areas.includes(b.area.toLowerCase()));

  const priceMin = parseInt(q.get('priceMin') || '', 10);
  const priceMax = parseInt(q.get('priceMax') || '', 10);
  if (priceMin > 0) list = list.filter(b => (b.priceFrom || 0) >= priceMin);
  if (priceMax > 0) list = list.filter(b => (b.priceFrom || 0) <= priceMax);

  const dMax = parseInt(q.get('deliveryYearMax') || '', 10);
  const dMin = parseInt(q.get('deliveryYearMin') || '', 10);
  if (dMax > 0) list = list.filter(b => (b.deliveryYear || 9999) <= dMax);
  if (dMin > 0) list = list.filter(b => (b.deliveryYear || 0) >= dMin);

  const bedsMin = parseInt(q.get('bedsMin') || '', 10);
  if (bedsMin > 0) list = list.filter(b => (b.bedrooms || []).some(n => n >= bedsMin));

  const dev = (q.get('developer') || '').trim().toLowerCase();
  if (dev) list = list.filter(b => (b.developer || '').toLowerCase().includes(dev));

  if (q.get('waterfront') === 'true')      list = list.filter(b => !!b.waterfront);
  if (q.get('shortTermRental') === 'true') list = list.filter(b => !!b.shortTermRental);

  const badge = (q.get('badge') || '').trim().toLowerCase();
  if (badge) list = list.filter(b => (b.badge || '').toLowerCase() === badge);

  const sort = q.get('sort') || 'price_low';
  const sorters = {
    price_low:  (a, b) => (a.priceFrom || 0) - (b.priceFrom || 0),
    price_high: (a, b) => (b.priceFrom || 0) - (a.priceFrom || 0),
    delivery:   (a, b) => (a.deliveryYear || 9999) - (b.deliveryYear || 9999),
    name:       (a, b) => a.name.localeCompare(b.name),
  };
  list.sort(sorters[sort] || sorters.price_low);

  return json({ count: list.length, areas: PRECON_AREAS, developers: PRECON_DEVELOPERS, buildings: list });
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors() },
  });
}
