"""FFmpeg assembly helpers for scene clips with optional narration and music."""
import math
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


def _gain_text(value, maximum, label):
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} gain must be a number.") from exc
    if not 0 <= number <= maximum:
        raise ValueError(f"{label} gain must be between 0 and {maximum}.")
    return f"{number:.3f}".rstrip("0").rstrip(".") or "0"


def _validated_sound_effects(sound_effects):
    effects = list(sound_effects or [])
    if len(effects) > 6:
        raise ValueError("An export can contain at most six timed sound-effect cues.")
    validated = []
    for index, effect in enumerate(effects, start=1):
        if not isinstance(effect, dict) or not effect.get("path"):
            raise ValueError(f"Sound-effect cue {index} is invalid.")
        path = Path(effect["path"])
        if not path.is_file() or path.stat().st_size == 0:
            raise FileNotFoundError(f"Sound-effect cue {index} is missing or empty.")
        try:
            start = float(effect.get("start_seconds", 0))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Sound-effect cue {index} start time must be a number.") from exc
        if not math.isfinite(start) or not 0 <= start <= 900:
            raise ValueError(f"Sound-effect cue {index} start time must be between 0 and 900 seconds.")
        gain = _gain_text(effect.get("gain", 1.0), 2.0, f"Sound-effect cue {index}")
        validated.append({"path": path, "start_seconds": round(start, 3), "gain": gain})
    return validated


