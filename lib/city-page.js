/**
 * lib/city-page.js — renders one indexable per-city landing page
 * (/<slug>, e.g. /sunny-isles-beach-condos-for-sale) from a city entry in
 * lib/cities-data.js + live Bridge MLS data supplied by api/city.js.
 *
 * Pure: no I/O. Everything Google needs (title, canonical, H1, listings,
 * FAQ, JSON-LD) is in the HTML string — nothing waits on client JS.
 *
 * LAYOUT RULE (Kevin, 2026-09-16, third time): every landing page on
 * homesinsoflorida.com is a variation of /listing. NO hero, NO video, NO hero
 * photo. Nav → the properties immediately, in the listing page's own
 * .results-grid/.listing-card markup, styled by listing.css (Inter everywhere,
 * 20px side padding, edge to edge). Long copy goes into multi-column grids so
 * no row leaves empty space on the right. Do not reintroduce a hero here.
 */

export const ORIGIN = 'https://www.homesinsoflorida.com';
const WA_NUMBER = '19542354046'; // Rosa Poler — same WhatsApp the listing page footer uses
const PHONE_DISPLAY = '(954) 235-4046';
const PHONE_TEL = '+19542354046';

export const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// JSON-LD inside <script>: escape "<" so a literal "</script>" in data can't end the block.
// U+2028/2029 are built with fromCharCode on purpose: an editor turned the "U+2028" escape
// into the raw character once and broke the regex at import time.
const LS = new RegExp(String.fromCharCode(0x2028), 'g');
const PS = new RegExp(String.fromCharCode(0x2029), 'g');
const jsonLdSafe = (obj) => JSON.stringify(obj)
    .replace(/</g, '\\u003c').replace(LS, '\\u2028').replace(PS, '\\u2029');

const num = (n) => Number(n || 0).toLocaleString('en-US');
const money = (n) => {
    if (!n) return '';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 2).replace(/\.?0+$/, '') + 'M';
    return '$' + num(Math.round(n));
};
const moneyFull = (n) => n ? '$' + num(Math.round(n)) : '';

/* Same header as listing.html (minus the language dropdown, which needs listing.js). */
const NAV = `    <header class="lp-header">
        <nav class="lp-nav">
            <div class="lp-nav-inner">
                <a href="/" class="lp-logo-link">
                    <img src="/logo-white.png" alt="The Poler Team" class="lp-nav-logo">
                </a>
                <div class="lp-nav-links">
                <a href="/" class="lp-nav-link">Home</a>
                <a href="/listing" class="lp-nav-link active">Listings</a>
                <a href="/preconstruction" class="lp-nav-link">Preconstruction</a>
                <a href="/str" class="lp-nav-link">Short-Term Rentals</a>
                <a href="/home-valuation" class="lp-nav-link">Home Valuation</a>
                <a href="/#hp-meet" class="lp-nav-link">About</a>
                <a href="tel:${PHONE_TEL}" class="lp-nav-link">Contact</a>
                <a href="tel:${PHONE_TEL}" class="lp-nav-link lp-nav-phone">${PHONE_DISPLAY}</a>
                </div>
                <div class="lp-nav-right">
                    <a href="tel:${PHONE_TEL}" class="lp-call-btn">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014.68 11.6 19.79 19.79 0 011.61 3a2 2 0 012-2.18h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.91 8.09a16 16 0 006 6l.91-.91a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
                        <span>Call Us</span>
                    </a>
                </div>
            </div>
        </nav>
    </header>`;

