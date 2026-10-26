import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { createAnswer } from '../src/index.js'

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

test('the reply is the model text, with the thread and the company rules', async () => {
  const calls = []
  const answer = await createAnswer({
    model: 'test',
    instructions: 'Harbor Goods sells shoes.',
    generate: async (args) => {
      calls.push(args)
      return { text: 'We are open Saturday.', totalUsage: { totalTokens: 15 } }
    },
  })
  const result = await answer({
    message: 'When are you open?',
    context: { city: 'Venice' },
    history: [{ message: 'What do you sell?', context: {}, reply: 'Shoes.' }],
    account: null,
    scope: null,
  })
  assert.deepEqual(result, { reply: 'We are open Saturday.' })
  assert.match(calls[0].system, /untrusted/)
  assert.match(calls[0].system, /Harbor Goods sells shoes/)
  assert.match(calls[0].system, /not signed in/)
  assert.equal(calls[0].messages.at(-1).content.includes('Venice'), true)
  assert.equal(calls[0].messages[1].content, 'Shoes.')
  assert.equal(typeof calls[0].stopWhen, 'function')
  await answer.close()
})

test('a write tool stays out until the grant allows it', async () => {
  const seen = []
  const answer = await createAnswer({
    model: 'test',
    executeWrites: true,
    tools: {
      search: { description: 'search' },
      refund: { write: true, tool: { description: 'refund' } },
    },
    generate: async (args) => {
      seen.push(Object.keys(args.tools).sort())
      return { text: 'Done.', totalUsage: { totalTokens: 1 } }
    },
  })
  await answer({ message: 'Find shoes', scope: 'read' })
  await answer({ message: 'Refund order 1', scope: 'write', account: 'maya' })
  assert.deepEqual(seen[0], ['search'])
  assert.deepEqual(seen[1], ['refund', 'search'])

  const locked = await createAnswer({
    model: 'test',
    tools: { refund: { write: true, tool: { description: 'refund' } } },
    generate: async (args) => {
      seen.push(Object.keys(args.tools || {}))
      return { text: 'No.', totalUsage: { totalTokens: 1 } }
    },
  })
  await locked({ message: 'Refund', scope: 'write' })
  assert.deepEqual(seen[2], [])
})

test('the daily token cap stops the next call', async () => {
  let n = 0
  const answer = await createAnswer({
    model: 'test',
    dailyTokens: 10,
    generate: async () => {
      n += 1
      return { text: 'ok', totalUsage: { totalTokens: 10 } }
    },
  })
  assert.equal((await answer({ message: 'one' })).reply, 'ok')
  const blocked = await answer({ message: 'two' })
  assert.equal(blocked.error.code, 'failed')
  assert.match(blocked.error.message, /token cap/)
  assert.equal(n, 1)
})

test('an llms.txt source can only read pages it lists', async () => {
  const server = createServer((req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`
    res.setHeader('content-type', 'text/plain')
    if (req.url === '/llms.txt') {
      res.end(`# Harbor\n\n- [Hours](${origin}/hours.md)\n`)
      return
    }
    if (req.url === '/hours.md') {
      res.end('Open Saturday 11 to 9.')
      return
    }
    res.statusCode = 200
    res.end('secret')
  })
  const port = await listen(server)
  const origin = `http://127.0.0.1:${port}`
  try {
    const answer = await createAnswer({
      model: 'test',
      sources: [{ type: 'llms', url: `${origin}/llms.txt` }],
      generate: async (args) => {
        const page = await args.tools.read_source.execute({ url: `${origin}/hours.md` })
        const blocked = await args.tools.read_source.execute({ url: `${origin}/admin` })
        return { text: `${page} ${blocked}`, totalUsage: { totalTokens: 3 } }
      },
    })
    const result = await answer({ message: 'Hours?' })
    assert.match(result.reply, /Open Saturday/)
    assert.match(result.reply, /not in the company sources/)
    assert.doesNotMatch(result.reply, /secret/)
    await answer.close()
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('an MCP source is namespaced and closed', async () => {
  let closed = false
  const answer = await createAnswer({
    model: 'test',
    sources: [{ type: 'mcp', name: 'docs', url: 'https://docs.example/mcp', headers: { authorization: 'Bearer secret' } }],
    connect: async (source) => {
      assert.equal(source.headers.authorization, 'Bearer secret')
      return {
        instructions: 'Search before you answer.',
        tools: async () => ({ search: { description: 'search docs' } }),
        close: async () => { closed = true },
      }
    },
    generate: async (args) => {
      assert.ok(args.tools.docs_search)
      assert.equal(args.tools.search, undefined)
      assert.match(args.system, /Search before you answer/)
      return { text: 'See the docs page.', totalUsage: { totalTokens: 2 } }
    },
  })
  assert.equal((await answer({ message: 'How do webhooks retry?' })).reply, 'See the docs page.')
  await answer.close()
  assert.equal(closed, true)
})

test('a model failure becomes a failed message', async () => {
  const answer = await createAnswer({
    model: 'test',
    generate: async () => { throw new Error('provider down, key sk-secret') },
  })
  const result = await answer({ message: 'Hi' })
  assert.equal(result.error.code, 'failed')
  assert.doesNotMatch(result.error.message, /sk-secret/)
})

test('model is required', async () => {
  await assert.rejects(() => createAnswer({}), /model/)
})
