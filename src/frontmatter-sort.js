const { getSubtype } = require("./subtypes");

const TYP_PROPERTY = "TYP";
const SUBTYP_PROPERTY = "SUBTYP";

// Wird auch von settings.js (Default für globalPropertyOrder) sowie vom
// Order-Editor benutzt - alle vier Platzhalter-Blöcke sind dort per UI nicht
// entfernbar, nur verschiebbar (siehe frontmatter-order-editor.js).
// "typValue" ist die TYP-Property selbst, "subtypValue" analog die SUBTYP-
// Property, "typ" die Standard-Frontmatter-Liste des TYPs (siehe
// type-frontmatter-editor.js), "other" alles Übrige.
const DEFAULT_GLOBAL_ORDER = [{ kind: "typValue" }, { kind: "subtypValue" }, { kind: "typ" }, { kind: "other" }];

// Stellt sicher, dass genau je ein Eintrag pro Platzhalter-Art vorhanden ist -
// nötig für Bestandsinstallationen, deren gespeicherte globalPropertyOrder
// noch aus der Zeit vor "TYP als Listeneintrag" bzw. vor SUBTYP stammt (TYP
// war davor hart-codiert immer an erster Stelle, kam in der Liste selbst
// nicht vor). Fehlende Einträge werden an sinnvoller Default-Position ergänzt,
// statt die bestehende, vom Nutzer per Drag & Drop einsortierte Reihenfolge
// anzutasten. "subtypValue" landet dabei direkt hinter "typValue" (garantiert
// zu diesem Zeitpunkt schon vorhanden), statt wie die übrigen Platzhalter
// pauschal an den Rand.
function normalizeGlobalOrder(order) {
  const result = Array.isArray(order) ? order.filter((entry) => entry && typeof entry === "object") : [];
  const hasKind = (kind) => result.some((entry) => entry.kind === kind);
  if (!hasKind("typValue")) result.unshift({ kind: "typValue" });
  if (!hasKind("subtypValue")) {
    const typValueIndex = result.findIndex((entry) => entry.kind === "typValue");
    result.splice(typValueIndex + 1, 0, { kind: "subtypValue" });
  }
  if (!hasKind("typ")) result.push({ kind: "typ" });
  if (!hasKind("other")) result.push({ kind: "other" });
  return result;
}

/* ============================================================
 * Frontmatter-Sortierung
 * Bringt die in einer Notiz VORHANDENEN Properties in eine feste
 * Reihenfolge - zusammengesetzt aus (siehe globalPropertyOrder):
 *  - global fest positionierten Einzel-Properties (z. B. cssclasses,
 *    aliases; Einstellungen -> TYP -> Globale Property-Reihenfolge),
 *  - der TYP-Property selbst,
 *  - der SUBTYP-Property selbst,
 *  - dem Block "TYP-Frontmatter" (Standard-Frontmatter-Liste des
 *    jeweiligen Typs, siehe type-frontmatter-editor.js, gefolgt vom
 *    Frontmatter-Block seines SUBTYPs), und
 *  - dem Block "Sonstige Properties" (alles Übrige, in bisheriger
 *    Reihenfolge).
 * Ergänzt dabei keine fehlenden Standard-Properties und ändert keine
 * Werte - reine Umsortierung der bereits vorhandenen Zeilen.
 * ============================================================ */

// Standard-Property-Reihenfolge eines Typs, inkl. der darin als "Floating
// Property" markierten Keys (siehe typeFloatingKeys in settings.js) an genau
// der Stelle, an der sie in der Liste stehen - ohne TYP selbst (das ist dort
// nur aus historischen Gründen evtl. noch enthalten, siehe stripTypProperty)
// und ohne die leere Platzhalter-Zeile des Editors ("Property hinzufügen").
// Floating Properties werden nur nicht automatisch von getTypeDefaults()
// (main.js) an Templater ausgeliefert, sollen aber trotzdem an ihrer
// Listenposition landen, sobald eine Notiz sie doch trägt. null, wenn kein
// Typ übergeben wurde oder für den Typ keine Standardliste gepflegt ist.
//
// Mit subtype direkt dahinter die Keys aus dessen Frontmatter-Block (siehe
// subtypes.js), soweit sie nicht schon beim TYP stehen - ein überschriebener
// Key behält seine Position aus der TYP-Liste.
function orderedDefaultKeys(plugin, type, subtype = null) {
  if (!type) return null;
  const isSystemKey = (key) => key === "" || [TYP_PROPERTY, SUBTYP_PROPERTY].some((p) => key.toLowerCase() === p.toLowerCase());
  const keys = Object.keys(plugin.settings.typeDefaultFrontmatter[type] ?? {}).filter((key) => !isSystemKey(key));
  if (subtype) {
    const seen = new Set(keys.map((key) => key.toLowerCase()));
    for (const key of Object.keys(getSubtype(plugin.settings, type, subtype)?.frontmatter ?? {})) {
      if (isSystemKey(key) || seen.has(key.toLowerCase())) continue;
      keys.push(key);
      seen.add(key.toLowerCase());
    }
  }
  return keys.length > 0 ? keys : null;
}

