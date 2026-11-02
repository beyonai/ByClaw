# ByClaw TTS

Cordis bundle `@byclaw/byclaw-tts` provides `text_to_speech`. Trusted integration resolves the enabled model and authoritative `session_root`; the shared media runtime writes unique artifacts beneath `<session_root>/tts/`. Tool callers cannot supply endpoints, credentials, headers, or filesystem paths.

The independent adapter API is:

```js
import { generateSpeech } from '@byclaw/byclaw-tts/adapters';
const assets = await generateSpeech(model, { text, voice, format, speed }, { signal });
// assets: Array<{ bytes: Uint8Array, mimeType: string }>
```

`model` contains `provider`, `model`, optional `protocol`, `endpoint`, `apiKey`, `headers`, and `options`. These values must come from trusted server configuration. `signal` must combine the caller's cancellation and configured request timeout; the tool/runtime owns that deadline. Optional injected `fetch` exists for contract tests. Generation is never retried automatically.

## Provider contracts

| Provider | Native API / model family | Formats and configuration |
| --- | --- | --- |
| OPENAI | `/v1/audio/speech`, `tts-1`, `tts-1-hd`, `gpt-4o-mini-tts` | MP3 default; WAV/PCM/AAC; `options.voice` (default alloy), speed 0.25–4; optional instructions |
| OPENROUTER | `/api/v1/audio/speech`, routed TTS model slug such as `openai/gpt-4o-mini-tts` | MP3 default; PCM only for documented OpenAI / Microsoft MAI Voice model families; voice required; speed only for a model that supports it; optional trusted `options.routing` and instructions |
| TOGETHER | `/v1/audio/speech`, Cartesia Sonic, Kokoro, Orpheus | WAV default or MP3; model-specific voice required; optional language/sampleRate/bitRate; speed adjustments return a warning and use the provider default |
| ZAI | Bigmodel `/api/paas/v4/audio/speech`, `glm-tts` | WAV default or PCM; tongtong default voice; speed 0.5–2, optional volume; 1,024 characters |
| QWEN | DashScope `/api/v1/services/aigc/multimodal-generation/generation`, HTTP Qwen-TTS and Qwen3-TTS | WAV; Cherry default voice; `languageType` defaults Auto; 600 characters; speed adjustments return a warning and use the provider default; realtime WebSocket models explicitly rejected |
| MINIMAX | `/v1/t2a_v2`, `speech-*` | MP3 default, WAV/PCM; voice required; speed 0.5–2; optional vol/pitch/emotion/sampleRate/bitrate/channel/languageBoost |
| VOLCENGINE | `/api/v3/tts/unidirectional` or explicitly configured `/sse` | MP3 default, WAV/PCM; configured speaker required; resource/version mapping below |

Aliases: CHATGPT → OPENAI, DOUBAO/ARK → VOLCENGINE, ZHIPU → ZAI. Provider selects the native speech adapter. Explicit speech protocols are `<PROVIDER>_TTS` or `<PROVIDER>_SPEECH`; Qwen additionally accepts `DASHSCOPE_TTS`, Volcengine `VOLCENGINE_TTS_V3`. Endpoints may be an API base or its complete documented endpoint.

The existing TTS frontend reuses the LLM protocol choices (`OpenAI`, `OpenAI Responses`, `Anthropic`, `Qwen`) and permits clearing the field. Saved configurations use this explicit compatibility matrix:

| Provider | Accepted existing frontend protocol values |
| --- | --- |
| OpenAI, OpenRouter, Together, ZAI | empty or `OpenAI` |
| Qwen | empty, `Qwen`, or legacy `OpenAI` |
| MiniMax, Volcengine | empty or legacy `OpenAI` |

The legacy `OpenAI` label is accepted as frontend metadata; it never changes Qwen, MiniMax, or Volcengine into an OpenAI-compatible request. `Anthropic` and `OpenAI Responses` are rejected for speech, and `Qwen` is rejected on other providers. Internal speech protocol/provider conflicts still reject before HTTP. A record whose provider itself is mislabeled needs an explicit trusted deployment correction; the adapter does not infer provider from endpoint host.

Anthropic, DeepSeek, and APK are explicitly **unsupported speech capabilities**. Their presence in the generic frontend supplier dictionary does not establish a speech API; they fail before network calls. No generic OpenAI-compatible fallback is applied to unknown providers. Provider registry membership means an implemented protocol, not that every model on that provider can synthesize speech.

