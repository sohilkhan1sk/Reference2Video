(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.Reference2VideoProjectAutosave = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function createProjectAutosave(options) {
    const settings = options && typeof options === "object" ? options : {};
    if (typeof settings.isEnabled !== "function" || typeof settings.save !== "function") {
      throw new Error("Project autosave requires isEnabled() and save() callbacks.");
    }
    const delayMs = Number.isFinite(Number(settings.delayMs))
      ? Math.max(100, Math.min(10000, Number(settings.delayMs))) : 900;
    const scheduleTimer = settings.setTimeout || setTimeout;
    const cancelTimer = settings.clearTimeout || clearTimeout;
    let timer = null;
    let dirty = false;
    let disposed = false;
    let suspended = 0;
    let revision = 0;
    let status = "idle";
    let lastError = null;

    function notify(nextStatus, details) {
      status = nextStatus;
      if (typeof settings.onState === "function") {
        try {
          settings.onState({
            status,
            dirty,
            revision,
            error: lastError,
            reason: details && details.reason ? details.reason : ""
          });
        } catch (_) {
          // UI status reporting must never interrupt persistence.
        }
      }
    }

    function clearScheduledSave() {
      if (timer !== null) {
        cancelTimer(timer);
        timer = null;
      }
    }

    function schedule(reason) {
      if (disposed || suspended || !settings.isEnabled()) return false;
      dirty = true;
      revision += 1;
      lastError = null;
      notify("pending", { reason: reason || "editor changed" });
      clearScheduledSave();
      timer = scheduleTimer(function () {
        timer = null;
        flush();
      }, delayMs);
      return true;
    }

    function flush() {
      clearScheduledSave();
      if (disposed || !dirty) return true;
      if (!settings.isEnabled()) {
        dirty = false;
        lastError = null;
        notify("inactive");
        return true;
      }
      const savingRevision = revision;
      notify("saving");
      try {
        const result = settings.save();
        if (result === false) throw new Error("The project save callback did not confirm success.");
        if (revision === savingRevision) {
          dirty = false;
          lastError = null;
          notify("saved");
        } else {
          schedule("editor changed during save");
        }
        return true;
      } catch (error) {
        dirty = true;
        lastError = error instanceof Error ? error : new Error(String(error));
        notify("error");
        return false;
      }
    }

    function markClean() {
      clearScheduledSave();
      dirty = false;
      revision += 1;
      lastError = null;
      notify("clean");
    }

    function cancel() {
      clearScheduledSave();
      dirty = false;
      revision += 1;
      lastError = null;
      notify("cancelled");
    }

    function withSuspended(callback) {
      if (typeof callback !== "function") throw new Error("withSuspended requires a callback.");
      suspended += 1;
      try {
        return callback();
      } finally {
        suspended -= 1;
      }
    }

    function getState() {
      return { status, dirty, revision, error: lastError };
    }

    function dispose() {
      clearScheduledSave();
      disposed = true;
      dirty = false;
      notify("disposed");
    }

    return {
      schedule,
      flush,
      markClean,
      cancel,
      withSuspended,
      getState,
      isDirty: function () { return dirty; },
      dispose
    };
  }

  return { createProjectAutosave };
});
