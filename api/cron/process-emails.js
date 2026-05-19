/**
 * /api/cron/process-emails.js — Vercel Edge Function, triggered every 5 min by cron-job.org.
 *
 * Unified participant-matching flow:
 *   1. For each active row in Team Inboxes:
 *        a. Refresh access_token using stored refresh_token
 *        b. List recent (in:inbox OR in:sent) -category:promotions messages
 *           not already labeled CRM_PROCESSED / UNMATCHED / NEEDS_REVIEW
 *        c. For each message:
 *           - Parse ALL participants (FROM, TO, CC, BCC, forwarded-body addresses)
 *           - Match each against CRM emailIndex
 *           - If ≥1 match → extractEmailUpdate (full body), write the SAME
 *             note to every matched record's timeline, attachments+reminders
 *             only on primary record. If internal sender + ≥2 matches → also
 *             extractTeamDiscussion to catch cross-references the direct
 *             notes don't cover.
 *           - If 0 matches → extractTeamDiscussion on full body. If anything
 *             returned (clientReferences / newClientCandidates / tasks /
 *             meetings) → write those. Otherwise label CRM_UNMATCHED.
 *           - One consolidated Slack ping per processed email.
 *           - Failures → CRM_NEEDS_REVIEW (rare; extractor has retry).
 *        d. Stamp Last Polled
 *
 *   Manual modes (via query string):
 *     ?since=24h            → widen the Gmail "newer_than" window for catch-up
 *     ?reprocess=needs_review → target label:CRM_NEEDS_REVIEW (last 7d),
 *                              unlabel before re-processing
 */

export const config = { runtime: 'edge' };

import { listActiveInboxes, stampLastPolled } from '../../lib/team-inboxes.js';
import {
    refreshAccessToken, listRecentMessages, fetchMessage,
    parseMessage, applyLabel, removeLabel, ensureLabel, fetchAttachment,
    parseForwardedSenders, isForwardSubject,
} from '../../lib/gmail.js';
import { getEmailIndex, getClientList, getDealList } from '../../lib/crm-contacts.js';
import { extractEmailUpdate, extractTeamDiscussion, classifyByHeuristic } from '../../lib/email-extract.js';
import { sendSlackMessage, getOwnerSlackWebhook } from '../../lib/slack.js';

const ROSA_MLS_AGENT_ID = '3268052';
const INTERNAL_DOMAINS = ['poler.org', 'homesinsoflorida.com', 'investoros1.com'];

// Senders Kevin explicitly does NOT want the agent reading. Filtered at the
// Gmail query level (-from:domain) so we don't even fetch them. Add/remove
// freely — Gmail accepts long queries (~1500 chars).
const SKIP_SENDER_DOMAINS = [
    // Banking + payments
    'chase.com', 'americanexpress.com', 'aexp.com', 'venmo.com',
    'zelle.com', 'zellepay.com', 'capitalone.com',
    // Shopping / commerce
    'amazon.com', 'bylt.com', 'byltbasics.com',
    // Work / social platforms
    'linkedin.com', 'fiverr.com', 'upwork.com', 'meta.com',
    'facebookmail.com', 'facebook.com', 'slack.com', 'slackmail.com',
    // Sports + leisure
    'nfl.com', 'mlb.com', 'fantasypros.com', 'footballguys.com',
    'heatnation.com', 'miamiheat.com', 'mlbmail.com',
    // Real estate competitors / external brokers
    'exprealty.com',
    // Agency operational mail (our own outbound infra, not client mail).
    // Added 2026-05-19 — body-first refactor: kevinpolerservices.com is
    // the agency's own domain, not a client; nothing it sends needs CRM
    // logging. Filter at the Gmail query so we never even fetch them.
    'kevinpolerservices.com',
];

// Subjects that are pure system noise — Facebook-lead notifications, welcome
// templates from the website's own lead-capture flow, etc.
//
// NOTE (2026-05-19, body-first refactor, skill §15): these subjects ARE the
// real-estate signal too — `save-lead.js` already creates the Airtable Lead
// row directly when the form is submitted, so the notification email is just
// FYI to Kevin/Rosa/Dylan. We filter them out of the cron's fetch query —
// real-estate Leads are created by OTHER pipes (homesinsoflorida.com web
// form via api/save-lead.js, FB lead webhook, CINC sync, MLS feed). The
// email cron is CONSULTING-FIRST: it never creates real-estate Leads and
// only updates Lead Notes when the inbound email is from a contact who's
// ALREADY a Lead (e.g. an existing buyer replying to Kevin). Anything that
// looks like an auto-generated Lead-creation email gets skipped entirely.
const SKIP_SUBJECT_PATTERNS = [
    'New Lead:',                  // homesinsoflorida.com form submit (api/save-lead.js)
    'Welcome - New Lead',         // welcome template back to the lead
    'Property Inquiry',           // listing-page contact form
    'Tour Request',
    'Showing Request',
    'registered on homesinsoflorida',
    // Autonomous-agency operational digests sent FROM kevinpolermiami@gmail.com
    // to itself by the agency tool. NOT client communications. Skip at fetch.
    // Trace: 2026-05-19 Slack search showed pings on "Agency hourly — 1
    // contacted, 0 replied" at 10:23 + 11:25 AM ET from kevinpolermiami.
    'Agency hourly',
    'Agency daily',
    'Agency status',
    'Agency summary',
    'Autonomous agency',
];

// Sender-domain denylist (extends the bank/social/sports denylist further
// up the file). These are automated RE-Lead pipes whose emails are FYI —
// the Lead already exists via the pipe's own write path. Don't process.
const SKIP_RE_LEAD_PIPE_DOMAINS = [
    'facebookmail.com',          // FB lead ad notifications
    'cincapp.com', 'cinc.com',   // CINC pipe
    'flexmls.com', 'mlsmatrix.com', 'matrix.miamire.com', // MLS-feed senders
];

function buildSkipQueryFragment() {
    const senderPart = [...SKIP_SENDER_DOMAINS, ...SKIP_RE_LEAD_PIPE_DOMAINS].map(d => `-from:${d}`).join(' ');
    const subjectPart = SKIP_SUBJECT_PATTERNS.map(s => `-subject:"${s}"`).join(' ');
    return `${senderPart} ${subjectPart}`.trim();
}

// Explicit team-member addresses. NEVER match these against CRM records even
// when they're @gmail.com (which bypasses INTERNAL_DOMAINS). Includes test/
// duplicate Lead rows that accidentally got created during early CRM dev.
// Kevin, Noel, Dylan, Rosa are all admins, not leads/contacts.
const TEAM_EMAILS = new Set([
    'kevinpolermiami@gmail.com',
    'kevinpoler1@gmail.com',
    'kevin@poler.org',
    'noel@poler.org',
    'noelpoler@gmail.com',
    'noelpoler@fastmail.fm',
    'dylan@poler.org',
    'dylanpoler@gmail.com',
    'rosa@poler.org',
    'rosadasilvapoler@gmail.com',
    'rosapoler@gmail.com',
    'rosapoler@hotmail.com',
    // Boris Buvinic Guerovich = the "Buvinic" in Buvinic | Poler Intelligence
    // consulting partnership. He's CC'd on most LATAM client threads as
    // co-principal, not a client. Treat as team-equivalent for participant
    // matching (skip).
    'boris.buvinic@gmail.com',
]);

function isTeamMemberEmail(email) {
    const e = (email || '').toLowerCase().trim();
    if (!e) return false;
    if (TEAM_EMAILS.has(e)) return true;
    const domain = e.split('@')[1] || '';
    return INTERNAL_DOMAINS.some(d => domain === d || domain.endsWith('.' + d));
}

// TRIGGER_TEAM_EMAILS — subset of TEAM_EMAILS that GATES processing.
// Kevin's rule (2026-05-19): process an email ONLY if at least one of
// Noel / Dylan / Rosa is somewhere in the participant set (FROM, TO, CC,
// BCC, or forwarded-body sender/recipient). Kevin's own presence is NOT
// sufficient — most of his inbox noise (FB ad notifications, agency
// outreach replies, newsletters, RE leads) does NOT include another
// team member, so it shouldn't be processed.
//
// Inbound: Noel/Dylan/Rosa is the sender, on TO/CC, or in the forward body.
// Outbound: Kevin sent to/cc'd Noel/Dylan/Rosa.
//
// Result for filtered-out emails: label CRM_NO_TEAM so we don't refetch them
// on every tick. No CRM write, no Slack ping.
const TRIGGER_TEAM_EMAILS = new Set([
    'noel@poler.org',
    'noelpoler@gmail.com',
    'noelpoler@fastmail.fm',
    'dylan@poler.org',
    'dylanpoler@gmail.com',
    'rosa@poler.org',
    'rosadasilvapoler@gmail.com',
    'rosapoler@gmail.com',
    'rosapoler@hotmail.com',
]);

function isTriggerTeamEmail(email) {
    const e = (email || '').toLowerCase().trim();
    return TRIGGER_TEAM_EMAILS.has(e);
}

// Check if Noel/Dylan/Rosa appears anywhere on a parsed message.
// Returns the matching email address for logging, or null.
function findTriggerTeamParticipant(parsed) {
    if (!parsed) return null;
    const check = (e) => e && isTriggerTeamEmail(typeof e === 'string' ? e : e.email);
    // Sender
    if (check(parsed.from)) return (parsed.from?.email || parsed.from);
    if (check(parsed.replyTo)) return (parsed.replyTo?.email || parsed.replyTo);
    // TO / CC / BCC arrays
    for (const arr of [parsed.toList || [], parsed.ccList || [], parsed.bccList || []]) {
        for (const item of arr) {
            if (check(item)) return (item?.email || item);
        }
    }
    // Forwarded-body participants (if subject was a forward)
    const forwarded = parsed.forwardedSenders || [];
    for (const f of forwarded) {
        if (check(f)) return (f?.email || f);
    }
    return null;
}

