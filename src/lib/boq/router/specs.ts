// BOQ Router — phase 2½: the project's SPEC KNOWLEDGE BASE.
//
// The per-row reader (phase 4) only opens the 1–3 pages routed for a row and
// only accepts attributes written "for THIS item". That misses the way real
// projects state specs:
//
//   • a general clause in the spec book — "Marble: 20 mm thick, polished,
//     Crema Marfil, 600×600" — that applies to EVERY marble line,
//   • a finishes schedule keyed by CODE (ST-01 → Carrara, honed, 20 mm),
//   • a room/element schedule (Lobby floor → marble X; Stair treads → granite Y),
//   • a drawing legend / material key (visual), a stone datasheet in "other",
//   • the client's own notes ("all stone paving 40 mm").
//
// So, once, per project: harvest every stone-material definition from the
// pages that look like specs/schedules/legends into a list of SpecEntry, each
// with the verbatim quote it came from (verified against the page text; visual
// pages need two independent reads to agree). Cached per file content hash —
// re-runs and other projects sharing the file pay nothing.
//
// Then, deterministically, each row that still lacks an attribute is matched:
//   code in the row  ⟹  entry with that code           (strongest)
//   stone name / colour named in the row                 (strong)
//   entry "applies to" words overlapping the row/section (medium)
//   a GENERAL clause for the row's material              (weakest — marked
//                                                         as assumed, capped
//                                                         confidence)
// Nothing here ever invents a value: no verified quote, no entry.

import { getProvider } from '@/lib/ai'
import type { AiFile, JsonSchema } from '@/lib/ai/provider'
import { mimeFromName } from '@/lib/ai/files'
import { readJson, mutateJson } from '@/lib/s3'
import {
  AI_CALL_TIMEOUT_MS, ATTR_KEYS, EMPTY_ATTRS, PAGE_TEXT_CAP, READ_CONCURRENCY,
  attrsVerify, attrsAgree, hasAnyAttr, mergeAttrs, normalizeText, pooled, withTimeout,
  type IndexedFile, type ResolvedAttrs, type SourceBucket,
} from './core'
import { extractPdfPageRange, refetchBytes } from './indexer'

export const SPEC_VERSION = 1
const MAX_TEXT_PAGES = 30
const MAX_VISUAL_PAGES = 6
const MAX_ENTRIES_PER_PAGE = 40

const cacheKey = (sha: string) => `app-data/boq-specs/v${SPEC_VERSION}-${sha}.json`

export interface SpecEntry {
  code: string | null
  name: string | null
  attrs: ResolvedAttrs
  /** Where/what it applies to, as written ("Lobby floor", "all external paving"). */
  appliesTo: string | null
  scope: 'general' | 'specific'
  quote: string
  fileName: string
  page: number | null
  bucket: SourceBucket
  visual: boolean
}

type StoredEntry = Omit<SpecEntry, 'fileName' | 'bucket'>
interface SpecCache { pages: Record<string, StoredEntry[]> }

// ─── page selection (deterministic, free) ───────────────────────────────────

const STONE_RE = /\b(marble|granite|limestone|travertine|basalt|onyx|quartzite|sandstone|slate|stone)\b|رخام|جرانيت|حجر|ترافرتين|بازلت|اونيكس|بلاط/i
const SPEC_HINT_RE = /\b(thick(?:ness)?|thk|mm|finish(?:es|ed)?|polished|honed|flamed|bush[- ]?hammered|sand[- ]?blast(?:ed)?|leather(?:ed)?|tumbled|brushed|schedule|legend|specification|material|colou?r|size|edge|bullnose|bevel(?:led)?|sealer|sealed|anti[- ]?slip|water[- ]?jet|cut[- ]to[- ]size|slab|tile)\b|سماك|فنش|تشطيب|مصقول|مطفي|ملمع|مفرش|جدول|مواصف|لون|مقاس|حاف|قص|مانع|انزلاق|معالج/gi

export function specScore(text: string | null | undefined): number {
  const t = text || ''
  if (!STONE_RE.test(t)) return 0
  const hits = (t.match(SPEC_HINT_RE) || []).length
  return hits >= 4 ? Math.min(hits, 60) : 0
}

