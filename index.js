const os = require('os')
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')

const Nanoresource = require('nanoresource')
const loadBinding = require('node-gyp-build')
const { wrapMacFuseLoadError } = require('./lib/macfuse')

const IS_OSX = os.platform() === 'darwin'
let binding
try {
  binding = loadBinding(__dirname)
} catch (err) {
  throw IS_OSX ? wrapMacFuseLoadError(err) : err
}

const OSX_FOLDER_ICON = '/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericFolderIcon.icns'
const HAS_FOLDER_ICON = IS_OSX && fs.existsSync(OSX_FOLDER_ICON)
const DEFAULT_TIMEOUT = 15 * 1000
const MAX_INT32 = 0x7fffffff
const MIN_INT32 = -0x80000000
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)
const XATTR_NOT_FOUND = -(os.constants.errno.ENOATTR || os.constants.errno.ENODATA || 61)

const OpcodesAndDefaults = new Map([
  ['init', {
    op: binding.op_init
  }],
  ['error', {
    op: binding.op_error
  }],
  ['access', {
    op: binding.op_access,
    defaults: [0]
  }],
  ['statfs', {
    op: binding.op_statfs,
    defaults: [getStatfsArray()]
  }],
  ['fgetattr', {
    op: binding.op_fgetattr,
    defaults: [getStatArray()]
  }],
  ['getattr', {
    op: binding.op_getattr,
    defaults: [getStatArray()]
  }],
  ['flush', {
    op: binding.op_flush
  }],
  ['fsync', {
    op: binding.op_fsync
  }],
  ['fsyncdir', {
    op: binding.op_fsyncdir
  }],
  ['readdir', {
    op: binding.op_readdir,
    defaults: [[], []]
  }],
  ['truncate', {
    op: binding.op_truncate
  }],
  ['ftruncate', {
    op: binding.op_ftruncate
  }],
  ['utimens', {
    op: binding.op_utimens
  }],
  ['readlink', {
    op: binding.op_readlink,
    defaults: ['']
  }],
  ['chown', {
    op: binding.op_chown
  }],
  ['chmod', {
    op: binding.op_chmod
  }],
  ['mknod', {
    op: binding.op_mknod
  }],
  ['setxattr', {
    op: binding.op_setxattr
  }],
  ['getxattr', {
    op: binding.op_getxattr
  }],
  ['listxattr', {
    op: binding.op_listxattr
  }],
  ['removexattr', {
    op: binding.op_removexattr
  }],
  ['open', {
    op: binding.op_open,
    defaults: [0]
  }],
  ['opendir', {
    op: binding.op_opendir,
    defaults: [0]
  }],
  ['read', {
    op: binding.op_read,
    defaults: [0]
  }],
  ['write', {
    op: binding.op_write,
    defaults: [0]
  }],
  ['release', {
    op: binding.op_release
  }],
  ['releasedir', {
    op: binding.op_releasedir
  }],
  ['create', {
    op: binding.op_create,
    defaults: [0]
  }],
  ['unlink', {
    op: binding.op_unlink
  }],
  ['rename', {
    op: binding.op_rename
  }],
  ['link', {
    op: binding.op_link
  }],
  ['symlink', {
    op: binding.op_symlink
  }],
  ['mkdir', {
    op: binding.op_mkdir
  }],
  ['rmdir', {
    op: binding.op_rmdir
  }]
])

class Fuse extends Nanoresource {
  constructor (mnt, ops = {}, opts = {}) {
    super()

    if (typeof mnt !== 'string' || mnt.length === 0 || mnt.includes('\0')) {
      throw new TypeError('Mountpoint must be a non-empty, NUL-free string')
    }
    if (!ops || typeof ops !== 'object' || Array.isArray(ops)) {
      throw new TypeError('Operations must be an object')
    }
    if (!opts || typeof opts !== 'object' || Array.isArray(opts)) {
      throw new TypeError('Options must be an object')
    }
    validateOptions(opts)
    if (ops.error !== undefined) {
      throw new TypeError('Operation "error" is not a FUSE 2 operation and is not supported')
    }

    for (const [name] of OpcodesAndDefaults) {
      if (ops[name] !== undefined && typeof ops[name] !== 'function') {
        throw new TypeError(`Operation ${JSON.stringify(name)} must be a function`)
      }
    }

    this.opts = opts
    this.mnt = path.resolve(mnt)
    this.ops = ops
    this.timeout = normalizeTimeoutOption(opts.timeout)

    this._force = !!opts.force
    this._mkdir = !!opts.mkdir
    this._thread = null
    this._mountpointDev = null
    this._nativeMounted = false
    this._startupTimer = null
    this._tearingDown = false
    this._teardownCallbacks = []
    this._pendingSignals = new Set()
    this._handlers = this._makeHandlerArray()

    const implemented = [binding.op_init, binding.op_getattr]
    if (ops) {
      for (const [name, { op }] of OpcodesAndDefaults) {
        if (ops[name] && this._handlers[op]) implemented.push(op)
      }
    }
    this._implemented = new Set(implemented)

    // Used to determine if the user-defined callback needs to be nextTick'd.
    this._sync = true
  }

