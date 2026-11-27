(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.Reference2VideoSubtitleTimeline = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const MIN_DURATION = 0.1;
  const MAX_SECONDS = 3600;
  const SNAP_SECONDS = 0.1;
  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function snapSeconds(value) {
    return Number((Math.round(finite(value, 0) / SNAP_SECONDS) * SNAP_SECONDS).toFixed(1));
  }
  function normalizeCue(cue) {
    if (!cue || typeof cue !== "object") return null;
    const start = finite(cue.start, NaN), end = finite(cue.end, NaN);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > MAX_SECONDS || end - start < MIN_DURATION - 1e-9) return null;
    return { ...cue, start, end, text: String(cue.text || "") };
  }
  function layoutCues(cues, durationSeconds) {
    const duration = Math.max(0.1, Math.min(MAX_SECONDS, finite(durationSeconds, 30)));
    const sorted = (Array.isArray(cues) ? cues : []).map(normalizeCue).filter(Boolean)
      .sort((a, b) => a.start - b.start || a.end - b.end || String(a.id).localeCompare(String(b.id)));
    const laneEnds = [];
    return sorted.map(cue => {
      let lane = laneEnds.findIndex(end => end <= cue.start + 1e-6);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = cue.end;
      const visibleStart = Math.max(0, Math.min(duration, cue.start));
      const visibleEnd = Math.max(visibleStart, Math.min(duration, cue.end));
      return { ...cue, lane, leftPercent: visibleStart / duration * 100,
        widthPercent: Math.max(0, (visibleEnd - visibleStart) / duration * 100),
        clippedAfter: cue.end > duration };
    });
  }
  function moveCue(cueValue, deltaSeconds, durationSeconds) {
    const cue = normalizeCue(cueValue);
    if (!cue) return { error: "Select a caption with a valid time range." };
    const duration = Math.max(0.1, Math.min(MAX_SECONDS, finite(durationSeconds, MAX_SECONDS)));
    const length = snapSeconds(cue.end - cue.start);
    if (length > duration + 1e-6) return { error: "This caption is longer than the timeline. Shorten it before moving." };
    const start = Math.max(0, Math.min(duration - length, snapSeconds(cue.start + finite(deltaSeconds, 0))));
    return { ...cue, start, end: snapSeconds(start + length) };
  }
  function resizeCue(cueValue, edge, deltaSeconds, durationSeconds) {
    const cue = normalizeCue(cueValue);
    if (!cue) return { error: "Select a caption with a valid time range." };
    if (edge !== "start" && edge !== "end") return { error: "Choose the left or right caption edge to resize." };
    const duration = Math.max(0.1, Math.min(MAX_SECONDS, finite(durationSeconds, MAX_SECONDS)));
    const delta = finite(deltaSeconds, 0);
    if (edge === "start") {
      const start = Math.max(0, Math.min(cue.end - MIN_DURATION, snapSeconds(cue.start + delta)));
      return { ...cue, start, end: cue.end };
    }
    const end = Math.max(cue.start + MIN_DURATION, Math.min(duration, snapSeconds(cue.end + delta)));
    return { ...cue, start: cue.start, end };
  }
  function splitCue(cueValue, atSeconds) {
    const cue = normalizeCue(cueValue);
    if (!cue) return { error: "Select a caption with a valid time range." };
    const at = snapSeconds(atSeconds);
    if (at < cue.start + MIN_DURATION - 1e-6 || at > cue.end - MIN_DURATION + 1e-6) {
      return { error: "Place the playhead at least 0.1 seconds inside the selected caption." };
    }
    const words = cue.text.trim().split(/\s+/).filter(Boolean);
    if (words.length < 2) return { error: "Add at least two words before splitting this caption." };
    const totalLength = words.join(" ").length;
    let bestIndex = 1, bestDistance = Infinity, consumed = 0;
    for (let index = 1; index < words.length; index += 1) {
      consumed += words[index - 1].length + (index > 1 ? 1 : 0);
      const distance = Math.abs(consumed - totalLength / 2);
      if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
    }
    const firstText = words.slice(0, bestIndex).join(" "), secondText = words.slice(bestIndex).join(" ");
    if (!firstText || !secondText) return { error: "This caption cannot be split at a word boundary." };
    return { first: { ...cue, end: at, text: firstText }, second: { ...cue, id: null, start: at, text: secondText } };
  }
  function mergeCues(cuesValue, selectedIds) {
    const cues = (Array.isArray(cuesValue) ? cuesValue : []).map(normalizeCue).filter(Boolean)
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const ids = Array.from(new Set(Array.isArray(selectedIds) ? selectedIds.map(String) : []));
    if (ids.length !== 2) return { error: "Select exactly two captions to merge (Shift-click the second)." };
    const selected = ids.map(id => cues.find(cue => String(cue.id) === id));
    if (selected.some(cue => !cue)) return { error: "One selected caption is no longer available." };
    selected.sort((a, b) => a.start - b.start || a.end - b.end);
    const firstIndex = cues.findIndex(cue => String(cue.id) === String(selected[0].id));
    const secondIndex = cues.findIndex(cue => String(cue.id) === String(selected[1].id));
    if (secondIndex !== firstIndex + 1) return { error: "Select two neighboring captions on the timeline to merge them." };
    const text = [selected[0].text.trim(), selected[1].text.trim()].filter(Boolean).join(" ");
    if (!text) return { error: "Add text to both captions before merging." };
    if (text.length > 220 || text.split("\n").length > 2) return { error: "The merged caption exceeds the 220-character/two-line limit. Shorten the text first." };
    return { cue: { ...selected[0], start: selected[0].start, end: Math.max(selected[0].end, selected[1].end), text } };
  }
  return { MIN_DURATION, MAX_SECONDS, snapSeconds, layoutCues, moveCue, resizeCue, splitCue, mergeCues };
});