## Seed TTS 2.0

`doubao-seed-tts-2.0` maps to the header `X-Api-Resource-Id: seed-tts-2.0`. It is not sent as an OpenAI `model` field. Set `options.speaker` (or `options.voice`) to a voice enabled for that resource, such as the documented `zh_female_vv_uranus_bigtts`; no voice is silently selected. Voice authorization and resource compatibility are ultimately validated by the provider.

New authentication uses `apiKey` as `X-Api-Key`. Legacy authentication accepts either trusted `X-Api-App-Id` / `X-Api-Access-Key` headers or `options.appId` / `options.accessKey` (when appId is supplied, `apiKey` can supply the legacy access key). Bearer auth is not used for Volcengine speech. In legacy mode, any `X-Api-Key` is removed.

`options.resourceId` explicitly selects another supported resource. For the exact business model `doubao-seed-tts-2.0`, only `seed-tts-2.0` and clone resource `seed-icl-2.0` are accepted. A cloned voice may require `options.modelVersion` (for example `seed-tts-2.0-standard`), which maps to `req_params.model`. Standard voices omit it and use the provider default. `sampleRate` defaults to 24,000; speed maps to the documented integer `speech_rate` scale. Trusted `options.additions` is serialized as the provider's JSON string field.

## Voice choices

Set `options.voices` when callers may select a voice. It is the connector's trusted allowlist and may contain IDs or ID/name objects:

```json
{
  "speaker": "zh_female_vv_uranus_bigtts",
  "voices": [
    "zh_female_vv_uranus_bigtts",
    { "id": "zh_male_m191_uranus_bigtts", "name": "云舟 2.0" }
  ]
}
```

An explicitly requested voice outside this list produces `status: unsupported`, no artifacts, and a `TTS_VOICE_NOT_AVAILABLE` warning containing available IDs, without sending a provider request. If no allowlist is configured, provider-supported overrides remain allowed. A Volcengine response that explicitly identifies a missing, unauthorized, invalid, or resource-mismatched speaker is converted to the same safe warning for an explicit voice override and lists configured or adapter-known candidate voices. JSON APIs also recognize HTTP 400/422 errors with an explicit voice parameter (`voice`, `voice_id`, `input.voice`, or `voice_setting.voice_id`). Unknown business errors and authentication failures remain errors; upstream response bodies are never exposed.

The parser handles JSON frames fragmented across HTTP chunks, concatenated JSON objects, and SSE records. Requests enable the provider subtitle response. Valid `sentence.words` entries are collected without semantic re-segmentation and returned as a second `application/json` asset with `artifactType: word-timing`; the shared runtime writes it beside the audio under `<session_root>/tts/`. The JSON schema uses seconds and `provider-word` granularity. When the provider returns no timing entries, the file contains `words: []`.

Code `0` contributes audio or metadata; **only terminal `20000000` establishes complete success**. EOF without that frame, provider errors, malformed base64 or word timing data, audio after terminal success, oversized output, and cancellation reject the entire result. No partial file is returned.

## Validation and limits

The shared runtime bounds downloads and JSON, refuses redirect following for authenticated requests, and downloads artifacts without generation headers. Qwen's documented HTTP result URLs on DashScope OSS hosts are upgraded to HTTPS without changing signed paths/queries. Other insecure result URLs fail closed.

Audio is capped at 50 MiB. WAV chunk boundaries, MP3 frame lengths, and AAC ADTS frame lengths are checked. FLAC/Opus are rejected before HTTP because complete validation is not implemented. Raw PCM is checked for sample alignment and wrapped as PCM16 WAV for playback: OpenAI/ZAI and the supported OpenRouter PCM families use 24 kHz mono; MiniMax uses configured sampleRate/channel (defaults 32 kHz mono), and Volcengine uses the requested sample rate with mono output. These structural checks do not replace decoding/listening during live acceptance. Binary providers must complete their HTTP body successfully; unlike Volcengine they have no application terminal frame.

Run `pnpm test` and `pnpm run build` in this directory after workspace dependency installation. Tests use controlled transport responses and cover seven supported providers, unsupported entries, aliases, authentication, native bodies, malformed audio, provider failures, cancellation/timeout, credential isolation, and truncated Volcengine streams. The fixture tests make no live provider calls. Platform acceptance, voice permissions, and perceptual audio quality require separate live verification.

## Official references

Checked 2026-10-15:

