import assert from 'node:assert/strict'
import test from 'node:test'
import { CapError, NoDoorError, createClient } from '../src/index.js'

const AGENT = `Protocol: CAP/1.0
Name: Harbor Goods
Chat: https://harborgoods.example/chat
CAP: https://harborgoods.example/cap/v1
OAuth: https://harborgoods.example/oauth
Color: blue
`

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function textResponse(status, body, headers = {}) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain', ...headers },
  })
}

function client(handler, options = {}) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    return handler(calls.at(-1), calls)
  }
  return {
    calls,
    cap: createClient({
      from: 'agent:my-assistant',
      fetch: fetchImpl,
      sleep: options.sleep || (async () => {}),
      now: options.now || (() => 1_000_000),
      maxWaitMs: options.maxWaitMs ?? 120_000,
      tokens: options.tokens,
    }),
  }
}

test('discover uses http for a loopback address without a scheme', async () => {
  const local = AGENT.replaceAll('https://harborgoods.example', 'http://127.0.0.1:4101')
  const { cap, calls } = client(async () => textResponse(200, local))
  const door = await cap.discover('127.0.0.1:4101')
  assert.equal(calls[0].url, 'http://127.0.0.1:4101/agent.txt')
  assert.equal(door.cap, 'http://127.0.0.1:4101/cap/v1')
  const named = client(async () => textResponse(200, local))
  await named.cap.discover('localhost:4101')
  assert.equal(named.calls[0].url, 'http://localhost:4101/agent.txt')
})

test('rejects a CAP-From without the agent prefix', () => {
  assert.throws(() => createClient({ from: 'my-assistant' }), CapError)
})

test('discover reads agent.txt and keeps unknown keys', async () => {
  const { cap, calls } = client(async () => textResponse(200, AGENT))
  const door = await cap.discover('harborgoods.example')
  assert.equal(calls[0].url, 'https://harborgoods.example/agent.txt')
  assert.equal(door.name, 'Harbor Goods')
  assert.equal(door.cap, 'https://harborgoods.example/cap/v1')
  assert.equal(door.oauth, 'https://harborgoods.example/oauth')
  assert.equal(door.extra.color, 'blue')
  assert.equal(door.origin, 'https://harborgoods.example')
})

test('a file without a CAP line is no door', async () => {
  const { cap } = client(async () => textResponse(200, 'Name: Somewhere\n'))
  assert.equal(await cap.discover('example.com'), null)
})

test('an HTML body is no door', async () => {
  const { cap } = client(async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }))
  assert.equal(await cap.discover('example.com'), null)
})

test('a file over 16KB is no door', async () => {
  const { cap, calls } = client(async () => new Response('', { status: 200, headers: { 'content-length': '17000' } }))
  assert.equal(await cap.discover('example.com'), null)
  assert.equal(calls.length, 1)
})

