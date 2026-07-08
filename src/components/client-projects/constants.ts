// Shared status/stage option lists, kept in one place so the list view, the
// detail form, and the API layer all agree on what's valid.

import type { ClientProjectStatus, ClientProjectStage } from '@/types'

export const STATUS_OPTIONS: Array<{ value: ClientProjectStatus; key: string }> = [
  { value: 'new',                key: 'cp_status_new' },
  { value: 'in_progress',        key: 'cp_status_in_progress' },
  { value: 'ready_to_send',      key: 'cp_status_ready_to_send' },
  { value: 'awaiting_reply',     key: 'cp_status_awaiting_reply' },
  { value: 'updates_requested',  key: 'cp_status_updates_requested' },
  { value: 'rejected',           key: 'cp_status_rejected' },
  { value: 'completed',          key: 'cp_status_completed' },
]

export const STAGE_OPTIONS: Array<{ value: ClientProjectStage; key: string }> = [
  { value: 'plans_intake',       key: 'cp_stage_plans_intake' },
  { value: 'quantity_takeoff',   key: 'cp_stage_quantity_takeoff' },
  { value: 'receive_quotes',     key: 'cp_stage_receive_quotes' },
  { value: 'pricing',            key: 'cp_stage_pricing' },
  { value: 'submit_offer',       key: 'cp_stage_submit_offer' },
  { value: 'negotiation',        key: 'cp_stage_negotiation' },
  { value: 'materials_approval', key: 'cp_stage_materials_approval' },
  { value: 'shop_drawings',      key: 'cp_stage_shop_drawings' },
  { value: 'manufacturing',      key: 'cp_stage_manufacturing' },
  { value: 'site_delivery',      key: 'cp_stage_site_delivery' },
  { value: 'installation_qc',    key: 'cp_stage_installation_qc' },
  { value: 'handover_close',     key: 'cp_stage_handover_close' },
]

export const STATUS_COLORS: Record<ClientProjectStatus, string> = {
  new:                'bg-blue-50 text-blue-700 border-blue-200',
  in_progress:        'bg-amber-50 text-amber-700 border-amber-200',
  ready_to_send:      'bg-indigo-50 text-indigo-700 border-indigo-200',
  awaiting_reply:     'bg-purple-50 text-purple-700 border-purple-200',
  updates_requested:  'bg-orange-50 text-orange-700 border-orange-200',
  rejected:           'bg-red-50 text-red-700 border-red-200',
  completed:          'bg-emerald-50 text-emerald-700 border-emerald-200',
}
