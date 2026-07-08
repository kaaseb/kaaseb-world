// Entry point for the AI layer. Domain code calls `getProvider()` and gets back
// whichever provider the `ai_settings` row selects, already wired with the
// resolved key + models. Nothing downstream needs to know which SDK is in play.
//
//   const provider = await getProvider()
//   const result = await provider.generateStructured<MyShape>({ ... })

import { getAiConfig } from './config'
import type { AiProvider } from './provider'
import { OpenAiProvider } from './providers/openai'
import { GeminiProvider } from './providers/gemini'

export type { AiProvider, StructuredRequest, ChatRequest, ChatTool, ChatTurn, AiFile } from './provider'
export { getAiConfig } from './config'

// Human-facing hint so callers can surface a precise "configure your key"
// message instead of a raw SDK auth error.
export class AiNotConfiguredError extends Error {
  constructor(public provider: string) {
    super(
      provider === 'openai'
        ? 'OpenAI API key not configured. Add it in Settings → AI.'
        : 'GEMINI_API_KEY not configured.'
    )
    this.name = 'AiNotConfiguredError'
  }
}

export async function getProvider(): Promise<AiProvider> {
  const cfg = await getAiConfig()
  if (!cfg.apiKey) throw new AiNotConfiguredError(cfg.provider)

  if (cfg.provider === 'gemini') {
    return new GeminiProvider({
      apiKey: cfg.apiKey,
      chatModel: cfg.chatModel,
      documentModel: cfg.documentModel,
    })
  }

  return new OpenAiProvider({
    apiKey: cfg.apiKey,
    chatModel: cfg.chatModel,
    documentModel: cfg.documentModel,
  })
}
