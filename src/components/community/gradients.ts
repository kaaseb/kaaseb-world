// Preset gradient backgrounds for text stories.
export const STORY_GRADIENTS = [
  { id: 'teal',   css: 'linear-gradient(135deg, #14b8a6 0%, #0891b2 100%)' },
  { id: 'slate',  css: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)' },
  { id: 'amber',  css: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)' },
  { id: 'rose',   css: 'linear-gradient(135deg, #f43f5e 0%, #ec4899 100%)' },
  { id: 'fuchsia',css: 'linear-gradient(135deg, #a855f7 0%, #d946ef 100%)' },
  { id: 'sky',    css: 'linear-gradient(135deg, #3b82f6 0%, #0ea5e9 100%)' },
  { id: 'red',    css: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' },
  { id: 'emerald',css: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' },
  { id: 'indigo', css: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' },
  { id: 'violet', css: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)' },
]

export function gradientById(id: string | null | undefined): string {
  if (!id) return STORY_GRADIENTS[0].css
  return STORY_GRADIENTS.find(g => g.id === id)?.css ?? id
}
