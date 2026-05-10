import { describe, expect, it } from 'vitest'
import {
  latestThemTurn,
  looksLikeQuestion,
  normalizeQuestionText,
  questionCandidatesFromTranscript
} from './question'

describe('question helpers', () => {
  it('detects direct and implied questions in English and Spanish', () => {
    expect(looksLikeQuestion('How would you design this?')).toBe(true)
    expect(looksLikeQuestion('¿Cómo lo resolverías')).toBe(true)
    expect(looksLikeQuestion('and how would you scale it')).toBe(true)
    expect(looksLikeQuestion('tell me about your backend experience')).toBe(true)
    expect(looksLikeQuestion('that sounds good')).toBe(false)
  })

  it('normalizes leading punctuation and whitespace', () => {
    expect(normalizeQuestionText('  ¿Qué  harías? ')).toBe('qué harías?')
  })

  it('returns the latest contiguous turn from the other speaker', () => {
    const now = Date.now()
    expect(
      latestThemTurn([
        { speaker: 'them', text: 'first', ts: now },
        { speaker: 'me', text: 'answer', ts: now },
        { speaker: 'them', text: 'can you', ts: now },
        { speaker: 'them', text: 'explain caching', ts: now }
      ])
    ).toBe('can you explain caching')
  })

  it('extracts every question/request block from the other speaker', () => {
    const now = Date.now()
    expect(
      questionCandidatesFromTranscript([
        { id: 1, speaker: 'them', text: 'can you', ts: now },
        { id: 2, speaker: 'them', text: 'explain caching?', ts: now },
        { id: 3, speaker: 'me', text: 'sure', ts: now },
        { id: 4, speaker: 'them', text: 'what risks do you see?', ts: now }
      ])
    ).toEqual([
      {
        text: 'can you explain caching?',
        normalized: 'can you explain caching?',
        maxChunkId: 2
      },
      {
        text: 'what risks do you see?',
        normalized: 'what risks do you see?',
        maxChunkId: 4
      }
    ])
  })
})
