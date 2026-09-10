# BOQ Router — design + implementation notes

> **Status: IMPLEMENTED for Furn (2026-07) — code lives in `src/lib/boq/router/`**
> (core.ts, indexer.ts, resolve.ts, pipeline.ts; wired into the Furn process route,
> which now returns 202 and runs in the background with S3 progress).
> **Tannoor still runs the single-call engine** — port it after Furn proves itself
> in production. The autopsy below remains the contract: none of the three fatal
> ideas may return. (A first attempt containing them was written and deleted
> before it shipped.)

## The problem

A project arrives as 1 BOQ + up to 250 spec PDFs + 250 drawings + 250 other files.
**The BOQ is a router, not the source of truth**: a row says `qty per Sold.pdf p.40`
and the real number lives elsewhere. Sometimes the row says nothing and the quantity
must be hunted.

Today's engine dumps ≤100 files into ONE LLM call. Token explosion, accuracy collapse
in the noise, and the model still writes *"Searched all 100 attachments"* after seeing
20 — a claim the team is instructed to trust.

Note the current caps are already incoherent: upload accepts `BUCKET_CAP = 250` per
bucket (750 total), the engine sends `MAX_FILES = 100`. **650 files never enter the
process.** Any redesign must report coverage honestly, not relocate this.

## ☠️ Three ideas that look right and are fatal — do not rebuild them

### 1. Do NOT key the cache on the S3 URL
`uploadToS3` mints `<stem>-<rand>.<ext>` (`Math.random()`, s3.ts). "Files are immutable"
is true and irrelevant — the question is whether the *same bytes* get the *same key*.
They don't. A customer sends a revised package, 248 of 250 files are byte-identical,
every one gets a new URL → **100% cache miss**. The cache never pays for itself.

Worse: `uploadBufferToS3` writes **stable** keys with no suffix, and s3.ts admits keys
get overwritten — so a URL-keyed index can hold an index for *different bytes*. Silent,
undetectable, permanent.

→ **Key on `sha256(bytes)`.** Same bytes = same index, forever, across projects and
customers. It also gives ZIP entries a real identity (they have no URL of their own).

### 2. Do NOT route with lexical/keyword search
It is tempting: `unpdf` gives per-page text for free, so "find the page mentioning
بلاط رخام" looks like a `String.includes`. **It is not.**

Proof from this repo: `department-guard.ts` needed `(?:بال|كال|لل|ال|[بلك])?` because
bare `رخام` misses `شبيهة بالرخام`. Lexical routing is *strictly weaker* than a guard
we already found insufficient. Then add the cross-language case:

| BOQ row (Arabic) | The drawing that answers it (English) | Lexical overlap |
| --- | --- | --- |
| `بلاط رخام` | `marble tile` | ∅ |
| `لوبي رئيسي` | `Main Lobby` / `GF public areas` | ∅ |

There is no threshold that finds these and doesn't also match everything.

→ **Route with ONE LLM call over the index.** The index corpus is *small*: 250 files ×
~80 tokens ≈ **20k tokens, one call**. Semantic, bilingual, and the cost of a rounding
error. Saving that 20k with a regex is penny-wise and accuracy-foolish.

### 3. Do NOT gate attachment reads on `needs_resolution`
This one is a **correctness regression** — worse than the engine it replaces.

AGENTS.md: *"Drawings override the BOQ for thickness and quantity when they conflict."*
You can only see a conflict if you **open the drawing** — and a `needs_resolution` gate
only opens it when the BOQ was silent. **The override rule becomes dead code by design.**

```
BOQ row:      Main Lobby marble — 100 m²   (a stale schematic-design figure)
              → quantity present → "no resolution needed" → drawing never opened
Drawing A-301 Rev C: Main Lobby — 168 m²
Result:       quoted 68 m² short, high confidence, no flag
```
The rows most likely to be wrong are the ones that look most complete.

→ **Route EVERY row.** Make `conflict` a first-class output: when sources disagree,
emit all candidates with citations and flag it. Never silently pick. A flagged conflict
costs a phone call; a silent wrong number costs the margin.

