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

Condensed — **full tree → [`docs/file-structure.md`](docs/file-structure.md).**

```
listing.html / listing.js      # Listing landing page + lead-capture popup
index.html                     # homesinsoflorida.com home
crm.html / crm.js              # The CRM UI (sidebar nav + all views)
api/                           # Vercel functions — one file per endpoint
  _auth.js                     #   shared auth (Bearer AGENT_API_TOKEN | CRM_PASSWORD)
  _leadgen.js                  #   Lead Generation helpers (agency positive replies)
  get|save|update-lead*.js     #   RE leads (Airtable `Leads`)
  *-consulting-*.js            #   Consulting module
  *-leadgen-*.js               #   Lead Generation module
  send-alerts.js               #   daily property alerts (vercel.json cron)
  agent/                       #   agent-facing endpoints (ai-calls, save-recording, oauth)
  mcp.js                       #   hosted MCP — ~50 `mcp__poler-crm__*` tools
lib/                           # shared server helpers (crm-contacts, email-extract)
docs/                          # OMs, PDFs, reference docs (incl. the two split-out above)
.claude/skills/                # 7 project-scoped skills — see the Skills section
```

## Skills — invoke by task, don't improvise

**This repo owns 7 project-scoped skills** in `.claude/skills/`. They auto-load for sessions under this directory and NOWHERE else — if you're working from `real-estate/` or `agency/`, read the SKILL.md by path instead.

| Task | Skill |
|---|---|
| Adding ANY endpoint under `api/` or `api/agent/` | **`new-agent-endpoint`** — scaffolds it on the `_auth.js` convention. Use it every time; hand-rolled endpoints drift. |
| Changing the email→CRM pipeline (`api/cron/process-emails.js`) — classification, routing, what gets written | **`crm-email`** |
| Meta or Google ad campaigns, CPL optimization, creatives | **`real-estate-ads-manager`** |
| Google Search Ads specifically (Eric Preston methodology) | **`google-ads-eric-preston`** |
| Organic social — IG/FB posts, captions, content calendar | **`social-media-manager`** |
| LinkedIn posting + engagement | **`linkedin-engagement`** |
| Sourcing distressed/motivated-seller boutique hotels (Miami-Dade + Broward) | **`distressed-hotel-finder`** |

Global skills that apply here too: **`crm-note-format`** (mandatory for every CRM note — humans, Claude, and the runtime writers), **`managing-email`** (draft into the session, never an inbox draft; explicit send order = send, no second ask), **`new-claude-md`** for this file, `systematic-debugging`, `ui-ux-pro-max` / `impeccable` for CRM UI work, and the `qa` subagent before anything ships to the live CRM.

## Design System

Navy `#1a2744` primary · `Playfair Display` headings · `Inter` body · bg `#f8f9fb`. All values are CSS variables (`--color-navy`, `--font-heading`, …) — **never hardcode a hex.** Full token table → [`docs/design-system.md`](docs/design-system.md).

## Key Features

- **Lead capture** (`listing.js`) — popup → `/api/save-lead`; auto-generates the lead's access password.
- **Property alerts** (`api/send-alerts.js`) — daily Vercel cron, matches each lead's Alert* fields against Bridge MLS.
- **CRM dashboard** (`crm.js`) — sidebar nav → per-view render; RE leads, Consulting, Lead Generation.
- **Trilingual i18n** — EN/ES/PT on the public pages.

Implementation detail for each → [`docs/key-features.md`](docs/key-features.md).

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

**Every session that changes anything here writes a handoff before it ends** — dated `SESSION_HANDOFF_<topic>_<date>.md`, covering what changed, what's deployed, and what's still open. A session that skips it leaves the next one guessing against a live CRM. Template + full procedure → [`docs/session-handoffs.md`](docs/session-handoffs.md).

## CRM Architecture (added 2026-05-14, was missing from original CLAUDE.md)

The CRM (`/crm`) has two distinct sections in the left nav:
- **Real Estate**: Dashboard, All Leads, Reminders, Listings, **AI Calls**, Export CSV — driven by `Leads` table in Airtable
- **CONSULTING**: Companies, Opportunities, Pipeline, Reminders, Partners — driven by `Consulting Clients` / `Consulting Deals` / `Consulting Contacts` / `Consulting Tasks` / `Consulting Activity` / `Consulting Partners` Airtable tables

**AI Calls tab** (2026-06-08): in-CRM view of Sammy's AI voice calls — pickup, recording playback, note/reminder/alert checkmarks. Backed by `api/agent/ai-calls.js` (+ `ai-call-audio.js` proxy), needs the `ELEVENLABS_*` Vercel envs. **Full detail → [`docs/crm-internals.md`](docs/crm-internals.md).**

Backend endpoints for consulting live at `api/get-consulting-*.js`, `api/save-consulting-*.js`, `api/update-consulting-*.js`, `api/delete-consulting-*.js`, plus `api/log-consulting-activity.js` and `api/stamp-last-contact.js`.

The hosted MCP server at `api/mcp.js` exposes ~50 tools as `mcp__poler-crm__*`, used by Claude.ai connectors on the Poler Team's accounts. The local MCP at `~/poler-team-mcp/index.js` exposes the same tools.

**Flash live-coach panel** (2026-06-19): the lead panel embeds Flash (`saas-portfolio/clairvo-clone`, Vercel `flash-coach`) as an origin-checked iframe pre-locked to the open lead. **Full detail → [`docs/crm-internals.md`](docs/crm-internals.md).**

## Email → CRM Auto-Sync (added 2026-05-11/14)

Cron at `api/cron/process-emails.js` runs every 5 min (triggered externally by cron-job.org — Vercel Hobby blocks sub-daily crons). Reads each authorized Gmail inbox (rows in Airtable `Team Inboxes` table, populated by the OAuth flow at `api/agent/gmail-oauth-start.js` → `gmail-oauth-callback.js`), matches sender against CRM (Leads + Consulting Contacts + Consulting Clients email), summarizes via Claude Haiku (`lib/email-extract.js`), writes notes + activity entries, uploads attachments classified into Contracts/Deliverables/Spreadsheets/Misc.

Forward detection: when sender is internal (`@poler.org`), the body is scanned for the original external sender and that's used for matching — so a teammate forwarding a client email lands on the actual client's CRM record.

`lib/` directory holds the cron's helpers: `gmail.js` (Gmail API), `email-extract.js` (Anthropic), `crm-contacts.js` (email→record index), `team-inboxes.js` (Airtable CRUD).

## Buyer Leads under Listings (added 2026-07-03)

Buyer/broker contacts for OUR listings (LoopNet favorites, cold-campaign repliers, CDX) do NOT belong in the main leads dashboard — Kevin's dashboard is for inbound ad/website leads only. Convention: create them as normal Leads records with `Source URL = "buyer:<MLS#>"` (e.g. `buyer:A11967447` = The Lauderdale). `crm.js isBuyerLead()` hides them from the dashboard table/stats/CSV; the Listings tab → listing panel shows them in its "Buyer Leads" section (`renderListingBuyerLeads`), sorted by status, click-through to the full lead panel. Reminders/notes on them work normally.

## Learnings

Split out to keep this file lean → [`.claude/rules/learnings.md`](.claude/rules/learnings.md). Append new dated `[FAIL]`/`[WIN]`/`[FAST]` entries there, not here.
