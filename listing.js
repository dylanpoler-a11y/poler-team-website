/* ============================================================
   listing.js — Poler Team Listing Landing Page
   Handles: Lead capture, MLS hero, Property lookup, Search
   ============================================================ */

'use strict';

// ============================================================
// EMAILJS CONFIG
// 1. Sign up free at https://www.emailjs.com
// 2. Create a service (connect your Gmail/Outlook)
// 3. Create a template — use these variable names:
//    {{first_name}}, {{last_name}}, {{email}}, {{phone}},
//    {{listing_address}}, {{listing_price}}, {{page_url}}
// 4. Paste your keys below
// ============================================================
const EMAILJS_PUBLIC_KEY  = 'BXbUaPxSOHhgfGn6x';
const EMAILJS_SERVICE_ID  = 'service_d4ff5bs';
const EMAILJS_TEMPLATE_ID = 'template_932zy9s';

// ============================================================
// BRIDGE API CONFIG
// ============================================================
const API_TOKEN  = 'fceef76441eaf7579daff17411bffca2';
const API_BASE   = 'https://api.bridgedataoutput.com/api/v2/miamire';
const PAGE_SIZE  = 12;

// ============================================================
// STATE
// ============================================================
let heroListing    = null;   // Property shown in hero
let searchOffset   = 0;      // Pagination offset
let lastQuery      = {};     // Last search params
let totalResults   = 0;      // Total from API
let leadCaptured   = false;  // Has user already registered?
let timerInterval  = null;

// ============================================================
// UTILITIES
// ============================================================
function formatPrice(price) {
    if (!price) return 'Price on Request';
    return '$' + Number(price).toLocaleString('en-US');
}

function getPhoto(listing) {
    const m = listing && listing.Media;
    return (m && m.length) ? m[0].MediaURL : null;
}

function getAllPhotos(listing) {
    const m = listing && listing.Media;
    if (!m || !m.length) return [];
    return m.sort((a, b) => (a.Order || 0) - (b.Order || 0)).map(x => x.MediaURL);
}

function statsStr(listing) {
    const parts = [];
    if (listing.BedroomsTotal)         parts.push(`${listing.BedroomsTotal} bd`);
    if (listing.BathroomsTotalInteger) parts.push(`${listing.BathroomsTotalInteger} ba`);
    if (listing.LivingArea)            parts.push(`${Number(listing.LivingArea).toLocaleString()} sf`);
    return parts.join(' · ');
}

