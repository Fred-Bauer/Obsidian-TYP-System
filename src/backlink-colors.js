const { colorForFile } = require("./typ-colors");

const BACKLINK_VIEW_TYPE = "backlink";

// The backlinks pane renders results with the same SearchResultDom class as
// search. Linked and unlinked mentions are two resultDomLookup maps on the
// renderer (view.backlink). The field names are undocumented, so several
// known paths are tried.
function getResultDomLookups(view) {
  const renderer = view?.backlink;
  const candidates = [renderer?.backlinkDom, renderer?.unlinkedDom, view?.backlinkDom, view?.unlinkedDom, view?.dom];

  const lookups = [];
  for (const dom of candidates) {
    if (dom?.resultDomLookup instanceof Map) lookups.push(dom.resultDomLookup);
  }
  return lookups;
}

function colorTitleEl(plugin, el, file) {
  const color = plugin.settings.colorViews.backlinks ? colorForFile(plugin, file, "backlinks") : null;
  if (color) el.style.color = color;
  else el.style.removeProperty("color");
}

function applyBacklinkPaneColors(plugin) {
  for (const leaf of plugin.app.workspace.getLeavesOfType(BACKLINK_VIEW_TYPE)) {
    for (const lookup of getResultDomLookups(leaf.view)) {
      for (const [file, resultDom] of lookup) {
        const titleEl = resultDom.el?.querySelector(".search-result-file-title .tree-item-inner");
        if (titleEl) colorTitleEl(plugin, titleEl, file);
      }
    }
  }
}

// Backlinks in the document are not a leaf of their own but embedded at the
// bottom of the markdown view (.embedded-backlinks). Rows have no data-path,
// so the file is resolved from the shown name, the way Obsidian resolves links.
function applyEmbeddedBacklinkColors(plugin) {
  for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
    const paneEl = leaf.view.containerEl.querySelector(".embedded-backlinks .backlink-pane");
    if (!paneEl) continue;

    const sourcePath = leaf.view.file?.path ?? "";
    const titleEls = paneEl.querySelectorAll(".search-result-file-title .tree-item-inner");
    for (const titleEl of titleEls) {
      const basename = titleEl.textContent;
      const file = basename ? plugin.app.metadataCache.getFirstLinkpathDest(basename, sourcePath) : null;
      colorTitleEl(plugin, titleEl, file);
    }
  }
}

function applyBacklinkColors(plugin) {
  applyBacklinkPaneColors(plugin);
  applyEmbeddedBacklinkColors(plugin);
}

function registerBacklinkColors(plugin) {
  const refresh = () => applyBacklinkColors(plugin);

  // Only the small sidebar pane is observed, never a markdown view: a subtree
  // observer near the editor fires on every keystroke and once froze this
  // vault. The embedded backlinks only change when links change ("resolved")
  // or the note changes (layout-change/active-leaf-change), both covered below.
  const observer = new MutationObserver(refresh);
  const observeLeaves = () => {
    for (const leaf of plugin.app.workspace.getLeavesOfType(BACKLINK_VIEW_TYPE)) {
      observer.observe(leaf.view.containerEl, { childList: true, subtree: true });
    }
  };
  plugin.register(() => observer.disconnect());

  plugin.registerEvent(plugin.typIndex.on("change", refresh));
  plugin.registerEvent(plugin.app.metadataCache.on("resolved", () => applyEmbeddedBacklinkColors(plugin)));
  plugin.registerEvent(
    plugin.app.workspace.on("layout-change", () => {
      observeLeaves();
      refresh();
    })
  );
  plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", refresh));

  plugin.app.workspace.onLayoutReady(() => {
    observeLeaves();
    refresh();
  });

  return refresh;
}

module.exports = { registerBacklinkColors };
