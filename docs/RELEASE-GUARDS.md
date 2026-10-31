# POS release guards

The October 31 logo incident was a loss of shared CSS rules, not a database failure. A successful build or a page loading does not demonstrate visual correctness.

## Boundaries

`design-system.css` owns the existing V5 design tokens and logo containment. It loads before responsive application styles. Existing global styles retain their appearance; new feature styles must use Vite CSS Modules and cannot escape into body/root/global selectors. The CSS contract check rejects violations.

## Required release evidence

Run `npm run release:gate` from the committed POS checkout. It builds both production and test assets, runs modifier/order, printing, provider-contract and sales-channel regressions, then tests the actual built applications against an isolated temporary SQLite database. It never runs checkout tests against production data.

Eight reference screens cover login, empty POS at desktop/tablet/portrait/mobile sizes, populated cart, payment selector and unpaid payment-request modal. Screenshots use stable fixture data and block external fonts. Only the generated payment bill image is hidden because it contains dynamic date/reference values; its rendering is covered separately by print tests. A change above 0.1% of pixels fails and writes an actual image and difference image to `qa/release-results/`. Logo bounds, design tokens, horizontal overflow, actual login and JavaScript errors are also checked.

The initial references came from the corrected deployed build at commit `6642a2e7f35ba830fa89ea0b4ebbdc701a235db3`. They were visually reviewed before this change. These are Chromium checks, not real Android or printer certification. Baselines depend on the installed Chromium/font environment; if a runner differs, inspect the evidence rather than silently regenerating references.

An explicit baseline update is `ALLOW_VISUAL_BASELINE_UPDATE=reviewed node qa/ui-release.mjs --update-baselines`. This is for intentional, reviewed design changes only. Commit and explain baseline changes in the same PR. Normal gate runs cannot update baselines.

## Merge and deployment

GitHub main requires `POS release guard`, an up-to-date branch, and a pull request; force pushes/deletion are disabled. The hosted workflow runs the gate and publishes this status only after verifying its evidence. Where hosted CI is unavailable, the authorized VPS can run the same gate and `python3 scripts/publish-release-check.py`. This verifies the passing attestation before posting a status on the exact commit.

After merge, rerun the gate on main because a different commit invalidates the attestation. Use `python3 scripts/deploy-pos-static.py test`, then `production`. Both static deployment and the broader print deployment refuse dirty source or missing/stale evidence before changes. The attestation hashes tracked source and every built asset, so edited code/assets cannot reuse an older pass. Static deployment backs up prior files, switches index last, verifies the public POS, and restores prior assets on verification failure without stopping the API or changing business data.

These safeguards govern the standard repository/release paths. A server administrator can still bypass scripts or change branch protections; this is not a claim that every possible regression or privileged bypass is impossible.
