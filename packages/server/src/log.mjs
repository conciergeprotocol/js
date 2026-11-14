import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { send } from './http.mjs'

const MIN_SECRET = 16
const LIMIT = 200
const CLAMP_CHARS = 240
const CLAMP_LINES = 3
const RESERVED = ['/cap/', '/oauth', '/.well-known/', '/agent.txt', '/health']

const escape = (text) =>
  String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const digest = (text) => createHash('sha256').update(String(text)).digest()

/** The password half of a Basic header. Any username is accepted. */
function basicPassword(header) {
  const match = String(header || '').match(/^Basic\s+([A-Za-z0-9+/=]+)$/i)
  if (!match) return null
  const decoded = Buffer.from(match[1], 'base64').toString('utf8')
  const colon = decoded.indexOf(':')
  return colon < 0 ? null : decoded.slice(colon + 1)
}

function durationMs(msg) {
  if (!msg.finished_at) return null
  const ms = Date.parse(msg.finished_at) - Date.parse(msg.created_at)
  return Number.isFinite(ms) && ms >= 0 ? ms : null
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

function tally(values) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
}

const sum = (values) => values.reduce((total, value) => total + (value ?? 0), 0)

export function summarize(messages) {
  const count = (status) => messages.filter((msg) => msg.status === status).length
  return {
    total: messages.length,
    done: count('done'),
    failed: count('failed'),
    working: count('working'),
    follow_ups: messages.filter((msg) => msg.previous_id).length,
    signed_in: messages.filter((msg) => msg.account).length,
    median_ms: median(messages.map(durationMs).filter((ms) => ms != null)),
    input_tokens: sum(messages.map((msg) => msg.input_tokens)),
    output_tokens: sum(messages.map((msg) => msg.output_tokens)),
    callers: tally(messages.map((msg) => msg.caller_id)).map(([caller, n]) => ({ caller, count: n })),
    errors: tally(messages.filter((msg) => msg.error).map((msg) => msg.error.code || 'failed'))
      .map(([code, n]) => ({ code, count: n })),
  }
}

function formatMs(ms) {
  if (ms == null) return ''
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return `${(ms / 60_000).toFixed(1)} min`
}

const formatCount = (n) => Number(n).toLocaleString('en-US')

const utcLabel = (iso) => `${String(iso || '').slice(0, 19).replace('T', ' ')} UTC`

