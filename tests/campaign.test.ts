// «حملة المشاريع» — the data that is about to be emailed must be right.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TARGETS, DEFAULT_SUBJECT, DEFAULT_BODY, varsFor, fill, hasUnfilled } from '@/lib/campaigns/stone-2026'
import { isEmail } from '@/lib/outreach/send'
import { missingSentCopies } from '@/lib/campaigns/store'

test('every address is valid and no company appears twice', () => {
  const ids = new Set<string>()
  const all = new Set<string>()
  for (const t of TARGETS) {
    assert.ok(!ids.has(t.id), `duplicate id ${t.id}`)
    ids.add(t.id)
    assert.ok(t.emails.length > 0, t.id)
    for (const e of t.emails) {
      assert.ok(isEmail(e.email), e.email)
      assert.ok(!all.has(e.email.toLowerCase()), `address twice: ${e.email}`)
      all.add(e.email.toLowerCase())
      if (!e.recommended) assert.ok(e.note, `unticked ${e.email} must say why`)
    }
    for (const f of t.files) assert.ok(f >= 1 && f <= 20, `${t.id} file ${f}`)
  }
})

test('the message fills completely for every company — no {{ }} left', () => {
  for (const t of TARGETS) {
    const v = varsFor(t)
    assert.ok(!hasUnfilled(fill(DEFAULT_SUBJECT, v)), t.id)
    assert.ok(!hasUnfilled(fill(DEFAULT_BODY, v)), t.id)
    assert.ok(fill(DEFAULT_BODY, v).includes(t.company_ar))
  }
})

test('the message says KAASEB belongs to Abraj Al-Asima and that its profile is attached', () => {
  assert.ok(DEFAULT_BODY.includes('التابعة لشركة أبراج العاصمة'))
  assert.ok(DEFAULT_BODY.includes('KAASEB is the marble and granite arm of Abraj Al-Asima Company'))
  assert.ok(DEFAULT_BODY.includes('البروفايل') && DEFAULT_BODY.includes('company profile of Abraj Al-Asima'))
})

test('an unknown placeholder is left visible so the send is refused', () => {
  const out = fill('Hi {{nme}}', varsFor(TARGETS[0]))
  assert.ok(hasUnfilled(out))
})

test('only finished old sends are filed in «Sent» — never one still sending, never twice', () => {
  const at = '2026-11-01T10:00:00Z'
  const s = {
    subject: null, body: null, failed: {},
    sent: {
      old: { at, by: 'x', to: ['a@b.com'], attached: true },
      sending: { at, by: 'x', to: [], attached: false },
      copied: { at, by: 'x', to: ['c@d.com'], attached: true, savedToSent: true },
      fresh: { at, by: 'x', to: ['e@f.com'], attached: true, response: '250 ok', savedToSent: false },
    },
  }
  assert.deepEqual(missingSentCopies(s).sort(), ['fresh', 'old'])
})
