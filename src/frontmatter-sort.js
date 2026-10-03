const { getSubtyp } = require("./subtyps");
const { typKeyOf, propertyValue, TYP_PROPERTY, SUBTYP_PROPERTY } = require("./typ-index");
const { plural } = require("./typ-utils");

// The four placeholders of the global order; the order editor lets you move
// them but not remove them. "typValue" is the TYP property itself,
// "subtypValue" the SUBTYP property, "typ" the TYP-Frontmatter list,
// "other" everything else.
const DEFAULT_GLOBAL_ORDER = [{ kind: "typValue" }, { kind: "subtypValue" }, { kind: "typ" }, { kind: "other" }];

// Ensures exactly one entry per placeholder. Older saved orders predate some
// of them; missing ones are added at a sensible spot ("subtypValue" right
// after "typValue", the others at the edges) without touching the order the
// user arranged.
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
 * Frontmatter sorting
 * Puts the properties a note HAS into a fixed order built from
 * globalPropertyOrder: pinned single properties, the TYP and
 * SUBTYP properties, the "TYP-Frontmatter" block (the TYP's list
 * followed by its Subtyp block) and "Other properties". Never adds
 * properties or changes values.
 * ============================================================ */

// Key order of a TYP's frontmatter, floating keys included at their list
// position (getTypDefaults leaves them out, but a note that has one should
// still get it in place). Without TYP/SUBTYP and the editor's blank row.
// null if there is no TYP or no list.
//
// With subtyp, the keys of its block follow. A key in BOTH blocks keeps the
// TYP-Frontmatter position - the same rule as collectBlocks in main.js, or a
// freshly created note would be re-sorted right away.
function orderedDefaultKeys(plugin, typ, subtyp = null) {
  if (!typ) return null;
  const isSystemKey = (key) => key === "" || [TYP_PROPERTY, SUBTYP_PROPERTY].some((p) => key.toLowerCase() === p.toLowerCase());
  const subtypData = subtyp ? getSubtyp(plugin.settings, typ, subtyp) : null;
  const blocks = [plugin.settings.typDefaultFrontmatter[typ], subtypData?.frontmatter];
  const keys = [];
  const seen = new Set();
  for (const block of blocks) {
    for (const key of Object.keys(block ?? {})) {
      if (isSystemKey(key) || seen.has(key.toLowerCase())) continue;
      keys.push(key);
      seen.add(key.toLowerCase());
    }
  }
  return keys.length > 0 ? keys : null;
}

// Target order of a note's existing properties, fully defined by globalOrder.
//
// Which block claims a property is decided BEFORE the order is built (pinned,
// TYP block and rest are disjoint), so the result doesn't depend on where the
// blocks sit in globalOrder: a pinned property never also lands in the TYP
// block, and "other" only ever holds true leftovers.
function computeSortedKeys(existingKeys, globalOrder, typDefaultKeys) {
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
    (typDefaultKeys ?? []).map(resolve).filter((key) => key && key !== typKey && !pinned.has(key))
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
      for (const name of typDefaultKeys ?? []) {
        const key = resolve(name);
        if (key && typBlockKeys.has(key)) push(key);
      }
    } else if (entry.kind === "other") {
      for (const key of existingKeys) {
        if (!claimed.has(key)) push(key);
      }
    }
  }

  // Safety net for an incomplete globalOrder (corrupt settings).
  for (const key of existingKeys) push(key);
  return sortedKeys;
}

// "position" is Obsidian's location of the frontmatter block, present only in
// the cache object, not a property.
function cachedFrontmatterKeys(app, file) {
  const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!frontmatter) return null;
  return Object.keys(frontmatter).filter((key) => key !== "position");
}

async function sortFileFrontmatter(app, file, globalOrder, typDefaultKeys) {
  // Cheap pre-check against the in-memory cache: most notes are already
  // sorted, and this skips opening them at all - that is where repeated vault
  // runs get their speed. processFrontMatter stays the source of truth for the
  // actual write, since the cache can lag behind.
  const cachedKeys = cachedFrontmatterKeys(app, file);
  if (!cachedKeys || cachedKeys.length <= 1) return false;
  const cachedSorted = computeSortedKeys(cachedKeys, globalOrder, typDefaultKeys);
  if (cachedSorted.every((key, i) => key === cachedKeys[i])) return false;

  let changed = false;
  await app.fileManager.processFrontMatter(file, (frontmatter) => {
    changed = sortFrontmatterObject(frontmatter, globalOrder, typDefaultKeys);
  });
  return changed;
}

