const { TFile } = require("obsidian");
const { colorForFile, setInlineColor, clearInlineColors } = require("./typ-colors");
const { coalesceFrame } = require("./typ-utils");
const { registerColorView } = require("./view-colors");
const { getFolderNoteFile } = require("./file-explorer-colors");

// Two toggles for the titles Obsidian shows around a leaf, in every leaf
// (main area, sidebars, pop-out windows):
//  - tabTitles   the tab header's title (stacked tabs included) and, on
//                mobile, the title under each tab of the tab switcher
//  - viewHeader  the header above a note or base: the note name and every
//                breadcrumb folder that has a folder note
// Files without a TYP (bases, canvases, PDFs, ...) stay neutral; their
// breadcrumb folders are colored like any others.
//
// Obsidian writes these titles into the same elements every time (setText in
// loadFile, updateHeader and on rename; breadcrumbs are rebuilt with empty()).
// "file-open", "active-leaf-change" and "layout-change" all come from timers,
// after that frame is painted - with the previous note's color still on the
// element. So each title element gets an observer of its own (childList only:
// setText replaces the text node), which colors its leaf before the paint.
// Nothing near the note is observed; typing changes none of these elements.
//
// The fields are undocumented and only read (leaf.tabHeaderInnerTitleEl,
// view.titleEl, view.titleParentEl, view.titleContainerEl,
// app.mobileTabSwitcher); should they change, nothing is colored.

// The file whose name the leaf's title shows, or null. A view that follows the
// active note (the properties sidebar) is a FileView too, but has a title of
// its own ("File properties"). A tab restored at startup stays a DeferredView
// until it is first shown; its tab already shows the stored title, the file's
// path is in its state.
function titleFile(plugin, leaf) {
  const view = leaf.view;
  let file = view?.file;
  if (!file && leaf.isDeferred) file = plugin.app.vault.getAbstractFileByPath(view.getState?.()?.file ?? "");
  return file instanceof TFile && view.getDisplayText() === file.basename ? file : null;
}

// The breadcrumbs are spans without a path, one per folder of file.parent.path
// in order (renderBreadcrumbs), so they are matched by position.
function breadcrumbFolders(file) {
  const folders = [];
  for (let folder = file?.parent; folder && !folder.isRoot(); folder = folder.parent) folders.unshift(folder);
  return folders;
}

// A title is colored by the file it shows. Until Obsidian has written the new
// view's name (a restored tab or a note turning into a base gets a new view,
// which loads its file first), it keeps the old title and its color; writing
// the new one calls the observer anyway.
function colorTitle(plugin, leaf, titleEl, viewKey) {
  if (titleEl && titleEl.textContent === leaf.view.getDisplayText()) {
    setInlineColor(titleEl, colorForFile(plugin, titleFile(plugin, leaf), viewKey));
  }
}

function colorTabTitle(plugin, leaf) {
  colorTitle(plugin, leaf, leaf.tabHeaderInnerTitleEl, "tabTitles");
}

function colorViewHeader(plugin, leaf) {
  const view = leaf.view;
  colorTitle(plugin, leaf, view?.titleEl, "viewHeader");
  if (!view?.titleParentEl) return;
  const folders = breadcrumbFolders(view.file instanceof TFile ? view.file : null);
  view.titleParentEl.querySelectorAll(":scope > .view-header-breadcrumb").forEach((crumbEl, index) => {
    const folder = folders[index];
    setInlineColor(crumbEl, folder ? colorForFile(plugin, getFolderNoteFile(plugin, folder), "viewHeader") : null);
  });
}

