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
// Bridge MLS calls go through our server-side proxy (api/bridge/listings.js)
// — the access token lives in the Vercel env, never in this public file.
// (Security audit 2026-07-17; the token was hardcoded here before.)
const API_BASE   = '/api/bridge';
const OTP_BASE   = 'https://poler-team-website-two.vercel.app'; // Vercel project with Twilio env vars
const PAGE_SIZE  = 50;
const MAX_OFFSET = 10000; // Bridge rejects offsets past ~10k — clamp reachable pages

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
let currentPage    = 0;      // 0-based page for the paginated grid
let sortMode       = 'newest'; // 'newest' | 'price-desc' | 'price-asc'

function sortParams() {
    if (sortMode === 'price-desc') return { sortBy: 'ListPrice', order: 'desc' };
    if (sortMode === 'price-asc')  return { sortBy: 'ListPrice', order: 'asc' };
    // Newest = the date shown on the card (ListingContractDate), NOT the feed entry
    // timestamp — they differ when a listing is entered late with a backdated
    // contract date. The .gte guard drops the ~7 rows with NO date (Bridge sorts
    // nulls first on desc, which would pin dateless listings to the top).
    return { sortBy: 'ListingContractDate', order: 'desc', 'ListingContractDate.gte': '1900-01-01' };
}
function clientSort(listings) {
    if (sortMode === 'price-desc') listings.sort((a, b) => (b.ListPrice || 0) - (a.ListPrice || 0));
    else if (sortMode === 'price-asc') listings.sort((a, b) => (a.ListPrice || 0) - (b.ListPrice || 0));
    else listings.sort(byNewestListed);
}
let lastQuery      = {};     // Last search params
let totalResults   = 0;      // Total from API
let leadCaptured   = false;  // Has user already registered?
let isTeamDevice   = false;
let searchesThisLoad = 0;    // runSearch first-page calls this load (1 = initial, >1 = filter changes)  // Kevin/Rosa/Dylan device (CRM login cookie/flag) — never gate, never recalibrate
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

// Per-listing hero override: MLS ListingId -> 0-based index (into the
// Order-sorted photo list) to promote to the FIRST/hero slot + open the gallery
// on. Some MLS feeds lead with an unappealing aerial, and MediaCategory is
// uniformly "Photo" in this feed so the front elevation can't be auto-detected.
// 2026-06-24: A11917133 (2839 NE 35th St, $3.349M) led with a canal aerial —
// Kevin wants the front-elevation shot (gallery photo #5 = index 4). Add a row
// here for any future ad-destination listing whose first MLS photo is weak.
const HERO_PHOTO_OVERRIDE = { 'A11917133': 4 };

function getAllPhotos(listing) {
    const m = listing && listing.Media;
    if (!m || !m.length) return [];
    const urls = m.slice()
        .sort((a, b) => (a.Order || 0) - (b.Order || 0))
        .map(x => x.MediaURL);
    const ov = HERO_PHOTO_OVERRIDE[listing && listing.ListingId];
    if (Number.isInteger(ov) && ov > 0 && ov < urls.length) {
        urls.unshift(urls.splice(ov, 1)[0]);  // promote the chosen photo to hero
    }
    return urls;
}

function statsStr(listing) {
    const parts = [];
    if (listing.BedroomsTotal)         parts.push(`${listing.BedroomsTotal} ${t('bd')}`);
    if (listing.BathroomsTotalInteger) parts.push(`${listing.BathroomsTotalInteger} ${t('ba')}`);
    if (listing.LivingArea)            parts.push(`${Number(listing.LivingArea).toLocaleString()} ${t('sf')}`);
    return parts.join(' · ');
}

