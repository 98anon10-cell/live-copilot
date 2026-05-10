import { useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, Sparkles } from 'lucide-react'
import type { AiProviderKind, SttProviderKind } from '../../../shared/types'

interface GuideStep {
  text: ReactNode
}

interface Guide {
  title: string
  free: 'gratis' | 'tier free' | 'pago'
  /** One-line summary shown above the steps. */
  intro?: ReactNode
  steps: GuideStep[]
}

const AI_GUIDES: Partial<Record<AiProviderKind, Guide>> = {
  ollama: {
    title: 'Ollama (local)',
    free: 'gratis',
    intro: <>LLM corriendo en tu máquina. Privado, sin internet, sin coste.</>,
    steps: [
      {
        text: (
          <>
            <b>Instalar Ollama</b> desde{' '}
            <ExternalLinkA href="https://ollama.com/download" />. Tras instalar, queda corriendo
            como servicio en <Code>localhost:11434</Code>. En Windows verás el icono en la bandeja.
          </>
        )
      },
      {
        text: (
          <>
            <b>Descargar uno o varios modelos</b>. Abre una terminal y ejecuta el comando
            según el modelo. Cuanto más grande el modelo más RAM/VRAM consume, pero mejor
            calidad:
            <CodeBlock>{`# Equilibrado, ~5 GB
ollama pull qwen3:8b

# Más capaz, ~9 GB
ollama pull qwen3:14b

# Llama 3.1 8B (~5 GB)
ollama pull llama3.1:8b

# Modelos rápidos para CPU sin GPU (~2 GB)
ollama pull llama3.2:3b
ollama pull qwen3:1.7b`}</CodeBlock>
          </>
        )
      },
      {
        text: (
          <>
            <b>Comprobar lo que tienes</b>:
            <CodeBlock>ollama list</CodeBlock>
            Anota los nombres exactos (incluyendo el tag <Code>:8b</Code>, <Code>:14b</Code>, etc.).
          </>
        )
      },
      {
        text: (
          <>
            <b>En esta app</b>: deja <b>Base URL</b> y <b>API key</b> vacíos. En <b>Model</b>{' '}
            pulsa <b>Detect installed</b> para listar los que tienes en Ollama, o escríbelo —
            ej. <Code>qwen3:14b</Code>. Si quieres tener varios modelos a mano, crea un perfil
            por cada uno y dales nombres como <Code>Qwen 14b</Code>, <Code>Qwen 8b</Code>.
          </>
        )
      },
      {
        text: (
          <>
            <b>Requisitos de RAM/VRAM</b> aproximados: 3B → 4 GB · 8B → 8 GB · 14B → 12 GB ·
            70B → 48 GB. Sin GPU funciona en CPU (más lento).
          </>
        )
      }
    ]
  },
  openai: {
    title: 'OpenAI',
    free: 'pago',
    intro: <>Cloud. Más capaz pero pagas por token.</>,
    steps: [
      {
        text: (
          <>
            Crea una cuenta y saca una API key en{' '}
            <ExternalLinkA href="https://platform.openai.com/api-keys" />. Tienes que añadir
            crédito (mínimo 5 USD).
          </>
        )
      },
      { text: <>Pega la key en <b>API key</b>. Deja <b>Base URL</b> vacío.</> },
      {
        text: (
          <>
            <b>Model</b> recomendado: <Code>gpt-4o-mini</Code> (rápido y barato) o{' '}
            <Code>gpt-4o</Code> (más capaz). Crea un perfil por cada modelo si quieres
            cambiar rápido entre ellos.
          </>
        )
      }
    ]
  },
  anthropic: {
    title: 'Anthropic Claude',
    free: 'pago',
    intro: <>Claude — calidad alta, especialmente bueno para razonamiento y código.</>,
    steps: [
      {
        text: (
          <>
            Crea cuenta y saca key en{' '}
            <ExternalLinkA href="https://console.anthropic.com/settings/keys" />. Compras
            crédito (mínimo 5 USD).
          </>
        )
      },
      { text: <>Pega la key en <b>API key</b>. Deja <b>Base URL</b> vacío.</> },
      {
        text: (
          <>
            <b>Model</b>: <Code>claude-haiku-4-5</Code> (rápido/barato),{' '}
            <Code>claude-sonnet-4-6</Code> (equilibrio) o <Code>claude-opus-4-7</Code> (el
            más capaz). Un perfil por modelo.
          </>
        )
      }
    ]
  },
  groq: {
    title: 'Groq',
    free: 'tier free',
    intro: (
      <>
        Inferencia ultrarrápida en LPU. Tier <b>gratis</b> generoso (rate-limit por minuto)
        sin tarjeta.
      </>
    ),
    steps: [
      {
        text: (
          <>
            Crea cuenta y saca key gratis en{' '}
            <ExternalLinkA href="https://console.groq.com/keys" />.
          </>
        )
      },
      { text: <>Pega la key en <b>API key</b>. Deja <b>Base URL</b> vacío.</> },
      {
        text: (
          <>
            <b>Model</b> populares: <Code>llama-3.3-70b-versatile</Code>,{' '}
            <Code>openai/gpt-oss-120b</Code>, <Code>qwen/qwen3-32b</Code>. Las respuestas
            salen literalmente en milisegundos.
          </>
        )
      }
    ]
  },
  cerebras: {
    title: 'Cerebras',
    free: 'tier free',
    intro: <>Aún más rápido que Groq. Tier free disponible.</>,
    steps: [
      {
        text: (
          <>
            API key gratis en <ExternalLinkA href="https://cloud.cerebras.ai/" />.
          </>
        )
      },
      { text: <>Pega la key en <b>API key</b>. Deja <b>Base URL</b> vacío.</> },
      {
        text: (
          <>
            <b>Model</b>: <Code>llama-3.3-70b</Code> o{' '}
            <Code>qwen-3-235b-a22b-instruct-2507</Code>.
          </>
        )
      }
    ]
  },
  custom: {
    title: 'OpenAI-compatible',
    free: 'gratis',
    intro: (
      <>
        Cualquier endpoint que hable la API de OpenAI: vLLM, LM Studio, llamafile, OpenRouter,
        text-generation-webui, LocalAI, etc.
      </>
    ),
    steps: [
      {
        text: (
          <>
            <b>Levanta tu servidor</b> compatible con <Code>/v1/chat/completions</Code>.
            Ejemplos:
            <ul className="list-disc pl-4 mt-1 space-y-0.5">
              <li>
                <ExternalLinkA href="https://lmstudio.ai/">LM Studio</ExternalLinkA>: GUI, click
                en "Start server" → expone <Code>http://localhost:1234/v1</Code>.
              </li>
              <li>
                <ExternalLinkA href="https://github.com/vllm-project/vllm">vLLM</ExternalLinkA>:{' '}
                <Code>vllm serve &lt;modelo&gt; --port 8000</Code>.
              </li>
              <li>
                <ExternalLinkA href="https://openrouter.ai/">OpenRouter</ExternalLinkA>: cloud,
                acceso a 100+ modelos con una sola key.
              </li>
            </ul>
          </>
        )
      },
      {
        text: (
          <>
            Pon la <b>Base URL</b> completa con <Code>/v1</Code> al final — ej.{' '}
            <Code>http://localhost:1234/v1</Code> (LM Studio) o{' '}
            <Code>https://openrouter.ai/api/v1</Code>.
          </>
        )
      },
      { text: <>API key: pon la del servicio si la requiere. Si es local, vacía.</> },
      { text: <>En <b>Model</b> escribe el nombre exacto que ese servidor expone.</> }
    ]
  }
}

