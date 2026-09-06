// Furn accuracy scorecard — runs the REAL router on real project packages and
// scores the result against what the owner confirmed is correct.
//
//   npm run eval            → every case under evals/fixtures/*
//   npm run eval -- <case>  → one case
//
// Each case = evals/fixtures/<case>/expected.json (committed) + files/ (NOT
// committed — customer documents). Needs the app's env (.env.local or the
// server's environment): AWS S3 + the AI provider. Every run COSTS AI calls,
// exactly like processing that project in the UI — run it deliberately.
//
// "99%" stops being a feeling and becomes a number you can read here.

import path from 'node:path'
import fs from 'node:fs'
import { registerTsLoader, loadEnvLocal } from './ts-loader.mjs'

const { root, require } = registerTsLoader()
loadEnvLocal(root)

const missing = ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET'].filter((k) => !process.env[k])
if (missing.length) {
  console.error(`لا يمكن تشغيل المقياس هنا — متغيرات البيئة ناقصة: ${missing.join(', ')}\nشغّله على السيرفر أو أضف .env.local (نفس مفاتيح التطبيق).`)
  process.exit(2)
}

const { uploadBufferToS3 } = require('@/lib/s3')
const { runBoqRouter } = require('@/lib/boq/router/pipeline')
const { thicknessFromText } = require('@/lib/boq/router/core')
const { validateRow } = require('@/lib/boq/router/validate')
const { isClearlyOutOfScope } = require('@/lib/boq/department-guard')
const { mimeFromName } = require('@/lib/ai/files')

const DEFAULT_DEPARTMENTS = [
  { name_en: 'Marble', name_ar: 'رخام' },
  { name_en: 'Granite', name_ar: 'جرانيت' },
]

const norm = (s) => String(s || '').toLowerCase().replace(/(\d)\s+(mm|cm|m2|m)\b/g, '$1$2').replace(/\s+/g, ' ').trim()
const includesAll = (hay, phrase) => norm(phrase).split(' ').every((w) => norm(hay).includes(w))
const unitFamily = (u) => {
  const n = norm(u).replace(/[²]/g, '2')
  if (['m2', 'sqm', 'sm', 'م2'].includes(n)) return 'area'
  if (['m', 'lm', 'mt', 'rm', 'متر', 'م', 'مط'].includes(n)) return 'length'
  if (['pcs', 'pc', 'no', 'nos', 'ea', 'unit', 'set', 'عدد'].includes(n)) return 'count'
  return n || 'other'
}