  _getImplementedArray () {
    const implemented = new Uint32Array(OpcodesAndDefaults.size)
    for (const impl of this._implemented) {
      implemented[impl] = 1
    }
    return implemented
  }

  _fuseOptions () {
    const options = []
    const hasValue = name => this.opts[name] !== undefined && this.opts[name] !== null

    if ((/\*|(?:^|,)fuse-(?:bindings|napi)(?:,|$)/.test(process.env.DEBUG || '')) || this.opts.debug) options.push('debug')
    if (this.opts.allowOther) options.push('allow_other')
    if (this.opts.allowRoot) options.push('allow_root')
    if (this.opts.autoUnmount) options.push('auto_unmount')
    if (this.opts.defaultPermissions) options.push('default_permissions')
    if (this.opts.blkdev) options.push('blkdev')
    if (hasValue('blksize')) options.push('blksize=' + mountInteger('blksize', this.opts.blksize))
    if (hasValue('maxRead')) options.push('max_read=' + mountInteger('maxRead', this.opts.maxRead))
    if (hasValue('fd')) options.push('fd=' + mountInteger('fd', this.opts.fd))
    if (hasValue('userId')) options.push('user_id=' + mountInteger('userId', this.opts.userId))
    if (this.opts.fsname) options.push('fsname=' + mountString('fsname', this.opts.fsname))
    if (this.opts.subtype) options.push('subtype=' + mountString('subtype', this.opts.subtype))
    if (this.opts.kernelCache) options.push('kernel_cache')
    if (this.opts.autoCache) options.push('auto_cache')
    if (hasValue('umask')) options.push('umask=' + mountInteger('umask', this.opts.umask))
    if (hasValue('uid')) options.push('uid=' + mountInteger('uid', this.opts.uid))
    if (hasValue('gid')) options.push('gid=' + mountInteger('gid', this.opts.gid))
    if (hasValue('entryTimeout')) options.push('entry_timeout=' + mountNumber('entryTimeout', this.opts.entryTimeout))
    if (hasValue('attrTimeout')) options.push('attr_timeout=' + mountNumber('attrTimeout', this.opts.attrTimeout))
    if (hasValue('acAttrTimeout')) options.push('ac_attr_timeout=' + mountNumber('acAttrTimeout', this.opts.acAttrTimeout))
    if (this.opts.noforget) options.push('noforget')
    if (this.opts.nonEmpty) options.push('nonempty')
    if (hasValue('remember')) options.push('remember=' + mountInteger('remember', this.opts.remember))
    if (this.opts.modules) options.push('modules=' + mountString('modules', this.opts.modules))

    if (this.opts.displayFolder && IS_OSX) { // only works on osx
      options.push('volname=' + mountString('name', path.basename(this.opts.name || this.mnt)))
      if (HAS_FOLDER_ICON) options.push('volicon=' + OSX_FOLDER_ICON)
    }

    return options.length ? '-o' + options.join(',') : ''
  }

  _makeHandlerArray () {
    const self = this
    const handlers = new Array(OpcodesAndDefaults.size)

    for (const [name, { op, defaults }] of OpcodesAndDefaults) {
      const nativeSignal = binding[`fuse_native_signal_${name}`]
      if (!nativeSignal) continue

      handlers[op] = makeHandler(name, op, defaults, nativeSignal)
    }

    return handlers

    function makeHandler (name, op, defaults, nativeSignal) {
      const to = operationTimeout(self.timeout, name)

      return function (nativeHandler, opCode, ...args) {
        const sig = signal.bind(null, nativeHandler)
        const input = [...args]
        const boundSignal = onceSignal(sig, input)
        const funcName = `_op_${name}`
        if (!self[funcName] || !self._implemented.has(op)) return boundSignal(-1, ...defaults)
        try {
          const result = self[funcName].apply(self, [boundSignal, ...args])
          if (result && typeof result.then === 'function') {
            result.catch(err => failOperation(err, boundSignal, input))
          }
          return result
        } catch (err) {
          return failOperation(err, boundSignal, input)
        }
      }

      function signal (nativeHandler, result, ...args) {
        result = normalizeResult(result, name)
        var arr = [nativeHandler, result, ...args]

        if (defaults) {
          while (arr.length > 2 && arr[arr.length - 1] === undefined) arr.pop()
          if (arr.length === 2) arr = arr.concat(defaults)
        }

        return process.nextTick(nativeSignal, ...arr)
      }

      function onceSignal (cb, input) {
        let called = false
        const timeout = to ? setTimeout(signalOnce, to, Fuse.ETIMEDOUT) : null
        signalOnce.cancel = () => failSignal(Fuse.EIO)
        self._pendingSignals.add(signalOnce)
        return signalOnce

        function signalOnce (err, ...args) {
          if (called) return
          called = true
          self._pendingSignals.delete(signalOnce)

          if (timeout) clearTimeout(timeout)

          if (err === Fuse.ETIMEDOUT) {
            switch (name) {
              case 'write':
              case 'read':
                return cb(err, 0, input[2].buffer)
              case 'setxattr':
              case 'getxattr':
                return cb(err, input[2].buffer)
              case 'listxattr':
                return cb(err, input[1].buffer)
            }
          }

          cb(err, ...args)
        }

        function failSignal (err) {
          switch (name) {
            case 'write':
            case 'read':
              return signalOnce(err, 0, input[2].buffer)
            case 'setxattr':
            case 'getxattr':
              return signalOnce(err, input[2].buffer)
            case 'listxattr':
              return signalOnce(err, input[1].buffer)
            default:
              return signalOnce(err)
          }
        }
      }

      function failOperation (err, cb, input) {
        self._reportOperationError(err, name, input)
        if (name === 'init') {
          const initError = err instanceof Error ? err : new Error(String(err))
          if (!initError.code) initError.code = 'EFUSEINIT'
          self._failOpen(initError)
        }
        switch (name) {
          case 'write':
          case 'read':
            return cb(Fuse.EIO, 0, input[2].buffer)
          case 'setxattr':
          case 'getxattr':
            return cb(Fuse.EIO, input[2].buffer)
          case 'listxattr':
            return cb(Fuse.EIO, input[1].buffer)
          default:
            return cb(Fuse.EIO)
        }
      }
    }
  }

