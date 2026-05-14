/**
 * /api/mcp.js — Hosted MCP server (Streamable HTTP / JSON-RPC over HTTP).
 *
 * This is the REMOTE MCP endpoint Kevin / Dylan / Noel / Rosa add as a Claude.ai
 * Connector to operate the CRM from any device including phone. Same tool surface
 * as the local stdio MCP at ~/poler-team-mcp/index.js.
 *
 * Auth: Authorization: Bearer <AGENT_API_TOKEN>  (per-user token; multi-token in env)
 *
 * Protocol: JSON-RPC 2.0. Methods:
 *   - initialize       → server info + capabilities
 *   - tools/list       → available tool list
 *   - tools/call       → invoke a tool (proxied to underlying /api/* endpoint)
 *   - ping             → health check
 *
 * Stateless. No session storage. Each tools/call proxies to the matching REST
 * endpoint, passing through the caller's Bearer token (so audit trail is preserved).
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';

// ── TOOL REGISTRY ──────────────────────────────────────────────────────────
// Each tool maps a friendly name → REST endpoint + arg shaping.
// `path`: the underlying /api/* endpoint
// `method`: HTTP method to use
// `argTransform`: (args) => { url?: string, body?: object }
//   - For GET endpoints, return { url: '?param=value' } for query string
//   - For POST/PATCH endpoints, return { body: {...} }
const TOOLS = [
    // ── REAL ESTATE LEADS ─────────────────────────────────────────────────
    {
        name: 'get_leads',
        description: 'List all real estate leads. Returns id, name, email, phone, status, assignedTo, etc.',
        inputSchema: { type: 'object', properties: {} },
        endpoint: { method: 'GET', path: '/api/get-leads' },
    },
    {
        name: 'get_lead',
        description: 'Find a single lead by name OR record id. Searches all leads.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Lead name (case-insensitive substring) or record id (rec...)' },
            },
            required: ['query'],
        },
        // Special: implemented in proxy() — fetches all leads then filters
        custom: 'get_lead',
    },
    {
        name: 'update_lead',
        description: 'Update fields on a lead. Pass only fields to change.',
        inputSchema: {
            type: 'object',
            properties: {
                id:         { type: 'string' },
                firstName:  { type: 'string' },
                lastName:   { type: 'string' },
                email:      { type: 'string' },
                phone:      { type: 'string' },
                status:     { type: 'string' },
                assignedTo: { type: 'string' },
                notes:      { type: 'string', description: 'OVERWRITES notes — usually use log_note instead' },
            },
            required: ['id'],
        },
        endpoint: { method: 'PATCH', path: '/api/update-lead' },
    },
    {
        name: 'log_note',
        description: 'Append a single timestamped note to a lead. PREFERRED over update_lead({notes}) — preserves history.',
        inputSchema: {
            type: 'object',
            properties: {
                leadId: { type: 'string' },
                note:   { type: 'string' },
                agent:  { type: 'string' },
            },
            required: ['leadId', 'note'],
        },
        endpoint: { method: 'POST', path: '/api/agent/log-note' },
    },
    {
        name: 'log_call',
        description: 'Log a phone-call summary as a Lead Activity entry.',
        inputSchema: {
            type: 'object',
            properties: {
                leadId:      { type: 'string' },
                summary:     { type: 'string' },
                durationMin: { type: 'number' },
                agent:       { type: 'string' },
            },
            required: ['leadId', 'summary'],
        },
        endpoint: { method: 'POST', path: '/api/agent/log-call' },
    },
    {
        name: 'set_alert_active',
        description: 'Toggle the Alert Active checkbox on a lead.',
        inputSchema: {
            type: 'object',
            properties: {
                leadId: { type: 'string' },
                active: { type: 'boolean' },
            },
            required: ['leadId', 'active'],
        },
        endpoint: { method: 'POST', path: '/api/agent/set-alert-active' },
    },
    {
        name: 'update_alerts',
        description: 'Update lead alert preferences. profile keys: active, cities[], priceMin, priceMax, bedsMin, bathsMin, propertyTypes[], frequency, count.',
        inputSchema: {
            type: 'object',
            properties: {
                leadId:  { type: 'string' },
                profile: { type: 'object' },
            },
            required: ['leadId', 'profile'],
        },
        endpoint: { method: 'POST', path: '/api/agent/update-alerts' },
    },
    {
        name: 'send_test_alert',
        description: 'Fire a one-off test alert email to a lead using their existing alert profile.',
        inputSchema: {
            type: 'object',
            properties: { leadId: { type: 'string' } },
            required: ['leadId'],
        },
        endpoint: { method: 'POST', path: '/api/send-test-alert' },
        argRemap: ({ leadId }) => ({ id: leadId }),
    },

    // ── REMINDERS ─────────────────────────────────────────────────────────
    {
        name: 'get_reminders',
        description: 'List all reminders.',
        inputSchema: { type: 'object', properties: {} },
        endpoint: { method: 'GET', path: '/api/get-reminders' },
    },
    {
        name: 'create_reminder',
        description: 'Create a reminder for a lead.',
        inputSchema: {
            type: 'object',
            properties: {
                leadRecordId: { type: 'string' },
                leadName:     { type: 'string' },
                leadEmail:    { type: 'string' },
                leadPhone:    { type: 'string' },
                actionType:   { type: 'string' },
                dueAt:        { type: 'string' },
                note:         { type: 'string' },
                agentName:    { type: 'string' },
                agentEmail:   { type: 'string' },
            },
            required: ['leadRecordId', 'dueAt'],
        },
        endpoint: { method: 'POST', path: '/api/create-reminder' },
    },
    {
        name: 'update_reminder',
        description: 'Update a reminder status (Pending / Completed / Cancelled).',
        inputSchema: {
            type: 'object',
            properties: {
                id:     { type: 'string' },
                status: { type: 'string' },
            },
            required: ['id', 'status'],
        },
        endpoint: { method: 'PATCH', path: '/api/update-reminder' },
    },

    // ── CONSULTING ────────────────────────────────────────────────────────
    {
        name: 'get_consulting_companies',
        description: 'List all consulting Companies (Buvinic | Poler Intelligence clients).',
        inputSchema: { type: 'object', properties: {} },
        endpoint: { method: 'GET', path: '/api/get-consulting-clients' },
    },
    {
        name: 'update_consulting_company',
        description: 'Update a consulting Company. Status: Lead / Active Client / Dormant / Closed Lost. Owner: Noel / Kevin / Dylan.',
        inputSchema: {
            type: 'object',
            properties: {
                id:      { type: 'string' },
                status:  { type: 'string' },
                owner:   { type: 'string' },
                country: { type: 'string' },
                website: { type: 'string' },
                source:  { type: 'string' },
                notes:   { type: 'string' },
            },
            required: ['id'],
        },
        endpoint: { method: 'PATCH', path: '/api/update-consulting-client' },
    },
    {
        name: 'get_consulting_deals',
        description: 'List consulting Opportunities. Optional companyId filter.',
        inputSchema: {
            type: 'object',
            properties: { companyId: { type: 'string' } },
        },
        endpoint: { method: 'GET', path: '/api/get-consulting-deals' },
    },
    {
        name: 'update_consulting_deal',
        description: 'Update an Opportunity. Stage changes auto-log activity. Stages: Pitching / Proposal Sent / Verbal Commitment / Signed / Active / Completed / Closed Lost.',
        inputSchema: {
            type: 'object',
            properties: {
                id:                  { type: 'string' },
                dealName:            { type: 'string' },
                stage:               { type: 'string' },
                owner:               { type: 'string' },
                dealValue:           { type: 'number' },
                expectedCloseDate:   { type: 'string' },
                lastContact:         { type: 'string' },
                description:         { type: 'string' },
                diagnosticFee:       { type: 'number' },
                monthlyRecurringFee: { type: 'number' },
                successFee:          { type: 'number' },
            },
            required: ['id'],
        },
        endpoint: { method: 'PATCH', path: '/api/update-consulting-deal' },
    },
    {
        name: 'get_consulting_contacts',
        description: 'List people at consulting Companies.',
        inputSchema: {
            type: 'object',
            properties: { companyId: { type: 'string' } },
        },
        endpoint: { method: 'GET', path: '/api/get-consulting-contacts' },
    },
    {
        name: 'save_consulting_contact',
        description: 'Add a contact to a Company.',
        inputSchema: {
            type: 'object',
            properties: {
                companyId: { type: 'string' },
                name:      { type: 'string' },
                role:      { type: 'string' },
                email:     { type: 'string' },
                phone:     { type: 'string' },
                primary:   { type: 'boolean' },
                language:  { type: 'string' },
            },
            required: ['companyId', 'name'],
        },
        endpoint: { method: 'POST', path: '/api/save-consulting-contact' },
    },
    {
        name: 'get_consulting_partners',
        description: 'List partner references (Boris Buvinic, B|P Intelligence, etc).',
        inputSchema: { type: 'object', properties: {} },
        endpoint: { method: 'GET', path: '/api/get-consulting-partners' },
    },
    {
        name: 'save_consulting_partner',
        description: 'Create a new partner.',
        inputSchema: {
            type: 'object',
            properties: {
                name:                { type: 'string' },
                type:                { type: 'string', description: 'Individual / Company' },
                contactInfo:         { type: 'string' },
                defaultRevenueShare: { type: 'number' },
            },
            required: ['name'],
        },
        endpoint: { method: 'POST', path: '/api/save-consulting-partner' },
    },
    {
        name: 'get_consulting_tasks',
        description: 'List consulting tasks. Optional filters.',
        inputSchema: {
            type: 'object',
            properties: {
                companyId: { type: 'string' },
                dealId:    { type: 'string' },
                status:    { type: 'string' },
                owner:     { type: 'string' },
            },
        },
        endpoint: { method: 'GET', path: '/api/get-consulting-tasks' },
    },
    {
        name: 'create_consulting_task',
        description: 'Create a typed task tied to a Company and optionally a Deal.',
        inputSchema: {
            type: 'object',
            properties: {
                companyId: { type: 'string' },
                dealId:    { type: 'string' },
                title:     { type: 'string' },
                type:      { type: 'string' },
                dueAt:     { type: 'string' },
                owner:     { type: 'string' },
                notes:     { type: 'string' },
            },
            required: ['companyId', 'title'],
        },
        endpoint: { method: 'POST', path: '/api/create-consulting-task' },
    },
    {
        name: 'get_consulting_activity',
        description: 'Activity timeline for a Company or Deal.',
        inputSchema: {
            type: 'object',
            properties: {
                companyId: { type: 'string' },
                dealId:    { type: 'string' },
            },
        },
        endpoint: { method: 'GET', path: '/api/get-consulting-activity' },
    },
    {
        name: 'log_consulting_activity',
        description: 'Manually log an activity. Types: Note / Stage Change / Doc Upload / Call Logged / Email Logged / Task Completed / WhatsApp / Deal Created.',
        inputSchema: {
            type: 'object',
            properties: {
                companyId: { type: 'string' },
                dealId:    { type: 'string' },
                type:      { type: 'string' },
                title:     { type: 'string' },
                details:   { type: 'string' },
                agent:     { type: 'string' },
            },
            required: ['companyId', 'type', 'title'],
        },
        endpoint: { method: 'POST', path: '/api/log-consulting-activity' },
    },

    // ── ADDITIONAL CREATE / UPDATE / DELETE / STAMP TOOLS ─────────────────
    {
        name: 'save_consulting_company',
        description: 'Create a new consulting Company. Use status=Lead for prospects. Country options: Argentina, Bolivia, Brazil, Chile, Colombia, Ecuador, Mexico, Paraguay, Peru, Uruguay, USA, Venezuela, Other.',
        inputSchema: {
            type: 'object',
            properties: {
                company:        { type: 'string', description: 'Company name (required)' },
                country:        { type: 'string' },
                status:         { type: 'string', description: 'Lead / Active Client / Dormant / Closed Lost' },
                owner:          { type: 'string', description: 'Noel / Kevin / Dylan' },
                website:        { type: 'string' },
                source:         { type: 'string' },
                serviceType:    { type: 'array', items: { type: 'string' } },
                primaryContact: { type: 'string' },
                email:          { type: 'string' },
                phone:          { type: 'string' },
                notes:          { type: 'string' },
            },
            required: ['company'],
        },
        endpoint: { method: 'POST', path: '/api/save-consulting-client' },
    },
    {
        name: 'save_consulting_deal',
        description: 'Create a new Opportunity (deal) for a Company. Stage defaults to Pitching. Stages: Pitching / Proposal Sent / Verbal Commitment / Signed / Active / Completed / Closed Lost.',
        inputSchema: {
            type: 'object',
            properties: {
                companyId:         { type: 'string' },
                dealName:          { type: 'string' },
                stage:             { type: 'string' },
                serviceType:       { type: 'array', items: { type: 'string' } },
                dealValue:         { type: 'number' },
                probability:       { type: 'number' },
                owner:             { type: 'string' },
                startedAt:         { type: 'string', description: 'YYYY-MM-DD' },
                expectedCloseDate: { type: 'string', description: 'YYYY-MM-DD' },
                description:       { type: 'string' },
                partnerId:         { type: 'string' },
            },
            required: ['companyId', 'dealName'],
        },
        endpoint: { method: 'POST', path: '/api/save-consulting-deal' },
    },
    {
        name: 'update_consulting_contact',
        description: 'Update an existing contact (name, role, email, phone, primary flag, language, notes).',
        inputSchema: {
            type: 'object',
            properties: {
                id:       { type: 'string' },
                name:     { type: 'string' },
                role:     { type: 'string' },
                email:    { type: 'string' },
                phone:    { type: 'string' },
                primary:  { type: 'boolean' },
                language: { type: 'string' },
                notes:    { type: 'string' },
            },
            required: ['id'],
        },
        endpoint: { method: 'PATCH', path: '/api/update-consulting-contact' },
    },
    {
        name: 'delete_consulting_contact',
        description: 'Delete a contact by record id.',
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
        },
        endpoint: { method: 'POST', path: '/api/delete-consulting-contact' },
    },
    {
        name: 'update_consulting_partner',
        description: 'Update an existing partner (name, type, contact info, default revenue share, notes).',
        inputSchema: {
            type: 'object',
            properties: {
                id:                  { type: 'string' },
                name:                { type: 'string' },
                type:                { type: 'string', description: 'Individual / Company' },
                contactInfo:         { type: 'string' },
                defaultRevenueShare: { type: 'number' },
                notes:               { type: 'string' },
            },
            required: ['id'],
        },
        endpoint: { method: 'PATCH', path: '/api/update-consulting-partner' },
    },
    {
        name: 'update_consulting_task',
        description: 'Update a consulting task (status, due date, notes, etc). On Status=Completed, auto-logs a Task Completed activity.',
        inputSchema: {
            type: 'object',
            properties: {
                id:     { type: 'string' },
                title:  { type: 'string' },
                type:   { type: 'string' },
                dueAt:  { type: 'string' },
                status: { type: 'string', description: 'Pending / Completed / Cancelled' },
                owner:  { type: 'string' },
                notes:  { type: 'string' },
                agent:  { type: 'string' },
            },
            required: ['id'],
        },
        endpoint: { method: 'PATCH', path: '/api/update-consulting-task' },
    },
    {
        name: 'stamp_last_contact',
        description: 'Auto-stamp Last Contact = today on a consulting Opportunity AND log a Call/Email/WhatsApp activity entry. Use this when you log a touch-point on a deal.',
        inputSchema: {
            type: 'object',
            properties: {
                id:      { type: 'string', description: 'Opportunity (deal) id' },
                channel: { type: 'string', description: 'Call / Email / WhatsApp' },
                agent:   { type: 'string' },
            },
            required: ['id', 'channel'],
        },
        endpoint: { method: 'POST', path: '/api/stamp-last-contact' },
    },
    {
        name: 'create_lead',
        description: 'Manually create a real estate lead in Airtable. Use for leads that did not come through the website form.',
        inputSchema: {
            type: 'object',
            properties: {
                firstName:       { type: 'string' },
                lastName:        { type: 'string' },
                email:           { type: 'string' },
                phone:           { type: 'string' },
                country:         { type: 'string' },
                listingAddress:  { type: 'string' },
                listingPrice:    { type: 'number' },
                timeline:        { type: 'string' },
                sourceUrl:       { type: 'string' },
                notes:           { type: 'string' },
                assignedTo:      { type: 'string' },
            },
            required: ['firstName'],
        },
        endpoint: { method: 'POST', path: '/api/save-lead' },
    },

    // ── ROUND 3: MLS SEARCH + LEAD CONTEXT + UTILITIES ────────────────────
    {
        name: 'search_properties',
        description: 'Search the South Florida MLS for active listings. Returns photos, price, beds, baths, sqft, $/sqft, address, etc. Use when a user asks "find me waterfront condos in Miami Beach between $2M-$5M with 3+ beds" or any property search.',
        inputSchema: {
            type: 'object',
            properties: {
                city:         { type: 'string', description: 'Comma-separated cities, e.g. "Miami Beach,Sunny Isles,Aventura"' },
                priceMin:     { type: 'number' },
                priceMax:     { type: 'number' },
                bedsMin:      { type: 'number' },
                bathsMin:     { type: 'number' },
                sqftMin:      { type: 'number' },
                sqftMax:      { type: 'number' },
                propertyType: { type: 'string', description: 'SFH / Condo / Townhome OR full PropertySubType string' },
                waterfront:   { type: 'boolean' },
                pool:         { type: 'boolean' },
                yearBuiltMin: { type: 'number', description: 'Earliest YearBuilt, e.g. 2020 for "modern / newly built"' },
                yearBuiltMax: { type: 'number' },
                listingId:    { type: 'string' },
                limit:        { type: 'number' },
                sort:         { type: 'string' },
            },
        },
        endpoint: { method: 'GET', path: '/api/agent/search-properties' },
    },
    {
        name: 'get_lead_preferences',
        description: 'Get a lead\'s current alert profile (cities, price range, beds/baths, frequency, etc). Useful BEFORE calling update_alerts so you know the current state.',
        inputSchema: {
            type: 'object',
            properties: {
                leadId: { type: 'string' },
                token:  { type: 'string', description: 'The lead\'s alert token' },
            },
        },
        endpoint: { method: 'GET', path: '/api/get-preferences' },
        argRemap: ({ leadId, token }) => {
            const out = {};
            if (leadId) out.id = leadId;
            if (token)  out.token = token;
            return out;
        },
    },
    {
        name: 'get_lead_conversations',
        description: 'Get the AI chat history for a lead — messages exchanged via the in-app chat. Use this to understand what the lead has already asked / been told before drafting a reply.',
        inputSchema: {
            type: 'object',
            properties: {
                leadEmail: { type: 'string', description: 'Lead\'s email (the join key)' },
            },
            required: ['leadEmail'],
        },
        endpoint: { method: 'GET', path: '/api/get-conversations' },
        argRemap: ({ leadEmail }) => ({ email: leadEmail }),
    },
    {
        name: 'get_lead_activity',
        description: 'Get a lead\'s activity history (property views, searches, logged calls). Useful for context — see what they\'ve looked at and when.',
        inputSchema: {
            type: 'object',
            properties: {
                leadEmail: { type: 'string' },
            },
            required: ['leadEmail'],
        },
        endpoint: { method: 'GET', path: '/api/get-activity' },
        argRemap: ({ leadEmail }) => ({ email: leadEmail }),
    },
    {
        name: 'log_lead_activity',
        description: 'Log an activity entry for a real estate lead (showing, tour, doc sent). Different from log_note — this writes to Lead Activity table for the timeline.',
        inputSchema: {
            type: 'object',
            properties: {
                leadEmail:    { type: 'string' },
                activityType: { type: 'string', description: 'Showing / Property Sent / Tour Completed / Document Sent / etc' },
                details:      { type: 'string' },
            },
            required: ['leadEmail', 'activityType'],
        },
        endpoint: { method: 'POST', path: '/api/log-activity' },
        argRemap: ({ leadEmail, activityType, details }) => ({
            email: leadEmail,
            activityType,
            details: details || '',
        }),
    },
    {
        name: 'whoami',
        description: 'Returns which user this token belongs to (Kevin / Dylan / Noel / Rosa). Use this when you need to know who you are operating on behalf of.',
        inputSchema: { type: 'object', properties: {} },
        endpoint: { method: 'GET', path: '/api/agent/whoami' },
    },
    {
        name: 'crm_summary',
        description: 'One-call dashboard: total leads, hot leads, new this week, pending/overdue reminders, open consulting pipeline $, weighted pipeline, win rate, overdue tasks. Use as the first call when a user asks "give me an overview" or "what is on my plate".',
        inputSchema: { type: 'object', properties: {} },
        endpoint: { method: 'GET', path: '/api/agent/crm-summary' },
    },

    // ── DOCUMENT UPLOAD / DELETE (consulting Companies + Deals) ───────────
    {
        name: 'upload_consulting_doc',
        description: 'Attach a document to a consulting Company or Deal. Two modes: (1) pass `url` to a file already online (Dropbox, Drive, S3, etc.) — server fetches and uploads, no conversation-context cost; (2) pass `base64` for a file attached in the chat — fallback for files not yet online.',
        inputSchema: {
            type: 'object',
            properties: {
                targetType:  { type: 'string', description: 'company | deal' },
                id:          { type: 'string' },
                field:       { type: 'string', description: 'Contracts / Deliverables / Spreadsheets / Misc' },
                filename:    { type: 'string' },
                url:         { type: 'string', description: 'EITHER url to fetch (preferred)' },
                base64:      { type: 'string', description: 'OR base64-encoded bytes (fallback)' },
                contentType: { type: 'string' },
            },
            required: ['targetType', 'id', 'field', 'filename'],
        },
        endpoint: { method: 'POST', path: '/api/upload-consulting-doc' },
    },
    {
        name: 'delete_consulting_doc',
        description: 'Remove a document from a consulting Company or Deal.',
        inputSchema: {
            type: 'object',
            properties: {
                targetType:   { type: 'string', description: 'company | deal' },
                id:           { type: 'string' },
                field:        { type: 'string' },
                attachmentId: { type: 'string' },
            },
            required: ['targetType', 'id', 'field', 'attachmentId'],
        },
        endpoint: { method: 'POST', path: '/api/delete-consulting-doc' },
    },

    // ── ROUND 4: LISTING / PROPERTY TOOLS ─────────────────────────────────
    {
        name: 'get_property_full_details',
        description: 'COMPLETE Bridge MLS record for a single listing: all fields, all photos, agent contact, tax info, parcel #, days on market, price history. Heavier than search_properties — use when you need full detail.',
        inputSchema: {
            type: 'object',
            properties: { mlsId: { type: 'string' } },
            required: ['mlsId'],
        },
        endpoint: { method: 'GET', path: '/api/agent/get-property' },
    },
    {
        name: 'list_rosa_listings',
        description: 'Rosa Poler\'s active MLS listings. Sorted by price descending.',
        inputSchema: { type: 'object', properties: {} },
        endpoint: { method: 'GET', path: '/api/agent/list-rosa-listings' },
    },
    {
        name: 'list_lead_favorites',
        description: 'Properties a lead has hearted/saved on /listing. Hydrated with Bridge MLS data.',
        inputSchema: {
            type: 'object',
            properties: {
                leadId:    { type: 'string' },
                leadEmail: { type: 'string' },
            },
        },
        endpoint: { method: 'GET', path: '/api/agent/lead-favorites' },
    },
    {
        name: 'list_lead_recently_viewed',
        description: 'Properties this lead has VIEWED on /listing, most-recent first. Up to 100.',
        inputSchema: {
            type: 'object',
            properties: {
                leadId:    { type: 'string' },
                leadEmail: { type: 'string' },
                limit:     { type: 'number' },
            },
        },
        endpoint: { method: 'GET', path: '/api/agent/lead-viewed' },
    },
    {
        name: 'share_property_with_lead',
        description: 'Generate a personalized listing URL + draft message for a lead. Returns URL, message, and a tap-ready WhatsApp/SMS/email share link. Does NOT auto-send.',
        inputSchema: {
            type: 'object',
            properties: {
                leadId:  { type: 'string' },
                mlsId:   { type: 'string' },
                channel: { type: 'string', description: 'whatsapp | sms | email' },
                message: { type: 'string' },
            },
            required: ['leadId', 'mlsId'],
        },
        endpoint: { method: 'POST', path: '/api/agent/share-property' },
    },
    {
        name: 'compare_properties',
        description: 'Side-by-side comparison of 2-6 MLS listings. Returns comparison array + summary signals (cheapest $/sqft, newest, waterfront, pool).',
        inputSchema: {
            type: 'object',
            properties: {
                mlsIds: { type: 'array', items: { type: 'string' }, description: '2-6 MLS IDs' },
            },
            required: ['mlsIds'],
        },
        endpoint: { method: 'POST', path: '/api/agent/compare-properties' },
    },
    {
        name: 'get_listing_engagement',
        description: 'How many leads viewed and favorited a specific MLS listing. Returns counts + the lead names/emails.',
        inputSchema: {
            type: 'object',
            properties: { mlsId: { type: 'string' } },
            required: ['mlsId'],
        },
        endpoint: { method: 'GET', path: '/api/agent/listing-engagement' },
    },
    {
        name: 'get_top_listings',
        description: 'Most-viewed listings in past N days (default 7) + most-favorited all-time. Enriched with price, address, photo.',
        inputSchema: {
            type: 'object',
            properties: { days: { type: 'number' } },
        },
        endpoint: { method: 'GET', path: '/api/agent/top-listings' },
    },
    {
        name: 'push_lead_message',
        description: 'Append a message into a lead\'s AI chat conversation. Appears next time they open /listing. CAUTION: invasive — lead sees a message they did not trigger.',
        inputSchema: {
            type: 'object',
            properties: {
                leadEmail: { type: 'string' },
                message:   { type: 'string' },
                sender:    { type: 'string' },
            },
            required: ['leadEmail', 'message'],
        },
        endpoint: { method: 'POST', path: '/api/agent/push-lead-message' },
    },
    {
        name: 'generate_personalized_listing_link',
        description: 'Build a /listing URL with pre-applied filters + auto-login for a lead. Tap and they\'re in.',
        inputSchema: {
            type: 'object',
            properties: {
                leadId:    { type: 'string' },
                leadEmail: { type: 'string' },
                filters: {
                    type: 'object',
                    properties: {
                        city:         { type: 'string' },
                        priceMin:     { type: 'number' },
                        priceMax:     { type: 'number' },
                        bedsMin:      { type: 'number' },
                        bathsMin:     { type: 'number' },
                        waterfront:   { type: 'boolean' },
                        propertyType: { type: 'string' },
                    },
                },
            },
        },
        endpoint: { method: 'POST', path: '/api/agent/personalized-link' },
    },
];

// ── PROXY ──────────────────────────────────────────────────────────────────
// Calls the matching REST endpoint with the user's Bearer token passed through.
async function proxyTool(tool, args, bearerToken) {
    // Special case: get_lead — fetch all + filter client-side
    if (tool.custom === 'get_lead') {
        const res = await fetch(`${baseUrl()}/api/get-leads`, {
            headers: { 'Authorization': `Bearer ${bearerToken}` },
        });
        if (!res.ok) throw new Error(`get-leads failed: ${res.status}`);
        const { leads } = await res.json();
        const q = (args.query || '').toLowerCase();
        const found = leads.find(l =>
            l.id === args.query ||
            (l.name && l.name.toLowerCase().includes(q)) ||
            (l.email && l.email.toLowerCase().includes(q))
        );
        return found || { error: 'No match', searched: leads.length };
    }

    const { method, path } = tool.endpoint;
    let url = `${baseUrl()}${path}`;
    let body = null;

    const remappedArgs = tool.argRemap ? tool.argRemap(args) : args;

    if (method === 'GET') {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(remappedArgs || {})) {
            if (v !== undefined && v !== null && v !== '') params.set(k, v);
        }
        if ([...params].length) url += '?' + params;
    } else {
        body = JSON.stringify(remappedArgs || {});
    }

    const res = await fetch(url, {
        method,
        headers: {
            'Authorization': `Bearer ${bearerToken}`,
            'Content-Type':  'application/json',
        },
        body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${JSON.stringify(data)}`);
    return data;
}

function baseUrl() {
    return process.env.SITE_BASE_URL || 'https://www.homesinsoflorida.com';
}

// ── JSON-RPC RESPONSES ─────────────────────────────────────────────────────
function rpcResult(id, result) {
    return { jsonrpc: '2.0', id, result };
}
function rpcError(id, code, message, data) {
    return { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } };
}

// ── HANDLER ────────────────────────────────────────────────────────────────
export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
            },
        });
    }

    // GET on /api/mcp returns a tiny health/info page (handy for debugging).
    // If a token is supplied via Authorization header OR ?token= query string,
    // we validate it; otherwise we just return public metadata.
    if (req.method === 'GET') {
        const authedGet = authorize(req, null).ok;
        return new Response(JSON.stringify({
            server: 'poler-crm',
            version: '1.0.0',
            transport: 'streamable-http',
            tools: TOOLS.length,
            authenticated: authedGet,
            authentication: 'Authorization: Bearer <token>  OR  ?token=<token> in URL',
        }, null, 2), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        });
    }

    if (req.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }

    // Auth — same multi-token helper as everywhere else.
    // Returns the token used (from Bearer header OR ?token= query string)
    // so we can pass it through when proxying to underlying endpoints.
    const auth = authorize(req, null);
    if (!auth.ok) {
        return new Response(JSON.stringify(rpcError(null, -32001, 'Unauthorized')), {
            status: 401,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
    }
    const bearerToken = auth.token || '';

    let rpc;
    try {
        rpc = await req.json();
    } catch {
        return jsonRpcResponse(rpcError(null, -32700, 'Parse error'));
    }

    const { id = null, method, params = {} } = rpc;

    try {
        switch (method) {
            case 'initialize': {
                return jsonRpcResponse(rpcResult(id, {
                    protocolVersion: '2024-11-05',
                    serverInfo: { name: 'poler-crm', version: '1.0.0' },
                    capabilities: { tools: {} },
                }));
            }
            case 'notifications/initialized': {
                // No response needed for notifications
                return new Response(null, { status: 202 });
            }
            case 'ping': {
                return jsonRpcResponse(rpcResult(id, {}));
            }
            case 'tools/list': {
                return jsonRpcResponse(rpcResult(id, {
                    tools: TOOLS.map(({ name, description, inputSchema }) => ({
                        name, description, inputSchema,
                    })),
                }));
            }
            case 'tools/call': {
                const { name, arguments: args = {} } = params;
                const tool = TOOLS.find(t => t.name === name);
                if (!tool) {
                    return jsonRpcResponse(rpcError(id, -32602, `Unknown tool: ${name}`));
                }
                try {
                    const result = await proxyTool(tool, args, bearerToken);
                    return jsonRpcResponse(rpcResult(id, {
                        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                    }));
                } catch (err) {
                    return jsonRpcResponse(rpcResult(id, {
                        isError: true,
                        content: [{ type: 'text', text: err.message }],
                    }));
                }
            }
            default: {
                return jsonRpcResponse(rpcError(id, -32601, `Method not found: ${method}`));
            }
        }
    } catch (err) {
        return jsonRpcResponse(rpcError(id, -32603, 'Internal error', { detail: err.message }));
    }
}

function jsonRpcResponse(payload) {
    return new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
    });
}
