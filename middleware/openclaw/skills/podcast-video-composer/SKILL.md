---
name: podcast-video-composer
description: Compose the final podcast video by combining PPTX slides + audio + podcast script into a subtitle-ready MP4. Use this skill whenever the user wants to: merge slides and audio into a video, add bottom subtitles to a podcast, generate the final video after producing slides and audio, or complete the last step of a podcast production pipeline. Trigger on phrases like: "合成视频", "生成播客视频", "把PPT和音频合成", "把幻灯片和音频做成视频", "加字幕", "最后合成", "做成视频", "compose podcast video", "combine slides and audio", "final video step", "视频合成". Even when the user just says "好了，现在合成视频" or "最后一步" after producing slides and audio — this is the skill to use.
---

# Podcast Video Composer

Takes the outputs of the podcast production workflow and assembles them into a final MP4:

| Input | From | Required |
|-------|------|----------|
| PPTX slides | `pptx-generator` skill | ✅ |
| Audio file (MP3/WAV/M4A) | User's TTS tool | ✅ |
| Script JSON | `podcast-script-generator` skill | Optional (enables subtitles + slide sync) |
| TTS timing JSON | TTS tool output (`start`/`duration` per turn or sentence) | Optional (enables precise timing) |
| Slide durations JSON | Manual override | Optional (overrides auto-computed timing) |

Output: 1920×1080 MP4 with slides synced to audio and subtitles burned at the bottom.

### Sync quality levels

| Script has `"slide"` annotations | TTS timing file | Slide timing | Subtitle timing |
|---|---|---|---|
| ✅ Yes (from PPT-aligned mode) | ✅ Turn-level | **Exact per slide** | Exact per turn, proportional within turn |
| ✅ Yes | ✅ Sentence-level (`--sentence-mode`) | **Exact per slide** | **Exact per sentence** |
| ❌ No | ✅ Turn-level | Uniform (wrong) | Exact per turn |
| ❌ No | ❌ None | Uniform (wrong) | Proportional only |

**To get full sync:** use `podcast-script-generator` with `slide-outline.json` or PPTX input (produces `"slide"` annotations) + `generate_audio.py --sentence-mode` (produces sentence-level timing).

## Step 1: Collect inputs from user

Ask the user for these paths (check the conversation first — they may have already mentioned them):

1. **`--pptx`** — path to the PPTX file
2. **`--audio`** — path to the audio file (MP3/WAV/M4A)
3. **`--output`** — output MP4 path (default: same directory as PPTX, replace extension with `.mp4`)
4. **`--script`** — *(optional)* path to script JSON from `podcast-script-generator`
5. **`--timing`** — *(optional)* path to per-turn TTS timing JSON (see format below); enables frame-accurate subtitle sync
6. **`--slide-durations`** — *(optional)* path to per-slide durations JSON; controls how long each slide stays on screen

If `--script` is omitted, the video is produced without subtitles.  
If `--timing` is omitted but `--script` is present, subtitles are distributed proportionally by character count.

## Step 2: Run the assembly script

```bash
python /home/byclaw/.claude/skills/podcast-video-composer/scripts/assemble.py \
  --pptx <pptx_file> \
  --audio <audio_file> \
  --output <output_file> \
  [--script <script.json>] \
  [--timing <timing.json>] \
  [--slide-durations <slide_durations.json>]
```

Run this with the Bash tool and stream stdout to the user.

## Step 3: Report result

Tell the user the output file path and duration. If a subtitle file was generated, mention it.

---

## Input formats

**Script JSON** — from `podcast-script-generator`:
```json
{
  "title": "Episode title",
  "script": [
    {"role": "host", "text": "开场内容..."},
    {"role": "guest", "text": "嘉宾回应..."}
  ]
}
```
Also accepts a bare array: `[{"role": "host", "text": "..."}, ...]`

**TTS timing JSON** — per-turn array from TTS output (from `podcast-tts`):
```json
[
  {"index": 0, "role": "host",  "duration": 9.22,  "start": 0.0,  "text_preview": "..."},
  {"index": 1, "role": "guest", "duration": 15.94, "start": 9.22, "text_preview": "..."}
]
```
Turn count must match the script array. The `role` field uses `"host"`/`"guest"` (English), matching `podcast-tts` output. The `text_preview` field is ignored — full text comes from `--script`.

**Slide durations JSON** — either a dict or list:
```json
{"1": 35.5, "2": 28.0, "3": 42.1}
```
or `[35.5, 28.0, 42.1]`  
Must have one entry per slide. If omitted, audio duration is split evenly across all slides.

---

## How subtitles work

When `--script` is provided:

- Each dialogue turn is split into ≤22-character subtitle segments (natural sentence boundaries)
- If `--timing` is also provided: each segment uses the exact `start`/`duration` from the TTS output → frame-accurate sync
- Otherwise: segments are time-distributed proportionally by character count
- Subtitles are burned in (hard-coded) at the bottom center: white text, black outline, 55px bottom margin

---

## Dependencies

All must be present on the system:

| Tool | Install |
|------|---------|
| ffmpeg + ffprobe | `apt install ffmpeg` |
| LibreOffice | `apt install libreoffice` |
| PyMuPDF | `pip install --break-system-packages pymupdf` |

The script will print install instructions if something is missing.
