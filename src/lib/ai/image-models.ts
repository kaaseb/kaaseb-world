// Image providers / models / quality tiers for "النفق السحري".
//
// Shared by the API route (validation) and the client UI (selectors), so it
// stays dependency-free (no server-only imports) and the two never drift.
// All ids below were verified accessible by the project's keys.

export type ImageProvider = 'openai' | 'gemini'
export type ImageQuality = 'low' | 'medium' | 'high'

export interface ImageModelOption { id: string; label: string; hint?: string }

export interface ImageProviderInfo {
  label: string
  note: string
  models: ImageModelOption[]
  // Empty array = the model itself is the only quality lever (Gemini).
  qualities: ImageQuality[]
  defaultModel: string
}

export const IMAGE_PROVIDERS: Record<ImageProvider, ImageProviderInfo> = {
  gemini: {
    label: 'Gemini',
    note: '',
    models: [
      { id: 'gemini-3-pro-image', label: 'Nano Banana Pro (3 Pro)' },
      { id: 'gemini-3.1-flash-image', label: 'Nano Banana 2 (Flash 3.1)' },
      { id: 'gemini-2.5-flash-image', label: 'Nano Banana (Flash 2.5)' },
    ],
    qualities: [],
    defaultModel: 'gemini-3-pro-image',
  },
  openai: {
    label: 'OpenAI',
    note: '',
    models: [
      { id: 'gpt-image-2', label: 'gpt-image-2' },
      { id: 'gpt-image-1.5', label: 'gpt-image-1.5' },
      { id: 'gpt-image-1', label: 'gpt-image-1' },
    ],
    qualities: ['low', 'medium', 'high'],
    defaultModel: 'gpt-image-1',
  },
}

// Cheapest default everywhere — the owner wants the tunnel to lean on Gemini.
export const DEFAULT_PROVIDER: ImageProvider = 'gemini'

export function isValidProvider(p: unknown): p is ImageProvider {
  return p === 'openai' || p === 'gemini'
}

export function isValidModel(provider: ImageProvider, model: string): boolean {
  return IMAGE_PROVIDERS[provider].models.some(m => m.id === model)
}

export function defaultModelFor(provider: ImageProvider): string {
  return IMAGE_PROVIDERS[provider].defaultModel
}
