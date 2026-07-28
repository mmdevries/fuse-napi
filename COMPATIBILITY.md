# FUSE 2.9 compatibility matrix

This document describes the current `fuse-napi` contract inherited from
`@cocalc/fuse-native@2.4.3`, including the completed first macOS portability
milestone described in [PLAN.md](./PLAN.md).

## Callback matrix

All listed callbacks use the existing asynchronous JavaScript callback style.
The native layer exposes the FUSE 2.9 high-level API.

| JavaScript callback | Linux libfuse 2 | macFUSE libfuse 2 | Current status and differences |
| --- | --- | --- | --- |
| `init(cb)` | Yes | Yes | Public mount completion waits until the mounted device is visible; startup failure is bounded by the init timeout. |
| `access(path, mode, cb)` | Yes | Yes | Shared implementation. Suppressed by `default_permissions`. |
| `statfs(path, cb)` | Yes | Yes | Shared `struct statvfs` implementation with range-checked 64-bit fields. macFUSE also offers unsupported `statfs_x`. |
| `getattr(path, cb)` | Yes | Yes | Shared, zero-initialized implementation with range-checked 64-bit fields and platform-specific timestamp members. |
| `fgetattr(path, fd, cb)` | Yes | Yes | Shared implementation; path, descriptor, and result forwarding are regression-tested. |
| `flush(path, fd, cb)` | Yes | Yes | Shared implementation. May be called more than once per open. |
| `fsync(path, datasync, fd, cb)` | Yes | Yes | Shared implementation. |
| `fsyncdir(path, datasync, fd, cb)` | Yes | Yes | Shared implementation. |
| `readdir(path, cb)` | Yes | Yes | Shared implementation; offset is ignored and entries are returned as one JavaScript array. |
| `truncate(path, size, cb)` | Yes | Yes | Signed 64-bit transport; values outside the safe-number range are delivered as `bigint`. |
| `ftruncate(path, fd, size, cb)` | Yes | Yes | Signed 64-bit transport; values outside the safe-number range are delivered as `bigint`. |
| `utimens(path, atime, mtime, cb)` | Yes | Yes | Signed millisecond transport, including pre-epoch timestamps; distinct atime and mtime forwarding is regression-tested. |
| `readlink(path, cb)` | Yes | Yes | Shared implementation. |
| `chown(path, uid, gid, cb)` | Yes | Yes | Shared implementation; uid/gid behavior is covered on macOS. |
| `chmod(path, mode, cb)` | Yes | Yes | Shared implementation; permission changes are covered on macOS. |
| `mknod(path, mode, dev, cb)` | Yes | Yes | Shared implementation; useful node types vary by host policy. |
| `setxattr(path, name, value, position, flags, cb)` | Yes | Yes | macOS native signature includes `position`; Linux supplies position `0` to normalize the JS API. |
| `getxattr(path, name, position, cb)` | Yes | Yes | macOS native signature includes `position`; callback returns a `Buffer`. Round trips, listing, removal, and resource forks are covered. |
| `listxattr(path, cb)` | Yes | Yes | Uses an exact UTF-8/NUL size probe and returns `ERANGE` when the caller buffer is too small. |
| `removexattr(path, name, cb)` | Yes | Yes | Shared implementation. |
| `open(path, flags, cb)` | Yes | Yes | Shared implementation; macFUSE VFS and FSKit can produce different open modes. |
| `opendir(path, flags, cb)` | Yes | Yes | Forwards the open flags, not the uninitialized file handle. |
| `read(path, fd, buffer, length, position, cb)` | Yes | Yes | Signed 64-bit positions and lossless file handles; byte counts cannot exceed the supplied buffer. |
| `write(path, fd, buffer, length, position, cb)` | Yes | Yes | Signed 64-bit positions and lossless file handles; byte counts cannot exceed the supplied buffer. |
| `release(path, fd, cb)` | Yes | Yes | Shared implementation; return value is ignored by FUSE. |
| `releasedir(path, fd, cb)` | Yes | Yes | Shared implementation. |
| `create(path, mode, cb)` | Yes | Yes | Shared implementation. |
| `unlink(path, cb)` | Yes | Yes | Shared implementation; deletion while an open handle survives is covered on macOS. |
| `rename(src, dest, cb)` | Yes | Yes | Standard rename only; macFUSE's optional `renamex` flags are not exposed. |
| `link(src, dest, cb)` | Yes | Yes | Shared implementation. |
| `symlink(src, dest, cb)` | Yes | Yes | Shared implementation. |
| `mkdir(path, mode, cb)` | Yes | Yes | Shared implementation. |
| `rmdir(path, cb)` | Yes | Yes | Shared implementation. |

