import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import job_store


class AssemblyJobStoreTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tempdir.name) / "jobs.sqlite3"
        self.backend_patch = patch.object(job_store, "_BACKEND", "sqlite")
        self.path_patch = patch.object(job_store, "_SQLITE_PATH", self.db_path)
        self.backend_patch.start()
        self.path_patch.start()
        job_store.init_job_store()

    def tearDown(self):
        self.path_patch.stop()
        self.backend_patch.stop()
        self.tempdir.cleanup()

    def test_create_update_and_read_assembly_job(self):
        job_store.create_assembly_job(
            "assembly-1",
            aspect_ratio="16:9",
            source_job_ids='["clip-a","clip-b"]',
        )
        record = job_store.get_assembly_job_record("assembly-1")
        self.assertEqual(record["status"], "PROCESSING")
        self.assertEqual(record["aspect_ratio"], "16:9")
        self.assertEqual(record["source_job_ids"], '["clip-a","clip-b"]')

        job_store.update_assembly_job(
            "assembly-1", status="COMPLETED", output_uri="s3://bucket/exports/a.mp4"
        )
        updated = job_store.get_assembly_job_record("assembly-1")
        self.assertEqual(updated["status"], "COMPLETED")
        self.assertEqual(updated["output_uri"], "s3://bucket/exports/a.mp4")
        self.assertEqual(len(job_store.list_assembly_job_records()), 1)

    def test_video_job_persists_measured_media_metadata(self):
        job_store.create_video_job(
            "clip-measured", provider="test-provider", model="test-model", duration=5
        )
        job_store.update_video_job(
            "clip-measured", status="COMPLETED",
            actual_duration_seconds=5.437, actual_width=720, actual_height=1280,
            actual_frame_rate=29.97, actual_video_codec="h264",
            actual_has_audio=True, probe_error=None,
        )
        record = job_store.get_video_job_record("clip-measured")
        self.assertEqual(record["duration"], 5)
        self.assertAlmostEqual(record["actual_duration_seconds"], 5.437)
        self.assertEqual(record["actual_width"], 720)
        self.assertEqual(record["actual_height"], 1280)
        self.assertAlmostEqual(record["actual_frame_rate"], 29.97)
        self.assertEqual(record["actual_video_codec"], "h264")
        self.assertTrue(record["actual_has_audio"])
        self.assertIsNone(record["probe_error"])

    def test_stale_assembly_is_marked_interrupted(self):
        job_store.create_assembly_job(
            "assembly-stale",
            aspect_ratio="9:16",
            source_job_ids="[]",
            updated_at=time.time() - 120,
        )
        changed = job_store.mark_stale_assembly_jobs(stale_after_seconds=60)
        self.assertEqual(changed, 1)
        record = job_store.get_assembly_job_record("assembly-stale")
        self.assertEqual(record["status"], "FAILED")
        self.assertIn("interrupted", record["message"].lower())


if __name__ == "__main__":
    unittest.main()
