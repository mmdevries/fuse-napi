const fs = require('fs')
const tape = require('tape')

const Fuse = require('../')
const createMountpoint = require('./fixtures/mnt')
const stat = require('./fixtures/stat')
const { unmount } = require('./helpers')

tape('initWithConfig exposes and applies portable FUSE 3 connection limits', function (t) {
  t.timeoutAfter(30000)
  const mnt = createMountpoint()
  let connection
  const contents = Buffer.alloc(768 * 1024, 0x61)
  const readLengths = []
  const fuse = new Fuse(mnt, {
    initWithConfig (snapshot, cb) {
      connection = snapshot
      cb(0, {
        maxWrite: Math.min(snapshot.maxWrite, 64 * 1024),
        maxReadahead: Math.min(snapshot.maxReadahead, 64 * 1024)
      })
    },
    getattr (name, cb) {
      if (name === '/') return process.nextTick(cb, 0, stat({ mode: 'dir', size: 4096 }))
      if (name === '/file') return process.nextTick(cb, 0, stat({ mode: 'file', size: contents.length }))
      return process.nextTick(cb, Fuse.ENOENT)
    },
    open (name, flags, cb) {
      process.nextTick(cb, 0, 1)
    },
    read (name, fd, buffer, length, position, cb) {
      readLengths.push(length)
      const bytes = Math.max(0, Math.min(length, contents.length - position))
      contents.copy(buffer, 0, position, position + bytes)
      process.nextTick(cb, bytes)
    },
    release (name, fd, cb) {
      process.nextTick(cb, 0)
    }
  }, { force: true, maxRead: 262144 })

  fuse.mount(function (err) {
    t.error(err, 'filesystem mounts with a conservative connection configuration')
    if (err) {
      fs.rmdir(mnt, () => t.end())
      return
    }
    t.ok(connection, 'kernel connection information is delivered')
    t.ok(connection.protoMajor > 0, 'protocol version is populated')
    t.ok(connection.maxWrite > 0, 'kernel write limit is populated')
    t.equal(connection.maxRead, 262144, 'configured maxRead reaches the native init connection exactly')
    t.equal(typeof connection.capable, 'number', 'capability mask is populated')

    fs.readFile(mnt + '/file', function (err, result) {
      t.error(err, 'a real FUSE 3 read succeeds with matching maximum read sizes')
      t.deepEqual(result, contents, 'the mounted filesystem returns the complete file')
      t.ok(readLengths.length > 0, 'the kernel issued read requests')
      t.ok(
        readLengths.every(length => length <= 262144),
        'the kernel never requests more than the configured maximum'
      )

      unmount(fuse, function (err) {
        t.error(err, 'filesystem unmounts cleanly')
        fs.rmdir(mnt, () => t.end())
      })
    })
  })
})
