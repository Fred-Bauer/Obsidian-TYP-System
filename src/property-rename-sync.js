const { Notice } = require("obsidian");

const TYP_PROPERTY = "TYP";

// Obsidian schreibt Property-Namen intern klein (siehe frontmatter-default-
// highlight.js) - Zuordnung daher case-insensitiv, der neue Name wird aber
// exakt so übernommen, wie er eingegeben wurde.
function sameKey(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

function isEmptyValue(value) {
  return value === null || value === undefined || value === "";
}

// Benennt oldKey in typeDefaultFrontmatter[type] um (Reihenfolge bleibt
// erhalten) und zieht die Floating-Markierung mit. Gibt es newKey dort bereits
// (Zusammenlegen, analog zu Obsidians eigenem Merge in den Notizen), bleibt der
// bestehende Eintrag an seiner Position - der Wert des alten Eintrags wird nur
// übernommen, wenn der bestehende leer ist. Liefert true bei einer Änderung.
function renameInType(settings, type, oldKey, newKey) {
  const defaults = settings.typeDefaultFrontmatter[type];
  if (!defaults) return false;
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
  settings.typeDefaultFrontmatter[type] = next;

  const floating = settings.typeFloatingKeys[type];
  if (floating) {
    // Beim Zusammenlegen bleibt die Floating-Markierung des Ziels maßgeblich.
    const nextFloating =
      targetKey !== undefined
        ? floating.filter((key) => key !== sourceKey)
        : floating.map((key) => (key === sourceKey ? newKey : key));
    if (nextFloating.length > 0) settings.typeFloatingKeys[type] = nextFloating;
    else delete settings.typeFloatingKeys[type];
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
  // TYP ist nie Teil des Standard-Frontmatters (siehe stripTypProperty in
  // type-frontmatter-editor.js) - ein Umbenennen von/nach TYP daher ignorieren.
  if (sameKey(oldKey, TYP_PROPERTY) || sameKey(newKey, TYP_PROPERTY)) return;

  const { settings } = plugin;
  let typeCount = 0;
  for (const type of Object.keys(settings.typeDefaultFrontmatter)) {
    if (renameInType(settings, type, oldKey, newKey)) typeCount++;
  }
  const orderChanged = renameInGlobalOrder(settings, oldKey, newKey);
  if (typeCount === 0 && !orderChanged) return;

  await plugin.saveSettings();
  plugin.refreshTypColors?.();

  const parts = [];
  if (typeCount > 0) parts.push(`${typeCount} TYP${typeCount === 1 ? "" : "en"}`);
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