// Reihenfolge, in der die vorhandenen Properties einer Notiz stehen sollen -
// bestimmt komplett durch globalOrder: einzelne Properties an fester
// Position, sowie die Platzhalter "typValue" (die TYP-Property selbst),
// "subtypValue" (die SUBTYP-Property selbst), "typ" (Standardliste des Typs)
// und "other" (alles Übrige).
//
// Welcher Block eine Property beansprucht, wird VOR dem eigentlichen Aufbau
// der Reihenfolge feststehend bestimmt (pinned/typBlock/Rest sind disjunkt) -
// nicht erst beim linearen Durchlauf von globalOrder. Das macht die
// Block-Zuordnung unabhängig davon, in welcher Reihenfolge die Blöcke in
// globalOrder stehen: eine global fest positionierte Property gehört immer zu
// ihrem eigenen Eintrag (nie zusätzlich zum Typ-Block, selbst wenn "TYP
// Properties" vorher in der Liste steht), und "Sonstige Properties" enthält
// immer nur echte Restbestände (nie versehentlich Properties, die eigentlich
// einem später in der Liste stehenden Block gehören).
function computeSortedKeys(existingKeys, globalOrder, typeDefaultKeys) {
  const lowerToActual = new Map(existingKeys.map((key) => [key.toLowerCase(), key]));
  const resolve = (name) => lowerToActual.get(name.toLowerCase());

  const pinned = new Set(
    globalOrder
      .filter((entry) => entry.kind === "property")
      .map((entry) => resolve(entry.name))
      .filter(Boolean)
  );
  const typKey = resolve(TYP_PROPERTY);
  const subtypKey = resolve(SUBTYP_PROPERTY);
  const typBlockKeys = new Set(
    (typeDefaultKeys ?? []).map(resolve).filter((key) => key && key !== typKey && !pinned.has(key))
  );
  const claimed = new Set(pinned);
  for (const key of typBlockKeys) claimed.add(key);
  if (typKey) claimed.add(typKey);
  if (subtypKey) claimed.add(subtypKey);

  const sortedKeys = [];
  const seen = new Set();
  const push = (key) => {
    if (key && !seen.has(key)) {
      sortedKeys.push(key);
      seen.add(key);
    }
  };

  for (const entry of globalOrder) {
    if (entry.kind === "property") push(resolve(entry.name));
    else if (entry.kind === "typValue") push(typKey);
    else if (entry.kind === "subtypValue") push(subtypKey);
    else if (entry.kind === "typ") {
      for (const name of typeDefaultKeys ?? []) {
        const key = resolve(name);
        if (key && typBlockKeys.has(key)) push(key);
      }
    } else if (entry.kind === "other") {
      for (const key of existingKeys) {
        if (!claimed.has(key)) push(key);
      }
    }
  }

  // Sicherheitsnetz, falls globalOrder unvollständig ist (z. B. korrupte
  // Einstellungen) - die UI verhindert das eigentlich (siehe normalizeGlobalOrder).
  for (const key of existingKeys) push(key);
  return sortedKeys;
}

// "position" ist kein echtes Property, sondern Obsidians eigene Angabe zur
// Lage des Frontmatter-Blocks innerhalb der Datei (nur im Cache-Objekt
// vorhanden, nicht im von processFrontMatter gelieferten Objekt).
function cachedFrontmatterKeys(app, file) {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!frontmatter) return null;
  return Object.keys(frontmatter).filter((key) => key !== "position");
}

async function sortFileFrontmatter(app, file, globalOrder, typeDefaultKeys) {
  // Günstiger Vorab-Check über den bereits im Speicher vorhandenen Metadata-
  // Cache (kein Datei-Zugriff): der Normalfall - eine Notiz ist schon korrekt
  // sortiert - lässt sich so erkennen, ohne die Datei über processFrontMatter
  // überhaupt zu öffnen. Das ist bei wiederholten Läufen über den ganzen
  // Vault der Löwenanteil der Notizen und damit der eigentliche Geschwindig-
  // keitsgewinn. processFrontMatter bleibt trotzdem die alleinige Quelle der
  // Wahrheit für den tatsächlichen Schreibvorgang (Cache kann kurzzeitig
  // veraltet sein) - der Vorab-Check überspringt nur sicher unveränderte Fälle.
  const cachedKeys = cachedFrontmatterKeys(app, file);
  if (!cachedKeys || cachedKeys.length <= 1) return false;
  const cachedSorted = computeSortedKeys(cachedKeys, globalOrder, typeDefaultKeys);
  if (cachedSorted.every((key, i) => key === cachedKeys[i])) return false;

  let changed = false;
  await app.fileManager.processFrontMatter(file, (frontmatter) => {
    changed = sortFrontmatterObject(frontmatter, globalOrder, typeDefaultKeys);
  });
  return changed;
}

