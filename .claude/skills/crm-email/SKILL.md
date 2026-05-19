---
name: crm-email
description: Operational policy for the email→CRM pipeline (api/cron/process-emails.js). Defines how Gmail messages get classified, routed, written to Airtable, and surfaced to Slack. Read by Claude Code when working on CRM logic; mirrored in code for the cron's runtime behavior.
---

# CRM Email Classification + Routing Skill

This is the single source of truth for how The Poler Team's email→CRM pipeline behaves. Edits here must be mirrored in `~/poler-team-website/api/cron/process-emails.js`, `lib/email-extract.js`, and `lib/gmail.js` in the same commit so the cron picks up changes on the next 5-minute tick.

## 1. Scope

**In scope:** inbound + sent Gmail (Kevin's inbox), automated extraction of CRM-worthy content, writes to Airtable tables (Leads, Consulting Clients/Deals/Contacts/Tasks/Activity, Listing Notes, Reminders).

**Out of scope:** outbound email drafting, WhatsApp ingestion (planned future build), iMessage, phone-call logging, voice transcription.

**Default classification is CONSULTING.** The pipeline is body-first: Sonnet reads each email body and decides which consulting clients/listings are discussed. Real-estate Lead activity is GATED on explicit real-estate signals only (FB ad form, homesinsoflorida.com web form, CINC pipe, MLS pipe) — Lead participant-matches are dropped when no RE signal is present. See §4.1.

## 2. Tech context

- Edge runtime (Vercel). No node-only packages.
- Anthropic Sonnet 4.5 (`claude-sonnet-4-5-20250514`) only — never Haiku.
- Airtable base: `appJhWtGCXGgAuS0r`.
- Cron tempo: **5 minutes**.
- Cron auth: `Authorization: Bearer $CRON_SECRET` (Vercel cron + cron-job.org).

## 3. Hard filtering (what NEVER gets processed)

Applied at the Gmail query level so the cron never even fetches them.

**Sender-domain denylist** (`SKIP_SENDER_DOMAINS` in `process-emails.js`):
- Banking/payments: chase.com, americanexpress.com, aexp.com, venmo.com, zelle.com, zellepay.com, capitalone.com
- Commerce: amazon.com, bylt.com, byltbasics.com
- Work/social: linkedin.com, fiverr.com, upwork.com, meta.com, facebookmail.com, facebook.com, slack.com, slackmail.com
- Sports: nfl.com, mlb.com, fantasypros.com, footballguys.com, heatnation.com, miamiheat.com, mlbmail.com
- Real estate competitors: exprealty.com
- **Agency operational mail (added 2026-05-19):** kevinpolerservices.com — our own outbound infra, never client mail; nothing it sends warrants CRM logging.

**Subject prefix denylist** (`SKIP_SUBJECT_PATTERNS`):
- `New Lead:` (homesinsoflorida.com form-submit notification — Airtable Lead row is already created by `api/save-lead.js`; the email is FYI)
- `Welcome - New Lead` (welcome template back to the lead)

These subjects ARE real-estate signals (see §15) — they're skipped at fetch only because the Lead row already exists. Do not repurpose these patterns elsewhere.

**Display-name denylist** (`SKIP_SENDER_NAMES`, after fetch):
- "Joe Bryant"

**Promo tab:** Gmail's `category:promotions` is excluded from the query.

**Team-member skip** (`TEAM_EMAILS` constant): Kevin / Noel / Dylan / Rosa across all their addresses are NEVER matched to CRM Lead/Contact records. They're admins. When they're a participant on an email, the body decides which client(s) the activity belongs to.

### 3.1 Team-sender guarantee (added 2026-05-18)

**Every email where a team member (Kevin / Noel / Dylan / Rosa) is the SENDER, FORWARDER, or any TO/CC recipient MUST produce ≥1 CRM activity row.** No silent drops to `CRM_UNMATCHED` for internal-touched mail.

Outcomes in priority order:
1. Direct participant match against a CRM record → write to that record (§5 primary path).
2. Team-discussion extraction finds clientReferences / tasks / meetings → write to those records (§5.1 always-on path).
3. Thread already linked to ≥1 CRM activity row → append continuation (§8.1).
4. Nothing matched, nothing extracted → flip to `CRM_NEEDS_REVIEW` **AND** Slack-ping the inbox owner with subject + snippet within 5 minutes. Do NOT silently `CRM_UNMATCHED`.

Trace: 2026-05-18 — Dylan's AD1/Tru forward landed `CRM_NEEDS_REVIEW` and sat; Noel's 5/18 14:50 ET Royal SB deal-of-the-century analysis to Marcel was unlabeled. Both should have been #1 or #3 hits.

## 4. Participant matching (SECONDARY signal as of 2026-05-19)

Participant matching is no longer the primary classifier. It runs as a check against `getEmailIndex()` to catch direct-conversation cases body extraction might miss, but its results are filtered before any write (see §4.1 gating).

1. Parse all participants: FROM, Reply-To, TO[], CC[], BCC[], plus forwarded-body From/To/Cc addresses if subject is a forward.
2. Drop noreply addresses + drop team members + drop the polling inbox itself.
3. Match each remaining participant against `getEmailIndex()` (Leads + Consulting Contacts + Consulting Companies' direct Email field).
4. Dedupe by recordId, keeping the highest-priority role: `sender > recipient > cc > bcc > forwarded`.

`getEmailIndex()` indexes THREE sources: Leads, Consulting Contacts, and Consulting Companies' own Email field — so a sender like `mi@brickelltravel.com` resolves deterministically to Brickell Travel even when no individual Contact row exists.

**Aliases** for known clients (Mitch/Maikel→MR9+Brickell, Royal→MR9, AD1→AD1 Global, etc.) live in the Sonnet prompt for `extractTeamDiscussion` (see §6). A future `Client Aliases` Airtable table will replace the hardcoded list.

### 4.1 Body-first classification (added 2026-05-19)

**Order of operations per message:**
1. Apply hard filters (§3) — skip if denied.
2. Thread continuity check (§8.1) — if the thread is already linked, append and stop.
3. **Run `extractTeamDiscussion` FIRST on every email body** — Sonnet picks which consulting clients/listings the body discusses.
4. Build participant matches (§4) — these are SECONDARY signal.
5. **Gate the participant matches:**
   - Drop any `recordType: 'lead'` match unless `isRealEstateSignal(m)` is true (subject = "New Lead:" / "Welcome - New Lead" / "Property Inquiry" / "Tour Request" / "Showing Request" / "registered on homesinsoflorida", OR sender domain in `RE_LEAD_SIGNAL_DOMAINS` = facebookmail.com / cincapp.com / cinc.com / flexmls.com / mlsmatrix.com / matrix.miamire.com).
   - Drop any consulting / dev-project match whose parent companyId is already in `bodyExtracted.clientReferences` — body extraction already wrote that parent's timeline; participant write would duplicate.
6. Write `bodyExtracted` via `writeTeamDiscussion`.
7. If filtered participants remain → also write those via `extractEmailUpdate` + `writeCrmUpdate` (primary + duplicates).
8. Label `CRM_PROCESSED` and ping Slack.

**Why:** Kevin is almost always CC'd or forwarded. Pre-refactor, participants were the primary classifier → participant matches landed on stale Lead rows (e.g. Maikel-in-Leads from old form tests) and consulting-topic emails got logged as real-estate Lead activity. Body-first cuts the false-positive class at the source.

Trace: 2026-05-19 — multiple consulting emails about Mitch/Maikel/Royal/AD1 were being routed into Lead.Notes because stale Lead rows existed for those people; refactor makes Sonnet decide first.

## 5. Branching after the body-first pass

**Inputs at this point:** `bodyExtracted` (extractTeamDiscussion result, possibly null on error) + filtered `matchedRecords` (after §4.1 gating).

**Case A — bodyExtracted has refs AND matchedRecords is non-empty:**
1. `writeTeamDiscussion(bodyExtracted)` writes the body-derived notes.
2. Call `extractEmailUpdate` with the highest-priority participant as `crmContext` + `otherMatchedRecords[]`.
3. Write that note to the primary participant + duplicate to others (dedup by parent so the same companyId doesn't double-log).
4. Attachments + reminders + auto-actions go only on the PRIMARY participant record.
5. Slack: consolidated ping referencing both body summary and direct matches.

**Case B — bodyExtracted has refs, matchedRecords is empty:**
1. `writeTeamDiscussion(bodyExtracted)` is the only write path.
2. Label `CRM_PROCESSED`. Slack ping routed to first referenced client's Owner.

**Case C — bodyExtracted is empty, matchedRecords is non-empty:**
1. `extractEmailUpdate` + write to participants (same as Case A's later steps).

**Case D — both empty:**
- Internal sender → `CRM_NEEDS_REVIEW` + Slack ping (per §3.1).
- External sender → `CRM_UNMATCHED`. Daily audit (§22) catches it.

**Forward routing:** when a team member forwards an external client thread, body extraction picks up the external client; log on the EXTERNAL client's record. Note prefixed with `(forwarded by <team-member>, contains original thread)`.

### 5.2 Known client aliases (hardcoded, 2026-05-19 stopgap)

Until the `Client Aliases` Airtable table is built, the alias map lives in the `extractTeamDiscussion` system prompt (`lib/email-extract.js`). Sonnet applies these BEFORE matching against the dynamic clientList:

| Trigger phrase(s) | Resolves to (companyId) |
|---|---|
| "Mitch Rodriguez" / "Maikel Rodriguez" / "Mitch & Maikel" | MR9 Holdings (`recMPNWLmegpss0WO`) + Brickell Travel (`recljWqJPnttwYkzp`) — emit BOTH refs |
| "Royal" / "Royal South Beach" / "Royal SB" / "Dream Inn" | MR9 Holdings + Brickell Travel (same group) |
| "AD1" / "AD1 Global" | AD1 Global (`recoUF9Pc03xFTuSO`) |
| "Tru" / "Century Hospitality" / "Jeremy Frisby" | Century Hospitality Group (`recjzUZqbQuL0gXpW`) |
| "Toyosa" / "Intermex" / "Edwin Saavedra" | Intermex / Toyosa (`recuoeCu9myrS1HTV`) |
| "Terrado" / "Juan Carlos Toledo" | Terrado Hoteles (`recazYfRm47MQhpcC`) |
| "DoubleTree Santiago" / "Santiago DoubleTree" | DoubleTree by Hilton Santiago (`recicaDDTwGm0U34I`) |
| "Conduit" / "Cole" / "Punn" | Conduit (`recLxOvlONXNuGFsb`) — only when also tied to an underlying client/listing (see (D) below; Conduit alone = tool mention, skip) |
| "Solution Malls" / "Ariel Cogote" | Solution Malls (`rec6l2wmioPIEkSoi`) |
| "Ten Series" / "Pedro Buvinic" | Ten Series (`recMPNWLmegpss0WO`) |
| "Grupo Giordano" / "Giordano" | Grupo Giordano (`recQMjwYpsc2tiuQU`) |
| "Contempora" / "Save" | Contempora / Save (`recUcvgndm9SCC2gd`) |

When this list grows past ~20 entries, migrate to the `Client Aliases` Airtable table and read it into the system prompt at run-time.

## 6. Auto-actions (Kevin's posture: AGGRESSIVE)

Auto-apply on `confidence: high` from Sonnet:
- **Status changes (real-estate Leads):** Auto-update Hot / Warm / Cold / Touring / Offer / Won / Lost.
- **Stage moves (Consulting Deals):** Auto-move across Pitching / Proposal Sent / Verbal Commitment / Signed / Active / Completed / Closed Lost. Forward AND backward.
- **Deal value updates:** Auto-update Deal Value / Diagnostic Fee / Monthly Recurring Fee fields when confident.
- **Auto-create Consulting Clients:** when Sonnet detects a new company with high confidence (scope-of-work / pitch deck / engagement signals). Type=Client, Status=Lead, Source="Auto-created from team email by [sender]".
- **Auto-create Consulting Deals:** when an existing client mentions a new project/scope with high confidence. Owner = client's owner.
- **Auto-add Consulting Contacts:** when a new person from an existing client's domain emails. Link to that company.

Lower confidence → flag CRM_NEEDS_REVIEW.

## 7. Notes, tasks, reminders

**Date handling:**
- Every concrete date in an email becomes a task or reminder.
- No time specified → default to **5:00 PM ET** on the specified day.
- All dueAt values ISO-8601 with America/New_York offset.

**Default assignee** (when email has a deadline but doesn't name a person): **the sender** (whoever wrote the email).

**Client→team asks:** when a client says "send me X" / "I need Y", create a task on the **client's Owner** (not on you). Title = the ask, Due = stated deadline or end of next business day.

**Task dedup:** if a task with same title + date + company already exists → skip creation.

**Recurring meetings:** single recurring Consulting Task with `Due At` rolling forward after each occurrence (not N separate rows).

**Calendar invites:** when a Zoom / Google Meet link + time is detected → create the event on Kevin's Google Calendar AND create the Consulting Task (Type=Meeting). Calendar→CRM stays one-way; we don't pull meeting summaries back.

**Signatures:** strip standard footers ("Sent from my iPhone", "--", disclaimers) before composing the note. Keep `Name / Title / Company` blocks intact.

**Language — STRICT:** mirror the source email's language and ONLY that. Spanish email → Spanish note. English email → English note. NEVER bilingual. NEVER translated duplicates. The "Next steps:" header becomes "Próximos pasos:" in Spanish. Applies to direct-match notes, team-discussion excerpts, task titles, meeting titles, and Sonnet's summary field.

**Note format — STRICT:** every CRM note Sonnet produces (whether direct-match `noteText` or team-discussion `excerpt`) MUST be plain-text bullets followed by a "Next steps:" / "Próximos pasos:" section with 1-3 next-action bullets. Never a paragraph. Never a one-liner. The bullets ARE the note Kevin reads in CRM.

**Note prefix — what NOT to write:** notes should NEVER start with `[via Gmail/inbox@gmail.com (role)]` or similar source-annotation prefixes. The bullet body is the note; quiet metadata (subject, forward provenance, cross-references, thread token) goes in a `— ` footer line at the bottom only.

## 8. Thread continuity

**One activity row per Gmail thread**, not per message. First reply creates the row. Subsequent replies in the same thread append to its `Details` field with a new dated section. Use Gmail `threadId` as the dedup key (stored in the note as `[thread: <id>]`).

### 8.1 Thread continuity supersedes confidence (added 2026-05-18)

**When an incoming message belongs to a Gmail thread that is ALREADY linked to ≥1 CRM activity row, the new message inherits those record links automatically — bypass confidence gating, bypass `CRM_NEEDS_REVIEW`.**

Pre-check at the top of the per-message branch (before `buildParticipantMatches`):
1. Query Consulting Activity for any rows whose `Details` field contains `[thread: <new-message-threadId>]`.
2. If any exist → call `upsertActivityRow` for each linked parent (companyId / projectId) with a short continuation note. Skip the participant-match flow entirely.
3. If none → fall through to the standard ≥1-match / 0-match branching.

Re-classification (full Sonnet extraction) only fires on threads with no prior CRM link OR on threads where Kevin has manually cleared the link (deleted the activity row).

Trace: 2026-05-18 — Dylan's "Fwd: NDA TO BE SIGNED" (forward of an already-CRM-linked thread) hit `CRM_NEEDS_REVIEW` because the cron re-classified from scratch and got ambiguous between AD1 + Century. With §8.1, the forward would auto-append continuation activity on both companies.

## 9. Tags

Activities get a structured `Tags` multi-select field (to be added to Consulting Activity table). Sonnet assigns one or more tags per write:
- `🔥 Hot` — high-intent / closing signals
- `⚠️ Action Required` — explicit ask directed at the team
- `📊 Information Only` — FYI updates with no action needed
- `🎯 Win Signal` — language indicating likely close
- `🚨 Risk Signal` — language indicating loss / blocker / cooling

## 10. Attachments

- Auto-upload all attachments to the matched record's Airtable.
- Sonnet picks the bucket: `Contracts` / `Deliverables` / `Spreadsheets` / `Misc`.
- Primary record only. Duplicates note the filename(s) in text but don't re-upload.
- Treat sensitive content (banking, signed contracts) normally — Kevin's senders are already filtered.

## 11. Multi-record + cross-references

When an email matches multiple CRM records:
- Same `noteText` duplicated to each timeline.
- Append `*Also logged to:* X, Y` cross-reference line.
- Attachments + reminders + auto-actions only on PRIMARY (highest-role) record.

When the email talks about additional clients (beyond the directly-matched ones), the secondary team-discussion pass adds notes to those too.

## 12. Listing notes (Rosa's MLS listings)

Auto-create a row in `Listing Notes` when an email mentions a property address or MLS number that matches one of Rosa's active listings. Type=Email Logged. Cross-reference back to the matched Lead/Client if any.

## 13. Slack pings

**Channel routing:** per-client Owner. Toyosa is owned by Noel → Noel's Slack webhook. AD1 owned by Dylan → Dylan's. Kevin gets pings for clients he owns directly.

**Format:** detailed bullets — full breakdown of note + tasks + reminders + new clients/deals created + attachments uploaded.

**Links:** every ping ends with `<https://www.homesinsoflorida.com/crm|Open CRM →>` (Kevin's custom dashboard, not raw Airtable).

**Quiet hours:** 11pm–7am ET pings are queued. Delivered at 7am as a single "overnight digest" message.

**Daily morning briefing (8am ET):**
- ✅ Done overnight (emails processed, tasks created)
- ⚠️ Stale > 24h (clients waiting on a reply from us)
- 💰 Money Watch (deal value changes, probability shifts, signed deals from the last 24h)

**Real-time stale-thread alerts:** when a client email has gone unanswered for 24h, ping the client's Owner. Variable thresholds by Status are NOT in v1 — flat 24h.

**Correction UX:** when Kevin replies to a Slack ping with a command like `move to AD1` or `set stage Active` or `reassign to Noel`, a webhook handler reads the reply, applies the correction, AND writes it to a new `Corrections` Airtable table for the feedback loop (§16).

## 14. Sent-mail logging

Cron query includes `(in:inbox OR in:sent)`. Kevin's outbound replies to clients are logged as outbound activity on the recipient's record.

## 15. Real estate behavior

**De-emphasized in v1.** Most real-estate communication happens via WhatsApp + phone, not email. Specifically:
- DO NOT log Activity rows for inbound "New Lead:" website notifications (already filtered).
- DO log notes + auto-update Status (Hot/Warm/Cold/Touring/Offer/Won/Lost) when a real estate Lead replies via email.
- Lead.Notes is the canonical field. We do not also write a separate Lead Activity row in v1.

## 16. Learning from corrections

A new Airtable table `CRM Corrections` (to build) tracks every manual override Kevin makes. Columns: `Activity ID` / `Original Record` / `Corrected Record` / `Type of Fix` (mis-routed, wrong stage, wrong assignee, etc.) / `Pattern` (sender or phrase) / `Created At`.

On each cron run, before classifying, the agent reads recent corrections and applies any "sender X → always client Y" overrides. Sender-level mappings are the strongest signal; phrase-based patterns are surfaced to Sonnet as system-prompt hints.

## 17. Delete sync

If Kevin deletes a Gmail email that's already in CRM, **keep the CRM activity**. Email is the source; activity is the record of truth.

## 18. Gmail labeling

Two complementary mechanisms, both write the same flat top-level label set:
- `Consulting Client - [Name]`
- `Real Estate Lead`
- `Real Estate Industry`
- `Team Internal`
- `Promotional`
- `Personal/Financial`
- `Sports/Entertainment`
- `Social/Work Platforms`
- `Investor OS / Tech`
- `Ignore`

**Ongoing pass (inline in the cron):** `applyOngoingCategoryLabels` at the top of each `process-emails.js` cron tick. Pure heuristic — fetches `format=metadata&metadataHeaders=From`, then labels by (a) team-member check, (b) emailIndex CRM match, (c) sender-domain regex. No Sonnet cost. Query: `in:inbox newer_than:15m -has:userlabels`, capped at 10/inbox/run.

**Ordering rule (CRITICAL):** team-member check MUST run BEFORE the emailIndex lookup. Skill §3 says Kevin/Noel/Dylan/Rosa are admins, not Leads/Contacts. If emailIndex is checked first and a stale Lead row exists for a team email, every email from that team member gets mislabeled as "Real Estate Lead" instead of "Team Internal". Mirrors the order in `buildParticipantMatches`. *Trace: 2026-05-16 — Noel's Royal Association email got `Real Estate Lead` because the order was reversed.*

**Bulk/backfill pass:** `/api/agent/label-emails` endpoint. Same OAuth `gmail.modify` scope as the cron. Accepts `operations: [{threadIds, addLabels, removeLabels}]`. **Hard-blocks adding any `CRM_*` label** — only the cron can add `CRM_PROCESSED` / `CRM_UNMATCHED` / `CRM_NEEDS_REVIEW` / `CRM_REPROCESSED`. Removal of those is allowed (lets a thread be re-queued without the heavy reprocess mode). Used for the 6-month backfill agent (sender-level classifications to keep spend under $20).

## 19. Where the code lives

- `api/cron/process-emails.js` — main orchestrator. Filters, participant matching, branching, write logic, Slack pings.
- `lib/gmail.js` — header parsing, label apply/remove, forwarded-sender parsing.
- `lib/email-extract.js` — Sonnet calls (extractEmailUpdate, extractTeamDiscussion).
- `lib/crm-contacts.js` — Airtable email index + client/deal/contact lists.
- `lib/slack.js` — webhook routing (per-owner via `getOwnerSlackWebhook`).
- `lib/team-inboxes.js` — Team Inboxes table CRUD.
- `api/cron/daily-audit.js` — 23:00 UTC scan of CRM_UNMATCHED + health check.
- `api/agent-trigger-resync.js` — Resync button proxy for catch-up runs.

## 20. Editing this skill

When changing a rule:
1. Edit this file.
2. Update the corresponding code in `api/cron/process-emails.js` and/or `lib/*.js` to match.
3. Commit both in the same change.
4. Deploy via `vercel --prod` from `~/poler-team-website/`.

Cron picks up new code on the next 5-minute tick. No restart needed.

## 22. `CRM_NEEDS_REVIEW` audit (added 2026-05-18)

The daily 23:00 UTC audit (§19, `api/cron/daily-audit.js`) MUST scan `label:CRM_NEEDS_REVIEW` in addition to `label:CRM_UNMATCHED`.

For each `CRM_NEEDS_REVIEW` thread > 24h old:
1. Re-fetch the thread + run Sonnet with a tighter prompt: "We previously flagged this for review. Identify a CRM record to link with medium-or-better confidence, OR explain the specific ambiguity in one sentence."
2. On confident match → write the activity, flip label to `CRM_PROCESSED`.
3. On still-ambiguous → include the thread in the daily Slack digest under a `🟡 Stalled CRM_NEEDS_REVIEW` section with the ambiguity reason so Kevin can decide manually.

Without §22, `CRM_NEEDS_REVIEW` was a dead-end label — Sonnet's first hesitation became permanent. Trace: 2026-05-18 — the AD1/Tru thread sat in NEEDS_REVIEW for 3 days even though the parent companies (AD1 Global, Century Hospitality) were both already in CRM.

## 21. Out-of-scope future builds (not v1)

- WhatsApp ingestion (use `whatsapp` MCP to mirror this pipeline for WA messages).
- Recurring task generator (cron that rolls forward `Due At` on recurring tasks after the date passes).
- Granola transcript → CRM activity integration (post-meeting auto-log).
- Mobile chat: extend `/api/chat` to be a full-CRM-read Sonnet-powered Q&A endpoint.

---

## Learnings

- 2026-05-19 [FAIL] consulting-topic emails about Mitch/Maikel/Royal/AD1 were getting logged as real-estate Lead notes via stale Lead rows. Fix: body-first refactor — `extractTeamDiscussion` is the primary classifier; participant Lead-matches require `isRealEstateSignal(m)`; consulting parent dedup against body refs.
- 2026-05-19 [WIN] hardcoded alias map in the Sonnet prompt is a 1-PR stopgap that closes the gap until a real `Client Aliases` table exists.

**Last updated:** 2026-05-19 — Body-first classification refactor. `extractTeamDiscussion` now runs FIRST on every email (no longer fallback / secondary). Participant matching becomes secondary; Lead participant-matches are gated on `isRealEstateSignal(m)` (FB ad / website form / CINC / MLS / explicit subject pattern); consulting parent matches dedup against body-extracted clientReferences. Added `kevinpolerservices.com` to the agency-sender skip list. Added §1 default-consulting line, §4.1 body-first order, §5 case-based branching, §5.2 hardcoded alias table. Wired in code: `api/cron/process-emails.js` has the new per-message flow + `isRealEstateSignal()` helper + `RE_LEAD_SIGNAL_*` constants; `lib/email-extract.js` has the alias section at the top of the `extractTeamDiscussion` system prompt; `lib/crm-contacts.js` already indexed Consulting Companies' direct Email field (no change needed).

Prior: 2026-05-18 — Added §3.1 (team-sender guarantee), §5.1 (extractTeamDiscussion always-on for internal senders — superseded by body-first 2026-05-19), §8.1 (thread continuity supersedes confidence), §22 (daily audit scans CRM_NEEDS_REVIEW). 2026-05-16 — §18 rewritten to match the inline `applyOngoingCategoryLabels` implementation + team-skip ordering rule.
