/* ============================================================
   MOBILE NAV DRAWER (2026-08-20) — self-contained hamburger menu
   shared by every page (index, listing, str, preconstruction,
   home-valuation). Injects its own styles so pages that do not
   load listing.css (preconstruction) work too. Clones the page's
   existing .lp-nav-links so per-page link behavior (Contact ->
   popup, etc.) carries over unchanged. ES5 only.
   ============================================================ */
document.addEventListener('DOMContentLoaded', function () {
    var navInner = document.querySelector('.lp-nav-inner');
    var navLinks = document.querySelector('.lp-nav-links');
    if (!navInner || !navLinks) return;

    var css = '' +
        '.lp-burger{display:none;background:none;border:none;cursor:pointer;padding:10px;margin-left:4px;flex-shrink:0}' +
        '.lp-burger span{display:block;width:22px;height:2px;background:#fff;border-radius:2px;margin:5px 0;transition:transform .2s,opacity .2s}' +
        '.lp-drawer{position:fixed;top:0;left:0;right:0;bottom:0;z-index:1500;background:#1a2744;display:none;flex-direction:column;padding:18px 22px;overflow-y:auto}' +
        '.lp-drawer.open{display:flex}' +
        '.lp-drawer-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}' +
        '.lp-drawer-logo{height:40px}' +
        '.lp-drawer-close{background:rgba(255,255,255,0.08);border:none;color:#fff;font-size:22px;line-height:1;width:42px;height:42px;border-radius:50%;cursor:pointer}' +
        '.lp-drawer-links{display:flex;flex-direction:column}' +
        '.lp-drawer-links a{color:#fff;text-decoration:none;font-size:1.05rem;font-weight:600;padding:15px 4px;border-bottom:1px solid rgba(255,255,255,0.1)}' +
        '.lp-drawer-links a:active{opacity:.7}' +
        '@media (max-width:900px){.lp-burger{display:block}.lp-nav-links{display:none}}';
    var styleEl = document.createElement('style');
    styleEl.appendChild(document.createTextNode(css));
    document.head.appendChild(styleEl);

    // Hamburger button at the far right of the bar
    var burger = document.createElement('button');
    burger.className = 'lp-burger';
    burger.setAttribute('aria-label', 'Open menu');
    burger.innerHTML = '<span></span><span></span><span></span>';
    navInner.appendChild(burger);

    // Full-screen drawer with a clone of this page's nav links
    var drawer = document.createElement('div');
    drawer.className = 'lp-drawer';
    drawer.setAttribute('aria-hidden', 'true');
    var top = document.createElement('div');
    top.className = 'lp-drawer-top';
    var logo = document.querySelector('.lp-nav-logo');
    if (logo) {
        var logoClone = logo.cloneNode(true);
        logoClone.className = 'lp-drawer-logo';
        top.appendChild(logoClone);
    } else {
        top.appendChild(document.createElement('span'));
    }
    var closeBtn = document.createElement('button');
    closeBtn.className = 'lp-drawer-close';
    closeBtn.setAttribute('aria-label', 'Close menu');
    closeBtn.innerHTML = '&#10005;';
    top.appendChild(closeBtn);
    drawer.appendChild(top);

    var linksWrap = document.createElement('nav');
    linksWrap.className = 'lp-drawer-links';
    var kids = navLinks.children;
    for (var i = 0; i < kids.length; i++) {
        linksWrap.appendChild(kids[i].cloneNode(true));
    }
    drawer.appendChild(linksWrap);
    document.body.appendChild(drawer);

    function openDrawer() {
        drawer.classList.add('open');
        drawer.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }
    function closeDrawer() {
        drawer.classList.remove('open');
        drawer.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    }
    burger.addEventListener('click', openDrawer);
    closeBtn.addEventListener('click', closeDrawer);
    // Any link tap closes the drawer (after the link's own onclick has run,
    // so Contact still opens the signup popup on pages that wire it that way)
    linksWrap.addEventListener('click', function (e) {
        var el = e.target;
        while (el && el !== linksWrap && el.tagName !== 'A') el = el.parentNode;
        if (el && el.tagName === 'A') closeDrawer();
    });
    document.addEventListener('keydown', function (e) {
        if ((e.key === 'Escape' || e.keyCode === 27) && drawer.classList.contains('open')) closeDrawer();
    });
});