  // Static methods

  static unmount (mnt, cb) {
    if (typeof cb !== 'function') cb = () => {}
    if (typeof mnt !== 'string' || mnt.length === 0 || mnt.includes('\0')) {
      return process.nextTick(cb, new TypeError('Mountpoint must be a non-empty, NUL-free string'))
    }

    const command = IS_OSX ? 'diskutil' : 'fusermount'
    const args = IS_OSX ? ['unmount', 'force', mnt] : ['-uz', mnt]
    execFile(command, args, { shell: false, timeout: DEFAULT_TIMEOUT }, err => {
      if (err) return cb(err)
      return cb(null)
    })
  }

  // Debugging methods

  // Lifecycle methods

  _open (cb) {
    const self = this

    if (this._force) {
      return fs.stat(path.join(this.mnt, 'test'), (err, st) => {
        if (err && (err.errno === Fuse.ENOTCONN || err.errno === Fuse.ENXIO)) return Fuse.unmount(this.mnt, open)
        return open()
      })
    }
    return open()

    function open () {
      self._thread = Buffer.alloc(binding.sizeof_fuse_thread_t)
      self._openCallback = cb

      let opts
      let implemented
      try {
        opts = self._fuseOptions()
        implemented = self._getImplementedArray()
      } catch (err) {
        return self._completeOpen(err)
      }

      return fs.stat(self.mnt, (err, stat) => {
        if (err && err.code !== 'ENOENT') return self._completeOpen(err)
        if (err) {
          if (!self._mkdir) return self._completeOpen(new Error('Mountpoint does not exist'))
          return fs.mkdir(self.mnt, { recursive: true }, err => {
            if (err) return self._completeOpen(err)
            fs.stat(self.mnt, (err, stat) => {
              if (err) return self._completeOpen(err)
              return onexists(stat)
            })
          })
        }
        if (!stat.isDirectory()) return self._completeOpen(new Error('Mountpoint is not a directory'))
        return onexists(stat)
      })

      function onexists (stat) {
        fs.stat(path.join(self.mnt, '..'), (parentErr, parent) => {
          if (parentErr) return self._completeOpen(parentErr)
          if (parent.dev !== stat.dev) return self._completeOpen(new Error('Mountpoint in use'))
          self._mountpointDev = stat.dev
          self._startMountTimer()
          try {
            binding.fuse_native_mount(self.mnt, opts, self._thread, self, self._handlers, implemented)
            self._nativeMounted = true
          } catch (err) {
            return self._completeOpen(err)
          }
        })
      }
    }
  }

  _close (cb) {
    this._teardown(null, cb)
  }

  // Handlers

  _op_init (signal) {
    if (!this.ops.init) {
      signal(0)
      this._waitForMount()
      return
    }
    return this.ops.init(err => {
      signal(err)
      if (err) {
        const initError = new Error(`FUSE init failed with result ${err}`)
        initError.code = 'EFUSEINIT'
        this._failOpen(initError)
      } else {
        this._waitForMount()
      }
    })
  }

  _completeOpen (err) {
    if (!this._openCallback) return
    this._clearMountTimer()
    if (err && !this._nativeMounted) this._thread = null
    const cb = this._openCallback
    this._openCallback = null
    process.nextTick(cb, err)
  }

  _startMountTimer () {
    if (this._startupTimer) return
    const timeout = mountTimeout(this.timeout)
    if (!timeout) return
    this._startupTimer = setTimeout(() => {
      const err = new Error(IS_OSX
        ? `Timed out waiting for macFUSE to mount ${JSON.stringify(this.mnt)}. ` +
          'Ensure macFUSE is installed and enabled in Privacy & Security, ' +
          'then restart macOS if requested. See https://macfuse.github.io/.'
        : `Timed out waiting for FUSE to mount ${JSON.stringify(this.mnt)}`)
      err.code = IS_OSX ? 'EMACFUSEMOUNT' : 'EFUSEMOUNTTIMEOUT'
      this._failOpen(err)
    }, timeout)
  }

