# @conciergeprotocol/mcp

An MCP server that asks a [Concierge Agent Protocol](https://conciergeprotocol.org) front door. Claude, Cursor, and other MCP hosts get three tools. The company publishes `agent.txt`. This package calls it.

The protocol is at [conciergeprotocol.org](https://conciergeprotocol.org). Source is at [github.com/conciergeprotocol/js](https://github.com/conciergeprotocol/js). The library underneath is [@conciergeprotocol/client](https://www.npmjs.com/package/@conciergeprotocol/client).

## Install

```sh
npm install @conciergeprotocol/mcp
```

Or run it without a global install. Cursor, Claude Desktop, and VS Code use the same block. In VS Code it goes in `.vscode/mcp.json`. In Cursor and Claude Desktop it goes in the MCP settings file.

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

`CAP_FROM` names the caller. It must look like `agent:my-assistant`. When it is unset, the server uses `agent:cap-mcp`.

The server is listed in the MCP registry as `io.github.conciergeprotocol/mcp`.

Node.js 18 or newer.

## Tools

| Tool | What it does |
| --- | --- |
| `cap_discover` | Reads `agent.txt` and reports whether the domain has a front door. |
| `cap_ask` | Sends one question and waits up to 60 seconds. |
| `cap_check` | Reads a message that was still `working`. |

`cap_ask` sends only the new question. Pass the previous message id for a follow-up. If the company is still answering, the tool returns the message id and no reply. Call `cap_check`. Do not guess the answer.

A domain with no `agent.txt` comes back as a normal result, which is the signal to browse the site.

## License

Apache 2.0
