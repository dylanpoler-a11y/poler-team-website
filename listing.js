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

// South Florida cities whitelist (Florida City through Fort Lauderdale + surrounding)
const SOUTH_FL_CITIES = [
    'Florida City', 'Homestead', 'Cutler Bay', 'Palmetto Bay', 'Pinecrest',
    'South Miami', 'Coral Gables', 'Coconut Grove', 'Miami', 'Miami Beach',
    'Surfside', 'Bal Harbour', 'Bay Harbor Islands', 'Indian Creek',
    'North Bay Village', 'North Miami', 'North Miami Beach',
    'Sunny Isles Beach', 'Aventura', 'Golden Beach', 'Hallandale Beach',
    'Hollywood', 'Dania Beach', 'Fort Lauderdale', 'Oakland Park',
    'Pompano Beach', 'Key Biscayne', 'Doral', 'Hialeah', 'Hialeah Gardens',
    'Miami Gardens', 'Opa-locka', 'Miami Lakes', 'Miami Springs',
    'Miramar', 'Pembroke Pines', 'Weston', 'Davie', 'Plantation',
    'Sunrise', 'Lauderhill', 'Lauderdale Lakes', 'Tamarac',
    'Coral Springs', 'Margate', 'Coconut Creek', 'Wilton Manors',
    'Lauderdale-by-the-Sea', 'Lighthouse Point', 'Boca Raton',
    'Delray Beach', 'Boynton Beach', 'Lake Worth Beach',
    'West Palm Beach', 'Palm Beach', 'Deerfield Beach',
];

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
let activeTab      = 'buy';  // Current tab: 'buy', 'rent', or 'sell'
let hasActiveSearch = false; // Track if user has explicitly searched

// ============================================================
// UTILITIES
// ============================================================
function formatPrice(price) {
    if (!price) return t('priceOnRequest');
    return '$' + Number(price).toLocaleString('en-US');
}

function getPhoto(listing) {
    const m = listing && listing.Media;
    if (!m || !m.length) return null;

    const subType = listing.PropertySubType || '';
    const isHouse = subType.includes('Single Family') || subType.includes('Multi Family');
    const isCondo = subType.includes('Condominium') || subType.includes('Townhouse');

    if (isHouse) {
        // Prefer exterior/front photo for houses
        const ext = m.find(p => p.MediaCategory && /exterior|front/i.test(p.MediaCategory));
        if (ext && ext.MediaURL) return ext.MediaURL;
    } else if (isCondo) {
        // Prefer interior/living room photo for condos
        const int = m.find(p => p.MediaCategory && /interior|living/i.test(p.MediaCategory));
        if (int && int.MediaURL) return int.MediaURL;
    }

    return m[0].MediaURL;
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

    // Recognize returning leads from alert emails (URL has ?t=TOKEN)
    const alertToken = new URLSearchParams(window.location.search).get('t');
    if (alertToken && alertToken.length >= 10) {
        localStorage.setItem('poler_lead_v1', 'alert_' + alertToken);
        leadCaptured = true;
        return;
    }

    const overlay  = document.getElementById('lead-overlay');
    const bar      = document.getElementById('lead-timer-bar');
    const pageWrap = document.getElementById('page-wrap');

    // OTP disabled — all leads go straight through after filling form
    const skipOtp = true;

    // Init EmailJS
    if (typeof emailjs !== 'undefined' && EMAILJS_PUBLIC_KEY !== 'YOUR_PUBLIC_KEY') {
        emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
    }

    // 30-second countdown — persists across page refreshes
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

    // Scroll trigger: show modal if user scrolls past 3rd property card
    function checkScrollTrigger() {
        const cards = document.querySelectorAll('.listing-card:not(.is-skeleton)');
        if (cards.length >= 3) {
            const third = cards[2];
            const rect = third.getBoundingClientRect();
            if (rect.top < window.innerHeight) {
                window.removeEventListener('scroll', checkScrollTrigger);
                clearInterval(timerInterval);
                showLeadModal(overlay, pageWrap);
            }
        }
    }
    window.addEventListener('scroll', checkScrollTrigger, { passive: true });

    // ── Timeline pills (single-select) ────────────────────────
    document.querySelectorAll('#timeline-pills .timeline-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            document.querySelectorAll('#timeline-pills .timeline-pill').forEach(p => p.classList.remove('selected'));
            pill.classList.add('selected');
            document.getElementById('lead-timeline').value = pill.dataset.value;
        });
    });

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
        const ccSelect = document.getElementById('country-code');
        const countryCode = ccSelect.value.replace(/[^+\d]/g, ''); // strip "CA" suffix etc.
        const phone = countryCode + localPhone.replace(/\D/g, ''); // e.g. "+5511987654321"
        // Extract country name from selected option text, e.g. "🇧🇷 +55 (BR)" → "BR"
        const ccText = ccSelect.options[ccSelect.selectedIndex]?.text || '';
        const isoMatch = ccText.match(/\(([A-Z]{2})\)/);
        const countryIso = isoMatch ? isoMatch[1] : '';

        if (!first || !last || !email || !localPhone) {
            showLeadError('lead-error', t('errFillAll'));
            return;
        }
        const timeline = document.getElementById('lead-timeline')?.value || '';
        if (!timeline) {
            showLeadError('lead-error', t('errSelectTimeline') || 'Please select when you plan to buy');
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
            leadFormData = { first, last, email, phone, normalizedPhone: phone, countryIso };
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
            leadFormData = { first, last, email, phone, normalizedPhone: data.phone, countryIso };

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

    // Fire Google Ads conversion event
    if (typeof gtag === 'function') {
        gtag('event', 'conversion', {
            'send_to': 'AW-17910762846/E5E_CMfftJEcEN6awtxC',
            'value': heroListing ? (heroListing.ListPrice || 0) : 0,
            'currency': 'USD',
        });
    }

    // Save lead to Airtable CRM and capture alert token
    const langParam = new URLSearchParams(window.location.search).get('lang') || 'en';
    try {
        const timeline = document.getElementById('lead-timeline')?.value || '';
        const saveRes = await fetch(`${OTP_BASE}/api/save-lead`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                first,
                last,
                email,
                phone:          leadFormData.normalizedPhone,
                countryIso:     leadFormData.countryIso || '',
                listingAddress: heroListing
                    ? (heroListing.UnparsedAddress || heroListing.City || '')
                    : (new URLSearchParams(window.location.search).get('id') ? 'MLS# ' + new URLSearchParams(window.location.search).get('id') : ''),
                listingPrice:   heroListing ? (heroListing.ListPrice || 0) : 0,
                sourceUrl:      window.location.href,
                language:       langParam,
                timeline,
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

    // Fire Google Ads conversion tracking
    if (typeof gtag_report_conversion === 'function') {
        gtag_report_conversion();
    }

    // Unlock immediately after OTP verification (no more Step 3)
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

        // Load similar properties below the listing
        loadSimilarProperties(listing);

        // Track property view for returning leads (from alert emails)
        const alertToken = new URLSearchParams(window.location.search).get('t');
        if (alertToken && alertToken.length >= 10) {
            fetch(`${OTP_BASE}/api/log-activity`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token: alertToken,
                    activityType: 'Property View',
                    details: {
                        mlsId: listing.ListingId || listingId,
                        address: listing.UnparsedAddress || listing.City || '',
                        price: listing.ListPrice || 0,
                    },
                }),
            }).catch(() => {}); // non-blocking
        }
    } catch (err) {
        console.error('Hero fetch error:', err);
        renderDefaultHero(container);
    }
}

