const { Notice } = require("obsidian");
const { getSubtyp } = require("./subtyps");
const { typKeyOf, propertyValue, TYP_PROPERTY, SUBTYP_PROPERTY } = require("./typ-index");
const { plural } = require("./typ-utils");
const { ConfirmModal, typNameNode } = require("./confirm-modal");
const { editFrontmatter, skippedText } = require("./frontmatter-text");

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

// Cheap pre-check against the in-memory cache: most notes are already sorted,
// and this skips opening them at all - that is where repeated vault runs get
// their speed. Also what the play button counts with before it asks.
function cacheNeedsSorting(app, file, globalOrder, typDefaultKeys) {
  const cachedKeys = cachedFrontmatterKeys(app, file);
  if (!cachedKeys || cachedKeys.length <= 1) return false;
  const cachedSorted = computeSortedKeys(cachedKeys, globalOrder, typDefaultKeys);
  return !cachedSorted.every((key, i) => key === cachedKeys[i]);
}

// Resolves to "changed", "unchanged" or "skipped" (see editFrontmatter).
async function sortFileFrontmatter(app, file, globalOrder, typDefaultKeys) {
  if (!cacheNeedsSorting(app, file, globalOrder, typDefaultKeys)) return "unchanged";

  // The file itself stays the source of truth for the actual write, since the
  // cache can lag behind. Only whole properties move, together with the
  // comments above them; every line keeps its text (see frontmatter-text.js).
  const { status } = await editFrontmatter(app, file, (doc) => {
    const existingKeys = doc.keys();
    if (existingKeys.length <= 1) return;
    const sortedKeys = computeSortedKeys(existingKeys, globalOrder, typDefaultKeys);
    if (!sortedKeys.every((key, i) => key === existingKeys[i])) doc.reorder(sortedKeys);
  });
  return status;
}

// Sorts the processFrontMatter object in place: insertion order becomes the
// YAML order, so all keys are deleted and re-added. Returns true on a change.
// Only for the Templater API (sortFrontmatterFor); the plugin's own runs go
// through sortFileFrontmatter.
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

// Resolves to "changed", "unchanged" or "skipped" (see editFrontmatter).
async function sortSingleFileFrontmatter(app, plugin, file) {
  const globalOrder = normalizeGlobalOrder(plugin.settings.globalPropertyOrder);
  // An unclean TYP value (list, padded) has no TYP-Frontmatter; only the global
  // order applies then (see typKeyOf in typ-index.js).
  const typ = plugin.typIndex.typOf(file);
  const typDefaultKeys = orderedDefaultKeys(plugin, typ, plugin.typIndex.subtypOf(file));
  return sortFileFrontmatter(app, file, globalOrder, typDefaultKeys);
}

// From this many notes to re-sort on, a run is "large": it asks first (see
// runFrontmatterSort) and shows its progress in a notice, updated every
// PROGRESS_STEP notes. One number for both, so a run that asked also shows
// how far it got, and a small one does neither.
const LARGE_SORT_THRESHOLD = 50;
const PROGRESS_STEP = 10;

// First half of a run, from the metadata cache alone (no note is opened): how
// many notes the run checks and which of them it would re-sort.
// runFrontmatterSort counts with it before asking; sortAllFrontmatter writes
// exactly these candidates.
//
// onlyTyp (optional) limits the run to notes of that TYP. Without it every
// note is checked, including notes without a TYP: pinned properties such as
// cssclasses apply regardless of TYP.
function sortCandidates(app, plugin, onlyTyp) {
  const globalOrder = normalizeGlobalOrder(plugin.settings.globalPropertyOrder);
  let checked = 0;
  const candidates = [];

  for (const file of app.vault.getMarkdownFiles()) {
    if (!plugin.settings.includeIgnoredFiles && app.metadataCache.isUserIgnored(file.path)) continue;

    const typ = plugin.typIndex.typOf(file);
    if (onlyTyp && typ !== onlyTyp) continue;

    const typDefaultKeys = orderedDefaultKeys(plugin, typ, plugin.typIndex.subtypOf(file));
    checked++;
    if (cacheNeedsSorting(app, file, globalOrder, typDefaultKeys)) candidates.push({ file, typDefaultKeys });
  }

  return { checked, candidates, globalOrder };
}

