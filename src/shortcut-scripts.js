const { TFile, Vault, debounce, normalizePath } = require("obsidian");

// Nur Templater-Skripte mit diesem Marker in einem Kommentar werden im
// Shortcut-Modal (shortcut-picker.js) angeboten - reine Hilfsskripte (z. B.
// toListIfMultiple, TYP selbst) ergeben als Shortcut keinen Sinn. Der Text
// hinter dem Marker bis zum Zeilenende dient als Beschreibung in der Liste;
// fehlt er, steht dort nur der Skriptname. Ein abschließendes "*/" eines
// Blockkommentars gehört nicht zur Beschreibung.
//
// Optional folgt direkt auf den Marker eine Parameterliste in Klammern. Sie
// beschreibt die VOLLSTÄNDIGE Argumentliste des Aufrufs nach "tp" - also nicht
// nur die abgefragten Werte, sondern auch, an welcher Stelle das Skript die
// Datei bzw. den Kontext haben will (siehe RESERVED_PARAMS in shortcuts.js):
//   // @typ-shortcut(ordner, jahr)       -> f(tp, "Literatur", 2024)
//   // @typ-shortcut(newFile, jahr)      -> f(tp, newFile, 2024)
//   // @typ-shortcut(property)           -> f(tp, "Familie")
//   // @typ-shortcut                     -> f(tp, newFile, ctx)
// Dadurch bekommt jedes Skript seine eigenen Parameter in seiner eigenen
// Reihenfolge, statt sich einer festen Konvention beugen zu müssen.
//
// Unterschieden wird zwischen "gar keine Klammern" (params === null, der
// herkömmliche Aufruf f(tp, newFile, ctx) - so verhalten sich alle bisher
// markierten Skripte unverändert) und "leere Klammern" (params === [], ein
// Aufruf ganz ohne Argumente außer tp).
//
// Der Marker muss unmittelbar auf den Kommentarbeginn folgen. Eine frühere
// Fassung erlaubte beliebigen Text davor - damit genügte aber schon eine
// Erwähnung in Fließtext ("... in seinem @typ-shortcut-Marker deklariert"),
// um ein Skript ungewollt als Shortcut anzubieten. Genau das ist TYP.js
// passiert, dessen Kopfkommentar die Konvention beschreibt. Alle tatsächlich
// markierten Skripte schreiben den Marker ohnehin an den Zeilenanfang.
//
// "\b" hinter dem Markernamen verhindert, dass "@typ-shortcutXYZ" anschlägt,
// und stört die direkt folgende Klammer nicht (t -> ( ist eine Wortgrenze).
const SHORTCUT_MARKER = /^[ \t]*(?:\/\/+|\/\*+|\*)[ \t]*@typ-shortcut\b(?:\(([^)]*)\))?[ \t]*(.*?)[ \t]*(?:\*\/)?[ \t]*$/m;

// Parameternamen aus der Klammer des Markers, in Deklarationsreihenfolge.
// Leere Einträge (z. B. bei "()" oder einem überzähligen Komma) fallen weg;
// ein versehentlich doppelt genannter Name ergäbe zwei Eingabefelder, die
// beide denselben Eintrag schreiben, und bleibt deshalb nur einmal stehen.
function parseParams(raw) {
  const namen = (raw ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  return [...new Set(namen)];
}

// Hält die Liste der als Shortcut markierten Templater-Skripte aktuell.
//
// Die Liste wird vorab (asynchron) aus Templaters Skript-Ordner gelesen und bei
// Änderungen darin nachgeführt, statt sie erst beim Öffnen des Modals zu
// ermitteln - so ist sie dort ohne Wartezeit da, und das Modal bleibt frei von
// Dateizugriffen. Liefert einen Accessor auf die jeweils aktuelle Liste
// ([{ name, params, description }], nach Namen sortiert).
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
        // match[1] ist undefined, wenn gar keine Klammern dastehen, und "" bei
        // leeren Klammern - der Unterschied entscheidet über die Aufrufform.
        if (match) {
          found.push({
            name: file.basename,
            params: match[1] === undefined ? null : parseParams(match[1]),
            description: match[2] ?? "",
          });
        }
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

module.exports = { registerShortcutScripts, SHORTCUT_MARKER, parseParams };
