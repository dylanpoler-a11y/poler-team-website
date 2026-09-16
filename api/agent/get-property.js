/**
 * /api/agent/get-property.js — Full Bridge MLS details for one listing.
 * Body: { mlsId } or query ?mlsId=
 */

export const config = { runtime: 'edge' };

import { authorize } from '../_auth.js';
import { fetchListingByMls } from '../../lib/bridge-listing.js';

// Field list lives in lib/bridge-listing.js (FULL_FIELDS) — shared with derive-profile.

export default async function handler(req) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors() });
    if (!['GET','POST'].includes(req.method)) return json({ error: 'Method not allowed' }, 405);

    let mlsId;
    if (req.method === 'GET') {
        mlsId = new URL(req.url).searchParams.get('mlsId');
        if (!authorize(req, null).ok) return json({ error: 'Unauthorized' }, 401);
    } else {
        let body;
        try { body = await req.json(); } catch { return json({ error: 'Bad body' }, 400); }
        if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);
        mlsId = body.mlsId;
    }
    if (!mlsId) return json({ error: 'mlsId required' }, 400);

    if (!/^[A-Za-z0-9_-]{4,20}$/.test(String(mlsId))) return json({ error: 'Invalid mlsId' }, 400);
    let listing;
    try { listing = await fetchListingByMls(process.env.BRIDGE_API_TOKEN, mlsId); }
    catch (e) { return json({ error: 'Bridge fetch failed', detail: e.message }, 502); }
    if (!listing) return json({ error: 'Listing not found' }, 404);

    return json({ listing });
}

function cors() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
}
function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
