import type { TranscriptChunk } from '../../../shared/types'

const QUESTION_PREFIXES = [
  'what',
  'why',
  'how',
  'when',
  'where',
  'who',
  'which',
  'and what',
  'and why',
  'and how',
  'and when',
  'and where',
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
  'give me',
  'show me',
  'help me',
  'i want you to',
  'i would like you to',
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
  'y que',
  'y qué',
  'y por que',
  'y por qué',
  'y como',
  'y cómo',
  'puedes',
  'podrias',
  'podrías',
  'dime',
  'dame',
  'ayudame',
  'ayúdame',
  'haz',
  'resume',
  'analiza',
  'explica',
  'cuentame',
  'cuéntame'
]

export interface QuestionCandidate {
  text: string
  normalized: string
  maxChunkId: number
}

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

export function questionCandidatesFromTranscript<T extends TranscriptChunk & { id: number }>(
  chunks: T[]
): QuestionCandidate[] {
  const candidates: QuestionCandidate[] = []
  let parts: string[] = []
  let maxChunkId: number | null = null

  const flush = (): void => {
    const text = parts.join(' ').trim()
    if (text && maxChunkId !== null && looksLikeQuestion(text)) {
      candidates.push({
        text,
        normalized: normalizeQuestionText(text),
        maxChunkId
      })
    }
    parts = []
    maxChunkId = null
  }

  for (const chunk of chunks) {
    if (chunk.speaker !== 'them') {
      flush()
      continue
    }
    parts.push(chunk.text)
    maxChunkId = chunk.id
  }
  flush()

  return candidates
}
