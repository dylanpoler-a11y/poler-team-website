/**
 * /api/flash-config.js — Vercel Edge Function
 * Hands the CRM the Flash live-coach embed settings (base URL + scoped embed token)
 * so the lead panel can build the iframe src. Gated by the CRM password/token so the
 * embed token never sits in the publicly-served crm.js.
 *
 * Required Vercel env vars:
 *   FLASH_BASE_URL     e.g. https://flash-coach-poler.netlify.app
 *   FLASH_EMBED_TOKEN  scoped secret, must match Flash's Netlify env
 *   CRM_PASSWORD / AGENT_API_TOKEN  (for authorize)
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';

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
    if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

    if (!authorize(req, null).ok) return json({ error: 'Unauthorized' }, 401);

    const flashBaseUrl = (process.env.FLASH_BASE_URL || 'https://flash-coach-poler.netlify.app').replace(/\/$/, '');
    const embedToken = process.env.FLASH_EMBED_TOKEN || '';
    if (!embedToken) return json({ error: 'flash_not_configured' }, 503);

    return json({ flashBaseUrl, embedToken });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
