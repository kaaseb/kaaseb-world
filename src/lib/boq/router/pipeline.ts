// BOQ Router — the orchestrator.
//
//   1. EXTRACT   — read the BOQ ALONE (no attachments): rows + reference hints.
//   2. INDEX     — hash + index every attachment (cached; free for digital).
//   3. ROUTE     — explicit citations in code, everything else in ONE LLM call.
//   4. READ      — only the routed pages; text verified by quote, scans by
//                  double-read vision (numbers live in pixels there).
//   5. ASSEMBLE  — merge, with the conflict rule AGENTS.md mandates: drawings
//                  override the BOQ, loudly, never silently.
//
// EVERY row gets routed — including rows whose BOQ already states a quantity.
// That is deliberate and non-negotiable: the rows most likely to be wrong are
// the ones that look complete (a stale schematic figure), and you can only see
// a conflict if you open the drawing.
//
// The whole run reports progress to S3 so the UI can show honest coverage
// ("فُهرس 214/250") instead of letting a model claim it searched everything.

import { getProvider } from '@/lib/ai'
import { fetchAiFiles } from '@/lib/ai/files'
import type { JsonSchema } from '@/lib/ai/provider'
import type { BoqAnalysisResult, BoqExtractedItem, SkippedFile } from '@/lib/furn/boq'
import {
  AI_CALL_TIMEOUT_MS, INDEX_CONCURRENCY, MAX_INDEXED_ENTRIES, MAX_READ_GROUPS,
  MAX_SOURCES, READ_CONCURRENCY,
  makeProgressWriter, pooled, withTimeout,
  type Candidate, type IndexedFile, type Resolution, type RouterRow, type SourceBucket,
} from './core'
import { fetchSources, indexSource, type RawSource } from './indexer'
import { readTextPage, readVisualPage, resolveExplicitHint, routeRows, type ReadGroup } from './resolve'

const log = (msg: string) => console.log(`[راوتر] ${msg}`)

// Stated-vs-drawing disagreement below this relative difference is rounding
// noise, not a conflict.
const CONFLICT_TOLERANCE = 0.02

export interface RouterInput {
  projectId: string
  boqUrl: string
  boqFilename: string
  specFiles: { url: string; name: string }[]
  drawingFiles: { url: string; name: string }[]
  otherFiles: { url: string; name: string }[]
  coveredDepartments: { name_en: string; name_ar: string }[]
  projectName: string
  companyName: string
}

export interface RouterCoverage {
  filesTotal: number
  filesIndexed: number
  filesFromCache: number
  filesFailed: number
  pagesRead: number
  visualReads: number
  rowsResolved: number
  rowsConflict: number
  catalogTruncated: boolean
}

export type RouterResult = BoqAnalysisResult & { coverage: RouterCoverage }

// ─── phase 1: the BOQ alone ─────────────────────────────────────────────────

const PHASE1_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['subject', 'detected_departments', 'items', 'notes'],
  properties: {
    subject: { type: 'string', description: 'Short professional Subject line in English: "supply <core product>". Under 60 chars.' },
    detected_departments: {
      type: 'array', items: { type: 'string' },
      description: 'Every department seen in the BOQ (covered AND uncovered), canonical English names, deduplicated.',
    },
    items: {
      type: 'array',
      description: 'Rows belonging to COVERED departments only. Drop everything else (but record its department above).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'details', 'quantity', 'quantity_stated', 'unit', 'department_match', 'reference_hint', 'ai_confidence'],
        properties: {
          description: { type: 'string', description: 'SHORT catalog-style title, 3-8 words. No dimensions/finishes here.' },
          details: { type: 'string', description: 'LONG line: finish, thickness, color, dimensions — ONLY what this BOQ row itself states. Empty string if nothing.' },
          quantity: { type: 'number', description: 'The quantity AS WRITTEN IN THIS BOQ ROW. 0 when the row states none. NEVER invent — the attachments are read in a later phase, not by you.' },
          quantity_stated: { type: 'boolean', description: 'true only when this BOQ row itself contains the quantity number.' },
          unit: { type: 'string', description: 'Normalize to {m, m2, m3, pcs, kg, ton, set, lot, lm}.' },
          department_match: { type: 'string', description: 'The covered department (canonical English name from the list).' },
          reference_hint: { type: 'string', description: 'ONLY if the row explicitly points at another document ("as per Sold.pdf p.40", "refer A-301", "حسب جدول التشطيبات ورقة 2"), copy that pointer VERBATIM. This must be a real citation, NOT a description of the item. Empty string when the row has no explicit pointer — do NOT invent a search phrase; the next phase searches by the item description itself.' },
          ai_confidence: { type: 'number', description: '0..1 for description/unit/department correctness of THIS row.' },
        },
      },
    },
    notes: { type: 'string', description: 'General flags (ambiguous units, unreadable rows). Empty string if none.' },
  },
}

