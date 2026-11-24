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
  page.on("close", () => {
    if (pageErrors.length) throw new Error(pageErrors.join("\n"));
  });
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

  // Two 3-second clips with a 0.5-second overlap start blending at 2.5 seconds.
  await setPlayhead(page, 2.75);
  await expect.poll(async () => (await activeVideoState(page)).length).toBe(2);

  let layers = await activeVideoState(page);
  const first = layers.find(layer => layer.source.endsWith("/job-a"));
  const second = layers.find(layer => layer.source.endsWith("/job-b"));
  expect(first).toBeTruthy();
  expect(second).toBeTruthy();
  expect(first.opacity).toBeCloseTo(1, 2);
  expect(second.opacity).toBeCloseTo(0.5, 1);
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

test("portrait export selection creates a portrait video monitor frame", async ({ page }) => {
  await openStudio(page, "9:16");
  const frame = page.locator(".assembly-video-frame");
  await expect(frame).toBeVisible();
  expect(await frame.evaluate(element => element.style.aspectRatio)).toBe("9 / 16");
});
