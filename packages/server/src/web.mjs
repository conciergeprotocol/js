import { Readable } from 'node:stream'

/**
 * Run the Node request handler for one Fetch API request.
 * The body stays paused until the handler reads it.
 */
export function handleWeb(handle, request) {
  const url = new URL(request.url)
  const headers = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })
  const req = Readable.from(bodyChunks(request))
  req.method = request.method
  req.url = `${url.pathname}${url.search}`
  req.headers = headers

  const chunks = []
  let status = 200
  let responseHeaders = {}
  const res = {
    headersSent: false,
    writeHead(code, next) {
      status = code
      responseHeaders = next || {}
      this.headersSent = true
    },
    end(body) {
      if (body != null && body !== '') chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(String(body)))
      this.headersSent = true
    },
  }

  return handle(req, res).then(() => {
    const webHeaders = new Headers()
    for (const [key, value] of Object.entries(responseHeaders)) {
      if (value != null) webHeaders.set(key, String(value))
    }
    const raw = Buffer.concat(chunks)
    return new Response(status === 204 ? null : raw, { status, headers: webHeaders })
  })
}

async function* bodyChunks(request) {
  if (!request.body) return
  const reader = request.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return
      yield value
    }
  } finally {
    reader.releaseLock()
  }
}
