# Live Copilot

Overlay de escritorio privado, BYOK (bring-your-own-key), para asistir en
llamadas en directo. Captura audio del PC y/o microfono, lo transcribe, y genera
respuestas con el proveedor de IA que configures.

Todo se guarda localmente. La app no usa servidores intermedios propios: el audio
va al proveedor STT elegido y el prompt va al proveedor LLM elegido.

## Caracteristicas

- Ventana flotante sin marco, always-on-top, modo pill y posicion persistente.
- Menu de bandeja del sistema para mostrar, ocultar, alternar privacidad y lanzar
  acciones rapidas.
- Modo privado con `setContentProtection` para ocultar la ventana de capturas que
  respeten la proteccion del sistema operativo.
- Builds portables para Windows con datos locales junto al ejecutable portable.
- Claves API cifradas en disco con `safeStorage` de Electron cuando el sistema lo
  soporta.
- El renderer recibe las claves redactadas. Las llamadas LLM/STT y el listado de
  modelos se ejecutan por IPC en el proceso main, donde viven los secretos.
- Renderer con `sandbox` activo, CSP restrictiva y validacion de payloads IPC.
- Sesiones reutilizables con contexto libre, idioma, modelo, auto-respuesta,
  lenguaje simple y persistencia de transcript.
- Captura de audio por fuente: PC only, Mic only, PC + Mic o Audio off.
- STT configurable:
  - Speechmatics real-time por WebSocket.
  - Groq Whisper por chunks.
  - Endpoint OpenAI-compatible local/remoto para Whisper.
- LLM configurable:
  - OpenAI.
  - Anthropic.
  - Groq.
  - Cerebras.
  - Ollama local.
  - Cualquier endpoint OpenAI-compatible.
- Respuestas en streaming.
- Captura de pantalla con respuesta automatica y selector de monitor.
- Aviso previo si el modelo seleccionado no parece soportar imagenes.
- Transcript pendiente: al generar una respuesta, el texto usado como contexto se
  limpia del panel para que la siguiente respuesta no arrastre preguntas ya
  contestadas. El historico completo se conserva para guardado/exportacion si
  `Save transcript` esta activo.
- Atajos globales:
  - `Ctrl/Cmd+Shift+H`: alterna modo pill.
  - `Ctrl/Cmd+Shift+P`: alterna modo privado.
  - `Ctrl/Cmd+Shift+A`: genera respuesta.
  - `Ctrl/Cmd+Shift+S`: captura pantalla y genera respuesta.
  - `Ctrl/Cmd+Shift+L`: limpia transcript.

## Requisitos

- Windows 10/11 recomendado. macOS/Linux pueden requerir ajustes en captura de
  audio.
- Node.js 20+.
- Al menos un proveedor de IA configurado.
- Al menos un proveedor Speech-to-Text configurado si quieres transcripcion en
  directo.

## Desarrollo

```bash
cd entrevista-ai
npm install
npm run dev
```

El script `dev` limpia `ELECTRON_RUN_AS_NODE` antes de lanzar Electron, porque
esa variable hace que `electron.exe` se comporte como Node y rompe el proceso
main.

## Verificacion

```bash
npm run check
```

Tambien puedes ejecutar cada paso por separado:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

## Build de Windows

```bash
npm run dist:win
```

El instalador queda en `dist/`.

El build de produccion ejecuta una fase `protect` despues de `electron-vite
build`: minifica, elimina sourcemaps y ofusca los bundles JavaScript antes de
empaquetar con `asar`.

## Build portable de Windows

```bash
npm run dist:portable
```

El ejecutable portable queda en `dist/`. Cuando se ejecuta ese build, la app usa
la variable `PORTABLE_EXECUTABLE_DIR` del launcher portable y guarda datos en una
carpeta `Live Copilot Data` junto al `.exe`, en vez de usar `%APPDATA%`.

Tambien puedes forzar modo portable manualmente:

```bash
Live Copilot.exe --portable
Live Copilot.exe --portable-data-dir="D:\Apps\LiveCopilotData"
```

Para generar directamente una carpeta lista para distribuir:

```bash
npm run release:portable
```

La carpeta queda en `release/Live Copilot <version> Portable/` e incluye el
ejecutable, `LEEME.txt` y `SHA256SUMS.txt`.

