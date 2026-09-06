// Shared zero-dependency TypeScript loader for the dev scripts (tests, evals).
// TypeScript is already a dependency, so `.ts` modules are transpiled on
// require and the project's `@/` alias is mapped to ./src. Nothing to install.

import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

export function registerTsLoader() {
  const require = createRequire(import.meta.url)
  const Module = require('module')
  const ts = require('typescript')
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

  const originalResolve = Module._resolveFilename
  Module._resolveFilename = function (request, parent, ...rest) {
    const mapped = request.startsWith('@/') ? path.join(root, 'src', request.slice(2)) : request
    return originalResolve.call(this, mapped, parent, ...rest)
  }
  Module._extensions['.ts'] = function (mod, filename) {
    const src = fs.readFileSync(filename, 'utf8')
    const out = ts.transpileModule(src, {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    mod._compile(out, filename)
  }
  return { root, require }
}

/** Minimal .env.local loader (KEY=VALUE lines) — no dotenv dependency. */
export function loadEnvLocal(root) {
  for (const name of ['.env.local', '.env']) {
    const p = path.join(root, name)
    if (!fs.existsSync(p)) continue
    for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq < 0) continue
      const key = line.slice(0, eq).trim()
      let val = line.slice(eq + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
      if (!(key in process.env)) process.env[key] = val
    }
  }
}
