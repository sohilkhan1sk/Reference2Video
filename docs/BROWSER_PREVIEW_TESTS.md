# Browser-level crossfade preview checks

These checks exercise the real templates/index.html, static/app.js, and
static/assembly_video_preview.js in headless Chromium. The test server only
stubs the owner-only health/history API responses; the generated MP4 URLs are
served as real byte-range-capable media files.

CI creates two deterministic three-second H.264 fixtures (red and blue). The
browser tests then:

- load the clips through the same /api/generated/<job_id> paths used by the app;
- add both completed jobs to the real assembly queue;
- set a 0.5-second crossfade and seek into its overlap using the timeline's
  0.1-second slider resolution;
- assert that two real HTML video elements are loaded and simultaneously playing;
- check their source offsets and computed opacity;
- seek before and after the overlap and verify the active scene changes;
- verify the 9:16 preview frame ratio.

The test fixtures are synthetic and carry no provider cost. The health response
explicitly reports paid generation as disabled. No Gemini, Wan, AI Gateway,
FFmpeg assembly endpoint, or paid generation endpoint is called by the browser
tests.

The Playwright config starts the preview server from this directory. The server
resolves the repository root from its own file location, so the commands work
both in CI and when invoked from the repository root. CI runs the full Python,
Node, and headless Chromium suites together on the pull request.

Run locally after installing the Python dependencies and Node packages:

    npm install --no-package-lock
    npx playwright install chromium
    mkdir -p tests/browser/fixtures
    ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=red:s=320x180:r=30 -t 3 -an -c:v libx264 -pix_fmt yuv420p -movflags +faststart -y tests/browser/fixtures/red.mp4
    ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=blue:s=320x180:r=30 -t 3 -an -c:v libx264 -pix_fmt yuv420p -movflags +faststart -y tests/browser/fixtures/blue.mp4
    npx playwright test --config tests/browser/playwright.config.mjs

The tests validate browser playback and layer behavior against synthetic files.
They do not prove synchronization on every GPU/decoder, provider-generated MP4
compatibility, or that FFmpeg's rendered pixels are identical to Chromium's
compositor output.
