// Live probe for the link engine (no S3, no DB): resolves a share link,
// downloads + opens archives exactly like production, and lists what WOULD
// be stored. Usage:  node scripts/link-probe.mjs <url> [--resolve-only]
import { registerTsLoader } from './ts-loader.mjs'

const { require } = registerTsLoader()
const url = process.argv[2]
if (!url) { console.error('usage: node scripts/link-probe.mjs <url> [--resolve-only]'); process.exit(1) }

// Stub the S3 upload: the transpiled CJS calls `s3_1.uploadBufferToS3(...)` at
// call time, so replacing the export property is enough.
const s3 = require('@/lib/s3')
s3.uploadBufferToS3 = async ({ key, buffer, contentType }) => ({ key, url: `stub://${key}`, bytes: buffer.byteLength, contentType })

const t0 = Date.now()
if (process.argv.includes('--resolve-only')) {
  const { resolveLink } = require('@/lib/links/resolve')
  const r = await resolveLink(url)
  console.log(JSON.stringify({ ...r, files: r.files?.map((f) => ({ url: f.url.slice(0, 120), name: f.name })) }, null, 2))
} else {
  const { ingestLink } = require('@/lib/links/ingest')
  const r = await ingestLink({ url, kind: 'furn', userId: 'probe-user', folder: 'probe' })
  console.log(JSON.stringify({ status: r.status, provider: r.provider, message: r.message, notices: r.notices, files: r.files.map((f) => `${f.name}  (${Math.round(f.bytes / 1024)} KB)`) }, null, 2))
}
console.log(`done in ${Date.now() - t0} ms, rss ${Math.round(process.memoryUsage().rss / 1048576)} MB`)
