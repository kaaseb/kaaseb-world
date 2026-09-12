// Link engine — the pure parts: URL classification, Drive interstitial form
// parsing, archive kind sniffing, and ZIP extraction with junk filtering.
// (Network resolvers are exercised manually against live links.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, strToU8 } from 'fflate'
import { classify, driveConfirmUrl } from '@/lib/links/resolve'
import { archiveKind, extractArchive } from '@/lib/links/archive'
import { groupByName } from '@/lib/furn/attach-files'

test('classify: every platform the team meets', () => {
  const p = (u: string) => classify(u)?.provider
  assert.equal(p('https://we.tl/t-1nBhEoipsCw80zK0'), 'wetransfer')
  assert.equal(p('https://wetransfer.com/downloads/abc/941336'), 'wetransfer')
  assert.equal(p('https://drive.google.com/drive/folders/1gd3xLkmjT8IckN6WtMbyFZvLR4exRIkn?usp=sharing'), 'gdrive')
  assert.equal(p('https://docs.google.com/spreadsheets/d/1AbC/edit'), 'gdrive')
  assert.equal(p('https://www.dropbox.com/scl/fo/x/y?dl=0'), 'dropbox')
  assert.equal(p('https://1drv.ms/f/s!Abc'), 'onedrive')
  assert.equal(p('https://gulfmasco-my.sharepoint.com/:f:/g/personal/x/IgC?e=2pPAcn'), 'sharepoint')
  assert.equal(p('https://gofile.io/d/AbCdEf'), 'gofile')
  assert.equal(p('https://www.mediafire.com/file/abc/BOQ.xlsx/file'), 'mediafire')
  assert.equal(p('https://mega.nz/file/abc#key'), 'mega')
  assert.equal(p('https://example.com/files/BOQ.xlsx'), 'direct')
  assert.equal(classify('not a url'), null)
})

test('driveConfirmUrl: submits the virus-scan form with its hidden inputs', () => {
  const html = `<html><body><form id="download-form" action="https://drive.usercontent.google.com/download" method="get">
    <input type="hidden" name="id" value="1AbC"><input type="hidden" name="export" value="download">
    <input type="hidden" name="confirm" value="t"><input type="hidden" name="uuid" value="u-1"></form></body></html>`
  assert.equal(driveConfirmUrl(html), 'https://drive.usercontent.google.com/download?id=1AbC&export=download&confirm=t&uuid=u-1')
  assert.equal(driveConfirmUrl('<html>no form</html>'), null)
})

test('archiveKind: magic bytes + name, xlsx is not a zip', () => {
  const pk = new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])
  assert.equal(archiveKind('Stone & Marble.zip', pk), 'zip')
  assert.equal(archiveKind('BOQ.xlsx', pk), null)
  assert.equal(archiveKind('transfer', pk), 'zip')
  assert.equal(archiveKind('x.rar', new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 7, 1, 0])), 'rar')
  assert.equal(archiveKind('a.pdf', new Uint8Array([0x25, 0x50, 0x44, 0x46])), null)
})

test('extractArchive: zip entries streamed, junk and .bak skipped, folder kept in the name', async () => {
  const zip = zipSync({
    'Stone & Marble/Stone & MARBLE.xlsx': strToU8('xlsx-bytes'),
    'Stone & Marble/Drawing/Main Gate/Plans.pdf': strToU8('pdf-bytes'),
    'Stone & Marble/Drawing/Main Gate/Plans JF.dwg': strToU8('dwg-bytes'),
    'Stone & Marble/Drawing/Main Gate/Plans JF.bak': strToU8('bak-bytes'),
    '__MACOSX/Stone & Marble/._Stone & MARBLE.xlsx': strToU8('junk'),
    'Stone & Marble/Thumbs.db': strToU8('junk'),
    'Stone & Marble/empty.txt': new Uint8Array(0),
  })
  const seen: string[] = []
  const r = await extractArchive(archiveKind('t.zip', zip), zip, async (e) => { seen.push(e.name) })
  assert.equal(r.count, 3)
  assert.deepEqual(seen.sort(), [
    'Stone & Marble › Drawing › Main Gate › Plans JF.dwg',
    'Stone & Marble › Drawing › Main Gate › Plans.pdf',
    'Stone & Marble › Stone & MARBLE.xlsx',
  ])
  const g = groupByName(seen.map((name) => ({ url: `s3://${name}`, name })))
  assert.equal(g.boq.length, 1)
  assert.equal(g.drawing.length, 2)
  assert.equal(g.spec.length, 0)
})
