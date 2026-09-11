#!/usr/bin/env node
/**
 * build-tower-pages.js — generates one static, indexable page per preconstruction tower.
 *
 * Source of truth is lib/preconstructions-data.js. Re-run after editing that file:
 *   node tools/build-tower-pages.js
 *
 * Output: tower/<id>.html (served at /tower/<id> — vercel.json cleanUrls) + a refreshed
 * sitemap.xml. Nothing here is hand-edited; edit the template below, never the output.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'tower');
const ORIGIN = 'https://www.homesinsoflorida.com';
const WA_NUMBER = '19542354046'; // Rosa Poler — point of contact for ALL preconstruction inquiries

const mod = await import(path.join(ROOT, 'lib', 'preconstructions-data.js'));
const TOWERS = mod.PRECONSTRUCTIONS || mod.default;

/* ── ES / PT (2026-09-10) ─────────────────────────────────────────────────────
   Kevin's leads are mostly Latin American and the on-page i18n toggle is JS
   Google can't index — so every tower is also emitted as a real URL:
     /tower/<id>        English  (unchanged)
     /tower/es/<id>     Spanish
     /tower/pt/<id>     Brazilian Portuguese
   Marketing copy per tower comes from lib/preconstructions-i18n.js (PRECON_I18N,
   keyed by language → tower id, same shape as the English fields); the page
   chrome comes from the L table below. All three pages cross-link with
   hreflang and share one canonical per language. */
const LANGS = ['en', 'es', 'pt'];
let PRECON_I18N = { es: {}, pt: {} };
try {
    const i18nMod = await import(path.join(ROOT, 'lib', 'preconstructions-i18n.js'));
    const got = i18nMod.PRECON_I18N || {};
    PRECON_I18N = { es: got.es || {}, pt: got.pt || {} }; // merge, never replace the safe default
} catch (e) {
    console.warn('lib/preconstructions-i18n.js not found — ES/PT pages will reuse English copy');
}
for (const lang of ['es', 'pt']) {
    const n = Object.keys(PRECON_I18N[lang]).length;
    if (n < TOWERS.length) {
        console.warn(`i18n ${lang}: ${n}/${TOWERS.length} towers translated — the rest ship English copy`);
    }
}