// Domain → category map for the auto-labeling pass. Mirrors the categories
// the historical labeling agent applied to the 6-month backfill, so new
// emails get consistent treatment. Returns null when no match — caller
// decides the fallback.
function categorizeByDomain(domain) {
    const d = (domain || '').toLowerCase();
    if (!d) return null;
    // Real-estate industry (other agents, MLS, listing portals, title)
    if (/(zillow|redfin|realtor|loopnet|crexi|costar|trulia|movoto|compass|sothebysrealty|coldwellbanker|kw\.com|exprealty|douglaselliman|berkshirehathaway|engelvoelkers|propertyblast|coldwell)/.test(d)) return 'Real Estate Industry';
    // Social / work platforms
    if (/(linkedin|fb|facebookmail|facebook|twitter|x\.com|instagram|fiverr|upwork|slack|slackmail|meta\.com|discord|notion|asana|clickup)/.test(d)) return 'Social/Work Platforms';
    // Personal / financial
    if (/(chase|americanexpress|aexp|venmo|zelle|zellepay|capitalone|wellsfargo|bankofamerica|paypal|irs\.gov|usbank|schwab|fidelity|robinhood|coinbase|amex)/.test(d)) return 'Personal/Financial';
    // Sports / entertainment
    if (/(nfl|mlb|nba|fantasypros|footballguys|miamiheat|heatnation|tickets|stubhub|seatgeek|espn|theathletic|barstool|mlbmail)/.test(d)) return 'Sports/Entertainment';
    // Tech infrastructure
    if (/(anthropic|openai|airtable|vercel|github|stripe|twilio|cloudflare|amazonaws|googlecloud|investoros1)/.test(d)) return 'Investor OS / Tech';
    // Common commerce / promo
    if (/(amazon|shopify|bylt|byltbasics|cellfast|wayfair|target|walmart|macys|nordstrom)/.test(d)) return 'Promotional';
    return null;
}

/**
 * Category-label every NEW unlabeled email in the last hour. Runs as a
 * separate pass before the main CRM processing so even emails the cron
 * skips (promotional, skip-domains) get tagged. No Sonnet cost — pure
 * lookup against emailIndex + sender-domain heuristics.
 */
async function applyOngoingCategoryLabels(accessToken, emailIndex) {
    // Tight window + cap so the labeling pass stays under 5 seconds. The cron
    // runs every 5 min so newer_than:15m catches everything between runs with
    // overlap. -has:userlabels means we never re-label.
    const query = `in:inbox newer_than:15m -has:userlabels`;
    let messages;
    try { messages = await listRecentMessages(accessToken, query, 10); }
    catch { return { scanned: 0, labeled: 0 }; }

    let labeled = 0;
    for (const msgRef of messages) {
        try {
            // Cheaper metadata-only fetch — we only need the From header
            const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgRef.id}?format=metadata&metadataHeaders=From`, {
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            if (!res.ok) continue;
            const data = await res.json();
            const fromHeader = (data.payload?.headers || []).find(h => h.name.toLowerCase() === 'from')?.value || '';
            const fromMatch = fromHeader.match(/<([^>]+)>|(\S+@\S+)/);
            const fromEmail = (fromMatch?.[1] || fromMatch?.[2] || '').toLowerCase();
            const fromDomain = fromEmail.split('@')[1] || '';

            // Team-member check comes FIRST. Per skill §3, Kevin/Noel/Dylan/Rosa
            // are admins, not Leads/Contacts. If a stale Lead row exists for a
            // team email (e.g. noel@poler.org leftover from CRM dev), looking it
            // up in emailIndex first would mislabel every team email as
            // "Real Estate Lead". Mirrors the order in buildParticipantMatches.
            let label = null;
            if (isTeamMemberEmail(fromEmail)) {
                label = 'Team Internal';
            } else {
                const crmRaw = emailIndex.get(fromEmail);
                const crmMatch = Array.isArray(crmRaw) ? crmRaw[0] : crmRaw;
                if (crmMatch) {
                    if (crmMatch.recordType === 'lead') label = 'Real Estate Lead';
                    else if (crmMatch.recordType === 'development-project') label = `Development Project - ${crmMatch.projectName || 'Unknown'}`;
                    else if (crmMatch.companyName) label = `Consulting Client - ${crmMatch.companyName}`;
                } else {
                    label = categorizeByDomain(fromDomain);
                }
            }
            if (label) {
                await applyLabel(msgRef.id, label, accessToken).catch(e => console.error(`auto-label failed (${label}):`, e.message));
                labeled++;
            }
        } catch { /* skip individual failures */ }
    }
    return { scanned: messages.length, labeled };
}

async function getRosaListings() {
    const token = process.env.BRIDGE_API_TOKEN;
    if (!token) return [];
    try {
        const params = new URLSearchParams({
            access_token: token,
            StandardStatus: 'Active',
            ListAgentMlsId: ROSA_MLS_AGENT_ID,
            limit: '50',
            fields: 'ListingId,UnparsedAddress,City,ListPrice,PropertySubType',
        });
        const res = await fetch(`https://api.bridgedataoutput.com/api/v2/miamire/listings?${params}`);
        if (!res.ok) return [];
        const data = await res.json();
        return (data.bundle || data.value || []).map(r => ({
            mlsId: r.ListingId,
            title: `${r.UnparsedAddress || 'Unknown address'}${r.City ? ', ' + r.City : ''}`,
            price: r.ListPrice || 0,
            type: r.PropertySubType || '',
        }));
    } catch (err) {
        console.error('[bridge] listings fetch failed:', err.message);
        return [];
    }
}

function isInternalDomain(domain) {
    const d = (domain || '').toLowerCase();
    return INTERNAL_DOMAINS.some(x => d === x || d.endsWith('.' + x));
}

function isNoreplyLocal(local) {
    const lc = (local || '').toLowerCase();
    if (!lc) return true;
    const noreplyTerms = ['noreply', 'no-reply', 'do-not-reply', 'mailer-daemon', 'postmaster', 'notifications'];
    for (const t of noreplyTerms) {
        if (lc === t) return true;
        if (lc.startsWith(t + '+')) return true;
        if (lc.endsWith('-' + t) || lc.endsWith('_' + t)) return true;
        if (lc.startsWith(t + '-') || lc.startsWith(t + '_')) return true;
    }
    return false;
}

// Catches senders the Gmail query can't easily exclude — display-name matches
// (e.g. "Joe Bryant" personal Gmail) and stray notification subjects that
// slipped through the query-level filter.
const SKIP_SENDER_NAMES = [
    'joe bryant',
];
function shouldSkipBySender(fromName, fromEmail) {
    const n = (fromName || '').toLowerCase().trim();
    if (n && SKIP_SENDER_NAMES.some(s => n === s || n.startsWith(s + ' ') || n.includes(' ' + s))) return true;
    return false;
}

/**
 * Centralised CRM_NEEDS_REVIEW labeling + Slack escalation (skill §3.1).
 *
 * Every NEEDS_REVIEW label MUST be accompanied by a Slack ping to the
 * inbox owner so the message gets human eyes the same day instead of
 * sitting silent. Pings route via getOwnerSlackWebhook(inbox.owner) →
 * fallback SLACK_WEBHOOK_URL.
 *
 * @param {object} args
 * @param {object} args.parsed   — output of parseMessage; may be null when we
 *                                  only have a Gmail message ref (fatal-throw path).
 * @param {string} args.messageId — fallback id when `parsed` is missing.
 * @param {object} args.inbox     — { owner, email } from listActiveInboxes
 * @param {string} args.accessToken
 * @param {string} args.reason    — short string explaining why we flipped to NEEDS_REVIEW
 *                                  (e.g. "extraction failed after retries", "primary CRM write threw").
 */
