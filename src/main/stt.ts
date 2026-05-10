import type { SttProvider } from '../shared/types'

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

interface SpeechmaticsOptions {
  apiKey: string
  language: string
  baseUrl?: string
  model?: string
  callbacks: SttCallbacks
}

interface WhisperChunkedOptions {
  baseUrl: string
  apiKey: string
  model: string
  language: string
  chunkSeconds?: number
  callbacks: SttCallbacks
}

const SAMPLE_RATE = 16000
const GROQ_WHISPER_BASE_URL = 'https://api.groq.com/openai/v1'
const GROQ_DEFAULT_MODEL = 'whisper-large-v3-turbo'

class SpeechmaticsClient {
  private ws: WebSocket | null = null
  private seqNo = 0
  private started = false
  private pending: ArrayBuffer[] = []

  constructor(private opts: SpeechmaticsOptions) {}

  async connect(): Promise<void> {
    const jwt = await this.fetchTemporaryJwt()
    return new Promise((resolve, reject) => {
      const baseUrl = (this.opts.baseUrl?.trim() || 'wss://eu2.rt.speechmatics.com/v2').replace(
        /\/+$/,
        ''
      )
      const ws = new WebSocket(`${baseUrl}?jwt=${encodeURIComponent(jwt)}`)
      ws.binaryType = 'arraybuffer'

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            message: 'StartRecognition',
            audio_format: {
              type: 'raw',
              encoding: 'pcm_s16le',
              sample_rate: SAMPLE_RATE
            },
            transcription_config: {
              language: this.opts.language,
              enable_partials: true,
              max_delay: 2,
              operating_point: this.resolveOperatingPoint()
            }
          })
        )
      }

      ws.onmessage = (event) => {
        let msg: unknown
        try {
          msg = JSON.parse(String(event.data))
        } catch {
          return
        }
        if (!isRecord(msg) || typeof msg.message !== 'string') return
        switch (msg.message) {
          case 'RecognitionStarted':
            this.started = true
            this.opts.callbacks.onOpen?.()
            for (const buf of this.pending) this.sendAudioBuffer(buf)
            this.pending = []
            resolve()
            break
          case 'AddPartialTranscript': {
            const text = readTranscript(msg)
            if (text) this.opts.callbacks.onPartial(text)
            break
          }
          case 'AddTranscript': {
            const text = readTranscript(msg)
            if (text) this.opts.callbacks.onFinal(text)
            break
          }
          case 'Error':
          case 'Warning':
            if (typeof msg.type === 'string' && typeof msg.reason === 'string') {
              this.opts.callbacks.onError(
                new Error(`Speechmatics ${msg.message}: ${msg.type} - ${msg.reason}`)
              )
            }
            break
          case 'EndOfTranscript':
            ws.close()
            break
        }
      }

      ws.onerror = () => {
        const err = new Error('Speechmatics connection error')
        this.opts.callbacks.onError(err)
        reject(err)
      }

      ws.onclose = () => {
        this.started = false
        this.opts.callbacks.onClose()
      }

      this.ws = ws
    })
  }

  sendPcm(int16: Int16Array): void {
    const buf = int16.buffer.slice(
      int16.byteOffset,
      int16.byteOffset + int16.byteLength
    ) as ArrayBuffer
    if (!this.started) {
      this.pending.push(buf)
      return
    }
    this.sendAudioBuffer(buf)
  }

  close(): void {
    if (!this.ws) return
    if (this.ws.readyState === WebSocket.OPEN && this.started) {
      try {
        this.ws.send(JSON.stringify({ message: 'EndOfStream', last_seq_no: this.seqNo }))
      } catch {
        // Closing best-effort.
      }
    }
    try {
      this.ws.close()
    } catch {
      // Closing best-effort.
    }
    this.ws = null
  }

  private sendAudioBuffer(buf: ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(buf)
    this.seqNo += 1
  }

  private async fetchTemporaryJwt(): Promise<string> {
    const res = await fetch('https://mp.speechmatics.com/v1/api_keys?type=rt', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ttl: 3600 })
    })
    if (!res.ok) {
      throw new Error(
        `Speechmatics rejected the API key (${res.status}). Check your key in Settings.`
      )
    }
    const data = (await res.json()) as { key_value?: string }
    if (!data.key_value) throw new Error('Speechmatics did not return a temporary key.')
    return data.key_value
  }

  private resolveOperatingPoint(): 'standard' | 'enhanced' {
    return this.opts.model?.trim() === 'standard' ? 'standard' : 'enhanced'
  }
}

