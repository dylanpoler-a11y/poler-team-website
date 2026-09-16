/**
 * lib/city-page.js — /<city>-condos-for-sale = the listing page, landed on a city.
 *
 * Kevin, 2026-09-16 (fourth correction on this page): "the whole layout has to
 * be exactly the same as the listings landing page… the only thing different
 * is that it lands on Hallandale." So this file no longer renders anything of
 * its own. It reads listing.html verbatim and changes ONLY:
 *   1. <head> SEO: title, description, canonical, og:*, geo, JSON-LD.
 *   2. The H1 / count / grid get the city's newest listings server-side so the
 *      HTML Google fetches already carries real inventory (listing.js re-renders
 *      the same query on load — identical cards, 50 per page, pagination).
 *   3. One line before listing.js: window.CITY_PAGE = {city} — listing.js treats
 *      it exactly like /listing?city=<city>.
 * Search band, filters, List/Map, Save search, "Explore South Florida
 * neighborhoods", footer, lead gate, i18n: all listing.html's own.
 */

import fs from 'node:fs';
import path from 'node:path';

export const ORIGIN = 'https://www.homesinsoflorida.com';
export const PAGE_SIZE = 50; // must match listing.js PAGE_SIZE

const TEMPLATE_PATH = path.join(process.cwd(), 'listing.html');
let cached = null;
function template() {
    if (!cached) cached = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    return cached;
}

export const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Inline JSON inside <script>: escape "<" so data can't close the tag. The two
// Unicode line separators are built with fromCharCode on purpose — an editor
// once turned the escape into the raw character and broke the file at import.
const LS = new RegExp(String.fromCharCode(0x2028), 'g');
const PS = new RegExp(String.fromCharCode(0x2029), 'g');
const jsonSafe = (obj) => JSON.stringify(obj)
    .replace(/</g, '\\u003c').replace(LS, '\\u2028').replace(PS, '\\u2029');

const num = (n) => Number(n || 0).toLocaleString('en-US');
const money = (n) => n ? '$' + num(Math.round(n)) : '';

function photoOf(l) {
    const m = Array.isArray(l.Media) ? l.Media : [];
    const first = m.find(p => p && p.MediaURL) || null;
    return first ? first.MediaURL : '';
}
function statsStr(l) {
    const parts = [];
    if (l.BedroomsTotal) parts.push(`${l.BedroomsTotal} bd`);
    if (l.BathroomsTotalInteger) parts.push(`${l.BathroomsTotalInteger} ba`);
    if (l.LivingArea) parts.push(`${num(l.LivingArea)} sf`);
    return parts.join(' · ');
}
const fmtDate = (iso) => {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }) : '';
};
const daysOn = (iso, now) => {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? Math.max(0, Math.floor((now - d) / 86400000)) : null;
};

/* Same markup listing.js renderCard() writes (minus the JS-only save heart),
   so the server-rendered grid and the client re-render look identical. */
function renderCard(l, now) {
    const photo = photoOf(l);
    const address = l.UnparsedAddress || l.City || 'South Florida';
    const lid = l.ListingId || '';
    const dom = daysOn(l.ListingContractDate, now);
    const isNew = dom != null && dom <= 7;
    const listed = fmtDate(l.ListingContractDate);
    const imgHtml = photo
        ? `<img class="listing-photo" src="${esc(photo)}" alt="${esc(address)}" loading="lazy">`
        : `<div class="listing-placeholder"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M3 21h18M5 21V7l8-4v18M13 21V3l6 4v14"/></svg></div>`;
    return `
    <div class="listing-card" data-lid="${esc(lid)}" onclick="window.location.href='listing?mls=${esc(lid)}'">
        <div class="listing-image" style="position:relative">
            ${imgHtml}
            <div class="pv-chips">
                <span class="pv-status status-active">Active</span>
                ${isNew ? '<span class="pv-new">New</span>' : ''}
            </div>
        </div>
        <div class="listing-details">
            <div class="listing-price">${esc(money(l.ListPrice))}</div>
            ${statsStr(l) ? `<div class="listing-stats">${esc(statsStr(l))}</div>` : ''}
            <div class="listing-address">${esc(address)}</div>
            <div class="listing-mls">${listed ? `Listed ${esc(listed)}` : ''}${dom != null ? ` · ${dom} days on market` : ''}${lid ? ` · MLS&reg;: ${esc(lid)}` : ''}</div>
        </div>
    </div>`;
}

function replaceOnce(html, from, to, label) {
    if (typeof from === 'string' ? !html.includes(from) : !from.test(html)) {
        throw new Error(`city-page: listing.html anchor missing: ${label}`);
    }
    return html.replace(from, to);
}