// ── INVESTMENT ANALYSIS PANEL (powered by InvestorOS) ────────────────────────
function renderInvestmentPanel(listing) {
    if (typeof computeInvestmentMetrics !== 'function') return '';
    const m = computeInvestmentMetrics(listing);
    if (!m) return '';

    const cfClass = m.monthlyCashFlow >= 0 ? 'positive' : 'negative';

    // Build InvestorOS deep link — sends user to register page
    const investorOsUrl = 'https://investoros1.com/register';

    return `
    <div class="inv-panel lp-section">
        <div class="inv-panel-header">
            <span class="inv-panel-title">Investment Analysis</span>
            <span>
                <span class="inv-panel-badge" style="background:${m.decisionColor}">${m.decision} &middot; ${m.dealScore}</span>
                <span class="inv-powered">Powered by InvestorOS</span>
            </span>
        </div>

        <div class="inv-rent-row">
            <div>
                <div class="inv-rent-value">Est. Rent: $${m.estimatedMonthlyRent.toLocaleString()}/mo</div>
                <div class="inv-rent-source">${m.rentExplanation}</div>
            </div>
        </div>

        <div class="inv-metrics">
            <div class="inv-metric">
                <div class="inv-metric-value">${fmtPct(m.capRate)}</div>
                <div class="inv-metric-label">Cap Rate</div>
            </div>
            <div class="inv-metric">
                <div class="inv-metric-value">${fmtPct(m.cashOnCash)}</div>
                <div class="inv-metric-label">Cash-on-Cash</div>
            </div>
            <div class="inv-metric">
                <div class="inv-metric-value">${fmtDscr(m.dscr)}</div>
                <div class="inv-metric-label">DSCR</div>
            </div>
            <div class="inv-metric">
                <div class="inv-metric-value ${cfClass}">${fmtCash(m.monthlyCashFlow)}</div>
                <div class="inv-metric-label">Cash Flow</div>
            </div>
        </div>

        <div class="inv-details">
            <span>NOI: ${fmtMoney(m.noi)}/yr</span>
            <span>Mortgage: $${Math.round(m.monthlyMortgage).toLocaleString()}/mo</span>
            <span>Down: ${fmtMoney(m.downPayment)} (20%)</span>
            <span>Cash Invested: ${fmtMoney(m.cashInvested)}</span>
        </div>

        <div class="inv-assumptions">
            80% LTV &middot; 7% rate &middot; 30yr &middot; Est. rent, tax &amp; insurance &middot; Not financial advice
        </div>

        <a href="${investorOsUrl}" target="_blank" rel="noopener" class="inv-cta">
            Analyze This Property in Detail on InvestorOS
        </a>
        <div class="inv-cta-sub">MLS rent comps &middot; 5-year projections &middot; IRR &middot; AI deal scoring</div>
    </div>`;
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
    // Address lookup
    const advBtn = document.getElementById('lookup-adv-btn');
    if (!advBtn) return; // Element not in DOM yet or removed

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
    // Mobile sidebar toggle (may not exist on desktop)
    const btn     = document.getElementById('filter-toggle');
    const body    = document.getElementById('filter-body');
    const label   = document.getElementById('filter-toggle-label');
    const chevron = document.getElementById('filter-toggle-chevron');

    if (btn && body) {
        btn.addEventListener('click', () => {
            const open = body.classList.toggle('open');
            if (label) label.textContent = open ? t('hideFilters') : t('showFilters');
            if (chevron) chevron.style.transform = open ? 'rotate(180deg)' : '';
            btn.setAttribute('aria-expanded', open);
        });
    }

    // Advanced filters toggle (More Filters button)
    const advToggle = document.getElementById('filter-adv-toggle');
    const advPanel  = document.getElementById('filter-advanced');

    if (advToggle && advPanel) {
        advToggle.addEventListener('click', () => {
            const isHidden = advPanel.style.display === 'none' || advPanel.style.display === '';
            advPanel.style.display = isHidden ? 'block' : 'none';
            advToggle.setAttribute('aria-expanded', isHidden);
        });
    }
}

