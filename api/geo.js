/**
 * /api/geo.js — Vercel Edge Function, PUBLIC, no data stored. Returns the
 * visitor's ISO country from Vercel's edge geo header so the lead gate can
 * default the phone country-code dropdown (2026-09-12). The +1 default was
 * catching LatAm ad traffic: only 31% of leads tagged "United States" since
 * the 8/25 relaunch had a real number, and 1 in 5 of the bad ones was a real
 * CO/PE/AR mobile typed under +1. Never cached (per-visitor).
 */
export const config = { runtime: 'edge' };

export default async function handler(req) {
    const country = (req.headers.get('x-vercel-ip-country') || (req.geo && req.geo.country) || '').toUpperCase();
    return new Response(JSON.stringify({ country: /^[A-Z]{2}$/.test(country) ? country : '' }), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, private',
        },
    });
}