- [OpenAI speech API](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create)
- [OpenRouter TTS](https://openrouter.ai/docs/guides/overview/multimodal/tts)
- [Together speech API](https://docs.together.ai/reference/audio-speech)
- [Bigmodel text to speech](https://docs.bigmodel.cn/api-reference/模型-api/文本转语音)
- [Qwen-TTS API](https://help.aliyun.com/en/model-studio/qwen-tts-api)
- [MiniMax synchronous TTS](https://platform.minimax.io/docs/api-reference/speech-t2a-http)
- [Volcengine HTTP speech](https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http?lang=zh)
- [Volcengine HTTP/SSE framing and terminal status](https://www.volcengine.com/docs/6561/1598757)
- [Volcengine legacy authentication](https://docs.volcengine.com/docs/DoubaoVoice/old-version-console-authentication-reference-example?lang=zh)

Model-management debugging is available to the authenticated backend proxy at `POST /api/byclaw/tts/debug`: `{ debug: true, text, model? }`. The route validates the current user's Redis login token and uses the explicit saved/debug model, or the configured default TTS model when omitted. It returns bounded MP3 `{ audioBase64, mimeType, provider, model }` to the BE; the BE reports only diagnostic fields to the model-management UI. This debug call does not create a conversation artifact. Voice conversation summaries continue to save audio in `session_root/tts/`.


## Querying and changing speech controls

The session-scoped `text_to_speech_options({})` tool resolves the same current model as
`text_to_speech` (personal connector first, otherwise system default). It returns:

- `voice`: `supported`, `default`, `choices: [{ id, name? }]`, `restricted`, and `note`.
- `speed`: `supported`, `default`, and `min` / `max` when supported. Values are multipliers; 1 is normal.

Each provider adapter owns its capability description. The query reads the current
configuration on every call, creates no files, does not synthesize audio, and does not
ask the Agent to browse documentation. This version uses adapter-maintained catalogs
and configured voice choices; it does **not** claim a live account-entitlement lookup.
Seed TTS 2.0 includes four documented standard candidates: Vivi 2.0, 小何 2.0,
云舟 2.0, and 小天 2.0. Clone/1.0 resources do not inherit the 2.0 catalog.
A configured `options.voices` list takes precedence; without it the candidate list is
non-exhaustive and other explicit provider IDs are still allowed. Providers ultimately
validate voice permissions. Unique configured/catalog names resolve to IDs; ambiguous
names are not guessed. Omitted voice uses `voice`, `speaker`, `defaultVoice`, then
an adapter default, in that order.

Call `text_to_speech` with `text`, `voice`, and `speed` after querying. Overrides apply
to that invocation and do not modify saved defaults. Unsupported/out-of-range speeds
fall back to a valid configured speed or the provider default and return a
`TTS_SPEED_UNSUPPORTED` warning. Any finite positive multiplier reaches this adapter
check; zero, negative, nonfinite, and nonnumeric values remain invalid input.
Qwen HTTP and Together currently advertise no numeric
speed control; unknown OpenRouter model families do not advertise unverified speed
support. OpenAI TTS routes support 0.25–4; ZAI, MiniMax, and Volcengine support 0.5–2.
Volcengine maps the multiplier to integer `speech_rate = round((speed - 1) * 100)`.

Generation results contain `status: generated | unsupported`, `warnings`, and
`artifacts`. An unavailable explicit voice returns `unsupported` with no files and
available choices; it does not ask for a new connector and does not automatically
retry a billable generation with another voice. Agents must disclose warnings and
must not claim audio exists when artifacts are empty. Credential, transport,
malformed/truncated audio, and cancellation failures remain errors.

Adapter consumers can call `getSpeechOptions(model)` and
`generateSpeechResult(model, args, context)` for `{ assets, warnings }`. The existing
`generateSpeech` byte-array API remains available; callers using it should subscribe
to `context.onWarning` for nonfatal speed feedback. It retains typed voice errors;
the result API converts explicit-override voice errors into nonfatal outcomes.

References checked 2026-10-16: [Volcengine voice list](https://docs.volcengine.com/docs/DoubaoVoice/Tonelist-1?lang=zh),
[Volcengine speed mapping](https://docs.volcengine.com/docs/DoubaoVoice/HTTPChunkedSSEUnidirectionalStreaming-V3?lang=zh),
[OpenRouter model-specific speed support](https://openrouter.ai/docs/guides/overview/multimodal/tts).
