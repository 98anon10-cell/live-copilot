import type {
  AiProvider,
  AiProviderKind,
  SttProvider,
  SttProviderKind
} from '../../../shared/types'
import { providerHasSecret } from '../../../shared/validation'

const AI_BASE_LABEL: Record<AiProviderKind, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  groq: 'Groq',
  cerebras: 'Cerebras',
  ollama: 'Ollama (local)',
  custom: 'Custom endpoint'
}

const STT_BASE_LABEL: Record<SttProviderKind, string> = {
  speechmatics: 'Speechmatics',
  'groq-whisper': 'Groq Whisper',
  'openai-compatible': 'Local Whisper'
}

function uniqueLabel(base: string, existing: { label: string }[]): string {
  const taken = new Set(existing.map((p) => p.label.trim()))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

export function defaultAiLabel(kind: AiProviderKind, existing: AiProvider[]): string {
  return uniqueLabel(AI_BASE_LABEL[kind], existing)
}

export function defaultSttLabel(kind: SttProviderKind, existing: SttProvider[]): string {
  return uniqueLabel(STT_BASE_LABEL[kind], existing)
}

/** True when the label looks auto-generated for that kind (so we can rename on kind change). */
export function isDefaultAiLabel(label: string, kind: AiProviderKind): boolean {
  const base = AI_BASE_LABEL[kind]
  if (!label) return true
  return label === base || (/^.+\s\d+$/.test(label) && label.startsWith(base))
}

export function isDefaultSttLabel(label: string, kind: SttProviderKind): boolean {
  const base = STT_BASE_LABEL[kind]
  if (!label) return true
  return label === base || (/^.+\s\d+$/.test(label) && label.startsWith(base))
}

/** True if a label is generated for ANY ai kind (used when changing kind to detect "untouched"). */
export function isAnyDefaultAiLabel(label: string): boolean {
  if (!label) return true
  return Object.keys(AI_BASE_LABEL).some((k) =>
    isDefaultAiLabel(label, k as AiProviderKind)
  )
}

export function isAnyDefaultSttLabel(label: string): boolean {
  if (!label) return true
  return Object.keys(STT_BASE_LABEL).some((k) =>
    isDefaultSttLabel(label, k as SttProviderKind)
  )
}

export interface ProviderStatus {
  ready: boolean
  hint: string
}

export function aiProviderStatus(p: AiProvider): ProviderStatus {
  if (p.kind !== 'ollama' && !providerHasSecret(p)) {
    return { ready: false, hint: `${p.kind} · needs API key` }
  }
  if (!p.model || !p.model.trim()) {
    return { ready: false, hint: `${p.kind} · needs model` }
  }
  return { ready: true, hint: `${p.kind} · ${p.model}` }
}

export function sttProviderStatus(p: SttProvider): ProviderStatus {
  if ((p.kind === 'speechmatics' || p.kind === 'groq-whisper') && !providerHasSecret(p)) {
    return { ready: false, hint: `${p.kind} · needs API key` }
  }
  if (!p.model.trim()) {
    return { ready: false, hint: `${p.kind} · needs model` }
  }
  return { ready: true, hint: `${p.kind} · ${p.model}` }
}
