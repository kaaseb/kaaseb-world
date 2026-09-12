// File links inside an RFQ email — found, labelled, classified.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discoverFileLinks, bucketForFile, isEmailBodyPlaceholder } from '@/lib/links/discover'

const email = `Please find the below RFQ for Stone, Marble, Cement Tiles & Terrazzo,

Download RFQ files

<Stone & Marble<https://gulfmasco-my.sharepoint.com/:f:/g/personal/aaboelelaa_masecc_com/IgC8f8pLryE1QrLpLd9YKa2GAXXhYXGzHYeICFVMP2ncLlk?e=2pPAcn>
<Cement Tiles<https://gulfmasco-my.sharepoint.com/:f:/g/personal/aaboelelaa_masecc_com/IgANj9cqYJCUSrV9pDkaBb8TATCO6AmnqDv8faCezFN6olE?e=yOeunQ>
Drawings: https://drive.google.com/file/d/1AbCdEf/view?usp=sharing
Spec sheet https://example.com/files/Spec-Stone.pdf.
Unsubscribe: https://mailer.example.com/unsubscribe/123
[cid:image001.gif@01DD4131.1887F870]
`

test('discoverFileLinks: labels, kinds, and what each link needs', () => {
  const links = discoverFileLinks(email)
  assert.equal(links.length, 4, JSON.stringify(links.map((l) => l.url)))
  const [sp1, sp2, gd, direct] = links
  assert.equal(sp1.kind, 'sharepoint'); assert.equal(sp1.label, 'Stone & Marble'); assert.equal(sp1.likelyLogin, true)
  assert.equal(sp2.label, 'Cement Tiles')
  assert.equal(sp1.url.endsWith('?e=2pPAcn'), true, 'trailing ">" stripped')
  assert.equal(gd.kind, 'gdrive'); assert.equal(gd.label, 'Drawings'); assert.equal(gd.likelyLogin, false)
  assert.equal(direct.kind, 'direct'); assert.equal(direct.url, 'https://example.com/files/Spec-Stone.pdf', 'trailing "." stripped')
  assert.equal(direct.label, 'Spec sheet')
})

test('discoverFileLinks: dedupes and ignores noise', () => {
  const links = discoverFileLinks('a https://x.com/a.pdf and again https://x.com/a.pdf and a page https://x.com/about')
  assert.equal(links.length, 1)
  assert.deepEqual(discoverFileLinks(''), [])
  assert.deepEqual(discoverFileLinks(null), [])
})

test('bucketForFile + email placeholder', () => {
  assert.equal(bucketForFile('BOQ - Stone Seating.xlsx'), 'boq')
  assert.equal(bucketForFile('quantities.csv'), 'boq')
  assert.equal(bucketForFile('A-301 Rev C.pdf'), 'spec')
  assert.equal(bucketForFile('Ground floor plan.pdf'), 'drawing')
  assert.equal(bucketForFile('lobby.dwg'), 'drawing')
  assert.equal(bucketForFile('VENDOR LIST.pdf'), 'spec')
  assert.equal(bucketForFile('image001.gif'), 'other')
  assert.equal(isEmailBodyPlaceholder('نص-الإيميل-RFQ_Stone.txt'), true)
  assert.equal(isEmailBodyPlaceholder('BOQ.xlsx'), false)
})
