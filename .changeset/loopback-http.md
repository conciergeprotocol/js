---
"@conciergeprotocol/client": patch
---

A loopback address without a scheme, such as `127.0.0.1:4101` or `localhost:4101`, now reads `agent.txt` over http instead of https. Agents often pass the host without `http://`, and local front doors rarely have TLS.
