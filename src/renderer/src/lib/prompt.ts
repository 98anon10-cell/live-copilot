import type { InterviewSession } from '../../../shared/types'

export interface BuildUserPromptOptions {
  userInstruction?: string
  conversationMemory?: string
}

export function buildSystemPrompt(session: InterviewSession | null): string {
  if (!session) {
    return 'You are an AI assistant helping the user during a live call. Reply briefly, clearly and directly.'
  }
  const parts: string[] = []
  parts.push(
    'You are a real-time assistant helping the user during a live call (interview, meeting, etc.).',
    "Your goal: give the user a ready-to-read answer in first person to whatever the other party is saying or asking.",
    'Rules:',
    '- Answer in the same language as the question.',
    '- Be concise (max 6–8 sentences) unless the question demands more depth.',
    '- Use bullets or numbered steps when it makes the answer clearer.',
    '- If the current transcript contains multiple questions or requests, answer all of them in order.',
    '- Use previous context only to understand the current request; do not repeat old answers unless needed.',
    '- For coding questions, give runnable code in the right language with short comments.',
    '- If something is missing, make a reasonable assumption and continue — never ask for clarification.',
    ''
  )
  if (session.simpleLanguage) {
    parts.push('Use simple, plain language. Short sentences. Avoid jargon.', '')
  }
  if (session.extraContext.trim()) {
    parts.push('Context provided by the user:', session.extraContext.slice(0, 8000))
  }
  return parts.join('\n')
}

export function buildUserPrompt(
  transcript: string,
  options: string | BuildUserPromptOptions = {}
): string {
  const opts = typeof options === 'string' ? { userInstruction: options } : options
  const t = transcript.trim()
  const parts: string[] = []

  if (opts.conversationMemory?.trim()) {
    parts.push(
      'Compact memory from earlier in this call. Use it only as background context:',
      `"""\n${opts.conversationMemory.trim()}\n"""`,
      ''
    )
  }

  parts.push(
    t.length > 0
      ? `Current live transcript to answer now:\n"""\n${t}\n"""`
      : "Nothing has been said yet."
  )

  parts.push(
    '',
    'Answer the current transcript now. If it contains several questions or requests, cover each one clearly and in order.'
  )

  if (opts.userInstruction?.trim()) {
    parts.push('', `Extra instruction from the user: ${opts.userInstruction.trim()}`)
  }
  return parts.join('\n')
}
