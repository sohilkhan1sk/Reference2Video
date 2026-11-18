(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.Reference2VideoTimeline = api;
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

  function formatTime(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remainder = total % 60;
    if (hours) {
      return String(hours).padStart(2, "0") + ":" +
        String(minutes).padStart(2, "0") + ":" +
        String(remainder).padStart(2, "0");
    }
    return String(minutes).padStart(2, "0") + ":" +
      String(remainder).padStart(2, "0");
  }

  function buildTimelineModel(options) {
    const input = options || {};
    const duration = Math.max(0, numberOrNull(input.durationSeconds) || 0);
    const step = duration <= 30 ? 5 :
      duration <= 90 ? 10 :
      duration <= 180 ? 15 :
      duration <= 600 ? 30 : 60;
    const ticks = [];
    if (duration > 0) {
      for (let tick = 0; tick < duration; tick += step) ticks.push(tick);
      if (!ticks.length || ticks[ticks.length - 1] !== duration) ticks.push(duration);
    }

    const lanes = (Array.isArray(input.tracks) ? input.tracks : []).map((track, index) => {
      const item = track || {};
      const hasFile = Boolean(item.hasFile || item.fileName);
      const start = Math.max(0, numberOrNull(item.startSeconds) || 0);
      const trimStart = Math.max(0, numberOrNull(item.trimStartSeconds) || 0);
      const trimEnd = Math.max(0, numberOrNull(item.trimEndSeconds) || 0);
      const sourceDuration = numberOrNull(item.sourceDurationSeconds);
      let sourceLength = null;

      if (sourceDuration !== null && sourceDuration >= 0) {
        const sourceEnd = trimEnd > 0 ? Math.min(sourceDuration, trimEnd) : sourceDuration;
        sourceLength = Math.max(0, sourceEnd - trimStart);
      } else if (trimEnd > 0) {
        sourceLength = Math.max(0, trimEnd - trimStart);
      }

      const startPercent = duration > 0 ? clamp(start / duration * 100, 0, 100) : 0;
      let visibleDuration = item.loop ? Math.max(0, duration - start) : sourceLength;
      if (visibleDuration !== null) {
        visibleDuration = Math.max(0, Math.min(visibleDuration, duration - start));
      }
      const unknownDuration = Boolean(hasFile && !item.loop && visibleDuration === null);
      const markerWidth = unknownDuration && duration > 0
        ? Math.min(1.25, Math.max(0, 100 - startPercent))
        : 0;
      const widthPercent = duration > 0
        ? (visibleDuration === null ? markerWidth : visibleDuration / duration * 100)
        : 0;
      const fadeIn = Math.max(0, numberOrNull(item.fadeInSeconds) || 0);
      const fadeOutStart = Math.max(0, numberOrNull(item.fadeOutStartSeconds) || 0);
      const fadeOut = Math.max(0, numberOrNull(item.fadeOutSeconds) || 0);
      const fadeBasis = visibleDuration || 0;

      return {
        id: item.id || "lane-" + index,
        kind: item.kind || "audio",
        label: item.label || "Audio",
        fileName: item.fileName || "",
        hasFile,
        loop: Boolean(item.loop),
        startSeconds: start,
        startPercent,
        widthPercent,
        visibleDurationSeconds: visibleDuration,
        unknownDuration,
        outOfRange: duration > 0 && start >= duration,
        fadeInPercent: fadeBasis ? Math.min(fadeIn, fadeBasis) / fadeBasis * 100 : 0,
        fadeOutLeftPercent: fadeBasis ? Math.min(fadeOutStart, fadeBasis) / fadeBasis * 100 : 0,
        fadeOutWidthPercent: fadeBasis ? Math.min(fadeOut, Math.max(0, fadeBasis - fadeOutStart)) / fadeBasis * 100 : 0
      };
    });

    return { durationSeconds: duration, tickStepSeconds: step, ticks, lanes };
  }

  return { buildTimelineModel, formatTime };
});
