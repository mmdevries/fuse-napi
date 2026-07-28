const fs = require('fs')
const path = require('path')
const tape = require('tape')

const Fuse = require('../')
const createMountpoint = require('./fixtures/mnt')
const stat = require('./fixtures/stat')
const { unmount } = require('./helpers')

tape('timed-out read buffers remain valid request-owned memory', function (t) {
  const mnt = createMountpoint()
  let retainedBuffer
  const fuse = new Fuse(mnt, {
    getattr (name, cb) {
      if (name === '/') return process.nextTick(cb, 0, stat({ mode: 'dir', size: 4096 }))
      if (name === '/file') return process.nextTick(cb, 0, stat({ mode: 'file', size: 4 }))
      return process.nextTick(cb, Fuse.ENOENT)
    },
    open (name, flags, cb) {
      process.nextTick(cb, 0, 1)
    },
    read (name, fd, buffer, length, position, cb) {
      retainedBuffer = buffer
      // Deliberately let the operation timeout.
    },
    release (name, fd, cb) {
      process.nextTick(cb, 0)
    }
  }, {
    force: true,
    timeout: { default: false, read: 25 }
  })
  const keepAlive = setTimeout(() => {
    t.fail('mount did not complete')
    t.end()
  }, 5000)

  fuse.mount(function (err) {
    clearTimeout(keepAlive)
    if (err) {
      t.fail(err.stack || err.message)
      fs.rmdir(mnt, () => t.end())
      return
    }

    fs.readFile(path.join(mnt, 'file'), function (err) {
      t.equal(err && err.code, 'ETIMEDOUT', 'kernel request completes with the configured timeout')
      t.ok(Buffer.isBuffer(retainedBuffer), 'read received a Node.js-owned Buffer')
      if (Buffer.isBuffer(retainedBuffer)) {
        t.doesNotThrow(() => retainedBuffer.write('safe'), 'buffer remains writable after native completion')
        t.equal(retainedBuffer.toString('utf8', 0, 4), 'safe', 'retained buffer storage remains intact')
      }

      unmount(fuse, function (err) {
        t.error(err, 'filesystem unmounts cleanly')
        fs.rmdir(mnt, () => t.end())
      })
    })
  })
})
