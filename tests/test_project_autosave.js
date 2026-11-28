import test from "node:test";
import assert from "node:assert/strict";
import "../static/project_autosave.js";

const api = globalThis.Reference2VideoProjectAutosave;

function fakeClock() {
  let nextId = 1;
  let now = 0;
  const tasks = new Map();
  return {
    setTimeout(callback, delay) {
      const id = nextId++;
      tasks.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) { tasks.delete(id); },
    advance(ms) {
      const target = now + ms;
      while (true) {
        const due = Array.from(tasks.entries())
          .filter(([, task]) => task.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        tasks.delete(due[0]);
        now = due[1].at;
        due[1].callback();
      }
      now = target;
    },
    pending() { return tasks.size; }
  };
}

test("debounces repeated edits and saves only the latest state", () => {
  const clock = fakeClock();
  const states = [];
  let saves = 0;
  const autosave = api.createProjectAutosave({
    delayMs: 500,
    isEnabled: () => true,
    save: () => { saves += 1; },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onState: state => states.push(state.status)
  });

  assert.equal(autosave.schedule("prompt edit"), true);
  clock.advance(300);
  autosave.schedule("subtitle edit");
  clock.advance(499);
  assert.equal(saves, 0);
  clock.advance(1);
  assert.equal(saves, 1);
  assert.equal(autosave.isDirty(), false);
  assert.equal(states.at(-1), "saved");
});

test("does not schedule before a project has been saved or imported", () => {
  const clock = fakeClock();
  let enabled = false;
  let saves = 0;
  const autosave = api.createProjectAutosave({
    isEnabled: () => enabled,
    save: () => { saves += 1; },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  });

  assert.equal(autosave.schedule("new storyboard"), false);
  clock.advance(5000);
  assert.equal(saves, 0);
  assert.equal(autosave.isDirty(), false);

  enabled = true;
  assert.equal(autosave.schedule("saved project edit"), true);
  clock.advance(900);
  assert.equal(saves, 1);
});

test("flushes immediately and markClean cancels a pending save", () => {
  const clock = fakeClock();
  let saves = 0;
  const autosave = api.createProjectAutosave({
    isEnabled: () => true,
    save: () => { saves += 1; },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  });

  autosave.schedule("first edit");
  assert.equal(autosave.flush(), true);
  assert.equal(saves, 1);
  autosave.schedule("second edit");
  autosave.markClean();
  clock.advance(5000);
  assert.equal(saves, 1);
  assert.equal(autosave.isDirty(), false);
});

test("keeps failed changes dirty and retries on the next flush", () => {
  const clock = fakeClock();
  let attempts = 0;
  const states = [];
  const autosave = api.createProjectAutosave({
    isEnabled: () => true,
    save: () => {
      attempts += 1;
      if (attempts === 1) throw new Error("local storage quota exceeded");
    },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onState: state => states.push(state)
  });

  autosave.schedule("caption edit");
  clock.advance(900);
  assert.equal(autosave.isDirty(), true);
  assert.equal(states.at(-1).status, "error");
  assert.match(states.at(-1).error.message, /quota exceeded/);
  assert.equal(autosave.flush(), true);
  assert.equal(attempts, 2);
  assert.equal(autosave.isDirty(), false);
});

test("suspension blocks programmatic restore changes from scheduling saves", () => {
  const clock = fakeClock();
  let saves = 0;
  const autosave = api.createProjectAutosave({
    isEnabled: () => true,
    save: () => { saves += 1; },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  });

  autosave.withSuspended(() => {
    assert.equal(autosave.schedule("restore form controls"), false);
  });
  clock.advance(5000);
  assert.equal(saves, 0);
  autosave.schedule("user edit");
  clock.advance(900);
  assert.equal(saves, 1);
});

test("cancel and dispose prevent queued writes", () => {
  const clock = fakeClock();
  let saves = 0;
  const autosave = api.createProjectAutosave({
    isEnabled: () => true,
    save: () => { saves += 1; },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout
  });

  autosave.schedule("edit before delete");
  autosave.cancel();
  clock.advance(5000);
  assert.equal(saves, 0);
  autosave.schedule("edit before close");
  autosave.dispose();
  clock.advance(5000);
  assert.equal(saves, 0);
  assert.equal(autosave.getState().status, "disposed");
});
