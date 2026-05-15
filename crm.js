/**
 * Poler Team CRM — crm.js
 * CINC-inspired real estate agent dashboard
 */

// ── CONFIG ─────────────────────────────────────────────────────────────────
const CRM_API_BASE = 'https://poler-team-website-two.vercel.app';
const BRIDGE_TOKEN = 'fceef76441eaf7579daff17411bffca2';
const BRIDGE_BASE  = 'https://api.bridgedataoutput.com/api/v2/miamire';
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
      allLeads = data.leads || [];
      showDashboard();
      renderAll();
      loadReminders();
      loadClients();
      loadDeals();
      loadConsultingTasks();
      loadConsultingContacts();
      loadConsultingPartners();
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
      // Always re-render so the Reminders page is in sync even if the user
      // switches into it later without an extra network round-trip
      renderReminders();
    }
  } catch (err) {
    console.error('Failed to load reminders:', err);
  }
}

function updateReminderBadge() {
  const badge = document.getElementById('reminder-badge');
  if (!badge) return;
  const now = Date.now();
  const pending = allReminders.filter(r =>
    r.status === 'Pending' && new Date(r.dueAt).getTime() <= now + 86400000 * 7
  );
  if (pending.length > 0) {
    badge.textContent = pending.length;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

// ── VIEW SWITCHING ─────────────────────────────────────────────────────────
function switchView(view) {
  currentView = view;
  const views = {
    dashboard:     document.getElementById('dashboard-view'),
    reminders:     document.getElementById('reminders-view'),
    listings:      document.getElementById('listings-view'),
    clients:       document.getElementById('clients-view'),
    pipeline:      document.getElementById('pipeline-view'),
    'cons-tasks':  document.getElementById('cons-tasks-view'),
    opportunities: document.getElementById('opportunities-view'),
    partners:      document.getElementById('partners-view'),
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
    renderReminders();
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
  } else {
    if (views.dashboard) views.dashboard.style.display = 'block';
  }
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
    if (filterStatus && r.status !== filterStatus) return false;
    if (filterAgent && r.agentEmail.toLowerCase() !== filterAgent.toLowerCase()) return false;
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

  tbody.innerHTML = filteredReminders.map(r => {
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
  }).join('');
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

// ── EVENT SETUP ────────────────────────────────────────────────────────────
function setupEvents() {
  // Header refresh button
  document.getElementById('refresh-btn').addEventListener('click', loadLeads);
  document.getElementById('resync-email-btn')?.addEventListener('click', resyncEmailInbox);

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
      } else if (action === 'refresh') {
        switchView('dashboard');
        loadLeads();
      } else if (action === 'dashboard') {
        switchView('dashboard');
      }
    });
  });

  // Reminder view events
  const reminderStatusFilter = document.getElementById('reminder-status-filter');
  const reminderAgentFilter  = document.getElementById('reminder-agent-filter');
  const refreshRemindersBtn  = document.getElementById('refresh-reminders-btn');
  if (reminderStatusFilter) reminderStatusFilter.addEventListener('change', renderReminders);
  if (reminderAgentFilter)  reminderAgentFilter.addEventListener('change', renderReminders);
  if (refreshRemindersBtn)  refreshRemindersBtn.addEventListener('click', loadReminders);

  // Panel close
  document.getElementById('panel-close').addEventListener('click', closePanel);
  document.getElementById('panel-overlay').addEventListener('click', closePanel);

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
    toggleAlertFields(this.checked);
  });
  document.getElementById('panel-alert-send-now').addEventListener('click', sendTestAlert);
  document.getElementById('panel-alert-copy-link').addEventListener('click', copyPreferencesLink);
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
    countEl.textContent = `Showing ${filteredLeads.length} of ${allLeads.length} leads`;
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
      <tr data-id="${escHtml(lead.id)}"${isDead ? ' style="opacity:0.45;color:#94a3b8;"' : ''}>
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

  if (parts.length === 0) return '<span class="alert-active-badge">Active</span>';
  const summary = parts.join(' · ');
  return `<span class="alert-active-badge" title="${escHtml(summary)}">✓ ${escHtml(summary.length > 35 ? summary.substring(0, 35) + '…' : summary)}</span>`;
}

