/**
 * /api/sync-call-notes.js — Vercel Edge Function
 *
 * Processes a call transcript (from Granola or manual input) and:
 * 1. Extracts property preferences using Claude AI
 * 2. Updates the lead's CRM record with alert profiles, notes, and reminders
 *
 * Can be called:
 * - Manually via POST with { email, transcript, meetingTitle }
 * - By a scheduled task that pulls from Granola
 *
 * Required env vars:
 *   AIRTABLE_API_KEY, AIRTABLE_BASE_ID, ANTHROPIC_API_KEY
 */

export const config = { runtime: 'edge' };

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            },
        });
    }

    if (req.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405);
    }

    const apiKey      = process.env.AIRTABLE_API_KEY;
    const baseId      = process.env.AIRTABLE_BASE_ID;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey || !baseId || !anthropicKey) {
        return json({ error: 'Missing required environment variables' }, 500);
    }

    let body;
    try {
        body = await req.json();
    } catch {
        return json({ error: 'Invalid request body' }, 400);
    }

    const { email, transcript, meetingTitle, leadRecordId } = body;
    if (!transcript) {
        return json({ error: 'transcript is required' }, 400);
    }

    // Step 1: Find the lead in Airtable by email or record ID
    let leadId = leadRecordId;
    let leadFields = {};

    if (!leadId && email) {
        const searchRes = await fetch(
            `https://api.airtable.com/v0/${baseId}/Leads?filterByFormula=${encodeURIComponent(`{Email}="${email}"`)}`,
            { headers: { 'Authorization': `Bearer ${apiKey}` } }
        );
        const searchData = await searchRes.json();
        if (searchData.records && searchData.records.length > 0) {
            leadId = searchData.records[0].id;
            leadFields = searchData.records[0].fields || {};
        }
    }

    if (!leadId) {
        return json({ error: 'Lead not found. Provide email or leadRecordId.' }, 404);
    }

    // Step 2: Send transcript to Claude to extract preferences
    const extraction = await extractPreferencesFromTranscript(anthropicKey, transcript, meetingTitle);
    if (!extraction) {
        return json({ error: 'Failed to extract preferences from transcript' }, 500);
    }

    // Step 3: Build CRM updates
    const updates = {};
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    // Notes: prepend call summary to existing notes
    const existingNotes = leadFields['Notes'] || '';
    const callNote = `[${dateStr}, ${timeStr} — Kevin] CALL SUMMARY${meetingTitle ? ' (' + meetingTitle + ')' : ''}:\n${extraction.summary}`;
    updates['Notes'] = callNote + (existingNotes ? '\n\n' + existingNotes : '');

    // Alert profiles: set up if preferences were discussed
    if (extraction.hasPropertyPreferences) {
        const profile = {
            name: extraction.profileName || `From call ${dateStr}`,
            types: extraction.propertyTypes || [],
            cities: extraction.cities || '',
            priceMin: extraction.priceMin || 0,
            priceMax: extraction.priceMax || 0,
            bedsMin: extraction.bedsMin || 0,
            bathsMin: extraction.bathsMin || 0,
            features: extraction.features || [],
            sqftMin: extraction.sqftMin || 0,
            sqftMax: extraction.sqftMax || 0,
            lotSizeMin: extraction.lotSizeMin || 0,
            yearBuiltMin: extraction.yearBuiltMin || 0,
            keywords: extraction.keywords || '',
            polygon: '', // Can't draw polygon from voice — use cities instead
        };

        // Merge with existing profiles
        let existingProfiles = [];
        try {
            const raw = leadFields['Alert Profiles'] || '';
            if (raw) existingProfiles = JSON.parse(raw);
        } catch (e) { /* ignore */ }

        existingProfiles.push(profile);
        updates['Alert Profiles'] = JSON.stringify(existingProfiles);
        updates['Alert Active'] = true;
    }

    // Status: update if discussed
    if (extraction.suggestedStatus) {
        updates['Status'] = extraction.suggestedStatus;
    }

    // Step 4: Update Airtable
    const updateRes = await fetch(`https://api.airtable.com/v0/${baseId}/Leads`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            records: [{ id: leadId, fields: updates }],
        }),
    });

    if (!updateRes.ok) {
        const err = await updateRes.json().catch(() => ({}));
        return json({ error: 'Failed to update CRM', details: err }, 500);
    }

    // Step 5: Create reminder if follow-up action was discussed
    if (extraction.followUp) {
        const reminderDue = extraction.followUpDate
            ? new Date(extraction.followUpDate).toISOString()
            : new Date(Date.now() + 2 * 86400000).toISOString(); // Default: 2 days from now

        try {
            // Use internal API to create reminder
            const password = process.env.CRM_PASSWORD || '';
            await fetch(`https://poler-team-website-two.vercel.app/api/create-reminder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    leadRecordId: leadId,
                    leadName: leadFields['Name'] || '',
                    leadEmail: email || leadFields['Email'] || '',
                    leadPhone: leadFields['Phone'] || '',
                    actionType: extraction.followUpType || 'Follow Up',
                    dueAt: reminderDue,
                    note: extraction.followUp,
                    agentEmail: 'kevinpolermiami@gmail.com',
                    agentName: 'Kevin',
                    password,
                }),
            });
        } catch (err) {
            console.warn('Failed to create reminder:', err);
        }
    }

    return json({
        success: true,
        leadId,
        extracted: {
            hasPropertyPreferences: extraction.hasPropertyPreferences,
            summary: extraction.summary.substring(0, 200) + '...',
            followUp: extraction.followUp || null,
            profileName: extraction.profileName || null,
        },
        updatedFields: Object.keys(updates),
    });
}

// ── Extract preferences from transcript using Claude AI ──

async function extractPreferencesFromTranscript(apiKey, transcript, meetingTitle) {
    const prompt = `You are analyzing a real estate agent's phone call transcript with a lead/client. Extract the following information in JSON format.

IMPORTANT RULES:
- Only include fields that were ACTUALLY DISCUSSED in the call
- If property preferences were NOT discussed, set hasPropertyPreferences to false
- For price, convert mentions like "2 million" to 2000000, "500K" to 500000
- For cities, use official city names (e.g. "Sunny Isles Beach" not "Sunny Isles")
- For features, only use these exact values: "Pool", "Balcony / Terrace", "Gated Community", "Golf Course", "Large Lot", "Short-Term Rental Allowed", "High Rise", "Penthouse", "Waterfront / Ocean View", "Waterfront / Beach", "Waterfront / Bay", "Waterfront / Lake", "Waterfront / Canal"
- For property types, only use: "Single Family", "Condo", "Townhouse", "Multi Family"
- For suggestedStatus, use: "New", "Contacted", "Warm", "Hot", "Appointment Set" based on how interested the lead seems

Return ONLY valid JSON, no markdown or explanation:

{
  "summary": "2-4 sentence summary of what was discussed",
  "hasPropertyPreferences": true/false,
  "profileName": "Short descriptive name for this search profile",
  "propertyTypes": ["Single Family"],
  "cities": "Miami Beach, Fort Lauderdale",
  "priceMin": 500000,
  "priceMax": 1000000,
  "bedsMin": 3,
  "bathsMin": 2,
  "sqftMin": 0,
  "sqftMax": 0,
  "lotSizeMin": 0,
  "yearBuiltMin": 0,
  "features": ["Pool", "Waterfront / Beach"],
  "keywords": "modern, renovated",
  "suggestedStatus": "Warm",
  "followUp": "Description of promised follow-up action, or null if none",
  "followUpType": "Call",
  "followUpDate": "2026-04-05T14:00:00"
}

${meetingTitle ? `Meeting title: ${meetingTitle}` : ''}

TRANSCRIPT:
${transcript.substring(0, 15000)}`;

    try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 2000,
                messages: [{
                    role: 'user',
                    content: prompt,
                }],
            }),
        });

        if (!res.ok) {
            const err = await res.text();
            console.error('Anthropic API error:', err);
            return null;
        }

        const data = await res.json();
        const text = data.content?.[0]?.text || '';

        // Parse JSON from response (handle potential markdown wrapping)
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;

        return JSON.parse(jsonMatch[0]);
    } catch (err) {
        console.error('Extraction error:', err);
        return null;
    }
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
