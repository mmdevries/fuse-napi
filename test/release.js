const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const tape = require('tape')

const root = path.resolve(__dirname, '..')
const script = path.join(root, 'scripts', 'verify-release.js')
const ciWorkflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')
const macosWorkflow = path.join(root, '.github/workflows/macos-integration.yml')
const releaseWorkflow = fs.readFileSync(path.join(root, '.github/workflows/prebuilds.yml'), 'utf8')
const releaseGuide = fs.readFileSync(path.join(root, 'RELEASING.md'), 'utf8')
const releaseTag = `v${require('../package.json').version}`

tape('release metadata accepts the exact package tag', function (t) {
  const result = verify({
    GITHUB_REF_TYPE: 'tag',
    GITHUB_REF_NAME: releaseTag
  })

  t.equal(result.status, 0, result.stderr || 'exact release tag is accepted')
  t.end()
})

tape('release metadata rejects a mismatched package tag', function (t) {
  const result = verify({
    GITHUB_REF_TYPE: 'tag',
    GITHUB_REF_NAME: `${releaseTag}-mismatch`
  })

  t.equal(result.status, 1, 'mismatched release tag is rejected')
  t.ok(
    result.stderr.includes(`must equal "${releaseTag}"`),
    'failure identifies the expected tag'
  )
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

tape('release artifacts retain automated Linux gates and manual macOS validation', function (t) {
  t.match(ciWorkflow, /\n  workflow_dispatch:\n/, 'standalone CI requires a manual workflow dispatch')
  t.notOk(
    /\n  (?:push|pull_request):\n/.test(ciWorkflow),
    'pushes and pull requests cannot start CI'
  )
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
  t.match(ciWorkflow, /libfuse3-dev/, 'CI builds against FUSE 3 headers')
  t.match(ciWorkflow, /libfuse3\.so\.3/, 'CI verifies the FUSE 3 runtime ABI')
  t.notOk(/\blibfuse-dev\b/.test(ciWorkflow), 'CI no longer installs FUSE 2 headers')
  t.match(releaseWorkflow, /node-version: 26/, 'release smoke tests include Node.js 26')
  t.notOk(
    fs.existsSync(macosWorkflow),
    'the standalone self-hosted macOS workflow is absent'
  )
  t.notOk(
    /\n  macos-package-mount:\n/.test(releaseWorkflow),
    'the release workflow has no self-hosted macOS mount job'
  )
  t.notOk(
    /\n  publish:\n/.test(releaseWorkflow),
    'the artifact workflow cannot publish to npm'
  )
  t.notOk(
    /npm publish/.test(releaseWorkflow),
    'the artifact workflow contains no npm publication command'
  )
  t.match(
    releaseWorkflow,
    /workflow_dispatch:\n/,
    'release artifact creation requires a manual workflow dispatch'
  )
  t.notOk(
    /\n  push:\n    tags:/.test(releaseWorkflow),
    'pushing a tag cannot publish automatically'
  )
  t.match(
    releaseGuide,
    /both a physical Intel Mac and a physical Apple Silicon Mac/,
    'the release guide requires both macOS architectures to be tested manually'
  )
  t.match(
    releaseGuide,
    /scripts\/package-mount-smoke\.js/,
    'the release guide exercises the exact package with the mount smoke script'
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