async function flagNeedsReview({ parsed, messageId, inbox, accessToken, reason }) {
    const id = (parsed && parsed.id) || messageId;
    if (!id) return;
    await applyLabel(id, 'CRM_NEEDS_REVIEW', accessToken)
        .catch(e => console.error('label NEEDS_REVIEW failed:', e.message));
    try {
        const webhookUrl = getOwnerSlackWebhook(inbox && inbox.owner) || process.env.SLACK_WEBHOOK_URL;
        if (!webhookUrl) return;
        const subject = parsed && parsed.subject ? parsed.subject : '(no subject)';
        const fromName = parsed && parsed.from && parsed.from.name ? parsed.from.name : '';
        const fromEmail = parsed && parsed.from && parsed.from.email ? parsed.from.email : '';
        const fromLine = fromEmail ? `${fromName} <${fromEmail}>`.trim() : '(unknown sender)';
        const snippet = parsed && parsed.plainText
            ? parsed.plainText.slice(0, 200)
            : (parsed && parsed.snippet ? parsed.snippet.slice(0, 200) : '');
        const threadOrMsg = (parsed && parsed.threadId) || id;
        const text = [
            `🚨 *CRM_NEEDS_REVIEW* — ${reason || 'Manual review needed — extraction failed after retries'}`,
            `*Subject:* ${truncate(subject, 100)}`,
            `*From:* ${fromLine}`,
            snippet ? `*Snippet:* ${snippet}` : null,
            `<https://mail.google.com/mail/u/0/#all/${threadOrMsg}|Open in Gmail →> · <https://www.homesinsoflorida.com/crm|Open CRM →>`,
            `_Manual review needed — extraction failed after retries._`,
        ].filter(Boolean).join('\n');
        await sendSlackMessage({ webhookUrl, text });
    } catch (slackErr) {
        console.error('flagNeedsReview Slack failed:', slackErr.message);
    }
}

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            },
        });
    }

    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get('authorization') || '';
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return json({ error: 'Unauthorized' }, 401);
    }

    const startedAt = Date.now();
    const results = {
        inboxes: 0, messagesScanned: 0, matched: 0, unmatched: 0,
        skipped: 0, errors: 0, writes: 0, multiRecordWrites: 0, perInbox: [],
    };

    let inboxes = [];
    try { inboxes = await listActiveInboxes(); } catch (err) { return json({ error: err.message }, 500); }
    results.inboxes = inboxes.length;
    if (inboxes.length === 0) return json({ ok: true, message: 'No active inboxes', results });

    let emailIndex;
    try { emailIndex = await getEmailIndex(); } catch (err) { return json({ error: `CRM index failed: ${err.message}` }, 500); }

    const reqUrl = new URL(req.url);
    // `reprocess` accepts one of:
    //   needs_review → target label:CRM_NEEDS_REVIEW (default backlog clear)
    //   processed    → target label:CRM_PROCESSED   (re-run already-handled emails after a logic fix)
    //   unmatched    → target label:CRM_UNMATCHED
    const reprocessRaw = (reqUrl.searchParams.get('reprocess') || '').toLowerCase();
    const reprocessLabelMap = {
        needs_review: 'CRM_NEEDS_REVIEW',
        processed: 'CRM_PROCESSED',
        unmatched: 'CRM_UNMATCHED',
    };
    const reprocessLabel = reprocessLabelMap[reprocessRaw];
    const reprocessMode = !!reprocessLabel;
    const sinceRaw = (reqUrl.searchParams.get('since') || (reprocessMode ? '7d' : '2h')).toLowerCase();
    const sinceClean = sinceRaw.replace(/[^a-z0-9]/g, '') || '2h';

    // Sender + subject denylist (banks, social, sports, lead-form notifications).
    // Applied to normal queries only; reprocess modes target specific labels
    // and shouldn't filter further (Kevin might want to reprocess a noisy
    // sender he just realized was misclassified).
    const skipFragment = buildSkipQueryFragment();

    // Normal mode INCLUDES CRM_NEEDS_REVIEW labeled messages so the cron
    // automatically retries them (§22 + 2026-05-19 fix). A post-fetch
    // age filter (NEEDS_REVIEW_RETRY_MIN_AGE_MS / MAX_AGE_MS) ensures we
    // only retry messages between 1h and 24h old — too-fresh ones get a
    // chance to settle, too-stale ones are left for manual review or the
    // daily audit. Without this filter, NEEDS_REVIEW labeled messages
    // would loop forever every 5 minutes.
    const query = reprocessMode
        ? `(in:inbox OR in:sent) newer_than:${sinceClean} label:${reprocessLabel} -label:CRM_REPROCESSED`
        : `(in:inbox OR in:sent) -category:promotions ${skipFragment} newer_than:${sinceClean} -label:CRM_PROCESSED -label:CRM_UNMATCHED -label:CRM_NO_TEAM`;

    // Cache deal/listing/client lists once per run (used for team-discussion fallback)
    let cachedClientList, cachedDealList, cachedListings;
    const ensureContextLists = async () => {
        if (cachedClientList) return;
        const [clients, deals, listings] = await Promise.all([
            getClientList(), getDealList(), getRosaListings(),
        ]);
        cachedClientList = clients; cachedDealList = deals; cachedListings = listings;
    };

    for (const inbox of inboxes) {
        const inboxResult = {
            email: inbox.email, owner: inbox.owner,
            scanned: 0, matched: 0, unmatched: 0, skipped: 0,
            errors: 0, writes: 0, multiRecordWrites: 0,
        };
        const pollingInboxEmail = (inbox.email || '').toLowerCase();

        let accessToken;
        try { accessToken = await refreshAccessToken(inbox.refreshToken); }
        catch (err) {
            inboxResult.errors++;
            inboxResult.error = `token refresh: ${err.message}`;
            results.errors++;
            results.perInbox.push(inboxResult);
            continue;
        }

        // Ongoing category labeling. Pure heuristic (no Sonnet) so this stays
        // cheap. Tight window (15m) + cap (10) means the pass adds <2 seconds
        // to each cron run. Skipped in reprocess mode.
        if (!reprocessMode) {
            try {
                const cat = await applyOngoingCategoryLabels(accessToken, emailIndex);
                inboxResult.categoryLabeled = cat.labeled;
                results.categoryLabeled = (results.categoryLabeled || 0) + cat.labeled;
            } catch (err) {
                console.error('[category-label] pass failed:', err.message);
            }
        }

        // Reprocess batches are capped tight (8) so we stay under the 60s
        // Edge timeout even when every email triggers Sonnet retries. Normal
        // poll keeps 20 because steady-state most messages already short-circuit.
        let messages;
        try { messages = await listRecentMessages(accessToken, query, reprocessMode ? 4 : 6); }
        catch (err) {
            inboxResult.errors++;
            inboxResult.error = `list messages: ${err.message}`;
            results.errors++;
            results.perInbox.push(inboxResult);
            continue;
        }

        // Pre-resolve the CRM_NEEDS_REVIEW label ID once per inbox so the
        // post-fetch retry-window filter can detect NEEDS_REVIEW-labeled
        // messages without round-tripping per message. If resolution fails
        // (first run before any label exists), we just skip the filter —
        // worst case the message processes through normally.
        let needsReviewLabelId = null;
        if (!reprocessMode) {
            try { needsReviewLabelId = await ensureLabel('CRM_NEEDS_REVIEW', accessToken); }
            catch (err) { console.warn(`[needs_review_filter] could not resolve label id: ${err.message}`); }
        }
        // Retry window: only retry NEEDS_REVIEW messages 1h–24h old. Younger
        // than 1h → too fresh, let the human breathe. Older than 24h → leave
        // alone (manual ?reprocess=needs_review or the daily audit handles
        // those). Without this gate the cron would re-process every
        // NEEDS_REVIEW labeled message every 5 minutes forever.
        const NEEDS_REVIEW_RETRY_MIN_AGE_MS = 60 * 60 * 1000;       // 1h
        const NEEDS_REVIEW_RETRY_MAX_AGE_MS = 24 * 60 * 60 * 1000;  // 24h

        for (const msgRef of messages) {
            inboxResult.scanned++;
            results.messagesScanned++;
            try {
                // Reprocess mode: clear the target label + any stale REPROCESSED
                // marker, then re-apply REPROCESSED so subsequent batches in
                // the same job don't re-fetch this thread. Removing REPROCESSED
                // first ensures a thread can't get stuck across runs.
                if (reprocessMode) {
                    await removeLabel(msgRef.id, reprocessLabel, accessToken).catch(() => {});
                    await removeLabel(msgRef.id, 'CRM_REPROCESSED', accessToken).catch(() => {});
                    await applyLabel(msgRef.id, 'CRM_REPROCESSED', accessToken).catch(() => {});
                }

                const raw = await fetchMessage(msgRef.id, accessToken);
                const m = parseMessage(raw);

                // NEEDS_REVIEW retry-window filter (normal mode only).
                // If this message is currently labeled CRM_NEEDS_REVIEW,
                // only re-process when its age is in [1h, 24h]. Outside
                // that window: skip silently so we don't churn on it. The
                // daily audit (§22) handles >24h. <1h gives Kevin / the
                // human a chance to look first.
                if (!reprocessMode && needsReviewLabelId && Array.isArray(m.labelIds)
                    && m.labelIds.includes(needsReviewLabelId)) {
                    const ageMs = m.internalDate ? (Date.now() - m.internalDate) : null;
                    if (ageMs === null || ageMs < NEEDS_REVIEW_RETRY_MIN_AGE_MS || ageMs > NEEDS_REVIEW_RETRY_MAX_AGE_MS) {
                        inboxResult.skipped++; results.skipped++;
                        continue;
                    }
                    // In-window: fall through and re-process. Remove the
                    // NEEDS_REVIEW label up front so the message can pick
                    // up a fresh terminal label (PROCESSED / UNMATCHED /
                    // NEEDS_REVIEW again) without duplicate-labeling.
                    await removeLabel(m.id, 'CRM_NEEDS_REVIEW', accessToken).catch(() => {});
                }

                // Display-name skip (e.g. "Joe Bryant" personal Gmail).
                // Label CRM_PROCESSED so we never re-fetch this sender.
                if (shouldSkipBySender(m.from.name, m.from.email)) {
                    inboxResult.skipped++; results.skipped++;
                    await applyLabel(m.id, 'CRM_PROCESSED', accessToken).catch(e => console.error('label PROCESSED failed:', e.message));
                    continue;
                }

                // Trigger-team gate (Kevin's rule, 2026-05-19):
                // Process ONLY if Noel / Dylan / Rosa is somewhere in the
                // participant set. Kevin's own presence is NOT sufficient.
                // Filtered-out emails get CRM_NO_TEAM so the cron doesn't
                // refetch them on every tick. No CRM write, no Slack ping.
                if (!reprocessMode) {
                    const triggerHit = findTriggerTeamParticipant(m);
                    if (!triggerHit) {
                        console.log(`[trigger-team-gate] skipping ${m.id} (no Noel/Dylan/Rosa on thread): subj="${(m.subject || '').slice(0, 60)}" from="${m.from?.email}"`);
                        inboxResult.skipped++; results.skipped++;
                        await applyLabel(m.id, 'CRM_NO_TEAM', accessToken).catch(e => console.error('label NO_TEAM failed:', e.message));
                        continue;
                    }
                }

                // §8.1 — Thread continuity supersedes confidence (added 2026-05-18).
                // If this Gmail thread is already linked to ≥1 CRM activity row via
                // the Gmail Thread ID field, inherit those parent links and APPEND
                // this message as a continuation note. Skip the full participant-
                // match + Sonnet extraction flow entirely. Bypasses confidence
                // gating, bypasses CRM_NEEDS_REVIEW.
                const continuityLinks = await findExistingThreadLinks(m.threadId);
                if (continuityLinks.length > 0) {
                    const continuityApiKey = process.env.AIRTABLE_API_KEY;
                    const continuityBaseId = process.env.AIRTABLE_BASE_ID;
                    const continuityHeaders = { Authorization: `Bearer ${continuityApiKey}`, 'Content-Type': 'application/json' };
                    const continuationTitle = `Continuation — ${m.from.name || m.from.email}: ${truncate(m.subject || '(no subject)', 80)}`;
                    const continuationDetails = [
                        `• New message in existing thread from ${m.from.name || m.from.email} <${m.from.email}>`,
                        m.subject ? `• Subject: ${m.subject}` : null,
                        m.snippet ? `• Preview: ${truncate(m.snippet, 240)}` : null,
                        (m.attachments && m.attachments.length > 0) ? `• Attachments: ${m.attachments.map(a => a.filename).filter(Boolean).join(', ')}` : null,
                        ``,
                        `Next steps:`,
                        `• Review full message in Gmail`,
                    ].filter(Boolean).join('\n');
                    const continuationLinks = [
                        { label: 'Gmail thread', url: `https://mail.google.com/mail/u/0/#inbox/${m.threadId || m.id}` },
                    ];

                    let continuityWrites = 0;
                    for (const link of continuityLinks) {
                        try {
                            await upsertActivityRow({
                                companyId: link.parentType === 'company' ? link.parentId : null,
                                projectId: link.parentType === 'project' ? link.parentId : null,
                                threadId: m.threadId,
                                title: continuationTitle,
                                type: 'Email Logged',
                                details: continuationDetails,
                                agent: inbox.owner || 'CRM Email Bot',
                                links: continuationLinks,
                                apiKey: continuityApiKey,
                                baseId: continuityBaseId,
                                headers: continuityHeaders,
                            });
                            continuityWrites++;
                        } catch (err) {
                            console.error(`[§8.1] continuation append failed for ${link.parentType}=${link.parentId}:`, err.message);
                        }
                    }
                    if (continuityWrites > 0) {
                        inboxResult.matched++; results.matched++;
                        inboxResult.writes++; results.writes++;
                        await applyLabel(m.id, 'CRM_PROCESSED', accessToken).catch(e => console.error('label PROCESSED failed:', e.message));
                        continue;
                    }
                    // If every continuity write failed, fall through to normal flow as a safety net.
                    console.warn(`[§8.1] all continuation writes failed for thread ${m.threadId}; falling through to participant match`);
                }

                // === BODY-FIRST CLASSIFICATION (skill §4.1, added 2026-05-19) ===
                //
                // Old flow: participant match first; extractTeamDiscussion as
                // fallback for 0-match OR as a secondary pass for internal
                // senders. Problem: Kevin is almost always CC'd or forwarded,
                // so participants are team members → participant-match was
                // weakly informative, and stale Lead rows for people like
                // Maikel routed consulting-topic emails to real-estate Lead
                // notes by accident.
                //
                // New flow:
                //   1. Run extractTeamDiscussion FIRST on every email body.
                //      Sonnet identifies which consulting clients/listings the
                //      body actually discusses. This is the primary classifier.
                //   2. Run participant matching as a SECONDARY signal.
                //   3. Real-estate Lead participant matches are GATED on
                //      Lead writes are HARD-disabled (cron is consulting-only).
                //      Real-estate Leads come from other pipes (save-lead.js,
                //      FB webhook, CINC sync, MLS feed). When a CRM-matched
                //      Lead would otherwise match here, drop it.
                //   4. Consulting-contact / company / dev-project participant
                //      matches whose companyId is ALREADY in body extraction
                //      are deduped — body extraction already wrote them.
                //
                // Trace: 2026-05-19 — Kevin's consulting-topic emails about
                // Mitch/Maikel/Royal/AD1 were landing in Lead.Notes via stale
                // Lead rows or weak participant signal.
                await ensureContextLists();
                const { matchedRecords: rawMatched, internalSender, isForward } = buildParticipantMatches({
                    m, emailIndex, pollingInboxEmail,
                });

                // Step 1: body-first extraction. Sonnet picks the clients.
                let bodyExtracted = null;
                try {
                    bodyExtracted = await extractTeamDiscussion({
                        fromName: m.from.name || m.from.email,
                        subject: m.subject,
                        plainTextBody: m.plainText,
                        clientList: cachedClientList,
                        dealList: cachedDealList,
                        listings: cachedListings,
                    });
                } catch (err) {
                    console.error(`[body-first] extractTeamDiscussion failed for msg ${m.id}:`, err.message);
                    // Don't NEEDS_REVIEW yet — participant matching may still
                    // produce a write below. Only escalate if BOTH paths empty.
                }

                // Step 2: gate participant matches.
                //   - ALWAYS drop Lead participant matches. The email cron is
                //     CONSULTING-FIRST: real-estate Leads are created/updated
                //     via OTHER pipes (api/save-lead.js, FB webhook, CINC sync,
                //     MLS feed). The cron should NEVER write to Lead.Notes
                //     from inbox email — that's how Maikel-as-buyer happens.
                //     If a contact is genuinely both a Lead AND a consulting
                //     contact, the consulting write captures the activity;
                //     the Lead row stays untouched by this cron.
                //   - Drop consulting matches whose companyId is already
                //     covered by body extraction (body extraction wrote the
                //     parent timeline; participant write would duplicate).
                const bodyCompanyIds = new Set(
                    (bodyExtracted?.clientReferences || []).map(r => r.companyId).filter(Boolean)
                );
                const matchedRecords = rawMatched.filter(r => {
                    if (r.recordType === 'lead') {
                        console.log(`[body-first] dropping Lead match ${r.recordName} (cron is consulting-only; Leads handled by other pipes)`);
                        return false;
                    }
                    // Consulting / dev-project: drop if body already covers parent.
                    const parentId = r.companyId || r.projectId || r.recordId;
                    if (parentId && bodyCompanyIds.has(parentId)) {
                        console.log(`[body-first] deduping participant match ${r.recordName} — already in body extraction`);
                        return false;
                    }
                    return true;
                });

                // Step 3: write body extraction (primary path).
                let bodySummary = null;
                if (bodyExtracted) {
                    try {
                        bodySummary = await writeTeamDiscussion({
                            email: m, extracted: bodyExtracted, inbox, listings: cachedListings,
                        });
                    } catch (err) {
                        console.error(`[body-first] writeTeamDiscussion failed for msg ${m.id}:`, err.message);
                    }
                }

                // Step 4: branching on whether anything was actually written.
                if (matchedRecords.length === 0) {
                    // 0 secondary matches. Did body extraction write anything?
                    if (bodySummary && bodySummary.wroteSomething) {
                        inboxResult.matched++; results.matched++;
                        inboxResult.writes++; results.writes++;
                        await applyLabel(m.id, 'CRM_PROCESSED', accessToken).catch(e => console.error('label PROCESSED failed:', e.message));
                        // Route to Owner of the first referenced client.
                        const firstClientId = bodySummary.clientReferences?.[0]?.companyId;
                        const firstClientOwner = firstClientId
                            ? cachedClientList.find(c => c.id === firstClientId)?.owner
                            : null;
                        const slackOwner = firstClientOwner || inbox.owner || 'Email Bot';
                        await notifyOwnerConsolidated({
                            owner: slackOwner,
                            mode: 'team-discussion',
                            email: m,
                            matchedRecords: [],
                            extractedTeam: bodyExtracted,
                            teamSummary: bodySummary,
                            primaryWrite: null,
                            duplicatesCount: 0,
                        }).catch(err => console.error('Slack ping failed:', err.message));
                    } else {
                        // Neither body nor participants produced anything.
                        if (internalSender) {
                            inboxResult.unmatched++; results.unmatched++;
                            await flagNeedsReview({
                                parsed: m, inbox, accessToken,
                                reason: 'Team-sender email — body extraction empty and no participant match',
                            });
                        } else {
                            inboxResult.unmatched++; results.unmatched++;
                            await applyLabel(m.id, 'CRM_UNMATCHED', accessToken).catch(e => console.error('label UNMATCHED failed:', e.message));
                        }
                    }
                    continue;
                }

                // ≥1 secondary match path: extractEmailUpdate once with primary as crmContext
                const primary = matchedRecords[0];
                const others = matchedRecords.slice(1);

                let extracted;
                try {
                    extracted = await extractEmailUpdate({
                        fromEmail: m.from.email,
                        fromName: m.from.name,
                        subject: m.subject,
                        plainTextBody: m.plainText,
                        attachments: m.attachments || [],
                        crmContext: {
                            recordType: primary.recordType,
                            recordId: primary.recordId,
                            recordName: primary.recordName,
                            currentStatus: primary.currentStatus,
                            companyName: primary.companyName,
                        },
                        otherMatchedRecords: others.map(r => ({
                            recordName: r.recordName,
                            companyName: r.companyName,
                            role: r.role,
                        })),
                    });
                } catch (err) {
                    console.error(`extractEmailUpdate failed for msg ${m.id}:`, err.message);
                    extracted = {
                        summary: m.subject || '(no subject)',
                        noteText: `• Email from ${m.from.name || m.from.email}: ${m.subject || '(no subject)'}\n• (Auto-summary failed — review email directly)\n\nNext steps:\n• Open in Gmail`,
                        confidence: 'low',
                        reminders: [],
                        attachmentClassifications: (m.attachments || []).map(a => ({
                            filename: a.filename,
                            category: classifyByHeuristic(a.filename, a.mimeType),
                        })),
                    };
                    inboxResult.errors++; results.errors++;
                }

                // Write to primary + every other matched record
                let primaryResult;
                const duplicateResults = [];
                try {
                    primaryResult = await writeCrmUpdate({
                        match: primary, extracted, inbox, email: m, accessToken,
                        isPrimary: true,
                        otherMatchedRecords: others,
                        isForward,
                    });
                    inboxResult.writes++; inboxResult.matched++;
                    results.writes++; results.matched++;
                } catch (err) {
                    console.error(`CRM write (primary) failed for msg ${m.id}:`, err.message);
                    inboxResult.errors++; results.errors++;
                    await flagNeedsReview({
                        parsed: m, inbox, accessToken,
                        reason: `Primary CRM write failed: ${err.message}`,
                    });
                    continue;
                }

                // Multi-record duplication: write to each OTHER record's
                // timeline. BUT dedup by parent (companyId/projectId) — if
                // multiple matched contacts share the same parent (e.g. 4 GPs
                // on the same Belle Meade Dev Project), the primary write
                // already covered the parent's timeline. Skip the rest.
                const seenParents = new Set();
                const primaryParent = primary.projectId || primary.companyId || primary.recordId;
                if (primaryParent) seenParents.add(primaryParent);
                for (const other of others) {
                    const otherParent = other.projectId || other.companyId || other.recordId;
                    if (otherParent && seenParents.has(otherParent)) continue; // already logged on this parent
                    if (otherParent) seenParents.add(otherParent);
                    try {
                        const r = await writeCrmUpdate({
                            match: other, extracted, inbox, email: m, accessToken,
                            isPrimary: false,
                            otherMatchedRecords: matchedRecords.filter(x => x.recordId !== other.recordId),
                            isForward,
                        });
                        duplicateResults.push(r);
                        inboxResult.multiRecordWrites++;
                        results.multiRecordWrites++;
                    } catch (err) {
                        console.error(`CRM write (duplicate ${other.recordName}) failed for msg ${m.id}:`, err.message);
                    }
                }

                // Body-first refactor (2026-05-19): team-discussion ALREADY
                // ran at the top of this branch (`bodyExtracted` / `bodySummary`).
                // No second call needed. Pass those into Slack for the
                // consolidated ping.

                await applyLabel(m.id, 'CRM_PROCESSED', accessToken).catch(e => console.error('label processed failed:', e));

                // Per-client-Owner Slack routing: ping the Owner of the
                // matched primary record (Toyosa→Noel, AD1→Dylan, etc.). Falls
                // back to inbox owner if the matched record has no Owner set.
                const slackOwner = primary.owner || inbox.owner || 'Email Bot';
                await notifyOwnerConsolidated({
                    owner: slackOwner,
                    mode: 'direct',
                    email: m,
                    matchedRecords,
                    extractedTeam: bodyExtracted,
                    teamSummary: bodySummary,
                    primaryWrite: primaryResult,
                    duplicatesCount: duplicateResults.length,
                }).catch(err => console.error('Slack ping failed:', err.message));
            } catch (err) {
                console.error(`Message ${msgRef.id} fatal:`, err.message);
                inboxResult.errors++; results.errors++;
                // CRITICAL: must apply NEEDS_REVIEW on ANY uncaught throw,
                // otherwise reprocess mode (which strips the label up front)
                // leaves the message unlabeled → refetched forever on next
                // cron pass. Helper does both labeling + Slack ping; parsed
                // may not exist (throw may have happened before parseMessage).
                await flagNeedsReview({
                    parsed: null, messageId: msgRef.id, inbox, accessToken,
                    reason: `Uncaught exception while processing message: ${err.message}`,
                });
            }
        }

        await stampLastPolled(inbox.id);
        results.perInbox.push(inboxResult);
    }

    results.elapsedMs = Date.now() - startedAt;
    results.mode = reprocessMode ? 'reprocess_needs_review' : 'normal';
    return json({ ok: true, results });
}

