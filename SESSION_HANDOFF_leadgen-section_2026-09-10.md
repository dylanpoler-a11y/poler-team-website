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
- **Backfill:** `cloud-sender/backfill_leadgen.py --go` under `railway run` — DONE 10:29–11:10: 193 pushes (169 repliers / 204 messages; 5 skipped auto, 1 unsub), 0 push failures. Live CRM now 165 Lead Gen rows — Negative 81 / Not Now 46 / Question 16 / Positive 15 / Neutral 7; status New 103 / Lost 61 / Meeting Booked 1 (all channel `Email`). Sources: `autoresearch/data/reply_events.jsonl` (458 events, no bodies) + ledgers; text pulled from 30 mailboxes (IMAP `X-GM-RAW` + Gmail API). Excluded on purpose: 33 real-estate-campaign replies (lauderdale_hotel/expired_3m/waterfront → Real Estate `buyer:<MLS>`), 39 `agent_warmup`, 133 auto. 14 Instantly-era repliers had no recoverable text in the mailboxes → **Gmail recovery pass (11:30):** searched all 3 Gmail accounts (kevinpolermiami / kevinpoler1 / kpoler325, incl. spam+trash) by address, domain and name. **3 recovered + pushed** (`gmail:<msgid>` messageIds, original `replyAt`): Bill Hoffman `unsubscribe` (Negative/Lost, forced), Nicolas Gomez/Disfarma (Positive, Meeting Booked, verbatim Spanish reply — Hector Gonzalez forwarded Kevin's Keystone email, Nicolas replied; meetings 08-19 + 09-01), Michelle Rinaldi (info@rinaldirealestate.com; only Kevin's 07-23 reply exists — reply text explicitly marked NOT RECOVERABLE/inferred, sentiment Question). **11 truly absent** (their replies lived only in the now-dead Instantly listing_os/flash mailboxes): claybrooks@edwards-lawgroup.com, david.t@southeastpersonnel.com, gray.welton@nvrealtygroup.com, jack.elkins@raveis.com, lim@limrealtor.com, lynn.grady@evrealestate.com, marcy@signatureonele.com, marie@metropolitaninsuranceservices.com, mehmcke@ressi.com, teamjk@onesothebysrealty.com, vinarodriguez.m@ewm.com. Live CRM now **168** Lead Gen rows.

## Pass 2 (2026-09-10 afternoon) — panel parity + reminders + Flash — DEPLOYED (site + `flash-coach`)
Kevin: "make the layout the same, the font the same… add the section for reminders… add flash to it… add in each lead profile panel what email the lead was contacted from."
- **Panel:** `#leadgen-panel` rebuilt as a structural clone of the RE panel (ids `lg-*`, same classes). Font root cause: `.panel-input` lacked `font-family: inherit` (crm.css ~909) — fixed, verified computed font `Inter, sans-serif` on LG inputs/selects. **Contacted From** row (`lg-contacted-from`) shows the sending mailbox. Verified in-browser (login gate → JS injection): panel 440px, sections in RE order, reminders section renders.
- **Reminders:** nav `leadgen-reminders` + `#leadgen-reminders-view` (Due / Lead / Action / Note / Agent / Status / Actions, status + owner filters, badge). Backed by `LeadGen Tasks` with a NEW dateTime field `Due` (`fldirG6UiJYqsz8tK`, America/New_York) because Airtable `update_field` can't retype the date-only `Due At`; API writes both, reads `Due || Due At`, sorts by `Due`. Live round-trip verified (dueAt keeps its time). QA task `recE0gHjLu6u0dfCT` deleted after.
- **Flash:** coach generalized over two slots (`COACH_SLOTS` re/lg, `coachSlot()` treats an Event arg as `re`). `clairvo-clone`: `bucket=leadgen` mode — `src/lib/crm/leadgenPoler.ts` (context via `get-leadgen-leads?id=`, Note activity, create task w/ type map + owner closed set Kevin/Dylan/Rosa, Done reconciliation, upgrade-only status ladder, summary + `Next:`), `deliverToLeadgenCrm()` branch at the top of `deliverToCrm`, `bucket` in CallRecord + postMessage payloads. Tests `npm run test:optimize` 112/112, typecheck clean. CRM `handleFlashMessageLG` logs recording/transcript URLs as `Call` activity rows. Live context check on Edy pyles: contactedFrom + verbatim reply + Next step all present. Not ported: `amendPriorNoAnswerNote` (no update-activity endpoint).
- **Endpoints touched:** `api/_leadgen.js`, `api/create|update|get-leadgen-task(s).js`, `api/get-leadgen-leads.js` (`?id=`). Cache-bust `?v=20260910b`.
- **Docs:** `docs/crm-internals.md` (three new paragraphs), `~/.claude/references/poler-team-agent-api.md` (Due/time, `?id=`, owner set, Flash bucket).
- **clairvo-clone git:** repo had NO commits before this session — initial commit made this pass.

