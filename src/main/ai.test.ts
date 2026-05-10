import { describe, expect, it } from 'vitest'
import {
  extractOpenAICompatibleText,
  formatOpenAICompatibleError,
  isLikelyOpenAICompatibleChatModel,
  isLikelyOpenAIChatCompletionModel,
  shouldSendOpenAICompatibleTemperature
} from './ai'

describe('ai provider request compatibility', () => {
  it('omits temperature for GPT-5 family chat models', () => {
    expect(shouldSendOpenAICompatibleTemperature('gpt-5')).toBe(false)
    expect(shouldSendOpenAICompatibleTemperature('gpt-5.5')).toBe(false)
    expect(shouldSendOpenAICompatibleTemperature('gpt-5-mini')).toBe(false)
  })

  it('keeps temperature for other OpenAI-compatible models', () => {
    expect(shouldSendOpenAICompatibleTemperature('gpt-4o')).toBe(true)
    expect(shouldSendOpenAICompatibleTemperature('llama-3.3-70b')).toBe(true)
  })

  it('filters obvious non-chat OpenAI models from model lists', () => {
    expect(isLikelyOpenAIChatCompletionModel('gpt-4o-mini')).toBe(true)
    expect(isLikelyOpenAIChatCompletionModel('gpt-3.5-turbo-instruct')).toBe(false)
    expect(isLikelyOpenAIChatCompletionModel('davinci-002')).toBe(false)
    expect(isLikelyOpenAIChatCompletionModel('text-embedding-3-large')).toBe(false)
    expect(isLikelyOpenAIChatCompletionModel('gpt-4o-transcribe')).toBe(false)
  })

  it('keeps provider chat models while filtering obvious audio and embedding models', () => {
    expect(isLikelyOpenAICompatibleChatModel('cerebras', 'qwen-3-235b-a22b-instruct-2507')).toBe(
      true
    )
    expect(isLikelyOpenAICompatibleChatModel('groq', 'llama-3.3-70b-versatile')).toBe(true)
    expect(isLikelyOpenAICompatibleChatModel('groq', 'whisper-large-v3-turbo')).toBe(false)
    expect(isLikelyOpenAICompatibleChatModel('ollama', 'nomic-embed-text')).toBe(false)
    expect(isLikelyOpenAICompatibleChatModel('custom', 'bge-reranker-v2')).toBe(false)
  })

  it('rewrites completions-only model errors with an actionable message', () => {
    const raw = JSON.stringify({
      error: {
        message:
          'This is not a chat model and thus not supported in the v1/chat/completions endpoint. Did you mean to use v1/completions?',
        type: 'invalid_request_error',
        param: 'model',
        code: null
      }
    })

    expect(formatOpenAICompatibleError(404, raw, 'gpt-3.5-turbo-instruct')).toBe(
      'Model "gpt-3.5-turbo-instruct" is not compatible with /chat/completions. Pick a chat model in the AI provider settings, or use a provider endpoint that supports chat completions.'
    )
  })

  it('rewrites common provider errors with actionable messages', () => {
    expect(
      formatOpenAICompatibleError(
        404,
        '{"error":{"message":"The model `gpt-x` does not exist or you do not have access to it."}}',
        'gpt-x'
      )
    ).toBe(
      'Model "gpt-x" is not available for this provider or API key. Pick another model, list models again, or check that the key has access.'
    )

    expect(
      formatOpenAICompatibleError(
        400,
        '{"error":{"message":"This model does not support image_url content."}}',
        'llama-3.3-70b'
      )
    ).toBe(
      'Model "llama-3.3-70b" does not support the screenshot/image payload. Pick a vision-capable model or send the question without a screenshot.'
    )
  })

  it('extracts text from streaming and non-streaming OpenAI-compatible payloads', () => {
    expect(
      extractOpenAICompatibleText({
        choices: [{ message: { content: 'full answer' } }]
      })
    ).toBe('full answer')
    expect(
      extractOpenAICompatibleText({
        choices: [{ delta: { content: 'partial answer' } }]
      })
    ).toBe('partial answer')
    expect(
      extractOpenAICompatibleText({
        choices: [{ message: { content: [{ type: 'text', text: 'array answer' }] } }]
      })
    ).toBe('array answer')
  })
})
