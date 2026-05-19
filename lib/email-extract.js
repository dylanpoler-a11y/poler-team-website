/**
 * lib/email-extract.js — Anthropic API call for email summarization.
 *
 * Takes one inbound email + the CRM context for the matched record, returns
 * strict JSON. Model: Sonnet (Kevin's standing instruction — Sonnet or Opus only,
 * never Haiku, even when the task is "cheap summarization" — quality of extraction
 * matters because we also derive reminders/commitments from these emails).
 *
 * Docs: https://docs.anthropic.com/en/api/messages
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

/**
 * @param {object} args
 * @param {string} args.fromEmail
 * @param {string} args.fromName
 * @param {string} args.subject
 * @param {string} args.plainTextBody
 * @param {object} args.crmContext
 *   { recordType: 'lead' | 'consulting-contact',
 *     recordId: string,
 *     recordName: string,
 *     currentStatus?: string,
 *     companyName?: string }
 * @param {Array<{filename: string, mimeType: string}>} [args.attachments]
 *   List of attachments on this email; the model classifies each into a CRM bucket.
 *
 * @returns {{ summary, noteText, suggestedStatusChange?, suggestedNextAction?,
 *             confidence, attachmentClassifications? }}
 *   attachmentClassifications: [{ filename, category: 'Contracts' | 'Deliverables' |
 *                                  'Spreadsheets' | 'Misc' }]
 */
export async function extractEmailUpdate({ fromEmail, fromName, subject, plainTextBody, crmContext, attachments = [], otherMatchedRecords = [] }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const systemPrompt = buildSystemPrompt(crmContext, attachments, otherMatchedRecords);
    const userMessage = buildUserMessage({ fromEmail, fromName, subject, plainTextBody, attachments });

    // Two-attempt budget: 8000 → 12000. Bumped 2026-05-19 (was 2000 → 8000):
    // multi-client team threads were truncating the JSON, parseJsonLoose
    // threw, and the cron flipped to CRM_NEEDS_REVIEW. Skill §5.1 makes
    // team-discussion always-on, so the prompt now reliably emits multiple
    // clientReferences blocks — higher floor avoids the truncation class.
    const attempts = [3000, 12000];
    let lastErr;
    let lastResponseText = '';
    for (let i = 0; i < attempts.length; i++) {
        const max_tokens = attempts[i];
        const res = await fetch(ANTHROPIC_API, {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: MODEL,
                max_tokens,
                system: systemPrompt,
                messages: [{ role: 'user', content: userMessage }],
            }),
        });
        if (!res.ok) {
            lastErr = new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 500)}`);
            console.error(`[extractEmailUpdate] attempt ${i + 1}/${attempts.length} HTTP ${res.status}`);
            continue;
        }
        const data = await res.json();
        lastResponseText = data.content?.[0]?.text || '';
        try {
            return parseStrictJson(lastResponseText);
        } catch (err) {
            lastErr = err;
            // Log up to 2000 chars of the failing response so truncation
            // failures are debuggable without re-running the cron.
            const preview = lastResponseText.length > 2000
                ? `${lastResponseText.slice(0, 2000)}\n…[truncated ${lastResponseText.length - 2000} more chars]`
                : lastResponseText;
            console.error(`[extractEmailUpdate] attempt ${i + 1}/${attempts.length} parse failed (max_tokens=${max_tokens}, subject="${(subject || '').slice(0, 80)}"). stop_reason=${data.stop_reason}, response_length=${lastResponseText.length}\n--- response preview ---\n${preview}\n--- end preview ---`);
            // Continue to retry with higher budget
        }
    }
    console.error(`[extractEmailUpdate] ALL ATTEMPTS FAILED. Full last response (length=${lastResponseText.length}):\n${lastResponseText}`);
    throw lastErr || new Error('extractEmailUpdate exhausted attempts');
}

function buildSystemPrompt(ctx, attachments = [], otherMatchedRecords = []) {
    const recordType = ctx.recordType === 'lead' ? 'real estate buyer/seller lead' : 'consulting business contact';
    const statusLine = ctx.currentStatus ? `Current CRM status: "${ctx.currentStatus}".` : '';
    const companyLine = ctx.companyName ? `Their company: "${ctx.companyName}".` : '';
    const otherRecordsLine = otherMatchedRecords.length > 0
        ? `\n\nAlso on this email (their records will receive the same note independently — do NOT cross-summarize, just produce ONE note):\n${otherMatchedRecords.map(r => `- ${r.recordName}${r.companyName ? ` (${r.companyName})` : ''} — role: ${r.role || 'recipient'}`).join('\n')}`
        : '';

    const attachmentBlock = attachments.length > 0
        ? `

