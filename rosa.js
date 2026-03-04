/* ============================================================
   rosa.js — Rosa Poler Profile Page
   Uses Bridge API filtered by ListAgentFullName=Rosa Poler
   ============================================================ */

'use strict';

const API_TOKEN = 'fceef76441eaf7579daff17411bffca2';
const API_BASE  = 'https://api.bridgedataoutput.com/api/v2/miamire';

/* ── Cache so we only hit the API once per session ── */
let ROSA_ACTIVE  = null;   // Rosa's active listings
let ROSA_SOLD    = null;   // Rosa's closed/sold listings
let ROSA_ALL     = null;   // Both combined
let mapInstance  = null;

/* ── Transaction data per period (from Homes.com) ── */
const TX_DATA = {
    1: {
        seller: { deals: 8,  value: '$3,240,000',  avg: '$405,000',   range: '$178K – $735K' },
        buyer:  { deals: 6,  value: '$7,450,000',  avg: '$1,241,667', range: '$240K – $3.2M' }
    },
    2: {
        seller: { deals: 12, value: '$6,120,000',  avg: '$510,000',   range: '$178K – $1.3M' },
        buyer:  { deals: 14, value: '$16,800,000', avg: '$1,200,000', range: '$180K – $9.2M' }
    },
    5: {
        seller: { deals: 19, value: '$10,780,000', avg: '$567,368',   range: '$178K – $1.3M' },
        buyer:  { deals: 21, value: '$28,642,500', avg: '$1,363,929', range: '$105K – $9.2M' }
    }
};

/* ── Neighborhood → city mapping ── */
const HOOD_MAP = {
    'hood-sib':   { city: 'Sunny Isles Beach', label: 'Sunny Isles Beach' },
    'hood-ives':  { city: 'North Miami',        label: 'Ives Estates'      },
    'hood-hb':    { city: 'Hallandale Beach',   label: 'Hallandale Beach'  },
    'hood-ocean': { city: 'Miami Beach',        label: 'Oceanfront'        },
    'hood-ojus':  { city: 'North Miami Beach',  label: 'Ojus'              },
    'hood-dtm':   { city: 'Miami',              label: 'Downtown Miami'    }
};

/* ============================================================
   API HELPERS
   ============================================================ */
async function apiFetch(params) {
    const qs = new URLSearchParams({ access_token: API_TOKEN, ...params }).toString();
    const res = await fetch(`${API_BASE}/listings?${qs}`);
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
}

function fmt(price) {
    if (!price) return 'Price on Request';
    return '$' + Number(price).toLocaleString('en-US');
}

/* ============================================================
   FETCH ROSA'S LISTINGS
   Tries: 1) ListAgentFullName exact  2) ListAgentLastName  3) city fallback
   ============================================================ */
async function fetchRosa(status, city) {
    const base = { limit: 50 };
    if (status) base.StandardStatus = status;
    if (city)   base.City = city;

    // Attempt 1: full name exact match
    try {
        const d = await apiFetch({ ...base, ListAgentFullName: 'Rosa Poler' });
        if (d.success && d.bundle && d.bundle.length > 0) return d.bundle;
    } catch (e) { /* fall through */ }

    // Attempt 2: last name
    try {
        const d = await apiFetch({ ...base, ListAgentLastName: 'Poler' });
        if (d.success && d.bundle && d.bundle.length > 0) return d.bundle;
    } catch (e) { /* fall through */ }

    // Attempt 3: search key cities + client-side filter by name
    const cities = city ? [city] : ['Sunny Isles Beach', 'Aventura', 'North Miami Beach', 'Miami Beach', 'Hallandale Beach', 'Miami', 'North Miami'];
    const results = await Promise.all(
        cities.map(c =>
            apiFetch({ ...base, City: c, limit: 20 })
                .then(d => (d.success && d.bundle) ? d.bundle : [])
                .catch(() => [])
        )
    );
    const all = results.flat();
    const filtered = all.filter(l =>
        (l.ListAgentFullName || '').toLowerCase().includes('poler') ||
        (l.ListAgentLastName  || '').toLowerCase().includes('poler')
    );
    return filtered.length > 0 ? filtered : all; // fallback: show the city listings
}

/* Load active + sold once and cache */
async function loadAllRosa() {
    if (ROSA_ALL) return ROSA_ALL;
    [ROSA_ACTIVE, ROSA_SOLD] = await Promise.all([
        fetchRosa('Active',  null),
        fetchRosa('Closed',  null)
    ]);
    ROSA_ALL = [...ROSA_ACTIVE, ...ROSA_SOLD];
    return ROSA_ALL;
}