// Sorts the processFrontMatter object in place: insertion order becomes the
// YAML order, so all keys are deleted and re-added. Returns true on a change.
function sortFrontmatterObject(frontmatter, globalOrder, typDefaultKeys) {
  const existingKeys = Object.keys(frontmatter);
  if (existingKeys.length <= 1) return false;

  const sortedKeys = computeSortedKeys(existingKeys, globalOrder, typDefaultKeys);
  if (sortedKeys.every((key, i) => key === existingKeys[i])) return false;

  const snapshot = { ...frontmatter };
  for (const key of existingKeys) delete frontmatter[key];
  for (const key of sortedKeys) frontmatter[key] = snapshot[key];
  return true;
}

// For callers already inside processFrontMatter (TYP.js): TYP and Subtyp are
// passed explicitly, because index and cache don't know the values just
// written yet.
function sortFrontmatterFor(plugin, frontmatter, typ, subtyp) {
  const globalOrder = normalizeGlobalOrder(plugin.settings.globalPropertyOrder);
  return sortFrontmatterObject(frontmatter, globalOrder, orderedDefaultKeys(plugin, typ, subtyp));
}

// Moves only `key` to its sorted place and leaves every other key where it is
// - for callers that just added a property (Fred's property backlinking) and
// shouldn't reshuffle a deliberately different order. TYP/SUBTYP are read from
// the object itself; index and cache may still be behind.
//
// The place is right after key's nearest predecessor in the fully sorted
// order (first if there is none). Returns true on a change.
function placePropertyFor(plugin, frontmatter, key) {
  const existingKeys = Object.keys(frontmatter);
  const actualKey = existingKeys.find((k) => k.toLowerCase() === key.toLowerCase());
  if (!actualKey || existingKeys.length <= 1) return false;

  const globalOrder = normalizeGlobalOrder(plugin.settings.globalPropertyOrder);
  const typ = typKeyOf(propertyValue(frontmatter, TYP_PROPERTY));
  const subtyp = typKeyOf(propertyValue(frontmatter, SUBTYP_PROPERTY));
  const sortedKeys = computeSortedKeys(existingKeys, globalOrder, orderedDefaultKeys(plugin, typ, subtyp));

  const rest = existingKeys.filter((k) => k !== actualKey);
  const predecessor = sortedKeys.slice(0, sortedKeys.indexOf(actualKey)).pop();
  const newKeys = [...rest];
  newKeys.splice(predecessor === undefined ? 0 : rest.indexOf(predecessor) + 1, 0, actualKey);
  if (newKeys.every((k, i) => k === existingKeys[i])) return false;

  const snapshot = { ...frontmatter };
  for (const k of existingKeys) delete frontmatter[k];
  for (const k of newKeys) frontmatter[k] = snapshot[k];
  return true;
}

async function sortSingleFileFrontmatter(app, plugin, file) {
  const globalOrder = normalizeGlobalOrder(plugin.settings.globalPropertyOrder);
  // An unclean TYP value (list, padded) has no TYP-Frontmatter; only the global
  // order applies then (see typKeyOf in typ-index.js).
  const typ = plugin.typIndex.typOf(file);
  const typDefaultKeys = orderedDefaultKeys(plugin, typ, plugin.typIndex.subtypOf(file));
  return sortFileFrontmatter(app, file, globalOrder, typDefaultKeys);
}

// onlyTyp (optional) limits the run to notes of that TYP. Without it every
// note is checked, including notes without a TYP: pinned properties such as
// cssclasses apply regardless of TYP.
async function sortAllFrontmatter(app, plugin, onlyTyp) {
  let checked = 0;
  let changed = 0;
  const globalOrder = normalizeGlobalOrder(plugin.settings.globalPropertyOrder);
  // Only meaningful for a single TYP: lets the command explain a run that
  // changed nothing because the TYP has no TYP-Frontmatter.
  const hasTypDefaults = onlyTyp ? orderedDefaultKeys(plugin, onlyTyp) !== null : null;

  for (const file of app.vault.getMarkdownFiles()) {
    if (!plugin.settings.includeIgnoredFiles && app.metadataCache.isUserIgnored(file.path)) continue;

    const typ = plugin.typIndex.typOf(file);
    if (onlyTyp && typ !== onlyTyp) continue;

    const typDefaultKeys = orderedDefaultKeys(plugin, typ, plugin.typIndex.subtypOf(file));
    checked++;
    if (await sortFileFrontmatter(app, file, globalOrder, typDefaultKeys)) changed++;
  }

  return { checked, changed, hasTypDefaults };
}

// Result notice of a sorting run, shared by the commands and the play button
// of the global order.
function sortSummary(label, checked, changed) {
  return changed > 0
    ? `${label}: checked ${plural(checked, "note")}, sorted ${changed}.`
    : `${label}: checked ${plural(checked, "note")}, all already sorted.`;
}

module.exports = {
  sortAllFrontmatter,
  sortSingleFileFrontmatter,
  sortFrontmatterFor,
  placePropertyFor,
  normalizeGlobalOrder,
  sortSummary,
  DEFAULT_GLOBAL_ORDER,
  TYP_PROPERTY,
  SUBTYP_PROPERTY,
};
