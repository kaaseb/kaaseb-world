import type { Profile } from '@/types'

// Canonical permission keys. Used both by the Roles UI and by runtime checks.
// When adding a new page/feature, add its key here so admins can toggle access.

export const PERMISSIONS = [
  // Sidebar pages
  { key: 'page.dashboard',     label: 'Dashboard',         group: 'Pages' },
  { key: 'page.calendar',      label: 'Calendar',          group: 'Pages' },
  { key: 'page.furn',          label: 'Furn (Quotation Engine)', group: 'Pages' },
  { key: 'page.ai',            label: 'Kaaseb AI',         group: 'Pages' },
  { key: 'page.goals',         label: 'Goals Roadmap',     group: 'Pages' },
  { key: 'page.departments',   label: 'Departments',       group: 'Pages' },
  { key: 'page.daily_tasks',   label: 'Daily Tasks',       group: 'Pages' },
  { key: 'page.notifications', label: 'Notifications',     group: 'Pages' },
  { key: 'page.analytics',     label: 'Analytics',         group: 'Pages' },
  { key: 'page.users',         label: 'Users',             group: 'Pages' },
  { key: 'page.roles',         label: 'Roles (manage)',    group: 'Pages' },
  { key: 'page.audit',         label: 'Audit Log',         group: 'Pages' },
  { key: 'page.settings',      label: 'Settings',          group: 'Pages' },
  { key: 'page.client_projects', label: 'Client Projects',  group: 'Pages' },
  { key: 'page.tannoor',         label: 'Tannoor (التنّور)', group: 'Pages' },
  { key: 'page.tannoor_products', label: 'Tannoor Products', group: 'Pages' },
  { key: 'page.important_docs',   label: 'Important Documents', group: 'Pages' },
  { key: 'page.pre_qualifications', label: 'Pre-qualifications', group: 'Pages' },
  { key: 'page.visualize',        label: 'Magic Tunnel (visualizer)', group: 'Pages' },
  { key: 'page.opportunities',    label: 'Opportunities (الفرص)', group: 'Pages' },
  { key: 'page.companies',        label: 'Target Companies (شركات مستهدفة)', group: 'Pages' },
  { key: 'page.inbox',            label: 'Email Inbox (صندوق الوارد)', group: 'Pages' },

  // Hidden pages — kept here so existing custom roles keep working without
  // throwing type errors. They simply won't render in the sidebar.
  { key: 'page.community',     label: 'Community Chat (hidden)', group: 'Hidden' },
  { key: 'page.idea_market',   label: 'Idea Market (hidden)',    group: 'Hidden' },
  { key: 'page.points',        label: 'Points (hidden)',         group: 'Hidden' },
  { key: 'page.store',         label: 'Store (hidden)',          group: 'Hidden' },
  { key: 'page.approvals',     label: 'Approvals (hidden)',      group: 'Hidden' },
  { key: 'page.finances',      label: 'Finances (hidden)',       group: 'Hidden' },

  // Furn-scoped feature permissions
  { key: 'furn.projects.create',  label: 'Create Furn projects',     group: 'Furn' },
  { key: 'furn.projects.delete',  label: 'Delete Furn projects',     group: 'Furn' },
  { key: 'furn.pricing.edit',     label: 'Edit prices on items',     group: 'Furn' },
  { key: 'furn.quotation.export', label: 'Generate quotation PDFs',  group: 'Furn' },
  { key: 'furn.settings.edit',    label: 'Edit Furn settings',       group: 'Furn' },

  // Client projects
  { key: 'client_projects.create', label: 'Create client projects', group: 'Projects' },
  { key: 'client_projects.delete', label: 'Delete client projects', group: 'Projects' },
  { key: 'client_projects.edit',   label: 'Edit client projects',   group: 'Projects' },

  // Tannoor
  { key: 'tannoor.projects.create', label: 'Create Tannoor projects', group: 'Tannoor' },
  { key: 'tannoor.projects.delete', label: 'Delete Tannoor projects', group: 'Tannoor' },
  { key: 'tannoor.products.edit',   label: 'Manage Tannoor products', group: 'Tannoor' },
  { key: 'tannoor.quotation.export', label: 'Generate Tannoor quotations', group: 'Tannoor' },

  // Documents
  { key: 'docs.important.manage', label: 'Manage important documents', group: 'Documents' },
  { key: 'docs.prequal.manage',   label: 'Manage pre-qualifications',  group: 'Documents' },

  // Cross-cutting features
  { key: 'feature.create_tasks',   label: 'Create tasks',       group: 'Features' },
  { key: 'feature.assign_points',  label: 'Assign points',      group: 'Features' },
  { key: 'feature.manage_rewards', label: 'Manage store rewards', group: 'Features' },
  { key: 'feature.broadcast',      label: 'Broadcast notifications', group: 'Features' },
  { key: 'feature.site_settings',  label: 'Change site settings', group: 'Features' },
] as const

export type PermissionKey = (typeof PERMISSIONS)[number]['key']

// ── Read / Write module model ────────────────────────────────────────────────
// The Roles UI presents each section as a simple READ vs READ+WRITE choice
// instead of a flat list. This is pure UI grouping over the SAME permission keys
// above — runtime checks (hasPermission) and existing custom roles are unchanged:
//   • read  = the page.* access key (can view the section)
//   • write = the section's create/edit/delete/manage/export keys (bundled)
// A read-only role gets `read` only; a full role gets `read` + every `write` key,
// which the server routes already enforce. Modules with an empty `write` are
// access-only today (no partial edit permission exists for them yet).
export interface PermissionModule {
  key: string
  ar: string
  en: string
  read: PermissionKey
  write: PermissionKey[]
}

