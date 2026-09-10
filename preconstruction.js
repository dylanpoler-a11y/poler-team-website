/* ============================================================
   preconstruction.js — Preconstruction / New Developments page
   Self-contained (does NOT touch the global i18n.js). Reads/writes the
   shared language key so the choice sticks across pages, fetches
   /api/preconstructions with the active filters (reflected in the URL so
   the view is shareable), and renders luxury building cards.
   ============================================================ */

var WA_NUMBER = '19542354046'; // Rosa Poler — point of contact for ALL preconstruction inquiries

/* ---- Trilingual PAGE CHROME only (building data stays English) ---- */
var I18N = {
  tagline:      { en: 'South Florida Luxury Real Estate', es: 'Bienes Raíces de Lujo en el Sur de Florida', pt: 'Imóveis de Luxo no Sul da Flórida' },
  callUs:       { en: 'Call Us', es: 'Llámanos', pt: 'Ligue' },
  navHome:      { en: 'Home', es: 'Inicio', pt: 'Início' },
  navSTR:       { en: 'Short-Term Rentals', es: 'Alquileres Cortos', pt: 'Aluguéis de Curta Duração' },
  navPrecon:    { en: 'Preconstruction', es: 'Preconstrucción', pt: 'Pré-Construção' },
  heroEyebrow:  { en: 'New Developments', es: 'Nuevos Desarrollos', pt: 'Novos Empreendimentos' },
  heroTitle:    { en: 'Exclusive Preconstruction Options', es: 'Opciones Exclusivas de Preconstrucción', pt: 'Opções Exclusivas de Pré-Construção' },
  heroSubtitle: { en: "New-development towers in Brickell, Downtown Miami & beyond — lock in today's pricing before delivery.",
                  es: 'Torres de nueva construcción en Brickell, Downtown Miami y más — asegura el precio de hoy antes de la entrega.',
                  pt: 'Torres de novos empreendimentos em Brickell, Downtown Miami e além — garanta o preço de hoje antes da entrega.' },
  fArea:        { en: 'Area', es: 'Zona', pt: 'Área' },
  fPriceMax:    { en: 'Price max', es: 'Precio máx.', pt: 'Preço máx.' },
  fDelivery:    { en: 'Delivery by', es: 'Entrega hasta', pt: 'Entrega até' },
  fBeds:        { en: 'Bedrooms min', es: 'Habitaciones mín.', pt: 'Quartos mín.' },
  fSort:        { en: 'Sort', es: 'Ordenar', pt: 'Ordenar' },
  fWaterfront:  { en: 'Waterfront', es: 'Frente al agua', pt: 'Frente à água' },
  fStr:         { en: 'Short-term rental OK', es: 'Permite alquiler corto', pt: 'Permite aluguel curto' },
  optAny:       { en: 'Any', es: 'Cualquiera', pt: 'Qualquer' },
  opt1M:        { en: '$1M', es: '$1M', pt: '$1M' },
  opt2M:        { en: '$2M', es: '$2M', pt: '$2M' },
  opt3M:        { en: '$3M', es: '$3M', pt: '$3M' },
  opt5M:        { en: '$5M', es: '$5M', pt: '$5M' },
  opt10M:       { en: '$10M', es: '$10M', pt: '$10M' },
  opt20M:       { en: '$20M+', es: '$20M+', pt: '$20M+' },
  opt1plus:     { en: '1+', es: '1+', pt: '1+' },
  opt2plus:     { en: '2+', es: '2+', pt: '2+' },
  opt3plus:     { en: '3+', es: '3+', pt: '3+' },
  opt4plus:     { en: '4+', es: '4+', pt: '4+' },
  sortPriceLow: { en: 'Price: low → high', es: 'Precio: menor → mayor', pt: 'Preço: menor → maior' },
  sortPriceHigh:{ en: 'Price: high → low', es: 'Precio: mayor → menor', pt: 'Preço: maior → menor' },
  sortDelivery: { en: 'Soonest delivery', es: 'Entrega más próxima', pt: 'Entrega mais próxima' },
  sortName:     { en: 'Name', es: 'Nombre', pt: 'Nome' },
  towersOne:    { en: '{n} tower', es: '{n} torre', pt: '{n} torre' },
  towersMany:   { en: '{n} towers', es: '{n} torres', pt: '{n} torres' },
  specDeveloper:{ en: 'Developer', es: 'Desarrollador', pt: 'Incorporadora' },
  specDelivery: { en: 'Delivery', es: 'Entrega', pt: 'Entrega' },
  specPricing:  { en: 'Pricing from', es: 'Precios desde', pt: 'Preços a partir de' },
  specPerSqft:  { en: '$/sq ft', es: '$/pie²', pt: '$/pé²' },
  specStories:  { en: 'Stories', es: 'Pisos', pt: 'Andares' },
  specUnits:    { en: 'Units', es: 'Unidades', pt: 'Unidades' },
  labelViews:   { en: 'Views', es: 'Vistas', pt: 'Vistas' },
  tagWater:     { en: 'Waterfront', es: 'Frente al agua', pt: 'Frente à água' },
  tagStr:       { en: 'Short-term rental OK', es: 'Alquiler corto OK', pt: 'Aluguel curto OK' },
  requestDetails:{ en: 'Request details', es: 'Solicitar información', pt: 'Solicitar informações' },
  viewListing:  { en: 'View listing', es: 'Ver propiedad', pt: 'Ver imóvel' },
  bedStudio:    { en: 'Studio', es: 'Estudio', pt: 'Studio' },
  bedBr:        { en: 'BR', es: 'Hab.', pt: 'Quartos' },
  noResults:    { en: 'No towers match those filters. Try widening your search.',
                  es: 'Ninguna torre coincide con esos filtros. Amplía tu búsqueda.',
                  pt: 'Nenhuma torre corresponde a esses filtros. Amplie sua busca.' },
  loadError:    { en: "We couldn't load the developments right now. Please refresh.",
                  es: 'No pudimos cargar los desarrollos ahora. Por favor recarga.',
                  pt: 'Não foi possível carregar os empreendimentos. Por favor, recarregue.' },
  waMsg:        { en: "Hi Rosa, I'm interested in {name} preconstruction",
                  es: 'Hola Rosa, me interesa la preconstrucción de {name}',
                  pt: 'Olá Rosa, tenho interesse na pré-construção de {name}' },
  photosChip:   { en: '📷 {n} photos', es: '📷 {n} fotos', pt: '📷 {n} fotos' },
  amenitiesMore:{ en: '+{n} more', es: '+{n} más', pt: '+{n} mais' },
  labelParking: { en: 'Parking', es: 'Estacionamiento', pt: 'Estacionamento' },
  labelDeposit: { en: 'Deposit', es: 'Depósito', pt: 'Entrada' },
  galleryClose: { en: 'Close', es: 'Cerrar', pt: 'Fechar' },
  contactLine:  { en: 'All preconstruction inquiries handled by Rosa Poler, The Poler Team.',
                  es: 'Todas las consultas de preconstrucción las atiende Rosa Poler, The Poler Team.',
                  pt: 'Todas as consultas de pré-construção são atendidas por Rosa Poler, The Poler Team.' },
};

