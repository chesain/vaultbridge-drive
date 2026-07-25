# Test results

Automated results are recorded during release validation. This file intentionally separates actual
executed results from required manual gates.

## Automated

Executed in the build workspace on 2026-07-24 (America/Chicago):

- Formatting check: passed.
- ESLint: passed with zero warnings.
- TypeScript type check: passed.
- Vitest: 18 files passed, 154 tests passed, 0 failed.
- Required integration matrix: all 40 named scenarios passed.
- Property tests: 550 generated cases across six invariants passed.
- V8 coverage: 56.33% statements, 52.81% branches, 52.12% functions, 58.58% lines.
- Production esbuild bundle: passed.
- Secret scan: 72 files scanned, no findings.
- Production dependency audit (`npm audit --omit=dev --audit-level=high`): 0 vulnerabilities.
- Full development-tree audit: 12 high-severity paths to the same `brace-expansion`
  denial-of-service advisory through ESLint/TypeScript tooling; npm reports no fix available. These
  development dependencies are not bundled into the plugin.
- Release package verification: exactly `main.js`, `manifest.json`, and `styles.css`.

Artifact checksums are recorded in `release/SHA256SUMS`.

## Manual

Not run in this build environment: no Google credentials or interactive Obsidian desktop/mobile
runtime were available. Complete `docs/TESTING.md#manual-release-gates` before production release.
