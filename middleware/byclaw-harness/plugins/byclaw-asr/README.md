# ByClaw ASR

`@byclaw/byclaw-asr` provides an infrastructure transcription service and provider adapters. It registers no model-visible tool. The Harness integration transcribes tagged voice input before routing or admitting the main Agent, resolves the enabled global default `ASR` model, and passes the recognized text as `userInput` with `voiceInteraction: true`.

The first supported provider is VolcEngine flash recording recognition:

- Provider `VOLCENGINE`, protocol `VOLCENGINE_ASR` (also `VOLCENGINE_ASR_FLASH`).
- HTTPS endpoint `https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash` (a base endpoint also works).
- Model code `bigmodel`; resource `volc.bigasr.auc_turbo` by default.
- New authentication uses `authToken` / `X-Api-Key`. Legacy authentication uses configured `X-Api-App-Key` and `X-Api-Access-Key` (or `options.appKey` and `options.accessKey`). TTS credentials and entitlements are separate.
- Requests carry MP3 audio as base64, `request.model_name: bigmodel`, a fresh request UUID and sequence `-1`. Both HTTP success and `X-Api-Status-Code: 20000000` are required; the transcript comes from `result.text`.

`transcribeAudio(model, bytes, { signal, fetch })` accepts bounded MP3 input (12 MiB maximum) and returns `{ text, provider, model }`. Unsupported providers/protocols, empty transcripts and vendor errors fail explicitly. Credentials and vendor bodies are never included in runtime errors. `fetch` is an infrastructure test seam, not a model/tool parameter.

Voice commands use `extraPayload.messageType: 'VOICE'` and `extraPayload.voice`, also accepted under `extraPayload.ext_params`. The authenticated backend resolves the uploaded file's ownership and supplies `voice.audioBase64`; a server-owned `/by/` file path is also supported. Arbitrary remote file URLs are rejected. By-framework 1.6.0 requires a nonempty wire `content`; SDK bridges use the neutral `[语音消息]` placeholder for otherwise audio-only commands. The placeholder is replaced by the transcript before the Agent starts.

Raw audio is persisted in the authoritative `session_root/asr/`. A digest of message ID and audio identifies a durable transcript cache; repeated delivery reuses it. Session roots and source audio paths reject traversal and symlink escapes. Cancellation applies during ASR, before Agent admission, and during TTS.

After a voice turn, the Agent's normal response is retained and its `<voice_summary>` text is synthesized with the configured TTS model. The runtime removes the summary marker and appends a managed MP3 artifact link; speech artifacts remain under `session_root/tts/`, and generated images remain under `session_root/image/`. A missing or failed TTS configuration preserves the text answer with a brief unavailable notice. Without an explicit summary, a bounded plain-text extract is used.

For manual transcription, the authenticated BE proxies `POST /api/byclaw/asr/transcribe` to the user's Harness instance. Body: `{ audioBase64, mimeType: 'audio/mpeg', fileName?, sessionId? }`; result: `{ text, provider, model }`. The route compares `Beyond-Token` against the current user's Redis login token. Model-management debug requests may additionally pass `{ debug: true, model: MediaModel }`; the BE must authorize model-management access before forwarding explicit credentials. No credential or endpoint is accepted through an LLM tool.

Sandbox discovery may return a console entry such as `/chat?token=...`, rather than an API base. The BE removes only the terminal `/chat` (including an optional trailing slash) before appending ASR/TTS API paths, preserving gateway path prefixes and authentication query parameters. Appending the API to the console path returns HTTP 405 and must not be interpreted as a provider outage.

Local checks: `pnpm test` for adapter protocol tests. In the DSH workspace, run `pnpm --filter @byclaw/dsh-integration build` and `node --import tsx/esm plugins/byclaw-integration/scripts/voice-runtime-verify.mjs`. Provider network calls and entitlements require separate live verification.

VolcEngine no-speech statuses `20000003` and `45000002` produce `ASR_SPEECH_NOT_DETECTED`, including when paired with HTTP 4xx. The proxy returns HTTP 422 with “未识别到语音，请靠近麦克风后重试”; voice-message processing emits the same user guidance before Agent admission. Other vendor rejection details remain redacted.