// ============================================================
// SEARCH — build params + fetch from Bridge API
// ============================================================
function buildSearchParams() {
    const isRent = activeTab === 'rent';
    const params = { limit: PAGE_SIZE, sortBy: 'ModificationTimestamp', order: 'desc', StandardStatus: 'Active' };

    // Location (comma-separated cities → multiple City params handled below)
    const loc = document.getElementById('f-location').value.trim();
    if (loc) params._cities = loc.split(',').map(s => s.trim()).filter(Boolean);

    // Property Type — respect Buy vs Rent tab
    const baseType = isRent ? 'Residential Lease' : 'Residential';
    const type = document.getElementById('f-type').value;
    if (type !== 'all') {
        if (type === 'MultiFamily') {
            params.PropertyType = baseType;
            params.PropertySubType = 'Multi Family';
        } else {
            params.PropertyType = baseType;
            params.PropertySubType = type;
        }
    } else {
        params.PropertyType = baseType;
    }

    // Price — Buy mode uses thousands shorthand (500 = $500K), Rent mode uses exact amount
    const pMin = parseFloat(document.getElementById('f-price-min').value);
    const pMax = parseFloat(document.getElementById('f-price-max').value);
    const pErr = document.getElementById('price-error');
    if (!isNaN(pMin) && !isNaN(pMax) && pMin > pMax) { pErr.style.display = 'block'; return null; }
    pErr.style.display = 'none';
    const priceMult = isRent ? 1 : 1000;
    if (!isNaN(pMin) && pMin > 0) params['ListPrice.gte'] = pMin * priceMult;
    if (!isNaN(pMax) && pMax > 0) params['ListPrice.lte'] = pMax * priceMult;

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

    const isRent = activeTab === 'rent';
    const ranges = isRent
        ? [
            { 'ListPrice.gte': 1500,  'ListPrice.lte': 5000 },
            { 'ListPrice.gte': 5000,  'ListPrice.lte': 15000 },
            { 'ListPrice.gte': 15000, 'ListPrice.lte': 50000 },
          ]
        : [
            { 'ListPrice.gte': 500000,  'ListPrice.lte': 1000000 },
            { 'ListPrice.gte': 1000000, 'ListPrice.lte': 5000000 },
            { 'ListPrice.gte': 5000000, 'ListPrice.lte': 10000000 },
          ];

    try {
        const results = await Promise.allSettled(
            ranges.map(r => apiFetch({
                ...r,
                StandardStatus: 'Active',
                PropertyType: isRent ? 'Residential Lease' : 'Residential',
                limit: 8,
            }))
        );

        let all = [];
        results.forEach(r => {
            if (r.status === 'fulfilled' && r.value.success && Array.isArray(r.value.bundle)) {
                all = all.concat(r.value.bundle);
            }
        });

        // Filter to South Florida cities only
        all = all.filter(l => l.City && SOUTH_FL_CITIES.includes(l.City));

        // Sort by newest first (days on market ascending, or by modification date descending)
        all.sort((a, b) => {
            const domA = a.DaysOnMarket != null ? a.DaysOnMarket : 9999;
            const domB = b.DaysOnMarket != null ? b.DaysOnMarket : 9999;
            return domA - domB;
        });

        grid.innerHTML = '';

        if (!all.length) {
            noResults.style.display = 'block';
            countEl.textContent = 'No featured properties available';
            return;
        }

        window._currentListings = all;
        const renderFn = currentViewMode === 'list' ? renderListItem : renderCard;
        if (currentViewMode === 'list') grid.classList.add('results-list-view');
        all.forEach(l => grid.insertAdjacentHTML('beforeend', renderFn(l)));
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

    // NEW badge for listings <= 7 days on market
    const dom = listing.DaysOnMarket;
    const isNew = dom != null && dom <= 7;

    // Price per sqft
    const sqft = listing.LivingArea;
    const ppsfVal = (listing.ListPrice && sqft) ? Math.round(listing.ListPrice / sqft) : 0;

    // Heart/save state
    let savedHomes = [];
    try { savedHomes = JSON.parse(localStorage.getItem('poler_saved_homes') || '[]'); } catch (e) {}
    const isSaved = savedHomes.includes(lid);

    // Quick cap rate badge for investor scanning
    let capBadge = '';
    if (typeof computeInvestmentMetrics === 'function') {
        const m = computeInvestmentMetrics(listing);
        if (m) capBadge = `<span class="inv-card-badge">Cap ${fmtPct(m.capRate)}</span>`;
    }

    return `
    <div class="listing-card" data-lid="${lid}" onclick="window.location.href='listing?mls=${lid}'">
        <div class="listing-image" style="position:relative">
            ${imgHtml}
            ${isNew ? '<span class="listing-new-badge">NEW</span>' : ''}
            <button class="listing-save-btn ${isSaved ? 'saved' : ''}" onclick="event.stopPropagation();toggleSaveHome('${lid}',this)" aria-label="Save property">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
            </button>
            <div class="listing-overlay">
                <span class="listing-area">${city}</span>
                <span class="listing-status-badge ${statusClass}">${status}</span>
            </div>
            ${capBadge}
        </div>
        <div class="listing-details">
            <div class="listing-price">${price}</div>
            <div class="listing-address">${address}</div>
            ${stats ? `<div class="listing-stats">${stats}</div>` : ''}
            ${ppsfVal ? `<div class="listing-ppsf">$${ppsfVal.toLocaleString()} / sq ft</div>` : ''}
            <div class="listing-agent-row">
                <img src="team-rosa.jpg" alt="${agent}" class="listing-agent-avatar">
                <span class="listing-agent-name">${agent}</span>
                <span class="listing-agent-brokerage">Optimar Int'l</span>
            </div>
        </div>
    </div>`;
}

function renderListItem(listing) {
    const photos = getAllPhotos(listing);
    const photo = photos[0] || '';
    const price = formatPrice(listing.ListPrice);
    const address = listing.UnparsedAddress || listing.City || 'South Florida';
    const city = listing.City || '';
    const lid = listing.ListingId || '';
    const beds = listing.BedroomsTotal || '—';
    const baths = listing.BathroomsTotalInteger || '—';
    const sqft = listing.LivingArea ? Number(listing.LivingArea).toLocaleString() : '—';
    const dom = listing.DaysOnMarket != null ? listing.DaysOnMarket : '—';
    const isNew = listing.DaysOnMarket != null && listing.DaysOnMarket <= 7;
    const ppsfVal = (listing.ListPrice && listing.LivingArea) ? '$' + Math.round(listing.ListPrice / listing.LivingArea).toLocaleString() : '';
    const status = listing.StandardStatus || 'Active';
    const statusClass = status === 'Active' ? 'status-active' : status === 'Pending' ? 'status-pending' : 'status-other';
    const propType = listing.PropertySubType || listing.PropertyType || '';
    const yearBuilt = listing.YearBuilt || '';
    const lot = listing.LotSizeSquareFeet ? Number(listing.LotSizeSquareFeet).toLocaleString() + ' sqft lot' : '';
    const hoa = listing.AssociationFee ? '$' + Number(listing.AssociationFee).toLocaleString() + '/mo HOA' : '';
    const listDate = listing.ListingContractDate || listing.OnMarketDate || '';
    const listDateStr = listDate ? new Date(listDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

    const imgHtml = photo
        ? `<img class="lv-photo" src="${photo}" alt="${address}" loading="lazy">`
        : `<div class="lv-photo-placeholder"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M3 21h18M5 21V7l8-4v18M13 21V3l6 4v14"/></svg></div>`;

    return `
    <div class="lv-item" onclick="window.location.href='listing?mls=${lid}'">
        <div class="lv-image">
            ${imgHtml}
            ${isNew ? '<span class="lv-new-badge">NEW</span>' : ''}
            <span class="lv-status ${statusClass}">${status}</span>
        </div>
        <div class="lv-info">
            <div class="lv-top-row">
                <div class="lv-price">${price}</div>
                <div class="lv-dom">${dom !== '—' ? dom + ' days on market' : ''}${listDateStr ? ' · Listed ' + listDateStr : ''}</div>
            </div>
            <div class="lv-address">${address}</div>
            <div class="lv-stats-row">
                <span class="lv-stat"><strong>${beds}</strong> beds</span>
                <span class="lv-stat"><strong>${baths}</strong> baths</span>
                <span class="lv-stat"><strong>${sqft}</strong> sqft</span>
                ${ppsfVal ? `<span class="lv-stat">${ppsfVal}/sqft</span>` : ''}
            </div>
            <div class="lv-details-row">
                ${propType ? `<span class="lv-tag">${propType}</span>` : ''}
                ${yearBuilt ? `<span class="lv-tag">Built ${yearBuilt}</span>` : ''}
                ${lot ? `<span class="lv-tag">${lot}</span>` : ''}
                ${hoa ? `<span class="lv-tag">${hoa}</span>` : ''}
            </div>
        </div>
    </div>`;
}

let currentViewMode = 'list'; // 'grid', 'list', or 'map' — default to list

function switchView(mode) {
    const btns = document.querySelectorAll('.view-toggle-btn[data-view]');
    const grid = document.getElementById('results-grid');
    const mapView = document.getElementById('map-view');

    currentViewMode = mode;
    btns.forEach(b => b.classList.toggle('active', b.dataset.view === mode));

    const listings = window._currentListings || [];

    if (mode === 'grid') {
        grid.style.display = '';
        grid.classList.remove('results-list-view');
        if (mapView) mapView.style.display = 'none';
        if (listings.length) {
            grid.innerHTML = '';
            listings.forEach(l => grid.insertAdjacentHTML('beforeend', renderCard(l)));
        }
    } else if (mode === 'list') {
        grid.style.display = '';
        grid.classList.add('results-list-view');
        if (mapView) mapView.style.display = 'none';
        if (listings.length) {
            grid.innerHTML = '';
            listings.forEach(l => grid.insertAdjacentHTML('beforeend', renderListItem(l)));
        }
    } else if (mode === 'map') {
        grid.style.display = 'none';
        if (mapView) mapView.style.display = 'block';
    }
}

function initViewToggle() {
    document.querySelectorAll('.view-toggle-btn[data-view]').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // Set default active button to list
    const listBtn = document.getElementById('view-list-btn');
    const gridBtn = document.getElementById('view-grid-btn');
    if (listBtn && gridBtn) {
        gridBtn.classList.remove('active');
        listBtn.classList.add('active');
    }

    // Support ?view=grid URL param override
    const viewParam = new URLSearchParams(window.location.search).get('view');
    if (viewParam === 'grid') {
        if (gridBtn) gridBtn.click();
    }
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
    if (searchTxt) searchTxt.textContent = t('search') + '...';

    try {
        const listings = await fetchListings({ ...lastQuery }, searchOffset);

        if (!append) grid.innerHTML = '';

        if (!listings.length && !append) {
            noResults.style.display = 'block';
            countEl.textContent = 'No results found';
            loadMore.style.display = 'none';
            return;
        }

        if (!append) window._currentListings = listings;
        else window._currentListings = (window._currentListings || []).concat(listings);

        const renderFn = currentViewMode === 'list' ? renderListItem : renderCard;
        if (currentViewMode === 'list' && !append) grid.classList.add('results-list-view');
        listings.forEach(l => {
            grid.insertAdjacentHTML('beforeend', renderFn(l));
        });

        searchOffset += listings.length;
        totalResults = searchOffset; // approximate

        countEl.textContent = `Showing ${searchOffset} propert${searchOffset === 1 ? 'y' : 'ies'}`;
        loadMore.style.display = listings.length === PAGE_SIZE ? 'block' : 'none';

        // Show save search CTA after explicit search
        if (!append && hasActiveSearch) {
            const cta = document.getElementById('save-search-cta');
            if (cta) cta.style.display = 'block';
        }

        // Update map if in map view
        if (document.getElementById('map-view')?.style.display === 'block') renderMapView();

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
        if (searchTxt) searchTxt.textContent = t('searchProperties');
    }
}

// ============================================================
// REFRESH GRID — called by language switcher to re-render without breaking
// ============================================================
function refreshGrid() {
    if (hasActiveSearch && lastQuery && Object.keys(lastQuery).length > 0) {
        // Re-run the last search to update translated labels
        runSearch(false);
    } else {
        // Re-fetch curated listings with translated labels
        fetchCuratedListings();
    }
}

// ============================================================
// TABS — Buy / Rent / Sell
// ============================================================
function initTabs() {
    const tabs = document.querySelectorAll('.search-tab');
    const searchWrap = document.getElementById('search-bar-wrap');
    const sellPanel  = document.getElementById('sell-form-panel');
    const browseSection = document.getElementById('browse-section');

    if (!tabs.length) return;

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Update active tab styling
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            activeTab = tab.dataset.tab;

            // Show/hide sell form vs search bar
            if (activeTab === 'sell') {
                if (searchWrap) searchWrap.style.display = 'none';
                if (sellPanel) sellPanel.style.display = 'block';
                if (browseSection) browseSection.style.display = 'none';
            } else {
                if (searchWrap) searchWrap.style.display = '';
                if (sellPanel) sellPanel.style.display = 'none';
                if (browseSection) browseSection.style.display = '';

                // Update price hint and placeholders based on mode
                const hint = document.getElementById('price-hint');
                const pMin = document.getElementById('f-price-min');
                const pMax = document.getElementById('f-price-max');
                if (activeTab === 'rent') {
                    if (hint) hint.style.display = 'none';
                    if (pMin) pMin.placeholder = 'Min Rent';
                    if (pMax) pMax.placeholder = 'Max Rent';
                } else {
                    if (hint) hint.style.display = '';
                    if (pMin) pMin.placeholder = 'Min Price (000s)';
                    if (pMax) pMax.placeholder = 'Max Price (000s)';
                }
                // Clear price inputs when switching modes
                if (pMin) pMin.value = '';
                if (pMax) pMax.value = '';

                // Re-fetch with correct mode (buy = sale listings, rent = rental listings)
                hasActiveSearch = false;
                fetchCuratedListings();
            }
        });
    });
}