  _clearMountTimer () {
    if (!this._startupTimer) return
    clearTimeout(this._startupTimer)
    this._startupTimer = null
  }

  _failOpen (err) {
    if (!this._openCallback) return
    this._clearMountTimer()
    if (!this._nativeMounted) return this._completeOpen(err)
    this._teardown(err, cleanupErr => this._completeOpen(cleanupErr || err))
  }

  _teardown (primaryError, cb) {
    if (typeof cb !== 'function') cb = () => {}
    this._teardownCallbacks.push({ primaryError, cb })
    if (this._tearingDown) return
    this._tearingDown = true

    const finish = cleanupError => {
      this._clearMountTimer()
      this._nativeMounted = false
      this._thread = null
      this._tearingDown = false

      const callbacks = this._teardownCallbacks
      this._teardownCallbacks = []
      for (const entry of callbacks) {
        const err = entry.primaryError || cleanupError || null
        process.nextTick(entry.cb, err)
      }
    }

    if (!this._nativeMounted || !this._thread) return finish(null)

    const cancelPending = () => {
      for (const signal of [...this._pendingSignals]) signal.cancel()
    }
    cancelPending()

    Fuse.unmount(this.mnt, unmountError => {
      if (unmountError) unmountError.unmountFailure = true
      cancelPending()

      try {
        binding.fuse_native_unmount(this._thread, nativeError => {
          finish(unmountError || nativeError || null)
        })
      } catch (nativeError) {
        finish(unmountError || nativeError)
      }
    })
  }

  _reportOperationError (err, operation, args) {
    if (this.opts.onError) {
      try {
        this.opts.onError(err, operation, args)
        return
      } catch (onErrorErr) {
        process.emitWarning(onErrorErr)
      }
    }
    process.emitWarning(err instanceof Error ? err : new Error(String(err)), {
      code: 'FUSE_OPERATION_ERROR',
      detail: `Operation: ${operation}`
    })
  }

  _respond (signal, operation, failureArgs, fn) {
    try {
      return fn()
    } catch (err) {
      this._reportOperationError(err, operation, [])
      return signal(Fuse.EIO, ...failureArgs)
    }
  }

  _waitForMount () {
    const self = this
    if (!this._startupTimer) this._startMountTimer()

    check()

    function check () {
      fs.stat(self.mnt, (err, stat) => {
        if (!err && stat.dev !== self._mountpointDev) {
          self._completeOpen(null)
          return
        }

        if (self._openCallback) setTimeout(check, 10)
      })
    }
  }

  _op_error (signal) {
    if (!this.ops.error) {
      signal(0)
      return
    }
    return this.ops.error(err => {
      return signal(err)
    })
  }

  _op_statfs (signal, path) {
    return this.ops.statfs(path, (err, statfs) => {
      if (err) return signal(err)
      return this._respond(signal, 'statfs', [], () => signal(0, getStatfsArray(statfs)))
    })
  }

  _op_getattr (signal, path) {
    if (!this.ops.getattr) {
      if (path !== '/') {
        signal(Fuse.EPERM)
      } else {
        signal(0, getStatArray({ mtime: new Date(0), atime: new Date(0), ctime: new Date(0), mode: 16877, size: 4096 }))
      }
      return
    }

    return this.ops.getattr(path, (err, stat) => {
      if (err) return signal(err, getStatArray())
      return this._respond(signal, 'getattr', [], () => signal(0, getStatArray(stat)))
    })
  }

  _op_fgetattr (signal, path, fd) {
    if (!this.ops.fgetattr) {
      if (path !== '/') {
        signal(Fuse.EPERM)
      } else {
        signal(0, getStatArray({ mtime: new Date(0), atime: new Date(0), ctime: new Date(0), mode: 16877, size: 4096 }))
      }
      return
    }
    return this.ops.fgetattr(path, fd, (err, stat) => {
      if (err) return signal(err)
      return this._respond(signal, 'fgetattr', [], () => signal(0, getStatArray(stat)))
    })
  }

  _op_access (signal, path, mode) {
    return this.ops.access(path, mode, err => {
      return signal(err)
    })
  }

  _op_open (signal, path, flags) {
    return this.ops.open(path, flags, (err, fd) => {
      if (err) return signal(err, 0)
      return this._respond(signal, 'open', [], () => signal(0, normalizeFileHandle(fd)))
    })
  }

  _op_opendir (signal, path, flags) {
    return this.ops.opendir(path, flags, (err, fd) => {
      if (err) return signal(err, 0)
      return this._respond(signal, 'opendir', [], () => signal(0, normalizeFileHandle(fd)))
    })
  }