/* Same footer as listing.html; the alert form becomes a link because listing.js isn't loaded here. */
const footer = (allCities) => `    <footer class="lp-footer">
        <div class="footer-columns">
            <div class="footer-col">
                <h4 class="footer-col-title">Popular Searches</h4>
${allCities.map(c => `                <a href="/${esc(c.slug)}" class="footer-link">${esc(c.name)} Condos</a>`).join('\n')}
                <a href="/listing?city=Miami%20Beach" class="footer-link">Miami Beach Condos</a>
                <a href="/listing?city=Fort%20Lauderdale" class="footer-link">Fort Lauderdale Homes</a>
                <a href="/listing?city=Hollywood" class="footer-link">Hollywood Waterfront</a>
                <a href="/preconstruction" class="footer-link">New Construction</a>
            </div>
            <div class="footer-col">
                <h4 class="footer-col-title">Contact Us</h4>
                <p class="footer-contact-name">Rosa Poler, REALTOR&reg;</p>
                <a href="tel:${PHONE_TEL}" class="footer-link">&#128222; ${PHONE_DISPLAY}</a>
                <a href="mailto:rosa@homesinsoflorida.com" class="footer-link">&#9993;&#65039; rosa@homesinsoflorida.com</a>
                <p class="footer-brokerage">Optimar International Realty</p>
            </div>
            <div class="footer-col">
                <h4 class="footer-col-title">Follow Us</h4>
                <div class="footer-social">
                    <a href="https://instagram.com/thepolerteam" target="_blank" rel="noopener" class="footer-social-link" aria-label="Instagram">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
                    </a>
                    <a href="https://facebook.com/thepolerteam" target="_blank" rel="noopener" class="footer-social-link" aria-label="Facebook">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385h-3.047v-3.47h3.047v-2.642c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953h-1.514c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385c5.737-.9 10.125-5.864 10.125-11.854z"/></svg>
                    </a>
                    <a href="https://wa.me/${WA_NUMBER}" target="_blank" rel="noopener" class="footer-social-link" aria-label="WhatsApp">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    </a>
                </div>
            </div>
            <div class="footer-col">
                <h4 class="footer-col-title">Get Property Alerts</h4>
                <a href="/listing" class="footer-link">Set up alerts on the listing page &rarr;</a>
                <p class="footer-brokerage">Matching listings the day they hit the MLS.</p>
            </div>
        </div>
        <div class="lp-footer-inner">
            <img src="/logo-white.png" alt="The Poler Team" class="lp-footer-logo">
            <p class="lp-footer-copy">&copy; ${new Date().getFullYear()} The Poler Team &mdash; Optimar International Realty. All rights reserved. Listing data from the Miami Association of REALTORS&reg; MLS, refreshed throughout the day.</p>
            <a href="/" class="lp-footer-back">&#8592; Back to Main Site</a>
        </div>
    </footer>`;

/* Same search band as listing.html (search box + Buy/Rent/Sell + price/beds/baths),
   as a plain GET form to /listing. listing.js honors q/city/tab/pmin/pmax/beds/baths.
   The "Area" select jumps to another city page or a /listing?city= search. */
