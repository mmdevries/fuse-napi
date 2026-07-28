const fs = require('fs')
const tape = require('tape')

const Fuse = require('../')
const createMountpoint = require('./fixtures/mnt')
const stat = require('./fixtures/stat')
const { unmount } = require('./helpers')

tape('readdirPaged resumes with an opaque offset and directory handle', function (t) {
  const mnt = createMountpoint()
  const entries = Array.from({ length: 600 }, (_, index) => {
    return `entry-${String(index).padStart(4, '0')}-${'x'.repeat(96)}`
  })
  const observedOffsets = []
  const directoryHandle = 0x20000000000001n

  const fuse = new Fuse(mnt, {
    getattr (name, cb) {
      if (name === '/') return process.nextTick(cb, 0, stat({ mode: 'dir', size: 4096 }))
      return process.nextTick(cb, Fuse.ENOENT)
    },
    opendir (name, flags, cb) {
      process.nextTick(cb, 0, { fd: directoryHandle, keepCache: true })
    },
    readdirPaged (name, fd, offset, cb) {
      t.equal(name, '/', 'directory path is forwarded')
      t.equal(fd, directoryHandle, 'directory handle remains lossless')
      const start = Number(offset)
      observedOffsets.push(start)
      const names = entries.slice(start, start + 64)
      const nextOffsets = names.map((_, index) => start + index + 1)
      process.nextTick(cb, 0, names, undefined, nextOffsets)
    },
    releasedir (name, fd, cb) {
      process.nextTick(cb, 0)
    }
  }, { force: true })

  fuse.mount(function (err) {
    if (err) {
      t.fail(err.stack || err.message)
      fs.rmdir(mnt, () => t.end())
      return
    }

    fs.readdir(mnt, function (err, names) {
      t.error(err, 'paged directory read succeeds')
      t.deepEqual(names && names.sort(), entries.slice().sort(), 'all pages are returned without gaps or duplicates')
      t.equal(observedOffsets[0], 0, 'first page starts at offset zero')
      t.ok(observedOffsets.some(offset => offset > 0), 'kernel resumes at a supplied non-zero offset')

      unmount(fuse, function (err) {
        t.error(err, 'filesystem unmounts cleanly')
        fs.rmdir(mnt, () => t.end())
      })
    })
  })
})