const L = {
    en: {
        titleTail: 'Preconstruction Prices & Floor Plans | The Poler Team',
        in: 'in', delivering: 'delivering', stories: 'stories', residences: 'residences',
        metaTail: 'Floor plans, deposit schedule, amenities and availability from The Poler Team.',
        waMsg: (name) => `Hi Rosa, I'm interested in ${name} preconstruction`,
        facts: { developer: 'Developer', architecture: 'Architecture', interiors: 'Interiors', address: 'Address',
                 stories: 'Stories', totalUnits: 'Total residences', sizes: 'Residence sizes', bedrooms: 'Bedrooms',
                 pricing: 'Pricing', ppsf: 'Price per sq ft', delivery: 'Delivery', views: 'Views',
                 waterfront: 'Waterfront', str: 'Short-term rentals', status: 'Construction status' },
        yes: 'Yes', allowed: 'Allowed', sqft: 'sq ft',
        bedroom: (n) => `${n} bedroom`, bedrooms: (a, b) => `${a}–${b} bedrooms`,
        about: (name) => `About ${name}`, glance: (name) => `${name} at a glance`,
        amenities: (name) => `Amenities at ${name}`, deposit: (name) => `${name} deposit schedule`,
        depositNote: 'Deposit structures are set by the developer and can change between release phases. Confirm the current schedule before signing — Rosa tracks these directly with the sales teams.',
        parking: 'Parking', related: (area) => `Other new developments near ${area}`,
        delivery: 'delivery', from: 'from', deliveryCap: 'Delivery',
        cta: (name) => `Ask about availability at ${name}`,
        ctaBody: "Inventory, current release pricing, and floor plans change weekly. Rosa Poler handles every preconstruction inquiry for The Poler Team directly with the developer's sales team.",
        waBtn: 'WhatsApp Rosa', crumbHome: 'Home', crumbPrecon: 'Preconstruction',
        back: '&larr; All South Florida preconstruction towers',
        footerNote: 'All preconstruction inquiries handled by Rosa Poler, The Poler Team &middot; Optimar International Realty.',
        nav: {},
    },
    es: {
        titleTail: 'Preconstrucción en Miami: Precios y Planos | The Poler Team',
        in: 'en', delivering: 'entrega', stories: 'pisos', residences: 'residencias',
        metaTail: 'Planos, plan de depósitos, amenidades y disponibilidad con The Poler Team.',
        waMsg: (name) => `Hola Rosa, me interesa la preconstrucción ${name}`,
        facts: { developer: 'Desarrollador', architecture: 'Arquitectura', interiors: 'Interiores', address: 'Dirección',
                 stories: 'Pisos', totalUnits: 'Total de residencias', sizes: 'Tamaños de residencias', bedrooms: 'Habitaciones',
                 pricing: 'Precios', ppsf: 'Precio por pie cuadrado', delivery: 'Entrega', views: 'Vistas',
                 waterfront: 'Frente al agua', str: 'Alquiler a corto plazo', status: 'Estado de la obra' },
        yes: 'Sí', allowed: 'Permitido', sqft: 'pies²',
        bedroom: (n) => `${n} habitación${n === 1 ? '' : 'es'}`, bedrooms: (a, b) => `${a} a ${b} habitaciones`,
        about: (name) => `Sobre ${name}`, glance: (name) => `${name} en resumen`,
        amenities: (name) => `Amenidades de ${name}`, deposit: (name) => `Plan de depósitos de ${name}`,
        depositNote: 'El plan de depósitos lo define el desarrollador y puede cambiar entre fases de venta. Confirma el plan vigente antes de firmar — Rosa lo verifica directamente con los equipos de ventas.',
        parking: 'Estacionamiento', related: (area) => `Otros nuevos desarrollos cerca de ${area}`,
        delivery: 'entrega', from: 'desde', deliveryCap: 'Entrega',
        cta: (name) => `Consulta disponibilidad en ${name}`,
        ctaBody: 'El inventario, los precios de la fase actual y los planos cambian cada semana. Rosa Poler atiende cada consulta de preconstrucción de The Poler Team directamente con el equipo de ventas del desarrollador.',
        waBtn: 'WhatsApp con Rosa', crumbHome: 'Inicio', crumbPrecon: 'Preconstrucción',
        back: '&larr; Todas las torres en preconstrucción del sur de Florida',
        footerNote: 'Todas las consultas de preconstrucción las atiende Rosa Poler, The Poler Team &middot; Optimar International Realty.',
        nav: { 'Home': 'Inicio', 'Listings': 'Propiedades', 'Preconstruction': 'Preconstrucción',
               'Short-Term Rentals': 'Alquileres Cortos', 'Home Valuation': 'Valoración', 'About': 'Nosotros' },
    },
    pt: {
        titleTail: 'Pré-construção em Miami: Preços e Plantas | The Poler Team',
        in: 'em', delivering: 'entrega', stories: 'andares', residences: 'residências',
        metaTail: 'Plantas, cronograma de depósitos, comodidades e disponibilidade com The Poler Team.',
        waMsg: (name) => `Oi Rosa, tenho interesse na pré-construção ${name}`,
        facts: { developer: 'Incorporadora', architecture: 'Arquitetura', interiors: 'Interiores', address: 'Endereço',
                 stories: 'Andares', totalUnits: 'Total de residências', sizes: 'Tamanhos das residências', bedrooms: 'Quartos',
                 pricing: 'Preços', ppsf: 'Preço por pé quadrado', delivery: 'Entrega', views: 'Vistas',
                 waterfront: 'Beira-mar', str: 'Aluguel de curta temporada', status: 'Status da obra' },
        yes: 'Sim', allowed: 'Permitido', sqft: 'pés²',
        bedroom: (n) => `${n} quarto${n === 1 ? '' : 's'}`, bedrooms: (a, b) => `${a} a ${b} quartos`,
        about: (name) => `Sobre ${name}`, glance: (name) => `${name} em resumo`,
        amenities: (name) => `Comodidades do ${name}`, deposit: (name) => `Cronograma de depósitos do ${name}`,
        depositNote: 'O cronograma de depósitos é definido pela incorporadora e pode mudar entre fases de venda. Confirme o cronograma vigente antes de assinar — Rosa acompanha isso diretamente com as equipes de vendas.',
        parking: 'Estacionamento', related: (area) => `Outros novos empreendimentos perto de ${area}`,
        delivery: 'entrega', from: 'a partir de', deliveryCap: 'Entrega',
        cta: (name) => `Consulte a disponibilidade no ${name}`,
        ctaBody: 'Estoque, preços da fase atual e plantas mudam toda semana. Rosa Poler cuida de cada consulta de pré-construção da The Poler Team diretamente com a equipe de vendas da incorporadora.',
        waBtn: 'WhatsApp com a Rosa', crumbHome: 'Início', crumbPrecon: 'Pré-construção',
        back: '&larr; Todas as torres em pré-construção do sul da Flórida',
        footerNote: 'Todas as consultas de pré-construção são atendidas por Rosa Poler, The Poler Team &middot; Optimar International Realty.',
        nav: { 'Home': 'Início', 'Listings': 'Imóveis', 'Preconstruction': 'Pré-construção',
               'Short-Term Rentals': 'Aluguéis Curtos', 'Home Valuation': 'Avaliação', 'About': 'Sobre' },
    },
};

