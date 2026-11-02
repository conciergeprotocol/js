import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.5'

export function normalizeUrl(input) {
  const raw = String(input || '').trim()
  if (!raw) throw new Error('Pass the website, such as https://harborgoods.example.')
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  return url.origin
}

/** An `llms.txt` with links is the owner's own map of the site. Otherwise read the site. */
export async function detectSource(origin, fetchImpl = fetch) {
  const res = await fetchImpl(`${origin}/llms.txt`, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
  if (res?.ok && !/html/i.test(res.headers?.get?.('content-type') || '')) {
    const text = await res.text()
    if (/\]\(https?:\/\//.test(text)) return { type: 'llms', url: `${origin}/llms.txt` }
  }
  return { type: 'site', url: origin }
}

/** The name before the separator in the home page title, or the domain. */
export async function siteName(origin, fetchImpl = fetch) {
  const fallback = new URL(origin).hostname.replace(/^www\./, '')
  const res = await fetchImpl(origin, { signal: AbortSignal.timeout(10_000) }).catch(() => null)
  if (!res?.ok) return fallback
  const title = (await res.text()).match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || ''
  const parts = title.split(/\s+[|·–—-]\s+/).map((part) => part.trim()).filter(Boolean)
  if (!parts.length) return fallback
  const short = parts.length > 1 ? parts.reduce((a, b) => (b.length < a.length ? b : a)) : parts[0]
  return short.length <= 40 ? short : fallback
}

export function projectSlug(origin) {
  return new URL(origin).hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
}

export function projectFiles({ name, origin, source, dependencies }) {
  const instructions = `You are the concierge for ${name}, the website at ${origin}. Answer from the website. End each answer with the link to the page you used. When the site does not say, say so and link to ${origin}.`
  return {
    'package.json': `${JSON.stringify({
      name: `${projectSlug(origin)}-cap-door`,
      private: true,
      type: 'module',
      scripts: {
        start: 'node server.js',
        check: 'cap-check http://127.0.0.1:8088',
      },
      engines: { node: '>=22' },
      dependencies,
    }, null, 2)}\n`,
    'server.js': `import { existsSync } from 'node:fs'
import { createAnswer } from '@conciergeprotocol/agent'
import { createCapServer } from '@conciergeprotocol/server'

if (existsSync('.env')) process.loadEnvFile('.env')

const answer = await createAnswer({
  model: process.env.CAP_MODEL || ${JSON.stringify(DEFAULT_MODEL)},
  instructions: ${JSON.stringify(instructions)},
  sources: [${JSON.stringify(source)}],
  dailyTokens: Number(process.env.CAP_DAILY_TOKENS || 500_000),
})

const cap = await createCapServer({
  agent: { name: ${JSON.stringify(name)} },
  answer,
  dailyLimit: Number(process.env.CAP_DAILY_LIMIT || 50),
})

const { port } = await cap.listen()
console.log(\`CAP door on port \${port}\`)
`,
    '.env.example': `# AI Gateway key: https://vercel.com/docs/ai-gateway
AI_GATEWAY_API_KEY=

# The public origin of this door, such as https://cap.${new URL(origin).hostname.replace(/^www\./, '')}
PUBLIC_URL=

CAP_MODEL=${DEFAULT_MODEL}
# Model tokens per UTC day for the whole door, and messages per caller per day.
CAP_DAILY_TOKENS=500000
CAP_DAILY_LIMIT=50

# Postgres instead of the SQLite file in data/.
# DATABASE_URL=
`,
    '.gitignore': 'node_modules\n.env\ndata\n',
    Dockerfile: `FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
ENV PORT=8088
EXPOSE 8088
VOLUME /app/data
CMD ["node", "server.js"]
`,
    'README.md': `# ${name} CAP door

A [Concierge Agent Protocol](https://conciergeprotocol.org) door that answers AI agents from ${origin}.

## Run it

\`\`\`sh
cp .env.example .env   # add AI_GATEWAY_API_KEY
npm install
npm start
npm run check
\`\`\`

## Publish it

1. Deploy this folder to a host that keeps a disk, such as Fly or Railway with a volume at \`/app/data\`. On a host without a disk, set \`DATABASE_URL\` to Postgres and install \`pg\`.
2. Set \`PUBLIC_URL\` to the deployed origin.
3. Serve \`https://${new URL(origin).host}/agent.txt\` with the text from \`\${PUBLIC_URL}/agent.txt\`, or redirect that path to it.
4. Add this line to the \`<head>\` of the home page:

   \`\`\`html
   <link rel="agent" href="${origin}/agent.txt">
   \`\`\`

5. Check it at https://conciergeprotocol.org/check.
`,
  }
}

export function writeProject(dir, files, env = {}) {
  if (existsSync(dir) && readdirSync(dir).length) throw new Error(`${dir} is not empty.`)
  for (const [file, contents] of Object.entries(files)) {
    const path = join(dir, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, contents)
  }
  const lines = Object.entries(env).filter(([, value]) => value).map(([key, value]) => `${key}=${value}`)
  if (lines.length) writeFileSync(join(dir, '.env'), `${lines.join('\n')}\n`, { mode: 0o600 })
}
