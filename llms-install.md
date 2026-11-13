# Install Concierge Agent Protocol MCP

Node.js 18 or newer is required. No API key is required. Add this to the MCP settings file (`.cursor/mcp.json` in Cursor, the Claude Desktop config, or `.vscode/mcp.json` in VS Code).

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

`CAP_FROM` is optional. It must match `agent:` plus 1 to 64 letters, numbers, dots, underscores, or hyphens. When it is omitted, the server uses `agent:cap-mcp`.

Success: the client lists `cap_discover`, `cap_ask`, and `cap_check`.

There is no hosted URL. Do not clone the repo to install it.
