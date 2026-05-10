import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, buildUserPrompt } from './prompt'
import type { InterviewSession } from '../../../shared/types'

function session(overrides: Partial<InterviewSession> = {}): InterviewSession {
  return {
    id: 's1',
    name: 'Session',
    extraContext: 'Use concise backend examples.',
    language: 'en',
    simpleLanguage: false,
    autoGenerate: true,
    saveTranscript: true,
    aiProviderId: 'p1',
    aiModel: 'gpt-4o-mini',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

describe('prompt builders', () => {
  it('includes session context and concise-answer rules', () => {
    const prompt = buildSystemPrompt(session())

    expect(prompt).toContain('ready-to-read answer')
    expect(prompt).toContain('Use concise backend examples.')
  })

  it('limits user-provided context in the system prompt', () => {
    const prompt = buildSystemPrompt(session({ extraContext: 'x'.repeat(9000) }))

    expect(prompt).toContain('x'.repeat(8000))
    expect(prompt).not.toContain('x'.repeat(8001))
  })

  it('builds a fallback user prompt when transcript is empty', () => {
    expect(buildUserPrompt('', 'Answer from screenshot')).toContain('Nothing has been said yet.')
    expect(buildUserPrompt('Question?', 'Use bullets')).toContain('Extra instruction')
  })
})
