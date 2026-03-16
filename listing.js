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
const EMAILJS_PUBLIC_KEY       = 'BXbUaPxSOHhgfGn6x';
const EMAILJS_SERVICE_ID       = 'service_d4ff5bs';
const EMAILJS_TEMPLATE_ID      = 'template_9l5f1io';   // Lead notification → Rosa, Kevin, Dylan
const EMAILJS_WELCOME_TEMPLATE = 'template_5t3k1w7';    // Intro email → new lead

// ============================================================
// BRIDGE API CONFIG
// ============================================================
const API_TOKEN  = 'fceef76441eaf7579daff17411bffca2';
const API_BASE   = 'https://api.bridgedataoutput.com/api/v2/miamire';
const OTP_BASE   = 'https://poler-team-website-two.vercel.app'; // Vercel project with Twilio env vars
const PAGE_SIZE  = 12;

// ============================================================
// UTM / AD TRACKING
// ============================================================
function getUtmParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        utm_source:   params.get('utm_source')   || '',
        utm_medium:   params.get('utm_medium')    || '',
        utm_campaign: params.get('utm_campaign')  || '',
        utm_content:  params.get('utm_content')   || '',
        utm_term:     params.get('utm_term')      || '',
        fbclid:       params.get('fbclid')        || '',
    };
}
const utmData = getUtmParams();

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
    if (!price) return t('priceOnRequest');
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
    if (listing.BedroomsTotal)         parts.push(`${listing.BedroomsTotal} ${t('bd')}`);
    if (listing.BathroomsTotalInteger) parts.push(`${listing.BathroomsTotalInteger} ${t('ba')}`);
    if (listing.LivingArea)            parts.push(`${Number(listing.LivingArea).toLocaleString()} ${t('sf')}`);
    return parts.join(' · ');
}

