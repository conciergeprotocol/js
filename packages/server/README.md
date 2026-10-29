# @conciergeprotocol/server

Run a [Concierge Agent Protocol](https://conciergeprotocol.org) front door. You write one function, `answer`. The package serves `agent.txt`, keeps the thread, hides one caller's reply from another, and enforces the daily message cap.

The protocol is at [conciergeprotocol.org](https://conciergeprotocol.org). Publishing a door is described in [Publish a door](https://conciergeprotocol.org/publish).

## Install

```sh
npm install @conciergeprotocol/server
```

Node.js 22 or newer. Messages are stored in SQLite. Set `DATABASE_URL` to a Postgres connection string to use Postgres, and install `pg`.

## Answer

`answer` receives the question and returns the reply. A string, or `{ reply }`. Keys, tools, and records stay inside this function. The caller only sees the reply.

```js
import { createCapServer } from '@conciergeprotocol/server'

const cap = await createCapServer({
  agent: { name: 'Harbor Goods', chat: 'https://harborgoods.example/chat' },
  answer: async ({ message, context, history }) => {
    const res = await fetch('https://support.example/api/ask', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.SUPPORT_BOT_KEY}`,
      },
      body: JSON.stringify({ question: message, brief: context, history }),
    })
    if (!res.ok) return { error: { code: 'failed', message: 'The agent could not answer.' } }
    const { text } = await res.json()
    return { reply: text }
  },
})

await cap.listen(8088)
```

`history` is the earlier turns, oldest first. The caller sends `previous_message_id` and does not resend them. `context` is the optional brief from the visiting agent. `account` and `scope` are null until someone logs in.

Return `{ error: { code: 'login_required', message: '...' } }` when the question needs an account. While a message is still running, the caller gets `202` and no reply.

The server waits `waitSeconds` (default 20). A longer answer finishes in the background. `dailyLimit` caps messages per caller per UTC day. `0` turns the cap off. Finished messages stay readable for `retentionHours` (default 24).

Without `sqlitePath` or `DATABASE_URL`, messages go to `data/cap.sqlite` in the working directory. Pass `sqlitePath: ':memory:'` for a process that keeps nothing.

## The file on the company domain

This process can run on any host. The company domain still serves `agent.txt`. Point `CAP` at this server, or rewrite `/cap/v1` to it. Set `publicUrl` when the public origin differs from the request host.

```text
Protocol: CAP/1.0
Name: Harbor Goods
Chat: https://harborgoods.example/chat
CAP: https://cap.harborgoods.example/cap/v1
Spec: https://conciergeprotocol.org/cap.txt
```

Check it:

```sh
npx cap-check https://cap.harborgoods.example
```

`cap-check` reads `agent.txt`, asks one question, and confirms a second caller cannot read the reply.

## Next.js

`createCapHandler` returns a Fetch handler. Use a durable store (`sqlitePath` on a disk, or `databaseUrl`). A memory store loses an in-flight answer when the function instance stops.

```js
import { createCapHandler } from '@conciergeprotocol/server'
import { answer } from './answer.js'

const door = await createCapHandler({
  agent: { name: 'Harbor Goods' },
  answer,
  databaseUrl: process.env.DATABASE_URL,
})

export const GET = (request) => door.handle(request)
export const POST = (request) => door.handle(request)
export const OPTIONS = (request) => door.handle(request)
```

Serve `agent.txt` from the company domain. The handler above also serves it at `/agent.txt` on this app.

## Log in

Pass `login` to turn on the built-in OAuth server. It adds the `OAuth` line to `agent.txt`. `login` checks the company's own user store and returns an account id, or null.

```js
const cap = await createCapServer({
  agent: { name: 'Harbor Goods' },
  answer,
  login: async ({ username, password }) => verifyUser(username, password),
})
```

With a token, `answer` receives `account` and `scope` (`read` or `write`). A token sent by a different agent is `403`.

If people are usually signed in to your site already, pass `currentAccount` too. It reads your own session from the request headers and returns the account id, or null. When it finds one, the login and confirm pages show only Allow or Approve. Without a session, they fall back to `login`. A confirm page asks for a login when the session is for a different account than the request.

```js
const cap = await createCapServer({
  agent: { name: 'Harbor Goods' },
  answer,
  login: async ({ username, password }) => verifyUser(username, password),
  currentAccount: async ({ headers }) => accountFromSessionCookie(headers.cookie),
})
```

Serve `/oauth` on the same origin as your sign-in, so your session cookie reaches it. A signed-in approval also needs a `SameSite=Strict` cookie the page sets, so a form on another site cannot submit it.

To hold a change for the person's approval, return `{ confirm: { summary, authorization_details }, reply }` instead of running it. After they approve, the server calls `act` once.

## Account routes

Another agent can call your own JSON routes with the same token, for example a hosted agent that answers public questions itself and fetches account data from you. `accountFor(request)` checks the bearer token against the agent in `CAP-From` and returns `{ account, scope, caller }`, or null. Filter every query by `account`.

```js
export async function GET(request) {
  const access = await door.accountFor(request)
  if (!access) return Response.json({ error: { code: 'login_required' } }, { status: 401 })
  return Response.json({ account: access.account, orders: await ordersFor(access.account) })
}
```

`requestApproval(request, { summary, authorization_details })` holds a change for the person's OK and returns `{ confirmation: { id, url, summary } }`. It needs a write login and `act`, which runs once after approval.

## cap.json

`cap-server` reads `cap.json` from the working directory, or `CAP_CONFIG`. The same file the reference server uses:

```json
{
  "agent": { "name": "Harbor Goods", "chat": "https://harborgoods.example/chat" },
  "handler": { "type": "http", "url": "https://support.example/cap-hook" },
  "daily_limit": 500
}
```

`static` returns fixed text. `echo` returns the message. `http` POSTs `{ message, context, history, account, scope }` to a URL and expects `{ "reply": "..." }`. Set `handler.secret_env` to send that environment variable as `X-Cap-Secret`.

```sh
npx cap-server
```

The HTTP, storage, and OAuth modules match the reference server in the protocol repository. A spec change belongs in both places.

## License

Apache 2.0
