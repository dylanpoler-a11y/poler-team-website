/**
 * /api/city?slug=<city-slug> — server-rendered per-city SEO landing page.
 *
 * Reached ONLY through the vercel.json rewrite `/:city-condos-for-sale` →
 * this function, so the public URL Google sees is /sunny-isles-beach-condos-for-sale.
 * (2026-09-16) Why a function and not a static file like /tower: the page
 * embeds LIVE MLS listings + counts in the HTML so Google indexes real
 * inventory, and the listing page's client-side fetch could never give it that.
 *
 * Data: Bridge MLS via the same BRIDGE_API_TOKEN api/bridge/listings.js uses.
 * Three upstream calls per render (newest 24 for sale, 200-sample for stats,
 * rentals count), all fail-soft — a Bridge outage still serves the page with
 * the prose/FAQ/towers and a short cache so it heals itself. Vercel's CDN
 * caches the HTML 30 min (s-maxage) and serves stale for a day while it
 * revalidates, so crawlers and buyers never wait on Bridge.
 */

import { CITIES, findCity } from '../lib/cities-data.js';
import { renderCityPage, renderNotFound, computeStats } from '../lib/city-page.js';
import * as precon from '../lib/preconstructions-data.js';

const TOWERS = precon.PRECONSTRUCTIONS || precon.default || [];
const BRIDGE_BASE = 'https://api.bridgedataoutput.com/api/v2/miamire/listings';
const CARD_FIELDS = 'ListingId,ListPrice,UnparsedAddress,City,BedroomsTotal,BathroomsTotalInteger,LivingArea,PropertySubType,Media,ListingContractDate,WaterfrontYN,BuildingName';
const STAT_FIELDS = 'ListPrice,LivingArea,PropertySubType,WaterfrontYN';
const NEWEST = 24;
const SAMPLE = 200;

async function bridge(params, token, timeoutMs = 8000) {
    const qs = new URLSearchParams({ access_token: token, ...params });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const r = await fetch(`${BRIDGE_BASE}?${qs}`, { signal: ctrl.signal, headers: { 'User-Agent': 'homesinsoflorida-city-page' } });
        if (!r.ok) throw new Error(`Bridge HTTP ${r.status}`);
        const j = await r.json();
        if (!j || j.success === false) throw new Error('Bridge error payload');
        return j;
    } finally {
        clearTimeout(timer);
    }
}

export default async function handler(req, res) {
    const raw = req.query && req.query.slug;
    const slug = String(Array.isArray(raw) ? raw[0] : (raw || '')).toLowerCase().replace(/[^a-z0-9-]/g, '');
    const city = findCity(slug);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    if (!city) {
        res.setHeader('Cache-Control', 'public, s-maxage=600');
        return res.status(404).send(renderNotFound(CITIES));
    }

    const token = process.env.BRIDGE_API_TOKEN;
    const base = { StandardStatus: 'Active', City: city.bridgeCity };
    let listings = [];
    let sample = [];
    let totals = { sale: 0, rent: 0 };
    let degraded = !token;

    if (token) {
        const [newest, stat, rent] = await Promise.allSettled([
            bridge({ ...base, PropertyType: 'Residential', sortBy: 'ListingContractDate', order: 'desc', limit: String(NEWEST), fields: CARD_FIELDS }, token),
            bridge({ ...base, PropertyType: 'Residential', sortBy: 'ListingContractDate', order: 'desc', limit: String(SAMPLE), fields: STAT_FIELDS }, token),
            bridge({ ...base, PropertyType: 'Residential Lease', limit: '1', fields: 'ListingId' }, token),
        ]);
        if (newest.status === 'fulfilled') {
            listings = (newest.value.bundle || []).filter(l => l && l.ListPrice > 0);
            totals.sale = Number(newest.value.total) || listings.length;
        } else degraded = true;
        if (stat.status === 'fulfilled') sample = (stat.value.bundle || []).filter(l => l && l.ListPrice > 0);
        else sample = listings;
        if (rent.status === 'fulfilled') totals.rent = Number(rent.value.total) || 0;
        if (newest.status === 'rejected') console.error('[city] newest failed', city.slug, newest.reason && newest.reason.message);
        if (stat.status === 'rejected') console.error('[city] stats failed', city.slug, stat.reason && stat.reason.message);
    } else {
        console.error('[city] BRIDGE_API_TOKEN missing');
    }

    const stats = computeStats(sample, totals);
    const towerCities = new Set(city.towerCities || [city.bridgeCity]);
    const towers = TOWERS.filter(t => towerCities.has(t.city) || towerCities.has(t.area))
        .sort((a, b) => (a.city === city.bridgeCity ? 0 : 1) - (b.city === city.bridgeCity ? 0 : 1) || (a.priceFrom || 0) - (b.priceFrom || 0))
        .slice(0, 8);

    const html = renderCityPage({ city, listings, stats, towers, allCities: CITIES });

    // Healthy render: CDN-cache 30 min, serve stale up to a day while revalidating.
    // Degraded render (Bridge down): short cache so the next crawl gets real data.
    res.setHeader('Cache-Control', degraded ? 'public, s-maxage=60' : 'public, s-maxage=1800, stale-while-revalidate=86400');
    res.setHeader('X-Robots-Tag', 'index, follow');
    return res.status(200).send(html);
}