interface RawPhase1 {
  subject?: unknown
  detected_departments?: unknown
  items?: Array<Record<string, unknown>>
  notes?: unknown
}

async function extractBoqRows(input: RouterInput): Promise<{
  subject: string
  detectedDepartments: string[]
  rows: RouterRow[]
  notes: string | null
}> {
  const files = await fetchAiFiles(input.boqUrl, `BOQ: ${input.boqFilename}`)
  if (files.length === 0) throw new Error('تعذّرت قراءة ملف الـBOQ')

  const coveredList = input.coveredDepartments.map((d) => `- ${d.name_en} (${d.name_ar})`).join('\n')

  // The classification rules are the battle-tested ones from the single-call
  // engine (compound-name trap included). What changed: this phase sees the BOQ
  // ONLY, so it must never chase quantities — it records POINTERS instead, and
  // the router/reader phases resolve them against the real files.
  const systemInstruction = `You are an expert quantity surveyor at Kaaseb — a Saudi marble & granite supplier. You are reading a BOQ file (Excel/CSV, PDF table, scan, or a photograph of a paper BOQ — read images visually, every row, despite rotation/shadows/handwriting).

YOU SEE THE BOQ ONLY. The project's other attachments (specs, drawings, schedules) are processed in a LATER phase by a different system. Therefore:
- quantity = ONLY what this BOQ row itself states. If the row has no number, quantity=0 and quantity_stated=false. NEVER estimate or pull from memory.
- reference_hint = ONLY a real, explicit pointer the row makes to another document, copied verbatim ("as per Sold.pdf p.40", "refer to drawing A-301", "حسب جدول التشطيبات ورقة 2"). If the row has no explicit pointer, leave it EMPTY — do not paraphrase the item into a search phrase; the next phase searches by the description itself. A wrong pointer sends the search to the wrong file.
- Do NOT write "searched all attachments" — you searched nothing; that is not your job here.

DEPARTMENT CLASSIFICATION — COMPOUND-NAME TRAP (a real production failure):
"granite"/"marble" appearing in a description does NOT make the item granite or marble. The HEAD noun decides:
  "Precast Concrete Granite Wall Cladding" → Precast Concrete → drop.
  "GRC Panel with granite finish" → GRC → drop.
  "Terrazzo Tile Marble Pattern" → Terrazzo → drop.
  "Porcelain Granite-Effect Floor" → Porcelain → drop.
Disqualifying keywords (item is NOT ours if any appears as the product): concrete, precast, cast stone, GRC, GFRC, GRG, agglomerate, terrazzo, engineered quartz, sintered, porcelain, ceramic, vinyl, HPL, laminate, composite, faux, artificial stone, simulated, look, effect.
BUT the stone may legitimately sit ON such a material: "Marble tile on concrete screed" IS marble — the concrete is the substrate. Judge the head noun.
Dropped rows: record their real department in detected_departments[] (e.g. "Concrete", "Porcelain") so the admin can expand coverage.

RULES:
1. Items array = covered-department rows only. detected_departments = every department seen, covered and not, deduplicated, canonical English.
1b. POSITIVE MATERIAL REQUIRED. A row goes into items[] ONLY if its own text ties it to a covered stone — it names a covered material (marble/granite/limestone/quartz or a covered department) OR is unmistakably a natural-stone product. A row described only by FUNCTION or LOCATION with no stone material — "Staff dining vanity counter", "reception desk", "external rainscreen cladding", "stone panel" with just dimensions — is NOT a covered item: LEAVE IT OUT. Do not guess a department for it. When unsure, EXCLUDE it and record its section in detected_departments. (A deterministic gate drops these anyway — don't waste a row on them.)
2. Ranges: "150-200" → 200. "approx 200" → 200.
3. Units normalized to {m, m2, m3, pcs, kg, ton, set, lot, lm}.
4. description SHORT (3-8 words); details LONG (finish/thickness/color/dims from THIS row only). The team's notes column is not yours.
5. Merge rows only when descriptions are identical after normalization.
6. JSON only.

COVERED DEPARTMENTS:
${coveredList}

PROJECT: ${input.projectName} — ${input.companyName}`

  const provider = await getProvider()
  const parsed = await withTimeout(
    provider.generateStructured<RawPhase1>({
      systemInstruction,
      files,
      userText: 'Extract the BOQ rows now. Remember: quantities from THIS file only; pointers go into reference_hint. JSON only.',
      schema: PHASE1_SCHEMA,
      schemaName: 'boq_rows',
      temperature: 0.1,
    }),
    AI_CALL_TIMEOUT_MS,
    'قراءة الـBOQ',
  )

  const rows: RouterRow[] = (parsed.items || [])
    .map((it, i) => ({
      position: i + 1,
      description: String(it.description || '').trim(),
      details: it.details ? String(it.details).trim() || null : null,
      quantity: Number.isFinite(Number(it.quantity)) ? Math.max(0, Number(it.quantity)) : 0,
      quantityStated: it.quantity_stated === true && Number(it.quantity) > 0,
      unit: String(it.unit || 'm').trim(),
      department_match: it.department_match ? String(it.department_match).trim() : null,
      ai_confidence: Number.isFinite(Number(it.ai_confidence))
        ? Math.max(0, Math.min(1, Number(it.ai_confidence)))
        : 0.5,
      referenceHint: String(it.reference_hint || '').trim().slice(0, 200),
    }))
    .filter((r) => r.description)
    // Re-number after the filter so positions stay dense and stable.
    .map((r, i) => ({ ...r, position: i + 1 }))

  return {
    subject: (String(parsed.subject || '') || `supply ${input.projectName}`).trim().slice(0, 80),
    detectedDepartments: Array.from(
      new Set((Array.isArray(parsed.detected_departments) ? parsed.detected_departments : []).map((s) => String(s).trim()).filter(Boolean)),
    ),
    rows,
    notes: (String(parsed.notes || '')).trim() || null,
  }
}