## The corrected architecture

1. **Phase 1 — read the BOQ ALONE.** (This part of the original design was right and is
   worth shipping on its own: it removes the token explosion at the source.)
   Per row: description, unit, quantity-if-stated, per-field `hint`s.
2. **Phase 2 — index each file ONCE, keyed by `sha256(bytes)`, versioned.**
   Cache value must carry `{contentHash, extractorVersion, indexPromptHash, modelId}` —
   files don't go stale, *our extractor does*. Without a version, the day you fix a bug
   every cached entry is still from the broken extractor with no way to tell.
   **Never cache a failure** (a 503 is not a property of the file). Needs a queue: a
   full index pass is ~12M tokens and cannot fit in `maxDuration = 300`.
3. **Phase 3 — route: one LLM call, all rows × the whole index → candidate files per row.**
   Top-k, never top-1. Read revision stamps; prefer the latest, surface both when unsure.
4. **Phase 4 — read: send the candidate page(s) only.** `pdf-lib` is already a dependency,
   so extracting a single page is buildable.
5. **Phase 5 — re-run `department-guard` AFTER resolution.** A row reading
   `Cladding panel — refer to spec S-12` has no disqualifying word; the spec says
   *Terrazzo*. Classifying from the BOQ alone quotes terrazzo as marble — and Tannoor
   auto-completes with no human gate.

## The single most valuable rule: verify every number in code

Our strongest existing pattern is `department-guard.ts` — *"a rule that lives only in a
prompt is a rule that drifts; this module is the backstop: deterministic, testable,
impossible to skip."* **Apply it to quantities.**

Every extracted number must carry the **exact source substring** containing it. Then
`indexOf` that quote in the extracted page text. Fails → reject the number, don't
persist it.

This is a deterministic hallucination gate, and it makes the silent failures **loud**:
an empty page cannot produce a quote that verifies.

## Known bugs this design must not inherit

