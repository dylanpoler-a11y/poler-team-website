/**
 * lib/qualified-lead.js — the one rule for "does this lead count as a Meta QualifiedLead".
 *
 * Kevin 2026-09-16: quality reaches Meta through the CAPI `QualifiedLead` event, not by
 * narrowing `Lead`. The adset switches to optimize on QualifiedLead once it reaches
 * ~30/month. A lead qualifies when:
 *   - its alert profile is CONFIRMED or HUMAN-SET: the lead confirmed Claudia's derived
 *     profile / gave their own criteria on WhatsApp, set alerts on /preferences, or
 *     Kevin/Rosa/Claude set them in the CRM or via the MCP. A profile the site derived
 *     from browsing (profile #1 `auto:true` and not `autoConfirmed`) does NOT count —
 *     since 2026-09-16 every signup gets one, so it would make QualifiedLead == Lead.
 *   - or its Status advances to Warm/Hot (api/update-lead.js, unchanged behaviour).
 *
 * ONCE PER LEAD: Meta only dedups by event_id inside 48h, so the fire is persisted as
 * `capiQualifiedAt` on alert profile #1 (no spare Airtable column and the API key has no
 * schema scope). update-lead reads the same marker so alerts-then-Hot fires once.
 *
 * Pure functions here (testable); the Airtable + CAPI side effects live in
 * `fireQualifiedLeadOnce` and never throw.
 */

import { parseAlertProfiles, serializeAlertProfiles } from './alert-search.js';
import { sendCapiEvent } from '../api/_capi.js';

function firstProfile(fields = {}) {
    return parseAlertProfiles(fields['Alert Profiles'] || '').profiles[0] || null;
}

function hasCriteria(fields = {}, p = null) {
    const cities = String((p && p.cities) || fields['Alert Cities'] || '').trim();
    const priceMax = Number((p && p.priceMax) || fields['Alert Price Max'] || 0);
    return Boolean(cities) || priceMax > 0;
}

/** @returns {boolean} profile #1 was derived from browsing and never confirmed */
export function isUnconfirmedAutoProfile(p) {
    return Boolean(p && p.auto === true && !p.autoConfirmed);
}

/**
 * Does this (merged: current + about-to-be-written) field set describe a qualified lead?
 * @param {object} fields Airtable Leads fields
 */
export function profileQualifies(fields = {}) {
    if (fields['Alert Active'] === false) return false;
    const p = firstProfile(fields);
    if (isUnconfirmedAutoProfile(p)) return false;
    return hasCriteria(fields, p);
}

/** Already fired for this lead? */
export function alreadyQualified(fields = {}) {
    const p = firstProfile(fields);
    return Boolean(p && p.capiQualifiedAt);
}

/**
 * Return the 'Alert Profiles' string with profile #1 stamped `capiQualifiedAt`, or null
 * when there is no profile to stamp (flat-only lead — the marker has nowhere to live).
 */
export function stampQualified(fields = {}, at = new Date().toISOString()) {
    const parsed = parseAlertProfiles(fields['Alert Profiles'] || '');
    if (!parsed.profiles.length) return null;
    const next = parsed.profiles.map((p, i) => (i === 0 ? { ...p, capiQualifiedAt: at } : p));
    return serializeAlertProfiles(next, parsed.channels);
}

/**
 * A human or the lead wrote criteria: clear the site-derived flag on profile #1 so the
 * profile counts as set. `autoConfirmed` is left to the explicit confirm path.
 */
export function markHumanSet(profilesRaw) {
    const parsed = parseAlertProfiles(profilesRaw || '');
    if (!parsed.profiles.length) return profilesRaw || '';
    const next = parsed.profiles.map((p, i) => (i === 0 && p.auto === true ? { ...p, auto: false, setBy: 'human' } : p));
    return serializeAlertProfiles(next, parsed.channels);
}

/**
 * Fire QualifiedLead once for a lead, then persist the marker. Call AFTER the caller's
 * own Airtable write succeeded, with the merged fields (current + written). Never throws.
 *
 * @param {object} o
 * @param {string} o.apiKey    Airtable key
 * @param {string} o.baseId    Airtable base
 * @param {string} o.leadId    rec…
 * @param {object} o.fields    merged Leads fields after the write
 * @param {string} o.reason    'alerts_set' | 'status_warm' | 'status_hot' | …
 * @param {Request} [o.req]    incoming request (ip/ua/cookies for match quality)
 * @param {boolean} [o.force]  skip profileQualifies() (status path decides on its own)
 * @returns {Promise<{fired:boolean, reason:string}>}
 */
export async function fireQualifiedLeadOnce({ apiKey, baseId, leadId, fields = {}, reason = 'alerts_set', req, force = false } = {}) {
    try {
        if (!leadId) return { fired: false, reason: 'no_lead' };
        if (alreadyQualified(fields)) return { fired: false, reason: 'already_fired' };
        if (!force && !profileQualifies(fields)) return { fired: false, reason: 'not_qualified' };

        const at = new Date().toISOString();
        const stamped = stampQualified(fields, at);
        // Persist the marker FIRST so two concurrent writers can't both fire.
        if (stamped !== null && apiKey && baseId) {
            const r = await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ records: [{ id: leadId, fields: { 'Alert Profiles': stamped } }], typecast: true }),
            }).catch(() => null);
            if (!r || !r.ok) return { fired: false, reason: 'marker_write_failed' };
        }

        const sent = await sendCapiEvent({
            eventName: 'QualifiedLead',
            eventId: `ql_${leadId}`,
            userData: {
                email:      fields['Email'],
                phone:      fields['Phone'],
                firstName:  fields['First Name'],
                lastName:   fields['Last Name'],
                country:    fields['Country'],
                externalId: leadId,
            },
            customData: { content_category: 'Real Estate', qualified_reason: reason },
            req,
        }).catch(() => ({ sent: false, reason: 'threw' }));
        console.log(`[qualified-lead] ${leadId} reason=${reason} marker=${stamped !== null ? 'stamped' : 'none'} capi=${sent && sent.sent ? 'sent' : (sent && sent.reason) || 'not_sent'}`);
        return { fired: Boolean(sent && sent.sent), reason: (sent && sent.reason) || 'sent' };
    } catch (e) {
        console.error('[qualified-lead] failed:', e && e.message);
        return { fired: false, reason: 'error' };
    }
}
