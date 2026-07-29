const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile, spawnSync } = require('child_process')
const tape = require('tape')

const packageRoot = process.env.FUSE_NAPI_PACKAGE_ROOT || path.resolve(__dirname, '..')
const Fuse = require(packageRoot)

tape('modern FUSE 3 syscalls cross the native boundary', function (t) {
  if (process.platform !== 'linux') {
    t.pass('Linux-specific FUSE 3 syscall integration')
    return t.end()
  }

  const helper = path.join(os.tmpdir(), `fuse-napi-modern-${process.pid}`)
  const source = path.join(__dirname, 'fixtures', 'fuse3-modern-syscalls.c')
  const compile = spawnSync('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', source, '-o', helper], {
    encoding: 'utf8'
  })
  if (compile.status !== 0) {
    t.fail(`could not compile syscall fixture: ${compile.stderr || compile.stdout}`)
    return t.end()
  }

  const mountpoint = path.join(os.tmpdir(), `fuse-napi-modern-mount-${process.pid}`)
  fs.mkdirSync(mountpoint, { recursive: true })
  let renamed = false
  let copyCalls = 0
  let seekCalls = 0
  let pollCalls = 0
  let pollNotifications = 0
  let renameFlags = null
  const openPaths = new Set(['/source', '/destination'])

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
      copyCalls++
      t.equal(sourcePath, '/source', 'copy_file_range forwards the source path')
      t.equal(destinationPath, '/destination', 'copy_file_range forwards the destination path')
      t.equal(sourceOffset, 0, 'copy_file_range forwards the source offset')
      t.equal(destinationOffset, 0, 'copy_file_range forwards the destination offset')
      t.equal(length, 5, 'copy_file_range forwards the length')
      t.equal(flags, 0, 'copy_file_range forwards the flags')
      cb(5)
    },
    lseek (name, fd, offset, whence, cb) {
      seekCalls++
      t.equal(name, '/source', 'lseek forwards the path')
      t.equal(offset, 0, 'lseek forwards the offset')
      t.equal(whence, 3, 'lseek forwards SEEK_DATA')
      cb(0, 7)
    },
    pollWithHandle (name, fd, handle, cb) {
      pollCalls++
      if (pollCalls === 1 && handle) {
        cb(0, 0)
        setTimeout(() => {
          if (handle.notify()) pollNotifications++
          handle.close()
        }, 25)
        return
      }
      if (handle) handle.close()
      // Closing before callback completion covers the native shared-ownership
      // race between an in-flight poll request and explicit JavaScript close.
      cb(0, 1)
    },
    renameWithFlags (sourcePath, destinationPath, flags, cb) {
      renameFlags = flags
      renamed = true
      openPaths.delete('/source')
      t.equal(sourcePath, '/source', 'renameat2 forwards the source path')
      t.equal(destinationPath, '/renamed', 'renameat2 forwards the destination path')
      cb(0)
    }
  }, {
    force: true,
    timeout: 5000
  })

  fuse.mount(function (mountError) {
    if (mountError) return finish(mountError)
    execFile(helper, [mountpoint], {
      encoding: 'utf8',
      timeout: 10000,
      killSignal: 'SIGKILL'
    }, (operationError, stdout, stderr) => {
      if (operationError) {
        operationError.message += `: ${stderr || stdout || 'no fixture diagnostics'}`
      }
      fuse.unmount(unmountError => finish(operationError || unmountError))
    })
  })

  function finish (error) {
    fs.rmSync(helper, { force: true })
    fs.rmSync(mountpoint, { recursive: true, force: true })
    t.error(error, 'modern syscalls complete successfully')
    t.equal(copyCalls, 1, 'copy_file_range reaches JavaScript once')
    t.equal(seekCalls, 1, 'lseek reaches JavaScript once')
    t.ok(pollCalls >= 2, 'poll is re-evaluated after notification')
    t.equal(pollNotifications, 1, 'delayed poll notifies the kernel once')
    t.equal(renameFlags, 1, 'RENAME_NOREPLACE reaches JavaScript')
    t.end()
  }
})
