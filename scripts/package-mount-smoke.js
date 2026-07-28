'use strict'

const assert = require('assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const packageRoot = path.resolve(process.argv[2] || path.join(__dirname, '..'))
const Fuse = require(packageRoot)
const mountpoint = fs.mkdtempSync(path.join(os.tmpdir(), 'fuse-napi-package-smoke-'))
const longTarget = 'target/'.repeat(10000)
const now = new Date()

const fuse = new Fuse(mountpoint, {
  getattr (name, cb) {
    if (name === '/') return process.nextTick(cb, 0, stat(0o40755, 4096))
    if (name === '/long-link') return process.nextTick(cb, 0, stat(0o120755, longTarget.length))
    return process.nextTick(cb, Fuse.ENOENT)
  },
  readlink (name, cb) {
    if (name !== '/long-link') return process.nextTick(cb, Fuse.ENOENT)
    process.nextTick(cb, 0, longTarget)
  }
}, {
  force: true,
  timeout: 15000
})

run().catch(err => {
  console.error(err.stack || err.message)
  process.exitCode = 1
})

async function run () {
  let mounted = false
  try {
    await mount(fuse)
    mounted = true

    const target = await fs.promises.readlink(path.join(mountpoint, 'long-link'))
    assert.ok(target.length > 0, 'readlink target must not be empty')
    assert.ok(target.length < longTarget.length, 'oversized readlink target must be truncated')
    assert.ok(longTarget.startsWith(target), 'truncated readlink target must preserve the original prefix')
  } finally {
    if (mounted) await unmount(fuse)
    await fs.promises.rmdir(mountpoint)
  }

  console.log(`Mounted and verified ${packageRoot}`)
}

function stat (mode, size) {
  return {
    mode,
    size,
    atime: now,
    mtime: now,
    ctime: now,
    uid: typeof process.getuid === 'function' ? process.getuid() : 0,
    gid: typeof process.getgid === 'function' ? process.getgid() : 0
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
