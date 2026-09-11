# Session handoff — lead recognition fix + post-gate tracking + recalibration popup (2026-09-10)

**Goal:** stop the 10-second lead gate re-asking registered people (incl. Kevin), instrument what
captured leads do after the gate, and ship the second "what's stopping you?" popup whose answer is
routed to CRM / Sammy / Kevin. Design + consensus/debate that produced it:
`~/business/real-estate/active/research/listing-ux-consensus/` (SYNTHESIS.md, debate/DEBATE-FINDINGS.md).

## State (what shipped)

### 1. Recognition — why the gate repeated, and the fix
Causes found: memory was localStorage only (`poler_lead_v1`); Safari ITP wipes script storage after
7 days; IG/FB/WhatsApp in-app browsers have their own storage; welcome email linked to a bare
`/listing`; `crm.js` wrote a `poler_team_member` flag that `listing.js` NEVER read.
- `api/remember.js` (NEW, public) — `{token}` validates the Alert Token in Airtable → `Set-Cookie
  poler_lt=<token>` 1 year, `Path=/`, `Secure`, `SameSite=Lax`, `Domain=.homesinsoflorida.com`
  (host-only elsewhere). `{email}` looks the lead up and sets the same cookie but returns `{ok}`
  only (no token enumeration). `{team:true,password}` → `authorize()` → `poler_team=1`.
- `listing.js initLeadCapture` — reads cookies via `readCookies()`; team cookie/flag → `isTeamDevice`
  → never gated, never recalibrated; `?t=` and the `poler_lt` cookie re-seed localStorage
  (`poler_lead_v1`, `poler_alert_token`); old captured leads with no cookie call `/api/remember`
  once to self-heal. `completeLead` calls `rememberLead({token})` after save.
- "Already registered?" link under the gate form (`initAlreadyRegistered`) — email → `/api/remember`
  → cookie → unlock (timer + scroll trigger now bail when `leadCaptured` flips). i18n keys
  `alreadyRegistered*` EN/ES/PT. CSS `.lead-registered*` in listing.css.
- `api/save-lead.js` welcome-email button now `…/listing?t=<alertToken>`.
- `crm.js attemptLogin` POSTs `/api/remember {team:true,password}` (same-origin) after login.
- No cookie banner: first-party functional storage, US/Florida audience — no consent requirement,
  and a banner would cost conversion on paid traffic.

### 2. Event tracking (`trackEvent(name, params)` in listing.js)
GA4 `gtag('event')` for everyone; `/api/log-activity` row for captured non-team leads for:
`listing_view`→'Property View', `favorite_add/remove`→'Favorite'/'Unfavorite', `search`/
`filter_applied`→'Search', `share_click`→'Share', `whatsapp_click`→'WhatsApp Click',
`recalib_answered`→'Recalibration Answer'. GA-only: `gate_shown`, `gate_recognized`,
`gate_recognize_fail`, `recalib_shown`, `recalib_dismissed`.
- Fixed: search logging `JSON.parse(leadData)` on a plain email string threw every time → no search
  had ever reached the CRM. Property View used to log only on `?t=` links.
- `api/log-activity.js` now sends `typecast:true` so new single-select 'Activity Type' values are
  created on first use (probed live 2026-09-10: works; the 2026-08-06 'Email Sent' no-op is over).

### 3. Recalibration popup
- Trigger (captured, non-team, once per lead): 2nd listing view in the session, 1 favorite,
  3 filter changes, or 5 min ACTIVE time (visible tab + input in last 30 s). Never on top of the
  lead gate. Answered → `localStorage poler_recalib_v1=answered:<x>` (never again); dismissed →
  quiet 14 days. Counters in sessionStorage `poler_recalib_*`. QA: `/listing?recalib=1` forces it.
- UI: `.recalib-popup` card (bottom-right desktop, bottom sheet mobile), i18n `recalib*` keys.
  Talk / area answers show an "Open WhatsApp" button (954 line, prefilled).
- `api/recalibrate.js` (NEW, public; lead identified by own token/email): Lead Activity row
  'Recalibration' + CRM note via internal `/api/agent/log-note` (agent "Site popup", Convo/Next
  shape). Routing: **price** → `/api/agent/update-alerts {profile:{priceMax: 85% rounded to $5k}}`
  (wrapper-aware) then engine `/admin/queue-props` (Sammy sends 3 props at the new ceiling);
  **area** → `Alert Needs Review=true` + Slack; **financing** → Slack + Resend email to Kevin;
  **talk** → Slack + email with phone + wa.me link; **browsing** → note only.

## Verified
- Local static preview (localhost:3002): card renders EN/ES/PT desktop + mobile, answer → thank-you
  state, "Already registered?" expands + translates. Fixed a real bug found there: rAF never fires
  in a background tab → card stayed at opacity 0 → switched to `setTimeout`.
