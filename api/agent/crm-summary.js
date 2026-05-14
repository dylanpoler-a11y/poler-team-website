/**
 * /api/agent/crm-summary.js — Vercel Edge Function
 * One-call dashboard: total leads / hot leads / appointments / new this week,
 * consulting open deals / pipeline $ / overdue tasks, etc.
 *
 * Auth: Bearer token (or password)
 */

export const config = { runtime: 'edge' };

import { authorize } from '../_auth.js';

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
    if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    if (!authorize(req, null).ok) return json({ error: 'Unauthorized' }, 401);

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);

    const headers = { 'Authorization': `Bearer ${apiKey}` };
    const now = Date.now();
    const oneWeekAgo = now - 7 * 86400000;

    // Paginated fetch helper — Airtable caps at 100 per page; loop until done.
    async function fetchAll(table, fields = []) {
        let all = [];
        let offset = null;
        for (let page = 0; page < 10; page++) {
            const params = new URLSearchParams({ pageSize: '100' });
            for (const f of fields) params.append('fields[]', f);
            if (offset) params.set('offset', offset);
            const res = await fetch(
                `https://api.airtable.com/v0/${baseId}/${table}?${params}`,
                { headers }
            );
            if (!res.ok) break;
            const data = await res.json();
            all = all.concat(data.records || []);
            if (!data.offset) break;
            offset = data.offset;
        }
        return all;
    }

    const [leads, reminders, deals, tasks] = await Promise.all([
        fetchAll('Leads', ['Status', 'Assigned To', 'Created At']),
        fetchAll('Reminders', ['Reminder Status', 'Due At']),
        fetchAll('Consulting%20Deals', ['Stage', 'Deal Value', 'Probability']),
        fetchAll('Consulting%20Tasks', ['Status', 'Due At']),
    ]);

    // ── REAL ESTATE STATS ────────────────────────────────────────────────
    const leadsByStatus = {};
    let leadsThisWeek = 0;
    for (const l of leads) {
        const s = l.fields['Status'] || 'New';
        leadsByStatus[s] = (leadsByStatus[s] || 0) + 1;
        const created = l.fields['Created At'];
        if (created && new Date(created).getTime() >= oneWeekAgo) leadsThisWeek++;
    }

    const pendingReminders = reminders.filter(r => r.fields['Reminder Status'] === 'Pending');
    const overdueReminders = pendingReminders.filter(r => {
        const due = r.fields['Due At'];
        return due && new Date(due).getTime() < now;
    });

    // ── CONSULTING STATS ─────────────────────────────────────────────────
    const dealsByStage = {};
    let pipelineTotal = 0;
    let weightedPipeline = 0;
    let closedWonAllTime = 0;
    let closedLostAllTime = 0;
    for (const d of deals) {
        const s = d.fields['Stage'] || 'Pitching';
        dealsByStage[s] = (dealsByStage[s] || 0) + 1;
        const value = d.fields['Deal Value'] || 0;
        const prob  = d.fields['Probability'] ?? 0;
        if (s !== 'Completed' && s !== 'Closed Lost' && s !== 'Won' && s !== 'Lost') {
            pipelineTotal += value;
            weightedPipeline += value * (prob > 1 ? prob / 100 : prob);
        }
        if (s === 'Completed' || s === 'Won') closedWonAllTime++;
        if (s === 'Closed Lost' || s === 'Lost') closedLostAllTime++;
    }
    const winRate = (closedWonAllTime + closedLostAllTime) > 0
        ? Math.round((closedWonAllTime / (closedWonAllTime + closedLostAllTime)) * 100) + '%'
        : '—';

    const pendingTasks = tasks.filter(t => t.fields['Status'] === 'Pending');
    const overdueTasks = pendingTasks.filter(t => {
        const due = t.fields['Due At'];
        return due && new Date(due).getTime() < now;
    });

    return json({
        realEstate: {
            totalLeads:        leads.length,
            leadsByStatus,
            newLeadsThisWeek:  leadsThisWeek,
            hotLeads:          leadsByStatus['Hot'] || 0,
            appointmentsSet:   leadsByStatus['Appointment Set'] || 0,
            pendingReminders:  pendingReminders.length,
            overdueReminders:  overdueReminders.length,
        },
        consulting: {
            totalDeals:        deals.length,
            dealsByStage,
            openPipelineUSD:   Math.round(pipelineTotal),
            weightedPipelineUSD: Math.round(weightedPipeline),
            winRate,
            wonAllTime:        closedWonAllTime,
            lostAllTime:       closedLostAllTime,
            pendingTasks:      pendingTasks.length,
            overdueTasks:      overdueTasks.length,
        },
        timestamp: new Date().toISOString(),
    });
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            // Cache successful summaries at the edge for 60s — drastically
            // reduces Airtable API load when multiple users or repeated MCP
            // calls hit this in quick succession.
            ...(status === 200 ? { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=30' } : {}),
        },
    });
}
