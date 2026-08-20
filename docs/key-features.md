# Key features — implementation detail

Moved out of `CLAUDE.md` (line budget). Read the relevant subsection when you are
changing that feature.

### Lead Capture (listing.js)
- 10-second countdown timer → locks page with modal
- **2-STEP form (2026-06-24):** Step 1 = Full Name (`#lead-name`) + email (`#lead-fields-1`); Step 2 = phone + timeline (`#lead-fields-2`). `goToContactStep()` reveals Step 2 + swaps title/subtitle/indicator/button copy. The single name field is split on whitespace into First/Last for the CRM. Conversion pixel (`fbq Lead` + gtag) + `/api/save-lead` fire ONCE, on Step 2 completion (`completeLead`) — Step 1 saves nothing. Bail-out (Step-1-only) email capture is NOT built yet (would need a quiet dedupe endpoint; `save-lead` always creates + notifies). i18n keys: fullName, continueBtn, contactTitle, contactSubtitle, step1of2, step2of2, timelineLabel, errSelectTimeline.
- OTP phone verification is DISABLED (`skipOtp=true`); the old `#lead-step-2` OTP markup + otp-* handlers are dead but left in place.
- Country detection via ISO code from dropdown
- Returning leads from alert emails bypass popup via `?t=TOKEN` parameter
- Leads saved to Airtable via `/api/save-lead`

### Property Alerts (api/send-alerts.js)
- Daily cron at 9am sends matching property alerts
- Uses Bridge API for MLS data
- Emails sent via Resend
- Alert links include lead token for popup bypass

### CRM Dashboard (crm.js)
- Leads table with sorting, filtering, search
- Lead detail panel with notes, status, agent assignment
- Reminders system
- CSV export
- MapLibre GL JS map with polygon drawing for alert areas

### Trilingual i18n (EN/ES/PT)
- All translatable text uses `data-i18n` attributes
- Translations in `i18n.js`
- Language stored in localStorage as `poler-lang`