def build_audio_mux_command(ffmpeg, silent_video, output_path,
                            voiceover_path=None, music_path=None,
                            voiceover_gain=1.0, music_gain=0.18,
                            sound_effects=None):
    """Mix optional narration/music and up to six independently timed SFX cues."""
    effects = _validated_sound_effects(sound_effects)
    if not voiceover_path and not music_path and not effects:
        raise ValueError("At least one audio track is required.")
    if voiceover_path and (not Path(voiceover_path).is_file() or Path(voiceover_path).stat().st_size == 0):
        raise FileNotFoundError("The voiceover audio file is missing or empty.")
    if music_path and (not Path(music_path).is_file() or Path(music_path).stat().st_size == 0):
        raise FileNotFoundError("The background music file is missing or empty.")

    voice_gain = _gain_text(voiceover_gain, 2.0, "Voiceover")
    music_level = _gain_text(music_gain, 1.0, "Music")
    command = [str(ffmpeg), "-hide_banner", "-loglevel", "error", "-y", "-i", str(silent_video)]
    next_input = 1
    voice_index = None
    music_index = None
    if voiceover_path:
        voice_index = next_input
        command.extend(["-i", str(voiceover_path)])
        next_input += 1
    if music_path:
        music_index = next_input
        command.extend(["-stream_loop", "-1", "-i", str(music_path)])
        next_input += 1

    effect_inputs = []
    for effect in effects:
        effect_inputs.append(next_input)
        command.extend(["-i", str(effect["path"])])
        next_input += 1

    filters = []
    mix_labels = []
    if voice_index is not None:
        if music_index is not None:
            filters.append(
                f"[{voice_index}:a]aresample=48000,volume={voice_gain},apad,"
                "asplit=2[voice_mix][voice_sc]"
            )
        else:
            filters.append(
                f"[{voice_index}:a]aresample=48000,volume={voice_gain},apad[voice_mix]"
            )
        mix_labels.append("[voice_mix]")

    if music_index is not None:
        filters.append(f"[{music_index}:a]aresample=48000,volume={music_level}[music_raw]")
        if voice_index is not None:
            filters.append(
                "[music_raw][voice_sc]sidechaincompress="
                "threshold=0.03:ratio=8:attack=20:release=300[music_mix]"
            )
        else:
            filters.append("[music_raw]anull[music_mix]")
        mix_labels.append("[music_mix]")

    for cue_index, (effect, input_index) in enumerate(zip(effects, effect_inputs)):
        delay_ms = int(round(effect["start_seconds"] * 1000))
        label = f"sfx_{cue_index}"
        filters.append(
            f"[{input_index}:a]aresample=48000,volume={effect['gain']},"
            f"adelay={delay_ms}:all=1,apad[{label}]"
        )
        mix_labels.append(f"[{label}]")

    if len(mix_labels) == 1:
        filters.append(f"{mix_labels[0]}alimiter=limit=0.95[aout]")
    else:
        filters.append(
            "".join(mix_labels)
            + f"amix=inputs={len(mix_labels)}:duration=longest:"
              "dropout_transition=2,alimiter=limit=0.95[aout]"
        )

    command.extend([
        "-filter_complex", ";".join(filters),
        "-map", "0:v:0", "-map", "[aout]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-shortest", "-movflags", "+faststart", str(output_path),
    ])
    return command

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
                   work_dir, progress_callback=None, runner=subprocess.run,
                   voiceover_path=None, music_path=None,
                   voiceover_gain=1.0, music_gain=0.18,
                   sound_effects=None):
    """Normalize and join clips, then optionally mix narration and background music."""
    sources = [Path(path) for path in source_paths]
    if not sources:
        raise ValueError("Choose at least one completed scene clip.")
    if len(sources) > 30:
        raise ValueError("An export can contain at most 30 scene clips.")
    output_size(aspect_ratio)
    for source in sources:
        if not source.is_file() or source.stat().st_size == 0:
            raise FileNotFoundError("A selected scene clip is missing or empty.")
    for label, audio_path in (("Voiceover", voiceover_path), ("Background music", music_path)):
        if audio_path and (not Path(audio_path).is_file() or Path(audio_path).stat().st_size == 0):
            raise FileNotFoundError(f"{label} file is missing or empty.")
    effects = _validated_sound_effects(sound_effects)
    if voiceover_path:
        _gain_text(voiceover_gain, 2.0, "Voiceover")
    if music_path:
        _gain_text(music_gain, 1.0, "Music")

    work = Path(work_dir)
    work.mkdir(parents=True, exist_ok=True)
    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    normalized_paths = []

    for index, source in enumerate(sources, start=1):
        normalized = work / f"normalized-{index:03d}.mp4"
        if progress_callback:
            progress_callback(f"Preparing clip {index} of {len(sources)}…")
        _run(
            build_normalize_command(ffmpeg_path, source, normalized, aspect_ratio),
            timeout=300,
            runner=runner,
        )
        if not normalized.is_file() or normalized.stat().st_size == 0:
            raise RuntimeError(f"FFmpeg produced no normalized output for clip {index}.")
        normalized_paths.append(normalized)

    concat_list = work / "concat-list.txt"
    concat_list.write_text(
        "\n".join(_concat_entry(path) for path in normalized_paths) + "\n",
        encoding="utf-8",
    )
    has_audio = bool(voiceover_path or music_path or effects)
    joined_video = work / "joined-silent.mp4" if has_audio else destination
    if progress_callback:
        progress_callback("Joining the normalized clips into one video…")
    _run(
        build_concat_command(ffmpeg_path, concat_list, joined_video),
        timeout=600,
        runner=runner,
    )
    if not joined_video.is_file() or joined_video.stat().st_size == 0:
        raise RuntimeError("FFmpeg did not produce the joined video.")

    if has_audio:
        if progress_callback:
            progress_callback("Mixing voiceover and background music…")
        _run(
            build_audio_mux_command(
                ffmpeg_path, joined_video, destination,
                voiceover_path=voiceover_path, music_path=music_path,
                voiceover_gain=voiceover_gain, music_gain=music_gain,
                sound_effects=effects,
            ),
            timeout=600,
            runner=runner,
        )
    if not destination.is_file() or destination.stat().st_size == 0:
        raise RuntimeError("FFmpeg did not produce a finished MP4 export.")
    return destination
