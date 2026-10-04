// Stateless helpers around TYP names, sorting and message text.

// TYP names typed into the list are always uppercase. Values written directly
// into a note's frontmatter are left alone (see the unregistered rows in
// typ-pane.js).
function normalizeTypName(raw) {
  return raw.trim().toUpperCase();
}

// "1 note", "3 notes". word is the English singular; irregular plurals are
// passed explicitly.
function plural(count, word, pluralWord = `${word}s`) {
  return `${count} ${count === 1 ? word : pluralWord}`;
}

// "a", "a and b", "a, b and c".
function joinAnd(parts) {
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// Key hints at the bottom of a picker, worded like those of Obsidian's own
// suggesters. escPurpose: the Subtyp-Picker says "to go back", since ESC there
// returns to the TYP choice.
function pickerInstructions(escPurpose = "to cancel") {
  return [
    { command: "↑↓", purpose: "to navigate" },
    { command: "↵", purpose: "to choose" },
    { command: "esc", purpose: escPurpose },
  ];
}

// Hue (0-360°) of a hex color, so colors sort along the spectrum instead of by
// hex string. Achromatic colors (gray/black/white) have no hue and return null;
// compareTyps keeps them last in both directions.
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

// Shared comparison for TYP and SUBTYP lists. typColors may be empty (a Subtyp
// has no color of its own); the "color" mode is then never selected.
function compareTyps(mode, a, b, counts, typColors) {
  const [key, dir] = mode.split("-");
  let cmp;
  if (key === "count") {
    cmp = (counts.get(a) ?? 0) - (counts.get(b) ?? 0);
    if (dir === "desc") cmp = -cmp;
  } else if (key === "color") {
    const hueA = hexToHue(typColors[a] ?? null);
    const hueB = hexToHue(typColors[b] ?? null);
    // Achromatic colors stay at the end in both directions.
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

// "manual" keeps the given order: it is the stored order (settings.typs,
// rearranged by drag & drop), which no pairwise comparison could derive.
// Used by main.js (getTyps) and typ-pane.js so both show the same order.
function sortTypsByMode(typs, mode, counts, typColors) {
  if (mode === "manual") return [...typs];
  return [...typs].sort((a, b) => compareTyps(mode, a, b, counts, typColors));
}

module.exports = { normalizeTypName, plural, joinAnd, pickerInstructions, hexToHue, compareTyps, sortTypsByMode };
