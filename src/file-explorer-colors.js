const { TFile, TFolder } = require("obsidian");
const { colorForFile, setInlineColor } = require("./typ-colors");
const { coalesceFrame } = require("./typ-utils");

const FILE_EXPLORER_VIEW_TYPE = "file-explorer";
const FOLDER_NOTES_PLUGIN_ID = "folder-notes";
const TITLE_SELECTOR = ".nav-file-title[data-path], .nav-folder-title[data-path]";

// Folder Notes shows a note as its folder instead of as its own row. It has no
// public API for this, so the file name is rebuilt from its live settings.
function getFolderNoteFile(plugin, folder) {
  const folderNotes = plugin.app.plugins.plugins[FOLDER_NOTES_PLUGIN_ID];
  const settings = folderNotes?.settings;
  if (!settings) return null;

  const fileName =
    (settings.folderNoteName || "{{folder_name}}").replace("{{folder_name}}", folder.name) +
    (settings.folderNoteType || ".md");
  const dirPath = settings.storageLocation === "parentFolder" ? folder.parent?.path ?? "" : folder.path;
  const path = dirPath ? `${dirPath}/${fileName}` : fileName;

  const file = plugin.app.vault.getAbstractFileByPath(path);
  return file instanceof TFile ? file : null;
}

// Colors one row (.nav-file-title or .nav-folder-title) by its data-path,
// which is read anew every time: the explorer is virtualized, and nothing is
// cached per row.
function applyColorToTitle(plugin, titleEl) {
  const contentEl = titleEl.querySelector(".nav-file-title-content, .nav-folder-title-content");
  if (!contentEl) return;

  const item = plugin.app.vault.getAbstractFileByPath(titleEl.getAttribute("data-path"));
  let file = null;
  if (titleEl.classList.contains("nav-folder-title")) {
    if (item instanceof TFolder) file = getFolderNoteFile(plugin, item);
  } else if (item instanceof TFile) {
    file = item;
  }

  const color = plugin.settings.colorViews.fileExplorer ? colorForFile(plugin, file, "fileExplorer") : null;
  setInlineColor(contentEl, color);
}

function applyFileExplorerColors(plugin) {
  for (const leaf of plugin.app.workspace.getLeavesOfType(FILE_EXPLORER_VIEW_TYPE)) {
    for (const titleEl of leaf.view.containerEl.querySelectorAll(TITLE_SELECTOR)) applyColorToTitle(plugin, titleEl);
  }
}

// Rows inserted since the last frame: the row itself or a whole subtree (an
// expanded folder brings its children along).
function applyToInsertedNodes(plugin, nodes) {
  for (const node of nodes) {
    if (!node.isConnected) continue;
    const titleEls = node.matches(TITLE_SELECTOR) ? [node] : node.querySelectorAll(TITLE_SELECTOR);
    for (const titleEl of titleEls) applyColorToTitle(plugin, titleEl);
  }
}

function registerFileExplorerColors(plugin) {
  // Two kinds of work, done at most once per frame:
  //  - a full round over every rendered row, for anything that can change
  //    existing rows (TYP change, rename, layout change, refreshTypColors);
  //  - only the rows the explorer inserted, which is all that scrolling and
  //    expanding a folder do. Scrolling the virtualized list used to recolor
  //    the whole view on every DOM change.
  let fullRound = false;
  const insertedNodes = new Set();
  const flush = coalesceFrame(() => {
    if (fullRound) applyFileExplorerColors(plugin);
    else applyToInsertedNodes(plugin, insertedNodes);
    fullRound = false;
    insertedNodes.clear();
  });
  plugin.register(flush.cancel);
  const refresh = () => {
    fullRound = true;
    flush();
  };

  const observer = new MutationObserver((records) => {
    if (fullRound) return;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) insertedNodes.add(node);
      }
    }
    if (insertedNodes.size) flush();
  });
  const observeExplorerLeaves = () => {
    for (const leaf of plugin.app.workspace.getLeavesOfType(FILE_EXPLORER_VIEW_TYPE)) {
      observer.observe(leaf.view.containerEl, { childList: true, subtree: true });
    }
  };
  plugin.register(() => observer.disconnect());

  plugin.registerEvent(plugin.typIndex.on("change", refresh));
  plugin.registerEvent(plugin.app.vault.on("rename", refresh));
  plugin.registerEvent(
    plugin.app.workspace.on("layout-change", () => {
      observeExplorerLeaves();
      refresh();
    })
  );

  plugin.app.workspace.onLayoutReady(() => {
    observeExplorerLeaves();
    refresh();
  });

  return refresh;
}

module.exports = { registerFileExplorerColors };
