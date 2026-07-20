---
name: new-agent-endpoint
description: Scaffold a new api/ serverless endpoint for this repo following the _auth.js convention. Use whenever adding any endpoint under api/ or api/agent/ — the checklist prevents the two bug classes that have already hit production (field-shape mismatch between caller and endpoint, positional token reads).
---

# New API Endpoint — poler-team-website

Every endpoint in this repo is a zero-dependency ES-module Vercel function using raw `fetch()`. Follow this template and checklist exactly.

## Template

```js
// api/agent/<name>.js — <one line: what it does, who calls it>
import { authorize } from '../_auth.js';   // './_auth.js' if directly under api/

export const config = { runtime: 'edge' };

const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

export default async function handler(req) {
    // CORS: any endpoint the CRM/browser calls is CROSS-ORIGIN — the CRM runs on
    // www.homesinsoflorida.com but fetches CRM_API_BASE (poler-team-website-two).
    // A JSON POST triggers a preflight, so you MUST answer OPTIONS and echo the
    // header on every response, or the browser reports "Failed to fetch".
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        } });
    }
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    let body = {};
    try { body = await req.json(); } catch { /* empty body ok */ }

    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);

    // 1. Validate inputs FIRST — allowlist regex, length caps, then work.
    // 2. Do the work with raw fetch() against Airtable/Bridge/etc.
    return json({ ok: true });
}
```

## Checklist (all mandatory)

1. **Auth before work.** `authorize(req, body)` and 401 on failure as the first real statement. No endpoint ships without it unless it is deliberately public (like `api/preconstructions.js`) — say so in the header comment.
2. **Diff the body fields against every caller.** Grep `api/mcp.js`, `~/poler-team-mcp/index.js`, and client JS for the call sites and match field names exactly — or accept both shapes like `save-lead.js` does. *Root: 2026-07-03, `firstName/lastName` vs `first/last` silently dropped 9 leads' names.*
3. **Engine-token resolution: `SAMMY_ENGINE_TOKEN` first, never a bare positional read.** If the endpoint calls the Sammy/Railway engine, use the codebase's documented pattern (`send-map-props.js`, `queue-props.js`, `elevenlabs-postcall.js`): `process.env.SAMMY_ENGINE_TOKEN || (process.env.AGENT_API_TOKEN || '').split(',')[0]` — the fallback only works because the machine token is pinned FIRST in the list. A bare `AGENT_API_TOKEN.split(',')[0]` with no `SAMMY_ENGINE_TOKEN` check is what broke 3 endpoints on the 2026-07-17 rotation.
4. **Validate before interpolating.** Any value that reaches an Airtable `filterByFormula` or a Bridge `.in=` list gets an allowlist regex (pattern: `send-map-props.js` `/^[A-Za-z0-9_-]+$/` + count cap). Escape anything rendered into HTML with `escHtml`.
5. **CRM notes go through `/api/agent/log-note`** (append) — never `update-lead({notes})` (overwrites). Note text follows the `crm-note-format` skill.
6. **If the endpoint should be reachable from claude.ai**, add a named tool for it in BOTH `api/mcp.js` (hosted) and `~/poler-team-mcp/index.js` (local) — claude.ai discovers by tool name; a new param on an old tool is not discoverable. Local MCP needs a Claude Code restart to appear.
7. **New env vars**: add to Vercel env AND `.env.local`, then record the name (never the value) in `~/.claude/references/env-locations.md`.
8. **Update CLAUDE.md's API list** if the endpoint is load-bearing, and commit — uncommitted api/ files are how the 2026-05-11 ~80-endpoint production loss happened.
