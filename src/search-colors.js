const { colorForFile } = require("./type-colors");

const SEARCH_VIEW_TYPE = "search";

// Ergebniszeilen im Search View tragen kein data-path-Attribut, aber die
// SearchView pflegt intern eine Map von TFile -> Ergebnis-DOM-Objekt
// (dom.resultDomLookup) - darüber lässt sich Datei und Zeile direkt verbinden.
function applySearchColors(plugin) {
  for (const leaf of plugin.app.workspace.getLeavesOfType(SEARCH_VIEW_TYPE)) {
    const resultDomLookup = leaf.view?.dom?.resultDomLookup;
    if (!resultDomLookup) continue;

    for (const [file, resultDom] of resultDomLookup) {
      const titleEl = resultDom.el?.querySelector(".search-result-file-title .tree-item-inner");
      if (!titleEl) continue;

      const color = plugin.settings.colorViews.search ? colorForFile(plugin, file) : null;
      if (color) titleEl.style.color = color;
      else titleEl.style.removeProperty("color");
    }
  }
}

function registerSearchColors(plugin) {
  const refresh = () => applySearchColors(plugin);

  // Ergebnisse werden bei jeder Sucheingabe komplett neu aufgebaut.
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
