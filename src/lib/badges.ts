// Badges catalog. Each badge has a key, label, description, emoji icon, and
// the user-facing requirement text. The evaluation function receives a stats
// snapshot and returns whether the badge is earned (and optional progress).

export type BadgeStats = {
  tasksCompleted: number     // total tasks in `tasks` with status='done' for this user
  dailyTasksCompleted: number // daily_tasks.completed === true
  totalPoints: number
  ideasCount: number
  ideasImplemented: number   // how many of user's ideas reached status='implemented'
  votesCount: number         // ideas the user voted on
  storiesCount: number
  isDepartmentMember: boolean
  hasCompletedGoal: boolean
  createdAt: string          // profile created_at — for "first step" badge
}

export interface BadgeDef {
  key: string
  emoji: string
  label_en: string
  label_ar: string
  requirement_en: string
  requirement_ar: string
  /** Returns 0..1 progress fraction towards earning the badge. */
  progress: (s: BadgeStats) => number
}

function frac(current: number, target: number): number {
  if (target <= 0) return 1
  return Math.max(0, Math.min(1, current / target))
}

export const BADGES: BadgeDef[] = [
  {
    key: 'first_step',
    emoji: '🌱',
    label_en: 'First Step',
    label_ar: 'الخطوة الأولى',
    requirement_en: 'Join Ghassl World',
    requirement_ar: 'انضممت لعالم غسّل',
    progress: () => 1, // earned the moment profile exists
  },
  {
    key: 'achiever',
    emoji: '✅',
    label_en: 'Achiever',
    label_ar: 'المنجز',
    requirement_en: 'Complete your first task',
    requirement_ar: 'أكملت أول مهمة',
    progress: (s) => frac(s.tasksCompleted + s.dailyTasksCompleted, 1),
  },
  {
    key: 'persistent',
    emoji: '💪',
    label_en: 'Persistent',
    label_ar: 'المثابر',
    requirement_en: 'Complete 10 tasks',
    requirement_ar: 'أكملت 10 مهام',
    progress: (s) => frac(s.tasksCompleted + s.dailyTasksCompleted, 10),
  },
  {
    key: 'champion',
    emoji: '🏆',
    label_en: 'Champion',
    label_ar: 'البطل',
    requirement_en: 'Complete 50 tasks',
    requirement_ar: 'أكملت 50 مهمة',
    progress: (s) => frac(s.tasksCompleted + s.dailyTasksCompleted, 50),
  },
  {
    key: 'point_collector',
    emoji: '⭐',
    label_en: 'Point Collector',
    label_ar: 'جامع النقاط',
    requirement_en: 'Earn 100 points',
    requirement_ar: 'جمعت 100 نقطة',
    progress: (s) => frac(s.totalPoints, 100),
  },
  {
    key: 'point_rich',
    emoji: '💎',
    label_en: 'Rich in Points',
    label_ar: 'ثري النقاط',
    requirement_en: 'Earn 500 points',
    requirement_ar: 'جمعت 500 نقطة',
    progress: (s) => frac(s.totalPoints, 500),
  },
  {
    key: 'point_master',
    emoji: '👑',
    label_en: 'Point Master',
    label_ar: 'سيد النقاط',
    requirement_en: 'Earn 2000 points',
    requirement_ar: 'جمعت 2000 نقطة',
    progress: (s) => frac(s.totalPoints, 2000),
  },
  {
    key: 'storyteller',
    emoji: '📸',
    label_en: 'Storyteller',
    label_ar: 'الراوي',
    requirement_en: 'Share your first story',
    requirement_ar: 'شاركت أول حالة',
    progress: (s) => frac(s.storiesCount, 1),
  },
  {
    key: 'innovator',
    emoji: '💡',
    label_en: 'Innovator',
    label_ar: 'المُبدع',
    requirement_en: 'Submit your first idea to the Idea Market',
    requirement_ar: 'طرحت أول فكرة في سوق الأفكار',
    progress: (s) => frac(s.ideasCount, 1),
  },
  {
    key: 'implementer',
    emoji: '🚀',
    label_en: 'Implementer',
    label_ar: 'صاحب فكرة مُطبَّقة',
    requirement_en: 'Have an idea marked as implemented',
    requirement_ar: 'تم تطبيق فكرة لك',
    progress: (s) => frac(s.ideasImplemented, 1),
  },
  {
    key: 'voter',
    emoji: '🗳️',
    label_en: 'Active Voter',
    label_ar: 'المُصوّت النشط',
    requirement_en: 'Vote on 10 ideas',
    requirement_ar: 'صوّتت على 10 أفكار',
    progress: (s) => frac(s.votesCount, 10),
  },
  {
    key: 'team_player',
    emoji: '🤝',
    label_en: 'Team Player',
    label_ar: 'روح الفريق',
    requirement_en: 'Join a department',
    requirement_ar: 'انضممت إلى قسم',
    progress: (s) => s.isDepartmentMember ? 1 : 0,
  },
  {
    key: 'goal_crusher',
    emoji: '🎯',
    label_en: 'Goal Crusher',
    label_ar: 'صاحب الهدف',
    requirement_en: 'Complete a full goal',
    requirement_ar: 'أتممت هدفاً كاملاً',
    progress: (s) => s.hasCompletedGoal ? 1 : 0,
  },
]

export function earnedBadges(stats: BadgeStats): BadgeDef[] {
  return BADGES.filter(b => b.progress(stats) >= 1)
}
