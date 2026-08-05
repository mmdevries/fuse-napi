'use strict'

const assert = require('assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const v8 = require('v8')

const Fuse = require('..')

const mode = enumEnvironment(
  'FUSE_NAPI_OPEN_RELEASE_MODE',
  ['fuse', 'file', 'combined'],
  'fuse'
)
const pathMode = enumEnvironment(
  'FUSE_NAPI_OPEN_RELEASE_PATHS',
  ['same', 'unique'],
  'unique'
)
const unlinkAfterClose = booleanEnvironment('FUSE_NAPI_OPEN_RELEASE_UNLINK', false)
const noforget = booleanEnvironment('FUSE_NAPI_OPEN_RELEASE_NOFORGET', false)
const invalidateAfterClose = booleanEnvironment(
  'FUSE_NAPI_OPEN_RELEASE_INVALIDATE_AFTER_CLOSE',
  false
)
const fuseDebug = booleanEnvironment('FUSE_NAPI_OPEN_RELEASE_DEBUG', false)
const iterations = positiveIntegerEnvironment('FUSE_NAPI_OPEN_RELEASE_ITERATIONS', 20000, 1000000)
const defaultBatchSize = Math.min(2000, iterations)
const warmupIterations = nonnegativeIntegerEnvironment(
  'FUSE_NAPI_OPEN_RELEASE_WARMUP',
  defaultBatchSize,
  iterations
)
const sampleEvery = positiveIntegerEnvironment(
  'FUSE_NAPI_OPEN_RELEASE_SAMPLE_EVERY',
  defaultBatchSize,
  iterations
)
const writesPerOpen = nonnegativeIntegerEnvironment(
  'FUSE_NAPI_OPEN_RELEASE_WRITES_PER_OPEN',
  0,
  100
)
const writeSize = positiveIntegerEnvironment(
  'FUSE_NAPI_OPEN_RELEASE_WRITE_SIZE',
  64 * 1024,
  4 * 1024 * 1024
)
const settleMs = nonnegativeIntegerEnvironment('FUSE_NAPI_OPEN_RELEASE_SETTLE_MS', 250, 60000)
const inspect = booleanEnvironment('FUSE_NAPI_OPEN_RELEASE_INSPECT', false)

const payload = Buffer.alloc(writeSize, 0xa5)
const samples = []
const counters = {
  fuseGetattrs: 0,
  fuseOpens: 0,
  fuseWrites: 0,
  fuseReleases: 0,
  fuseUnlinks: 0,
  entryInvalidationRequests: 0,
  entryInvalidations: 0,
  entryInvalidationErrors: 0,
  backingOpened: 0,
  backingWrites: 0,
  backingClosed: 0,
  backingUnlinked: 0,
  backingErrors: 0
}

run().catch(err => {
  console.error(err.stack || err)
  process.exitCode = 1
})

async function run () {
  const target = mode === 'file' ? await createFileTarget() : await createFuseTarget()
  let completedCycles = 0

  try {
    console.log(JSON.stringify({
      event: 'ready',
      pid: process.pid,
      mode,
      pathMode,
      unlinkAfterClose,
      noforget,
      invalidateAfterClose,
      fuseDebug,
      iterations,
      warmupIterations,
      sampleEvery,
      writesPerOpen,
      writeSize,
      settleMs
    }))

    await runCycles(target, warmupIterations, completedCycles)
    completedCycles += warmupIterations
    await target.drain(completedCycles)
    await settleMemory()
    sample('baseline', 0, target)
    await inspectionPause('baseline')

    for (let measured = 0; measured < iterations;) {
      const count = Math.min(sampleEvery, iterations - measured)
      await runCycles(target, count, completedCycles)
      completedCycles += count
      measured += count
      await target.drain(completedCycles)
      await settleMemory()
      sample('progress', measured, target)
    }

    assertBalanced(completedCycles, target)
    const summary = summarize(samples)
    console.log(JSON.stringify({
      event: 'summary',
      ...summary,
      counters,
      activeBackingFiles: target.activeBackingFiles()
    }))
    await inspectionPause('final')
  } finally {
    await target.close()
  }
}

async function runCycles (target, count, startCycle) {
  for (let index = 0; index < count; index++) {
    const cycle = startCycle + index
    const handle = await target.open(cycle)
    try {
      for (let writeIndex = 0; writeIndex < writesPerOpen; writeIndex++) {
        const result = await handle.write(payload, 0, payload.length, writeIndex * payload.length)
        assert.equal(result.bytesWritten, payload.length, 'write must consume the complete payload')
      }
    } finally {
      await handle.close()
    }
    if (invalidateAfterClose) await target.invalidate(cycle)
    if (unlinkAfterClose) await target.unlink(cycle)
  }
}

async function createFileTarget () {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fuse-napi-file-lifecycle-'))
  return {
    async open (cycle) {
      const filename = backingFilename(directory, cycle)
      const file = await fs.promises.open(filename, 'a+')
      counters.backingOpened++
      return {
        async write (buffer, offset, length, position) {
          const result = await file.write(buffer, offset, length, position)
          counters.backingWrites++
          return result
        },
        async close () {
          try {
            await file.close()
            counters.backingClosed++
          } catch (err) {
            counters.backingErrors++
            throw err
          }
        }
      }
    },
    async unlink (cycle) {
      try {
        await fs.promises.unlink(backingFilename(directory, cycle))
        counters.backingUnlinked++
      } catch (err) {
        counters.backingErrors++
        throw err
      }
    },
    async invalidate () {},
    async drain () {},
    activeBackingFiles () {
      return counters.backingOpened - counters.backingClosed
    },
    async close () {
      await fs.promises.rm(directory, { recursive: true, force: true })
    }
  }
}

async function createFuseTarget () {
  const mountpoint = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fuse-napi-open-release-'))
  const backingDirectory = mode === 'combined'
    ? await fs.promises.mkdtemp(path.join(os.tmpdir(), 'fuse-napi-open-release-backing-'))
    : null
  const now = new Date()
  const rootStat = metadata(0o40755, 4096, now)
  const fileStat = metadata(0o100644, writesPerOpen * writeSize, now)
  const backingFiles = new Map()
  let nextFd = 1
  let highestUnlinkedCycle = -1
  let mounted = false

  const ops = {
    getattr (name, cb) {
      if (name === '/') return process.nextTick(cb, 0, rootStat)
      if (wasUnlinked(name, highestUnlinkedCycle)) {
        counters.fuseGetattrs++
        return process.nextTick(cb, Fuse.ENOENT)
      }
      if (isTestPath(name)) {
        counters.fuseGetattrs++
        return process.nextTick(cb, 0, fileStat)
      }
      return process.nextTick(cb, Fuse.ENOENT)
    },
    fgetattr (name, fd, cb) {
      process.nextTick(cb, 0, fileStat)
    },
    open (name, flags, cb) {
      counters.fuseOpens++
      const fd = nextFd++
      if (mode !== 'combined') return process.nextTick(cb, 0, fd)

      const filename = path.join(backingDirectory, path.basename(name))
      fs.promises.open(filename, 'a+').then(file => {
        counters.backingOpened++
        backingFiles.set(fd, { file, filename })
        cb(0, fd)
      }, err => {
        counters.backingErrors++
        console.error(err.stack || err)
        cb(Fuse.EIO)
      })
    },
    write (name, fd, buffer, length, position, cb) {
      counters.fuseWrites++
      if (mode !== 'combined') return process.nextTick(cb, length)

      const backing = backingFiles.get(fd)
      if (!backing) return process.nextTick(cb, Fuse.EBADF)
      backing.file.write(buffer, 0, length, position).then(result => {
        counters.backingWrites++
        cb(result.bytesWritten)
      }, err => {
        counters.backingErrors++
        console.error(err.stack || err)
        cb(Fuse.EIO)
      })
    },
    release (name, fd, cb) {
      counters.fuseReleases++
      if (mode !== 'combined') return process.nextTick(cb, 0)

      const backing = backingFiles.get(fd)
      if (!backing) return process.nextTick(cb, Fuse.EBADF)
      backingFiles.delete(fd)
      backing.file.close().then(() => {
        counters.backingClosed++
        cb(0)
      }, err => {
        counters.backingErrors++
        console.error(err.stack || err)
        cb(Fuse.EIO)
      })
    },
    unlink (name, cb) {
      counters.fuseUnlinks++
      const cycle = uniquePathCycle(name)
      if (cycle !== null) highestUnlinkedCycle = Math.max(highestUnlinkedCycle, cycle)
      if (mode !== 'combined') return process.nextTick(cb, 0)

      fs.promises.unlink(path.join(backingDirectory, path.basename(name))).then(() => {
        counters.backingUnlinked++
        cb(0)
      }, err => {
        counters.backingErrors++
        console.error(err.stack || err)
        cb(Fuse.EIO)
      })
    }
  }

  const fuseOptions = {
    force: true,
    directIo: true,
    attrTimeout: 0,
    entryTimeout: 0,
    noforget,
    maxConcurrency: 1,
    timeout: 15000,
    debug: fuseDebug
  }
  if (!noforget) fuseOptions.remember = 0

  const fuse = new Fuse(mountpoint, ops, fuseOptions)

  try {
    await lifecycle(fuse, 'mount')
    mounted = true
  } catch (err) {
    if (mounted) await lifecycle(fuse, 'unmount').catch(() => {})
    await fs.promises.rmdir(mountpoint).catch(() => {})
    if (backingDirectory) await fs.promises.rmdir(backingDirectory).catch(() => {})
    throw err
  }

  return {
    fuse,
    open (cycle) {
      return fs.promises.open(mountedFilename(mountpoint, cycle), 'r+')
    },
    unlink (cycle) {
      return fs.promises.unlink(mountedFilename(mountpoint, cycle))
    },
    invalidate (cycle) {
      counters.entryInvalidationRequests++
      return new Promise((resolve, reject) => {
        fuse.invalidateEntry(virtualFilename(cycle), err => {
          if (err) {
            counters.entryInvalidationErrors++
            return reject(err)
          }
          counters.entryInvalidations++
          resolve()
        })
      })
    },
    async drain (expectedCycles) {
      const deadline = Date.now() + 15000
      const expectedUnlinks = unlinkAfterClose ? expectedCycles : 0
      while (counters.fuseReleases < expectedCycles || counters.fuseUnlinks < expectedUnlinks) {
        if (Date.now() >= deadline) {
          throw new Error(
            `timed out waiting for lifecycle: releases=${counters.fuseReleases}/${expectedCycles}, ` +
            `unlinks=${counters.fuseUnlinks}/${expectedUnlinks}`
          )
        }
        await new Promise(resolve => setImmediate(resolve))
      }
    },
    activeBackingFiles () {
      return backingFiles.size
    },
    async close () {
      let closeError
      try {
        await lifecycle(fuse, 'unmount')
      } catch (err) {
        closeError = err
      }
      for (const backing of backingFiles.values()) {
        await backing.file.close().catch(() => {})
        await fs.promises.unlink(backing.filename).catch(() => {})
      }
      try {
        await fs.promises.rmdir(mountpoint)
      } catch (err) {
        closeError = closeError || err
      }
      if (backingDirectory) {
        try {
          await fs.promises.rm(backingDirectory, { recursive: true, force: true })
        } catch (err) {
          closeError = closeError || err
        }
      }
      if (closeError) throw closeError
    }
  }
}

function assertBalanced (completedCycles, target) {
  const expectedWrites = completedCycles * writesPerOpen
  if (mode !== 'file') {
    assert.equal(counters.fuseOpens, completedCycles, 'every cycle must reach FUSE open')
    assert.equal(counters.fuseWrites, expectedWrites, 'every write must reach FUSE')
    assert.equal(counters.fuseReleases, completedCycles, 'every cycle must reach FUSE release')
    assert.equal(
      counters.entryInvalidations,
      invalidateAfterClose ? completedCycles : 0,
      'entry invalidation count must match the configured housekeeping lifecycle'
    )
    assert.equal(counters.entryInvalidationErrors, 0, 'entry invalidation must have no errors')
    assert.equal(
      counters.fuseUnlinks,
      unlinkAfterClose ? completedCycles : 0,
      'FUSE unlink count must match the configured lifecycle'
    )
  }
  if (mode !== 'fuse') {
    assert.equal(counters.backingOpened, completedCycles, 'every cycle must open one backing file')
    assert.equal(counters.backingWrites, expectedWrites, 'every write must reach the backing file')
    assert.equal(counters.backingClosed, completedCycles, 'every backing file must close')
    assert.equal(
      counters.backingUnlinked,
      unlinkAfterClose ? completedCycles : 0,
      'backing unlink count must match the configured lifecycle'
    )
    assert.equal(counters.backingErrors, 0, 'backing file lifecycle must have no errors')
    assert.equal(target.activeBackingFiles(), 0, 'no backing files may remain active')
  }
}

async function settleMemory () {
  for (let index = 0; index < 4; index++) {
    await new Promise(resolve => setImmediate(resolve))
    if (global.gc) global.gc()
  }
  if (settleMs > 0) await new Promise(resolve => setTimeout(resolve, settleMs))
  if (global.gc) global.gc()
}

function sample (event, cycles, target) {
  const memory = process.memoryUsage()
  const heap = v8.getHeapStatistics()
  const record = {
    event,
    cycles,
    rss: memory.rss,
    heapTotal: memory.heapTotal,
    heapUsed: memory.heapUsed,
    external: memory.external,
    arrayBuffers: memory.arrayBuffers,
    v8Physical: heap.total_physical_size,
    nativeResidual: memory.rss - heap.total_physical_size - memory.external,
    malloced: heap.malloced_memory,
    activeBackingFiles: target.activeBackingFiles(),
    pendingSignals: target.fuse ? target.fuse._pendingSignals.size : 0,
    counters: { ...counters }
  }
  samples.push(record)
  console.log(JSON.stringify(record))
}

function summarize (records) {
  const baseline = records[0]
  const final = records[records.length - 1]
  const fields = [
    'rss',
    'heapTotal',
    'heapUsed',
    'external',
    'arrayBuffers',
    'v8Physical',
    'nativeResidual',
    'malloced'
  ]
  const growth = {}
  const bytesPerCycle = {}
  for (const field of fields) {
    growth[field] = final[field] - baseline[field]
    bytesPerCycle[field] = linearRegressionSlope(records, field)
  }
  return {
    mode,
    pathMode,
    unlinkAfterClose,
    noforget,
    invalidateAfterClose,
    measuredCycles: iterations,
    writesPerOpen,
    growth,
    bytesPerCycle
  }
}

function isTestPath (name) {
  return name === '/data' || /^\/file-\d+$/.test(name)
}

function uniquePathCycle (name) {
  const match = /^\/file-(\d+)$/.exec(name)
  return match ? Number(match[1]) : null
}

function wasUnlinked (name, highestUnlinkedCycle) {
  const cycle = uniquePathCycle(name)
  return cycle !== null && cycle <= highestUnlinkedCycle
}

function mountedFilename (mountpoint, cycle) {
  return path.join(mountpoint, pathMode === 'same' ? 'data' : `file-${cycle}`)
}

function virtualFilename (cycle) {
  return pathMode === 'same' ? '/data' : `/file-${cycle}`
}

function backingFilename (directory, cycle) {
  return path.join(directory, pathMode === 'same' ? 'data' : `file-${cycle}`)
}

function linearRegressionSlope (records, field) {
  const count = records.length
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  for (const record of records) {
    sumX += record.cycles
    sumY += record[field]
    sumXY += record.cycles * record[field]
    sumXX += record.cycles * record.cycles
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

function booleanEnvironment (name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  if (raw === '1' || raw === 'true') return true
  if (raw === '0' || raw === 'false') return false
  throw new RangeError(`${name} must be 0, 1, false, or true`)
}