// ============================================================
// SEARCH BAR AUTOCOMPLETE + GO BUTTON
// ============================================================
function initSearchBar() {
    const input    = document.getElementById('search-autocomplete');
    const dropdown = document.getElementById('search-ac-dropdown');
    const goBtn    = document.getElementById('search-bar-go');
    if (!input) return;

    async function doSearch() {
        const val = input.value.trim();
        if (!val) return;
        if (dropdown) dropdown.style.display = 'none';

        // Check if input looks like an address (starts with a number)
        const addressMatch = val.match(/^(\d+)\s+(.+)/);
        if (addressMatch) {
            const streetNum = addressMatch[1];
            let streetRest = addressMatch[2].replace(/,.*/, '').trim();

            // Parse direction prefix (N, S, E, W, NE, NW, SE, SW)
            const dirMatch = streetRest.match(/^(NE|NW|SE|SW|N|S|E|W)\s+(.+)/i);
            const params = { StreetNumber: streetNum, limit: 5 };
            if (dirMatch) {
                params.StreetDirPrefix = dirMatch[1].toUpperCase();
                params.StreetName = dirMatch[2].trim();
            } else {
                params.StreetName = streetRest;
            }

            try {
                const data = await apiFetch(params);
                const listing = data.success && data.bundle && data.bundle[0];
                if (listing) {
                    window.location.href = `listing?id=${listing.ListingId}`;
                    return;
                }
            } catch (err) { console.warn('Address lookup failed:', err); }
        }

        // Check if input is a ZIP code
        if (/^\d{5}$/.test(val)) {
            const locInput = document.getElementById('f-location');
            if (locInput) locInput.value = '';
            hasActiveSearch = true;
            const grid = document.getElementById('results-grid');
            const countEl = document.getElementById('results-count');
            grid.innerHTML = renderSkeletons();
            countEl.textContent = 'Searching...';
            const isRent = activeTab === 'rent';
            const params = { limit: PAGE_SIZE, sortBy: 'ModificationTimestamp', order: 'desc', StandardStatus: 'Active', PropertyType: isRent ? 'Residential Lease' : 'Residential', PostalCode: val };
            lastQuery = { ...params };
            const listings = await fetchListings(params);
            grid.innerHTML = '';
            window._currentListings = listings;
            if (!listings.length) { document.getElementById('no-results').style.display = 'block'; countEl.textContent = 'No results found'; return; }
            document.getElementById('no-results').style.display = 'none';
            const renderFn2 = currentViewMode === 'list' ? renderListItem : renderCard;
            if (currentViewMode === 'list') grid.classList.add('results-list-view');
            listings.forEach(l => grid.insertAdjacentHTML('beforeend', renderFn2(l)));
            countEl.textContent = `Showing ${listings.length} properties`;
            const browse = document.getElementById('browse-section');
            if (browse) browse.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }

        // Default: treat as city name search
        const locInput = document.getElementById('f-location');
        if (locInput) locInput.value = val;
        hasActiveSearch = true;
        runSearch(false);
        const browse = document.getElementById('browse-section');
        if (browse) browse.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Go button click
    if (goBtn) goBtn.addEventListener('click', doSearch);

    // Enter key in search bar
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
    });

    // Simple autocomplete from city list
    let debounce;
    input.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
            const q = input.value.toLowerCase().trim();
            if (!q || !dropdown) { if (dropdown) dropdown.style.display = 'none'; return; }

            const matches = [];
            // ZIP check
            if (/^\d{3,5}$/.test(q)) {
                matches.push({ label: `Search ZIP: ${q}`, value: q, type: 'zip' });
            }
            // City matches
            SOUTH_FL_CITIES.filter(c => c.toLowerCase().includes(q)).slice(0, 6).forEach(city => {
                matches.push({ label: city, sub: 'South Florida', value: city, type: 'city' });
            });
            if (!matches.length) {
                matches.push({ label: `Search for "${input.value.trim()}"`, value: input.value.trim(), type: 'text' });
            }

            dropdown.innerHTML = matches.map((m, i) => `
                <div class="search-ac-item" data-idx="${i}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    <div><div>${m.label}</div>${m.sub ? `<div class="search-ac-item-sub">${m.sub}</div>` : ''}</div>
                </div>`).join('');
            dropdown.style.display = 'block';

            dropdown.querySelectorAll('.search-ac-item').forEach(el => {
                el.addEventListener('click', () => {
                    const m = matches[parseInt(el.dataset.idx)];
                    input.value = m.value;
                    dropdown.style.display = 'none';
                    doSearch();
                });
            });
        }, 150);
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        if (dropdown && !e.target.closest('.search-bar-wrap')) dropdown.style.display = 'none';
    });
}

