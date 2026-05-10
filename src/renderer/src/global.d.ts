import type {
  AiProvider,
  AppSettings,
  CaptureDisplay,
  ChatStreamEvent,
  ChatStreamRequest,
  InterviewSession,
  SessionDocument,
  SttEvent,
  SttStartRequest,
  WindowSize
} from '../../shared/types'

export interface WindowApi {
  getSettings: () => Promise<AppSettings>
  setSettings: (settings: AppSettings) => Promise<AppSettings>
  listSessions: () => Promise<InterviewSession[]>
  saveSessions: (sessions: InterviewSession[]) => Promise<boolean>
  pickDocument: () => Promise<SessionDocument[]>
  scrapeJobPost: (url: string) => Promise<{ company: string; description: string } | null>
  listAiModels: (provider: AiProvider) => Promise<string[]>
  startChatStream: (request: ChatStreamRequest) => Promise<boolean>
  abortChatStream: (id: string) => Promise<boolean>
  onChatEvent: (listener: (event: ChatStreamEvent) => void) => () => void
  startStt: (request: SttStartRequest) => Promise<boolean>
  sendSttPcm: (id: string, chunk: Int16Array) => void
  stopStt: (id: string) => Promise<boolean>
  onSttEvent: (listener: (event: SttEvent) => void) => () => void
  listCaptureDisplays: () => Promise<CaptureDisplay[]>
  captureScreen: (displayId?: string) => Promise<string | null>
  setWindowSize: (size: WindowSize) => Promise<boolean>
  minimize: () => void
  close: () => void
  nextScreen: () => void
  onShortcutAnswer: (listener: () => void) => () => void
  onShortcutCaptureAnswer: (listener: () => void) => () => void
  onOpenSettings: (listener: () => void) => () => void
  onShortcutClear: (listener: () => void) => () => void
  onShortcutSize: (listener: (size: WindowSize) => void) => () => void
  onShortcutPrivacy: (listener: (privateMode: boolean) => void) => () => void
}

declare global {
  interface Window {
    api: WindowApi
  }
}

declare module '*.png' {
  const src: string
  export default src
}
declare module '*.jpg' {
  const src: string
  export default src
}
declare module '*.svg' {
  const src: string
  export default src
}

export {}
