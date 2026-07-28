const tape = require('tape')
const Fuse = require('../')

tape('mount options serialize as single libfuse values', function (t) {
  const fuse = new Fuse('/tmp/fuse-napi-options', {}, {
    userId: 501,
    fsname: 'fuse-napi-test'
  })

  t.equal(
    fuse._fuseOptions(),
    '-ouser_id=501,fsname=fuse-napi-test',
    'user_id is not split into a second mount option'
  )
  t.end()
})

tape('zero-valued numeric mount options are preserved', function (t) {
  const fuse = new Fuse('/tmp/fuse-napi-zero-options', {}, {
    blksize: 0,
    maxRead: 0,
    fd: 0,
    userId: 0,
    umask: 0,
    uid: 0,
    gid: 0,
    entryTimeout: 0,
    attrTimeout: 0,
    acAttrTimeout: 0,
    remember: 0
  })

  t.deepEqual(
    fuse._fuseOptions().slice(2).split(','),
    [
      'blksize=0',
      'max_read=0',
      'fd=0',
      'user_id=0',
      'umask=0',
      'uid=0',
      'gid=0',
      'entry_timeout=0',
      'attr_timeout=0',
      'ac_attr_timeout=0',
      'remember=0'
    ],
    'explicit zeroes reach libfuse'
  )
  t.end()
})