export function renderCityPage({ city, listings = [], total = 0, generatedAt = new Date() }) {
    const url = `${ORIGIN}/${city.slug}`;
    const title = `${city.name} ${city.titleTail} | The Poler Team`;
    const h1 = `${city.name} Homes for Sale`; // exactly what listing.js updateResultsTitle() writes for ?city=
    const now = generatedAt.getTime();
    const shown = Math.min(listings.length, PAGE_SIZE);
    const desc = total
        ? `${num(total)} condos, apartments and homes for sale in ${city.name}, FL right now. Live MLS listings updated daily, with photos, prices and days on market, from The Poler Team, based in Sunny Isles Beach.`
        : `Condos, apartments and homes for sale in ${city.name}, FL. Live MLS listings from The Poler Team, based in Sunny Isles Beach.`;
    const ogImage = listings.map(photoOf).find(Boolean) || '';

    const jsonld = {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'WebPage', '@id': url + '#page', url, name: title, description: desc,
                isPartOf: { '@type': 'WebSite', name: 'The Poler Team', url: ORIGIN + '/' },
                about: { '@type': 'City', name: city.name, containedInPlace: { '@type': 'AdministrativeArea', name: city.county + ', Florida' } },
                ...(ogImage ? { primaryImageOfPage: ogImage } : {}),
                dateModified: generatedAt.toISOString(),
            },
            {
                '@type': 'RealEstateAgent', '@id': ORIGIN + '/#agent', name: 'The Poler Team', url: ORIGIN + '/',
                telephone: '+1-954-235-4046',
                address: { '@type': 'PostalAddress', streetAddress: '18246 Collins Ave', addressLocality: 'Sunny Isles Beach', addressRegion: 'FL', postalCode: '33160', addressCountry: 'US' },
                parentOrganization: { '@type': 'Organization', name: 'Optimar International Realty' },
                areaServed: [{ '@type': 'City', name: city.name }],
            },
            {
                '@type': 'BreadcrumbList',
                itemListElement: [
                    { '@type': 'ListItem', position: 1, name: 'Home', item: ORIGIN + '/' },
                    { '@type': 'ListItem', position: 2, name: 'Listings', item: ORIGIN + '/listing' },
                    { '@type': 'ListItem', position: 3, name: h1, item: url },
                ],
            },
            ...(listings.length ? [{
                '@type': 'ItemList', name: `Newest ${city.name} listings`, numberOfItems: shown,
                itemListElement: listings.slice(0, shown).map((l, i) => ({
                    '@type': 'ListItem', position: i + 1,
                    url: `${ORIGIN}/listing?mls=${encodeURIComponent(l.ListingId || '')}`,
                    name: l.UnparsedAddress || `${city.name} home`,
                    ...(photoOf(l) ? { image: photoOf(l) } : {}),
                })),
            }] : []),
        ],
    };

    const headExtra = `<link rel="canonical" href="${url}">
    <meta property="og:type" content="website">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(desc)}">
    <meta property="og:url" content="${url}">
${ogImage ? `    <meta property="og:image" content="${esc(ogImage)}">\n` : ''}    <meta name="twitter:card" content="summary_large_image">
    <meta name="geo.region" content="US-FL">
    <meta name="geo.placename" content="${esc(city.name)}">
    <meta name="geo.position" content="${city.lat};${city.lng}">
    <script type="application/ld+json">${jsonSafe(jsonld)}</script>`;

    let html = template();
    html = replaceOnce(html, /<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`, 'title');
    html = replaceOnce(html, /<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`, 'description');
    html = replaceOnce(html, /<link rel="canonical" href="[^"]*">/, headExtra, 'canonical');
    html = replaceOnce(html, '<h1 class="results-title" id="results-title">South Florida Homes for Sale</h1>',
        `<h1 class="results-title" id="results-title">${esc(h1)}</h1>`, 'results-title');
    if (listings.length) {
        html = replaceOnce(html, '<p class="results-count" id="results-count" data-i18n="showingFeatured">Loading properties...</p>',
            `<p class="results-count" id="results-count">Showing 1-${shown} of ${num(total)} properties</p>`, 'results-count');
        html = replaceOnce(html, '<div class="results-grid" id="results-grid"></div>',
            `<div class="results-grid" id="results-grid">${listings.slice(0, shown).map(l => renderCard(l, now)).join('')}\n                </div>`, 'results-grid');
    }
    html = replaceOnce(html, '<script src="listing.js"></script>',
        `<script>window.CITY_PAGE = ${jsonSafe({ slug: city.slug, city: city.bridgeCity, name: city.name })};</script>\n<script src="listing.js"></script>`, 'listing.js');
    return html;
}

/* Unknown slug: the listing page itself, marked noindex. */
export function renderNotFound() {
    let html = template();
    html = html.replace(/<title>[^<]*<\/title>/, '<title>Area not found | The Poler Team</title>');
    html = html.replace(/<meta name="robots" content="[^"]*">/, '<meta name="robots" content="noindex, follow">');
    html = html.replace(/<link rel="canonical" href="[^"]*">/, '');
    return html;
}
