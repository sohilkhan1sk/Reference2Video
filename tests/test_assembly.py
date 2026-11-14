import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from assembly import (
    assemble_clips,
    build_concat_command,
    build_normalize_command,
    output_size,
    video_filter,
)


class AssemblyTests(unittest.TestCase):
    def test_export_dimensions_and_padding_filter(self):
        self.assertEqual(output_size("16:9"), (1280, 720))
        self.assertEqual(output_size("9:16"), (720, 1280))
        self.assertIn("force_original_aspect_ratio=decrease", video_filter("9:16"))
        self.assertIn("pad=720:1280", video_filter("9:16"))
        with self.assertRaises(ValueError):
            output_size("1:1")

    def test_normalization_drops_audio_and_encodes_h264(self):
        command = build_normalize_command("ffmpeg", "in.mp4", "out.mp4", "16:9")
        self.assertIn("-an", command)
        self.assertIn("libx264", command)
        self.assertIn("1280:720", command[command.index("-vf") + 1])

    def test_concat_command_uses_concat_demuxer_and_stream_copy(self):
        command = build_concat_command("ffmpeg", "list.txt", "final.mp4")
        self.assertEqual(command[command.index("-f") + 1], "concat")
        self.assertIn("copy", command)
        self.assertIn("-an", command)

    def test_assemble_clips_normalizes_and_concatenates_in_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_a = root / "a.mp4"
            source_b = root / "b.mp4"
            source_a.write_bytes(b"source-a")
            source_b.write_bytes(b"source-b")
            output = root / "exports" / "final.mp4"
            calls = []

            def fake_runner(command, **kwargs):
                calls.append(command)
                Path(command[-1]).parent.mkdir(parents=True, exist_ok=True)
                Path(command[-1]).write_bytes(b"fake-mp4")
                return SimpleNamespace(returncode=0, stderr="", stdout="")

            result = assemble_clips(
                [source_a, source_b], output, "9:16", "ffmpeg",
                root / "work", runner=fake_runner,
            )
            self.assertEqual(result, output)
            self.assertEqual(len(calls), 3)
            self.assertIn("720:1280", calls[0][calls[0].index("-vf") + 1])
            self.assertIn("-an", calls[0])
            concat_list = root / "work" / "concat-list.txt"
            entries = concat_list.read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(entries), 2)
            self.assertIn("normalized-001.mp4", entries[0])
            self.assertIn("normalized-002.mp4", entries[1])
            self.assertTrue(output.is_file())

    def test_empty_or_missing_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaises(ValueError):
                assemble_clips([], root / "out.mp4", "16:9", "ffmpeg", root / "work")
            missing = root / "missing.mp4"
            with self.assertRaises(FileNotFoundError):
                assemble_clips([missing], root / "out.mp4", "16:9", "ffmpeg", root / "work")


if __name__ == "__main__":
    unittest.main()
