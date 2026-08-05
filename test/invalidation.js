const fs = require('fs')
const path = require('path')
const tape = require('tape')

const Fuse = require('../')
const createMountpoint = require('./fixtures/mnt')
const stat = require('./fixtures/stat')

tape('entry invalidation is portable, nested, and detached from operation callbacks', {
  skip: process.platform !== 'linux' && process.platform !== 'darwin'
}, function (t) {
  const mnt = createMountpoint()
  const filename = path.join(mnt, 'bucket', 'file')
  let fileGetattrs = 0
  let operationError = null
  let delayNextLookup = false
  let lookupStarted = null
  let mounted = false
  let fuse

  fuse = new Fuse(mnt, {
    getattr (name, cb) {
      if (name === '/') return process.nextTick(cb, 0, stat({ mode: 'dir' }))
      if (name === '/bucket') return process.nextTick(cb, 0, stat({ mode: 'dir' }))
      if (name === '/bucket/file') {
        fileGetattrs++
        if (delayNextLookup) {
          delayNextLookup = false
          lookupStarted()
          return setTimeout(cb, 50, 0, stat({ mode: 'file' }))
        }
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

      await invalidate(fuse, '/bucket/file')
      const started = new Promise(resolve => { lookupStarted = resolve })
      delayNextLookup = true
      const pendingLookup = fs.promises.stat(filename)
      await deadline(started, 'delayed lookup start')
      await deadline(Promise.all([
        pendingLookup,
        invalidate(fuse, '/bucket/file')
      ]), 'lookup/invalidation overlap')
      t.pass('an independent invalidation cannot block the JavaScript lookup response')

      await fs.promises.stat(path.join(mnt, 'trigger'))
      t.equal(operationError && operationError.code, 'EDEADLK', 'operation-local invalidation is rejected')

      const pendingInvalidations = Array.from({ length: 128 }, (_, index) => {
        return new Promise(resolve => fuse.invalidateEntry(`/teardown-${index}`, resolve))
      })
      const teardown = lifecycle(fuse, 'unmount')
      const [teardownErrors] = await deadline(
        Promise.all([Promise.all(pendingInvalidations), teardown]),
        'queued invalidation teardown'
      )
      mounted = false
      t.ok(
        teardownErrors.every(err => !err || err.code === 'ENOTCONN'),
        'queued invalidations settle safely during teardown'
      )
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

function deadline (promise, label) {
  let timer
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), 2000)
    })
  ]).finally(() => clearTimeout(timer))
}
