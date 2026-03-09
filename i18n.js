/* ============================================================
   i18n.js — Internationalization for Poler Team Listing Page
   Supports: English (en), Spanish (es), Portuguese (pt)
   ============================================================ */

'use strict';

const I18N = {

    // ── Header ──────────────────────────────────────────────
    tagline: {
        en: 'South Florida Luxury Real Estate',
        es: 'Bienes Raíces de Lujo en el Sur de Florida',
        pt: 'Imóveis de Luxo no Sul da Flórida',
    },
    callUs: {
        en: 'Call Us',
        es: 'Llámenos',
        pt: 'Ligue',
    },

    // ── Lead Capture Modal — Step 1 ─────────────────────────
    leadTitle: {
        en: 'View Full Property Details',
        es: 'Ver Detalles Completos de la Propiedad',
        pt: 'Ver Detalhes Completos do Imóvel',
    },
    leadSubtitle: {
        en: 'Create your free account to unlock photos, pricing history, neighborhood stats, and schedule a private showing.',
        es: 'Cree su cuenta gratuita para desbloquear fotos, historial de precios, estadísticas del vecindario y agendar una visita privada.',
        pt: 'Crie sua conta gratuita para desbloquear fotos, histórico de preços, estatísticas do bairro e agendar uma visita privada.',
    },
    firstName: {
        en: 'First Name',
        es: 'Nombre',
        pt: 'Nome',
    },
    lastName: {
        en: 'Last Name',
        es: 'Apellido',
        pt: 'Sobrenome',
    },
    emailAddress: {
        en: 'Email Address',
        es: 'Correo Electrónico',
        pt: 'Endereço de E-mail',
    },
    phonePlaceholder: {
        en: '(555) 123-4567',
        es: '(555) 123-4567',
        pt: '(55) 1234-5678',
    },
    sendVerification: {
        en: 'Send Verification Code',
        es: 'Enviar Código de Verificación',
        pt: 'Enviar Código de Verificação',
    },
    sendingCode: {
        en: 'Sending code…',
        es: 'Enviando código…',
        pt: 'Enviando código…',
    },
    leadDisclaimer: {
        en: "We'll text a code to verify your number. No spam, ever.",
        es: 'Le enviaremos un código por mensaje de texto para verificar su número. Sin spam, nunca.',
        pt: 'Enviaremos um código por SMS para verificar seu número. Sem spam, nunca.',
    },

    // ── Lead Capture Modal — Step 2 (OTP) ───────────────────
    verifyTitle: {
        en: 'Verify Your Number',
        es: 'Verifique Su Número',
        pt: 'Verifique Seu Número',
    },
    otpSubtitle: {
        en: 'We sent a 6-digit code to {phone}. Enter it below to continue.',
        es: 'Enviamos un código de 6 dígitos a {phone}. Ingréselo a continuación para continuar.',
        pt: 'Enviamos um código de 6 dígitos para {phone}. Digite-o abaixo para continuar.',
    },
    verifyAndContinue: {
        en: 'Verify & Continue',
        es: 'Verificar y Continuar',
        pt: 'Verificar e Continuar',
    },
    verifying: {
        en: 'Verifying…',
        es: 'Verificando…',
        pt: 'Verificando…',
    },
    resendCode: {
        en: 'Resend code',
        es: 'Reenviar código',
        pt: 'Reenviar código',
    },
    changeNumber: {
        en: '← Change number',
        es: '← Cambiar número',
        pt: '← Alterar número',
    },
    callMeInstead: {
        en: 'Call me instead',
        es: 'Llamarme en su lugar',
        pt: 'Me ligue em vez disso',
    },
    callingNow: {
        en: 'Calling you now…',
        es: 'Llamándote ahora…',
        pt: 'Ligando para você agora…',
    },
    callSent: {
        en: '✓ Call sent! Listen for the code.',
        es: '✓ ¡Llamada enviada! Escuche el código.',
        pt: '✓ Chamada enviada! Ouça o código.',
    },
    otpCallSubtitle: {
        en: 'You will receive a phone call with your 6-digit code. Enter it below.',
        es: 'Recibirás una llamada telefónica con tu código de 6 dígitos. Ingrésalo a continuación.',
        pt: 'Você receberá uma ligação com seu código de 6 dígitos. Digite-o abaixo.',
    },
    errCallFailed: {
        en: 'Could not place call. Please try again.',
        es: 'No se pudo realizar la llamada. Por favor, inténtelo de nuevo.',
        pt: 'Não foi possível realizar a chamada. Por favor, tente novamente.',
    },

    // ── Validation errors ───────────────────────────────────
    errFillAll: {
        en: 'Please fill in all fields.',
        es: 'Por favor, complete todos los campos.',
        pt: 'Por favor, preencha todos os campos.',
    },
    errInvalidEmail: {
        en: 'Please enter a valid email address.',
        es: 'Por favor, ingrese un correo electrónico válido.',
        pt: 'Por favor, insira um endereço de e-mail válido.',
    },
    errInvalidPhone: {
        en: 'Please enter a valid phone number.',
        es: 'Por favor, ingrese un número de teléfono válido.',
        pt: 'Por favor, insira um número de telefone válido.',
    },
    errSendCode: {
        en: 'Could not send code. Please try again.',
        es: 'No se pudo enviar el código. Por favor, inténtelo de nuevo.',
        pt: 'Não foi possível enviar o código. Por favor, tente novamente.',
    },
    errNetwork: {
        en: 'Network error. Please try again.',
        es: 'Error de red. Por favor, inténtelo de nuevo.',
        pt: 'Erro de rede. Por favor, tente novamente.',
    },
    errOtpDigits: {
        en: 'Please enter all 6 digits.',
        es: 'Por favor, ingrese los 6 dígitos.',
        pt: 'Por favor, insira todos os 6 dígitos.',
    },
    errOtpInvalid: {
        en: 'Invalid code. Please try again.',
        es: 'Código inválido. Por favor, inténtelo de nuevo.',
        pt: 'Código inválido. Por favor, tente novamente.',
    },

    // ── Lookup Section ──────────────────────────────────────
    lookupTitle: {
        en: 'Look Up Any Property',
        es: 'Buscar Cualquier Propiedad',
        pt: 'Buscar Qualquer Imóvel',
    },
    enterMls: {
        en: 'Enter MLS # (e.g., A11898011)',
        es: 'Ingrese MLS # (ej., A11898011)',
        pt: 'Insira MLS # (ex., A11898011)',
    },
    autoFill: {
        en: 'Auto-Fill',
        es: 'Auto-Completar',
        pt: 'Auto-Preencher',
    },
    showAdvSearch: {
        en: 'Show Advanced Address Search',
        es: 'Mostrar Búsqueda Avanzada por Dirección',
        pt: 'Mostrar Busca Avançada por Endereço',
    },
    hideAdvSearch: {
        en: 'Hide Advanced Address Search',
        es: 'Ocultar Búsqueda Avanzada por Dirección',
        pt: 'Ocultar Busca Avançada por Endereço',
    },
    advSearchHint: {
        en: 'Enter exact address fields for precise MLS lookup (no fuzzy matching)',
        es: 'Ingrese los campos de dirección exacta para una búsqueda precisa en MLS',
        pt: 'Insira os campos de endereço exato para uma busca precisa no MLS',
    },
    streetNum: { en: 'Street #', es: 'Número', pt: 'Número' },
    dir: { en: 'Dir', es: 'Dir', pt: 'Dir' },
    streetName: { en: 'Street Name', es: 'Nombre de Calle', pt: 'Nome da Rua' },
    unitNum: { en: 'Unit #', es: 'Unidad #', pt: 'Unidade #' },
    city: { en: 'City', es: 'Ciudad', pt: 'Cidade' },
    zipCode: { en: 'ZIP Code', es: 'Código Postal', pt: 'CEP' },
    search: { en: 'Search', es: 'Buscar', pt: 'Buscar' },
    advRequired: {
        en: '* Required fields. City or ZIP is <strong>required</strong> for accurate matching.',
        es: '* Campos obligatorios. Ciudad o Código Postal es <strong>obligatorio</strong> para una búsqueda precisa.',
        pt: '* Campos obrigatórios. Cidade ou CEP é <strong>obrigatório</strong> para uma busca precisa.',
    },

    // ── Search Filters ──────────────────────────────────────
    filters: { en: 'Filters', es: 'Filtros', pt: 'Filtros' },
    showFilters: { en: 'Show Filters', es: 'Mostrar Filtros', pt: 'Mostrar Filtros' },
    hideFilters: { en: 'Hide Filters', es: 'Ocultar Filtros', pt: 'Ocultar Filtros' },
    location: { en: 'Location (comma-separated)', es: 'Ubicación (separada por comas)', pt: 'Localização (separada por vírgulas)' },
    locationPlaceholder: { en: 'Miami Beach, Hollywood, Sunny Isles...', es: 'Miami Beach, Hollywood, Sunny Isles...', pt: 'Miami Beach, Hollywood, Sunny Isles...' },
    propertyType: { en: 'Property Type', es: 'Tipo de Propiedad', pt: 'Tipo de Imóvel' },
    allTypes: { en: 'All Types', es: 'Todos los Tipos', pt: 'Todos os Tipos' },
    singleFamily: { en: 'Single Family', es: 'Casa Unifamiliar', pt: 'Casa Unifamiliar' },
    condoVilla: { en: 'Condo / CoOp / Villa / Townhouse', es: 'Condo / CoOp / Villa / Townhouse', pt: 'Apartamento / CoOp / Villa / Townhouse' },
    multiFamily: { en: 'MultiFamily', es: 'Multifamiliar', pt: 'Multifamiliar' },
    priceRange: { en: 'Price Range (000s)', es: 'Rango de Precio (000s)', pt: 'Faixa de Preço (000s)' },
    minBeds: { en: 'Min Beds', es: 'Hab. Mín', pt: 'Quartos Mín' },
    minBaths: { en: 'Min Baths', es: 'Baños Mín', pt: 'Banheiros Mín' },
    any: { en: 'Any', es: 'Cualquiera', pt: 'Qualquer' },
    advancedFilters: { en: 'Advanced Filters', es: 'Filtros Avanzados', pt: 'Filtros Avançados' },
    listingStatus: { en: 'Listing Status', es: 'Estado del Listado', pt: 'Status do Anúncio' },
    active: { en: 'Active', es: 'Activo', pt: 'Ativo' },
    pending: { en: 'Pending', es: 'Pendiente', pt: 'Pendente' },
    underContract: { en: 'Under Contract', es: 'Bajo Contrato', pt: 'Sob Contrato' },
    comingSoon: { en: 'Coming Soon', es: 'Próximamente', pt: 'Em Breve' },
    closed: { en: 'Closed', es: 'Cerrado', pt: 'Fechado' },
    squareFeet: { en: 'Square Feet', es: 'Pies Cuadrados', pt: 'Pés Quadrados' },
    yearBuilt: { en: 'Year Built', es: 'Año de Construcción', pt: 'Ano de Construção' },
    yearAny: { en: 'Any', es: 'Cualquiera', pt: 'Qualquer' },
    lotSize: { en: 'Lot Size (sqft)', es: 'Tamaño del Lote (sqft)', pt: 'Tamanho do Lote (sqft)' },
    county: { en: 'County', es: 'Condado', pt: 'Condado' },
    waterfront: { en: 'Waterfront', es: 'Frente al Agua', pt: 'Beira-Mar' },
    anyWaterfront: { en: 'Any Waterfront', es: 'Cualquier Frente al Agua', pt: 'Qualquer Beira-Mar' },
    bayfront: { en: 'Bayfront', es: 'Frente a la Bahía', pt: 'Frente à Baía' },
    canalfront: { en: 'Canalfront', es: 'Frente al Canal', pt: 'Frente ao Canal' },
    oceanBeachfront: { en: 'Ocean / Beachfront', es: 'Océano / Playa', pt: 'Oceano / Praia' },
    searchProperties: { en: 'Search Properties', es: 'Buscar Propiedades', pt: 'Buscar Imóveis' },

    // ── Results ─────────────────────────────────────────────
    showingFeatured: {
        en: 'Showing featured South Florida properties',
        es: 'Mostrando propiedades destacadas del Sur de Florida',
        pt: 'Mostrando imóveis em destaque no Sul da Flórida',
    },
    noResults: {
        en: 'No properties found matching your filters.',
        es: 'No se encontraron propiedades con sus filtros.',
        pt: 'Nenhum imóvel encontrado com seus filtros.',
    },
    noResultsHint: {
        en: 'Try broadening your search — adjust price range, location, or remove some filters.',
        es: 'Intente ampliar su búsqueda — ajuste el rango de precio, ubicación o elimine algunos filtros.',
        pt: 'Tente ampliar sua busca — ajuste a faixa de preço, localização ou remova alguns filtros.',
    },
    loadMore: {
        en: 'Load More Properties',
        es: 'Cargar Más Propiedades',
        pt: 'Carregar Mais Imóveis',
    },
    priceOnRequest: {
        en: 'Price on Request',
        es: 'Precio a Consultar',
        pt: 'Preço Sob Consulta',
    },

    // ── Listing card labels ─────────────────────────────────
    bd: { en: 'bd', es: 'hab', pt: 'qto' },
    ba: { en: 'ba', es: 'ba', pt: 'ban' },
    sf: { en: 'sf', es: 'sf', pt: 'sf' },

    // ── Hero property section ───────────────────────────────
    seeAllPhotos: {
        en: 'See All {count} Photos',
        es: 'Ver las {count} Fotos',
        pt: 'Ver Todas as {count} Fotos',
    },
    beds: { en: 'Beds', es: 'Habitaciones', pt: 'Quartos' },
    baths: { en: 'Baths', es: 'Baños', pt: 'Banheiros' },
    sqft: { en: 'Sq Ft', es: 'Pies²', pt: 'Pés²' },
    lotSizeLabel: { en: 'Lot Size', es: 'Tamaño del Lote', pt: 'Tamanho do Lote' },
    yearBuiltLabel: { en: 'Year Built', es: 'Año', pt: 'Ano' },
    propertyDetails: { en: 'Property Details', es: 'Detalles de la Propiedad', pt: 'Detalhes do Imóvel' },
    description: { en: 'Description', es: 'Descripción', pt: 'Descrição' },
    showMore: { en: 'Show more', es: 'Ver más', pt: 'Ver mais' },
    showLess: { en: 'Show less', es: 'Ver menos', pt: 'Ver menos' },
    keyFacts: { en: 'Key Facts', es: 'Datos Clave', pt: 'Dados Principais' },
    mlsNumber: { en: 'MLS #', es: 'MLS #', pt: 'MLS #' },
    type: { en: 'Type', es: 'Tipo', pt: 'Tipo' },
    status: { en: 'Status', es: 'Estado', pt: 'Status' },
    garage: { en: 'Garage', es: 'Garaje', pt: 'Garagem' },
    pool: { en: 'Pool', es: 'Piscina', pt: 'Piscina' },
    yes: { en: 'Yes', es: 'Sí', pt: 'Sim' },
    no: { en: 'No', es: 'No', pt: 'Não' },
    scheduleShowing: {
        en: 'Schedule a Private Showing',
        es: 'Agendar una Visita Privada',
        pt: 'Agendar uma Visita Privada',
    },

    // ── Agent Panel ─────────────────────────────────────────
    sendMessage: { en: 'Send a Message', es: 'Enviar un Mensaje', pt: 'Enviar uma Mensagem' },
    agentMsgPlaceholder: {
        en: "Hi Rosa, I'm interested in a property I saw...",
        es: 'Hola Rosa, estoy interesado(a) en una propiedad que vi...',
        pt: 'Olá Rosa, estou interessado(a) em um imóvel que vi...',
    },
    sendMessageBtn: { en: 'Send Message', es: 'Enviar Mensaje', pt: 'Enviar Mensagem' },
    contactAgent: { en: 'Contact Agent', es: 'Contactar Agente', pt: 'Contatar Agente' },

    // ── Footer ──────────────────────────────────────────────
    footerCopy: {
        en: '© 2025 The Poler Team — Optimar International Realty. All rights reserved.',
        es: '© 2025 The Poler Team — Optimar International Realty. Todos los derechos reservados.',
        pt: '© 2025 The Poler Team — Optimar International Realty. Todos os direitos reservados.',
    },
    backToMain: {
        en: '← Back to Main Site',
        es: '← Volver al Sitio Principal',
        pt: '← Voltar ao Site Principal',
    },

    // ── AI Chat Widget ──────────────────────────────────────
    aiAssistant: { en: 'AI Assistant', es: 'Asistente IA', pt: 'Assistente IA' },
    aiChatName: { en: 'AI Home Assistant', es: 'Asistente IA de Hogar', pt: 'Assistente IA Imobiliário' },
    aiChatSub: { en: 'The Poler Team · South Florida Real Estate', es: 'The Poler Team · Bienes Raíces del Sur de Florida', pt: 'The Poler Team · Imóveis no Sul da Flórida' },
    aiChatPlaceholder: {
        en: 'Ask me anything about real estate...',
        es: 'Pregúntame lo que quieras sobre bienes raíces...',
        pt: 'Pergunte-me qualquer coisa sobre imóveis...',
    },

    // ── Language selector labels ────────────────────────────
    langEN: { en: 'English', es: 'Inglés', pt: 'Inglês' },
    langES: { en: 'Spanish', es: 'Español', pt: 'Espanhol' },
    langPT: { en: 'Portuguese', es: 'Portugués', pt: 'Português' },
};

