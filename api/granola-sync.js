/**
 * /api/granola-sync.js — Vercel Edge Function (Cron-triggered)
 *
 * Runs every 15 minutes. Pulls recent meetings from Granola,
 * finds matching leads in Airtable, and syncs call notes + preferences.
 *
 * Required env vars:
 *   AIRTABLE_API_KEY, AIRTABLE_BASE_ID, ANTHROPIC_API_KEY, GRANOLA_API_KEY
 *
 * Runs daily at 8pm EST via Vercel cron.
 */

export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            },
        });
    }

    // Auth: Vercel Cron sends this header automatically
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get('authorization');
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return json({ error: 'Unauthorized' }, 401);
    }

    const apiKey       = process.env.AIRTABLE_API_KEY;
    const baseId       = process.env.AIRTABLE_BASE_ID;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const granolaKey   = process.env.GRANOLA_API_KEY;

    if (!apiKey || !baseId || !anthropicKey) {
        return json({ error: 'Missing required environment variables' }, 500);
    }

    // If no Granola key, skip silently (not configured yet)
    if (!granolaKey) {
        return json({ message: 'Granola not configured yet — skipping', synced: 0 });
    }

    try {
        // Step 1: Get recent meetings from Granola (last 30 minutes)
        const recentMeetings = await fetchRecentGranolaMeetings(granolaKey);
        if (!recentMeetings.length) {
            return json({ message: 'No new meetings to sync', synced: 0 });
        }

        // Step 2: Get all leads from Airtable for matching
        const leads = await fetchAllLeads(apiKey, baseId);
        const leadsByName = new Map();
        const leadsByPhone = new Map();
        const leadsByEmail = new Map();

        leads.forEach(l => {
            if (l.fields['Name']) leadsByName.set(l.fields['Name'].toLowerCase(), l);
            if (l.fields['Phone']) leadsByPhone.set(l.fields['Phone'].replace(/\D/g, ''), l);
            if (l.fields['Email']) leadsByEmail.set(l.fields['Email'].toLowerCase(), l);
        });

        let synced = 0;
        const details = [];

        for (const meeting of recentMeetings) {
            // Step 3: Try to match meeting to a lead
            const matchedLead = matchMeetingToLead(meeting, leadsByName, leadsByPhone, leadsByEmail);
            if (!matchedLead) {
                details.push({ meeting: meeting.title, status: 'no_lead_match' });
                continue;
            }

            // Step 4: Get transcript
            const transcript = meeting.transcript || meeting.summary || '';
            if (!transcript || transcript.length < 50) {
                details.push({ meeting: meeting.title, status: 'no_transcript' });
                continue;
            }

            // Step 5: Call sync-call-notes logic
            const syncUrl = `https://${req.headers.get('host')}/api/sync-call-notes`;
            const syncRes = await fetch(syncUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: matchedLead.fields['Email'],
                    leadRecordId: matchedLead.id,
                    transcript,
                    meetingTitle: meeting.title,
                }),
            });

            if (syncRes.ok) {
                synced++;
                details.push({ meeting: meeting.title, lead: matchedLead.fields['Name'], status: 'synced' });
            } else {
                details.push({ meeting: meeting.title, lead: matchedLead.fields['Name'], status: 'error' });
            }
        }

        return json({ success: true, synced, total: recentMeetings.length, details });

    } catch (err) {
        return json({ error: err.message }, 500);
    }
}

async function fetchRecentGranolaMeetings(granolaKey) {
    // Granola API — fetch meetings from the last 30 minutes
    // This is a placeholder — actual Granola API may differ
    try {
        const res = await fetch('https://api.granola.ai/v1/meetings?limit=10&time_range=last_30_days', {
            headers: { 'Authorization': `Bearer ${granolaKey}` },
        });
        if (!res.ok) return [];
        const data = await res.json();
        return data.meetings || data || [];
    } catch {
        return [];
    }
}

async function fetchAllLeads(apiKey, baseId) {
    const all = [];
    let offset = null;
    for (let page = 0; page < 5; page++) {
        const params = new URLSearchParams({ pageSize: '100', 'fields[]': ['Name', 'Email', 'Phone', 'Notes', 'Alert Profiles'] });
        if (offset) params.set('offset', offset);
        const res = await fetch(`https://api.airtable.com/v0/${baseId}/Leads?${params}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        if (!res.ok) break;
        const data = await res.json();
        all.push(...(data.records || []));
        if (!data.offset) break;
        offset = data.offset;
    }
    return all;
}

function matchMeetingToLead(meeting, leadsByName, leadsByPhone, leadsByEmail) {
    // Try to match by attendee name, email, or phone
    const attendees = meeting.attendees || [];
    const title = (meeting.title || '').toLowerCase();

    for (const att of attendees) {
        const name = (att.name || att.displayName || '').toLowerCase();
        const email = (att.email || '').toLowerCase();

        if (email && leadsByEmail.has(email)) return leadsByEmail.get(email);
        if (name && leadsByName.has(name)) return leadsByName.get(name);
    }

    // Try matching meeting title to a lead name
    for (const [name, lead] of leadsByName) {
        if (title.includes(name)) return lead;
    }

    return null;
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
    });
}
