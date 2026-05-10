import type { AiProvider, ChatMessage } from '../../../shared/types'

export interface ChatStreamOptions {
  provider: AiProvider
  model: string
  messages: ChatMessage[]
  images?: string[]
  temperature?: number
  signal?: AbortSignal
  onDelta: (delta: string) => void
  onDone: () => void
  onError: (err: Error) => void
}

export const PROVIDER_DEFAULT_BASE_URL: Record<AiProvider['kind'], string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  ollama: 'http://localhost:11434/v1',
  custom: ''
}

const OPENAI_VISION_MODEL_HINTS = [
  'gpt-4o',
  'gpt-4.1',
  'gpt-4.5',
  'gpt-4-turbo',
  'gpt-5',
  'o3',
  'o4'
]

const GROQ_VISION_MODEL_HINTS = ['vision', 'llama-4', 'scout', 'maverick']

const OLLAMA_VISION_MODEL_HINTS = [
  'llava',
  'bakllava',
  'moondream',
  'minicpm-v',
  'qwen-vl',
  'qwen2-vl',
  'qwen2.5-vl',
  'qwen3-vl',
  'gemma3',
  'vision'
]

export function modelSupportsImages(provider: AiProvider, model: string): boolean {
  const name = model.trim().toLowerCase()
  if (!name) return false
  if (provider.kind === 'anthropic') return name.includes('claude')
  if (provider.kind === 'openai') {
    return OPENAI_VISION_MODEL_HINTS.some((hint) => name.includes(hint))
  }
  if (provider.kind === 'groq') {
    return GROQ_VISION_MODEL_HINTS.some((hint) => name.includes(hint))
  }
  if (provider.kind === 'ollama') {
    return OLLAMA_VISION_MODEL_HINTS.some((hint) => name.includes(hint))
  }
  if (provider.kind === 'custom') return true
  return false
}

function streamId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export async function chatStream(opts: ChatStreamOptions): Promise<void> {
  const id = streamId()
  let settled = false
  let removeAbortListener: (() => void) | null = null

  return new Promise((resolve) => {
    const off = window.api.onChatEvent((event) => {
      if (event.id !== id || settled) return
      if (event.type === 'delta') {
        opts.onDelta(event.delta)
        return
      }
      settled = true
      off()
      removeAbortListener?.()
      if (event.type === 'done') {
        opts.onDone()
      } else {
        opts.onError(new Error(event.error))
      }
      resolve()
    })

    const abort = (): void => {
      if (settled) return
      settled = true
      void window.api.abortChatStream(id)
      off()
      removeAbortListener?.()
      resolve()
    }

    if (opts.signal) {
      if (opts.signal.aborted) {
        abort()
        return
      }
      opts.signal.addEventListener('abort', abort, { once: true })
      removeAbortListener = () => opts.signal?.removeEventListener('abort', abort)
    }

    window.api
      .startChatStream({
        id,
        providerId: opts.provider.id,
        model: opts.model,
        messages: opts.messages,
        images: opts.images ?? [],
        temperature: opts.temperature
      })
      .then((started) => {
        if (started || settled) return
        settled = true
        off()
        removeAbortListener?.()
        opts.onError(new Error('Could not start the AI stream.'))
        resolve()
      })
      .catch((err) => {
        if (settled) return
        settled = true
        off()
        removeAbortListener?.()
        opts.onError(err instanceof Error ? err : new Error(String(err)))
        resolve()
      })
  })
}
