---
description: Write or update the mandatory session handoff file (CLAUDE.md format)
---

Create or update this session's handoff file per the "Session Handoffs (Mandatory)" section of CLAUDE.md.

Current tree state:
!`git status --porcelain`
!`git diff --stat HEAD 2>/dev/null | tail -5`

Rules:
- Location: `.claude/handoffs/YYYY-MM-DD-HHMM-<short-slug>.md` (this repo). If this session already has a handoff file, UPDATE it — never create a second one for the same session.
- Required sections, all five, every time:
  - **Goal**: one sentence on what this session is trying to do
  - **State**: what's done — specific file:line refs, deployment URLs, commit SHAs, Airtable record IDs
  - **Pending**: exact next step, command-ready if possible
  - **Touched**: every file modified and every external system mutated (Vercel deploys, Airtable writes, env-var changes, git commits)
  - **Gotchas**: stashes, uncommitted work (see tree state above — anything listed there exists only on disk), half-deployed changes, things the next session would step on
- After writing it once, keep updating the same file after every meaningful action for the rest of the session. A handoff written once at 80% context is stale by 81%.