// ============================================================
// AREA CHIP BUTTONS (Quick city search)
// ============================================================
function initAreaChips() {
    document.querySelectorAll('.area-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const city = chip.dataset.city;
            const locInput = document.getElementById('f-location');
            const searchInput = document.getElementById('search-autocomplete');
            if (locInput) locInput.value = city;
            if (searchInput) searchInput.value = city;
            hasActiveSearch = true;
            runSearch(false);
            const browse = document.getElementById('browse-section');
            if (browse) browse.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });
}

// ============================================================
// SAVE HOME (heart icon on cards)
// ============================================================
function toggleSaveHome(lid, btn) {
    if (!lid) return;
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem('poler_saved_homes') || '[]'); } catch (e) {}
    const idx = saved.indexOf(lid);
    if (idx >= 0) { saved.splice(idx, 1); btn.classList.remove('saved'); }
    else { saved.push(lid); btn.classList.add('saved'); }
    localStorage.setItem('poler_saved_homes', JSON.stringify(saved));
}

// ============================================================
// SAVE SEARCH / GET ALERTS
// ============================================================
function initSaveSearch() {
    const form = document.getElementById('save-search-form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const emailInput = document.getElementById('save-search-email');
        const email = emailInput ? emailInput.value.trim() : '';
        if (!email) return;
        const btn = form.querySelector('button');
        btn.disabled = true;
        btn.textContent = '...';
        try {
            await fetch(`${OTP_BASE}/api/save-lead`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ first: '', last: '', email, phone: '', sourceUrl: window.location.href, utm_source: 'save-search', timeline: 'Save Search Alert' }),
            });
        } catch (err) { console.warn('Save search error:', err); }
        form.style.display = 'none';
        const success = document.getElementById('save-search-success');
        if (success) success.style.display = 'block';
    });
}

