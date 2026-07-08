// Points-based levels. Tweak thresholds to taste.
export const LEVELS = [
  { key: 'novice',       min: 0,      label_en: 'Novice',       label_ar: 'مبتدئ' },
  { key: 'beginner',     min: 100,    label_en: 'Beginner',     label_ar: 'مبتدئ متقدم' },
  { key: 'intermediate', min: 500,    label_en: 'Intermediate', label_ar: 'متوسط' },
  { key: 'advanced',     min: 2000,   label_en: 'Advanced',     label_ar: 'محترف' },
  { key: 'expert',       min: 5000,   label_en: 'Expert',       label_ar: 'خبير' },
  { key: 'master',       min: 15000,  label_en: 'Master',       label_ar: 'أسطورة' },
] as const

export type Level = typeof LEVELS[number]

export function levelFor(points: number): Level {
  let current: Level = LEVELS[0]
  for (const lvl of LEVELS as readonly Level[]) if (points >= lvl.min) current = lvl
  return current
}

export function nextLevelOf(points: number): Level | null {
  const cur = levelFor(points)
  const list = LEVELS as readonly Level[]
  const idx = list.findIndex(l => l.key === cur.key)
  return list[idx + 1] ?? null
}
