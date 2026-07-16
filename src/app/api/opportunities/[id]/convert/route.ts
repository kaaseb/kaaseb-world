// POST /api/opportunities/[id]/convert — "حوّلها لمشروع".
//
// Turns a scouted lead into a real client_project, which is where the rest of
// the platform already picks it up: /furn's ClientProjectImportCard imports a
// client project into a quotation (furn_projects.source_client_project_id), so
// this one button completes the chain لead → مشروع → عرض سعر without inventing
// any new plumbing.
//
// We insert through the SAME table the normal create flow uses, with the same
// audit call, so a converted project is indistinguishable from a hand-made one.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileOrFallback, getEffectivePermissions } from '@/lib/profile'
import { hasPermission } from '@/lib/permissions'
import { serverAudit } from '@/lib/audit-server'
import { getOpportunity, updateOpportunity } from '@/lib/opportunities/store'

export const runtime = 'nodejs'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = verifyOrigin(request)
  if (csrfError) return csrfError

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const profile = await getProfileOrFallback(supabase, user)
  const permissions = await getEffectivePermissions(supabase, profile)
  if (!hasPermission(profile, permissions, 'page.opportunities')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // Creating a project is the projects module's privilege, not the scout's.
  if (!hasPermission(profile, permissions, 'client_projects.create')) {
    return NextResponse.json({ error: 'ما عندك صلاحية إنشاء مشاريع' }, { status: 403 })
  }

  const { id } = await params
  const opp = await getOpportunity(id)
  if (!opp) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Carry the scouting work into the project so nothing the AI found is lost:
  // the sources and the suggested approach are exactly what the person opening
  // this project tomorrow will want to read.
  const phone = opp.contacts.find((c) => c.phone)?.phone || null
  const notes = [
    opp.summary && `الملخص: ${opp.summary}`,
    opp.relevance && `نطاق الرخام: ${opp.relevance}`,
    opp.targeting && `طريقة الاستهداف: ${opp.targeting}`,
    opp.city && `المدينة: ${opp.city}`,
    opp.sourceUrls.length > 0 && `المصادر:\n${opp.sourceUrls.join('\n')}`,
    opp.notes && `ملاحظات الفريق: ${opp.notes}`,
    `— محوّلة من الفرص (درجة ${opp.score}/100)`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const { data, error } = await supabase
    .from('client_projects')
    .insert({
      name_ar: opp.title,
      company_ar: opp.owner || null,
      engineer_phone: phone,
      keywords: opp.city || null,
      notes,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await serverAudit({
    user,
    supabase,
    action: 'add',
    objectType: 'client_project',
    objectName: data.name_ar || data.name_en,
    objectId: data.id,
  })

  // A converted lead has been acted on — move it out of the working list so the
  // team doesn't chase it twice.
  await updateOpportunity(id, { status: 'contacted' })

  return NextResponse.json({ project: data })
}
