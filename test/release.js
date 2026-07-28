const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const tape = require('tape')

const root = path.resolve(__dirname, '..')
const script = path.join(root, 'scripts', 'verify-release.js')

tape('release metadata accepts the exact package tag', function (t) {
  const result = verify({
    GITHUB_REF_TYPE: 'tag',
    GITHUB_REF_NAME: 'v1.0.0'
  })

  t.equal(result.status, 0, result.stderr || 'exact release tag is accepted')
  t.end()
})

tape('release metadata rejects a mismatched package tag', function (t) {
  const result = verify({
    GITHUB_REF_TYPE: 'tag',
    GITHUB_REF_NAME: 'v1.0.1'
  })

  t.equal(result.status, 1, 'mismatched release tag is rejected')
  t.match(result.stderr, /must equal "v1\.0\.0"/, 'failure identifies the expected tag')
  t.end()
})

tape('manual publishing without a release tag is rejected', function (t) {
  const result = verify({
    npm_lifecycle_event: 'prepublishOnly'
  })

  t.equal(result.status, 1, 'untagged publish is rejected')
  t.match(result.stderr, /only allowed from a verified release tag/, 'failure is actionable')
  t.end()
})

tape('release verification requires all four prebuilds', function (t) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fuse-napi-release-test-'))
  fs.mkdirSync(path.join(tempRoot, 'scripts'))
  for (const filename of ['package.json', 'package-lock.json', 'README.md']) {
    fs.copyFileSync(path.join(root, filename), path.join(tempRoot, filename))
  }
  fs.copyFileSync(script, path.join(tempRoot, 'scripts', 'verify-release.js'))

  try {
    const result = verify({}, ['--artifacts'], tempRoot)
    t.equal(result.status, 1, 'missing release prebuilds are rejected')
    t.match(result.stderr, /Missing release prebuild/, 'failure identifies the missing artifact')
    t.end()
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

function verify (overrides, args = [], workingRoot = root) {
  const env = { ...process.env }
  delete env.GITHUB_REF_TYPE
  delete env.GITHUB_REF_NAME
  delete env.RELEASE_TAG
  delete env.npm_lifecycle_event
  Object.assign(env, overrides)

  return spawnSync(process.execPath, [path.join(workingRoot, 'scripts', 'verify-release.js'), ...args], {
    cwd: workingRoot,
    encoding: 'utf8',
    env
  })
}
