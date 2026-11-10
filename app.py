import os, json, uuid, sqlite3
from pathlib import Path
from urllib.parse import urlparse
import requests
from flask import Flask, render_template, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
from dotenv import load_dotenv
from google import genai

load_dotenv()
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 300 * 1024 * 1024
ROOT = Path(__file__).resolve().parent
UPLOAD_DIR = ROOT / "uploads"
GENERATED_DIR = ROOT / "generated"
UPLOAD_DIR.mkdir(exist_ok=True)
GENERATED_DIR.mkdir(exist_ok=True)
DB_PATH = ROOT / "reference2video.sqlite3"
ALLOWED = {"mp4", "mov", "webm", "mkv", "avi"}
DEFAULT_FAL_MODEL = "fal-ai/kling-video/v3/standard/text-to-video"


def get_client():
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("GEMINI_API_KEY is missing. Configure it in Render Environment.")
    return genai.Client(api_key=key)


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with db() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS generation_jobs (
            id TEXT PRIMARY KEY, scene_number INTEGER NOT NULL, prompt TEXT NOT NULL,
            aspect_ratio TEXT NOT NULL, duration INTEGER NOT NULL, generate_audio INTEGER NOT NULL,
            model TEXT NOT NULL, request_id TEXT NOT NULL, status_url TEXT NOT NULL,
            response_url TEXT NOT NULL, status TEXT NOT NULL, video_path TEXT,
            video_url TEXT, error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )""")


init_db()


def fal_key():
    key = os.getenv("FAL_KEY", "").strip()
    if not key:
        raise RuntimeError("FAL_KEY is missing. Add it in Render Environment. No generation request was submitted.")
    return key


def safe_fal_queue_url(url):
    parsed = urlparse(url or "")
    return parsed.scheme == "https" and parsed.hostname == "queue.fal.run"


def public_job(row):
    data = dict(row)
    data.pop("status_url", None)
    data.pop("response_url", None)
    data.pop("request_id", None)
    local_path = data.pop("video_path", None)
    if local_path:
        data["video_url"] = f"/generated/{Path(local_path).name}"
    return data


@app.get("/")
def home():
    return render_template("index.html")


@app.post("/api/analyze")
def analyze():
    if "video" not in request.files:
        return jsonify(error="Choose a reference video first."), 400
    video = request.files["video"]
    if not video.filename:
        return jsonify(error="Choose a video file first."), 400
    ext = video.filename.rsplit(".", 1)[-1].lower() if "." in video.filename else ""
    if ext not in ALLOWED:
        return jsonify(error="Supported formats: MP4, MOV, WEBM, MKV and AVI."), 400

    safe_name = secure_filename(video.filename)
    path = UPLOAD_DIR / f"{uuid.uuid4().hex}_{safe_name}"
    video.save(path)
    try:
        client = get_client()
        uploaded = client.files.upload(file=str(path))
        model = os.getenv("GEMINI_MODEL", "gemini-3.8-flash").strip()
        aspect = request.form.get("aspect", "Both 9:16 and 16:9")
        duration = request.form.get("duration", "30 seconds")
        niche = request.form.get("niche", "General")
        prompt = f"""
You are a professional short-form and YouTube video creative director.
Analyze the uploaded reference video and return valid JSON only.
Understand its creative grammar, not reproduce exact footage, script, branding,
or copyrighted assets. Create original concepts inspired by broad style, pacing,
visual language and structure.
User niche: {niche}
Target duration: {duration}
Output formats: {aspect}
Return JSON with analysis fields summary, visual_style, editing_rhythm,
camera_language, color_and_lighting, text_and_graphics, audio_observations,
scene_structure; and exactly three ideas. Each idea must include title, hook,
concept, why_it_works, and 5-8 scenes. Each scene has scene, time, purpose,
visual_prompt, video_prompt, camera_and_motion, on_screen_text, voiceover,
sound_design. Make prompts production-ready and original. Keep claims factual.
"""
        response = client.models.generate_content(
            model=model, contents=[uploaded, prompt],
            config={"response_mime_type": "application/json"}
        )
        return jsonify(result=json.loads(response.text or "{}"))
    except Exception as exc:
        return jsonify(error=f"Analysis failed: {str(exc)}"), 500


@app.post("/api/generate")
def generate_clip():
    """Submit exactly one scene only after explicit UI approval."""
    payload = request.get_json(silent=True) or {}
    if payload.get("approved") is not True:
        return jsonify(error="Explicit paid-generation approval is required."), 400
    prompt = str(payload.get("prompt", "")).strip()
    if not prompt:
        return jsonify(error="The scene's video prompt is empty."), 400
    if len(prompt) > 2400:
        return jsonify(error="Keep the video prompt under 2,400 characters."), 400
    aspect = payload.get("aspect_ratio", "16:9")
    if aspect not in {"16:9", "9:16"}:
        return jsonify(error="Aspect ratio must be 16:9 or 9:16."), 400
    try:
        duration = int(payload.get("duration", 5))
    except (TypeError, ValueError):
        return jsonify(error="Duration must be 5, 10 or 15 seconds."), 400
    if duration not in {5, 10, 15}:
        return jsonify(error="Duration must be 5, 10 or 15 seconds."), 400
    audio = bool(payload.get("generate_audio", False))
    try:
        key = fal_key()
        model = os.getenv("FAL_MODEL", DEFAULT_FAL_MODEL).strip()
        body = {
            "prompt": prompt,
            "duration": str(duration),
            "aspect_ratio": aspect,
            "generate_audio": audio,
            "enable_safety_checker": True,
        }
        response = requests.post(
            f"https://queue.fal.run/{model}",
            headers={"Authorization": f"Key {key}", "Content-Type": "application/json"},
            json=body, timeout=45
        )
        response.raise_for_status()
        submitted = response.json()
        request_id = submitted.get("request_id")
        status_url = submitted.get("status_url")
        response_url = submitted.get("response_url")
        if not request_id or not safe_fal_queue_url(status_url) or not safe_fal_queue_url(response_url):
            raise RuntimeError("fal.ai returned an unexpected queue response; no job was saved.")
        job_id = uuid.uuid4().hex
        with db() as conn:
            conn.execute("""INSERT INTO generation_jobs
                (id, scene_number, prompt, aspect_ratio, duration, generate_audio,
                 model, request_id, status_url, response_url, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (job_id, int(payload.get("scene_number", 0)), prompt, aspect,
                 duration, int(audio), model, request_id, status_url,
                 response_url, "IN_QUEUE"))
        return jsonify(job_id=job_id, status="IN_QUEUE", model=model,
                       estimated_cost_usd=round(duration * (0.126 if audio else 0.084), 3),
                       currency="USD", note="Estimate only; provider pricing can change."), 202
    except requests.HTTPError as exc:
        detail = exc.response.text[:800] if exc.response is not None else str(exc)
        return jsonify(error=f"fal.ai rejected the request: {detail}"), 502
    except Exception as exc:
        return jsonify(error=str(exc)), 500


