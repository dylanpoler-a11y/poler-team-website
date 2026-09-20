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

## Pass 2 (deployed ~1:40 PM ET, commit 8c65bd4) — Kevin's corrections after seeing pass 1
- "Waiting on them" column is now **Status**: one line per lead saying what we are waiting on
  (`Waiting on:` line in the lead Summary, written by Sonnet via `_leadgen.js refreshWaitingOn`
  after every human outbound row < 3 d old, or on demand with
  `PATCH /api/update-leadgen-lead {id, refreshWaitingOn:true}`; "Kevin owes:" prefix when the
  ball is really his). Backfilled for the 19 waiting leads.
- Off-email conversations count: `~/bin/leadgen-spoke-sync.py` (launchd
  `com.kevinpoler.leadgen-spoke-sync`, hourly) mirrors call log / WhatsApp / iMessage hits from
  `spoke_since` as Call / WhatsApp / SMS / Reply activity rows, so a lead Kevin phoned leaves
  "needs my reply" on its own. First run logged 4 rows (Jen, Edy, Bhryan, Brad Levine).
- Reminders: a Positive/Question reply now creates "Reply to <name> (positive reply)" (due +3 h
  on a weekday 7-15 ET, else next weekday 10:00 ET); any human outbound row marks those Done
  (`closeReplyTasks`). Audit of the open tasks: Geane Brito x2 (overdue 9/11), Michael (9/15),
  Yoana (9/18 + 9/21), Alicia (9/24) — no calls found after their due dates, left as is.
- Queued emails: every unsent cadence touch is mirrored as an Open task "Queued touch i/n: <subject>"
  (Notes = body, Due = 10:05 ET send day, weekend -> Monday); sent -> Done, cadence stop ->
  Skipped. Lead panel section "📤 Queued emails" (`renderLGQueued`), hidden from the reminders list.
  Nav now has a **Leads** tab. Backfilled 8 tasks (Sasha + Diana).
- Cadence runner: ledger persisted right after each send, CRM calls 20 s timeout + soft, so the
  CRM can never cause a double send.
- Verified in the local harness (live JSON): Status column rows carry the waiting-on line;
  Sasha's panel shows Touch 1/4 Tue 9/22 ... Touch 4/4 Tue 9/29 with the bodies.

## Pass 3 (~12:50 PM ET, commits 978b2d1 / 81737e5 + 1) — Kevin: "notes like the RE side, every lead a reminder, Joel is wrong, check Rony and all of them"
- **Courtesy close rule** (`isCourtesyClose`): "thank you." / "ok" / "gracias" / any "Not Now reply" row never puts the ball on Kevin. Joel flipped to waiting; needsReply 6→4, stale 50→9.
- **Convo:/Next: note per communication** (`writeConvoNote`, agent `Summary (channel)`, in BOT_AGENTS so it never counts as our last word): fired from `log-leadgen-activity` on every created communication row (<3 d, not quiet) and from `leadgen-reply`; on demand `PATCH update-leadgen-lead {id, convoNote:true, catchUp?, activityId?}`. Same pass rewrites `Waiting on:` and creates ONE open reminder when none exists (Negative repliers excluded; queued touches don't count). Language picked from the lead's own reply text (Sonnet kept picking Spanish for English leads); JSON retry once.
- **Backfill** (`~/business/active/execution/leadgen-crm/backfill-notes-2026-09-20/run.py`, log `run.log`): 94 catch-up notes; 115 of 119 open leads now carry a reminder (3 Negative by rule, Rony on hold). 19 Lauderdale Crexi buyers got notes via the live path today but NO reminder — created by hand; **verify the live path creates the reminder on the next real communication** (unexplained).
- **Full-source sweep of the 15 revival leads** (3 opus subagents): `~/business/active/execution/leadgen-crm/revival-2026-09-20/sweep-summary.md` + README rev 2. Greg + John Erixon → Lost, Mercy + Pam → Prospect, phones added (Randy, Julio), John's campaign tag fixed. Rony: every readable source says unsigned + ghosted since 7/22; Kevin says hired — HOLD, his answer decides the record and agency/CLAUDE.md:23/:50 + abrams CLAUDE.md:78.
- Not touched: the 6 open pre-existing reminders (Geane x2, Michael, Yoana x2, Alicia). Sasha's cadence ran through her positive reply (9/4, 9/9): runner stop rule should also key on an inbound reply in-thread (open item).

## Open
- Revival touches for the old Positive repliers (Edy Pyles, Bruno Turrini, Bhryan Cardenas,
  Pamela, Mercedes, Greg, John/NAI, Brad Levine, Rony Karam, Julio Navarro, Sean O'Toole,
  Sammy/Unicorn, John Engler, Randy Haney): brief taken (all 15, 4 touches day 3/5/7/10, show every body); drafting in progress 9/20 PM. Sasha already has a live cadence (armed 9/19) and is skipped.
- `Rachel Baumgardner` (lauderdale_hotel) is an auto-reply that got ingested, and real-estate
  campaigns are not supposed to land in Lead Gen; leave or Lost — Kevin's call.
- Old "Not Now" rows (50 needs-reply older than 14 d) stay New; a "circle back" cadence or
  a Lost sweep is a separate decision.
