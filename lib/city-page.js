/**
 * lib/city-page.js — renders one indexable per-city landing page
 * (/<slug>, e.g. /sunny-isles-beach-condos-for-sale) from a city entry in
 * lib/cities-data.js + live Bridge MLS data supplied by api/city.js.
 *
 * Pure: no I/O. Everything Google needs (title, canonical, H1, listings,
 * FAQ, JSON-LD) is in the HTML string — nothing waits on client JS.
 *
 * Nav + footer are copied from tools/build-tower-pages.js so the page reads as
 * native. Keep the NAV block in sync with that file (same rule tower.css
 * follows for the nav sizing).
 */

export const ORIGIN = 'https://www.homesinsoflorida.com';
const WA_NUMBER = '19542354046'; // Rosa Poler — same WhatsApp the listing page footer uses
const PHONE_DISPLAY = '(954) 235-4046';
const PHONE_TEL = '+19542354046';

export const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// JSON-LD inside <script>: escape "<" so a literal "</script>" in data can't end the block.
const jsonLdSafe = (obj) => JSON.stringify(obj)
    .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const num = (n) => Number(n || 0).toLocaleString('en-US');
const money = (n) => {
    if (!n) return '';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 2).replace(/\.?0+$/, '') + 'M';
    return '$' + num(Math.round(n));
};
const moneyFull = (n) => n ? '$' + num(Math.round(n)) : '';

const NAV = `    <header class="lp-header">
        <nav class="lp-nav">
            <div class="lp-nav-inner">
                <a href="/" class="lp-logo-link">
                    <img src="/logo-white.png" alt="The Poler Team" class="lp-nav-logo">
                </a>
                <div class="lp-nav-links">
                    <a href="/" class="lp-nav-link">Home</a>
                    <a href="/listing" class="lp-nav-link active">Listings</a>
                    <a href="/preconstruction" class="lp-nav-link">Preconstruction</a>
                    <a href="/str" class="lp-nav-link">Short-Term Rentals</a>
                    <a href="/home-valuation" class="lp-nav-link">Home Valuation</a>
                    <a href="/#hp-meet" class="lp-nav-link">About</a>
                    <a href="tel:${PHONE_TEL}" class="lp-nav-link lp-nav-phone">${PHONE_DISPLAY}</a>
                </div>
            </div>
        </nav>
    </header>`;

const FOOTER = `<footer class="pc-footer">
    <p>The Poler Team &nbsp;|&nbsp; <a href="/">homesinsoflorida.com</a> &nbsp;|&nbsp; <a href="tel:+13057997290">(305) 799-7290</a></p>
    <p class="tw-footer-note">The Poler Team &middot; Optimar International Realty &middot; 18246 Collins Ave, Sunny Isles Beach, FL 33160. Listing data from the Miami Association of REALTORS&reg; MLS, refreshed throughout the day; every listing is presented with the listing broker's consent.</p>
</footer>`;

/* ── Listing helpers ─────────────────────────────────────────────────────── */
function photoOf(l) {
    const m = Array.isArray(l.Media) ? l.Media : [];
    const first = m.find(p => p && p.MediaURL && (!p.MediaCategory || /photo/i.test(p.MediaCategory))) || m[0];
    return first && first.MediaURL ? first.MediaURL : '';
}
const subtypeLabel = (s) => {
    s = String(s || '');
    if (/condo/i.test(s)) return 'Condo';
    if (/single family/i.test(s)) return 'House';
    if (/townhouse/i.test(s)) return 'Townhouse';
    if (/hotel/i.test(s)) return 'Condo-hotel';
    if (/villa/i.test(s)) return 'Villa';
    return s || 'Residence';
};
const isHouse = (s) => /single family|villa/i.test(String(s || ''));
const isCondo = (s) => /condo|townhouse|hotel/i.test(String(s || ''));

function statsLine(l) {
    const bits = [];
    if (l.BedroomsTotal != null) bits.push(`${l.BedroomsTotal === 0 ? 'Studio' : l.BedroomsTotal + ' bd'}`);
    if (l.BathroomsTotalInteger) bits.push(`${l.BathroomsTotalInteger} ba`);
    if (l.LivingArea) bits.push(`${num(l.LivingArea)} sq ft`);
    return bits.join(' · ');
}