async function apiFetch(params) {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${API_BASE}/listings?${qs}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

// ============================================================
// LANDING-PAGE A/B (lp-ab) — conversion test on the gate-popup copy.
// Sticky 50/50 server-config-driven variant; tracks view/lead/leave to
// /api/lp-ab/track; auto-promotes the higher-converting copy. FULLY fail-safe:
// any error → champion 'a' (the original copy) with no behavior change. The
// only DOM effect is swapping the popup's title/subtitle for challenger letters.
// Round 1 (2026-06-22): A = current copy, B = concrete value-prop copy below.
// ============================================================
const LP_AB = { vid: null, variant: 'a', round: 1, champion: 'a', challenger: '', loadAt: Date.now(), maxScroll: 0, sent: {}, applied: null, preview: false };
const LP_ORIG = {}; // snapshot of original I18N entries we override, so a cross-round stale cookie can be cleanly restored to the champion baseline

// Per-challenger-letter copy overrides for the gate popup. 'a' = original I18N
// (no entry). When a letter wins, config makes it champion and everyone gets its
// treatment — so the winning copy ships with zero code change. Add 'c', 'd'… for
// later rounds. Each key mirrors the I18N {en,es,pt} shape so it stays trilingual.
const LP_VARIANTS = {
  b: {
    leadTitle: {
      en: 'See the full price, photos & similar homes',
      es: 'Ve el precio, las fotos y propiedades similares',
      pt: 'Veja o preço, as fotos e imóveis semelhantes',
    },
    leadSubtitle: {
      en: "Tell us where to send it and we'll instantly unlock this property's full details — plus hand-picked Miami listings like it. Free, no obligation.",
      es: 'Dinos a dónde enviártelo y desbloqueas al instante los detalles completos de esta propiedad — más propiedades en Miami seleccionadas para ti. Gratis y sin compromiso.',
      pt: 'Diga para onde enviar e desbloqueie na hora os detalhes completos deste imóvel — além de imóveis em Miami selecionados para você. Grátis e sem compromisso.',
    },
  },
};

function lpCookie(name) {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}
function lpSetCookie(name, val, days) {
  document.cookie = `${name}=${encodeURIComponent(val)}; Max-Age=${days * 86400}; Path=/; SameSite=Lax`;
}
function lpUuid() {
  try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
  return 'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
function lpTrack(type, extra) {
  try {
    if (LP_AB.preview) return;       // QA preview (?lpv=) never records events
    if (!LP_AB.vid) return;
    if (LP_AB.sent[type]) return;    // idempotent per page load — view/lead/leave each fire once
    LP_AB.sent[type] = true;
    const body = JSON.stringify(Object.assign(
      { visitorId: LP_AB.vid, variant: LP_AB.variant, type, round: LP_AB.round }, extra || {}));
    const url = `${OTP_BASE}/api/lp-ab/track`;
    let beaconed = false;
    if (type === 'leave' && navigator.sendBeacon) {
      // text/plain is CORS-safelisted, so mobile browsers actually DELIVER it on
      // page-exit — an application/json beacon was being silently dropped (0 leaves).
      // The server JSON.parses string bodies. Fall back to keepalive fetch if refused.
      try { beaconed = navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' })); } catch (e) { beaconed = false; }
    }
    if (!beaconed) {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  } catch (e) { /* tracking never breaks the page */ }
}
// Apply a challenger letter's copy by overriding the I18N entries (snapshotting the
// originals the first time so we can restore). Re-render after.
function lpSnapshotAndApply(letter) {
  const v = LP_VARIANTS[letter];
  if (!v) return;
  try {
    Object.keys(v).forEach((key) => {
      if (!(key in LP_ORIG)) LP_ORIG[key] = I18N[key]; // capture true original once
      I18N[key] = v[key];
    });
    LP_AB.applied = letter;
    if (typeof applyTranslations === 'function') applyTranslations();
  } catch (e) { /* leave champion copy on any failure */ }
}
function lpRestoreOriginal() {
  try {
    Object.keys(LP_ORIG).forEach((key) => { I18N[key] = LP_ORIG[key]; });
    LP_AB.applied = null;
  } catch (e) {}
}
// Reconcile the displayed gate copy with `letter` (idempotent). 'a' = original copy.
function lpSetVariantCopy(letter) {
  if (LP_AB.applied === letter) return;            // already showing the right copy
  if (letter && letter !== 'a' && LP_VARIANTS[letter]) {
    if (LP_AB.applied) lpRestoreOriginal();
    lpSnapshotAndApply(letter);
  } else if (LP_AB.applied) {                        // back to champion baseline
    lpRestoreOriginal();
    try { if (typeof applyTranslations === 'function') applyTranslations(); } catch (e) {}
  }
}
// Synchronous, runs before first render: a returning visitor (sticky cookie) sees
// THEIR variant copy immediately — no flicker even if the 10s gate already elapsed.
function lpEarlyTreatment() {
  try {
    // QA preview override: ?lpv=a|b forces that variant's popup copy for a visual
    // check, WITHOUT a cookie or any tracking — so it never skews the live data.
    const pv = (new URLSearchParams(window.location.search).get('lpv') || '').toLowerCase();
    if (pv === 'a' || pv === 'b') { LP_AB.preview = true; LP_AB.variant = pv; lpSetVariantCopy(pv); return; }
    const v = (lpCookie('lp_ab') || '').toLowerCase();
    if (v && v !== 'a' && LP_VARIANTS[v]) { LP_AB.variant = v; lpSnapshotAndApply(v); }
  } catch (e) {}
}
function lpSendLeave() {
  lpTrack('leave', { dwellMs: Date.now() - LP_AB.loadAt, maxScroll: LP_AB.maxScroll }); // lpTrack dedups
}
async function initLpAb() {
  try {
    if (LP_AB.preview) return;   // QA preview: copy already applied; no assignment, no tracking
    LP_AB.vid = localStorage.getItem('poler_lp_vid') || lpUuid();
    try { localStorage.setItem('poler_lp_vid', LP_AB.vid); } catch (e) {}

    // max-scroll diagnostic + leave beacon (secondary metrics; primary is conversion)
    window.addEventListener('scroll', () => {
      const el = document.documentElement;
      const denom = (el.scrollHeight - el.clientHeight) || 1;
      const pct = Math.round((el.scrollTop || window.pageYOffset || 0) / denom * 100);
      if (pct > LP_AB.maxScroll) LP_AB.maxScroll = Math.max(0, Math.min(100, pct));
    }, { passive: true });
    window.addEventListener('pagehide', lpSendLeave);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') lpSendLeave(); });

    const r = await fetch(`${OTP_BASE}/api/lp-ab/config`, { cache: 'no-store' });
    const cfg = await r.json();
    LP_AB.round = Number(cfg.round) || 1;
    LP_AB.champion = (cfg.champion || 'a').toLowerCase();
    LP_AB.challenger = (cfg.challenger || '').toLowerCase();

    let v = (lpCookie('lp_ab') || '').toLowerCase();
    const valid = v && (v === LP_AB.champion || v === LP_AB.challenger);
    if (!valid) {
      if (LP_AB.challenger && cfg.status === 'running' && (Math.random() * 100) < (Number(cfg.split) || 0)) {
        v = LP_AB.challenger;
      } else {
        v = LP_AB.champion;
      }
      lpSetCookie('lp_ab', v, 30);
    }
    LP_AB.variant = v;
    lpSetVariantCopy(v); // reconcile displayed copy with the final variant (handles a stale cross-round cookie)
    lpTrack('view');
  } catch (e) {
    // fail-safe: keep whatever the early sync treatment chose; record the visit best-effort
    try { lpTrack('view'); } catch (_) {}
  }
}

// ============================================================
// RECOGNITION + EVENT TRACKING + RECALIBRATION POPUP (2026-09-10)
// Design: ~/business/real-estate/active/research/listing-ux-consensus/
// ============================================================

// Parse document.cookie into a plain object (never throws).
function readCookies() {
    const out = {};
    try {
        document.cookie.split(';').forEach(part => {
            const i = part.indexOf('=');
            if (i < 0) return;
            const k = part.slice(0, i).trim();
            if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
        });
    } catch (e) { /* no cookie access */ }
    return out;
}

// Who is this captured visitor? → { token } | { email } | null.
// Token wins (unique, never changes); email is the pre-token fallback for
// leads captured before Alert Tokens existed.
function leadIdentity() {
    let tok = '', v1 = '';
    try {
        tok = localStorage.getItem('poler_alert_token') || '';
        v1  = localStorage.getItem('poler_lead_v1') || '';
    } catch (e) { /* storage blocked */ }
    if (!tok) {
        const c = readCookies().poler_lt;
        if (c && c.length >= 10) tok = c;
    }
    if (!tok && v1.indexOf('alert_') === 0 && v1.length > 16) tok = v1.slice(6);
    if (tok) return { token: tok };
    if (v1.indexOf('@') > 0) return { email: v1 };
    return null;
}

// Ask the server for the 1-year first-party cookie (same-origin on purpose —
// the cookie must land on www.homesinsoflorida.com, not the vercel.app host).
function rememberLead(id) {
    if (!id || (!id.token && !id.email)) return Promise.resolve(false);
    return fetch('/api/remember', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(id),
    }).then(r => r.ok).catch(() => false);
}

// One helper for every post-gate signal: GA4 always (gtag is on listing.html),
// CRM 'Lead Activity' row only for captured leads and only for the event
// types that mean something to Kevin/Sammy.
const CRM_EVENT_TYPES = {
    listing_view:    'Property View',
    favorite_add:    'Favorite',
    favorite_remove: 'Unfavorite',
    search:          'Search',
    filter_applied:  'Search',
    share_click:     'Share',
    whatsapp_click:  'WhatsApp Click',
    contact_click:   'Contact Click',
    recalib_answered:'Recalibration Answer',
};
function trackEvent(name, params) {
    params = params || {};
    try { if (typeof gtag === 'function') gtag('event', name, params); } catch (e) { /* GA blocked */ }
    const crmType = CRM_EVENT_TYPES[name];
    if (!crmType || isTeamDevice) return;
    const id = leadIdentity();
    if (!id) return;
    try {
        fetch(`${OTP_BASE}/api/log-activity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({}, id, { activityType: crmType, details: params })),
        }).catch(() => {});
    } catch (e) { /* non-critical */ }
}

// ── Recalibration popup ─────────────────────────────────────
// Fires ONCE per lead, only after capture, on the first intent signal:
// 2nd listing view (across page loads, per session), 1 favorite, 3 filter
// changes, or 5 min of ACTIVE time as the fallback for scroll-only visitors.
// Answered → never again. Dismissed → quiet for 14 days.
const RECALIB_KEY       = 'poler_recalib_v1';
const RECALIB_DISMISS_MS = 14 * 24 * 60 * 60 * 1000;
const RECALIB_ACTIVE_MS  = 5 * 60 * 1000;
let recalibOpen = false;

function recalibSessionCount(key, inc) {
    try {
        const n = (Number(sessionStorage.getItem(key)) || 0) + (inc || 0);
        if (inc) sessionStorage.setItem(key, String(n));
        return n;
    } catch (e) { return 0; }
}

function recalibEligible() {
    if (!leadCaptured || isTeamDevice || recalibOpen) return false;
    if (!leadIdentity()) return false;
    try {
        const v = localStorage.getItem(RECALIB_KEY) || '';
        if (v.indexOf('answered') === 0) return false;
        if (v.indexOf('dismissed:') === 0 && Date.now() - Number(v.slice(10)) < RECALIB_DISMISS_MS) return false;
    } catch (e) { /* no storage → allow once this page */ }
    const gate = document.getElementById('lead-overlay');
    if (gate && gate.classList.contains('active')) return false;
    return true;
}

function recalibSignal(kind) {
    let fire = false;
    if (kind === 'listing_view') fire = recalibSessionCount('poler_recalib_views', 1) >= 2;
    else if (kind === 'favorite') fire = true;
    else if (kind === 'filter')   fire = recalibSessionCount('poler_recalib_filters', 1) >= 3;
    else if (kind === 'active')   fire = true;
    if (fire && recalibEligible()) showRecalibPopup(kind);
}

// 5-minute ACTIVE fallback: count only while the tab is visible and the
// visitor has scrolled/clicked/typed in the last 30s. Persists across page
// loads within the session.
function initRecalibActiveTimer() {
    let lastInput = Date.now();
    const bump = () => { lastInput = Date.now(); };
    ['scroll', 'click', 'keydown', 'touchstart', 'mousemove'].forEach(ev =>
        window.addEventListener(ev, bump, { passive: true }));
    const iv = setInterval(() => {
        if (document.hidden || Date.now() - lastInput > 30000) return;
        const ms = recalibSessionCount('poler_recalib_active_ms', 5000);
        if (ms >= RECALIB_ACTIVE_MS) {
            clearInterval(iv);
            recalibSignal('active');
        }
    }, 5000);
}

function showRecalibPopup(reason) {
    if (document.getElementById('recalib-popup')) return;
    recalibOpen = true;
    const lang = (typeof getLang === 'function') ? getLang() : 'en';
    const mls = new URLSearchParams(window.location.search).get('mls') || new URLSearchParams(window.location.search).get('id') || '';
    const options = [
        ['price',     'recalibPrice'],
        ['area',      'recalibArea'],
        ['financing', 'recalibFinancing'],
        ['browsing',  'recalibBrowsing'],
        ['talk',      'recalibTalk'],
    ];
    const el = document.createElement('div');
    el.id = 'recalib-popup';
    el.className = 'recalib-popup';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-labelledby', 'recalib-title');
    el.innerHTML =
        `<button type="button" class="recalib-close" aria-label="${t('recalibClose')}">&times;</button>` +
        `<p class="recalib-title" id="recalib-title">${t('recalibTitle')}</p>` +
        `<div class="recalib-options">` +
        options.map(([k, key]) => `<button type="button" class="recalib-opt" data-answer="${k}">${t(key)}</button>`).join('') +
        `</div>`;
    document.body.appendChild(el);
    // setTimeout, not rAF: rAF never fires in a background tab, leaving the card at opacity 0
    setTimeout(() => el.classList.add('is-open'), 30);
    trackEvent('recalib_shown', { reason: reason, mls: mls });

    const finish = (answered) => {
        try {
            localStorage.setItem(RECALIB_KEY, answered ? 'answered:' + answered : 'dismissed:' + Date.now());
        } catch (e) { /* ignore */ }
    };
    el.querySelector('.recalib-close').addEventListener('click', () => {
        finish(null);
        trackEvent('recalib_dismissed', { reason: reason, mls: mls });
        closeRecalibPopup(el);
    });
    el.querySelectorAll('.recalib-opt').forEach(btn => {
        btn.addEventListener('click', () => {
            const answer = btn.dataset.answer;
            finish(answer);
            trackEvent('recalib_answered', { answer: answer, reason: reason, mls: mls });
            const id = leadIdentity() || {};
            fetch('/api/recalibrate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.assign({}, id, { answer: answer, mls: mls, page: location.pathname + location.search, lang: lang })),
            }).catch(() => {});
            const thanksKey = { price: 'recalibThanksPrice', area: 'recalibThanksArea', financing: 'recalibThanksFinancing', browsing: 'recalibThanksBrowsing', talk: 'recalibThanksTalk' }[answer];
            let html = `<p class="recalib-title">${t(thanksKey)}</p>`;
            if (answer === 'talk' || answer === 'area') {
                const wa = `https://wa.me/19542354046?text=${encodeURIComponent(t('recalibWaMsg'))}`;
                html += `<a class="recalib-wa" href="${wa}" target="_blank" rel="noopener">${t('recalibWhatsApp')}</a>`;
            }
            el.innerHTML = `<button type="button" class="recalib-close" aria-label="${t('recalibClose')}">&times;</button>` + html;
            el.querySelector('.recalib-close').addEventListener('click', () => closeRecalibPopup(el));
            el.querySelector('.recalib-wa')?.addEventListener('click', () => trackEvent('whatsapp_click', { source: 'recalib', answer: answer }));
            if (answer !== 'talk' && answer !== 'area') setTimeout(() => closeRecalibPopup(el), 6000);
        });
    });
}

