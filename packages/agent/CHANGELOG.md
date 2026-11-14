# @conciergeprotocol/agent

## 0.3.0

### Minor Changes

- 9b94ea4: Add an owner log: pass `log: { secret }` to read recent questions, replies, counts, and model tokens at `/log`, behind Basic auth. The page has light, dark, and system themes. `createAnswer` now returns `usage: { input_tokens, output_tokens }`, which the server stores for the log and never sends to the caller.

  Only a `Bearer` authorization header counts as account auth. Other schemes, such as the Basic login a browser resends after opening the log, no longer turn a public question into an account request.

## 0.2.0

### Minor Changes

- 68d5579: Add a `site` source to `@conciergeprotocol/agent`. It reads a public website (the home page, the pages it links to, and `sitemap.xml`) and gives the model a search tool and a page reader that cite each page URL.

  Add `create-cap-door`. `npx create-cap-door <website>` writes a door project for the site, runs it once, asks it a question, and prints how to publish `agent.txt`.

## 0.1.0

### Minor Changes

- 884ae9a: Add a server package that runs a CAP front door from one answer function, and an agent package that builds that function from a model, an llms.txt file, and MCP tools.
