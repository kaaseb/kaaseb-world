// Furn BOQ analyzer — provider-agnostic.
//
// Given a BOQ file (and optionally spec / drawing files), extracts:
//   • subject (the "Subject:" line of the quotation)
//   • detected departments (Marble, Granite, etc.)
//   • a clean list of items (description, details, qty, unit)
//
// The model gets the list of *covered* departments so it knows which items to
// keep and which to flag/drop. Anything not belonging to a covered department
// is omitted from the items array but still surfaced via `detected_departments`
// so admins can decide whether to enable that department in Settings.
//
// The actual LLM call goes through whichever provider `ai_settings` selects
// (OpenAI by default, Gemini optional) — see src/lib/ai.

import { getProvider } from '@/lib/ai'
import { fetchAiFiles } from '@/lib/ai/files'
import type { AiFile, JsonSchema } from '@/lib/ai/provider'

export interface BoqAnalysisInput {
  boqUrl: string
  boqFilename: string
  specFiles: { url: string; name: string }[]
  drawingFiles: { url: string; name: string }[]
  // The 4th bucket. It was collected by the form, stored on the row, promised by
  // AGENTS.md ("contracts, approvals, photos — use if a primary file is silent")
  // and then never passed here, so the model never saw a byte of it.
  //
  // That silently broke the headline rule — "the BOQ is a router, not the source
  // of truth". A line saying "qty per Sold.pdf p.40" could not be resolved if the
  // team had dropped Sold.pdf in Other; the model would emit quantity: 0 and
  // blame a missing reference that was uploaded, stored, and sitting right there.
  otherFiles: { url: string; name: string }[]
  coveredDepartments: { name_en: string; name_ar: string }[]
  projectName: string
  companyName: string
}

export interface BoqExtractedItem {
  description: string
  // The long descriptive line — finish, thickness, color, dimensions, any
  // cross-reference back to the source document. Shown under the short
  // `description` title in both the pricing table and the quotation PDF.
  // The team's per-row notes column is a separate, AI-untouched field.
  details: string | null
  quantity: number
  unit: string
  department_match: string | null
  ai_confidence: number
  // Audit trail: exactly WHERE the quantity / thickness / dimensions were read
  // from (file + page), or — when nothing was found after a real search — what
  // was searched. This is what makes every number verifiable, and is rendered
  // as the "Source" line on each item.
  source: string | null
}

export interface BoqAnalysisResult {
  subject: string
  detected_departments: string[]
  items: BoqExtractedItem[]
  notes: string | null
  /** Files the team uploaded that never reached the model, and why. */
  skippedFiles: SkippedFile[]
  /** How many files the model actually received (BOQ included). */
  filesSent: number
}

