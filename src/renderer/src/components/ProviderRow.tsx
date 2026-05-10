import { useEffect, useState } from 'react'
import { Check, RefreshCcw, Trash2, X } from 'lucide-react'
import { useApp } from '../lib/store'
import type {
  AiProvider,
  AiProviderKind,
  SttProvider,
  SttProviderKind
} from '../../../shared/types'
import { PROVIDER_DEFAULT_BASE_URL } from '../lib/ai'
import { AiProviderGuide, SttProviderGuide } from './ProviderGuide'
import { Select } from './ui/select'
import {
  aiProviderStatus,
  defaultAiLabel,
  defaultSttLabel,
  isAnyDefaultAiLabel,
  isAnyDefaultSttLabel,
  sttProviderStatus
} from '../lib/providers'
import { Button } from './ui/button'

const AI_KINDS: { value: AiProviderKind; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'groq', label: 'Groq' },
  { value: 'cerebras', label: 'Cerebras' },
  { value: 'ollama', label: 'Ollama (local)' },
  { value: 'custom', label: 'OpenAI-compatible' }
]

const STT_KINDS: { value: SttProviderKind; label: string }[] = [
  { value: 'speechmatics', label: 'Speechmatics — real-time, 8 h/mes free' },
  { value: 'groq-whisper', label: 'Groq Whisper — gratis, chunks 3 s' },
  { value: 'openai-compatible', label: 'OpenAI-compatible (local whisper.cpp, etc.)' }
]

const STT_DEFAULT_MODEL: Record<SttProviderKind, string> = {
  speechmatics: 'enhanced',
  'groq-whisper': 'whisper-large-v3-turbo',
  'openai-compatible': 'whisper-1'
}

/**
 * Row props share the same shape: caller passes an initial provider, plus handlers.
 * Editing happens in a local buffer. Save persists. Cancel/X discards the buffer.
 * `existsInStore` controls whether the row offers Delete (only for already-saved profiles).
 */

export function AiProviderRow({
  provider,
  existsInStore,
  onClose
}: {
  provider: AiProvider
  existsInStore: boolean
  onClose: () => void
}): JSX.Element {
  const upsert = useApp((s) => s.upsertAiProvider)
  const remove = useApp((s) => s.removeAiProvider)
  const allProviders = useApp((s) => s.settings.aiProviders)

  const [draft, setDraft] = useState<AiProvider>(provider)
  const status = aiProviderStatus(draft)
  const ready = status.ready

  function patch(p: Partial<AiProvider>): void {
    setDraft((cur) => {
      let next: AiProvider = { ...cur, ...p }
      if (p.kind && p.kind !== cur.kind) {
        if (isAnyDefaultAiLabel(cur.label)) {
          const others = allProviders.filter((x) => x.id !== cur.id)
          next = { ...next, label: defaultAiLabel(p.kind, others) }
        }
        next = { ...next, baseUrl: '', apiKey: '', hasApiKey: false }
      }
      return next
    })
  }

  function save(): void {
    if (!ready) return
    void upsert(draft)
    onClose()
  }

  function cancel(): void {
    onClose()
  }

  function deleteProfile(): void {
    if (confirm(`Remove provider "${draft.label || draft.kind}"?`)) {
      void remove(draft.id)
      onClose()
    }
  }

  return (
    <div className="card p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input
          className="input flex-1 min-w-0"
          placeholder="Profile name (e.g. Qwen14-version1)"
          value={draft.label}
          onChange={(e) => patch({ label: e.target.value })}
        />
        <Select
          value={draft.kind}
          onChange={(v) => patch({ kind: v as AiProviderKind })}
          options={AI_KINDS.map((k) => ({ value: k.value, label: k.label }))}
          className="w-40"
          align="end"
        />
      </div>

      <AiProviderGuide kind={draft.kind} />

      <div className="grid grid-cols-1 gap-2">
        <div>
          <label className="label">
            Base URL{' '}
            {draft.kind === 'ollama' && (
              <span className="text-[10px] normal-case text-muted-foreground/80">
                (déjalo vacío)
              </span>
            )}
          </label>
          <input
            className="input mt-1"
            placeholder={PROVIDER_DEFAULT_BASE_URL[draft.kind] || 'https://…'}
            value={draft.baseUrl}
            onChange={(e) => patch({ baseUrl: e.target.value })}
          />
        </div>
        <div>
          <label className="label">
            API key{' '}
            {draft.kind === 'ollama' && (
              <span className="text-[10px] normal-case text-muted-foreground/80">
                (no hace falta)
              </span>
            )}
          </label>
          <input
            className="input mt-1 font-mono"
            type="password"
            placeholder={
              draft.kind === 'ollama'
                ? '(empty)'
                : draft.hasApiKey && !draft.apiKey
                  ? 'Saved key - type a new key to replace it'
                  : 'sk-...'
            }
            value={draft.apiKey}
            onChange={(e) => patch({ apiKey: e.target.value })}
          />
        </div>
        <ModelInput provider={draft} onChange={(model) => patch({ model })} />
      </div>

      <Footer
        ready={ready}
        statusHint={status.hint}
        existsInStore={existsInStore}
        onSave={save}
        onCancel={cancel}
        onDelete={deleteProfile}
      />
    </div>
  )
}

