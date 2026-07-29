const tape = require('tape')
const fs = require('fs')
const path = require('path')
const concat = require('concat-stream')

const Fuse = require('../')
const createMountpoint = require('./fixtures/mnt')
const stat = require('./fixtures/stat')
const simpleFS = require('./fixtures/simple-fs')

const { unmount } = require('./helpers')
const mnt = createMountpoint()

tape('read', function (t) {
  const testFS = simpleFS({
    release: function (path, fd) {
      t.same(fd, 42, 'fd was passed to release')
    }
  })
  const fuse = new Fuse(mnt, testFS, { debug: true })
  fuse.mount(function (err) {
    t.error(err, 'no error')

    fs.readFile(path.join(mnt, 'test'), function (err, buf) {
      t.error(err, 'no error')
      t.same(buf, Buffer.from('hello world'), 'read file')

      fs.readFile(path.join(mnt, 'test'), function (err, buf) {
        t.error(err, 'no error')
        t.same(buf, Buffer.from('hello world'), 'read file again')

        fs.createReadStream(path.join(mnt, 'test'), { start: 0, end: 4 }).pipe(concat(function (buf) {
          t.same(buf, Buffer.from('hello'), 'partial read file')

          fs.createReadStream(path.join(mnt, 'test'), { start: 6, end: 10 }).pipe(concat(function (buf) {
            t.same(buf, Buffer.from('world'), 'partial read file + start offset')

            unmount(fuse, function () {
              t.end()
            })
          }))
        }))
      })
    })
  })
})

tape('read timeout does not force unmount', function (t) {
  var ops = {
    readdir: function (path, cb) {
      if (path === '/') return process.nextTick(cb, null, ['test'])
      return process.nextTick(cb, Fuse.ENOENT)
    },
    getattr: function (path, cb) {
      if (path === '/') return process.nextTick(cb, null, stat({ mode: 'dir', size: 4096 }))
      if (path === '/test') return process.nextTick(cb, null, stat({ mode: 'file', size: 11 }))
      if (path === '/timeout') return process.nextTick(cb, null, stat({ mode: 'file', size: 11 }))
      return process.nextTick(cb, Fuse.ENOENT)
    },
    open: function (path, flags, cb) {
      return process.nextTick(cb, 0, 42)
    },
    release: function (path, fd, cb) {
      t.same(fd, 42, 'fd was passed to release')
      return process.nextTick(cb, 0)
    },
    read: function (path, fd, buf, len, pos, cb) {
      if (path === '/test') {
        var str = 'hello world'.slice(pos, pos + len)
        if (!str) return process.nextTick(cb, 0)
        buf.write(str)
        return process.nextTick(cb, str.length)
      } else if (path === '/timeout') {
        // Deliberately never complete this request. The binding must time it out.
        return
      }
      return cb(-2)
    }
  }

  const fuse = new Fuse(mnt, ops, {
    debug: false,
    force: true,
    timeout: { default: 5000, read: 25 }
  })
  fuse.mount(function (err) {
    t.error(err, 'no error')

    fs.readFile(path.join(mnt, 'test'), function (err, buf) {
      t.error(err, 'no error')
      t.same(buf, Buffer.from('hello world'), 'read file')

      fs.readFile(path.join(mnt, 'timeout'), function (err, buf) {
        t.ok(err, 'stalled read returns an error after its short deadline')
        fs.readFile(path.join(mnt, 'test'), function (err, buf) {
          t.error(err, 'filesystem remains mounted after a timed-out request')
          t.same(buf, Buffer.from('hello world'), 'subsequent reads remain functional')
          unmount(fuse, function () {
            t.end()
          })
        })
      })
    })
  })
})