/* ---- language helpers (self-contained; compatible with the site key) ---- */
function getLang() {
  try {
    var l = localStorage.getItem('poler_lang') || localStorage.getItem('poler-lang');
    if (l === 'es' || l === 'pt' || l === 'en') return l;
  } catch (e) {}
  return 'en';
}
function setLang(lang) {
  try { localStorage.setItem('poler_lang', lang); localStorage.setItem('poler-lang', lang); } catch (e) {}
}
function t(key, repl) {
  var e = I18N[key]; if (!e) return key;
  var s = e[getLang()] || e.en || key;
  if (repl) for (var k in repl) s = s.replace('{' + k + '}', repl[k]);
  return s;
}

/* ---- HTML-safe escaping ---- */
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---- formatting helpers ---- */
function formatPrice(n) {
  if (!n || n <= 0) return '';
  if (n >= 1000000) {
    var m = n / 1000000;
    return '$' + (m >= 10 ? Math.round(m) : Math.round(m * 10) / 10) + 'M';
  }
  return '$' + Math.round(n / 1000) + 'K';
}
function bedsLabel(beds) {
  if (!Array.isArray(beds) || !beds.length) return '';
  var nums = beds.slice().sort(function (a, b) { return a - b; });
  var lo = nums[0], hi = nums[nums.length - 1];
  var loTxt = lo === 0 ? t('bedStudio') : lo;
  if (lo === hi) return (lo === 0 ? t('bedStudio') : lo + ' ' + t('bedBr'));
  return loTxt + '–' + hi + ' ' + t('bedBr');
}
function waLink(name) {
  var msg = t('waMsg', { name: name });
  return 'https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(msg);
}