function closeRecalibPopup(el) {
    el = el || document.getElementById('recalib-popup');
    if (!el) return;
    el.classList.remove('is-open');
    setTimeout(() => el.remove(), 350);
}

// ============================================================
// LEAD CAPTURE — 10-second timer then forced modal, with OTP phone verification
// ============================================================
function initLeadCapture() {
    // Guarded (2026-07-17): an unguarded localStorage throw here aborted the
    // entire boot chain incl. the popup wiring (see i18n.js getLang note).
    try { leadCaptured = !!localStorage.getItem('poler_lead_v1'); } catch (e) { leadCaptured = false; }

    // RECOGNITION (2026-09-10): localStorage alone kept re-gating registered
    // people — Safari ITP wipes script storage after 7 days, in-app webviews
    // (IG/FB/WhatsApp) have their own storage, and the welcome email linked to a
    // bare /listing. Order of trust: team cookie/flag → ?t= link → poler_lt
    // cookie (server-set, 1 year, survives ITP) → localStorage. Whichever one
    // recognizes the visitor re-seeds the others so the next visit is covered.
    const cookies = readCookies();
    try {
        if (cookies.poler_team === '1' || localStorage.getItem('poler_team_member')) isTeamDevice = true;
    } catch (e) { if (cookies.poler_team === '1') isTeamDevice = true; }
    if (isTeamDevice) leadCaptured = true;

    // Recognize returning leads from alert / share emails (URL has ?t=TOKEN)
    const alertToken = new URLSearchParams(window.location.search).get('t');
    if (alertToken && alertToken.length >= 10) {
        try {
            if (!localStorage.getItem('poler_lead_v1')) localStorage.setItem('poler_lead_v1', 'alert_' + alertToken);
            localStorage.setItem('poler_alert_token', alertToken);
        } catch (e) { /* in-memory flag suffices */ }
        leadCaptured = true;
        rememberLead({ token: alertToken });
    } else if (!isTeamDevice && cookies.poler_lt && cookies.poler_lt.length >= 10) {
        // Cookie survived a storage wipe → restore localStorage from it
        try {
            if (!localStorage.getItem('poler_lead_v1')) localStorage.setItem('poler_lead_v1', 'alert_' + cookies.poler_lt);
            if (!localStorage.getItem('poler_alert_token')) localStorage.setItem('poler_alert_token', cookies.poler_lt);
        } catch (e) { /* ignore */ }
        leadCaptured = true;
    } else if (leadCaptured && !isTeamDevice && !cookies.poler_lt) {
        // Captured before the cookie existed → set it now (self-heals old leads)
        const id = leadIdentity();
        if (id) rememberLead(id);
    }
    // NOTE (2026-08-19): captured visitors no longer bail out here — the form must
    // stay functional because Call Us / Contact open this popup on demand for everyone.

    const overlay  = document.getElementById('lead-overlay');
    const bar      = document.getElementById('lead-timer-bar');
    const pageWrap = document.getElementById('page-wrap');

    // OTP disabled — all leads go straight through after filling form
    const skipOtp = true;

    // Init EmailJS
    if (typeof emailjs !== 'undefined' && EMAILJS_PUBLIC_KEY !== 'YOUR_PUBLIC_KEY') {
        emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
    }

    // AUTO-POPUP POLICY (Kevin 2026-08-19, Google Ads re-added 2026-08-23): the
    // 10s gate fires for PAID traffic only — Facebook/Instagram (fbclid param,
    // meta utm_source, or FB/IG referrer) and Google Ads (gclid param or
    // utm_source=googlead, the tag on every campaign final URL). Organic search
    // and direct visitors browse with NO auto-popup — a bare google.com referrer
    // without gclid/utm stays popup-free. Paid status is remembered for the whole
    // visit (sessionStorage) so the gate still works when the visitor clicks into
    // a property and URL params drop off.
    const META_KEY = 'poler_meta_visitor';
    const GADS_KEY = 'poler_gads_visitor';
    let isMetaTraffic = false;
    let isGoogleAdsTraffic = false;
    try {
        const gp = new URLSearchParams(window.location.search);
        const gsrc = (gp.get('utm_source') || '').toLowerCase();
        const ref  = (document.referrer || '').toLowerCase();
        if (gp.get('fbclid') ||
            ['facebook', 'fb', 'ig', 'instagram', 'meta'].includes(gsrc) ||
            ref.includes('facebook.com') || ref.includes('instagram.com')) {
            isMetaTraffic = true;
            sessionStorage.setItem(META_KEY, '1');
        } else if (sessionStorage.getItem(META_KEY) === '1') {
            isMetaTraffic = true;
        }
        if (gp.get('gclid') ||
            ['googlead', 'googleads', 'google-ads', 'adwords'].includes(gsrc)) {
            isGoogleAdsTraffic = true;
            sessionStorage.setItem(GADS_KEY, '1');
        } else if (sessionStorage.getItem(GADS_KEY) === '1') {
            isGoogleAdsTraffic = true;
        }
    } catch (e) { /* privacy-hardened browsers: no auto-popup */ }
    const AUTO_POPUP = isMetaTraffic || isGoogleAdsTraffic;
    if (AUTO_POPUP && !leadCaptured) {
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
                if (leadCaptured) { clearInterval(timerInterval); return; }
                const elapsed = Date.now() - START;
                const pct = Math.max(0, 1 - elapsed / DURATION);
                bar.style.transform = `scaleX(${pct})`;
                if (elapsed >= DURATION) {
                    clearInterval(timerInterval);
                    showLeadModal(overlay, pageWrap);
                }
            }, 80);
        }
    }

    // Deep link: ?signup=1 (Call Us / Contact from other pages) opens the form now
    try {
        if (new URLSearchParams(window.location.search).get('signup')) {
            showLeadModal(overlay, pageWrap);
        }
    } catch (e) { /* non-critical */ }

    // Scroll trigger: show modal if user scrolls past 3rd property card
    function checkScrollTrigger() {
        if (leadCaptured) { window.removeEventListener('scroll', checkScrollTrigger); return; }
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
    // Scroll trigger rides the same paid-traffic gate (Meta + Google Ads since
    // 2026-08-23): organic and direct visitors never get a forced popup.
    if (AUTO_POPUP && !leadCaptured) {
        window.addEventListener('scroll', checkScrollTrigger, { passive: true });
    }

    // ── Timeline pills (single-select) ────────────────────────
    document.querySelectorAll('#timeline-pills .timeline-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            document.querySelectorAll('#timeline-pills .timeline-pill').forEach(p => p.classList.remove('selected'));
            pill.classList.add('selected');
            document.getElementById('lead-timeline').value = pill.dataset.value;
        });
    });

    initAlreadyRegistered(overlay, pageWrap);

    // ── STEP 1: Info form → send OTP (or skip for Brazil) ────
    const form      = document.getElementById('lead-form');
    const submitBtn = document.getElementById('lead-submit-btn');
    const submitTxt = document.getElementById('lead-submit-text');

    // 2-step form: Step 1 = name + email, Step 2 = phone + timeline.
    // The Meta/Google conversion pixel + Airtable save fire ONCE, on Step 2 completion
    // (completeLead). OTP is disabled, so the old OTP "step 2" markup stays unused.
    let leadStep = 1;

    // Reveal the contact step (phone + timeline) and swap the copy/button for Step 2.
    function goToContactStep() {
        const f1 = document.getElementById('lead-fields-1');
        const f2 = document.getElementById('lead-fields-2');
        if (f1) f1.style.display = 'none';
        if (f2) f2.style.display = 'block';
        const consent = document.getElementById('lead-consent');
        if (consent) consent.style.display = 'block';
        const titleEl = document.getElementById('lead-title');
        const subEl   = document.getElementById('lead-subtitle');
        const indEl   = document.getElementById('lead-step-indicator');
        // Keep data-i18n in sync so a language switch re-translates correctly.
        if (titleEl) { titleEl.setAttribute('data-i18n', 'contactTitle');   titleEl.textContent = t('contactTitle'); }
        if (subEl)   { subEl.setAttribute('data-i18n', 'contactSubtitle');  subEl.textContent   = t('contactSubtitle'); }
        if (indEl)   { indEl.setAttribute('data-i18n', 'step2of2');         indEl.textContent   = t('step2of2'); }
        submitTxt.setAttribute('data-i18n', 'submitAndContinue');
        submitTxt.textContent = t('submitAndContinue');
        leadStep = 2;
        setTimeout(() => { try { document.getElementById('lead-phone').focus(); } catch (e) {} }, 60);
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errBox = document.getElementById('lead-error');

        // ── STEP 1: name + email → reveal the contact step ──
        if (leadStep === 1) {
            const name  = document.getElementById('lead-name').value.trim();
            const email = document.getElementById('lead-email').value.trim();
            if (!name || !email) {
                showLeadError('lead-error', t('errFillAll'));
                return;
            }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                showLeadError('lead-error', t('errInvalidEmail'));
                return;
            }
            if (errBox) errBox.style.display = 'none';
            goToContactStep();
            return;
        }

        // ── STEP 2: phone + timeline → save the full lead ──
        const name  = document.getElementById('lead-name').value.trim();
        const email = document.getElementById('lead-email').value.trim();
        // Re-validate Step 1 inputs (defense against DOM tampering / a skipped Step 1) —
        // never save a nameless/emailless lead.
        if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            submitBtn.disabled = false;
            showLeadError('lead-error', t('errFillAll'));
            return;
        }
        // Split the single Full Name field into first / last for the CRM.
        const nameParts = name.split(/\s+/).filter(Boolean);
        const first = nameParts.shift() || name;
        const last  = nameParts.join(' ');

        const localPhone = document.getElementById('lead-phone').value.trim();
        const ccSelect = document.getElementById('country-code');
        const countryCode = ccSelect.value.replace(/[^+\d]/g, ''); // "+504"
        const ccDigits = countryCode.replace(/\D/g, '');           // "504"
        // Dedupe: the dropdown already supplies the country code, so strip it (and any
        // intl/trunk prefix) if the lead ALSO typed it — otherwise +504 + "50432540379"
        // stores "+50450432540379" and the dialer/WhatsApp hit a bad number.
        let localDigits = localPhone.replace(/\D/g, '');
        localDigits = localDigits.replace(/^00/, '');              // 00504… intl prefix
        if (ccDigits && localDigits.startsWith(ccDigits)) {
            localDigits = localDigits.slice(ccDigits.length);      // they typed the code too
        }
        localDigits = localDigits.replace(/^0+/, '');              // national trunk 0
        const phone = countryCode + localDigits;                   // e.g. "+50432540379"
        const ccText = ccSelect.options[ccSelect.selectedIndex]?.text || '';
        const isoMatch = ccText.match(/\(([A-Z]{2})\)/);
        const countryIso = isoMatch ? isoMatch[1] : '';

        if (!localPhone) {
            showLeadError('lead-error', t('errFillAll'));
            return;
        }
        const timeline = document.getElementById('lead-timeline')?.value || '';
        if (!timeline) {
            showLeadError('lead-error', t('errSelectTimeline') || 'Please select when you plan to buy');
            return;
        }
        const digitsOnly = localPhone.replace(/\D/g, '');
        if (digitsOnly.length < 7) {
            showLeadError('lead-error', t('errInvalidPhone'));
            return;
        }

        submitBtn.disabled = true;
        if (errBox) errBox.style.display = 'none';
        submitTxt.textContent = t('submitting');
        leadFormData = { first, last, email, phone, normalizedPhone: phone, countryIso };
        try {
            await completeLead(overlay, pageWrap);
        } catch (err) {
            submitBtn.disabled = false;
            submitTxt.textContent = t('submitAndContinue');
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

// Read one cookie's value out of document.cookie (used for Meta's _fbp/_fbc click-id cookies).
function getCookieValue(name) {
    const escaped = name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1');
    const match = document.cookie.match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
}

// ── Shared lead completion — save to CRM, send emails, fire pixel, unlock page
async function completeLead(overlay, pageWrap) {
    const { first, last, email, phone } = leadFormData;

    // Shared dedup id between the browser Meta Pixel event (below) and the server-side
    // Conversions API mirror fired from /api/save-lead (see api/_capi.js) — lets Meta
    // de-duplicate the two into a single event instead of double-counting the lead.
    const metaEventId = (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID())
        || (String(Date.now()) + Math.random().toString(16).slice(2));

    // Fire Meta Pixel Lead event for ad conversion tracking
    if (typeof fbq === 'function') {
        fbq('track', 'Lead', {
            content_name: heroListing ? (heroListing.UnparsedAddress || heroListing.City || '') : 'Browse page',
            content_category: 'Real Estate',
            value: heroListing ? (heroListing.ListPrice || 0) : 0,
            currency: 'USD',
        }, { eventID: metaEventId });
    }

    // Fire Google Ads conversion event
    if (typeof gtag === 'function') {
        gtag('event', 'conversion', {
            'send_to': 'AW-17910762846/E5E_CMfftJEcEN6awtxC',
            'value': heroListing ? (heroListing.ListPrice || 0) : 0,
            'currency': 'USD',
        });
    }

    // Landing-page A/B: record the conversion for the assigned variant.
    try { lpTrack('lead'); } catch (e) {}

    // Save lead to Airtable CRM and capture alert token
    const langParam = new URLSearchParams(window.location.search).get('lang') || 'en';
    try {
        const timeline = document.getElementById('lead-timeline')?.value || '';

        // Meta CAPI (server-side) — pass along the browser's click-id cookies so
        // api/save-lead.js can fire a deduped, attributed server-side 'Lead' event.
        const capiFbp = getCookieValue('_fbp');
        let capiFbc = getCookieValue('_fbc');
        if (!capiFbc && utmData.fbclid) {
            capiFbc = `fb.1.${Date.now()}.${utmData.fbclid}`;
        }

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
                metaEventId,
                fbp:            capiFbp,
                fbc:            capiFbc,
                pageUrl:        window.location.href,
                listPrice:      heroListing ? (heroListing.ListPrice || 0) : 0,
            }),
        });
        const saveData = await saveRes.json();
        if (saveData.token) {
            localStorage.setItem('poler_alert_token', saveData.token);
            rememberLead({ token: saveData.token }); // 1-year cookie so the gate never re-asks
        } else {
            rememberLead({ email });
        }
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

    // Guarded (2026-07-17): this ran AFTER the CRM save but BEFORE unlockPage()
    // — a storage throw left the lead saved server-side yet still locked out.
    try { localStorage.setItem('poler_lead_v1', email); } catch (e) { /* in-memory flag below suffices */ }
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


