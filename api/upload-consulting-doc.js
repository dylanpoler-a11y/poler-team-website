/**
 * /api/upload-consulting-doc.js — Vercel Edge Function
 * Uploads a file as an attachment on a Consulting Clients record.
 *
 * Body: { id, password, field, filename, contentType, base64 }
 *   field: one of 'Contracts' | 'Deliverables' | 'Spreadsheets' | 'Misc'
 *   base64: file contents encoded as base64 (NO data: prefix — just the bytes)
 *
 * Uses Airtable's content upload endpoint:
 *   POST https://content.airtable.com/v0/{baseId}/{recordId}/{fieldNameOrId}/uploadAttachment
 *
 * Required env vars: AIRTABLE_API_KEY, AIRTABLE_BASE_ID, CRM_PASSWORD
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';

const ALLOWED_FIELDS = ['Contracts', 'Deliverables', 'Spreadsheets', 'Misc'];

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        });
    }

    if (req.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405);
    }

    const apiKey  = process.env.AIRTABLE_API_KEY;
    const baseId  = process.env.AIRTABLE_BASE_ID;
    const crmPass = process.env.CRM_PASSWORD;

    if (!apiKey || !baseId) {
        return json({ error: 'Airtable not configured' }, 500);
    }

    let body;
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Invalid request body' }, 400);
    }

    const { id, password, field, filename, contentType, base64, url: fileUrl, targetType = 'company' } = body;
    if (!authorize(req, body).ok) {
        return json({ error: 'Unauthorized' }, 401);
    }
    if (!id || !field || !filename || (!base64 && !fileUrl)) {
        return json({ error: 'id, field, filename, and one of (base64 | url) are required' }, 400);
    }
    if (!ALLOWED_FIELDS.includes(field)) {
        return json({ error: `field must be one of ${ALLOWED_FIELDS.join(', ')}` }, 400);
    }
    if (!['company', 'deal'].includes(targetType)) {
        return json({ error: "targetType must be 'company' or 'deal'" }, 400);
    }

    // ── If URL mode: fetch the file server-side, base64-encode it, infer
    //    contentType from response headers if not provided.
    let fileB64       = base64;
    let inferredType  = contentType;
    if (!fileB64 && fileUrl) {
        try {
            const fetchRes = await fetch(fileUrl);
            if (!fetchRes.ok) {
                return json({ error: `Failed to fetch url (${fetchRes.status})` }, 400);
            }
            if (!inferredType) {
                // Strip any content-type parameters (e.g. "application/pdf; qs=0.001"
                // — Airtable rejects parameter-suffixed types).
                const ct = fetchRes.headers.get('content-type') || 'application/octet-stream';
                inferredType = ct.split(';')[0].trim();
            }
            const buf = await fetchRes.arrayBuffer();
            // Edge runtime: convert ArrayBuffer to base64
            const bytes = new Uint8Array(buf);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            fileB64 = btoa(binary);
        } catch (err) {
            return json({ error: `URL fetch failed: ${err.message}` }, 400);
        }
    }

    // The content upload endpoint takes a recordId — table inference happens
    // server-side at Airtable based on which table contains the recordId.
    // So one URL works for both Companies (Consulting Clients) and Deals
    // (Consulting Deals) as long as `id` matches the right table.
    const url = `https://content.airtable.com/v0/${baseId}/${id}/${encodeURIComponent(field)}/uploadAttachment`;

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type':  'application/json',
        },
        body: JSON.stringify({
            contentType: inferredType || 'application/octet-stream',
            file:        fileB64,
            filename,
        }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('Airtable upload failed:', res.status, JSON.stringify(err));
        return json({ error: err.error?.message || err.error || 'Failed to upload', status: res.status }, 500);
    }

    const data = await res.json();
    // Airtable returns the full updated record including all attachments in the field
    const attachments = data.fields?.[field] || [];
    return json({ success: true, attachments });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
    });
}
