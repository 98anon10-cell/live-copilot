import { useEffect } from 'react'
import { TitleBar } from './components/TitleBar'
import { Home } from './components/Home'
import { LiveSession } from './components/LiveSession'
import { Settings } from './components/Settings'
import { PillBar } from './components/PillBar'
import { SessionDetail } from './components/SessionDetail'
import { TooltipProvider } from './components/ui/tooltip'
import { useApp } from './lib/store'
import { logger } from './lib/logger'

export default function App(): JSX.Element {
  const view = useApp((s) => s.view)
  const loaded = useApp((s) => s.loaded)
  const loadAll = useApp((s) => s.loadAll)
  const settings = useApp((s) => s.settings)
  const setWindowSize = useApp((s) => s.setWindowSize)
  const setPrivateMode = useApp((s) => s.setPrivateMode)
  const setView = useApp((s) => s.setView)

  useEffect(() => {
    loadAll().catch((err) => logger.error('loadAll failed', err))
  }, [loadAll])

  useEffect(() => {
    const offSize = window.api.onShortcutSize((size) => setWindowSize(size, false))
    const offPriv = window.api.onShortcutPrivacy((priv) => setPrivateMode(priv, false))
    const offSettings = window.api.onOpenSettings(() => {
      void setWindowSize('compact', false)
      setView('settings')
    })
    return () => {
      offSize()
      offPriv()
      offSettings()
    }
  }, [setWindowSize, setPrivateMode, setView])

  useEffect(() => {
    document.documentElement.style.setProperty('--panel-alpha', String(settings.opacity))
  }, [settings.opacity])

  const isPill = settings.windowSize === 'pill'

  return (
    <TooltipProvider delayDuration={200}>
      {/* Pill overlay — only the visible UI in pill mode. */}
      {isPill && <PillBar />}

      {/* Main layout. Kept mounted (display:none in pill) so the LiveSession
          component does not unmount and audio capture / STT keeps running. */}
      <div
        style={{ display: isPill ? 'none' : 'flex' }}
        className="app-bg h-screen w-screen flex-col rounded-2xl border border-border/80 backdrop-blur-md shadow-2xl shadow-black/40 overflow-hidden font-sans text-foreground"
      >
        <TitleBar />
        <main className="flex-1 min-h-0 overflow-hidden">
          {!loaded && (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Loading…
            </div>
          )}
          {loaded &&
            (view === 'sessions' || view === 'new-session' || view === 'edit-session') && (
              <Home />
            )}
          {loaded && view === 'live' && <LiveSession />}
          {loaded && view === 'settings' && <Settings />}
          {loaded && view === 'session-detail' && <SessionDetail />}
        </main>
      </div>
    </TooltipProvider>
  )
}
