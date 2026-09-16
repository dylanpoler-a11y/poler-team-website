# Session Handoff — Per-city SEO landing pages — 2026-09-16

## Goal
Rank homesinsoflorida.com for city-level buyer searches ("sunny isles condos for sale", "apartments in sunny isles", "aventura condos") with server-rendered pages that carry LIVE MLS inventory, so Google indexes real listings instead of the JS-filtered `/listing?city=` view (generic title + canonical `/listing`, no listings in the HTML).

## State — DEPLOYED to production 2026-09-16 ~08:05 ET
Live URLs (all 200, indexable, canonical self, GA4 `analytics.js` + `lead-gate.js` + `nav.js` present, 24 listing cards each, JSON-LD valid):
- https://www.homesinsoflorida.com/sunny-isles-beach-condos-for-sale — hero = Kevin's drone video (`/sunny-isles-drone-web.mp4`, poster `/hero-poster.jpg`)
- https://www.homesinsoflorida.com/hallandale-beach-condos-for-sale — hero = newest waterfront MLS cover photo
- https://www.homesinsoflorida.com/aventura-condos-for-sale — hero = newest waterfront MLS cover photo (today an interior; see Pending)
- Unknown slug (`/nope-condos-for-sale`) → 404, `noindex`, s-maxage 600.
- `/sitemap.xml` carries the 3 city URLs (priority 0.9, daily). 123 tower pages regenerated with a "<City> condos for sale →" link above the back link. `/listing` + `/` footers link the 3 pages.
- Vercel CDN: healthy render `s-maxage=1800, stale-while-revalidate=86400` (second hit = `x-vercel-cache: HIT`); degraded (Bridge down / token missing) → `s-maxage=60`, page still renders prose/FAQ/towers, never 500.
- Cold `code-reviewer` (sonnet) verdict SHIP; its one SHOULD-FIX (array `?slug=` guard) applied before deploy.

## Architecture (add a city = one object in `lib/cities-data.js`, then `node tools/build-tower-pages.js`, then deploy)
- `vercel.json` rewrite `/:city-condos-for-sale` → `/api/city?slug=:city-condos-for-sale` (first rewrite; public URL never shows `/api`, so `robots.txt Disallow: /api/` is irrelevant).
- `api/city.js` — Node function: sanitizes slug, 3 Bridge calls via `Promise.allSettled` (newest 24 w/ `CARD_FIELDS`, 200-sample for stats, rentals total), `TOWERS` filtered by `city.towerCities` (city OR area), renders. `BRIDGE_API_TOKEN` server-side only.
- `lib/city-page.js` — pure renderer: `renderCityPage`, `renderNotFound`, `computeStats`, `esc`, `ORIGIN`. Hero pick: `city.heroVideo`/`city.heroImage` → newest waterfront MLS cover → any MLS cover (tower renderings deliberately NOT used — third-party sources watermark them, e.g. Viceroy Aventura). `heroAbs` makes relative curated assets absolute for `og:image` + JSON-LD.
- `lib/cities-data.js` — `CITIES` (3 entries) + `findCity(slug)`. Fields: slug, name, short, county, zips, bridgeCity, lat/lng, towerCities, nearby, titleTail, tagline, intro[3], neighborhoods[4], buyerNotes[4], faq[6], optional heroVideo/heroImage.
- `city.css` — full-bleed 100dvh hero (video layer z0, `::after` scrim z1, copy z2), `.cp-wrap {width:min(1720px,92vw)}`, cards grid, sticky buyer notes, FAQ `<details>`; layered on `preconstruction.css` + `tower.css`.
- `tools/build-tower-pages.js` — imports CITIES; `cityPageFor(tower)`; sitemap emits `/${c.slug}`.
- Page copy carries every query variation on purpose: `<title>` "Condos & Apartments for Sale" (SIB) / "Condos & Homes for Sale" (others), H1 "<City> Condos for Sale", H2 "Newest condos, apartments and homes for sale in <City>", FAQ answers for "apartments for sale", houses vs condos, foreign buyers, STR, new construction. Google treats condo/apartment/unit as synonyms; the page just needs the city + intent, which it has in title, H1, H2, meta, breadcrumb, JSON-LD and body.

## Pending (exact next steps)
1. **Google Search Console** — Kevin adds the property (or grants access) and submits `https://www.homesinsoflorida.com/sitemap.xml`; then "Request indexing" on the 3 city URLs. Nothing ranks until this happens (audit found only ~6 of 41 tower pages indexed).
2. **Hero footage for Hallandale + Aventura** — Kevin sends drone clips (or picks a photo); set `heroVideo`/`heroImage` in `lib/cities-data.js` (paths relative to site root, like SIB). Until then Aventura's hero is whatever the newest waterfront listing leads with.
3. **Next cities** (order from the audit §4): Edgewater, Brickell, Miami Beach → Fort Lauderdale, Pompano, Boca → small cities. Each = one `CITIES` entry (write real intro/neighborhood/FAQ copy, no boilerplate) + regenerate + deploy.
4. **ES/PT versions** — pages are English-only (site convention is trilingual; deliberate v1 scope cut). Plan: `/es/<slug>` + `/pt/<slug>` rewrites with hreflang, copy fields per language in cities-data.
5. Optional: H1 for Hallandale/Aventura says "Condos for Sale" while title says "Condos & Homes"; harmless, could use `titleTail`.
6. Rank tracking: add the 3 city keywords to the OpenSEO tracker (Docker must be running; ~$1.63/run at 41 kw).

## Touched
- NEW: `api/city.js`, `lib/city-page.js`, `lib/cities-data.js`, `city.css`, this handoff.
- MODIFIED: `vercel.json` (rewrite), `tools/build-tower-pages.js` (CITIES import, tower→city link, sitemap), `sitemap.xml` + `tower/**` (regenerated), `listing.html` (footer Popular Searches), `index.html` (footer "Browse by area" nav), `.claude/rules/learnings.md`.
- External: Vercel production deploy `poler-team-website-f6g1o1pup-investor-os-1.vercel.app` → www.homesinsoflorida.com. No env changes, no Airtable writes.
- Research: `~/business/real-estate/active/research/2026-09-16-openseo-first-audit-homesinsoflorida.md` (§4 = all-cities keyword table + build order).

## Gotchas
- Working tree ALSO holds uncommitted changes from the 2026-09-12 lead-gate session (`api/_capi.js`, `api/save-lead.js`, `lead-gate.js`, `listing.js`, `nav.js`, `package.json`, `tools/lead-gate.template.js`, `lib/phone-quality.js`, `.gitignore`) — already live in prod, not part of this work. `listing.html`/`index.html` diffs mix both sessions.
- Bridge `Media[].ShortDescription` is EMPTY in the miamire feed — you cannot keyword-score photos for "exterior/aerial"; curate hero assets per city instead.
- The Write tool turns ` ` inside a JS regex literal into the raw character (SyntaxError on import) — write `\\u2028` or patch with python.
- `~/bin/check-clean` is the outbound-message scanner; its HTML/markdown/en-dash flags don't apply to source files.
- impeccable hook flags Inter as "overused" on every edit — false positive, the design system mandates Inter + Playfair.
- Never edit `tower/**` or `sitemap.xml` by hand — regenerate with `node tools/build-tower-pages.js`.
- Deploy is CLI only: `cd ~/business/real-estate/poler-team-website && npx vercel --prod --yes`.
