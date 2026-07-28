const fs = require('fs')
const path = require('path')
const tape = require('tape')

const Fuse = require('../')
const createMountpoint = require('./fixtures/mnt')
const stat = require('./fixtures/stat')

tape('fgetattr arguments are forwarded', function (t) {
  const fuse = new Fuse('/tmp/fuse-napi-fgetattr', {
    fgetattr (name, fd, cb) {
      t.equal(name, '/test', 'fgetattr path')
      t.equal(fd, 42, 'fgetattr file descriptor')
      process.nextTick(cb, 0, stat({ mode: 'file', size: 7 }))
    }
  })

  fuse._op_fgetattr(function (err, result) {
    t.equal(err, 0, 'fgetattr succeeds')
    t.equal(result[3], 7, 'fgetattr result is returned')
    t.end()
  }, '/test', 42)
})

tape('utimens arguments are forwarded', function (t) {
  const mnt = createMountpoint()
  const filename = path.join(mnt, 'test')
  const atime = new Date('2020-01-02T03:04:05.000Z')
  const mtime = new Date('2021-02-03T04:05:06.000Z')
  let mounted = false
  let receivedTimes

  const fuse = new Fuse(mnt, {
    getattr (name, cb) {
      if (name === '/') return process.nextTick(cb, 0, stat({ mode: 'dir' }))
      if (name === '/test') return process.nextTick(cb, 0, stat({ mode: 'file', size: 1 }))
      process.nextTick(cb, Fuse.ENOENT)
    },
    utimens (name, receivedAtime, receivedMtime, cb) {
      receivedTimes = [receivedAtime, receivedMtime]
      process.nextTick(cb, 0)
    }
  }, { force: true })

  run()

  async function run () {
    try {
      await mount(fuse)
      mounted = true

      await fs.promises.utimes(filename, atime, mtime)
      t.same(receivedTimes, [atime.getTime(), mtime.getTime()], 'utimens receives distinct timestamps')
    } catch (err) {
      t.fail(err.stack || err.message)
    } finally {
      if (mounted) {
        try {
          await unmount(fuse)
        } catch (err) {
          t.fail(err.stack || err.message)
        }
      }
      fs.rmdir(mnt, () => t.end())
    }
  }
})

function mount (fuse) {
  return new Promise((resolve, reject) => {
    fuse.mount(err => err ? reject(err) : resolve())
  })
}

function unmount (fuse) {
  return new Promise((resolve, reject) => {
    fuse.unmount(err => err ? reject(err) : resolve())
  })
}
