import { CapError, NoDoorError } from './errors.js'
import { fetchDoor } from './door.js'

const MAX_CONTEXT = 4 * 1024
const SENSITIVE_KEY = /password|secret|token/i
const FROM = /^agent:[A-Za-z0-9_.-]{1,64}$/

function memoryCache(now) {
  const store = new Map()
  return {
    get(key) {
      const hit = store.get(key)
      if (!hit || hit.expiresAt <= now()) {
        store.delete(key)
        return undefined
      }
      return hit
    },
    set(key, value) {
      store.set(key, value)
    },
  }
}

function assertFrom(from) {
  if (typeof from !== 'string' || !FROM.test(from)) {
    throw new CapError('invalid_request', 0, 'from must be agent:{id}.')
  }
}

function assertContext(context) {
  if (context == null) return
  if (typeof context !== 'object' || Array.isArray(context)) {
    throw new CapError('invalid_request', 0, 'context must be an object.')
  }
  if (JSON.stringify(context).length > MAX_CONTEXT) {
    throw new CapError('invalid_request', 0, 'context is too long.')
  }
  const walk = (value) => {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) {
        throw new CapError('invalid_request', 0, 'context cannot include a password, secret, or token.')
      }
      walk(child)
    }
  }
  walk(context)
}

function parseRetryAfter(header) {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds)
  const date = Date.parse(header)
  if (Number.isNaN(date)) return null
  return Math.max(0, Math.round((date - Date.now()) / 1000))
}

function defaultCode(status) {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 429) return 'rate_limited'
  if (status === 503) return 'unavailable'
  if (status === 400) return 'invalid_request'
  return 'unavailable'
}

async function errorFrom(response) {
  let body = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  const code = body?.error?.code || defaultCode(response.status)
  const message = body?.error?.message || 'Request failed.'
  const retryAfter = parseRetryAfter(response.headers.get('retry-after'))
  return new CapError(code, response.status, message, { retryAfter })
}

function normalize(body) {
  if (!body || typeof body !== 'object' || typeof body.id !== 'string') {
    throw new CapError('invalid_request', 0, 'The owner returned an unreadable message.')
  }
  if (body.status !== 'working' && body.status !== 'done' && body.status !== 'failed') {
    throw new CapError('invalid_request', 0, 'The owner returned an unreadable message.')
  }
  const message = {
    id: body.id,
    status: body.status,
    created_at: body.created_at,
    finished_at: body.finished_at ?? null,
  }
  if (body.status === 'done' && typeof body.reply === 'string') message.reply = body.reply
  if (body.status === 'failed' && body.error && typeof body.error === 'object') {
    message.error = { code: String(body.error.code || 'failed'), message: String(body.error.message || '') }
  }
  if (body.status === 'done' && body.confirmation) message.confirmation = body.confirmation
  return message
}

function base64url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function pkcePair() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const verifier = base64url(bytes)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(new Uint8Array(digest)) }
}

function metadataUrl(oauth) {
  const issuer = new URL(oauth)
  const path = issuer.pathname.replace(/\/$/, '')
  return new URL(`/.well-known/oauth-authorization-server${path}`, issuer.origin).toString()
}

function messagesUrl(door, id) {
  const base = door.cap.replace(/\/$/, '')
  return id ? `${base}/messages/${encodeURIComponent(id)}` : `${base}/messages`
}