function formatAgo(iso, now) {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (!Number.isFinite(seconds)) return ''
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`
  return String(iso).slice(0, 10)
}

const DASH = '<span class="faint">–</span>'

function tokensCell(msg) {
  if (msg.input_tokens == null && msg.output_tokens == null) return DASH
  const part = (n) => (n == null ? '–' : formatCount(n))
  return `${part(msg.input_tokens)} <span class="muted">in</span><br>${part(msg.output_tokens)} <span class="muted">out</span>`
}

/** Short text as is. Longer text shows three lines and a toggle, without a script. */
function longText(text, label) {
  const value = String(text ?? '')
  const safe = escape(value)
  if (value.length <= CLAMP_CHARS && value.split('\n').length <= CLAMP_LINES) return `<div class="text">${safe}</div>`
  return `<details class="more"><summary><div class="text clamp">${safe}</div><span class="toggle"><span class="show">Show full ${label}</span><span class="hide">Show less</span></span></summary><div class="text">${safe}</div></details>`
}

function answerCell(msg) {
  if (msg.status === 'working') return '<span class="pill working">Working</span>'
  if (msg.status === 'failed') {
    const error = msg.error || {}
    return `<span class="pill failed">${escape(error.code || 'failed')}</span> <span class="muted">${escape(error.message || '')}</span>`
  }
  return longText(msg.reply, 'reply')
}

function questionCell(msg) {
  const tags = []
  if (msg.previous_id) tags.push('<span class="chip">follow-up</span>')
  if (msg.account) tags.push(`<span class="chip">account ${escape(msg.account)}</span>`)
  const head = tags.length ? `<div class="tags">${tags.join('')}</div>` : ''
  const context = msg.context && Object.keys(msg.context).length
    ? `<div class="context">Context: ${escape(JSON.stringify(msg.context))}</div>`
    : ''
  return `${head}${longText(msg.message, 'question')}${context}`
}

const DARK = '--bg:#111214;--fg:#e8e8e8;--muted:#a3a3a3;--faint:#6e6e6e;--line:#2a2b2f;--panel:#17181b;--chip:#26272b;--bad:#ff6b6b;--bad-bg:#3a1d1f;--warn:#f0b450;--warn-bg:#3a2e17;--accent:#7aa2ff;--seg:#3a3b40;--seg-fg:#f2f2f2'

const STYLE = `:root{color-scheme:light dark;--bg:#fff;--fg:#111;--muted:#666;--faint:#9a9a9a;--line:#ebebeb;--panel:#fafafa;--chip:#f0f0f0;--bad:#c62828;--bad-bg:#fdecec;--warn:#a15c00;--warn-bg:#fff3dc;--accent:#2563eb;--seg:#fff;--seg-fg:#111}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${DARK}}}
:root[data-theme=dark]{color-scheme:dark;${DARK}}
:root[data-theme=light]{color-scheme:light}
*{box-sizing:border-box}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.theme{display:flex;gap:2px;padding:3px;border-radius:8px;background:var(--chip);flex:none}
.theme button{display:flex;align-items:center;justify-content:center;width:30px;height:26px;padding:0;border:0;border-radius:6px;background:none;color:var(--muted);cursor:pointer}
.theme button:hover{color:var(--fg)}
.theme button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.theme button[aria-checked=true]{background:var(--seg);color:var(--seg-fg);box-shadow:0 1px 2px rgba(0,0,0,.12)}
.theme svg{width:16px;height:16px}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:1240px;margin:0 auto;padding:28px 24px 48px}
h1{font-size:20px;margin:0}
.sub{margin:2px 0 0;color:var(--muted)}
.muted{color:var(--muted)}
.faint{color:var(--faint)}
.strip{display:flex;flex-wrap:wrap;margin:20px 0 14px;border:1px solid var(--line);border-radius:10px;background:var(--panel)}
.group{display:flex;flex-wrap:wrap;border-right:1px solid var(--line)}
.group:last-child{border-right:0}
.stat{display:flex;flex-direction:column;padding:10px 16px;min-width:96px}
.value{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
.label{font-size:12px;color:var(--muted)}
.stat.bad .value{color:var(--bad)}
.stat.warn .value{color:var(--warn)}
.breakdown{display:flex;flex-wrap:wrap;gap:8px 28px}
.breakdown>div{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.chip{display:inline-flex;gap:6px;align-items:center;font-size:12px;background:var(--chip);border-radius:999px;padding:1px 9px}
.chip b{font-weight:600;font-variant-numeric:tabular-nums}
.chip.bad{background:var(--bad-bg);color:var(--bad)}
.note{font-size:12px;color:var(--faint);margin:8px 0 0}
table{width:100%;table-layout:fixed;border-collapse:separate;border-spacing:0;margin-top:20px}
.c-when{width:10%}.c-caller{width:10%}.c-question{width:27%}.c-answer{width:37%}.c-took{width:7%}.c-tokens{width:9%}
th{position:sticky;top:0;z-index:1;background:var(--bg);text-align:left;font-size:12px;font-weight:600;color:var(--muted);padding:8px 10px;border-bottom:1px solid var(--line)}
td{padding:10px;vertical-align:top;border-bottom:1px solid var(--line);overflow-wrap:anywhere}
tr>td:first-child,tr>th:first-child{border-left:3px solid transparent}
tr.failed>td:first-child{border-left-color:var(--bad)}
tr.working>td:first-child{border-left-color:var(--warn)}
.when{color:var(--muted);white-space:nowrap}
.caller{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
th.num,td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.text{white-space:pre-wrap}
.clamp{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
.more summary{list-style:none;cursor:pointer}
.more summary::-webkit-details-marker{display:none}
.toggle{display:inline-block;margin-top:2px;font-size:12px;color:var(--accent)}
.more .hide,.more[open] .show,.more[open] .clamp{display:none}
.more[open] .hide{display:inline}
.tags{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px}
.context{margin-top:4px;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
.pill{display:inline-block;font-size:12px;font-weight:600;border-radius:4px;padding:0 6px;margin-right:2px}
.pill.failed{background:var(--bad-bg);color:var(--bad)}
.pill.working{background:var(--warn-bg);color:var(--warn)}
.empty{margin-top:24px;padding:40px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:10px}
@media (max-width:760px){.scroll{overflow-x:auto}.scroll table{min-width:880px}.group{border-right:0}}`

const icon = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

const THEMES = [
  ['system', 'System', icon('<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>')],
  ['light', 'Light', icon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>')],
  ['dark', 'Dark', icon('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>')],
]

const THEME_TOGGLE = `<div class="theme" role="radiogroup" aria-label="Theme" title="Theme (⌘/ or Ctrl+/ to cycle)">${THEMES.map(([value, label, svg]) =>
  `<button type="button" role="radio" aria-checked="${value === 'system'}" aria-label="${label}" title="${label}" data-set-theme="${value}">${svg}</button>`).join('')}</div>`

/** Runs in the head so a saved theme applies before the first paint. */
const THEME_SCRIPT = `(() => {
  const root = document.documentElement, key = 'cap-log-theme', order = ['light', 'dark', 'system']
  const read = () => { try { return localStorage.getItem(key) || 'system' } catch { return 'system' } }
  const apply = (theme) => {
    if (theme === 'light' || theme === 'dark') root.dataset.theme = theme
    else delete root.dataset.theme
    for (const button of document.querySelectorAll('[data-set-theme]')) button.setAttribute('aria-checked', String(button.dataset.setTheme === theme))
  }
  const set = (theme) => {
    try { theme === 'system' ? localStorage.removeItem(key) : localStorage.setItem(key, theme) } catch {}
    apply(theme)
  }
  apply(read())
  document.addEventListener('DOMContentLoaded', () => apply(read()))
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-set-theme]')
    if (button) set(button.dataset.setTheme)
  })
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === '/') {
      event.preventDefault()
      set(order[(order.indexOf(read()) + 1) % order.length])
    }
  })
})()`

function renderPage({ agentName, retentionHours, messages, summary, truncated, now, nonce }) {
  const stat = (label, value, tone = '') =>
    `<div class="stat${tone ? ` ${tone}` : ''}"><span class="value">${escape(value)}</span><span class="label">${label}</span></div>`
  const group = (...stats) => `<div class="group">${stats.join('')}</div>`
  const extra = [
    summary.follow_ups ? stat('Follow-ups', summary.follow_ups) : '',
    summary.signed_in ? stat('Signed in', summary.signed_in) : '',
  ].filter(Boolean)
  const strip = [
    group(
      stat('Messages', summary.total),
      stat('Answered', summary.done),
      stat('Failed', summary.failed, summary.failed ? 'bad' : ''),
      stat('Working', summary.working, summary.working ? 'warn' : ''),
    ),
    group(stat('Median time', formatMs(summary.median_ms) || '–')),
    group(stat('Tokens in', formatCount(summary.input_tokens)), stat('Tokens out', formatCount(summary.output_tokens))),
    extra.length ? group(...extra) : '',
  ].join('')
  const chips = (items, key, tone = '') => items.length
    ? items.slice(0, 10).map((item) => `<span class="chip${tone ? ` ${tone}` : ''}">${escape(item[key])} <b>${item.count}</b></span>`).join('')
    : '<span class="faint">None</span>'
  const rows = messages.map((msg) => `<tr class="${escape(msg.status)}">
