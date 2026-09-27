const { moment } = require("obsidian");

// Erkannte Platzhalter für Werte im TYP-Frontmatter eines TYPs (TYP-
// Detailansicht). Als reiner Text-Wert ins Frontmatter-Widget eingetragen
// (z. B. bei "Datum" als Wert "{{today}}" statt eines echten Datums) und erst
// beim Abruf über getTypeDefaults() aufgelöst (siehe main.js) - nicht schon
// beim Speichern, damit z. B. "{{today}}" bei jeder neu angelegten Notiz das
// dann aktuelle Datum liefert statt des Tages, an dem der Default gesetzt wurde.
const FRONTMATTER_PLACEHOLDERS = [
  {
    token: "{{today}}",
    description: "Heutiges Datum (JJJJ-MM-TT)",
    resolve: () => moment().format("YYYY-MM-DD"),
  },
  {
    token: "{{now}}",
    description: "Aktuelles Datum mit Uhrzeit (JJJJ-MM-TT HH:mm)",
    resolve: () => moment().format("YYYY-MM-DD HH:mm"),
  },
  {
    // Anders als {{today}}/{{now}} nicht der Aufrufzeitpunkt, sondern das
    // Erstellungsdatum der jeweiligen Datei (file.stat.ctime) - braucht daher
    // die Ziel-Datei als Kontext, siehe file-Parameter bei resolve() und
    // resolveFrontmatterPlaceholders() unten. Ohne Datei (z. B. Aufruf ohne
    // file-Option) Fallback auf den aktuellen Zeitpunkt.
    token: "{{created}}",
    description: "Erstellungsdatum der Datei (JJJJ-MM-TT)",
    resolve: (file) => moment(file?.stat?.ctime ?? Date.now()).format("YYYY-MM-DD"),
  },
];

// Dynamischer Platzhalter, z. B. "{{tp.waehleAutorVortrag}}" - ruft beim
// Anlegen einer Notiz das gleichnamige Templater-Skript (tp.user.<Skriptname>,
// siehe _obsidian/templater-scripts/) auf und übernimmt dessen Rückgabewert.
// Anders als die exakten Token oben hier NICHT auflösbar (das Plugin hat
// keinen Zugriff auf tp) - nur als Muster erkennbar, damit die Warnungs-
// Unterdrückung/Einfärbung im TYP-Frontmatter-Editor trotzdem greift.
// Die eigentliche Auflösung übernimmt TYP.js selbst, vor dem Schreiben ins
// Frontmatter (Aufruf- und Rückgabe-Konvention siehe dort bzw. README).
// Skriptname = Dateiname in templater-scripts/ ohne ".js", daher auch mit
// Umlauten, "-" oder Leerzeichen erlaubt - nur keine geschweiften Klammern.
const DYNAMIC_PLACEHOLDER_PATTERN = /^\{\{tp\.([^{}]*[^{}\s][^{}]*)\}\}$/;
const DYNAMIC_PLACEHOLDER_INFO = {
  token: "{{tp.<Skriptname>}}",
  description:
    "Ruft beim Anlegen tp.user.<Skriptname>(tp, newFile, ctx) auf – Rückgabe: Wert dieser Property, oder ein Objekt mit Werten für mehrere Properties des TYPs",
};

// Kopie von frontmatter mit aufgelösten Platzhaltern - nur exakte Werte
// (kein Ersetzen innerhalb eines längeren Strings), damit z. B. "{{today}}"
// als literaler Text in einem anderen Property unangetastet bleibt. Werte im
// dynamischen "{{tp.<Skriptname>}}"-Muster bleiben hier bewusst unangetastet,
// siehe Kommentar bei DYNAMIC_PLACEHOLDER_PATTERN. file (optional) wird an
// resolve() durchgereicht - nur von "{{created}}" genutzt, siehe oben.
function resolveFrontmatterPlaceholders(frontmatter, file) {
  const resolved = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    const placeholder = FRONTMATTER_PLACEHOLDERS.find((p) => p.token === value);
    resolved[key] = placeholder ? placeholder.resolve(file) : value;
  }
  return resolved;
}

function isPlaceholderToken(value) {
  if (typeof value !== "string") return false;
  if (FRONTMATTER_PLACEHOLDERS.some((p) => p.token === value)) return true;
  return DYNAMIC_PLACEHOLDER_PATTERN.test(value);
}

module.exports = {
  FRONTMATTER_PLACEHOLDERS,
  DYNAMIC_PLACEHOLDER_PATTERN,
  DYNAMIC_PLACEHOLDER_INFO,
  resolveFrontmatterPlaceholders,
  isPlaceholderToken,
};
