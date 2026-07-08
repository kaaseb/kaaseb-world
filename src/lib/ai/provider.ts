// Provider-agnostic AI contract.
//
// Everything in the app that talks to an LLM goes through an `AiProvider`:
//   • generateStructured() — multimodal document → strict JSON (BOQ extraction)
//   • chatWithTools()      — text chat with function-calling (Kaaseb AI)
//
// Two implementations live under ./providers (openai, gemini). The active one
// is chosen at runtime from the `ai_settings` row (see ./config + ./index).
// Domain code (Furn / Tannoor / chat) only ever depends on THIS file, never on
// a concrete SDK — so swapping or adding a provider is a single new file.

// A file handed to the model. `data` is base64; `mimeType` drives how each
// provider encodes it (image vs. PDF vs. inline text). `label` is a short
// human caption ("BOQ: foo.xlsx") emitted right before the file so the model
// knows what it's looking at.
export interface AiFile {
  data: string
  mimeType: string
  label: string
}

// JSON Schema (draft-2020 subset) describing the structured output. Authored
// once per feature in standard form; the OpenAI provider feeds it to strict
// structured-outputs verbatim, the Gemini provider converts it (see
// toGeminiSchema below).
export type JsonSchema = Record<string, unknown>

export interface StructuredRequest {
  // Becomes the model's system / developer instruction.
  systemInstruction: string
  // Attachments, in the order the model should see them.
  files: AiFile[]
  // Final user turn ("Now extract the BOQ. Return JSON only.").
  userText: string
  // Output contract. The provider guarantees the returned object matches it.
  schema: JsonSchema
  // Name for the schema (OpenAI strict mode requires one). Identifier-safe.
  schemaName: string
  // Sampling hint for NON-reasoning models (gpt-4o, Gemini). GPT-5.x / o-series
  // are reasoning models that reject `temperature`; for those the provider
  // sends `reasoning.effort` instead (see reasoningEffort).
  temperature?: number
  // Reasoning depth for reasoning models (gpt-5.x / o-series). Higher = more
  // accurate extraction at higher token cost + latency. Ignored by
  // non-reasoning models. Defaults to 'high' for document accuracy.
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
}

export interface ChatTool {
  name: string
  description: string
  // JSON Schema for the tool's arguments.
  parameters: Record<string, unknown>
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  systemInstruction: string
  history: ChatTurn[]
  tools: ChatTool[]
  // Called by the provider whenever the model invokes a tool. Returns whatever
  // the tool produced; the provider serializes it back to the model.
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
  // Safety bound on the tool ↔ model ping-pong.
  maxToolHops?: number
}

export interface AiProvider {
  readonly id: 'openai' | 'gemini'
  generateStructured<T = unknown>(req: StructuredRequest): Promise<T>
  chatWithTools(req: ChatRequest): Promise<string>
}

// ── JSON Schema → Gemini Schema ──────────────────────────────────────────────
// Gemini's responseSchema uses UPPERCASE type names and a small allow-list of
// keys (no additionalProperties, no $-keywords). This converts a standard
// JSON Schema node recursively so a single schema definition drives both
// providers. Anything it doesn't recognize is dropped rather than forwarded,
// which keeps Gemini from rejecting the request on an unknown field.
const TYPE_MAP: Record<string, string> = {
  object: 'OBJECT',
  array: 'ARRAY',
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
}

export function toGeminiSchema(node: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  // type may be a string or ["string","null"]; pick the first non-null member
  // and flag nullability the way Gemini expects.
  const rawType = node.type
  if (Array.isArray(rawType)) {
    const base = rawType.find((t) => t !== 'null') as string | undefined
    if (base && TYPE_MAP[base]) out.type = TYPE_MAP[base]
    if (rawType.includes('null')) out.nullable = true
  } else if (typeof rawType === 'string' && TYPE_MAP[rawType]) {
    out.type = TYPE_MAP[rawType]
  }

  if (typeof node.description === 'string') out.description = node.description
  if (Array.isArray(node.enum)) out.enum = node.enum
  if (Array.isArray(node.required)) out.required = node.required

  if (node.properties && typeof node.properties === 'object') {
    const props: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node.properties as Record<string, JsonSchema>)) {
      props[k] = toGeminiSchema(v)
    }
    out.properties = props
  }

  if (node.items && typeof node.items === 'object') {
    out.items = toGeminiSchema(node.items as JsonSchema)
  }

  return out
}