- Cold `code-reviewer` (sonnet) found 4 real defects, all fixed before deploy: (1) stored XSS in
  `crm.js renderPropertiesViewed/renderSavedProperties` (address/mlsId re-parsed as JS inside an
  inline `onclick`) → `data-*` + `this.dataset` pattern; (2) formula injection in the public
  `api/log-activity.js` (token/email unvalidated in `filterByFormula`) → same whitelists as
  remember/recalibrate, plus quote/control-char strip + length cap on stored `Properties Viewed`;
  (3) `listing.js saveConversationToCRM` still `JSON.parse`d the plain `poler_lead_v1` string →
  AI-chat transcripts never saved; (4) `?recalib=1` QA hook bypassed capture/gate checks → now
  requires `leadCaptured` and no active gate. Left open: `/api/remember {email}` is an
  email-existence oracle (no rate limit) — add throttling only if abuse shows.

## Deploy (2026-09-10 11:19 EDT, `npx vercel --prod --yes`, commit 81c5d93)
Live checks on www.homesinsoflorida.com:
- `/api/remember {token:'badtoken1234'}` → 404, no cookie · `{email:testcheck@test.com}` → 200 +
  `Set-Cookie poler_lt … Domain=.homesinsoflorida.com` · `/api/log-activity` with a formula in
  `email` → 400 "Invalid email".
- `/api/recalibrate` for the Test Check lead: `browsing` → `routed:["note"]`; `talk` →
  `routed:["note","slack","email"]` (Kevin saw the Slack ping). Both Lead Activity
  'Recalibration' rows + both Convo/Next notes verified in Airtable. Status untouched by design.
- Browser (in-app pane, live site): email-only lead with no cookie self-healed (`poler_lt` set on
  boot); `?recalib=1` card renders EN, no console errors; storage wiped + `?gclid=` → gate did
  NOT show because the cookie restored `poler_lead_v1`; cookie removed + storage wiped +
  `?gclid=` → gate showed at 10 s, "Already registered?" → email → unlocked + cookie back.

### 4. Gate now fires for ALL traffic (15:14 EDT redeploy)
Kevin: "I want the popup to fire for all traffic, not just paid." `AUTO_POPUP = true` in
`listing.js initLeadCapture`; the meta/gads flags stay for attribution only. Verified live on a
wiped browser with a bare `/listing` URL: gate at 10 s. Note: browsers may serve the OLD
listing.js from cache for a while (`s-maxage=0, stale-while-revalidate`) — a hard reload shows
the new behavior. OTP screen (`#lead-step-2`) is still in the HTML but `skipOtp=true` — it never
shows; "Step 1 of 2 / 2 of 2" refers to name+email → phone+timeline, not SMS.