/* ---- card renderer (pure — testable in node) ---- */
function buildCardHTML(b) {
  // Links the card to the tower's own indexable page (/tower/<id>, built by
  // tools/build-tower-pages.js). Without this the detail pages are orphans.
  var name = b.id
    ? '<a class="pc-name-link" href="/tower/' + esc(b.id) + '">' + esc(b.name) + '</a>'
    : esc(b.name);
  var photos = (Array.isArray(b.photos) ? b.photos : []).filter(Boolean);
  var hasPhoto = photos.length > 0;

  var badge = b.badge ? '<span class="pc-badge">' + esc(b.badge) + '</span>' : '';

  var mediaTags = '';
  if (b.waterfront) mediaTags += '<span class="pc-tag">' + esc(t('tagWater')) + '</span>';
  if (b.shortTermRental) mediaTags += '<span class="pc-tag">' + esc(t('tagStr')) + '</span>';
  if (mediaTags) mediaTags = '<div class="pc-media-tags">' + mediaTags + '</div>';

  // HERO: real <img> when we have photos (onerror → gradient placeholder,
  // never a broken img); gradient placeholder when we don't.
  var media;
  if (hasPhoto) {
    var chip = photos.length > 1
      ? '<span class="pc-photos-chip">' + esc(t('photosChip', { n: photos.length })) + '</span>' : '';
    var gallery = ' data-gallery="' + esc(JSON.stringify(photos)) + '"';
    var img = '<img class="pc-hero-img" loading="lazy" alt="' + esc(b.name) + '" src="' + esc(photos[0]) + '"' +
      ' onerror="this.style.display=\'none\';this.parentNode.classList.add(\'pc-media-placeholder\')">';
    media = '<div class="pc-media pc-media-clickable"' + gallery + '>' + img + badge + chip + mediaTags + '</div>';
  } else {
    media = '<div class="pc-media pc-media-placeholder">' + badge + mediaTags + '</div>';
  }

  // subtitle: area · address, plus beds
  var loc = [b.area, b.address].filter(Boolean).map(esc).join(' · ');
  var beds = bedsLabel(b.bedrooms);
  var sub = loc;
  if (beds) sub += (loc ? ' &nbsp;•&nbsp; ' : '') + '<span class="pc-beds">' + esc(beds) + '</span>';
  sub = sub ? '<div class="pc-sub">' + sub + '</div>' : '';

  var tagline = b.tagline ? '<p class="pc-tagline">' + esc(b.tagline) + '</p>' : '';
  var description = b.description ? '<p class="pc-desc">' + esc(b.description) + '</p>' : '';

  // spec grid — skip any missing field
  function spec(label, value, priceCls) {
    if (value === null || value === undefined || value === '') return '';
    return '<div class="pc-spec"><span class="pc-spec-l">' + esc(label) + '</span>' +
           '<span class="pc-spec-v' + (priceCls ? ' pc-spec-price' : '') + '">' + esc(value) + '</span></div>';
  }
  var specs = '';
  specs += spec(t('specDeveloper'), b.developer);
  specs += spec(t('specDelivery'), b.deliveryLabel || b.deliveryYear);
  specs += spec(t('specPricing'), formatPrice(b.priceFrom), true);
  specs += spec(t('specPerSqft'), b.pricePerSqft ? '$' + Number(b.pricePerSqft).toLocaleString('en-US') : '');
  specs += spec(t('specStories'), b.stories);
  specs += spec(t('specUnits'), b.totalUnits);
  specs = specs ? '<div class="pc-specs">' + specs + '</div>' : '';

  var pricingDetail = b.pricingFrom ? '<p class="pc-pricing-detail">' + esc(b.pricingFrom) + '</p>' : '';

  // amenities: up to 6 chips, then a "+N more" chip
  var amenities = '';
  var am = Array.isArray(b.amenities) ? b.amenities.filter(Boolean) : [];
  if (am.length) {
    var shown = am.slice(0, 6).map(function (a) { return '<span class="pc-amenity">' + esc(a) + '</span>'; }).join('');
    if (am.length > 6) shown += '<span class="pc-amenity pc-amenity-more">' + esc(t('amenitiesMore', { n: am.length - 6 })) + '</span>';
    amenities = '<div class="pc-amenities">' + shown + '</div>';
  }

  var parking = (b.parkingSpaces && String(b.parkingSpaces).trim())
    ? '<p class="pc-parking">🚗 <strong>' + esc(t('labelParking')) + ':</strong> ' + esc(b.parkingSpaces) + '</p>' : '';

  var deposit = (b.deposit && String(b.deposit).trim())
    ? '<div class="pc-deposit"><span class="pc-deposit-l">' + esc(t('labelDeposit')) + '</span>' +
      '<span class="pc-deposit-v">' + esc(b.deposit) + '</span></div>' : '';

  var views = b.views ? '<p class="pc-views"><strong>' + esc(t('labelViews')) + ':</strong> ' + esc(b.views) + '</p>' : '';
  var status = b.constructionStatus ? '<span class="pc-status">' + esc(b.constructionStatus) + '</span>' : '';

  var cta = '<a class="pc-btn pc-btn-primary" href="' + esc(waLink(b.name)) + '" target="_blank" rel="noopener">' +
              esc(t('requestDetails')) + '</a>';
  if (b.listingUrl) {
    cta += '<a class="pc-btn pc-btn-secondary" href="' + esc(b.listingUrl) + '" target="_blank" rel="noopener">' +
             esc(t('viewListing')) + '</a>';
  }

  return '<article class="pc-card">' +
    media +
    '<div class="pc-body">' +
      '<div><h2 class="pc-name">' + name + '</h2>' + sub + '</div>' +
      tagline + description + specs + pricingDetail + amenities + parking + deposit + views + status +
      '<div class="pc-cta">' + cta + '</div>' +
    '</div>' +
  '</article>';
}

