// BOQ Router — phase 0: UNDERSTAND THE PACKAGE before reading a single row.
//
// The failure this exists for: a "Vanity Top" package listed 25 stone counter
// tops under "INTERIOR ARCHITECTURAL WOOD WORK" with the stone only in a code
// (ST-02+WD-01). Read row by row, every line looked like joinery and all 25
// were lost. A human estimator never reads that way: first the file name, the
// "SUBCONTRACT PACKAGE:" line, who sent it, which codes appear and what family
// they belong to, which drawings are cited — and only then the rows, each one
// read in THAT light. This module is that first look:
//
//   1. headerHints()  — deterministic: package/job/trade lines, code families
//                       with counts, drawing references. Free.
//   2. buildBrief()   — ONE small text-only model call that turns the hints and
//                       the first pages of each BOQ into a structured brief:
//                       what the client is buying from us, how the codes read,
//                       whether rows are "ours by default", and the open
//                       questions to put to the team/client.
//   3. SCENARIOS      — the estimator's playbook injected into phase 1: the
//                       shapes real BOQs take and what to do with each.
//
// The brief is CONTEXT: it steers reading and the deterministic gate's
// "context anchor"; it never invents a quantity or a material.

import { getProvider } from '@/lib/ai'
import type { JsonSchema } from '@/lib/ai/provider'
import { AI_CALL_TIMEOUT_MS, withTimeout } from './core'

// ─── deterministic hints ────────────────────────────────────────────────────

export interface HeaderHints {
  /** "SUBCONTRACT PACKAGE: Vanity Top", "TRADE: Stone works", "JOB NAME: …" */
  packageLines: string[]
  /** Code families seen in the rows: prefix → occurrences (ST → 25, WD → 20). */
  codeFamilies: Array<{ prefix: string; count: number; samples: string[] }>
  /** Drawing / document references cited by rows ("AID-00-8022", "A-301"). */
  drawingRefs: string[]
}

