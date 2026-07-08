'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from 'sonner'
import { FileSignature, Plus, Download, Trash2, Loader2, Building2 } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import type { PreQualification } from '@/types'

interface Props {
  initialItems: PreQualification[]
  canManage: boolean
}

function display(en: string | null, ar: string | null, isRtl: boolean): string {
  if (isRtl) return ar || en || '—'
  return en || ar || '—'
}

export function PreQualList({ initialItems, canManage }: Props) {
  const { t, isRtl } = useLanguage()
  const router = useRouter()
  const [items, setItems] = useState<PreQualification[]>(initialItems)
  const [deleting, setDeleting] = useState<string | null>(null)

  async function handleDelete(p: PreQualification) {
    if (!confirm(t('pq_delete_confirm'))) return
    setDeleting(p.id)
    const res = await fetch(`/api/pre-qualifications/${p.id}`, { method: 'DELETE' })
    setDeleting(null)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      toast.error(j.error || 'Failed')
      return
    }
    setItems(prev => prev.filter(x => x.id !== p.id))
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-md">
            <FileSignature className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">{t('pq_title')}</h1>
          </div>
        </div>
        {canManage && (
          <Button onClick={() => router.push('/pre-qualifications/new')} size="lg">
            <Plus className={`w-4 h-4 ${isRtl ? 'ml-2' : 'mr-2'}`} />
            {t('pq_new')}
          </Button>
        )}
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <FileSignature className="w-12 h-12 mx-auto mb-3 text-muted-foreground/40" />
              <p>{t('pq_empty')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <th className="px-3 py-3 text-start font-medium text-muted-foreground">{t('pq_col_company')}</th>
                    <th className="px-3 py-3 text-start font-medium text-muted-foreground">{t('pq_col_project')}</th>
                    <th className="px-3 py-3 text-start font-medium text-muted-foreground w-40">{t('pq_col_created')}</th>
                    <th className="px-3 py-3 text-start font-medium text-muted-foreground w-40">{t('cp_col_actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map(p => (
                    <tr key={p.id} className="hover:bg-muted/30 transition">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-muted-foreground" />
                          {display(p.company_en, p.company_ar, isRtl)}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-foreground/80">
                        {display(p.project_name_en, p.project_name_ar, isRtl)}
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {new Date(p.created_at).toLocaleDateString(isRtl ? 'ar-SA' : 'en-GB')}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1">
                          {p.output_pdf_url ? (
                            <a
                              href={p.output_pdf_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs font-medium border bg-background hover:bg-muted transition"
                            >
                              <Download className="w-3.5 h-3.5" />
                              {t('pq_download')}
                            </a>
                          ) : (
                            <Link
                              href={`/pre-qualifications/new`}
                              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs font-medium border hover:bg-muted transition"
                            >
                              {t('pq_generate')}
                            </Link>
                          )}
                          {canManage && (
                            <button
                              onClick={() => handleDelete(p)}
                              disabled={deleting === p.id}
                              className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-red-50 text-red-600 transition"
                            >
                              {deleting === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