// ─── phase 4 helpers: pick and read groups ──────────────────────────────────

interface RowState {
  row: RouterRow
  candidates: Candidate[]
  resolution: Resolution | null
  /** How many of this row's candidate pages were actually opened & read. Lets
   *  the assembler tell "searched, nothing found" from "never searched" (D7). */
  candidatesRead: number
}

// Dimensional families — an override across families (38 lm → 120 m²) is never
// a conflict to resolve, it's a mis-read to reject.
function unitFamily(u: string): 'length' | 'area' | 'volume' | 'count' | 'weight' | 'other' {
  const n = (u || '').toLowerCase().replace(/[²2]/g, '2').replace(/[³3]/g, '3').trim()
  if (['m', 'lm', 'mt', 'متر', 'م', 'مط', 'meter', 'rm'].includes(n)) return 'length'
  if (['m2', 'sqm', 'sm', 'م2', 'متر مربع'].includes(n)) return 'area'
  if (['m3', 'cbm', 'م3', 'متر مكعب'].includes(n)) return 'volume'
  if (['pcs', 'pc', 'no', 'no.', 'nos', 'عدد', 'حبة', 'قطعة', 'set', 'ea', 'unit'].includes(n)) return 'count'
  if (['kg', 'ton', 'كجم', 'طن'].includes(n)) return 'weight'
  return 'other'
}
function sameUnitFamily(a: string, b: string): boolean {
  const fa = unitFamily(a)
  const fb = unitFamily(b)
  if (fa === 'other' || fb === 'other') return true // unknown → don't block on it
  return fa === fb
}

