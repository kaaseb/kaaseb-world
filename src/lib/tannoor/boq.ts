// Tannoor BOQ analyzer — provider-agnostic.
//
// Difference from src/lib/furn/boq.ts:
//   • Receives the product catalog (Tannoor products) so it can MATCH each BOQ
//     line to an existing product instead of just extracting it.
//   • Returns a list of "missing items" — BOQ lines that don't match any
//     product — which the UI uses to flip the project status to
//     'missing_products'.
//
// The structured-output schema forces the model to either fill `product_id`
// or set `is_missing=true`; never both. The LLM call routes through whichever
// provider `ai_settings` selects — see src/lib/ai.

import { getProvider } from '@/lib/ai'
import { fetchAiFiles } from '@/lib/ai/files'
import type { AiFile, JsonSchema } from '@/lib/ai/provider'
import type { TannoorProduct, FurnDepartment } from '@/types'

export interface TannoorAnalysisInput {
  boqUrl: string
  boqFilename: string
  specFiles: { url: string; name: string }[]
  drawingFiles: { url: string; name: string }[]
  products: TannoorProduct[]
  departments: FurnDepartment[]
  projectName: string
  companyName: string
  // Colours per product (S3-backed, replaces the old color_en/ar columns).
  productColors?: Record<string, string[]>
  // Thickness + finish per product (S3-backed — those DB columns don't exist).
  productAttrs?: Record<string, { thickness_mm: number | null; finish: string | null }>
}

export interface TannoorExtractedItem {
  description: string
  quantity: number
  unit: string
  product_id: string | null
  is_missing: boolean
  match_reason: string
  ai_confidence: number
  // Where the quantity / spec was read from (file + page), or a note that a
  // genuine search found nothing. Shown internally for verification.
  source: string
}

export interface TannoorAnalysisResult {
  subject: string
  detected_departments: string[]
  items: TannoorExtractedItem[]
  missing_items: { description: string; reason: string }[]
  notes: string | null
}

const RESPONSE_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    subject: { type: 'string', description: 'Subject line, "supply <core product>" style, English.' },
    detected_departments: { type: 'array', items: { type: 'string' }, description: 'Deduped canonical department names encountered.' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          description: { type: 'string' },
          quantity: { type: 'number' },
          unit: { type: 'string' },
          product_id: { type: 'string', description: 'UUID of the matched product, or empty string if none matched.' },
          is_missing: { type: 'boolean', description: 'TRUE when no product in the catalog matches this line.' },
          match_reason: { type: 'string', description: 'One short sentence explaining why this product matched (or why it didn\'t).' },
          ai_confidence: { type: 'number' },
          source: { type: 'string', description: 'WHERE the quantity / spec was read from — exact file name + page/sheet ("Sold.pdf p.40", "Drawing A-301"). PDF text is split by "## Page N" — cite that page. If it came from the BOQ itself, write "BOQ". If nothing was found after a real search, write what you searched. Never invent a number without a source.' },
        },
        required: ['description', 'quantity', 'unit', 'product_id', 'is_missing', 'match_reason', 'ai_confidence', 'source'],
      },
    },
    missing_items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          description: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['description', 'reason'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['subject', 'detected_departments', 'items', 'missing_items', 'notes'],
}