// Open the lead-capture popup on demand (Call Us / Contact buttons).
// ALWAYS shows the signup form (Kevin 2026-08-19) — args kept for onclick compat.
function openLeadGate(fallbackUrl, newTab) {
    const overlay  = document.getElementById('lead-overlay');
    const pageWrap = document.getElementById('page-wrap');
    if (overlay && pageWrap) showLeadModal(overlay, pageWrap);
    else if (fallbackUrl) { if (newTab) window.open(fallbackUrl, '_blank'); else window.location.href = fallbackUrl; }
}

function showLeadModal(overlay, pageWrap) {
    if (overlay.classList.contains('active')) return;
    trackEvent('gate_shown', { page: location.pathname });
    pageWrap.classList.add('blurred');
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    const nameEl = document.getElementById('lead-name');
    if (nameEl) nameEl.focus();
}

function unlockPage(overlay, pageWrap) {
    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
    pageWrap.classList.remove('blurred');
}

// "Already registered?" on the gate (2026-09-10): a returning lead whose
// storage was wiped types the email they signed up with → /api/remember sets
// the 1-year cookie → unlock. Injected here (not in listing.html) so the gate
// markup stays untouched; all copy via i18n keys.
function initAlreadyRegistered(overlay, pageWrap) {
    const form = document.getElementById('lead-form');
    if (!form || document.getElementById('lead-registered')) return;
    const wrap = document.createElement('div');
    wrap.id = 'lead-registered';
    wrap.className = 'lead-registered';
    wrap.innerHTML =
        `<button type="button" class="lead-registered-toggle" id="lead-registered-toggle" data-i18n="alreadyRegistered">${t('alreadyRegistered')}</button>` +
        `<div class="lead-registered-form" id="lead-registered-form" hidden>` +
            `<p class="lead-registered-hint" data-i18n="alreadyRegisteredHint">${t('alreadyRegisteredHint')}</p>` +
            `<div class="lead-registered-row">` +
                `<input type="email" id="lead-registered-email" autocomplete="email" data-i18n="emailAddress" placeholder="${t('emailAddress')}">` +
                `<button type="button" id="lead-registered-btn" data-i18n="alreadyRegisteredBtn">${t('alreadyRegisteredBtn')}</button>` +
            `</div>` +
            `<p class="lead-error" id="lead-registered-error" style="display:none"></p>` +
        `</div>`;
    form.insertAdjacentElement('afterend', wrap);

    const toggle = wrap.querySelector('#lead-registered-toggle');
    const panel  = wrap.querySelector('#lead-registered-form');
    const input  = wrap.querySelector('#lead-registered-email');
    const btn    = wrap.querySelector('#lead-registered-btn');
    const err    = wrap.querySelector('#lead-registered-error');
    toggle.addEventListener('click', () => {
        panel.hidden = !panel.hidden;
        if (!panel.hidden) input.focus();
    });
    const submit = async () => {
        const email = input.value.trim().toLowerCase();
        err.style.display = 'none';
        if (!email || email.indexOf('@') < 1) { input.focus(); return; }
        btn.disabled = true;
        const ok = await rememberLead({ email });
        btn.disabled = false;
        if (!ok) {
            err.textContent = t('alreadyRegisteredNotFound');
            err.style.display = 'block';
            trackEvent('gate_recognize_fail', {});
            return;
        }
        try { localStorage.setItem('poler_lead_v1', email); } catch (e) { /* cookie carries it */ }
        const c = readCookies().poler_lt;
        if (c) { try { localStorage.setItem('poler_alert_token', c); } catch (e) { /* ignore */ } }
        leadCaptured = true;
        clearInterval(timerInterval);
        trackEvent('gate_recognized', {});
        unlockPage(overlay, pageWrap);
    };
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
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

        // Track the property view: GA4 for everyone, CRM row for any captured
        // lead (was ?t= links only until 2026-09-10). 2nd view in a session is
        // the primary recalibration trigger.
        trackEvent('listing_view', {
            mlsId: listing.ListingId || listingId,
            address: listing.UnparsedAddress || listing.City || '',
            price: listing.ListPrice || 0,
        });
        recalibSignal('listing_view');
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
    const domNum       = computeDaysOnMarket(listing);
    const dom          = domNum != null ? domNum : '';
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
        ? `<img class="lp-photo-main-img" src="${mainPhoto}" alt="${address}" loading="eager" fetchpriority="high">`
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
    const listDateFormatted = fmtListDate(listDate, { month: 'long', day: 'numeric', year: 'numeric' });

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
    // No property in the URL — hide the hero entirely so visitors (esp. from
    // Google Ads) land directly on the search bar + property grid.
    if (!container) return;
    container.innerHTML = '';
    container.style.display = 'none';
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
    trackEvent('whatsapp_click', { source: 'hero', mlsId: heroListing ? (heroListing.ListingId || '') : '' });
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
// Multi-select property types: checkbox key -> Bridge PropertySubType values
const PTYPE_SUBTYPES = {
    sfr:   ['Single Family Residence'],
    condo: ['Condominium', 'Stock Cooperative', 'Villa'],
    town:  ['Townhouse'],
    multi: ['Multi Family', 'Duplex', 'Triplex', 'Quadruplex'],
};
const PTYPE_LABEL_KEYS = { sfr: 'singleFamily', condo: 'condoVilla', town: 'townhouseOpt', multi: 'multiFamily' };

function initTypeMulti() {
    const btn   = document.getElementById('f-type-btn');
    const panel = document.getElementById('f-type-panel');
    const label = document.getElementById('f-type-label');
    if (!btn || !panel || !label) return;

    const updateLabel = () => {
        const checked = [...panel.querySelectorAll('input[name="ptype"]:checked')].map(b => b.value);
        if (!checked.length)      { label.textContent = t('allTypes'); label.setAttribute('data-i18n', 'allTypes'); }
        else if (checked.length === 1) { label.textContent = t(PTYPE_LABEL_KEYS[checked[0]]); label.setAttribute('data-i18n', PTYPE_LABEL_KEYS[checked[0]]); }
        else { label.textContent = `${checked.length} ${t('typesWord')}`; label.removeAttribute('data-i18n'); }
    };

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = panel.style.display !== 'none';
        panel.style.display = open ? 'none' : 'block';
        btn.setAttribute('aria-expanded', String(!open));
    });
    panel.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => {
        if (panel.style.display !== 'none') { panel.style.display = 'none'; btn.setAttribute('aria-expanded', 'false'); }
    });
    panel.querySelectorAll('input[name="ptype"]').forEach(box => box.addEventListener('change', updateLabel));
}

