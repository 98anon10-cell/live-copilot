import type { SttProvider } from '../../../shared/types'

export interface SttCallbacks {
  onPartial: (text: string) => void
  onFinal: (text: string) => void
  onError: (err: Error) => void
  onClose: () => void
  onOpen?: () => void
}

export interface SttClient {
  connect: () => Promise<void>
  sendPcm: (int16: Int16Array) => void
  close: () => void
}

class IpcSttClient implements SttClient {
  private id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  private open = false
  private closed = false
  private off: (() => void) | null = null

  constructor(
    private provider: SttProvider,
    private language: string,
    private callbacks: SttCallbacks
  ) {}

  async connect(): Promise<void> {
    if (this.closed) throw new Error('STT client is closed.')
    this.off = window.api.onSttEvent((event) => {
      if (event.id !== this.id) return
      switch (event.type) {
        case 'open':
          this.open = true
          this.callbacks.onOpen?.()
          break
        case 'partial':
          this.callbacks.onPartial(event.text)
          break
        case 'final':
          this.callbacks.onFinal(event.text)
          break
        case 'error':
          this.callbacks.onError(new Error(event.error))
          break
        case 'close':
          this.closed = true
          this.open = false
          this.off?.()
          this.off = null
          this.callbacks.onClose()
          break
      }
    })
    const started = await window.api.startStt({
      id: this.id,
      providerId: this.provider.id,
      language: this.language
    })
    if (!started) {
      this.off?.()
      this.off = null
      throw new Error('Could not start Speech-to-Text.')
    }
    this.open = true
  }

  sendPcm(int16: Int16Array): void {
    if (!this.open || this.closed) return
    window.api.sendSttPcm(this.id, int16)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.open = false
    this.off?.()
    this.off = null
    void window.api.stopStt(this.id)
  }
}

export function createSttClient(
  provider: SttProvider,
  language: string,
  callbacks: SttCallbacks
): SttClient {
  return new IpcSttClient(provider, language, callbacks)
}

export function describeStt(provider: SttProvider): string {
  if (provider.kind === 'speechmatics') return 'Speechmatics (real-time)'
  if (provider.kind === 'groq-whisper') return 'Groq Whisper (3s chunks)'
  return 'OpenAI-compatible (chunks)'
}