function renderCard(l, city) {
    const photo = photoOf(l);
    const addr = l.UnparsedAddress || `${city.name}, FL`;
    const id = l.ListingId || '';
    const href = `/listing?mls=${encodeURIComponent(id)}`;
    const label = subtypeLabel(l.PropertySubType);
    const bldg = l.BuildingName && !/^\s*$/.test(l.BuildingName) ? l.BuildingName : '';
    const alt = `${label} for sale at ${addr}`;
    return `      <a class="cp-card" href="${esc(href)}">
        <div class="cp-card-media">${photo
            ? `<img src="${esc(photo)}" alt="${esc(alt)}" loading="lazy" width="640" height="440">`
            : '<div class="cp-card-ph"></div>'}<span class="cp-card-type">${esc(label)}${l.WaterfrontYN ? ' · Waterfront' : ''}</span></div>
        <div class="cp-card-body">
          <div class="cp-card-price">${esc(moneyFull(l.ListPrice))}</div>
          <div class="cp-card-stats">${esc(statsLine(l))}</div>
          <div class="cp-card-addr">${esc(addr)}</div>
          ${bldg ? `<div class="cp-card-bldg">${esc(bldg)}</div>` : ''}
        </div>
      </a>`;
}

/* ── Market snapshot from a sample of active listings ───────────────────── */
export function computeStats(sample, totals) {
    const prices = sample.map(l => Number(l.ListPrice)).filter(p => p > 0).sort((a, b) => a - b);
    const ppsf = sample.filter(l => l.ListPrice > 0 && l.LivingArea > 200).map(l => l.ListPrice / l.LivingArea).sort((a, b) => a - b);
    const median = (arr) => arr.length ? (arr.length % 2 ? arr[(arr.length - 1) / 2] : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2) : 0;
    return {
        total: totals.sale || sample.length,
        rentals: totals.rent || 0,
        sampleSize: sample.length,
        min: prices[0] || 0,
        max: prices[prices.length - 1] || 0,
        median: median(prices),
        medianPpsf: median(ppsf),
        condos: sample.filter(l => isCondo(l.PropertySubType)).length,
        houses: sample.filter(l => isHouse(l.PropertySubType)).length,
        waterfront: sample.filter(l => l.WaterfrontYN === true).length,
        under500: sample.filter(l => l.ListPrice > 0 && l.ListPrice < 500000).length,
        over2m: sample.filter(l => l.ListPrice >= 2000000).length,
    };
}