export function createClient(options = {}) {
  const from = options.from
  assertFrom(from)
  const fetchImpl = options.fetch || globalThis.fetch
  const tokens = options.tokens || null
  const maxWaitMs = options.maxWaitMs ?? 120_000
  const now = options.now || (() => Date.now())
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const cache = options.cache || memoryCache(now)
  const pendingLogins = new Map()

  async function cachedDoor(target) {
    if (target && typeof target === 'object' && typeof target.cap === 'string') return target
    const key = String(target || '').trim().toLowerCase()
    const hit = await cache.get(key)
    if (hit && hit.expiresAt > now()) return hit.value
    let loaded
    try {
      loaded = await fetchDoor(target, fetchImpl)
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      throw new CapError('unavailable', 0, 'The front door could not be reached.')
    }
    await cache.set(key, { value: loaded.door, expiresAt: now() + loaded.ttl })
    return loaded.door
  }

  async function doorFor(target) {
    const door = await cachedDoor(target)
    if (!door) throw new NoDoorError(typeof target === 'string' ? target : 'this target')
    return door
  }

  function originOf(door) {
    return door.origin || new URL(door.cap).origin
  }

  async function currentToken(door) {
    if (!tokens) return null
    return (await tokens.get(originOf(door))) || null
  }

  async function wait(ms, signal) {
    if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
    await sleep(ms)
    if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
  }

  async function refresh(token) {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
      client_id: token.clientId,
    })
    const response = await fetchImpl(token.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!response.ok) throw new CapError('unauthorized', response.status, 'The login could not be renewed.')
    const json = await response.json()
    if (!json?.access_token) throw new CapError('unauthorized', response.status, 'The login could not be renewed.')
    return {
      ...token,
      accessToken: json.access_token,
      refreshToken: json.refresh_token || token.refreshToken,
      scope: json.scope || token.scope,
      expiresAt: json.expires_in ? now() + Number(json.expires_in) * 1000 : token.expiresAt,
    }
  }

  async function send(url, { method, json, token, idempotencyKey, signal }) {
    const headers = {
      'cap-version': '1.0',
      'cap-from': from,
      accept: 'application/json',
    }
    if (json) headers['content-type'] = 'application/json'
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey
    if (token?.accessToken) headers.authorization = `Bearer ${token.accessToken}`
    return fetchImpl(url, {
      method,
      headers,
      body: json ? JSON.stringify(json) : undefined,
      signal,
    })
  }

  async function call(door, makeRequest, { signal, deadline, allowNetworkRetry }) {
    let token = await currentToken(door)
    let refreshed = false
    let networkRetried = false
    let rateRetried = false
    for (;;) {
      let response
      try {
        response = await makeRequest(token)
      } catch (err) {
        if (err?.name === 'AbortError') throw err
        if (allowNetworkRetry && !networkRetried) {
          networkRetried = true
          continue
        }
        throw new CapError('unavailable', 0, 'The front door could not be reached.')
      }
      if (response.status === 401 && tokens) {
        if (!refreshed && token?.refreshToken && token.tokenEndpoint) {
          refreshed = true
          try {
            token = await refresh(token)
            await tokens.set(originOf(door), token)
            continue
          } catch {
            await tokens.delete(originOf(door))
          }
        } else {
          await tokens.delete(originOf(door))
        }
        throw await errorFrom(response)
      }
      if ((response.status === 429 || response.status === 503) && !rateRetried) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after')) ?? 1
        const delay = Math.max(1, retryAfter) * 1000
        if (deadline - now() >= delay) {
          rateRetried = true
          await wait(delay, signal)
          continue
        }
        throw await errorFrom(response)
      }
      if (response.status >= 400) throw await errorFrom(response)
      return response
    }
  }

  async function readMessage(door, id, { signal, deadline }) {
    const response = await call(door, (token) => send(messagesUrl(door, id), { method: 'GET', token, signal }), {
      signal,
      deadline,
      allowNetworkRetry: true,
    })
    const retryAfter = parseRetryAfter(response.headers.get('retry-after'))
    const message = normalize(await response.json())
    return { message, retryAfter }
  }

  async function ask(target, message, askOptions = {}) {
    if (typeof message !== 'string' || !message.trim()) {
      throw new CapError('invalid_request', 0, 'message is required.')
    }
    assertContext(askOptions.context)
    const door = await doorFor(target)
    const deadline = now() + maxWaitMs
    const idempotencyKey = askOptions.idempotencyKey || crypto.randomUUID()
    const payload = { message }
    if (askOptions.context) payload.context = askOptions.context
    if (askOptions.previousMessageId) payload.previous_message_id = askOptions.previousMessageId
    const response = await call(
      door,
      (token) => send(messagesUrl(door), { method: 'POST', json: payload, token, idempotencyKey, signal: askOptions.signal }),
      { signal: askOptions.signal, deadline, allowNetworkRetry: true }
    )
    let current = normalize(await response.json())
    let retryAfter = parseRetryAfter(response.headers.get('retry-after'))
    while (current.status === 'working') {
      const delay = Math.max(1, retryAfter ?? 1) * 1000
      if (deadline - now() < delay) return current
      await wait(delay, askOptions.signal)
      const next = await readMessage(door, current.id, { signal: askOptions.signal, deadline })
      current = next.message
      retryAfter = next.retryAfter
    }
    return current
  }

  async function get(target, id) {
    if (typeof id !== 'string' || !id) throw new CapError('invalid_request', 0, 'message id is required.')
    const door = await doorFor(target)
    const read = await readMessage(door, id, { deadline: now() + maxWaitMs })
    return read.message
  }

  function thread(target) {
    let previousId = null
    const api = {
      restarted: false,
      async ask(message, askOptions = {}) {
        api.restarted = false
        const options = { ...askOptions, previousMessageId: previousId || undefined }
        try {
          const result = await ask(target, message, options)
          previousId = result.id
          return result
        } catch (err) {
          if (err instanceof CapError && err.code === 'not_found') previousId = null
          if (err instanceof CapError && err.code === 'conflict' && previousId) {
            previousId = null
            api.restarted = true
            const { previousMessageId: _ignored, ...rest } = askOptions
            const result = await ask(target, message, rest)
            previousId = result.id
            return result
          }
          throw err
        }
      },
    }
    return api
  }

  async function login(target, loginOptions) {
    const door = await doorFor(target)
    if (!door.oauth) throw new CapError('invalid_request', 0, 'This front door has no login.')
    const metaResponse = await fetchImpl(metadataUrl(door.oauth), { headers: { accept: 'application/json' } })
    if (!metaResponse.ok) throw new CapError('unavailable', metaResponse.status, 'The login server could not be read.')
    const metadata = await metaResponse.json()
    if (!metadata?.authorization_endpoint || !metadata?.token_endpoint) {
      throw new CapError('invalid_request', 0, 'This front door has no redirect login.')
    }
    const { verifier, challenge } = await pkcePair()
    const state = crypto.randomUUID()
    const url = new URL(metadata.authorization_endpoint)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', loginOptions.clientId)
    url.searchParams.set('redirect_uri', loginOptions.redirectUri)
    url.searchParams.set('state', state)
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    if (loginOptions.scope) url.searchParams.set('scope', loginOptions.scope)
    const result = new Promise((resolve, reject) => {
      pendingLogins.set(state, {
        resolve,
        reject,
        verifier,
        clientId: loginOptions.clientId,
        redirectUri: loginOptions.redirectUri,
        door,
        metadata,
      })
    })
    try {
      await loginOptions.open(url.toString())
    } catch (err) {
      pendingLogins.delete(state)
      throw err
    }
    return result
  }

  async function finishLogin(callbackUrl) {
    const url = new URL(callbackUrl)
    const state = url.searchParams.get('state')
    const pending = state ? pendingLogins.get(state) : null
    if (!pending) throw new CapError('invalid_request', 0, 'This login session is unknown.')
    pendingLogins.delete(state)
    const fail = (error) => {
      pending.reject(error)
      throw error
    }
    const oauthError = url.searchParams.get('error')
    if (oauthError) {
      fail(new CapError(oauthError, 0, url.searchParams.get('error_description') || 'Login was denied.'))
    }
    const code = url.searchParams.get('code')
    if (!code) fail(new CapError('invalid_request', 0, 'The login redirect had no code.'))
    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: pending.redirectUri,
        client_id: pending.clientId,
        code_verifier: pending.verifier,
      })
      const response = await fetchImpl(pending.metadata.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      })
      if (!response.ok) throw new CapError('unauthorized', response.status, 'The login could not be completed.')
      const json = await response.json()
      if (!json?.access_token) throw new CapError('unauthorized', response.status, 'The login could not be completed.')
      const token = {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        scope: json.scope,
        expiresAt: json.expires_in ? now() + Number(json.expires_in) * 1000 : undefined,
        clientId: pending.clientId,
        tokenEndpoint: pending.metadata.token_endpoint,
        revocationEndpoint: pending.metadata.revocation_endpoint,
      }
      if (tokens) await tokens.set(originOf(pending.door), token)
      pending.resolve(token)
      return token
    } catch (err) {
      pending.reject(err)
      throw err
    }
  }

  async function logout(target) {
    const door = await doorFor(target)
    if (!tokens) return
    const key = originOf(door)
    const token = await tokens.get(key)
    if (token?.refreshToken && token.revocationEndpoint) {
      const body = new URLSearchParams({ token: token.refreshToken, client_id: token.clientId || '' })
      await fetchImpl(token.revocationEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      }).catch(() => {})
    }
    await tokens.delete(key)
  }

  return { discover: cachedDoor, ask, get, thread, login, finishLogin, logout }
}
