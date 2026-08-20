# Session Handoff — /listing → Zillow-style paginated results page — 2026-08-19

Two changes this session, both LIVE. Kevin is launching Google Ads to /listing and wants
ad visitors to land on nav → search/filters → property grid with nothing in between
(modeled on rafaellistingrealestate.com / teamfourcorners.com / luxurylivingfortlauderdale.com).

## Change 1 (~12:55 PM) — default hero removed
- `listing.js renderDefaultHero()` no longer renders the Sunny Isles video hero; it hides
  `#hero-property` entirely (all 3 paths: no param, listing not found, fetch error).
- Inline parse-time script in `listing.html` + `listing-redesign.html` hides the hero
  skeleton immediately when the URL has no `id`/`mls` param (no 400px flash).
- Property hero (`renderHero`, `?mls=`/`?id=`) untouched.

## Change 2 (~1:30 PM) — compact layout + full inventory with pagination
- **Removed the social-proof strip** ("80+ Buyers Served", quotes, flags) from
  `listing.html` + `listing-redesign.html`. i18n keys (proofBuyers, spQuote1-3) left in
  i18n.js (harmless, reusable).
- **Spacing tightened**: `.search-hero` 2rem→0.9rem padding, `.search-tabs` margin
  1.5rem→0.9rem, `.browse-section` top 1.5rem→0.75rem (listing.css; redesign override
  tightened too).
- **PAGE_SIZE 12 → 50**; new `MAX_OFFSET = 10000` (Bridge 400s past ~10k offset —
  probed live: 10,000 OK, 20,000 fails; pagination clamps to 200 reachable pages).
- **`fetchCuratedListings` (3 tiered price queries, cap 24) → `fetchBrowseListings(page)`**:
  ONE query — StandardStatus=Active, PropertyType per Buy/Rent tab,
  `City.in=<56 SOUTH_FL_CITIES>` (server-side, so API `total` is exact),
  sortBy=OriginalEntryTimestamp desc (newest ON MARKET first — NOT
  ModificationTimestamp, which floats price-touched old listings), limit 50,
  offset page*50. Count line: "Showing 1–50 of 35,513 properties".
- **`runSearch(append)` → `runSearch(page, reuseQuery)`**: page-REPLACE pagination
  (no more append/Load More). `fetchListings` now returns `{listings, total}`.
  `goToPage`/`refreshGrid` pass reuseQuery=true so pagination + language switch never
  rebuild from the form. ZIP search routes through runSearch(0, true) with prebuilt
  lastQuery. Empty deep page (multi-status/multi-city client filters) keeps pagination
  visible so users can navigate back.
- **Load More removed** (HTML + JS + CSS); new `#pagination-wrap` + `renderPagination()`
  (windowed numbers 1 … p-2..p+2 … last, Prev/Next, i18n keys `prevPage`/`nextPage`
  EN/ES/PT added to i18n.js).

## Verified live (curl, post-deploy)
- Page-1 browse query: 50 results, total 35,513, top entry 12 min old, all cities in the
  SoFla list. Page 2: 50 more, zero overlap. Rent tab: 50 / 24,035. URL length 984 — fine.
- Served files: 0 refs to social-proof/load-more, pagination-wrap + fetchBrowseListings +
  PAGE_SIZE 50 present. gtag conversion snippet intact.
- Cold code-review (code-reviewer subagent): GO — no blockers; both nits fixed
  (dead load-more CSS removed, empty-deep-page pagination kept visible).
- Deploys: poler-team-website-28f4r8von (hero), poler-team-website-gumubilm9 (this) →
  www.homesinsoflorida.com.

## Known edges (accepted)
- Multi-city free-text searches (comma cities) paginate per-city with the same offset —
  totals are summed/approximate; deep pages can thin out. Browse + single-city + ZIP are exact.
- Multi-status checkbox searches client-filter after fetch → a page can show <50.
- Browser-pane visual QA was blocked by the session permission classifier both attempts —
  all verification is query/text-level. Kevin should eyeball /listing once: hero gone,
  compact spacing, grid of 50, numbered pages at the bottom.

## Rollback
`git diff` still uncommitted in the repo — `git checkout -- listing.js listing.html
listing-redesign.html listing.css listing-redesign.css i18n.js` + redeploy restores the old page.

