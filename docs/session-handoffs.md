# Session handoff procedure

Moved out of `CLAUDE.md` (line budget). The RULE stays in the CLAUDE.md; this is the
full template and steps.

When the system reminder fires that **context is getting full (~75–80%)**, **immediately** write a session handoff and KEEP UPDATING IT for the rest of the session. Do NOT wait for auto-compact — compact summaries are lossy by design.

Location: `<project>/.claude/handoffs/YYYY-MM-DD-HHMM-<short-slug>.md` (use `~/business/real-estate/poler-team-website/.claude/handoffs/`).

Required sections in every handoff:
- **Goal**: one sentence on what this session is trying to do
- **State**: what's done — be specific (file:line refs, deployment URLs, commit SHAs, Airtable record IDs)
- **Pending**: exact next step, command-ready if possible
- **Touched**: every file modified, every external system mutated (Vercel deploys, Airtable writes, env-var changes, git commits)
- **Gotchas**: stashes, uncommitted work, half-deployed changes, things the next session would step on

After writing it once, UPDATE the same file after every meaningful subsequent action until the session ends. A handoff written once at 80% is stale by 81%.

**Why this is here:** 2026-05-11 session left lib/* and api/agent/*.js uncommitted on disk; next session inherited a stale working tree and deployed a partial codebase, silently dropping ~80 endpoints from production. A live handoff would have warned the next session that those files existed only on disk and on the Vercel deployment, not in git. Committing the active work to `main` is the other half of this defense.