const STT_GUIDES: Record<SttProviderKind, Guide> = {
  speechmatics: {
    title: 'Speechmatics (real-time)',
    free: 'tier free',
    intro: (
      <>
        Mejor latencia para directo (~500 ms con parciales). <b>8 horas/mes gratis</b> sin
        tarjeta.
      </>
    ),
    steps: [
      {
        text: (
          <>
            Crea cuenta y saca API key en{' '}
            <ExternalLinkA href="https://portal.speechmatics.com/api-keys/" />.
          </>
        )
      },
      { text: <>Pega la key en <b>API key</b>. Deja <b>Base URL</b> vacío.</> },
      {
        text: (
          <>
            <b>Model</b>: <Code>enhanced</Code> (recomendado, más preciso) o{' '}
            <Code>standard</Code> (más rápido).
          </>
        )
      },
      {
        text: (
          <>
            La transcripción es <b>real-time vía WebSocket</b> con parciales mientras hablas
            — la mejor experiencia para una entrevista.
          </>
        )
      }
    ]
  },
  'groq-whisper': {
    title: 'Groq Whisper',
    free: 'gratis',
    intro: (
      <>
        Whisper alojado en Groq, <b>gratis</b>, latencia ~300 ms por chunk. La misma key
        sirve para LLM si configuras Groq como AI.
      </>
    ),
    steps: [
      {
        text: (
          <>
            Saca API key gratis en{' '}
            <ExternalLinkA href="https://console.groq.com/keys" />.
          </>
        )
      },
      { text: <>Pega la key en <b>API key</b>. Deja <b>Base URL</b> vacío.</> },
      {
        text: (
          <>
            <b>Model</b>:
            <CodeBlock>{`whisper-large-v3-turbo`}</CodeBlock>
            Alternativas: <Code>whisper-large-v3</Code> (más preciso, más lento) o{' '}
            <Code>distil-whisper-large-v3-en</Code> (solo inglés, ultra-rápido).
          </>
        )
      },
      {
        text: (
          <>
            La app trocea el audio en chunks de 3 s y los manda al endpoint
            <Code>/audio/transcriptions</Code>. Latencia total: ~3 s por bloque.
          </>
        )
      }
    ]
  },
  'openai-compatible': {
    title: 'Whisper local (OpenAI-compatible)',
    free: 'gratis',
    intro: (
      <>
        Whisper corriendo en tu máquina. <b>Privacidad total + gratis</b>. La latencia depende
        de tu hardware.
      </>
    ),
    steps: [
      {
        text: (
          <>
            <b>Elige un servidor</b>:
            <ul className="list-disc pl-4 mt-1 space-y-0.5">
              <li>
                <ExternalLinkA href="https://github.com/fedirz/faster-whisper-server">
                  faster-whisper-server
                </ExternalLinkA>
                : el más rápido si tienes GPU. Soporta CUDA.
              </li>
              <li>
                <ExternalLinkA href="https://github.com/ggerganov/whisper.cpp">
                  whisper.cpp
                </ExternalLinkA>
                : ligero, solo CPU, perfecto sin GPU.
              </li>
              <li>
                <ExternalLinkA href="https://github.com/mudler/LocalAI">LocalAI</ExternalLinkA>:
                sirve LLM + Whisper a la vez.
              </li>
            </ul>
          </>
        )
      },
      {
        text: (
          <>
            <b>Opción A — faster-whisper-server con Docker</b> (recomendado si tienes GPU):
            <CodeBlock>{`# CPU
docker run -d --name fws -p 8000:8000 fedirz/faster-whisper-server:latest-cpu

# GPU (CUDA)
docker run -d --name fws --gpus all -p 8000:8000 fedirz/faster-whisper-server:latest-cuda`}</CodeBlock>
            URL: <Code>http://localhost:8000/v1</Code> · Model:{' '}
            <Code>Systran/faster-whisper-large-v3</Code> o
            <Code>Systran/faster-whisper-base</Code> (más rápido).
          </>
        )
      },
      {
        text: (
          <>
            <b>Opción B — whisper.cpp</b> (Windows/macOS/Linux, solo CPU):
            <CodeBlock>{`git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp
make
# Descarga un modelo (base ~150 MB, small ~500 MB, medium ~1.5 GB)
sh ./models/download-ggml-model.sh base
# Servidor compatible OpenAI
./server -m models/ggml-base.bin --port 8080 --inference-path /v1/audio/transcriptions`}</CodeBlock>
            URL: <Code>http://localhost:8080/v1</Code> · Model: <Code>whisper-1</Code>{' '}
            (lo ignora pero se requiere por la API).
          </>
        )
      },
      {
        text: (
          <>
            <b>En la app</b>: kind <b>OpenAI-compatible</b> · Base URL del servidor con{' '}
            <Code>/v1</Code> al final · API key vacía · Model según el servidor.
          </>
        )
      },
      {
        text: (
          <>
            <b>Latencia esperada</b>: en GPU (RTX) ~200 ms por chunk. En CPU moderna con{' '}
            <Code>base</Code>: ~1–2 s. Modelos más grandes son más precisos pero más lentos.
          </>
        )
      }
    ]
  }
}