function buildSearchParams() {
    const isRent = activeTab === 'rent';
    const params = { limit: PAGE_SIZE, ...sortParams(), StandardStatus: 'Active' };

    // Location (comma-separated cities → multiple City params handled below)
    const loc = document.getElementById('f-location').value.trim();
    if (loc) params._cities = loc.split(',').map(s => s.trim()).filter(Boolean);

    // Property Type — respect Buy vs Rent tab; multi-select checkboxes
    // (none checked = All Types). Bridge takes PropertySubType.in=csv.
    const baseType = isRent ? 'Residential Lease' : 'Residential';
    params.PropertyType = baseType;
    const typeKeys = [...document.querySelectorAll('#f-type-panel input[name="ptype"]:checked')].map(b => b.value);
    if (typeKeys.length) {
        const subs = typeKeys.flatMap(k => PTYPE_SUBTYPES[k] || []);
        if (subs.length) params['PropertySubType.in'] = subs.join(',');
        // Multifamily (Multi Family/Duplex/Triplex/Quadruplex) lives under
        // PropertyType "Residential Income", NOT "Residential" — a plain
        // Residential query returns ZERO for it (verified live 2026-08-20).
        if (!isRent && typeKeys.includes('multi')) {
            delete params.PropertyType;
            params['PropertyType.in'] = typeKeys.length === 1 && typeKeys[0] === 'multi'
                ? 'Residential Income'
                : 'Residential,Residential Income';
        }
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

    // Feature filters — Bridge fields verified live 2026-08-19:
    // PoolPrivateYN=true (17k actives) · CommunityFeatures contains Gated/Gated Community
    // (3.6k) · PatioAndPorchFeatures outdoor values (no literal "Terrace" in the feed) ·
    // MIAMIRE_Restrictions "Daily Rentals Allowed" (940, same field the STR page uses)
    if (document.getElementById('f-pool')?.checked)   params.PoolPrivateYN = 'true';
    if (document.getElementById('f-gated')?.checked)  params['CommunityFeatures.in'] = 'Gated,Gated Community';
    if (document.getElementById('f-terrace')?.checked) params['PatioAndPorchFeatures.in'] = 'Open Balcony,Patio,Deck,Open Porch,Wrap Around';
    if (document.getElementById('f-str-ok')?.checked) params['MIAMIRE_Restrictions.in'] = 'Daily Rentals Allowed';

    // HOA — AssociationFee ($/mo) range, or AssociationYN=false for "No HOA"
    if (document.getElementById('f-no-hoa')?.checked) {
        params.AssociationYN = 'false';
    } else {
        const hoaMin = parseFloat(document.getElementById('f-hoa-min')?.value);
        const hoaMax = parseFloat(document.getElementById('f-hoa-max')?.value);
        if (!isNaN(hoaMin) && hoaMin > 0) params['AssociationFee.gte'] = hoaMin;
        if (!isNaN(hoaMax) && hoaMax > 0) params['AssociationFee.lte'] = hoaMax;
    }

    // Keywords — free-text, comma-separated (CRM style). Bridge has NO text-search
    // operator (probed: .contains/.like 400), so terms filter client-side over a
    // widened fetch window (see fetchListings). Every typed term must match, and
    // keywords combine (AND) with every other filter above.
    const kwRaw = (document.getElementById('f-keyword')?.value || '').trim();
    if (kwRaw) {
        const kws = kwRaw.split(/[,;]+/).map(t => t.trim().toLowerCase()).filter(Boolean);
        if (kws.length) params._keywords = kws;
    }

    return params;
}

// Keyword → match terms (EN + ES so LATAM-written remarks match too)
const KEYWORD_TERMS = {
    modern:    ['modern', 'moderno', 'moderna'],
    moderno:   ['modern', 'moderno', 'moderna'],
    renovated: ['renovated', 'remodeled', 'renovado', 'renovada', 'remodelado', 'remodelada', 'updated'],
    renovado:  ['renovated', 'remodeled', 'renovado', 'renovada', 'remodelado', 'remodelada', 'updated'],
    remodeled: ['renovated', 'remodeled', 'renovado', 'renovada', 'remodelado', 'remodelada', 'updated'],
    private:   ['private', 'privado', 'privada', 'privacy'],
    privado:   ['private', 'privado', 'privada', 'privacy'],
    golf:      ['golf'],
    pool:      ['pool', 'piscina'],
    piscina:   ['pool', 'piscina'],
    waterfront:['waterfront', 'water front', 'frente al agua'],
};
// Any word NOT in the map matches literally against the listing text.
function listingMatchesKeywords(l, kws) {
    const hay = [
        l.PublicRemarks || '',
        (l.InteriorFeatures || []).join(' '),
        (l.ExteriorFeatures || []).join(' '),
        (l.CommunityFeatures || []).join(' '),
        (l.ArchitecturalStyle || []).join(' '),
    ].join(' ').toLowerCase();
    return kws.every(k => (KEYWORD_TERMS[k] || [k]).some(term => hay.includes(term)));
}

// Newest-to-market first. Sort by the SAME date shown on the card
// (ListingContractDate → OnMarketDate → OriginalEntryTimestamp), descending.
// We used to sort by DaysOnMarket ascending, but DOM is unreliable for
// re-listed luxury properties (it resets / goes cumulative), so it disagreed
// with the displayed "Listed" date and made the list look out of order.
// Parse an MLS date string to a LOCAL Date. Bridge sends date-only fields
// ("2026-07-09") which `new Date()` reads as UTC midnight — in Eastern time
// that renders as the PREVIOUS evening, so "Listed Jul 9" showed as "Jul 8"
// and a listing that came on today looked a day old. Anchor date-only values
// to local midnight; pass full timestamps (with a "T") through untouched.
function parseListingDate(d) {
    if (!d) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d).trim());
    const dt = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(d);
    return isNaN(dt.getTime()) ? null : dt;
}
function fmtListDate(d, opts) {
    const dt = parseListingDate(d);
    return dt ? dt.toLocaleDateString('en-US', opts) : '';
}
function listedTime(l) {
    const dt = parseListingDate(l.ListingContractDate || l.OnMarketDate || l.OriginalEntryTimestamp || '');
    return dt ? dt.getTime() : -Infinity; // undated listings sink to the bottom
}
function byNewestListed(a, b) { return listedTime(b) - listedTime(a); }

