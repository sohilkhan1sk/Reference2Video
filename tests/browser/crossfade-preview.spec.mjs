import { test, expect } from "@playwright/test";

const completedJobs = [
  {
    job_id: "job-a",
    status: "COMPLETED",
    artifact_available: true,
    video_url: "/api/generated/job-a",
    download_url: "/api/generated/job-a",
    duration: 3,
    actual_duration_seconds: 3,
    actual_width: 320,
    actual_height: 180,
    actual_frame_rate: 30,
    aspect_ratio: "16:9",
    resolution: "320x180",
    estimated_cost_usd: 0
  },
  {
    job_id: "job-b",
    status: "COMPLETED",
    artifact_available: true,
    video_url: "/api/generated/job-b",
    download_url: "/api/generated/job-b",
    duration: 3,
    actual_duration_seconds: 3,
    actual_width: 320,
    actual_height: 180,
    actual_frame_rate: 30,
    aspect_ratio: "16:9",
    resolution: "320x180",
    estimated_cost_usd: 0
  }
];

async function openStudio(page, aspect = "16:9") {
  await page.route("**/health", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      media_storage_configured: false,
      ffmpeg_available: true,
      ffmpeg_installable: false,
      paid_generation_enabled: false,
      video_access_token_configured: true,
      video_api_configured: false,
      node_available: true,
      video_sdk_installed: false
    })
  }));
  await page.route("**/api/jobs", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      jobs: completedJobs,
      store: "postgres",
      media_storage_backend: "local",
      media_storage_configured: false
    })
  }));

  await page.goto("/");
  // The production assembly panel is revealed after reference analysis.
  // Expose that already-rendered section here so this test can focus on preview playback.
  await page.locator("#results").evaluate(element => element.classList.remove("hidden"));
  await page.locator("#assemblyAspect").selectOption(aspect);
  await page.locator("#videoAccessToken").fill("browser-test-owner-token");
  await page.locator("#loadJobsBtn").click();
  await expect(page.locator(".history-card")).toHaveCount(2);
  await page.locator(".add-to-assembly").nth(0).click();
  await page.locator(".add-to-assembly").nth(1).click();
  await expect(page.locator("#audioTimelineSeek")).toBeVisible();
}

async function setPlayhead(page, seconds) {
  await page.locator("#audioTimelineSeek").evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, seconds);
}

async function activeVideoState(page) {
  return page.locator(".assembly-video-layer").evaluateAll(videos => videos
    .filter(video => Number(getComputedStyle(video).opacity) > 0.001)
    .map(video => ({
      source: new URL(video.currentSrc || video.src, location.href).pathname,
      opacity: Number(getComputedStyle(video).opacity),
      paused: video.paused,
      currentTime: video.currentTime,
      readyState: video.readyState
    }))
  );
}

test.beforeEach(async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.__reference2VideoPageErrors = pageErrors;
});

test.afterEach(async ({ page }) => {
  expect(page.__reference2VideoPageErrors || []).toEqual([]);
});