## Change 3 (~1:55 PM) — Four Corners layout restructure (Kevin's screenshot/link)
Reference: teamfourcorners.com search results page.
- **Header collapsed to ONE navy nav row**: logo-white.png (30px) · nav links (scrollable
  `.lp-nav-links` wrapper so the lang dropdown isn't clipped) · right group = Call Us +
  language selector (restyled for dark bg). The old white top bar (logo/tagline/lang/call)
  is gone; `tagline` i18n key now unused.
- **Search row**: `.filter-bar` (type/price/beds/baths/More/Search + #filter-advanced +
  #price-hint) MOVED from browse-section into a new `.search-row` in `.search-hero`,
  next to the Buy/Rent/Sell tabs and the search bar. Search bar flush LEFT (flex 1 1 300px,
  max 460px), full-width row (1400px container). Area chips REMOVED (initAreaChips deleted).
  price-hint hidden via CSS (placeholders + title attrs carry the 000s convention).
  initTabs now also hides #filter-bar on the Sell tab.
- **Cards**: default view = GRID (was list), 4 columns (3 @≤1024, 2 @≤900, 1 @≤520).
  Card = photo → price → "N bd · N ba · N,NNN sqft" one line → address → "MLS®: <id>".
  Removed ppsf line + agent row from grid cards (renderListItem/list view untouched).
  URL override flipped to ?view=list.
- Cold review #2 (code-reviewer): SHIP IT, zero defects; dead code cleaned same pass.
- Verified live post-deploy: old header classes 0 hits, new nav classes present,
  filter-bar single + inside search-hero before browse-section, grid btn default active,
  gtag intact. listing-redesign.html NOT updated for change 3 — that preview page is now
  stale/parked (still has the old two-row header + separate filter bar).

## Change 4 (~2:00 PM) — card date + Grid/List toggle fix
- Every grid card now shows "Listed <Mon D, YYYY> · MLS®: <id>" (fmtListDate on
  ListingContractDate||OnMarketDate; new i18n key `listedLabel` EN/ES/PT).
- ROOT CAUSE of "Grid/List highlights but doesn't switch": listing.js had TWO
  initViewToggle declarations — a legacy one (list+map naive handlers only) later in the
  file SHADOWED the real switchView-based one (classic-script hoisting). Deleted the
  legacy copy; added renderMapView() to switchView's map branch (the legacy handler was
  the only thing calling it). Deployed + verified served file has exactly 1 initViewToggle.

## Change 5 (~2:05 PM) — square search bar + multi-select property types
- Search bar pill → rectangle (border-radius 40px→8px; inner orange button 50%→6px).
- Property Types is now a MULTI-SELECT checkbox dropdown (#f-type-btn/#f-type-panel,
  initTypeMulti). None checked = All Types; label shows the type name or "N types/tipos".
  buildSearchParams sends `PropertySubType.in=csv` (verified live: SFR+Condominium+
  Townhouse in one Miami query, total 7,013). Condo/Townhouse now genuinely includes
  Townhouse (old select sent Condominium only). Old <select id="f-type"> removed.
  New i18n key `typesWord`.

## Change 6 (~2:45 PM) — taste-skill polish pass (design-taste-frontend, preserve mode)
Design read: preserve-mode refinement of a utility results page (VARIANCE 3 / MOTION 3 /
DENSITY 5) — the skill's landing-page theatrics are explicitly out of scope for a results
grid; applied its levers + AI-tell purge instead:
- Shadows tinted to navy brand hue (were pure black) — --shadow-sm/--shadow/--shadow-md.
- Shape lock: Call Us pill (40px, navy-on-navy = invisible) → 6px ghost button w/ white
  border on the navy nav; hover brightens.
- Removed redundant city label overlaid on card photos (banned overlay label; address
  line already carries it); status badge stays (semantic), overlay now flex-end.
- En-dash "1–50" → hyphen "1-50" in both count strings (skill 9.G).
- Polish layer appended to listing.css: tabular-nums on prices/counts/pagination,
  :active scale(0.98) press on all controls, :focus-visible navy rings (a11y),
  card entry rise animation (staggered first 8, fill-mode BACKWARDS so the existing
  hover translateY(-3px) still works, prefers-reduced-motion gated).

## Change 7 (~2:55 PM) — Miami Home Group layout PREVIEW at /listing-preview
Kevin wants /listing to copy themiamihomegroup.com/home-search/listings (layout only,
Poler colors kept) and asked for a PREVIEW before going live. Built as fully ISOLATED
copies — /listing untouched (verified 0 preview refs in served /listing):
- Files: listing-preview.html (noindex; loads listing-preview.css + listing-preview.js),
  listing-preview.js (fork of listing.js), listing-preview.css (override layer after
  listing.css). i18n.js got 6 additive keys (viewList/viewMap/saveSearchBtn/sortNewest/
  sortPriceDesc/sortPriceAsc) — safe for live.
- Layout copied: gray filter band (search input flush left → Buy/Rent/Sell pills → type/
  price/beds/baths pills → More Filters → Search → right: List|Map segmented + navy
  "Save search"); bold results title ("<City|South Florida> Homes for Sale/Rent") +
  count + NEW Newest/Price sort select (Bridge sortBy=ListPrice verified both orders);
  BORDERLESS cards: rounded photo, Active/New chips top-left, heart+SHARE (Web Share API,
  clipboard fallback) top-right circles, price/specs/address/"Listed date · MLS" below.
  Cap-rate badge + city overlay + old list-view button dropped on preview.
- Save search button reveals the existing #save-search-cta email card.
- Verified in Chrome: band, title, sort, cards, Map toggle (price pins), pagination 1-200.
- FOLD-IN on approval: port the html band/header deltas + card template + sort/share/title
  JS into listing.html/listing.js, merge listing-preview.css into listing.css, delete the
  3 preview files. Results title is EN-only in preview — i18n it at fold-in.

## Change 7b (~3:05 PM) — preview went FULL-BLEED (Kevin: wasted side space)
- Killed the centered containers on the preview: lp-nav-inner/search-hero-inner (1400px)
  and browse-inner (1200px!) → max-width none, 1.25rem side padding.
- Grid → repeat(auto-fill, minmax(300px,1fr)): 5 cols at 1456px, scales with any screen,
  collapses naturally on mobile (overrides listing.css breakpoint columns by cascade).
- Band compacted to ONE row ≥1200px (tighter pills/gaps, search bar 240-380px,
  flex-wrap:nowrap; wraps below 1200px). Verified in Chrome at 1456px: single-row band,
  edge-to-edge 5-col grid, matches themiamihomegroup.com structure.

## Change 7c (~3:20 PM) — preview: tabs removed, gated contact, nav phone
- Buy/Rent/Sell pills hidden from the band via CSS (buttons stay in the DOM hidden —
  the nav's Buy/Rent/Home Valuation onclick handlers .click() them, so rent mode and
  the sell form still work through the nav).
- NEW openLeadGate(fallbackUrl, newTab) in listing-preview.js: "Call Us" and "Contact"
  now open the lead-capture popup for UNregistered visitors (verified live: overlay
  active + page blur); registered leads (poler_lead_v1) pass straight through to
  tel:/wa.me. Kevin's own localStorage saved+restored during the live test.
- Rosa's number "(954) 235-4046" added as a nav item right after Contact (plain tel:
  link, reference style, tabular-nums).

