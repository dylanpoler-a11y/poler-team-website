/**
 * preferences.js — Self-service property alert preferences page
 * URL: /preferences?token=xxx&lang=en
 *
 * Loads existing preferences from API, allows editing, and saves changes.
 */

'use strict';

const API_BASE = 'https://poler-team-website-two.vercel.app';

// ── i18n STRINGS ────────────────────────────────────────────────────────────

const PREF_I18N = {
    prefLoading: {
        en: 'Loading your preferences…',
        es: 'Cargando tus preferencias…',
        pt: 'Carregando suas preferências…',
    },
    prefErrorTitle: {
        en: 'Unable to Load Preferences',
        es: 'No se Pudieron Cargar las Preferencias',
        pt: 'Não Foi Possível Carregar as Preferências',
    },
    prefErrorMsg: {
        en: 'The link may be invalid or expired. Please contact your agent for a new link.',
        es: 'El enlace puede ser inválido o haber expirado. Contacte a su agente para un nuevo enlace.',
        pt: 'O link pode ser inválido ou ter expirado. Entre em contato com seu agente para um novo link.',
    },
    prefGreeting: {
        en: 'Property Alert Preferences',
        es: 'Preferencias de Alertas de Propiedades',
        pt: 'Preferências de Alertas de Imóveis',
    },
    prefDesc: {
        en: "Customize what properties you'd like to receive in your email alerts. We'll send you curated listings matching your criteria.",
        es: 'Personaliza qué propiedades te gustaría recibir en tus alertas por correo. Te enviaremos listados seleccionados según tus criterios.',
        pt: 'Personalize quais imóveis você gostaria de receber em seus alertas por e-mail. Enviaremos listagens selecionadas de acordo com seus critérios.',
    },
    prefAlertsActive: {
        en: 'Property Alerts',
        es: 'Alertas de Propiedades',
        pt: 'Alertas de Imóveis',
    },
    prefPropertyTypes: {
        en: 'Property Types',
        es: 'Tipos de Propiedad',
        pt: 'Tipos de Imóvel',
    },
    prefSingleFamily: { en: 'Single Family', es: 'Casa Unifamiliar', pt: 'Casa Unifamiliar' },
    prefCondo: { en: 'Condo', es: 'Condominio', pt: 'Apartamento' },
    prefTownhouse: { en: 'Townhouse', es: 'Casa Adosada', pt: 'Sobrado' },
    prefMultiFamily: { en: 'Multi Family', es: 'Multifamiliar', pt: 'Multifamiliar' },
    prefCities: { en: 'Cities', es: 'Ciudades', pt: 'Cidades' },
    prefCitiesPlaceholder: {
        en: 'Miami Beach, Sunny Isles, Aventura…',
        es: 'Miami Beach, Sunny Isles, Aventura…',
        pt: 'Miami Beach, Sunny Isles, Aventura…',
    },
    prefPriceRange: { en: 'Price Range', es: 'Rango de Precios', pt: 'Faixa de Preço' },
    prefMin: { en: 'Min ($)', es: 'Mín ($)', pt: 'Mín ($)' },
    prefMax: { en: 'Max ($)', es: 'Máx ($)', pt: 'Máx ($)' },
    prefBedsBaths: { en: 'Min Beds / Baths', es: 'Hab. / Baños Mín.', pt: 'Quartos / Banhos Mín.' },
    prefAny: { en: 'Any', es: 'Cualquiera', pt: 'Qualquer' },
    prefFrequency: { en: 'Email Frequency', es: 'Frecuencia de Correo', pt: 'Frequência de E-mail' },
    prefDaily: { en: 'Daily', es: 'Diario', pt: 'Diário' },
    prefEvery3: { en: 'Every 3 Days', es: 'Cada 3 Días', pt: 'A cada 3 Dias' },
    prefWeekly: { en: 'Weekly', es: 'Semanal', pt: 'Semanal' },
    prefBiWeekly: { en: 'Bi-Weekly', es: 'Quincenal', pt: 'Quinzenal' },
    prefMonthly: { en: 'Monthly', es: 'Mensual', pt: 'Mensal' },
    prefCount: { en: 'Properties Per Alert', es: 'Propiedades Por Alerta', pt: 'Imóveis Por Alerta' },
    prefSave: { en: 'Save Preferences', es: 'Guardar Preferencias', pt: 'Salvar Preferências' },
    prefSaving: { en: 'Saving…', es: 'Guardando…', pt: 'Salvando…' },
    prefSaved: { en: '✓ Preferences saved!', es: '✓ Preferencias guardadas!', pt: '✓ Preferências salvas!' },
    prefSaveError: { en: '✗ Failed to save. Please try again.', es: '✗ Error al guardar. Intente de nuevo.', pt: '✗ Falha ao salvar. Tente novamente.' },
    prefContactIntro: {
        en: 'Questions? Reach out to your agent:',
        es: '¿Preguntas? Contacta a tu agente:',
        pt: 'Dúvidas? Fale com seu corretor:',
    },
};

// ── STATE ───────────────────────────────────────────────────────────────────

let currentLang = 'en';
let token = '';

