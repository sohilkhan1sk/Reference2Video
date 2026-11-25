import tempfile
import unittest
from pathlib import Path

from subtitle_tracks import (
    normalize_subtitle_style,
    normalize_subtitles,
    subtitle_force_style,
    write_srt_file,
)


class SubtitleTrackTests(unittest.TestCase):
    def test_normalizes_and_sorts_caption_cues(self):
        result = normalize_subtitles({
            "captions": [
                {"start_seconds": 2, "end_seconds": 3.5, "text": "Second"},
                {"start_seconds": 0.25, "end_seconds": 1.75, "text": "First"},
            ]
        }, 5)
        self.assertEqual([cue["text"] for cue in result["captions"]], ["First", "Second"])
        self.assertEqual(result["style"]["position"], "bottom")

    def test_rejects_bad_ranges_and_cues_past_final_timeline(self):
        with self.assertRaisesRegex(ValueError, "greater than"):
            normalize_subtitles({"captions": [
                {"start_seconds": 2, "end_seconds": 2, "text": "Bad"}
            ]}, 5)
        with self.assertRaisesRegex(ValueError, "beyond"):
            normalize_subtitles({"captions": [
                {"start_seconds": 4, "end_seconds": 5.1, "text": "Late"}
            ]}, 5)

    def test_rejects_empty_or_oversized_caption_text(self):
        with self.assertRaisesRegex(ValueError, "cannot be empty"):
            normalize_subtitles({"captions": [
                {"start_seconds": 0, "end_seconds": 1, "text": "  "}
            ]}, 5)
        with self.assertRaisesRegex(ValueError, "characters or fewer"):
            normalize_subtitles({"captions": [
                {"start_seconds": 0, "end_seconds": 1, "text": "x" * 221}
            ]}, 5)

    def test_rejects_more_than_two_lines_and_too_many_cues(self):
        with self.assertRaisesRegex(ValueError, "at most two lines"):
            normalize_subtitles({"captions": [
                {"start_seconds": 0, "end_seconds": 1, "text": "one\ntwo\nthree"}
            ]}, 5)
        cues = [{"start_seconds": 0, "end_seconds": 1, "text": "x"}] * 201
        with self.assertRaisesRegex(ValueError, "at most 200"):
            normalize_subtitles({"captions": cues}, 5)

    def test_prevents_ass_override_blocks_in_user_text(self):
        result = normalize_subtitles({"captions": [
            {"start_seconds": 0, "end_seconds": 1, "text": r"{\an8}Hello"}
        ]}, 2)
        self.assertEqual(result["captions"][0]["text"], "｛\\an8｝Hello")

    def test_style_is_allow_listed_and_scales_to_output_height(self):
        style = normalize_subtitle_style({
            "position": "top", "color": "yellow", "font_size_ratio": 0.05
        })
        landscape = subtitle_force_style(style, 720)
        portrait = subtitle_force_style(style, 1280)
        self.assertIn("Alignment=8", landscape)
        self.assertIn("PrimaryColour=&H0000FFFF", landscape)
        self.assertIn("FontSize=36", landscape)
        self.assertIn("FontSize=64", portrait)
        with self.assertRaisesRegex(ValueError, "position"):
            normalize_subtitle_style({"position": "javascript:alert(1)"})
        with self.assertRaisesRegex(ValueError, "between 2.5%"):
            normalize_subtitle_style({"font_size_ratio": 0.5})

    def test_writes_srt_timestamps_and_multiline_text(self):
        cues = normalize_subtitles({"captions": [
            {"start_seconds": 1.125, "end_seconds": 2.75, "text": "Line one\nLine two"}
        ]}, 4)["captions"]
        with tempfile.TemporaryDirectory() as tmp:
            path = write_srt_file(cues, Path(tmp) / "captions.srt")
            content = path.read_text(encoding="utf-8")
        self.assertIn("00:00:01,125 --> 00:00:02,750", content)
        self.assertIn("Line one\nLine two", content)


if __name__ == "__main__":
    unittest.main()