export async function analyzeTannoorBoq(input: TannoorAnalysisInput): Promise<TannoorAnalysisResult> {
  if (input.products.length === 0) {
    throw new Error('No products configured — add products in Tannoor → Products first.')
  }
  if (input.departments.length === 0) {
    throw new Error('No covered departments configured — add departments in Furn Settings.')
  }

  // Compact catalog representation. The model has a fixed context window so we
  // send just enough to identify each product.
  const catalog = input.products.map(p => ({
    id: p.id,
    name_en: p.name_en,
    name_ar: p.name_ar,
    description_en: p.description_en,
    description_ar: p.description_ar,
    department_id: p.department_id,
    unit: p.unit,
    thickness_mm: input.productAttrs?.[p.id]?.thickness_mm ?? null,
    colors: input.productColors?.[p.id] || [],
    finish: input.productAttrs?.[p.id]?.finish ?? null,
    price_sar: p.price_sar,
    price_usd: p.price_usd,
  }))

  const deptList = input.departments.map(d => `- ${d.name_en} (${d.name_ar})`).join('\n')

  const systemInstruction = `You are an expert quantity surveyor at Kaaseb. Your job:
1. Read the BOQ + spec/drawing attachments.
2. For each BOQ line, find the best-matching product in CATALOG using item description, unit, dimensions, thickness, finish, and color clues.
3. If a clear match exists, set product_id to that product's id and is_missing to false.
4. If no product is a confident match, set product_id to empty string and is_missing to true; the front-end will flag the project as 'missing_products' so the team can add it to the catalog.
5. Drop lines that don't belong to any covered department.

When the BOQ is an image (PNG/JPG/JPEG/WEBP) — a photograph or screenshot of a paper / on-screen BOQ — you MUST visually read every row exactly like you would from a spreadsheet: extract every cell, preserve the order, and don't refuse just because the input isn't tabular. Handle phone photos with shadows or rotation, scans, hand-written annotations, stamped revisions, and mixed Arabic/English cells. Do not skip rows because the image is low quality — make your best effort on every visible item.

COVERED DEPARTMENTS:
${deptList}

CATALOG (canonical truth — never invent new product ids):
${JSON.stringify(catalog, null, 2)}

OUTPUT RULES
- Subject: build "supply <core product>" style. Keep English.
- detected_departments: dedupe canonical department names you encountered.
- items[].quantity: numeric (upper bound if range).
- items[].unit: normalize to {m, m2, m3, pcs, kg, ton, set, lot, lm}.
- items[].match_reason: one short sentence — for matched items, name the field that drove the match (e.g. "matches Marble 20mm white polished by thickness + finish"); for missing items, name the missing attribute.
- items[].source: WHERE the quantity came from — exact file + page ("Drawing A-301 p.3"), or "BOQ" if it was in the BOQ itself, or what you searched if nothing was found. NEVER invent a number without a traceable source.
- missing_items[] mirrors the entries where is_missing=true — same description, plus a short reason.
- Output JSON only.

PROJECT CONTEXT
- Project: ${input.projectName}
- Company: ${input.companyName}`

  // ZIPs expand to their contents; the global cap bounds the whole request.
  const MAX_FILES = 100
  const files: AiFile[] = []
  files.push(...await fetchAiFiles(input.boqUrl, `BOQ: ${input.boqFilename}`))

  const supporting = [
    ...input.specFiles.slice(0, 60).map(f => ({ url: f.url, label: `SPEC: ${f.name}`, visual: false })),
    ...input.drawingFiles.slice(0, 50).map(f => ({ url: f.url, label: `DRAWING: ${f.name}`, visual: true })),
  ]
  for (const f of supporting) {
    if (files.length >= MAX_FILES) break
    try {
      for (const af of await fetchAiFiles(f.url, f.label, { visual: f.visual })) {
        if (files.length >= MAX_FILES) break
        files.push(af)
      }
    } catch { /* skip */ }
  }

  const provider = await getProvider()
  const parsed = await provider.generateStructured<TannoorAnalysisResult>({
    systemInstruction,
    files,
    userText: 'Extract the BOQ now. Match every kept line against the catalog. Return JSON only.',
    schema: RESPONSE_SCHEMA,
    schemaName: 'tannoor_extraction',
    temperature: 0.1,
  })

  // Defensive normalization.
  parsed.subject = (parsed.subject || `supply ${input.projectName}`).trim().slice(0, 80)
  parsed.detected_departments = Array.from(new Set((parsed.detected_departments || []).map(s => String(s).trim()).filter(Boolean)))
  parsed.notes = (parsed.notes || '').trim() || null
  parsed.missing_items = Array.isArray(parsed.missing_items) ? parsed.missing_items : []
  parsed.items = (parsed.items || []).map(it => {
    // Coerce empty string product_id → null + ensure is_missing aligns.
    const pid = it.product_id && String(it.product_id).trim() ? String(it.product_id) : null
    const isMissing = pid === null || !!it.is_missing
    return {
      description: String(it.description || '').trim(),
      quantity: Number.isFinite(Number(it.quantity)) ? Number(it.quantity) : 0,
      unit: String(it.unit || 'm').trim(),
      product_id: pid,
      is_missing: isMissing,
      match_reason: String(it.match_reason || '').trim(),
      ai_confidence: Number.isFinite(Number(it.ai_confidence))
        ? Math.max(0, Math.min(1, Number(it.ai_confidence)))
        : 0.5,
      source: it.source ? String(it.source).trim() : '',
    }
  }).filter(it => it.description && it.quantity > 0)

  return parsed
}
