export interface SessionDocument {
  id: string
  name: string
  kind: 'pdf' | 'docx' | 'txt' | 'md'
  content: string
}

export interface SessionResume {
  id: string
  name: string
  content: string
}

export type SessionType = 'interview' | 'regular'

/** Which audio sources are being captured during a live session. */
export type AudioMode = 'system' | 'mic' | 'both' | 'none'

export interface TranscriptChunk {
  speaker: 'them' | 'me'
  text: string
  ts: number
}

export interface SessionAiMessage {
  text: string
  imageUrl?: string
  ts: number
}

export interface InterviewSession {
  id: string
  /** Short internal name for the session (list header, filenames). Auto-derived. */
  name: string
  /** Free-form context / instructions for the AI — the only user-provided context now. */
  extraContext: string
  /** ISO language code for transcription + AI responses (e.g. "en", "es"). */
  language: string
  /** When true, AI replies in simpler language. */
  simpleLanguage: boolean
  /** When true, AI auto-generates a response when it detects a question. */
  autoGenerate: boolean
  /** When true, the live transcript is persisted to this session on close. */
  saveTranscript: boolean
  /** ID of the AI provider selected from settings.aiProviders. */
  aiProviderId: string
  /** Specific model name the user picked for that provider. */
  aiModel: string
  /** Persisted transcript from the last live run (when saveTranscript is true). */
  transcript?: TranscriptChunk[]
  /** Persisted AI replies from the last live run. */
  aiMessages?: SessionAiMessage[]
  /** Total seconds the live session was active. */
  durationSec?: number
  createdAt: number
  updatedAt: number
  // --- Legacy fields, kept optional for backward compatibility with old saved sessions.
  sessionType?: SessionType
  callTitle?: string
  callDescription?: string
  company?: string
  jobDescription?: string
  jobPostUrl?: string
  resume?: SessionResume | null
  documents?: SessionDocument[]
}

/** Supported AI provider kinds. "custom" is any OpenAI-compatible endpoint. */
export type AiProviderKind =
  | 'openai'
  | 'anthropic'
  | 'groq'
  | 'cerebras'
  | 'ollama'
  | 'custom'

export interface AiProvider {
  id: string
  /** Display name shown in the UI — the user picks anything (e.g. "Qwen14-v1", "OpenAI prod"). */
  label: string
  kind: AiProviderKind
  /** Base URL. For "openai"/"groq"/etc. you can leave empty to use the default. */
  baseUrl: string
  /** API key. In the renderer this is blank unless the user is entering a replacement. */
  apiKey: string
  /** Renderer-safe flag that says an encrypted key exists in main storage. */
  hasApiKey?: boolean
  /** The single model this profile uses. Each profile = one model. */
  model: string
  /** Legacy: pre-perfil providers used a list. Kept for backward-compat in migration. */
  models?: string[]
}

export type SttProviderKind = 'speechmatics' | 'groq-whisper' | 'openai-compatible'

export interface SttProvider {
  id: string
  label: string
  kind: SttProviderKind
  baseUrl: string
  apiKey: string
  hasApiKey?: boolean
  /** Model / endpoint name (e.g. "enhanced", "whisper-1"). */
  model: string
}

export type WindowSize = 'pill' | 'compact' | 'expanded'

export interface CaptureDisplay {
  id: string
  label: string
  isPrimary: boolean
  isCurrent: boolean
}

export interface AppSettings {
  /** Configured AI providers (BYOK). */
  aiProviders: AiProvider[]
  /** Configured STT providers (BYOK). */
  sttProviders: SttProvider[]
  /** Default language for new sessions. */
  defaultLanguage: string
  /** Keep the overlay window on top of everything. */
  alwaysOnTop: boolean
  /** Window opacity 0..1 (controls the overlay translucency). */
  opacity: number
  /** Hide window content from screen-sharing / recording tools when true. */
  privateMode: boolean
  /** Display id used for screenshot answers. "auto" avoids the overlay display when possible. */
  screenCaptureDisplayId: string
  /** Current window size preset (pill = minimised). */
  windowSize: WindowSize
  /** Last known window position (persisted across launches). */
  windowPosition: { x: number; y: number } | null
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamChunk {
  id: string
  delta: string
  done: boolean
}

export interface ChatStreamRequest {
  id: string
  providerId: string
  model: string
  messages: ChatMessage[]
  images?: string[]
  temperature?: number
}

export type ChatStreamEvent =
  | { id: string; type: 'delta'; delta: string }
  | { id: string; type: 'done' }
  | { id: string; type: 'error'; error: string }

export interface SttStartRequest {
  id: string
  providerId: string
  language: string
}

export type SttEvent =
  | { id: string; type: 'open' }
  | { id: string; type: 'partial'; text: string }
  | { id: string; type: 'final'; text: string }
  | { id: string; type: 'error'; error: string }
  | { id: string; type: 'close' }
