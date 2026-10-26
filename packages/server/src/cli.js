#!/usr/bin/env node
import { boot } from './config.mjs'

const { server } = await boot()
const port = Number(process.env.PORT || 8088)
const host = process.env.HOST || '0.0.0.0'
server.listen(port, host, () => {
  console.log(`CAP server on http://${host}:${port}`)
})