const PACKAGE_LINE_RE = /^(?:\s*)(subcontract\s*package|package|trade|section|bill\s*(?:no\.?)?|job\s*name|project|scope|works?|discipline|الحزمة|حزمة|القسم|البند|المقاولة|الأعمال|اعمال|المشروع|نطاق)\s*[:：#-]\s*(.{2,120})$/im
const CODE_RE = /\b([A-Z]{1,4})-?(\d{1,3})([A-Z]?)\b/g
const DRAWING_REF_RE = /\b(?:drg\.?|drawing|dwg|sheet|detail|ref\.?|as per|per|مخطط|لوحة|رسم(?:ة)?|حسب)\s*[:#]?\s*((?:[A-Z]{1,4}-)?[A-Z]{1,4}-?\d{1,3}-?\d{2,5}(?:-[A-Z0-9]{1,4})?)/gi
const NOT_CODES = new Set(['MM', 'CM', 'M', 'NR', 'NO', 'PCS', 'KG', 'RH', 'QTY', 'PAGE', 'ITEM', 'X', 'T', 'DN', 'PN'])

export function headerHints(texts: string[]): HeaderHints {
  const packageLines: string[] = []
  const fam = new Map<string, { count: number; samples: Set<string> }>()
  const refs = new Set<string>()
  for (const t of texts) {
    const head = (t || '').slice(0, 6000)
    for (const line of head.split(/\r?\n/).slice(0, 60)) {
      const m = PACKAGE_LINE_RE.exec(line.replace(/,+$/, '').replace(/^,+/, ''))
      if (m) {
        const v = `${m[1].trim()}: ${m[2].replace(/,+/g, ' ').trim()}`
        if (!packageLines.includes(v) && packageLines.length < 8) packageLines.push(v)
      }
    }
    const body = (t || '').slice(0, 200_000)
    let m: RegExpExecArray | null
    CODE_RE.lastIndex = 0
    while ((m = CODE_RE.exec(body)) !== null) {
      const prefix = m[1].toUpperCase()
      if (NOT_CODES.has(prefix)) continue
      const code = `${prefix}-${m[2]}${m[3].toUpperCase()}`
      const f = fam.get(prefix) || { count: 0, samples: new Set<string>() }
      f.count++
      if (f.samples.size < 4) f.samples.add(code)
      fam.set(prefix, f)
    }
    DRAWING_REF_RE.lastIndex = 0
    while ((m = DRAWING_REF_RE.exec(body)) !== null) {
      if (refs.size >= 60) break
      refs.add(m[1].toUpperCase())
    }
  }
  const codeFamilies = [...fam.entries()]
    .filter(([, f]) => f.count >= 2)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 12)
    .map(([prefix, f]) => ({ prefix, count: f.count, samples: [...f.samples] }))
  return { packageLines, codeFamilies, drawingRefs: [...refs] }
}

/** Drawing references the rows cite that are NOT among the attached files —
 *  the single most useful thing to tell the team ("send us AID-00-8022"). */
export function missingDrawingRefs(refs: string[], attachedNames: string[]): string[] {
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const names = attachedNames.map(norm)
  return refs.filter((r) => { const n = norm(r); return n.length >= 4 && !names.some((x) => x.includes(n)) })
}

// ─── the brief (one model call) ─────────────────────────────────────────────

export interface PackageBrief {
  /** One line: what this package is ("Vanity tops for KBS villas — stone tops on joinery carcasses"). */
  package_summary: string
  /** What the client is buying FROM US specifically. */
  what_we_supply: string
  /** true when rows in this package should be read as ours unless their own words say otherwise. */
  ours_by_default: boolean
  /** How each code family reads (ST → natural stone top, WD → joinery carcass …). */
  code_families: Array<{ prefix: string; meaning: string; ours: boolean; confidence: number }>
  /** Shape of the rows ("composite units: stone top + wood carcass", "per-zone repeats", "parent + lettered children"). */
  row_pattern: string
  /** What the estimator would ask before pricing — surfaced to the team verbatim. */
  open_questions: string[]
  /** Things in the file that are NOT ours and why (one line each). */
  not_ours: string[]
}

const BRIEF_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['package_summary', 'what_we_supply', 'ours_by_default', 'code_families', 'row_pattern', 'open_questions', 'not_ours'],
  properties: {
    package_summary: { type: 'string' },
    what_we_supply: { type: 'string' },
    ours_by_default: { type: 'boolean' },
    code_families: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['prefix', 'meaning', 'ours', 'confidence'],
        properties: {
          prefix: { type: 'string' }, meaning: { type: 'string' }, ours: { type: 'boolean' },
          confidence: { type: 'number', description: '0..1' },
        },
      },
    },
    row_pattern: { type: 'string' },
    open_questions: { type: 'array', items: { type: 'string' } },
    not_ours: { type: 'array', items: { type: 'string' } },
  },
}

const EMPTY_BRIEF: PackageBrief = {
  package_summary: '', what_we_supply: '', ours_by_default: false, code_families: [], row_pattern: '', open_questions: [], not_ours: [],
}

