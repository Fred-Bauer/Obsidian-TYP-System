const { colorForFile } = require("./typ-colors");

const SEARCH_VIEW_TYPE = "search";

// Search result rows have no data-path, but the view keeps a TFile -> result
// DOM map (dom.resultDomLookup) that links file and row directly.
function applySearchColors(plugin) {
  for (const leaf of plugin.app.workspace.getLeavesOfType(SEARCH_VIEW_TYPE)) {
    const resultDomLookup = leaf.view?.dom?.resultDomLookup;
    if (!resultDomLookup) continue;

    for (const [file, resultDom] of resultDomLookup) {
      const titleEl = resultDom.el?.querySelector(".search-result-file-title .tree-item-inner");
      if (!titleEl) continue;

      const color = plugin.settings.colorViews.search ? colorForFile(plugin, file, "search") : null;
      if (color) titleEl.style.color = color;
      else titleEl.style.removeProperty("color");
    }
  }
}

function registerSearchColors(plugin) {
  const refresh = () => applySearchColors(plugin);

  // Results are rebuilt on every keystroke.
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
