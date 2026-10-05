const { TFile, getLinkpath } = require("obsidian");
const { colorForFile, setInlineColor, clearInlineColors, allDocuments } = require("./typ-colors");
const { coalesceFrame } = require("./typ-utils");
const { registerColorView } = require("./view-colors");
const { editorOf } = require("./property-link-colors");

// Colors notes, aliases (in the color of their note) and bookmarks to a note in
// Obsidian's suggestion lists, three toggles:
//  - quickSwitcher    the quick switcher, bookmarks included
//  - linkSuggestions  "[[" in the editor and link suggestions in a property
//                     field (property block, properties sidebar, TYP-Pane)
//  - fileDialogs      the other dialogs on the quick switcher's base class:
//                     Canvas "Add note from vault" (and "Swap file"; its
//                     media dialogs list only attachments), Note Composer,
//                     the mobile "Choose file to insert"
// Only the title is colored; the path or note name below it stays muted.
// Headings, blocks, notes that don't exist, "create" rows, attachments and
// excluded files (muted by Obsidian, "mod-downranked") stay as they are.
//
// A list exists only while it is open, so nothing watches a note, the editor
// or a modal. Every list is inserted into the body of its window - a modal
// with its rows already rendered (Modal.open appends it, then onOpen renders),
// a suggestion popover after its rows (setSuggestions, then attachDom). One
// MutationObserver on the bodies (childList only, no subtree) sees the list
// in the microtask after, before the frame is painted; typing in a note
// changes no child of the body. Each open list gets an observer on its own
// rows container: Obsidian rebuilds every row on each input (empty(), then
// new rows), which that observer colors before the paint as well. Both go
// with the list (removed from the body) and with the toggles.
//
// From a list to its items:
//  - quick switcher: switcher.instance.activeModal, its chooser's values in
//    the order of its rows (suggestions);
//  - "[[" in the editor: the editor suggest with a suggestManager, likewise;
//  - property fields and the other dialogs keep their instance nowhere, so
//    their rows are read the way Obsidian renders them (see dialogRowFile and
//    propertyRowFile). A row that doesn't look as expected stays as it is.
// The field names are undocumented and only read; should they change, nothing
// is colored.

const KEYS = ["quickSwitcher", "linkSuggestions", "fileDialogs"];
const TITLE_SELECTOR = ":scope > .suggestion-content > .suggestion-title";
const NOTE_SELECTOR = ":scope > .suggestion-content > .suggestion-note";
const FLAIR_SELECTOR = ":scope > .suggestion-aux > .suggestion-flair";
const ROW_SELECTOR = ":scope > .suggestion-item";

// A row's title in the color of file (null or no note: neutral).
function colorRow(plugin, rowEl, file, viewKey) {
  const titleEl = rowEl?.querySelector(TITLE_SELECTOR);
  if (!titleEl) return;
  const color = file instanceof TFile && !rowEl.hasClass("mod-downranked") ? colorForFile(plugin, file, viewKey) : null;
  setInlineColor(titleEl, color);
}

// Rows of a chooser whose items are known: suggestions[i] shows values[i].
function colorChooser(plugin, chooser, fileOf, viewKey) {
  const values = chooser.values ?? [];
  (chooser.suggestions ?? []).forEach((rowEl, index) => colorRow(plugin, rowEl, fileOf(values[index]), viewKey));
}

function rowParts(rowEl) {
  const flairEl = rowEl.querySelector(FLAIR_SELECTOR);
  return {
    titleText: rowEl.querySelector(TITLE_SELECTOR)?.textContent ?? null,
    noteText: rowEl.querySelector(NOTE_SELECTOR)?.textContent ?? null,
    flairEl,
    icon: flairEl?.querySelector(":scope > svg") ?? null,
  };
}

// --- Quick switcher and the dialogs on its base class -------------------------

// A bookmark row shows the bookmark's place in the list (group titles and its
// own title), found again in the Bookmarks plugin's items. Two bookmarks with
// the same place stay neutral unless they point to the same note.
function bookmarkFile(app, bookmarkPath) {
  const bookmarks = app.internalPlugins.getEnabledPluginById("bookmarks");
  if (!bookmarks) return null;
  const paths = new Set();
  const visit = (items, prefix) => {
    for (const item of items ?? []) {
      if (item.type === "group") visit(item.items, `${prefix}${item.title}/`);
      else if (prefix + bookmarks.getItemTitle(item) === bookmarkPath) paths.add(item.type === "file" ? item.path : null);
    }
  };
  visit(bookmarks.items, "");
  const [path] = paths;
  return paths.size === 1 && path ? app.vault.getAbstractFileByPath(path) : null;
}

// Item of the quick switcher: a note, an alias or a bookmark (with or without
// heading) to a note.
function switcherItemFile(app, item) {
  if (item?.type === "file" || item?.type === "alias") return item.file;
  if (item?.type === "bookmark" && item.item?.type === "file") return app.vault.getAbstractFileByPath(item.item.path);
  return null;
}

