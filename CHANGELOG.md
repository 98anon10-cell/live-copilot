# Changelog

## 0.1.0

- Moved LLM, STT and model-listing calls behind IPC in the main process so saved
  API keys are not exposed back to the renderer.
- Added renderer-safe key redaction with `hasApiKey` flags for existing profiles.
- Enabled renderer sandboxing and tightened the production Content Security
  Policy.
- Added runtime validation/sanitization for settings, sessions, chat requests,
  STT requests and window IPC payloads.
- Hardened job-post scraping with HTTP(S)-only validation, private-address
  blocking, content-type checks and request timeouts.
- Added ESLint, Vitest and `npm run check`.
- Added focused tests for validation, question detection and prompt builders.
- Disabled production console output during protected builds and routed renderer
  debug logging through a dev-only logger.
- Added Windows portable build.
- Added portable data directory support.
- Added screenshot-to-answer flow.
- Added capture-display selector.
- Added queued auto-answering for consecutive question blocks, with compact
  conversation memory so later answers keep context without sending the full
  transcript.
- Added global screenshot answer shortcut.
- Added tray menu for show, pill mode, privacy, always-on-top and quick actions.
- Added local API key encryption with Electron safeStorage.
- Added app icons for Windows packaging and tray.
- Added pending transcript cleanup after each answer.
- Switched distribution metadata to PolyForm Noncommercial 1.0.0.
- Added protected production build step with JavaScript obfuscation and no sourcemaps.
