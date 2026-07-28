const childProcess = require('child_process')
const path = require('path')
const tape = require('tape')
const loadBinding = require('node-gyp-build')

const Fuse = require('../')
const binding = loadBinding(path.join(__dirname, '..'))

tape('constructor and mount option inputs are validated', function (t) {
  t.throws(() => new Fuse(''), /Mountpoint/, 'empty mountpoint is rejected')
  t.throws(() => new Fuse('/tmp/a\0b'), /NUL-free/, 'NUL mountpoint is rejected')
  t.throws(() => new Fuse('/tmp/fuse-napi-invalid-ops', []), /Operations/, 'operation arrays are rejected')
  t.throws(
    () => new Fuse('/tmp/fuse-napi-invalid-handler', { read: true }),
    /Operation "read"/,
    'non-function operations are rejected'
  )
  t.throws(
    () => new Fuse('/tmp/fuse-napi-unsupported-handler', { error () {} }),
    /not a FUSE 2 operation/,
    'nonexistent legacy operation is rejected'
  )
  t.throws(
    () => new Fuse('/tmp/fuse-napi-invalid-timeout', {}, { timeout: -1 }),
    /non-negative safe integer/,
    'negative timeouts are rejected'
  )

  for (const value of ['name,allow_other', 'name\\allow_other', 'name\nallow_other', 'name\0allow_other']) {
    t.throws(
      () => new Fuse('/tmp/fuse-napi-invalid-option', {}, { fsname: value }),
      /cannot contain/,
      `unsafe mount option ${JSON.stringify(value)} is rejected`
    )
  }
  t.throws(
    () => new Fuse('/tmp/fuse-napi-invalid-boolean', {}, { force: 'yes' }),
    /force must be a boolean/,
    'boolean options are type checked'
  )

  const fuse = new Fuse('/tmp/fuse-napi-timeouts', {}, {
    timeout: { default: false, read: 10, init: 0 }
  })
  t.equal(fuse.timeout.default, false, 'disabled default timeout is preserved')
  t.equal(fuse.timeout.read, 10, 'per-operation timeout is preserved')
  t.equal(fuse.timeout.init, 0, 'zero mount timeout is preserved')
  t.end()
})

tape('unmount passes the mountpoint as a literal process argument', function (t) {
  const originalExecFile = childProcess.execFile
  const indexPath = require.resolve('../')
  const dangerousPath = '/tmp/fuse;touch /tmp/should-not-exist'

  childProcess.execFile = function (command, args, options, cb) {
    t.ok(command === 'diskutil' || command === 'fusermount', 'known unmount executable is selected')
    t.equal(args[args.length - 1], dangerousPath, 'mountpoint remains one literal argument')
    t.equal(options.shell, false, 'no shell is involved')
    process.nextTick(cb, null)
  }

  delete require.cache[indexPath]
  const IsolatedFuse = require('../')
  IsolatedFuse.unmount(dangerousPath, function (err) {
    childProcess.execFile = originalExecFile
    delete require.cache[indexPath]
    t.error(err, 'literal argument unmount succeeds')
    t.end()
  })
})

tape('operation failures, duplicate callbacks, and timeouts signal exactly once', function (t) {
  const originalSignal = binding.fuse_native_signal_access
  const reported = []

  runCase(
    cb => { throw new Error('sync failure') },
    { timeout: false, onError: err => reported.push(err.message) },
    Fuse.EIO
  )
    .then(() => runCase(
      () => Promise.reject(new Error('async failure')),
      { timeout: false, onError: err => reported.push(err.message) },
      Fuse.EIO
    ))
    .then(() => runCase(
      (name, mode, cb) => {
        cb(0)
        cb(Fuse.EIO)
      },
      { timeout: false, onError: err => reported.push(err.message) },
      0
    ))
    .then(() => runCase(
      () => {},
      { timeout: { default: false, access: 10 }, onError: err => reported.push(err.message) },
      Fuse.ETIMEDOUT
    ))
    .then(() => {
      t.deepEqual(reported, ['sync failure', 'async failure'], 'only implementation failures are reported')
    })
    .catch(err => t.fail(err.stack || err.message))
    .finally(() => {
      binding.fuse_native_signal_access = originalSignal
      t.end()
    })

  function runCase (access, opts, expected) {
    return new Promise((resolve, reject) => {
      let calls = 0
      const timer = setTimeout(() => reject(new Error('operation did not signal')), 250)
      binding.fuse_native_signal_access = function (nativeHandler, result) {
        calls++
        try {
          t.equal(result, expected, `operation signals ${expected}`)
          setTimeout(() => {
            try {
              t.equal(calls, 1, 'operation signals once')
              clearTimeout(timer)
              resolve()
            } catch (err) {
              reject(err)
            }
          }, 20)
        } catch (err) {
          clearTimeout(timer)
          reject(err)
        }
      }

      const fuse = new Fuse('/tmp/fuse-napi-operation-errors', { access }, opts)
      fuse._handlers[binding.op_access]({}, binding.op_access, '/test', 0)
    })
  }
})

