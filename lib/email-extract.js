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
const MODEL = 'claude-sonnet-4-5-20250514';

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
export async function extractEmailUpdate({ fromEmail, fromName, subject, plainTextBody, crmContext, attachments = [] }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const systemPrompt = buildSystemPrompt(crmContext, attachments);
    const userMessage = buildUserMessage({ fromEmail, fromName, subject, plainTextBody, attachments });

    const res = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: 1200,
            system: systemPrompt,
            messages: [{ role: 'user', content: userMessage }],
        }),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Anthropic API ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    return parseStrictJson(text);
}

function buildSystemPrompt(ctx, attachments = []) {
    const recordType = ctx.recordType === 'lead' ? 'real estate buyer/seller lead' : 'consulting business contact';
    const statusLine = ctx.currentStatus ? `Current CRM status: "${ctx.currentStatus}".` : '';
    const companyLine = ctx.companyName ? `Their company: "${ctx.companyName}".` : '';

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
${statusLine}${attachmentBlock}

Today's date: ${new Date().toISOString().slice(0,10)} (use this to resolve relative dates like "next Tuesday" or "tomorrow").

Your job is to read ONE inbound email and output STRICT JSON only — no preamble, no markdown fences, no commentary. Schema:
{
  "summary": "1 sentence, under 140 chars, what the email is about",
  "noteText": "MUST be formatted as plain-text bullets. Each line starts with '• ' (or '- '). Cover the key points only — commitments, questions, dates, asks, attachments delivered. Then a blank line, then 'Next steps:' on its own line, then 1-3 bullets of suggested next actions for the team. Example:\\n\\n• Client confirms tour Tuesday 3pm\\n• Wants comparable units in Sunny Isles under $2M\\n• Attached pre-approval letter from BofA\\n\\nNext steps:\\n• Send 3-5 matching Sunny Isles condos by EOD\\n• Confirm tour address by Mon noon",
  "reminders": "array of {\\"title\\": short imperative phrase, \\"dueAt\\": ISO-8601 datetime, \\"actionType\\": 'Call'|'Email'|'Meeting'|'Tour'|'Follow Up'|'Other', \\"note\\": short context (optional)} — extract ONLY commitments/scheduled events with a clear date or time. If the email says 'let's zoom Tuesday at 3pm' → make a reminder. If it says 'I'll get back to you next week' → make a reminder for Friday EOD. If no concrete date is mentioned, return []. Be conservative: do NOT invent reminders. Use the recipient's local timezone (America/New_York). If only a date is given with no time, use 9:00 AM ET.",
  "suggestedStatusChange": "optional — if you detect a clear status hint (e.g. 'Hot', 'Won', 'Closed Lost'), put it here as a string. Otherwise omit. We will NOT auto-apply this in v1.",
  "attachmentClassifications": "array of {\\"filename\\": str, \\"category\\": one of 'Contracts'|'Deliverables'|'Spreadsheets'|'Misc'} — REQUIRED if attachments exist, omit otherwise",
  "confidence": "high | medium | low"
}

Rules:
- Output JSON only, parseable by JSON.parse.
- noteText MUST be bullets, NEVER a paragraph. Skip greetings/sign-offs.
- Always include the "Next steps:" section, even if just 1 bullet ("Acknowledge receipt", "No action needed", etc).
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
export async function extractTeamDiscussion({ fromName, subject, plainTextBody, clientList, teamMembers = ['Kevin', 'Noel', 'Dylan', 'Rosa'] }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const today = new Date().toISOString().slice(0, 10);
    const clientLines = clientList.map(c => `- "${c.name}" (id: ${c.id})`).join('\n');
    const teamLine = teamMembers.join(', ');

    const systemPrompt = `You are an automated assistant reading an internal team email between members of The Poler Team (${teamLine}) and extracting structured CRM updates from it. The team often discusses clients in Spanish, English, or a mix — handle both.

Today's date: ${today} (use to resolve relative dates like "mañana", "next Tuesday", "el viernes").
Timezone for any dates: America/New_York. Output ISO-8601 with offset.

Known CRM clients (use these exact "name" values, return id when referencing):
${clientLines}

Output STRICT JSON only — no preamble, no markdown fences. Schema:
{
  "summary": "1 short sentence in English describing what this team email is about",
  "clientReferences": [
    {
      "companyId": "rec... (must match one of the ids above)",
      "companyName": "exact name from the list",
      "excerpt": "1-2 sentence quote/paraphrase of what the email said about this client (Spanish or English, mirror the source)"
    }
  ],
  "tasksAssigned": [
    {
      "assignee": "Kevin | Noel | Dylan | Rosa",
      "title": "short imperative phrase",
      "companyId": "rec... or omit if not client-specific",
      "dueAt": "ISO-8601 with timezone offset, or omit if no date",
      "notes": "short context (optional)"
    }
  ],
  "meetingsScheduled": [
    {
      "companyId": "rec... or omit",
      "companyName": "or omit",
      "title": "e.g. 'Reunión con Directorio Intermex'",
      "dueAt": "ISO-8601 with timezone offset (REQUIRED for meetings)",
      "notes": "attendees / purpose (optional)"
    }
  ],
  "confidence": "high | medium | low"
}

Rules:
- ONLY include items the email genuinely says. Never invent.
- clientReferences: include every client the email talks about, even if no task is assigned for them.
- tasksAssigned: only when a specific team member is told to do something concrete. If Noel says "we need to prepare X" without naming a person, skip OR assign to all named recipients if context makes it clear.
- meetingsScheduled: only when a date+time is given. If only a date with no time, use 9:00 AM local.
- If the email is ambiguous about which client is being discussed, return empty arrays and confidence "low".
- Output JSON only, parseable by JSON.parse.`;

    const userMessage = `Internal email from ${fromName}:
Subject: ${subject || '(no subject)'}

---
${plainTextBody || '(empty body)'}
---

Extract per the schema. JSON only.`;

    const res = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: 1500,
            system: systemPrompt,
            messages: [{ role: 'user', content: userMessage }],
        }),
    });

    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    return validateTeamDiscussion(parseJsonLoose(text));
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
