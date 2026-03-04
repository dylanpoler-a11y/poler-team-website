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
    const photos       = getAllPhotos(listing);
    const price        = formatPrice(listing.ListPrice);
    const address      = listing.UnparsedAddress || listing.City || 'South Florida';
    const beds         = listing.BedroomsTotal;
    const baths        = listing.BathroomsTotalInteger;
    const sqft         = listing.LivingArea;
    const lotSqft      = listing.LotSizeSquareFeet;
    const pricePerSqft = (listing.ListPrice && sqft) ? Math.round(listing.ListPrice / sqft) : null;
    const type         = listing.PropertySubType || listing.PropertyType || '';
    const status       = listing.StandardStatus || 'Active';
    const yearBuilt    = listing.YearBuilt || '';
    const subdivision  = listing.SubdivisionName || listing.CommunityName || '';
    const description  = listing.PublicRemarks || '';
    const agentName    = listing.ListAgentFullName || '';
    const brokerageName = listing.ListOfficeName || '';
    const agentLicense = listing.ListAgentStateLicenseNumber || '';
    const listDate     = listing.ListingContractDate || '';
    const dom          = listing.DaysOnMarket != null ? listing.DaysOnMarket : (listing.CumulativeDaysOnMarket || '');
    const garage       = listing.GarageSpaces || listing.ParkingTotal || '';
    const hasPool      = !!(listing.PoolYN || (listing.PoolFeatures && listing.PoolFeatures.length));
    const hasWaterfront = !!listing.WaterfrontYN;
    const cooling      = listing.Cooling ? (Array.isArray(listing.Cooling) ? listing.Cooling.join(', ') : listing.Cooling) : '';
    const heating      = listing.Heating ? (Array.isArray(listing.Heating) ? listing.Heating.join(', ') : listing.Heating) : '';
    const views        = listing.View ? (Array.isArray(listing.View) ? listing.View.join(', ') : listing.View) : '';
    const hoaFee       = listing.AssociationFee ? `$${Number(listing.AssociationFee).toLocaleString()}/mo` : '';

    // ---------- Photo grid ----------
    const mainPhoto   = photos[0] || null;
    const thumbPhotos = photos.slice(1, 5);

    const mainPhotoHtml = mainPhoto
        ? `<img class="lp-photo-main-img" src="${mainPhoto}" alt="${address}" loading="eager">`
        : `<div class="lp-photo-placeholder"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M3 21h18M5 21V7l8-4v18M13 21V3l6 4v14"/></svg></div>`;

    const thumbsHtml = thumbPhotos.map((url, i) => {
        const isLast = i === thumbPhotos.length - 1 && photos.length > 5;
        return `
        <div class="lp-photo-thumb" onclick="lpOpenGallery(${i + 1})">
            <img class="lp-photo-thumb-img" src="${url}" alt="Photo ${i + 2}" loading="lazy">
            ${isLast ? `<div class="lp-photo-see-all">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                See All ${photos.length} Photos
            </div>` : ''}
        </div>`;
    }).join('');

    // ---------- Stats bar ----------
    const statItems = [
        beds         ? { v: beds,                                     l: 'Beds' }        : null,
        baths        ? { v: baths,                                    l: 'Baths' }       : null,
        sqft         ? { v: Number(sqft).toLocaleString(),            l: 'Sq Ft' }       : null,
        pricePerSqft ? { v: `$${pricePerSqft.toLocaleString()}`,      l: 'Price / Sq Ft' } : null,
    ].filter(Boolean);

    const statsHtml = statItems.map((s, i) => `
        ${i > 0 ? '<div class="lp-info-stat-div"></div>' : ''}
        <div class="lp-info-stat">
            <span class="lp-info-stat-value">${s.v}</span>
            <span class="lp-info-stat-label">${s.l}</span>
        </div>`).join('');

    // ---------- Highlights ----------
    const highlights = [
        beds         ? { icon: '🛏',  label: `${beds} Bedroom${beds > 1 ? 's' : ''}` }        : null,
        baths        ? { icon: '🚿',  label: `${baths} Bathroom${baths > 1 ? 's' : ''}` }     : null,
        sqft         ? { icon: '📐',  label: `${Number(sqft).toLocaleString()} Sq Ft` }        : null,
        garage       ? { icon: '🚗',  label: `${garage}-Car Garage` }                          : null,
        hasPool      ? { icon: '🏊',  label: 'Pool' }                                          : null,
        hasWaterfront? { icon: '🌊',  label: 'Waterfront' }                                    : null,
        yearBuilt    ? { icon: '📅',  label: `Built ${yearBuilt}` }                            : null,
        hoaFee       ? { icon: '🏢',  label: `HOA ${hoaFee}` }                                 : null,
        lotSqft      ? { icon: '🌳',  label: `${Number(lotSqft).toLocaleString()} Lot Sq Ft` } : null,
        type         ? { icon: '🏠',  label: type }                                            : null,
    ].filter(Boolean);

    const highlightsHtml = highlights.map(h => `
        <div class="lp-highlight-item">
            <span class="lp-highlight-icon">${h.icon}</span>
            <span class="lp-highlight-label">${h.label}</span>
        </div>`).join('');

    // ---------- Description ----------
    const descHtml = description ? `
        <div class="lp-section">
            <h2 class="lp-section-title">About This Home</h2>
            <div class="lp-desc-wrap">
                <p class="lp-desc-text" id="lp-desc-text">${description}</p>
                ${description.length > 320 ? `<button class="lp-desc-toggle" id="lp-desc-toggle" onclick="lpToggleDesc()">Show More</button>` : ''}
            </div>
        </div>` : '';

    // ---------- Listing details ----------
    const listDateFormatted = listDate
        ? new Date(listDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : '';

    const listingRows = [
        agentName       ? [agentName, 'Listing Agent']  : null,
        brokerageName   ? [brokerageName, 'Brokerage']  : null,
        agentLicense    ? [agentLicense, 'License #']   : null,
        listDateFormatted ? [listDateFormatted, 'Listed']: null,
        dom !== ''      ? [`${dom} day${dom !== 1 ? 's' : ''}`, 'Days on Market'] : null,
        listing.ListingId ? [listing.ListingId, 'MLS #'] : null,
    ].filter(Boolean);

    const listingDetailsHtml = listingRows.map(([v, l]) => `
        <div class="lp-listing-detail-row">
            <span class="lp-listing-detail-label">${l}</span>
            <span class="lp-listing-detail-value">${v}</span>
        </div>`).join('');

    // ---------- Home details ----------
    const homeDetailItems = [
        type                     ? ['Property Type',      type]                                    : null,
        yearBuilt                ? ['Year Built',         yearBuilt]                              : null,
        sqft                     ? ['Living Area',        `${Number(sqft).toLocaleString()} sq ft`] : null,
        lotSqft                  ? ['Lot Size',           `${Number(lotSqft).toLocaleString()} sq ft`] : null,
        beds                     ? ['Bedrooms',           beds]                                   : null,
        baths                    ? ['Bathrooms Total',    baths]                                  : null,
        listing.BathroomsFull    ? ['Full Baths',         listing.BathroomsFull]                  : null,
        listing.BathroomsHalf    ? ['Half Baths',         listing.BathroomsHalf]                  : null,
        garage                   ? ['Garage',             `${garage} Cars`]                       : null,
        listing.Stories          ? ['Stories',            listing.Stories]                        : null,
        cooling                  ? ['Cooling',            cooling]                                : null,
        heating                  ? ['Heating',            heating]                                : null,
        hasPool                  ? ['Pool',               'Yes']                                  : null,
        hasWaterfront            ? ['Waterfront',         'Yes']                                  : null,
        views                    ? ['View',               views]                                  : null,
        hoaFee                   ? ['HOA Fee',            hoaFee]                                 : null,
        listing.CountyOrParish   ? ['County',             listing.CountyOrParish]                 : null,
        listing.PostalCode       ? ['ZIP Code',           listing.PostalCode]                     : null,
        listing.MLSAreaMajor     ? ['MLS Area',           listing.MLSAreaMajor]                   : null,
        listing.ListingId        ? ['MLS #',              listing.ListingId]                      : null,
    ].filter(Boolean);

    const homeDetailsHtml = homeDetailItems.map(([l, v]) => `
        <div class="lp-home-detail">
            <span class="lp-home-detail-label">${l}</span>
            <span class="lp-home-detail-value">${v}</span>
        </div>`).join('');

    // ---------- Pre-filled agent message ----------
    const prefilledMsg = `Hi Rosa, I would like to know more about ${address}.`;

    // ---------- Build full HTML ----------
    container.innerHTML = `
    <!-- ===== PHOTO GRID ===== -->
    <div class="lp-photo-grid">
        <div class="lp-photo-main" onclick="lpOpenGallery(0)">
            ${mainPhotoHtml}
            ${photos.length > 0 ? `<button class="lp-photo-count-btn" onclick="event.stopPropagation();lpOpenGallery(0)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                See All ${photos.length} Photos
            </button>` : ''}
        </div>
        ${thumbPhotos.length ? `<div class="lp-photo-thumbs">${thumbsHtml}</div>` : ''}
    </div>

    <!-- ===== INFO BAR ===== -->
    <div class="lp-info-bar">
        <div class="lp-info-bar-inner">
            <div class="lp-info-left">
                <div class="lp-info-status-row">
                    <span class="lp-info-status-dot"></span>
                    <span class="lp-info-status-text">${status}</span>
                </div>
                <div class="lp-info-price">${price}</div>
                <div class="lp-info-address">${address}</div>
                ${subdivision ? `<div class="lp-info-sub">${subdivision}</div>` : ''}
            </div>
            <div class="lp-info-stats">${statsHtml}</div>
        </div>
    </div>

    <!-- ===== DETAIL BODY (2-col) ===== -->
    <div class="lp-detail-body">

        <!-- MAIN COLUMN -->
        <div class="lp-detail-main">

            ${highlights.length ? `
            <div class="lp-section">
                <h2 class="lp-section-title">Highlights</h2>
                <div class="lp-highlights-grid">${highlightsHtml}</div>
            </div>` : ''}

            ${descHtml}

            ${listingRows.length ? `
            <div class="lp-section">
                <h2 class="lp-section-title">Listing Details</h2>
                <div class="lp-listing-details">${listingDetailsHtml}</div>
            </div>` : ''}

            ${homeDetailItems.length ? `
            <div class="lp-section">
                <h2 class="lp-section-title">Home Details</h2>
                <div class="lp-home-details-grid">${homeDetailsHtml}</div>
            </div>` : ''}

        </div>

        <!-- STICKY AGENT SIDEBAR -->
        <aside class="lp-agent-sidebar">
            <div class="lp-agent-card" id="lp-agent-card">
                <div class="lp-agent-top">
                    <img src="team-rosa.jpg" alt="Rosa Poler" class="lp-agent-photo">
                    <div class="lp-agent-info">
                        <div class="lp-agent-name">Rosa Poler</div>
                        <div class="lp-agent-badge">LISTING AGENT</div>
                        <img src="optimar-logo.jpg" alt="Optimar International Realty" class="lp-agent-brokerage-logo">
                    </div>
                </div>
                <div class="lp-agent-body">
                    <p class="lp-agent-connect-label">Only The Poler Team connects you directly to the Listing Agent.</p>
                    <textarea class="lp-agent-message" id="lp-agent-message" rows="4">${prefilledMsg}</textarea>
                    <button class="lp-agent-send" id="lp-agent-send-btn" onclick="sendHeroAgentMessage()">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                        Send a Message
                    </button>
                    <a href="tel:+19542354046" class="lp-agent-phone">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014.68 11.6 19.79 19.79 0 011.61 3a2 2 0 012-2.18h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.91 8.09a16 16 0 006 6l.91-.91a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
                        (954) 235-4046
                    </a>
                </div>
            </div>
        </aside>

    </div><!-- /lp-detail-body -->

    <!-- ===== FULLSCREEN GALLERY MODAL ===== -->
    <div class="lp-gallery-modal" id="lp-gallery-modal">
        <button class="lp-gallery-close" onclick="lpCloseGallery()" aria-label="Close gallery">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <button class="lp-gallery-nav lp-gallery-prev" onclick="lpGalleryNav(-1)" aria-label="Previous photo">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="lp-gallery-img-wrap">
            <img class="lp-gallery-img" id="lp-gallery-img" src="" alt="">
        </div>
        <button class="lp-gallery-nav lp-gallery-next" onclick="lpGalleryNav(1)" aria-label="Next photo">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <div class="lp-gallery-counter" id="lp-gallery-counter">1 / ${photos.length}</div>
    </div>
    `;

    // ---- Gallery logic ----
    let lpGalleryIndex = 0;
    const lpGalleryPhotos = photos;

    window.lpOpenGallery = function(idx) {
        lpGalleryIndex = idx || 0;
        const modal   = document.getElementById('lp-gallery-modal');
        const img     = document.getElementById('lp-gallery-img');
        const counter = document.getElementById('lp-gallery-counter');
        img.src = lpGalleryPhotos[lpGalleryIndex];
        counter.textContent = `${lpGalleryIndex + 1} / ${lpGalleryPhotos.length}`;
        modal.classList.add('lp-gallery-open');
        document.body.style.overflow = 'hidden';
    };

    window.lpCloseGallery = function() {
        const modal = document.getElementById('lp-gallery-modal');
        if (modal) modal.classList.remove('lp-gallery-open');
        document.body.style.overflow = '';
    };

    window.lpGalleryNav = function(dir) {
        lpGalleryIndex = (lpGalleryIndex + dir + lpGalleryPhotos.length) % lpGalleryPhotos.length;
        const img     = document.getElementById('lp-gallery-img');
        const counter = document.getElementById('lp-gallery-counter');
        img.src = lpGalleryPhotos[lpGalleryIndex];
        counter.textContent = `${lpGalleryIndex + 1} / ${lpGalleryPhotos.length}`;
    };

    // Keyboard navigation for gallery
    document.addEventListener('keydown', function lpKeyNav(e) {
        const modal = document.getElementById('lp-gallery-modal');
        if (!modal || !modal.classList.contains('lp-gallery-open')) return;
        if (e.key === 'ArrowLeft')  window.lpGalleryNav(-1);
        if (e.key === 'ArrowRight') window.lpGalleryNav(1);
        if (e.key === 'Escape')     window.lpCloseGallery();
    });

    // ---- Description toggle ----
    window.lpToggleDesc = function() {
        const text = document.getElementById('lp-desc-text');
        const btn  = document.getElementById('lp-desc-toggle');
        if (!text || !btn) return;
        text.classList.toggle('lp-desc-expanded');
        btn.textContent = text.classList.contains('lp-desc-expanded') ? 'Show Less' : 'Show More';
    };
}