// ── RENDER STATS ───────────────────────────────────────────────────────────
function renderStats() {
  const now  = Date.now();
  const week = 7 * 86400000;

  const totalEl   = document.getElementById('stat-total');
  const newEl     = document.getElementById('stat-new');
  const hotEl     = document.getElementById('stat-hot');
  const apptEl    = document.getElementById('stat-appointments');

  if (totalEl) totalEl.textContent = allLeads.length;
  if (newEl)   newEl.textContent   = allLeads.filter(l => {
    return now - new Date(l.createdAt).getTime() < week;
  }).length;
  if (hotEl)   hotEl.textContent   = allLeads.filter(l => l.status === 'Hot').length;
  if (apptEl)  apptEl.textContent  = allLeads.filter(l => l.status === 'Appointment Set').length;
}

// ── OPEN LEAD PANEL ────────────────────────────────────────────────────────
function openPanel(id) {
  const lead = allLeads.find(l => String(l.id) === String(id));
  if (!lead) { console.warn('[openPanel] lead not found for id:', id); return; }
  activeLead = lead;

  // OPEN THE PANEL FIRST — never let a data-population error keep it hidden.
  document.getElementById('lead-panel').classList.add('open');
  const overlay = document.getElementById('panel-overlay');
  if (overlay) overlay.classList.add('show');

  try {
    populatePanel(lead);
  } catch (err) {
    console.error('[openPanel] error populating panel for lead', lead?.id, lead?.name, err);
  }
}

