// Phase 0 — the deterministic half of "understand the package first".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { headerHints, missingDrawingRefs } from '@/lib/boq/router/brief'

const vanity = `CANDYXLS,10,1,9111111111009999999999999999999999999999
COMPANY: New Company 10/12/25 15:55:19 RH
JOB NAME: NKR - Main Contractor Works
SUBCONTRACT PACKAGE: Vanity Top
RECORD,INTERNAL LINK,REFERENCE#,TASK CODE,PAGE,ITEM,DESCRIPTION,UNIT,QUANTITY,RATE,AMOUNT
6,28735,,,1,,064023 INTERIOR ARCHITECTURAL WOOD WORK
9,28738,01.wood.1,,1,A,Vanity counter unit with bottom self; type ST-02+WD-01; dimesion 1425 x 600 x 525mm; to fit to 1 basin; as Drg. AID-00-8022; detail 1,Nr,1
11,28740,01.wood.5,,1,C,Vanity counter unit with bottom self; type ST-07+WD-02; dimesion 2500 x 600 x 550mm; to fit to 1 basin; as Drg. AID-00-8029; detail 2,Nr,2
12,28741,01.wood.7,,1,D,Vanity counter unit with bottom self; type ST-07+WD-02+SP-12; dimesion 1965 x 600 x 375mm; as Drg. AID-00-8022; detail 2,Nr,1
16,28744,01.wood.16,,1,B,Vanity counter unit with bottom self; type ST-12+WD-02+PT-05; dimesion 1900 x 600 x 550mm; as Drg. AID-00-8030; detail 1,Nr,1
41,30026,02.wood.1,,1,A,Vanity units; type ST-02; dimension 1500 x 600 x 300mm; to fit 1 basin; as Drg. AID-GF-8003; detail 2,Nr,4`

test('headerHints: package line, code families with counts, drawing refs', () => {
  const h = headerHints([vanity])
  assert.ok(h.packageLines.some((l) => /SUBCONTRACT PACKAGE: Vanity Top/i.test(l)), JSON.stringify(h.packageLines))
  assert.ok(h.packageLines.some((l) => /JOB NAME: NKR/i.test(l)))
  const st = h.codeFamilies.find((f) => f.prefix === 'ST')
  const wd = h.codeFamilies.find((f) => f.prefix === 'WD')
  assert.ok(st && st.count >= 5, 'ST family counted')
  assert.ok(wd && wd.count >= 4, 'WD family counted')
  assert.ok(st!.samples.includes('ST-02'))
  assert.ok(!h.codeFamilies.some((f) => f.prefix === 'MM' || f.prefix === 'NR'), 'units are not code families')
  assert.deepEqual([...h.drawingRefs].sort(), ['AID-00-8022', 'AID-00-8029', 'AID-00-8030', 'AID-GF-8003'])
})

test('missingDrawingRefs: cited but not attached, by name or doc number', () => {
  const refs = ['AID-00-8022', 'AID-00-8029', 'A-301']
  const attached = ['2025 09 01 AID-00-8022 Vanity details.pdf', 'A-301']
  assert.deepEqual(missingDrawingRefs(refs, attached), ['AID-00-8029'])
  assert.deepEqual(missingDrawingRefs(refs, []), refs)
})
