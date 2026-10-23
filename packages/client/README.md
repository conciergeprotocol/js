# @conciergeprotocol/client

Call a [Concierge Agent Protocol](https://conciergeprotocol.org) front door from JavaScript. Give it a domain. It reads `agent.txt`, posts one message, and waits for the company's reply.

The protocol is at [conciergeprotocol.org](https://conciergeprotocol.org). Source is at [github.com/conciergeprotocol/js](https://github.com/conciergeprotocol/js).

## Install

```sh
npm install @conciergeprotocol/client
```

Node.js 18 or newer.

## Ask

```js
import { createClient } from '@conciergeprotocol/client'

const cap = createClient({ from: 'agent:my-assistant' })

const answer = await cap.ask('example.com', 'Do you have a free plan?')
console.log(answer.reply)
```

`from` is `agent:` plus 1 to 64 letters, numbers, dots, underscores, or hyphens. It tells the company who is calling.

A follow-up sends only the new question. The company keeps the earlier turns.

```js
const thread = cap.thread('example.com')
await thread.ask('What do you sell?')
const price = await thread.ask('How much is the cheapest paid plan?')
```

## When there is no front door

`discover` returns `null`. `ask` throws `NoDoorError`. That is the signal to browse the site instead.

`discover` reads `https://{domain}/agent.txt`. A redirect may go to any https URL. When that file is missing, an HTML page, or has no `CAP` line, it reads the homepage and follows `Link: <url>; rel="agent"` or `<link rel="agent" href="url">` in the head. `door.origin` stays the company's domain. `door.source` is `redirect`, `link-header`, or `link-tag` when the file was not at the root.

```js
import { createClient, NoDoorError } from '@conciergeprotocol/client'

const cap = createClient({ from: 'agent:my-assistant' })

try {
  const answer = await cap.ask('example.com', 'What are your hours?')
  console.log(answer.reply)
} catch (error) {
  if (error instanceof NoDoorError) {
    // Browse the site.
  }
}
```

## Still working

`ask` waits up to two minutes. If the company is still answering, the message comes back with `status: 'working'` and no `reply`. Read it again with `get`. Do not write a reply while the status is `working`.

```js
const message = await cap.ask('example.com', 'What are your hours?')
if (message.status === 'working') {
  const later = await cap.get('example.com', message.id)
}
```

A `failed` message is a result, including `login_required`. It is not thrown.

## Account questions

`login` opens the company's page. `finishLogin` stores the token for that door, and the next `ask` sends it. Pass your own token store to `createClient` when the token should outlive the process.

```js
const cap = createClient({
  from: 'agent:my-assistant',
  tokens: {
    async get(origin) {},
    async set(origin, token) {},
    async delete(origin) {}
  }
})

await cap.login('example.com')
await cap.finishLogin(callbackUrl)
```

## License

Apache 2.0
