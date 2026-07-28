#!/usr/bin/env node

const fs = require('fs')
const { spawnSync } = require('child_process')

const { MACFUSE_URL } = require('../lib/macfuse')

if (require.main === module) {
  try {
    const config = discover()
    switch (process.argv[2]) {
      case 'include-dirs':
        console.log(config.includeDirs.join(' '))
        break
      case 'libraries':
        console.log(config.libraries.join(' '))
        break
      default:
        throw new Error('Usage: fuse-config.js <include-dirs|libraries>')
    }
  } catch (err) {
    console.error(err.message)
    process.exitCode = 1
  }
}

function discover (
  platform = process.platform,
  pkgConfig = runPkgConfig,
  exists = fs.existsSync
) {
  const version = pkgConfig(['--modversion', 'fuse'])
  if (version && /^2\./.test(version.trim())) {
    const cflags = pkgConfig(['--cflags-only-I', 'fuse'])
    const libraries = pkgConfig(['--libs', 'fuse'])
    if (cflags !== null && libraries !== null) {
      return {
        includeDirs: words(cflags).map(flag => flag.replace(/^-I/, '')),
        libraries: words(libraries)
      }
    }
  }

  if (platform === 'darwin') {
    const include = '/usr/local/include/fuse'
    const dylibs = [
      '/usr/local/lib/libfuse.dylib',
      '/usr/local/lib/libfuse.2.dylib'
    ]
    if (exists(`${include}/fuse.h`) && dylibs.some(exists)) {
      return {
        includeDirs: [include],
        libraries: ['-L/usr/local/lib', '-lfuse', '-pthread']
      }
    }

    throw new Error(
      'macFUSE with its libfuse 2 compatibility headers is required to build fuse-napi on macOS. ' +
      `Install macFUSE from ${MACFUSE_URL}; fuse-napi does not download or install it.`
    )
  }

  if (platform === 'linux') {
    throw new Error(
      'System libfuse 2 development files and pkg-config are required to build fuse-napi on Linux. ' +
      'On Debian or Ubuntu, run: sudo apt-get install libfuse-dev pkg-config'
    )
  }

  throw new Error(`fuse-napi supports Linux and macOS; received unsupported platform ${platform}.`)
}

function runPkgConfig (args) {
  const result = spawnSync(process.env.PKG_CONFIG || 'pkg-config', args, {
    encoding: 'utf8'
  })
  if (result.error || result.status !== 0) return null
  return result.stdout.trim()
}

function words (value) {
  return value.trim() ? value.trim().split(/\s+/) : []
}

module.exports = {
  discover
}
