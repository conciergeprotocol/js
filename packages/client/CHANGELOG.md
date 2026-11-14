# @conciergeprotocol/client

## 0.2.1

## 0.2.0

### Minor Changes

- 3da0590: A done reply may include an optional `items` array and an `as_of` time. `answer` can return them, malformed items are dropped, and the help text says the door supports the extension. The client sends `accept: ['items']` when asked and returns the items on the message. The MCP server asks for items and passes them through.

## 0.1.6

### Patch Changes

- 622ca03: Discover follows an https redirect from /agent.txt, and when that file is missing, a homepage Link header or link rel="agent". cap_discover reports where the door was found.

## 0.1.5

## 0.1.4

### Patch Changes

- e72535b: A loopback address without a scheme, such as `127.0.0.1:4101` or `localhost:4101`, now reads `agent.txt` over http instead of https. Agents often pass the host without `http://`, and local front doors rarely have TLS.

## 0.1.3

### Patch Changes

- a6f1dc0: Publish the MCP registry name on the server package.

## 0.1.2

### Patch Changes

- b7b5445: Publish the READMEs, and make the MCP package depend on a real client version.

## 0.1.1

### Patch Changes

- a6af388: Add a README, homepage, and keywords so the npm page explains how to install and call a front door.
