# Concierge Agent Protocol

One-liner (62 characters):

Ask a company through its Concierge Agent Protocol front door.

## Short

MCP server that asks a company's CAP front door. Three tools: discover whether a site has a door, ask one question, and check a reply that is still in progress.

## Long

`@conciergeprotocol/mcp` lets Claude, Cursor, and other MCP hosts ask a company that publishes a Concierge Agent Protocol front door (`agent.txt`). `cap_discover` checks the domain. `cap_ask` sends one question and waits up to 60 seconds. `cap_check` reads a reply that was still being written. The company's own tools and keys stay behind the door. The caller only receives the reply. The server is stdio only. Install it with `npx -y @conciergeprotocol/mcp`. The registry name is `io.github.conciergeprotocol/mcp`.
