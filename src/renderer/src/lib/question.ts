import type { TranscriptChunk } from '../../../shared/types'

const QUESTION_PREFIXES = [
  'what',
  'why',
  'how',
  'when',
  'where',
  'who',
  'which',
  'can you',
  'could you',
  'would you',
  'do you',
  'did you',
  'are you',
  'is there',
  'tell me about',
  'walk me through',
  'describe',
  'explain',
  'que',
  'qué',
  'por que',
  'por qué',
  'como',
  'cómo',
  'cuando',
  'cuándo',
  'donde',
  'dónde',
  'quien',
  'quién',
  'cual',
  'cuál',
  'puedes',
  'podrias',
  'podrías',
  'explica',
  'cuentame',
  'cuéntame'
]

export function normalizeQuestionText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/^[\s"'\-–—¿¡]+/, '')
    .replace(/\s+/g, ' ')
}

export function looksLikeQuestion(text: string): boolean {
  const normalized = normalizeQuestionText(text)
  if (!normalized) return false
  if (/[?¿]/.test(normalized)) return true
  return QUESTION_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix} `)
  )
}

export function latestThemTurn<T extends TranscriptChunk>(chunks: T[]): string | null {
  const last = chunks[chunks.length - 1]
  if (!last || last.speaker !== 'them') return null
  const parts: string[] = []
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i]
    if (chunk.speaker !== 'them') break
    parts.unshift(chunk.text)
  }
  return parts.join(' ').trim() || null
}