const VISUAL_ANCHOR_RE = /legend|schedule|finish|material|spec|key\b|رموز|جدول|تشطيب|مواد|مواصف|مفتاح/i

export interface SpecPagePick { file: IndexedFile; page: number; visual: boolean; score: number }

/** Which pages are worth harvesting: text pages that read like a spec/schedule
 *  (stone word + enough spec vocabulary), and visual pages whose TOC line says
 *  legend/schedule/finishes. Bounded, spec bucket first. */
export function pickSpecPages(files: IndexedFile[]): SpecPagePick[] {
  const text: SpecPagePick[] = []
  const visual: SpecPagePick[] = []
  for (const f of files) {
    if (f.kind === 'unreadable') continue
    for (const p of f.pages) {
      if (p.text) {
        const s = specScore(p.text)
        if (s > 0) text.push({ file: f, page: p.page, visual: false, score: s * (f.bucket === 'spec' ? 1.5 : 1) })
      } else if (VISUAL_ANCHOR_RE.test(p.anchor) && !p.anchor.startsWith('(')) {
        visual.push({ file: f, page: p.page, visual: true, score: f.bucket === 'drawing' ? 2 : 1 })
      }
    }
  }
  text.sort((a, b) => b.score - a.score)
  visual.sort((a, b) => b.score - a.score)
  return [...text.slice(0, MAX_TEXT_PAGES), ...visual.slice(0, MAX_VISUAL_PAGES)]
}

// ─── the LLM harvest ────────────────────────────────────────────────────────

const SPEC_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['entries'],
  properties: {
    entries: {
      type: 'array',
      description: 'Every natural-stone material definition WRITTEN on this page. Empty when none.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'name', 'material', 'colour', 'finish', 'thickness_mm', 'size', 'treatment', 'cut', 'applies_to', 'scope', 'quote'],
        properties: {
          code: { type: 'string', description: 'Reference code as written (ST-01, MA-003, PV-1). Empty if none.' },
          name: { type: 'string', description: 'Trade/stone name as written (Crema Marfil, Black Galaxy). Empty if none.' },
          material: { type: 'string', description: 'marble / granite / limestone / travertine / basalt / onyx / quartzite… as written. Empty if not stated.' },
          colour: { type: 'string', description: 'Colour as written. Empty if not stated.' },
          finish: { type: 'string', description: 'Finish as written (polished, honed, flamed, bush-hammered…). Empty if not stated.' },
          thickness_mm: { type: ['number', 'null'], description: 'Thickness in mm as written (convert cm→mm). null if not stated.' },
          size: { type: 'string', description: 'Size / module as written (600x600mm, slabs, cut to size…). Empty if not stated.' },
          treatment: { type: 'string', description: 'Treatment as written (sealer, impregnation, anti-slip, crystallisation…). Empty if not stated.' },
          cut: { type: 'string', description: 'Cutting / edge method as written (water-jet, bullnose, bevelled, mitred, cut-to-size…). Empty if not stated.' },
          applies_to: { type: 'string', description: 'Where/what this definition applies to, as written (rooms, elements, "all external paving"). Empty if not stated.' },
          scope: { type: 'string', enum: ['general', 'specific'], description: 'general = a blanket clause for every item of this material; specific = tied to a code, a room/element, or a named product.' },
          quote: { type: 'string', description: 'VERBATIM fragments the values were read from, character-for-character, joined with " | ". Required.' },
        },
      },
    },
  },
}

interface RawSpec {
  entries?: Array<Record<string, unknown>>
}

const SYSTEM = 'أنت قارئ مواصفات فنية لشركة رخام وجرانيت. أمامك صفحة واحدة من مستند مشروع (كتاب مواصفات، جدول تشطيبات، جدول مواد/رموز، ورقة بيانات حجر، أو ملاحظات). استخرج كل تعريف لمادة حجرية طبيعية مكتوب في هذه الصفحة: الكود إن وُجد (ST-01…)، الاسم التجاري، المادة (رخام/جرانيت/…)، اللون، الفنش، السماكة بالمليمتر، المقاس، المعالجة (مانع تسرب، مضاد انزلاق…)، طريقة القص/الحافة، والأماكن أو العناصر التي ينطبق عليها كما كُتبت. scope=general إذا كان بنداً عاماً ينطبق على كل بنود هذه المادة في المشروع، وspecific إذا ارتبط بكود أو مكان أو منتج بعينه. quote = المقاطع الحرفية التي قرأت منها القيم مفصولة بـ" | ". اترك غير المكتوب فارغاً/null. لا تخمّن، ولا تستنتج من معرفة عامة، ولا تدمج تعريفين مختلفين في واحد. تجاهل المواد المصنّعة (بورسلان، تيرازو، خرسانة، GRC) إلا إن كانت مذكورة كبديل صريح لمادة حجرية.'

