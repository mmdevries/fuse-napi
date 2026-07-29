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
      want: connection.capable,
      asyncRead: false
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
  },
  utimensWithTimespec (path, atime, mtime, cb) {
    void path
    const seconds: Fuse.Int64 = atime.seconds
    const nanoseconds: number = mtime.nanoseconds
    void seconds
    void nanoseconds
    cb(0)
  },
  readBuffer (path, fd, length, position, cb) {
    void path
    void fd
    void length
    void position
    cb(0, Buffer.from('data'))
  },
  ioctl (path, fd, command, argument, flags, data, cb) {
    void path
    void fd
    void command
    void argument
    void flags
    cb(0, data)
  },
  lock (path, fd, command, lock, cb) {
    void path
    void fd
    void command
    cb(0, { ...lock, pid: 0 })
  }
}, {
  maxConcurrency: 4,
  nullPathOk: true,
  timeout: { default: 1000, readBuffer: 2000 }
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

// @ts-expect-error read and readBuffer are mutually exclusive
const invalidRead: Fuse.OPERATIONS = {
  read (path, fd, buffer, length, position, cb) {
    cb(0)
  },
  readBuffer (path, fd, length, position, cb) {
    cb(0, Buffer.alloc(0))
  }
}

// @ts-expect-error utimens variants are mutually exclusive
const invalidUtimens: Fuse.OPERATIONS = {
  utimens (path, atime, mtime, cb) {
    cb(0)
  },
  utimensWithTimespec (path, atime, mtime, cb) {
    cb(0)
  }
}

const instance = new Fuse(mountpoint)
const context: Readonly<Fuse.RequestContext> | null = instance.context()
const now: number = Fuse.UTIME_NOW
void context
void now

void invalidInit
void invalidReaddir
void invalidCreate
void invalidRead
void invalidUtimens
