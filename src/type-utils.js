// Von typ-view.js UND subtyp-view.js genutzte, reine Hilfsfunktionen ohne
// eigenen State - ausgelagert, damit beide Module sie nutzen können, ohne
// dass eines das jeweils andere require()n muss (typ-view.js bindet
// SubtypPane aus subtyp-view.js ein; ein Require in die Gegenrichtung wäre
// ein zyklischer require, der je nach Ladereihenfolge ein unvollständiges
// module.exports-Objekt liefern könnte).

// TYPen UND SUBTYPen werden ausschließlich in Großbuchstaben angelegt/
// umbenannt - beim Anlegen wie beim Umbenennen. Betrifft nur über die
// jeweilige Liste getippte Namen, nicht Werte, die z. B. direkt im
// Frontmatter einer Notiz in Kleinschreibung stehen (siehe "unregistrierte"
// Zeilen in typ-view.js/subtyp-view.js).
function normalizeTypeName(raw) {
  return raw.trim().toUpperCase();
}

// Farbton (0-360°) aus einem Hex-Code, für die Sortierung nach Farbspektrum
// statt nach Hex-String. Rot liegt bei 0°/360° (Kreis) - aufsteigend beginnt
// die Sortierung damit bei Rot, läuft über Orange/Gelb/Grün/Cyan/Blau/Magenta
// und landet wieder bei Rot. Achromatische Farben (Grau/Schwarz/Weiß, delta=0)
// haben keinen definierten Farbton - dafür liefert diese Funktion null, damit
// compareTypes sie unabhängig von der Sortierrichtung ans Ende stellen kann.
function hexToHue(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!match) return null;
  const int = parseInt(match[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return null;

  let hue;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue *= 60;
  return hue < 0 ? hue + 360 : hue;
}

// Gemeinsame Sortierlogik für TYP- und SUBTYP-Listen. typeColors darf ein
// leeres Objekt sein (SUBTYP hat keine eigene Farbe) - der "color"-Modus wird
// dort schlicht nie ausgewählt.
function compareTypes(mode, a, b, counts, typeColors) {
  const [key, dir] = mode.split("-");
  let cmp;
  if (key === "count") {
    cmp = (counts.get(a) ?? 0) - (counts.get(b) ?? 0);
    if (dir === "desc") cmp = -cmp;
  } else if (key === "color") {
    const hueA = hexToHue(typeColors[a] ?? null);
    const hueB = hexToHue(typeColors[b] ?? null);
    // Achromatische Farben bleiben immer am Ende, egal ob auf- oder absteigend
    // sortiert wird - nur die Reihenfolge innerhalb der echten Farbtöne dreht sich um.
    if (hueA === null && hueB === null) cmp = 0;
    else if (hueA === null) cmp = 1;
    else if (hueB === null) cmp = -1;
    else {
      cmp = hueA - hueB;
      if (dir === "desc") cmp = -cmp;
    }
  } else {
    cmp = a.localeCompare(b);
    if (dir === "desc") cmp = -cmp;
  }
  return cmp || a.localeCompare(b);
}

// Wendet den aktuellen Sortiermodus auf eine Liste von TYPen an. Sonderfall
// "manual" (siehe SORT_OPTIONS in typ-view.js): dort bleibt bewusst die
// übergebene Reihenfolge selbst erhalten, statt sie zu sortieren - sie IST in
// diesem Modus die gespeicherte Sortierung (plugin.settings.types, per Drag &
// Drop in typ-view.js verschoben). Ein Vergleich zweier TYPen könnte diese
// Reihenfolge nicht herleiten, compareTypes bleibt daher unangetastet. Von
// main.js (getTypes(), für Templater/Picker) UND typ-view.js genutzt, damit
// beide dieselbe Reihenfolge zeigen.
function sortTypesByMode(types, mode, counts, typeColors) {
  if (mode === "manual") return [...types];
  return [...types].sort((a, b) => compareTypes(mode, a, b, counts, typeColors));
}

module.exports = { normalizeTypeName, hexToHue, compareTypes, sortTypesByMode };