test("real browser loads both MP4s, blends them, plays together and seeks across scene boundaries", async ({ page }) => {
  await openStudio(page);
  await page.locator('[data-scene-edit="transition_after"][data-job="job-a"]').selectOption("crossfade");

  const outgoing = page.locator("#assemblyVideoMonitor");
  await expect.poll(() => outgoing.evaluate(video => video.readyState)).toBeGreaterThanOrEqual(1);

  // The 0.1-second range control snaps 2.75 to 2.8; the 0.5-second overlap is therefore at 60%.
  await setPlayhead(page, 2.8);
  await expect.poll(async () => {
    const state = await activeVideoState(page);
    return state.length === 2 && state.every(layer => layer.readyState >= 1);
  }).toBe(true);

  let layers = await activeVideoState(page);
  const first = layers.find(layer => layer.source.endsWith("/job-a"));
  const second = layers.find(layer => layer.source.endsWith("/job-b"));
  expect(first).toBeTruthy();
  expect(second).toBeTruthy();
  expect(first.opacity).toBeCloseTo(1, 2);
  expect(second.opacity).toBeCloseTo(0.6, 2);
  expect(first.currentTime).toBeGreaterThan(2.5);
  expect(second.currentTime).toBeGreaterThan(0.1);

  // Start near the beginning of the overlap so both short test clips have time to advance.
  await setPlayhead(page, 2.6);
  await page.locator("#audioPreviewPlay").click();
  await expect.poll(async () => {
    const state = await activeVideoState(page);
    return state.length === 2 && state.every(layer => !layer.paused);
  }).toBe(true);
  const before = await activeVideoState(page);
  await page.waitForTimeout(120);
  const after = await activeVideoState(page);
  for (const layer of after) {
    const previous = before.find(item => item.source === layer.source);
    expect(layer.currentTime).toBeGreaterThan(previous.currentTime);
  }

  // Seeking before the overlap pauses the incoming clip and restores one opaque layer.
  await setPlayhead(page, 2.4);
  await expect.poll(async () => (await activeVideoState(page)).length).toBe(1);
  layers = await activeVideoState(page);
  expect(layers[0].source).toContain("/job-a");
  expect(layers[0].opacity).toBe(1);
  expect(layers[0].paused).toBe(true);

  // Seeking after the overlap selects only the incoming scene at its source offset.
  await setPlayhead(page, 3.1);
  await expect.poll(async () => (await activeVideoState(page)).length).toBe(1);
  layers = await activeVideoState(page);
  expect(layers[0].source).toContain("/job-b");
  expect(layers[0].opacity).toBe(1);
  expect(layers[0].currentTime).toBeGreaterThan(0.4);
});


test("manual captions appear on the video monitor only during their time range and remain plain text", async ({ page }) => {
  await openStudio(page);
  await page.locator("#subtitlesEnabled").check();
  await page.locator("#addSubtitleBtn").click();
  const cue = page.locator(".subtitle-cue").first();
  await cue.locator("[data-subtitle-start]").fill("0");
  await cue.locator("[data-subtitle-end]").fill("1.5");
  await cue.locator("[data-subtitle-text]").fill("Hello <script>world</script>");

  const overlay = page.locator("#subtitlePreviewOverlay");
  await setPlayhead(page, 0.5);
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveText("Hello ＜script＞world＜/script＞");
  expect(await overlay.locator("script").count()).toBe(0);

  await setPlayhead(page, 2);
  await expect(overlay).toBeHidden();
});

test("portrait export selection creates a portrait video monitor frame", async ({ page }) => {
  await openStudio(page, "9:16");
  const frame = page.locator(".assembly-video-frame");
  await expect(frame).toBeVisible();
  expect(await frame.evaluate(element => element.style.aspectRatio)).toBe("9 / 16");
});


test("storyboard prefill creates editable voice-over and on-screen drafts mapped to the queued crossfade timeline", async ({ page }) => {
  await openStudio(page);
  await page.locator('[data-scene-edit="transition_after"][data-job="job-a"]').selectOption("crossfade");

  await page.evaluate(() => {
    currentData = {
      ideas: [{
        title: "Browser storyboard test",
        scenes: [
          {
            scene: 1, time: "00:00–00:05", purpose: "Opening",
            visual_prompt: "Opening scene", video_prompt: "Opening motion",
            camera_and_motion: "Slow push", on_screen_text: "THE FIRST SCENE",
            voiceover: "Narration for the first scene.", sound_design: "Soft impact"
          },
          {
            scene: 2, time: "00:05–00:10", purpose: "Follow-up",
            visual_prompt: "Second scene", video_prompt: "Second motion",
            camera_and_motion: "Tracking shot", on_screen_text: "THE NEXT SCENE",
            voiceover: "Narration for the second scene.", sound_design: "Whoosh"
          }
        ]
      }]
    };
    selectedIdea = 0;
    drawScenes();
  });

  await page.locator("#prefillSubtitlesBtn").click();
  await expect(page.locator(".subtitle-cue")).toHaveCount(4);
  await expect(page.locator("#subtitlesEnabled")).not.toBeChecked();

  const cues = await page.locator(".subtitle-cue").evaluateAll(rows => rows.map(row => ({
    start: Number(row.querySelector("[data-subtitle-start]").value),
    end: Number(row.querySelector("[data-subtitle-end]").value),
    text: row.querySelector("[data-subtitle-text]").value,
    source: row.querySelector(".subtitle-cue-source").textContent
  })));
  expect(cues.some(cue => cue.source.includes("VOICE-OVER"))).toBe(true);
  expect(cues.some(cue => cue.source.includes("ON-SCREEN TEXT"))).toBe(true);
  const secondVoiceover = cues.find(cue => cue.source.includes("VOICE-OVER") && cue.text.includes("second scene"));
  expect(secondVoiceover).toBeTruthy();
  expect(secondVoiceover.start).toBeCloseTo(2.5, 1);
  expect(secondVoiceover.end).toBeCloseTo(5.5, 1);
  await expect(page.locator("#subtitlePrefillStatus")).toContainText("scaled to the loaded clip sequence");
});


