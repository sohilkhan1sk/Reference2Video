# Reference2Video — AI Creative Studio

Flask app: Gemini reference-video analysis, three original concepts, editable scene storyboards, JSON export, and optional paid fal.ai Kling clip generation.

## Render deployment
Build: `pip install -r requirements.txt`
Start: `gunicorn app:app --bind 0.0.0.0:$PORT --timeout 180`

Set `GEMINI_API_KEY` for analysis and `FAL_KEY` for paid generation in Render Environment. The interface loads without keys, but AI features require the relevant key. Never commit real keys.

## Features
- MP4, MOV, WEBM, MKV, AVI uploads (max 300 MB)
- Gemini style, editing, camera, graphics, audio and structure analysis
- Three original concepts with scene storyboards
- Editable scene prompts and JSON export
- Per-scene Kling generation with explicit paid approval and queue status
- 9:16 and 16:9 formats

Render's default filesystem is ephemeral. Uploaded videos, generated clips and SQLite jobs may be lost on restart or redeploy; persistent storage is not yet configured.