  _op_create (signal, path, mode) {
    return this.ops.create(path, mode, (err, fd) => {
      if (err) return signal(err, 0)
      return this._respond(signal, 'create', [], () => signal(0, normalizeFileHandle(fd)))
    })
  }

  _op_utimens (signal, path, atimeLow, atimeHigh, mtimeLow, mtimeHigh) {
    const atime = getSignedDoubleArg(atimeLow, atimeHigh)
    const mtime = getSignedDoubleArg(mtimeLow, mtimeHigh)
    return this.ops.utimens(path, atime, mtime, err => {
      return signal(err)
    })
  }

  _op_release (signal, path, fd) {
    return this.ops.release(path, fd, err => {
      return signal(err)
    })
  }

  _op_releasedir (signal, path, fd) {
    return this.ops.releasedir(path, fd, err => {
      return signal(err)
    })
  }

  _op_read (signal, path, fd, buf, len, offsetLow, offsetHigh) {
    return this.ops.read(path, fd, buf, len, getSignedDoubleArg(offsetLow, offsetHigh), result => {
      return this._respond(signal, 'read', [0, buf.buffer], () => {
        return signal(normalizeIOResult(result, len), 0, buf.buffer)
      })
    })
  }

  _op_write (signal, path, fd, buf, len, offsetLow, offsetHigh) {
    return this.ops.write(path, fd, buf, len, getSignedDoubleArg(offsetLow, offsetHigh), result => {
      return this._respond(signal, 'write', [0, buf.buffer], () => {
        return signal(normalizeIOResult(result, len), 0, buf.buffer)
      })
    })
  }

  _op_readdir (signal, path) {
    return this.ops.readdir(path, (err, names, stats) => {
      if (err) return signal(err)
      return this._respond(signal, 'readdir', [], () => {
        if (!Array.isArray(names) || !names.every(isValidDirectoryEntry)) {
          throw new TypeError('readdir names must be valid NUL-free entry names of at most 255 UTF-8 bytes')
        }
        if (stats !== undefined && !Array.isArray(stats)) {
          throw new TypeError('readdir stats must be an array')
        }
        if (stats) stats = stats.map(getStatArray)
        return signal(0, names, stats || [])
      })
    })
  }

  _op_setxattr (signal, path, name, value, position, flags) {
    return this.ops.setxattr(path, name, value, position, flags, err => {
      return signal(err, value.buffer)
    })
  }

  _op_getxattr (signal, path, name, valueBuf, position) {
    return this.ops.getxattr(path, name, position, (err, value) => {
      if (err) return signal(err, valueBuf.buffer)
      return this._respond(signal, 'getxattr', [valueBuf.buffer], () => {
        if (value === null || value === undefined) return signal(XATTR_NOT_FOUND, valueBuf.buffer)
        if (!Buffer.isBuffer(value)) throw new TypeError('getxattr value must be a Buffer or null')
        if (valueBuf.length === 0) return signal(value.length, valueBuf.buffer)
        if (value.length > valueBuf.length) return signal(Fuse.ERANGE, valueBuf.buffer)
        value.copy(valueBuf)
        return signal(value.length, valueBuf.buffer)
      })
    })
  }

  _op_listxattr (signal, path, listBuf) {
    return this.ops.listxattr(path, (err, list) => {
      if (err) return signal(err, listBuf.buffer)
      return this._respond(signal, 'listxattr', [listBuf.buffer], () => {
        if (!Array.isArray(list) || !list.every(name => typeof name === 'string' && !name.includes('\0'))) {
          throw new TypeError('listxattr result must be an array of NUL-free strings')
        }

        const size = list.reduce((total, name) => total + Buffer.byteLength(name) + 1, 0)
        if (listBuf.length === 0) return signal(size, listBuf.buffer)
        if (size > listBuf.length) return signal(Fuse.ERANGE, listBuf.buffer)

        let ptr = 0
        for (const name of list) {
          ptr += listBuf.write(name, ptr, Buffer.byteLength(name), 'utf8')
          listBuf[ptr++] = 0
        }

        return signal(ptr, listBuf.buffer)
      })
    })
  }

  _op_removexattr (signal, path, name) {
    return this.ops.removexattr(path, name, err => {
      return signal(err)
    })
  }

  _op_flush (signal, path, fd) {
    return this.ops.flush(path, fd, err => {
      return signal(err)
    })
  }

  _op_fsync (signal, path, datasync, fd) {
    return this.ops.fsync(path, datasync !== 0, fd, err => {
      return signal(err)
    })
  }

  _op_fsyncdir (signal, path, datasync, fd) {
    return this.ops.fsyncdir(path, datasync !== 0, fd, err => {
      return signal(err)
    })
  }

  _op_truncate (signal, path, sizeLow, sizeHigh) {
    const size = getSignedDoubleArg(sizeLow, sizeHigh)
    return this.ops.truncate(path, size, err => {
      return signal(err)
    })
  }

  _op_ftruncate (signal, path, fd, sizeLow, sizeHigh) {
    const size = getSignedDoubleArg(sizeLow, sizeHigh)
    return this.ops.ftruncate(path, fd, size, err => {
      return signal(err)
    })
  }

