# @conciergeprotocol/server

## 0.4.0

### Minor Changes

- bb63b7f: Add a `store` option and `createKvStore`, so a door can keep its state in any key-value service instead of SQLite or Postgres. This lets a door run on serverless hosts that have no disk.

## 0.3.0

### Minor Changes

- 74c26ad: Add `accountFor(request)` and `requestApproval(request, input)`, so an owner's own JSON routes can accept the door's tokens. A hosted agent can answer public questions itself and fetch account data from those routes, and changes still wait for the person's approval.

## 0.2.0

### Minor Changes

- da15790: Add `currentAccount`. It reads the site's own session from the request, so a person who is already signed in approves a login or a held action with one click instead of typing a password. Signed-in approvals require a SameSite=Strict form cookie from the same site.

## 0.1.0

### Minor Changes

- 884ae9a: Add a server package that runs a CAP front door from one answer function, and an agent package that builds that function from a model, an llms.txt file, and MCP tools.
