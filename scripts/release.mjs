import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version || '')) {
  console.error('Usage: node scripts/release.mjs 0.1.0')
  process.exit(1)
}

const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim()
if (branch !== 'main') {
  console.error('Cut releases from main.')
  process.exit(1)
}

const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
if (dirty.trim()) {
  console.error('Commit or stash the working tree before cutting a release.')
  process.exit(1)
}

const tag = `v${version}`
const existing = execFileSync('git', ['tag', '--list', tag], { encoding: 'utf8' }).trim()
if (existing) {
  console.error(`${tag} already exists.`)
  process.exit(1)
}

for (const file of ['packages/client/package.json', 'packages/mcp/package.json']) {
  const text = readFileSync(file, 'utf8')
  const next = text.replace(/"version": "[^"]+"/, `"version": "${version}"`)
  if (next === text) {
    console.error(`${file} has no version field.`)
    process.exit(1)
  }
  writeFileSync(file, next)
}

execFileSync('node', ['--test', 'packages/client/test', 'packages/mcp/test'], { stdio: 'inherit' })

const changed = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()
if (changed) {
  execFileSync('git', ['add', 'packages/client/package.json', 'packages/mcp/package.json'])
  execFileSync('git', ['commit', '-m', `release: ${version}`])
}

execFileSync('git', ['push', 'origin', 'HEAD'])
execFileSync('git', ['tag', '-a', tag, '-m', version])
execFileSync('git', ['push', 'origin', tag])
console.log(`${tag} pushed. GitHub will publish @conciergeprotocol/client and @conciergeprotocol/mcp.`)
