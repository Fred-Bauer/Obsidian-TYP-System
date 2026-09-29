const { TFile, Vault, debounce, normalizePath } = require("obsidian");

// Nur Templater-Skripte mit diesem Marker in einem Kommentar werden im
// Shortcut-Modal (shortcut-picker.js) angeboten - reine Hilfsskripte (z. B.
// toListIfMultiple, TYP selbst) ergeben als Shortcut keinen Sinn. Der Text
// hinter dem Marker bis zum Zeilenende dient als Beschreibung in der Liste;
// fehlt er, steht dort nur der Skriptname. Ein abschließendes "*/" eines
// Blockkommentars gehört nicht zur Beschreibung.
//
// Vor dem Marker ist beliebiger Kommentartext erlaubt (".*?"), damit bereits
// markierte Skripte markiert bleiben, egal wie die Zeile sonst aufgebaut ist.
const SHORTCUT_MARKER = /^[ \t]*(?:\/\/|\/\*|\*).*?@typ-shortcut\b[ \t]*(.*?)[ \t]*(?:\*\/)?[ \t]*$/m;

// Hält die Liste der als Shortcut markierten Templater-Skripte aktuell.
//
// Die Liste wird vorab (asynchron) aus Templaters Skript-Ordner gelesen und bei
// Änderungen darin nachgeführt, statt sie erst beim Öffnen des Modals zu
// ermitteln - so ist sie dort ohne Wartezeit da, und das Modal bleibt frei von
// Dateizugriffen. Liefert einen Accessor auf die jeweils aktuelle Liste
// ([{ name, description }], nach Namen sortiert).
function registerShortcutScripts(plugin) {
  const { app } = plugin;

  let scriptFolder = null;
  let scripts = [];

  const currentScriptFolder = () => {
    const folder = app.plugins.plugins["templater-obsidian"]?.settings?.user_scripts_folder;
    return folder ? normalizePath(folder) : null;
  };

  const isInScriptFolder = (path) => !!scriptFolder && !!path && path.startsWith(scriptFolder + "/");

  // Wie Templater selbst: alle .js-Dateien im Skript-Ordner inkl.
  // Unterordnern, Skriptname = Dateiname ohne Endung.
  async function refreshScripts() {
    const folderPath = currentScriptFolder();
    scriptFolder = folderPath;
    const folder = folderPath ? app.vault.getFolderByPath(folderPath) : null;
    const files = [];
    if (folder) {
      Vault.recurseChildren(folder, (child) => {
        if (child instanceof TFile && child.extension === "js") files.push(child);
      });
    }
    const found = [];
    for (const file of files) {
      try {
        const match = (await app.vault.cachedRead(file)).match(SHORTCUT_MARKER);
        if (match) found.push({ name: file.basename, description: match[1] ?? "" });
      } catch (e) {
        console.error(`TYP-System: Templater-Skript ${file.path} nicht lesbar`, e);
      }
    }
    // Ordner zwischenzeitlich in Templater umgestellt: Ergebnis verwerfen,
    // der Lauf für den neuen Ordner ist bereits angestoßen.
    if (folderPath !== scriptFolder) return;
    scripts = found.sort((a, b) => a.name.localeCompare(b.name));
  }

  const scheduleRefresh = debounce(refreshScripts, 300, true);
  const onFileChange = (file, oldPath) => {
    if (isInScriptFolder(file?.path) || isInScriptFolder(oldPath)) scheduleRefresh();
  };
  plugin.registerEvent(app.vault.on("create", onFileChange));
  plugin.registerEvent(app.vault.on("modify", onFileChange));
  plugin.registerEvent(app.vault.on("delete", onFileChange));
  plugin.registerEvent(app.vault.on("rename", onFileChange));
  app.workspace.onLayoutReady(refreshScripts);

  return () => {
    // Templater-Ordner inzwischen umgestellt: für den nächsten Aufruf
    // nachladen, jetzt noch mit der bisherigen Liste antworten.
    if (currentScriptFolder() !== scriptFolder) scheduleRefresh();
    return scripts;
  };
}

module.exports = { registerShortcutScripts, SHORTCUT_MARKER };