const OTHER_AREAS = ['Miami Beach', 'Bal Harbour', 'Surfside', 'North Miami Beach', 'Golden Beach', 'Hollywood', 'Fort Lauderdale', 'Pompano Beach', 'Boca Raton', 'Miami'];
function searchBand(city, allCities) {
    const cityOpts = allCities.map(c => `<option value="/${esc(c.slug)}"${c.slug === city.slug ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
    const otherOpts = OTHER_AREAS.filter(n => !allCities.some(c => c.bridgeCity === n))
        .map(n => `<option value="/listing?city=${encodeURIComponent(n)}">${esc(n)}</option>`).join('');
    const opts = (n, label) => Array.from({ length: n }, (_, i) => `<option value="${i + 1}">${i + 1}+ ${label}</option>`).join('');
    return `    <section class="search-hero cp-search" id="search-section">
        <div class="search-hero-inner">
            <form class="search-row" id="cp-search-form" action="/listing" method="get">
                <div class="search-tabs" id="cp-tabs">
                    <button type="button" class="search-tab active" data-tab="buy">Buy</button>
                    <button type="button" class="search-tab" data-tab="rent">Rent</button>
                    <a class="search-tab" href="/listing?tab=sell">Sell</a>
                </div>
                <input type="hidden" name="tab" id="cp-tab" value="buy">
                <input type="hidden" name="city" id="cp-city" value="${esc(city.bridgeCity)}">
                <div class="search-bar-wrap">
                    <div class="search-bar-container">
                        <svg class="search-bar-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                        <input type="text" name="q" id="cp-q" class="search-bar-input" placeholder="Address, City, or ZIP Code" autocomplete="off" aria-label="Search by address, city or ZIP">
                        <button type="submit" class="search-bar-btn" aria-label="Search">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                        </button>
                    </div>
                </div>
                <div class="filter-bar">
                    <div class="filter-bar-row">
                        <div class="filter-bar-item">
                            <select class="fb-select" id="cp-area" aria-label="Area" onchange="if(this.value)window.location.href=this.value">
                                <optgroup label="Area guides">${cityOpts}</optgroup>
                                <optgroup label="More areas">${otherOpts}</optgroup>
                                <option value="/listing">All South Florida</option>
                            </select>
                        </div>
                        <div class="filter-bar-item fb-price">
                            <input type="number" name="pmin" class="fb-input" placeholder="Min Price (000s)" title="Prices in thousands — 500 = $500,000" min="0">
                            <span class="fb-dash">&ndash;</span>
                            <input type="number" name="pmax" class="fb-input" placeholder="Max Price (000s)" title="Prices in thousands — 500 = $500,000" min="0">
                        </div>
                        <div class="filter-bar-item">
                            <select name="beds" class="fb-select" aria-label="Beds"><option value="">Beds</option>${opts(6, 'Beds')}</select>
                        </div>
                        <div class="filter-bar-item">
                            <select name="baths" class="fb-select" aria-label="Baths"><option value="">Baths</option>${opts(4, 'Baths')}</select>
                        </div>
                        <button type="submit" class="fb-search-btn">Search</button>
                    </div>
                </div>
            </form>
        </div>
    </section>
    <script>
    (function () {
        var form = document.getElementById('cp-search-form'), tab = document.getElementById('cp-tab');
        var tabs = document.querySelectorAll('#cp-tabs button');
        var pMin = form.querySelector('[name=pmin]'), pMax = form.querySelector('[name=pmax]');
        tabs.forEach(function (b) {
            b.addEventListener('click', function () {
                tabs.forEach(function (x) { x.classList.remove('active'); });
                b.classList.add('active'); tab.value = b.dataset.tab;
                var rent = b.dataset.tab === 'rent';
                pMin.placeholder = rent ? 'Min Rent' : 'Min Price (000s)';
                pMax.placeholder = rent ? 'Max Rent' : 'Max Price (000s)';
            });
        });
        // Build a clean /listing URL: free text wins over the page's city; drop empty fields.
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var p = new URLSearchParams();
            if (tab.value === 'rent') p.set('tab', 'rent');
            var q = document.getElementById('cp-q').value.trim();
            if (q) p.set('q', q); else p.set('city', document.getElementById('cp-city').value);
            ['pmin', 'pmax', 'beds', 'baths'].forEach(function (k) {
                var v = form.querySelector('[name=' + k + ']').value;
                if (v) p.set(k, v);
            });
            window.location.href = '/listing?' + p.toString();
        });
    })();
    </script>
