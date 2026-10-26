# Concierge Agent Protocol for JavaScript

Packages for both sides of a CAP front door. `@conciergeprotocol/client` calls a door. `@conciergeprotocol/mcp` exposes that client as three tools, so Claude, Cursor, and other MCP hosts can ask a company. `@conciergeprotocol/server` runs a door from one `answer` function. `@conciergeprotocol/agent` builds that function from a model, an `llms.txt` file, and MCP tools.

The protocol is at [conciergeprotocol.org](https://conciergeprotocol.org). A company publishes `agent.txt`. It does not publish an MCP server for visitors. An MCP server, when there is one, stays behind the door.

## Install

- [@conciergeprotocol/client](https://www.npmjs.com/package/@conciergeprotocol/client)
- [@conciergeprotocol/mcp](https://www.npmjs.com/package/@conciergeprotocol/mcp)
- [@conciergeprotocol/server](https://www.npmjs.com/package/@conciergeprotocol/server)
- [@conciergeprotocol/agent](https://www.npmjs.com/package/@conciergeprotocol/agent)

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

const answer = await cap.ask('example.com', 'Do you have a free plan?')
console.log(answer.reply)
```

A follow-up sends only the new question:

```js
const thread = cap.thread('example.com')
await thread.ask('What do you sell?')
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

`CAP_FROM` defaults to `agent:cap-mcp`. The tools are `cap_discover`, `cap_ask`, and `cap_check`. The server is listed in the MCP registry as `io.github.conciergeprotocol/mcp`. `cap_ask` waits 60 seconds. If the company is still answering, it returns the message id and the model calls `cap_check` instead of guessing.

## Run a door

`answer` is the company's own function. The server keeps the thread, hides one caller's reply from another, and enforces the daily message cap.

```js
import { createAnswer } from '@conciergeprotocol/agent'
import { createCapServer } from '@conciergeprotocol/server'

const answer = await createAnswer({
  model: 'anthropic/claude-sonnet-4.5',
  instructions: 'You answer for Harbor Goods. Link to the page.',
  sources: [{ type: 'llms', url: 'https://harborgoods.example/llms.txt' }],
})

const cap = await createCapServer({
  agent: { name: 'Harbor Goods', chat: 'https://harborgoods.example/chat' },
  answer,
})

await cap.listen(8088)
```

A company that already has a bot can skip the agent package and pass its own `answer`. `npx cap-check http://127.0.0.1:8088` reads `agent.txt`, asks one question, and checks that a second caller cannot read the reply.

## Release

Add a changeset, then merge to `main`:

```sh
bun run changeset
```

Package Checks runs on every push. When it passes on `main`, the publish workflow opens a version pull request, or publishes both packages and tags the release. The two packages stay on one version. When the npm publish succeeds, the same workflow lists the server in the MCP registry. The repository needs an `NPM_TOKEN` secret.

## License

Apache 2.0
