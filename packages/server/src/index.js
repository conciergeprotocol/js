import { join } from 'node:path'
import { createOAuth } from './oauth.mjs'
import { createCapServer as createNodeServer } from './node-server.mjs'
import { createStore } from './store.mjs'
import { handleWeb } from './web.mjs'

export { checkDoor } from './check.mjs'

/**
 * Run a CAP front door. `answer` is the only part that belongs to the company.
 * It receives `{ message, context, history, account, scope, caller }` and
 * returns a reply string, `{ reply }`, or `{ error: { code, message } }`.
 */
export async function createCapServer(options = {}) {
  const agent = normalizeAgent(options.agent)
  if (typeof options.answer !== 'function') throw new Error('createCapServer needs an answer function.')

  const sqlitePath = options.sqlitePath ?? process.env.SQLITE_PATH ?? join(process.cwd(), 'data', 'cap.sqlite')
  const databaseUrl = options.databaseUrl != null
    ? options.databaseUrl
    : (options.sqlitePath ? '' : (process.env.DATABASE_URL || ''))
  const store = await createStore({
    databaseUrl,
    sqlitePath: databaseUrl ? undefined : sqlitePath,
  })

  for (const grant of options.grants || []) {
    if (grant.token && grant.account && grant.client) {
      await store.upsertGrant({
        token: grant.token,
        account: grant.account,
        clientId: grant.client,
        scope: grant.scope === 'write' ? 'write' : 'read',
      })
    }
  }

  const oauth = options.login || options.currentAccount
    ? createOAuth({
      store,
      agentName: agent.name,
      login: options.login,
      currentAccount: options.currentAccount || null,
      write: Boolean(options.write),
      act: options.act || null,
      accessTokenSeconds: options.accessTokenSeconds ?? 3600,
      writeAccessTokenSeconds: options.writeAccessTokenSeconds ?? 900,
      allowHttpClients: Boolean(options.allowHttpClients),
      hint: options.hint || '',
      fetchImpl: options.fetch,
      deviceInterval: options.deviceInterval ?? 5,
    })
    : null

  const node = createNodeServer({
    store,
    agent,
    answer: normalizeAnswer(options.answer),
    waitMs: options.waitMs ?? (options.waitSeconds ?? 20) * 1000,
    retryAfter: options.retryAfter ?? 5,
    retentionHours: options.retentionHours ?? 24,
    dailyLimit: options.dailyLimit ?? 0,
    maxTurns: options.maxTurns ?? 20,
    oauth,
    publicUrl: options.publicUrl ?? process.env.PUBLIC_URL ?? '',
    extraRoutes: options.extraRoutes,
  })

  return {
    handle: node.handle,
    fetch(request) {
      return handleWeb(node.handle, request)
    },
    listen(port = Number(process.env.PORT || 8088), host = process.env.HOST || '0.0.0.0') {
      return new Promise((resolve, reject) => {
        node.server.once('error', reject)
        node.server.listen(port, host, () => {
          const address = node.server.address()
          resolve(address)
        })
      })
    },
    async close() {
      await new Promise((resolve) => node.server.close(resolve))
      await store.close()
    },
  }
}

/** Same server, as a Fetch handler for Next.js and other Web servers. */
export async function createCapHandler(options) {
  const cap = await createCapServer(options)
  return {
    handle: (request) => cap.fetch(request),
    close: () => cap.close(),
  }
}

function normalizeAgent(agent) {
  if (!agent?.name || typeof agent.name !== 'string') throw new Error('createCapServer needs agent.name.')
  return {
    name: agent.name,
    status: agent.status || 'active',
    chat: agent.chat || '',
    spec: agent.spec || '',
    oauth: agent.oauth || '',
  }
}

function normalizeAnswer(answer) {
  return async (input) => {
    const value = await answer(input)
    if (typeof value === 'string') return { reply: value }
    return value
  }
}
