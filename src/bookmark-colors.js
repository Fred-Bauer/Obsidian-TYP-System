const { colorForFile, setInlineColor } = require("./typ-colors");
const { registerLeafColors } = require("./view-colors");

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

// Every row of a file bookmark, collapsed groups included (their rows stay in
// itemDoms, detached from the DOM).
function forEachBookmarkTitle(plugin, callback) {
  const bookmarksPlugin = plugin.app.internalPlugins.getEnabledPluginById(BOOKMARKS_PLUGIN_ID);
  if (!bookmarksPlugin) return;

  for (const leaf of plugin.app.workspace.getLeavesOfType(BOOKMARKS_VIEW_TYPE)) {
    const itemDoms = leaf.view?.itemDoms;
    if (!itemDoms) continue;

    forEachFileBookmark(bookmarksPlugin.items, (item) => {
      const titleEl = itemDoms.get(item)?.titleEl;
      if (titleEl) callback(titleEl, item);
    });
  }
}

function applyBookmarksColors(plugin) {
  forEachBookmarkTitle(plugin, (titleEl, item) => {
    const file = plugin.app.vault.getAbstractFileByPath(item.path);
    setInlineColor(titleEl, colorForFile(plugin, file, "bookmarks"));
  });
}

// One full round per frame at most, however many DOM changes and events come
// in between. Rows are looked up per bookmark, so the whole list is redone.
// The observer catches rows re-rendered when groups expand/collapse or
// bookmarks change.
function registerBookmarksColors(plugin) {
  return registerLeafColors(plugin, {
    key: "bookmarks",
    viewTypes: [BOOKMARKS_VIEW_TYPE],
    apply: applyBookmarksColors,
    clearKept: (plugin) => forEachBookmarkTitle(plugin, (titleEl) => setInlineColor(titleEl, null)),
  });
}

module.exports = { registerBookmarksColors };
