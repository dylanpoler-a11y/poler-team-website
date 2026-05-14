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
- Name, phone, email, "how soon do you plan to buy" (all required)
- OTP phone verification (Brazil/PT visitors skip OTP)
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
cd /Users/kevinpoler/poler-team-website
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

Location: `<project>/.claude/handoffs/YYYY-MM-DD-HHMM-<short-slug>.md` (use `~/poler-team-website/.claude/handoffs/`).

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
- **Real Estate**: Dashboard, All Leads, Reminders, Export CSV — driven by `Leads` table in Airtable
- **CONSULTING**: Companies, Opportunities, Pipeline, Reminders, Partners — driven by `Consulting Clients` / `Consulting Deals` / `Consulting Contacts` / `Consulting Tasks` / `Consulting Activity` / `Consulting Partners` Airtable tables

Backend endpoints for consulting live at `api/get-consulting-*.js`, `api/save-consulting-*.js`, `api/update-consulting-*.js`, `api/delete-consulting-*.js`, plus `api/log-consulting-activity.js` and `api/stamp-last-contact.js`.

The hosted MCP server at `api/mcp.js` exposes ~50 tools as `mcp__poler-crm__*`, used by Claude.ai connectors on the Poler Team's accounts. The local MCP at `~/poler-team-mcp/index.js` exposes the same tools.

## Email → CRM Auto-Sync (added 2026-05-11/14)

Cron at `api/cron/process-emails.js` runs every 5 min (triggered externally by cron-job.org — Vercel Hobby blocks sub-daily crons). Reads each authorized Gmail inbox (rows in Airtable `Team Inboxes` table, populated by the OAuth flow at `api/agent/gmail-oauth-start.js` → `gmail-oauth-callback.js`), matches sender against CRM (Leads + Consulting Contacts + Consulting Clients email), summarizes via Claude Haiku (`lib/email-extract.js`), writes notes + activity entries, uploads attachments classified into Contracts/Deliverables/Spreadsheets/Misc.

Forward detection: when sender is internal (`@poler.org`), the body is scanned for the original external sender and that's used for matching — so a teammate forwarding a client email lands on the actual client's CRM record.

`lib/` directory holds the cron's helpers: `gmail.js` (Gmail API), `email-extract.js` (Anthropic), `crm-contacts.js` (email→record index), `team-inboxes.js` (Airtable CRUD).
