# fuse-napi implementation plan

## Scope

`fuse-napi` will provide Node-API bindings for the FUSE 2.9 high-level API on
Linux and macOS while retaining the JavaScript API inherited from
`@cocalc/fuse-native@2.4.3`.

The first major release will:

- define `FUSE_USE_VERSION=29`;
- dynamically link the system libfuse 2 library on Linux;
- dynamically link the libfuse 2 compatibility library installed by macFUSE
  on macOS;
- support Linux and macOS on x86-64 and arm64;
- not bundle macFUSE or implement FSKit directly; and
- keep platform branches narrow and explicit.

The callback and mount-option inventory is maintained in
[COMPATIBILITY.md](./COMPATIBILITY.md).

## Provenance verification

The repository history preserves the upstream import:

- commit `527b2fa` imports `@cocalc/fuse-native@2.4.3`;
- tag `cocalc-v2.4.3` identifies that import; and
- commit `458a94e` performs the initial `fuse-napi` metadata/documentation
  rename without changing `binding.gyp`, `fuse-native.c`, `index.js`,
  `index.d.ts`, or the inherited tests.

The published npm artifact was independently downloaded from
`@cocalc/fuse-native@2.4.3` and verified:

- npm SHA-1:
  `c9178130ef929af53b23692161bfb52810bc0945`;
- npm integrity:
  `sha512-oINV1aDDPHTZkIIjDFPMAGFypdoi2Vsy2OB+uPljIibcosRW/oTkDsfRUKFPcHgRx7qwVlQ4rcHH2T7mYsxTTw==`;
- all 20 files in the published artifact are byte-for-byte identical to tag
  `cocalc-v2.4.3`.

The upstream MIT notices are retained in `LICENSE`, `UPSTREAM.md`, repository
history, package contributors, and source attribution.

## Baseline results

### Linux

An unmodified build and test run was performed in a privileged Linux arm64
container using:

- Node.js 22.23.1;
- libfuse/libfuse-dev 2.9.9;
- the libfuse 2 `fusermount` runtime helper; and
- a real `/dev/fuse` device.

The addon built as an aarch64 ELF shared object and all 85 inherited tests
passed, including real mount and unmount operations. This supersedes the
current README statement that inherited arm64 tests fail.

Native Linux x86-64 and the requested Ubuntu 22.04/24.04 and Node.js
20/22/24 combinations still need to be exercised in CI.

### macOS

The unmodified addon compiled and linked against macFUSE's libfuse 2.9.9
compatibility library on an Apple Silicon host:

| Target | Result | Evidence |
| --- | --- | --- |
| darwin-arm64 | Build passed | arm64 Mach-O addon |
| darwin-x64 | Cross-build passed | x86_64 Mach-O addon |

`/usr/local/lib/libfuse.2.dylib` contains both arm64 and x86_64 slices. Both
addons link to that external dylib. A native Intel runtime test remains
required; a cross-build is not a substitute for running on Intel hardware.

No compiler errors were found against either the macFUSE 4.10.1 or 5.3.3
libfuse 2 headers. The inherited source already contains the two required
compile-time adaptations:

- macOS `struct stat` uses `st_atimespec`, `st_mtimespec`, and
  `st_ctimespec`; and
- macOS `setxattr`/`getxattr` callbacks include the extra `position`
  parameter.

Before macFUSE was approved, the macOS unified log reported
`KMErrorDomain Code=27` for extension
`io.macfuse.filesystems.macfuse.25`. After completing macOS Recovery security
configuration and approving macFUSE in Privacy & Security, an unmodified
minimal filesystem mounted through the VFS/kernel backend and served
`getattr`, `open`, `read`, and `statfs`; forced unmount also completed.

That runtime probe found a mount-readiness race. The FUSE `init` callback, and
therefore the public JavaScript mount callback, can complete before macOS has
made the mounted volume visible at the mount path. An immediate `readdir` or
`lstat` can consequently observe the underlying empty directory or return
`ENOENT`. Retrying after the volume becomes visible succeeds.

The unmodified inherited suite was then run with Node.js 24.11.1. It reached
the macFUSE VFS backend but could not complete:

- the large-file test observed the previous `4 GiB + 1` size through an open
  descriptor after a path-based truncate to `6 GiB + 2`, and its three
  positioned writes did not reach the JavaScript `write` callback;
- the following symlink test received its successful mount callback before
  the volume was visible, so its immediate `lstat` returned `ENOENT`; and
- that inherited test dereferenced the missing stat value and terminated the
  test process, leaving a mount that was explicitly cleaned up.

The readiness race is the first lifecycle fix. Large-file behavior will be
isolated in a dedicated macOS regression test rather than inferred from the
rest of the interrupted suite.

A source-unmodified probe also passed `-o backend=fskit` directly to macFUSE's
public libfuse API. It could not mount because the macFUSE privileged helper
was not active. FSKit is not selected for the first milestone: macFUSE
documents material limitations, including mount points being restricted to
`/Volumes`, incomplete mount-option support, unavailable FUSE context, and
lower I/O performance. The inherited tests use temporary mount points outside
`/Volumes`.

## Source findings

The implementation is already Node-API based. `fuse-native.c` includes
`node_api.h` and `napi-macros.h` and has no direct V8 include or V8 API use.
libuv and pthreads provide the worker-thread bridge.

The shared high-level FUSE implementation is viable on both platforms. The
known platform and correctness issues should be addressed with small changes:

1. `binding.gyp` relies unconditionally on `pkg-config fuse`. It needs
   platform-aware discovery and actionable macFUSE installation errors.
2. Loading a prebuild without macFUSE currently exposes a raw dynamic-loader
   error instead of an actionable message.
3. A mount can wait indefinitely for macFUSE authorization because the public
   callback is only completed by the FUSE `init` operation. Conversely, after
   `init`, the callback can fire before the mounted volume is visible at the
   mount path.
4. macOS unmount uses `diskutil unmount force`, while Linux uses
   `fusermount -uz`; lifecycle cleanup and repeated/forced unmount behavior
   require dedicated tests.
5. The exported errno constants are Linux values. Common POSIX values used by
   the first milestone match, but platform-specific and higher-numbered
   errors need an explicit compatibility policy.
6. macFUSE adds optional callbacks (`renamex`, `setvolname`, extended
   timestamps, `chflags`, and others). They must remain optional and isolated;
   the initial milestone can use the standard FUSE 2.9 subset.
7. `utimens` currently forwards the access timestamp twice in native code
   instead of forwarding the modification timestamp as its second value.
8. `_op_fgetattr` checks for `fgetattr` but calls `getattr`.
9. The `userId` mount option is serialized as two comma-separated values
   instead of `user_id=<value>`.
10. `index.d.ts` differs from the runtime API for xattrs, read/write
    callbacks, and several option types. Corrections must not alter runtime
    behavior.

Items 7-10 are inherited defects. They will be fixed in separate commits with
Linux regression coverage rather than folded into macOS platform work.

## Implementation phases

### Phase 0 — Baseline and contract

- Commit this plan and the compatibility matrices.
- Replace stale README baseline claims with reproducible results.
- Add non-mounting unit tests for option serialization and platform
  diagnostics.

Exit criteria:

- provenance is reproducible;
- supported and unsupported callbacks/options are explicit; and
- no functional source change is mixed into the baseline commit.

### Phase 1 — Build discovery and diagnostics

- Keep `pkg-config fuse` as the Linux source of compiler/linker flags.
- Add a narrowly scoped macOS discovery path for macFUSE's libfuse 2
  installation.
- Fail builds with an actionable macFUSE URL and installation instruction.
- Wrap addon loading so a missing macFUSE dylib produces the same actionable
  runtime error.
- Do not download, bundle, or install macFUSE.

Exit criteria:

- Linux still builds against the system libfuse 2 package;
- both macOS architectures build against macFUSE;
- missing-dependency tests assert clear errors.

### Phase 2 — Mount lifecycle portability

- Retain one shared `struct fuse_operations` implementation.
- Keep only signature/layout adaptations under `__APPLE__`.
- Add a bounded mount-initialization failure path so missing authorization
  cannot hang indefinitely.
- Complete the public macOS mount callback only after the mounted device is
  visible at the mount path.