`;
}

/* ── Listing helpers ─────────────────────────────────────────────────────── */
function photoOf(l) {
    const m = Array.isArray(l.Media) ? l.Media : [];
    const first = m.find(p => p && p.MediaURL && (!p.MediaCategory || /photo/i.test(p.MediaCategory))) || m[0];
    return first && first.MediaURL ? first.MediaURL : '';
}
const subtypeLabel = (s) => {
    s = String(s || '');
    if (/condo/i.test(s)) return 'Condo';
    if (/single family/i.test(s)) return 'House';
    if (/townhouse/i.test(s)) return 'Townhouse';
    if (/hotel/i.test(s)) return 'Condo-hotel';
    if (/villa/i.test(s)) return 'Villa';
    return s || 'Residence';
};
const isHouse = (s) => /single family|villa/i.test(String(s || ''));
const isCondo = (s) => /condo|townhouse|hotel/i.test(String(s || ''));

function statsLine(l) {
    const bits = [];
    if (l.BedroomsTotal != null) bits.push(`${l.BedroomsTotal === 0 ? 'Studio' : l.BedroomsTotal + ' bd'}`);
    if (l.BathroomsTotalInteger) bits.push(`${l.BathroomsTotalInteger} ba`);
    if (l.LivingArea) bits.push(`${num(l.LivingArea)} sq ft`);
    return bits.join(' · ');
}

const fmtDate = (iso) => {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }) : '';
};
const daysOn = (iso, now) => {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? Math.max(0, Math.floor((now - d) / 86400000)) : null;
};

/* Same markup + classes as listing.js renderCard(), so listing.css styles it identically. */
function renderCard(l, city, now) {
    const photo = photoOf(l);
    const addr = l.UnparsedAddress || `${city.name}, FL`;
    const id = l.ListingId || '';
    const href = `/listing?mls=${encodeURIComponent(id)}`;
    const label = subtypeLabel(l.PropertySubType);
    const alt = `${label} for sale at ${addr}`;
    const dom = daysOn(l.ListingContractDate, now);
    const isNew = dom != null && dom <= 7;
    const listed = fmtDate(l.ListingContractDate);
    const meta = [listed ? `Listed ${listed}` : '', id ? `MLS&reg;: ${esc(id)}` : ''].filter(Boolean).join(' · ');
    return `        <a class="listing-card" href="${esc(href)}" data-lid="${esc(id)}">
            <div class="listing-image">
                ${photo
                    ? `<img class="listing-photo" src="${esc(photo)}" alt="${esc(alt)}" loading="lazy" width="640" height="400">`
                    : `<div class="listing-placeholder"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M3 21h18M5 21V7l8-4v18M13 21V3l6 4v14"/></svg></div>`}
                <div class="pv-chips">
                    <span class="pv-status status-active">Active</span>
                    ${isNew ? '<span class="pv-new">New</span>' : ''}
                </div>
            </div>
            <div class="listing-details">
                <div class="listing-price">${esc(moneyFull(l.ListPrice))}</div>
                ${statsLine(l) ? `<div class="listing-stats">${esc(statsLine(l))}</div>` : ''}
                <div class="listing-address">${esc(addr)}</div>
                <div class="listing-mls">${meta}</div>
            </div>
        </a>`;
}

/* ── Market snapshot from a sample of active listings ───────────────────── */
export function computeStats(sample, totals) {
    const prices = sample.map(l => Number(l.ListPrice)).filter(p => p > 0).sort((a, b) => a - b);
    const ppsf = sample.filter(l => l.ListPrice > 0 && l.LivingArea > 200).map(l => l.ListPrice / l.LivingArea).sort((a, b) => a - b);
    const median = (arr) => arr.length ? (arr.length % 2 ? arr[(arr.length - 1) / 2] : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2) : 0;
    return {
        total: totals.sale || sample.length,
        rentals: totals.rent || 0,
        sampleSize: sample.length,
        min: prices[0] || 0,
        max: prices[prices.length - 1] || 0,
        median: median(prices),
        medianPpsf: median(ppsf),
        condos: sample.filter(l => isCondo(l.PropertySubType)).length,
        houses: sample.filter(l => isHouse(l.PropertySubType)).length,
        waterfront: sample.filter(l => l.WaterfrontYN === true).length,
        under500: sample.filter(l => l.ListPrice > 0 && l.ListPrice < 500000).length,
        over2m: sample.filter(l => l.ListPrice >= 2000000).length,
    };
}

const HEAD_COMMON = `<link rel="icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preconnect" href="https://dvvjkgh94f2v6.cloudfront.net">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/listing.css">
<link rel="stylesheet" href="/city.css">`;

/* ── Page ────────────────────────────────────────────────────────────────── */
export function renderCityPage({ city, listings = [], stats, towers = [], allCities = [], generatedAt = new Date() }) {
    const url = `${ORIGIN}/${city.slug}`;
    const title = `${city.name} ${city.titleTail} | The Poler Team`;
    const h1 = `${city.name} Condos for Sale`;
    const s = stats || computeStats(listings, {});
    const hasData = listings.length > 0;
    const now = generatedAt.getTime();

    const metaDesc = hasData
        ? `${num(s.total)} condos, apartments and homes for sale in ${city.name}, FL right now, from ${money(s.min)} to ${money(s.max)} (median ${money(s.median)}). Live MLS listings, buildings guide and new construction from The Poler Team, based in Sunny Isles Beach.`
        : `Condos, apartments and homes for sale in ${city.name}, FL. Live MLS listings, neighborhoods guide, new construction and buyer FAQ from The Poler Team, based in Sunny Isles Beach.`;

    // Social preview only (there is no hero on the page): first listing photo.
    const ogImg = (listings.find(l => photoOf(l)) || {});
    const ogImage = ogImg.ListingId ? photoOf(ogImg) : '';

    const searchUrl = `/listing?city=${encodeURIComponent(city.bridgeCity)}`;
    const waUrl = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(`Hi Rosa, I'm looking at ${city.name} condos for sale on homesinsoflorida.com`)}`;

    const countLine = hasData
        ? `Showing the ${num(listings.length)} newest of ${num(s.total)} properties for sale in ${city.name}, FL ${city.zips.join(', ')} · median ${money(s.median)}${s.medianPpsf ? ` · $${num(Math.round(s.medianPpsf))}/sq ft` : ''} · updated from the MLS today`
        : `${city.name}, FL ${city.zips.join(', ')} · live MLS inventory`;

    const statTiles = hasData ? [
        ['Active listings for sale', num(s.total)],
        ['Active rentals', s.rentals ? num(s.rentals) : '—'],
        ['Median asking price', moneyFull(s.median)],
        ['Median price per sq ft', s.medianPpsf ? '$' + num(Math.round(s.medianPpsf)) : '—'],
        ['Lowest asking price', moneyFull(s.min)],
        ['Highest asking price', moneyFull(s.max)],
        [`Condos · houses (newest ${num(s.sampleSize)})`, `${num(s.condos)} · ${num(s.houses)}`],
        [`Waterfront (newest ${num(s.sampleSize)})`, num(s.waterfront)],
        [`Under $500K (newest ${num(s.sampleSize)})`, num(s.under500)],
        [`Over $2M (newest ${num(s.sampleSize)})`, num(s.over2m)],
    ] : [];

    const towerBlock = towers.length ? `
    <section class="cp-section" id="new-construction">
        <h2>New construction in and around ${esc(city.name)}</h2>
        <ul class="cp-towers">
${towers.map(t => `            <li><a href="/tower/${esc(t.id)}">${esc(t.name)}</a><span>${esc([t.area !== t.city ? t.area : '', t.city, t.deliveryLabel ? 'delivery ' + t.deliveryLabel : '', t.pricingFrom || ''].filter(Boolean).join(' · '))}</span></li>`).join('\n')}
            <li><a href="/preconstruction">All South Florida preconstruction &rarr;</a><span>Every tower we track, with pricing and deposit schedules</span></li>
        </ul>
    </section>` : '';

    const others = allCities.filter(c => c.slug !== city.slug);

    const jsonld = {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'WebPage',
                '@id': url + '#page',
                url,
                name: title,
                description: metaDesc,
                isPartOf: { '@type': 'WebSite', name: 'The Poler Team', url: ORIGIN + '/' },
                about: { '@type': 'City', name: city.name, containedInPlace: { '@type': 'AdministrativeArea', name: city.county + ', Florida' } },
                ...(ogImage ? { primaryImageOfPage: ogImage } : {}),
                dateModified: generatedAt.toISOString(),
            },
            {
                '@type': 'RealEstateAgent',
                '@id': ORIGIN + '/#agent',
                name: 'The Poler Team',
                url: ORIGIN + '/',
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
            ...(hasData ? [{
                '@type': 'ItemList',
                name: `Newest ${city.name} listings`,
                numberOfItems: listings.length,
                itemListElement: listings.map((l, i) => ({
                    '@type': 'ListItem', position: i + 1,
                    url: `${ORIGIN}/listing?mls=${encodeURIComponent(l.ListingId || '')}`,
                    name: l.UnparsedAddress || `${city.name} ${subtypeLabel(l.PropertySubType)}`,
                    ...(photoOf(l) ? { image: photoOf(l) } : {}),
                })),
            }] : []),
            {
                '@type': 'FAQPage',
                mainEntity: city.faq.map(f => ({
                    '@type': 'Question', name: f.q,
                    acceptedAnswer: { '@type': 'Answer', text: f.a },
                })),
            },
        ],
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
<!-- Google Analytics 4 + Google Ads -->
<script src="/analytics.js"></script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(metaDesc)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(metaDesc)}">
<meta property="og:url" content="${url}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="geo.region" content="US-FL">
<meta name="geo.placename" content="${esc(city.name)}">
<meta name="geo.position" content="${city.lat};${city.lng}">
${HEAD_COMMON}
<script type="application/ld+json">${jsonLdSafe(jsonld)}</script>
</head>
<body class="cp-body">
${NAV}

