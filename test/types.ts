import Fuse = require('../')

const mountpoint = '/tmp/fuse-napi-types'

new Fuse(mountpoint, {
  init (cb) {
    cb(0)
  },
  readdir (path, cb) {
    void path
    cb(0, [])
  },
  create (path, mode, cb) {
    void path
    void mode
    cb(0, 1n)
  }
})

new Fuse(mountpoint, {
  initWithConfig (connection, cb) {
    cb(0, {
      maxWrite: connection.maxWrite,
      want: connection.capable
    })
  },
  readdirPaged (path, fd, offset, cb) {
    void path
    void fd
    void offset
    cb(0, ['entry'], [], [1n])
  },
  createWithFlags (path, mode, flags, cb) {
    void path
    void mode
    void flags
    cb(0, {
      fd: 1n,
      directIO: true,
      keepCache: false,
      nonseekable: false
    })
  }
})

// @ts-expect-error init and initWithConfig are mutually exclusive
const invalidInit: Fuse.OPERATIONS = {
  init (cb) {
    cb(0)
  },
  initWithConfig (connection, cb) {
    void connection
    cb(0)
  }
}

// @ts-expect-error readdir and readdirPaged are mutually exclusive
const invalidReaddir: Fuse.OPERATIONS = {
  readdir (path, cb) {
    void path
    cb(0, [])
  },
  readdirPaged (path, fd, offset, cb) {
    void path
    void fd
    void offset
    cb(0, [], [], [])
  }
}

// @ts-expect-error create and createWithFlags are mutually exclusive
const invalidCreate: Fuse.OPERATIONS = {
  create (path, mode, cb) {
    void path
    void mode
    cb(0, 1)
  },
  createWithFlags (path, mode, flags, cb) {
    void path
    void mode
    void flags
    cb(0, 1)
  }
}

void invalidInit
void invalidReaddir
void invalidCreate
