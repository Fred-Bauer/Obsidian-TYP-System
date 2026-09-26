const { colorForFile } = require("./type-colors");

const RECENT_FILES_VIEW_TYPE = "recent-files";

// Recent Files setzt kein data-path-Attribut auf seine Zeilen. Es rendert seine
// Liste aber ohne übersprungene Einträge direkt aus data.recentFiles, daher
// lässt sich die Zeile über den Index eindeutig dem Pfad zuordnen.
function applyRecentFilesColors(plugin) {
  for (const leaf of plugin.app.workspace.getLeavesOfType(RECENT_FILES_VIEW_TYPE)) {
    const recentFiles = leaf.view?.data?.recentFiles;
    if (!Array.isArray(recentFiles)) continue;

    const titleEls = leaf.view.containerEl.querySelectorAll(".recent-files-title .nav-file-title-content");
    titleEls.forEach((titleEl, index) => {
      const entry = recentFiles[index];
      const file = entry ? plugin.app.vault.getAbstractFileByPath(entry.path) : null;
      const color = plugin.settings.colorViews.recentFiles ? colorForFile(plugin, file) : null;
      if (color) titleEl.style.color = color;
      else titleEl.style.removeProperty("color");
    });
  }
}

function registerRecentFilesColors(plugin) {
  const refresh = () => applyRecentFilesColors(plugin);

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
