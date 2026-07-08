import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { TOOL_DECLARATIONS, TOOL_EXECUTORS } from '@/lib/ai/tools'
import { getProvider, AiNotConfiguredError, type ChatTool, type ChatTurn } from '@/lib/ai'

const MAX_TOOL_HOPS = 6

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { conversationId?: string; message?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const message = (body.message || '').trim()
  if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 })

  // Resolve / create conversation, scoped to this user.
  let conversationId = body.conversationId
  if (conversationId) {
    const { data: conv } = await supabase
      .from('ai_conversations').select('id').eq('id', conversationId).eq('user_id', user.id).maybeSingle()
    if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  } else {
    const title = message.length > 50 ? message.slice(0, 50) + '…' : message
    const { data: created, error } = await supabase
      .from('ai_conversations').insert({ user_id: user.id, title }).select('id').single()
    if (error || !created) return NextResponse.json({ error: error?.message || 'Failed to create conversation' }, { status: 500 })
    conversationId = created.id
  }

  await supabase.from('ai_messages').insert({ conversation_id: conversationId, role: 'user', content: message })

  const { data: profile } = await supabase
    .from('profiles').select('full_name, email, role, title, total_points').eq('id', user.id).single()

  const { data: history } = await supabase
    .from('ai_messages').select('role, content')
    .eq('conversation_id', conversationId).order('created_at', { ascending: true })

  const systemPrompt = `أنت "غسّل AI" — المساعد الإداري الذكي لمنصة "غسّل" (نظام إدارة شركة مغاسل).

**هويتك:** المستخدم: ${profile?.full_name || profile?.email || 'مستخدم'} (الدور: ${profile?.role || 'employee'}${profile?.title ? '، اللقب: ' + profile.title : ''}).

**القواعد الصارمة:**
1. **استخدم الأدوات المتاحة دائماً** عندما يسأل المستخدم عن بيانات (موظفين، مهام، مشاريع، أهداف، إحصائيات). لا تجاوب من خيالك.
2. **ممنوع منعاً باتاً** أن ترد بـ "لا أستطيع الوصول للبيانات" أو "تفقّد صفحة كذا" — لديك أدوات حقيقية تستعلم من قاعدة البيانات.
3. اقرأ نتيجة الأداة بعناية ثم اعرض الإجابة بالعربية بشكل موجز ومنسق (قوائم، جداول صغيرة، نقاط).
4. لو فشلت أداة، حاول أداة بديلة قبل الاستسلام.
5. لا تخترع أرقاماً أو أسماء — كلها يجب أن تأتي من نتائج الأدوات.
6. أجب بالعربية افتراضياً، إلا إذا كتب المستخدم بلغة أخرى.

**الأدوات المتاحة:**
- list_employees — قائمة الموظفين، يدعم الترتيب حسب النقاط
- list_tasks — مهام المشاريع + المهام اليومية، يدعم فلترة المتأخرة/المكتملة
- list_projects — المشاريع مع عدد المهام
- list_goals — الأهداف
- list_departments — الأقسام
- team_stats — إحصائيات سريعة شاملة
- employees_without_active_tasks — الموظفون بدون مهام نشطة`

  // Map our DB history + tool registry onto the provider-agnostic chat
  // contract. Whichever provider `ai_settings` selects (OpenAI by default,
  // Gemini optional) runs the tool loop.
  const turns: ChatTurn[] = (history || []).slice(-30).map(h => ({
    role: h.role === 'assistant' ? 'assistant' : 'user',
    content: h.content,
  }))

  const tools: ChatTool[] = TOOL_DECLARATIONS.map(d => ({
    name: d.name,
    description: d.description,
    parameters: d.parametersJsonSchema,
  }))

  let assistantText = ''
  try {
    const provider = await getProvider()
    assistantText = await provider.chatWithTools({
      systemInstruction: systemPrompt,
      history: turns,
      tools,
      maxToolHops: MAX_TOOL_HOPS,
      executeTool: async (name, args) => {
        const exec = TOOL_EXECUTORS[name]
        if (!exec) return { error: `Unknown tool: ${name}` }
        return await exec(args, supabase)
      },
    })
  } catch (e) {
    if (e instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: e.message }, { status: 500 })
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : 'LLM error' }, { status: 502 })
  }

  if (!assistantText.trim()) assistantText = 'عذراً، لم أتمكن من توليد رد. حاول مرة أخرى.'

  await supabase.from('ai_messages').insert({ conversation_id: conversationId, role: 'assistant', content: assistantText })
  await supabase.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId)

  return NextResponse.json({ conversationId, reply: assistantText })
}
