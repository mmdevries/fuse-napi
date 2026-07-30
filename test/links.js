const tape = require('tape')
const childProcess = require('child_process')
const fs = require('fs')
const path = require('path')
const { unmount } = require('./helpers')

const Fuse = require('../')
const createMountpoint = require('./fixtures/mnt')
const stat = require('./fixtures/stat')

const mnt = createMountpoint()

tape('readlink', function (t) {
  const readlinkBufferSize = Number(childProcess.execFileSync(
    'getconf',
    ['PATH_MAX', mnt],
    { encoding: 'utf8' }
  ).trim())
  const exactTarget = 'x'.repeat(readlinkBufferSize)
  const longTarget = 'target/'.repeat(10000)
  var ops = {
    readdir: function (path, cb) {
      if (path === '/') return process.nextTick(cb, null, ['hello', 'link', 'exact-link', 'long-link'])
      return process.nextTick(cb, Fuse.ENOENT)
    },
    readlink: function (path, cb) {
      if (path === '/long-link') return process.nextTick(cb, 0, longTarget)
      if (path === '/exact-link') return process.nextTick(cb, 0, exactTarget)
      process.nextTick(cb, 0, 'hello')
    },
    getattr: function (path, cb) {
      if (path === '/') return process.nextTick(cb, null, stat({ mode: 'dir', size: 4096 }))
      if (path === '/hello') return process.nextTick(cb, null, stat({ mode: 'file', size: 11 }))
      if (path === '/link') return process.nextTick(cb, null, stat({ mode: 'link', size: 5 }))
      if (path === '/exact-link') return process.nextTick(cb, null, stat({ mode: 'link', size: exactTarget.length }))
      if (path === '/long-link') return process.nextTick(cb, null, stat({ mode: 'link', size: longTarget.length }))
      return process.nextTick(cb, Fuse.ENOENT)
    },
    open: function (path, flags, cb) {
      process.nextTick(cb, 0, 42)
    },
    read: function (path, fd, buf, len, pos, cb) {
      var str = 'hello world'.slice(pos, pos + len)
      if (!str) return process.nextTick(cb, 0)
      buf.write(str)
      return process.nextTick(cb, str.length)
    }
  }

  const fuse = new Fuse(mnt, ops, { debug: true })
  fuse.mount(function (err) {
    t.error(err, 'no error')

    fs.lstat(path.join(mnt, 'link'), function (err, stat) {
      t.error(err, 'no error')
      t.same(stat.size, 5, 'correct size')

      fs.stat(path.join(mnt, 'hello'), function (err, stat) {
        t.error(err, 'no error')
        t.same(stat.size, 11, 'correct size')

        fs.readlink(path.join(mnt, 'link'), function (err, dest) {
          t.error(err, 'no error')
          t.same(dest, 'hello', 'link resolves')

          fs.readlink(path.join(mnt, 'exact-link'), function (err, exact) {
            t.error(err, 'no error')
            t.same(exact, exactTarget, 'link target that exactly fills the caller buffer is intact')

            fs.readlink(path.join(mnt, 'long-link'), function (err, truncated) {
              if (err) {
                t.fail(err.stack || err.message)
                return unmount(fuse, function () {
                  t.end()
                })
              }
              t.pass('no error')
              t.ok(longTarget.startsWith(truncated), 'oversized link target is safely truncated to the caller buffer')
              t.ok(truncated.length < longTarget.length, 'oversized link no longer fails with ENAMETOOLONG')

              fs.readFile(path.join(mnt, 'link'), function (err, buf) {
                t.error(err, 'no error')
                t.same(buf, Buffer.from('hello world'), 'can read link content')

                unmount(fuse, function () {
                  t.end()
                })
              })
            })
          })
        })
      })
    })
  })
})
