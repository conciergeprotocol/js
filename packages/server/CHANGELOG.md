# @conciergeprotocol/server

## 0.2.0

### Minor Changes

- da15790: Add `currentAccount`. It reads the site's own session from the request, so a person who is already signed in approves a login or a held action with one click instead of typing a password. Signed-in approvals require a SameSite=Strict form cookie from the same site.

## 0.1.0

### Minor Changes

- 884ae9a: Add a server package that runs a CAP front door from one answer function, and an agent package that builds that function from a model, an llms.txt file, and MCP tools.