/**
 * Build the set of matched CRM records for an email.
 *
 * Considers: FROM, Reply-To, every TO/CC/BCC, plus addresses found in
 * forwarded-body From/To/Cc lines if it looks like a forward. Drops noreply
 * + drops the polling inbox itself.
 *
 * Returns deduped records sorted by role priority (sender > recipient > cc >
 * forwarded). Multiple participants resolving to the same CRM recordId are
 * collapsed to one entry, keeping the highest-priority role.
 */
function buildParticipantMatches({ m, emailIndex, pollingInboxEmail }) {
    const fromEmail = (m.from?.email || '').toLowerCase();
    const fromDomain = fromEmail.split('@')[1] || '';
    const internalSender = isInternalDomain(fromDomain);
    const isForward = internalSender && isForwardSubject(m.subject);

    const rolePriority = { sender: 0, recipient: 1, cc: 2, bcc: 3, forwarded: 4 };

    // Build candidate participant list with role tags
    const candidates = [];
    const addCandidate = (email, role) => {
        const e = (email || '').toLowerCase().trim();
        if (!e || !e.includes('@')) return;
        const local = e.split('@')[0];
        if (isNoreplyLocal(local)) return;
        if (e === pollingInboxEmail) return; // don't match against own inbox
        // CRITICAL: never match team-member emails to CRM records. Noel/Dylan/
        // Rosa are admins, not leads/contacts. When they're a participant on
        // an email, the email body decides which client(s) the activity
        // belongs to (team-discussion path), not the team member.
        if (isTeamMemberEmail(e)) return;
        candidates.push({ email: e, role });
    };

    addCandidate(fromEmail, 'sender');
    if (m.replyTo?.email) addCandidate(m.replyTo.email, 'sender');
    for (const a of (m.toList || [])) addCandidate(a.email, 'recipient');
    for (const a of (m.ccList || [])) addCandidate(a.email, 'cc');
    for (const a of (m.bccList || [])) addCandidate(a.email, 'bcc');

    if (isForward) {
        const forwarded = parseForwardedSenders(m.plainText, INTERNAL_DOMAINS);
        for (const f of forwarded) {
            // Map forwarded sub-role into our role bucket (from→sender within
            // the embedded thread; everyone else is forwarded-participant).
            const role = f.role === 'from' ? 'forwarded' : 'forwarded';
            addCandidate(f.email, role);
        }
    }

    // Match each candidate against the CRM email index.
    // Note: emailIndex.get() can return EITHER a single entry OR an array
    // (multi-project dev partners). Normalize to an array per candidate.
    const byRecordId = new Map();
    for (const c of candidates) {
        const raw = emailIndex.get(c.email);
        if (!raw) continue;
        const matches = Array.isArray(raw) ? raw : [raw];
        for (const match of matches) {
            const existing = byRecordId.get(match.recordId);
            if (!existing) {
                byRecordId.set(match.recordId, { ...match, role: c.role, matchedVia: c.email });
            } else {
                if (rolePriority[c.role] < rolePriority[existing.role]) {
                    existing.role = c.role;
                    existing.matchedVia = c.email;
                }
            }
        }
    }

    const matchedRecords = [...byRecordId.values()].sort(
        (a, b) => rolePriority[a.role] - rolePriority[b.role]
    );

    return { matchedRecords, internalSender, isForward };
}

