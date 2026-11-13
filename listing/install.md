# Install

This block matches the root README and `packages/mcp/README.md`. The registry name is `io.github.conciergeprotocol/mcp`. The npm package is `@conciergeprotocol/mcp` at 0.2.0. There is no hosted URL.

```bash
npx -y @conciergeprotocol/mcp
```

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

`CAP_FROM` must look like `agent:my-assistant`. When it is unset, the server uses `agent:cap-mcp`.