// Days on market, computed LIVE from the listed date — never trust Bridge's
// DaysOnMarket field, which is a snapshot frozen at ingest and does NOT
// re-increment day to day (a listing that came on yesterday kept reading "0").
// Falls back to Bridge's field only when the listing has no usable date.
// Returns a number, or null when nothing is knowable.
function computeDaysOnMarket(l) {
    const t = listedTime(l);
    if (t !== -Infinity && !isNaN(t)) {
        const days = Math.floor((Date.now() - t) / 86400000);
        return days < 0 ? 0 : days; // guard against future-dated / clock skew
    }
    const bridge = (l.DaysOnMarket != null) ? l.DaysOnMarket
                 : (l.CumulativeDaysOnMarket != null ? l.CumulativeDaysOnMarket : null);
    return bridge;
}


// Results title (reference layout): "<City> Homes for Sale/Rent"
function updateResultsTitle() {
    const el = document.getElementById('results-title');
    if (!el) return;
    const loc = (document.getElementById('f-location') || {}).value || '';
    const city = loc.split(',')[0].trim();
    const mode = activeTab === 'rent' ? 'for Rent' : 'for Sale';
    el.textContent = `${city || 'South Florida'} Homes ${mode}`;
}

async function fetchBrowseListings(page = 0) {
    const grid      = document.getElementById('results-grid');
    const countEl   = document.getElementById('results-count');
    const noResults = document.getElementById('no-results');

    currentPage = page;
    updateResultsTitle();
    grid.innerHTML = renderSkeletons(9);
    noResults.style.display = 'none';
    hidePagination();
    countEl.textContent = 'Loading properties...';

    const isRent = activeTab === 'rent';

    try {
        // Full South-FL active inventory, newest-on-market first (sort by entry
        // date, not ModificationTimestamp — price-change touches on old listings
        // would float them above genuinely new ones). City filter runs SERVER-side
        // (City.in) so the API `total` is exact and pagination math holds.
        const data = await apiFetch({
            StandardStatus: 'Active',
            PropertyType: isRent ? 'Residential Lease' : 'Residential',
            'City.in': SOUTH_FL_CITIES.join(','),
            ...sortParams(),
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE,
        });

        const all = (data.success && Array.isArray(data.bundle)) ? data.bundle : [];
        const total = (data.success && typeof data.total === 'number') ? data.total : all.length;
        clientSort(all); // within-page order always matches the date on the card

        grid.innerHTML = '';

        if (!all.length) {
            noResults.style.display = 'block';
            countEl.textContent = 'No properties available';
            return;
        }

        window._currentListings = all;
        const renderFn = currentViewMode === 'list' ? renderListItem : renderCard;
        if (currentViewMode === 'list') grid.classList.add('results-list-view');
        all.forEach(l => grid.insertAdjacentHTML('beforeend', renderFn(l)));

        const from = page * PAGE_SIZE + 1;
        const to   = page * PAGE_SIZE + all.length;
        countEl.textContent = `Showing ${from.toLocaleString()}-${to.toLocaleString()} of ${total.toLocaleString()} properties`;
        renderPagination(total, page);

        // Update map if in map view
        if (document.getElementById('map-view')?.style.display === 'block') renderMapView();
    } catch (err) {
        console.error('Browse listings error:', err);
        grid.innerHTML = '';
        noResults.style.display = 'block';
        countEl.textContent = 'Error loading properties — please try searching';
    }
}

// ============================================================
// PAGINATION — numbered pages under the grid (browse + search)
// ============================================================
function hidePagination() {
    const wrap = document.getElementById('pagination-wrap');
    if (wrap) { wrap.style.display = 'none'; wrap.innerHTML = ''; }
}

