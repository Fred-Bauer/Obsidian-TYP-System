const { colorForFile, setInlineColor } = require("./typ-colors");
const { coalesceFrame } = require("./typ-utils");

const BOOKMARKS_VIEW_TYPE = "bookmarks";
const BOOKMARKS_PLUGIN_ID = "bookmarks";

// Bookmark rows have no data-path. The view keeps a WeakMap (view.itemDoms:
// item -> tree item with .titleEl), which can't be iterated, so we walk the
// plugin's own item tree (always complete, whatever is collapsed) and look up
// each item's row with .get().
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
      const color = plugin.settings.colorViews.bookmarks ? colorForFile(plugin, file, "bookmarks") : null;
      setInlineColor(titleEl, color);
    });
  }
}

function registerBookmarksColors(plugin) {
  // One full round per frame at most, however many DOM changes and events come
  // in between. Rows are looked up per bookmark, so the whole list is redone.
  const refresh = coalesceFrame(() => applyBookmarksColors(plugin));
  plugin.register(refresh.cancel);

  // Rows are re-rendered when groups expand/collapse or bookmarks change.
  const observer = new MutationObserver(refresh);
  const observeLeaves = () => {
    for (const leaf of plugin.app.workspace.getLeavesOfType(BOOKMARKS_VIEW_TYPE)) {
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

module.exports = { registerBookmarksColors };
