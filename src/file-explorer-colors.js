const { TFile, TFolder } = require("obsidian");
const { colorForFile } = require("./type-colors");

const FILE_EXPLORER_VIEW_TYPE = "file-explorer";
const FOLDER_NOTES_PLUGIN_ID = "folder-notes";

// Das "Folder Notes"-Plugin zeigt eine Notiz statt als eigene Zeile als Ordner an.
// Es hat keine öffentliche API dafür, daher den Dateinamen aus seinen eigenen
// (Live-)Einstellungen nachbauen, statt seine internen Funktionen anzuzapfen.
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

function applyColorToTitle(plugin, titleEl, file) {
  const contentEl = titleEl.querySelector(".nav-file-title-content, .nav-folder-title-content");
  if (!contentEl) return;

  const color = plugin.settings.colorViews.fileExplorer ? colorForFile(plugin, file, "fileExplorer") : null;
  if (color) contentEl.style.color = color;
  else contentEl.style.removeProperty("color");
}

function applyFileExplorerColors(plugin) {
  for (const leaf of plugin.app.workspace.getLeavesOfType(FILE_EXPLORER_VIEW_TYPE)) {
    const fileTitleEls = leaf.view.containerEl.querySelectorAll(".nav-file-title[data-path]");
    for (const titleEl of fileTitleEls) {
      const file = plugin.app.vault.getAbstractFileByPath(titleEl.getAttribute("data-path"));
      applyColorToTitle(plugin, titleEl, file instanceof TFile ? file : null);
    }

    const folderTitleEls = leaf.view.containerEl.querySelectorAll(".nav-folder-title[data-path]");
    for (const titleEl of folderTitleEls) {
      const folder = plugin.app.vault.getAbstractFileByPath(titleEl.getAttribute("data-path"));
      const noteFile = folder instanceof TFolder ? getFolderNoteFile(plugin, folder) : null;
      applyColorToTitle(plugin, titleEl, noteFile);
    }
  }
}

function registerFileExplorerColors(plugin) {
  const refresh = () => applyFileExplorerColors(plugin);

  // Der File-Explorer rendert Einträge beim Auf-/Zuklappen von Ordnern dynamisch
  // neu - per MutationObserver auf neu eingefügte Elemente reagieren, statt nur
  // einmalig beim Start einzufärben.
  const observer = new MutationObserver(refresh);
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
