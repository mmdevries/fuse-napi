# Changelog

All notable changes to this project are documented here. Releases follow
[Semantic Versioning](https://semver.org/).

## 1.0.0 - 2026-07-28

### Added

- Stable Node-API bindings for the FUSE 2.9 high-level API on Linux and macOS.
- Node.js 20, 22, and 24 prebuilds for Linux and macOS on x64 and arm64.
- Enhanced, opt-in `initWithConfig`, `readdirPaged`, and `createWithFlags`
  callbacks while retaining their legacy callback alternatives.
- Lossless `bigint` transport for 64-bit file handles, offsets, sizes, inode
  values, counters, and timestamps outside JavaScript's safe-integer range.
- Per-operation callback timeouts and structured operation-error reporting.
- Exact npm-tarball installation tests and provenance-enabled trusted
  publishing.
- Mandatory real-mount release gates for exact npm tarballs on Linux x64/arm64
  and macOS Intel/Apple Silicon.
- Explicit manual confirmation on the exact release tag before npm
  publication; tag pushes cannot publish automatically.

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
