import { contextBridge, ipcRenderer } from 'electron'
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
} from '../shared/types'

type Listener<T> = (value: T) => void

function on<T>(channel: string, listener: Listener<T>): () => void {
  const handler = (_e: unknown, value: T): void => listener(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  setSettings: (settings: AppSettings): Promise<boolean> =>
    ipcRenderer.invoke('settings:set', settings),
  listSessions: (): Promise<InterviewSession[]> => ipcRenderer.invoke('sessions:list'),
  saveSessions: (sessions: InterviewSession[]): Promise<boolean> =>
    ipcRenderer.invoke('sessions:save', sessions),
  pickDocument: (): Promise<SessionDocument[]> => ipcRenderer.invoke('dialog:pick-document'),
  scrapeJobPost: (url: string): Promise<{ company: string; description: string } | null> =>
    ipcRenderer.invoke('session:scrape-job-post', url),
  listAiModels: (provider: AiProvider): Promise<string[]> =>
    ipcRenderer.invoke('provider:list-models', provider),
  startChatStream: (request: ChatStreamRequest): Promise<boolean> =>
    ipcRenderer.invoke('chat:start', request),
  abortChatStream: (id: string): Promise<boolean> => ipcRenderer.invoke('chat:abort', id),
  onChatEvent: (listener: (event: ChatStreamEvent) => void): (() => void) =>
    on<ChatStreamEvent>('chat:event', listener),
  startStt: (request: SttStartRequest): Promise<boolean> => ipcRenderer.invoke('stt:start', request),
  sendSttPcm: (id: string, chunk: Int16Array): void => {
    const buffer = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)
    ipcRenderer.send('stt:pcm', id, buffer)
  },
  stopStt: (id: string): Promise<boolean> => ipcRenderer.invoke('stt:stop', id),
  onSttEvent: (listener: (event: SttEvent) => void): (() => void) =>
    on<SttEvent>('stt:event', listener),
  listCaptureDisplays: (): Promise<CaptureDisplay[]> =>
    ipcRenderer.invoke('window:list-capture-displays'),
  captureScreen: (displayId?: string): Promise<string | null> =>
    ipcRenderer.invoke('window:capture-screen', displayId),
  setWindowSize: (size: WindowSize): Promise<boolean> =>
    ipcRenderer.invoke('window:set-size', size),
  minimize: (): void => ipcRenderer.send('window:minimize'),
  close: (): void => ipcRenderer.send('window:close'),
  nextScreen: (): void => ipcRenderer.send('window:next-screen'),
  onShortcutAnswer: (listener: () => void): (() => void) =>
    on<void>('shortcut:answer', listener),
  onShortcutCaptureAnswer: (listener: () => void): (() => void) =>
    on<void>('shortcut:capture-answer', listener),
  onOpenSettings: (listener: () => void): (() => void) =>
    on<void>('app:open-settings', listener),
  onShortcutClear: (listener: () => void): (() => void) =>
    on<void>('shortcut:clear', listener),
  onShortcutSize: (listener: (size: WindowSize) => void): (() => void) =>
    on<WindowSize>('shortcut:size-changed', listener),
  onShortcutPrivacy: (listener: (privateMode: boolean) => void): (() => void) =>
    on<boolean>('shortcut:privacy-changed', listener)
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api

declare global {
  interface Window {
    api: Api
  }
}
