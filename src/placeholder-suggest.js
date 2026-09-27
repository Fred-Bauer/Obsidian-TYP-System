const { TFile, Vault, debounce, normalizePath } = require("obsidian");
const { FRONTMATTER_PLACEHOLDERS } = require("./frontmatter-placeholders");

// Marker-Klasse am Container des TYP-Frontmatter-Editors (gesetzt in
// mountFrontmatterEditor, type-frontmatter-editor.js) - grenzt die
// Platzhalter-Vorschläge unten auf diesen Editor ein, echte Notizen bleiben
// unberührt.
const EDITOR_CLASS = "fred-typ-frontmatter-editor";

// Nur Templater-Skripte mit diesem Marker in einem Kommentar werden als
// "{{tp.<Skriptname>}}" vorgeschlagen - reine Hilfsskripte (z. B.
// toListIfMultiple, TYP selbst) ergeben als Shortcut keinen Sinn.
const SHORTCUT_MARKER = /^\s*(?:\/\/|\/\*|\*).*@typ-shortcut\b/m;

// Platzhalter-Vorschläge im Wert-Feld des TYP-Frontmatter-Editors,
// sobald der Wert mit "{" beginnt: die festen Token ({{today}} usw.) sowie
// "{{tp.<Skriptname>}}" für jedes markierte Templater-Skript.
//
// Obsidians Wert-Vorschläge (Text- und Listen-Properties) holen ihre
// Kandidaten ausschließlich über metadataCache.getFrontmatterPropertyValuesForKey
// (key) und filtern/sortieren/rendern sie danach selbst (fuzzy gegen den
// getippten Text, siehe getSuggestions der Property-Wert-Suggest-Klasse im
// gebauten app.js). Statt eine eigene Suggest-Komponente danebenzusetzen
// (die mit der nativen konkurrieren würde), wird deshalb nur diese eine
// Methode umhüllt: Liegt der Fokus gerade in einem Wert-Feld dieses Editors
// und beginnt der Wert mit "{", kommen die Platzhalter vorne dazu - sonst
// unverändert das Original. Der Aufruf passiert synchron beim Tippen, der
// Fokus ist dabei zuverlässig das Eingabefeld selbst.
//
// Die Skriptliste wird vorab (asynchron) aus Templaters Skript-Ordner
// gelesen und bei Änderungen darin nachgeführt - die umhüllte Methode muss
// synchron bleiben und kann Dateien nicht erst beim Tippen lesen.
function registerPlaceholderSuggest(plugin) {
  const { app } = plugin;
  const metadataCache = app.metadataCache;

  let scriptFolder = null;
  let shortcutScripts = [];

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
    const names = [];
    for (const file of files) {
      try {
        if (SHORTCUT_MARKER.test(await app.vault.cachedRead(file))) names.push(file.basename);
      } catch (e) {
        console.error(`TYP-System: Templater-Skript ${file.path} nicht lesbar`, e);
      }
    }
    // Ordner zwischenzeitlich in Templater umgestellt: Ergebnis verwerfen,
    // der Lauf für den neuen Ordner ist bereits angestoßen.
    if (folderPath !== scriptFolder) return;
    shortcutScripts = names.sort((a, b) => a.localeCompare(b));
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

  const placeholderTokens = () => [
    ...FRONTMATTER_PLACEHOLDERS.map((p) => p.token),
    ...shortcutScripts.map((name) => `{{tp.${name}}}`),
  ];

  const original = metadataCache.getFrontmatterPropertyValuesForKey;
  const wrapped = function (...args) {
    const values = original.apply(this, args);
    const inputEl = activeDocument.activeElement;
    if (!inputEl?.closest?.(`.${EDITOR_CLASS}`)) return values;
    const text = typeof inputEl.value === "string" ? inputEl.value : inputEl.textContent ?? "";
    if (!text.trimStart().startsWith("{")) return values;

    // Templater-Ordner inzwischen umgestellt: für den nächsten Tastendruck
    // nachladen, jetzt noch mit der bisherigen Liste antworten.
    if (currentScriptFolder() !== scriptFolder) scheduleRefresh();
    const tokens = placeholderTokens();
    return [...tokens, ...values.filter((v) => !tokens.includes(v))];
  };
  metadataCache.getFrontmatterPropertyValuesForKey = wrapped;
  plugin.register(() => {
    if (metadataCache.getFrontmatterPropertyValuesForKey === wrapped) {
      metadataCache.getFrontmatterPropertyValuesForKey = original;
    }
  });
}

module.exports = { registerPlaceholderSuggest, EDITOR_CLASS };
