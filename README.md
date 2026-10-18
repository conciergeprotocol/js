# Concierge Agent Protocol for JavaScript

Two packages for calling a CAP front door. `@conciergeprotocol/client` is the library. `@conciergeprotocol/mcp` is that library behind three tools, so Claude, Cursor, and other MCP hosts can ask a company.

The protocol is at [conciergeprotocol.org](https://conciergeprotocol.org). These packages only call a front door. A company publishes `agent.txt`. It does not publish an MCP server.

## Install

- [@conciergeprotocol/client](https://www.npmjs.com/package/@conciergeprotocol/client)
- [@conciergeprotocol/mcp](https://www.npmjs.com/package/@conciergeprotocol/mcp)

```sh
npm install @conciergeprotocol/client
```

The MCP server is a command. Install it, or run it with `npx` as in the block below.

```sh
npm install @conciergeprotocol/mcp
```

## Client

```js
import { createClient } from '@conciergeprotocol/client'

const cap = createClient({ from: 'agent:my-assistant' })

const answer = await cap.ask('cosmicjs.com', 'Do you have a free plan?')
console.log(answer.reply)
```

A follow-up sends only the new question:

```js
const thread = cap.thread('cosmicjs.com')
await thread.ask('What is Cosmic?')
const price = await thread.ask('How much is the cheapest paid plan?')
```

`discover` returns `null` when a site has no front door. `ask` throws `NoDoorError` for the same case, which is the signal to browse the site instead.

`ask` waits up to two minutes. If the company is still answering, the message comes back with `status: 'working'` and no `reply`. `get` reads it again.

Account questions use `login`. The client opens the company's page, and `finishLogin` stores the token for the next `ask`. The token stays in the token store you pass to `createClient`.

## MCP

Cursor, Claude Desktop, and VS Code use the same block. In VS Code it goes in `.vscode/mcp.json`. In Cursor and Claude Desktop it goes in the MCP settings file.

```json
{
  "mcpServers": {
    "cap": {
      "command": "npx",
      "args": ["-y", "@conciergeprotocol/mcp"],
      "env": { "CAP_FROM": "agent:my-assistant" }
    }
  }
}
```

`CAP_FROM` defaults to `agent:cap-mcp`. The tools are `cap_discover`, `cap_ask`, and `cap_check`. `cap_ask` waits 60 seconds. If the company is still answering, it returns the message id and the model calls `cap_check` instead of guessing.

## Release

Same flow as the Cosmic packages. Add a changeset, then merge to `main`:

```sh
bun run changeset
```

Package Checks runs on every push. When it passes on `main`, the publish workflow opens a version pull request, or publishes both packages and tags the release. The two packages stay on one version. The repository needs an `NPM_TOKEN` secret.

## License

Apache 2.0
