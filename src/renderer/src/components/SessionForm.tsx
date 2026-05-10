import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Sparkles } from 'lucide-react'
import { useApp, newProviderId } from '../lib/store'
import type {
  AiProvider,
  InterviewSession,
  SttProvider
} from '../../../shared/types'
import { Button } from './ui/button'
import { Switch } from './ui/switch'
import { Select } from './ui/select'
import { LabelWithTooltip } from './LabelWithTooltip'
import { AiProviderRow, SttProviderRow } from './ProviderRow'
import {
  aiProviderStatus,
  defaultAiLabel,
  defaultSttLabel,
  sttProviderStatus
} from '../lib/providers'

const SESSION_LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
  { id: 'pt', label: 'Português' },
  { id: 'fr', label: 'Français' },
  { id: 'de', label: 'Deutsch' },
  { id: 'it', label: 'Italiano' },
  { id: 'nl', label: 'Nederlands' }
]

type FormState = Pick<
  InterviewSession,
  | 'extraContext'
  | 'language'
  | 'aiProviderId'
  | 'aiModel'
  | 'autoGenerate'
  | 'simpleLanguage'
  | 'saveTranscript'
>

function makeEmpty(defaultLanguage: string, defaultProviderId: string): FormState {
  return {
    extraContext: '',
    language: defaultLanguage || 'en',
    aiProviderId: defaultProviderId,
    aiModel: '',
    autoGenerate: true,
    simpleLanguage: false,
    saveTranscript: true
  }
}

