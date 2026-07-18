/**
 * via-ventura.js — Via Ventura landing page logic
 * - Lead form submit → POST /api/save-lead
 * - Phone-prefix country detection handled by the API
 */

(function () {
    'use strict';

    const form = document.getElementById('vv-form');
    const status = document.getElementById('vv-form-status');
    if (!form) return;

    // Get UTM params from URL
    function getUTM() {
        const p = new URLSearchParams(window.location.search);
        return {
            utm_source:   p.get('utm_source')   || '',
            utm_medium:   p.get('utm_medium')   || '',
            utm_campaign: p.get('utm_campaign') || '',
            utm_content:  p.get('utm_content')  || '',
            utm_term:     p.get('utm_term')     || '',
            fbclid:       p.get('fbclid')       || '',
        };
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        status.textContent = '';
        status.className = 'vv-form-status';

        const fd = new FormData(form);
        const data = Object.fromEntries(fd.entries());

        // Basic validation
        if (!data.first || !data.last || !data.email || !data.phone || !data.neighborhood || !data.timeline) {
            status.textContent = 'Please fill in all fields.';
            status.className = 'vv-form-status error';
            return;
        }
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) {
            status.textContent = 'Please enter a valid email address.';
            status.className = 'vv-form-status error';
            return;
        }

        const btn = form.querySelector('button[type="submit"]');
        const originalLabel = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Sending…';

        const payload = {
            first:          data.first,
            last:           data.last,
            email:          data.email,
            phone:          data.phone,
            listingAddress: `Via Ventura — ${data.neighborhood}`,
            sourceUrl:      'https://www.homesinsoflorida.com/via-ventura',
            timeline:       data.timeline,
            language:       (navigator.language || 'en').slice(0, 2),
            ...getUTM(),
        };

        try {
            const res = await fetch('/api/save-lead', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(payload),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `Server error (${res.status})`);
            }

            // Fire Google Ads conversion if available
            if (typeof gtag === 'function') {
                gtag('event', 'conversion', {
                    send_to: 'AW-17910762846/E5E_CMfftJEcEN6awtxC',
                    value: 1.0,
                    currency: 'USD',
                });
            }
            // Fire Meta Pixel lead event
            if (typeof fbq === 'function') {
                fbq('track', 'Lead', { content_name: 'Via Ventura', content_category: data.neighborhood });
            }
            // A/B test conversion event
            if (typeof window.vvTrack === 'function') { window.vvTrack('lead'); }
            // GA4 lead event
            if (typeof gtag === 'function') { gtag('event', 'generate_lead', { currency: 'USD', value: 1 }); }

            status.textContent = '✓ Thank you! Rosa will be in touch within 24 hours.';
            status.className = 'vv-form-status success';
            form.reset();
        } catch (err) {
            status.textContent = 'Something went wrong — please call or text Rosa directly at (954) 235-4046.';
            status.className = 'vv-form-status error';
            console.error('[via-ventura] submit error', err);
        } finally {
            btn.disabled = false;
            btn.textContent = originalLabel;
        }
    });
})();