export function AiProviderGuide({ kind }: { kind: AiProviderKind }): JSX.Element | null {
  const guide = AI_GUIDES[kind]
  if (!guide) return null
  return <Collapsible guide={guide} />
}

export function SttProviderGuide({ kind }: { kind: SttProviderKind }): JSX.Element | null {
  const guide = STT_GUIDES[kind]
  if (!guide) return null
  return <Collapsible guide={guide} />
}

function Collapsible({ guide }: { guide: Guide }): JSX.Element {
  const [open, setOpen] = useState(false)
  const badgeColor =
    guide.free === 'gratis'
      ? 'bg-brand/15 text-brand-400'
      : guide.free === 'tier free'
        ? 'bg-amber-700/20 text-amber-300'
        : 'bg-secondary text-muted-foreground'
  return (
    <div className="rounded-md border border-brand-700/40 bg-brand/5 mt-2">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-brand-400" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-brand-400" />
        )}
        <Sparkles className="h-3 w-3 text-brand-400" />
        <span className="text-xs font-medium">Cómo configurar {guide.title}</span>
        <span
          className={`ml-auto text-[10px] uppercase tracking-wide rounded-full px-1.5 py-0.5 ${badgeColor}`}
        >
          {guide.free}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2">
          {guide.intro && (
            <p className="text-[12px] text-foreground/85 leading-relaxed">{guide.intro}</p>
          )}
          <ol className="text-[12px] text-foreground/85 space-y-2 pl-5 list-decimal leading-relaxed">
            {guide.steps.map((step, i) => (
              <li key={i}>{step.text}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

function ExternalLinkA({
  href,
  children
}: {
  href: string
  children?: ReactNode
}): JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-0.5 text-brand-400 hover:underline"
    >
      {children ?? href.replace(/^https?:\/\//, '')}
      <ExternalLink className="h-3 w-3" />
    </a>
  )
}

function Code({ children }: { children: ReactNode }): JSX.Element {
  return (
    <code className="px-1 py-0.5 rounded bg-secondary/70 font-mono text-[11px]">{children}</code>
  )
}

function CodeBlock({ children }: { children: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  function copy(): void {
    navigator.clipboard
      .writeText(children)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      })
      .catch(() => {})
  }
  return (
    <div className="relative mt-1 group">
      <pre className="rounded-md bg-secondary/60 px-2 py-1.5 text-[11px] font-mono overflow-x-auto whitespace-pre">
        {children}
      </pre>
      <button
        type="button"
        onClick={copy}
        title={copied ? 'Copied' : 'Copy'}
        className="absolute top-1 right-1 inline-flex items-center justify-center h-5 w-5 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground"
      >
        {copied ? <Check className="h-3 w-3 text-brand-400" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  )
}