- Isolate platform unmount command selection and make errors actionable.
- Fix cleanup ordering only where tests demonstrate a defect.

Exit criteria:

- all inherited Linux tests remain green;
- a minimal macOS mount reaches `init` and unmounts cleanly;
- no public JavaScript signature changes.

### Phase 3 — First milestone filesystem

- Add one in-memory integration fixture exercising, in order:
  `mkdir`, `readdir`, `create`, `write`, `read`, `rename`, `unlink`, and
  unmount.
- Run it on Linux and physical macOS hosts.
- Add native Intel macOS execution, not only cross-compilation.

Exit criteria:

- inherited Linux tests pass;
- the milestone fixture passes on Apple Silicon and Intel macOS;
- no existing JavaScript API changes are required by applications.

### Phase 4 — macOS behavior coverage

Add focused integration tests for:

- Finder-compatible directory access;
- Unicode NFC/NFD names and emoji;
- extended attributes, including size probes and missing attributes;
- `com.apple.ResourceFork` and AppleDouble behavior;
- chmod, chown, default permissions, uid, and gid;
- rename/unlink while handles remain open;
- atime, mtime, and ctime behavior;
- sparse and non-sparse large files;
- interrupted, normal, lazy, and forced unmounts.

Tests must identify whether they target macFUSE's VFS backend or an explicitly
supported alternative. Backend-specific expectations must not be presented as
portable FUSE behavior.

### Phase 5 — CI and prebuilds

Establish build/test matrices for:

- Ubuntu 22.04 and 24.04;
- current supported GitHub Actions macOS runners;
- Node.js 20, 22, and 24;
- x86-64 and arm64.

Produce Node-API prebuilds for:

- `linux-x64`;
- `linux-arm64`;
- `darwin-x64`;
- `darwin-arm64`.

Linux mount tests should run only where `/dev/fuse` and mount privileges are
available. GitHub-hosted macOS virtual machines cannot load the macFUSE kernel
extension; macOS mount integration therefore requires physical self-hosted
Intel and Apple Silicon runners. Hosted macOS jobs can still build, inspect
architectures/linkage, run non-mounting tests, and create prebuilds.

Exit criteria:

- prebuilds load on Node.js 20/22/24 without recompilation;
- npm packaging includes all four prebuild directories;
- runtime remains dynamically linked to external libfuse/macFUSE;
- release jobs verify architecture and dynamic-library dependencies.

## Commit sequence

Each item should remain independently reviewable and keep Linux green:

1. `docs: record fuse 2.9 compatibility plan`
2. `test: cover mount option serialization and dependency diagnostics`
3. `build: discover libfuse on linux and macos`
4. `fix: report missing macfuse dependency`
5. `fix: bound macos mount initialization`
6. `test: add cross-platform in-memory milestone filesystem`
7. `fix: correct inherited callback forwarding defects`
8. `ci: add supported os and node build matrix`
9. `ci: produce node-api prebuilds`
10. focused macOS behavior commits, one behavior group at a time

## Principal risks

- **macFUSE authorization:** installation alone is insufficient for the VFS
  backend on Apple Silicon; users must enable and approve its kernel
  extension.
- **Hosted CI limitations:** macOS hosted runners cannot validate real
  kernel-backend mounts.
- **ABI/runtime linkage:** prebuilds compile without bundling libfuse and must
  resolve the external library consistently on end-user systems.
- **Darwin errno values:** returning Linux-only numeric constants can report
  the wrong error on macOS.
- **Finder behavior:** Finder generates metadata, xattr, resource-fork, and
  open-handle patterns absent from the inherited suite.
- **Unicode normalization:** macFUSE normalizes path names; applications must
  not assume byte-preserving round trips between NFC and NFD.
- **Unmount races:** the FUSE loop, external unmount helper, libuv handles,
  and Node resource lifecycle currently have incomplete join/cleanup logic.
- **Large files:** JavaScript numbers are exact only through
  `Number.MAX_SAFE_INTEGER`; the current split-uint32 transport must be tested
  at multi-gigabyte offsets.
- **Scope creep:** macFUSE-specific callbacks and FSKit must not trigger a
  broad rewrite of the shared FUSE 2.9 implementation.
