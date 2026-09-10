# Stillwater furnished model hosting — September 10, 2026

## Goal
Host Dylan’s existing Stillwater furnished rendering on homesinsoflorida.com while retaining the separate walkthrough already at /1015stillwater.

## State
Added /1015stillwater/design with the complete Rev 8 Inside & Out model, three interior palettes, eight furnished room views, courtyard palm and 44 client reference images. All model JS/CSS/assets are unchanged from Dylan’s working viewer. Added explicit asset base and canonical metadata. The existing walkthrough header links to the furnished model, which links back and to the real estate homepage.

The active Vercel project is investor-os-1 / poler-team-website (prj_bJrfwSRYG4jqb2pW85EUQHrAFt8I). First publication was superseded by a concurrent CLI deployment. The reconciled live deployment is dpl_HFgyNnvqCYEpS2ibW6E3658CQLx3, based on dpl_DddSwwr9DwyBnuL3j5yZdXnf3Dac. All source hashes from that production base are retained except the deliberate header link in 1015stillwater/index.html; 77 new files added.

## Pending
Complete. Promoted dpl_HFgyNnvqCYEpS2ibW6E3658CQLx3 and verified apex/www/default domain mappings, HTTP 200 and exact source content for the homepage, both viewers and runtime assets. Browser verified both navigation links and no console errors. The model was checked on desktop and a 390 px phone viewport; interior entry and finish switching work. Viewer source committed to main as dc80284 and pushed. Live client link: https://www.homesinsoflorida.com/1015stillwater/design. No work remains for this hosting request.

## Touched
1015stillwater/index.html (one link and scoped styling); 1015stillwater/design.html and 1015stillwater/design/** (77 files); this handoff. Vercel file uploads, staged production deployments, and production promotion. CLI generated a project deployment protection bypass for authenticated preview checks. No CRM/API/configuration changes and no prospect spreadsheet or architectural PDF published.

## Gotchas
Concurrent Vercel CLI publications can overwrite files that are missing from a stale local checkout. Pull current main before the next deployment so the furnished model is retained. Use the investor-os-1 project, not the older thepolerteam.com project. A full deployment of a checkout lacking current production’s dirty changes can revert CRM updates; this release retained production source hashes. The house’s furnishing/finish options are concepts, labeled as such in the UI. Existing walkthrough location wording is unchanged.
