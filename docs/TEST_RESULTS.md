# Test results

Automated results are recorded during release validation. This file intentionally separates actual
executed results from required manual gates.

## Automated

Executed in the build workspace on 2026-07-30 (America/Chicago):

- Formatting check: passed.
- ESLint: passed with zero warnings.
- TypeScript type check: passed.
- Vitest: 22 files passed, 174 tests passed, 0 failed.
- Required integration matrix: all 40 named scenarios passed.
- Property tests: 750 generated cases across eight invariants passed.
- V8 coverage: 59.19% statements, 55.82% branches, 55.35% functions, 61.46% lines.
- Production esbuild bundle: passed.
- Secret scan: 74 files scanned, no findings.
- Production dependency audit (`npm audit --omit=dev --audit-level=high`): 0 vulnerabilities.
- Full development-tree audit (`npm audit --audit-level=high`): 0 vulnerabilities.
- Release package verification: exactly `main.js`, `manifest.json`, and `styles.css`.

Artifact checksums are recorded in `release/SHA256SUMS`.

## Manual

Not run in this build environment: no Google credentials or interactive Obsidian desktop/mobile
runtime were available. Complete `docs/TESTING.md#manual-release-gates` before production release.
