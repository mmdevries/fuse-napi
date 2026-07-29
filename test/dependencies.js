const tape = require('tape')

const { wrapMacFuseLoadError } = require('../lib/macfuse')
const { loadNativeBinding } = require('../lib/native-binding')
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

tape('Linux loader prefers a host-compatible local source build', function (t) {
  const expected = { binding: 'source' }
  let modernLoads = 0
  const loaded = loadNativeBinding('/package', {
    platform: 'linux',
    arch: 'x64',
    abi: '147',
    exists: name => name === '/package/build/Release/fuse.node',
    loadDefault: root => {
      t.equal(root, '/package', 'the package root reaches node-gyp-build')
      return expected
    },
    loadFile: () => {
      modernLoads++
    }
  })

  t.equal(loaded, expected, 'the source build is returned')
  t.equal(modernLoads, 0, 'bundled artifacts do not override a source build')
  t.end()
})

tape('Linux loader selects the libfuse SONAME 4 prebuild when available', function (t) {
  const expected = { binding: 'fuse4' }
  const loaded = loadNativeBinding('/package', {
    platform: 'linux',
    arch: 'arm64',
    abi: '137',
    exists: name => name.includes('linux-arm64-fuse4'),
    loadDefault: () => {
      t.fail('the baseline loader should not run')
    },
    loadFile: name => {
      t.equal(
        name,
        '/package/prebuilds/linux-arm64-fuse4/fuse-napi.abi137.node',
        'the exact ABI-specific modern prebuild is selected'
      )
      return expected
    }
  })

  t.equal(loaded, expected, 'the modern binding is returned')
  t.end()
})

tape('Linux loader falls back to SONAME 3 when the modern runtime is absent', function (t) {
  const expected = { binding: 'fuse3' }
  const loaded = loadNativeBinding('/package', {
    platform: 'linux',
    arch: 'x64',
    abi: '127',
    exists: name => name.includes('linux-x64-fuse4'),
    loadFile: () => {
      throw new Error('libfuse3.so.4: cannot open shared object file')
    },
    loadDefault: () => expected
  })

  t.equal(loaded, expected, 'the baseline binding is returned')
  t.end()
})

tape('Linux loader reports a missing FUSE runtime actionably', function (t) {
  try {
    loadNativeBinding('/package', {
      platform: 'linux',
      arch: 'x64',
      abi: '127',
      exists: () => false,
      loadDefault: () => {
        throw new Error('libfuse3.so.3: cannot open shared object file')
      }
    })
    t.fail('a missing runtime was accepted')
  } catch (err) {
    t.equal(err.code, 'EFUSEDEPENDENCY', 'the dependency failure has a stable code')
    t.match(err.message, /sudo apt-get install fuse3/, 'the failure is actionable')
  }
  t.end()
})
