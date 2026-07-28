const path = require('path').posix

const Fuse = require('../..')
const stat = require('./stat')

module.exports = function memoryFS () {
  const nodes = new Map()
  const handles = new Map()
  let nextFd = 1

  nodes.set('/', directory())

  const ops = {
    getattr (name, cb) {
      const node = nodes.get(name)
      if (!node) return process.nextTick(cb, Fuse.ENOENT)
      process.nextTick(cb, 0, metadata(node))
    },

    fgetattr (name, fd, cb) {
      const node = handles.get(fd) || nodes.get(name)
      if (!node) return process.nextTick(cb, Fuse.ENOENT)
      process.nextTick(cb, 0, metadata(node))
    },

    readdir (name, cb) {
      const node = nodes.get(name)
      if (!node) return process.nextTick(cb, Fuse.ENOENT)
      if (node.type !== 'dir') return process.nextTick(cb, Fuse.ENOTDIR)

      const prefix = name === '/' ? '/' : name + '/'
      const entries = []
      for (const candidate of nodes.keys()) {
        if (!candidate.startsWith(prefix)) continue
        const entry = candidate.slice(prefix.length)
        if (entry && !entry.includes('/')) entries.push(entry)
      }
      process.nextTick(cb, 0, entries)
    },

    mkdir (name, mode, cb) {
      if (nodes.has(name)) return process.nextTick(cb, Fuse.EEXIST)
      if (!isDirectory(path.dirname(name))) return process.nextTick(cb, Fuse.ENOENT)
      nodes.set(name, directory(mode))
      process.nextTick(cb, 0)
    },

    create (name, mode, cb) {
      if (nodes.has(name)) return process.nextTick(cb, Fuse.EEXIST)
      if (!isDirectory(path.dirname(name))) return process.nextTick(cb, Fuse.ENOENT)
      const node = file(mode)
      const fd = nextFd++
      nodes.set(name, node)
      handles.set(fd, node)
      process.nextTick(cb, 0, fd)
    },

    open (name, flags, cb) {
      const node = nodes.get(name)
      if (!node) return process.nextTick(cb, Fuse.ENOENT)
      const fd = nextFd++
      handles.set(fd, node)
      process.nextTick(cb, 0, fd)
    },

    release (name, fd, cb) {
      handles.delete(fd)
      process.nextTick(cb, 0)
    },

    read (name, fd, buffer, length, position, cb) {
      const node = handles.get(fd) || nodes.get(name)
      if (!node) return process.nextTick(cb, Fuse.ENOENT)
      const bytes = Math.max(0, Math.min(length, node.data.length - position))
      node.data.copy(buffer, 0, position, position + bytes)
      node.atime = new Date()
      process.nextTick(cb, bytes)
    },

    write (name, fd, buffer, length, position, cb) {
      const node = handles.get(fd) || nodes.get(name)
      if (!node) return process.nextTick(cb, Fuse.ENOENT)
      const size = Math.max(node.data.length, position + length)
      const data = Buffer.alloc(size)
      node.data.copy(data)
      buffer.copy(data, position, 0, length)
      node.data = data
      node.mtime = new Date()
      node.ctime = new Date()
      process.nextTick(cb, length)
    },

    rename (source, destination, cb) {
      const node = nodes.get(source)
      if (!node) return process.nextTick(cb, Fuse.ENOENT)
      if (!isDirectory(path.dirname(destination))) return process.nextTick(cb, Fuse.ENOENT)
      nodes.delete(source)
      nodes.set(destination, node)
      node.ctime = new Date()
      process.nextTick(cb, 0)
    },

    unlink (name, cb) {
      const node = nodes.get(name)
      if (!node) return process.nextTick(cb, Fuse.ENOENT)
      if (node.type === 'dir') return process.nextTick(cb, Fuse.EISDIR)
      nodes.delete(name)
      process.nextTick(cb, 0)
    },

    chmod (name, mode, cb) {
      const node = nodes.get(name)
      if (!node) return process.nextTick(cb, Fuse.ENOENT)
      node.mode = mode & 0o7777
      node.ctime = new Date()
      process.nextTick(cb, 0)
    },

    chown (name, uid, gid, cb) {
      const node = nodes.get(name)
      if (!node) return process.nextTick(cb, Fuse.ENOENT)
      if (uid !== 0xffffffff) node.uid = uid
      if (gid !== 0xffffffff) node.gid = gid
      node.ctime = new Date()
      process.nextTick(cb, 0)
    },

    utimens (name, atime, mtime, cb) {
      const node = nodes.get(name)
      if (!node) return process.nextTick(cb, Fuse.ENOENT)
      node.atime = new Date(atime)
      node.mtime = new Date(mtime)
      node.ctime = new Date()
      process.nextTick(cb, 0)
    },

    setxattr (name, attribute, value, position, flags, cb) {
      const node = nodes.get(name)
      if (!node) return process.nextTick(cb, Fuse.ENOENT)

      if (position) {
        const current = node.xattrs.get(attribute) || Buffer.alloc(0)
        const next = Buffer.alloc(Math.max(current.length, position + value.length))
        current.copy(next)
        value.copy(next, position)
        node.xattrs.set(attribute, next)
      } else {
        node.xattrs.set(attribute, Buffer.from(value))
      }
      node.ctime = new Date()
      process.nextTick(cb, 0)
    },

    getxattr (name, attribute, position, cb) {
      const node = nodes.get(name)
      if (!node) return process.nextTick(cb, Fuse.ENOENT)
      const value = node.xattrs.get(attribute)
      process.nextTick(cb, 0, value ? value.subarray(position) : null)
    },

    listxattr (name, cb) {
      const node = nodes.get(name)
      if (!node) return process.nextTick(cb, Fuse.ENOENT)
      process.nextTick(cb, 0, [...node.xattrs.keys()])
    },

    removexattr (name, attribute, cb) {
      const node = nodes.get(name)
      if (!node) return process.nextTick(cb, Fuse.ENOENT)
      node.xattrs.delete(attribute)
      node.ctime = new Date()
      process.nextTick(cb, 0)
    }
  }

  return ops

  function isDirectory (name) {
    const node = nodes.get(name)
    return node && node.type === 'dir'
  }
}

function directory (mode) {
  const now = new Date()
  return {
    type: 'dir',
    mode: mode ? mode & 0o7777 : 0o755,
    uid: process.getuid(),
    gid: process.getgid(),
    atime: now,
    mtime: now,
    ctime: now,
    xattrs: new Map()
  }
}

function file (mode) {
  const now = new Date()
  return {
    type: 'file',
    mode: mode ? mode & 0o7777 : 0o644,
    uid: process.getuid(),
    gid: process.getgid(),
    data: Buffer.alloc(0),
    atime: now,
    mtime: now,
    ctime: now,
    xattrs: new Map()
  }
}

function metadata (node) {
  return stat({
    mode: (node.type === 'dir' ? 0o040000 : 0o100000) | node.mode,
    size: node.type === 'file' ? node.data.length : 4096,
    uid: node.uid,
    gid: node.gid,
    atime: node.atime,
    mtime: node.mtime,
    ctime: node.ctime
  })
}
