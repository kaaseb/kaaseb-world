// A file is what its BYTES say — whatever it is called.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { zipSync, strToU8 } from 'fflate'
import { sniff, decodeText, unreadableReason } from '@/lib/files/sniff'
import { archiveFiles, memberName, docxText } from '@/lib/files/read'
import { heavy } from '@/lib/heavy'

function workbook(bookType: XLSX.BookType): Buffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Item', 'Description', 'Qty', 'Unit'], ['A', 'رخام كرارا 20مم', 120, 'm2']]), 'BOQ')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Item', 'Description', 'Qty', 'Unit'], ['B', 'Granite kerb', 40, 'lm']]), 'External')
  return XLSX.write(wb, { type: 'buffer', bookType }) as Buffer
}

test('spreadsheets are recognised under ANY name — xlsx, xlsm, xlsb, xls, ods, even ".bin"', async () => {
  for (const bt of ['xlsx', 'xlsm', 'xlsb', 'xls', 'ods'] as XLSX.BookType[]) {
    const buf = workbook(bt)
    assert.equal(sniff(buf, 'link-abc-BOQ-1234.bin').kind, 'spreadsheet', `${bt} stored as .bin`)
    assert.equal(sniff(buf, `BOQ.${bt}`).kind, 'spreadsheet', bt)
    const { sheets } = await heavy.xlsxSheets(buf)
    assert.equal(sheets.length, 2, `${bt}: BOTH sheets are read`)
    assert.ok(sheets[0].csv.includes('120'), `${bt}: quantities survive`)
    assert.ok(sheets[1].csv.includes('Granite kerb'), `${bt}: second sheet content`)
  }
})

test('an HTML table saved as .xls and a CSV named .txt are tables', async () => {
  const html = Buffer.from('<html><body><table><tr><td>Item</td><td>Qty</td></tr><tr><td>Marble</td><td>12</td></tr></table></body></html>')
  assert.equal(sniff(html, 'export.xls').kind, 'spreadsheet')
  assert.ok((await heavy.xlsxSheets(html)).sheets[0].csv.includes('Marble'))
  const csvAsTxt = Buffer.from('Item;Description;Qty;Unit\nA;Marble;12;m2\nB;Granite;4;m2\nC;Onyx;1;m2\n')
  assert.equal(sniff(csvAsTxt, 'boq.txt').kind, 'delimited')
  assert.equal(sniff(Buffer.from('Dear team,\nplease find the attached BOQ.\nRegards'), 'note.txt').kind, 'text')
})

test('legacy Arabic CSV (Windows-1256) decodes to real Arabic, UTF-8 stays UTF-8', () => {
  // "رخام" in Windows-1256
  const cp1256 = Buffer.from([0xd1, 0xce, 0xc7, 0xe3, 0x2c, 0x31, 0x32, 0x2c, 0x6d, 0x32])
  assert.equal(decodeText(cp1256), 'رخام,12,m2')
  assert.equal(decodeText(Buffer.from('رخام,12,m2', 'utf8')), 'رخام,12,m2')
  assert.equal(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a,b')])), 'a,b', 'BOM stripped')
})

test('pdf, images, archives, cad are told apart by magic bytes', () => {
  assert.equal(sniff(Buffer.from('%PDF-1.7\n...'), 'x.bin').kind, 'pdf')
  assert.equal(sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]), 'scan').mime, 'image/png')
  assert.equal(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'photo.bin').mime, 'image/jpeg')
  assert.equal(sniff(Buffer.from('Rar!\x1a\x07\x01\x00'), 'x.bin').kind, 'rar')
  assert.equal(sniff(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), 'x').kind, '7z')
  assert.equal(sniff(Buffer.from('AC1027\0\0\0'), 'plan.bin').kind, 'dwg')
  assert.ok(unreadableReason('7z') && unreadableReason('dwg') && unreadableReason('encrypted-office'))
  assert.equal(unreadableReason('spreadsheet'), null)
})

test('a ZIP is an archive, an .xlsx is not — and a ZIP inside a ZIP is opened', async () => {
  const inner = zipSync({ 'specs/Spec.txt': strToU8('Marble 20mm polished') })
  const outer = Buffer.from(zipSync({
    'Tender/BOQ.xlsx': new Uint8Array(workbook('xlsx')),
    'Tender/drawings.zip': inner,
    '__MACOSX/._BOQ.xlsx': strToU8('junk'),
  }))
  assert.equal(sniff(outer, 'tender.bin').kind, 'zip')
  const { files } = await archiveFiles(outer, 'tender.bin')
  assert.deepEqual(files.map((f) => memberName(f.path)).sort(), ['BOQ.xlsx', 'Spec.txt'])
  assert.equal(sniff(files.find((f) => memberName(f.path) === 'BOQ.xlsx')!.data, 'BOQ.xlsx').kind, 'spreadsheet')
})

test('docx: text AND tables come out (a BOQ sent as a Word table)', async () => {
  const xml = '<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>BOQ &amp; Specs</w:t></w:r></w:p>'
    + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Marble flooring</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>120</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>m2</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
  const docx = Buffer.from(zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8(xml) }))
  assert.equal(sniff(docx, 'boq.bin').kind, 'docx')
  const text = await docxText(docx)
  assert.ok(text && text.includes('BOQ & Specs'))
  assert.ok(/Marble flooring\s+120\s+m2/.test(text!), text!)
})