async function apiFetch(params) {
    const qs = new URLSearchParams({ access_token: API_TOKEN, ...params }).toString();
    const res = await fetch(`${API_BASE}/listings?${qs}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

// ============================================================
// LEAD CAPTURE — 10-second timer then forced modal, with OTP phone verification
// ============================================================
function initLeadCapture() {
    leadCaptured = !!localStorage.getItem('poler_lead_v1');
    if (leadCaptured) return;

    const overlay  = document.getElementById('lead-overlay');
    const bar      = document.getElementById('lead-timer-bar');
    const pageWrap = document.getElementById('page-wrap');

    // Brazil visitors (lang=pt) skip OTP verification
    const skipOtp = new URLSearchParams(window.location.search).get('lang') === 'pt';

    // Init EmailJS
    if (typeof emailjs !== 'undefined' && EMAILJS_PUBLIC_KEY !== 'YOUR_PUBLIC_KEY') {
        emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
    }

    // 10-second countdown — persists across page refreshes
    const DURATION    = 10000;
    const TIMER_KEY   = 'poler_lead_timer_start';
    let storedStart   = sessionStorage.getItem(TIMER_KEY);
    if (!storedStart) {
        storedStart = Date.now();
        sessionStorage.setItem(TIMER_KEY, storedStart);
    }
    const START = Number(storedStart);

    // If timer already expired (user refreshed after 10s), show modal immediately
    if (Date.now() - START >= DURATION) {
        bar.style.transform = 'scaleX(0)';
        showLeadModal(overlay, pageWrap);
    } else {
        timerInterval = setInterval(() => {
            const elapsed = Date.now() - START;
            const pct = Math.max(0, 1 - elapsed / DURATION);
            bar.style.transform = `scaleX(${pct})`;
            if (elapsed >= DURATION) {
                clearInterval(timerInterval);
                showLeadModal(overlay, pageWrap);
            }
        }, 80);
    }

    // ── STEP 1: Info form → send OTP (or skip for Brazil) ────
    const form      = document.getElementById('lead-form');
    const submitBtn = document.getElementById('lead-submit-btn');
    const submitTxt = document.getElementById('lead-submit-text');

    // For Brazil visitors: update button text (no OTP needed)
    // The disclaimer is auto-translated by i18n to not mention OTP for Portuguese
    if (skipOtp) {
        submitTxt.textContent = t('submitAndContinue');
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const first = document.getElementById('lead-first').value.trim();
        const last  = document.getElementById('lead-last').value.trim();
        const email = document.getElementById('lead-email').value.trim();
        const localPhone = document.getElementById('lead-phone').value.trim();
        const countryCode = document.getElementById('country-code').value.replace(/[^+\d]/g, ''); // strip "CA" suffix etc.
        const phone = countryCode + localPhone.replace(/\D/g, ''); // e.g. "+5511987654321"

        if (!first || !last || !email || !localPhone) {
            showLeadError('lead-error', t('errFillAll'));
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showLeadError('lead-error', t('errInvalidEmail'));
            return;
        }
        const digitsOnly = localPhone.replace(/\D/g, '');
        if (digitsOnly.length < 7) {
            showLeadError('lead-error', t('errInvalidPhone'));
            return;
        }

        submitBtn.disabled = true;
        document.getElementById('lead-error').style.display = 'none';

        // ── Brazil visitors: skip OTP, go straight to lead capture ──
        if (skipOtp) {
            submitTxt.textContent = t('submitting');
            leadFormData = { first, last, email, phone, normalizedPhone: phone };
            try {
                await completeLead(overlay, pageWrap);
            } catch (err) {
                submitBtn.disabled = false;
                submitTxt.textContent = t('submitAndContinue');
                showLeadError('lead-error', t('errNetwork'));
            }
            return;
        }

        // ── Standard flow: send OTP ─────────────────────────────────
        submitTxt.textContent = t('sendingCode');

        try {
            const res  = await fetch(`${OTP_BASE}/api/send-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone }),
            });
            const data = await res.json();

            if (!res.ok) {
                submitBtn.disabled = false;
                submitTxt.textContent = t('sendVerification');
                showLeadError('lead-error', data.error || t('errSendCode'));
                return;
            }

            // Store lead info for step 2
            leadFormData = { first, last, email, phone, normalizedPhone: data.phone };

            // Show OTP step
            document.getElementById('lead-step-1').style.display = 'none';
            const step2 = document.getElementById('lead-step-2');
            step2.style.display = 'block';
            const masked = phone.replace(/(\d{3})\d{4}(\d{3,4})$/, '$1****$2');
            document.getElementById('otp-subtitle').textContent =
                t('otpSubtitle', { phone: masked });

            initOtpDigits();
            startResendTimer();
            document.querySelector('.otp-digit').focus();

        } catch (err) {
            submitBtn.disabled = false;
            submitTxt.textContent = t('sendVerification');
            showLeadError('lead-error', t('errNetwork'));
        }
    });

    // ── STEP 2: OTP entry → verify ───────────────────────────
    document.getElementById('otp-verify-btn').addEventListener('click', () => verifyOtp(overlay, pageWrap));

    document.getElementById('otp-back-btn').addEventListener('click', () => {
        document.getElementById('lead-step-2').style.display = 'none';
        document.getElementById('lead-step-1').style.display = 'block';
        submitBtn.disabled = false;
        submitTxt.textContent = t('sendVerification');
    });

    document.getElementById('otp-resend-btn').addEventListener('click', async () => {
        if (!leadFormData) return;
        const btn = document.getElementById('otp-resend-btn');
        btn.disabled = true;
        try {
            await fetch(`${OTP_BASE}/api/send-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: leadFormData.phone }),
            });
            startResendTimer();
            // Clear digits
            document.querySelectorAll('.otp-digit').forEach(d => { d.value = ''; d.classList.remove('filled','error'); });
            document.querySelector('.otp-digit').focus();
        } catch (_) {}
    });

    // ── "Call me instead" — voice fallback ───────────────
    document.getElementById('otp-call-btn').addEventListener('click', async () => {
        if (!leadFormData) return;
        const btn = document.getElementById('otp-call-btn');
        btn.disabled = true;
        const origHTML = btn.innerHTML;
        btn.innerHTML = '<span>' + t('callingNow') + '</span>';
        try {
            const res = await fetch(`${OTP_BASE}/api/send-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: leadFormData.phone, channel: 'call' }),
            });
            const data = await res.json();
            if (res.ok) {
                btn.innerHTML = '<span class="call-sent">' + t('callSent') + '</span>';
                document.getElementById('otp-subtitle').textContent = t('otpCallSubtitle');
                // Clear digits for fresh entry
                document.querySelectorAll('.otp-digit').forEach(d => { d.value = ''; d.classList.remove('filled','error'); });
                document.querySelector('.otp-digit').focus();
            } else {
                btn.innerHTML = origHTML;
                btn.disabled = false;
                showLeadError('otp-error', data.error || t('errCallFailed'));
            }
        } catch (_) {
            btn.innerHTML = origHTML;
            btn.disabled = false;
            showLeadError('otp-error', t('errNetwork'));
        }
        // Re-enable after 30s so they can try again
        setTimeout(() => { btn.innerHTML = origHTML; btn.disabled = false; }, 30000);
    });
}

// Stored lead info between step 1 and step 2
let leadFormData = null;

