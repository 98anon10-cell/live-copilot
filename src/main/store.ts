import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { AiProviderKind, AppSettings, InterviewSession, SttProviderKind } from '../shared/types'
import { DEFAULT_SETTINGS, isAiProviderReady, isSttProviderReady } from '../shared/validation'

const defaultSettings: AppSettings = DEFAULT_SETTINGS

const SECRET_PREFIX = 'enc:v1:'
const writeQueues = new Map<string, Promise<void>>()
const AI_DEFAULT_BASE_URL: Record<AiProviderKind, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  ollama: 'http://localhost:11434/v1',
  custom: ''
}
const STT_DEFAULT_BASE_URL: Record<SttProviderKind, string> = {
  speechmatics: 'wss://eu2.rt.speechmatics.com/v2',
  'groq-whisper': 'https://api.groq.com/openai/v1',
  'openai-compatible': 'http://localhost:8080/v1'
}

function dataDir(): string {
  return app.getPath('userData')
}

function sessionsFile(): string {
  return join(dataDir(), 'sessions.json')
}

function settingsFile(): string {
  return join(dataDir(), 'settings.json')
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err
}

function timestampForPath(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function copyBackupIfPresent(path: string, suffix: string): Promise<void> {
  try {
    await fs.copyFile(path, `${path}.${suffix}`)
  } catch (err) {
    if (!isErrnoException(err) || err.code !== 'ENOENT') {
      console.warn(`Could not create ${basename(path)} backup:`, err)
    }
  }
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(path, 'utf8')
    return JSON.parse(raw) as T
  } catch (err) {
    if (isErrnoException(err) && err.code === 'ENOENT') return fallback
    if (err instanceof SyntaxError) {
      await copyBackupIfPresent(path, `corrupt-${timestampForPath()}.bak`)
    }
    console.warn(`Could not read ${basename(path)}; using defaults.`, err)
    return fallback
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const dir = dirname(path)
  const tmpPath = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf8')
  await copyBackupIfPresent(path, 'bak')
  try {
    await fs.rename(tmpPath, path)
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {})
    throw err
  }
}

async function writeJsonQueued(path: string, value: unknown): Promise<void> {
  const previous = writeQueues.get(path) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(() => writeJson(path, value))
  writeQueues.set(path, next)
  try {
    await next
  } finally {
    if (writeQueues.get(path) === next) writeQueues.delete(path)
  }
}

function encryptSecret(value: string): string {
  if (!value) return ''
  if (!safeStorage.isEncryptionAvailable()) return value
  return `${SECRET_PREFIX}${safeStorage.encryptString(value).toString('base64')}`
}

function decryptSecret(value: string): string {
  if (!value.startsWith(SECRET_PREFIX)) return value
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('Encrypted API key could not be decrypted: safeStorage is unavailable.')
    return ''
  }
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(SECRET_PREFIX.length), 'base64'))
  } catch (err) {
    console.warn('Encrypted API key could not be decrypted:', err)
    return ''
  }
}

function decryptSettingsRecord(loaded: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...loaded }
  if (typeof copy.groqApiKey === 'string') copy.groqApiKey = decryptSecret(copy.groqApiKey)
  if (typeof copy.speechmaticsApiKey === 'string') {
    copy.speechmaticsApiKey = decryptSecret(copy.speechmaticsApiKey)
  }
  if (Array.isArray(copy.aiProviders)) {
    copy.aiProviders = copy.aiProviders.map((p) =>
      p && typeof p === 'object' && typeof (p as { apiKey?: unknown }).apiKey === 'string'
        ? { ...(p as Record<string, unknown>), apiKey: decryptSecret((p as { apiKey: string }).apiKey) }
        : p
    )
  }
  if (Array.isArray(copy.sttProviders)) {
    copy.sttProviders = copy.sttProviders.map((p) =>
      p && typeof p === 'object' && typeof (p as { apiKey?: unknown }).apiKey === 'string'
        ? { ...(p as Record<string, unknown>), apiKey: decryptSecret((p as { apiKey: string }).apiKey) }
        : p
    )
  }
  return copy
}

function encryptSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    aiProviders: settings.aiProviders.map((p) => {
      const { hasApiKey: _hasApiKey, ...provider } = p
      return {
        ...provider,
        apiKey: encryptSecret(provider.apiKey)
      }
    }),
    sttProviders: settings.sttProviders.map((p) => {
      const { hasApiKey: _hasApiKey, ...provider } = p
      return {
        ...provider,
        apiKey: encryptSecret(provider.apiKey)
      }
    })
  }
}

function migrateSettings(loaded: Record<string, unknown>): AppSettings {
  // Legacy v1 shape had groqApiKey / speechmaticsApiKey at the top level.
  // Migrate them into the new providers arrays on first load.
  const migrated: AppSettings = {
    ...defaultSettings,
    ...(loaded as Partial<AppSettings>)
  }
  if (!Array.isArray(migrated.aiProviders)) migrated.aiProviders = []
  if (!Array.isArray(migrated.sttProviders)) migrated.sttProviders = []
  const legacyGroqKey = typeof loaded.groqApiKey === 'string' ? (loaded.groqApiKey as string) : ''
  const legacyGroqModel =
    typeof loaded.groqModel === 'string' ? (loaded.groqModel as string) : ''
  if (legacyGroqKey && migrated.aiProviders.length === 0) {
    migrated.aiProviders.push({
      id: 'groq-legacy',
      label: 'Groq',
      kind: 'groq',
      baseUrl: '',
      apiKey: legacyGroqKey,
      model: legacyGroqModel,
      models: legacyGroqModel ? [legacyGroqModel] : []
    })
  }
  const legacySpeechmatics =
    typeof loaded.speechmaticsApiKey === 'string' ? (loaded.speechmaticsApiKey as string) : ''
  if (legacySpeechmatics && migrated.sttProviders.length === 0) {
    migrated.sttProviders.push({
      id: 'speechmatics-legacy',
      label: 'Speechmatics',
      kind: 'speechmatics',
      baseUrl: '',
      apiKey: legacySpeechmatics,
      model: 'enhanced'
    })
  }
  const legacyLang =
    typeof loaded.transcriptionLanguage === 'string' ? (loaded.transcriptionLanguage as string) : ''
  if (legacyLang) migrated.defaultLanguage = legacyLang
  if (migrated.windowSize !== 'pill' && migrated.windowSize !== 'compact' && migrated.windowSize !== 'expanded') {
    migrated.windowSize = 'compact'
  }
  if (
    migrated.windowPosition &&
    (typeof migrated.windowPosition.x !== 'number' || typeof migrated.windowPosition.y !== 'number')
  ) {
    migrated.windowPosition = null
  }
  if (typeof migrated.screenCaptureDisplayId !== 'string' || !migrated.screenCaptureDisplayId.trim()) {
    migrated.screenCaptureDisplayId = 'auto'
  }
  // Rename leftover generic labels like "New provider" so they don't all look the same.
  const aiBase: Record<string, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    groq: 'Groq',
    cerebras: 'Cerebras',
    ollama: 'Ollama (local)',
    custom: 'Custom endpoint'
  }
  // Step 1: split legacy providers with N models into N profiles, one per model.
  const splitProviders: typeof migrated.aiProviders = []
  for (const p of migrated.aiProviders) {
    const legacyModels = Array.isArray(p.models) ? p.models.filter((m) => m && m.trim()) : []
    const singleModel = (p as { model?: string }).model
    if (!singleModel && legacyModels.length === 0) {
      // Empty draft, keep as-is with empty model.
      splitProviders.push({ ...p, model: '', models: undefined })
      continue
    }
    if (singleModel && legacyModels.length === 0) {
      splitProviders.push({ ...p, model: singleModel, models: undefined })
      continue
    }
    // legacyModels has at least one entry — first becomes the main, the rest are clones.
    const [first, ...rest] = legacyModels
    splitProviders.push({ ...p, model: first, models: undefined })
    for (const m of rest) {
      splitProviders.push({
        ...p,
        id: `${p.id}-${m.replace(/[^\w\d]+/g, '_')}`,
        label: `${p.label || aiBase[p.kind] || 'Provider'} (${m})`,
        model: m,
        models: undefined
      })
    }
  }
  migrated.aiProviders = splitProviders

  // Step 2: rename empty / "New provider" labels and dedupe.
  const seen = new Set<string>()
  migrated.aiProviders = migrated.aiProviders.map((p) => {
    let label = p.label
    if (!label || /^new provider/i.test(label)) {
      label = aiBase[p.kind] ?? 'Provider'
    }
    let unique = label
    let n = 2
    while (seen.has(unique)) {
      unique = `${label} ${n}`
      n++
    }
    seen.add(unique)
    return { ...p, label: unique }
  })
  const sttBase: Record<string, string> = {
    speechmatics: 'Speechmatics',
    'groq-whisper': 'Groq Whisper',
    'openai-compatible': 'Local Whisper'
  }
  // Heuristics to detect (kind, model) mismatches that came from older code paths
  // — fix the kind based on the model the user clearly intended.
  migrated.sttProviders = migrated.sttProviders.map((p) => {
    const m = (p.model ?? '').toLowerCase().trim()
    if (m.startsWith('whisper-large-v3') && p.kind !== 'groq-whisper') {
      return { ...p, kind: 'groq-whisper' }
    }
    if ((m === 'enhanced' || m === 'standard') && p.kind !== 'speechmatics') {
      return { ...p, kind: 'speechmatics' }
    }
    return p
  })
  const seenStt = new Set<string>()
  migrated.sttProviders = migrated.sttProviders.map((p) => {
    let label = p.label
    // Rename if empty, generic ("New STT"), or doesn't match any base for the current kind
    // (the label clearly drifted from the kind — make it consistent).
    const baseForKind = sttBase[p.kind] ?? 'STT'
    if (!label || /^new stt/i.test(label) || !labelMatchesKind(label, p.kind, sttBase)) {
      label = baseForKind
    }
    let unique = label
    let n = 2
    while (seenStt.has(unique)) {
      unique = `${label} ${n}`
      n++
    }
    seenStt.add(unique)
    return { ...p, label: unique }
  })
  // Final invariant: only fully-configured profiles persist on disk. Anything that is not
  // ready is dropped silently — the user has to recreate it intentionally.
  migrated.aiProviders = migrated.aiProviders.filter(isAiProviderReady)
  migrated.sttProviders = migrated.sttProviders.filter(isSttProviderReady)
  return migrated
}

