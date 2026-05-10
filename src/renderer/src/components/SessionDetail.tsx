import { ArrowLeft, Download, FileText, Sparkles, Trash2 } from 'lucide-react'
import { useApp } from '../lib/store'
import { Button } from './ui/button'

function fmtDuration(sec?: number): string {
  if (!sec) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

export function SessionDetail(): JSX.Element {
  const setView = useApp((s) => s.setView)
  const activeId = useApp((s) => s.activeSessionId)
  const sessions = useApp((s) => s.sessions)
  const deleteSession = useApp((s) => s.deleteSession)
  const setActive = useApp((s) => s.setActiveSession)

  const session = sessions.find((s) => s.id === activeId) ?? null

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-sm text-muted-foreground">
        Session not found.
        <Button variant="brand" className="mt-3" onClick={() => setView('sessions')}>
          Back
        </Button>
      </div>
    )
  }

  const title = session.name.trim() || 'Untitled session'

  const transcript = session.transcript ?? []
  const aiMessages = session.aiMessages ?? []

  function downloadTranscript(): void {
    if (!session) return
    const lines = [
      `# ${title}`,
      `Date: ${new Date(session.updatedAt).toLocaleString()}`,
      `Duration: ${fmtDuration(session.durationSec)}`,
      ''
    ]
    if (transcript.length > 0) {
      lines.push('## Transcript')
      for (const c of transcript) {
        lines.push(
          `[${new Date(c.ts).toLocaleTimeString()}] ${c.speaker === 'me' ? 'You' : 'Them'}: ${c.text}`
        )
      }
      lines.push('')
    }
    if (aiMessages.length > 0) {
      lines.push('## AI replies')
      for (const m of aiMessages) {
        lines.push(`[${new Date(m.ts).toLocaleTimeString()}]`)
        lines.push(m.text)
        lines.push('')
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title.replace(/[^\w\d-]+/g, '_')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <Button variant="ghost" size="icon" onClick={() => setView('sessions')} title="Back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold tracking-tight truncate">{title}</h1>
          <p className="text-[11px] text-muted-foreground truncate">
            {new Date(session.updatedAt).toLocaleString()} · {fmtDuration(session.durationSec)}
          </p>
        </div>
        <Button
          variant="brand"
          size="sm"
          onClick={() => {
            setActive(session.id)
            setView('live')
          }}
        >
          <Sparkles className="h-3.5 w-3.5" />
          Reuse
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-3">
        <section className="card p-3 space-y-1.5 text-xs">
          {session.extraContext && (
            <div>
              <div className="label">Context</div>
              <div className="text-sm whitespace-pre-wrap">{session.extraContext}</div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div>
              <div className="label">Language</div>
              <div className="text-sm">{session.language.toUpperCase()}</div>
            </div>
            <div>
              <div className="label">Model</div>
              <div className="text-sm font-mono">{session.aiModel || '—'}</div>
            </div>
          </div>
        </section>

        {transcript.length > 0 ? (
          <section className="card p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-brand-400" />
                Transcript
              </h2>
              <Button variant="ghost" size="sm" onClick={downloadTranscript}>
                <Download className="h-3.5 w-3.5" />
                .txt
              </Button>
            </div>
            <div className="text-xs space-y-1 max-h-[40vh] overflow-y-auto">
              {transcript.map((c, i) => (
                <div key={i}>
                  <span
                    className={`text-[10px] mr-1.5 ${
                      c.speaker === 'me' ? 'text-brand-400' : 'text-muted-foreground'
                    }`}
                  >
                    {c.speaker === 'me' ? 'You' : 'Them'}
                  </span>
                  <span className="text-foreground/90">{c.text}</span>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <section className="card p-3 text-xs text-muted-foreground">
            No transcript saved for this session. Enable "Save transcript" when creating a session
            to keep one.
          </section>
        )}

        {aiMessages.length > 0 && (
          <section className="card p-3">
            <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-2">
              <Sparkles className="h-3.5 w-3.5 text-brand-400" />
              AI replies ({aiMessages.length})
            </h2>
            <div className="space-y-2 max-h-[40vh] overflow-y-auto">
              {aiMessages.map((m, i) => (
                <div key={i} className="rounded-md border border-border bg-card/50 p-2">
                  <div className="text-[10px] text-muted-foreground mb-1">
                    {new Date(m.ts).toLocaleTimeString()}
                  </div>
                  <div className="text-sm whitespace-pre-wrap">{m.text}</div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="border-t border-border px-3 py-2 flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive-foreground hover:bg-destructive/20"
          onClick={() => {
            if (confirm(`Delete "${title}"? This removes the saved transcript too.`)) {
              deleteSession(session.id)
              setView('sessions')
            }
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      </div>
    </div>
  )
}