/**
 * Write an extracted email note to a CRM record (Lead or Consulting Contact/Company).
 * Used for both the primary record and any duplicates.
 *
 * When isPrimary=true: writes note + uploads attachments + creates reminders.
 * When isPrimary=false: writes note ONLY. Attachments + reminders are NOT
 * duplicated (they live on the primary record). The note mentions other
 * matched records in a "Also logged to:" line for cross-reference.
 */
async function writeCrmUpdate({ match, extracted, inbox, email, accessToken, isPrimary, otherMatchedRecords, isForward }) {
    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    if (!apiKey || !baseId) throw new Error('Airtable not configured');

    const agent = inbox.owner || 'Email Bot';
    const headers = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
    };

    const writeSummary = {
        noteWritten: false,
        attachmentsUploaded: [],
        attachmentsFailed: [],
        remindersCreated: [],
    };

    // Compose the note body. Per Kevin's preferences:
    //   - NO `[via Gmail/...]` prefix (don't tell him where it came from in every note)
    //   - Bullet-formatted Sonnet output goes first
    //   - Quiet metadata footer: subject, forward provenance, cross-refs, thread token
    const attachmentNames = (email.attachments || []).map(a => a.filename);
    const subjectLine = email.subject ? `Subject: "${truncate(email.subject, 100)}"` : '';
    const forwardLine = isForward ? `Forwarded by ${email.from.email}` : '';
    const attachLine = attachmentNames.length > 0
        ? `Attachments: ${attachmentNames.join(', ')}${isPrimary ? '' : ' (see primary record)'}`
        : '';
    const crossRefLine = otherMatchedRecords && otherMatchedRecords.length > 0
        ? `Also logged to: ${otherMatchedRecords.map(r => r.recordName).join(', ')}`
        : '';
    const threadToken = email.threadId ? `[thread: ${email.threadId}]` : '';

    const metaLines = [subjectLine, forwardLine, attachLine, crossRefLine, threadToken].filter(Boolean);
    const meta = metaLines.length > 0 ? `\n\n— ${metaLines.join(' · ')}` : '';
    const note = `${extracted.noteText || ''}${meta}`;

    if (match.recordType === 'lead') {
        const cur = await fetch(`https://api.airtable.com/v0/${baseId}/Leads/${match.recordId}`, { headers });
        if (!cur.ok) throw new Error(`Lead ${match.recordId} not found`);
        const existing = (await cur.json()).fields?.['Notes'] || '';
        const dateStr = nowDateStr();
        const entry = `[${dateStr} — ${agent}] ${note}`;
        const newNotes = existing ? `${entry}\n\n${existing}` : entry;
        const patchRes = await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
            method: 'PATCH', headers,
            body: JSON.stringify({ records: [{ id: match.recordId, fields: { 'Notes': newNotes } }] }),
        });
        if (!patchRes.ok) throw new Error(`Lead PATCH: ${(await patchRes.json().catch(() => ({}))).error?.message || patchRes.status}`);
        writeSummary.noteWritten = true;
    } else if (match.recordType === 'consulting-contact') {
        if (!match.companyId) throw new Error('contact has no companyId');
        const title = `Email ${match.role === 'sender' ? 'from' : 'with'} ${match.recordName}: ${truncate(extracted.summary || email.subject || '(no subject)', 200)}`;
        await upsertActivityRow({
            companyId: match.companyId,
            companyName: match.companyName,
            threadId: email.threadId,
            title: title.slice(0, 250),
            type: 'Email Logged',
            details: note,
            agent,
            links: extracted.links || [],
            apiKey, baseId, headers,
        });
        writeSummary.noteWritten = true;
    } else if (match.recordType === 'development-project') {
        if (!match.projectId) throw new Error('dev-project contact has no projectId');
        const title = `Email ${match.role === 'sender' ? 'from' : 'with'} ${match.recordName}: ${truncate(extracted.summary || email.subject || '(no subject)', 200)}`;
        await upsertActivityRow({
            projectId: match.projectId,
            projectName: match.projectName,
            threadId: email.threadId,
            title: title.slice(0, 250),
            type: 'Email Logged',
            details: note,
            agent,
            links: extracted.links || [],
            apiKey, baseId, headers,
        });
        writeSummary.noteWritten = true;
    } else {
        throw new Error(`Unknown recordType: ${match.recordType}`);
    }

    // Attachments + reminders ONLY on primary
    if (!isPrimary) return writeSummary;

    if ((email.attachments || []).length > 0) {
        const classMap = new Map();
        for (const c of (extracted.attachmentClassifications || [])) classMap.set(c.filename, c.category);

        for (const att of email.attachments) {
            try {
                const base64 = await fetchAttachment(email.id, att.attachmentId, accessToken);
                const category = classMap.get(att.filename) || classifyByHeuristic(att.filename, att.mimeType);

                if (match.recordType === 'lead') {
                    await uploadAirtableAttachment({ recordId: match.recordId, field: 'Documents', filename: att.filename, contentType: att.mimeType, base64, apiKey, baseId });
                    writeSummary.attachmentsUploaded.push({ filename: att.filename, category: 'Documents' });
                } else {
                    await uploadAirtableAttachment({ recordId: match.companyId, field: category, filename: att.filename, contentType: att.mimeType, base64, apiKey, baseId });
                    writeSummary.attachmentsUploaded.push({ filename: att.filename, category });
                }
            } catch (err) {
                console.error(`Attachment upload failed (${att.filename}):`, err.message);
                writeSummary.attachmentsFailed.push({ filename: att.filename, reason: err.message });
            }
        }
    }

    if (Array.isArray(extracted.reminders) && extracted.reminders.length > 0) {
        for (const rem of extracted.reminders) {
            try {
                if (match.recordType === 'lead') {
                    await createLeadReminder({
                        leadRecordId: match.recordId,
                        leadName: match.recordName,
                        leadEmail: email.from.email,
                        title: rem.title,
                        actionType: rem.actionType,
                        dueAt: rem.dueAt,
                        note: rem.note,
                        agent,
                        apiKey, baseId,
                    });
                } else {
                    await createConsultingTask({
                        companyId: match.companyId,
                        title: rem.title,
                        type: rem.actionType,
                        dueAt: rem.dueAt,
                        notes: rem.note,
                        owner: agent,
                        apiKey, baseId,
                    });
                }
                writeSummary.remindersCreated.push(rem);
            } catch (err) {
                console.error(`Reminder create failed (${rem.title}):`, err.message);
            }
        }
    }

    return writeSummary;
}