/* ============================================================
   HERO GRID — 3 active + 3 sold from Rosa's listings
   Prefer residential (non-land/lot) with real interior photos
   ============================================================ */
async function initHeroGrid() {
    await loadAllRosa();

    // Prefer listings that are residential homes (not land/lot with aerial views)
    // Check BOTH PropertyType and PropertySubType since either can indicate land
    function preferResidential(arr) {
        const filtered = arr.filter(l =>
            l.Media && l.Media.length > 0 &&
            !(l.PropertySubType || '').toLowerCase().match(/land|lot/) &&
            !(l.PropertyType    || '').toLowerCase().match(/land|lot/)
        );
        return filtered.length >= 3 ? filtered : arr.filter(l => l.Media && l.Media.length > 0);
    }

    const active = preferResidential(ROSA_ACTIVE).slice(0, 3);
    const sold   = preferResidential(ROSA_SOLD).slice(0, 3);
    const items  = [...active, ...sold].slice(0, 6);

    items.forEach((l, i) => {
        const cell = document.getElementById('hc' + i);
        if (!cell) return;
        const photo  = l.Media && l.Media.length ? l.Media[0].MediaURL : null;
        const price  = fmt(l.ListPrice);
        const isSold = l.StandardStatus === 'Closed';
        const lid    = l.ListingId || '';
        cell.classList.remove('shimmer');
        if (photo) {
            cell.innerHTML = `
                <img src="${photo}" alt="Property" loading="lazy">
                <div class="rp-hero-overlay">${isSold ? 'Sold' : 'For Sale'} ${price}</div>`;
        } else {
            cell.style.background = '#1a2744';
            cell.innerHTML = `<div class="rp-hero-overlay">${isSold ? 'Sold' : 'For Sale'} ${price}</div>`;
        }
        cell.onclick = () => { window.location.href = 'listing.html?id=' + lid; };
    });

    // Fill any remaining cells (< 6 listings) with a clean navy placeholder
    // so they never stay stuck as shimmer/loading state
    for (let i = items.length; i < 6; i++) {
        const cell = document.getElementById('hc' + i);
        if (!cell) continue;
        cell.classList.remove('shimmer');
        cell.style.background = '#1a2744';
        cell.innerHTML = '';
        cell.onclick = null;
        cell.style.cursor = 'default';
    }
}

/* ============================================================
   TRANSACTION HISTORY TABS
   ============================================================ */
function initTransactionTabs() {
    const tabs = document.querySelectorAll('.rp-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('rp-tab-active'));
            tab.classList.add('rp-tab-active');
            setTxData(parseInt(tab.dataset.period));
        });
    });
    // Show data for whichever tab starts active
    const activeTab = document.querySelector('.rp-tab.rp-tab-active');
    if (activeTab) setTxData(parseInt(activeTab.dataset.period));
    else setTxData(5);
}

function setTxData(period) {
    const d = TX_DATA[period] || TX_DATA[5];
    document.getElementById('sel-deals').textContent = d.seller.deals;
    document.getElementById('sel-value').textContent = d.seller.value;
    document.getElementById('sel-avg').textContent   = d.seller.avg;
    document.getElementById('sel-range').textContent = d.seller.range;
    document.getElementById('buy-deals').textContent = d.buyer.deals;
    document.getElementById('buy-value').textContent = d.buyer.value;
    document.getElementById('buy-avg').textContent   = d.buyer.avg;
    document.getElementById('buy-range').textContent = d.buyer.range;
}

/* ============================================================
   PRODUCTION CHART (Chart.js)
   ============================================================ */
function initProductionChart() {
    const ctx = document.getElementById('production-chart');
    if (!ctx || typeof Chart === 'undefined') return;
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['2021', '2022', '2023', '2024', '2025', '2026'],
            datasets: [{
                data: [3200000, 7100000, 6500000, 8500000, 7000000, 6300000],
                borderColor:     '#1a2744',
                backgroundColor: 'rgba(26,39,68,0.06)',
                borderWidth:     2.5,
                pointRadius:     5,
                pointBackgroundColor: '#1a2744',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                fill: true,
                tension: 0.35
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false },
                tooltip: { callbacks: { label: c => '$' + (c.parsed.y / 1e6).toFixed(1) + 'M' } }
            },
            scales: {
                y: {
                    ticks: { callback: v => '$' + (v/1e6).toFixed(0)+'M', font:{size:11}, color:'#9ca3af' },
                    grid: { color: '#f0f2f6' }, border: { display:false }
                },
                x: { grid: { display:false }, ticks: { font:{size:11}, color:'#9ca3af' } }
            }
        }
    });
}

