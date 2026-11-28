import test from "node:test";
import assert from "node:assert/strict";
import "../static/project_manager.js";

const api = globalThis.Reference2VideoProjectManager;

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    keys() { return Array.from(values.keys()); }
  };
}

function sampleProject(overrides = {}) {
  return {
    schema_version: 1,
    project_id: "project-test-1",
    name: "Ice Age documentary",
    created_at: 1000,
    state: {
      reference_file_name: "reference.mp4",
      storyboard: {
        analysis: { summary: "Cold survival story", api_key: "must-not-export" },
        ideas: [{
          title: "Survive the Ice",
          scenes: [{ scene: 1, time: "00:00–00:05", video_prompt: "A snowy valley", voiceover: "The cold arrives." }]
        }]
      },
      selected_idea: 0,
      assembly: {
        aspect_ratio: "9:16",
        queue: ["clip-a", "clip-b"],
        edits_by_id: {
          "clip-a": { trim_start_seconds: 0.5, trim_end_seconds: 4.5, transition_after: "crossfade", transition_duration_seconds: 0.75 },
          "clip-b": { trim_start_seconds: 0, trim_end_seconds: 0, transition_after: "cut", transition_duration_seconds: 0.5 },
          "not-queued": { trim_start_seconds: 999 }
        }
      },
      audio: {
        voiceover: {
          file_name: "narration.wav",
          gain: 1.25,
          processing: { trim_start_seconds: 0.2, trim_end_seconds: 10, fade_in_seconds: 0.5 }
        },
        music: { file_name: "music.mp3", gain: 0.18 },
        sfx: [{
          id: 2, file_name: "impact.wav", start_seconds: 3.2, gain: 0.8,
          processing: { trim_start_seconds: 0.1, fade_out_seconds: 0.3 }
        }]
      },
      subtitles: {
        enabled: true, position: "bottom", color: "yellow", font_size_ratio: 0.05,
        cues: [{ id: "caption-1", start: 0.5, end: 2.5, text: "The cold arrives.", source_label: "SCENE 01 · VOICE-OVER" }]
      }
    },
    ...overrides
  };
}

test("normalizes and round-trips storyboard, clips, trims, audio settings and subtitles", () => {
  const project = api.createProject(sampleProject());
  const restored = api.parseProjectFile(api.serializeProject(project));
  assert.equal(restored.name, "Ice Age documentary");
  assert.equal(restored.state.storyboard.ideas[0].scenes[0].video_prompt, "A snowy valley");
  assert.deepEqual(restored.state.assembly.queue, ["clip-a", "clip-b"]);
  assert.equal(restored.state.assembly.edits_by_id["clip-a"].transition_duration_seconds, 0.75);
  assert.equal(restored.state.audio.voiceover.file_name, "narration.wav");
  assert.equal(restored.state.audio.voiceover.gain, 1.25);
  assert.equal(restored.state.audio.sfx[0].file_name, "impact.wav");
  assert.equal(restored.state.subtitles.cues[0].source_label, "SCENE 01 · VOICE-OVER");
  assert.equal(restored.state.subtitles.enabled, true);
});

test("never serializes token, API key, secret or credential properties", () => {
  const project = api.createProject(sampleProject());
  const serialized = api.serializeProject(project);
  assert.equal(serialized.includes("must-not-export"), false);
  assert.equal(serialized.toLowerCase().includes("api_key"), false);
  assert.equal(serialized.toLowerCase().includes("owner_token"), false);
  assert.equal(serialized.toLowerCase().includes("video_generation_access_token"), false);
});

test("saves, lists, loads and deletes projects in local storage", () => {
  const storage = memoryStorage();
  const project = api.saveProject(storage, api.createProject(sampleProject()));
  assert.equal(api.listProjects(storage).length, 1);
  assert.equal(api.loadProject(storage, project.project_id).name, "Ice Age documentary");
  assert.equal(api.deleteProject(storage, project.project_id), 0);
  assert.equal(api.listProjects(storage).length, 0);
  assert.throws(() => api.loadProject(storage, project.project_id), /no longer available/);
});

test("portable imports receive a fresh ID and retain only media references, not bytes", () => {
  const original = api.createProject(sampleProject());
  const imported = api.parseProjectFile(api.serializeProject(original), { newId: true });
  assert.notEqual(imported.project_id, original.project_id);
  assert.equal(imported.state.reference_file_name, "reference.mp4");
  assert.equal(imported.state.audio.voiceover.file_name, "narration.wav");
  assert.equal(JSON.stringify(imported).includes("base64"), false);
});

test("rejects unsupported schema, malformed queue IDs and invalid subtitle timing", () => {
  assert.throws(() => api.createProject({ schema_version: 99, state: {} }), /Unsupported project schema/);
  const invalidQueue = sampleProject();
  invalidQueue.state.assembly.queue = ["../private"];
  assert.throws(() => api.createProject(invalidQueue), /invalid job ID/);
  const invalidCaption = sampleProject();
  invalidCaption.state.subtitles.cues[0].end = 0.2;
  invalidCaption.state.subtitles.cues[0].start = 0.5;
  assert.throws(() => api.createProject(invalidCaption), /must end after it starts/);
});

test("deduplicates clip references and ignores edit metadata for clips outside the queue", () => {
  const input = sampleProject();
  input.state.assembly.queue = ["clip-a", "clip-a", "clip-b"];
  const project = api.createProject(input);
  assert.deepEqual(project.state.assembly.queue, ["clip-a", "clip-b"]);
  assert.equal(project.state.assembly.edits_by_id["not-queued"], undefined);
  assert.equal(Object.keys(project.state.assembly.edits_by_id).length, 2);
});

test("enforces project size, subtitle count, SFX count and project count limits", () => {
  assert.throws(() => api.parseProjectFile("x".repeat(api.MAX_PROJECT_BYTES + 1)), /2 MB/);
  const tooManyCaptions = sampleProject();
  tooManyCaptions.state.subtitles.cues = Array.from({ length: 201 }, (_, index) => ({
    id: "c" + index, start: index, end: index + 0.5, text: "Caption"
  }));
  assert.throws(() => api.createProject(tooManyCaptions), /200 subtitle cues/);
  const tooManySfx = sampleProject();
  tooManySfx.state.audio.sfx = Array.from({ length: 7 }, (_, index) => ({ id: index, start_seconds: 0 }));
  assert.throws(() => api.createProject(tooManySfx), /six SFX references/);
  const storage = memoryStorage();
  for (let index = 0; index < api.MAX_PROJECTS + 2; index += 1) {
    api.saveProject(storage, api.createProject({
      schema_version: 1, project_id: "project-" + index, name: "Project " + index,
      state: { storyboard: { ideas: [] } }
    }));
  }
  assert.equal(api.listProjects(storage).length, api.MAX_PROJECTS);
});

test("rejects invalid trim ranges and audio gains", () => {
  const invalidTrim = sampleProject();
  invalidTrim.state.assembly.edits_by_id["clip-a"].trim_start_seconds = 5;
  invalidTrim.state.assembly.edits_by_id["clip-a"].trim_end_seconds = 4;
  assert.throws(() => api.createProject(invalidTrim), /trim-out must be greater/);
  const invalidGain = sampleProject();
  invalidGain.state.audio.music.gain = 2.5;
  assert.throws(() => api.createProject(invalidGain), /Audio gain must be between/);
});
