/* Site-wide Google Analytics 4 + Google Ads tagging — The Poler Team
 * GA4  : G-3JFW4YMZ6T  (property 540835135, account 397294019)
 * Ads  : AW-17910762846 (conversion tracking — do NOT remove)
 * Include on any page that does NOT already load gtag.js:
 *   <script src="/analytics.js"></script>
 * Pages that already load gtag.js just add: gtag('config','G-3JFW4YMZ6T');
 */
(function () {
  var GA4 = 'G-3JFW4YMZ6T';
  var ADS = 'AW-17910762846';

  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4;
  document.head.appendChild(s);

  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;

  gtag('js', new Date());
  gtag('config', GA4);
  gtag('config', ADS);
})();