/* ── Page ────────────────────────────────────────────────────────────────── */
export function renderCityPage({ city, listings = [], stats, towers = [], allCities = [], generatedAt = new Date() }) {
    const url = `${ORIGIN}/${city.slug}`;
    const title = `${city.name} ${city.titleTail} | The Poler Team`;
    const h1 = `${city.name} Condos for Sale`;
    const s = stats || computeStats(listings, {});
    const hasData = listings.length > 0;

    const metaDesc = hasData
        ? `${num(s.total)} condos, apartments and homes for sale in ${city.name}, FL right now, from ${money(s.min)} to ${money(s.max)} (median ${money(s.median)}). Live MLS listings, buildings guide and new construction from The Poler Team, based in Sunny Isles Beach.`
        : `Condos, apartments and homes for sale in ${city.name}, FL. Live MLS listings, neighborhoods guide, new construction and buyer FAQ from The Poler Team, based in Sunny Isles Beach.`;

    // Hero pick: curated asset (cities-data.js) → newest waterfront MLS cover photo →
    // any MLS cover photo. Tower renderings are NOT used: third-party sources watermark them.
    const hero = (listings.find(l => l.WaterfrontYN && photoOf(l)) || listings.find(l => photoOf(l)));
    const heroImg = city.heroImage || (hero ? photoOf(hero) : '') || '';
    const heroAbs = heroImg && heroImg.startsWith('/') ? ORIGIN + heroImg : heroImg;
    const heroVideo = city.heroVideo || '';

    const searchUrl = `/listing?city=${encodeURIComponent(city.bridgeCity)}`;
    const waUrl = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(`Hi Rosa, I'm looking at ${city.name} condos for sale on homesinsoflorida.com`)}`;

    const kpis = hasData ? [
        [num(s.total), 'active listings'],
        [money(s.median), 'median asking price'],
        [s.medianPpsf ? '$' + num(Math.round(s.medianPpsf)) : '—', 'median price / sq ft'],
        [`${money(s.min)} – ${money(s.max)}`, 'price range'],
    ] : [];

    const snapshotRows = hasData ? [
        ['Active listings for sale', num(s.total)],
        ['Active rentals', s.rentals ? num(s.rentals) : '—'],
        ['Median asking price', moneyFull(s.median)],
        ['Median price per sq ft', s.medianPpsf ? '$' + num(Math.round(s.medianPpsf)) : '—'],
        ['Lowest / highest asking price', `${moneyFull(s.min)} / ${moneyFull(s.max)}`],
        [`Condos vs houses (of the ${num(s.sampleSize)} newest)`, `${num(s.condos)} condos · ${num(s.houses)} houses`],
        [`Waterfront (of the ${num(s.sampleSize)} newest)`, num(s.waterfront)],
        [`Under $500K / over $2M (of the ${num(s.sampleSize)} newest)`, `${num(s.under500)} / ${num(s.over2m)}`],
    ] : [];

    const towerBlock = towers.length ? `
  <section class="cp-section" id="new-construction">
    <div class="cp-wrap">
      <h2>New construction in and around ${esc(city.name)}</h2>
      <p class="cp-lede">Preconstruction towers we track release by release, with current pricing, floor plans and deposit schedules.</p>
      <ul class="cp-towers">
${towers.map(t => `        <li><a href="/tower/${esc(t.id)}">${esc(t.name)}</a><span>${esc([t.area !== t.city ? t.area : '', t.city, t.deliveryLabel ? 'delivery ' + t.deliveryLabel : '', t.pricingFrom || ''].filter(Boolean).join(' · '))}</span></li>`).join('\n')}
      </ul>
      <p><a class="cp-link" href="/preconstruction">All South Florida preconstruction &rarr;</a></p>
    </div>
  </section>` : '';

    const others = allCities.filter(c => c.slug !== city.slug);
    const othersBlock = others.length ? `
  <section class="cp-section" id="more-areas">
    <div class="cp-wrap">
      <h2>More South Florida areas</h2>
      <ul class="cp-areas">
