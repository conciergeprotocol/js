import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'listing', 'concierge-agent-protocol.mcpb')
const stage = mkdtempSync(join(tmpdir(), 'cap-mcpb-'))
const serverDir = join(stage, 'server')
mkdirSync(serverDir)

const built = spawnSync(
  'bun',
  [
    'build',
    join(root, 'packages/mcp/src/index.js'),
    '--target',
    'node',
    '--format',
    'esm',
    '--outfile',
    join(serverDir, 'index.js'),
  ],
  { cwd: root, stdio: 'inherit' },
)
if (built.status !== 0) process.exit(built.status ?? 1)

const pkg = JSON.parse(readFileSync(join(root, 'packages/mcp/package.json'), 'utf8'))
writeFileSync(
  join(stage, 'package.json'),
  JSON.stringify({ type: 'module', version: pkg.version }, null, 2) + '\n',
)
cpSync(join(root, 'packages/mcp/mcpb/manifest.json'), join(stage, 'manifest.json'))
cpSync(join(root, 'listing/logo.png'), join(stage, 'icon.png'))

rmSync(out, { force: true })
const zipped = spawnSync('zip', ['-r', '-X', out, 'manifest.json', 'package.json', 'icon.png', 'server'], {
  cwd: stage,
  stdio: 'inherit',
})
rmSync(stage, { recursive: true, force: true })
if (zipped.status !== 0) process.exit(zipped.status ?? 1)
console.log(out)
