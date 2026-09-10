/* track-time.js — accumulates a captured lead's ACTIVE seconds on the site and
 * posts them to /api/log-time (which adds to the CRM "Total Time Spent" field and
 * bumps "Last Login"). The API existed since May but no page ever called it, so
 * Time on Site sat empty for every lead captured after 2026-05-14.
 *
 * Identity: localStorage.poler_lead_v1 holds the lead's email once the gate form
 * is submitted (listing.js / nav.js). Alert-only visitors ('alert_<token>') are
 * skipped — the API keys on email.
 *
 * "Active" = tab visible AND some input in the last 60s. Flushes every 30s of
 * accumulated time and on tab hide / page exit via sendBeacon.
 */
(function () {
  var FLUSH_EVERY = 30;   // seconds of active time per POST
  var IDLE_AFTER  = 60;   // seconds without input → not counting
  var pending = 0, lastInput = Date.now(), lastTick = Date.now();

  function leadEmail() {
    try {
      var v = localStorage.getItem('poler_lead_v1') || '';
      return v.indexOf('@') > 0 ? v : '';
    } catch (e) { return ''; }
  }

  function flush(useBeacon) {
    var email = leadEmail();
    var secs = Math.round(pending);
    if (!email || secs <= 0) return;
    pending = 0;
    var body = JSON.stringify({ email: email, seconds: secs });
    try {
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon('/api/log-time', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/log-time', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
      }
    } catch (e) {}
  }

  function tick() {
    var now = Date.now();
    var dt = (now - lastTick) / 1000;
    lastTick = now;
    if (document.visibilityState === 'visible' && (now - lastInput) / 1000 < IDLE_AFTER && dt < 5) {
      pending += dt;
      if (pending >= FLUSH_EVERY) flush(false);
    }
  }

  function markInput() { lastInput = Date.now(); }
  ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'].forEach(function (ev) {
    window.addEventListener(ev, markInput, { passive: true });
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush(true);
    else lastTick = Date.now();
  });
  window.addEventListener('pagehide', function () { flush(true); });
  setInterval(tick, 1000);
})();
