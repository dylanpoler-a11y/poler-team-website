// ========================================
// THE POLER TEAM - SCRIPTS
// ========================================

document.addEventListener('DOMContentLoaded', () => {

    // ---- Navbar scroll effect ----
    const nav = document.getElementById('nav');
    const handleScroll = () => {
        if (window.scrollY > 50) {
            nav.classList.add('scrolled');
        } else {
            nav.classList.remove('scrolled');
        }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    // ---- Mobile nav toggle ----
    const navToggle = document.getElementById('navToggle');
    const navLinks = document.getElementById('navLinks');

    navToggle.addEventListener('click', () => {
        navLinks.classList.toggle('active');
    });

    // Close mobile nav on link click
    navLinks.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            navLinks.classList.remove('active');
        });
    });

    // ---- Smooth scroll for anchor links ----
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', (e) => {
            e.preventDefault();
            const target = document.querySelector(anchor.getAttribute('href'));
            if (target) {
                const navHeight = nav.offsetHeight;
                const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - navHeight;
                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });

    // ---- Reveal on scroll ----
    const revealElements = document.querySelectorAll(
        '.section-header, .about-grid, .lead-gen-intro, .lead-gen-results, ' +
        '.lead-gen-how, .lead-gen-industries, .lead-gen-differentiators, .section-cta, ' +
        '.residential-intro, .sold-section, .residential-services, ' +
        '.commercial-intro, .om-section, .commercial-services, ' +
        '.consulting-intro, .hotels-section, .consulting-approach, ' +
        '.tools-featured, .newsletter-section, ' +
        '.team-grid, .team-company-linkedin, .contact-grid'
    );

    revealElements.forEach(el => el.classList.add('reveal'));

    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                revealObserver.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -40px 0px'
    });

    revealElements.forEach(el => revealObserver.observe(el));

    // ---- Counter animation ----
    const counters = document.querySelectorAll('.stat-number[data-target]');

    const animateCounter = (el) => {
        const target = parseInt(el.getAttribute('data-target'));
        const duration = 2000;
        const start = performance.now();

        const step = (now) => {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            // Ease-out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.floor(eased * target);
            el.textContent = current;

            if (progress < 1) {
                requestAnimationFrame(step);
            } else {
                el.textContent = target;
            }
        };

        requestAnimationFrame(step);
    };

    const counterObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                animateCounter(entry.target);
                counterObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });

    counters.forEach(el => counterObserver.observe(el));

    // ---- Active nav link highlighting ----
    const sections = document.querySelectorAll('section[id]');
    const navAnchors = document.querySelectorAll('.nav-links a[href^="#"]');

    const highlightNav = () => {
        const scrollPos = window.scrollY + nav.offsetHeight + 100;

        sections.forEach(section => {
            const top = section.offsetTop;
            const height = section.offsetHeight;
            const id = section.getAttribute('id');

            if (scrollPos >= top && scrollPos < top + height) {
                navAnchors.forEach(a => {
                    a.classList.remove('active-link');
                    if (a.getAttribute('href') === '#' + id) {
                        a.classList.add('active-link');
                    }
                });
            }
        });
    };

    window.addEventListener('scroll', highlightNav, { passive: true });

    // ---- Newsletter form ----
    const newsletterForm = document.getElementById('newsletterForm');
    if (newsletterForm) {
        newsletterForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const emailInput = newsletterForm.querySelector('.newsletter-input');
            const email = emailInput.value.trim();

            if (email) {
                // Replace form with success message
                newsletterForm.innerHTML = '<p class="newsletter-success">You\'re in! Watch your inbox for the Daily 3 Best Deals.</p>';

                // Open mailto to team so they can add subscriber
                const subject = encodeURIComponent('Daily 3 Best Deals - New Subscriber');
                const body = encodeURIComponent('New newsletter subscriber: ' + email);
                window.open('mailto:info@polerteam.com?subject=' + subject + '&body=' + body, '_blank');
            }
        });
    }

});
