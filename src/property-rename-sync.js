const { Notice } = require("obsidian");
const { typeStore, subtypeStore } = require("./type-frontmatter-editor");
const { getSubtypeNames, isEmptyValue } = require("./subtypes");

const TYP_PROPERTY = "TYP";
const SUBTYP_PROPERTY = "SUBTYP";

// Obsidian schreibt Property-Namen intern klein (siehe frontmatter-default-
// highlight.js) - Zuordnung daher case-insensitiv, der neue Name wird aber
// exakt so übernommen, wie er eingegeben wurde.
function sameKey(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

// Benennt oldKey in einem Frontmatter-Block (TYP oder Subtyp, siehe
// typeStore/subtypeStore in type-frontmatter-editor.js) um (Reihenfolge bleibt
// erhalten) und zieht die Floating-Markierung mit. Gibt es newKey dort bereits
// (Zusammenlegen, analog zu Obsidians eigenem Merge in den Notizen), bleibt der
// bestehende Eintrag an seiner Position - der Wert des alten Eintrags wird nur
// übernommen, wenn der bestehende leer ist. Liefert true bei einer Änderung.
function renameInStore(store, oldKey, newKey) {
  const defaults = store.getFrontmatter();
  const keys = Object.keys(defaults);
  const sourceKey = keys.find((key) => sameKey(key, oldKey));
  if (sourceKey === undefined) return false;
  // Bei einer reinen Änderung der Groß-/Kleinschreibung ist sourceKey selbst
  // der einzige Treffer für newKey - das ist dann kein Zusammenlegen.
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
    // Beim Zusammenlegen bleibt die Floating-Markierung des Ziels maßgeblich.
    store.setFloating(
      targetKey !== undefined
        ? floating.filter((key) => key !== sourceKey)
        : floating.map((key) => (key === sourceKey ? newKey : key))
    );
  }

  // Der Shortcut hängt am Key (siehe shortcuts.js) und wandert deshalb mit der
  // Umbenennung mit - beim Zusammenlegen bleibt, wie bei Floating, der des
  // Ziels maßgeblich.
  const shortcuts = { ...store.getShortcuts() };
  if (shortcuts[sourceKey]) {
    if (targetKey === undefined) shortcuts[newKey] = shortcuts[sourceKey];
    delete shortcuts[sourceKey];
    store.setShortcuts(shortcuts);
  }
  return true;
}

// Einzel-Property-Einträge der globalen Reihenfolge - dort sind keine
// Dopplungen erlaubt, ein bereits vorhandener Zieleintrag behält daher seine
// Position und der alte entfällt.
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
  // TYP/SUBTYP sind nie Teil eines Frontmatter-Blocks (siehe stripTypProperty
  // in type-frontmatter-editor.js) - ein Umbenennen von/nach TYP/SUBTYP daher
  // ignorieren.
  if ([oldKey, newKey].some((key) => sameKey(key, TYP_PROPERTY) || sameKey(key, SUBTYP_PROPERTY))) return;

  const { settings } = plugin;
  let typeCount = 0;
  let subtypeCount = 0;
  const count = (store) => (store.subtype ? subtypeCount++ : typeCount++);
  const types = new Set([...Object.keys(settings.typeDefaultFrontmatter), ...Object.keys(settings.typeSubtypes ?? {})]);
  for (const type of types) {
    const stores = [typeStore(plugin, type), ...getSubtypeNames(settings, type).map((subtype) => subtypeStore(plugin, type, subtype))];

    // Eine vault-weite Umbenennung schlägt auf JEDEN Block durch, in dem der
    // Key steht - derselbe Key darf blockübergreifend mehrfach vorkommen
    // (siehe Kommentar an typeSubtypes in subtypes.js). Nur INNERHALB eines
    // Blocks kann der neue Name kollidieren; dort legt renameInStore die
    // beiden wie bisher zusammen.
    for (const store of stores) {
      if (renameInStore(store, oldKey, newKey)) count(store);
    }
  }
  const orderChanged = renameInGlobalOrder(settings, oldKey, newKey);
  if (typeCount === 0 && subtypeCount === 0 && !orderChanged) return;

  await plugin.saveSettings();
  plugin.refreshTypColors?.();

  const parts = [];
  if (typeCount > 0) parts.push(`${typeCount} TYP${typeCount === 1 ? "" : "en"}`);
  if (subtypeCount > 0) parts.push(`${subtypeCount} Subtyp${subtypeCount === 1 ? "" : "en"}`);
  if (orderChanged) parts.push("globaler Reihenfolge");
  new Notice(`TYP-System: „${oldKey}“ → „${newKey}“ in ${parts.join(" und ")} umbenannt.`);
}

// Obsidians "All properties"-Ansicht (acceptRename) und Bases (Namensfeld einer
// neu angelegten Notiz-Property) benennen Properties vault-weit ausschließlich
// über app.fileManager.renameProperty(alt, neu) um (siehe gebautes app.js) -
// ein Wrapper genau dort erfasst also jede echte Umbenennung, ohne die
// jeweiligen Views selbst anfassen zu müssen. Bases' "Display name" für
// bestehende Properties ändert nur die .base-Datei, nicht die Notizen, und
// läuft deshalb (richtigerweise) nicht hier durch.
function registerPropertyRenameSync(plugin) {
  const fileManager = plugin.app.fileManager;
  if (fileManager.__fredTypRenameSyncPatched) return;
  fileManager.__fredTypRenameSyncPatched = true;

  const original = fileManager.renameProperty;
  fileManager.renameProperty = async function (oldKey, newKey, ...rest) {
    // Wirft das Original (acceptRename fängt das selbst ab), bleiben die
    // Plugin-Einstellungen unverändert.
    const result = await original.call(this, oldKey, newKey, ...rest);
    try {
      await syncRename(plugin, oldKey, newKey);
    } catch (error) {
      console.error("TYP-System: Property-Umbenennung nicht übernommen", error);
      new Notice(`TYP-System: Umbenennung von „${oldKey}“ nicht übernommen – ${error.message}`);
    }
    return result;
  };

  plugin.register(() => {
    fileManager.renameProperty = original;
    delete fileManager.__fredTypRenameSyncPatched;
  });
}

module.exports = { registerPropertyRenameSync };