<td class="when" title="${escape(utcLabel(msg.created_at))}">${escape(formatAgo(msg.created_at, now))}</td>
<td class="caller" title="${escape(msg.caller_id)}">${escape(msg.caller_id)}</td>
<td>${questionCell(msg)}</td>
<td>${answerCell(msg)}</td>
<td class="num">${escape(formatMs(durationMs(msg))) || DASH}</td>
<td class="num">${tokensCell(msg)}</td>
</tr>`).join('\n')
  const table = messages.length
    ? `<div class="scroll"><table><colgroup><col class="c-when"><col class="c-caller"><col class="c-question"><col class="c-answer"><col class="c-took"><col class="c-tokens"></colgroup>
<thead><tr><th>When</th><th>Caller</th><th>Question</th><th>Answer</th><th class="num">Took</th><th class="num">Tokens</th></tr></thead>
<tbody>${rows}</tbody></table></div>`
    : `<div class="empty">No messages in the last ${retentionHours} hours.</div>`
  const updated = new Date(now).toISOString().slice(11, 16)
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escape(agentName)} · CAP log</title>
<style>${STYLE}</style>
<script nonce="${nonce}">${THEME_SCRIPT}</script>
</head><body><main>
<header class="top"><div>
<h1>${escape(agentName)}</h1>
<p class="sub">CAP log · last ${retentionHours} hours, newest first${truncated ? ` · showing the newest ${LIMIT}` : ''} · updated ${updated} UTC</p>
</div>${THEME_TOGGLE}</header>
<div class="strip">${strip}</div>
<div class="breakdown">
<div><span class="label">Callers</span>${chips(summary.callers, 'caller')}</div>
<div><span class="label">Errors</span>${chips(summary.errors, 'code', 'bad')}</div>
</div>
<p class="note">A caller is the CAP-From label the visiting agent sends. It is not proof of who sent it.</p>
${table}
</main></body></html>`
}

