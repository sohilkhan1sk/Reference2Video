# Reference2Video — Free AI Creative Studio

A browser-based Flask app for reference-video analysis, three original concepts, editable scene storyboards, and JSON export.

## Free-mode deployment

- Render hosting uses the free service plan (subject to Render free-plan limits and availability).
- Gemini API analysis can use Google's free tier where the selected model and account are eligible; quotas and rate limits apply.
- Paid fal.ai/Kling video generation is disabled in the free version. No FAL_KEY is required and the app will not submit paid generation requests.
- Scene prompts can be copied and used in a separate video editor or service that offers its own free plan.

## Render settings

Build: `pip install -r requirements.txt`

Start: `gunicorn app:app --bind 0.0.0.0:$PORT --timeout 180`

Set `GEMINI_API_KEY` in Render Environment. Never commit API keys.

## Features

- MP4, MOV, WEBM, MKV, AVI uploads (max 50 MB)
- Gemini video style, editing, camera, graphics, audio and structure analysis
- Three original concepts with scene storyboards
- Editable scene prompts and JSON export
- Copy individual scene video prompts
- 9:16 and 16:9 prompt planning

Render's default filesystem is ephemeral. Uploaded videos and SQLite jobs may be lost on restart or redeploy.
