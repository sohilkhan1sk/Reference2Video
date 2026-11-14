"""FFmpeg assembly helpers for concatenating completed scene clips.

The first export pass deliberately uses hard cuts, a 30 fps H.264 video stream,
and no audio. Voiceover/music mixing is a separate, later pipeline stage.
"""
import subprocess
from pathlib import Path

OUTPUT_SIZES = {
    "16:9": (1280, 720),
    "9:16": (720, 1280),
}


def output_size(aspect_ratio):
    try:
        return OUTPUT_SIZES[aspect_ratio]
    except KeyError as exc:
        raise ValueError("Assembly supports only 16:9 and 9:16 exports.") from exc


def video_filter(aspect_ratio):
    width, height = output_size(aspect_ratio)
    # Fit the complete source frame inside the target canvas. Padding avoids
    # unexpectedly cropping faces or text when mixed-aspect clips are assembled.
    return (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,"
        "setsar=1,fps=30,format=yuv420p"
    )


def build_normalize_command(ffmpeg, input_path, output_path, aspect_ratio):
    return [
        str(ffmpeg), "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(input_path),
        "-map", "0:v:0",
        "-vf", video_filter(aspect_ratio),
        "-an",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
        "-pix_fmt", "yuv420p", "-threads", "2",
        "-movflags", "+faststart",
        str(output_path),
    ]


def _concat_entry(path):
    # The concat demuxer uses single-quoted paths with backslash escaping.
    normalized = str(Path(path).resolve()).replace("\\", "/")
    escaped = normalized.replace("'", "'\\''")
    return "file '" + escaped + "'"


def build_concat_command(ffmpeg, concat_list, output_path):
    return [
        str(ffmpeg), "-hide_banner", "-loglevel", "error", "-y",
        "-f", "concat", "-safe", "0", "-i", str(concat_list),
        "-map", "0:v:0", "-an", "-c:v", "copy",
        "-movflags", "+faststart", str(output_path),
    ]


def _run(command, timeout, runner):
    try:
        result = runner(command, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("FFmpeg took too long. Try fewer or shorter clips.") from exc
    if result.returncode != 0:
        details = (getattr(result, "stderr", "") or getattr(result, "stdout", "") or
                   "FFmpeg returned an unknown error.")[-1800:]
        raise RuntimeError("FFmpeg could not assemble this clip: " + details)


def assemble_clips(source_paths, output_path, aspect_ratio, ffmpeg_path,
                   work_dir, progress_callback=None, runner=subprocess.run):
    """Normalize completed clips, then concatenate them in the supplied order."""
    sources = [Path(path) for path in source_paths]
    if not sources:
        raise ValueError("Choose at least one completed scene clip.")
    if len(sources) > 30:
        raise ValueError("An export can contain at most 30 scene clips.")
    output_size(aspect_ratio)
    for source in sources:
        if not source.is_file() or source.stat().st_size == 0:
            raise FileNotFoundError("A selected scene clip is missing or empty.")

    work = Path(work_dir)
    work.mkdir(parents=True, exist_ok=True)
    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    normalized_paths = []

    for index, source in enumerate(sources, start=1):
        normalized = work / f"normalized-{index:03d}.mp4"
        if progress_callback:
            progress_callback(f"Preparing clip {index} of {len(sources)}…")
        command = build_normalize_command(
            ffmpeg_path, source, normalized, aspect_ratio
        )
        _run(command, timeout=300, runner=runner)
        if not normalized.is_file() or normalized.stat().st_size == 0:
            raise RuntimeError(f"FFmpeg produced no normalized output for clip {index}.")
        normalized_paths.append(normalized)

    concat_list = work / "concat-list.txt"
    concat_list.write_text(
        "\n".join(_concat_entry(path) for path in normalized_paths) + "\n",
        encoding="utf-8",
    )
    if progress_callback:
        progress_callback("Joining the normalized clips into one MP4…")
    _run(
        build_concat_command(ffmpeg_path, concat_list, destination),
        timeout=600,
        runner=runner,
    )
    if not destination.is_file() or destination.stat().st_size == 0:
        raise RuntimeError("FFmpeg did not produce a finished MP4 export.")
    return destination
