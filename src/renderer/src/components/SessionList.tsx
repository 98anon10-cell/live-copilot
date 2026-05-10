import { Sparkles, Trash2 } from 'lucide-react'
import { useApp } from '../lib/store'
import type { InterviewSession } from '../../../shared/types'
import { Button } from './ui/button'

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}

function preview(session: InterviewSession): string {
  if (session.transcript && session.transcript.length > 0) {
    return session.transcript[0].text.slice(0, 120)
  }
  if (session.extraContext) return session.extraContext.slice(0, 120)
  return ''
}

function Row({ session }: { session: InterviewSession }): JSX.Element {
  const setActive = useApp((s) => s.setActiveSession)
  const setView = useApp((s) => s.setView)
  const deleteSession = useApp((s) => s.deleteSession)

  const title = session.name.trim() || 'Untitled session'
  const hasTranscript = (session.transcript?.length ?? 0) > 0
  const previewText = preview(session)

  return (
    <div className="group flex items-stretch gap-2 rounded-md border border-border bg-card/50 p-2 hover:border-brand-700/50 transition-colors">
      <button
        type="button"
        className="flex-1 text-left min-w-0"
        onClick={() => {
          setActive(session.id)
          setView('session-detail')
        }}
      >
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{relativeTime(session.updatedAt)}</span>
          {hasTranscript && (
            <span className="ml-auto rounded-full bg-brand/15 text-brand-400 px-1.5 py-0.5 text-[10px]">
              {session.transcript!.length} lines
            </span>
          )}
        </div>
        <div className="text-sm font-medium truncate">{title}</div>
        {previewText && (
          <div className="text-[11px] text-muted-foreground truncate mt-0.5">{previewText}</div>
        )}
      </button>
      <div className="flex flex-col items-stretch gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-brand-400"
          title="Reuse — start a new live session with this config"
          onClick={() => {
            setActive(session.id)
            setView('live')
          }}
        >
          <Sparkles className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive-foreground"
          title="Delete"
          onClick={() => {
            if (confirm(`Delete "${title}"?`)) deleteSession(session.id)
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

export function SessionList(): JSX.Element {
  const sessions = useApp((s) => s.sessions)

  if (sessions.length === 0) {
    return (
      <div className="text-muted-foreground my-5 text-center text-sm">
        No sessions yet. Create one in the other tab.
      </div>
    )
  }

  return (
    <div className="space-y-1.5 pb-3">
      {sessions.map((s) => (
        <Row key={s.id} session={s} />
      ))}
    </div>
  )
}
