const { Notice } = require("obsidian");
const { runFrontmatterSort, sortSingleFileFrontmatter } = require("./frontmatter-sort");
const { isBasesEnabled, createBaseCommand, activeBaseView, updateActiveView } = require("./bases");
const { setTypOfActiveNote, createNoteWithTyp } = require("./set-typ");

// Obsidian neither awaits a command callback (or a menu item's onClick) nor
// catches its errors, so an exception would vanish into the console. These
// actions always end in a notice instead. Also used by the TYP-Pane's context
// menu.
const runOrReportError = (label, fn) => async () => {
  try {
    await fn();
  } catch (error) {
    console.error(`[${label}]`, error);
    new Notice(`${label} failed: ${error.message}`);
  }
};

function registerCommands(plugin) {

  // TYP of a note without a Templater script of one's own, see set-typ.js.
  plugin.addCommand({
    id: "set-typ-of-active-note",
    name: "Set TYP of active note",
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (!file || file.extension !== "md") return false;
      if (checking) return true;

      runOrReportError("Set TYP", () => setTypOfActiveNote(plugin, file))();
      return true;
    },
  });

  plugin.addCommand({
    id: "new-note-with-typ",
    name: "New note with TYP",
    callback: runOrReportError("New note with TYP", () => createNoteWithTyp(plugin)),
  });

  plugin.addCommand({
    id: "sort-frontmatter-all",
    name: "Sort frontmatter in all notes",
    // Asks first when the run is large, see runFrontmatterSort.
    callback: runOrReportError("Frontmatter sorting", () => runFrontmatterSort(plugin, null)),
  });

  plugin.addCommand({
    id: "sort-frontmatter-typ",
    name: "Sort frontmatter for one TYP or Subtyp",
    // The id stays from the time it only took a TYP, so hotkeys keep working.
    callback: runOrReportError("Frontmatter sorting", async () => {
      // Sorting makes sense for any TYP, manually creatable or not, registered
      // or not. The TYP itself means all of its notes (allNotes, see
      // pickSubtyp), not only those without a Subtyp.
      const choice = await plugin.pickTypAndSubtyp({ includeManualOff: true, includeUnregistered: true, allNotes: true });
      if (!choice) return;
      await runFrontmatterSort(plugin, choice.typ, choice.subtyp);
    }),
  });

  plugin.addCommand({
    id: "sort-frontmatter-active-note",
    name: "Sort frontmatter of active note",
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (!file || file.extension !== "md") return false;
      if (checking) return true;

      runOrReportError("Frontmatter sorting", async () => {
        const status = await sortSingleFileFrontmatter(plugin.app, plugin, file);
        const messages = {
          changed: `Sorted frontmatter of "${file.basename}".`,
          unchanged: `Frontmatter of "${file.basename}" was already sorted.`,
          skipped: `Frontmatter of "${file.basename}" couldn't be sorted without losing comments.`,
        };
        new Notice(messages[status]);
      })();
      return true;
    },
  });

  // Creates a .base for the chosen TYP or Subtyp in the vault root, see bases.js.
  // Hidden while the Bases core plugin is off: the file couldn't be opened.
  plugin.addCommand({
    id: "create-base-for-typ",
    name: "Create Base for TYP",
    checkCallback: (checking) => {
      if (!isBasesEnabled(plugin.app)) return false;
      if (checking) return true;

      runOrReportError("Create Base", () => createBaseCommand(plugin))();
      return true;
    },
  });

  // Brings the columns of the visible Base view in line with its TYP. Without
  // an open Base the command has no target and is hidden.
  plugin.addCommand({
    id: "update-base-view-columns",
    name: "Update columns of Base view",
    checkCallback: (checking) => {
      const view = activeBaseView(plugin);
      if (!view) return false;
      if (checking) return true;

      runOrReportError("Update Base", () => updateActiveView(plugin, view))();
      return true;
    },
  });

}

module.exports = { registerCommands, runOrReportError };