async function apiFetch(params) {
    const qs = new URLSearchParams({ access_token: API_TOKEN, ...params }).toString();
    const res = await fetch(`${API_BASE}/listings?${qs}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

// ============================================================
// LEAD CAPTURE — 10-second timer then forced modal
// ============================================================
function initLeadCapture() {
    // Check if already captured this session
    leadCaptured = !!localStorage.getItem('poler_lead_v1');
    if (leadCaptured) return;

    const overlay  = document.getElementById('lead-overlay');
    const bar      = document.getElementById('lead-timer-bar');
    const pageWrap = document.getElementById('page-wrap');

    // Init EmailJS
    if (typeof emailjs !== 'undefined' && EMAILJS_PUBLIC_KEY !== 'YOUR_PUBLIC_KEY') {
        emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
    }

    // Start 10-second countdown
    const DURATION = 10000;
    const START    = Date.now();

    timerInterval = setInterval(() => {
        const elapsed = Date.now() - START;
        const pct = Math.max(0, 1 - elapsed / DURATION);
        bar.style.transform = `scaleX(${pct})`;

        if (elapsed >= DURATION) {
            clearInterval(timerInterval);
            showLeadModal(overlay, pageWrap);
        }
    }, 80);

    // Form submission
    const form      = document.getElementById('lead-form');
    const submitBtn = document.getElementById('lead-submit-btn');
    const submitTxt = document.getElementById('lead-submit-text');
    const errorEl   = document.getElementById('lead-error');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const first = document.getElementById('lead-first').value.trim();
        const last  = document.getElementById('lead-last').value.trim();
        const email = document.getElementById('lead-email').value.trim();
        const phone = document.getElementById('lead-phone').value.trim();

        if (!first || !last || !email || !phone) {
            showLeadError('Please fill in all fields.');
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showLeadError('Please enter a valid email address.');
            return;
        }

        submitBtn.disabled = true;
        submitTxt.textContent = 'Saving...';
        errorEl.style.display = 'none';

        // Send lead via EmailJS
        const templateParams = {
            first_name:       first,
            last_name:        last,
            email:            email,
            phone:            phone,
            listing_address:  heroListing ? (heroListing.UnparsedAddress || heroListing.City || 'N/A') : 'Browse page',
            listing_price:    heroListing ? formatPrice(heroListing.ListPrice) : 'N/A',
            page_url:         window.location.href,
        };

        try {
            if (typeof emailjs !== 'undefined' && EMAILJS_SERVICE_ID !== 'YOUR_SERVICE_ID') {
                await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, templateParams);
            }
        } catch (err) {
            console.warn('EmailJS send failed:', err);
            // Still unlock page — don't punish user for email issues
        }

        // Mark as captured + unlock page
        localStorage.setItem('poler_lead_v1', email);
        leadCaptured = true;
        unlockPage(overlay, pageWrap);
    });
}

function showLeadModal(overlay, pageWrap) {
    pageWrap.classList.add('blurred');
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    document.getElementById('lead-first').focus();
}

function unlockPage(overlay, pageWrap) {
    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
    pageWrap.classList.remove('blurred');
}

function showLeadError(msg) {
    const el = document.getElementById('lead-error');
    el.textContent = msg;
    el.style.display = 'block';
    const btn = document.getElementById('lead-submit-btn');
    btn.disabled = false;
    document.getElementById('lead-submit-text').textContent = 'Access Property Details';
}

// ============================================================
// HERO PROPERTY — fetch listing by ?id= URL param
// ============================================================
async function initHeroProperty() {
    const params   = new URLSearchParams(window.location.search);
    const listingId = params.get('id');
    const container = document.getElementById('hero-property');

    if (!listingId) {
        renderDefaultHero(container);
        return;
    }

    try {
        const data = await apiFetch({ ListingId: listingId, limit: 1 });
        const listing = data.success && data.bundle && data.bundle[0];
        if (!listing) { renderDefaultHero(container); return; }
        heroListing = listing;
        renderHero(container, listing);
    } catch (err) {
        console.error('Hero fetch error:', err);
        renderDefaultHero(container);
    }
}

function renderHero(container, listing) {
    const photos  = getAllPhotos(listing);
    const price   = formatPrice(listing.ListPrice);
    const address = listing.UnparsedAddress || listing.City || 'South Florida';
    const city    = listing.City || '';
    const beds    = listing.BedroomsTotal;
    const baths   = listing.BathroomsTotalInteger;
    const sqft    = listing.LivingArea;
    const type    = listing.PropertySubType || listing.PropertyType || '';
    const agent   = listing.ListAgentFullName || '';
    const status  = listing.StandardStatus || 'Active';

    const photoHtml = photos.length
        ? `<img class="hero-gallery-img" id="hero-img" src="${photos[0]}" alt="${address}" loading="eager">`
        : `<div class="listing-placeholder" style="height:100%"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M3 21h18M5 21V7l8-4v18M13 21V3l6 4v14"/></svg></div>`;

    const galleryNav = photos.length > 1 ? `
        <button class="gallery-arrow gallery-prev" id="gallery-prev" aria-label="Previous photo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <button class="gallery-arrow gallery-next" id="gallery-next" aria-label="Next photo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <div class="gallery-counter" id="gallery-counter">1 / ${photos.length}</div>
    ` : '';

    container.innerHTML = `
    <div class="hero-property-wrap">
        <div class="hero-gallery">
            ${photoHtml}
            ${galleryNav}
        </div>
        <div class="hero-info">
            <div class="hero-status-badge">
                <span class="hero-status-dot"></span>
                ${status}
            </div>
            <div class="hero-price">${price}</div>
            <div class="hero-address">${address}</div>
            <div class="hero-stats">
                ${beds  ? `<div class="hero-stat"><span class="hero-stat-value">${beds}</span><span class="hero-stat-label">Beds</span></div>` : ''}
                ${baths ? `<div class="hero-stat"><span class="hero-stat-value">${baths}</span><span class="hero-stat-label">Baths</span></div>` : ''}
                ${sqft  ? `<div class="hero-stat"><span class="hero-stat-value">${Number(sqft).toLocaleString()}</span><span class="hero-stat-label">Sq Ft</span></div>` : ''}
            </div>
            ${type  ? `<div class="hero-type-row">${type}</div>` : ''}
            ${agent ? `<div class="hero-agent">Listed by <strong>${agent}</strong></div>` : ''}
            <a href="#search-section" class="hero-cta-btn">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                Browse More Properties
            </a>
        </div>
    </div>`;

    // Photo gallery navigation
    if (photos.length > 1) {
        let current = 0;
        const img      = container.querySelector('#hero-img');
        const counter  = container.querySelector('#gallery-counter');

        function goTo(idx) {
            current = (idx + photos.length) % photos.length;
            img.classList.add('fade');
            setTimeout(() => {
                img.src = photos[current];
                img.classList.remove('fade');
                counter.textContent = `${current + 1} / ${photos.length}`;
            }, 200);
        }

        container.querySelector('#gallery-prev').addEventListener('click', () => goTo(current - 1));
        container.querySelector('#gallery-next').addEventListener('click', () => goTo(current + 1));
    }
}

function renderDefaultHero(container) {
    container.innerHTML = `
    <div class="hero-default">
        <h1 class="hero-default-title">South Florida Luxury Real Estate</h1>
        <p class="hero-default-sub">Search thousands of active listings in Sunny Isles Beach, Aventura, North Miami Beach, and beyond.</p>
    </div>`;
}

// ============================================================
// PROPERTY LOOKUP — MLS # or Address (like Deal Analyzer)
// ============================================================
function initLookup() {
    // Advanced address toggle
    const toggle    = document.getElementById('lookup-adv-toggle');
    const panel     = document.getElementById('lookup-advanced');
    const label     = document.getElementById('lookup-adv-label');
    const chevron   = document.getElementById('lookup-adv-chevron');

    toggle.addEventListener('click', () => {
        const open = panel.classList.toggle('open');
        label.textContent = open ? 'Hide Advanced Address Search' : 'Show Advanced Address Search';
        chevron.style.transform = open ? 'rotate(180deg)' : '';
        toggle.setAttribute('aria-expanded', open);
    });

    // MLS # lookup
    const mlsInput = document.getElementById('lookup-mls');
    const mlsBtn   = document.getElementById('lookup-mls-btn');

    async function lookupByMls() {
        const id = mlsInput.value.trim();
        if (!id) return;
        mlsBtn.disabled = true;
        mlsBtn.textContent = 'Looking up...';
        showLookupLoading();
        try {
            const data = await apiFetch({ ListingId: id, limit: 1 });
            const listing = data.success && data.bundle && data.bundle[0];
            listing ? showLookupResult(listing) : showLookupError(`No listing found for MLS # ${id}`);
        } catch (err) {
            showLookupError('Lookup failed. Please check the MLS # and try again.');
        } finally {
            mlsBtn.disabled = false;
            mlsBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> Auto-Fill`;
        }
    }

    mlsBtn.addEventListener('click', lookupByMls);
    mlsInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lookupByMls(); } });

    // Address lookup
    const advBtn = document.getElementById('lookup-adv-btn');

    async function lookupByAddress() {
        const streetNum  = document.getElementById('adv-street-num').value.trim();
        const dir        = document.getElementById('adv-dir').value.trim();
        const streetName = document.getElementById('adv-street-name').value.trim();
        const unit       = document.getElementById('adv-unit').value.trim();
        const city       = document.getElementById('adv-city').value.trim();
        const zip        = document.getElementById('adv-zip').value.trim();

        if (!streetNum || !streetName) {
            showLookupError('Street # and Street Name are required.');
            return;
        }
        if (!city && !zip) {
            showLookupError('City or ZIP Code is required for accurate matching.');
            return;
        }

        advBtn.disabled = true;
        advBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg> Searching...`;
        showLookupLoading();

        const params = {
            StreetNumber: streetNum,
            StreetName:   streetName,
            limit:        5,
        };
        if (dir)  params.StreetDirPrefix = dir;
        if (unit) params.UnitNumber = unit;
        if (city) params.City = city;
        if (zip)  params.PostalCode = zip;

        try {
            const data = await apiFetch(params);
            const listing = data.success && data.bundle && data.bundle[0];
            listing ? showLookupResult(listing) : showLookupError('No listing found at that address. Try adjusting the fields.');
        } catch (err) {
            showLookupError('Lookup failed. Please check the address and try again.');
        } finally {
            advBtn.disabled = false;
            advBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg> Search`;
        }
    }

    advBtn.addEventListener('click', lookupByAddress);
}

function showLookupLoading() {
    const el = document.getElementById('lookup-result');
    el.style.display = 'block';
    el.innerHTML = `<div class="lookup-loading"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/></svg> Searching MLS database...</div>`;
}

function showLookupError(msg) {
    const el = document.getElementById('lookup-result');
    el.style.display = 'block';
    el.innerHTML = `<div class="lookup-error"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;margin-right:6px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>${msg}</div>`;
}

function showLookupResult(listing) {
    const el      = document.getElementById('lookup-result');
    const photo   = getPhoto(listing);
    const price   = formatPrice(listing.ListPrice);
    const address = listing.UnparsedAddress || listing.City || '';
    const stats   = statsStr(listing);
    const lid     = listing.ListingId || '';

    el.style.display = 'block';
    el.innerHTML = `
    <div class="lookup-result-inner">
        ${photo ? `<img class="lookup-result-photo" src="${photo}" alt="${address}" loading="lazy">` : ''}
        <div class="lookup-result-info">
            <div class="lookup-result-price">${price}</div>
            <div class="lookup-result-addr">${address}</div>
            ${stats ? `<div class="lookup-result-stats">${stats}</div>` : ''}
            <a href="listing.html?id=${lid}" class="lookup-result-view">
                View Full Listing
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </a>
        </div>
    </div>`;
}

// ============================================================
// YEAR SLIDER — dual range (pure CSS/JS)
// ============================================================
const YEAR_MIN_DEFAULT = 1900;
const YEAR_MAX_DEFAULT = 2026;

function initYearSlider() {
    const minInput = document.getElementById('year-min');
    const maxInput = document.getElementById('year-max');
    const fill     = document.getElementById('year-fill');
    const label    = document.getElementById('year-range-label');

    function update() {
        let min = parseInt(minInput.value);
        let max = parseInt(maxInput.value);
        if (min > max) { min = max; minInput.value = min; }
        if (max < min) { max = min; maxInput.value = max; }
        const range = YEAR_MAX_DEFAULT - YEAR_MIN_DEFAULT;
        const leftPct  = ((min - YEAR_MIN_DEFAULT) / range) * 100;
        const rightPct = ((YEAR_MAX_DEFAULT - max) / range) * 100;
        fill.style.left  = leftPct + '%';
        fill.style.right = rightPct + '%';

        if (min === YEAR_MIN_DEFAULT && max === YEAR_MAX_DEFAULT) {
            label.textContent = 'Any';
        } else {
            label.textContent = `${min} \u2013 ${max}`;
        }
    }

    minInput.addEventListener('input', update);
    maxInput.addEventListener('input', update);
    update(); // init
}

// ============================================================
// WATERFRONT TOGGLE
// ============================================================
function initWaterfrontToggle() {
    const toggle   = document.getElementById('f-waterfront');
    const subtypes = document.getElementById('waterfront-subtypes');
    toggle.addEventListener('change', () => {
        subtypes.style.display = toggle.checked ? 'flex' : 'none';
    });
}

// ============================================================
// FILTER SIDEBAR MOBILE TOGGLE
// ============================================================
function initFilterToggle() {
    const btn     = document.getElementById('filter-toggle');
    const body    = document.getElementById('filter-body');
    const label   = document.getElementById('filter-toggle-label');
    const chevron = document.getElementById('filter-toggle-chevron');

    btn.addEventListener('click', () => {
        const open = body.classList.toggle('open');
        label.textContent = open ? 'Hide Filters' : 'Show Filters';
        chevron.style.transform = open ? 'rotate(180deg)' : '';
        btn.setAttribute('aria-expanded', open);
    });

    // Advanced section toggle inside sidebar
    const advToggle = document.getElementById('filter-adv-toggle');
    const advPanel  = document.getElementById('filter-advanced');
    const advChev   = document.getElementById('filter-adv-chevron');

    advToggle.addEventListener('click', () => {
        const collapsed = advPanel.classList.toggle('collapsed');
        advChev.style.transform = collapsed ? 'rotate(180deg)' : '';
        advToggle.setAttribute('aria-expanded', !collapsed);
    });
}

// ============================================================
// SEARCH — build params + fetch from Bridge API
// ============================================================
function buildSearchParams() {
    const params = { limit: PAGE_SIZE, sortBy: 'ListPrice', order: 'desc' };

    // Location (comma-separated cities → multiple City params handled below)
    const loc = document.getElementById('f-location').value.trim();
    if (loc) params._cities = loc.split(',').map(s => s.trim()).filter(Boolean);

    // Property Type
    const type = document.getElementById('f-type').value;
    if (type !== 'all') {
        if (type === 'MultiFamily') {
            params.PropertyType = 'Residential';
            params.PropertySubType = 'Multi Family';
        } else {
            params.PropertyType = 'Residential';
            params.PropertySubType = type;
        }
    } else {
        params.PropertyType = 'Residential';
    }

    // Price
    const pMin = parseFloat(document.getElementById('f-price-min').value);
    const pMax = parseFloat(document.getElementById('f-price-max').value);
    const pErr = document.getElementById('price-error');
    if (!isNaN(pMin) && !isNaN(pMax) && pMin > pMax) { pErr.style.display = 'block'; return null; }
    pErr.style.display = 'none';
    if (!isNaN(pMin) && pMin > 0) params['ListPrice.gte'] = pMin * 1000;
    if (!isNaN(pMax) && pMax > 0) params['ListPrice.lte'] = pMax * 1000;

    // Beds / Baths
    const beds  = parseInt(document.getElementById('f-beds').value);
    const baths = parseInt(document.getElementById('f-baths').value);
    if (beds  > 0) params['BedroomsTotal.gte'] = beds;
    if (baths > 0) params['BathroomsTotalInteger.gte'] = baths;

    // Status (checkboxes — use first checked value for API, filter client-side for rest)
    const statusBoxes  = [...document.querySelectorAll('input[name="status"]:checked')];
    const statusValues = statusBoxes.map(b => b.value);
    if (statusValues.length === 1) {
        params.StandardStatus = statusValues[0];
    } else if (statusValues.length > 1) {
        params._statusList = statusValues; // handled in fetch
    }

    // Sqft
    const sqMin = parseInt(document.getElementById('f-sqft-min').value);
    const sqMax = parseInt(document.getElementById('f-sqft-max').value);
    if (!isNaN(sqMin) && sqMin > 0) params['LivingArea.gte'] = sqMin;
    if (!isNaN(sqMax) && sqMax > 0) params['LivingArea.lte'] = sqMax;

    // Year built
    const yMin = parseInt(document.getElementById('year-min').value);
    const yMax = parseInt(document.getElementById('year-max').value);
    if (yMin > YEAR_MIN_DEFAULT) params['YearBuilt.gte'] = yMin;
    if (yMax < YEAR_MAX_DEFAULT) params['YearBuilt.lte'] = yMax;

    // Lot size
    const lotMin = parseInt(document.getElementById('f-lot-min').value);
    const lotMax = parseInt(document.getElementById('f-lot-max').value);
    if (!isNaN(lotMin) && lotMin > 0) params['LotSizeSquareFeet.gte'] = lotMin;
    if (!isNaN(lotMax) && lotMax > 0) params['LotSizeSquareFeet.lte'] = lotMax;

    // County
    const county = document.getElementById('f-county').value.trim();
    if (county) params.CountyOrParish = county;

    // Waterfront
    if (document.getElementById('f-waterfront').checked) {
        params.WaterfrontYN = 'true';
        params._wfType = document.querySelector('input[name="wf-type"]:checked')?.value || 'any';
    }

    return params;
}

async function fetchListings(params, offset = 0) {
    // Handle multi-city: make parallel requests and merge
    const cities = params._cities;
    delete params._cities;
    const statusList = params._statusList;
    delete params._statusList;
    const wfType = params._wfType;
    delete params._wfType;

    params.offset = offset;

    let allListings = [];

    if (cities && cities.length > 1) {
        const requests = cities.map(city => {
            const p = { ...params, City: city };
            if (statusList) p.StandardStatus = statusList[0];
            return apiFetch(p).then(d => (d.success && Array.isArray(d.bundle)) ? d.bundle : []);
        });
        const results = await Promise.all(requests);
        allListings = results.flat();
        // Sort by price desc after merge
        allListings.sort((a, b) => (b.ListPrice || 0) - (a.ListPrice || 0));
    } else {
        if (cities && cities.length === 1) params.City = cities[0];
        if (statusList) params.StandardStatus = statusList[0];
        const data = await apiFetch(params);
        allListings = (data.success && Array.isArray(data.bundle)) ? data.bundle : [];
    }

    // Client-side filter for multiple statuses
    if (statusList && statusList.length > 1) {
        allListings = allListings.filter(l => statusList.includes(l.StandardStatus));
    }

    // Client-side filter for waterfront type
    if (wfType && wfType !== 'any') {
        const wfMap = { bay: 'bay', canal: 'canal', ocean: 'ocean' };
        allListings = allListings.filter(l => {
            const features = (l.WaterfrontFeatures || []).map(f => f.toLowerCase());
            return features.some(f => f.includes(wfMap[wfType]));
        });
    }

    return allListings;
}

// ============================================================
// RENDER LISTING CARDS
// ============================================================
function renderCard(listing) {
    const photo   = getPhoto(listing);
    const price   = formatPrice(listing.ListPrice);
    const address = listing.UnparsedAddress || listing.City || 'South Florida';
    const city    = listing.City || '';
    const stats   = statsStr(listing);
    const lid     = listing.ListingId || '';

    const imgHtml = photo
        ? `<img class="listing-photo" src="${photo}" alt="${address}" loading="lazy">`
        : `<div class="listing-placeholder"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M3 21h18M5 21V7l8-4v18M13 21V3l6 4v14"/></svg></div>`;

    return `
    <div class="listing-card" onclick="window.location.href='listing.html?id=${lid}'">
        <div class="listing-image">
            ${imgHtml}
            <div class="listing-overlay"><span class="listing-area">${city}</span></div>
        </div>
        <div class="listing-details">
            <div>
                <div class="listing-address">${address}</div>
                ${stats ? `<div class="listing-stats">${stats}</div>` : ''}
            </div>
            <div class="listing-price">${price}</div>
        </div>
    </div>`;
}

function renderSkeletons(n = 6) {
    return Array(n).fill(0).map(() => `
    <div class="listing-card is-skeleton">
        <div class="listing-image"></div>
        <div class="listing-details" style="flex-direction:column;gap:0.4rem;align-items:flex-start">
            <div class="skel-line" style="width:72%"></div>
            <div class="skel-line" style="width:45%"></div>
        </div>
    </div>`).join('');
}

// ============================================================
// SEARCH — main handler
// ============================================================
async function runSearch(append = false) {
    const grid       = document.getElementById('results-grid');
    const countEl    = document.getElementById('results-count');
    const noResults  = document.getElementById('no-results');
    const loadMore   = document.getElementById('load-more-wrap');
    const searchBtn  = document.getElementById('search-btn');
    const searchTxt  = document.getElementById('search-btn-text');

    const params = buildSearchParams();
    if (!params) return; // validation failed

    if (!append) {
        searchOffset = 0;
        grid.innerHTML = renderSkeletons();
        noResults.style.display = 'none';
        loadMore.style.display  = 'none';
        countEl.textContent = 'Searching...';
        lastQuery = { ...params };
    }

    searchBtn.disabled = true;
    searchTxt.textContent = 'Searching...';

    try {
        const listings = await fetchListings({ ...lastQuery }, searchOffset);

        if (!append) grid.innerHTML = '';

        if (!listings.length && !append) {
            noResults.style.display = 'block';
            countEl.textContent = 'No results found';
            loadMore.style.display = 'none';
            return;
        }

        listings.forEach(l => {
            grid.insertAdjacentHTML('beforeend', renderCard(l));
        });

        searchOffset += listings.length;
        totalResults = searchOffset; // approximate

        countEl.textContent = `Showing ${searchOffset} propert${searchOffset === 1 ? 'y' : 'ies'}`;
        loadMore.style.display = listings.length === PAGE_SIZE ? 'block' : 'none';

    } catch (err) {
        console.error('Search error:', err);
        if (!append) {
            grid.innerHTML = '';
            noResults.style.display = 'block';
            countEl.textContent = 'Search error — please try again';
        }
    } finally {
        searchBtn.disabled = false;
        searchTxt.textContent = 'Search Properties';
    }
}

function initSearch() {
    document.getElementById('search-btn').addEventListener('click', () => runSearch(false));

    document.getElementById('load-more-btn').addEventListener('click', () => {
        document.getElementById('load-more-btn').disabled = true;
        document.getElementById('load-more-btn').textContent = 'Loading...';
        runSearch(true).finally(() => {
            document.getElementById('load-more-btn').disabled = false;
            document.getElementById('load-more-btn').textContent = 'Load More Properties';
        });
    });

    // Enter key in filter inputs triggers search
    document.querySelectorAll('.filter-input, .filter-select').forEach(el => {
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); runSearch(false); }
        });
    });

    // Run default search on load (active residential, South Florida)
    runSearch(false);
}

// Inline spin animation for loading indicators
const spinStyle = document.createElement('style');
spinStyle.textContent = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
document.head.appendChild(spinStyle);

// ============================================================
// BOOT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    initLeadCapture();
    initHeroProperty();
    initLookup();
    initYearSlider();
    initWaterfrontToggle();
    initFilterToggle();
    initSearch();
});
