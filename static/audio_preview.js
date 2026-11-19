(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.Reference2VideoAudioPreview = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function numberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function buildAudioPreviewPlan(options) {
    const input = options || {};
    const duration = Math.max(0, numberOrNull(input.durationSeconds) || 0);
    const playhead = clamp(numberOrNull(input.playheadSeconds) || 0, 0, duration);
    const tracks = (Array.isArray(input.tracks) ? input.tracks : []).map(function (track, index) {
      const item = track || {};
      const sourceDuration = numberOrNull(item.sourceDurationSeconds);
      const trimStart = Math.max(0, numberOrNull(item.trimStartSeconds) || 0);
      const trimEnd = Math.max(0, numberOrNull(item.trimEndSeconds) || 0);
      const sourceEnd = sourceDuration === null ? null :
        (trimEnd > 0 ? Math.min(sourceDuration, trimEnd) : sourceDuration);
      const sourceLength = sourceEnd === null ? null : Math.max(0, sourceEnd - trimStart);
      const loop = Boolean(item.loop);
      const start = Math.max(0, numberOrNull(item.startSeconds) || 0);
      const timelineEnd = sourceLength === null ? null :
        (loop ? duration : Math.min(duration, start + sourceLength));
      const effectiveEnd = timelineEnd === null ? duration : timelineEnd;
      const elapsed = Math.max(0, playhead - start);
      const shouldPlay = Boolean(item.hasFile || item.fileName) &&
        sourceLength !== null && sourceLength > 0 &&
        start < duration && effectiveEnd > playhead;
      const sourceOffset = sourceLength === null ? trimStart :
        trimStart + (loop ? (elapsed % sourceLength) : Math.min(elapsed, sourceLength));
      const playbackDuration = shouldPlay
        ? Math.max(0, effectiveEnd - Math.max(playhead, start))
        : 0;
      return {
        index: index,
        id: item.id || "track-" + index,
        kind: item.kind || "audio",
        loop: loop,
        startSeconds: start,
        timelineEndSeconds: timelineEnd,
        sourceDurationSeconds: sourceDuration,
        sourceStartSeconds: trimStart,
        sourceEndSeconds: sourceEnd,
        sourceLengthSeconds: sourceLength,
        sourceOffsetSeconds: sourceOffset,
        startDelaySeconds: Math.max(0, start - playhead),
        elapsedSeconds: elapsed,
        playbackDurationSeconds: playbackDuration,
        fadeInSeconds: Math.max(0, numberOrNull(item.fadeInSeconds) || 0),
        fadeOutStartSeconds: Math.max(0, numberOrNull(item.fadeOutStartSeconds) || 0),
        fadeOutSeconds: Math.max(0, numberOrNull(item.fadeOutSeconds) || 0),
        gain: clamp(numberOrNull(item.gain) === null ? 1 : numberOrNull(item.gain), 0, 2),
        shouldPlay: shouldPlay
      };
    });
    return {
      durationSeconds: duration,
      playheadSeconds: playhead,
      tracks: tracks
    };
  }

  function computeWaveformPeaks(buffer, trimStartSeconds, trimEndSeconds, bucketCount) {
    if (!buffer || typeof buffer.getChannelData !== "function") return [];
    const sampleRate = numberOrNull(buffer.sampleRate);
    const length = numberOrNull(buffer.length);
    const channelCount = Math.max(1, Math.floor(numberOrNull(buffer.numberOfChannels) || 1));
    if (!sampleRate || !length) return [];

    const start = clamp(Math.floor(Math.max(0, numberOrNull(trimStartSeconds) || 0) * sampleRate), 0, length);
    const requestedEnd = numberOrNull(trimEndSeconds);
    const end = requestedEnd !== null && requestedEnd > 0
      ? clamp(Math.floor(requestedEnd * sampleRate), start, length)
      : length;
    const frameCount = end - start;
    if (frameCount <= 0) return [];

    const count = clamp(Math.floor(numberOrNull(bucketCount) || 180), 1, 1024);
    const channels = [];
    for (let channel = 0; channel < channelCount; channel += 1) {
      channels.push(buffer.getChannelData(channel));
    }

    const peaks = [];
    for (let bucket = 0; bucket < count; bucket += 1) {
      const from = start + Math.floor(bucket * frameCount / count);
      const to = Math.max(from + 1, start + Math.floor((bucket + 1) * frameCount / count));
      let peak = 0;
      for (let frame = from; frame < Math.min(end, to); frame += 1) {
        for (let channel = 0; channel < channels.length; channel += 1) {
          const sample = Math.abs(channels[channel][frame] || 0);
          if (sample > peak) peak = sample;
        }
      }
      peaks.push(clamp(peak, 0, 1));
    }
    return peaks;
  }

  return {
    buildAudioPreviewPlan: buildAudioPreviewPlan,
    computeWaveformPeaks: computeWaveformPeaks
  };
});