### Standard FUSE 2.9 callbacks not exposed

These callbacks are present in `struct fuse_operations` but absent from the
existing JavaScript API:

| Callback | Portability | Initial-release decision |
| --- | --- | --- |
| `getdir`, `utime` | Deprecated | Do not add; use `readdir` and `utimens`. |
| `destroy` | Linux and macOS | Not exposed to JavaScript; native unmount nevertheless joins the FUSE thread and releases all refs, semaphores, mutexes, async handles, channels, and sessions. |
| `lock`, `flock` | Linux and macOS | Defer; local kernel locking remains available. |
| `bmap` | Linux and macOS | Defer; block-device-specific. |
| `ioctl`, `poll` | Linux and macOS | Defer; needs a deliberate JS buffer/event API. |
| `write_buf`, `read_buf` | Linux and macOS | Defer; current Buffer bridge uses `read`/`write`. |
| `fallocate` | Linux and macOS headers | Defer; semantics differ and sparse-file coverage comes first. |

### macFUSE-only callbacks not exposed

macFUSE appends optional Darwin extensions to `struct fuse_operations`.
They are deliberately outside the first milestone:

| Callback | Typical purpose | Initial-release decision |
| --- | --- | --- |
| `monitor` | Finder/file watcher count changes | Defer; macFUSE-specific. |
| `renamex` | macOS rename flags | Use standard `rename`; test Finder fallbacks. |
| `statfs_x` | Darwin `struct statfs` | Use portable `statfs`. |
| `setvolname` | Change volume name | Use the `volname` mount option. |
| `exchange` | Exchange two paths | Defer; unsupported on recent macOS versions. |
| `getxtimes`, `setbkuptime`, `setchgtime`, `setcrtime` | macOS extended timestamps | Defer; test portable timestamps first. |
| `chflags` | BSD file flags | Defer. |
| `setattr_x`, `fsetattr_x` | Compound Darwin attribute updates | Defer; use standard callbacks. |

## Mount-option matrix

“Pass-through” means `_fuseOptions()` serializes the option and libfuse or the
platform mount helper decides whether it is accepted.