const str = (v: unknown, cap = 80): string | null => {
  const s = String(v ?? '').trim().slice(0, cap)
  return s ? s : null
}

function parseEntries(parsed: RawSpec): Array<{ entry: Omit<StoredEntry, 'page' | 'visual'>; quote: string }> {
  const out: Array<{ entry: Omit<StoredEntry, 'page' | 'visual'>; quote: string }> = []
  for (const e of (parsed.entries || []).slice(0, MAX_ENTRIES_PER_PAGE)) {
    const quote = String(e.quote || '').trim()
    if (!quote) continue
    const t = Number(e.thickness_mm)
    const attrs: ResolvedAttrs = {
      thickness_mm: Number.isFinite(t) && t > 0 && t < 1000 ? t : null,
      finish: str(e.finish), size: str(e.size), colour: str(e.colour), material: str(e.material),
      treatment: str(e.treatment), cut: str(e.cut),
    }
    if (!hasAnyAttr(attrs)) continue
    out.push({
      entry: {
        code: str(e.code, 40), name: str(e.name, 80), attrs,
        appliesTo: str(e.applies_to, 160),
        scope: e.scope === 'general' ? 'general' : 'specific',
        quote: quote.slice(0, 400),
      },
      quote,
    })
  }
  return out
}

async function harvestTextPage(text: string, label: string): Promise<StoredEntry[]> {
  const provider = await getProvider()
  const parsed = await withTimeout(
    provider.generateStructured<RawSpec>({
      systemInstruction: SYSTEM,
      files: [],
      userText: `## الصفحة (${label})\n${text.slice(0, PAGE_TEXT_CAP)}\n\nJSON فقط.`,
      schema: SPEC_SCHEMA,
      schemaName: 'spec_entries',
      temperature: 0,
    }),
    AI_CALL_TIMEOUT_MS,
    `مواصفات ${label}`,
  )
  // Hallucination gate: every quoted fragment must be on the page, verbatim.
  return parseEntries(parsed)
    .filter(({ quote, entry }) => attrsVerify(text, quote, entry.attrs))
    .map(({ entry }) => ({ ...entry, page: null, visual: false }))
}

async function harvestVisualPage(file: IndexedFile, page: number): Promise<StoredEntry[]> {
  const buf = await refetchBytes(file)
  const mime = mimeFromName(file.name)
  const aiFile: AiFile = mime === 'application/pdf'
    ? { data: (await extractPdfPageRange(buf, page, page)).toString('base64'), mimeType: 'application/pdf', label: `${file.name} — صفحة ${page}` }
    : { data: buf.toString('base64'), mimeType: mime, label: file.name }
  const provider = await getProvider()
  const once = (tag: string) => withTimeout(
    provider.generateStructured<RawSpec>({
      systemInstruction: SYSTEM + ' الصفحة صورة: اقرأ فقط ما هو مكتوب فعلاً (جداول الرموز والمواد والملاحظات المكتوبة)؛ ممنوع القياس من الرسم.',
      files: [aiFile],
      userText: 'استخرج تعريفات المواد الحجرية المكتوبة في هذه الصفحة. JSON فقط.',
      schema: SPEC_SCHEMA,
      schemaName: 'spec_entries_visual',
      temperature: 0,
    }),
    AI_CALL_TIMEOUT_MS,
    `مواصفات بصرية ${tag} ${file.name} ص${page}`,
  )
  // Two blind reads; an entry survives only where both agree, field by field.
  const a = parseEntries(await once('أ')).map((x) => x.entry)
  if (a.length === 0) return []
  const b = parseEntries(await once('ب')).map((x) => x.entry)
  const key = (e: { code: string | null; name: string | null }) => normalizeText(e.code || e.name || '')
  const out: StoredEntry[] = []
  for (const ea of a) {
    const k = key(ea)
    if (!k) continue
    const eb = b.find((x) => key(x) === k)
    if (!eb) continue
    const agreed = attrsAgree(ea.attrs, eb.attrs)
    if (!hasAnyAttr(agreed)) continue
    out.push({ ...ea, attrs: agreed, page, visual: true })
  }
  return out
}

