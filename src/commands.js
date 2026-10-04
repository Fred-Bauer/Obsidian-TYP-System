const { Notice } = require("obsidian");
const { sortAllFrontmatter, sortSingleFileFrontmatter, sortSummary } = require("./frontmatter-sort");
const { isBasesEnabled, createBaseCommand, activeBaseView, updateActiveView } = require("./bases");

function registerCommands(plugin) {

  // Obsidian neither awaits a command callback nor catches its errors, so an
  // exception would vanish into the console. These commands always end in a
  // notice instead.
  const runOrReportError = (label, fn) => async () => {
    try {
      await fn();
    } catch (error) {
      console.error(`[${label}]`, error);
      new Notice(`${label} failed: ${error.message}`);
    }
  };

  plugin.addCommand({
    id: "sort-frontmatter-all",
    name: "Sort frontmatter in all notes",
    callback: runOrReportError("Frontmatter sorting", async () => {
      const { checked, changed } = await sortAllFrontmatter(plugin.app, plugin, null);
      new Notice(sortSummary("Frontmatter sorting", checked, changed));
    }),
  });

  plugin.addCommand({
    id: "sort-frontmatter-typ",
    name: "Sort frontmatter for one TYP",
    callback: runOrReportError("Frontmatter sorting", async () => {
      // Sorting makes sense for any TYP, manually creatable or not, registered
      // or not.
      const typ = await plugin.pickTyp({ includeManualOff: true, includeUnregistered: true });
      if (!typ) return;
      const { checked, changed, hasTypDefaults } = await sortAllFrontmatter(plugin.app, plugin, typ);
      let message = sortSummary(`Frontmatter sorting ${typ}`, checked, changed);
      // Not an error, but explains why nothing may have changed.
      if (hasTypDefaults === false) {
        message += ` Note: ${typ} has no TYP-Frontmatter, so only the global order was applied.`;
      }
      new Notice(message);
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
        const changed = await sortSingleFileFrontmatter(plugin.app, plugin, file);
        new Notice(changed ? `Sorted frontmatter of "${file.basename}".` : `Frontmatter of "${file.basename}" was already sorted.`);
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

module.exports = { registerCommands };
