const { Component } = require("obsidian");
const { colorForFile, setInlineColor, clearInlineColors, allDocuments } = require("./typ-colors");
const { coalesceFrame } = require("./typ-utils");
const { registerColorView, registerLeafColors } = require("./view-colors");
const { watchEmbeds, findRenderChild } = require("./note-embeds");

const SEARCH_VIEW_TYPE = "search";
const TITLE_SELECTOR = ".search-result-file-title .tree-item-inner";
const QUERY_BLOCK_SELECTOR = ".internal-query";
const QUERY_BLOCK_WATCH_CLASS = "typ-watch-query-blocks";

// Search result rows have no data-path, but the results keep a TFile -> result
// DOM map (resultDomLookup) that links file and row directly. The list is
// virtualized: only rows in the DOM are colored, a row scrolled back into view
// is colored when the observer sees it inserted.
function colorResultRows(plugin, resultDomLookup) {
  for (const [file, resultDom] of resultDomLookup) {
    if (!resultDom.el?.isConnected) continue;
    const titleEl = resultDom.el.querySelector(TITLE_SELECTOR);
    if (titleEl) setInlineColor(titleEl, colorForFile(plugin, file, "search"));
  }
}

// Rows scrolled out of view stay in resultDomLookup, detached from the DOM.
function clearResultRows(resultDomLookup) {
  for (const resultDom of resultDomLookup.values()) {
    const titleEl = resultDom.el?.querySelector(TITLE_SELECTOR);
    if (titleEl) setInlineColor(titleEl, null);
  }
}

function searchResultDomLookups(plugin) {
  return plugin.app.workspace
    .getLeavesOfType(SEARCH_VIEW_TYPE)
    .map((leaf) => leaf.view?.dom?.resultDomLookup)
    .filter(Boolean);
}

// Observer and events share one full round per frame: results are rebuilt on
// every keystroke. A round only touches the rows in the DOM (see above), so
// tracking inserted rows as in the file explorer wouldn't save much more.
function registerSearchColors(plugin) {
  return registerLeafColors(plugin, {
    key: "search",
    viewTypes: [SEARCH_VIEW_TYPE],
    apply: () => searchResultDomLookups(plugin).forEach((lookup) => colorResultRows(plugin, lookup)),
    clearKept: () => searchResultDomLookups(plugin).forEach(clearResultRows),
  });
}

// --- Query blocks in notes ---------------------------------------------------
// A ```query block shows its results like the search pane and follows the same
// toggle. Obsidian renders it with a query component (a MarkdownRenderChild on
// the block's .search-result-container) whose dom holds the same
// resultDomLookup. Its results come in asynchronously, are rebuilt whenever a
// file changes and are virtualized too (max. 800 px, scrolling on their own).
//
// Blocks are found as they are inserted (see watchEmbeds in note-embeds.js).
// Each found block gets a child component on Obsidian's query component, so it
// goes with the block (re-rendered, scrolled out of Live Preview's viewport,
// note closed). It observes only the block's own result container, never the
// note around it.
function isQueryComponent(component, blockEl) {
  return component.containerEl?.parentElement === blockEl && component.dom?.resultDomLookup instanceof Map;
}

function registerQueryBlockColors(plugin) {
  return registerColorView(plugin, {
    key: "search",
    start: (component) => {
      const blocks = new Map(); // query component -> our child component
      const refresh = coalesceFrame(() => {
        for (const query of blocks.keys()) colorResultRows(plugin, query.dom.resultDomLookup);
      });
      component.register(refresh.cancel);

      const track = (query) => {
        const child = new Component();
        const observer = new MutationObserver(refresh);
        observer.observe(query.containerEl, { childList: true, subtree: true });
        child.register(() => {
          observer.disconnect();
          blocks.delete(query);
        });
        blocks.set(query, child);
        query.addChild(child);
      };

      // Colors right away, not in the next frame: results may already be shown
      // (a block shown again, or all blocks on screen when switching on), and
      // this frame is painted next.
      const onInserted = (blockEl) => {
        const query = findRenderChild(plugin.app, (candidate) => isQueryComponent(candidate, blockEl));
        if (!query) return;
        if (!blocks.has(query)) track(query);
        colorResultRows(plugin, query.dom.resultDomLookup);
      };
      watchEmbeds(plugin, component, { bodyClass: QUERY_BLOCK_WATCH_CLASS, selector: QUERY_BLOCK_SELECTOR, onInserted });

      component.registerEvent(plugin.typIndex.on("change", refresh));
      // Stops observing; the rows kept out of the DOM are cleared here, while
      // the blocks are still known.
      component.register(() => {
        for (const [query, child] of blocks) {
          query.removeChild(child);
          clearResultRows(query.dom.resultDomLookup);
        }
      });
      return refresh;
    },
    // The rows in the DOM, swept per block rather than through resultDomLookup:
    // a block in a hidden tab can't lay out its list, so a replaced row stays
    // in its DOM after it has left resultDomLookup.
    clear: () => {
      for (const doc of allDocuments(plugin.app)) {
        for (const blockEl of doc.querySelectorAll(QUERY_BLOCK_SELECTOR)) clearInlineColors(blockEl);
      }
    },
  });
}

module.exports = { registerSearchColors, registerQueryBlockColors };