/** Harvest the KB for a project: cached per file hash, one call per new page. */
export async function harvestSpecs(
  files: IndexedFile[],
  notes: string | null,
  log: (m: string) => void,
): Promise<{ entries: SpecEntry[]; pagesRead: number; pagesFromCache: number }> {
  const picks = pickSpecPages(files)
  const entries: SpecEntry[] = []
  let pagesRead = 0
  let pagesFromCache = 0

  // Group by file so the cache is read once per file.
  const byFile = new Map<string, { file: IndexedFile; picks: SpecPagePick[] }>()
  for (const p of picks) {
    const g = byFile.get(p.file.sha) || { file: p.file, picks: [] }
    g.picks.push(p)
    byFile.set(p.file.sha, g)
  }

  await pooled([...byFile.values()], READ_CONCURRENCY, async ({ file, picks: filePicks }) => {
    const cached = await readJson<SpecCache | null>(cacheKey(file.sha), null)
    const fresh: Record<string, StoredEntry[]> = {}
    for (const pk of filePicks) {
      const k = String(pk.page)
      let stored = cached?.pages?.[k]
      if (stored) {
        pagesFromCache++
      } else {
        try {
          const pageObj = file.pages.find((p) => p.page === pk.page)
          stored = pk.visual
            ? await harvestVisualPage(file, pk.page)
            : await harvestTextPage(pageObj?.text || '', `${file.name} ص${pk.page}`)
          stored = stored.map((e) => ({ ...e, page: pk.page }))
          fresh[k] = stored
          pagesRead++
          log(`مواصفات ${file.name} ص${pk.page}: ${stored.length} تعريف`)
        } catch (e) {
          log(`فشل حصاد المواصفات ${file.name} ص${pk.page}: ${e instanceof Error ? e.message : e}`)
          continue // not cached — retried next run
        }
      }
      for (const e of stored) entries.push({ ...e, fileName: file.name, bucket: file.bucket })
    }
    if (Object.keys(fresh).length > 0) {
      try {
        await mutateJson<SpecCache>(cacheKey(file.sha), { pages: {} }, (cur) => ({ pages: { ...(cur?.pages || {}), ...fresh } }))
      } catch { /* cache is an optimisation */ }
    }
  })

  // The client's notes ("all stone paving 40mm") — one cheap call, only when
  // they actually talk specs.
  if (notes && specScore(notes) > 0) {
    try {
      const got = await harvestTextPage(notes, 'ملاحظات المشروع')
      for (const e of got) entries.push({ ...e, fileName: 'ملاحظات المشروع', bucket: 'other' })
      pagesRead++
    } catch (e) {
      log(`فشل قراءة مواصفات الملاحظات: ${e instanceof Error ? e.message : e}`)
    }
  }

  return { entries, pagesRead, pagesFromCache }
}

// ─── matching (deterministic) ───────────────────────────────────────────────

export type Material = 'marble' | 'granite' | 'limestone' | 'travertine' | 'basalt' | 'onyx' | 'quartzite' | 'sandstone' | 'slate'
const MATERIAL_RE: Array<[Material, RegExp]> = [
  ['marble', /\bmarble\b|رخام/i], ['granite', /\bgranite\b|جرانيت|غرانيت/i], ['limestone', /\blimestone\b|حجر جيري|لايم ?ستون/i],
  ['travertine', /\btravertine\b|ترافرتين/i], ['basalt', /\bbasalt\b|بازلت/i], ['onyx', /\bonyx\b|اونيكس|أونيكس/i],
  ['quartzite', /\bquartzite\b|كوارتزيت/i], ['sandstone', /\bsandstone\b|حجر رملي/i], ['slate', /\bslate\b|سليت/i],
]
export function materialOf(text: string | null | undefined): Material | null {
  const t = text || ''
  for (const [m, re] of MATERIAL_RE) if (re.test(t)) return m
  return null
}