/* ============================================================
   Below here: browser-only wiring (guarded so node can require this file)
   ============================================================ */
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}

var STATE = { areas: [], priceMax: '', deliveryYearMax: '', bedsMin: '', waterfront: false, shortTermRental: false, sort: 'price_low' };
var AREAS_BUILT = false;

function init() {
  applyTranslations();
  initLanguageSelector();
  readStateFromURL();
  syncControlsFromState();
  wireControls();
  wireLightbox();
  fetchAndRender();
}

/* ---- minimal vanilla photo lightbox ---- */
var LB = { photos: [], idx: 0, el: null, imgEl: null, countEl: null };
function ensureLightbox() {
  if (LB.el) return LB.el;
  var ov = document.createElement('div');
  ov.className = 'pc-lightbox';
  ov.setAttribute('aria-hidden', 'true');
  ov.innerHTML =
    '<button type="button" class="pc-lb-close" aria-label="' + esc(t('galleryClose')) + '">&times;</button>' +
    '<img class="pc-lb-img" alt="">' +
    '<span class="pc-lb-count"></span>';
  document.body.appendChild(ov);
  LB.el = ov;
  LB.imgEl = ov.querySelector('.pc-lb-img');
  LB.countEl = ov.querySelector('.pc-lb-count');
  // click the image → advance; click backdrop or × → close
  LB.imgEl.addEventListener('click', function (e) { e.stopPropagation(); lightboxNext(); });
  ov.querySelector('.pc-lb-close').addEventListener('click', closeLightbox);
  ov.addEventListener('click', closeLightbox);
  document.addEventListener('keydown', function (e) {
    if (LB.el && LB.el.classList.contains('open')) {
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowRight') lightboxNext();
    }
  });
  return ov;
}
function openLightbox(photos, start) {
  if (!Array.isArray(photos) || !photos.length) return;
  ensureLightbox();
  LB.photos = photos;
  LB.idx = start || 0;
  renderLightbox();
  LB.el.classList.add('open');
  LB.el.setAttribute('aria-hidden', 'false');
}
function renderLightbox() {
  if (!LB.imgEl) return;
  LB.imgEl.src = LB.photos[LB.idx];
  LB.countEl.textContent = (LB.idx + 1) + ' / ' + LB.photos.length;
  LB.countEl.style.display = LB.photos.length > 1 ? '' : 'none';
}
function lightboxNext() {
  if (LB.photos.length < 2) return closeLightbox();
  LB.idx = (LB.idx + 1) % LB.photos.length;
  renderLightbox();
}
function closeLightbox() {
  if (!LB.el) return;
  LB.el.classList.remove('open');
  LB.el.setAttribute('aria-hidden', 'true');
  LB.imgEl.src = '';
}
function wireLightbox() {
  var grid = document.getElementById('pc-grid');
  if (!grid) return;
  grid.addEventListener('click', function (e) {
    var media = e.target.closest ? e.target.closest('.pc-media-clickable') : null;
    if (!media) return;
    var raw = media.getAttribute('data-gallery');
    if (!raw) return;
    var photos;
    try { photos = JSON.parse(raw); } catch (err) { return; }
    openLightbox(photos, 0);
  });
}

