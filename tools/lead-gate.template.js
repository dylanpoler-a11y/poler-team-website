/* ============================================================
   lead-gate.js — site-wide 10-second lead gate (2026-09-10)

   Kevin: "a popup for anybody who is on the page for the first time,
   anywhere on homesinsoflorida.com — the home page and any of the
   landing pages — and it must work the same way as the listing page."

   This is the listing.html / listing.js gate (initLeadCapture →
   showLeadModal → completeLead → rememberLead)
   lifted into one self-contained file for every OTHER public page:
   index, preconstruction, str, home-valuation and the 41 /tower pages.
   listing.html keeps its own copy (it also has hero/OTP/A-B wiring);
   this file bails out when it sees `#lead-overlay` already in the DOM.

   Behaviour parity with listing.js, on purpose:
   - fires for ALL traffic after 10 s (shared sessionStorage timer
     `poler_lead_timer_start`, so the clock keeps running across pages),
     or earlier on scroll depth
   - recognition/bypass: team cookie `poler_team` / `poler_team_member`,
     `?t=<token>` links, server cookie `poler_lt`, localStorage
     `poler_lead_v1` (also set by nav.js's contact form) — recognized
     visitors never see it; the cookie self-heals old leads
   - 2-page form: name + email → phone + timeline; no OTP
   - POST /api/save-lead (same payload shape as listing.js; the server
     sends the welcome + team-notification emails, so no EmailJS here)
   - same Meta Pixel / Google Ads conversion events
   - `rememberLead` is called SAME-ORIGIN so the 1-year cookie lands on
     .homesinsoflorida.com (never the vercel.app host)
   - EN/ES/PT copy = the gate keys copied verbatim from i18n.js (these
     pages don't load i18n.js). Regenerate with tools/build-lead-gate.js
     whenever those keys change.
   ============================================================ */
