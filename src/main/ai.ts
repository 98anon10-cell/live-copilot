import type { WebContents } from 'electron'
import type { AiProvider, ChatMessage, ChatStreamEvent, ChatStreamRequest } from '../shared/types'

interface DataUrl {
  mediaType: string
  base64: string
  url: string
}

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant'
  content:
    | string
    | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>
}

interface AnthropicChatMessage {
  role: 'user' | 'assistant'
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
      >
}

const PROVIDER_DEFAULT_BASE_URL: Record<AiProvider['kind'], string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  ollama: 'http://localhost:11434/v1',
  custom: ''
}
const DEFAULT_CHAT_TEMPERATURE = 0.4
const MODEL_LIST_TIMEOUT_MS = 10000
const NON_CHAT_MODEL_PATTERNS = [
  /^dall-e(?:$|[-_.])/,
  /^gpt-image(?:$|[-_.])/,
  /^tts(?:$|[-_.])/,
  /^whisper(?:$|[-_.])/,
  /(?:^|[-_.])audio(?:$|[-_.])/,
  /(?:^|[-_.])embed(?:$|[-_.])/,
  /(?:^|[-_.])embedding(?:$|[-_.])/,
  /(?:^|[-_.])embeddings(?:$|[-_.])/,
  /(?:^|[-_.])moderation(?:$|[-_.])/,
  /(?:^|[-_.])rerank(?:$|[-_.])/,
  /(?:^|[-_.])reranker(?:$|[-_.])/,
  /(?:^|[-_.])realtime(?:$|[-_.])/,
  /(?:^|[-_.])transcribe(?:$|[-_.])/
]
const OPENAI_COMPLETIONS_ONLY_MODEL_PATTERNS = [
  /^babbage-\d+/,
  /^davinci-\d+/,
  /^text-/,
  /^code-/,
  /(?:^|[-_.])instruct(?:$|[-_.])/
]

function emit(webContents: WebContents, event: ChatStreamEvent): void {
  if (!webContents.isDestroyed()) webContents.send('chat:event', event)
}

function parseDataUrl(dataUrl: string): DataUrl | null {
  const match = /^data:([\w/+.-]+);base64,(.+)$/.exec(dataUrl)
  if (!match) return null
  return { mediaType: match[1], base64: match[2], url: dataUrl }
}

function resolveBaseUrl(provider: AiProvider): string {
  const fromUser = provider.baseUrl.trim().replace(/\/+$/, '')
  if (fromUser.length > 0) return fromUser
  return PROVIDER_DEFAULT_BASE_URL[provider.kind] ?? ''
}

function resolveHttpBaseUrl(provider: AiProvider): string {
  const baseUrl = resolveBaseUrl(provider)
  if (!baseUrl) throw new Error('Missing base URL for provider')
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new Error('Invalid base URL for provider')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Provider base URL must use http or https')
  }
  return baseUrl.replace(/\/+$/, '')
}

function withImagesAttachedOpenAI(messages: ChatMessage[], images: string[]): OpenAIChatMessage[] {
  if (images.length === 0) return messages.map((m) => ({ role: m.role, content: m.content }))
  const lastUserIdx = messages.findLastIndex((m) => m.role === 'user')
  return messages.map((m, i) => {
    if (i !== lastUserIdx) return { role: m.role, content: m.content }
    return {
      role: m.role,
      content: [
        { type: 'text', text: m.content },
        ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } }))
      ]
    }
  })
}

function withImagesAttachedAnthropic(
  messages: ChatMessage[],
  images: string[]
): AnthropicChatMessage[] {
  if (images.length === 0) {
    return messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
  }
  const lastUserIdx = messages.findLastIndex((m) => m.role === 'user')
  const parsed = images.map(parseDataUrl).filter((p): p is DataUrl => p !== null)
  return messages.map((m, i) => {
    const role = m.role as 'user' | 'assistant'
    if (i !== lastUserIdx) return { role, content: m.content }
    return {
      role,
      content: [
        { type: 'text', text: m.content },
        ...parsed.map((p) => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: p.mediaType, data: p.base64 }
        }))
      ]
    }
  })
}

export function shouldSendOpenAICompatibleTemperature(model: string): boolean {
  return !/^gpt-5(?:$|[._-])/.test(model.trim().toLowerCase())
}

