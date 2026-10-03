const { Events, TFile, debounce } = require("obsidian");

const TYP_PROPERTY = "TYP";
const SUBTYP_PROPERTY = "SUBTYP";
const EMPTY_ENTRY = Object.freeze({ typKey: null, rawTyp: null, subtypKey: null, rawSubtyp: null });

// Collects changes to many files (renaming a TYP in many notes, sync) into one
// "change" event. No resetTimer, so a constant stream still gets through
// regularly.
const FLUSH_DELAY_MS = 100;

function rawItem(value) {
  if (value == null) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

// How the whole plugin reads a TYP value: deliberately NOT normalized - the
// raw form is the key. A TYP is exactly one clean value; anything else (padded,
// lowercase, a list - even with one item) becomes its own key that matches no
// registered TYP: no color, not counted for the "real" TYP, and listed in the
// TYP-Pane as an unregistered entry that a click cleans up (see registerTyp in
// typ-pane.js). Lists show as "[A, B]" and never coincide with a value "A, B".
// null = no TYP (missing, empty, blank, empty list).
function typKeyOf(value) {
  if (Array.isArray(value)) {
    const items = value.map(rawItem);
    if (items.every((item) => item.trim() === "")) return null;
    return `[${items.join(", ")}]`;
  }
  const text = rawItem(value);
  return text.trim() === "" ? null : text;
}

// Obsidian treats property names case-insensitively ("Subtyp" and "SUBTYP"
// are one property in "All properties"), so TYP and SUBTYP are read the same
// way. The exact spelling wins if a note (wrongly) has several.
function propertyKeyOf(frontmatter, name) {
  if (!frontmatter) return undefined;
  if (Object.prototype.hasOwnProperty.call(frontmatter, name)) return name;
  const lower = name.toLowerCase();
  return Object.keys(frontmatter).find((key) => key.toLowerCase() === lower);
}

function propertyValue(frontmatter, name) {
  const key = propertyKeyOf(frontmatter, name);
  return key === undefined ? undefined : frontmatter[key];
}

// Writes value under the canonical spelling `name` (e.g. "SUBTYP") into the
// processFrontMatter object. A differently spelled variant ("Subtyp") is
// renamed in place - insertion order is YAML order, so all keys are re-added
// in their order if needed (as in frontmatter-sort.js).
function setCanonicalProperty(frontmatter, name, value) {
  const lower = name.toLowerCase();
  const keys = Object.keys(frontmatter);
  if (!keys.some((key) => key !== name && key.toLowerCase() === lower)) {
    frontmatter[name] = value;
    return;
  }
  const snapshot = { ...frontmatter };
  for (const key of keys) delete frontmatter[key];
  for (const key of keys) {
    if (key.toLowerCase() !== lower) frontmatter[key] = snapshot[key];
    else if (!(name in frontmatter)) frontmatter[name] = value;
  }
}

// Removes `name` in any spelling from the processFrontMatter object.
function deleteProperty(frontmatter, name) {
  const lower = name.toLowerCase();
  for (const key of Object.keys(frontmatter)) {
    if (key.toLowerCase() === lower) delete frontmatter[key];
  }
}

// SUBTYP is read the same way (typKeyOf): at most one clean value per note,
// anything else is its own unregistered key.
function sameEntry(a, b) {
  return !!a && !!b && a.typKey === b.typKey && a.subtypKey === b.subtypKey;
}

// Central TYP/SUBTYP index over all markdown files (path -> values).
//
// metadataCache "changed"/"resolved" fire on EVERY edit to any note (about
// every two seconds while typing). The index compares per file whether TYP or
// SUBTYP really changed (or a note appeared/disappeared) and only then fires
// its own "change" event (argument: set of affected paths). All coloring hangs
// on this event, so normal typing triggers no recoloring.
//
// It also caches the vault-wide counts (TYP-List, Subtyp list, pickers,
// getTyps()) instead of rescanning every note on each call.
class TypIndex extends Events {
  constructor(plugin) {
    super();
    this.plugin = plugin;
    this.app = plugin.app;
    this.entries = new Map();
    this.built = false;
    this.aggregates = null;
    this.pendingPaths = new Set();
    this.flush = debounce(() => {
      const paths = this.pendingPaths;
      this.pendingPaths = new Set();
      this.trigger("change", paths);
    }, FLUSH_DELAY_MS);
  }

  register() {
    const { plugin, app } = this;
    plugin.registerEvent(app.metadataCache.on("changed", (file) => this.update(file)));
    plugin.registerEvent(app.metadataCache.on("deleted", (file) => this.remove(file.path)));
    plugin.registerEvent(app.vault.on("rename", (file, oldPath) => this.rename(file, oldPath)));
    // "Excluded files" changed: the entries stay valid, only the filtered
    // counts don't.
    plugin.registerEvent(app.vault.on("config-changed", () => (this.aggregates = null)));

    // At startup the first (lazy) access can come before the metadata cache is
    // fully loaded. Rebuild once after its first complete resolve; differences
    // go out through the "change" event like any other change.
    const resolvedRef = app.metadataCache.on("resolved", () => {
      app.metadataCache.offref(resolvedRef);
      this.rebuild();
    });
    plugin.registerEvent(resolvedRef);

    plugin.register(() => this.flush.cancel());
  }

  read(file) {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const rawTyp = propertyValue(frontmatter, TYP_PROPERTY) ?? null;
    const rawSubtyp = propertyValue(frontmatter, SUBTYP_PROPERTY) ?? null;
    return { typKey: typKeyOf(rawTyp), rawTyp, subtypKey: typKeyOf(rawSubtyp), rawSubtyp };
  }

  ensureBuilt() {
    if (!this.built) this.rebuild();
  }

  rebuild() {
    const previous = this.entries;
    const wasBuilt = this.built;
    this.entries = new Map();
    for (const file of this.app.vault.getMarkdownFiles()) this.entries.set(file.path, this.read(file));
    this.built = true;
    this.aggregates = null;
    if (!wasBuilt) return;

    for (const [path, entry] of this.entries) {
      if (!sameEntry(previous.get(path), entry)) this.pendingPaths.add(path);
    }
    for (const path of previous.keys()) {
      if (!this.entries.has(path)) this.pendingPaths.add(path);
    }
    if (this.pendingPaths.size > 0) this.flush();
  }

  markChanged(path) {
    this.aggregates = null;
    this.pendingPaths.add(path);
    this.flush();
  }

  update(file) {
    // Before the first access there is nothing stale; the lazy build reads
    // fresh from the cache anyway.
    if (!this.built || !(file instanceof TFile) || file.extension !== "md") return;
    const next = this.read(file);
    if (sameEntry(this.entries.get(file.path), next)) return;
    this.entries.set(file.path, next);
    this.markChanged(file.path);
  }

  remove(path) {
    if (!this.built || !this.entries.delete(path)) return;
    this.markChanged(path);
  }

  rename(file, oldPath) {
    if (!this.built) return;
    const entry = this.entries.get(oldPath);
    if (entry) {
      this.entries.delete(oldPath);
      this.markChanged(oldPath);
    }
    if (file instanceof TFile && file.extension === "md") {
      this.entries.set(file.path, entry ?? this.read(file));
      this.markChanged(file.path);
    }
  }

  entryFor(file) {
    if (!file) return EMPTY_ENTRY;
    this.ensureBuilt();
    return this.entries.get(file.path) ?? EMPTY_ENTRY;
  }

  // TYP key (see typKeyOf) or null; for a clean value simply the TYP name.
  typOf(file) {
    return this.entryFor(file).typKey;
  }

  // SUBTYP key (see typKeyOf) or null.
  subtypOf(file) {
    return this.entryFor(file).subtypKey;
  }

  // An actual frontmatter value for a key - for display, search and cleaning
  // up unregistered entries (all notes of a key share the same raw form).
  rawValueOf(typKey) {
    return this.aggregate().rawByKey.get(typKey);
  }

  // Clean = a single value without padding. Lowercase counts as clean (a valid
  // TYP name, just not registered yet); lists and padding don't.
  isCleanKey(typKey) {
    const raw = this.rawValueOf(typKey);
    return raw !== undefined && !Array.isArray(raw) && typKey === typKey.trim();
  }

  // Files with exactly this TYP key, honoring the excluded-files setting.
  filesWithTyp(typKey) {
    return this.filesMatching((entry) => entry.typKey === typKey);
  }

  // Files with exactly this TYP and SUBTYP key.
  filesWithSubtyp(typKey, subtypKey) {
    return this.filesMatching((entry) => entry.typKey === typKey && entry.subtypKey === subtypKey);
  }

  filesMatching(predicate) {
    this.ensureBuilt();
    const includeIgnored = !!this.plugin.settings.includeIgnoredFiles;
    const files = [];
    for (const [path, entry] of this.entries) {
      if (!predicate(entry)) continue;
      if (!includeIgnored && this.app.metadataCache.isUserIgnored(path)) continue;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) files.push(file);
    }
    return files;
  }

  // Honors Obsidian's "Excluded files" (where Hide Folders also puts hidden
  // folders) unless "Include excluded files" is on. A note without a TYP has
  // no SUBTYP context.
  aggregate() {
    this.ensureBuilt();
    const includeIgnored = !!this.plugin.settings.includeIgnoredFiles;
    if (this.aggregates?.includeIgnored === includeIgnored) return this.aggregates;

    const counts = new Map();
    const rawByKey = new Map();
    const subtypsByTyp = new Map();
    let noTyp = 0;
    for (const [path, { typKey, rawTyp, subtypKey, rawSubtyp }] of this.entries) {
      if (!includeIgnored && this.app.metadataCache.isUserIgnored(path)) continue;
      if (typKey === null) {
        noTyp++;
        continue;
      }
      counts.set(typKey, (counts.get(typKey) ?? 0) + 1);
      if (!rawByKey.has(typKey)) rawByKey.set(typKey, rawTyp);
      let bucket = subtypsByTyp.get(typKey);
      if (!bucket) {
        bucket = { counts: new Map(), noSubtyp: 0, rawByKey: new Map() };
        subtypsByTyp.set(typKey, bucket);
      }
      if (subtypKey === null) {
        bucket.noSubtyp++;
      } else {
        bucket.counts.set(subtypKey, (bucket.counts.get(subtypKey) ?? 0) + 1);
        if (!bucket.rawByKey.has(subtypKey)) bucket.rawByKey.set(subtypKey, rawSubtyp);
      }
    }
    this.aggregates = { includeIgnored, counts, noTyp, rawByKey, subtypsByTyp };
    return this.aggregates;
  }

  // Cached - don't modify the returned maps.
  typCounts() {
    const { counts, noTyp } = this.aggregate();
    return { counts, noTyp };
  }

  // TYP -> { counts: Map(SUBTYP key -> count), noSubtyp, rawByKey }.
  // Cached - don't modify.
  subtypCounts() {
    return this.aggregate().subtypsByTyp;
  }

  subtypBucket(typKey) {
    return this.subtypCounts().get(typKey) ?? EMPTY_BUCKET;
  }
}

const EMPTY_BUCKET = Object.freeze({ counts: new Map(), noSubtyp: 0, rawByKey: new Map() });

module.exports = { TypIndex, typKeyOf, propertyValue, setCanonicalProperty, deleteProperty, TYP_PROPERTY, SUBTYP_PROPERTY };
