#!/usr/bin/env node
import { checkDoor } from './check.mjs'

const origin = process.argv[2]
if (!origin) {
  console.error('Usage: cap-check <origin>')
  process.exit(1)
}

const result = await checkDoor(origin)
if (result.ok) {
  console.log(`${origin} passes.`)
} else {
  for (const failure of result.failures) console.error(failure)
  process.exit(1)
}
