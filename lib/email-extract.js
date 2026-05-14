/**
 * lib/email-extract.js — Anthropic call for email summarization + attachment classification.
 *
 * Returns { summary, noteText, suggestedStatusChange?, suggestedNextAction?,
 *           confidence, attachmentClassifications? }
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

export async function extractEmailUpdate({ fromEmail, fromName, subject, plainTextBody, crmContext, attachments = [], effectiveSender }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const systemPrompt = buildSystemPrompt(crmContext, attachments);
    const userMessage = buildUserMessage({ fromEmail, fromName, subject, plainTextBody, attachments, effectiveSender });

    const res = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: 700,
            system: systemPrompt,
            messages: [{ role: 'user', content: userMessage }],
        }),
    });

    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return parseStrictJson(data.content?.[0]?.text || '');
}

function buildSystemPrompt(ctx, attachments = []) {
    const recordType = ctx.recordType === 'lead' ? 'real estate buyer/seller lead' : 'consulting business contact';
    const statusLine = ctx.currentStatus ? `Current CRM status: "${ctx.currentStatus}".` : '';
    const companyLine = ctx.companyName ? `Their company: "${ctx.companyName}".` : '';

    const attachmentBlock = attachments.length > 0
        ? `

This email has ${attachments.length} attachment(s). Classify each one into ONE of:
- "Contracts" — signed/unsigned agreements, contracts, NDAs, LOIs, MSAs, SOWs, engagement letters, addenda, offers
- "Deliverables" — finished work product: reports, decks, proposals, presentations, dashboards, marketing assets
- "Spreadsheets" — any xlsx/xls/csv/numbers/ods/google-sheet file regardless of content, OR financial models / pricing sheets / pipelines / data exports
- "Misc" — anything that doesn't clearly fit (invoices, photos, scans, screenshots, misc PDFs)

When in doubt between Deliverables and Misc, pick Misc.`
        : '';

    return `You are an automated assistant that reads inbound emails to The Poler Team and writes ONE concise CRM note summarizing each one. You write in the voice of a senior agent making a file note for their own future reference — NOT a customer-facing reply.

Context about this contact:
- They are a ${recordType} in our CRM.
- Their name is "${ctx.recordName}".
${companyLine}
${statusLine}${attachmentBlock}

Output STRICT JSON only — no preamble, no markdown fences. Schema:
{
  "summary": "1 sentence, under 140 chars",
  "noteText": "2-4 short sentences. Plain English. Include commitments/questions/dates/asks. If a status change seems appropriate, SUGGEST it in this text — do NOT mark a field for auto-update.",
  "suggestedStatusChange": "optional — clear status hint as a string, otherwise omit",
  "suggestedNextAction": "optional — one short imperative phrase, otherwise omit",
  "attachmentClassifications": "REQUIRED if attachments exist: array of {\\"filename\\": str, \\"category\\": one of 'Contracts'|'Deliverables'|'Spreadsheets'|'Misc'}; omit otherwise",
  "confidence": "high | medium | low"
}

Rules:
- Output JSON only, parseable by JSON.parse.
- Never include the literal email body in noteText — summarize.
- Never invent facts not in the email.
- If forwarded, summarize the original conversation (what the client said/asked), not the forward itself.
- If attachments exist, attachmentClassifications MUST have exactly one entry per attachment matching filename verbatim.`;
}

function buildUserMessage({ fromEmail, fromName, subject, plainTextBody, attachments = [], effectiveSender }) {
    const attachmentLines = attachments.length > 0
        ? `Attachments (${attachments.length}):\n${attachments.map(a => `  - ${a.filename} (${a.mimeType})`).join('\n')}\n\n`
        : '';

    const senderLine = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
    const forwardNote = effectiveSender && effectiveSender !== fromEmail
        ? `\n(This was forwarded by a teammate; treat the original client ${effectiveSender} as the effective sender for CRM purposes.)`
        : '';

    return `Inbound email to summarize:

From: ${senderLine}${forwardNote}
Subject: ${subject || '(no subject)'}

${attachmentLines}---
${plainTextBody || '(empty body)'}
---

Respond with strict JSON per the schema.`;
}

function parseStrictJson(text) {
    try { return validate(JSON.parse(text)); } catch { /* fall through */ }
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
        try { return validate(JSON.parse(fenced[1])); } catch { /* fall through */ }
    }
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
    if (Array.isArray(obj.attachmentClassifications)) {
        const allowed = new Set(['Contracts', 'Deliverables', 'Spreadsheets', 'Misc']);
        obj.attachmentClassifications = obj.attachmentClassifications
            .filter(a => a && typeof a.filename === 'string')
            .map(a => ({ filename: a.filename, category: allowed.has(a.category) ? a.category : 'Misc' }));
    } else {
        delete obj.attachmentClassifications;
    }
    return obj;
}

export function classifyByHeuristic(filename, mimeType) {
    const f = (filename || '').toLowerCase();
    const m = (mimeType || '').toLowerCase();
    if (/\.(xls|xlsx|csv|numbers|ods|tsv)$/i.test(f)) return 'Spreadsheets';
    if (m.includes('spreadsheet') || m === 'text/csv' || m.includes('excel')) return 'Spreadsheets';
    if (/\b(contract|agreement|nda|loi|msa|sow|engagement|addendum|offer|listing.*agreement)\b/i.test(f)) return 'Contracts';
    if (/\b(deliverable|report|proposal|deck|presentation|plan|draft|brief|dashboard)\b/i.test(f)) return 'Deliverables';
    return 'Misc';
}
