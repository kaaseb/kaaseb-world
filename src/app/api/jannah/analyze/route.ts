import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

interface DeedEntry {
  name: string
  deed_nature: 'good' | 'bad'
  has_fixed_no: boolean
  reward_no: number | null
  reward_text: string | null
  count: number
}

interface DuaEntry {
  text: string
  timing: string
  fadl: string | null
  read_count: number
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY غير مضبوط' }, { status: 500 })
  }

  const { deeds, duas }: { deeds: DeedEntry[]; duas?: DuaEntry[] } = await req.json()

  if (!deeds || deeds.length === 0) {
    return NextResponse.json({ error: 'لا توجد بيانات للتحليل' }, { status: 400 })
  }

  const deedsText = deeds.map(d => {
    const nature = d.deed_nature === 'good' ? 'حسنة' : 'سيئة'
    const times = `${d.count} مرة`
    const weight = d.has_fixed_no && d.reward_no != null
      ? `رقم ثابت: ${d.reward_no}`
      : d.reward_text
        ? `نص: ${d.reward_text}`
        : 'بدون رقم محدد'
    return `- ${d.name} (${nature}، ${times}، ${weight})`
  }).join('\n')

  const duasSection = duas && duas.length > 0
    ? `\n\n**الأدعية المقروءة:**\n${duas.map(d => {
        const fadlNote = d.fadl ? ` — فضله: ${d.fadl}` : ''
        return `- "${d.text}" (وقت: ${d.timing}، قُرئ ${d.read_count} مرة${fadlNote})`
      }).join('\n')}`
    : ''

  const prompt = `أنت مستشار إسلامي متخصص في الفقه وتزكية النفس، تستند في تقييمك إلى آراء شيخ الإسلام ابن تيمية وابن باز وابن عثيمين رحمهم الله.

فيما يلي سجل أعمال شخص خلال فترة معينة:

**الأعمال المسجلة:**
${deedsText}${duasSection}

المطلوب منك:

1. **تقييم كل عمل**: صنّف كل عمل (سيئة كبيرة / سيئة صغيرة / حسنة عادية / حسنة عظيمة) مع ذكر المرجع من الفقهاء الثلاثة إن أمكن.

2. **الوزن الحقيقي**: الأعمال ذات الأرقام الثابتة واضحة. أما النصية فأعطِ كل منها وزناً تقديرياً من 1 إلى 100 بناءً على فداحة السيئة أو عظم الحسنة وفق الفقه الإسلامي.

3. **تقييم الأدعية**: إن وُجدت أدعية مقروءة، قيّم مدى محافظة الشخص عليها وأثر ذلك على ميزانه الروحي، مع الإشارة إلى فضل كل دعاء إن كان معروفاً.

4. **الموازين**: احسب لنا الميزان الحقيقي — ليس مجرد عدد السيئات والحسنات، بل وزنها الفعلي.

5. **الحكم الإجمالي**: هل هذا الشخص على الطريق الصحيح أم لا؟ كن صريحاً ومشجعاً في آنٍ واحد.

6. **النصيحة**: نصيحة عملية مخصصة بناءً على هذه الأعمال تحديداً — ما الذي يجب إيقافه فوراً؟ وما الذي يجب تعزيزه؟

أجب بالعربية، بأسلوب علمي ودي لا وعظي مبالغ فيه. استخدم markdown للتنسيق.`

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    return NextResponse.json({ analysis: text })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'خطأ غير معروف'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