export async function buildBrief(args: {
  fileNames: string[]
  boqTexts: string[]
  hints: HeaderHints
  projectName: string
  companyName: string
  notes: string | null
  covered: Array<{ name_en: string; name_ar: string }>
  log: (m: string) => void
}): Promise<PackageBrief> {
  const heads = args.boqTexts.map((t, i) => `### ${args.fileNames[i] || `BOQ ${i + 1}`}\n${(t || '').slice(0, 3500)}`).join('\n\n')
  if (!heads.trim()) return EMPTY_BRIEF
  const hintBlock = [
    args.hints.packageLines.length ? `Package/section lines found: ${args.hints.packageLines.join(' | ')}` : '',
    args.hints.codeFamilies.length ? `Code families in the rows: ${args.hints.codeFamilies.map((f) => `${f.prefix}×${f.count} (${f.samples.join(', ')})`).join('; ')}` : '',
    args.hints.drawingRefs.length ? `Drawings cited by rows: ${args.hints.drawingRefs.slice(0, 20).join(', ')}${args.hints.drawingRefs.length > 20 ? ' …' : ''}` : '',
  ].filter(Boolean).join('\n')

  const provider = await getProvider()
  try {
    const parsed = await withTimeout(
      provider.generateStructured<Partial<PackageBrief>>({
        systemInstruction: `You are the senior estimator at Kaaseb, a Saudi NATURAL STONE supplier (departments: ${args.covered.map((d) => d.name_en).join(', ')}). A client sent us this package. Before anyone reads a single row, write the brief an experienced estimator forms in the first minute:

- What IS this package, and what exactly is the client buying FROM US? The file name, the "SUBCONTRACT PACKAGE" / trade / section lines, and the fact that it was sent to a stone supplier are strong evidence. A package named "Vanity Top" sent to us means the STONE TOPS, even if every row sits under "WOOD WORK" and combines a stone code with a joinery code.
- Decode the code families by industry convention and by context: ST/STN/NS = stone, MR/MRB/MAR = marble, GR/GRN = granite, LS = limestone, TR = travertine, WD = wood/joinery, PT = paint, SP = special/solid surface, TL/CT = tiles, MT = metal, GL = glass. Say how confident you are; say "unknown — legend not attached" when it is not defined in the file.
- Decide ours_by_default: true when the package is a stone scope (rows are ours unless their own words name a manufactured material — concrete, porcelain, terrazzo, GRC, quartz); false for a mixed or non-stone package where each row must prove itself.
- Describe the row pattern (composite units, parent + lettered children, per-zone repeats, two-row items, rate-only lines, provisional sums, alternates/options).
- open_questions: what you would ask the team/client BEFORE pricing — missing legends, drawings cited but not attached, unclear units (Nr vs m²), supply-only vs supply-and-install, thickness/finish not stated. Short, concrete, in Arabic.
- not_ours: lines/sections that are clearly another trade, one short line each, in Arabic.

Never invent a material, a quantity, or a price. JSON only.`,
        files: [],
        userText: `## Files\n${args.fileNames.join('\n')}\n\n## Project\n${args.projectName} — ${args.companyName}${args.notes ? `\n\n## Client notes\n${args.notes.slice(0, 1200)}` : ''}\n\n## Deterministic hints\n${hintBlock || '(none)'}\n\n## First pages of each BOQ\n${heads}`,
        schema: BRIEF_SCHEMA,
        schemaName: 'package_brief',
        temperature: 0.1,
      }),
      AI_CALL_TIMEOUT_MS,
      'فهم الحزمة',
    )
    const b: PackageBrief = {
      package_summary: String(parsed.package_summary || '').slice(0, 300),
      what_we_supply: String(parsed.what_we_supply || '').slice(0, 300),
      ours_by_default: parsed.ours_by_default === true,
      code_families: (Array.isArray(parsed.code_families) ? parsed.code_families : []).slice(0, 12).map((f) => ({
        prefix: String(f?.prefix || '').toUpperCase().slice(0, 6),
        meaning: String(f?.meaning || '').slice(0, 120),
        ours: f?.ours === true,
        confidence: Math.max(0, Math.min(1, Number(f?.confidence) || 0)),
      })).filter((f) => f.prefix),
      row_pattern: String(parsed.row_pattern || '').slice(0, 300),
      open_questions: (Array.isArray(parsed.open_questions) ? parsed.open_questions : []).map((q) => String(q).slice(0, 200)).filter(Boolean).slice(0, 8),
      not_ours: (Array.isArray(parsed.not_ours) ? parsed.not_ours : []).map((q) => String(q).slice(0, 160)).filter(Boolean).slice(0, 8),
    }
    args.log(`phase0: ${b.package_summary || '(no summary)'} | ours_by_default=${b.ours_by_default} | codes ${b.code_families.map((f) => `${f.prefix}=${f.meaning.slice(0, 20)}`).join(', ')}`)
    return b
  } catch (e) {
    args.log(`phase0 brief failed: ${e instanceof Error ? e.message : e}`)
    return EMPTY_BRIEF
  }
}

/** The brief as a prompt block for phase 1 — the rows are read in its light. */
export function briefBlock(b: PackageBrief, hints: HeaderHints): string {
  if (!b.package_summary && hints.packageLines.length === 0 && hints.codeFamilies.length === 0) return ''
  const codes = b.code_families.length
    ? b.code_families.map((f) => `${f.prefix} = ${f.meaning}${f.ours ? ' (OURS)' : ''} [${Math.round(f.confidence * 100)}%]`).join('; ')
    : hints.codeFamilies.map((f) => `${f.prefix}×${f.count}`).join('; ')
  return `

PACKAGE BRIEF (formed before reading the rows — read every row in this light):
- Package: ${b.package_summary || hints.packageLines.join(' | ') || '—'}
- What the client buys from us: ${b.what_we_supply || '—'}
- Rows are ours by default: ${b.ours_by_default ? 'YES — a row is NOT ours only when its own words name a manufactured material or a clearly different trade' : 'NO — each row must show a stone anchor (material word, stone code, or covered department)'}
- Code families: ${codes || '—'}
- Row pattern: ${b.row_pattern || '—'}
${b.not_ours.length ? `- Not ours: ${b.not_ours.join('; ')}` : ''}`
}