export function SessionForm(): JSX.Element {
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const activeId = useApp((s) => s.activeSessionId)
  const sessions = useApp((s) => s.sessions)
  const settings = useApp((s) => s.settings)
  const createSession = useApp((s) => s.createSession)
  const updateSession = useApp((s) => s.updateSession)
  const setActive = useApp((s) => s.setActiveSession)

  const editing = view === 'edit-session'
  const existing = editing ? sessions.find((s) => s.id === activeId) ?? null : null

  const defaultProviderId = settings.aiProviders[0]?.id ?? ''
  const [form, setForm] = useState<FormState>(
    existing
      ? {
          extraContext: existing.extraContext,
          language: existing.language,
          aiProviderId: existing.aiProviderId,
          aiModel: existing.aiModel,
          autoGenerate: existing.autoGenerate,
          simpleLanguage: existing.simpleLanguage,
          saveTranscript: existing.saveTranscript
        }
      : makeEmpty(settings.defaultLanguage, defaultProviderId)
  )

  // Editor state. We can be editing an existing provider (id in store) or building a brand
  // new one in a local buffer that never reaches the store unless the user hits Save.
  const [editingAiId, setEditingAiId] = useState<string | null>(null)
  const [pendingNewAi, setPendingNewAi] = useState<AiProvider | null>(null)
  const [editingSttId, setEditingSttId] = useState<string | null>(null)
  const [pendingNewStt, setPendingNewStt] = useState<SttProvider | null>(null)

  useEffect(() => {
    if (existing) {
      setForm({
        extraContext: existing.extraContext,
        language: existing.language,
        aiProviderId: existing.aiProviderId,
        aiModel: existing.aiModel,
        autoGenerate: existing.autoGenerate,
        simpleLanguage: existing.simpleLanguage,
        saveTranscript: existing.saveTranscript
      })
    } else {
      setForm(makeEmpty(settings.defaultLanguage, defaultProviderId))
    }
  }, [activeId, editing])

  const selectedProvider = settings.aiProviders.find((p) => p.id === form.aiProviderId)
  const sttList = settings.sttProviders

  // With the new invariant ("ready or it doesn't exist"), every persisted provider is
  // ready, but we keep the filter as a safety net in case some legacy entry survived.
  const readyAiProviders = useMemo(
    () => settings.aiProviders.filter((p) => aiProviderStatus(p).ready),
    [settings.aiProviders]
  )
  const readyStt = useMemo(
    () => sttList.filter((p) => sttProviderStatus(p).ready),
    [sttList]
  )
  const readyAiProviderIds = useMemo(
    () => readyAiProviders.map((p) => p.id).join('|'),
    [readyAiProviders]
  )
  const stt = readyStt[0] ?? null

  // If the currently selected provider is no longer ready (e.g. user removed the API key
  // from the editor), deselect it so the user is forced to pick another or finish setup.
  useEffect(() => {
    if (form.aiProviderId && !readyAiProviders.some((p) => p.id === form.aiProviderId)) {
      patch({ aiProviderId: '', aiModel: '' })
    }
  }, [form.aiProviderId, readyAiProviderIds])

  // Auto-select a provider once it becomes ready, if nothing is selected.
  useEffect(() => {
    if (!form.aiProviderId && readyAiProviders.length > 0) {
      const next = readyAiProviders[0]
      patch({ aiProviderId: next.id, aiModel: next.model })
    }
  }, [form.aiProviderId, readyAiProviderIds, readyAiProviders])

  const issues = useMemo(() => {
    const list: string[] = []
    if (!form.aiProviderId || !selectedProvider) list.push('Pick or add an AI provider.')
    else if (!aiProviderStatus(selectedProvider).ready)
      list.push(`Profile "${selectedProvider.label}" is not finished — open it and complete it.`)
    if (!stt) list.push('Add a Speech-to-Text provider.')
    return list
  }, [form.aiProviderId, selectedProvider, stt])

  const canStart = issues.length === 0

  function patch(p: Partial<FormState>): void {
    setForm((f) => ({ ...f, ...p }))
  }

  function addNewAi(): void {
    setEditingAiId(null)
    setPendingNewAi({
      id: newProviderId(),
      label: defaultAiLabel('ollama', settings.aiProviders),
      kind: 'ollama',
      baseUrl: '',
      apiKey: '',
      model: ''
    })
  }

  function addNewStt(): void {
    setEditingSttId(null)
    setPendingNewStt({
      id: newProviderId(),
      label: defaultSttLabel('groq-whisper', settings.sttProviders),
      kind: 'groq-whisper',
      baseUrl: '',
      apiKey: '',
      model: 'whisper-large-v3-turbo'
    })
  }

  function deriveName(): string {
    const ctx = form.extraContext.trim()
    if (ctx) return ctx.slice(0, 60).replace(/\s+/g, ' ')
    return `Session ${new Date().toLocaleString()}`
  }

  function start(): void {
    if (!canStart) return
    // Snapshot the current profile model into the session so live reads stay stable
    // even if the provider profile is edited later.
    const aiModel = selectedProvider?.model ?? form.aiModel
    const payload = { ...form, aiModel }
    if (editing && existing) {
      updateSession(existing.id, { ...payload, name: existing.name || deriveName() })
      setActive(existing.id)
      setView('live')
    } else {
      const created = createSession({ ...payload, name: deriveName() })
      setActive(created.id)
      setView('live')
    }
  }

  return (
    <form
      className="flex flex-col gap-y-3 pb-3"
      onSubmit={(e) => {
        e.preventDefault()
        start()
      }}
    >
      {/* Free-form context */}
      <div className="flex flex-col gap-y-1">
        <LabelWithTooltip tooltip="Anything the AI should know — role, tone, what to focus on, key facts. Free text.">
          Context for AI <span className="text-muted-foreground text-xs">(optional)</span>
        </LabelWithTooltip>
        <textarea
          className="textarea min-h-[140px]"
          placeholder="E.g. I'm interviewing for a backend role at Acme. Be concise, technical. Focus on Python and AWS. My background: 5 years backend, used Django + FastAPI…"
          value={form.extraContext}
          onChange={(e) => patch({ extraContext: e.target.value })}
        />
      </div>

      {/* AI provider */}
      <div className="flex flex-col gap-y-1">
        <LabelWithTooltip tooltip="A profile is label + kind + key + model. Pick a saved one, or create a new profile.">
          AI provider
        </LabelWithTooltip>
        {readyAiProviders.length === 0 && !pendingNewAi && !editingAiId ? (
          <div className="rounded-md border border-dashed border-border bg-card/30 p-3 text-xs text-muted-foreground space-y-2">
            <p>No AI profile yet. Create your first one — Ollama is local and free.</p>
            <Button type="button" variant="outline" size="sm" onClick={addNewAi}>
              <Plus className="h-3.5 w-3.5" />
              Add AI provider
            </Button>
          </div>
        ) : (
          readyAiProviders.length > 0 && (
            <div className="flex items-center gap-2">
              <Select
                className="flex-1"
                value={form.aiProviderId}
                onChange={(v) => {
                  const p = readyAiProviders.find((x) => x.id === v)
                  patch({ aiProviderId: v, aiModel: p?.model ?? '' })
                  setEditingAiId(null)
                  setPendingNewAi(null)
                }}
                placeholder="Pick a profile…"
                options={readyAiProviders.map((p) => ({
                  value: p.id,
                  label: p.label,
                  hint: aiProviderStatus(p).hint
                }))}
              />
              <button
                type="button"
                className="btn-icon text-muted-foreground hover:text-foreground shrink-0"
                title={editingAiId === form.aiProviderId ? 'Close editor' : 'Edit selected'}
                disabled={!selectedProvider}
                onClick={() => {
                  setPendingNewAi(null)
                  setEditingAiId((cur) =>
                    cur === form.aiProviderId ? null : form.aiProviderId
                  )
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="btn-icon text-muted-foreground hover:text-foreground shrink-0"
                title="Add another profile"
                onClick={addNewAi}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        )}
        {pendingNewAi && (
          <div className="mt-2">
            <AiProviderRow
              provider={pendingNewAi}
              existsInStore={false}
              onClose={() => setPendingNewAi(null)}
            />
          </div>
        )}
        {editingAiId && settings.aiProviders.find((p) => p.id === editingAiId) && (
          <div className="mt-2">
            <AiProviderRow
              provider={settings.aiProviders.find((p) => p.id === editingAiId)!}
              existsInStore
              onClose={() => setEditingAiId(null)}
            />
          </div>
        )}
      </div>

      {/* STT */}
      <div className="flex flex-col gap-y-1">
        <LabelWithTooltip tooltip="Speech-to-Text used for live transcription. Recommended: Groq Whisper (gratis).">
          Speech-to-Text
        </LabelWithTooltip>
        {!stt && !pendingNewStt && !editingSttId ? (
          <div className="rounded-md border border-dashed border-border bg-card/30 p-3 text-xs text-muted-foreground space-y-2">
            <p>No STT yet. Groq Whisper is fast, free and set up automatically.</p>
            <Button type="button" variant="outline" size="sm" onClick={addNewStt}>
              <Plus className="h-3.5 w-3.5" />
              Add Speech-to-Text
            </Button>
          </div>
        ) : (
          stt && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-card/40 px-3 py-2 text-sm">
              <span className="flex-1 min-w-0">
                <div className="truncate">{stt.label}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {sttProviderStatus(stt).hint}
                </div>
              </span>
              <button
                type="button"
                className="btn-icon text-muted-foreground hover:text-foreground"
                title={editingSttId === stt.id ? 'Close editor' : 'Edit'}
                onClick={() => {
                  setPendingNewStt(null)
                  setEditingSttId((cur) => (cur === stt.id ? null : stt.id))
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        )}
        {pendingNewStt && (
          <div className="mt-2">
            <SttProviderRow
              provider={pendingNewStt}
              existsInStore={false}
              onClose={() => setPendingNewStt(null)}
            />
          </div>
        )}
        {editingSttId && sttList.find((p) => p.id === editingSttId) && (
          <div className="mt-2">
            <SttProviderRow
              provider={sttList.find((p) => p.id === editingSttId)!}
              existsInStore
              onClose={() => setEditingSttId(null)}
            />
          </div>
        )}
      </div>

      {/* Language */}
      <div className="flex flex-col gap-y-1">
        <LabelWithTooltip tooltip="Language for transcription and AI responses.">
          Language
        </LabelWithTooltip>
        <Select
          value={form.language}
          onChange={(v) => patch({ language: v })}
          options={SESSION_LANGUAGES.map((l) => ({ value: l.id, label: l.label }))}
        />
      </div>

      {/* Switches */}
      <div className="flex flex-col gap-y-2">
        <SwitchRow
          checked={form.autoGenerate}
          onChange={(v) => patch({ autoGenerate: v })}
          label="Auto-respond"
          tooltip="Automatically reply when a question is detected. Otherwise click Answer (or Ctrl+Shift+A)."
        />
        <SwitchRow
          checked={form.simpleLanguage}
          onChange={(v) => patch({ simpleLanguage: v })}
          label="Simple language"
          tooltip="Tell the AI to use short, plain language."
        />
        <SwitchRow
          checked={form.saveTranscript}
          onChange={(v) => patch({ saveTranscript: v })}
          label="Save transcript"
          tooltip="Persist the live transcript to this session for later review."
        />
      </div>

      {/* Issues */}
      {issues.length > 0 && (
        <div className="rounded-md border border-amber-700/40 bg-amber-700/10 p-2 text-[11px] text-amber-200/90 space-y-1">
          {issues.map((m) => (
            <div key={m}>· {m}</div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex gap-2 pt-1 sticky bottom-0 bg-background/85 backdrop-blur">
        <Button type="submit" variant="brand" className="flex-1" disabled={!canStart}>
          <Sparkles className="h-4 w-4" />
          {editing ? 'Save & Start' : 'Start session'}
        </Button>
      </div>
    </form>
  )
}

function SwitchRow({
  checked,
  onChange,
  label,
  tooltip
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  tooltip: React.ReactNode
}): JSX.Element {
  return (
    <div className="flex flex-row items-center justify-between gap-x-2 rounded-md border border-border bg-card/40 px-3 py-2">
      <LabelWithTooltip tooltip={tooltip}>{label}</LabelWithTooltip>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
