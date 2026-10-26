# @conciergeprotocol/agent

Build the `answer` function for a [Concierge Agent Protocol](https://conciergeprotocol.org) front door. Give it a model and the company's sources. Pass the function to [`@conciergeprotocol/server`](https://www.npmjs.com/package/@conciergeprotocol/server).

The company's tools, keys, and records stay in this process. The visiting agent receives the reply text.

## Install

```sh
npm install @conciergeprotocol/agent @conciergeprotocol/server
```

Node.js 22 or newer.

## Answer from your own sources

```js
import { createAnswer } from '@conciergeprotocol/agent'
import { createCapServer } from '@conciergeprotocol/server'

const answer = await createAnswer({
  model: 'anthropic/claude-sonnet-4.5',
  instructions: 'You answer for Harbor Goods. Link to the page.',
  sources: [
    { type: 'llms', url: 'https://harborgoods.example/llms.txt' },
    {
      type: 'mcp',
      name: 'docs',
      url: 'https://harborgoods.example/mcp',
      headers: { authorization: `Bearer ${process.env.MCP_KEY}` },
    },
  ],
  tools: {
    inventory: inventoryTool,
  },
  maxSteps: 6,
  dailyTokens: 500_000,
})

const cap = await createCapServer({
  agent: { name: 'Harbor Goods', chat: 'https://harborgoods.example/chat' },
  answer,
})
await cap.listen(8088)
```

A string model is called through the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway). Set `AI_GATEWAY_API_KEY`, or pass a model object from a provider package to call that provider directly.

`sources` has two kinds:

- `llms` fetches an `llms.txt` file and lets the model read only the pages that file links to.
- `mcp` connects to an MCP server over HTTP. Its tools are prefixed with `name`, so a server tool `search` is `docs_search`. The header value stays on this side of the door.

`tools` are [AI SDK tools](https://ai-sdk.dev/docs/foundations/tools). A tool that changes something is wrapped so a read-only caller cannot run it:

```js
tools: {
  refund: { write: true, tool: refundTool },
}
```

Write tools are included when `executeWrites` is true and the CAP grant's `scope` is `write`. Otherwise the model does not see them. Holding a change for a person's approval is done by the server: return `{ confirm }` from your own `answer` function. This package runs a write tool when you set `executeWrites`.

`maxSteps` counts model steps, including tool calls. `dailyTokens` is counted in this process and resets at UTC midnight. A restart clears the count. The server's `dailyLimit` is a separate cap on messages.

`answer.close()` closes MCP clients.

## What the reply contains

The function returns `{ reply }` with the model's text, or `{ error: { code: 'failed', message } }` when the model fails or the token cap is reached. Tool names, tool errors, and these instructions are not added to the reply. The prompt tells the model to leave them out.

The visitor message is treated as untrusted. It does not replace the instructions.

## License

Apache 2.0
