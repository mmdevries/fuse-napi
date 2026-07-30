const os = require('os')
const fs = require('fs')
const path = require('path')
const tape = require('tape')
const { spawn, exec } = require('child_process')

const createMountpoint = require('./fixtures/mnt')

const Fuse = require('../')
const { unmount } = require('./helpers')
const simpleFS = require('./fixtures/simple-fs')

const mnt = createMountpoint()
const BROKEN_MOUNT_FIXTURE_TIMEOUT = 10 * 1000

tape('mount', function (t) {
  const fuse = new Fuse(mnt, {}, { force: true })
  fuse.mount(function (err) {
    t.error(err, 'no error')
    t.ok(true, 'works')
    unmount(fuse, function () {
      t.end()
    })
  })
})

tape('mount + unmount + mount', function (t) {
  const fuse1 = new Fuse(mnt, {}, { force: true, debug: false })
  const fuse2 = new Fuse(mnt, {}, { force: true, debug: false })

  fuse1.mount(function (err) {
    t.error(err, 'no error')
    t.ok(true, 'works')
    unmount(fuse1, function () {
      fuse2.mount(function (err) {
        t.error(err, 'no error')
        t.ok(true, 'works')
        unmount(fuse2, function () {
          t.end()
        })
      })
    })
  })
})

tape('mount + unmount + mount with same instance fails', function (t) {
  const fuse = new Fuse(mnt, {}, { force: true, debug: false })

  fuse.mount(function (err) {
    t.error(err, 'no error')
    t.pass('works')
    unmount(fuse, function () {
      fuse.mount(function (err) {
        t.ok(err, 'had error')
        t.end()
      })
    })
  })
})

tape('mnt point must exist', function (t) {
  const fuse = new Fuse('.does-not-exist', {}, { debug: false })
  fuse.mount(function (err) {
    t.ok(err, 'had error')
    t.end()
  })
})

tape('mnt point must be directory', function (t) {
  const fuse = new Fuse(__filename, {}, { debug: false })
  fuse.mount(function (err) {
    t.ok(err, 'had error')
    t.end()
  })
})

tape('mounting twice without force fails', function (t) {
  const fuse1 = new Fuse(mnt, {}, { force: true, debug: false })
  const fuse2 = new Fuse(mnt, {}, { force: false, debug: false })

  fuse1.mount(function (err) {
    t.error(err, 'no error')
    t.pass('works')
    fuse2.mount(function (err) {
      t.true(err, 'cannot mount over existing mountpoint')
      unmount(fuse1, function () {
        t.end()
      })
    })
  })
})

tape('mounting twice with force fail if mountpoint is not broken', function (t) {
  const fuse1 = new Fuse(mnt, {}, { force: true, debug: false })
  const fuse2 = new Fuse(mnt, {}, { force: true, debug: false })

  fuse1.mount(function (err) {
    t.error(err, 'no error')
    t.pass('works')
    fuse2.mount(function (err) {
      t.true(err, 'cannot mount over existing mountpoint')
      unmount(fuse1, function () {
        t.end()
      })
    })
  })
})

tape('mounting over a broken mountpoint with force succeeds', function (t) {
  createBrokenMountpoint(mnt, function (err) {
    t.error(err, 'broken mountpoint is observable')
    if (err) return t.end()

    const fuse = new Fuse(mnt, {}, { force: true, debug: false })
    fuse.mount(function (err) {
      t.error(err, 'no error')
      if (err) {
        return Fuse.unmount(mnt, function (cleanupErr) {
          t.error(cleanupErr, 'failed recovery leaves no stale test mount')
          t.end()
        })
      }

      t.pass('works')
      unmount(fuse, function (unmountErr) {
        t.error(unmountErr, 'recovered mount unmounts cleanly')
        t.end()
      })
    })
  })
})

tape('mounting without mkdir option and a nonexistent mountpoint fails', function (t) {
  const nonexistentMnt = createMountpoint({ doNotCreate: true })

  const fuse = new Fuse(nonexistentMnt, {}, { debug: false })
  fuse.mount(function (err) {
    t.true(err, 'could not mount')
    t.end()
  })
})

tape('mounting with mkdir option and a nonexistent mountpoint succeeds', function (t) {
  const nonexistentMnt = createMountpoint({ doNotCreate: true })

  const fuse = new Fuse(nonexistentMnt, {}, { debug: false, mkdir: true })
  fuse.mount(function (err) {
    t.error(err, 'no error')
    unmount(fuse, function (err) {
      t.end()
    })
  })
})

tape('(osx only) unmount with Finder open succeeds', function (t) {
  if (os.platform() !== 'darwin') return t.end()
  const fuse = new Fuse(mnt, simpleFS(), { force: true, debug: false })
  fuse.mount(function (err) {
    t.error(err, 'no error')
    exec(`open ${mnt}`, err => {
      t.error(err, 'no error')
      setTimeout(() => {
        fs.readdir(mnt, (err, list) => {
          t.error(err, 'no error')
          t.same(list, ['test'])
          unmount(fuse, err => {
            t.error(err, 'no error')
            fs.readdir(mnt, (err, list) => {
              t.error(err, 'no error')
              t.same(list, [])
              t.end()
            })
          })
        })
      }, 1000)
    })
  })
})