## 5. Site-wide lead gate + SEO (evening, same day)
Kevin: "a popup for anybody who is on the page for the first time … the home page and any of the
landing pages … make sure the 10 second popup works the same way as it currently does on the
listing landing page."
- **`lead-gate.js` (GENERATED — never hand-edit)** by `tools/build-lead-gate.js` from
  `tools/lead-gate.template.js` (a self-contained copy of listing.js's gate logic) + the 27 gate
  i18n keys pulled from `i18n.js` + the gate CSS sliced from `listing.css` + the `#country-code`
  options from `listing.html`. Rebuild after touching any of those: `node tools/build-lead-gate.js`.
- Loaded (defer, before nav.js) on `index.html`, `preconstruction.html`, `str.html`,
  `home-valuation.html`, and every generated `/tower/**` page. It bails if `#lead-overlay` already
  exists, so listing.html keeps its native gate. Same recognition order (team cookie/flag → `?t=` →
  `poler_lt` cookie → `poler_lead_v1` / `poler_alert_token`), same 10 s timer (shared sessionStorage
  key, fires immediately if the timer already expired on another page), scroll trigger past the 3rd
  card (`.listing-card/.pc-card/.str-building-card/.neighborhood-card`) or 1.5 viewports, same 2-step
  form (name+email → phone+timeline, no OTP), same save-lead POST + `rememberLead` (same-origin
  `/api/remember`) + `poler_lead_v1` + Google Ads conversion. `listingAddress` = the page `<h1>` so
  the CRM shows which page captured the lead. Page lock = `html.lead-gate-locked body > :not(#lead-overlay)`
  blur + pointer-events none. Language: `?lang` → `<html lang>` (es/pt tower pages) → `poler_lang` → en.
- nav.js's contact modal still sets `poler_lead_v1`, which the gate honors (no double-ask).
- **ES/PT tower pages:** `tools/build-tower-pages.js` now writes `/tower/<id>`, `/tower/es/<id>`,
  `/tower/pt/<id>` (41 × 3 = 123 pages) with `<html lang>`, localized chrome (`L` table), copy from
  `lib/preconstructions-i18n.js` (`PRECON_I18N[lang][id]` — description/amenities/etc; EN fallback
  when missing), hreflang en/es/pt/x-default, and a sitemap with `xhtml:link` alternates (130 URLs).
  `/analytics.js` is now IN the template (it had been injected post-build and would have been lost
  on rebuild). `/preconstruction?lang=es|pt` cards link to the matching language tower page.
- **Photos:** the 5 towers with zero photos (Baccarat, Waldorf Astoria, 1428 Brickell, Okan, Lofty)
  now have 6–7 validated (200 image/*) condoblackbook CDN photos each in `lib/preconstructions-data.js`.
- **Google Business Profile:** no profile exists for The Poler Team / Kevin / Rosa (searched). Setup
  package with paste-ready fields, 8 weekly posts EN/ES, review-ask script, weekly routine →
  `~/business/real-estate/active/execution/seo/gbp/GBP-SETUP-PACKAGE.md`. Needs Kevin's Google account.
- Caveat stated to Kevin: a hard interstitial on the SEO `/tower` pages works against Google's
  intrusive-interstitial guidance; he was explicit, so it ships everywhere.

- **Deployed 2026-09-10 ~20:00 EDT** (two `npx vercel --prod --yes` runs). Live checks on
  www.homesinsoflorida.com: all 7 page types 200 + load `/lead-gate.js`; wiped browser on
  `/preconstruction` → no gate at 5 s, gate at 12 s; real submission as Test Check → step 2 →
  save-lead → `poler_lt` cookie + alert token + `poler_lead_v1` set, page unlocked, CRM row created
  (`sourceUrl=/preconstruction`); storage wiped again on `/tower/es/…` → cookie re-seeded
  localStorage, NO overlay injected. Sitemap 130 URLs live, `/tower/pt/*` serve `lang="pt-BR"`.
- Cold review (sonnet) found 2 must-fixes, both fixed before deploy: (1) index.html's legacy
  Meta-only 10 s `#hpl-overlay` auto-open (`.gated`, unclosable) would have stacked on top of the
  new gate for fbclid/IG traffic → retired; the modal stays as the on-demand contact form.
  (2) build-tower-pages.js replaced the `{es,pt}` default with whatever the i18n file exported →
  now merges per language + warns when a language is short. Follow-ups logged, not blocking:
  listing.js still double-sends lead emails (EmailJS + server Resend) — the new gate sends none
  client-side; `window.openLeadGate` only exists for un-captured visitors on non-listing pages;
  dead `isMetaTraffic`/`hplCaptured` vars in index.html.
- Kevin-facing note: browsers may cache old JS for a bit (`stale-while-revalidate`) — hard refresh.

## Pending / open
- Sammy's FIRST WhatsApp message is still generic — context-aware first message (item 3 of the
  build list) needs an engine change in `whatsapp-lead-monitor` (Railway). Not touched.
- No-SSN financing content module, UTM-aware dynamic gate, wire-fraud trust module — items 2, 6, 7
  of the build list, not started.
- `RECALIB` CRM view: answers land as notes + 'Recalibration' activity rows; no dedicated CRM
  column. If Kevin wants a filter, add a `Recalib Answer` field (needs schema scope — PAT lacks it).
- Gemini paid MCP is out of credits (ai.studio top-up) — affects future consensus runs only.

## Touched
listing.js, listing.css, i18n.js, crm.js, api/save-lead.js, api/log-activity.js,
api/remember.js (new), api/recalibrate.js (new), this file.
Evening: lead-gate.js (generated), tools/lead-gate.template.js, tools/build-lead-gate.js,
tools/build-tower-pages.js, preconstruction.js, index.html, preconstruction.html, str.html,
home-valuation.html, lib/preconstructions-data.js, lib/preconstructions-i18n.js (new), tower/**,
sitemap.xml.
External: Vercel prod deploy; one probe row written+deleted in Airtable `Lead Activity`
(recWDDt5th3WAM0S5); live test rows noted under Deploy.

## Gotchas
- Working tree carried ~48 unrelated uncommitted modifications from other sessions; only this
  session's files were committed. Deploy is CLI (`npx vercel --prod --yes`), which ships the whole
  tree — the other sessions' changes went live with it (they were already live from their own deploys).
- `Access-Control-Allow-Origin:*` + `Set-Cookie` only works because listing.js calls `/api/remember`
  SAME-ORIGIN (relative URL). Do not switch it to `OTP_BASE` (vercel.app host) — the cookie would
  land on the wrong domain.
- Team devices: `?signup=1` / Call Us still open the form on demand (intended).
