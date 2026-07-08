// Gemini implementation of AiProvider — wraps @google/genai behind the same
// contract as the OpenAI provider so the app can switch between them with a
// single setting. This preserves the original Gemini behavior (inline-data
// multimodal + responseSchema structured output + function calling) that the
// app shipped with, now reachable through the shared abstraction.

import { GoogleGenAI, type Content, type FunctionCall } from '@google/genai'
import {
  toGeminiSchema,
  type AiProvider,
  type ChatRequest,
  type StructuredRequest,
} from '../provider'

interface GeminiProviderOpts {
  apiKey: string
  chatModel: string
  documentModel: string
}

export class GeminiProvider implements AiProvider {
  readonly id = 'gemini' as const
  private ai: GoogleGenAI
  private chatModel: string
  private documentModel: string

  constructor(opts: GeminiProviderOpts) {
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey })
    this.chatModel = opts.chatModel
    this.documentModel = opts.documentModel
  }

  async generateStructured<T = unknown>(req: StructuredRequest): Promise<T> {
    const parts: Array<{ inlineData?: { data: string; mimeType: string }; text?: string }> = []
    for (const f of req.files) {
      parts.push({ text: f.label })
      parts.push({ inlineData: { data: f.data, mimeType: f.mimeType } })
    }
    parts.push({ text: req.userText })

    const res = await this.ai.models.generateContent({
      model: this.documentModel,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: req.systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(req.schema) as Record<string, unknown>,
        temperature: req.temperature ?? 0.1,
      },
    })

    const raw = res.text || '{}'
    try {
      return JSON.parse(raw) as T
    } catch (e) {
      throw new Error(`Gemini returned non-JSON: ${(e as Error).message}\n${raw.slice(0, 400)}`)
    }
  }

  async chatWithTools(req: ChatRequest): Promise<string> {
    const contents: Content[] = req.history.map((h) => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    }))

    const tools = [{
      functionDeclarations: req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        parametersJsonSchema: t.parameters,
      })),
    }]

    const maxHops = req.maxToolHops ?? 6
    let assistantText = ''

    for (let hop = 0; hop < maxHops; hop++) {
      const res = await this.ai.models.generateContent({
        model: this.chatModel,
        contents,
        config: { systemInstruction: req.systemInstruction, tools },
      })

      const calls: FunctionCall[] = res.functionCalls || []
      if (calls.length === 0) {
        assistantText = res.text ?? ''
        break
      }

      contents.push({
        role: 'model',
        parts: calls.map((c) => ({ functionCall: { name: c.name, args: c.args } })),
      })

      const responses = await Promise.all(calls.map(async (c) => {
        const name = c.name as string
        const args = (c.args || {}) as Record<string, unknown>
        try {
          const result = await req.executeTool(name, args)
          return { name, response: { result } }
        } catch (e) {
          return { name, response: { error: e instanceof Error ? e.message : String(e) } }
        }
      }))

      contents.push({
        role: 'user',
        parts: responses.map((r) => ({ functionResponse: { name: r.name, response: r.response } })),
      })
    }

    return assistantText
  }
}