// Tower fields with a translation take the translated value; everything else
// (numbers, names, developers, photos) is shared across languages.
function localizeTower(t, lang) {
    if (lang === 'en') return t;
    const tr = (PRECON_I18N[lang] || {})[t.id] || {};
    return Object.assign({}, t, tr, { id: t.id, name: t.name });
}
const towerPath = (id, lang) => lang === 'en' ? `/tower/${id}` : `/tower/${lang}/${id}`;

const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* JSON-LD lives inside a <script> block, where the HTML parser ends the block at the
   first literal "</script>" — even inside a JSON string. Escaping "<" defuses that
   (and the " / " pair keeps older JS parsers happy). */
const jsonLdSafe = (obj) => JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

const money = (n) => {
    if (!n) return '';
    return n >= 1000000 ? '$' + (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + 'M'
                        : '$' + Math.round(n / 1000) + 'K';
};

const bedLabel = (beds, U) => {
    if (!Array.isArray(beds) || !beds.length) return '';
    const min = Math.min(...beds), max = Math.max(...beds);
    return min === max ? U.bedroom(min) : U.bedrooms(min, max);
};

// Nav lifted from preconstruction.html is English; swap the link labels per language.
const navFor = (lang) => {
    const map = L[lang].nav;
    return NAV.replace(/class="lp-nav-link( active)?">([^<]+)</g, (m, act, label) =>
        `class="lp-nav-link${act || ''}">${map[label] || label}<`);
};

/* ── Nav + footer lifted from preconstruction.html so tower pages read as native ── */
const NAV = `    <header class="lp-header">
        <nav class="lp-nav">
            <div class="lp-nav-inner">
                <a href="/" class="lp-logo-link">
                    <img src="/logo-white.png" alt="The Poler Team" class="lp-nav-logo">
                </a>
                <div class="lp-nav-links">
                    <a href="/" class="lp-nav-link">Home</a>
                    <a href="/listing" class="lp-nav-link">Listings</a>
                    <a href="/preconstruction" class="lp-nav-link active">Preconstruction</a>
                    <a href="/str" class="lp-nav-link">Short-Term Rentals</a>
                    <a href="/home-valuation" class="lp-nav-link">Home Valuation</a>
                    <a href="/#hp-meet" class="lp-nav-link">About</a>
                    <a href="tel:+19542354046" class="lp-nav-link lp-nav-phone">(954) 235-4046</a>
                </div>
            </div>
        </nav>
    </header>`;

const FOOTER_NOTE_EN = 'All preconstruction inquiries handled by Rosa Poler, The Poler Team &middot; Optimar International Realty.';
const FOOTER = `<footer class="pc-footer">
    <p>The Poler Team &nbsp;|&nbsp; <a href="/">homesinsoflorida.com</a> &nbsp;|&nbsp; <a href="tel:+13057997290">(305) 799-7290</a></p>
    <p class="tw-footer-note">${FOOTER_NOTE_EN}</p>
</footer>`;

/* ── Per-tower page ─────────────────────────────────────────────────────────── */
function renderTower(src, all, lang = 'en') {
    const U = L[lang];
    const t = localizeTower(src, lang);
    const url = ORIGIN + towerPath(t.id, lang);
    // Several towers carry area === city (e.g. Sunny Isles Beach) — dedupe so the
    // title doesn't read "Sunny Isles Beach, Sunny Isles Beach".
    const where = [...new Set([t.area, t.city].filter(Boolean))].join(', ');
    const priceStr = t.priceFrom ? `${U.from} ${money(t.priceFrom)}` : '';

    // Title targets the real query shape: "<tower name> <city> preconstruction"
    const title = lang === 'en'
        ? `${t.name} — ${where} Preconstruction Prices & Floor Plans | The Poler Team`
        : `${t.name} — ${where} · ${U.titleTail}`;

    // Meta description built from this tower's own facts, never a fixed template string
    const metaBits = [
        `${t.name} ${U.in} ${where}`,
        t.deliveryLabel ? `${U.delivering} ${t.deliveryLabel}` : '',
        t.pricingFrom || priceStr,
        t.stories ? `${t.stories} ${U.stories}` : '',
        t.totalUnits ? `${t.totalUnits} ${U.residences}` : '',
    ].filter(Boolean);
    const metaDesc = (metaBits.join(' · ') + '. ' + U.metaTail).slice(0, 320);

    const hero = (t.photos && t.photos[0]) || '';
    const waMsg = U.waMsg(t.name);
    const waUrl = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(waMsg)}`;

    /* Fast-facts rows — only render a row when this tower actually has the datum,
       so pages differ structurally, not just by swapped words. */
    const F = U.facts;
    const facts = [
        [F.developer, t.developer],
        [F.architecture, t.architecture],
        [F.interiors, t.interiors],
        [F.address, t.address],
        [F.stories, t.stories],
        [F.totalUnits, t.totalUnits],
        [F.sizes, (t.sqftMin && t.sqftMax) ? `${t.sqftMin.toLocaleString()}–${t.sqftMax.toLocaleString()} ${U.sqft}` : ''],
        [F.bedrooms, bedLabel(t.bedrooms, U)],
        [F.pricing, t.pricingFrom],
        [F.ppsf, t.pricePerSqft ? `$${t.pricePerSqft.toLocaleString()}` : ''],
        [F.delivery, t.deliveryLabel],
        [F.views, t.views],
        [F.waterfront, t.waterfront ? U.yes : ''],
        [F.str, t.shortTermRental ? U.allowed : ''],
        [F.status, t.constructionStatus],
    ].filter(([, v]) => v !== '' && v != null);

    const factRows = facts.map(([k, v]) =>
        `      <div class="tw-fact"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('\n');

    const amenities = (t.amenities || []).length
        ? `  <section class="tw-section" id="amenities">
    <h2>${esc(U.amenities(t.name))}</h2>
    <ul class="tw-amenities">
${t.amenities.map(a => `      <li>${esc(a)}</li>`).join('\n')}
    </ul>
  </section>` : '';

    const deposit = t.deposit
        ? `  <section class="tw-section" id="deposit">
    <h2>${esc(U.deposit(t.name))}</h2>
    <p class="tw-deposit">${esc(t.deposit)}</p>
    <p class="tw-note">${esc(U.depositNote)}</p>
  </section>` : '';

    const parking = t.parkingSpaces
        ? `  <section class="tw-section" id="parking">
    <h2>${esc(U.parking)}</h2>
    <p>${esc(t.parkingSpaces)}</p>
  </section>` : '';

    // Related towers: same area first, then same city — real internal linking, no orphans
    const related = all.filter(o => o.id !== t.id)
        .map(o => ({ o, score: (o.area === t.area ? 2 : 0) + (o.city === t.city ? 1 : 0) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score || (a.o.priceFrom || 0) - (b.o.priceFrom || 0))
        .slice(0, 6).map(x => x.o);

    const relatedBlock = related.length
        ? `  <section class="tw-section" id="related">
    <h2>${esc(U.related(t.area || t.city))}</h2>
    <ul class="tw-related">
${related.map(r => `      <li><a href="${esc(towerPath(r.id, lang))}">${esc(r.name)}</a> <span>${esc([r.area, r.deliveryLabel && U.delivery + ' ' + r.deliveryLabel, r.priceFrom && U.from + ' ' + money(r.priceFrom)].filter(Boolean).join(' · '))}</span></li>`).join('\n')}
    </ul>
  </section>` : '';

    /* Structured data: the tower itself + breadcrumb trail */
    const jsonld = {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': ['Residence', 'Product'],
                '@id': url + '#tower',
                name: t.name,
                url,
                description: t.description || metaDesc,
                ...(hero ? { image: t.photos.slice(0, 6) } : {}),
                address: {
                    '@type': 'PostalAddress',
                    ...(t.address ? { streetAddress: t.address } : {}),
                    addressLocality: t.city,
                    addressRegion: 'FL',
                    addressCountry: 'US',
                },
                ...(t.totalUnits ? { numberOfAccommodationUnits: t.totalUnits } : {}),
                ...(t.priceFrom ? {
                    offers: {
                        '@type': 'AggregateOffer',
                        priceCurrency: 'USD',
                        lowPrice: t.priceFrom,
                        availability: 'https://schema.org/PreOrder',
                        offeredBy: { '@type': 'RealEstateAgent', name: 'The Poler Team', telephone: '+1-954-235-4046' },
                    },
                } : {}),
            },
            {
                '@type': 'BreadcrumbList',
                itemListElement: [
                    { '@type': 'ListItem', position: 1, name: U.crumbHome, item: ORIGIN + '/' },
                    { '@type': 'ListItem', position: 2, name: U.crumbPrecon, item: ORIGIN + '/preconstruction' },
                    { '@type': 'ListItem', position: 3, name: t.name, item: url },
                ],
            },
        ],
    };

    const hreflang = LANGS.map(l => `<link rel="alternate" hreflang="${l}" href="${ORIGIN}${towerPath(t.id, l)}">`).join('\n')
        + `\n<link rel="alternate" hreflang="x-default" href="${ORIGIN}${towerPath(t.id, 'en')}">`;

    return `<!DOCTYPE html>
<html lang="${lang === 'pt' ? 'pt-BR' : lang}">
<head>
<!-- Google Analytics 4 + Google Ads -->
<script src="/analytics.js"></script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(metaDesc)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${url}">
${hreflang}
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(metaDesc)}">
<meta property="og:url" content="${url}">
${hero ? `<meta property="og:image" content="${esc(hero)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/preconstruction.css">
<link rel="stylesheet" href="/tower.css">
<script type="application/ld+json">${jsonLdSafe(jsonld)}</script>
</head>
<body>
${navFor(lang)}

<nav class="tw-crumbs" aria-label="Breadcrumb">
  <a href="/">${esc(U.crumbHome)}</a> <span>/</span> <a href="/preconstruction${lang === 'en' ? '' : '?lang=' + lang}">${esc(U.crumbPrecon)}</a> <span>/</span> <span aria-current="page">${esc(t.name)}</span>
</nav>

<main class="tw-main">
  <header class="tw-hero">
    ${t.badge ? `<span class="tw-badge">${esc(t.badge)}</span>` : ''}
    <h1>${esc(t.name)}</h1>
    <p class="tw-sub">${esc([where, t.deliveryLabel && `${U.deliveryCap} ${t.deliveryLabel}`, t.pricingFrom].filter(Boolean).join(' · '))}</p>
  </header>

  ${hero ? `<img class="tw-photo" src="${esc(hero)}" alt="${esc(t.name)} ${U.in} ${esc(where)}" loading="eager" width="1200" height="700">` : ''}

  ${t.description ? `  <section class="tw-section" id="overview">
    <h2>${esc(U.about(t.name))}</h2>
    <p class="tw-lede">${esc(t.description)}</p>
  </section>` : ''}

  <section class="tw-section" id="facts">
    <h2>${esc(U.glance(t.name))}</h2>
    <dl class="tw-facts">
${factRows}
    </dl>
  </section>

${amenities}

${deposit}

${parking}

  <section class="tw-cta" id="inquire">
    <h2>${esc(U.cta(t.name))}</h2>
    <p>${esc(U.ctaBody)}</p>
    <div class="tw-cta-row">
      <a class="tw-btn tw-btn-primary" href="${esc(waUrl)}" rel="noopener">${esc(U.waBtn)}</a>
      <a class="tw-btn" href="tel:+19542354046">(954) 235-4046</a>
    </div>
  </section>

${relatedBlock}

  <p class="tw-back"><a href="/preconstruction${lang === 'en' ? '' : '?lang=' + lang}">${U.back}</a></p>
</main>

${FOOTER.replace(FOOTER_NOTE_EN, U.footerNote)}
<script src="/lead-gate.js" defer></script>
<script src="/nav.js" defer></script>
</body>
</html>
`;
}

/* ── Sitemap: every public page, tower pages included ────────────────────────── */
function renderSitemap(towers) {
    const statics = [
        ['/', 'weekly', '1.0'],
        ['/listing', 'daily', '0.9'],
        ['/preconstruction', 'weekly', '0.9'],
        ['/str', 'monthly', '0.7'],
        ['/home-valuation', 'monthly', '0.6'],
        ['/privacy', 'yearly', '0.2'],
        ['/terms', 'yearly', '0.2'],
    ];
    const urls = statics.map(([p, cf, pr]) =>
        `  <url>\n    <loc>${ORIGIN}${p}</loc>\n    <changefreq>${cf}</changefreq>\n    <priority>${pr}</priority>\n  </url>`);
    // One <url> per language per tower, each listing all three as xhtml alternates
    towers.forEach(t => LANGS.forEach(lang => {
        const alts = LANGS.map(l => `    <xhtml:link rel="alternate" hreflang="${l}" href="${ORIGIN}${towerPath(t.id, l)}"/>`)
            .concat([`    <xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}${towerPath(t.id, 'en')}"/>`]).join('\n');
        urls.push(`  <url>\n    <loc>${ORIGIN}${towerPath(t.id, lang)}</loc>\n${alts}\n    <changefreq>monthly</changefreq>\n    <priority>${lang === 'en' ? '0.8' : '0.7'}</priority>\n  </url>`);
    }));
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
}

/* ── Run ────────────────────────────────────────────────────────────────────── */
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const lang of LANGS) if (lang !== 'en') fs.mkdirSync(path.join(OUT_DIR, lang), { recursive: true });

const seen = new Set();
let written = 0;
for (const t of TOWERS) {
    if (!t.id || !t.name) { console.warn('SKIP (missing id/name):', JSON.stringify(t).slice(0, 80)); continue; }
    if (seen.has(t.id)) { console.warn('SKIP (duplicate id):', t.id); continue; }
    seen.add(t.id);
    for (const lang of LANGS) {
        const file = lang === 'en' ? path.join(OUT_DIR, `${t.id}.html`) : path.join(OUT_DIR, lang, `${t.id}.html`);
        fs.writeFileSync(file, renderTower(t, TOWERS, lang));
        written++;
    }
}

fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), renderSitemap(TOWERS.filter(t => seen.has(t.id))));

console.log(`Wrote ${written} tower pages to tower/ (${seen.size} towers × ${LANGS.length} languages)`);
console.log(`Sitemap: ${seen.size * LANGS.length + 7} URLs`);
