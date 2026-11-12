const FROM = 'agent:cap-check'
const OTHER = 'agent:cap-check-other'

/**
 * Checks a door has to pass: agent.txt, the login metadata when there is an
 * OAuth line, one answered question, and a second caller who cannot read it.
 */
export async function checkDoor(origin, options = {}) {
  const fetchImpl = options.fetch || fetch
  const root = String(origin || '').replace(/\/$/, '')
  const failures = []
  const fail = (message) => failures.push(message)
  if (!root) return { ok: false, failures: ['Pass the door origin, such as http://127.0.0.1:8088.'] }

  let card = ''
  try {
    const cardRes = await fetchImpl(`${root}/agent.txt`)
    card = await cardRes.text()
    if (cardRes.status !== 200) fail(`agent.txt returned ${cardRes.status}.`)
  } catch (err) {
    fail(`agent.txt could not be fetched: ${err.message}`)
  }
  if (card && !card.startsWith('Protocol: CAP/1.0')) fail('agent.txt must start with Protocol: CAP/1.0.')
  const capLine = card.split('\n').find((line) => line.startsWith('CAP: '))
  const capUrl = capLine ? capLine.slice(5).trim() : ''
  if (capLine && !/^https?:\/\//.test(capUrl)) fail('agent.txt needs an http or https CAP URL.')
  if (card && !capLine) fail('agent.txt needs a CAP line.')
  const oauthLine = card.split('\n').find((line) => line.startsWith('OAuth:'))
  const oauthUrl = oauthLine ? oauthLine.slice('OAuth:'.length).trim() : ''
  if (oauthUrl) await checkLogin(fetchImpl, oauthUrl, capUrl, fail)

  const headers = {
    'content-type': 'application/json',
    'cap-version': '1.0',
    'cap-from': FROM,
  }
  const timeoutMs = options.timeoutMs ?? 25_000
  let id = ''
  try {
    const done = await ask(fetchImpl, root, headers, options.message || 'What can you help with?', timeoutMs)
    if (done.body?.status !== 'done' || typeof done.body.reply !== 'string') {
      fail('The question did not finish with a reply.')
    }
    id = done.body?.id || ''
  } catch (err) {
    fail(err.message)
  }

  if (id) {
    try {
      const other = await fetchImpl(`${root}/cap/v1/messages/${encodeURIComponent(id)}`, {
        headers: { ...headers, 'cap-from': OTHER },
      })
      if (other.status !== 404) fail('A second caller could read the reply.')
    } catch (err) {
      fail(`The second caller check failed: ${err.message}`)
    }
  }

  return { ok: failures.length === 0, failures }
}

async function ask(fetchImpl, root, headers, message, timeoutMs) {
  let res = await fetchImpl(`${root}/cap/v1/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message }),
  })
  let body = await readJson(res)
  const deadline = Date.now() + timeoutMs
  while (res.status === 202 || body?.status === 'working') {
    if (Date.now() > deadline) throw new Error('The question was not answered in time.')
    const loc = res.headers.get('location')
    const own = `${root}/cap/v1/messages/${encodeURIComponent(body?.id || '')}`
    let url = own
    if (loc) {
      const target = new URL(loc, own)
      if (target.origin === new URL(root).origin) url = target.href
      else throw new Error(`The 202 Location is on ${target.origin}. Keep it on ${new URL(root).origin}.`)
    }
    const retryAfter = Number(res.headers.get('retry-after') || 1)
    const wait = Math.min((Number.isFinite(retryAfter) ? retryAfter : 1) * 1000, 2000)
    await new Promise((resolve) => setTimeout(resolve, wait))
    res = await fetchImpl(url, { headers })
    body = await readJson(res)
  }
  return { res, body }
}

async function checkLogin(fetchImpl, oauthUrl, capUrl, fail) {
  let issuer
  try {
    issuer = new URL(oauthUrl)
  } catch {
    fail('The OAuth line must be an http or https URL.')
    return
  }
  if (issuer.protocol !== 'https:' && issuer.protocol !== 'http:') {
    fail('The OAuth line must be an http or https URL.')
    return
  }
  const path = issuer.pathname === '/' ? '' : issuer.pathname.replace(/\/$/, '')
  try {
    const res = await fetchImpl(`${issuer.origin}/.well-known/oauth-authorization-server${path}`)
    if (res.status !== 200) {
      fail(`The OAuth metadata returned ${res.status}.`)
      return
    }
    const meta = await res.json()
    if (meta?.issuer !== oauthUrl) {
      fail(`The metadata's issuer is ${meta?.issuer || 'missing'}. It must match the OAuth line, ${oauthUrl}, exactly.`)
    }
    const resources = Array.isArray(meta?.protected_resources) ? meta.protected_resources : []
    if (!resources.includes(capUrl)) {
      fail(`Add protected_resources: ["${capUrl}"] to the OAuth metadata. Visiting agents will not log in without it.`)
    }
  } catch (err) {
    fail(`The OAuth metadata could not be read: ${err.message}`)
  }
}

async function readJson(res) {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
