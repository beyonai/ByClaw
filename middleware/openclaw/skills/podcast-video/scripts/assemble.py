#!/usr/bin/env python3
"""
播客视频合成工具 — 将 PPTX + 音频 + 播客脚本合成为带底部字幕的 MP4

Pipeline:
  PPTX  ──LibreOffice──► PDF ──PyMuPDF──► PNG frames ─┐
  Audio ──────────────────────────────────────────────► ffmpeg ──► video.mp4
  Script + Timing ──generate_srt──► .srt ──ffmpeg──► subtitles burned in

Usage:
  python assemble.py --pptx slides.pptx --audio podcast.mp3 --output out.mp4
  python assemble.py --pptx slides.pptx --audio podcast.mp3 --output out.mp4 \\
      --script script.json --timing durations.json
  python assemble.py --pptx slides.pptx --audio podcast.mp3 --output out.mp4 \\
      --script script.json --slide-durations slide_durs.json

Dependencies (all required):
  - ffmpeg / ffprobe   (apt install ffmpeg)
  - LibreOffice        (apt install libreoffice)
  - PyMuPDF            (pip install --break-system-packages pymupdf)
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPTS_DIR = Path(__file__).parent


# ── Tool helpers ─────────────────────────────────────────────────────────────

def find_exe(candidates):
    for c in candidates:
        if shutil.which(c) or (Path(c).is_file() and os.access(c, os.X_OK)):
            return c
    return None


def run(cmd, **kwargs):
    return subprocess.run(cmd, capture_output=True, text=True, **kwargs)


def get_audio_duration(audio_file):
    r = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", str(audio_file)])
    if r.returncode == 0 and r.stdout.strip():
        return float(r.stdout.strip())
    raise RuntimeError(f"ffprobe failed on {audio_file}: {r.stderr}")


# ── Step 1: PPTX → frames ────────────────────────────────────────────────────

def pptx_to_frames(pptx_file, frames_dir, scale=2.0):
    """Convert PPTX to PNG frames via LibreOffice PDF + PyMuPDF."""
    try:
        import fitz
    except ImportError:
        raise RuntimeError(
            "PyMuPDF not found.\n"
            "  Install: pip install --break-system-packages pymupdf"
        )

    pptx_path = Path(pptx_file).resolve()
    frames_path = Path(frames_dir)
    frames_path.mkdir(parents=True, exist_ok=True)

    libreoffice = find_exe([
        "libreoffice", "soffice",
        "/usr/bin/libreoffice", "/usr/local/bin/libreoffice",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        "/opt/homebrew/bin/soffice",
    ])
    if not libreoffice:
        raise RuntimeError(
            "LibreOffice not found.\n"
            "  Linux: apt install libreoffice\n"
            "  macOS: brew install --cask libreoffice"
        )

    with tempfile.TemporaryDirectory() as tmpdir:
        print(f"  Converting PPTX → PDF (LibreOffice)...")
        r = run([libreoffice, "--headless", "--convert-to", "pdf",
                 "--outdir", tmpdir, str(pptx_path)], timeout=120)
        if r.returncode != 0:
            raise RuntimeError(f"LibreOffice failed:\n{r.stderr}")

        pdfs = list(Path(tmpdir).glob("*.pdf"))
        if not pdfs:
            raise RuntimeError(f"LibreOffice produced no PDF.\n{r.stdout}\n{r.stderr}")
        pdf_file = pdfs[0]

        print(f"  Rendering PDF → PNG frames (PyMuPDF, scale={scale}x)...")
        fitz.TOOLS.mupdf_display_errors(False)
        mat = fitz.Matrix(scale, scale)
        doc = fitz.open(str(pdf_file))
        frames = []
        for i, page in enumerate(doc):
            pix = page.get_pixmap(matrix=mat)
            out = frames_path / f"slide_{i+1:03d}.png"
            pix.save(str(out))
            frames.append(out)
        doc.close()

    print(f"  ✓ {len(frames)} frames ({frames[0].name} … {frames[-1].name})")
    return frames


# ── Step 2: Synthesize video ─────────────────────────────────────────────────

def synthesize_video(frames, audio_file, output_file, slide_durations=None, fps=25,
                     ass_file=None, crf=18, preset="slow"):
    """
    Combine slide frames + audio (+ optional burned-in subtitles) into MP4
    using a SINGLE libx264 encode pass for maximum visual quality.

    By accepting `ass_file`, we avoid the double-encode that used to happen when
    Step 4 (burn subtitles) re-encoded an already-encoded silent video. With the
    one-pass design, video pixels go straight from PNG → libx264 with no
    intermediate H.264 round-trip — preserving every pixel of detail.
    """
    num_frames = len(frames)
    audio_dur = get_audio_duration(audio_file)

    # Resolve per-slide durations
    if slide_durations is not None:
        if isinstance(slide_durations, list):
            dur_values = [d.get("duration", 0) if isinstance(d, dict) else float(d)
                         for d in slide_durations]
        elif isinstance(slide_durations, dict):
            dur_values = [float(v) for v in slide_durations.values()]
        else:
            dur_values = None
    else:
        dur_values = None

    if not dur_values or len(dur_values) != num_frames:
        if dur_values:
            print(f"  ⚠ Slide duration count ({len(dur_values)}) ≠ frame count ({num_frames}), using uniform")
        dur_values = [audio_dur / num_frames] * num_frames
        mode = "uniform"
    else:
        mode = "per-slide"

    sub_tag = " + burned subs" if ass_file else ""
    print(f"  Slides: {num_frames} | Audio: {audio_dur:.1f}s | Timing: {mode} | CRF {crf} / preset {preset}{sub_tag}")

    out_path = Path(output_file)

    # Build a filter_complex that loops each PNG for its slide duration, scales
    # it, then concatenates with the ass filter applied AFTER the concat.
    #
    # Why filter_complex instead of the concat demuxer:
    # The concat demuxer + ass filter combination was broken: subtitle updates
    # froze at the first dialogue for the duration of the first slide, then
    # jumped to a later dialogue. The ass filter relies on the input video's
    # monotonic PTS, and the concat demuxer re-anchors PTS per input causing
    # the ass filter to lose track of which subtitle to show.
    #
    # Using the concat FILTER (after per-slide looped image sources) gives
    # monotonic PTS and the ass filter updates correctly.

    # Build a filter_complex that loops each PNG for its slide duration, scales
    # it, then concatenates with the ass filter applied AFTER the concat.
    #
    # Why filter_complex instead of the concat demuxer:
    # The concat demuxer + ass filter combination was broken: subtitle updates
    # froze at the first dialogue for the duration of the first slide, then
    # jumped to a later dialogue. The ass filter relies on the input video's
    # monotonic PTS, and the concat demuxer re-anchors PTS per input causing
    # the ass filter to lose track of which subtitle to show.
    #
    # Using the concat FILTER (after per-slide looped image sources) gives
    # monotonic PTS and the ass filter updates correctly.

    inputs = []
    for frame, dur in zip(frames, dur_values):
        inputs.extend(["-loop", "1", "-t", f"{dur:.4f}", "-i", str(frame)])

    # Per-slide: scale to 1920x1080 with letterbox, trim to duration, reset PTS
    slide_chains = []
    for i in range(len(frames)):
        slide_chains.append(
            f"[{i}:v]scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,"
            f"pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,"
            f"trim=duration={dur_values[i]:.4f},setpts=PTS-STARTPTS[v{i}]"
        )

    # Concat all per-slide streams into one monotonic-PTS video,
    # then apply the ass filter so it sees proper monotonic timestamps.
    concat_inputs = "".join(f"[v{i}]" for i in range(len(frames)))
    if ass_file:
        ass_str = str(Path(ass_file).resolve()).replace("\\", "/").replace(":", "\\:")
        concat_chain = (
            f"{concat_inputs}concat=n={len(frames)}:v=1:a=0[vc];"
            f"[vc]ass='{ass_str}'[vout]"
        )
        output_map = "[vout]"
    else:
        concat_chain = f"{concat_inputs}concat=n={len(frames)}:v=1:a=0[vout]"
        output_map = "[vout]"

    filter_complex = ";".join(slide_chains + [concat_chain])

    print("  Encoding video (single pass, no intermediate re-encode)...")
    # Audio input is the LAST input (after the per-frame image inputs)
    audio_input_idx = len(frames)
    r = run([
        "ffmpeg", "-y",
        *inputs,
        "-i", str(audio_file),
        "-filter_complex", filter_complex,
        "-map", output_map,
        "-map", f"{audio_input_idx}:a:0",
        "-r", str(fps),
        "-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-pix_fmt", "yuv420p",
        "-x264-params", "ref=4:bframes=4",
        "-c:a", "aac", "-b:a", "192k", "-shortest",
        "-movflags", "+faststart",
        str(output_file)
    ], timeout=900)
    if r.returncode != 0:
        raise RuntimeError(f"Single-pass encode failed:\n{r.stderr[-800:]}")

    return str(output_file)


# ── Step 3: Generate SRT ──────────────────────────────────────────────────────

def generate_srt(script_file, output_srt, timing_file=None, audio_duration=None):
    """Call generate_srt.py to produce a subtitle file."""
    cmd = [sys.executable, str(SCRIPTS_DIR / "generate_srt.py"),
           script_file, output_srt]
    if timing_file:
        cmd += ["--timing", timing_file]
    elif audio_duration:
        cmd += ["--audio-duration", str(audio_duration)]
    else:
        raise RuntimeError("generate_srt needs --timing or --audio-duration")

    r = run(cmd)
    if r.returncode != 0:
        raise RuntimeError(f"SRT generation failed:\n{r.stdout}\n{r.stderr}")
    # Print output from the script
    if r.stdout.strip():
        for line in r.stdout.strip().splitlines():
            print(f"  {line}")
    return output_srt


# ── Step 4: Burn subtitles ────────────────────────────────────────────────────

def _srt_to_ass(srt_file, ass_file, font_size=16, margin_v=28):
    """
    Convert SRT → ASS and rewrite the style header for precise positioning.

    Uses PlayResY=1080 so MarginV is in actual pixels, placing the subtitle
    at the very bottom of the frame (near the page-number badge area).

    ASS Alignment=2 → bottom-center; MarginV=28 → 28 px from bottom edge.
    """
    import re

    # Let ffmpeg do the SRT→ASS conversion first
    r = run(["ffmpeg", "-y", "-i", str(srt_file), str(ass_file)], timeout=30)
    if r.returncode != 0:
        return False

    with open(ass_file, encoding="utf-8") as f:
        content = f.read()

    # Fix play resolution so MarginV is in real pixels
    content = re.sub(r"PlayResX:\s*\d+", "PlayResX: 1920", content)
    content = re.sub(r"PlayResY:\s*\d+", "PlayResY: 1080", content)

    # Rewrite the Default style:
    # Fields: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour,
    #         OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut,
    #         ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow,
    #         Alignment, MarginL, MarginR, MarginV, Encoding
    new_style = (
        f"Style: Default,"
        f"WenQuanYi Micro Hei,{font_size},"   # font + size
        f"&H00FFFFFF,"                          # PrimaryColour: white
        f"&H000000FF,"                          # SecondaryColour
        f"&H00000000,"                          # OutlineColour: black
        f"&H00000000,"                          # BackColour
        f"0,0,0,0,"                             # Bold Italic Underline StrikeOut
        f"100,100,0,0,"                         # ScaleX ScaleY Spacing Angle
        f"1,"                                   # BorderStyle: 1=outline
        f"1,0,"                                 # Outline Shadow
        f"2,"                                   # Alignment: 2=bottom-center
        f"20,20,{margin_v},"                    # MarginL MarginR MarginV
        f"1"                                    # Encoding
    )
    content = re.sub(r"Style: Default,.*", new_style, content)

    with open(ass_file, "w", encoding="utf-8") as f:
        f.write(content)
    return True


def burn_subtitles(video_file, srt_file, output_file):
    """Burn subtitles at the very bottom of the frame using ASS format."""
    work_dir = Path(output_file).parent
    safe_srt = work_dir / "_sub.srt"
    safe_ass = work_dir / "_sub.ass"
    shutil.copy2(srt_file, safe_srt)

    # ── Try ASS pipeline (precise positioning) ────────────────────────────
    if _srt_to_ass(safe_srt, safe_ass, font_size=56, margin_v=18):
        ass_str = str(safe_ass).replace("\\", "/")
        print("  Burning subtitles (ASS, bottom-strip style)...")
        r = run([
            "ffmpeg", "-y",
            "-i", str(video_file),
            "-vf", f"ass='{ass_str}'",
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "copy",
            str(output_file)
        ], timeout=600)
        safe_srt.unlink(missing_ok=True)
        safe_ass.unlink(missing_ok=True)
        if r.returncode == 0:
            return str(output_file)
        print(f"  ⚠ ASS burn failed: {r.stderr[-120:].strip()}")

    # ── Fallback: SRT with force_style (less precise) ─────────────────────
    safe_srt = work_dir / "_sub.srt"
    shutil.copy2(srt_file, safe_srt)
    srt_str = str(safe_srt).replace("\\", "/")
    style = "FontSize=16,Alignment=2,MarginV=28,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=1,Shadow=0,Bold=0"
    print("  Burning subtitles (SRT fallback)...")
    r = run([
        "ffmpeg", "-y",
        "-i", str(video_file),
        "-vf", f"subtitles='{srt_str}':force_style='{style}'",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "copy",
        str(output_file)
    ], timeout=600)
    safe_srt.unlink(missing_ok=True)
    if r.returncode != 0:
        raise RuntimeError(f"Subtitle burn failed:\n{r.stderr[-800:]}")
    return str(output_file)


# ── Slide duration computation ────────────────────────────────────────────────

def compute_slide_durations_from_annotations(script_turns, timing_turns, num_frames):
    """
    Derive per-slide video durations from turn-level timing + slide annotations.

    Supports two timing formats:
    - Turn-level: len(timing_turns) == len(script_turns), slide annotation on script_turns
    - Sentence-level: len(timing_turns) > len(script_turns), each timing entry has
      'turn_index' + 'slide' fields (sentence-mode TTS output)

    Returns an ordered list of num_frames durations, or None if annotations are absent.
    """
    slide_durs: dict[int, float] = {}

    is_sentence_level = (
        len(timing_turns) > len(script_turns)
        and any(t.get("slide") is not None for t in timing_turns)
    )

    if is_sentence_level:
        # Sentence-level: each timing entry already carries a slide field
        for t in timing_turns:
            slide = t.get("slide")
            if slide is None:
                continue
            n = int(slide)
            slide_durs[n] = slide_durs.get(n, 0.0) + float(t.get("duration", 0))
    else:
        # Turn-level: require matching counts
        if len(script_turns) != len(timing_turns):
            return None
        has_annotations = any(t.get("slide") is not None for t in script_turns)
        if not has_annotations:
            return None
        for turn, timing in zip(script_turns, timing_turns):
            slide = turn.get("slide")
            if slide is None:
                continue
            n = int(slide)
            slide_durs[n] = slide_durs.get(n, 0.0) + float(timing.get("duration", 0))

    if not slide_durs:
        return None

    max_slide = max(slide_durs.keys())
    if max_slide > num_frames:
        print(f"  ⚠ Script references slide {max_slide} but only {num_frames} frames — ignoring annotations")
        return None

    # Fill gaps (slides with no annotated turns get a minimal hold)
    total_audio = sum(timing.get("duration", 0) for timing in timing_turns)
    gap_fill = max(total_audio / num_frames * 0.5, 1.0)  # half-average, min 1s

    dur_list = []
    for i in range(1, num_frames + 1):
        dur_list.append(slide_durs.get(i, gap_fill))

    # Print breakdown
    print(f"  Per-slide durations from script annotations ({len(slide_durs)}/{num_frames} annotated):")
    for i, d in enumerate(dur_list, 1):
        tag = "  ← gap-fill" if i not in slide_durs else ""
        print(f"    Slide {i:2d}: {d:5.1f}s{tag}")

    return dur_list


def load_script_and_timing(script_path, timing_path):
    """Load and return (script_turns, timing_turns). Returns ([], []) on failure."""
    script_turns, timing_turns = [], []
    try:
        with open(script_path, encoding="utf-8") as f:
            data = json.load(f)
        script_turns = data if isinstance(data, list) else data.get("script", [])
    except Exception as e:
        print(f"  ⚠ Could not load script: {e}")

    if timing_path:
        try:
            with open(timing_path, encoding="utf-8") as f:
                timing_turns = json.load(f)
        except Exception as e:
            print(f"  ⚠ Could not load timing: {e}")

    return script_turns, timing_turns


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(
        description="Compose podcast video: PPTX + audio [+ script] → MP4 with subtitles"
    )
    p.add_argument("--pptx", required=True, help="PPTX slide file")
    p.add_argument("--audio", required=True, help="Audio file (MP3/WAV/M4A)")
    p.add_argument("--output", required=True, help="Output MP4 path")
    p.add_argument("--script", help="Script JSON (podcast-script-generator output) — enables subtitles")
    p.add_argument("--timing", help="Per-turn TTS timing JSON (with start/duration) — for precise subtitle sync and slide timing")
    p.add_argument("--slide-durations", help="Per-slide duration JSON — manual override for slide timing")
    p.add_argument("--fps", type=int, default=25)
    p.add_argument("--scale", type=float, default=5.333,
                   help="PDF render scale. 2.667x = exact 1920x1080. 5.333x = 4K super-sampled then "
                        "downscaled with lanczos for max quality (default).")
    p.add_argument("--crf", type=int, default=18,
                   help="H.264 CRF, lower = higher quality. 18 = visually lossless (default), 23 = default ffmpeg, 28 = web-ish.")
    p.add_argument("--preset", default="slow",
                   help="x264 preset. slow (default) = better compression at same quality. medium for faster runs.")
    args = p.parse_args()

    out_path = Path(args.output).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    print("=" * 56)
    print("🎬  播客视频合成")
    print("=" * 56)

    # ─ Step 1: PPTX → frames ─────────────────────────────
    frames_dir = out_path.parent / "_frames"
    print(f"\n▶ Step 1/3  PPTX → 幻灯片帧")
    frames = pptx_to_frames(args.pptx, frames_dir, scale=args.scale)

    # ─ Determine slide durations (priority: manual > auto-computed > uniform) ─
    slide_durations = None

    if args.slide_durations:
        # Manual override takes priority
        with open(args.slide_durations) as f:
            slide_durations = json.load(f)
        print(f"\n  Slide timing: manual override ({args.slide_durations})")

    elif args.script and args.timing:
        # Auto-compute from script slide annotations + turn timing
        print(f"\n  Attempting per-slide timing from script annotations...")
        script_turns, timing_turns = load_script_and_timing(args.script, args.timing)
        computed = compute_slide_durations_from_annotations(script_turns, timing_turns, len(frames))
        if computed:
            slide_durations = computed
            print(f"  ✓ Slide timing: computed from script annotations")
        else:
            print(f"  ⚠ No slide annotations in script — falling back to uniform timing")
            print(f"    To fix: run podcast-script-generator with PPTX input to get slide annotations")
    else:
        print(f"\n  Slide timing: uniform (provide --script + --timing with slide annotations for exact sync)")

    # ─ Step 2: Generate SRT → ASS (subtitles prepared before encoding) ──
    ass_file = None
    if args.script:
        print(f"\n▶ Step 2/3  生成字幕 SRT → ASS")
        srt_file = out_path.parent / "_subtitles.srt"
        ass_file = out_path.parent / "_subtitles.ass"
        try:
            audio_dur = get_audio_duration(args.audio)
            generate_srt(args.script, str(srt_file),
                        timing_file=args.timing, audio_duration=audio_dur)
            if not _srt_to_ass(srt_file, ass_file, font_size=56, margin_v=18):
                print("  ⚠ ASS conversion failed, falling back to no subtitles")
                ass_file = None
        except Exception as e:
            print(f"  ⚠ Subtitle generation failed: {e}")
            ass_file = None

    # ─ Step 3: Single-pass encode (slides + audio + burned subs) ─────────
    print(f"\n▶ Step 3/3  单次编码 (slides + audio{' + 字幕' if ass_file else ''})")
    synthesize_video(
        frames, args.audio, str(out_path),
        slide_durations=slide_durations,
        fps=args.fps,
        ass_file=str(ass_file) if ass_file else None,
        crf=args.crf,
        preset=args.preset,
    )

    # ─ Cleanup ───────────────────────────────────────────
    if ass_file:
        Path(ass_file).unlink(missing_ok=True)
        srt_file_p = out_path.parent / "_subtitles.srt"
        srt_file_p.unlink(missing_ok=True)
    shutil.rmtree(frames_dir, ignore_errors=True)

    # ─ Report ─────────────────────────────────────────────
    print(f"\n{'=' * 56}")
    if out_path.exists():
        size_mb = out_path.stat().st_size / 1024 / 1024
        r = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "csv=p=0", str(out_path)])
        dur_str = f"{float(r.stdout.strip()):.1f}s" if r.returncode == 0 and r.stdout.strip() else "?"
        print(f"✅  完成!")
        print(f"📁  {out_path}")
        print(f"📊  {size_mb:.1f} MB | {dur_str}")
    else:
        print("❌  输出文件未生成，请检查上方错误信息。")
    print("=" * 56)


if __name__ == "__main__":
    main()
