# Full file structure — homesinsoflorida.com

Moved out of `CLAUDE.md` (line-budget). The CLAUDE.md keeps a condensed map of the
paths that actually matter; this is the exhaustive tree.

```
/
├── CLAUDE.md               # This file — project context for Claude Code
├── .gitignore
├── vercel.json             # Cron config for daily alerts
│
├── # Listing Landing Page (homesinsoflorida.com/listing)
├── listing.html            # Listing page HTML (lead capture popup, property display)
├── listing.js              # Listing page logic (10-sec timer, OTP verification, alerts)
├── listing.css             # Listing page styles
├── i18n.js                 # Trilingual translations (EN/ES/PT)
│
├── # CRM Dashboard (homesinsoflorida.com/crm)
├── crm.html                # CRM dashboard HTML
├── crm.js                  # CRM logic (leads table, filters, lead details panel)
├── crm.css                 # CRM styles
│
├── # Alert Preferences (homesinsoflorida.com/preferences)
├── preferences.html        # Lead alert preferences page
├── preferences.js          # Preferences logic
├── preferences.css         # Preferences styles
│
├── # Other Pages
├── index.html              # Main landing page (Poler Team branding — DO NOT MODIFY without explicit request)
├── styles.css              # Main page styles (DO NOT MODIFY without explicit request)
├── script.js               # Main page JS (DO NOT MODIFY without explicit request)
├── privacy.html            # Privacy policy
│
├── # API Functions (Vercel serverless)
├── api/
│   ├── save-lead.js        # Saves new leads to Airtable
│   ├── get-leads.js        # Fetches leads for CRM
│   ├── update-lead.js      # Updates lead fields (status, agent, notes, etc.)
│   ├── send-alerts.js      # Daily cron: sends property alert emails via Resend
│   ├── send-test-alert.js  # Sends test alert email for a single lead
│   ├── send-otp.js         # Sends OTP verification code
│   ├── verify-otp.js       # Verifies OTP code
│   ├── generate-token.js   # Generates alert tokens for leads
│   ├── get-preferences.js  # Fetches lead alert preferences
│   ├── update-preferences.js # Updates lead alert preferences
│   ├── create-reminder.js  # Creates CRM reminders
│   ├── get-reminders.js    # Fetches CRM reminders
│   ├── update-reminder.js  # Updates CRM reminders
│   ├── chat.js             # AI chatbot API
│   ├── get-activity.js     # Lead activity log
│   ├── log-activity.js     # Logs lead activity
│   ├── save-conversation.js # Saves chat conversations
│   └── get-conversations.js # Fetches chat conversations
│
├── # Assets
├── logo.png / logo-white.png / pt-circle.png
├── favicon.ico / favicon-192.png / favicon-512.png / apple-touch-icon.png
├── team-*.jpg, ig-post-*.jpg, *.mp4  # Team/media assets
```
