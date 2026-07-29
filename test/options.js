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

tape('native libfuse option names are normalized aliases', function (t) {
  const cases = [
    ['allow_other', 'allowOther', true, '-oallow_other'],
    ['allow_root', 'allowRoot', true, '-oallow_root'],
    ['auto_unmount', 'autoUnmount', true, '-oauto_unmount'],
    ['default_permissions', 'defaultPermissions', true, '-odefault_permissions'],
    ['max_read', 'maxRead', 4096, '-omax_read=4096'],
    ['user_id', 'userId', 501, '-ouser_id=501'],
    ['kernel_cache', 'kernelCache', true, '-okernel_cache'],
    ['auto_cache', 'autoCache', true, '-oauto_cache'],
    ['entry_timeout', 'entryTimeout', 1.5, '-oentry_timeout=1.5'],
    ['attr_timeout', 'attrTimeout', 2.5, '-oattr_timeout=2.5'],
    ['ac_attr_timeout', 'acAttrTimeout', 3.5, '-oac_attr_timeout=3.5'],
    ['nonempty', 'nonEmpty', true, ''],
    ['direct_io', 'directIo', true, ''],
    ['nopath', 'noPath', true, '']
  ]

  for (const [alias, canonical, value, serialized] of cases) {
    const fuse = new Fuse(`/tmp/fuse-napi-option-alias-${alias}`, {}, {
      [alias]: value
    })

    t.equal(fuse.opts[canonical], value, `${alias} is normalized to ${canonical}`)
    t.notOk(
      Object.prototype.hasOwnProperty.call(fuse.opts, alias),
      `${alias} is removed from normalized options`
    )
    t.equal(fuse._fuseOptions(), serialized, `${alias} has canonical behavior`)
  }
  t.end()
})

tape('option aliases reject ambiguity without weakening validation', function (t) {
  t.doesNotThrow(
    () => new Fuse('/tmp/fuse-napi-matching-option-aliases', {}, {
      nonEmpty: true,
      nonempty: true
    }),
    'matching canonical and native names are accepted'
  )
  t.throws(
    () => new Fuse('/tmp/fuse-napi-conflicting-option-aliases', {}, {
      nonEmpty: false,
      nonempty: true
    }),
    /"nonEmpty".*"nonempty".*must not conflict/,
    'conflicting canonical and native names are rejected'
  )
  t.throws(
    () => new Fuse('/tmp/fuse-napi-invalid-option-alias', {}, {
      nonempty: 'yes'
    }),
    /nonEmpty must be a boolean/,
    'aliases receive canonical type validation'
  )
  t.throws(
    () => new Fuse('/tmp/fuse-napi-unknown-option-alias', {}, {
      allow_others: true
    }),
    /Unknown FUSE option/,
    'unrecognized spellings remain rejected'
  )
  t.end()
})

tape('mixed application mount configuration remains compatible', function (t) {
  const fuse = new Fuse('/tmp/fuse-napi-mixed-option-names', {}, {
    force: true,
    allowOther: true,
    mkdir: true,
    nonempty: true,
    directIo: true
  })

  t.deepEqual(
    fuse._fuseOptions().slice(2).split(','),
    ['allow_other'],
    'canonical and native names compose without duplicate mount options'
  )
  t.end()
})
