# Privacy

`@conciergeprotocol/mcp` runs on the caller's machine. It does not have an account system and it does not send the caller's keys anywhere.

A tool call sends the company domain, the question, an optional short context object, and the caller identity (`CAP_FROM`, default `agent:cap-mcp`) to that company's CAP front door over HTTPS. The company answers from its own systems. This package does not store the question or the reply.

Do not put a password, a payment card, or another site's private data in the message or the context.

Security reports: https://conciergeprotocol.org/security.md