/**
 * Write the structured output of extractTeamDiscussion to Airtable.
 * Used in two cases:
 *   (a) 0 participant matches → this is the only write path
 *   (b) ≥2 participant matches with internal sender → catches tasks/meetings
 *       AND cross-references to OTHER clients the body mentions (excluded
 *       from re-noting the already-matched records via excludeCompanyIds).
 *
 * Returns a summary used by the Slack notifier.
 */
async function writeTeamDiscussion({ email: m, extracted, inbox, listings = [] }) {
    if (!extracted) return { wroteSomething: false };

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const agent = inbox.owner || 'Email Bot';
    const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    const subjectLine = m.subject ? ` Re: "${truncate(m.subject, 80)}"` : '';
    const fromLabel = `${m.from.name || m.from.email}`;
    const threadToken = m.threadId ? ` [thread: ${m.threadId}]` : '';

    const summary = {
        clientNotesWritten: 0,
        listingNotesWritten: 0,
        tasksCreated: [],
        meetingsCreated: [],
        clientReferences: extracted.clientReferences || [],
        listingReferences: extracted.listingReferences || [],
        newClientsCreated: [],
        newDealsCreated: [],         // {dealName, companyId, id}
        dealsDupSkipped: [],         // {dealName, companyId, existingDealName, existingId, evidence}
        newContactsCreated: [],      // {name, companyId, id}
        contactsDupSkipped: [],      // {name, companyId, existingId, evidence, matchedBy}
        wroteSomething: false,
    };

    // (0) Auto-create high-confidence new client candidates.
    // First skip any candidate whose name matches an existing Development
    // Project (e.g. "Belle Meade Investments LLC") — those have their own
    // table and shouldn't be duplicated as Consulting Clients.
    let devProjectNames = new Set();
    try {
        const dpRes = await fetch(`https://api.airtable.com/v0/${baseId}/Development%20Projects?fields%5B%5D=Project%20Name&pageSize=100`, { headers });
        if (dpRes.ok) {
            const dpData = await dpRes.json();
            for (const p of (dpData.records || [])) {
                const nm = (p.fields?.['Project Name'] || '').trim().toLowerCase();
                if (nm) devProjectNames.add(nm);
            }
        }
    } catch (e) { /* non-fatal — proceed without filter */ }

    for (const cand of (extracted.newClientCandidates || [])) {
        if (cand.confidence !== 'high') continue;
        const candNameLc = (cand.name || '').trim().toLowerCase();
        if (devProjectNames.has(candNameLc)) {
            console.log(`[team-discussion] skipping auto-create of "${cand.name}" — already exists as Development Project`);
            continue;
        }
        try {
            const createRes = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Clients`, {
                method: 'POST', headers,
                body: JSON.stringify({
                    records: [{
                        fields: {
                            'Company': cand.name,
                            'Type': 'Client',
                            'Status': 'Lead',
                            'Owner': agent,
                            'Source': `Auto-created from team email by ${fromLabel}`,
                            'Country': cand.country || '',
                            'Primary Contact': cand.primaryContact || '',
                            'Notes': `[${nowDateStr()} — ${agent}] AUTO-CREATED from team email: ${cand.evidence || '(no detail)'}`,
                            'Started At': new Date().toISOString().slice(0, 10),
                        },
                    }],
                    typecast: true,
                }),
            });
            if (createRes.ok) {
                const data = await createRes.json();
                const newId = data.records?.[0]?.id;
                if (newId) {
                    summary.newClientsCreated.push({ name: cand.name, id: newId, evidence: cand.evidence });
                    extracted.clientReferences.push({
                        companyId: newId, companyName: cand.name, excerpt: cand.evidence || '',
                    });
                }
            } else {
                const err = await createRes.json().catch(() => ({}));
                console.error(`Auto-create client '${cand.name}' failed:`, err.error?.message || createRes.status);
            }
        } catch (err) {
            console.error(`Auto-create client exception (${cand.name}):`, err.message);
        }
    }

    // (0.5) Auto-create high-confidence new DEAL candidates.
    // Skips when an OPEN deal (Pitching / Proposal Sent / Verbal Commitment /
    // Signed / Active) already exists under the same company with a name
    // that overlaps. On a skip, the Slack ping below surfaces the candidate
    // + existing match so Kevin can decide manually. NEVER pass dealValue /
    // fees / probability — those are Kevin's call. Trace: 2026-05-19 MR9
    // cleanup — Sonnet extracted $2.4M/$2.4M/$9M/$150K from prose, creating
    // 4 phantom Royal deals on top of 1 real engagement.
    const OPEN_DEAL_STAGES = new Set(['Pitching', 'Proposal Sent', 'Verbal Commitment', 'Signed', 'Active']);
    const normalizeDealName = (s) => (s || '').toLowerCase().normalize('NFD')
        .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
    for (const cand of (extracted.newDealCandidates || [])) {
        if (cand.confidence !== 'high') continue;
        // Look up existing open deals under this company
        try {
            const dealsFilter = `AND(FIND('${cand.companyId}', ARRAYJOIN({Company})), OR(${[...OPEN_DEAL_STAGES].map(s => `{Stage}='${s}'`).join(',')}))`;
            const dealsRes = await fetch(
                `https://api.airtable.com/v0/${baseId}/Consulting%20Deals?filterByFormula=${encodeURIComponent(dealsFilter)}&maxRecords=50`,
                { headers: { 'Authorization': `Bearer ${apiKey}` } },
            );
            const candNorm = normalizeDealName(cand.dealName);
            let dupHit = null;
            if (dealsRes.ok) {
                const dealsData = await dealsRes.json();
                for (const rec of (dealsData.records || [])) {
                    const existingNorm = normalizeDealName(rec.fields?.['Deal Name']);
                    if (!existingNorm || !candNorm) continue;
                    const exact = existingNorm === candNorm;
                    const sub   = (candNorm.length >= 10 && existingNorm.includes(candNorm))
                               || (existingNorm.length >= 10 && candNorm.includes(existingNorm));
                    if (exact || sub) {
                        dupHit = { id: rec.id, name: rec.fields?.['Deal Name'] };
                        break;
                    }
                }
            }
            if (dupHit) {
                summary.dealsDupSkipped.push({
                    dealName: cand.dealName,
                    companyId: cand.companyId,
                    existingDealName: dupHit.name,
                    existingId: dupHit.id,
                    evidence: cand.evidence,
                });
                console.log(`[newDealCandidates] skipped "${cand.dealName}" — overlaps existing open deal "${dupHit.name}" (${dupHit.id})`);
                continue;
            }
            // No dup → create with NO dollar fields. Kevin fills in later.
            const createRes = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Deals`, {
                method: 'POST', headers,
                body: JSON.stringify({
                    records: [{
                        fields: {
                            'Deal Name': cand.dealName,
                            'Company':   [cand.companyId],
                            'Stage':     'Pitching',
                            'Stage Entered At': new Date().toISOString().slice(0, 10),
                            'Description': `[${nowDateStr()} — ${agent}] AUTO-CREATED from team email: ${cand.evidence || '(no detail)'}\n\nFEE STRUCTURE: TBD — Kevin to fill in dealValue / diagnosticFee / monthlyRecurringFee / probability. Cron never extracts these from prose.`,
                            'Owner':     agent || '',
                        },
                    }],
                    typecast: true,
                }),
            });
            if (createRes.ok) {
                const d = await createRes.json();
                const newId = d.records?.[0]?.id;
                if (newId) summary.newDealsCreated.push({ dealName: cand.dealName, companyId: cand.companyId, id: newId, evidence: cand.evidence });
            } else {
                const err = await createRes.json().catch(() => ({}));
                console.error(`Auto-create deal '${cand.dealName}' failed:`, err.error?.message || createRes.status);
            }
        } catch (err) {
            console.error(`Auto-create deal exception (${cand.dealName}):`, err.message);
        }
    }

    // (0.7) Auto-create high-confidence new CONTACT candidates.
    // Dedup on email (exact, case-insensitive) then normalized name within
    // the same company. Same trace as above — 2026-05-19 cleanup removed 18
    // duplicate contacts that were inserted because no upstream check ran.
    const normalizeContactName = (s) => (s || '').toLowerCase().normalize('NFD')
        .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
    for (const cand of (extracted.newContactCandidates || [])) {
        if (cand.confidence !== 'high') continue;
        try {
            const contactsFilter = `FIND('${cand.companyId}', ARRAYJOIN({Company}))`;
            const contactsRes = await fetch(
                `https://api.airtable.com/v0/${baseId}/Consulting%20Contacts?filterByFormula=${encodeURIComponent(contactsFilter)}&maxRecords=100`,
                { headers: { 'Authorization': `Bearer ${apiKey}` } },
            );
            const candEmail = (cand.email || '').toLowerCase().trim();
            const candName  = normalizeContactName(cand.name);
            let dupHit = null;
            if (contactsRes.ok) {
                const contactsData = await contactsRes.json();
                for (const rec of (contactsData.records || [])) {
                    const existingEmail = (rec.fields?.Email || '').toLowerCase().trim();
                    const existingName  = normalizeContactName(rec.fields?.Name);
                    const emailMatch = candEmail && existingEmail && existingEmail === candEmail;
                    const nameMatch  = !candEmail && candName && existingName && existingName === candName;
                    if (emailMatch || nameMatch) {
                        dupHit = { id: rec.id, name: rec.fields?.Name, matchedBy: emailMatch ? 'email' : 'name' };
                        break;
                    }
                }
            }
            if (dupHit) {
                summary.contactsDupSkipped.push({
                    name: cand.name,
                    companyId: cand.companyId,
                    existingId: dupHit.id,
                    evidence: cand.evidence,
                    matchedBy: dupHit.matchedBy,
                });
                console.log(`[newContactCandidates] skipped "${cand.name}" — matches existing "${dupHit.name}" by ${dupHit.matchedBy}`);
                continue;
            }
            // No dup → create
            const createRes = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Contacts`, {
                method: 'POST', headers,
                body: JSON.stringify({
                    records: [{
                        fields: {
                            'Name':    cand.name,
                            'Company': [cand.companyId],
                            'Email':   cand.email || '',
                            'Role':    cand.role || '',
                            'Notes':   `[${nowDateStr()} — ${agent}] AUTO-ADDED from team email: ${cand.evidence || '(no detail)'}`,
                        },
                    }],
                    typecast: true,
                }),
            });
            if (createRes.ok) {
                const d = await createRes.json();
                const newId = d.records?.[0]?.id;
                if (newId) summary.newContactsCreated.push({ name: cand.name, companyId: cand.companyId, id: newId });
            } else {
                const err = await createRes.json().catch(() => ({}));
                console.error(`Auto-create contact '${cand.name}' failed:`, err.error?.message || createRes.status);
            }
        } catch (err) {
            console.error(`Auto-create contact exception (${cand.name}):`, err.message);
        }
    }

    // (1) Client references → Consulting Activity (Type: Note)
    // Dedup clientReferences by companyId — Sonnet sometimes lists the same
    // client twice with different excerpts (e.g. "Royal" + "Polly Lux" both
    // resolving to MR9 Holdings). Without this, we'd write two near-identical
    // Activity rows on the same thread, racing past the upsertActivityRow
    // lookup (Airtable filterByFormula has eventual-consistency lag on very
    // recent inserts).
    const seenCompanyRefs = new Set();
    extracted.clientReferences = extracted.clientReferences.filter(r => {
        if (!r.companyId || seenCompanyRefs.has(r.companyId)) return false;
        seenCompanyRefs.add(r.companyId);
        return true;
    });

    for (const ref of extracted.clientReferences) {
        const noteTitle = `Team note from ${fromLabel}: ${truncate(ref.excerpt || extracted.summary || m.subject || '(no subject)', 200)}`;
        const metaLine = [m.subject ? `Subject: "${truncate(m.subject, 100)}"` : '', m.threadId ? `[thread: ${m.threadId}]` : ''].filter(Boolean).join(' · ');
        const noteBody = `${ref.excerpt || extracted.summary}${metaLine ? `\n\n— ${metaLine}` : ''}`;
        try {
            await upsertActivityRow({
                companyId: ref.companyId,
                companyName: ref.companyName,
                threadId: m.threadId,
                title: noteTitle.slice(0, 250),
                type: 'Note',
                details: noteBody,
                agent,
                links: ref.links || [],
                apiKey, baseId, headers,
            });
            summary.clientNotesWritten++;
        } catch (err) {
            console.error(`Team note write failed for ${ref.companyId}:`, err.message);
        }
    }

    // (1b) Listing references → Listing Notes
    for (const lref of (extracted.listingReferences || [])) {
        try {
            const matched = listings.find(l => String(l.mlsId) === String(lref.listingMlsId));
            const title = `Email note: ${truncate(lref.excerpt || extracted.summary || m.subject || '(no subject)', 200)}`;
            const metaLine = [m.subject ? `Subject: "${truncate(m.subject, 100)}"` : '', m.threadId ? `[thread: ${m.threadId}]` : ''].filter(Boolean).join(' · ');
            const body = `${lref.excerpt || extracted.summary}${metaLine ? `\n\n— ${metaLine}` : ''}`;
            const res = await fetch(`https://api.airtable.com/v0/${baseId}/Listing%20Notes`, {
                method: 'POST', headers,
                body: JSON.stringify({
                    records: [{
                        fields: {
                            'Title': title.slice(0, 250),
                            'MLS ID': String(lref.listingMlsId),
                            'Listing Title': matched?.title || lref.listingTitle || '',
                            'Type': 'Email Logged',
                            'Details': body,
                            'Agent': agent,
                            'Created At': new Date().toISOString(),
                        },
                    }],
                    typecast: true,
                }),
            });
            if (res.ok) summary.listingNotesWritten++;
            else console.error(`Listing note write failed for ${lref.listingMlsId}:`, (await res.json().catch(() => ({}))).error?.message || res.status);
        } catch (err) {
            console.error(`Listing note exception (${lref.listingMlsId}):`, err.message);
        }
    }

    // (2) Tasks
    for (const task of (extracted.tasksAssigned || [])) {
        try {
            await createConsultingTask({
                companyId: task.companyId || (extracted.clientReferences[0]?.companyId),
                title: task.title,
                type: 'Other',
                dueAt: task.dueAt || null,
                notes: task.notes ? `${task.notes}\n\n(Assigned by ${fromLabel} via team email)` : `Assigned by ${fromLabel}`,
                owner: task.assignee,
                apiKey, baseId,
            });
            summary.tasksCreated.push(task);
        } catch (err) {
            console.error(`Team task create failed (${task.title}):`, err.message);
        }
    }

    // (3) Meetings
    for (const meeting of (extracted.meetingsScheduled || [])) {
        try {
            await createConsultingTask({
                companyId: meeting.companyId || (extracted.clientReferences[0]?.companyId),
                title: meeting.title,
                type: 'Meeting',
                dueAt: meeting.dueAt,
                notes: meeting.notes ? `${meeting.notes}\n\n(Set up via team email from ${fromLabel})` : `Set up via team email from ${fromLabel}`,
                owner: agent,
                apiKey, baseId,
            });
            summary.meetingsCreated.push(meeting);
        } catch (err) {
            console.error(`Team meeting create failed (${meeting.title}):`, err.message);
        }
    }

    summary.wroteSomething =
        summary.clientNotesWritten > 0 ||
        summary.listingNotesWritten > 0 ||
        summary.tasksCreated.length > 0 ||
        summary.meetingsCreated.length > 0 ||
        summary.newClientsCreated.length > 0 ||
        summary.newDealsCreated.length > 0 ||
        summary.dealsDupSkipped.length > 0 ||
        summary.newContactsCreated.length > 0 ||
        summary.contactsDupSkipped.length > 0;
    return summary;
}