This email has ${attachments.length} attachment(s). You MUST also classify each one into ONE of these buckets so we file it in the right CRM field:
- "Contracts" — signed/unsigned agreements, contracts, NDAs, LOIs, MSAs, SOWs, engagement letters, addenda, offers
- "Deliverables" — finished work product: reports, decks, proposals, presentations, dashboards, marketing assets, plans, drafts being delivered
- "Spreadsheets" — any xlsx/xls/csv/numbers/ods/google-sheet file regardless of content, OR financial models / pricing sheets / pipelines / data exports
- "Misc" — anything that doesn't clearly fit the above (invoices, photos, scans, screenshots, miscellaneous PDFs)

Use the filename, file extension, AND email context to decide. When in doubt between Deliverables vs Misc, pick Misc.`
        : '';

    return `You are an automated assistant that reads inbound emails to The Poler Team and writes a single CRM note summarizing each one. You write in the voice of a senior agent making a concise file note for their own future reference — NOT a customer-facing reply.

Context about this contact:
- They are a ${recordType} in our CRM.
- Their name is "${ctx.recordName}".
${companyLine}
${statusLine}${otherRecordsLine}${attachmentBlock}

Today's date: ${new Date().toISOString().slice(0,10)} (use this to resolve relative dates like "next Tuesday" or "tomorrow").

Your job is to read ONE inbound email and output STRICT JSON only — no preamble, no markdown fences, no commentary. Schema:
{
  "summary": "1 sentence, under 140 chars, what the email is about",
  "noteText": "MUST be formatted as plain-text bullets. Each line starts with '• ' (or '- '). Cover the key points only — commitments, questions, dates, asks, attachments delivered. Then a blank line, then 'Next steps:' on its own line, then 1-3 bullets of suggested next actions for the team. Example:\\n\\n• Client confirms tour Tuesday 3pm\\n• Wants comparable units in Sunny Isles under $2M\\n• Attached pre-approval letter from BofA\\n\\nNext steps:\\n• Send 3-5 matching Sunny Isles condos by EOD\\n• Confirm tour address by Mon noon",
  "reminders": "array of {\\"title\\": short imperative phrase, \\"dueAt\\": ISO-8601 datetime, \\"actionType\\": 'Call'|'Email'|'Meeting'|'Tour'|'Follow Up'|'Other', \\"note\\": short context (optional)} — extract ONLY commitments/scheduled events with a clear date or time. If the email says 'let's zoom Tuesday at 3pm' → make a reminder. If it says 'I'll get back to you next week' → make a reminder for Friday EOD. If no concrete date is mentioned, return []. Be conservative: do NOT invent reminders. Use the recipient's local timezone (America/New_York). If only a date is given with no time, use 5:00 PM ET (end-of-business).",
  "suggestedStatusChange": "optional — if you detect a clear status hint (e.g. 'Hot', 'Won', 'Closed Lost'), put it here as a string. Otherwise omit. We will NOT auto-apply this in v1.",
  "attachmentClassifications": "array of {\\"filename\\": str, \\"category\\": one of 'Contracts'|'Deliverables'|'Spreadsheets'|'Misc'} — REQUIRED if attachments exist, omit otherwise",
  "links": "array of {\\"label\\": short description, \\"url\\": the URL} — extract every shareable link in the email body: Google Drive, Google Docs/Sheets/Slides, Dropbox, Notion, Figma, Loom, OneDrive, signed-contract links, calendar/Zoom invites, etc. Skip plain unsubscribe, marketing footer, and bare social-media profile links. Empty array if none. Use a short descriptive label like 'Deck', 'Work tracker', 'Research spreadsheet', 'Signed contract'. Mirror source language.",
  "confidence": "high | medium | low"
}

