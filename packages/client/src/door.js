const MAX_FILE = 16 * 1024
const FOUND_TTL = 60 * 60 * 1000
const MISSING_TTL = 10 * 60 * 1000
const KNOWN = new Set(['protocol', 'name', 'chat', 'cap', 'oauth', 'spec'])

export function isLoopback(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function siteHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
}

export function sameSite(left, right) {
  const a = siteHost(left)
  const b = siteHost(right)
  if (!a || !b) return false
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)
}

function allowedProtocol(url) {
  return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url.hostname))
}

export function agentTxtUrl(input) {
  const raw = String(input || '').trim()
  if (!raw) return null
  let url
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (!allowedProtocol(url)) return null
  url.pathname = '/agent.txt'
  url.search = ''
  url.hash = ''
  url.username = ''
  url.password = ''
  return url
}

function cacheTtl(header, fallback) {
  const match = /max-age=(\d+)/i.exec(header || '')
  return match ? Number(match[1]) * 1000 : fallback
}

export function parseAgentTxt(text, origin) {
  const fields = {}
  const extra = {}
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const split = trimmed.indexOf(':')
    if (split <= 0) continue
    const key = trimmed.slice(0, split).trim().toLowerCase()
    const value = trimmed.slice(split + 1).trim()
    if (!key || !value) continue
    if (KNOWN.has(key)) fields[key] = value
    else extra[key] = value
  }
  let cap
  try {
    const url = new URL(fields.cap || '')
    if (!allowedProtocol(url) || url.username || url.password) return null
    cap = url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
  return {
    protocol: fields.protocol || null,
    name: fields.name || null,
    chat: fields.chat || null,
    cap,
    oauth: fields.oauth || null,
    spec: fields.spec || null,
    origin,
    extra,
  }
}

async function readDoor(response, finalUrl) {
  if (response.status !== 200) return { door: null, ttl: MISSING_TTL }
  const type = response.headers.get('content-type') || ''
  if (/text\/html|application\/xhtml/i.test(type)) return { door: null, ttl: MISSING_TTL }
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_FILE) return { door: null, ttl: MISSING_TTL }
  const text = await response.text()
  if (text.length > MAX_FILE || text.trimStart().startsWith('<')) return { door: null, ttl: MISSING_TTL }
  const door = parseAgentTxt(text, new URL(finalUrl).origin)
  if (!door) return { door: null, ttl: MISSING_TTL }
  return { door, ttl: cacheTtl(response.headers.get('cache-control'), FOUND_TTL) }
}

export async function fetchDoor(input, fetchImpl) {
  const start = agentTxtUrl(input)
  if (!start) return { door: null, ttl: MISSING_TTL }
  let current = start
  for (let hop = 0; hop < 5; hop += 1) {
    const response = await fetchImpl(current, {
      redirect: 'manual',
      headers: { accept: 'text/plain, text/markdown, */*' },
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) return { door: null, ttl: MISSING_TTL }
      const next = new URL(location, current)
      if (!allowedProtocol(next) || !sameSite(start.hostname, next.hostname)) {
        return { door: null, ttl: MISSING_TTL }
      }
      next.username = ''
      next.password = ''
      current = next
      continue
    }
    return readDoor(response, current)
  }
  return { door: null, ttl: MISSING_TTL }
}