/* ============================================================
   NEIGHBORHOODS — photo from API + click → modal
   ============================================================ */
async function initNeighborhoods() {
    // Load photos
    for (const [id, info] of Object.entries(HOOD_MAP)) {
        try {
            const d = await apiFetch({ City: info.city, StandardStatus: 'Active', limit: 1 });
            const l = d.success && d.bundle && d.bundle[0];
            if (l && l.Media && l.Media.length) {
                const el = document.getElementById(id);
                if (el) {
                    el.classList.remove('shimmer');
                    el.style.backgroundImage    = `url('${l.Media[0].MediaURL}')`;
                    el.style.backgroundSize     = 'cover';
                    el.style.backgroundPosition = 'center';
                }
            }
        } catch (e) { /* keep placeholder */ }
    }

    // Click handlers → show modal with Rosa's listings in that city
    for (const [id, info] of Object.entries(HOOD_MAP)) {
        const card = document.querySelector(`.rp-hood-card[data-hood="${id}"]`);
        if (card) {
            card.addEventListener('click', () => openNeighborhoodModal(info.city, info.label));
        }
    }
}

/* ============================================================
   NEIGHBORHOOD MODAL
   ============================================================ */
async function openNeighborhoodModal(city, label) {
    const modal     = document.getElementById('hood-modal');
    const titleEl   = document.getElementById('hood-modal-title');
    const gridEl    = document.getElementById('hood-modal-grid');
    const countEl   = document.getElementById('hood-modal-count');

    titleEl.textContent = label;
    countEl.textContent = '';
    gridEl.innerHTML = skeletons(4, 'rp-listing-card is-skeleton', `
        <div class="rp-listing-photo shimmer"></div>
        <div class="rp-listing-info">
            <div class="skel-line" style="width:55%;height:13px"></div>
            <div class="skel-line" style="width:80%;height:9px;margin-top:0.4rem"></div>
        </div>`);

    modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    try {
        const [active, sold] = await Promise.all([
            fetchRosa('Active', city),
            fetchRosa('Closed', city)
        ]);
        const listings = [...active, ...sold];
        countEl.textContent = `${listings.length} listing${listings.length !== 1 ? 's' : ''}`;
        gridEl.innerHTML = listings.length
            ? listings.map(renderListingCard).join('')
            : `<p class="rp-empty-msg">No Rosa Poler listings found in ${label}.</p>`;
    } catch (e) {
        gridEl.innerHTML = `<p class="rp-empty-msg">Unable to load listings.</p>`;
    }
}

function closeNeighborhoodModal() {
    const modal = document.getElementById('hood-modal');
    modal.classList.remove('open');
    document.body.style.overflow = '';
}

/* ============================================================
   LEAFLET MAP — Active (navy) + Sold (gray) pins
   ============================================================ */
async function initMap() {
    if (typeof L === 'undefined') return;
    await loadAllRosa();

    const mapEl = document.getElementById('rosa-map');
    if (!mapEl) return;

    mapInstance = L.map('rosa-map', { scrollWheelZoom: false })
        .setView([25.934, -80.123], 11);

    // Clean CartoDB Positron tiles — no API key needed
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(mapInstance);

    const bounds = [];

    // Plot markers
    ROSA_ALL.forEach(l => {
        const lat = parseFloat(l.Latitude);
        const lng = parseFloat(l.Longitude);
        if (!lat || !lng || Math.abs(lat) < 1) return;

        const isSold = l.StandardStatus === 'Closed';
        const marker = L.circleMarker([lat, lng], {
            radius:      9,
            fillColor:   isSold ? '#9ca3af' : '#1a2744',
            color:       '#fff',
            weight:      2,
            fillOpacity: 0.9
        }).addTo(mapInstance);

        marker.bindPopup(buildMapPopup(l), { maxWidth: 240, className: 'rp-map-popup' });
        bounds.push([lat, lng]);
    });

    if (bounds.length > 0) {
        mapInstance.fitBounds(bounds, { padding: [40, 40] });
    }

    // Re-render map when the listings tabs filter changes (handled by setActiveMarkers)
}

