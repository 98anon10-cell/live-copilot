import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Camera,
  ChevronDown,
  Copy,
  Eraser,
  Headphones,
  Mic,
  Send,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import { useApp } from '../lib/store'
import {
  startLoopbackPcmCapture,
  startMicrophonePcmCapture,
  type AudioCaptureHandle
} from '../lib/audio'
import { createSttClient, type SttClient } from '../lib/stt'
import { chatStream, modelSupportsImages } from '../lib/ai'
import { buildSystemPrompt, buildUserPrompt } from '../lib/prompt'
import { logger } from '../lib/logger'
import {
  normalizeQuestionText,
  questionCandidatesFromTranscript,
  type QuestionCandidate
} from '../lib/question'
import type { AudioMode, CaptureDisplay, TranscriptChunk } from '../../../shared/types'
import { providerHasSecret } from '../../../shared/validation'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

interface LiveTranscriptChunk extends TranscriptChunk {
  id: number
}

interface AiMessage {
  id: number
  text: string
  imageUrl?: string
  streaming: boolean
  ts: number
}

interface SubmittedTranscriptContext {
  maxChunkId: number | null
  partialText: string
  memoryText: string
}

interface SubmitToLlmOptions {
  imageUrl?: string
  autoQuestion?: AutoQuestionJob
}

interface AutoQuestionJob extends QuestionCandidate {
  key: string
}

const MAX_TRANSCRIPT_ITEMS = 200
const MAX_SAVED_TRANSCRIPT_ITEMS = 2000
const AUTO_QUESTION_SILENCE_MS = 850
const AUTO_SEEN_KEY_LIMIT = 200
const CONVERSATION_MEMORY_MAX_CHARS = 2600
const CONVERSATION_MEMORY_ENTRY_MAX_CHARS = 900
const SCREENSHOT_REPLY_INSTRUCTION =
  'Use the attached screenshot as the main context. If it contains a question, code, error, form, document or task, answer it directly and concisely.'

const AUDIO_MODE_LABEL: Record<AudioMode, string> = {
  system: 'PC only',
  mic: 'Mic only',
  both: 'PC + Mic',
  none: 'Audio off'
}

function normalizeTranscriptMatch(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.,;:!?¿¡…]+$/g, '')
    .replace(/\s+/g, ' ')
}

function transcriptChunksToText(
  chunks: Array<Pick<LiveTranscriptChunk, 'speaker' | 'text'>>
): string {
  return chunks.map((c) => (c.speaker === 'me' ? `(me) ${c.text}` : c.text)).join(' ')
}

function limitTail(text: string, maxChars: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  return `...${trimmed.slice(-maxChars)}`
}