/**
 * One consolidated Slack ping per processed email. Combines:
 *   - direct-match record list + roles
 *   - secondary team-discussion summary (when applicable)
 *   - new clients, tasks, reminders, attachments
 */
async function notifyOwnerConsolidated({ owner, mode, email, matchedRecords, extractedTeam, teamSummary, primaryWrite, duplicatesCount }) {
    const webhookUrl = getOwnerSlackWebhook(owner);
    if (!webhookUrl) return;

    // Every Slack message starts with a timestamp so Kevin can correlate it
    // with what he sees in CRM. Uses America/New_York 12-hour format.
    const tsStr = new Date().toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        hour12: true, timeZone: 'America/New_York',
    }) + ' ET';

    const lines = [`🕒 ${tsStr}`];

    if (mode === 'direct') {
        lines.push(`🔔 *CRM update for ${owner}*`);
        const labelFor = (r) => {
            if (r.recordType === 'lead') return 'Lead';
            if (r.recordType === 'development-project') return 'Project';
            return 'Company';
        };
        const parentFor = (r) => r.projectName || r.companyName || '';
        if (matchedRecords.length === 1) {
            const r = matchedRecords[0];
            const parent = parentFor(r);
            lines.push(`*${labelFor(r)}:* ${r.recordName}${parent ? ` (${parent})` : ''}`);
            lines.push(`*Role:* ${r.role}`);
        } else {
            lines.push(`*Records updated (${matchedRecords.length}):*`);
            for (const r of matchedRecords) {
                const parent = parentFor(r);
                lines.push(`  • ${labelFor(r)}: ${r.recordName}${parent ? ` (${parent})` : ''} — ${r.role}`);
            }
        }
        lines.push(`*From:* ${email.from.name || email.from.email}`);
        if (email.subject) lines.push(`*Subject:* ${truncate(email.subject, 80)}`);
        lines.push('');
        lines.push('📝 Note logged');
        if (duplicatesCount > 0) lines.push(`📑 Duplicated to ${duplicatesCount} other record${duplicatesCount > 1 ? 's' : ''}`);
        if (primaryWrite?.attachmentsUploaded?.length > 0) {
            const byCat = {};
            for (const a of primaryWrite.attachmentsUploaded) byCat[a.category] = (byCat[a.category] || 0) + 1;
            const parts = Object.entries(byCat).map(([cat, n]) => `${n} → ${cat}`);
            lines.push(`📎 ${primaryWrite.attachmentsUploaded.length} file${primaryWrite.attachmentsUploaded.length > 1 ? 's' : ''}: ${parts.join(', ')}`);
        }
        if (primaryWrite?.attachmentsFailed?.length > 0) {
            lines.push(`⚠️ ${primaryWrite.attachmentsFailed.length} attachment upload(s) failed`);
        }
        if (primaryWrite?.remindersCreated?.length > 0) {
            lines.push(`⏰ ${primaryWrite.remindersCreated.length} reminder${primaryWrite.remindersCreated.length > 1 ? 's' : ''}:`);
            for (const rem of primaryWrite.remindersCreated) {
                const due = new Date(rem.dueAt);
                const dueStr = isNaN(due.getTime()) ? rem.dueAt : due.toLocaleString('en-US', {
                    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                    hour12: true, timeZone: 'America/New_York',
                });
                lines.push(`  • ${rem.actionType}: ${rem.title} — ${dueStr} ET`);
            }
        }
    } else {
        // team-discussion only (0 participant matches)
        lines.push(`📋 *Team discussion — auto-logged to CRM*`);
        lines.push(`*From:* ${email.from.name || email.from.email}`);
        if (email.subject) lines.push(`*Subject:* ${truncate(email.subject, 80)}`);
        lines.push('');
        if (extractedTeam?.summary) lines.push(`_${extractedTeam.summary}_`);
    }

    // Append team-discussion extras (works for both modes when teamSummary exists)
    if (teamSummary?.wroteSomething) {
        lines.push('');
        if (teamSummary.newClientsCreated?.length > 0) {
            lines.push(`🆕 *New clients auto-created:* ${teamSummary.newClientsCreated.map(c => c.name).join(', ')}`);
        }
        if (teamSummary.newDealsCreated?.length > 0) {
            lines.push(`💼 *New deals auto-created (no value/fees — fill in manually):* ${teamSummary.newDealsCreated.map(d => d.dealName).join(', ')}`);
        }
        if (teamSummary.dealsDupSkipped?.length > 0) {
            lines.push(`⚠️ *Deal suggestion skipped (overlaps existing open deal — review needed):*`);
            for (const d of teamSummary.dealsDupSkipped) {
                lines.push(`  • Sonnet suggested "${d.dealName}" but it overlaps existing "${d.existingDealName}". Evidence: ${truncate(d.evidence || '', 160)}`);
            }
        }
        if (teamSummary.newContactsCreated?.length > 0) {
            lines.push(`👤 *New contacts auto-added:* ${teamSummary.newContactsCreated.map(c => c.name).join(', ')}`);
        }
        if (teamSummary.contactsDupSkipped?.length > 0) {
            lines.push(`⚠️ *Contact suggestion skipped (matches existing — no dup added):* ${teamSummary.contactsDupSkipped.map(c => `${c.name} (matched by ${c.matchedBy})`).join(', ')}`);
        }
        if (teamSummary.clientReferences?.length > 0 && mode === 'team-discussion') {
            lines.push(`*Clients referenced:* ${teamSummary.clientReferences.map(r => r.companyName).join(', ')}`);
        }
        if (teamSummary.listingReferences?.length > 0) {
            lines.push(`*Listings referenced:* ${teamSummary.listingReferences.map(r => r.listingTitle).join(', ')}`);
        }
        if (teamSummary.clientNotesWritten > 0) {
            lines.push(`📝 ${teamSummary.clientNotesWritten} additional client note${teamSummary.clientNotesWritten > 1 ? 's' : ''}`);
        }
        if (teamSummary.listingNotesWritten > 0) {
            lines.push(`🏠 ${teamSummary.listingNotesWritten} listing note${teamSummary.listingNotesWritten > 1 ? 's' : ''}`);
        }
        if (teamSummary.tasksCreated?.length > 0) {
            lines.push(`⏰ ${teamSummary.tasksCreated.length} task${teamSummary.tasksCreated.length > 1 ? 's' : ''}:`);
            for (const t of teamSummary.tasksCreated) {
                const due = t.dueAt ? new Date(t.dueAt) : null;
                const dueStr = due && !isNaN(due.getTime()) ? due.toLocaleString('en-US', {
                    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                    hour12: true, timeZone: 'America/New_York',
                }) + ' ET' : 'no due date';
                lines.push(`  • *${t.assignee}* → ${t.title} — ${dueStr}`);
            }
        }
        if (teamSummary.meetingsCreated?.length > 0) {
            lines.push(`📅 ${teamSummary.meetingsCreated.length} meeting${teamSummary.meetingsCreated.length > 1 ? 's' : ''}:`);
            for (const mtg of teamSummary.meetingsCreated) {
                const due = new Date(mtg.dueAt);
                const dueStr = isNaN(due.getTime()) ? 'no time' : due.toLocaleString('en-US', {
                    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                    hour12: true, timeZone: 'America/New_York',
                }) + ' ET';
                lines.push(`  • ${mtg.title} ${mtg.companyName ? `(${mtg.companyName})` : ''} — ${dueStr}`);
            }
        }
    }

    lines.push('');
    lines.push('<https://www.homesinsoflorida.com/crm|Open CRM →>');

    await sendSlackMessage({ webhookUrl, text: lines.join('\n') });
}

