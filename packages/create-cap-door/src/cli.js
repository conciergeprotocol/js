#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { checkDoor } from '@conciergeprotocol/server'
import { generateText } from 'ai'
import { DEFAULT_MODEL, canonicalOrigin, detectSources, normalizeUrl, pickModel, projectFiles, projectSlug, siteName, writeProject } from './scaffold.js'

const USAGE = `Usage: create-cap-door <website> [--dir <folder>] [--name <name>] [--yes] [--no-install]

Writes a CAP door that answers AI agents from the website, then runs it once
and asks it a question. Set AI_GATEWAY_API_KEY or paste the key when asked.`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: 'string' },
    name: { type: 'string' },
    yes: { type: 'boolean', short: 'y' },
    'no-install': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
})

if (values.help || !positionals[0]) {
  console.log(USAGE)
  process.exit(values.help ? 0 : 1)
}

try {
  await main()
} catch (err) {
  console.error(err.message)
  process.exit(1)
}

async function main() {
  const origin = await canonicalOrigin(normalizeUrl(positionals[0]))
  console.log(`Reading ${origin}`)
  const [sources, foundName] = await Promise.all([detectSources(origin), siteName(origin)])
  const name = values.name || foundName
  const llms = sources.find((source) => source.type === 'llms')
  console.log(llms ? `The door reads the site pages and ${llms.url}.` : 'The door reads the site pages.')

  const dir = resolve(values.dir || `${projectSlug(origin)}-cap-door`)
  const { dependencies } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const files = projectFiles({
    name,
    origin,
    sources,
    dependencies: {
      '@conciergeprotocol/agent': dependencies['@conciergeprotocol/agent'],
      '@conciergeprotocol/server': dependencies['@conciergeprotocol/server'],
    },
  })

  let key = process.env.AI_GATEWAY_API_KEY || ''
  if (!key && !values.yes && process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    key = (await rl.question('AI Gateway API key (Enter to skip, it is written only to .env): ')).trim()
    rl.close()
  }

  let model = null
  if (key) {
    process.env.AI_GATEWAY_API_KEY = key
    const picked = await pickModel(generateText)
    model = picked.model
    if (!model) console.error(`The model call failed: ${picked.error}`)
    else if (model !== DEFAULT_MODEL) console.log(`${DEFAULT_MODEL} is not available on this key, so the door uses ${model}.`)
  }

  writeProject(dir, files, {
    AI_GATEWAY_API_KEY: key,
    CAP_MODEL: model && model !== DEFAULT_MODEL ? model : '',
  })
  console.log(`Wrote ${dir}`)

  if (!model || values['no-install']) {
    if (key && !model) process.exitCode = 1
    printNext({ dir, origin, hasKey: Boolean(key), installed: false })
    return
  }

  const pm = packageManager()
  console.log(`Installing with ${pm}`)
  await run(pm, ['install'], dir)

  const port = await freePort()
  console.log(`Starting the door and asking it one question`)
  const child = spawn(process.execPath, ['server.js'], {
    cwd: dir,
    env: { ...process.env, AI_GATEWAY_API_KEY: key, CAP_MODEL: model, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  try {
    const door = `http://127.0.0.1:${port}`
    await waitForHealth(door, child)
    const result = await checkDoor(door, { message: `What does ${name} offer?`, timeoutMs: 60_000 })
    if (result.ok) {
      console.log('The door answered and passed the checks.')
    } else {
      for (const failure of result.failures) console.error(failure)
      process.exitCode = 1
    }
    printNext({ dir, origin, hasKey: true, installed: true })
  } finally {
    child.kill()
  }
}

function printNext({ dir, origin, hasKey, installed }) {
  const host = new URL(origin).host
  const steps = [`cd ${dir}`]
  if (!hasKey) steps.push('cp .env.example .env   # add AI_GATEWAY_API_KEY')
  if (!installed) steps.push('npm install')
  steps.push('npm start')
  console.log(`
Next:
${steps.map((step) => `  ${step}`).join('\n')}

Deploy the folder (Fly or Railway with a volume, or set DATABASE_URL), then set PUBLIC_URL.
Serve https://${host}/agent.txt with the text from your door's /agent.txt.
Add to the home page <head>:
  <link rel="agent" href="${origin}/agent.txt">
Check it at https://conciergeprotocol.org/check`)
}

function packageManager() {
  const agent = process.env.npm_config_user_agent || ''
  for (const pm of ['bun', 'pnpm', 'yarn']) if (agent.startsWith(pm)) return pm
  return 'npm'
}

function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolvePromise() : reject(new Error(`${command} ${args.join(' ')} failed.`))))
  })
}

function freePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePromise(port))
    })
  })
}

async function waitForHealth(door, child) {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('The door stopped before it started. See the error above.')
    const res = await fetch(`${door}/health`).catch(() => null)
    if (res?.ok) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
  }
  throw new Error('The door did not start within 90 seconds.')
}