/**
 * The owner's read-only view of recent messages from every caller.
 * Off unless `secret` is set. The browser asks for it with Basic auth.
 */
export function createLog({ store, agentName, secret, path = '/log', retentionHours = 24 }) {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET) {
    throw new Error(`log.secret must be at least ${MIN_SECRET} characters.`)
  }
  if (typeof path !== 'string' || !/^\/[A-Za-z0-9/_.-]*$/.test(path) || path === '/') {
    throw new Error('log.path must be a path such as /log.')
  }
  if (RESERVED.some((prefix) => path === prefix.replace(/\/$/, '') || path.startsWith(prefix))) {
    throw new Error('log.path cannot share a path with the CAP door, OAuth, or agent.txt.')
  }
  if (typeof store?.recentMessages !== 'function') {
    throw new Error('This store cannot list messages, so it cannot serve the log.')
  }
  const expected = digest(secret)

  async function handle(req, res, url) {
    if (url.pathname !== path) return false
    if (req.method !== 'GET') {
      send(res, 405, { error: { code: 'method_not_allowed', message: 'Use GET.' } }, { headers: { allow: 'GET' } })
      return true
    }
    const password = basicPassword(req.headers.authorization)
    if (password == null || !timingSafeEqual(digest(password), expected)) {
      send(res, 401, { error: { code: 'unauthorized', message: 'The log needs the owner secret.' } }, {
        headers: { 'www-authenticate': 'Basic realm="CAP log", charset="UTF-8"' },
      })
      return true
    }

    const now = Date.now()
    const since = new Date(now - retentionHours * 3_600_000).toISOString()
    const messages = await store.recentMessages({ sinceIso: since, limit: LIMIT })
    const summary = summarize(messages)
    const truncated = messages.length >= LIMIT
    const privateHeaders = { 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' }

    if (url.searchParams.get('format') === 'json') {
      send(res, 200, {
        since,
        until: new Date(now).toISOString(),
        retention_hours: retentionHours,
        truncated,
        summary,
        messages: messages.map((msg) => ({
          id: msg.id,
          caller: msg.caller_id,
          account: msg.account || null,
          previous_id: msg.previous_id || null,
          status: msg.status,
          message: msg.message,
          context: msg.context || {},
          reply: msg.reply ?? null,
          error: msg.error || null,
          created_at: msg.created_at,
          finished_at: msg.finished_at || null,
          duration_ms: durationMs(msg),
          input_tokens: msg.input_tokens ?? null,
          output_tokens: msg.output_tokens ?? null,
        })),
      }, { headers: privateHeaders })
      return true
    }

    const nonce = randomBytes(16).toString('base64')
    send(res, 200, null, {
      type: 'text/html; charset=utf-8',
      headers: {
        ...privateHeaders,
        'x-frame-options': 'DENY',
        'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`,
      },
      raw: renderPage({ agentName, retentionHours, messages, summary, truncated, now, nonce }),
    })
    return true
  }

  return { handle, path }
}