/**
 * True if the label looks like it belongs to the given kind (i.e. starts with that kind's
 * base label, optionally followed by " <number>").
 */
function labelMatchesKind(
  label: string,
  kind: string,
  baseByKind: Record<string, string>
): boolean {
  const expected = baseByKind[kind]
  if (!expected) return true
  // Strict match or "<base> N"
  return label === expected || new RegExp(`^${escapeRegExp(expected)} \\d+$`).test(label)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function loadSettings(): Promise<AppSettings> {
  const loaded = await readJson<Record<string, unknown>>(settingsFile(), {})
  return migrateSettings(decryptSettingsRecord(loaded))
}

export function redactSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    aiProviders: settings.aiProviders.map((p) => ({
      ...p,
      apiKey: '',
      hasApiKey: Boolean(p.apiKey.trim())
    })),
    sttProviders: settings.sttProviders.map((p) => ({
      ...p,
      apiKey: '',
      hasApiKey: Boolean(p.apiKey.trim())
    }))
  }
}

export function mergeStoredSecrets(next: AppSettings, current: AppSettings | null): AppSettings {
  if (!current) return next
  const currentAi = new Map(current.aiProviders.map((p) => [p.id, p]))
  const currentStt = new Map(current.sttProviders.map((p) => [p.id, p]))
  return {
    ...next,
    aiProviders: next.aiProviders.map((p) => {
      if (p.apiKey.trim()) return p
      const stored = currentAi.get(p.id)
      const sameEndpoint =
        stored &&
        stored.kind === p.kind &&
        normalizeBaseUrl(p.baseUrl, AI_DEFAULT_BASE_URL[p.kind]) ===
          normalizeBaseUrl(stored.baseUrl, AI_DEFAULT_BASE_URL[stored.kind])
      return { ...p, apiKey: sameEndpoint ? stored.apiKey : '' }
    }),
    sttProviders: next.sttProviders.map((p) => {
      if (p.apiKey.trim()) return p
      const stored = currentStt.get(p.id)
      const sameEndpoint =
        stored &&
        stored.kind === p.kind &&
        normalizeBaseUrl(p.baseUrl, STT_DEFAULT_BASE_URL[p.kind]) ===
          normalizeBaseUrl(stored.baseUrl, STT_DEFAULT_BASE_URL[stored.kind])
      return { ...p, apiKey: sameEndpoint ? stored.apiKey : '' }
    })
  }
}

