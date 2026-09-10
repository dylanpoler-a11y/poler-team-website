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

const bedLabel = (beds) => {
    if (!Array.isArray(beds) || !beds.length) return '';
    const min = Math.min(...beds), max = Math.max(...beds);
    return min === max ? `${min} bedroom` : `${min}–${max} bedrooms`;
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

const FOOTER = `<footer class="pc-footer">
    <p>The Poler Team &nbsp;|&nbsp; <a href="/">homesinsoflorida.com</a> &nbsp;|&nbsp; <a href="tel:+13057997290">(305) 799-7290</a></p>
    <p class="tw-footer-note">All preconstruction inquiries handled by Rosa Poler, The Poler Team &middot; Optimar International Realty.</p>
</footer>`;

/* ── Per-tower page ─────────────────────────────────────────────────────────── */
function renderTower(t, all) {
    const url = `${ORIGIN}/tower/${t.id}`;
    // Several towers carry area === city (e.g. Sunny Isles Beach) — dedupe so the
    // title doesn't read "Sunny Isles Beach, Sunny Isles Beach".
    const where = [...new Set([t.area, t.city].filter(Boolean))].join(', ');
    const priceStr = t.priceFrom ? `from ${money(t.priceFrom)}` : '';

    // Title targets the real query shape: "<tower name> <city> preconstruction"
    const title = `${t.name} — ${where} Preconstruction Prices & Floor Plans | The Poler Team`;

    // Meta description built from this tower's own facts, never a fixed template string
    const metaBits = [
        `${t.name} in ${where}`,
        t.deliveryLabel ? `delivering ${t.deliveryLabel}` : '',
        t.pricingFrom || priceStr,
        t.stories ? `${t.stories} stories` : '',
        t.totalUnits ? `${t.totalUnits} residences` : '',
    ].filter(Boolean);
    const metaDesc = (metaBits.join(' · ') + '. Floor plans, deposit schedule, amenities and availability from The Poler Team.').slice(0, 320);

    const hero = (t.photos && t.photos[0]) || '';
    const waMsg = `Hi Rosa, I'm interested in ${t.name} preconstruction`;
    const waUrl = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(waMsg)}`;

    /* Fast-facts rows — only render a row when this tower actually has the datum,
       so pages differ structurally, not just by swapped words. */
    const facts = [
        ['Developer', t.developer],
        ['Architecture', t.architecture],
        ['Interiors', t.interiors],
        ['Address', t.address],
        ['Stories', t.stories],
        ['Total residences', t.totalUnits],
        ['Residence sizes', (t.sqftMin && t.sqftMax) ? `${t.sqftMin.toLocaleString()}–${t.sqftMax.toLocaleString()} sq ft` : ''],
        ['Bedrooms', bedLabel(t.bedrooms)],
        ['Pricing', t.pricingFrom],
        ['Price per sq ft', t.pricePerSqft ? `$${t.pricePerSqft.toLocaleString()}` : ''],
        ['Delivery', t.deliveryLabel],
        ['Views', t.views],
        ['Waterfront', t.waterfront ? 'Yes' : ''],
        ['Short-term rentals', t.shortTermRental ? 'Allowed' : ''],
        ['Construction status', t.constructionStatus],
    ].filter(([, v]) => v !== '' && v != null);

    const factRows = facts.map(([k, v]) =>
        `      <div class="tw-fact"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('\n');

    const amenities = (t.amenities || []).length
        ? `  <section class="tw-section" id="amenities">
    <h2>Amenities at ${esc(t.name)}</h2>
    <ul class="tw-amenities">
${t.amenities.map(a => `      <li>${esc(a)}</li>`).join('\n')}
    </ul>
  </section>` : '';

    const deposit = t.deposit
        ? `  <section class="tw-section" id="deposit">
    <h2>${esc(t.name)} deposit schedule</h2>
    <p class="tw-deposit">${esc(t.deposit)}</p>
    <p class="tw-note">Deposit structures are set by the developer and can change between release phases. Confirm the current schedule before signing — Rosa tracks these directly with the sales teams.</p>
  </section>` : '';

    const parking = t.parkingSpaces
        ? `  <section class="tw-section" id="parking">
    <h2>Parking</h2>
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
    <h2>Other new developments near ${esc(t.area || t.city)}</h2>
    <ul class="tw-related">
${related.map(r => `      <li><a href="/tower/${esc(r.id)}">${esc(r.name)}</a> <span>${esc([r.area, r.deliveryLabel && 'delivery ' + r.deliveryLabel, r.priceFrom && 'from ' + money(r.priceFrom)].filter(Boolean).join(' · '))}</span></li>`).join('\n')}
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
                    { '@type': 'ListItem', position: 1, name: 'Home', item: ORIGIN + '/' },
                    { '@type': 'ListItem', position: 2, name: 'Preconstruction', item: ORIGIN + '/preconstruction' },
                    { '@type': 'ListItem', position: 3, name: t.name, item: url },
                ],
            },
        ],
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(metaDesc)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${url}">
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
${NAV}

<nav class="tw-crumbs" aria-label="Breadcrumb">
  <a href="/">Home</a> <span>/</span> <a href="/preconstruction">Preconstruction</a> <span>/</span> <span aria-current="page">${esc(t.name)}</span>
</nav>

<main class="tw-main">
  <header class="tw-hero">
    ${t.badge ? `<span class="tw-badge">${esc(t.badge)}</span>` : ''}
    <h1>${esc(t.name)}</h1>
    <p class="tw-sub">${esc([where, t.deliveryLabel && `Delivery ${t.deliveryLabel}`, t.pricingFrom].filter(Boolean).join(' · '))}</p>
  </header>

  ${hero ? `<img class="tw-photo" src="${esc(hero)}" alt="${esc(t.name)} in ${esc(where)}" loading="eager" width="1200" height="700">` : ''}

  ${t.description ? `  <section class="tw-section" id="overview">
    <h2>About ${esc(t.name)}</h2>
    <p class="tw-lede">${esc(t.description)}</p>
  </section>` : ''}

  <section class="tw-section" id="facts">
    <h2>${esc(t.name)} at a glance</h2>
    <dl class="tw-facts">
${factRows}
    </dl>
  </section>

${amenities}

${deposit}

${parking}

  <section class="tw-cta" id="inquire">
    <h2>Ask about availability at ${esc(t.name)}</h2>
    <p>Inventory, current release pricing, and floor plans change weekly. Rosa Poler handles every preconstruction inquiry for The Poler Team directly with the developer's sales team.</p>
    <div class="tw-cta-row">
      <a class="tw-btn tw-btn-primary" href="${esc(waUrl)}" rel="noopener">WhatsApp Rosa</a>
      <a class="tw-btn" href="tel:+19542354046">(954) 235-4046</a>
    </div>
  </section>

${relatedBlock}

  <p class="tw-back"><a href="/preconstruction">&larr; All South Florida preconstruction towers</a></p>
</main>

${FOOTER}
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
    towers.forEach(t => urls.push(
        `  <url>\n    <loc>${ORIGIN}/tower/${t.id}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>`));
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/* ── Run ────────────────────────────────────────────────────────────────────── */
fs.mkdirSync(OUT_DIR, { recursive: true });

const seen = new Set();
let written = 0;
for (const t of TOWERS) {
    if (!t.id || !t.name) { console.warn('SKIP (missing id/name):', JSON.stringify(t).slice(0, 80)); continue; }
    if (seen.has(t.id)) { console.warn('SKIP (duplicate id):', t.id); continue; }
    seen.add(t.id);
    fs.writeFileSync(path.join(OUT_DIR, `${t.id}.html`), renderTower(t, TOWERS));
    written++;
}

fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), renderSitemap(TOWERS.filter(t => seen.has(t.id))));

console.log(`Wrote ${written} tower pages to tower/`);
console.log(`Sitemap: ${seen.size + 7} URLs`);
