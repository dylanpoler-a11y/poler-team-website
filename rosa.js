/* ============================================================
   rosa.js — Rosa Poler Profile Page
   Handles: Hero grid, Chart, Neighborhoods, Listings, Tabs
   ============================================================ */

'use strict';

const API_TOKEN = 'fceef76441eaf7579daff17411bffca2';
const API_BASE  = 'https://api.bridgedataoutput.com/api/v2/miamire';

/* ── Transaction data per period ── */
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

/* ── API helper ── */
async function apiFetch(params) {
    const qs = new URLSearchParams({ access_token: API_TOKEN, ...params }).toString();
    const res = await fetch(`${API_BASE}/listings?${qs}`);
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
}

function fmt(price) {
    return '$' + Number(price || 0).toLocaleString('en-US');
}

/* ============================================================
   HERO GRID — 3 active + 3 sold from Sunny Isles Beach
   ============================================================ */
async function initHeroGrid() {
    try {
        const [aRes, sRes] = await Promise.all([
            apiFetch({ City: 'Sunny Isles Beach', StandardStatus: 'Active', limit: 3 }),
            apiFetch({ City: 'Sunny Isles Beach', StandardStatus: 'Closed', limit: 3 })
        ]);
        const actives = (aRes.success && aRes.bundle) ? aRes.bundle : [];
        const solds   = (sRes.success && sRes.bundle) ? sRes.bundle : [];
        const all = [...actives.slice(0, 3), ...solds.slice(0, 3)];

        all.forEach((l, i) => {
            const cell = document.getElementById('hc' + i);
            if (!cell) return;
            const photo = l.Media && l.Media.length ? l.Media[0].MediaURL : null;
            const price  = fmt(l.ListPrice);
            const sold   = l.StandardStatus === 'Closed';
            const lid    = l.ListingId || '';
            if (photo) {
                cell.classList.remove('shimmer');
                cell.innerHTML = `
                    <img src="${photo}" alt="Property" loading="lazy">
                    <div class="rp-hero-overlay">${sold ? 'Sold' : 'For Sale'} ${price}</div>`;
                cell.onclick = () => { window.location.href = 'listing.html?id=' + lid; };
            }
        });
    } catch (e) {
        console.warn('Hero grid:', e);
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
    if (!ctx) return;

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
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => '$' + (ctx.parsed.y / 1000000).toFixed(1) + 'M'
                    }
                }
            },
            scales: {
                y: {
                    ticks: {
                        callback: v => '$' + (v / 1000000).toFixed(0) + 'M',
                        font: { size: 11 },
                        color: '#9ca3af'
                    },
                    grid: { color: '#f0f2f6' },
                    border: { display: false }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 11 }, color: '#9ca3af' }
                }
            }
        }
    });
}

/* ============================================================
   NEIGHBORHOOD PHOTOS — one listing photo per city
   ============================================================ */
async function initNeighborhoods() {
    const hoods = [
        { id: 'hood-sib',   city: 'Sunny Isles Beach' },
        { id: 'hood-ives',  city: 'North Miami'        },
        { id: 'hood-hb',    city: 'Hallandale Beach'   },
        { id: 'hood-ocean', city: 'Miami Beach'         },
        { id: 'hood-ojus',  city: 'North Miami Beach'  },
        { id: 'hood-dtm',   city: 'Miami'               }
    ];

    for (const h of hoods) {
        try {
            const data = await apiFetch({ City: h.city, StandardStatus: 'Active', limit: 1 });
            const listing = data.success && data.bundle && data.bundle[0];
            if (listing && listing.Media && listing.Media.length) {
                const el = document.getElementById(h.id);
                if (el) {
                    el.classList.remove('shimmer');
                    el.style.backgroundImage  = `url('${listing.Media[0].MediaURL}')`;
                    el.style.backgroundSize   = 'cover';
                    el.style.backgroundPosition = 'center';
                }
            }
        } catch (e) { /* keep shimmer */ }
    }
}

/* ============================================================
   LISTINGS & DEALS TABS (All / Active / Sold)
   ============================================================ */
let listingsLoaded = {}; // cache per filter

function initListingsTabs() {
    const tabs = document.querySelectorAll('.rp-listings-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('rp-listings-tab-active'));
            tab.classList.add('rp-listings-tab-active');
            loadListings(tab.dataset.filter);
        });
    });
    loadListings('all');
}

async function loadListings(filter) {
    const grid = document.getElementById('rosa-listings-grid');
    if (!grid) return;

    if (listingsLoaded[filter]) { grid.innerHTML = listingsLoaded[filter]; return; }

    grid.innerHTML = skeletons(6, 'rp-listing-card is-skeleton', `
        <div class="rp-listing-photo shimmer"></div>
        <div class="rp-listing-info">
            <div class="skel-line" style="width:55%;height:13px"></div>
            <div class="skel-line" style="width:80%;height:9px;margin-top:0.4rem"></div>
        </div>`);

    const status = filter === 'sold' ? 'Closed' : 'Active';
    const cities = ['Sunny Isles Beach', 'Aventura', 'North Miami Beach'];

    try {
        const results = await Promise.all(
            cities.map(c => apiFetch({ City: c, StandardStatus: status, limit: 2 })
                .then(d => (d.success && d.bundle) ? d.bundle : [])
                .catch(() => []))
        );
        const listings = results.flat().slice(0, 6);
        const html = listings.length
            ? listings.map(renderListingCard).join('')
            : '<p style="padding:1rem;color:#6b7280;grid-column:1/-1">No listings found.</p>';
        listingsLoaded[filter] = html;
        grid.innerHTML = html;
    } catch (e) {
        grid.innerHTML = '<p style="padding:1rem;color:#6b7280;grid-column:1/-1">Unable to load listings.</p>';
    }
}

