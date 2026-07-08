<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Furn (الفرن) — Gemini pricing AI

`/furn` is the quotation engine. A user uploads a BOQ (Excel/CSV), optional spec/drawing/other files, fills the client info, and the AI extracts a structured item list that the team prices and exports as a PDF.

The pricing AI runs on `POST /api/furn/projects/[id]/process` and uses **Gemini** (`@google/genai`) with **structured JSON output**. It MUST be strict — wrong items, wrong units, or hallucinated finishes break the whole quotation flow.

## What the AI receives

1. **BOQ file** (required): every item the customer asked for. Usually a spreadsheet (.xlsx / .xls / .csv), but customers also drop in **photographs or screenshots** of paper / on-screen BOQs (PNG, JPG, JPEG). When the upload is an image, the AI MUST read it visually — extract every row the same way it would from a spreadsheet, preserve order, and don't refuse just because the input isn't tabular. Hand-written headers, stamped revisions, and Arabic/English mixed cells all need to be handled.
2. **Drawing files** (optional): plans/elevations that disambiguate finish, thickness, edge profile, and quantities the BOQ left vague.
3. **Spec files** (optional): customer's written technical requirements.
4. **Other files** (optional): contracts, approvals, photos — only use if a primary file is silent on something.
5. **Our catalog snapshot** built fresh on every run:
   - `/tannoor/products` — the live materials catalog (marble & granite — that is the entire active department set today). Each product has bilingual names, finishes available, thicknesses available, default unit.
   - `/tannoor/pricing` — the pricing-methods center. Each method spells out how the unit price is computed (m², m, lump, etc.) and any defaults to apply.

## What the AI MUST produce (per item)

Every BOQ line becomes one `furn_items` row with these fields filled — never null, never guessed loosely:

| Field          | Rule                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| `description`  | **Short** item title (3-8 words). The catalog-style name only — no dimensions, no finishes, no citations. Rendered as the main label in the pricing table and the PDF. |
| `details`      | **Long** descriptive line: finish (honed/polished/flamed), thickness, color, dimensions, edge profile, AND a citation to the source whenever the value came from a referenced file (e.g. "qty per Sold.pdf p.40", "finish per drawing A-301"). Rendered in a smaller muted font under `description`. |
| `department`   | One of our active departments only (currently: **marble** or **granite**). Reject anything else.         |
| `product_id`   | The matched catalog product. If no confident match → flag the item, do not invent.                       |
| `finish`       | Exact finish keyword from the matched product (e.g. `honed`, `flamed`, `polished`, `bush_hammered`). Pull from drawings/specs when the BOQ doesn't say. |
| `unit`         | Exact unit the BOQ uses (`m²`, `m`, `pcs`, …). If BOQ disagrees with the product's default, keep BOQ.   |
| `quantity`     | Numeric. Cross-check against the drawings; if drawings imply a larger area, raise it on the item.        |
| `thickness_mm` | From drawings/specs. If silent, use the matched product's default thickness and mark it as assumed.      |
| `notes`        | **AI never writes here.** This column is reserved for the team to flag per-row context after the AI run. Always emit empty/null. |

## Hard rules

- **The BOQ is a router, not the source of truth.** It tells you WHICH items exist; the dimensions, finishes, and often the quantities live in OTHER attached files. Whenever a BOQ row says things like "see Sold.pdf", "refer to drawing A-301", "qty per attached schedule", "details on page 40", you MUST: (a) locate that file in the attachments, (b) read the specific page / sheet / row called out, (c) extract the resolved value, and (d) record the citation in `details` (e.g. "qty 412 m² per Sold.pdf p.40"). If the referenced file is missing, still emit the row but lower `ai_confidence` to ≤ 0.5 and call out the missing reference in `details`. A real project can ship 200+ attachments — work down the BOQ row by row, only opening the references each specific row points to.
- **`quantity: 0` is the WORST possible answer — never use it as a shortcut.** When the BOQ row has no quantity and no explicit pointer to another file, exhaustively scan EVERY attached spec/drawing/schedule for the same item (including bilingual variants — "بلاط رخام" ↔ "marble tile") and any tabulated quantity / area summary / piece count / floor-plan labelled area. Match by region too, not just by name ("Lobby flooring" + a finishes schedule listing "Lobby: 142 m² marble" → take 142). Only after a genuine search emit `quantity: 0`, and the `details` field MUST start with what you searched ("Searched all N attachments — no qty match for X"). The team's response to a 0 is to re-do the search you skipped, so spend the effort on the search, not on the apology.
- **Compound-name trap (real failure mode from production):** the word "granite" or "marble" appearing anywhere in a description does NOT mean the item is granite or marble. Look at the head noun. `"Precast Concrete Granite Wall Cladding"` → the head noun is **Precast Concrete** → NOT granite, drop it. Same for `"GRC Panel with granite finish"`, `"Cast Stone Marble-look Coping"`, `"Terrazzo Marble Pattern Tile"`, `"Porcelain Granite-Effect Floor"`. The disqualifying keywords are: **concrete, precast, cast stone, GRC, GFRC, GRG, agglomerate, terrazzo, quartz (engineered), sintered, porcelain, ceramic, vinyl, HPL, laminate, composite, faux, artificial stone, engineered stone, simulated, look, effect, finish-only.** If any of these appears in the description, the item is NOT marble/granite — drop from `items[]`, add the real department to `detected_departments[]`.
- **Positive classification only on natural-stone head nouns:** the head noun must be a real stone product (slab, tile, coping, threshold, riser, sill, paver, cladding panel) AND the material word must refer to the substance, not to a look/pattern/finish. Ambiguous descriptions ("stone tile", "decorative stone", "marble finish") are suspect — lower confidence, surface the ambiguity in `details`, don't silently classify as covered.
- **Decision order for every row:** (1) read the full description, (2) any disqualifying keyword present → drop, (3) head noun a natural-stone product? continue, (4) material word = substance or look? if look, drop, (5) classify as the covered department, (6) if dropped due to the compound-name trap, add the real department (Concrete, GRC, Porcelain, etc.) to `detected_departments[]`.
- **No items outside our departments.** If a BOQ row is for a category we don't carry, drop it from `items[]` and add the department to `detected_departments[]` — never silently put it under marble/granite and never push the AI's doubt into `notes` (that field is the team's, not the AI's).
- **No invented products.** If no product matches with high confidence, flag the row in `details`; do not pick the closest one.
- **No invented finishes.** Only finishes the matched product actually supports.
- **Keep customer units.** Don't silently convert m² → m or vice versa; surface the discrepancy in `details`.
- **Drawings override the BOQ for thickness and quantity** when they conflict, because the BOQ is often loose; surface the override in `details`.
- **One AI call per project** — don't loop per row, send the full BOQ + supporting files in a single structured-output request so cross-row context (totals, shared finishes) is preserved.
- **Bilingual safe**: customer files come in Arabic, English, or both. The prompt and the JSON schema MUST handle either without translation drift.

