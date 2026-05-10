import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  shell,
  Tray
} from 'electron'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { runChatStream, listModelNames } from './ai'
import { extractDocument } from './documents'
import { createSttClient, type SttClient } from './stt'
import {
  loadSessions,
  saveSessions,
  loadSettings,
  saveSettings,
  redactSettings,
  mergeStoredSecrets
} from './store'
import type {
  AiProvider,
  AppSettings,
  CaptureDisplay,
  WindowSize
} from '../shared/types'
import {
  isWindowSize,
  sanitizeAiProvider,
  sanitizeChatStreamRequest,
  sanitizeSessions,
  sanitizeSettings,
  sanitizeSttStartRequest
} from '../shared/validation'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let currentSettings: AppSettings | null = null
let saveBoundsTimer: NodeJS.Timeout | null = null
const chatControllers = new Map<string, AbortController>()
const sttClients = new Map<string, SttClient>()
const PORTABLE_DATA_DIR_NAME = 'Live Copilot Data'

const SIZES: Record<WindowSize, { width: number; height: number }> = {
  pill: { width: 132, height: 44 },
  compact: { width: 420, height: 720 },
  expanded: { width: 620, height: 760 }
}

function assetPath(...segments: string[]): string {
  return join(__dirname, '../../resources', ...segments)
}

function appIconPath(): string {
  return assetPath(process.platform === 'win32' ? 'icon.ico' : 'icon.png')
}

function trayIcon(): Electron.NativeImage {
  const icon = nativeImage.createFromPath(assetPath('tray.png'))
  if (!icon.isEmpty()) return icon
  return nativeImage.createFromPath(appIconPath())
}

function getArgValue(name: string): string | null {
  const prefix = `${name}=`
  const index = process.argv.findIndex((value) => value === name || value.startsWith(prefix))
  if (index === -1) return null
  const arg = process.argv[index]
  if (arg.startsWith(prefix)) return arg.slice(prefix.length).trim()
  const next = process.argv[index + 1]
  return next && !next.startsWith('--') ? next.trim() : null
}

function resolvePortableDataDir(): string | null {
  const explicitDataDir = getArgValue('--portable-data-dir') || process.env.LIVE_COPILOT_DATA_DIR
  if (explicitDataDir?.trim()) return resolve(explicitDataDir)

  if (process.env.PORTABLE_EXECUTABLE_DIR?.trim()) {
    return join(process.env.PORTABLE_EXECUTABLE_DIR, PORTABLE_DATA_DIR_NAME)
  }

  if (process.argv.includes('--portable')) {
    const baseDir = app.isPackaged ? dirname(process.execPath) : process.cwd()
    return join(baseDir, PORTABLE_DATA_DIR_NAME)
  }

  return null
}

function configureAppDataPath(): void {
  const portableDataDir = resolvePortableDataDir()
  if (portableDataDir) app.setPath('userData', portableDataDir)
}

configureAppDataPath()

function clampToWorkArea(
  pos: { x: number; y: number },
  size: { width: number; height: number }
): { x: number; y: number } {
  const display = screen.getDisplayMatching({
    x: pos.x,
    y: pos.y,
    width: size.width,
    height: size.height
  })
  const { workArea } = display
  const x = Math.max(workArea.x, Math.min(pos.x, workArea.x + workArea.width - size.width))
  const y = Math.max(workArea.y, Math.min(pos.y, workArea.y + workArea.height - size.height))
  return { x, y }
}

function defaultPosition(size: { width: number; height: number }): { x: number; y: number } {
  const display = screen.getPrimaryDisplay()
  const { workArea } = display
  return {
    x: workArea.x + workArea.width - size.width - 24,
    y: workArea.y + 24
  }
}

function applyWindowSize(win: BrowserWindow, size: WindowSize): void {
  const dims = SIZES[size]
  const current = win.getBounds()
  const wanted = clampToWorkArea({ x: current.x, y: current.y }, dims)
  win.setBounds({ x: wanted.x, y: wanted.y, width: dims.width, height: dims.height }, false)
}

