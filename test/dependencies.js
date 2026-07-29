const tape = require('tape')

const { wrapMacFuseLoadError } = require('../lib/macfuse')
const { discover } = require('../scripts/fuse-config')

tape('Linux dependency error is actionable', function (t) {
  t.throws(
    () => discover('linux', () => null, () => false),
    /sudo apt-get install libfuse3-dev fuse3 pkg-config/
  )
  t.end()
})

tape('libfuse3 below the supported minimum is rejected', function (t) {
  t.throws(
    () => discover('linux', () => '3.10.2', () => false),
    /requires libfuse >=3\.10\.3/
  )
  t.end()
})

tape('minimum supported libfuse3 version is discovered', function (t) {
  const config = discover('linux', args => {
    if (args[0] === '--modversion') return '3.10.3'
    if (args[0] === '--cflags-only-I') return '-I/usr/include/fuse3'
    if (args[0] === '--libs') return '-lfuse3 -lpthread'
    return null
  })

  t.same(config.includeDirs, ['/usr/include/fuse3'])
  t.same(config.libraries, ['-lfuse3', '-lpthread'])
  t.end()
})

tape('macOS dependency error is actionable', function (t) {
  t.throws(
    () => discover('darwin', () => null, () => false),
    /https:\/\/macfuse\.github\.io\//
  )
  t.end()
})

tape('macOS fallback discovers the macFUSE libfuse3 library', function (t) {
  const existing = new Set([
    '/usr/local/include/fuse3/fuse.h',
    '/usr/local/lib/libfuse3.4.dylib'
  ])
  const config = discover('darwin', () => null, name => existing.has(name))

  t.same(config.includeDirs, ['/usr/local/include/fuse3'])
  t.same(config.libraries, ['-L/usr/local/lib', '-lfuse3', '-pthread'])
  t.end()
})

tape('macFUSE dynamic loader error is actionable', function (t) {
  const cause = new Error('Library not loaded: /usr/local/lib/libfuse3.4.dylib')
  const err = wrapMacFuseLoadError(cause)

  t.equal(err.code, 'EMACFUSEDEPENDENCY')
  t.equal(err.cause, cause)
  t.match(err.message, /Install and enable macFUSE/)
  t.end()
})

tape('unrelated dynamic loader errors are preserved', function (t) {
  const cause = new Error('No native build was found')
  t.equal(wrapMacFuseLoadError(cause), cause)
  t.end()
})
