"""FFmpeg assembly helpers for scene clips with optional narration and music."""
import json
import math
import subprocess
from pathlib import Path

from subtitle_tracks import subtitle_force_style

OUTPUT_SIZES = {
    "16:9": (1280, 720),
    "9:16": (720, 1280),
}


def output_size(aspect_ratio):
    try:
        return OUTPUT_SIZES[aspect_ratio]
    except KeyError as exc:
        raise ValueError("Assembly supports only 16:9 and 9:16 exports.") from exc


def _scene_seconds(value, label, maximum=3600):
    try:
        number = float(value or 0)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be a number.") from exc
    if not math.isfinite(number) or number < 0 or number > maximum:
        raise ValueError(f"{label} must be between 0 and {maximum} seconds.")
    return round(number, 3)


def normalize_scene_edits(scene_edits, source_durations):
    """Validate scene trims and outgoing transitions against measured source durations."""
    durations = list(source_durations or [])
    if not durations:
        raise ValueError("At least one source clip duration is required.")
    if scene_edits in (None, ""):
        scene_edits = []
    if isinstance(scene_edits, str):
        try:
            scene_edits = json.loads(scene_edits)
        except json.JSONDecodeError as exc:
            raise ValueError("Scene-edit settings are not valid JSON.") from exc
    if not isinstance(scene_edits, list):
        raise ValueError("Scene edits must be a list.")
    if not scene_edits:
        scene_edits = [{} for _ in durations]
    if len(scene_edits) != len(durations):
        raise ValueError("Provide one scene-edit setting for every selected clip.")

    normalized = []
    for index, (raw, source_duration) in enumerate(zip(scene_edits, durations)):
        scene_number = index + 1
        if raw is None:
            raw = {}
        if not isinstance(raw, dict):
            raise ValueError(f"Scene {scene_number} edit settings are invalid.")
        source_length = _scene_seconds(
            source_duration, f"Scene {scene_number} source duration", 3600
        )
        if source_length <= 0:
            raise ValueError(f"Scene {scene_number} has no measurable source duration.")
        trim_start = _scene_seconds(
            raw.get("trim_start_seconds", 0), f"Scene {scene_number} trim start"
        )
        requested_end = _scene_seconds(
            raw.get("trim_end_seconds", 0), f"Scene {scene_number} trim end"
        )
        trim_end = source_length if requested_end == 0 else requested_end
        if trim_start >= trim_end:
            raise ValueError(f"Scene {scene_number} trim end must be greater than trim start.")
        if trim_end > source_length + 0.001:
            raise ValueError(
                f"Scene {scene_number} trim end ({trim_end:.3f}s) exceeds its "
                f"measured source duration ({source_length:.3f}s)."
            )
        trim_end = min(trim_end, source_length)
        transition = str(raw.get("transition_after", "cut") or "cut").lower()
        if transition not in {"cut", "crossfade"}:
            raise ValueError(f"Scene {scene_number} transition must be cut or crossfade.")
        if index == len(durations) - 1 and transition != "cut":
            raise ValueError("The final scene cannot transition to a following scene.")
        if transition == "crossfade":
            transition_duration = _scene_seconds(
                raw.get("transition_duration_seconds", 0.5),
                f"Scene {scene_number} crossfade duration", 2
            )
            if transition_duration < 0.25:
                raise ValueError("Crossfade duration must be between 0.25 and 2 seconds.")
        else:
            transition_duration = 0
        normalized.append({
            "trim_start_seconds": trim_start,
            "trim_end_seconds": trim_end,
            "source_duration_seconds": source_length,
            "duration_seconds": round(trim_end - trim_start, 3),
            "transition_after": transition,
            "transition_duration_seconds": transition_duration,
        })

    for index, edit in enumerate(normalized):
        incoming = (
            normalized[index - 1]["transition_duration_seconds"]
            if index > 0 and normalized[index - 1]["transition_after"] == "crossfade"
            else 0
        )
        outgoing = edit["transition_duration_seconds"] if edit["transition_after"] == "crossfade" else 0
        if edit["duration_seconds"] <= incoming + outgoing + 0.01:
            raise ValueError(
                f"Scene {index + 1} is too short for its incoming and outgoing crossfades."
            )
    return normalized


