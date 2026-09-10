# Stillwater furnished viewer orientation — September 10, 2026

## Goal
Put the garage on the left when the furnished residence is viewed straight from the street at /1015stillwater/design, as the client requested.

## State
The clean website checkout was fast-forwarded from 5ebfc2cdc0cf6623274b64e28a1def41cd5e9bc7 to current origin/main, 5bc854e0c86d8d3d46a997a94931c06d675f5288. Only the three prepared furnished-viewer JavaScript files listed below were then copied from the locally corrected viewer.

The house now reflects model X once at the geometry root after batching. Its traced plan coordinates and street-to-water Z direction stay intact. Exterior cameras, exported world points, room markers, furniture, site geometry and courtyard palm use the same orientation. Interior light selection now uses world positions, and room movement bounds tolerate the reflected X ordering. The directional sun is reflected to retain the intended lighting. The separate walkthrough at /1015stillwater is not changed by this correction.

Published by the main task as dpl_Fou8ss6aaouCec4t6YJojYxsLNAz. Immutable deployment: https://poler-team-website-duzhe0u74-investor-os-1.vercel.app. Live furnished viewer: https://www.homesinsoflorida.com/1015stillwater/design.

The release used the fresh production base dpl_92qsAKELqharxVvKpyLof3hqU1DR, with protected production staging and promotion guarded against that base changing. All 490 deployed source files were verified exactly: only the three corrected JavaScript files changed, and the other 487 production files were preserved. Hosting-specific HTML base paths, canonical metadata and navigation links remain intact. This was an incremental deployment using the production file manifest, not a full deployment of this Git checkout.

Validation reported by the main task: public homepage, separate walkthrough, furnished viewer, three changed modules and reference image 02 all returned HTTP 200 with matching SHA1 content. Browser checks passed for garage-left arrival, warm living room, coastal kitchen, dramatic primary bedroom, section/floor labels and absence of console errors. Independent Node checks passed for all eight room-navigation bounds, an actual garage ray hit and left-side projection, and the reflected root in GLB export. The final live-browser check also confirmed the garage-left arrival and fully reflected warm living room with no browser errors. The copied source files passed byte comparisons and git diff --check.

## Pending
Complete for this correction: the furnished viewer is published with the garage on the left. This source commit records the three verified files and the completed handoff on main. Final live-browser confirmation passed; no work remains for this correction. No further deployment should be launched from this checkout for this change.

## Touched
- 1015stillwater/design/house.js
- 1015stillwater/design/app.js
- 1015stillwater/design/interior-navigation.js
- SESSION_HANDOFF_stillwater-orientation_2026-09-10.md

The local checkout was fetched and fast-forwarded to origin/main before the three files were copied. The main task created and promoted the guarded Vercel deployment above. This source reconciliation records only the three files and this handoff in Git; it does not deploy from the repository or edit other website code. No CRM records, environment variables or domain configuration were changed.

## Gotchas
This project is deployed manually by CLI and has no Git auto-deploy. A concurrent publish from a stale working directory already removed the furnished viewer once; the active publishing checkout must retain the complete current source. Do not deploy this whole checkout merely because it matches Git: production can contain unrelated uncommitted CLI changes. The reflected geometry is intentional and client-confirmed; do not negate X a second time in builders. Production has the corrected orientation. Preserve this source commit in the active publishing checkout before its next CLI deployment.
