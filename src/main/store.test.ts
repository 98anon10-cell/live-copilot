import { describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '../shared/types'

vi.mock('electron', () => ({
  app: { getPath: () => '' },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8')
  }
}))

const { mergeStoredSecrets, redactSettings } = await import('./store')

function settings(
  aiProviders: AppSettings['aiProviders'],
  sttProviders: AppSettings['sttProviders'] = []
): AppSettings {
  return {
    aiProviders,
    sttProviders,
    defaultLanguage: 'en',
    alwaysOnTop: true,
    opacity: 1,
    privateMode: true,
    screenCaptureDisplayId: 'auto',
    windowSize: 'compact',
    windowPosition: null
  }
}

describe('store secret handling', () => {
  it('redacts provider keys before returning settings to the renderer', () => {
    const redacted = redactSettings(
      settings([
        {
          id: 'openai-main',
          label: 'OpenAI',
          kind: 'openai',
          baseUrl: '',
          apiKey: 'sk-secret',
          model: 'gpt-4o-mini'
        }
      ])
    )

    expect(redacted.aiProviders[0].apiKey).toBe('')
    expect(redacted.aiProviders[0].hasApiKey).toBe(true)
  })

  it('preserves stored keys only when provider endpoint stays the same', () => {
    const current = settings([
      {
        id: 'openai-main',
        label: 'OpenAI',
        kind: 'openai',
        baseUrl: '',
        apiKey: 'sk-secret',
        model: 'gpt-4o-mini'
      }
    ])

    expect(
      mergeStoredSecrets(
        settings([
          {
            id: 'openai-main',
            label: 'OpenAI',
            kind: 'openai',
            baseUrl: 'https://api.openai.com/v1/',
            apiKey: '',
            hasApiKey: true,
            model: 'gpt-4o'
          }
        ]),
        current
      ).aiProviders[0].apiKey
    ).toBe('sk-secret')

    expect(
      mergeStoredSecrets(
        settings([
          {
            id: 'openai-main',
            label: 'Proxy',
            kind: 'openai',
            baseUrl: 'https://proxy.example/v1',
            apiKey: '',
            hasApiKey: true,
            model: 'gpt-4o'
          }
        ]),
        current
      ).aiProviders[0].apiKey
    ).toBe('')
  })

  it('drops stored STT keys when the endpoint changes', () => {
    const current = settings(
      [],
      [
        {
          id: 'groq-stt',
          label: 'Groq Whisper',
          kind: 'groq-whisper',
          baseUrl: '',
          apiKey: 'gsk-secret',
          model: 'whisper-large-v3-turbo'
        }
      ]
    )

    expect(
      mergeStoredSecrets(
        settings(
          [],
          [
            {
              id: 'groq-stt',
              label: 'Groq Whisper',
              kind: 'groq-whisper',
              baseUrl: 'https://api.groq.com/openai/v1',
              apiKey: '',
              hasApiKey: true,
              model: 'whisper-large-v3-turbo'
            }
          ]
        ),
        current
      ).sttProviders[0].apiKey
    ).toBe('gsk-secret')

    expect(
      mergeStoredSecrets(
        settings(
          [],
          [
            {
              id: 'groq-stt',
              label: 'Proxy Whisper',
              kind: 'groq-whisper',
              baseUrl: 'https://proxy.example/openai/v1',
              apiKey: '',
              hasApiKey: true,
              model: 'whisper-large-v3-turbo'
            }
          ]
        ),
        current
      ).sttProviders[0].apiKey
    ).toBe('')
  })
})