export function isLikelyOpenAICompatibleChatModel(
  providerKind: AiProvider['kind'],
  model: string
): boolean {
  const name = model.trim().toLowerCase()
  if (!name) return false
  if (providerKind === 'anthropic') return true
  if (providerKind === 'openai') return isLikelyOpenAIChatCompletionModel(name)
  return !NON_CHAT_MODEL_PATTERNS.some((pattern) => pattern.test(name))
}

export function isLikelyOpenAIChatCompletionModel(model: string): boolean {
  const name = model.trim().toLowerCase()
  return (
    Boolean(name) &&
    !NON_CHAT_MODEL_PATTERNS.some((pattern) => pattern.test(name)) &&
    !OPENAI_COMPLETIONS_ONLY_MODEL_PATTERNS.some((pattern) => pattern.test(name))
  )
}

function providerErrorMessage(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } }
    if (typeof parsed.error?.message === 'string' && parsed.error.message.trim()) {
      return parsed.error.message.trim()
    }
  } catch {
    // Some OpenAI-compatible providers return plain text errors.
  }
  return text.trim()
}

export function formatOpenAICompatibleError(status: number, text: string, model: string): string {
  const message = providerErrorMessage(text)
  if (/not a chat model|not supported.*chat|v1\/completions/i.test(message)) {
    return [
      `Model "${model}" is not compatible with /chat/completions.`,
      'Pick a chat model in the AI provider settings, or use a provider endpoint that supports chat completions.'
    ].join(' ')
  }
  if (
    /model.*does not exist|does not have access to it|model_not_found|unknown model|no such model/i.test(
      message
    )
  ) {
    return `Model "${model}" is not available for this provider or API key. Pick another model, list models again, or check that the key has access.`
  }
  if (/incorrect api key|invalid api key|authentication|unauthorized|api key/i.test(message)) {
    return 'The provider rejected the API key. Check the saved key in AI provider settings.'
  }
  if (/insufficient_quota|quota|billing|payment/i.test(message)) {
    return 'The provider rejected the request because quota or billing is not available for this API key.'
  }
  if (/rate limit|too many requests|requests per/i.test(message)) {
    return 'The provider rate limit was reached. Wait a moment or switch to another model/provider.'
  }
  if (/context length|maximum context|token.*exceed|too many tokens/i.test(message)) {
    return `Model "${model}" rejected the request because the conversation/context is too large. Clear some transcript history or use a model with a larger context window.`
  }
  if (/(image|image_url|vision|multimodal)/i.test(message) && /unsupported|not support|invalid/i.test(message)) {
    return `Model "${model}" does not support the screenshot/image payload. Pick a vision-capable model or send the question without a screenshot.`
  }
  if (
    status === 404 &&
    /not found|cannot post|route|endpoint|invalid url|no handler/i.test(message)
  ) {
    return [
      'The provider endpoint was not found for /chat/completions.',
      'Check the Base URL in AI provider settings; many OpenAI-compatible servers need the /v1 suffix.'
    ].join(' ')
  }
  return `Provider error ${status}: ${message || text || 'Unknown provider error'}`
}

function isUnsupportedTemperatureError(status: number, text: string): boolean {
  return (
    status === 400 &&
    /unsupported_value/.test(text) &&
    /"param"\s*:\s*"temperature"/.test(text)
  )
}

function isUnsupportedStreamingError(status: number, text: string): boolean {
  const message = providerErrorMessage(text)
  return (
    (status === 400 || status === 422) &&
    (/"param"\s*:\s*"stream"/.test(text) ||
      /stream(?:ing)?.*(unsupported|not supported|not available)/i.test(message) ||
      /(unsupported|not support|invalid).*(stream|streaming)/i.test(message))
  )
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''
      const record = part as Record<string, unknown>
      if (typeof record.text === 'string') return record.text
      if (typeof record.output_text === 'string') return record.output_text
      return ''
    })
    .join('')
}

export function extractOpenAICompatibleText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const record = payload as Record<string, unknown>
  if (typeof record.output_text === 'string') return record.output_text
  const choices = record.choices
  if (!Array.isArray(choices) || choices.length === 0) return ''
  const choice = choices[0]
  if (!choice || typeof choice !== 'object') return ''
  const choiceRecord = choice as Record<string, unknown>
  const message = choiceRecord.message
  if (message && typeof message === 'object') {
    const content = (message as Record<string, unknown>).content
    const text = textFromContent(content)
    if (text) return text
  }
  const delta = choiceRecord.delta
  if (delta && typeof delta === 'object') {
    const text = textFromContent((delta as Record<string, unknown>).content)
    if (text) return text
  }
  return textFromContent(choiceRecord.text)
}

