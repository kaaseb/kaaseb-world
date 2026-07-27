// POST /api/furn/quote-message/generate — draft a professional bilingual
// quotation cover message with AI (Arabic + English), save it, return it.
// Super-admin only. Falls back to the current message if the model errors.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback } from '@/lib/profile'
import { getProvider } from '@/lib/ai'
import { getQuoteMessage, setQuoteMessage } from '@/lib/furn/quote-message'

export const runtime = 'nodejs'
export const maxDuration = 120

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ar', 'en'],
  properties: {
    ar: { type: 'string', description: 'The full Arabic cover message body (no subject line).' },
    en: { type: 'string', description: 'The full English cover message body (no subject line).' },
  },
} as const

export async function POST(request: Request) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const profile = await getProfileOrFallback(supabase, user)
  if (profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'للسوبر أدمن فقط.' }, { status: 403 })
  }

  let hint = ''
  try { const b = await request.json(); hint = typeof b?.hint === 'string' ? b.hint.slice(0, 500) : '' } catch { /* optional */ }

  try {
    const provider = await getProvider()
    const parsed = await provider.generateStructured<{ ar?: unknown; en?: unknown }>({
      systemInstruction:
        'أنت كاتب أعمال محترف لشركة "كاسب — أبراج العاصمة للرخام والجرانيت" (kaaseb.sa، info@kaaseb.sa، الرياض). اكتب نص رسالة تعريفية قصيرة ومهنية تُرفق مع عرض سعر (PDF مرفق) يُرسل لعميل — نسخة عربية ونسخة إنجليزية، بدون سطر الموضوع. مهذّبة، واثقة، تذكر إرفاق العرض والاستعداد لأي استفسار أو عينات، وتنتهي بتوقيع الشركة وبياناتها. لا تخترع أرقاماً أو مشاريع.',
      files: [],
      userText: `اكتب النسختين الآن.${hint ? ` ملاحظة المستخدم: ${hint}` : ''} JSON فقط.`,
      schema: SCHEMA,
      schemaName: 'quote_message',
      temperature: 0.4,
    })
    const ar = typeof parsed.ar === 'string' ? parsed.ar.trim() : ''
    const en = typeof parsed.en === 'string' ? parsed.en.trim() : ''
    if (!ar && !en) throw new Error('empty')
    const message = await setQuoteMessage({ ar: ar || undefined, en: en || undefined })
    return NextResponse.json({ message })
  } catch (e) {
    return NextResponse.json({
      error: `تعذّر التوليد: ${e instanceof Error ? e.message : 'فشل'}`,
      message: await getQuoteMessage(),
    }, { status: 502 })
  }
}
