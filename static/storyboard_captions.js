(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.Reference2VideoStoryboardCaptions = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const MAX_CAPTIONS = 200;
  const MAX_SECONDS = 3600;
  const MAX_LINE_LENGTH = 42;

  function roundSeconds(value) {
    return Math.round(value * 1000) / 1000;
  }

  function parseTimeToken(value) {
    let text = String(value === undefined || value === null ? "" : value).trim();
    text = text.replace(/\s*(?:seconds?|secs?|s)$/i, "").replace(/,/g, ".");
    if (!text) return null;
    if (/^\d+(?:\.\d+)?$/.test(text)) {
      const seconds = Number(text);
      return Number.isFinite(seconds) ? seconds : null;
    }
    const parts = text.split(":");
    if (parts.length === 2 && parts.every(part => /^\d+(?:\.\d+)?$/.test(part))) {
      const minutes = Number(parts[0]);
      const seconds = Number(parts[1]);
      if (seconds >= 60) return null;
      return minutes * 60 + seconds;
    }
    if (parts.length === 3 && parts.every(part => /^\d+(?:\.\d+)?$/.test(part))) {
      const hours = Number(parts[0]);
      const minutes = Number(parts[1]);
      const seconds = Number(parts[2]);
      if (minutes >= 60 || seconds >= 60) return null;
      return hours * 3600 + minutes * 60 + seconds;
    }
    return null;
  }

  function parseSceneTimeRange(sceneOrValue) {
    const scene = sceneOrValue && typeof sceneOrValue === "object" ? sceneOrValue : null;
    const raw = scene
      ? (scene.time ?? scene.time_range ?? scene.timestamp ?? "")
      : sceneOrValue;
    const text = String(raw || "").trim();
    const token = "(?:\\d{1,2}:\\d{2}(?::\\d{2})?(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?\\s*(?:s|sec(?:onds?)?)?)";
    const pattern = new RegExp("(^|[^\\d])(" + token + ")\\s*(?:-|–|—|to|→)\\s*(" + token + ")(?=$|[^\\d])", "i");
    const match = text.match(pattern);
    let start = null;
    let end = null;
    if (match) {
      start = parseTimeToken(match[2]);
      end = parseTimeToken(match[3]);
    } else if (scene) {
      const startValue = scene.start_seconds ?? scene.start_time ?? scene.start;
      const endValue = scene.end_seconds ?? scene.end_time ?? scene.end;
      start = parseTimeToken(startValue);
      end = parseTimeToken(endValue);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > MAX_SECONDS) {
      return null;
    }
    return { startSeconds: roundSeconds(start), endSeconds: roundSeconds(end) };
  }

  function cleanCaptionSource(value) {
    const raw = Array.isArray(value) ? value.join(" ") : value;
    if (typeof raw !== "string") return "";
    const text = raw.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
    if (!text || /^(?:none|n\/a|na|nil|not applicable|no voice[ -]?over|no on[ -]?screen text|—|-)\.?$/i.test(text)) {
      return "";
    }
    return text;
  }

  function splitCaptionText(value) {
    const text = cleanCaptionSource(value);
    if (!text) return [];
    const words = text.split(" ");
    const expanded = [];
    words.forEach(word => {
      if (word.length <= MAX_LINE_LENGTH) {
        expanded.push(word);
        return;
      }
      for (let offset = 0; offset < word.length; offset += MAX_LINE_LENGTH) {
        expanded.push(word.slice(offset, offset + MAX_LINE_LENGTH));
      }
    });
    const lines = [];
    let line = "";
    expanded.forEach(word => {
      const candidate = line ? line + " " + word : word;
      if (line && candidate.length > MAX_LINE_LENGTH) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    });
    if (line) lines.push(line);
    const chunks = [];
    for (let index = 0; index < lines.length; index += 2) {
      const chunkLines = lines.slice(index, index + 2);
      const chunkText = chunkLines.join("\n");
      chunks.push({ text: chunkText, wordCount: chunkLines.join(" ").split(/\s+/).filter(Boolean).length });
    }
    return chunks;
  }

  function validTimelineSegment(segment) {
    if (!segment || typeof segment !== "object") return false;
    const start = Number(segment.startSeconds);
    const duration = Number(segment.durationSeconds);
    return Number.isFinite(start) && start >= 0 && Number.isFinite(duration) && duration > 0;
  }

  function appendSourceCues(output, text, source, sceneNumber, range, timelineSegment) {
    const chunks = splitCaptionText(text);
    if (!chunks.length) return;
    const duration = range.endSeconds - range.startSeconds;
    const totalWords = chunks.reduce((sum, chunk) => sum + chunk.wordCount, 0) || chunks.length;
    let consumed = 0;
    chunks.forEach((chunk, index) => {
      const startRatio = consumed / totalWords;
      consumed += chunk.wordCount;
      const endRatio = consumed / totalWords;
      let start = range.startSeconds + duration * startRatio;
      let end = index === chunks.length - 1
        ? range.endSeconds
        : range.startSeconds + duration * endRatio;
      if (timelineSegment) {
        const segmentStart = Number(timelineSegment.startSeconds);
        const segmentDuration = Number(timelineSegment.durationSeconds);
        start = segmentStart + startRatio * segmentDuration;
        end = index === chunks.length - 1
          ? segmentStart + segmentDuration
          : segmentStart + endRatio * segmentDuration;
      }
      start = roundSeconds(start);
      end = roundSeconds(end);
      if (end <= start) return;
      output.push({
        start_seconds: start,
        end_seconds: end,
        text: chunk.text,
        source: source,
        scene_number: sceneNumber
      });
    });
  }

  function buildStoryboardCaptionDrafts(scenes, options) {
    const input = options || {};
    const list = Array.isArray(scenes) ? scenes : [];
    const includeOnScreenText = input.includeOnScreenText !== false;
    const segments = Array.isArray(input.timelineSegments) ? input.timelineSegments : null;
    const useTimelineMapping = Boolean(
      segments && segments.length === list.length && segments.every(validTimelineSegment)
    );
    const captions = [];
    const warnings = [];

    list.forEach((sceneValue, index) => {
      const scene = sceneValue && typeof sceneValue === "object" ? sceneValue : {};
      const voiceover = cleanCaptionSource(scene.voiceover);
      const onScreen = includeOnScreenText ? cleanCaptionSource(scene.on_screen_text) : "";
      if (!voiceover && !onScreen) return;
      const range = parseSceneTimeRange(scene);
      if (!range) {
        warnings.push("Scene " + (index + 1) + " has caption text but no readable start–end time; it was skipped.");
        return;
      }
      const timelineSegment = useTimelineMapping ? segments[index] : null;
      if (voiceover) {
        appendSourceCues(captions, voiceover, "Voice-over", index + 1, range, timelineSegment);
      }
      if (onScreen && onScreen.toLocaleLowerCase() !== voiceover.toLocaleLowerCase()) {
        appendSourceCues(captions, onScreen, "On-screen text", index + 1, range, timelineSegment);
      }
    });

    captions.sort((a, b) => a.start_seconds - b.start_seconds || a.scene_number - b.scene_number ||
      (a.source === "Voice-over" ? -1 : 1));
    if (captions.length > MAX_CAPTIONS) {
      captions.length = MAX_CAPTIONS;
      warnings.push("Drafts were limited to " + MAX_CAPTIONS + " cues. Review the storyboard for omitted text.");
    }
    return {
      captions: captions,
      warnings: warnings,
      usedTimelineMapping: useTimelineMapping,
      sceneCount: list.length
    };
  }

  return {
    parseTimeToken: parseTimeToken,
    parseSceneTimeRange: parseSceneTimeRange,
    splitCaptionText: splitCaptionText,
    buildStoryboardCaptionDrafts: buildStoryboardCaptionDrafts
  };
});