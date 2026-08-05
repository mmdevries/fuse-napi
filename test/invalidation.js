const fs = require('fs')
const path = require('path')
const tape = require('tape')

const Fuse = require('../')
const createMountpoint = require('./fixtures/mnt')
const stat = require('./fixtures/stat')

tape('entry invalidation is portable, nested, and detached from operation callbacks', {
  skip: process.platform !== 'linux'
}, function (t) {
  const mnt = createMountpoint()
  const filename = path.join(mnt, 'bucket', 'file')
  let fileGetattrs = 0
  let operationError = null
  let mounted = false
  let fuse

  fuse = new Fuse(mnt, {
    getattr (name, cb) {
      if (name === '/') return process.nextTick(cb, 0, stat({ mode: 'dir' }))
      if (name === '/bucket') return process.nextTick(cb, 0, stat({ mode: 'dir' }))
      if (name === '/bucket/file') {
        fileGetattrs++
        return process.nextTick(cb, 0, stat({ mode: 'file' }))
      }
      if (name === '/trigger') {
        return fuse.invalidateEntry('/bucket/file', err => {
          operationError = err
          cb(0, stat({ mode: 'file' }))
        })
      }
      process.nextTick(cb, Fuse.ENOENT)
    },
    open (name, flags, cb) {
      process.nextTick(cb, 0, 1)
    },
    release (name, fd, cb) {
      process.nextTick(cb, 0)
    }
  }, {
    force: true,
    entryTimeout: 60,
    attrTimeout: 60
  })

  run()

  async function run () {
    try {
      await lifecycle(fuse, 'mount')
      mounted = true

      const handle = await fs.promises.open(filename, 'r')
      await handle.close()
      const before = fileGetattrs

      await invalidate(fuse, '/bucket/file')
      await fs.promises.stat(filename)
      t.ok(fileGetattrs > before, 'nested entry is looked up again after invalidation')

      await fs.promises.stat(path.join(mnt, 'trigger'))
      t.equal(operationError && operationError.code, 'EDEADLK', 'operation-local invalidation is rejected')
    } catch (err) {
      t.fail(err.stack || err.message)
    } finally {
      if (mounted) {
        try {
          await lifecycle(fuse, 'unmount')
        } catch (err) {
          t.fail(err.stack || err.message)
        }
      }
      fs.rmdir(mnt, () => t.end())
    }
  }
})

function invalidate (fuse, filename) {
  return new Promise((resolve, reject) => {
    fuse.invalidateEntry(filename, err => err ? reject(err) : resolve())
  })
}

function lifecycle (fuse, method) {
  return new Promise((resolve, reject) => {
    fuse[method](err => err ? reject(err) : resolve())
  })
}
