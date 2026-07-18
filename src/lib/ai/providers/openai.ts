// OpenAI implementation of AiProvider.
//
//   • generateStructured() → Responses API. It's the only OpenAI surface that
//     ingests PDFs (input_file) alongside images and text in one call, and it
//     supports strict structured outputs (text.format json_schema), so the
//     model is guaranteed to return our schema.
//   • chatWithTools()      → Chat Completions. Text-only with function calling;
//     the classic, well-trodden tool loop.

import OpenAI from 'openai'
import type {
  AiFile,
  AiProvider,
  ChatRequest,
  StructuredRequest,
} from '../provider'

interface OpenAiProviderOpts {
  apiKey: string
  chatModel: string
  documentModel: string
}

// GPT-5.x and the o-series are reasoning models: they REJECT `temperature`
// ("Unsupported parameter") and are steered with `reasoning.effort` instead.
// gpt-4o and earlier are the opposite. We branch on the model id so either
// family works without the caller knowing which is configured.
function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/i.test(model)
}

// Derive a safe filename (with extension) for an input_file block from the
// caption ("BOQ: floor.pdf" → "floor.pdf"). OpenAI uses the extension to route
// the parser, so we keep it intact.
function filenameFromLabel(label: string, fallbackExt: string): string {
  const after = label.includes(':') ? label.slice(label.indexOf(':') + 1) : label
  const name = after.trim().replace(/[^\w.\-]+/g, '_') || `file.${fallbackExt}`
  return /\.[a-z0-9]+$/i.test(name) ? name : `${name}.${fallbackExt}`
}

// Turn our provider-agnostic files into Responses API content blocks.
function fileToBlocks(f: AiFile): Array<Record<string, unknown>> {
  if (f.mimeType.startsWith('image/')) {
    return [
      { type: 'input_text', text: f.label },
      { type: 'input_image', image_url: `data:${f.mimeType};base64,${f.data}` },
    ]
  }
  if (f.mimeType === 'application/pdf') {
    return [
      { type: 'input_text', text: f.label },
      {
        type: 'input_file',
        filename: filenameFromLabel(f.label, 'pdf'),
        file_data: `data:application/pdf;base64,${f.data}`,
      },
    ]
  }
  if (f.mimeType.startsWith('text/')) {
    // CSV / plain text — inline it directly so the model reads the table.
    const text = Buffer.from(f.data, 'base64').toString('utf8')
    return [{ type: 'input_text', text: `${f.label}\n${text}` }]
  }
  // Unknown (doc/docx/octet-stream) — best-effort as a generic file input.
  return [
    { type: 'input_text', text: f.label },
    {
      type: 'input_file',
      filename: filenameFromLabel(f.label, 'bin'),
      file_data: `data:${f.mimeType};base64,${f.data}`,
    },
  ]
}

export class OpenAiProvider implements AiProvider {
  readonly id = 'openai' as const
  private client: OpenAI
  private chatModel: string
  private documentModel: string

  constructor(opts: OpenAiProviderOpts) {
    this.client = new OpenAI({ apiKey: opts.apiKey })
    this.chatModel = opts.chatModel
    this.documentModel = opts.documentModel
  }

