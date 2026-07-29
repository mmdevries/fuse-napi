# FUSE 3 compatibility matrix

This document describes the current `fuse-napi` contract inherited from
`@cocalc/fuse-native@2.4.3`, including the completed portability and
production-hardening work for the first stable release.

## Callback matrix

All listed callbacks use the existing asynchronous JavaScript callback style.
The native layer targets the FUSE 3.1 high-level API
(`FUSE_USE_VERSION=31`) while retaining the callback contract from 1.x.

| JavaScript callback | Linux libfuse 3 | macFUSE libfuse 3 | Current status and differences |
| --- | --- | --- | --- |
| `init(cb)` / `initWithConfig(connection, cb)` | Yes | Yes | Legacy defaults remain unchanged. The enhanced variant exposes and validates the portable FUSE 3 connection fields before applying conservative limits/capabilities. Public mount completion waits until the mounted device is visible. |
| `access(path, mode, cb)` | Yes | Yes | Shared implementation. Suppressed by `default_permissions`. |
| `statfs(path, cb)` | Yes | Yes | Shared `struct statvfs` implementation with range-checked 64-bit fields. macFUSE also offers unsupported `statfs_x`. |
| `getattr(path, cb)` | Yes | Yes | Shared, zero-initialized implementation with range-checked 64-bit fields and platform-specific timestamp members. |
| `fgetattr(path, fd, cb)` | Yes | Yes | Shared implementation; path, descriptor, and result forwarding are regression-tested. |
| `flush(path, fd, cb)` | Yes | Yes | Shared implementation. May be called more than once per open. |
| `fsync(path, datasync, fd, cb)` | Yes | Yes | Shared implementation. |
| `fsyncdir(path, datasync, fd, cb)` | Yes | Yes | Shared implementation. |
| `readdir(path, cb)` / `readdirPaged(path, fd, offset, cb)` | Yes | Yes | Legacy mode returns one array with zero filler offsets. The mutually exclusive paged variant forwards the directory handle and signed 64-bit offset and requires one non-zero resume offset per entry. |
| `truncate(path, size, cb)` | Yes | Yes | Signed 64-bit transport; values outside the safe-number range are delivered as `bigint`. |
| `ftruncate(path, fd, size, cb)` | Yes | Yes | Signed 64-bit transport; values outside the safe-number range are delivered as `bigint`. |
| `utimens(path, atime, mtime, cb)` / `utimensWithTimespec(path, atime, mtime, cb)` | Yes | Yes | The legacy variant transports signed milliseconds. The mutually exclusive enhanced variant preserves seconds and nanoseconds exactly and safely enables `UTIME_NOW`/`UTIME_OMIT`. |
| `readlink(path, cb)` | Yes | Yes | Shared implementation; oversized targets are safely truncated and NUL-terminated to the caller-provided buffer. |
| `chown(path, uid, gid, cb)` | Yes | Yes | Shared implementation; uid/gid behavior is covered on macOS. |
| `chmod(path, mode, cb)` | Yes | Yes | Shared implementation; permission changes are covered on macOS. |
| `mknod(path, mode, dev, cb)` | Yes | Yes | Shared implementation; useful node types vary by host policy. |
| `setxattr(path, name, value, position, flags, cb)` | Yes | Yes | macOS native signature includes `position`; Linux supplies position `0`. JavaScript receives a request-owned copy rather than borrowed kernel memory. |
| `getxattr(path, name, position, cb)` | Yes | Yes | Callback returns a `Buffer`; validated bytes are copied into the native request only on completion. Round trips, listing, removal, and resource forks are covered. |
| `listxattr(path, cb)` | Yes | Yes | Uses an exact UTF-8/NUL size probe, request-owned output storage, and returns `ERANGE` when the caller buffer is too small. |
| `removexattr(path, name, cb)` | Yes | Yes | Shared implementation. |
| `open(path, flags, cb)` | Yes | Yes | Shared implementation; primitive handles remain compatible and `{ fd, directIO, keepCache, nonseekable }` can set portable result bits. |
| `opendir(path, flags, cb)` | Yes | Yes | Forwards open flags and accepts the same validated file-info result as `open`. |
| `read(path, fd, buffer, length, position, cb)` | Yes | Yes | Signed 64-bit positions and lossless handles; uses owned output memory and copies only a validated byte count to FUSE. |
| `write(path, fd, buffer, length, position, cb)` | Yes | Yes | Signed 64-bit positions and lossless handles; JavaScript receives an owned copy of the native request bytes. |
| `release(path, fd, cb)` | Yes | Yes | Shared implementation; return value is ignored by FUSE. |
| `releasedir(path, fd, cb)` | Yes | Yes | Shared implementation. |
| `create(path, mode, cb)` / `createWithFlags(path, mode, flags, cb)` | Yes | Yes | Legacy mode is unchanged. The mutually exclusive enhanced variant also receives the original open flags; both accept enriched file-info results. |
| `unlink(path, cb)` | Yes | Yes | Shared implementation; deletion while an open handle survives is covered on macOS. |
| `rename(src, dest, cb)` | Yes | Yes | Standard rename only; macFUSE's optional `renamex` flags are not exposed. |
| `link(src, dest, cb)` | Yes | Yes | Shared implementation. |
| `symlink(src, dest, cb)` | Yes | Yes | Shared implementation. |
| `mkdir(path, mode, cb)` | Yes | Yes | Shared implementation. |
| `rmdir(path, cb)` | Yes | Yes | Shared implementation. |
| `destroy(cb)` | Yes | Yes | Called once after an orderly exit of an initialized filesystem. Native cleanup waits for completion before releasing the environment and libfuse resources. |
| `lock(path, fd, command, lock, cb)` | Yes | Yes | Portable POSIX record-lock fields are transported losslessly; `F_GETLK` may return an updated lock. |
| `flock(path, fd, operation, cb)` | Yes | Yes | Shared BSD whole-file locking implementation. |
| `bmap(path, blockSize, index, cb)` | Yes | Yes | Lossless block-index transport for block-device-backed filesystems. |
| `ioctl(path, fd, command, argument, flags, data, cb)` | Yes | Yes | Bounded request-owned payloads up to 1 MiB. Unsafe unrestricted retry/iovec requests return `EOPNOTSUPP`. |
| `poll(path, fd, cb)` | Yes | Yes | Returns snapshot readiness and destroys the native poll handle once; delayed JavaScript notification handles are deliberately not retained. |
| `writeBuffer(path, fd, buffer, length, position, cb)` | Yes | Yes | Implements `write_buf`; generic vectors are flattened into request-owned bytes before JavaScript runs. Mutually exclusive with `write`. |
| `readBuffer(path, fd, length, position, cb)` | Yes | Yes | Implements `read_buf` with libfuse-compatible native ownership. Mutually exclusive with `read`. |
| `fallocate(path, fd, mode, offset, length, cb)` | Yes | Yes | Shared implementation with signed, lossless 64-bit range transport. |

