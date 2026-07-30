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
const packageMetadata = require('../package.json')
const releaseTag = `v${packageMetadata.version}`
const privilegedRecoveryTest = path.join(root, 'test', 'privileged', 'broken-mount.js')
const modernOperationsRunner = path.join(
  root,
  'test',
  'fixtures',
  'modern-operations-runner.js'
)
const modernOperationsSmoke = path.join(root, 'scripts', 'modern-operations-smoke.js')

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

tape('release metadata requires a changelog section matching the package version', function (t) {
  const tempRoot = verificationFixture()
  const changelogPath = path.join(tempRoot, 'CHANGELOG.md')
  const changelog = fs.readFileSync(changelogPath, 'utf8')
  fs.writeFileSync(
    changelogPath,
    changelog.replace(`## ${packageMetadata.version} - `, '## 9.9.9 - ')
  )

  try {
    const result = verify({
      GITHUB_REF_TYPE: 'tag',
      GITHUB_REF_NAME: releaseTag
    }, [], tempRoot)
    t.equal(result.status, 1, 'a missing version section is rejected')
    t.match(result.stderr, /dated section/, 'failure identifies the changelog requirement')
    t.end()
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

tape('tagged releases require an empty Unreleased section', function (t) {
  const tempRoot = verificationFixture()
  const changelogPath = path.join(tempRoot, 'CHANGELOG.md')
  const changelog = fs.readFileSync(changelogPath, 'utf8')
  fs.writeFileSync(
    changelogPath,
    changelog.replace(
      '## Unreleased\n',
      '## Unreleased\n\n### Added\n\n- A staged release change.\n'
    )
  )

  try {
    const result = verify({
      GITHUB_REF_TYPE: 'tag',
      GITHUB_REF_NAME: releaseTag
    }, [], tempRoot)
    t.equal(result.status, 1, 'staged Unreleased entries are rejected')
    t.match(result.stderr, /Unreleased entries/, 'failure identifies the unfinished release notes')
    t.end()
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

tape('release verification requires every supported ABI prebuild', function (t) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fuse-napi-release-test-'))
  fs.mkdirSync(path.join(tempRoot, 'scripts'))
  for (const filename of ['package.json', 'package-lock.json', 'README.md', 'CHANGELOG.md']) {
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

tape('release verification requires the explicitly tagged musl prebuilds', function (t) {
  const tempRoot = verificationFixture()
  const abiFiles = ['abi127', 'abi137', 'abi147']
  const ordinaryTargets = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64']
  const modernTargets = ['linux-x64-fuse4', 'linux-arm64-fuse4']

  for (const target of ordinaryTargets.concat(modernTargets)) {
    const directory = path.join(tempRoot, 'prebuilds', target)
    fs.mkdirSync(directory, { recursive: true })
    for (const abi of abiFiles) {
      fs.writeFileSync(path.join(directory, `fuse-napi.${abi}.node`), 'prebuild')
      if (modernTargets.includes(target)) {
        fs.writeFileSync(path.join(directory, `fuse-napi.${abi}.musl.node`), 'prebuild')
      }
    }
  }

  const missing = path.join(
    tempRoot,
    'prebuilds',
    'linux-arm64-fuse4',
    'fuse-napi.abi137.musl.node'
  )
  fs.rmSync(missing)

  try {
    const result = verify({}, ['--artifacts'], tempRoot)
    t.equal(result.status, 1, 'a missing musl release prebuild is rejected')
    t.match(
      result.stderr,
      /linux-arm64-fuse4[/\\]fuse-napi\.abi137\.musl\.node/,
      'the missing tagged musl artifact is identified exactly'
    )
    t.end()
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

tape('privileged crash recovery remains an explicit test boundary', function (t) {
  t.equal(
    packageMetadata.scripts.test,
    'tape test/*.js',
    'the default suite remains unprivileged and excludes nested privileged tests'
  )
  t.equal(
    packageMetadata.scripts['test:privileged-recovery'],
    'tape test/privileged/broken-mount.js',
    'crashed-mount recovery has a dedicated command'
  )
  t.ok(fs.existsSync(privilegedRecoveryTest), 'the privileged recovery suite exists')
  t.end()
})

tape('modern package smoke has no development dependency boundary', function (t) {
  const runnerSource = fs.readFileSync(modernOperationsRunner, 'utf8')
  const smokeSource = fs.readFileSync(modernOperationsSmoke, 'utf8')
  const modernPackageJob = workflowJob(releaseWorkflow, 'modern-package-smoke')
  const missingArgument = spawnSync(process.execPath, [modernOperationsSmoke], {
    cwd: root,
    encoding: 'utf8'
  })

  t.notOk(
    /require\(['"]tape['"]\)/.test(runnerSource),
    'the shared runner does not require tape'
  )
  t.notOk(
    /require\(['"]tape['"]\)/.test(smokeSource),
    'the package smoke does not require tape'
  )
  t.equal(missingArgument.status, 64, 'the package smoke requires an explicit package root')
  t.match(missingArgument.stderr, /Usage:/, 'a missing package root is actionable')
  t.match(
    modernPackageJob,
    /node \.\.\/scripts\/modern-operations-smoke\.js "\$package_root"/,
    'the SONAME 4 gate passes the exact installed package to the dependency-free smoke'
  )
  t.notOk(
    /\bnpm ci\b/.test(modernPackageJob),
    'the clean package consumer installs no dev tree'
  )
  t.notOk(
    /FUSE_NAPI_PACKAGE_ROOT|node \.\.\/test\/modern-operations\.js/.test(modernPackageJob),
    'the package gate cannot fall back to the tape development wrapper'
  )
  t.end()
})

tape('release artifacts retain manually initiated production gates', function (t) {
  t.match(ciWorkflow, /\n  workflow_dispatch:\n/, 'CI remains manually dispatchable')
  t.notOk(/\n  push:\n/.test(ciWorkflow), 'pushes cannot trigger CI')
  t.notOk(/\n  pull_request:\n/.test(ciWorkflow), 'pull requests cannot trigger CI')
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
    /Mount exact npm tarball with libfuse 3\.18 \/ SONAME 4/,
    'the assembled modern Linux package must perform a real syscall mount'
  )
  t.match(ciWorkflow, /libfuse3-dev/, 'CI builds against FUSE 3 headers')
  t.match(ciWorkflow, /libfuse3\.so\.3/, 'CI verifies the FUSE 3 runtime ABI')
  t.match(ciWorkflow, /libfuse3\.so\.4/, 'CI verifies the modern FUSE 3 runtime ABI')
  t.match(ciWorkflow, /runtime\.hasStatx/, 'CI verifies native statx support')
  t.match(ciWorkflow, /scan-build --status-bugs/, 'CI runs a native static analyzer')
  t.match(ciWorkflow, /-fsanitize=address,undefined/, 'CI runs ASan and UBSan')
  t.equal(
    (ciWorkflow.match(/test "\$\(sudo -n id -u\)" = 0/g) || []).length,
    3,
    'all privileged mount gates require an explicit non-interactive root boundary'
  )
  t.equal(
    (ciWorkflow.match(/sudo -n env \\\n/g) || []).length,
    4,
    'privileged mount gates preserve an explicit environment behind sudo'
  )
  t.equal(
    (ciWorkflow.match(/npm run test:privileged-recovery/g) || []).length,
    2,
    'crashed-mount recovery runs in the Linux matrix and under sanitizers'
  )
  t.match(
    ciWorkflow,
    /Run unprivileged Linux integration tests\n        run: npm test/,
    'the ordinary Linux integration suite remains unprivileged'
  )
  t.match(
    ciWorkflow,
    /Run the complete mounted suite under sanitizers[\s\S]*?npm test[\s\S]*?npm run test:privileged-recovery/,
    'sanitizers cover both ordinary mounts and privileged crash recovery'
  )
  t.notOk(
    /export LD_PRELOAD/.test(ciWorkflow),
    'the sanitizer runtime is not leaked into unprivileged system helpers'
  )
  t.match(ciWorkflow, /npm run test:fuzz/, 'CI runs deterministic boundary fuzzing')
  t.match(ciWorkflow, /npm run test:soak/, 'CI runs repeated mount and teardown cycles')
  t.match(ciWorkflow, /FUSE_NAPI_SOAK_RSS_LIMIT_MB: 192/, 'sanitizer RSS remains bounded')
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
  t.match(releaseWorkflow, /npm sbom --omit=dev/, 'the package includes a production SBOM')
  t.match(releaseWorkflow, /actions\/attest@/, 'the package and SBOM are attested')
  t.match(releaseWorkflow, /artifact-metadata: write/, 'attestation storage is authorized')
  t.match(releaseWorkflow, /linux-x64-fuse4/, 'the release contains SONAME 4 prebuilds')
  t.match(
    releaseWorkflow,
    /fuse-napi\.abi\$\{\{ matrix\.abi \}\}\.musl\.node/,
    'the release builds explicitly tagged musl prebuilds'
  )
  t.match(
    releaseWorkflow,
    /node:\$\{\{ matrix\.node-version \}\}-alpine3\.23/,
    'the musl artifacts are built and loaded on the supported Alpine baseline'
  )
  t.match(
    releaseGuide,
    /24 Node\.js ABI-specific prebuilds/,
    'the release inventory includes every musl artifact'
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
  t.match(
    releaseGuide,
    /Create a GitHub Release from the existing immutable tag/,
    'the release guide requires a permanent public release record'
  )
  t.match(
    releaseGuide,
    /attach the exact `fuse-napi-\*\.tgz`, `SHA256SUMS`, and/,
    'the GitHub Release retains the verified package, checksums, and SBOM'
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

function verificationFixture () {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fuse-napi-release-metadata-'))
  fs.mkdirSync(path.join(tempRoot, 'scripts'))
  for (const filename of ['package.json', 'package-lock.json', 'README.md', 'CHANGELOG.md']) {
    fs.copyFileSync(path.join(root, filename), path.join(tempRoot, filename))
  }
  fs.copyFileSync(script, path.join(tempRoot, 'scripts', 'verify-release.js'))
  return tempRoot
}

function workflowJob (workflow, name) {
  const start = workflow.indexOf(`\n  ${name}:\n`)
  if (start === -1) return ''
  const remainder = workflow.slice(start + 1)
  const nextJob = remainder.search(/\n  [a-z][a-z0-9-]+:\n/)
  return nextJob === -1 ? remainder : remainder.slice(0, nextJob)
}
