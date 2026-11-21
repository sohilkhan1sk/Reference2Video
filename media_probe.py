"""Read measured video metadata from generated media with ffprobe."""
import json
import math
import subprocess
from pathlib import Path


def _positive_float(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def _positive_int(value):
    try:
        number = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if number > 0 else None


def _frame_rate(value):
    if value in (None, "", "N/A", "0/0"):
        return None
    try:
        text = str(value)
        if "/" in text:
            numerator, denominator = text.split("/", 1)
            denominator_value = float(denominator)
            if denominator_value == 0:
                return None
            rate = float(numerator) / denominator_value
        else:
            rate = float(text)
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    if not math.isfinite(rate) or rate <= 0:
        return None
    return round(rate, 3)


def probe_media(media_path, ffprobe_path, runner=subprocess.run, timeout=25):
    """Return measured duration, dimensions, frame rate, codec and audio presence."""
    path = Path(media_path)
    if not path.is_file() or path.stat().st_size <= 0:
        raise FileNotFoundError("The generated video file is missing or empty.")
    command = [
        str(ffprobe_path), "-v", "error",
        "-show_entries",
        "format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,duration",
        "-of", "json", str(path),
    ]
    try:
        result = runner(command, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("ffprobe timed out while reading the generated MP4.") from exc
    if result.returncode != 0:
        details = (getattr(result, "stderr", "") or getattr(result, "stdout", "") or
                   "ffprobe returned an unknown error.")[-1200:]
        raise RuntimeError("Could not inspect the generated MP4: " + details)
    try:
        payload = json.loads(result.stdout or "{}")
    except (TypeError, json.JSONDecodeError) as exc:
        raise RuntimeError("ffprobe returned invalid JSON for the generated MP4.") from exc
    streams = payload.get("streams")
    if not isinstance(streams, list):
        streams = []
    video = next(
        (stream for stream in streams
         if isinstance(stream, dict) and stream.get("codec_type") == "video"),
        None,
    )
    if video is None:
        raise RuntimeError("The generated file does not contain a video stream.")
    format_info = payload.get("format")
    if not isinstance(format_info, dict):
        format_info = {}
    duration = _positive_float(format_info.get("duration")) or _positive_float(video.get("duration"))
    if duration is None:
        raise RuntimeError("ffprobe could not determine the generated video's duration.")
    width = _positive_int(video.get("width"))
    height = _positive_int(video.get("height"))
    if width is None or height is None:
        raise RuntimeError("ffprobe could not determine the generated video's dimensions.")
    frame_rate = _frame_rate(video.get("avg_frame_rate")) or _frame_rate(video.get("r_frame_rate"))
    has_audio = any(
        isinstance(stream, dict) and stream.get("codec_type") == "audio"
        for stream in streams
    )
    return {
        "actual_duration_seconds": round(duration, 3),
        "actual_width": width,
        "actual_height": height,
        "actual_frame_rate": frame_rate,
        "actual_video_codec": str(video.get("codec_name") or "")[:40] or None,
        "actual_has_audio": has_audio,
    }