## Change 8 (~3:35 PM) — LIVE regression fix + 2 more preview pages
LIVE FIX (no approval needed — my earlier header-CSS edit had broken /str): restored the
legacy two-row header rules as a scoped compat block at the end of listing.css
(.lp-header-inner ...). /str renders correctly again (screenshot-verified). Note
preconstruction.html was never broken (self-contained preconstruction.css).

PREVIEWS (Kevin approves before live; all noindex, interlinked so he can browse the
whole new experience):
- /listing-preview?mls=… — property DETAIL now stays inside the preview (card/map/
  similar/address-lookup links rewritten to listing-preview; share URLs stay canonical
  /listing). Detail view full-bleed (.hero-property-wrap/.similar-inner max-width none).
- /str-preview — single-row navy nav (Home→listing-preview, Preconstruction→
  preconstruction-preview, STR active, phone after Contact, ghost Call Us), full-bleed
  building list (.str-content/.str-filters). str-hero kept.
- /preconstruction-preview — pc-hero REMOVED (New Developments banner), same single-row
  nav (+ lang selector; Call Us keeps its 305 tel), full-bleed filters + tower grid.
  Nav styles inlined in each preview page (precon css is self-contained).
FOLD-IN scope on approval now: listing{,-preview}, str{,-preview}, preconstruction
{,-preview} + delete the 6 preview files. Not yet done anywhere: lead-popup gating of
Call Us/Contact exists ONLY on listing-preview (str/precon pages have no lead-overlay
markup; porting it = separate task if Kevin wants popup there too).