<main>
${searchBand(city, allCities)}
<section class="browse-section" id="browse-section">
    <div class="browse-inner">
        <nav class="cp-crumbs" aria-label="Breadcrumb"><a href="/">Home</a> <span>/</span> <a href="/listing">Listings</a> <span>/</span> <span aria-current="page">${esc(city.name)}</span></nav>
        <div class="results-header">
            <div>
                <h1 class="results-title">${esc(h1)}</h1>
                <p class="results-count">${esc(countLine)}</p>
            </div>
            <div class="cp-row">
                <a class="cp-btn" href="${esc(waUrl)}" rel="noopener">WhatsApp Rosa</a>
                <a class="cp-btn cp-btn-primary" href="${esc(searchUrl)}">See all ${hasData ? num(s.total) + ' ' : ''}${esc(city.short)} listings</a>
            </div>
        </div>
${hasData ? `        <div class="results-grid">
${listings.map(l => renderCard(l, city, now)).join('\n')}
        </div>
        <div class="pagination-wrap">
            <a class="page-btn cp-page-more" href="${esc(searchUrl)}">See all ${num(s.total)} ${esc(city.name)} listings &rarr;</a>
        </div>`
        : `        <p class="cp-empty">Live listings are loading from the MLS. <a href="${esc(searchUrl)}">Open the full ${esc(city.name)} search</a> for every active condo, apartment and home.</p>`}