function populatePanel(lead) {
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
  document.getElementById('panel-call').href      = lead.phone ? `tel:${lead.phone}` : '#';
  document.getElementById('panel-email').href     = lead.email ? `mailto:${lead.email}` : '#';
  document.getElementById('panel-whatsapp').href  = phoneRaw
    ? `https://wa.me/${phoneRaw}`
    : '#';

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
  renderLeadReminders(lead);

  // Wire share-property button (rebind each time so it uses current lead)
  const shareBtn = document.getElementById('panel-share-property');
  if (shareBtn) {
    shareBtn.onclick = () => openSharePropertyModal(lead);
  }

  // Panel is already opened at the top of openPanel(); nothing more to do.
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
  document.getElementById('lead-panel').classList.remove('open');
  document.getElementById('panel-overlay').classList.remove('show');
  activeLead = null;
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

function renderNotesHistory(notesStr) {
  const container = document.getElementById('panel-notes-history');
  if (!container) return;
  if (!notesStr || !notesStr.trim()) {
    parsedNotes = [];
    container.innerHTML = '<p class="panel-empty-text">No notes yet</p>';
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
    return;
  }
  parsedNotes = noteBlocks.map(block => {
    const headerMatch = block.match(/^\[(.*?)\s—\s(.*?)\]\s*/);
    if (headerMatch) {
      return { header: headerMatch[0].trim(), body: block.slice(headerMatch[0].length).trim(), raw: block.trim() };
    }
    return { header: '', body: block.trim(), raw: block.trim() };
  });
  container.innerHTML = parsedNotes.map((note, i) => {
    const headerMatch = note.raw.match(/^\[(.*?)\s—\s(.*?)\]\s*/);
    if (headerMatch) {
      const dateStr = headerMatch[1];
      const author = headerMatch[2];
      return `<div class="note-card" id="note-card-${i}">
        <div class="note-header"><span class="note-author">${escHtml(author)}</span><span class="note-date">${escHtml(dateStr)}</span></div>
        <div class="note-body" id="note-body-${i}">${escHtml(note.body)}</div>
        <div class="note-actions">
          <button class="note-edit-btn" onclick="editNote(${i})">Edit</button>
          <button class="note-delete-btn" onclick="deleteNote(${i})">Delete</button>
        </div>
      </div>`;
    }
    return `<div class="note-card" id="note-card-${i}">
      <div class="note-body" id="note-body-${i}">${escHtml(note.body)}</div>
      <div class="note-actions">
        <button class="note-edit-btn" onclick="editNote(${i})">Edit</button>
        <button class="note-delete-btn" onclick="deleteNote(${i})">Delete</button>
      </div>
    </div>`;
  }).join('');
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
    const dateStr = now.toLocaleString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
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
      }
      document.getElementById('panel-new-note').value = '';
      renderNotesHistory(notes);
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
  } catch (err) {
    console.warn('Alert preferences save failed:', err);
  }

  btn.disabled    = false;
  btn.textContent = 'Save Changes';
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
  // Try to load from JSON array field
  if (lead.alertProfiles) {
    try {
      const parsed = typeof lead.alertProfiles === 'string' ? JSON.parse(lead.alertProfiles) : lead.alertProfiles;
      if (Array.isArray(parsed)) alertProfiles = parsed;
    } catch (e) { /* ignore bad JSON */ }
  }
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

    const el = document.createElement('div');
    el.className = 'preview-marker';
    el.innerHTML = price;

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([lng, lat])
      .setPopup(new maplibregl.Popup({ offset: 20, maxWidth: '240px' }).setHTML(
        `<div style="font-size:0.8rem;">
          <b style="color:#1a2744;">${price}</b><br>
          <span style="color:#475569;">${escHtml(l.UnparsedAddress || l.City || '')}</span><br>
          <span style="color:#6b7280;font-size:0.72rem;">${l.BedroomsTotal || '—'} bd · ${l.BathroomsTotalInteger || '—'} ba · ${l.LivingArea ? l.LivingArea.toLocaleString() + ' sf' : ''}</span><br>
          <a href="https://homesinsoflorida.com/listing?id=${l.ListingId}" target="_blank" style="color:#2563eb;font-size:0.72rem;">View listing →</a>
        </div>`
      ))
      .addTo(alertMap);

    previewMarkers.push(marker);
    bounds.extend([lng, lat]);
    hasBounds = true;
  });

  if (hasBounds) {
    alertMap.fitBounds(bounds, { padding: 50, maxZoom: 13 });
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
      'Media','ListOfficeName',
    ].join(',');

    const isRental = (profile.types || []).includes('For Rent');
    const params = new URLSearchParams({
      access_token: BRIDGE_TOKEN,
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
    if (!isRental && nonRentalTypes.length === 1) {
      params.set('PropertySubType', typeMap[nonRentalTypes[0]] || nonRentalTypes[0]);
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

    // Fetch with pagination (up to 3 pages of 200 = 600 max)
    let allListings = [];
    async function fetchPage(p, offset) {
      p.set('offset', String(offset));
      const res = await fetch(`${BRIDGE_BASE}/listings?${p}`);
      const data = await res.json();
      return data.success && data.bundle ? data.bundle : [];
    }

    if (cities.length > 1) {
      const fetches = cities.map(city => {
        const p = new URLSearchParams(params);
        p.set('City', city);
        return fetch(`${BRIDGE_BASE}/listings?${p}`).then(r => r.json()).then(d => d.success && d.bundle ? d.bundle : []).catch(() => []);
      });
      const results = await Promise.all(fetches);
      allListings = results.flat();
    } else {
      // Page 1
      let page1 = await fetchPage(new URLSearchParams(params), 0);
      allListings = page1;
      // Page 2 if first page was full
      if (page1.length >= 200) {
        let page2 = await fetchPage(new URLSearchParams(params), 200);
        allListings = allListings.concat(page2);
        // Page 3
        if (page2.length >= 200) {
          let page3 = await fetchPage(new URLSearchParams(params), 400);
          allListings = allListings.concat(page3);
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

    countNum.textContent = allListings.length;
    plotPreviewMarkers(allListings);

  } catch (err) {
    console.error('Count check error:', err);
    if (fetchId === countFetchId) countNum.textContent = 'Error';
  } finally {
    if (fetchId === countFetchId && btn) btn.textContent = '📊 Check Available Properties';
  }
}

function getAlertPrefsFromPanel() {
  // Build prefs including the full profiles array
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
    alertProfiles:  JSON.stringify(alertProfiles),
  };
  return prefs;
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
    if (data.success) {
      statusEl.style.color = '#16a34a';
      statusEl.textContent = `Test alert sent to ${activeLead.email}`;
    } else {
      statusEl.style.color = '#dc2626';
      statusEl.textContent = (data.error || 'Failed to send');
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

  const rows = allLeads.map(l => [
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
        return `<div class="convo-bubble ${cls}">${escHtml(m.content).slice(0, 200)}${m.content.length > 200 ? '…' : ''}</div>`;
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
    return `<div class="viewed-property-item" style="cursor:pointer;" onclick="openPropertyModal('','?id=${escHtml(mlsId)}')">
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
    return `<div class="viewed-property-item" style="cursor:pointer;" onclick="openPropertyModal('${escHtml(addr)}','${mlsParam}')">
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
  const qs = new URLSearchParams({ access_token: BRIDGE_TOKEN, ...params, limit: 1 }).toString();
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
  document.addEventListener('DOMContentLoaded', wireClientEvents);
} else {
  wireClientEvents();
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
  document.querySelectorAll('.kanban-card').forEach(card => {
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
  const container = document.getElementById('cons-tasks-groups');
  const empty     = document.getElementById('cons-tasks-empty');
  if (!container) return;

  const statusF = document.getElementById('cons-tasks-status-filter')?.value || '';
  const ownerF  = document.getElementById('cons-tasks-owner-filter')?.value || '';

  const filtered = allConsultingTasks.filter(t => {
    if (statusF && t.status !== statusF) return false;
    if (ownerF && t.owner !== ownerF) return false;
    return true;
  });

  const label = document.getElementById('cons-tasks-count-label');
  if (label) {
    label.textContent = `${filtered.length} ${filtered.length === 1 ? 'task' : 'tasks'}`;
    label.style.display = 'inline-block';
  }

  if (filtered.length === 0) {
    container.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  // Group: Overdue / Today / This Week / Later / Done
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfToday   = startOfToday + 86400000;
  const endOfWeek    = startOfToday + 86400000 * 7;

  const groups = { overdue: [], today: [], week: [], later: [], done: [] };
  filtered.forEach(t => {
    if (t.status === 'Completed' || t.status === 'Cancelled') {
      groups.done.push(t);
      return;
    }
    const due = t.dueAt ? new Date(t.dueAt).getTime() : null;
    if (due == null) groups.later.push(t);
    else if (due < startOfToday) groups.overdue.push(t);
    else if (due < endOfToday) groups.today.push(t);
    else if (due < endOfWeek) groups.week.push(t);
    else groups.later.push(t);
  });

  const renderGroup = (key, title, classMod = '') => {
    if (!groups[key].length) return '';
    return `
      <div class="task-group ${classMod}">
        <div class="task-group-title">${title} (${groups[key].length})</div>
        ${groups[key].map(t => taskRowHTML(t)).join('')}
      </div>
    `;
  };

  container.innerHTML =
    renderGroup('overdue', 'Overdue', 'overdue') +
    renderGroup('today',   'Today') +
    renderGroup('week',    'This Week') +
    renderGroup('later',   'Later') +
    renderGroup('done',    'Done');

  container.querySelectorAll('.task-row-check').forEach(cb => {
    cb.addEventListener('click', e => {
      e.stopPropagation();
      const id = cb.closest('.task-row').dataset.taskId;
      toggleTaskComplete(id);
    });
  });
  container.querySelectorAll('.task-row').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.taskId;
      const task = allConsultingTasks.find(t => t.id === id);
      if (!task) return;
      // Open the related deal panel if linked, else the company panel
      if (task.dealId) openDealPanel(task.dealId);
      else if (task.companyId) openClientPanel(task.companyId);
    });
  });
}

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
  // Load notes
  loadListingNotes(l.mlsId).catch(err => console.error('loadListingNotes:', err));
  document.getElementById('listing-panel').classList.add('open');
}

function closeListingPanel() {
  document.getElementById('listing-panel')?.classList.remove('open');
  activeListing = null;
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