## Firma de Windows

El build normal puede ser unsigned. Para reducir avisos de Windows SmartScreen
en distribucion real, usa un build firmado:

```bash
npm run release:portable:signed
```

En Windows local, la firma puede requerir ejecutar la terminal como administrador
o tener Developer Mode activo, porque `electron-builder` extrae herramientas con
symlinks. En GitHub Actions `windows-latest` suele ser el camino mas limpio.

Hay dos rutas soportadas:

### Azure Artifact Signing

Recomendado si quieres CI sin manejar certificados privados localmente.
Configura en el entorno:

```powershell
$env:WINDOWS_SIGNING_MODE="azure"
$env:AZURE_SIGNING_ENDPOINT="https://<region>.codesigning.azure.net/"
$env:AZURE_SIGNING_ACCOUNT="<account-name>"
$env:AZURE_SIGNING_PROFILE="<certificate-profile-name>"
$env:AZURE_SIGNING_PUBLISHER="<publisher-name>"
```

Tambien debes autenticar contra Microsoft Entra ID con las variables/credenciales
que use tu pipeline de Azure o GitHub Actions.

### Certificado PFX Authenticode

Configura las variables que usa `electron-builder`:

```powershell
$env:CSC_LINK="C:\secure\certificate.pfx"
$env:CSC_KEY_PASSWORD="<pfx-password>"
npm run release:portable:signed
```

En CI, `CSC_LINK` puede ser el certificado codificado en base64 o una URL
privada al PFX. No subas el certificado ni su password al repo.

## Privacidad en Windows

El modo privado usa la proteccion de captura que ofrece Electron/Windows y la
ventana no aparece en la barra de tareas. Esto reduce exposicion accidental en
capturas compatibles, pero no es una garantia contra herramientas de
monitorizacion, seguridad o grabacion que operen con permisos elevados.

La app esta pensada como asistente privado/BYOK para flujos consentidos. No se
debe presentar como una garantia de invisibilidad ni como sustituto de politicas
claras de uso en llamadas, reuniones o procesos de seleccion.

## Flujo de uso

1. Abre la app.
2. En Settings, crea un perfil de IA. Ollama no requiere API key; los proveedores
   cloud si.
3. Crea un perfil STT. Groq Whisper es sencillo de configurar; Speechmatics da
   mejor experiencia real-time.
4. En Create, escribe el contexto que el modelo debe conocer y selecciona idioma.
5. Inicia la sesion.
6. Elige fuente de audio en la barra superior.
7. Usa Answer para generar una respuesta, o activa Auto-respond para que se
   dispare cuando la ultima intervencion parezca una pregunta.

## Datos locales

Electron guarda datos en `app.getPath('userData')`, normalmente:

```text
%APPDATA%/Live Copilot/settings.json
%APPDATA%/Live Copilot/sessions.json
```

`settings.json` contiene providers y claves API cifradas cuando `safeStorage`
esta disponible. Es una decision BYOK local; no subas ese archivo ni lo
compartas.

La UI no vuelve a recibir claves ya guardadas. Si editas un perfil con una clave
existente, el campo aparece vacio y puedes escribir una nueva clave para
reemplazarla; si lo dejas vacio, se conserva la clave cifrada que ya estaba en
disco.

En build portable, `userData` apunta a `Live Copilot Data` junto al ejecutable.

Las claves nuevas se guardan cifradas con prefijo `enc:v1:` cuando `safeStorage`
esta disponible. Si ya tenias claves en claro, se migran al siguiente arranque.

## Distribucion privada

El codigo y los binarios se distribuyen bajo licencia propietaria. El repo
incluye `LICENSE`, `CHANGELOG.md` y un workflow de GitHub Actions para generar
el portable de Windows en repos privados.

## Notas tecnicas

- La captura de audio usa `getDisplayMedia` para loopback y `getUserMedia` para
  microfono.
- El audio se convierte a PCM Int16 mono a 16 kHz mediante `AudioWorklet`.
- Speechmatics recibe PCM binario por WebSocket.
- Whisper chunked envuelve el PCM en WAV y llama a `/audio/transcriptions`.
- Los providers LLM OpenAI-compatible se llaman por `/chat/completions` con
  `stream: true`.