(function () {
    'use strict';
    if (window.__polerLeadGate) return;
    window.__polerLeadGate = true;

    var OTP_BASE = 'https://poler-team-website-two.vercel.app'; // save-lead / log-activity host (same as listing.js)
    var DURATION = 10000;
    var TIMER_KEY = 'poler_lead_timer_start';

    var STRINGS = __I18N_JSON__;

    // ── Language: ?lang → page <html lang> when es/pt (ES/PT tower pages)
    //    → remembered choice (poler_lang, shared with i18n.js and
    //    preconstruction.js) → en.
    var _langMem = null;
    function getLang() {
        var lang = '';
        try { lang = new URLSearchParams(window.location.search).get('lang') || ''; } catch (e) {}
        if (lang === 'en' || lang === 'es' || lang === 'pt') {
            try { localStorage.setItem('poler_lang', lang); } catch (e) { _langMem = lang; }
            return lang;
        }
        var docLang = (document.documentElement.lang || '').slice(0, 2).toLowerCase();
        if (docLang === 'es' || docLang === 'pt') return docLang;
        try { lang = localStorage.getItem('poler_lang') || _langMem || ''; } catch (e) { lang = _langMem || ''; }
        return (lang === 'es' || lang === 'pt') ? lang : 'en';
    }
    function t(key) {
        var entry = STRINGS[key];
        if (!entry) return key;
        return entry[getLang()] || entry.en || key;
    }

    // ── Storage / identity helpers (verbatim from listing.js) ─────
    function readCookies() {
        var out = {};
        try {
            document.cookie.split(';').forEach(function (part) {
                var i = part.indexOf('=');
                if (i < 0) return;
                var k = part.slice(0, i).trim();
                if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
            });
        } catch (e) { /* no cookie access */ }
        return out;
    }
    function getCookieValue(name) {
        var escaped = name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1');
        var match = document.cookie.match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
        return match ? decodeURIComponent(match[1]) : '';
    }
    function leadIdentity() {
        var tok = '', v1 = '';
        try {
            tok = localStorage.getItem('poler_alert_token') || '';
            v1  = localStorage.getItem('poler_lead_v1') || '';
        } catch (e) { /* storage blocked */ }
        if (!tok) {
            var c = readCookies().poler_lt;
            if (c && c.length >= 10) tok = c;
        }
        if (!tok && v1.indexOf('alert_') === 0 && v1.length > 16) tok = v1.slice(6);
        if (tok) return { token: tok };
        if (v1.indexOf('@') > 0) return { email: v1 };
        return null;
    }
    // Same-origin on purpose — the cookie must land on www.homesinsoflorida.com.
    function rememberLead(id) {
        if (!id || (!id.token && !id.email)) return Promise.resolve(false);
        return fetch('/api/remember', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(id),
        }).then(function (r) { return r.ok; }).catch(function () { return false; });
    }
    function trackEvent(name, params) {
        try { if (typeof gtag === 'function') gtag('event', name, params || {}); } catch (e) { /* GA blocked */ }
    }
    function getUtmParams() {
        var params = new URLSearchParams(window.location.search);
        return {
            utm_source:   params.get('utm_source')   || '',
            utm_medium:   params.get('utm_medium')   || '',
            utm_campaign: params.get('utm_campaign') || '',
            utm_content:  params.get('utm_content')  || '',
            utm_term:     params.get('utm_term')     || '',
            fbclid:       params.get('fbclid')       || '',
        };
    }

    // ── Markup + CSS (copied from listing.html / listing.css) ─────
    var CSS = __CSS__;

    function gateMarkup() {
        return '' +
        '<div class="lead-modal">' +
          '<div class="lead-modal-brand"><img src="/logo-white.png" alt="The Poler Team" class="lead-logo"></div>' +
          '<div class="lead-modal-body">' +
            '<div id="lead-step-1">' +
              '<h2 class="lead-title" id="lead-title" data-i18n="leadTitle"></h2>' +
              '<p class="lead-subtitle" id="lead-subtitle" data-i18n="leadSubtitle"></p>' +
              '<div class="lead-timer-wrap"><div class="lead-timer-bar" id="lead-timer-bar"></div></div>' +
              '<p id="lead-step-indicator" data-i18n="step1of2" style="font-size:12px;color:var(--text-muted);text-align:center;margin:0 0 6px;font-weight:600;letter-spacing:.05em;text-transform:uppercase"></p>' +
              '<form id="lead-form" class="lead-form" novalidate>' +
                '<div id="lead-fields-1">' +
                  '<div class="lead-field"><input type="text" id="lead-name" data-i18n="fullName" required autocomplete="name"></div>' +
                  '<div class="lead-field"><input type="email" id="lead-email" data-i18n="emailAddress" required autocomplete="email"></div>' +
                '</div>' +
                '<div id="lead-fields-2" style="display:none">' +
                  '<div class="lead-field lead-phone-wrap">' +
                    '<select id="country-code" aria-label="Country code">' + __CC_OPTIONS__ + '</select>' +
                    '<input type="tel" id="lead-phone" data-i18n="phonePlaceholder" required autocomplete="tel">' +
                  '</div>' +
                  '<div class="timeline-field">' +
                    '<label class="timeline-label" data-i18n="timelineLabel"></label>' +
                    '<div class="timeline-pills" id="timeline-pills">' +
                      '<button type="button" class="timeline-pill" data-value="0-3 months" data-i18n="tl0to3"></button>' +
                      '<button type="button" class="timeline-pill" data-value="3-6 months" data-i18n="tl3to6"></button>' +
                      '<button type="button" class="timeline-pill" data-value="6-12 months" data-i18n="tl6to12"></button>' +
                      '<button type="button" class="timeline-pill" data-value="12+ months" data-i18n="tl12plus"></button>' +
                    '</div>' +
                    '<input type="hidden" id="lead-timeline" value="">' +
                  '</div>' +
                '</div>' +
                '<p class="lead-error" id="lead-error" style="display:none"></p>' +
                '<button type="submit" class="lead-submit" id="lead-submit-btn">' +
                  '<span id="lead-submit-text" data-i18n="continueBtn"></span>' +
                  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014.68 11.6 19.79 19.79 0 011.61 3a2 2 0 012-2.18h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.91 8.09a16 16 0 006 6l.91-.91a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>' +
                '</button>' +
                '<p class="lead-consent" id="lead-consent" data-i18n="consentDisclosure" style="display:none"></p>' +
              '</form>' +
            '</div>' +
          '</div>' +
        '</div>';
    }

    // Fill every [data-i18n] inside the gate (inputs get placeholder text).
    function applyGateTranslations(root) {
        var lang = getLang();
        root.querySelectorAll('[data-i18n]').forEach(function (el) {
            var entry = STRINGS[el.getAttribute('data-i18n')];
            if (!entry) return;
            var text = entry[lang] || entry.en;
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.placeholder = text;
            else el.textContent = text;
        });
    }

    // ── Page lock (listing.css blurs #page-wrap; pages without one blur
    //    every body child except the overlay) ──────────────────────
    function lockPage() {
        document.documentElement.classList.add('lead-gate-locked');
        var pw = document.getElementById('page-wrap');
        if (pw) pw.classList.add('blurred');
    }
    function unlockPageDom() {
        document.documentElement.classList.remove('lead-gate-locked');
        var pw = document.getElementById('page-wrap');
        if (pw) pw.classList.remove('blurred');
    }

    function init() {
        // listing.html carries its own gate — never double up.
        if (document.getElementById('lead-overlay')) return;

        var leadCaptured = false, isTeamDevice = false;
        try { leadCaptured = !!localStorage.getItem('poler_lead_v1'); } catch (e) { leadCaptured = false; }

        // RECOGNITION — same order of trust as listing.js: team cookie/flag →
        // ?t= link → poler_lt cookie → localStorage; whichever recognizes the
        // visitor re-seeds the others.
        var cookies = readCookies();
        try {
            if (cookies.poler_team === '1' || localStorage.getItem('poler_team_member')) isTeamDevice = true;
        } catch (e) { if (cookies.poler_team === '1') isTeamDevice = true; }
        if (isTeamDevice) leadCaptured = true;

        var alertToken = '';
        try { alertToken = new URLSearchParams(window.location.search).get('t') || ''; } catch (e) {}
        if (alertToken && alertToken.length >= 10) {
            try {
                if (!localStorage.getItem('poler_lead_v1')) localStorage.setItem('poler_lead_v1', 'alert_' + alertToken);
                localStorage.setItem('poler_alert_token', alertToken);
            } catch (e) { /* in-memory flag suffices */ }
            leadCaptured = true;
            rememberLead({ token: alertToken });
        } else if (!isTeamDevice && cookies.poler_lt && cookies.poler_lt.length >= 10) {
            try {
                if (!localStorage.getItem('poler_lead_v1')) localStorage.setItem('poler_lead_v1', 'alert_' + cookies.poler_lt);
                if (!localStorage.getItem('poler_alert_token')) localStorage.setItem('poler_alert_token', cookies.poler_lt);
            } catch (e) { /* ignore */ }
            leadCaptured = true;
        } else if (leadCaptured && !isTeamDevice && !cookies.poler_lt) {
            var id = leadIdentity();
            if (id) rememberLead(id);
        }

        var wantsSignup = false;
        try { wantsSignup = !!new URLSearchParams(window.location.search).get('signup'); } catch (e) {}
        if (leadCaptured && !wantsSignup) return; // recognized → nothing to inject

        // ── Inject CSS + overlay ──
        var style = document.createElement('style');
        style.id = 'lead-gate-css';
        style.appendChild(document.createTextNode(CSS));
        document.head.appendChild(style);

        var overlay = document.createElement('div');
        overlay.id = 'lead-overlay';
        overlay.className = 'lead-overlay';
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-labelledby', 'lead-title');
        overlay.setAttribute('aria-hidden', 'true');
        overlay.innerHTML = gateMarkup();
        document.body.appendChild(overlay);
        applyGateTranslations(overlay);

        var bar = document.getElementById('lead-timer-bar');
        var timerInterval = null;
        var utmData = getUtmParams();

        function showLeadModal() {
            if (overlay.classList.contains('active')) return;
            trackEvent('gate_shown', { page: location.pathname });
            lockPage();
            overlay.classList.add('active');
            overlay.setAttribute('aria-hidden', 'false');
            var nameEl = document.getElementById('lead-name');
            if (nameEl) nameEl.focus();
        }
        function unlockPage() {
            overlay.classList.remove('active');
            overlay.setAttribute('aria-hidden', 'true');
            unlockPageDom();
        }

        // ── 10-second timer (shared across pages via sessionStorage) ──
        if (!leadCaptured) {
            var storedStart = null;
            try { storedStart = sessionStorage.getItem(TIMER_KEY); } catch (e) {}
            if (!storedStart) {
                storedStart = Date.now();
                try { sessionStorage.setItem(TIMER_KEY, storedStart); } catch (e) {}
            }
            var START = Number(storedStart);
            if (Date.now() - START >= DURATION) {
                bar.style.transform = 'scaleX(0)';
                showLeadModal();
            } else {
                timerInterval = setInterval(function () {
                    if (leadCaptured) { clearInterval(timerInterval); return; }
                    var elapsed = Date.now() - START;
                    var pct = Math.max(0, 1 - elapsed / DURATION);
                    bar.style.transform = 'scaleX(' + pct + ')';
                    if (elapsed >= DURATION) {
                        clearInterval(timerInterval);
                        showLeadModal();
                    }
                }, 80);
            }

            // Scroll trigger — listing.js fires once the 3rd property card is in
            // view; here the "cards" are whatever the page lists (towers, STR
            // buildings, neighborhoods). Pages with no card grid fire after 1.5
            // viewports of scrolling.
            var CARD_SEL = '.listing-card:not(.is-skeleton), .pc-card, .str-building-card, .neighborhood-card';
            var checkScrollTrigger = function () {
                if (leadCaptured) { window.removeEventListener('scroll', checkScrollTrigger); return; }
                var hit = false;
                var cards = document.querySelectorAll(CARD_SEL);
                if (cards.length >= 3) {
                    hit = cards[2].getBoundingClientRect().top < window.innerHeight;
                } else {
                    hit = (window.scrollY || window.pageYOffset || 0) > window.innerHeight * 1.5;
                }
                if (hit) {
                    window.removeEventListener('scroll', checkScrollTrigger);
                    clearInterval(timerInterval);
                    showLeadModal();
                }
            };
            window.addEventListener('scroll', checkScrollTrigger, { passive: true });
        }

        // Deep link: ?signup=1 opens the form now (Call Us / Contact links)
        if (wantsSignup) showLeadModal();

        // ── Timeline pills (single-select) ──
        // ── Default phone country code: browser locale, then /api/geo (2026-09-12) ──
        (function initCountryCodeDefault() {
            var sel = document.getElementById('country-code');
            if (!sel) return;
            var touched = false;
            sel.addEventListener('change', function () { touched = true; });
            function pick(iso) {
                if (!iso || touched) return false;
                var tag = '(' + String(iso).toUpperCase() + ')';
                for (var i = 0; i < sel.options.length; i++) {
                    if (sel.options[i].text.indexOf(tag) !== -1) { sel.value = sel.options[i].value; return true; }
                }
                return false;
            }
            var langs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || ''];
            var region = null;
            for (var k = 0; k < langs.length; k++) {
                var r = (String(langs[k]).split('-')[1] || '').toUpperCase();
                if (/^[A-Z]{2}$/.test(r)) { region = r; break; }
            }
            pick(region);
            fetch('/api/geo', { cache: 'no-store' })
                .then(function (r) { return r.json(); })
                .then(function (j) { pick(j && j.country); })
                .catch(function () { /* keep the locale/default pick */ });
        })();

        overlay.querySelectorAll('#timeline-pills .timeline-pill').forEach(function (pill) {
            pill.addEventListener('click', function () {
                overlay.querySelectorAll('#timeline-pills .timeline-pill').forEach(function (p) { p.classList.remove('selected'); });
                pill.classList.add('selected');
                document.getElementById('lead-timeline').value = pill.dataset.value;
            });
        });

        function showLeadError(elId, msg) {
            var el = document.getElementById(elId);
            if (!el) return;
            el.textContent = msg;
            el.style.display = 'block';
        }

        // ── 2-step form: name + email → phone + timeline → save ──
        var form      = document.getElementById('lead-form');
        var submitBtn = document.getElementById('lead-submit-btn');
        var submitTxt = document.getElementById('lead-submit-text');
        var leadStep  = 1;
        var leadFormData = null;

        function goToContactStep() {
            var f1 = document.getElementById('lead-fields-1');
            var f2 = document.getElementById('lead-fields-2');
            if (f1) f1.style.display = 'none';
            if (f2) f2.style.display = 'block';
            var consent = document.getElementById('lead-consent');
            if (consent) consent.style.display = 'block';
            var titleEl = document.getElementById('lead-title');
            var subEl   = document.getElementById('lead-subtitle');
            var indEl   = document.getElementById('lead-step-indicator');
            if (titleEl) { titleEl.setAttribute('data-i18n', 'contactTitle');   titleEl.textContent = t('contactTitle'); }
            if (subEl)   { subEl.setAttribute('data-i18n', 'contactSubtitle');  subEl.textContent   = t('contactSubtitle'); }
            if (indEl)   { indEl.setAttribute('data-i18n', 'step2of2');         indEl.textContent   = t('step2of2'); }
            submitTxt.setAttribute('data-i18n', 'submitAndContinue');
            submitTxt.textContent = t('submitAndContinue');
            leadStep = 2;
            setTimeout(function () { try { document.getElementById('lead-phone').focus(); } catch (e) {} }, 60);
        }

        // What Rosa sees as the "property" in the CRM for a non-listing page:
        // the page's H1 (tower name, "Preconstruction", …) or the path.
        function pageLabel() {
            var h1 = document.querySelector('h1');
            var txt = h1 ? (h1.textContent || '').replace(/\s+/g, ' ').trim() : '';
            if (!txt) txt = (document.title || '').split('|')[0].split(' — ')[0].trim();
            if (!txt) txt = window.location.pathname;
            return txt.slice(0, 120);
        }

        function completeLead() {
            var first = leadFormData.first, last = leadFormData.last, email = leadFormData.email;
            var metaEventId = (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID())
                || (String(Date.now()) + Math.random().toString(16).slice(2));

            if (typeof fbq === 'function') {
                try {
                    fbq('track', 'Lead', {
                        content_name: pageLabel(),
                        content_category: 'Real Estate',
                        value: 0,
                        currency: 'USD',
                    }, { eventID: metaEventId });
                } catch (e) {}
            }
            if (typeof gtag === 'function') {
                try {
                    gtag('event', 'conversion', {
                        'send_to': 'AW-17910762846/E5E_CMfftJEcEN6awtxC',
                        'value': 0,
                        'currency': 'USD',
                    });
                } catch (e) {}
            }

            var timeline = (document.getElementById('lead-timeline') || {}).value || '';
            var capiFbp = getCookieValue('_fbp');
            var capiFbc = getCookieValue('_fbc');
            if (!capiFbc && utmData.fbclid) capiFbc = 'fb.1.' + Date.now() + '.' + utmData.fbclid;

            var payload = {
                first: first,
                last: last,
                email: email,
                phone:          leadFormData.normalizedPhone,
                countryIso:     leadFormData.countryIso || '',
                listingAddress: pageLabel(),
                listingPrice:   0,
                sourceUrl:      window.location.href,
                language:       getLang(),
                timeline:       timeline,
                metaEventId:    metaEventId,
                fbp:            capiFbp,
                fbc:            capiFbc,
                pageUrl:        window.location.href,
                listPrice:      0,
            };
            Object.keys(utmData).forEach(function (k) { payload[k] = utmData[k]; });

            return fetch(OTP_BASE + '/api/save-lead', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }).then(function (r) { return r.json(); }).then(function (saveData) {
                if (saveData && saveData.token) {
                    try { localStorage.setItem('poler_alert_token', saveData.token); } catch (e) {}
                    rememberLead({ token: saveData.token }); // 1-year cookie so the gate never re-asks
                } else {
                    rememberLead({ email: email });
                }
            }).catch(function (err) {
                console.warn('Save lead error:', err);
            }).then(function () {
                try { localStorage.setItem('poler_lead_v1', email); } catch (e) { /* in-memory flag suffices */ }
                leadCaptured = true;
                try { if (typeof gtag_report_conversion === 'function') gtag_report_conversion(); } catch (e) {}
                unlockPage();
            });
        }

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var errBox = document.getElementById('lead-error');

            if (leadStep === 1) {
                var n1 = document.getElementById('lead-name').value.trim();
                var e1 = document.getElementById('lead-email').value.trim();
                if (!n1 || !e1) { showLeadError('lead-error', t('errFillAll')); return; }
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e1)) { showLeadError('lead-error', t('errInvalidEmail')); return; }
                if (errBox) errBox.style.display = 'none';
                goToContactStep();
                return;
            }

            var name  = document.getElementById('lead-name').value.trim();
            var email = document.getElementById('lead-email').value.trim();
            if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                submitBtn.disabled = false;
                showLeadError('lead-error', t('errFillAll'));
                return;
            }
            var nameParts = name.split(/\s+/).filter(Boolean);
            var first = nameParts.shift() || name;
            var last  = nameParts.join(' ');

            var localPhone = document.getElementById('lead-phone').value.trim();
            var ccSelect = document.getElementById('country-code');
            var countryCode = ccSelect.value.replace(/[^+\d]/g, '');
            var ccDigits = countryCode.replace(/\D/g, '');
            var localDigits = localPhone.replace(/\D/g, '');
            localDigits = localDigits.replace(/^00/, '');
            if (ccDigits && localDigits.indexOf(ccDigits) === 0) localDigits = localDigits.slice(ccDigits.length);
            localDigits = localDigits.replace(/^0+/, '');
            var phone = countryCode + localDigits;
            var opt = ccSelect.options[ccSelect.selectedIndex];
            var ccText = opt ? opt.text : '';
            var isoMatch = ccText.match(/\(([A-Z]{2})\)/);
            var countryIso = isoMatch ? isoMatch[1] : '';

            if (!localPhone) { showLeadError('lead-error', t('errFillAll')); return; }
            var timeline = (document.getElementById('lead-timeline') || {}).value || '';
            if (!timeline) { showLeadError('lead-error', t('errSelectTimeline') || 'Please select when you plan to buy'); return; }
            if (localPhone.replace(/\D/g, '').length < 7) { showLeadError('lead-error', t('errInvalidPhone')); return; }

            submitBtn.disabled = true;
            if (errBox) errBox.style.display = 'none';
            submitTxt.textContent = t('submitting');
            leadFormData = { first: first, last: last, email: email, phone: phone, normalizedPhone: phone, countryIso: countryIso };
            completeLead().catch(function () {
                submitBtn.disabled = false;
                submitTxt.textContent = t('submitAndContinue');
                showLeadError('lead-error', t('errNetwork'));
            });
        });

        // Expose for Call Us / Contact links that expect the listing helper.
        window.openLeadGate = function () { showLeadModal(); };
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
