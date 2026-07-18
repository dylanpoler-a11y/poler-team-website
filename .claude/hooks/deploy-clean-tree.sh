#!/bin/bash
# PreToolUse guard (Bash): block `vercel --prod` while the git tree is dirty.
# Root cause: 2026-05-11 — lib/* and api/agent/*.js existed only on disk, a later
# session deployed from a stale tree and silently dropped ~80 endpoints from
# production. Vercel CLI deploys the working directory, so anything uncommitted
# is live-but-unrecoverable the moment another session touches the repo.
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null) || cmd=""
[ -z "$cmd" ] && exit 0
# Match the word "vercel" (not e.g. "my-vercel-token") followed by --prod within
# the same shell segment (no | ; & in between), so "echo vercel && npm --production"
# does not trigger.
printf '%s' "$cmd" | grep -qE '(^|[^[:alnum:]_-])vercel[^|;&]*[[:space:]]--prod' || exit 0
root="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)"
[ -z "$root" ] && root="${CLAUDE_PROJECT_DIR:-$PWD}"
dirty=$(cd "$root" && git status --porcelain 2>/dev/null | head -20)
[ -z "$dirty" ] && exit 0
jq -cn --arg d "$dirty" \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:("BLOCKED: git tree is not clean. Commit (or deliberately stash/remove) these before `vercel --prod` — Vercel deploys the working directory, and uncommitted state caused the 2026-05-11 ~80-endpoint production loss:\n" + $d)}}'