function limitHead(text: string, maxChars: number): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, maxChars - 3)}...`
}

function autoQuestionKey(candidate: QuestionCandidate): string {
  return `${candidate.maxChunkId}:${candidate.normalized}`
}

export function LiveSession(): JSX.Element {
  const sessions = useApp((s) => s.sessions)
  const activeId = useApp((s) => s.activeSessionId)
  const settings = useApp((s) => s.settings)
  const setView = useApp((s) => s.setView)
  const updateSession = useApp((s) => s.updateSession)
  const updateSettings = useApp((s) => s.updateSettings)
  const setLiveStatus = useApp((s) => s.setLiveStatus)

  const session = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId]
  )
  const provider = useMemo(
    () => settings.aiProviders.find((p) => p.id === session?.aiProviderId) ?? null,
    [settings.aiProviders, session?.aiProviderId]
  )
  const stt = settings.sttProviders[0] ?? null

  const [audioMode, setAudioMode] = useState<AudioMode>('system')
  const [systemActive, setSystemActive] = useState(false)
  const [micActive, setMicActive] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [sessionTranscript, setSessionTranscript] = useState<LiveTranscriptChunk[]>([])
  const [transcript, setTranscript] = useState<LiveTranscriptChunk[]>([])
  const [partial, setPartial] = useState('')
  const autoGenerate = session?.autoGenerate ?? true
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [composer, setComposer] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [shotPreview, setShotPreview] = useState<string | null>(null)
  const [answering, setAnswering] = useState(false)
  const [autoQueue, setAutoQueue] = useState<AutoQuestionJob[]>([])
  const [capturingScreen, setCapturingScreen] = useState(false)
  const [captureDisplays, setCaptureDisplays] = useState<CaptureDisplay[]>([])

  const sysAudioRef = useRef<AudioCaptureHandle | null>(null)
  const sysSttRef = useRef<SttClient | null>(null)
  const micAudioRef = useRef<AudioCaptureHandle | null>(null)
  const micSttRef = useRef<SttClient | null>(null)
  // Synchronous guards to dedupe concurrent start() calls before any await.
  const startingSysRef = useRef(false)
  const startingMicRef = useRef(false)
  const chunkIdRef = useRef(0)
  const messageIdRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const chatViewRef = useRef<HTMLDivElement | null>(null)
  const transcriptViewRef = useRef<HTMLDivElement | null>(null)
  const sessionRef = useRef(session)
  const activeIdRef = useRef(activeId)
  const sessionTranscriptRef = useRef<LiveTranscriptChunk[]>([])
  const transcriptRef = useRef<LiveTranscriptChunk[]>([])
  const messagesRef = useRef<AiMessage[]>([])
  const partialRef = useRef('')
  const composerRef = useRef('')
  const shotPreviewRef = useRef<string | null>(null)
  const answeringRef = useRef(false)
  const lastFinalAtRef = useRef<number>(0)
  const consumedPartialRef = useRef<string | null>(null)
  const autoTimerRef = useRef<number | null>(null)
  const autoSeenKeysRef = useRef<Set<string>>(new Set())
  const autoSeenKeyOrderRef = useRef<string[]>([])
  const autoCoveredMaxChunkIdRef = useRef(-1)
  const conversationMemoryRef = useRef('')
  const startedAtRef = useRef<number>(Date.now())
  const persistTimerRef = useRef<number | null>(null)

  const fullTranscriptText = useMemo(
    () => transcriptChunksToText(transcript),
    [transcript]
  )

  // Group consecutive chunks from the same speaker into a single visual turn so the
  // panel doesn't look like one-word-per-line spam. Speechmatics emits a final per
  // segment, but humans read better when the turn is a paragraph.
  const groupedTranscript = useMemo(() => {
    type Turn = { id: number; speaker: 'me' | 'them'; text: string; ts: number }
    const turns: Turn[] = []
    for (const c of transcript) {
      const last = turns[turns.length - 1]
      if (last && last.speaker === c.speaker) {
        // Smooth join: skip extra space before pure punctuation.
        const sep = /^[.,;:!?…]/.test(c.text) ? '' : ' '
        last.text = `${last.text}${sep}${c.text}`.replace(/\s+([.,;:!?…])/g, '$1')
        last.ts = c.ts
      } else {
        turns.push({ id: c.id, speaker: c.speaker, text: c.text, ts: c.ts })
      }
    }
    return turns
  }, [transcript])

  // Live status pill (shown elsewhere, e.g. TitleBar/PillBar).
  useEffect(() => {
    setLiveStatus(connecting ? 'connecting' : systemActive || micActive ? 'recording' : 'idle')
  }, [connecting, systemActive, micActive, setLiveStatus])

  useEffect(() => {
    sessionRef.current = session
    activeIdRef.current = activeId
    sessionTranscriptRef.current = sessionTranscript
    transcriptRef.current = transcript
    messagesRef.current = messages
    partialRef.current = partial
    composerRef.current = composer
    shotPreviewRef.current = shotPreview
    answeringRef.current = answering
  }, [
    activeId,
    answering,
    composer,
    messages,
    partial,
    session,
    sessionTranscript,
    shotPreview,
    transcript
  ])

  useEffect(() => {
    conversationMemoryRef.current = ''
    setAutoQueue([])
    autoSeenKeysRef.current.clear()
    autoSeenKeyOrderRef.current = []
    autoCoveredMaxChunkIdRef.current = -1
  }, [activeId])

  useEffect(() => {
    if (!autoGenerate) setAutoQueue([])
  }, [autoGenerate])

  useEffect(() => {
    chatViewRef.current?.scrollTo({ top: chatViewRef.current.scrollHeight })
  }, [messages])

  useEffect(() => {
    transcriptViewRef.current?.scrollTo({ top: transcriptViewRef.current.scrollHeight })
  }, [transcript, partial])

  useEffect(() => {
    void refreshCaptureDisplays()
  }, [])

  async function refreshCaptureDisplays(): Promise<void> {
    const displays = await window.api.listCaptureDisplays().catch(() => [])
    setCaptureDisplays(displays)
  }

  function setAnsweringActive(value: boolean): void {
    answeringRef.current = value
    setAnswering(value)
  }

  function rememberAutoSeenKey(key: string): boolean {
    if (autoSeenKeysRef.current.has(key)) return false
    autoSeenKeysRef.current.add(key)
    autoSeenKeyOrderRef.current.push(key)
    while (autoSeenKeyOrderRef.current.length > AUTO_SEEN_KEY_LIMIT) {
      const oldKey = autoSeenKeyOrderRef.current.shift()
      if (oldKey) autoSeenKeysRef.current.delete(oldKey)
    }
    return true
  }

  function uncoveredAutoCandidate(candidate: QuestionCandidate): QuestionCandidate | null {
    if (candidate.maxChunkId <= autoCoveredMaxChunkIdRef.current) return null
    const uncoveredChunks = transcriptRef.current.filter(
      (chunk) =>
        chunk.id > autoCoveredMaxChunkIdRef.current && chunk.id <= candidate.maxChunkId
    )
    const candidates = questionCandidatesFromTranscript(uncoveredChunks)
    const direct = candidates.find((c) => c.maxChunkId === candidate.maxChunkId)
    if (direct) return direct

    const text = uncoveredChunks
      .filter((chunk) => chunk.speaker === 'them')
      .map((chunk) => chunk.text)
      .join(' ')
      .trim()
    if (!text || !/[?¿]/.test(text)) return null
    return {
      text,
      normalized: normalizeQuestionText(text),
      maxChunkId: candidate.maxChunkId
    }
  }

  function enqueueAutoQuestion(candidate: QuestionCandidate): void {
    const uncovered = uncoveredAutoCandidate(candidate)
    if (!uncovered) return
    const key = autoQuestionKey(uncovered)
    if (!rememberAutoSeenKey(key)) return
    autoCoveredMaxChunkIdRef.current = Math.max(
      autoCoveredMaxChunkIdRef.current,
      uncovered.maxChunkId
    )
    const job: AutoQuestionJob = { ...uncovered, key }
    setAutoQueue((prev) => (prev.some((queued) => queued.key === key) ? prev : [...prev, job]))
  }

  function rememberAnsweredExchange(questionText: string, answerText: string): void {
    const answer = answerText.trim()
    if (!answer) return
    const entry = [
      `Heard: ${limitHead(questionText || 'No transcript text.', CONVERSATION_MEMORY_ENTRY_MAX_CHARS)}`,
      `Answered: ${limitHead(answer, CONVERSATION_MEMORY_ENTRY_MAX_CHARS)}`
    ].join('\n')
    conversationMemoryRef.current = limitTail(
      [conversationMemoryRef.current.trim(), entry].filter(Boolean).join('\n\n'),
      CONVERSATION_MEMORY_MAX_CHARS
    )
  }

  // Persist transcript / AI replies to the session every 4s while live (debounced).
  useEffect(() => {
    if (!session?.saveTranscript || !activeId) return
    if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current)
    persistTimerRef.current = window.setTimeout(() => {
      persistCurrentSession()
    }, 4000)
    return () => {
      if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current)
    }
  }, [sessionTranscript, messages, session?.saveTranscript, activeId])

  // Auto-respond quickly, but queue extra question blocks while an answer is streaming.
  useEffect(() => {
    if (!autoGenerate) return
    if (!systemActive) return
    const candidates = questionCandidatesFromTranscript(transcript)
    if (candidates.length === 0) return

    const latest = candidates[candidates.length - 1]
    const lastChunk = transcript[transcript.length - 1]
    const latestStillOpen = lastChunk?.speaker === 'them' && lastChunk.id === latest.maxChunkId
    const readyNow = latestStillOpen ? candidates.slice(0, -1) : candidates
    for (const candidate of readyNow) enqueueAutoQuestion(candidate)

    if (autoTimerRef.current) window.clearTimeout(autoTimerRef.current)
    if (!latestStillOpen) return
    autoTimerRef.current = window.setTimeout(() => {
      if (Date.now() - lastFinalAtRef.current < AUTO_QUESTION_SILENCE_MS - 150) return
      const freshCandidates = questionCandidatesFromTranscript(transcriptRef.current)
      const freshLatest = freshCandidates[freshCandidates.length - 1]
      if (freshLatest) enqueueAutoQuestion(freshLatest)
    }, AUTO_QUESTION_SILENCE_MS)
    return () => {
      if (autoTimerRef.current) window.clearTimeout(autoTimerRef.current)
    }
  }, [transcript, autoGenerate, systemActive])

  // Cleanup on unmount.
  useEffect(
    () => () => {
      persistCurrentSession()
      stopAll()
      setLiveStatus('idle')
    },
    []
  )

  function persistCurrentSession(): void {
    const currentSession = sessionRef.current
    const id = activeIdRef.current
    if (!currentSession?.saveTranscript || !id) return
    updateSession(id, {
      transcript: sessionTranscriptRef.current.map(({ speaker, text, ts }) => ({
        speaker,
        text,
        ts
      })),
      aiMessages: messagesRef.current
        .filter((m) => m.text.length > 0)
        .map(({ text, ts }) => ({ text, ts })),
      durationSec: Math.round((Date.now() - startedAtRef.current) / 1000)
    })
  }

  function ensureStt(): boolean {
    if (!stt) {
      setErrorMsg('No Speech-to-Text provider configured. Open Settings to add one.')
      return false
    }
    if ((stt.kind === 'speechmatics' || stt.kind === 'groq-whisper') && !providerHasSecret(stt)) {
      setErrorMsg(`${stt.label || stt.kind} has no API key.`)
      return false
    }
    return true
  }

  function appendTranscriptChunk(speaker: 'them' | 'me', text: string): void {
    const chunk: LiveTranscriptChunk = {
      id: chunkIdRef.current++,
      text,
      speaker,
      ts: Date.now()
    }
    setTranscript((prev) => {
      const next = [...prev, chunk].slice(-MAX_TRANSCRIPT_ITEMS)
      transcriptRef.current = next
      return next
    })
    setSessionTranscript((prev) => {
      const next = [...prev, chunk].slice(-MAX_SAVED_TRANSCRIPT_ITEMS)
      sessionTranscriptRef.current = next
      return next
    })
  }

  async function startSystemAudio(): Promise<void> {
    if (startingSysRef.current || sysSttRef.current || sysAudioRef.current) {
      logger.debug('[Live] startSystemAudio: already running/starting, skip')
      return
    }
    startingSysRef.current = true
    if (!ensureStt() || !stt) {
      startingSysRef.current = false
      return
    }
    setErrorMsg(null)
    setConnecting(true)
    logger.debug('[Live] startSystemAudio: stt =', stt.kind, stt.label)
    try {
      const sm = createSttClient(stt, session?.language || settings.defaultLanguage || 'en', {
        onPartial: (text) => setPartial(text),
        onFinal: (text) => {
          logger.debug('[Live] STT final:', text)
          if (
            consumedPartialRef.current &&
            normalizeTranscriptMatch(text) === normalizeTranscriptMatch(consumedPartialRef.current)
          ) {
            consumedPartialRef.current = null
            setPartial('')
            return
          }
          lastFinalAtRef.current = Date.now()
          appendTranscriptChunk('them', text)
          setPartial('')
        },
        onError: (err) => {
          logger.error('[Live] STT error:', err)
          setErrorMsg(err.message)
        },
        onClose: () => {
          logger.debug('[Live] STT closed')
          setPartial('')
          setSystemActive(false)
        }
      })
      logger.debug('[Live] connecting STT')
      await sm.connect()
      logger.debug('[Live] STT connected')
      sysSttRef.current = sm
      logger.debug('[Live] starting loopback PCM capture')
      const cap = await startLoopbackPcmCapture(
        (pcm) => sm.sendPcm(pcm),
        (err) => {
          logger.error('[Live] loopback capture error:', err)
          setErrorMsg(err.message)
          stopSystemAudio()
        }
      )
      sysAudioRef.current = cap
      setSystemActive(true)
      logger.debug('[Live] system audio capturing')
    } catch (err) {
      logger.error('[Live] startSystemAudio failed:', err)
      setErrorMsg(err instanceof Error ? err.message : String(err))
      stopSystemAudio()
    } finally {
      setConnecting(false)
      startingSysRef.current = false
    }
  }

  function stopSystemAudio(): void {
    try {
      sysAudioRef.current?.stop()
    } catch {}
    sysAudioRef.current = null
    try {
      sysSttRef.current?.close()
    } catch {}
    sysSttRef.current = null
    setSystemActive(false)
  }

  async function startMic(): Promise<void> {
    if (startingMicRef.current || micSttRef.current || micAudioRef.current) {
      logger.debug('[Live] startMic: already running/starting, skip')
      return
    }
    startingMicRef.current = true
    if (!ensureStt() || !stt) {
      startingMicRef.current = false
      return
    }
    setErrorMsg(null)
    try {
      const sm = createSttClient(stt, session?.language || settings.defaultLanguage || 'en', {
        onPartial: () => {},
        onFinal: (text) => {
          appendTranscriptChunk('me', text)
        },
        onError: (err) => setErrorMsg(err.message),
        onClose: () => setMicActive(false)
      })
      await sm.connect()
      micSttRef.current = sm
      const cap = await startMicrophonePcmCapture(
        (pcm) => sm.sendPcm(pcm),
        (err) => {
          setErrorMsg(err.message)
          stopMic()
        }
      )
      micAudioRef.current = cap
      setMicActive(true)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      stopMic()
    } finally {
      startingMicRef.current = false
    }
  }

  function stopMic(): void {
    try {
      micAudioRef.current?.stop()
    } catch {}
    micAudioRef.current = null
    try {
      micSttRef.current?.close()
    } catch {}
    micSttRef.current = null
    setMicActive(false)
  }

  function stopAll(): void {
    stopSystemAudio()
    stopMic()
    abortRef.current?.abort()
  }

  // Single source of truth for which audio sources are running.
  async function applyAudioMode(mode: AudioMode): Promise<void> {
    setAudioMode(mode)
    const wantSystem = mode === 'system' || mode === 'both'
    const wantMic = mode === 'mic' || mode === 'both'
    if (!wantSystem && systemActive) stopSystemAudio()
    if (!wantMic && micActive) stopMic()
    if (wantSystem && !systemActive) await startSystemAudio()
    if (wantMic && !micActive) await startMic()
  }

  // Auto-start on mount: default mode is "system".
  useEffect(() => {
    void applyAudioMode('system')
    startedAtRef.current = Date.now()
  }, [])

  async function captureScreen(): Promise<void> {
    if (capturingScreen) return
    setCapturingScreen(true)
    setErrorMsg(null)
    try {
      const dataUrl = await window.api.captureScreen(settings.screenCaptureDisplayId || 'auto')
      if (!dataUrl) {
        setErrorMsg('Could not capture the screen.')
        return
      }
      setShotPreview(dataUrl)
      await submitToLlm({ imageUrl: dataUrl })
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setCapturingScreen(false)
    }
  }

  function markSubmittedTranscriptConsumed(snapshot: SubmittedTranscriptContext): void {
    if (snapshot.maxChunkId !== null) {
      setTranscript((prev) => {
        const next = prev.filter((c) => c.id > snapshot.maxChunkId!)
        transcriptRef.current = next
        return next
      })
    }
    if (snapshot.partialText) {
      consumedPartialRef.current = snapshot.partialText
      const partialChunk: LiveTranscriptChunk = {
        id: chunkIdRef.current++,
        text: snapshot.partialText,
        speaker: 'them',
        ts: Date.now()
      }
      setSessionTranscript((prev) => {
        const next = [...prev, partialChunk].slice(-MAX_SAVED_TRANSCRIPT_ITEMS)
        sessionTranscriptRef.current = next
        return next
      })
      setPartial((current) =>
        normalizeTranscriptMatch(current) === normalizeTranscriptMatch(snapshot.partialText)
          ? ''
          : current
      )
    }
    lastFinalAtRef.current = Date.now()
  }

  const submitToLlm = useCallback(async (options: SubmitToLlmOptions = {}): Promise<void> => {
    if (answeringRef.current) return
    if (!session) return
    if (!provider) {
      logger.warn('[Live] submitToLlm: no provider')
      setErrorMsg('No AI provider for this session.')
      return
    }
    const modelToUse = session.aiModel || provider.model
    if (!modelToUse) {
      logger.warn('[Live] submitToLlm: no model')
      setErrorMsg('The selected AI profile has no model. Open it and add one.')
      return
    }
    const liveTranscript = transcriptRef.current
    const livePartial = partialRef.current.trim()
    const activeComposer = composerRef.current.trim()
    const imageUrl = options.imageUrl ?? shotPreviewRef.current
    const autoQuestion = options.autoQuestion
    const pendingText = transcriptChunksToText(liveTranscript)
    const fullText = autoQuestion
      ? autoQuestion.text.trim()
      : (pendingText + (livePartial ? ' ' + livePartial : '')).trim()
    if (imageUrl && !modelSupportsImages(provider, modelToUse)) {
      setErrorMsg(
        `${provider.label || provider.kind} / ${modelToUse} does not look like a vision model. Pick a model with image support before using screenshot answers.`
      )
      return
    }
    if (!fullText && !activeComposer && !imageUrl) {
      logger.debug('[Live] submitToLlm: nothing to send (empty transcript + composer + image)')
      return
    }
    // Send only the last ~2000 chars to keep the prompt small and the LLM responsive.
    // The most recent part of the transcript is what the AI needs to answer.
    const transcriptText = limitTail(fullText, 2000)
    const consumedContext: SubmittedTranscriptContext = {
      maxChunkId: autoQuestion?.maxChunkId ?? (liveTranscript.at(-1)?.id ?? null),
      partialText: autoQuestion ? '' : livePartial,
      memoryText: [
        transcriptText,
        activeComposer ? `User instruction: ${activeComposer}` : ''
      ].filter(Boolean).join('\n')
    }
    if (!autoQuestion && consumedContext.maxChunkId !== null) {
      setAutoQueue([])
      autoCoveredMaxChunkIdRef.current = Math.max(
        autoCoveredMaxChunkIdRef.current,
        consumedContext.maxChunkId
      )
    }
    logger.debug(
      '[Live] submitToLlm ->',
      provider.kind,
      provider.label,
      modelToUse,
      `(transcript: ${transcriptText.length} chars of ${fullText.length})`
    )

    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    const images = imageUrl ? [imageUrl] : []
    const userInstruction = [
      imageUrl ? SCREENSHOT_REPLY_INSTRUCTION : '',
      activeComposer
    ].filter(Boolean).join('\n')
    const id = messageIdRef.current++
    let answerText = ''
    setMessages((prev) => [
      ...prev,
      {
        id,
        text: '',
        imageUrl: imageUrl ?? undefined,
        streaming: true,
        ts: Date.now()
      }
    ])
    setAnsweringActive(true)

    try {
      await chatStream({
        provider,
        model: modelToUse,
        messages: [
          { role: 'system', content: buildSystemPrompt(session) },
          {
            role: 'user',
            content: buildUserPrompt(transcriptText, {
              userInstruction,
              conversationMemory: conversationMemoryRef.current
            })
          }
        ],
        images,
        signal: ac.signal,
        onDelta: (d) => {
          answerText += d
          setMessages((prev) =>
            prev.map((m) => (m.id === id ? { ...m, text: m.text + d } : m))
          )
        },
        onDone: () => {
          rememberAnsweredExchange(consumedContext.memoryText, answerText)
          markSubmittedTranscriptConsumed(consumedContext)
          setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, streaming: false } : m)))
          setAnsweringActive(false)
          if (imageUrl) {
            setShotPreview((current) => (current === imageUrl ? null : current))
          }
          setComposer('')
        },
        onError: (err) => {
          setErrorMsg(err.message)
          setAutoQueue([])
          setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, streaming: false } : m)))
          setAnsweringActive(false)
        }
      })
    } finally {
      if (abortRef.current === ac) abortRef.current = null
      setAnsweringActive(false)
    }
  }, [session, provider])

  useEffect(() => {
    if (!autoGenerate) return
    if (!systemActive) return
    if (answering) return
    if (autoQueue.length === 0) return
    const next = autoQueue[0]
    setAutoQueue((prev) => prev.slice(1))
    void submitToLlm({ autoQuestion: next })
  }, [autoQueue, autoGenerate, answering, systemActive, submitToLlm])

  function clearBuffer(): void {
    transcriptRef.current = []
    setTranscript([])
    setPartial('')
    setAutoQueue([])
    autoSeenKeysRef.current.clear()
    autoSeenKeyOrderRef.current = []
    autoCoveredMaxChunkIdRef.current = -1
    consumedPartialRef.current = null
    lastFinalAtRef.current = Date.now()
  }

  function stopAnswer(): void {
    abortRef.current?.abort()
    setAutoQueue([])
    setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)))
    setAnsweringActive(false)
  }

  function copyMessage(text: string): void {
    if (!text) return
    navigator.clipboard.writeText(text).catch(() => {})
  }

  function downloadTranscript(): void {
    const blob = new Blob(
      [
        `# ${session?.name || 'Session'}\n`,
        `Exported: ${new Date().toLocaleString()}\n\n`,
        sessionTranscript
          .map(
            (c) =>
              `[${new Date(c.ts).toLocaleTimeString()}] ${
                c.speaker === 'me' ? 'You' : 'Them'
              }\n${c.text}\n`
          )
          .join('\n')
      ],
      { type: 'text/plain;charset=utf-8' }
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(session?.name || 'session')
      .replace(/[^\w\d-]+/g, '_')}_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  function leaveSession(): void {
    persistCurrentSession()
    stopAll()
    setView('sessions')
  }

  function endSession(): void {
    leaveSession()
  }

  // Global shortcuts (Answer / Clear) coming from main.
  useEffect(() => {
    const offAnswer = window.api.onShortcutAnswer(() => {
      void submitToLlm()
    })
    const offCapture = window.api.onShortcutCaptureAnswer(() => {
      void captureScreen()
    })
    const offClear = window.api.onShortcutClear(() => {
      clearBuffer()
    })
    return () => {
      offAnswer()
      offCapture()
      offClear()
    }
    // captureScreen intentionally follows the latest render through submitToLlm changes.
  }, [submitToLlm])

  const selectedCaptureDisplay = captureDisplays.find(
    (display) => display.id === settings.screenCaptureDisplayId
  )
  const captureTargetLabel =
    settings.screenCaptureDisplayId === 'auto' || !settings.screenCaptureDisplayId
      ? 'Auto'
      : selectedCaptureDisplay?.label ?? 'Selected display'
  const pendingTranscriptStatus =
    autoQueue.length > 0
      ? `${autoQueue.length} queued`
      : !systemActive && !micActive
        ? 'Transcription off'
        : transcript.length >= MAX_TRANSCRIPT_ITEMS
          ? `Last ${MAX_TRANSCRIPT_ITEMS}`
          : `${transcript.length} lines`

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
        <div className="text-sm text-muted-foreground">No active session.</div>
        <Button variant="brand" onClick={() => setView('sessions')}>
          Back
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border bg-background/50">
        <AudioModeSelector value={audioMode} onChange={(m) => void applyAudioMode(m)} />

        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                onClick={captureScreen}
                disabled={capturingScreen}
                className="rounded-r-none"
              >
                <Camera className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Capture screen and answer (Ctrl+Shift+S)</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                className="rounded-l-none border-l border-border/70 px-1.5 max-w-[96px]"
                title={`Capture target: ${captureTargetLabel}`}
              >
                <span className="truncate text-[10px]">{captureTargetLabel}</span>
                <ChevronDown className="h-3 w-3 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[220px]">
              <DropdownMenuItem
                onClick={() => void updateSettings({ screenCaptureDisplayId: 'auto' })}
              >
                <div>
                  <div className="text-sm">Auto</div>
                  <div className="text-xs text-muted-foreground">
                    Avoid the overlay display when possible.
                  </div>
                </div>
              </DropdownMenuItem>
              {captureDisplays.map((display) => (
                <DropdownMenuItem
                  key={display.id}
                  onClick={() => void updateSettings({ screenCaptureDisplayId: display.id })}
                >
                  <div>
                    <div className="text-sm">
                      {display.label}
                      {display.isCurrent ? ' · current' : ''}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Capture this monitor.
                    </div>
                  </div>
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onClick={() => void refreshCaptureDisplays()}>
                <div className="text-sm">Refresh displays</div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={downloadTranscript}
              disabled={sessionTranscript.length === 0}
            >
              <div>
                <div className="text-sm">Download full transcript</div>
                <div className="text-xs text-muted-foreground max-w-[220px]">
                  Save the current transcript as a .txt file.
                </div>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={leaveSession}>
              <div>
                <div className="text-sm">Exit</div>
                <div className="text-xs text-muted-foreground max-w-[220px]">
                  Leave this session — capture stops.
                </div>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem
              destructive
              onClick={() => {
                if (confirm('End this session and stop transcription?')) endSession()
              }}
            >
              <div>
                <div className="text-sm">End session</div>
                <div className="text-xs text-muted-foreground max-w-[220px]">
                  Stop everything and persist the transcript if enabled.
                </div>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <StatusPill connecting={connecting} live={systemActive || micActive} />
      </div>

      {errorMsg && (
        <div className="mx-3 mt-2 p-2 rounded-md border border-destructive/40 bg-destructive/10 text-[11px] text-destructive-foreground flex items-start gap-2">
          <span className="flex-1">{errorMsg}</span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setErrorMsg(null)}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Headphones tip — once, top-of-chat */}
      {audioMode === 'both' && (
        <div className="mx-3 mt-2 p-2 rounded-md border border-amber-700/40 bg-amber-700/10 text-[11px] text-amber-200/90 flex items-start gap-2">
          <Headphones className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>Use headphones — otherwise PC audio leaks into your mic and gets transcribed twice.</span>
        </div>
      )}

      {/* Live transcript — always visible above the AI chat. */}
      <div className="border-b border-border bg-background/40 px-3 py-2 max-h-[40%] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-1">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Pending transcript
          </div>
          <div className="text-[10px] text-muted-foreground">
            {pendingTranscriptStatus}
          </div>
        </div>
        <div
          ref={transcriptViewRef}
          className="flex-1 min-h-[60px] overflow-y-auto text-xs leading-snug space-y-1"
        >
          {groupedTranscript.length === 0 && !partial && (
            <div className="text-muted-foreground/70 text-[11px] italic">
              {systemActive || micActive
                ? 'Waiting for audio…'
                : 'Transcription paused.'}
            </div>
          )}
          {groupedTranscript.map((turn) => (
            <div key={turn.id} className="flex gap-1.5">
              <span
                className={`text-[10px] shrink-0 mt-0.5 ${
                  turn.speaker === 'me' ? 'text-brand-400' : 'text-muted-foreground'
                }`}
              >
                {turn.speaker === 'me' ? 'You' : 'Them'}
              </span>
              <span className="text-foreground/90">{turn.text}</span>
            </div>
          ))}
          {partial && (
            <div className="flex gap-1.5 italic text-muted-foreground">
              <span className="text-[10px] shrink-0 mt-0.5 text-muted-foreground/70">Them</span>
              <span>{partial}</span>
            </div>
          )}
        </div>
      </div>

      {/* AI replies area */}
      <div ref={chatViewRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-3">
        {messages.length === 0 && (
          <div className="text-muted-foreground text-xs text-center pt-8">
            {audioMode === 'none'
              ? 'Audio is off — type a message or change the audio mode.'
              : autoGenerate
                ? 'Listening… AI replies when a question is detected.'
                : 'Listening… click Answer (or Ctrl+Shift+A) to reply.'}
          </div>
        )}
        {messages.map((m) => (
          <ChatBubble key={m.id} message={m} onCopy={() => copyMessage(m.text)} />
        ))}
      </div>

      {shotPreview && (
        <div className="mx-3 mb-2 flex items-center gap-2 rounded-md border border-border bg-card/50 p-2">
          <img
            src={shotPreview}
            alt="Captured screen"
            className="h-12 rounded border border-border"
          />
          <div className="flex-1 text-[11px] text-muted-foreground">
            Captured screen attached.
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShotPreview(null)}
            className="text-muted-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Bottom action bar: Answer + Clear + composer */}
      <div className="border-t border-border bg-background/60 px-2 py-2 flex items-center gap-1.5">
        {answering ? (
          <Button variant="destructive" size="sm" onClick={stopAnswer}>
            <Square className="h-3.5 w-3.5" />
            Stop
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="brand"
                size="sm"
                onClick={() => void submitToLlm()}
                disabled={!fullTranscriptText && !partial && !composer.trim() && !shotPreview}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Answer
              </Button>
            </TooltipTrigger>
            <TooltipContent>Answer now (Ctrl+Shift+A)</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              size="sm"
              onClick={clearBuffer}
              disabled={transcript.length === 0 && !partial}
            >
              <Eraser className="h-3.5 w-3.5" />
              Clear
            </Button>
          </TooltipTrigger>
          <TooltipContent>Clear pending transcript buffer (Ctrl+Shift+L)</TooltipContent>
        </Tooltip>

        <input
          className="flex-1 bg-primary h-8 rounded-xl border-transparent px-3 text-sm text-white placeholder:text-neutral-400 hover:bg-neutral-900 focus-visible:outline-none focus-visible:border-transparent focus-visible:ring-0"
          placeholder="Extra instruction…"
          value={composer}
          onChange={(e) => setComposer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submitToLlm()
            }
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void submitToLlm()}
          disabled={!composer.trim() && !fullTranscriptText && !partial && !shotPreview}
          title="Send"
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

function AudioModeSelector({
  value,
  onChange
}: {
  value: AudioMode
  onChange: (m: AudioMode) => void
}): JSX.Element {
  const Icon = value === 'mic' ? Mic : value === 'none' ? VolumeX : Volume2
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={value === 'none' ? 'secondary' : 'brand'}
          size="sm"
          className="min-w-[92px] justify-between"
        >
          <span className="flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5" />
            {AUDIO_MODE_LABEL[value]}
          </span>
          <ChevronDown className="h-3 w-3 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[180px]">
        <ModeItem mode="system" current={value} onChange={onChange} label="PC only" hint="Listen to whatever plays on the PC" />
        <ModeItem mode="mic" current={value} onChange={onChange} label="Mic only" hint="Listen only to your microphone" />
        <ModeItem mode="both" current={value} onChange={onChange} label="PC + Mic" hint="Both sources — use headphones" />
        <ModeItem mode="none" current={value} onChange={onChange} label="Audio off" hint="Type-only mode" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ModeItem({
  mode,
  current,
  onChange,
  label,
  hint
}: {
  mode: AudioMode
  current: AudioMode
  onChange: (m: AudioMode) => void
  label: string
  hint: string
}): JSX.Element {
  const active = mode === current
  return (
    <DropdownMenuItem onClick={() => onChange(mode)}>
      <div>
        <div className={`text-sm ${active ? 'text-brand-400 font-medium' : ''}`}>{label}</div>
        <div className="text-[11px] text-muted-foreground">{hint}</div>
      </div>
    </DropdownMenuItem>
  )
}

function ChatBubble({
  message,
  onCopy
}: {
  message: AiMessage
  onCopy: () => void
}): JSX.Element {
  return (
    <div className="rounded-lg bg-card/60 border border-border px-3 py-2 group">
      {message.imageUrl && (
        <div className="mb-2 flex justify-center">
          <img
            src={message.imageUrl}
            alt="Captured Screen"
            className="h-56 max-w-full rounded shadow-sm"
          />
        </div>
      )}
      <div className="text-sm leading-relaxed whitespace-pre-wrap">
        {message.text}
        {message.streaming && (
          <span className="inline-block w-2 h-4 bg-brand-400 ml-0.5 align-middle animate-pulse" />
        )}
      </div>
      {!message.streaming && message.text && (
        <div className="mt-1 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCopy}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy message</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  )
}

function StatusPill({
  connecting,
  live
}: {
  connecting: boolean
  live: boolean
}): JSX.Element {
  if (connecting) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-amber-300 px-2">
        <span className="w-1.5 h-1.5 bg-amber-300 rounded-full rec-dot" />
        Connecting
      </span>
    )
  }
  if (live) {
    return (
      <span className="flex items-center gap-1 text-[10px] text-red-400 px-2">
        <span className="w-1.5 h-1.5 bg-red-500 rounded-full rec-dot" />
        REC
      </span>
    )
  }
  return <span className="text-[10px] text-muted-foreground px-2">Idle</span>
}