// Wire up the 6 OTP digit boxes for auto-advance and backspace navigation
function initOtpDigits() {
    const digits = Array.from(document.querySelectorAll('.otp-digit'));
    digits.forEach((input, i) => {
        input.value = '';
        input.classList.remove('filled', 'error');

        input.addEventListener('input', (e) => {
            const val = e.target.value.replace(/\D/g, '');
            input.value = val.slice(-1); // keep only last digit
            input.classList.toggle('filled', !!input.value);
            if (input.value && i < digits.length - 1) digits[i + 1].focus();
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !input.value && i > 0) {
                digits[i - 1].focus();
                digits[i - 1].value = '';
                digits[i - 1].classList.remove('filled');
            }
            if (e.key === 'Enter') verifyOtp(
                document.getElementById('lead-overlay'),
                document.getElementById('page-wrap')
            );
        });

        // Handle paste of full 6-digit code
        input.addEventListener('paste', (e) => {
            e.preventDefault();
            const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
            digits.forEach((d, idx) => {
                d.value = pasted[idx] || '';
                d.classList.toggle('filled', !!d.value);
            });
            const lastFilled = Math.min(pasted.length, digits.length) - 1;
            digits[lastFilled]?.focus();
        });
    });
}

// ── Shared lead completion — save to CRM, send emails, fire pixel, unlock page
async function completeLead(overlay, pageWrap) {
    const { first, last, email, phone } = leadFormData;

    // Fire Meta Pixel Lead event for ad conversion tracking
    if (typeof fbq === 'function') {
        fbq('track', 'Lead', {
            content_name: heroListing ? (heroListing.UnparsedAddress || heroListing.City || '') : 'Browse page',
            content_category: 'Real Estate',
            value: heroListing ? (heroListing.ListPrice || 0) : 0,
            currency: 'USD',
        });
    }

    // Save lead to Airtable CRM and capture alert token
    const langParam = new URLSearchParams(window.location.search).get('lang') || 'en';
    try {
        const saveRes = await fetch(`${OTP_BASE}/api/save-lead`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                first,
                last,
                email,
                phone:          leadFormData.normalizedPhone,
                listingAddress: heroListing ? (heroListing.UnparsedAddress || heroListing.City || '') : '',
                listingPrice:   heroListing ? (heroListing.ListPrice || 0) : 0,
                sourceUrl:      window.location.href,
                language:       langParam,
                ...utmData,
            }),
        });
        const saveData = await saveRes.json();
        if (saveData.token) localStorage.setItem('poler_alert_token', saveData.token);
    } catch (err) {
        console.warn('Save lead error:', err);
    }

    const templateParams = {
        first_name:       first,
        last_name:        last,
        email,
        phone,
        listing_address:  heroListing ? (heroListing.UnparsedAddress || heroListing.City || 'N/A') : 'Browse page',
        listing_price:    heroListing ? formatPrice(heroListing.ListPrice) : 'N/A',
        page_url:         window.location.href,
        to_email:         'rosapoler@hotmail.com,kevinpolermiami@gmail.com,dylan@poler.org,rosadasilvapoler@gmail.com',
    };

    try {
        if (typeof emailjs !== 'undefined' && EMAILJS_SERVICE_ID !== 'YOUR_SERVICE_ID') {
            await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, templateParams);
            await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_WELCOME_TEMPLATE, {
                user_email:      email,
                first_name:      first,
                last_name:       last,
                listing_address: templateParams.listing_address,
                listing_price:   templateParams.listing_price,
            });
        }
    } catch (emailErr) {
        console.warn('EmailJS send failed:', emailErr);
    }

    localStorage.setItem('poler_lead_v1', email);
    leadCaptured = true;

    // Show Step 3 (preference questions) instead of unlocking immediately
    showPreferenceStep(overlay, pageWrap);
}

// ── Step 3 — Preference questions before unlocking ──────────
function showPreferenceStep(overlay, pageWrap) {
    document.getElementById('lead-step-1').style.display = 'none';
    document.getElementById('lead-step-2').style.display = 'none';
    const step3 = document.getElementById('lead-step-3');
    step3.style.display = 'block';

    // Timeline pills — single-select
    document.querySelectorAll('#pref-timeline-pills .pref-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            document.querySelectorAll('#pref-timeline-pills .pref-pill').forEach(p => p.classList.remove('selected'));
            pill.classList.add('selected');
        });
    });

    // Property type pills — multi-select toggle
    document.querySelectorAll('#pref-type-pills .pref-pill').forEach(pill => {
        pill.addEventListener('click', () => pill.classList.toggle('selected'));
    });

    // Submit
    document.getElementById('pref-submit-btn').addEventListener('click', () => savePreferencesAndUnlock(overlay, pageWrap));

    // Apply i18n to new elements
    if (typeof applyI18n === 'function') applyI18n();
}

