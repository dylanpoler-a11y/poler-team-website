/**
 * /api/agent/queue-props.js — Vercel Edge Function
 *
 * CRM lead-panel button "Enviar 3 propiedades" (Kevin 2026-07-02): queues a
 * manual property send for a lead. Proxies to the Sammy engine on Railway
 * (reply-handler /admin/queue-props), which drops a request file the poller
 * consumes on its next tick (≤3 min): 3 FRESH listings matching the lead's
 * ALERT CRITERIA, one WhatsApp message from the official 954 (Claudia)
 * with the drip-style intro (all proactive sends ride the 954 since 2026-07-13). Quiet hours (9am–8pm lead-local) defer the send to 9am.
 *
 * Body: { leadId }   Auth: Bearer AGENT_API_TOKEN or { password } in body.
 * Returns: { ok, queued|already } or { error }.
 */

export const config = { runtime: 'edge' };

import { authorize } from '../_auth.js';

const ENGINE_BASE = process.env.SAMMY_ENGINE_BASE || 'https://sammy-engine-production.up.railway.app';

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body = {};
  try { body = await req.json(); } catch { /* empty body */ }
  if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);

  const leadId = String(body.leadId || '').trim();
  if (!/^rec[A-Za-z0-9]{5,}$/.test(leadId)) return json({ error: 'bad leadId' }, 400);

  // The engine's adminAuthed expects ITS single machine token. Prefer the
  // dedicated SAMMY_ENGINE_TOKEN env (added 2026-07-17 after a token rotation
  // broke the old first-entry-of-the-list assumption); the split() fallback
  // keeps working only because the machine token is kept FIRST in the list.
  const token = (process.env.SAMMY_ENGINE_TOKEN || (process.env.AGENT_API_TOKEN || '').split(',')[0]).trim();
  if (!token) return json({ error: 'engine token not configured' }, 500);

  try {
    const r = await fetch(`${ENGINE_BASE}/admin/queue-props`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: data.error || `engine ${r.status}` }, 502);
    return json(data);
  } catch (e) {
    return json({ error: `engine unreachable: ${e.message}` }, 502);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
