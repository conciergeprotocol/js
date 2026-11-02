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

function siteServer(routes) {
  const server = createServer((req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`
    const route = routes[req.url]
    if (!route) {
      res.statusCode = 404
      res.end('missing')
      return
    }
    res.setHeader('content-type', route.type || 'text/html')
    res.end(route.body.replaceAll('ORIGIN', origin))
  })
  return server
}

test('a site source reads the sitemap and cites each page', async () => {
  const server = siteServer({
    '/': { body: '<html><head><title>Harbor Goods</title></head><body><nav>Menu Returns Hours</nav><h1>Shoes for the coast</h1></body></html>' },
    '/sitemap.xml': { type: 'application/xml', body: '<urlset><url><loc>ORIGIN/returns</loc></url><url><loc>ORIGIN/hours</loc></url><url><loc>https://elsewhere.example/x</loc></url><url><loc>ORIGIN/logo.png</loc></url></urlset>' },
    '/returns': { body: '<html><head><title>Returns</title></head><body><p>Return unworn shoes within 30 days &amp; get a full refund.</p><script>secret()</script></body></html>' },
    '/hours': { body: '<html><head><title>Hours</title></head><body><p>Open Saturday 11 to 9.</p></body></html>' },
  })
  const port = await listen(server)
  const origin = `http://127.0.0.1:${port}`
  try {
    let tools
    const answer = await createAnswer({
      model: 'test',
      sources: [{ type: 'site', url: `${origin}/` }],
      generate: async (args) => {
        tools = args.tools
        return { text: 'ok', totalUsage: { totalTokens: 1 } }
      },
    })
    await answer({ message: 'Returns?' })
    assert.deepEqual(Object.keys(tools).sort(), ['site_read', 'site_search'])
    assert.match(tools.site_search.description, /3 pages/)

    const found = await tools.site_search.execute({ query: 'What is the return policy?' })
    assert.match(found.split('\n\n')[0], /^Returns\n.*\/returns\n.*30 days & get a full refund/)
    assert.doesNotMatch(found, /secret/)

    const page = await tools.site_read.execute({ url: `${origin}/hours/` })
    assert.match(page, /Open Saturday 11 to 9/)
    assert.match(await tools.site_read.execute({ url: 'https://elsewhere.example/x' }), /not in the company sources/)
    assert.match(await tools.site_search.execute({ query: 'parking' }), /No page matched/)

    const home = await tools.site_read.execute({ url: `${origin}/` })
    assert.doesNotMatch(home, /Menu/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('a site without a sitemap is read from the home page links', async () => {
  const server = siteServer({
    '/': { body: '<html><body><a href="/faq">FAQ</a><a href="https://elsewhere.example/">Out</a><a href="#top">Top</a></body></html>' },
    '/faq': { body: '<html><head><title>FAQ</title></head><body><p>We ship to Canada.</p></body></html>' },
  })
  const port = await listen(server)
  const origin = `http://127.0.0.1:${port}`
  try {
    let tools
    const answer = await createAnswer({
      model: 'test',
      sources: [{ type: 'site', name: 'harbor', url: origin }],
      generate: async (args) => {
        tools = args.tools
        return { text: 'ok', totalUsage: { totalTokens: 1 } }
      },
    })
    await answer({ message: 'Shipping?' })
    assert.match(await tools.harbor_search.execute({ query: 'ship Canada' }), /FAQ\n.*\/faq/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('a site that cannot be read stops createAnswer', async () => {
  await assert.rejects(
    () => createAnswer({ model: 'test', sources: [{ type: 'site', url: 'http://127.0.0.1:9/' }] }),
    /Could not read/,
  )
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

test('a model failure becomes a failed message, and the owner sees the cause', async () => {
  const logged = []
  const answer = await createAnswer({
    model: 'test',
    generate: async () => { throw new Error('provider down, key sk-secret') },
    onError: (err) => logged.push(err.message),
  })
  const result = await answer({ message: 'Hi' })
  assert.equal(result.error.code, 'failed')
  assert.doesNotMatch(result.error.message, /sk-secret/)
  assert.deepEqual(logged, ['provider down, key sk-secret'])
})

test('model is required', async () => {
  await assert.rejects(() => createAnswer({}), /model/)
})
