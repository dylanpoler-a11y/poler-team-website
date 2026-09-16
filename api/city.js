/**
 * /api/city?slug=<city-slug> — the listing page, landed on one city.
 *
 * Reached ONLY through the vercel.json rewrite `/:city-condos-for-sale` →
 * this function, so the public URL Google sees is /hallandale-beach-condos-for-sale.
 * Serves listing.html verbatim (see lib/city-page.js) with the city's newest
 * 50 active listings already in the grid and city-specific SEO tags, so Google
 * indexes real inventory instead of the JS-filtered /listing?city= view.
 *
 * One Bridge call per render (same BRIDGE_API_TOKEN api/bridge/listings.js
 * uses), fail-soft: a Bridge outage still serves the page (listing.js fetches
 * client-side as usual) with a short cache so the next crawl gets real data.
 * Healthy renders are CDN-cached 30 min and served stale for a day.
 */

import { findCity } from '../lib/cities-data.js';
import { renderCityPage, renderNotFound, PAGE_SIZE } from '../lib/city-page.js';

const BRIDGE_BASE = 'https://api.bridgedataoutput.com/api/v2/miamire/listings';
const CARD_FIELDS = 'ListingId,ListPrice,UnparsedAddress,City,BedroomsTotal,BathroomsTotalInteger,LivingArea,PropertySubType,Media,ListingContractDate,StandardStatus';

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
        return res.status(404).send(renderNotFound());
    }

    const token = process.env.BRIDGE_API_TOKEN;
    let listings = [];
    let total = 0;
    let degraded = !token;
    if (token) {
        try {
            // Same query listing.js runs for ?city=: active, for sale, newest first, 50/page.
            const j = await bridge({
                StandardStatus: 'Active', City: city.bridgeCity, PropertyType: 'Residential',
                sortBy: 'ListingContractDate', order: 'desc', 'ListingContractDate.gte': '1900-01-01',
                limit: String(PAGE_SIZE), fields: CARD_FIELDS,
            }, token);
            listings = (j.bundle || []).filter(l => l && l.ListPrice > 0);
            total = Number(j.total) || listings.length;
        } catch (e) {
            degraded = true;
            console.error('[city] bridge failed', city.slug, e && e.message);
        }
    } else {
        console.error('[city] BRIDGE_API_TOKEN missing');
    }

    const html = renderCityPage({ city, listings, total });
    res.setHeader('Cache-Control', degraded ? 'public, s-maxage=60' : 'public, s-maxage=1800, stale-while-revalidate=86400');
    res.setHeader('X-Robots-Tag', 'index, follow');
    return res.status(200).send(html);
}