function ModelInput({
  provider,
  onChange
}: {
  provider: AiProvider
  onChange: (model: string) => void
}): JSX.Element {
  const [detected, setDetected] = useState<string[] | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [detectError, setDetectError] = useState<string | null>(null)
  const [manualMode, setManualMode] = useState(false)

  useEffect(() => {
    setDetected(null)
    setDetectError(null)
    setManualMode(false)
  }, [provider.kind, provider.baseUrl, provider.apiKey, provider.hasApiKey])

  async function detectModels(): Promise<void> {
    setDetecting(true)
    setDetectError(null)
    try {
      const names = await window.api.listAiModels(provider)
      if (names.length === 0) {
        setDetectError(
          provider.kind === 'ollama'
            ? 'No models pulled in Ollama yet. Run `ollama pull <model>`.'
            : 'The provider did not return any models. Type the model manually.'
        )
      } else {
        setDetected(names)
        setManualMode(false)
        if (!provider.model && names.length > 0) onChange(names[0])
      }
    } catch (err) {
      setDetectError(
        err instanceof Error
          ? `Could not list models: ${err.message}`
          : 'Could not list models'
      )
    } finally {
      setDetecting(false)
    }
  }

  const placeholder =
    provider.kind === 'ollama'
      ? 'qwen3:14b'
      : provider.kind === 'anthropic'
        ? 'claude-sonnet-4-6'
        : provider.kind === 'groq'
          ? 'llama-3.3-70b-versatile'
          : 'gpt-4o-mini'

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="label">Model</label>
        <div className="inline-flex items-center gap-3">
          {detected && detected.length > 0 && (
            <button
              type="button"
              onClick={() => setManualMode((cur) => !cur)}
              className="text-[10px] text-brand-400 hover:underline"
            >
              {manualMode ? 'Use list' : 'Manual'}
            </button>
          )}
          <button
            type="button"
            onClick={detectModels}
            disabled={detecting}
            className="text-[10px] text-brand-400 hover:underline inline-flex items-center gap-1"
          >
            <RefreshCcw className={`h-3 w-3 ${detecting ? 'animate-spin' : ''}`} />
            List models
          </button>
        </div>
      </div>
      {detected && detected.length > 0 && !manualMode ? (
        <Select
          value={provider.model}
          onChange={onChange}
          placeholder="Pick a model…"
          options={modelOptions(provider.model, detected)}
        />
      ) : (
        <input
          className="input mt-1 font-mono"
          placeholder={placeholder}
          value={provider.model}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {detectError && <p className="text-[11px] text-amber-300 mt-1">{detectError}</p>}
    </div>
  )
}

function modelOptions(current: string, models: string[]): { value: string; label: string }[] {
  const unique = Array.from(new Set(models.filter(Boolean))).sort((a, b) => a.localeCompare(b))
  if (current && !unique.includes(current)) unique.unshift(current)
  return unique.map((model) => ({ value: model, label: model }))
}

export function SttProviderRow({
  provider,
  existsInStore,
  onClose
}: {
  provider: SttProvider
  existsInStore: boolean
  onClose: () => void
}): JSX.Element {
  const upsert = useApp((s) => s.upsertSttProvider)
  const remove = useApp((s) => s.removeSttProvider)
  const allStt = useApp((s) => s.settings.sttProviders)

  const [draft, setDraft] = useState<SttProvider>(provider)
  const status = sttProviderStatus(draft)
  const ready = status.ready

  function patch(p: Partial<SttProvider>): void {
    setDraft((cur) => {
      let next: SttProvider = { ...cur, ...p }
      if (p.kind && p.kind !== cur.kind) {
        if (isAnyDefaultSttLabel(cur.label)) {
          const others = allStt.filter((x) => x.id !== cur.id)
          next = { ...next, label: defaultSttLabel(p.kind, others) }
        }
        const oldDefault = STT_DEFAULT_MODEL[cur.kind]
        if (cur.model.trim() === oldDefault || cur.model.trim() === '') {
          next = { ...next, model: STT_DEFAULT_MODEL[p.kind] }
        }
        next = { ...next, baseUrl: '', apiKey: '', hasApiKey: false }
      }
      return next
    })
  }

  function save(): void {
    if (!ready) return
    void upsert(draft)
    onClose()
  }

  function cancel(): void {
    onClose()
  }

  function deleteProfile(): void {
    if (confirm('Remove this STT provider?')) {
      void remove(draft.id)
      onClose()
    }
  }

  return (
    <div className="card p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input
          className="input flex-1 min-w-0"
          placeholder="Profile name"
          value={draft.label}
          onChange={(e) => patch({ label: e.target.value })}
        />
        <Select
          value={draft.kind}
          onChange={(v) => patch({ kind: v as SttProviderKind })}
          options={STT_KINDS.map((k) => ({ value: k.value, label: k.label }))}
          className="w-44"
          align="end"
        />
      </div>

      <SttProviderGuide kind={draft.kind} />

      <div>
        <label className="label">
          Base URL{' '}
          {(draft.kind === 'speechmatics' || draft.kind === 'groq-whisper') && (
            <span className="text-[10px] normal-case text-muted-foreground/80">
              (déjalo vacío)
            </span>
          )}
        </label>
        <input
          className="input mt-1"
          placeholder={
            draft.kind === 'speechmatics'
              ? 'wss://eu2.rt.speechmatics.com/v2'
              : draft.kind === 'groq-whisper'
                ? 'https://api.groq.com/openai/v1'
                : 'http://localhost:8080/v1'
          }
          value={draft.baseUrl}
          onChange={(e) => patch({ baseUrl: e.target.value })}
        />
      </div>
      <div>
        <label className="label">API key</label>
        <input
          className="input mt-1 font-mono"
          type="password"
          placeholder={
            draft.kind === 'openai-compatible'
              ? '(empty if local)'
              : draft.hasApiKey && !draft.apiKey
                ? 'Saved key - type a new key to replace it'
                : 'your key'
          }
          value={draft.apiKey}
          onChange={(e) => patch({ apiKey: e.target.value })}
        />
      </div>
      <div>
        <label className="label">Model</label>
        <input
          className="input mt-1"
          placeholder={
            draft.kind === 'speechmatics'
              ? 'enhanced'
              : draft.kind === 'groq-whisper'
                ? 'whisper-large-v3-turbo'
                : 'whisper-1'
          }
          value={draft.model}
          onChange={(e) => patch({ model: e.target.value })}
        />
      </div>

      <Footer
        ready={ready}
        statusHint={status.hint}
        existsInStore={existsInStore}
        onSave={save}
        onCancel={cancel}
        onDelete={deleteProfile}
      />
    </div>
  )
}

function Footer({
  ready,
  statusHint,
  existsInStore,
  onSave,
  onCancel,
  onDelete
}: {
  ready: boolean
  statusHint: string
  existsInStore: boolean
  onSave: () => void
  onCancel: () => void
  onDelete: () => void
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 pt-1">
      {!ready && (
        <span className="flex-1 text-[11px] text-amber-300 truncate">{statusHint}</span>
      )}
      {ready && <span className="flex-1 text-[11px] text-brand-400 truncate">Ready</span>}
      {existsInStore && (
        <button
          type="button"
          className="btn-icon text-muted-foreground hover:text-destructive-foreground"
          title="Delete profile"
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        <X className="h-3.5 w-3.5" />
        Cancel
      </Button>
      <Button type="button" variant="brand" size="sm" disabled={!ready} onClick={onSave}>
        <Check className="h-3.5 w-3.5" />
        Save
      </Button>
    </div>
  )
}
