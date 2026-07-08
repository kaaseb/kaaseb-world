export type UserRole = 'super_admin' | 'project_manager' | 'employee'
// Legacy "scope" column. Kept as a wide string so old rows ('app' / 'washhouses')
// don't fail typing — the App + Washhouses modules were removed (replaced by Furn).
export type UserScope = string

export interface Profile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  role: UserRole
  bio: string | null
  title: string | null
  language: string
  total_points: number
  lock_password_hash: string | null
  lock_enabled: boolean
  off_days: number[]
  custom_role_id: string | null
  is_department_manager: boolean
  scope: UserScope
  must_change_password: boolean
  last_seen_at: string
  created_at: string
  updated_at: string
}

export interface UserBadge {
  id: string
  user_id: string
  badge_key: string
  earned_at: string
}

export interface CustomRole {
  id: string
  name: string
  description: string | null
  permissions: string[]
  created_by: string | null
  created_at: string
  updated_at: string
}

export type StoryType = 'text' | 'image' | 'video'

export interface Story {
  id: string
  user_id: string
  type: StoryType
  text_content: string | null
  bg_color: string | null
  media_url: string | null
  expires_at: string
  created_at: string
}

export interface Post {
  id: string
  user_id: string
  content: string
  media_url: string | null
  media_type: 'image' | 'video' | null
  type: 'normal' | 'poll'
  created_at: string
  updated_at: string
}

export interface PostPollOption {
  id: string
  post_id: string
  label: string
  position: number
  created_at: string
}

export interface PostPollVote {
  post_id: string
  option_id: string
  user_id: string
  created_at: string
}

export type EventPriority = 'low' | 'medium' | 'high' | 'urgent'
export type EventAttendanceMode = 'attendance' | 'absence' | 'manual'
export type EventLocationType = 'online' | 'in_person'
export type EventAttendeeStatus = 'invited' | 'attended' | 'absent'