${hasData ? `    <section class="cp-section" id="market">
        <h2>${esc(city.name)} market snapshot</h2>
        <p class="cp-note">Active MLS inventory as of ${esc(generatedAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }))}. Medians and splits are computed from the ${num(s.sampleSize)} most recently listed properties.</p>
        <dl class="cp-stats">
${statTiles.map(([k, v]) => `            <div class="cp-stat"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('\n')}
        </dl>
    </section>` : ''}

    <section class="cp-section" id="about">
        <h2>Buying in ${esc(city.name)}</h2>
        <p class="cp-note">${esc(city.tagline)}</p>
        <div class="cp-cols cp-cols-3">
${city.intro.map(p => `            <p>${esc(p)}</p>`).join('\n')}
        </div>
        <h3 class="cp-sub">What we check before you offer</h3>
        <div class="cp-cols cp-cols-4">
${city.buyerNotes.map(n => `            <div class="cp-tile"><p>${esc(n)}</p></div>`).join('\n')}
        </div>
    </section>

    <section class="cp-section" id="neighborhoods">
        <h2>Where to look in ${esc(city.name)}</h2>
        <div class="cp-cols cp-cols-4">
${city.neighborhoods.map(n => `            <article class="cp-tile"><h3>${esc(n.name)}</h3><p>${esc(n.blurb)}</p></article>`).join('\n')}
        </div>
    </section>
${towerBlock}

    <section class="cp-section" id="faq">
        <h2>${esc(city.name)} buyer questions</h2>
        <div class="cp-faq">
${city.faq.map(f => `            <details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n')}
        </div>
    </section>

    <section class="cp-section" id="more-areas">
        <h2>More South Florida areas</h2>
        <ul class="cp-areas">
${others.map(c => `            <li><a href="/${esc(c.slug)}">${esc(c.name)} condos for sale</a></li>`).join('\n')}
            <li><a href="/listing">All South Florida listings</a></li>
            <li><a href="/str">Buildings that allow short-term rentals</a></li>
            <li><a href="/preconstruction">Preconstruction towers</a></li>
        </ul>
    </section>
    </div>
</section>

<section class="cp-cta" id="inquire">
    <div class="browse-inner cp-cta-inner">
        <div>
            <h2>Looking in ${esc(city.name)}? Talk to the team that lives here.</h2>
            <p>The Poler Team is based on Collins Avenue in Sunny Isles Beach. Send us your budget and what you want to see, and we will send matching ${esc(city.name)} listings the day they hit the market, in English, Spanish or Portuguese.</p>
        </div>
        <div class="cp-row">
            <a class="cp-btn cp-btn-primary" href="${esc(waUrl)}" rel="noopener">WhatsApp Rosa</a>
            <a class="cp-btn" href="tel:${PHONE_TEL}">${PHONE_DISPLAY}</a>
            <a class="cp-btn" href="${esc(searchUrl)}">Set up ${esc(city.short)} alerts</a>
        </div>
    </div>
</section>
</main>

${footer(allCities)}
<script src="/lead-gate.js" defer></script>
<script src="/nav.js" defer></script>
</body>
</html>
`;
}

export function renderNotFound(allCities = []) {
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Area not found | The Poler Team</title><meta name="robots" content="noindex, follow">
${HEAD_COMMON}</head>
<body class="cp-body">${NAV}
<main><section class="browse-section"><div class="browse-inner">
<div class="results-header"><div><h1 class="results-title">We don't have a page for that area yet</h1>
<p class="results-count">Try one of these, or <a href="/listing">search every South Florida listing</a>.</p></div></div>
<ul class="cp-areas">${allCities.map(c => `<li><a href="/${esc(c.slug)}">${esc(c.name)} condos for sale</a></li>`).join('')}</ul>
</div></section></main>${footer(allCities)}<script src="/nav.js" defer></script></body></html>`;
}
