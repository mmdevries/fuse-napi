'use strict'

const assert = require('assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const v8 = require('v8')

const Fuse = require('..')

const mode = enumEnvironment(
  'FUSE_NAPI_WRITE_SOAK_MODE',
  ['control', 'write', 'writeBuffer'],
  'write'
)
const iterations = positiveIntegerEnvironment('FUSE_NAPI_WRITE_SOAK_ITERATIONS', 20000, 10000000)
const defaultBatchSize = Math.min(2000, iterations)
const warmupIterations = nonnegativeIntegerEnvironment(
  'FUSE_NAPI_WRITE_SOAK_WARMUP',
  defaultBatchSize,
  iterations
)
const sampleEvery = positiveIntegerEnvironment(
  'FUSE_NAPI_WRITE_SOAK_SAMPLE_EVERY',
  defaultBatchSize,
  iterations
)
const writeSize = positiveIntegerEnvironment('FUSE_NAPI_WRITE_SOAK_WRITE_SIZE', 64 * 1024, 4 * 1024 * 1024)
const workingSetSize = positiveIntegerEnvironment(
  'FUSE_NAPI_WRITE_SOAK_WORKING_SET',
  4 * 1024 * 1024,
  1024 * 1024 * 1024
)
const rssLimit = megabytesEnvironment('FUSE_NAPI_WRITE_SOAK_RSS_LIMIT_MB', 96)
const arrayBufferLimit = megabytesEnvironment('FUSE_NAPI_WRITE_SOAK_ARRAY_BUFFER_LIMIT_MB', 16)
const inspect = booleanEnvironment('FUSE_NAPI_WRITE_SOAK_INSPECT', false)

if (workingSetSize < writeSize) {
  throw new RangeError('FUSE_NAPI_WRITE_SOAK_WORKING_SET must be at least FUSE_NAPI_WRITE_SOAK_WRITE_SIZE')
}

const payload = Buffer.alloc(writeSize, 0xa5)
const samples = []
let handledWrites = 0
let handledBytes = 0

run().catch(err => {
  console.error(err.stack || err)
  process.exitCode = 1
})

async function run () {
  const target = mode === 'control' ? await createControlTarget() : await createFuseTarget()
  let completedWrites = 0

  try {
    console.log(JSON.stringify({
      event: 'ready',
      pid: process.pid,
      mode,
      iterations,
      warmupIterations,
      sampleEvery,
      writeSize,
      workingSetSize
    }))

    await writeMany(target.fd, warmupIterations, completedWrites)
    completedWrites += warmupIterations
    await settleMemory()
    sample('baseline', 0)
    await inspectionPause('baseline')

    for (let measured = 0; measured < iterations;) {
      const count = Math.min(sampleEvery, iterations - measured)
      await writeMany(target.fd, count, completedWrites)
      completedWrites += count
      measured += count
      await settleMemory()
      sample('progress', measured)
    }

    if (mode !== 'control') {
      assert.equal(
        handledBytes,
        (warmupIterations + iterations) * writeSize,
        'every submitted byte must reach the FUSE handler'
      )
      assert.equal(
        handledWrites,
        warmupIterations + iterations,
        'direct I/O must deliver exactly one FUSE request per submitted write'
      )
    }

    const summary = summarize(samples)
    console.log(JSON.stringify({ event: 'summary', ...summary }))
    await inspectionPause('final')

    assert.ok(
      summary.growth.rss <= rssLimit,
      `RSS grew by ${summary.growth.rss} bytes (limit ${rssLimit} bytes)`
    )
    assert.ok(
      summary.growth.arrayBuffers <= arrayBufferLimit,
      `arrayBuffers grew by ${summary.growth.arrayBuffers} bytes (limit ${arrayBufferLimit} bytes)`
    )
  } finally {
    await target.close()
  }
}

async function createControlTarget () {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fuse-napi-write-control-'))
  const filename = path.join(directory, 'data')
  const handle = await fs.promises.open(filename, 'w+')
  await handle.truncate(workingSetSize)
  return {
    fd: handle.fd,
    async close () {
      await handle.close()
      await fs.promises.unlink(filename)
      await fs.promises.rmdir(directory)
    }
  }
}

async function createFuseTarget () {
  const mountpoint = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fuse-napi-write-soak-'))
  const now = new Date()
  const rootStat = metadata(0o40755, 4096, now)
  const fileStat = metadata(0o100644, workingSetSize, now)
  const writeOperation = function (name, fd, buffer, length, position, cb) {
    handledWrites++
    handledBytes += length
    cb(length)
  }
  const ops = {
    getattr (name, cb) {
      if (name === '/') return process.nextTick(cb, 0, rootStat)
      if (name === '/data') return process.nextTick(cb, 0, fileStat)
      return process.nextTick(cb, Fuse.ENOENT)
    },
    fgetattr (name, fd, cb) {
      process.nextTick(cb, 0, fileStat)
    },
    open (name, flags, cb) {
      process.nextTick(cb, 0, 1)
    },
    release (name, fd, cb) {
      process.nextTick(cb, 0)
    }
  }
  ops[mode] = writeOperation

  const fuse = new Fuse(mountpoint, ops, {
    force: true,
    directIo: true,
    attrTimeout: 0,
    maxConcurrency: 1,
    timeout: 15000
  })
  let mounted = false
  let handle
  try {
    await lifecycle(fuse, 'mount')
    mounted = true
    handle = await fs.promises.open(path.join(mountpoint, 'data'), 'r+')
  } catch (err) {
    if (mounted) await lifecycle(fuse, 'unmount').catch(() => {})
    await fs.promises.rmdir(mountpoint).catch(() => {})
    throw err
  }

  return {
    fd: handle.fd,
    async close () {
      let closeError
      try {
        await handle.close()
      } catch (err) {
        closeError = err
      }
      try {
        await lifecycle(fuse, 'unmount')
      } catch (err) {
        closeError = closeError || err
      }
      try {
        await fs.promises.rmdir(mountpoint)
      } catch (err) {
        closeError = closeError || err
      }
      if (closeError) throw closeError
    }
  }
}

function writeMany (fd, count, startIndex) {
  if (count === 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    let index = 0
    writeNext()

    function writeNext () {
      const position = ((startIndex + index) * writeSize) % workingSetSize
      fs.write(fd, payload, 0, writeSize, position, onwrite)
    }

    function onwrite (err, bytesWritten) {
      if (err) return reject(err)
      if (bytesWritten !== writeSize) {
        return reject(new Error(`short write: received ${bytesWritten} of ${writeSize} bytes`))
      }
      index++
      if (index === count) return resolve()
      writeNext()
    }
  })
}

