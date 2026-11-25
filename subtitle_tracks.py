"""Validation and SRT serialization for manually authored subtitle cues."""
import json
import math
from pathlib import Path

MAX_SUBTITLE_CUES = 200
MAX_SUBTITLE_TEXT_LENGTH = 220
MAX_SUBTITLE_LINE_LENGTH = 100
MAX_SUBTITLE_SECONDS = 3600

_POSITION_ALIGNMENT = {"bottom": 2, "middle": 5, "top": 8}
_COLOR_ASS = {
    "white": "&H00FFFFFF",
    "yellow": "&H0000FFFF",
    "cyan": "&H00FFFF00",
}


def _seconds(value, label):
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be a number.") from exc
    if not math.isfinite(number) or number < 0 or number > MAX_SUBTITLE_SECONDS:
        raise ValueError(f"{label} must be between 0 and {MAX_SUBTITLE_SECONDS} seconds.")
    return round(number, 3)


def normalize_subtitle_style(style=None):
    """Return a small allow-listed style object; never pass arbitrary ASS options through."""
    if style in (None, ""):
        style = {}
    if not isinstance(style, dict):
        raise ValueError("Subtitle style settings are invalid.")

    position = str(style.get("position", "bottom")).lower()
    if position not in _POSITION_ALIGNMENT:
        raise ValueError("Subtitle position must be top, middle or bottom.")

    color = str(style.get("color", "white")).lower()
    if color not in _COLOR_ASS:
        raise ValueError("Subtitle color must be white, yellow or cyan.")

    try:
        size_ratio = float(style.get("font_size_ratio", 0.045))
    except (TypeError, ValueError) as exc:
        raise ValueError("Subtitle size must be a number.") from exc
    if not math.isfinite(size_ratio) or not 0.025 <= size_ratio <= 0.08:
        raise ValueError("Subtitle size must be between 2.5% and 8% of the output height.")

    return {
        "position": position,
        "color": color,
        "font_size_ratio": round(size_ratio, 4),
    }


def subtitle_force_style(style, output_height):
    """Build a fixed, allow-listed libass style scaled to the selected export height."""
    normalized = normalize_subtitle_style(style)
    try:
        height = int(output_height)
    except (TypeError, ValueError) as exc:
        raise ValueError("Subtitle output height is invalid.") from exc
    if height < 1:
        raise ValueError("Subtitle output height must be positive.")

    font_size = max(16, round(height * normalized["font_size_ratio"]))
    outline = max(1, round(height * 0.003))
    margin = max(16, round(height * 0.06))
    alignment = _POSITION_ALIGNMENT[normalized["position"]]
    primary = _COLOR_ASS[normalized["color"]]
    return (
        "FontName=DejaVu Sans,"
        f"FontSize={font_size},"
        f"PrimaryColour={primary},"
        "OutlineColour=&H00000000,"
        "BorderStyle=1,"
        f"Outline={outline},"
        "Shadow=0,"
        f"Alignment={alignment},"
        f"MarginV={margin},"
        "Bold=1,"
        "WrapStyle=2"
    )


def normalize_subtitles(raw_value, final_duration_seconds):
    """Validate up to 200 timed caption cues against the trimmed export duration."""
    if raw_value in (None, ""):
        return None
    if isinstance(raw_value, str):
        try:
            raw_value = json.loads(raw_value)
        except json.JSONDecodeError as exc:
            raise ValueError("Subtitle settings are not valid JSON.") from exc
    if not isinstance(raw_value, dict):
        raise ValueError("Subtitle settings must be an object.")

    captions = raw_value.get("captions", [])
    if not isinstance(captions, list):
        raise ValueError("Subtitle captions must be a list.")
    if not captions:
        return None
    if len(captions) > MAX_SUBTITLE_CUES:
        raise ValueError(f"An export can contain at most {MAX_SUBTITLE_CUES} subtitle cues.")

    final_duration = _seconds(final_duration_seconds, "Final export duration")
    if final_duration <= 0:
        raise ValueError("The final export duration is not available for subtitle timing.")

    normalized = []
    for index, cue in enumerate(captions, start=1):
        if not isinstance(cue, dict):
            raise ValueError(f"Subtitle cue {index} is invalid.")
        start = _seconds(cue.get("start_seconds", 0), f"Subtitle cue {index} start")
        end = _seconds(cue.get("end_seconds", 0), f"Subtitle cue {index} end")
        if end <= start:
            raise ValueError(f"Subtitle cue {index} end must be greater than its start.")
        if end > final_duration + 0.001:
            raise ValueError(
                f"Subtitle cue {index} ends at {end:.3f}s, beyond the "
                f"{final_duration:.3f}s export timeline."
            )

        text = cue.get("text", "")
        if not isinstance(text, str):
            raise ValueError(f"Subtitle cue {index} text must be plain text.")
        text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\t", " ")
        text = "\n".join(line.strip() for line in text.split("\n")).strip()
        if not text:
            raise ValueError(f"Subtitle cue {index} text cannot be empty.")
        if len(text) > MAX_SUBTITLE_TEXT_LENGTH:
            raise ValueError(
                f"Subtitle cue {index} text must be {MAX_SUBTITLE_TEXT_LENGTH} characters or fewer."
            )
        lines = text.split("\n")
        if len(lines) > 2 or any(len(line) > MAX_SUBTITLE_LINE_LENGTH for line in lines):
            raise ValueError(
                f"Subtitle cue {index} must contain at most two lines of "
                f"{MAX_SUBTITLE_LINE_LENGTH} characters each."
            )
        if any(ord(char) < 32 for char in text if char != "\n"):
            raise ValueError(f"Subtitle cue {index} contains unsupported control characters.")

        # SRT is parsed by libass. Full-width braces prevent user text from injecting
        # ASS override blocks such as {\an8} while preserving their visible meaning.
        text = (
            text.replace("\\", "＼")
            .replace("{", "｛").replace("}", "｝")
            .replace("<", "＜").replace(">", "＞")
        )
        normalized.append({
            "start_seconds": start,
            "end_seconds": end,
            "text": text,
        })

    normalized.sort(key=lambda cue: (cue["start_seconds"], cue["end_seconds"]))
    return {
        "captions": normalized,
        "style": normalize_subtitle_style(raw_value.get("style")),
    }


def _srt_timestamp(seconds):
    milliseconds = int(round(float(seconds) * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    whole_seconds, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{whole_seconds:02d},{millis:03d}"


def write_srt_file(captions, output_path):
    """Write already-validated cues as UTF-8 SubRip subtitles."""
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    blocks = []
    for index, cue in enumerate(captions or [], start=1):
        blocks.append(
            f"{index}\n"
            f"{_srt_timestamp(cue['start_seconds'])} --> "
            f"{_srt_timestamp(cue['end_seconds'])}\n"
            f"{cue['text']}"
        )
    path.write_text("\n\n".join(blocks) + ("\n" if blocks else ""), encoding="utf-8")
    return path