/* ---- translate all [data-i18n] on the page ---- */
function applyTranslations() {
  var lang = getLang();
  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    var key = el.getAttribute('data-i18n');
    var e = I18N[key]; if (!e) return;
    el.textContent = e[lang] || e.en;
  });
  document.documentElement.lang = lang;
  var btn = document.getElementById('lang-btn-text');
  if (btn) {
    var flags = { en: '🇺🇸', es: '🇪🇸', pt: '🇵🇹' };
    btn.textContent = flags[lang] + ' ' + lang.toUpperCase();
  }
}

/* ---- language selector (mirrors listing.js behavior) ---- */
function initLanguageSelector() {
  var btn = document.getElementById('lang-selector-btn');
  var dd = document.getElementById('lang-dropdown');
  if (!btn || !dd) return;
  var cur = getLang();
  dd.querySelectorAll('.lang-option').forEach(function (o) { o.classList.toggle('active', o.dataset.lang === cur); });
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    var open = dd.classList.toggle('open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  dd.querySelectorAll('.lang-option').forEach(function (o) {
    o.addEventListener('click', function () {
      setLang(o.dataset.lang);
      dd.querySelectorAll('.lang-option').forEach(function (x) { x.classList.remove('active'); });
      o.classList.add('active');
      dd.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      applyTranslations();
      // Area names are English proper nouns (no relabel); re-render cards + count for the new language chrome.
      renderCards(lastBuildings);
      renderCount(lastCount);
    });
  });
  document.addEventListener('click', function () { dd.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); });
}

/* ---- URL <-> STATE ---- */
function readStateFromURL() {
  var p = new URLSearchParams(location.search);
  // ?building=<id> — deep link from property-alert emails/WhatsApp straight to ONE
  // tower's card (the api already supports id=). Cleared as soon as the visitor
  // touches any filter so they can browse the full directory from there.
  STATE.building = p.get('building') || '';
  STATE.areas = (p.get('area') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  STATE.priceMax = p.get('priceMax') || '';
  STATE.deliveryYearMax = p.get('deliveryYearMax') || '';
  STATE.bedsMin = p.get('bedsMin') || '';
  STATE.waterfront = p.get('waterfront') === 'true';
  STATE.shortTermRental = p.get('shortTermRental') === 'true';
  STATE.sort = p.get('sort') || 'price_low';
}
function syncControlsFromState() {
  setVal('pc-price', STATE.priceMax);
  setVal('pc-delivery', STATE.deliveryYearMax);
  setVal('pc-beds', STATE.bedsMin);
  setVal('pc-sort', STATE.sort);
  var wf = document.getElementById('pc-waterfront'); if (wf) wf.checked = STATE.waterfront;
  var str = document.getElementById('pc-str'); if (str) str.checked = STATE.shortTermRental;
}
function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v || ''; }