### Deprecated FUSE callbacks

The portable callback contract from 1.x remains exposed. The two superseded
callbacks are intentionally represented by their modern equivalents:

| Callback | Status | Decision |
| --- | --- | --- |
| `getdir`, `utime` | Deprecated | Do not add; use `readdir` and `utimens`. |

### macFUSE-only callbacks not exposed

macFUSE appends optional Darwin extensions to `struct fuse_operations`.
They are deliberately outside the first milestone:

| Callback | Typical purpose | Initial-release decision |
| --- | --- | --- |
| `monitor` | Finder/file watcher count changes | Defer; macFUSE-specific. |
| `renamex` | macOS rename flags | Use standard `rename`; test Finder fallbacks. |
| Darwin `statfs` ABI | Darwin `struct statfs` | Adapted to the portable JavaScript `statfs` result. |
| `setvolname` | Change volume name | Use the `volname` mount option. |
| `exchange` | Exchange two paths | Defer; unsupported on recent macOS versions. |
| `getxtimes`, `setbkuptime`, `setchgtime`, `setcrtime` | macOS extended timestamps | Defer; test portable timestamps first. |
| `chflags` | BSD file flags | Defer. |
| Compound Darwin `setattr` | Metadata updates | Adapted in a stable chmod/chown/truncate/utimens sequence. |

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
| `directIo` | `fuse_config.direct_io` | Yes | Yes | Applied during FUSE 3 initialization. This is separate from returning `directIO` for one `open` or `create` result. |
| `umask` | `umask=<mask>` | Yes | Pass-through | Explicit zero is preserved; chmod behavior is covered. |
| `uid` | `uid=<n>` | Yes | Yes | Explicit zero is preserved; ownership behavior is covered. |
| `gid` | `gid=<n>` | Yes | Yes | Explicit zero is preserved; ownership behavior is covered. |
| `entryTimeout` | `entry_timeout=<s>` | Yes | Pass-through | Cache invalidation behavior needs tests. |
| `attrTimeout` | `attr_timeout=<s>` | Yes | Pass-through | Cache invalidation behavior needs tests. |
| `acAttrTimeout` | `ac_attr_timeout=<s>` | Yes | Pass-through | Used with auto-cache; verify macFUSE support. |
| `noforget` | `noforget` | Yes | Pass-through | High memory-retention risk. |
| `nonEmpty` | Compatibility no-op | Yes | Yes | Deprecated: FUSE 3 removed `nonempty` and permits non-empty mountpoints. |
| `remember` | `remember=<s>` | Yes | Pass-through | High-level libfuse path-cache behavior. |
| `modules` | `modules=<list>` | Yes | Pass-through | Depends on separately available FUSE modules. |
| `displayFolder` | `volname`, optionally `volicon` | No-op | Yes | Uses `name` or mount basename; only emitted on macOS. |
| `force` | Pre-mount unmount attempt | Yes | Yes | JavaScript lifecycle option, not a FUSE mount option. |
| `mkdir` | Create missing mount point | Yes | Yes | JavaScript lifecycle option. |
| `timeout` | JavaScript callback timeout | Yes | Yes | Bounds callbacks and mount startup; per-operation `false` and zero values are preserved. |
| `name` | Source for `volname` | No-op | Yes | Used only when `displayFolder` is enabled. |
| `onError` | JavaScript exception reporter | Yes | Yes | Receives operation exceptions and rejected promises before the request is completed with `EIO`. |
| `maxConcurrency` | Fixed native request-worker count | Yes | Yes | Integer from 1 through 64; defaults to 4 and bounds threads, outstanding callbacks, and request memory. |
| `nullPathOk` | `fuse_config.nullpath_ok` | Yes | Yes | Allows `null` paths for supported handle-based callbacks. |
| `noPath` | `fuse_config.nullpath_ok` compatibility mapping | Yes | Yes | Retains the 1.x behavior; affected callbacks must accept a `null` path. |

Historical native libfuse spellings are also accepted for JavaScript options whose
names differ: `allow_other`, `allow_root`, `auto_unmount`,
`default_permissions`, `max_read`, `user_id`, `kernel_cache`, `auto_cache`,
`direct_io`, `entry_timeout`, `attr_timeout`, `ac_attr_timeout`, `nonempty`,
and `nopath`. They are normalized to the JavaScript names above. Supplying
both forms with different values is an error.

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
