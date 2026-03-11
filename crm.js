/**
 * Poler Team CRM — crm.js
 * CINC-inspired real estate agent dashboard
 */

// ── CONFIG ─────────────────────────────────────────────────────────────────
const CRM_API_BASE = 'https://poler-team-website-two.vercel.app';
const STATUSES = ['New','Contacted','Warm','Hot','Appointment Set','Under Contract','Closed','Dead'];

// ── STATE ──────────────────────────────────────────────────────────────────
let allLeads      = [];
let filteredLeads = [];
let sortField     = 'createdAt';
let sortDir       = 'desc';
let currentPassword = '';
let activeLead    = null;

// ── DOM READY ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // If already authenticated this session, skip login
  const savedPass = sessionStorage.getItem('crm_auth');
  if (savedPass) {
    currentPassword = savedPass;
    showDashboard();
    loadLeads();
    return;
  }

  // Wire up login form
  const loginBtn  = document.getElementById('crm-login-btn');
  const passInput = document.getElementById('crm-password-input');
  const loginError = document.getElementById('login-error');

  loginBtn.addEventListener('click', attemptLogin);
  passInput.addEventListener('keydown', e => { if (e.key === 'Enter') attemptLogin(); });

  async function attemptLogin() {
    const pass = passInput.value.trim();
    if (!pass) return;

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
      sessionStorage.setItem('crm_auth', pass);
      allLeads = data.leads || [];
      showDashboard();
      renderAll();
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
      // Session expired — boot back to login
      sessionStorage.removeItem('crm_auth');
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
        location.reload();
      } else if (action === 'export') {
        exportCSV();
      } else if (action === 'refresh' || action === 'dashboard') {
        loadLeads();
      }
    });
  });

  // Panel close
  document.getElementById('panel-close').addEventListener('click', closePanel);
  document.getElementById('panel-overlay').addEventListener('click', closePanel);

  // Escape key closes panel
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });

  // Panel save
  document.getElementById('panel-save').addEventListener('click', saveLead);

  // Alert preference controls
  document.getElementById('panel-alert-active').addEventListener('change', function () {
    toggleAlertFields(this.checked);
  });
  document.getElementById('panel-alert-send-now').addEventListener('click', sendTestAlert);
  document.getElementById('panel-alert-copy-link').addEventListener('click', copyPreferencesLink);

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
      document.querySelectorAll('.leads-table th').forEach(t => {
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
      const haystack = [lead.name, lead.email, lead.phone, lead.listingAddress]
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

    return `
      <tr data-id="${escHtml(lead.id)}">
        <td class="td-muted" style="font-size:0.8rem">${i + 1}</td>
        <td>
          <div class="lead-cell">
            <div class="lead-avatar">${escHtml(initials)}</div>
            <span class="lead-name">${escHtml(lead.name || '—')}</span>
          </div>
        </td>
        <td class="td-muted">${escHtml(lead.phone || '—')}</td>
        <td class="td-muted">${escHtml(lead.email || '—')}</td>
        <td class="td-property" title="${escHtml(lead.listingAddress || '')}">${property}</td>
        <td><span class="status-badge ${statusClass}">${escHtml(statusVal)}</span></td>
        <td class="td-muted">${relativeTime(lead.createdAt)}</td>
      </tr>`;
  }).join('');

  // Attach row click listeners
  tbody.querySelectorAll('tr[data-id]').forEach(row => {
    row.addEventListener('click', () => openPanel(row.dataset.id));
  });
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
  document.getElementById('panel-notes').value = lead.notes || '';

  // Alert preferences
  document.getElementById('panel-alert-active').checked = !!lead.alertActive;
  document.getElementById('panel-alert-cities').value = lead.alertCities || '';
  document.getElementById('panel-alert-price-min').value = lead.alertPriceMin || '';
  document.getElementById('panel-alert-price-max').value = lead.alertPriceMax || '';
  document.getElementById('panel-alert-beds').value = lead.alertBeds || '';
  document.getElementById('panel-alert-baths').value = lead.alertBaths || '';
  document.getElementById('panel-alert-frequency').value = lead.alertFrequency || 'Weekly';
  document.getElementById('panel-alert-count').value = lead.alertCount || '5';
  const types = lead.alertPropertyTypes || [];
  document.querySelectorAll('#panel-alert-types input').forEach(cb => {
    cb.checked = types.includes(cb.value);
  });
  toggleAlertFields(lead.alertActive);

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