// Standard JSON Schema (single source of truth for both providers). OpenAI
// feeds it to strict structured outputs verbatim; the Gemini provider converts
// it. Strict mode requires every property listed in `required` and
// `additionalProperties: false` on each object.
const RESPONSE_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    subject: { type: 'string', description: 'A short, professional Subject line for the quotation in English. Pattern: "supply <product name or BOQ subject>". Default to "supply BOQ items" if unclear.' },
    detected_departments: {
      type: 'array',
      items: { type: 'string' },
      description: 'Distinct department names you detected in the BOQ. Use the canonical English names of the covered departments when items match (e.g., "Marble", "Granite"). For items that don\'t match any covered department, propose a sensible new department name (e.g., "Tiles", "Steel"). Never duplicate.',
    },
    items: {
      type: 'array',
      description: 'Items belonging to one of the COVERED departments only. Drop everything else.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          description: { type: 'string', description: 'SHORT item title — the catalog-style name only. 3-8 words. E.g. "Black granite coping", "Polished marble flooring". No dimensions, no finishes, no notes here — those go into `details`.' },
          details: { type: 'string', description: 'LONG descriptive line — finish (honed/polished/sand-blasted/flamed), thickness in mm, color, edge profile, dimensions (LxWxH), joint info. ALWAYS pull thickness and dimensions from the drawings/specs when the BOQ is silent. Empty string only when nothing extra is known anywhere.' },
          quantity: { type: 'number', description: 'Numeric quantity. If a range is given, take the upper bound. If the BOQ row tells you to read another file for the quantity, follow that reference and put the resolved number here. NEVER invent a number.' },
          unit: { type: 'string', description: 'Unit of measure: m, m2, m3, pcs, kg, ton, set, lot, lm. Use "m" for linear meter unless explicit otherwise.' },
          department_match: { type: 'string', description: 'The covered department this item belongs to (canonical English name). Required to be a member of the COVERED DEPARTMENTS list — never invent.' },
          ai_confidence: { type: 'number', description: 'Your confidence 0..1 that description, qty, unit, AND department classification are correct. Drop this below 0.6 whenever the row depends on a referenced file you could not verify, or whenever the material classification was inferred from a look-alike phrase.' },
          source: { type: 'string', description: 'WHERE you read the quantity / thickness / dimensions from — be precise and auditable: the exact file name and page/sheet, e.g. "Sold.pdf p.40", "Drawing A-301 (Lobby plan)", "Finishes Schedule sheet, row 12". If the value came straight from the BOQ itself, write "BOQ". If after a genuine search nothing was found, write what you searched, e.g. "Searched all 14 attachments — no quantity match". NEVER leave this guessing or vague.' },
        },
        required: ['description', 'details', 'quantity', 'unit', 'department_match', 'ai_confidence', 'source'],
      },
    },
    notes: { type: 'string', description: 'Any general notes you want to flag (ambiguous units, missing thicknesses, etc). Empty string if none.' },
  },
  required: ['subject', 'detected_departments', 'items', 'notes'],
}

// Input caps per bucket (before ZIP expansion), plus a hard ceiling on the
// total number of files actually sent — a single .zip can expand into dozens,
// so the global cap is what really bounds the request. Quality-first: digital
// PDFs become compact text (cheap), so 100 mixed files is affordable.
const SPEC_CAP = 60
const DRAWING_CAP = 50
const OTHER_CAP = 30
const MAX_FILES = 100

// A file we tried to send and couldn't. Surfaced to the caller instead of being
// swallowed: the model is instructed to write "Searched all N attachments" into
// `details`, and the team is told to trust that line — so it must never claim to
// have searched a file that silently never arrived.
export interface SkippedFile {
  name: string
  reason: string
}

