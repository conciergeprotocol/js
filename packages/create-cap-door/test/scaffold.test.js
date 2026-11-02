import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { detectSource, normalizeUrl, projectFiles, siteName, writeProject } from '../src/scaffold.js'

async function serve(routes) {
  const server = createServer((req, res) => {
    const route = routes[req.url]
    if (!route) {
      res.statusCode = 404
      res.end('missing')
      return
    }
    res.setHeader('content-type', route.type || 'text/plain')
    res.end(route.body)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) }
}

test('a bare domain becomes an https origin', () => {
  assert.equal(normalizeUrl('harborgoods.example/shop'), 'https://harborgoods.example')
  assert.equal(normalizeUrl('http://127.0.0.1:3000/'), 'http://127.0.0.1:3000')
  assert.throws(() => normalizeUrl(''), /Pass the website/)
})

test('an llms.txt with links is used, otherwise the site is read', async () => {
  const withLlms = await serve({ '/llms.txt': { body: '# Harbor\n- [Hours](https://harborgoods.example/hours)\n' } })
  const withoutLinks = await serve({ '/llms.txt': { body: '# Harbor\nNothing here.' } })
  const htmlFallback = await serve({ '/llms.txt': { type: 'text/html', body: '<html>[a](https://x.example)</html>' } })
  try {
    assert.deepEqual(await detectSource(withLlms.origin), { type: 'llms', url: `${withLlms.origin}/llms.txt` })
    assert.deepEqual(await detectSource(withoutLinks.origin), { type: 'site', url: withoutLinks.origin })
    assert.deepEqual(await detectSource(htmlFallback.origin), { type: 'site', url: htmlFallback.origin })
  } finally {
    await Promise.all([withLlms.close(), withoutLinks.close(), htmlFallback.close()])
  }
})

test('the name is the short part of the home page title', async () => {
  const site = await serve({ '/': { type: 'text/html', body: '<title>Shoes for the coast | Harbor Goods</title>' } })
  try {
    assert.equal(await siteName(site.origin), 'Harbor Goods')
  } finally {
    await site.close()
  }
  assert.equal(await siteName('http://127.0.0.1:9'), '127.0.0.1')
})

test('the project answers from the source and keeps the key out of the files', () => {
  const files = projectFiles({
    name: 'Harbor "Goods"',
    origin: 'https://www.harborgoods.example',
    source: { type: 'site', url: 'https://www.harborgoods.example' },
    dependencies: { '@conciergeprotocol/agent': '^0.2.0', '@conciergeprotocol/server': '^0.3.0' },
  })
  const pkg = JSON.parse(files['package.json'])
  assert.equal(pkg.name, 'harborgoods-example-cap-door')
  assert.equal(pkg.dependencies['@conciergeprotocol/agent'], '^0.2.0')
  assert.match(files['server.js'], /sources: \[\{"type":"site","url":"https:\/\/www\.harborgoods\.example"\}\]/)
  assert.match(files['server.js'], /name: "Harbor \\"Goods\\""/)
  assert.match(files['README.md'], /<link rel="agent" href="https:\/\/www\.harborgoods\.example\/agent\.txt">/)
  assert.match(files['.gitignore'], /^\.env$/m)

  const dir = join(mkdtempSync(join(tmpdir(), 'cap-door-')), 'door')
  writeProject(dir, files, { AI_GATEWAY_API_KEY: 'key-123' })
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), 'AI_GATEWAY_API_KEY=key-123\n')
  assert.equal(statSync(join(dir, '.env')).mode & 0o777, 0o600)
  for (const file of Object.keys(files)) assert.doesNotMatch(readFileSync(join(dir, file), 'utf8'), /key-123/)
})

test('a folder that has files is not overwritten', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cap-door-'))
  writeFileSync(join(dir, 'keep.txt'), 'mine')
  assert.throws(() => writeProject(dir, { 'server.js': '' }), /not empty/)
})
