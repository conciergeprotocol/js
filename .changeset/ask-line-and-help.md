---
"@conciergeprotocol/server": minor
---

`agent.txt` now includes the `Ask` line, and a `GET` on `/cap/v1` or `/cap/v1/messages` returns the plain-text help with status 200 and no headers required. Agents that do not know CAP were reading `agent.txt`, opening the CAP URL, and going back to reading the site.
