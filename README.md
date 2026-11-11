# Reference2Video — AI Creative Studio

Reference2Video is a browser-based Flask app for reference-video analysis, three original creative concepts, editable scene storyboards, JSON export, and optional per-scene AI video generation.

## Current workflow

1. Upload a reference video (MP4, MOV, WEBM, MKV or AVI; maximum 50 MB).
2. Gemini analyzes the visual language, editing rhythm, camera, color, graphics, audio and structure.
3. Review three original concepts and choose one.
4. Edit every scene prompt manually and export the storyboard JSON.
5. Optionally generate individual scene clips with Wan v3.0. Every clip requires a per-scene checkbox and browser confirmation. The server also has an owner-controlled safety switch; paid generation is disabled unless explicitly enabled in Render.

## Video provider, model and cost

- Provider: Vercel AI Gateway, routed to Alibaba Cloud.
- Model ID: `alibaba/wan-v3.0-video`.
- Required secret: `AI_GATEWAY_API_KEY` (store only in Render Environment).
- Required owner switch: `ENABLE_PAID_VIDEO_GENERATION=true`. It defaults to false.
- Required owner-only access secret: `VIDEO_GENERATION_ACCESS_TOKEN`. The public page asks for this token; it is held only in the page field and sent over HTTPS with each approved request. It is not saved in browser storage.
- Published Alibaba Cloud Singapore international list rates: 480p $0.05/second, 720p $0.10/second, 1080p $0.20/second. The app shows an estimate before each request. Gateway rates, promotions, taxes and final billing may differ; verify the live provider price before approval.
- Vercel's model page says eligible free users who have not made a payment may receive $5 of credits every 30 days. Eligibility and terms can change; this is not unlimited free video generation.

Pricing references:
- [Vercel AI Gateway — Wan v3.0](https://vercel.com/ai-gateway/models/wan-v3.0-video)
- [Alibaba Cloud Model Studio — Wan 3.0 pricing](https://www.alibabacloud.com/help/en/model-studio/wan3-0-video)

**No paid generation is started by analysis or storyboard creation.** To use it, the owner must first add the API key and deliberately enable the server switch; then each individual scene still requires the user to review the prompt, tick approval and confirm the estimated charge.

## Render deployment

Build command:

```bash
pip install -r requirements.txt
```

Recommended build command if you want to preinstall the video SDK instead of waiting for the first approved clip:

```bash
pip install -r requirements.txt && npm install --omit=dev --no-audit --no-fund
```

Start command:

```bash
gunicorn app:app --bind 0.0.0.0:$PORT --timeout 180
```

The current app can install the Node AI SDK on the first approved video request if Render did not install it during the build. Node.js and npm must be available on the instance.

Required Render environment variables:
- `GEMINI_API_KEY` — required for reference analysis.
- `GEMINI_MODEL` — optional; defaults are defined in `app.py`.

Optional paid video generation (all three settings are required):
- `AI_GATEWAY_API_KEY` — required for Wan v3.0.
- `ENABLE_PAID_VIDEO_GENERATION` — leave unset or false to keep generation locked; set to `true` only after accepting provider costs.
- `VIDEO_GENERATION_ACCESS_TOKEN` — a long random owner-only secret. Generate one locally, for example with `python -c "import secrets; print(secrets.token_urlsafe(32))"`, add it privately to Render, then enter the same value in the Owner Access Token field in the studio. Do not put it in GitHub, a public prompt, or chat.

Never commit API keys or send them in chat.

## Features and limitations

- Reference uploads up to 50 MB.
- Gemini video analysis and three original concepts.
- Editable scene prompts and storyboard JSON export.
- Per-scene duration, aspect ratio and resolution controls.
- Per-scene approval checkbox, confirmation prompt and approximate cost estimate.
- Background clip-generation jobs, in-page MP4 preview and download.
- 9:16 and 16:9 output options (plus square in the clip control).

Video jobs and analysis jobs are currently held in process memory, and uploaded/generated files are on Render's ephemeral filesystem. A restart or redeploy can remove job state and files. This MVP does not yet assemble multiple clips, generate voiceover tracks, mix sound effects, or export a finished multi-scene project MP4.
