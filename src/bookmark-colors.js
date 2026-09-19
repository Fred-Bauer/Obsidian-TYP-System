const { colorForFile } = require("./type-colors");

const BOOKMARKS_VIEW_TYPE = "bookmarks";
const BOOKMARKS_PLUGIN_ID = "bookmarks";

// Bookmark-Zeilen tragen kein data-path-Attribut. Der View hält aber intern
// eine WeakMap (view.itemDoms: Bookmark-Item -> Tree-Item-Dom mit .titleEl) -
// darüber lässt sich jedes Item gezielt seiner Zeile zuordnen, ohne die (nicht
// iterierbare) WeakMap selbst durchlaufen zu müssen: stattdessen rekursiv über
// den Item-Baum des Bookmarks-Plugins selbst laufen (liegt unabhängig vom
// Render-/Collapse-Zustand immer vollständig vor) und je Item per .get()
// nachschlagen, ob (und wo) es aktuell gerendert ist.
function forEachFileBookmark(items, callback) {
  for (const item of items ?? []) {
    if (item.type === "file") callback(item);
    else if (item.type === "group") forEachFileBookmark(item.items, callback);
  }
}

function applyBookmarksColors(plugin) {
  const bookmarksPlugin = plugin.app.internalPlugins.getEnabledPluginById(BOOKMARKS_PLUGIN_ID);
  if (!bookmarksPlugin) return;

  for (const leaf of plugin.app.workspace.getLeavesOfType(BOOKMARKS_VIEW_TYPE)) {
    const itemDoms = leaf.view?.itemDoms;
    if (!itemDoms) continue;

    forEachFileBookmark(bookmarksPlugin.items, (item) => {
      const titleEl = itemDoms.get(item)?.titleEl;
      if (!titleEl) return;

      const file = plugin.app.vault.getAbstractFileByPath(item.path);
      const color = plugin.settings.colorViews.bookmarks ? colorForFile(plugin, file) : null;
      if (color) titleEl.style.color = color;
      else titleEl.style.removeProperty("color");
    });
  }
}

function registerBookmarksColors(plugin) {
  const refresh = () => applyBookmarksColors(plugin);

  // Analog zu file-explorer-colors.js: Bookmarks rendert Zeilen beim
  // Auf-/Zuklappen von Gruppen sowie beim Hinzufügen/Entfernen/Umsortieren
  // dynamisch neu.
  const observer = new MutationObserver(refresh);
  const observeLeaves = () => {
    for (const leaf of plugin.app.workspace.getLeavesOfType(BOOKMARKS_VIEW_TYPE)) {
      observer.observe(leaf.view.containerEl, { childList: true, subtree: true });
    }
  };
  plugin.register(() => observer.disconnect());

  plugin.registerEvent(plugin.app.metadataCache.on("changed", refresh));
  plugin.registerEvent(plugin.app.metadataCache.on("resolved", refresh));
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

module.exports = { registerBookmarksColors };
