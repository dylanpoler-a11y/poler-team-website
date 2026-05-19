/**
 * /api/get-dev-projects.js — list The Poler Team's Development Projects
 * (Belle Meade Investments LLC, etc.). Reads the `Development Projects`
 * Airtable table and returns rows + linked activity counts.
 *
 * Auth: bearer token (agents) or password (CRM dashboard).
 *
 * Query: ?id=recXXX → single project + its activity; otherwise all.
 */

export const config = { runtime: 'edge' };

import { authorize } from './_auth.js';

const TABLE = 'Development%20Projects';
const ACTIVITY_TABLE = 'Consulting%20Activity';

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

    const apiKey = process.env.AIRTABLE_API_KEY;
    const baseId = process.env.AIRTABLE_BASE_ID;
    if (!authorize(req, null).ok) return json({ error: 'Unauthorized' }, 401);
    if (!apiKey || !baseId) return json({ error: 'Airtable not configured' }, 500);

    const url = new URL(req.url);
    const projectId = url.searchParams.get('id');

    const headers = { Authorization: `Bearer ${apiKey}` };

    // Fetch projects
    const projectsRes = await fetch(
        `https://api.airtable.com/v0/${baseId}/${TABLE}?pageSize=100`,
        { headers }
    );
    if (!projectsRes.ok) {
        const err = await projectsRes.json().catch(() => ({}));
        return json({ error: err.error?.message || 'Airtable error', projects: [] }, projectsRes.status);
    }
    const data = await projectsRes.json();
    const projects = (data.records || []).map(normalizeProject);

    // If specific id requested, also pull its activity
    if (projectId) {
        const project = projects.find(p => p.id === projectId);
        if (!project) return json({ error: 'Project not found' }, 404);

        // Fetch ALL activity, filter client-side by Development Projects link
        // (same approach as get-consulting-activity — Airtable's ARRAYJOIN
        // returns names not IDs so server-side FIND doesn't work reliably)
        let activity = [];
        let offset = null;
        for (let page = 0; page < 10; page++) {
            const p = new URLSearchParams({ pageSize: '100' });
            if (offset) p.set('offset', offset);
            const r = await fetch(`https://api.airtable.com/v0/${baseId}/${ACTIVITY_TABLE}?${p}`, { headers });
            if (!r.ok) break;
            const d = await r.json();
            activity = activity.concat((d.records || []).map(rec => ({
                id: rec.id,
                title: rec.fields?.['Title'] || '',
                type: (rec.fields?.['Type']?.name) || rec.fields?.['Type'] || 'Note',
                details: rec.fields?.['Details'] || '',
                agent: (rec.fields?.['Agent']?.name) || rec.fields?.['Agent'] || '',
                links: rec.fields?.['Links'] || '',
                projectIds: (rec.fields?.['Development Projects'] || []).map(x => typeof x === 'string' ? x : x.id),
                createdAt: rec.createdTime,
            })));
            if (!d.offset) break;
            offset = d.offset;
        }
        activity = activity.filter(a => a.projectIds.includes(projectId));
        activity.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        return json({ project, activity });
    }

    return json({ projects });
}

function normalizeProject(rec) {
    const f = rec.fields || {};
    return {
        id: rec.id,
        projectName: f['Project Name'] || '',
        address: f['Address'] || '',
        status: (f['Status']?.name) || f['Status'] || '',
        acquisitionDate: f['Acquisition Date'] || '',
        acquisitionPrice: f['Acquisition Price'] || 0,
        targetExitMin: f['Target Exit Min'] || 0,
        targetExitMax: f['Target Exit Max'] || 0,
        demoTargetDate: f['Demo Target Date'] || '',
        owner: (f['Owner']?.name) || f['Owner'] || '',
        gps: f['GPs'] || '',
        lps: f['LPs'] || '',
        notes: f['Notes'] || '',
        createdAt: rec.createdTime,
    };
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
}
