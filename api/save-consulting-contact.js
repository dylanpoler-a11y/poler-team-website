/**
 * /api/save-consulting-contact.js — Vercel Edge Function
 * Create a contact for a Company.
 *
 * Body: { password, companyId, name, role?, email?, phone?, primary?, language?, notes? }
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';

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
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const apiKey  = process.env.AIRTABLE_API_KEY;
    const baseId  = process.env.AIRTABLE_BASE_ID;
    const crmPass = process.env.CRM_PASSWORD;

    let body;
    try { body = await req.json(); }
    catch { return json({ error: 'Invalid request body' }, 400); }

    const { password } = body;
    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);

    const {
        companyId = '',
        name      = '',
        role      = '',
        email     = '',
        phone     = '',
        primary   = false,
        language  = '',
        notes     = '',
    } = body;

    if (!companyId || !name.trim()) {
        return json({ error: 'companyId and name are required' }, 400);
    }

    // ── DEDUP GUARD (added 2026-05-19) ────────────────────────────────────
    // Before inserting, check whether an existing contact under the same
    // company already matches by (a) email (case-insensitive exact) or
    // (b) normalized name. Avoids the contact-duplication mess where
    // auto-add paths and manual seeds created 3× Mitch / Marcel / Ariel /
    // Maikel / Aldo / Magdalena rows on the same companies.
    // Trace: 2026-05-19 dedup cleanup — 18 duplicate contacts removed.
    const normalizeName = (s) => (s || '').toLowerCase().normalize('NFD')
        .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
    const targetName  = normalizeName(name);
    const targetEmail = (email || '').toLowerCase().trim();

    try {
        const filter = `FIND('${companyId}', ARRAYJOIN({Company}))`;
        const dupRes = await fetch(
            `https://api.airtable.com/v0/${baseId}/Consulting%20Contacts?filterByFormula=${encodeURIComponent(filter)}&maxRecords=100`,
            { headers: { 'Authorization': `Bearer ${apiKey}` } },
        );
        if (dupRes.ok) {
            const dupData = await dupRes.json();
            for (const rec of (dupData.records || [])) {
                const existingEmail = (rec.fields?.Email || '').toLowerCase().trim();
                const existingName  = normalizeName(rec.fields?.Name);
                const emailMatch = targetEmail && existingEmail && existingEmail === targetEmail;
                const nameMatch  = !targetEmail && targetName && existingName && existingName === targetName;
                if (emailMatch || nameMatch) {
                    return json({
                        success: true,
                        id: rec.id,
                        deduped: true,
                        matchedBy: emailMatch ? 'email' : 'name',
                    });
                }
            }
        }
    } catch (err) {
        // If the dedup lookup fails, fall through to the original create.
        // Better to risk a duplicate than to silently lose a real contact.
        console.warn('[save-consulting-contact] dedup lookup failed:', err.message);
    }

    const fields = { 'Name': name.trim(), 'Company': [companyId] };
    if (role)     fields['Role']    = role;
    if (email)    fields['Email']   = email;
    if (phone)    fields['Phone']   = phone;
    if (primary)  fields['Primary'] = true;
    if (language) fields['Language'] = language;
    if (notes)    fields['Notes']   = notes;

    const res = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Contacts`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type':  'application/json',
        },
        body: JSON.stringify({ records: [{ fields }], typecast: true }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Failed to create contact' }, 500);
    }

    const data = await res.json();
    return json({ success: true, id: data.records?.[0]?.id });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
