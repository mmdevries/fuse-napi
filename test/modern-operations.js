'use strict'

const path = require('path')
const tape = require('tape')

const runModernOperations = require('./fixtures/modern-operations-runner')

tape('modern FUSE 3 syscalls cross the native boundary', function (t) {
  if (process.platform !== 'linux') {
    t.pass('Linux-specific FUSE 3 syscall integration')
    return t.end()
  }

  runModernOperations(path.resolve(__dirname, '..')).then(
    function () {
      t.pass('modern syscalls complete successfully')
      t.end()
    },
    function (err) {
      t.fail(err && (err.stack || err.message) ? err.stack || err.message : String(err))
      t.end()
    }
  )
})
