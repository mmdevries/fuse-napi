'use strict'

const assert = require('assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const Fuse = require('..')
const memoryFS = require('../test/fixtures/memory-fs')

const iterations = positiveIntegerEnvironment('FUSE_NAPI_SOAK_ITERATIONS', 12, 1000)
const rssLimitMb = positiveIntegerEnvironment('FUSE_NAPI_SOAK_RSS_LIMIT_MB', 128, 4096)
const baselineRss = process.memoryUsage().rss

run().catch(err => {
  console.error(err.stack || err)
  process.exitCode = 1
})

async function run () {
  for (let iteration = 0; iteration < iterations; iteration++) {
    const mountpoint = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fuse-napi-soak-'))
    const fuse = new Fuse(mountpoint, memoryFS(), {
      force: true,
      timeout: 15000,
      maxConcurrency: 8,
      remember: 1
    })
    let mounted = false
    try {
      await lifecycle(fuse, 'mount')
      mounted = true
      for (let index = 0; index < 40; index++) {
        const source = path.join(mountpoint, `source-${index}`)
        const destination = path.join(mountpoint, `destination-${index}`)
        const data = Buffer.from(`iteration=${iteration};file=${index}`)
        await fs.promises.writeFile(source, data)
        assert.deepEqual(await fs.promises.readFile(source), data)
        await fs.promises.rename(source, destination)
        assert.deepEqual(await fs.promises.readFile(destination), data)
        await fs.promises.unlink(destination)
      }
    } finally {
      if (mounted) await lifecycle(fuse, 'unmount')
      await fs.promises.rmdir(mountpoint)
    }
  }

  if (global.gc) {
    for (let index = 0; index < 5; index++) global.gc()
  }
  const growth = process.memoryUsage().rss - baselineRss
  const rssLimit = rssLimitMb * 1024 * 1024
  assert.ok(
    growth < rssLimit,
    `RSS grew by ${growth} bytes during the mount soak (limit ${rssLimit} bytes)`
  )
  console.log(`Completed ${iterations} mount cycles; RSS growth ${growth} bytes`)
}

function lifecycle (fuse, method) {
  return new Promise((resolve, reject) => {
    fuse[method](err => err ? reject(err) : resolve())
  })
}

function positiveIntegerEnvironment (name, fallback, maximum) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 1 through ${maximum}`)
  }
  return value
}
