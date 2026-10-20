// كاسب AI — the guarantees that must never regress: who sees which tools,
// which links can ever be rendered, and how cards are placed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { availableTools, placeCards, ALL_TOOLS } from '@/lib/kaaseb-ai/engine'
import { safeHref, renderableHref, bilingual, isAppPage, type AiCard } from '@/lib/kaaseb-ai/cards'
import { matches, likeSafe, int, toEnd, ilikeOr } from '@/lib/kaaseb-ai/tool'
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
  for (const t of ['manual_quotes_list', 'manual_quote_get', 'items_search', 'manual_quote_edit', 'manual_quote_history', 'manual_quote_restore', 'furn_projects_list', 'furn_project_get', 'tannoor_projects_list']) {
    assert.ok(!got.includes(t), `${t} must not be offered`)
  }
})

test('admin-only tools stay admin-only even if a custom role carries the key', () => {
  const got = names('project_manager', ['page.audit', 'page.users'])
  assert.ok(!got.includes('audit_log'))
  assert.ok(!got.includes('finances_summary'))
  assert.ok(!got.includes('team_access') && !got.includes('pending_approvals'))
  assert.ok(names('super_admin', []).includes('finances_summary'))
})

test('super admin sees every tool; everyone gets the personal ones', () => {
  assert.equal(names('super_admin', []).length, ALL_TOOLS.length)
  const none = names('employee', [])
  assert.deepEqual(none.sort(), ['company_files', 'my_work', 'overview', 'points', 'prepare_downloads', 'search_everything'].sort())
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

test('downloads offer عربي / English; a missing language is simply not offered', () => {
  const both = bilingual('تحميل PDF', '/print/manual-quote/x?lang=ar', '/print/manual-quote/x?lang=en')
  assert.deepEqual(both?.options?.map((o) => o.label), ['عربي', 'English'])
  const one = bilingual('تحميل', null, '/print/quotation/p/q')
  assert.deepEqual(one?.options?.map((o) => o.label), ['English'])
  assert.equal(bilingual('x', null, null), null)
  assert.equal(bilingual('x', 'javascript:alert(1)', null), null)
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

test('bilingual search: alternatives, the Arabic article, gaps between words', () => {
  assert.ok(matches('البروفايل|profile', 'Company Profile 2026'))
  assert.ok(matches('البروفايل', 'بروفايل الشركة'))
  assert.ok(matches('الراجحي|Al Rajhi', 'AL RAJHI CONSTRUCTION'))
  assert.ok(!matches('بروفايل|profile', 'السجل التجاري'))
  const f = ilikeOr(['name_ar', 'name_en'], 'مؤسسة الراجحي|Al Rajhi')
  assert.equal(f, 'name_ar.ilike.%مؤسسة%راجحي%,name_ar.ilike.%Al%Rajhi%,name_en.ilike.%مؤسسة%راجحي%,name_en.ilike.%Al%Rajhi%')
  assert.equal(ilikeOr(['name_ar'], '||'), 'name_ar.eq.__none__')
  assert.ok(!ilikeOr(['a'], 'x,y(z)').includes(','))
})

test('every link that is not an app page opens in a new tab', () => {
  assert.ok(isAppPage('/manual-quotes/abc'))
  assert.ok(!isAppPage('/print/manual-quote/abc?lang=ar'))
  assert.ok(!isAppPage('/api/manual-quotes/abc/template?lang=en'))
  assert.ok(!isAppPage('https://bucket.s3.amazonaws.com/cr.pdf'))
})

test('company files are offered to everyone, gated per section inside', () => {
  const got = names('employee', [])
  assert.ok(got.includes('company_files') && got.includes('prepare_downloads'))
})

test('conversation ids cannot be used to walk the bucket', () => {
  assert.ok(isConversationId('0123456789abcdef0123'))
  assert.ok(!isConversationId('../index'))
  assert.ok(!isConversationId('0123456789abcdef0123/../../x'))
})
