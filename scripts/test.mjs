// Zero-dependency test runner for the deterministic gates.
//
// Why not vitest/jest: nothing to install, nothing to configure. TypeScript is
// already a dependency, so `.ts` modules are transpiled on require and the
// project's `@/` alias is mapped to ./src. Tests use node's built-in `node:test`.
// Run with `npm test` — before every deploy, and before any PAID AI run.

import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const Module = require('module')
const ts = require('typescript')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// "@/lib/x" → <root>/src/lib/x
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
  const mapped = request.startsWith('@/') ? path.join(root, 'src', request.slice(2)) : request
  return originalResolve.call(this, mapped, parent, ...rest)
}

// Transpile TypeScript on require (CommonJS, modern target — no bundler needed).
Module._extensions['.ts'] = function (mod, filename) {
  const src = fs.readFileSync(filename, 'utf8')
  const out = ts.transpileModule(src, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  mod._compile(out, filename)
}

const dir = path.join(root, 'tests')
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.ts')).sort()
if (files.length === 0) { console.error('no tests found in ./tests'); process.exit(1) }
for (const f of files) require(path.join(dir, f))