Rules:
- Output JSON only, parseable by JSON.parse.
- noteText MUST be bullets, NEVER a paragraph. Skip greetings/sign-offs.
- Always include the "Next steps:" section, even if just 1 bullet ("Acknowledge receipt", "No action needed", etc).
- **LANGUAGE — STRICT**: mirror the source email's language. If the email body is in Spanish, write noteText AND summary AND all reminder titles in Spanish. If English, write in English. NEVER produce bilingual or translated content. If the email mixes languages, use whichever dominates. Use "Next steps:" header in source language too ("Próximos pasos:" for Spanish).
- reminders MUST be conservative — only extract when there's a clear date or time commitment. Empty array is the right answer most of the time.
- All reminder dueAt values MUST be ISO-8601 with timezone offset (e.g. "2026-05-20T15:00:00-04:00"). Default to America/New_York if unspecified.
- Never include the literal email body — summarize.
- If the email is auto-generated (calendar invite, newsletter, bounce), set confidence "low" and use 1-2 bullets describing what arrived. Calendar invites WITH a date/time SHOULD produce a reminder.
- Never invent facts not in the email.
- If attachments exist, you MUST include attachmentClassifications and it MUST contain exactly one entry per attachment (matching filename verbatim).`;
}

function buildUserMessage({ fromEmail, fromName, subject, plainTextBody, attachments = [] }) {
    const attachmentLines = attachments.length > 0
        ? `Attachments (${attachments.length}):\n${attachments.map(a => `  - ${a.filename} (${a.mimeType})`).join('\n')}\n\n`
        : '';

    return `Inbound email to summarize:

From: ${fromName ? fromName + ' <' + fromEmail + '>' : fromEmail}
Subject: ${subject || '(no subject)'}

${attachmentLines}---
${plainTextBody || '(empty body)'}
---