// A row of the base class, read from what renderSuggestion builds (every row
// draggable, an icon in the flair saying what it is):
//  - note or other file: the path without ".md" as title, an empty flair, no
//    note line;
//  - alias: icon lucide-forward, the note's path without ".md" below;
//  - bookmark: icon lucide-bookmark, its place in the list as title.
// Notes that don't exist (lucide-file-plus), "create" rows and other
// bookmarks stay neutral, and so does a row of any other modal.
function dialogRowFile(app, rowEl) {
  if (!rowEl.matches(".suggestion-item.mod-complex[draggable='true']")) return null;
  const { titleText, noteText, flairEl, icon } = rowParts(rowEl);
  if (titleText === null || !flairEl) return null;
  if (noteText === null && flairEl.className === "suggestion-flair" && !flairEl.hasChildNodes()) {
    return app.vault.getAbstractFileByPath(`${titleText}.md`);
  }
  if (noteText !== null && icon?.classList.contains("lucide-forward")) return app.vault.getAbstractFileByPath(`${noteText}.md`);
  if (noteText !== null && icon?.classList.contains("lucide-bookmark")) return bookmarkFile(app, titleText);
  return null;
}

// --- Link suggestions -----------------------------------------------------------

// Item of the "[[" suggestions: a note or an alias, also an alias offered
// after "|". Without a matching alias Obsidian offers the typed text as one,
// without its note (file null, the typed link as path); it is resolved from
// the note being edited, as the link will be. Headings, blocks and link texts
// that don't exist stay neutral.
function linkItemFile(app, item, sourcePath) {
  if (item?.type === "file") return item.file;
  if (item?.type !== "alias") return null;
  return item.file ?? (item.path ? app.metadataCache.getFirstLinkpathDest(getLinkpath(item.path), sourcePath) : null);
}

