import os, json, uuid, threading, subprocess, time, shutil
from pathlib import Path
from flask import Flask, render_template, request, jsonify, send_file
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
GENERATED_DIR = ROOT / "generated"
UPLOAD_DIR.mkdir(exist_ok=True)
GENERATED_DIR.mkdir(exist_ok=True)
ALLOWED = {"mp4", "mov", "webm", "mkv", "avi"}

VIDEO_PROVIDER = "Vercel AI Gateway / Alibaba Cloud"
VIDEO_MODEL = "alibaba/wan-v3.0-video"
# Alibaba Cloud's published Singapore international list rates (USD per generated second).
VIDEO_RATES_USD = {"854x480": 0.05, "1280x720": 0.10, "1920x1080": 0.20}


def paid_generation_enabled():
    return os.getenv("ENABLE_PAID_VIDEO_GENERATION", "").strip().lower() in {"1", "true", "yes", "on"}


def estimate_video_cost(duration, resolution):
    rate = VIDEO_RATES_USD[resolution]
    return rate, round(rate * duration, 2)


def get_client():
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if not key:
        raise RuntimeError("GEMINI_API_KEY is missing. Configure it in Render Environment.")
    return genai.Client(api_key=key)


@app.get("/")
def home():
    return render_template("index.html")


# Reference analysis runs asynchronously so long Gemini calls do not block requests.
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
    if not os.getenv("GEMINI_API_KEY", "").strip():
        return jsonify(error="GEMINI_API_KEY is not available to this Render service. Check the Environment Variables for reference2video-studio, save the change, and wait for the service to restart."), 503
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
            "created_at": time.time()
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
            return jsonify(error="Analysis job not found. It may have expired after a server restart. Please upload and analyze again."), 404
        payload = dict(job)
    if payload.get("status") == "FAILED":
        return jsonify(
            status="FAILED",
            message=payload.get("message", "Analysis failed"),
            error=payload.get("error", "Analysis failed.")
        ), payload.get("error_status", 500)
    if payload.get("status") == "COMPLETED":
        return jsonify(
            status="COMPLETED",
            message=payload.get("message", "Analysis complete"),
            result=payload.get("result", {})
        ), 200
    return jsonify(
        status=payload.get("status", "PROCESSING"),
        message=payload.get("message", "Analysis is processing…")
    ), 200


# Wan video generation jobs run in a background thread. The API key remains server-side.
video_jobs = {}
video_jobs_lock = threading.Lock()
video_sdk_install_lock = threading.Lock()
_video_sdk_ready = (ROOT / "node_modules" / "ai" / "package.json").exists()


