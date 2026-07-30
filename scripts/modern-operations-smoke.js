'use strict'

const path = require('path')

const runModernOperations = require('../test/fixtures/modern-operations-runner')

const packageRoot = process.argv[2]

if (!packageRoot) {
  console.error('Usage: node scripts/modern-operations-smoke.js <installed-package-root>')
  process.exitCode = 64
} else {
  runModernOperations(path.resolve(packageRoot)).then(
    function () {
      console.log(`Mounted and verified modern FUSE 3 syscalls from ${path.resolve(packageRoot)}`)
    },
    function (err) {
      console.error(err && (err.stack || err.message) ? err.stack || err.message : String(err))
      process.exitCode = 1
    }
  )
}
