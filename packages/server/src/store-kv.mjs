import { createHash } from 'node:crypto'
import { tokenHash } from './store.mjs'

/**
 * A door store over any key-value service: `get(key)`, `set(key, value)`, and
 * `delete(key)`, with JSON values. Use it where the server has no disk, such as
 * serverless hosting. Lookups that read once and delete are not atomic here, so
 * two requests racing on the same code can both win.
 */
export function createKvStore(kv) {
  for (const name of ['get', 'set', 'delete']) {
    if (typeof kv?.[name] !== 'function') throw new Error(`createKvStore needs kv.${name}.`)
  }
  const get = async (key) => (await kv.get(key)) ?? null
  const live = (row) => (row && (!row.expires_at || Date.parse(row.expires_at) > Date.now()) ? row : null)
  const idempotencyKey = ({ callerId, account, clientId, key }) =>
    `msg-key:${createHash('sha256').update(JSON.stringify([callerId, account || '', clientId || '', key])).digest('hex')}`
  const dayKey = (callerId, iso) => `msg-day:${callerId}:${iso.slice(0, 10)}`

  return {
    async close() {
      await kv.close?.()
    },
    async migrate() {},
    async upsertGrant({ token, account, clientId, kind = 'access', oauthClient = '', expiresAt = '', grantId = '', scope = 'read' }) {
      const hash = tokenHash(token)
      await kv.set(`grant:${hash}`, {
        token_hash: hash,
        account,
        client_id: clientId,
        kind,
        oauth_client: oauthClient,
        expires_at: expiresAt,
        grant_id: grantId,
        scope,
      })
      if (grantId) {
        const group = await get(`grant-id:${grantId}`)
        const tokens = new Set(group?.tokens || [])
        tokens.add(hash)
        await kv.set(`grant-id:${grantId}`, { tokens: [...tokens] })
      }
    },
    async revokeGrant(token) {
      await kv.delete(`grant:${tokenHash(token)}`)
    },
    async revokeGrantId(grantId) {
      if (!grantId) return
      const group = await get(`grant-id:${grantId}`)
      for (const hash of group?.tokens || []) await kv.delete(`grant:${hash}`)
      await kv.delete(`grant-id:${grantId}`)
    },
    async grantByToken(token) {
      if (!token) return null
      return live(await get(`grant:${tokenHash(token)}`))
    },
    async insertCode({ code, account, oauthClient, capFrom, redirectUri, codeChallenge, expiresAt, scope = 'read' }) {
      const hash = tokenHash(code)
      await kv.set(`code:${hash}`, {
        code_hash: hash,
        account,
        oauth_client: oauthClient,
        cap_from: capFrom,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        expires_at: expiresAt,
        scope,
      })
    },
    async takeCode(code) {
      if (!code) return null
      const key = `code:${tokenHash(code)}`
      const row = await get(key)
      if (row) await kv.delete(key)
      return live(row)
    },
    async insertDevice({ deviceCode, userCode, oauthClient, capFrom, clientName, verifiedHost, expiresAt, scope = 'read' }) {
      const hash = tokenHash(deviceCode)
      await kv.set(`device:${hash}`, {
        device_hash: hash,
        user_code: userCode,
        oauth_client: oauthClient,
        cap_from: capFrom,
        client_name: clientName,
        verified_host: verifiedHost,
        status: 'pending',
        account: '',
        last_poll_at: '',
        expires_at: expiresAt,
        scope,
      })
      await kv.set(`device-user:${userCode}`, { device_hash: hash })
    },
    async deviceByUserCode(userCode) {
      const pointer = await get(`device-user:${userCode}`)
      if (!pointer) return null
      return live(await get(`device:${pointer.device_hash}`))
    },
    async deviceByCode(deviceCode) {
      if (!deviceCode) return null
      return get(`device:${tokenHash(deviceCode)}`)
    },
    async decideDevice(userCode, { status, account = '', expiresAt = null, scope = null }) {
      const pointer = await get(`device-user:${userCode}`)
      if (!pointer) return null
      const row = await get(`device:${pointer.device_hash}`)
      if (!row || row.status !== 'pending') return null
      const next = { ...row, status, account, expires_at: expiresAt ?? row.expires_at, scope: scope ?? row.scope }
      await kv.set(`device:${row.device_hash}`, next)
      return next
    },
    async touchDevice(deviceCode, at) {
      const key = `device:${tokenHash(deviceCode)}`
      const row = await get(key)
      if (row) await kv.set(key, { ...row, last_poll_at: at })
    },
    async takeApprovedDevice(deviceCode) {
      const key = `device:${tokenHash(deviceCode)}`
      const row = await get(key)
      if (!row || row.status !== 'approved') return null
      await kv.delete(key)
      await kv.delete(`device-user:${row.user_code}`)
      return row
    },
    async countSince(callerId, sinceIso) {
      const row = await get(dayKey(callerId, sinceIso))
      return Number(row?.n || 0)
    },
    async byIdempotency(input) {
      const pointer = await get(idempotencyKey(input))
      return pointer ? get(`msg:${pointer.id}`) : null
    },
    async insert(msg) {
      const message = {
        id: msg.id,
        caller_id: msg.caller_id,
        account: msg.account || '',
        client_id: msg.client_id || '',
        idempotency_key: msg.idempotency_key || null,
        previous_id: msg.previous_id || null,
        message: msg.message,
        context: msg.context || {},
        status: msg.status,
        reply: msg.reply ?? null,
        error: msg.error || null,
        created_at: msg.created_at,
        finished_at: msg.finished_at || null,
        confirmation_id: null,
      }
      if (msg.idempotency_key) {
        const pointerKey = idempotencyKey({
          callerId: msg.caller_id,
          account: msg.account,
          clientId: msg.client_id,
          key: msg.idempotency_key,
        })
        const pointer = await get(pointerKey)
        if (pointer) return { message: await get(`msg:${pointer.id}`), created: false }
        await kv.set(pointerKey, { id: msg.id })
      }
      await kv.set(`msg:${msg.id}`, message)
      const day = dayKey(msg.caller_id, msg.created_at)
      const count = await get(day)
      await kv.set(day, { n: Number(count?.n || 0) + 1 })
      return { message, created: true }
    },
    async finish(id, { status, reply, error, finishedAt, confirmationId = null }) {
      const row = await get(`msg:${id}`)
      if (!row) return
      await kv.set(`msg:${id}`, {
        ...row,
        status,
        reply: reply ?? null,
        error: error || null,
        finished_at: finishedAt,
        confirmation_id: confirmationId,
      })
    },
    async byId(id) {
      return get(`msg:${id}`)
    },
    async insertConfirmation(c) {
      await kv.set(`cfm:${c.id}`, {
        id: c.id,
        caller_id: c.caller_id,
        account: c.account,
        client_id: c.client_id,
        message_id: c.message_id,
        summary: c.summary,
        authorization_details: c.authorization_details || [],
        status: 'pending',
        result: null,
        expires_at: c.expires_at,
        created_at: c.created_at,
        finished_at: null,
      })
    },
    async confirmationById(id) {
      return get(`cfm:${id}`)
    },
    async claimConfirmation(id, status) {
      const row = await get(`cfm:${id}`)
      if (!row || row.status !== 'pending' || Date.parse(row.expires_at) <= Date.now()) return null
      const next = { ...row, status }
      await kv.set(`cfm:${id}`, next)
      return next
    },
    async finishConfirmation(id, { status, result = null }) {
      const row = await get(`cfm:${id}`)
      if (!row) return
      await kv.set(`cfm:${id}`, { ...row, status, result, finished_at: new Date().toISOString() })
    },
  }
}

/** An in-memory key-value service, for tests and local runs. */
export function memoryKv() {
  const map = new Map()
  return {
    async get(key) {
      return map.has(key) ? structuredClone(map.get(key)) : null
    },
    async set(key, value) {
      map.set(key, structuredClone(value))
    },
    async delete(key) {
      map.delete(key)
    },
  }
}