## Change 9 (~3:45 PM) — preconstruction LIVE + impeccable polish on str-preview
- APPROVED+DEPLOYED: preconstruction-preview folded into live /preconstruction
  (regenerated from the preview: title/index,follow restored, preview slugs → live slugs;
  hero gone, single-row nav live, full-bleed). preconstruction-preview.html kept for now.
- str-preview polish (impeccable skill, polish flow, brand register, identity-preserve):
  ROOT CAUSE of invisible hero stats = .str-stat-num used var(--orange), which listing.css
  redefines to NAVY #1a2744 → navy-on-navy. Now #fff + tabular-nums. Also: hero sub
  0.7→0.85 white, stat labels 0.6→0.78, filter selects border 0.2→0.32/bg 0.12; hero
  compacted (3rem→2rem padding, tighter stat/filter margins); card shadows navy-tinted;
  focus-visible on selects/rows; :active state; staggered card rise (reduced-motion
  gated); em-dashes in price ranges/placeholders/footer → hyphens (footer © 2026 ·).

## Change 10 (~3:55 PM) — STR LIVE + advanced filters on listing-preview
- APPROVED+DEPLOYED: str-preview folded into live /str (title/robots restored, live
  slugs). Nav "Home Valuation" on str + preconstruction → listing?tab=sell; BOTH
  listing.js and listing-preview.js honor a new ?tab= deep-link param in initTabs.
- NEW More-Filters on listing-preview (all Bridge fields probed live before wiring):
  Pool = PoolPrivateYN true (17,250) · Gated = CommunityFeatures.in Gated,Gated Community
  (4,416) · Terrace/Balcony = PatioAndPorchFeatures.in Open Balcony,Patio,Deck,Open
  Porch,Wrap Around (26,831 — feed has NO literal "Terrace" value) · STR OK =
  MIAMIRE_Restrictions.in Daily Rentals Allowed (940, same field as /str) · HOA $/mo =
  AssociationFee.gte/.lte · No HOA = AssociationYN false (12,007; overrides the range) ·
  Keywords (modern/renovated/private/golf) = CLIENT-side EN+ES term match over remarks +
  feature arrays (Bridge rejects .contains/.like; q= is silently ignored — probed).
  Keyword mode widens fetch to the 200 newest, hides pagination, and the count line says
  the coverage honestly. Sqft min/max + year-built range already existed in the panel.
- VERIFIED: 8/8 API conformance checks (every filter returns only conforming rows;
  combined filter AND-composes) + real-UI run: Pool+Gated = "Showing 1-50 of 2,945";
  +renovated keyword = 71 cards, pagination hidden. 12 new i18n keys (EN/ES/PT).