${others.map(c => `        <li><a href="/${esc(c.slug)}">${esc(c.name)} condos for sale</a></li>`).join('\n')}
        <li><a href="/listing">All South Florida listings</a></li>
        <li><a href="/str">Buildings that allow short-term rentals</a></li>
      </ul>
    </div>
  </section>` : '';

    const jsonld = {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'WebPage',
                '@id': url + '#page',
                url,
                name: title,
                description: metaDesc,
                isPartOf: { '@type': 'WebSite', name: 'The Poler Team', url: ORIGIN + '/' },
                about: { '@type': 'City', name: city.name, containedInPlace: { '@type': 'AdministrativeArea', name: city.county + ', Florida' } },
                ...(heroAbs ? { primaryImageOfPage: heroAbs } : {}),
                dateModified: generatedAt.toISOString(),
            },
            {
                '@type': 'RealEstateAgent',
                '@id': ORIGIN + '/#agent',
                name: 'The Poler Team',
                url: ORIGIN + '/',
                telephone: '+1-954-235-4046',
                address: { '@type': 'PostalAddress', streetAddress: '18246 Collins Ave', addressLocality: 'Sunny Isles Beach', addressRegion: 'FL', postalCode: '33160', addressCountry: 'US' },
                parentOrganization: { '@type': 'Organization', name: 'Optimar International Realty' },
                areaServed: [{ '@type': 'City', name: city.name }],
            },
            {
                '@type': 'BreadcrumbList',
                itemListElement: [
                    { '@type': 'ListItem', position: 1, name: 'Home', item: ORIGIN + '/' },
                    { '@type': 'ListItem', position: 2, name: 'Listings', item: ORIGIN + '/listing' },
                    { '@type': 'ListItem', position: 3, name: h1, item: url },
                ],
            },
            ...(hasData ? [{
                '@type': 'ItemList',
                name: `Newest ${city.name} listings`,
                numberOfItems: listings.length,
                itemListElement: listings.map((l, i) => ({
                    '@type': 'ListItem', position: i + 1,
                    url: `${ORIGIN}/listing?mls=${encodeURIComponent(l.ListingId || '')}`,
                    name: l.UnparsedAddress || `${city.name} ${subtypeLabel(l.PropertySubType)}`,
                    ...(photoOf(l) ? { image: photoOf(l) } : {}),
                })),
            }] : []),
            {
                '@type': 'FAQPage',
                mainEntity: city.faq.map(f => ({
                    '@type': 'Question', name: f.q,
                    acceptedAnswer: { '@type': 'Answer', text: f.a },
                })),
            },
        ],
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
<!-- Google Analytics 4 + Google Ads -->
<script src="/analytics.js"></script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(metaDesc)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(metaDesc)}">
<meta property="og:url" content="${url}">
${heroAbs ? `<meta property="og:image" content="${esc(heroAbs)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="geo.region" content="US-FL">
<meta name="geo.placename" content="${esc(city.name)}">
<meta name="geo.position" content="${city.lat};${city.lng}">
<link rel="icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preconnect" href="https://dvvjkgh94f2v6.cloudfront.net">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/preconstruction.css">
<link rel="stylesheet" href="/tower.css">
<link rel="stylesheet" href="/city.css">
${heroImg ? `<link rel="preload" as="image" href="${esc(heroImg)}" fetchpriority="high">` : ''}
<script type="application/ld+json">${jsonLdSafe(jsonld)}</script>
</head>
<body class="cp-body">
${NAV}

<main class="cp-main">
  <header class="cp-hero${heroImg ? '' : ' cp-hero-plain'}"${heroImg ? ` style="--cp-hero-img:url('${esc(heroImg)}')"` : ''}>
    ${heroVideo ? `<video class="cp-hero-video" autoplay muted loop playsinline preload="metadata"${heroImg ? ` poster="${esc(heroImg)}"` : ''} aria-hidden="true"><source src="${esc(heroVideo)}" type="video/mp4"></video>` : ''}
    <div class="cp-hero-inner cp-wrap">
      <nav class="cp-crumbs" aria-label="Breadcrumb">
        <a href="/">Home</a> <span>/</span> <a href="/listing">Listings</a> <span>/</span> <span aria-current="page">${esc(city.name)}</span>
      </nav>
      <h1>${esc(h1)}</h1>
      <p class="cp-tagline">${esc(city.tagline)}</p>
      ${hasData ? `<p class="cp-hero-count">${num(s.total)} condos, apartments and homes on the market in ${esc(city.name)} today, updated from the MLS.</p>` : ''}
      <div class="cp-hero-cta">
        <a class="tw-btn tw-btn-primary" href="${esc(searchUrl)}">Browse all ${esc(city.name)} listings</a>
        <a class="tw-btn" href="${esc(waUrl)}" rel="noopener">WhatsApp Rosa</a>
      </div>
      ${kpis.length ? `<dl class="cp-kpis">
${kpis.map(([v, k]) => `        <div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('\n')}
      </dl>` : ''}
    </div>
  </header>

  <section class="cp-section" id="listings">
    <div class="cp-wrap">
      <h2>Newest condos, apartments and homes for sale in ${esc(city.name)}</h2>
      ${hasData
        ? `<p class="cp-lede">The ${num(listings.length)} most recent listings in ${esc(city.name)}, FL ${esc(city.zips.join(', '))}. Open any property for photos, the building, HOA fees and a direct line to us.</p>
      <div class="cp-grid">
