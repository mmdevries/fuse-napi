const tape = require('tape')

const { wrapMacFuseLoadError } = require('../lib/macfuse')
const { discover } = require('../scripts/fuse-config')

tape('Linux dependency error is actionable', function (t) {
  t.throws(
    () => discover('linux', () => null, () => false),
    /sudo apt-get install libfuse-dev pkg-config/
  )
  t.end()
})

tape('macOS dependency error is actionable', function (t) {
  t.throws(
    () => discover('darwin', () => null, () => false),
    /https:\/\/macfuse\.github\.io\//
  )
  t.end()
})

tape('macOS fallback discovers the macFUSE compatibility library', function (t) {
  const existing = new Set([
    '/usr/local/include/fuse/fuse.h',
    '/usr/local/lib/libfuse.2.dylib'
  ])
  const config = discover('darwin', () => null, name => existing.has(name))

  t.same(config.includeDirs, ['/usr/local/include/fuse'])
  t.same(config.libraries, ['-L/usr/local/lib', '-lfuse', '-pthread'])
  t.end()
})

tape('macFUSE dynamic loader error is actionable', function (t) {
  const cause = new Error('Library not loaded: /usr/local/lib/libfuse.2.dylib')
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
