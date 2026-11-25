"""Smoke-test real subtitle burn-in with the same bundled FFmpeg used by the app."""
import subprocess
import sys
import tempfile
from pathlib import Path

from assembly import build_subtitle_burn_command, ensure_subtitles_filter


def run(command):
    result = subprocess.run(
        command, capture_output=True, text=True, timeout=90
    )
    if result.returncode:
        details = (result.stderr or result.stdout or "unknown FFmpeg error")[-2500:]
        raise RuntimeError(details)


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python tests/smoke_subtitle_ffmpeg.py /path/to/ffmpeg")
    ffmpeg = Path(sys.argv[1])
    if not ffmpeg.is_file():
        raise SystemExit(f"FFmpeg binary not found: {ffmpeg}")
    ensure_subtitles_filter(ffmpeg)

    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        for aspect, dimensions in (("16:9", "320x180"), ("9:16", "180x320")):
            source = root / f"source-{aspect.replace(':', '-')}.mp4"
            subtitle_file = root / "captions.srt"
            output = root / f"captioned-{aspect.replace(':', '-')}.mp4"
            subtitle_file.write_text(
                "1\n00:00:00,200 --> 00:00:01,200\nReference2Video captions\n",
                encoding="utf-8",
            )
            run([
                str(ffmpeg), "-hide_banner", "-loglevel", "error", "-y",
                "-f", "lavfi", "-i", f"color=c=navy:s={dimensions}:r=30",
                "-t", "1.5", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                str(source),
            ])
            command = build_subtitle_burn_command(
                ffmpeg, source, output, subtitle_file, aspect,
                {"position": "bottom", "color": "white", "font_size_ratio": 0.045},
            )
            run(command)
            if not output.is_file() or output.stat().st_size < 1024:
                raise RuntimeError(f"FFmpeg produced no captioned {aspect} MP4.")
            print(f"Subtitle burn-in passed for {aspect}: {output.stat().st_size} bytes")


if __name__ == "__main__":
    main()
