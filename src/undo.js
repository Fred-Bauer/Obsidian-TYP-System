const { Notice } = require("obsidian");

// Undo for the actions that only change settings (delete a Subtyp, remove a
// shortcut, merge by renaming, reset a color ...): a notice with an "Undo"
// button right after the action, and the command "Undo last TYP-Pane action"
// for when the notice is gone. Only plugin settings, never notes, and only
// the LAST action - a new offer replaces the previous one, so there is no
// history.
//
// Pattern at the call site: snapshot = snapshotSettings(plugin) before the
// change, then the action as usual (including saveSettings()), then
// offerUndo(). offerUndo() must come after saveSettings() has been CALLED (not
// necessarily awaited), since that is what bumps settingsRevision.

const UNDO_NOTICE_DURATION = 8000;

// { token, revision, snapshot, message } of the last action, or null.
let current = null;

// The settings are plain JSON, so structuredClone is a complete copy.
function snapshotSettings(plugin) {
  return structuredClone(plugin.settings);
}

function offerUndo(plugin, message, snapshot) {
  const token = {};
  // settingsRevision counts every save and every external reload (see
  // saveSettings in main.js). If it moved on by the time Undo is clicked,
  // something else changed the settings in between - restoring the snapshot
  // would silently revert that too.
  current = { token, revision: plugin.settingsRevision ?? 0, snapshot, message };
  const fragment = createFragment((f) => {
    f.appendText(message);
    // Obsidian hides the notice on any click inside it, the button included.
    const button = f.createEl("button", { cls: "typ-undo-button", text: "Undo" });
    button.addEventListener("click", () => undo(plugin, token));
  });
  new Notice(fragment, UNDO_NOTICE_DURATION);
}

async function undo(plugin, token) {
  if (current?.token !== token || (plugin.settingsRevision ?? 0) !== current.revision) {
    new Notice("Can't undo – the settings have changed since.");
    return false;
  }
  const { snapshot } = current;
  current = null;
  // In place, so every reference to plugin.settings stays valid. The snapshot
  // is used only once, no second copy needed.
  for (const key of Object.keys(plugin.settings)) delete plugin.settings[key];
  Object.assign(plugin.settings, snapshot);
  await plugin.saveSettings();
  // The full refresh on purpose: it re-renders the TYP-Pane, whose frontmatter
  // editors only read the settings when mounted.
  plugin.refreshTypColors?.();
  return true;
}

// The command: undoes the last offer even after its notice is gone, with the
// same check as the button. Unlike the button it says what it undid - the
// notice that named the action may be long gone.
async function undoLast(plugin) {
  if (!current) {
    new Notice("Nothing to undo.");
    return;
  }
  const { token, message } = current;
  if (await undo(plugin, token)) new Notice(`Undone: ${message}`);
}

function registerUndoCommand(plugin) {
  plugin.addCommand({
    id: "undo-last-action",
    name: "Undo last TYP-Pane action",
    callback: () => undoLast(plugin),
  });
}

module.exports = { snapshotSettings, offerUndo, registerUndoCommand };
