/**
 * /api/elevenlabs-postcall.js — ElevenLabs Conversational AI post-call webhook
 *
 * Fired by ElevenLabs after a speed-to-lead AI voice call ends. It:
 *   1. Logs the call (summary + duration) to the CRM   → /api/agent/log-call
 *   2. Hands the transcript to /api/sync-call-notes, which Claude-extracts
 *      property preferences → sets Alert Profiles, updates Status, and creates
 *      a follow-up reminder (reused, not rebuilt).
 *
 * The lead is matched via `lead_id`, passed as a dynamic variable when the call
 * was placed (whatsapp-lead-monitor/index.js → fireAICall).
 *
 * Payload shape varies by ElevenLabs version, so fields are read defensively
 * from either the top level or a nested `data` object.
 *
 * Env: AGENT_API_TOKEN (Bearer for the CRM agent API), ELEVENLABS_WEBHOOK_SECRET
 *      (optional shared key — if set, required as ?key=... on the webhook URL).
 */

export const config = { runtime: 'edge' };

const CRM_BASE = 'https://www.homesinsoflorida.com';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Format a CRM note per the mandatory spec:
 *   [<TYPE> — YYYY-MM-DD]
 *   Convo:
 *   • <bullet>
 *   Next:
 *   • <bullet>
 * TYPE ∈ {CALL, VOICEMAIL, MISSED CALL, FOLLOWUP, WHATSAPP, SMS, EMAIL}
 * If convId is provided it is appended as a trailing `[conv <id>]` tag so the
 * AI Calls dashboard can match the note back to the ElevenLabs conversation.
 */
function buildNote({ type, date, convo = [], next = [], convId = '' }) {
  const d = date || new Date().toISOString().slice(0, 10);
  const convoLines = convo.map((l) => `• ${l}`).join('\n');
  const nextLines = next.map((l) => `• ${l}`).join('\n');
  const tag = convId ? `\n[conv ${convId}]` : '';
  return `[${type} — ${d}]\nConvo:\n${convoLines}\nNext:\n${nextLines}${tag}`;
}

export default async function handler(req) {
  // Health check — ElevenLabs / manual verification of the webhook URL
  if (req.method === 'GET') return json({ status: 'ok' });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Optional shared-secret gate (the endpoint is public)
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (secret) {
    const key = new URL(req.url).searchParams.get('key');
    if (key !== secret) return json({ error: 'Unauthorized' }, 401);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  // ElevenLabs nests the real payload under `data` (post_call_transcription);
  // older/flat shapes put it at the top level — handle both.
  const d = body.data || body;

  const conversationId = d.conversation_id || body.conversation_id || '';
  const dv = (d.conversation_initiation_client_data || {}).dynamic_variables || {};
  const leadId = dv.lead_id || '';

  // Transcript: array of segments or a string
  let transcript = d.transcript;
  if (Array.isArray(transcript)) {
    transcript = transcript
      .map((s) => `${s.role || s.speaker || '?'}: ${s.message || s.text || ''}`)
      .join('\n');
  }
  transcript = (transcript || '').trim();

  const analysis = d.analysis || {};
  const summary = analysis.transcript_summary || d.summary || '';
  const duration =
    (d.metadata && d.metadata.call_duration_secs) || d.call_duration_secs || d.duration || 0;
  const callStatus = d.status || analysis.call_successful || 'completed';

  // AGENT_API_TOKEN may be a comma-separated list — use the first for internal calls.
  const token = (process.env.SAMMY_ENGINE_TOKEN || (process.env.AGENT_API_TOKEN || '').split(',')[0]).trim();
  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Without a lead_id we can't tie the call back to a CRM record.
  if (!leadId) {
    console.warn('[el-postcall] no lead_id in payload; conv', conversationId);
    return json({ status: 'ok', note: 'no lead_id — skipped' });
  }

  const results = {};

  // 1) Log the call as an activity (summary + duration)
  // Voicemail = no transcript (lead never spoke). Real call = transcript present + summary.
  // Format follows the mandatory CRM note spec (crm-note-format SKILL.md).
  // The [conv <id>] tag is preserved so the AI-Calls dashboard can match this note back
  // to the ElevenLabs conversation, and the engine's backstop logger can dedup against it.
  try {
    const isVoicemail = !transcript;
    const noteType = isVoicemail ? 'VOICEMAIL' : 'CALL';
    const convoLines = isVoicemail
      ? ['Voicemail — no contact (lead did not answer).']
      : [summary ? summary.trim() : 'AI speed-to-lead call (no summary).'];
    const nextLines = isVoicemail
      ? ['WhatsApp follow-up sent; retry call on next cadence.']
      : ['Lead engaged. Await reply or schedule next touch.'];
    const callNote = buildNote({ type: noteType, convo: convoLines, next: nextLines, convId: conversationId });
    const r = await fetch(`${CRM_BASE}/api/agent/log-call`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        leadId,
        summary: callNote,
        durationMin: duration ? Math.max(1, Math.round(duration / 60)) : undefined,
        agent: 'AI Voice (ElevenLabs)',
      }),
    });
    results.logCall = r.status;
  } catch (e) {
    results.logCall = `error: ${e.message}`;
  }

  // 2) Hand the transcript to the existing extractor → alerts + status + reminder
  if (transcript) {
    try {
      const r = await fetch(`${CRM_BASE}/api/sync-call-notes`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          leadRecordId: leadId,
          transcript,
          meetingTitle: 'AI Speed-to-Lead Call',
        }),
      });
      results.syncCallNotes = r.status;
    } catch (e) {
      results.syncCallNotes = `error: ${e.message}`;
    }
  } else {
    results.syncCallNotes = 'skipped (no transcript — likely no-answer/voicemail)';
  }

  console.log('[el-postcall] lead', leadId, 'conv', conversationId, results);
  return json({ status: 'ok', leadId, conversationId, results });
}
