const { typeKeyOf, propertyValue, setCanonicalProperty, SUBTYP_PROPERTY } = require("./typ-index");

// Subtyp-Namen werden (anders als TYPen, siehe normalizeTypeName) mit großem
// Anfangsbuchstaben je Wort geschrieben, der Rest klein: "kurz GESCHICHTE" →
// "Kurz Geschichte". Die Property SUBTYP selbst bleibt in Großbuchstaben.
function normalizeSubtypeName(raw) {
  return raw.trim().replace(/\S+/g, (word) => word.charAt(0).toLocaleUpperCase("de") + word.slice(1).toLocaleLowerCase("de"));
}

// Registrierte SUBTYPen je TYP (settings.typeSubtypes):
//   { [TYP]: { [SUBTYP]: { frontmatter: {...}, floatingKeys: [...] } } }
// Ein Subtyp gehört immer zu genau einem TYP; derselbe Name darf aber (als
// eigenständiger Subtyp) auch unter einem anderen TYP vorkommen. Die
// Reihenfolge der Schlüssel ist die Anzeigereihenfolge der Blöcke in der
// TYP-Detailansicht. frontmatter ergänzt bzw. überschreibt das
// Standard-Frontmatter des TYPs, floatingKeys wie typeFloatingKeys.

function getSubtypeNames(settings, type) {
  return Object.keys(settings.typeSubtypes?.[type] ?? {});
}

function getSubtype(settings, type, subtype) {
  return settings.typeSubtypes?.[type]?.[subtype] ?? null;
}

function ensureSubtype(settings, type, subtype) {
  if (!settings.typeSubtypes) settings.typeSubtypes = {};
  if (!settings.typeSubtypes[type]) settings.typeSubtypes[type] = {};
  const byName = settings.typeSubtypes[type];
  if (!byName[subtype]) byName[subtype] = { frontmatter: {}, floatingKeys: [] };
  return byName[subtype];
}

// Beim Umbenennen eines TYPs: Subtypen wandern unter den neuen Namen mit.
function moveTypeSubtypes(settings, oldType, newType) {
  if (!settings.typeSubtypes?.[oldType]) return;
  settings.typeSubtypes[newType] = settings.typeSubtypes[oldType];
  delete settings.typeSubtypes[oldType];
}

function deleteTypeSubtypes(settings, type) {
  if (settings.typeSubtypes) delete settings.typeSubtypes[type];
}

// Jeder Key gehört zu genau einem Block eines TYPs (Standard-Frontmatter ODER
// ein Subtyp, Abgleich ohne Beachtung der Groß-/Kleinschreibung). Kommt er
// trotzdem mehrfach vor (ältere Daten, Zusammenlegen zweier TYPen), bleibt er
// im ersten Block - Standard-Frontmatter vor den Subtypen in ihrer
// Reihenfolge - und verschwindet samt Floating-Markierung aus den übrigen.
// Liefert true bei einer Änderung.
function enforceUniqueKeys(settings, type) {
  const seen = new Set(Object.keys(settings.typeDefaultFrontmatter[type] ?? {}).map((key) => key.toLowerCase()));
  let changed = false;
  for (const subtype of getSubtypeNames(settings, type)) {
    const data = settings.typeSubtypes[type][subtype];
    for (const key of Object.keys(data.frontmatter)) {
      if (key === "") continue;
      const lower = key.toLowerCase();
      if (seen.has(lower)) {
        delete data.frontmatter[key];
        data.floatingKeys = data.floatingKeys.filter((k) => k !== key);
        changed = true;
      } else {
        seen.add(lower);
      }
    }
  }
  return changed;
}

// Zusammenlegen zweier TYPen: Subtypen, die es nur bei source gibt, werden
// übernommen. Gleichnamige Blöcke werden vereinigt - bei gleichem Key
// gewinnen Wert und Floating-Markierung des Ziels, Keys nur aus source
// werden hinten angehängt. Danach gilt wieder "jeder Key nur in einem
// Block" (enforceUniqueKeys).
function mergeTypeSubtypes(settings, source, target) {
  const sourceSubtypes = settings.typeSubtypes?.[source];
  if (!sourceSubtypes) return;
  for (const [name, sourceData] of Object.entries(sourceSubtypes)) {
    const targetData = getSubtype(settings, target, name);
    if (!targetData) {
      ensureSubtype(settings, target, name);
      settings.typeSubtypes[target][name] = sourceData;
      continue;
    }
    const targetLower = new Set(Object.keys(targetData.frontmatter).map((key) => key.toLowerCase()));
    for (const [key, value] of Object.entries(sourceData.frontmatter)) {
      if (key === "" || targetLower.has(key.toLowerCase())) continue;
      targetData.frontmatter[key] = value;
      if (sourceData.floatingKeys.includes(key)) targetData.floatingKeys.push(key);
    }
  }
  delete settings.typeSubtypes[source];
  enforceUniqueKeys(settings, target);
}

// Schreibt den SUBTYP-Wert aller Notizen mit TYP-Schlüssel type und
// SUBTYP-Schlüssel oldKey auf den Einzelwert newValue um - analog zu
// renameTypeInNotes() in typ-view.js.
async function renameSubtypeInNotes(plugin, type, oldKey, newValue) {
  let changed = 0;
  for (const file of plugin.typIndex.filesWithSubtype(type, oldKey)) {
    let matched = false;
    await plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (typeKeyOf(propertyValue(frontmatter, SUBTYP_PROPERTY)) !== oldKey) return;
      setCanonicalProperty(frontmatter, SUBTYP_PROPERTY, newValue);
      matched = true;
    });
    if (matched) changed++;
  }
  return changed;
}

module.exports = {
  normalizeSubtypeName,
  getSubtypeNames,
  getSubtype,
  ensureSubtype,
  enforceUniqueKeys,
  moveTypeSubtypes,
  deleteTypeSubtypes,
  mergeTypeSubtypes,
  renameSubtypeInNotes,
};