/* ============================================================
   ACTIVE LISTINGS WITH DESCRIPTION
   ============================================================ */
async function loadActiveListings() {
    const grid = document.getElementById('rosa-active-grid');
    if (!grid) return;

    grid.innerHTML = skeletons(3, 'rp-active-card', `
        <div class="rp-active-photo shimmer"></div>
        <div class="rp-active-info">
            <div class="skel-line" style="width:50%;height:14px"></div>
            <div class="skel-line" style="width:90%;height:9px;margin-top:0.5rem"></div>
            <div class="skel-line" style="width:70%;height:9px;margin-top:0.35rem"></div>
        </div>`);

    const cities = ['Sunny Isles Beach', 'Aventura', 'North Miami Beach'];
    try {
        const results = await Promise.all(
            cities.map(c => apiFetch({ City: c, StandardStatus: 'Active', limit: 1 })
                .then(d => (d.success && d.bundle) ? d.bundle : [])
                .catch(() => []))
        );
        const listings = results.flat().filter(Boolean).slice(0, 3);
        grid.innerHTML = listings.length
            ? listings.map(renderActiveCard).join('')
            : '<p style="color:#6b7280">No active listings found.</p>';
    } catch (e) {
        grid.innerHTML = '<p style="color:#6b7280">Unable to load listings.</p>';
    }
}

/* ── Card renderers ── */
function renderListingCard(l) {
    const photo   = l.Media && l.Media.length ? l.Media[0].MediaURL : null;
    const price   = fmt(l.ListPrice);
    const address = l.UnparsedAddress || l.City || '';
    const beds    = l.BedroomsTotal ? l.BedroomsTotal + ' Beds' : '';
    const baths   = l.BathroomsTotalInteger ? l.BathroomsTotalInteger + ' Baths' : '';
    const sqft    = l.LivingArea ? Number(l.LivingArea).toLocaleString() + ' Sq Ft' : '';
    const meta    = [beds, baths, sqft].filter(Boolean).join(' · ');
    const lid     = l.ListingId || '';

    return `
    <div class="rp-listing-card" onclick="window.location.href='listing.html?id=${lid}'">
        ${photo
            ? `<img class="rp-listing-photo" src="${photo}" alt="${address}" loading="lazy">`
            : `<div class="rp-listing-photo rp-no-photo">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M3 21h18M5 21V7l8-4v18M13 21V3l6 4v14"/></svg>
               </div>`}
        <div class="rp-listing-info">
            <div class="rp-listing-price">${price}</div>
            ${meta ? `<div class="rp-listing-meta">${meta}</div>` : ''}
            <div class="rp-listing-addr">${address}</div>
            <div class="rp-listing-agent">Rosa Poler · Optimar International Realty</div>
        </div>
    </div>`;
}

function renderActiveCard(l) {
    const photo   = l.Media && l.Media.length ? l.Media[0].MediaURL : null;
    const price   = fmt(l.ListPrice);
    const address = l.UnparsedAddress || l.City || '';
    const beds    = l.BedroomsTotal ? l.BedroomsTotal + ' Beds' : '';
    const baths   = l.BathroomsTotalInteger ? l.BathroomsTotalInteger + ' Baths' : '';
    const sqft    = l.LivingArea ? Number(l.LivingArea).toLocaleString() + ' Sq Ft' : '';
    const meta    = [beds, baths, sqft].filter(Boolean).join(' · ');
    const desc    = l.PublicRemarks ? l.PublicRemarks.slice(0, 220) + '...' : '';
    const lid     = l.ListingId || '';

    return `
    <div class="rp-active-card" onclick="window.location.href='listing.html?id=${lid}'">
        ${photo
            ? `<img class="rp-active-photo" src="${photo}" alt="${address}" loading="lazy">`
            : `<div class="rp-active-photo rp-no-photo"></div>`}
        <div class="rp-active-info">
            <div class="rp-active-price">
                ${price}
                ${meta ? `<span style="display:block;font-size:0.78rem;font-weight:500;color:#6b7280;margin-top:0.1rem">${meta}</span>` : ''}
            </div>
            <div class="rp-active-addr">${address}</div>
            ${desc ? `<div class="rp-active-desc">${desc}</div>` : ''}
            <div class="rp-active-agent">Rosa Poler · Optimar International Realty</div>
        </div>
    </div>`;
}

function skeletons(n, cls, inner) {
    return Array(n).fill(0).map(() => `<div class="${cls}">${inner}</div>`).join('');
}

/* ============================================================
   CITY TABS
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
    const msgEl  = document.getElementById('rp-panel-msg');
    const sendBtn = document.getElementById('rp-panel-send-btn');
    const msg = msgEl ? msgEl.value.trim() : '';
    if (!msg) { msgEl && msgEl.focus(); return; }

    const waUrl = `https://wa.me/19542354046?text=${encodeURIComponent(msg)}`;
    window.open(waUrl, '_blank');

    sendBtn.textContent = '✓ Message Sent!';
    sendBtn.style.background = '#16a34a';
    msgEl.value = '';

    setTimeout(() => {
        sendBtn.style.background = '';
        sendBtn.textContent = 'Send a Message';
    }, 3000);
}

/* ============================================================
   BOOT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
    initHeroGrid();
    initTransactionTabs();
    initProductionChart();
    initNeighborhoods();
    initListingsTabs();
    loadActiveListings();
    initCityTabs();
});
