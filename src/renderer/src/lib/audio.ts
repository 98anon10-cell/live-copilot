// Captura PCM Int16 mono a 16 kHz desde dos fuentes:
// - loopback del sistema (lo que suena en el PC) via getDisplayMedia + audio:'loopback'
// - micrófono local via getUserMedia
// Ambas alimentan a Speechmatics, que espera PCM raw 16-bit little-endian.
import { logger } from './logger'

export interface AudioCaptureHandle {
  stop: () => void
}

interface DownsamplerGraph {
  worklet: AudioWorkletNode
  sink: GainNode
}

const DOWNSAMPLER_WORKLET = `
  class DownsamplerProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      this.targetRate = options.processorOptions.targetRate;
      this.inputRate = sampleRate;
      this.ratio = this.inputRate / this.targetRate;
      this.accum = 0;
      this.buffer = [];
    }
    process(inputs) {
      const input = inputs[0];
      if (!input || input.length === 0) return true;
      const ch0 = input[0];
      const ch1 = input[1];
      const mono = new Float32Array(ch0.length);
      if (ch1) {
        for (let i = 0; i < ch0.length; i++) mono[i] = (ch0[i] + ch1[i]) * 0.5;
      } else {
        mono.set(ch0);
      }
      for (let i = 0; i < mono.length; i++) {
        this.accum += 1;
        if (this.accum >= this.ratio) {
          this.accum -= this.ratio;
          let s = mono[i];
          if (s > 1) s = 1; else if (s < -1) s = -1;
          this.buffer.push(s < 0 ? s * 0x8000 : s * 0x7fff);
        }
      }
      if (this.buffer.length >= 1600) {
        const out = new Int16Array(this.buffer.length);
        for (let i = 0; i < this.buffer.length; i++) out[i] = this.buffer[i] | 0;
        this.port.postMessage(out, [out.buffer]);
        this.buffer = [];
      }
      return true;
    }
  }
  registerProcessor('downsampler', DownsamplerProcessor);
`

async function attachDownsampler(
  audioContext: AudioContext,
  source: MediaStreamAudioSourceNode,
  onPcmChunk: (int16: Int16Array) => void
): Promise<DownsamplerGraph> {
  const blob = new Blob([DOWNSAMPLER_WORKLET], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  await audioContext.audioWorklet.addModule(url)
  URL.revokeObjectURL(url)
  const worklet = new AudioWorkletNode(audioContext, 'downsampler', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { targetRate: 16000 }
  })
  worklet.port.onmessage = (e) => onPcmChunk(e.data as Int16Array)
  const sink = audioContext.createGain()
  sink.gain.value = 0
  source.connect(worklet)
  // A WebAudio graph is pull-driven. Keep the worklet connected to a silent
  // destination so Chromium keeps processing without playing captured audio.
  worklet.connect(sink)
  sink.connect(audioContext.destination)
  return { worklet, sink }
}

export async function startMicrophonePcmCapture(
  onPcmChunk: (int16: Int16Array) => void,
  onError: (err: Error) => void
): Promise<AudioCaptureHandle> {
  let mediaStream: MediaStream | null = null
  let audioContext: AudioContext | null = null
  let sourceNode: MediaStreamAudioSourceNode | null = null
  let workletNode: AudioWorkletNode | null = null
  let sinkNode: GainNode | null = null

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      },
      video: false
    })

    audioContext = new AudioContext({ sampleRate: 48000 })
    if (audioContext.state === 'suspended') await audioContext.resume()
    sourceNode = audioContext.createMediaStreamSource(mediaStream)
    const graph = await attachDownsampler(audioContext, sourceNode, onPcmChunk)
    workletNode = graph.worklet
    sinkNode = graph.sink
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    onError(error)
    throw error
  }

  return {
    stop: () => {
      try {
        workletNode?.disconnect()
        sinkNode?.disconnect()
        sourceNode?.disconnect()
        audioContext?.close()
        mediaStream?.getTracks().forEach((t) => t.stop())
      } catch (e) {
        logger.error('Error closing mic capture', e)
      }
    }
  }
}

export async function startLoopbackPcmCapture(
  onPcmChunk: (int16: Int16Array) => void,
  onError: (err: Error) => void
): Promise<AudioCaptureHandle> {
  let mediaStream: MediaStream | null = null
  let audioContext: AudioContext | null = null
  let sourceNode: MediaStreamAudioSourceNode | null = null
  let workletNode: AudioWorkletNode | null = null
  let sinkNode: GainNode | null = null

  try {
    logger.debug('[audio] requesting getDisplayMedia (loopback)')
    // En Electron con setDisplayMediaRequestHandler + audio:'loopback',
    // getDisplayMedia retorna tanto video como audio del sistema.
    mediaStream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: {
        width: { ideal: 320 },
        height: { ideal: 180 },
        frameRate: { ideal: 1 }
      }
    })
    logger.debug('[audio] getDisplayMedia returned', {
      videoTracks: mediaStream.getVideoTracks().length,
      audioTracks: mediaStream.getAudioTracks().length
    })

    // Mantenemos el track de vídeo vivo (Electron lo necesita para que el loopback audio
    // siga activo) pero lo silenciamos: no se pinta, no se escucha, sólo sirve de soporte.
    mediaStream.getVideoTracks().forEach((t) => {
      t.enabled = false
    })

    const audioTracks = mediaStream.getAudioTracks()
    if (audioTracks.length === 0) {
      throw new Error(
        'getDisplayMedia returned no audio track. Loopback handler may not be active.'
      )
    }

    audioContext = new AudioContext({ sampleRate: 48000 })
    if (audioContext.state === 'suspended') await audioContext.resume()
    sourceNode = audioContext.createMediaStreamSource(new MediaStream([audioTracks[0]]))
    const graph = await attachDownsampler(audioContext, sourceNode, onPcmChunk)
    workletNode = graph.worklet
    sinkNode = graph.sink
    logger.debug('[audio] downsampler attached, capturing PCM 16k mono')
  } catch (err) {
    logger.error('[audio] startLoopbackPcmCapture error:', err)
    const error = err instanceof Error ? err : new Error(String(err))
    onError(error)
    throw error
  }

  return {
    stop: () => {
      try {
        workletNode?.disconnect()
        sinkNode?.disconnect()
        sourceNode?.disconnect()
        audioContext?.close()
        mediaStream?.getTracks().forEach((t) => t.stop())
      } catch (e) {
        logger.error('Error closing capture', e)
      }
    }
  }
}
