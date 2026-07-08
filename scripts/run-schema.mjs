import postgres from 'postgres'
import fs from 'node:fs/promises'
import path from 'node:path'

const pw = process.env.SUPABASE_DB_PASSWORD
if (!pw) { console.error('SUPABASE_DB_PASSWORD env var required'); process.exit(1) }

const sql = postgres({
  host: 'aws-0-eu-central-1.pooler.supabase.com',
  port: 6543,
  database: 'postgres',
  user: 'postgres.kysojiumiwuqvcqakejq',
  password: pw,
  ssl: 'require',
  max: 1,
})

const file = path.resolve('src/lib/supabase/SCHEMA.sql')
const content = await fs.readFile(file, 'utf8')

console.log(`Running ${file} (${content.length} bytes)...`)
try {
  const res = await sql.unsafe(content)
  console.log('✓ Done')
  if (Array.isArray(res) && res.length) {
    console.log('Last result:')
    console.table(res.slice(0, 60))
  }
} catch (e) {
  console.error('✗ FAILED:', e.message)
  console.error('position:', e.position)
  process.exit(1)
} finally {
  await sql.end()
}