  async generateStructured<T = unknown>(req: StructuredRequest): Promise<T> {
    const content: Array<Record<string, unknown>> = []
    for (const f of req.files) content.push(...fileToBlocks(f))
    content.push({ type: 'input_text', text: req.userText })

    // Try the configured document model first, then degrade to known-good ones.
    //
    // WHY: the AI Settings dropdown merges live models with a hard-coded fallback
    // list, so an admin can save a model id that this account cannot actually
    // call (`gpt-5.5-mini` did exactly this) — and then EVERY Furn/Tannoor BOQ
    // run dies with "400 model does not exist". A quotation engine must not be
    // one bad dropdown pick away from total failure. On a model-not-found error
    // we fall through to a model we know exists rather than surfacing the 400.
    const candidates = Array.from(
      new Set([this.documentModel, 'gpt-5.4', 'gpt-4.1', 'gpt-4o'].filter(Boolean)),
    )

    let lastErr: unknown
    for (const model of candidates) {
      // Reasoning models (gpt-5.x / o-series) take reasoning.effort and reject
      // temperature; everything else takes temperature — picked per model since
      // the fallback might be a different family than the configured one.
      const tuning = isReasoningModel(model)
        ? { reasoning: { effort: req.reasoningEffort ?? 'high' } }
        : { temperature: req.temperature ?? 0.1 }
      try {
        const res = await this.client.responses.create({
          model,
          instructions: req.systemInstruction,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          input: [{ role: 'user', content }] as any,
          ...tuning,
          text: {
            format: {
              type: 'json_schema',
              name: req.schemaName,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              schema: req.schema as any,
              strict: true,
            },
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)

        if (model !== this.documentModel) {
          console.warn(`[openai] configured model "${this.documentModel}" unavailable — used "${model}" instead. Fix it in AI settings.`)
        }
        const raw = (res.output_text || '').trim() || '{}'
        try {
          return JSON.parse(raw) as T
        } catch (e) {
          throw new Error(`OpenAI returned non-JSON: ${(e as Error).message}\n${raw.slice(0, 400)}`)
        }
      } catch (e) {
        lastErr = e
        // Only a nonexistent/unauthorised MODEL is worth trying another model
        // for. A schema error, a rate limit, a bad key — those recur identically
        // on every candidate, so rethrow immediately instead of looping.
        if (!OpenAiProvider.isModelNotFound(e)) throw e
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('OpenAI: no usable model')
  }

  // A model the account can't call errors with one of these. Only THIS is worth
  // trying a different model for — everything else (rate limit, schema, bad key)
  // recurs identically on every candidate.
  private static isModelNotFound(e: unknown): boolean {
    const msg = (e as { message?: string })?.message || ''
    return /model.*(does not exist|not found)|does not exist.*model|model_not_found|unsupported model|do not have access to (the )?model/i.test(msg)
  }

  async chatWithTools(req: ChatRequest): Promise<string> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: req.systemInstruction },
      ...req.history.map((h) => ({ role: h.role, content: h.content }) as OpenAI.Chat.ChatCompletionMessageParam),
    ]

    const tools: OpenAI.Chat.ChatCompletionTool[] = req.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }))

    const maxHops = req.maxToolHops ?? 6
    let lastText = ''

    // Same resilience as generateStructured: if the configured chat model isn't
    // callable on this account (the saved `gpt-5.5-mini` that 400'd every chat),
    // fall through to a known-good one instead of failing. Resolved once, on the
    // first hop, then reused for the rest of the tool loop.
    const chatCandidates = Array.from(
      new Set([this.chatModel, 'gpt-5.4-mini', 'gpt-4.1-mini', 'gpt-4o-mini'].filter(Boolean)),
    )
    let modelIdx = 0

    for (let hop = 0; hop < maxHops; hop++) {
      let res: OpenAI.Chat.ChatCompletion
      for (;;) {
        try {
          res = await this.client.chat.completions.create({
            model: chatCandidates[modelIdx],
            messages,
            tools,
            tool_choice: 'auto',
          })
          break
        } catch (e) {
          if (OpenAiProvider.isModelNotFound(e) && modelIdx < chatCandidates.length - 1) {
            console.warn(`[openai] chat model "${chatCandidates[modelIdx]}" unavailable — trying "${chatCandidates[modelIdx + 1]}". Fix it in AI settings.`)
            modelIdx++
            continue
          }
          throw e
        }
      }

      const msg = res.choices[0]?.message
      if (!msg) break
      messages.push(msg)
      lastText = msg.content ?? ''

      const calls = msg.tool_calls ?? []
      if (calls.length === 0) return lastText

      for (const call of calls) {
        if (call.type !== 'function') continue
        let result: unknown
        try {
          const args = call.function.arguments ? JSON.parse(call.function.arguments) : {}
          result = await req.executeTool(call.function.name, args as Record<string, unknown>)
        } catch (e) {
          result = { error: e instanceof Error ? e.message : String(e) }
        }
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result ?? null),
        })
      }
    }

    return lastText
  }
}
