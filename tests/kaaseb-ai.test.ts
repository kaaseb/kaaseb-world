// كاسب AI — the guarantees that must never regress: who sees which tools,
// which links can ever be rendered, and how cards are placed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { availableTools, placeCards, ALL_TOOLS } from '@/lib/kaaseb-ai/engine'
import { safeHref, renderableHref, type AiCard } from '@/lib/kaaseb-ai/cards'
import { matches, likeSafe, int, toEnd } from '@/lib/kaaseb-ai/tool'
import { isConversationId } from '@/lib/kaaseb-ai/store'
import { DEFAULT_PERMISSIONS } from '@/lib/permissions'
import type { Profile } from '@/types'

const profile = (role: Profile['role']) => ({ id: 'u', role, full_name: 'أحمد عدنان' } as unknown as Profile)
const names = (role: Profile['role'], perms: string[]) => availableTools(profile(role), perms).map((t) => t.name)

test('a sales-only employee gets sales tools and nothing from Furn', () => {
  // Ahmed: projects + inbox, no Furn.
  const got = names('employee', ['page.client_projects', 'page.inbox'])
  assert.ok(got.includes('client_projects_list'))
  assert.ok(got.includes('inbox_search'))
  for (const t of ['manual_quotes_list', 'manual_quote_get', 'furn_projects_list', 'furn_project_get', 'tannoor_projects_list']) {
    assert.ok(!got.includes(t), `${t} must not be offered`)
  }
})

test('admin-only tools stay admin-only even if a custom role carries the key', () => {
  const got = names('project_manager', ['page.audit', 'page.users'])
  assert.ok(!got.includes('audit_log'))
  assert.ok(!got.includes('finances_summary'))
  assert.ok(names('super_admin', []).includes('finances_summary'))
})

test('super admin sees every tool; everyone gets the personal ones', () => {
  assert.equal(names('super_admin', []).length, ALL_TOOLS.length)
  const none = names('employee', [])
  assert.deepEqual(none.sort(), ['my_work', 'overview', 'search_everything'].sort())
})

test('default employee role: Furn yes, inbox no', () => {
  const got = names('employee', DEFAULT_PERMISSIONS.employee)
  assert.ok(got.includes('furn_projects_list'))
  assert.ok(!got.includes('inbox_search'))
  assert.ok(!got.includes('opportunities_search'))
})

test('only in-app paths are accepted from tools; renderer also allows https files', () => {
  assert.equal(safeHref('/manual-quotes/abc'), '/manual-quotes/abc')
  assert.equal(safeHref('//evil.com/x'), null)
  assert.equal(safeHref('javascript:alert(1)'), null)
  assert.equal(safeHref('https://evil.com'), null)
  assert.equal(renderableHref('javascript:alert(1)'), null)
  assert.equal(renderableHref('http://x.com/a.pdf'), null)
  assert.equal(renderableHref('https://bucket.s3.amazonaws.com/a.pdf'), 'https://bucket.s3.amazonaws.com/a.pdf')
})

test('cards: only referenced, known, unique refs are kept; fallback to the last call', () => {
  const card = (ref: string): AiCard => ({ type: 'record', ref, kind: 'k', title: ref })
  const cards = new Map([['c1', card('c1')], ['c2', card('c2')], ['c3', card('c3')]])
  const a = placeCards('هذا العرض\n[[card:c2]]\n[[card:c9]]\n[[ card : c2 ]]', cards, ['c3'])
  assert.deepEqual(a.cards.map((c) => c.ref), ['c2'])
  assert.ok(!a.text.includes('c9'))
  assert.equal(a.text.match(/\[\[card:c2\]\]/g)?.length, 1)
  const b = placeCards('تفضل', cards, ['c3', 'c1'])
  assert.deepEqual(b.cards.map((c) => c.ref), ['c3', 'c1'])
})

test('argument hygiene', () => {
  assert.ok(matches('مؤسسه الراجحي', 'شركة مؤسسة الراجحي للمقاولات'))
  assert.ok(matches('احمد', 'أحمد عدنان'))
  assert.ok(!matches('خالد', 'أحمد عدنان'))
  assert.equal(likeSafe('a,b(c)%_*'), 'a b c')
  assert.equal(int('999', 8, 1, 25), 25)
  assert.equal(int('x', 8, 1, 25), 8)
  assert.equal(toEnd('2026-10-01'), '2026-10-01T23:59:59.999Z')
})

test('conversation ids cannot be used to walk the bucket', () => {
  assert.ok(isConversationId('0123456789abcdef0123'))
  assert.ok(!isConversationId('../index'))
  assert.ok(!isConversationId('0123456789abcdef0123/../../x'))
})