  _op_readlink (signal, path) {
    return this.ops.readlink(path, (err, linkname) => {
      if (err) return signal(err)
      return this._respond(signal, 'readlink', [], () => {
        if (typeof linkname !== 'string' || linkname.includes('\0')) {
          throw new TypeError('readlink result must be a NUL-free string')
        }
        return signal(0, linkname)
      })
    })
  }

  _op_chown (signal, path, uid, gid) {
    return this.ops.chown(path, uid, gid, err => {
      return signal(err)
    })
  }

  _op_chmod (signal, path, mode) {
    return this.ops.chmod(path, mode, err => {
      return signal(err)
    })
  }

  _op_mknod (signal, path, mode, dev) {
    return this.ops.mknod(path, mode, dev, err => {
      return signal(err)
    })
  }

  _op_unlink (signal, path) {
    return this.ops.unlink(path, err => {
      return signal(err)
    })
  }

  _op_rename (signal, src, dest) {
    return this.ops.rename(src, dest, err => {
      return signal(err)
    })
  }

  _op_link (signal, src, dest) {
    return this.ops.link(src, dest, err => {
      return signal(err)
    })
  }

  _op_symlink (signal, src, dest) {
    return this.ops.symlink(src, dest, err => {
      return signal(err)
    })
  }

  _op_mkdir (signal, path, mode) {
    return this.ops.mkdir(path, mode, err => {
      return signal(err)
    })
  }

  _op_rmdir (signal, path) {
    return this.ops.rmdir(path, err => {
      return signal(err)
    })
  }

  // Public API

  mount (cb) {
    return this.open(cb)
  }

  unmount (cb) {
    return this.close(cb)
  }

  errno (code) {
    return (code && Fuse[code.toUpperCase()]) || -1
  }
}

Fuse.EPERM = -1
Fuse.ENOENT = -2
Fuse.ESRCH = -3
Fuse.EINTR = -4
Fuse.EIO = -5
Fuse.ENXIO = -6
Fuse.E2BIG = -7
Fuse.ENOEXEC = -8
Fuse.EBADF = -9
Fuse.ECHILD = -10
Fuse.EAGAIN = -11
Fuse.ENOMEM = -12
Fuse.EACCES = -13
Fuse.EFAULT = -14
Fuse.ENOTBLK = -15
Fuse.EBUSY = -16
Fuse.EEXIST = -17
Fuse.EXDEV = -18
Fuse.ENODEV = -19
Fuse.ENOTDIR = -20
Fuse.EISDIR = -21
Fuse.EINVAL = -22
Fuse.ENFILE = -23
Fuse.EMFILE = -24
Fuse.ENOTTY = -25
Fuse.ETXTBSY = -26
Fuse.EFBIG = -27
Fuse.ENOSPC = -28
Fuse.ESPIPE = -29
Fuse.EROFS = -30
Fuse.EMLINK = -31
Fuse.EPIPE = -32
Fuse.EDOM = -33
Fuse.ERANGE = -34
Fuse.EDEADLK = -35
Fuse.ENAMETOOLONG = -36
Fuse.ENOLCK = -37
Fuse.ENOSYS = -38
Fuse.ENOTEMPTY = -39
Fuse.ELOOP = -40
Fuse.EWOULDBLOCK = -11
Fuse.ENOMSG = -42
Fuse.EIDRM = -43
Fuse.ECHRNG = -44
Fuse.EL2NSYNC = -45
Fuse.EL3HLT = -46
Fuse.EL3RST = -47
Fuse.ELNRNG = -48
Fuse.EUNATCH = -49
Fuse.ENOCSI = -50
Fuse.EL2HLT = -51
Fuse.EBADE = -52
Fuse.EBADR = -53
Fuse.EXFULL = -54
Fuse.ENOANO = -55
Fuse.EBADRQC = -56
Fuse.EBADSLT = -57
Fuse.EDEADLOCK = -35
Fuse.EBFONT = -59
Fuse.ENOSTR = -60
Fuse.ENODATA = -61
Fuse.ETIME = -62
Fuse.ENOSR = -63
Fuse.ENONET = -64
Fuse.ENOPKG = -65
Fuse.EREMOTE = -66
Fuse.ENOLINK = -67
Fuse.EADV = -68
Fuse.ESRMNT = -69
Fuse.ECOMM = -70
Fuse.EPROTO = -71
Fuse.EMULTIHOP = -72
Fuse.EDOTDOT = -73
Fuse.EBADMSG = -74
Fuse.EOVERFLOW = -75
Fuse.ENOTUNIQ = -76
Fuse.EBADFD = -77
Fuse.EREMCHG = -78
Fuse.ELIBACC = -79
Fuse.ELIBBAD = -80
Fuse.ELIBSCN = -81
Fuse.ELIBMAX = -82
Fuse.ELIBEXEC = -83
Fuse.EILSEQ = -84
Fuse.ERESTART = -85
Fuse.ESTRPIPE = -86
Fuse.EUSERS = -87
Fuse.ENOTSOCK = -88
Fuse.EDESTADDRREQ = -89
Fuse.EMSGSIZE = -90
Fuse.EPROTOTYPE = -91
Fuse.ENOPROTOOPT = -92
Fuse.EPROTONOSUPPORT = -93
Fuse.ESOCKTNOSUPPORT = -94
Fuse.EOPNOTSUPP = -95
Fuse.ENOTSUP = -95
Fuse.EPFNOSUPPORT = -96
Fuse.EAFNOSUPPORT = -97
Fuse.EADDRINUSE = -98
Fuse.EADDRNOTAVAIL = -99
Fuse.ENETDOWN = -100
Fuse.ENETUNREACH = -101
Fuse.ENETRESET = -102
Fuse.ECONNABORTED = -103
Fuse.ECONNRESET = -104
Fuse.ENOBUFS = -105
Fuse.EISCONN = -106
Fuse.ENOTCONN = -107
Fuse.ESHUTDOWN = -108
Fuse.ETOOMANYREFS = -109
Fuse.ETIMEDOUT = -110
Fuse.ECONNREFUSED = -111
Fuse.EHOSTDOWN = -112
Fuse.EHOSTUNREACH = -113
Fuse.EALREADY = -114
Fuse.EINPROGRESS = -115
Fuse.ESTALE = -116
Fuse.EUCLEAN = -117
Fuse.ENOTNAM = -118
Fuse.ENAVAIL = -119
Fuse.EISNAM = -120
Fuse.EREMOTEIO = -121
Fuse.EDQUOT = -122
Fuse.ENOMEDIUM = -123
Fuse.EMEDIUMTYPE = -124