// ── SAVE LEAD ──────────────────────────────────────────────────────────────
async function saveLead() {
  if (!activeLead) return;

  const btn        = document.getElementById('panel-save');
  const saveStatus = document.getElementById('panel-save-status');
  const status     = document.getElementById('panel-status').value;
  const notes      = document.getElementById('panel-notes').value;

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
        password: currentPassword,
      }),
    });

    const data = await res.json();

    if (data.success) {
      // Update local cache
      const lead = allLeads.find(l => String(l.id) === String(activeLead.id));
      if (lead) {
        lead.status = status;
        lead.notes  = notes;
        activeLead  = lead;
      }
      saveStatus.style.color   = '#16a34a';
      saveStatus.textContent   = '✓ Saved successfully';
      saveStatus.style.display = 'block';
      renderTable();
      renderStats();
    } else {
      saveStatus.style.color   = '#dc2626';
      saveStatus.textContent   = '✗ ' + (data.error || 'Failed to save. Please try again.');
      saveStatus.style.display = 'block';
    }
  } catch (err) {
    console.error('Save error:', err);
    saveStatus.style.color   = '#dc2626';
    saveStatus.textContent   = '✗ Network error. Please try again.';
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

function getAlertPrefsFromPanel() {
  const types = [];
  document.querySelectorAll('#panel-alert-types input:checked').forEach(cb => types.push(cb.value));
  return {
    alertActive:    document.getElementById('panel-alert-active').checked,
    propertyTypes:  types,
    cities:         document.getElementById('panel-alert-cities').value.trim(),
    priceMin:       Number(document.getElementById('panel-alert-price-min').value) || 0,
    priceMax:       Number(document.getElementById('panel-alert-price-max').value) || 0,
    bedsMin:        Number(document.getElementById('panel-alert-beds').value) || 0,
    bathsMin:       Number(document.getElementById('panel-alert-baths').value) || 0,
    frequency:      document.getElementById('panel-alert-frequency').value,
    count:          Number(document.getElementById('panel-alert-count').value) || 5,
  };
}

async function sendTestAlert() {
  if (!activeLead) return;
  const btn = document.getElementById('panel-alert-send-now');
  const statusEl = document.getElementById('panel-alert-status');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  statusEl.style.display = 'none';

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
      statusEl.textContent = `✓ Test alert sent to ${activeLead.email}`;
    } else {
      statusEl.style.color = '#dc2626';
      statusEl.textContent = '✗ ' + (data.error || 'Failed to send');
    }
  } catch (err) {
    statusEl.style.display = 'block';
    statusEl.style.color = '#dc2626';
    statusEl.textContent = '✗ Network error';
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
      statusEl.textContent = '✗ Failed to generate link';
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
    statusEl.textContent = '✓ Link copied to clipboard!';
    setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
  }

  btn.disabled = false;
  btn.textContent = 'Copy Link';
}

// ── EXPORT CSV ─────────────────────────────────────────────────────────────
function exportCSV() {
  const headers = [
    'Name', 'First Name', 'Last Name', 'Email', 'Phone',
    'Status', 'Listing Address', 'Listing Price',
    'Source URL', 'Notes', 'Registered'
  ];

  const rows = allLeads.map(l => [
    l.name,
    l.firstName,
    l.lastName,
    l.email,
    l.phone,
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
