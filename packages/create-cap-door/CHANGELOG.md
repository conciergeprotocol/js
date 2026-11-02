# create-cap-door

## 0.1.0

### Minor Changes

- 68d5579: Add a `site` source to `@conciergeprotocol/agent`. It reads a public website (the home page, the pages it links to, and `sitemap.xml`) and gives the model a search tool and a page reader that cite each page URL.

  Add `create-cap-door`. `npx create-cap-door <website>` writes a door project for the site, runs it once, asks it a question, and prints how to publish `agent.txt`.

### Patch Changes

- Updated dependencies [68d5579]
  - @conciergeprotocol/agent@0.2.0
