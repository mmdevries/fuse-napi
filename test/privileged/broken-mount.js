const fs = require('fs')
const path = require('path')
const tape = require('tape')
const { spawn } = require('child_process')

const createMountpoint = require('../fixtures/mnt')
const { unmount } = require('../helpers')
const Fuse = require('../..')

const BROKEN_MOUNT_FIXTURE_TIMEOUT = 10 * 1000
const BROKEN_MOUNT_FIXTURE_ATTEMPTS = 5
const mnt = createMountpoint()
const isPrivileged = typeof process.geteuid === 'function' && process.geteuid() === 0

tape('privileged crashed-mount recovery preflight', function (t) {
  if (!isPrivileged) {
    t.fail(
      'This suite requires effective uid 0 for deterministic crashed-mount cleanup; ' +
      'run "sudo env \\"PATH=$PATH\\" npm run test:privileged-recovery"'
    )
    return t.end()
  }

  t.pass('effective uid 0 is available')
  t.end()
})

if (isPrivileged) {
  tape('mounting over a broken mountpoint with force succeeds', function (t) {
    createBrokenMountpoint(mnt, function (err) {
      t.error(err, 'broken mountpoint is observable')
      if (err) return t.end()

      const fuse = new Fuse(mnt, {}, { force: true, debug: false })
      fuse.mount(function (err) {
        t.error(err, 'forced recovery succeeds')
        if (err) {
          return Fuse.unmount(mnt, function (cleanupErr) {
            t.error(cleanupErr, 'failed recovery leaves no stale test mount')
            t.end()
          })
        }

        t.pass('replacement filesystem is mounted')
        unmount(fuse, function (unmountErr) {
          t.error(unmountErr, 'recovered mount unmounts cleanly')
          t.end()
        })
      })
    })
  })
}

function createBrokenMountpoint (mnt, cb, attempt = 1) {
  const child = spawn(process.execPath, ['-e', `
    const Fuse = require('../..')
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

    waitForDisconnectedMount(mnt, function (err) {
      if (
        err &&
        err.code === 'EFUSETESTNOTBROKEN' &&
        attempt < BROKEN_MOUNT_FIXTURE_ATTEMPTS
      ) {
        return setTimeout(
          createBrokenMountpoint,
          10,
          mnt,
          cb,
          attempt + 1
        )
      }
      if (err && err.code === 'EFUSETESTNOTBROKEN') err.attempts = attempt
      cb(err)
    })
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