// ── INIT ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    token = params.get('token') || '';
    currentLang = params.get('lang') || 'en';

    // Handle unsubscribe param
    const unsubscribe = params.get('unsubscribe');

    // Apply initial language
    setLang(currentLang);

    // Language switcher
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            setLang(btn.dataset.lang);
        });
    });

    if (!token) {
        showError();
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/get-preferences?token=${encodeURIComponent(token)}`);
        if (!res.ok) throw new Error('Failed to load');
        const data = await res.json();

        if (!data.success || !data.preferences) throw new Error('Invalid response');

        populateForm(data.preferences, data.name || '');

        // Auto-deactivate if unsubscribe link was clicked
        if (unsubscribe === '1') {
            document.getElementById('pref-active').checked = false;
            toggleFields(false);
        }

        showMain();
    } catch (err) {
        console.error('Load error:', err);
        showError();
    }

    // Toggle handler
    document.getElementById('pref-active').addEventListener('change', function () {
        toggleFields(this.checked);
    });

    // Save handler
    document.getElementById('pref-save').addEventListener('click', savePreferences);
});

// ── POPULATE FORM ───────────────────────────────────────────────────────────

function populateForm(prefs, name) {
    // Avatar + name
    const initials = name ? name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() : '?';
    document.getElementById('pref-avatar').textContent = initials;
    document.getElementById('pref-name-display').textContent = name || '';

    // Active toggle
    const active = !!prefs.alertActive;
    document.getElementById('pref-active').checked = active;
    toggleFields(active);

    // Property types
    const types = prefs.alertPropertyTypes || [];
    document.querySelectorAll('#pref-types input').forEach(cb => {
        cb.checked = types.includes(cb.value);
    });

    // Other fields
    document.getElementById('pref-cities').value = prefs.alertCities || '';
    document.getElementById('pref-price-min').value = prefs.alertPriceMin || '';
    document.getElementById('pref-price-max').value = prefs.alertPriceMax || '';
    document.getElementById('pref-beds').value = prefs.alertBeds || '';
    document.getElementById('pref-baths').value = prefs.alertBaths || '';
    document.getElementById('pref-frequency').value = prefs.alertFrequency || 'Weekly';
    document.getElementById('pref-count').value = prefs.alertCount || '5';

    // Set language from preferences if available
    if (prefs.preferredLanguage && prefs.preferredLanguage !== currentLang) {
        currentLang = prefs.preferredLanguage;
        setLang(currentLang);
    }
}

// ── SAVE PREFERENCES ────────────────────────────────────────────────────────

async function savePreferences() {
    const btn = document.getElementById('pref-save');
    const statusEl = document.getElementById('pref-status');

    btn.disabled = true;
    btn.textContent = t('prefSaving');
    statusEl.style.display = 'none';

    const types = [];
    document.querySelectorAll('#pref-types input:checked').forEach(cb => types.push(cb.value));

    const payload = {
        token,
        alertActive:    document.getElementById('pref-active').checked,
        propertyTypes:  types,
        cities:         document.getElementById('pref-cities').value.trim(),
        priceMin:       Number(document.getElementById('pref-price-min').value) || 0,
        priceMax:       Number(document.getElementById('pref-price-max').value) || 0,
        bedsMin:        Number(document.getElementById('pref-beds').value) || 0,
        bathsMin:       Number(document.getElementById('pref-baths').value) || 0,
        frequency:      document.getElementById('pref-frequency').value,
        count:          Number(document.getElementById('pref-count').value) || 5,
        preferredLanguage: currentLang,
    };

    try {
        const res = await fetch(`${API_BASE}/api/update-preferences`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();

        statusEl.style.display = 'block';
        if (data.success) {
            statusEl.style.color = '#16a34a';
            statusEl.textContent = t('prefSaved');
        } else {
            statusEl.style.color = '#dc2626';
            statusEl.textContent = t('prefSaveError');
        }
    } catch (err) {
        statusEl.style.display = 'block';
        statusEl.style.color = '#dc2626';
        statusEl.textContent = t('prefSaveError');
    }

    btn.disabled = false;
    btn.textContent = t('prefSave');
}

// ── HELPERS ─────────────────────────────────────────────────────────────────

function toggleFields(active) {
    document.getElementById('pref-fields').style.display = active ? 'block' : 'none';
}

function showMain() {
    document.getElementById('pref-loading').style.display = 'none';
    document.getElementById('pref-error').style.display = 'none';
    document.getElementById('pref-main').style.display = 'block';
}

function showError() {
    document.getElementById('pref-loading').style.display = 'none';
    document.getElementById('pref-error').style.display = 'block';
    document.getElementById('pref-main').style.display = 'none';
}

function t(key) {
    const entry = PREF_I18N[key];
    if (!entry) return key;
    return entry[currentLang] || entry.en || key;
}

function setLang(lang) {
    currentLang = lang;

    // Update lang switcher buttons
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === lang);
    });

    // Apply translations to data-i18n elements
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const translation = t(key);
        if (translation !== key) el.textContent = translation;
    });

    // Apply placeholder translations
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        const translation = t(key);
        if (translation !== key) el.placeholder = translation;
    });

    // Update URL without reload
    const url = new URL(window.location);
    url.searchParams.set('lang', lang);
    history.replaceState(null, '', url);

    // Update document lang
    document.documentElement.lang = lang;
}
