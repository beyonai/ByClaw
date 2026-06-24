---
name: volcengine-podcast-tts
description: >
  Convert podcast-script-generator JSON into dual-voice podcast audio using
  Volcengine/Doubao TTS V3 HTTP Chunked API. Use this as the only TTS skill for
  the HTML AI podcast workflow, especially when the user asks for 火山引擎 TTS,
  豆包语音合成, Volcengine TTS, or a low-concurrency TTS workflow for AI podcast
  video generation.
---

# Volcengine Podcast TTS

This is the TTS skill for the HTML podcast workflow. It reads the podcast script
JSON and writes the downstream artifacts:

```text
podcast.mp3
podcast_durations.json
```

The implementation uses Volcengine/Doubao TTS V3 HTTP Chunked API. It defaults
to 8 concurrent requests and keeps a segment cache under `/tmp` so reruns only
pay for changed text.

## Official API Notes

Use the V3 HTTP Chunked endpoint:

```text
https://openspeech.bytedance.com/api/v3/tts/unidirectional
```

Required headers for the new console:

```text
X-Api-Key: <api-key>
X-Api-Resource-Id: seed-tts-2.0
X-Api-Request-Id: <uuid>
Content-Type: application/json
```

Legacy console credentials are also supported:

```text
X-Api-App-Id: <app-id>
X-Api-Access-Key: <access-token>
X-Api-Resource-Id: <resource-id>
```

The response is streamed JSON. Audio chunks are base64 strings in the `data`
field and must be decoded and concatenated.

## Environment

Prefer the new API key:

```bash
export VOLCENGINE_TTS_API_KEY="..."
```

Legacy fallback:

```bash
export VOLCENGINE_TTS_APP_ID="..."
export VOLCENGINE_TTS_ACCESS_KEY="..."
```

`DOUBAO_API_KEY` is also accepted as an alias for `VOLCENGINE_TTS_API_KEY`.

`VOLCENGINE_TTS_RESOURCE_ID` defaults to `seed-tts-2.0`; do not ask the user for
it unless they need a different speaker family.

If `VOLCENGINE_TTS_API_KEY` / `DOUBAO_API_KEY` is missing, ask the user to provide
the API key interactively. Do not invent a key and do not write the key into
repository files.

Local tools:

```bash
ffmpeg -version && ffprobe -version
python -c "import requests"
```

If `requests` is missing:

```bash
pip install requests
```

## Run

```bash
python AI播客/html/volcengine-podcast-tts/scripts/generate_audio.py \
  --script work/script/podcast-script.json \
  --output work/audio/podcast.mp3 \
  --sentence-mode \
  --concurrency 8 \
  --host-voice zh_male_dayi_uranus_bigtts \
  --guest-voice zh_female_vv_uranus_bigtts
```

Recommended for final videos:

- Use `--sentence-mode` for accurate SRT subtitles.
- Default `--concurrency 8` is optimized for speed. Lower it to `4`, `2`, or `1`
  if the account returns concurrency quota errors.
- Use `--cache-dir /tmp/byclaw-volcengine-tts-cache` to avoid paying/retrying
  already successful segments during reruns.

## Output Contract

The timing JSON matches the existing video composer expectation:

```json
[
  {
    "index": 0,
    "turn_index": 0,
    "sentence_index": 0,
    "role": "host",
    "slide": 1,
    "text": "欢迎收听今天的节目。",
    "duration": 2.18,
    "start": 0.0
  }
]
```

## Rate Limit Strategy

- Default 8 concurrent HTTP requests.
- Cached segments are copied locally and do not consume API concurrency.
- Retry transient errors and throttling with exponential backoff.
- Stop the run on a permanently failed segment instead of silently skipping audio.
- Keep segment cache under `/tmp`, not in the repository.

## Common Errors

| Error | Likely Cause | Fix |
|---|---|---|
| `quota exceeded for types: concurrency` | Provider-side concurrency throttling | Lower `--concurrency` to `4`, `2`, or `1`, then retry. |
| `speaker permission denied` | Speaker not enabled or wrong resource id | Match `--resource-id` to the speaker family. |
| `resource ID is mismatched` | Voice and resource id mismatch | Use `seed-tts-2.0` for 2.0 voices, or override with the console value. |
| `TTSExceededTextLimit` | Segment too long | Use `--sentence-mode` or lower `--max-chars`. |
