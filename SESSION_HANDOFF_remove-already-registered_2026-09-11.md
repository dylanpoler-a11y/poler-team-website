# Handoff — remove "Already registered?" from the lead gate — 2026-09-11

**What changed (deployed to prod 2026-09-11 ~17:50 ET, commit after 681e559):**
- Removed the "Already registered?" email-lookup toggle from the lead gate on listing (`listing.js` `initAlreadyRegistered` + call) and site-wide (`tools/lead-gate.template.js` IIFE), rebuilt `lead-gate.js` via `node tools/build-lead-gate.js` (23 i18n keys now).
- Dropped its CSS block from `listing.css` and 4 i18n keys (`alreadyRegistered*`) from `i18n.js`; `tools/build-lead-gate.js` no longer slices `regCss`.
- Reason (Kevin): the 1-year first-party cookie (`api/remember.js`, `Max-Age=31536000`, set on every registration via `rememberLead({token})`) already skips the gate for returning leads, so the manual lookup was redundant clutter on the form.

**Untouched:** `api/remember.js` keeps its email-lookup branch (harmless, nothing calls it from the UI now). Recognition cookie, `?t=` re-seed, team-device bypass, recalibration popup all unchanged.

**Verified:** curl of live listing.js / lead-gate.js / listing.css / i18n.js → 0 hits for `alreadyRegistered|lead-registered`; gate screenshot on /listing after clearing `poler_lt` shows Step 1 with no lookup link; with the cookie present the gate does not open at all.

**Meta CPL context (act_1178293800093653, Housing-SAC campaign, cost per `lead`):** 9/4 $0.57 · 9/5 $0.96 · 9/6 $0.62 · 9/7 $0.74 · 9/8 $0.49 · 9/9 $0.58 · 9/10 $0.52 (feature shipped 11:21 AM) · 9/11 $1.47 (partial day, 2 leads on $2.94 as of 5:40 PM). Too little post-change data to attribute anything to the lookup link. Google Ads: all campaigns paused, $0 spend last 14 days.

## 9/11 CPL check (7:21 PM ET) — Kevin flagged today as the worst day
- Meta (cost per `lead`): 8/25 $1.64 (creative launch day) · 8/26–9/10 range $0.45–$0.97 · **9/11 $1.63 on $3.26 / 2 leads** → tied-worst since the 8/25 relaunch. CRM shows 3 Meta listing leads today (08:46, 12:14, 16:19) + 1 /preconstruction at 07:59 (deploy minute, likely a test).
- Decomposition: CPM $1.09 and CTR 9.2% flat → not the ads. Landing page views 69 vs 119–134 the prior 4 days (delivery ~half). GA4 gate funnel: 9/10 gate_shown 122 → form_start 17 (14%); **9/11 gate_shown 54 → form_start 3 (5.6%)**. People see the gate and don't start typing.
- Nothing shipped to the listing page today before 17:41 (the lookup removal); the "Already registered?" link was live all of 9/10 (best CPL day, $0.52) and all of today up to 17:41, so it is not the cause either way. Listing gate code = 81c5d93 (9/10 11:21) + 8125161 (all-traffic, no effect on Meta). No double gate on /listing (lead-gate.js only on /, /preconstruction, /str, /home-valuation, /tower/*).
- n = 54 gate views / 3 form starts — too small to call. **Watch 9/12:** if gate_shown→form_start stays under ~8% and CPL > $1, roll listing.js/listing.css/i18n.js back to pre-81c5d93 (`git checkout 3182bab -- listing.js listing.css i18n.js`, keep api/) and re-measure.