${listings.map(l => renderCard(l, city)).join('\n')}
      </div>
      <p class="cp-more"><a class="tw-btn tw-btn-primary" href="${esc(searchUrl)}">See all ${num(s.total)} ${esc(city.name)} listings</a></p>`
        : `<p class="cp-lede">Live listings are loading from the MLS. <a href="${esc(searchUrl)}">Open the full ${esc(city.name)} search</a> for every active condo, apartment and home.</p>`}
    </div>
  </section>

  <section class="cp-section cp-section-alt" id="about">
    <div class="cp-wrap cp-two">
      <div>
        <h2>Buying in ${esc(city.name)}</h2>
${city.intro.map(p => `        <p>${esc(p)}</p>`).join('\n')}
      </div>
      <aside class="cp-notes">
        <h3>What we check before you offer</h3>
        <ul>
${city.buyerNotes.map(n => `          <li>${esc(n)}</li>`).join('\n')}
        </ul>
      </aside>
    </div>
  </section>

  <section class="cp-section" id="neighborhoods">
    <div class="cp-wrap">
      <h2>Where to look in ${esc(city.name)}</h2>
      <div class="cp-hoods">
${city.neighborhoods.map(n => `        <article class="cp-hood"><h3>${esc(n.name)}</h3><p>${esc(n.blurb)}</p></article>`).join('\n')}
      </div>
    </div>
  </section>

  ${hasData ? `<section class="cp-section cp-section-alt" id="market">
    <div class="cp-wrap">
      <h2>${esc(city.name)} market snapshot</h2>
      <p class="cp-lede">Active MLS inventory in ${esc(city.name)} as of ${esc(generatedAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }))}. Medians and splits are computed from the ${num(s.sampleSize)} most recently listed properties.</p>
      <dl class="tw-facts cp-facts">
${snapshotRows.map(([k, v]) => `        <div class="tw-fact"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('\n')}
      </dl>
    </div>
  </section>` : ''}
${towerBlock}

  <section class="cp-section" id="faq">
    <div class="cp-wrap">
      <h2>${esc(city.name)} buyer questions</h2>
      <div class="cp-faq">
${city.faq.map(f => `        <details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n')}
      </div>
    </div>
  </section>

  <section class="cp-section" id="inquire">
    <div class="cp-wrap">
      <div class="tw-cta cp-cta">
        <h2>Looking in ${esc(city.name)}? Talk to the team that lives here.</h2>
        <p>The Poler Team is based on Collins Avenue in Sunny Isles Beach. Send us your budget and what you want to see, and we will send matching ${esc(city.name)} listings the day they hit the market, in English, Spanish or Portuguese.</p>
        <div class="tw-cta-row">
          <a class="tw-btn tw-btn-primary" href="${esc(waUrl)}" rel="noopener">WhatsApp Rosa</a>
          <a class="tw-btn" href="tel:${PHONE_TEL}">${PHONE_DISPLAY}</a>
          <a class="tw-btn" href="${esc(searchUrl)}">Set up ${esc(city.short)} alerts</a>
        </div>
      </div>
    </div>
  </section>
${othersBlock}
</main>

${FOOTER}
<script src="/lead-gate.js" defer></script>
<script src="/nav.js" defer></script>
</body>
</html>
`;
}

export function renderNotFound(allCities = []) {
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Area not found | The Poler Team</title><meta name="robots" content="noindex, follow">
<link rel="stylesheet" href="/preconstruction.css"><link rel="stylesheet" href="/tower.css"><link rel="stylesheet" href="/city.css"></head>
<body class="cp-body">${NAV}
<main class="cp-main"><section class="cp-section"><div class="cp-wrap"><h1>We don't have a page for that area yet</h1>
<p class="cp-lede">Try one of these, or <a href="/listing">search every South Florida listing</a>.</p>
<ul class="cp-areas">${allCities.map(c => `<li><a href="/${esc(c.slug)}">${esc(c.name)} condos for sale</a></li>`).join('')}</ul>
</div></section></main>${FOOTER}<script src="/nav.js" defer></script></body></html>`;
}