export interface CalendarEvent {
  id: string
  title: string
  description: string | null
  priority: EventPriority
  attendance_mode: EventAttendanceMode
  attendance_points: number
  location_type: EventLocationType
  meeting_url: string | null
  location: string | null
  event_date: string
  event_time: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface EventAttendee {
  event_id: string
  user_id: string
  status: EventAttendeeStatus
  awarded_points: number
  marked_by: string | null
  marked_at: string | null
}

export interface DepartmentDoodle {
  id: string
  department_id: string
  created_by: string | null
  title: string
  description: string | null
  image_url: string | null
  categories: string[]
  visibility: 'everyone' | 'specific'
  visible_to: string[]
  created_at: string
  updated_at: string
}

export interface PostComment {
  id: string
  post_id: string
  user_id: string
  content: string
  media_url: string | null
  media_type: 'image' | 'video' | 'file' | null
  created_at: string
}

export type ChatType = 'dm' | 'group'

export interface ChatConversation {
  id: string
  name: string | null
  type: ChatType
  image_url: string | null
  description: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ChatMember {
  id: string
  conversation_id: string
  user_id: string
  is_admin: boolean
  last_read_at: string
  joined_at: string
}

export type IdeaStatus = 'proposed' | 'implemented' | 'rejected'

export interface Idea {
  id: string
  title: string
  description: string | null
  category: string | null
  department_id: string | null
  created_by: string | null
  status: IdeaStatus
  reward_points: number
  implementation_notes: string | null
  implemented_at: string | null
  implemented_by: string | null
  created_at: string
  updated_at: string
}

export interface IdeaVote {
  id: string
  idea_id: string
  user_id: string
  created_at: string
}

export type ChatMediaType = 'image' | 'video' | 'file'

export interface ChatMessage {
  id: string
  conversation_id: string
  sender_id: string
  content: string | null
  media_url: string | null
  media_type: ChatMediaType | null
  reply_to_id: string | null
  edited_at: string | null
  deleted_at: string | null
  created_at: string
}

export interface Department {
  id: string
  name: string
  description: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface DepartmentMember {
  id: string
  department_id: string
  user_id: string
  created_at: string
}

export interface Project {
  id: string
  name: string
  description: string | null
  department_id: string
  created_by: string
  status: 'active' | 'completed' | 'archived'
  created_at: string
  updated_at: string
}

export interface Task {
  id: string
  project_id: string
  title: string
  description: string | null
  assigned_user_id: string | null
  status: 'backlog' | 'todo' | 'in_progress' | 'testing' | 'done'
  points: number
  position: number
  created_by: string
  created_at: string
  updated_at: string
}

export interface Notification {
  id: string
  title: string
  message: string
  sender_id: string
  read_at: string | null
  created_at: string
}

export interface Reward {
  id: string
  name: string
  description: string | null
  image_url: string | null
  required_points: number
  stock: number | null
  created_at: string
}

export interface RewardOrder {
  id: string
  reward_id: string
  user_id: string
  status: 'pending' | 'approved' | 'delivered'
  created_at: string
}

export interface Goal {
  id: string
  title: string
  description: string | null
  subtitle: string | null
  department_id: string | null
  is_global: boolean
  created_by: string
  owner_id: string | null
  start_date: string | null
  end_date: string | null
  reward_points: number
  color: string | null
  image_url: string | null
  order_index: number
  completed: boolean
  paused: boolean
  pause_reason: string | null
  paused_by: string | null
  paused_at: string | null
  created_at: string
  updated_at: string
}

export interface GoalStep {
  id: string
  goal_id: string
  title: string
  completed: boolean
  position: number
}

export interface GoalStepTask {
  id: string
  step_id: string
  title: string
  completed: boolean
  position: number
  assigned_user_id: string | null
  assigned_to_everyone: boolean
  created_at: string
}

export interface DailyTask {
  id: string
  title: string
  description: string | null
  assigned_user_id: string | null
  department_id: string | null
  created_by: string
  completed: boolean
  expires_at: string
  created_at: string
}

export interface Achievement {
  id: string
  department_id: string
  title: string
  description: string | null
  created_by: string
  created_at: string
}

export interface JobDescription {
  id: string
  department_id: string
  role_name: string
  responsibilities: string[]
  created_by: string
  created_at: string
}

export interface ImportantLink {
  id: string
  department_id: string
  title: string
  url: string
  description: string | null
  created_by: string
  created_at: string
}

// ─── Furn (الفرن) — AI-powered quotation builder ────────────────────────────

export type FurnStage = 'processing' | 'pricing' | 'quoted'
export type FurnStatus = 'pending' | 'in_progress' | 'completed' | 'rejected' | 'archived'

export interface FurnDepartment {
  id: string
  name_en: string
  name_ar: string
  is_default: boolean
  enabled: boolean
  created_at: string
}

export interface FurnAttachment {
  url: string
  name: string
}

export interface FurnProject {
  id: string
  project_number: number
  project_name: string
  company_name: string
  engineer_name: string | null
  engineer_phone: string | null
  commercial_register: string | null
  tax_number: string | null
  subject: string | null
  department_ids: string[]
  payment_terms: string | null
  delivery_terms: string | null
  offer_duration: string | null
  special_conditions: string | null
  payment_terms_en: string | null
  payment_terms_ar: string | null
  delivery_terms_en: string | null
  delivery_terms_ar: string | null
  offer_duration_en: string | null
  offer_duration_ar: string | null
  special_conditions_en: string | null
  special_conditions_ar: string | null
  stage: FurnStage
  status: FurnStatus
  boq_url: string | null
  boq_filename: string | null
  spec_files: FurnAttachment[]
  drawing_files: FurnAttachment[]
  other_files: FurnAttachment[]
  source_client_project_id: string | null
  ai_summary: string | null
  ai_detected_departments: string[]
  ai_error: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface FurnItem {
  id: string
  project_id: string
  position: number
  // Short item title. Rendered at the normal table font size.
  description: string
  // Long AI-generated description shown as a small sub-line under the title
  // in both the pricing table and the PDF. Was previously stored in `notes`.
  details: string | null
  quantity: number
  unit: string
  unit_price: number | null
  // User-editable note column — the AI never writes here. The team uses it
  // to flag anything on a specific line.
  notes: string | null
  ai_confidence: number | null
  created_at: string
  updated_at: string
}

export interface FurnQuotation {
  id: string
  project_id: string
  quotation_number: number
  language: 'ar' | 'en'
  vat_rate: number
  subtotal: number
  vat_amount: number
  total: number
  pdf_url: string | null
  generated_by: string | null
  generated_at: string
}

export interface FurnSettings {
  id: number
  header_image_url: string | null
  signature_image_url: string | null
  seal_image_url: string | null
  manager_name: string | null
  company_phone: string | null
  company_email: string | null
  commercial_register: string | null
  tax_number: string | null
  footer_address: string | null
  default_payment_terms: string | null
  default_delivery_terms: string | null
  default_offer_duration: string | null
  default_special_conditions: string | null
  next_quotation_number: number
  next_tannoor_number: number
  updated_at: string
  updated_by: string | null
}

// ─── AI settings (provider switch + models) ──────────────────────────────────

export type AiProviderId = 'openai' | 'gemini'

export interface AiSettings {
  id: number
  provider: AiProviderId
  // Encrypted key envelopes on the server. The settings API NEVER sends these to
  // the browser — the client only ever sees `has_openai_key` / `has_gemini_key`.
  openai_api_key: string | null
  openai_model: string
  openai_boq_model: string
  gemini_api_key: string | null
  gemini_model: string
  gemini_boq_model: string
  updated_at: string
  updated_by: string | null
}

// Browser-safe shape returned by GET /api/ai/settings — raw keys are masked.
export interface AiSettingsPublic {
  provider: AiProviderId
  has_openai_key: boolean
  openai_model: string
  openai_boq_model: string
  has_gemini_key: boolean
  gemini_model: string
  gemini_boq_model: string
  updated_at: string
}

// ─── Client Projects (CRM-style pipeline) ────────────────────────────────────

export type ClientProjectStatus =
  | 'new' | 'in_progress' | 'ready_to_send' | 'awaiting_reply'
  | 'updates_requested' | 'rejected' | 'completed'

export type ClientProjectStage =
  | 'plans_intake' | 'quantity_takeoff' | 'receive_quotes' | 'pricing'
  | 'submit_offer' | 'negotiation' | 'materials_approval' | 'shop_drawings'
  | 'manufacturing' | 'site_delivery' | 'installation_qc' | 'handover_close'

export type ClientProjectFileCategory = 'boq' | 'spec' | 'drawing' | 'other'

export interface ClientProjectFile {
  url: string
  name: string
  key?: string
  bytes?: number
  // Bucket the file belongs to in the UI. Older rows may be missing this —
  // readers should treat `undefined` as `'other'`.
  category?: ClientProjectFileCategory
}

export type ClientProjectCurrency = 'SAR' | 'USD'

// Minimal user shape used for the "responsible person" dropdown / table cell.
// Only the fields actually rendered are included to keep wire payloads small.
export interface ProfileLite {
  id: string
  full_name: string | null
  email: string | null
  avatar_url: string | null
}

export interface ClientProject {
  id: string
  project_number: number
  name_en: string | null
  name_ar: string | null
  company_en: string | null
  company_ar: string | null
  engineer_name_en: string | null
  engineer_name_ar: string | null
  engineer_phone: string | null
  end_date: string | null
  pricing_currency: ClientProjectCurrency
  status: ClientProjectStatus
  stage: ClientProjectStage
  keywords: string | null
  notes: string | null
  files: ClientProjectFile[]
  responsible_user_id: string | null
  // Joined from `profiles` when present. Lists and the detail page hydrate it
  // server-side; the row may omit it during creation/edit roundtrips.
  responsible_user?: ProfileLite | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// ─── Important Documents + Pre-qualifications ────────────────────────────────

export interface ImportantDocument {
  id: string
  name_en: string | null
  name_ar: string | null
  file_url: string
  file_name: string | null
  file_key: string | null
  expiry_date: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type PreQualStampMode = 'last' | 'all' | 'none'

export interface PreQualification {
  id: string
  company_en: string | null
  company_ar: string | null
  project_name_en: string | null
  project_name_ar: string | null
  document_ids: string[]
  stamp_mode: PreQualStampMode
  output_pdf_url: string | null
  output_pdf_key: string | null
  generated_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// ─── Tannoor (التنّور) — products + AI projects ─────────────────────────────

export type TannoorAvailability = 'high' | 'medium' | 'low' | 'out_of_stock'

export interface TannoorProduct {
  id: string
  name_en: string | null
  name_ar: string | null
  description_en: string | null
  description_ar: string | null
  department_id: string | null
  // Legacy column — pricing-method feature was removed; the DB column still
  // exists (FK to tannoor_pricing_methods) but the app no longer reads it.
  pricing_method_id: string | null
  // Each row is a variant (effectively a SKU). The combination of
  // department + colour + finish + thickness + size + unit + availability
  // identifies a single price point. The same base material name can
  // appear in many rows with different combinations.
  unit: string
  thickness_mm: number | null
  size_w_mm: number | null
  size_l_mm: number | null
  color_en: string | null
  color_ar: string | null
  finish: string | null
  availability: TannoorAvailability | null
  price_sar: number
  price_usd: number
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type TannoorStage = 'processing' | 'quoted'
export type TannoorStatus = FurnStatus | 'missing_products'

export interface TannoorProject {
  id: string
  project_number: number
  project_name_en: string | null
  project_name_ar: string | null
  company_en: string | null
  company_ar: string | null
  engineer_name_en: string | null
  engineer_name_ar: string | null
  engineer_phone: string | null
  commercial_register: string | null
  tax_number: string | null
  subject: string | null
  payment_terms: string | null
  delivery_terms: string | null
  offer_duration: string | null
  special_conditions: string | null
  stage: TannoorStage
  status: TannoorStatus
  boq_url: string | null
  boq_filename: string | null
  spec_files: { url: string; name: string }[]
  drawing_files: { url: string; name: string }[]
  ai_summary: string | null
  ai_detected_departments: string[]
  ai_missing_items: Array<{ description: string; reason: string | null }>
  ai_error: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface TannoorItem {
  id: string
  project_id: string
  position: number
  description: string
  quantity: number
  unit: string
  product_id: string | null
  unit_price: number | null
  currency: 'SAR' | 'USD'
  notes: string | null
  is_missing: boolean
  ai_confidence: number | null
  created_at: string
  updated_at: string
}

export interface TannoorQuotation {
  id: string
  project_id: string
  quotation_number: number
  language: 'ar' | 'en'
  currency: 'SAR' | 'USD'
  vat_rate: number
  subtotal: number
  vat_amount: number
  total: number
  pdf_url: string | null
  generated_by: string | null
  generated_at: string
}
