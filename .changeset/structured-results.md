---
"@conciergeprotocol/server": minor
"@conciergeprotocol/client": minor
"@conciergeprotocol/mcp": minor
---

A done reply may include an optional `items` array and an `as_of` time. `answer` can return them, malformed items are dropped, and the help text says the door supports the extension. The client sends `accept: ['items']` when asked and returns the items on the message. The MCP server asks for items and passes them through.