function createMainWindow(settings: AppSettings): void {
  const dims = SIZES[settings.windowSize] ?? SIZES.compact
  const pos = settings.windowPosition
    ? clampToWorkArea(settings.windowPosition, dims)
    : defaultPosition(dims)

  mainWindow = new BrowserWindow({
    show: false,
    x: pos.x,
    y: pos.y,
    width: dims.width,
    height: dims.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: true,
    hasShadow: false,
    roundedCorners: false,
    skipTaskbar: true,
    alwaysOnTop: settings.alwaysOnTop,
    fullscreenable: false,
    backgroundColor: '#00000000',
    type: process.platform === 'darwin' ? 'panel' : undefined,
    icon: appIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })

  if (process.platform === 'win32') {
    mainWindow.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver', 1)
    const tick = setInterval(() => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        clearInterval(tick)
        return
      }
      if (currentSettings?.alwaysOnTop) {
        mainWindow.setAlwaysOnTop(true, 'screen-saver', 1)
      }
    }, 1000)
  }

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  mainWindow.setContentProtection(settings.privateMode)
  // Note: opacity is applied at CSS level (panel background only) so text
  // stays fully legible. We keep the BrowserWindow at 100% opacity.

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('move', () => persistBoundsDebounced())
  mainWindow.on('moved', () => persistBoundsDebounced())

  if (process.env.ELECTRON_RENDERER_URL) {
    // Forward renderer console output only in dev so production builds stay quiet.
    ;(mainWindow.webContents as unknown as {
      on: (event: 'console-message', listener: (details: {
        level?: number | string
        message?: string
        lineNumber?: number
        sourceId?: string
      }) => void) => void
    }).on('console-message', (details) => {
      const rawLevel = details.level
      const tag =
        typeof rawLevel === 'number'
          ? ['DEBUG', 'INFO', 'WARN', 'ERROR'][rawLevel] ?? 'LOG'
          : String(rawLevel ?? 'LOG').toUpperCase()
      const sourceId = details.sourceId
      const where = sourceId ? ` (${sourceId.split('/').pop()}:${details.lineNumber ?? 0})` : ''
      process.stdout.write(`[renderer:${tag}] ${details.message ?? ''}${where}\n`)
    })

    // DevTools open automatically in dev so errors are visible.
    mainWindow.webContents.openDevTools({ mode: 'detach' })
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function persistBoundsDebounced(): void {
  if (!mainWindow || !currentSettings) return
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer)
  saveBoundsTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || !currentSettings) return
    const { x, y } = mainWindow.getBounds()
    currentSettings = { ...currentSettings, windowPosition: { x, y } }
    void saveSettings(currentSettings)
  }, 350)
}

function moveWindowToNextDisplay(): void {
  if (!mainWindow) return
  const displays = screen.getAllDisplays()
  if (displays.length <= 1) return
  const current = screen.getDisplayMatching(mainWindow.getBounds())
  const idx = displays.findIndex((d) => d.id === current.id)
  const next = displays[(idx + 1) % displays.length]
  const { workArea } = next
  const bounds = mainWindow.getBounds()
  const wanted = clampToWorkArea(
    { x: workArea.x + 24, y: workArea.y + 24 },
    { width: bounds.width, height: bounds.height }
  )
  mainWindow.setBounds({ x: wanted.x, y: wanted.y, width: bounds.width, height: bounds.height })
  refreshTrayMenu()
}

async function listCaptureDisplays(): Promise<CaptureDisplay[]> {
  const currentDisplay = mainWindow ? screen.getDisplayMatching(mainWindow.getBounds()) : null
  const primary = screen.getPrimaryDisplay()
  return screen.getAllDisplays().map((display, index) => ({
    id: String(display.id),
    label: `Display ${index + 1}${display.id === primary.id ? ' (primary)' : ''}`,
    isPrimary: display.id === primary.id,
    isCurrent: currentDisplay?.id === display.id
  }))
}

async function captureMainScreen(displayId = 'auto'): Promise<string | null> {
  const displays = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()
  const targetDisplay = displays.find((d) => String(d.id) === displayId)
  const thumbnailDisplay = targetDisplay ?? primary
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: thumbnailDisplay.size.width,
      height: thumbnailDisplay.size.height
    }
  })
  if (sources.length === 0) return null
  const ourDisplay = mainWindow ? screen.getDisplayMatching(mainWindow.getBounds()) : primary
  const pick =
    targetDisplay
      ? sources.find((s) => s.display_id === String(targetDisplay.id)) ?? sources[0]
      : sources.find((s) => !s.display_id || s.display_id !== String(ourDisplay.id)) ??
        sources[0]
  return pick.thumbnail.toDataURL()
}