- **Drawings**: never ask the model to *measure*. It reads tabulated numbers and
  labelled dimensions. Scale bars are meaningless post-rasterization; hatched-area
  integration is invented. Rasterize sheets ourselves at a controlled DPI (computed
  from the sheet's real size to hold small text above ~20px) and tile large ones —
  otherwise an A0 elevation's 2.5mm schedule text lands sub-pixel and is unreadable.
- **Per-field, not per-row**: one row legitimately needs qty from `Sold.pdf p.40`,
  finish from the finishes schedule, thickness from `S-12`. A single row-level bool
  cannot express that, and AGENTS.md's "mark thickness as assumed" needs somewhere to live.
- **Tannoor never receives `otherFiles`** — `TannoorAnalysisInput` has only spec+drawing.
  Furn was fixed; Tannoor wasn't. (Free to fix, do it early.)

## Already fixed (2026-07)

- `extractPdfText` judged text per DOCUMENT, not per page — a 3-page digital cover on a
  400-page scan passed the threshold and returned 397 empty pages that looked complete.
  Now per-page with a ratio gate. **This was costing real runs before any redesign.**

## Attributes + the two-tier scope rule (2026-09)

Two behaviours were added on the owner's decisions after reading seven real BOQs
of wildly different layouts. Both live in code, not only in prompts.

**Phase 4 reads attributes, not just quantities.** The owner's requirement:
*"ملف رئيسي آخذ منه البنود، ملف ثاني الكمية، ملف ثالث السماكة"*. Every routed
page read now returns `attributes` (thickness_mm / finish / size / colour /
material) alongside the quantity, **in the same call** (no extra tokens), under the
same hallucination gate: a text page must contain every quoted fragment verbatim
(`attrsVerify`), a visual page needs two blind reads that agree per field
(`attrsAgree`). A row keeps consuming its candidate pages while it lacks a
quantity **or** — once that's settled — while the BOQ stated no thickness and
none was read (`needsRead`); still bounded by `MAX_READ_GROUPS`. The second
(confirming) visual read is taken only when read A found a quantity or a
thickness. Thickness follows the quantity rule: a DRAWING overrides a stated
value with a ⚠️ note, any other source only notes the disagreement. Values are
appended to `details` label-free in phase 1's own order. `thicknessFromText`
is deterministic and must not read `600x600mm`, `90mm wide` or `5mm grouting`
as a thickness (22 cases from the owner's files, all passing).

**Phase 1 table-structure rules (7–12).** Parent + lettered sub-items → one item
per child inheriting the parent's specs; two-row items and wrapped text → one
item; total + per-room columns → the total (breakdown in details), repeated
per-building rows → mirror the file; codes (ST-01 / PV-01) are kept, never
guessed; section headers are never items.

**Two-tier scope (`isClearlyOutOfScope`).** *"أي بند واضح جداً خارج نطاقنا لا
تحسبه من الأساس"*. A manufactured/non-stone department evidenced **in the row's
own words** (concrete, terrazzo, porcelain, GRC, look-alike…) is dropped from the
table and listed by name in `ai_summary`. When only the model claims another
department, that is believed solely if the row's text carries no stone anchor —
a sheet titled "PRECAST CONCRETE" listing "Granite Setts, Material: Granite" is
flagged for a human, never dropped. Natural stone outside the covered list, or
no material named, stays in and is flagged.

## Hardening without live projects (2026-09)

Built from the seven real BOQs the owner supplied, all deterministic, all under
`npm test`, none changing the team's workflow:

- **Structural validators** (`router/validate.ts`, run in the Furn process route
  after extraction): a section/bill heading emitted as an item is dropped and
  listed in the run summary; a child variant that lost its parent's material
  ("90mm wide") or a dangling parent line ("Supply and installation of") is
  flagged for review; a per-zone breakdown in `details` that does not add up to
  the quantity is flagged with both numbers.
- **Large-BOQ chunking** (`router/chunk.ts`): a text BOQ above
  `BOQ_CHUNK_TRIGGER_LINES` is split at blank/sheet/heading boundaries — never
  mid-item — and read part by part, each part carrying the sheet + column
  headers as `# CONTEXT:` lines the model is told never to extract. Small BOQs
  are untouched (one call).
- **Revision awareness** (`router/revision.ts`): a revision token is parsed
  from file name / title / first page; files are grouped per sheet and older
  issues are marked in the routing catalogue ("إصدار أقدم — الأحدث X"), the
  router is told to prefer the latest, and a quantity read from a superseded
  issue is flagged in phase 5 with confidence capped at 0.6.
- **Accuracy scorecard** (`npm run eval`, `evals/`): runs the real router on
  fixture projects and scores against `expected.json` (owner-confirmed ground
  truth). Fixture documents and results stay out of Git. Each run costs AI
  calls; it is how "99%" becomes a number.

## Several BOQ files per project (2026-09)

A client package arrives as one workbook per trade plus an "ALL PACKAGES
COMBINED" one — and the import used to keep only the LAST file (a single
`boqFile` slot overwritten in a loop), so a 7-file package produced a 1-item
quotation. `furn_projects` still holds a single `boq_url` (no migrations), so:

- **All BOQ files** live in the S3 extras store (`lib/furn/project-extras.ts`,
  written atomically); `boq_url` stays = the first file for compatibility.
  The form's BOQ bucket is multi-file; the import pulls every file of every
  category, plus the client project's **notes** (links included) and
  **keywords**, which are shown on the project and given to phase 1 as
  context only.
- **Phase 1 reads every BOQ file** (each its own call, chunked when large),
  `mergePhase1Parts` prefixes the pricing-screen section with the file name,
  and `dedupeAcrossFiles` folds a line that appears IDENTICALLY (description +
  quantity + unit) in two different files — the combined workbook repeating a
  package — keeping one copy with the other file recorded in its source.
  Same-file repeats are left to the review flag. Tests: tests/boq-merge.test.ts.