// ============================================================
// SIMILAR PROPERTIES (on detail listing pages)
// ============================================================
async function loadSimilarProperties(listing) {
    if (!listing || !listing.City) return;
    const price = listing.ListPrice || 0;
    const pMin = Math.round(price * 0.7);
    const pMax = Math.round(price * 1.3);
    const subType = listing.PropertySubType || '';

    const params = {
        City: listing.City,
        'ListPrice.gte': pMin,
        'ListPrice.lte': pMax,
        StandardStatus: 'Active',
        PropertyType: 'Residential',
        limit: 7,
    };
    if (subType) params.PropertySubType = subType;

    try {
        const data = await apiFetch(params);
        let similar = (data.success && Array.isArray(data.bundle)) ? data.bundle : [];
        // Filter out the current listing
        similar = similar.filter(l => l.ListingId !== listing.ListingId).slice(0, 6);
        if (!similar.length) return;

        const section = document.createElement('section');
        section.className = 'similar-section';
        section.innerHTML = `
            <div class="similar-inner">
                <h2 class="similar-title">${t('similarProperties') || 'Similar Properties Nearby'}</h2>
                <div class="similar-grid">${similar.map(l => renderCard(l)).join('')}</div>
            </div>`;
        const hero = document.getElementById('hero-property');
        if (hero) hero.after(section);

        // Wire up card clicks
        section.querySelectorAll('.listing-card[data-lid]').forEach(card => {
            card.addEventListener('click', () => {
                window.location.href = `listing?id=${card.dataset.lid}`;
            });
        });
    } catch (err) {
        console.warn('Similar properties error:', err);
    }
}

