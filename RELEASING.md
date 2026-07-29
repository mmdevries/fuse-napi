# Release procedure

Release artifacts are built only by `.github/workflows/prebuilds.yml`.
Publication is performed manually, with npm two-factor authentication, from
the exact downloaded `npm-package` artifact after the manual macOS checks.
Never rebuild or run `npm pack` from a development checkout for publication.

## One-time release-host configuration

1. Require two-factor authentication for npm publication and verify that the
   release maintainer has publish access to `fuse-napi`.
2. Protect `main` and immutable release tags so the hosted CI and artifact
   workflow cannot be bypassed.
3. Prepare both a physical Intel Mac and a physical Apple Silicon Mac with a
   supported macOS release, an installed and approved macFUSE libfuse 3
   compatibility runtime, `pkg-config`, and supported Node.js versions.

No self-hosted GitHub runners, npm trusted publisher, `npm-production`
environment, or `NPM_TOKEN` secret are required. Manual OTP publication does
not produce GitHub OIDC provenance.

## Preparing a release

1. Update `package.json` and both version fields in `package-lock.json`.
2. Finalize `CHANGELOG.md`, compatibility documentation, and migration notes.
3. Run:

   ```sh
   npm ci
   npm run check
   npm run test:types
   npm run test:unit
   npm run test:fuzz
   npm test
   npm run test:soak
   npm run verify:metadata
   ```

4. Commit the complete release candidate and push it to `main`.
5. Wait for every hosted CI job to pass.
6. On both a physical Intel Mac and a physical Apple Silicon Mac, use a clean
   checkout of the exact release commit and run:

   ```sh
   npm ci
   npm run check
   npm run test:types
   npm test
   ```

   Record the commit, architecture, macOS version, macFUSE version, Node.js
   version, and result in the release notes.
7. Create an immutable annotated tag matching the package version exactly:

   ```sh
   FUSE_NAPI_VERSION="$(node -p "require('./package.json').version")"
   git tag -a "v$FUSE_NAPI_VERSION" -m "fuse-napi v$FUSE_NAPI_VERSION"
   git push origin "v$FUSE_NAPI_VERSION"
   unset FUSE_NAPI_VERSION
   ```

8. In GitHub Actions, manually run `ABI-specific Node.js prebuilds` on the
   exact release tag. Pushing a tag never starts this workflow or publishes
   automatically.
9. Wait until the complete workflow is green and download its `npm-package`
   artifact. It contains the exact tarball, `SHA256SUMS`, and the CycloneDX
   SBOM. Verify the GitHub build-provenance and SBOM attestations for that
   workflow run as well.
10. On both physical Macs, unpack separate copies of the artifact and run the
    following from the unpacked artifact directory. Replace `CHECKOUT` with
    the clean checkout of the same release tag:

    ```sh
    CHECKOUT=/absolute/path/to/fuse-napi
    shasum -a 256 -c SHA256SUMS
    TARBALL="$(find "$PWD" -type f -name 'fuse-napi-*.tgz' -print -quit)"
    test -n "$TARBALL"
    CONSUMER="$(mktemp -d /tmp/fuse-napi-consumer.XXXXXX)"
    npm install --prefix "$CONSUMER" --ignore-scripts "$TARBALL"
    test ! -d "$CONSUMER/node_modules/fuse-napi/build"
    node "$CHECKOUT/scripts/package-mount-smoke.js" \
      "$CONSUMER/node_modules/fuse-napi"
    ```

    Both machines must load the packaged native prebuild and complete the real
    readlink mount smoke test.
11. Publish that same verified tarball manually. For a stable release use
    `latest`; for a prerelease use `next`:

    ```sh
    read -s -p "npm OTP: " FUSE_NAPI_OTP
    echo
    npm publish "$TARBALL" \
      --access public \
      --provenance=false \
      --tag latest \
      --otp="$FUSE_NAPI_OTP"
    unset FUSE_NAPI_OTP
    ```

Use a version such as `<next-version>-rc.1` first when validating release
changes.
Prerelease tags publish under npm's `next` dist-tag; stable versions publish
under `latest`.

## Automated release gates

The manually confirmed workflow on the exact release tag:

- rejects a tag that differs from `package.json` or `package-lock.json`;
- invokes the complete Linux and hosted macOS CI matrix as a hard dependency;
- builds 18 Node.js ABI-specific prebuilds: three supported Node.js ABIs
  across four platform/architecture targets, plus both Linux architectures
  for libfuse SONAME 4;
- verifies architecture, libfuse 3 linkage, glibc 2.31, and macOS 12 baselines;
- loads every matching prebuild on Node.js 22, 24, and 26;
- assembles one npm tarball containing all 18 binaries;
- verifies and installs that exact tarball on every supported Node.js,
  platform, and architecture combination;
- performs real mounts with that tarball on Linux x64/arm64 and runs the
  modern syscall suite from the exact SONAME 4 package;
- records SHA-256 checksums and creates a CycloneDX production-dependency
  SBOM;
- creates GitHub build-provenance and SBOM attestations; and
- uploads the verified `npm-package` artifact without publishing it.

Real macOS mounts are intentionally manual. The release is not approved until
the full source suite and exact-tarball smoke test pass on physical Intel and
Apple Silicon hosts.

## Post-release verification

Verify the registry metadata and install the published artifact on at least
one clean Linux and one clean macOS host:

```sh
FUSE_NAPI_VERSION="$(node -p "require('./package.json').version")"
npm view "fuse-napi@$FUSE_NAPI_VERSION" version dist.integrity
npm install "fuse-napi@$FUSE_NAPI_VERSION"
node -e "require('fuse-napi')"
unset FUSE_NAPI_VERSION
```

Never reuse a published version or move an existing release tag. If a release
is defective, deprecate it on npm, document the reason, and publish a new
patch version.