function buildQuery() {
  var p = new URLSearchParams();
  if (STATE.building) { p.set('building', STATE.building); return p; }
  if (STATE.areas.length) p.set('area', STATE.areas.join(','));
  if (STATE.priceMax) p.set('priceMax', STATE.priceMax);
  if (STATE.deliveryYearMax) p.set('deliveryYearMax', STATE.deliveryYearMax);
  if (STATE.bedsMin) p.set('bedsMin', STATE.bedsMin);
  if (STATE.waterfront) p.set('waterfront', 'true');
  if (STATE.shortTermRental) p.set('shortTermRental', 'true');
  if (STATE.sort && STATE.sort !== 'price_low') p.set('sort', STATE.sort);
  return p;
}
function pushURL() {
  var q = buildQuery().toString();
  history.replaceState(null, '', location.pathname + (q ? '?' + q : ''));
}

/* ---- controls ---- */
function wireControls() {
  bind('pc-price', function (v) { STATE.priceMax = v; });
  bind('pc-delivery', function (v) { STATE.deliveryYearMax = v; });
  bind('pc-beds', function (v) { STATE.bedsMin = v; });
  bind('pc-sort', function (v) { STATE.sort = v; });
  bindCheck('pc-waterfront', function (c) { STATE.waterfront = c; });
  bindCheck('pc-str', function (c) { STATE.shortTermRental = c; });
}
function bind(id, setter) {
  var el = document.getElementById(id);
  if (el) el.addEventListener('change', function () { STATE.building = ''; setter(el.value); fetchAndRender(); });
}
function bindCheck(id, setter) {
  var el = document.getElementById(id);
  if (el) el.addEventListener('change', function () { STATE.building = ''; setter(el.checked); fetchAndRender(); });
}

/* ---- area chips ---- */
var AREA_LIST = [];
function getAreaList() { return AREA_LIST; }
function buildAreaChips(areas) {
  AREA_LIST = areas || [];
  var wrap = document.getElementById('pc-area-chips');
  if (!wrap) return;
  wrap.innerHTML = AREA_LIST.map(function (a) {
    var on = STATE.areas.indexOf(a) !== -1;
    return '<button type="button" class="pc-area-chip' + (on ? ' active' : '') + '" data-area="' + esc(a) + '">' + esc(a) + '</button>';
  }).join('');
  wrap.querySelectorAll('.pc-area-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var a = chip.getAttribute('data-area');
      var i = STATE.areas.indexOf(a);
      if (i === -1) STATE.areas.push(a); else STATE.areas.splice(i, 1);
      chip.classList.toggle('active');
      STATE.building = '';
      fetchAndRender();
    });
  });
}

/* ---- fetch + render ---- */
var lastBuildings = [];
var lastCount = 0;
function fetchAndRender() {
  pushURL();
  // A ?building deep link fetches that single tower via the api's id= param.
  var url = STATE.building
    ? '/api/preconstructions?id=' + encodeURIComponent(STATE.building)
    : '/api/preconstructions' + (buildQuery().toString() ? '?' + buildQuery().toString() : '');
  fetch(url, { headers: { 'Accept': 'application/json' } })
    .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
    .then(function (data) {
      show('pc-error', false);
      if (!AREAS_BUILT && Array.isArray(data.areas)) { buildAreaChips(data.areas); AREAS_BUILT = true; }
      lastBuildings = data.buildings || [];
      lastCount = data.count || lastBuildings.length;
      renderCards(lastBuildings);
      renderCount(lastCount);
    })
    .catch(function () {
      show('pc-error', true);
      show('pc-empty', false);
      var grid = document.getElementById('pc-grid'); if (grid) grid.innerHTML = '';
      renderCount(0, true);
    });
}
function renderCards(buildings) {
  var grid = document.getElementById('pc-grid');
  if (!grid) return;
  grid.innerHTML = (buildings || []).map(buildCardHTML).join('');
  show('pc-empty', (buildings || []).length === 0);
}
function renderCount(n, hide) {
  var el = document.getElementById('pc-count');
  if (!el) return;
  if (hide) { el.textContent = ''; return; }
  el.textContent = t(n === 1 ? 'towersOne' : 'towersMany', { n: n });
}
function show(id, on) { var el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; }

/* ---- node export for self-test (harmless in the browser) ---- */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildCardHTML: buildCardHTML, esc: esc, formatPrice: formatPrice, bedsLabel: bedsLabel, waLink: waLink, t: t, I18N: I18N };
}
