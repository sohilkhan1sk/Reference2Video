"""Small DB-backed store for video-generation job metadata.

DATABASE_URL selects PostgreSQL (Render Postgres); otherwise the app uses a
local SQLite file. Generated MP4 bytes remain on the app filesystem.
"""
import os
import sqlite3
import time
from contextlib import contextmanager
from dotenv import load_dotenv

load_dotenv()
from pathlib import Path

ROOT = Path(__file__).resolve().parent
_DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
_BACKEND = "postgres" if _DATABASE_URL else "sqlite"
_SQLITE_PATH = Path(os.getenv("JOB_DB_PATH", str(ROOT / "reference2video.sqlite3")))

_ALLOWED_FIELDS = {
    "status", "message", "created_at", "updated_at", "approved_at",
    "provider", "model", "duration", "aspect_ratio", "resolution",
    "rate_per_second_usd", "estimated_cost_usd", "video_url",
    "download_url", "error",
}


def job_store_backend():
    return _BACKEND


def _connect():
    if _BACKEND == "postgres":
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as exc:
            raise RuntimeError(
                "DATABASE_URL is set but psycopg is not installed. "
                "Install requirements.txt before starting the app."
            ) from exc
        dsn = _DATABASE_URL
        if dsn.startswith("postgres://"):
            dsn = "postgresql://" + dsn[len("postgres://"):]
        return psycopg.connect(dsn, connect_timeout=8, row_factory=dict_row)

    _SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_SQLITE_PATH), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


@contextmanager
def _connection():
    conn = _connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _execute(conn, sql, params=()):
    if _BACKEND == "postgres":
        sql = sql.replace("?", "%s")
    return conn.execute(sql, params)


def _as_dict(row):
    if row is None:
        return None
    return dict(row)


def init_job_store():
    with _connection() as conn:
        _execute(conn, """
            CREATE TABLE IF NOT EXISTS video_jobs (
                job_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at DOUBLE PRECISION NOT NULL,
                updated_at DOUBLE PRECISION NOT NULL,
                approved_at DOUBLE PRECISION,
                provider TEXT,
                model TEXT,
                duration INTEGER,
                aspect_ratio TEXT,
                resolution TEXT,
                rate_per_second_usd DOUBLE PRECISION,
                estimated_cost_usd DOUBLE PRECISION,
                video_url TEXT,
                download_url TEXT,
                error TEXT
            )
        """)
        _execute(conn, """
            CREATE INDEX IF NOT EXISTS idx_video_jobs_created_at
            ON video_jobs (created_at)
        """)


def create_video_job(job_id, **fields):
    now = time.time()
    record = {"job_id": job_id, **fields}
    record.setdefault("updated_at", now)
    record.setdefault("created_at", now)
    record.setdefault("status", "PROCESSING")
    record.setdefault("message", "Preparing your approved generation…")
    unknown = set(record) - (_ALLOWED_FIELDS | {"job_id"})
    if unknown:
        raise ValueError("Unsupported video job fields: " + ", ".join(sorted(unknown)))
    columns = list(record)
    placeholders = ", ".join(["?"] * len(columns))
    sql = (
        "INSERT INTO video_jobs (" + ", ".join(columns) + ") VALUES ("
        + placeholders + ")"
    )
    with _connection() as conn:
        _execute(conn, sql, tuple(record[column] for column in columns))


def update_video_job(job_id, **fields):
    if not fields:
        return
    unknown = set(fields) - _ALLOWED_FIELDS
    if unknown:
        raise ValueError("Unsupported video job fields: " + ", ".join(sorted(unknown)))
    fields["updated_at"] = time.time()
    assignments = ", ".join(f"{column} = ?" for column in fields)
    params = tuple(fields.values()) + (job_id,)
    with _connection() as conn:
        cursor = _execute(
            conn,
            f"UPDATE video_jobs SET {assignments} WHERE job_id = ?",
            params,
        )
        if cursor.rowcount == 0:
            raise KeyError(f"Video job not found: {job_id}")


def get_video_job_record(job_id):
    with _connection() as conn:
        row = _execute(
            conn, "SELECT * FROM video_jobs WHERE job_id = ?", (job_id,)
        ).fetchone()
    return _as_dict(row)


def list_video_job_records(limit=20):
    limit = max(1, min(int(limit), 50))
    with _connection() as conn:
        rows = _execute(
            conn,
            "SELECT * FROM video_jobs ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [_as_dict(row) for row in rows]


def mark_stale_video_jobs(stale_after_seconds=1200):
    """Fail abandoned jobs after 20 minutes; Wan's current worker timeout is 11 minutes."""
    cutoff = time.time() - max(60, int(stale_after_seconds))
    message = "The worker stopped before this clip finished. Start a new approved generation."
    with _connection() as conn:
        cursor = _execute(
            conn,
            """UPDATE video_jobs
               SET status = 'FAILED',
                   message = 'Generation interrupted',
                   error = ?,
                   updated_at = ?
               WHERE status = 'PROCESSING' AND updated_at < ?""",
            (message, time.time(), cutoff),
        )
        return cursor.rowcount
