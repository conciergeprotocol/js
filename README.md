# Concierge Agent Protocol for JavaScript

Two packages for calling a CAP front door. `@conciergeprotocol/client` is the library. `@conciergeprotocol/mcp` is that library behind three tools, so Claude, Cursor, and other MCP hosts can ask a company.

The protocol is at [conciergeprotocol.org](https://conciergeprotocol.org). These packages only call a front door. A company publishes `agent.txt`. It does not publish an MCP server.

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

Both packages share one version. From a clean `main`:

```sh
node scripts/release.mjs 0.1.0
```

That sets the version, runs the tests, commits when the version changed, tags `v0.1.0`, and pushes the tag. GitHub then publishes `@conciergeprotocol/client` and `@conciergeprotocol/mcp`.

npm will not create a brand-new package from GitHub alone. Publish `0.1.0` once from a machine that is logged in (`npm login`, then `npm publish --access public --provenance=false` in each package after `node scripts/prepare-publish.mjs`). On each package, add a trusted publisher: organization `conciergeprotocol`, repository `js`, workflow `release.yml`. After that, a tag is enough and no npm token is stored. Until the trusted publisher is saved, add a repository secret named `NPM_TOKEN`.

## License

Apache 2.0