@app.get("/api/jobs/<job_id>")
def get_job(job_id):
    with db() as conn:
        row = conn.execute("SELECT * FROM generation_jobs WHERE id=?", (job_id,)).fetchone()
    if not row:
        return jsonify(error="Generation job not found."), 404
    job = dict(row)
    if job["status"] not in {"COMPLETED", "FAILED"}:
        try:
            status_response = requests.get(job["status_url"], headers={"Authorization": f"Key {fal_key()}"}, timeout=25)
            status_response.raise_for_status()
            status_data = status_response.json()
            state = status_data.get("status", job["status"])
            if state == "COMPLETED" and status_data.get("error"):
                with db() as conn:
                    conn.execute("UPDATE generation_jobs SET status='FAILED', error=? WHERE id=?",
                                 (str(status_data.get("error"))[:1000], job_id))
                job["status"] = "FAILED"
                job["error"] = str(status_data.get("error"))[:1000]
            elif state == "COMPLETED":
                result_response = requests.get(job["response_url"], headers={"Authorization": f"Key {fal_key()}"}, timeout=45)
                result_response.raise_for_status()
                result_data = result_response.json()
                video_url = (result_data.get("video") or {}).get("url")
                if not video_url:
                    raise RuntimeError("Provider completed but returned no video URL.")
                host = urlparse(video_url).hostname or ""
                if not (host.endswith(".fal.media") or host.endswith(".fal.ai") or host == "storage.googleapis.com"):
                    raise RuntimeError("Provider returned an unrecognized video host; refusing to download it.")
                clip_name = f"{job_id}.mp4"
                clip_path = GENERATED_DIR / clip_name
                download = requests.get(video_url, timeout=120, stream=True)
                download.raise_for_status()
                with clip_path.open("wb") as out:
                    for chunk in download.iter_content(chunk_size=1024 * 1024):
                        if chunk:
                            out.write(chunk)
                with db() as conn:
                    conn.execute("UPDATE generation_jobs SET status='COMPLETED', video_path=?, video_url=? WHERE id=?",
                                 (str(clip_path), video_url, job_id))
                job["status"] = "COMPLETED"
                job["video_path"] = str(clip_path)
            elif state == "FAILED":
                job["status"] = "FAILED"
                job["error"] = str(status_data.get("error", "Provider reported a failed generation."))[:1000]
                with db() as conn:
                    conn.execute("UPDATE generation_jobs SET status='FAILED', error=? WHERE id=?", (job["error"], job_id))
            else:
                job["status"] = state
                with db() as conn:
                    conn.execute("UPDATE generation_jobs SET status=? WHERE id=?", (state, job_id))
        except Exception as exc:
            return jsonify(error=f"Could not refresh job status: {str(exc)}", job=public_job(job)), 502
    job["video_path"] = job.get("video_path")
    return jsonify(job=public_job(job))


@app.get("/generated/<path:filename>")
def generated_file(filename):
    return send_from_directory(GENERATED_DIR, filename, as_attachment=False)


@app.get("/health")
def health():
    return jsonify(status="ok", app="Reference2Video", video_provider="fal.ai" if os.getenv("FAL_KEY") else "not configured")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "10000")), debug=False)
