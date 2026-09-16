/**
 * lib/lead-quality.js — the one rule for "does this signup count as a Meta Lead".
 *
 * Meta's adset optimizes on the `Lead` event, so whatever fires it is what Meta
 * buys more of. Since 2026-09-12 a junk phone never fires it (lib/phone-quality.js).
 *
 * Timeline history:
 *   2026-09-16 AM  — "12+ months" stopped firing Lead (20 of 31 recent signups picked it,
 *                    all browsers).
 *   2026-09-16 PM  — REVERTED (Kevin): Lead = valid phone, any timeline. Two reasons:
 *                    (1) the 12+ cut dropped Lead volume from ~45/wk to ~15/wk at $15/day,
 *                    which keeps the adset learning-limited forever; (2) foreign buyers on a
 *                    $3M+ house naturally say 12+ (Jean Trevejo, $3M-$4M NMB, picked 12+ and
 *                    is Hot). Quality now reaches Meta through the CAPI `QualifiedLead`
 *                    event instead (lib/qualified-lead.js: confirmed/human-set alert
 *                    profile, or Warm/Hot status) — switch the adset to optimize on it once
 *                    it reaches ~30/month.
 *
 * Only an explicit "Just exploring" (nav.js dropdown) stays non-qualifying — that is the
 * visitor telling us they are not a buyer. Blank counts (the listing gate requires a pill,
 * so blank only happens on legacy/alternate forms).
 *
 * Airtable "Timeline" values are exactly the strings below (listing.html pills,
 * nav.js dropdown, crm.html Add Contact).
 */

export const NEAR_TERM_TIMELINES = new Set(['0-3 months', '3-6 months', '6-12 months']);
const NON_BUYER_TIMELINES = new Set(['just exploring', 'solo explorando', 'só explorando']);

/** Did the buyer say ≤ 12 months? Used for notes/contradiction wording, NOT for the Lead gate. */
export function timelineIsNearTerm(timeline) {
    return NEAR_TERM_TIMELINES.has(String(timeline || '').trim());
}

/** Lead-gate timeline rule: everything qualifies except an explicit "Just exploring". */
export function timelineQualifies(timeline) {
    return !NON_BUYER_TIMELINES.has(String(timeline || '').trim().toLowerCase());
}

/**
 * @param {{ phoneQuality: { ok: boolean } | null | undefined, timeline: string }} p
 * @returns {boolean} true when the phone is real and the visitor didn't say "Just exploring"
 */
export function leadQualifies({ phoneQuality, timeline }) {
    return Boolean(phoneQuality && phoneQuality.ok && timelineQualifies(timeline));
}
