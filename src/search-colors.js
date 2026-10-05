const { colorForFile, setInlineColor } = require("./typ-colors");
const { registerLeafColors } = require("./view-colors");

const SEARCH_VIEW_TYPE = "search";
const TITLE_SELECTOR = ".search-result-file-title .tree-item-inner";

// Search result rows have no data-path, but the view keeps a TFile -> result
// DOM map (dom.resultDomLookup) that links file and row directly. The list is
// virtualized: only rows in the DOM are colored, a row scrolled back into view
// is colored when the observer sees it inserted.
function applySearchColors(plugin) {
  for (const leaf of plugin.app.workspace.getLeavesOfType(SEARCH_VIEW_TYPE)) {
    const resultDomLookup = leaf.view?.dom?.resultDomLookup;
    if (!resultDomLookup) continue;

    for (const [file, resultDom] of resultDomLookup) {
      if (!resultDom.el?.isConnected) continue;
      const titleEl = resultDom.el.querySelector(TITLE_SELECTOR);
      if (titleEl) setInlineColor(titleEl, colorForFile(plugin, file, "search"));
    }
  }
}

// Rows scrolled out of view stay in resultDomLookup, detached from the DOM.
function clearKeptRows(plugin) {
  for (const leaf of plugin.app.workspace.getLeavesOfType(SEARCH_VIEW_TYPE)) {
    for (const resultDom of leaf.view?.dom?.resultDomLookup?.values() ?? []) {
      const titleEl = resultDom.el?.querySelector(TITLE_SELECTOR);
      if (titleEl) setInlineColor(titleEl, null);
    }
  }
}

// Observer and events share one full round per frame: results are rebuilt on
// every keystroke. A round only touches the rows in the DOM (see above), so
// tracking inserted rows as in the file explorer wouldn't save much more.
function registerSearchColors(plugin) {
  return registerLeafColors(plugin, {
    key: "search",
    viewTypes: [SEARCH_VIEW_TYPE],
    apply: applySearchColors,
    clearKept: clearKeptRows,
  });
}

module.exports = { registerSearchColors };
