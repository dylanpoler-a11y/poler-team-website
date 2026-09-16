# Session Handoff — CRM overlay fix + RE auto-save + LG default expanded (2026-09-16)

## What changed (deployed: `poler-team-website-mud4vti5k`, live on homesinsoflorida.com/crm)
1. **Click-outside was dead on the RE lead panel after visiting a Lead Gen / consulting panel.** Root cause: `#panel-overlay` had 4 owners — RE used the `.show` class, LG/client/deal set inline `display:block/none`. Once LG closed with inline `display:none`, that inline rule out-ranked `.show` forever → RE panel opened with no dim, click-outside did nothing, hover showed the nav links' pointer cursor (Kevin's "finger" cursor). Fix: single `showPanelOverlay()/hidePanelOverlay()` (clears inline style, class is the truth; hide is a no-op while any panel is still open). Consulting client/deal panels now also close on overlay click (they never did).
2. **RE panel auto-save** (`initLeadAutoSave` / `autoSaveLeadField`): Status, Assigned To, first/last name, phone, email PATCH `/api/update-lead` with ONLY that field (selects on change, inputs 700ms after typing); alert prefs persist 800ms after the last edit via the existing touched-gated `persistAlertPrefs()`. Button relabeled **"Save Note"** — it still saves everything, but only the note needs it.
3. **Lead Gen panel opens expanded by default** (same `panel-expanded` width as RE, 1278px at Kevin's viewport); ⛶ shrinks.

## Verified live (Chrome, logged in as Kevin)
- LG open → close → RE open: overlay `display:block`, inline style null, click at (200,400) closes the panel.
- LG panel: `panel-expanded` true, width 1278, click-outside closes.
- Status change on test lead "pepe" (recIh1RlXZYu6qDfE) → "Saved" in 2s, `/api/get-leads` shows `Contacted`; reverted to `New`. No console errors.

## Open
- `saveLead()` still hand-rolls the note stamp client-side and sends `notes` via `update-lead` — pre-existing, contradicts crm-conventions §2 (server-side stamp via log-note). Not touched here; worth migrating the note path to `/api/agent/log-note`.
- Rosa's Flash-on-iPad question: answered in chat, findings in `~/business/real-estate/active/research/flash-rosa-whatsapp/README.md`.
