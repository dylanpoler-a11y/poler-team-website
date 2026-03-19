/**
 * Poler Team CRM — crm.js
 * CINC-inspired real estate agent dashboard
 */

// ── CONFIG ─────────────────────────────────────────────────────────────────
const CRM_API_BASE = 'https://poler-team-website-two.vercel.app';
const STATUSES = ['New','Contacted','Warm','Hot','Appointment Set','Under Contract','Closed','Dead'];

const AGENTS = [
  { name: 'Kevin', email: 'kevinpolermiami@gmail.com' },
  { name: 'Dylan', email: 'dylan@poler.org' },
  { name: 'Rosa',  email: 'rosadasilvapoler@gmail.com' },
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

// ── DOM READY ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // If already authenticated this session, skip login
  const savedPass  = sessionStorage.getItem('crm_auth');
  const savedEmail = sessionStorage.getItem('crm_agent_email');
  if (savedPass && savedEmail) {
    currentPassword = savedPass;
    const agent = AGENTS.find(a => a.email.toLowerCase() === savedEmail.toLowerCase());
    if (agent) {
      currentAgent = agent;
    }
    showDashboard();
    loadLeads();
    loadReminders();
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
      allLeads = data.leads || [];
      showDashboard();
      renderAll();
      loadReminders();
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
      if (currentView === 'reminders') renderReminders();
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
  const dashboardView = document.getElementById('dashboard-view');
  const remindersView = document.getElementById('reminders-view');

  // Update sidebar active state
  document.querySelectorAll('.nav-item[data-action]').forEach(el => {
    el.classList.remove('active');
    if (el.dataset.action === view || (view === 'dashboard' && el.dataset.action === 'dashboard')) {
      el.classList.add('active');
    }
  });

  if (view === 'reminders') {
    dashboardView.style.display = 'none';
    remindersView.style.display = 'block';
    renderReminders();
  } else {
    dashboardView.style.display = 'block';
    remindersView.style.display = 'none';
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

    return `
      <tr class="${rowClass}">
        <td class="td-muted">
          <span id="reminder-due-text-${r.id}">${escHtml(dueStr)}</span>
          <div id="reminder-edit-${r.id}" class="reminder-edit-row" style="display:none;">
            <input type="datetime-local" id="reminder-dt-${r.id}" class="reminder-dt-input" value="${dtLocal}">
            <button class="reminder-action-btn done" style="margin-top:4px" onclick="saveReminderDate('${r.id}')">Save</button>
          </div>
        </td>
        <td>
          <div class="lead-name" style="cursor:pointer" onclick="openPanelFromReminder('${escHtml(r.leadRecordId)}')">${escHtml(r.leadName || '—')}</div>
          <div class="td-muted" style="font-size:0.75rem">${escHtml(r.leadPhone || '')}</div>
        </td>
        <td><span class="action-type-badge ${actionClass}">${escHtml(r.actionType || '—')}</span></td>
        <td class="td-muted" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(r.note)}">${escHtml(r.note || '—')}</td>
        <td class="td-muted">${escHtml(r.agentName || '—')}</td>
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
  const input = document.getElementById(`reminder-dt-${id}`);
  if (!input || !input.value) return;
  const newDate = new Date(input.value).toISOString();
  try {
    const res = await fetch(`${CRM_API_BASE}/api/update-reminder`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, dueAt: newDate, password: currentPassword }),
    });
    const data = await res.json();
    if (data.success) {
      const reminder = allReminders.find(r => r.id === id);
      if (reminder) reminder.dueAt = newDate;
      renderReminders();
    }
  } catch (err) {
    console.error('Failed to update reminder date:', err);
  }
}

function openPanelFromReminder(leadRecordId) {
  if (!leadRecordId) return;
  switchView('dashboard');
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
        agentName:    currentAgent.name,
        agentEmail:   currentAgent.email,
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

  // Filters
  document.getElementById('search-input').addEventListener('input', applyFilters);
  document.getElementById('status-filter').addEventListener('change', applyFilters);
  document.getElementById('date-filter').addEventListener('change', applyFilters);

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

  // Panel reminder submit
  const reminderSubmit = document.getElementById('panel-reminder-submit');
  if (reminderSubmit) reminderSubmit.addEventListener('click', createReminderFromPanel);

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

  const search    = (searchEl ? searchEl.value : '').toLowerCase().trim();
  const status    = statusEl ? statusEl.value : '';
  const dateRange = dateEl ? dateEl.value : '';

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
    const property    = lead.listingAddress
      ? escHtml(lead.listingAddress) + (price ? ' · ' + price : '')
      : '—';
    const statusVal   = lead.status || 'New';
    const statusClass = 'status-' + statusVal.replace(/\s+/g, '-');
    const alertSummary = getAlertSummary(lead);

    return `
      <tr data-id="${escHtml(lead.id)}">
        <td class="td-muted" style="font-size:0.8rem">${i + 1}</td>
        <td>
          <div class="lead-cell">
            <div class="lead-avatar">${escHtml(initials)}</div>
            <span class="lead-name">${escHtml(lead.name || '—')}</span>
          </div>
        </td>
        <td class="td-muted">${relativeTime(lead.createdAt)}</td>
        <td class="td-muted">${escHtml(lead.phone || '—')}</td>
        <td class="td-muted">${escHtml(lead.email || '—')}</td>
        <td class="td-property" title="${escHtml(lead.listingAddress || '')}">${property}</td>
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
  if (!lead) return;
  activeLead = lead;

  // Name & date
  document.getElementById('panel-name').textContent       = lead.name || '—';
  document.getElementById('panel-date').textContent       = 'Registered ' + relativeTime(lead.createdAt);
  document.getElementById('panel-avatar-text').textContent = getInitials(lead.name);

  // Assigned To (dropdown)
  const assignedEl = document.getElementById('panel-assigned-to');
  if (assignedEl) assignedEl.value = lead.assignedTo || '';

  // Contact info in panel
  document.getElementById('panel-phone-display').textContent = lead.phone || '—';
  document.getElementById('panel-email-display').textContent = lead.email || '—';

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

  // Load conversations and activity
  if (lead.email) {
    loadConversations(lead.email);
    loadActivity(lead.email);
  }

  // Open panel
  document.getElementById('lead-panel').classList.add('open');
  document.getElementById('panel-overlay').classList.add('show');
}

// ── CLOSE LEAD PANEL ───────────────────────────────────────────────────────
function closePanel() {
  document.getElementById('lead-panel').classList.remove('open');
  document.getElementById('panel-overlay').classList.remove('show');
  activeLead = null;
}

// ── NOTES HISTORY ──────────────────────────────────────────────────────────
function renderNotesHistory(notesStr) {
  const container = document.getElementById('panel-notes-history');
  if (!container) return;
  if (!notesStr || !notesStr.trim()) {
    container.innerHTML = '<p class="panel-empty-text">No notes yet</p>';
    return;
  }
  // Notes are stored as: "[3/18/2026, 9:30 AM — Kevin] Note text\n\n[...] ..."
  // Parse into individual notes (split on the date pattern)
  const noteBlocks = notesStr.split(/(?=\[[\d\/]+,\s[\d:]+\s[AP]M\s—\s)/).filter(Boolean);
  if (noteBlocks.length === 0 && notesStr.trim()) {
    // Legacy: old-style single note without timestamp
    container.innerHTML = `<div class="note-card"><div class="note-body">${escHtml(notesStr)}</div></div>`;
    return;
  }
  container.innerHTML = noteBlocks.map(block => {
    const headerMatch = block.match(/^\[(.*?)\s—\s(.*?)\]\s*/);
    if (headerMatch) {
      const dateStr = headerMatch[1];
      const author = headerMatch[2];
      const body = block.slice(headerMatch[0].length).trim();
      return `<div class="note-card">
        <div class="note-header"><span class="note-author">${escHtml(author)}</span><span class="note-date">${escHtml(dateStr)}</span></div>
        <div class="note-body">${escHtml(body)}</div>
      </div>`;
    }
    return `<div class="note-card"><div class="note-body">${escHtml(block.trim())}</div></div>`;
  }).join('');
}

// ── SAVE LEAD ──────────────────────────────────────────────────────────────
async function saveLead() {
  if (!activeLead) return;

  const btn        = document.getElementById('panel-save');
  const saveStatus = document.getElementById('panel-save-status');
  const status     = document.getElementById('panel-status').value;
  const assignedTo = document.getElementById('panel-assigned-to').value;
  const newNote    = document.getElementById('panel-new-note').value.trim();

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
  return {
    name: document.getElementById('panel-alert-profile-name').value.trim() || 'Untitled',
    types,
    cities: document.getElementById('panel-alert-cities').value.trim(),
    priceMin: Number(document.getElementById('panel-alert-price-min').value) || 0,
    priceMax: Number(document.getElementById('panel-alert-price-max').value) || 0,
    bedsMin: Number(document.getElementById('panel-alert-beds').value) || 0,
    bathsMin: Number(document.getElementById('panel-alert-baths').value) || 0,
    polygon: alertMapPolygons.length > 0 ? JSON.stringify(alertMapPolygons) : '',
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

  // Drawing overlay — remove old one if exists, then create fresh
  const oldOverlay = document.getElementById('alert-map-draw-overlay');
  if (oldOverlay) oldOverlay.remove();
  const drawOverlay = document.createElement('div');
  drawOverlay.id = 'alert-map-draw-overlay';
  drawOverlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:10;cursor:crosshair;display:none;';
  container.style.position = 'relative';
  container.appendChild(drawOverlay);

  let overlayMouseDown = false;

  function overlayToLngLat(e) {
    const rect = alertMap.getCanvas().getBoundingClientRect();
    return alertMap.unproject([e.clientX - rect.left, e.clientY - rect.top]);
  }

  drawOverlay.addEventListener('mousedown', (e) => {
    if (!alertMapDrawing) return;
    e.preventDefault();
    e.stopPropagation();
    overlayMouseDown = true;
    const ll = overlayToLngLat(e);

    if (alertMapDrawMode === 'circle') {
      alertMapCircleCenter = [ll.lng, ll.lat];
      // Show initial point
      alertMap.getSource('alert-polygon').setData({ type: 'FeatureCollection', features: [] });
    } else if (alertMapDrawMode === 'freehand') {
      alertMapDrawPoints = [[ll.lng, ll.lat]];
      alertMap.getSource('alert-polygon').setData({ type: 'FeatureCollection', features: [] });
    }
  });

  drawOverlay.addEventListener('mousemove', (e) => {
    if (!alertMapDrawing || !overlayMouseDown) return;
    e.preventDefault();
    const ll = overlayToLngLat(e);

    if (alertMapDrawMode === 'circle' && alertMapCircleCenter) {
      // Generate circle polygon from center to current point
      const radiusKm = haversineDistance(alertMapCircleCenter[1], alertMapCircleCenter[0], ll.lat, ll.lng);
      const circleGeo = generateCirclePolygon(alertMapCircleCenter[0], alertMapCircleCenter[1], radiusKm);
      alertMap.getSource('alert-polygon').setData({ type: 'Feature', geometry: circleGeo });
    } else if (alertMapDrawMode === 'freehand') {
      alertMapDrawPoints.push([ll.lng, ll.lat]);
      // Show live freehand line
      alertMap.getSource('draw-line').setData({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: alertMapDrawPoints },
      });
    }
  });

  drawOverlay.addEventListener('mouseup', (e) => {
    if (!alertMapDrawing || !overlayMouseDown) return;
    e.preventDefault();
    e.stopPropagation();
    overlayMouseDown = false;
    const ll = overlayToLngLat(e);

    if (alertMapDrawMode === 'circle' && alertMapCircleCenter) {
      const radiusKm = haversineDistance(alertMapCircleCenter[1], alertMapCircleCenter[0], ll.lat, ll.lng);
      if (radiusKm > 0.1) { // minimum 100m radius
        const circleGeo = generateCirclePolygon(alertMapCircleCenter[0], alertMapCircleCenter[1], radiusKm);
        alertMapPolygons.push(circleGeo);
        renderAllPolygons();
      }
      exitDrawMode();
    } else if (alertMapDrawMode === 'freehand' && alertMapDrawPoints.length >= 5) {
      const simplified = simplifyPoints(alertMapDrawPoints, 80);
      const ring = [...simplified, simplified[0]];
      alertMapPolygons.push({ type: 'Polygon', coordinates: [ring] });
      renderAllPolygons();
      alertMap.getSource('draw-line').setData({ type: 'FeatureCollection', features: [] });
      exitDrawMode();
    } else {
      // Not enough movement, reset
      alertMap.getSource('draw-line').setData({ type: 'FeatureCollection', features: [] });
    }
  });

  // Prevent context menu on overlay
  drawOverlay.addEventListener('contextmenu', (e) => e.preventDefault());

  // Circle button
  document.getElementById('alert-map-draw-circle').addEventListener('click', () => {
    if (alertMapDrawing) { exitDrawMode(); return; }
    enterDrawMode('circle');
  });

  // Freehand button
  document.getElementById('alert-map-draw-freehand').addEventListener('click', () => {
    if (alertMapDrawing) { exitDrawMode(); return; }
    enterDrawMode('freehand');
  });

  // Clear button
  document.getElementById('alert-map-clear').addEventListener('click', () => {
    clearPolygon();
  });

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
  // Show overlay
  const overlay = document.getElementById('alert-map-draw-overlay');
  if (overlay) overlay.style.display = 'block';
  alertMap.doubleClickZoom.disable();
}

function exitDrawMode() {
  alertMapDrawing = false;
  alertMapDrawMode = null;
  document.getElementById('alert-map-hint').style.display = 'none';
  document.getElementById('alert-map-draw-circle').classList.remove('active');
  document.getElementById('alert-map-draw-freehand').classList.remove('active');
  const overlay = document.getElementById('alert-map-draw-overlay');
  if (overlay) overlay.style.display = 'none';
  alertMap.doubleClickZoom.enable();
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
    alertMap.doubleClickZoom.enable();
  }
  const overlay = document.getElementById('alert-map-draw-overlay');
  if (overlay) overlay.style.display = 'none';
  document.getElementById('alert-map-hint').style.display = 'none';
  document.getElementById('alert-map-draw-circle').classList.remove('active');
  document.getElementById('alert-map-draw-freehand').classList.remove('active');
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
    'Source URL', 'Notes', 'Registered'
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
