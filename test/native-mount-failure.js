const path = require('path')
const { spawnSync } = require('child_process')
const tape = require('tape')

tape('native mount initialization failures retain state until every handle closes', function (t) {
  if (process.platform !== 'linux') {
    t.skip('Linux-specific native mount failure lifecycle')
    t.end()
    return
  }

  const root = path.join(__dirname, '..')
  const script = `
    const fs = require('fs')
    const os = require('os')
    const path = require('path')
    const Fuse = require(${JSON.stringify(root)})

    run().catch(err => {
      console.error(err.stack || err)
      process.exitCode = 1
    })

    async function run () {
      for (let i = 0; i < 50; i++) {
        const mnt = fs.mkdtempSync(path.join(os.tmpdir(), 'fuse-napi-mount-failure-'))
        const fuse = new Fuse(mnt, {}, {
          force: true,
          modules: 'fuse_napi_intentionally_missing'
        })
        const err = await new Promise(resolve => fuse.mount(resolve))
        if (!err) throw new Error('missing FUSE module unexpectedly mounted')
        for (let j = 0; j < 5; j++) global.gc()
        await new Promise(resolve => setImmediate(resolve))
        fs.rmdirSync(mnt)
      }
    }
  `
  const result = spawnSync(process.execPath, ['--expose-gc', '-e', script], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000
  })

  t.equal(
    result.status,
    0,
    result.status === 0
      ? 'all native failure handles closed safely'
      : result.stderr || result.error?.stack || 'native failure lifecycle crashed'
  )
  t.end()
})

tape('native mount failure cleanup completes during environment teardown', function (t) {
  if (process.platform !== 'linux') {
    t.skip('Linux-specific native mount failure lifecycle')
    t.end()
    return
  }

  const root = path.join(__dirname, '..')
  const script = `
    const fs = require('fs')
    const os = require('os')
    const path = require('path')
    const Fuse = require(${JSON.stringify(root)})
    const mnt = fs.mkdtempSync(path.join(os.tmpdir(), 'fuse-napi-mount-exit-'))
    const fuse = new Fuse(mnt, {}, {
      force: true,
      modules: 'fuse_napi_intentionally_missing'
    })

    fuse.mount(err => {
      process.exit(err ? 0 : 2)
    })
  `

  for (let i = 0; i < 20; i++) {
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10000
    })
    if (result.status !== 0) {
      t.fail(
        result.stderr ||
        result.error?.stack ||
        `native failure teardown exited with status ${result.status} and signal ${result.signal}`
      )
      t.end()
      return
    }
  }

  t.pass('all immediate native failure teardowns closed safely')
  t.end()
})
