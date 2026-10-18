import { readFileSync, writeFileSync } from 'node:fs'

const client = JSON.parse(readFileSync('packages/client/package.json', 'utf8'))
const file = 'packages/mcp/package.json'
const mcp = JSON.parse(readFileSync(file, 'utf8'))
mcp.dependencies['@conciergeprotocol/client'] = client.version
writeFileSync(file, `${JSON.stringify(mcp, null, 2)}\n`)
