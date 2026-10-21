// كاسب AI — the guarantees that must never regress: who sees which tools,
// which links can ever be rendered, and how cards are placed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { availableTools, placeCards, ALL_TOOLS, WANTS_CARD } from '@/lib/kaaseb-ai/engine'
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

test('cards: only referenced, known, unique refs are kept; never re-sent on their own', () => {
  // List cards: the "first time a record comes up" rule is tested separately below.
  const card = (ref: string): AiCard => ({ type: 'list', ref, title: ref, rows: [] })
  const cards = new Map([['c1', card('c1')], ['c2', card('c2')], ['c3', card('c3')]])
  const a = placeCards('هذا العرض\n[[card:c2]]\n[[card:c9]]\n[[ card : c2 ]]', cards, ['c3'])
  assert.deepEqual(a.cards.map((c) => c.ref), ['c2'])
  assert.ok(!a.text.includes('c9'))
  assert.equal(a.text.match(/\[\[card:c2\]\]/g)?.length, 1)
  // A reply with words but no card marker shows NO card (it used to re-send the
  // last card under every follow-up question).
  const b = placeCards('فيه بند واحد: رخام مقدوني يوناني — 100 م² — 300', cards, ['c3', 'c1'])
  assert.deepEqual(b.cards, [])
  // Only a reply with no words at all falls back to the last data call.
  const c = placeCards('', cards, ['c3', 'c1'])
  assert.deepEqual(c.cards.map((x) => x.ref), ['c3', 'c1'])
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

// ── the owner's rule: card once, then just answers ───────────────────────────
const quoteCard = (ref: string, n = 172): AiCard => ({ type: 'record', ref, kind: `عرض سعر يدوي #${n}`, title: 'ابو عبدالرحمن' })
const itemsText = 'فيه بند واحد:\n- **رخام مقدوني يوناني** — 100 م² — 300'

test('first time a quote comes up: its card leads, the answer follows', () => {
  const cards = new Map([['c1', quoteCard('c1')]])
  const r = placeCards(itemsText, cards, ['c1'], { shownKinds: [] })
  assert.deepEqual(r.cards.map((c) => c.ref), ['c1'])
  assert.ok(r.text.startsWith('[[card:c1]]'))
  assert.ok(r.text.includes('رخام مقدوني يوناني'))
})

test('same quote again in the conversation: no card, even if the model places it', () => {
  const cards = new Map([['c1', quoteCard('c1')]])
  const r = placeCards(`[[card:c1]]\n${itemsText}`, cards, ['c1'], { shownKinds: ['عرض سعر يدوي #172'] })
  assert.deepEqual(r.cards, [])
  assert.ok(!r.text.includes('[[card:'))
})

test('…unless the user asks for it (download / open / edit / send)', () => {
  const cards = new Map([['c1', quoteCard('c1')]])
  const r = placeCards('تفضل:\n[[card:c1]]', cards, ['c1'], { shownKinds: ['عرض سعر يدوي #172'], wantsCard: true })
  assert.deepEqual(r.cards.map((c) => c.ref), ['c1'])
})

test('a different quote in the same conversation still gets its card once', () => {
  const cards = new Map([['c1', quoteCard('c1', 168)]])
  const r = placeCards('هذا عرض 168', cards, ['c1'], { shownKinds: ['عرض سعر يدوي #172'] })
  assert.deepEqual(r.cards.map((c) => c.ref), ['c1'])
})

test('an edit proposal is not crowded by the quote card', () => {
  const cards = new Map<string, AiCard>([['c1', quoteCard('c1')], ['c2', { type: 'confirm', ref: 'c2', actionId: 'x', title: 'تعديل', lines: [] }]])
  const r = placeCards('راجع التعديل واضغط تأكيد\n[[card:c2]]', cards, ['c2'], { shownKinds: [] })
  assert.deepEqual(r.cards.map((c) => c.ref), ['c2'])
})

test('what counts as asking for the card itself', () => {
  for (const yes of ['حمّل عرض 172', 'ارسلي pdf', 'ابي الإكسل', 'افتح العرض', 'عدل السعر', 'send it']) assert.ok(WANTS_CARD.test(yes), yes)
  for (const no of ['وش البنود؟', 'وش طلب؟', 'كم الإجمالي؟', 'مين العميل']) assert.ok(!WANTS_CARD.test(no), no)
})
