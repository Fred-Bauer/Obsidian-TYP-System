const { moveTypSubtyps, deleteTypSubtyps, mergeTypSubtyps, mergeBlockInto, blockHasProperties, getSubtypNames } = require("./subtyps");

// The per-TYP tables of the settings, each keyed by TYP name - the one list
// that renaming, merging and deleting a TYP go through, so a table added later
// can't be forgotten in one of them. typSubtyps is handled separately (see
// subtyps.js): a merge combines Subtyp blocks instead of dropping them.
// typManual may be missing in older settings, so a table is only created when
// there is something to move into it.
const TYP_SETTING_TABLES = [
  "typColors",
  "typDescriptions",
  "typDefaultFrontmatter",
  "typFloatingKeys",
  "typShortcuts",
  "typManual",
];

// Renaming in the settings: the TYP keeps its place in settings.typs (the
// manual order), every table entry and the Subtyps move to the new name.
function moveTypSettings(settings, from, to) {
  const index = settings.typs.indexOf(from);
  if (index !== -1) settings.typs[index] = to;
  for (const table of TYP_SETTING_TABLES) {
    if (settings[table]?.[from] === undefined) continue;
    settings[table] ??= {};
    settings[table][to] = settings[table][from];
    delete settings[table][from];
  }
  moveTypSubtyps(settings, from, to);
}

// Removes the TYP from the list and from every table, Subtyps included.
function deleteTypSettings(settings, typ) {
  settings.typs = settings.typs.filter((t) => t !== typ);
  for (const table of TYP_SETTING_TABLES) {
    if (settings[table]) delete settings[table][typ];
  }
  deleteTypSubtyps(settings, typ);
}

// Merging source into target in the settings: source's TYP-Frontmatter goes
// to the end of target's (same rule as two Subtyp blocks, see mergeBlockInto -
// target wins per key), its Subtyps move over (mergeTypSubtyps), and the rest
// of source (color, description, manual toggle, list position) goes like a
// deleted TYP. Notes are not touched here - see mergeTyp/mergeTypSettingsOnly
// in typ-pane.js.
function mergeTypSettings(settings, source, target) {
  for (const table of ["typDefaultFrontmatter", "typFloatingKeys", "typShortcuts"]) settings[table] ??= {};
  const merged = {
    frontmatter: settings.typDefaultFrontmatter[target] ?? {},
    floatingKeys: settings.typFloatingKeys[target] ?? [],
    shortcuts: settings.typShortcuts[target] ?? {},
  };
  mergeBlockInto(merged, {
    frontmatter: settings.typDefaultFrontmatter[source] ?? {},
    floatingKeys: settings.typFloatingKeys[source] ?? [],
    shortcuts: settings.typShortcuts[source] ?? {},
  });
  // Stored like the TYP-Frontmatter editor does it: empty tables leave no entry.
  if (Object.keys(merged.frontmatter).length > 0) settings.typDefaultFrontmatter[target] = merged.frontmatter;
  if (merged.floatingKeys.length > 0) settings.typFloatingKeys[target] = merged.floatingKeys;
  if (Object.keys(merged.shortcuts).length > 0) settings.typShortcuts[target] = merged.shortcuts;

  mergeTypSubtyps(settings, source, target);
  deleteTypSettings(settings, source);
}

// Whether merging typ into another TYP moves anything: TYP-Frontmatter
// properties or Subtyps (even empty ones - they become Subtyps of the target).
function typHasMergeableSettings(settings, typ) {
  return blockHasProperties(settings.typDefaultFrontmatter?.[typ]) || getSubtypNames(settings, typ).length > 0;
}

module.exports = { TYP_SETTING_TABLES, moveTypSettings, deleteTypSettings, mergeTypSettings, typHasMergeableSettings };