// ============================================================
// MAP VIEW TOGGLE
// ============================================================
let mapInstance = null;
let mapMarkers = [];

function initViewToggle() {
    const listBtn = document.getElementById('view-list-btn');
    const mapBtn  = document.getElementById('view-map-btn');
    const grid    = document.getElementById('results-grid');
    const mapDiv  = document.getElementById('map-view');
    if (!listBtn || !mapBtn || !grid || !mapDiv) return;

    listBtn.addEventListener('click', () => {
        listBtn.classList.add('active');
        mapBtn.classList.remove('active');
        grid.style.display = '';
        mapDiv.style.display = 'none';
    });

    mapBtn.addEventListener('click', () => {
        mapBtn.classList.add('active');
        listBtn.classList.remove('active');
        grid.style.display = 'none';
        mapDiv.style.display = 'block';
        renderMapView();
    });
}

function renderMapView() {
    const mapDiv = document.getElementById('map-view');
    if (!mapDiv || typeof maplibregl === 'undefined') return;
    const listings = window._currentListings || [];

    if (!mapInstance) {
        mapInstance = new maplibregl.Map({
            container: 'map-view',
            style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
            center: [-80.15, 25.95],
            zoom: 10,
        });
        mapInstance.addControl(new maplibregl.NavigationControl(), 'top-left');
    }

    // Clear old markers
    mapMarkers.forEach(m => m.remove());
    mapMarkers = [];

    const bounds = new maplibregl.LngLatBounds();
    let hasPoints = false;

    listings.forEach(l => {
        const lat = l.Latitude;
        const lng = l.Longitude;
        if (!lat || !lng) return;
        hasPoints = true;
        bounds.extend([lng, lat]);

        const price = l.ListPrice ? '$' + (l.ListPrice >= 1000000 ? (l.ListPrice / 1000000).toFixed(1) + 'M' : Math.round(l.ListPrice / 1000) + 'K') : '';
        const el = document.createElement('div');
        el.className = 'map-price-marker';
        el.textContent = price;

        const photo = (l.Media && l.Media[0]) ? l.Media[0].MediaURL : '';
        const addr = l.UnparsedAddress || l.City || '';
        const popup = new maplibregl.Popup({ offset: 25, maxWidth: '280px' }).setHTML(`
            ${photo ? `<img src="${photo}" style="width:100%;height:120px;object-fit:cover;border-radius:6px 6px 0 0;">` : ''}
            <div style="padding:8px 10px;">
                <div style="font-weight:700;font-size:1rem;">${price}</div>
                <div style="font-size:0.8rem;color:#666;">${addr}</div>
                <div style="font-size:0.78rem;color:#999;">${l.BedroomsTotal || '—'} bd · ${l.BathroomsTotalInteger || '—'} ba${l.LivingArea ? ' · ' + Number(l.LivingArea).toLocaleString() + ' sf' : ''}</div>
                <a href="listing?id=${l.ListingId}" style="display:inline-block;margin-top:6px;color:#1a2744;font-weight:600;font-size:0.8rem;">View Details →</a>
            </div>
        `);

        const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).setPopup(popup).addTo(mapInstance);
        mapMarkers.push(marker);
    });

    if (hasPoints) {
        mapInstance.fitBounds(bounds, { padding: 50, maxZoom: 14 });
    }
}

