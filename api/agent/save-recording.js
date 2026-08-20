/**
 * /api/agent/save-recording.js — Vercel Edge Function
 * Append a Flash live-coach call recording to a lead's "Flash Recordings" field.
 *
 * Body: { leadId, url, recordedAt?, durationSec?, callId? }
 * Auth: Authorization: Bearer <AGENT_API_TOKEN>  (or password)
 *
 * Storage: multilineText JSON array [{url, recordedAt(ISO), durationSec, callId}], newest first.
 * The audio file itself lives on Vercel Blob (uploaded by Flash); we only store the URL + metadata.
 * The panel renders each as a dated <audio> player under "Flash voice recordings".
 */

export const config = { runtime: 'edge' };

import { authorize } from '../_auth.js';

const MAX = 100; // bound the field size

export default async function handler(req) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors() });
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;

    let body;
    try { body = await req.json(); }
    catch { return json({ error: 'Invalid request body' }, 400); }

    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);

    const { leadId, url, transcriptUrl, recordedAt, durationSec, callId } = body;
    if (!leadId || (!url && !transcriptUrl)) return json({ error: 'leadId and url or transcriptUrl are required' }, 400);

    // Only accept https URLs from Flash's storage hosts — defense in depth (the postMessage
    // is also origin-checked). Vercel Blob = pre-2026-07-20 recordings; Cloudinary = current
    // (switched when the flash-blob store got suspended and playback + uploads died).
    // transcriptUrl (2026-07-21) = the call's plain-text transcript, same hosts.
    const validHost = (v) => {
        let u;
        try { u = new URL(v); } catch { return false; }
        return u.protocol === 'https:' && /^([a-z0-9-]+\.public\.blob\.vercel-storage\.com|res\.cloudinary\.com)$/.test(u.host);
    };
    if (url && !validHost(url)) return json({ error: 'url must be an https Vercel Blob or Cloudinary URL' }, 400);
    if (transcriptUrl && !validHost(transcriptUrl)) return json({ error: 'transcriptUrl must be an https Vercel Blob or Cloudinary URL' }, 400);

    const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

    const cur = await fetch(`https://api.airtable.com/v0/${baseId}/Leads/${leadId}`, { headers });
    if (!cur.ok) return json({ error: 'Lead not found' }, 404);
    const existingRaw = (await cur.json()).fields?.['Flash Recordings'] || '';

    let list = [];
    try { const p = JSON.parse(existingRaw); if (Array.isArray(p)) list = p; } catch { /* start fresh */ }

    // The audio and the transcript of ONE call arrive as SEPARATE saves (two uploads,
    // two postMessages) — merge by callId, never let the later save drop the earlier
    // field. crm.js additionally serializes the two POSTs so the read-modify-write
    // here can't interleave.
    const prior = callId ? list.find((r) => r && r.callId === String(callId).slice(0, 64)) : null;
    const entry = {
        url: url ? String(url) : (prior && prior.url) || '',
        recordedAt: recordedAt && !Number.isNaN(Date.parse(recordedAt)) ? recordedAt : (prior && prior.recordedAt) || new Date().toISOString(),
        durationSec: Math.max(0, Math.round(Number(durationSec) || 0)) || (prior && prior.durationSec) || 0,
        callId: callId ? String(callId).slice(0, 64) : '',
        ...((transcriptUrl || (prior && prior.transcriptUrl)) ? { transcriptUrl: transcriptUrl ? String(transcriptUrl) : prior.transcriptUrl } : {}),
    };
    const deduped = entry.callId ? list.filter((r) => r && r.callId !== entry.callId) : list.filter(Boolean);
    list = [entry, ...deduped].slice(0, MAX);

    const patchRes = await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ records: [{ id: leadId, fields: { 'Flash Recordings': JSON.stringify(list) } }] }),
    });
    if (!patchRes.ok) {
        const err = await patchRes.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to save recording' }, 500);
    }

    return json({ success: true, recording: entry, count: list.length });
}

// Same-origin caller (crm.js) doesn't need CORS; scope ACAO to the CRM so no cross-origin
// page can read a response from this password-in-body endpoint.
const SITE_ORIGIN = 'https://www.homesinsoflorida.com';
function cors() {
    return {
        'Access-Control-Allow-Origin': SITE_ORIGIN,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
}
function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': SITE_ORIGIN },
    });
}