test('a redirect off the site is no door', async () => {
  const { cap, calls } = client(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/agent.txt' } }))
  assert.equal(await cap.discover('example.com'), null)
  assert.equal(calls.length, 1)
})

test('a redirect to www on the same site is followed', async () => {
  const { cap, calls } = client(async ({ url }) => {
    if (url === 'https://cosmicjs.com/agent.txt') {
      return new Response(null, { status: 301, headers: { location: 'https://www.cosmicjs.com/agent.txt' } })
    }
    return textResponse(200, AGENT.replace('https://harborgoods.example/cap/v1', 'https://www.cosmicjs.com/cap/v1'))
  })
  const door = await cap.discover('cosmicjs.com')
  assert.equal(calls.length, 2)
  assert.equal(door.origin, 'https://www.cosmicjs.com')
  assert.equal(door.cap, 'https://www.cosmicjs.com/cap/v1')
})

test('ask posts the message and returns a done reply', async () => {
  const done = { id: 'msg_1', status: 'done', reply: 'Yes. There is a free plan.', created_at: '2026-10-18T00:00:00.000Z', finished_at: '2026-10-18T00:00:01.000Z' }
  const { cap, calls } = client(async ({ url }) => {
    if (url.endsWith('/agent.txt')) return textResponse(200, AGENT)
    return jsonResponse(200, done)
  })
  const answer = await cap.ask('harborgoods.example', 'Do you have a free plan?')
  assert.deepEqual(answer, done)
  const post = calls.find((call) => call.init.method === 'POST')
  assert.equal(post.url, 'https://harborgoods.example/cap/v1/messages')
  assert.equal(post.init.headers['cap-from'], 'agent:my-assistant')
  assert.equal(post.init.headers['cap-version'], '1.0')
  assert.equal(JSON.parse(post.init.body).message, 'Do you have a free plan?')
  assert.ok(post.init.headers['idempotency-key'])
})

test('ask follows 202 until the reply is done', async () => {
  let reads = 0
  const { cap, calls } = client(async ({ url, init }) => {
    if (url.endsWith('/agent.txt')) return textResponse(200, AGENT)
    if (init.method === 'POST') {
      return jsonResponse(202, { id: 'msg_2', status: 'working', created_at: '2026-10-18T00:00:00.000Z', finished_at: null, reply: 'not yet' }, { 'retry-after': '1' })
    }
    reads += 1
    if (reads === 1) return jsonResponse(202, { id: 'msg_2', status: 'working', created_at: '2026-10-18T00:00:00.000Z', finished_at: null }, { 'retry-after': '1' })
    return jsonResponse(200, { id: 'msg_2', status: 'done', reply: 'Black, size 12, in stock.', created_at: '2026-10-18T00:00:00.000Z', finished_at: '2026-10-18T00:00:03.000Z' })
  })
  const answer = await cap.ask('harborgoods.example', 'Running shoes in size 12')
  assert.equal(answer.status, 'done')
  assert.equal(answer.reply, 'Black, size 12, in stock.')
  assert.equal(calls.filter((call) => call.init.method === 'GET').length, 2)
})

test('ask returns a working message without inventing a reply when time runs out', async () => {
  let slept = false
  const { cap } = client(async ({ url }) => {
    if (url.endsWith('/agent.txt')) return textResponse(200, AGENT)
    return jsonResponse(202, { id: 'msg_3', status: 'working', reply: 'guess', created_at: '2026-10-18T00:00:00.000Z', finished_at: null }, { 'retry-after': '30' })
  }, { maxWaitMs: 1000, sleep: async () => { slept = true } })
  const answer = await cap.ask('harborgoods.example', 'Hours?')
  assert.equal(answer.status, 'working')
  assert.equal(answer.reply, undefined)
  assert.equal(slept, false)
})

test('a failed message is returned, including login_required', async () => {
  const failed = { id: 'msg_4', status: 'failed', error: { code: 'login_required', message: 'Log in to Harbor Goods to ask about your order.' }, created_at: '2026-10-18T00:00:00.000Z', finished_at: '2026-10-18T00:00:01.000Z' }
  const { cap } = client(async ({ url }) => url.endsWith('/agent.txt') ? textResponse(200, AGENT) : jsonResponse(200, failed))
  const answer = await cap.ask('harborgoods.example', "Where's my order?")
  assert.equal(answer.error.code, 'login_required')
})

test('ask throws NoDoorError when the site has no front door', async () => {
  const { cap } = client(async () => textResponse(404, 'missing'))
  await assert.rejects(cap.ask('example.com', 'Hello'), NoDoorError)
})

test('context rejects a password, a secret, or a token', async () => {
  const { cap, calls } = client(async () => textResponse(200, AGENT))
  await assert.rejects(cap.ask('harborgoods.example', 'Hi', { context: { password: 'nope' } }), (err) => err instanceof CapError && err.code === 'invalid_request')
  await assert.rejects(cap.ask('harborgoods.example', 'Hi', { context: { note: 'x'.repeat(5000) } }), CapError)
  assert.equal(calls.length, 0)
})

test('a thread sends only the new question, and starts over on 409', async () => {
  const bodies = []
  let posts = 0
  const { cap } = client(async ({ url, init }) => {
    if (url.endsWith('/agent.txt')) return textResponse(200, AGENT)
    posts += 1
    bodies.push(JSON.parse(init.body))
    if (posts === 1) return jsonResponse(200, { id: 'msg_a', status: 'done', reply: 'Cosmic is a CMS.', created_at: 't', finished_at: 't' })
    if (posts === 2) return jsonResponse(409, { error: { code: 'conflict', message: 'This thread is too long.' } })
    return jsonResponse(200, { id: 'msg_b', status: 'done', reply: 'The starter plan is free.', created_at: 't', finished_at: 't' })
  })
  const thread = cap.thread('harborgoods.example')
  await thread.ask('What is Cosmic?')
  const price = await thread.ask('How much is the cheapest paid plan?')
  assert.equal(price.reply, 'The starter plan is free.')
  assert.equal(thread.restarted, true)
  assert.equal(bodies[1].previous_message_id, 'msg_a')
  assert.equal(bodies[1].message, 'How much is the cheapest paid plan?')
  assert.equal(bodies[2].previous_message_id, undefined)
  assert.equal(bodies[2].message, 'How much is the cheapest paid plan?')
})

test('a thread forgets a missing message and throws', async () => {
  let posts = 0
  const { cap } = client(async ({ url, init }) => {
    if (url.endsWith('/agent.txt')) return textResponse(200, AGENT)
    posts += 1
    if (posts === 1) return jsonResponse(200, { id: 'msg_old', status: 'done', reply: 'Hi', created_at: 't', finished_at: 't' })
    if (posts === 2) return jsonResponse(404, { error: { code: 'not_found', message: 'That message is gone.' } })
    assert.equal(JSON.parse(init.body).previous_message_id, undefined)
    return jsonResponse(200, { id: 'msg_new', status: 'done', reply: 'Fresh', created_at: 't', finished_at: 't' })
  })
  const thread = cap.thread('harborgoods.example')
  await thread.ask('Hi')
  await assert.rejects(thread.ask('Still there?'), (err) => err instanceof CapError && err.code === 'not_found')
  const next = await thread.ask('Start again')
  assert.equal(next.reply, 'Fresh')
})

test('401 deletes the stored token', async () => {
  const store = new Map([['https://harborgoods.example', { accessToken: 'stale' }]])
  const tokens = {
    get: (origin) => store.get(origin),
    set: (origin, token) => store.set(origin, token),
    delete: (origin) => store.delete(origin),
  }
  const { cap, calls } = client(async ({ url }) => {
    if (url.endsWith('/agent.txt')) return textResponse(200, AGENT)
    return jsonResponse(401, { error: { code: 'unauthorized', message: 'Log in again.' } })
  }, { tokens })
  await assert.rejects(cap.ask('harborgoods.example', 'Orders?'), (err) => err instanceof CapError && err.code === 'unauthorized')
  assert.equal(store.size, 0)
  assert.equal(calls.find((call) => call.init.method === 'POST').init.headers.authorization, 'Bearer stale')
})

test('401 renews a refresh token once and retries', async () => {
  const store = new Map([['https://harborgoods.example', {
    accessToken: 'old',
    refreshToken: 'refresh',
    clientId: 'https://assistant.example/client.json',
    tokenEndpoint: 'https://harborgoods.example/oauth/token',
  }]])
  const tokens = {
    get: (origin) => store.get(origin),
    set: (origin, token) => store.set(origin, token),
    delete: (origin) => store.delete(origin),
  }
  const { cap, calls } = client(async ({ url, init }) => {
    if (url.endsWith('/agent.txt')) return textResponse(200, AGENT)
    if (url.endsWith('/oauth/token')) {
      return jsonResponse(200, { access_token: 'new', refresh_token: 'next', expires_in: 3600 })
    }
    if (init.headers.authorization === 'Bearer old') {
      return jsonResponse(401, { error: { code: 'unauthorized', message: 'Expired.' } })
    }
    return jsonResponse(200, { id: 'msg_9', status: 'done', reply: 'Shipped.', created_at: 't', finished_at: 't' })
  }, { tokens })
  const answer = await cap.ask('harborgoods.example', "Where's my order?")
  assert.equal(answer.reply, 'Shipped.')
  assert.equal(store.get('https://harborgoods.example').accessToken, 'new')
  assert.equal(calls.filter((call) => call.init.method === 'POST' && call.url.endsWith('/messages')).length, 2)
})

test('429 is retried once, then thrown', async () => {
  let posts = 0
  const { cap } = client(async ({ url }) => {
    if (url.endsWith('/agent.txt')) return textResponse(200, AGENT)
    posts += 1
    return jsonResponse(429, { error: { code: 'rate_limited', message: 'Too many messages.' } }, { 'retry-after': '1' })
  }, { maxWaitMs: 10_000 })
  await assert.rejects(cap.ask('harborgoods.example', 'Hi'), (err) => err instanceof CapError && err.code === 'rate_limited' && err.retryAfter === 1)
  assert.equal(posts, 2)
})

test('a dropped POST is retried with the same idempotency key', async () => {
  let posts = 0
  const keys = []
  const { cap } = client(async ({ url, init }) => {
    if (url.endsWith('/agent.txt')) return textResponse(200, AGENT)
    posts += 1
    keys.push(init.headers['idempotency-key'])
    if (posts === 1) throw new Error('socket hang up')
    return jsonResponse(200, { id: 'msg_10', status: 'done', reply: 'Recovered.', created_at: 't', finished_at: 't' })
  })
  const answer = await cap.ask('harborgoods.example', 'Hi')
  assert.equal(answer.reply, 'Recovered.')
  assert.equal(keys[0], keys[1])
})

test('get reads one message and does not poll', async () => {
  const { cap, calls } = client(async ({ url }) => {
    if (url.endsWith('/agent.txt')) return textResponse(200, AGENT)
    return jsonResponse(200, { id: 'msg_11', status: 'working', created_at: 't', finished_at: null }, { 'retry-after': '1' })
  })
  const message = await cap.get('harborgoods.example', 'msg_11')
  assert.equal(message.status, 'working')
  assert.equal(calls.filter((call) => call.init.method === 'GET').length, 1)
})

test('a missing door stays cached', async () => {
  const { cap, calls } = client(async () => textResponse(404, ''))
  assert.equal(await cap.discover('example.com'), null)
  assert.equal(await cap.discover('example.com'), null)
  assert.equal(calls.length, 1)
})

test('login opens the company page and stores the token from the redirect', async () => {
  const store = new Map()
  const tokens = {
    get: (origin) => store.get(origin),
    set: (origin, token) => store.set(origin, token),
    delete: (origin) => store.delete(origin),
  }
  let resolveOpened
  const opened = new Promise((resolve) => { resolveOpened = resolve })
  const { cap } = client(async ({ url, init }) => {
    if (url.endsWith('/agent.txt')) return textResponse(200, AGENT)
    if (url.includes('/.well-known/oauth-authorization-server/')) {
      return jsonResponse(200, {
        issuer: 'https://harborgoods.example/oauth',
        authorization_endpoint: 'https://harborgoods.example/oauth/authorize',
        token_endpoint: 'https://harborgoods.example/oauth/token',
        revocation_endpoint: 'https://harborgoods.example/oauth/revoke',
      })
    }
    const body = String(init.body)
    assert.match(body, /code_verifier=/)
    return jsonResponse(200, { access_token: 'cap_at', refresh_token: 'cap_rt', expires_in: 3600, scope: 'read' })
  }, { tokens })
  const pending = cap.login('harborgoods.example', {
    clientId: 'https://assistant.example/client.json',
    redirectUri: 'http://127.0.0.1/callback',
    open: (url) => resolveOpened(url),
  })
  const auth = new URL(await opened)
  assert.equal(auth.origin + auth.pathname, 'https://harborgoods.example/oauth/authorize')
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256')
  const token = await cap.finishLogin(`http://127.0.0.1/callback?code=abc&state=${auth.searchParams.get('state')}`)
  assert.equal(token.accessToken, 'cap_at')
  assert.equal(store.get('https://harborgoods.example').refreshToken, 'cap_rt')
  assert.equal((await pending).accessToken, 'cap_at')
})
