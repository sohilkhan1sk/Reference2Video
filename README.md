# Reference2Video — Free AI Creative Studio

A browser-based Flask app for reference-video analysis, three original concepts, editable scene storyboards, and JSON export.

## Free workflow

- Render hosting uses the free service plan, subject to Render's free-plan limits and availability.
- Gemini video analysis requires a Google Gemini API key. Google's API free-tier availability and quotas depend on the model, account, and region; analysis is not unlimited.
- Paid fal.ai/Kling integration, billing code, and API-key requirement have been removed.
- Each scene has a copy-prompt action and direct links to free/limited free video services:
  - Google Vids: Google announced 10 no-cost video generations per month for personal Google accounts; availability and terms can change.
  - Wan2.Video: public Wan/LTX demos; queues and usage limits may apply, and it is a third-party site.
  - Clipchamp: free browser editor for assembling clips; personal free plan supports watermark-free exports up to 1080p.
- The external services have their own accounts, limits, privacy terms, watermarks, and commercial-use rules. Reference2Video does not call their APIs or guarantee free generation.

## Render settings

Build: `pip install -r requirements.txt`

Start: `gunicorn app:app --bind 0.0.0.0:$PORT --timeout 180`

Set `GEMINI_API_KEY` in Render Environment. No `FAL_KEY` is needed. Never commit API keys.

## Features

- MP4, MOV, WEBM, MKV, AVI uploads (max 50 MB)
- Gemini video style, editing, camera, graphics, audio and structure analysis
- Three original concepts with scene storyboards
- Editable scene prompts and JSON export
- Copy individual scene video prompts
- Direct links to free/limited free clip generation and editing tools
- 9:16 and 16:9 prompt planning

Render's default filesystem is ephemeral. Uploaded videos and in-memory analysis jobs may be lost on restart or redeploy.
