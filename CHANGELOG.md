# Changelog

All notable changes to this project are documented here. Releases follow
[Semantic Versioning](https://semver.org/).

## Unreleased

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

- Native libfuse 2 option spellings such as `nonempty`, `direct_io`, and
  `allow_other` are accepted as explicit aliases for their JavaScript names.
  Aliases are normalized before validation, conflicting values are rejected,
  and unrelated unknown options remain errors.
- Standalone CI runs are manual-only; the workflow remains reusable by the
  manually triggered prebuild workflow.
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