## Change 11 (~4:05 PM) — signup popup UNCONDITIONAL on Call Us / Contact (LIVE)
Kevin: clicking Contact/Call Us must ALWAYS open the signup sheet (he was being passed
through to WhatsApp because he's a registered lead, and str/precon had no gate at all).
- initLeadCapture RESTRUCTURED in listing.js + listing-preview.js: captured visitors no
  longer early-return (the form handlers now wire for everyone — the old return would
  have made an on-demand popup a dead-button trap); only the 10s auto-timer is gated on
  !leadCaptured. New ?signup=1 deep link opens the form on load.
- openLeadGate now ALWAYS shows the popup (no registered pass-through) — added to live
  listing.js, replaced in listing-preview.js.
- Buttons: live listing.html + listing-preview.html Call Us/Contact → openLeadGate();
  str/preconstruction (live + previews) → listing?signup=1 (those pages have no popup
  markup). LIVE-VERIFIED as a REGISTERED visitor: Call Us on /listing → popup ✓, boot
  chain intact (50 cards) ✓, ?signup=1 → popup on load ✓.

## Change 12 (~4:15 PM) — LISTING FOLD-IN LIVE + hero photos (valuation + STR)
- APPROVED+DEPLOYED: listing-preview folded into live /listing. Method: listing-preview.css
  appended to listing.css as the final cascade layer (safe for str.html which also loads
  listing.css — checked no class collisions); listing.js ← preview js with detail links
  restored to /listing; listing.html ← preview html (title/robots restored, css/js refs
  de-previewed). ALL 5 preview files DELETED (listing-preview.{html,css,js}, str-preview,
  preconstruction-preview) — preview URLs now 404. Verified live after hard-reload
  (stale-cache false alarm first screenshot): full-bleed 5-col grid, band, chips/share
  cards, sort, pagination.
- HERO PHOTOS (Kevin: "nice picture, not a big blue box"): /str hero = Miami skyline
  photo under the navy gradient (Unsplash 1506966953602, curl-verified 200 image/jpeg);
  Home Valuation (sell tab) = dusk house photo (1568605114967) with navy overlay,
  Playfair title, white form card, full-bleed panel. Both screenshot-verified live.
- The whole new experience is now LIVE end-to-end: /listing (+detail), /str,
  /preconstruction. listing-redesign.html remains as an old parked experiment.

## Change 13 (~4:35 PM) — /home-valuation page (taste-skill copy of themiamihomegroup.com/home-valuation)
NEW dedicated page home-valuation.html (LIVE; nav "Home Valuation" on listing/str/
preconstruction now points there — the listing Sell pill still works as before).
Reference structure copied w/ Poler tokens + our exact banner: photo hero (dusk house)
+ Playfair H1 + 3 check bullets + white address bar; 2-step lead flow (address →
name/email/phone card) POSTing to /api/save-lead (first/last/email/phone/
listingAddress "VALUATION: <addr>"/language/timeline 'Home Valuation') + gtag
conversion + fbq Lead; "What's Your Property Worth" split w/ interior photo (verified
200); 3 FAQ boxes; two center-rule TIMELINES (Market Analysis/Appraisal · Refinancing/
Improvements/Credit/Planning — original copy, NOT theirs, no em-dashes); navy CTA band
→ /listing; standard footer. Fully trilingual: ~45 hv* keys added to i18n.js; page
calls applyTranslations()+initLangSelector() itself (i18n.js does not auto-init).
Call Us/Contact on this page → listing?signup=1 (no popup markup here).
Verified live: hero/sections render, step-2 card opens on address entry.
KNOWN PRE-EXISTING BUG not yet fixed: the listing page's Sell-tab #sell-form STILL has
no submit handler anywhere (default GET reload = lead lost silently) — the new
/home-valuation flow is the working replacement, but if the Sell pill stays, wire its
form to save-lead next session.
- (fixed same session ~4:40 PM: initSellForm() now wired in listing.js, live-verified in served file)

## Change 14 (~4:58 PM) — Newest sort now matches the DISPLAYED date (LIVE)
Bug: default browse sorted server-side by OriginalEntryTimestamp (feed entry) while the
card displays ListingContractDate — a listing ENTERED today with a backdated Aug 17
contract date ranked first. Fix in sortParams(): newest = sortBy ListingContractDate
desc + ListingContractDate.gte=1900-01-01 guard (Bridge sorts nulls FIRST on desc; only
7 of 48,265 actives are dateless and are now excluded). fetchBrowseListings also
clientSort()s each rendered page, and the ZIP branch now shares sortParams(). Verified
live: page-1 all 2026-08-19, strictly non-increasing, zero nulls.

## Change 15 (~5:05 PM) — visible waterfront toggle + free-text keywords (LIVE)
- Waterfront toggle was INVISIBLE on the white advanced panel (.filter-switch-track was
  rgba(255,255,255,0.15) — built for a dark sidebar that no longer exists). Now 44x24,
  solid gray track w/ border + shadowed knob, navy when on, focus-visible ring.
- Keywords: the 4 checkboxes REPLACED with a free-text input (#f-keyword, CRM-style,
  placeholder "modern, renovated, private, golf..." i18n'd) — comma-separated terms, ALL
  must match (AND), and they compose with every other filter. Known terms expand to
  EN+ES synonym sets (modern/moderno, renovated/renovado/remodeled, private/privado,
  golf, pool/piscina, waterfront); unknown words match literally against remarks +
  feature arrays. Also fixed pre-existing dead Enter-key wiring (selector referenced
  non-existent .filter-input/.filter-select → now .fb-input/.fb-input-sm/.fb-select),
  so Enter in any filter box triggers the search.
- LIVE-VERIFIED Kevin's exact example: keyword "golf" + lot 5,000-10,000 → 16 results,
  100% mention golf, 100% lots in range.
NOTE: explicit searches without a location intentionally search the full feed (browse
default stays SoFla-only via City.in) — pre-existing semantics, unchanged.

## Change 16 (~5:08 PM) — 10s auto-popup DISABLED (LIVE, reversible)
Kevin testing without the automatic lead gate. `const AUTO_POPUP = false` in
listing.js initLeadCapture — flip to true to restore the 10s timer exactly as it was.
The popup still opens on demand: Call Us / Contact buttons (openLeadGate) and the
?signup=1 deep link from str/preconstruction/home-valuation navs. NOTE for ads math:
the gtag Lead conversion now fires only from deliberate popup opens, the /home-valuation
flow, and the (newly wired) Sell form — expect fewer but higher-intent form leads.

## Change 17 (~5:15 PM) — auto-popup now META-ONLY (LIVE, supersedes change 16)
Kevin refined: 10s popup fires ONLY for Facebook/Instagram traffic. Detection in
listing.js initLeadCapture: fbclid param OR utm_source in (facebook,fb,ig,instagram,
meta) OR referrer facebook.com/instagram.com; flag persists per visit in sessionStorage
(poler_meta_visitor) so the gate survives clicks into property pages. Google Ads
(gclid/utm_source=googlead), organic, and direct = NO auto-popup. Call Us/Contact/
?signup=1 still open the form for everyone. LIVE-VERIFIED both ways as an unregistered
visitor: fbclid landing -> popup at 10s + flag persisted; gclid landing -> no popup
after 12s. (Test note: Kevins own browser lost its poler_lead_v1 registered flag
during the test - functionally irrelevant under the new policy.)

## Change 18 (~5:40 PM) — HOMEPAGE PREVIEW at /index-preview (taste-skill copy of themiamihomegroup.com)
Kevin interrupted the git-commit request (working tree still uncommitted) and pivoted to
the homepage. NEW index-preview.html (noindex, EN-only for now — i18n keys at fold-in):
reference structure with Poler tokens + our banner: full-screen hero (verified Unsplash
villa) + eyebrow + Playfair "The Poler Team" + search bar → listing?city=; stats band
(REAL claims only: 80+ Buyers Served / 15+ Countries — existing site claims — and $9.2M
Top Sale per the verified Regalia closing); 3 photo tiles (Home Search/Home Valuation/
Let's Connect); Meet Rosa (rosa-poler-headshot.jpg + navy overlay card + orig bio +
IG/FB/WA icons); testimonial carousel (the 3 REAL existing site quotes, auto-advance,
reduced-motion gated) over Miami-skyline bg; FEATURED LISTINGS = live Bridge fetch
(6 newest $1M+ actives, core cities, contract-date sort) → listing?mls=; valuation band
→ /home-valuation; neighborhoods grid (reuses listing.css cards); Sell/Buy duo tiles;
Work With The Poler Team CTA band; slim footer. All image URLs curl-verified 200.
ALSO FIXED LIVE: the Sunny Isles neighborhood card image on /listing was the KNOWN-404
Unsplash id (7/15 learning; the fix had only shipped on the parked redesign layer) →
now the verified 1506966953602 on both pages; Hollywood card got 1519046904884 (verified).
CURRENT /index.html (corporate multi-division site) is UNTOUCHED until Kevin approves;
fold-in = index-preview → index.html (restore title/SEO/robots, keep canonical), add
i18n keys, decide fate of old corporate content (about/consulting anchors that other
pages' "index.html#about" nav links point at).
NOTE: git commit request from ~5:13 PM is still PENDING (interrupted) — working tree
holds all of today's changes uncommitted.

## Change 19 (~5:50 PM) — homepage preview: VIDEO HERO ROTATION + scroll reveals
- Hero now rotates 3 videos with a 1.4s crossfade every 9s: local
  sunny-isles-drone-web.mp4 (2.6MB, first = instant), then two curl-verified Pexels
  Miami Beach aerials (15820848 60fps 8MB shoreline+skyline, 3770584 25fps 13MB South
  Beach) — content EYEBALL-verified via the Pexels search grid before shipping (blind
  ID guesses kept returning Chicago/waterfalls/snorkelers). Videos lazy-load via
  appended <source> on demand, next clip preloads ahead, prev pauses after fade; the
  villa photo stays as the underlying fallback/reduced-motion state; scrim overlay keeps
  text contrast.
- Scroll reveals (impeccable pass): .hp-reveal blocks rise in on enter AND fade back out
  on leave (IntersectionObserver toggle, threshold .12), gated behind html.hp-ready so
  content is never hidden without JS; reduced-motion disables both systems. ES5 syntax
  throughout (old-WebView rule).
- DEBUG NOTE: videos showed readyState 0 forever during testing — Chrome DEFERS media
  loading in HIDDEN tabs; fronting the tab fixed it instantly. Never diagnose media
  autoplay from a background MCP tab.
- Verified fronted: all 3 videos readyState 4, rotation live (screenshot caught clip 2),
  reveals firing. Preview tab left fronted for Kevin.

## Change 19b (~5:55 PM) — hero video lineup per Kevin's feedback
Old local sunny-isles drone REMOVED from rotation. Now 4 clips, all Pexels, all
curl-verified + content eyeball-verified: 15820848 (beach, people walking, drone rising
— Kevin's favorite, plays first) → 3770584 (South Beach hotels aerial) → 19109601
(downtown Miami NIGHT skyline, water reflections, 24fps 10MB) → 15767939-hd_2048_1080
(luxury island: waterfront mansions, marina yachts — NOTE: Pexels page id 15767944 maps
to FILE id 15767939; page ids ≠ file ids on newer uploads, pull the real URL from the
video page's <video> src). Verified live: 4/4 readyState 4, rotation crossfading
(screenshot caught the island clip).

## Change 20 (~8:30 PM) — Meet section: overlap fixed + Kevin & Dylan cards (photos pending)
- Rosa overlap fix: .hp-meet-photo-wrap gets clamp(2rem,8vw,9rem) left padding and the
  photo right-aligns, so the navy MEET card (narrowed to 300px) sits mostly on background
  and only kisses the photo's left edge — her face/body fully visible. Mobile: card
  drops below the photo (static, -2.5rem pull-up).
- NEW team row under the meet grid: Kevin Poler ("Realtor Associate" — his signature
  title) + Dylan Poler ("The Poler Team") as horizontal cards w/ 96px round portrait
  slots. Currently navy KP/DP MONOGRAMS (ids hp-kevin-photo / hp-dylan-photo) because
  the real photos are NOT findable: searched local disk (mdfind+find: only Rosa),
  Cloudinary (0 hits), Optimar associates page (Rosa only), Kevin's IG avatar (casual,
  not the white-shirt realtor shot), rosaandkevin.com + thepolerteamhotels.com (both
  dead), Bridge /members (404 on this token tier), Gmail Market Leader thread (Rosa's
  photos). TO SWAP: replace the .hp-team-mono divs with <img class="hp-team-photo">
  once Kevin provides kevin white-shirt realtor photo + Dylan's dylan@poler.org Google
  avatar. Verified live: card no longer covers Rosa, team row renders + reveals.

## Change 21 — Homepage preview round 3 (2026-08-19 evening, DEPLOYED)
- Hero now `min-height: 100dvh` (fills the whole first screen; video continues under the fold). Killed the hairline under the nav (`.lp-header`/`.lp-nav` border-bottom: none).
- Nav: removed Advanced Search; added "Listings" second (after Home) -> /listing; Home now points at index-preview (was wrongly /listing).
- Contact / Call Us / all "Let's Connect"/"Work With Us" CTAs open an ON-PAGE popup (#hpl-overlay) instead of navigating to listing?signup=1.
- New popup: Full Name / Email / Phone / "When do you plan to buy?" select / optional message textarea -> POST /api/save-lead (notes = "Homepage message: ...", listingAddress "Homepage Contact"). Sets poler_lead_v1 on success, fires fbq Lead if pixel present.
- Popup policy: non-Meta visitors = click-only, closable (X / backdrop / Esc). Meta traffic (fbclid / meta utm_source / FB-IG referrer, sessionStorage poler_meta_visitor) = same gate dynamic as listing: auto-open 10s, X hidden (gated class). Verified live both ways.
- hp-work "or call us at" now lists (954) 235-4046 · (305) 799-7290 · (954) 610-6975, with more space under the Let's Connect button (margin-top 1.8rem).
- Still open: Kevin + Dylan real photos (monogram placeholders), fold-in to live index.html on approval, git cleanup/commit.

## Change 22 — HOMEPAGE LIVE + unified nav (2026-08-19 ~21:15, DEPLOYED)
- Hero video reliability (3 rounds): resume-on-visible listeners + 2s watchdog; rotation refactored (1s tick, 9s cadence) that NEVER advances to a clip with readyState < 3 — empty-video "photos passing through" is impossible now. Clips briefly downgraded to 720p then restored to 1080p per Kevin (quality > first-paint; guard handles loading).
- FOLD-IN DONE: index-preview.html -> index.html (old corporate homepage replaced; recoverable at git 3a12dec). Carried over full SEO head (title/description/canonical/OG/Twitter) + RealEstateAgent JSON-LD from old index. index-preview deleted (404 live). Home/logo links -> "/".
- Nav unified across ALL pages (index, listing, str, preconstruction, home-valuation): Home(/) · Listings(listing) · Preconstruction · Short-Term Rentals · Home Valuation · About(/#hp-meet) · Contact · phone. Advanced Search links removed from listing + home-valuation navs. i18n key navListings added (EN/ES/PT). Old index.html#about links on 5 pages -> /#hp-meet. Fixed double-active on listing nav.
- Still open: Kevin+Dylan photos (monograms live), git cleanup/commit of the whole day.

## Change 23 — Morning fixes + mobile pass (2026-08-20, DEPLOYED)
- Homepage arrival: hero fallback is now hero-poster.jpg (ffmpeg first frame of the beach clip) — no more strange-house photo before the video. First clip reveals on 'playing' (fades from identical frame).
- Nav flash saga RESOLVED (real cause): /listing's empty #results-grid collapsed to 0 height on first paint, flashing the agent banner (Rosa photo, "REALTOR/South Florida" text) at the top until cards injected. Fix: `#results-grid:empty { min-height: 100vh; }`. Also restored the unconditional white click-fades (the pagereveal gating regressed them) + kept @view-transition with animations disabled (instant swap; helps back/forward).
- POPUP BUG: the scroll trigger (past 3rd card) opened the lead gate for EVERYONE — now inside the Meta-only gate. Days on market added to grid cards ("New today" when 0; EN/ES/PT).
- MOBILE pass (375px, all pages checked): meet-card no longer overlaps Rosa's photo (margin 1rem, no -2.5rem pull), 3 phone numbers stack (no page overflow), .hpl-card clamped to calc(100vw - 2rem) (was overflowing right edge), hero + valuation orphaned bar icons hidden. Listing/STR/valuation pages verified OK on mobile.

## Change 24 — Mobile hamburger menu (2026-08-20, DEPLOYED)
- New self-contained nav.js on all 5 pages (index/listing/str/preconstruction/home-valuation): <=900px hides .lp-nav-links, shows hamburger; full-screen navy drawer clones each page's own nav links (per-page Contact behavior preserved: popup on index/listing, listing?signup=1 elsewhere), logo + X, closes on link tap/Esc, body scroll lock. Injects its own CSS (works on preconstruction, which doesn't load listing.css).
- Verified on all 5 pages at 375px: burger + 8-link drawer + no horizontal overflow; Contact opens the right popup from the drawer on index and listing. Desktop 1280px unchanged (full link row, no burger). 900-1100px shows the burger too (links wouldn't fit).

## Change 25 — Property-type accuracy + mobile filter width (2026-08-20, DEPLOYED)
- Type filter restructured to 4 buckets (Kevin): Single Family Home / Condo+Co-op+Villa / Townhouse / Multifamily. Feed-verified subtypes: sfr=[Single Family Residence], condo=[Condominium, Stock Cooperative, Villa], town=[Townhouse], multi=[Multi Family, Duplex, Triplex, Quadruplex]. i18n keys updated + townhouseOpt added.
- CRITICAL FIX: Multifamily returned ZERO — those subtypes live under PropertyType "Residential Income", not "Residential". buildSearchParams now swaps to PropertyType.in=Residential,Residential Income (or Residential Income alone) when multi is checked. Verified: 1,291 results via the real page pipeline.
- Accuracy proven live per bucket: each returns only its own subtypes; combos return the union.
- Mobile (<=520px): all filter controls now span full width (fb-select/fb-multi-btn/fb-price/fb-input/fb-more-toggle 100%) with max-width/min-width clamps on .filter-bar/.filter-bar-row/.filter-bar-item — without the clamp the row sized to its widest child (368px) and spilled past the right padding.
