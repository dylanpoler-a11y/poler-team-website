# homesinsoflorida.com — Listing Landing Page & CRM

> **Live:** [homesinsoflorida.com](https://www.homesinsoflorida.com)
> **CRM:** [homesinsoflorida.com/crm](https://www.homesinsoflorida.com/crm)
> **GitHub:** [kevinpolermiami/homesinsoflorida](https://github.com/kevinpolermiami/homesinsoflorida)
> **Deployed via:** Vercel CLI (`npx vercel --prod --yes`) — NO Git auto-deploy

## ⚠️ CRITICAL: Domain Separation

This repo serves **homesinsoflorida.com ONLY**. Do NOT confuse with:
- **thepolerteam.com** — Dylan's separate project, NOT connected to this Vercel deployment
- **InvestorOS1** — separate app at `/Users/kevinpoler/investor-os`
- **DealAnalyzer** — separate project at `/Users/kevinpoler/Documents/DealAnalyzer`

If unsure which site to work on, ASK before making changes.

## Architecture

Static HTML/CSS/JS website — no build step, no framework. Vercel serves the files directly with serverless API functions.

### File Structure

```
/
├── CLAUDE.md               # This file — project context for Claude Code
├── .gitignore
├── vercel.json             # Cron config for daily alerts
│
├── # Listing Landing Page (homesinsoflorida.com/listing)
├── listing.html            # Listing page HTML (lead capture popup, property display)
├── listing.js              # Listing page logic (10-sec timer, OTP verification, alerts)
├── listing.css             # Listing page styles
├── i18n.js                 # Trilingual translations (EN/ES/PT)
│
├── # CRM Dashboard (homesinsoflorida.com/crm)
├── crm.html                # CRM dashboard HTML
├── crm.js                  # CRM logic (leads table, filters, lead details panel)
├── crm.css                 # CRM styles
│
├── # Alert Preferences (homesinsoflorida.com/preferences)
├── preferences.html        # Lead alert preferences page
├── preferences.js          # Preferences logic
├── preferences.css         # Preferences styles
│
├── # Other Pages
├── index.html              # Main landing page (Poler Team branding — DO NOT MODIFY without explicit request)
├── styles.css              # Main page styles (DO NOT MODIFY without explicit request)
├── script.js               # Main page JS (DO NOT MODIFY without explicit request)
├── privacy.html            # Privacy policy
│
├── # API Functions (Vercel serverless)
├── api/
│   ├── save-lead.js        # Saves new leads to Airtable
│   ├── get-leads.js        # Fetches leads for CRM
│   ├── update-lead.js      # Updates lead fields (status, agent, notes, etc.)
│   ├── send-alerts.js      # Daily cron: sends property alert emails via Resend
│   ├── send-test-alert.js  # Sends test alert email for a single lead
│   ├── send-otp.js         # Sends OTP verification code
│   ├── verify-otp.js       # Verifies OTP code
│   ├── generate-token.js   # Generates alert tokens for leads
│   ├── get-preferences.js  # Fetches lead alert preferences
│   ├── update-preferences.js # Updates lead alert preferences
│   ├── create-reminder.js  # Creates CRM reminders
│   ├── get-reminders.js    # Fetches CRM reminders
│   ├── update-reminder.js  # Updates CRM reminders
│   ├── chat.js             # AI chatbot API
│   ├── get-activity.js     # Lead activity log
│   ├── log-activity.js     # Logs lead activity
│   ├── save-conversation.js # Saves chat conversations
│   └── get-conversations.js # Fetches chat conversations
│
├── # Assets
├── logo.png / logo-white.png / pt-circle.png
├── favicon.ico / favicon-192.png / favicon-512.png / apple-touch-icon.png
├── team-*.jpg, ig-post-*.jpg, *.mp4  # Team/media assets
```

## Design System

| Token | Value |
|-------|-------|
| Navy (primary) | `#1a2744` — `var(--color-navy)` / `var(--color-accent)` |
| Navy light | `#243656` — `var(--color-accent-light)` |
| Navy dark | `#111c33` — `var(--color-accent-dark)` |
| Background | `#f8f9fb` — `var(--color-bg)` |
| Card bg | `#ffffff` — `var(--color-bg-card)` |
| Text primary | `#1a2744` — `var(--color-text)` |
| Text muted | `#718096` — `var(--color-text-muted)` |
| Heading font | `Playfair Display` — `var(--font-heading)` |
| Body font | `Inter` — `var(--font-body)` |

## Key Features

### Lead Capture (listing.js)
- 10-second countdown timer → locks page with modal
- **2-STEP form (2026-06-24):** Step 1 = Full Name (`#lead-name`) + email (`#lead-fields-1`); Step 2 = phone + timeline (`#lead-fields-2`). `goToContactStep()` reveals Step 2 + swaps title/subtitle/indicator/button copy. The single name field is split on whitespace into First/Last for the CRM. Conversion pixel (`fbq Lead` + gtag) + `/api/save-lead` fire ONCE, on Step 2 completion (`completeLead`) — Step 1 saves nothing. Bail-out (Step-1-only) email capture is NOT built yet (would need a quiet dedupe endpoint; `save-lead` always creates + notifies). i18n keys: fullName, continueBtn, contactTitle, contactSubtitle, step1of2, step2of2, timelineLabel, errSelectTimeline.
- OTP phone verification is DISABLED (`skipOtp=true`); the old `#lead-step-2` OTP markup + otp-* handlers are dead but left in place.
- Country detection via ISO code from dropdown
- Returning leads from alert emails bypass popup via `?t=TOKEN` parameter
- Leads saved to Airtable via `/api/save-lead`

### Property Alerts (api/send-alerts.js)
- Daily cron at 9am sends matching property alerts
- Uses Bridge API for MLS data
- Emails sent via Resend
- Alert links include lead token for popup bypass

### CRM Dashboard (crm.js)
- Leads table with sorting, filtering, search
- Lead detail panel with notes, status, agent assignment
- Reminders system
- CSV export
- MapLibre GL JS map with polygon drawing for alert areas

### Trilingual i18n (EN/ES/PT)
- All translatable text uses `data-i18n` attributes
- Translations in `i18n.js`
- Language stored in localStorage as `poler-lang`

## Deployment

```bash
cd /Users/kevinpoler/business/real-estate/poler-team-website
npx vercel --prod --yes
```

There is NO Git-based auto-deploy. Every deployment must be done manually via CLI.

## Conventions

- **No build step** — edit files directly, deploy via Vercel CLI
- **CSS custom properties** — always use `var(--color-*)` and `var(--font-*)`, never hardcode values
- **i18n** — every user-facing string must have `data-i18n` attribute with translation in all 3 languages
- **Responsive** — mobile-first design
- **Airtable** — all lead data stored in Airtable (Leads table)

## Collaboration

- **Kevin** (kevinpolermiami) — primary developer, works on listing page & CRM
- **Dylan** (dylanpoler-a11y) — works on thepolerteam.com (SEPARATE project)
- **Rosa** — team member / agent

## Session Handoffs (Mandatory)

When the system reminder fires that **context is getting full (~75–80%)**, **immediately** write a session handoff and KEEP UPDATING IT for the rest of the session. Do NOT wait for auto-compact — compact summaries are lossy by design.

Location: `<project>/.claude/handoffs/YYYY-MM-DD-HHMM-<short-slug>.md` (use `~/business/real-estate/poler-team-website/.claude/handoffs/`).

Required sections in every handoff:
- **Goal**: one sentence on what this session is trying to do
- **State**: what's done — be specific (file:line refs, deployment URLs, commit SHAs, Airtable record IDs)
- **Pending**: exact next step, command-ready if possible
- **Touched**: every file modified, every external system mutated (Vercel deploys, Airtable writes, env-var changes, git commits)
- **Gotchas**: stashes, uncommitted work, half-deployed changes, things the next session would step on

After writing it once, UPDATE the same file after every meaningful subsequent action until the session ends. A handoff written once at 80% is stale by 81%.

**Why this is here:** 2026-05-11 session left lib/* and api/agent/*.js uncommitted on disk; next session inherited a stale working tree and deployed a partial codebase, silently dropping ~80 endpoints from production. A live handoff would have warned the next session that those files existed only on disk and on the Vercel deployment, not in git. Committing the active work to `main` is the other half of this defense.

## CRM Architecture (added 2026-05-14, was missing from original CLAUDE.md)

The CRM (`/crm`) has two distinct sections in the left nav:
- **Real Estate**: Dashboard, All Leads, Reminders, Listings, **AI Calls**, Export CSV — driven by `Leads` table in Airtable
- **CONSULTING**: Companies, Opportunities, Pipeline, Reminders, Partners — driven by `Consulting Clients` / `Consulting Deals` / `Consulting Contacts` / `Consulting Tasks` / `Consulting Activity` / `Consulting Partners` Airtable tables

**AI Calls tab** (added 2026-06-08): in-CRM view (`#ai-calls-view`, `switchView('ai-calls')` → `loadAICalls()`/`renderAICalls()` in `crm.js`). Shows Sammy's outbound/inbound AI voice calls with pickup, recording playback, and checkmarks (note / reminder / alerts / WhatsApp). Backed by `api/agent/ai-calls.js` (joins ElevenLabs Conversational AI — the call system of record — with the CRM by matching `conv_…` ids found in lead notes) + `api/agent/ai-call-audio.js` (recording proxy). Needs Vercel env `ELEVENLABS_API_KEY` + `ELEVENLABS_AGENT_ID` / `ELEVENLABS_RAPPORT_AGENT_ID` / `ELEVENLABS_INBOUND_AGENT_ID` (Kevin's own EL account, Creator tier). Chart via Chart.js CDN. The engine that PLACES the calls lives in `~/business/real-estate/whatsapp-lead-monitor/` (see `saas-portfolio/products/revenue-engine`).

Backend endpoints for consulting live at `api/get-consulting-*.js`, `api/save-consulting-*.js`, `api/update-consulting-*.js`, `api/delete-consulting-*.js`, plus `api/log-consulting-activity.js` and `api/stamp-last-contact.js`.

The hosted MCP server at `api/mcp.js` exposes ~50 tools as `mcp__poler-crm__*`, used by Claude.ai connectors on the Poler Team's accounts. The local MCP at `~/poler-team-mcp/index.js` exposes the same tools.

**Flash live-coach panel** (added 2026-06-19): the lead panel has a "🎯 Coach en vivo" button (`#panel-coach-start` in `crm.html`) that lazy-loads **Flash** (the AI sales-call coach, `~/business/saas-portfolio/clairvo-clone`, on Vercel project `flash-coach`) as an iframe at `flash-coach-tan.vercel.app/embed?leadId=&key=`, pre-locked to the open lead; ⛶ (`#panel-expand`) widens the panel (`.panel-expanded`). `crm.js`: `openFlashCoach`/`getFlashConfig`/`resetCoachSection`/`togglePanelExpand` + an **origin-checked** `handleFlashMessage` (the `message` listener) that, on `flash:call-ended`, appends the call summary to the lead via `/api/agent/log-note` (agent="Flash Coach"). **Post-call writes (2026-07-01, server-primary since 2026-07-03):** the note is a CALL SUMMARY per the `crm-note-format` skill (headerless `Convo:`/`Next:` bullets from the judge's `crmConvo`/`crmNext`) — NEVER Flash's coaching critique/score. Since 2026-07-03 **Flash's SERVER writes the note + follow-up reminder itself** right after judging (its `deliverToCrm` → `/api/agent/log-note` + `/api/create-reminder`, Bearer `AGENT_API_TOKEN`) — the old postMessage-only chain silently lost the note whenever the iframe died during the ~20s judge wait or the run route 500'd (Alfredo Carvajal). `handleFlashMessage` now reads `data.noteLogged`/`data.reminderCreated`: when set it only refreshes the panel; when false it falls back to writing from the browser as before (dueAt judged from the call's outcome; none for wrong-number/dead calls), then `loadReminders()` + re-renders. Flash's server also auto-activates the lead's PROPERTY ALERTS from the call's buy-box (`/api/agent/update-alerts`, Weekly/5) — only when the lead has no active alert profile yet, so it never clobbers a hand-tuned one; a separate LAND budget becomes a second profile via the `profiles` array (never blended into the house range). **Alert engine (2026-07-03):** profile type `Land` queries Bridge `PropertyType "Land/Boat Docks"` (subtypes Residential + Agriculture, residential-only filters stripped — `lib/alert-search.js`); multi-profile leads get ≥1 slot per profile in the capped email (fairness rule); email cards show lot size when a listing has no living area; Land checkbox in the CRM panel + `/preferences`. **Flash reminder policy (Kevin 2026-07-03):** judged cadence; ambiguous-but-real call → default 5 days; due 10:00 AM ET; a new Flash reminder auto-COMPLETES the lead's prior pending "Flash Coach" reminders (Sammy's + manual ones untouched). The iframe token comes from NEW gated `api/flash-config.js` (keeps `FLASH_EMBED_TOKEN` out of the public `crm.js`). Vercel env: `FLASH_EMBED_TOKEN` (must be byte-identical to the `flash-coach` Vercel project's value — set with `printf`, never `echo`; a trailing `\n` breaks the SHA-256 match and bounces the iframe to Flash's password gate, see 2026-06-22) + `FLASH_BASE_URL` (= `https://flash-coach-tan.vercel.app`). Flash owns the coaching brain; the CRM only launches it + logs the note. **Call recording (2026-06-24):** on a `flash:recording` postMessage, the same origin-checked `handleFlashMessage` saves the call audio to the lead via NEW `api/agent/save-recording.js` → the NEW `Flash Recordings` multilineText field on Leads (JSON `[{url,recordedAt,durationSec,callId}]`; audio lives on Vercel Blob, host-validated). `get-leads` maps `flashRecordings`; `renderFlashRecordings()` shows them under a "🎙️ Flash voice recordings" panel section (`#panel-recordings-section`, newest-first dated `<audio>` players). Flash itself captures + uploads the audio (its own gated `/api/recording` → `@vercel/blob`); the CRM only stores the URL + renders it. Full build notes: clairvo-clone CLAUDE.md §11 + memory `project_clairvo_clone_buildout`. **Panel-close = call ended (Kevin 2026-07-17):** every coach teardown (closePanel/overlay/Esc, coach ✕, lead switch in `populatePanel`) goes through `finalizeCoachSection()` — postMessages `flash:finalize` to the iframe (Flash stops the mic + submits the call = note/reminder/alerts, same as Detener) and blanks the src only after a 25s grace (`_coachBlankTimer`, cleared by `openFlashCoach`) so the submit/recording finish; NEVER call `resetCoachSection()` directly on a live coach. Re-opening the SAME lead leaves a live coach running (src leadId guard). Also 2026-07-17: `openPanel` adds `panel-expanded` by default — the lead panel opens in the WIDE view; ⛶ toggles it smaller.

## Email → CRM Auto-Sync (added 2026-05-11/14)

Cron at `api/cron/process-emails.js` runs every 5 min (triggered externally by cron-job.org — Vercel Hobby blocks sub-daily crons). Reads each authorized Gmail inbox (rows in Airtable `Team Inboxes` table, populated by the OAuth flow at `api/agent/gmail-oauth-start.js` → `gmail-oauth-callback.js`), matches sender against CRM (Leads + Consulting Contacts + Consulting Clients email), summarizes via Claude Haiku (`lib/email-extract.js`), writes notes + activity entries, uploads attachments classified into Contracts/Deliverables/Spreadsheets/Misc.

Forward detection: when sender is internal (`@poler.org`), the body is scanned for the original external sender and that's used for matching — so a teammate forwarding a client email lands on the actual client's CRM record.

`lib/` directory holds the cron's helpers: `gmail.js` (Gmail API), `email-extract.js` (Anthropic), `crm-contacts.js` (email→record index), `team-inboxes.js` (Airtable CRUD).

## Buyer Leads under Listings (added 2026-07-03)

Buyer/broker contacts for OUR listings (LoopNet favorites, cold-campaign repliers, CDX) do NOT belong in the main leads dashboard — Kevin's dashboard is for inbound ad/website leads only. Convention: create them as normal Leads records with `Source URL = "buyer:<MLS#>"` (e.g. `buyer:A11967447` = The Lauderdale). `crm.js isBuyerLead()` hides them from the dashboard table/stats/CSV; the Listings tab → listing panel shows them in its "Buyer Leads" section (`renderListingBuyerLeads`), sorted by status, click-through to the full lead panel. Reminders/notes on them work normally.

- 2026-07-03 [FAIL]: MCP `create_lead` posts `firstName/lastName/country/notes/assignedTo` to `/api/save-lead`, which expected `first/last/countryIso` — names+country silently dropped (9 nameless leads). Fixed server-side in save-lead.js (accepts both shapes) so both MCPs are covered; when adding an MCP tool that proxies an existing endpoint, diff the tool schema against the endpoint's destructured body field-by-field.
- 2026-07-03 [FAIL]: The Listings nav tab never opened — the sidebar click dispatcher in crm.js had a branch for every action EXCEPT `listings` (switchView existed, was just never called). When adding a nav item, grep the dispatcher for its data-action.
- 2026-07-13 [FAIL]: `api/agent/search-properties.js` PROPERTY_TYPE_ALIAS lacked the CRM's own Alert Property Types vocabulary — `propertyType=Single Family` passed through as a PropertySubType Bridge doesn't know → count 0, no error, and every Sammy drip/blast/button send for SFH-typed leads silently sent nothing. Added 'single family'/'multi family' aliases; keep in sync with `lib/alert-search.js` TYPE_MAP (email alerts already mapped it — only this endpoint was blind).
- 2026-07-16 [FAIL→fix]: "Flash didn't set a reminder" was a CRM-PANEL STALENESS bug, not a Flash bug — Flash's server DID create the no-answer retry reminder ~7s after the call (correct note + 10 AM ET). But `crm.js` rendered a lead's reminders from the page-load `allReminders` cache (`populatePanel`→`renderLeadReminders`) and NEVER re-fetched on panel open, so a reminder created after the tab loaded was invisible → Kevin re-added it by hand (Julian Niño ended up with 3 duplicate next-day Call reminders). Fix: `populatePanel` now fires `loadReminders()` then re-renders on open (instant cache paint first, no flicker); `handleFlashMessage` always refreshes reminders after a coached call (was gated on a well-formed `data.reminder`, so dead-lead calls with `followUp:null` never refreshed the panel). RULE: any panel showing rows another system mutates out-of-band (reminders, notes) must RE-FETCH on open, never render only the load-time cache — the 3rd "Flash didn't do X" false alarm traced to the panel not auto-refreshing.
