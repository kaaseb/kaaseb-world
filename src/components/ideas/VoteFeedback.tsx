'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useLanguage } from '@/contexts/LanguageContext'

interface Props {
  variant: 'like' | 'dislike' | null
  onClose: () => void
}

export function VoteFeedback({ variant, onClose }: Props) {
  const { t } = useLanguage()

  useEffect(() => {
    if (!variant) return
    const tm = setTimeout(onClose, variant === 'like' ? 1900 : 1900)
    return () => clearTimeout(tm)
  }, [variant, onClose])

  if (!variant) return null
  if (typeof document === 'undefined') return null

  const isLike = variant === 'like'

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm vote-fb-fade"
      onClick={onClose}
    >
      {/* Balloons (only for like) */}
      {isLike && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {Array.from({ length: 14 }).map((_, i) => (
            <span
              key={i}
              className="absolute text-3xl vote-fb-balloon"
              style={{
                left: `${(i * 7) + (i % 2 === 0 ? 4 : 8)}%`,
                animationDelay: `${(i % 6) * 0.15}s`,
                animationDuration: `${2.4 + (i % 4) * 0.3}s`,
              } as React.CSSProperties}
            >
              {['🎈', '🎉', '✨', '🎊', '💚'][i % 5]}
            </span>
          ))}
        </div>
      )}

      {/* Card */}
      <div
        className={`relative ${
          isLike
            ? 'bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-200'
            : 'bg-gradient-to-br from-amber-50 to-rose-50 border-rose-200'
        } border-2 rounded-3xl p-8 max-w-sm mx-4 text-center shadow-2xl vote-fb-pop`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`text-7xl mb-3 ${isLike ? 'vote-fb-bounce' : 'vote-fb-shake'}`}>
          {isLike ? '😊' : '😔'}
        </div>
        <h2 className={`text-xl font-bold mb-2 ${isLike ? 'text-emerald-800' : 'text-rose-800'}`}>
          {isLike ? t('idea_feedback_like_title') : t('idea_feedback_dislike_title')}
        </h2>
        <p className={`text-sm ${isLike ? 'text-emerald-700' : 'text-rose-700'}`}>
          {isLike ? t('idea_feedback_like_subtitle') : t('idea_feedback_dislike_subtitle')}
        </p>
      </div>

      <style jsx>{`
        @keyframes voteFbFade {
          from { opacity: 0 }
          to   { opacity: 1 }
        }
        @keyframes voteFbPop {
          0%   { transform: scale(0.6) translateY(10px); opacity: 0 }
          60%  { transform: scale(1.05) translateY(0);   opacity: 1 }
          100% { transform: scale(1)    translateY(0);   opacity: 1 }
        }
        @keyframes voteFbBounce {
          0%, 100% { transform: translateY(0)     rotate(0) }
          25%      { transform: translateY(-12px) rotate(-6deg) }
          75%      { transform: translateY(-6px)  rotate(6deg) }
        }
        @keyframes voteFbShake {
          0%, 100% { transform: translateX(0)    rotate(0) }
          20%      { transform: translateX(-6px) rotate(-4deg) }
          40%      { transform: translateX(6px)  rotate(4deg) }
          60%      { transform: translateX(-4px) rotate(-2deg) }
          80%      { transform: translateX(4px)  rotate(2deg) }
        }
        @keyframes voteFbBalloon {
          0%   { transform: translateY(110vh) scale(0.6); opacity: 0 }
          15%  { opacity: 1 }
          100% { transform: translateY(-20vh) scale(1.2); opacity: 0 }
        }
        .vote-fb-fade    { animation: voteFbFade 0.2s ease-out }
        .vote-fb-pop     { animation: voteFbPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) }
        .vote-fb-bounce  { animation: voteFbBounce 1.2s ease-in-out infinite }
        .vote-fb-shake   { animation: voteFbShake 0.7s ease-in-out 2 }
        .vote-fb-balloon { animation: voteFbBalloon linear forwards; bottom: 0 }
      `}</style>
    </div>,
    document.body
  )
}
