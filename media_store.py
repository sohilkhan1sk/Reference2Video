"""Private S3-compatible object storage for generated MP4 artifacts.

Works with Cloudflare R2, AWS S3, Backblaze B2 S3 API, and compatible services.
If the required environment variables are absent, callers can keep using local
temporary storage. Buckets must remain private; downloads use short-lived
presigned GET URLs.
"""
import os
from pathlib import Path
from urllib.parse import urlsplit

_REQUIRED = ("S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY")


def _settings():
    values = {name: os.getenv(name, "").strip() for name in _REQUIRED}
    endpoint = os.getenv("S3_ENDPOINT_URL", "").strip() or None
    region = os.getenv("S3_REGION", "").strip() or ("auto" if endpoint else "us-east-1")
    prefix = os.getenv("S3_PREFIX", "reference2video").strip().strip("/")
    if not prefix:
        prefix = "reference2video"
    return values, endpoint, region, prefix


def media_storage_configured():
    values, _endpoint, _region, _prefix = _settings()
    return all(values.values())


def media_storage_backend():
    return "s3" if media_storage_configured() else "local"


def _client():
    if not media_storage_configured():
        raise RuntimeError(
            "S3-compatible media storage is not configured. Set S3_BUCKET, "
            "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY in the server environment."
        )
    import boto3
    from botocore.config import Config

    values, endpoint, region, _prefix = _settings()
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=region,
        aws_access_key_id=values["S3_ACCESS_KEY_ID"],
        aws_secret_access_key=values["S3_SECRET_ACCESS_KEY"],
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
            connect_timeout=10,
            read_timeout=120,
            retries={"max_attempts": 4, "mode": "standard"},
        ),
    )


def _key_for_job(job_id):
    _values, _endpoint, _region, prefix = _settings()
    safe_id = "".join(ch for ch in str(job_id) if ch.isalnum() or ch in "-_")
    if not safe_id or safe_id != str(job_id):
        raise ValueError("Invalid video job ID for object storage.")
    return f"{prefix}/clips/{safe_id}.mp4"


def upload_video_file(path, job_id):
    """Upload an MP4 privately and return its internal s3:// storage URI."""
    values, _endpoint, _region, _prefix = _settings()
    key = _key_for_job(job_id)
    file_path = Path(path)
    if not file_path.is_file():
        raise FileNotFoundError(f"Generated MP4 does not exist: {file_path}")
    with file_path.open("rb") as stream:
        _client().put_object(
            Bucket=values["S3_BUCKET"],
            Key=key,
            Body=stream,
            ContentType="video/mp4",
            ContentDisposition=f'inline; filename="reference2video-{job_id}.mp4"',
        )
    return f"s3://{values['S3_BUCKET']}/{key}"


def _bucket_and_key(storage_uri):
    values, _endpoint, _region, prefix = _settings()
    parsed = urlsplit(str(storage_uri or ""))
    key = parsed.path.lstrip("/")
    allowed_prefix = f"{prefix}/clips/"
    if parsed.scheme != "s3" or parsed.netloc != values["S3_BUCKET"]:
        raise ValueError("The stored media reference does not match the configured bucket.")
    if not key.startswith(allowed_prefix) or ".." in key.split("/"):
        raise ValueError("The stored media reference is outside the configured clips folder.")
    return values["S3_BUCKET"], key


def object_exists(storage_uri):
    """Check an object's metadata without downloading its contents."""
    from botocore.exceptions import ClientError

    bucket, key = _bucket_and_key(storage_uri)
    try:
        _client().head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as exc:
        error = getattr(exc, "response", {}).get("Error", {})
        status = getattr(exc, "response", {}).get("ResponseMetadata", {}).get("HTTPStatusCode")
        code = str(error.get("Code", ""))
        if code in {"404", "NoSuchKey", "NotFound"} or status == 404:
            return False
        raise


def presigned_video_url(storage_uri, download=False):
    """Create a short-lived URL for a private MP4; never make the bucket public."""
    bucket, key = _bucket_and_key(storage_uri)
    try:
        expires = int(os.getenv("S3_PRESIGNED_URL_TTL_SECONDS", "3600"))
    except ValueError:
        expires = 3600
    expires = max(60, min(expires, 604800))
    filename = Path(key).name
    disposition = "attachment" if download else "inline"
    return _client().generate_presigned_url(
        "get_object",
        Params={
            "Bucket": bucket,
            "Key": key,
            "ResponseContentType": "video/mp4",
            "ResponseContentDisposition": f'{disposition}; filename="{filename}"',
        },
        ExpiresIn=expires,
    )
