/**
 * Poler Team CRM — crm.js
 * CINC-inspired real estate agent dashboard
 */

// ── CONFIG ─────────────────────────────────────────────────────────────────
const CRM_API_BASE = 'https://poler-team-website-two.vercel.app';
// Bridge MLS calls go through the server-side proxy (api/bridge/listings.js) —
// the access token lives in the Vercel env, never in this public file. (2026-07-17)
const BRIDGE_BASE  = '/api/bridge';
const STATUSES = ['New','Contacted','Warm','Hot','Appointment Set','Under Contract','Closed','Dead'];

const AGENTS = [
  { name: 'Kevin', email: 'kevinpolermiami@gmail.com' },
  { name: 'Dylan', email: 'dylan@poler.org' },
  { name: 'Rosa',  email: 'rosadasilvapoler@gmail.com' },
  { name: 'Noel',  email: 'noel@poler.org' },
];

// ── STATE ──────────────────────────────────────────────────────────────────
let allLeads      = [];
let filteredLeads = [];
let sortField     = 'createdAt';
let sortDir       = 'desc';
let currentPassword = '';
let activeLead    = null;
let currentAgent  = null;   // { name, email }
let currentView   = 'dashboard';
let allReminders  = [];
let filteredReminders = [];
let allAICalls    = [];        // AI Calls tab
let aiCallsChart  = null;
let aiCallsLoading = false;    // in-flight guard — prevents stacked concurrent refreshes
let aiCallsLastGood = null;    // last successful non-empty response (resilience fallback)
let aiCallsFetchedAt = 0;      // ms timestamp of last successful fetch (client cache)
let aiCallsFetchedKey = '';    // the from|to range that cache was fetched for
const AI_CALLS_CACHE_MS = 60000; // re-opening AI Calls within 60s skips the network round-trip
let allClients    = [];
let filteredClients = [];
let currentClient = null;
let clientSaveTimer = null;
let allDeals      = [];
let filteredDeals = [];
let currentDeal   = null;
let dealSaveTimer = null;
let allConsultingTasks    = [];
let allConsultingActivity = [];
let allConsultingContacts = [];
let allConsultingPartners = [];
let pendingDealCompanyId  = null;  // set when "+ New Deal" is clicked from a company panel
let pendingTaskContext    = null;  // { companyId, dealId? } when "+ New Task" is clicked
let pendingContactCompanyId = null;

// ── DOM READY ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Wire share modal once (works on first lead opened)
  initShareModal();

  // If already authenticated this session, skip login
  const savedPass  = sessionStorage.getItem('crm_auth');
  const savedEmail = sessionStorage.getItem('crm_agent_email');
  if (savedPass && savedEmail) {
    currentPassword = savedPass;
    const agent = AGENTS.find(a => a.email.toLowerCase() === savedEmail.toLowerCase());
    if (agent) {
      currentAgent = agent;
    }
    // Re-stamp team-member flag on every auth resume (refreshes the timestamp
    // so /listing suppression doesn't drift even if localStorage gets older).
    localStorage.setItem('poler_team_member', savedEmail);
    localStorage.setItem('poler_team_member_ts', String(Date.now()));
    showDashboard();
    loadLeads();
    loadReminders();
    loadClients();
    loadDeals();
    loadConsultingTasks();
    loadConsultingContacts();
    loadConsultingPartners();
    loadLGLeads();
    loadLGTasks();
    return;
  }

  // Wire up login form
  const loginBtn   = document.getElementById('crm-login-btn');
  const passInput  = document.getElementById('crm-password-input');
  const emailInput = document.getElementById('crm-email-input');
  const loginError = document.getElementById('login-error');

  loginBtn.addEventListener('click', attemptLogin);
  passInput.addEventListener('keydown', e => { if (e.key === 'Enter') attemptLogin(); });
  emailInput.addEventListener('keydown', e => { if (e.key === 'Enter') passInput.focus(); });

  async function attemptLogin() {
    const email = (emailInput ? emailInput.value.trim() : '');
    const pass  = passInput.value.trim();
    if (!pass) return;

    // Validate agent email
    if (!email) {
      loginError.textContent = 'Please enter your agent email.';
      loginError.style.display = 'block';
      return;
    }
    const agent = AGENTS.find(a => a.email.toLowerCase() === email.toLowerCase());
    if (!agent) {
      loginError.textContent = 'Email not recognized. Contact your admin.';
      loginError.style.display = 'block';
      return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in…';
    loginError.style.display = 'none';

    try {
      const res = await fetch(`${CRM_API_BASE}/api/get-leads?password=${encodeURIComponent(pass)}`);

      if (res.status === 401) {
        loginError.textContent = 'Incorrect password. Please try again.';
        loginError.style.display = 'block';
        loginBtn.disabled = false;
        loginBtn.textContent = 'Sign In →';
        return;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      currentPassword = pass;
      currentAgent = agent;
      sessionStorage.setItem('crm_auth', pass);
      sessionStorage.setItem('crm_agent_email', agent.email);
      // Long-lived flag so /listing knows this device belongs to a team member
      // and suppresses the 10s signup popup (Rosa was hitting it every visit
      // because her localStorage gets wiped by Safari ITP).
      localStorage.setItem('poler_team_member', agent.email);
      localStorage.setItem('poler_team_member_ts', String(Date.now()));
      // Server-set 1-year cookie for the same purpose — survives the Safari ITP
      // wipe that kills the localStorage flag (2026-09-10). Same-origin on purpose.
      fetch('/api/remember', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: true, password: pass }) }).catch(() => {});
      allLeads = data.leads || [];
      showDashboard();
      renderAll();
      loadReminders();
      loadClients();
      loadDeals();
      loadConsultingTasks();
      loadConsultingContacts();
      loadConsultingPartners();
      loadLGLeads();
      loadLGTasks();
    } catch (err) {
      console.error('Login error:', err);
      loginError.textContent = 'Connection error. Please try again.';
      loginError.style.display = 'block';
      loginBtn.disabled = false;
      loginBtn.textContent = 'Sign In →';
    }
  }
});

// ── SHOW DASHBOARD ─────────────────────────────────────────────────────────
function showDashboard() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('crm-app').style.display = 'block';
  document.getElementById('loading-state').style.display = 'none';

  // Show agent name in sidebar
  const agentEl = document.getElementById('sidebar-agent');
  if (agentEl && currentAgent) {
    agentEl.textContent = `Logged in as ${currentAgent.name}`;
  }

  // Populate reminder agent filter
  const agentFilter = document.getElementById('reminder-agent-filter');
  if (agentFilter) {
    agentFilter.innerHTML = '<option value="">All Agents</option>';
    AGENTS.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.email;
      opt.textContent = a.name;
      agentFilter.appendChild(opt);
    });
    // Default to the logged-in agent's own reminders (Kevin 2026-06-24) — he can
    // switch to "All Agents" anytime; this just stops other agents' reminders
    // cluttering his default view.
    if (currentAgent && currentAgent.email) agentFilter.value = currentAgent.email;
  }

  setupEvents();
}

// ── LOAD LEADS ─────────────────────────────────────────────────────────────
async function loadLeads() {
  const loadingState = document.getElementById('loading-state');
  const tbody        = document.getElementById('leads-tbody');
  const emptyState   = document.getElementById('empty-state');

  loadingState.style.display = 'block';
  tbody.innerHTML = '';
  emptyState.style.display = 'none';

  try {
    const res = await fetch(`${CRM_API_BASE}/api/get-leads?password=${encodeURIComponent(currentPassword)}`);

    if (res.status === 401) {
      sessionStorage.removeItem('crm_auth');
      sessionStorage.removeItem('crm_agent_email');
      location.reload();
      return;
    }

    const data = await res.json();
    allLeads = data.leads || [];
    document.getElementById('last-refreshed').textContent =
      `Last refreshed: ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    console.error('Failed to load leads:', err);
  }

  loadingState.style.display = 'none';
  renderAll();
}

// ── LOAD REMINDERS ─────────────────────────────────────────────────────────
async function loadReminders() {
  try {
    const res = await fetch(`${CRM_API_BASE}/api/get-reminders?password=${encodeURIComponent(currentPassword)}`);
    if (res.ok) {
      const data = await res.json();
      allReminders = data.reminders || [];
      updateReminderBadge();
      // Always re-render so the Reminders pages are in sync even if the user
      // switches into them later without an extra network round-trip
      renderReminders();
      renderSammyReminders();
    }
  } catch (err) {
    console.error('Failed to load reminders:', err);
  }
}

// Sammy (the AI agent) keeps ONE Pending reminder per active lead — hundreds of
// rows that would drown the human Reminders view. They live on their own page.
function isSammyReminder(r) {
  return String(r.agentName || '').trim().toLowerCase() === 'sammy';
}

function updateReminderBadge() {
  const badge = document.getElementById('reminder-badge');
  const now = Date.now();
  if (badge) {
    const pending = allReminders.filter(r =>
      !isSammyReminder(r) && r.status === 'Pending' && new Date(r.dueAt).getTime() <= now + 86400000 * 7
    );
    if (pending.length > 0) {
      badge.textContent = pending.length;
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  }
  // Sammy badge = OVERDUE only. The engine keeps a standing future reminder per
  // lead, so "pending" is always ~100+; overdue is the actionable signal.
  const sBadge = document.getElementById('sammy-reminder-badge');
  if (sBadge) {
    const overdue = allReminders.filter(r =>
      isSammyReminder(r) && r.status === 'Pending' && new Date(r.dueAt).getTime() < now
    );
    if (overdue.length > 0) {
      sBadge.textContent = overdue.length;
      sBadge.style.display = 'inline-flex';
    } else {
      sBadge.style.display = 'none';
    }
  }
}

// ── VIEW SWITCHING ─────────────────────────────────────────────────────────
function switchView(view) {
  currentView = view;
  const views = {
    dashboard:     document.getElementById('dashboard-view'),
    reminders:     document.getElementById('reminders-view'),
    'sammy-reminders': document.getElementById('sammy-reminders-view'),
    listings:      document.getElementById('listings-view'),
    clients:       document.getElementById('clients-view'),
    pipeline:      document.getElementById('pipeline-view'),
    'cons-tasks':  document.getElementById('cons-tasks-view'),
    opportunities: document.getElementById('opportunities-view'),
    partners:      document.getElementById('partners-view'),
    'ai-calls':    document.getElementById('ai-calls-view'),
    autoresearch:  document.getElementById('autoresearch-view'),
    leadgen:       document.getElementById('leadgen-view'),
    'leadgen-pipeline': document.getElementById('leadgen-pipeline-view'),
    'leadgen-reminders': document.getElementById('leadgen-reminders-view'),
  };

  Object.values(views).forEach(el => { if (el) el.style.display = 'none'; });

  document.querySelectorAll('.nav-item[data-action]').forEach(el => {
    el.classList.remove('active');
    if (el.dataset.action === view || (view === 'dashboard' && el.dataset.action === 'dashboard')) {
      el.classList.add('active');
    }
  });

  if (view === 'reminders') {
    if (views.reminders) views.reminders.style.display = 'block';
    renderReminders();   // instant paint from cache…
    loadReminders();     // …then refetch so reminders created out-of-band
                         // (Flash follow-ups, Sammy, another device) appear
                         // without a full page reload. 2026-07-16.
  } else if (view === 'sammy-reminders') {
    if (views['sammy-reminders']) views['sammy-reminders'].style.display = 'block';
    renderSammyReminders();
  } else if (view === 'clients') {
    if (views.clients) views.clients.style.display = 'block';
    renderClients();
  } else if (view === 'pipeline') {
    if (views.pipeline) views.pipeline.style.display = 'block';
    renderPipeline();
  } else if (view === 'cons-tasks') {
    if (views['cons-tasks']) views['cons-tasks'].style.display = 'block';
    renderConsultingTasks();
  } else if (view === 'opportunities') {
    if (views.opportunities) views.opportunities.style.display = 'block';
    renderOpportunitiesTable();
  } else if (view === 'partners') {
    if (views.partners) views.partners.style.display = 'block';
    renderPartnersTable();
  } else if (view === 'listings') {
    if (views.listings) views.listings.style.display = 'block';
    loadListings();
  } else if (view === 'ai-calls') {
    if (views['ai-calls']) views['ai-calls'].style.display = 'block';
    const fI = document.getElementById('ai-from');
    if (fI && !fI.value) aiApplyRange('7d', document.querySelector('.ai-range-chip[data-range="7d"]'));
    else loadAICalls();
  } else if (view === 'autoresearch') {
    if (views.autoresearch) views.autoresearch.style.display = 'block';
    initAutoresearch();
  } else if (view === 'leadgen') {
    if (views.leadgen) views.leadgen.style.display = 'block';
    renderLGLeads();
    loadLGLeads();
  } else if (view === 'leadgen-pipeline') {
    if (views['leadgen-pipeline']) views['leadgen-pipeline'].style.display = 'block';
    renderLGPipeline();
    loadLGLeads();
  } else if (view === 'leadgen-reminders') {
    if (views['leadgen-reminders']) views['leadgen-reminders'].style.display = 'block';
    renderLGReminders();          // paint from cache, then refetch (same pattern as the RE view)
    loadLGTasks();
    if (!allLGLeads.length) loadLGLeads();
  } else {
    if (views.dashboard) views.dashboard.style.display = 'block';
  }
}

// ─── Autoresearch dashboards (gated Vercel embeds; the /crm page is already auth-gated) ───
const AUTORESEARCH_URLS = {
  overview:    'https://dashboards-hub-phi.vercel.app/?key=PolerDash2026',
  instantly:   'https://dashboards-hub-phi.vercel.app/instantly?key=PolerDash2026',
  ads:         'https://conv-dashboard-eight.vercel.app/?key=PolerConv2026',
  crm:         'https://dashboards-hub-phi.vercel.app/crm?key=PolerDash2026',
  wa:          'https://dashboards-hub-phi.vercel.app/wa?key=PolerDash2026',
  reliability: 'https://dashboards-hub-phi.vercel.app/reliability?key=PolerDash2026',
  facebook:    'https://dashboards-hub-phi.vercel.app/facebook?key=PolerDash2026',
  copy:        'https://dashboards-hub-phi.vercel.app/copy?key=PolerDash2026',
};
let _autoresearchInit = false;
function loadAutoresearchTab(key) {
  const iframe = document.getElementById('autoresearch-iframe');
  if (!iframe || !AUTORESEARCH_URLS[key]) return;
  // Fresh cache-busting param on every load. Chrome partitions its HTTP cache by
  // top-level site, and a bad response cached under the (homesinsoflorida.com, exact
  // dashboard URL) key made the iframe render a grey dead page FOREVER — reloads never
  // healed it, while the same URL worked top-level (different cache partition) and in
  // other browsers (2026-08-25). A unique query string per open makes every load a
  // fresh cache key, so no poisoned entry can ever stick. The dashboards are tiny
  // static pages republished every few minutes — losing browser cache costs nothing.
  iframe.src = AUTORESEARCH_URLS[key] + '&t=' + Date.now();
  document.querySelectorAll('#autoresearch-subnav .ar-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.ar === key);
  });
}
function initAutoresearch() {
  if (_autoresearchInit) return;
  _autoresearchInit = true;
  document.querySelectorAll('#autoresearch-subnav .ar-tab').forEach(btn => {
    btn.addEventListener('click', () => loadAutoresearchTab(btn.dataset.ar));
  });
  loadAutoresearchTab('overview');  // lazy-load on first open
}

// ══════════════════════════════════════════════════════════════════════════
// AI CALLS TAB — joins ElevenLabs (calls/recordings) + CRM (checkmarks).
// Data route: /api/agent/ai-calls ; audio: /api/agent/ai-call-audio
// ══════════════════════════════════════════════════════════════════════════
function aiSetActiveChip(chipEl) {
  document.querySelectorAll('.ai-range-chip').forEach(c => c.classList.remove('active'));
  if (chipEl) chipEl.classList.add('active');
}
function aiYmd(d) { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
function aiApplyRange(range, chipEl) {
  aiSetActiveChip(chipEl);
  const now = new Date(); let from = null;
  if (range === 'today') from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  else if (range === '7d') { from = new Date(now); from.setDate(now.getDate() - 6); }
  else if (range === '30d') { from = new Date(now); from.setDate(now.getDate() - 29); }
  else if (range === 'month') from = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (range === 'all') from = null;
  const fI = document.getElementById('ai-from'), tI = document.getElementById('ai-to');
  if (fI) fI.value = from ? aiYmd(from) : '';
  if (tI) tI.value = range === 'all' ? '' : aiYmd(now);
  loadAICalls();
}
async function loadAICalls(force = false) {
  if (!currentPassword) return;
  const from = (document.getElementById('ai-from') || {}).value || '';
  const to = (document.getElementById('ai-to') || {}).value || '';
  const cacheKey = `${from}|${to}`;
  // Client cache: re-opening AI Calls with the same range within the window renders
  // the last result INSTANTLY with no network round-trip. The ↻ Refresh button
  // (force=true) and any date change (different key) always refetch.
  if (!force && aiCallsLastGood && cacheKey === aiCallsFetchedKey &&
      (Date.now() - aiCallsFetchedAt) < AI_CALLS_CACHE_MS) {
    allAICalls = aiCallsLastGood;
    if (currentView === 'ai-calls') renderAICalls();
    const lr = document.getElementById('ai-last-refreshed');
    if (lr) lr.textContent = `Updated ${new Date(aiCallsFetchedAt).toLocaleTimeString()} (en caché)`;
    return;
  }
  // Debounce: ignore rapid re-clicks while a fetch is already in flight.
  if (aiCallsLoading) return;
  aiCallsLoading = true;
  const loading = document.getElementById('ai-calls-loading');
  const refreshBtn = document.getElementById('ai-refresh-btn');
  const q = new URLSearchParams({ password: currentPassword });
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  if (loading) loading.style.display = 'block';
  if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.textContent = 'Loading…'; }
  try {
    const res = await fetch(`${CRM_API_BASE}/api/agent/ai-calls?${q}`);
    if (res.ok) {
      const data = await res.json();
      // Only replace the displayed data when the new result is non-empty OR there was
      // no prior good data — never blank the table just because a rapid refresh got
      // an empty response from a rate-limited or partial backend call.
      const newCalls = (data && data.calls) || [];
      const hadCalls = aiCallsLastGood && ((aiCallsLastGood.calls || []).length > 0);
      if (newCalls.length > 0 || !hadCalls) {
        allAICalls = data;
        aiCallsLastGood = data;
      } else {
        // Empty result while we had real data — keep prior data, just update timestamp.
        allAICalls = aiCallsLastGood;
        const lr = document.getElementById('ai-last-refreshed');
        if (lr) lr.textContent = `Updated ${new Date().toLocaleTimeString()} (cached)`;
      }
      // Stamp the client cache so re-opening AI Calls with this range skips the round-trip.
      aiCallsFetchedAt = Date.now();
      aiCallsFetchedKey = cacheKey;
    } else {
      // HTTP error — preserve whatever we last had so the table stays populated.
      console.warn('AI calls fetch error HTTP', res.status);
      if (!aiCallsLastGood) allAICalls = { calls: [], stats: {}, byDay: [], error: `HTTP ${res.status}` };
      // else: leave allAICalls as-is (keeps prior render)
    }
  } catch (err) {
    console.error('Failed to load AI calls:', err);
    if (!aiCallsLastGood) allAICalls = { calls: [], stats: {}, byDay: [] };
    // else: leave allAICalls as-is
  } finally {
    aiCallsLoading = false;
    if (loading) loading.style.display = 'none';
    if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.textContent = '↻ Refresh'; }
  }
  if (currentView === 'ai-calls') renderAICalls();
}
function aiStatCard(icon, cls, number, label) {
  return `<div class="stat-card"><div class="stat-icon ${cls}">${icon}</div><div><div class="stat-number">${number}</div><div class="stat-label">${label}</div></div></div>`;
}
function aiFmtTime(iso) { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function aiDur(s) { return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; }
function aiChk(v) { return v ? '<span class="ai-chk yes">✓</span>' : '<span class="ai-chk no">—</span>'; }
function aiEsc(s) { return String(s || '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }
function renderAICalls() {
  const data = allAICalls || {};
  const calls = data.calls || [];
  const s = data.stats || { total: 0, picked: 0, pickupRate: 0 };
  const totalSecs = calls.reduce((a, c) => a + (c.durationSecs || 0), 0);
  const avg = calls.length ? Math.round(totalSecs / calls.length) : 0;
  const sr = document.getElementById('ai-stats-row');
  if (sr) sr.innerHTML =
    aiStatCard('📞', 'blue', s.total, 'Total calls') +
    aiStatCard('✅', 'green', `${s.picked} <small style="font-size:0.8rem;color:var(--text-muted)">(${s.pickupRate || 0}%)</small>`, 'Picked up') +
    aiStatCard('🚫', 'red', (s.total || 0) - (s.picked || 0), 'No answer') +
    aiStatCard('⏱️', 'teal', `${avg}s`, 'Avg duration');
  const rc = document.getElementById('ai-range-count'); if (rc) rc.textContent = `${calls.length} calls`;
  const lr = document.getElementById('ai-last-refreshed'); if (lr) lr.textContent = `Updated ${new Date().toLocaleTimeString()}`;

  const byDay = data.byDay || [];
  const ctx = document.getElementById('ai-chart');
  if (ctx && window.Chart) {
    if (aiCallsChart) aiCallsChart.destroy();
    aiCallsChart = new Chart(ctx, {
      type: 'bar',
      data: { labels: byDay.map((b) => b.date.slice(5)), datasets: [
        { label: 'Calls', data: byDay.map((b) => b.total), backgroundColor: '#c7d2fe', borderRadius: 4 },
        { label: 'Picked up', data: byDay.map((b) => b.picked), backgroundColor: '#1a2744', borderRadius: 4 } ] },
      options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } } },
    });
  }

  const tb = document.getElementById('ai-calls-tbody'); if (!tb) return;
  if (!calls.length) { tb.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:2.5rem;color:var(--text-muted)">No calls in this range yet.</td></tr>'; return; }
  tb.innerHTML = calls.map((c) => {
    const clickable = !!c.leadId;
    return `
    <tr${clickable ? ` data-lead-id="${aiEsc(c.leadId)}" class="ai-call-row-clickable" title="Open lead profile"` : ''}>
      <td>${aiFmtTime(c.startIso)}</td>
      <td>${aiEsc(c.leadName)}</td>
      <td>${aiEsc(c.phone) || '—'}</td>
      <td><span class="ai-mode ${c.mode}">${(c.mode || '').replace('_', ' ')}</span></td>
      <td>${aiDur(c.durationSecs)}</td>
      <td>${c.pickedUp ? '<span class="ai-pickup-yes">✓ Yes</span>' : '<span class="ai-pickup-no">✗ No</span>'}</td>
      <td>${c.hasAudio ? `<button class="ai-play" data-id="${c.conversationId}">▶ Play</button>` : '—'}</td>
      <td class="center">${aiChk(c.checks && c.checks.noteLogged)}</td>
      <td class="center">${aiChk(c.checks && c.checks.reminderCreated)}</td>
      <td class="center">${aiChk(c.checks && c.checks.alertsSet)}</td>
      <td class="center">${aiChk(c.checks && c.checks.whatsappSent)}</td>
    </tr>`;
  }).join('');
  // Attach click listeners for rows that have a matched lead
  tb.querySelectorAll('tr.ai-call-row-clickable').forEach(row => {
    row.addEventListener('click', (e) => {
      // Don't steal clicks on the audio play button
      if (e.target.closest('button.ai-play, audio')) return;
      openPanel(row.dataset.leadId);
    });
  });
}
function aiPlayAudio(btn) {
  const id = btn.dataset.id;
  const a = document.createElement('audio');
  a.controls = true; a.autoplay = true;
  a.src = `${CRM_API_BASE}/api/agent/ai-call-audio?id=${encodeURIComponent(id)}&password=${encodeURIComponent(currentPassword)}`;
  btn.replaceWith(a);
}

// ── RENDER REMINDERS ───────────────────────────────────────────────────────
function renderReminders() {
  const tbody   = document.getElementById('reminders-tbody');
  const table   = document.getElementById('reminders-table');
  const empty   = document.getElementById('reminders-empty');
  const loading = document.getElementById('reminders-loading');

  loading.style.display = 'none';

  // Apply filters
  const statusFilter = document.getElementById('reminder-status-filter');
  const agentFilter  = document.getElementById('reminder-agent-filter');
  const filterStatus = statusFilter ? statusFilter.value : '';
  const filterAgent  = agentFilter ? agentFilter.value : '';

  filteredReminders = allReminders.filter(r => {
    if (isSammyReminder(r)) return false;   // Sammy's live on their own page
    if (filterStatus && r.status !== filterStatus) return false;
    // Agent filter: hide a reminder ONLY when it is explicitly owned by a
    // DIFFERENT human agent. Reminders with a blank Agent Email — every Flash
    // Coach follow-up + any manually-created one that never got an email set —
    // are team follow-ups and MUST stay visible under any agent selection.
    // (The filter auto-selects the logged-in agent on load, so a strict
    // email-equality test silently hid all 48 Flash-Coach call reminders and
    // the handful of blank-email manual ones from Kevin's page. 2026-07-16.)
    if (filterAgent) {
      const remEmail = (r.agentEmail || '').trim().toLowerCase();
      if (remEmail && remEmail !== filterAgent.toLowerCase()) return false;
    }
    return true;
  });

  // Update the count label next to the "Reminders" heading so Kevin can see
  // how many reminders he has when filtered to just himself vs. all agents.
  const countLabel = document.getElementById('reminders-count-label');
  if (countLabel) {
    const total = filteredReminders.length;
    let who;
    if (filterAgent) {
      const agent = AGENTS.find(a => a.email.toLowerCase() === filterAgent.toLowerCase());
      who = agent ? agent.name : 'agent';
    } else {
      who = 'all agents';
    }
    // Compute due-today vs overdue counts from pending reminders
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfToday   = startOfToday + 24 * 60 * 60 * 1000;
    let dueTodayCount = 0;
    let overdueCount  = 0;
    filteredReminders.forEach(r => {
      if (r.status !== 'Pending') return;
      const due = r.dueAt ? new Date(r.dueAt).getTime() : NaN;
      if (isNaN(due)) return;
      if (due < startOfToday) {
        overdueCount++;
      } else if (due < endOfToday) {
        dueTodayCount++;
      }
    });

    countLabel.textContent = `${total} total · ${dueTodayCount} due today · ${overdueCount} overdue · ${who}`;
    countLabel.style.display = 'inline-block';
  }

  if (filteredReminders.length === 0) {
    table.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  table.style.display = 'table';

  const now = Date.now();

  tbody.innerHTML = filteredReminders.map(r => reminderRowHtml(r, now)).join('');
}

// Shared row template for the human Reminders view and Sammy's Reminders view.
// Element ids are keyed by reminder id, and a reminder renders in exactly one
// of the two tables, so ids never collide.
function reminderRowHtml(r, now) {
  const dueDate = new Date(r.dueAt);
  const isOverdue = r.status === 'Pending' && dueDate.getTime() < now;
  const rowClass = isOverdue ? 'reminder-overdue' : '';
  const actionClass = 'action-type-' + (r.actionType || 'Other').replace(/\s+/g, '-');

  const dueStr = dueDate.getTime() ? formatReminderDate(dueDate) : '—';
  const statusBadge = r.status === 'Pending'
    ? (isOverdue ? '<span class="reminder-status-badge overdue">Overdue</span>' : '<span class="reminder-status-badge pending">Pending</span>')
    : r.status === 'Completed'
      ? '<span class="reminder-status-badge completed">Done</span>'
      : '<span class="reminder-status-badge cancelled">Cancelled</span>';

  // Format for datetime-local input (YYYY-MM-DDTHH:MM)
  const dtLocal = dueDate.getTime() ? `${dueDate.getFullYear()}-${String(dueDate.getMonth()+1).padStart(2,'0')}-${String(dueDate.getDate()).padStart(2,'0')}T${String(dueDate.getHours()).padStart(2,'0')}:${String(dueDate.getMinutes()).padStart(2,'0')}` : '';

  const actions = r.status === 'Pending'
    ? `<button class="reminder-action-btn done" onclick="completeReminder('${r.id}')">Done</button>
       <button class="reminder-action-btn cancel" onclick="cancelReminder('${r.id}')">Cancel</button>
       <button class="reminder-action-btn edit" onclick="toggleReminderEdit('${r.id}')">Edit</button>`
    : '';

  const agentOptions = AGENTS.map(a =>
    `<option value="${escHtml(a.name)}" ${a.name === r.agentName ? 'selected' : ''}>${escHtml(a.name)}</option>`
  ).join('');

  return `
    <tr class="${rowClass}">
      <td class="td-muted">
        <span id="reminder-due-text-${r.id}">${escHtml(dueStr)}</span>
        <div id="reminder-edit-${r.id}" class="reminder-edit-row" style="display:none;">
          <input type="datetime-local" id="reminder-dt-${r.id}" class="reminder-dt-input" value="${dtLocal}">
          <select id="reminder-agent-${r.id}" class="reminder-dt-input" style="margin-top:4px">${agentOptions}</select>
          <button class="reminder-action-btn done" style="margin-top:4px" onclick="saveReminderEdit('${r.id}')">Save</button>
        </div>
      </td>
      <td>
        <div class="lead-name" style="cursor:pointer" onclick="openPanelFromReminder('${escHtml(r.leadRecordId)}')">${escHtml(r.leadName || '—')}</div>
        <div class="td-muted" style="font-size:0.75rem">${escHtml(r.leadPhone || '')}</div>
      </td>
      <td><span class="action-type-badge ${actionClass}">${escHtml(r.actionType || '—')}</span></td>
      <td class="td-muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(r.note)}">${escHtml(r.note || '—')}</td>
      <td class="td-muted"><span id="reminder-agent-text-${r.id}">${escHtml(r.agentName || '—')}</span></td>
      <td>${statusBadge}</td>
      <td>${actions}</td>
    </tr>`;
}

// ── RENDER SAMMY'S REMINDERS ───────────────────────────────────────────────
// This page IS Sammy's schedule (Kevin 2026-06-12): every planned touch keeps
// exactly one Pending reminder (followup mirror + crm-react enroll-time
// reminders), so Pending = what Sammy does next, Completed = what it did.
// Same table shape as the human view, but ONLY Agent Name "Sammy" rows —
// the AI engine's next-planned-touch mirror (one Pending reminder per lead).
function renderSammyReminders() {
  const tbody   = document.getElementById('sammy-reminders-tbody');
  const table   = document.getElementById('sammy-reminders-table');
  const empty   = document.getElementById('sammy-reminders-empty');
  const loading = document.getElementById('sammy-reminders-loading');
  if (!tbody || !table) return;

  if (loading) loading.style.display = 'none';

  const statusFilter = document.getElementById('sammy-reminder-status-filter');
  const filterStatus = statusFilter ? statusFilter.value : '';

  const rows = allReminders.filter(r => {
    if (!isSammyReminder(r)) return false;
    if (filterStatus && r.status !== filterStatus) return false;
    return true;
  });

  // Soonest due first so the next calls Sammy will make sit at the top.
  rows.sort((a, b) => new Date(a.dueAt || 0) - new Date(b.dueAt || 0));

  const countLabel = document.getElementById('sammy-reminders-count-label');
  if (countLabel) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfToday   = startOfToday + 24 * 60 * 60 * 1000;
    let dueTodayCount = 0, overdueCount = 0;
    rows.forEach(r => {
      if (r.status !== 'Pending') return;
      const due = r.dueAt ? new Date(r.dueAt).getTime() : NaN;
      if (isNaN(due)) return;
      if (due < Date.now()) overdueCount++;
      else if (due < endOfToday) dueTodayCount++;
    });
    countLabel.textContent = `${rows.length} total · ${dueTodayCount} due later today · ${overdueCount} overdue`;
    countLabel.style.display = 'inline-block';
  }

  if (rows.length === 0) {
    table.style.display = 'none';
    if (empty) empty.style.display = 'block';
    return;
  }

  if (empty) empty.style.display = 'none';
  table.style.display = 'table';

  const now = Date.now();
  tbody.innerHTML = rows.map(r => reminderRowHtml(r, now)).join('');
}

function formatReminderDate(date) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86400000);
  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (dateOnly.getTime() === today.getTime()) return `Today ${time}`;
  if (dateOnly.getTime() === tomorrow.getTime()) return `Tomorrow ${time}`;
  if (dateOnly < today) {
    const days = Math.floor((today - dateOnly) / 86400000);
    return `${days}d overdue`;
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ` ${time}`;
}

// ── REMINDER ACTIONS ───────────────────────────────────────────────────────
async function completeReminder(id) {
  await updateReminderStatus(id, 'Completed');
}

async function cancelReminder(id) {
  await updateReminderStatus(id, 'Cancelled');
}

async function updateReminderStatus(id, status) {
  try {
    const res = await fetch(`${CRM_API_BASE}/api/update-reminder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status, password: currentPassword }),
    });
    const data = await res.json();
    if (data.success) {
      const reminder = allReminders.find(r => r.id === id);
      if (reminder) reminder.status = status;
      updateReminderBadge();
      renderReminders();
    }
  } catch (err) {
    console.error('Failed to update reminder:', err);
  }
}

function toggleReminderEdit(id) {
  const editEl = document.getElementById(`reminder-edit-${id}`);
  if (editEl) editEl.style.display = editEl.style.display === 'none' ? 'block' : 'none';
}

async function saveReminderDate(id) {
  // Backward-compat wrapper
  return saveReminderEdit(id);
}

async function saveReminderEdit(id) {
  const dtInput    = document.getElementById(`reminder-dt-${id}`);
  const agentInput = document.getElementById(`reminder-agent-${id}`);
  const reminder   = allReminders.find(r => r.id === id);
  if (!reminder) return;

  const payload = { id, password: currentPassword };

  if (dtInput && dtInput.value) {
    payload.dueAt = new Date(dtInput.value).toISOString();
  }

  if (agentInput && agentInput.value && agentInput.value !== reminder.agentName) {
    const newAgent = AGENTS.find(a => a.name === agentInput.value);
    if (newAgent) {
      payload.agentName  = newAgent.name;
      payload.agentEmail = newAgent.email;
    }
  }

  // Nothing changed
  if (!payload.dueAt && !payload.agentName) {
    toggleReminderEdit(id);
    return;
  }

  try {
    const res = await fetch(`${CRM_API_BASE}/api/update-reminder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) {
      if (payload.dueAt)      reminder.dueAt      = payload.dueAt;
      if (payload.agentName)  reminder.agentName  = payload.agentName;
      if (payload.agentEmail) reminder.agentEmail = payload.agentEmail;
      renderReminders();
    } else {
      alert('Failed to update reminder: ' + (data.error || 'unknown error'));
    }
  } catch (err) {
    console.error('Failed to update reminder:', err);
    alert('Failed to update reminder. See console.');
  }
}

function openPanelFromReminder(leadRecordId) {
  if (!leadRecordId) return;
  // Stay on the reminders view so Kevin doesn't lose his place while working
  // through his call list — just open the slide-in panel on top.
  openPanel(leadRecordId);
}

// ── CREATE REMINDER FROM PANEL ─────────────────────────────────────────────
async function createReminderFromPanel() {
  if (!activeLead || !currentAgent) return;

  const btn      = document.getElementById('panel-reminder-submit');
  const statusEl = document.getElementById('panel-reminder-status');
  const action   = document.getElementById('panel-reminder-action').value;
  const dueAt    = document.getElementById('panel-reminder-due').value;
  const note     = document.getElementById('panel-reminder-note').value;
  const agentSelect = document.getElementById('panel-reminder-agent');
  const selectedAgentName = agentSelect ? agentSelect.value : currentAgent.name;
  const selectedAgent = AGENTS.find(a => a.name === selectedAgentName) || currentAgent;

  if (!dueAt) {
    statusEl.style.display = 'block';
    statusEl.style.color = '#dc2626';
    statusEl.textContent = 'Please select a due date and time.';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Creating…';
  statusEl.style.display = 'none';

  try {
    const res = await fetch(`${CRM_API_BASE}/api/create-reminder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password:     currentPassword,
        leadRecordId: activeLead.id,
        leadName:     activeLead.name || '',
        leadEmail:    activeLead.email || '',
        leadPhone:    activeLead.phone || '',
        agentName:    selectedAgent.name,
        agentEmail:   selectedAgent.email,
        actionType:   action,
        dueAt:        new Date(dueAt).toISOString(),
        note,
      }),
    });
    const data = await res.json();
    if (data.success) {
      statusEl.style.display = 'block';
      statusEl.style.color = '#16a34a';
      statusEl.textContent = 'Reminder created!';
      // Reset form
      document.getElementById('panel-reminder-due').value = '';
      document.getElementById('panel-reminder-note').value = '';
      // Reload reminders in background
      loadReminders();
      setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
    } else {
      statusEl.style.display = 'block';
      statusEl.style.color = '#dc2626';
      statusEl.textContent = data.error || 'Failed to create reminder.';
    }
  } catch (err) {
    statusEl.style.display = 'block';
    statusEl.style.color = '#dc2626';
    statusEl.textContent = 'Network error. Please try again.';
  }

  btn.disabled = false;
  btn.textContent = 'Create Reminder';
}

// ── ADD CONTACT (manual CRM entry) ─────────────────────────────────────────
// Kevin adds people he already knows (referrals, WhatsApp contacts, past clients).
// Both outbound emails save-lead can fire are OFF unless he ticks them, so adding a
// contact never surprises them with a "here's your password" message.
function openAddLeadModal() {
  const m = document.getElementById('add-lead-modal'); if (!m) return;
  ['add-lead-first','add-lead-last','add-lead-phone','add-lead-email',
   'add-lead-country','add-lead-listing','add-lead-notes'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('add-lead-language').value = 'en';
  document.getElementById('add-lead-assigned').value = 'Kevin';
  document.getElementById('add-lead-timeline').value = '';
  document.getElementById('add-lead-status').value = 'Contacted';
  document.getElementById('add-lead-status-warning').style.display = 'none';
  delete document.getElementById('add-lead-create').dataset.confirmedDupe;
  document.getElementById('add-lead-welcome').checked = false;
  document.getElementById('add-lead-notify').checked  = false;
  document.getElementById('add-lead-error').style.display = 'none';
  m.style.display = 'flex';
  document.getElementById('add-lead-first').focus();
}

function closeAddLeadModal() {
  const m = document.getElementById('add-lead-modal'); if (m) m.style.display = 'none';
}

async function submitAddLead() {
  const errEl = document.getElementById('add-lead-error');
  const btn   = document.getElementById('add-lead-create');
  const val   = id => (document.getElementById(id)?.value || '').trim();

  const first = val('add-lead-first');
  const email = val('add-lead-email');
  if (!first) { errEl.textContent = 'First name is required.'; errEl.style.display = 'block'; return; }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errEl.textContent = 'That email address does not look valid.'; errEl.style.display = 'block'; return;
  }

  // Warn on a duplicate before writing — allLeads is already loaded for this tab.
  const phoneDigits = val('add-lead-phone').replace(/\D/g, '');
  const dupe = (allLeads || []).find(l =>
    (email && (l.email || '').toLowerCase() === email.toLowerCase()) ||
    (phoneDigits.length >= 7 && (l.phone || '').replace(/\D/g, '').endsWith(phoneDigits.slice(-7)))
  );
  // The confirmation is bound to the SPECIFIC duplicate, not a bare "already warned" bit.
  // A plain flag would carry over when the user edits the email mid-modal and hits a
  // DIFFERENT existing contact — the second one would then be written with no warning.
  const dupeKey = dupe ? (dupe.id || dupe.email || dupe.phone || dupe.name || '?') : '';
  if (dupe && btn.dataset.confirmedDupe !== dupeKey) {
    btn.dataset.confirmedDupe = dupeKey;
    errEl.textContent = `Already in the CRM as "${dupe.name || dupe.email || dupe.phone}". Click again to add anyway.`;
    errEl.style.display = 'block';
    return;
  }

  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Adding…';

  try {
    const res = await fetch(`${CRM_API_BASE}/api/save-lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: currentPassword,
        manualEntry: true,
        sendWelcomeEmail: document.getElementById('add-lead-welcome').checked,
        notifyTeam:       document.getElementById('add-lead-notify').checked,
        firstName:      first,
        lastName:       val('add-lead-last'),
        email,
        phone:          val('add-lead-phone'),
        country:        val('add-lead-country'),
        language:       document.getElementById('add-lead-language').value,
        assignedTo:     document.getElementById('add-lead-assigned').value,
        timeline:       document.getElementById('add-lead-timeline').value,
        status:         document.getElementById('add-lead-status').value,
        listingAddress: val('add-lead-listing'),
        notes:          val('add-lead-notes'),
        sourceUrl:      'CRM — added manually',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      errEl.textContent = data.error || `Failed to add contact (${res.status}).`;
      errEl.style.display = 'block';
      return;
    }
    delete btn.dataset.confirmedDupe;
    closeAddLeadModal();
    await loadLeads();
  } catch (err) {
    errEl.textContent = 'Network error: ' + err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add Contact';
  }
}

// ── EVENT SETUP ────────────────────────────────────────────────────────────
function setupEvents() {
  // Header refresh button
  document.getElementById('refresh-btn').addEventListener('click', loadLeads);
  document.getElementById('resync-email-btn')?.addEventListener('click', resyncEmailInbox);

  // Add Contact (manual entry)
  document.getElementById('add-lead-btn')?.addEventListener('click', openAddLeadModal);
  document.getElementById('add-lead-close')?.addEventListener('click', closeAddLeadModal);
  document.getElementById('add-lead-create')?.addEventListener('click', submitAddLead);
  document.getElementById('add-lead-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'add-lead-modal') closeAddLeadModal();
  });
  // Surface the automation consequence the moment "New" is picked.
  document.getElementById('add-lead-status')?.addEventListener('change', (e) => {
    const w = document.getElementById('add-lead-status-warning');
    if (w) w.style.display = e.target.value === 'New' ? 'block' : 'none';
  });

  // Filters
  document.getElementById('search-input').addEventListener('input', applyFilters);
  document.getElementById('status-filter').addEventListener('change', applyFilters);
  document.getElementById('date-filter').addEventListener('change', applyFilters);
  document.getElementById('agent-filter').addEventListener('change', applyFilters);

  // Sidebar nav items
  document.querySelectorAll('.nav-item[data-action]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      const action = el.dataset.action;
      if (action === 'logout') {
        sessionStorage.removeItem('crm_auth');
        sessionStorage.removeItem('crm_agent_email');
        location.reload();
      } else if (action === 'export') {
        exportCSV();
      } else if (action === 'reminders') {
        switchView('reminders');
      } else if (action === 'sammy-reminders') {
        switchView('sammy-reminders');
      } else if (action === 'clients') {
        switchView('clients');
      } else if (action === 'pipeline') {
        switchView('pipeline');
      } else if (action === 'cons-tasks') {
        switchView('cons-tasks');
      } else if (action === 'opportunities') {
        switchView('opportunities');
      } else if (action === 'partners') {
        switchView('partners');
      } else if (action === 'listings') {
        switchView('listings');
      } else if (action === 'ai-calls') {
        switchView('ai-calls');
      } else if (action === 'autoresearch') {
        switchView('autoresearch');
      } else if (action === 'leadgen' || action === 'leadgen-pipeline' || action === 'leadgen-reminders') {
        switchView(action);
      } else if (action === 'refresh') {
        switchView('dashboard');
        loadLeads();
      } else if (action === 'dashboard') {
        switchView('dashboard');
      }
    });
  });

  // AI Calls view events (controls exist in DOM from load; wire once)
  document.querySelectorAll('.ai-range-chip').forEach(c =>
    c.addEventListener('click', () => aiApplyRange(c.dataset.range, c)));
  const aiApplyBtn = document.getElementById('ai-apply-btn');
  const aiRefreshBtn = document.getElementById('ai-refresh-btn');
  if (aiApplyBtn) aiApplyBtn.addEventListener('click', () => { aiSetActiveChip(null); loadAICalls(true); });
  if (aiRefreshBtn) aiRefreshBtn.addEventListener('click', () => loadAICalls(true));
  const aiTbody = document.getElementById('ai-calls-tbody');
  if (aiTbody) aiTbody.addEventListener('click', (e) => {
    const btn = e.target.closest('.ai-play');
    if (btn) aiPlayAudio(btn);
  });

  // Reminder view events
  const reminderStatusFilter = document.getElementById('reminder-status-filter');
  const reminderAgentFilter  = document.getElementById('reminder-agent-filter');
  const refreshRemindersBtn  = document.getElementById('refresh-reminders-btn');
  if (reminderStatusFilter) reminderStatusFilter.addEventListener('change', renderReminders);
  if (reminderAgentFilter)  reminderAgentFilter.addEventListener('change', renderReminders);
  if (refreshRemindersBtn)  refreshRemindersBtn.addEventListener('click', loadReminders);

  // Sammy's Reminders view events
  const sammyStatusFilter = document.getElementById('sammy-reminder-status-filter');
  const refreshSammyBtn   = document.getElementById('refresh-sammy-reminders-btn');
  if (sammyStatusFilter) sammyStatusFilter.addEventListener('change', renderSammyReminders);
  if (refreshSammyBtn)   refreshSammyBtn.addEventListener('click', loadReminders);

  // Panel close
  document.getElementById('panel-close').addEventListener('click', closePanel);
  document.getElementById('panel-overlay').addEventListener('click', closePanel);

  // Expand / restore the panel (more room for the Flash coach)
  document.getElementById('panel-expand')?.addEventListener('click', togglePanelExpand);

  // Close/collapse the Flash coach back to the launch button (stops the mic)
  document.getElementById('panel-coach-close')?.addEventListener('click', finalizeCoachSection);

  // Flash coach → CRM: log each post-call summary as a note on the lead
  window.addEventListener('message', handleFlashMessage);

  // Escape key closes panel
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });

  // Panel save
  document.getElementById('panel-save').addEventListener('click', saveLead);

  // Edit-contact toggle (shows/hides First Name + Last Name inputs)
  document.getElementById('panel-edit-contact-btn')?.addEventListener('click', () => {
    const editor = document.getElementById('panel-contact-edit');
    if (!editor) return;
    editor.style.display = editor.style.display === 'none' ? 'block' : 'none';
  });

  // Auto-save name/phone/email on blur (no Save button click needed for these)
  ['panel-first-name','panel-last-name','panel-phone-input','panel-email-input'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('blur', () => {
      if (activeLead) saveLead();
    });
  });

  // Panel reminder submit
  const reminderSubmit = document.getElementById('panel-reminder-submit');
  if (reminderSubmit) reminderSubmit.addEventListener('click', createReminderFromPanel);

  // Sync Call Notes section removed from UI; syncCallNotes() left as dead code
  // in case Kevin re-enables it later. /api/sync-call-notes endpoint still live.

  // Alert preference controls
  document.getElementById('panel-alert-active').addEventListener('change', function () {
    _alertFormTouched = true;
    toggleAlertFields(this.checked);
  });
  document.getElementById('panel-alert-send-now').addEventListener('click', sendTestAlert);
  document.getElementById('panel-alert-copy-link').addEventListener('click', copyPreferencesLink);
  // Any edit inside the alert section marks the form TOUCHED — "Save Changes" only
  // persists alert prefs when this is set. Root: Yasser Lenis 2026-07-23 — a CRM tab
  // whose page-load cache predated Claudia's alert write showed a BLANK alert form, and
  // Save Changes wrote those blanks over the real profile (silent wipe).
  const alertFields = document.getElementById('panel-alert-fields');
  if (alertFields) {
    alertFields.addEventListener('input', () => { _alertFormTouched = true; });
    alertFields.addEventListener('change', () => { _alertFormTouched = true; });
  }
  initProfileButtons();

  // Table column sorting
  document.querySelectorAll('.leads-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (sortField === field) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortField = field;
        sortDir = 'asc';
      }
      applyFilters();
      // Update header UI
      document.querySelectorAll('#leads-table th').forEach(t => {
        t.classList.remove('sorted');
        const icon = t.querySelector('.sort-icon');
        if (icon) icon.textContent = '↕';
      });
      th.classList.add('sorted');
      const icon = th.querySelector('.sort-icon');
      if (icon) icon.textContent = sortDir === 'asc' ? '↑' : '↓';
    });
  });
}

// ── RENDER ALL ─────────────────────────────────────────────────────────────
function renderAll() {
  renderStats();
  applyFilters();
}

// ── APPLY FILTERS + SORT ───────────────────────────────────────────────────
// Buyer leads = buyer/broker contacts for one of OUR listings (Source URL = "buyer:<MLS#>").
// They live under the Listings tab, NOT the main dashboard/table/stats/export.
function isBuyerLead(lead) {
  return typeof lead?.sourceUrl === 'string' && lead.sourceUrl.startsWith('buyer:');
}

function applyFilters() {
  const searchEl  = document.getElementById('search-input');
  const statusEl  = document.getElementById('status-filter');
  const dateEl    = document.getElementById('date-filter');
  const agentEl   = document.getElementById('agent-filter');

  const search    = (searchEl ? searchEl.value : '').toLowerCase().trim();
  const status    = statusEl ? statusEl.value : '';
  const dateRange = dateEl ? dateEl.value : '';
  const agent     = agentEl ? agentEl.value : '';

  const now    = Date.now();
  const dayMs  = 86400000;
  const rangeDays = { '7': 7, '30': 30, '90': 90 };

  filteredLeads = allLeads.filter(lead => {
    // Buyer leads for our listings live under the Listings tab, not here
    if (isBuyerLead(lead)) return false;

    // Search filter
    if (search) {
      const haystack = [lead.name, lead.email, lead.phone, lead.listingAddress, lead.assignedTo]
        .filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    // Status filter
    if (status && lead.status !== status) return false;

    // Agent filter
    if (agent && lead.assignedTo !== agent) return false;

    // Date range filter
    if (dateRange && rangeDays[dateRange]) {
      const created = new Date(lead.createdAt).getTime();
      if (now - created > rangeDays[dateRange] * dayMs) return false;
    }

    return true;
  });

  // Sort
  filteredLeads.sort((a, b) => {
    let av = a[sortField] || '';
    let bv = b[sortField] || '';
    if (sortField === 'createdAt') {
      av = new Date(av).getTime();
      bv = new Date(bv).getTime();
    } else if (sortField === 'listingPrice') {
      av = Number(av) || 0;
      bv = Number(bv) || 0;
    } else {
      av = String(av).toLowerCase();
      bv = String(bv).toLowerCase();
    }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  renderTable();

  const countEl = document.getElementById('lead-count');
  if (countEl) {
    countEl.textContent = `Showing ${filteredLeads.length} of ${allLeads.filter(l => !isBuyerLead(l)).length} leads`;
  }
}

// ── RENDER TABLE ───────────────────────────────────────────────────────────
function renderTable() {
  const tbody      = document.getElementById('leads-tbody');
  const emptyState = document.getElementById('empty-state');

  if (filteredLeads.length === 0) {
    tbody.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

  tbody.innerHTML = filteredLeads.map((lead, i) => {
    const initials    = getInitials(lead.name);
    const price       = lead.listingPrice
      ? '$' + Number(lead.listingPrice).toLocaleString()
      : '';
    let property = '—';
    if (lead.listingAddress) {
      property = escHtml(lead.listingAddress) + (price ? ' · ' + price : '');
    } else if (lead.sourceUrl) {
      // Try to extract MLS ID or useful info from the source URL
      const urlMatch = lead.sourceUrl.match(/[?&]id=([^&]+)/);
      property = urlMatch ? `MLS# ${escHtml(urlMatch[1])}` : '<span class="td-muted-light">Browse page</span>';
    }
    const statusVal   = lead.status || 'New';
    const statusClass = 'status-' + statusVal.replace(/\s+/g, '-');
    const alertSummary = getAlertSummary(lead);

    const isDead = statusVal === 'Dead';
    return `
      <tr data-id="${escHtml(lead.id)}"${isDead ? ' class="lead-dead"' : ''}>
        <td class="td-muted" style="font-size:0.8rem">${i + 1}</td>
        <td>
          <div class="lead-cell">
            <div class="lead-avatar">${escHtml(initials)}</div>
            <span class="lead-name">${escHtml(lead.name || '—')}</span>
          </div>
        </td>
        <td class="td-muted">${relativeTime(lead.createdAt)}</td>
        <td class="td-muted">${lead.lastLogin ? relativeTime(lead.lastLogin) : '—'}</td>
        <td class="td-muted">${formatDurationSeconds(lead.totalTimeSpent || 0)}</td>
        <td class="td-muted">${escHtml(lead.phone || '—')}</td>
        <td class="td-muted">${escHtml(lead.email || '—')}</td>
        <td class="td-property" title="${escHtml(lead.listingAddress || '')}">
          ${lead.listingAddress
            ? `<a href="#" class="property-link" data-address="${escHtml(lead.listingAddress)}" data-source="${escHtml(lead.sourceUrl || '')}" onclick="event.stopPropagation();openPropertyModal(this.dataset.address, this.dataset.source);return false;">${property}</a>`
            : property}
        </td>
        <td class="td-muted">${escHtml(lead.country || '—')}</td>
        <td class="td-muted">${escHtml(lead.timeline || '—')}</td>
        <td class="td-muted">${escHtml(lead.assignedTo || '—')}</td>
        <td><span class="status-badge ${statusClass}">${escHtml(statusVal)}</span></td>
        <td class="td-alerts">${alertSummary}</td>
      </tr>`;
  }).join('');

  // Attach row click listeners
  tbody.querySelectorAll('tr[data-id]').forEach(row => {
    row.addEventListener('click', () => openPanel(row.dataset.id));
  });
}

// ── ALERT SUMMARY ──────────────────────────────────────────────────────────
function getAlertSummary(lead) {
  if (!lead.alertActive) return '<span class="td-muted">—</span>';

  // Hard red-flag: alert has returned 0 matches multiple runs in a row.
  // Surface this BEFORE the normal summary so Kevin can't miss it.
  let reviewChip = '';
  if (lead.alertNeedsReview) {
    const reason = lead.alertLastSkipReason || `${lead.alertZeroRuns || 0} consecutive zero-result runs`;
    reviewChip = `<span class="alert-needs-review-badge" title="${escHtml(reason)}">⚠ Needs review</span> `;
  } else if ((lead.alertZeroRuns || 0) > 0 && lead.alertLastSkipReason) {
    reviewChip = `<span class="alert-zero-runs-badge" title="${escHtml(lead.alertLastSkipReason)}">${lead.alertZeroRuns}× empty</span> `;
  }

  const parts = [];
  if (lead.alertCities) {
    const cities = lead.alertCities.split(',').map(c => c.trim()).filter(Boolean);
    if (cities.length > 0) parts.push(cities.slice(0, 2).join(', '));
  }
  if (lead.alertPropertyTypes && lead.alertPropertyTypes.length > 0) {
    parts.push(lead.alertPropertyTypes.slice(0, 2).join(', '));
  }
  if (lead.alertPriceMin || lead.alertPriceMax) {
    const min = lead.alertPriceMin ? '$' + (lead.alertPriceMin / 1000).toFixed(0) + 'k' : '';
    const max = lead.alertPriceMax ? '$' + (lead.alertPriceMax / 1000).toFixed(0) + 'k' : '';
    if (min && max) parts.push(`${min}-${max}`);
    else if (min) parts.push(`${min}+`);
    else if (max) parts.push(`Up to ${max}`);
  }

  if (parts.length === 0) return `${reviewChip}<span class="alert-active-badge">Active</span>`;
  const summary = parts.join(' · ');
  return `${reviewChip}<span class="alert-active-badge" title="${escHtml(summary)}">✓ ${escHtml(summary.length > 35 ? summary.substring(0, 35) + '…' : summary)}</span>`;
}

// ── RENDER STATS ───────────────────────────────────────────────────────────
function renderStats() {
  const now  = Date.now();
  const week = 7 * 86400000;

  const totalEl   = document.getElementById('stat-total');
  const newEl     = document.getElementById('stat-new');
  const hotEl     = document.getElementById('stat-hot');
  const apptEl    = document.getElementById('stat-appointments');

  const dashLeads = allLeads.filter(l => !isBuyerLead(l));
  if (totalEl) totalEl.textContent = dashLeads.length;
  if (newEl)   newEl.textContent   = dashLeads.filter(l => {
    return now - new Date(l.createdAt).getTime() < week;
  }).length;
  if (hotEl)   hotEl.textContent   = dashLeads.filter(l => l.status === 'Hot').length;
  if (apptEl)  apptEl.textContent  = dashLeads.filter(l => l.status === 'Appointment Set').length;
}

// ── OPEN LEAD PANEL ────────────────────────────────────────────────────────
// The panel form's contents come from the page-load lead cache — a tab that stays open
// for days shows (and on Save, WRITES BACK) values other systems have since changed.
// After the cache paint, re-pull the lead list and re-hydrate the open panel with the
// live record — unless Kevin already started editing the alert form (never clobber
// in-progress edits). Same staleness class as the 2026-07-16 reminders fix.
let _panelRefreshSeq = 0;
async function refreshLeadInPanel(id) {
  const seq = ++_panelRefreshSeq;
  try {
    const res = await fetch(`${CRM_API_BASE}/api/get-leads?password=${encodeURIComponent(currentPassword)}`);
    if (!res.ok) return;
    const data = await res.json();
    const fresh = (data.leads || []).find(l => String(l.id) === String(id));
    if (!fresh) return;
    // MERGE IN PLACE — never `allLeads[idx] = fresh`. `filteredLeads` (what renderTable
    // paints from) holds REFERENCES to the allLeads objects, so swapping the object here
    // orphaned the row: every later save mutated the new object while the table still
    // rendered the old one, and the change (e.g. the Dead strikethrough) only appeared
    // after a page reload. Keeping identity means one mutation is visible everywhere.
    const idx = allLeads.findIndex(l => String(l.id) === String(id));
    let record = fresh;
    if (idx >= 0) {
      const target = allLeads[idx];
      for (const k of Object.keys(target)) if (!(k in fresh)) delete target[k];
      Object.assign(target, fresh);
      record = target;
    }
    // Out-of-band writers (Flash's dead-lead call, Claudia, another device) change the
    // record while the tab is open — repaint so the row reflects the server right away.
    renderTable();
    renderStats();
    // Only re-hydrate if this is still the open lead, no newer refresh superseded us,
    // and the alert form is untouched.
    if (seq === _panelRefreshSeq && activeLead && String(activeLead.id) === String(id) && !_alertFormTouched) {
      activeLead = record;
      populatePanel(record);
    }
  } catch (e) { /* stale render survives — same as before this refresh existed */ }
}

function openPanel(id) {
  const lead = allLeads.find(l => String(l.id) === String(id));
  if (!lead) { console.warn('[openPanel] lead not found for id:', id); return; }
  activeLead = lead;
  // NEVER carry a map property selection from one lead to another — a
  // wrong-lead send is a client-facing disaster. (Kevin 2026-07-17.)
  resetMapSelection();

  // OPEN THE PANEL FIRST — never let a data-population error keep it hidden.
  // Default = the EXPANDED (wide) view (Kevin 2026-07-17); the ⛶ button shrinks it.
  const panelEl = document.getElementById('lead-panel');
  panelEl.classList.add('open');
  panelEl.classList.add('panel-expanded');
  const overlay = document.getElementById('panel-overlay');
  if (overlay) overlay.classList.add('show');

  try {
    populatePanel(lead);
  } catch (err) {
    console.error('[openPanel] error populating panel for lead', lead?.id, lead?.name, err);
  }
  // Cache paint done — now re-hydrate from the live record (stale-tab guard).
  void refreshLeadInPanel(id);
}

function populatePanel(lead) {
  _alertFormTouched = false; // fresh hydration — nothing edited yet
  // Name & date
  document.getElementById('panel-name').textContent       = lead.name || '—';
  document.getElementById('panel-date').textContent       = 'Registered ' + relativeTime(lead.createdAt);
  document.getElementById('panel-avatar-text').textContent = getInitials(lead.name);

  // Assigned To (dropdown)
  const assignedEl = document.getElementById('panel-assigned-to');
  if (assignedEl) assignedEl.value = lead.assignedTo || '';

  // Contact info in panel — editable inputs
  const firstNameEl = document.getElementById('panel-first-name');
  const lastNameEl  = document.getElementById('panel-last-name');
  const phoneEl     = document.getElementById('panel-phone-input');
  const emailEl     = document.getElementById('panel-email-input');
  if (firstNameEl) firstNameEl.value = lead.firstName || '';
  if (lastNameEl)  lastNameEl.value  = lead.lastName  || '';
  if (phoneEl)     phoneEl.value     = lead.phone     || '';
  if (emailEl)     emailEl.value     = lead.email     || '';
  // Edit toggle: hide name editor by default
  const editor = document.getElementById('panel-contact-edit');
  if (editor) editor.style.display = 'none';
  const timeEl = document.getElementById('panel-time-spent');
  if (timeEl) timeEl.textContent = formatDurationSeconds(lead.totalTimeSpent || 0);
  const lastLoginEl = document.getElementById('panel-last-login');
  if (lastLoginEl) lastLoginEl.textContent = lead.lastLogin ? relativeTime(lead.lastLogin) : '—';
  const timelineEl = document.getElementById('panel-timeline');
  if (timelineEl) timelineEl.textContent = lead.timeline || '—';

  // Action buttons
  const phoneRaw = (lead.phone || '').replace(/\D/g, '');
  document.getElementById('panel-whatsapp').href  = phoneRaw
    ? `https://wa.me/${phoneRaw}`
    : '#';
  // Hilo Claudia (Kevin 2026-07-20): open the same token-gated conversation
  // page that every Slack ping links, for THIS lead — so mid-call he can see
  // where Claudia's WhatsApp thread stands (sent? answered?). The link is
  // minted server-side per click (api/agent/thread-link derives the view
  // token; it never ships in this public file). Window opened SYNCHRONOUSLY
  // on click so popup blockers don't eat it, then pointed at the URL.
  const threadBtn = document.getElementById('panel-claudia-thread');
  if (threadBtn) {
    threadBtn.style.display = phoneRaw ? '' : 'none';
    threadBtn.onclick = async () => {
      const forLead = activeLead;
      if (!forLead || !forLead.id) return;
      const win = window.open('about:blank', '_blank');
      try {
        const res = await fetch(`${CRM_API_BASE}/api/agent/thread-link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: currentPassword, leadId: forLead.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.url) {
          if (win) win.location = data.url; else window.open(data.url, '_blank');
        } else {
          if (win) win.close();
          alert(`No pude abrir el hilo: ${data.error || res.status}`);
        }
      } catch (e) {
        if (win) win.close();
        alert(`No pude abrir el hilo: ${e.message}`);
      }
    };
  }

  // Property details
  document.getElementById('panel-addr').textContent  = lead.listingAddress || '—';
  document.getElementById('panel-price').textContent = lead.listingPrice
    ? '$' + Number(lead.listingPrice).toLocaleString()
    : '—';

  const sourceLink = document.getElementById('panel-source');
  if (lead.sourceUrl) {
    sourceLink.href        = lead.sourceUrl;
    sourceLink.textContent = 'View listing →';
  } else {
    sourceLink.href        = '#';
    sourceLink.textContent = '—';
  }

  // Status & notes
  const statusSelect = document.getElementById('panel-status');
  statusSelect.value = lead.status || 'New';
  document.getElementById('panel-new-note').value = '';
  renderNotesHistory(lead.notes || '');
  renderCallHistory(lead);

  // Alert preferences
  document.getElementById('panel-alert-active').checked = !!lead.alertActive;
  document.getElementById('panel-alert-frequency').value = lead.alertFrequency || 'Weekly';
  document.getElementById('panel-alert-count').value = lead.alertCount || '5';
  toggleAlertFields(lead.alertActive);

  // Load multi-profile alert data
  loadAlertProfiles(lead);

  // Reset alert status
  const alertStatus = document.getElementById('panel-alert-status');
  alertStatus.style.display = 'none';
  alertStatus.textContent = '';

  // Reset save state
  const saveStatus = document.getElementById('panel-save-status');
  const saveBtn    = document.getElementById('panel-save');
  saveStatus.style.display = 'none';
  saveStatus.textContent   = '';
  saveStatus.style.color   = '#16a34a';
  saveBtn.disabled         = false;
  saveBtn.textContent      = 'Save Changes';

  // Reset reminder form
  const reminderStatus = document.getElementById('panel-reminder-status');
  if (reminderStatus) {
    reminderStatus.style.display = 'none';
    reminderStatus.textContent = '';
  }
  const reminderDue = document.getElementById('panel-reminder-due');
  if (reminderDue) reminderDue.value = '';
  const reminderNote = document.getElementById('panel-reminder-note');
  if (reminderNote) reminderNote.value = '';
  // Pre-select agent based on lead's assigned agent
  const reminderAgent = document.getElementById('panel-reminder-agent');
  if (reminderAgent && lead.assignedTo) {
    reminderAgent.value = lead.assignedTo;
  }

  // Load conversations, activity, and properties viewed
  if (lead.email) {
    loadConversations(lead.email);
    loadActivity(lead.email);
  }
  renderSavedProperties(lead);
  renderPropertiesViewed(lead);
  renderLeadReminders(lead);  // instant paint from the cached list (no flicker)
  // ...then re-fetch so the panel reflects reminders created AFTER this tab loaded —
  // e.g. Flash writes a no-answer retry reminder ~7s after a call, and Sammy/teammates
  // add their own. Rendering only from the page-load cache made the panel show NO
  // reminder for a call just made, so Kevin re-added it by hand (Julian Niño 2026-07-16).
  loadReminders()
    .then(() => { if (activeLead && activeLead.id === lead.id) renderLeadReminders(activeLead); })
    .catch(() => { /* keep the cached render */ });
  renderFlashRecordings(lead);

  // Wire share-property button (rebind each time so it uses current lead)
  const shareBtn = document.getElementById('panel-share-property');
  if (shareBtn) {
    shareBtn.onclick = () => openSharePropertyModal(lead);
  }

  // Wire "Enviar 3 propiedades" button (Kevin 2026-07-02): queues a manual
  // Sammy send — 3 fresh listings matching this lead's ALERT criteria, one
  // WhatsApp message from the 305 (same format as the drip). The engine picks
  // it up within ~3 min; outside 9am-8pm lead-local it waits for the morning.
  const sendPropsBtn = document.getElementById('panel-send-props');
  if (sendPropsBtn) {
    sendPropsBtn.disabled = false;
    sendPropsBtn.textContent = '🏠 Enviar 3 propiedades';
    sendPropsBtn.onclick = () => sendMatchingProps(lead, sendPropsBtn);
  }

  // Wire the Flash live-coach section for THIS lead (collapsed until clicked). Switching
  // to a DIFFERENT lead tears the old coach down through finalize (call ended → note,
  // reminder + alerts land); re-opening the SAME lead leaves a live coach untouched.
  const coachFrameEl = document.getElementById('panel-coach-iframe');
  const coachOnThisLead = coachFrameEl && coachFrameEl.src &&
    coachFrameEl.src.indexOf('leadId=' + encodeURIComponent(lead.id)) !== -1;
  if (!coachOnThisLead) finalizeCoachSection();
  const coachBtn = document.getElementById('panel-coach-start');
  if (coachBtn) coachBtn.onclick = () => openFlashCoach(lead);

  // Panel is already opened at the top of openPanel(); nothing more to do.
}

// ── SEND 3 MATCHING PROPERTIES (Kevin 2026-07-02) ──────────────────────────
// Queues a manual Sammy send via /api/agent/queue-props → Railway engine.
// The engine sends 3 FRESH listings matching the lead's ALERT criteria in ONE
// WhatsApp message from Kevin's 305 (drip format). Requires alert criteria —
// warn upfront so Kevin fixes the profile instead of wondering why nothing sent.
async function sendMatchingProps(lead, btn) {
  if (!lead) return;
  const hasCriteria = Boolean(
    (lead.alertCities || '').trim() || Number(lead.priceMax) > 0 || Number(lead.priceMin) > 0
    || Number(lead.alertPriceMax) > 0 || Number(lead.alertPriceMin) > 0
    || Number(lead.alertBeds) > 0 || (lead.alertPropertyTypes || '').trim()
  );
  if (!hasCriteria) {
    alert('Este lead no tiene criterios de búsqueda (ciudades/precio) en su perfil de alertas.\n\nConfigura las alertas primero — sin criterios Claudia no envía nada (evita mandar propiedades al azar).');
    return;
  }
  if (!confirm(`Enviar a ${lead.name || 'este lead'} 3 propiedades nuevas que cumplan sus criterios por WhatsApp?\n\nSale en ~3 min desde el 954 de Claudia (si es de noche para el lead, espera a las 9am de su hora).`)) return;
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Enviando…';
  try {
    const res = await fetch(`${CRM_API_BASE}/api/agent/queue-props`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: currentPassword, leadId: lead.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      btn.textContent = data.already ? '✓ Ya estaba en cola' : '✓ En cola — sale en ~3 min';
    } else {
      btn.textContent = '✗ Error — reintentar';
      btn.disabled = false;
      alert(`No se pudo encolar el envío: ${data.error || res.status}`);
      return;
    }
  } catch (e) {
    btn.textContent = '✗ Error — reintentar';
    btn.disabled = false;
    alert(`No se pudo encolar el envío: ${e.message}`);
    return;
  }
  // Re-enable after a bit so a legit second send (days later, same session) works.
  setTimeout(() => { btn.disabled = false; btn.textContent = prev; }, 30000);
}

// ── SHARE PROPERTY MODAL ───────────────────────────────────────────────────
function openSharePropertyModal(lead) {
  if (!lead) return;
  if (!lead.email) {
    alert('This lead has no email address — cannot generate auto-login link.');
    return;
  }
  const modal = document.getElementById('share-property-modal');
  const nameEl = document.getElementById('share-lead-name');
  const mlsInput = document.getElementById('share-mls-input');
  const msgInput = document.getElementById('share-message-input');
  const errEl = document.getElementById('share-error');
  const previewEl = document.getElementById('share-preview');

  nameEl.textContent = `Sharing with ${lead.name || lead.email} · ${lead.email}`;
  mlsInput.value = '';
  msgInput.value = '';
  errEl.style.display = 'none';
  previewEl.style.display = 'none';
  previewEl.textContent = '';
  modal.style.display = 'flex';

  // Store active share lead for handlers
  window._shareActiveLead = lead;
  setTimeout(() => mlsInput.focus(), 50);
}

function buildShareUrl(lead, mlsOrUrl) {
  const SITE = 'https://www.homesinsoflorida.com';
  let mlsId = '';
  let baseUrl = '';
  const trimmed = (mlsOrUrl || '').trim();

  if (!trimmed) return null;

  // Full URL? Extract id param if present, otherwise use as-is
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const idParam = u.searchParams.get('id');
      if (idParam) {
        mlsId = idParam;
        baseUrl = `${SITE}/listing?id=${encodeURIComponent(idParam)}`;
      } else {
        // Strip any existing e/p/t to avoid duplicates
        u.searchParams.delete('e');
        u.searchParams.delete('p');
        u.searchParams.delete('t');
        baseUrl = u.toString();
      }
    } catch {
      return null;
    }
  } else {
    // Treat as MLS #
    mlsId = trimmed;
    baseUrl = `${SITE}/listing?id=${encodeURIComponent(trimmed)}`;
  }

  // Append auth params
  const authParams = [];
  if (lead.email)          authParams.push(`e=${encodeURIComponent(lead.email)}`);
  if (lead.accessPassword) authParams.push(`p=${encodeURIComponent(lead.accessPassword)}`);
  if (lead.alertToken)     authParams.push(`t=${encodeURIComponent(lead.alertToken)}`);
  const authQS = authParams.join('&');
  const finalUrl = baseUrl + (baseUrl.includes('?') ? '&' : '?') + authQS;
  return finalUrl;
}

function initShareModal() {
  const modal = document.getElementById('share-property-modal');
  if (!modal) return;
  const closeBtn = document.getElementById('share-close-btn');
  const waBtn = document.getElementById('share-whatsapp-btn');
  const copyBtn = document.getElementById('share-copy-btn');
  const mlsInput = document.getElementById('share-mls-input');
  const msgInput = document.getElementById('share-message-input');
  const errEl = document.getElementById('share-error');
  const previewEl = document.getElementById('share-preview');

  function close() { modal.style.display = 'none'; }
  closeBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  // Live preview as user types
  mlsInput.addEventListener('input', () => {
    const lead = window._shareActiveLead;
    if (!lead) return;
    const url = buildShareUrl(lead, mlsInput.value);
    if (url) {
      previewEl.textContent = url;
      previewEl.style.display = 'block';
      errEl.style.display = 'none';
    } else {
      previewEl.style.display = 'none';
    }
  });

  waBtn.addEventListener('click', () => {
    const lead = window._shareActiveLead;
    if (!lead) return;
    const url = buildShareUrl(lead, mlsInput.value);
    if (!url) {
      errEl.textContent = 'Please enter a valid MLS # or listing URL.';
      errEl.style.display = 'block';
      return;
    }
    const phoneRaw = (lead.phone || '').replace(/\D/g, '');
    const customMsg = msgInput.value.trim();
    const greetingName = (lead.firstName || (lead.name || '').split(' ')[0] || '').trim();
    const defaultMsg = greetingName
      ? `Hey ${greetingName}, take a look at this one — I think it fits what you're looking for:`
      : `Hey, take a look at this one — I think it fits what you're looking for:`;
    const text = `${customMsg || defaultMsg}\n\n${url}`;
    const waUrl = phoneRaw
      ? `https://wa.me/${phoneRaw}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(waUrl, '_blank');
  });

  copyBtn.addEventListener('click', async () => {
    const lead = window._shareActiveLead;
    if (!lead) return;
    const url = buildShareUrl(lead, mlsInput.value);
    if (!url) {
      errEl.textContent = 'Please enter a valid MLS # or listing URL.';
      errEl.style.display = 'block';
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      const orig = copyBtn.textContent;
      copyBtn.textContent = '✓ Copied!';
      copyBtn.style.background = '#16a34a';
      setTimeout(() => {
        copyBtn.textContent = orig;
        copyBtn.style.background = '#0a0a0a';
      }, 1800);
    } catch {
      errEl.textContent = 'Could not copy to clipboard. Select the preview text instead.';
      errEl.style.display = 'block';
    }
  });
}

// ── CLOSE LEAD PANEL ───────────────────────────────────────────────────────
function closePanel() {
  const panel = document.getElementById('lead-panel');
  panel.classList.remove('open');
  panel.classList.remove('panel-expanded');
  document.getElementById('panel-overlay').classList.remove('show');
  finalizeCoachSection(); // Flash treats the close as call-ended: mic off + note/reminder/alerts
  resetMapSelection();
  activeLead = null;
}

// ── FLASH LIVE COACH (embedded iframe) ──────────────────────────────────────
// The coach lives at Flash's /embed route. We fetch the base URL + scoped embed
// token from the gated /api/flash-config (so the token never sits in this public
// crm.js), then point the iframe at /embed?leadId=&key=. Lazy: only on click.
let _flashConfig = null;
async function getFlashConfig() {
  if (_flashConfig) return _flashConfig;
  const res = await fetch(`${CRM_API_BASE}/api/flash-config?password=${encodeURIComponent(currentPassword)}`);
  if (!res.ok) throw new Error('flash-config ' + res.status);
  _flashConfig = await res.json();
  return _flashConfig;
}

// Two panels embed the coach — the RE lead panel and the Lead Gen panel — with
// identical structure under different element ids. Every coach helper takes a
// slot key ('re' | 'lg'); a non-string arg (a click Event from addEventListener)
// falls back to 're'.
const COACH_SLOTS = {
  re: { panel: 'lead-panel',    iframe: 'panel-coach-iframe', launch: 'panel-coach-launch', close: 'panel-coach-close', start: 'panel-coach-start', bucket: 'leads' },
  lg: { panel: 'leadgen-panel', iframe: 'lg-coach-iframe',    launch: 'lg-coach-launch',    close: 'lg-coach-close',    start: 'lg-coach-start',    bucket: 'leadgen' },
};
function coachSlot(slot) { return COACH_SLOTS[typeof slot === 'string' ? slot : 're'] || COACH_SLOTS.re; }

function resetCoachSection(slot) {
  const S = coachSlot(slot);
  const iframe = document.getElementById(S.iframe);
  const launch = document.getElementById(S.launch);
  const closeBtn = document.getElementById(S.close);
  if (iframe) { iframe.src = ''; iframe.style.display = 'none'; }
  if (launch) launch.style.display = 'block';
  if (closeBtn) closeBtn.style.display = 'none';
}

// Closing/switching the panel while the coach is live = THE CALL ENDED (Kevin 2026-07-17).
// Tell Flash to finalize — it stops the mic instantly and submits the call, so the summary
// note + follow-up reminder + alert updates land server-side exactly as if "Detener" was
// pressed — then keep the (hidden) iframe alive for a grace window so the submit and the
// recording upload can finish before the document is destroyed. Every teardown path
// (panel close, overlay click, Esc, coach ✕, switching to another lead) goes through here.
const _coachBlankTimers = { re: null, lg: null };
const COACH_FINALIZE_GRACE_MS = 25000;
function finalizeCoachSection(slot) {
  const key = typeof slot === 'string' ? slot : 're';
  const S = coachSlot(key);
  const iframe = document.getElementById(S.iframe);
  if (!iframe || !iframe.src) { resetCoachSection(key); return; }
  try {
    iframe.contentWindow.postMessage({ type: 'flash:finalize' }, new URL(iframe.src).origin);
  } catch (e) { /* fire-and-forget — the grace-window blank still releases the mic */ }
  // UI returns to the launch state immediately; the doc dies quietly after the grace window.
  iframe.style.display = 'none';
  const launch = document.getElementById(S.launch);
  const closeBtn = document.getElementById(S.close);
  if (launch) launch.style.display = 'block';
  if (closeBtn) closeBtn.style.display = 'none';
  clearTimeout(_coachBlankTimers[key]);
  _coachBlankTimers[key] = setTimeout(() => resetCoachSection(key), COACH_FINALIZE_GRACE_MS);
}

async function openFlashCoach(lead, slot) {
  if (!lead || !lead.id) return;
  const key = typeof slot === 'string' ? slot : 're';
  const S = coachSlot(key);
  const iframe = document.getElementById(S.iframe);
  const launch = document.getElementById(S.launch);
  const btn    = document.getElementById(S.start);
  if (!iframe) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Cargando coach…'; }
  try {
    // A pending grace-window blank from a just-finalized call must never kill THIS session.
    clearTimeout(_coachBlankTimers[key]);
    const cfg = await getFlashConfig();
    // bucket=leadgen makes Flash read/write the LeadGen tables instead of the RE Leads table.
    const bucketQS = S.bucket === 'leadgen' ? '&bucket=leadgen' : '';
    iframe.src = `${cfg.flashBaseUrl}/embed?leadId=${encodeURIComponent(lead.id)}&key=${encodeURIComponent(cfg.embedToken)}${bucketQS}`;
    iframe.style.display = 'block';
    if (launch) launch.style.display = 'none';
    const closeBtn = document.getElementById(S.close);
    if (closeBtn) closeBtn.style.display = 'inline-block';
  } catch (e) {
    alert('No se pudo cargar Flash. Revisa la configuración (FLASH_EMBED_TOKEN / FLASH_BASE_URL).');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🎯 Iniciar coaching en vivo'; }
  }
}

function togglePanelExpand(slot) {
  document.getElementById(coachSlot(slot).panel)?.classList.toggle('panel-expanded');
}

// Render the lead's Flash call recordings (newest first): dated audio players plus,
// when the call archived a transcript, an open/copy row for it (the copy link is how
// Kevin sends a transcript to anyone — Kevin 2026-07-21).
// Source = lead.flashRecordings (JSON array of {url, transcriptUrl?, recordedAt, durationSec, callId}).
function renderFlashRecordings(lead) {
  const section = document.getElementById('panel-recordings-section');
  const list = document.getElementById('panel-recordings-list');
  if (!section || !list) return;
  const httpsOk = (v) => typeof v === 'string' && /^https:\/\//i.test(v);
  let recs = [];
  try {
    const raw = lead && lead.flashRecordings;
    const parsed = typeof raw === 'string' ? JSON.parse(raw || '[]') : (raw || []);
    // A transcript can land before (or without) its audio — keep entries that have either.
    if (Array.isArray(parsed)) recs = parsed.filter(r => r && (httpsOk(r.url) || httpsOk(r.transcriptUrl)));
  } catch (e) { recs = []; }
  if (!recs.length) { section.style.display = 'none'; list.innerHTML = ''; return; }
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  section.style.display = 'block';
  list.innerHTML = recs.map(r => {
    let when = '';
    if (r.recordedAt && !isNaN(Date.parse(r.recordedAt))) {
      when = new Date(r.recordedAt).toLocaleString('en-US', {
        month: 'numeric', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York',
      });
    }
    const s = Math.max(0, Math.round(Number(r.durationSec) || 0));
    const dur = s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '';
    const meta = [when, dur].filter(Boolean).join('  ·  ') || 'Grabación';
    const audio = httpsOk(r.url)
      ? `<audio controls preload="none" src="${esc(r.url)}" style="width:100%;height:36px;"></audio>`
      : '';
    const transcript = httpsOk(r.transcriptUrl)
      ? `<div style="font-size:12px;margin-top:3px;">📄 <a href="${esc(r.transcriptUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--color-accent);font-weight:600;">Transcripción</a>
           · <a href="#" onclick="return copyFlashTranscript(this, '${esc(r.transcriptUrl)}')" style="color:#475569;">copiar enlace</a></div>`
      : '';
    return `<div style="margin-bottom:10px;">
      <div style="font-size:12px;color:#475569;font-weight:600;margin-bottom:4px;">${esc(meta)}</div>
      ${audio}${transcript}
    </div>`;
  }).join('');
}

// Copy a transcript URL for sending (WhatsApp/email/wherever). Inline handler helper.
function copyFlashTranscript(el, url) {
  try {
    navigator.clipboard.writeText(url).then(() => {
      const prev = el.textContent;
      el.textContent = '✓ copiado';
      setTimeout(() => { el.textContent = prev; }, 1500);
    });
  } catch (e) { /* clipboard unavailable — the open link still works */ }
  return false;
}

// One call produces up to TWO asset saves (audio recording + text transcript) that fire
// within seconds of each other. save-recording merges them by callId, but its Airtable
// read-modify-write would race if both POSTs ran concurrently — chain them so the second
// save always reads the first save's result. Updates the open panel on success.
let _flashSaveChain = Promise.resolve();
function saveFlashCallAsset(fields) {
  _flashSaveChain = _flashSaveChain.then(async () => {
    try {
      const res = await fetch(`${CRM_API_BASE}/api/agent/save-recording`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ password: currentPassword }, fields)),
      });
      if (res.ok && activeLead && activeLead.id === fields.leadId) {
        const { recording } = await res.json().catch(() => ({}));
        if (recording) {
          let cur = [];
          try { cur = JSON.parse(activeLead.flashRecordings || '[]'); } catch (e) { cur = []; }
          // Only dedupe on a REAL callId — legacy rows stored callId:'' and an empty-vs-empty
          // match would wipe every prior recording from the local list.
          cur = Array.isArray(cur) ? cur.filter(r => r && (!recording.callId || r.callId !== recording.callId)) : [];
          activeLead.flashRecordings = JSON.stringify([recording, ...cur]);
          renderFlashRecordings(activeLead);
        }
      }
    } catch (e) { /* best-effort — the upload itself already happened */ }
  });
}

// Flash → CRM: when a coached call ends, Flash postMessages the summary. We verify
// the origin, then log it as an append-only note on the lead via the audited
// log-note endpoint (Flash itself never writes to the CRM).
async function handleFlashMessage(event) {
  let flashOrigin;
  try {
    const cfg = _flashConfig || (await getFlashConfig().catch(() => null));
    if (!cfg) return;
    flashOrigin = new URL(cfg.flashBaseUrl).origin;
  } catch { return; }
  if (event.origin !== flashOrigin) return; // only trust the configured Flash origin

  const data = event.data;
  if (!data) return;

  // Lead Gen leads take their own path (LeadGen tables; no save-recording).
  if (data.leadId && isLGLeadId(data.leadId, data.bucket)) { await handleFlashMessageLG(data); return; }

  // A coached call ended → save its recording (audio) and/or transcript (text) under
  // "Flash voice recordings". The two arrive as SEPARATE messages for the same callId;
  // saveFlashCallAsset serializes the POSTs so the endpoint's read-modify-write on the
  // Airtable field can never interleave and drop one of them.
  if (data.type === 'flash:recording' && data.leadId && data.url) {
    saveFlashCallAsset({ leadId: data.leadId, url: data.url, recordedAt: data.recordedAt, durationSec: data.durationSec, callId: data.callId });
    return;
  }
  if (data.type === 'flash:transcript' && data.leadId && data.url) {
    saveFlashCallAsset({ leadId: data.leadId, transcriptUrl: data.url, recordedAt: data.recordedAt, durationSec: data.durationSec, callId: data.callId });
    return;
  }

  if (data.type !== 'flash:call-ended' || !data.leadId || !data.note) return;

  // Since 2026-07-03 Flash's SERVER writes the note + reminder itself right after judging
  // (this postMessage used to be the ONLY delivery path and silently lost the note whenever
  // the iframe died during the ~20s judge wait or the run route errored — Alfredo Carvajal).
  // data.noteLogged / data.reminderCreated say what the server already did: when set we only
  // refresh the panel; when missing/false we fall back to writing from here as before.
  if (data.noteLogged) {
    if (activeLead && activeLead.id === data.leadId) {
      // Display-only approximation of log-note's auto-stamp; corrects itself on next lead load.
      const stamp = new Date().toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
      activeLead.notes = `[${stamp} — Flash Coach] ${data.note}\n\n${activeLead.notes || ''}`.trim();
      renderNotesHistory(activeLead.notes);
    }
  } else {
    try {
      const res = await fetch(`${CRM_API_BASE}/api/agent/log-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: currentPassword, leadId: data.leadId, note: data.note, agent: 'Flash Coach' }),
      });
      if (res.ok && activeLead && activeLead.id === data.leadId) {
        const { entry } = await res.json().catch(() => ({}));
        if (entry) {
          activeLead.notes = `${entry}\n\n${activeLead.notes || ''}`.trim();
          renderNotesHistory(activeLead.notes);
        }
      }
    } catch (e) { /* best-effort — the call already happened */ }
  }

  // Browser FALLBACK: create the reminder here ONLY if the server didn't (legacy path;
  // the server has been the primary writer since 2026-07-03). Never returns early on
  // failure — the refresh below must still run.
  if (data.reminder && data.reminder.dueAt && !isNaN(Date.parse(data.reminder.dueAt)) && !data.reminderCreated) {
    const lead = activeLead && activeLead.id === data.leadId ? activeLead : null;
    try {
      await fetch(`${CRM_API_BASE}/api/create-reminder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: currentPassword,
          leadRecordId: data.leadId,
          leadName: lead ? (lead.name || '') : '',
          leadEmail: lead ? (lead.email || '') : '',
          leadPhone: lead ? (lead.phone || '') : '',
          agentName: 'Flash Coach',
          actionType: ['Call', 'WhatsApp', 'Email'].includes(data.reminder.actionType) ? data.reminder.actionType : 'Follow Up',
          dueAt: data.reminder.dueAt,
          note: String(data.reminder.note || 'Seguimiento post-llamada').slice(0, 200),
        }),
      });
    } catch (e) { /* best-effort — the server is the primary writer */ }
  }

  // ALWAYS refresh the panel's reminders after a coached call — the SERVER writes the
  // reminder itself (no-answer retry, judged follow-up), completes prior ones, and on a
  // dead-lead call sets status Dead with NO reminder. The panel must reflect the SERVER,
  // not the postMessage: gating this on a well-formed data.reminder left the panel showing
  // no reminder for a call just made, so Kevin re-added it by hand (Julian Niño 2026-07-16).
  try {
    await loadReminders();
    if (activeLead && activeLead.id === data.leadId) renderLeadReminders(activeLead);
  } catch (e) { /* best-effort */ }
}

// ── RENDER EXISTING REMINDERS FOR A LEAD IN THE PANEL ────────────────────
function renderLeadReminders(lead) {
  const section = document.getElementById('panel-existing-reminders-section');
  const container = document.getElementById('panel-existing-reminders');
  if (!section || !container) return;

  // Find reminders for this lead
  const leadReminders = allReminders.filter(r =>
    r.leadRecordId === lead.id && r.status === 'Pending'
  );

  if (leadReminders.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  container.innerHTML = leadReminders.map(r => {
    const dueDate = new Date(r.dueAt);
    const now = new Date();
    const isOverdue = dueDate < now;
    const dueStr = dueDate.toLocaleDateString([], { month: 'short', day: 'numeric' })
      + ' ' + dueDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dtLocal = dueDate.getTime() ? `${dueDate.getFullYear()}-${String(dueDate.getMonth()+1).padStart(2,'0')}-${String(dueDate.getDate()).padStart(2,'0')}T${String(dueDate.getHours()).padStart(2,'0')}:${String(dueDate.getMinutes()).padStart(2,'0')}` : '';

    return `
    <div class="panel-reminder-card ${isOverdue ? 'overdue' : ''}">
      <div class="panel-reminder-top">
        <span class="panel-reminder-type">${escHtml(r.actionType || 'Follow Up')}</span>
        <span class="panel-reminder-due ${isOverdue ? 'overdue' : ''}">${isOverdue ? '⚠️ ' : ''}${dueStr}</span>
      </div>
      ${r.note ? `<div class="panel-reminder-note-text">${escHtml(r.note)}</div>` : ''}
      <div class="panel-reminder-edit-row" id="panel-r-edit-${r.id}" style="display:none;">
        <input type="datetime-local" id="panel-r-dt-${r.id}" class="panel-input" value="${dtLocal}" style="font-size:0.8rem;">
        <input type="text" id="panel-r-note-${r.id}" class="panel-input" value="${escHtml(r.note || '')}" placeholder="Note..." style="font-size:0.8rem;margin-top:4px;">
      </div>
      <div class="panel-reminder-actions">
        <button class="panel-r-btn edit" onclick="togglePanelReminderEdit('${r.id}')">Edit</button>
        <button class="panel-r-btn save" id="panel-r-save-${r.id}" style="display:none;" onclick="savePanelReminder('${r.id}')">Save</button>
        <button class="panel-r-btn done" onclick="completeReminder('${r.id}');renderLeadReminders(activeLead);">Done</button>
        <button class="panel-r-btn cancel" onclick="cancelReminder('${r.id}');renderLeadReminders(activeLead);">Cancel</button>
      </div>
    </div>`;
  }).join('');
}

function togglePanelReminderEdit(id) {
  const editRow = document.getElementById(`panel-r-edit-${id}`);
  const saveBtn = document.getElementById(`panel-r-save-${id}`);
  if (editRow) {
    const showing = editRow.style.display !== 'none';
    editRow.style.display = showing ? 'none' : 'block';
    if (saveBtn) saveBtn.style.display = showing ? 'none' : 'inline-block';
  }
}

async function savePanelReminder(id) {
  const dtInput = document.getElementById(`panel-r-dt-${id}`);
  const noteInput = document.getElementById(`panel-r-note-${id}`);
  if (!dtInput || !dtInput.value) return;

  try {
    const newDate = new Date(dtInput.value).toISOString();
    const res = await fetch(`${CRM_API_BASE}/api/update-reminder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        dueAt: newDate,
        note: noteInput ? noteInput.value : undefined,
        password: currentPassword,
      }),
    });
    const data = await res.json();
    if (data.success) {
      // Optimistic local update so the panel reflects the change instantly
      const reminder = allReminders.find(r => r.id === id);
      if (reminder) {
        reminder.dueAt = newDate;
        if (noteInput) reminder.note = noteInput.value;
      }
      // Collapse the edit row
      const editRow = document.getElementById(`panel-r-edit-${id}`);
      const saveBtn = document.getElementById(`panel-r-save-${id}`);
      if (editRow) editRow.style.display = 'none';
      if (saveBtn) saveBtn.style.display = 'none';
      // Refresh everything in real time — badge, lead panel list, and the
      // Reminders page table (regardless of which view is currently showing)
      updateReminderBadge();
      if (activeLead) renderLeadReminders(activeLead);
      renderReminders();
      // Also re-fetch from Airtable in the background so any server-side
      // normalizations (timezone rounding, etc.) propagate without a manual refresh
      loadReminders();
    }
  } catch (err) {
    console.error('Failed to update reminder:', err);
  }
}

// ── SYNC CALL NOTES WITH AI ───────────────────────────────────────────────
async function syncCallNotes() {
  if (!activeLead) return;
  const textarea = document.getElementById('panel-call-transcript');
  const btn = document.getElementById('panel-sync-call-btn');
  const status = document.getElementById('panel-sync-status');
  const transcript = textarea.value.trim();

  if (!transcript) {
    status.style.display = 'block';
    status.style.color = '#dc2626';
    status.textContent = 'Please paste a call transcript or notes first.';
    return;
  }

  btn.disabled = true;
  btn.textContent = '🤖 Processing with AI...';
  status.style.display = 'block';
  status.style.color = '#6b7280';
  status.textContent = 'Sending to AI for analysis...';

  try {
    const res = await fetch(`${CRM_API_BASE}/api/sync-call-notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: activeLead.email,
        leadRecordId: activeLead.id,
        transcript,
        meetingTitle: 'Call with ' + (activeLead.name || 'lead'),
      }),
    });

    const data = await res.json();

    if (data.success) {
      status.style.color = '#16a34a';
      status.textContent = '✅ Synced! ' +
        (data.extracted.hasPropertyPreferences ? 'Alert profile created. ' : '') +
        (data.extracted.followUp ? 'Reminder set. ' : '') +
        'Notes updated.';
      textarea.value = '';

      // Refresh the lead data
      await loadLeads();
      const refreshedLead = allLeads.find(l => l.id === activeLead.id);
      if (refreshedLead) {
        activeLead = refreshedLead;
        renderNotesHistory(refreshedLead.notes || '');
        renderCallHistory(refreshedLead);
        loadAlertProfiles(refreshedLead);
        renderLeadReminders(refreshedLead);
      }
    } else {
      status.style.color = '#dc2626';
      status.textContent = '❌ ' + (data.error || 'Failed to sync');
    }
  } catch (err) {
    console.error('Sync call notes error:', err);
    status.style.color = '#dc2626';
    status.textContent = '❌ Connection error — please try again';
  } finally {
    btn.disabled = false;
    btn.textContent = '🤖 Sync with AI';
  }
}

// ── NOTES HISTORY ──────────────────────────────────────────────────────────
let parsedNotes = []; // array of { header, body, raw } for editing

// Author tags written by the AI engines (Sammy reply path = "Sammy (WhatsApp)",
// engine notes = "Kevin (WhatsApp bot)", Flash coach = "Flash Coach"). Plain agent
// names (Kevin / Rosa / Dylan / Noel) are HUMAN. AI notes render in their own
// "AI Notes" section so they don't bunch with the agent's own notes (Kevin 2026-06-24).
function isAINoteAuthor(a) { return /sammy|whatsapp|bot|flash/i.test(a || ''); }

function renderNotesHistory(notesStr) {
  const container = document.getElementById('panel-notes-history');
  const aiContainer = document.getElementById('panel-ai-notes-history');
  const aiSection = document.getElementById('panel-ai-notes-section');
  if (!container) return;
  const showAI = (has) => { if (aiSection) aiSection.style.display = has ? '' : 'none'; };
  if (!notesStr || !notesStr.trim()) {
    parsedNotes = [];
    container.innerHTML = '<p class="panel-empty-text">No notes yet</p>';
    if (aiContainer) aiContainer.innerHTML = '';
    showAI(false);
    return;
  }
  // Notes are stored as: "[3/18/2026, 9:30 AM — Kevin] Note text\n\n[...] ..."
  const noteBlocks = notesStr.split(/(?=\[[\d\/]+,\s[\d:]+\s[AP]M\s—\s)/).filter(Boolean);
  if (noteBlocks.length === 0 && notesStr.trim()) {
    parsedNotes = [{ header: '', body: notesStr.trim(), raw: notesStr.trim() }];
    container.innerHTML = `<div class="note-card">
      <div class="note-body">${escHtml(notesStr)}</div>
      <div class="note-actions">
        <button class="note-edit-btn" onclick="editNote(0)">Edit</button>
        <button class="note-delete-btn" onclick="deleteNote(0)">Delete</button>
      </div>
    </div>`;
    if (aiContainer) aiContainer.innerHTML = '';
    showAI(false);
    return;
  }
  parsedNotes = noteBlocks.map(block => {
    const headerMatch = block.match(/^\[(.*?)\s—\s(.*?)\]\s*/);
    if (headerMatch) {
      return { header: headerMatch[0].trim(), body: block.slice(headerMatch[0].length).trim(), raw: block.trim() };
    }
    return { header: '', body: block.trim(), raw: block.trim() };
  });
  const humanCards = [];
  const aiCards = [];
  parsedNotes.forEach((note, i) => {
    const headerMatch = note.raw.match(/^\[(.*?)\s—\s(.*?)\]\s*/);
    const dateStr = headerMatch ? headerMatch[1] : '';
    const author = headerMatch ? headerMatch[2] : '';
    const card = headerMatch
      ? `<div class="note-card" id="note-card-${i}">
        <div class="note-header"><span class="note-author">${escHtml(author)}</span><span class="note-date">${escHtml(dateStr)}</span></div>
        <div class="note-body" id="note-body-${i}">${escHtml(note.body)}</div>
        <div class="note-actions">
          <button class="note-edit-btn" onclick="editNote(${i})">Edit</button>
          <button class="note-delete-btn" onclick="deleteNote(${i})">Delete</button>
        </div>
      </div>`
      : `<div class="note-card" id="note-card-${i}">
        <div class="note-body" id="note-body-${i}">${escHtml(note.body)}</div>
        <div class="note-actions">
          <button class="note-edit-btn" onclick="editNote(${i})">Edit</button>
          <button class="note-delete-btn" onclick="deleteNote(${i})">Delete</button>
        </div>
      </div>`;
    (isAINoteAuthor(author) ? aiCards : humanCards).push(card);
  });
  container.innerHTML = humanCards.length ? humanCards.join('') : '<p class="panel-empty-text">No notes yet</p>';
  if (aiContainer) aiContainer.innerHTML = aiCards.join('');
  showAI(aiCards.length > 0);
}

// ── AI CALL HISTORY (lead detail panel) ───────────────────────────────────
// Parses a lead's notes field for AI call entries, renders newest-first with
// a ▶ Play button (inline <audio>) when a conv id is extractable.
//
// Recognised call note shapes (real production formats as of 2026-06-19):
//
//   Shape A — engine initiation note (most common):
//     AI first_touch call #N initiated (ElevenLabs conv conv_XXXXX)
//     AI rapport call #N initiated (ElevenLabs conv conv_XXXXX)
//     AI reactivation call #N initiated (ElevenLabs conv conv_XXXXX)
//     (any "AI <mode> call #N initiated" line)
//
//   Shape B — webhook CALL SUMMARY (older / fallback; may lack conv id):
//     CALL SUMMARY (AI Speed-to-Lead Call): <summary text>
//
//   Shape C — LLAMADA IA structured block (legacy engine backstop):
//     [LLAMADA IA — YYYY-MM-DD]
//     Convo: ...
//     [conv conv_XXXXX]
//
// Conv id extraction (covers all shapes):
//   "ElevenLabs conv conv_XXXXX"  (Shape A)
//   "[conv conv_XXXXX]"           (Shape B/C)
//
// Note blocks are delimited by "[M/D/YYYY, H:MM AM/PM — Author]" headers.
function renderCallHistory(lead) {
  const section = document.getElementById('panel-ai-call-history-section');
  const container = document.getElementById('panel-ai-call-history');
  if (!section || !container) return;

  const notesStr = (lead && lead.notes) || '';

  // Split into per-note blocks (same regex as renderNotesHistory)
  const noteBlocks = notesStr
    .split(/(?=\[[\d\/]+,\s[\d:]+\s[AP]M\s—\s)/)
    .filter(Boolean);

  const callRows = [];

  for (const block of noteBlocks) {
    // Extract the timestamp header: "[M/D/YYYY, H:MM AM/PM — Author]"
    const headerMatch = block.match(/^\[([\d\/]+,\s[\d:]+\s[AP]M)\s—\s([^\]]+)\]\s*/);
    const dateStr = headerMatch ? headerMatch[1] : '';
    const body = headerMatch ? block.slice(headerMatch[0].length).trim() : block.trim();

    // Skip non-call entries early
    if (body.startsWith('[REACTIVACIÓN')) continue;

    // ── Detect AI call entries ─────────────────────────────────────────────
    // Shape A: "AI <mode> call #N initiated ..." (engine fire-time note)
    const isInitiated = /^AI \w[\w_]* call #\d+ initiated/i.test(body);
    // Shape B: webhook CALL SUMMARY
    const isCallSummary = body.startsWith('CALL SUMMARY (AI Speed-to-Lead Call)');
    // Shape C: legacy LLAMADA IA block
    const isLlamada = body.startsWith('[LLAMADA IA');

    if (!isInitiated && !isCallSummary && !isLlamada) continue;

    // ── Extract conv id ────────────────────────────────────────────────────
    // Shape A inline: "ElevenLabs conv conv_XXXXX"
    const elMatch = block.match(/ElevenLabs conv\s+(conv_[\w]+)/);
    // Shape B/C bracket: "[conv conv_XXXXX]"
    const bracketMatch = block.match(/\[conv\s+(conv_[\w]+)\]/);
    const convId = (elMatch && elMatch[1]) || (bracketMatch && bracketMatch[1]) || null;

    // ── Extract mode label ─────────────────────────────────────────────────
    let modeLabel = 'AI Call';
    if (isInitiated) {
      const modeMatch = body.match(/^AI ([\w_]+) call/i);
      if (modeMatch) {
        const raw = modeMatch[1].replace(/_/g, ' ');
        modeLabel = raw.charAt(0).toUpperCase() + raw.slice(1) + ' Call';
      }
    } else if (isCallSummary) {
      modeLabel = 'Speed-to-Lead Call';
    } else if (isLlamada) {
      modeLabel = 'AI Call';
    }

    // ── Extract summary text ───────────────────────────────────────────────
    let summary = '';
    if (isInitiated) {
      // The initiation note IS the summary ("AI first_touch call #3 initiated (ElevenLabs conv ...)")
      // Strip the conv tag for display; the whole line is the description.
      summary = body
        .replace(/\s*\(ElevenLabs conv conv_[\w]+\)/g, '')
        .trim();
    } else if (isCallSummary) {
      summary = body
        .replace(/^CALL SUMMARY \(AI Speed-to-Lead Call\):\s*/, '')
        .replace(/\[conv\s+conv_[\w]+\]/g, '')
        .trim();
    } else if (isLlamada) {
      const convoSection = body.match(/Convo:\n([\s\S]*?)(?:Next:|$)/);
      if (convoSection) {
        summary = convoSection[1]
          .replace(/^\s*-\s*/gm, '')
          .replace(/\[conv\s+conv_[\w]+\]/g, '')
          .trim();
      } else {
        summary = body
          .replace(/\[conv\s+conv_[\w]+\]/g, '')
          .replace(/^\[LLAMADA IA[^\]]*\]\s*/, '')
          .trim();
      }
    }

    // Truncate very long summaries for display (full text on hover via title)
    const MAX = 200;
    const displaySummary = summary.length > MAX ? summary.slice(0, MAX) + '…' : summary;

    callRows.push({ dateStr, modeLabel, displaySummary, fullSummary: summary, convId });
  }

  if (callRows.length === 0) {
    section.style.display = 'none';
    container.innerHTML = '<p class="panel-empty-text">No AI calls yet</p>';
    return;
  }

  section.style.display = '';

  // Render newest-first (blocks are already newest-first as notes are prepended)
  const total = callRows.length;
  container.innerHTML = callRows.map((row, i) => {
    const callNum = total - i;                // Call #N (newest = highest number)
    let playHtml = '';
    if (row.convId) {
      playHtml = `<button class="ai-call-play-btn" data-conv-id="${escHtml(row.convId)}">▶ Play</button>`;
    } else {
      playHtml = `<span class="ai-call-no-recording">recording unavailable</span>`;
    }
    return `<div class="ai-call-card" data-call-index="${i}">
      <div class="ai-call-card-header">
        <span class="ai-call-label">Call #${callNum} — ${escHtml(row.modeLabel)}</span>
        <span class="ai-call-date">${escHtml(row.dateStr)}</span>
      </div>
      <div class="ai-call-summary" title="${escHtml(row.fullSummary)}">${escHtml(row.displaySummary)}</div>
      ${playHtml}
    </div>`;
  }).join('');

  // Wire play buttons via event delegation on the container
  container.addEventListener('click', function handleCallPlay(e) {
    const btn = e.target.closest('.ai-call-play-btn');
    if (!btn) return;
    const convId = btn.dataset.convId;
    if (!convId) return;
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.autoplay = true;
    audio.src = `${CRM_API_BASE}/api/agent/ai-call-audio?id=${encodeURIComponent(convId)}&password=${encodeURIComponent(currentPassword)}`;
    btn.replaceWith(audio);
  }, { once: false });
}

function editNote(index) {
  const note = parsedNotes[index];
  if (!note) return;
  const card = document.getElementById(`note-card-${index}`);
  const bodyEl = document.getElementById(`note-body-${index}`);
  if (!card || !bodyEl) return;
  // Replace body with textarea
  const textarea = document.createElement('textarea');
  textarea.className = 'note-edit-textarea';
  textarea.value = note.body;
  textarea.rows = 3;
  bodyEl.replaceWith(textarea);
  // Replace actions with Save/Cancel
  const actionsEl = card.querySelector('.note-actions');
  actionsEl.innerHTML = `
    <button class="note-save-btn" onclick="saveEditedNote(${index})">Save</button>
    <button class="note-cancel-btn" onclick="cancelEditNote()">Cancel</button>
  `;
}

function saveEditedNote(index) {
  const note = parsedNotes[index];
  if (!note) return;
  const card = document.getElementById(`note-card-${index}`);
  const textarea = card.querySelector('.note-edit-textarea');
  if (!textarea) return;
  const newBody = textarea.value.trim();
  if (!newBody) { deleteNote(index); return; }
  // Rebuild the note with original header + new body
  parsedNotes[index].body = newBody;
  parsedNotes[index].raw = note.header ? note.header + ' ' + newBody : newBody;
  // Rebuild full notes string and save
  rebuildAndSaveNotes();
}

function deleteNote(index) {
  if (!confirm('Delete this note?')) return;
  parsedNotes.splice(index, 1);
  rebuildAndSaveNotes();
}

function cancelEditNote() {
  // Re-render notes from current state
  const notesStr = parsedNotes.map(n => n.raw).join('\n\n');
  renderNotesHistory(notesStr);
}

async function rebuildAndSaveNotes() {
  const notes = parsedNotes.map(n => n.raw).join('\n\n');
  activeLead.notes = notes;
  renderNotesHistory(notes);
  // Save to Airtable
  try {
    await fetch(`${CRM_API_BASE}/api/update-lead`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: activeLead.id,
        status: activeLead.status,
        notes,
        assignedTo: activeLead.assignedTo,
        password: currentPassword,
      }),
    });
    const lead = allLeads.find(l => String(l.id) === String(activeLead.id));
    if (lead) lead.notes = notes;
  } catch (err) { console.warn('Failed to save edited note:', err); }
}

// ── SAVE LEAD ──────────────────────────────────────────────────────────────
async function saveLead() {
  if (!activeLead) return;

  const btn        = document.getElementById('panel-save');
  const saveStatus = document.getElementById('panel-save-status');
  const status     = document.getElementById('panel-status').value;
  const assignedTo = document.getElementById('panel-assigned-to').value;
  const newNote    = document.getElementById('panel-new-note').value.trim();
  const firstName  = document.getElementById('panel-first-name')?.value.trim();
  const lastName   = document.getElementById('panel-last-name')?.value.trim();
  const phone      = document.getElementById('panel-phone-input')?.value.trim();
  const email      = document.getElementById('panel-email-input')?.value.trim();

  // Build updated notes: prepend new note with timestamp, keep old notes
  let notes = activeLead.notes || '';
  if (newNote) {
    const now = new Date();
    const dateStr = now.toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });
    const agent = (currentAgent && currentAgent.name) || 'Agent';
    const entry = `[${dateStr} — ${agent}] ${newNote}`;
    notes = notes ? entry + '\n\n' + notes : entry;
  }

  btn.disabled    = true;
  btn.textContent = 'Saving…';
  saveStatus.style.display = 'none';

  try {
    const res = await fetch(`${CRM_API_BASE}/api/update-lead`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        id:       activeLead.id,
        status,
        notes,
        assignedTo,
        firstName,
        lastName,
        email,
        phone,
        password: currentPassword,
      }),
    });

    const data = await res.json();

    if (data.success) {
      // Update local cache
      const lead = allLeads.find(l => String(l.id) === String(activeLead.id));
      if (lead) {
        lead.status     = status;
        lead.notes      = notes;
        lead.assignedTo = assignedTo;
        if (firstName !== undefined) lead.firstName = firstName;
        if (lastName  !== undefined) lead.lastName  = lastName;
        if (email     !== undefined) lead.email     = email;
        if (phone     !== undefined) lead.phone     = phone;
        // Recompute display name
        if ((firstName !== undefined || lastName !== undefined)) {
          lead.name = `${lead.firstName || ''} ${lead.lastName || ''}`.trim();
          const nameEl = document.getElementById('panel-name');
          if (nameEl) nameEl.textContent = lead.name || '—';
        }
        activeLead      = lead;
        // Belt: the table paints from filteredLeads. If anything ever hands it a
        // different object for this lead, re-point it so the row shows this save.
        const fIdx = filteredLeads.findIndex(l => String(l.id) === String(lead.id));
        if (fIdx >= 0 && filteredLeads[fIdx] !== lead) filteredLeads[fIdx] = lead;
      }
      document.getElementById('panel-new-note').value = '';
      renderNotesHistory(notes);
      renderCallHistory(activeLead);
      saveStatus.style.color   = '#16a34a';
      saveStatus.textContent   = 'Saved successfully';
      saveStatus.style.display = 'block';
      renderTable();
      renderStats();
    } else {
      saveStatus.style.color   = '#dc2626';
      saveStatus.textContent   = (data.error || 'Failed to save. Please try again.');
      saveStatus.style.display = 'block';
    }
  } catch (err) {
    console.error('Save error:', err);
    saveStatus.style.color   = '#dc2626';
    saveStatus.textContent   = 'Network error. Please try again.';
    saveStatus.style.display = 'block';
  }

  // Also save alert preferences in parallel
  await persistAlertPrefs();

  btn.disabled    = false;
  btn.textContent = 'Save Changes';
}

// Persist the panel's alert prefs (incl. the full alertProfiles array) to Airtable NOW.
// Called from the main "Save Changes" AND directly on profile add/edit/delete — a profile
// edit used to live only in the local array until "Save Changes", so editing a profile
// and walking away silently discarded it (root: Kevin's $5M lots edit, 2026-07-03).
// TOUCHED GATE (2026-07-23, Yasser Lenis): "Save Changes" only writes alert prefs when
// the alert form was actually edited this open — an untouched (possibly stale-cache)
// form must never overwrite what Claudia/Flash/preferences wrote since the page loaded.
// Direct profile add/edit/delete calls pass force=true (they ARE deliberate edits).
let _alertFormTouched = false;
async function persistAlertPrefs(force = false) {
  if (!activeLead) return false;
  if (!force && !_alertFormTouched) return true; // untouched form — nothing to persist
  const alertPrefs = getAlertPrefsFromPanel();
  try {
    await fetch(`${CRM_API_BASE}/api/update-preferences`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: activeLead.id,
        password: currentPassword,
        ...alertPrefs,
      }),
    });
    // Update local cache with alert prefs
    const lead2 = allLeads.find(l => String(l.id) === String(activeLead.id));
    if (lead2) {
      lead2.alertActive = alertPrefs.alertActive;
      lead2.alertPropertyTypes = alertPrefs.propertyTypes;
      lead2.alertCities = alertPrefs.cities;
      lead2.alertPriceMin = alertPrefs.priceMin;
      lead2.alertPriceMax = alertPrefs.priceMax;
      lead2.alertBeds = alertPrefs.bedsMin;
      lead2.alertBaths = alertPrefs.bathsMin;
      lead2.alertFrequency = alertPrefs.frequency;
      lead2.alertCount = alertPrefs.count;
      lead2.alertPolygon = alertPrefs.alertPolygon || '';
      lead2.alertProfiles = alertPrefs.alertProfiles || '';
    }
    return true;
  } catch (err) {
    console.warn('Alert preferences save failed:', err);
    return false;
  }
}

// ── ALERT PREFERENCES HELPERS ──────────────────────────────────────────────
function toggleAlertFields(active) {
  const fields = document.getElementById('panel-alert-fields');
  if (fields) fields.style.display = active ? 'block' : 'none';
}

// ── MULTI-PROFILE ALERT SYSTEM ────────────────────────────────
let alertProfiles = [];
let editingProfileIndex = -1; // -1 = adding new, >= 0 = editing existing

function loadAlertProfiles(lead) {
  alertProfiles = [];
  editingProfileIndex = -1;
  let channels = { email: true, whatsapp: false };
  // Try to load from JSON field — legacy array OR {channels, profiles} wrapper.
  if (lead.alertProfiles) {
    try {
      const parsed = typeof lead.alertProfiles === 'string' ? JSON.parse(lead.alertProfiles) : lead.alertProfiles;
      if (Array.isArray(parsed)) {
        alertProfiles = parsed;
      } else if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.profiles)) alertProfiles = parsed.profiles;
        if (parsed.channels) channels = {
          email: parsed.channels.email !== false,
          whatsapp: !!parsed.channels.whatsapp,
        };
      }
    } catch (e) { /* ignore bad JSON */ }
  }
  setAlertChannels(channels);
  // If no profiles but has legacy flat fields, migrate them into a profile
  if (alertProfiles.length === 0 && lead.alertCities) {
    alertProfiles.push({
      name: lead.alertCities.split(',')[0].trim() || 'Default',
      types: lead.alertPropertyTypes || [],
      cities: lead.alertCities || '',
      priceMin: lead.alertPriceMin || 0,
      priceMax: lead.alertPriceMax || 0,
      bedsMin: lead.alertBeds || 0,
      bathsMin: lead.alertBaths || 0,
      polygon: lead.alertPolygon || '',
    });
  }
  renderProfileCards();
  hideProfileForm();
}

function renderProfileCards() {
  const container = document.getElementById('alert-profiles-list');
  if (!container) return;
  if (alertProfiles.length === 0) {
    container.innerHTML = '<div class="alert-profile-empty">No alert profiles yet. Add one below.</div>';
    return;
  }
  container.innerHTML = alertProfiles.map((p, i) => {
    const typesStr = (p.types || []).join(', ') || 'All types';
    const citiesStr = p.cities || 'All cities';
    const priceStr = (p.priceMin || p.priceMax)
      ? '$' + (p.priceMin ? Number(p.priceMin).toLocaleString() : '0') + ' — $' + (p.priceMax ? Number(p.priceMax).toLocaleString() : 'Any')
      : 'Any price';
    const hasPolygon = p.polygon ? ' | Map area set' : '';
    const featuresStr = (p.features || []).length > 0 ? (p.features || []).join(', ') : '';
    const yearStr = p.yearBuiltMin ? 'Built ' + p.yearBuiltMin + '+' : '';
    const keywordsStr = p.keywords ? '"' + p.keywords + '"' : '';
    const extraParts = [featuresStr, yearStr, keywordsStr].filter(Boolean).join(' | ');
    return `<div class="alert-profile-card">
      <div class="alert-profile-card-header">
        <strong>${escHtml(p.name || 'Profile ' + (i + 1))}</strong>
        <div class="alert-profile-card-actions">
          <button class="alert-profile-edit-btn" onclick="editAlertProfile(${i})">Edit</button>
          <button class="alert-profile-delete-btn" onclick="deleteAlertProfile(${i})">Delete</button>
        </div>
      </div>
      <div class="alert-profile-card-detail">${escHtml(typesStr)} | ${escHtml(citiesStr)}</div>
      <div class="alert-profile-card-detail">${escHtml(priceStr)}${hasPolygon}</div>
      ${extraParts ? `<div class="alert-profile-card-detail">${escHtml(extraParts)}</div>` : ''}
    </div>`;
  }).join('');
}

function showProfileForm(profile) {
  const form = document.getElementById('alert-profile-form');
  form.style.display = 'block';
  document.getElementById('panel-alert-profile-name').value = profile ? profile.name || '' : '';
  document.getElementById('panel-alert-cities').value = profile ? profile.cities || '' : '';
  document.getElementById('panel-alert-price-min').value = profile ? profile.priceMin || '' : '';
  document.getElementById('panel-alert-price-max').value = profile ? profile.priceMax || '' : '';
  document.getElementById('panel-alert-beds').value = profile ? profile.bedsMin || '' : '';
  document.getElementById('panel-alert-baths').value = profile ? profile.bathsMin || '' : '';
  const types = profile ? (profile.types || []) : [];
  document.querySelectorAll('#panel-alert-types input').forEach(cb => {
    cb.checked = types.includes(cb.value);
  });
  const features = profile ? (profile.features || []) : [];
  document.querySelectorAll('#panel-alert-features input').forEach(cb => {
    cb.checked = features.includes(cb.value);
  });
  document.querySelectorAll('#panel-alert-waterfront input').forEach(cb => {
    cb.checked = features.includes(cb.value);
  });
  document.getElementById('panel-alert-sqft-min').value = profile ? profile.sqftMin || '' : '';
  document.getElementById('panel-alert-sqft-max').value = profile ? profile.sqftMax || '' : '';
  document.getElementById('panel-alert-lot-size').value = profile ? profile.lotSizeMin || '' : '';
  document.getElementById('panel-alert-hoa-min').value = profile ? profile.hoaMin || '' : '';
  document.getElementById('panel-alert-hoa-max').value = profile ? profile.hoaMax || '' : '';
  document.getElementById('panel-alert-year-built').value = profile ? profile.yearBuiltMin || '' : '';
  // Reset count preview
  document.getElementById('alert-count-preview').style.display = 'none';
  document.getElementById('panel-alert-keywords').value = profile ? profile.keywords || '' : '';
  // Scroll form into view first, then init map after container is visible
  setTimeout(() => {
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    // Init map after form is visible and has dimensions
    const fakeLeadForMap = { alertPolygon: profile ? profile.polygon || '' : '' };
    initAlertMap(fakeLeadForMap);
  }, 150);
}

function hideProfileForm() {
  document.getElementById('alert-profile-form').style.display = 'none';
  editingProfileIndex = -1;
}

function getProfileFromForm() {
  const types = [];
  document.querySelectorAll('#panel-alert-types input:checked').forEach(cb => types.push(cb.value));
  const features = [];
  document.querySelectorAll('#panel-alert-features input:checked').forEach(cb => features.push(cb.value));
  document.querySelectorAll('#panel-alert-waterfront input:checked').forEach(cb => features.push(cb.value));
  return {
    name: document.getElementById('panel-alert-profile-name').value.trim() || 'Untitled',
    types,
    cities: document.getElementById('panel-alert-cities').value.trim(),
    priceMin: Number(document.getElementById('panel-alert-price-min').value) || 0,
    priceMax: Number(document.getElementById('panel-alert-price-max').value) || 0,
    bedsMin: Number(document.getElementById('panel-alert-beds').value) || 0,
    bathsMin: Number(document.getElementById('panel-alert-baths').value) || 0,
    polygon: alertMapPolygons.length > 0 ? JSON.stringify(alertMapPolygons) : '',
    features,
    sqftMin: Number(document.getElementById('panel-alert-sqft-min').value) || 0,
    sqftMax: Number(document.getElementById('panel-alert-sqft-max').value) || 0,
    lotSizeMin: Number(document.getElementById('panel-alert-lot-size').value) || 0,
    hoaMin: Number(document.getElementById('panel-alert-hoa-min').value) || 0,
    hoaMax: Number(document.getElementById('panel-alert-hoa-max').value) || 0,
    yearBuiltMin: Number(document.getElementById('panel-alert-year-built').value) || 0,
    keywords: document.getElementById('panel-alert-keywords').value.trim(),
  };
}

function editAlertProfile(index) {
  editingProfileIndex = index;
  showProfileForm(alertProfiles[index]);
}

function deleteAlertProfile(index) {
  alertProfiles.splice(index, 1);
  renderProfileCards();
  hideProfileForm();
  void persistAlertPrefs(true); // deletions persist immediately too (deliberate edit — bypass touched gate)
}

// Wire up Add / Save / Cancel buttons (called once on page load)
function initProfileButtons() {
  document.getElementById('alert-profile-add-btn').addEventListener('click', () => {
    editingProfileIndex = -1;
    showProfileForm(null);
  });
  document.getElementById('alert-profile-save-btn').addEventListener('click', () => {
    const profile = getProfileFromForm();
    if (editingProfileIndex >= 0) {
      alertProfiles[editingProfileIndex] = profile;
    } else {
      alertProfiles.push(profile);
    }
    renderProfileCards();
    hideProfileForm();
    void persistAlertPrefs(true); // profile edits save immediately — deliberate edit, bypass touched gate
  });
  document.getElementById('alert-profile-cancel-btn').addEventListener('click', () => {
    hideProfileForm();
  });
  document.getElementById('alert-count-btn').addEventListener('click', checkPropertyCount);

  // Auto-update count when any filter changes
  const formEl = document.getElementById('alert-profile-form');
  if (formEl) {
    let autoDebounce;
    formEl.addEventListener('input', () => { clearTimeout(autoDebounce); autoDebounce = setTimeout(checkPropertyCount, 800); });
    formEl.addEventListener('change', () => { clearTimeout(autoDebounce); autoDebounce = setTimeout(checkPropertyCount, 300); });
  }
}

// ── Property preview markers on the map ──
let previewMarkers = [];

// ── Map property selection (Kevin 2026-07-17: select-on-map → send Email/WhatsApp) ──
// Map of mlsId (String(ListingId)) -> listing object. Module-level so the popup
// toggle button and the floating action bar share one source of truth. MUST be
// reset whenever the panel switches leads — see resetMapSelection(), called from
// openPanel()/closePanel() — never carry a selection from one lead to another.
let selectedMapProps = new Map();
const MAX_MAP_SELECTION = 5;

function clearPreviewMarkers() {
  previewMarkers.forEach(m => m.remove());
  previewMarkers = [];
}

function plotPreviewMarkers(listings) {
  clearPreviewMarkers();
  if (!alertMap || !listings.length) return;

  const bounds = new maplibregl.LngLatBounds();
  let hasBounds = false;

  listings.forEach(l => {
    const lat = l.Latitude;
    const lng = l.Longitude;
    if (lat == null || lng == null) return;

    const price = l.ListPrice ? '$' + (l.ListPrice >= 1000000
      ? (l.ListPrice / 1000000).toFixed(1) + 'M'
      : Math.round(l.ListPrice / 1000) + 'K') : '';

    const mlsId = String(l.ListingId || '');
    const isSelected = mlsId && selectedMapProps.has(mlsId);

    const el = document.createElement('div');
    el.className = 'preview-marker' + (isSelected ? ' selected' : '');
    el.innerHTML = price;

    const popup = new maplibregl.Popup({ offset: 20, maxWidth: '280px' })
      .setHTML(buildPreviewPopupHtml(l));

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([lng, lat])
      .setPopup(popup)
      .addTo(alertMap);

    // Wire the "Seleccionar/Quitar" button each time the popup opens — its DOM
    // is (re)built by setHTML, so a plain addEventListener at construction time
    // wouldn't survive a later re-render. The button is the PRIMARY toggle;
    // the marker itself only gets a distinct .selected style (gold), not an
    // independent click target — its own pointer-events are disabled so pans
    // pass through to the canvas (see .preview-marker in crm.css).
    popup.on('open', () => {
      const popupEl = popup.getElement && popup.getElement();
      const btn = popupEl && popupEl.querySelector('.map-popup-select-btn');
      if (btn) btn.addEventListener('click', () => toggleMapPropSelection(l, marker, btn));
    });

    previewMarkers.push(marker);
    bounds.extend([lng, lat]);
    hasBounds = true;
  });

  if (hasBounds) {
    alertMap.fitBounds(bounds, { padding: 50, maxZoom: 13 });
  }

  ensureMapSelectBar();
  renderMapSelectionBar();
}

// ── Rich property popup (Kevin 2026-07-17) ──
// All remote MLS text goes through escHtml() — Bridge data is untrusted input.
function buildPreviewPopupHtml(l) {
  const mlsId = String(l.ListingId || '');
  const price = l.ListPrice ? '$' + Number(l.ListPrice).toLocaleString('en-US') : 'Price TBD';
  const photo = (Array.isArray(l.Media) && l.Media.length && l.Media[0].MediaURL) ? l.Media[0].MediaURL : '';
  const address = l.UnparsedAddress || l.City || 'South Florida';
  const beds = l.BedroomsTotal != null ? l.BedroomsTotal : '—';
  const baths = l.BathroomsTotalInteger != null ? l.BathroomsTotalInteger : '—';
  const sqft = l.LivingArea ? Number(l.LivingArea).toLocaleString('en-US') + ' sf' : '';
  const subType = l.PropertySubType || '';
  const year = l.YearBuilt || '';
  const subYear = [subType, year].filter(Boolean).join(' · ');
  const isSelected = mlsId && selectedMapProps.has(mlsId);
  const viewUrl = `https://www.homesinsoflorida.com/listing?mls=${encodeURIComponent(mlsId)}`;

  return `
    <div class="map-popup-card">
      ${photo
        ? `<img class="map-popup-photo" src="${escHtml(photo)}" alt="${escHtml(address)}" loading="lazy" />`
        : `<div class="map-popup-photo map-popup-photo-empty">Sin foto</div>`}
      <div class="map-popup-body">
        <div class="map-popup-price">${escHtml(price)}</div>
        <div class="map-popup-specs">${escHtml(String(beds))} hab · ${escHtml(String(baths))} baños${sqft ? ' · ' + escHtml(sqft) : ''}</div>
        <div class="map-popup-address">${escHtml(address)}</div>
        ${subYear ? `<div class="map-popup-meta">${escHtml(subYear)}</div>` : ''}
        <div class="map-popup-mls">MLS# ${escHtml(mlsId || '—')}</div>
        <div class="map-popup-actions">
          <a href="${escHtml(viewUrl)}" target="_blank" rel="noopener noreferrer" class="map-popup-view-btn">Ver listing</a>
          <button type="button" class="map-popup-select-btn${isSelected ? ' is-selected' : ''}" data-mls="${escHtml(mlsId)}">${isSelected ? '✓ Quitar' : '+ Seleccionar'}</button>
        </div>
      </div>
    </div>`;
}

function toggleMapPropSelection(listing, marker, btnEl) {
  const mlsId = String(listing.ListingId || '');
  if (!mlsId) return;

  if (selectedMapProps.has(mlsId)) {
    selectedMapProps.delete(mlsId);
    if (btnEl) { btnEl.textContent = '+ Seleccionar'; btnEl.classList.remove('is-selected'); }
    const el = marker && marker.getElement && marker.getElement();
    if (el) el.classList.remove('selected');
  } else {
    if (selectedMapProps.size >= MAX_MAP_SELECTION) {
      alert('Máximo 5 propiedades por envío');
      return;
    }
    selectedMapProps.set(mlsId, listing);
    if (btnEl) { btnEl.textContent = '✓ Quitar'; btnEl.classList.add('is-selected'); }
    const el = marker && marker.getElement && marker.getElement();
    if (el) el.classList.add('selected');
  }
  renderMapSelectionBar();
}

// ── Floating select→send action bar (lives inside #alert-map) ──
function ensureMapSelectBar() {
  const container = document.getElementById('alert-map');
  if (!container) return null;
  let bar = document.getElementById('map-select-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'map-select-bar';
    bar.className = 'map-select-bar';
    container.appendChild(bar);
  }
  return bar;
}

function renderMapSelectionBar() {
  const bar = document.getElementById('map-select-bar');
  if (!bar) return;
  const n = selectedMapProps.size;
  if (n === 0) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }
  const hasEmail = !!(activeLead && activeLead.email);
  const hasPhone = !!(activeLead && activeLead.phone);
  bar.style.display = 'flex';
  bar.innerHTML = `
    <span class="map-select-bar-count">${n} seleccionada${n === 1 ? '' : 's'}</span>
    <button type="button" id="map-select-send-email" class="map-select-bar-btn" ${hasEmail ? '' : 'disabled title="Este lead no tiene email"'}>✉️ Email</button>
    <button type="button" id="map-select-send-wa" class="map-select-bar-btn" ${hasPhone ? '' : 'disabled title="Este lead no tiene teléfono"'}>💬 WhatsApp 954</button>
    <button type="button" id="map-select-clear" class="map-select-bar-clear" title="Limpiar selección">✕</button>
  `;
  const emailBtn = document.getElementById('map-select-send-email');
  const waBtn = document.getElementById('map-select-send-wa');
  const clearBtn = document.getElementById('map-select-clear');
  if (emailBtn) emailBtn.addEventListener('click', () => sendSelectedMapProps({ email: true, whatsapp: false }));
  if (waBtn) waBtn.addEventListener('click', () => sendSelectedMapProps({ email: false, whatsapp: true }));
  if (clearBtn) clearBtn.addEventListener('click', () => resetMapSelection());
}

// Clears selection state + UI, WITHOUT touching activeLead. Called on ✕ and
// after a successful send. Distinct from resetMapSelection() (lead-switch hook)
// only in that it doesn't need to run on every openPanel — same effect either way.
function clearMapSelectionOnly() {
  previewMarkers.forEach(m => {
    const el = m.getElement && m.getElement();
    if (el) el.classList.remove('selected');
    const popup = m.getPopup && m.getPopup();
    if (popup && popup.isOpen && popup.isOpen()) popup.remove();
  });
  selectedMapProps.clear();
  renderMapSelectionBar();
}

// Full reset — selection data + visible markers + the bar itself. Hooked into
// openPanel() (new lead) and closePanel() so a selection NEVER carries across
// leads (wrong-lead send would be client-facing disaster).
function resetMapSelection() {
  selectedMapProps.clear();
  clearPreviewMarkers();
  const bar = document.getElementById('map-select-bar');
  if (bar) { bar.style.display = 'none'; bar.innerHTML = ''; }
}

function describeMapSendChannels(ch, lead) {
  const parts = [];
  if (ch && ch.email) {
    if (ch.email.status === 'sent') parts.push(`✉️ Email → ${ch.email.to || (lead && lead.email) || ''}`);
    else if (ch.email.status === 'skipped') parts.push(`✉️ Email omitido (${ch.email.reason || 'sin email'})`);
    else parts.push(`✉️ Email falló${ch.email.reason ? ': ' + ch.email.reason : ''}`);
  }
  if (ch && ch.whatsapp) {
    const w = ch.whatsapp;
    if (w.status === 'sent') {
      parts.push(`💬 WhatsApp → ${(lead && lead.phone) || 'lead'}`);
    } else if (w.status === 'partial') {
      parts.push('💬 WhatsApp parcial — algunos envíos fallaron (ver detalle abajo)');
    } else if (w.status === 'skipped') {
      parts.push(`💬 WhatsApp omitido (${w.reason || 'sin teléfono'})`);
    } else {
      const reasons = (w.sends || [w]).map(s => String(s.reason || '')).join(' ');
      parts.push(/63049/.test(reasons)
        ? '💬 WhatsApp no entregado — Meta bloquea plantillas de WhatsApp a números de EE.UU. (+1); deja esos leads solo en Email'
        : '💬 WhatsApp falló');
    }
  }
  return parts;
}

async function sendSelectedMapProps(channels) {
  if (!activeLead) return;
  let lead = activeLead;
  const mlsIds = Array.from(selectedMapProps.keys());
  if (mlsIds.length === 0) return;
  if (channels.email && !lead.email) { alert('Este lead no tiene email — no se puede enviar por Email.'); return; }
  if (channels.whatsapp && !lead.phone) { alert('Este lead no tiene teléfono — no se puede enviar por WhatsApp.'); return; }

  const channelLabel = channels.email ? 'Email' : 'WhatsApp (954)';
  const n = mlsIds.length;
  if (!confirm(`Enviar a ${lead.name || 'este lead'} ${n} propiedad${n === 1 ? '' : 'es'} seleccionada${n === 1 ? '' : 's'} por ${channelLabel}?`)) return;
  if (!activeLead) return;             // panel closed mid-confirm
  lead = activeLead; // re-captured post-confirm — multi-window race guard (cold QA 2026-07-17)

  const bar = document.getElementById('map-select-bar');
  const barButtons = bar ? bar.querySelectorAll('.map-select-bar-btn, .map-select-bar-clear') : [];
  barButtons.forEach(b => { b.disabled = true; });

  try {
    const res = await fetch(`${CRM_API_BASE}/api/agent/send-map-props`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: currentPassword,
        leadId: lead.id,
        mlsIds,
        channels,
        agentName: currentAgent ? currentAgent.name : 'Kevin',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      const parts = describeMapSendChannels(data.channels, lead);
      alert(parts.length ? parts.join('\n') : 'Enviado.');
      clearMapSelectionOnly();
      // Refresh the lead's notes in the panel (mirrors the granola-sync
      // refresh pattern: reload leads, re-render notes for this lead).
      try {
        await loadLeads();
        const refreshedLead = allLeads.find(x => x.id === lead.id);
        if (refreshedLead) {
          activeLead = refreshedLead;
          renderNotesHistory(refreshedLead.notes || '');
        }
      } catch (_) { /* non-fatal */ }
    } else {
      const parts = describeMapSendChannels(data.channels, lead);
      alert(`No se pudo enviar: ${data.error || res.status}` + (parts.length ? `\n${parts.join('\n')}` : ''));
      barButtons.forEach(b => { b.disabled = false; });
    }
  } catch (e) {
    alert(`No se pudo enviar: ${e.message}`);
    barButtons.forEach(b => { b.disabled = false; });
  }
}

// ── CLIENT-SIDE FEATURE MATCHING (mirrors send-alerts.js matchesFeature) ──
function matchesFeatureLocal(listing, feature) {
  const arrContains = (arr, ...terms) => {
    if (!Array.isArray(arr)) return false;
    const lower = arr.map(s => (s || '').toLowerCase());
    return terms.some(t => lower.some(v => v.includes(t.toLowerCase())));
  };
  const remarks = (listing.PublicRemarks || '').toLowerCase();
  switch (feature) {
    case 'Waterfront / Ocean View':
      return listing.WaterfrontYN === true
        || arrContains(listing.View, 'ocean', 'water', 'bay', 'intracoastal', 'lake')
        || arrContains(listing.WaterfrontFeatures, 'ocean', 'water', 'bay', 'lake', 'canal');
    case 'Waterfront / Beach':
      return arrContains(listing.WaterfrontFeatures, 'ocean', 'beach')
        || arrContains(listing.View, 'ocean', 'beach', 'direct ocean');
    case 'Waterfront / Bay':
      return arrContains(listing.WaterfrontFeatures, 'bay', 'intracoastal')
        || arrContains(listing.View, 'bay', 'intracoastal');
    case 'Waterfront / Lake':
      return arrContains(listing.WaterfrontFeatures, 'lake')
        || arrContains(listing.View, 'lake')
        || remarks.includes('lake');
    case 'Waterfront / Canal':
      return arrContains(listing.WaterfrontFeatures, 'canal')
        || arrContains(listing.View, 'canal');
    case 'Balcony / Terrace':
      return arrContains(listing.PatioAndPorchFeatures, 'balcony', 'terrace', 'deck', 'lanai');
    case 'Pool':
      return Array.isArray(listing.PoolFeatures) && listing.PoolFeatures.length > 0;
    case 'Short-Term Rental Allowed': {
      const restrictions = listing.MIAMIRE_Restrictions || [];
      const hasDaily = arrContains(restrictions, 'Daily Rentals Allowed');
      const noRestrictions = arrContains(restrictions, 'No Restrictions');
      const noDaily = arrContains(restrictions, 'No Daily Rentals');
      const strInRemarks = remarks.includes('short term rental') || remarks.includes('short-term rental') || remarks.includes('airbnb') || remarks.includes('vrbo') || remarks.includes('daily rental') || remarks.includes('hotel program') || remarks.includes('nightly rental');
      if (noDaily) return false;
      if (hasDaily || noRestrictions || strInRemarks) return true;
      return false;
    }
    case 'Gated Community':
      return arrContains(listing.CommunityFeatures || listing.AssociationAmenities, 'gated', 'guard', 'security')
        || remarks.includes('gated') || remarks.includes('guard gate') || remarks.includes('private community');
    case 'Golf Course':
      return arrContains(listing.CommunityFeatures || listing.AssociationAmenities, 'golf')
        || remarks.includes('golf');
    case 'Large Lot':
      return (listing.LotSizeSquareFeet && listing.LotSizeSquareFeet >= 21780);
    case 'High Rise':
      return arrContains(listing.ArchitecturalStyle, 'high rise', 'highrise');
    case 'Penthouse':
      return arrContains(listing.ArchitecturalStyle, 'penthouse')
        || remarks.includes('penthouse');
    case 'No HOA': {
      const fee = parseFloat(listing.AssociationFee);
      return !fee || fee === 0;
    }
    case 'Preconstruction':
      // Mirrors lib/alert-search.js PRECON_CONDITIONS — the only two PropertyCondition
      // values the miamire feed uses for new development (probed 2026-07-10).
      return arrContains(listing.PropertyCondition, 'New Construction', 'Under Construction');
    default:
      return true;
  }
}

// ── Point-in-polygon test (ray-casting) ──
function pointInPolygonLocal(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][1], yi = ring[i][0];
    const xj = ring[j][1], yj = ring[j][0];
    if ((yi > lng) !== (yj > lng) && lat < (xj - xi) * (lng - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ── CHECK PROPERTY COUNT + PLOT ON MAP ──
let countFetchId = 0;
async function checkPropertyCount() {
  const preview = document.getElementById('alert-count-preview');
  const countNum = document.getElementById('alert-count-number');
  const btn = document.getElementById('alert-count-btn');
  const fetchId = ++countFetchId;

  preview.style.display = 'block';
  countNum.textContent = '...';
  if (btn) btn.textContent = '⏳ Checking...';

  try {
    const profile = getProfileFromForm();
    // Request all fields needed for client-side feature filtering.
    // Without this, Bridge API returns a limited default set and fields like
    // WaterfrontFeatures, View, PoolFeatures, etc. come back undefined —
    // causing feature filters to silently fail.
    const FEATURE_FIELDS = [
      'ListingId','ListPrice','City','PropertySubType','BedroomsTotal',
      'BathroomsTotalInteger','LivingArea','LotSizeSquareFeet','AssociationFee',
      'YearBuilt','Latitude','Longitude','PublicRemarks','UnparsedAddress',
      'WaterfrontYN','WaterfrontFeatures','View','PoolFeatures',
      'PatioAndPorchFeatures','CommunityFeatures','AssociationAmenities',
      'MIAMIRE_Restrictions','ArchitecturalStyle','ListingKey',
      'Media','ListOfficeName','PropertyCondition',
    ].join(',');

    const isRental = (profile.types || []).includes('For Rent');
    const params = new URLSearchParams({
      limit: '200',
      PropertyType: isRental ? 'Residential Lease' : 'Residential',
      StandardStatus: 'Active',
      fields: FEATURE_FIELDS,
    });

    const cities = (profile.cities || '').split(',').map(s => s.trim()).filter(Boolean);

    // If polygon is drawn but no cities specified, derive cities from polygon center
    const hasPolygon = alertMapPolygons && alertMapPolygons.length > 0;
    if (hasPolygon && cities.length === 0) {
      // Get all coords from drawn polygons to find center
      const allCoords = alertMapPolygons.flatMap(g => g.coordinates ? g.coordinates[0] : []);
      if (allCoords.length > 0) {
        const lats = allCoords.map(c => c[1]);
        const lngs = allCoords.map(c => c[0]);
        const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
        const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
        // Find nearby South FL cities based on center point (within ~30km)
        const CITY_COORDS = [
          {name:'Miami Beach',lat:25.79,lng:-80.13},{name:'Sunny Isles Beach',lat:25.95,lng:-80.12},
          {name:'Aventura',lat:25.96,lng:-80.14},{name:'Hallandale Beach',lat:25.98,lng:-80.15},
          {name:'Hollywood',lat:26.01,lng:-80.15},{name:'Fort Lauderdale',lat:26.12,lng:-80.14},
          {name:'Pompano Beach',lat:26.24,lng:-80.12},{name:'Boca Raton',lat:26.36,lng:-80.08},
          {name:'Deerfield Beach',lat:26.32,lng:-80.10},{name:'Miami',lat:25.76,lng:-80.19},
          {name:'Coral Gables',lat:25.72,lng:-80.27},{name:'North Miami',lat:25.89,lng:-80.19},
          {name:'North Miami Beach',lat:25.93,lng:-80.16},{name:'Doral',lat:25.82,lng:-80.36},
          {name:'Homestead',lat:25.47,lng:-80.48},{name:'Key Biscayne',lat:25.69,lng:-80.16},
          {name:'Oakland Park',lat:26.17,lng:-80.13},{name:'Wilton Manors',lat:26.16,lng:-80.14},
          {name:'Dania Beach',lat:26.05,lng:-80.14},{name:'Delray Beach',lat:26.46,lng:-80.07},
          {name:'West Palm Beach',lat:26.72,lng:-80.05},{name:'Palm Beach',lat:26.71,lng:-80.04},
          {name:'Boynton Beach',lat:26.53,lng:-80.07},{name:'Lake Worth Beach',lat:26.62,lng:-80.06},
        ];
        const nearbyCities = CITY_COORDS
          .map(c => ({ name: c.name, dist: Math.sqrt(Math.pow((c.lat-centerLat)*111,2) + Math.pow((c.lng-centerLng)*111*Math.cos(centerLat*Math.PI/180),2)) }))
          .filter(c => c.dist < 30)
          .sort((a,b) => a.dist - b.dist)
          .slice(0, 10)
          .map(c => c.name);
        if (nearbyCities.length > 0) cities.push(...nearbyCities);
      }
    }

    if (cities.length === 1) params.set('City', cities[0]);

    const typeMap = { 'Single Family': 'Single Family Residence', 'Condo': 'Condominium', 'Townhouse': 'Townhouse', 'Multi Family': 'Multi Family' };
    const nonRentalTypes = (profile.types || []).filter(t => t !== 'For Rent');
    // 'Land' lives under a different Bridge PropertyType — handled as its own query
    // variant below (this preview showed a hard 0 for lots before, 2026-07-03).
    const wantsLand = !isRental && nonRentalTypes.includes('Land');
    const residentialTypes = nonRentalTypes.filter(t => t !== 'Land');
    if (!isRental && residentialTypes.length === 1) {
      params.set('PropertySubType', typeMap[residentialTypes[0]] || residentialTypes[0]);
    }

    if (profile.priceMin > 0) params.set('ListPrice.gte', String(profile.priceMin));
    if (profile.priceMax > 0) params.set('ListPrice.lte', String(profile.priceMax));
    if (profile.bedsMin > 0) params.set('BedroomsTotal.gte', String(profile.bedsMin));
    if (profile.bathsMin > 0) params.set('BathroomsTotalInteger.gte', String(profile.bathsMin));
    if (profile.sqftMin > 0) params.set('LivingArea.gte', String(profile.sqftMin));
    if (profile.sqftMax > 0) params.set('LivingArea.lte', String(profile.sqftMax));
    if (profile.lotSizeMin > 0) params.set('LotSizeSquareFeet.gte', String(profile.lotSizeMin));
    if (profile.hoaMin > 0) params.set('AssociationFee.gte', String(profile.hoaMin));
    if (profile.hoaMax > 0) params.set('AssociationFee.lte', String(profile.hoaMax));
    if (profile.yearBuiltMin > 0) params.set('YearBuilt.gte', String(profile.yearBuiltMin));

    // Push waterfront filter to the API level so we don't waste slots on non-waterfront listings
    const waterFrontFeatures = (profile.features || []).filter(f => f.startsWith('Waterfront'));
    if (waterFrontFeatures.length > 0) {
      params.set('WaterfrontYN', 'true');
    }

    // Push pool filter to API level
    if ((profile.features || []).includes('Pool')) {
      params.set('PoolPrivateYN', 'true');
    }

    // Push preconstruction to API level (mirrors lib/alert-search.js searchProfile) —
    // client-side filtering alone would count from a mostly-resale fetch window.
    if ((profile.features || []).includes('Preconstruction')) {
      params.set('PropertyCondition.in', 'New Construction,Under Construction');
    }

    // Query variants: the residential query, plus (when Land is checked) two land
    // queries under PropertyType "Land/Boat Docks" (subtypes Residential + Agriculture,
    // excluding the lone Dockominium) with the residential-only filters stripped —
    // vacant land has no beds/baths/living area/year built.
    const paramVariants = [];
    const landOnly = wantsLand && residentialTypes.length === 0;
    if (!landOnly) paramVariants.push(params);
    if (wantsLand) {
      for (const landSub of ['Residential', 'Agriculture']) {
        const lp = new URLSearchParams(params);
        lp.set('PropertyType', 'Land/Boat Docks');
        lp.set('PropertySubType', landSub);
        lp.delete('BedroomsTotal.gte');
        lp.delete('BathroomsTotalInteger.gte');
        lp.delete('LivingArea.gte');
        lp.delete('LivingArea.lte');
        lp.delete('YearBuilt.gte');
        paramVariants.push(lp);
      }
    }

    // Fetch with pagination (up to 3 pages of 200 = 600 max, per variant)
    let allListings = [];
    async function fetchPage(p, offset) {
      p.set('offset', String(offset));
      const res = await fetch(`${BRIDGE_BASE}/listings?${p}`);
      const data = await res.json();
      return data.success && data.bundle ? data.bundle : [];
    }

    if (cities.length > 1) {
      const fetches = [];
      for (const base of paramVariants) {
        for (const city of cities) {
          const p = new URLSearchParams(base);
          p.set('City', city);
          fetches.push(fetch(`${BRIDGE_BASE}/listings?${p}`).then(r => r.json()).then(d => d.success && d.bundle ? d.bundle : []).catch(() => []));
        }
      }
      const results = await Promise.all(fetches);
      allListings = results.flat();
    } else {
      for (const base of paramVariants) {
        // Page 1
        let page1 = await fetchPage(new URLSearchParams(base), 0);
        allListings = allListings.concat(page1);
        // Page 2 if first page was full
        if (page1.length >= 200) {
          let page2 = await fetchPage(new URLSearchParams(base), 200);
          allListings = allListings.concat(page2);
          // Page 3
          if (page2.length >= 200) {
            let page3 = await fetchPage(new URLSearchParams(base), 400);
            allListings = allListings.concat(page3);
          }
        }
      }
    }

    // Abort if a newer fetch started
    if (fetchId !== countFetchId) return;

    // Apply polygon filter — only show properties INSIDE drawn area
    if (hasPolygon) {
      const rings = alertMapPolygons
        .filter(g => g && g.type === 'Polygon' && g.coordinates)
        .map(g => g.coordinates[0]);
      if (rings.length > 0) {
        allListings = allListings.filter(l => {
          const lat = l.Latitude;
          const lng = l.Longitude;
          if (lat == null || lng == null) return false; // Exclude if no coords when polygon is active
          return rings.some(ring => pointInPolygonLocal(lat, lng, ring));
        });
      }
    }

    // Apply client-side feature filters
    const features = profile.features || [];
    if (features.length > 0) {
      allListings = allListings.filter(l => features.every(feat => matchesFeatureLocal(l, feat)));
    }

    // Apply keyword filter — search description + architecture/community fields
    if (profile.keywords) {
      const kws = profile.keywords.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
      if (kws.length > 0) {
        const joinField = v => v ? (Array.isArray(v) ? v.join(' ') : String(v)) : '';
        allListings = allListings.filter(l => {
          const searchText = [
            l.PublicRemarks || '',
            joinField(l.ArchitecturalStyle),
            joinField(l.CommunityFeatures),
            joinField(l.AssociationAmenities),
            joinField(l.MIAMIRE_Restrictions),
          ].join(' ').toLowerCase();
          return kws.some(kw => searchText.includes(kw));
        });
      }
    }

    // Deduplicate
    const seen = new Set();
    allListings = allListings.filter(l => {
      if (seen.has(l.ListingId)) return false;
      seen.add(l.ListingId);
      return true;
    });

    // Precon profiles ALSO source the curated /preconstruction towers (the engine
    // sends towers first, MLS New/Under Construction as backfill — 2026-08-05).
    // Mirror the engine's tower filter so the count matches what the lead gets;
    // towers have no lat/lng, so the map keeps plotting only the MLS units.
    let towerCount = 0;
    if ((profile.features || []).includes('Preconstruction')) {
      try {
        const pcRes = await fetch('/api/preconstructions');
        const pcData = await pcRes.json();
        const pCities = String(profile.cities || '').split(/[,\n]/).map(s => s.trim().toLowerCase()).filter(Boolean);
        const pMax = Number(profile.priceMax) || 0;
        const pBeds = Number(profile.bedsMin) || 0;
        towerCount = (pcData.buildings || []).filter(t => {
          if (!t.priceFrom) return false;
          if (pCities.length) {
            const area = String(t.area || '').toLowerCase();
            const cty = String(t.city || '').toLowerCase();
            if (!pCities.some(c => area.includes(c) || cty.includes(c) || c.includes(area))) return false;
          }
          if (pMax && t.priceFrom > pMax) return false;
          if (pBeds && Array.isArray(t.bedrooms) && t.bedrooms.length && Math.max(...t.bedrooms) < pBeds) return false;
          return true;
        }).length;
      } catch (_) { /* tower count is additive best-effort; MLS count still shows */ }
    }

    if (fetchId !== countFetchId) return;
    countNum.textContent = towerCount > 0
      ? `${towerCount + allListings.length} (${towerCount} precon towers + ${allListings.length} MLS)`
      : allListings.length;
    plotPreviewMarkers(allListings);

  } catch (err) {
    console.error('Count check error:', err);
    if (fetchId === countFetchId) countNum.textContent = 'Error';
  } finally {
    if (fetchId === countFetchId && btn) btn.textContent = '📊 Check Available Properties';
  }
}

function getAlertPrefsFromPanel() {
  // Build prefs including the full profiles array + delivery channels
  const first = alertProfiles[0] || {};
  const prefs = {
    alertActive:    document.getElementById('panel-alert-active').checked,
    propertyTypes:  first.types || [],
    cities:         first.cities || '',
    priceMin:       first.priceMin || 0,
    priceMax:       first.priceMax || 0,
    bedsMin:        first.bedsMin || 0,
    bathsMin:       first.bathsMin || 0,
    frequency:      document.getElementById('panel-alert-frequency').value,
    count:          Number(document.getElementById('panel-alert-count').value) || 5,
    alertPolygon:   first.polygon || '',
    alertProfiles:  serializeAlertProfilesClient(alertProfiles, getAlertChannelsFromPanel()),
  };
  return prefs;
}

// ── DELIVERY CHANNELS (email / whatsapp) ─────────────────────────────────────
// Channels live inside the Alert Profiles wrapper. Default = email-only; the
// plain-array legacy shape is preserved (no wrapper) unless whatsapp is on / email
// off, mirroring lib/alert-search.js serializeAlertProfiles.
function setAlertChannels(channels) {
  const emailCb = document.getElementById('panel-alert-channel-email');
  const waCb    = document.getElementById('panel-alert-channel-whatsapp');
  if (emailCb) emailCb.checked = channels.email !== false;
  if (waCb)    waCb.checked    = !!channels.whatsapp;
}

function getAlertChannelsFromPanel() {
  const emailCb = document.getElementById('panel-alert-channel-email');
  const waCb    = document.getElementById('panel-alert-channel-whatsapp');
  return {
    email:    emailCb ? emailCb.checked : true,
    whatsapp: waCb ? waCb.checked : false,
  };
}

function serializeAlertProfilesClient(profiles, channels) {
  const list = Array.isArray(profiles) ? profiles : [];
  const ch = { email: channels.email !== false, whatsapp: !!channels.whatsapp };
  if (ch.email === true && ch.whatsapp === false) return JSON.stringify(list);
  return JSON.stringify({ channels: ch, profiles: list });
}

// ── ALERT MAP (MapLibre GL JS — vector tiles, smooth zoom) ────────────────
let alertMap = null;
let alertMapPolygons = []; // array of GeoJSON Polygon geometries
let alertMapDrawing = false;
let alertMapDrawMode = null; // 'circle' or 'freehand'
let alertMapDrawPoints = [];
let alertMapCircleCenter = null;

function initAlertMap(lead) {
  // Destroy previous map instance
  if (alertMap) {
    alertMap.remove();
    alertMap = null;
  }
  alertMapPolygons = [];
  alertMapDrawing = false;
  alertMapDrawPoints = [];

  const container = document.getElementById('alert-map');
  if (!container || typeof maplibregl === 'undefined') return;

  // Initialize map centered on South Florida with vector tiles
  alertMap = new maplibregl.Map({
    container: 'alert-map',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    center: [-80.15, 25.9],
    zoom: 10,
    attributionControl: true,
    clickTolerance: 10, // pixels — allows small mouse movements to still count as clicks
  });

  alertMap.addControl(new maplibregl.NavigationControl(), 'top-left');

  alertMap.on('load', () => {
    // Add polygon source + layers
    alertMap.addSource('alert-polygon', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    alertMap.addLayer({
      id: 'alert-polygon-fill',
      type: 'fill',
      source: 'alert-polygon',
      paint: { 'fill-color': '#1a2744', 'fill-opacity': 0.15 },
    });
    alertMap.addLayer({
      id: 'alert-polygon-outline',
      type: 'line',
      source: 'alert-polygon',
      paint: { 'line-color': '#1a2744', 'line-width': 2 },
    });

    // Drawing points source (shown while drawing)
    alertMap.addSource('draw-points', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    alertMap.addLayer({
      id: 'draw-points-circle',
      type: 'circle',
      source: 'draw-points',
      paint: { 'circle-radius': 5, 'circle-color': '#1a2744', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' },
    });
    // Drawing line preview
    alertMap.addSource('draw-line', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    alertMap.addLayer({
      id: 'draw-line-stroke',
      type: 'line',
      source: 'draw-line',
      paint: { 'line-color': '#1a2744', 'line-width': 2, 'line-dasharray': [2, 2] },
    });

    // Load existing polygons (supports single Polygon or array of Polygons)
    if (lead && lead.alertPolygon) {
      try {
        const geo = typeof lead.alertPolygon === 'string' ? JSON.parse(lead.alertPolygon) : lead.alertPolygon;
        if (Array.isArray(geo)) {
          // New format: array of polygon geometries
          alertMapPolygons = geo;
        } else if (geo && geo.type === 'Polygon' && geo.coordinates) {
          // Legacy format: single polygon
          alertMapPolygons = [geo];
        }
        if (alertMapPolygons.length > 0) {
          renderAllPolygons();
          // Fit to bounds of all polygons
          const allCoords = alertMapPolygons.flatMap(p => p.coordinates[0]);
          if (allCoords.length > 0) {
            const bounds = allCoords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(allCoords[0], allCoords[0]));
            alertMap.fitBounds(bounds, { padding: 40 });
          }
        }
      } catch (err) {
        console.warn('Failed to parse alert polygon:', err);
      }
    }
  });

  // Remove any legacy overlay from an earlier implementation
  const oldOverlay = document.getElementById('alert-map-draw-overlay');
  if (oldOverlay) oldOverlay.remove();
  container.style.position = 'relative';

  // Create a dedicated drawing overlay that sits on top of the map canvas.
  // When NOT drawing: pointer-events: none, so pan/zoom/markers work normally.
  // When drawing:     pointer-events: auto, so it captures mouse events first
  //                   and nothing (markers, canvas, controls) can steal them.
  const drawOverlay = document.createElement('div');
  drawOverlay.id = 'alert-map-draw-overlay';
  drawOverlay.style.cssText = [
    'position:absolute',
    'inset:0',
    'z-index:5',
    'pointer-events:none',
    'cursor:crosshair',
  ].join(';');
  container.appendChild(drawOverlay);

  // Convert a client (pixel) coordinate on the overlay into a map lngLat
  function pxToLngLat(clientX, clientY) {
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return alertMap.unproject([x, y]);
  }

  let overlayMouseDown = false;

  // --- Shared draw handlers (mouse + touch) ---
  function handleDrawStart(clientX, clientY, e) {
    if (!alertMapDrawing) return;
    e.preventDefault();
    e.stopPropagation();
    overlayMouseDown = true;
    const ll = pxToLngLat(clientX, clientY);
    if (alertMapDrawMode === 'circle') {
      alertMapCircleCenter = [ll.lng, ll.lat];
    } else if (alertMapDrawMode === 'freehand') {
      alertMapDrawPoints = [[ll.lng, ll.lat]];
    }
  }

  function handleDrawMove(clientX, clientY, e) {
    if (!alertMapDrawing || !overlayMouseDown) return;
    e.preventDefault();
    const ll = pxToLngLat(clientX, clientY);
    if (alertMapDrawMode === 'circle' && alertMapCircleCenter) {
      const radiusKm = haversineDistance(
        alertMapCircleCenter[1], alertMapCircleCenter[0],
        ll.lat, ll.lng,
      );
      const circleGeo = generateCirclePolygon(alertMapCircleCenter[0], alertMapCircleCenter[1], radiusKm);
      const features = alertMapPolygons.map(g => ({ type: 'Feature', geometry: g }));
      features.push({ type: 'Feature', geometry: circleGeo });
      alertMap.getSource('alert-polygon').setData({ type: 'FeatureCollection', features });
    } else if (alertMapDrawMode === 'freehand') {
      alertMapDrawPoints.push([ll.lng, ll.lat]);
      alertMap.getSource('draw-line').setData({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: alertMapDrawPoints },
      });
    }
  }

  function finishDraw(clientX, clientY) {
    if (!alertMapDrawing || !overlayMouseDown) return;
    overlayMouseDown = false;
    const ll = pxToLngLat(clientX, clientY);

    if (alertMapDrawMode === 'circle' && alertMapCircleCenter) {
      const radiusKm = haversineDistance(
        alertMapCircleCenter[1], alertMapCircleCenter[0],
        ll.lat, ll.lng,
      );
      if (radiusKm > 0.1) {
        const circleGeo = generateCirclePolygon(alertMapCircleCenter[0], alertMapCircleCenter[1], radiusKm);
        alertMapPolygons.push(circleGeo);
        renderAllPolygons();
        checkPropertyCount();
      }
      exitDrawMode();
    } else if (alertMapDrawMode === 'freehand' && alertMapDrawPoints.length >= 5) {
      const simplified = simplifyPoints(alertMapDrawPoints, 80);
      const ring = [...simplified, simplified[0]];
      alertMapPolygons.push({ type: 'Polygon', coordinates: [ring] });
      renderAllPolygons();
      alertMap.getSource('draw-line').setData({ type: 'FeatureCollection', features: [] });
      exitDrawMode();
      checkPropertyCount();
    } else {
      alertMap.getSource('draw-line').setData({ type: 'FeatureCollection', features: [] });
    }
  }

  // Mouse events
  drawOverlay.addEventListener('mousedown', (e) => handleDrawStart(e.clientX, e.clientY, e));
  drawOverlay.addEventListener('mousemove', (e) => handleDrawMove(e.clientX, e.clientY, e));
  drawOverlay.addEventListener('mouseup', (e) => finishDraw(e.clientX, e.clientY));
  document.addEventListener('mouseup', (e) => { if (overlayMouseDown) finishDraw(e.clientX, e.clientY); });

  // Touch events (mobile/tablet)
  drawOverlay.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    handleDrawStart(t.clientX, t.clientY, e);
  }, { passive: false });
  drawOverlay.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    handleDrawMove(t.clientX, t.clientY, e);
  }, { passive: false });
  drawOverlay.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    finishDraw(t.clientX, t.clientY);
  });

  // Button handlers — use .onclick (replaces) instead of addEventListener (stacks).
  // This is the KEY fix: addEventListener was adding a NEW handler every time a lead
  // was opened, so after 2+ leads the handlers would fight (enter → immediately exit).
  document.getElementById('alert-map-draw-circle').onclick = () => {
    if (alertMapDrawing) { exitDrawMode(); return; }
    enterDrawMode('circle');
  };

  document.getElementById('alert-map-draw-freehand').onclick = () => {
    if (alertMapDrawing) { exitDrawMode(); return; }
    enterDrawMode('freehand');
  };

  document.getElementById('alert-map-clear').onclick = () => {
    clearPolygon();
  };

  // Resize after panel animation
  setTimeout(() => { if (alertMap) alertMap.resize(); }, 350);
  setTimeout(() => { if (alertMap) alertMap.resize(); }, 700);
}

function enterDrawMode(mode) {
  alertMapDrawMode = mode;
  alertMapDrawing = true;
  alertMapDrawPoints = [];
  alertMapCircleCenter = null;
  // Clear draw preview line (but keep existing polygons)
  if (alertMap.getSource('draw-line')) {
    alertMap.getSource('draw-line').setData({ type: 'FeatureCollection', features: [] });
  }
  const hint = document.getElementById('alert-map-hint');
  hint.style.display = 'block';
  hint.textContent = mode === 'circle'
    ? 'Click and drag to draw a circle radius'
    : 'Click and drag to draw your area';
  // Highlight active button
  document.getElementById('alert-map-draw-circle').classList.toggle('active', mode === 'circle');
  document.getElementById('alert-map-draw-freehand').classList.toggle('active', mode === 'freehand');
  const panel = document.getElementById('lead-panel');
  if (panel) panel.style.overflow = 'hidden';
  // Hide property markers while drawing (CSS handles it)
  const mapContainer = document.getElementById('alert-map');
  if (mapContainer) mapContainer.classList.add('is-drawing');
  // Activate the draw overlay so it captures all mouse events
  const drawOverlay = document.getElementById('alert-map-draw-overlay');
  if (drawOverlay) drawOverlay.style.pointerEvents = 'auto';
  // Disable native pan/zoom so drag becomes a draw gesture
  if (alertMap) {
    alertMap.dragPan.disable();
    alertMap.boxZoom.disable();
    alertMap.doubleClickZoom.disable();
    alertMap.getCanvas().style.cursor = 'crosshair';
  }
}

function exitDrawMode() {
  alertMapDrawing = false;
  alertMapDrawMode = null;
  document.getElementById('alert-map-hint').style.display = 'none';
  document.getElementById('alert-map-draw-circle').classList.remove('active');
  document.getElementById('alert-map-draw-freehand').classList.remove('active');
  // Restore panel scroll
  const panel = document.getElementById('lead-panel');
  if (panel) panel.style.overflow = '';
  const mapContainer = document.getElementById('alert-map');
  if (mapContainer) mapContainer.classList.remove('is-drawing');
  // Disable the draw overlay so pan/zoom/markers work again
  const drawOverlay = document.getElementById('alert-map-draw-overlay');
  if (drawOverlay) drawOverlay.style.pointerEvents = 'none';
  if (alertMap) {
    alertMap.dragPan.enable();
    alertMap.boxZoom.enable();
    alertMap.doubleClickZoom.enable();
    alertMap.getCanvas().style.cursor = '';
  }
  // Clear draw preview layers
  if (alertMap.getSource('draw-points')) {
    alertMap.getSource('draw-points').setData({ type: 'FeatureCollection', features: [] });
  }
  if (alertMap.getSource('draw-line')) {
    alertMap.getSource('draw-line').setData({ type: 'FeatureCollection', features: [] });
  }
}

function clearPolygon() {
  alertMapPolygons = [];
  alertMapDrawing = false;
  alertMapDrawMode = null;
  alertMapDrawPoints = [];
  alertMapCircleCenter = null;
  if (alertMap) {
    if (alertMap.getSource('alert-polygon')) {
      alertMap.getSource('alert-polygon').setData({ type: 'FeatureCollection', features: [] });
    }
    if (alertMap.getSource('draw-points')) {
      alertMap.getSource('draw-points').setData({ type: 'FeatureCollection', features: [] });
    }
    if (alertMap.getSource('draw-line')) {
      alertMap.getSource('draw-line').setData({ type: 'FeatureCollection', features: [] });
    }
    alertMap.dragPan.enable();
    alertMap.boxZoom.enable();
    alertMap.doubleClickZoom.enable();
    alertMap.getCanvas().style.cursor = '';
  }
  document.getElementById('alert-map-hint').style.display = 'none';
  document.getElementById('alert-map-draw-circle').classList.remove('active');
  document.getElementById('alert-map-draw-freehand').classList.remove('active');
  const mapContainer = document.getElementById('alert-map');
  if (mapContainer) mapContainer.classList.remove('is-drawing');
  const drawOverlay = document.getElementById('alert-map-draw-overlay');
  if (drawOverlay) drawOverlay.style.pointerEvents = 'none';
  // Restore panel scroll
  const panel = document.getElementById('lead-panel');
  if (panel) panel.style.overflow = '';
  // Re-run count + markers without the polygon filter
  checkPropertyCount();
}

// ── Geometry helpers ──

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function generateCirclePolygon(centerLng, centerLat, radiusKm, numPoints = 64) {
  const coords = [];
  for (let i = 0; i <= numPoints; i++) {
    const angle = (i / numPoints) * 2 * Math.PI;
    const dLat = (radiusKm / 6371) * (180 / Math.PI);
    const dLng = dLat / Math.cos(centerLat * Math.PI / 180);
    coords.push([
      centerLng + dLng * Math.cos(angle),
      centerLat + dLat * Math.sin(angle),
    ]);
  }
  return { type: 'Polygon', coordinates: [coords] };
}

function simplifyPoints(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  // Evenly sample points
  const step = points.length / maxPoints;
  const result = [];
  for (let i = 0; i < maxPoints; i++) {
    result.push(points[Math.floor(i * step)]);
  }
  return result;
}

function renderAllPolygons() {
  if (!alertMap || !alertMap.getSource('alert-polygon')) return;
  if (alertMapPolygons.length === 0) {
    alertMap.getSource('alert-polygon').setData({ type: 'FeatureCollection', features: [] });
    return;
  }
  alertMap.getSource('alert-polygon').setData({
    type: 'FeatureCollection',
    features: alertMapPolygons.map(geo => ({ type: 'Feature', geometry: geo })),
  });
}

async function sendTestAlert() {
  if (!activeLead) return;
  const btn = document.getElementById('panel-alert-send-now');
  const statusEl = document.getElementById('panel-alert-status');
  btn.disabled = true;
  statusEl.style.display = 'none';

  // Step 1: Save alert preferences first
  btn.textContent = 'Saving prefs…';
  const alertPrefs = getAlertPrefsFromPanel();
  try {
    const prefsRes = await fetch(`${CRM_API_BASE}/api/update-preferences`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: activeLead.id, password: currentPassword, ...alertPrefs }),
    });
    const prefsData = await prefsRes.json();
    if (!prefsData.success) {
      statusEl.style.display = 'block';
      statusEl.style.color = '#dc2626';
      statusEl.textContent = (prefsData.error || 'Failed to save preferences');
      btn.disabled = false;
      btn.textContent = 'Send Test Alert';
      return;
    }
  } catch (err) {
    statusEl.style.display = 'block';
    statusEl.style.color = '#dc2626';
    statusEl.textContent = 'Network error saving preferences';
    btn.disabled = false;
    btn.textContent = 'Send Test Alert';
    return;
  }

  // Step 2: Send the test alert
  btn.textContent = 'Sending…';
  try {
    const res = await fetch(`${CRM_API_BASE}/api/send-test-alert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: activeLead.id, password: currentPassword }),
    });
    const data = await res.json();
    statusEl.style.display = 'block';
    // Per-channel result (Kevin 2026-07-16): show exactly what went where.
    const describeChannels = (ch) => {
      const parts = [];
      if (ch && ch.email) {
        if (ch.email.status === 'sent') parts.push(`✉️ Email → ${ch.email.to || activeLead.email}`);
        else if (ch.email.status === 'skipped') parts.push(`✉️ Email skipped (${ch.email.reason})`);
        else parts.push(`✉️ Email failed`);
      }
      if (ch && ch.whatsapp) {
        if (ch.whatsapp.status === 'sent') parts.push(`💬 WhatsApp → ${activeLead.phone || 'lead'}`);
        else if (ch.whatsapp.status === 'skipped') parts.push(`💬 WhatsApp skipped (${ch.whatsapp.reason})`);
        else {
          const r = String(ch.whatsapp.reason || '');
          parts.push(/63049/.test(r)
            ? '💬 WhatsApp not delivered — Meta blocks WhatsApp alerts to US (+1) numbers; keep US leads on Email'
            : `💬 WhatsApp failed`);
        }
      }
      return parts;
    };
    if (data.success) {
      const parts = describeChannels(data.channels);
      const anyErr = data.channels && ((data.channels.email && data.channels.email.status === 'error') || (data.channels.whatsapp && data.channels.whatsapp.status === 'error'));
      statusEl.style.color = anyErr ? '#d97706' : '#16a34a';
      statusEl.textContent = parts.length ? parts.join('  ·  ') : `Test alert sent (${data.propertiesSent || 0} properties)`;
    } else {
      statusEl.style.color = '#dc2626';
      const parts = describeChannels(data.channels);
      statusEl.textContent = (data.error || 'Failed to send') + (parts.length ? ` — ${parts.join('  ·  ')}` : '');
    }
  } catch (err) {
    statusEl.style.display = 'block';
    statusEl.style.color = '#dc2626';
    statusEl.textContent = 'Network error';
  }

  btn.disabled = false;
  btn.textContent = 'Send Test Alert';
}

async function copyPreferencesLink() {
  if (!activeLead) return;
  const btn = document.getElementById('panel-alert-copy-link');
  const statusEl = document.getElementById('panel-alert-status');

  let token = activeLead.alertToken;
  if (!token) {
    // Generate a new token
    btn.disabled = true;
    btn.textContent = 'Generating…';
    try {
      const res = await fetch(`${CRM_API_BASE}/api/generate-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeLead.id, password: currentPassword }),
      });
      const data = await res.json();
      if (data.success) {
        token = data.token;
        activeLead.alertToken = token;
        const lead = allLeads.find(l => String(l.id) === String(activeLead.id));
        if (lead) lead.alertToken = token;
      }
    } catch (err) {
      statusEl.style.display = 'block';
      statusEl.style.color = '#dc2626';
      statusEl.textContent = 'Failed to generate link';
      btn.disabled = false;
      btn.textContent = 'Copy Link';
      return;
    }
  }

  if (token) {
    const url = `https://www.homesinsoflorida.com/preferences.html?token=${token}`;
    await navigator.clipboard.writeText(url);
    statusEl.style.display = 'block';
    statusEl.style.color = '#16a34a';
    statusEl.textContent = 'Link copied to clipboard!';
    setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
  }

  btn.disabled = false;
  btn.textContent = 'Copy Link';
}

// ── EXPORT CSV ─────────────────────────────────────────────────────────────
function exportCSV() {
  const headers = [
    'Name', 'First Name', 'Last Name', 'Email', 'Phone',
    'Country', 'Buy Timeline', 'Assigned To', 'Status', 'Listing Address', 'Listing Price',
    'Source URL', 'Notes', 'Registered', 'Last Login', 'Properties Viewed', 'Time on Site'
  ];

  const rows = allLeads.filter(l => !isBuyerLead(l)).map(l => [
    l.name,
    l.firstName,
    l.lastName,
    l.email,
    l.phone,
    l.country,
    l.timeline,
    l.assignedTo,
    l.status,
    l.listingAddress,
    l.listingPrice ? '$' + l.listingPrice : '',
    l.sourceUrl,
    l.notes,
    l.createdAt,
    l.lastLogin,
    l.totalPropertiesViewed || 0,
    formatDurationSeconds(l.totalTimeSpent || 0),
  ].map(v => `"${(v || '').toString().replace(/"/g, '""')}"`));

  const csv  = [headers.map(h => `"${h}"`), ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `poler-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── HELPERS ────────────────────────────────────────────────────────────────

/** Return 1-2 uppercase initials from a full name */
function getInitials(name) {
  if (!name) return '?';
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

/** Human-readable duration from a number of seconds, e.g. "2h 14m" */
function formatDurationSeconds(secs) {
  secs = Math.floor(Number(secs) || 0);
  if (secs <= 0) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h >= 1) return `${h}h ${m}m`;
  if (m >= 1) return `${m}m`;
  return `${secs}s`;
}

/** Human-readable relative time string */
function relativeTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return new Date(iso).toLocaleDateString();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    return months === 1 ? '1mo ago' : `${months}mo ago`;
  }
  return new Date(iso).toLocaleDateString();
}

/** Escape HTML special characters to prevent XSS */
function escHtml(str) {
  return (str || '')
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── LOAD AI CONVERSATIONS ─────────────────────────────────────────────────
async function loadConversations(email) {
  const wrap = document.getElementById('panel-conversations');
  if (!wrap) return;
  wrap.innerHTML = '<p class="panel-empty-text">Loading conversations...</p>';

  try {
    const pw = currentPassword;
    const res = await fetch(`/api/get-conversations?password=${encodeURIComponent(pw)}&email=${encodeURIComponent(email)}`);
    if (!res.ok) { wrap.innerHTML = '<p class="panel-empty-text">Could not load conversations</p>'; return; }
    const data = await res.json();
    const convos = data.conversations || [];

    if (!convos.length) {
      wrap.innerHTML = '<p class="panel-empty-text">No AI conversations yet</p>';
      return;
    }

    wrap.innerHTML = convos.map(c => {
      const msgs = c.messages || [];
      const time = c.lastUpdated ? relativeTime(c.lastUpdated) : '';
      const msgCount = msgs.filter(m => m.role === 'user').length;
      const bubbles = msgs.slice(-6).map(m => {
        const cls = m.role === 'user' ? 'convo-bubble-user' : 'convo-bubble-ai';
        // Escape first, then linkify (Kevin 2026-07-14: property links showed as
        // plain black text). Truncation happens before linkify so a cut URL
        // never leaves a dangling <a> tag.
        const txt = escHtml(m.content).slice(0, 200);
        const linked = txt.replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener" style="color:#2563eb;word-break:break-all;">${u}</a>`);
        return `<div class="convo-bubble ${cls}">${linked}${m.content.length > 200 ? '…' : ''}</div>`;
      }).join('');
      return `
        <div class="convo-card">
          <div class="convo-header">
            <span class="convo-time">${escHtml(time)}</span>
            <span class="convo-count">${msgCount} message${msgCount !== 1 ? 's' : ''}</span>
          </div>
          <div class="convo-bubbles">${bubbles}</div>
        </div>`;
    }).join('');
  } catch (err) {
    console.error('Load conversations error:', err);
    wrap.innerHTML = '<p class="panel-empty-text">Error loading conversations</p>';
  }
}

// ── RENDER SAVED / FAVORITED PROPERTIES ──────────────────────────────────
function renderSavedProperties(lead) {
  const wrap = document.getElementById('panel-saved-properties');
  const countEl = document.getElementById('panel-saved-count');
  if (!wrap) return;

  let saved = [];
  try {
    const raw = lead.savedProperties || '[]';
    saved = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(saved)) saved = [];
  } catch { saved = []; }

  if (countEl) countEl.textContent = saved.length;

  if (saved.length === 0) {
    wrap.innerHTML = '<p class="panel-empty-text">No saved properties yet</p>';
    return;
  }

  wrap.innerHTML = saved.map(mlsId => {
    return `<div class="viewed-property-item" style="cursor:pointer;" data-source="?id=${escHtml(mlsId)}" onclick="openPropertyModal('', this.dataset.source)">
      <div class="viewed-property-info">
        <span style="color:#ef4444;margin-right:6px;">❤️</span>
        <span class="viewed-property-address">MLS# ${escHtml(mlsId)}</span>
      </div>
      <span class="viewed-property-time" style="color:#3b82f6;font-size:0.75rem;">View Details →</span>
    </div>`;
  }).join('');
}

// ── RENDER PROPERTIES VIEWED ──────────────────────────────────────────────
function renderPropertiesViewed(lead) {
  const wrap = document.getElementById('panel-properties-viewed');
  const countEl = document.getElementById('panel-properties-count');
  if (!wrap) return;

  let viewed = [];
  try {
    const raw = lead.propertiesViewed || '[]';
    viewed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(viewed)) viewed = [];
  } catch { viewed = []; }

  const total = lead.totalPropertiesViewed || viewed.length;
  if (countEl) countEl.textContent = total;

  if (viewed.length === 0) {
    wrap.innerHTML = '<p class="panel-empty-text">No properties viewed yet</p>';
    return;
  }

  wrap.innerHTML = viewed.slice(0, 20).map(v => {
    const price = v.price ? '$' + Number(v.price).toLocaleString() : '';
    const time = v.viewedAt ? relativeTime(v.viewedAt) : '';
    const addr = v.address || v.mlsId || 'Unknown';
    const mlsParam = v.mlsId ? `?id=${escHtml(v.mlsId)}` : '';
    // data-* + dataset read: address/mlsId come from the public log-activity
    // endpoint, so never re-parse them as JS inside an inline handler.
    return `<div class="viewed-property-item" style="cursor:pointer;" data-address="${escHtml(addr)}" data-source="${mlsParam}" onclick="openPropertyModal(this.dataset.address, this.dataset.source)">
      <div class="viewed-property-info">
        <span class="viewed-property-address">${escHtml(addr)}</span>
        ${price ? `<span class="viewed-property-price">${escHtml(price)}</span>` : ''}
      </div>
      <span class="viewed-property-time">${escHtml(time)}</span>
    </div>`;
  }).join('');
}

// ── LOAD LEAD ACTIVITY ────────────────────────────────────────────────────
async function loadActivity(email) {
  const wrap = document.getElementById('panel-activity');
  if (!wrap) return;
  wrap.innerHTML = '<p class="panel-empty-text">Loading activity...</p>';

  try {
    const pw = currentPassword;
    const res = await fetch(`/api/get-activity?password=${encodeURIComponent(pw)}&email=${encodeURIComponent(email)}`);
    if (!res.ok) { wrap.innerHTML = '<p class="panel-empty-text">Could not load activity</p>'; return; }
    const data = await res.json();
    const activities = data.activities || [];

    if (!activities.length) {
      wrap.innerHTML = '<p class="panel-empty-text">No activity logged yet</p>';
      return;
    }

    wrap.innerHTML = activities.map(a => {
      const time = a.timestamp ? relativeTime(a.timestamp) : '';
      const icon = a.activityType === 'Search' ? '🔍' : '📄';
      let detail = '';
      if (a.activityType === 'Search' && a.details) {
        try {
          const d = typeof a.details === 'string' ? JSON.parse(a.details) : a.details;
          const parts = [];
          if (d.params?.City) parts.push(d.params.City);
          if (d.params?.['ListPrice.gte']) parts.push('$' + Number(d.params['ListPrice.gte']).toLocaleString() + '+');
          if (d.resultCount != null) parts.push(d.resultCount + ' results');
          detail = parts.join(' · ');
        } catch { detail = ''; }
      }
      return `
        <div class="activity-item">
          <span class="activity-icon">${icon}</span>
          <div class="activity-info">
            <span class="activity-type">${escHtml(a.activityType)}</span>
            ${detail ? `<span class="activity-detail">${escHtml(detail)}</span>` : ''}
          </div>
          <span class="activity-time">${escHtml(time)}</span>
        </div>`;
    }).join('');
  } catch (err) {
    console.error('Load activity error:', err);
    wrap.innerHTML = '<p class="panel-empty-text">Error loading activity</p>';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PROPERTY DETAIL MODAL — fetch from Bridge MLS API and display
// ═══════════════════════════════════════════════════════════════════════════

function openPropertyModal(address, sourceUrl) {
  const modal = document.getElementById('property-modal');
  const body  = document.getElementById('property-modal-body');
  modal.classList.add('open');
  body.innerHTML = '<div class="property-modal-loading">Loading property details...</div>';
  document.body.style.overflow = 'hidden';

  // Extract MLS ID from source URL if available
  let mlsId = '';
  if (sourceUrl) {
    const match = sourceUrl.match(/[?&](?:id|mls)=([^&]+)/);
    if (match) mlsId = match[1];
  }

  // Search by MLS ID first, then by address
  const searchPromise = mlsId
    ? fetchBridgeListing({ ListingId: mlsId })
    : fetchBridgeByAddress(address);

  searchPromise.then(listing => {
    if (!listing) {
      body.innerHTML = `<div class="pm-error">Property not found in MLS.<br><small>${escHtml(address)}</small></div>`;
      return;
    }
    renderPropertyModal(body, listing);
  }).catch(err => {
    console.error('Property modal error:', err);
    body.innerHTML = `<div class="pm-error">Error loading property details</div>`;
  });
}

function closePropertyModal() {
  document.getElementById('property-modal').classList.remove('open');
  document.body.style.overflow = '';
}

async function fetchBridgeListing(params) {
  const qs = new URLSearchParams({ ...params, limit: 1 }).toString();
  const res = await fetch(`${BRIDGE_BASE}/listings?${qs}`);
  const data = await res.json();
  return data.success && data.bundle && data.bundle[0] ? data.bundle[0] : null;
}

async function fetchBridgeByAddress(address) {
  if (!address) return null;
  // Try to parse address components for Bridge API search
  const parts = address.match(/^(\d+)\s+(.+?)(?:,\s*(.+?))?(?:\s+FL\s+\d{5})?$/i);
  if (parts) {
    const listing = await fetchBridgeListing({ StreetNumber: parts[1], StreetName: parts[2].replace(/[,#].*/,'').trim(), limit: 1 });
    if (listing) return listing;
  }
  // Fallback: search by unparsed address
  return fetchBridgeListing({ UnparsedAddress: address.split(',')[0].trim(), limit: 1 });
}

function renderPropertyModal(container, l) {
  const photos = (l.Media || []).sort((a,b) => (a.Order||0)-(b.Order||0)).map(m => m.MediaURL).filter(Boolean);
  const price = l.ListPrice ? '$' + Number(l.ListPrice).toLocaleString() : 'Price N/A';
  const addr = l.UnparsedAddress || '';
  const cityStateZip = [l.City, 'FL', l.PostalCode].filter(Boolean).join(' ');
  const beds = l.BedroomsTotal || '—';
  const baths = l.BathroomsTotalInteger || '—';
  const sqft = l.LivingArea ? Number(l.LivingArea).toLocaleString() : '—';
  const yearBuilt = l.YearBuilt || '—';
  const pricePerSqft = (l.ListPrice && l.LivingArea) ? '$' + Math.round(l.ListPrice / l.LivingArea).toLocaleString() : '—';
  const status = l.StandardStatus || '—';
  const mlsNum = l.ListingId || '—';
  const propType = l.PropertySubType || l.PropertyType || '—';
  const hoa = l.AssociationFee ? '$' + Number(l.AssociationFee).toLocaleString() + '/mo' : '—';
  const lot = l.LotSizeSquareFeet ? Number(l.LotSizeSquareFeet).toLocaleString() + ' sqft' : '—';
  const garage = l.GarageSpaces ? l.GarageSpaces + ' Cars' : '—';
  const pool = (l.PoolFeatures && l.PoolFeatures.length) ? 'Yes' : '—';
  const waterfront = l.WaterfrontYN === true ? 'Yes' : '—';
  const county = l.CountyOrParish || '—';
  const dom = l.DaysOnMarket || '—';
  const desc = l.PublicRemarks || '';

  // Photo gallery — show all photos in scrollable grid
  const galleryHtml = photos.length
    ? `<div class="pm-gallery">${photos.map(url => `<img src="${url}" alt="Property photo" loading="lazy">`).join('')}</div>`
    : '';

  container.innerHTML = `
    ${galleryHtml}
    <div class="pm-header">
      <div class="pm-price">${price}</div>
      <div class="pm-address">${escHtml(addr)}${cityStateZip ? ', ' + escHtml(cityStateZip) : ''}</div>
    </div>
    <div class="pm-stats">
      <div class="pm-stat"><div class="pm-stat-val">${beds}</div><div class="pm-stat-label">Beds</div></div>
      <div class="pm-stat"><div class="pm-stat-val">${baths}</div><div class="pm-stat-label">Baths</div></div>
      <div class="pm-stat"><div class="pm-stat-val">${sqft}</div><div class="pm-stat-label">Sq Ft</div></div>
      <div class="pm-stat"><div class="pm-stat-val">${pricePerSqft}</div><div class="pm-stat-label">$/Sq Ft</div></div>
      <div class="pm-stat"><div class="pm-stat-val">${dom}</div><div class="pm-stat-label">Days on Market</div></div>
    </div>
    <div class="pm-details">
      <div class="pm-detail"><span class="pm-detail-label">Status</span><span class="pm-detail-value">${escHtml(status)}</span></div>
      <div class="pm-detail"><span class="pm-detail-label">MLS #</span><span class="pm-detail-value">${escHtml(mlsNum)}</span></div>
      <div class="pm-detail"><span class="pm-detail-label">Type</span><span class="pm-detail-value">${escHtml(propType)}</span></div>
      <div class="pm-detail"><span class="pm-detail-label">Year Built</span><span class="pm-detail-value">${yearBuilt}</span></div>
      <div class="pm-detail"><span class="pm-detail-label">HOA</span><span class="pm-detail-value">${hoa}</span></div>
      <div class="pm-detail"><span class="pm-detail-label">Lot Size</span><span class="pm-detail-value">${lot}</span></div>
      <div class="pm-detail"><span class="pm-detail-label">Garage</span><span class="pm-detail-value">${garage}</span></div>
      <div class="pm-detail"><span class="pm-detail-label">Pool</span><span class="pm-detail-value">${pool}</span></div>
      <div class="pm-detail"><span class="pm-detail-label">Waterfront</span><span class="pm-detail-value">${waterfront}</span></div>
      <div class="pm-detail"><span class="pm-detail-label">County</span><span class="pm-detail-value">${escHtml(county)}</span></div>
    </div>
    ${desc ? `<div class="pm-desc"><h3>Description</h3><p>${escHtml(desc).substring(0, 500)}${desc.length > 500 ? '...' : ''}</p></div>` : ''}
    ${mlsNum !== '—' ? `<a class="pm-link" href="https://homesinsoflorida.com/listing?id=${encodeURIComponent(mlsNum)}" target="_blank">View Full Listing on HomesInSoFlorida.com &rarr;</a>` : ''}
  `;
}

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closePropertyModal();
});

// ═══════════════════════════════════════════════════════════════════════════
// CONSULTING CLIENTS MODULE
// ═══════════════════════════════════════════════════════════════════════════

// ── LOAD CLIENTS ───────────────────────────────────────────────────────────
async function loadClients() {
  if (!currentPassword) return;
  const loading = document.getElementById('clients-loading');
  const empty   = document.getElementById('clients-empty');
  const table   = document.getElementById('clients-table');
  if (loading) loading.style.display = 'block';
  if (table)   table.style.display = 'none';
  if (empty)   empty.style.display = 'none';

  try {
    const res = await fetch(`${CRM_API_BASE}/api/get-consulting-clients?password=${encodeURIComponent(currentPassword)}`);
    if (res.ok) {
      const data = await res.json();
      allClients = data.clients || [];
    } else {
      console.error('Failed to load consulting clients:', res.status);
    }
  } catch (err) {
    console.error('Failed to load consulting clients:', err);
  }

  if (loading) loading.style.display = 'none';
  if (currentView === 'clients') renderClients();
  updateClientStats();
}

function updateClientStats() {
  const total     = allClients.length;
  const active    = allClients.filter(c => c.status === 'Active').length;
  const onhold    = allClients.filter(c => c.status === 'On Hold').length;
  const completed = allClients.filter(c => c.status === 'Completed').length;
  const els = {
    total:     document.getElementById('client-stat-total'),
    active:    document.getElementById('client-stat-active'),
    onhold:    document.getElementById('client-stat-onhold'),
    completed: document.getElementById('client-stat-completed'),
  };
  if (els.total)     els.total.textContent     = total;
  if (els.active)    els.active.textContent    = active;
  if (els.onhold)    els.onhold.textContent    = onhold;
  if (els.completed) els.completed.textContent = completed;
}

// ── RENDER CLIENTS ─────────────────────────────────────────────────────────
function renderClients() {
  const tbody = document.getElementById('clients-tbody');
  const table = document.getElementById('clients-table');
  const empty = document.getElementById('clients-empty');
  if (!tbody) return;

  const search = (document.getElementById('client-search')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('client-status-filter')?.value || '';

  filteredClients = allClients.filter(c => {
    if (statusFilter && c.status !== statusFilter) return false;
    if (search) {
      const hay = [c.company, c.primaryContact, c.email, c.owner].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  // Update count label
  const label = document.getElementById('clients-count-label');
  if (label) {
    label.textContent = `${filteredClients.length} ${filteredClients.length === 1 ? 'client' : 'clients'}`;
    label.style.display = 'inline-block';
  }

  updateClientStats();

  if (filteredClients.length === 0) {
    if (table) table.style.display = 'none';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (table) table.style.display = 'table';
  if (empty) empty.style.display = 'none';

  tbody.innerHTML = filteredClients.map(c => {
    const services = (c.serviceType || []).map(s =>
      `<span class="client-service-tag">${escHtml(s)}</span>`
    ).join('');
    // Compute Open Deals + Pipeline $ from allDeals (loaded separately)
    const openDeals = (allDeals || []).filter(d =>
      d.companyId === c.id && d.stage !== 'Won' && d.stage !== 'Lost'
    );
    const dealCount = openDeals.length;
    const pipelineSum = openDeals.reduce((acc, d) => acc + (Number(d.dealValue) || 0), 0);
    const pipelineDisplay = pipelineSum
      ? '$' + pipelineSum.toLocaleString('en-US', { maximumFractionDigits: 0 })
      : '—';
    const status = c.status || 'Lead';
    const statusKey = status.toLowerCase().replace(/\s+/g, '-');
    // Find Primary Contact from new Contacts table; fall back to legacy field
    const primaryContact = (allConsultingContacts || []).find(
      ct => ct.companyId === c.id && ct.primary
    );
    const primaryName = primaryContact ? primaryContact.name : (c.primaryContact || '—');
    return `
      <tr data-client-id="${escHtml(c.id)}" style="cursor:pointer;">
        <td><strong>${escHtml(c.company || '—')}</strong></td>
        <td><span class="client-status-pill status-${statusKey}">${escHtml(status)}</span></td>
        <td>${escHtml(c.country || '—')}</td>
        <td>${escHtml(c.owner || '—')}</td>
        <td>${dealCount}</td>
        <td>${pipelineDisplay}</td>
        <td>${escHtml(primaryName)}</td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('tr[data-client-id]').forEach(tr => {
    tr.addEventListener('click', () => openClientPanel(tr.dataset.clientId));
  });
}

// ── PANEL: OPEN / CLOSE ────────────────────────────────────────────────────
function openClientPanel(id) {
  const client = allClients.find(c => c.id === id);
  if (!client) return;
  currentClient = client;

  // Populate header
  const avatar = document.getElementById('client-avatar-text');
  if (avatar) avatar.textContent = (client.company || '?').charAt(0).toUpperCase();
  document.getElementById('client-panel-name').textContent = client.company || '—';
  const statusBadge = document.getElementById('client-panel-status-badge');
  if (statusBadge) {
    statusBadge.textContent = client.status || 'New';
  }

  // Populate fields
  setVal('client-company',         client.company || '');
  setVal('client-primary-contact', client.primaryContact || '');
  setVal('client-email',           client.email || '');
  setVal('client-phone',           client.phone || '');
  setVal('client-country',         client.country || '');
  setVal('client-project-value',   client.projectValue || '');
  setVal('client-started-at',      client.startedAt ? client.startedAt.slice(0, 10) : '');
  setVal('client-last-contact',    client.lastContact ? client.lastContact.slice(0, 10) : '');
  setVal('client-status',          client.status || 'Lead');
  setVal('client-owner',           client.owner || '');
  setVal('client-website',         client.website || '');
  setVal('client-source',          client.source || '');
  setVal('client-notes',           client.notes || '');

  // Promote-to-Client button visibility
  const promoteBtn = document.getElementById('client-promote-btn');
  if (promoteBtn) {
    promoteBtn.style.display = (client.status === 'Lead') ? 'inline-block' : 'none';
  }

  // Service Type checkboxes
  const services = client.serviceType || [];
  document.querySelectorAll('#client-service-type input[type="checkbox"]').forEach(cb => {
    cb.checked = services.includes(cb.value);
  });

  // Quick action links
  const phone = (client.phone || '').replace(/[^+\d]/g, '');
  const email = client.email || '';
  document.getElementById('client-call').href         = phone ? `tel:${phone}` : '#';
  document.getElementById('client-email-action').href = email ? `mailto:${email}` : '#';
  document.getElementById('client-whatsapp').href     = phone ? `https://wa.me/${phone.replace(/\D/g, '')}` : '#';

  // Documents
  ['Contracts', 'Deliverables', 'Spreadsheets', 'Misc'].forEach(field => {
    renderDocList(field, getClientDocs(client, field));
  });

  // Notes — render as separate cards from Consulting Activity (Type=Note + Type=Email Logged)
  loadClientNotes(client.id).catch(err => console.error('loadClientNotes:', err));

  // Hide the Add Note form on each open (reset state)
  const noteForm = document.getElementById('client-new-note-form');
  if (noteForm) noteForm.style.display = 'none';
  const noteInput = document.getElementById('client-new-note-text');
  if (noteInput) noteInput.value = '';

  // Open the panel + overlay
  document.getElementById('client-panel').classList.add('open');
  const overlay = document.getElementById('panel-overlay');
  if (overlay) overlay.style.display = 'block';
}

// ── COMPANY NOTES (as separate cards from Consulting Activity) ─────────────
async function loadClientNotes(companyId) {
  const container = document.getElementById('client-notes-list');
  if (!container) return;
  container.innerHTML = '<p class="panel-empty-text">Loading notes…</p>';

  const items = await loadActivityFor({ companyId });
  // Show Note + Email Logged (auto-generated email summaries) as notes
  const notes = items.filter(a => a.type === 'Note' || a.type === 'Email Logged');
  if (notes.length === 0) {
    container.innerHTML = '<p class="panel-empty-text">No notes yet. Click + Add Note to create one.</p>';
    return;
  }
  container.innerHTML = notes.map((n, i) => {
    const date = n.createdAt ? new Date(n.createdAt) : null;
    const dateStr = date ? date.toLocaleString('en-US', {
      month: 'numeric', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    }) : '';
    const typeIcon = n.type === 'Email Logged' ? '✉️' : '📝';
    return `<div class="note-card" data-activity-id="${escHtml(n.id)}">
      <div class="note-header">
        <span class="note-author">${typeIcon} ${escHtml(n.agent || '')}</span>
        <span class="note-date">${escHtml(dateStr)}</span>
      </div>
      <div class="note-body" style="white-space: pre-wrap;">${escHtml(n.details || n.title || '')}</div>
      <div class="note-actions">
        <button class="note-delete-btn" onclick="deleteClientNote('${escHtml(n.id)}')">Delete</button>
      </div>
    </div>`;
  }).join('');
}

async function saveNewClientNote() {
  if (!currentClient) return;
  const input = document.getElementById('client-new-note-text');
  const status = document.getElementById('client-new-note-status');
  if (!input) return;
  const text = input.value.trim();
  if (!text) { status.textContent = 'Type something first.'; return; }
  status.textContent = 'Saving…';
  try {
    await logActivity({
      companyId: currentClient.id,
      type: 'Note',
      title: text.length > 80 ? text.slice(0, 80) + '…' : text,
      details: text,
    });
    input.value = '';
    document.getElementById('client-new-note-form').style.display = 'none';
    status.textContent = '';
    await loadClientNotes(currentClient.id);
  } catch (err) {
    status.textContent = 'Save failed: ' + err.message;
  }
}

async function deleteClientNote(activityId) {
  if (!currentClient || !activityId) return;
  if (!confirm('Delete this note?')) return;
  try {
    const res = await fetch(`${CRM_API_BASE}/api/delete-consulting-activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: activityId, password: currentPassword }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert('Delete failed: ' + (err.error || res.status));
      return;
    }
    await loadClientNotes(currentClient.id);
  } catch (err) {
    alert('Delete error: ' + err.message);
  }
}

function closeClientPanel() {
  document.getElementById('client-panel')?.classList.remove('open');
  const overlay = document.getElementById('panel-overlay');
  if (overlay) overlay.style.display = 'none';
  currentClient = null;
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function getClientDocs(client, field) {
  const map = {
    Contracts:    'contracts',
    Deliverables: 'deliverables',
    Spreadsheets: 'spreadsheets',
    Misc:         'misc',
  };
  return client[map[field]] || [];
}

function setClientDocs(client, field, attachments) {
  const map = {
    Contracts:    'contracts',
    Deliverables: 'deliverables',
    Spreadsheets: 'spreadsheets',
    Misc:         'misc',
  };
  client[map[field]] = attachments || [];
}

// ── DOCUMENT RENDER ────────────────────────────────────────────────────────
// target: 'company' (default) → renders to #doc-list-X / #doc-count-X
// target: 'deal'              → renders to #deal-doc-list-X / #deal-doc-count-X
function renderDocList(field, attachments, target = 'company') {
  const prefix = target === 'deal' ? 'deal-doc' : 'doc';
  const list = document.getElementById(`${prefix}-list-${field}`);
  const count = document.getElementById(`${prefix}-count-${field}`);
  if (count) count.textContent = attachments.length;
  if (!list) return;
  if (attachments.length === 0) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML = attachments.map(a => {
    const size = a.size ? formatFileSize(a.size) : '';
    const url  = a.url || '#';
    return `
      <div class="doc-item" data-attachment-id="${escHtml(a.id)}">
        <span class="doc-item-icon">${docIcon(a.filename || '')}</span>
        <div class="doc-item-info">
          <div class="doc-item-name" title="${escHtml(a.filename || '')}">${escHtml(a.filename || '')}</div>
          <div class="doc-item-size">${size}</div>
        </div>
        <div class="doc-item-actions">
          <a class="doc-item-btn" href="${escHtml(url)}" target="_blank" rel="noopener">Open</a>
          <button class="doc-item-btn delete" data-field="${field}" data-attachment-id="${escHtml(a.id)}" data-target="${target}">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.doc-item-btn.delete').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      const f  = btn.dataset.field;
      const id = btn.dataset.attachmentId;
      const t  = btn.dataset.target || 'company';
      deleteDoc(f, id, t);
    });
  });
}

function docIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  if (['pdf'].includes(ext)) return '📄';
  if (['doc', 'docx'].includes(ext)) return '📝';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
  if (['ppt', 'pptx', 'key'].includes(ext)) return '📽';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'].includes(ext)) return '🖼';
  if (['zip', 'rar', '7z'].includes(ext)) return '🗜';
  return '📎';
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ── DOCUMENT UPLOAD ────────────────────────────────────────────────────────
async function uploadDocs(field, files, target = 'company') {
  const targetRecord = target === 'deal' ? currentDeal : currentClient;
  if (!targetRecord) return;

  const dropzone = document.querySelector(
    `.doc-dropzone[data-field="${field}"][data-target="${target}"]`
  ) || document.querySelector(`.doc-dropzone[data-field="${field}"]`);
  if (dropzone) dropzone.classList.add('uploading');

  for (const file of files) {
    try {
      const base64 = await fileToBase64(file);
      const res = await fetch(`${CRM_API_BASE}/api/upload-consulting-doc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: targetRecord.id,
          password: currentPassword,
          field,
          targetType: target,
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          base64,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error('Upload failed:', data);
        alert(`Upload failed: ${data.error || res.status}`);
        continue;
      }
      // Update local state for this record
      if (target === 'deal') {
        setDealDocs(targetRecord, field, data.attachments || []);
        const cached = allDeals.find(d => d.id === targetRecord.id);
        if (cached) setDealDocs(cached, field, data.attachments || []);
      } else {
        setClientDocs(targetRecord, field, data.attachments || []);
        const cached = allClients.find(c => c.id === targetRecord.id);
        if (cached) setClientDocs(cached, field, data.attachments || []);
      }
      renderDocList(field, data.attachments || [], target);
      // Auto-log activity
      const companyId = target === 'deal' ? targetRecord.companyId : targetRecord.id;
      const dealId    = target === 'deal' ? targetRecord.id : '';
      logActivity({
        companyId, dealId, type: 'Doc Upload',
        title: `Uploaded ${file.name} to ${field}`,
      });
    } catch (err) {
      console.error('Upload error:', err);
      alert(`Upload error: ${err.message}`);
    }
  }

  if (dropzone) dropzone.classList.remove('uploading');
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      // result is "data:<mime>;base64,<DATA>" — strip the prefix
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function deleteDoc(field, attachmentId, target = 'company') {
  const targetRecord = target === 'deal' ? currentDeal : currentClient;
  if (!targetRecord) return;
  if (!confirm('Delete this file? This cannot be undone.')) return;
  try {
    const res = await fetch(`${CRM_API_BASE}/api/delete-consulting-doc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: targetRecord.id,
        password: currentPassword,
        field,
        attachmentId,
        targetType: target,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(`Delete failed: ${data.error || res.status}`);
      return;
    }
    if (target === 'deal') {
      setDealDocs(targetRecord, field, data.attachments || []);
      const cached = allDeals.find(d => d.id === targetRecord.id);
      if (cached) setDealDocs(cached, field, data.attachments || []);
    } else {
      setClientDocs(targetRecord, field, data.attachments || []);
      const cached = allClients.find(c => c.id === targetRecord.id);
      if (cached) setClientDocs(cached, field, data.attachments || []);
    }
    renderDocList(field, data.attachments || [], target);
  } catch (err) {
    console.error('Delete error:', err);
    alert(`Delete error: ${err.message}`);
  }
}

// ── SAVE CLIENT (debounced) ────────────────────────────────────────────────
function scheduleSaveClient() {
  if (clientSaveTimer) clearTimeout(clientSaveTimer);
  const status = document.getElementById('client-save-status');
  if (status) { status.textContent = 'Saving…'; status.style.color = '#6b7280'; }
  clientSaveTimer = setTimeout(saveClientNow, 600);
}

async function saveClientNow() {
  if (!currentClient) return;
  const id = currentClient.id;

  const services = Array.from(
    document.querySelectorAll('#client-service-type input[type="checkbox"]:checked')
  ).map(cb => cb.value);

  const fields = {
    company:        document.getElementById('client-company').value.trim(),
    primaryContact: document.getElementById('client-primary-contact').value.trim(),
    email:          document.getElementById('client-email').value.trim(),
    phone:          document.getElementById('client-phone').value.trim(),
    country:        document.getElementById('client-country').value,
    serviceType:    services,
    status:         document.getElementById('client-status').value,
    owner:          document.getElementById('client-owner').value,
    website:        document.getElementById('client-website').value,
    source:         document.getElementById('client-source').value,
    notes:          document.getElementById('client-notes').value,
  };

  const status = document.getElementById('client-save-status');
  try {
    const res = await fetch(`${CRM_API_BASE}/api/update-consulting-client`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, password: currentPassword, ...fields }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (status) { status.textContent = `Save failed: ${err.error || res.status}`; status.style.color = '#b91c1c'; }
      return;
    }
    // Update local cache so list stays in sync (per CLAUDE.md hard rule)
    Object.assign(currentClient, fields);
    const cached = allClients.find(c => c.id === id);
    if (cached) Object.assign(cached, fields);

    // Refresh header/badge + table row
    document.getElementById('client-panel-name').textContent = fields.company || '—';
    const badge = document.getElementById('client-panel-status-badge');
    if (badge) badge.textContent = fields.status || 'New';
    if (currentView === 'clients') renderClients();

    if (status) { status.textContent = 'Saved'; status.style.color = '#16a34a'; }
    setTimeout(() => { if (status && status.textContent === 'Saved') status.textContent = ''; }, 1500);
  } catch (err) {
    console.error('Save error:', err);
    if (status) { status.textContent = 'Save error'; status.style.color = '#b91c1c'; }
  }
}

// ── NEW CLIENT ─────────────────────────────────────────────────────────────
async function createNewClient() {
  const company = prompt('Company name for the new consulting client:');
  if (!company || !company.trim()) return;
  try {
    const res = await fetch(`${CRM_API_BASE}/api/save-consulting-client`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: currentPassword, company: company.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(`Failed to create client: ${data.error || res.status}`);
      return;
    }
    await loadClients();
    if (data.id) openClientPanel(data.id);
  } catch (err) {
    console.error('Create client error:', err);
    alert(`Error: ${err.message}`);
  }
}

// ── WIRE EVENTS ────────────────────────────────────────────────────────────
function wireClientEvents() {
  // Filters
  const search = document.getElementById('client-search');
  const statusFilter = document.getElementById('client-status-filter');
  const refreshBtn = document.getElementById('refresh-clients-btn');
  const addBtn = document.getElementById('add-client-btn');
  if (search) search.addEventListener('input', renderClients);
  if (statusFilter) statusFilter.addEventListener('change', renderClients);
  const typeFilter = document.getElementById('client-type-filter');
  if (typeFilter) typeFilter.addEventListener('change', renderClients);
  if (refreshBtn) refreshBtn.addEventListener('click', loadClients);
  if (addBtn) addBtn.addEventListener('click', createNewClient);

  // Panel close
  const closeBtn = document.getElementById('client-panel-close');
  if (closeBtn) closeBtn.addEventListener('click', closeClientPanel);

  // Auto-save on every input/change in the client panel
  const panel = document.getElementById('client-panel');
  if (panel) {
    [
      'client-company','client-primary-contact','client-email','client-phone',
      'client-country','client-status','client-owner','client-website','client-source',
      'client-notes',
    ].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const evt = (el.tagName === 'SELECT' || el.type === 'date') ? 'change' : 'input';
      el.addEventListener(evt, scheduleSaveClient);
      el.addEventListener('blur', scheduleSaveClient);
    });
    document.querySelectorAll('#client-service-type input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', scheduleSaveClient);
    });
  }

  // Document upload — file picker + drag-and-drop
  document.querySelectorAll('.doc-dropzone').forEach(zone => {
    const field = zone.dataset.field;
    const target = zone.dataset.target || 'company';
    const input = zone.querySelector('input[type="file"]');
    if (input) {
      input.addEventListener('change', () => {
        if (input.files && input.files.length) uploadDocs(field, Array.from(input.files), target);
        input.value = '';
      });
    }
    zone.addEventListener('dragover', e => {
      e.preventDefault();
      zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) uploadDocs(field, files, target);
    });
  });

  // Close client panel on Escape (additive — lead-panel handler already exists)
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('client-panel')?.classList.contains('open')) {
      closeClientPanel();
    }
  });
}

// Wire client events once DOM is ready (independent of login flow so events
// hook up even before showDashboard is called)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { wireClientEvents(); wireLGEvents(); });
} else {
  wireClientEvents();
  wireLGEvents();
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSULTING CRM v2 — DEALS / PIPELINE / TASKS / ACTIVITY
// ═══════════════════════════════════════════════════════════════════════════

const DEAL_STAGES = [
  'Prospect', 'Intro', 'Negotiation', 'Engagement Signed',
  'Pre-Diagnostic', 'Diagnostic', 'Implementation', 'Won', 'Lost',
];

// ── HELPERS ────────────────────────────────────────────────────────────────
function setDealDocs(deal, field, attachments) {
  const map = {
    Contracts: 'contracts', Deliverables: 'deliverables',
    Spreadsheets: 'spreadsheets', Misc: 'misc',
  };
  deal[map[field]] = attachments || [];
}

function getDealDocs(deal, field) {
  const map = {
    Contracts: 'contracts', Deliverables: 'deliverables',
    Spreadsheets: 'spreadsheets', Misc: 'misc',
  };
  return deal[map[field]] || [];
}

function fmtMoney(n) {
  const v = Number(n) || 0;
  return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtRelDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString();
}

function daysSince(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

// ── LOAD ───────────────────────────────────────────────────────────────────
async function loadDeals() {
  if (!currentPassword) return;
  try {
    const res = await fetch(`${CRM_API_BASE}/api/get-consulting-deals?password=${encodeURIComponent(currentPassword)}`);
    if (res.ok) {
      const data = await res.json();
      allDeals = data.deals || [];
    }
  } catch (err) {
    console.error('Failed to load deals:', err);
  }
  // Refresh dependent views
  if (currentView === 'pipeline') renderPipeline();
  if (currentView === 'clients')  renderClients();  // updates Open Deals / Pipeline $ columns
}

async function loadConsultingTasks() {
  if (!currentPassword) return;
  try {
    const res = await fetch(`${CRM_API_BASE}/api/get-consulting-tasks?password=${encodeURIComponent(currentPassword)}`);
    if (res.ok) {
      const data = await res.json();
      allConsultingTasks = data.tasks || [];
    }
  } catch (err) {
    console.error('Failed to load consulting tasks:', err);
  }
  updateConsTaskBadge();
  if (currentView === 'cons-tasks') renderConsultingTasks();
}

// ── NEW CONSULTING TASK MODAL ──────────────────────────────────────────────
function openNewConsTaskModal(prefill = {}) {
  const modal = document.getElementById('new-cons-task-modal');
  if (!modal) return;
  // Populate company dropdown
  const companySel = document.getElementById('new-cons-task-company');
  companySel.innerHTML = '<option value="">— Select a company —</option>' +
    (allClients || []).map(c => `<option value="${escHtml(c.id)}">${escHtml(c.company || '—')}</option>`).join('');
  if (prefill.companyId) companySel.value = prefill.companyId;
  populateNewConsTaskDealOptions(companySel.value);
  // Reset other fields
  document.getElementById('new-cons-task-title').value = prefill.title || '';
  document.getElementById('new-cons-task-type').value = prefill.type || 'Follow-up';
  document.getElementById('new-cons-task-due').value = prefill.dueAt ? prefill.dueAt.slice(0, 16) : '';
  document.getElementById('new-cons-task-owner').value = prefill.owner || (currentAgent?.name || 'Kevin');
  document.getElementById('new-cons-task-notes').value = prefill.notes || '';
  document.getElementById('new-cons-task-status').textContent = '';
  modal.style.display = 'flex';
}

function closeNewConsTaskModal() {
  const modal = document.getElementById('new-cons-task-modal');
  if (modal) modal.style.display = 'none';
}

function populateNewConsTaskDealOptions(companyId) {
  const dealSel = document.getElementById('new-cons-task-deal');
  if (!dealSel) return;
  const deals = (allDeals || []).filter(d => d.companyId === companyId);
  dealSel.innerHTML = '<option value="">— None —</option>' +
    deals.map(d => `<option value="${escHtml(d.id)}">${escHtml(d.dealName || '—')}</option>`).join('');
}

async function submitNewConsTask() {
  const companyId = document.getElementById('new-cons-task-company').value;
  const title = document.getElementById('new-cons-task-title').value.trim();
  const statusEl = document.getElementById('new-cons-task-status');
  if (!companyId) { statusEl.textContent = 'Select a company first.'; statusEl.style.color = '#dc2626'; return; }
  if (!title)     { statusEl.textContent = 'Title is required.';      statusEl.style.color = '#dc2626'; return; }
  statusEl.textContent = 'Saving…';
  statusEl.style.color = '#6b7280';

  const dueLocal = document.getElementById('new-cons-task-due').value;
  const dueAt = dueLocal ? new Date(dueLocal).toISOString() : '';

  try {
    const res = await fetch(`${CRM_API_BASE}/api/create-consulting-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: currentPassword,
        companyId,
        dealId: document.getElementById('new-cons-task-deal').value || '',
        title,
        type: document.getElementById('new-cons-task-type').value || 'Follow-up',
        dueAt,
        owner: document.getElementById('new-cons-task-owner').value || '',
        notes: document.getElementById('new-cons-task-notes').value.trim() || '',
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      statusEl.textContent = 'Save failed: ' + (err.error || res.status);
      statusEl.style.color = '#dc2626';
      return;
    }
    closeNewConsTaskModal();
    await loadConsultingTasks();
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
    statusEl.style.color = '#dc2626';
  }
}

function updateConsTaskBadge() {
  const badge = document.getElementById('cons-task-badge');
  if (!badge) return;
  const now = Date.now();
  const overdueOrSoon = allConsultingTasks.filter(t =>
    t.status === 'Pending' && t.dueAt &&
    new Date(t.dueAt).getTime() <= now + 86400000 * 3
  );
  if (overdueOrSoon.length > 0) {
    badge.textContent = overdueOrSoon.length;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

async function loadActivityFor({ companyId, dealId }) {
  if (!currentPassword) return [];
  const params = new URLSearchParams({ password: currentPassword });
  if (companyId) params.set('companyId', companyId);
  if (dealId)    params.set('dealId', dealId);
  try {
    const res = await fetch(`${CRM_API_BASE}/api/get-consulting-activity?${params}`);
    if (res.ok) {
      const data = await res.json();
      return data.activity || [];
    }
  } catch (err) {
    console.error('Failed to load activity:', err);
  }
  return [];
}

async function logActivity({ companyId, dealId, type, title, details = '' }) {
  if (!currentPassword || !companyId || !title) return;
  try {
    await fetch(`${CRM_API_BASE}/api/log-consulting-activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: currentPassword,
        companyId, dealId, type, title, details,
        agent: currentAgent ? currentAgent.name : '',
      }),
    });
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
}

// ── PIPELINE / KANBAN ──────────────────────────────────────────────────────
function renderPipeline() {
  const board = document.getElementById('kanban-board');
  if (!board) return;

  const ownerFilter = document.getElementById('pipeline-owner-filter')?.value || '';
  filteredDeals = allDeals.filter(d => {
    if (ownerFilter && d.owner !== ownerFilter) return false;
    return true;
  });

  // Update stats
  updatePipelineStats(filteredDeals);

  // Build columns
  board.innerHTML = DEAL_STAGES.map(stage => {
    const dealsInStage = filteredDeals.filter(d => d.stage === stage);
    const total = dealsInStage.reduce((a, d) => a + (Number(d.dealValue) || 0), 0);
    const cards = dealsInStage.map(d => {
      const company = allClients.find(c => c.id === d.companyId);
      const days = daysSince(d.stageEnteredAt);
      const stageKey = (stage || '').toLowerCase().replace(/\s+/g, '-');
      return `
        <div class="kanban-card" draggable="true" data-deal-id="${escHtml(d.id)}">
          <div class="kanban-card-name">${escHtml(d.dealName || '—')}</div>
          <div class="kanban-card-company">${escHtml(company ? company.company : '—')}</div>
          <div class="kanban-card-footer">
            <span class="kanban-card-value">${d.dealValue ? fmtMoney(d.dealValue) : ''}</span>
            <span class="kanban-card-meta">${escHtml(d.owner || '')} ${days != null ? `· ${days}d` : ''}</span>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="kanban-column" data-stage="${escHtml(stage)}">
        <div class="kanban-column-header">
          <span>${escHtml(stage)}</span>
          <span class="kanban-column-total">${total ? fmtMoney(total) : ''}</span>
          <span class="kanban-column-count">${dealsInStage.length}</span>
        </div>
        <div class="kanban-cards" data-stage="${escHtml(stage)}">
          ${cards || '<div style="font-size:.7rem;color:#94a3b8;padding:8px;text-align:center;">drop here</div>'}
        </div>
      </div>
    `;
  }).join('');

  wireKanbanInteractions();
}

function updatePipelineStats(deals) {
  const open = deals.filter(d => d.stage !== 'Won' && d.stage !== 'Lost');
  const total = open.reduce((a, d) => a + (Number(d.dealValue) || 0), 0);
  const weighted = open.reduce(
    (a, d) => a + (Number(d.dealValue) || 0) * ((Number(d.probability) || 0) / 100), 0
  );
  // Won this quarter
  const now = new Date();
  const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const wonQ = deals.filter(d =>
    d.stage === 'Won' && d.closedAt && new Date(d.closedAt) >= qStart
  );
  const wonQValue = wonQ.reduce((a, d) => a + (Number(d.dealValue) || 0), 0);
  // Win rate (Won / (Won + Lost))
  const wonAll  = deals.filter(d => d.stage === 'Won').length;
  const lostAll = deals.filter(d => d.stage === 'Lost').length;
  const winRate = (wonAll + lostAll) > 0
    ? Math.round((wonAll / (wonAll + lostAll)) * 100) + '%'
    : '—';

  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setText('pipeline-stat-total',    fmtMoney(total));
  setText('pipeline-stat-weighted', fmtMoney(weighted));
  setText('pipeline-stat-won',      fmtMoney(wonQValue));
  setText('pipeline-stat-winrate',  winRate);

  const label = document.getElementById('pipeline-count-label');
  if (label) {
    label.textContent = `${open.length} open · ${wonAll} won · ${lostAll} lost`;
    label.style.display = 'inline-block';
  }
}

function wireKanbanInteractions() {
  document.querySelectorAll('#kanban-board .kanban-card').forEach(card => {   // scoped: LG pipeline cards share the class
    card.addEventListener('dragstart', e => {
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.dealId);
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('click', () => openDealPanel(card.dataset.dealId));
  });

  document.querySelectorAll('.kanban-cards').forEach(zone => {
    zone.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.classList.add('drop-target');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drop-target'));
    zone.addEventListener('drop', async e => {
      e.preventDefault();
      zone.classList.remove('drop-target');
      const dealId   = e.dataTransfer.getData('text/plain');
      const newStage = zone.dataset.stage;
      if (!dealId || !newStage) return;
      const deal = allDeals.find(d => d.id === dealId);
      if (!deal || deal.stage === newStage) return;
      await moveDealStage(deal, newStage);
    });
  });
}

async function moveDealStage(deal, newStage) {
  const oldStage = deal.stage;
  // Optimistic update
  deal.stage = newStage;
  deal.stageEnteredAt = new Date().toISOString().slice(0, 10);
  if (newStage === 'Won' || newStage === 'Lost') {
    deal.closedAt = deal.stageEnteredAt;
  }
  renderPipeline();

  try {
    const res = await fetch(`${CRM_API_BASE}/api/update-consulting-deal`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: deal.id,
        password: currentPassword,
        stage: newStage,
        agent: currentAgent ? currentAgent.name : '',
      }),
    });
    if (!res.ok) {
      // Rollback
      deal.stage = oldStage;
      renderPipeline();
      const err = await res.json().catch(() => ({}));
      alert(`Failed to move deal: ${err.error || res.status}`);
    }
  } catch (err) {
    deal.stage = oldStage;
    renderPipeline();
    alert(`Network error: ${err.message}`);
  }
}

// ── DEAL PANEL ─────────────────────────────────────────────────────────────
function openDealPanel(id) {
  const deal = allDeals.find(d => d.id === id);
  if (!deal) return;
  currentDeal = deal;

  const company = allClients.find(c => c.id === deal.companyId);
  const setVal = (eid, val) => { const el = document.getElementById(eid); if (el) el.value = val; };

  document.getElementById('deal-avatar-text').textContent = (deal.dealName || '$').charAt(0).toUpperCase();
  document.getElementById('deal-panel-name').textContent = deal.dealName || '—';
  const compLink = document.getElementById('deal-panel-company-link');
  if (compLink) {
    compLink.textContent = company ? company.company : '—';
    compLink.onclick = e => {
      e.preventDefault();
      closeDealPanel();
      if (company) openClientPanel(company.id);
    };
  }

  setVal('deal-name',         deal.dealName || '');
  setVal('deal-stage',        deal.stage || 'Prospect');
  setVal('deal-value',        deal.dealValue || '');
  setVal('deal-probability',  deal.probability ?? '');
  setVal('deal-owner',        deal.owner || '');
  setVal('deal-started-at',   deal.startedAt ? deal.startedAt.slice(0, 10) : '');
  setVal('deal-description',  deal.description || '');

  const services = deal.serviceType || [];
  document.querySelectorAll('#deal-service-type input[type="checkbox"]').forEach(cb => {
    cb.checked = services.includes(cb.value);
  });

  ['Contracts', 'Deliverables', 'Spreadsheets', 'Misc'].forEach(field => {
    renderDocList(field, getDealDocs(deal, field), 'deal');
  });

  // Tasks for this deal
  const dealTasks = allConsultingTasks.filter(t => t.dealId === deal.id);
  renderTasksList(document.getElementById('deal-tasks-list'), dealTasks);

  // Activity for this deal
  loadActivityFor({ dealId: deal.id }).then(items => {
    renderActivityTimeline(document.getElementById('deal-activity-list'), items);
  });

  document.getElementById('deal-panel').classList.add('open');
  const overlay = document.getElementById('panel-overlay');
  if (overlay) overlay.style.display = 'block';
}

function closeDealPanel() {
  document.getElementById('deal-panel')?.classList.remove('open');
  const overlay = document.getElementById('panel-overlay');
  if (overlay && !document.getElementById('client-panel')?.classList.contains('open')) {
    overlay.style.display = 'none';
  }
  currentDeal = null;
}

function scheduleSaveDeal() {
  if (dealSaveTimer) clearTimeout(dealSaveTimer);
  const status = document.getElementById('deal-save-status');
  if (status) { status.textContent = 'Saving…'; status.style.color = '#6b7280'; }
  dealSaveTimer = setTimeout(saveDealNow, 600);
}

async function saveDealNow() {
  if (!currentDeal) return;
  const id = currentDeal.id;
  const services = Array.from(
    document.querySelectorAll('#deal-service-type input[type="checkbox"]:checked')
  ).map(cb => cb.value);

  const fields = {
    dealName:    document.getElementById('deal-name').value.trim(),
    stage:       document.getElementById('deal-stage').value,
    serviceType: services,
    dealValue:   Number(document.getElementById('deal-value').value) || 0,
    probability: Number(document.getElementById('deal-probability').value) || 0,
    owner:       document.getElementById('deal-owner').value,
    startedAt:   document.getElementById('deal-started-at').value || null,
    description: document.getElementById('deal-description').value,
  };

  const status = document.getElementById('deal-save-status');
  try {
    const res = await fetch(`${CRM_API_BASE}/api/update-consulting-deal`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id, password: currentPassword,
        agent: currentAgent ? currentAgent.name : '',
        ...fields,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (status) { status.textContent = `Save failed: ${err.error || res.status}`; status.style.color = '#b91c1c'; }
      return;
    }
    Object.assign(currentDeal, fields);
    const cached = allDeals.find(d => d.id === id);
    if (cached) Object.assign(cached, fields);
    document.getElementById('deal-panel-name').textContent = fields.dealName || '—';
    if (currentView === 'pipeline') renderPipeline();
    if (currentView === 'clients')  renderClients();
    if (status) { status.textContent = 'Saved'; status.style.color = '#16a34a'; }
    setTimeout(() => { if (status && status.textContent === 'Saved') status.textContent = ''; }, 1500);
  } catch (err) {
    if (status) { status.textContent = 'Save error'; status.style.color = '#b91c1c'; }
  }
}

// ── CONSULTING TASKS VIEW (grouped) ────────────────────────────────────────
function renderConsultingTasks() {
  const tbody  = document.getElementById('cons-tasks-tbody');
  const table  = document.getElementById('cons-tasks-table');
  const empty  = document.getElementById('cons-tasks-empty');
  if (!tbody) return;

  const statusF = document.getElementById('cons-tasks-status-filter')?.value || '';
  const ownerF  = document.getElementById('cons-tasks-owner-filter')?.value || '';

  const filtered = allConsultingTasks.filter(t => {
    if (statusF && t.status !== statusF) return false;
    if (ownerF && t.owner !== ownerF) return false;
    return true;
  });

  // Subtitle: "X total · Y due today · Z overdue · <who>"
  const label = document.getElementById('cons-tasks-count-label');
  if (label) {
    const total = filtered.length;
    const who = ownerF || 'all owners';
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfToday   = startOfToday + 86400000;
    let dueTodayCount = 0;
    let overdueCount  = 0;
    filtered.forEach(t => {
      if (t.status !== 'Pending') return;
      const due = t.dueAt ? new Date(t.dueAt).getTime() : NaN;
      if (isNaN(due)) return;
      if (due < startOfToday) overdueCount++;
      else if (due < endOfToday) dueTodayCount++;
    });
    label.textContent = `${total} total · ${dueTodayCount} due today · ${overdueCount} overdue · ${who}`;
    label.style.display = 'inline-block';
  }

  if (filtered.length === 0) {
    if (table) table.style.display = 'none';
    if (empty) empty.style.display = 'block';
    tbody.innerHTML = '';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (table) table.style.display = 'table';

  const now = Date.now();

  tbody.innerHTML = filtered.map(t => {
    const company = allClients.find(c => c.id === t.companyId);
    const deal    = t.dealId ? allDeals.find(d => d.id === t.dealId) : null;
    const dueDate = t.dueAt ? new Date(t.dueAt) : null;
    const isOverdue = t.status === 'Pending' && dueDate && dueDate.getTime() < now;
    const rowClass = isOverdue ? 'reminder-overdue' : '';
    const actionClass = 'action-type-' + (t.type || 'Other').replace(/\s+/g, '-');

    const dueStr = dueDate ? formatReminderDate(dueDate) : '—';
    const statusBadge = t.status === 'Pending'
      ? (isOverdue ? '<span class="reminder-status-badge overdue">Overdue</span>' : '<span class="reminder-status-badge pending">Pending</span>')
      : t.status === 'Completed'
        ? '<span class="reminder-status-badge completed">Done</span>'
        : '<span class="reminder-status-badge cancelled">Cancelled</span>';

    const dtLocal = dueDate ? `${dueDate.getFullYear()}-${String(dueDate.getMonth()+1).padStart(2,'0')}-${String(dueDate.getDate()).padStart(2,'0')}T${String(dueDate.getHours()).padStart(2,'0')}:${String(dueDate.getMinutes()).padStart(2,'0')}` : '';

    const actions = t.status === 'Pending'
      ? `<button class="reminder-action-btn done" onclick="completeConsTask('${t.id}')">Done</button>
         <button class="reminder-action-btn cancel" onclick="cancelConsTask('${t.id}')">Cancel</button>
         <button class="reminder-action-btn edit" onclick="toggleConsTaskEdit('${t.id}')">Edit</button>`
      : '';

    const ownerOptions = AGENTS.map(a =>
      `<option value="${escHtml(a.name)}" ${a.name === t.owner ? 'selected' : ''}>${escHtml(a.name)}</option>`
    ).join('');

    const noteText = [t.title, t.notes].filter(Boolean).join(' — ');

    return `
      <tr class="${rowClass}" data-task-id="${escHtml(t.id)}" style="cursor:pointer;">
        <td>
          <div class="lead-name">${escHtml(company ? company.company : '—')}</div>
          <div class="td-muted" style="font-size:0.75rem">${escHtml(deal ? deal.dealName : '')}</div>
        </td>
        <td class="td-muted">
          <span id="cons-task-due-text-${t.id}">${escHtml(dueStr)}</span>
          <div id="cons-task-edit-${t.id}" class="reminder-edit-row" style="display:none;">
            <input type="datetime-local" id="cons-task-dt-${t.id}" class="reminder-dt-input" value="${dtLocal}">
            <select id="cons-task-owner-${t.id}" class="reminder-dt-input" style="margin-top:4px">${ownerOptions}</select>
            <button class="reminder-action-btn done" style="margin-top:4px" onclick="saveConsTaskEdit('${t.id}')">Save</button>
          </div>
        </td>
        <td><span class="action-type-badge ${actionClass}">${escHtml(t.type || '—')}</span></td>
        <td class="td-muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(noteText)}">${escHtml(noteText || '—')}</td>
        <td class="td-muted">${escHtml(t.owner || '—')}</td>
        <td>${statusBadge}</td>
        <td>${actions}</td>
      </tr>`;
  }).join('');

  // Row click → open panel (skip clicks on buttons, inputs, selects, edit row)
  tbody.querySelectorAll('tr[data-task-id]').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('button, input, select, .reminder-edit-row')) return;
      openPanelFromConsTask(tr.dataset.taskId);
    });
  });
}

// ── CONSULTING REMINDER ACTIONS ────────────────────────────────────────────
async function completeConsTask(id) {
  await updateConsTaskStatus(id, 'Completed');
}

async function cancelConsTask(id) {
  await updateConsTaskStatus(id, 'Cancelled');
}

async function updateConsTaskStatus(id, status) {
  const task = allConsultingTasks.find(t => t.id === id);
  if (!task) return;
  const prev = task.status;
  task.status = status; // optimistic
  if (currentView === 'cons-tasks') renderConsultingTasks();
  try {
    const res = await fetch(`${CRM_API_BASE}/api/update-consulting-task`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id, password: currentPassword, status,
        agent: currentAgent ? currentAgent.name : '',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.success) {
      task.status = prev;
      if (currentView === 'cons-tasks') renderConsultingTasks();
      alert('Failed to update reminder: ' + (data.error || 'unknown error'));
      return;
    }
    updateConsTaskBadge();
  } catch (err) {
    task.status = prev;
    if (currentView === 'cons-tasks') renderConsultingTasks();
    console.error('Failed to update consulting reminder:', err);
  }
}

function toggleConsTaskEdit(id) {
  const editEl = document.getElementById(`cons-task-edit-${id}`);
  if (editEl) editEl.style.display = editEl.style.display === 'none' ? 'block' : 'none';
}

async function saveConsTaskEdit(id) {
  const dtInput    = document.getElementById(`cons-task-dt-${id}`);
  const ownerInput = document.getElementById(`cons-task-owner-${id}`);
  const task = allConsultingTasks.find(t => t.id === id);
  if (!task) return;

  const payload = { id, password: currentPassword };
  if (dtInput && dtInput.value) {
    payload.dueAt = new Date(dtInput.value).toISOString();
  }
  if (ownerInput && ownerInput.value && ownerInput.value !== task.owner) {
    payload.owner = ownerInput.value;
  }
  if (!payload.dueAt && !payload.owner) {
    toggleConsTaskEdit(id);
    return;
  }

  try {
    const res = await fetch(`${CRM_API_BASE}/api/update-consulting-task`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) {
      if (payload.dueAt) task.dueAt = payload.dueAt;
      if (payload.owner) task.owner = payload.owner;
      renderConsultingTasks();
      updateConsTaskBadge();
    } else {
      alert('Failed to update reminder: ' + (data.error || 'unknown error'));
    }
  } catch (err) {
    console.error('Failed to update consulting reminder:', err);
    alert('Failed to update reminder. See console.');
  }
}

function openPanelFromConsTask(id) {
  const task = allConsultingTasks.find(t => t.id === id);
  if (!task) return;
  if (task.dealId) openDealPanel(task.dealId);
  else if (task.companyId) openClientPanel(task.companyId);
}

// ── COMPANY/DEAL PANEL TASK ROW (compact list used inside detail panels) ───
function taskRowHTML(t) {
  const company = allClients.find(c => c.id === t.companyId);
  const due = t.dueAt ? new Date(t.dueAt).toLocaleDateString() : '—';
  const completed = t.status === 'Completed';
  const overdue = !completed && t.dueAt && new Date(t.dueAt).getTime() < Date.now();
  return `
    <div class="task-row ${completed ? 'completed' : ''} ${overdue ? 'overdue' : ''}" data-task-id="${escHtml(t.id)}">
      <button type="button" class="task-row-check" aria-label="Toggle complete" style="${completed ? 'background:#22c55e;border-color:#16a34a;' : ''}"></button>
      <span style="font-size:.7rem;background:#e2e8f0;color:#475569;padding:2px 7px;border-radius:6px;">${escHtml(t.type || '')}</span>
      <span class="task-row-title">${escHtml(t.title)}</span>
      <span style="font-size:.7rem;color:#64748b;">${escHtml(company ? company.company : '')}</span>
      <span class="task-row-due">${due}</span>
      <span style="font-size:.7rem;color:#94a3b8;">${escHtml(t.owner || '')}</span>
    </div>
  `;
}

async function toggleTaskComplete(id) {
  const task = allConsultingTasks.find(t => t.id === id);
  if (!task) return;
  const newStatus = task.status === 'Completed' ? 'Pending' : 'Completed';
  task.status = newStatus;  // optimistic
  if (currentView === 'cons-tasks') renderConsultingTasks();
  try {
    await fetch(`${CRM_API_BASE}/api/update-consulting-task`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id, password: currentPassword,
        status: newStatus,
        agent: currentAgent ? currentAgent.name : '',
      }),
    });
    updateConsTaskBadge();
  } catch (err) {
    task.status = newStatus === 'Completed' ? 'Pending' : 'Completed';
    if (currentView === 'cons-tasks') renderConsultingTasks();
  }
}

// ── ACTIVITY TIMELINE ──────────────────────────────────────────────────────
function renderActivityTimeline(container, items) {
  if (!container) return;
  if (!items || items.length === 0) {
    container.innerHTML = '<p class="panel-empty-text">No activity yet.</p>';
    return;
  }
  const iconFor = (type) => {
    const map = {
      'Note': '📝', 'Stage Change': '🔁', 'Doc Upload': '📎',
      'Call Logged': '📞', 'Email Logged': '✉️', 'Task Completed': '✓',
      'WhatsApp': '💬', 'Deal Created': '✨',
    };
    return map[type] || '•';
  };
  container.innerHTML = items.map(a => {
    const date = a.createdAt ? new Date(a.createdAt).toLocaleString() : '';
    const typeKey = (a.type || '').toLowerCase().replace(/\s+/g, '-');
    return `
      <div class="activity-item">
        <div class="activity-icon type-${typeKey}">${iconFor(a.type)}</div>
        <div class="activity-content">
          <div class="activity-title">${escHtml(a.title)}</div>
          ${a.details ? `<div class="activity-details">${escHtml(a.details)}</div>` : ''}
          <div class="activity-meta">${escHtml(a.agent || '')} · ${date}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderTasksList(container, tasks) {
  if (!container) return;
  if (!tasks || tasks.length === 0) {
    container.innerHTML = '<p class="panel-empty-text">No tasks yet.</p>';
    return;
  }
  container.innerHTML = tasks.map(t => taskRowHTML(t)).join('');
  container.querySelectorAll('.task-row-check').forEach(cb => {
    cb.addEventListener('click', e => {
      e.stopPropagation();
      const id = cb.closest('.task-row').dataset.taskId;
      toggleTaskComplete(id);
    });
  });
}

// ── COMPANY PANEL EXTENSIONS ───────────────────────────────────────────────
// Hook into existing openClientPanel: after it renders the company, also
// populate Deals / Tasks / Activity sections.
const _originalOpenClientPanel = typeof openClientPanel === 'function' ? openClientPanel : null;
if (_originalOpenClientPanel) {
  window.openClientPanel = function (id) {
    _originalOpenClientPanel(id);
    populateCompanyPanelExtras(id);
  };
}

function populateCompanyPanelExtras(companyId) {
  const dealsList = document.getElementById('company-deals-list');
  const tasksList = document.getElementById('company-tasks-list');
  const actList   = document.getElementById('company-activity-list');

  // Deals
  const compDeals = allDeals.filter(d => d.companyId === companyId);
  if (dealsList) {
    if (compDeals.length === 0) {
      dealsList.innerHTML = '<p class="panel-empty-text">No deals yet.</p>';
    } else {
      dealsList.innerHTML = compDeals.map(d => {
        const stageKey = (d.stage || '').toLowerCase().replace(/\s+/g, '-');
        return `
          <div class="deal-row" data-deal-id="${escHtml(d.id)}">
            <span class="deal-row-name">${escHtml(d.dealName || '—')}</span>
            <span class="deal-row-stage status-${stageKey}">${escHtml(d.stage)}</span>
            <span class="deal-row-value">${d.dealValue ? fmtMoney(d.dealValue) : ''}</span>
          </div>
        `;
      }).join('');
      dealsList.querySelectorAll('.deal-row').forEach(row => {
        row.addEventListener('click', () => openDealPanel(row.dataset.dealId));
      });
    }
  }

  // Tasks
  const compTasks = allConsultingTasks.filter(t => t.companyId === companyId && t.status === 'Pending');
  renderTasksList(tasksList, compTasks);

  // Activity
  loadActivityFor({ companyId }).then(items => {
    renderActivityTimeline(actList, items);
  });
}

// ── NEW DEAL MODAL ─────────────────────────────────────────────────────────
function openNewDealModal(prefilledCompanyId = null) {
  const modal = document.getElementById('new-deal-modal');
  if (!modal) return;
  const companySelect = document.getElementById('new-deal-company');
  if (companySelect) {
    const sortedComps = [...allClients].sort((a, b) => (a.company || '').localeCompare(b.company || ''));
    companySelect.innerHTML = sortedComps
      .map(c => `<option value="${escHtml(c.id)}">${escHtml(c.company || '—')}</option>`)
      .join('');
    if (prefilledCompanyId) companySelect.value = prefilledCompanyId;
  }
  document.getElementById('new-deal-name').value = '';
  document.getElementById('new-deal-stage').value = 'Prospect';
  document.getElementById('new-deal-value').value = '';
  document.getElementById('new-deal-error').style.display = 'none';
  modal.style.display = 'flex';
}

function closeNewDealModal() {
  const modal = document.getElementById('new-deal-modal');
  if (modal) modal.style.display = 'none';
}

async function submitNewDeal() {
  const companyId = document.getElementById('new-deal-company').value;
  const dealName  = document.getElementById('new-deal-name').value.trim();
  const stage     = document.getElementById('new-deal-stage').value;
  const dealValue = Number(document.getElementById('new-deal-value').value) || 0;
  const errEl = document.getElementById('new-deal-error');

  if (!companyId || !dealName) {
    errEl.textContent = 'Company and Deal Name are required.';
    errEl.style.display = 'block';
    return;
  }
  try {
    const res = await fetch(`${CRM_API_BASE}/api/save-consulting-deal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: currentPassword,
        companyId, dealName, stage, dealValue,
        owner: currentAgent ? currentAgent.name : '',
        agent: currentAgent ? currentAgent.name : '',
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Failed to create deal.';
      errEl.style.display = 'block';
      return;
    }
    closeNewDealModal();
    await loadDeals();
    if (data.id) openDealPanel(data.id);
  } catch (err) {
    errEl.textContent = 'Network error: ' + err.message;
    errEl.style.display = 'block';
  }
}

// ── NEW TASK MODAL ─────────────────────────────────────────────────────────
function openNewTaskModal(context) {
  // context: { companyId, dealId? }
  pendingTaskContext = context;
  const modal = document.getElementById('new-task-modal');
  if (!modal) return;
  document.getElementById('new-task-title').value = '';
  document.getElementById('new-task-type').value = 'Call';
  document.getElementById('new-task-due').value = '';
  document.getElementById('new-task-owner').value = currentAgent ? currentAgent.name : 'Kevin';
  document.getElementById('new-task-notes').value = '';
  document.getElementById('new-task-error').style.display = 'none';
  modal.style.display = 'flex';
}

function closeNewTaskModal() {
  const modal = document.getElementById('new-task-modal');
  if (modal) modal.style.display = 'none';
  pendingTaskContext = null;
}

async function submitNewTask() {
  if (!pendingTaskContext) return;
  const title = document.getElementById('new-task-title').value.trim();
  const type  = document.getElementById('new-task-type').value;
  const dueAt = document.getElementById('new-task-due').value;
  const owner = document.getElementById('new-task-owner').value;
  const notes = document.getElementById('new-task-notes').value;
  const errEl = document.getElementById('new-task-error');

  if (!title) {
    errEl.textContent = 'Title is required.';
    errEl.style.display = 'block';
    return;
  }
  try {
    const res = await fetch(`${CRM_API_BASE}/api/create-consulting-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: currentPassword,
        companyId: pendingTaskContext.companyId,
        dealId:    pendingTaskContext.dealId || '',
        title, type, dueAt, owner, notes,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Failed to create task.';
      errEl.style.display = 'block';
      return;
    }
    closeNewTaskModal();
    await loadConsultingTasks();
    // Refresh open panel if any
    if (currentDeal) populateDealTasks(currentDeal.id);
    if (currentClient) populateCompanyPanelExtras(currentClient.id);
  } catch (err) {
    errEl.textContent = 'Network error: ' + err.message;
    errEl.style.display = 'block';
  }
}

function populateDealTasks(dealId) {
  const dealTasks = allConsultingTasks.filter(t => t.dealId === dealId);
  renderTasksList(document.getElementById('deal-tasks-list'), dealTasks);
}

// ── WIRE EVENTS ────────────────────────────────────────────────────────────
function wireConsultingV2Events() {
  // Pipeline view
  document.getElementById('pipeline-owner-filter')?.addEventListener('change', renderPipeline);
  document.getElementById('refresh-pipeline-btn')?.addEventListener('click', loadDeals);
  document.getElementById('add-deal-btn')?.addEventListener('click', () => openNewDealModal());

  // Tasks view
  document.getElementById('cons-tasks-status-filter')?.addEventListener('change', renderConsultingTasks);
  document.getElementById('cons-tasks-owner-filter')?.addEventListener('change', renderConsultingTasks);
  document.getElementById('refresh-cons-tasks-btn')?.addEventListener('click', loadConsultingTasks);
  document.getElementById('new-cons-task-btn')?.addEventListener('click', openNewConsTaskModal);
  document.getElementById('new-cons-task-close')?.addEventListener('click', closeNewConsTaskModal);
  document.getElementById('new-cons-task-cancel')?.addEventListener('click', closeNewConsTaskModal);
  document.getElementById('new-cons-task-create')?.addEventListener('click', submitNewConsTask);
  // Refresh deal dropdown when company changes
  document.getElementById('new-cons-task-company')?.addEventListener('change', () => {
    populateNewConsTaskDealOptions(document.getElementById('new-cons-task-company').value);
  });

  // Deal panel
  document.getElementById('deal-panel-close')?.addEventListener('click', closeDealPanel);
  [
    'deal-name','deal-stage','deal-value','deal-probability','deal-owner',
    'deal-started-at','deal-description',
  ].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const evt = (el.tagName === 'SELECT' || el.type === 'date') ? 'change' : 'input';
    el.addEventListener(evt, scheduleSaveDeal);
    el.addEventListener('blur', scheduleSaveDeal);
  });
  document.querySelectorAll('#deal-service-type input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', scheduleSaveDeal);
  });

  // Company panel: + New Deal / + New Task buttons
  document.getElementById('company-add-deal-btn')?.addEventListener('click', () => {
    if (currentClient) openNewDealModal(currentClient.id);
  });
  document.getElementById('company-add-task-btn')?.addEventListener('click', () => {
    if (currentClient) openNewTaskModal({ companyId: currentClient.id });
  });

  // Deal panel: + New Task
  document.getElementById('deal-add-task-btn')?.addEventListener('click', () => {
    if (currentDeal) openNewTaskModal({ companyId: currentDeal.companyId, dealId: currentDeal.id });
  });

  // Modals
  document.getElementById('new-deal-close')?.addEventListener('click', closeNewDealModal);
  document.getElementById('new-deal-create')?.addEventListener('click', submitNewDeal);
  document.getElementById('new-task-close')?.addEventListener('click', closeNewTaskModal);
  document.getElementById('new-task-create')?.addEventListener('click', submitNewTask);

  // Esc closes deal panel + modals
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('new-deal-modal')?.style.display === 'flex') closeNewDealModal();
    else if (document.getElementById('new-task-modal')?.style.display === 'flex') closeNewTaskModal();
    else if (document.getElementById('deal-panel')?.classList.contains('open')) closeDealPanel();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireConsultingV2Events);
} else {
  wireConsultingV2Events();
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSULTING CRM v3 — CONTACTS / PARTNERS / OPPS TABLE / PROMOTE / AUTO-STAMP
// ═══════════════════════════════════════════════════════════════════════════

// ── LOAD ───────────────────────────────────────────────────────────────────
async function loadConsultingContacts() {
  if (!currentPassword) return;
  try {
    const res = await fetch(`${CRM_API_BASE}/api/get-consulting-contacts?password=${encodeURIComponent(currentPassword)}`);
    if (res.ok) {
      const data = await res.json();
      allConsultingContacts = data.contacts || [];
    }
  } catch (err) { console.error('Failed to load consulting contacts:', err); }
  if (currentClient) populateCompanyContacts(currentClient.id);
  if (currentView === 'clients') renderClients();
}

async function loadConsultingPartners() {
  if (!currentPassword) return;
  try {
    const res = await fetch(`${CRM_API_BASE}/api/get-consulting-partners?password=${encodeURIComponent(currentPassword)}`);
    if (res.ok) {
      const data = await res.json();
      allConsultingPartners = data.partners || [];
    }
  } catch (err) { console.error('Failed to load partners:', err); }
  populateDealPartnerSelect();
  if (currentView === 'partners') renderPartnersTable();
}

// ── COMPANY PANEL: Contacts inline ─────────────────────────────────────────
function populateCompanyContacts(companyId) {
  const list = document.getElementById('company-contacts-list');
  if (!list) return;
  const contacts = allConsultingContacts.filter(c => c.companyId === companyId);
  if (contacts.length === 0) {
    list.innerHTML = '<p class="panel-empty-text">No contacts yet.</p>';
    return;
  }
  // Sort: primary first, then alpha
  contacts.sort((a, b) => (b.primary - a.primary) || a.name.localeCompare(b.name));
  list.innerHTML = contacts.map(c => {
    const phoneHref = c.phone ? c.phone.replace(/[^+\d]/g, '') : '';
    return `
      <div class="contact-row ${c.primary ? 'primary' : ''}" data-contact-id="${escHtml(c.id)}">
        <div style="flex:1;min-width:0;">
          <div class="contact-row-name">${escHtml(c.name)}${c.primary ? ' ⭐' : ''}</div>
          <div class="contact-row-role">${escHtml([c.role, c.email, c.phone].filter(Boolean).join(' · '))}</div>
        </div>
        <div class="contact-row-actions">
          ${c.phone    ? `<a class="contact-row-btn" href="tel:${escHtml(phoneHref)}">📞</a>` : ''}
          ${c.email    ? `<a class="contact-row-btn" href="mailto:${escHtml(c.email)}">✉️</a>` : ''}
          ${c.phone    ? `<a class="contact-row-btn" href="https://wa.me/${escHtml(phoneHref.replace(/\D/g, ''))}" target="_blank" rel="noopener">💬</a>` : ''}
          <button class="contact-row-btn delete" data-contact-id="${escHtml(c.id)}">×</button>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.contact-row-btn.delete').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = btn.dataset.contactId;
      if (!confirm('Delete this contact?')) return;
      try {
        const res = await fetch(`${CRM_API_BASE}/api/delete-consulting-contact`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, password: currentPassword }),
        });
        if (!res.ok) { alert('Delete failed'); return; }
        allConsultingContacts = allConsultingContacts.filter(c => c.id !== id);
        if (currentClient) populateCompanyContacts(currentClient.id);
      } catch (err) { alert('Network error: ' + err.message); }
    });
  });
}

// ── PROMOTE TO CLIENT ──────────────────────────────────────────────────────
async function promoteToClient() {
  if (!currentClient || currentClient.status !== 'Lead') return;
  if (!confirm(`Promote ${currentClient.company} from Lead to Active Client?`)) return;
  document.getElementById('client-status').value = 'Active Client';
  await saveClientNow();
  // saveClientNow updates currentClient.status; refresh promote button visibility
  const promoteBtn = document.getElementById('client-promote-btn');
  if (promoteBtn) promoteBtn.style.display = 'none';
}

// ── NEW CONTACT MODAL ──────────────────────────────────────────────────────
function openNewContactModal(companyId) {
  pendingContactCompanyId = companyId;
  const modal = document.getElementById('new-contact-modal');
  if (!modal) return;
  ['new-contact-name','new-contact-role','new-contact-email','new-contact-phone'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('new-contact-language').value = '';
  document.getElementById('new-contact-primary').checked = false;
  document.getElementById('new-contact-error').style.display = 'none';
  modal.style.display = 'flex';
}

function closeNewContactModal() {
  const m = document.getElementById('new-contact-modal'); if (m) m.style.display = 'none';
  pendingContactCompanyId = null;
}

async function submitNewContact() {
  if (!pendingContactCompanyId) return;
  const name     = document.getElementById('new-contact-name').value.trim();
  const role     = document.getElementById('new-contact-role').value.trim();
  const email    = document.getElementById('new-contact-email').value.trim();
  const phone    = document.getElementById('new-contact-phone').value.trim();
  const language = document.getElementById('new-contact-language').value;
  const primary  = document.getElementById('new-contact-primary').checked;
  const errEl    = document.getElementById('new-contact-error');
  if (!name) { errEl.textContent = 'Name is required.'; errEl.style.display = 'block'; return; }
  try {
    const res = await fetch(`${CRM_API_BASE}/api/save-consulting-contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: currentPassword,
        companyId: pendingContactCompanyId,
        name, role, email, phone, primary, language,
      }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Failed to create.'; errEl.style.display = 'block'; return; }
    closeNewContactModal();
    await loadConsultingContacts();
  } catch (err) {
    errEl.textContent = 'Network error: ' + err.message;
    errEl.style.display = 'block';
  }
}

// ── PARTNERS ───────────────────────────────────────────────────────────────
function populateDealPartnerSelect() {
  const sel = document.getElementById('deal-partner');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">— Direct (no partner) —</option>' +
    [...allConsultingPartners]
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}${p.type ? ' (' + escHtml(p.type) + ')' : ''}</option>`)
      .join('');
  if (current) sel.value = current;
}

function renderPartnersTable() {
  const tbody = document.getElementById('partners-tbody');
  const empty = document.getElementById('partners-empty');
  const table = document.getElementById('partners-table');
  if (!tbody) return;

  if (allConsultingPartners.length === 0) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = 'block';
    if (table) table.style.display = 'none';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (table) table.style.display = 'table';

  const label = document.getElementById('partners-count-label');
  if (label) {
    label.textContent = `${allConsultingPartners.length} partner${allConsultingPartners.length === 1 ? '' : 's'}`;
    label.style.display = 'inline-block';
  }

  tbody.innerHTML = allConsultingPartners.map(p => {
    const oppCount = (allDeals || []).filter(d => d.partnerId === p.id).length;
    const share = p.defaultRevenueShare != null
      ? Math.round((p.defaultRevenueShare > 1 ? p.defaultRevenueShare : p.defaultRevenueShare * 100)) + '%'
      : '—';
    return `
      <tr data-partner-id="${escHtml(p.id)}">
        <td><strong>${escHtml(p.name)}</strong></td>
        <td>${escHtml(p.type || '—')}</td>
        <td>${escHtml(p.contactInfo || '—')}</td>
        <td>${share}</td>
        <td>${oppCount}</td>
      </tr>
    `;
  }).join('');
}

function openNewPartnerModal() {
  const m = document.getElementById('new-partner-modal'); if (!m) return;
  ['new-partner-name','new-partner-contact','new-partner-share'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('new-partner-type').value = 'Individual';
  document.getElementById('new-partner-error').style.display = 'none';
  m.style.display = 'flex';
}

function closeNewPartnerModal() {
  const m = document.getElementById('new-partner-modal'); if (m) m.style.display = 'none';
}

async function submitNewPartner() {
  const name        = document.getElementById('new-partner-name').value.trim();
  const type        = document.getElementById('new-partner-type').value;
  const contactInfo = document.getElementById('new-partner-contact').value.trim();
  const share       = document.getElementById('new-partner-share').value;
  const errEl       = document.getElementById('new-partner-error');
  if (!name) { errEl.textContent = 'Name required.'; errEl.style.display = 'block'; return; }
  try {
    const res = await fetch(`${CRM_API_BASE}/api/save-consulting-partner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: currentPassword,
        name, type, contactInfo,
        defaultRevenueShare: share || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Failed.'; errEl.style.display = 'block'; return; }
    closeNewPartnerModal();
    await loadConsultingPartners();
  } catch (err) {
    errEl.textContent = 'Network error: ' + err.message;
    errEl.style.display = 'block';
  }
}

// ── OPPORTUNITIES FLAT TABLE ───────────────────────────────────────────────
function renderOpportunitiesTable() {
  const tbody = document.getElementById('opps-tbody');
  const table = document.getElementById('opps-table');
  const empty = document.getElementById('opps-empty');
  if (!tbody) return;

  const stageF = document.getElementById('opp-stage-filter')?.value || '';
  const ownerF = document.getElementById('opp-owner-filter')?.value || '';
  const search = (document.getElementById('opp-search')?.value || '').toLowerCase().trim();

  const filtered = (allDeals || []).filter(d => {
    if (stageF && d.stage !== stageF) return false;
    if (ownerF && d.owner !== ownerF) return false;
    if (search) {
      const company = allClients.find(c => c.id === d.companyId);
      const hay = [d.dealName, company?.company || '', d.owner, d.stage].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  const label = document.getElementById('opportunities-count-label');
  if (label) {
    label.textContent = `${filtered.length} ${filtered.length === 1 ? 'opportunity' : 'opportunities'}`;
    label.style.display = 'inline-block';
  }

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = 'block';
    if (table) table.style.display = 'none';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (table) table.style.display = 'table';

  tbody.innerHTML = filtered.map(d => {
    const company = allClients.find(c => c.id === d.companyId);
    const stageKey = (d.stage || '').toLowerCase().replace(/\s+/g, '-');
    const value = d.dealValue ? '$' + Number(d.dealValue).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';
    const expectedClose = formatExpectedCloseBucket(d.expectedCloseDate);
    const lastContact = d.lastContact ? new Date(d.lastContact).toLocaleDateString() : '—';
    const timelineKey = (d.timeline || computeTimeline(d)).toLowerCase().replace(/\s+/g, '-');
    const timelineDisplay = d.timeline || computeTimeline(d) || '—';
    return `
      <tr data-deal-id="${escHtml(d.id)}" style="cursor:pointer;">
        <td><strong>${escHtml(d.dealName || '—')}</strong></td>
        <td>${escHtml(company ? company.company : '—')}</td>
        <td><span class="client-status-pill status-${stageKey}">${escHtml(d.stage)}</span></td>
        <td>${escHtml(d.owner || '—')}</td>
        <td>${value}</td>
        <td>${expectedClose}</td>
        <td>${lastContact}</td>
        <td><span class="timeline-pill timeline-${timelineKey}">${escHtml(timelineDisplay)}</span></td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('tr[data-deal-id]').forEach(tr => {
    tr.addEventListener('click', () => openDealPanel(tr.dataset.dealId));
  });
}

// ── EXPECTED CLOSE BUCKET LOGIC ────────────────────────────────────────────
function formatExpectedCloseBucket(iso) {
  if (!iso) return '—';
  const target = new Date(iso);
  if (isNaN(target)) return '—';
  const now = new Date();
  const days = Math.floor((target - now) / (1000 * 60 * 60 * 24));
  if (days < 0)  return `Past Due (${target.toLocaleDateString()})`;
  if (days <= 7) return `This Week (${target.toLocaleDateString()})`;
  // Same calendar month
  if (target.getFullYear() === now.getFullYear() && target.getMonth() === now.getMonth()) {
    return `This Month (${target.toLocaleDateString()})`;
  }
  // Next month
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  if (target.getFullYear() === nextMonth.getFullYear() && target.getMonth() === nextMonth.getMonth()) {
    return `Next Month (${target.toLocaleDateString()})`;
  }
  // Same quarter
  const q = Math.floor(now.getMonth() / 3);
  const tq = Math.floor(target.getMonth() / 3);
  if (target.getFullYear() === now.getFullYear() && tq === q) {
    return `This Quarter (${target.toLocaleDateString()})`;
  }
  if (target.getFullYear() === now.getFullYear()) {
    return `This Year (${target.toLocaleDateString()})`;
  }
  return target.toLocaleDateString();
}

function computeTimeline(deal) {
  if (!deal.expectedCloseDate) return '';
  if (deal.stage === 'Won' || deal.stage === 'Completed' || deal.stage === 'Lost' || deal.stage === 'Closed Lost') return '';
  const target = new Date(deal.expectedCloseDate);
  if (isNaN(target)) return '';
  const days = Math.floor((Date.now() - target.getTime()) / (1000 * 60 * 60 * 24));
  if (days > 14) return 'Dead';
  if (days > 0) return 'Delayed';
  return 'On Schedule';
}

// ── BUCKET QUICK-PICK (sets the date) ──────────────────────────────────────
function applyBucketQuickPick(bucket) {
  const dateInput = document.getElementById('deal-expected-close');
  if (!dateInput) return;
  const now = new Date();
  let target;
  switch (bucket) {
    case 'this-week': {
      // End of this week (Friday)
      const day = now.getDay(); // 0 Sun..6 Sat
      const daysUntilFri = (5 - day + 7) % 7 || 7;
      target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilFri);
      break;
    }
    case 'this-month':
      target = new Date(now.getFullYear(), now.getMonth() + 1, 0); // last day of this month
      break;
    case 'next-month':
      target = new Date(now.getFullYear(), now.getMonth() + 2, 0); // last day of next month
      break;
    case 'this-quarter': {
      const q = Math.floor(now.getMonth() / 3);
      target = new Date(now.getFullYear(), q * 3 + 3, 0); // last day of quarter
      break;
    }
    case 'this-year':
      target = new Date(now.getFullYear(), 11, 31);
      break;
    case 'clear':
      dateInput.value = '';
      updateExpectedCloseBucketDisplay();
      scheduleSaveDeal();
      return;
    default: return;
  }
  dateInput.value = target.toISOString().slice(0, 10);
  updateExpectedCloseBucketDisplay();
  scheduleSaveDeal();
}

function updateExpectedCloseBucketDisplay() {
  const dateInput = document.getElementById('deal-expected-close');
  const span = document.getElementById('deal-expected-close-bucket');
  if (!dateInput || !span) return;
  span.textContent = dateInput.value ? '→ ' + formatExpectedCloseBucket(dateInput.value).split(' (')[0] : '';
}

// ── DEAL PANEL: extend openDealPanel for v3 fields ─────────────────────────
const _v2OpenDealPanel = typeof openDealPanel === 'function' ? openDealPanel : null;
if (_v2OpenDealPanel) {
  window.openDealPanel = function (id) {
    _v2OpenDealPanel(id);
    populateDealV3Fields(id);
  };
}

function populateDealV3Fields(id) {
  const d = allDeals.find(x => x.id === id);
  if (!d) return;
  const setVal = (eid, val) => { const el = document.getElementById(eid); if (el) el.value = val; };

  setVal('deal-last-contact',      d.lastContact ? d.lastContact.slice(0, 10) : '');
  setVal('deal-expected-close',    d.expectedCloseDate ? d.expectedCloseDate.slice(0, 10) : '');
  setVal('deal-timeline',          d.timeline || '');
  setVal('deal-diagnostic-fee',    d.diagnosticFee || '');
  setVal('deal-monthly-fee',       d.monthlyRecurringFee || '');
  setVal('deal-success-fee',       d.successFee != null ? (d.successFee > 1 ? d.successFee : d.successFee * 100) : '');
  setVal('deal-fee-notes',         d.feeNotes || '');
  setVal('deal-end-type',          d.endType || '');
  setVal('deal-contract-start',    d.contractStartDate ? d.contractStartDate.slice(0, 10) : '');
  setVal('deal-contract-end',      d.contractEndDate ? d.contractEndDate.slice(0, 10) : '');
  setVal('deal-notice-period',     d.noticePeriod || '');

  populateDealPartnerSelect();
  setVal('deal-partner', d.partnerId || '');
  updateExpectedCloseBucketDisplay();

  // Update Last Contact relative display
  const relSpan = document.getElementById('deal-last-contact-rel');
  if (relSpan) {
    if (d.lastContact) {
      const days = Math.floor((Date.now() - new Date(d.lastContact).getTime()) / (1000 * 60 * 60 * 24));
      relSpan.textContent = days <= 0 ? 'today' : `${days}d ago`;
    } else {
      relSpan.textContent = 'never';
    }
  }

  // Wire Call/Email/WhatsApp action buttons (must use .onclick — see Hard Rules)
  // Find primary contact for this opportunity's company
  const primary = allConsultingContacts.find(
    c => c.companyId === d.companyId && c.primary
  ) || allConsultingContacts.find(c => c.companyId === d.companyId);
  const phoneRaw = primary?.phone || '';
  const phone = phoneRaw.replace(/[^+\d]/g, '');
  const email = primary?.email || '';

  const callBtn  = document.getElementById('deal-call-btn');
  const emailBtn = document.getElementById('deal-email-btn');
  const waBtn    = document.getElementById('deal-whatsapp-btn');

  if (callBtn) {
    callBtn.href = phone ? `tel:${phone}` : '#';
    callBtn.onclick = phone ? () => stampLastContact(d.id, 'Call') : (e => e.preventDefault());
  }
  if (emailBtn) {
    emailBtn.href = email ? `mailto:${email}` : '#';
    emailBtn.onclick = email ? () => stampLastContact(d.id, 'Email') : (e => e.preventDefault());
  }
  if (waBtn) {
    waBtn.href = phone ? `https://wa.me/${phone.replace(/\D/g, '')}` : '#';
    waBtn.onclick = phone ? () => stampLastContact(d.id, 'WhatsApp') : (e => e.preventDefault());
  }
}

async function stampLastContact(dealId, channel) {
  // Fire-and-forget UX — don't block the user opening the link, but do it server-side
  try {
    const res = await fetch(`${CRM_API_BASE}/api/stamp-last-contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: dealId,
        password: currentPassword,
        channel,
        agent: currentAgent ? currentAgent.name : '',
      }),
    });
    if (res.ok) {
      const data = await res.json();
      // Update local state
      const deal = allDeals.find(d => d.id === dealId);
      if (deal) deal.lastContact = data.lastContact;
      if (currentDeal && currentDeal.id === dealId) {
        document.getElementById('deal-last-contact').value = data.lastContact || '';
        const relSpan = document.getElementById('deal-last-contact-rel');
        if (relSpan) relSpan.textContent = 'today';
      }
      if (currentView === 'opportunities') renderOpportunitiesTable();
    }
  } catch (err) {
    console.error('stamp-last-contact failed:', err);
  }
  // Don't preventDefault — let the href load (tel:, mailto:, wa.me)
}

// ── SAVE DEAL: extend with v3 fields ───────────────────────────────────────
const _v2SaveDealNow = typeof saveDealNow === 'function' ? saveDealNow : null;
if (_v2SaveDealNow) {
  window.saveDealNow = async function () {
    if (!currentDeal) return;
    // Replicate v2 save first (it patches the basic fields)
    const id = currentDeal.id;
    const services = Array.from(
      document.querySelectorAll('#deal-service-type input[type="checkbox"]:checked')
    ).map(cb => cb.value);

    // Read v3 fields
    const successPct = document.getElementById('deal-success-fee').value;
    const fields = {
      dealName:    document.getElementById('deal-name').value.trim(),
      stage:       document.getElementById('deal-stage').value,
      serviceType: services,
      dealValue:   Number(document.getElementById('deal-value').value) || 0,
      probability: Number(document.getElementById('deal-probability').value) || 0,
      owner:       document.getElementById('deal-owner').value,
      startedAt:   document.getElementById('deal-started-at').value || null,
      description: document.getElementById('deal-description').value,

      // v3
      lastContact:         document.getElementById('deal-last-contact').value || null,
      expectedCloseDate:   document.getElementById('deal-expected-close').value || null,
      partnerId:           document.getElementById('deal-partner').value || '',
      timeline:            document.getElementById('deal-timeline').value || null,
      diagnosticFee:       Number(document.getElementById('deal-diagnostic-fee').value) || 0,
      monthlyRecurringFee: Number(document.getElementById('deal-monthly-fee').value) || 0,
      successFee:          successPct === '' ? null : Number(successPct),
      feeNotes:            document.getElementById('deal-fee-notes').value,
      contractStartDate:   document.getElementById('deal-contract-start').value || null,
      endType:             document.getElementById('deal-end-type').value || null,
      contractEndDate:     document.getElementById('deal-contract-end').value || null,
      noticePeriod:        document.getElementById('deal-notice-period').value,
    };

    const status = document.getElementById('deal-save-status');
    try {
      const res = await fetch(`${CRM_API_BASE}/api/update-consulting-deal`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id, password: currentPassword,
          agent: currentAgent ? currentAgent.name : '',
          ...fields,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (status) { status.textContent = `Save failed: ${err.error || res.status}`; status.style.color = '#b91c1c'; }
        return;
      }
      Object.assign(currentDeal, fields);
      const cached = allDeals.find(d => d.id === id);
      if (cached) Object.assign(cached, fields);
      document.getElementById('deal-panel-name').textContent = fields.dealName || '—';
      if (currentView === 'pipeline') renderPipeline();
      if (currentView === 'clients')  renderClients();
      if (currentView === 'opportunities') renderOpportunitiesTable();
      if (status) { status.textContent = 'Saved'; status.style.color = '#16a34a'; }
      setTimeout(() => { if (status && status.textContent === 'Saved') status.textContent = ''; }, 1500);
      updateExpectedCloseBucketDisplay();
    } catch (err) {
      if (status) { status.textContent = 'Save error'; status.style.color = '#b91c1c'; }
    }
  };
}

// ── WIRE V3 EVENTS ─────────────────────────────────────────────────────────
function wireConsultingV3Events() {
  // Promote
  document.getElementById('client-promote-btn')?.addEventListener('click', promoteToClient);

  // Add Contact button
  document.getElementById('company-add-contact-btn')?.addEventListener('click', () => {
    if (currentClient) openNewContactModal(currentClient.id);
  });

  // Add Note button (company panel)
  document.getElementById('client-add-note-toggle')?.addEventListener('click', () => {
    const form = document.getElementById('client-new-note-form');
    if (!form) return;
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
    if (form.style.display === 'block') {
      document.getElementById('client-new-note-text')?.focus();
    }
  });
  document.getElementById('client-save-new-note')?.addEventListener('click', saveNewClientNote);
  document.getElementById('client-cancel-new-note')?.addEventListener('click', () => {
    const form = document.getElementById('client-new-note-form');
    const input = document.getElementById('client-new-note-text');
    if (form) form.style.display = 'none';
    if (input) input.value = '';
  });

  // New Contact modal
  document.getElementById('new-contact-close')?.addEventListener('click', closeNewContactModal);
  document.getElementById('new-contact-create')?.addEventListener('click', submitNewContact);

  // New Partner modal + view
  document.getElementById('add-partner-btn')?.addEventListener('click', openNewPartnerModal);
  document.getElementById('refresh-partners-btn')?.addEventListener('click', loadConsultingPartners);
  document.getElementById('new-partner-close')?.addEventListener('click', closeNewPartnerModal);
  document.getElementById('new-partner-create')?.addEventListener('click', submitNewPartner);

  // Opportunities flat-table
  document.getElementById('opp-stage-filter')?.addEventListener('change', renderOpportunitiesTable);
  document.getElementById('opp-owner-filter')?.addEventListener('change', renderOpportunitiesTable);
  document.getElementById('opp-search')?.addEventListener('input', renderOpportunitiesTable);
  document.getElementById('refresh-opps-btn')?.addEventListener('click', loadDeals);
  document.getElementById('add-opp-btn')?.addEventListener('click', () => {
    if (typeof openNewDealModal === 'function') openNewDealModal();
  });

  // Deal panel new fields auto-save
  [
    'deal-last-contact','deal-expected-close','deal-timeline','deal-partner',
    'deal-diagnostic-fee','deal-monthly-fee','deal-success-fee','deal-fee-notes',
    'deal-end-type','deal-contract-start','deal-contract-end','deal-notice-period',
  ].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const evt = (el.tagName === 'SELECT' || el.type === 'date') ? 'change' : 'input';
    el.addEventListener(evt, scheduleSaveDeal);
    el.addEventListener('blur', scheduleSaveDeal);
  });

  // Bucket quick-pick
  document.querySelectorAll('.bucket-quickpick button').forEach(b => {
    b.addEventListener('click', () => applyBucketQuickPick(b.dataset.bucket));
  });
  document.getElementById('deal-expected-close')?.addEventListener('change', updateExpectedCloseBucketDisplay);

  // Esc closes contact/partner modals too
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('new-contact-modal')?.style.display === 'flex') closeNewContactModal();
    else if (document.getElementById('new-partner-modal')?.style.display === 'flex') closeNewPartnerModal();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireConsultingV3Events);
} else {
  wireConsultingV3Events();
}

// ── RESYNC EMAIL INBOX (manual re-scan of last 24h) ────────────────────────
async function resyncEmailInbox() {
  const btn = document.getElementById('resync-email-btn');
  if (!btn) return;
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Scanning…';
  try {
    // The cron endpoint requires CRON_SECRET. Use a proxy via the CRM password:
    // we can hit /api/cron/process-emails directly with Bearer if Kevin passes a token.
    // For now, send a request that goes through our standard auth (?password=).
    // The cron endpoint accepts Bearer CRON_SECRET — we don't expose that to the
    // browser. So instead we route through a small proxy on the server side.
    const res = await fetch(`${CRM_API_BASE}/api/agent-trigger-resync?password=${encodeURIComponent(currentPassword)}&since=1d`, {
      method: 'POST',
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      alert(`Resync failed (HTTP ${res.status}). ${errBody.slice(0, 200)}`);
      return;
    }
    const data = await res.json().catch(() => ({}));
    const r = data.results || {};
    alert(`Resync complete:\n• Scanned: ${r.messagesScanned ?? '?'}\n• Matched: ${r.matched ?? '?'}\n• Unmatched: ${r.unmatched ?? '?'}\n• Writes: ${r.writes ?? '?'}\n• Errors: ${r.errors ?? '?'}\nCheck Slack #crm-updates for details.`);
  } catch (err) {
    alert('Resync error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

// ── LISTINGS (Rosa's MLS listings + per-listing notes) ─────────────────────
let allListings = [];
let activeListing = null;

async function loadListings() {
  const grid = document.getElementById('listings-grid');
  const countLabel = document.getElementById('listings-count-label');
  if (!grid) return;
  grid.innerHTML = '<p style="color:#9ca3af;padding:2rem;text-align:center;">Loading listings…</p>';
  try {
    const res = await fetch(`${CRM_API_BASE}/api/list-rosa-listings?password=${encodeURIComponent(currentPassword)}`);
    if (!res.ok) {
      grid.innerHTML = `<p style="color:#dc2626;padding:2rem;">Failed to load listings (HTTP ${res.status}).</p>`;
      return;
    }
    const data = await res.json();
    allListings = data.listings || [];
    if (countLabel) countLabel.textContent = `(${allListings.length})`;
    renderListings();
  } catch (err) {
    grid.innerHTML = `<p style="color:#dc2626;padding:2rem;">Error: ${escHtml(err.message)}</p>`;
  }
}

function renderListings() {
  const grid = document.getElementById('listings-grid');
  if (!grid) return;
  if (allListings.length === 0) {
    grid.innerHTML = '<p style="color:#9ca3af;padding:2rem;text-align:center;">No active listings.</p>';
    return;
  }
  grid.innerHTML = allListings.map(l => {
    const priceStr = l.price ? '$' + Number(l.price).toLocaleString() : '—';
    const photoStyle = l.photo ? `style="background-image:url('${escHtml(l.photo)}')"` : '';
    return `<div class="listing-card" data-mls="${escHtml(l.mlsId)}" onclick="openListingPanel('${escHtml(l.mlsId)}')">
      <div class="listing-card-photo" ${photoStyle}></div>
      <div class="listing-card-body">
        <div class="listing-card-price">${priceStr}</div>
        <div class="listing-card-addr">${escHtml(l.address || '—')}${l.city ? ', ' + escHtml(l.city) : ''}</div>
        <div class="listing-card-meta">
          ${l.propertyType ? `<span class="listing-card-badge">${escHtml(l.propertyType)}</span>` : ''}
          ${l.beds ? `<span class="listing-card-badge">${l.beds} bd</span>` : ''}
          ${l.baths ? `<span class="listing-card-badge">${l.baths} ba</span>` : ''}
          ${l.sqft ? `<span class="listing-card-badge">${Number(l.sqft).toLocaleString()} sqft</span>` : ''}
        </div>
        <div class="listing-card-mls">MLS# ${escHtml(l.mlsId)}</div>
      </div>
    </div>`;
  }).join('');
}

function openListingPanel(mlsId) {
  const l = allListings.find(x => String(x.mlsId) === String(mlsId));
  if (!l) return;
  activeListing = l;
  const priceStr = l.price ? '$' + Number(l.price).toLocaleString() : '—';
  document.getElementById('listing-panel-name').textContent = (l.address || 'Listing') + (l.city ? ', ' + l.city : '');
  document.getElementById('listing-panel-mls').textContent = l.mlsId || '—';
  document.getElementById('listing-panel-price').textContent = priceStr;
  document.getElementById('listing-panel-specs').textContent =
    [l.propertyType || '', l.beds ? `${l.beds} bd` : '', l.baths ? `${l.baths} ba` : '', l.sqft ? `${Number(l.sqft).toLocaleString()} sqft` : '']
      .filter(Boolean).join(' • ') || '—';
  document.getElementById('listing-panel-desc').textContent = l.description || '—';
  const urlEl = document.getElementById('listing-panel-url');
  if (urlEl) urlEl.href = l.url || '#';
  // Reset add-note form
  const form = document.getElementById('listing-new-note-form');
  const input = document.getElementById('listing-new-note-text');
  if (form) form.style.display = 'none';
  if (input) input.value = '';
  // Buyer leads tied to this listing (Source URL = "buyer:<MLS#>")
  renderListingBuyerLeads(l.mlsId);
  // Load notes
  loadListingNotes(l.mlsId).catch(err => console.error('loadListingNotes:', err));
  document.getElementById('listing-panel').classList.add('open');
}

function closeListingPanel() {
  document.getElementById('listing-panel')?.classList.remove('open');
  activeListing = null;
}

// Buyer leads for a listing — full lead records tagged sourceUrl "buyer:<MLS#>".
// They render here (and only here); the dashboard/table/stats/export skip them.
function renderListingBuyerLeads(mlsId) {
  const container = document.getElementById('listing-buyer-leads');
  const countEl   = document.getElementById('listing-buyer-count');
  if (!container) return;
  const buyers = allLeads.filter(l => (l.sourceUrl || '') === `buyer:${mlsId}`);
  if (countEl) countEl.textContent = buyers.length ? `(${buyers.length})` : '';
  if (!buyers.length) {
    container.innerHTML = '<p class="panel-empty-text">No buyer leads yet.</p>';
    return;
  }
  const statusOrder = { 'Hot': 0, 'Appointment Set': 1, 'Warm': 2, 'Contacted': 3, 'New': 4, 'Under Contract': 5, 'Closed': 6, 'Dead': 7 };
  buyers.sort((a, b) => (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4));
  container.innerHTML = buyers.map(b => {
    const phone = b.phone ? `<a href="tel:${escHtml(b.phone)}" style="color:#3b82f6;text-decoration:none;">${escHtml(b.phone)}</a>` : '';
    const email = b.email ? `<a href="mailto:${escHtml(b.email)}" style="color:#3b82f6;text-decoration:none;">${escHtml(b.email)}</a>` : '';
    const meta  = [phone, email, b.country ? escHtml(b.country) : ''].filter(Boolean).join(' · ');
    return `<div class="listing-buyer-row" onclick="openPanel('${escHtml(b.id)}')"
      style="padding:8px 10px;border:1px solid rgba(0,0,0,0.07);border-radius:8px;margin-bottom:6px;cursor:pointer;background:#fff;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <strong style="font-size:0.85rem;">${escHtml(b.name || '—')}</strong>
        <span class="status-badge status-${escHtml((b.status || 'New').replace(/\s+/g, '-'))}" style="font-size:0.68rem;">${escHtml(b.status || 'New')}</span>
      </div>
      <div style="font-size:0.76rem;color:#6b7280;margin-top:2px;">${meta || '—'}</div>
    </div>`;
  }).join('');
}

async function loadListingNotes(mlsId) {
  const container = document.getElementById('listing-notes-list');
  if (!container) return;
  container.innerHTML = '<p class="panel-empty-text">Loading notes…</p>';
  try {
    const res = await fetch(`${CRM_API_BASE}/api/get-listing-notes?password=${encodeURIComponent(currentPassword)}&mlsId=${encodeURIComponent(mlsId)}`);
    if (!res.ok) {
      container.innerHTML = `<p class="panel-empty-text" style="color:#dc2626;">Failed (HTTP ${res.status})</p>`;
      return;
    }
    const data = await res.json();
    const notes = data.notes || [];
    if (notes.length === 0) {
      container.innerHTML = '<p class="panel-empty-text">No notes yet. Click + Add Note to create one.</p>';
      return;
    }
    container.innerHTML = notes.map(n => {
      const date = n.createdAt ? new Date(n.createdAt) : null;
      const dateStr = date ? date.toLocaleString('en-US', {
        month: 'numeric', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      }) : '';
      const typeIcon = n.type === 'Email Logged' ? '✉️' : n.type === 'Showing' ? '👀' : n.type === 'Offer' ? '💰' : '📝';
      return `<div class="note-card">
        <div class="note-header">
          <span class="note-author">${typeIcon} ${escHtml(n.agent || '')}</span>
          <span class="note-date">${escHtml(dateStr)}</span>
        </div>
        <div class="note-body" style="white-space:pre-wrap;">${escHtml(n.details || n.title || '')}</div>
        <div class="note-actions">
          <button class="note-delete-btn" onclick="deleteListingNote('${escHtml(n.id)}')">Delete</button>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = `<p class="panel-empty-text" style="color:#dc2626;">Error: ${escHtml(err.message)}</p>`;
  }
}

async function saveNewListingNote() {
  if (!activeListing) return;
  const input = document.getElementById('listing-new-note-text');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  try {
    const res = await fetch(`${CRM_API_BASE}/api/save-listing-note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: currentPassword,
        mlsId: activeListing.mlsId,
        listingTitle: (activeListing.address || '') + (activeListing.city ? ', ' + activeListing.city : ''),
        type: 'Note',
        details: text,
        agent: (currentAgent ? currentAgent.name : 'Kevin'),
      }),
    });
    if (!res.ok) {
      alert('Save failed: ' + res.status);
      return;
    }
    input.value = '';
    document.getElementById('listing-new-note-form').style.display = 'none';
    await loadListingNotes(activeListing.mlsId);
  } catch (err) {
    alert('Save error: ' + err.message);
  }
}

async function deleteListingNote(id) {
  if (!id || !confirm('Delete this listing note?')) return;
  try {
    const res = await fetch(`${CRM_API_BASE}/api/save-listing-note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: currentPassword, id, _delete: true }),
    });
    if (!res.ok) {
      alert('Delete failed: ' + res.status);
      return;
    }
    if (activeListing) await loadListingNotes(activeListing.mlsId);
  } catch (err) {
    alert('Delete error: ' + err.message);
  }
}

function wireListingEvents() {
  document.getElementById('refresh-listings-btn')?.addEventListener('click', loadListings);
  document.getElementById('listing-panel-close')?.addEventListener('click', closeListingPanel);
  document.getElementById('listing-add-note-toggle')?.addEventListener('click', () => {
    const form = document.getElementById('listing-new-note-form');
    if (!form) return;
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
    if (form.style.display === 'block') document.getElementById('listing-new-note-text')?.focus();
  });
  document.getElementById('listing-save-new-note')?.addEventListener('click', saveNewListingNote);
  document.getElementById('listing-cancel-new-note')?.addEventListener('click', () => {
    const form = document.getElementById('listing-new-note-form');
    const input = document.getElementById('listing-new-note-text');
    if (form) form.style.display = 'none';
    if (input) input.value = '';
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireListingEvents);
} else {
  wireListingEvents();
}

// ══════════════════════════════════════════════════════════════════════════
// LEAD GENERATION (added 2026-09-10)
// Every outreach prospect who REPLIED — any sentiment except auto/OOO/bounce.
// Kevin: real-estate leads stay in the Real Estate dashboard; consulting-client
// outreach (Plaza San Miguel / Mara-CSC) goes to Consulting; everything else
// (cold email incl. Keystone, Facebook, LinkedIn) lands here.
// Backend: api/get-leadgen-leads, update-leadgen-lead, log-leadgen-activity,
// get-leadgen-activity, agent/leadgen-reply (the ingest hook).
// ══════════════════════════════════════════════════════════════════════════
const LG_STAGES     = ['New', 'Contacted', 'Meeting Booked', 'Won', 'Lost'];
const LG_SENTIMENTS = ['Positive', 'Question', 'Neutral', 'Not Now', 'Negative'];
let allLGLeads   = [];
let currentLGLead = null;
let lgSaveTimers = {};   // one debounce timer PER field — a shared timer would cancel another field's pending single-field PATCH

function lgAuthQS() { return `password=${encodeURIComponent(currentPassword)}`; }
function lgCss(v)   { return String(v || '').replace(/\s+/g, '-'); }
function lgFmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}
function lgSentimentChip(s) {
  return s
    ? `<span class="sent-chip sent-${lgCss(s)}">${escHtml(s)}</span>`
    : `<span class="sent-chip sent-none">—</span>`;
}
function lgChannelIcon(c) {
  return { Email: '✉️', Facebook: '📘', LinkedIn: '💼', WhatsApp: '💬', LoopNet: '🏢', Manual: '✍️' }[c] || '•';
}

// ── LOAD ───────────────────────────────────────────────────────────────────
async function loadLGLeads() {
  if (!currentPassword) return;
  const loading = document.getElementById('lg-loading');
  const table   = document.getElementById('lg-table');
  const empty   = document.getElementById('lg-empty');
  if (loading && !allLGLeads.length) loading.style.display = 'block';
  if (table && !allLGLeads.length)   table.style.display = 'none';
  if (empty) empty.style.display = 'none';
  try {
    const res = await fetch(`${CRM_API_BASE}/api/get-leadgen-leads?${lgAuthQS()}`);
    if (res.ok) {
      const data = await res.json();
      allLGLeads = data.leads || [];
    } else {
      console.error('Failed to load lead-gen leads:', res.status);
    }
  } catch (err) {
    console.error('Failed to load lead-gen leads:', err);
  }
  if (loading) loading.style.display = 'none';
  populateLGCampaignFilters();
  updateLGStats();
  updateLGBadge();
  if (currentView === 'leadgen') renderLGLeads();
  if (currentView === 'leadgen-pipeline') renderLGPipeline();
}

function populateLGCampaignFilters() {
  const campaigns = [...new Set(allLGLeads.map(l => l.campaign).filter(Boolean))].sort();
  ['lg-campaign-filter', 'lg-pipeline-campaign-filter'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">All Campaigns</option>' +
      campaigns.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
    if (campaigns.includes(cur)) sel.value = cur;
  });
}

function updateLGStats() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('lg-stat-total',    allLGLeads.length);
  set('lg-stat-positive', allLGLeads.filter(l => l.sentiment === 'Positive').length);
  set('lg-stat-new',      allLGLeads.filter(l => (l.status || 'New') === 'New').length);
  set('lg-stat-meetings', allLGLeads.filter(l => l.status === 'Meeting Booked' || l.status === 'Won').length);
}

// Sidebar badge = untouched positive/question replies — the ones that need Kevin.
function updateLGBadge() {
  const badge = document.getElementById('leadgen-badge');
  if (!badge) return;
  const n = allLGLeads.filter(l => (l.status || 'New') === 'New' && (l.sentiment === 'Positive' || l.sentiment === 'Question')).length;
  badge.textContent = n;
  badge.style.display = n ? 'inline-block' : 'none';
}

// ── TABLE ──────────────────────────────────────────────────────────────────
function lgFilterLeads(prefix) {
  const g = id => document.getElementById(id)?.value || '';
  const channel   = g(`${prefix}channel-filter`);
  const campaign  = g(`${prefix}campaign-filter`);
  const sentiment = prefix === 'lg-' ? g('lg-sentiment-filter') : '';
  const status    = prefix === 'lg-' ? g('lg-status-filter') : '';
  const q         = prefix === 'lg-' ? g('lg-search').trim().toLowerCase() : '';
  return allLGLeads.filter(l => {
    if (channel   && l.channel   !== channel)   return false;
    if (campaign  && l.campaign  !== campaign)  return false;
    if (sentiment && l.sentiment !== sentiment) return false;
    if (status    && (l.status || 'New') !== status) return false;
    if (q) {
      const hay = `${l.name} ${l.company} ${l.email} ${l.campaign} ${l.summary}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderLGLeads() {
  const tbody = document.getElementById('lg-tbody');
  const table = document.getElementById('lg-table');
  const empty = document.getElementById('lg-empty');
  const label = document.getElementById('leadgen-count-label');
  if (!tbody) return;

  const rows = lgFilterLeads('lg-').sort((a, b) =>
    new Date(b.lastReplyAt || b.replyAt || 0) - new Date(a.lastReplyAt || a.replyAt || 0));

  if (label) { label.textContent = `${rows.length} of ${allLGLeads.length}`; label.style.display = 'inline-block'; }
  if (!rows.length) {
    if (table) table.style.display = 'none';
    if (empty) { empty.style.display = 'block'; empty.textContent = allLGLeads.length ? 'No replies match these filters.' : 'No replies yet.'; }
    return;
  }
  if (table) table.style.display = 'table';
  if (empty) empty.style.display = 'none';

  tbody.innerHTML = rows.map(l => {
    const sub = [l.company, l.email, l.phone].filter(Boolean).join(' · ');
    const stageOpts = LG_STAGES.map(s => `<option value="${s}"${(l.status || 'New') === s ? ' selected' : ''}>${s}</option>`).join('');
    const summary = l.summary || l.replySnippet || l.firstReply || '';
    return `
      <tr data-lg-id="${escHtml(l.id)}">
        <td>
          <div style="font-weight:600;color:var(--navy,#1a2744);">${escHtml(l.name || l.email || '—')}</div>
          <div class="lg-contact-sub">${escHtml(sub)}</div>
        </td>
        <td><span class="lg-channel">${lgChannelIcon(l.channel)} ${escHtml(l.channel || '—')}</span></td>
        <td>${l.campaign ? `<span class="lg-campaign">${escHtml(l.campaign)}</span>` : '—'}</td>
        <td>${lgSentimentChip(l.sentiment)}</td>
        <td><select class="lg-stage-select" data-lg-id="${escHtml(l.id)}">${stageOpts}</select></td>
        <td style="white-space:nowrap;">${lgFmtDate(l.lastReplyAt || l.replyAt)}${l.replyCount > 1 ? ` <span class="lg-contact-sub">×${l.replyCount}</span>` : ''}</td>
        <td class="lg-summary-cell">${escHtml(summary.length > 220 ? summary.slice(0, 217) + '…' : summary)}</td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('tr[data-lg-id]').forEach(tr => {
    tr.addEventListener('click', e => {
      if (e.target.closest('select')) return;
      openLGPanel(tr.dataset.lgId);
    });
  });
  tbody.querySelectorAll('.lg-stage-select').forEach(sel => {
    sel.addEventListener('click', e => e.stopPropagation());
    sel.addEventListener('change', () => updateLGStatus(sel.dataset.lgId, sel.value));
  });
}

// ── PIPELINE (KANBAN) ──────────────────────────────────────────────────────
function renderLGPipeline() {
  const board = document.getElementById('lg-kanban-board');
  if (!board) return;
  const rows = lgFilterLeads('lg-pipeline-');
  const label = document.getElementById('lg-pipeline-count-label');
  if (label) {
    const open = rows.filter(l => l.status !== 'Won' && l.status !== 'Lost').length;
    label.textContent = `${open} open · ${rows.filter(l => l.status === 'Won').length} won · ${rows.filter(l => l.status === 'Lost').length} lost`;
    label.style.display = 'inline-block';
  }

  board.innerHTML = LG_STAGES.map(stage => {
    const inStage = rows.filter(l => (l.status || 'New') === stage)
      .sort((a, b) => new Date(b.lastReplyAt || b.replyAt || 0) - new Date(a.lastReplyAt || a.replyAt || 0));
    const cards = inStage.map(l => `
      <div class="kanban-card lg-card lg-${lgCss(l.sentiment)}" draggable="true" data-lg-id="${escHtml(l.id)}">
        <div class="kanban-card-name">${escHtml(l.name || l.email || '—')}</div>
        <div class="kanban-card-company">${escHtml(l.company || '')}</div>
        <div class="lg-card-summary">${escHtml(l.summary || l.replySnippet || '')}</div>
        <div class="kanban-card-footer">
          <span class="kanban-card-meta">${lgChannelIcon(l.channel)} ${escHtml(l.campaign || l.channel || '')}</span>
          <span class="kanban-card-meta">${lgFmtDate(l.lastReplyAt || l.replyAt)}</span>
        </div>
      </div>`).join('');
    return `
      <div class="kanban-column" data-lg-stage="${escHtml(stage)}">
        <div class="kanban-column-header">
          <span>${escHtml(stage)}</span>
          <span class="kanban-column-count">${inStage.length}</span>
        </div>
        <div class="kanban-cards lg-zone" data-lg-stage="${escHtml(stage)}">
          ${cards || '<div style="font-size:.7rem;color:#94a3b8;padding:8px;text-align:center;">drop here</div>'}
        </div>
      </div>`;
  }).join('');

  wireLGKanban();
}

function wireLGKanban() {
  const board = document.getElementById('lg-kanban-board');
  if (!board) return;
  board.querySelectorAll('.kanban-card[data-lg-id]').forEach(card => {
    card.addEventListener('dragstart', e => {
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      // Own mime type: the consulting board's wireKanbanInteractions() also binds
      // to every .kanban-card on the page and overwrites text/plain with its deal id.
      e.dataTransfer.setData('text/lg-id', card.dataset.lgId);
      e.dataTransfer.setData('text/plain', 'lg:' + card.dataset.lgId);
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('click', () => openLGPanel(card.dataset.lgId));
  });
  board.querySelectorAll('.lg-zone').forEach(zone => {
    zone.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; zone.classList.add('drop-target'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drop-target'));
    zone.addEventListener('drop', async e => {
      e.preventDefault();
      zone.classList.remove('drop-target');
      const id = e.dataTransfer.getData('text/lg-id');
      if (!id) return;
      const stage = zone.dataset.lgStage;
      const lead = allLGLeads.find(l => l.id === id);
      if (!lead || !stage || (lead.status || 'New') === stage) return;
      await updateLGStatus(id, stage);
    });
  });
}

// ── UPDATES ────────────────────────────────────────────────────────────────
async function lgPatch(id, fields) {
  const res = await fetch(`${CRM_API_BASE}/api/update-leadgen-lead`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, password: currentPassword, agent: currentAgent ? currentAgent.name : 'Kevin', ...fields }),
  });
  if (!res.ok) throw new Error(`update-leadgen-lead ${res.status}`);
  const data = await res.json();
  if (data.lead) {
    const i = allLGLeads.findIndex(l => l.id === id);
    if (i >= 0) allLGLeads[i] = data.lead;
    if (currentLGLead && currentLGLead.id === id) currentLGLead = data.lead;
  }
  return data;
}

async function updateLGStatus(id, status) {
  const lead = allLGLeads.find(l => l.id === id);
  if (!lead) return;
  const prev = lead.status;
  lead.status = status;                                   // optimistic
  updateLGStats(); updateLGBadge();
  if (currentView === 'leadgen-pipeline') renderLGPipeline();
  if (currentView === 'leadgen') renderLGLeads();
  try {
    await lgPatch(id, { status });
    if (currentLGLead && currentLGLead.id === id) setVal('lg-status', status);
    if (currentLGLead && currentLGLead.id === id) loadLGActivity(id);
  } catch (err) {
    console.error('Lead-gen stage update failed:', err);
    lead.status = prev;
    if (currentView === 'leadgen-pipeline') renderLGPipeline();
    if (currentView === 'leadgen') renderLGLeads();
  }
}

// ── PANEL ──────────────────────────────────────────────────────────────────
// Mirrors openPanel() for RE leads: display values + a ✏️ toggle for the
// editable identity fields, Flash coach slot 'lg', notes/activity from
// LeadGen Activity, reminders from LeadGen Tasks.
function lgWebsiteHref(url) {
  if (!url) return '';
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function renderLGContactDisplay(lead) {
  const co = document.getElementById('lg-company-line');
  if (co) co.textContent = [lead.company, lead.title].filter(Boolean).join(' · ') || '—';
  const web = document.getElementById('lg-website-line');
  if (web) {
    web.innerHTML = lead.website
      ? `<a href="${escHtml(lgWebsiteHref(lead.website))}" target="_blank" rel="noopener">${escHtml(lead.website)}</a>`
      : '—';
  }
  // Which of the KPS / personal mailboxes the outreach went out from (Kevin 2026-09-10).
  const from = document.getElementById('lg-contacted-from');
  if (from) from.textContent = lead.contactedFrom || '—';
  const src = document.getElementById('lg-source-line');
  if (src) src.textContent = `${lead.channel || '—'}${lead.campaign ? ` · ${lead.campaign}` : ''}${lead.sourceLeadId ? ` · ${lead.sourceLeadId}` : ''}`;
  const frd = document.getElementById('lg-first-reply-date');
  if (frd) frd.textContent = lead.replyAt ? lgFmtDate(lead.replyAt) : '—';
}

function openLGPanel(id) {
  const lead = allLGLeads.find(l => l.id === id);
  if (!lead) return;
  // Switching leads while the coach is live = the previous call ended.
  const coachFrame = document.getElementById('lg-coach-iframe');
  const coachOnThisLead = coachFrame && coachFrame.src &&
    coachFrame.src.indexOf('leadId=' + encodeURIComponent(id)) !== -1;
  if (!coachOnThisLead) finalizeCoachSection('lg');
  currentLGLead = lead;

  const avatar = document.getElementById('lg-avatar-text');
  if (avatar) avatar.textContent = (lead.name || lead.email || '?').charAt(0).toUpperCase();
  document.getElementById('lg-panel-name').textContent = lead.name || lead.email || '—';
  document.getElementById('lg-panel-sub').innerHTML =
    `${lgSentimentChip(lead.sentiment)} <span style="margin-left:6px;">${escHtml(lead.company || '')}</span>`;

  setVal('lg-status',    lead.status || 'New');
  setVal('lg-sentiment', lead.sentiment || '');
  setVal('lg-owner',     lead.owner || 'Kevin');
  setVal('lg-summary',   lead.summary || '');
  setVal('lg-name',      lead.name || '');
  setVal('lg-company',   lead.company || '');
  setVal('lg-title',     lead.title || '');
  setVal('lg-email',     lead.email || '');
  setVal('lg-phone',     lead.phone || '');
  setVal('lg-website',   lead.website || '');
  renderLGContactDisplay(lead);

  const rc = document.getElementById('lg-reply-count');
  if (rc) rc.textContent = lead.replyCount ? `· ${lead.replyCount} repl${lead.replyCount === 1 ? 'y' : 'ies'}` : '';
  const fr = document.getElementById('lg-first-reply');
  if (fr) fr.textContent = lead.firstReply || lead.replySnippet || '—';

  // Quick actions
  const call = document.getElementById('lg-call');
  const mail = document.getElementById('lg-email-action');
  const wa   = document.getElementById('lg-whatsapp');
  const digits = (lead.phone || '').replace(/[^\d]/g, '');
  if (call) { call.href = lead.phone ? `tel:${lead.phone}` : '#'; call.style.opacity = lead.phone ? '1' : '.4'; }
  if (mail) { mail.href = lead.email ? `mailto:${lead.email}` : '#'; mail.style.opacity = lead.email ? '1' : '.4'; }
  if (wa)   { wa.href = digits ? `https://wa.me/${digits}` : '#'; wa.style.opacity = digits ? '1' : '.4'; }

  const st = document.getElementById('lg-save-status'); if (st) st.textContent = '';
  const edit = document.getElementById('lg-contact-edit'); if (edit) edit.style.display = 'none';
  const nn = document.getElementById('lg-new-note-text'); if (nn) nn.value = '';
  const ns = document.getElementById('lg-new-note-status'); if (ns) ns.textContent = '';
  const rs = document.getElementById('lg-reminder-status'); if (rs) rs.textContent = '';
  const rn = document.getElementById('lg-reminder-note'); if (rn) rn.value = '';
  const rd = document.getElementById('lg-reminder-due'); if (rd) rd.value = '';
  const coachBtn = document.getElementById('lg-coach-start');
  if (coachBtn) coachBtn.onclick = () => openFlashCoach(lead, 'lg');

  loadLGActivity(id);
  renderLGLeadReminders(lead);
  if (!allLGTasks.length) loadLGTasks();
  document.getElementById('leadgen-panel').classList.add('open');
  const overlay = document.getElementById('panel-overlay');
  if (overlay) overlay.style.display = 'block';
}

function closeLGPanel() {
  const panel = document.getElementById('leadgen-panel');
  if (!panel) return;
  panel.classList.remove('open');
  panel.classList.remove('panel-expanded');
  const overlay = document.getElementById('panel-overlay');
  if (overlay) overlay.style.display = 'none';
  finalizeCoachSection('lg'); // closing = call ended (same rule as the RE panel)
  currentLGLead = null;
}

// Notes (type Note) render under "My Notes"; everything else under "Activity Log".
async function loadLGActivity(id) {
  const notesBox = document.getElementById('lg-notes-history');
  const actBox   = document.getElementById('lg-activity-list');
  if (!notesBox || !actBox) return;
  notesBox.innerHTML = '<p class="panel-empty-text">Loading…</p>';
  actBox.innerHTML   = '<p class="panel-empty-text">Loading activity...</p>';
  try {
    const res = await fetch(`${CRM_API_BASE}/api/get-leadgen-activity?leadId=${encodeURIComponent(id)}&${lgAuthQS()}`);
    const data = res.ok ? await res.json() : { activity: [] };
    const items = (data.activity || []).sort((a, b) => new Date(b.at) - new Date(a.at));
    if (!currentLGLead || currentLGLead.id !== id) return;
    const notes = items.filter(a => a.type === 'Note');
    const rest  = items.filter(a => a.type !== 'Note');

    notesBox.innerHTML = notes.length ? notes.map(a => `
      <div class="note-card">
        <div class="note-header">
          <span class="note-author">${escHtml(a.agent || 'Kevin')}</span>
          <span class="note-date">${escHtml(lgFmtDateTime(a.at))}</span>
        </div>
        <div class="note-body">${escHtml(a.details || a.title || '')}</div>
      </div>`).join('') : '<p class="panel-empty-text">No notes yet</p>';

    const icon = t => ({ 'Positive Reply': '🟢', 'Reply': '💬', 'Email Sent': '✉️', 'Call': '📞', 'Meeting': '🤝', 'Status Change': '🔀' }[t] || '📄');
    actBox.innerHTML = rest.length ? rest.map(a => `
      <div class="activity-item">
        <span class="activity-icon">${icon(a.type)}</span>
        <div class="activity-info">
          <span class="activity-type">${escHtml(a.title || a.type || 'Activity')}</span>
          ${a.details ? `<span class="activity-detail" style="white-space:pre-wrap;">${escHtml(a.details)}</span>` : ''}
        </div>
        <span class="activity-time" title="${escHtml(a.at || '')}">${escHtml(a.at ? relativeTime(a.at) : '')}</span>
      </div>`).join('') : '<p class="panel-empty-text">No activity yet</p>';
  } catch (err) {
    notesBox.innerHTML = '<p class="panel-empty-text">Could not load notes</p>';
    actBox.innerHTML   = '<p class="panel-empty-text">Could not load activity</p>';
  }
}

function lgFmtDateTime(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return '';
  return d.toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

async function saveLGNote() {
  if (!currentLGLead) return;
  const text = (document.getElementById('lg-new-note-text')?.value || '').trim();
  const status = document.getElementById('lg-new-note-status');
  if (!text) { if (status) status.textContent = 'Write a note first.'; return; }
  if (status) status.textContent = 'Saving…';
  try {
    const res = await fetch(`${CRM_API_BASE}/api/log-leadgen-activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: currentPassword, leadId: currentLGLead.id, title: text.slice(0, 80),
        type: 'Note', details: text, agent: currentAgent ? currentAgent.name : 'Kevin', stampContact: true,
      }),
    });
    if (!res.ok) throw new Error(res.status);
    document.getElementById('lg-new-note-text').value = '';
    if (status) { status.textContent = 'Saved'; setTimeout(() => { if (status.textContent === 'Saved') status.textContent = ''; }, 1500); }
    loadLGActivity(currentLGLead.id);
  } catch (err) {
    if (status) status.textContent = 'Failed to save note.';
  }
}

// ── REMINDERS (LeadGen Tasks) ──────────────────────────────────────────────
// Same shape as the RE Reminders view/panel cards, backed by LeadGen Tasks:
// status Open = Pending, Done = Completed, Skipped = Cancelled.
let allLGTasks = [];

async function loadLGTasks() {
  if (!currentPassword) return;
  const loading = document.getElementById('lg-reminders-loading');
  if (loading && !allLGTasks.length && currentView === 'leadgen-reminders') loading.style.display = 'block';
  try {
    const res = await fetch(`${CRM_API_BASE}/api/get-leadgen-tasks?${lgAuthQS()}`);
    if (res.ok) {
      const data = await res.json();
      allLGTasks = data.tasks || [];
    } else {
      console.error('Failed to load lead-gen tasks:', res.status);
    }
  } catch (err) {
    console.error('Failed to load lead-gen tasks:', err);
  }
  if (loading) loading.style.display = 'none';
  updateLGReminderBadge();
  if (currentView === 'leadgen-reminders') renderLGReminders();
  if (currentLGLead) renderLGLeadReminders(currentLGLead);
}

function updateLGReminderBadge() {
  const badge = document.getElementById('leadgen-reminder-badge');
  if (!badge) return;
  const now = Date.now();
  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
  const n = allLGTasks.filter(t => t.status === 'Open' && t.dueAt && new Date(t.dueAt).getTime() <= endOfToday.getTime()).length;
  badge.textContent = n;
  badge.style.display = n ? 'inline-block' : 'none';
  void now;
}

function lgTaskLead(t) {
  const id = (t.leadIds || [])[0];
  return id ? allLGLeads.find(l => l.id === id) : null;
}

function lgTaskDtLocal(d) {
  return d.getTime()
    ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
    : '';
}

function renderLGReminders() {
  const tbody   = document.getElementById('lg-reminders-tbody');
  const table   = document.getElementById('lg-reminders-table');
  const empty   = document.getElementById('lg-reminders-empty');
  const loading = document.getElementById('lg-reminders-loading');
  if (!tbody || !table) return;
  if (loading) loading.style.display = 'none';

  const filterStatus = document.getElementById('lg-reminder-status-filter')?.value || '';
  const filterOwner  = document.getElementById('lg-reminder-owner-filter')?.value || '';
  const rows = allLGTasks.filter(t => {
    if (filterStatus && t.status !== filterStatus) return false;
    // Blank-owner tasks (Flash follow-ups) stay visible under any selection — same rule as RE.
    if (filterOwner && t.owner && t.owner !== filterOwner) return false;
    return true;
  }).sort((a, b) => new Date(a.dueAt || 0) - new Date(b.dueAt || 0));

  const countLabel = document.getElementById('lg-reminders-count-label');
  if (countLabel) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfToday   = startOfToday + 24 * 60 * 60 * 1000;
    let dueToday = 0, overdue = 0;
    rows.forEach(t => {
      if (t.status !== 'Open') return;
      const due = t.dueAt ? new Date(t.dueAt).getTime() : NaN;
      if (isNaN(due)) return;
      if (due < startOfToday) overdue++; else if (due < endOfToday) dueToday++;
    });
    countLabel.textContent = `${rows.length} total · ${dueToday} due today · ${overdue} overdue · ${filterOwner || 'all agents'}`;
    countLabel.style.display = 'inline-block';
  }

  if (!rows.length) { table.style.display = 'none'; if (empty) empty.style.display = 'block'; return; }
  if (empty) empty.style.display = 'none';
  table.style.display = 'table';

  const now = Date.now();
  tbody.innerHTML = rows.map(t => {
    const lead = lgTaskLead(t);
    const dueDate = new Date(t.dueAt);
    const hasTime = /T\d{2}:\d{2}/.test(String(t.dueAt || ''));
    const isOverdue = t.status === 'Open' && dueDate.getTime() < now;
    const dueStr = !dueDate.getTime() ? '—'
      : hasTime ? formatReminderDate(dueDate)
      : dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    const statusBadge = t.status === 'Open'
      ? (isOverdue ? '<span class="reminder-status-badge overdue">Overdue</span>' : '<span class="reminder-status-badge pending">Pending</span>')
      : t.status === 'Done'
        ? '<span class="reminder-status-badge completed">Done</span>'
        : '<span class="reminder-status-badge cancelled">Cancelled</span>';
    const actionClass = 'action-type-' + (t.type || 'Other').replace(/\s+/g, '-');
    const actions = t.status === 'Open'
      ? `<button class="reminder-action-btn done" onclick="setLGTaskStatus('${t.id}','Done')">Done</button>
         <button class="reminder-action-btn cancel" onclick="setLGTaskStatus('${t.id}','Skipped')">Cancel</button>
         <button class="reminder-action-btn edit" onclick="toggleLGTaskEdit('${t.id}')">Edit</button>`
      : '';
    const ownerOptions = ['Kevin', 'Dylan', 'Rosa'].map(o => `<option value="${o}" ${o === t.owner ? 'selected' : ''}>${o}</option>`).join('');
    const leadName = lead ? (lead.name || lead.email || '—') : '—';
    const leadSub  = lead ? [lead.company, lead.phone].filter(Boolean).join(' · ') : '';
    const leadId   = lead ? lead.id : '';
    return `
    <tr class="${isOverdue ? 'reminder-overdue' : ''}">
      <td class="td-muted">
        <span id="lg-task-due-text-${t.id}">${escHtml(dueStr)}</span>
        <div id="lg-task-edit-${t.id}" class="reminder-edit-row" style="display:none;">
          <input type="datetime-local" id="lg-task-dt-${t.id}" class="reminder-dt-input" value="${lgTaskDtLocal(dueDate)}">
          <select id="lg-task-owner-${t.id}" class="reminder-dt-input" style="margin-top:4px">${ownerOptions}</select>
          <button class="reminder-action-btn done" style="margin-top:4px" onclick="saveLGTaskEdit('${t.id}')">Save</button>
        </div>
      </td>
      <td>
        <div class="lead-name" style="cursor:pointer" onclick="${leadId ? `openLGPanelFromReminder('${leadId}')` : ''}">${escHtml(leadName)}</div>
        <div class="td-muted" style="font-size:0.75rem">${escHtml(leadSub)}</div>
      </td>
      <td><span class="action-type-badge ${actionClass}">${escHtml(t.type || '—')}</span></td>
      <td class="td-muted" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(t.notes || t.title || '')}">${escHtml(t.notes || t.title || '—')}</td>
      <td class="td-muted">${escHtml(t.owner || '—')}</td>
      <td>${statusBadge}</td>
      <td>${actions}</td>
    </tr>`;
  }).join('');
}

function openLGPanelFromReminder(leadId) {
  if (!allLGLeads.find(l => l.id === leadId)) return;
  openLGPanel(leadId);
}

function toggleLGTaskEdit(id) {
  const row = document.getElementById(`lg-task-edit-${id}`);
  if (row) row.style.display = row.style.display === 'none' ? 'block' : 'none';
}

async function lgPatchTask(id, fields) {
  const res = await fetch(`${CRM_API_BASE}/api/update-leadgen-task`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, password: currentPassword, ...fields }),
  });
  if (!res.ok) throw new Error(`update-leadgen-task ${res.status}`);
  const data = await res.json();
  if (data.task) {
    const i = allLGTasks.findIndex(t => t.id === id);
    if (i >= 0) allLGTasks[i] = data.task;
  }
  return data;
}

async function setLGTaskStatus(id, status) {
  const t = allLGTasks.find(x => x.id === id);
  if (!t) return;
  const prev = t.status;
  t.status = status;                                        // optimistic
  updateLGReminderBadge();
  if (currentView === 'leadgen-reminders') renderLGReminders();
  if (currentLGLead) renderLGLeadReminders(currentLGLead);
  try {
    await lgPatchTask(id, { status });
  } catch (err) {
    console.error('Lead-gen task update failed:', err);
    t.status = prev;
    if (currentView === 'leadgen-reminders') renderLGReminders();
    if (currentLGLead) renderLGLeadReminders(currentLGLead);
  }
}

async function saveLGTaskEdit(id) {
  const dt    = document.getElementById(`lg-task-dt-${id}`)?.value;
  const owner = document.getElementById(`lg-task-owner-${id}`)?.value;
  if (!dt) return;
  try {
    await lgPatchTask(id, { dueAt: new Date(dt).toISOString(), owner });
    renderLGReminders();
    updateLGReminderBadge();
  } catch (err) {
    alert('Could not save the reminder: ' + err.message);
  }
}

// Panel cards — same markup as renderLeadReminders() for RE leads.
function renderLGLeadReminders(lead) {
  const section = document.getElementById('lg-existing-reminders-section');
  const container = document.getElementById('lg-existing-reminders');
  if (!section || !container || !lead) return;
  const tasks = allLGTasks
    .filter(t => t.status === 'Open' && (t.leadIds || []).includes(lead.id))
    .sort((a, b) => new Date(a.dueAt || 0) - new Date(b.dueAt || 0));
  if (!tasks.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  const now = new Date();
  container.innerHTML = tasks.map(t => {
    const dueDate = new Date(t.dueAt);
    const hasTime = /T\d{2}:\d{2}/.test(String(t.dueAt || ''));
    const isOverdue = dueDate.getTime() && dueDate < now;
    const dueStr = !dueDate.getTime() ? '—'
      : hasTime
        ? dueDate.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + dueDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return `
    <div class="panel-reminder-card ${isOverdue ? 'overdue' : ''}">
      <div class="panel-reminder-top">
        <span class="panel-reminder-type">${escHtml(t.type || 'Follow-up')}${t.owner ? ` · ${escHtml(t.owner)}` : ''}</span>
        <span class="panel-reminder-due ${isOverdue ? 'overdue' : ''}">${isOverdue ? '⚠️ ' : ''}${dueStr}</span>
      </div>
      ${(t.notes || t.title) ? `<div class="panel-reminder-note-text">${escHtml(t.notes || t.title)}</div>` : ''}
      <div class="panel-reminder-edit-row" id="lg-r-edit-${t.id}" style="display:none;">
        <input type="datetime-local" id="lg-r-dt-${t.id}" class="panel-input" value="${lgTaskDtLocal(dueDate)}" style="font-size:0.8rem;">
        <input type="text" id="lg-r-note-${t.id}" class="panel-input" value="${escHtml(t.notes || '')}" placeholder="Note..." style="font-size:0.8rem;margin-top:4px;">
      </div>
      <div class="panel-reminder-actions">
        <button class="panel-r-btn edit" onclick="toggleLGPanelReminderEdit('${t.id}')">Edit</button>
        <button class="panel-r-btn save" id="lg-r-save-${t.id}" style="display:none;" onclick="saveLGPanelReminder('${t.id}')">Save</button>
        <button class="panel-r-btn done" onclick="setLGTaskStatus('${t.id}','Done')">Done</button>
        <button class="panel-r-btn cancel" onclick="setLGTaskStatus('${t.id}','Skipped')">Cancel</button>
      </div>
    </div>`;
  }).join('');
}

function toggleLGPanelReminderEdit(id) {
  const row = document.getElementById(`lg-r-edit-${id}`);
  const save = document.getElementById(`lg-r-save-${id}`);
  const show = row && row.style.display === 'none';
  if (row) row.style.display = show ? 'block' : 'none';
  if (save) save.style.display = show ? 'inline-block' : 'none';
}

async function saveLGPanelReminder(id) {
  const dt   = document.getElementById(`lg-r-dt-${id}`)?.value;
  const note = document.getElementById(`lg-r-note-${id}`)?.value;
  if (!dt) return;
  try {
    await lgPatchTask(id, { dueAt: new Date(dt).toISOString(), notes: note || '' });
    if (currentLGLead) renderLGLeadReminders(currentLGLead);
    if (currentView === 'leadgen-reminders') renderLGReminders();
    updateLGReminderBadge();
  } catch (err) {
    alert('Could not save the reminder: ' + err.message);
  }
}

async function createLGReminderFromPanel() {
  if (!currentLGLead) return;
  const type  = document.getElementById('lg-reminder-action')?.value || 'Follow-up';
  const owner = document.getElementById('lg-reminder-agent')?.value || 'Kevin';
  const due   = document.getElementById('lg-reminder-due')?.value;
  const note  = (document.getElementById('lg-reminder-note')?.value || '').trim();
  const status = document.getElementById('lg-reminder-status');
  if (!due) { if (status) status.textContent = 'Pick a due date & time.'; return; }
  if (status) status.textContent = 'Creating…';
  const leadName = currentLGLead.name || currentLGLead.email || 'lead';
  try {
    const res = await fetch(`${CRM_API_BASE}/api/create-leadgen-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: currentPassword,
        leadId: currentLGLead.id,
        title: note ? note.slice(0, 80) : `${type} ${leadName}`,
        type, owner, notes: note,
        dueAt: new Date(due).toISOString(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.status);
    if (data.task) allLGTasks.push(data.task);
    document.getElementById('lg-reminder-note').value = '';
    document.getElementById('lg-reminder-due').value = '';
    if (status) { status.textContent = '✓ Reminder created'; setTimeout(() => { if (status.textContent === '✓ Reminder created') status.textContent = ''; }, 2000); }
    renderLGLeadReminders(currentLGLead);
    updateLGReminderBadge();
    if (currentView === 'leadgen-reminders') renderLGReminders();
  } catch (err) {
    if (status) status.textContent = 'Failed: ' + err.message;
  }
}

// ── FLASH → LEAD GEN ───────────────────────────────────────────────────────
// Flash's server (bucket=leadgen) already wrote the note, summary/next steps and
// the follow-up task. Recordings/transcripts land as activity rows here because
// save-recording only knows the RE Leads table. Then refresh whatever is open.
function isLGLeadId(id, bucket) {
  if (bucket === 'leadgen') return true;
  if (currentLGLead && currentLGLead.id === id) return true;
  return allLGLeads.some(l => l.id === id);
}

async function handleFlashMessageLG(data) {
  if (data.type === 'flash:recording' || data.type === 'flash:transcript') {
    if (!data.url) return;
    const isRec = data.type === 'flash:recording';
    try {
      await fetch(`${CRM_API_BASE}/api/log-leadgen-activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: currentPassword, leadId: data.leadId, type: 'Call', agent: 'Flash Coach',
          title: isRec ? 'Flash recording' : 'Flash transcript',
          details: `${isRec ? 'Recording' : 'Transcript'}${data.durationSec ? ` (${Math.round(data.durationSec / 60)} min)` : ''}: ${data.url}`,
          at: data.recordedAt || undefined,
        }),
      });
    } catch (e) { /* best-effort */ }
    if (currentLGLead && currentLGLead.id === data.leadId) loadLGActivity(data.leadId);
    return;
  }
  if (data.type !== 'flash:call-ended') return;
  // Note/reminder fallbacks when the server didn't write them (mirrors the RE path).
  if (data.note && !data.noteLogged) {
    try {
      await fetch(`${CRM_API_BASE}/api/log-leadgen-activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: currentPassword, leadId: data.leadId, type: 'Note', agent: 'Flash Coach', title: 'Flash Coach call', details: data.note, stampContact: true }),
      });
    } catch (e) { /* best-effort */ }
  }
  if (data.reminder && data.reminder.dueAt && !isNaN(Date.parse(data.reminder.dueAt)) && !data.reminderCreated) {
    try {
      await fetch(`${CRM_API_BASE}/api/create-leadgen-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: currentPassword, leadId: data.leadId, owner: 'Kevin',
          type: ['Call', 'Email', 'Meeting'].includes(data.reminder.actionType) ? data.reminder.actionType : 'Follow-up',
          title: String(data.reminder.note || 'Seguimiento post-llamada').slice(0, 80),
          notes: String(data.reminder.note || ''), dueAt: data.reminder.dueAt,
        }),
      });
    } catch (e) { /* best-effort */ }
  }
  try {
    await Promise.all([loadLGLeads(), loadLGTasks()]);
    if (currentLGLead && currentLGLead.id === data.leadId) {
      const fresh = allLGLeads.find(l => l.id === data.leadId);
      if (fresh) {
        currentLGLead = fresh;
        setVal('lg-status', fresh.status || 'New');
        setVal('lg-summary', fresh.summary || '');
      }
      loadLGActivity(data.leadId);
      renderLGLeadReminders(currentLGLead);
    }
  } catch (e) { /* best-effort */ }
}

// Manual entry — a reply Kevin got somewhere the watchers don't see (a call, a
// DM screenshot, a forwarded email). Goes through the same ingest endpoint so it
// gets the same sentiment/summary treatment.
async function createLGReplyManually() {
  const name  = prompt('Contact name:'); if (name === null) return;
  const email = prompt('Email (optional):') || '';
  const company = prompt('Company (optional):') || '';
  const channel = prompt('Channel — Email / Facebook / LinkedIn / WhatsApp / Manual:', 'Manual') || 'Manual';
  const campaign = prompt('Campaign (optional):') || '';
  const replyText = prompt('What did they say? (paste the reply)'); if (!replyText) return;
  try {
    const res = await fetch(`${CRM_API_BASE}/api/agent/leadgen-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: currentPassword, name, email, company, channel, campaign, replyText, force: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.status);
    await loadLGLeads();
    if (data.lead) openLGPanel(data.lead.id);
  } catch (err) {
    alert('Could not save reply: ' + err.message);
  }
}

// ── WIRE ───────────────────────────────────────────────────────────────────
function wireLGEvents() {
  ['lg-channel-filter', 'lg-campaign-filter', 'lg-sentiment-filter', 'lg-status-filter'].forEach(id =>
    document.getElementById(id)?.addEventListener('change', renderLGLeads));
  document.getElementById('lg-search')?.addEventListener('input', renderLGLeads);
  document.getElementById('lg-refresh-btn')?.addEventListener('click', loadLGLeads);
  document.getElementById('lg-add-btn')?.addEventListener('click', createLGReplyManually);
  ['lg-pipeline-channel-filter', 'lg-pipeline-campaign-filter'].forEach(id =>
    document.getElementById(id)?.addEventListener('change', renderLGPipeline));
  document.getElementById('lg-pipeline-refresh-btn')?.addEventListener('click', loadLGLeads);

  // Reminders view
  ['lg-reminder-status-filter', 'lg-reminder-owner-filter'].forEach(id =>
    document.getElementById(id)?.addEventListener('change', renderLGReminders));
  document.getElementById('lg-refresh-reminders-btn')?.addEventListener('click', loadLGTasks);

  // Panel chrome
  document.getElementById('lg-panel-close')?.addEventListener('click', closeLGPanel);
  document.getElementById('lg-panel-expand')?.addEventListener('click', () => togglePanelExpand('lg'));
  document.getElementById('lg-coach-close')?.addEventListener('click', () => finalizeCoachSection('lg'));
  document.getElementById('panel-overlay')?.addEventListener('click', () => {
    if (document.getElementById('leadgen-panel')?.classList.contains('open')) closeLGPanel();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('leadgen-panel')?.classList.contains('open')) closeLGPanel();
  });
  document.getElementById('lg-edit-contact-btn')?.addEventListener('click', () => {
    const editor = document.getElementById('lg-contact-edit');
    if (!editor) return;
    editor.style.display = editor.style.display === 'none' ? 'block' : 'none';
    if (editor.style.display === 'block') document.getElementById('lg-name')?.focus();
  });

  // Auto-save panel fields (debounced for text, immediate for selects)
  const fieldMap = {
    'lg-status': 'status', 'lg-sentiment': 'sentiment', 'lg-owner': 'owner', 'lg-summary': 'summary',
    'lg-name': 'name', 'lg-company': 'company', 'lg-title': 'title', 'lg-email': 'email',
    'lg-phone': 'phone', 'lg-website': 'website',
  };
  Object.entries(fieldMap).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const evt = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(evt, () => {
      if (!currentLGLead) return;
      const leadId = currentLGLead.id;
      const value  = el.value;
      const status = document.getElementById('lg-save-status');
      clearTimeout(lgSaveTimers[id]);
      const run = async () => {
        try {
          if (status) status.textContent = 'Saving…';
          await lgPatch(leadId, { [key]: value });
          if (status) status.textContent = 'Saved';
          setTimeout(() => { if (status && status.textContent === 'Saved') status.textContent = ''; }, 1500);
          updateLGStats(); updateLGBadge();
          if (currentLGLead && currentLGLead.id === leadId) {
            renderLGContactDisplay(currentLGLead);
            if (key === 'name') document.getElementById('lg-panel-name').textContent = currentLGLead.name || currentLGLead.email || '—';
            if (key === 'sentiment' || key === 'company') document.getElementById('lg-panel-sub').innerHTML =
              `${lgSentimentChip(currentLGLead.sentiment)} <span style="margin-left:6px;">${escHtml(currentLGLead.company || '')}</span>`;
          }
          if (currentView === 'leadgen') renderLGLeads();
          if (currentView === 'leadgen-pipeline') renderLGPipeline();
          if (key === 'sentiment' || key === 'status') loadLGActivity(leadId);
        } catch (err) {
          if (status) status.textContent = 'Save failed';
        }
      };
      if (evt === 'change') run(); else lgSaveTimers[id] = setTimeout(run, 700);
    });
  });

  document.getElementById('lg-save-new-note')?.addEventListener('click', saveLGNote);
  document.getElementById('lg-reminder-submit')?.addEventListener('click', createLGReminderFromPanel);
}
