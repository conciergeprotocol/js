# @conciergeprotocol/server

## 0.6.0

### Minor Changes

- 3da0590: A done reply may include an optional `items` array and an `as_of` time. `answer` can return them, malformed items are dropped, and the help text says the door supports the extension. The client sends `accept: ['items']` when asked and returns the items on the message. The MCP server asks for items and passes them through.

### Patch Changes

- 5194307: `cap-check` reads the OAuth metadata when `agent.txt` has an `OAuth` line, and fails unless `issuer` matches that line and `protected_resources` lists the CAP URL.
- e69def6: The OAuth metadata lists the door's CAP URL in `protected_resources`. Visiting agents now log in only when it matches the `CAP` line in `agent.txt`.

## 0.5.0

### Minor Changes

- abdd785: `agent.txt` now includes the spec's fixed `Ask` line. A `GET` on `/cap/v1` or `/cap/v1/messages` returns the plain-text help with status 200 and no headers required. A public question can be asked with `GET /cap/v1/messages?from=agent:{id}&message=...` and read back with `?from=`, for agents that can only open URLs. A `GET` refuses a token, and the same question from the same agent within a minute is asked once.

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
