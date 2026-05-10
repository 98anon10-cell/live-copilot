import { create } from 'zustand'
import { logger } from './logger'
import type {
  AiProvider,
  AppSettings,
  InterviewSession,
  SessionDocument,
  SttProvider,
  WindowSize
} from '../../../shared/types'

const defaultSettings: AppSettings = {
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

export type View =
  | 'sessions'
  | 'new-session'
  | 'edit-session'
  | 'live'
  | 'settings'
  | 'session-detail'

export type LiveStatus = 'idle' | 'connecting' | 'recording'

interface AppState {
  view: View
  sessions: InterviewSession[]
  activeSessionId: string | null
  settings: AppSettings
  loaded: boolean
  liveStatus: LiveStatus

  loadAll: () => Promise<void>
  setView: (view: View) => void
  setActiveSession: (id: string | null) => void
  setLiveStatus: (status: LiveStatus) => void

  createSession: (
    partial: Omit<InterviewSession, 'id' | 'createdAt' | 'updatedAt'>
  ) => InterviewSession
  updateSession: (id: string, patch: Partial<InterviewSession>) => void
  deleteSession: (id: string) => void
  addDocuments: (id: string, docs: SessionDocument[]) => void
  removeDocument: (sessionId: string, docId: string) => void

  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  setWindowSize: (size: WindowSize, persist?: boolean) => Promise<void>
  setPrivateMode: (privateMode: boolean, persist?: boolean) => Promise<void>
  upsertAiProvider: (provider: AiProvider) => Promise<void>
  removeAiProvider: (id: string) => Promise<void>
  upsertSttProvider: (provider: SttProvider) => Promise<void>
  removeSttProvider: (id: string) => Promise<void>
}

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

let sessionSaveQueue: Promise<void> = Promise.resolve()

function queueSaveSessions(sessions: InterviewSession[]): void {
  const snapshot = structuredClone(sessions)
  sessionSaveQueue = sessionSaveQueue
    .catch(() => {})
    .then(async () => {
      const saved = await window.api.saveSessions(snapshot)
      if (!saved) throw new Error('saveSessions returned false')
    })
  sessionSaveQueue.catch((err) => logger.error('saveSessions failed', err))
}

export const useApp = create<AppState>((set, get) => ({
  view: 'sessions',
  sessions: [],
  activeSessionId: null,
  settings: defaultSettings,
  loaded: false,
  liveStatus: 'idle',

  loadAll: async () => {
    const [sessions, settings] = await Promise.all([
      window.api.listSessions(),
      window.api.getSettings()
    ])
    set({ sessions, settings, loaded: true })
  },

  setView: (view) => set({ view }),
  setActiveSession: (id) => set({ activeSessionId: id }),
  setLiveStatus: (liveStatus) => set({ liveStatus }),

  createSession: (partial) => {
    const now = Date.now()
    const session: InterviewSession = {
      ...partial,
      id: randomId(),
      createdAt: now,
      updatedAt: now
    }
    const sessions = [session, ...get().sessions]
    set({ sessions })
    queueSaveSessions(sessions)
    return session
  },

  updateSession: (id, patch) => {
    const sessions = get().sessions.map((s) =>
      s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s
    )
    set({ sessions })
    queueSaveSessions(sessions)
  },

  deleteSession: (id) => {
    const sessions = get().sessions.filter((s) => s.id !== id)
    set({ sessions })
    queueSaveSessions(sessions)
  },

  addDocuments: (id, docs) => {
    const sessions = get().sessions.map((s) =>
      s.id === id
        ? { ...s, documents: [...(s.documents ?? []), ...docs], updatedAt: Date.now() }
        : s
    )
    set({ sessions })
    queueSaveSessions(sessions)
  },

  removeDocument: (sessionId, docId) => {
    const sessions = get().sessions.map((s) =>
      s.id === sessionId
        ? {
            ...s,
            documents: (s.documents ?? []).filter((d) => d.id !== docId),
            updatedAt: Date.now()
          }
        : s
    )
    set({ sessions })
    queueSaveSessions(sessions)
  },

  updateSettings: async (patch) => {
    const settings = { ...get().settings, ...patch }
    set({ settings })
    await window.api.setSettings(settings)
  },

  setWindowSize: async (size, persist = true) => {
    set({ settings: { ...get().settings, windowSize: size } })
    if (persist) await window.api.setWindowSize(size)
  },

  setPrivateMode: async (privateMode, persist = true) => {
    const settings = { ...get().settings, privateMode }
    set({ settings })
    if (persist) await window.api.setSettings(settings)
  },

  upsertAiProvider: async (provider) => {
    const list = get().settings.aiProviders
    const exists = list.some((p) => p.id === provider.id)
    const aiProviders = exists
      ? list.map((p) => (p.id === provider.id ? provider : p))
      : [...list, provider]
    await get().updateSettings({ aiProviders })
  },

  removeAiProvider: async (id) => {
    const aiProviders = get().settings.aiProviders.filter((p) => p.id !== id)
    await get().updateSettings({ aiProviders })
  },

  upsertSttProvider: async (provider) => {
    const list = get().settings.sttProviders
    const exists = list.some((p) => p.id === provider.id)
    const sttProviders = exists
      ? list.map((p) => (p.id === provider.id ? provider : p))
      : [...list, provider]
    await get().updateSettings({ sttProviders })
  },

  removeSttProvider: async (id) => {
    const sttProviders = get().settings.sttProviders.filter((p) => p.id !== id)
    await get().updateSettings({ sttProviders })
  }
}))

export function newProviderId(): string {
  return randomId()
}