async function createLeadReminder({ leadRecordId, leadName, leadEmail, title, actionType, dueAt, note, agent, apiKey, baseId }) {
    const res = await fetch(`https://api.airtable.com/v0/${baseId}/Reminders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            records: [{
                fields: {
                    'Name': title,
                    'Lead Record ID': leadRecordId,
                    'Lead Name': leadName || '',
                    'Lead Email': leadEmail || '',
                    'Action Type': actionType,
                    'Due At': dueAt,
                    'Note': note || '',
                    'Status': 'Pending',
                    'Reminder Status': 'Pending',
                    'Agent Name': agent,
                    'Created At': new Date().toISOString(),
                },
            }],
            typecast: true,
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Reminder POST: ${err.error?.message || res.status}`);
    }
}

async function createConsultingTask({ companyId, title, type, dueAt, notes, owner, apiKey, baseId }) {
    const res = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            records: [{
                fields: {
                    'Title': title,
                    'Type': type,
                    'Due At': dueAt,
                    'Status': 'Pending',
                    'Owner': owner,
                    'Company': [companyId],
                    'Notes': notes || '',
                },
            }],
            typecast: true,
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Consulting Task POST: ${err.error?.message || res.status}`);
    }
}

/**
 * Skill §8.1 — Thread continuity supersedes confidence (added 2026-05-18).
 *
 * Look up any existing Consulting Activity rows for the given Gmail threadId.
 * Returns the linked parent records (companyId / projectId) so an incoming
 * message can be auto-appended to those parents' timelines without re-running
 * participant matching or Sonnet extraction. Bypasses confidence gating.
 *
 * Trace: 2026-05-18 — Dylan's "Fwd: NDA TO BE SIGNED" hit CRM_NEEDS_REVIEW
 * because the cron re-classified the forward from scratch and got ambiguous
 * between AD1 + Century, even though the original thread was already linked
 * to both records.
 */
async function findExistingThreadLinks(threadId) {
    if (!threadId) return [];
    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    if (!apiKey || !baseId) return [];

    const formula = encodeURIComponent(`{Gmail Thread ID}="${threadId}"`);
    const fieldsParam = '&fields%5B%5D=Company&fields%5B%5D=Development%20Projects&fields%5B%5D=Title';
    const url = `https://api.airtable.com/v0/${baseId}/Consulting%20Activity?filterByFormula=${formula}&maxRecords=10${fieldsParam}`;

    let res;
    try {
        res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    } catch (err) {
        console.error(`[§8.1] thread-links fetch error for ${threadId}:`, err.message);
        return [];
    }
    if (!res.ok) {
        console.error(`[§8.1] thread-links lookup failed (${res.status}) for thread ${threadId}`);
        return [];
    }
    const data = await res.json();
    const links = [];
    const seen = new Set();
    for (const rec of (data.records || [])) {
        const companyIds = rec.fields?.['Company'] || [];
        const projectIds = rec.fields?.['Development Projects'] || [];
        for (const cid of companyIds) {
            if (!seen.has(`c:${cid}`)) { seen.add(`c:${cid}`); links.push({ parentType: 'company', parentId: cid, sampleTitle: rec.fields?.Title || '' }); }
        }
        for (const pid of projectIds) {
            if (!seen.has(`p:${pid}`)) { seen.add(`p:${pid}`); links.push({ parentType: 'project', parentId: pid, sampleTitle: rec.fields?.Title || '' }); }
        }
    }
    return links;
}

/**
 * Thread continuity: look up an existing Consulting Activity row for
 * (companyId, gmail threadId). If one exists, APPEND the new note to its
 * Details field with a dated separator. If not, CREATE a new row.
 *
 * Implements skill §8: "One activity row per Gmail thread, not per message".
 * Uses the dedicated `Gmail Thread ID` field for indexed lookup.
 */
async function upsertActivityRow({ companyId, companyName, projectId, projectName, threadId, title, type, details, agent, links, apiKey, baseId, headers }) {
    if (!companyId && !projectId) throw new Error('upsertActivityRow: companyId or projectId required');

    // Format the Links field — one per line: "Label: url"
    const linksText = Array.isArray(links) && links.length > 0
        ? links.map(l => l.label ? `${l.label}: ${l.url}` : l.url).join('\n')
        : '';

    // Lookup existing row by Gmail Thread ID + matching parent link. Airtable's
    // ARRAYJOIN on a record-link field returns the linked records' PRIMARY
    // FIELD VALUES (names), not IDs — so we match by name. Without a threadId
    // (rare — only if Gmail didn't return one), fall back to create-only.
    let existing = null;
    if (threadId && (projectName || companyName)) {
        const parentClause = projectId
            ? `FIND("${(projectName || '').replace(/"/g, '\\"')}", ARRAYJOIN({Development Projects}))>0`
            : `FIND("${(companyName || '').replace(/"/g, '\\"')}", ARRAYJOIN({Company}))>0`;
        const formula = encodeURIComponent(`AND({Gmail Thread ID}="${threadId}", ${parentClause})`);
        const lookupUrl = `https://api.airtable.com/v0/${baseId}/Consulting%20Activity?filterByFormula=${formula}&maxRecords=1`;
        const lookupRes = await fetch(lookupUrl, { headers });
        if (lookupRes.ok) {
            const data = await lookupRes.json();
            existing = data.records?.[0] || null;
        }
    }

    const stampedSegment = `\n\n────────  ${nowDateStr()} — ${agent}  ────────\n${details}`;

    if (existing) {
        const prevDetails = existing.fields?.['Details'] || '';
        const prevLinks = existing.fields?.['Links'] || '';
        // Merge new links with existing — dedup by URL.
        const mergedLinks = linksText
            ? mergeLinksText(prevLinks, linksText)
            : prevLinks;
        const newDetails = prevDetails + stampedSegment;
        const patchRes = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Activity`, {
            method: 'PATCH', headers,
            body: JSON.stringify({
                records: [{ id: existing.id, fields: { 'Details': newDetails, 'Links': mergedLinks } }],
                typecast: true,
            }),
        });
        if (!patchRes.ok) {
            const err = await patchRes.json().catch(() => ({}));
            throw new Error(`Activity append: ${err.error?.message || patchRes.status}`);
        }
        return { mode: 'appended', recordId: existing.id };
    }

    const fields = {
        'Title': title,
        'Type': type,
        'Details': details,
        'Agent': agent,
    };
    if (linksText) fields['Links'] = linksText;
    if (projectId) fields['Development Projects'] = [projectId];
    else fields['Company'] = [companyId];
    if (threadId) fields['Gmail Thread ID'] = threadId;

    const createRes = await fetch(`https://api.airtable.com/v0/${baseId}/Consulting%20Activity`, {
        method: 'POST', headers,
        body: JSON.stringify({ records: [{ fields }], typecast: true }),
    });
    if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        throw new Error(`Activity create: ${err.error?.message || createRes.status}`);
    }
    const data = await createRes.json();
    return { mode: 'created', recordId: data.records?.[0]?.id };
}

function mergeLinksText(prev, next) {
    const lines = [...(prev || '').split('\n'), ...(next || '').split('\n')]
        .map(l => l.trim()).filter(Boolean);
    const seen = new Set();
    const out = [];
    for (const line of lines) {
        // Dedup by URL (the part after the last whitespace or after a "Label: ")
        const url = (line.match(/https?:\/\/\S+/) || [line])[0];
        if (seen.has(url)) continue;
        seen.add(url);
        out.push(line);
    }
    return out.join('\n');
}

async function uploadAirtableAttachment({ recordId, field, filename, contentType, base64, apiKey, baseId }) {
    const url = `https://content.airtable.com/v0/${baseId}/${recordId}/${encodeURIComponent(field)}/uploadAttachment`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contentType: contentType || 'application/octet-stream',
            file: base64, filename,
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Doc upload (${field}): ${err.error?.message || res.status}`);
    }
}

function truncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function nowDateStr() {
    return new Date().toLocaleString('en-US', {
        month: 'numeric', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
    });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