## Implementation pointers

- Structured output: define the item schema with `responseSchema` so Gemini returns valid JSON, not Markdown. See `@google/genai`'s structured-output guide before touching the prompt.
- Catalog snapshot: pull `tannoor_products` + `tannoor_pricing_methods` rows server-side and inject them into the prompt as a compact JSON block — don't paste raw HTML.
- Errors: write any AI failure to `furn_projects.ai_error` so the UI can show "processing failed" without poisoning the items table.
- Audit: every `process` run goes through `serverAudit({ action: 'process', objectType: 'furn_project' })`.

## Where things live

- AI entrypoint: `src/app/api/furn/projects/[id]/process/route.ts`
- Form (with import-from-`/projects`, 4 file buckets, progress bars): `src/components/furn/FurnNewForm.tsx`
- List (with bilingual search across project/company/engineer/phone): `src/components/furn/FurnList.tsx`
- Products catalog: `tannoor_products` table, surfaced at `/tannoor/products`.
- Pricing methods: `tannoor_pricing_methods` table, surfaced at `/tannoor/pricing`.

# Tannoor products — variants, not master records

Each row in `tannoor_products` is a **VARIANT** (effectively a SKU). The same base material — say "Black Galaxy Granite" — typically has 10-20+ rows in the catalogue, one per combination of attributes, each with its own price. The combination of `department_id + color + finish + thickness_mm + size_w_mm + size_l_mm + unit` identifies a specific variant; `availability` colours how confident the sales team can be in delivering that variant on a normal lead time.

## The variant attributes the AI MUST match on

| Field          | Meaning                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| `name_en/ar`   | Base material name. Multiple variants share the same name.                                                |
| `color_en/ar`  | The actual stone colour (e.g. "Black Galaxy", "Carrara White"). NOT a finish description.                 |
| `finish`       | Surface treatment (`polished`, `honed`, `flamed`, `bush-hammered`, `sand-blasted`, `leathered`, etc.).    |
| `thickness_mm` | Slab/tile thickness in mm — usually 20, 30, 40, 50. Different thicknesses are different prices.           |
| `size_w_mm`    | Slab/tile width in mm.                                                                                    |
| `size_l_mm`    | Slab/tile length in mm. Together with `size_w_mm` defines the cut size — bigger slabs cost more.          |
| `unit`         | How the variant is priced (`m²`, `m`, `pcs`, `slab`, …).                                                  |
| `availability` | One of `high` / `medium` / `low` / `out_of_stock`. Rendered as a coloured pill in the catalogue.          |
| `price_sar`    | Per-unit price in SAR for THIS specific variant. NOT a base price.                                        |
| `price_usd`    | Same in USD.                                                                                              |

## Hard rules for matching a BOQ item to a product variant

- **Never match on name alone.** "Black Galaxy" with `thickness_mm=20` is a different product from "Black Galaxy" with `thickness_mm=30`. Use the BOQ row's full spec (description + drawings + details) to pin colour + finish + thickness + size, then look up the matching variant. If two attributes are missing and the catalogue has multiple candidates, lower `ai_confidence` and surface the alternatives in `details` rather than guessing.
- **Finish is part of the SKU, not a freeform note.** "polished" and "honed" of the same colour/size/thickness are SEPARATE rows with SEPARATE prices. Don't pick the first row that name-matches; pick the row whose `finish` matches the BOQ's finish.
- **Size matching is approximate but bidirectional.** If the BOQ says "600 × 1200" and the catalogue has a "1200 × 600" variant, match it — the order of width vs. length is a labelling convention, not a physical difference. If the BOQ says only one dimension or "various", widen the search but call out the ambiguity in `details`.
- **Out-of-stock is NOT a reason to skip the row.** Match it like any other variant, but include the availability state in `details` so the pricer knows to confirm lead time before quoting. (The team often quotes on out-of-stock items with an extended lead time — that's a business decision, not a matching decision.)
- **Availability is bilingual UI sugar.** The DB stores the enum (`high|medium|low|out_of_stock`); the UI renders the Arabic/English label. Always reference the enum keys when reasoning, never the localized strings.

## Why we did NOT split this into a variants sub-table

A separate `tannoor_product_variants` table would be cleaner relational design, but every BOQ flow already treats catalogue rows as standalone priceable items. Flattening variants onto `tannoor_products` keeps the AI's matching one query, keeps the UI one editable table, and keeps the price-per-variant in plain sight when the sales team is updating numbers. The trade-off: the same `name_en` repeats many times. That's a feature here, not a bug — the catalogue IS the SKU list.
