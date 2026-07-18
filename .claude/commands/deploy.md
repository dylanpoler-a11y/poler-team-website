---
description: Deploy homesinsoflorida.com to production (commit-first, verify after)
disable-model-invocation: true
---

Deploy this repo to production following the CLAUDE.md sequence exactly.

Current tree state:
!`git status --porcelain`

Steps:
1. Confirm you are in `/Users/kevinpoler/business/real-estate/poler-team-website` (`pwd` + `git remote -v`). This repo serves homesinsoflorida.com ONLY.
2. If the tree above is dirty: commit everything relevant to `main` first (uncommitted files deployed via CLI caused the 2026-05-11 ~80-endpoint production loss). Do not stash work around the deploy — commit it.
3. Deploy: `npx vercel --prod --yes` from the repo root. There is NO git auto-deploy; the CLI is the only deploy path.
4. Verify: `npx vercel ls` shows the new production deployment, then curl `https://www.homesinsoflorida.com` and one API route (e.g. `/api/preconstructions`) for 200s. If the change was UI-visible, screenshot the affected page via the browser preview.
5. If a session handoff file is open in `.claude/handoffs/`, update its **Touched** section with this deploy (URL + what shipped).

Report what shipped and the verification results. If anything fails, report the failure — do not retry-loop deploys.
