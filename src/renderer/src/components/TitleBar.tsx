import {
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
  Monitor,
  PictureInPicture2,
  Settings2,
  Sun,
  X
} from 'lucide-react'
import { useApp } from '../lib/store'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function TitleBar(): JSX.Element {
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const setWindowSize = useApp((s) => s.setWindowSize)
  const setPrivateMode = useApp((s) => s.setPrivateMode)
  const liveStatus = useApp((s) => s.liveStatus)

  const opacity = settings.opacity
  function adjustOpacity(delta: number): void {
    const next = clamp(Math.round((opacity + delta) * 20) / 20, 0.3, 1)
    void updateSettings({ opacity: next })
  }

  const isExpanded = settings.windowSize === 'expanded'

  return (
    <header className="drag-region flex items-center justify-between h-10 px-1.5 border-b border-border bg-background/40 select-none">
      <button
        type="button"
        className="no-drag flex items-center gap-2 pl-2 pr-2 h-8 rounded-md hover:bg-accent transition-colors"
        onClick={() => setView('sessions')}
        title="Home"
      >
        <span className="text-sm font-semibold tracking-tight text-foreground">Live Copilot</span>
        {liveStatus === 'recording' && (
          <span className="ml-1 h-1.5 w-1.5 rounded-full bg-red-500 rec-dot" />
        )}
      </button>

      <div className="no-drag flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => adjustOpacity(-0.1)}
            >
              <Sun className="h-3.5 w-3.5 opacity-60" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Decrease opacity</TooltipContent>
        </Tooltip>
        <button
          type="button"
          className="h-7 px-1.5 inline-flex items-center justify-center rounded-md text-[10px] font-mono text-muted-foreground hover:bg-accent hover:text-foreground tabular-nums"
          onClick={() => void updateSettings({ opacity: 1 })}
          title="Reset opacity"
        >
          {Math.round(opacity * 100)}%
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => adjustOpacity(0.1)}
            >
              <Sun className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Increase opacity</TooltipContent>
        </Tooltip>

        <div className="w-px h-4 bg-border mx-0.5" />

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={`h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-accent ${
                settings.privateMode
                  ? 'text-brand-400'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => void setPrivateMode(!settings.privateMode)}
            >
              {settings.privateMode ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {settings.privateMode
              ? 'Private mode ON — hidden from screen-share. Toggle (Ctrl+Shift+P)'
              : 'Private mode OFF — visible to screen-share. Toggle (Ctrl+Shift+P)'}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => void setWindowSize(isExpanded ? 'compact' : 'expanded')}
            >
              {isExpanded ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>{isExpanded ? 'Shrink to compact' : 'Expand'}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => window.api.nextScreen?.()}
            >
              <Monitor className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Move to next screen</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={`h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-accent ${
                view === 'settings'
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setView(view === 'settings' ? 'sessions' : 'settings')}
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>

        <div className="w-px h-4 bg-border mx-0.5" />

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => void setWindowSize('pill')}
            >
              <PictureInPicture2 className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Hide to pill (Ctrl+Shift+H)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
              onClick={() => window.api.close()}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
