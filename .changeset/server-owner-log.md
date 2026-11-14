---
"@conciergeprotocol/server": minor
"@conciergeprotocol/agent": minor
---

Add an owner log: pass `log: { secret }` to read recent questions, replies, counts, and model tokens at `/log`, behind Basic auth. The page has light, dark, and system themes. `createAnswer` now returns `usage: { input_tokens, output_tokens }`, which the server stores for the log and never sends to the caller.

Only a `Bearer` authorization header counts as account auth. Other schemes, such as the Basic login a browser resends after opening the log, no longer turn a public question into an account request.
