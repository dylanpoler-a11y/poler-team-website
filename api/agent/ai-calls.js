/**
 * /api/agent/ai-calls.js — Vercel Edge Function
 *
 * Powers the AI-calls dashboard (ai-calls.html). Reads ElevenLabs Conversational
 * AI as the system of record for every outbound/inbound Sammy call, and joins it
 * to the Poler CRM for the per-lead checkmarks.
 *
 * Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD  (optional date range, lead-local-ish)
 *        &password=... (web UI)  or  Authorization: Bearer <AGENT_API_TOKEN>
 *
 * Returns: { calls:[...], stats:{...}, byDay:[...] }
 *   call = { conversationId, mode, agentName, startUnix, startIso, durationSecs,
 *            pickedUp, leadId, leadName, phone, hasAudio,
 *            checks:{ noteLogged, reminderCreated, alertsSet, whatsappSent } }
 *
 * Env: ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID, ELEVENLABS_RAPPORT_AGENT_ID,
 *      ELEVENLABS_INBOUND_AGENT_ID, AGENT_API_TOKEN (for internal CRM calls).
 */

export const config = { runtime: 'edge' };

import { authorize } from '../_auth.js';

const EL = 'https://api.elevenlabs.io/v1/convai/conversations';

// ── In-memory cache ────────────────────────────────────────────────────────
// Edge functions may be invoked in separate V8 isolates, so this cache is
// per-isolate (best-effort), not shared. It still absorbs rapid retries that
// land in the SAME isolate — which is the common case for "click Refresh 3×".
// TTL: 45 s — short enough to get fresh data, long enough to stop a 429 storm.
const CACHE_TTL_MS = 45_000;
const _cache = new Map(); // key → { ts, body }

function cacheKey(fromStr, toStr) { return `${fromStr || ''}|${toStr || ''}`; }
function cacheGet(key) {
  const e = _cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) { _cache.delete(key); return null; }
  return e.body;
}
function cacheSet(key, body) { _cache.set(key, { ts: Date.now(), body }); }

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

// Fallback pickup heuristic from the list summary, used only when per-call detail
// is unavailable (calls beyond the detail-fetch cap).
function pickedUp(c) {
  return (c.message_count || 0) >= 2 && (c.call_duration_secs || 0) >= 8;
}

// Authoritative pickup test from the full conversation detail — mirrors the engine's
// resolveCall(): a REAL human exchange = >=8s AND the lead took >=2 turns, and either
// no voicemail OR enough turns (>=5) that a voicemail_detection misfire is overruled
// (a lead who answered live and said "don't leave voicemails" trips detection but is
// a real pickup). Voicemails / carrier messages / 1-turn greetings are NOT pickups.
function answeredFromDetail(det) {
  if (!det) return null;
  const turns = Array.isArray(det.transcript) ? det.transcript : [];
  const dur = (det.metadata && det.metadata.call_duration_secs) || 0;
  const userTurns = turns.filter((t) => t && t.role === 'user' && t.message && String(t.message).trim()).length;
  const voicemail = turns.some((t) =>
    (Array.isArray(t.tool_calls) && t.tool_calls.some((c) => c && c.tool_name === 'voicemail_detection')) ||
    (Array.isArray(t.tool_results) && t.tool_results.some((r) => r &&
      (r.tool_name === 'voicemail_detection' || String(r.result_value || '').includes('voicemail_detection_success')))));
  return dur >= 8 && userTurns >= 2 && (!voicemail || userTurns >= 5);
}