async function savePreferencesAndUnlock(overlay, pageWrap) {
    const submitBtn = document.getElementById('pref-submit-btn');
    const submitTxt = document.getElementById('pref-submit-text');

    submitBtn.disabled = true;
    submitTxt.textContent = t('prefSaving') || 'Saving...';

    // Gather values
    const timelinePill = document.querySelector('#pref-timeline-pills .pref-pill.selected');
    const buyTimeline = timelinePill ? timelinePill.dataset.value : '';

    const cities = document.getElementById('pref-cities').value.trim();

    const propertyTypes = [];
    document.querySelectorAll('#pref-type-pills .pref-pill.selected').forEach(p => propertyTypes.push(p.dataset.value));

    const priceMin = Number(document.getElementById('pref-price-min').value) || 0;
    const priceMax = Number(document.getElementById('pref-price-max').value) || 0;

    const token = localStorage.getItem('poler_alert_token');
    if (!token) {
        unlockPage(overlay, pageWrap);
        return;
    }

    const bedsMin  = Number(document.getElementById('pref-beds').value)  || 0;
    const bathsMin = Number(document.getElementById('pref-baths').value) || 0;

    const langParam = new URLSearchParams(window.location.search).get('lang') || 'en';

    const payload = {
        token,
        alertActive: true,
        propertyTypes,
        cities,
        priceMin,
        priceMax,
        bedsMin,
        bathsMin,
        frequency: 'Daily',
        count: 5,
        preferredLanguage: langParam,
    };
    if (buyTimeline) payload.buyTimeline = buyTimeline;

    try {
        await fetch(`${OTP_BASE}/api/update-preferences`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    } catch (err) {
        console.warn('Preferences save error:', err);
    }

    // Always unlock regardless of save result
    unlockPage(overlay, pageWrap);
}

async function verifyOtp(overlay, pageWrap) {
    const digits   = Array.from(document.querySelectorAll('.otp-digit'));
    const code     = digits.map(d => d.value).join('');
    const verifyBtn = document.getElementById('otp-verify-btn');
    const verifyTxt = document.getElementById('otp-verify-text');
    const errorEl   = document.getElementById('otp-error');

    if (code.length < 6) {
        showLeadError('otp-error', t('errOtpDigits'));
        digits.forEach(d => d.classList.add('error'));
        setTimeout(() => digits.forEach(d => d.classList.remove('error')), 400);
        return;
    }

    verifyBtn.disabled = true;
    verifyTxt.textContent = t('verifying');
    errorEl.style.display = 'none';

    try {
        const res  = await fetch(`${OTP_BASE}/api/verify-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: leadFormData.normalizedPhone, code }),
        });
        const data = await res.json();

        if (!res.ok) {
            verifyBtn.disabled = false;
            verifyTxt.textContent = t('verifyAndContinue');
            showLeadError('otp-error', data.error || t('errOtpInvalid'));
            digits.forEach(d => d.classList.add('error'));
            setTimeout(() => digits.forEach(d => d.classList.remove('error')), 400);
            return;
        }

        // ✅ Verified — complete the lead
        verifyTxt.textContent = '✓ Verified!';
        await completeLead(overlay, pageWrap);

    } catch (err) {
        verifyBtn.disabled = false;
        verifyTxt.textContent = t('verifyAndContinue');
        showLeadError('otp-error', t('errNetwork'));
    }
}

// 60-second countdown before allowing resend
function startResendTimer() {
    const btn      = document.getElementById('otp-resend-btn');
    const timerEl  = document.getElementById('otp-resend-timer');
    btn.disabled   = true;
    let seconds    = 60;
    timerEl.textContent = `(${seconds}s)`;
    const iv = setInterval(() => {
        seconds--;
        if (seconds <= 0) {
            clearInterval(iv);
            timerEl.textContent = '';
            btn.disabled = false;
        } else {
            timerEl.textContent = `(${seconds}s)`;
        }
    }, 1000);
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

function showLeadError(elId, msg) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
}

// ============================================================
// HERO PROPERTY — fetch listing by ?id= URL param
// ============================================================
async function initHeroProperty() {
    const params   = new URLSearchParams(window.location.search);
    const listingId = params.get('id') || params.get('mls');
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
                ${t('seeAllPhotos', { count: photos.length })}
            </div>` : ''}
        </div>`;
    }).join('');

    // ---------- Stats bar ----------
    const statItems = [
        beds         ? { v: beds,                                     l: t('beds') }        : null,
        baths        ? { v: baths,                                    l: t('baths') }       : null,
        sqft         ? { v: Number(sqft).toLocaleString(),            l: t('sqft') }       : null,
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
            <h2 class="lp-section-title">${t('description')}</h2>
            <div class="lp-desc-wrap">
                <p class="lp-desc-text" id="lp-desc-text">${description}</p>
                ${description.length > 320 ? `<button class="lp-desc-toggle" id="lp-desc-toggle" onclick="lpToggleDesc()">${t('showMore')}</button>` : ''}
            </div>
        </div>` : '';

    // ---------- Listing details ----------
    const listDateFormatted = listDate
        ? new Date(listDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : '';

    const listingRows = [
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
                ${t('seeAllPhotos', { count: photos.length })}
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
                <h2 class="lp-section-title">${t('keyFacts')}</h2>
                <div class="lp-highlights-grid">${highlightsHtml}</div>
            </div>` : ''}

            ${descHtml}

            ${listingRows.length ? `
            <div class="lp-section">
                <h2 class="lp-section-title">${t('propertyDetails')}</h2>
                <div class="lp-listing-details">${listingDetailsHtml}</div>
            </div>` : ''}

            ${homeDetailItems.length ? `
            <div class="lp-section">
                <h2 class="lp-section-title">${t('keyFacts')}</h2>
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
                    <p class="lp-agent-connect-label">${t('scheduleShowing')}</p>
                    <textarea class="lp-agent-message" id="lp-agent-message" rows="4">${prefilledMsg}</textarea>
                    <button class="lp-agent-send" id="lp-agent-send-btn" onclick="sendHeroAgentMessage()">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                        ${t('sendMessageBtn')}
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
        btn.textContent = text.classList.contains('lp-desc-expanded') ? t('showLess') : t('showMore');
    };
}

function renderDefaultHero(container) {
    container.innerHTML = `
    <div class="hero-default">
        <div class="hero-video-wrap">
            <video class="hero-bg-video" autoplay muted loop playsinline>
                <source src="sunny-isles-drone-web.mp4" type="video/mp4">
            </video>
            <div class="hero-video-overlay"></div>
        </div>
        <h1 class="hero-default-title" data-i18n="tagline">${t('tagline')}</h1>
        <p class="hero-default-sub" data-i18n="showingFeatured">${t('showingFeatured')}</p>
    </div>`;
}

// Re-render hero when language changes
function reRenderHero() {
    const container = document.getElementById('hero-property');
    if (!container || !heroListing) return;
    renderHero(container, heroListing);
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
        label.textContent = open ? t('hideAdvSearch') : t('showAdvSearch');
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
            <a href="listing.html?mls=${lid}" class="lookup-result-view">
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
        label.textContent = open ? t('hideFilters') : t('showFilters');
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

async function fetchCuratedListings() {
    const grid      = document.getElementById('results-grid');
    const countEl   = document.getElementById('results-count');
    const noResults = document.getElementById('no-results');
    const loadMore  = document.getElementById('load-more-wrap');

    grid.innerHTML = renderSkeletons();
    noResults.style.display = 'none';
    loadMore.style.display  = 'none';
    countEl.textContent = 'Loading featured properties...';

    const ranges = [
        { 'ListPrice.gte': 500000,  'ListPrice.lte': 1000000 },
        { 'ListPrice.gte': 1000000, 'ListPrice.lte': 5000000 },
        { 'ListPrice.gte': 5000000, 'ListPrice.lte': 10000000 },
    ];

    try {
        const results = await Promise.allSettled(
            ranges.map(r => apiFetch({
                ...r,
                StandardStatus: 'Active',
                sortBy: 'ModificationTimestamp',
                sortOrder: 'desc',
                limit: 4,
            }))
        );

        let all = [];
        results.forEach(r => {
            if (r.status === 'fulfilled' && r.value.success && Array.isArray(r.value.bundle)) {
                all = all.concat(r.value.bundle);
            }
        });

        // Fisher-Yates shuffle
        for (let i = all.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [all[i], all[j]] = [all[j], all[i]];
        }

        grid.innerHTML = '';

        if (!all.length) {
            noResults.style.display = 'block';
            countEl.textContent = 'No featured properties available';
            return;
        }

        all.forEach(l => grid.insertAdjacentHTML('beforeend', renderCard(l)));
        countEl.textContent = `Showing ${all.length} featured propert${all.length === 1 ? 'y' : 'ies'}`;
    } catch (err) {
        console.error('Curated listings error:', err);
        grid.innerHTML = '';
        noResults.style.display = 'block';
        countEl.textContent = 'Error loading properties — please try searching';
    }
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
    <div class="listing-card" onclick="window.location.href='listing.html?mls=${lid}'">
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
    searchTxt.textContent = t('search') + '...';

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

        // Log search activity to CRM (non-blocking)
        if (!append) {
            try {
                const leadData = localStorage.getItem('poler_lead_v1');
                if (leadData) {
                    const lead = JSON.parse(leadData);
                    if (lead.email) {
                        fetch('/api/log-activity', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                email: lead.email,
                                activityType: 'Search',
                                details: { params: lastQuery, resultCount: listings.length },
                            }),
                        }).catch(() => {});
                    }
                }
            } catch (e) { /* non-critical */ }
        }

    } catch (err) {
        console.error('Search error:', err);
        if (!append) {
            grid.innerHTML = '';
            noResults.style.display = 'block';
            countEl.textContent = 'Search error — please try again';
        }
    } finally {
        searchBtn.disabled = false;
        searchTxt.textContent = t('searchProperties');
    }
}