async function runCase(caseDir) {
  const spec = JSON.parse(fs.readFileSync(path.join(caseDir, 'expected.json'), 'utf8'))
  const filesDir = path.join(caseDir, 'files')
  const name = path.basename(caseDir)
  if (!fs.existsSync(path.join(filesDir, spec.boq))) throw new Error(`ملف الـBOQ غير موجود: ${path.join(filesDir, spec.boq)}`)

  const upload = async (fileName) => {
    const buffer = fs.readFileSync(path.join(filesDir, fileName))
    const up = await uploadBufferToS3({ buffer, key: `evals/${name}/${fileName}`, contentType: mimeFromName(fileName) })
    return { url: up.url, name: fileName }
  }
  const boq = await upload(spec.boq)
  const bucket = async (list) => Promise.all((list || []).map(upload))
  const [specFiles, drawingFiles, otherFiles] = await Promise.all([bucket(spec.spec), bucket(spec.drawing), bucket(spec.other)])

  const departments = spec.departments || DEFAULT_DEPARTMENTS
  const coveredNames = departments.flatMap((d) => [d.name_en, d.name_ar]).filter(Boolean)
  const started = Date.now()
  const result = await runBoqRouter({
    projectId: `eval-${name}-${Date.now()}`,
    boqUrl: boq.url, boqFilename: boq.name,
    specFiles, drawingFiles, otherFiles,
    coveredDepartments: departments,
    projectName: name, companyName: 'eval',
  })

  // The same post-processing the Furn route applies (headings out, clear
  // non-stone out); everything else is what the team would see in the table.
  const kept = []
  const dropped = []
  for (const it of result.items) {
    const text = `${it.description || ''} ${it.details || ''}`
    if (validateRow({ description: it.description, details: it.details, quantity: it.quantity, unit: it.unit }, coveredNames).drop) continue
    if (isClearlyOutOfScope(text, it.department_match, coveredNames)) { dropped.push(it.description); continue }
    kept.push(it)
  }

  const checks = []
  const expect = spec.expect || {}
  for (const e of expect.items || []) {
    const hit = kept.find((it) => includesAll(`${it.description} ${it.details || ''}`, e.match))
    if (!hit) { checks.push({ ok: false, what: `بند مفقود: "${e.match}"` }); continue }
    const problems = []
    if (e.quantity != null && Math.abs(Number(hit.quantity) - e.quantity) / Math.max(e.quantity, 1e-9) > 0.02) problems.push(`الكمية ${hit.quantity} ≠ ${e.quantity}`)
    if (e.unit && unitFamily(hit.unit) !== unitFamily(e.unit)) problems.push(`الوحدة ${hit.unit} ≠ ${e.unit}`)
    if (e.thickness_mm != null) {
      const t = thicknessFromText(hit.details) ?? thicknessFromText(hit.description)
      if (t !== e.thickness_mm) problems.push(`السماكة ${t ?? '—'} ≠ ${e.thickness_mm}`)
    }
    checks.push({ ok: problems.length === 0, what: `"${e.match}"${problems.length ? ' — ' + problems.join('، ') : ''}` })
  }
  for (const a of expect.absent || []) {
    const leak = kept.find((it) => norm(`${it.description} ${it.details || ''}`).includes(norm(a)))
    checks.push({ ok: !leak, what: leak ? `تسرّب بند خارج النطاق: "${leak.description}" (يحوي "${a}")` : `لا "${a}" في الجدول` })
  }
  if (expect.minItems != null || expect.maxItems != null) {
    const ok = (expect.minItems == null || kept.length >= expect.minItems) && (expect.maxItems == null || kept.length <= expect.maxItems)
    checks.push({ ok, what: `عدد البنود ${kept.length} (المتوقع ${expect.minItems ?? '…'}–${expect.maxItems ?? '…'})` })
  }

  const passed = checks.filter((c) => c.ok).length
  const outDir = path.join(root, 'evals', 'results')
  fs.mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(outFile, JSON.stringify({ case: name, confirmed: !!spec.confirmed, seconds: Math.round((Date.now() - started) / 1000), checks, kept, dropped, coverage: result.coverage, notes: result.notes }, null, 2))
  return { name, confirmed: !!spec.confirmed, passed, total: checks.length, checks, kept: kept.length, dropped: dropped.length, outFile }
}

const fixtures = path.join(root, 'evals', 'fixtures')
const only = process.argv[2]
const cases = fs.readdirSync(fixtures).filter((d) => fs.existsSync(path.join(fixtures, d, 'expected.json'))).filter((d) => !only || d === only).sort()
if (cases.length === 0) { console.error('لا توجد حالات في evals/fixtures'); process.exit(2) }

let allPassed = 0, allTotal = 0
for (const c of cases) {
  process.stdout.write(`\n▶ ${c} … `)
  try {
    const r = await runCase(path.join(fixtures, c))
    allPassed += r.passed; allTotal += r.total
    console.log(`${r.passed}/${r.total} ${r.passed === r.total ? '✅' : '❌'}  (بنود مقبولة ${r.kept}، مستبعدة ${r.dropped})${r.confirmed ? '' : '  [توقعات غير مؤكدة من المالك]'}`)
    for (const ch of r.checks) console.log(`   ${ch.ok ? '✓' : '✗'} ${ch.what}`)
    console.log(`   ↳ التفاصيل الكاملة: ${path.relative(root, r.outFile)}`)
  } catch (e) {
    console.log(`فشل: ${e instanceof Error ? e.message : e}`)
  }
}
const pct = allTotal ? Math.round((allPassed / allTotal) * 100) : 0
console.log(`\n═══ الدقة الإجمالية: ${allPassed}/${allTotal} = ${pct}% ═══`)
process.exit(allPassed === allTotal ? 0 : 1)
