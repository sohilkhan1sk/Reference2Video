import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from media_probe import probe_media


class MediaProbeTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.path = Path(self.tempdir.name) / "clip.mp4"
        self.path.write_bytes(b"synthetic-mp4-placeholder")

    def tearDown(self):
        self.tempdir.cleanup()

    def runner_for(self, payload, returncode=0, stderr=""):
        return Mock(return_value=type("Result", (), {
            "returncode": returncode, "stdout": json.dumps(payload), "stderr": stderr
        })())

    def test_reads_container_duration_video_metadata_and_audio_presence(self):
        runner = self.runner_for({
            "format": {"duration": "5.417"},
            "streams": [
                {"codec_type": "video", "codec_name": "h264", "width": 720,
                 "height": 1280, "avg_frame_rate": "30000/1001", "duration": "5.4"},
                {"codec_type": "audio", "codec_name": "aac"},
            ],
        })
        result = probe_media(self.path, "/usr/bin/ffprobe", runner=runner)
        self.assertEqual(result["actual_duration_seconds"], 5.417)
        self.assertEqual(result["actual_width"], 720)
        self.assertEqual(result["actual_height"], 1280)
        self.assertEqual(result["actual_video_codec"], "h264")
        self.assertAlmostEqual(result["actual_frame_rate"], 29.97, places=2)
        self.assertTrue(result["actual_has_audio"])
        self.assertEqual(runner.call_args.args[0][0], "/usr/bin/ffprobe")

    def test_falls_back_to_video_stream_duration_and_r_frame_rate(self):
        runner = self.runner_for({
            "format": {},
            "streams": [{"codec_type": "video", "codec_name": "hevc",
                         "width": "1920", "height": "1080",
                         "r_frame_rate": "24/1", "duration": "8.25"}],
        })
        result = probe_media(self.path, "ffprobe", runner=runner)
        self.assertEqual(result["actual_duration_seconds"], 8.25)
        self.assertEqual(result["actual_frame_rate"], 24.0)
        self.assertFalse(result["actual_has_audio"])

    def test_rejects_missing_video_stream(self):
        runner = self.runner_for({"format": {"duration": "3"}, "streams": [{"codec_type": "audio"}]})
        with self.assertRaisesRegex(RuntimeError, "video stream"):
            probe_media(self.path, "ffprobe", runner=runner)

    def test_rejects_missing_duration(self):
        runner = self.runner_for({"format": {}, "streams": [{
            "codec_type": "video", "width": 640, "height": 360, "avg_frame_rate": "25/1"
        }]})
        with self.assertRaisesRegex(RuntimeError, "duration"):
            probe_media(self.path, "ffprobe", runner=runner)

    def test_rejects_invalid_json(self):
        runner = Mock(return_value=type("Result", (), {"returncode": 0, "stdout": "not-json", "stderr": ""})())
        with self.assertRaisesRegex(RuntimeError, "invalid JSON"):
            probe_media(self.path, "ffprobe", runner=runner)

    def test_reports_ffprobe_failure(self):
        runner = Mock(return_value=type("Result", (), {"returncode": 1, "stdout": "", "stderr": "Invalid data found"})())
        with self.assertRaisesRegex(RuntimeError, "Invalid data found"):
            probe_media(self.path, "ffprobe", runner=runner)

    def test_translates_timeout(self):
        runner = Mock(side_effect=subprocess.TimeoutExpired(["ffprobe"], 25))
        with self.assertRaisesRegex(RuntimeError, "timed out"):
            probe_media(self.path, "ffprobe", runner=runner)

    def test_rejects_missing_file_before_running_probe(self):
        runner = Mock()
        with self.assertRaises(FileNotFoundError):
            probe_media(self.path.with_name("missing.mp4"), "ffprobe", runner=runner)
        runner.assert_not_called()


if __name__ == "__main__":
    unittest.main()