function broadcast(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

function revealMainWindow(size: WindowSize = 'compact'): void {
  if (!mainWindow || !currentSettings) return
  if (currentSettings.windowSize === 'pill') {
    applyWindowSize(mainWindow, size)
    currentSettings = { ...currentSettings, windowSize: size }
    void saveSettings(currentSettings)
    broadcast('shortcut:size-changed', size)
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  refreshTrayMenu()
}

function hideToPill(): void {
  if (!mainWindow || !currentSettings) return
  applyWindowSize(mainWindow, 'pill')
  currentSettings = { ...currentSettings, windowSize: 'pill' }
  void saveSettings(currentSettings)
  broadcast('shortcut:size-changed', 'pill')
  refreshTrayMenu()
}

function setTrayPrivateMode(privateMode: boolean): void {
  if (!mainWindow || !currentSettings) return
  currentSettings = { ...currentSettings, privateMode }
  mainWindow.setContentProtection(privateMode)
  void saveSettings(currentSettings)
  broadcast('shortcut:privacy-changed', privateMode)
  refreshTrayMenu()
}

function setTrayAlwaysOnTop(alwaysOnTop: boolean): void {
  if (!mainWindow || !currentSettings) return
  currentSettings = { ...currentSettings, alwaysOnTop }
  applySettingsToWindow(currentSettings)
  void saveSettings(currentSettings)
  refreshTrayMenu()
}

function refreshTrayMenu(): void {
  if (!tray || !currentSettings) return
  const isPill = currentSettings.windowSize === 'pill'
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: isPill ? 'Show window' : 'Focus window',
      click: () => revealMainWindow('compact')
    },
    {
      label: 'Hide to pill',
      enabled: !isPill,
      click: () => hideToPill()
    },
    { type: 'separator' },
    {
      label: 'Capture screen and answer',
      accelerator: 'CmdOrCtrl+Shift+S',
      click: () => broadcast('shortcut:capture-answer')
    },
    {
      label: 'Answer now',
      accelerator: 'CmdOrCtrl+Shift+A',
      click: () => broadcast('shortcut:answer')
    },
    { type: 'separator' },
    {
      label: 'Private mode',
      type: 'checkbox',
      checked: currentSettings.privateMode,
      accelerator: 'CmdOrCtrl+Shift+P',
      click: (item) => setTrayPrivateMode(item.checked)
    },
    {
      label: 'Always on top',
      type: 'checkbox',
      checked: currentSettings.alwaysOnTop,
      click: (item) => setTrayAlwaysOnTop(item.checked)
    },
    {
      label: 'Move to next screen',
      click: () => moveWindowToNextDisplay()
    },
    {
      label: 'Settings',
      click: () => {
        revealMainWindow('compact')
        broadcast('app:open-settings')
      }
    },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' }
  ]
  tray.setContextMenu(Menu.buildFromTemplate(template))
}

function createTray(): void {
  if (tray) return
  tray = new Tray(trayIcon())
  tray.setToolTip('Live Copilot')
  tray.on('click', () => revealMainWindow('compact'))
  refreshTrayMenu()
}

function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:'
  } catch {
    return false
  }
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === 'localhost' ||
    host === 'localhost.localdomain' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0'
  )
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map((part) => Number(part))
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase()
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:')
    )
  }
  return false
}

async function isSafeScrapeUrl(rawUrl: string): Promise<boolean> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  if (isBlockedHostname(url.hostname)) return false
  if (isIP(url.hostname) && isPrivateAddress(url.hostname)) return false
  try {
    const addresses = await lookup(url.hostname, { all: true })
    return addresses.every(({ address }) => !isPrivateAddress(address))
  } catch {
    return false
  }
}

function resolveAiProvider(providerId: string): AiProvider | null {
  return currentSettings?.aiProviders.find((p) => p.id === providerId) ?? null
}

function normalizeEndpointBaseUrl(provider: AiProvider): string {
  return provider.baseUrl.trim().replace(/\/+$/, '')
}