export async function analyzeBoq(input: BoqAnalysisInput): Promise<BoqAnalysisResult> {
  if (input.coveredDepartments.length === 0) {
    throw new Error('No covered departments configured — add departments in Furn Settings first.')
  }

  // Gather files. BOQ is required; specs/drawings are optional. ZIPs expand to
  // their contents; the global MAX_FILES ceiling bounds the whole request.
  const files: AiFile[] = []
  files.push(...await fetchAiFiles(input.boqUrl, `BOQ: ${input.boqFilename}`))

  const supporting = [
    ...input.specFiles.slice(0, SPEC_CAP).map(f => ({ url: f.url, label: `SPEC: ${f.name}`, name: f.name, visual: false })),
    // Drawings go in as images — a plan's meaning is its geometry, not its text.
    ...input.drawingFiles.slice(0, DRAWING_CAP).map(f => ({ url: f.url, label: `DRAWING: ${f.name}`, name: f.name, visual: true })),
    // Other: contracts/approvals/photos. Lowest priority (last, so the MAX_FILES
    // ceiling sacrifices these first) but no longer invisible — a BOQ row that
    // points at a file the team filed here must be resolvable.
    ...(input.otherFiles || []).slice(0, OTHER_CAP).map(f => ({ url: f.url, label: `OTHER: ${f.name}`, name: f.name, visual: false })),
  ]

  const skipped: SkippedFile[] = []
  for (const f of supporting) {
    if (files.length >= MAX_FILES) {
      skipped.push({ name: f.name, reason: `تجاوز الحد الأقصى (${MAX_FILES} ملف)` })
      continue
    }
    try {
      const fetched = await fetchAiFiles(f.url, f.label, { visual: f.visual })
      // fetchAiFiles returns [] for formats it can't read (.docx, corrupt ZIP).
      // That used to be indistinguishable from success.
      if (fetched.length === 0) {
        skipped.push({ name: f.name, reason: 'صيغة غير مقروءة (مثل .docx) أو ملف تالف' })
        continue
      }
      for (const af of fetched) {
        if (files.length >= MAX_FILES) break
        files.push(af)
      }
    } catch {
      // Was a bare `catch { /* skip */ }` — an expired or 404 URL produced no
      // signal at all, and the run still reported success.
      skipped.push({ name: f.name, reason: 'تعذّر تحميل الملف (رابط منتهي أو غير موجود)' })
    }
  }
  if (skipped.length > 0) {
    console.log(`[furn] ${skipped.length} file(s) NOT sent to the AI:`)
    for (const s of skipped) console.log(`  • ${s.name} — ${s.reason}`)
  }

  const coveredList = input.coveredDepartments
    .map(d => `- ${d.name_en} (${d.name_ar})`)
    .join('\n')

  const systemInstruction = `You are an expert quantity surveyor working at Kaaseb — a Saudi marble & granite supplier. Your job is to read Bill-of-Quantities (BOQ) files of varying formats (Excel/CSV, PDF tables, scanned documents, AND raw photographs / screenshots of paper or on-screen BOQs in PNG/JPG) and extract a clean priceable line-item list.

When the BOQ is an image (PNG/JPG/JPEG) you MUST visually read every row exactly like you would from a spreadsheet — extract every cell, preserve the order, and don't refuse just because the input isn't tabular. Photographs taken on a phone, scans with shadows or rotation, hand-written annotations, stamped revisions, and mixed Arabic/English cells must all be handled. Do not skip rows because the image is low quality — do your best on every visible item.

PIPELINE — read the BOQ FIRST, then EXHAUSTIVELY chase quantities across every attachment

The BOQ is the source of truth for WHICH items exist. It often does NOT contain the dimensions, finishes, or quantities — those live in OTHER attached files (spec PDFs, drawings, schedules, photos).

EXPLICIT references (easy case): The BOQ cell points you at a file:
  "see Sold.pdf"          "refer to drawing A-301"
  "as per spec sheet 3"   "size per attached schedule, sheet 'Coping'"
  "qty per BOQ-annex.xlsx"  "details: see attachment, page 40"
You MUST then:
  (a) locate the referenced file in the attachments (match by filename, sheet name, or page number),
  (b) read the specific page / sheet / row called out,
  (c) extract the actual dimensions / quantity / finish from there,
  (d) record the source in \`details\` (e.g. "qty per Sold.pdf p.40", "finish per Drawing A-301").

IMPLICIT references (NON-NEGOTIABLE): When the BOQ row has NO quantity and NO explicit pointer, you MUST NOT shortcut to qty=0. Quantities for marble/granite scope are FREQUENTLY filed under a different document — finishes schedules, area takeoff PDFs, elevation drawings, room-by-room tally sheets, "Bill 4 – Finishes", BOQ annexes, addenda. Before giving up:
  1. Scan EVERY attached SPEC and DRAWING file for the same item name (or its obvious bilingual equivalent — "بلاط رخام" ↔ "marble tile", "جرانيت" ↔ "granite") and look for tabulated quantities, area summaries, or piece counts.
  2. Check for floor plans showing this material — if you can derive m² from a plan's labelled area, use it.
  3. Match by REGION not just by name — "Lobby flooring" in the BOQ + a finishes schedule listing "Lobby: 142 m² marble" → take 142.
  4. ONLY after a genuine search across all attachments, emit \`quantity: 0\` and note in \`details\` exactly what you looked at ("Searched all 18 attachments; no quantity for 'Granite Cobble Coping' found in any schedule, plan, or annex").
"Qty not in BOQ" is the WORST possible answer because the team has to do the search you skipped. Spend the effort on the search, not on the apology.

A real BOQ project may include 200+ attached files. Don't get overwhelmed — work down the BOQ row by row.

DEPARTMENT CLASSIFICATION — beware look-alikes AND COMPOUND NAMES
We ONLY supply items belonging to one of the COVERED DEPARTMENTS listed below.

CRITICAL — COMPOUND NAMES TRAP (this rule has overridden look-alike judgment in real BOQs):
The presence of the word "granite" or "marble" anywhere in a description does NOT mean the item is granite or marble. Look at the FULL noun phrase. The HEAD noun decides what the product actually is:

  "Precast Concrete Granite Wall Cladding"     → HEAD is "Precast Concrete" → CONCRETE, NOT granite. Drop it.
  "GRC Panel with granite finish"              → HEAD is "GRC Panel"        → GRC,      NOT granite. Drop it.
  "Cast Stone Marble-look Coping"              → HEAD is "Cast Stone"       → not marble. Drop it.
  "Terrazzo Tile Marble Pattern"               → HEAD is "Terrazzo Tile"    → not marble. Drop it.
  "Porcelain Granite-Effect Floor"             → HEAD is "Porcelain"        → not granite. Drop it.
  "Concrete Curb with Granite Inlay"           → HEAD is "Concrete Curb"    → not granite (the granite inlay alone may be a separate line; only include if quantified separately).

DISQUALIFYING KEYWORDS — if ANY of these appears in the description, the item is NOT marble/granite no matter what other word follows. Drop it from items[]:
  concrete, precast, cast stone, GRC, GFRC, GRG, agglomerate, terrazzo, quartz (engineered), sintered, porcelain, ceramic, vinyl, HPL, laminate, composite, faux, artificial stone, engineered stone, simulated, look, effect, finish-only.

POSITIVE classification — only call it granite/marble when the item is a NATURAL stone product the head noun matches (slab, tile, coping, threshold, riser, sill, paver, cladding panel) AND the description explicitly says granite/marble as the MATERIAL, not as a look/finish/pattern. Examples:
  "Polished BLACK GALAXY Granite Slab, 30mm"      → Granite ✓
  "Carrara Marble Flooring Tile, 20mm honed"      → Marble ✓
  "Granite Cobble Stone Coping"                   → Granite ✓ (cobble + coping = natural stone product)
  "Stone tile, granite-look"                      → suspect → drop, add note in detected_departments[].

DECISION ORDER for every row:
  1. Read the FULL description.
  2. Is any disqualifying keyword present? → drop.
  3. Is the head noun a natural-stone product? → continue.
  4. Does the material word ("granite"/"marble") refer to the substance, or to a look/pattern/finish? → if look/pattern/finish, drop.
  5. Only then classify as the covered department.
  6. If the row was dropped due to a compound-name trap, ADD the real department to detected_departments[] (e.g., "Concrete", "GRC", "Porcelain") so the admin can decide whether to expand coverage.

CRITICAL RULES
1. We ONLY supply items that belong to one of the COVERED DEPARTMENTS listed below. Drop every other line item — including look-alike products discussed above.
2. Departments may not be labelled in the BOQ. Infer the department from the FULL evidence (description + spec + drawing). If an item explicitly describes "GRANITE STONE TILE COPING, 30mm" → department "Granite". If it mentions "Marble slab, 20mm honed" → "Marble". If the row only says "stone tile, granite-look" → not covered, drop, but add a note in detected_departments[].
3. If you spot items belonging to a department that is NOT in the covered list (e.g., tiles, steel, paint, porcelain), do NOT include them in items[] — but DO add the department's canonical English name to detected_departments[] so the admin can enable it later.
4. Detected_departments must include EVERY relevant department, both covered and uncovered, deduplicated. Use the COVERED department's exact English name when applicable (don't write "marble" if covered list says "Marble").
5. Subject line: Build it as "supply <core product or project name>". Example: "supply BLACK GRANITE", "supply marble flooring". Keep it under 60 chars, English, lowercase except product names.
6. Quantity: numeric only. If "approx 200" → 200. If a range "150-200" → 200. If the BOQ row has no quantity, you MUST exhaustively scan EVERY attached spec/drawing file (per the pipeline rule above) for the same item. Only emit \`quantity: 0\` after a genuine search; never as a shortcut. When you do emit 0, the \`details\` MUST start with what you searched ("Searched all N attachments — no qty match for <item>") so the team knows the search actually happened.
7. Unit: normalize to {m, m2, m3, pcs, kg, ton, set, lot, lm}. "linear meter" / "متر طولي" → m. "square meter" / "متر مربع" → m2. Default to m only when truly unspecified for coping/edging.
8. description: SHORT title only (3-8 words). details: LONG line with finish, thickness, color, dimensions. ALWAYS chase thickness + dimensions from the drawings/specs when the BOQ is silent. Per-row team notes are NOT your job — that field stays empty.
9. Merge duplicate item descriptions (sum quantities) only if descriptions are character-for-character identical AFTER normalization. Otherwise keep separate.
10. Output JSON ONLY conforming to the supplied schema. No prose.

11. SOURCE DISCIPLINE (the most important rule for trust). EVERY item MUST fill \`source\` with EXACTLY where its quantity / thickness / dimensions were read from — file name + page/sheet ("Sold.pdf p.40", "Drawing A-301 lobby plan", "Finishes Schedule row 12"). PDF text I gave you is split by "## Page N" markers — cite that page number. If the value came straight from the BOQ, \`source\` = "BOQ". A number with NO identifiable source is FORBIDDEN — if you truly cannot find it after searching every attachment, set quantity 0 and \`source\` = "Searched all N attachments — not found". Never write a plausible-looking number you can't point to a source for. This is how the team verifies you; treat it as non-negotiable.

COVERED DEPARTMENTS:
${coveredList}

PROJECT CONTEXT
- Project name: ${input.projectName}
- Company: ${input.companyName}`

  const provider = await getProvider()
  const parsed = await provider.generateStructured<BoqAnalysisResult>({
    systemInstruction,
    files,
    userText: 'Now extract the BOQ. Return JSON only matching the schema. Drop items outside the covered departments. Fill `source` for every item — the exact file + page each number came from.',
    schema: RESPONSE_SCHEMA,
    schemaName: 'boq_extraction',
    temperature: 0.1,
  })

  // Defensive normalization — the schema constrains shape, but we still guard
  // against a model that drifts on edge cases (NaN qty, missing fields).
  parsed.subject = (parsed.subject || `supply ${input.projectName}`).trim().slice(0, 80)
  parsed.detected_departments = Array.from(new Set((parsed.detected_departments || []).map(s => String(s).trim()).filter(Boolean)))
  parsed.notes = (parsed.notes || '').trim() || null
  // Keep items even when quantity is 0 — the AI might have located the row but
  // failed the exhaustive search. The team's signal is the amber-tinted row in
  // the pricing table (FurnDetail.tsx) which fires whenever qty===0.
  parsed.items = (parsed.items || []).map(it => ({
    description: String(it.description || '').trim(),
    details: it.details ? String(it.details).trim() : null,
    // Clamp to >= 0. `Number.isFinite(-5)` is true, so a negative sailed through
    // to an INSERT that `CHECK (quantity >= 0)` rejects — and by then the old
    // items are already deleted, so one bad number from the model wipes an
    // afternoon of pricing. The JSON schema constrains the type, not the sign.
    quantity: Number.isFinite(Number(it.quantity)) ? Math.max(0, Number(it.quantity)) : 0,
    unit: String(it.unit || 'm').trim(),
    department_match: it.department_match ? String(it.department_match).trim() : null,
    ai_confidence: Number.isFinite(Number(it.ai_confidence)) ? Math.max(0, Math.min(1, Number(it.ai_confidence))) : 0.5,
    source: it.source ? String(it.source).trim() : null,
  })).filter(it => it.description) // only drop rows the AI emitted with no description

  parsed.skippedFiles = skipped
  parsed.filesSent = files.length

  return parsed
}
