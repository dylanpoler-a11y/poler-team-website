/**
 * lib/alert-profile-fields.js — the ONE place that turns an update-alerts style
 * `profile` request into Airtable Leads fields (flat columns + the Alert Profiles
 * wrapper). Extracted from api/agent/update-alerts.js on 2026-09-16 so
 * api/agent/derive-profile.js writes through exactly the same folding rules — the
 * 2026-08-10 lesson: a writer that updates the flat columns but not the wrapper is a
 * silent no-op for every wrapper lead.
 *
 * Extra keys since 2026-09-16:
 *   autoMeta: { auto, autoBasis, autoSources, autoConfirmed, autoUpdatedAt, autoBackfill, autoAskedAt }
 *             merged into profile #1 (synthesized from the flat fields when the lead
 *             has no wrapper yet) — marks a profile the site built from browsing.
 *   autoProfileConfirm: true → profile #1 gets { auto:false, autoConfirmed:true,
 *             autoConfirmedAt } (the lead said "yes, these are what I want", or gave
 *             their own criteria). Only when a profile exists.
 *   criteria without autoMeta → profile #1 loses `auto:true` (setBy:'human'), which is
 *             what makes the lead a Meta QualifiedLead (lib/qualified-lead.js).
 */

import { parseAlertProfiles, serializeAlertProfiles } from './alert-search.js';

/**
 * @param {object} profile   request body `profile`
 * @param {object} curFields the lead's CURRENT Airtable fields (needed whenever the
 *                           wrapper is touched; pass {} when the caller knows it isn't)
 * @returns {object} Airtable fields to PATCH (may be empty)
 */
