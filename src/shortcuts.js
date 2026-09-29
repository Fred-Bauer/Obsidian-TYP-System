const { moment } = require("obsidian");

// Ein Shortcut ist ein Verweis auf einen erst beim Anlegen einer Notiz
// berechneten Wert. Er steht bewusst NICHT im Frontmatter-Wert der Property,
// sondern daneben - in settings.typeShortcuts[TYP][key] für das TYP-Frontmatter
// bzw. im shortcuts-Objekt des jeweiligen Subtyp-Blocks (siehe subtypes.js):
//   { name: "today" }            - fester Token, hier im Plugin aufgelöst
//   { name: "tp.<Skriptname>" }  - Templater-Skript, nur von TYP.js auflösbar
//   { name: "tp.<Skriptname>", args: { ordner: "Literatur", jahr: 2024 } }
//     - dasselbe mit Argumenten. Die Parameternamen deklariert das Skript
//       selbst im @typ-shortcut-Marker (siehe shortcut-scripts.js); TYP.js
//       reicht das Objekt als ctx.args durch. Feste Token haben nie Argumente.
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
  const werte = Object.values(record.args ?? {}).filter((value) => value !== undefined);
  return werte.length > 0 ? `${record.name}: ${werte.join(", ")}` : record.name;
}

// Ein eingetipptes Argument in den Typ überführen, den es offensichtlich meint -
// damit ein Skript "5" als Zahl und "true" als Boolean bekommt, statt jedes
// Skript selbst casten zu lassen (wichtig z. B., wenn der Wert anschließend in
// einer als Zahl deklarierten Property landet). Bewusst diese wenigen, klar
// benannten Fälle statt JSON.parse: das würde bei "Literatur" ohnehin
// scheitern und bei '"a"' etwas anderes liefern, als dort steht. Ein leeres
// Feld heißt "nicht gesetzt" (undefined) und fällt aus dem Argument-Objekt
// heraus, damit ein Skript sauber mit "args.jahr ?? fallback" arbeiten kann.
function parseArgValue(raw) {
  const text = String(raw ?? "").trim();
  if (text === "") return undefined;
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return text;
}

// Namen, die in der Parameterliste eines Markers für Werte stehen, die das
// Plugin bzw. TYP.js selbst kennt - sie werden nicht abgefragt, sondern beim
// Aufruf eingesetzt:
//   newFile  die neu angelegte Notiz
//   ctx      der Kontext { typ, subtyp, key, werte, danach, args }
//   key      die Property, an der der Shortcut hängt. Erspart es, ihren Namen
//            als Argument zu wiederholen - ein Skript wie relation.js, das
//            sich seine Property sagen lässt, bekommt damit automatisch die
//            richtige, auch wenn derselbe Shortcut an einer anderen Zeile
//            sitzt.
// "tp" steht immer als erstes Argument und muss nicht deklariert werden; wird
// es trotzdem genannt, wird es übergangen, statt es ein zweites Mal zu
// übergeben.
const RESERVED_PARAMS = ["newFile", "ctx", "key"];

// Die Parameter, für die das Modal ein Eingabefeld zeigt: alles, was nicht
// reserviert ist. params === null (kein Klammerpaar am Marker) heißt
// "herkömmlicher Aufruf", also ebenfalls keine Felder.
function inputParams(params) {
  return (params ?? []).filter((name) => name !== "tp" && !RESERVED_PARAMS.includes(name));
}

// Eingaben (je Parametername ein Text) in das gespeicherte Argument-Objekt.
// params gibt die Reihenfolge vor, damit shortcutLabel() sie in der vom Skript
// deklarierten Folge anzeigt; leere Felder fehlen im Ergebnis ganz.
function buildArgs(params, eingaben) {
  const args = {};
  for (const name of inputParams(params)) {
    const value = parseArgValue(eingaben[name]);
    if (value !== undefined) args[name] = value;
  }
  return args;
}

// Aus der deklarierten Parameterliste die Argumente für den Aufruf
// f(tp, ...hier) bauen - aufgerufen von TYP.js, das als einziges newFile und
// ctx kennt.
//
// Ohne Klammern am Marker (params === null) bleibt es beim herkömmlichen
// Aufruf f(tp, newFile, ctx). Sonst wird die Liste Eintrag für Eintrag
// aufgelöst: reservierte Namen zu den übergebenen Werten, alle anderen zum
// eingetippten Argument.
//
// Ein Punkt-Name ("options.typ") beschreibt kein eigenes Argument, sondern ein
// FELD eines Objekt-Arguments: alle "options.*" sammeln sich zu einem einzigen
// Objekt an der Position ihres ersten Vorkommens. Damit lassen sich auch
// Skripte bedienen, deren Signatur ein Options-Objekt erwartet, ohne dass man
// JSON in ein Eingabefeld tippen müsste. Nur eine Ebene tief - bei "a.b.c"
// entstünde ein Feld, das wörtlich "b.c" heißt.
function resolveCallArgs(params, args, reserved = {}) {
  if (params === null || params === undefined) return [reserved.newFile, reserved.ctx];

  const werte = [];
  const objektPosition = new Map();
  for (const name of params) {
    if (name === "tp") continue;
    if (RESERVED_PARAMS.includes(name)) {
      werte.push(reserved[name]);
      continue;
    }
    const punkt = name.indexOf(".");
    if (punkt === -1) {
      werte.push(args?.[name]);
      continue;
    }
    const basis = name.slice(0, punkt);
    if (!objektPosition.has(basis)) {
      objektPosition.set(basis, werte.length);
      werte.push({});
    }
    const wert = args?.[name];
    if (wert !== undefined) werte[objektPosition.get(basis)][name.slice(punkt + 1)] = wert;
  }
  return werte;
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
  parseArgValue,
  buildArgs,
  inputParams,
  resolveCallArgs,
  RESERVED_PARAMS,
  resolveShortcuts,
};