function parseOpenAICompatibleJson(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function fetchOpenAICompatibleChat(
  baseUrl: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  signal: AbortSignal
): Promise<Response> {
  return fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal
  })
}

async function completeOpenAICompatibleWithoutStreaming(
  baseUrl: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  request: ChatStreamRequest,
  signal: AbortSignal,
  webContents: WebContents
): Promise<void> {
  let activeBody: Record<string, unknown> = { ...body, stream: false }
  let res = await fetchOpenAICompatibleChat(baseUrl, headers, activeBody, signal)
  if (!res.ok && 'temperature' in activeBody) {
    const text = await res.text().catch(() => '')
    if (isUnsupportedTemperatureError(res.status, text)) {
      activeBody = { ...activeBody }
      delete activeBody.temperature
      res = await fetchOpenAICompatibleChat(baseUrl, headers, activeBody, signal)
    } else {
      throw new Error(formatOpenAICompatibleError(res.status, text || res.statusText, request.model))
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(formatOpenAICompatibleError(res.status, text || res.statusText, request.model))
  }

  const raw = await res.text()
  const parsed = parseOpenAICompatibleJson(raw)
  const text = extractOpenAICompatibleText(parsed)
  if (text) emit(webContents, { id: request.id, type: 'delta', delta: text })
  emit(webContents, { id: request.id, type: 'done' })
}

function emitOpenAICompatibleSsePayload(
  payload: string,
  request: ChatStreamRequest,
  webContents: WebContents
): boolean {
  if (payload === '[DONE]') {
    emit(webContents, { id: request.id, type: 'done' })
    return true
  }
  const parsed = parseOpenAICompatibleJson(payload)
  const delta = extractOpenAICompatibleText(parsed)
  if (delta) emit(webContents, { id: request.id, type: 'delta', delta })
  return false
}

async function readOpenAICompatibleStream(
  res: Response,
  request: ChatStreamRequest,
  webContents: WebContents
): Promise<void> {
  if (!res.body) throw new Error('Provider returned an empty response body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let raw = ''
  let sawSse = false
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    if (!sawSse) raw += chunk
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      sawSse = true
      raw = ''
      const payload = trimmed.slice(5).trim()
      if (emitOpenAICompatibleSsePayload(payload, request, webContents)) return
    }
  }
  const finalChunk = decoder.decode()
  if (finalChunk) {
    if (!sawSse) raw += finalChunk
    buffer += finalChunk
  }
  const trailing = buffer.trim()
  if (trailing.startsWith('data:')) {
    const payload = trailing.slice(5).trim()
    if (emitOpenAICompatibleSsePayload(payload, request, webContents)) return
    sawSse = true
  }
  if (!sawSse) {
    const parsed = parseOpenAICompatibleJson(raw.trim())
    const text = extractOpenAICompatibleText(parsed)
    if (text) emit(webContents, { id: request.id, type: 'delta', delta: text })
  }
  emit(webContents, { id: request.id, type: 'done' })
}

async function streamOpenAICompatible(
  request: ChatStreamRequest,
  provider: AiProvider,
  signal: AbortSignal,
  webContents: WebContents
): Promise<void> {
  const baseUrl = resolveHttpBaseUrl(provider)

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (provider.apiKey.trim()) headers.Authorization = `Bearer ${provider.apiKey}`

  const body: Record<string, unknown> = {
    model: request.model,
    messages: withImagesAttachedOpenAI(request.messages, request.images ?? []),
    stream: true
  }
  if (shouldSendOpenAICompatibleTemperature(request.model)) {
    body.temperature = request.temperature ?? DEFAULT_CHAT_TEMPERATURE
  }
  if (provider.kind === 'ollama') body.keep_alive = '30m'

  let activeBody = body
  let res = await fetchOpenAICompatibleChat(baseUrl, headers, activeBody, signal)

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if ('temperature' in activeBody && isUnsupportedTemperatureError(res.status, text)) {
      activeBody = { ...activeBody }
      delete activeBody.temperature
      res = await fetchOpenAICompatibleChat(baseUrl, headers, activeBody, signal)
    } else if (isUnsupportedStreamingError(res.status, text)) {
      await completeOpenAICompatibleWithoutStreaming(
        baseUrl,
        headers,
        activeBody,
        request,
        signal,
        webContents
      )
      return
    } else {
      throw new Error(formatOpenAICompatibleError(res.status, text || res.statusText, request.model))
    }
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    if (isUnsupportedStreamingError(res.status, text)) {
      await completeOpenAICompatibleWithoutStreaming(
        baseUrl,
        headers,
        activeBody,
        request,
        signal,
        webContents
      )
      return
    }
    throw new Error(formatOpenAICompatibleError(res.status, text || res.statusText, request.model))
  }

  await readOpenAICompatibleStream(res, request, webContents)
}

