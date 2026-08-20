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
