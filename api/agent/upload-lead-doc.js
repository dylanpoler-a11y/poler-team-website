/**
 * /api/agent/upload-lead-doc.js — upload file as Lead.Documents attachment.
 */

export const config = { runtime: 'edge' };

import { authorize } from '../_auth.js';

const FIELD = 'Documents';

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

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);

    let body;
    try { body = await req.json(); } catch { return json({ error: 'Invalid request body' }, 400); }

    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);

    const { id, filename, contentType, base64, url: fileUrl } = body;
    if (!id || !filename || (!base64 && !fileUrl)) {
        return json({ error: 'id, filename, and one of (base64 | url) are required' }, 400);
    }

    let fileB64 = base64;
    let inferredType = contentType;
    if (!fileB64 && fileUrl) {
        try {
            const fetchRes = await fetch(fileUrl);
            if (!fetchRes.ok) return json({ error: `Failed to fetch url (${fetchRes.status})` }, 400);
            if (!inferredType) {
                const ct = fetchRes.headers.get('content-type') || 'application/octet-stream';
                inferredType = ct.split(';')[0].trim();
            }
            const buf = await fetchRes.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
            fileB64 = btoa(binary);
        } catch (err) {
            return json({ error: `URL fetch failed: ${err.message}` }, 400);
        }
    }

    const url = `https://content.airtable.com/v0/${baseId}/${id}/${encodeURIComponent(FIELD)}/uploadAttachment`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contentType: inferredType || 'application/octet-stream',
            file: fileB64, filename,
        }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return json({
            error: err.error?.message || 'Failed to upload',
            status: res.status,
            hint: res.status === 422 ? "Add a 'Documents' (attachment) field to the Leads table." : undefined,
        }, 500);
    }
    const data = await res.json();
    return json({ success: true, attachments: data.fields?.[FIELD] || [] });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
