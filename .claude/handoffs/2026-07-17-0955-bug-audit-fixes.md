# Handoff — 2026-07-17 bug-audit fixes (3-agent review → fixes)

## Goal
Kevin asked for a bug audit of CRM + listing page + Claudia + all loops; 18 verified findings; he approved the fix plan ("go ahead"). Execute criticals + majors, then rotate 2 leaked tokens.

## State (done + verified)
- **CAPI (earlier today):** live + verified (server Lead event dedup'd, quality events, token in Vercel). Test event `events_received:1`, shows Processed/Server.
- **Reminders page fix (7/16-17):** deployed (blank-agentEmail visible + refetch-on-open).
- **Contact-sync/node outage:** `brew reinstall node` (v26.5.0) fixed 8+ launchd jobs; 3 missed leads created (Yesid Zafra, Cristhian Romero Pineda, María Consuelo Amaya).
- **Audit fixes shipped:**
  - Railway `/incoming` unauth → `if (IS_CLOUD) return res.sendStatus(404)` (reply-handler.js ~2067). Deployed Railway (SUCCESS 09:42) + verified: Railway /incoming=404, /healthz ok, Mac /incoming=200.
  - Kenneth referral persona → third-person on 954 (`isClaudiaLine` branch, reply-handler.js ~1108). Deployed same push.
  - `AI_CALL_ENABLED` default now 'false' + hard gate inside `fireAICall` (index.js). Deployed same push.
  - claudia-qa-loop fixer hardened (fixer.js): self-commit tripwire (HEAD≠checkpoint → hard reset + needs-human), full `git clean -fd` rollback, path-based forbidden rails (.env/state/), empty-diff commit guard; orphan-session reaper `reapOrphanFixerSessions(WALM_DIR)` in lib.js, called in fixer main + detector 15-min tick. STOP file created then REMOVED (fixer re-enabled, runs 00:20).
  - Website: get-leads.js cap 10→200 pages; localStorage guards (i18n.js getLang/setLang + listing.js initLeadCapture + completeLead). Deployed `npx vercel --prod` + live-verified (grep markers on prod).
  - speed-dash: 401 no longer echoes key (publish.js); ACCESS_KEY rotated (old PolerSpeed2026 dead=401, new PS-<hex> in speed-autoresearch/.env works=200); redeployed.
  - ads-autoresearch executor.py: `_audit_created_ids` now live-verifies created ad `status` == PAUSED, force-pauses (+violation alert) otherwise; `_force_pause_ad` helper. Parse-checked.
  - chmod 600 loopnet-autoresponder/.env + speed-autoresearch/.env.

## Pending (exact next steps)
1. **AGENT_API_TOKEN rotation (leaked to subagent transcript via `railway variables --json`).** Value hash prefix 7a35909731 shared by: whatsapp-lead-monitor/.env, poler-team-mcp/.env, clairvo-clone/.env (flash-coach Vercel env too), claudia-qa-loop/.env, ads-autoresearch/.env, contact-sync/.env, desk-call-recorder/.env, Railway env (AGENT_API_TOKEN, maybe embedded in BRIDGE_URL query — CHECK), poler-team-website Vercel AGENT_API_TOKEN **list** (comma-separated per _auth.js — claude.ai connector tokens are OTHER members; do not touch them).
   Zero-downtime plan: (a) add NEW alongside leaked member in Vercel list → deploy; (b) flip all client .envs + Railway + flash-coach Vercel to NEW; restart launchd reply-handler + sammy-proxy (proxy gates /bridge on this token — WALM .env value); redeploy Railway + flash-coach; (c) verify (healthz, authed curl, /bridge); (d) remove leaked member from list → deploy → verify old 401s.
2. **ANTHROPIC_API_KEY rotation** (same leak; hash b741842ec0; holders: whatsapp-lead-monitor/.env + Railway; website Vercel ANTHROPIC may be a different key — compare via `vercel env pull` hash before touching). New key needs console.anthropic.com via Chrome MCP (Kevin logged in?) → pbcopy → .env + Railway → deploy → verify a draft reply works → disable old key.
3. ~~Bridge proxy~~ DONE 10:55: api/bridge/listings.js live, token stripped from listing.js/crm.js/str.html, verified end-to-end. REMAINING: ask Bridge Interactive to reissue the token (old one was public for months, still valid) — then update Vercel env + local .envs only. Also minors: QA fail-open, BLOCKED_PHONES dedup, mute-sync retry, send-alerts fail-closed, weak lead passwords, stale 305 comments, log rotation. 3 agency launchd jobs NOT LOADED (message-watcher/prospector/status-reporter) — left alone pending Kevin.

## Added later (same day)
- 12:33-13:00: MAP SELECT-AND-SEND feature (api/agent/send-map-props.js NEW + crm.js popup/selection/bar + crm.css + buildAlertEmail export). Cold-QA'd, 3 fixes applied, deployed, endpoint live-verified. UI needs Kevin's own click-through (login gate).
- 11:03-11:30: queue-props/954 token fix + Twilio wrong-account fix (see learnings).

## Touched (systems mutated today)
Vercel poler-team-website (3 prod deploys), Railway sammy-engine (1 deploy), Vercel speed-dash (env + deploy), launchd (contact-sync, claudia-qa-detector reloaded; reply-handler kickstarted), Google Contacts (3 created), Meta Events Manager (CAPI token generated, "without Dataset Quality API"), Vercel env (META_CAPI_ACCESS_TOKEN added; speed-dash ACCESS_KEY rotated), files per above.

## Gotchas
- poler-team-website git tree HEAVILY dirty (25+ files) — disk = prod truth, git HEAD stale. Don't trust HEAD.
- whatsapp-lead-monitor edits are LIVE on Railway + Mac; LEARNINGS.md there documents everything.
- Fixer STOP file is REMOVED — nightly fixer armed tonight with new rails.
- impeccable hook flags listing.js L~1143 broken-image → false positive (lightbox template img, src set by JS).