for (const [name, value] of Object.entries(os.constants.errno)) {
  if (typeof Fuse[name] === 'number') Fuse[name] = -value
}

module.exports = Fuse

function mountTimeout (timeout) {
  if (typeof timeout !== 'object' || !timeout) return timeout
  return operationTimeout(timeout, 'init')
}

function operationTimeout (timeout, operation) {
  if (typeof timeout !== 'object' || !timeout) return timeout
  const hasOperation = Object.prototype.hasOwnProperty.call(timeout, operation)
  const hasDefault = Object.prototype.hasOwnProperty.call(timeout, 'default')
  const value = hasOperation ? timeout[operation] : (hasDefault ? timeout.default : DEFAULT_TIMEOUT)
  return value === false ? 0 : value
}

function isValidDirectoryEntry (name) {
  return typeof name === 'string' &&
    name.length > 0 &&
    !name.includes('\0') &&
    !name.includes('/') &&
    Buffer.byteLength(name) <= 255
}

function getStatfsArray (statfs) {
  const ints = new Uint32Array(22)
  const values = [
    statfs && statfs.bsize,
    statfs && statfs.frsize,
    statfs && statfs.blocks,
    statfs && statfs.bfree,
    statfs && statfs.bavail,
    statfs && statfs.files,
    statfs && statfs.ffree,
    statfs && statfs.favail,
    statfs && statfs.fsid,
    statfs && statfs.flag,
    statfs && statfs.namemax
  ]
  const names = [
    'bsize', 'frsize', 'blocks', 'bfree', 'bavail', 'files',
    'ffree', 'favail', 'fsid', 'flag', 'namemax'
  ]
  for (let i = 0; i < values.length; i++) setUint64(ints, i * 2, values[i] ?? 0, `statfs.${names[i]}`)

  return ints
}

function setUint64 (arr, idx, value, name) {
  const num = toUint64(value, name)
  arr[idx] = Number(num & 0xffffffffn)
  arr[idx + 1] = Number(num >> 32n)
}

function setInt64 (arr, idx, value, name) {
  const num = toInt64(value, name)
  const bits = BigInt.asUintN(64, num)
  arr[idx] = Number(bits & 0xffffffffn)
  arr[idx + 1] = Number(bits >> 32n)
}

function getSignedDoubleArg (low, high) {
  const value = BigInt.asIntN(64, (BigInt(high) << 32n) | BigInt(low))
  if (value >= -MAX_SAFE_BIGINT && value <= MAX_SAFE_BIGINT) return Number(value)
  return value
}

function toDateMS (st) {
  if (typeof st === 'number') return st
  if (typeof st === 'bigint') return st
  if (st === undefined || st === null) return 0
  if (!(st instanceof Date) || Number.isNaN(st.getTime())) throw new TypeError('Stat timestamps must be valid Dates or integer milliseconds')
  return st.getTime()
}

