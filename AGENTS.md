# V5 POS release rules

Preserve production data and the existing V5 design. Never claim physical device or printer validation from browser tests.

- Shared design tokens and logo sizing live in `design-system.css`. Feature-specific CSS must use CSS Modules. Existing legacy global styles remain subject to screenshot regression tests.
- Every POS release, including backend-only work, must run `npm run release:gate` on the exact committed candidate. Do not replace passing baselines just to make a change pass.
- Review `qa/release-results/` screenshot differences. Deliberate visual changes require reviewed baseline updates; keep the baseline change in the PR and explain why.
- Use `python3 scripts/deploy-pos-static.py test` followed by `production` for frontend releases. The broader `scripts/deploy-print-studio.py` also requires the POS attestation. Do not use ad hoc rsync/copy commands to bypass the gate.
- Deployments require a clean checkout and an attestation matching the exact commit, source files and both built artifacts. Rebuild/retest after a merge or any source/build change. Keep the existing database and services untouched for static-only releases.
- Main requires the `POS release guard` status. If hosted CI is unavailable, run the full gate on the authorized VPS and use `python3 scripts/publish-release-check.py` to publish that result for the exact commit; never post success without passing evidence.
