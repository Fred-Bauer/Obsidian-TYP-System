const { Component, getLinkpath } = require("obsidian");
const { colorForFile, setInlineColor, clearInlineColors, allDocuments } = require("./typ-colors");
const { coalesceFrame } = require("./typ-utils");
const { registerColorView } = require("./view-colors");
const { watchEmbeds, findRenderChild } = require("./note-embeds");

// Colors Bases (table, cards, list) wherever they are shown: .base files in
// their own tab and embedded bases (![[X.base]] and ```base blocks) in notes,
// hover previews, canvas cards and pop-out windows. Views of other plugins
// (Kanban, Map …) are left alone.
//
// Three parts, each with its own toggle, run inside one tracker that lives
// while any of them is on:
//  - file names (the file.name column, the cards title),
//  - links in values (link properties, file.links, file.backlinks,
//    file.embeds, formulas returning links),
//  - group headings.
// A part that is off costs nothing in a round. The file name part is a
// building block of its own, so it can be dropped from PARTS should CSS take
// over that job.

const BASES_WATCH_CLASS = "typ-watch-bases";
// A .base file's tab and an embedded base. Not .bases-view, which carries
// Obsidian's own node-inserted animation.
const BASES_SELECTOR = '.bases-embed, .workspace-leaf-content[data-type="bases"] > .view-content';
const ROW_SELECTOR = ".bases-tr, .bases-cards-item, .bases-list-item";
const GROUP_HEADING_SELECTOR = ".bases-group-heading";
const LINK_SELECTOR = ".internal-link";
const FILE_NAME_PROPERTY = "file.name";

// --- Rows of the built-in views ----------------------------------------------
// The DOM has no way from a row to its note (a cards title is plain text, and
// in a list the file name looks like any link value), but every built-in view
// keeps its rows as objects with the note (entry.file) and one element per
// property. These fields are undocumented and only read here; should they
// change, nothing is colored.
//   rows       every row the view holds - in the DOM or kept out of it (the
//              table's and cards' reuse pools, a list's rows outside the
//              viewport)
//   cells      [{ prop, el }] of a row
//   groupEls   elements holding the group headings, kept ones included
const VIEW_ADAPTERS = {
  table: {
    rows: (view) => [...(view.rows ?? []), ...(view.unusedRows ?? [])],
    cells: (row) => row.cells?.map((cell) => ({ prop: cell.prop, el: cell.el })) ?? [],
    groupEls: (view) => view.groups?.map((group) => group.tableEl) ?? [],
  },
  cards: {
    rows: (view) => [...(view.items ?? []), ...(view.unusedItems ?? [])],
    cells: (item) => item.props?.map((prop) => ({ prop: prop.prop, el: prop.el })) ?? [],
    groupEls: (view) => view.groups?.map((group) => group.groupHeadingEl) ?? [],
  },
  list: {
    rows: (view) => view.groups?.flatMap((group) => group.rows ?? []) ?? [],
    cells: (row) => row.cells?.map((cell) => ({ prop: cell.propertyId, el: cell.el })) ?? [],
    groupEls: (view) => view.groups?.map((group) => group.groupHeadingEl) ?? [],
  },
};

function headingsIn(el) {
  if (!el) return [];
  return el.matches(GROUP_HEADING_SELECTOR) ? [el] : el.querySelectorAll(GROUP_HEADING_SELECTOR);
}

// A link value, resolved like Obsidian does: values rendered as links resolve
// from the vault root (data-href is the link text, or a full path for a file),
// a link in a property editor of the table from the row's note. Unresolved
// links, attachments and notes without a TYP stay neutral.
function colorForLink(plugin, linkEl, sourcePath, viewKey) {
  const href = linkEl.getAttribute("data-href");
  if (!href || linkEl.classList.contains("is-unresolved")) return null;
  const file = plugin.app.metadataCache.getFirstLinkpathDest(getLinkpath(href), sourcePath);
  return colorForFile(plugin, file, viewKey);
}