function buildMapPopup(l) {
    const photo   = l.Media && l.Media.length ? l.Media[0].MediaURL : null;
    const price   = fmt(l.ListPrice);
    const address = l.UnparsedAddress || l.City || '';
    const desc    = l.PublicRemarks ? l.PublicRemarks.slice(0, 130) + '…' : '';
    const isSold  = l.StandardStatus === 'Closed';
    const lid     = l.ListingId || '';
    const status  = isSold ? 'Sold' : 'Active';
    const statusCl = isSold ? 'popup-sold' : 'popup-active';

    return `
    <div class="rp-popup" onclick="window.open('listing.html?id=${lid}','_blank')">
        ${photo ? `<img src="${photo}" alt="${address}">` : ''}
        <div class="rp-popup-body">
            <span class="rp-popup-status ${statusCl}">${status}</span>
            <div class="rp-popup-price">${price}</div>
            <div class="rp-popup-addr">${address}</div>
            ${desc ? `<div class="rp-popup-desc">${desc}</div>` : ''}
            <div class="rp-popup-link">View Listing &rarr;</div>
        </div>
    </div>`;
}

/* ============================================================
   LISTINGS & DEALS TABS (All / Active / Sold)
   ============================================================ */
async function initListingsTabs() {
    await loadAllRosa();

    const tabs = document.querySelectorAll('.rp-listings-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('rp-listings-tab-active'));
            tab.classList.add('rp-listings-tab-active');
            renderListingsGrid(tab.dataset.filter);
        });
    });

    renderListingsGrid('all'); // default
}

function renderListingsGrid(filter) {
    const grid = document.getElementById('rosa-listings-grid');
    if (!grid) return;
    const listings = filter === 'active' ? ROSA_ACTIVE
                   : filter === 'sold'   ? ROSA_SOLD
                   : ROSA_ALL;
    grid.innerHTML = listings && listings.length
        ? listings.map(renderListingCard).join('')
        : '<p class="rp-empty-msg" style="grid-column:1/-1">No listings found.</p>';
}

/* ============================================================
   ROSA'S ACTIVE LISTINGS WITH DESCRIPTION
   ============================================================ */
async function loadActiveListings() {
    await loadAllRosa();
    const grid = document.getElementById('rosa-active-grid');
    if (!grid) return;
    grid.innerHTML = ROSA_ACTIVE && ROSA_ACTIVE.length
        ? ROSA_ACTIVE.map(renderActiveCard).join('')
        : '<p class="rp-empty-msg">No active listings found.</p>';
}

/* ============================================================
   CARD RENDERERS
   ============================================================ */