// ── Helper: get current language ────────────────────────────
// Priority: 1) ?lang= URL param  2) localStorage  3) default 'en'
function getLang() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlLang = urlParams.get('lang');
    if (urlLang && ['en', 'es', 'pt'].includes(urlLang)) {
        // Persist the URL param so language sticks on subsequent pages
        localStorage.setItem('poler_lang', urlLang);
        return urlLang;
    }
    return localStorage.getItem('poler_lang') || 'en';
}
function setLang(lang) {
    localStorage.setItem('poler_lang', lang);
}

// ── Helper: get translated string ───────────────────────────
function t(key, replacements) {
    const lang = getLang();
    const entry = I18N[key];
    if (!entry) return key;
    let text = entry[lang] || entry['en'] || key;
    if (replacements) {
        Object.keys(replacements).forEach(k => {
            text = text.replace(`{${k}}`, replacements[k]);
        });
    }
    return text;
}

// ── Apply translations to all data-i18n elements ────────────
function applyTranslations() {
    const lang = getLang();

    // Translate text content
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const entry = I18N[key];
        if (!entry) return;
        const text = entry[lang] || entry['en'];
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            el.placeholder = text;
        } else if (el.tagName === 'OPTION') {
            el.textContent = text;
        } else if (el.hasAttribute('data-i18n-html')) {
            el.innerHTML = text;
        } else {
            el.textContent = text;
        }
    });

    // Update <html> lang attribute
    document.documentElement.lang = lang === 'es' ? 'es' : lang === 'pt' ? 'pt' : 'en';

    // Update language selector display
    const langBtn = document.getElementById('lang-btn-text');
    if (langBtn) {
        const flags = { en: '🇺🇸', es: '🇪🇸', pt: '🇵🇹' };
        langBtn.textContent = flags[lang] + ' ' + (lang === 'en' ? 'EN' : lang === 'es' ? 'ES' : 'PT');
    }
}

// ── Init language selector dropdown ─────────────────────────
function initLanguageSelector() {
    const btn = document.getElementById('lang-selector-btn');
    const dropdown = document.getElementById('lang-dropdown');
    if (!btn || !dropdown) return;

    // Set initial active state
    const currentLang = getLang();
    dropdown.querySelectorAll('.lang-option').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.lang === currentLang);
    });

    // Toggle dropdown
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('open');
    });

    // Language option click
    dropdown.querySelectorAll('.lang-option').forEach(opt => {
        opt.addEventListener('click', () => {
            const newLang = opt.dataset.lang;
            setLang(newLang);

            // Update active state
            dropdown.querySelectorAll('.lang-option').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            dropdown.classList.remove('open');

            // Re-apply translations to all data-i18n elements
            applyTranslations();

            // Re-render dynamic content if hero is loaded
            if (typeof reRenderHero === 'function' && typeof heroListing !== 'undefined' && heroListing) {
                reRenderHero();
            }

            // Re-run search to update card labels (bd/ba/sf)
            if (typeof runSearch === 'function') {
                runSearch(false);
            }
        });
    });

    // Close on outside click
    document.addEventListener('click', () => {
        dropdown.classList.remove('open');
    });
}
