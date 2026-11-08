---
"@conciergeprotocol/server": minor
---

`agent.txt` now includes the spec's fixed `Ask` line. A `GET` on `/cap/v1` or `/cap/v1/messages` returns the plain-text help with status 200 and no headers required. A public question can be asked with `GET /cap/v1/messages?from=agent:{id}&message=...` and read back with `?from=`, for agents that can only open URLs. A `GET` refuses a token, and the same question from the same agent within a minute is asked once.
