const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const tape = require('tape')
const { promisify } = require('util')

const Fuse = require('../')
const createMountpoint = require('./fixtures/mnt')
const memoryFS = require('./fixtures/memory-fs')

const runFile = promisify(execFile)
const MACOS_ONLY = { skip: os.platform() !== 'darwin' }

tape('macOS metadata and open-file behavior', MACOS_ONLY, function (t) {
  const mnt = createMountpoint()
  const fuse = new Fuse(mnt, memoryFS(), {
    force: true,
    defaultPermissions: true,
    attrTimeout: 0.01
  })
  let mounted = false

  run()

  async function run () {
    try {
      await mount(fuse)
      mounted = true

      const nfdName = 'cafe\u0301-\ud83c\udf4e.txt'
      const nfcName = nfdName.normalize('NFC')
      const nfdPath = path.join(mnt, nfdName)
      const nfcPath = path.join(mnt, nfcName)
      await fs.promises.writeFile(nfdPath, 'unicode')

      const unicodeEntries = withoutAppleDouble(await fs.promises.readdir(mnt))
      t.ok(
        unicodeEntries.some(entry => entry.normalize('NFC') === nfcName),
        'readdir preserves a canonically equivalent Unicode filename'
      )
      t.equal(await fs.promises.readFile(nfdPath, 'utf8'), 'unicode', 'NFD filename round-trips')
      try {
        await fs.promises.readFile(nfcPath, 'utf8')
        t.fail('macFUSE unexpectedly normalized the callback path')
      } catch (err) {
        t.equal(err.code, 'ENOENT', 'macFUSE leaves NFC/NFD equivalence to the filesystem')
      }

      const attribute = 'com.example.fuse-napi'
      await xattr(['-w', attribute, 'metadata-value', nfdPath])
      t.equal(await readXattr(attribute, nfdPath), 'metadata-value', 'extended attribute round-trips')
      const listedXattrs = (await xattr([nfdPath])).stdout.trim().split('\n')
      t.ok(listedXattrs.includes(attribute), 'extended attribute is listed')
      await xattr(['-d', attribute, nfdPath])
      t.notOk((await xattr([nfdPath])).stdout.includes(attribute), 'extended attribute is removed')

      await xattr(['-w', 'com.apple.ResourceFork', 'resource-fork-data', nfdPath])
      t.equal(
        await readXattr('com.apple.ResourceFork', nfdPath),
        'resource-fork-data',
        'resource fork round-trips through macFUSE xattrs'
      )

      await fs.promises.chmod(nfdPath, 0o640)
      await fs.promises.chown(nfdPath, process.getuid(), process.getgid())
      await waitForAttributes()
      const permissionStat = await fs.promises.stat(nfdPath)
      t.equal(permissionStat.mode & 0o777, 0o640, 'chmod updates permissions')
      t.equal(permissionStat.uid, process.getuid(), 'chown updates uid')
      t.equal(permissionStat.gid, process.getgid(), 'chown updates gid')

      const atime = new Date('2022-03-04T05:06:07.000Z')
      const mtime = new Date('2023-04-05T06:07:08.000Z')
      await fs.promises.utimes(nfdPath, atime, mtime)
      await waitForAttributes()
      const timestampStat = await fs.promises.stat(nfdPath)
      t.equal(timestampStat.atimeMs, atime.getTime(), 'stat returns atime')
      t.equal(timestampStat.mtimeMs, mtime.getTime(), 'stat returns mtime')
      t.ok(timestampStat.ctimeMs > 0, 'stat returns ctime')

      const original = path.join(mnt, 'open.txt')
      const renamed = path.join(mnt, 'renamed-open.txt')
      await fs.promises.writeFile(original, 'before')
      const handle = await fs.promises.open(original, 'r+')
      try {
        await fs.promises.rename(original, renamed)
        await handle.write(Buffer.from('after!'), 0, 6, 0)
        await fs.promises.unlink(renamed)
        try {
          await fs.promises.stat(renamed)
          t.fail('unlinked open file remained visible')
        } catch (err) {
          t.equal(err.code, 'ENOENT', 'unlinked open file is hidden')
        }

        const openBuffer = Buffer.alloc(6)
        await handle.read(openBuffer, 0, openBuffer.length, 0)
        t.equal(openBuffer.toString(), 'after!', 'open handle survives rename and unlink')
      } finally {
        await handle.close()
      }
    } catch (err) {
      t.fail(err.stack || err.message)
    } finally {
      await cleanup(t, fuse, mnt, mounted)
    }
  }
})

tape('macOS AppleDouble fallback', MACOS_ONLY, function (t) {
  const mnt = createMountpoint()
  const ops = memoryFS()
  const create = ops.create
  const sidecars = []
  let mounted = false

  delete ops.setxattr
  delete ops.getxattr
  delete ops.listxattr
  delete ops.removexattr
  ops.create = function (name, mode, cb) {
    if (path.posix.basename(name).startsWith('._')) sidecars.push(name)
    create.call(ops, name, mode, cb)
  }

  const fuse = new Fuse(mnt, ops, { force: true })
  run()

  async function run () {
    try {
      await mount(fuse)
      mounted = true
      await fs.promises.writeFile(path.join(mnt, 'appledouble.txt'), 'data')
      t.ok(
        sidecars.some(name => name.endsWith('/._appledouble.txt')),
        'macOS requests an AppleDouble sidecar when xattrs are unavailable'
      )
    } catch (err) {
      t.fail(err.stack || err.message)
    } finally {
      await cleanup(t, fuse, mnt, mounted)
    }
  }
})

function xattr (args) {
  return runFile('/usr/bin/xattr', args, { encoding: 'utf8' })
}

async function readXattr (name, filename) {
  return (await xattr(['-p', name, filename])).stdout.trimEnd()
}

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

function waitForAttributes () {
  return new Promise(resolve => setTimeout(resolve, 25))
}

function withoutAppleDouble (entries) {
  return entries.filter(entry => !entry.startsWith('._'))
}

async function cleanup (t, fuse, mnt, mounted) {
  if (mounted) {
    try {
      await unmount(fuse)
    } catch (err) {
      t.fail(err.stack || err.message)
    }
  }
  fs.rmdir(mnt, () => t.end())
}
