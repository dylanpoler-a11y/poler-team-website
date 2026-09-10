/**
 * lib/note-stamp.js — the ONE stamp every CRM note carries, no matter who writes it.
 *
 *   [M/D/YYYY, h:MM AM — agent] note body
 *
 * Edge-safe (no Node imports) so save-lead.js and agent/log-note.js can share it.
 *
 * Root: 2026-09-10 — /api/save-lead wrote `notes` raw, so a lead created with a note
 * either carried a hand-rolled stamp ("[2026-09-10 17:36 ET]" — ISO date, no spacing,
 * Kevin: "we can't have this"), or none at all (7 buyer leads under Listings). The
 * stamp is now applied server-side; callers can't get it wrong.
 */

const ET = 'America/New_York';

// Canonical stamp: "[9/10/2026, 5:36 PM — Kevin]". Server runs UTC — always ET.
export function noteStamp(agent, when = new Date()) {
    const dateStr = when.toLocaleString('en-US', {
        month: 'numeric', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
        timeZone: ET,
    });
    return `[${dateStr} — ${String(agent || 'Manual entry').trim()}]`;
}

// Already in the canonical shape? ("[M/D/YYYY, h:MM AM — who]")
const CANONICAL = /^\[\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2} [AP]M — [^\]]+\]/;
// A foreign leading stamp a caller rolled by hand: "[2026-09-10 17:36 ET]",
// "[2026-09-10T22:36:40Z]", "[FOLLOWUP — 2026-07-01]", "[9/10/2026]"… anything
// bracketed at the very start that is NOT canonical and contains a real DATE shape
// (ISO or M/D/Y). "[Unit 1204]", "[33160]", "[Folio 30-2204-001-1204]" survive — a
// bare 4-digit run is not a date (code-reviewer 2026-09-10).
const FOREIGN = /^\[[^\]\n]{0,30}(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4})[^\]\n]{0,30}\]\s*/;

/**
 * Normalize a note body for storage: strip a foreign leading stamp, then prepend
 * the canonical one unless the body already starts with it.
 */
export function stampNote(body, agent, when = new Date()) {
    let text = String(body || '').trim();
    if (!text) return '';
    if (CANONICAL.test(text)) return text;
    text = text.replace(FOREIGN, '').trim();
    return `${noteStamp(agent, when)} ${text}`;
}
