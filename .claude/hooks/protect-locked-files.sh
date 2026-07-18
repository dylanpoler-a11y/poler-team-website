#!/bin/bash
# PreToolUse guard (Edit|Write): locked files require explicit user approval.
# Locked per CLAUDE.md: root index.html / styles.css / script.js ("DO NOT MODIFY
# without explicit request"), vv-a.html / vv-b.html (printed door-hanger QR codes
# depend on these exact paths — real-estate CLAUDE.md hard rule), and .env* secrets.
input=$(cat)
f=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null) || f=""
[ -z "$f" ] && exit 0
# Root is derived from this script's own location (<root>/.claude/hooks/) so the
# guard works no matter what the session cwd is; env var is only a fallback.
root="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)"
[ -z "$root" ] && root="${CLAUDE_PROJECT_DIR:-$PWD}"
reason=""
case "$f" in
  "$root/index.html"|"$root/styles.css"|"$root/script.js")
    reason="Locked main-page file (CLAUDE.md: DO NOT MODIFY without explicit request)" ;;
  "$root/vv-a.html"|"$root/vv-b.html")
    reason="Via Ventura A/B page — printed door-hanger QR codes depend on this exact path; never rename, keep the fail-safe" ;;
  */.env|*/.env.*)
    reason="Environment secrets file" ;;
esac
[ -z "$reason" ] && exit 0
jq -cn --arg r "$reason: $f. Approve only if Kevin explicitly requested this change." \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"ask",permissionDecisionReason:$r}}'
