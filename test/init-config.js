const fs = require('fs')
const tape = require('tape')

const Fuse = require('../')
const createMountpoint = require('./fixtures/mnt')
const stat = require('./fixtures/stat')
const { unmount } = require('./helpers')

tape('initWithConfig exposes and applies portable FUSE 2 connection limits', function (t) {
  const mnt = createMountpoint()
  let connection
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
      return process.nextTick(cb, Fuse.ENOENT)
    }
  }, { force: true })

  fuse.mount(function (err) {
    t.error(err, 'filesystem mounts with a conservative connection configuration')
    if (err) {
      fs.rmdir(mnt, () => t.end())
      return
    }
    t.ok(connection, 'kernel connection information is delivered')
    t.ok(connection.protoMajor > 0, 'protocol version is populated')
    t.ok(connection.maxWrite > 0, 'kernel write limit is populated')
    t.equal(typeof connection.capable, 'number', 'capability mask is populated')

    unmount(fuse, function (err) {
      t.error(err, 'filesystem unmounts cleanly')
      fs.rmdir(mnt, () => t.end())
    })
  })
})