tape('64-bit statistics, offsets, and file handles remain lossless', function (t) {
  const large = 0x20000000000001n
  const beforeEpoch = -2208988800000
  const fuse = new Fuse('/tmp/fuse-napi-64-bit', {
    getattr (name, cb) {
      cb(0, {
        mode: 0o100644,
        size: large,
        ino: large + 1n,
        atime: beforeEpoch,
        mtime: 0,
        ctime: 1
      })
    },
    open (name, flags, cb) {
      cb(0, large + 2n)
    },
    truncate (name, size, cb) {
      t.equal(size, -1, 'signed 64-bit offset is decoded')
      cb(0)
    }
  })

  fuse._op_getattr(function (err, stat) {
    t.equal(err, 0, 'large stat succeeds')
    t.equal(joinUint64(stat, 3), large, 'large file size is exact')
    t.equal(joinUint64(stat, 9), large + 1n, 'large inode is exact')
    t.equal(joinInt64(stat, 17), BigInt(beforeEpoch), 'pre-epoch timestamp is exact')
  }, '/test')

  fuse._op_open(function (err, fd) {
    t.equal(err, 0, 'large file handle succeeds')
    t.equal(fd, large + 2n, 'large file handle remains a bigint')
  }, '/test', 0)

  fuse._op_truncate(function (err) {
    t.equal(err, 0, 'signed offset operation succeeds')
  }, '/test', 0xffffffff, 0xffffffff)
  t.end()
})

tape('I/O, directory, readlink, and xattr outputs are bounded', function (t) {
  const errors = []
  const value = Buffer.from('value')
  const fuse = new Fuse('/tmp/fuse-napi-output-validation', {
    read (name, fd, buf, len, position, cb) {
      cb(len + 1)
    },
    readdir (name, cb) {
      cb(0, ['valid', 'invalid/name'])
    },
    readlink (name, cb) {
      cb(0, 'bad\0link')
    },
    getxattr (name, attribute, position, cb) {
      cb(0, value)
    },
    listxattr (name, cb) {
      cb(0, ['user.one', 'user.é'])
    }
  }, {
    onError (err, operation) {
      errors.push([operation, err.constructor.name])
    }
  })

  const readBuffer = Buffer.alloc(4)
  fuse._op_read(function (err, bytes) {
    t.equal(err, Fuse.EIO, 'oversized read result becomes EIO')
    t.equal(bytes, 0, 'oversized read exposes no bytes')
  }, '/test', 1, readBuffer, readBuffer.length, 0, 0)

  fuse._op_readdir(err => t.equal(err, Fuse.EIO, 'invalid directory entry becomes EIO'), '/')
  fuse._op_readlink(err => t.equal(err, Fuse.EIO, 'invalid readlink result becomes EIO'), '/link')

  fuse._op_getxattr(function (result) {
    t.equal(result, value.length, 'zero-length xattr buffer reports exact size')
  }, '/test', 'user.value', Buffer.alloc(0), 0)

  fuse._op_getxattr(function (result) {
    t.equal(result, Fuse.ERANGE, 'undersized xattr buffer returns ERANGE')
  }, '/test', 'user.value', Buffer.alloc(value.length - 1), 0)

  const exact = Buffer.alloc(value.length)
  fuse._op_getxattr(function (result) {
    t.equal(result, value.length, 'exact xattr buffer returns value length')
    t.equal(exact.toString(), 'value', 'xattr value is copied exactly')
  }, '/test', 'user.value', exact, 0)

  const listSize = Buffer.byteLength('user.one') + 1 + Buffer.byteLength('user.é') + 1
  fuse._op_listxattr(function (result) {
    t.equal(result, listSize, 'xattr list size probe uses UTF-8 bytes')
  }, '/', Buffer.alloc(0))

  fuse._op_listxattr(function (result) {
    t.equal(result, Fuse.ERANGE, 'undersized xattr list returns ERANGE')
  }, '/', Buffer.alloc(listSize - 1))

  t.deepEqual(
    errors,
    [['read', 'RangeError'], ['readdir', 'TypeError'], ['readlink', 'TypeError']],
    'invalid operation outputs are reported'
  )
  t.end()
})

tape('teardown cancels pending operations and coalesces callers', function (t) {
  const originalUnmount = Fuse.unmount
  const originalNativeUnmount = binding.fuse_native_unmount
  const fuse = new Fuse('/tmp/fuse-napi-teardown')
  let cancellations = 0
  let nativeCalls = 0
  const results = []

  Fuse.unmount = (mnt, cb) => process.nextTick(cb, null)
  binding.fuse_native_unmount = (thread, cb) => {
    nativeCalls++
    process.nextTick(cb, null)
  }
  fuse._nativeMounted = true
  fuse._thread = Buffer.alloc(8)
  const pending = {
    cancel () {
      cancellations++
      fuse._pendingSignals.delete(pending)
    }
  }
  fuse._pendingSignals.add(pending)

  fuse._teardown(null, err => done(err))
  fuse._teardown(null, err => done(err))

  function done (err) {
    results.push(err)
    if (results.length !== 2) return
    Fuse.unmount = originalUnmount
    binding.fuse_native_unmount = originalNativeUnmount
    t.deepEqual(results, [null, null], 'all teardown callers complete')
    t.equal(cancellations, 1, 'pending operation is cancelled once')
    t.equal(nativeCalls, 1, 'native cleanup runs once')
    t.equal(fuse._thread, null, 'native state reference is released')
    t.equal(fuse._nativeMounted, false, 'mounted state is cleared')
    t.end()
  }
})

function joinUint64 (array, index) {
  return (BigInt(array[index + 1]) << 32n) | BigInt(array[index])
}

function joinInt64 (array, index) {
  return BigInt.asIntN(64, joinUint64(array, index))
}
