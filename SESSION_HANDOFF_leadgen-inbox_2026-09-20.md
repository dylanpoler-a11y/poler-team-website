# SESSION HANDOFF — Lead Gen Inbox (whose turn is it) — 2026-09-20

Kevin: "I'm very confused as to who I've sent emails to, who I'm waiting a reply on, who are my
hottest leads." Root cause: status says how far a lead got, nothing said whose turn it was, and
Kevin's own sends never stamped the lead (Asnel looked untouched a day after Kevin replied).

## What changed (deployed 2026-09-20 ~11:35 AM ET, `npx vercel --prod --yes`)
- `api/_leadgen.js`: `STATUSES` now `Prospect / New / Contacted / Meeting Booked / Won / Lost`
  (Prospect = never replied, index 0 so upgrade-only ladders promote it on the first reply).
  New `OUTBOUND_TYPES`, `INBOUND_TYPES`, `BOT_AGENTS`, `INBOX_STALE_DAYS=14`, `INBOX_EXCLUDED`,
  `listActivityLite()` (own pager, At/Type/Lead/Agent only), `computeInbox(leads, activity, now)`
  → per lead `ball` (`needs_reply` | `waiting` | `none`), `ballSince`, `waitingDays`, `lastInAt`,
  `lastOutAt`, `stale`, `hot`; returns `{needsReply, waiting, hot, staleNeedsReply, staleWaiting}`
  (ordered ids; actionable = traffic ≤14 d; future-dated rows such as a booked Meeting ignored;
  Negative sentiment never "needs a reply").
- `api/get-leadgen-leads.js`: `?inbox=1` runs the above (live: 954 activity rows, ~1.7 s).
- `api/log-leadgen-activity.js`: every outbound row by a person stamps `Last Contact` (no
  `stampContact` needed).
- `api/mcp.js`: tool `leadgen_inbox` + a per-tool `shape` hook in `tools/call`.
  `poler-team-mcp/index.js`: same tool (needs a Claude Code restart to appear locally).
- `crm.html/js/css`: `#lg-inbox` three-column block above the Lead Gen stats (`renderLGInbox`,
  click → panel), ball chip under the name in the replies table (`lgBallChip`, hidden on
  Lost/Won/Prospect), sidebar badge = needsReply count, stats exclude Prospect, `Prospect`
  option in the stage filter + panel select, `LG_STAGES` includes Prospect (pipeline column).
- Producers: `email-cadences/lib.mjs` `crmLogEmailSent` + `resolveLeadgenId`; the runner logs
  every touch at send time (soft: a CRM failure never blocks/repeats a send); `add-cadence.mjs`
  stores `leadgen_id`; new `log-send.mjs`; hook `~/.claude/hooks/email-cadence-ask.py` spawns
  it detached after any external Gmail/KPS send. `costar-mcp/jobs/monthly-report.js` pushes
  LoopNet viewer companies as `Prospect`.
- Terminal: `~/bin/leadgen-status.py` (+ skill `leadgen-status`, trigger phrases in
  `skill-triggers.json`) = the three lists merged with the next armed cadence touch.

## Data backfill (via the API, Status Change rows logged)
- 20 "Lauderdale LoopNet viewers" rows → Prospect (21 total incl. the probe row).
- 19 New + Negative older than 30 d → Lost; the `Kevin Poler` formd test row → Lost.
- Airtable option `Prospect` was created through `typecast:true` (read-back verified); the PAT
  still cannot add FIELDS, which is why the Inbox is derived and not stored.
- Result: New 133 → 92, Lost 94 → 114. Inbox at deploy: needs reply 6 (+50 older), waiting 13
  (+29 older), hot 10.

## Verified
- OPTIONS preflight 200 + ACAO; `?inbox=1` live JSON; cadence runner `--dry-run` clean;
  harness screenshot of the Inbox block (login-gated CRM → local harness with the live JSON).

## Open
- Revival touches for the old Positive repliers (Edy Pyles, Bruno Turrini, Bhryan Cardenas,
  Pamela, Mercedes, Greg, John/NAI, Brad Levine, Rony Karam, Julio Navarro, Sean O'Toole,
  Sammy/Unicorn, John Engler, Randy Haney): NOT drafted — needs Kevin's brief (ask-first rule).
- `Rachel Baumgardner` (lauderdale_hotel) is an auto-reply that got ingested, and real-estate
  campaigns are not supposed to land in Lead Gen; leave or Lost — Kevin's call.
- Old "Not Now" rows (50 needs-reply older than 14 d) stay New; a "circle back" cadence or
  a Lost sweep is a separate decision.
