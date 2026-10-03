const { Notice } = require("obsidian");
const { typStore, subtypStore } = require("./typ-frontmatter-editor");
const { getSubtypNames, isEmptyValue } = require("./subtyps");
const { plural, joinAnd } = require("./typ-utils");
const { TYP_PROPERTY, SUBTYP_PROPERTY } = require("./typ-index");

// Obsidian lowercases property names internally, so matching ignores case;
// the new name is kept exactly as typed.
function sameKey(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

// Renames oldKey in one frontmatter block (TYP or Subtyp, see typStore/
// subtypStore in typ-frontmatter-editor.js), keeping its position, and moves
// the floating flag along. If newKey already exists there (a merge, like
// Obsidian's own merge in the notes), the existing entry keeps its position
// and only takes the old value if its own is empty. Returns true on a change.
function renameInStore(store, oldKey, newKey) {
  const defaults = store.getFrontmatter();
  const keys = Object.keys(defaults);
  const sourceKey = keys.find((key) => sameKey(key, oldKey));
  if (sourceKey === undefined) return false;
  // A pure change of case finds sourceKey itself for newKey - not a merge.
  const targetKey = keys.find((key) => key !== sourceKey && sameKey(key, newKey));
  if (targetKey === undefined && sourceKey === newKey) return false;

  const next = {};
  for (const key of keys) {
    if (key !== sourceKey) {
      next[key] = defaults[key];
    } else if (targetKey === undefined) {
      next[newKey] = defaults[sourceKey];
    }
  }
  if (targetKey !== undefined && isEmptyValue(next[targetKey])) next[targetKey] = defaults[sourceKey];
  store.setFrontmatter(next);

  const floating = store.getFloating();
  if (floating.length > 0) {
    // On a merge the target's floating flag wins.
    store.setFloating(
      targetKey !== undefined
        ? floating.filter((key) => key !== sourceKey)
        : floating.map((key) => (key === sourceKey ? newKey : key))
    );
  }

  // The shortcut belongs to the key and moves with it; on a merge the
  // target's wins, as with floating.
  const shortcuts = { ...store.getShortcuts() };
  if (shortcuts[sourceKey]) {
    if (targetKey === undefined) shortcuts[newKey] = shortcuts[sourceKey];
    delete shortcuts[sourceKey];
    store.setShortcuts(shortcuts);
  }
  return true;
}

// Pinned entries of the global order allow no duplicates, so an existing
// target entry keeps its position and the old one goes.
function renameInGlobalOrder(settings, oldKey, newKey) {
  const order = settings.globalPropertyOrder;
  const source = order.find((entry) => entry.kind === "property" && sameKey(entry.name, oldKey));
  if (!source) return false;
  const target = order.find((entry) => entry !== source && entry.kind === "property" && sameKey(entry.name, newKey));
  if (target) settings.globalPropertyOrder = order.filter((entry) => entry !== source);
  else if (source.name === newKey) return false;
  else source.name = newKey;
  return true;
}

async function syncRename(plugin, oldKey, newKey) {
  if (typeof oldKey !== "string" || typeof newKey !== "string") return;
  newKey = newKey.trim();
  if (oldKey === "" || newKey === "" || oldKey === newKey) return;
  // TYP/SUBTYP are never part of a block (see stripTypProperty in
  // typ-frontmatter-editor.js), so renames from or to them are ignored.
  if ([oldKey, newKey].some((key) => sameKey(key, TYP_PROPERTY) || sameKey(key, SUBTYP_PROPERTY))) return;

  const { settings } = plugin;
  let typCount = 0;
  let subtypCount = 0;
  const count = (store) => (store.subtyp ? subtypCount++ : typCount++);
  const typs = new Set([...Object.keys(settings.typDefaultFrontmatter), ...Object.keys(settings.typSubtyps ?? {})]);
  for (const typ of typs) {
    const stores = [typStore(plugin, typ), ...getSubtypNames(settings, typ).map((subtyp) => subtypStore(plugin, typ, subtyp))];

    // A vault-wide rename hits EVERY block holding the key - the same key may
    // appear in several blocks (see typSubtyps in subtyps.js). Only within one
    // block can the new name collide; renameInStore merges the two there.
    for (const store of stores) {
      if (renameInStore(store, oldKey, newKey)) count(store);
    }
  }
  const orderChanged = renameInGlobalOrder(settings, oldKey, newKey);
  if (typCount === 0 && subtypCount === 0 && !orderChanged) return;

  await plugin.saveSettings();
  plugin.refreshTypColors?.();

  const parts = [];
  if (typCount > 0) parts.push(plural(typCount, "TYP block"));
  if (subtypCount > 0) parts.push(plural(subtypCount, "Subtyp block"));
  if (orderChanged) parts.push("the global order");
  new Notice(`TYP-System: renamed "${oldKey}" → "${newKey}" in ${joinAnd(parts)}.`);
}

// Obsidian's "All properties" view and Bases (naming a new note property)
// rename properties vault-wide only through app.fileManager.renameProperty,
// so wrapping that one method catches every real rename. Bases' "Display
// name" only changes the .base file, not the notes, and rightly doesn't pass
// through here.
function registerPropertyRenameSync(plugin) {
  const fileManager = plugin.app.fileManager;
  if (fileManager.__typSystemRenameSyncPatched) return;
  fileManager.__typSystemRenameSyncPatched = true;

  const original = fileManager.renameProperty;
  fileManager.renameProperty = async function (oldKey, newKey, ...rest) {
    // If the original throws (acceptRename handles that), settings stay as
    // they are.
    const result = await original.call(this, oldKey, newKey, ...rest);
    try {
      await syncRename(plugin, oldKey, newKey);
    } catch (error) {
      console.error("TYP-System: property rename not applied", error);
      new Notice(`TYP-System: rename of "${oldKey}" not applied – ${error.message}`);
    }
    return result;
  };

  plugin.register(() => {
    fileManager.renameProperty = original;
    delete fileManager.__typSystemRenameSyncPatched;
  });
}

module.exports = { registerPropertyRenameSync };
