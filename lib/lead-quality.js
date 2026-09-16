/**
 * lib/lead-quality.js — the one rule for "does this signup count as a Meta Lead".
 *
 * Meta's adset optimizes on the `Lead` event, so whatever fires it is what Meta
 * buys more of. Since 2026-09-12 a junk phone never fires it (lib/phone-quality.js).
 * Since 2026-09-16 (Kevin: "I'm fine with the trade-off") a "12+ months" timeline
 * doesn't either: 20 of the last 31 leads picked it and every one was a browser.
 * Those signups are still saved to the CRM and still get the welcome + team
 * emails; they just stop teaching Meta. They land under the custom `RawSubmit`
 * event instead.
 *
 * Airtable "Timeline" values are exactly the strings below (listing.html pills,
 * nav.js dropdown, crm.html Add Contact). nav.js also offers "Just exploring",
 * which is non-qualifying like a blank.
 */

export const QUALIFYING_TIMELINES = new Set(['0-3 months', '3-6 months', '6-12 months']);

export function timelineQualifies(timeline) {
    return QUALIFYING_TIMELINES.has(String(timeline || '').trim());
}

/**
 * @param {{ phoneQuality: { ok: boolean } | null | undefined, timeline: string }} p
 * @returns {boolean} true when both the phone is real and the buyer says ≤ 12 months
 */
export function leadQualifies({ phoneQuality, timeline }) {
    return Boolean(phoneQuality && phoneQuality.ok && timelineQualifies(timeline));
}
