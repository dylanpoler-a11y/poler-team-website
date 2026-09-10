/**
 * /api/agent/leadgen-reply.js — Vercel Edge Function
 *
 * THE single ingest point for every inbound reply to Kevin's outreach.
 * Called by the Railway cloud-sender (inbox_watch / smtp_sender / gmail_outreach
 * check_replies), the Facebook + LinkedIn inbox watchers, and the one-off backfill
 * — right before each Telegram alert. Kevin 2026-09-10: EVERY reply, positive or
 * negative, lands in the CRM; only auto-replies/OOO/bounces are dropped.
 *
 * What it does, in order:
 *   1. Rule classifier — auto-reply / OOO / bounce / unsubscribe → { skipped }.
 *   2. Router — campaigns that belong to a consulting client (CONSULTING_CAMPAIGNS)
 *      write a Consulting Contact + Consulting Activity row instead of a
 *      Lead Generation lead (Kevin: "leads we contact for consulting go in the
 *      consulting section"). Everything else, Keystone/Abrams included, → Lead Gen.
 *   3. Sentiment + running conversation summary via Claude (rules-only fallback
 *      if the model call fails — a classifier outage must never lose a reply).
 *   4. Idempotent upsert on Source Lead ID → Email. First reply stored verbatim;
 *      later replies append an Activity row, bump Reply Count, rewrite Summary.
 *
 *   POST { name?, email?, phone?, company?, title?, website?,
 *          channel, campaign?, replyText, replyAt?, sourceLeadId?, messageId?, status?,
 *          subject?, ourLastMessage?, sentiment?, agent? }
 *   → { ok, routed: 'leadgen'|'consulting', created, skipped?, lead? | contact? }
 *
 * Auth: Bearer AGENT_API_TOKEN (agents) or password (web UI) — see ../_auth.js
 */

export const config = { runtime: 'edge' };

import { authorize } from '../_auth.js';
import {
    TABLES, creds, json, preflight, createRecord, updateRecord, listAll, esc, STATUSES,
    findLead, mapLead, logActivity, normChannel, SENTIMENTS,
} from '../_leadgen.js';

// ── Router: campaign slug / label patterns that belong to a CONSULTING client ──
// Matched case-insensitively against `campaign`. Each entry names the Consulting
// Clients row (by company-name substring) the contact should hang off.
const CONSULTING_CAMPAIGNS = [
    { test: /plaza[\s_-]*san[\s_-]*miguel|atrio|psm[\s_-]/i,                    company: 'Plaza San Miguel' },
    { test: /\bmara\b|\bcsc\b|tamamra|venezolana|maracaibo|centro[\s_-]*salud/i, company: 'Mara' },
];

