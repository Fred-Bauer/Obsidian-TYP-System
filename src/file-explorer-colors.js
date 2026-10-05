const { TFile, TFolder } = require("obsidian");
const { colorForFile, setInlineColor } = require("./typ-colors");
const { registerLeafColors } = require("./view-colors");

const FILE_EXPLORER_VIEW_TYPE = "file-explorer";
const FOLDER_NOTES_PLUGIN_ID = "folder-notes";
const TITLE_SELECTOR = ".nav-file-title[data-path], .nav-folder-title[data-path]";

// Folder Notes shows a note as its folder instead of as its own row. It has no
// public API for this, so the file name is rebuilt from its live settings.
// Also used for the breadcrumbs of the view header (header-colors.js).
function getFolderNoteFile(plugin, folder) {
  const folderNotes = plugin.app.plugins.plugins[FOLDER_NOTES_PLUGIN_ID];
  const settings = folderNotes?.settings;
  if (!settings) return null;

  const fileName =
    (settings.folderNoteName || "{{folder_name}}").replace("{{folder_name}}", folder.name) +
    (settings.folderNoteType || ".md");
  // The vault root's path is "/", which no file path starts with.
  const parent = folder.parent && !folder.parent.isRoot() ? folder.parent.path : "";
  const dirPath = settings.storageLocation === "parentFolder" ? parent : folder.path;
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

  setInlineColor(contentEl, colorForFile(plugin, file, "fileExplorer"));
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

// Rows of collapsed folders and rows scrolled out of the virtualized list stay
// in view.fileItems, detached from the DOM; once inserted again they would
// still show their color.
function clearKeptRows(plugin) {
  for (const leaf of plugin.app.workspace.getLeavesOfType(FILE_EXPLORER_VIEW_TYPE)) {
    for (const item of Object.values(leaf.view.fileItems ?? {})) {
      if (item.innerEl) setInlineColor(item.innerEl, null);
    }
  }
}

// Events that can change existing rows (TYP change, rename, layout change,
// refreshTypColors) ask for a full round over the rendered rows; DOM changes
// only color the rows the explorer inserted, which is all that scrolling and
// expanding a folder do. Scrolling the virtualized list used to recolor the
// whole view on every DOM change.
function registerFileExplorerColors(plugin) {
  return registerLeafColors(plugin, {
    key: "fileExplorer",
    viewTypes: [FILE_EXPLORER_VIEW_TYPE],
    apply: applyFileExplorerColors,
    applyInserted: applyToInsertedNodes,
    // A row is inserted before it is rendered: Obsidian sets its text and
    // data-path only when the virtualized list first draws it (onRender),
    // which at startup can come after the insertion. Seeing data-path being
    // set catches those rows too.
    attributes: ["data-path"],
    events: (component, refresh) => component.registerEvent(plugin.app.vault.on("rename", refresh)),
    clearKept: clearKeptRows,
  });
}

module.exports = { registerFileExplorerColors, getFolderNoteFile };
