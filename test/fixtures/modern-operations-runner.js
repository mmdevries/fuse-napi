'use strict'

const assert = require('assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile, spawnSync } = require('child_process')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)
const syscallFixture = path.join(__dirname, 'fuse3-modern-syscalls.c')

module.exports = runModernOperations

async function runModernOperations (packageRoot) {
  assert.equal(process.platform, 'linux', 'modern FUSE syscall smoke requires Linux')
  assert.equal(typeof packageRoot, 'string', 'package root must be a string')
  assert.ok(packageRoot.length > 0, 'package root must not be empty')

  const resolvedPackageRoot = path.resolve(packageRoot)
  const packageMetadata = require(path.join(resolvedPackageRoot, 'package.json'))
  assert.equal(packageMetadata.name, 'fuse-napi', 'package root must contain fuse-napi')

  const Fuse = require(resolvedPackageRoot)
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'fuse-napi-modern-'))
  const helper = path.join(workspace, 'modern-syscalls')
  const mountpoint = path.join(workspace, 'mount')
  const observations = {
    copyFileRange: [],
    lseek: [],
    pollCalls: 0,
    pollNotifications: 0,
    rename: []
  }
  let asynchronousError = null
  let pendingPollNotification = Promise.resolve()
  let primaryError = null
  let mounted = false

  fs.mkdirSync(mountpoint)

  const openPaths = new Set(['/source', '/destination'])
  let renamed = false
  const fuse = new Fuse(mountpoint, {
    getattr (name, cb) {
      if (name === '/') {
        return cb(0, {
          mode: 0o40755,
          size: 0,
          uid: process.getuid(),
          gid: process.getgid()
        })
      }
      if (openPaths.has(name) || (renamed && name === '/renamed')) {
        return cb(0, {
          mode: 0o100644,
          size: 32,
          uid: process.getuid(),
          gid: process.getgid()
        })
      }
      cb(Fuse.ENOENT)
    },
    open (name, flags, cb) {
      cb(openPaths.has(name) ? 0 : Fuse.ENOENT, 100 + openPaths.size)
    },
    release (name, fd, cb) {
      cb(0)
    },
    copyFileRange (
      sourcePath,
      sourceFd,
      sourceOffset,
      destinationPath,
      destinationFd,
      destinationOffset,
      length,
      flags,
      cb
    ) {
      observations.copyFileRange.push({
        sourcePath,
        sourceOffset,
        destinationPath,
        destinationOffset,
        length,
        flags
      })
      cb(5)
    },
    lseek (name, fd, offset, whence, cb) {
      observations.lseek.push({ name, offset, whence })
      cb(0, 7)
    },
    pollWithHandle (name, fd, handle, cb) {
      observations.pollCalls++
      if (observations.pollCalls === 1 && handle) {
        cb(0, 0)
        pendingPollNotification = new Promise(resolve => {
          setTimeout(function () {
            try {
              if (handle.notify()) observations.pollNotifications++
            } catch (err) {
              asynchronousError = asynchronousError || err
            }
            try {
              handle.close()
            } catch (err) {
              asynchronousError = asynchronousError || err
            }
            resolve()
          }, 25)
        })
        return
      }
      if (handle) {
        try {
          handle.close()
        } catch (err) {
          asynchronousError = asynchronousError || err
        }
      }
      // Closing before callback completion covers the native shared-ownership
      // race between an in-flight poll request and explicit JavaScript close.
      cb(0, 1)
    },
    renameWithFlags (sourcePath, destinationPath, flags, cb) {
      observations.rename.push({ sourcePath, destinationPath, flags })
      renamed = true
      openPaths.delete('/source')
      cb(0)
    }
  }, {
    force: true,
    timeout: 5000
  })

  try {
    compileHelper(helper)
    await mount(fuse)
    mounted = true
    await exerciseHelper(helper, mountpoint)
  } catch (err) {
    primaryError = err
  }

  await pendingPollNotification

  if (mounted) {
    try {
      await unmount(fuse)
    } catch (err) {
      primaryError = combineErrors(primaryError, err, 'failed to unmount modern syscall fixture')
    }
  }

  try {
    fs.rmSync(workspace, { recursive: true, force: true })
  } catch (err) {
    primaryError = combineErrors(primaryError, err, 'failed to remove modern syscall fixture')
  }

  if (asynchronousError) {
    primaryError = combineErrors(
      primaryError,
      asynchronousError,
      'poll notification failed asynchronously'
    )
  }
  if (primaryError) throw primaryError

  assert.deepEqual(observations.copyFileRange, [{
    sourcePath: '/source',
    sourceOffset: 0,
    destinationPath: '/destination',
    destinationOffset: 0,
    length: 5,
    flags: 0
  }], 'copy_file_range arguments must cross the native boundary exactly once')
  assert.deepEqual(observations.lseek, [{
    name: '/source',
    offset: 0,
    whence: 3
  }], 'lseek arguments must cross the native boundary exactly once')
  assert.ok(
    observations.pollCalls >= 2,
    'poll must be re-evaluated after notification'
  )
  assert.equal(
    observations.pollNotifications,
    1,
    'delayed poll must notify the kernel exactly once'
  )
  assert.deepEqual(observations.rename, [{
    sourcePath: '/source',
    destinationPath: '/renamed',
    flags: 1
  }], 'renameat2 arguments must cross the native boundary exactly once')
}

function compileHelper (output) {
  const result = spawnSync(
    'cc',
    ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', syscallFixture, '-o', output],
    { encoding: 'utf8' }
  )

  if (result.error) {
    throw new Error('Could not start the C compiler for the syscall fixture', {
      cause: result.error
    })
  }
  if (result.status !== 0) {
    const diagnostics = result.stderr || result.stdout || `terminated by ${result.signal || 'unknown'}`
    throw new Error(`Could not compile the syscall fixture: ${diagnostics.trim()}`)
  }
}

async function exerciseHelper (helper, mountpoint) {
  try {
    await execFileAsync(helper, [mountpoint], {
      encoding: 'utf8',
      timeout: 10000,
      killSignal: 'SIGKILL'
    })
  } catch (err) {
    const diagnostics = err.stderr || err.stdout || 'no fixture diagnostics'
    err.message += `: ${String(diagnostics).trim()}`
    throw err
  }
}

function mount (instance) {
  return new Promise((resolve, reject) => {
    instance.mount(err => err ? reject(err) : resolve())
  })
}

function unmount (instance) {
  return new Promise((resolve, reject) => {
    instance.unmount(err => err ? reject(err) : resolve())
  })
}

function combineErrors (primaryError, secondaryError, context) {
  const contextualError = new Error(`${context}: ${secondaryError.message}`, {
    cause: secondaryError
  })
  if (!primaryError) return contextualError
  return new AggregateError(
    [primaryError, contextualError],
    `${primaryError.message}; ${context}`
  )
}
