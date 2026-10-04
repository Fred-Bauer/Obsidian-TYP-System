const { typKeyOf, propertyValue, SUBTYP_PROPERTY } = require("./typ-index");
const { editFrontmatter } = require("./frontmatter-text");

// Subtyp names are title case per word (unlike TYP names, see
// normalizeTypName): "kurz GESCHICHTE" -> "Kurz Geschichte". The SUBTYP
// property itself stays uppercase. "de" locale because the names are German.
function normalizeSubtypName(raw) {
  return raw.trim().replace(/\S+/g, (word) => word.charAt(0).toLocaleUpperCase("de") + word.slice(1).toLocaleLowerCase("de"));
}

// Registered Subtyps per TYP (settings.typSubtyps):
//   { [TYP]: { [SUBTYP]: { frontmatter: {...}, floatingKeys: [...], shortcuts: {...}, manual?: false } } }
// A Subtyp belongs to exactly one TYP, though the same name may also exist
// under another TYP. Key order is the block order in the TYP-Pane, always
// below the TYP-Frontmatter. frontmatter adds to or overrides the
// TYP-Frontmatter; floatingKeys and shortcuts work like typFloatingKeys and
// typShortcuts. Older data lacks shortcuts, so readers treat it as optional.
// manual works like typManual: only the deviation (false) is stored.
//
// The same key may appear in several blocks of one TYP (only within ONE block
// is it necessarily unique):
//   - in two Subtyp blocks: no conflict, a note has at most one SUBTYP;
//   - in the TYP-Frontmatter AND a Subtyp block: the Subtyp overrides value
//     and floating flag, the row keeps the TYP-Frontmatter position. getTypDefaults
//     (main.js) and orderedDefaultKeys (frontmatter-sort.js) must use the same
//     rule, or sorting would re-sort a freshly created note right away.

// "Still to be filled": when two blocks or two properties merge, such a value
// is filled from the other instead of overwriting the existing entry (see
// mergeSubtyps here and renameInStore in property-rename-sync.js).
function isEmptyValue(value) {
  return value === null || value === undefined || value === "";
}

function getSubtypNames(settings, typ) {
  return Object.keys(settings.typSubtyps?.[typ] ?? {});
}

function getSubtyp(settings, typ, subtyp) {
  return settings.typSubtyps?.[typ]?.[subtyp] ?? null;
}

function ensureSubtyp(settings, typ, subtyp) {
  if (!settings.typSubtyps) settings.typSubtyps = {};
  if (!settings.typSubtyps[typ]) settings.typSubtyps[typ] = {};
  const byName = settings.typSubtyps[typ];
  if (!byName[subtyp]) {
    byName[subtyp] = { frontmatter: {}, floatingKeys: [], shortcuts: {} };
    // A new Subtyp of a TYP that isn't manually creatable isn't either (see
    // isSubtypManual).
    if (settings.typManual?.[typ] === false) byName[subtyp].manual = false;
  }
  return byName[subtyp];
}

/* --- "Manually creatable" per Subtyp ------------------------------------
 * Like typManual for TYP entries: only switching off is stored
 * (manual: false); no entry or true means on. Decides whether the Subtyp
 * shows up in getSubtyps() (main.js) and thus in the Subtyp-Picker.
 *
 * TYP and Subtyp are linked, because the picker only reaches a Subtyp through
 * its TYP: switching a TYP off switches all its Subtyps off, switching it on
 * switches them all on (setAllSubtypsManual), and switching a single Subtyp on
 * also switches its TYP on, leaving the other Subtyps alone (see
 * renderSubtypManualToggle in typ-pane.js). So a Subtyp is only ever manually
 * creatable if its TYP is.
 * --------------------------------------------------------------------- */
function isSubtypManual(settings, typ, subtyp) {
  return getSubtyp(settings, typ, subtyp)?.manual !== false;
}

function setSubtypManual(settings, typ, subtyp, on) {
  const data = getSubtyp(settings, typ, subtyp);
  if (!data) return;
  if (on) delete data.manual;
  else data.manual = false;
}

function setAllSubtypsManual(settings, typ, on) {
  for (const subtyp of getSubtypNames(settings, typ)) setSubtypManual(settings, typ, subtyp, on);
}

// When a TYP is renamed, its Subtyps move to the new name.
function moveTypSubtyps(settings, oldTyp, newTyp) {
  if (!settings.typSubtyps?.[oldTyp]) return;
  settings.typSubtyps[newTyp] = settings.typSubtyps[oldTyp];
  delete settings.typSubtyps[oldTyp];
}

function deleteTypSubtyps(settings, typ) {
  if (settings.typSubtyps) delete settings.typSubtyps[typ];
}