function renderDefaultHero(container) {
    container.innerHTML = `
    <div class="hero-default">
        <h1 class="hero-default-title">South Florida Luxury Real Estate</h1>
        <p class="hero-default-sub">Search thousands of active listings in Sunny Isles Beach, Aventura, North Miami Beach, and beyond.</p>
    </div>`;
}

// Send message from the hero property agent panel (WhatsApp)
function sendHeroAgentMessage() {
    const msgEl  = document.getElementById('lp-agent-message');
    const sendBtn = document.getElementById('lp-agent-send-btn');
    const msg = msgEl ? msgEl.value.trim() : '';
    if (!msg) { msgEl && msgEl.focus(); return; }

    const propertyContext = heroListing
        ? `[Property: ${heroListing.UnparsedAddress || heroListing.City || 'listing page'} — ${formatPrice(heroListing.ListPrice)}]\n\n`
        : '';

    const waUrl = `https://wa.me/19542354046?text=${encodeURIComponent(propertyContext + msg)}`;
    window.open(waUrl, '_blank');

    if (sendBtn) {
        const orig = sendBtn.innerHTML;
        sendBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Opening WhatsApp...`;
        sendBtn.style.background = '#16a34a';
        setTimeout(() => { sendBtn.innerHTML = orig; sendBtn.style.background = ''; }, 3000);
    }
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
    const agent   = 'Rosa Poler';
    const status  = listing.StandardStatus || 'Active';

    const imgHtml = photo
        ? `<img class="listing-photo" src="${photo}" alt="${address}" loading="lazy">`
        : `<div class="listing-placeholder"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M3 21h18M5 21V7l8-4v18M13 21V3l6 4v14"/></svg></div>`;

    const statusClass = status === 'Active' ? 'status-active' : status === 'Pending' ? 'status-pending' : 'status-other';

    return `
    <div class="listing-card" onclick="window.location.href='listing.html?id=${lid}'">
        <div class="listing-image">
            ${imgHtml}
            <div class="listing-overlay">
                <span class="listing-area">${city}</span>
                <span class="listing-status-badge ${statusClass}">${status}</span>
            </div>
        </div>
        <div class="listing-details">
            <div class="listing-price">${price}</div>
            <div class="listing-address">${address}</div>
            ${stats ? `<div class="listing-stats">${stats}</div>` : ''}
            <div class="listing-agent-row">
                <img src="team-rosa.jpg" alt="${agent}" class="listing-agent-avatar">
                <span class="listing-agent-name">${agent}</span>
                <span class="listing-agent-brokerage">Optimar Int'l</span>
            </div>
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

    // Pre-fill location from ?city= URL param and auto-run
    const urlParams = new URLSearchParams(window.location.search);
    const cityParam = urlParams.get('city');
    if (cityParam) {
        const locInput = document.getElementById('f-location');
        if (locInput) locInput.value = decodeURIComponent(cityParam.replace(/\+/g, ' '));
    }

    // Run search on load (uses city param if set, otherwise default South Florida)
    runSearch(false);
}

// ============================================================
// AGENT PANEL — send message via EmailJS
// ============================================================
function sendAgentMessage() {
    const msgEl  = document.getElementById('agent-message');
    const sendBtn = document.getElementById('agent-send-btn');
    const msg = msgEl ? msgEl.value.trim() : '';

    if (!msg) { msgEl && msgEl.focus(); return; }

    // Build context prefix so Rosa knows which property the lead is about
    const propertyContext = heroListing
        ? `[Property: ${heroListing.UnparsedAddress || heroListing.City || 'listing page'} — ${formatPrice(heroListing.ListPrice)}]\n\n`
        : '[From: listing search page]\n\n';

    const fullMessage = propertyContext + msg;
    const waUrl = `https://wa.me/19542354046?text=${encodeURIComponent(fullMessage)}`;

    // Open WhatsApp with pre-filled message
    window.open(waUrl, '_blank');

    // Visual confirmation + clear field
    sendBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Opening WhatsApp...`;
    sendBtn.style.background = '#16a34a';
    msgEl.value = '';

    setTimeout(() => {
        sendBtn.style.background = '';
        sendBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Send Message`;
    }, 3000);
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
