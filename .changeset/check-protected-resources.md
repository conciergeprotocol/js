---
"@conciergeprotocol/server": patch
---

`cap-check` reads the OAuth metadata when `agent.txt` has an `OAuth` line, and fails unless `issuer` matches that line and `protected_resources` lists the CAP URL.
