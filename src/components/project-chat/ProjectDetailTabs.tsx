'use client'

// Wraps the project detail page with two tabs: the details form and the project
// chat. When the chat feature is off, it renders the form alone (no tab bar).

import { useState } from 'react'
import { FileText, MessagesSquare } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import type { Profile } from '@/types'
import { ProjectChat } from './ProjectChat'

interface Props {
  projectId: string
  currentUser: Profile
  chatEnabled: boolean
  children: React.ReactNode
}

export function ProjectDetailTabs({ projectId, currentUser, chatEnabled, children }: Props) {
  const { lang, isRtl } = useLanguage()
  const ar = lang === 'ar'
  const [tab, setTab] = useState<'details' | 'chat'>('details')

  if (!chatEnabled) return <>{children}</>

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="max-w-4xl mx-auto px-4 md:px-6 pt-4">
        <div className="inline-flex rounded-xl border bg-gray-50 p-1 text-sm">
          <button
            onClick={() => setTab('details')}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg transition-colors ${tab === 'details' ? 'bg-white shadow-sm text-gray-900 font-medium' : 'text-gray-500'}`}
          >
            <FileText className="w-4 h-4" />{ar ? 'التفاصيل' : 'Details'}
          </button>
          <button
            onClick={() => setTab('chat')}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg transition-colors ${tab === 'chat' ? 'bg-white shadow-sm text-blue-700 font-medium' : 'text-gray-500'}`}
          >
            <MessagesSquare className="w-4 h-4" />{ar ? 'الدردشة' : 'Chat'}
          </button>
        </div>
      </div>

      {tab === 'details' ? (
        children
      ) : (
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-4">
          <div className="h-[72vh] rounded-2xl border bg-white overflow-hidden shadow-sm">
            <ProjectChat projectId={projectId} currentUser={currentUser} />
          </div>
        </div>
      )}
    </div>
  )
}
