/* ============================================================
   i18n.js — Internationalization for Poler Team Listing Page
   Supports: English (en), Spanish (es), Portuguese (pt)
   ============================================================ */

'use strict';

const I18N = {

    // ── Navigation ────────────────────────────────────────────
    navHome: { en: 'Home', es: 'Inicio', pt: 'Início' },
    navListings: { en: 'Listings', es: 'Propiedades', pt: 'Imóveis' },
    domLabel: { en: 'days on market', es: 'días en el mercado', pt: 'dias no mercado' },
    domLabelOne: { en: 'day on market', es: 'día en el mercado', pt: 'dia no mercado' },
    domToday: { en: 'New today', es: 'Nuevo hoy', pt: 'Novo hoje' },
    navBuy: { en: 'Buy', es: 'Comprar', pt: 'Comprar' },
    navRent: { en: 'Rent', es: 'Alquilar', pt: 'Alugar' },
    navSTR: { en: 'Short-Term Rentals', es: 'Alquileres Cortos', pt: 'Aluguéis Curtos' },
    navPrecon: { en: 'Preconstruction', es: 'Preconstrucción', pt: 'Pré-construção' },
    navValuation: { en: 'Home Valuation', es: 'Valoración', pt: 'Avaliação' },
    navAdvSearch: { en: 'Advanced Search', es: 'Búsqueda Avanzada', pt: 'Busca Avançada' },
    navAbout: { en: 'About', es: 'Nosotros', pt: 'Sobre' },
    navContact: { en: 'Contact', es: 'Contacto', pt: 'Contato' },

    // ── Search Tabs ──────────────────────────────────────────
    tabBuy: { en: 'Buy', es: 'Comprar', pt: 'Comprar' },
    tabRent: { en: 'Rent', es: 'Alquilar', pt: 'Alugar' },
    tabSell: { en: 'Sell', es: 'Vender', pt: 'Vender' },
    searchPlaceholder: {
        en: 'Address, City, or ZIP Code',
        es: 'Dirección, Ciudad o Código Postal',
        pt: 'Endereço, Cidade ou CEP',
    },
    moreFilters: { en: 'More Filters', es: 'Más Filtros', pt: 'Mais Filtros' },
    anyBeds: { en: 'Beds', es: 'Habitaciones', pt: 'Quartos' },
    anyBaths: { en: 'Baths', es: 'Baños', pt: 'Banheiros' },

    // ── New Features ──────────────────────────────────────────
    proofBuyers: { en: 'Buyers Served from 15+ Countries', es: 'Compradores Atendidos de 15+ Países', pt: 'Compradores Atendidos de 15+ Países' },
    saveSearchTitle: { en: 'Like what you see?', es: '¿Te gusta lo que ves?', pt: 'Gostou do que viu?' },
    saveSearchSubtitle: { en: 'Get new listings matching your search delivered to your inbox.', es: 'Reciba nuevas propiedades que coincidan con su búsqueda en su correo.', pt: 'Receba novas propriedades que correspondam à sua busca no seu e-mail.' },
    getAlerts: { en: 'Get Alerts', es: 'Recibir Alertas', pt: 'Receber Alertas' },
    alertsSuccess: { en: "You're subscribed! We'll send you matching properties.", es: '¡Suscrito! Le enviaremos propiedades que coincidan.', pt: 'Inscrito! Enviaremos propriedades correspondentes.' },
    similarProperties: { en: 'Similar Properties Nearby', es: 'Propiedades Similares Cercanas', pt: 'Propriedades Semelhantes Próximas' },
    exploreNeighborhoods: { en: 'Explore South Florida Neighborhoods', es: 'Explora los Vecindarios del Sur de Florida', pt: 'Explore os Bairros do Sul da Flórida' },
    popularSearches: { en: 'Popular Searches', es: 'Búsquedas Populares', pt: 'Buscas Populares' },
    contactUs: { en: 'Contact Us', es: 'Contáctenos', pt: 'Contato' },
    followUs: { en: 'Follow Us', es: 'Síguenos', pt: 'Siga-nos' },
    footerAlerts: { en: 'Get Property Alerts', es: 'Recibir Alertas', pt: 'Receber Alertas' },

    // ── Sell Tab ──────────────────────────────────────────────
    sellTitle: {
        en: "What's Your Home Worth?",
        es: '¿Cuánto Vale Su Casa?',
        pt: 'Quanto Vale Sua Casa?',
    },
    sellSubtitle: {
        en: 'Get a free home valuation from our team.',
        es: 'Obtenga una valoración gratuita de nuestro equipo.',
        pt: 'Obtenha uma avaliação gratuita da nossa equipe.',
    },
    sellPropertyAddress: {
        en: 'Property Address',
        es: 'Dirección de la Propiedad',
        pt: 'Endereço do Imóvel',
    },
    sellName: { en: 'Your Name', es: 'Su Nombre', pt: 'Seu Nome' },
    sellEmail: { en: 'Email Address', es: 'Correo Electrónico', pt: 'E-mail' },
    sellPhone: { en: 'Phone Number', es: 'Teléfono', pt: 'Telefone' },
    sellSubmit: {
        en: 'Get My Home Value',
        es: 'Obtener Valor de Mi Casa',
        pt: 'Obter Valor do Meu Imóvel',
    },
    sellSuccess: {
        en: 'Thank you! Rosa will contact you shortly with your valuation.',
        es: '¡Gracias! Rosa se pondrá en contacto pronto con su valoración.',
        pt: 'Obrigado! Rosa entrará em contato em breve com sua avaliação.',
    },

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
        pt: 'Suas informações estão seguras conosco. Sem spam, nunca.',
    },
    consentDisclosure: {
        en: 'By submitting, you agree to be contacted by The Poler Team via call, text, and WhatsApp — including by automated or AI-assisted means — at the number provided. Consent isn’t required to buy or sell.',
        es: 'Al enviar, aceptas recibir llamadas, mensajes de texto y WhatsApp de The Poler Team, incluyendo por medios automatizados o asistidos por IA, al número que proporcionas. El consentimiento no es necesario para comprar o vender.',
        pt: 'Ao enviar, você concorda em receber ligações, mensagens de texto e WhatsApp da The Poler Team, inclusive por meios automatizados ou assistidos por IA, no número fornecido. O consentimento não é necessário para comprar ou vender.',
    },
    submitAndContinue: {
        en: 'Submit & Continue',
        es: 'Enviar y Continuar',
        pt: 'Enviar e Continuar',
    },
    submitting: {
        en: 'Submitting…',
        es: 'Enviando…',
        pt: 'Enviando…',
    },
    fullName: {
        en: 'Full Name',
        es: 'Nombre Completo',
        pt: 'Nome Completo',
    },
    continueBtn: {
        en: 'Continue',
        es: 'Continuar',
        pt: 'Continuar',
    },
    contactTitle: {
        en: 'Almost there!',
        es: '¡Ya casi!',
        pt: 'Quase lá!',
    },
    contactSubtitle: {
        en: 'Where should we send the property details?',
        es: '¿A dónde te enviamos los detalles de la propiedad?',
        pt: 'Para onde enviamos os detalhes do imóvel?',
    },
    step1of2: {
        en: 'Step 1 of 2',
        es: 'Paso 1 de 2',
        pt: 'Passo 1 de 2',
    },
    step2of2: {
        en: 'Step 2 of 2',
        es: 'Paso 2 de 2',
        pt: 'Passo 2 de 2',
    },
    timelineLabel: {
        en: 'When do you plan to buy?',
        es: '¿Cuándo planeas comprar?',
        pt: 'Quando você planeja comprar?',
    },
    tl0to3:  { en: '0-3 Mo',  es: '0-3 meses',  pt: '0-3 meses' },
    tl3to6:  { en: '3-6 Mo',  es: '3-6 meses',  pt: '3-6 meses' },
    tl6to12: { en: '6-12 Mo', es: '6-12 meses', pt: '6-12 meses' },
    tl12plus:{ en: '12+ Mo',  es: '12+ meses',  pt: '12+ meses' },

    // ── Social-proof testimonials (data-i18n-html keeps the <span> attribution) ──
    spQuote1: {
        en: '"Found our dream condo in Sunny Isles in two weeks." <span>— Carlos R., Colombia</span>',
        es: '"Encontramos el condominio de nuestros sueños en Sunny Isles en dos semanas." <span>— Carlos R., Colombia</span>',
        pt: '"Encontramos o apartamento dos nossos sonhos em Sunny Isles em duas semanas." <span>— Carlos R., Colômbia</span>',
    },
    spQuote2: {
        en: '"Rosa made the whole process easy from Brazil." <span>— Luiz F., Brazil</span>',
        es: '"Rosa hizo que todo el proceso fuera fácil desde Brasil." <span>— Luiz F., Brasil</span>',
        pt: '"Rosa tornou todo o processo fácil desde o Brasil." <span>— Luiz F., Brasil</span>',
    },
    spQuote3: {
        en: '"Best experience buying property in Miami." <span>— Ivan C., New York</span>',
        es: '"La mejor experiencia comprando una propiedad en Miami." <span>— Ivan C., Nueva York</span>',
        pt: '"A melhor experiência comprando um imóvel em Miami." <span>— Ivan C., Nova York</span>',
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

    // ── Step 3: Preference Questions ────────────────────────
    prefStepTitle: {
        en: 'Personalize Your Home Search',
        es: 'Personalice Su Búsqueda',
        pt: 'Personalize Sua Busca',
    },
    prefStepSubtitle: {
        en: "Tell us what you're looking for and we'll send you matching properties daily.",
        es: 'Cuéntenos qué busca y le enviaremos propiedades diariamente.',
        pt: 'Nos conte o que procura e enviaremos imóveis diariamente.',
    },
    prefTimeline: {
        en: 'How soon are you planning to buy?',
        es: '¿Cuándo planea comprar?',
        pt: 'Quando pretende comprar?',
    },
    prefAreas: {
        en: 'What areas interest you?',
        es: '¿Qué áreas le interesan?',
        pt: 'Quais áreas te interessam?',
    },
    prefPropTypes: {
        en: 'What property types?',
        es: '¿Qué tipos de propiedad?',
        pt: 'Quais tipos de imóvel?',
    },
    prefBedsBaths: {
        en: 'Minimum beds / baths',
        es: 'Habitaciones / Baños mínimos',
        pt: 'Quartos / Banheiros mínimos',
    },
    prefPrice: {
        en: 'Price range',
        es: 'Rango de precio',
        pt: 'Faixa de preço',
    },
    prefSubmit: {
        en: 'Done',
        es: 'Listo',
        pt: 'Pronto',
    },
    prefSaving: {
        en: 'Saving...',
        es: 'Guardando...',
        pt: 'Salvando...',
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
    errSelectTimeline: {
        en: 'Please select when you plan to buy.',
        es: 'Por favor, selecciona cuándo planeas comprar.',
        pt: 'Por favor, selecione quando você planeja comprar.',
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
    singleFamily: { en: 'Single Family Home', es: 'Casa Unifamiliar', pt: 'Casa Unifamiliar' },
    condoVilla: { en: 'Condo / Co-op / Villa', es: 'Condo / Co-op / Villa', pt: 'Apartamento / Co-op / Villa' },
    townhouseOpt: { en: 'Townhouse', es: 'Townhouse', pt: 'Townhouse' },
    multiFamily: { en: 'Multifamily', es: 'Multifamiliar', pt: 'Multifamiliar' },
    priceRange: { en: 'Price Range (000s)', es: 'Rango de Precio (000s)', pt: 'Faixa de Preço (000s)' },
    priceHint: {
        en: 'Prices in thousands — e.g. 500 = $500,000',
        es: 'Precios en miles — ej. 500 = $500,000',
        pt: 'Preços em milhares — ex. 500 = $500.000',
    },
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
    prevPage: {
        en: 'Prev',
        es: 'Anterior',
        pt: 'Anterior',
    },
    listedLabel: {
        en: 'Listed',
        es: 'Publicado',
        pt: 'Publicado',
    },
    typesWord: {
        en: 'types',
        es: 'tipos',
        pt: 'tipos',
    },
    viewList: {
        en: 'List',
        es: 'Lista',
        pt: 'Lista',
    },
    viewMap: {
        en: 'Map',
        es: 'Mapa',
        pt: 'Mapa',
    },
    saveSearchBtn: {
        en: 'Save search',
        es: 'Guardar búsqueda',
        pt: 'Salvar busca',
    },
    sortNewest: {
        en: 'Newest',
        es: 'Más recientes',
        pt: 'Mais recentes',
    },
    sortPriceDesc: {
        en: 'Price (High to Low)',
        es: 'Precio (Mayor a Menor)',
        pt: 'Preço (Maior a Menor)',
    },
    sortPriceAsc: {
        en: 'Price (Low to High)',
        es: 'Precio (Menor a Mayor)',
        pt: 'Preço (Menor a Maior)',
    },
    fFeatures: { en: 'Features', es: 'Características', pt: 'Características' },
    fPool: { en: 'Pool', es: 'Piscina', pt: 'Piscina' },
    fGated: { en: 'Gated Community', es: 'Comunidad Cerrada', pt: 'Condomínio Fechado' },
    fTerrace: { en: 'Terrace / Balcony', es: 'Terraza / Balcón', pt: 'Terraço / Varanda' },
    fStrOk: { en: 'Short-Term Rentals OK', es: 'Renta Corta Permitida', pt: 'Aluguel de Curta Duração OK' },
    fHoa: { en: 'HOA / month', es: 'HOA / mes', pt: 'HOA / mês' },
    fNoHoa: { en: 'No HOA', es: 'Sin HOA', pt: 'Sem HOA' },
    fKeywords: { en: 'Keywords', es: 'Palabras clave', pt: 'Palavras-chave' },
    kwModern: { en: 'Modern', es: 'Moderno', pt: 'Moderno' },
    kwRenovated: { en: 'Renovated', es: 'Renovado', pt: 'Renovado' },
    kwPrivate: { en: 'Private', es: 'Privado', pt: 'Privado' },
    kwGolf: { en: 'Golf', es: 'Golf', pt: 'Golfe' },
    fKeywordPh: { en: 'modern, renovated, private, golf...', es: 'moderno, renovado, privado, golf...', pt: 'moderno, renovado, privado, golfe...' },
    hvTitle: { en: 'How Much Is Your Home Worth?', es: '¿Cuánto Vale Tu Casa?', pt: 'Quanto Vale a Sua Casa?' },
    hvCheck1: { en: 'Personalized Valuation', es: 'Valoración Personalizada', pt: 'Avaliação Personalizada' },
    hvCheck2: { en: 'Expert Advice', es: 'Asesoría Experta', pt: 'Consultoria Especializada' },
    hvCheck3: { en: 'Sell for More', es: 'Vende por Más', pt: 'Venda por Mais' },
    hvAddressPh: { en: 'Enter your home address...', es: 'Ingresa la dirección de tu casa...', pt: 'Digite o endereço da sua casa...' },
    hvCta: { en: 'Get a Free Home Valuation', es: 'Valoración Gratuita', pt: 'Avaliação Gratuita' },
    hvStep2Title: { en: 'Where should we send your valuation?', es: '¿A dónde enviamos tu valoración?', pt: 'Para onde enviamos sua avaliação?' },
    hvName: { en: 'Your Name', es: 'Tu Nombre', pt: 'Seu Nome' },
    hvEmail: { en: 'Email Address', es: 'Correo Electrónico', pt: 'E-mail' },
    hvPhone: { en: 'Phone Number', es: 'Número de Teléfono', pt: 'Número de Telefone' },
    hvSubmit: { en: 'Request My Valuation', es: 'Solicitar Mi Valoración', pt: 'Solicitar Minha Avaliação' },
    hvSuccess: { en: 'Thank you! Rosa will contact you shortly with your personalized valuation.', es: '¡Gracias! Rosa te contactará pronto con tu valoración personalizada.', pt: 'Obrigado! Rosa entrará em contato em breve com sua avaliação personalizada.' },
    hvError: { en: 'Something went wrong. Please try again or call us.', es: 'Algo salió mal. Intenta de nuevo o llámanos.', pt: 'Algo deu errado. Tente novamente ou ligue para nós.' },
    hvQuoteKicker: { en: 'Get a Quote', es: 'Cotización', pt: 'Cotação' },
    hvWorthTitle: { en: "What's Your Property Worth?", es: '¿Cuánto Vale Tu Propiedad?', pt: 'Quanto Vale Seu Imóvel?' },
    hvWorthBody1: { en: 'Knowing what your home is worth helps you plan ahead: how much equity you hold, what a sale could net, and when the market favors you.', es: 'Saber cuánto vale tu casa te ayuda a planificar: cuánto capital tienes, cuánto dejaría una venta y cuándo el mercado te favorece.', pt: 'Saber quanto vale sua casa ajuda a planejar: quanto patrimônio você tem, quanto renderia uma venda e quando o mercado favorece você.' },
    hvWorthBody2: { en: 'For the most precise number, we prepare a customized Comparative Market Analysis based on recent sales around your property.', es: 'Para el número más preciso, preparamos un Análisis Comparativo de Mercado basado en ventas recientes cerca de tu propiedad.', pt: 'Para o número mais preciso, preparamos uma Análise Comparativa de Mercado baseada em vendas recentes perto do seu imóvel.' },
    hvFaq1T: { en: 'What is a home valuation?', es: '¿Qué es una valoración?', pt: 'O que é uma avaliação?' },
    hvFaq1B: { en: 'An estimate of your property\'s current market value. It anchors every big decision: selling, refinancing, or borrowing against your equity.', es: 'Una estimación del valor actual de tu propiedad en el mercado. Es la base de toda decisión importante: vender, refinanciar o pedir un préstamo sobre tu capital.', pt: 'Uma estimativa do valor de mercado atual do seu imóvel. É a base de toda decisão importante: vender, refinanciar ou tomar crédito sobre seu patrimônio.' },
    hvFaq2T: { en: 'How is it calculated?', es: '¿Cómo se calcula?', pt: 'Como é calculada?' },
    hvFaq2B: { en: 'Location, size, age, condition, upgrades, and recent sales of comparable homes nearby, adjusted for current market trends and buyer demand.', es: 'Ubicación, tamaño, antigüedad, condición, mejoras y ventas recientes de casas comparables cercanas, ajustadas a las tendencias del mercado.', pt: 'Localização, tamanho, idade, condição, melhorias e vendas recentes de imóveis comparáveis próximos, ajustadas às tendências do mercado.' },
    hvFaq3T: { en: 'How accurate is it?', es: '¿Qué tan precisa es?', pt: 'Qual a precisão?' },
    hvFaq3B: { en: 'Automated numbers are a starting point. Renovations, unique features, and views only show up in a professional, in-person analysis.', es: 'Los números automáticos son un punto de partida. Renovaciones, características únicas y vistas solo aparecen en un análisis profesional en persona.', pt: 'Números automáticos são um ponto de partida. Reformas, características únicas e vistas só aparecem em uma análise profissional presencial.' },
    hvHowTitle: { en: 'How Is a Valuation Performed?', es: '¿Cómo Se Hace una Valoración?', pt: 'Como É Feita uma Avaliação?' },
    hvHowSub: { en: 'Two proven ways to value a home', es: 'Dos formas comprobadas de valorar una casa', pt: 'Duas formas comprovadas de avaliar uma casa' },
    hvCmaLabel: { en: 'Market Analysis', es: 'Análisis de Mercado', pt: 'Análise de Mercado' },
    hvCmaTitle: { en: 'Comparative Market Analysis', es: 'Análisis Comparativo de Mercado', pt: 'Análise Comparativa de Mercado' },
    hvCmaBody: { en: 'We find recently sold homes as similar and as close to yours as possible, then price out every difference to see what yours would sell for today.', es: 'Buscamos casas vendidas recientemente, lo más parecidas y cercanas a la tuya posible, y ajustamos cada diferencia para ver en cuánto se vendería hoy.', pt: 'Encontramos casas vendidas recentemente, o mais parecidas e próximas da sua possível, e ajustamos cada diferença para ver por quanto a sua venderia hoje.' },
    hvAppLabel: { en: 'Appraisal', es: 'Avalúo', pt: 'Laudo de Avaliação' },
    hvAppTitle: { en: "A Professional's Opinion", es: 'La Opinión de un Profesional', pt: 'A Opinião de um Profissional' },
    hvAppBody: { en: 'A licensed appraiser inspects the home inside and out, reviews comparable sales, and issues the formal report lenders rely on for mortgages.', es: 'Un tasador certificado inspecciona la casa por dentro y por fuera, revisa ventas comparables y emite el reporte formal que usan los bancos.', pt: 'Um avaliador licenciado inspeciona a casa por dentro e por fora, revisa vendas comparáveis e emite o laudo formal usado pelos bancos.' },
    hvWhyTitle: { en: 'Why Get a Valuation?', es: '¿Por Qué Valorar Tu Casa?', pt: 'Por Que Avaliar Sua Casa?' },
    hvWhySub: { en: 'Moments when knowing your number matters', es: 'Momentos donde conocer tu número importa', pt: 'Momentos em que conhecer seu número importa' },
    hvWhy1L: { en: 'Refinancing', es: 'Refinanciamiento', pt: 'Refinanciamento' },
    hvWhy1B: { en: 'Lenders size your loan against your home\'s value. More equity means better terms on your refinance.', es: 'Los bancos calculan tu préstamo según el valor de tu casa. Más capital significa mejores condiciones.', pt: 'Os bancos calculam seu empréstimo pelo valor da casa. Mais patrimônio significa melhores condições.' },
    hvWhy2L: { en: 'Home Improvements', es: 'Remodelaciones', pt: 'Reformas' },
    hvWhy2B: { en: 'Before a big renovation, see how your home compares to the neighborhood so you invest where it pays back.', es: 'Antes de una gran remodelación, mira cómo se compara tu casa con el vecindario para invertir donde sí retorna.', pt: 'Antes de uma grande reforma, veja como sua casa se compara ao bairro para investir onde há retorno.' },
    hvWhy3L: { en: 'Qualifying for Credit', es: 'Acceso a Crédito', pt: 'Acesso a Crédito' },
    hvWhy3B: { en: 'A home equity line requires knowing your equity. A current valuation tells you if you qualify and for how much.', es: 'Una línea de crédito sobre tu casa requiere conocer tu capital. Una valoración actual te dice si calificas y por cuánto.', pt: 'Uma linha de crédito sobre a casa exige conhecer seu patrimônio. Uma avaliação atual diz se você se qualifica e por quanto.' },
    hvWhy4L: { en: 'Planning', es: 'Planificación', pt: 'Planejamento' },
    hvWhy4B: { en: 'Life moves fast. Knowing what you could sell or borrow for keeps you ready for whatever comes next.', es: 'La vida cambia rápido. Saber en cuánto podrías vender o pedir prestado te mantiene listo para lo que venga.', pt: 'A vida muda rápido. Saber por quanto poderia vender ou tomar crédito mantém você pronto para o que vier.' },
    hvDreamTitle: { en: 'Find Your Next Dream Home', es: 'Encuentra Tu Próximo Hogar', pt: 'Encontre Seu Próximo Lar' },
    hvBrowse: { en: 'Browse Homes', es: 'Ver Propiedades', pt: 'Ver Imóveis' },
    nextPage: {
        en: 'Next',
        es: 'Siguiente',
        pt: 'Próxima',
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
// GUARDED (2026-07-17): localStorage THROWS (SecurityError) on privacy-hardened
// / MDM-managed mobile browsers. getLang() runs inside the DOMContentLoaded
// boot chain BEFORE the lead-popup wiring — an unguarded throw there aborts the
// whole boot and kills lead capture (same failure class as the 2026-07-15
// crypto.randomUUID CPL-doubling incident). In-memory fallback keeps the page
// fully functional; language just won't persist across reloads.
var _langMem = null;
function getLang() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlLang = urlParams.get('lang');
    if (urlLang && ['en', 'es', 'pt'].includes(urlLang)) {
        // Persist the URL param so language sticks on subsequent pages
        try { localStorage.setItem('poler_lang', urlLang); } catch (e) { _langMem = urlLang; }
        return urlLang;
    }
    try { return localStorage.getItem('poler_lang') || _langMem || 'en'; } catch (e) { return _langMem || 'en'; }
}
function setLang(lang) {
    try { localStorage.setItem('poler_lang', lang); } catch (e) { _langMem = lang; }
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

            // Re-fetch curated listings or re-run active search to update translated labels
            if (typeof refreshGrid === 'function') {
                refreshGrid();
            }
        });
    });

    // Close on outside click
    document.addEventListener('click', () => {
        dropdown.classList.remove('open');
    });
}