// --- Parts --------------------------------------------------------------------
// Each part colors (on) or clears (!on) its own elements:
//   colorRow      optional (plugin, row, cells, on)
//   colorHeading  optional (plugin, headingEl, on)

// Table and list render the file name as a link; cards render it as text.
const FILE_NAME_PART = {
  enabled: (settings) => settings.colorViews.bases,
  colorRow(plugin, row, cells, on) {
    const cellEl = cells.find((cell) => cell.prop === FILE_NAME_PROPERTY)?.el;
    const el = cellEl?.querySelector(LINK_SELECTOR) ?? cellEl?.querySelector(".bases-cards-line");
    if (el) setInlineColor(el, on ? colorForFile(plugin, row.entry?.file, "bases") : null);
  },
};

const LINK_PART = {
  enabled: (settings) => settings.colorViews.bases && settings.colorViews.basesLinks,
  colorRow(plugin, row, cells, on) {
    for (const { prop, el } of cells) {
      if (prop === FILE_NAME_PROPERTY || !el) continue;
      for (const linkEl of el.querySelectorAll(LINK_SELECTOR)) {
        const sourcePath = linkEl.closest(".bases-metadata-value") ? row.entry?.file?.path ?? "" : "";
        setInlineColor(linkEl, on ? colorForLink(plugin, linkEl, sourcePath, "basesLinks") : null);
      }
    }
  },
};

const GROUP_HEADING_PART = {
  enabled: (settings) => settings.colorViews.bases && settings.colorViews.basesGroupHeadings,
  colorHeading(plugin, headingEl, on) {
    for (const linkEl of headingEl.querySelectorAll(`.bases-group-value ${LINK_SELECTOR}`)) {
      setInlineColor(linkEl, on ? colorForLink(plugin, linkEl, "", "basesGroupHeadings") : null);
    }
  },
};

const PARTS = [FILE_NAME_PART, LINK_PART, GROUP_HEADING_PART];

// --- Rounds -------------------------------------------------------------------

// Colors one base with the given parts. With insertedNodes only the rows and
// headings inside (or around) those nodes - all that scrolling a virtualized
// view, a cell rendered anew or switching the view does.
function colorBase(plugin, controller, parts, insertedNodes = null) {
  const view = controller.view;
  const adapter = VIEW_ADAPTERS[view?.type];
  if (!adapter || !parts.length) return;

  let rowEls = null;
  let headingEls = null;
  if (insertedNodes) {
    rowEls = new Set();
    headingEls = new Set();
    for (const node of insertedNodes) {
      if (!node.isConnected) continue;
      const rowEl = node.closest(ROW_SELECTOR);
      if (rowEl) rowEls.add(rowEl);
      else for (const el of node.querySelectorAll(ROW_SELECTOR)) rowEls.add(el);
      const headingEl = node.closest(GROUP_HEADING_SELECTOR);
      if (headingEl) headingEls.add(headingEl);
      else for (const el of node.querySelectorAll(GROUP_HEADING_SELECTOR)) headingEls.add(el);
    }
  }

  const rowParts = parts.filter((part) => part.colorRow);
  if (rowParts.length && (!rowEls || rowEls.size)) {
    for (const row of adapter.rows(view)) {
      if (!row.el?.isConnected || (rowEls && !rowEls.has(row.el))) continue;
      const cells = adapter.cells(row);
      for (const part of rowParts) part.colorRow(plugin, row, cells, true);
    }
  }

  const headingParts = parts.filter((part) => part.colorHeading);
  if (headingParts.length) {
    for (const headingEl of headingEls ?? controller.viewContainerEl.querySelectorAll(GROUP_HEADING_SELECTOR)) {
      for (const part of headingParts) part.colorHeading(plugin, headingEl, true);
    }
  }
}