function normalizeBaseUrl(baseUrl: string, defaultBaseUrl: string): string {
  return (baseUrl.trim() || defaultBaseUrl).replace(/\/+$/, '').toLowerCase()
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await writeJsonQueued(settingsFile(), encryptSettings(settings))
}

export async function loadSessions(): Promise<InterviewSession[]> {
  const loaded = await readJson<InterviewSession[]>(sessionsFile(), [])
  return loaded.map((s) => migrateSession(s))
}

export async function saveSessions(sessions: InterviewSession[]): Promise<void> {
  await writeJsonQueued(sessionsFile(), sessions)
}

function migrateSession(s: InterviewSession): InterviewSession {
  // Carry over legacy interview-style metadata as extra context so the AI still gets it.
  const legacyParts: string[] = []
  if (s.company) legacyParts.push(`Company: ${s.company}`)
  if (s.jobDescription) legacyParts.push(`Job description:\n${s.jobDescription}`)
  if (s.callTitle) legacyParts.push(`Call title: ${s.callTitle}`)
  if (s.callDescription) legacyParts.push(`Call description: ${s.callDescription}`)
  if (s.resume?.content) {
    legacyParts.push(`Resume (${s.resume.name}):\n${s.resume.content.slice(0, 8000)}`)
  }
  if (Array.isArray(s.documents)) {
    for (const doc of s.documents) {
      if (doc?.content) {
        legacyParts.push(`Document (${doc.name}):\n${doc.content.slice(0, 8000)}`)
      }
    }
  }
  const baseContext = s.extraContext ?? ''
  const mergedContext =
    legacyParts.length > 0
      ? `${baseContext}${baseContext ? '\n\n' : ''}${legacyParts.join('\n\n')}`.trim()
      : baseContext

  return {
    id: s.id,
    name: s.name ?? '',
    extraContext: mergedContext,
    language: s.language ?? 'en',
    simpleLanguage: s.simpleLanguage ?? false,
    autoGenerate: s.autoGenerate ?? true,
    saveTranscript: s.saveTranscript ?? true,
    aiProviderId: s.aiProviderId ?? '',
    aiModel: s.aiModel ?? '',
    transcript: Array.isArray(s.transcript) ? s.transcript : undefined,
    aiMessages: Array.isArray(s.aiMessages) ? s.aiMessages : undefined,
    durationSec: typeof s.durationSec === 'number' ? s.durationSec : undefined,
    createdAt: s.createdAt ?? Date.now(),
    updatedAt: s.updatedAt ?? Date.now()
  }
}
