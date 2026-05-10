import type { InterviewSession } from '../../../shared/types'

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

export function buildUserPrompt(transcript: string, userInstruction?: string): string {
  const t = transcript.trim()
  const base =
    t.length > 0
      ? `Live transcript of the other party:\n"""\n${t}\n"""`
      : "Nothing has been said yet."
  if (userInstruction && userInstruction.trim()) {
    return `${base}\n\nExtra instruction from the user: ${userInstruction.trim()}`
  }
  return base
}