async function sortAllFrontmatter(app, plugin, onlyTyp) {
  // Counted afresh, not taken over from runFrontmatterSort's question: the
  // dialog may have been open for a while.
  const { checked, candidates, globalOrder } = sortCandidates(app, plugin, onlyTyp);
  // Only meaningful for a single TYP: lets the command explain a run that
  // changed nothing because the TYP has no TYP-Frontmatter.
  const hasTypDefaults = onlyTyp ? orderedDefaultKeys(plugin, onlyTyp) !== null : null;

  const label = onlyTyp ? `Frontmatter sorting ${onlyTyp}` : "Frontmatter sorting";
  const progressText = (done) => `${label}: ${done} of ${plural(candidates.length, "note")}…`;
  // Duration 0: stays until hidden below, a timed one could vanish mid-run.
  const notice = candidates.length >= LARGE_SORT_THRESHOLD ? new Notice(progressText(0), 0) : null;

  let changed = 0;
  let skipped = 0;
  try {
    for (const [index, { file, typDefaultKeys }] of candidates.entries()) {
      // sortFileFrontmatter checks the cache once more - a note may have been
      // sorted or edited since the count.
      const status = await sortFileFrontmatter(app, file, globalOrder, typDefaultKeys);
      if (status === "changed") changed++;
      else if (status === "skipped") skipped++;
      if (notice && (index + 1) % PROGRESS_STEP === 0) notice.setMessage(progressText(index + 1));
    }
  } finally {
    notice?.hide();
  }

  return { checked, changed, skipped, hasTypDefaults };
}

// Resolves true for "Sort", false for Cancel, Escape or a click outside.
function confirmLargeSort(plugin, onlyTyp, count, checked) {
  const noun = checked === 1 ? "note" : "notes";
  const title = onlyTyp
    ? [`Re-sort ${count} of ${checked} `, typNameNode(plugin, onlyTyp, plugin.settings.typColors[onlyTyp] ?? null), ` ${noun}?`]
    : `Re-sort ${count} of ${checked} ${noun}?`;
  return new Promise((resolve) =>
    new ConfirmModal(plugin.app, {
      title,
      body: ["Only the order of their properties changes, values stay as they are."],
      confirmText: "Sort",
      // Like "Rename and update notes": Enter confirms the run just asked for.
      focus: "confirm",
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    }).open()
  );
}

// The one entry point of every sorting run over many notes: the commands "Sort
// frontmatter in all notes" and "Sort frontmatter for one TYP" (after its
// picker), the play button of the global order and the TYP-Pane's context
// menu. onlyTyp null = all notes.
//
// A large run (LARGE_SORT_THRESHOLD notes to re-sort, counted from the cache)
// asks first; the question can't be switched off, the run rewrites notes and
// has no undo. A small one just runs. Either way a notice reports the result.
async function runFrontmatterSort(plugin, onlyTyp = null) {
  const { checked, candidates } = sortCandidates(plugin.app, plugin, onlyTyp);
  if (candidates.length >= LARGE_SORT_THRESHOLD && !(await confirmLargeSort(plugin, onlyTyp, candidates.length, checked))) return;

  const { changed, skipped, hasTypDefaults, checked: checkedNow } = await sortAllFrontmatter(plugin.app, plugin, onlyTyp);
  let message = sortSummary(onlyTyp ? `Frontmatter sorting ${onlyTyp}` : "Frontmatter sorting", checkedNow, changed, skipped);
  // Not an error, but explains why nothing may have changed.
  if (hasTypDefaults === false) {
    message += ` Note: ${onlyTyp} has no TYP-Frontmatter, so only the global order was applied.`;
  }
  new Notice(message);
}

// Result notice of a sorting run over many notes (runFrontmatterSort).
// skipped: notes whose frontmatter couldn't be re-sorted without losing
// comments (see frontmatter-text.js).
function sortSummary(label, checked, changed, skipped = 0) {
  const result =
    changed > 0 || skipped > 0
      ? `${label}: checked ${plural(checked, "note")}, sorted ${changed}.`
      : `${label}: checked ${plural(checked, "note")}, all already sorted.`;
  return result + skippedText(skipped, "re-sorted");
}

module.exports = {
  sortSingleFileFrontmatter,
  runFrontmatterSort,
  sortFrontmatterFor,
  placePropertyFor,
  normalizeGlobalOrder,
  DEFAULT_GLOBAL_ORDER,
  TYP_PROPERTY,
  SUBTYP_PROPERTY,
};