function getStatArray (stat) {
  const ints = new Uint32Array(23)

  ints[0] = toUint32(stat && stat.mode, 'stat.mode')
  ints[1] = toUint32(stat && stat.uid, 'stat.uid')
  ints[2] = toUint32(stat && stat.gid, 'stat.gid')
  setUint64(ints, 3, (stat && stat.size) ?? 0, 'stat.size')
  setUint64(ints, 5, (stat && stat.dev) ?? 0, 'stat.dev')
  setUint64(ints, 7, (stat && stat.nlink) ?? 1, 'stat.nlink')
  setUint64(ints, 9, (stat && stat.ino) ?? 0, 'stat.ino')
  setUint64(ints, 11, (stat && stat.rdev) ?? 0, 'stat.rdev')
  setUint64(ints, 13, (stat && stat.blksize) ?? 0, 'stat.blksize')
  setUint64(ints, 15, (stat && stat.blocks) ?? 0, 'stat.blocks')
  setInt64(ints, 17, toDateMS(stat && stat.atime), 'stat.atime')
  setInt64(ints, 19, toDateMS(stat && stat.mtime), 'stat.mtime')
  setInt64(ints, 21, toDateMS(stat && stat.ctime), 'stat.ctime')

  return ints
}

function normalizeTimeoutOption (timeout) {
  if (timeout === false) return 0
  if (timeout === undefined) return DEFAULT_TIMEOUT
  if (typeof timeout === 'number') return timeoutNumber('timeout', timeout)
  if (!timeout || typeof timeout !== 'object' || Array.isArray(timeout)) {
    throw new TypeError('timeout must be a non-negative number, false, or an object')
  }

  const normalized = {}
  for (const [name, value] of Object.entries(timeout)) {
    if (value === false) {
      normalized[name] = false
    } else {
      normalized[name] = timeoutNumber(`timeout.${name}`, value)
    }
  }
  return normalized
}

function validateOptions (opts) {
  const booleanOptions = [
    'displayFolder', 'debug', 'force', 'mkdir', 'allowOther', 'allowRoot',
    'autoUnmount', 'defaultPermissions', 'blkdev', 'kernelCache', 'autoCache',
    'noforget', 'nonEmpty'
  ]
  const integerOptions = ['uid', 'gid', 'blksize', 'maxRead', 'fd', 'userId', 'umask', 'remember']
  const numberOptions = ['entryTimeout', 'attrTimeout', 'acAttrTimeout']
  const stringOptions = ['fsname', 'subtype', 'modules', 'name']

  for (const name of booleanOptions) {
    if (opts[name] !== undefined && typeof opts[name] !== 'boolean') {
      throw new TypeError(`${name} must be a boolean`)
    }
  }
  for (const name of integerOptions) {
    if (opts[name] !== undefined && opts[name] !== null) mountInteger(name, opts[name])
  }
  for (const name of numberOptions) {
    if (opts[name] !== undefined && opts[name] !== null) mountNumber(name, opts[name])
  }
  for (const name of stringOptions) {
    if (opts[name] !== undefined && opts[name] !== null) mountString(name, opts[name])
  }
  if (opts.onError !== undefined && typeof opts.onError !== 'function') {
    throw new TypeError('onError must be a function')
  }
}

function timeoutNumber (name, value) {
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be a non-negative safe integer`)
  }
  return value
}

function mountString (name, value) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string`)
  if (/[\0,\\\r\n]/.test(value)) {
    throw new TypeError(`${name} cannot contain NUL, comma, backslash, or a newline`)
  }
  return value
}

function mountNumber (name, value) {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be a non-negative finite number`)
  return value
}

function mountInteger (name, value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative safe integer`)
  return value
}

function normalizeResult (result, operation) {
  if (result === null || result === undefined) return 0
  if (!Number.isInteger(result) || result < MIN_INT32 || result > MAX_INT32) return Fuse.EIO
  if (result > 0 && operation !== 'read' && operation !== 'write' &&
      operation !== 'getxattr' && operation !== 'listxattr') {
    return Fuse.EIO
  }
  return result
}

function normalizeIOResult (result, length) {
  result = normalizeResult(result, 'read')
  if (result > length) throw new RangeError(`I/O callback returned ${result} bytes for a ${length}-byte buffer`)
  return result
}

function normalizeFileHandle (value) {
  if (value === null || value === undefined) return 0
  return toUint64Value(value, 'file handle')
}

function toUint32 (value, name) {
  if (value === undefined || value === null) return 0
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`${name} must be an unsigned 32-bit integer`)
  }
  return value
}

function toUint64Value (value, name) {
  const num = toUint64(value, name)
  return num <= MAX_SAFE_BIGINT ? Number(num) : num
}

function toUint64 (value, name) {
  let num
  if (typeof value === 'bigint') {
    num = value
  } else if (Number.isSafeInteger(value)) {
    num = BigInt(value)
  } else {
    throw new TypeError(`${name} must be a safe integer or bigint`)
  }
  if (num < 0n || num > 0xffffffffffffffffn) throw new RangeError(`${name} is outside the uint64 range`)
  return num
}

function toInt64 (value, name) {
  let num
  if (typeof value === 'bigint') {
    num = value
  } else if (Number.isSafeInteger(value)) {
    num = BigInt(value)
  } else {
    throw new TypeError(`${name} must be a safe integer or bigint`)
  }
  if (num < -0x8000000000000000n || num > 0x7fffffffffffffffn) {
    throw new RangeError(`${name} is outside the int64 range`)
  }
  return num
}