function goToPage(page) {
    if (hasActiveSearch) runSearch(page, true); // reuse lastQuery — never rebuild from the form mid-pagination
    else fetchBrowseListings(page);
    // Jump back to the top of the results for the new page
    const anchor = document.getElementById('browse-section');
    if (anchor) anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderPagination(total, page) {
    const wrap = document.getElementById('pagination-wrap');
    if (!wrap) return;

    // Bridge rejects deep offsets — cap reachable pages at MAX_OFFSET
    const totalPages = Math.min(
        Math.ceil(total / PAGE_SIZE),
        Math.floor(MAX_OFFSET / PAGE_SIZE)
    );
    if (totalPages <= 1) { hidePagination(); return; }

    const btn = (label, target, opts = {}) => {
        const cls = ['page-btn'];
        if (opts.active) cls.push('active');
        if (opts.nav) cls.push('page-nav');
        const dis = opts.disabled ? ' disabled' : '';
        return `<button class="${cls.join(' ')}"${dis} data-page="${target}">${label}</button>`;
    };

    // Windowed page numbers: 1 … p-1 p p+1 … last
    const nums = new Set([0, totalPages - 1]);
    for (let i = page - 2; i <= page + 2; i++) {
        if (i >= 0 && i < totalPages) nums.add(i);
    }
    const sorted = [...nums].sort((a, b) => a - b);

    let html = btn('‹ ' + t('prevPage'), page - 1, { nav: true, disabled: page === 0 });
    let prev = -1;
    sorted.forEach(p => {
        if (prev !== -1 && p - prev > 1) html += '<span class="page-ellipsis">…</span>';
        html += btn(String(p + 1), p, { active: p === page });
        prev = p;
    });
    html += btn(t('nextPage') + ' ›', page + 1, { nav: true, disabled: page >= totalPages - 1 });

    wrap.innerHTML = html;
    wrap.style.display = 'flex';

    wrap.querySelectorAll('.page-btn:not([disabled])').forEach(b => {
        b.addEventListener('click', () => {
            const target = parseInt(b.dataset.page, 10);
            if (!isNaN(target) && target !== page) goToPage(target);
        });
    });
}

async function fetchListings(params, offset = 0) {
    // Handle multi-city: make parallel requests and merge
    const cities = params._cities;
    delete params._cities;
    const statusList = params._statusList;
    delete params._statusList;
    const wfType = params._wfType;
    delete params._wfType;
    const keywords = params._keywords;
    delete params._keywords;

    // Keyword mode: text-match runs client-side, so widen the fetch to the proxy
    // max (200 newest) and search within it — every shown property truly matches.
    if (keywords && keywords.length) { params.limit = 200; offset = 0; }

    params.offset = offset;

    let allListings = [];
    let total = 0;

    if (cities && cities.length > 1) {
        // Multi-city stays comma-safe (city names can't be trusted in a raw .in
        // list from free-text input) — parallel per-city queries, totals summed.
        const requests = cities.map(city => {
            const p = { ...params, City: city };
            if (statusList) p.StandardStatus = statusList[0];
            return apiFetch(p).then(d => (d.success && Array.isArray(d.bundle))
                ? { bundle: d.bundle, total: (typeof d.total === 'number' ? d.total : d.bundle.length) }
                : { bundle: [], total: 0 });
        });
        const results = await Promise.all(requests);
        results.forEach(r => { allListings = allListings.concat(r.bundle); total += r.total; });
        clientSort(allListings);
    } else {
        if (cities && cities.length === 1) params.City = cities[0];
        if (statusList) params.StandardStatus = statusList[0];
        const data = await apiFetch(params);
        allListings = (data.success && Array.isArray(data.bundle)) ? data.bundle : [];
        total = (data.success && typeof data.total === 'number') ? data.total : allListings.length;
    }

    // Client-side filter for multiple statuses
    if (statusList && statusList.length > 1) {
        allListings = allListings.filter(l => statusList.includes(l.StandardStatus));
    }

    // Client-side keyword filter (remarks + feature arrays, EN/ES terms)
    let keywordMode = false;
    if (keywords && keywords.length) {
        keywordMode = true;
        allListings = allListings.filter(l => listingMatchesKeywords(l, keywords));
    }

    // Client-side filter for waterfront type
    if (wfType && wfType !== 'any') {
        const wfMap = { bay: 'bay', canal: 'canal', ocean: 'ocean' };
        allListings = allListings.filter(l => {
            const features = (l.WaterfrontFeatures || []).map(f => f.toLowerCase());
            return features.some(f => f.includes(wfMap[wfType]));
        });
    }

    return { listings: allListings, total, keywordMode };
}

// ============================================================
// RENDER LISTING CARDS
// ============================================================

// Share a listing (preview layout) - native share sheet, clipboard fallback
function sharePreviewListing(lid) {
    const url = `${window.location.origin}/listing?mls=${lid}`;
    trackEvent('share_click', { mlsId: lid });
    if (navigator.share) {
        navigator.share({ title: 'The Poler Team', url }).catch(() => {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => alert('Link copied'));
    } else {
        window.prompt('Copy this link:', url);
    }
}

function renderCard(listing) {
    const photo   = getPhoto(listing);
    const price   = formatPrice(listing.ListPrice);
    const address = listing.UnparsedAddress || listing.City || 'South Florida';
    const city    = listing.City || '';
    const stats   = statsStr(listing);
    const lid     = listing.ListingId || '';
    const status  = listing.StandardStatus || 'Active';

    const imgHtml = photo
        ? `<img class="listing-photo" src="${photo}" alt="${address}" loading="lazy">`
        : `<div class="listing-placeholder"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M3 21h18M5 21V7l8-4v18M13 21V3l6 4v14"/></svg></div>`;

    const statusClass = status === 'Active' ? 'status-active' : status === 'Pending' ? 'status-pending' : 'status-other';

    // NEW badge for listings <= 7 days on market (computed live, not Bridge's stale field)
    const dom = computeDaysOnMarket(listing);
    const isNew = dom != null && dom <= 7;

    // Date the listing went to market (shown on every card)
    const listDateStr = fmtListDate(listing.ListingContractDate || listing.OnMarketDate || '', { month: 'short', day: 'numeric', year: 'numeric' });

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
            <div class="pv-chips">
                <span class="pv-status ${statusClass}">${status}</span>
                ${isNew ? '<span class="pv-new">New</span>' : ''}
            </div>
            <div class="pv-actions">
                <button class="pv-icon-btn pv-save ${isSaved ? 'saved' : ''}" onclick="event.stopPropagation();toggleSaveHome('${lid}',this)" aria-label="Save property">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
                </button>
                <button class="pv-icon-btn" onclick="event.stopPropagation();sharePreviewListing('${lid}')" aria-label="Share property">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                </button>
            </div>
        </div>
        <div class="listing-details">
            <div class="listing-price">${price}</div>
            ${stats ? `<div class="listing-stats">${stats}</div>` : ''}
            <div class="listing-address">${address}</div>
            <div class="listing-mls">${listDateStr ? `${t('listedLabel')} ${listDateStr}` : ''}${dom != null ? `${listDateStr ? ' · ' : ''}${dom === 0 ? t('domToday') : dom + ' ' + t(dom === 1 ? 'domLabelOne' : 'domLabel')}` : ''}${(listDateStr || dom != null) && lid ? ' · ' : ''}${lid ? `MLS®: ${lid}` : ''}</div>
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
    const domNum = computeDaysOnMarket(listing);
    const dom = domNum != null ? domNum : '—';
    const isNew = domNum != null && domNum <= 7;
    const ppsfVal = (listing.ListPrice && listing.LivingArea) ? '$' + Math.round(listing.ListPrice / listing.LivingArea).toLocaleString() : '';
    const status = listing.StandardStatus || 'Active';
    const statusClass = status === 'Active' ? 'status-active' : status === 'Pending' ? 'status-pending' : 'status-other';
    const propType = listing.PropertySubType || listing.PropertyType || '';
    const yearBuilt = listing.YearBuilt || '';
    const lot = listing.LotSizeSquareFeet ? Number(listing.LotSizeSquareFeet).toLocaleString() + ' sqft lot' : '';
    const hoa = listing.AssociationFee ? '$' + Number(listing.AssociationFee).toLocaleString() + '/mo HOA' : '';
    const listDate = listing.ListingContractDate || listing.OnMarketDate || '';
    const listDateStr = fmtListDate(listDate, { month: 'short', day: 'numeric', year: 'numeric' });

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
                <div class="lv-dom">${dom !== '—' ? dom + ' day' + (dom !== 1 ? 's' : '') + ' on market' : ''}${listDateStr ? ' · Listed ' + listDateStr : ''}</div>
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

let currentViewMode = 'grid'; // 'grid', 'list', or 'map' — default to grid (Four Corners style)

function switchView(mode) {
    const btns = document.querySelectorAll('.view-toggle-btn[data-view]');
    const grid = document.getElementById('results-grid');
    const mapView = document.getElementById('map-view');

    currentViewMode = mode;
    btns.forEach(b => b.classList.toggle('active', b.dataset.view === mode));

    // If no stored listings, grab them from the existing DOM cards
    if (!window._currentListings || !window._currentListings.length) {
        // Can't re-render without data — just toggle the CSS class
        if (mode === 'list') {
            grid.classList.add('results-list-view');
        } else {
            grid.classList.remove('results-list-view');
        }
        if (mode === 'map') { grid.style.display = 'none'; if (mapView) mapView.style.display = 'block'; renderMapView(); }
        else { grid.style.display = ''; if (mapView) mapView.style.display = 'none'; }
        return;
    }

    const listings = window._currentListings;

    if (mode === 'grid') {
        grid.style.display = '';
        grid.classList.remove('results-list-view');
        if (mapView) mapView.style.display = 'none';
        grid.innerHTML = '';
        listings.forEach(l => grid.insertAdjacentHTML('beforeend', renderCard(l)));
    } else if (mode === 'list') {
        grid.style.display = '';
        grid.classList.add('results-list-view');
        if (mapView) mapView.style.display = 'none';
        grid.innerHTML = '';
        listings.forEach(l => grid.insertAdjacentHTML('beforeend', renderListItem(l)));
    } else if (mode === 'map') {
        grid.style.display = 'none';
        if (mapView) mapView.style.display = 'block';
        renderMapView();
    }
}

function initViewToggle() {
    document.querySelectorAll('.view-toggle-btn[data-view]').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // Set default active button to grid
    const listBtn = document.getElementById('view-list-btn');
    const gridBtn = document.getElementById('view-grid-btn');
    if (listBtn && gridBtn) {
        listBtn.classList.remove('active');
        gridBtn.classList.add('active');
    }

    // Support ?view=list URL param override
    const viewParam = new URLSearchParams(window.location.search).get('view');
    if (viewParam === 'list') {
        if (listBtn) listBtn.click();
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
// SEARCH — main handler (page-replace pagination, 0-based pages)
// ============================================================
async function runSearch(page = 0, reuseQuery = false) {
    const grid       = document.getElementById('results-grid');
    const countEl    = document.getElementById('results-count');
    const noResults  = document.getElementById('no-results');
    const searchBtn  = document.getElementById('search-btn');
    const searchTxt  = document.getElementById('search-btn-text');

    const isFirstPage = page === 0 && !reuseQuery;
    if (isFirstPage) {
        // Fresh search — rebuild the query from the filter form
        const params = buildSearchParams();
        if (!params) return; // validation failed
        lastQuery = { ...params };
    }

    currentPage = page;
    updateResultsTitle();
    searchOffset = page * PAGE_SIZE;
    grid.innerHTML = renderSkeletons(9);
    noResults.style.display = 'none';
    hidePagination();
    countEl.textContent = 'Searching...';

    searchBtn.disabled = true;
    if (searchTxt) searchTxt.textContent = t('search') + '...';

    try {
        const { listings, total, keywordMode } = await fetchListings({ ...lastQuery }, searchOffset);

        grid.innerHTML = '';

        if (!listings.length) {
            noResults.style.display = 'block';
            countEl.textContent = 'No results found';
            // Deep page came back empty (client-side filters can thin pages) —
            // keep pagination visible so the user can navigate back.
            if (page > 0 && total > 0) renderPagination(total, page);
            return;
        }

        clientSort(listings);

        window._currentListings = listings;
        totalResults = total;

        const renderFn = currentViewMode === 'list' ? renderListItem : renderCard;
        if (currentViewMode === 'list') grid.classList.add('results-list-view');
        listings.forEach(l => {
            grid.insertAdjacentHTML('beforeend', renderFn(l));
        });

        if (keywordMode) {
            // Text search runs over the 200 newest results of the other filters —
            // say so instead of pretending we paged the whole inventory.
            countEl.textContent = `${listings.length} matching propert${listings.length === 1 ? 'y' : 'ies'} (keyword search covers the 200 newest results)`;
            hidePagination();
        } else {
            const from = searchOffset + 1;
            const to   = searchOffset + listings.length;
            countEl.textContent = total > listings.length
                ? `Showing ${from.toLocaleString()}-${to.toLocaleString()} of ${total.toLocaleString()} properties`
                : `Showing ${listings.length} propert${listings.length === 1 ? 'y' : 'ies'}`;
            renderPagination(total, page);
        }

        // Show save search CTA after explicit search
        if (hasActiveSearch) {
            const cta = document.getElementById('save-search-cta');
            if (cta) cta.style.display = 'block';
        }

        // Update map if in map view
        if (document.getElementById('map-view')?.style.display === 'block') renderMapView();

        // Log the search (2026-09-10: this used to JSON.parse a plain email
        // string and throw, so no search ever reached the CRM). First search of
        // the page load = 'search'; every later one = a filter change, which
        // counts toward the recalibration trigger.
        if (isFirstPage) {
            searchesThisLoad += 1;
            trackEvent(searchesThisLoad === 1 ? 'search' : 'filter_applied',
                { params: lastQuery, resultCount: listings.length });
            if (searchesThisLoad > 1) recalibSignal('filter');
        }

    } catch (err) {
        console.error('Search error:', err);
        grid.innerHTML = '';
        noResults.style.display = 'block';
        countEl.textContent = 'Search error — please try again';
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
        // Re-run the last search (same page) to update translated labels
        runSearch(currentPage, true);
    } else {
        // Re-fetch the browse grid (same page) with translated labels
        fetchBrowseListings(currentPage);
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

            // Show/hide sell form vs search bar (+ inline filter bar, which now
            // lives in the same row as the search bar)
            const filterBar = document.getElementById('filter-bar');
            if (activeTab === 'sell') {
                if (searchWrap) searchWrap.style.display = 'none';
                if (filterBar) filterBar.style.display = 'none';
                if (sellPanel) sellPanel.style.display = 'block';
                if (browseSection) browseSection.style.display = 'none';
            } else {
                if (searchWrap) searchWrap.style.display = '';
                if (filterBar) filterBar.style.display = '';
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
                fetchBrowseListings(0);
            }
        });
    });

    // Deep link from other pages' nav: ?tab=sell|rent opens that tab on load
    try {
        const tabParam = new URLSearchParams(window.location.search).get('tab');
        if (tabParam && tabParam !== 'buy') {
            const tBtn = document.querySelector('[data-tab="' + tabParam + '"]');
            if (tBtn) tBtn.click();
        }
    } catch (e) { /* non-critical */ }
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
            const params = { limit: PAGE_SIZE, ...sortParams(), StandardStatus: 'Active', PropertyType: isRent ? 'Residential Lease' : 'Residential', PostalCode: val };
            lastQuery = { ...params };
            // Route through runSearch with the prebuilt ZIP query so results get
            // the same count line + pagination as every other search.
            runSearch(0, true);
            const browse = document.getElementById('browse-section');
            if (browse) browse.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }

        // Default: treat as city name search
        const locInput = document.getElementById('f-location');
        if (locInput) locInput.value = val;
        hasActiveSearch = true;
        runSearch(0);
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
    trackEvent(idx >= 0 ? 'favorite_remove' : 'favorite_add', { mlsId: lid });
    if (idx < 0) recalibSignal('favorite');
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

/* NOTE: a legacy duplicate initViewToggle used to live here — as a classic
   script, its declaration SHADOWED the real one above (grid/list clicks only
   toggled the active class and never re-rendered). Removed 2026-08-19. */

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

// Sell-tab valuation form — wire to the CRM (pre-2026-08-19 it had NO handler:
// the browser did a default GET reload and the seller lead was silently lost).
function initSellForm() {
    const form = document.getElementById('sell-form');
    if (!form) return;
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const name  = (document.getElementById('sell-name')?.value || '').trim();
        const email = (document.getElementById('sell-email')?.value || '').trim();
        const phone = (document.getElementById('sell-phone')?.value || '').trim();
        const addr  = (document.getElementById('sell-address')?.value || '').trim();
        if (!name || !email || !addr) return;
        const parts = name.split(/\s+/);
        const first = parts.shift() || '';
        const last  = parts.join(' ');
        fetch('/api/save-lead', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                first, last, email, phone,
                listingAddress: 'VALUATION: ' + addr,
                sourceUrl: window.location.href,
                pageUrl: window.location.href,
                language: (typeof getLang === 'function' ? getLang() : 'en'),
                timeline: 'Home Valuation',
            }),
        }).then(r => r.json()).then(() => {
            if (typeof gtag_report_conversion === 'function') { try { gtag_report_conversion(); } catch (e2) {} }
            form.style.display = 'none';
            const ok = document.getElementById('sell-success');
            if (ok) ok.style.display = 'block';
        }).catch(() => { /* leave the form for retry */ });
    });
}

