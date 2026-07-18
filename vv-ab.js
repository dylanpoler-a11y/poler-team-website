/**
 * vv-ab.js — Via Ventura A/B client tracker.
 * Loaded by vv-a.html and vv-b.html. Sends events to /api/vv-ab/track.
 * KPIs captured: view, dwell time, max scroll depth, CTA call taps, lead (conversion).
 */
(function () {
  'use strict';

  function cookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  // variant: prefer splitter cookie, fall back to body data attr
  var variant = (cookie('vv_v') || (document.body.getAttribute('data-vv-variant') || 'a')).toLowerCase();

  // sticky visitor id
  var vid = '';
  try {
    vid = localStorage.getItem('vv_vid') || '';
    if (!vid) {
      vid = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('vv_vid', vid);
    }
  } catch (e) {
    vid = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  var loadAt = Date.now();
  var maxScroll = 0;
  var ctaCalls = 0;
  var leftSent = false;

  function send(type, extra) {
    var payload = Object.assign({ visitorId: vid, variant: variant, type: type }, extra || {});
    try {
      fetch('/api/vv-ab/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      });
    } catch (e) { /* swallow */ }
  }

  function trackScroll() {
    var docH = Math.max(
      document.body.scrollHeight, document.documentElement.scrollHeight,
      document.body.offsetHeight, document.documentElement.offsetHeight
    );
    var seen = (window.scrollY || window.pageYOffset) + window.innerHeight;
    var pct = docH > 0 ? Math.min(100, Math.round((seen / docH) * 100)) : 0;
    if (pct > maxScroll) maxScroll = pct;
  }

  function sendLeave() {
    if (leftSent) return;
    leftSent = true;
    var payload = {
      visitorId: vid, variant: variant, type: 'leave',
      dwellMs: Date.now() - loadAt, maxScroll: maxScroll, ctaCalls: ctaCalls,
    };
    try {
      var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      if (!navigator.sendBeacon || !navigator.sendBeacon('/api/vv-ab/track', blob)) {
        send('leave', { dwellMs: payload.dwellMs, maxScroll: maxScroll, ctaCalls: ctaCalls });
      }
    } catch (e) {
      send('leave', { dwellMs: payload.dwellMs, maxScroll: maxScroll, ctaCalls: ctaCalls });
    }
  }

  // expose for the lead form (via-ventura.js calls window.vvTrack('lead') on success)
  window.vvTrack = function (type, extra) { send(type, extra); };

  // wire up
  window.addEventListener('scroll', trackScroll, { passive: true });
  window.addEventListener('load', trackScroll);

  // CTA: call/text taps
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="tel:"]');
    if (a) { ctaCalls += 1; send('cta_call'); if (window.gtag) gtag('event', 'cta_call_tap', { variant: variant }); }
  }, true);

  // leave events
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') sendLeave();
  });
  window.addEventListener('pagehide', sendLeave);

  // initial view
  send('view');
  if (window.gtag) gtag('event', 'qr_landing', { variant: variant });
})();
