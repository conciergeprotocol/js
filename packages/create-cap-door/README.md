# create-cap-door

Give a website a [Concierge Agent Protocol](https://conciergeprotocol.org) door. AI agents ask it questions and get answers from the site's own pages, with a link to each page.

```sh
npx create-cap-door https://harborgoods.example
```

The command:

1. Follows the home page redirect, such as to `www.`, and uses that address. The door reads the home page, the pages it links to, and `sitemap.xml`. When `llms.txt` links to pages, the door reads it too.
2. Asks for an [AI Gateway](https://vercel.com/docs/ai-gateway) key, or reads `AI_GATEWAY_API_KEY`. The key is written only to `.env`. One short call checks the key. When a free tier key cannot use the default model (`anthropic/claude-sonnet-4.5`), the door uses `openai/gpt-5-mini`, then `google/gemini-2.5-flash`, and sets `CAP_MODEL`.
3. Writes a folder with `server.js`, `.env.example`, a `Dockerfile`, and a README. The server runs on [`@conciergeprotocol/agent`](https://www.npmjs.com/package/@conciergeprotocol/agent) and [`@conciergeprotocol/server`](https://www.npmjs.com/package/@conciergeprotocol/server).
4. Installs, starts the door, asks it one question, and runs the same checks as `cap-check`.
5. Prints how to publish `agent.txt` and the home page `<link rel="agent">` tag.

Node.js 22 or newer.

## Options

- `--dir <folder>` writes to that folder. The default is `{domain}-cap-door`.
- `--name <name>` sets the agent name. The default comes from the home page title.
- `--yes` skips the key prompt.
- `--no-install` writes the folder and stops.

## Limits

The door reads up to 50 pages when it starts. `CAP_DAILY_TOKENS` caps model tokens per UTC day and `CAP_DAILY_LIMIT` caps messages per caller per day. Messages are stored in `data/cap.sqlite`, so deploy to a host with a disk, or set `DATABASE_URL` to Postgres and install `pg`.

## License

Apache 2.0