def scene_edit_summary(scene_edits):
    edits = list(scene_edits or [])
    crossfades = sum(1 for edit in edits if edit.get("transition_after") == "crossfade")
    duration = sum(float(edit.get("duration_seconds") or 0) for edit in edits)
    duration -= sum(
        float(edit.get("transition_duration_seconds") or 0)
        for edit in edits if edit.get("transition_after") == "crossfade"
    )
    return {
        "crossfade_count": crossfades,
        "final_duration_seconds": round(max(0, duration), 3),
    }


def video_filter(aspect_ratio, trim_start_seconds=0, trim_end_seconds=None):
    width, height = output_size(aspect_ratio)
    filters = []
    start = _scene_seconds(trim_start_seconds, "Scene trim start")
    if trim_end_seconds is not None:
        end = _scene_seconds(trim_end_seconds, "Scene trim end")
        if end <= start:
            raise ValueError("Scene trim end must be greater than trim start.")
        filters.extend([
            f"trim=start={start:.3f}:end={end:.3f}",
            "setpts=PTS-STARTPTS",
        ])
    elif start:
        filters.extend([f"trim=start={start:.3f}", "setpts=PTS-STARTPTS"])
    filters.extend([
        f"scale={width}:{height}:force_original_aspect_ratio=decrease",
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black",
        "setsar=1", "fps=30", "format=yuv420p",
    ])
    return ",".join(filters)


