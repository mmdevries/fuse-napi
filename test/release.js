const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const tape = require('tape')

const root = path.resolve(__dirname, '..')
const script = path.join(root, 'scripts', 'verify-release.js')
const ciWorkflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')
const macosWorkflow = fs.readFileSync(path.join(root, '.github/workflows/macos-integration.yml'), 'utf8')
const releaseWorkflow = fs.readFileSync(path.join(root, '.github/workflows/prebuilds.yml'), 'utf8')

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

tape('release publication is gated by real cross-platform mounts', function (t) {
  t.match(ciWorkflow, /\n  workflow_call:\n/, 'the complete CI matrix is reusable by the release workflow')
  t.match(
    releaseWorkflow,
    /\n  ci:\n[\s\S]*?uses: \.\/\.github\/workflows\/ci\.yml\n/,
    'the release workflow invokes the complete CI matrix'
  )
  t.match(
    releaseWorkflow,
    /Mount and exercise the exact Linux npm tarball/,
    'the assembled Linux package must perform a real mount'
  )
  t.match(
    releaseWorkflow,
    /\n  macos-package-mount:\n[\s\S]*?ARM64[\s\S]*?X64/,
    'the assembled package must mount on Apple Silicon and Intel'
  )
  t.match(
    releaseWorkflow,
    /publish:\n[\s\S]*?needs:\n      - package-smoke\n      - macos-package-mount\n/,
    'publication depends on every exact-package mount gate'
  )
  t.match(
    releaseWorkflow,
    /workflow_dispatch:\n    inputs:\n      publish:[\s\S]*?type: boolean/,
    'publication requires an explicit manual boolean confirmation'
  )
  t.match(
    releaseWorkflow,
    /if: github\.ref_type == 'tag' && inputs\.publish/,
    'only a manually confirmed run on an exact tag can publish'
  )
  t.notOk(
    /\n  push:\n    tags:/.test(releaseWorkflow),
    'pushing a tag cannot publish automatically'
  )
  t.match(
    macosWorkflow,
    /push:\n    branches:\n      - main/,
    'real macOS mount coverage runs automatically for main'
  )
  t.end()
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