function initSearch() {
    document.getElementById('search-btn').addEventListener('click', () => runSearch(false));

    document.getElementById('load-more-btn').addEventListener('click', () => {
        document.getElementById('load-more-btn').disabled = true;
        document.getElementById('load-more-btn').textContent = t('search') + '...';
        runSearch(true).finally(() => {
            document.getElementById('load-more-btn').disabled = false;
            document.getElementById('load-more-btn').textContent = t('loadMore');
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

    // If no specific search params, show curated mix; otherwise run normal search
    const hasSearchParam = urlParams.get('mls') || urlParams.get('city') || urlParams.get('id');
    if (hasSearchParam) {
        runSearch(false);
    } else {
        fetchCuratedListings();
    }
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
        sendBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> ${t('sendMessageBtn')}`;
    }, 3000);
}

// Inline spin animation for loading indicators
const spinStyle = document.createElement('style');
spinStyle.textContent = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
document.head.appendChild(spinStyle);

// ============================================================
// AI CHAT WIDGET
// ============================================================

(function () {
    // ── State ──────────────────────────────────────────────
    const chatState = {
        open: false,
        messages: [],          // { role: 'user'|'assistant', content: string }
        streaming: false,
        greeted: false,
        sessionId: crypto.randomUUID(),
    };

    // ── DOM refs (set after DOMContentLoaded) ───────────────
    let widget, toggleBtn, panel, messagesEl, inputEl, sendBtn, pingDot;

    // ── Build property context string from heroListing ──────
    function buildPropertyContext() {
        if (!heroListing) return '';
        const l = heroListing;
        const lines = [
            `Address: ${l.UnparsedAddress || 'N/A'}`,
            `Price: ${formatPrice(l.ListPrice)}`,
            `Status: ${l.StandardStatus || l.MlsStatus || 'N/A'}`,
            `Type: ${l.PropertyType || l.PropertySubType || 'N/A'}`,
            `Beds: ${l.BedroomsTotal || 'N/A'}`,
            `Baths: ${l.BathroomsTotalInteger || 'N/A'}`,
            `Living Area: ${l.LivingArea ? Number(l.LivingArea).toLocaleString() + ' sqft' : 'N/A'}`,
            l.LotSizeSquareFeet ? `Lot Size: ${Number(l.LotSizeSquareFeet).toLocaleString()} sqft` : '',
            l.YearBuilt          ? `Year Built: ${l.YearBuilt}` : '',
            l.SubdivisionName    ? `Subdivision: ${l.SubdivisionName}` : '',
            l.AssociationFee     ? `HOA Fee: $${Number(l.AssociationFee).toLocaleString()}/mo` : '',
            l.GarageSpaces       ? `Garage Spaces: ${l.GarageSpaces}` : '',
            typeof l.PoolPrivateYN !== 'undefined' ? `Private Pool: ${l.PoolPrivateYN ? 'Yes' : 'No'}` : '',
            l.WaterfrontYN || (l.WaterfrontFeatures && l.WaterfrontFeatures.length)
                ? `Waterfront: Yes${l.WaterfrontFeatures ? ' — ' + l.WaterfrontFeatures.join(', ') : ''}` : '',
            l.CoolingYN          ? `Cooling: ${l.Cooling ? l.Cooling.join(', ') : 'Yes'}` : '',
            l.HeatingYN          ? `Heating: ${l.Heating ? l.Heating.join(', ') : 'Yes'}` : '',
            l.View               ? `Views: ${l.View.join(', ')}` : '',
            l.PublicRemarks      ? `Description: ${l.PublicRemarks.substring(0, 600)}` : '',
            l.ListingId          ? `MLS #: ${l.ListingId}` : '',
            `Page URL: ${window.location.href}`,
        ];
        return lines.filter(Boolean).join('\n');
    }

    // ── Format timestamp ─────────────────────────────────────
    function formatTime() {
        return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // ── Simple markdown → HTML (bold, bullets) ───────────────
    function renderMarkdown(text) {
        return text
            // Bold **text**
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            // Italic *text*
            .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
            // Bullet lines starting with - or •
            .replace(/^[\-•]\s+(.+)$/gm, '<li>$1</li>')
            // Wrap consecutive <li> in <ul>
            .replace(/(<li>.*?<\/li>(\n|$))+/gs, m => `<ul>${m}</ul>`)
            // Newlines → paragraphs
            .split(/\n{2,}/)
            .map(p => p.trim())
            .filter(p => p && !p.startsWith('<ul>'))
            .reduce((acc, p) => {
                if (p.startsWith('<li>')) return acc + p;
                return acc + `<p>${p}</p>`;
            }, '')
            // Clean up any leftover newlines inside paragraphs
            .replace(/\n/g, ' ');
    }

    // ── Append a message bubble ──────────────────────────────
    function appendMessage(role, text, streaming = false) {
        const row = document.createElement('div');
        row.className = `ai-msg-row ${role}`;

        const bubble = document.createElement('div');
        bubble.className = 'ai-msg-bubble';

        if (role === 'assistant') {
            bubble.innerHTML = streaming ? '' : renderMarkdown(text);
        } else {
            bubble.textContent = text;
        }

        const time = document.createElement('div');
        time.className = 'ai-msg-time';
        time.textContent = formatTime();

        row.appendChild(bubble);
        row.appendChild(time);
        messagesEl.appendChild(row);
        scrollToBottom();
        return bubble; // Return so streaming can update it
    }

    // ── Typing indicator ─────────────────────────────────────
    function showTyping() {
        const row = document.createElement('div');
        row.className = 'ai-msg-row assistant';
        row.id = 'ai-typing-row';
        const indicator = document.createElement('div');
        indicator.className = 'ai-typing-indicator';
        indicator.innerHTML = '<div class="ai-typing-dot"></div><div class="ai-typing-dot"></div><div class="ai-typing-dot"></div>';
        row.appendChild(indicator);
        messagesEl.appendChild(row);
        scrollToBottom();
    }

    function hideTyping() {
        const row = document.getElementById('ai-typing-row');
        if (row) row.remove();
    }

    // ── Scroll to bottom ─────────────────────────────────────
    function scrollToBottom() {
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // ── Quick-reply chips ────────────────────────────────────
    function addChips(questions) {
        const chipsEl = document.createElement('div');
        chipsEl.className = 'ai-chat-chips';
        questions.forEach(q => {
            const chip = document.createElement('button');
            chip.className = 'ai-chat-chip';
            chip.textContent = q;
            chip.addEventListener('click', () => {
                chipsEl.remove();
                sendMessage(q);
            });
            chipsEl.appendChild(chip);
        });
        messagesEl.appendChild(chipsEl);
        scrollToBottom();
    }

    // ── Send a message ───────────────────────────────────────
    async function sendMessage(text) {
        text = (text || inputEl.value).trim();
        if (!text || chatState.streaming) return;

        inputEl.value = '';
        inputEl.style.height = 'auto';

        // Add user message to state & DOM
        chatState.messages.push({ role: 'user', content: text });
        appendMessage('user', text);

        // Stream AI response
        await streamResponse();
    }

    // ── Stream from /api/chat ────────────────────────────────
    async function streamResponse() {
        chatState.streaming = true;
        sendBtn.disabled = true;
        showTyping();

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: chatState.messages,
                    propertyContext: buildPropertyContext(),
                }),
            });

            if (!res.ok) {
                const errText = await res.text();
                console.error('Chat API error:', res.status, errText);
                hideTyping();
                appendMessage('assistant', 'Sorry, I ran into a temporary issue connecting to my AI brain. Please try again in a moment, or contact Rosa directly at (954) 235-4046 — she\'d love to help!');
                chatState.streaming = false;
                sendBtn.disabled = false;
                return;
            }

            hideTyping();

            // Add empty assistant bubble to stream into
            const bubble = appendMessage('assistant', '', true);
            let fullText = '';

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Keep incomplete line in buffer

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(data);
                        // Anthropic streaming event
                        if (parsed.type === 'content_block_delta' &&
                            parsed.delta?.type === 'text_delta') {
                            fullText += parsed.delta.text;
                            bubble.innerHTML = renderMarkdown(fullText);
                            scrollToBottom();
                        }
                    } catch (_) { /* ignore parse errors */ }
                }
            }

            // Detect and strip PREFS_JSON marker before saving
            const prefsMatch = fullText.match(/<!--PREFS_JSON\s*(\{[\s\S]*?\})\s*PREFS_JSON-->/);
            if (prefsMatch) {
                // Strip marker from display
                const cleanText = fullText.replace(/<!--PREFS_JSON[\s\S]*?PREFS_JSON-->/, '').trim();
                bubble.innerHTML = renderMarkdown(cleanText);

                // Save preferences if we have a token
                const alertToken = localStorage.getItem('poler_alert_token');
                if (alertToken) {
                    try {
                        const prefs = JSON.parse(prefsMatch[1]);
                        fetch(`${OTP_BASE}/api/update-preferences`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                token: alertToken,
                                alertActive: true,
                                ...(prefs.propertyTypes && { propertyTypes: prefs.propertyTypes }),
                                ...(prefs.cities && { cities: prefs.cities }),
                                ...(prefs.priceMin && { priceMin: prefs.priceMin }),
                                ...(prefs.priceMax && { priceMax: prefs.priceMax }),
                                ...(prefs.bedsMin && { bedsMin: prefs.bedsMin }),
                                ...(prefs.bathsMin && { bathsMin: prefs.bathsMin }),
                            }),
                        }).catch(() => {});
                    } catch (_) { /* ignore parse errors */ }
                }

                fullText = cleanText; // Store clean text in history
            }

            // Save complete response to history
            chatState.messages.push({ role: 'assistant', content: fullText });

            // Save conversation to CRM (non-blocking)
            saveConversationToCRM();

        } catch (err) {
            hideTyping();
            appendMessage('assistant', 'Connection issue — please check your internet and try again.');
            console.error('AI chat error:', err);
        }

        chatState.streaming = false;
        sendBtn.disabled = false;
        inputEl.focus();
    }

    // ── Save conversation to CRM (non-blocking) ──────────────
    function saveConversationToCRM() {
        try {
            const leadData = localStorage.getItem('poler_lead_v1');
            if (!leadData) return;
            const lead = JSON.parse(leadData);
            if (!lead.email) return;

            fetch('/api/save-conversation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: lead.email,
                    messages: chatState.messages,
                    sessionId: chatState.sessionId,
                }),
            }).catch(err => console.error('Save conversation failed:', err));
        } catch (e) { /* non-critical */ }
    }

    // ── Open / close panel ───────────────────────────────────
    function openChat() {
        chatState.open = true;
        widget.classList.add('open');
        panel.classList.add('open');
        panel.setAttribute('aria-hidden', 'false');
        toggleBtn.setAttribute('aria-expanded', 'true');
        pingDot.classList.remove('visible');

        // Show greeting on first open
        if (!chatState.greeted) {
            chatState.greeted = true;
            setTimeout(() => {
                const greeting = heroListing
                    ? `Tell me what features you like about this home and I'll help you find others like it! 🏡\n\nI can also answer any real estate questions — financing, neighborhoods, investment potential, market trends — whatever's on your mind.`
                    : `Hi there! I'm your AI real estate assistant for The Poler Team. 🏡\n\nI can help you find properties, explain the buying process, analyze neighborhoods, or answer any real estate questions. What are you looking for?`;

                appendMessage('assistant', greeting);

                // Quick-reply chips
                setTimeout(() => {
                    addChips([
                        'What makes this a good investment?',
                        'How does the buying process work?',
                        'Tell me about this neighborhood',
                        'What can I afford?',
                    ]);
                }, 300);
            }, 250);
        }

        inputEl.focus();
    }

    function closeChat() {
        chatState.open = false;
        widget.classList.remove('open');
        panel.classList.remove('open');
        panel.setAttribute('aria-hidden', 'true');
        toggleBtn.setAttribute('aria-expanded', 'false');
    }

    // ── Auto-grow textarea ───────────────────────────────────
    function autoGrow(el) {
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }

    // ── Init ─────────────────────────────────────────────────
    function initAIChat() {
        widget     = document.getElementById('ai-chat-widget');
        toggleBtn  = document.getElementById('ai-chat-toggle');
        panel      = document.getElementById('ai-chat-panel');
        messagesEl = document.getElementById('ai-chat-messages');
        inputEl    = document.getElementById('ai-chat-input');
        sendBtn    = document.getElementById('ai-chat-send');
        pingDot    = document.getElementById('ai-chat-ping');

        if (!widget) return;

        // Toggle button
        toggleBtn.addEventListener('click', () => {
            chatState.open ? closeChat() : openChat();
        });

        // Close button
        document.getElementById('ai-chat-close').addEventListener('click', closeChat);

        // Send on button click
        sendBtn.addEventListener('click', () => sendMessage());

        // Send on Enter (Shift+Enter = newline)
        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // Auto-grow textarea
        inputEl.addEventListener('input', () => autoGrow(inputEl));

        // Close on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && chatState.open) closeChat();
        });

        // Notification ping after 8 seconds (draw attention)
        setTimeout(() => {
            if (!chatState.open) pingDot.classList.add('visible');
        }, 8000);
    }

    // Run after DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAIChat);
    } else {
        initAIChat();
    }
})();

// ============================================================
// BOOT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    // Apply saved language preference on load
    applyTranslations();
    initLanguageSelector();

    initLeadCapture();
    initHeroProperty();
    initLookup();
    initYearSlider();
    initWaterfrontToggle();
    initFilterToggle();
    initSearch();
});
