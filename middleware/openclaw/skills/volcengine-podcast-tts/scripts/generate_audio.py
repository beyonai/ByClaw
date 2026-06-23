#!/usr/bin/env python3
"""Generate podcast audio with Volcengine/Doubao TTS V3 HTTP Chunked API."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any


ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"
DEFAULT_RESOURCE_ID = "seed-tts-2.0"
DEFAULT_HOST_VOICE = "zh_male_dayi_uranus_bigtts"
DEFAULT_GUEST_VOICE = "zh_female_vv_uranus_bigtts"
DEFAULT_SAMPLE_RATE = 24000
DEFAULT_WORK_ROOT = Path("/tmp/byclaw-volcengine-tts")
DEFAULT_CACHE_DIR = Path("/tmp/byclaw-volcengine-tts-cache")
DEFAULT_CONCURRENCY = 8


class TTSFailure(RuntimeError):
    pass


class RateLimited(TTSFailure):
    pass


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        tail = (result.stderr or result.stdout)[-1200:]
        raise RuntimeError(f"Command failed: {' '.join(cmd)}\n{tail}")
    return result


def require_tool(name: str) -> None:
    if shutil.which(name) is None:
        raise RuntimeError(f"Missing required command: {name}")


def split_sentences(text: str) -> list[str]:
    text = text.strip()
    if not text:
        return []
    parts = re.split(r"(?<=[。？！；….!?;])\s*", text)
    return [part.strip() for part in parts if part.strip()]


def split_long_text(text: str, max_chars: int) -> list[str]:
    parts: list[str] = []
    for sentence in split_sentences(text) or [text]:
        if len(sentence) <= max_chars:
            parts.append(sentence)
            continue
        cursor = 0
        while cursor < len(sentence):
            parts.append(sentence[cursor:cursor + max_chars].strip())
            cursor += max_chars
    return [part for part in parts if part]


def load_script(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    turns = data if isinstance(data, list) else data.get("script", [])
    if not turns:
        raise ValueError("script JSON contains no turns")
    return turns


def build_segments(script_turns: list[dict[str, Any]], sentence_mode: bool, max_chars: int) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    for turn_idx, turn in enumerate(script_turns):
        role = turn.get("role", "host")
        voice_key = "host" if role in {"host", "主持人"} else "guest"
        slide = turn.get("slide")
        text = str(turn.get("text", "")).strip()
        if not text:
            continue
        units = split_sentences(text) if sentence_mode else split_long_text(text, max_chars)
        if sentence_mode:
            expanded = []
            for unit in units:
                expanded.extend(split_long_text(unit, max_chars))
            units = expanded
        for sent_idx, unit in enumerate(units):
            segments.append({
                "text": unit,
                "voice_key": voice_key,
                "role": role,
                "slide": slide,
                "turn_index": turn_idx,
                "sentence_index": sent_idx if sentence_mode else None,
            })
    return segments


def speech_rate_from_speed(speed: float) -> int:
    # Volcengine V3 uses -50..100, where 0=1.0x, 100=2.0x, -50=0.5x.
    if speed >= 1.0:
        return max(0, min(100, round((speed - 1.0) * 100)))
    return max(-50, min(0, round((speed - 1.0) * 100)))


def auth_headers(resource_id: str) -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "X-Api-Resource-Id": resource_id,
        "X-Api-Request-Id": str(uuid.uuid4()),
        "X-Control-Require-Usage-Tokens-Return": "*",
    }

    api_key = os.environ.get("VOLCENGINE_TTS_API_KEY") or os.environ.get("DOUBAO_API_KEY")
    if api_key:
        headers["X-Api-Key"] = api_key
        return headers

    app_id = os.environ.get("VOLCENGINE_TTS_APP_ID") or os.environ.get("VOLCENGINE_TTS_APPID")
    access_key = os.environ.get("VOLCENGINE_TTS_ACCESS_KEY") or os.environ.get("VOLCENGINE_TTS_ACCESS_TOKEN")
    if app_id and access_key:
        headers["X-Api-App-Id"] = app_id
        headers["X-Api-Access-Key"] = access_key
        return headers

    raise RuntimeError(
        "Missing Volcengine credentials. Ask the user for VOLCENGINE_TTS_API_KEY "
        "(or DOUBAO_API_KEY) interactively. Do not write the key into repository files. "
        "Legacy fallback: VOLCENGINE_TTS_APP_ID + VOLCENGINE_TTS_ACCESS_KEY."
    )


def build_payload(text: str, speaker: str, speed: float, sample_rate: int, audio_format: str, uid: str) -> dict[str, Any]:
    return {
        "user": {"uid": uid},
        "req_params": {
            "text": text,
            "speaker": speaker,
            "audio_params": {
                "format": audio_format,
                "sample_rate": sample_rate,
                "speech_rate": speech_rate_from_speed(speed),
            },
        },
    }


def iter_json_objects(raw: str):
    decoder = json.JSONDecoder()
    idx = 0
    length = len(raw)
    while idx < length:
        while idx < length and raw[idx] in " \r\n\t":
            idx += 1
        if idx >= length:
            break
        obj, next_idx = decoder.raw_decode(raw, idx)
        yield obj
        idx = next_idx


def volcengine_tts(
    session: Any,
    text: str,
    speaker: str,
    resource_id: str,
    speed: float,
    sample_rate: int,
    audio_format: str,
    timeout: int,
) -> bytes:
    try:
        import requests
    except ImportError as exc:
        raise RuntimeError("Missing Python package: requests. Install with: pip install requests") from exc

    headers = auth_headers(resource_id)
    payload = build_payload(
        text=text,
        speaker=speaker,
        speed=speed,
        sample_rate=sample_rate,
        audio_format=audio_format,
        uid=f"byclaw-{os.getpid()}",
    )
    response = session.post(ENDPOINT, headers=headers, json=payload, stream=True, timeout=timeout)
    log_id = response.headers.get("X-Tt-Logid") or response.headers.get("X-Tt-Logid".lower())
    if response.status_code >= 400:
        body = response.text[:800]
        if "quota" in body.lower() or "concurrency" in body.lower() or response.status_code in {429, 503}:
            raise RateLimited(f"HTTP {response.status_code}: {body} logid={log_id}")
        raise TTSFailure(f"HTTP {response.status_code}: {body} logid={log_id}")

    raw_parts: list[str] = []
    for chunk in response.iter_content(chunk_size=8192, decode_unicode=True):
        if chunk:
            if isinstance(chunk, bytes):
                chunk = chunk.decode("utf-8", errors="replace")
            raw_parts.append(chunk)
    raw = "".join(raw_parts)

    audio_parts: list[bytes] = []
    final_ok = False
    errors: list[str] = []
    for obj in iter_json_objects(raw):
        code = obj.get("code")
        message = str(obj.get("message", ""))
        data = obj.get("data")
        if isinstance(data, str) and data:
            audio_parts.append(base64.b64decode(data))
        if code == 20000000:
            final_ok = True
        elif code not in (None, 0):
            errors.append(f"{code}: {message}")

    if errors:
        joined = "; ".join(errors)
        if "quota" in joined.lower() or "concurrency" in joined.lower():
            raise RateLimited(f"{joined} logid={log_id}")
        raise TTSFailure(f"{joined} logid={log_id}")
    if not audio_parts:
        raise TTSFailure(f"No audio data returned. logid={log_id}; raw={raw[:500]}")
    if not final_ok:
        print(f"  Warning: final success marker not observed. logid={log_id}", file=sys.stderr)
    return b"".join(audio_parts)


def cache_key(seg: dict[str, Any], speaker: str, resource_id: str, speed: float, sample_rate: int, audio_format: str) -> str:
    payload = {
        "text": seg["text"],
        "speaker": speaker,
        "resource_id": resource_id,
        "speed": speed,
        "sample_rate": sample_rate,
        "format": audio_format,
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def measure_duration(audio_path: Path) -> float:
    result = run([
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(audio_path),
    ])
    return float(result.stdout.strip())


def concat_audio(files: list[Path], output: Path) -> float:
    concat_list = output.parent / "concat_list.txt"
    with concat_list.open("w", encoding="utf-8") as f:
        for path in files:
            f.write(f"file '{path}'\n")
    try:
        run([
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_list),
            "-c",
            "copy",
            str(output),
        ])
    finally:
        concat_list.unlink(missing_ok=True)
    return measure_duration(output)


def synthesize_segment(
    idx: int,
    seg: dict[str, Any],
    voices: dict[str, str],
    args: argparse.Namespace,
    cache_dir: Path,
    segments_dir: Path,
) -> dict[str, Any]:
    speaker = voices[seg["voice_key"]]
    out_file = segments_dir / f"seg_{idx:04d}.mp3"
    key = cache_key(seg, speaker, args.resource_id, args.speed, args.sample_rate, args.format)
    cached = cache_dir / f"{key}.mp3"
    if cached.exists() and cached.stat().st_size > 0:
        shutil.copy2(cached, out_file)
        duration = measure_duration(out_file)
        result = dict(seg)
        result.update({"audio_path": str(out_file), "duration": duration, "cached": True})
        return result

    last_error: Exception | None = None
    for attempt in range(1, args.max_retries + 1):
        try:
            import requests

            with requests.Session() as session:
                audio = volcengine_tts(
                    session=session,
                    text=seg["text"],
                    speaker=speaker,
                    resource_id=args.resource_id,
                    speed=args.speed,
                    sample_rate=args.sample_rate,
                    audio_format=args.format,
                    timeout=args.timeout,
                )
            out_file.write_bytes(audio)
            duration = measure_duration(out_file)
            cached.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(out_file, cached)
            result = dict(seg)
            result.update({"audio_path": str(out_file), "duration": duration, "cached": False})
            return result
        except (RateLimited, TTSFailure, RuntimeError) as exc:
            last_error = exc
            if attempt >= args.max_retries:
                break
            base = args.retry_base * (2 ** (attempt - 1))
            sleep_s = min(args.retry_max, base + random.uniform(0, args.retry_jitter))
            print(f"  Segment {idx} attempt {attempt} failed: {exc}. Retrying in {sleep_s:.1f}s", file=sys.stderr)
            time.sleep(sleep_s)
    raise TTSFailure(f"Segment {idx} failed after {args.max_retries} attempts: {last_error}")


def cached_segment(
    idx: int,
    seg: dict[str, Any],
    voices: dict[str, str],
    args: argparse.Namespace,
    cache_dir: Path,
    segments_dir: Path,
) -> dict[str, Any] | None:
    speaker = voices[seg["voice_key"]]
    out_file = segments_dir / f"seg_{idx:04d}.mp3"
    key = cache_key(seg, speaker, args.resource_id, args.speed, args.sample_rate, args.format)
    cached = cache_dir / f"{key}.mp3"
    if not cached.exists() or cached.stat().st_size <= 0:
        return None
    shutil.copy2(cached, out_file)
    duration = measure_duration(out_file)
    result = dict(seg)
    result.update({"audio_path": str(out_file), "duration": duration, "cached": True})
    return result


def synthesize_all(
    segments: list[dict[str, Any]],
    voices: dict[str, str],
    args: argparse.Namespace,
    cache_dir: Path,
    segments_dir: Path,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any] | None] = [None] * len(segments)
    pending: list[tuple[int, dict[str, Any]]] = []

    for idx, seg in enumerate(segments):
        result = cached_segment(idx, seg, voices, args, cache_dir, segments_dir)
        if result:
            results[idx] = result
            print(f"  [{idx + 1}/{len(segments)}] {result['duration']:.2f}s cached")
        else:
            pending.append((idx, seg))

    if all(result is not None for result in results):
        return [result for result in results if result is not None]

    print(f"  Live TTS requests: {len(pending)} (concurrency={args.concurrency})")
    with ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as executor:
        futures = {
            executor.submit(synthesize_segment, idx, seg, voices, args, cache_dir, segments_dir): idx
            for idx, seg in pending
        }
        completed = 0
        for future in as_completed(futures):
            idx = futures[future]
            result = future.result()
            results[idx] = result
            completed += 1
            print(f"  [{completed}/{len(pending)} live] segment {idx + 1}/{len(segments)} {result['duration']:.2f}s")

    return [result for result in results if result is not None]


def build_durations(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    durations = []
    elapsed = 0.0
    for idx, seg in enumerate(results):
        entry = {
            "index": idx,
            "turn_index": seg["turn_index"],
            "role": seg["role"],
            "duration": round(float(seg["duration"]), 3),
            "start": round(elapsed, 3),
        }
        if seg.get("slide") is not None:
            entry["slide"] = seg["slide"]
        if seg.get("sentence_index") is not None:
            entry["sentence_index"] = seg["sentence_index"]
            entry["text"] = seg["text"]
        else:
            entry["text_preview"] = seg["text"][:80]
        durations.append(entry)
        elapsed += float(seg["duration"])
    return durations


def main() -> None:
    parser = argparse.ArgumentParser(description="Podcast script JSON -> Volcengine TTS MP3 + durations JSON")
    parser.add_argument("--script", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--sentence-mode", action="store_true")
    parser.add_argument("--host-voice", default=os.environ.get("VOLCENGINE_TTS_HOST_VOICE", DEFAULT_HOST_VOICE))
    parser.add_argument("--guest-voice", default=os.environ.get("VOLCENGINE_TTS_GUEST_VOICE", DEFAULT_GUEST_VOICE))
    parser.add_argument("--resource-id", default=os.environ.get("VOLCENGINE_TTS_RESOURCE_ID", DEFAULT_RESOURCE_ID))
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--format", default="mp3", choices=["mp3", "ogg_opus", "pcm"])
    parser.add_argument("--sample-rate", type=int, default=DEFAULT_SAMPLE_RATE)
    parser.add_argument("--max-chars", type=int, default=900)
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    parser.add_argument("--min-interval", type=float, default=0.0, help="Deprecated; kept for compatibility. Concurrency controls pacing.")
    parser.add_argument("--max-retries", type=int, default=6)
    parser.add_argument("--retry-base", type=float, default=2.0)
    parser.add_argument("--retry-max", type=float, default=60.0)
    parser.add_argument("--retry-jitter", type=float, default=1.0)
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--work-root", default=str(DEFAULT_WORK_ROOT))
    parser.add_argument("--cache-dir", default=str(DEFAULT_CACHE_DIR))
    parser.add_argument("--job-name")
    parser.add_argument("--keep-work", action="store_true")
    args = parser.parse_args()

    require_tool("ffmpeg")
    require_tool("ffprobe")
    if args.format != "mp3":
        raise ValueError("This podcast workflow currently expects --format mp3 for downstream concat/video compatibility.")

    script_path = Path(args.script).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    turns = load_script(script_path)
    segments = build_segments(turns, args.sentence_mode, args.max_chars)
    if not segments:
        raise ValueError("No TTS segments generated from script")

    work_root = Path(args.work_root).expanduser().resolve()
    job_name = args.job_name or f"job-{int(time.time())}-{os.getpid()}"
    job_dir = work_root / job_name
    segments_dir = job_dir / "segments"
    segments_dir.mkdir(parents=True, exist_ok=True)
    cache_dir = Path(args.cache_dir).expanduser().resolve()
    cache_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 56)
    print("Volcengine Podcast TTS")
    print("=" * 56)
    print(f"script turns: {len(turns)}")
    print(f"segments: {len(segments)} ({'sentence' if args.sentence_mode else 'turn/long-text'} mode)")
    print(f"resource_id: {args.resource_id}")
    print(f"host_voice: {args.host_voice}")
    print(f"guest_voice: {args.guest_voice}")
    print(f"concurrency: {args.concurrency}, max_retries: {args.max_retries}")
    print(f"work_dir: {job_dir}")

    try:
        import requests
    except ImportError as exc:
        raise RuntimeError("Missing Python package: requests. Install with: pip install requests") from exc

    voices = {"host": args.host_voice, "guest": args.guest_voice}
    results = synthesize_all(segments, voices, args, cache_dir, segments_dir)

    audio_files = [Path(item["audio_path"]) for item in results]
    total_duration = concat_audio(audio_files, output_path)

    durations = build_durations(results)
    durations_path = output_path.with_name(output_path.stem + "_durations.json")
    durations_path.write_text(json.dumps(durations, ensure_ascii=False, indent=2), encoding="utf-8")

    if not args.keep_work:
        shutil.rmtree(job_dir, ignore_errors=True)

    size_mb = output_path.stat().st_size / 1024 / 1024
    print("=" * 56)
    print(f"audio: {output_path} ({size_mb:.2f} MB, {total_duration:.2f}s)")
    print(f"timing: {durations_path} ({len(durations)} entries)")
    print("=" * 56)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
