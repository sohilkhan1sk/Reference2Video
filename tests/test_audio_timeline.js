const test = require("node:test");
const assert = require("node:assert/strict");
const { buildTimelineModel, formatTime } = require("../static/audio_timeline.js");

test("time ruler chooses readable intervals and includes the exact end", () => {
  const model = buildTimelineModel({ durationSeconds: 65, tracks: [] });
  assert.equal(model.tickStepSeconds, 10);
  assert.deepEqual(model.ticks, [0, 10, 20, 30, 40, 50, 60, 65]);
  assert.equal(formatTime(65), "01:05");
  assert.equal(formatTime(3661), "01:01:01");
});

test("voiceover bar reflects source trim and is clipped to the export duration", () => {
  const model = buildTimelineModel({
    durationSeconds: 30,
    tracks: [{
      kind: "voiceover", fileName: "narration.wav", sourceDurationSeconds: 40,
      trimStartSeconds: 5, trimEndSeconds: 20, fadeInSeconds: 2,
      fadeOutStartSeconds: 8, fadeOutSeconds: 3
    }]
  });
  const lane = model.lanes[0];
  assert.equal(lane.startPercent, 0);
  assert.equal(lane.visibleDurationSeconds, 15);
  assert.equal(lane.widthPercent, 50);
  assert.equal(lane.fadeInPercent, 100 / 15);
  assert.equal(lane.fadeOutLeftPercent, 8 / 15 * 100);
  assert.equal(lane.fadeOutWidthPercent, 20);
});

test("looping music fills the export and keeps fade positions on the export timeline", () => {
  const model = buildTimelineModel({
    durationSeconds: 60,
    tracks: [{
      kind: "music", fileName: "music.mp3", loop: true,
      sourceDurationSeconds: 12, fadeInSeconds: 3,
      fadeOutStartSeconds: 48, fadeOutSeconds: 6
    }]
  });
  const lane = model.lanes[0];
  assert.equal(lane.widthPercent, 100);
  assert.equal(lane.visibleDurationSeconds, 60);
  assert.equal(lane.fadeInPercent, 5);
  assert.equal(lane.fadeOutLeftPercent, 80);
  assert.equal(lane.fadeOutWidthPercent, 10);
});

test("SFX starts at its cue timestamp and uses its trimmed source length", () => {
  const model = buildTimelineModel({
    durationSeconds: 30,
    tracks: [{
      kind: "sfx", fileName: "impact.wav", startSeconds: 5,
      sourceDurationSeconds: 8, trimStartSeconds: 1,
      trimEndSeconds: 4, fadeInSeconds: 0.5,
      fadeOutStartSeconds: 1.5, fadeOutSeconds: 1
    }]
  });
  const lane = model.lanes[0];
  assert.equal(lane.startPercent, 100 / 6);
  assert.equal(lane.visibleDurationSeconds, 3);
  assert.equal(lane.widthPercent, 10);
  assert.ok(Math.abs(lane.fadeInPercent - 100 / 6) < 1e-9);
  assert.equal(lane.fadeOutLeftPercent, 50);
  assert.ok(Math.abs(lane.fadeOutWidthPercent - 100 / 3) < 1e-9);
});

test("unknown audio duration is represented by a marker, not an invented length", () => {
  const model = buildTimelineModel({
    durationSeconds: 20,
    tracks: [{ kind: "voiceover", fileName: "unknown.mp3" }]
  });
  assert.equal(model.lanes[0].unknownDuration, true);
  assert.equal(model.lanes[0].widthPercent, 1.25);
  assert.equal(model.lanes[0].visibleDurationSeconds, null);
});

test("a cue beyond the export is flagged and receives no visible duration", () => {
  const model = buildTimelineModel({
    durationSeconds: 10,
    tracks: [{ kind: "sfx", fileName: "late.wav", startSeconds: 12, sourceDurationSeconds: 2 }]
  });
  assert.equal(model.lanes[0].outOfRange, true);
  assert.equal(model.lanes[0].widthPercent, 0);
});
