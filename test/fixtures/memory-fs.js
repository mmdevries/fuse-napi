const path = require('path').posix

const Fuse = require('../..')
const stat = require('./stat')

module.exports = function memoryFS () {
  const nodes = new Map()
  let nextFd = 1

  nodes.set('/', directory())

  return {
    getattr (name, cb) {
      const node = nodes.get(name)
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
      nodes.set(name, file(mode))
      process.nextTick(cb, 0, nextFd++)
    },

    open (name, flags, cb) {
      if (!nodes.has(name)) return process.nextTick(cb, Fuse.ENOENT)
      process.nextTick(cb, 0, nextFd++)
    },

    release (name, fd, cb) {
      process.nextTick(cb, 0)
    },

    read (name, fd, buffer, length, position, cb) {
      const node = nodes.get(name)
      if (!node) return process.nextTick(cb, Fuse.ENOENT)
      const bytes = Math.max(0, Math.min(length, node.data.length - position))
      node.data.copy(buffer, 0, position, position + bytes)
      process.nextTick(cb, bytes)
    },

    write (name, fd, buffer, length, position, cb) {
      const node = nodes.get(name)
      if (!node) return process.nextTick(cb, Fuse.ENOENT)
      const size = Math.max(node.data.length, position + length)
      const data = Buffer.alloc(size)
      node.data.copy(data)
      buffer.copy(data, position, 0, length)
      node.data = data
      node.mtime = new Date()
      process.nextTick(cb, length)
    },

    rename (source, destination, cb) {
      const node = nodes.get(source)
      if (!node) return process.nextTick(cb, Fuse.ENOENT)
      if (!isDirectory(path.dirname(destination))) return process.nextTick(cb, Fuse.ENOENT)
      nodes.delete(source)
      nodes.set(destination, node)
      process.nextTick(cb, 0)
    },

    unlink (name, cb) {
      const node = nodes.get(name)
      if (!node) return process.nextTick(cb, Fuse.ENOENT)
      if (node.type === 'dir') return process.nextTick(cb, Fuse.EISDIR)
      nodes.delete(name)
      process.nextTick(cb, 0)
    }
  }

  function isDirectory (name) {
    const node = nodes.get(name)
    return node && node.type === 'dir'
  }
}

function directory (mode) {
  return {
    type: 'dir',
    mode: mode || 0o755,
    mtime: new Date()
  }
}

function file (mode) {
  return {
    type: 'file',
    mode: mode || 0o644,
    data: Buffer.alloc(0),
    mtime: new Date()
  }
}

function metadata (node) {
  return stat({
    mode: node.type,
    size: node.type === 'file' ? node.data.length : 4096,
    mtime: node.mtime
  })
}