// The life cycle both toggles share:
//   key          colorViews key
//   targets      (leaf) => elements whose children Obsidian rewrites
//   apply        (leaf) => void: colors one leaf
//   clearLeaf    (leaf) => void
//   extra        optional (component, refresh) => void: more events and
//                observers while on
//   applyExtra   optional () => void: colors what isn't a leaf, after every
//                full round
//   clearExtra   optional () => void
// Leaves are found once the layout is ready, on "layout-change" (a new tab or
// split comes 4-12 frames before its file's title, measured) and on
// "window-open". leaf.containerEl is observed too: a leaf that switches view
// type (note to base) gets a new view, inserted there before it loads its
// file, so its title elements are observed before they are filled.
function registerLeafTitleColors(plugin, { key, targets, apply, clearLeaf, extra = null, applyExtra = null, clearExtra = null }) {
  const start = (component) => {
    const leafOf = new WeakMap();
    const watch = (leaf) => {
      for (const el of [leaf.containerEl, ...targets(leaf)]) {
        if (!el || leafOf.get(el) === leaf) continue;
        leafOf.set(el, leaf);
        observer.observe(el, { childList: true });
      }
    };
    const observer = new MutationObserver((records) => {
      const leaves = new Set();
      for (const record of records) {
        const leaf = leafOf.get(record.target);
        if (leaf) leaves.add(leaf);
      }
      for (const leaf of leaves) {
        watch(leaf);
        apply(leaf);
      }
    });
    component.register(() => observer.disconnect());

    const round = () => {
      plugin.app.workspace.iterateAllLeaves((leaf) => {
        watch(leaf);
        apply(leaf);
      });
      applyExtra?.();
    };
    const refresh = coalesceFrame(round);
    component.register(refresh.cancel);

    component.registerEvent(plugin.typIndex.on("change", refresh));
    component.registerEvent(plugin.app.workspace.on("layout-change", refresh));
    component.registerEvent(plugin.app.workspace.on("window-open", refresh));
    extra?.(component, refresh);

    // See registerLeafColors in view-colors.js.
    let running = true;
    component.register(() => (running = false));
    plugin.app.workspace.onLayoutReady(() => {
      if (running) round();
    });
    return refresh;
  };

  const clear = () => {
    plugin.app.workspace.iterateAllLeaves((leaf) => {
      clearLeaf(leaf);
    });
    clearExtra?.();
  };

  return registerColorView(plugin, { key, start, clear });
}

// The mobile tab switcher (phone and tablet) renders its tabs when it is shown
// and on layout changes while visible, each with a title of its own
// (tabPreviews: leaf id -> preview with leaf and titleEl). Its list is
// observed (childList, subtree: groups, tabs and titles) and only changes
// while it renders. Hidden, it is taken out of the DOM with its titles.
function forEachSwitcherTitle(plugin, callback) {
  const previews = plugin.app.mobileTabSwitcher?.tabPreviews ?? {};
  for (const preview of Object.values(previews)) {
    if (preview.titleEl && preview.leaf) callback(preview.titleEl, preview.leaf);
  }
}

function registerTabTitleColors(plugin) {
  const colorSwitcher = () =>
    forEachSwitcherTitle(plugin, (titleEl, leaf) => setInlineColor(titleEl, colorForFile(plugin, titleFile(plugin, leaf), "tabTitles")));

  return registerLeafTitleColors(plugin, {
    key: "tabTitles",
    targets: (leaf) => [leaf.tabHeaderInnerTitleEl],
    apply: (leaf) => colorTabTitle(plugin, leaf),
    clearLeaf: (leaf) => {
      if (leaf.tabHeaderInnerTitleEl) setInlineColor(leaf.tabHeaderInnerTitleEl, null);
    },
    extra: (component) => {
      const listEl = plugin.app.mobileTabSwitcher?.innerScrollEl;
      if (!listEl) return;
      const observer = new MutationObserver(colorSwitcher);
      observer.observe(listEl, { childList: true, subtree: true });
      component.register(() => observer.disconnect());
    },
    applyExtra: colorSwitcher,
    clearExtra: () => forEachSwitcherTitle(plugin, (titleEl) => setInlineColor(titleEl, null)),
  });
}

// A folder note created, deleted or renamed changes a breadcrumb's color
// without Obsidian touching the header, hence the vault events (one round per
// frame; saving a note fires none of them).
function registerViewHeaderColors(plugin) {
  return registerLeafTitleColors(plugin, {
    key: "viewHeader",
    targets: (leaf) => [leaf.view?.titleEl, leaf.view?.titleParentEl],
    apply: (leaf) => colorViewHeader(plugin, leaf),
    clearLeaf: (leaf) => {
      const containerEl = leaf.view?.titleContainerEl;
      if (containerEl) clearInlineColors(containerEl);
    },
    extra: (component, refresh) => {
      // Registered once the layout is ready: while the vault loads, "create"
      // fires for every file.
      let running = true;
      component.register(() => (running = false));
      plugin.app.workspace.onLayoutReady(() => {
        if (!running) return;
        for (const name of ["create", "delete", "rename"]) component.registerEvent(plugin.app.vault.on(name, refresh));
      });
    },
  });
}

module.exports = { registerTabTitleColors, registerViewHeaderColors };