async function settleMemory () {
  for (let index = 0; index < 4; index++) {
    await new Promise(resolve => setImmediate(resolve))
    if (global.gc) global.gc()
  }
}

function sample (event, writes) {
  const memory = process.memoryUsage()
  const record = {
    event,
    writes,
    rss: memory.rss,
    heapTotal: memory.heapTotal,
    heapUsed: memory.heapUsed,
    external: memory.external,
    arrayBuffers: memory.arrayBuffers,
    malloced: v8.getHeapStatistics().malloced_memory
  }
  samples.push(record)
  console.log(JSON.stringify(record))
}

function summarize (records) {
  const baseline = records[0]
  const final = records[records.length - 1]
  const fields = ['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers', 'malloced']
  const growth = {}
  const bytesPerWrite = {}
  for (const field of fields) {
    growth[field] = final[field] - baseline[field]
    bytesPerWrite[field] = linearRegressionSlope(records, field)
  }
  return {
    mode,
    handledWrites,
    handledBytes,
    measuredWrites: iterations,
    growth,
    bytesPerWrite
  }
}

function linearRegressionSlope (records, field) {
  const count = records.length
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  for (const record of records) {
    sumX += record.writes
    sumY += record[field]
    sumXY += record.writes * record[field]
    sumXX += record.writes * record.writes
  }
  const denominator = count * sumXX - sumX * sumX
  return denominator === 0 ? 0 : (count * sumXY - sumX * sumY) / denominator
}

function metadata (mode, size, now) {
  return {
    mode,
    size,
    uid: typeof process.getuid === 'function' ? process.getuid() : 0,
    gid: typeof process.getgid === 'function' ? process.getgid() : 0,
    atime: now,
    mtime: now,
    ctime: now
  }
}

function lifecycle (fuse, method) {
  return new Promise((resolve, reject) => {
    fuse[method](err => err ? reject(err) : resolve())
  })
}

async function inspectionPause (phase) {
  if (!inspect) return
  console.log(JSON.stringify({ event: 'inspect', phase, pid: process.pid }))
  process.stdin.resume()
  await new Promise(resolve => process.stdin.once('data', resolve))
  process.stdin.pause()
}

function enumEnvironment (name, choices, fallback) {
  const value = process.env[name] || fallback
  if (!choices.includes(value)) {
    throw new RangeError(`${name} must be one of: ${choices.join(', ')}`)
  }
  return value
}

function positiveIntegerEnvironment (name, fallback, maximum) {
  const value = integerEnvironment(name, fallback)
  if (value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 1 through ${maximum}`)
  }
  return value
}

function nonnegativeIntegerEnvironment (name, fallback, maximum) {
  const value = integerEnvironment(name, fallback)
  if (value < 0 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 0 through ${maximum}`)
  }
  return value
}

function integerEnvironment (name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value)) throw new RangeError(`${name} must be an integer`)
  return value
}

function megabytesEnvironment (name, fallback) {
  return positiveIntegerEnvironment(name, fallback, 4096) * 1024 * 1024
}

function booleanEnvironment (name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  if (raw === '1' || raw === 'true') return true
  if (raw === '0' || raw === 'false') return false
  throw new RangeError(`${name} must be 0, 1, false, or true`)
}
