const os = require('os')
const tape = require('tape')
const Fuse = require('../')

tape('errno constants use host platform values', function (t) {
  const names = [
    'EPERM',
    'ENOENT',
    'EAGAIN',
    'ENOSYS',
    'ENOTSUP',
    'EOPNOTSUPP',
    'ENOTCONN',
    'ETIMEDOUT'
  ]

  for (const name of names) {
    t.equal(Fuse[name], -os.constants.errno[name], `${name} matches the host`)
  }

  const fuse = new Fuse('/tmp/fuse-napi-errno', {})
  t.equal(fuse.errno('enosys'), -os.constants.errno.ENOSYS, 'errno() uses the host value')
  t.equal(fuse.errno('unknown'), -1, 'errno() preserves its unknown-code fallback')
  t.end()
})
