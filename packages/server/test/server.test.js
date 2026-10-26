import assert from 'node:assert/strict'
import test from 'node:test'
import { checkDoor, createCapHandler, createCapServer } from '../src/index.js'

const headers = (extra = {}) => ({
  'content-type': 'application/json',
  'cap-version': '1.0',
  'cap-from': 'agent:visitor',
  ...extra,
})

async function post(root, message, extra = {}, body = {}) {
  const res = await fetch(`${root}/cap/v1/messages`, {
    method: 'POST',
    headers: headers(extra),
    body: JSON.stringify({ message, ...body }),
  })
  const text = await res.text()
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null }
}

async function start(options) {
  const cap = await createCapServer({ sqlitePath: ':memory:', retryAfter: 0, ...options })
  const address = await cap.listen(0, '127.0.0.1')
  return { cap, root: `http://127.0.0.1:${address.port}` }
}

test('answer function is the door', async () => {
  const seen = []
  const { cap, root } = await start({
    agent: { name: 'Harbor Goods', chat: 'https://harborgoods.example/chat' },
    answer: async (input) => {
      seen.push(input)
      return `Open Saturday. You said: ${input.message}`
    },
  })
  try {
    const card = await fetch(`${root}/agent.txt`)
    const text = await card.text()
    assert.equal(card.status, 200)
    assert.match(text, /^Protocol: CAP\/1\.0\n/)
    assert.match(text, /Name: Harbor Goods/)
    assert.match(text, new RegExp(`CAP: ${root}/cap/v1`))
    assert.doesNotMatch(text, /OAuth:/)

    const first = await post(root, 'When are you open?', {}, { context: { city: 'Venice' } })
    assert.equal(first.status, 200)
    assert.equal(first.body.status, 'done')
    assert.match(first.body.reply, /Open Saturday/)
    assert.equal(seen[0].context.city, 'Venice')
    assert.equal(seen[0].caller, 'visitor')
    assert.equal(seen[0].account, null)

    const follow = await post(root, 'And Sunday?', {}, { previous_message_id: first.body.id })
    assert.equal(follow.body.status, 'done')
    assert.equal(seen[1].history.length, 1)
    assert.match(seen[1].history[0].message, /open/)

    const other = await fetch(`${root}/cap/v1/messages/${first.body.id}`, {
      headers: headers({ 'cap-from': 'agent:other' }),
    })
    assert.equal(other.status, 404)
  } finally {
    await cap.close()
  }
})

test('a slow answer is 202, then the reply, and stays hidden', async () => {
  const { cap, root } = await start({
    agent: { name: 'Harbor Goods' },
    waitMs: 20,
    answer: async () => {
      await new Promise((resolve) => setTimeout(resolve, 60))
      return { reply: 'Size 12 is in stock.' }
    },
  })
  try {
    const pending = await post(root, 'Do you have size 12?')
    assert.equal(pending.status, 202)
    assert.equal(pending.body.status, 'working')
    assert.equal(pending.body.reply, undefined)
    const id = pending.body.id
    let done = null
    for (let i = 0; i < 20; i += 1) {
      const res = await fetch(`${root}/cap/v1/messages/${id}`, { headers: headers() })
      done = await res.json()
      if (done.status !== 'working') break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(done.status, 'done')
    assert.equal(done.reply, 'Size 12 is in stock.')
  } finally {
    await cap.close()
  }
})

test('daily limit and a failed answer', async () => {
  const { cap, root } = await start({
    agent: { name: 'Harbor Goods' },
    dailyLimit: 1,
    answer: async () => {
      throw new Error('boom')
    },
  })
  try {
    const failed = await post(root, 'Hi')
    assert.equal(failed.status, 200)
    assert.equal(failed.body.status, 'failed')
    assert.equal(failed.body.error.code, 'failed')
    const limited = await post(root, 'Again')
    assert.equal(limited.status, 429)
    assert.equal(limited.body.error.code, 'rate_limited')
  } finally {
    await cap.close()
  }
})

test('login_required is the company answer, not a transport error', async () => {
  const { cap, root } = await start({
    agent: { name: 'Harbor Goods' },
    answer: async ({ account }) => {
      if (!account) return { error: { code: 'login_required', message: 'Log in to your account to ask about it.' } }
      return 'Your order shipped.'
    },
  })
  try {
    const res = await post(root, 'Where is my order?')
    assert.equal(res.body.status, 'failed')
    assert.equal(res.body.error.code, 'login_required')
  } finally {
    await cap.close()
  }
})

test('fetch handler serves the same door', async () => {
  const door = await createCapHandler({
    sqlitePath: ':memory:',
    agent: { name: 'Harbor Goods' },
    answer: async ({ message }) => `Echo ${message}`,
  })
  try {
    const res = await door.handle(new Request('https://harborgoods.example/cap/v1/messages', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ message: 'Hours?' }),
    }))
    const body = await res.json()
    assert.equal(res.status, 200)
    assert.equal(body.reply, 'Echo Hours?')
  } finally {
    await door.close()
  }
})

test('checkDoor accepts a live door and rejects a missing file', async () => {
  const { cap, root } = await start({
    agent: { name: 'Harbor Goods' },
    answer: async () => 'We sell running shoes.',
  })
  try {
    const ok = await checkDoor(root, { message: 'What do you sell?' })
    assert.deepEqual(ok.failures, [])
    assert.equal(ok.ok, true)
    const missing = await checkDoor('http://127.0.0.1:9')
    assert.equal(missing.ok, false)
  } finally {
    await cap.close()
  }
})

test('login adds the OAuth line', async () => {
  const { cap, root } = await start({
    agent: { name: 'Harbor Goods' },
    answer: async () => 'ok',
    login: async () => null,
  })
  try {
    const text = await (await fetch(`${root}/agent.txt`)).text()
    assert.match(text, new RegExp(`OAuth: ${root}/oauth`))
  } finally {
    await cap.close()
  }
})

test('agent.name and answer are required', async () => {
  await assert.rejects(() => createCapServer({ answer: async () => 'x' }), /agent\.name/)
  await assert.rejects(() => createCapServer({ agent: { name: 'Harbor' } }), /answer function/)
})