async function listConversations(key, agentId, afterUnix, beforeUnix) {
  const out = [];
  let cursor = null;
  for (let i = 0; i < 20; i++) { // cap 20 pages (~2000 convs)
    const u = new URL(EL);
    u.searchParams.set('agent_id', agentId);
    u.searchParams.set('page_size', '100');
    if (afterUnix) u.searchParams.set('call_start_after_unix', String(afterUnix));
    if (beforeUnix) u.searchParams.set('call_start_before_unix', String(beforeUnix));
    if (cursor) u.searchParams.set('cursor', cursor);
    const r = await fetch(u, { headers: { 'xi-api-key': key } });
    if (!r.ok) {
      // 429 = rate-limited: stop paging but keep whatever we already collected.
      // Other errors: same — stop but don't throw.
      break;
    }
    const d = await r.json();
    out.push(...(d.conversations || []));
    if (!d.has_more || !d.next_cursor) break;
    cursor = d.next_cursor;
  }
  return out;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }
  if (!authorize(req, null).ok) return json({ error: 'Unauthorized' }, 401);

  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return json({ error: 'ELEVENLABS_API_KEY not configured' }, 500);

  const url = new URL(req.url);
  const origin = url.origin;
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');
  const afterUnix = fromStr ? Math.floor(new Date(fromStr + 'T00:00:00').getTime() / 1000) : null;
  const beforeUnix = toStr ? Math.floor(new Date(toStr + 'T23:59:59').getTime() / 1000) : null;

  // ── Cache hit — return immediately so rapid refreshes don't re-hammer ElevenLabs.
  const ck = cacheKey(fromStr, toStr);
  const cached = cacheGet(ck);
  if (cached) {
    return new Response(cached, {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'X-Cache': 'HIT' },
    });
  }

  const agents = {
    first_touch: process.env.ELEVENLABS_AGENT_ID,
    rapport: process.env.ELEVENLABS_RAPPORT_AGENT_ID,
    inbound: process.env.ELEVENLABS_INBOUND_AGENT_ID,
    reactivation: process.env.ELEVENLABS_REACTIVATION_AGENT_ID,        // CINC pool
    crm_reactivation: process.env.ELEVENLABS_CRM_REACT_AGENT_ES,       // CRM book (ES)
    crm_reactivation_en: process.env.ELEVENLABS_CRM_REACT_AGENT_EN,    // CRM book (EN)
  };

  // 1) Pull conversations per agent (mode is known from which agent). Fire all
  //    agents in PARALLEL — this was a sequential loop (6 serial round-trips to
  //    ElevenLabs, each paginated), which was the #1 cause of the AI Calls view
  //    being slow to open. Merge order doesn't matter (sorted right after).
  let convs = [];
  const perAgent = await Promise.all(
    Object.entries(agents)
      .filter(([, aid]) => aid)
      .map(async ([mode, aid]) => {
        const list = await listConversations(key, aid, afterUnix, beforeUnix);
        return list.map((c) => ({ ...c, _mode: mode }));
      })
  );
  for (const list of perAgent) convs.push(...list);
  convs.sort((a, b) => (b.start_time_unix_secs || 0) - (a.start_time_unix_secs || 0));

  // 2) Fetch per-conversation detail (parallel batches) for call_sid + lead_id +
  //    external number. call_sid = the call actually reached Twilio (no sid =
  //    blocked/geo-rejected → dropped below). lead_id (dynamic var set when the call
  //    was placed) is the AUTHORITATIVE CRM link — replaces the old notes-scrape.
  const MAX_DETAIL = 800;                 // bound Edge runtime
  const targets = convs.slice(0, MAX_DETAIL);
  const detailById = {};
  let detailRateLimited = false;
  for (let i = 0; i < targets.length; i += 25) {
    // If a previous batch was rate-limited, stop fetching details for the rest —
    // the calls will assemble with whatever detail we already have.
    if (detailRateLimited) break;
    const batch = targets.slice(i, i + 25);
    const res = await Promise.all(batch.map(async (c) => {
      try {
        const r = await fetch(`${EL}/${c.conversation_id}`, { headers: { 'xi-api-key': key } });
        if (r.status === 429) { detailRateLimited = true; return null; }
        return r.ok ? await r.json() : null;
      } catch { return null; }
    }));
    res.forEach((d, j) => { if (d) detailById[batch[j].conversation_id] = d; });
  }

  // 3) Lead lookups by id + by phone-suffix (+ reminders), best-effort.
  //    If /api/get-leads fails entirely (Airtable down, rate-limited, etc.) we return
  //    a 503 so the frontend knows to keep its last-good render rather than show an
  //    empty "no calls" table.
  const byId = {}, byPhone = {};
  let reminderLeadIds = new Set();
  let leadsFetchFailed = false;
  try {
    const token = (process.env.SAMMY_ENGINE_TOKEN || (process.env.AGENT_API_TOKEN || '').split(',')[0]).trim();
    const h = { Authorization: `Bearer ${token}` };
    const [leadsRes, remRes] = await Promise.all([
      fetch(`${origin}/api/get-leads`, { headers: h }),
      fetch(`${origin}/api/get-reminders`, { headers: h }).catch(() => null),
    ]);
    if (!leadsRes.ok) {
      leadsFetchFailed = true;
    } else {
      const leads = (await leadsRes.json()).leads || [];
      for (const l of leads) {
        const rec = {
          leadId: l.id, leadName: l.name || l.firstName || '', phone: l.phone || '',
          notes: l.notes || '', alertsSet: String(l.alertActive).toLowerCase() === 'true',
        };
        byId[l.id] = rec;
        const dig = String(l.phone || '').replace(/\D/g, '');
        if (dig.length >= 10) byPhone[dig.slice(-10)] = rec;
      }
    }
    if (remRes && remRes.ok) {
      const rem = (await remRes.json()).reminders || [];
      for (const r of rem) {
        const lid = r.leadRecordId || r.leadId || (Array.isArray(r.lead) ? r.lead[0] : r.lead);
        if (lid) reminderLeadIds.add(lid);
      }
    }
  } catch (_) { leadsFetchFailed = true; }

  // If the leads fetch failed hard, bail out with 503 so the frontend keeps old data.
  if (leadsFetchFailed) {
    return json({ error: 'CRM leads temporarily unavailable — retry' }, 503);
  }

  // 4) Assemble — DROP outbound calls with no Twilio call_sid (blocked/never dialed,
  //    per Kevin: only calls that were actually placed). Match the rest by lead_id.
  const calls = [];
  for (const c of convs) {
    const det = detailById[c.conversation_id] || null;
    const pc = (det && det.metadata && det.metadata.phone_call) || {};
    const callSid = pc.call_sid || '';
    const inbound = (c.direction === 'inbound') || (pc.direction === 'inbound');
    if (!inbound && !callSid) continue;   // blocked before dialing — hide it

    // The post-call webhook logs this call's transcript_summary VERBATIM to the CRM
    // (api/elevenlabs-postcall.js -> log-call). Match a snippet of it to detect the
    // note — the raw conversation_id is NOT stored in notes, so the old conv-id check
    // never matched. Keep the conv-id check as a fallback for engine fire-time notes.
    const noteSummarySnippet = (det && det.analysis && det.analysis.transcript_summary)
      ? String(det.analysis.transcript_summary).trim().slice(0, 40) : '';
    const dv = (det && det.conversation_initiation_client_data
      && det.conversation_initiation_client_data.dynamic_variables) || {};
    let leadId = dv.lead_id || '';
    if (leadId.startsWith('react:')) leadId = '';   // synthetic CINC id, not a CRM record
    let lead = (leadId && byId[leadId]) || null;
    if (!lead) {                                     // fallback: match by phone
      const ext = String(pc.external_number || '').replace(/\D/g, '');
      if (ext.length >= 10) lead = byPhone[ext.slice(-10)] || null;
    }
    calls.push({
      conversationId: c.conversation_id,
      mode: c._mode,
      agentName: c.agent_name || '',
      direction: inbound ? 'inbound' : 'outbound',
      startUnix: c.start_time_unix_secs || 0,
      startIso: c.start_time_unix_secs ? new Date(c.start_time_unix_secs * 1000).toISOString() : null,
      durationSecs: c.call_duration_secs || 0,
      pickedUp: (() => { const a = answeredFromDetail(det); return a === null ? pickedUp(c) : a; })(),
      leadId: lead ? lead.leadId : null,
      leadName: lead ? lead.leadName : (inbound ? '(inbound caller)' : '(unmatched)'),
      phone: lead ? lead.phone : (pc.external_number || ''),
      hasAudio: c.status === 'done',
      checks: {
        noteLogged: !!(lead && lead.notes && (
          lead.notes.includes(c.conversation_id) ||
          (noteSummarySnippet && lead.notes.includes(noteSummarySnippet))
        )),
        reminderCreated: !!(lead && reminderLeadIds.has(lead.leadId)),
        alertsSet: !!(lead && lead.alertsSet),
        whatsappSent: !!(lead && /whatsapp propert|propiedades por whatsapp|sent \d+ propert/i.test(lead.notes)),
      },
    });
  }

  // 4) Stats + per-day buckets for the graph.
  const total = calls.length;
  const picked = calls.filter((c) => c.pickedUp).length;
  const byDayMap = {};
  for (const c of calls) {
    if (!c.startIso) continue;
    const day = c.startIso.slice(0, 10);
    byDayMap[day] = byDayMap[day] || { date: day, total: 0, picked: 0 };
    byDayMap[day].total += 1;
    if (c.pickedUp) byDayMap[day].picked += 1;
  }
  const byDay = Object.values(byDayMap).sort((a, b) => a.date.localeCompare(b.date));

  const responseBody = JSON.stringify({
    calls,
    stats: { total, picked, pickupRate: total ? Math.round((picked / total) * 100) : 0 },
    byDay,
  });
  // Only cache non-empty results — don't cache an accidental empty list.
  if (calls.length > 0) cacheSet(ck, responseBody);

  return new Response(responseBody, {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'X-Cache': 'MISS' },
  });
}
