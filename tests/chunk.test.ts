// Large-BOQ chunking — nothing lost, nothing cut mid-item, headers carried.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitBoqText, isSafeBoundary, CONTEXT_PREFIX, BOQ_CHUNK_TARGET_LINES } from '@/lib/boq/router/chunk'

function fakeBoq(sections: number, rowsPerSection: number): { text: string; itemLines: string[] } {
  const lines: string[] = ['## Sheet: Div.09', 'PROJECT:,AL SIRAH', 'ITEM,DESCRIPTION,UNIT,QTY,RATE,AMOUNT', ',(SAR),UNIT,QTY']
  const itemLines: string[] = []
  let n = 1
  for (let s = 1; s <= sections; s++) {
    lines.push(`09-${s}00,9.${s},SECTION ${s} FINISHES,,,`)
    for (let r = 0; r < rowsPerSection; r++) {
      const l = `09-${s}${String(r).padStart(2, '0')},9.${s}.${r},Supply and install granite tile item ${n},M2,${100 + n},,`
      lines.push(l); itemLines.push(l); n++
    }
    lines.push('')
  }
  return { text: lines.join('\n'), itemLines }
}

test('small BOQs are returned untouched (one call)', () => {
  const { text } = fakeBoq(3, 20)
  assert.deepEqual(splitBoqText(text), [text])
})

test('large BOQs split at section/blank boundaries with headers carried, no line lost or duplicated', () => {
  const { text, itemLines } = fakeBoq(12, 60) // ~750 lines
  const chunks = splitBoqText(text)
  assert.ok(chunks.length > 1, 'must chunk')
  for (const c of chunks) assert.ok(c.split('\n').length <= BOQ_CHUNK_TARGET_LINES + 100, 'bounded part size')
  // Every continuation part starts with the context block.
  for (const c of chunks.slice(1)) {
    const first = c.split('\n')[0]
    assert.ok(first.startsWith(CONTEXT_PREFIX), first)
    assert.ok(c.includes(`${CONTEXT_PREFIX} ## Sheet: Div.09`))
  }
  // Every item line appears exactly once across all parts (outside context lines).
  const seen = new Map<string, number>()
  for (const c of chunks) for (const l of c.split('\n')) if (!l.startsWith(CONTEXT_PREFIX) && l.startsWith('09-')) seen.set(l, (seen.get(l) || 0) + 1)
  for (const l of itemLines) assert.equal(seen.get(l), 1, `lost or duplicated: ${l}`)
  // Cuts land ON a boundary: each continuation part's first real (non-context)
  // line is a blank line or a section heading — the heading travels with its
  // items, and an item row is never split from its neighbours mid-section.
  for (let i = 1; i < chunks.length; i++) {
    const firstReal = chunks[i].split('\n').find((l) => !l.startsWith(CONTEXT_PREFIX))
    assert.ok(firstReal !== undefined && isSafeBoundary(firstReal), `bad cut before: ${firstReal}`)
  }
})

test('isSafeBoundary: headings and blanks yes, item rows no', () => {
  assert.equal(isSafeBoundary(''), true)
  assert.equal(isSafeBoundary('## Sheet: DIV.32'), true)
  assert.equal(isSafeBoundary('09-0010,9.2,FLOOR  FINISHES,,,'), true)
  assert.equal(isSafeBoundary('32-0003,premium natural dark basalt paving (PV-01),m2,1070,0'), false)
  assert.equal(isSafeBoundary('A,90mm wide,m,2'), false)
})