const CODE_RE = /\b([A-Za-z]{1,4})[-_ ]?(\d{1,4})([A-Za-z]{0,2})\b/g
export function codesIn(text: string | null | undefined): Set<string> {
  const out = new Set<string>()
  const t = text || ''
  let m: RegExpExecArray | null
  CODE_RE.lastIndex = 0
  while ((m = CODE_RE.exec(t)) !== null) {
    // "20mm", "600x600" style tokens are dimensions, not codes.
    if (/^(mm|cm|m|x|no|pcs)$/i.test(m[1])) continue
    out.add(`${m[1]}${m[2]}${m[3]}`.toLowerCase())
  }
  return out
}
const normCode = (c: string | null) => (c ? c.toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '') : '')

const STOP = new Set(['and', 'the', 'for', 'all', 'with', 'from', 'this', 'that', 'per', 'من', 'في', 'على', 'الى', 'إلى', 'كل', 'مع', 'عن', 'حسب', 'وفق'])
function words(s: string): Set<string> {
  return new Set(normalizeText(s).split(/[\s.]+/).filter((w) => w.length >= 3 && !STOP.has(w)))
}

export interface SpecMatch {
  attrs: ResolvedAttrs
  cites: string[]
  /** Only a blanket clause matched — an assumption, not a row-specific fact. */
  generic: boolean
  score: number
}

export interface MatchRow { description: string; details: string | null; section: string | null; department_match: string | null }

/** Best spec entries for a row, merged per field (strongest first). null when
 *  nothing relates — never a guess. */
export function matchSpec(row: MatchRow, entries: SpecEntry[]): SpecMatch | null {
  if (entries.length === 0) return null
  const rawText = [row.description, row.details || '', row.section || ''].join(' ')
  const rowText = normalizeText(rawText)
  const rowWords = words(rawText)
  const rowCodes = codesIn(rawText)
  const rowMaterial = materialOf(rawText) || materialOf(row.department_match)

  const scored: Array<{ e: SpecEntry; score: number; generic: boolean }> = []
  for (const e of entries) {
    const entryMaterial = materialOf(e.attrs.material) || materialOf(e.name) || materialOf(e.quote)
    if (rowMaterial && entryMaterial && rowMaterial !== entryMaterial) continue // granite spec ≠ marble row
    let score = 0
    let generic = false
    const code = normCode(e.code)
    if (code && rowCodes.has(code)) score += 100
    const name = e.name ? normalizeText(e.name) : ''
    if (name.length >= 4 && rowText.includes(name)) score += 60
    const colour = e.attrs.colour ? normalizeText(e.attrs.colour) : ''
    if (colour.length >= 4 && colour !== name && rowText.includes(colour)) score += 50
    if (e.appliesTo) {
      let overlap = 0
      for (const w of words(e.appliesTo)) if (rowWords.has(w)) overlap++
      score += Math.min(overlap, 3) * 15
    }
    if (score === 0 && e.scope === 'general' && rowMaterial && entryMaterial === rowMaterial) { score = 10; generic = true }
    if (!entryMaterial) score -= 5
    if (score > 0) scored.push({ e, score, generic })
  }
  if (scored.length === 0) return null
  scored.sort((a, b) => b.score - a.score)
  const specific = scored.filter((s) => s.score >= 15)
  const use = specific.length > 0 ? specific.slice(0, 3) : scored.filter((s) => s.generic).slice(0, 2)
  if (use.length === 0) return null

  let attrs: ResolvedAttrs = { ...EMPTY_ATTRS }
  const cites: string[] = []
  for (const { e } of use) {
    const before = attrs
    attrs = mergeAttrs(attrs, e.attrs)
    if (ATTR_KEYS.some((k) => before[k] === null && attrs[k] !== null)) {
      const c = `${e.fileName}${e.page ? ` ص${e.page}` : ''}`
      if (!cites.includes(c)) cites.push(c)
    }
  }
  if (!hasAnyAttr(attrs)) return null
  return { attrs, cites, generic: specific.length === 0, score: use[0].score }
}