tape('(osx only) unmount with Terminal open succeeds', function (t) {
  if (os.platform() !== 'darwin') return t.end()
  const fuse = new Fuse(mnt, simpleFS(), { force: true, debug: false })
  fuse.mount(function (err) {
    t.error(err, 'no error')
    exec(`open -a Terminal ${mnt}`, err => {
      t.error(err, 'no error')
      setTimeout(() => {
        fs.readdir(mnt, (err, list) => {
          t.error(err, 'no error')
          t.same(list, ['test'])
          unmount(fuse, err => {
            t.error(err, 'no error')
            fs.readdir(mnt, (err, list) => {
              t.error(err, 'no error')
              t.same(list, [])
              t.end()
            })
          })
        })
      }, 1000)
    })
  })
})

tape('static unmounting', function (t) {
  t.end()
})

function createBrokenMountpoint (mnt, cb) {
  const child = spawn(process.execPath, ['-e', `
    const Fuse = require('..')
    const mnt = ${JSON.stringify(mnt)}
    const fuse = new Fuse(mnt, {}, { force: true, debug: false })
    fuse.mount(err => {
      if (err) {
        process.send({
          type: 'mount-error',
          code: err.code,
          message: err.message
        })
        return
      }
      process.send({
        type: 'mounted',
        pid: process.pid
      })
    })
  `], {
    cwd: __dirname,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc']
  })

  let mounted = false
  let pendingError = null
  let completed = false
  const timeout = setTimeout(function () {
    const err = new Error('Timed out waiting for the broken-mount fixture to become ready')
    err.code = 'EFUSETESTFIXTURE'
    abort(err)
  }, BROKEN_MOUNT_FIXTURE_TIMEOUT)

  child.once('error', function (err) {
    if (pendingError) return
    pendingError = err
  })

  child.on('message', function (message) {
    if (completed || pendingError) return
    if (!message || typeof message !== 'object') {
      const err = new Error('Broken-mount fixture sent an invalid readiness message')
      err.code = 'EFUSETESTFIXTURE'
      return abort(err)
    }
    if (message.type === 'mount-error') {
      const err = new Error(message.message || 'Broken-mount fixture failed to mount')
      err.code = message.code || 'EFUSETESTFIXTURE'
      return abort(err)
    }
    if (message.type !== 'mounted' || message.pid !== child.pid || mounted) {
      const err = new Error('Broken-mount fixture sent an unexpected readiness message')
      err.code = 'EFUSETESTFIXTURE'
      return abort(err)
    }

    mounted = true
    if (!child.kill('SIGKILL')) {
      const err = new Error('Failed to terminate the mounted FUSE fixture')
      err.code = 'EFUSETESTFIXTURE'
      return abort(err)
    }
  })

  child.once('close', function (code, signal) {
    clearTimeout(timeout)
    if (completed) return
    completed = true

    if (pendingError) return cb(pendingError)
    if (!mounted) {
      const err = new Error(`Broken-mount fixture exited before readiness with status ${code}`)
      err.code = 'EFUSETESTFIXTURE'
      return cb(err)
    }
    if (signal !== 'SIGKILL') {
      const err = new Error(`Broken-mount fixture exited with unexpected signal ${signal || 'none'}`)
      err.code = 'EFUSETESTFIXTURE'
      return cb(err)
    }

    waitForDisconnectedMount(mnt, cb)
  })

  function abort (err) {
    if (completed || pendingError) return
    pendingError = err
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      return
    }
    clearTimeout(timeout)
    completed = true
    process.nextTick(cb, err)
  }
}

function waitForDisconnectedMount (mnt, cb) {
  const deadline = Date.now() + 5000
  const sentinel = path.join(mnt, 'test')
  const parent = path.join(mnt, '..')

  probe()

  function probe () {
    fs.stat(sentinel, function (probeErr) {
      if (isDisconnected(probeErr)) return cb(null)

      fs.stat(mnt, function (mountErr, mountStat) {
        if (isDisconnected(mountErr)) return cb(null)
        if (mountErr) return retry(mountErr)

        fs.stat(parent, function (parentErr, parentStat) {
          if (parentErr) return retry(parentErr)
          if (mountStat.dev === parentStat.dev) {
            const err = new Error('Crashed FUSE fixture detached instead of becoming disconnected')
            err.code = 'EFUSETESTNOTBROKEN'
            return cb(err)
          }
          return retry(probeErr)
        })
      })
    })
  }

  function retry (cause) {
    if (Date.now() < deadline) return setTimeout(probe, 10)

    const err = new Error('Timed out waiting for the crashed FUSE mount to disconnect')
    err.code = 'ETIMEDOUT'
    if (cause) err.cause = cause
    Fuse.unmount(mnt, function (cleanupErr) {
      if (cleanupErr) err.cleanupError = cleanupErr
      cb(err)
    })
  }
}

function isDisconnected (err) {
  return !!err && (
    err.code === 'ENOTCONN' ||
    err.code === 'ENXIO' ||
    err.errno === Fuse.ENOTCONN ||
    err.errno === Fuse.ENXIO
  )
}