## Pending after pass 2
1. Hosted `api/mcp.js` + local `poler-team-mcp/index.js` `leadgen_ingest_reply` schema: add `contactedFrom` + phone auto-extract (producers already send both; the MCP schema just doesn't advertise them).
2. Railway cloud-sender health check (`railway logs`) — not re-verified this pass.
3. Optional: replay `state/crm_push_failed.jsonl` if non-empty.

## Pending (pass 1, still true)
1. Optional: replay `state/crm_push_failed.jsonl` if non-empty.

## Parked (Kevin 2026-09-10: "We can skip Facebook. And LinkedIn for now.") — do NOT pursue unless he re-opens
- LinkedIn watcher: code + parked plist exist; needs `python -m tools.manual_linkedin_login`, dry-run, `LI_WATCH_ARMED=1`, plist bootstrap, `~/bin/verify-launchd.sh com.kevinpoler.linkedin-inbox-watcher`.
- FB watcher plist re-arm (code already pushes to CRM).

## Touched
- poler-team-website: `crm.html crm.js crm.css api/_leadgen.js api/*leadgen*.js api/agent/leadgen-reply.js api/mcp.js CLAUDE.md docs/crm-internals.md .claude/rules/learnings.md` + this file. Committed to `main` this session (see git log). **NOT committed:** other sessions' uncommitted site-redesign files (435cutlerbay.html, TS01.html, tower/, analytics.js, …) — left alone.
- poler-team-mcp: `index.js` (+5 tools).
- cloud-sender: `crm_push.py` (new), `backfill_leadgen.py` (new), `inbox_watch.py`, `smtp_sender.py`, `gmail_outreach.py`; Railway vars set; `instantly-1k-rollout/.env` appended.
- autonomous-agency: `tools/fb_inbox_watcher.py`, `tools/li_inbox_watcher.py` (new), `.env` appended, `.claude/rules/learnings.md`.
- Global: `~/.claude/references/poler-team-agent-api.md` (Lead Gen endpoints), `env-locations.md`, `learnings.md`, memory `project_leadgen_crm_section.md`.
- Airtable: LeadGen tables populated by backfill; QA record recVCNK6KJi03Hh7J + its 3 activity rows deleted.

## Gotchas
- Instantly is retired (API 402) — never offer it; Instantly-era rows are channel `Email`.
- Instantly-era reply TEXT survives only if the lead replied to (or Kevin answered from) a personal Gmail — the Instantly mailboxes are gone. Gmail sweep = the last recovery path; a lead absent from all 3 Gmail accounts is unrecoverable.
- `get-leadgen-leads?search=` is NOT honored server-side (returns the same rows for any query) — fetch `limit=500` and filter locally.
- `listAll()` table names must be URL-encoded (`Consulting%20Activity`).
- Every producer MUST pass `messageId`; without it the Railway double-sweep (inbox_watch + smtp_sender read the same KPS boxes) would double-write.
- `inbox_watch._body()` cut markers now include Outlook-style `From:` / `De:` — otherwise our own email leaks into reply text.
- Pre-existing pyflakes warnings in `smtp_sender.py` (`_blocked` unused) and `gmail_outreach.py` (`_telegram` shadowed ~1376) are not from this session.
