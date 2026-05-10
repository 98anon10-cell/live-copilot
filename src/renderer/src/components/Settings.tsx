import { useState } from 'react'
import { ArrowLeft, KeyRound, Mic, Pencil, Plus } from 'lucide-react'
import { useApp, newProviderId } from '../lib/store'
import type { AiProvider, SttProvider } from '../../../shared/types'
import { AiProviderRow, SttProviderRow } from './ProviderRow'
import { defaultAiLabel, defaultSttLabel } from '../lib/providers'

export function Settings(): JSX.Element {
  const settings = useApp((s) => s.settings)
  const setView = useApp((s) => s.setView)
  const updateSettings = useApp((s) => s.updateSettings)

  const [editingAiId, setEditingAiId] = useState<string | null>(null)
  const [pendingNewAi, setPendingNewAi] = useState<AiProvider | null>(null)
  const [editingSttId, setEditingSttId] = useState<string | null>(null)
  const [pendingNewStt, setPendingNewStt] = useState<SttProvider | null>(null)

  function startNewAi(): void {
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

  function startNewStt(): void {
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

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <button
          type="button"
          className="btn-icon"
          title="Back"
          onClick={() => setView('sessions')}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
          <p className="text-xs text-muted-foreground">
            Bring your own keys. Everything is stored locally.
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-5">
        <section>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-brand-400" />
              <h2 className="text-sm font-semibold">AI providers</h2>
            </div>
            <button type="button" className="btn-outline h-8 px-3 text-xs" onClick={startNewAi}>
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          </div>

          {settings.aiProviders.length === 0 && !pendingNewAi && (
            <div className="card p-4 text-xs text-muted-foreground">
              No AI providers yet. Click <b>Add</b> to create your first profile.
            </div>
          )}

          <div className="space-y-2">
            {settings.aiProviders.map((p) =>
              editingAiId === p.id ? (
                <AiProviderRow
                  key={p.id}
                  provider={p}
                  existsInStore
                  onClose={() => setEditingAiId(null)}
                />
              ) : (
                <ProfileSummary
                  key={p.id}
                  label={p.label}
                  hint={`${p.kind} · ${p.model}`}
                  onEdit={() => setEditingAiId(p.id)}
                />
              )
            )}
            {pendingNewAi && (
              <AiProviderRow
                provider={pendingNewAi}
                existsInStore={false}
                onClose={() => setPendingNewAi(null)}
              />
            )}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Mic className="h-4 w-4 text-brand-400" />
              <h2 className="text-sm font-semibold">Speech-to-Text</h2>
            </div>
            <button type="button" className="btn-outline h-8 px-3 text-xs" onClick={startNewStt}>
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          </div>

          {settings.sttProviders.length === 0 && !pendingNewStt && (
            <div className="card p-4 text-xs text-muted-foreground">
              No STT yet. Recomendado: <b>Groq Whisper</b> (gratis con API key) o{' '}
              <b>Speechmatics</b> (real-time, 8 h/mes free).
            </div>
          )}

          <div className="space-y-2">
            {settings.sttProviders.map((p) =>
              editingSttId === p.id ? (
                <SttProviderRow
                  key={p.id}
                  provider={p}
                  existsInStore
                  onClose={() => setEditingSttId(null)}
                />
              ) : (
                <ProfileSummary
                  key={p.id}
                  label={p.label}
                  hint={`${p.kind} · ${p.model}`}
                  onEdit={() => setEditingSttId(p.id)}
                />
              )
            )}
            {pendingNewStt && (
              <SttProviderRow
                provider={pendingNewStt}
                existsInStore={false}
                onClose={() => setPendingNewStt(null)}
              />
            )}
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Overlay</h2>
          <div className="card p-3 space-y-3">
            <label className="flex items-center justify-between text-sm">
              <span>Always on top</span>
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand"
                checked={settings.alwaysOnTop}
                onChange={(e) => void updateSettings({ alwaysOnTop: e.target.checked })}
              />
            </label>
            <label className="flex items-center justify-between text-sm">
              <span className="flex flex-col">
                <span>Private mode</span>
                <span className="text-xs text-muted-foreground">
                  Hide window from screen-sharing and recording tools.
                </span>
              </span>
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand"
                checked={settings.privateMode}
                onChange={(e) => void updateSettings({ privateMode: e.target.checked })}
              />
            </label>
            <div>
              <label className="label">Default language</label>
              <input
                className="input mt-1"
                placeholder="en"
                value={settings.defaultLanguage}
                onChange={(e) => void updateSettings({ defaultLanguage: e.target.value })}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function ProfileSummary({
  label,
  hint,
  onEdit
}: {
  label: string
  hint: string
  onEdit: () => void
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card/40 px-3 py-2 text-sm">
      <span className="flex-1 min-w-0">
        <div className="truncate">{label}</div>
        <div className="text-[11px] text-muted-foreground truncate">{hint}</div>
      </span>
      <button
        type="button"
        className="btn-icon text-muted-foreground hover:text-foreground"
        title="Edit"
        onClick={onEdit}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
