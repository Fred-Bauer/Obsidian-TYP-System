const { colorForFile, setInlineColor } = require("./typ-colors");
const { coalesceFrame } = require("./typ-utils");

const SEARCH_VIEW_TYPE = "search";

// Search result rows have no data-path, but the view keeps a TFile -> result
// DOM map (dom.resultDomLookup) that links file and row directly. The list is
// virtualized: only rows in the DOM are colored, a row scrolled back into view
// is colored when the observer below sees it inserted.
function applySearchColors(plugin) {
  for (const leaf of plugin.app.workspace.getLeavesOfType(SEARCH_VIEW_TYPE)) {
    const resultDomLookup = leaf.view?.dom?.resultDomLookup;
    if (!resultDomLookup) continue;

    for (const [file, resultDom] of resultDomLookup) {
      if (!resultDom.el?.isConnected) continue;
      const titleEl = resultDom.el.querySelector(".search-result-file-title .tree-item-inner");
      if (!titleEl) continue;

      const color = plugin.settings.colorViews.search ? colorForFile(plugin, file, "search") : null;
      setInlineColor(titleEl, color);
    }
  }
}

function registerSearchColors(plugin) {
  // One full round per frame at most, however many DOM changes and events come
  // in between: results are rebuilt on every keystroke. A round only touches
  // the rows in the DOM (see above), so tracking inserted rows as in the file
  // explorer wouldn't save much more.
  const refresh = coalesceFrame(() => applySearchColors(plugin));
  plugin.register(refresh.cancel);

  const observer = new MutationObserver(refresh);
  const observeLeaves = () => {
    for (const leaf of plugin.app.workspace.getLeavesOfType(SEARCH_VIEW_TYPE)) {
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

module.exports = { registerSearchColors };