// ── Rule classifier (mirrors cloud-sender AUTO_STRONG / is_optout / is_hard_no) ──
const AUTO_RX = [
    /\bout of (the )?office\b/i, /\bauto(matic|mated)?[\s-]*(reply|response)\b/i,
    /\bfuera de (la )?oficina\b/i, /\brespuesta autom[aá]tica\b/i,
    /\bI am (currently )?(away|on leave|on vacation|traveling)\b/i,
    /\bestar[ée] (fuera|ausente)\b/i, /\bwill (be )?(back|return)(ing)? (on|in)\b/i,
    /\bthank you for (your|contacting|reaching)\b.*\b(will|shall) (get back|respond|reply)\b/is,
    /\bmailer[\s-]*daemon\b/i, /\bdelivery (status notification|failure)\b/i,
    /\bundeliverable\b/i, /\baddress not found\b/i, /\bmessage (could not|was not) be delivered\b/i,
    /\bno longer (with|works? (at|for))\b/i, /\bthis mailbox is (not monitored|unattended)\b/i,
    /\bticket\s*#?\s*\d{3,}\b.*\b(received|created|opened)\b/is,
];
const OPTOUT_RX = [
    /\bunsubscribe\b/i, /\bremove me\b/i, /\bstop (emailing|contacting|sending)\b/i,
    /\bdo not (email|contact) (me|us)\b/i, /\bopt[\s-]*out\b/i, /\bno me (escribas|contactes|env[ií]es)\b/i,
    /\bd[eé]jame de (escribir|enviar)\b/i, /\bb[oó]rrame\b/i, /\bremover(me)? de (su|la) lista\b/i,
];
const NEGATIVE_RX = [
    /\bnot interested\b/i, /\bno (estoy|estamos) interesad/i, /\bno gracias\b/i, /\bno thanks?\b/i,
    /\bwe('re| are) (all set|good|fine)\b/i, /\bplease (stop|don't)\b/i, /\bnot a fit\b/i,
];
const NOTNOW_RX = [
    /\bnot (right )?now\b/i, /\bmaybe (later|next)\b/i, /\bcheck back\b/i, /\bin (a few|\d+) (months|weeks)\b/i,
    /\bahora no\b/i, /\bm[aá]s adelante\b/i, /\bpor ahora no\b/i, /\bcircle back\b/i, /\bfollow up (in|next)\b/i,
];
const POSITIVE_RX = [
    /\binterested\b/i, /\bme interesa\b/i, /\blet'?s (talk|chat|schedule|set up)\b/i, /\bsend (me )?(more|the|details|info)\b/i,
    /\bcall me\b/i, /\bll[aá]mame\b/i, /\bsounds (good|great)\b/i, /\bwhen (are you|can we|works)\b/i,
    /\bschedule\b/i, /\bagendar\b/i, /\bmore (info|information|details)\b/i, /\bcu[eé]ntame m[aá]s\b/i,
    /\byes\b/i, /\bs[ií]\b/i, /\bclaro\b/i, /\bhappy to\b/i, /\bopen to\b/i,
];

function rulesVerdict(text, subject = '') {
    const t = `${subject}\n${text}`;
    if (!text.trim()) return { drop: 'empty' };
    if (AUTO_RX.some(r => r.test(t)))   return { drop: 'auto' };
    if (OPTOUT_RX.some(r => r.test(t))) return { drop: 'unsubscribe' };
    if (NEGATIVE_RX.some(r => r.test(t))) return { sentiment: 'Negative' };
    if (NOTNOW_RX.some(r => r.test(t)))   return { sentiment: 'Not Now' };
    if (/\?/.test(text) && !POSITIVE_RX.some(r => r.test(t))) return { sentiment: 'Question' };
    if (POSITIVE_RX.some(r => r.test(t))) return { sentiment: 'Positive' };
    return { sentiment: 'Neutral' };
}

// ── Claude: sentiment + running summary (Sonnet — a judgment call, never Haiku) ──
async function classifyAndSummarize({ replyText, subject, ourLastMessage, priorSummary, campaign, name, company }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    const prompt = [
        `You are tagging an inbound reply to Kevin Poler's cold outreach (campaign: ${campaign || 'unknown'}).`,
        `Prospect: ${name || '?'}${company ? ` at ${company}` : ''}.`,
        ourLastMessage ? `Kevin's last message (truncated):\n"""${String(ourLastMessage).slice(0, 1200)}"""` : '',
        priorSummary ? `Summary of the conversation so far:\n"""${priorSummary}"""` : '',
        subject ? `Subject: ${subject}` : '',
        `New reply from the prospect:\n"""${String(replyText).slice(0, 3000)}"""`,
        '',
        'Return ONLY JSON: {"sentiment": one of ["Positive","Question","Neutral","Not Now","Negative","Auto"],',
        ' "summary": 2-3 plain sentences, first person plural is fine ("they asked...", "we offered..."), covering the WHOLE conversation so far incl. this reply, no fluff,',
        ' "next_step": one short line — what Kevin should do next}',
        'Use "Auto" only for out-of-office / bounce / autoresponder text. "Question" = they asked something without committing.',
    ].filter(Boolean).join('\n');

    try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                model: 'claude-sonnet-5',
                max_tokens: 400,
                messages: [{ role: 'user', content: prompt }],
            }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        const txt = (data.content || []).map(c => c.text || '').join('');
        const m = txt.match(/\{[\s\S]*\}/);
        if (!m) return null;
        const out = JSON.parse(m[0]);
        if (!out || typeof out !== 'object') return null;
        return out;
    } catch {
        return null;
    }
}

