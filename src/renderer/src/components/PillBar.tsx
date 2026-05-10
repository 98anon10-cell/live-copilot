import { Maximize2 } from 'lucide-react'
import { useApp } from '../lib/store'

export function PillBar(): JSX.Element {
  const setWindowSize = useApp((s) => s.setWindowSize)
  const liveStatus = useApp((s) => s.liveStatus)

  const dotClass =
    liveStatus === 'recording'
      ? 'bg-red-500 rec-dot'
      : liveStatus === 'connecting'
        ? 'bg-amber-300 rec-dot'
        : 'bg-muted-foreground/60'

  return (
    <div
      className="pill-bg group h-screen w-screen rounded-full border border-border backdrop-blur shadow-xl shadow-black/40 flex items-center gap-2 px-3 select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      onDoubleClick={() => void setWindowSize('compact')}
      title="Drag to move · double-click to expand"
    >
      <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${dotClass}`} />
      <span className="text-[11px] font-semibold tracking-tight text-foreground/90 truncate">
        Live Copilot
      </span>
      <button
        type="button"
        title="Expand (Ctrl+Shift+H)"
        aria-label="Expand"
        className="ml-auto h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        onClick={() => void setWindowSize('compact')}
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
