// Turn a raw AI-provider error into a short, ACTIONABLE Arabic hint for the team.
//
// The Furn/Tannoor pricing engines surface `ai_error` straight to the user, and a
// raw English SDK string ("You exceeded your current quota…") reads as a scary
// crash when it's really a one-click fix (top up, switch provider, fix the key).
// We prepend a plain-Arabic instruction and keep the original appended so a dev
// can still see exactly what the provider said.

export function friendlyAiError(raw: string): string {
  const m = (raw || '').toLowerCase()
  let hint = ''

  if (/insufficient_quota|exceeded your current quota|current quota|\bquota\b|billing/.test(m)) {
    hint = 'انتهى رصيد الذكاء الاصطناعي (OpenAI). أضف رصيد/بطاقة في platform.openai.com/settings/billing، أو بدّل المزوّد إلى Google Gemini من الإعدادات ← الذكاء الاصطناعي (Gemini أرخص وجاهز).'
  } else if (/rate limit|rate_limit|too many requests/.test(m)) {
    hint = 'تجاوزت حد الطلبات في الدقيقة مؤقتاً — انتظر دقيقة واضغط «إعادة المحاولة».'
  } else if (/does not exist|not found|model_not_found|do not have access to (the )?model|unsupported model/.test(m)) {
    hint = 'الموديل المختار غير متاح لحسابك — غيّره من الإعدادات ← الذكاء الاصطناعي.'
  } else if (/invalid.*api key|incorrect api key|invalid_api_key|\bunauthorized\b|\b401\b/.test(m)) {
    hint = 'مفتاح الذكاء الاصطناعي غير صحيح أو منتهي — حدّثه من الإعدادات ← الذكاء الاصطناعي.'
  } else if (/timeout|timed out|etimedout|fetch failed|network|econnreset/.test(m)) {
    hint = 'انقطع الاتصال بمزوّد الذكاء أثناء المعالجة — اضغط «إعادة المحاولة».'
  }

  return hint ? `${hint}\n\n(${raw})` : raw
}
