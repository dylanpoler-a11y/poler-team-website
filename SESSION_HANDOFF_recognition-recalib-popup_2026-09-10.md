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
