# Changelog

All notable changes to this project are documented here. Releases follow
[Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- Production runtime preflight through `Fuse.checkEnvironment()`, performed
  automatically before mounts, with stable diagnostics for missing
  `fusermount3`, inaccessible `/dev/fuse`, `fuse.conf` policy, unsupported
  libfuse versions, and incompatible macFUSE buffer ownership.
- Handle-aware metadata callbacks, FUSE 3 rename flags, delayed poll
  notifications, `copy_file_range`, `lseek`, and native Linux `statx` support
  when built with libfuse 3.18 or newer.
- Deterministic option fuzzing, native static analysis, ASan/UBSan mount
  integration, repeated-mount soak coverage, and a libfuse 3.18 modern-syscall
  CI gate. The crashed-mount recovery fixture tolerates an incidental
  kernel-side auto-detach only by creating a new broken mount, so it still
  proves the real disconnected-mount path without becoming flaky. Mounted
  sanitizer and soak gates receive an explicit root capability boundary while
  the normal Linux matrix retains complete unprivileged integration coverage,
  preventing hosted-runner `EPERM` failures from masking sanitizer results.

### Changed

- Linux release packages now ship separate Node.js ABI-specific prebuilds for
  libfuse SONAME 3 and SONAME 4 on x64 and arm64. Local source builds retain
  priority and missing runtime dependencies produce actionable errors.
- `remember` mounts start and stop libfuse's inode-cache cleanup thread, while
  null-path operation combinations are rejected unless a safe handle-aware
  callback is configured.
- Release artifacts include a CycloneDX SBOM, checksums, and GitHub build and
  SBOM attestations.

### Fixed

- Forced recovery from a disconnected mount now waits, with a finite deadline,
  until the lazy FUSE detach is stable before starting a replacement mount. A
  racing helper failure is accepted only after the detached postcondition is
  proven; otherwise `EFUSEUNMOUNT` retains the helper and observation errors
  without continuing into native mount startup. This removes Linux races that
  could incorrectly report `Mountpoint in use`; a stalled detach after helper
  success reports `EFUSEUNMOUNTWAIT`. System unmount helpers no longer inherit
  `LD_*` or `DYLD_*` loader injection, and bounded helper output is retained in
  failure diagnostics.
- Native poll registrations now have thread-safe shared ownership across
  in-flight callbacks, explicit JavaScript closure, and concurrent teardown.
- FUSE 3 buffer, poll, worker, and inode-cache resources are released
  deterministically during normal and failed teardown paths.

## 2.1.0 - 2026-07-29

### Changed

- Mount options now pass an explicit FUSE 3 conformance preflight in both the
  constructor and the new `Fuse.validateOptions()` helper. Stable error codes
  identify removed/internal options, conflicts, missing dependencies,
  platform misuse, and invalid module identifiers before libfuse is invoked.
- `nonEmpty`/`nonempty`, `fd`, and `userId`/`user_id` are rejected with
  actionable errors instead of being ignored or reaching libfuse3.
- Contradictory access, page-cache, inode-retention, block-device, and
  auto-cache settings are rejected deterministically.

## 2.0.0 - 2026-07-29

### Added

- Native FUSE 3 support on Linux through `libfuse3.so.3` and on macOS through
  macFUSE 5's libfuse 3 runtime.
- Explicit macFUSE Darwin adapters for attributes, compound `setattr`,
  `statfs`, directory entries, resource-fork xattrs, and platform-specific
  `UTIME_NOW`/`UTIME_OMIT` encodings.

### Changed

- The native API target is now `FUSE_USE_VERSION=31`. Mount construction,
  unmounting, request reception, request processing, and buffer ownership use
  the FUSE 3 lifecycle without `fuse_chan`.
- FUSE 3's merged `getattr`/`fgetattr` and `truncate`/`ftruncate` callbacks are
  routed to the existing JavaScript operations based on file-handle presence.
- `directIo` is applied through `fuse_config.direct_io`; the removed
  `nonempty` option is not forwarded to libfuse3.
- Linux unmount helpers use `fusermount3`. Build discovery and release
  artifacts require `fuse3`/`libfuse3-dev` and verify libfuse 3 linkage.
- Supported Node.js versions are 22, 24, and 26; the minimum is Node.js 22.

### Compatibility

- This is a native-runtime breaking release: Linux requires libfuse 3 and
  macOS requires macFUSE 5 with its libfuse 3 headers and runtime. The 1.x
  callback surface and TypeScript contracts remain source-compatible.
- Release prebuilds retain the glibc 2.31 and macOS 12 deployment baselines.

## 1.1.1 - 2026-07-29

### Changed

- Native libfuse 2 option spellings such as `nonempty`, `direct_io`, and
  `allow_other` are accepted as explicit aliases for their JavaScript names.
  Aliases are normalized before validation, conflicting values are rejected,
  and unrelated unknown options remain errors.
- Standalone CI runs are manual-only; the workflow remains reusable by the
  manually triggered prebuild workflow.

## 1.1.0 - 2026-07-29

### Added

- The remaining non-deprecated portable FUSE 2.9 callbacks: `destroy`,
  `lock`, `flock`, `bmap`, bounded `ioctl`, snapshot `poll`, `write_buf`,
  `read_buf`, and `fallocate`.
- Lossless timespec input/output, including explicit `UTIME_NOW` and
  `UTIME_OMIT`, and request-local `fuse.context()` snapshots.
- A configurable fixed worker pool and real-mount production-hardening tests
  for concurrency limits, buffer-vector operations, request context, and
  destroy ordering.

### Changed

- Mount startup is asynchronous and cancellable, operation and option names
  are strictly validated, and unimplemented optional callbacks consistently
  return `ENOSYS`.
- Native teardown, cancellation, request ownership, callback deadlines, and
  64-bit/timestamp validation have been hardened for deterministic failure
  behavior.
- Worker-local request state and one dedicated libuv dispatcher per bounded
  worker are initialized before native threads start. This preserves a
  one-request/one-wakeup invariant across Node.js versions, while failed
  mounts retain all dispatcher backing storage until every close callback has
  completed.
- Worker thread identifiers are retired under the cleanup mutex before their
  threads are joined, preventing concurrent teardown from cancelling a stale
  `pthread_t`.
- Linux instance teardown now has one native owner for the complete FUSE 2
  unmount-and-destroy lifecycle; macOS retains its required force-detach before
  joining macFUSE request threads. Neither path accesses a channel after
  `fuse_unmount()` has destroyed it.

## 1.0.0 - 2026-07-28

### Added

- Stable Node-API bindings for the FUSE 2.9 high-level API on Linux and macOS.
- Node.js 20, 22, and 24 prebuilds for Linux and macOS on x64 and arm64.
- Enhanced, opt-in `initWithConfig`, `readdirPaged`, and `createWithFlags`
  callbacks while retaining their legacy callback alternatives.
- Lossless `bigint` transport for 64-bit file handles, offsets, sizes, inode
  values, counters, and timestamps outside JavaScript's safe-integer range.
- Per-operation callback timeouts and structured operation-error reporting.
- Exact npm-tarball installation tests and checksum-protected release
  artifacts.
- Mandatory automated real-mount release gates for exact npm tarballs on Linux
  x64/arm64, with documented manual equivalents on macOS Intel/Apple Silicon.
- Manual artifact creation on the exact release tag and manual npm publication
  with two-factor authentication; tag pushes cannot publish automatically.

### Changed

- Native teardown is deterministic and joins the FUSE thread before releasing
  JavaScript and libuv resources.
- Native request buffers are copied into request-owned JavaScript buffers, so
  late asynchronous consumers cannot reference expired kernel memory.
- Operation results, statistics, file-info flags, directory entries, extended
  attributes, mount options, and FUSE connection settings are range-checked
  before crossing the native boundary.
- Errno constants now include every errno exposed by the current host while
  retaining inherited compatibility constants.
- Oversized symbolic-link targets are truncated below the Linux kernel FUSE
  response limit while remaining null-terminated.
- Release automation uses current Node.js 24-based official GitHub actions,
  pinned by immutable commit SHA.
- The deprecated privileged `fuse-napi configure` command from `0.0.1` has
  been removed. Installing the host FUSE runtime remains an explicit
  administrator action.

### Compatibility notes

- Linux requires glibc 2.31 or newer and the system `libfuse.so.2` runtime.
- macOS requires macOS 12 or newer and the macFUSE libfuse 2 compatibility
  runtime.
- Operations time out after 15 seconds by default. Use `timeout` per operation
  or set a value to `false` only when an unbounded wait is intentional.
- A 64-bit value is a JavaScript `number` while exactly representable and a
  `bigint` otherwise.

## 0.0.1 - 2026-07-28

- Initial package publication used to validate the four-platform prebuild and
  npm packaging pipeline.
