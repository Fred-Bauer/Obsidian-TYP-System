const { Component } = require("obsidian");
const { colorForLink, setInlineColor, allDocuments } = require("./typ-colors");
const { coalesceFrame } = require("./typ-utils");
const { registerColorView } = require("./view-colors");
const { watchEmbeds, findRenderChild } = require("./note-embeds");

// Colors links in property values by the TYP of their target: list pills and
// single link values, in a note's property block (Live Preview and reading
// view), the properties sidebar, hover previews and the TYP-Pane's own property
// editors. External links, links to notes that don't exist and attachments
// stay as they are, and so does a value being edited: Obsidian swaps it for a
// plain input with the raw text. Bases tables use the same property editors,
// but outside .metadata-container; "Bases links" colors those
// (bases-colors.js).
//
// The property block is in nearly every note, so nothing watches a note or
// listens to its events. Obsidian builds a link element anew whenever it
// renders a value: for a row only when its value changed, for a list on every
// pill added, edited or removed, right away and before saving. So every new
// value is a new element, and two ways catch them:
//  - The links announce themselves (see watchEmbeds in note-embeds.js),
//    wherever a property block shows up. "animationstart" comes one frame
//    after a link was first laid out, so the first appearance of a block
//    (a note opened in a new tab, a mode shown for the first time, a hover
//    preview) shows its links in the normal link color for that one frame.
//    An element shown again (tab or mode switched, block expanded) keeps its
//    color.
//  - The first link found in a block makes it a tracked block: a
//    MutationObserver on that block alone (never on the note around it)
//    colors the links inserted later before the frame is painted - a note
//    opened in the same tab, the properties sidebar following the active
//    note, pills added or edited, values changed. Typing in the text doesn't
//    touch the block; typing in a property field only changes its text.

const WATCH_CLASS = "typ-watch-property-links";
const PROPERTY_LINK_SELECTOR =
  ".metadata-container .multi-select-pill-content.internal-link, .metadata-container .metadata-link-inner.internal-link";
const PROPERTY_BLOCK_SELECTOR = ".metadata-container";

// The property editor (Obsidian's MetadataEditor) behind a block. The DOM has
// no way back to it, so it is found in the component tree by its container.
// A container always belongs to the same editor, so the walk happens once per
// container (editors: container -> editor). Not found: a hover preview opened
// from an embedded note (see findRenderChild).
function editorOf(app, editors, blockEl) {
  let editor = editors.get(blockEl);
  if (!editor) {
    editor = findRenderChild(app, (component) => component.containerEl === blockEl && typeof component.owner?.getFile === "function");
    if (editor) editors.set(blockEl, editor);
  }
  return editor ?? null;
}

// A link resolves from the same note as in Obsidian: the editor's
// owner.getFile() (sourcePath in renderProperty), asked anew every time,
// since a tab keeps its editor when it opens another note. The TYP-Pane's
// editors have no file, so their links resolve from the vault root, as in
// Obsidian; so do links in a block whose editor isn't found.
function colorPropertyLink(plugin, editor, linkEl) {
  const sourcePath = editor?.owner.getFile()?.path ?? "";
  setInlineColor(linkEl, colorForLink(plugin, linkEl, sourcePath, "propertyLinks"));
}

// Links in hidden tabs and collapsed blocks included, so they are right once
// shown.
function propertyLinks(plugin) {
  return [...allDocuments(plugin.app)].flatMap((doc) => [...doc.querySelectorAll(PROPERTY_LINK_SELECTOR)]);
}

// The links among (or inside) the inserted nodes of a MutationObserver's
// records. A pill is inserted before its content becomes a link, but the
// observer runs after the render, when the classes are set.
function insertedLinks(records) {
  const links = new Set();
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.matches(PROPERTY_LINK_SELECTOR)) links.add(node);
      else for (const linkEl of node.querySelectorAll(PROPERTY_LINK_SELECTOR)) links.add(linkEl);
    }
  }
  return links;
}

// A TYP change and refreshTypColors() (colors, the Subtyp sub-toggle) recolor
// every link, at most once per frame.
function registerPropertyLinkColors(plugin) {
  return registerColorView(plugin, {
    key: "propertyLinks",
    start: (component) => {
      const editors = new WeakMap();
      const blocks = new Map(); // editor -> our child component
      const refresh = coalesceFrame(() => {
        for (const linkEl of propertyLinks(plugin)) {
          colorPropertyLink(plugin, editorOf(plugin.app, editors, linkEl.closest(PROPERTY_BLOCK_SELECTOR)), linkEl);
        }
      });
      component.register(refresh.cancel);

      // A child component on the editor, so the observer goes with it (note
      // closed, hover preview hidden, TYP-Pane re-rendered).
      const track = (editor) => {
        const child = new Component();
        const observer = new MutationObserver((records) => {
          for (const linkEl of insertedLinks(records)) colorPropertyLink(plugin, editor, linkEl);
        });
        observer.observe(editor.containerEl, { childList: true, subtree: true });
        child.register(() => {
          observer.disconnect();
          blocks.delete(editor);
        });
        blocks.set(editor, child);
        editor.addChild(child);
      };

      const onInserted = (linkEl) => {
        const editor = editorOf(plugin.app, editors, linkEl.closest(PROPERTY_BLOCK_SELECTOR));
        if (editor && !blocks.has(editor)) track(editor);
        colorPropertyLink(plugin, editor, linkEl);
      };
      watchEmbeds(plugin, component, { bodyClass: WATCH_CLASS, selector: PROPERTY_LINK_SELECTOR, onInserted });

      component.registerEvent(plugin.typIndex.on("change", refresh));
      component.register(() => {
        for (const [editor, child] of [...blocks]) editor.removeChild(child);
      });
      return refresh;
    },
    // Obsidian keeps no link elements out of the DOM - apart from a pill
    // being edited, put back on Escape - so the documents are all.
    clear: () => {
      for (const linkEl of propertyLinks(plugin)) setInlineColor(linkEl, null);
    },
  });
}

module.exports = { registerPropertyLinkColors };