function initSearch() {
    document.getElementById('search-btn').addEventListener('click', () => { hasActiveSearch = true; runSearch(0); });

    // Sort control (reference layout)
    const sortSel = document.getElementById('sort-select');
    if (sortSel) sortSel.addEventListener('change', () => {
        sortMode = sortSel.value;
        if (hasActiveSearch) runSearch(0, true); else fetchBrowseListings(0);
    });

    // Save search button reveals the alert-subscribe card
    const saveBtn = document.getElementById('save-search-btn');
    if (saveBtn) saveBtn.addEventListener('click', () => {
        const cta = document.getElementById('save-search-cta');
        if (cta) { cta.style.display = 'block'; cta.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    });

    // Enter key in filter inputs triggers search
    document.querySelectorAll('.fb-input, .fb-input-sm, .fb-select').forEach(el => {
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); hasActiveSearch = true; runSearch(0); }
        });
    });

    // Pre-fill location from ?city= URL param and auto-run
    const urlParams = new URLSearchParams(window.location.search);
    const cityParam = urlParams.get('city');
    if (cityParam) {
        const locInput = document.getElementById('f-location');
        if (locInput) locInput.value = decodeURIComponent(cityParam.replace(/\+/g, ' '));
    }

    // If search-specific params exist, run search; otherwise browse the full
    // South-FL inventory newest-first (paginated).
    // Note: 'id' and 'mls' are for the hero property display, not for grid search.
    const hasSearchParam = urlParams.get('city');
    if (hasSearchParam) {
        runSearch(0);
    } else {
        fetchBrowseListings(0);
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
    trackEvent('whatsapp_click', { source: 'agent_form' });
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
        // Guarded like metaEventId in completeLead(): crypto.randomUUID is MISSING on
        // older Android WebViews / FB in-app browsers — an unguarded call here THROWS
        // during script load (this IIFE runs at parse time) and kills everything below
        // it, including the lead-popup wiring at the bottom of the file. That crash was
        // the root cause of the 7/8–7/14 conversion collapse ($2.98 → $5.39 CPL).
        sessionId: (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID())
            || ('s-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)),
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
            // poler_lead_v1 is a bare string (email or 'alert_<token>'), never
            // JSON — the old JSON.parse threw every time and no chat ever saved.
            const leadData = localStorage.getItem('poler_lead_v1') || '';
            if (leadData.indexOf('@') < 1) return;
            const lead = { email: leadData };

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
    lpEarlyTreatment(); // landing-page A/B: apply sticky-cookie variant copy SYNC, before first render (no flicker)
    applyTranslations();
    initLanguageSelector();

    initLpAb();        // landing-page A/B: assign new visitors, reconcile copy, track view
    initLeadCapture();
    initHeroProperty();
    initTabs();
    initTypeMulti();
    initSellForm();
    initLookup();
    initYearSlider();
    initWaterfrontToggle();
    initFilterToggle();
    initSearchBar();
    initSearch();
    initViewToggle();
    initSaveSearch();
    initFooterAlert();
    initViewToggle();
    initRecalibActiveTimer();
    // QA hook: ?recalib=1 forces the recalibration card (team devices never
    // qualify organically, so Kevin can preview it this way).
    try {
        if (new URLSearchParams(location.search).get('recalib')) setTimeout(() => {
            const gate = document.getElementById('lead-overlay');
            if (leadCaptured && !(gate && gate.classList.contains('active'))) showRecalibPopup('manual');
        }, 800);
    } catch (e) { /* ignore */ }
    setTimeout(enhanceDroneVideo, 500);
});

// ============================================================
// PAGE-LEAVE FADE (2026-08-19) — quick white fade covering the
// repaint flash when navigating between pages (card -> detail,
// nav links, detail -> results). ES5 only.
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
    var fade = document.createElement('div');
    fade.setAttribute('aria-hidden', 'true');
    fade.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2000;background:#fff;opacity:0;pointer-events:none;transition:opacity 0.18s ease;';
    document.body.appendChild(fade);
    function showFade() { fade.style.opacity = '1'; }
    document.addEventListener('click', function (e) {
        var el = e.target;
        if (!el || !el.closest) return;
        var a = el.closest('a[href]');
        if (a) {
            var href = a.getAttribute('href');
            if (!href || href.charAt(0) === '#' || href.indexOf('tel:') === 0 || href.indexOf('mailto:') === 0 ||
                href.indexOf('http') === 0 || a.target === '_blank' || a.getAttribute('onclick')) return;
            showFade();
            return;
        }
        if (el.closest('.listing-card, .lv-item')) showFade();
    });
    // Coming back via bfcache restores this page as-is — clear the fade
    window.addEventListener('pageshow', function () { fade.style.opacity = '0'; });
});
