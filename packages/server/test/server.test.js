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

const form = (fields) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
})

const sessionFrom = ({ headers }) => {
  const match = /(?:^|;\s*)shop_session=([a-z]+)/.exec(headers.cookie || '')
  return match ? match[1] : null
}

async function startDevice(root) {
  const res = await fetch(`${root}/oauth/device`, form({ client_id: 'agent:visitor', scope: 'read' }))
  return res.json()
}

async function signedInPage(url, account) {
  const res = await fetch(url, { headers: { cookie: `shop_session=${account}` } })
  const html = await res.text()
  const token = /name="form_token" value="([^"]+)"/.exec(html)?.[1] || ''
  const formCookie = /cap_form=([^;]+)/.exec(res.headers.get('set-cookie') || '')?.[1] || ''
  return { html, token, formCookie }
}

test('a signed-in person approves a code login without a password', async () => {
  const { cap, root } = await start({
    agent: { name: 'Harbor Goods' },
    answer: async ({ account }) => (account ? `account ${account}` : 'public'),
    login: async () => null,
    currentAccount: sessionFrom,
  })
  try {
    const device = await startDevice(root)
    const page = await signedInPage(device.verification_uri_complete, 'maya')
    assert.match(page.html, /You are signed in/)
    assert.doesNotMatch(page.html, /name="password"/)
    assert.ok(page.token && page.formCookie)

    const approved = await fetch(`${root}/oauth/device/approve`, {
      ...form({ user_code: device.user_code, form_token: page.token, decision: 'allow' }),
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `shop_session=maya; cap_form=${page.formCookie}`,
      },
    })
    assert.equal(approved.status, 200)

    const token = await (await fetch(`${root}/oauth/token`, form({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: device.device_code,
      client_id: 'agent:visitor',
    }))).json()
    assert.ok(token.access_token)
    const reply = await post(root, 'my order', { authorization: `Bearer ${token.access_token}` })
    assert.equal(reply.body.reply, 'account maya')
  } finally {
    await cap.close()
  }
})

test('a signed-in approval needs the form cookie from the same site', async () => {
  const { cap, root } = await start({
    agent: { name: 'Harbor Goods' },
    answer: async () => 'ok',
    currentAccount: sessionFrom,
  })
  try {
    const device = await startDevice(root)
    const page = await signedInPage(device.verification_uri_complete, 'maya')
    const forged = await fetch(`${root}/oauth/device/approve`, {
      ...form({ user_code: device.user_code, form_token: page.token, decision: 'allow' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: 'shop_session=maya' },
    })
    assert.equal(forged.status, 401)
    const polled = await (await fetch(`${root}/oauth/token`, form({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: device.device_code,
      client_id: 'agent:visitor',
    }))).json()
    assert.equal(polled.error, 'authorization_pending')
  } finally {
    await cap.close()
  }
})

test('a confirm page signed in as another account asks for a login', async () => {
  const { cap, root } = await start({
    agent: { name: 'Harbor Goods' },
    answer: async () => ({ confirm: { summary: 'Cancel order 1.', authorization_details: [{ type: 'cancel' }] } }),
    write: true,
    act: async () => ({ message: 'Cancelled.' }),
    grants: [{ token: 'tok_write', account: 'maya', client: 'visitor', scope: 'write' }],
    currentAccount: sessionFrom,
  })
  try {
    const held = await post(root, 'cancel', { authorization: 'Bearer tok_write' })
    const url = held.body.confirmation.url
    const other = await signedInPage(url, 'sam')
    assert.equal(other.token, '')
    assert.match(other.html, /name="password"/)
    const owner = await signedInPage(url, 'maya')
    assert.ok(owner.token)
    assert.match(owner.html, />Approve</)
  } finally {
    await cap.close()
  }
})

test('accountFor and requestApproval serve the owner\'s own account routes', async () => {
  const door = await createCapHandler({
    agent: { name: 'Harbor Goods' },
    answer: async () => 'ok',
    sqlitePath: ':memory:',
    write: true,
    act: async () => ({ message: 'Cancelled.' }),
    login: async () => null,
    grants: [
      { token: 'tok_read', account: 'maya', client: 'visitor' },
      { token: 'tok_write', account: 'maya', client: 'visitor', scope: 'write' },
    ],
  })
  const request = (token, from = 'agent:visitor') => new Request('https://harbor.example/api/orders', {
    headers: { authorization: `Bearer ${token}`, 'cap-from': from },
  })
  try {
    assert.deepEqual(await door.accountFor(request('tok_read')), { account: 'maya', scope: 'read', caller: 'visitor' })
    assert.equal(await door.accountFor(request('tok_read', 'agent:other')), null)
    assert.equal(await door.accountFor(request('nope')), null)
    assert.equal(await door.accountFor(new Request('https://harbor.example/api/orders')), null)

    const readOnly = await door.requestApproval(request('tok_read'), { summary: 'Cancel order 1.' })
    assert.equal(readOnly.error.code, 'write_required')
    const held = await door.requestApproval(request('tok_write'), { summary: 'Cancel order 1.', authorization_details: [{ type: 'cancel' }] })
    assert.equal(held.confirmation.status, 'pending')
    assert.match(held.confirmation.url, /^https:\/\/harbor\.example\/oauth\/confirm\?id=/)
  } finally {
    await door.close()
  }
})

test('agent.name and answer are required', async () => {
  await assert.rejects(() => createCapServer({ answer: async () => 'x' }), /agent\.name/)
  await assert.rejects(() => createCapServer({ agent: { name: 'Harbor' } }), /answer function/)
})
