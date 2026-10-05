const { colorForFile, setInlineColor } = require("./typ-colors");
const { registerLeafColors } = require("./view-colors");

const BACKLINK_VIEW_TYPE = "backlink";
const TITLE_SELECTOR = ".search-result-file-title .tree-item-inner";
const EMBEDDED_SELECTOR = ".embedded-backlinks";

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
  setInlineColor(el, colorForFile(plugin, file, "backlinks"));
}

function applyBacklinkPaneColors(plugin) {
  for (const leaf of plugin.app.workspace.getLeavesOfType(BACKLINK_VIEW_TYPE)) {
    for (const lookup of getResultDomLookups(leaf.view)) {
      for (const [file, resultDom] of lookup) {
        // Rows out of view (virtualized list) are colored once inserted.
        if (!resultDom.el?.isConnected) continue;
        const titleEl = resultDom.el.querySelector(TITLE_SELECTOR);
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
    const paneEl = leaf.view.containerEl.querySelector(`${EMBEDDED_SELECTOR} .backlink-pane`);
    if (!paneEl) continue;

    const sourcePath = leaf.view.file?.path ?? "";
    const titleEls = paneEl.querySelectorAll(TITLE_SELECTOR);
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

// Embedded backlinks only, never the whole markdown view: its title and
// property names are colored by other modules.
function embeddedBacklinkEls(plugin) {
  return plugin.app.workspace
    .getLeavesOfType("markdown")
    .flatMap((leaf) => [...leaf.view.containerEl.querySelectorAll(EMBEDDED_SELECTOR)]);
}

// Rows scrolled out of view stay in the resultDomLookup maps, detached from the
// DOM.
function clearKeptRows(plugin) {
  for (const leaf of plugin.app.workspace.getLeavesOfType(BACKLINK_VIEW_TYPE)) {
    for (const lookup of getResultDomLookups(leaf.view)) {
      for (const resultDom of lookup.values()) {
        const titleEl = resultDom.el?.querySelector(TITLE_SELECTOR);
        if (titleEl) setInlineColor(titleEl, null);
      }
    }
  }
}

// One full round per frame at most, however many DOM changes and events come
// in between: one update of the pane brings a burst of DOM changes.
//
// Only the small sidebar pane is observed, never a markdown view: a subtree
// observer near the editor fires on every keystroke and once froze this vault.
// The embedded backlinks only change when links change ("resolved") or the
// note changes (layout-change/active-leaf-change), both covered here.
function registerBacklinkColors(plugin) {
  return registerLeafColors(plugin, {
    key: "backlinks",
    viewTypes: [BACKLINK_VIEW_TYPE],
    apply: applyBacklinkColors,
    events: (component, refresh) => {
      component.registerEvent(plugin.app.metadataCache.on("resolved", () => applyEmbeddedBacklinkColors(plugin)));
      component.registerEvent(plugin.app.workspace.on("active-leaf-change", refresh));
    },
    clearKept: clearKeptRows,
    clearRoots: embeddedBacklinkEls,
  });
}

module.exports = { registerBacklinkColors };
