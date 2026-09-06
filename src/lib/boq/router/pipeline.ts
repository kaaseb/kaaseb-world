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
import type { AiFile, JsonSchema } from '@/lib/ai/provider'
import { decodeTextFile, splitBoqText, CONTEXT_PREFIX } from './chunk'
import { supersededMap } from './revision'
import type { BoqAnalysisResult, BoqExtractedItem, SkippedFile } from '@/lib/furn/boq'
import {
  AI_CALL_TIMEOUT_MS, INDEX_CONCURRENCY, MAX_INDEXED_ENTRIES, MAX_READ_GROUPS,
  MAX_SOURCES, READ_CONCURRENCY,
  detailsStateThickness, hasAnyAttr, makeProgressWriter, mergeAttrs, normalizeText,
  pooled, thicknessFromText, withTimeout,
  type AttrResolution, type Candidate, type IndexedFile, type Resolution, type RouterRow, type SourceBucket,
} from './core'
import { fetchSources, indexSource, type RawSource } from './indexer'
import { readTextPage, readVisualPage, resolveExplicitHint, routeRows, type ReadGroup } from './resolve'

const log = (msg: string) => console.log(`[راوتر] ${msg}`)

// Stated-vs-drawing disagreement below this relative difference is rounding
// noise, not a conflict.
const CONFLICT_TOLERANCE = 0.02

export interface RouterInput {
  projectId: string
  // Optional now: a project may arrive as drawings only. When absent, items are
  // extracted from the drawings/specs instead of a BOQ table.
  boqUrl: string | null
  boqFilename: string
  specFiles: { url: string; name: string }[]
  drawingFiles: { url: string; name: string }[]
  otherFiles: { url: string; name: string }[]
  coveredDepartments: { name_en: string; name_ar: string }[]
  projectName: string
  companyName: string
}

