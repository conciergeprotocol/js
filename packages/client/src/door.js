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
    // A local server rarely has TLS, so a bare loopback address means http.
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && isLoopback(url.hostname)) url.protocol = 'http:'
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

const REDIRECTS = new Set([301, 302, 303, 307, 308])
const HOME_MAX = 256 * 1024

function miss(fallback = true) {
  return { door: null, ttl: MISSING_TTL, fallback }
}

function safeNext(response, current) {
  const location = response.headers.get('location')
  if (!location) return null
  let next
  try {
    next = new URL(location, current)
  } catch {
    return null
  }
  if (!allowedProtocol(next) || next.username || next.password) return null
  next.hash = ''
  return next
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, 'i'))
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : ''
}

export function agentLinkHeader(header) {
  if (!header) return null
  const parts = String(header).split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
  for (const part of parts) {
    const uri = part.match(/<([^>]*)>/)
    if (!uri) continue
    const rel = part.match(/(?:^|\s|;)\s*rel\s*=\s*(?:"([^"]*)"|([^;,]+))/i)
    const types = (rel?.[1] ?? rel?.[2] ?? '').toLowerCase().trim().split(/\s+/)
    if (types.includes('agent')) return uri[1].trim()
  }
  return null
}

export function agentLinkHref(html) {
  const source = String(html || '')
  const bodyAt = source.search(/<body\b/i)
  const headAt = source.search(/<\/head>/i)
  let cut = source.length
  if (bodyAt !== -1) cut = Math.min(cut, bodyAt)
  if (headAt !== -1) cut = Math.min(cut, headAt)
  const tags = source.slice(0, cut).match(/<link\b[^>]*>/gi) || []
  for (const tag of tags) {
    const rel = attr(tag, 'rel').toLowerCase().split(/\s+/)
    if (!rel.includes('agent')) continue
    const href = attr(tag, 'href')
    if (href) return href
  }
  return null
}

async function textLimited(response, max) {
  if (response.body?.getReader) {
    const reader = response.body.getReader()
    const chunks = []
    let size = 0
    while (size < max) {
      const { done, value } = await reader.read()
      if (done) break
      const take = Math.min(value.length, max - size)
      chunks.push(take === value.length ? value : value.subarray(0, take))
      size += take
      if (take < value.length) break
    }
    try { await reader.cancel() } catch { /* the body is already finished */ }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    return new TextDecoder().decode(bytes)
  }
  const text = await response.text()
  return text.slice(0, max)
}

async function readDoor(response, finalUrl) {
  if (response.status !== 200) return miss(true)
  const type = response.headers.get('content-type') || ''
  if (/text\/html|application\/xhtml/i.test(type)) return miss(true)
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_FILE) return miss(false)
  const text = await response.text()
  if (text.length > MAX_FILE) return miss(false)
  if (text.trimStart().startsWith('<')) return miss(true)
  const door = parseAgentTxt(text, new URL(finalUrl).origin)
  if (!door) return miss(true)
  return { door, ttl: cacheTtl(response.headers.get('cache-control'), FOUND_TTL) }
}

async function followFile(start, fetchImpl) {
  let current = start
  let company = new URL(start)
  let leftSite = false
  for (let hop = 0; hop < 5; hop += 1) {
    const response = await fetchImpl(current, {
      redirect: 'manual',
      headers: { accept: 'text/plain, text/markdown, */*' },
    })
    if (REDIRECTS.has(response.status)) {
      const next = safeNext(response, current)
      if (!next) return miss(false)
      if (sameSite(start.hostname, next.hostname)) company = next
      else leftSite = true
      current = next
      continue
    }
    const read = await readDoor(response, current)
    if (read.door) {
      read.door.origin = leftSite ? company.origin : new URL(current).origin
      if (leftSite) read.door.source = 'redirect'
    }
    return read
  }
  return miss(true)
}

async function findPointer(start, fetchImpl) {
  let current = new URL(start.origin)
  for (let hop = 0; hop < 5; hop += 1) {
    const response = await fetchImpl(current, {
      redirect: 'manual',
      headers: { accept: 'text/html' },
    })
    if (REDIRECTS.has(response.status)) {
      const next = safeNext(response, current)
      if (!next || !sameSite(start.hostname, next.hostname)) return null
      current = next
      continue
    }
    if (response.status !== 200) return null
    const headerHref = agentLinkHeader(response.headers.get('link'))
    let raw = headerHref
    let source = 'link-header'
    if (!raw) {
      raw = agentLinkHref(await textLimited(response, HOME_MAX))
      source = 'link-tag'
    }
    if (!raw) return null
    let target
    try {
      target = new URL(raw, current)
    } catch {
      return null
    }
    if (!allowedProtocol(target) || target.username || target.password) return null
    target.hash = ''
    return { target, source, origin: new URL(current).origin }
  }
  return null
}

export async function fetchDoor(input, fetchImpl) {
  const start = agentTxtUrl(input)
  if (!start) return { door: null, ttl: MISSING_TTL }
  const direct = await followFile(start, fetchImpl)
  if (direct.door || direct.fallback === false) return direct
  const pointer = await findPointer(start, fetchImpl)
  if (!pointer) return { door: null, ttl: MISSING_TTL }
  const file = await followFile(pointer.target, fetchImpl)
  if (!file.door) return { door: null, ttl: MISSING_TTL }
  file.door.origin = pointer.origin
  file.door.source = pointer.source
  return file
}