// Sortiert das von processFrontMatter gelieferte Objekt in-place (siehe
// Kommentar in type-frontmatter-editor.js zu saveFrontmatter/stripTypProperty):
// Objekt-Insertion-Order bestimmt die spätere YAML-Reihenfolge, daher alle
// Keys löschen und in neuer Reihenfolge wieder einfügen, statt ein neues
// Objekt zurückzugeben. Liefert true bei einer Änderung.
function sortFrontmatterObject(frontmatter, globalOrder, typeDefaultKeys) {
  const existingKeys = Object.keys(frontmatter);
  if (existingKeys.length <= 1) return false;

  const sortedKeys = computeSortedKeys(existingKeys, globalOrder, typeDefaultKeys);
  if (sortedKeys.every((key, i) => key === existingKeys[i])) return false;

  const snapshot = { ...frontmatter };
  for (const key of existingKeys) delete frontmatter[key];
  for (const key of sortedKeys) frontmatter[key] = snapshot[key];
  return true;
}

// Für Aufrufer, die ohnehin gerade in processFrontMatter schreiben (z. B.
// applyTypeProperties/_obsidian/templater-scripts/TYP.js): sortiert das
// Objekt direkt mit ausdrücklich übergebenem TYP/Subtyp - der Index bzw.
// Metadata-Cache kennt die gerade geschriebenen Werte zu diesem Zeitpunkt
// noch nicht.
function sortFrontmatterFor(plugin, frontmatter, type, subtype) {
  const globalOrder = normalizeGlobalOrder(plugin.settings.globalPropertyOrder);
  return sortFrontmatterObject(frontmatter, globalOrder, orderedDefaultKeys(plugin, type, subtype));
}

// Sortiert eine einzelne, bereits bekannte Notiz (z. B. die aktive Datei).
async function sortSingleFileFrontmatter(app, plugin, file) {
  const globalOrder = normalizeGlobalOrder(plugin.settings.globalPropertyOrder);
  // Unsaubere TYP-Werte (Liste, Randleerzeichen) haben keine Standardliste -
  // dann greift nur die globale Reihenfolge (siehe typeKeyOf in typ-index.js).
  const type = plugin.typIndex.typeOf(file);
  const typeDefaultKeys = orderedDefaultKeys(plugin, type, plugin.typIndex.subtypeOf(file));
  return sortFileFrontmatter(app, file, globalOrder, typeDefaultKeys);
}

// onlyType: optional - beschränkt den Lauf auf Notizen genau dieses Typs.
// Ohne onlyType werden alle Notizen geprüft, auch ohne TYP oder mit einem Typ
// ohne gepflegte Standardliste - die global fest positionierten Properties
// (z. B. cssclasses) sollen unabhängig vom Typ wirken können. Für Notizen, bei
// denen weder ein passender Typ-Block noch eine der konfigurierten
// Einzel-Properties greift, bleibt die bisherige Reihenfolge unverändert.
async function sortAllFrontmatter(app, plugin, onlyType) {
  let checked = 0;
  let changed = 0;
  const globalOrder = normalizeGlobalOrder(plugin.settings.globalPropertyOrder);
  // Nur aussagekräftig, wenn ein einzelner Typ eingegrenzt wurde (sonst
  // wechselt der Typ von Datei zu Datei) - für die Rückmeldung des Befehls
  // "TYP Frontmatter Sortierung aktualisieren", falls für den gewählten Typ
  // gar keine Standard-Frontmatter-Liste gepflegt ist.
  const hasTypeDefaults = onlyType ? orderedDefaultKeys(plugin, onlyType) !== null : null;

  for (const file of app.vault.getMarkdownFiles()) {
    if (!plugin.settings.includeIgnoredFiles && app.metadataCache.isUserIgnored(file.path)) continue;

    const type = plugin.typIndex.typeOf(file);
    if (onlyType && type !== onlyType) continue;

    const typeDefaultKeys = orderedDefaultKeys(plugin, type, plugin.typIndex.subtypeOf(file));
    checked++;
    if (await sortFileFrontmatter(app, file, globalOrder, typeDefaultKeys)) changed++;
  }

  return { checked, changed, hasTypeDefaults };
}

module.exports = {
  sortAllFrontmatter,
  sortSingleFileFrontmatter,
  sortFrontmatterFor,
  normalizeGlobalOrder,
  DEFAULT_GLOBAL_ORDER,
  TYP_PROPERTY,
  SUBTYP_PROPERTY,
};
