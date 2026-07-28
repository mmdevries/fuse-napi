# Release procedure

Releases are built and published only by
`.github/workflows/prebuilds.yml`. Do not run `npm publish` from a development
checkout.

## One-time npm and GitHub configuration

1. Configure `mmdevries/fuse-napi` and `prebuilds.yml` as the npm trusted
   publisher for the `fuse-napi` package.
2. Allow `npm publish` for that trusted publisher and disallow traditional
   automation tokens after the first OIDC release succeeds.
3. Create the GitHub environment `npm-production`, require a maintainer
   approval, and restrict it to protected release tags.
4. Protect `main` and release tags so required CI checks cannot be bypassed.

The publish job uses a short-lived OIDC credential and npm provenance. No
`NPM_TOKEN` secret is required.

## Preparing a release

1. Update `package.json` and both version fields in `package-lock.json`.
2. Finalize `CHANGELOG.md`, compatibility documentation, and migration notes.
3. Run:

   ```sh
   npm ci
   npm run check
   npm run test:types
   npm run test:unit
   npm test
   npm run verify:metadata
   ```

4. Commit the complete release candidate and push it to `main`.
5. Wait for every required CI job to pass, including the real macOS mount
   workflow on Intel and Apple Silicon.
6. Create an immutable annotated tag matching the package version exactly:

   ```sh
   git tag -a v1.0.0 -m "fuse-napi v1.0.0"
   git push origin v1.0.0
   ```

Use a version such as `1.0.0-rc.1` first when validating release changes.
Prerelease tags publish under npm's `next` dist-tag; stable versions publish
under `latest`.

## Automated release gates

The tag workflow:

- rejects a tag that differs from `package.json` or `package-lock.json`;
- builds four native Node-API prebuilds;
- verifies architecture, libfuse 2 linkage, glibc 2.31, and macOS 12 baselines;
- loads each prebuild on Node.js 20, 22, and 24;
- assembles one npm tarball containing all four binaries;
- verifies and installs that exact tarball on all four target platforms;
- records a SHA-256 checksum; and
- publishes only the verified artifact through the protected
  `npm-production` environment.

## Post-release verification

Verify the registry metadata and install the published artifact on at least
one clean Linux and one clean macOS host:

```sh
npm view fuse-napi@1.0.0 version dist.integrity
npm install fuse-napi@1.0.0
node -e "require('fuse-napi')"
```

Never reuse a published version or move an existing release tag. If a release
is defective, deprecate it on npm, document the reason, and publish a new
patch version.