// What a property field asks for, read from the field (it has the focus while
// its suggestions are open), the way Obsidian picks its suggestions:
//  - "file": after "[[" - notes and aliases, both shown with their path;
//  - "display": after "[[Note|" - aliases of that note;
//  - "text": without "[[" - values the property already has elsewhere.
// After "#" or "^" Obsidian suggests headings and blocks: nothing to color.
function propertyQueryMode(inputEl) {
  const text = (inputEl instanceof HTMLInputElement ? inputEl.value : inputEl.textContent) ?? "";
  if (!text.startsWith("[[")) return "text";
  let query = text.slice(2);
  const end = query.indexOf("]]");
  if (end !== -1) query = query.slice(0, end);
  if (query.includes("|")) return "display";
  return /[#^]/.test(query) ? null : "file";
}

// A row of a property field, read from what Obsidian renders. Rows that need
// resolving (an alias after "|", an existing value) resolve from the note the
// field belongs to; without its editor (hover preview of an embedded note)
// they stay neutral.
//  - file: title and path above it (note line), no flair;
//  - alias: icon lucide-forward, the note's path (or after "|" the typed link)
//    below;
//  - existing value: icon lucide-link with the link as title (a heading as
//    "Note > Heading"), or lucide-forward with the link below an alias.
function propertyRowFile(app, rowEl, mode, sourcePath) {
  if (!rowEl.matches(".suggestion-item.mod-complex")) return null;
  const { titleText, noteText, flairEl, icon } = rowParts(rowEl);
  if (titleText === null || noteText === null) return null;
  const resolve = (href) => (sourcePath === null ? null : app.metadataCache.getFirstLinkpathDest(getLinkpath(href), sourcePath));
  const isAlias = icon?.classList.contains("lucide-forward");

  if (mode === "file") {
    if (!flairEl) return app.vault.getAbstractFileByPath(`${noteText}${titleText}.md`);
    return isAlias ? app.vault.getAbstractFileByPath(`${noteText}.md`) : null;
  }
  if (mode === "display") return isAlias ? resolve(noteText) : null;
  // An existing value linking to a heading or block stays neutral, like a
  // heading suggestion.
  if (mode === "text") {
    if (isAlias) return noteText.includes("#") ? null : resolve(noteText);
    return icon?.classList.contains("lucide-link") && !titleText.includes(" > ") ? resolve(titleText) : null;
  }
  return null;
}

// --- Lists --------------------------------------------------------------------

// The list rootEl (a child of a body) is, if its toggle is on:
// { key, itemsEl: the container Obsidian renders the rows into, color() }.
// The quick switcher is recognized first, so "Core file dialogs" never takes
// it for one of its dialogs.
function matchList(plugin, rootEl, editors) {
  const { app, settings } = plugin;
  const on = (key) => !!settings.colorViews[key];

  if (rootEl.hasClass("modal-container")) {
    const switcher = app.internalPlugins.plugins.switcher?.instance?.activeModal;
    if (switcher && switcher.containerEl === rootEl) {
      if (!on("quickSwitcher") || !switcher.chooser?.containerEl) return null;
      return {
        key: "quickSwitcher",
        itemsEl: switcher.chooser.containerEl,
        color: () => colorChooser(plugin, switcher.chooser, (item) => switcherItemFile(app, item), "quickSwitcher"),
      };
    }
    // Every other suggestion modal; only rows of the base class are colored
    // (see dialogRowFile), so other modals - the TYP-Picker, the command
    // palette, other plugins' pickers - stay untouched.
    const itemsEl = rootEl.querySelector(":scope > .prompt > .prompt-results");
    if (!itemsEl || !on("fileDialogs")) return null;
    return {
      key: "fileDialogs",
      itemsEl,
      color: () => {
        for (const rowEl of itemsEl.querySelectorAll(ROW_SELECTOR)) colorRow(plugin, rowEl, dialogRowFile(app, rowEl), "fileDialogs");
      },
    };
  }

  if (!rootEl.hasClass("suggestion-container") || !on("linkSuggestions")) return null;
  const linkSuggest = app.workspace.editorSuggest?.suggests?.find((suggest) => suggest.suggestManager && suggest.suggestEl === rootEl);
  if (linkSuggest) {
    if (!linkSuggest.suggestions?.containerEl) return null;
    return {
      key: "linkSuggestions",
      itemsEl: linkSuggest.suggestions.containerEl,
      color: () => {
        const sourcePath = linkSuggest.context?.file?.path ?? "";
        colorChooser(plugin, linkSuggest.suggestions, (item) => linkItemFile(app, item, sourcePath), "linkSuggestions");
      },
    };
  }
  // A property field: its suggestions (links, but also tags) sit in a popover
  // marked mod-property-value.
  const itemsEl = rootEl.hasClass("mod-property-value") ? rootEl.querySelector(":scope > .suggestion") : null;
  if (!itemsEl) return null;
  return {
    key: "linkSuggestions",
    itemsEl,
    color: () => {
      const inputEl = rootEl.ownerDocument.activeElement;
      const blockEl = inputEl?.closest(".metadata-container");
      const mode = blockEl ? propertyQueryMode(inputEl) : null;
      const editor = mode ? editorOf(app, editors, blockEl) : null;
      // As in Obsidian: the TYP-Pane's editors have no file and resolve from
      // the vault root.
      const sourcePath = editor ? editor.owner.getFile()?.path ?? "" : null;
      for (const rowEl of itemsEl.querySelectorAll(ROW_SELECTOR)) {
        colorRow(plugin, rowEl, mode ? propertyRowFile(app, rowEl, mode, sourcePath) : null, "linkSuggestions");
      }
    },
  };
}

// One life cycle for all three toggles: the body observer runs while at least
// one of them is on. A list whose toggle is off isn't tracked, so it costs
// nothing and keeps Obsidian's colors; switching one toggle off clears its
// open lists at the next refresh. A TYP change and refreshTypColors() recolor
// the open lists, at most once per frame.
function registerSuggestColors(plugin) {
  const lists = new Map(); // rootEl -> list (see matchList) with its observer

  const clearList = (rootEl) => {
    const list = lists.get(rootEl);
    list.observer.disconnect();
    clearInlineColors(list.itemsEl);
    lists.delete(rootEl);
  };

  return registerColorView(plugin, {
    enabled: () => KEYS.some((key) => plugin.settings.colorViews[key]),
    start: (component) => {
      const editors = new WeakMap();

      const track = (rootEl) => {
        if (rootEl.nodeType !== Node.ELEMENT_NODE || lists.has(rootEl) || !rootEl.isConnected) return;
        const list = matchList(plugin, rootEl, editors);
        if (!list) return;
        list.observer = new MutationObserver(list.color);
        list.observer.observe(list.itemsEl, { childList: true });
        lists.set(rootEl, list);
        list.color();
      };
      // A closed list keeps no rows (popovers are emptied, modals thrown
      // away), so there is nothing to clear.
      const untrack = (rootEl) => {
        lists.get(rootEl)?.observer.disconnect();
        lists.delete(rootEl);
      };

      const bodyObserver = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.removedNodes) untrack(node);
          for (const node of record.addedNodes) track(node);
        }
      });
      const watchDocument = (doc) => {
        bodyObserver.observe(doc.body, { childList: true });
        for (const el of doc.body.children) track(el);
      };
      for (const doc of allDocuments(plugin.app)) watchDocument(doc);
      component.registerEvent(plugin.app.workspace.on("window-open", (workspaceWindow, win) => watchDocument(win.document)));
      component.register(() => {
        bodyObserver.disconnect();
        for (const list of lists.values()) list.observer.disconnect();
      });

      // A toggle switched on finds lists that are already open.
      const refresh = coalesceFrame(() => {
        for (const [rootEl, list] of [...lists]) {
          if (plugin.settings.colorViews[list.key]) list.color();
          else clearList(rootEl);
        }
        for (const doc of allDocuments(plugin.app)) {
          for (const el of doc.body.children) track(el);
        }
      });
      component.register(refresh.cancel);
      component.registerEvent(plugin.typIndex.on("change", refresh));
      return refresh;
    },
    // Observers are already disconnected (component unloaded).
    clear: () => {
      for (const rootEl of [...lists.keys()]) clearList(rootEl);
    },
  });
}

module.exports = { registerSuggestColors };
