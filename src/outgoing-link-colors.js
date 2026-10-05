const { colorForFile, setInlineColor } = require("./typ-colors");
const { registerLeafColors } = require("./view-colors");

const OUTGOING_LINK_VIEW_TYPE = "outgoing-link";
const LINK_TEXT_SELECTOR = ".tree-item-inner-text";
const DESTINATION_SELECTOR = ".search-result-file-match-destination-file-name";

// The outgoing links pane (view.outgoingLink) holds two lists, both
// virtualized:
//  - links: outgoingLinkDom.vChildren.children, one item per link target. An
//    item keeps its row (el) and the note it belongs to (sourcePath), but not
//    its target (see linkTarget).
//  - unlinked mentions: one search result, the note itself, in
//    unlinkedDom.resultDomLookup. Each match lists the notes it could link to;
//    unlinkedDomInfo (match -> { text, files }) keeps them in the order of the
//    match's destination names.
// The field names are undocumented and only read; should they change, nothing
// is colored.
function outgoingLinkPanes(plugin) {
  return plugin.app.workspace
    .getLeavesOfType(OUTGOING_LINK_VIEW_TYPE)
    .map((leaf) => leaf.view?.outgoingLink)
    .filter(Boolean);
}

function forEachLinkItem(pane, callback) {
  for (const item of pane.outgoingLinkDom?.vChildren?.children ?? []) {
    if (item.el) callback(item);
  }
}

function forEachMention(pane, callback) {
  const lookup = pane.unlinkedDom?.resultDomLookup;
  if (!(lookup instanceof Map)) return;
  for (const resultDom of lookup.values()) {
    for (const match of resultDom.vChildren?.children ?? []) {
      if (match.el) callback(match, pane.unlinkedDomInfo?.get(match));
    }
  }
}

// The row shows the link path Obsidian resolved it from: as its text for a
// link to a note (icon lucide-link), as the subtext below a heading, a block
// or a heading that doesn't exist. A link to a note that doesn't exist
// (lucide-file-plus) has no target. Resolved again the same way, so
// [[Note#Heading]] gets the color of Note.
function linkTarget(plugin, item) {
  const iconEl = item.el.querySelector(".tree-item-icon .svg-icon");
  if (!iconEl || iconEl.classList.contains("lucide-file-plus")) return null;

  const pathSelector = iconEl.classList.contains("lucide-link") ? LINK_TEXT_SELECTOR : ".tree-item-inner-subtext";
  const linkpath = item.el.querySelector(pathSelector)?.textContent;
  return linkpath ? plugin.app.metadataCache.getFirstLinkpathDest(linkpath, item.sourcePath) : null;
}

// Link rows: the text only, not the folder below it. Mentions: the name of each
// note the match could link to, not the matched text. Attachments have no TYP
// and stay as they are.
function applyOutgoingLinkColors(plugin) {
  for (const pane of outgoingLinkPanes(plugin)) {
    forEachLinkItem(pane, (item) => {
      // Rows out of view (virtualized list) are colored once inserted.
      if (!item.el.isConnected) return;
      const textEl = item.el.querySelector(LINK_TEXT_SELECTOR);
      if (textEl) setInlineColor(textEl, colorForFile(plugin, linkTarget(plugin, item), "outgoingLinks"));
    });
    forEachMention(pane, (match, info) => {
      if (!match.el.isConnected) return;
      match.el.querySelectorAll(DESTINATION_SELECTOR).forEach((nameEl, index) => {
        setInlineColor(nameEl, colorForFile(plugin, info?.files?.[index], "outgoingLinks"));
      });
    });
  }
}

// Rows scrolled out of view stay in both lists, detached from the DOM.
function clearKeptRows(plugin) {
  for (const pane of outgoingLinkPanes(plugin)) {
    forEachLinkItem(pane, (item) => {
      const textEl = item.el.querySelector(LINK_TEXT_SELECTOR);
      if (textEl) setInlineColor(textEl, null);
    });
    forEachMention(pane, (match) => {
      match.el.querySelectorAll(DESTINATION_SELECTOR).forEach((nameEl) => setInlineColor(nameEl, null));
    });
  }
}

// One full round per frame at most. The pane rebuilds its rows whenever it
// shows another note and whenever its note's links are resolved anew (on every
// save while typing); the observer on the pane sees both, so no further events
// are needed. Nothing watches the markdown view.
function registerOutgoingLinkColors(plugin) {
  return registerLeafColors(plugin, {
    key: "outgoingLinks",
    viewTypes: [OUTGOING_LINK_VIEW_TYPE],
    apply: applyOutgoingLinkColors,
    clearKept: clearKeptRows,
  });
}

module.exports = { registerOutgoingLinkColors };