// ── Consulting branch ──────────────────────────────────────────────────────
async function atFetch(path, init = {}) {
    const { apiKey, baseId } = creds();
    const res = await fetch(`https://api.airtable.com/v0/${baseId}/${path}`, {
        ...init,
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
}

async function routeToConsulting({ companyName, name, email, phone, title, campaign, channel, replyText, replyAt, sentiment, summary, midTag = '' }) {
    // 1. Find the consulting company row by name substring.
    const co = await atFetch(`Consulting%20Clients?filterByFormula=${encodeURIComponent(`FIND('${esc(companyName.toLowerCase())}', LOWER({Company}))`)}&maxRecords=1`);
    const companyId = co.ok ? co.body.records?.[0]?.id : null;
    if (!companyId) return { ok: false, error: `consulting company not found: ${companyName}` };

    // 2. Find or create the contact under that company (email, then name).
    const contacts = await atFetch(`Consulting%20Contacts?filterByFormula=${encodeURIComponent(`FIND('${companyId}', ARRAYJOIN({Company}))`)}&maxRecords=100`);
    const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
    let contact = null;
    for (const r of (contacts.ok ? contacts.body.records || [] : [])) {
        const e = (r.fields?.Email || '').toLowerCase().trim();
        if (email && e && e === email.toLowerCase()) { contact = r; break; }
        if (!email && name && norm(r.fields?.Name) === norm(name)) { contact = r; break; }
    }
    let created = false;
    const noteLine = `[${new Date(replyAt).toLocaleString('en-US', { timeZone: 'America/New_York' })} — leadgen-reply] ${sentiment} reply via ${channel}${campaign ? ` / ${campaign}` : ''}: ${String(replyText).slice(0, 400)}`;
    if (!contact) {
        const fields = { 'Name': (name || email || 'Unknown').trim(), 'Company': [companyId] };
        if (email) fields['Email'] = email;
        if (phone) fields['Phone'] = phone;
        if (title) fields['Role']  = title;
        fields['Notes'] = noteLine;
        const c = await atFetch('Consulting%20Contacts', { method: 'POST', body: JSON.stringify({ fields, typecast: true }) });
        if (!c.ok) return { ok: false, error: c.body.error?.message || 'contact create failed' };
        contact = c.body; created = true;
    } else {
        const prev = contact.fields?.Notes || '';
        await atFetch(`Consulting%20Contacts/${contact.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'Notes': `${noteLine}\n\n${prev}`.trim() }, typecast: true }) });
    }

    // 3. Activity row on the company (the consulting timeline is company-scoped).
    await atFetch('Consulting%20Activity', { method: 'POST', body: JSON.stringify({ fields: {
        'Title':   `${sentiment} reply — ${name || email || '?'}${campaign ? ` (${campaign})` : ''}`.slice(0, 250),
        'Type':    channel === 'WhatsApp' ? 'WhatsApp' : 'Email Logged',
        'Company': [companyId],
        'Details': `${summary ? summary + '\n\n' : ''}Reply:\n${String(replyText).slice(0, 1500)}${midTag ? '\n' + midTag : ''}`,
        'Agent':   'Kevin',
    }, typecast: true }) });
    await atFetch(`Consulting%20Clients/${companyId}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'Last Contact': replyAt.slice(0, 10) }, typecast: true }) }).catch(() => {});

    return { ok: true, created, contact: { id: contact.id, companyId, name: contact.fields?.Name || name } };
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(req) {
    if (req.method === 'OPTIONS') return preflight('POST');
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    let body = {};
    try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

    if (!authorize(req, body).ok) return json({ error: 'Unauthorized' }, 401);

    const { apiKey, baseId } = creds();
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);

    // 1. Validate.
    const name      = String(body.name  || '').trim().slice(0, 120);
    const email     = String(body.email || '').trim().toLowerCase().slice(0, 200);
    const replyText = String(body.replyText || body.reply || '').trim().slice(0, 8000);
    const campaign  = String(body.campaign || '').trim().slice(0, 80);
    const channel   = normChannel(body.channel);
    const sourceLeadId = String(body.sourceLeadId || '').trim().slice(0, 200);
    // Optional pipeline stage — the senders pass 'Lost' for opt-outs / hard no's so a
    // "please remove me" lands as a closed Negative row, not an open New one.
    const status = STATUSES.includes(body.status) ? body.status : null;
    const replyAt   = (body.replyAt && !Number.isNaN(Date.parse(body.replyAt)))
        ? new Date(body.replyAt).toISOString() : new Date().toISOString();
    if (!name && !email && !sourceLeadId) return json({ error: 'name, email or sourceLeadId is required' }, 400);
    if (!replyText) return json({ error: 'replyText is required' }, 400);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'invalid email' }, 400);
    if (campaign && !/^[A-Za-z0-9 _./&()+-]+$/.test(campaign)) return json({ error: 'invalid campaign' }, 400);

    // 1b. Idempotency — the same inbound message can be seen by two sweepers (inbox_watch
    // AND smtp_sender both read the KPS boxes; a Railway redeploy re-reads recent mail).
    // Callers pass the Message-ID (or any stable per-message key); we stamp it into the
    // activity Details and refuse a second write for the same key.
    const messageId = String(body.messageId || '').trim().slice(0, 300);
    const midTag    = messageId ? `[mid:${messageId}]` : '';
    if (messageId) {
        const dup = await listAll(TABLES.activity, { filter: `FIND('${esc(midTag)}', {Details})` });
        if (dup.ok && dup.records.length) {
            return json({ ok: true, skipped: 'duplicate', routed: null, messageId, activityId: dup.records[0].id });
        }
        const dupC = await listAll('Consulting%20Activity', { filter: `FIND('${esc(midTag)}', {Details})` });
        if (dupC.ok && dupC.records.length) {
            return json({ ok: true, skipped: 'duplicate', routed: 'consulting', messageId, activityId: dupC.records[0].id });
        }
    }

    // 2. Rules first — auto/OOO/bounce/unsubscribe never reach the CRM.
    const rules = rulesVerdict(replyText, body.subject || '');
    if (rules.drop && !body.force) return json({ ok: true, skipped: rules.drop, routed: null });

    // 3. Find existing lead (for the running summary) BEFORE classifying.
    const found = await findLead({ sourceLeadId, email });
    if (!found.ok) return json({ error: found.error }, found.status || 502);
    const existing = found.record;
    const priorSummary = existing?.fields?.['Summary'] || '';

    // 4. Claude sentiment + summary; rules fallback.
    let sentiment = SENTIMENTS.includes(body.sentiment) ? body.sentiment : null;
    let summary   = '';
    let nextStep  = '';
    const ai = await classifyAndSummarize({
        replyText, subject: body.subject, ourLastMessage: body.ourLastMessage,
        priorSummary, campaign, name, company: body.company,
    });
    if (ai) {
        if (ai.sentiment === 'Auto' && !body.force) return json({ ok: true, skipped: 'auto', routed: null, by: 'model' });
        if (!sentiment && SENTIMENTS.includes(ai.sentiment)) sentiment = ai.sentiment;
        summary  = String(ai.summary || '').trim().slice(0, 1500);
        nextStep = String(ai.next_step || '').trim().slice(0, 300);
    }
    if (!sentiment) sentiment = rules.sentiment || 'Neutral';
    if (!summary) {
        summary = `${name || email || 'Prospect'} replied (${sentiment.toLowerCase()})${campaign ? ` to ${campaign}` : ''}: ${replyText.slice(0, 240)}`;
    }
    const summaryFull = nextStep ? `${summary}\nNext: ${nextStep}` : summary;

    // 5. Router — consulting-client campaigns go to the Consulting module.
    const route = CONSULTING_CAMPAIGNS.find(c => c.test.test(campaign) || c.test.test(body.company || ''));
    if (route) {
        const r = await routeToConsulting({
            companyName: route.company, name, email, phone: body.phone, title: body.title,
            campaign, channel, replyText, replyAt, sentiment, summary: summaryFull, midTag,
        });
        if (!r.ok) {
            // Company row missing → fall through to Lead Gen rather than lose the reply,
            // but flag it in the campaign label so Kevin sees it.
            console.warn('[leadgen-reply] consulting route failed, falling back to leadgen:', r.error);
        } else {
            return json({ ok: true, routed: 'consulting', created: r.created, sentiment, contact: r.contact });
        }
    }

    // 6. Lead Gen upsert.
    const fields = {};
    const put = (k, v) => { if (v !== undefined && v !== null && v !== '') fields[k] = v; };
    put('Name',     name);
    put('Email',    email);
    put('Company',  body.company);
    put('Title',    body.title);
    put('Phone',    body.phone);
    put('Website',  body.website);
    put('Campaign', campaign);
    fields['Channel']       = channel;
    fields['Sentiment']     = sentiment;
    fields['Summary']       = summaryFull;
    fields['Last Reply At'] = replyAt;
    fields['Last Contact']  = replyAt.slice(0, 10);
    if (sourceLeadId) fields['Source Lead ID'] = sourceLeadId;

    const activityType = sentiment === 'Positive' ? 'Positive Reply' : 'Reply';

    if (existing) {
        const prevCount = Number(existing.fields?.['Reply Count'] || 0);
        fields['Reply Count'] = prevCount + 1;
        if (!existing.fields?.['First Reply']) {
            fields['First Reply'] = replyText;
            fields['Reply At']    = replyAt;
        }
        if (!existing.fields?.['Reply Snippet']) fields['Reply Snippet'] = replyText.slice(0, 300);
        // A fresh positive after a Lost/Negative → bring it back to New so it resurfaces.
        if (sentiment === 'Positive' && existing.fields?.['Status'] === 'Lost') fields['Status'] = 'New';
        if (status && !['Won', 'Meeting Booked'].includes(existing.fields?.['Status'] || '')) fields['Status'] = status;

        const res = await updateRecord(TABLES.leads, existing.id, fields);
        if (!res.ok) return json({ error: res.error }, res.status || 502);
        await logActivity({
            title: `${sentiment} reply — ${channel}${campaign ? ` / ${campaign}` : ''}`,
            type: activityType, leadId: existing.id, details: replyText.slice(0, 2000) + (midTag ? '\n' + midTag : ''),
            agent: 'Responder Bot', at: replyAt,
        });
        return json({ ok: true, routed: 'leadgen', created: false, sentiment, lead: mapLead(res.record) });
    }

    fields['Status']        = status || 'New';
    fields['Owner']         = body.owner || 'Kevin';
    fields['First Reply']   = replyText;
    fields['Reply Snippet'] = replyText.slice(0, 300);
    fields['Reply At']      = replyAt;
    fields['Reply Count']   = 1;
    fields['Created At']    = new Date().toISOString();

    const res = await createRecord(TABLES.leads, fields);
    if (!res.ok) return json({ error: res.error }, res.status || 502);
    await logActivity({
        title: `${sentiment} reply — ${channel}${campaign ? ` / ${campaign}` : ''}`,
        type: activityType, leadId: res.record.id, details: replyText.slice(0, 2000) + (midTag ? '\n' + midTag : ''),
        agent: 'Responder Bot', at: replyAt,
    });
    return json({ ok: true, routed: 'leadgen', created: true, sentiment, lead: mapLead(res.record) });
}
