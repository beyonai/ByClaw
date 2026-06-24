#!/usr/bin/env python3
"""
Generate SRT subtitle file from podcast script JSON.

Two modes:
  1. Exact timing (--timing): uses per-turn start/duration from TTS output
  2. Proportional (--audio-duration): distributes by character count

Usage:
    python generate_srt.py <script.json> <output.srt> --timing <durations.json>
    python generate_srt.py <script.json> <output.srt> --audio-duration 305.5
"""

import argparse
import json
import re
import sys

MAX_CHARS = 28


def to_srt_time(t):
    ms = int((t % 1) * 1000)
    s = int(t) % 60
    m = (int(t) // 60) % 60
    h = int(t) // 3600
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _find_split_point(text, max_chars):
    """
    Find the best split position ≤ max_chars that does not cut inside a word.
    Priority:
      1. Chinese clause punctuation (，、：；) — cleanest break
      2. Space — avoids cutting Latin words like "L1", "ByClaw", "Agent"
      3. Hard character boundary — last resort
    """
    limit = min(max_chars, len(text))

    # 1. Chinese clause punctuation
    for i in range(limit - 1, limit // 3, -1):
        if text[i] in '，、：；':
            return i + 1

    # 2. Space (word boundary for Latin / mixed text)
    for i in range(limit - 1, limit // 3, -1):
        if text[i] == ' ':
            return i + 1

    # 3. Character boundary
    return max_chars


def chunk_text(text, max_chars=MAX_CHARS):
    """Split text into subtitle chunks of ≤ max_chars at natural boundaries."""
    text = text.strip()
    if not text:
        return []

    # First break at sentence-ending punctuation (keeps punctuation with preceding text)
    parts = re.split(r'(?<=[。？！…；])', text)
    parts = [p.strip() for p in parts if p.strip()]
    if not parts:
        parts = [text]

    chunks = []
    current = ""
    for part in parts:
        if len(current) + len(part) <= max_chars:
            current += part
        else:
            if current:
                chunks.append(current)
                current = ""
            # Force-split oversized part without cutting words
            while len(part) > max_chars:
                split_at = _find_split_point(part, max_chars)
                chunks.append(part[:split_at].rstrip())
                part = part[split_at:].lstrip()
            current = part

    if current:
        chunks.append(current)

    return chunks or [text[:max_chars]]


def build_entries_from_timing(script_turns, timing_turns):
    """
    Generate (start, end, text) triples using exact TTS timing.

    Auto-detects sentence-level vs turn-level based on whether timing entries have a "text" field.
    - Sentence-level (from --sentence-mode TTS): each timing entry is one sentence with exact timing.
    - Turn-level: each timing entry covers a full dialogue turn.
    """
    is_sentence_level = any(t.get("text") for t in timing_turns)
    entries = []

    def _distribute_chunks(text, start, duration):
        """Split text into subtitle chunks and distribute duration proportionally
        to character count (not equally). Pure equal-splitting caused up to 4s
        drift when sentences contain numbers / English / mixed CJK."""
        chunks = chunk_text(text)
        if not chunks:
            return
        if len(chunks) == 1:
            entries.append((start, start + duration, chunks[0]))
            return
        # Weight by character count (strip spaces so they don't bias)
        weights = [max(1, len(c.replace(" ", ""))) for c in chunks]
        total = sum(weights)
        cursor = start
        for chunk, w in zip(chunks, weights):
            chunk_dur = duration * (w / total)
            entries.append((cursor, cursor + chunk_dur, chunk))
            cursor += chunk_dur

    if is_sentence_level:
        for timing_t in timing_turns:
            text = timing_t.get("text", "").strip()
            if not text:
                continue
            start = float(timing_t.get("start", 0))
            duration = float(timing_t.get("duration", 0))
            if duration <= 0:
                continue
            _distribute_chunks(text, start, duration)
    else:
        for script_t, timing_t in zip(script_turns, timing_turns):
            text = script_t.get("text", "").strip()
            if not text:
                continue
            start = float(timing_t.get("start", 0))
            duration = float(timing_t.get("duration", 0))
            if duration <= 0:
                continue
            _distribute_chunks(text, start, duration)

    return entries


def build_entries_proportional(script_turns, audio_duration):
    """Generate (start, end, text) triples distributed by character count."""
    all_text = [t.get("text", "").strip() for t in script_turns]
    all_text = [t for t in all_text if t]
    total_chars = sum(len(t) for t in all_text)
    if total_chars == 0:
        return []

    entries = []
    current_time = 0.0
    for text in all_text:
        turn_duration = (len(text) / total_chars) * audio_duration
        chunks = chunk_text(text)
        dur_per_chunk = turn_duration / len(chunks)
        for chunk in chunks:
            entries.append((current_time, current_time + dur_per_chunk, chunk))
            current_time += dur_per_chunk
    return entries


def write_srt(entries, output_file):
    lines = []
    for i, (start, end, text) in enumerate(entries, 1):
        lines.append(f"{i}\n{to_srt_time(start)} --> {to_srt_time(end)}\n{text}\n")
    with open(output_file, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"  Generated {len(entries)} subtitle entries → {output_file}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("script", help="Podcast script JSON")
    parser.add_argument("output", help="Output SRT file path")
    parser.add_argument("--timing", help="Per-turn/sentence TTS timing JSON")
    parser.add_argument("--audio-duration", type=float, help="Total audio duration (proportional mode)")
    args = parser.parse_args()

    with open(args.script, encoding="utf-8") as f:
        data = json.load(f)
    script_turns = data if isinstance(data, list) else data.get("script", [])

    if not script_turns:
        print("❌ No script turns found in JSON")
        sys.exit(1)

    if args.timing:
        with open(args.timing, encoding="utf-8") as f:
            timing_data = json.load(f)

        is_sentence_level = (
            len(timing_data) > len(script_turns)
            and any(t.get("text") for t in timing_data)
        )

        if is_sentence_level:
            entries = build_entries_from_timing(script_turns, timing_data)
            print(f"  Using sentence-level TTS timing ({len(timing_data)} sentences)")
        elif len(timing_data) != len(script_turns):
            print(f"  ⚠ Turn count mismatch: script={len(script_turns)}, timing={len(timing_data)}, falling back to proportional")
            total = timing_data[-1]["start"] + timing_data[-1]["duration"]
            entries = build_entries_proportional(script_turns, args.audio_duration or total)
        else:
            entries = build_entries_from_timing(script_turns, timing_data)
            print(f"  Using exact TTS timing ({len(timing_data)} turns)")

    elif args.audio_duration:
        print(f"  Using proportional mode ({args.audio_duration:.1f}s)")
        entries = build_entries_proportional(script_turns, args.audio_duration)
    else:
        print("❌ Provide --timing <file> or --audio-duration <seconds>")
        sys.exit(1)

    if not entries:
        print("❌ No subtitle entries generated")
        sys.exit(1)

    write_srt(entries, args.output)


if __name__ == "__main__":
    main()
