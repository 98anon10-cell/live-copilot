import type {
  AiProvider,
  AiProviderKind,
  AppSettings,
  ChatMessage,
  ChatStreamRequest,
  InterviewSession,
  SessionAiMessage,
  SessionDocument,
  SttStartRequest,
  SttProvider,
  SttProviderKind,
  TranscriptChunk,
  WindowSize
} from './types'

const AI_KINDS: readonly AiProviderKind[] = [
  'openai',
  'anthropic',
  'groq',
  'cerebras',
  'ollama',
  'custom'
]

const STT_KINDS: readonly SttProviderKind[] = [
  'speechmatics',
  'groq-whisper',
  'openai-compatible'
]

const WINDOW_SIZES: readonly WindowSize[] = ['pill', 'compact', 'expanded']

export const DEFAULT_SETTINGS: AppSettings = {
  aiProviders: [],
  sttProviders: [],
  defaultLanguage: 'en',
  alwaysOnTop: true,
  opacity: 1,
  privateMode: true,
  screenCaptureDisplayId: 'auto',
  windowSize: 'compact',
  windowPosition: null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown, max = 20000): string {
  if (typeof value !== 'string') return ''
  return value.slice(0, max)
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function isWindowSize(value: unknown): value is WindowSize {
  return typeof value === 'string' && WINDOW_SIZES.includes(value as WindowSize)
}

export function isAiProviderKind(value: unknown): value is AiProviderKind {
  return typeof value === 'string' && AI_KINDS.includes(value as AiProviderKind)
}

export function isSttProviderKind(value: unknown): value is SttProviderKind {
  return typeof value === 'string' && STT_KINDS.includes(value as SttProviderKind)
}

export function providerHasSecret(p: { apiKey?: string; hasApiKey?: boolean }): boolean {
  return Boolean(p.apiKey?.trim() || p.hasApiKey)
}

export function isAiProviderReady(
  p: Pick<AiProvider, 'kind' | 'baseUrl' | 'apiKey' | 'model' | 'hasApiKey'>
): boolean {
  if (p.kind === 'custom' && !p.baseUrl.trim()) return false
  if (p.kind !== 'ollama' && p.kind !== 'custom' && !providerHasSecret(p)) return false
  return Boolean(p.model.trim())
}

export function isSttProviderReady(
  p: Pick<SttProvider, 'kind' | 'apiKey' | 'model' | 'hasApiKey'>
): boolean {
  if ((p.kind === 'speechmatics' || p.kind === 'groq-whisper') && !providerHasSecret(p)) {
    return false
  }
  return Boolean(p.model.trim())
}

export function sanitizeAiProvider(value: unknown): AiProvider | null {
  if (!isRecord(value) || !isAiProviderKind(value.kind)) return null
  const id = asString(value.id, 120).trim()
  if (!id) return null
  const provider: AiProvider = {
    id,
    label: asString(value.label, 120).trim() || value.kind,
    kind: value.kind,
    baseUrl: asString(value.baseUrl, 500).trim(),
    apiKey: asString(value.apiKey, 4000),
    model: asString(value.model, 240).trim()
  }
  if (typeof value.hasApiKey === 'boolean') provider.hasApiKey = value.hasApiKey
  if (Array.isArray(value.models)) {
    provider.models = value.models
      .map((model) => asString(model, 240).trim())
      .filter(Boolean)
      .slice(0, 50)
  }
  return provider
}

export function sanitizeSttProvider(value: unknown): SttProvider | null {
  if (!isRecord(value) || !isSttProviderKind(value.kind)) return null
  const id = asString(value.id, 120).trim()
  if (!id) return null
  const provider: SttProvider = {
    id,
    label: asString(value.label, 120).trim() || value.kind,
    kind: value.kind,
    baseUrl: asString(value.baseUrl, 500).trim(),
    apiKey: asString(value.apiKey, 4000),
    model: asString(value.model, 240).trim()
  }
  if (typeof value.hasApiKey === 'boolean') provider.hasApiKey = value.hasApiKey
  return provider
}

function sanitizePosition(value: unknown): AppSettings['windowPosition'] {
  if (!isRecord(value)) return null
  if (typeof value.x !== 'number' || typeof value.y !== 'number') return null
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return null
  return { x: Math.round(value.x), y: Math.round(value.y) }
}

export function sanitizeSettings(value: unknown, fallback = DEFAULT_SETTINGS): AppSettings {
  const raw = isRecord(value) ? value : {}
  const aiProviders = Array.isArray(raw.aiProviders)
    ? raw.aiProviders
        .map(sanitizeAiProvider)
        .filter((p): p is AiProvider => p !== null)
        .filter(isAiProviderReady)
        .slice(0, 50)
    : fallback.aiProviders

  const sttProviders = Array.isArray(raw.sttProviders)
    ? raw.sttProviders
        .map(sanitizeSttProvider)
        .filter((p): p is SttProvider => p !== null)
        .filter(isSttProviderReady)
        .slice(0, 50)
    : fallback.sttProviders

  return {
    aiProviders,
    sttProviders,
    defaultLanguage: asString(raw.defaultLanguage, 24).trim() || fallback.defaultLanguage,
    alwaysOnTop: asBoolean(raw.alwaysOnTop, fallback.alwaysOnTop),
    opacity: clamp(asNumber(raw.opacity, fallback.opacity), 0.25, 1),
    privateMode: asBoolean(raw.privateMode, fallback.privateMode),
    screenCaptureDisplayId:
      asString(raw.screenCaptureDisplayId, 80).trim() || fallback.screenCaptureDisplayId,
    windowSize: isWindowSize(raw.windowSize) ? raw.windowSize : fallback.windowSize,
    windowPosition: sanitizePosition(raw.windowPosition)
  }
}

function sanitizeDocument(value: unknown): SessionDocument | null {
  if (!isRecord(value)) return null
  const kind = value.kind
  if (kind !== 'pdf' && kind !== 'docx' && kind !== 'txt' && kind !== 'md') return null
  const id = asString(value.id, 120).trim()
  const name = asString(value.name, 240).trim()
  if (!id || !name) return null
  return {
    id,
    name,
    kind,
    content: asString(value.content, 200000)
  }
}

function sanitizeTranscriptChunk(value: unknown): TranscriptChunk | null {
  if (!isRecord(value)) return null
  const speaker = value.speaker === 'me' ? 'me' : value.speaker === 'them' ? 'them' : null
  if (!speaker) return null
  return {
    speaker,
    text: asString(value.text, 10000).trim(),
    ts: asNumber(value.ts, Date.now())
  }
}

function sanitizeAiMessage(value: unknown): SessionAiMessage | null {
  if (!isRecord(value)) return null
  const text = asString(value.text, 50000).trim()
  if (!text) return null
  const message: SessionAiMessage = {
    text,
    ts: asNumber(value.ts, Date.now())
  }
  const imageUrl = asString(value.imageUrl, 5000000)
  if (imageUrl.startsWith('data:image/')) message.imageUrl = imageUrl
  return message
}

export function sanitizeInterviewSession(value: unknown): InterviewSession | null {
  if (!isRecord(value)) return null
  const id = asString(value.id, 120).trim()
  if (!id) return null
  const createdAt = asNumber(value.createdAt, Date.now())
  const updatedAt = asNumber(value.updatedAt, createdAt)
  const session: InterviewSession = {
    id,
    name: asString(value.name, 240).trim(),
    extraContext: asString(value.extraContext, 200000),
    language: asString(value.language, 24).trim() || 'en',
    simpleLanguage: asBoolean(value.simpleLanguage, false),
    autoGenerate: asBoolean(value.autoGenerate, true),
    saveTranscript: asBoolean(value.saveTranscript, true),
    aiProviderId: asString(value.aiProviderId, 120).trim(),
    aiModel: asString(value.aiModel, 240).trim(),
    createdAt,
    updatedAt
  }

  if (Array.isArray(value.transcript)) {
    session.transcript = value.transcript
      .map(sanitizeTranscriptChunk)
      .filter((chunk): chunk is TranscriptChunk => chunk !== null && chunk.text.length > 0)
      .slice(-5000)
  }
  if (Array.isArray(value.aiMessages)) {
    session.aiMessages = value.aiMessages
      .map(sanitizeAiMessage)
      .filter((message): message is SessionAiMessage => message !== null)
      .slice(-1000)
  }
  const durationSec = asNumber(value.durationSec, NaN)
  if (Number.isFinite(durationSec)) session.durationSec = Math.max(0, Math.round(durationSec))
  if (Array.isArray(value.documents)) {
    session.documents = value.documents
      .map(sanitizeDocument)
      .filter((doc): doc is SessionDocument => doc !== null)
      .slice(0, 20)
  }
  return session
}

export function sanitizeSessions(value: unknown): InterviewSession[] {
  if (!Array.isArray(value)) return []
  return value
    .map(sanitizeInterviewSession)
    .filter((session): session is InterviewSession => session !== null)
    .slice(0, 1000)
}

export function sanitizeChatStreamRequest(value: unknown): ChatStreamRequest | null {
  if (!isRecord(value)) return null
  const id = asString(value.id, 120).trim()
  const providerId = asString(value.providerId, 120).trim()
  const model = asString(value.model, 240).trim()
  if (!id || !providerId || !model || !Array.isArray(value.messages)) return null
  const messages: ChatMessage[] = value.messages
    .map((message) => {
      if (!isRecord(message)) return null
      const role = message.role
      if (role !== 'system' && role !== 'user' && role !== 'assistant') return null
      return { role, content: asString(message.content, 100000) }
    })
    .filter((message): message is ChatMessage => message !== null)
    .slice(-40)
  if (messages.length === 0) return null
  const request: ChatStreamRequest = {
    id,
    providerId,
    model,
    messages,
    temperature: clamp(asNumber(value.temperature, 0.4), 0, 2)
  }
  if (Array.isArray(value.images)) {
    request.images = value.images
      .map((image) => asString(image, 8000000))
      .filter((image) => /^data:image\/[\w.+-]+;base64,/.test(image))
      .slice(0, 3)
  }
  return request
}

export function sanitizeSttStartRequest(value: unknown): SttStartRequest | null {
  if (!isRecord(value)) return null
  const id = asString(value.id, 120).trim()
  const providerId = asString(value.providerId, 120).trim()
  const language = asString(value.language, 24).trim() || 'en'
  if (!id || !providerId) return null
  return { id, providerId, language }
}