// When there's no BOQ, how many drawing/spec files we feed the extractor. Capped
// so a drawings-only run stays "خفيف" — vision over every one of 200 sheets is
// exactly the token spike we avoid elsewhere.
const DRAWINGS_FOR_EXTRACTION = 6

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
        required: ['description', 'details', 'section', 'quantity', 'quantity_stated', 'unit', 'department_match', 'reference_hint', 'ai_confidence'],
        properties: {
          description: { type: 'string', description: 'SHORT catalog-style title, 3-8 words. No dimensions/finishes here. If the row is identified by a CODE (e.g. MA-003, K-RL21B), the title is the CODE itself, not the stone name.' },
          details: { type: 'string', description: 'ONE line, in THIS ORDER, only what the row states (omit any part not stated): thickness – finish/treatment – size – type – colour. Empty string if nothing.' },
          section: { type: 'string', description: 'The SHEET/section heading this row falls under — for a multi-sheet Excel it is the tab name (the "## Sheet: X" it appears beneath). Empty string if there is only one sheet / no heading.' },
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

// One item per Excel sheet becomes a section header on the pricing screen only.

async function extractBoqRows(input: RouterInput): Promise<{
  subject: string
  detectedDepartments: string[]
  rows: RouterRow[]
  notes: string | null
}> {
  const drawingsMode = !input.boqUrl
  let files
  if (input.boqUrl) {
    files = await fetchAiFiles(input.boqUrl, `BOQ: ${input.boqFilename}`)
  } else {
    // No BOQ → extract the items from the drawings/specs themselves (capped).
    const src = [...input.drawingFiles, ...input.specFiles, ...input.otherFiles].slice(0, DRAWINGS_FOR_EXTRACTION)
    files = []
    for (const f of src) {
      try { files.push(...(await fetchAiFiles(f.url, `Drawing: ${f.name}`))) } catch { /* skip a bad file */ }
    }
  }
  if (files.length === 0) throw new Error(drawingsMode ? 'لا توجد رسومات لاستخراج البنود' : 'تعذّرت قراءة ملف الـBOQ')

  const coveredList = input.coveredDepartments.map((d) => `- ${d.name_en} (${d.name_ar})`).join('\n')

  // Drawings-only extraction needs a different opening — there's no table to
  // read down; the model must FIND the stone elements in the drawings.
  const sourceBrief = drawingsMode
    ? `THERE IS NO BOQ TABLE. You are reading DRAWINGS / SPEC sheets (mostly images — read them visually). Identify EVERY distinct natural-stone element shown or specified: flooring, wall cladding, stairs (treads/risers), skirtings, copings, thresholds, sills, pavers, countertops, facades. For each, capture whatever the drawing states — dimensions, thickness, finish, colour, drawing/type code — and a quantity ONLY if a count/area is written (never measure geometry). One item per distinct element/type.`
    : `You are reading a BOQ file (Excel/CSV, PDF table, scan, or a photograph of a paper BOQ — read images visually, every row, despite rotation/shadows/handwriting).`

  // The classification rules are the battle-tested ones from the single-call
  // engine (compound-name trap included). What changed: this phase sees the BOQ
  // ONLY, so it must never chase quantities — it records POINTERS instead, and
  // the router/reader phases resolve them against the real files.
  const systemInstruction = `You are an expert quantity surveyor at Kaaseb — a Saudi marble & granite supplier. ${sourceBrief}

The project's OTHER attachments are indexed and read in a LATER phase by a different system. Therefore, in THIS phase:
- quantity = ONLY what THIS source itself states/shows. If none, quantity=0 and quantity_stated=false. NEVER estimate, measure geometry, or pull from memory.
- reference_hint = ONLY a real, explicit pointer to another document, copied verbatim ("as per Sold.pdf p.40", "refer to drawing A-301", "حسب جدول التشطيبات ورقة 2"). No explicit pointer → leave it EMPTY (the next phase searches by the description itself). A wrong pointer sends the search to the wrong file.
- Do NOT write "searched all attachments" — that's not your job here.

DEPARTMENT CLASSIFICATION — COMPOUND-NAME TRAP (a real production failure):
"granite"/"marble" appearing in a description does NOT make the item granite or marble. The HEAD noun decides:
  "Precast Concrete Granite Wall Cladding" → Precast Concrete → NOT ours.
  "GRC Panel with granite finish" → GRC → NOT ours.
  "Terrazzo Tile Marble Pattern" → Terrazzo → NOT ours.
  "Porcelain Granite-Effect Floor" → Porcelain → NOT ours.
Disqualifying keywords (NOT ours if any is the product): concrete, precast, cast stone, GRC, GFRC, GRG, agglomerate, terrazzo, engineered quartz, sintered, porcelain, ceramic, vinyl, HPL, laminate, composite, faux, artificial stone, simulated, look, effect.
BUT the stone may legitimately sit ON such a material: "Marble tile on concrete screed" IS marble — the concrete is the substrate. Judge the head noun.
For a NOT-ours row: STILL include it (never silently omit), set its real department, and add that department to detected_departments[] — a deterministic gate marks it for the team to reject.

RULES:
1. Items array = covered-department rows only. detected_departments = every department seen, covered and not, deduplicated, canonical English.
1b. NEVER DROP A REQUESTED LINE. Include EVERY BOQ line in items[] — never silently omit anything the customer asked for (a missing line is the worst failure). If a row's material is unclear, or it looks like a manufactured look-alike (concrete / GRC / porcelain / terrazzo / engineered quartz…), STILL include it and be honest in details about what's uncertain — a deterministic gate marks doubtful rows "needs review" for the team to approve or reject. The ONLY thing forbidden is INVENTING a material/finish/size that the row doesn't state. When a row clearly isn't ours, include it AND record its real department in detected_departments.
2. Ranges: "150-200" → 200. "approx 200" → 200.
3. Units normalized to {m, m2, m3, pcs, kg, ton, set, lot, lm}.
4. description = SHORT catalog title (3-8 words) — or the CODE if the row is identified by one (MA-003…). details = one line in THIS ORDER, only what's stated: السماكة – نوع المعالجة/الفنش – المقاس – النوع – اللون (thickness – finish – size – type – colour). Omit any part the row doesn't state. The team's notes column is not yours.
5. Merge rows only when descriptions are identical after normalization (this is NOT the parent/child case below).
6. JSON only.

TABLE STRUCTURE — real BOQs are never one-row-per-item. Every company lays its table out differently; apply these EXACTLY:
7. PARENT + SUB-ITEMS: a row with NO quantity followed by lettered/numbered sub-rows (A, B, C… / 1, 2, 3… / i, ii…) is a PARENT. Its specs (material, thickness, finish, ref code, "as shown on drawings"…) apply to EVERY child. Emit ONE item PER CHILD: description = the parent's product + the child's variant (e.g. "Granite threshold 90mm wide", "Terrazzo floor ST-02 beige"); details = parent specs + child specs; quantity/unit = the child's own. NEVER emit the parent alone as an item, and NEVER emit a child stripped of its parent's specs.
8. TWO-ROW ITEMS: a title row (item number + long description, no qty) immediately followed by a row carrying the short name/code + unit + qty = ONE item — merge both rows.
9. WRAPPED TEXT: a description that continues over several rows (continuation rows have no item number and no qty) is ONE item.
10. LOCATION COLUMNS: if a row has a TOTAL quantity plus a per-room/per-zone breakdown in extra columns (LIV, Toilet 1, H1P…), quantity = the TOTAL and put the breakdown in details ("LIV 900, H1P 150…"). If instead the file repeats the same item as SEPARATE rows per building/zone (S1, H1…), keep them as separate items with the zone in details — mirror the file. Only when the file gives neither a total nor per-zone rows, sum what it lists.
11. CODES: if a row is identified by a code (ST-01, PV-01, EXT-199, MA-003) whose material/colour/finish is NOT stated on the row, keep the code in description and write "كود: <code>" in details — its meaning lives in a legend/spec that a later phase reads. Do NOT guess what a code means.
12. SECTION HEADERS ("WALL FINISHES", "DIVISION 09", "Internal Threshold Finishes", "BILL NO. 2") are NOT items — never emit them as items; use them as the section field.

COVERED DEPARTMENTS:
${coveredList}

PROJECT: ${input.projectName} — ${input.companyName}`

  const provider = await getProvider()
  const userText = drawingsMode
    ? 'Extract every distinct stone element from these drawings/specs now. Quantity only if written; put thickness/finish/size/colour into details; explicit pointers into reference_hint. JSON only.'
    : 'Extract the BOQ rows now. Quantities from THIS file only; pointers go into reference_hint. JSON only.'
  const callPhase1 = (fs: AiFile[], partNote: string, label: string) => withTimeout(
    provider.generateStructured<RawPhase1>({
      systemInstruction: systemInstruction + partNote,
      files: fs,
      userText,
      schema: PHASE1_SCHEMA,
      schemaName: 'boq_rows',
      temperature: 0.1,
    }),
    AI_CALL_TIMEOUT_MS,
    label,
  )

  // LARGE BOQ: a text BOQ (Excel/CSV, or a PDF whose text extracted) past the
  // trigger would blow the model's output budget in one call and silently lose
  // its tail. It is split at section/blank boundaries — never mid-item — and
  // read part by part, each part carrying the sheet + column headers as
  // "# CONTEXT" lines. Small BOQs: one call, exactly as before.
  const textBoq = !drawingsMode && files.length === 1 && (files[0].mimeType === 'text/csv' || files[0].mimeType === 'text/plain') ? files[0] : null
  const chunks = textBoq ? splitBoqText(decodeTextFile(textBoq.data)) : []
  let parsed: RawPhase1
  if (textBoq && chunks.length > 1) {
    log(`phase1: BOQ كبير — يُقرأ على ${chunks.length} أجزاء`)
    const merged: RawPhase1 = { subject: '', detected_departments: [] as string[], items: [], notes: '' }
    for (let i = 0; i < chunks.length; i++) {
      const part: AiFile = {
        data: Buffer.from(chunks[i], 'utf8').toString('base64'),
        mimeType: textBoq.mimeType,
        label: `${textBoq.label} (جزء ${i + 1}/${chunks.length})`,
      }
      const note = `\n\nTHIS IS PART ${i + 1} OF ${chunks.length} OF THE SAME BOQ. Lines starting with "${CONTEXT_PREFIX}" are the sheet name and column headers repeated for column meaning only — NEVER emit them as items. A parent row's specs still apply to the child rows that follow it within this part.`
      const p = await callPhase1([part], note, `قراءة الـBOQ (جزء ${i + 1}/${chunks.length})`)
      if (!merged.subject && p.subject) merged.subject = p.subject
      merged.detected_departments = [
        ...(merged.detected_departments as string[]),
        ...(Array.isArray(p.detected_departments) ? (p.detected_departments as string[]) : []),
      ]
      merged.items = [...(merged.items || []), ...(p.items || [])]
      if (p.notes) merged.notes = [merged.notes, String(p.notes)].filter(Boolean).join(' • ')
    }
    parsed = merged
  } else {
    parsed = await callPhase1(files, '', 'قراءة الـBOQ')
  }

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
      section: String(it.section || '').trim().slice(0, 120) || null,
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
  /** Attributes (thickness/finish/size/colour/material) read from the project
   *  files — merged per field across pages, first writer wins per field. */
  attrs: AttrResolution | null
  /** How many of this row's candidate pages were actually opened & read. Lets
   *  the assembler tell "searched, nothing found" from "never searched" (D7). */
  candidatesRead: number
}

/** A row keeps consuming its candidate pages while its QUANTITY is unresolved —
 *  or, once that's settled, while the BOQ gave no thickness and none has been
 *  read yet ("ملف ثالث آخذ منه السماكة"). Finish/colour/size are captured
 *  opportunistically on whatever page is opened; only thickness drives extra
 *  reads, and every read still counts against the shared MAX_READ_GROUPS budget. */
function needsRead(st: RowState): boolean {
  if (!st.resolution) return true
  if (detailsStateThickness(st.row.details)) return false
  return (st.attrs?.attrs.thickness_mm ?? null) === null
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
    if (!needsRead(st)) continue
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
      for (const res of results.quantities) {
        const st = stByPos.get(res.position)
        // First writer wins; earlier rounds/higher-rank candidates come first.
        if (st && !st.resolution) st.resolution = res
      }
      for (const hit of results.attributes) {
        const st = stByPos.get(hit.position)
        if (!st) continue
        const cite = `${hit.fileName}${hit.page ? ` ص${hit.page}` : ''}`
        const prev = st.attrs
        if (!prev) {
          st.attrs = hit.attrs.thickness_mm !== null ? { ...hit, thicknessCite: cite, thicknessBucket: hit.bucket } : hit
          continue
        }
        // Per-field first-writer: keep what earlier pages gave, fill the rest —
        // and credit every page that actually contributed something new.
        const merged = mergeAttrs(prev.attrs, hit.attrs)
        const keys = ['thickness_mm', 'finish', 'size', 'colour', 'material'] as const
        const contributed = keys.some((k) => prev.attrs[k] === null && merged[k] !== null)
        const gotThickness = prev.attrs.thickness_mm === null && merged.thickness_mm !== null
        st.attrs = {
          ...prev,
          attrs: merged,
          alsoFrom: contributed ? [...(prev.alsoFrom || []), cite] : prev.alsoFrom,
          ...(gotThickness ? { thicknessCite: cite, thicknessBucket: hit.bucket } : {}),
        }
      }
      onGroupDone(1, visual)
      log(`قراءة ${g.file.name} ص${g.page ?? 1} (${visual ? 'بصري' : 'نص'}): ${results.quantities.length} كمية + ${results.attributes.length} مواصفات / ${g.rows.length} بند`)
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
    attrs: null,
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
  // Sheets that have a NEWER issue in the package — a number read from one is
  // flagged in phase 5 (the router is already steered to the latest).
  const superseded = supersededMap(readable.map((f) => ({
    sha: f.sha, name: f.name, docNumber: f.docNumber, title: f.title,
    firstPageText: f.pages[0]?.text ? f.pages[0].text.slice(0, 1500) : null,
  })))
  const shaByName = new Map(readable.map((f) => [f.name, f.sha]))
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
    const pending = states.filter((s) => needsRead(s) && s.candidates[round]).length
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

  const items: BoqExtractedItem[] = states.map(({ row, resolution, attrs, candidates, candidatesRead }) => {
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

    // A number taken from a superseded issue of a sheet is never silently
    // trusted — the newer revision may have changed it.
    if (resolution) {
      const sha = shaByName.get(resolution.fileName)
      const sup = sha ? superseded.get(sha) : undefined
      if (sup) {
        addNote(`⚠️ الرقم مأخوذ من إصدار أقدم (${sup.rev}) من ${resolution.fileName} — يوجد إصدار أحدث (${sup.latest}: ${sup.latestName}) لم يُعتمد لهذا البند، راجعه.`)
        confidence = Math.min(confidence, 0.6)
      }
    }

    // Attributes read from the project files: fill whatever the BOQ row left
    // blank. Thickness follows the quantity rule — a DRAWING overrides a stated
    // value loudly; any other source only notes the disagreement.
    if (attrs && hasAnyAttr(attrs.attrs)) {
      const a = attrs.attrs
      const firstCite = `${attrs.fileName}${attrs.page ? ` ص${attrs.page}` : ''}`
      const acite = [firstCite, ...(attrs.alsoFrom || [])].join('، ')
      const tCite = attrs.thicknessCite || firstCite
      const tBucket = attrs.thicknessBucket || attrs.bucket
      // Values are appended label-free in phase 1's own "thickness – finish –
      // size – colour" order, so an English quotation never carries Arabic
      // labels (details is printed verbatim on the customer PDF).
      const parts: string[] = []
      const statedThk = thicknessFromText(details)
      if (a.thickness_mm !== null) {
        if (statedThk === null) {
          parts.push(`${a.thickness_mm}mm`)
        } else if (Math.abs(statedThk - a.thickness_mm) > 0.01) {
          if (tBucket === 'drawing') {
            addNote(`⚠️ تعارض سماكة: الـBOQ يقول ${statedThk} مم، والرسمة ${tCite} تقول ${a.thickness_mm} مم — اعتُمدت سماكة الرسمة (الرسومات تتفوق).`)
            parts.push(`${a.thickness_mm}mm`)
          } else {
            addNote(`⚠️ تحقّق يدوي: الـBOQ يقول سماكة ${statedThk} مم، و${tCite} يذكر ${a.thickness_mm} مم — أُبقيت سماكة الـBOQ.`)
          }
        }
      }
      const already = (w: string | null) => !!w && normalizeText(details || '').includes(normalizeText(w))
      if (a.finish && !already(a.finish)) parts.push(a.finish)
      if (a.size && !already(a.size)) parts.push(a.size)
      if (a.colour && !already(a.colour)) parts.push(a.colour)
      if (a.material && !already(a.material)) parts.push(a.material)
      if (parts.length > 0) {
        details = details ? `${details} – ${parts.join(' – ')}` : parts.join(' – ')
        source = `${source}؛ المواصفات من ${acite}${attrs.verified === 'quote' ? ' (تحقق نصي)' : ' (قراءة بصرية مزدوجة)'}`
      }
    }

    return {
      description: row.description,
      details,
      quantity,
      unit: row.unit,
      department_match: row.department_match,
      ai_confidence: confidence,
      source,
      section: row.section,
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
    filesSent: readable.length + (input.boqUrl ? 1 : 0), // +1 = the BOQ (none in drawings-only mode)
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
