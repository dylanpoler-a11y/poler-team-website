/* =============================================
   THE POLER TEAM - Interactive Script
   ============================================= */

document.addEventListener('DOMContentLoaded', () => {

    // --- Preloader ---
    const preloader = document.getElementById('preloader');
    window.addEventListener('load', () => {
        setTimeout(() => {
            preloader.classList.add('loaded');
            document.body.style.overflow = 'auto';
            initAnimations();
        }, 1500);
    });

    // Fallback: remove preloader after 3 seconds regardless
    setTimeout(() => {
        preloader.classList.add('loaded');
        document.body.style.overflow = 'auto';
        initAnimations();
    }, 3000);

    // --- Custom Cursor ---
    const cursorDot = document.querySelector('.cursor-dot');
    const cursorRing = document.querySelector('.cursor-ring');

    if (window.matchMedia('(pointer: fine)').matches) {
        let mouseX = 0, mouseY = 0;
        let ringX = 0, ringY = 0;

        document.addEventListener('mousemove', (e) => {
            mouseX = e.clientX;
            mouseY = e.clientY;
            cursorDot.style.left = mouseX - 4 + 'px';
            cursorDot.style.top = mouseY - 4 + 'px';
        });

        function animateCursor() {
            ringX += (mouseX - ringX) * 0.15;
            ringY += (mouseY - ringY) * 0.15;
            cursorRing.style.left = ringX + 'px';
            cursorRing.style.top = ringY + 'px';
            requestAnimationFrame(animateCursor);
        }
        animateCursor();

        // Hover effect on interactive elements
        const hoverTargets = document.querySelectorAll('a, button, .expertise-card, .area-card');
        hoverTargets.forEach(target => {
            target.addEventListener('mouseenter', () => cursorRing.classList.add('hover'));
            target.addEventListener('mouseleave', () => cursorRing.classList.remove('hover'));
        });
    }

    // --- Navigation ---
    const navbar = document.getElementById('navbar');
    const navToggle = document.querySelector('.nav-toggle');
    const mobileMenu = document.querySelector('.mobile-menu');
    const mobileLinks = document.querySelectorAll('.mobile-links a');

    // Logo switching on scroll
    const navLogoImg = navbar.querySelector('.logo-img');

    // Scroll effect on nav
    window.addEventListener('scroll', () => {
        if (window.scrollY > 80) {
            navbar.classList.add('scrolled');
            if (navLogoImg) navLogoImg.src = 'logo.png';
        } else {
            navbar.classList.remove('scrolled');
            if (navLogoImg) navLogoImg.src = 'logo-white.png';
        }
    });

    // Mobile menu toggle
    navToggle.addEventListener('click', () => {
        navToggle.classList.toggle('active');
        mobileMenu.classList.toggle('active');
        document.body.style.overflow = mobileMenu.classList.contains('active') ? 'hidden' : 'auto';
    });

    // Close mobile menu on link click
    mobileLinks.forEach(link => {
        link.addEventListener('click', () => {
            navToggle.classList.remove('active');
            mobileMenu.classList.remove('active');
            document.body.style.overflow = 'auto';
        });
    });

    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                const offset = 80;
                const top = target.getBoundingClientRect().top + window.pageYOffset - offset;
                window.scrollTo({ top, behavior: 'smooth' });
            }
        });
    });

    // --- Hero Particles ---
    function createParticles() {
        const container = document.getElementById('particles');
        const particleCount = 30;

        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.classList.add('particle');
            particle.style.left = Math.random() * 100 + '%';
            particle.style.width = (Math.random() * 3 + 1) + 'px';
            particle.style.height = particle.style.width;
            particle.style.animationDuration = (Math.random() * 10 + 8) + 's';
            particle.style.animationDelay = (Math.random() * 10) + 's';
            container.appendChild(particle);
        }
    }
    createParticles();

    // --- Parallax Effect ---
    function handleParallax() {
        const scrolled = window.pageYOffset;

        // Hero video parallax - subtle slow zoom on scroll
        const heroVideo = document.querySelector('.hero-video');
        if (heroVideo && scrolled < window.innerHeight) {
            const scale = 1 + (scrolled / window.innerHeight) * 0.08;
            heroVideo.style.transform = `scale(${scale})`;
        }

        // Parallax video divider
        const parallaxVideoWrap = document.querySelector('.parallax-video-wrap');
        if (parallaxVideoWrap) {
            const section = parallaxVideoWrap.closest('section');
            const rect = section.getBoundingClientRect();
            if (rect.top < window.innerHeight && rect.bottom > 0) {
                const offset = rect.top * 0.15;
                parallaxVideoWrap.style.transform = `translateY(${offset}px)`;
            }
        }

        // Parallax items
        document.querySelectorAll('.parallax-item').forEach(item => {
            const speed = parseFloat(item.dataset.speed) || 0.05;
            const rect = item.getBoundingClientRect();
            if (rect.top < window.innerHeight && rect.bottom > 0) {
                const yPos = (rect.top - window.innerHeight / 2) * speed;
                item.style.transform = `translateY(${yPos}px)`;
            }
        });

        // Hero parallax on scroll
        const heroContent = document.querySelector('.hero-content');
        if (heroContent && scrolled < window.innerHeight) {
            heroContent.style.transform = `translateY(${scrolled * 0.3}px)`;
            heroContent.style.opacity = 1 - (scrolled / (window.innerHeight * 0.8));
        }
    }

    window.addEventListener('scroll', handleParallax, { passive: true });

    // --- Reveal Animations on Scroll ---
    function initAnimations() {
        const revealElements = document.querySelectorAll('.reveal-up, .reveal-left, .reveal-right');

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('revealed');
                    observer.unobserve(entry.target);
                }
            });
        }, {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        });

        revealElements.forEach(el => observer.observe(el));
    }

    // --- Counter Animation ---
    function animateCounters() {
        const counters = document.querySelectorAll('.stat-number[data-target]');

        const counterObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const counter = entry.target;
                    const target = parseInt(counter.dataset.target);
                    const duration = 2000;
                    const start = performance.now();

                    function updateCounter(currentTime) {
                        const elapsed = currentTime - start;
                        const progress = Math.min(elapsed / duration, 1);

                        // Ease out cubic
                        const eased = 1 - Math.pow(1 - progress, 3);
                        const current = Math.round(eased * target);
                        counter.textContent = current;

                        if (progress < 1) {
                            requestAnimationFrame(updateCounter);
                        }
                    }

                    requestAnimationFrame(updateCounter);
                    counterObserver.unobserve(counter);
                }
            });
        }, { threshold: 0.5 });

        counters.forEach(counter => counterObserver.observe(counter));
    }
    animateCounters();

    // --- Chart Bar Animation ---
    function animateChartBars() {
        const chartBars = document.querySelectorAll('.chart-bar');

        const chartObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('animated');
                    chartObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.3 });

        chartBars.forEach(bar => chartObserver.observe(bar));
    }
    animateChartBars();

    // --- Tilt Effect on Expertise Cards ---
    const cards = document.querySelectorAll('.expertise-card');
    cards.forEach(card => {
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            const rotateX = (y - centerY) / 20;
            const rotateY = (centerX - x) / 20;

            card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-8px)`;
        });

        card.addEventListener('mouseleave', () => {
            card.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) translateY(0)';
        });
    });

    // --- Magnetic Effect on CTA Buttons ---
    const magneticBtns = document.querySelectorAll('.btn-primary');
    magneticBtns.forEach(btn => {
        btn.addEventListener('mousemove', (e) => {
            const rect = btn.getBoundingClientRect();
            const x = e.clientX - rect.left - rect.width / 2;
            const y = e.clientY - rect.top - rect.height / 2;
            btn.style.transform = `translate(${x * 0.2}px, ${y * 0.2}px)`;
        });

        btn.addEventListener('mouseleave', () => {
            btn.style.transform = 'translate(0, 0)';
        });
    });

    // --- Active Navigation Highlight ---
    const sections = document.querySelectorAll('section[id]');
    const navItems = document.querySelectorAll('.nav-links a');

    function highlightNav() {
        const scrollPos = window.pageYOffset + 200;

        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.offsetHeight;
            const sectionId = section.getAttribute('id');

            if (scrollPos >= sectionTop && scrollPos < sectionTop + sectionHeight) {
                navItems.forEach(item => {
                    item.classList.remove('active');
                    if (item.getAttribute('href') === '#' + sectionId) {
                        item.classList.add('active');
                    }
                });
            }
        });
    }

    window.addEventListener('scroll', highlightNav, { passive: true });

    // --- Property Search Tabs + Panel Switching ---
    const searchTabs = document.querySelectorAll('.search-tab');
    const standardPanel = document.getElementById('propertySearch');
    const investPanel = document.getElementById('investSearch');
    let typewriterTimeout = null;
    let typewriterRunning = false;
    let currentExampleIndex = 0;

    const aiExamples = [
        'Find me the highest grossing rental in Sunny Isles Beach',
        'My investment limit is $1M find me an income producing property on the beach',
        "I'm looking for a 2/2 on the beach that I can Airbnb"
    ];

    function stopTypewriter() {
        if (typewriterTimeout) {
            clearTimeout(typewriterTimeout);
            typewriterTimeout = null;
        }
        typewriterRunning = false;
        const cursor = document.getElementById('aiCursor');
        if (cursor) cursor.classList.remove('typing');
    }

    function startTypewriter() {
        const input = document.getElementById('aiSearchInput');
        const cursor = document.getElementById('aiCursor');
        if (!input || !cursor) return;

        stopTypewriter();
        input.value = '';
        input.classList.remove('user-typing');
        cursor.classList.add('typing');
        typewriterRunning = true;

        function typeExample() {
            if (!typewriterRunning) return;
            const text = aiExamples[currentExampleIndex];
            let i = 0;

            function typeChar() {
                if (!typewriterRunning) return;
                if (i < text.length) {
                    input.value = text.substring(0, i + 1);
                    i++;
                    const speed = 40 + Math.random() * 30;
                    typewriterTimeout = setTimeout(typeChar, speed);
                } else {
                    // Finished typing — pause, then erase
                    typewriterTimeout = setTimeout(() => {
                        if (!typewriterRunning) return;
                        eraseText();
                    }, 2500);
                }
            }

            function eraseText() {
                if (!typewriterRunning) return;
                if (input.value.length > 0) {
                    input.value = input.value.substring(0, input.value.length - 1);
                    typewriterTimeout = setTimeout(eraseText, 15);
                } else {
                    // Move to next example
                    currentExampleIndex = (currentExampleIndex + 1) % aiExamples.length;
                    typewriterTimeout = setTimeout(() => {
                        if (typewriterRunning) typeExample();
                    }, 600);
                }
            }

            typeChar();
        }

        // Start after a short delay
        typewriterTimeout = setTimeout(typeExample, 600);
    }

    // Stop typewriter when user focuses the AI input
    const aiInput = document.getElementById('aiSearchInput');
    if (aiInput) {
        aiInput.addEventListener('focus', () => {
            stopTypewriter();
            // Clear if it's still showing an example
            const isExample = aiExamples.some(ex => aiInput.value === ex || ex.startsWith(aiInput.value));
            if (isExample) {
                aiInput.value = '';
            }
            aiInput.classList.add('user-typing');
            aiInput.placeholder = 'Ask anything about investment properties...';
        });
        aiInput.addEventListener('blur', () => {
            if (aiInput.value.trim() === '') {
                aiInput.classList.remove('user-typing');
                aiInput.placeholder = '';
                startTypewriter();
            }
        });
    }

    searchTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            searchTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const isInvest = tab.dataset.tab === 'invest';

            if (isInvest) {
                standardPanel.style.display = 'none';
                investPanel.style.display = 'flex';
                startTypewriter();
            } else {
                stopTypewriter();
                investPanel.style.display = 'none';
                standardPanel.style.display = 'flex';
            }
        });
    });

    // --- Property Search Form ---
    if (standardPanel) {
        standardPanel.addEventListener('submit', (e) => {
            e.preventDefault();
            const activeTab = document.querySelector('.search-tab.active');
            const type = activeTab ? activeTab.dataset.tab : 'buy';
            const query = standardPanel.querySelector('.search-input').value;
            const contactSection = document.querySelector('#contact');
            if (contactSection) {
                const offset = 80;
                const top = contactSection.getBoundingClientRect().top + window.pageYOffset - offset;
                window.scrollTo({ top, behavior: 'smooth' });
            }
        });
    }

    // --- AI Invest Search Form ---
    if (investPanel) {
        investPanel.addEventListener('submit', (e) => {
            e.preventDefault();
            // Navigate to investoros1.com
            window.open('https://investoros1.com', '_blank');
        });
    }

    // --- Contact Form ---
    const contactForm = document.getElementById('contactForm');
    if (contactForm) {
        contactForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const btn = contactForm.querySelector('button[type="submit"]');
            const originalHTML = btn.innerHTML;
            btn.innerHTML = '<span>Message Sent!</span>';
            btn.style.background = '#28c940';
            btn.disabled = true;

            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.style.background = '';
                btn.disabled = false;
                contactForm.reset();
            }, 3000);
        });
    }

    // --- Smooth Performance ---
    let ticking = false;
    window.addEventListener('scroll', () => {
        if (!ticking) {
            requestAnimationFrame(() => {
                handleParallax();
                ticking = false;
            });
            ticking = true;
        }
    }, { passive: true });

    // =============================================
    //   CHATBOT WIDGET
    // =============================================

    // --- Chatbot State ---
    const chatbotState = {
        isOpen: false,
        currentMode: 'residential',
        messageHistory: [],
        session: {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2),
            startedAt: new Date().toISOString(),
            favorites: [],
            preferences: {},
            searchHistory: []
        }
    };

    // --- Canned Responses ---
    const cannedResponses = {
        residential: {
            greeting: "Hi there! I'm your Residential Agent for South Florida. I can help with neighborhoods, property types, market conditions, and scheduling viewings. How can I help you today?",
            responses: {
                'neighborhood': "South Florida has incredible neighborhoods! **Sunny Isles Beach** is known for luxury oceanfront condos with stunning Atlantic views. **Aventura** offers the perfect blend of family-friendly suburbs with top-rated schools and upscale amenities. **North Miami Beach** is an emerging market with great investment potential. Which area interests you most?",
                'property type': "We specialize in several property types: luxury oceanfront condos, single-family homes, townhouses, and commercial properties. In Sunny Isles, you'll find stunning high-rise condos. Aventura has beautiful family homes and gated communities. What type of property are you looking for?",
                'market': "The South Florida market remains strong. Average condo prices in Sunny Isles Beach are around $1.2M+, while Aventura and North Miami Beach offer more diverse price points. Values have seen approximately 25% growth in emerging areas. Would you like more specific market data for a particular area?",
                'viewing': "We'd love to schedule a viewing for you! The Poler Team is available 7 days a week. You can reach us through the contact form on this page, or I can help you get started. What type of property and area are you interested in seeing?",
                'price': "South Florida offers properties across a wide price spectrum. Luxury condos in Sunny Isles start around $500K for smaller units and can exceed $5M for penthouse units. Aventura homes range from $400K to $3M+. North Miami Beach offers some of the best value with properties starting under $300K. What's your budget range?",
                'schools': "Aventura is known for its A+ rated schools, making it a top choice for families. The area is served by some of the best public and private schools in Miami-Dade County. If school quality is a priority, Aventura is definitely worth exploring. Would you like to learn more about specific neighborhoods there?"
            },
            fallback: "That's a great question! While I'm getting smarter every day, I'd recommend reaching out directly to the Poler Team for detailed information on that topic. You can use the contact form below, or shall I help with neighborhood info, property types, or market conditions?"
        },
        investment: {
            greeting: "Welcome! I'm your Investment Agent. I specialize in ROI analysis, cap rates, cash flow projections, and market comparisons across South Florida. What investment opportunity would you like to explore?",
            responses: {
                'roi': "South Florida investment properties are generating strong returns. Typical ROI ranges from 8-15% annually depending on property type and location. Short-term rentals in Sunny Isles Beach can yield even higher returns during peak season. Want me to break down the numbers for a specific property type?",
                'cap rate': "Cap rates in South Florida vary by area: Sunny Isles Beach averages 4-6% for condos, Aventura ranges 5-7%, and North Miami Beach offers some of the best cap rates at 6-9% as an emerging market. Higher cap rates often indicate more growth potential. Which area are you considering for investment?",
                'cash flow': "Positive cash flow is achievable in several South Florida markets. Monthly rental income for a 2BR condo in Sunny Isles averages $3,500-$6,000, while expenses typically run 40-50% of gross income. North Miami Beach offers lower entry points with proportionally strong rents. Want to explore specific cash flow scenarios?",
                'comparison': "Let me compare our key markets: **Sunny Isles** offers premium appreciation and luxury rental demand. **Aventura** provides steady, family-oriented rental income with lower vacancy. **North Miami Beach** has the highest growth potential with 25% recent value increases. Our investment tool at investoros1.com can run detailed comparisons. Which metrics matter most to you?",
                'airbnb': "Short-term rentals are a hot topic in South Florida! Sunny Isles Beach properties can generate $200-$500/night depending on unit size and ocean views. However, it's important to check building regulations and local ordinances. Some buildings restrict short-term rentals. Want to know which buildings are Airbnb-friendly?",
                'financing': "Investment property financing in South Florida typically requires 20-25% down for conventional loans. Foreign investors have additional options through specific lending programs. Current interest rates and favorable terms make this an attractive time to invest. Would you like to discuss financing strategies for a specific property type?"
            },
            fallback: "Great investment question! For detailed analysis, I'd recommend trying our proprietary Investment Tool at investoros1.com, or reaching out to the Poler Team directly. In the meantime, I can help with ROI analysis, cap rates, cash flow projections, or market comparisons."
        }
    };

    // --- Quick Action Chips Per Mode ---
    const chipsByMode = {
        residential: [
            { label: 'Neighborhoods', keyword: 'neighborhood' },
            { label: 'Property Types', keyword: 'property type' },
            { label: 'Market Conditions', keyword: 'market' },
            { label: 'Schedule Viewing', keyword: 'viewing' },
            { label: 'Price Ranges', keyword: 'price' },
            { label: 'School Ratings', keyword: 'schools' }
        ],
        investment: [
            { label: 'ROI Analysis', keyword: 'roi' },
            { label: 'Cap Rates', keyword: 'cap rate' },
            { label: 'Cash Flow', keyword: 'cash flow' },
            { label: 'Market Comparison', keyword: 'comparison' },
            { label: 'Airbnb / STR', keyword: 'airbnb' },
            { label: 'Financing', keyword: 'financing' }
        ]
    };

    // --- DOM References ---
    const chatBubble = document.getElementById('chatbot-bubble');
    const chatWindow = document.getElementById('chatbot-window');
    const chatClose = document.getElementById('chatbot-close');
    const chatMessages = document.getElementById('chatbot-messages');
    const chatInput = document.getElementById('chatbot-input');
    const chatSendBtn = document.getElementById('chatbot-send');
    const chatTyping = document.getElementById('chatbot-typing');
    const chatChips = document.getElementById('chatbot-chips');
    const chatModeBtns = document.querySelectorAll('.chatbot-mode-btn');

    // --- Chatbot Functions ---

    function toggleChatbot() {
        chatbotState.isOpen = !chatbotState.isOpen;
        chatBubble.classList.toggle('active', chatbotState.isOpen);

        if (chatbotState.isOpen) {
            chatWindow.classList.remove('chatbot-window-hidden');
            chatWindow.classList.add('chatbot-window-visible');
            if (chatbotState.messageHistory.length === 0) {
                showGreeting();
            }
            setTimeout(() => chatInput.focus(), 400);
            if (window.innerWidth <= 768) {
                document.body.style.overflow = 'hidden';
            }
        } else {
            chatWindow.classList.remove('chatbot-window-visible');
            chatWindow.classList.add('chatbot-window-hidden');
            if (window.innerWidth <= 768) {
                document.body.style.overflow = '';
            }
        }
    }

    function closeChatbot() {
        chatbotState.isOpen = false;
        chatBubble.classList.remove('active');
        chatWindow.classList.remove('chatbot-window-visible');
        chatWindow.classList.add('chatbot-window-hidden');
        if (window.innerWidth <= 768) {
            document.body.style.overflow = '';
        }
    }

    function showGreeting() {
        const mode = chatbotState.currentMode;
        const greeting = cannedResponses[mode].greeting;
        addMessage('bot', greeting);
        renderChips();
    }

    function addMessage(role, content) {
        const timestamp = new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });

        const messageData = {
            role,
            content,
            timestamp,
            mode: chatbotState.currentMode
        };

        chatbotState.messageHistory.push(messageData);
        renderMessage(messageData);
        scrollToBottom();
    }

    function renderMessage(msg) {
        const div = document.createElement('div');
        div.className = 'chatbot-msg chatbot-msg-' + (msg.role === 'bot' ? 'bot' : 'user');

        const contentSpan = document.createElement('span');
        contentSpan.innerHTML = msg.content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        const timeSpan = document.createElement('span');
        timeSpan.className = 'chatbot-msg-time';
        timeSpan.textContent = msg.timestamp;

        div.appendChild(contentSpan);
        div.appendChild(timeSpan);
        chatMessages.appendChild(div);
    }

    function scrollToBottom() {
        requestAnimationFrame(() => {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        });
    }

    function renderChips() {
        const chips = chipsByMode[chatbotState.currentMode];
        chatChips.innerHTML = '';
        chips.forEach(chip => {
            const btn = document.createElement('button');
            btn.className = 'chatbot-chip';
            btn.textContent = chip.label;
            btn.addEventListener('click', () => {
                sendMessage(chip.label, chip.keyword);
            });
            chatChips.appendChild(btn);
        });
    }

    /**
     * sendMessage - Single entry point for all user messages.
     * FUTURE LLM: Replace generateResponse() call with API fetch.
     */
    function sendMessage(displayText, lookupKey) {
        if (!displayText.trim()) return;

        addMessage('user', displayText);
        chatInput.value = '';
        chatChips.style.display = 'none';
        showTypingIndicator();

        const delay = 800 + Math.random() * 1200;
        setTimeout(() => {
            hideTypingIndicator();
            const response = generateResponse(displayText, lookupKey);
            addMessage('bot', response);
            chatChips.style.display = 'flex';
            renderChips();
        }, delay);
    }

    /**
     * generateResponse - The function to swap for LLM API call.
     * FUTURE: async function generateResponse(msg) { return await fetch('/api/chat', ...) }
     */
    function generateResponse(userMessage, lookupKey) {
        const mode = chatbotState.currentMode;
        const responses = cannedResponses[mode].responses;

        if (lookupKey && responses[lookupKey]) {
            return responses[lookupKey];
        }

        const messageLower = userMessage.toLowerCase();
        for (const [keyword, response] of Object.entries(responses)) {
            const keywords = keyword.split(' ');
            if (keywords.some(kw => messageLower.includes(kw))) {
                return response;
            }
        }

        return cannedResponses[mode].fallback;
    }

    function showTypingIndicator() {
        chatTyping.style.display = 'block';
        scrollToBottom();
    }

    function hideTypingIndicator() {
        chatTyping.style.display = 'none';
    }

    function switchMode(mode) {
        if (mode === chatbotState.currentMode) return;
        chatbotState.currentMode = mode;

        chatModeBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });

        addMessage('bot', cannedResponses[mode].greeting);
        renderChips();
    }

    // --- Chatbot Event Listeners ---
    chatBubble.addEventListener('click', toggleChatbot);
    chatClose.addEventListener('click', closeChatbot);

    chatSendBtn.addEventListener('click', () => {
        sendMessage(chatInput.value.trim());
    });

    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(chatInput.value.trim());
        }
    });

    chatModeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            switchMode(btn.dataset.mode);
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && chatbotState.isOpen) {
            closeChatbot();
        }
    });

    // Register chatbot elements with custom cursor
    if (window.matchMedia('(pointer: fine)').matches && typeof cursorRing !== 'undefined') {
        document.querySelectorAll('#chatbot-bubble, #chatbot-close, #chatbot-send, .chatbot-mode-btn, .chatbot-chip').forEach(target => {
            target.addEventListener('mouseenter', () => cursorRing.classList.add('hover'));
            target.addEventListener('mouseleave', () => cursorRing.classList.remove('hover'));
        });
    }

    // =============================================
    //   LANGUAGE SWITCHER / i18n SYSTEM
    // =============================================

    const translations = {
        en: {
            // Navigation
            'nav.about': 'About', 'nav.team': 'Team', 'nav.expertise': 'Expertise',
            'nav.areas': 'Areas', 'nav.investment': 'Investment', 'nav.contact': 'Contact',
            // Hero
            'hero.title': 'Miami Real Estate',
            'hero.subtitle': '20 Years of Excellence. 100+ Closings. Your Trusted Real Estate Partners.',
            'hero.buy': 'Buy', 'hero.rent': 'Rent', 'hero.sell': 'Sell', 'hero.invest': 'Invest',
            'hero.searchPlaceholder': 'City, neighborhood, or address...',
            'hero.propertyType': 'Property Type', 'hero.condo': 'Condo', 'hero.house': 'House',
            'hero.townhouse': 'Townhouse', 'hero.commercial': 'Commercial', 'hero.land': 'Land',
            'hero.priceRange': 'Price Range', 'hero.search': 'Search', 'hero.scroll': 'Scroll',
            // Listings
            'listings.tag': 'Properties', 'listings.title': 'Featured', 'listings.titleGradient': 'Listings',
            'listings.exclusive': 'Exclusive Listings', 'listings.openHouses': 'Open Houses',
            'listings.propertySearch': 'Property Search', 'listings.new': 'New', 'listings.featured': 'Featured',
            'listings.comingSoon': 'Coming Soon', 'listings.mlsConnected': 'MLS Connected',
            // Team
            'team.tag': 'Meet the Team', 'team.title': 'The People Behind', 'team.titleGradient': 'Your Success.',
            'team.kevin.role': 'Agent & Investment Analyst',
            'team.kevin.bio': '10+ years experience specializing in investment analysis, commercial real estate, and leveraging technology to find the best deals.',
            'team.rosa.badge': 'View on Homes.com',
            'team.rosa.role': 'Lead Agent & Founder',
            'team.rosa.bio': 'With 20+ years as a top-producing South Florida agent, Rosa brings unmatched market knowledge and trusted client relationships.',
            'team.rosa.link': 'View Full Profile',
            'team.dylan.role': 'Agent & Investment Analyst',
            'team.dylan.bio': '5+ years experience specializing in investment analysis, commercial real estate, and leveraging technology to find the best deals.',
            // Profiles
            'profiles.tag': 'Our Profiles', 'profiles.title': 'Featured On', 'profiles.titleGradient': 'Top Platforms',
            'profiles.verified': 'Verified', 'profiles.teamProfile': 'Team Profile',
            'profiles.agentRole': 'Licensed Real Estate Agent',
            'profiles.rating': '5.0 Rating', 'profiles.reviewCount': '17 Reviews',
            'profiles.yearsExp': 'Years Exp', 'profiles.yearsExp2': 'Years Exp',
            'profiles.closings': 'Closings', 'profiles.reviews': 'Reviews',
            'profiles.totalSales': 'Total Sales', 'profiles.avgPrice': 'Avg Price',
            'profiles.viewHomes': 'View on Homes.com', 'profiles.viewZillow': 'View on Zillow',
            // Social
            'social.label': 'FOLLOW US ON SOCIAL', 'social.followers': '4K+ Combined Followers',
            'social.followUs': 'Follow Us', 'social.getToKnow': 'Get to Know Us',
            // Marquee
            'marquee.luxury': 'Luxury Living', 'marquee.investment': 'Investment Properties',
            'marquee.commercial': 'Commercial Real Estate',
            // Expertise
            'expertise.tag': 'What We Do', 'expertise.titlePrefix': 'Our ', 'expertise.titleGradient': 'Expertise',
            'expertise.residential': 'Residential Sales', 'expertise.commercialTitle': 'Commercial Real Estate',
            'expertise.investmentTitle': 'Investment Analysis', 'expertise.marketTitle': 'Market Intelligence',
            'expertise.residentialDesc': 'From luxury oceanfront condos in Sunny Isles to charming family homes in Aventura, we match you with the perfect property. Every transaction is handled with precision and care.',
            'expertise.commercialDesc': "Deep expertise in South Florida's commercial market. We analyze opportunities, negotiate deals, and ensure your commercial investments deliver maximum value and long-term returns.",
            'expertise.investmentDesc': 'Our proprietary investment tools and 20 years of market data help you make informed decisions. We break down the numbers so you can invest with confidence and clarity.',
            'expertise.marketDesc': "Stay ahead of the curve with our deep understanding of South Florida's real estate trends, pricing dynamics, and neighborhood-level insights that drive smarter decisions.",
            // Areas
            'areas.tag': 'Where We Work', 'areas.titlePrefix': 'Our ', 'areas.titleGradient': 'Markets',
            'areas.oceanfront': 'Oceanfront Living', 'areas.family': 'Family & Luxury', 'areas.emerging': 'Emerging Market',
            'areas.sunnyDesc': 'Known as "Little Moscow," Sunny Isles Beach features stunning high-rise condos along the Atlantic, world-class dining, and a vibrant international community. We know every building, every view, every opportunity.',
            'areas.aventuraDesc': 'Home to the iconic Aventura Mall and surrounded by waterways, Aventura offers the perfect blend of suburban tranquility and urban sophistication. Exceptional schools, parks, and an unbeatable lifestyle.',
            'areas.nmbDesc': "A rapidly evolving market with incredible investment potential. North Miami Beach combines affordability with proximity to the beach, making it one of South Florida's most exciting areas for buyers and investors alike.",
            'areas.avgCondo': 'Avg. Condo Price', 'areas.luxuryTowers': 'Luxury Towers',
            'areas.schoolRating': 'School Rating', 'areas.flCommunities': 'FL Communities',
            'areas.valueGrowth': 'Value Growth', 'areas.investZone': 'Investment Zone',
            // About
            'about.tag': 'Who We Are', 'about.title': 'South Florida Real Estate,', 'about.titleGradient': 'Reimagined.',
            'about.skyline': 'MIAMI SKYLINE', 'about.luxury': 'LUXURY LIVING',
            'about.expText': 'Years of<br>Excellence',
            'about.text1': "With two decades of experience navigating South Florida's dynamic real estate market, the Poler Team has established itself as the go-to experts for both residential and commercial properties. Our deep knowledge of Sunny Isles, Aventura, and North Miami Beach gives our clients an unmatched advantage.",
            'about.text2': "Whether you're searching for your dream waterfront condo, a family home, or a strategic commercial investment, we combine market intelligence with personalized service to deliver results that exceed expectations.",
            'about.feature1': 'Residential Expertise', 'about.feature1Desc': 'Luxury condos, waterfront properties & family homes',
            'about.feature2': 'Commercial & Investment', 'about.feature2Desc': 'Strategic analysis & high-yield opportunities',
            // Parallax
            'parallax.title': 'Ready to Invest Smarter?', 'parallax.subtitle': 'Discover our powerful investment SEARCH tool',
            // Investment
            'invest.tag': 'Our Secret Weapon', 'invest.title': 'Analyze Investments', 'invest.titleGradient': 'Like a Pro.',
            'invest.desc': "We've built a powerful, proprietary investment analysis tool that gives you the edge. Run the numbers on any property, compare returns, and make data-driven decisions with confidence.",
            'invest.f1': 'ROI & Cash Flow Analysis', 'invest.f2': 'Cap Rate Calculations',
            'invest.f3': 'Market Comparison Tools', 'invest.f4': 'Expense & Revenue Projections',
            'invest.cta': 'Try Our Investment Tool',
            'invest.roi': 'ROI', 'invest.capRate': 'Cap Rate', 'invest.cashFlow': 'Cash Flow',
            'invest.liveData': 'Live Market Data', 'invest.projections': 'Profit Projections',
            // Stats
            'stats.experience': 'Years of Experience', 'stats.closings': 'Successful Closings',
            'stats.clients': 'Happy Clients', 'stats.markets': 'Expert Market Areas',
            // Trust
            'trust.quote': "The Poler Team didn't just help us find a home \u2014 they found us the perfect investment. Their market knowledge and analysis tools are second to none.",
            'trust.author': 'Satisfied Client, Sunny Isles Beach',
            // Contact
            'contact.tag': 'Get In Touch', 'contact.title': "Let's Find Your", 'contact.titleGradient': 'Next Property.',
            'contact.desc': "Whether you're buying, selling, or investing, we're here to guide you every step of the way. Reach out today and let's start your real estate journey.",
            'contact.location': 'Location', 'contact.phone': 'Phone', 'contact.email': 'Email',
            'contact.phoneDesc': 'Call or Text Anytime',
            'contact.formName': 'Your Name', 'contact.formEmail': 'Email Address',
            'contact.formPhone': 'Phone Number', 'contact.formInterest': "I'm Interested In",
            'contact.buying': 'Buying a Property', 'contact.selling': 'Selling a Property',
            'contact.investing': 'Investment Analysis', 'contact.commercial': 'Commercial Real Estate',
            'contact.other': 'Other', 'contact.formMessage': 'Your Message', 'contact.submit': 'Send Message',
            // Footer
            'footer.desc': 'Your trusted South Florida real estate experts. Two decades of experience, hundreds of happy clients, and a passion for finding the perfect property.',
            'footer.quickLinks': 'Quick Links', 'footer.markets': 'Markets', 'footer.tools': 'Tools',
            'footer.aboutUs': 'About Us', 'footer.ourExpertise': 'Our Expertise',
            'footer.marketAreas': 'Market Areas', 'footer.investTool': 'Investment Tool',
            'footer.contact': 'Contact', 'footer.analyzer': 'Investment Analyzer',
            'footer.copyright': '\u00a9 2025 The Poler Team. All rights reserved.',
            // Chatbot
            'chatbot.title': 'Poler Team Assistant', 'chatbot.status': 'Online',
            'chatbot.residential': 'Residential Agent', 'chatbot.investment': 'Investment Agent',
            'chatbot.placeholder': 'Type a message...'
        },
        es: {
            // Navigation
            'nav.about': 'Nosotros', 'nav.team': 'Equipo', 'nav.expertise': 'Servicios',
            'nav.areas': 'Zonas', 'nav.investment': 'Inversi\u00f3n', 'nav.contact': 'Contacto',
            // Hero
            'hero.title': 'Bienes Ra\u00edces en Miami',
            'hero.subtitle': '20 A\u00f1os de Excelencia. 100+ Cierres. Sus Socios Inmobiliarios de Confianza.',
            'hero.buy': 'Comprar', 'hero.rent': 'Alquilar', 'hero.sell': 'Vender', 'hero.invest': 'Invertir',
            'hero.searchPlaceholder': 'Ciudad, barrio o direcci\u00f3n...',
            'hero.propertyType': 'Tipo de Propiedad', 'hero.condo': 'Condominio', 'hero.house': 'Casa',
            'hero.townhouse': 'Townhouse', 'hero.commercial': 'Comercial', 'hero.land': 'Terreno',
            'hero.priceRange': 'Rango de Precio', 'hero.search': 'Buscar', 'hero.scroll': 'Desplazar',
            // Listings
            'listings.tag': 'Propiedades', 'listings.title': 'Listados', 'listings.titleGradient': 'Destacados',
            'listings.exclusive': 'Listados Exclusivos', 'listings.openHouses': 'Casas Abiertas',
            'listings.propertySearch': 'Buscar Propiedades', 'listings.new': 'Nuevo', 'listings.featured': 'Destacado',
            'listings.comingSoon': 'Pr\u00f3ximamente', 'listings.mlsConnected': 'Conectado al MLS',
            // Team
            'team.tag': 'Nuestro Equipo', 'team.title': 'Las Personas Detr\u00e1s', 'team.titleGradient': 'De Su \u00c9xito.',
            'team.kevin.role': 'Agente y Analista de Inversiones',
            'team.kevin.bio': '10+ a\u00f1os de experiencia especializado en an\u00e1lisis de inversiones, bienes ra\u00edces comerciales y aprovechamiento de tecnolog\u00eda para encontrar las mejores oportunidades.',
            'team.rosa.badge': 'Ver en Homes.com',
            'team.rosa.role': 'Agente Principal y Fundadora',
            'team.rosa.bio': 'Con m\u00e1s de 20 a\u00f1os como agente top en el sur de Florida, Rosa aporta un conocimiento incomparable del mercado y relaciones de confianza con sus clientes.',
            'team.rosa.link': 'Ver Perfil Completo',
            'team.dylan.role': 'Agente y Analista de Inversiones',
            'team.dylan.bio': '5+ a\u00f1os de experiencia especializado en an\u00e1lisis de inversiones, bienes ra\u00edces comerciales y aprovechamiento de tecnolog\u00eda para encontrar las mejores oportunidades.',
            // Profiles
            'profiles.tag': 'Nuestros Perfiles', 'profiles.title': 'Destacados En', 'profiles.titleGradient': 'Plataformas Top',
            'profiles.verified': 'Verificado', 'profiles.teamProfile': 'Perfil del Equipo',
            'profiles.agentRole': 'Agente Inmobiliaria Licenciada',
            'profiles.rating': 'Calificaci\u00f3n 5.0', 'profiles.reviewCount': '17 Rese\u00f1as',
            'profiles.yearsExp': 'A\u00f1os Exp', 'profiles.yearsExp2': 'A\u00f1os Exp',
            'profiles.closings': 'Cierres', 'profiles.reviews': 'Rese\u00f1as',
            'profiles.totalSales': 'Ventas Totales', 'profiles.avgPrice': 'Precio Prom.',
            'profiles.viewHomes': 'Ver en Homes.com', 'profiles.viewZillow': 'Ver en Zillow',
            // Social
            'social.label': 'S\u00cdGUENOS EN REDES', 'social.followers': '4K+ Seguidores Combinados',
            'social.followUs': 'S\u00edguenos', 'social.getToKnow': 'Con\u00f3cenos',
            // Marquee
            'marquee.luxury': 'Vida de Lujo', 'marquee.investment': 'Propiedades de Inversi\u00f3n',
            'marquee.commercial': 'Bienes Ra\u00edces Comerciales',
            // Expertise
            'expertise.tag': 'Lo Que Hacemos', 'expertise.titlePrefix': 'Nuestra ', 'expertise.titleGradient': 'Experiencia',
            'expertise.residential': 'Ventas Residenciales', 'expertise.commercialTitle': 'Bienes Ra\u00edces Comerciales',
            'expertise.investmentTitle': 'An\u00e1lisis de Inversiones', 'expertise.marketTitle': 'Inteligencia de Mercado',
            'expertise.residentialDesc': 'Desde lujosos condominios frente al mar en Sunny Isles hasta encantadoras casas familiares en Aventura, le conectamos con la propiedad perfecta. Cada transacci\u00f3n se maneja con precisi\u00f3n y cuidado.',
            'expertise.commercialDesc': 'Profunda experiencia en el mercado comercial del sur de Florida. Analizamos oportunidades, negociamos acuerdos y aseguramos que sus inversiones comerciales entreguen el m\u00e1ximo valor y retornos a largo plazo.',
            'expertise.investmentDesc': 'Nuestras herramientas de inversi\u00f3n propietarias y 20 a\u00f1os de datos del mercado le ayudan a tomar decisiones informadas. Desglosamos los n\u00fameros para que pueda invertir con confianza y claridad.',
            'expertise.marketDesc': 'Mant\u00e9ngase a la vanguardia con nuestro profundo conocimiento de las tendencias inmobiliarias del sur de Florida, din\u00e1micas de precios e insights a nivel de vecindario que impulsan decisiones m\u00e1s inteligentes.',
            // Areas
            'areas.tag': 'D\u00f3nde Trabajamos', 'areas.titlePrefix': 'Nuestros ', 'areas.titleGradient': 'Mercados',
            'areas.oceanfront': 'Vida Frente al Mar', 'areas.family': 'Familia y Lujo', 'areas.emerging': 'Mercado Emergente',
            'areas.sunnyDesc': 'Conocido como "Little Moscow", Sunny Isles Beach presenta impresionantes condominios de gran altura a lo largo del Atl\u00e1ntico, gastronom\u00eda de clase mundial y una vibrante comunidad internacional. Conocemos cada edificio, cada vista, cada oportunidad.',
            'areas.aventuraDesc': 'Hogar del ic\u00f3nico Aventura Mall y rodeado de canales, Aventura ofrece la mezcla perfecta de tranquilidad suburbana y sofisticaci\u00f3n urbana. Escuelas excepcionales, parques y un estilo de vida inigualable.',
            'areas.nmbDesc': 'Un mercado en r\u00e1pida evoluci\u00f3n con incre\u00edble potencial de inversi\u00f3n. North Miami Beach combina asequibilidad con proximidad a la playa, convirti\u00e9ndolo en una de las zonas m\u00e1s emocionantes del sur de Florida para compradores e inversores.',
            'areas.avgCondo': 'Precio Prom. Condo', 'areas.luxuryTowers': 'Torres de Lujo',
            'areas.schoolRating': 'Rating Escolar', 'areas.flCommunities': 'Comunidades FL',
            'areas.valueGrowth': 'Crecimiento', 'areas.investZone': 'Zona de Inversi\u00f3n',
            // About
            'about.tag': 'Qui\u00e9nes Somos', 'about.title': 'Bienes Ra\u00edces del Sur de Florida,', 'about.titleGradient': 'Reinventados.',
            'about.skyline': 'HORIZONTE DE MIAMI', 'about.luxury': 'VIDA DE LUJO',
            'about.expText': 'A\u00f1os de<br>Excelencia',
            'about.text1': 'Con dos d\u00e9cadas de experiencia navegando el din\u00e1mico mercado inmobiliario del sur de Florida, el Poler Team se ha establecido como los expertos de referencia tanto para propiedades residenciales como comerciales. Nuestro profundo conocimiento de Sunny Isles, Aventura y North Miami Beach le da a nuestros clientes una ventaja inigualable.',
            'about.text2': 'Ya sea que busque su condominio so\u00f1ado frente al mar, una casa familiar o una inversi\u00f3n comercial estrat\u00e9gica, combinamos inteligencia de mercado con servicio personalizado para entregar resultados que superan las expectativas.',
            'about.feature1': 'Experiencia Residencial', 'about.feature1Desc': 'Condos de lujo, propiedades frente al agua y hogares familiares',
            'about.feature2': 'Comercial e Inversi\u00f3n', 'about.feature2Desc': 'An\u00e1lisis estrat\u00e9gico y oportunidades de alto rendimiento',
            // Parallax
            'parallax.title': '\u00bfListo para Invertir M\u00e1s Inteligente?', 'parallax.subtitle': 'Descubra nuestra poderosa herramienta de b\u00fasqueda de inversiones',
            // Investment
            'invest.tag': 'Nuestra Arma Secreta', 'invest.title': 'Analice Inversiones', 'invest.titleGradient': 'Como un Profesional.',
            'invest.desc': 'Hemos construido una poderosa herramienta de an\u00e1lisis de inversiones propietaria que le da la ventaja. Calcule los n\u00fameros de cualquier propiedad, compare retornos y tome decisiones basadas en datos con confianza.',
            'invest.f1': 'An\u00e1lisis de ROI y Flujo de Caja', 'invest.f2': 'C\u00e1lculos de Tasa de Capitalizaci\u00f3n',
            'invest.f3': 'Herramientas de Comparaci\u00f3n de Mercado', 'invest.f4': 'Proyecciones de Gastos e Ingresos',
            'invest.cta': 'Pruebe Nuestra Herramienta',
            'invest.roi': 'ROI', 'invest.capRate': 'Tasa Cap', 'invest.cashFlow': 'Flujo de Caja',
            'invest.liveData': 'Datos del Mercado en Vivo', 'invest.projections': 'Proyecciones de Ganancia',
            // Stats
            'stats.experience': 'A\u00f1os de Experiencia', 'stats.closings': 'Cierres Exitosos',
            'stats.clients': 'Clientes Felices', 'stats.markets': 'Zonas de Mercado Expertas',
            // Trust
            'trust.quote': 'El Poler Team no solo nos ayud\u00f3 a encontrar un hogar \u2014 nos encontraron la inversi\u00f3n perfecta. Su conocimiento del mercado y herramientas de an\u00e1lisis son insuperables.',
            'trust.author': 'Cliente Satisfecho, Sunny Isles Beach',
            // Contact
            'contact.tag': 'Cont\u00e1ctenos', 'contact.title': 'Encontremos Su', 'contact.titleGradient': 'Pr\u00f3xima Propiedad.',
            'contact.desc': 'Ya sea que est\u00e9 comprando, vendiendo o invirtiendo, estamos aqu\u00ed para guiarle en cada paso del camino. Cont\u00e1ctenos hoy y comencemos su viaje inmobiliario.',
            'contact.location': 'Ubicaci\u00f3n', 'contact.phone': 'Tel\u00e9fono', 'contact.email': 'Correo',
            'contact.phoneDesc': 'Llame o Env\u00ede Mensaje',
            'contact.formName': 'Su Nombre', 'contact.formEmail': 'Correo Electr\u00f3nico',
            'contact.formPhone': 'N\u00famero de Tel\u00e9fono', 'contact.formInterest': 'Me Interesa',
            'contact.buying': 'Comprar una Propiedad', 'contact.selling': 'Vender una Propiedad',
            'contact.investing': 'An\u00e1lisis de Inversi\u00f3n', 'contact.commercial': 'Bienes Ra\u00edces Comerciales',
            'contact.other': 'Otro', 'contact.formMessage': 'Su Mensaje', 'contact.submit': 'Enviar Mensaje',
            // Footer
            'footer.desc': 'Sus expertos inmobiliarios de confianza en el sur de Florida. Dos d\u00e9cadas de experiencia, cientos de clientes felices y pasi\u00f3n por encontrar la propiedad perfecta.',
            'footer.quickLinks': 'Enlaces R\u00e1pidos', 'footer.markets': 'Mercados', 'footer.tools': 'Herramientas',
            'footer.aboutUs': 'Nosotros', 'footer.ourExpertise': 'Nuestros Servicios',
            'footer.marketAreas': 'Zonas de Mercado', 'footer.investTool': 'Herramienta de Inversi\u00f3n',
            'footer.contact': 'Contacto', 'footer.analyzer': 'Analizador de Inversiones',
            'footer.copyright': '\u00a9 2025 The Poler Team. Todos los derechos reservados.',
            // Chatbot
            'chatbot.title': 'Asistente Poler Team', 'chatbot.status': 'En L\u00ednea',
            'chatbot.residential': 'Agente Residencial', 'chatbot.investment': 'Agente de Inversi\u00f3n',
            'chatbot.placeholder': 'Escribe un mensaje...'
        },
        pt: {
            // Navigation
            'nav.about': 'Sobre', 'nav.team': 'Equipe', 'nav.expertise': 'Servi\u00e7os',
            'nav.areas': 'Regi\u00f5es', 'nav.investment': 'Investimento', 'nav.contact': 'Contato',
            // Hero
            'hero.title': 'Im\u00f3veis em Miami',
            'hero.subtitle': '20 Anos de Excel\u00eancia. 100+ Fechamentos. Seus Parceiros Imobili\u00e1rios de Confian\u00e7a.',
            'hero.buy': 'Comprar', 'hero.rent': 'Alugar', 'hero.sell': 'Vender', 'hero.invest': 'Investir',
            'hero.searchPlaceholder': 'Cidade, bairro ou endere\u00e7o...',
            'hero.propertyType': 'Tipo de Im\u00f3vel', 'hero.condo': 'Apartamento', 'hero.house': 'Casa',
            'hero.townhouse': 'Sobrado', 'hero.commercial': 'Comercial', 'hero.land': 'Terreno',
            'hero.priceRange': 'Faixa de Pre\u00e7o', 'hero.search': 'Buscar', 'hero.scroll': 'Rolar',
            // Listings
            'listings.tag': 'Propriedades', 'listings.title': 'Listagens', 'listings.titleGradient': 'Destaques',
            'listings.exclusive': 'Listagens Exclusivas', 'listings.openHouses': 'Casas Abertas',
            'listings.propertySearch': 'Buscar Im\u00f3veis', 'listings.new': 'Novo', 'listings.featured': 'Destaque',
            'listings.comingSoon': 'Em Breve', 'listings.mlsConnected': 'Conectado ao MLS',
            // Team
            'team.tag': 'Nossa Equipe', 'team.title': 'As Pessoas Por Tr\u00e1s', 'team.titleGradient': 'Do Seu Sucesso.',
            'team.kevin.role': 'Agente e Analista de Investimentos',
            'team.kevin.bio': '10+ anos de experi\u00eancia especializado em an\u00e1lise de investimentos, im\u00f3veis comerciais e uso de tecnologia para encontrar as melhores oportunidades.',
            'team.rosa.badge': 'Ver no Homes.com',
            'team.rosa.role': 'Agente Principal e Fundadora',
            'team.rosa.bio': 'Com mais de 20 anos como agente top no sul da Fl\u00f3rida, Rosa traz conhecimento incompar\u00e1vel do mercado e relacionamentos de confian\u00e7a com seus clientes.',
            'team.rosa.link': 'Ver Perfil Completo',
            'team.dylan.role': 'Agente e Analista de Investimentos',
            'team.dylan.bio': '5+ anos de experi\u00eancia especializado em an\u00e1lise de investimentos, im\u00f3veis comerciais e uso de tecnologia para encontrar as melhores oportunidades.',
            // Profiles
            'profiles.tag': 'Nossos Perfis', 'profiles.title': 'Destaque Nas', 'profiles.titleGradient': 'Principais Plataformas',
            'profiles.verified': 'Verificado', 'profiles.teamProfile': 'Perfil da Equipe',
            'profiles.agentRole': 'Agente Imobili\u00e1ria Licenciada',
            'profiles.rating': 'Avalia\u00e7\u00e3o 5.0', 'profiles.reviewCount': '17 Avalia\u00e7\u00f5es',
            'profiles.yearsExp': 'Anos Exp', 'profiles.yearsExp2': 'Anos Exp',
            'profiles.closings': 'Fechamentos', 'profiles.reviews': 'Avalia\u00e7\u00f5es',
            'profiles.totalSales': 'Vendas Totais', 'profiles.avgPrice': 'Pre\u00e7o M\u00e9dio',
            'profiles.viewHomes': 'Ver no Homes.com', 'profiles.viewZillow': 'Ver no Zillow',
            // Social
            'social.label': 'SIGA-NOS NAS REDES', 'social.followers': '4K+ Seguidores Combinados',
            'social.followUs': 'Siga-nos', 'social.getToKnow': 'Conhe\u00e7a-nos',
            // Marquee
            'marquee.luxury': 'Vida de Luxo', 'marquee.investment': 'Im\u00f3veis para Investimento',
            'marquee.commercial': 'Im\u00f3veis Comerciais',
            // Expertise
            'expertise.tag': 'O Que Fazemos', 'expertise.titlePrefix': 'Nossa ', 'expertise.titleGradient': 'Especialidade',
            'expertise.residential': 'Vendas Residenciais', 'expertise.commercialTitle': 'Im\u00f3veis Comerciais',
            'expertise.investmentTitle': 'An\u00e1lise de Investimentos', 'expertise.marketTitle': 'Intelig\u00eancia de Mercado',
            'expertise.residentialDesc': 'De luxuosos apartamentos \u00e0 beira-mar em Sunny Isles a encantadoras casas familiares em Aventura, conectamos voc\u00ea ao im\u00f3vel perfeito. Cada transa\u00e7\u00e3o \u00e9 tratada com precis\u00e3o e cuidado.',
            'expertise.commercialDesc': 'Profunda experi\u00eancia no mercado comercial do sul da Fl\u00f3rida. Analisamos oportunidades, negociamos acordos e garantimos que seus investimentos comerciais entreguem m\u00e1ximo valor e retornos de longo prazo.',
            'expertise.investmentDesc': 'Nossas ferramentas propriet\u00e1rias de investimento e 20 anos de dados do mercado ajudam voc\u00ea a tomar decis\u00f5es informadas. Detalhamos os n\u00fameros para que voc\u00ea invista com confian\u00e7a e clareza.',
            'expertise.marketDesc': 'Fique \u00e0 frente com nosso profundo entendimento das tend\u00eancias imobili\u00e1rias do sul da Fl\u00f3rida, din\u00e2micas de pre\u00e7os e insights de vizinhan\u00e7a que impulsionam decis\u00f5es mais inteligentes.',
            // Areas
            'areas.tag': 'Onde Atuamos', 'areas.titlePrefix': 'Nossos ', 'areas.titleGradient': 'Mercados',
            'areas.oceanfront': 'Vida \u00e0 Beira-Mar', 'areas.family': 'Fam\u00edlia e Luxo', 'areas.emerging': 'Mercado Emergente',
            'areas.sunnyDesc': 'Conhecida como "Little Moscow", Sunny Isles Beach apresenta impressionantes condom\u00ednios de alto padr\u00e3o ao longo do Atl\u00e2ntico, gastronomia de classe mundial e uma vibrante comunidade internacional. Conhecemos cada pr\u00e9dio, cada vista, cada oportunidade.',
            'areas.aventuraDesc': 'Lar do ic\u00f4nico Aventura Mall e cercada por canais, Aventura oferece a mistura perfeita de tranquilidade suburbana e sofistica\u00e7\u00e3o urbana. Escolas excepcionais, parques e um estilo de vida incompar\u00e1vel.',
            'areas.nmbDesc': 'Um mercado em r\u00e1pida evolu\u00e7\u00e3o com incr\u00edvel potencial de investimento. North Miami Beach combina acessibilidade com proximidade da praia, tornando-se uma das \u00e1reas mais empolgantes do sul da Fl\u00f3rida para compradores e investidores.',
            'areas.avgCondo': 'Pre\u00e7o M\u00e9dio Apto', 'areas.luxuryTowers': 'Torres de Luxo',
            'areas.schoolRating': 'Nota Escolar', 'areas.flCommunities': 'Comunidades FL',
            'areas.valueGrowth': 'Valoriza\u00e7\u00e3o', 'areas.investZone': 'Zona de Investimento',
            // About
            'about.tag': 'Quem Somos', 'about.title': 'Im\u00f3veis no Sul da Fl\u00f3rida,', 'about.titleGradient': 'Reinventados.',
            'about.skyline': 'HORIZONTE DE MIAMI', 'about.luxury': 'VIDA DE LUXO',
            'about.expText': 'Anos de<br>Excel\u00eancia',
            'about.text1': 'Com duas d\u00e9cadas de experi\u00eancia navegando o din\u00e2mico mercado imobili\u00e1rio do sul da Fl\u00f3rida, o Poler Team se estabeleceu como os especialistas de refer\u00eancia tanto para im\u00f3veis residenciais quanto comerciais. Nosso profundo conhecimento de Sunny Isles, Aventura e North Miami Beach d\u00e1 aos nossos clientes uma vantagem incompar\u00e1vel.',
            'about.text2': 'Seja procurando seu apartamento dos sonhos \u00e0 beira-mar, uma casa familiar ou um investimento comercial estrat\u00e9gico, combinamos intelig\u00eancia de mercado com servi\u00e7o personalizado para entregar resultados que superam as expectativas.',
            'about.feature1': 'Especialidade Residencial', 'about.feature1Desc': 'Apartamentos de luxo, im\u00f3veis \u00e0 beira-mar e casas familiares',
            'about.feature2': 'Comercial e Investimento', 'about.feature2Desc': 'An\u00e1lise estrat\u00e9gica e oportunidades de alto rendimento',
            // Parallax
            'parallax.title': 'Pronto para Investir Melhor?', 'parallax.subtitle': 'Descubra nossa poderosa ferramenta de busca de investimentos',
            // Investment
            'invest.tag': 'Nossa Arma Secreta', 'invest.title': 'Analise Investimentos', 'invest.titleGradient': 'Como um Profissional.',
            'invest.desc': 'Constru\u00edmos uma poderosa ferramenta propriet\u00e1ria de an\u00e1lise de investimentos que lhe d\u00e1 a vantagem. Calcule os n\u00fameros de qualquer im\u00f3vel, compare retornos e tome decis\u00f5es baseadas em dados com confian\u00e7a.',
            'invest.f1': 'An\u00e1lise de ROI e Fluxo de Caixa', 'invest.f2': 'C\u00e1lculos de Taxa de Capitaliza\u00e7\u00e3o',
            'invest.f3': 'Ferramentas de Compara\u00e7\u00e3o de Mercado', 'invest.f4': 'Proje\u00e7\u00f5es de Despesas e Receitas',
            'invest.cta': 'Experimente Nossa Ferramenta',
            'invest.roi': 'ROI', 'invest.capRate': 'Taxa Cap', 'invest.cashFlow': 'Fluxo de Caixa',
            'invest.liveData': 'Dados do Mercado ao Vivo', 'invest.projections': 'Proje\u00e7\u00f5es de Lucro',
            // Stats
            'stats.experience': 'Anos de Experi\u00eancia', 'stats.closings': 'Fechamentos de Sucesso',
            'stats.clients': 'Clientes Satisfeitos', 'stats.markets': '\u00c1reas de Mercado Especializadas',
            // Trust
            'trust.quote': 'O Poler Team n\u00e3o apenas nos ajudou a encontrar uma casa \u2014 eles encontraram o investimento perfeito. Seu conhecimento de mercado e ferramentas de an\u00e1lise s\u00e3o insuper\u00e1veis.',
            'trust.author': 'Cliente Satisfeito, Sunny Isles Beach',
            // Contact
            'contact.tag': 'Entre em Contato', 'contact.title': 'Vamos Encontrar Seu', 'contact.titleGradient': 'Pr\u00f3ximo Im\u00f3vel.',
            'contact.desc': 'Seja comprando, vendendo ou investindo, estamos aqui para gui\u00e1-lo em cada passo do caminho. Entre em contato hoje e vamos come\u00e7ar sua jornada imobili\u00e1ria.',
            'contact.location': 'Localiza\u00e7\u00e3o', 'contact.phone': 'Telefone', 'contact.email': 'E-mail',
            'contact.phoneDesc': 'Ligue ou Envie Mensagem',
            'contact.formName': 'Seu Nome', 'contact.formEmail': 'Endere\u00e7o de E-mail',
            'contact.formPhone': 'N\u00famero de Telefone', 'contact.formInterest': 'Tenho Interesse Em',
            'contact.buying': 'Comprar um Im\u00f3vel', 'contact.selling': 'Vender um Im\u00f3vel',
            'contact.investing': 'An\u00e1lise de Investimento', 'contact.commercial': 'Im\u00f3veis Comerciais',
            'contact.other': 'Outro', 'contact.formMessage': 'Sua Mensagem', 'contact.submit': 'Enviar Mensagem',
            // Footer
            'footer.desc': 'Seus especialistas imobili\u00e1rios de confian\u00e7a no sul da Fl\u00f3rida. Duas d\u00e9cadas de experi\u00eancia, centenas de clientes satisfeitos e paix\u00e3o por encontrar o im\u00f3vel perfeito.',
            'footer.quickLinks': 'Links R\u00e1pidos', 'footer.markets': 'Mercados', 'footer.tools': 'Ferramentas',
            'footer.aboutUs': 'Sobre N\u00f3s', 'footer.ourExpertise': 'Nossos Servi\u00e7os',
            'footer.marketAreas': '\u00c1reas de Mercado', 'footer.investTool': 'Ferramenta de Investimento',
            'footer.contact': 'Contato', 'footer.analyzer': 'Analisador de Investimentos',
            'footer.copyright': '\u00a9 2025 The Poler Team. Todos os direitos reservados.',
            // Chatbot
            'chatbot.title': 'Assistente Poler Team', 'chatbot.status': 'Online',
            'chatbot.residential': 'Agente Residencial', 'chatbot.investment': 'Agente de Investimento',
            'chatbot.placeholder': 'Digite uma mensagem...'
        }
    };

    // --- Language State ---
    let currentLanguage = localStorage.getItem('poler-lang') || 'en';

    // --- Set Language Function ---
    function setLanguage(lang) {
        currentLanguage = lang;
        localStorage.setItem('poler-lang', lang);
        document.documentElement.lang = lang;

        const t = translations[lang];
        if (!t) return;

        // Update all data-i18n elements (text content)
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (t[key] !== undefined) {
                if (t[key].includes('<br>')) {
                    el.innerHTML = t[key];
                } else {
                    el.textContent = t[key];
                }
            }
        });

        // Update placeholders
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (t[key] !== undefined) {
                el.placeholder = t[key];
            }
        });

        // Update data-text attributes (nav link hover effects)
        document.querySelectorAll('[data-i18n-data-text]').forEach(el => {
            const key = el.getAttribute('data-i18n-data-text');
            if (t[key] !== undefined) {
                el.setAttribute('data-text', t[key]);
            }
        });

        // Update active state on all language buttons (desktop + mobile)
        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
        });

        // Update page title
        const titles = {
            en: 'The Poler Team | South Florida Real Estate Experts',
            es: 'The Poler Team | Expertos en Bienes Ra\u00edces del Sur de Florida',
            pt: 'The Poler Team | Especialistas em Im\u00f3veis no Sul da Fl\u00f3rida'
        };
        document.title = titles[lang] || titles.en;

        // Update chatbot language
        updateChatbotLanguage(lang);
    }

    // --- Update Chatbot Language ---
    function updateChatbotLanguage(lang) {
        const chatbotI18n = {
            en: {
                greetings: {
                    residential: "Hi there! I'm your Residential Agent for South Florida. I can help with neighborhoods, property types, market conditions, and scheduling viewings. How can I help you today?",
                    investment: "Welcome! I'm your Investment Agent. I specialize in ROI analysis, cap rates, cash flow projections, and market comparisons across South Florida. What investment opportunity would you like to explore?"
                },
                chips: {
                    residential: [
                        { label: 'Neighborhoods', keyword: 'neighborhood' },
                        { label: 'Property Types', keyword: 'property type' },
                        { label: 'Market Conditions', keyword: 'market' },
                        { label: 'Schedule Viewing', keyword: 'viewing' },
                        { label: 'Price Ranges', keyword: 'price' },
                        { label: 'School Ratings', keyword: 'schools' }
                    ],
                    investment: [
                        { label: 'ROI Analysis', keyword: 'roi' },
                        { label: 'Cap Rates', keyword: 'cap rate' },
                        { label: 'Cash Flow', keyword: 'cash flow' },
                        { label: 'Market Comparison', keyword: 'comparison' },
                        { label: 'Airbnb / STR', keyword: 'airbnb' },
                        { label: 'Financing', keyword: 'financing' }
                    ]
                }
            },
            es: {
                greetings: {
                    residential: "\u00a1Hola! Soy su Agente Residencial para el sur de Florida. Puedo ayudarle con vecindarios, tipos de propiedades, condiciones del mercado y programar visitas. \u00bfC\u00f3mo puedo ayudarle hoy?",
                    investment: "\u00a1Bienvenido! Soy su Agente de Inversiones. Me especializo en an\u00e1lisis de ROI, tasas de capitalizaci\u00f3n, proyecciones de flujo de caja y comparaciones de mercado en el sur de Florida. \u00bfQu\u00e9 oportunidad de inversi\u00f3n le gustar\u00eda explorar?"
                },
                chips: {
                    residential: [
                        { label: 'Vecindarios', keyword: 'neighborhood' },
                        { label: 'Tipos de Propiedad', keyword: 'property type' },
                        { label: 'Condiciones del Mercado', keyword: 'market' },
                        { label: 'Programar Visita', keyword: 'viewing' },
                        { label: 'Rangos de Precio', keyword: 'price' },
                        { label: 'Calificaci\u00f3n Escolar', keyword: 'schools' }
                    ],
                    investment: [
                        { label: 'An\u00e1lisis ROI', keyword: 'roi' },
                        { label: 'Tasas Cap', keyword: 'cap rate' },
                        { label: 'Flujo de Caja', keyword: 'cash flow' },
                        { label: 'Comparaci\u00f3n de Mercado', keyword: 'comparison' },
                        { label: 'Airbnb / STR', keyword: 'airbnb' },
                        { label: 'Financiamiento', keyword: 'financing' }
                    ]
                }
            },
            pt: {
                greetings: {
                    residential: "Ol\u00e1! Sou seu Agente Residencial para o sul da Fl\u00f3rida. Posso ajudar com bairros, tipos de im\u00f3veis, condi\u00e7\u00f5es de mercado e agendamento de visitas. Como posso ajud\u00e1-lo hoje?",
                    investment: "Bem-vindo! Sou seu Agente de Investimentos. Especializo-me em an\u00e1lise de ROI, taxas de capitaliza\u00e7\u00e3o, proje\u00e7\u00f5es de fluxo de caixa e compara\u00e7\u00f5es de mercado no sul da Fl\u00f3rida. Que oportunidade de investimento gostaria de explorar?"
                },
                chips: {
                    residential: [
                        { label: 'Bairros', keyword: 'neighborhood' },
                        { label: 'Tipos de Im\u00f3vel', keyword: 'property type' },
                        { label: 'Condi\u00e7\u00f5es do Mercado', keyword: 'market' },
                        { label: 'Agendar Visita', keyword: 'viewing' },
                        { label: 'Faixas de Pre\u00e7o', keyword: 'price' },
                        { label: 'Nota Escolar', keyword: 'schools' }
                    ],
                    investment: [
                        { label: 'An\u00e1lise ROI', keyword: 'roi' },
                        { label: 'Taxas Cap', keyword: 'cap rate' },
                        { label: 'Fluxo de Caixa', keyword: 'cash flow' },
                        { label: 'Compara\u00e7\u00e3o de Mercado', keyword: 'comparison' },
                        { label: 'Airbnb / STR', keyword: 'airbnb' },
                        { label: 'Financiamento', keyword: 'financing' }
                    ]
                }
            }
        };

        const ct = chatbotI18n[lang] || chatbotI18n.en;

        // Update greetings
        cannedResponses.residential.greeting = ct.greetings.residential;
        cannedResponses.investment.greeting = ct.greetings.investment;

        // Update chip labels
        chipsByMode.residential = ct.chips.residential;
        chipsByMode.investment = ct.chips.investment;

        // Re-render chips if visible
        if (chatChips && chatChips.children.length > 0) {
            renderChips();
        }
    }

    // --- Language Switcher Event Listeners ---
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const lang = btn.getAttribute('data-lang');
            setLanguage(lang);
        });
    });

    // --- Apply Saved Language on Load ---
    if (currentLanguage !== 'en') {
        setLanguage(currentLanguage);
    }

});
