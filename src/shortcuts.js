const { moment } = require("obsidian");

// Ein Shortcut ist ein Verweis auf einen erst beim Anlegen einer Notiz
// berechneten Wert. Er steht bewusst NICHT im Frontmatter-Wert der Property,
// sondern daneben - in settings.typeShortcuts[TYP][key] für das TYP-Frontmatter
// bzw. im shortcuts-Objekt des jeweiligen Subtyp-Blocks (siehe subtypes.js):
//   { name: "today" }            - fester Token, hier im Plugin aufgelöst
//   { name: "tp.<Skriptname>" }  - Templater-Skript, nur von TYP.js auflösbar
//
// Warum daneben statt im Wert: Obsidians Property-Widget bestimmt das
// Eingabefeld einer Zeile aus dem in types.json deklarierten Typ der Property
// (getTypeInfo im gebauten app.js). Bei einer als "date"/"number"/"checkbox"
// deklarierten Property ist das ein <input type="date">, ein
// <input type="number"> bzw. ein Toggle - dort ließ sich ein Token wie
// "{{today}}" gar nicht erst eintippen, ein trotzdem gespeicherter Wert löste
// Obsidians "Type mismatch"-Warnung aus, und das Listen-Widget machte aus einem
// String beim ersten Bearbeiten stillschweigend ein Array (onChange(e.slice())).
// Alle diese Probleme haben dieselbe Ursache: ein Fremdkörper in einem Slot,
// dessen Datentyp Obsidian kontrolliert. Liegt der Shortcut daneben, bleibt der
// Wert typrein und das native Widget unangetastet - es braucht dafür keinerlei
// Eingriff in Obsidians Zeilen-Rendering.
//
// Der Frontmatter-Wert der Property bleibt dabei erhalten und dient als
// RÜCKFALLWERT: Schlägt das Templater-Skript fehl (fehlt oder wirft), schreibt
// TYP.js ihn statt eines leeren Werts (siehe getTypeShortcuts in main.js und
// die Auswertung in TYP.js). Ein Skript, das bewusst null/"" liefert - etwa bei
// ESC im Picker -, gilt dagegen nicht als Fehlschlag und lässt die Property leer.

// Die festen Token, die das Plugin selbst auflösen kann - ohne Templater und
// ohne tp-Zugriff, daher schon in getTypeDefaults() (main.js) eingesetzt. Erst
// beim Abruf aufgelöst, nicht beim Speichern, damit z. B. "today" bei jeder neu
// angelegten Notiz das dann aktuelle Datum liefert statt des Tages, an dem der
// Shortcut gesetzt wurde.
const FIXED_SHORTCUTS = [
  {
    name: "today",
    description: "Heutiges Datum (JJJJ-MM-TT)",
    resolve: () => moment().format("YYYY-MM-DD"),
  },
  {
    name: "now",
    description: "Aktuelles Datum mit Uhrzeit (JJJJ-MM-TT HH:mm)",
    resolve: () => moment().format("YYYY-MM-DD HH:mm"),
  },
  {
    // Anders als today/now nicht der Aufrufzeitpunkt, sondern das
    // Erstellungsdatum der jeweiligen Datei (file.stat.ctime) - braucht daher
    // die Ziel-Datei als Kontext (file-Parameter, von getTypeDefaults
    // durchgereicht). Ohne Datei Fallback auf den aktuellen Zeitpunkt.
    name: "created",
    description: "Erstellungsdatum der Datei (JJJJ-MM-TT)",
    resolve: (file) => moment(file?.stat?.ctime ?? Date.now()).format("YYYY-MM-DD"),
  },
];

// Skript-Shortcuts tragen diesen Präfix im name, damit ein Skript nie mit einem
// festen Token kollidieren kann - auch dann nicht, wenn jemand eine Datei
// "today.js" in den Templater-Skript-Ordner legt.
const SCRIPT_PREFIX = "tp.";

function findFixedShortcut(name) {
  return FIXED_SHORTCUTS.find((shortcut) => shortcut.name === name) ?? null;
}

// Skriptname eines "tp.<Skriptname>"-Shortcuts, sonst null. Skriptname =
// Dateiname in templater-scripts/ ohne ".js", daher auch mit Umlauten, "-"
// oder Leerzeichen erlaubt.
function scriptNameOf(name) {
  return typeof name === "string" && name.startsWith(SCRIPT_PREFIX) ? name.slice(SCRIPT_PREFIX.length) : null;
}

function isScriptShortcut(record) {
  return scriptNameOf(record?.name) !== null;
}

// Anzeigeform eines Shortcuts - in der Property-Zeile (Chip) und im Auswahl-
// Modal. Bewusst der nackte name ohne Zierrat: Früher stand der Shortcut als
// "{{today}}" im Wert der Property, die geschweiften Klammern waren dort die
// einzige Möglichkeit, ihn von einem festen Wert zu unterscheiden. Beides ist
// weg - gespeichert wird { name }, TYP.js bekommt Struktur statt Text (siehe
// getTypeShortcuts in main.js), und den Unterschied zum festen Wert macht jetzt
// der Chip selbst samt Akzentfarbe. Die Klammern bildeten also nichts mehr ab.
function shortcutLabel(record) {
  if (!record?.name) return "";
  const args = record.args ?? [];
  return args.length > 0 ? `${record.name}: ${args.join(", ")}` : record.name;
}

// Ob die Property laut types.json (bzw., falls dort nicht gesetzt, laut ihrer
// bisherigen Verwendung im Vault) eine Liste ist - dann wird ein aufgelöster
// Shortcut-Wert einelementig eingepackt, damit der gelieferte Wert zum
// deklarierten Typ der Property passt. Ohne app (z. B. in Tests) wie bisher
// ohne Einpacken.
function isListProperty(app, key) {
  return app?.metadataTypeManager?.getTypeInfo?.(key)?.expected?.type === "multitext";
}

// Kopie von frontmatter, in der jeder Key mit Shortcut seinen berechneten Wert
// trägt:
//   - fester Token -> aufgelöst (bei einer Listen-Property einelementig
//     eingepackt),
//   - "tp.<Skript>" -> null; nur Templater kann das auflösen, TYP.js holt sich
//     diese Keys über getTypeShortcuts() und setzt sie selbst ein.
// Keys ohne Shortcut bleiben unverändert - ebenso der Wert eines Keys MIT
// Shortcut in den Settings selbst: er bleibt dort als Rückfallwert stehen (siehe
// Kommentar oben) und wird hier nur überschrieben, nicht gelöscht.
function resolveShortcuts(frontmatter, shortcuts, { file, app } = {}) {
  const resolved = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    const record = shortcuts?.[key];
    const fixed = record ? findFixedShortcut(record.name) : null;
    if (fixed) {
      const result = fixed.resolve(file);
      resolved[key] = isListProperty(app, key) ? [result] : result;
    } else if (isScriptShortcut(record)) {
      resolved[key] = null;
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

module.exports = {
  FIXED_SHORTCUTS,
  SCRIPT_PREFIX,
  findFixedShortcut,
  scriptNameOf,
  isScriptShortcut,
  shortcutLabel,
  resolveShortcuts,
};
