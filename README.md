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
- Owner-only recent generation history, persisted job status and resume-tracking controls.
- 9:16 and 16:9 output options (plus square in the clip control).

## Video job history storage

The app now stores video-generation job metadata in a database instead of keeping it only in a Python dictionary. It supports two modes:

- **PostgreSQL (recommended for a deployed service):** set `DATABASE_URL` to a Render PostgreSQL connection string. The app uses `psycopg` and creates the `video_jobs` table automatically. Job status, model, format, timestamps, estimates and errors survive app restarts.
- **SQLite fallback:** if `DATABASE_URL` is not set, the app creates `reference2video.sqlite3` in the project directory. This is convenient for local development, but Render's free web-service filesystem is ephemeral; the SQLite file may be lost when the instance is replaced or redeployed.

The **Load history** panel is protected by the same `VIDEO_GENERATION_ACCESS_TOKEN` as paid generation. It lists the latest 20 jobs and lets the owner resume polling a still-running job. Abandoned `PROCESSING` jobs are marked interrupted after 20 minutes (the current worker timeout is 11 minutes).

## Durable generated-video storage

Generated MP4s can now be uploaded to a **private S3-compatible object bucket** after the provider finishes rendering. Supported targets include Cloudflare R2, AWS S3, and other S3-compatible services. The bucket is never made public: the app redirects playback/download requests to short-lived presigned GET URLs.

Set these variables in Render Environment (or your local `.env`):

- `S3_BUCKET` — private bucket name.
- `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` — credentials restricted to this bucket and the `S3_PREFIX` path.
- `S3_ENDPOINT_URL` — required for R2 and most compatible providers; omit for standard AWS S3.
- `S3_REGION` — use `auto` for Cloudflare R2, or the bucket's region for AWS S3.
- `S3_PREFIX` — optional object prefix; defaults to `reference2video`.
- `S3_PRESIGNED_URL_TTL_SECONDS` — optional signed-link lifetime; defaults to 3600 seconds and is clamped to 60–604800 seconds.

### Cloudflare R2 example

1. Create a private R2 bucket; do not enable public access.
2. Create an R2 S3 API token with Object Read & Write permission scoped to that bucket.
3. Copy the account-specific S3 endpoint shown by Cloudflare.
4. Add the bucket, access key, secret, endpoint, and `S3_REGION=auto` to Render Environment.
5. Save the settings and wait for Render to restart. The public `/health` endpoint reports only whether storage is configured; it never returns credentials.

Example values (replace every placeholder; do not commit real values):

```dotenv
S3_ENDPOINT_URL=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
S3_BUCKET=your-private-video-bucket
S3_ACCESS_KEY_ID=your_r2_access_key
S3_SECRET_ACCESS_KEY=your_r2_secret_key
S3_REGION=auto
S3_PREFIX=reference2video
S3_PRESIGNED_URL_TTL_SECONDS=3600
```

For AWS S3, omit `S3_ENDPOINT_URL`, set `S3_REGION` to the bucket's region, and use an IAM access key with `s3:PutObject` and `s3:GetObject` permissions restricted to the configured prefix. S3 `HeadObject` checks are authorized by `s3:GetObject`.

If these settings are absent, the app safely falls back to local storage and displays a warning. If an upload fails after a provider has already generated a clip, the app marks the clip completed and keeps the local MP4 rather than encouraging a second paid generation; download it before the next redeploy. The history endpoint checks object availability, and completed clip links create a new short-lived signed URL when opened.

**Remaining limitations:** job metadata is still in SQLite unless `DATABASE_URL` is configured; no Render PostgreSQL instance is currently provisioned. Analysis jobs remain in process memory. The app still does not assemble multiple clips, generate voiceover tracks, mix sound effects, or export a finished multi-scene project MP4. Durable MP4 storage is now in place as the foundation for that FFmpeg assembly phase.
