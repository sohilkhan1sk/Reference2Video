import test from "node:test";
import assert from "node:assert/strict";
import "../static/audio_preview.js";

const { buildAudioPreviewPlan, computeWaveformPeaks } = globalThis.Reference2VideoAudioPreview;

test("preview plan applies trim, fade timing and source offsets to voiceover", () => {
  const plan = buildAudioPreviewPlan({
    durationSeconds: 30,
    playheadSeconds: 6,
    tracks: [{
      kind: "voiceover",
      fileName: "narration.wav",
      sourceDurationSeconds: 40,
      trimStartSeconds: 5,
      trimEndSeconds: 20,
      fadeInSeconds: 2,
      fadeOutStartSeconds: 8,
      fadeOutSeconds: 3
    }]
  });
  const track = plan.tracks[0];
  assert.equal(track.shouldPlay, true);
  assert.equal(track.sourceLengthSeconds, 15);
  assert.equal(track.sourceOffsetSeconds, 11);
  assert.equal(track.elapsedSeconds, 6);
  assert.equal(track.playbackDurationSeconds, 9);
});

test("looping music starts at the correct point inside its trimmed loop", () => {
  const plan = buildAudioPreviewPlan({
    durationSeconds: 60,
    playheadSeconds: 17,
    tracks: [{
      kind: "music",
      hasFile: true,
      sourceDurationSeconds: 12,
      trimStartSeconds: 2,
      trimEndSeconds: 10,
      loop: true,
      fadeOutStartSeconds: 48,
      fadeOutSeconds: 6
    }]
  });
  const track = plan.tracks[0];
  assert.equal(track.shouldPlay, true);
  assert.equal(track.sourceLengthSeconds, 8);
  assert.equal(track.sourceOffsetSeconds, 3);
  assert.equal(track.playbackDurationSeconds, 43);
  assert.equal(track.timelineEndSeconds, 60);
});

test("SFX playback begins at its cue and seeks into its trimmed source", () => {
  const plan = buildAudioPreviewPlan({
    durationSeconds: 30,
    playheadSeconds: 6,
    tracks: [{
      kind: "sfx",
      fileName: "impact.wav",
      sourceDurationSeconds: 8,
      startSeconds: 5,
      trimStartSeconds: 1,
      trimEndSeconds: 4
    }]
  });
  const track = plan.tracks[0];
  assert.equal(track.shouldPlay, true);
  assert.equal(track.sourceOffsetSeconds, 2);
  assert.equal(track.playbackDurationSeconds, 2);
  assert.equal(track.startDelaySeconds, 0);
});

test("future SFX cue is scheduled after the playhead without consuming its source", () => {
  const plan = buildAudioPreviewPlan({
    durationSeconds: 20,
    playheadSeconds: 3,
    tracks: [{
      kind: "sfx",
      hasFile: true,
      sourceDurationSeconds: 4,
      startSeconds: 8
    }]
  });
  const track = plan.tracks[0];
  assert.equal(track.shouldPlay, true);
  assert.equal(track.startDelaySeconds, 5);
  assert.equal(track.sourceOffsetSeconds, 0);
  assert.equal(track.playbackDurationSeconds, 4);
});

test("tracks outside the export or with empty trims are not scheduled", () => {
  const plan = buildAudioPreviewPlan({
    durationSeconds: 10,
    tracks: [
      { hasFile: true, sourceDurationSeconds: 2, startSeconds: 12 },
      { hasFile: true, sourceDurationSeconds: 5, trimStartSeconds: 5 }
    ]
  });
  assert.equal(plan.tracks[0].shouldPlay, false);
  assert.equal(plan.tracks[1].shouldPlay, false);
});

test("waveform peaks are calculated across channels and source trim", () => {
  const channels = [
    Float32Array.from([0, 0.5, -0.25, 1, 0, -0.75, 0.25, -0.5]),
    Float32Array.from([0, -0.2, 0.1, 0.3, 0, 0.1, -0.9, 0.2])
  ];
  const buffer = {
    sampleRate: 4,
    length: 8,
    numberOfChannels: 2,
    getChannelData: index => channels[index]
  };
  assert.deepEqual(computeWaveformPeaks(buffer, 0, 0, 4), [0.5, 1, 0.75, 0.5]);
  assert.deepEqual(computeWaveformPeaks(buffer, 0.5, 1.5, 2), [1, 0.75]);
  assert.deepEqual(computeWaveformPeaks(buffer, 2, 2, 8), []);
});