Respond with strict JSON per the schema.`;
}

function parseStrictJson(text) {
    // Try direct parse first
    try { return validate(JSON.parse(text)); } catch { /* fall through */ }

    // Strip code fences if Anthropic returned them despite instructions
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
        try { return validate(JSON.parse(fenced[1])); } catch { /* fall through */ }
    }

    // Extract the first {...} block
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first >= 0 && last > first) {
        try { return validate(JSON.parse(text.slice(first, last + 1))); } catch { /* fall through */ }
    }

    throw new Error(`Could not parse JSON from model output: ${text.slice(0, 300)}`);
}

function validate(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('Not an object');
    if (typeof obj.summary !== 'string') obj.summary = '';
    if (typeof obj.noteText !== 'string') obj.noteText = obj.summary || '';
    if (!['high', 'medium', 'low'].includes(obj.confidence)) obj.confidence = 'medium';
    // Normalize attachment classifications if present
    if (Array.isArray(obj.attachmentClassifications)) {
        const allowed = new Set(['Contracts', 'Deliverables', 'Spreadsheets', 'Misc']);
        obj.attachmentClassifications = obj.attachmentClassifications
            .filter(a => a && typeof a.filename === 'string')
            .map(a => ({
                filename: a.filename,
                category: allowed.has(a.category) ? a.category : 'Misc',
            }));
    } else {
        delete obj.attachmentClassifications;
    }
    // Normalize links if present — extracted Google Docs / Dropbox / etc. URLs.
    if (Array.isArray(obj.links)) {
        obj.links = obj.links
            .filter(l => l && typeof l.url === 'string' && /^https?:\/\//i.test(l.url))
            .map(l => ({
                label: (typeof l.label === 'string' ? l.label.trim() : '').slice(0, 120),
                url: l.url.trim().slice(0, 1000),
            }));
    } else {
        obj.links = [];
    }
    // Normalize reminders if present
    if (Array.isArray(obj.reminders)) {
        const allowedActions = new Set(['Call', 'Email', 'Meeting', 'Tour', 'Follow Up', 'Other']);
        obj.reminders = obj.reminders
            .filter(r => r && typeof r.title === 'string' && typeof r.dueAt === 'string')
            .map(r => {
                const due = new Date(r.dueAt);
                return {
                    title: r.title.trim().slice(0, 200),
                    dueAt: isNaN(due.getTime()) ? '' : due.toISOString(),
                    actionType: allowedActions.has(r.actionType) ? r.actionType : 'Follow Up',
                    note: typeof r.note === 'string' ? r.note.trim().slice(0, 500) : '',
                };
            })
            .filter(r => r.dueAt); // drop reminders with unparseable dates
    } else {
        obj.reminders = [];
    }
    return obj;
}

/**
 * Fallback classifier — used if Anthropic call fails entirely but we still
 * want to upload attachments. Pure code, no API call.
 */
/**
 * Internal-team-discussion extraction.
 *
 * Used when the sender + recipients are all internal (@poler.org / Rosa /
 * Kevin) and the body mentions one or more known CRM clients. Sonnet pulls
 * out: which clients are mentioned, what tasks were assigned to whom, what
 * meetings are scheduled.
 *
 * @param {object} args
 * @param {string} args.fromName  — e.g. "Noel Poler"
 * @param {string} args.subject
 * @param {string} args.plainTextBody
 * @param {Array<{id, name}>} args.clientList — known CRM clients
 * @param {Array<string>} [args.teamMembers] — ["Kevin", "Noel", "Dylan", "Rosa"]
 * @returns {{ summary, clientReferences, tasksAssigned, meetingsScheduled,
 *             confidence }}
 */
export async function extractTeamDiscussion({ fromName, subject, plainTextBody, clientList, dealList = [], listings = [], teamMembers = ['Kevin', 'Noel', 'Dylan', 'Rosa'], excludeCompanyIds = [] }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const today = new Date().toISOString().slice(0, 10);
    const excludeSet = new Set(excludeCompanyIds);
    const clientLines = clientList.map(c => `- "${c.name}" (id: ${c.id})`).join('\n');
    const dealLines = dealList.length > 0
        ? `\n\nKnown Consulting Deals (projects under those clients — when an email talks about a project shorthand, return the parent companyId):\n` +
          dealList.map(d => `- "${d.name}" → companyId ${d.companyId} (${d.companyName})`).join('\n')
        : '';
    const listingLines = listings.length > 0
        ? `\n\nKnown Real Estate Listings (Rosa's MLS listings — when an email talks about one of these properties, use the listingMlsId field, NOT a companyId):\n` +
          listings.map(l => `- "${l.title}" → mlsId ${l.mlsId}`).join('\n')
        : '';
    const teamLine = teamMembers.join(', ');

    const systemPrompt = `You are an automated assistant reading an internal team email between members of The Poler Team (${teamLine}) and extracting structured CRM updates from it. The team mixes Spanish + English — handle both.

Today's date: ${today} (use to resolve relative dates like "mañana", "el martes", "next Tuesday").
Timezone for any dates: America/New_York. Output ISO-8601 with offset (e.g. 2026-05-20T15:00:00-04:00).

== KNOWN CLIENT ALIASES (apply BEFORE matching against the client list) ==

When the email body mentions any of these names/phrases, resolve to the
canonical companyId(s) shown — DO NOT rely on substring matching of the
client list for these. Verify the companyId you emit exists in the (A) list
below; if a referenced id is NOT in (A), skip that reference.

- "Mitch Rodriguez" (mi@brickelltravel.com) / "Maikel Rodriguez" / "Mike Rodriguez" / "Maikel" / "Mike" (mike@brickelltravel.com) / "Mitch & Maikel" / "Marcel Rotker" (mrotker@gmail.com) / "Marcel" (Royal SB board) / "Ariel Rodriguez" (mgmt@mr9holdings.com — Administrator at MR9) → MR9 Holdings (reckHRUqpAiRlw4Yl) AND Brickell Travel (recljWqJPnttwYkzp) — emit BOTH refs
- "Royal" / "Royal South Beach" / "Royal SB" / "Dream Inn" → MR9 Holdings + Brickell Travel (same client group)
- "AD1" / "AD1 Global" / "AD1 Hospitality" / "Alex Fridzon" (alex.fridzon@ad1hospitality.com) / "Gisela" / "Gisela Levy" (gisela.levy@ad1growth.com) / @ad1hospitality.com / @ad1growth.com → AD1 Global (recoUF9Pc03xFTuSO)
  AD1 ACTIVE DEALS (use newDealCandidates if Sonnet sees a deal not in dealList; emit dealReferences if deal exists):
  - "AD1 Hotel Acquisition Search" / "AD1 hotel hunt" / "AD1 hotel acquisition" / "find hotels for AD1" / "$1K a week" / "weekly retainer" — Active engagement starting May 2026, $1K/week × 3 months retainer for AD1 hotel-acquisition deal sourcing. Sonnet: if you see this engagement mentioned and there's no matching deal in dealList yet, emit a newDealCandidates entry with companyId=recoUF9Pc03xFTuSO and a clear deal name.
- "Tru" / "Century Hospitality" / "Jeremy Frisby" → Century Hospitality Group (recjzUZqbQuL0gXpW)
- "Toyosa" / "Intermex" / "Edwin Saavedra" → Intermex / Toyosa (recuoeCu9myrS1HTV)
- "Terrado" / "Juan Carlos Toledo" → Terrado Hoteles (recazYfRm47MQhpcC)
- "DoubleTree Santiago" / "Santiago DoubleTree" / "Magdalena Cordero" (Magdalena.cordero@hilton.com) / "Magdalena" (when context is Hilton/Santiago) → DoubleTree by Hilton Santiago (recicaDDTwGm0U34I)
- "Conduit" / "Cole" / "Punn" → Conduit (recLxOvlONXNuGFsb) — BUT see §(D) rule below: Conduit alone is a tool, only attribute when also tied to an underlying client/listing
- "Solution Malls" / "Ariel Cogote" → Solution Malls (rec6l2wmioPIEkSoi)
- "Ten Series" / "Pedro Buvinic" → Ten Series (recMPNWLmegpss0WO)
- "Grupo Giordano" / "Giordano" / "Aldo Giordano" (aldogiordano.c@gmail.com) / "José Miguel Giordano" / "Jose Miguel Giordano" (josemgiordano@me.com) / "Carnes Sudamericana" → Grupo Giordano (recQMjwYpsc2tiuQU)
- "Captiva" / "David Dmor" (David.Dmor@gmail.com) → Captiva (recFRvQIkNGzC0RYK)

# === DEVELOPMENT PROJECTS (not consulting clients — Kevin's own real-estate dev) ===
- "Belle Meade Investments" / "Belle Meade" / "7601 NE 9th Ave" / "7601 NE" / "Belle Meade Blvd" / "Ed Saias" (edsaias1@gmail.com) / "Eduardo Saias" / "Andres Hausmann" (andreshaus@gmail.com) / "Leon Levy" (leonlevyc@gmail.com) / "Anidjar" (anidjar9770@gmail.com) / "Mauricio Bubis" (mbubis@gmail.com) / "Bubis" / "Abi Toledano" (toledanoabi1@icloud.com) → Development Project: Belle Meade Investments LLC (recsTQKav0lZCrsXt)
  When matched: emit as projectReferences (NOT clientReferences). Writer routes to the Project record.
- "Contempora" / "Save" / "Gonzalo Martino" / "Gonzalo Martino González" / "MPG office" / "Margarita Pirola" (mpirola@invermpg.cl) / "Pablo Pastorino" (ppastorino@invermpg.cl) / @invermpg.cl / "Pirola" → Contempora / Save (recUcvgndm9SCC2gd)

== ENTITY HIERARCHY ==

The Poler Team has THREE kinds of records emails might reference:

(A) Consulting Clients — companies we provide services to:
${clientLines}

(B) Consulting Deals — specific projects under those clients. Always belong to a parent client:${dealLines || '\n(none listed)'}

(C) Real Estate Listings — properties Rosa has listed on MLS:${listingLines || '\n(none listed)'}

(D) Partners / Tools (NOT in any of the above lists, but you'll see them in emails):
- Conduit / Conduit.ai / "Cole" (cole@conduit.ai) / "Punn" (punn@hey.conduit.ai) → AI agent platform we're EVALUATING for our hospitality work. NEVER treat Conduit as a client. When an email talks about Conduit, infer the ACTUAL client/project being discussed from email context (usually it's one of the MR9 Holdings deals: Royal South Beach, Dream Inn, or the Lauderdale Boutique listing).
- Anthropic, OpenAI, Twilio, Airtable, Vercel → infrastructure, never clients.

== OUTPUT SCHEMA ==

Output STRICT JSON only — no preamble, no markdown fences:
{
  "summary": "1 short sentence in English describing what this team email is about",
  "clientReferences": [
    {
      "companyId": "rec... (must match one of the Consulting Client ids above)",
      "companyName": "exact name from the (A) list",
      "excerpt": "MUST be formatted as plain-text bullets describing what the email said about this client. Each line starts with '• '. Then a blank line, then 'Next steps:' (or 'Próximos pasos:' if Spanish) on its own line, then 1-3 bullets of suggested next actions. Mirror the source email's language ONLY — never bilingual. Example (Spanish):\\n\\n• Edwin confirmó recepción de las presentaciones de directorio mayo 2026\\n• Espera la próxima reunión de directorio para revisión\\n\\nPróximos pasos:\\n• Confirmar fecha de la reunión de directorio\\n• Enviar materiales adicionales si Edwin los solicita",
      "links": "array of {\\"label\\": short description, \\"url\\": the URL} — extract every shareable link from the email body that's RELEVANT to this client (Google Docs/Sheets/Slides, Dropbox, Notion, Figma, Loom, OneDrive, signed contracts, calendar/Zoom invites). Skip unsubscribe / footer / social-profile noise. Empty array if none. Use short labels in source language."
    }
  ],
  "newClientCandidates": [
    {
      "name": "Company name as written (e.g. 'AD1 Global', 'Brickell Travel')",
      "country": "if mentioned, e.g. 'USA'; else omit",
      "primaryContact": "person name if mentioned; else omit",
      "evidence": "1-2 sentence quote/paraphrase showing why this looks like a real client engagement (not a tool/partner mention)",
      "confidence": "high | medium | low"
    }
  ],
  "listingReferences": [
    {
      "listingMlsId": "must match one of the listing mlsIds above",
      "listingTitle": "exact title from the (C) list",
      "excerpt": "Plain-text bullets describing what the email said about this listing. Each line starts with '• '. Then a blank line, then 'Next steps:' (or 'Próximos pasos:'), then 1-3 next-action bullets. Mirror the source email language ONLY — never bilingual."
    }
  ],
  "tasksAssigned": [
    {
      "assignee": "Kevin | Noel | Dylan | Rosa",
      "title": "short imperative phrase",
      "companyId": "rec... if related to a Consulting Client (use parent if a Deal is meant), or omit",
      "listingMlsId": "if related to a listing, omit companyId and use this",
      "dueAt": "ISO-8601 with timezone offset, or omit if no date",
      "notes": "short context (optional)"
    }
  ],
  "meetingsScheduled": [
    {
      "companyId": "rec... or omit",
      "companyName": "or omit",
      "listingMlsId": "or omit",
      "title": "e.g. 'Reunión Directorio Intermex'",
      "dueAt": "ISO-8601 with timezone offset (REQUIRED)",
      "notes": "attendees / purpose (optional)"
    }
  ],
  "confidence": "high | medium | low"
}

== RULES ==

- ONLY include items the email genuinely says. Never invent.
- "Royal" / "Royal South Beach" / "Polly Lux" → these refer to the MR9 Holdings deal "Royal South Beach — Board Takeover & Polly Lux Conversion". Return that deal's parent companyId.
- "Dream Inn" → MR9 Holdings (Dream Inn STR Portfolio deal). Use MR9 Holdings' companyId.
- "Lauderdale" / "The Lauderdale" / "Lauderdale Boutique" / "505 SE 16th" → this is a LISTING (not a client). Use listingReferences, NOT clientReferences.
- Conduit alone (e.g. "implementing Conduit V3") is NOT a client mention. Skip it UNLESS the email also references the underlying client/listing — in which case attribute to that.
- newClientCandidates: include companies NOT in the (A) list that the email clearly treats as a real client engagement target — phrases like "scope of work for X", "pitch deck for X", "para la reunión con X", "engagement with X", "nuevo cliente X". confidence="high" only when there's clear evidence of preparing/delivering client work. Skip vague mentions (e.g. "we should look into X someday" → low/skip). Don't include known tools/vendors (Conduit, Anthropic, Twilio, Airtable, etc.).
- tasksAssigned: only when a specific person is told to do something concrete. If Noel says "we need to prepare X" without naming a person, skip.
- meetingsScheduled: only when a date+time is given. If only a date with no time, use 5:00 PM local (end-of-business).
- **LANGUAGE — STRICT**: every excerpt + task title + task notes + meeting title + summary MUST mirror the source email's language. Spanish email → ALL output in Spanish. English email → ALL output in English. NEVER produce bilingual / translated content. NEVER write the same content twice in different languages. If the email mixes languages, pick whichever dominates.
- **FORMAT — STRICT**: excerpts on clientReferences and listingReferences MUST be plain-text bullets followed by "Next steps:" (or "Próximos pasos:" in Spanish). Never a paragraph. Never a single-line summary. The bullets ARE the note Kevin will see in CRM.
- If the email is ambiguous about which client/listing is being discussed, return empty arrays + confidence "low".${excludeSet.size > 0 ? `
- DO NOT include the following companyIds in clientReferences (their notes are being written separately on a direct-activity path — return ONLY OTHER clients mentioned in the body, plus any tasks/meetings):
${[...excludeSet].map(id => `  - ${id}`).join('\n')}` : ''}
- Output JSON only, parseable by JSON.parse.`;

    const userMessage = `Internal email from ${fromName}:
Subject: ${subject || '(no subject)'}

---
${plainTextBody || '(empty body)'}
---

Extract per the schema. JSON only.`;

    // Two-attempt budget: 8000 → 12000. Bumped 2026-05-19 (was 4000 → 8000):
    // §5.1 made team-discussion always-on, so internal mass-sends to many
    // clients (e.g. Noel's IBM CEO Study to 5 companies) reliably truncate
    // at 4000-8000 tokens. Higher floor + ceiling fixes parseJsonLoose
    // throws that flipped messages to CRM_NEEDS_REVIEW.
    const attempts = [3000, 12000];
    let lastErr;
    let lastResponseText = '';
    for (let i = 0; i < attempts.length; i++) {
        const max_tokens = attempts[i];
        const res = await fetch(ANTHROPIC_API, {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: MODEL,
                max_tokens,
                system: systemPrompt,
                messages: [{ role: 'user', content: userMessage }],
            }),
        });
        if (!res.ok) {
            lastErr = new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 500)}`);
            console.error(`[extractTeamDiscussion] attempt ${i + 1}/${attempts.length} HTTP ${res.status}`);
            continue;
        }
        const data = await res.json();
        lastResponseText = data.content?.[0]?.text || '';
        try {
            return validateTeamDiscussion(parseJsonLoose(lastResponseText));
        } catch (err) {
            lastErr = err;
            // Log up to 2000 chars of the failing response so truncation
            // failures are debuggable without re-running the cron.
            const preview = lastResponseText.length > 2000
                ? `${lastResponseText.slice(0, 2000)}\n…[truncated ${lastResponseText.length - 2000} more chars]`
                : lastResponseText;
            console.error(`[extractTeamDiscussion] attempt ${i + 1}/${attempts.length} parse failed (max_tokens=${max_tokens}, subject="${(subject || '').slice(0, 80)}"). stop_reason=${data.stop_reason}, response_length=${lastResponseText.length}\n--- response preview ---\n${preview}\n--- end preview ---`);
        }
    }
    console.error(`[extractTeamDiscussion] ALL ATTEMPTS FAILED. Full last response (length=${lastResponseText.length}):\n${lastResponseText}`);
    throw lastErr || new Error('extractTeamDiscussion exhausted attempts');
}

function parseJsonLoose(text) {
    try { return JSON.parse(text); } catch { /* fall through */ }
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* fall through */ } }
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first >= 0 && last > first) {
        try { return JSON.parse(text.slice(first, last + 1)); } catch { /* fall through */ }
    }
    throw new Error(`Could not parse JSON from model output: ${text.slice(0, 300)}`);
}

function validateTeamDiscussion(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const allowedTeam = new Set(['Kevin', 'Noel', 'Dylan', 'Rosa']);

    const out = {
        summary: typeof obj.summary === 'string' ? obj.summary : '',
        confidence: ['high', 'medium', 'low'].includes(obj.confidence) ? obj.confidence : 'medium',
        clientReferences: Array.isArray(obj.clientReferences) ? obj.clientReferences
            .filter(r => r && typeof r.companyId === 'string' && r.companyId.startsWith('rec'))
            .map(r => ({
                companyId: r.companyId,
                companyName: typeof r.companyName === 'string' ? r.companyName : '',
                excerpt: typeof r.excerpt === 'string' ? r.excerpt.slice(0, 2000) : '',
                links: Array.isArray(r.links) ? r.links
                    .filter(l => l && typeof l.url === 'string' && /^https?:\/\//i.test(l.url))
                    .map(l => ({ label: (typeof l.label === 'string' ? l.label.trim() : '').slice(0, 120), url: l.url.trim().slice(0, 1000) }))
                    : [],
            })) : [],
        newClientCandidates: Array.isArray(obj.newClientCandidates) ? obj.newClientCandidates
            .filter(c => c && typeof c.name === 'string' && c.name.trim().length >= 2)
            .map(c => ({
                name: c.name.trim().slice(0, 200),
                country: typeof c.country === 'string' ? c.country.trim().slice(0, 80) : '',
                primaryContact: typeof c.primaryContact === 'string' ? c.primaryContact.trim().slice(0, 120) : '',
                evidence: typeof c.evidence === 'string' ? c.evidence.slice(0, 500) : '',
                confidence: ['high', 'medium', 'low'].includes(c.confidence) ? c.confidence : 'low',
            })) : [],
        listingReferences: Array.isArray(obj.listingReferences) ? obj.listingReferences
            .filter(r => r && typeof r.listingMlsId === 'string' && r.listingMlsId.length > 0)
            .map(r => ({
                listingMlsId: String(r.listingMlsId),
                listingTitle: typeof r.listingTitle === 'string' ? r.listingTitle : '',
                excerpt: typeof r.excerpt === 'string' ? r.excerpt.slice(0, 1000) : '',
            })) : [],
        tasksAssigned: Array.isArray(obj.tasksAssigned) ? obj.tasksAssigned
            .filter(t => t && typeof t.title === 'string' && allowedTeam.has(t.assignee))
            .map(t => {
                const due = t.dueAt ? new Date(t.dueAt) : null;
                return {
                    assignee: t.assignee,
                    title: t.title.trim().slice(0, 200),
                    companyId: typeof t.companyId === 'string' && t.companyId.startsWith('rec') ? t.companyId : null,
                    listingMlsId: typeof t.listingMlsId === 'string' && t.listingMlsId.length > 0 ? String(t.listingMlsId) : null,
                    dueAt: due && !isNaN(due.getTime()) ? due.toISOString() : null,
                    notes: typeof t.notes === 'string' ? t.notes.trim().slice(0, 500) : '',
                };
            }) : [],
        meetingsScheduled: Array.isArray(obj.meetingsScheduled) ? obj.meetingsScheduled
            .filter(m => m && typeof m.title === 'string' && typeof m.dueAt === 'string')
            .map(m => {
                const due = new Date(m.dueAt);
                return {
                    companyId: typeof m.companyId === 'string' && m.companyId.startsWith('rec') ? m.companyId : null,
                    companyName: typeof m.companyName === 'string' ? m.companyName : '',
                    listingMlsId: typeof m.listingMlsId === 'string' && m.listingMlsId.length > 0 ? String(m.listingMlsId) : null,
                    title: m.title.trim().slice(0, 200),
                    dueAt: isNaN(due.getTime()) ? null : due.toISOString(),
                    notes: typeof m.notes === 'string' ? m.notes.trim().slice(0, 500) : '',
                };
            })
            .filter(m => m.dueAt) : [],
    };
    return out;
}

export function classifyByHeuristic(filename, mimeType) {
    const f = (filename || '').toLowerCase();
    const m = (mimeType || '').toLowerCase();
    // Spreadsheets first (most certain)
    if (/\.(xls|xlsx|csv|numbers|ods|tsv)$/i.test(f)) return 'Spreadsheets';
    if (m.includes('spreadsheet') || m === 'text/csv' || m.includes('excel')) return 'Spreadsheets';
    // Contracts
    if (/\b(contract|agreement|nda|loi|msa|sow|engagement|addendum|offer|listing.*agreement)\b/i.test(f)) return 'Contracts';
    // Deliverables
    if (/\b(deliverable|report|proposal|deck|presentation|plan|draft|brief|dashboard)\b/i.test(f)) return 'Deliverables';
    return 'Misc';
}