| JavaScript option | Serialized option/behavior | Linux | macFUSE VFS | Notes |
| --- | --- | --- | --- | --- |
| `debug` | `debug` | Yes | Yes | Also enabled by the inherited `DEBUG` environment check. |
| `allowOther` | `allow_other` | Yes | Yes | Security-sensitive; Linux may require `user_allow_other`. Pair with permission tests. |
| `allowRoot` | `allow_root` | Yes | Pass-through | Validate on macOS before documenting as supported. |
| `autoUnmount` | `auto_unmount` | Yes | Pass-through | Requires crash/interruption tests. |
| `defaultPermissions` | `default_permissions` | Yes | Yes | Boolean in both runtime and TypeScript declarations. |
| `blkdev` | `blkdev` | Linux-specific | Unverified | Boolean in both runtime and TypeScript declarations. |
| `blksize` | `blksize=<n>` | Pass-through | Pass-through | Validate accepted ranges on both kernels. |
| `maxRead` | `max_read=<n>` | Yes | Yes | Kernel/library limits can reduce the requested value. |
| `fd` | `fd=<n>` | Internal/special | Internal/special | Not a normal application mount option. |
| `userId` | `user_id=<n>` | Yes | Pass-through | Serialized as one value; explicit zero is preserved. |
| `fsname` | `fsname=<name>` | Yes | Yes | Finder presentation also depends on `volname`. |
| `subtype` | `subtype=<name>` | Yes | Pass-through | Verify Finder and `mount` output on macOS. |
| `kernelCache` | `kernel_cache` | Yes | Yes | High-level libfuse option. |
| `autoCache` | `auto_cache` | Yes | Yes | High-level libfuse option; timestamp correctness matters. |
| `umask` | `umask=<mask>` | Yes | Pass-through | Explicit zero is preserved; chmod behavior is covered. |
| `uid` | `uid=<n>` | Yes | Yes | Explicit zero is preserved; ownership behavior is covered. |
| `gid` | `gid=<n>` | Yes | Yes | Explicit zero is preserved; ownership behavior is covered. |
| `entryTimeout` | `entry_timeout=<s>` | Yes | Pass-through | Cache invalidation behavior needs tests. |
| `attrTimeout` | `attr_timeout=<s>` | Yes | Pass-through | Cache invalidation behavior needs tests. |
| `acAttrTimeout` | `ac_attr_timeout=<s>` | Yes | Pass-through | Used with auto-cache; verify macFUSE support. |
| `noforget` | `noforget` | Yes | Pass-through | High memory-retention risk. |
| `nonEmpty` | `nonempty` | Yes | Pass-through | Mount safety semantics differ by helper. |
| `remember` | `remember=<s>` | Yes | Pass-through | High-level libfuse path-cache behavior. |
| `modules` | `modules=<list>` | Yes | Pass-through | Depends on separately available FUSE modules. |
| `displayFolder` | `volname`, optionally `volicon` | No-op | Yes | Uses `name` or mount basename; only emitted on macOS. |
| `force` | Pre-mount unmount attempt | Yes | Yes | JavaScript lifecycle option, not a FUSE mount option. |
| `mkdir` | Create missing mount point | Yes | Yes | JavaScript lifecycle option. |
| `timeout` | JavaScript callback timeout | Yes | Yes | Bounds callbacks and mount startup; per-operation `false` and zero values are preserved. |
| `name` | Source for `volname` | No-op | Yes | Used only when `displayFolder` is enabled. |
| `onError` | JavaScript exception reporter | Yes | Yes | Receives operation exceptions and rejected promises before the request is completed with `EIO`. |

String-valued mount options reject NUL, comma, backslash, and newline
characters instead of allowing one JavaScript value to inject additional
libfuse options. Numeric options must be finite and within their declared
integer constraints.

### macFUSE backend options

macFUSE 5 defaults to its VFS/kernel-extension backend. Its public libfuse API
also accepts `backend=fskit` on supported macOS versions. `fuse-napi` does not
currently expose a dedicated backend option.

The first milestone targets the VFS backend because it preserves the broadest
FUSE behavior and accepts the inherited temporary mount points. Selecting
FSKit later through macFUSE's public libfuse API would still avoid a direct
FSKit implementation, but must be explicitly scoped and tested because
macFUSE documents these current differences:

- mount points must be under `/Volumes`;
- FUSE context is unavailable;
- most kernel-handled mount options are not implemented;
- notification APIs are unavailable; and
- performance is lower than the VFS backend.

## Errno compatibility

Callbacks return negated host errno values. The exported constants are
initialized with the inherited Linux values and then replaced by matching
values from the host's `os.constants.errno` where available. Linux therefore
retains its existing numbers while Darwin receives macOS values such as
`ENOSYS=-78`, `ENOTSUP=-45`, and `ETIMEDOUT=-60`.

Linux-only constants that have no host equivalent remain available for API
compatibility. Applications should return the portable constant matching the
operation; `ENOTSUP` is explicitly exported for macOS extended-attribute
behavior.