def ensure_video_sdk():
    """Install the project dependency on first use when Render's Python build skipped npm."""
    global _video_sdk_ready
    sdk_manifest = ROOT / "node_modules" / "ai" / "package.json"
    if _video_sdk_ready and sdk_manifest.exists():
        return
    with video_sdk_install_lock:
        if sdk_manifest.exists():
            _video_sdk_ready = True
            return
        if not shutil.which("node"):
            raise RuntimeError("Node.js is not available on this Render instance; the video worker cannot start.")
        if not shutil.which("npm"):
            raise RuntimeError("npm is not available on this Render instance; install the AI SDK during the Render build.")
        try:
            completed = subprocess.run(
                ["npm", "install", "--omit=dev", "--no-audit", "--no-fund"],
                cwd=str(ROOT), capture_output=True, text=True, timeout=240,
                env=os.environ.copy()
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError("Installing the video-generation SDK timed out. Please retry after the service is stable.")
        if completed.returncode != 0 or not sdk_manifest.exists():
            details = (completed.stderr or completed.stdout or "npm install did not create node_modules/ai.")[-1800:]
            raise RuntimeError("Could not prepare the video-generation SDK. Check the Render build environment. Details: " + details)
        _video_sdk_ready = True


def run_video_job(job_id, prompt, duration, aspect_ratio, resolution):
    input_path = GENERATED_DIR / f"{job_id}.json"
    output_path = GENERATED_DIR / f"{job_id}.mp4"
    try:
        with video_jobs_lock:
            video_jobs[job_id]["message"] = "Preparing the video-generation runtime…"
        ensure_video_sdk()
        with video_jobs_lock:
            video_jobs[job_id]["message"] = "Sending your approved prompt to Wan v3.0…"
        input_path.write_text(json.dumps({
            "prompt": prompt,
            "duration": duration,
            "aspectRatio": aspect_ratio,
            "resolution": resolution
        }), encoding="utf-8")
        script = ROOT / "scripts" / "generate-video.mjs"
        completed = subprocess.run(
            ["node", str(script), str(input_path), str(output_path)],
            cwd=str(ROOT), capture_output=True, text=True, timeout=660,
            env=os.environ.copy()
        )
        if completed.returncode != 0:
            details = (completed.stderr or completed.stdout or "Video provider returned an unknown error.")[-2500:]
            lowered = details.lower()
            if "insufficient" in lowered or "credit" in lowered or "balance" in lowered:
                friendly = "Your Vercel AI Gateway credits may be exhausted or unavailable. Check usage and billing in your Vercel dashboard. Details: " + details
            elif "401" in lowered or "unauthorized" in lowered or "api key" in lowered:
                friendly = "Vercel AI Gateway rejected the API key. Check AI_GATEWAY_API_KEY in this service's Render Environment."
            elif "429" in lowered or "rate limit" in lowered:
                friendly = "The video model is rate-limited right now. Please wait a little and retry. Details: " + details
            else:
                friendly = "Video generation failed. Please retry. Details: " + details
            raise RuntimeError(friendly)
        if not output_path.exists() or output_path.stat().st_size < 1024:
            raise RuntimeError("The video provider returned no usable MP4 file. Please retry.")
        with video_jobs_lock:
            video_jobs[job_id].update(
                status="COMPLETED", message="Your video is ready",
                video_url=f"/api/generated/{job_id}", download_url=f"/api/generated/{job_id}?download=1"
            )
    except subprocess.TimeoutExpired:
        app.logger.exception("Wan generation timed out for job %s", job_id)
        with video_jobs_lock:
            video_jobs[job_id].update(status="FAILED", error="Video generation took longer than 10 minutes and timed out. Please try a shorter clip.")
    except Exception as exc:
        app.logger.exception("Wan generation job %s failed", job_id)
        with video_jobs_lock:
            video_jobs[job_id].update(status="FAILED", error=str(exc)[:3000])
    finally:
        input_path.unlink(missing_ok=True)


@app.post("/api/generate")
def generate_video():
    data = request.get_json(silent=True) or {}
    # Two independent gates: an owner-controlled server switch and per-clip user approval.
    if data.get("approved") is not True:
        return jsonify(error="This clip has not been approved. Review the prompt, tick the approval box, and confirm before generating."), 403
    if not paid_generation_enabled():
        return jsonify(error="Paid video generation is disabled by the app owner. No provider request was sent. Set ENABLE_PAID_VIDEO_GENERATION=true in Render only if you accept the provider charges."), 403
    if not os.getenv("AI_GATEWAY_API_KEY", "").strip():
        return jsonify(error="AI_GATEWAY_API_KEY is missing. Add it privately in this Render service's Environment settings."), 503

    prompt = str(data.get("prompt", "")).strip()
    if not prompt:
        return jsonify(error="Add a video prompt before generating."), 400
    if len(prompt) > 20000:
        return jsonify(error="The video prompt must be 20,000 characters or fewer."), 400
    try:
        duration = int(data.get("duration", 5))
    except (TypeError, ValueError):
        return jsonify(error="Choose a valid video duration."), 400
    if duration < 2 or duration > 30:
        return jsonify(error="Wan v3.0 supports clips from 2 to 30 seconds."), 400
    aspect_ratio = str(data.get("aspect_ratio", "9:16"))
    if aspect_ratio not in {"16:9", "4:3", "1:1", "3:4", "9:16"}:
        return jsonify(error="Choose a supported aspect ratio."), 400
    resolution = str(data.get("resolution", "1280x720"))
    if resolution not in VIDEO_RATES_USD:
        return jsonify(error="Choose a supported resolution."), 400

    rate_per_second, estimated_cost = estimate_video_cost(duration, resolution)
    job_id = uuid.uuid4().hex
    with video_jobs_lock:
        video_jobs[job_id] = {
            "status": "PROCESSING",
            "message": "Preparing your approved generation…",
            "created_at": time.time(),
            "approved_at": time.time(),
            "provider": VIDEO_PROVIDER,
            "model": VIDEO_MODEL,
            "duration": duration,
            "aspect_ratio": aspect_ratio,
            "resolution": resolution,
            "rate_per_second_usd": rate_per_second,
            "estimated_cost_usd": estimated_cost
        }
    thread = threading.Thread(
        target=run_video_job,
        args=(job_id, prompt, duration, aspect_ratio, resolution),
        daemon=True
    )
    thread.start()
    return jsonify(
        job_id=job_id,
        status="PROCESSING",
        provider=VIDEO_PROVIDER,
        model=VIDEO_MODEL,
        duration=duration,
        resolution=resolution,
        rate_per_second_usd=rate_per_second,
        estimated_cost_usd=estimated_cost
    ), 202


@app.get("/api/generate/<job_id>")
def get_video_job(job_id):
    with video_jobs_lock:
        job = video_jobs.get(job_id)
        if not job:
            return jsonify(error="Video job not found. It may have expired after a server restart. Please generate again."), 404
        payload = dict(job)
    if payload["status"] == "FAILED":
        return jsonify(status="FAILED", error=payload.get("error", "Video generation failed.")), 200
    return jsonify(
        status=payload["status"],
        message=payload.get("message", "Generating…"),
        video_url=payload.get("video_url"),
        download_url=payload.get("download_url"),
        provider=payload.get("provider"),
        model=payload.get("model"),
        duration=payload.get("duration"),
        resolution=payload.get("resolution"),
        estimated_cost_usd=payload.get("estimated_cost_usd")
    ), 200


@app.get("/api/generated/<job_id>")
def serve_generated_video(job_id):
    with video_jobs_lock:
        job = video_jobs.get(job_id)
    if not job or job.get("status") != "COMPLETED":
        return jsonify(error="This generated video is not available."), 404
    path = GENERATED_DIR / f"{job_id}.mp4"
    if not path.is_file():
        return jsonify(error="The generated file is no longer on this server. Generate it again."), 404
    return send_file(path, mimetype="video/mp4", as_attachment=request.args.get("download") == "1",
                     download_name=f"reference2video-{job_id[:8]}.mp4")


@app.get("/health")
def health():
    return jsonify(
        status="ok",
        app="Reference2Video",
        video_provider=VIDEO_PROVIDER,
        video_model=VIDEO_MODEL,
        video_api_configured=bool(os.getenv("AI_GATEWAY_API_KEY", "").strip()),
        paid_generation_enabled=paid_generation_enabled(),
        video_generation_ready=paid_generation_enabled() and bool(os.getenv("AI_GATEWAY_API_KEY", "").strip()),
        node_available=bool(shutil.which("node")),
        video_sdk_installed=(ROOT / "node_modules" / "ai" / "package.json").exists(),
        gemini_api_configured=bool(os.getenv("GEMINI_API_KEY", "").strip())
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "10000")), debug=False)