// ============================================================
// FOOTER ALERT FORM
// ============================================================
function initFooterAlert() {
    const form = document.getElementById('footer-alert-form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const emailInput = document.getElementById('footer-alert-email');
        const email = emailInput ? emailInput.value.trim() : '';
        if (!email) return;
        const btn = form.querySelector('button');
        btn.disabled = true;
        btn.textContent = '...';
        try {
            await fetch(`${OTP_BASE}/api/save-lead`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ first: '', last: '', email, phone: '', sourceUrl: window.location.href, utm_source: 'footer-alert', timeline: 'Footer Alert Signup' }),
            });
        } catch (err) { console.warn('Footer alert error:', err); }
        form.innerHTML = '<span style="color:#16a34a;font-size:0.85rem;">✓ Subscribed!</span>';
    });
}

// ============================================================
// DRONE VIDEO FALLBACK
// ============================================================
function enhanceDroneVideo() {
    const video = document.querySelector('.hero-bg-video');
    if (!video) return;
    video.setAttribute('poster', 'images/cover-lauderdale.png');
    video.addEventListener('error', () => {
        const wrap = video.closest('.hero-video-wrap');
        if (wrap) {
            wrap.style.backgroundImage = 'url(images/cover-lauderdale.png)';
            wrap.style.backgroundSize = 'cover';
            wrap.style.backgroundPosition = 'center';
        }
        video.style.display = 'none';
    });
    // Handle autoplay block
    const playPromise = video.play();
    if (playPromise) playPromise.catch(() => {});
}

function initSearch() {
    document.getElementById('search-btn').addEventListener('click', () => { hasActiveSearch = true; runSearch(false); });

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
            if (e.key === 'Enter') { e.preventDefault(); hasActiveSearch = true; runSearch(false); }
        });
    });

    // Pre-fill location from ?city= URL param and auto-run
    const urlParams = new URLSearchParams(window.location.search);
    const cityParam = urlParams.get('city');
    if (cityParam) {
        const locInput = document.getElementById('f-location');
        if (locInput) locInput.value = decodeURIComponent(cityParam.replace(/\+/g, ' '));
    }

    // If search-specific params exist, run search; otherwise show curated mix.
    // Note: 'id' and 'mls' are for the hero property display, not for grid search.
    const hasSearchParam = urlParams.get('city');
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
            const res = await fetch(`${OTP_BASE}/api/chat`, {
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
    initTabs();
    initLookup();
    initYearSlider();
    initWaterfrontToggle();
    initFilterToggle();
    initSearchBar();
    initAreaChips();
    initSearch();
    initViewToggle();
    initSaveSearch();
    initFooterAlert();
    initViewToggle();
    setTimeout(enhanceDroneVideo, 500);
});