export function computeAlertFields(profile = {}, curFields = {}) {
    const fields = {};
    if (profile.active !== undefined) fields['Alert Active'] = !!profile.active;
    // Comma+space, NEVER newline (Kevin 2026-07-16): newline-joined values render as one
    // glued word in the CRM panel's single-line input ("Boca RatonFort Lauderdale") and the
    // email engine's comma-only split treated the whole thing as ONE unmatchable city.
    if (Array.isArray(profile.cities)) fields['Alert Cities'] = profile.cities.map(c => String(c).trim()).filter(Boolean).join(', ');
    if (profile.priceMin !== undefined) fields['Alert Price Min'] = Number(profile.priceMin) || 0;
    if (profile.priceMax !== undefined) fields['Alert Price Max'] = Number(profile.priceMax) || 0;
    if (profile.bedsMin !== undefined) fields['Alert Beds Min'] = Number(profile.bedsMin) || 0;
    if (profile.bathsMin !== undefined) fields['Alert Baths Min'] = Number(profile.bathsMin) || 0;
    if (Array.isArray(profile.propertyTypes)) fields['Alert Property Types'] = profile.propertyTypes;
    if (profile.frequency !== undefined) fields['Alert Frequency'] = profile.frequency;
    if (profile.count !== undefined) fields['Alert Count'] = Number(profile.count) || 5;

    const wantsProfiles = Array.isArray(profile.profiles);
    const wantsChannels = profile.channels && typeof profile.channels === 'object';
    // Flat features can only live inside the wrapper (no flat Airtable column) — fold
    // them into profile #1. When the caller sends profiles[] too, those win untouched.
    const wantsFeatures = !wantsProfiles && Array.isArray(profile.features);
    // Flat CRITERIA must ALSO fold into profile #1 when the lead already has a wrapper:
    // profilesFromLead() prefers profiles[] and ignores the flat columns entirely.
    const wantsFlatCriteria = !wantsProfiles && (
        profile.priceMin !== undefined || profile.priceMax !== undefined ||
        profile.bedsMin  !== undefined || profile.bathsMin !== undefined ||
        Array.isArray(profile.cities)  || Array.isArray(profile.propertyTypes)
    );
    const wantsAutoMeta = !wantsProfiles && profile.autoMeta && typeof profile.autoMeta === 'object';
    const wantsAutoConfirm = !wantsProfiles && profile.autoProfileConfirm === true;

    if (wantsProfiles || wantsChannels || wantsFeatures || wantsFlatCriteria || wantsAutoMeta || wantsAutoConfirm) {
        const parsed = parseAlertProfiles(curFields['Alert Profiles'] || '');
        let nextProfiles = wantsProfiles
            ? profile.profiles.slice(0, 5).filter(p => p && typeof p === 'object')
            : parsed.profiles;

        // A flat-only lead (no wrapper yet) that receives features or auto metadata needs
        // profile #1 synthesized from the flat fields (request values first, stored as
        // fallback) so the extra keys have somewhere to live.
        const synthesize = () => ([{
            types:    Array.isArray(profile.propertyTypes) ? profile.propertyTypes : (curFields['Alert Property Types'] || []),
            cities:   fields['Alert Cities'] !== undefined ? fields['Alert Cities'] : (curFields['Alert Cities'] || ''),
            priceMin: profile.priceMin !== undefined ? (Number(profile.priceMin) || 0) : (curFields['Alert Price Min'] || 0),
            priceMax: profile.priceMax !== undefined ? (Number(profile.priceMax) || 0) : (curFields['Alert Price Max'] || 0),
            bedsMin:  profile.bedsMin  !== undefined ? (Number(profile.bedsMin)  || 0) : (curFields['Alert Beds Min']  || 0),
            bathsMin: profile.bathsMin !== undefined ? (Number(profile.bathsMin) || 0) : (curFields['Alert Baths Min'] || 0),
        }]);

        if (wantsFlatCriteria && nextProfiles.length > 0) {
            const patch = {};
            if (Array.isArray(profile.propertyTypes)) patch.types = fields['Alert Property Types'];
            if (Array.isArray(profile.cities))        patch.cities = fields['Alert Cities'];
            if (profile.priceMin !== undefined)       patch.priceMin = fields['Alert Price Min'];
            if (profile.priceMax !== undefined)       patch.priceMax = fields['Alert Price Max'];
            if (profile.bedsMin  !== undefined)       patch.bedsMin  = fields['Alert Beds Min'];
            if (profile.bathsMin !== undefined)       patch.bathsMin = fields['Alert Baths Min'];
            nextProfiles = nextProfiles.map((p, i) => (i === 0 ? { ...p, ...patch } : p));
        }
        if (wantsFeatures) {
            const feats = profile.features.map(f => String(f).trim()).filter(Boolean).slice(0, 15);
            if (nextProfiles.length === 0) nextProfiles = synthesize();
            nextProfiles = nextProfiles.map((p, i) => (i === 0 ? { ...p, features: feats } : p));
        }
        if (wantsAutoMeta) {
            const meta = {};
            for (const k of ['auto', 'autoBasis', 'autoSources', 'autoConfirmed', 'autoUpdatedAt', 'autoBackfill', 'autoAskedAt']) {
                if (profile.autoMeta[k] !== undefined) meta[k] = profile.autoMeta[k];
            }
            if (nextProfiles.length === 0) nextProfiles = synthesize();
            nextProfiles = nextProfiles.map((p, i) => (i === 0 ? { ...p, ...meta } : p));
        }
        // 2026-09-16: criteria written WITHOUT autoMeta come from a person (Kevin/Rosa in
        // the CRM, Claude via the MCP) or from the lead's own words (Claudia's buy-box
        // capture) — clear the site-derived flag so lib/qualified-lead.js counts it.
        if ((wantsFlatCriteria || wantsProfiles) && !wantsAutoMeta && nextProfiles.length > 0) {
            nextProfiles = nextProfiles.map((p, i) => (i === 0 && p.auto === true ? { ...p, auto: false, setBy: 'human' } : p));
        }
        if (wantsAutoConfirm && nextProfiles.length > 0) {
            nextProfiles = nextProfiles.map((p, i) => (i === 0
                ? { ...p, auto: false, autoConfirmed: true, autoConfirmedAt: new Date().toISOString() }
                : p));
        }
        const nextChannels = wantsChannels
            ? { email: profile.channels.email !== false, whatsapp: !!profile.channels.whatsapp }
            : parsed.channels;
        // Only touch the wrapper when there's something real to store. wantsProfiles with
        // [] stays an explicit clear-back-to-flat.
        if (wantsProfiles || wantsChannels || nextProfiles.length > 0) {
            fields['Alert Profiles'] = serializeAlertProfiles(nextProfiles, nextChannels);
        }
    }
    return fields;
}

/** Does this request need the lead's current record before computing fields? */
export function needsCurrentRecord(profile = {}) {
    return Array.isArray(profile.profiles) || (profile.channels && typeof profile.channels === 'object')
        || Array.isArray(profile.features) || profile.autoProfileConfirm === true
        || (profile.autoMeta && typeof profile.autoMeta === 'object')
        || profile.priceMin !== undefined || profile.priceMax !== undefined
        || profile.bedsMin !== undefined || profile.bathsMin !== undefined
        || Array.isArray(profile.cities) || Array.isArray(profile.propertyTypes);
}
