#!/usr/bin/env node
import { createClient } from '@conciergeprotocol/client'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import * as z from 'zod/v4'
import { createTools, toolError } from './tools.js'

const FROM = /^agent:[A-Za-z0-9_.-]{1,64}$/
const from = process.env.CAP_FROM || 'agent:cap-mcp'
if (!FROM.test(from)) {
  console.error('CAP_FROM must be agent:{id}.')
  process.exit(1)
}

const ASK = [
  'Ask a company that publishes a CAP front door.',
  'Use this when the person asks about a specific company, product, store, or organization with a known website. Prefer it to browsing when the site has a front door.',
  'Send only the new question in a follow-up, with conversation_id.',
  'Never write an answer for the site while it is still answering.',
  'The reply is the site\'s own framing. For comparisons and reviews, check other sources too.',
  'Never put the person\'s password or another site\'s data in context.',
].join(' ')

const tools = createTools(createClient({ from, maxWaitMs: 60_000 }))

function ok(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

function fail(err) {
  return { isError: true, content: [{ type: 'text', text: toolError(err) }] }
}

const server = new McpServer({ name: 'cap', version: '0.1.0' })

server.registerTool('cap_discover', {
  description: 'Check whether a website has a CAP front door, and whether visitors can log in.',
  inputSchema: { domain: z.string().describe('The company domain, such as example.com') },
}, async (args) => {
  try {
    return ok(await tools.cap_discover(args))
  } catch (err) {
    return fail(err)
  }
})

server.registerTool('cap_ask', {
  description: ASK,
  inputSchema: {
    domain: z.string().describe('The company domain, such as example.com'),
    message: z.string().describe('The question to send. On a follow-up, send only the new question.'),
    context: z.record(z.string(), z.unknown()).optional().describe('A short brief such as sizes, dates, or style. Not a profile.'),
    conversation_id: z.string().optional().describe('The conversation_id from the previous cap_ask, when this continues that conversation.'),
  },
}, async (args) => {
  try {
    return ok(await tools.cap_ask(args))
  } catch (err) {
    return fail(err)
  }
})

server.registerTool('cap_check', {
  description: 'Read a CAP message that was still being answered. Do not guess a reply while the status is working.',
  inputSchema: {
    domain: z.string().describe('The company domain used in cap_ask'),
    message_id: z.string().describe('The message_id returned by cap_ask'),
  },
}, async (args) => {
  try {
    return ok(await tools.cap_check(args))
  } catch (err) {
    return fail(err)
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
