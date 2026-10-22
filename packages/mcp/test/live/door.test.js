import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const serverPath = join(dirname(fileURLToPath(import.meta.url)), '../../src/index.js')

function startServer() {
  const child = spawn(process.execPath, [serverPath], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, CAP_FROM: 'agent:cap-live-test' },
  })
  let buf = ''
  const pending = new Map()
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString()
    let idx
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx)
      buf = buf.slice(idx + 1)
      if (!line.trim()) continue
      const body = JSON.parse(line)
      if (body.id != null && pending.has(body.id)) pending.get(body.id)(body)
    }
  })
  let next = 1
  const send = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`)
  const request = (method, params) => {
    const id = next++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), 75_000)
      pending.set(id, (msg) => {
        clearTimeout(timer)
        pending.delete(id)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      })
      send({ jsonrpc: '2.0', id, method, params })
    })
  }
  return {
    request,
    notify(method) {
      send({ jsonrpc: '2.0', method })
    },
    stop() {
      child.kill()
    },
  }
}

function text(result) {
  const block = result?.content?.find((item) => item.type === 'text')
  assert.equal(typeof block?.text, 'string')
  return JSON.parse(block.text)
}

// The live check asks a real front door. Set CAP_LIVE_DOMAIN to the domain to ask.
const domain = process.env.CAP_LIVE_DOMAIN

test('the server can ask a live front door', { timeout: 90_000, skip: domain ? false : 'CAP_LIVE_DOMAIN is not set' }, async () => {
  const server = startServer()
  try {
    await server.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'cap-live-test', version: '0.0.0' },
    })
    server.notify('notifications/initialized')

    const discovered = text(await server.request('tools/call', {
      name: 'cap_discover',
      arguments: { domain },
    }))
    assert.equal(discovered.door, true)
    assert.equal(typeof discovered.name, 'string')
    assert.match(discovered.chat, /^https:\/\//)

    const asked = text(await server.request('tools/call', {
      name: 'cap_ask',
      arguments: { domain, message: 'What do you do, in one sentence?' },
    }))
    assert.equal(asked.status, 'done')
    assert.equal(typeof asked.reply, 'string')
    assert.ok(asked.reply.length > 40)
    assert.match(asked.conversation_id, /^msg_/)
  } finally {
    server.stop()
  }
})