export const PERMISSION_MODULES: PermissionModule[] = [
  { key: 'client_projects', ar: 'المشاريع', en: 'Client Projects', read: 'page.client_projects', write: ['client_projects.create', 'client_projects.edit', 'client_projects.delete'] },
  { key: 'furn', ar: 'الفرن (العروض السعرية)', en: 'Furn (Quotations)', read: 'page.furn', write: ['furn.projects.create', 'furn.projects.delete', 'furn.pricing.edit', 'furn.quotation.export', 'furn.settings.edit'] },
  { key: 'tannoor', ar: 'التنّور', en: 'Tannoor', read: 'page.tannoor', write: ['tannoor.projects.create', 'tannoor.projects.delete', 'tannoor.quotation.export'] },
  { key: 'tannoor_products', ar: 'منتجات التنّور', en: 'Tannoor Products', read: 'page.tannoor_products', write: ['tannoor.products.edit'] },
  { key: 'important_docs', ar: 'المستندات المهمة', en: 'Important Documents', read: 'page.important_docs', write: ['docs.important.manage'] },
  { key: 'pre_qualifications', ar: 'التأهيل المسبق', en: 'Pre-qualifications', read: 'page.pre_qualifications', write: ['docs.prequal.manage'] },
  { key: 'daily_tasks', ar: 'المهام اليومية', en: 'Daily Tasks', read: 'page.daily_tasks', write: ['feature.create_tasks'] },
  { key: 'notifications', ar: 'الإشعارات', en: 'Notifications', read: 'page.notifications', write: ['feature.broadcast'] },
  { key: 'settings', ar: 'الإعدادات', en: 'Settings', read: 'page.settings', write: ['feature.site_settings'] },
  // Access-only sections (no separate edit permission today).
  { key: 'inbox', ar: 'صندوق الوارد', en: 'Email Inbox', read: 'page.inbox', write: [] },
  { key: 'opportunities', ar: 'الفرص', en: 'Opportunities', read: 'page.opportunities', write: [] },
  { key: 'companies', ar: 'الشركات المستهدفة', en: 'Target Companies', read: 'page.companies', write: [] },
  { key: 'visualize', ar: 'النفق السحري', en: 'Magic Tunnel', read: 'page.visualize', write: [] },
  { key: 'dashboard', ar: 'لوحة التحكم', en: 'Dashboard', read: 'page.dashboard', write: [] },
  { key: 'calendar', ar: 'التقويم', en: 'Calendar', read: 'page.calendar', write: [] },
  { key: 'goals', ar: 'خارطة الأهداف', en: 'Goals Roadmap', read: 'page.goals', write: [] },
  { key: 'departments', ar: 'الأقسام', en: 'Departments', read: 'page.departments', write: [] },
  { key: 'analytics', ar: 'التحليلات', en: 'Analytics', read: 'page.analytics', write: [] },
  { key: 'users', ar: 'المستخدمون', en: 'Users', read: 'page.users', write: [] },
  { key: 'roles', ar: 'الأدوار', en: 'Roles', read: 'page.roles', write: [] },
  { key: 'audit', ar: 'سجل التدقيق', en: 'Audit Log', read: 'page.audit', write: [] },
]

// Permission keys NOT owned by any module read/write above — shown as plain
// advanced toggles so nothing is lost (e.g. points/rewards features).
export const MODULE_COVERED_KEYS: Set<string> = new Set(
  PERMISSION_MODULES.flatMap((m) => [m.read, ...m.write]),
)

// Anything a super_admin can do. In practice: bypass every check.
export function isSuperAdmin(profile: Pick<Profile, 'role'> | null | undefined): boolean {
  return profile?.role === 'super_admin'
}

// Check if a profile (with its optional custom_role) has a given permission.
// super_admin always passes.
export function hasPermission(
  profile: Pick<Profile, 'role'> | null | undefined,
  permissions: string[] | null | undefined,
  key: PermissionKey
): boolean {
  if (!profile) return false
  if (isSuperAdmin(profile)) return true
  return Array.isArray(permissions) && permissions.includes(key)
}

// Default permission sets by built-in role — used when the user has no custom role.
export const DEFAULT_PERMISSIONS: Record<'super_admin' | 'project_manager' | 'employee', PermissionKey[]> = {
  super_admin: PERMISSIONS.map(p => p.key), // everything
  project_manager: [
    'page.dashboard', 'page.calendar', 'page.furn', 'page.daily_tasks',
    'page.notifications', 'page.settings',
    'page.client_projects', 'page.tannoor', 'page.tannoor_products',
    'page.important_docs', 'page.pre_qualifications', 'page.visualize',
    'page.opportunities', 'page.companies', 'page.inbox',
    'furn.projects.create', 'furn.pricing.edit', 'furn.quotation.export',
    'client_projects.create', 'client_projects.edit', 'client_projects.delete',
    'tannoor.projects.create', 'tannoor.quotation.export',
    'docs.important.manage', 'docs.prequal.manage',
    'feature.create_tasks',
  ],
  employee: [
    'page.dashboard', 'page.calendar', 'page.furn', 'page.daily_tasks',
    'page.notifications', 'page.settings',
    'page.client_projects', 'page.tannoor', 'page.visualize',
    'furn.pricing.edit',
  ],
}
