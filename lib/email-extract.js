/**
 * lib/email-extract.js — Anthropic API call for email summarization.
 *
 * Takes one inbound email + the CRM context for the matched record, returns
 * strict JSON. Model: claude-haiku-4-5 (cheap, fast — we're summarizing,
 * not drafting outbound replies, so quality > speed isn't needed).
 *
 * Docs: https://docs.anthropic.com/en/api/messages
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

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
            max_tokens: 600,
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

Your job is to read ONE inbound email and output STRICT JSON only — no preamble, no markdown fences, no commentary. Schema:
{
  "summary": "1 sentence, under 140 chars, what the email is about",
  "noteText": "2-4 short sentences for the CRM note. Plain English. Include any commitments, questions, dates, or asks. If the email is mostly an attachment delivery, say so briefly. If a status/stage change seems appropriate, SUGGEST it inside this note text — do NOT mark a field for auto-update. Example: 'Asked about availability for tour next Tuesday. Suggest moving to Hot.'",
  "suggestedStatusChange": "optional — if you detect a clear status hint (e.g. 'Hot', 'Won', 'Closed Lost'), put it here as a string. Otherwise omit. We will NOT auto-apply this in v1.",
  "suggestedNextAction": "optional — one short imperative phrase, e.g. 'Reply with tour times'. Otherwise omit.",
  "attachmentClassifications": "array of {\\"filename\\": str, \\"category\\": one of 'Contracts'|'Deliverables'|'Spreadsheets'|'Misc'} — REQUIRED if attachments exist, omit otherwise",
  "confidence": "high | medium | low"
}

Rules:
- Output JSON only, parseable by JSON.parse.
- Never include the literal email body in noteText — summarize.
- If the email is auto-generated (calendar invite, newsletter, bounce), set confidence "low" and noteText to a brief description of what arrived.
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
    return obj;
}

/**
 * Fallback classifier — used if Anthropic call fails entirely but we still
 * want to upload attachments. Pure code, no API call.
 */
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