def build_normalize_command(ffmpeg, input_path, output_path, aspect_ratio,
                            scene_edit=None):
    edit = scene_edit or {}
    trim_end = edit.get("trim_end_seconds")
    return [
        str(ffmpeg), "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(input_path),
        "-map", "0:v:0",
        "-vf", video_filter(
            aspect_ratio, edit.get("trim_start_seconds", 0), trim_end
        ),
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


def build_xfade_command(ffmpeg, input_paths, group_durations,
                        transition_durations, output_path):
    """Crossfade already-normalized video groups and encode one silent MP4."""
    paths = list(input_paths)
    durations = [float(value) for value in group_durations]
    transitions = [float(value) for value in transition_durations]
    if len(paths) < 2 or len(durations) != len(paths) or len(transitions) != len(paths) - 1:
        raise ValueError("Crossfade inputs, durations and transition settings do not match.")
    if any(not math.isfinite(value) or value <= 0 for value in durations):
        raise ValueError("Crossfade group durations must be positive.")
    if any(not math.isfinite(value) or value < 0.25 or value > 2 for value in transitions):
        raise ValueError("Crossfade durations must be between 0.25 and 2 seconds.")

    command = [str(ffmpeg), "-hide_banner", "-loglevel", "error", "-y"]
    for path in paths:
        command.extend(["-i", str(path)])
    filters = []
    current_label = "[0:v:0]"
    accumulated_duration = durations[0]
    for index, transition_duration in enumerate(transitions, start=1):
        offset = accumulated_duration - transition_duration
        if offset <= 0:
            raise ValueError("Crossfade offset must be positive.")
        output_label = f"xfade{index}"
        filters.append(
            f"{current_label}[{index}:v:0]xfade=transition=fade:"
            f"duration={transition_duration:.3f}:offset={offset:.3f}[{output_label}]"
        )
        current_label = f"[{output_label}]"
        accumulated_duration += durations[index] - transition_duration
    command.extend([
        "-filter_complex", ";".join(filters),
        "-map", current_label, "-an",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
        "-pix_fmt", "yuv420p", "-threads", "2",
        "-movflags", "+faststart", str(output_path),
    ])
    return command




def ensure_subtitles_filter(ffmpeg_path, runner=subprocess.run):
    """Fail early when the configured FFmpeg binary was built without libass."""
    try:
        result = runner(
            [str(ffmpeg_path), "-hide_banner", "-filters"],
            capture_output=True, text=True, timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError("Could not inspect FFmpeg subtitle support.") from exc
    output = (getattr(result, "stdout", "") or "") + "\n" + (getattr(result, "stderr", "") or "")
    has_filter = any(" subtitles " in f" {line.strip()} " for line in output.splitlines())
    if getattr(result, "returncode", 1) != 0 or not has_filter:
        raise RuntimeError(
            "Burned-in captions require an FFmpeg build with the subtitles filter "
            "and libass support (--enable-libass). Set FFMPEG_PATH to a full FFmpeg "
            "build or install one that includes libass; audio/video assembly without "
            "captions can still use the current FFmpeg binary."
        )
    return True


def build_subtitle_burn_command(ffmpeg, input_path, output_path, subtitle_path,
                                aspect_ratio, subtitle_style=None):
    """Burn a validated SRT file into the silent scene sequence using libass."""
    _width, height = output_size(aspect_ratio)
    subtitle_file = Path(subtitle_path)
    if not subtitle_file.is_file() or subtitle_file.stat().st_size == 0:
        raise FileNotFoundError("The subtitle file is missing or empty.")
    style = subtitle_force_style(subtitle_style, height)
    escaped_path = (
        str(subtitle_file.resolve())
        .replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\\'")
    )
    filter_graph = (
        f"subtitles=filename='{escaped_path}':"
        f"force_style='{style}'"
    )
    return [
        str(ffmpeg), "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(input_path),
        "-map", "0:v:0",
        "-vf", filter_graph,
        "-an",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
        "-pix_fmt", "yuv420p", "-threads", "2",
        "-movflags", "+faststart", str(output_path),
    ]


def _gain_text(value, maximum, label):
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} gain must be a number.") from exc
    if not math.isfinite(number) or not 0 <= number <= maximum:
        raise ValueError(f"{label} gain must be between 0 and {maximum}.")
    return f"{number:.3f}".rstrip("0").rstrip(".") or "0"


def _audio_processing_values(trim_start_seconds=0, trim_end_seconds=0,
                             fade_in_seconds=0, fade_out_start_seconds=0,
                             fade_out_seconds=0, label="Audio"):
    def number(value, field, maximum):
        try:
            parsed = float(value or 0)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{label} {field} must be a number.") from exc
        if not math.isfinite(parsed) or parsed < 0 or parsed > maximum:
            raise ValueError(f"{label} {field} must be between 0 and {maximum} seconds.")
        return round(parsed, 3)

    start = number(trim_start_seconds, "trim start", 3600)
    end = number(trim_end_seconds, "trim end", 3600)
    fade_in = number(fade_in_seconds, "fade-in", 10)
    fade_out_start = number(fade_out_start_seconds, "fade-out start", 3600)
    fade_out = number(fade_out_seconds, "fade-out", 10)
    if end and end <= start:
        raise ValueError(f"{label} trim end must be greater than trim start.")
    if end:
        segment_length = end - start
        if fade_in + fade_out > segment_length:
            raise ValueError(f"{label} fade durations cannot exceed the trimmed audio length.")
        if fade_out and fade_out_start + fade_out > segment_length:
            raise ValueError(f"{label} fade-out must finish within the trimmed audio segment.")
    return {
        "trim_start_seconds": start,
        "trim_end_seconds": end,
        "fade_in_seconds": fade_in,
        "fade_out_start_seconds": fade_out_start,
        "fade_out_seconds": fade_out,
    }


def _build_audio_track_filter(input_index, output_label, gain,
                              trim_start_seconds=0, trim_end_seconds=0,
                              fade_in_seconds=0, fade_out_start_seconds=0,
                              fade_out_seconds=0, label="Audio"):
    values = _audio_processing_values(
        trim_start_seconds, trim_end_seconds, fade_in_seconds,
        fade_out_start_seconds, fade_out_seconds, label
    )
    start = f"{values['trim_start_seconds']:.3f}".rstrip("0").rstrip(".") or "0"
    chain = [f"atrim=start={start}"]
    if values["trim_end_seconds"]:
        end = f"{values['trim_end_seconds']:.3f}".rstrip("0").rstrip(".")
        chain[0] += f":end={end}"
    chain.extend(["asetpts=PTS-STARTPTS", "aresample=48000"])
    if values["fade_in_seconds"]:
        fade_in = f"{values['fade_in_seconds']:.3f}".rstrip("0").rstrip(".") or "0"
        chain.append(f"afade=t=in:st=0:d={fade_in}")
    if values["fade_out_seconds"]:
        fade_out_start = f"{values['fade_out_start_seconds']:.3f}".rstrip("0").rstrip(".") or "0"
        fade_out = f"{values['fade_out_seconds']:.3f}".rstrip("0").rstrip(".") or "0"
        chain.append(f"afade=t=out:st={fade_out_start}:d={fade_out}")
    chain.append(f"volume={gain}")
    return f"[{input_index}:a]{','.join(chain)}[{output_label}]"


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
        processing = _audio_processing_values(
            effect.get("trim_start_seconds", 0),
            effect.get("trim_end_seconds", 0),
            effect.get("fade_in_seconds", 0),
            effect.get("fade_out_start_seconds", 0),
            effect.get("fade_out_seconds", 0),
            f"Sound-effect cue {index}",
        )
        validated.append({
            "path": path,
            "start_seconds": round(start, 3),
            "gain": gain,
            **processing,
        })
    return validated

def build_audio_mux_command(ffmpeg, silent_video, output_path,
                            voiceover_path=None, music_path=None,
                            voiceover_gain=1.0, music_gain=0.18,
                            sound_effects=None,
                            voiceover_trim_start_seconds=0,
                            voiceover_trim_end_seconds=0,
                            voiceover_fade_in_seconds=0,
                            voiceover_fade_out_start_seconds=0,
                            voiceover_fade_out_seconds=0,
                            music_trim_start_seconds=0,
                            music_trim_end_seconds=0,
                            music_fade_in_seconds=0,
                            music_fade_out_start_seconds=0,
                            music_fade_out_seconds=0):
    """Mix optional narration, music and timed SFX with per-track trims and fades."""
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
        filters.append(_build_audio_track_filter(
            voice_index, "voice_pre", voice_gain,
            voiceover_trim_start_seconds, voiceover_trim_end_seconds,
            voiceover_fade_in_seconds, voiceover_fade_out_start_seconds,
            voiceover_fade_out_seconds, "Voiceover"
        ))
        if music_index is not None:
            filters.append("[voice_pre]apad,asplit=2[voice_mix][voice_sc]")
        else:
            filters.append("[voice_pre]apad[voice_mix]")
        mix_labels.append("[voice_mix]")

    if music_index is not None:
        filters.append(_build_audio_track_filter(
            music_index, "music_raw", music_level,
            music_trim_start_seconds, music_trim_end_seconds,
            music_fade_in_seconds, music_fade_out_start_seconds,
            music_fade_out_seconds, "Music"
        ))
        if voice_index is not None:
            filters.append(
                "[music_raw][voice_sc]sidechaincompress="
                "threshold=0.03:ratio=8:attack=20:release=300[music_mix]"
            )
        else:
            filters.append("[music_raw]anull[music_mix]")
        mix_labels.append("[music_mix]")

    for cue_index, (effect, input_index) in enumerate(zip(effects, effect_inputs)):
        raw_label = f"sfx_raw_{cue_index}"
        filters.append(_build_audio_track_filter(
            input_index, raw_label, effect["gain"],
            effect["trim_start_seconds"], effect["trim_end_seconds"],
            effect["fade_in_seconds"], effect["fade_out_start_seconds"],
            effect["fade_out_seconds"], f"Sound-effect cue {cue_index + 1}"
        ))
        delay_ms = int(round(effect["start_seconds"] * 1000))
        label = f"sfx_{cue_index}"
        filters.append(f"[{raw_label}]adelay={delay_ms}:all=1,apad[{label}]")
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
                   sound_effects=None, scene_edits=None,
                   voiceover_trim_start_seconds=0,
                   voiceover_trim_end_seconds=0,
                   voiceover_fade_in_seconds=0,
                   voiceover_fade_out_start_seconds=0,
                   voiceover_fade_out_seconds=0,
                   music_trim_start_seconds=0,
                   music_trim_end_seconds=0,
                   music_fade_in_seconds=0,
                   music_fade_out_start_seconds=0,
                   music_fade_out_seconds=0,
                   subtitle_path=None, subtitle_style=None):
    """Trim, normalize, cut/crossfade clips, burn optional captions and mix audio."""
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
    if subtitle_path and (not Path(subtitle_path).is_file() or Path(subtitle_path).stat().st_size == 0):
        raise FileNotFoundError("The subtitle file is missing or empty.")
    if voiceover_path:
        _gain_text(voiceover_gain, 2.0, "Voiceover")
        _audio_processing_values(
            voiceover_trim_start_seconds, voiceover_trim_end_seconds,
            voiceover_fade_in_seconds, voiceover_fade_out_start_seconds,
            voiceover_fade_out_seconds, "Voiceover"
        )
    if music_path:
        _gain_text(music_gain, 1.0, "Music")
        _audio_processing_values(
            music_trim_start_seconds, music_trim_end_seconds,
            music_fade_in_seconds, music_fade_out_start_seconds,
            music_fade_out_seconds, "Music"
        )

    work = Path(work_dir)
    work.mkdir(parents=True, exist_ok=True)
    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if scene_edits is None:
        edits = [
            {
                "trim_start_seconds": 0,
                "trim_end_seconds": None,
                "duration_seconds": None,
                "transition_after": "cut",
                "transition_duration_seconds": 0,
            }
            for _ in sources
        ]
    else:
        edits = list(scene_edits)
        if len(edits) != len(sources):
            raise ValueError("Provide one validated scene edit for every source clip.")
        for index, edit in enumerate(edits):
            if not isinstance(edit, dict):
                raise ValueError(f"Scene {index + 1} edit settings are invalid.")
            if edit.get("transition_after", "cut") not in {"cut", "crossfade"}:
                raise ValueError(f"Scene {index + 1} transition is invalid.")
            if index == len(edits) - 1 and edit.get("transition_after") == "crossfade":
                raise ValueError("The final scene cannot crossfade to a following scene.")

    normalized_paths = []
    for index, (source, edit) in enumerate(zip(sources, edits), start=1):
        normalized = work / f"normalized-{index:03d}.mp4"
        if progress_callback:
            progress_callback(f"Trimming and preparing scene {index} of {len(sources)}…")
        _run(
            build_normalize_command(
                ffmpeg_path, source, normalized, aspect_ratio, scene_edit=edit
            ),
            timeout=300,
            runner=runner,
        )
        if not normalized.is_file() or normalized.stat().st_size == 0:
            raise RuntimeError(f"FFmpeg produced no normalized output for scene {index}.")
        normalized_paths.append(normalized)

    has_audio = bool(voiceover_path or music_path or effects)
    has_subtitles = bool(subtitle_path)
    joined_video = work / "joined-silent.mp4" if (has_audio or has_subtitles) else destination
    crossfade_indexes = [
        index for index, edit in enumerate(edits[:-1])
        if edit.get("transition_after") == "crossfade"
    ]
    if crossfade_indexes:
        groups = []
        current_paths = []
        current_indexes = []
        for index, normalized in enumerate(normalized_paths):
            current_paths.append(normalized)
            current_indexes.append(index)
            if index in crossfade_indexes:
                groups.append((current_paths, current_indexes))
                current_paths = []
                current_indexes = []
        if current_paths:
            groups.append((current_paths, current_indexes))

        group_paths = []
        group_durations = []
        transition_durations = []
        for group_number, (paths, indexes) in enumerate(groups, start=1):
            if len(paths) == 1:
                group_path = paths[0]
            else:
                group_path = work / f"cut-group-{group_number:03d}.mp4"
                group_list = work / f"cut-group-{group_number:03d}.txt"
                group_list.write_text(
                    "\n".join(_concat_entry(path) for path in paths) + "\n",
                    encoding="utf-8",
                )
                if progress_callback:
                    progress_callback(f"Joining hard-cut scenes in group {group_number}…")
                _run(
                    build_concat_command(ffmpeg_path, group_list, group_path),
                    timeout=600,
                    runner=runner,
                )
            group_paths.append(group_path)
            group_durations.append(sum(
                float(edits[index]["duration_seconds"]) for index in indexes
            ))
            last_index = indexes[-1]
            if last_index in crossfade_indexes:
                transition_durations.append(
                    float(edits[last_index]["transition_duration_seconds"])
                )

        if progress_callback:
            progress_callback("Applying the selected crossfade transitions…")
        _run(
            build_xfade_command(
                ffmpeg_path, group_paths, group_durations,
                transition_durations, joined_video
            ),
            timeout=600,
            runner=runner,
        )
    else:
        concat_list = work / "concat-list.txt"
        concat_list.write_text(
            "\n".join(_concat_entry(path) for path in normalized_paths) + "\n",
            encoding="utf-8",
        )
        if progress_callback:
            progress_callback("Joining the normalized clips with hard cuts…")
        _run(
            build_concat_command(ffmpeg_path, concat_list, joined_video),
            timeout=600,
            runner=runner,
        )

    if not joined_video.is_file() or joined_video.stat().st_size == 0:
        raise RuntimeError("FFmpeg did not produce the joined video.")

    video_for_audio = joined_video
    if has_subtitles:
        captioned_video = work / "captioned-silent.mp4" if has_audio else destination
        if progress_callback:
            progress_callback("Burning the approved subtitle cues into the video…")
        _run(
            build_subtitle_burn_command(
                ffmpeg_path, joined_video, captioned_video, subtitle_path,
                aspect_ratio, subtitle_style,
            ),
            timeout=600,
            runner=runner,
        )
        if not captioned_video.is_file() or captioned_video.stat().st_size == 0:
            raise RuntimeError("FFmpeg did not produce the captioned video. Check that the FFmpeg build includes the subtitles/libass filter.")
        video_for_audio = captioned_video

    if has_audio:
        if progress_callback:
            progress_callback("Trimming and mixing narration, music and sound effects…")
        _run(
            build_audio_mux_command(
                ffmpeg_path, video_for_audio, destination,
                voiceover_path=voiceover_path, music_path=music_path,
                voiceover_gain=voiceover_gain, music_gain=music_gain,
                sound_effects=effects,
                voiceover_trim_start_seconds=voiceover_trim_start_seconds,
                voiceover_trim_end_seconds=voiceover_trim_end_seconds,
                voiceover_fade_in_seconds=voiceover_fade_in_seconds,
                voiceover_fade_out_start_seconds=voiceover_fade_out_start_seconds,
                voiceover_fade_out_seconds=voiceover_fade_out_seconds,
                music_trim_start_seconds=music_trim_start_seconds,
                music_trim_end_seconds=music_trim_end_seconds,
                music_fade_in_seconds=music_fade_in_seconds,
                music_fade_out_start_seconds=music_fade_out_start_seconds,
                music_fade_out_seconds=music_fade_out_seconds,
            ),
            timeout=600,
            runner=runner,
        )
    if not destination.is_file() or destination.stat().st_size == 0:
        raise RuntimeError("FFmpeg did not produce a finished MP4 export.")
    return destination
