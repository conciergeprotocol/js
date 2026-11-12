const MAX_ITEMS = 20
const MAX_TITLE = 200
const MAX_SUMMARY = 400
const MAX_NOTE = 160
const MAX_IMAGES = 10
const MAX_INCLUDES = 20
const MAX_OPTIONS = 12
const TYPES = new Set(['product', 'offer', 'listing', 'article', 'action'])
const COMMERCE = new Set(['product', 'offer', 'listing'])
const AVAILABILITY = new Set([
  'in_stock', 'out_of_stock', 'limited', 'preorder', 'backorder', 'made_to_order', 'available', 'unavailable',
])
const ACTIONS = new Set(['view', 'add_to_cart', 'book', 'contact', 'manage'])
const PERIODS = new Set(['once', 'day', 'week', 'month', 'year', 'night'])
const KNOWN = new Set(['items'])

function loopback(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

/** `null` when accept is absent. `false` when it is present and malformed. */
export function parseAccept(value) {
  if (value == null || value === '') return null
  const list = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(',') : null)
  if (!list || list.some((entry) => typeof entry !== 'string')) return false
  const accept = []
  for (const entry of list) {
    const token = entry.trim()
    if (!token || !KNOWN.has(token) || accept.includes(token)) continue
    accept.push(token)
  }
  return accept
}

function plain(value, max) {
  if (typeof value !== 'string') return ''
  const text = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, max) : ''
}

function httpsUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  let url
  try {
    url = new URL(value.trim())
  } catch {
    return ''
  }
  if (url.username || url.password) return ''
  if (url.protocol === 'https:') return url.toString()
  if (url.protocol === 'http:' && loopback(url.hostname)) return url.toString()
  return ''
}

function timestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString()
}

function money(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const currency = String(value.currency || '').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) return null
  const raw = typeof value.amount === 'number' && Number.isFinite(value.amount)
    ? value.amount.toFixed(2)
    : String(value.amount ?? '').trim()
  if (!/^\d+(\.\d{1,4})?$/.test(raw)) return null
  const [whole, frac = ''] = raw.split('.')
  return { amount: `${whole}.${frac.padEnd(2, '0').slice(0, 2)}`, currency }
}

function higher(left, right) {
  return Number(left.amount) > Number(right.amount) && left.currency === right.currency
}

function options(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const out = {}
  for (const [key, entry] of Object.entries(value)) {
    if (Object.keys(out).length >= MAX_OPTIONS) break
    const name = plain(key, 40)
    const text = plain(typeof entry === 'string' || typeof entry === 'number' ? String(entry) : '', 80)
    if (name && text) out[name] = text
  }
  return Object.keys(out).length ? out : null
}

function rating(value) {
  if (!value || typeof value !== 'object') return null
  const score = Number(value.value)
  const count = Number(value.count)
  const scale = Number(value.scale)
  if (!Number.isFinite(score) || !Number.isFinite(count) || !Number.isFinite(scale)) return null
  if (scale <= 0 || score < 0 || score > scale || count < 0) return null
  return { value: Math.round(score * 100) / 100, count: Math.round(count), scale: Math.round(scale) }
}

function location(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const out = {}
  for (const key of ['name', 'locality', 'region', 'country']) {
    const text = plain(typeof value[key] === 'string' ? value[key] : '', 80)
    if (text) out[key] = text
  }
  return Object.keys(out).length ? out : null
}

function extra(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  try {
    const text = JSON.stringify(value)
    if (!text || text === '{}' || text.length > 2000) return null
    return JSON.parse(text)
  } catch {
    return null
  }
}

function sanitizeItem(entry, seen) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
  const type = String(entry.type || '')
  if (!TYPES.has(type)) return null
  const title = plain(entry.title, MAX_TITLE)
  const url = httpsUrl(entry.url)
  if (!title || !url) return null
  if (type === 'action' && !ACTIONS.has(entry.action)) return null

  const item = { type, title, url }
  const id = plain(typeof entry.id === 'string' ? entry.id : '', 120)
  if (id && !seen.ids.has(id)) {
    seen.ids.add(id)
    item.id = id
  }
  const ref = Number(entry.ref)
  if (Number.isInteger(ref) && ref > 0 && ref < 1000 && !seen.refs.has(ref)) {
    seen.refs.add(ref)
    item.ref = ref
  }
  const summary = plain(entry.summary, MAX_SUMMARY)
  if (summary) item.summary = summary
  const image = httpsUrl(entry.image)
  if (image) item.image = image
  if (Array.isArray(entry.images)) {
    const images = []
    for (const candidate of entry.images) {
      const next = httpsUrl(candidate)
      if (!next || images.includes(next)) continue
      images.push(next)
      if (images.length >= MAX_IMAGES) break
    }
    if (images.length) item.images = images
  }
  const schema = httpsUrl(entry.schema)
  if (schema && schema.startsWith('https://schema.org/')) item.schema = schema

  if (COMMERCE.has(type)) {
    const price = money(entry.price)
    if (price) item.price = price
    const list = money(entry.list_price)
    if (price && list && higher(list, price)) item.list_price = list
    const note = plain(entry.price_note, MAX_NOTE)
    if (note) item.price_note = note
    if (AVAILABILITY.has(entry.availability)) item.availability = entry.availability
    const until = timestamp(entry.valid_until)
    if (until) item.valid_until = until
    const chosen = options(entry.options)
    if (chosen) item.options = chosen
    const scored = rating(entry.rating)
    if (scored) item.rating = scored
  }
  if (type === 'offer') {
    if (PERIODS.has(entry.period)) item.period = entry.period
    if (Array.isArray(entry.includes)) {
      const includes = []
      for (const line of entry.includes) {
        const text = plain(typeof line === 'string' ? line : '', 120)
        if (!text) continue
        includes.push(text)
        if (includes.length >= MAX_INCLUDES) break
      }
      if (includes.length) item.includes = includes
    }
  }
  if (type === 'listing') {
    const start = timestamp(entry.start)
    const end = timestamp(entry.end)
    if (start) item.start = start
    if (end) item.end = end
    const where = location(entry.location)
    if (where) item.location = where
    const capacity = Number(entry.capacity)
    if (Number.isInteger(capacity) && capacity > 0 && capacity < 100000) item.capacity = capacity
  }
  if (type === 'article') {
    const updated = timestamp(entry.updated)
    if (updated) item.updated = updated
  }
  if (type === 'action') {
    item.action = entry.action
    const owner = plain(typeof entry.for === 'string' ? entry.for : '', 120)
    if (owner) item.for = owner
    const expires = timestamp(entry.expires)
    if (expires) item.expires = expires
  }
  const more = extra(entry.extra)
  if (more) item.extra = more
  return item
}

/**
 * Keeps well-formed items and drops the rest. A priced list with no `as_of`
 * is stamped with `now`, because a price has to say when it was read.
 */
export function sanitizeItems(raw, { asOf, now } = {}) {
  if (!Array.isArray(raw)) return { items: [], as_of: null }
  const seen = { ids: new Set(), refs: new Set() }
  const items = []
  for (const entry of raw) {
    if (items.length >= MAX_ITEMS) break
    const item = sanitizeItem(entry, seen)
    if (item) items.push(item)
  }
  if (!items.length) return { items: [], as_of: null }
  const priced = items.some((item) => item.price)
  const stamp = timestamp(asOf) || (priced ? timestamp(now || new Date().toISOString()) : '')
  return { items, as_of: stamp || null }
}