async function streamAnthropic(
  request: ChatStreamRequest,
  provider: AiProvider,
  signal: AbortSignal,
  webContents: WebContents
): Promise<void> {
  const baseUrl = resolveHttpBaseUrl(provider)
  const system = request.messages.find((m) => m.role === 'system')?.content
  const turns = withImagesAttachedAnthropic(
    request.messages.filter((m) => m.role !== 'system'),
    request.images ?? []
  )

  const res = await fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: request.model,
      messages: turns,
      system,
      max_tokens: 2048,
      temperature: request.temperature ?? DEFAULT_CHAT_TEMPERATURE,
      stream: true
    }),
    signal
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`Anthropic error ${res.status}: ${text || res.statusText}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''
    for (const evt of events) {
      const dataLine = evt.split('\n').find((line) => line.startsWith('data:'))
      if (!dataLine) continue
      const payload = dataLine.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const json = JSON.parse(payload)
        if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
          const delta = json.delta.text
          if (typeof delta === 'string' && delta.length > 0) {
            emit(webContents, { id: request.id, type: 'delta', delta })
          }
        }
      } catch {
        // Ignore malformed provider events.
      }
    }
  }
  emit(webContents, { id: request.id, type: 'done' })
}

export async function runChatStream(
  request: ChatStreamRequest,
  provider: AiProvider,
  signal: AbortSignal,
  webContents: WebContents
): Promise<void> {
  try {
    if (provider.kind === 'anthropic') {
      await streamAnthropic(request, provider, signal, webContents)
    } else {
      await streamOpenAICompatible(request, provider, signal, webContents)
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return
    emit(webContents, {
      id: request.id,
      type: 'error',
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

export async function listModelNames(provider: AiProvider): Promise<string[]> {
  if (provider.kind === 'ollama') {
    const baseUrl = provider.baseUrl.trim() || 'http://localhost:11434'
    const root = baseUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '')
    const checkedRoot = resolveHttpBaseUrl({ ...provider, baseUrl: root })
    const res = await fetch(`${checkedRoot}/api/tags`, {
      signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS)
    })
    if (!res.ok) throw new Error(`Ollama responded ${res.status}`)
    const data = (await res.json()) as { models?: Array<{ name?: string }> }
    return (data.models ?? [])
      .map((model) => model.name ?? '')
      .filter((name) => isLikelyOpenAICompatibleChatModel(provider.kind, name))
  }

  const baseUrl = resolveHttpBaseUrl(provider)

  if (provider.kind === 'anthropic') {
    if (!provider.apiKey.trim()) throw new Error('missing API key')
    const res = await fetch(`${baseUrl}/models`, {
      headers: {
        'anthropic-version': '2023-06-01',
        'x-api-key': provider.apiKey
      },
      signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS)
    })
    if (!res.ok) throw new Error(`Anthropic responded ${res.status}`)
    const data = (await res.json()) as { data?: Array<{ id?: string }> }
    return (data.data ?? []).map((model) => model.id ?? '').filter(Boolean)
  }

  const headers: Record<string, string> = {}
  if (provider.apiKey.trim()) headers.Authorization = `Bearer ${provider.apiKey}`
  const res = await fetch(`${baseUrl}/models`, {
    headers,
    signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`provider responded ${res.status}`)
  const data = (await res.json()) as { data?: Array<{ id?: string }> }
  return (data.data ?? [])
    .map((model) => model.id ?? '')
    .filter((name) => isLikelyOpenAICompatibleChatModel(provider.kind, name))
}