// ============================================================
// SHARED CONTACT FORM (2026-08-21) — the homepage "Let's Connect"
// form (name / email / phone / when-to-buy / optional message, X
// to close) is THE Contact form on every page. Pages that already
// define it (index.html) are left alone; everywhere else this
// injects an identical copy and defines window.openHpLead.
// The 10-second Meta lead gate on the listing page is separate
// and untouched. ES5 only.
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
    if (document.getElementById('hpl-overlay')) return; // homepage has its own

    var css = '' +
        '.hpl-overlay{position:fixed;top:0;left:0;right:0;bottom:0;z-index:900;display:none;align-items:center;justify-content:center;padding:1rem;background:rgba(15,22,38,0.62)}' +
        '.hpl-overlay.open{display:flex}' +
        '.hpl-card{position:relative;background:#fff;border-radius:14px;width:min(430px,calc(100vw - 2rem));max-height:92vh;overflow-y:auto;padding:2rem 1.75rem 1.6rem;box-shadow:0 24px 70px rgba(5,10,22,0.45);font-family:"Inter",-apple-system,sans-serif}' +
        '.hpl-close{position:absolute;top:0.7rem;right:0.7rem;width:34px;height:34px;border:none;border-radius:50%;background:#f1f3f7;color:#1a2744;cursor:pointer;font-size:1.1rem;line-height:1;display:flex;align-items:center;justify-content:center}' +
        '.hpl-close:hover{background:#e4e8ef}' +
        '.hpl-title{font-family:"Playfair Display",serif;font-size:1.45rem;color:#1a2744;margin:0 0 0.35rem}' +
        '.hpl-sub{font-size:0.88rem;color:#5b6472;line-height:1.55;margin:0 0 1.2rem}' +
        '.hpl-form{display:flex;flex-direction:column;gap:0.7rem}' +
        '.hpl-input,.hpl-select,.hpl-textarea{width:100%;border:1px solid #d5dae3;border-radius:8px;padding:0.7rem 0.85rem;font-size:0.92rem;color:#1a2744;font-family:"Inter",-apple-system,sans-serif;background:#fff;outline:none;box-sizing:border-box}' +
        '.hpl-input:focus,.hpl-select:focus,.hpl-textarea:focus{border-color:#1a2744;box-shadow:0 0 0 3px rgba(26,39,68,0.12)}' +
        '.hpl-select{-webkit-appearance:menulist;appearance:auto;cursor:pointer}' +
        '.hpl-select.placeholder{color:#6b7280}' +
        '.hpl-textarea{min-height:84px;resize:vertical}' +
        '.hpl-error{display:none;font-size:0.82rem;color:#b3261e;margin:0}' +
        '.hpl-submit{margin-top:0.3rem;background:#1a2744;color:#fff;border:none;cursor:pointer;font-size:0.92rem;font-weight:700;padding:0.85rem 1rem;border-radius:8px}' +
        '.hpl-submit[disabled]{opacity:0.6;cursor:default}' +
        '.hpl-consent{font-size:0.68rem;color:#5b6472;line-height:1.5;margin-top:0.7rem}' +
        '.hpl-done{display:none;text-align:center;padding:1.5rem 0 1rem}' +
        '.hpl-done-icon{width:54px;height:54px;border-radius:50%;background:#1a2744;color:#fff;display:flex;align-items:center;justify-content:center;margin:0 auto 1rem}' +
        '.hpl-done h3{font-family:"Playfair Display",serif;font-size:1.3rem;color:#1a2744;margin:0 0 0.4rem}' +
        '.hpl-done p{font-size:0.9rem;color:#5b6472;margin:0}';
    var st = document.createElement('style');
    st.appendChild(document.createTextNode(css));
    document.head.appendChild(st);

    var ov = document.createElement('div');
    ov.className = 'hpl-overlay';
    ov.id = 'hpl-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = '' +
        '<div class="hpl-card">' +
        '<button type="button" class="hpl-close" id="hpl-close" aria-label="Close">&#10005;</button>' +
        '<div id="hpl-main">' +
        '<h2 class="hpl-title" id="hpl-title">Let\'s Connect</h2>' +
        '<p class="hpl-sub">Tell us a little about you and The Poler Team will reach out right away.</p>' +
        '<form class="hpl-form" id="hpl-form" novalidate>' +
        '<input type="text" class="hpl-input" id="hpl-name" placeholder="Full Name" autocomplete="name" required>' +
        '<input type="email" class="hpl-input" id="hpl-email" placeholder="Email Address" autocomplete="email" required>' +
        '<input type="tel" class="hpl-input" id="hpl-phone" placeholder="Phone Number" autocomplete="tel" required>' +
        '<select class="hpl-select placeholder" id="hpl-timeline" required>' +
        '<option value="" disabled selected>When do you plan to buy?</option>' +
        '<option value="0-3 months">0-3 months</option>' +
        '<option value="3-6 months">3-6 months</option>' +
        '<option value="6-12 months">6-12 months</option>' +
        '<option value="12+ months">12+ months</option>' +
        '<option value="Just exploring">Just exploring</option>' +
        '</select>' +
        '<textarea class="hpl-textarea" id="hpl-message" placeholder="Leave us a message (optional)"></textarea>' +
        '<p class="hpl-error" id="hpl-error"></p>' +
        '<button type="submit" class="hpl-submit" id="hpl-submit">Connect With Us</button>' +
        '<p class="hpl-consent">By submitting, you agree to be contacted by The Poler Team via call, text, and WhatsApp, including by automated or AI-assisted means, at the number provided. Consent isn\'t required to buy or sell.</p>' +
        '</form></div>' +
        '<div class="hpl-done" id="hpl-done">' +
        '<div class="hpl-done-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>' +
        '<h3>Thank you!</h3><p>We received your information and will reach out shortly.</p>' +
        '</div></div>';
    document.body.appendChild(ov);

    function closeHpLead() {
        ov.classList.remove('open');
        document.body.style.overflow = '';
    }
    if (!window.openHpLead) {
        window.openHpLead = function () {
            ov.classList.add('open');
            document.body.style.overflow = 'hidden';
        };
    }
    document.getElementById('hpl-close').addEventListener('click', closeHpLead);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeHpLead(); });
    document.addEventListener('keydown', function (e) {
        if ((e.key === 'Escape' || e.keyCode === 27) && ov.classList.contains('open')) closeHpLead();
    });

    var tl = document.getElementById('hpl-timeline');
    tl.addEventListener('change', function () { if (tl.value) tl.classList.remove('placeholder'); });

    document.getElementById('hpl-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var name = document.getElementById('hpl-name').value.replace(/^\s+|\s+$/g, '');
        var email = document.getElementById('hpl-email').value.replace(/^\s+|\s+$/g, '');
        var phone = document.getElementById('hpl-phone').value.replace(/^\s+|\s+$/g, '');
        var timeline = tl.value;
        var message = document.getElementById('hpl-message').value.replace(/^\s+|\s+$/g, '');
        var errEl = document.getElementById('hpl-error');
        var showErr = function (m) { errEl.textContent = m; errEl.style.display = 'block'; };
        errEl.style.display = 'none';
        if (!name) return showErr('Please enter your name.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showErr('Please enter a valid email address.');
        if (phone.replace(/\D/g, '').length < 7) return showErr('Please enter a valid phone number.');
        if (!timeline) return showErr('Please tell us when you plan to buy.');
        var parts = name.split(/\s+/);
        var first = parts.shift() || '';
        var last = parts.join(' ');
        var btn = document.getElementById('hpl-submit');
        btn.disabled = true;
        btn.textContent = 'Sending...';
        fetch('/api/save-lead', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                first: first, last: last, email: email, phone: phone,
                timeline: timeline,
                notes: message ? 'Contact message: ' + message : '',
                listingAddress: 'Contact - ' + window.location.pathname,
                sourceUrl: window.location.href,
                pageUrl: window.location.href
            })
        }).then(function (r) { return r.json(); }).then(function () {
            try { localStorage.setItem('poler_lead_v1', email); } catch (e2) {}
            try { if (typeof fbq === 'function') fbq('track', 'Lead'); } catch (e3) {}
            try { if (typeof gtag_report_conversion === 'function') gtag_report_conversion(); } catch (e4) {}
            document.getElementById('hpl-main').style.display = 'none';
            document.getElementById('hpl-done').style.display = 'block';
            setTimeout(closeHpLead, 3000);
        })['catch'](function () {
            btn.disabled = false;
            btn.textContent = 'Connect With Us';
            showErr('Something went wrong. Please try again.');
        });
    });
});