// Removes one part's colors from a base, including rows and headings the view
// keeps out of the DOM - they would show their old color once inserted again.
function clearBase(plugin, controller, part) {
  const view = controller.view;
  const adapter = VIEW_ADAPTERS[view?.type];
  if (!adapter) return;
  if (part.colorRow) {
    for (const row of adapter.rows(view)) {
      if (row.el) part.colorRow(plugin, row, adapter.cells(row), false);
    }
  }
  if (part.colorHeading) {
    const headingEls = new Set(controller.viewContainerEl.querySelectorAll(GROUP_HEADING_SELECTOR));
    for (const el of adapter.groupEls(view)) for (const headingEl of headingsIn(el)) headingEls.add(headingEl);
    for (const headingEl of headingEls) part.colorHeading(plugin, headingEl, false);
  }
}

// --- Tracking -----------------------------------------------------------------
// Bases are found as they are inserted or shown (see watchEmbeds in
// note-embeds.js): an embedded base through its .bases-embed, a .base file's
// tab through its .view-content - also a tab shown for the first time, and in
// pop-out windows. Behind both sits a query controller (Obsidian's
// QueryController), found in the component tree by its view container
// (.bases-view), which stays the same when the base switches views.
//
// Each found base gets a child component on its controller, so it goes with
// the base (tab closed, embed re-rendered or scrolled out of Live Preview's
// viewport). It observes only the base's .bases-view, never the note around
// it.
function registerBasesColors(plugin) {
  const activeParts = () => PARTS.filter((part) => part.enabled(plugin.settings));

  return registerColorView(plugin, {
    key: "bases",
    enabled: () => activeParts().length > 0,
    start: (component) => {
      let parts = activeParts();
      const bases = new Map(); // controller -> { child, insertedNodes }

      // One frame for all bases: a full round (TYP change, settings change) or
      // only the inserted elements of each base.
      let fullRound = false;
      const flush = coalesceFrame(() => {
        for (const [controller, base] of bases) {
          if (fullRound) colorBase(plugin, controller, parts);
          else if (base.insertedNodes.size) colorBase(plugin, controller, parts, base.insertedNodes);
          base.insertedNodes.clear();
        }
        fullRound = false;
      });
      component.register(flush.cancel);
      const requestFullRound = () => {
        fullRound = true;
        flush();
      };

      const track = (controller) => {
        const child = new Component();
        const base = { child, insertedNodes: new Set() };
        // A pending full round makes the collected nodes unnecessary.
        const observer = new MutationObserver((records) => {
          if (fullRound) return;
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) base.insertedNodes.add(node);
            }
          }
          if (base.insertedNodes.size) flush();
        });
        observer.observe(controller.viewContainerEl, { childList: true, subtree: true });
        child.register(() => {
          observer.disconnect();
          bases.delete(controller);
        });
        bases.set(controller, base);
        controller.addChild(child);
      };

      // Colors right away, not in the next frame: rows may already be shown
      // (a tab shown again, or all bases on screen when switching on), and
      // this frame is painted next.
      const onInserted = (el) => {
        const controller = findRenderChild(plugin.app, (candidate) => candidate.viewContainerEl?.parentElement === el);
        if (!controller) return;
        if (!bases.has(controller)) track(controller);
        colorBase(plugin, controller, parts);
      };
      watchEmbeds(plugin, component, { bodyClass: BASES_WATCH_CLASS, selector: BASES_SELECTOR, onInserted });

      component.registerEvent(plugin.typIndex.on("change", requestFullRound));
      // Stops observing; parts still on are cleared here, while the bases and
      // the rows they keep out of the DOM are still known.
      component.register(() => {
        for (const [controller, base] of [...bases]) {
          for (const part of parts) clearBase(plugin, controller, part);
          controller.removeChild(base.child);
        }
      });

      // A sub-toggle switched off clears its part; everything else is a full
      // round with the parts now on.
      return () => {
        const next = activeParts();
        for (const part of parts) {
          if (next.includes(part)) continue;
          for (const controller of bases.keys()) clearBase(plugin, controller, part);
        }
        parts = next;
        requestFullRound();
      };
    },
    // Bases whose controller is already gone or that were never found.
    clear: () => {
      for (const doc of allDocuments(plugin.app)) {
        for (const el of doc.querySelectorAll(".bases-view")) clearInlineColors(el);
      }
    },
  });
}

module.exports = { registerBasesColors };
