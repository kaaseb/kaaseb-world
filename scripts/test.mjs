// Zero-dependency test runner for the deterministic gates.
//
// Why not vitest/jest: nothing to install, nothing to configure. `.ts` modules
// are transpiled on require (see ts-loader.mjs) and tests use node's built-in
// `node:test`. Run with `npm test` — before every deploy, and before any PAID
// AI run.

import path from 'node:path'
import fs from 'node:fs'
import { registerTsLoader } from './ts-loader.mjs'

const { root, require } = registerTsLoader()
const dir = path.join(root, 'tests')
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.ts')).sort()
if (files.length === 0) { console.error('no tests found in ./tests'); process.exit(1) }
for (const f of files) require(path.join(dir, f))
