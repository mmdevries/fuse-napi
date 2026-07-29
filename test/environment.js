const tape = require('tape')

const Fuse = require('../')
const { checkEnvironment } = require('../lib/environment')

tape('Linux environment preflight verifies helper and device', async function (t) {
  const report = await checkEnvironment({}, {
    platform: 'linux',
    run: async (command, args) => {
      t.equal(command, 'fusermount3', 'the FUSE 3 helper is checked')
      t.deepEqual(args, ['--version'], 'the helper is executed without a shell')
      return { stdout: 'fusermount3 version: 3.18.2\n', stderr: '' }
    },
    access: async (name, mode) => {
      t.equal(name, '/dev/fuse', 'the kernel FUSE device is checked')
      t.ok(mode, 'read/write access is required')
    },
    readFile: async () => '',
    nativeRuntime: {
      version: '3.18.2',
      apiVersion: 318,
      hasBufferRelease: true
    }
  })

  t.equal(report.ok, true, 'a complete Linux runtime is accepted')
  t.equal(report.helper, 'fusermount3', 'the verified helper is reported')
  t.equal(report.capabilities.statx, false, 'the compiled statx capability is reported')
  t.end()
})

tape('Linux environment preflight reports a missing helper', async function (t) {
  try {
    await checkEnvironment({}, {
      platform: 'linux',
      run: async () => { throw new Error('ENOENT') },
      access: async () => {}
    })
    t.fail('missing helper was accepted')
  } catch (err) {
    t.equal(err.code, 'EFUSEHELPER', 'the failure has a stable code')
    t.match(err.message, /sudo apt-get install fuse3/, 'the failure is actionable')
  }
  t.end()
})

tape('Linux allowOther preflight enforces fuse.conf policy', async function (t) {
  const dependencies = {
    platform: 'linux',
    run: async () => ({ stdout: 'fusermount3 3.18.2', stderr: '' }),
    access: async () => {},
    readFile: async () => '# user_allow_other is intentionally disabled\n'
  }
  try {
    await checkEnvironment({ allowOther: true }, dependencies)
    t.fail('missing user_allow_other was accepted')
  } catch (err) {
    t.equal(err.code, 'EFUSEALLOWOTHER', 'the policy failure has a stable code')
    t.match(err.message, /user_allow_other/, 'the required setting is named')
  }
  t.end()
})

tape('macOS environment preflight verifies the complete runtime', async function (t) {
  const existing = new Set([
    '/Library/Filesystems/macfuse.fs',
    '/usr/local/lib/libfuse3.4.dylib'
  ])
  const report = await checkEnvironment({}, {
    platform: 'darwin',
    exists: name => existing.has(name),
    run: async () => ({ stdout: '3.18.2\n', stderr: '' }),
    nativeRuntime: {
      version: '3.18.2',
      apiVersion: 318,
      hasBufferRelease: true
    }
  })

  t.equal(report.ok, true, 'a complete macFUSE runtime is accepted')
  t.equal(report.libfuseVersion, '3.18.2', 'the detected version is reported')
  t.equal(report.capabilities.statx, false, 'unsupported macOS statx is explicit')
  t.end()
})

tape('environment preflight rejects an unsupported libfuse runtime', async function (t) {
  try {
    await checkEnvironment({}, {
      platform: 'linux',
      nativeRuntime: {
        version: '3.10.2',
        apiVersion: 310,
        hasBufferRelease: true
      }
    })
    t.fail('an unsupported libfuse runtime was accepted')
  } catch (err) {
    t.equal(err.code, 'EFUSEVERSION', 'the version failure has a stable code')
    t.match(err.message, /3\.10\.3 or newer/, 'the supported floor is actionable')
  }
  t.end()
})

tape('macOS environment preflight rejects an incompatible buffer ABI', async function (t) {
  try {
    await checkEnvironment({}, {
      platform: 'darwin',
      nativeRuntime: {
        version: '3.18.2',
        apiVersion: 318,
        hasBufferRelease: false
      }
    })
    t.fail('an incompatible macFUSE buffer ABI was accepted')
  } catch (err) {
    t.equal(err.code, 'EMACFUSEABI', 'the ABI failure has a stable code')
    t.match(err.message, /Upgrade macFUSE/, 'the failure is actionable')
  }
  t.end()
})

tape('public environment preflight applies FUSE 3 option normalization', async function (t) {
  try {
    await Fuse.checkEnvironment({ nonempty: true })
    t.fail('a removed native option reached the environment checks')
  } catch (err) {
    t.equal(err.code, 'ERR_FUSE_OPTION_REMOVED', 'native aliases use the public conformance contract')
    t.deepEqual(err.options, ['nonEmpty'], 'the canonical option is identified')
  }
  t.end()
})
