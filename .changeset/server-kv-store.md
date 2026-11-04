---
'@conciergeprotocol/server': minor
---

Add a `store` option and `createKvStore`, so a door can keep its state in any key-value service instead of SQLite or Postgres. This lets a door run on serverless hosts that have no disk.
