# Session handoff — auto alert profiles from browsing (Workstream B) — 2026-09-16

Plan: `~/.claude/plans/cozy-watching-mountain.md` (Workstream A = Meta `Lead` only for 0–12-month valid-phone leads, shipped earlier today as commit `cd6e334`; this handoff covers Workstream B).

## What changed (website)

| File | Change |
|---|---|
| `lib/bridge-listing.js` (new) | `fetchListingsByMls(token, ids, fields)` (batch, cap 50, ids regex-validated) + `fetchListingByMls`. Shared by `get-property` and `derive-profile`. |
| `lib/derive-profile.js` (new, pure) | `deriveAutoProfile({viewedIds, favoriteIds, searches, sourceMls, listings, timeline})` → browsing basis (≥2 distinct views, any favorite, or any logged search) or signup basis (only the ad listing). Price = IQR of prices when ≥4 listings, else min–max, ×0.85/1.15 (signup ×0.70/1.20); cities/types most-frequent-first, one-off values dropped once there are ≥6 observations, max 4 cities / 3 types; explicit search filters override; floor-only search (`$1M+`) keeps ≥1.5× headroom or opens the ceiling; beds = min seen − 1; frequency Weekly (0–6 mo) / Bi-Weekly (6–12) / Monthly (12+), count 3. Also `parseSearchParams`, `describeProfile`, `sameCriteria`. |
| `lib/alert-profile-fields.js` (new) | `computeAlertFields(profile, currentFields)` extracted from update-alerts. Adds `autoMeta` (whitelisted keys merged into profile #1, synthesizing #1 from flat fields when no wrapper) and `autoProfileConfirm:true` (profile #1 gets `auto:false, autoConfirmed:true, autoConfirmedAt`; no-op without a profile). |
| `api/agent/update-alerts.js` | Uses the shared field logic; fetches the current record only when needed. Behavior for existing callers unchanged (test k). |
| `api/agent/get-property.js` | Uses `fetchListingByMls`; 400 on bad mlsId, 502 on Bridge failure, 404 when missing. |
| `api/agent/derive-profile.js` (new) | POST `{leadId, dryRun?, backfill?}` (Bearer engine/agent token, CORS). Refuses `confirmed_profile` / `human_profile`. Reads `Properties Viewed` (newest first), `Saved Properties`, Lead Activity `Search` rows (30 d, by Lead Email), `Source URL ?mls=`; Bridge batch cap 20 (favorites first). Writes flat fields + wrapper + `autoMeta {auto, autoBasis, autoSources, autoConfirmed:false, autoUpdatedAt, autoBackfill?}` and a CRM note (agent "Sitio web (perfil automático)"). Returns `{ok, basis, profile, description, summary, unchanged, written}`. |
| `tools/test-derive-profile.mjs` (new) | 13 pure cases: `node tools/test-derive-profile.mjs`. |

Deployed to production (`npx vercel --prod --yes`) and verified live: dry runs on 4 real leads return sensible bands (e.g. Ricardo Ramirez → "Miami, Deerfield Beach · $1M–$1.5M · Single Family"), OPTIONS 200 with CORS, unauthenticated POST 401, `get-property` still 200.

## Monitor side (whatsapp-lead-monitor, deployed with `railway up`)

- `auto-profile.js` (new, pure): profile metadata reader, `isAutoConfirmation` (short ES/EN affirmatives, no negation, ≤80 chars), the fixed confirmation line, `statedCriteria`, confirm/replace notes.
- `index.js`: `runAutoProfiles` runs right before `runPropertyDrip` (build mode: no criteria, intro sent, ≥24 h old, ≤7 tries, 24 h retry; refresh mode: auto+unconfirmed and a newer login), cap 10 calls/tick, `AUTO_PROFILE_ENABLED=off` halts it. First drip of an unconfirmed auto profile appends the confirmation line once and stamps `autoAskedAt` on the CRM profile. Intro-before-drip guard. `planProps954` uses `props1_auto`/`props3_auto` (+`_en`) outside the 24 h window and falls back to the plain templates (question not marked asked) until Meta approves them.
- `buybox-capture.js`: on an unconfirmed auto profile, a plain "sí / me gustan / looks good" within 7 days of the question → `autoProfileConfirm:true` + note; stated criteria → replace + confirm + reminder; otherwise the old gap-fill.
- `property-drip.js`: `backfillAllowed` (from `autoBackfill`) exempts one pre-activation lead from the no-backfill gate.
- `tools/backfill-auto-profiles.mjs`: dry-run by default, `--live --limit 25`, `--only`, `--cutoff`, `--all-statuses`.
- Tests: `node test-auto-profile.mjs` (13), `test-buybox-capture.mjs` (33), `test-property-drip.mjs` (21).

## Still open

- **Twilio templates**: `poler_props1_auto` HXa2d53e…, `poler_props3_auto` HXac0ee5…, `poler_props1_auto_en` HXd4520a… APPROVED by Meta within the hour; `poler_props3_auto_en` HX2638f8… still pending (EN 3-slot out-of-window sends fall back to plain `props3_en` without the question until then). SIDs in monitor `.env` + Railway `TWILIO_WA_TPL_PROPS*_AUTO*`.
- **Verified live 2026-09-16 16:27–16:34 UTC**: two poller ticks built 20 profiles (13 signup basis, 7 browsing) and sent 20 first drips through `props3_auto` on the 954; Twilio shows delivered/read for the LATAM numbers, 1× 63049 and 1× 63024 (the Test lead, US number). `autoAskedAt` stamped on each profile.
- **Side effect to confirm with Kevin**: derive-profile sets `Alert Active = true` with real criteria, so `api/send-alerts.js` (email cron) will also start emailing these leads on their frequency.
- Backfill: dry run of the 5 newest eligible leads looked right (2 signup basis, 3 browsing). Run `node tools/backfill-auto-profiles.mjs --live --limit 25` once Kevin has seen the list; repeat daily until the eligible pool drains.
- Verify one real new signup end to end in Railway logs (`[auto-profile]` then `[drip]` with the confirmation line) — nothing was 24 h old at deploy time.
- `meta-ads` MCP connector authorization still needs Kevin's "done".

## Addendum 20:10 ET — Contacted is the Meta quality signal

**Correction to the top of this file:** the morning's 0–12-month `Lead` cut (cd6e334) was REVERTED at 16:34 by another session (6586dc5, 8deb759): `Lead` = valid phone, any timeline. Quality reaches Meta through `QualifiedLead` (lib/qualified-lead.js, once per lead: confirmed/human-set alert profile, or status Warm/Hot).

Kevin 20:04: "a lead that talks to Claudia and gives any sort of information goes to Contacted, and I want Meta to optimize for that." Shipped (site 7d9618a → Vercel 2mvy0dm10; monitor cd86a29 → Railway 7d5d382a SUCCESS, booted 00:07Z):
- `whatsapp-lead-monitor/contacted-rule.js` (+ `test-contacted-rule.mjs`, 5 pass): `shouldMarkContacted({status,text})` — any real reply on a New lead marks; low-signal (links/emoji), ack-only ("ok", "gracias"), opt-outs ("no me interesa", "stop", "wrong number"…) and leads past New do not. `isLowSignalInbound` moved here from reply-handler.
- `reply-handler.js`: after the Dead-revive block, before the mute check: PATCH `/api/update-lead {status:'Contacted'}` + headerless note "Respondió por WhatsApp (954|305) — status New → Contacted." Best-effort, never blocks the reply.
- `api/update-lead.js`: rank 1 (Contacted) now fires `QualifiedLead` via `fireQualifiedLeadOnce` (was the server-only `Contact` event). Manual CRM/MCP status changes fire it the same way.
- Adset 120248601575180556 still optimizes on `LEAD` ($15/day). The flip to QualifiedLead is a separate go from Kevin (ideally after 1–2 weeks of events). Baseline: 19 Contacted+ in the 30 days to 09-16, 10 of them "12+ months".
- Edge: the once-per-lead marker lives on alert profile #1; a lead with NO profile yet dedups only by event_id (48 h). Every signup gets an auto profile within 24 h, so the window is small.
- Live proof pending: next real reply → CRM note + Vercel `[qualified-lead] … reason=status_contacted capi=sent` + Events Manager QualifiedLead.
