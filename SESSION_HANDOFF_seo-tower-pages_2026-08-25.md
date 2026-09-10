# Session Handoff — Organic SEO build-out (tower pages) — 2026-08-25

## Why
Kevin paused the Google Ads Search campaign ("Usa Leads Miami", $30/day) on 2026-08-25 and asked
whether SEO could replace it. Ran the SearchFit `seo-auditor` over the repo + live site, then the
`programmatic-seo` skill to build the highest-ROI fix.

**Honest framing given to Kevin:** the paused head terms ("Miami homes for sale," "Fort Lauderdale
real estate") are NOT organically winnable against Zillow/Realtor/Redfin at any technical-fix level.
Organic replaces a *slice* of that traffic with higher-intent, lower-competition queries — it does
not replace the volume.

## Shipped (all deployed to prod, verified live)

| Change | Files |
|---|---|
| 41 static per-tower pages at `/tower/<id>` — unique title/meta/canonical, Residence+Product & BreadcrumbList JSON-LD, facts, amenities, deposit schedule, related-tower links, Rosa WhatsApp CTA | NEW `tower/*.html` (generated), NEW `tower.css` |
| Generator (re-runnable; ESM — repo is `"type":"module"`) | NEW `tools/build-tower-pages.js` |
| Directory card titles now link to each tower page (orphan prevention) | `preconstruction.js`, `preconstruction.css` |
| Missing canonical added | `str.html` |
| Meta description now names all 6 ex-campaign cities (was 2) | `listing.html` |
| Regenerated: 48 URLs incl. `/preconstruction` + `/home-valuation`, which were MISSING | `sitemap.xml` |

**Regenerate after editing tower data:** `node tools/build-tower-pages.js` (rewrites `tower/` + `sitemap.xml`).
Never hand-edit files in `tower/` — edit the template in the generator.

## Verified live
- All 41 `/tower/<id>` URLs return HTTP 200; 41 unique titles / canonicals / descriptions.
- JSON-LD parses on every page (`Residence/Product` + `BreadcrumbList`).
- `/preconstruction`: 41 cards, 41 name links → tower pages, 0 broken images, 0 alt attrs containing markup.
- `robots.txt` already references the sitemap. `str` canonical live.

## Bugs found and fixed during the build (see learnings.md for the rules)
1. Making the card title an `<a>` fragment broke `alt="' + name + '"` on the card `<img>` — caught by cold `code-reviewer`.
2. `.join(' &middot; ').replace(...)` was a no-op that double-escaped → literal `&middot;` on all 41 pages.
3. Tower pages inherited an oversized nav: `/preconstruction` supplies nav sizing from an INLINE `<style>` block, not from `preconstruction.css`.
4. `area === city` towers produced "Sunny Isles Beach, Sunny Isles Beach" titles.
5. Hardened JSON-LD against a future `</script>` in tower data.

## STILL OPEN (ranked)
1. **No hreflang / no indexable ES-PT URLs.** `i18n.js` switches language via `?lang=` + client-side DOM swap — there are no `/es/` or `/pt/` paths, so Google cannot surface the site for Spanish/Portuguese foreign-buyer queries. This is the biggest remaining lane given the LATAM/Brazil audience. Recommendation: a handful of targeted ES/PT landing pages, NOT a full localization rebuild.
2. **`/listing?city=X` still canonicals to bare `/listing`** (`listing.html:9` hardcoded). The JS updates the visible H1 per city but never the title/meta/canonical, so no per-city page exists in the index. Fix = static per-city pages for the 6 ex-campaign cities.
3. **5 towers ship with ZERO photos** — Baccarat Residences Miami (badged TOP PICK), Waldorf Astoria Residences Miami, The Residences at 1428 Brickell, Okan Tower, Lofty Brickell. Their pages have no hero image and no `og:image`. Real content gap now that these pages target traffic.
4. **Google Search Console**: sitemap should be (re)submitted and indexing requested for the new URLs — needs Kevin's GSC access; not done this session.
5. **STR building pages deliberately NOT generated.** `/str` builds its building list from live MLS queries with no proprietary per-building prose — mass-generating those would be thin content. Would need a written blurb per building first.
6. Render-blocking `i18n.js` + `listing.js` on `/listing` (no `defer`) — audit flagged; untouched because i18n likely must run before listing.js paints. Test before flipping.

## Unrelated uncommitted files in the tree (NOT part of this change, left alone)
`crm.js`, `crm.html`, `home-valuation.html`, `listing.js`, `nav.js` — pre-existing modifications from earlier sessions. `listing.js` carries the 2026-08-23 Google-Ads popup gate, which is deployed and live.