function groupKey(c: Candidate): string {
  return `${c.sha}|${c.page ?? 0}`
}

/** One read round: take each pending row's next candidate, group by page, read.
 *  Text groups run first (cheap, quote-verified); visual after. */
async function readRound(
  states: RowState[],
  round: number,
  filesBySha: Map<string, IndexedFile>,
  budget: { groups: number },
  onGroupDone: (pagesRead: number, visual: boolean) => void,
): Promise<void> {
  const groups = new Map<string, ReadGroup>()
  for (const st of states) {
    if (st.resolution) continue
    const cand = st.candidates[round]
    if (!cand) continue
    const file = filesBySha.get(cand.sha)
    if (!file || file.kind === 'unreadable') continue
    const key = groupKey(cand)
    let g = groups.get(key)
    if (!g) {
      g = { file, page: cand.page, rows: [] }
      groups.set(key, g)
    }
    g.rows.push(st.row)
  }
  if (groups.size === 0) return

  const isTextGroup = (g: ReadGroup) => {
    const page = g.page ?? 1
    const p = g.file.pages.find((x) => x.page === page)
    return !!p?.text
  }
  const ordered = [...groups.values()].sort((a, b) => Number(isTextGroup(b)) - Number(isTextGroup(a)))

  // Take only as many groups as the shared budget allows, then read them with
  // bounded concurrency (was fully serial → up to ~30 min wall-clock on a big
  // visual project). Each row whose group is opened counts as "read".
  const toRead = ordered.slice(0, Math.max(0, budget.groups))
  if (toRead.length < ordered.length) {
    log(`ميزانية القراءة: ${toRead.length}/${ordered.length} مجموعة هذه الجولة (تغطية جزئية مُعلنة)`)
  }
  budget.groups -= toRead.length

  const posInGroup = (g: ReadGroup) => new Set(g.rows.map((r) => r.position))
  const stByPos = new Map(states.map((s) => [s.row.position, s]))

  await pooled(toRead, READ_CONCURRENCY, async (g) => {
    const visual = !isTextGroup(g)
    const inGroup = posInGroup(g)
    for (const st of states) if (inGroup.has(st.row.position)) st.candidatesRead++
    try {
      const results = visual ? await readVisualPage(g) : await readTextPage(g)
      for (const res of results) {
        const st = stByPos.get(res.position)
        // First writer wins; earlier rounds/higher-rank candidates come first.
        if (st && !st.resolution) st.resolution = res
      }
      onGroupDone(1, visual)
      log(`قراءة ${g.file.name} ص${g.page ?? 1} (${visual ? 'بصري' : 'نص'}): ${results.length}/${g.rows.length} بند`)
    } catch (e) {
      onGroupDone(0, visual)
      log(`فشل قراءة ${g.file.name} ص${g.page ?? 1}: ${e instanceof Error ? e.message : e}`)
    }
  })
}

// ─── the pipeline ───────────────────────────────────────────────────────────