function attachStoredSecretForSameEndpoint(provider: AiProvider): AiProvider {
  const stored = resolveAiProvider(provider.id)
  if (!stored || provider.apiKey.trim()) return provider
  const sameEndpoint =
    provider.kind === stored.kind &&
    normalizeEndpointBaseUrl(provider) === normalizeEndpointBaseUrl(stored)
  return {
    ...provider,
    apiKey: sameEndpoint ? stored.apiKey : ''
  }
}

function applySettingsToWindow(s: AppSettings): void {
  if (!mainWindow) return
  mainWindow.setAlwaysOnTop(s.alwaysOnTop, process.platform === 'win32' ? 'screen-saver' : 'floating', 1)
  mainWindow.setContentProtection(s.privateMode)
}

function registerIpc(): void {
  ipcMain.handle('settings:get', async () => redactSettings(await loadSettings()))
  ipcMain.handle('settings:set', async (_e, payload: unknown) => {
    const next = sanitizeSettings(payload, currentSettings ?? undefined)
    const withSecrets = mergeStoredSecrets(next, currentSettings)
    currentSettings = withSecrets
    await saveSettings(withSecrets)
    applySettingsToWindow(withSecrets)
    refreshTrayMenu()
    return true
  })

  ipcMain.handle('sessions:list', async () => loadSessions())
  ipcMain.handle('sessions:save', async (_e, sessions: unknown) => {
    await saveSessions(sanitizeSessions(sessions))
    return true
  })

  ipcMain.handle('dialog:pick-document', async () => {
    if (!mainWindow) return []
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select context document(s)',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Documents', extensions: ['pdf', 'docx', 'txt', 'md'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled) return []
    const docs = await Promise.all(
      result.filePaths.map((p) =>
        extractDocument(p).catch((err) => {
          console.error('Error extracting document', p, err)
          return null
        })
      )
    )
    return docs.filter((d): d is NonNullable<typeof d> => d !== null)
  })

  ipcMain.handle('session:scrape-job-post', async (_e, url: string) => {
    try {
      if (typeof url !== 'string' || !(await isSafeScrapeUrl(url))) return null
      const res = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(8000)
      })
      if (!res.ok) return null
      const contentType = res.headers.get('content-type') ?? ''
      if (contentType && !/text\/html|text\/plain|application\/xhtml\+xml/i.test(contentType)) {
        return null
      }
      const html = (await res.text()).slice(0, 1_000_000)
      const title = /<title>([^<]+)<\/title>/i.exec(html)?.[1] ?? ''
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      return { company: title.split(/[-|·]/)[0]?.trim() ?? '', description: text.slice(0, 4000) }
    } catch (err) {
      console.error('scrape-job-post failed', err)
      return null
    }
  })

  ipcMain.handle('provider:list-models', async (_e, payload: unknown) => {
    const provider = sanitizeAiProvider(payload)
    if (!provider) return []
    return listModelNames(attachStoredSecretForSameEndpoint(provider))
  })

  ipcMain.handle('chat:start', async (e, payload: unknown) => {
    const request = sanitizeChatStreamRequest(payload)
    if (!request) return false
    const provider = resolveAiProvider(request.providerId)
    if (!provider) {
      e.sender.send('chat:event', {
        id: request.id,
        type: 'error',
        error: 'AI provider not found.'
      })
      return false
    }
    chatControllers.get(request.id)?.abort()
    const controller = new AbortController()
    chatControllers.set(request.id, controller)
    void runChatStream(request, provider, controller.signal, e.sender).finally(() => {
      chatControllers.delete(request.id)
    })
    return true
  })

  ipcMain.handle('chat:abort', async (_e, id: unknown) => {
    if (typeof id !== 'string') return false
    chatControllers.get(id)?.abort()
    chatControllers.delete(id)
    return true
  })

  ipcMain.handle('stt:start', async (e, payload: unknown) => {
    const request = sanitizeSttStartRequest(payload)
    if (!request) return false
    const provider = currentSettings?.sttProviders.find((p) => p.id === request.providerId)
    if (!provider) {
      e.sender.send('stt:event', {
        id: request.id,
        type: 'error',
        error: 'Speech-to-Text provider not found.'
      })
      return false
    }
    sttClients.get(request.id)?.close()
    const client = createSttClient(provider, request.language, {
      onOpen: () => e.sender.send('stt:event', { id: request.id, type: 'open' }),
      onPartial: (text) => e.sender.send('stt:event', { id: request.id, type: 'partial', text }),
      onFinal: (text) => e.sender.send('stt:event', { id: request.id, type: 'final', text }),
      onError: (err) =>
        e.sender.send('stt:event', { id: request.id, type: 'error', error: err.message }),
      onClose: () => {
        sttClients.delete(request.id)
        e.sender.send('stt:event', { id: request.id, type: 'close' })
      }
    })
    sttClients.set(request.id, client)
    try {
      await client.connect()
      return true
    } catch (err) {
      sttClients.delete(request.id)
      e.sender.send('stt:event', {
        id: request.id,
        type: 'error',
        error: err instanceof Error ? err.message : String(err)
      })
      return false
    }
  })

  ipcMain.on('stt:pcm', (_e, id: unknown, buffer: unknown) => {
    if (typeof id !== 'string') return
    const client = sttClients.get(id)
    if (!client || !(buffer instanceof ArrayBuffer)) return
    client.sendPcm(new Int16Array(buffer))
  })

  ipcMain.handle('stt:stop', async (_e, id: unknown) => {
    if (typeof id !== 'string') return false
    sttClients.get(id)?.close()
    sttClients.delete(id)
    return true
  })

  ipcMain.handle('window:list-capture-displays', async () => listCaptureDisplays())
  ipcMain.handle('window:capture-screen', async (_e, displayId?: string) =>
    captureMainScreen(
      typeof displayId === 'string' && displayId.length <= 80
        ? displayId
        : currentSettings?.screenCaptureDisplayId || 'auto'
    )
  )

  ipcMain.handle('window:set-size', async (_e, size: unknown) => {
    if (!mainWindow || !currentSettings) return false
    if (!isWindowSize(size)) return false
    applyWindowSize(mainWindow, size)
    currentSettings = { ...currentSettings, windowSize: size }
    await saveSettings(currentSettings)
    refreshTrayMenu()
    return true
  })

  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:close', () => mainWindow?.close())
  ipcMain.on('window:next-screen', () => moveWindowToNextDisplay())
}

