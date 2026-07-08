import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

const BUCKET = 'department-files'
const ALLOWED_TYPES = [
  'application/pdf',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
]
const ALLOWED_EXTS = ['pdf', 'zip', 'xlsx', 'csv']

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
    if (!profile || !['super_admin', 'project_manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    const departmentId = formData.get('department_id') as string

    if (!file || !departmentId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!ALLOWED_EXTS.includes(ext)) {
      return NextResponse.json({ error: 'File type not allowed' }, { status: 400 })
    }

    const admin = createAdminClient()
    await admin.storage.createBucket(BUCKET, { public: true }).catch(() => {})

    const filePath = `${departmentId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(filePath, file, { contentType: file.type, upsert: false })

    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

    const { data: { publicUrl } } = admin.storage.from(BUCKET).getPublicUrl(filePath)

    const { data, error: dbError } = await supabase
      .from('department_files')
      .insert({
        department_id: departmentId,
        name: file.name,
        file_path: filePath,
        file_size: file.size,
        file_type: ext,
        uploaded_by: user.id,
      })
      .select()
      .single()

    if (dbError) {
      await admin.storage.from(BUCKET).remove([filePath])
      return NextResponse.json({ error: dbError.message }, { status: 500 })
    }

    await admin.from('audit_logs').insert({
      user_id: user.id,
      user_name: profile.full_name ?? null,
      user_email: user.email ?? null,
      action_type: 'add',
      object_type: 'file',
      object_name: file.name,
      object_id: data.id,
    })

    return NextResponse.json({ ...data, public_url: publicUrl })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
    if (!profile || !['super_admin', 'project_manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id, file_path, name } = await request.json()
    if (!id || !file_path) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

    const admin = createAdminClient()
    await admin.storage.from(BUCKET).remove([file_path])
    await supabase.from('department_files').delete().eq('id', id)

    await admin.from('audit_logs').insert({
      user_id: user.id,
      user_name: profile.full_name ?? null,
      user_email: user.email ?? null,
      action_type: 'delete',
      object_type: 'file',
      object_name: name ?? null,
      object_id: id,
    })

    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
