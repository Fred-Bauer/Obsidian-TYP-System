const { colorForFile, setInlineColor } = require("./typ-colors");
const { registerLeafColors } = require("./view-colors");

const RECENT_FILES_VIEW_TYPE = "recent-files";

// Recent Files rows have no data-path, but the list is rendered straight from
// data.recentFiles without skipping entries, so the index maps row to path.
function applyRecentFilesColors(plugin) {
  for (const leaf of plugin.app.workspace.getLeavesOfType(RECENT_FILES_VIEW_TYPE)) {
    const recentFiles = leaf.view?.data?.recentFiles;
    if (!Array.isArray(recentFiles)) continue;

    const titleEls = leaf.view.containerEl.querySelectorAll(".recent-files-title .nav-file-title-content");
    titleEls.forEach((titleEl, index) => {
      const entry = recentFiles[index];
      const file = entry ? plugin.app.vault.getAbstractFileByPath(entry.path) : null;
      setInlineColor(titleEl, colorForFile(plugin, file, "recentFiles"));
    });
  }
}

// One full round per frame at most, however many DOM changes and events come
// in between. Rows are matched by index, so the whole (short) list is redone.
function registerRecentFilesColors(plugin) {
  return registerLeafColors(plugin, {
    key: "recentFiles",
    viewTypes: [RECENT_FILES_VIEW_TYPE],
    apply: applyRecentFilesColors,
  });
}

module.exports = { registerRecentFilesColors };