function enableLoopbackAudio(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          if (sources.length === 0) {
            callback({})
            return
          }
          callback({ video: sources[0], audio: 'loopback' })
        })
        .catch(() => callback({}))
    },
    { useSystemPicker: false }
  )
}

function registerGlobalShortcuts(): void {
  // Shortcut: hide → toggle pill mode (Ctrl/Cmd+Shift+H).
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (!mainWindow || !currentSettings) return
    const next: WindowSize = currentSettings.windowSize === 'pill' ? 'compact' : 'pill'
    applyWindowSize(mainWindow, next)
    currentSettings = { ...currentSettings, windowSize: next }
    void saveSettings(currentSettings)
    broadcast('shortcut:size-changed', next)
    refreshTrayMenu()
  })

  // Shortcut: privacy toggle (Ctrl/Cmd+Shift+P).
  globalShortcut.register('CommandOrControl+Shift+P', () => {
    if (!mainWindow || !currentSettings) return
    const next = !currentSettings.privateMode
    currentSettings = { ...currentSettings, privateMode: next }
    mainWindow.setContentProtection(next)
    void saveSettings(currentSettings)
    broadcast('shortcut:privacy-changed', next)
    refreshTrayMenu()
  })

  // Shortcut: ask the renderer to trigger an Answer.
  globalShortcut.register('CommandOrControl+Shift+A', () => {
    broadcast('shortcut:answer')
  })

  // Shortcut: capture the selected display and answer from the screenshot.
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    broadcast('shortcut:capture-answer')
  })

  // Shortcut: ask the renderer to clear the buffered transcript.
  globalShortcut.register('CommandOrControl+Shift+L', () => {
    broadcast('shortcut:clear')
  })
}

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.clearRecentDocuments()

  const settings = await loadSettings()
  await saveSettings(settings)
  currentSettings = settings
  registerIpc()
  enableLoopbackAudio()
  createMainWindow(settings)
  createTray()
  registerGlobalShortcuts()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && currentSettings) {
      createMainWindow(currentSettings)
    }
  })
})

app.on('will-quit', () => {
  for (const controller of chatControllers.values()) controller.abort()
  for (const client of sttClients.values()) client.close()
  chatControllers.clear()
  sttClients.clear()
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
