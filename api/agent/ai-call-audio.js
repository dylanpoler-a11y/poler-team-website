/**
 * /api/agent/ai-call-audio.js — Vercel Edge Function
 *
 * Proxies the ElevenLabs call recording for a conversation so the dashboard can
 * play it back without exposing the ElevenLabs API key in the browser.
 *
 * Query: ?id=<conversation_id>&password=...  (or Authorization: Bearer token)
 * Returns: audio/mpeg — RANGE-AWARE (206 partial content).
 *
 * 2026-07-01 fix: Safari's <audio> element refuses to play sources that ignore
 * Range requests (it probes with `Range: bytes=0-1` and expects 206). The old
 * pass-through stream returned 200 with no Accept-Ranges, so recordings were
 * SILENT in Safari (Kevin: Regina's 6/9 call). We now buffer the mp3 (a few MB)
 * and answer Range requests properly; also enables seeking in every browser.
 *
 * Env: ELEVENLABS_API_KEY.
 */

export const config = { runtime: 'edge' };

import { authorize } from '../_auth.js';

export default async function handler(req) {
  if (!authorize(req, null).ok) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }
  const key = process.env.ELEVENLABS_API_KEY;
  const id = new URL(req.url).searchParams.get('id');
  if (!key || !id) {
    return new Response(JSON.stringify({ error: 'missing key or id' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${id}/audio`, {
    headers: { 'xi-api-key': key },
  });
  if (!r.ok) {
    return new Response(JSON.stringify({ error: `audio fetch ${r.status}` }), {
      status: r.status, headers: { 'Content-Type': 'application/json' },
    });
  }

  const buf = await r.arrayBuffer();
  const total = buf.byteLength;
  const common = {
    'Content-Type': 'audio/mpeg',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    'Access-Control-Allow-Origin': '*',
  };

  // Range support (Safari sends `bytes=0-1` as a probe, then real ranges).
  const range = (req.headers.get('range') || '').match(/bytes=(\d*)-(\d*)/);
  if (range && (range[1] !== '' || range[2] !== '')) {
    let start = range[1] === '' ? Math.max(0, total - Number(range[2])) : Number(range[1]);
    let end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : total - 1;
    if (!(start >= 0 && start < total)) {
      return new Response(null, { status: 416, headers: { ...common, 'Content-Range': `bytes */${total}` } });
    }
    end = Math.min(end, total - 1);
    const slice = buf.slice(start, end + 1);
    return new Response(slice, {
      status: 206,
      headers: {
        ...common,
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': String(slice.byteLength),
      },
    });
  }

  return new Response(buf, {
    status: 200,
    headers: { ...common, 'Content-Length': String(total) },
  });
}
