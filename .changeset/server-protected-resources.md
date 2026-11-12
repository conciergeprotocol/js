---
"@conciergeprotocol/server": patch
---

The OAuth metadata lists the door's CAP URL in `protected_resources`. Visiting agents now log in only when it matches the `CAP` line in `agent.txt`.