// ─── the estimator's playbook ───────────────────────────────────────────────

export const SCENARIOS = `
THE ESTIMATOR'S PLAYBOOK — real shapes BOQs take. Recognise the shape, then act:

PACKAGING
- Stone under another trade's heading (WOOD WORK, FINISHES, POOL, LANDSCAPE, FAÇADE, MEP builder's work): the heading does not decide — the row and the package do.
- Composite unit = stone + other trade in one row (vanity top ST-xx + carcass WD-xx; reception desk with stone top; stair with stone treads on steel): OURS for the stone part. Title = the stone code/part; details carry the stone dimensions; the other trade is noted as not ours.
- Stone only in a code (ST-02, MR-1, GR-04) with no material word: keep, title = code, details "كود: … — المادة في جدول الرموز"; never guess the stone.
- Package title tells the scope ("Vanity Top", "Stone Cladding", "Marble Works", "External Paving"): rows inside are candidates for that scope.
- Mixed package (stone + tiles + joinery): keep ours, list the rest in detected_departments.
- Alternates / options ("Option B: granite instead of marble", "Alt.", "or equal"): emit the stated item once; mention the alternate in details; never both as separate quantities.
- Provisional sums, prime cost (PC) sums, dayworks, contingencies, preliminaries, attendance, testing, mock-ups, samples: NOT items. Mention in notes if they touch stone (a PC sum for stone supply is worth telling the team).
- Supply-only vs supply-and-install: read the wording ("supply", "supply and fix", "S&I", "توريد", "توريد وتركيب") and put it in details — the price differs.

QUANTITIES
- Per-zone repeats (S1, H1, Villa A/B): mirror the file, zone in details. Per-room columns with a total: take the total, breakdown in details.
- Quantity blank / "as per drawings" / "rate only" / "item": quantity 0, quantity_stated false, pointer in reference_hint — a later phase reads the drawings.
- Ranges "150–200" → the larger; "approx" → the number; "say 12" → 12.
- Units: keep the customer's. Nr/No./pcs for tops, m² for areas, lm/m for lengths, m³ never for stone (flag). A stone top given as Nr with L×W: keep Nr and ADD the area per piece in details (1425 x 600 mm ≈ 0.86 m²) — the pricer needs it.
- Two quantities on one row (e.g. "12 Nr / 8.4 m²"): the one that matches the unit column is the quantity; the other goes to details.
- Wastage / allowance lines ("add 10% wastage"): not items; note it.
- Thickness written as 20mm vs 2cm vs 3/4": normalise to mm in details.

CODES & LEGENDS
- Legend usually lives in the drawings (finishes schedule, material key) or the spec, rarely in the BOQ. Say so in reference_hint ("legend / finishes schedule") when the code is undefined.
- The same prefix can mean different things per project (ST = stone here, steel elsewhere): trust the package brief over the convention.
- Drawing references ("as Drg. AID-00-8022 detail 1", "refer A-301") are pointers: copy them verbatim into reference_hint.

TABLE SHAPES
- Parent row (no qty) + lettered children (A, B, C…): one item per child inheriting the parent's specs. Title row + qty row = one item. Wrapped description over several rows = one item.
- Section headers, page markers ("Page 2"), bill numbers, "carried to summary", "to collection", totals rows: never items.
- Merged cells / a description column that carries the unit and qty inline: parse the numbers out.
- Arabic/English mixed, right-to-left cells, Arabic-Indic digits (١٢٣): read them all as one document.
- Photographs/scans of a BOQ: read visually, keep the order, do not skip faint rows.

OUT OF SCOPE (only when the row's OWN words say so)
- Manufactured products with a stone word as a look ("granite-effect porcelain", "marble pattern terrazzo", "precast concrete granite cladding", "quartz surface"): not ours; record the real department.
- The stone word as a substrate ("marble tile on concrete screed"): the stone IS ours; concrete is where it sits.
- "Natural stone" of a kind we don't list (basalt, slate, Omani stone): keep, flag — a business decision, not a certainty.

WHEN IN DOUBT
- Keep the row and be honest in details about what is unknown. A dropped customer line is the worst failure; a flagged one costs a minute of a human's time.`