class WhisperChunkedClient {
  private buffer: Int16Array[] = []
  private bufferSize = 0
  private targetSize: number
  private queue: Promise<void> = Promise.resolve()
  private closed = false

  constructor(private opts: WhisperChunkedOptions) {
    this.targetSize = SAMPLE_RATE * (opts.chunkSeconds ?? 3)
  }

  async connect(): Promise<void> {
    this.opts.callbacks.onOpen?.()
  }

  sendPcm(int16: Int16Array): void {
    if (this.closed) return
    this.buffer.push(int16)
    this.bufferSize += int16.length
    if (this.bufferSize >= this.targetSize) this.flushChunk()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    if (this.bufferSize > 0) this.flushChunk()
    this.opts.callbacks.onClose()
  }

  private flushChunk(): void {
    const merged = mergeInt16(this.buffer, this.bufferSize)
    this.buffer = []
    this.bufferSize = 0
    if (isSilent(merged)) return
    this.queue = this.queue
      .catch(() => {})
      .then(() => this.transcribe(merged))
  }

  private async transcribe(samples: Int16Array): Promise<void> {
    try {
      const wav = pcmInt16ToWav(samples, SAMPLE_RATE)
      const blob = new Blob([wav], { type: 'audio/wav' })
      const fd = new FormData()
      fd.append('file', blob, 'audio.wav')
      fd.append('model', this.opts.model)
      if (this.opts.language && this.opts.language !== 'auto') {
        fd.append('language', this.opts.language)
      }
      fd.append('response_format', 'json')

      const headers: Record<string, string> = {}
      if (this.opts.apiKey.trim()) headers.Authorization = `Bearer ${this.opts.apiKey}`
      const res = await fetch(`${this.opts.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
        method: 'POST',
        headers,
        body: fd
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Whisper ${res.status}: ${text || res.statusText}`)
      }
      const data = (await res.json()) as { text?: string }
      const text = (data.text ?? '').trim()
      if (text.length > 0) this.opts.callbacks.onFinal(text)
    } catch (err) {
      this.opts.callbacks.onError(err instanceof Error ? err : new Error(String(err)))
    }
  }
}

export function createSttClient(
  provider: SttProvider,
  language: string,
  callbacks: SttCallbacks
): SttClient {
  if (provider.kind === 'speechmatics') {
    return new SpeechmaticsClient({
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      model: provider.model,
      language,
      callbacks
    })
  }

  if (provider.kind === 'groq-whisper') {
    return new WhisperChunkedClient({
      baseUrl: provider.baseUrl.trim() || GROQ_WHISPER_BASE_URL,
      apiKey: provider.apiKey,
      model: provider.model.trim() || GROQ_DEFAULT_MODEL,
      language,
      callbacks
    })
  }

  return new WhisperChunkedClient({
    baseUrl: provider.baseUrl.trim() || 'http://localhost:8080/v1',
    apiKey: provider.apiKey,
    model: provider.model.trim() || 'whisper-1',
    language,
    callbacks
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readTranscript(msg: Record<string, unknown>): string {
  const metadata = msg.metadata
  if (!isRecord(metadata) || typeof metadata.transcript !== 'string') return ''
  return metadata.transcript.trim()
}

function pcmInt16ToWav(samples: Int16Array, sampleRate: number): ArrayBuffer {
  const dataLength = samples.byteLength
  const buf = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buf)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataLength, true)
  new Int16Array(buf, 44).set(samples)
  return buf
}

function writeAscii(view: DataView, offset: number, ascii: string): void {
  for (let i = 0; i < ascii.length; i++) view.setUint8(offset + i, ascii.charCodeAt(i))
}

function mergeInt16(parts: Int16Array[], total: number): Int16Array {
  const out = new Int16Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

function isSilent(samples: Int16Array): boolean {
  let sumSq = 0
  for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i]
  const rms = Math.sqrt(sumSq / samples.length)
  return rms < 350
}
