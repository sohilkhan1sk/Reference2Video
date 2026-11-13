"""Regression tests for private MP4 object storage using a fake S3 client.

Run with: python -m unittest discover -s tests -v
No cloud credentials or network connection are needed.
"""
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import media_store


class FakeClientError(Exception):
    def __init__(self, response):
        super().__init__("fake S3 error")
        self.response = response


class FakeS3Client:
    def __init__(self):
        self.objects = {}
        self.last_presign = None

    def put_object(self, **kwargs):
        body = kwargs["Body"].read()
        self.objects[(kwargs["Bucket"], kwargs["Key"])] = {
            "body": body,
            "content_type": kwargs["ContentType"],
            "content_disposition": kwargs["ContentDisposition"],
        }

    def head_object(self, Bucket, Key):
        if (Bucket, Key) not in self.objects:
            raise FakeClientError({
                "Error": {"Code": "404"},
                "ResponseMetadata": {"HTTPStatusCode": 404},
            })
        return {"ContentLength": len(self.objects[(Bucket, Key)]["body"])}

    def generate_presigned_url(self, operation, Params, ExpiresIn):
        self.last_presign = (operation, Params, ExpiresIn)
        return "https://private.example/signed-video"


class MediaStoreTests(unittest.TestCase):
    def setUp(self):
        self.client = FakeS3Client()
        self.env = {
            "S3_ENDPOINT_URL": "https://account.r2.cloudflarestorage.com",
            "S3_BUCKET": "private-r2-bucket",
            "S3_ACCESS_KEY_ID": "test-access",
            "S3_SECRET_ACCESS_KEY": "test-secret",
            "S3_REGION": "auto",
            "S3_PREFIX": "reference2video",
            "S3_PRESIGNED_URL_TTL_SECONDS": "900",
        }
        fake_boto3 = types.ModuleType("boto3")
        fake_boto3.client = lambda *args, **kwargs: self.client
        fake_config = types.ModuleType("botocore.config")
        fake_config.Config = lambda **kwargs: kwargs
        fake_exceptions = types.ModuleType("botocore.exceptions")
        fake_exceptions.ClientError = FakeClientError
        fake_botocore = types.ModuleType("botocore")
        fake_botocore.__path__ = []
        self.modules = patch.dict(sys.modules, {
            "boto3": fake_boto3,
            "botocore": fake_botocore,
            "botocore.config": fake_config,
            "botocore.exceptions": fake_exceptions,
        })
        self.modules.start()
        self.env_patch = patch.dict(os.environ, self.env)
        self.env_patch.start()

    def tearDown(self):
        self.env_patch.stop()
        self.modules.stop()

    def test_upload_and_private_presigned_playback(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "clip.mp4"
            path.write_bytes(b"fake-mp4-data")
            uri = media_store.upload_video_file(path, "job-123")

        self.assertEqual(
            uri,
            "s3://private-r2-bucket/reference2video/clips/job-123.mp4",
        )
        self.assertTrue(media_store.object_exists(uri))
        signed = media_store.presigned_video_url(uri, download=False)
        self.assertEqual(signed, "https://private.example/signed-video")
        operation, params, expires = self.client.last_presign
        self.assertEqual(operation, "get_object")
        self.assertEqual(params["ResponseContentType"], "video/mp4")
        self.assertTrue(params["ResponseContentDisposition"].startswith("inline;"))
        self.assertEqual(expires, 900)

    def test_missing_object_returns_false(self):
        self.assertFalse(media_store.object_exists(
            "s3://private-r2-bucket/reference2video/clips/missing.mp4"
        ))

    def test_rejects_uri_for_another_bucket(self):
        with self.assertRaises(ValueError):
            media_store.presigned_video_url(
                "s3://other-bucket/reference2video/clips/job-123.mp4"
            )

    def test_local_fallback_when_credentials_are_absent(self):
        with patch.dict(os.environ, {
            "S3_BUCKET": "",
            "S3_ACCESS_KEY_ID": "",
            "S3_SECRET_ACCESS_KEY": "",
        }):
            self.assertFalse(media_store.media_storage_configured())
            self.assertEqual(media_store.media_storage_backend(), "local")


if __name__ == "__main__":
    unittest.main()
