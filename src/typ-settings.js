const { moveTypSubtyps, deleteTypSubtyps } = require("./subtyps");

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

module.exports = { TYP_SETTING_TABLES, moveTypSettings, deleteTypSettings };
