# Session Handoff — server-side note stamps + /crm-change + /build-crm — 2026-09-10

## What Kevin saw
Listings → 505 SE 16th St → Buyer Leads → James Barnes: note began `[2026-09-10 17:36 ET] Convo:` — an ISO date, hand-rolled by another session. Seven more buyer leads (Golden Capital / hotel-inbox backfill, 22:36Z) had NO stamp at all. Root cause: `/api/save-lead` stored `body.notes` raw, so every producer that creates a lead with a note had to stamp it itself — the LoopNet responder did it right, one session did it wrong, one didn't at all.

## What changed (all deployed to prod — see "Deploy" below)
- **NEW `lib/note-stamp.js`** — `noteStamp(agent, when)` + `stampNote(body, agent, when)`: canonical `[M/D/YYYY, h:MM AM — agent]` in ET; strips a foreign leading bracketed date stamp; passes already-canonical bodies through unchanged. Edge-safe.
- `api/save-lead.js` — `'Notes': stampNote(body.notes, body.noteAgent || body.agent || 'Manual entry')`.
- `api/agent/log-note.js` — uses `stampNote(note, agent)` (also normalizes a foreign stamp a caller sneaks in).
- `crm.js` — "+ Add Contact" sends `noteAgent: currentAgent.name`.
- `~/business/real-estate/active/execution/loopnet-autoresponder/loopnet_autoresponder.py` — `_stamp()` removed; sends `notes` raw + `noteAgent: "LoopNet auto-responder"`. Launchd job picks the file up on its next 5-min tick (no reload needed — the script is re-executed per tick).
- **Backfilled 9 live records** via `/api/agent/update-note` (James Barnes → `[9/10/2026, 5:36 PM — Claude]`; 7 hotel leads → `[9/10/2026, 6:36 PM — Claude]`; Leonardo Rezende (3/9/2026) → `— Kevin`). Re-scan: 0 non-canonical notes remain except the `ZZTEST` record.

## The "same rules as a regular lead" question
The ONLY rule buyer leads were breaking was the note stamp. Everything else differs on purpose: `manualEntry` → `status Contacted`, no welcome email, no team ping, truthful `consentNote` (2026-08-18 Pepe Wong rule — a hand/machine-added contact must not get "you just signed up" from the 954). Documented in `~/.claude/references/crm-conventions.md` §2.

## New commands (so Kevin never repeats this)
- `~/.claude/references/crm-conventions.md` — every CRM rule in one file (architecture, data, UI, process, client-build parameters, forbidden list).
- `/crm-change` — `~/.claude/skills/crm-change/SKILL.md` — any CRM add/change/fix: load conventions → locate → tier → build checklist → review → deploy → live verify → backfill → handoff → capture corrections back into the conventions file.
- `/build-crm` — `~/.claude/workflows/build-crm.js` — new client CRM from the Poler reference: Scope → Scaffold → Data (Airtable) → Brand → Review (conventions checker + code review) → Deploy (preview by default) → Report. MAX_AGENTS 8. Output `~/business/agency/active/clients/<slug>/crm/`. Session asks Kevin the parameter questions first (workflows can't pause).

## Deploy
Prod deploy 2026-09-10 7:44 PM ET from a clean HEAD+4-file export (other sessions' uncommitted tower/preconstruction WIP left undeployed). Live smoke: save-lead + log-note both produced `[9/10/2026, 7:44 PM — Smoke test]`; test record deleted; ZZTEST deleted. Verify: `POST /api/save-lead` (manualEntry, notes without stamp) → record's Notes begins with the canonical stamp; `POST /api/agent/log-note` with a `[2026-…]` prefix → normalized.

## Open
- ZZTEST record (`ZZTEST — safe to delete DeleteMe`) still in Airtable — delete when convenient.
- Other producers that pass pre-stamped notes (Sammy `note-builder.js`, email cron, Flash) keep working — canonical bodies pass through. Migrate them to `noteAgent` opportunistically.
