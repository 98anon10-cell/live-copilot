import { describe, expect, it } from 'vitest'
import {
  providerHasSecret,
  sanitizeChatStreamRequest,
  sanitizeSettings,
  sanitizeSessions
} from './validation'

describe('validation', () => {
  it('keeps redacted providers ready when a stored key exists', () => {
    const settings = sanitizeSettings({
      aiProviders: [
        {
          id: 'openai-main',
          label: 'OpenAI',
          kind: 'openai',
          baseUrl: '',
          apiKey: '',
          hasApiKey: true,
          model: 'gpt-4o-mini'
        }
      ],
      sttProviders: [
        {
          id: 'groq-stt',
          label: 'Groq Whisper',
          kind: 'groq-whisper',
          baseUrl: '',
          apiKey: '',
          hasApiKey: true,
          model: 'whisper-large-v3-turbo'
        }
      ],
      opacity: 2,
      windowSize: 'bad'
    })

    expect(settings.aiProviders).toHaveLength(1)
    expect(settings.sttProviders).toHaveLength(1)
    expect(settings.opacity).toBe(1)
    expect(settings.windowSize).toBe('compact')
    expect(providerHasSecret(settings.aiProviders[0])).toBe(true)
  })

  it('drops malformed sessions and trims unsafe nested data', () => {
    const sessions = sanitizeSessions([
      null,
      {
        id: 's1',
        name: 'Test',
        extraContext: 'ctx',
        language: 'en',
        simpleLanguage: false,
        autoGenerate: true,
        saveTranscript: true,
        aiProviderId: 'p1',
        aiModel: 'm1',
        createdAt: 1,
        updatedAt: 2,
        transcript: [
          { speaker: 'them', text: 'hello', ts: 3 },
          { speaker: 'bad', text: 'drop', ts: 4 }
        ],
        aiMessages: [{ text: 'answer', imageUrl: 'file:///bad', ts: 5 }]
      }
    ])

    expect(sessions).toHaveLength(1)
    expect(sessions[0].transcript).toEqual([{ speaker: 'them', text: 'hello', ts: 3 }])
    expect(sessions[0].aiMessages?.[0].imageUrl).toBeUndefined()
  })

  it('sanitizes chat stream requests', () => {
    const request = sanitizeChatStreamRequest({
      id: 'chat-1',
      providerId: 'p1',
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'rules' },
        { role: 'tool', content: 'drop' },
        { role: 'user', content: 'question' }
      ],
      images: ['data:image/png;base64,abc', 'file:///nope'],
      temperature: 99
    })

    expect(request?.messages).toHaveLength(2)
    expect(request?.images).toEqual(['data:image/png;base64,abc'])
    expect(request?.temperature).toBe(2)
  })
})