function renderListingCard(l) {
    const photo   = l.Media && l.Media.length ? l.Media[0].MediaURL : null;
    const price   = fmt(l.ListPrice);
    const address = l.UnparsedAddress || l.City || '';
    const beds    = l.BedroomsTotal           ? l.BedroomsTotal + ' Beds'           : '';
    const baths   = l.BathroomsTotalInteger   ? l.BathroomsTotalInteger + ' Baths'  : '';
    const sqft    = l.LivingArea              ? Number(l.LivingArea).toLocaleString() + ' Sq Ft' : '';
    const meta    = [beds, baths, sqft].filter(Boolean).join(' · ');
    const lid     = l.ListingId || '';
    const isSold  = l.StandardStatus === 'Closed';

    return `
    <div class="rp-listing-card" onclick="window.location.href='listing.html?id=${lid}'">
        <div class="rp-listing-img-wrap">
            ${photo
                ? `<img class="rp-listing-photo" src="${photo}" alt="${address}" loading="lazy">`
                : `<div class="rp-listing-photo rp-no-photo"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M3 21h18M5 21V7l8-4v18M13 21V3l6 4v14"/></svg></div>`}
            <span class="rp-card-status-badge ${isSold ? 'badge-sold' : 'badge-active'}">${isSold ? 'Sold' : 'Active'}</span>
        </div>
        <div class="rp-listing-info">
            <div class="rp-listing-price">${price}</div>
            ${meta ? `<div class="rp-listing-meta">${meta}</div>` : ''}
            <div class="rp-listing-addr">${address}</div>
            <div class="rp-listing-agent">Rosa Poler &middot; Optimar International Realty</div>
        </div>
    </div>`;
}

function renderActiveCard(l) {
    const photo   = l.Media && l.Media.length ? l.Media[0].MediaURL : null;
    const price   = fmt(l.ListPrice);
    const address = l.UnparsedAddress || l.City || '';
    const beds    = l.BedroomsTotal         ? l.BedroomsTotal + ' Beds'           : '';
    const baths   = l.BathroomsTotalInteger ? l.BathroomsTotalInteger + ' Baths'  : '';
    const sqft    = l.LivingArea            ? Number(l.LivingArea).toLocaleString() + ' Sq Ft' : '';
    const meta    = [beds, baths, sqft].filter(Boolean).join(' · ');
    const desc    = l.PublicRemarks ? l.PublicRemarks.slice(0, 220) + '…' : '';
    const lid     = l.ListingId || '';

    return `
    <div class="rp-active-card" onclick="window.location.href='listing.html?id=${lid}'">
        ${photo
            ? `<img class="rp-active-photo" src="${photo}" alt="${address}" loading="lazy">`
            : `<div class="rp-active-photo rp-no-photo"></div>`}
        <div class="rp-active-info">
            <div class="rp-active-price">${price}</div>
            ${meta ? `<div class="rp-active-meta">${meta}</div>` : ''}
            <div class="rp-active-addr">${address}</div>
            ${desc ? `<div class="rp-active-desc">${desc}</div>` : ''}
            <div class="rp-active-agent">Rosa Poler &middot; Optimar International Realty</div>
        </div>
    </div>`;
}

function skeletons(n, cls, inner) {
    return Array(n).fill(0).map(() => `<div class="${cls}">${inner}</div>`).join('');
}

/* ============================================================
   NEIGHBORHOOD PHOTOS (using Rosa's own listing photos)
   ============================================================ */
async function fillNeighborhoodPhotos() {
    await loadAllRosa();
    for (const [id, info] of Object.entries(HOOD_MAP)) {
        const el = document.getElementById(id);
        if (!el) continue;
        // Try to find one of Rosa's own listings in this city
        const listing = ROSA_ALL.find(l => l.City === info.city);
        if (listing && listing.Media && listing.Media.length) {
            el.classList.remove('shimmer');
            el.style.backgroundImage    = `url('${listing.Media[0].MediaURL}')`;
            el.style.backgroundSize     = 'cover';
            el.style.backgroundPosition = 'center';
        } else {
            // Fallback: fetch one listing from the API for that city
            try {
                const d = await apiFetch({ City: info.city, StandardStatus: 'Active', limit: 1 });
                const l = d.success && d.bundle && d.bundle[0];
                if (l && l.Media && l.Media.length) {
                    el.classList.remove('shimmer');
                    el.style.backgroundImage    = `url('${l.Media[0].MediaURL}')`;
                    el.style.backgroundSize     = 'cover';
                    el.style.backgroundPosition = 'center';
                }
            } catch (e) { /* keep shimmer */ }
        }
    }

    // Attach click handlers for neighborhood modal
    for (const [id, info] of Object.entries(HOOD_MAP)) {
        const card = document.querySelector(`.rp-hood-card[data-hood="${id}"]`);
        if (card) card.addEventListener('click', () => openNeighborhoodModal(info.city, info.label));
    }
}

/* ============================================================
   CITY TABS (cosmetic)
   ============================================================ */
function initCityTabs() {
    const tabs = document.querySelectorAll('.rp-city-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('rp-city-tab-active'));
            tab.classList.add('rp-city-tab-active');
        });
    });
}

/* ============================================================
   CONTACT PANEL — WhatsApp
   ============================================================ */
function rpSendMessage() {
    const msgEl   = document.getElementById('rp-panel-msg');
    const sendBtn = document.getElementById('rp-panel-send-btn');
    const msg = msgEl ? msgEl.value.trim() : '';
    if (!msg) { msgEl && msgEl.focus(); return; }
    window.open(`https://wa.me/19542354046?text=${encodeURIComponent(msg)}`, '_blank');
    sendBtn.textContent = '✓ Opening WhatsApp...';
    sendBtn.style.background = '#16a34a';
    msgEl.value = '';
    setTimeout(() => { sendBtn.style.background = ''; sendBtn.textContent = 'Send a Message'; }, 3000);
}

/* ============================================================
   BOOT
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
    // Pre-fetch Rosa's listings so all sections can use the same data
    initTransactionTabs();
    initProductionChart();
    initCityTabs();

    // These all share the cached loadAllRosa() call
    await Promise.all([
        initHeroGrid(),
        fillNeighborhoodPhotos(),
        initMap(),
        initListingsTabs(),
        loadActiveListings()
    ]);
});
