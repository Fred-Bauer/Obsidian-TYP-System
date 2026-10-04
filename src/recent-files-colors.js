const { colorForFile, setInlineColor } = require("./typ-colors");
const { coalesceFrame } = require("./typ-utils");

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
      const color = plugin.settings.colorViews.recentFiles ? colorForFile(plugin, file, "recentFiles") : null;
      setInlineColor(titleEl, color);
    });
  }
}

function registerRecentFilesColors(plugin) {
  // One full round per frame at most, however many DOM changes and events come
  // in between. Rows are matched by index, so the whole (short) list is redone.
  const refresh = coalesceFrame(() => applyRecentFilesColors(plugin));
  plugin.register(refresh.cancel);

  const observer = new MutationObserver(refresh);
  const observeLeaves = () => {
    for (const leaf of plugin.app.workspace.getLeavesOfType(RECENT_FILES_VIEW_TYPE)) {
      observer.observe(leaf.view.containerEl, { childList: true, subtree: true });
    }
  };
  plugin.register(() => observer.disconnect());

  plugin.registerEvent(plugin.typIndex.on("change", refresh));
  plugin.registerEvent(
    plugin.app.workspace.on("layout-change", () => {
      observeLeaves();
      refresh();
    })
  );

  plugin.app.workspace.onLayoutReady(() => {
    observeLeaves();
    refresh();
  });

  return refresh;
}

module.exports = { registerRecentFilesColors };