export async function runBoqRouter(input: RouterInput): Promise<RouterResult> {
  const progress = makeProgressWriter(input.projectId)
  const skippedFiles: SkippedFile[] = []

  // Phase 1 — the BOQ alone.
  await progress.push({ stage: 'extracting', message: 'قراءة جدول الكميات…' })
  const boq = await extractBoqRows(input)
  await progress.push({ rowsTotal: boq.rows.length, message: `استُخرج ${boq.rows.length} بند` })
  log(`phase1: ${boq.rows.length} rows, ${boq.detectedDepartments.length} departments`)

  // Phase 2 — index the attachments.
  const sources: Array<{ url: string; name: string; bucket: SourceBucket }> = [
    ...input.specFiles.map((f) => ({ ...f, bucket: 'spec' as const })),
    ...input.drawingFiles.map((f) => ({ ...f, bucket: 'drawing' as const })),
    ...input.otherFiles.map((f) => ({ ...f, bucket: 'other' as const })),
  ].slice(0, MAX_SOURCES)

  await progress.push({ stage: 'indexing', filesTotal: sources.length, message: 'فهرسة الملفات…' })

  const indexed: IndexedFile[] = []
  let filesFromCache = 0
  let filesFailed = 0
  let entryCount = 0 // entries indexed AFTER zip expansion — the real cost driver
  let entryCapHit = false
  let done = 0

  await pooled(sources, INDEX_CONCURRENCY, async (src) => {
    let raws: RawSource[] = []
    try {
      raws = await fetchSources(src.url, src.name, src.bucket)
    } catch (e) {
      filesFailed++
      skippedFiles.push({ name: src.name, reason: e instanceof Error ? e.message : 'تعذّر التحميل' })
    }
    for (const raw of raws) {
      // Cap TOTAL indexed entries, not just upload URLs — a few zipped-scan
      // archives could otherwise expand into thousands of vision calls.
      if (entryCount >= MAX_INDEXED_ENTRIES) {
        entryCapHit = true
        skippedFiles.push({ name: raw.ref.name, reason: `تجاوز حد الفهرسة (${MAX_INDEXED_ENTRIES} ملف)` })
        continue
      }
      entryCount++
      try {
        const { file, cached } = await indexSource(raw)
        indexed.push(file)
        if (cached) filesFromCache++
        if (file.kind === 'unreadable') {
          filesFailed++
          skippedFiles.push({ name: file.name, reason: file.error || 'غير مقروء' })
        }
      } catch (e) {
        filesFailed++
        skippedFiles.push({ name: raw.ref.name, reason: e instanceof Error ? e.message : 'فشل الفهرسة' })
      }
    }
    done++
    await progress.push({ filesTotal: entryCount, filesDone: done, filesFailed, message: `فهرسة الملفات ${done}/${sources.length}` })
  })

  const readable = indexed.filter((f) => f.kind !== 'unreadable')
  log(`phase2: indexed ${indexed.length} (cache ${filesFromCache}, failed ${filesFailed})`)

  // Phase 3 — routing. Explicit citations first (deterministic, rank 2), then
  // ONE semantic call for everything; both feed the same candidate lists.
  await progress.push({ stage: 'routing', message: 'توجيه البنود إلى الملفات…' })
  let catalogTruncated = false
  const states: RowState[] = boq.rows.map((row) => ({
    row,
    candidates: resolveExplicitHint(row.referenceHint, readable),
    resolution: null,
    candidatesRead: 0,
  }))

  if (readable.length > 0 && boq.rows.length > 0) {
    try {
      const routed = await routeRows(boq.rows, readable)
      catalogTruncated = routed.catalogTruncated
      for (const st of states) {
        const extra = routed.byRow.get(st.row.position) || []
        // Explicit citations outrank; semantic candidates fill the tail. Dedup
        // by page so a candidate isn't read twice.
        const seen = new Set(st.candidates.map(groupKey))
        for (const c of extra) {
          const k = groupKey(c)
          if (!seen.has(k)) {
            st.candidates.push(c)
            seen.add(k)
          }
        }
      }
    } catch (e) {
      // Routing failing must not kill the run — explicit citations still work,
      // and unresolved rows degrade to an honest "not found" with coverage.
      log(`routing call failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  // Phase 4 — read the routed pages, cheapest-first, bounded.
  const filesBySha = new Map(readable.map((f) => [f.sha, f]))
  const budget = { groups: MAX_READ_GROUPS }
  let pagesRead = 0
  let visualReads = 0
  const totalCandidateGroups = new Set(states.flatMap((s) => s.candidates.map(groupKey))).size
  await progress.push({
    stage: 'reading',
    readGroupsTotal: Math.min(totalCandidateGroups, MAX_READ_GROUPS),
    message: 'قراءة الصفحات الموجّهة…',
  })

  for (let round = 0; round < 3; round++) {
    const pending = states.filter((s) => !s.resolution && s.candidates[round]).length
    if (pending === 0 || budget.groups <= 0) break
    await readRound(states, round, filesBySha, budget, (n, visual) => {
      pagesRead += n
      if (visual && n > 0) visualReads++
      void progress.push({
        pagesRead,
        rowsResolved: states.filter((s) => s.resolution).length,
        message: `قراءة الصفحات… (${pagesRead} صفحة)`,
      })
    })
  }

  // Phase 5 — assemble.
  await progress.push({ stage: 'assembling', message: 'تجميع النتائج…' })
  let rowsConflict = 0
  let rowsUnsearched = 0
  const coverageLine = `فُهرس ${readable.length}/${entryCount} ملفاً${filesFailed > 0 ? ` (تعذّر ${filesFailed})` : ''}، وقُرئت ${pagesRead} صفحة موجّهة`

  const items: BoqExtractedItem[] = states.map(({ row, resolution, candidates, candidatesRead }) => {
    let quantity = row.quantity
    let details = row.details
    let confidence = row.ai_confidence
    let source: string

    const cite = resolution
      ? `${resolution.fileName}${resolution.page ? ` ص${resolution.page}` : ''}`
      : null
    const quoteBit = resolution ? ` — «${resolution.quote.slice(0, 90)}»` : ''
    const verifyBit = resolution
      ? resolution.verified === 'quote' ? ' (تحقق نصي)' : ' (قراءة بصرية مزدوجة)'
      : ''
    const isDrawing = resolution?.bucket === 'drawing'
    const unitsCompatible = resolution ? sameUnitFamily(resolution.unit, row.unit) : true

    const addNote = (n: string) => { details = details ? `${n}\n${details}` : n }

    if (resolution && row.quantityStated) {
      const diff = Math.abs(resolution.value - row.quantity) / Math.max(row.quantity, 1e-9)
      if (diff <= CONFLICT_TOLERANCE) {
        // The source agrees with the BOQ — strongest possible signal.
        source = `BOQ؛ تأكدت من ${cite}${verifyBit}`
        confidence = Math.max(confidence, 0.9)
      } else if (!unitsCompatible) {
        // A length can't override an area. This is a mis-read, not a conflict —
        // KEEP the BOQ number, flag for review. (The old code overwrote 120 m²
        // with 38 lm and printed "38 m²".)
        rowsConflict++
        addNote(`⚠️ تحقّق يدوي: الـBOQ يقول ${row.quantity} ${row.unit} لكن ${cite} يذكر ${resolution.value} ${resolution.unit} (وحدة مختلفة الجنس) — أُبقي رقم الـBOQ، راجعه.`)
        source = `BOQ (تعارض وحدة مع ${cite} — لم يُعتمد)`
        confidence = Math.min(confidence, 0.55)
      } else if (isDrawing) {
        // AGENTS.md: DRAWINGS (and only drawings) override the BOQ — loudly.
        rowsConflict++
        quantity = resolution.value
        addNote(`⚠️ تعارض كمية: الـBOQ يقول ${row.quantity} ${row.unit}، والرسمة ${cite} تقول ${resolution.value} ${resolution.unit || row.unit} — اعتُمد رقم الرسمة (الرسومات تتفوق).`)
        source = `${cite}${quoteBit}${verifyBit}`
        confidence = Math.min(confidence, 0.7)
      } else {
        // A spec/other source disagrees. It is NOT drawing authority — do not
        // silently overwrite a stated BOQ quantity; surface both for a human.
        rowsConflict++
        addNote(`⚠️ تحقّق يدوي: الـBOQ يقول ${row.quantity} ${row.unit}، والمصدر ${cite} يقول ${resolution.value} ${resolution.unit || row.unit} — أُبقي رقم الـBOQ (المصدر ليس رسمة)، راجعه.`)
        source = `BOQ (يخالف ${cite} — لم يُعتمد تلقائياً)`
        confidence = Math.min(confidence, 0.6)
      }
    } else if (resolution) {
      // Row had no BOQ quantity — take the resolved number, but never accept it
      // under a dimensionally-incompatible unit.
      if (!unitsCompatible) {
        addNote(`⚠️ ${cite} يذكر ${resolution.value} ${resolution.unit}، ووحدة الـBOQ "${row.unit}" مختلفة الجنس — لم تُعتمد الكمية، راجعها يدوياً.`)
        source = `${coverageLine} — وجد رقم بوحدة غير متوافقة في ${cite}، يحتاج مراجعة`
        confidence = Math.min(confidence, 0.4)
      } else {
        quantity = resolution.value
        source = `${cite}${quoteBit}${verifyBit}`
        confidence = Math.max(confidence, resolution.visual ? 0.7 : 0.8)
      }
    } else if (row.quantityStated) {
      // Stated in the BOQ; a candidate MAY have existed but wasn't opened.
      source = candidates.length > 0 && candidatesRead === 0
        ? `BOQ (لم يُتحقق من المصادر — تجاوزنا حد القراءة، راجع يدوياً)`
        : 'BOQ'
    } else if (candidatesRead > 0) {
      // We DID open candidate pages and found nothing — honest searched-empty.
      source = `${coverageLine} — بحثنا الصفحات المرشّحة ولم نجد كمية لهذا البند`
      confidence = Math.min(confidence, 0.4)
    } else {
      // We never opened a page for it (no candidate, or budget/truncation) —
      // say THAT, not "searched and not found".
      rowsUnsearched++
      source = candidates.length === 0
        ? `${coverageLine} — لم يُوجَّه هذا البند لأي ملف`
        : `${coverageLine} — لم تُقرأ صفحات هذا البند (تجاوزنا حد القراءة)`
      confidence = Math.min(confidence, 0.35)
    }

    return {
      description: row.description,
      details,
      quantity,
      unit: row.unit,
      department_match: row.department_match,
      ai_confidence: confidence,
      source,
    }
  })

  const rowsResolved = states.filter((s) => s.resolution).length
  const noteParts = [
    boq.notes,
    coverageLine,
    rowsConflict > 0 ? `${rowsConflict} بند فيه تعارض/تحقّق يدوي — راجع الملاحظات.` : null,
    rowsUnsearched > 0 ? `${rowsUnsearched} بند لم تُقرأ مصادره (بلا كمية موثّقة) — يحتاج مراجعة يدوية.` : null,
    entryCapHit ? `عدد الملفات تجاوز حد الفهرسة (${MAX_INDEXED_ENTRIES}) — بعضها لم يُفهرس.` : null,
    catalogTruncated ? 'فهرس التوجيه اختُصر لكبر عدد الملفات — بعض المرشحين لم يُعرض.' : null,
    budget.groups <= 0 ? 'وُقفت القراءة عند حد الصفحات — بعض البنود لم تُقرأ صفحاتها المرشحة.' : null,
  ].filter(Boolean)

  await progress.push({ stage: 'done', rowsResolved, message: `اكتمل — ${rowsResolved}/${boq.rows.length} بند تم حسمه من المصادر` })

  return {
    subject: boq.subject,
    detected_departments: boq.detectedDepartments,
    items,
    notes: noteParts.length ? noteParts.join(' • ') : null,
    skippedFiles,
    filesSent: readable.length + 1, // +1 = the BOQ itself
    coverage: {
      filesTotal: entryCount,
      filesIndexed: readable.length,
      filesFromCache,
      filesFailed,
      pagesRead,
      visualReads,
      rowsResolved,
      rowsConflict,
      catalogTruncated,
    },
  }
}
