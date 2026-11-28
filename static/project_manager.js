(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.Reference2VideoProjectManager = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const SCHEMA_VERSION = 1;
  const MAX_PROJECTS = 20;
  const MAX_PROJECT_BYTES = 2 * 1024 * 1024;
  const INDEX_KEY = "reference2video.projects.index.v1";
  const PROJECT_PREFIX = "reference2video.project.v1.";
  const SECRET_KEY = /(token|api[_-]?key|secret|password|authorization|credential)/i;

  function now() { return Date.now(); }
  function makeId() {
    const cryptoObject = typeof crypto !== "undefined" ? crypto : null;
    if (cryptoObject && typeof cryptoObject.randomUUID === "function") {
      return cryptoObject.randomUUID();
    }
    return "r2v-" + now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
  }
  function cleanText(value, maxLength, fallback) {
    const text = String(value == null ? "" : value).replace(/\u0000/g, "").trim();
    return text.slice(0, maxLength) || fallback || "";
  }
  function finiteNumber(value, fallback, minimum, maximum, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      if (fallback !== undefined) return fallback;
      throw new Error((label || "Value") + " must be a finite number.");
    }
    if (number < minimum || number > maximum) {
      throw new Error((label || "Value") + " must be between " + minimum + " and " + maximum + ".");
    }
    return number;
  }
  function cloneWithoutSecrets(value, depth) {
    if (depth > 30) throw new Error("Project data is nested too deeply.");
    if (Array.isArray(value)) return value.map(item => cloneWithoutSecrets(item, depth + 1));
    if (!value || typeof value !== "object") {
      if (typeof value === "string") return value.slice(0, 20000);
      if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
      return null;
    }
    const result = {};
    Object.keys(value).forEach(key => {
      if (SECRET_KEY.test(key)) return;
      result[key] = cloneWithoutSecrets(value[key], depth + 1);
    });
    return result;
  }
  function safeFileName(value) {
    return cleanText(value, 255, "").replace(/[\/\\]/g, "").replace(/[\r\n]/g, "");
  }
  function normalizeProcessing(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const result = {
      trim_start_seconds: finiteNumber(source.trim_start_seconds, 0, 0, 3600, "Audio trim start"),
      trim_end_seconds: finiteNumber(source.trim_end_seconds, 0, 0, 3600, "Audio trim end"),
      fade_in_seconds: finiteNumber(source.fade_in_seconds, 0, 0, 10, "Audio fade-in"),
      fade_out_start_seconds: finiteNumber(source.fade_out_start_seconds, 0, 0, 3600, "Audio fade-out start"),
      fade_out_seconds: finiteNumber(source.fade_out_seconds, 0, 0, 10, "Audio fade-out")
    };
    if (result.trim_end_seconds && result.trim_end_seconds <= result.trim_start_seconds) {
      throw new Error("Audio trim end must be greater than trim start.");
    }
    return result;
  }
  function normalizeTrack(raw, defaultGain) {
    const source = raw && typeof raw === "object" ? raw : {};
    return {
      file_name: safeFileName(source.file_name),
      gain: finiteNumber(source.gain, defaultGain, 0, 2, "Audio gain"),
      processing: normalizeProcessing(source.processing)
    };
  }
  function normalizeProject(raw, options) {
    const settings = options && typeof options === "object" ? options : {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("The project file must contain a JSON object.");
    }
    if (Number(raw.schema_version) !== SCHEMA_VERSION) {
      throw new Error("Unsupported project schema version. This app supports version " + SCHEMA_VERSION + ".");
    }
    const sourceState = raw.state && typeof raw.state === "object" ? raw.state : {};
    const storyboard = sourceState.storyboard && typeof sourceState.storyboard === "object"
      ? cloneWithoutSecrets(sourceState.storyboard, 0) : null;
    if (storyboard && (!Array.isArray(storyboard.ideas) || storyboard.ideas.length > 10)) {
      throw new Error("The saved storyboard must contain an ideas array with no more than 10 concepts.");
    }
    const ideas = storyboard && Array.isArray(storyboard.ideas) ? storyboard.ideas : [];
    const selectedIdea = ideas.length
      ? Math.max(0, Math.min(ideas.length - 1, Math.floor(finiteNumber(sourceState.selected_idea, 0, 0, 9, "Selected concept"))))
      : 0;

    const assemblySource = sourceState.assembly && typeof sourceState.assembly === "object" ? sourceState.assembly : {};
    const aspect = assemblySource.aspect_ratio === "9:16" ? "9:16" : "16:9";
    const queueInput = Array.isArray(assemblySource.queue) ? assemblySource.queue : [];
    if (queueInput.length > 100) throw new Error("A project can reference at most 100 generated clips.");
    const queue = [];
    const seen = new Set();
    queueInput.forEach(value => {
      const id = cleanText(value, 100, "");
      if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("A saved clip reference contains an invalid job ID.");
      if (!seen.has(id)) { seen.add(id); queue.push(id); }
    });
    const editsInput = assemblySource.edits_by_id && typeof assemblySource.edits_by_id === "object"
      ? assemblySource.edits_by_id : {};
    const edits = {};
    queue.forEach(id => {
      const edit = editsInput[id] && typeof editsInput[id] === "object" ? editsInput[id] : {};
      const transition = edit.transition_after === "crossfade" ? "crossfade" : "cut";
      edits[id] = {
        trim_start_seconds: finiteNumber(edit.trim_start_seconds, 0, 0, 3600, "Scene trim in"),
        trim_end_seconds: finiteNumber(edit.trim_end_seconds, 0, 0, 3600, "Scene trim out"),
        transition_after: transition,
        transition_duration_seconds: finiteNumber(edit.transition_duration_seconds, 0.5, 0.25, 2, "Crossfade duration")
      };
      if (edits[id].trim_end_seconds && edits[id].trim_end_seconds <= edits[id].trim_start_seconds) {
        throw new Error("A saved scene trim-out must be greater than its trim-in.");
      }
    });

    const audioSource = sourceState.audio && typeof sourceState.audio === "object" ? sourceState.audio : {};
    const sfxInput = Array.isArray(audioSource.sfx) ? audioSource.sfx : [];
    if (sfxInput.length > 6) throw new Error("A project can contain at most six SFX references.");
    const usedSfxIds = new Set();
    const sfx = sfxInput.map((cue, index) => {
      const source = cue && typeof cue === "object" ? cue : {};
      const id = Math.floor(finiteNumber(source.id, index, 0, 5, "SFX cue ID"));
      if (usedSfxIds.has(id)) throw new Error("SFX cue IDs must be unique.");
      usedSfxIds.add(id);
      return {
        id,
        file_name: safeFileName(source.file_name),
        start_seconds: finiteNumber(source.start_seconds, 0, 0, 900, "SFX start time"),
        gain: finiteNumber(source.gain, 1, 0, 2, "SFX gain"),
        processing: normalizeProcessing(source.processing)
      };
    });

    const subtitleSource = sourceState.subtitles && typeof sourceState.subtitles === "object"
      ? sourceState.subtitles : {};
    const cueInput = Array.isArray(subtitleSource.cues) ? subtitleSource.cues : [];
    if (cueInput.length > 200) throw new Error("A project can contain at most 200 subtitle cues.");
    const cues = cueInput.map((cue, index) => {
      const source = cue && typeof cue === "object" ? cue : {};
      const start = finiteNumber(source.start, 0, 0, 3600, "Subtitle start");
      const end = finiteNumber(source.end, 0, 0, 3600, "Subtitle end");
      const text = cleanText(source.text, 220, "");
      if (end <= start) throw new Error("Subtitle cue " + (index + 1) + " must end after it starts.");
      if (text.split("\n").length > 2 || text.split("\n").some(line => line.length > 100)) {
        throw new Error("Subtitle cue " + (index + 1) + " must fit within two lines of 100 characters.");
      }
      return {
        id: cleanText(source.id, 80, "subtitle-" + (index + 1)),
        start,
        end,
        text,
        source_label: cleanText(source.source_label, 100, "RESTORED CAPTION")
      };
    }).filter(cue => cue.text);

    const position = ["top", "middle", "bottom"].includes(subtitleSource.position) ? subtitleSource.position : "bottom";
    const color = ["white", "yellow", "cyan"].includes(subtitleSource.color) ? subtitleSource.color : "white";
    const fontSizeRatio = finiteNumber(subtitleSource.font_size_ratio, 0.045, 0.025, 0.08, "Subtitle size");

    const id = settings.newId ? makeId() : cleanText(raw.project_id, 100, "") || makeId();
    const createdAt = settings.newId ? now() : finiteNumber(raw.created_at, now(), 0, Number.MAX_SAFE_INTEGER, "Project creation time");
    const updatedAt = now();
    return {
      schema_version: SCHEMA_VERSION,
      project_id: id,
      name: cleanText(raw.name, 80, "Untitled project"),
      created_at: createdAt,
      updated_at: updatedAt,
      state: {
        reference_file_name: safeFileName(sourceState.reference_file_name),
        storyboard,
        selected_idea: selectedIdea,
        assembly: { aspect_ratio: aspect, queue, edits_by_id: edits },
        audio: {
          voiceover: normalizeTrack(audioSource.voiceover, 1),
          music: normalizeTrack(audioSource.music, 0.18),
          sfx
        },
        subtitles: {
          enabled: Boolean(subtitleSource.enabled),
          position,
          color,
          font_size_ratio: fontSizeRatio,
          cues
        }
      }
    };
  }
  function createProject(raw) {
    return normalizeProject(raw || {});
  }
  function serializeProject(project) {
    const normalized = normalizeProject(project);
    const text = JSON.stringify(normalized, null, 2);
    if (text.length > MAX_PROJECT_BYTES) throw new Error("Project JSON exceeds the 2 MB safety limit. Remove unused storyboard material and try again.");
    return text;
  }
  function parseProjectFile(text, options) {
    const source = String(text == null ? "" : text);
    if (!source || source.length > MAX_PROJECT_BYTES) {
      throw new Error("Project file is empty or exceeds the 2 MB safety limit.");
    }
    let parsed;
    try { parsed = JSON.parse(source); }
    catch (_) { throw new Error("This is not valid project JSON."); }
    return normalizeProject(parsed, options);
  }
  function readIndex(storage) {
    try {
      const parsed = JSON.parse(storage.getItem(INDEX_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.id === "string") : [];
    } catch (_) { return []; }
  }
  function listProjects(storage) {
    return readIndex(storage).sort((a, b) => Number(b.updated_at) - Number(a.updated_at))
      .map(item => ({
        project_id: item.id,
        name: cleanText(item.name, 80, "Untitled project"),
        updated_at: Number(item.updated_at) || 0
      }));
  }
  function saveProject(storage, raw) {
    const project = normalizeProject(raw);
    const serialized = JSON.stringify(project);
    if (serialized.length > MAX_PROJECT_BYTES) throw new Error("Project is larger than the 2 MB local-save limit. Export a smaller storyboard.");
    const index = readIndex(storage).filter(item => item.id !== project.project_id);
    index.unshift({ id: project.project_id, name: project.name, updated_at: project.updated_at });
    const kept = index.slice(0, MAX_PROJECTS);
    try {
      storage.setItem(PROJECT_PREFIX + project.project_id, serialized);
      storage.setItem(INDEX_KEY, JSON.stringify(kept));
      index.slice(MAX_PROJECTS).forEach(item => storage.removeItem(PROJECT_PREFIX + item.id));
    } catch (_) {
      throw new Error("Could not save to this browser's local storage. Check available site storage or export the project JSON as a backup.");
    }
    return project;
  }
  function loadProject(storage, projectId) {
    const id = cleanText(projectId, 100, "");
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Choose a valid saved project.");
    const raw = storage.getItem(PROJECT_PREFIX + id);
    if (!raw) throw new Error("That saved project is no longer available in this browser.");
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (_) { throw new Error("The saved project is damaged. Import a backup JSON file if you have one."); }
    const project = normalizeProject(parsed);
    if (project.project_id !== id) throw new Error("The saved project ID does not match its local storage key.");
    return project;
  }
  function deleteProject(storage, projectId) {
    const id = cleanText(projectId, 100, "");
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Choose a valid saved project.");
    storage.removeItem(PROJECT_PREFIX + id);
    const index = readIndex(storage).filter(item => item.id !== id);
    storage.setItem(INDEX_KEY, JSON.stringify(index));
    return index.length;
  }
  function fileName(name) {
    const slug = cleanText(name, 80, "reference2video-project").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
    return (slug || "reference2video-project") + ".r2v.json";
  }
  return {
    SCHEMA_VERSION, MAX_PROJECTS, MAX_PROJECT_BYTES, INDEX_KEY, PROJECT_PREFIX,
    createProject, normalizeProject, serializeProject, parseProjectFile,
    saveProject, listProjects, loadProject, deleteProject, fileName
  };
});