// Merging two TYP entries: Subtyps only in source move over. Blocks with the
// same name are combined - for a shared key the target's value and floating
// flag win, keys only in source are appended. A moved key that is also in the
// target's TYP-Frontmatter stays in both, which is the normal override.
function mergeTypSubtyps(settings, source, target) {
  const sourceSubtyps = settings.typSubtyps?.[source];
  if (!sourceSubtyps) return;
  for (const [name, sourceData] of Object.entries(sourceSubtyps)) {
    const targetData = getSubtyp(settings, target, name);
    if (!targetData) {
      ensureSubtyp(settings, target, name);
      settings.typSubtyps[target][name] = sourceData;
      continue;
    }
    const targetLower = new Set(Object.keys(targetData.frontmatter).map((key) => key.toLowerCase()));
    for (const [key, value] of Object.entries(sourceData.frontmatter)) {
      if (key === "" || targetLower.has(key.toLowerCase())) continue;
      targetData.frontmatter[key] = value;
      if (sourceData.floatingKeys.includes(key)) targetData.floatingKeys.push(key);
      // The shortcut belongs to the key and moves with it.
      const shortcut = sourceData.shortcuts?.[key];
      if (shortcut) (targetData.shortcuts ??= {})[key] = shortcut;
    }
  }
  delete settings.typSubtyps[source];
}

// Renames a Subtyp within its TYP; the block keeps its position (display
// order = key order).
function renameSubtyp(settings, typ, oldName, newName) {
  const byName = settings.typSubtyps?.[typ];
  if (!byName?.[oldName] || oldName === newName) return;
  settings.typSubtyps[typ] = Object.fromEntries(
    Object.entries(byName).map(([name, data]) => [name === oldName ? newName : name, data])
  );
}

// Order of all blocks of a TYP, null = TYP-Frontmatter (always first), then
// the Subtyps in key order. Drives the TYP-Pane as well as frontmatter
// sorting (see orderedDefaultKeys).
function getSectionOrder(settings, typ) {
  return [null, ...getSubtypNames(settings, typ)];
}

// New block order from drag & drop in the TYP-Pane, shaped like
// getSectionOrder; the leading null is ignored (the TYP-Frontmatter can't
// move). Subtyps not listed stay at the end.
function reorderSubtyps(settings, typ, order) {
  const byName = settings.typSubtyps?.[typ];
  if (!byName) return;
  const names = order.filter((name) => name !== null && byName[name]);
  const ordered = [...names, ...Object.keys(byName).filter((name) => !names.includes(name))];
  settings.typSubtyps[typ] = Object.fromEntries(ordered.map((name) => [name, byName[name]]));
}

function deleteSubtyp(settings, typ, name) {
  const byName = settings.typSubtyps?.[typ];
  if (!byName) return;
  delete byName[name];
  if (Object.keys(byName).length === 0) delete settings.typSubtyps[typ];
}

// Merging two Subtyps of one TYP: source's properties go to the end of the
// target block, source disappears. If the target already has a key, it keeps
// position, value and floating flag; only an empty target value is filled
// from source (same pattern as renameInStore in property-rename-sync.js).
function mergeSubtyps(settings, typ, source, target) {
  const sourceData = getSubtyp(settings, typ, source);
  const targetData = getSubtyp(settings, typ, target);
  if (!sourceData || !targetData || source === target) return;

  const targetKeys = new Map(Object.keys(targetData.frontmatter).map((key) => [key.toLowerCase(), key]));
  for (const [key, value] of Object.entries(sourceData.frontmatter)) {
    if (key === "") continue;
    const existing = targetKeys.get(key.toLowerCase());
    if (existing === undefined) {
      targetData.frontmatter[key] = value;
      targetKeys.set(key.toLowerCase(), key);
      if (sourceData.floatingKeys.includes(key) && !targetData.floatingKeys.includes(key)) targetData.floatingKeys.push(key);
      // The shortcut belongs to the key and moves with it.
      const shortcut = sourceData.shortcuts?.[key];
      if (shortcut) (targetData.shortcuts ??= {})[key] = shortcut;
    } else if (isEmptyValue(targetData.frontmatter[existing])) {
      targetData.frontmatter[existing] = value;
    }
  }
  deleteSubtyp(settings, typ, source);
}

// Rewrites the SUBTYP of every note with TYP key `typ` and SUBTYP key oldKey
// to the single value newValue - like renameTypInNotes() in typ-pane.js,
// comment-preserving too. Returns { changed, skipped }.
async function renameSubtypInNotes(plugin, typ, oldKey, newValue) {
  let changed = 0;
  let skipped = 0;
  for (const file of plugin.typIndex.filesWithSubtyp(typ, oldKey)) {
    const { status } = await editFrontmatter(plugin.app, file, (doc) => {
      if (typKeyOf(propertyValue(doc.toObject(), SUBTYP_PROPERTY)) !== oldKey) return;
      doc.set(SUBTYP_PROPERTY, newValue);
    });
    if (status === "changed") changed++;
    else if (status === "skipped") skipped++;
  }
  return { changed, skipped };
}

module.exports = {
  normalizeSubtypName,
  isEmptyValue,
  getSubtypNames,
  getSubtyp,
  ensureSubtyp,
  isSubtypManual,
  setSubtypManual,
  setAllSubtypsManual,
  moveTypSubtyps,
  deleteTypSubtyps,
  mergeTypSubtyps,
  renameSubtyp,
  getSectionOrder,
  reorderSubtyps,
  deleteSubtyp,
  mergeSubtyps,
  renameSubtypInNotes,
};