test("subtitle timeline splits at the playhead and merges neighboring selected cues", async ({ page }) => {
  await openStudio(page);
  await page.locator("#subtitlesEnabled").check();
  await page.locator("#addSubtitleBtn").click();
  const cue = page.locator(".subtitle-cue").first();
  await cue.locator("[data-subtitle-start]").fill("0");
  await cue.locator("[data-subtitle-end]").fill("2");
  await cue.locator("[data-subtitle-text]").fill("This caption can split into two parts");

  await page.locator(".subtitle-timeline-block").click();
  await setPlayhead(page, 1);
  await page.locator("#splitSubtitleBtn").click();
  await expect(page.locator(".subtitle-cue")).toHaveCount(2);
  const rows = page.locator(".subtitle-cue");
  expect(await rows.nth(0).locator("[data-subtitle-start]").inputValue()).toBe("0");
  expect(await rows.nth(0).locator("[data-subtitle-end]").inputValue()).toBe("1");
  expect(await rows.nth(1).locator("[data-subtitle-start]").inputValue()).toBe("1");
  expect(await rows.nth(1).locator("[data-subtitle-end]").inputValue()).toBe("2");
  await expect(page.locator("#mergeSubtitleBtn")).toBeEnabled();

  await page.locator("#mergeSubtitleBtn").click();
  await expect(page.locator(".subtitle-cue")).toHaveCount(1);
  expect(await page.locator("[data-subtitle-text]").inputValue()).toBe("This caption can split into two parts");
  expect(await page.locator("[data-subtitle-end]").inputValue()).toBe("2");
});

test("subtitle timeline drag moves a cue and its end handle resizes it", async ({ page }) => {
  await openStudio(page);
  await page.locator("#subtitlesEnabled").check();
  await page.locator("#addSubtitleBtn").click();
  const cue = page.locator(".subtitle-cue").first();
  await cue.locator("[data-subtitle-start]").fill("0");
  await cue.locator("[data-subtitle-end]").fill("2");
  await cue.locator("[data-subtitle-text]").fill("Drag and resize this caption");

  const lane = page.locator("#subtitleTimelineLane");
  const laneBox = await lane.boundingBox();
  const block = page.locator(".subtitle-timeline-block").first();
  const blockBox = await block.boundingBox();
  await page.mouse.move(blockBox.x + blockBox.width / 2, blockBox.y + blockBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(blockBox.x + blockBox.width / 2 + laneBox.width * 0.1, blockBox.y + blockBox.height / 2, {steps:5});
  await page.mouse.up();
  const startAfterMove = Number(await cue.locator("[data-subtitle-start]").inputValue());
  const endAfterMove = Number(await cue.locator("[data-subtitle-end]").inputValue());
  expect(startAfterMove).toBeGreaterThan(0.4);
  expect(endAfterMove - startAfterMove).toBeCloseTo(2, 1);

  const endHandle = page.locator(".subtitle-timeline-block [data-subtitle-edge='end']").first();
  const handleBox = await endHandle.boundingBox();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + laneBox.width * 0.08, handleBox.y + handleBox.height / 2, {steps:5});
  await page.mouse.up();
  const resizedEnd = Number(await cue.locator("[data-subtitle-end]").inputValue());
  expect(resizedEnd).toBeGreaterThan(endAfterMove + 0.2);
});
