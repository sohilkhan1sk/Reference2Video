import os, json, uuid, threading
from pathlib import Path
from flask import Flask, render_template, request, jsonify
from werkzeug.utils import secure_filename
from dotenv import load_dotenv
from google import genai

load_dotenv()
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024

@app.errorhandler(413)
def request_too_large(_error):
    return jsonify(error="This video is too large for the current server. Please compress it or upload a video under 50 MB."), 413
ROOT = Path(__file__).resolve().parent
UPLOAD_DIR = ROOT / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
ALLOWED = {"mp4", "mov", "webm", "mkv", "avi"}


def get_client():
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("GEMINI_API_KEY is missing. Configure it in Render Environment.")
    return genai.Client(api_key=key)


@app.get("/")
def home():
    return render_template("index.html")


# Analysis runs in a background thread so long Gemini calls do not block
# the web request or get killed by the web server's request timeout.
analysis_jobs = {}
analysis_jobs_lock = threading.Lock()


def run_analysis_job(job_id, path, niche, duration, aspect):
    try:
        with analysis_jobs_lock:
            analysis_jobs[job_id]["message"] = "Uploading video to AI service…"
        client = get_client()
        uploaded = client.files.upload(file=str(path))
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
        primary_model = os.getenv("GEMINI_MODEL", "gemini-3.8-flash").strip()
        configured = os.getenv("GEMINI_FALLBACK_MODELS", "").strip()
        if configured:
            fallback_models = [m.strip() for m in configured.split(",") if m.strip()]
        else:
            legacy_fallback = os.getenv("GEMINI_FALLBACK_MODEL", "").strip()
            fallback_models = [m for m in [
                "gemini-3.7-flash", "gemini-3.6-flash",
                legacy_fallback or "gemini-3.5-flash-lite",
            ] if m]
        model_chain = list(dict.fromkeys([primary_model] + fallback_models))
        response = None
        used_model = None
        failures = []
        with analysis_jobs_lock:
            analysis_jobs[job_id]["message"] = "AI is analyzing the video and creating concepts…"
        for candidate in model_chain:
            try:
                response = client.models.generate_content(
                    model=candidate, contents=[uploaded, prompt],
                    config={"response_mime_type": "application/json"}
                )
                used_model = candidate
                break
            except Exception as model_error:
                error_text = str(model_error)
                is_overload = "503" in error_text or "UNAVAILABLE" in error_text
                failures.append(f"{candidate}: {error_text[:500]}")
                if not is_overload:
                    raise
                app.logger.warning("Gemini model %s overloaded; trying next fallback.", candidate)
        if response is None:
            raise RuntimeError(
                "All configured Gemini video-analysis models are temporarily overloaded. "
                "Please retry in 1–2 minutes. Models tried: "
                + ", ".join(model_chain) + ". Details: " + " | ".join(failures)
            )
        result = json.loads(response.text or "{}")
        result.setdefault("analysis_metadata", {})
        result["analysis_metadata"]["model_used"] = used_model
        with analysis_jobs_lock:
            analysis_jobs[job_id].update(status="COMPLETED", message="Analysis complete", result=result)
    except Exception as exc:
        message = str(exc)
        app.logger.exception("Reference analysis job %s failed", job_id)
        if "503" in message or "UNAVAILABLE" in message or "overloaded" in message.lower():
            message = "Gemini is temporarily overloaded. Please wait 1–2 minutes and retry. Details: " + message
            status_code = 503
        else:
            status_code = 500
        with analysis_jobs_lock:
            analysis_jobs[job_id].update(status="FAILED", message="Analysis failed", error=message, error_status=status_code)
    finally:
        try:
            Path(path).unlink(missing_ok=True)
        except Exception:
            app.logger.warning("Could not remove temporary upload %s", path)


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
    job_id = uuid.uuid4().hex
    with analysis_jobs_lock:
        analysis_jobs[job_id] = {
            "status": "PROCESSING",
            "message": "Preparing your reference video…",
            "created_at": __import__("time").time()
        }
    try:
        thread = threading.Thread(
            target=run_analysis_job,
            args=(job_id, str(path), request.form.get("niche", "General"),
                  request.form.get("duration", "30 seconds"),
                  request.form.get("aspect", "Both 9:16 and 16:9")),
            daemon=True
        )
        thread.start()
    except Exception:
        with analysis_jobs_lock:
            analysis_jobs.pop(job_id, None)
        Path(path).unlink(missing_ok=True)
        app.logger.exception("Could not start analysis worker")
        return jsonify(error="Could not start the analysis task. Please try again."), 500
    return jsonify(job_id=job_id, status="PROCESSING"), 202


@app.get("/api/analyze/<job_id>")
def get_analysis_job(job_id):
    with analysis_jobs_lock:
        job = analysis_jobs.get(job_id)
        if not job:
            return jsonify(error="Analysis job not found. It may have expired after a server restart. Please upload again."), 404
        payload = dict(job)
    if payload["status"] == "COMPLETED":
        return jsonify(status="COMPLETED", result=payload.get("result"))
    if payload["status"] == "FAILED":
        return jsonify(status="FAILED", error=payload.get("error", "Analysis failed.")), payload.get("error_status", 500)
    return jsonify(status=payload["status"], message=payload.get("message", "Analyzing…")), 200


@app.get("/health")
def health():
    return jsonify(status="ok", app="Reference2Video", video_provider="disabled_free_mode")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "10000")), debug=False)
