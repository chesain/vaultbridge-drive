# Release process

1. Use a clean tree and Node 20+.
2. Review dependency updates and official Obsidian/Google API changes.
3. Run `npm ci && npm run validate`.
4. Complete every manual gate in `docs/TESTING.md` with a throwaway Google account/vault.
5. Update `CHANGELOG.md`, `manifest.json`, `package.json`, and `versions.json` with the same
   semantic version and minimum Obsidian version.
6. Run `npm run package` twice from clean installs and compare `SHA256SUMS`/ZIP content. ZIP
   metadata can vary by platform; the three uncompressed files must be byte-identical.
7. Verify the archive contains only `main.js`, `manifest.json`, and `styles.css`.
8. Commit the reviewed version bump, then tag that exact commit with the version without a `v`
   prefix.
9. Push the commit and tag. The prerelease workflow repeats validation and packaging, verifies the
   tag and synchronized metadata, uploads the three individual BRAT assets to a draft, and publishes
   it as a prerelease only after those checks pass.
10. A maintainer can rerun the workflow manually only for an existing exact version tag. The
    workflow refuses to replace a release that already exists.

Dependency updates use locked versions and a reviewed pull request. Security fixes take precedence;
routine updates should remain small and retain the full test/manual matrix.

The build injects an optional public client ID only through `VAULTBRIDGE_GOOGLE_CLIENT_ID`. Never
commit `.env`, a client secret, refresh/access token, pairing artifact, or live vault fixture.
