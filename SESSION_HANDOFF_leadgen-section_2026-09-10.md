# Session handoff — Lead Generation CRM section — 2026-09-10

## Goal
Third CRM bucket, **Lead Generation**: every outreach contact who replied (any sentiment except auto-replies), with reply text verbatim, editable sentiment, status pipeline, running summary — fed automatically by every reply source, all history backfilled. Real-estate leads stay in **Real Estate** (renamed from "Dashboard"); consulting-client outreach (Plaza San Miguel/Atrio, Mara-CSC) routes to **Consulting**; Keystone/Abrams → Lead Gen (Kevin).

## State (all DEPLOYED to prod — `npx vercel --prod --yes`, last deploy 2026-09-10 ~10:55)
- **UI:** `crm.html` / `crm.js` / `crm.css` — "REAL ESTATE" + "LEAD GENERATION" nav blocks, leads table with status/channel/campaign/sentiment filters, lead panel (editable sentiment + status, activity timeline, tasks).
- **Data:** Airtable `LeadGen Leads` tblK1nzerZMMUajCF / `LeadGen Tasks` / `LeadGen Activity` tbl5yTjB0NTS8JugA. Vocab in `api/_leadgen.js` (STATUSES / SENTIMENTS / CHANNELS).
- **Endpoints:** `api/get|save|update-leadgen-lead(s).js`, `api/get|log-leadgen-activity.js`, `api/get|create|update-leadgen-task.js`, and the ingest **`api/agent/leadgen-reply.js`** — rules drop auto/OOO/bounce/unsub (unless `force`), **idempotent on `messageId`** (`[mid:<id>]` in Details, FIND() pre-check over LeadGen Activity + Consulting Activity), consulting router by campaign/company regex, Sonnet sentiment + 2-line summary + next_step, upsert by sourceLeadId→email, optional `status` (never downgrades Won/Meeting Booked). Live-verified: 2nd push with same messageId → `skipped:'duplicate'`.
- **MCP:** hosted `api/mcp.js` + local `~/business/real-estate/poler-team-mcp/index.js` both expose `leadgen_list_leads / leadgen_ingest_reply / leadgen_update_lead / leadgen_log_activity / leadgen_get_activity` (ingest schema carries `messageId`, `status`, `force`). Local smoke-tested over stdio (`leadgen_list_leads sentiment=Positive` → 7).
- **Producers (live):**
  - Railway cloud-sender (`~/business/agency/active/execution/instantly-1k-rollout/cloud-sender/`): new `crm_push.py`; hooks in `inbox_watch.py` (HARD NO / OPT-OUT / REPLY), `smtp_sender.py` (direct / thread / optout), `gmail_outreach.py` (hard-no / colleague thread / IMAP sweep / API sweep). Deploy 5734128e SUCCESS; Railway env has `AGENT_API_TOKEN` + `CRM_API_BASE`. Failures → `state/crm_push_failed.jsonl`.
  - FB watcher `autonomous-agency/tools/fb_inbox_watcher.py` `_push_crm` — code live, **launchd plist ARCHIVED** (not scheduled; last FB DM 2026-08-14).
  - LinkedIn watcher `autonomous-agency/tools/li_inbox_watcher.py` (NEW) — Playwright scrape over the persistent profile + `--from-json` ingest; `LI_WATCH_ARMED=1` gate; plist parked at `~/Library/LaunchAgents/archive-launchd/com.kevinpoler.linkedin-inbox-watcher.plist`. **Blocked:** no LinkedIn Playwright profile exists and the Chrome-MCP tab is logged out; Kevin must run `cd ~/business/agency/autonomous-agency && .venv/bin/python -m tools.manual_linkedin_login`, then dry-run + screenshot before arming.
- **Backfill:** `cloud-sender/backfill_leadgen.py --go` under `railway run` — DONE 10:29–11:10: 193 pushes (169 repliers / 204 messages; 5 skipped auto, 1 unsub), 0 push failures. Live CRM now 165 Lead Gen rows — Negative 81 / Not Now 46 / Question 16 / Positive 15 / Neutral 7; status New 103 / Lost 61 / Meeting Booked 1 (all channel `Email`). Sources: `autoresearch/data/reply_events.jsonl` (458 events, no bodies) + ledgers; text pulled from 30 mailboxes (IMAP `X-GM-RAW` + Gmail API). Excluded on purpose: 33 real-estate-campaign replies (lauderdale_hotel/expired_3m/waterfront → Real Estate `buyer:<MLS>`), 39 `agent_warmup`, 133 auto. ~14 Instantly-era repliers had no recoverable text.

## Pending
1. Kevin: LinkedIn manual login (command above) → then `python -m tools.li_inbox_watcher --dry-run`, screenshot, set `LI_WATCH_ARMED=1` in `autonomous-agency/.env`, `cp` plist out of `archive-launchd/` + `launchctl bootstrap`, verify with `~/bin/verify-launchd.sh com.kevinpoler.linkedin-inbox-watcher`.
2. Kevin's call: re-arm the FB watcher plist the same way (it already pushes to CRM).
3. Optional: replay `state/crm_push_failed.jsonl` if non-empty.

## Touched
- poler-team-website: `crm.html crm.js crm.css api/_leadgen.js api/*leadgen*.js api/agent/leadgen-reply.js api/mcp.js CLAUDE.md docs/crm-internals.md .claude/rules/learnings.md` + this file. Committed to `main` this session (see git log). **NOT committed:** other sessions' uncommitted site-redesign files (435cutlerbay.html, TS01.html, tower/, analytics.js, …) — left alone.
- poler-team-mcp: `index.js` (+5 tools).
- cloud-sender: `crm_push.py` (new), `backfill_leadgen.py` (new), `inbox_watch.py`, `smtp_sender.py`, `gmail_outreach.py`; Railway vars set; `instantly-1k-rollout/.env` appended.
- autonomous-agency: `tools/fb_inbox_watcher.py`, `tools/li_inbox_watcher.py` (new), `.env` appended, `.claude/rules/learnings.md`.
- Global: `~/.claude/references/poler-team-agent-api.md` (Lead Gen endpoints), `env-locations.md`, `learnings.md`, memory `project_leadgen_crm_section.md`.
- Airtable: LeadGen tables populated by backfill; QA record recVCNK6KJi03Hh7J + its 3 activity rows deleted.

## Gotchas
- Instantly is retired (API 402) — never offer it; Instantly-era rows are channel `Email`.
- `listAll()` table names must be URL-encoded (`Consulting%20Activity`).
- Every producer MUST pass `messageId`; without it the Railway double-sweep (inbox_watch + smtp_sender read the same KPS boxes) would double-write.
- `inbox_watch._body()` cut markers now include Outlook-style `From:` / `De:` — otherwise our own email leaks into reply text.
- Pre-existing pyflakes warnings in `smtp_sender.py` (`_blocked` unused) and `gmail_outreach.py` (`_telegram` shadowed ~1376) are not from this session.
