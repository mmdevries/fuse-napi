const fs = require('fs')
const os = require('os')
const tape = require('tape')

const Fuse = require('../')

tape('macOS mount waits for the mounted device', { skip: os.platform() !== 'darwin' }, function (t) {
  const originalStat = fs.stat
  const events = []
  const fuse = new Fuse('/tmp/fuse-napi-mount-ready', {})
  let calls = 0

  fuse._mountpointDev = 1
  fuse._openCallback = function (err) {
    fs.stat = originalStat
    events.push('mount')

    t.error(err, 'mount succeeds')
    t.ok(calls >= 2, 'mountpoint was polled until its device changed')
    t.same(events, ['init', 'mount'], 'init completes before the public mount callback')
    t.end()
  }

  fs.stat = function (_, cb) {
    calls++
    process.nextTick(cb, null, { dev: calls === 1 ? 1 : 2 })
  }

  fuse._op_init(function (err) {
    t.equal(err, 0, 'FUSE init succeeds')
    events.push('init')
  })
})

tape('macOS mount readiness timeout is actionable', { skip: os.platform() !== 'darwin' }, function (t) {
  const originalStat = fs.stat
  const fuse = new Fuse('/tmp/fuse-napi-mount-timeout', {}, { timeout: 20 })

  fuse._mountpointDev = 1
  fuse._openCallback = function (err) {
    fs.stat = originalStat

    t.equal(err && err.code, 'EMACFUSEMOUNT')
    t.match(err && err.message, /macFUSE/)
    t.match(err && err.message, /Privacy & Security/)
    t.end()
  }

  fs.stat = function (_, cb) {
    process.nextTick(cb, null, { dev: 1 })
  }

  fuse._op_init(function () {})
})
