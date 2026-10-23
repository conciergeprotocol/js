import assert from 'node:assert/strict'
import test from 'node:test'
import { CapError } from '@conciergeprotocol/client'
import { createTools } from '../src/tools.js'

const door = {
  protocol: 'CAP/1.0',
  name: 'Leo',
  chat: 'https://www.example.com/chat',
  cap: 'https://www.example.com/cap/v1',
  oauth: null,
  spec: null,
  origin: 'https://www.example.com',
  extra: {},
}

test('cap_discover reports a door and a missing door', async () => {
  const tools = createTools({
    discover: async (domain) => (domain === 'example.com' ? door : null),
  })
  assert.deepEqual(await tools.cap_discover({ domain: 'example.com' }), {
    door: true,
    name: 'Leo',
    chat: 'https://www.example.com/chat',
    login: false,
    found: 'agent.txt',
  })
  assert.deepEqual(await tools.cap_discover({ domain: 'example.net' }), { door: false })
  const linked = createTools({
    discover: async () => ({ ...door, source: 'link-header' }),
  })
  assert.equal((await linked.cap_discover({ domain: 'example.com' })).found, 'link-header')
})

test('cap_ask returns the reply and a conversation id', async () => {
  const tools = createTools({
    ask: async (_domain, message, options) => {
      assert.equal(message, 'Do you have a free plan?')
      assert.equal(options.previousMessageId, undefined)
      return { id: 'msg_1', status: 'done', reply: 'Yes. The free plan includes 3 projects.' }
    },
  })
  assert.deepEqual(await tools.cap_ask({ domain: 'example.com', message: 'Do you have a free plan?' }), {
    status: 'done',
    reply: 'Yes. The free plan includes 3 projects.',
    conversation_id: 'msg_1',
  })
})

test('cap_ask tells the model to check instead of guessing', async () => {
  const tools = createTools({
    ask: async () => ({ id: 'msg_2', status: 'working' }),
  })
  const result = await tools.cap_ask({ domain: 'example.com', message: 'Pricing?' })
  assert.equal(result.status, 'working')
  assert.match(result.message, /cap_check/)
  assert.equal(result.reply, undefined)
})

test('cap_ask says when there is no door', async () => {
  const { NoDoorError } = await import('@conciergeprotocol/client')
  const tools = createTools({
    ask: async () => { throw new NoDoorError('example.com') },
  })
  const result = await tools.cap_ask({ domain: 'example.com', message: 'Hours?' })
  assert.equal(result.door, false)
  assert.match(result.message, /Browse the site/)
})

test('cap_check reads a finished message', async () => {
  const tools = createTools({
    get: async () => ({ id: 'msg_3', status: 'done', reply: 'The shop opens at 9.' }),
  })
  assert.deepEqual(await tools.cap_check({ domain: 'harborgoods.example', message_id: 'msg_3' }), {
    status: 'done',
    reply: 'The shop opens at 9.',
    message_id: 'msg_3',
  })
})

test('tool errors stay CapErrors', async () => {
  const tools = createTools({
    get: async () => { throw new CapError('rate_limited', 429, 'Too many messages.') },
  })
  await assert.rejects(tools.cap_check({ domain: 'example.com', message_id: 'msg_3' }), CapError)
})
