# fuse-napi

Node-API bindings for the FUSE 2.9 high-level API on Linux and macOS.

Install the stable package from npm:

```sh
npm install fuse-napi
```

The public API follows semantic versioning. See [CHANGELOG.md](./CHANGELOG.md)
for release notes and migration details.

This project starts from the exact published source of
[`@cocalc/fuse-native@2.4.3`](https://www.npmjs.com/package/@cocalc/fuse-native/v/2.4.3).
It preserves that package's callback-based JavaScript API and uses
`FUSE_USE_VERSION=29`. The native addon uses Node-API, with no direct V8 API
dependency.

The addon dynamically links an external FUSE 2 library:

- Linux uses the system `libfuse.so.2`.
- macOS uses the `libfuse.2.dylib` compatibility library installed by
  [macFUSE](https://macfuse.github.io/).

Neither libfuse nor macFUSE is bundled or installed by this package. See
[UPSTREAM.md](./UPSTREAM.md) for reproducible provenance and
[COMPATIBILITY.md](./COMPATIBILITY.md) for callback and mount-option details.

## Supported targets

| Platform | Minimum runtime | Architectures | Tested Node.js |
| --- | --- | --- | --- |
| Linux | glibc 2.31 and system libfuse 2 | x86-64, arm64 | 20, 22, 24 |
| macOS | macOS 12 and macFUSE libfuse 2 | Intel x86-64, Apple Silicon arm64 | 20, 22, 24 |

Release prebuilds are compiled on a glibc 2.31 Linux baseline and with
`MACOSX_DEPLOYMENT_TARGET=12.0`. The release workflow rejects binaries that
raise either minimum accidentally.

## Requirements

### Linux

Building from source requires a C/C++ toolchain, `pkg-config`, and the system
libfuse 2 development package. Running a prebuild still requires the system
libfuse 2 runtime.

On Debian or Ubuntu:

```sh
sudo apt-get install build-essential fuse libfuse-dev pkg-config
```

### macOS

[Install macFUSE](https://github.com/macfuse/macfuse/wiki/Getting-Started)
before installing or loading `fuse-napi`:

```sh
brew install --cask macfuse
```

Approve the macFUSE system extension in System Settings when prompted and
restart macOS if requested. Apple Silicon systems can additionally require
enabling kernel extensions in Startup Security Utility from macOS Recovery.
Installation alone is not sufficient until macFUSE is enabled.

No privileged package configuration command is installed or run. Host FUSE
installation and system-extension approval remain explicit administrator
tasks.

`fuse-napi` uses macFUSE's public libfuse 2 compatibility API and its default
VFS backend. It does not implement FSKit directly. If the headers, dylib, or
runtime are unavailable, installation/loading fails with an actionable
macFUSE error.

## Development

```sh
npm ci
npm test
```

`npm test` performs real mount operations and therefore needs `/dev/fuse` plus
mount privileges on Linux, or an installed and approved macFUSE extension on
macOS. `npm run test:unit` runs only the non-mounting dependency, errno,
lifecycle, and option tests.

The test suite is green on Linux arm64 with libfuse 2.9.9 and on Apple Silicon
with macFUSE 5.3.3. Hosted CI is configured to build both macOS architectures
but cannot load the macFUSE kernel extension. Real macOS mount integration is
therefore a documented manual release check on physical Intel and Apple
Silicon hosts. The automated release workflow performs exact-tarball mounts
and a readlink smoke test on Linux x64/arm64; maintainers repeat the
exact-tarball smoke test manually on both macOS architectures before
publication.

## Migrating from `@cocalc/fuse-native`

Change the package import; existing operation callbacks and mount methods are
retained:

```js
const Fuse = require('fuse-napi')
```

Error constants are negated host errno values. Linux values remain unchanged;
macOS receives the corresponding Darwin values. On macOS, filesystems that
want NFC and NFD names to compare equal must normalize lookup keys themselves.

## API

In order to create a FUSE mountpoint, you first need to create a `Fuse` object that wraps a set of implemented FUSE syscall handlers:

```js
const fuse = new Fuse(mnt, handlers, opts = {})
```

Create a new `Fuse` object.

`mnt` is the string path of your desired mountpoint.

`handlers` is an object mapping syscall names to implementations. The complete list of available syscalls is described below. As an example, if you wanted to implement a filesystem that only supports `getattr`, your handle object would look like:

```js
{
  getattr: function (path, cb) {
    if (path === '/') {
        cb(0, stat({ mode: 'dir', size: 4096 }));
        return;
    }
    if (path === '/test') {
        cb(0, stat({ mode: 'file', size: 11 }));
        return;
    }
    cb(Fuse.ENOENT);
  }
}
```

`opts` can include:

```js
{
  displayFolder: true, // Add a name/icon to the mounted volume on macOS.
  name: 'Folder Name', // Volume name used with displayFolder.
  debug: false,        // Enable detailed tracing of operations.
  force: false,        // Attempt to unmount before remounting.
  mkdir: false,        // Create the mountpoint before mounting.
  timeout: 15000,      // Operation and mount-start timeout in milliseconds.
  maxConcurrency: 4,   // Fixed native request-worker count (1 through 64).
  nullPathOk: false,   // Accept null paths for unlinked handle operations.
  noPath: false,       // Avoid path reconstruction for handle operations.
  onError: (error, operation, args) => {
    // Report exceptions thrown by an operation implementation.
  }
}
```

`timeout` can also be an object such as
`{ default: 15000, read: 30000, init: 5000 }`. Set an individual value or
`default` to `false` to disable that timeout deliberately.

Each operation callback is accepted only once. A timeout, synchronous
exception, or rejected promise is translated to a FUSE error and cannot leave
the native worker blocked. Return values, buffer lengths, directory entries,
extended attributes, statistics, and mount options are validated before they
cross the native boundary. Unknown option and operation names are rejected so
configuration mistakes cannot silently change filesystem behavior.

The native request loop uses exactly `maxConcurrency` workers instead of
libfuse 2's dynamically growing multithreaded loop. This bounds native
threads, outstanding JavaScript callbacks, and memory use under load. Mount
startup runs outside the JavaScript event loop and remains subject to the
configured `init` deadline.

For a larger usage example, see CoCalc's
[WebSocketFS FUSE integration](https://github.com/sagemathinc/websocketfs/tree/main/lib/fuse).

### FUSE API

The complete non-deprecated, portable FUSE 2.9 high-level callback surface is
supported. Deprecated `getdir` and `utime` are represented by `readdir` and
`utimens`. In general the callback for each op should be called with
`cb(returnCode, [value])`, where the return code is a number (`0` for OK and
`< 0` for errors). See below for a list of POSIX error codes.

File handles, file positions, sizes, inode counters, and other 64-bit values
are passed as a `number` while exactly representable and as a `bigint`
otherwise. Implementations must preserve a `bigint` file handle and return it
unchanged to their own storage layer.

During an operation, `fuse.context()` returns a frozen snapshot containing
`uid`, `gid`, `pid`, `umask`, and the portable `fuse_file_info` fields. The
context is isolated across promises and other asynchronous work with
`AsyncLocalStorage`; outside an operation it returns `null`. When
`nullPathOk` or `noPath` is enabled, the affected handle-based callbacks must
accept `null` as their path.

TypeScript: see [index.d.ts](./index.d.ts).

#### `ops.init(cb)`

Called on filesystem init.

#### `ops.initWithConfig(connection, cb)`

Enhanced, mutually exclusive alternative to `init`. `connection` is a frozen
snapshot of the portable FUSE 2 connection fields:
`protoMajor`, `protoMinor`, `asyncRead`, `maxWrite`, `maxReadahead`,
`capable`, `want`, `maxBackground`, and `congestionThreshold`.

The callback may return a conservative configuration containing `maxWrite`,
`maxReadahead`, `maxBackground`, `congestionThreshold`, `want`, and/or
`asyncRead`.
Requested limits may not exceed the values supplied by the kernel, `want`
must be a subset of `capable`, and the congestion threshold may not exceed
the background-request limit. Omitting the configuration preserves all
libfuse defaults.

#### `ops.access(path, mode, cb)`

Called before the filesystem accessed a file

#### `ops.statfs(path, cb)`

Called when the filesystem is being stat'ed. Accepts a fs stat object after the return code in the callback.

``` js
ops.statfs = function (path, cb) {
  cb(0, {
    bsize: 1000000,
    frsize: 1000000,
    blocks: 1000000,
    bfree: 1000000,
    bavail: 1000000,
    files: 1000000,
    ffree: 1000000,
    favail: 1000000,
    fsid: 1000000,
    flag: 1000000,
    namemax: 1000000
  })
}
```

#### `ops.getattr(path, cb)`

Called when a path is being stat'ed. Accepts a stat object (similar to the one returned in `fs.stat(path, cb)`) after the return code in the callback.

``` js
ops.getattr = function (path, cb) {
  cb(0, {
    mtime: new Date(),
    atime: new Date(),
    ctime: new Date(),
    size: 100,
    mode: 16877,
    uid: process.getuid(),
    gid: process.getgid()
  })
}
```

#### `ops.fgetattr(path, fd, cb)`

Same as above but is called when someone stats a file descriptor

#### `ops.flush(path, fd, cb)`

Called when a file descriptor is being flushed

#### `ops.fsync(path, datasync, fd, cb)`

Called when a file descriptor is being fsync'ed.

#### `ops.fsyncdir(path, datasync, fd, cb)`

Same as above but on a directory

#### `ops.readdir(path, cb)`

Called when a directory is being listed. Accepts an array of file/directory names after the return code in the callback

``` js
ops.readdir = function (path, cb) {
  cb(0, ['file-1.txt', 'dir'])
}
```

#### `ops.readdirPaged(path, fd, offset, cb)`

Enhanced, mutually exclusive alternative to `readdir` for large or remote
directories. `fd` is the handle returned by `opendir`; `offset` is an opaque
signed 64-bit resume value. Return
`cb(0, names, stats, nextOffsets)`, where every name has a corresponding
non-zero next offset. The kernel can resume at the last accepted offset when
its output buffer is full.

#### `ops.truncate(path, size, cb)`

Called when a path is being truncated to a specific size

#### `ops.ftruncate(path, fd, size, cb)`

Same as above but on a file descriptor

#### `ops.readlink(path, cb)`

Called when a symlink is being resolved. Accepts a pathname (that the link should resolve to) after the return code in the callback

``` js
ops.readlink = function (path, cb) {
  cb(null, 'file.txt') // make link point to file.txt
}
```

Targets longer than the kernel-provided buffer are truncated and
NUL-terminated as required by the FUSE 2 high-level callback contract.

#### `ops.chown(path, uid, gid, cb)`

Called when ownership of a path is being changed

#### `ops.chmod(path:string, mode:number, cb)`

Called when the mode of a path is being changed.  Always called
with mode a number (not a string).

#### `ops.mknod(path, mode, dev, cb)`

Called when a new device file is being made.

#### `ops.setxattr(path, name, value, position, flags, cb)`

Called when extended attributes is being set (see the extended docs for your platform).

`value` is a request-owned copy and can safely be consumed asynchronously.
Copy it only when your storage layer requires independent mutability or
lifetime management.

The position argument is mostly a legacy argument only used on MacOS but see the getxattr docs
on Mac for more on that (you probably don't need to use that).

#### `ops.getxattr(path, name, position, cb)`

Called when extended attributes is being read.

Return the extended attribute as the second argument to the callback (needs to be a buffer).
If no attribute is stored return `null` as the second argument.

The position argument is mostly a legacy argument only used on MacOS but see the getxattr docs
on Mac for more on that (you probably don't need to use that).

#### `ops.listxattr(path, cb)`

Called when extended attributes of a path are being listed.

Return a list of strings of the names of the attributes you have stored as the second argument to the callback.

#### `ops.removexattr(path, name, cb)`

Called when an extended attribute is being removed.

#### `ops.open(path, flags, cb)`

Called when a path is being opened. `flags` in a number containing the permissions being requested. Accepts a file descriptor after the return code in the callback.

``` js
var toFlag = function(flags) {
  flags = flags & 3
  if (flags === 0) return 'r'
  if (flags === 1) return 'w'
  return 'r+'
}

ops.open = function (path, flags, cb) {
  var flag = toFlag(flags) // convert flags to a node style string
  ...
  cb(0, 42) // 42 is a file descriptor
}
```

The callback may alternatively return
`{ fd, directIO, keepCache, nonseekable }`. This sets the corresponding
portable `fuse_file_info` result bits while retaining primitive file-handle
results for compatibility. `opendir` and both create variants accept the
same result object.

#### `ops.opendir(path, flags, cb)`

Same as above but for directories

#### `ops.read(path, fd, buffer, length, position, cb)`

Called when contents of a file is being read. You should write the result of the read to the `buffer` and return the number of bytes written as the first argument in the callback.
If no bytes were written (read is complete) return 0 in the callback.

The buffer is owned by the JavaScript request. It remains valid if an
operation times out or teardown starts; completed bytes are copied back to
the kernel only after the callback result has been validated.

``` js
var data = Buffer.from('hello world')

ops.read = function (path, fd, buffer, length, position, cb) {
  if (position >= data.length) return cb(0) // done
  var part = data.slice(position, position + length)
  part.copy(buffer) // write the result of the read to the result buffer
  cb(part.length) // return the number of bytes read
}
```

#### `ops.write(path, fd, buffer, length, position, cb)`

Called when a file is being written to. You can get the data being written in `buffer` and you should return the number of bytes written in the callback as the first argument.

The write buffer is a request-owned copy, so asynchronous consumers never
reference kernel request memory after a timeout.

``` js
ops.write = function (path, fd, buffer, length, position, cb) {
  console.log('writing', buffer.slice(0, length))
  cb(length) // we handled all the data
}
```

#### `ops.release(path, fd, cb)`

Called when a file descriptor is being released. Happens when a read/write is done etc.

#### `ops.releasedir(path, fd, cb)`

Same as above but for directories

#### `ops.create(path, mode, cb)`

Called when a new file is being opened.

#### `ops.createWithFlags(path, mode, flags, cb)`

Enhanced, mutually exclusive alternative to `create`. It also receives the
original FUSE/POSIX open flags. Its callback accepts either a primitive file
handle or the file-info result object described under `open`.

#### `ops.utimens(path, atime, mtime, cb)`

Called when the atime/mtime of a file is being changed. `atime` and `mtime`
are signed integer milliseconds since the Unix epoch and can be `bigint`
outside JavaScript's safe-integer range.

#### `ops.utimensWithTimespec(path, atime, mtime, cb)`

Mutually exclusive, lossless alternative to `utimens`. Both times are frozen
`{ seconds, nanoseconds }` values. Nanoseconds are preserved exactly and may
be `Fuse.UTIME_NOW` or `Fuse.UTIME_OMIT`; the native
`flag_utime_omit_ok` bit is enabled only for this variant. Stat timestamps may
also be returned in this timespec form.

#### `ops.destroy(cb)`

Called exactly once when an initialized filesystem exits through an orderly
libfuse teardown. Teardown waits for this callback, subject to the configured
operation deadline. JavaScript cannot be called once the Node-API environment
itself is already shutting down.

#### `ops.lock(path, fd, command, lock, cb)`

Handles portable POSIX record locks. `lock` is a frozen object with `type`,
`whence`, signed `start`, signed `length`, and `pid`. For `F_GETLK`, return an
updated lock as the second callback argument.

#### `ops.flock(path, fd, operation, cb)`

Handles BSD `flock` operations for filesystems that need remote locking.
Without this callback the kernel can still provide local locking.

#### `ops.bmap(path, blockSize, index, cb)`

Maps a file block to a device block. Return the mapped 64-bit index as the
second callback argument. This is meaningful for block-device-backed mounts.

#### `ops.ioctl(path, fd, command, argument, flags, data, cb)`

Handles bounded, well-formed FUSE 2 ioctls. `argument` and file handles remain
lossless, and `data` is request-owned. Return a same-length output Buffer.
Unrestricted retry/iovec ioctls are rejected with `EOPNOTSUPP` because their
borrowed-pointer protocol cannot be represented safely by this callback API.
Payloads larger than 1 MiB are rejected before entering JavaScript.

#### `ops.poll(path, fd, cb)`

Returns the current readiness event mask. The native poll handle is always
destroyed exactly once. This API intentionally provides snapshot readiness;
it does not retain a native handle for later JavaScript notifications.

#### `ops.writeBuffer(path, fd, buffer, length, position, cb)`

Mutually exclusive alternative to `write` implementing FUSE `write_buf`.
Generic memory/file-descriptor vectors are flattened into a request-owned
Buffer before JavaScript is called. Return the validated byte count.

#### `ops.readBuffer(path, fd, length, position, cb)`

Mutually exclusive alternative to `read` implementing FUSE `read_buf`.
Return `cb(0, buffer)` with at most `length` bytes; native storage is allocated
with the ownership rules required by libfuse.

#### `ops.fallocate(path, fd, mode, offset, length, cb)`

Allocates a signed 64-bit byte range for an open file.

#### `ops.unlink(path, cb)`

Called when a file is being unlinked.

#### `ops.rename(src, dest, cb)`

Called when a file is being renamed.

#### `ops.link(src, dest, cb)`

Called when a new link is created.

#### `ops.symlink(src, dest, cb)`

Called when a new symlink is created

#### `ops.mkdir(path, mode, cb)`

Called when a new directory is being created

#### `ops.rmdir(path, cb)`

Called when a directory is being removed

## License

MIT for these bindings.

The bindings retain their upstream MIT license and attribution. The external
[libfuse](https://github.com/libfuse/libfuse) and
[macFUSE](https://github.com/macfuse/macfuse) installations retain their own
licenses.

Security issues should be reported privately according to
[SECURITY.md](./SECURITY.md). Maintainer release procedures are documented in
[RELEASING.md](./RELEASING.md).
