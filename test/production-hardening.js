const fs = require('fs')
const path = require('path')
const tape = require('tape')

const Fuse = require('../')
const createMountpoint = require('./fixtures/mnt')
const stat = require('./fixtures/stat')
const { unmount } = require('./helpers')

tape('bounded workers, Buffer operations, request context, and destroy integrate', function (t) {
  t.timeoutAfter(30000)
  const mnt = createMountpoint()
  let active = 0
  let maxActive = 0
  let destroyCalls = 0
  let readContext = null
  let written = null

  const fuse = new Fuse(mnt, {
    getattr (name, cb) {
      if (name === '/') return process.nextTick(cb, 0, stat({ mode: 'dir', size: 4096 }))
      if (name === '/test') return process.nextTick(cb, 0, stat({ mode: 'file', size: 11 }))
      if (name === '/write') return process.nextTick(cb, 0, stat({ mode: 'file', size: 0 }))
      if (!name.startsWith('/stress-')) return process.nextTick(cb, Fuse.ENOENT)

      active++
      maxActive = Math.max(maxActive, active)
      setTimeout(function () {
        active--
        cb(0, stat({ mode: 'file', size: 0 }))
      }, 30)
    },
    open (name, flags, cb) {
      cb(0, 42)
    },
    readBuffer (name, fd, length, position, cb) {
      readContext = fuse.context()
      cb(0, Buffer.from('hello world').subarray(Number(position), Number(position) + length))
    },
    writeBuffer (name, fd, buffer, length, position, cb) {
      written = Buffer.from(buffer.subarray(0, length))
      cb(length)
    },
    release (name, fd, cb) {
      cb(0)
    },
    destroy (cb) {
      destroyCalls++
      cb(0)
    }
  }, {
    force: true,
    attrTimeout: 0,
    maxConcurrency: 2
  })

  run()

  async function run () {
    let mounted = false
    try {
      await deadline(mount(fuse), 'mount')
      mounted = true

      const contents = await deadline(fs.promises.readFile(path.join(mnt, 'test')), 'read_buf')
      t.equal(contents.toString(), 'hello world', 'read_buf serves file contents')
      t.ok(readContext, 'native request context reaches Buffer operations')
      t.equal(readContext.uid, process.getuid(), 'request uid matches the caller')
      t.equal(readContext.pid, process.pid, 'request pid matches the caller')
      t.equal(readContext.fileInfo.fd, 42, 'request file handle is exposed')

      const handle = await deadline(fs.promises.open(path.join(mnt, 'write'), 'r+'), 'open for write_buf')
      try {
        await deadline(handle.write(Buffer.from('buffer-write'), 0, 12, 0), 'write_buf')
      } finally {
        await deadline(handle.close(), 'close write handle')
      }
      t.equal(written && written.toString(), 'buffer-write', 'write_buf receives owned bytes')

      await deadline(Promise.all(Array.from({ length: 12 }, (_, i) => {
        return fs.promises.stat(path.join(mnt, `stress-${i}`))
      })), 'concurrency stress')
      t.equal(maxActive, 2, 'native request concurrency never exceeds the configured worker count')
    } catch (err) {
      t.fail(err.stack || err.message)
    } finally {
      if (mounted) {
        try {
          await deadline(close(fuse), 'unmount')
        } catch (err) {
          t.fail(err.stack || err.message)
        }
      }
      t.equal(destroyCalls, 1, 'destroy runs exactly once during filesystem exit')
      fs.rmdir(mnt, () => t.end())
    }
  }
})

function mount (fuse) {
  return new Promise((resolve, reject) => {
    fuse.mount(err => err ? reject(err) : resolve())
  })
}

function close (fuse) {
  return new Promise((resolve, reject) => {
    unmount(fuse, err => err ? reject(err) : resolve())
  })
}

function deadline (promise, operation) {
  let timer
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${operation} exceeded its 5 second test deadline`)), 5000)
    })
  ]).finally(() => clearTimeout(timer))
}
