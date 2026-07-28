const os = require('os')
const tape = require('tape')
const Fuse = require('../')

tape('errno constants use host platform values', function (t) {
  for (const name of Object.keys(os.constants.errno)) {
    t.equal(Fuse[name], -os.constants.errno[name], `${name} matches the host`)
  }

  const fuse = new Fuse('/tmp/fuse-napi-errno', {})
  t.equal(fuse.errno('enosys'), -os.constants.errno.ENOSYS, 'errno() uses the host value')
  t.equal(fuse.errno('ecanceled'), -os.constants.errno.ECANCELED, 'errno() exposes host constants absent from the legacy table')
  t.equal(fuse.errno('unknown'), -1, 'errno() preserves its unknown-code fallback')
  t.end()
})
