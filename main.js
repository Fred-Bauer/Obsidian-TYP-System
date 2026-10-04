var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/typ-index.js
var require_typ_index = __commonJS({
  "src/typ-index.js"(exports2, module2) {
    var { Events, TFile, debounce } = require("obsidian");
    var TYP_PROPERTY2 = "TYP";
    var SUBTYP_PROPERTY2 = "SUBTYP";
    var EMPTY_ENTRY = Object.freeze({ typKey: null, rawTyp: null, subtypKey: null, rawSubtyp: null });
    var FLUSH_DELAY_MS = 100;
    function rawItem(value) {
      if (value == null) return "";
      return typeof value === "object" ? JSON.stringify(value) : String(value);
    }
    function typKeyOf(value) {
      if (Array.isArray(value)) {
        const items = value.map(rawItem);
        if (items.every((item) => item.trim() === "")) return null;
        return `[${items.join(", ")}]`;
      }
      const text = rawItem(value);
      return text.trim() === "" ? null : text;
    }
    function propertyKeyOf(frontmatter, name) {
      if (!frontmatter) return void 0;
      if (Object.prototype.hasOwnProperty.call(frontmatter, name)) return name;
      const lower = name.toLowerCase();
      return Object.keys(frontmatter).find((key) => key.toLowerCase() === lower);
    }
    function propertyValue(frontmatter, name) {
      const key = propertyKeyOf(frontmatter, name);
      return key === void 0 ? void 0 : frontmatter[key];
    }
    function setCanonicalProperty2(frontmatter, name, value) {
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
    function deleteProperty2(frontmatter, name) {
      const lower = name.toLowerCase();
      for (const key of Object.keys(frontmatter)) {
        if (key.toLowerCase() === lower) delete frontmatter[key];
      }
    }
    function sameEntry(a, b) {
      return !!a && !!b && a.typKey === b.typKey && a.subtypKey === b.subtypKey;
    }
    var TypIndex2 = class extends Events {
      constructor(plugin) {
        super();
        this.plugin = plugin;
        this.app = plugin.app;
        this.entries = /* @__PURE__ */ new Map();
        this.built = false;
        this.aggregates = null;
        this.pendingPaths = /* @__PURE__ */ new Set();
        this.flush = debounce(() => {
          const paths = this.pendingPaths;
          this.pendingPaths = /* @__PURE__ */ new Set();
          this.trigger("change", paths);
        }, FLUSH_DELAY_MS);
      }
      register() {
        const { plugin, app } = this;
        plugin.registerEvent(app.metadataCache.on("changed", (file) => this.update(file)));
        plugin.registerEvent(app.metadataCache.on("deleted", (file) => this.remove(file.path)));
        plugin.registerEvent(app.vault.on("rename", (file, oldPath) => this.rename(file, oldPath)));
        plugin.registerEvent(app.vault.on("config-changed", () => this.aggregates = null));
        const resolvedRef = app.metadataCache.on("resolved", () => {
          app.metadataCache.offref(resolvedRef);
          this.rebuild();
        });
        plugin.registerEvent(resolvedRef);
        plugin.register(() => this.flush.cancel());
      }
      read(file) {
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
        const rawTyp = propertyValue(frontmatter, TYP_PROPERTY2) ?? null;
        const rawSubtyp = propertyValue(frontmatter, SUBTYP_PROPERTY2) ?? null;
        return { typKey: typKeyOf(rawTyp), rawTyp, subtypKey: typKeyOf(rawSubtyp), rawSubtyp };
      }
      ensureBuilt() {
        if (!this.built) this.rebuild();
      }
      rebuild() {
        const previous = this.entries;
        const wasBuilt = this.built;
        this.entries = /* @__PURE__ */ new Map();
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
        return raw !== void 0 && !Array.isArray(raw) && typKey === typKey.trim();
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
        const counts = /* @__PURE__ */ new Map();
        const rawByKey = /* @__PURE__ */ new Map();
        const subtypsByTyp = /* @__PURE__ */ new Map();
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
            bucket = { counts: /* @__PURE__ */ new Map(), noSubtyp: 0, rawByKey: /* @__PURE__ */ new Map() };
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
    };
    var EMPTY_BUCKET = Object.freeze({ counts: /* @__PURE__ */ new Map(), noSubtyp: 0, rawByKey: /* @__PURE__ */ new Map() });
    module2.exports = { TypIndex: TypIndex2, typKeyOf, propertyValue, setCanonicalProperty: setCanonicalProperty2, deleteProperty: deleteProperty2, TYP_PROPERTY: TYP_PROPERTY2, SUBTYP_PROPERTY: SUBTYP_PROPERTY2 };
  }
});

// src/subtyps.js
var require_subtyps = __commonJS({
  "src/subtyps.js"(exports2, module2) {
    var { typKeyOf, propertyValue, setCanonicalProperty: setCanonicalProperty2, SUBTYP_PROPERTY: SUBTYP_PROPERTY2 } = require_typ_index();
    function normalizeSubtypName(raw) {
      return raw.trim().replace(/\S+/g, (word) => word.charAt(0).toLocaleUpperCase("de") + word.slice(1).toLocaleLowerCase("de"));
    }
    function isEmptyValue(value) {
      return value === null || value === void 0 || value === "";
    }
    function getSubtypNames2(settings, typ) {
      return Object.keys(settings.typSubtyps?.[typ] ?? {});
    }
    function getSubtyp2(settings, typ, subtyp) {
      return settings.typSubtyps?.[typ]?.[subtyp] ?? null;
    }
    function ensureSubtyp(settings, typ, subtyp) {
      if (!settings.typSubtyps) settings.typSubtyps = {};
      if (!settings.typSubtyps[typ]) settings.typSubtyps[typ] = {};
      const byName = settings.typSubtyps[typ];
      if (!byName[subtyp]) {
        byName[subtyp] = { frontmatter: {}, floatingKeys: [], shortcuts: {} };
        if (settings.typManual?.[typ] === false) byName[subtyp].manual = false;
      }
      return byName[subtyp];
    }
    function isSubtypManual2(settings, typ, subtyp) {
      return getSubtyp2(settings, typ, subtyp)?.manual !== false;
    }
    function setSubtypManual(settings, typ, subtyp, on) {
      const data = getSubtyp2(settings, typ, subtyp);
      if (!data) return;
      if (on) delete data.manual;
      else data.manual = false;
    }
    function setAllSubtypsManual(settings, typ, on) {
      for (const subtyp of getSubtypNames2(settings, typ)) setSubtypManual(settings, typ, subtyp, on);
    }
    function moveTypSubtyps(settings, oldTyp, newTyp) {
      if (!settings.typSubtyps?.[oldTyp]) return;
      settings.typSubtyps[newTyp] = settings.typSubtyps[oldTyp];
      delete settings.typSubtyps[oldTyp];
    }
    function deleteTypSubtyps(settings, typ) {
      if (settings.typSubtyps) delete settings.typSubtyps[typ];
    }
    function mergeTypSubtyps(settings, source, target) {
      const sourceSubtyps = settings.typSubtyps?.[source];
      if (!sourceSubtyps) return;
      for (const [name, sourceData] of Object.entries(sourceSubtyps)) {
        const targetData = getSubtyp2(settings, target, name);
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
          const shortcut = sourceData.shortcuts?.[key];
          if (shortcut) (targetData.shortcuts ?? (targetData.shortcuts = {}))[key] = shortcut;
        }
      }
      delete settings.typSubtyps[source];
    }
    function renameSubtyp(settings, typ, oldName, newName) {
      const byName = settings.typSubtyps?.[typ];
      if (!byName?.[oldName] || oldName === newName) return;
      settings.typSubtyps[typ] = Object.fromEntries(
        Object.entries(byName).map(([name, data]) => [name === oldName ? newName : name, data])
      );
    }
    function getSectionOrder(settings, typ) {
      return [null, ...getSubtypNames2(settings, typ)];
    }
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
    function mergeSubtyps(settings, typ, source, target) {
      const sourceData = getSubtyp2(settings, typ, source);
      const targetData = getSubtyp2(settings, typ, target);
      if (!sourceData || !targetData || source === target) return;
      const targetKeys = new Map(Object.keys(targetData.frontmatter).map((key) => [key.toLowerCase(), key]));
      for (const [key, value] of Object.entries(sourceData.frontmatter)) {
        if (key === "") continue;
        const existing = targetKeys.get(key.toLowerCase());
        if (existing === void 0) {
          targetData.frontmatter[key] = value;
          targetKeys.set(key.toLowerCase(), key);
          if (sourceData.floatingKeys.includes(key) && !targetData.floatingKeys.includes(key)) targetData.floatingKeys.push(key);
          const shortcut = sourceData.shortcuts?.[key];
          if (shortcut) (targetData.shortcuts ?? (targetData.shortcuts = {}))[key] = shortcut;
        } else if (isEmptyValue(targetData.frontmatter[existing])) {
          targetData.frontmatter[existing] = value;
        }
      }
      deleteSubtyp(settings, typ, source);
    }
    async function renameSubtypInNotes(plugin, typ, oldKey, newValue) {
      let changed = 0;
      for (const file of plugin.typIndex.filesWithSubtyp(typ, oldKey)) {
        let matched = false;
        await plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
          if (typKeyOf(propertyValue(frontmatter, SUBTYP_PROPERTY2)) !== oldKey) return;
          setCanonicalProperty2(frontmatter, SUBTYP_PROPERTY2, newValue);
          matched = true;
        });
        if (matched) changed++;
      }
      return changed;
    }
    module2.exports = {
      normalizeSubtypName,
      isEmptyValue,
      getSubtypNames: getSubtypNames2,
      getSubtyp: getSubtyp2,
      ensureSubtyp,
      isSubtypManual: isSubtypManual2,
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
      renameSubtypInNotes
    };
  }
});

// src/typ-utils.js
var require_typ_utils = __commonJS({
  "src/typ-utils.js"(exports2, module2) {
    function normalizeTypName(raw) {
      return raw.trim().toUpperCase();
    }
    function plural(count, word, pluralWord = `${word}s`) {
      return `${count} ${count === 1 ? word : pluralWord}`;
    }
    function joinAnd(parts) {
      return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
    }
    function hexToHue(hex) {
      const match = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
      if (!match) return null;
      const int = parseInt(match[1], 16);
      const r = (int >> 16 & 255) / 255;
      const g = (int >> 8 & 255) / 255;
      const b = (int & 255) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      if (delta === 0) return null;
      let hue;
      if (max === r) hue = (g - b) / delta % 6;
      else if (max === g) hue = (b - r) / delta + 2;
      else hue = (r - g) / delta + 4;
      hue *= 60;
      return hue < 0 ? hue + 360 : hue;
    }
    function compareTyps(mode, a, b, counts, typColors) {
      const [key, dir] = mode.split("-");
      let cmp;
      if (key === "count") {
        cmp = (counts.get(a) ?? 0) - (counts.get(b) ?? 0);
        if (dir === "desc") cmp = -cmp;
      } else if (key === "color") {
        const hueA = hexToHue(typColors[a] ?? null);
        const hueB = hexToHue(typColors[b] ?? null);
        if (hueA === null && hueB === null) cmp = 0;
        else if (hueA === null) cmp = 1;
        else if (hueB === null) cmp = -1;
        else {
          cmp = hueA - hueB;
          if (dir === "desc") cmp = -cmp;
        }
      } else {
        cmp = a.localeCompare(b);
        if (dir === "desc") cmp = -cmp;
      }
      return cmp || a.localeCompare(b);
    }
    function sortTypsByMode2(typs, mode, counts, typColors) {
      if (mode === "manual") return [...typs];
      return [...typs].sort((a, b) => compareTyps(mode, a, b, counts, typColors));
    }
    module2.exports = { normalizeTypName, plural, joinAnd, hexToHue, compareTyps, sortTypsByMode: sortTypsByMode2 };
  }
});

// src/frontmatter-sort.js
var require_frontmatter_sort = __commonJS({
  "src/frontmatter-sort.js"(exports2, module2) {
    var { Notice } = require("obsidian");
    var { getSubtyp: getSubtyp2 } = require_subtyps();
    var { typKeyOf, propertyValue, TYP_PROPERTY: TYP_PROPERTY2, SUBTYP_PROPERTY: SUBTYP_PROPERTY2 } = require_typ_index();
    var { plural } = require_typ_utils();
    var DEFAULT_GLOBAL_ORDER = [{ kind: "typValue" }, { kind: "subtypValue" }, { kind: "typ" }, { kind: "other" }];
    function normalizeGlobalOrder2(order) {
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
    function orderedDefaultKeys(plugin, typ, subtyp = null) {
      if (!typ) return null;
      const isSystemKey = (key) => key === "" || [TYP_PROPERTY2, SUBTYP_PROPERTY2].some((p) => key.toLowerCase() === p.toLowerCase());
      const subtypData = subtyp ? getSubtyp2(plugin.settings, typ, subtyp) : null;
      const blocks = [plugin.settings.typDefaultFrontmatter[typ], subtypData?.frontmatter];
      const keys = [];
      const seen = /* @__PURE__ */ new Set();
      for (const block of blocks) {
        for (const key of Object.keys(block ?? {})) {
          if (isSystemKey(key) || seen.has(key.toLowerCase())) continue;
          keys.push(key);
          seen.add(key.toLowerCase());
        }
      }
      return keys.length > 0 ? keys : null;
    }
    function computeSortedKeys(existingKeys, globalOrder, typDefaultKeys) {
      const lowerToActual = new Map(existingKeys.map((key) => [key.toLowerCase(), key]));
      const resolve = (name) => lowerToActual.get(name.toLowerCase());
      const pinned = new Set(
        globalOrder.filter((entry) => entry.kind === "property").map((entry) => resolve(entry.name)).filter(Boolean)
      );
      const typKey = resolve(TYP_PROPERTY2);
      const subtypKey = resolve(SUBTYP_PROPERTY2);
      const typBlockKeys = new Set(
        (typDefaultKeys ?? []).map(resolve).filter((key) => key && key !== typKey && !pinned.has(key))
      );
      const claimed = new Set(pinned);
      for (const key of typBlockKeys) claimed.add(key);
      if (typKey) claimed.add(typKey);
      if (subtypKey) claimed.add(subtypKey);
      const sortedKeys = [];
      const seen = /* @__PURE__ */ new Set();
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
      for (const key of existingKeys) push(key);
      return sortedKeys;
    }
    function cachedFrontmatterKeys(app, file) {
      const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter) return null;
      return Object.keys(frontmatter).filter((key) => key !== "position");
    }
    async function sortFileFrontmatter(app, file, globalOrder, typDefaultKeys) {
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
    function sortFrontmatterFor2(plugin, frontmatter, typ, subtyp) {
      const globalOrder = normalizeGlobalOrder2(plugin.settings.globalPropertyOrder);
      return sortFrontmatterObject(frontmatter, globalOrder, orderedDefaultKeys(plugin, typ, subtyp));
    }
    function placePropertyFor2(plugin, frontmatter, key) {
      const existingKeys = Object.keys(frontmatter);
      const actualKey = existingKeys.find((k) => k.toLowerCase() === key.toLowerCase());
      if (!actualKey || existingKeys.length <= 1) return false;
      const globalOrder = normalizeGlobalOrder2(plugin.settings.globalPropertyOrder);
      const typ = typKeyOf(propertyValue(frontmatter, TYP_PROPERTY2));
      const subtyp = typKeyOf(propertyValue(frontmatter, SUBTYP_PROPERTY2));
      const sortedKeys = computeSortedKeys(existingKeys, globalOrder, orderedDefaultKeys(plugin, typ, subtyp));
      const rest = existingKeys.filter((k) => k !== actualKey);
      const predecessor = sortedKeys.slice(0, sortedKeys.indexOf(actualKey)).pop();
      const newKeys = [...rest];
      newKeys.splice(predecessor === void 0 ? 0 : rest.indexOf(predecessor) + 1, 0, actualKey);
      if (newKeys.every((k, i) => k === existingKeys[i])) return false;
      const snapshot = { ...frontmatter };
      for (const k of existingKeys) delete frontmatter[k];
      for (const k of newKeys) frontmatter[k] = snapshot[k];
      return true;
    }
    async function sortSingleFileFrontmatter(app, plugin, file) {
      const globalOrder = normalizeGlobalOrder2(plugin.settings.globalPropertyOrder);
      const typ = plugin.typIndex.typOf(file);
      const typDefaultKeys = orderedDefaultKeys(plugin, typ, plugin.typIndex.subtypOf(file));
      return sortFileFrontmatter(app, file, globalOrder, typDefaultKeys);
    }
    async function sortAllFrontmatter(app, plugin, onlyTyp) {
      let checked = 0;
      let changed = 0;
      const globalOrder = normalizeGlobalOrder2(plugin.settings.globalPropertyOrder);
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
    async function sortTypFrontmatter(plugin, typ) {
      const { checked, changed, hasTypDefaults } = await sortAllFrontmatter(plugin.app, plugin, typ);
      let message = sortSummary(`Frontmatter sorting ${typ}`, checked, changed);
      if (hasTypDefaults === false) {
        message += ` Note: ${typ} has no TYP-Frontmatter, so only the global order was applied.`;
      }
      new Notice(message);
    }
    function sortSummary(label, checked, changed) {
      return changed > 0 ? `${label}: checked ${plural(checked, "note")}, sorted ${changed}.` : `${label}: checked ${plural(checked, "note")}, all already sorted.`;
    }
    module2.exports = {
      sortAllFrontmatter,
      sortSingleFileFrontmatter,
      sortTypFrontmatter,
      sortFrontmatterFor: sortFrontmatterFor2,
      placePropertyFor: placePropertyFor2,
      normalizeGlobalOrder: normalizeGlobalOrder2,
      sortSummary,
      DEFAULT_GLOBAL_ORDER,
      TYP_PROPERTY: TYP_PROPERTY2,
      SUBTYP_PROPERTY: SUBTYP_PROPERTY2
    };
  }
});

// src/frontmatter-order-editor.js
var require_frontmatter_order_editor = __commonJS({
  "src/frontmatter-order-editor.js"(exports2, module2) {
    var { setIcon, Notice } = require("obsidian");
    var { TYP_PROPERTY: TYP_PROPERTY2, SUBTYP_PROPERTY: SUBTYP_PROPERTY2, sortAllFrontmatter, sortSummary } = require_frontmatter_sort();
    var PLACEHOLDER_LABELS = {
      typValue: "TYP",
      subtypValue: "SUBTYP",
      typ: "TYP-Frontmatter",
      other: "Other properties"
    };
    function mountGlobalOrderEditor(containerEl, plugin) {
      const header = containerEl.createDiv({ cls: "typ-frontmatter-header" });
      const titleGroup = header.createDiv({ cls: "typ-frontmatter-title-group" });
      const applyBtn = titleGroup.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Apply to all notes" } });
      setIcon(applyBtn, "play");
      applyBtn.addEventListener("click", async () => {
        try {
          const { checked, changed } = await sortAllFrontmatter(plugin.app, plugin, null);
          new Notice(sortSummary("Frontmatter sorting", checked, changed));
        } catch (error) {
          console.error("[Frontmatter sorting]", error);
          new Notice(`Frontmatter sorting failed: ${error.message}`);
        }
      });
      titleGroup.createDiv({ cls: "typ-detail-section-title", text: "Global property order" });
      const addBtn = header.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Add property" } });
      setIcon(addBtn, "plus");
      const listEl = containerEl.createDiv({ cls: "typ-order-list" });
      const order = () => plugin.settings.globalPropertyOrder;
      let draftEntry = null;
      const isDuplicateName = (value, ownEntry) => {
        const lower = value.toLowerCase();
        if (lower === TYP_PROPERTY2.toLowerCase() || lower === SUBTYP_PROPERTY2.toLowerCase()) return true;
        return order().some((other) => other !== ownEntry && other.kind === "property" && other.name.toLowerCase() === lower);
      };
      const render = () => {
        listEl.empty();
        const entries = draftEntry ? [...order(), draftEntry] : order();
        entries.forEach((entry, index) => {
          const isDraft = entry === draftEntry;
          const isPlaceholder = entry.kind !== "property";
          const rowCls = "typ-order-row" + (isPlaceholder ? " is-placeholder" : "") + (entry.kind === "typ" ? " is-typ-defaults" : "");
          const row = listEl.createDiv({ cls: rowCls });
          const dragHandle = row.createDiv({ cls: "typ-order-drag", attr: { "aria-label": "Drag to move" } });
          setIcon(dragHandle, "grip-vertical");
          if (isPlaceholder) {
            row.createDiv({ cls: "typ-order-label", text: PLACEHOLDER_LABELS[entry.kind] });
          } else {
            const input = row.createEl("input", {
              type: "text",
              cls: "typ-order-name-input",
              attr: { placeholder: "Property name" }
            });
            input.value = entry.name;
            input.addEventListener("blur", async () => {
              const value = input.value.trim();
              if (!value) {
                if (isDraft) {
                  draftEntry = null;
                } else {
                  order().splice(order().indexOf(entry), 1);
                  await plugin.saveSettings();
                }
                render();
                return;
              }
              if (isDuplicateName(value, isDraft ? null : entry)) {
                new Notice(`"${value}" is already in the list.`);
                input.value = entry.name;
                return;
              }
              entry.name = value;
              if (isDraft) {
                order().push(entry);
                draftEntry = null;
              }
              await plugin.saveSettings();
              render();
            });
            const removeBtn = row.createDiv({ cls: "typ-order-remove clickable-icon", attr: { "aria-label": "Remove" } });
            setIcon(removeBtn, "x");
            removeBtn.addEventListener("click", async () => {
              if (isDraft) {
                draftEntry = null;
              } else {
                order().splice(order().indexOf(entry), 1);
                await plugin.saveSettings();
              }
              render();
            });
          }
          if (isDraft) return;
          row.draggable = true;
          row.addEventListener("dragstart", (event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", String(index));
            row.classList.add("is-dragging");
          });
          row.addEventListener("dragend", () => row.classList.remove("is-dragging"));
          row.addEventListener("dragover", (event) => {
            event.preventDefault();
            const rect = row.getBoundingClientRect();
            const isAfter = event.clientY - rect.top > rect.height / 2;
            row.classList.toggle("is-drop-before", !isAfter);
            row.classList.toggle("is-drop-after", isAfter);
          });
          row.addEventListener("dragleave", () => row.classList.remove("is-drop-before", "is-drop-after"));
          row.addEventListener("drop", async (event) => {
            event.preventDefault();
            const isAfter = row.classList.contains("is-drop-after");
            row.classList.remove("is-drop-before", "is-drop-after");
            const fromIndex = Number(event.dataTransfer.getData("text/plain"));
            if (Number.isNaN(fromIndex)) return;
            let insertBefore = isAfter ? index + 1 : index;
            if (fromIndex < insertBefore) insertBefore -= 1;
            const [moved] = order().splice(fromIndex, 1);
            order().splice(insertBefore, 0, moved);
            await plugin.saveSettings();
            render();
          });
        });
      };
      addBtn.addEventListener("click", () => {
        if (!draftEntry) {
          draftEntry = { kind: "property", name: "" };
          render();
        }
        const inputs = listEl.querySelectorAll(".typ-order-name-input");
        inputs[inputs.length - 1]?.focus();
      });
      render();
    }
    module2.exports = { mountGlobalOrderEditor };
  }
});

// src/typ-colors.js
var require_typ_colors = __commonJS({
  "src/typ-colors.js"(exports2, module2) {
    var { getSubtyp: getSubtyp2 } = require_subtyps();
    var DEFAULT_TYP_COLOR = "#888888";
    var SUBTYP_COLOR_CHANNELS = [
      { key: "h", label: "Hue", unit: "\xB0" },
      // { key: "s", label: "Saturation", unit: "%", downOnly: true },
      { key: "l", label: "Lightness", unit: "%" }
    ];
    var DEFAULT_SUBTYP_COLOR_RANGES = {
      h: 35,
      /* s: 40, */
      l: 40
    };
    function colorRange(settings, key) {
      const value = Number(settings.subtypColorRanges?.[key]);
      return Number.isFinite(value) && value >= 0 ? value : DEFAULT_SUBTYP_COLOR_RANGES[key];
    }
    function channelBounds(settings, key) {
      const range = colorRange(settings, key);
      return SUBTYP_COLOR_CHANNELS.find((channel) => channel.key === key)?.downOnly ? [-range, 0] : [-range, range];
    }
    function clampedOffset(settings, offset) {
      if (!offset) return null;
      const result = {};
      for (const { key } of SUBTYP_COLOR_CHANNELS) {
        const [min, max] = channelBounds(settings, key);
        result[key] = Math.min(max, Math.max(min, Number(offset[key]) || 0));
      }
      return result;
    }
    var toLinear = (c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    var toGamma = (c) => c <= 31308e-7 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    function hexToOklch(hex) {
      const match = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
      if (!match) return null;
      const int = parseInt(match[1], 16);
      const [r, g, b] = [int >> 16 & 255, int >> 8 & 255, int & 255].map((c) => toLinear(c / 255));
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
      const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
      const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
      const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
      const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
      const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
      return { L, C: Math.hypot(A, B), H: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360 };
    }
    function oklchToLinear({ L, C, H }) {
      const A = C * Math.cos(H * Math.PI / 180);
      const B = C * Math.sin(H * Math.PI / 180);
      const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
      const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
      const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
      return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
      ];
    }
    var inGamut = (rgb) => rgb.every((c) => c >= -1e-4 && c <= 1.0001);
    function maxChroma(L, H) {
      let low = 0;
      let high = 0.4;
      for (let i = 0; i < 20; i++) {
        const mid = (low + high) / 2;
        if (inGamut(oklchToLinear({ L, C: mid, H }))) low = mid;
        else high = mid;
      }
      return low;
    }
    function oklchToHex(color) {
      let rgb = oklchToLinear(color);
      if (!inGamut(rgb)) rgb = oklchToLinear({ ...color, C: maxChroma(color.L, color.H) });
      return "#" + rgb.map((c) => Math.round(Math.min(1, Math.max(0, toGamma(Math.min(1, Math.max(0, c))))) * 255)).map((c) => c.toString(16).padStart(2, "0")).join("");
    }
    var cuspCache = /* @__PURE__ */ new Map();
    var NEUTRAL_CHROMA = 1e-4;
    function cuspLightness(H) {
      const key = Math.round(H) % 360;
      const cached = cuspCache.get(key);
      if (cached !== void 0) return cached;
      let low = 0;
      let high = 1;
      for (let i = 0; i < 24; i++) {
        const third = (high - low) / 3;
        if (maxChroma(low + third, key) < maxChroma(high - third, key)) low += third;
        else high -= third;
      }
      const result = (low + high) / 2;
      cuspCache.set(key, result);
      return result;
    }
    function remapToCusp(L, fromH, toH) {
      const from = cuspLightness(fromH);
      const to = cuspLightness(toH);
      if (L <= from) return from > 0 ? L / from * to : to;
      return from < 1 ? to + (L - from) / (1 - from) * (1 - to) : to;
    }
    var offsetCache = /* @__PURE__ */ new Map();
    function applyColorOffset(hex, offset) {
      if (!offset) return hex;
      const cacheKey = hex + "|" + (offset.h ?? 0) + "|" + (offset.l ?? 0);
      const cached = offsetCache.get(cacheKey);
      if (cached !== void 0) return cached;
      const result = computeColorOffset(hex, offset);
      if (offsetCache.size > 500) offsetCache.clear();
      offsetCache.set(cacheKey, result);
      return result;
    }
    function computeColorOffset(hex, offset) {
      const base = hexToOklch(hex);
      if (!base) return hex;
      const H = (base.H + (offset.h ?? 0) + 360) % 360;
      const baseCeiling = maxChroma(base.L, base.H);
      const neutral = base.C < NEUTRAL_CHROMA || baseCeiling <= 0;
      const relative = neutral ? 0 : base.C / baseCeiling;
      const shifted = neutral ? base.L : remapToCusp(base.L, base.H, H);
      const share = (offset.l ?? 0) / 100;
      const L = Math.min(1, Math.max(0, shifted + share * (share >= 0 ? 1 - shifted : shifted)));
      const C = relative * maxChroma(L, H);
      return oklchToHex({ L, C: Math.max(0, C), H });
    }
    function hasColorOffset(offset) {
      return !!offset && SUBTYP_COLOR_CHANNELS.some(({ key }) => (offset[key] ?? 0) !== 0);
    }
    function subtypColor(settings, typ, subtyp) {
      const typColor = settings.typColors[typ] ?? null;
      if (!typColor || !subtyp) return typColor;
      const offset = clampedOffset(settings, getSubtyp2(settings, typ, subtyp)?.color);
      return hasColorOffset(offset) ? applyColorOffset(typColor, offset) : typColor;
    }
    function subtypHasOwnColor(settings, typ, subtyp) {
      return hasColorOffset(clampedOffset(settings, getSubtyp2(settings, typ, subtyp)?.color));
    }
    function nameColor(settings, typ, subtyp = null) {
      const useSubtyp = !!subtyp && settings.colorViews.typListSubtyp;
      const typColor = settings.typColors[typ] ?? null;
      return {
        color: (useSubtyp ? subtypColor(settings, typ, subtyp) : typColor) ?? DEFAULT_TYP_COLOR,
        isDefault: !typColor || useSubtyp && !subtypHasOwnColor(settings, typ, subtyp)
      };
    }
    function paintColorDot(el, color, isDefault) {
      el.style.backgroundColor = isDefault ? "transparent" : color;
      el.style.boxShadow = isDefault ? `inset 0 0 0 max(1.5px, 0.15em) ${color}` : "";
    }
    function colorForFile(plugin, file, viewKey = null) {
      const typ = plugin.typIndex.typOf(file);
      if (!typ) return null;
      const { settings } = plugin;
      if (!viewKey || !settings.colorViews[`${viewKey}Subtyp`]) return settings.typColors[typ] ?? null;
      return subtypColor(settings, typ, plugin.typIndex.subtypOf(file));
    }
    var COLORED_ATTR = "data-typ-colored";
    function setInlineColor(el, color, priority = "") {
      if (color) {
        el.style.setProperty("color", color, priority);
        el.setAttribute(COLORED_ATTR, "");
      } else if (el.hasAttribute(COLORED_ATTR)) {
        el.style.removeProperty("color");
        el.removeAttribute(COLORED_ATTR);
      }
    }
    function clearInlineColors2(doc) {
      for (const el of doc.querySelectorAll(`[${COLORED_ATTR}]`)) setInlineColor(el, null);
    }
    function allDocuments2(app) {
      const docs = /* @__PURE__ */ new Set();
      app.workspace.iterateAllLeaves((leaf) => docs.add(leaf.view.containerEl.ownerDocument));
      return docs;
    }
    module2.exports = {
      setInlineColor,
      clearInlineColors: clearInlineColors2,
      allDocuments: allDocuments2,
      colorForFile,
      nameColor,
      DEFAULT_TYP_COLOR,
      subtypColor,
      applyColorOffset,
      hasColorOffset,
      subtypHasOwnColor,
      paintColorDot,
      colorRange,
      channelBounds,
      clampedOffset,
      SUBTYP_COLOR_CHANNELS,
      DEFAULT_SUBTYP_COLOR_RANGES
    };
  }
});

// src/settings.js
var require_settings = __commonJS({
  "src/settings.js"(exports2, module2) {
    var { PluginSettingTab, SettingGroup, ToggleComponent, DropdownComponent, debounce } = require("obsidian");
    var { mountGlobalOrderEditor } = require_frontmatter_order_editor();
    var { DEFAULT_GLOBAL_ORDER } = require_frontmatter_sort();
    var { SUBTYP_COLOR_CHANNELS, DEFAULT_SUBTYP_COLOR_RANGES, colorRange } = require_typ_colors();
    var DEFAULT_SETTINGS2 = {
      typs: [],
      typColors: {},
      typDescriptions: {},
      typDefaultFrontmatter: {},
      // Keys of typDefaultFrontmatter[typ] marked as floating. They share the list
      // and its order (which frontmatter sorting uses), but getTypDefaults() leaves
      // them out unless asked with includeFloating, so new notes don't get them
      // automatically.
      typFloatingKeys: {},
      // Shortcuts per key of typDefaultFrontmatter[typ]:
      //   { [TYP]: { [Property]: { name: "today" | "tp.<script>" } } }
      // Kept NEXT TO the frontmatter, not as its value - see shortcuts.js.
      typShortcuts: {},
      typManual: {},
      // Registered Subtyps per TYP with their own frontmatter block, see subtyps.js.
      typSubtyps: {},
      // Pinned single properties (kind: "property") plus the four fixed
      // placeholders "typValue", "subtypValue", "typ" and "other" - see
      // frontmatter-sort.js.
      globalPropertyOrder: DEFAULT_GLOBAL_ORDER,
      // How the open note shows its TYP (see active-title-colors.js): "none",
      // "dot" or "badge". The three badge settings below only matter for "badge".
      // colorViews.noteTitleColor (the title text itself) is independent.
      noteTitleStyle: "dot",
      // Badge colored (TYP color) or neutral (text-muted).
      noteTitleBadgeColored: true,
      // Badge label: "typ" ([TYP]), "typ-subtyp" ([TYP/Subtyp]) or "subtyp"
      // ([Subtyp]; no badge without a Subtyp). Colored in the TYP or Subtyp color;
      // for "typ-subtyp" chosen with colorViews.noteTitleMarkerSubtyp.
      noteTitleBadgeLabel: "typ",
      // "title" (next to the inline title) or "block" (left of the property
      // block, turned 90°).
      noteTitleBadgePosition: "title",
      // For position "block": top or bottom edge of the property block.
      noteTitleVerticalAlign: "top",
      typSortOrder: "count-desc",
      // What the TYP-List shows next to the name: "subtyps", "description" or
      // "none". Switched by the header button next to sorting (SECONDARY_MODES in
      // typ-pane.js), not here: like the sort order it only concerns that list.
      typListSecondary: "subtyps",
      // See pickTypAndSubtyp in typ-picker.js: false = each Subtyp indented in the
      // TYP-Picker, true = a separate Subtyp-Picker after the TYP choice.
      separateSubtypPicker: false,
      includeIgnoredFiles: false,
      // Ask before deleting a TYP or a Subtyp with properties. Only deletions that
      // touch nothing but these settings can be switched off ("Don't ask again" in
      // the dialog) - they can be undone (undo.js). Anything that rewrites notes
      // or files always asks.
      confirmDeletion: true,
      // Own tag/attachment colors in the graph disabled (2026-09-30): the Minimal
      // theme's Style Settings cover both, see graph-colors.js.
      // graphTagColorEnabled: false,
      // graphTagColor: "",
      // graphAttachmentColorEnabled: false,
      // graphAttachmentColor: "",
      // How far a Subtyp's color may differ from its TYP's (±), see typ-colors.js:
      // hue in degrees, lightness in % of the way to white or black.
      subtypColorRanges: { ...DEFAULT_SUBTYP_COLOR_RANGES },
      colorViews: {
        fileExplorer: true,
        graph: true,
        search: true,
        recentFiles: true,
        backlinks: true,
        bookmarks: true,
        // "<view>Subtyp" sub-toggles: use a note's Subtyp color instead of its
        // TYP's (see colorForFile in typ-colors.js).
        fileExplorerSubtyp: true,
        graphSubtyp: true,
        searchSubtyp: true,
        recentFilesSubtyp: true,
        backlinksSubtyp: true,
        bookmarksSubtyp: true,
        linksSubtyp: true,
        typListSubtyp: true,
        noteTitleColorSubtyp: true,
        noteTitleMarkerSubtyp: true,
        frontmatterDefaults: true,
        // Sub-toggle of frontmatterDefaults and allProperties: include the Subtyp
        // blocks (see frontmatter-default-highlight.js); for allProperties also in
        // the Subtyp color.
        frontmatterDefaultsSubtyp: true,
        typList: true,
        allProperties: true,
        allPropertiesSubtyp: true,
        noteTitleColor: true,
        links: true
      }
    };
    var TypSystemSettingTab2 = class extends PluginSettingTab {
      constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
      }
      // Each section is a SettingGroup (heading plus one box, entries separated by
      // lines), like Obsidian's core settings. Settings created one by one with
      // new Setting(containerEl) would each get their own small box.
      display() {
        const { containerEl } = this;
        const { scrollTop } = containerEl;
        containerEl.empty();
        new SettingGroup(containerEl).setHeading("TYP-List").addSetting(
          (setting) => setting.setName("Include excluded files").setDesc(
            `Count notes from Obsidian's "Excluded files" (e.g. folders hidden by Hide Folders) in TYP counts, the TYP-Picker and frontmatter sorting.`
          ).addToggle(
            (toggle) => toggle.setValue(this.plugin.settings.includeIgnoredFiles).onChange(async (value) => {
              this.plugin.settings.includeIgnoredFiles = value;
              await this.plugin.saveSettings();
              this.plugin.refreshTypColors?.();
            })
          )
        ).addSetting(
          (setting) => setting.setName("Confirm deletion").setDesc(
            "Ask before deleting a TYP or a Subtyp with properties. When off, they are deleted at once; either way the notice afterwards offers Undo. Dialogs that rewrite notes (rename and update notes, merge) always ask."
          ).addToggle(
            (toggle) => toggle.setValue(this.plugin.settings.confirmDeletion).onChange(async (value) => {
              this.plugin.settings.confirmDeletion = value;
              await this.plugin.saveSettings();
            })
          )
        );
        new SettingGroup(containerEl).setHeading("TYP-Picker").addSetting(
          (setting) => setting.setName("Separate Subtyp-Picker").setDesc(
            "After choosing a TYP, choose the Subtyp in a second picker. When off, each Subtyp is listed indented below its TYP."
          ).addToggle(
            (toggle) => toggle.setValue(this.plugin.settings.separateSubtypPicker).onChange(async (value) => {
              this.plugin.settings.separateSubtypPicker = value;
              await this.plugin.saveSettings();
            })
          )
        );
        const colorViewToggle = (group, key, name, desc, subtypKey = null, { typTooltip = "Color by TYP", subtypTooltip = "Use Subtyp color instead of TYP color" } = {}) => group.addSetting((setting) => {
          setting.setName(name).setDesc(desc);
          const save = async (settingKey, value) => {
            this.plugin.settings.colorViews[settingKey] = value;
            await this.plugin.saveSettings();
            this.plugin.refreshTypColors?.();
          };
          if (!subtypKey) {
            setting.addToggle((toggle) => toggle.setValue(this.plugin.settings.colorViews[key]).onChange((value) => save(key, value)));
            return;
          }
          setting.settingEl.addClass("typ-note-title-setting");
          const addRow = (label, tooltip, settingKey, onChanged) => {
            const row = setting.controlEl.createDiv({ cls: "typ-note-title-toggle-row" });
            row.createSpan({ cls: "typ-note-title-toggle-label", text: label });
            new ToggleComponent(row).setTooltip(tooltip).setValue(this.plugin.settings.colorViews[settingKey]).onChange(async (value) => {
              await save(settingKey, value);
              onChanged?.();
            });
          };
          addRow("TYP", typTooltip, key, () => this.display());
          if (this.plugin.settings.colorViews[key]) addRow("Subtyp", subtypTooltip, subtypKey);
        });
        const coloringGroup = new SettingGroup(containerEl).setHeading("Coloring");
        colorViewToggle(coloringGroup, "fileExplorer", "File explorer", "Color note names in the file explorer.", "fileExplorerSubtyp");
        colorViewToggle(coloringGroup, "graph", "Graph", "Color nodes in the global and local graph.", "graphSubtyp");
        colorViewToggle(coloringGroup, "search", "Search", "Color result titles in search.", "searchSubtyp");
        colorViewToggle(coloringGroup, "recentFiles", "Recent Files", "Color entries in the Recent Files plugin.", "recentFilesSubtyp");
        colorViewToggle(
          coloringGroup,
          "links",
          "Links in notes",
          "Color internal links by the TYP of their target (reading view, Live Preview, hover preview). Unresolved links stay as they are.",
          "linksSubtyp"
        );
        colorViewToggle(coloringGroup, "typList", "TYP-Pane", "Color names in the TYP-Pane and TYP-Picker.", "typListSubtyp");
        colorViewToggle(
          coloringGroup,
          "noteTitleColor",
          "Color note title",
          "Color the inline title of the open note.",
          "noteTitleColorSubtyp"
        );
        const isBadge = this.plugin.settings.noteTitleStyle === "badge";
        const isBlockPosition = this.plugin.settings.noteTitleBadgePosition === "block";
        coloringGroup.addSetting((noteTitleSetting) => {
          noteTitleSetting.setName("TYP marker in note").setDesc(isBadge ? "Badge options: label, color, position." : "How the open note shows its TYP.").addDropdown(
            (dropdown) => dropdown.addOption("none", "None").addOption("dot", "Dot at title").addOption("badge", "Badge with TYP name").setValue(this.plugin.settings.noteTitleStyle).onChange(async (value) => {
              this.plugin.settings.noteTitleStyle = value;
              await this.plugin.saveSettings();
              this.plugin.refreshTypColors?.();
              this.display();
            })
          );
          const badgeLabel = this.plugin.settings.noteTitleBadgeLabel ?? "typ";
          const showSubtyp = this.plugin.settings.noteTitleStyle === "dot" || isBadge && this.plugin.settings.noteTitleBadgeColored && badgeLabel === "typ-subtyp";
          if (!isBadge && !showSubtyp) return;
          noteTitleSetting.settingEl.addClass("typ-note-title-setting");
          const addLabeledToggle = (label, tooltip, value, onChange) => {
            const row = noteTitleSetting.controlEl.createDiv({ cls: "typ-note-title-toggle-row" });
            row.createSpan({ cls: "typ-note-title-toggle-label", text: label });
            new ToggleComponent(row).setTooltip(tooltip).setValue(value).onChange(onChange);
          };
          const addSubtypToggle = (label) => addLabeledToggle(
            label,
            "Use Subtyp color instead of TYP color",
            this.plugin.settings.colorViews.noteTitleMarkerSubtyp,
            async (value) => {
              this.plugin.settings.colorViews.noteTitleMarkerSubtyp = value;
              await this.plugin.saveSettings();
              this.plugin.refreshTypColors?.();
            }
          );
          if (!isBadge) {
            addSubtypToggle("Subtyp");
            return;
          }
          const labelRow = noteTitleSetting.controlEl.createDiv({ cls: "typ-note-title-toggle-row" });
          labelRow.createSpan({ cls: "typ-note-title-toggle-label", text: "Label" });
          new DropdownComponent(labelRow).addOption("typ", "[TYP]").addOption("typ-subtyp", "[TYP/Subtyp]").addOption("subtyp", "[Subtyp]").setValue(badgeLabel).onChange(async (value) => {
            this.plugin.settings.noteTitleBadgeLabel = value;
            await this.plugin.saveSettings();
            this.plugin.refreshTypColors?.();
            this.display();
          });
          addLabeledToggle("Colored", "Colored instead of neutral", this.plugin.settings.noteTitleBadgeColored, async (value) => {
            this.plugin.settings.noteTitleBadgeColored = value;
            await this.plugin.saveSettings();
            this.plugin.refreshTypColors?.();
            this.display();
          });
          if (showSubtyp) addSubtypToggle("Subtyp color");
          addLabeledToggle("At property block", "At the property block (rotated) instead of the title", isBlockPosition, async (value) => {
            this.plugin.settings.noteTitleBadgePosition = value ? "block" : "title";
            await this.plugin.saveSettings();
            this.plugin.refreshTypColors?.();
            this.display();
          });
          if (isBlockPosition) {
            addLabeledToggle(
              "Top instead of bottom",
              "Top of the property block instead of bottom",
              this.plugin.settings.noteTitleVerticalAlign === "top",
              async (value) => {
                this.plugin.settings.noteTitleVerticalAlign = value ? "top" : "bottom";
                await this.plugin.saveSettings();
                this.plugin.refreshTypColors?.();
              }
            );
          }
        });
        colorViewToggle(
          coloringGroup,
          "backlinks",
          "Backlinks",
          "Color results in the backlinks pane and in embedded backlinks, including unlinked mentions.",
          "backlinksSubtyp"
        );
        colorViewToggle(coloringGroup, "bookmarks", "Bookmarks", "Color bookmarks that point directly to a note.", "bookmarksSubtyp");
        colorViewToggle(
          coloringGroup,
          "allProperties",
          "All Properties",
          `In Obsidian's "All properties" view, color property names that belong to exactly one TYP-Frontmatter, or bold them if more than one TYP uses them. With Subtyp, Subtyp blocks count as well, in the Subtyp color.`,
          "allPropertiesSubtyp",
          { typTooltip: "TYP-Frontmatter", subtypTooltip: "Include Subtyp blocks, in Subtyp color" }
        );
        const subtypColorGroup = new SettingGroup(containerEl).setHeading("Subtyp colors");
        const rangeMax = {
          h: 180,
          /* s: 100, */
          l: 100
        };
        const rangeDesc = {
          h: "Maximum hue difference between a Subtyp and its TYP.",
          // s: "Maximum share by which a Subtyp may be paler than its TYP. Only goes down - a Subtyp shouldn't be louder than its TYP.",
          l: "Maximum lightness difference between a Subtyp and its TYP, as a share of the way to white or black."
        };
        const refreshColorsSoon = debounce(() => this.plugin.refreshTypColors?.(), 300, true);
        for (const { key, label, unit, downOnly } of SUBTYP_COLOR_CHANNELS) {
          subtypColorGroup.addSetting(
            (setting) => setting.setName(`${label} (${downOnly ? "\u2212" : "\xB1"} ${unit})`).setDesc(rangeDesc[key]).addSlider(
              (slider) => slider.setLimits(0, rangeMax[key], 1).setValue(colorRange(this.plugin.settings, key)).setDynamicTooltip().onChange(async (value) => {
                this.plugin.settings.subtypColorRanges = { ...DEFAULT_SUBTYP_COLOR_RANGES, ...this.plugin.settings.subtypColorRanges, [key]: value };
                await this.plugin.saveSettings();
                refreshColorsSoon();
              })
            ).addExtraButton(
              (button) => button.setIcon("rotate-ccw").setTooltip(`Reset to ${DEFAULT_SUBTYP_COLOR_RANGES[key]}`).onClick(async () => {
                this.plugin.settings.subtypColorRanges = { ...DEFAULT_SUBTYP_COLOR_RANGES, ...this.plugin.settings.subtypColorRanges, [key]: DEFAULT_SUBTYP_COLOR_RANGES[key] };
                await this.plugin.saveSettings();
                this.plugin.refreshTypColors?.();
                this.display();
              })
            )
          );
        }
        const frontmatterGroup = new SettingGroup(containerEl).setHeading("TYP-Frontmatter");
        colorViewToggle(
          frontmatterGroup,
          "frontmatterDefaults",
          "Bold TYP properties",
          "Show TYP-Frontmatter property names in bold in notes and the properties sidebar. With Subtyp, the note's Subtyp block counts as well.",
          "frontmatterDefaultsSubtyp",
          { typTooltip: "TYP-Frontmatter", subtypTooltip: "Include Subtyp blocks" }
        );
        frontmatterGroup.addSetting((setting) => {
          setting.settingEl.addClass("typ-order-setting");
          mountGlobalOrderEditor(setting.infoEl, this.plugin);
          setting.infoEl.createDiv({
            cls: "setting-item-description",
            text: `Order applied by the "Sort frontmatter" commands; values are never changed. Pin single properties such as cssclasses or aliases. TYP and SUBTYP are the properties themselves, "TYP-Frontmatter" is the TYP's list followed by its Subtyp block, "Other properties" is everything else. Drag to reorder; the four placeholder rows can't be removed.`
          });
        });
        containerEl.scrollTop = scrollTop;
      }
    };
    module2.exports = { DEFAULT_SETTINGS: DEFAULT_SETTINGS2, TypSystemSettingTab: TypSystemSettingTab2 };
  }
});

// src/base-dialogs.js
var require_base_dialogs = __commonJS({
  "src/base-dialogs.js"(exports2, module2) {
    var { Modal, Setting } = require("obsidian");
    var { plural } = require_typ_utils();
    var NOTE_PREFIX = "note.";
    function columnLabel(id) {
      return id.startsWith(NOTE_PREFIX) ? id.slice(NOTE_PREFIX.length) : id;
    }
    function targetLabel(target) {
      if (!target.typ) return `Subtyp ${target.subtyp}`;
      return target.subtyp ? `${target.typ} / ${target.subtyp}` : `TYP ${target.typ}`;
    }
    var ColumnOptionsModal = class extends Modal {
      constructor(plugin, target, preview, resolve) {
        super(plugin.app);
        this.plugin = plugin;
        this.target = target;
        this.preview = preview;
        this.resolve = resolve;
        this.options = { floating: false, allSubtyps: false, tags: false };
        this.confirmed = false;
      }
      onOpen() {
        const { contentEl } = this;
        this.modalEl.addClass("typ-base-options-modal");
        this.titleEl.setText(`Columns for ${targetLabel(this.target)}`);
        const toggle = (name, description, key) => {
          new Setting(contentEl).setName(name).setDesc(description).addToggle(
            (control) => control.setValue(this.options[key]).onChange((value) => {
              this.options[key] = value;
              this.renderPreview();
            })
          );
        };
        toggle("Floating properties", "Include the block's floating (italic) properties.", "floating");
        if (!this.target.subtyp) {
          toggle("All Subtyp properties", "Also include the properties of every Subtyp block of this TYP.", "allSubtyps");
        }
        toggle("tags", "Add the tags property as a column.", "tags");
        this.previewEl = contentEl.createDiv({ cls: "typ-base-preview" });
        this.renderPreview();
        const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
        buttonRow.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
        const confirm = buttonRow.createEl("button", { cls: "mod-cta", text: "Apply" });
        confirm.addEventListener("click", () => {
          this.confirmed = true;
          this.close();
        });
      }
      renderPreview() {
        const ids = this.preview(this.options);
        this.previewEl.empty();
        this.previewEl.createDiv({ cls: "typ-base-preview-title", text: plural(ids.length, "column") });
        const list = this.previewEl.createDiv({ cls: "typ-base-preview-list" });
        for (const id of ids) list.createSpan({ cls: "typ-base-preview-column", text: columnLabel(id) });
      }
      onClose() {
        this.contentEl.empty();
        this.resolve(this.confirmed ? this.options : null);
      }
    };
    function askColumnOptions(plugin, target, preview) {
      return new Promise((resolve) => new ColumnOptionsModal(plugin, target, preview, resolve).open());
    }
    var RemovalModal = class extends Modal {
      constructor(plugin, columns, viewName, resolve) {
        super(plugin.app);
        this.columns = columns;
        this.viewName = viewName;
        this.resolve = resolve;
        this.marked = new Set(columns);
        this.confirmed = false;
      }
      onOpen() {
        const { contentEl } = this;
        this.modalEl.addClass("typ-base-removal-modal");
        this.titleEl.setText(`Remove columns from "${this.viewName}"`);
        contentEl.createEl("p", {
          cls: "typ-base-removal-intro",
          text: "These columns don't belong to the TYP. Unchecked ones are kept."
        });
        for (const id of this.columns) {
          new Setting(contentEl).setName(columnLabel(id)).addToggle(
            (control) => control.setValue(true).onChange((value) => {
              if (value) this.marked.add(id);
              else this.marked.delete(id);
            })
          );
        }
        const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
        buttonRow.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
        const confirm = buttonRow.createEl("button", { cls: "mod-cta", text: "Apply" });
        confirm.addEventListener("click", () => {
          this.confirmed = true;
          this.close();
        });
      }
      onClose() {
        this.contentEl.empty();
        this.resolve(this.confirmed ? this.marked : null);
      }
    };
    function askRemovals(plugin, columns, viewName) {
      return new Promise((resolve) => new RemovalModal(plugin, columns, viewName, resolve).open());
    }
    module2.exports = { askColumnOptions, askRemovals };
  }
});

// src/bases.js
var require_bases = __commonJS({
  "src/bases.js"(exports2, module2) {
    var { Notice, TFile, stringifyYaml } = require("obsidian");
    var { getSubtypNames: getSubtypNames2 } = require_subtyps();
    var { normalizeGlobalOrder: normalizeGlobalOrder2, TYP_PROPERTY: TYP_PROPERTY2, SUBTYP_PROPERTY: SUBTYP_PROPERTY2 } = require_frontmatter_sort();
    var { askColumnOptions, askRemovals } = require_base_dialogs();
    var { plural } = require_typ_utils();
    var FILE_NAME_ID = "file.name";
    var NOTE_PREFIX = "note.";
    var TAGS_PROPERTY = "tags";
    var BASE_EXTENSION = "base";
    var BASES_PLUGIN_ID = "bases";
    function isBasesEnabled(app) {
      return !!app.internalPlugins?.getEnabledPluginById?.(BASES_PLUGIN_ID);
    }
    function noteId(key) {
      return NOTE_PREFIX + key;
    }
    function serializeId(id) {
      return id.startsWith(NOTE_PREFIX) ? id.slice(NOTE_PREFIX.length) : id;
    }
    function sameId(a, b) {
      return a.toLowerCase() === b.toLowerCase();
    }
    function equalsFilter(property, value) {
      return `${property} == ${JSON.stringify(String(value))}`;
    }
    var EQUALS_PATTERN = new RegExp(`^\\s*(${TYP_PROPERTY2}|${SUBTYP_PROPERTY2})\\s*==\\s*(.+?)\\s*$`, "i");
    function filterLiteral(raw) {
      if (raw.length >= 2 && raw[0] === '"' && raw.endsWith('"')) {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }
      if (raw.length >= 2 && raw[0] === "'" && raw.endsWith("'")) return raw.slice(1, -1);
      return null;
    }
    function collectEquals(node, found) {
      if (!node) return;
      if (typeof node === "string") {
        const match = EQUALS_PATTERN.exec(node);
        if (!match) return;
        const value = filterLiteral(match[2]);
        if (value !== null) found[match[1].toUpperCase()].add(value);
        return;
      }
      if (Array.isArray(node)) {
        for (const entry of node) collectEquals(entry, found);
        return;
      }
      if (node.and) collectEquals(node.and, found);
    }
    function readTarget(...filterGroups) {
      const found = { [TYP_PROPERTY2]: /* @__PURE__ */ new Set(), [SUBTYP_PROPERTY2]: /* @__PURE__ */ new Set() };
      for (const group of filterGroups) collectEquals(group, found);
      const typs = [...found[TYP_PROPERTY2]];
      const subtyps = [...found[SUBTYP_PROPERTY2]];
      if (typs.length > 1 || subtyps.length > 1) return null;
      if (typs.length === 0 && subtyps.length === 0) return null;
      return { typ: typs[0] ?? null, subtyp: subtyps[0] ?? null };
    }
    function isSystemKey(key) {
      return key === "" || sameId(key, TYP_PROPERTY2) || sameId(key, SUBTYP_PROPERTY2);
    }
    function blockKeys(plugin, typ, subtyp, includeFloating) {
      const { defaults } = plugin.collectBlocks(typ, subtyp, includeFloating);
      return Object.keys(defaults).filter((key) => !isSystemKey(key));
    }
    function typsForSubtyp(plugin, subtyp) {
      return plugin.settings.typs.filter((typ) => getSubtypNames2(plugin.settings, typ).includes(subtyp));
    }
    function targetKeys(plugin, target, options) {
      const seen = /* @__PURE__ */ new Set();
      const main = [];
      const others = [];
      const add = (list, keys) => {
        for (const key of keys) {
          const lower = key.toLowerCase();
          if (seen.has(lower)) continue;
          seen.add(lower);
          list.push(key);
        }
      };
      if (!target.typ) {
        for (const typ of typsForSubtyp(plugin, target.subtyp)) {
          add(main, blockKeys(plugin, typ, target.subtyp, options.floating));
        }
        return { main, others };
      }
      add(main, blockKeys(plugin, target.typ, target.subtyp, options.floating));
      if (options.allSubtyps && !target.subtyp) {
        for (const subtyp of getSubtypNames2(plugin.settings, target.typ)) {
          add(others, blockKeys(plugin, target.typ, subtyp, options.floating));
        }
      }
      return { main, others };
    }
    function columnIds(plugin, target, options) {
      const { main, others } = targetKeys(plugin, target, options);
      const ids = [];
      const seen = /* @__PURE__ */ new Set();
      const push = (id) => {
        const lower = id.toLowerCase();
        if (seen.has(lower)) return;
        seen.add(lower);
        ids.push(id);
      };
      push(FILE_NAME_ID);
      let tagsPlaced = false;
      for (const entry of normalizeGlobalOrder2(plugin.settings.globalPropertyOrder)) {
        if (entry.kind === "property") {
          if (options.tags && entry.name && sameId(entry.name, TAGS_PROPERTY)) {
            push(noteId(entry.name));
            tagsPlaced = true;
          }
        } else if (entry.kind === "typ") {
          for (const key of main) push(noteId(key));
        } else if (entry.kind === "other") {
          for (const key of others) push(noteId(key));
        }
      }
      if (options.tags && !tagsPlaced) push(noteId(TAGS_PROPERTY));
      return ids;
    }
    function targetViews(plugin, target, options, { scoped }) {
      if (!target.typ) {
        const view = {
          type: "table",
          name: target.subtyp,
          order: columnIds(plugin, target, options)
        };
        if (scoped) view.filters = { and: [equalsFilter(SUBTYP_PROPERTY2, target.subtyp)] };
        if (typsForSubtyp(plugin, target.subtyp).length > 1) {
          view.groupBy = { property: noteId(TYP_PROPERTY2), direction: "ASC" };
        }
        return [view];
      }
      const typ = target.typ;
      const subtyps = getSubtypNames2(plugin.settings, typ);
      const main = {
        type: "table",
        name: typ,
        order: columnIds(plugin, { typ, subtyp: null }, options)
      };
      if (scoped) main.filters = { and: [equalsFilter(TYP_PROPERTY2, typ)] };
      if (subtyps.length > 0) main.groupBy = { property: noteId(SUBTYP_PROPERTY2), direction: "ASC" };
      const views = [main];
      for (const subtyp of subtyps) {
        views.push({
          type: "table",
          name: subtyp,
          // allSubtyps is always off in a Subtyp view (see targetKeys).
          order: columnIds(plugin, { typ, subtyp }, { ...options, allSubtyps: false }),
          filters: {
            and: scoped ? [equalsFilter(TYP_PROPERTY2, typ), equalsFilter(SUBTYP_PROPERTY2, subtyp)] : [equalsFilter(SUBTYP_PROPERTY2, subtyp)]
          }
        });
      }
      return views;
    }
    function serializeView(view) {
      const out = { type: view.type, name: view.name };
      if (view.filters) out.filters = view.filters;
      if (view.order) out.order = view.order.map(serializeId);
      if (view.groupBy) {
        out.groupBy = { property: serializeId(view.groupBy.property), direction: view.groupBy.direction };
      }
      return out;
    }
    function waitFor(ms) {
      return new Promise((resolve) => window.setTimeout(resolve, ms));
    }
    async function openBase(app, file) {
      const open = app.workspace.getLeavesOfType("bases").find((leaf2) => leaf2.view?.file?.path === file.path);
      const leaf = open ?? app.workspace.getLeaf("tab");
      if (open) app.workspace.revealLeaf(leaf);
      else await leaf.openFile(file, { active: true });
      for (let attempt = 0; attempt < 40 && !leaf.view?.query; attempt++) await waitFor(25);
      return leaf.view?.query ? leaf.view : null;
    }
    async function appendViews(app, view, views) {
      const data = view.query.getSerializable();
      data.views = [...data.views ?? [], ...views.map(serializeView)];
      await app.vault.process(view.file, () => stringifyYaml(data));
    }
    async function createBase(plugin, target, options) {
      const app = plugin.app;
      const name = target.subtyp ?? target.typ;
      const path = `${name}.${BASE_EXTENSION}`;
      const existing = app.vault.getAbstractFileByPath(path);
      if (existing && !(existing instanceof TFile)) {
        new Notice(`"${path}" is not a file \u2013 Base not created.`);
        return;
      }
      if (!existing) {
        const views = targetViews(plugin, target, options, { scoped: false });
        const root = target.typ ? { and: [equalsFilter(TYP_PROPERTY2, target.typ)] } : { and: [equalsFilter(SUBTYP_PROPERTY2, target.subtyp)] };
        const file = await app.vault.create(path, stringifyYaml({ filters: root, views: views.map(serializeView) }));
        await openBase(app, file);
        new Notice(`Created ${path} with ${plural(views.length, "view")}.`);
        return;
      }
      const view = await openBase(app, existing);
      if (!view) {
        new Notice(`Couldn't read ${path} \u2013 Base not updated.`);
        return;
      }
      const present = new Set(view.query.views.map((cfg) => cfg.name));
      const wanted = targetViews(plugin, target, options, { scoped: true });
      const toAdd = wanted.filter((entry) => !present.has(entry.name));
      const skipped = wanted.filter((entry) => present.has(entry.name)).map((entry) => entry.name);
      if (toAdd.length > 0) await appendViews(app, view, toAdd);
      const parts = [];
      parts.push(toAdd.length > 0 ? `${path}: added ${plural(toAdd.length, "view")}.` : `${path}: nothing to add.`);
      if (skipped.length > 0) parts.push(`Already present, left unchanged: ${skipped.join(", ")}.`);
      new Notice(parts.join(" "));
    }
    async function createBaseCommand(plugin) {
      const choice = await plugin.pickTypAndSubtyp({ includeManualOff: true });
      if (!choice) return;
      const target = choice.subtyp ? { typ: null, subtyp: choice.subtyp } : { typ: choice.typ, subtyp: null };
      await createBaseFor(plugin, target);
    }
    async function createBaseFor(plugin, target) {
      const options = await askColumnOptions(plugin, target, (current) => columnIds(plugin, target, current));
      if (!options) return;
      await createBase(plugin, target, options);
    }
    function activeBaseView(plugin) {
      const leaf = plugin.app.workspace.getMostRecentLeaf();
      const view = leaf?.view;
      if (!view || typeof view.getViewType !== "function" || view.getViewType() !== "bases") return null;
      return view.query ? view : null;
    }
    function serializeFilters(filters) {
      return typeof filters?.serialize === "function" ? filters.serialize() : null;
    }
    async function updateActiveView(plugin, view) {
      const query = view.query;
      const viewName = view.controller?.viewName;
      const cfg = (viewName ? query.getViewConfig(viewName) : null) ?? query.views[0];
      if (!cfg) {
        new Notice("No active view.");
        return;
      }
      let target = readTarget(serializeFilters(query.filters), serializeFilters(cfg.filters));
      if (!target) {
        const choice = await plugin.pickTypAndSubtyp({ includeManualOff: true });
        if (!choice) return;
        target = { typ: choice.typ, subtyp: choice.subtyp };
        const and = [equalsFilter(TYP_PROPERTY2, choice.typ)];
        if (choice.subtyp) and.push(equalsFilter(SUBTYP_PROPERTY2, choice.subtyp));
        query.setViewFilters(cfg.name, { and });
      }
      const options = await askColumnOptions(plugin, target, (current2) => columnIds(plugin, target, current2));
      if (!options) return;
      const desired = columnIds(plugin, target, options);
      const desiredLower = new Set(desired.map((id) => id.toLowerCase()));
      const current = Array.isArray(cfg.order) ? [...cfg.order] : [];
      const extras = current.filter((id) => !desiredLower.has(id.toLowerCase()));
      let kept = [];
      if (extras.length > 0) {
        const removals = await askRemovals(plugin, extras, cfg.name);
        if (!removals) return;
        kept = extras.filter((id) => !removals.has(id));
      }
      const newOrder = [
        FILE_NAME_ID,
        ...kept.filter((id) => !sameId(id, FILE_NAME_ID)),
        ...desired.filter((id) => !sameId(id, FILE_NAME_ID))
      ];
      if (newOrder.length === current.length && newOrder.every((id, index) => id === current[index])) {
        new Notice(`View "${cfg.name}": columns are already up to date.`);
        return;
      }
      const added = desired.filter((id) => !current.some((existing) => sameId(existing, id))).length;
      const removed = extras.length - kept.length;
      cfg.setOrder(newOrder);
      new Notice(`View "${cfg.name}": added ${plural(added, "column")}, removed ${removed}.`);
    }
    module2.exports = {
      isBasesEnabled,
      createBaseCommand,
      createBaseFor,
      activeBaseView,
      updateActiveView,
      // Exposed for testing single building blocks
      columnIds,
      readTarget,
      targetViews
    };
  }
});

// src/commands.js
var require_commands = __commonJS({
  "src/commands.js"(exports2, module2) {
    var { Notice } = require("obsidian");
    var { sortAllFrontmatter, sortSingleFileFrontmatter, sortTypFrontmatter, sortSummary } = require_frontmatter_sort();
    var { isBasesEnabled, createBaseCommand, activeBaseView, updateActiveView } = require_bases();
    var runOrReportError = (label, fn) => async () => {
      try {
        await fn();
      } catch (error) {
        console.error(`[${label}]`, error);
        new Notice(`${label} failed: ${error.message}`);
      }
    };
    function registerCommands2(plugin) {
      plugin.addCommand({
        id: "sort-frontmatter-all",
        name: "Sort frontmatter in all notes",
        callback: runOrReportError("Frontmatter sorting", async () => {
          const { checked, changed } = await sortAllFrontmatter(plugin.app, plugin, null);
          new Notice(sortSummary("Frontmatter sorting", checked, changed));
        })
      });
      plugin.addCommand({
        id: "sort-frontmatter-typ",
        name: "Sort frontmatter for one TYP",
        callback: runOrReportError("Frontmatter sorting", async () => {
          const typ = await plugin.pickTyp({ includeManualOff: true, includeUnregistered: true });
          if (!typ) return;
          await sortTypFrontmatter(plugin, typ);
        })
      });
      plugin.addCommand({
        id: "sort-frontmatter-active-note",
        name: "Sort frontmatter of active note",
        checkCallback: (checking) => {
          const file = plugin.app.workspace.getActiveFile();
          if (!file || file.extension !== "md") return false;
          if (checking) return true;
          runOrReportError("Frontmatter sorting", async () => {
            const changed = await sortSingleFileFrontmatter(plugin.app, plugin, file);
            new Notice(changed ? `Sorted frontmatter of "${file.basename}".` : `Frontmatter of "${file.basename}" was already sorted.`);
          })();
          return true;
        }
      });
      plugin.addCommand({
        id: "create-base-for-typ",
        name: "Create Base for TYP",
        checkCallback: (checking) => {
          if (!isBasesEnabled(plugin.app)) return false;
          if (checking) return true;
          runOrReportError("Create Base", () => createBaseCommand(plugin))();
          return true;
        }
      });
      plugin.addCommand({
        id: "update-base-view-columns",
        name: "Update columns of Base view",
        checkCallback: (checking) => {
          const view = activeBaseView(plugin);
          if (!view) return false;
          if (checking) return true;
          runOrReportError("Update Base", () => updateActiveView(plugin, view))();
          return true;
        }
      });
    }
    module2.exports = { registerCommands: registerCommands2, runOrReportError };
  }
});

// src/confirm-modal.js
var require_confirm_modal = __commonJS({
  "src/confirm-modal.js"(exports2, module2) {
    var { ConfirmationModal, Platform } = require("obsidian");
    var { nameColor, paintColorDot, DEFAULT_TYP_COLOR } = require_typ_colors();
    function appendTypName(parentEl, plugin, typ, color) {
      if (plugin.settings.colorViews.typList) {
        const nameEl = parentEl.createSpan({ cls: "typ-inline-name", text: typ });
        if (color) nameEl.style.color = color;
      } else {
        paintColorDot(parentEl.createSpan({ cls: "typ-inline-dot" }), color ?? DEFAULT_TYP_COLOR, !color);
        parentEl.createSpan({ cls: "typ-inline-name", text: typ });
      }
    }
    function appendSubtypName(parentEl, plugin, typ, name, colorSubtyp = name) {
      const { color, isDefault } = nameColor(plugin.settings, typ, colorSubtyp);
      if (plugin.settings.colorViews.typList) {
        const nameEl = parentEl.createSpan({ cls: "typ-inline-name", text: name });
        if (plugin.settings.typColors[typ]) nameEl.style.color = color;
      } else {
        paintColorDot(parentEl.createSpan({ cls: "typ-inline-dot" }), color, isDefault);
        parentEl.createSpan({ cls: "typ-inline-name", text: name });
      }
    }
    var typNameNode = (plugin, typ, color) => createFragment((f) => appendTypName(f, plugin, typ, color));
    var subtypNameNode = (plugin, typ, name, colorSubtyp = name) => createFragment((f) => appendSubtypName(f, plugin, typ, name, colorSubtyp));
    function appendParts(el, parts) {
      for (const part of Array.isArray(parts) ? parts : [parts]) {
        if (typeof part === "string") el.appendText(part);
        else el.appendChild(part);
      }
    }
    var ConfirmModal = class extends ConfirmationModal {
      constructor(app, { title, body = [], confirmText, warning = false, focus = "confirm", dontAskAgain = false, onConfirm, onCancel }) {
        super(app);
        this.title = title;
        this.body = body;
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;
        this.confirmed = false;
        this.dontAskAgain = false;
        if (dontAskAgain && !Platform.isMobile) {
          this.addCheckbox("Don't ask again", (checked) => {
            this.dontAskAgain = checked;
          });
        }
        this.addButton((button) => {
          button.setButtonText("Cancel").setCancel();
          if (focus === "cancel") button.setInitialFocus();
        });
        this.addButton((button) => {
          button.setButtonText(confirmText).setCta();
          if (warning) button.setDestructive();
          if (focus === "confirm") button.setInitialFocus();
          button.onClick(() => {
            this.confirmed = true;
          });
        });
      }
      onOpen() {
        appendParts(this.titleEl, this.title);
        for (const paragraph of this.body) appendParts(this.contentEl.createEl("p"), paragraph);
      }
      onClose() {
        super.onClose();
        this.contentEl.empty();
        if (this.confirmed) this.onConfirm?.(this.dontAskAgain);
        else this.onCancel?.();
      }
    };
    module2.exports = { ConfirmModal, appendTypName, appendSubtypName, typNameNode, subtypNameNode };
  }
});

// src/undo.js
var require_undo = __commonJS({
  "src/undo.js"(exports2, module2) {
    var { Notice } = require("obsidian");
    var UNDO_NOTICE_DURATION = 8e3;
    var current = null;
    function snapshotSettings(plugin) {
      return structuredClone(plugin.settings);
    }
    function offerUndo(plugin, message, snapshot) {
      const token = {};
      current = { token, revision: plugin.settingsRevision ?? 0, snapshot };
      const fragment = createFragment((f) => {
        f.appendText(message);
        const button = f.createEl("button", { cls: "typ-undo-button", text: "Undo" });
        button.addEventListener("click", () => undo(plugin, token));
      });
      new Notice(fragment, UNDO_NOTICE_DURATION);
    }
    async function undo(plugin, token) {
      if (current?.token !== token || (plugin.settingsRevision ?? 0) !== current.revision) {
        new Notice("Can't undo \u2013 the settings have changed since.");
        return;
      }
      const { snapshot } = current;
      current = null;
      for (const key of Object.keys(plugin.settings)) delete plugin.settings[key];
      Object.assign(plugin.settings, snapshot);
      await plugin.saveSettings();
      plugin.refreshTypColors?.();
    }
    module2.exports = { snapshotSettings, offerUndo };
  }
});

// src/shortcuts.js
var require_shortcuts = __commonJS({
  "src/shortcuts.js"(exports2, module2) {
    var { moment } = require("obsidian");
    var FIXED_SHORTCUTS = [
      {
        name: "today",
        description: "Heutiges Datum (JJJJ-MM-TT)",
        resolve: () => moment().format("YYYY-MM-DD")
      },
      {
        name: "now",
        description: "Aktuelles Datum mit Uhrzeit (JJJJ-MM-TT HH:mm)",
        resolve: () => moment().format("YYYY-MM-DD HH:mm")
      },
      {
        // The file's creation date (file.stat.ctime), not the call time; falls
        // back to now without a file.
        name: "created",
        description: "Erstellungsdatum der Datei (JJJJ-MM-TT)",
        resolve: (file) => moment(file?.stat?.ctime ?? Date.now()).format("YYYY-MM-DD")
      }
    ];
    var SCRIPT_PREFIX = "tp.";
    function findFixedShortcut(name) {
      return FIXED_SHORTCUTS.find((shortcut) => shortcut.name === name) ?? null;
    }
    function scriptNameOf2(name) {
      return typeof name === "string" && name.startsWith(SCRIPT_PREFIX) ? name.slice(SCRIPT_PREFIX.length) : null;
    }
    function isScriptShortcut(record) {
      return scriptNameOf2(record?.name) !== null;
    }
    function shortcutLabel(record) {
      if (!record?.name) return "";
      const values = Object.values(record.args ?? {}).filter((value) => value !== void 0);
      return values.length > 0 ? `${record.name}: ${values.join(", ")}` : record.name;
    }
    function parseArgValue(raw) {
      const text = String(raw ?? "").trim();
      if (text === "") return void 0;
      if (text === "true") return true;
      if (text === "false") return false;
      if (text === "null") return null;
      if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
      return text;
    }
    var RESERVED_PARAMS = ["newFile", "ctx", "key"];
    function inputParams(params) {
      return (params ?? []).filter((name) => name !== "tp" && !RESERVED_PARAMS.includes(name));
    }
    function buildArgs(params, inputs) {
      const args = {};
      for (const name of inputParams(params)) {
        const value = parseArgValue(inputs[name]);
        if (value !== void 0) args[name] = value;
      }
      return args;
    }
    function resolveCallArgs2(params, args, reserved = {}) {
      if (params === null || params === void 0) return [reserved.newFile, reserved.ctx];
      const callArgs = [];
      const objectIndex = /* @__PURE__ */ new Map();
      for (const name of params) {
        if (name === "tp") continue;
        if (RESERVED_PARAMS.includes(name)) {
          callArgs.push(reserved[name]);
          continue;
        }
        const dot = name.indexOf(".");
        if (dot === -1) {
          callArgs.push(args?.[name]);
          continue;
        }
        const base = name.slice(0, dot);
        if (!objectIndex.has(base)) {
          objectIndex.set(base, callArgs.length);
          callArgs.push({});
        }
        const value = args?.[name];
        if (value !== void 0) callArgs[objectIndex.get(base)][name.slice(dot + 1)] = value;
      }
      return callArgs;
    }
    function isListProperty(app, key) {
      return app?.metadataTypeManager?.getTypeInfo?.(key)?.expected?.type === "multitext";
    }
    function resolveShortcuts2(frontmatter, shortcuts, { file, app } = {}) {
      const resolved = {};
      for (const [key, value] of Object.entries(frontmatter)) {
        const record = shortcuts?.[key];
        const fixed = record ? findFixedShortcut(record.name) : null;
        if (fixed) {
          const result = fixed.resolve(file);
          resolved[key] = isListProperty(app, key) ? [result] : result;
        } else if (isScriptShortcut(record)) {
          resolved[key] = null;
        } else {
          resolved[key] = value;
        }
      }
      return resolved;
    }
    module2.exports = {
      FIXED_SHORTCUTS,
      SCRIPT_PREFIX,
      findFixedShortcut,
      scriptNameOf: scriptNameOf2,
      isScriptShortcut,
      shortcutLabel,
      parseArgValue,
      buildArgs,
      inputParams,
      resolveCallArgs: resolveCallArgs2,
      RESERVED_PARAMS,
      resolveShortcuts: resolveShortcuts2
    };
  }
});

// src/shortcut-picker.js
var require_shortcut_picker = __commonJS({
  "src/shortcut-picker.js"(exports2, module2) {
    var { FuzzySuggestModal, Modal, Setting } = require("obsidian");
    var { FIXED_SHORTCUTS, SCRIPT_PREFIX, buildArgs, inputParams } = require_shortcuts();
    function itemLabel(item) {
      return item.params ? `${item.name}(${item.params.join(", ")})` : item.name;
    }
    var ShortcutPickerModal = class extends FuzzySuggestModal {
      constructor(app, key, items, resolve) {
        super(app);
        this.items = items;
        this.resolve = resolve;
        this.chosen = false;
        this.setPlaceholder(`Shortcut f\xFCr \u201E${key}\u201C \u2013 ESC f\xFCr Abbruch`);
      }
      getItems() {
        return this.items;
      }
      // Fuzzy search also covers the description: "Erstellungsdatum" finds "created".
      getItemText(item) {
        const label = itemLabel(item);
        return item.description ? `${label} ${item.description}` : label;
      }
      renderSuggestion(match, el) {
        const item = match.item;
        el.addClass("typ-shortcut-suggestion");
        el.createEl("code", { cls: "typ-shortcut-suggestion-name", text: itemLabel(item) });
        if (item.description) el.createSpan({ cls: "typ-shortcut-suggestion-desc", text: item.description });
      }
      // Obsidian's selectSuggestion() calls close() BEFORE onChooseItem(), so
      // "chosen" must be set here - otherwise onClose() resolves with null first
      // and the choice is lost. Same as in TypPickerModal (typ-picker.js).
      selectSuggestion(item, evt) {
        this.chosen = true;
        super.selectSuggestion(item, evt);
      }
      onChooseItem(item) {
        this.resolve(item);
      }
      onClose() {
        super.onClose();
        if (!this.chosen) this.resolve(null);
      }
    };
    var ShortcutArgsModal = class extends Modal {
      constructor(app, item, existing, resolve) {
        super(app);
        this.item = item;
        this.resolve = resolve;
        this.fields = inputParams(item.params);
        this.inputs = {};
        for (const name of this.fields) {
          const value = existing?.[name];
          this.inputs[name] = value === void 0 || value === null ? "" : String(value);
        }
        this.confirmed = false;
      }
      onOpen() {
        this.titleEl.setText(`Argumente f\xFCr ${this.item.name}`);
        if (this.item.description) {
          this.contentEl.createDiv({ cls: "typ-shortcut-args-desc", text: this.item.description });
        }
        for (const name of this.fields) {
          new Setting(this.contentEl).setName(name).addText(
            (text) => text.setValue(this.inputs[name]).onChange((value) => {
              this.inputs[name] = value;
            }).inputEl.addEventListener("keydown", (event) => {
              if (event.key === "Enter" && !event.isComposing) {
                event.preventDefault();
                this.submit();
              }
            })
          );
        }
        new Setting(this.contentEl).addButton(
          (button) => button.setButtonText("\xDCbernehmen").setCta().onClick(() => this.submit())
        );
      }
      submit() {
        this.confirmed = true;
        this.close();
      }
      onClose() {
        this.contentEl.empty();
        this.resolve(this.confirmed ? buildArgs(this.fields, this.inputs) : null);
      }
    };
    async function pickShortcut(app, key, getScripts, current = null) {
      const items = [
        ...FIXED_SHORTCUTS.map(({ name, description }) => ({ name, description, params: null })),
        ...getScripts().map(({ name, params, description }) => ({ name: SCRIPT_PREFIX + name, params, description }))
      ];
      const item = await new Promise((resolve) => new ShortcutPickerModal(app, key, items, resolve).open());
      if (!item) return null;
      if (inputParams(item.params).length === 0) return { name: item.name };
      const prefill = current?.name === item.name ? current.args : null;
      const args = await new Promise((resolve) => new ShortcutArgsModal(app, item, prefill, resolve).open());
      if (args === null) return null;
      return Object.keys(args).length > 0 ? { name: item.name, args } : { name: item.name };
    }
    module2.exports = { pickShortcut };
  }
});

// src/typ-frontmatter-editor.js
var require_typ_frontmatter_editor = __commonJS({
  "src/typ-frontmatter-editor.js"(exports2, module2) {
    var { MarkdownView, Menu, WorkspaceLeaf, setIcon } = require("obsidian");
    var { shortcutLabel } = require_shortcuts();
    var { pickShortcut } = require_shortcut_picker();
    var { getSubtyp: getSubtyp2, ensureSubtyp } = require_subtyps();
    var { TYP_PROPERTY: TYP_PROPERTY2, SUBTYP_PROPERTY: SUBTYP_PROPERTY2 } = require_typ_index();
    var { snapshotSettings, offerUndo } = require_undo();
    var EDITOR_CLASS = "typ-frontmatter-editor";
    var SYSTEM_PROPERTIES = [TYP_PROPERTY2.toLowerCase(), SUBTYP_PROPERTY2.toLowerCase()];
    function stripTypProperty(frontmatter) {
      for (const key of Object.keys(frontmatter)) {
        if (SYSTEM_PROPERTIES.includes(key.trim().toLowerCase())) delete frontmatter[key];
      }
      return frontmatter;
    }
    function typStore(plugin, typ) {
      return {
        typ,
        subtyp: null,
        getFrontmatter: () => plugin.settings.typDefaultFrontmatter[typ] ?? {},
        setFrontmatter: (frontmatter) => {
          plugin.settings.typDefaultFrontmatter[typ] = frontmatter;
        },
        getFloating: () => plugin.settings.typFloatingKeys[typ] ?? [],
        setFloating: (keys) => {
          if (keys.length > 0) plugin.settings.typFloatingKeys[typ] = keys;
          else delete plugin.settings.typFloatingKeys[typ];
        },
        getShortcuts: () => plugin.settings.typShortcuts[typ] ?? {},
        setShortcuts: (shortcuts) => {
          if (Object.keys(shortcuts).length > 0) plugin.settings.typShortcuts[typ] = shortcuts;
          else delete plugin.settings.typShortcuts[typ];
        }
      };
    }
    function subtypStore(plugin, typ, subtyp) {
      return {
        typ,
        subtyp,
        getFrontmatter: () => getSubtyp2(plugin.settings, typ, subtyp)?.frontmatter ?? {},
        setFrontmatter: (frontmatter) => {
          ensureSubtyp(plugin.settings, typ, subtyp).frontmatter = frontmatter;
        },
        getFloating: () => getSubtyp2(plugin.settings, typ, subtyp)?.floatingKeys ?? [],
        setFloating: (keys) => {
          ensureSubtyp(plugin.settings, typ, subtyp).floatingKeys = keys;
        },
        getShortcuts: () => getSubtyp2(plugin.settings, typ, subtyp)?.shortcuts ?? {},
        setShortcuts: (shortcuts) => {
          ensureSubtyp(plugin.settings, typ, subtyp).shortcuts = shortcuts;
        }
      };
    }
    var cachedEditorClass = null;
    function getMetadataEditorClass(app) {
      if (cachedEditorClass) return cachedEditorClass;
      const active = app.workspace.getActiveViewOfType(MarkdownView);
      if (active?.metadataEditor) {
        cachedEditorClass = active.metadataEditor.constructor;
        return cachedEditorClass;
      }
      for (const leaf of app.workspace.getLeavesOfType("markdown")) {
        if (leaf.view?.metadataEditor) {
          cachedEditorClass = leaf.view.metadataEditor.constructor;
          return cachedEditorClass;
        }
      }
      cachedEditorClass = harvestEditorClass(app);
      return cachedEditorClass;
    }
    function harvestEditorClass(app) {
      let view = null;
      try {
        const createView = app.viewRegistry?.getViewCreatorByType?.("markdown");
        if (!createView) return null;
        view = createView(new WorkspaceLeaf(app));
        return view.metadataEditor?.constructor ?? null;
      } catch (error) {
        console.error("[typ-system] couldn't find the MetadataEditor class", error);
        return null;
      } finally {
        try {
          view?.unload();
        } catch (error) {
          console.error("[typ-system] couldn't discard the helper MarkdownView", error);
        }
      }
    }
    var cachedPropertyRowClass = null;
    function getPropertyRowClass(app, editor) {
      if (cachedPropertyRowClass) return cachedPropertyRowClass;
      if (editor?.rendered?.[0]) {
        cachedPropertyRowClass = editor.rendered[0].constructor;
        return cachedPropertyRowClass;
      }
      const active = app.workspace.getActiveViewOfType(MarkdownView);
      if (active?.metadataEditor?.rendered?.[0]) {
        cachedPropertyRowClass = active.metadataEditor.rendered[0].constructor;
        return cachedPropertyRowClass;
      }
      for (const leaf of app.workspace.getLeavesOfType("markdown")) {
        if (leaf.view?.metadataEditor?.rendered?.[0]) {
          cachedPropertyRowClass = leaf.view.metadataEditor.rendered[0].constructor;
          return cachedPropertyRowClass;
        }
      }
      return null;
    }
    var undoPropertyMenuPatch = null;
    function ensurePropertyMenuPatch(app, editor) {
      const RowClass = getPropertyRowClass(app, editor);
      if (!RowClass || RowClass._typSystemMenuPatched) return;
      RowClass._typSystemMenuPatched = true;
      const originalShowPropertyMenu = RowClass.prototype.showPropertyMenu;
      undoPropertyMenuPatch = () => {
        RowClass.prototype.showPropertyMenu = originalShowPropertyMenu;
        delete RowClass._typSystemMenuPatched;
      };
      RowClass.prototype.showPropertyMenu = function(event) {
        const owner = this.metadataEditor?.owner;
        if (!owner?.typStore) return originalShowPropertyMenu.call(this, event);
        const row = this;
        const originalShowAtMouseEvent = Menu.prototype.showAtMouseEvent;
        Menu.prototype.showAtMouseEvent = function(mouseEvent) {
          Menu.prototype.showAtMouseEvent = originalShowAtMouseEvent;
          const isFloating = owner.typStore.getFloating().includes(row.entry.key);
          this.addItem(
            (item) => item.setTitle("Floating").setIcon("pin-off").setChecked(isFloating).setSection("title").onClick(() => toggleFloatingProperty(owner.typPane, owner.typStore, row.entry.key))
          );
          return originalShowAtMouseEvent.call(this, mouseEvent);
        };
        return originalShowPropertyMenu.call(this, event);
      };
    }
    function removePropertyMenuPatch2() {
      undoPropertyMenuPatch?.();
      undoPropertyMenuPatch = null;
    }
    function toggleFloatingProperty(view, store, key) {
      const floating = store.getFloating();
      store.setFloating(floating.includes(key) ? floating.filter((k) => k !== key) : [...floating, key]);
      view.plugin.saveSettings();
      view.plugin.refreshTypColorsExcept?.(view);
    }
    function registerFocusChain(editor, onShiftFocus) {
      editor.containerEl.addEventListener(
        "keydown",
        (event) => {
          if (event.isComposing || event.defaultPrevented) return;
          if (editor.selectedLines?.size > 1) return;
          if (event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) return;
          const index = editor.rendered.findIndex((row) => row.containerEl === event.target);
          if (index === -1) return;
          const up = event.key === "ArrowUp" || event.key === "k" || event.key === "Tab" && event.shiftKey;
          const down = event.key === "ArrowDown" || event.key === "j" || event.key === "Tab" && !event.shiftKey;
          let step = 0;
          if (up && index === 0) step = -1;
          else if (down && index === editor.rendered.length - 1) step = 1;
          if (step === 0 || !onShiftFocus(step)) return;
          event.preventDefault();
          event.stopPropagation();
        },
        true
      );
    }
    function mountFrontmatterEditor(view, containerEl, store, { onShiftFocus } = {}) {
      const app = view.app;
      const EditorClass = getMetadataEditorClass(app);
      if (!EditorClass) {
        containerEl.createEl("p", {
          cls: "typ-frontmatter-unavailable",
          text: "Zum Initialisieren des Editors bitte zuerst einmal eine Notiz \xF6ffnen."
        });
        return null;
      }
      const owner = {
        app,
        // Lets ensurePropertyMenuPatch() recognize rows of this editor and gives
        // the global menu patch the store and view per row (the patch itself is
        // installed only once).
        typStore: store,
        typPane: view,
        getFile() {
          return null;
        },
        // Only for Obsidian's hover preview of internal links in a value; any
        // string will do.
        getHoverSource() {
          return "typ-frontmatter";
        },
        shiftFocusBefore() {
        },
        shiftFocusAfter() {
        },
        // Called once per completed change (a rename only on blur of the key
        // input), so each call adds and/or removes at most one non-empty property,
        // except a multi-delete. That keeps the floating flag easy to track
        // without following intermediate typing states.
        saveFrontmatter(frontmatter) {
          stripTypProperty(frontmatter);
          const previous = store.getFrontmatter();
          const previousKeys = Object.keys(previous).filter((key) => key !== "");
          const currentKeys = Object.keys(frontmatter).filter((key) => key !== "");
          const removedKeys = previousKeys.filter((key) => !currentKeys.includes(key));
          const addedKeys = currentKeys.filter((key) => !previousKeys.includes(key));
          const removedOnly = removedKeys.length > 0 && addedKeys.length === 0;
          const undoSnapshot = removedOnly ? snapshotSettings(view.plugin) : null;
          let floating = store.getFloating();
          if (removedKeys.length === 1 && addedKeys.length === 1) {
            floating = floating.map((key) => key === removedKeys[0] ? addedKeys[0] : key);
          } else {
            if (removedKeys.length > 0) floating = floating.filter((key) => !removedKeys.includes(key));
            if (editor.typPendingFloatingAdd && addedKeys.length === 1) {
              floating = [...floating, addedKeys[0]];
              editor.typPendingFloatingAdd = false;
            }
          }
          const shortcuts = { ...store.getShortcuts() };
          if (removedKeys.length === 1 && addedKeys.length === 1) {
            if (shortcuts[removedKeys[0]]) {
              shortcuts[addedKeys[0]] = shortcuts[removedKeys[0]];
              delete shortcuts[removedKeys[0]];
            }
          } else {
            for (const key of removedKeys) delete shortcuts[key];
          }
          store.setFrontmatter(frontmatter);
          store.setFloating(floating);
          store.setShortcuts(shortcuts);
          view.plugin.saveSettings();
          if (undoSnapshot) {
            const blockName = store.subtyp ?? store.typ;
            offerUndo(
              view.plugin,
              removedKeys.length === 1 ? `Property "${removedKeys[0]}" removed from ${blockName}.` : `${removedKeys.length} properties removed from ${blockName}.`,
              undoSnapshot
            );
          }
          renderShortcutControls(view, editor, store);
          view.plugin.refreshTypColorsExcept?.(view);
        }
      };
      const editor = new EditorClass(app, owner);
      editor.typPendingFloatingAdd = false;
      if (onShiftFocus) registerFocusChain(editor, onShiftFocus);
      editor.containerEl.addClass(EDITOR_CLASS);
      containerEl.appendChild(editor.containerEl);
      view.addChild(editor);
      editor.synchronize(store.getFrontmatter());
      renderShortcutControls(view, editor, store);
      ensurePropertyMenuPatch(app, editor);
      return editor;
    }
    var CHIP_CLASS = "typ-shortcut-chip";
    var CHIP_TEXT_CLASS = "typ-shortcut-chip-text";
    var BUTTON_CLASS = "typ-shortcut-button";
    var ROW_CLASS = "typ-has-shortcut";
    var WARNING_CLASS = "typ-shortcut-blocked";
    function renderShortcutControls(view, editor, store) {
      const shortcuts = store.getShortcuts();
      for (const row of editor.rendered ?? []) {
        const containerEl = row.containerEl;
        const key = row.entry?.key ?? "";
        const record = key === "" ? null : shortcuts[key] ?? null;
        containerEl.toggleClass(ROW_CLASS, !!record);
        const mismatch = !!row.typeInfo && row.typeInfo.expected !== row.typeInfo.inferred;
        containerEl.toggleClass(WARNING_CLASS, mismatch && !record);
        let buttonEl = containerEl.querySelector(`:scope > .${BUTTON_CLASS}`);
        if (key === "") {
          buttonEl?.remove();
          containerEl.querySelector(`:scope > .${CHIP_CLASS}`)?.remove();
          continue;
        }
        if (!buttonEl) {
          buttonEl = containerEl.createDiv({ cls: `clickable-icon ${BUTTON_CLASS}` });
          setIcon(buttonEl, "square-function");
          buttonEl.addEventListener("click", () => {
            if (store.getShortcuts()[row.entry?.key ?? ""]) removeShortcut(view, editor, store, row);
            else openShortcutPicker(view, editor, store, row);
          });
        }
        buttonEl.setAttr("aria-label", record ? "Shortcut entfernen" : "Shortcut setzen");
        let chipEl = containerEl.querySelector(`:scope > .${CHIP_CLASS}`);
        if (!record) {
          chipEl?.remove();
          continue;
        }
        if (!chipEl) {
          chipEl = createEl("code", { cls: CHIP_CLASS });
          chipEl.createSpan({ cls: CHIP_TEXT_CLASS });
          chipEl.setAttr("aria-label", "Shortcut \xE4ndern");
          chipEl.addEventListener("click", () => openShortcutPicker(view, editor, store, row));
          containerEl.insertBefore(chipEl, buttonEl);
        }
        chipEl.firstElementChild.setText(shortcutLabel(record));
      }
    }
    async function openShortcutPicker(view, editor, store, row) {
      const key = row.entry?.key ?? "";
      if (key === "") return;
      const record = await pickShortcut(view.app, key, view.plugin.getShortcutScripts, store.getShortcuts()[key] ?? null);
      if (!record) return;
      if (!Object.hasOwn(store.getFrontmatter(), key)) return;
      store.setShortcuts({ ...store.getShortcuts(), [key]: record });
      saveShortcuts(view, editor, store);
    }
    function removeShortcut(view, editor, store, row) {
      const key = row.entry?.key ?? "";
      const shortcuts = { ...store.getShortcuts() };
      if (!(key in shortcuts)) return;
      const snapshot = snapshotSettings(view.plugin);
      delete shortcuts[key];
      store.setShortcuts(shortcuts);
      saveShortcuts(view, editor, store);
      offerUndo(view.plugin, `Shortcut removed from "${key}".`, snapshot);
    }
    function saveShortcuts(view, editor, store) {
      view.plugin.saveSettings();
      renderShortcutControls(view, editor, store);
    }
    function addBlankProperty(editor) {
      if (!editor) return;
      const current = editor.serialize();
      if (!current.hasOwnProperty("")) {
        current[""] = null;
        editor.synchronize(current);
        renderShortcutControls(editor.owner.typPane, editor, editor.owner.typStore);
      }
      editor.focusKey("");
      ensurePropertyMenuPatch(editor.owner.app, editor);
    }
    module2.exports = { mountFrontmatterEditor, addBlankProperty, ensurePropertyMenuPatch, removePropertyMenuPatch: removePropertyMenuPatch2, typStore, subtypStore };
  }
});

// src/frontmatter-blocks.js
var require_frontmatter_blocks = __commonJS({
  "src/frontmatter-blocks.js"(exports2, module2) {
    var { mountFrontmatterEditor, addBlankProperty, typStore, subtypStore } = require_typ_frontmatter_editor();
    var { getSectionOrder, isEmptyValue } = require_subtyps();
    function isGrabTarget(target) {
      if (target.closest(".clickable-icon, .typ-subtyp-color-dot, [contenteditable='true'], input, textarea")) return false;
      return !target.closest(".metadata-property");
    }
    function mountFrontmatterBlocks(view, containerEl, typ, { renderHeader, renderFooter, onMoveSection }) {
      const wrapper = containerEl.createDiv({ cls: "typ-blocks" });
      const sections = getSectionOrder(view.plugin.settings, typ);
      const editors = /* @__PURE__ */ new Map();
      const blockEls = /* @__PURE__ */ new Map();
      const stores = /* @__PURE__ */ new Map();
      const api = {
        // All editor instances in block order; typ-pane.js adds them as component
        // children and unloads them before each rebuild.
        editors: [],
        // Adds a blank row at the end of the block with focus in the key field
        // (see addBlankProperty). floating marks the next named property as
        // floating.
        addBlank(section, floating = false) {
          const editor = editors.get(section);
          if (!editor) return;
          editor.typPendingFloatingAdd = floating;
          addBlankProperty(editor);
        }
      };
      const focusNeighbor = (section, step) => {
        for (let i = sections.indexOf(section) + step; i >= 0 && i < sections.length; i += step) {
          const editor = editors.get(sections[i]);
          if (!editor || editor.rendered.length === 0) continue;
          editor.focusPropertyAtIndex(step > 0 ? 0 : -1);
          return true;
        }
        return false;
      };
      for (const section of sections) {
        const isSub = section !== null;
        const blockEl = wrapper.createDiv({
          cls: "typ-block" + (isSub ? " typ-frontmatter-block typ-subtyp-block" : "")
        });
        blockEls.set(section, blockEl);
        blockEl.typSection = section;
        const header = blockEl.createDiv({ cls: "typ-frontmatter-header typ-section-header" });
        header.toggleClass("typ-section-sub", isSub);
        const store = section === null ? typStore(view.plugin, typ) : subtypStore(view.plugin, typ, section);
        stores.set(section, store);
        const editor = mountFrontmatterEditor(view, blockEl, store, {
          onShiftFocus: (step) => focusNeighbor(section, step)
        });
        if (editor) {
          editors.set(section, editor);
          api.editors.push(editor);
        }
        const footer = blockEl.createDiv({ cls: "typ-section-footer" });
        footer.toggleClass("typ-section-sub", isSub);
        renderHeader(section, header, api);
        renderFooter?.(section, footer, api);
        if (!isSub) continue;
        blockEl.addEventListener("mousedown", (event) => startBlockDrag(event, section));
      }
      function startBlockDrag(event, section) {
        if (event.button !== 0 || !isGrabTarget(event.target)) return;
        const win = wrapper.win;
        const startY = event.clientY;
        let dragging = false;
        let indicator = null;
        let boxes = [];
        let targetIndex = null;
        const measure = () => {
          const base = wrapper.getBoundingClientRect();
          boxes = sections.map((name) => {
            const rect = blockEls.get(name).getBoundingClientRect();
            return { section: name, top: rect.top - base.top, bottom: rect.bottom - base.top };
          });
        };
        const onMove = (moveEvent) => {
          if (!dragging) {
            if (Math.abs(moveEvent.clientY - startY) < 4) return;
            dragging = true;
            wrapper.doc.body.addClass("typ-block-dragging");
            win.getSelection()?.removeAllRanges();
            blockEls.get(section).addClass("is-dragging");
            measure();
            indicator = wrapper.createDiv({ cls: "typ-block-drop-indicator" });
          }
          moveEvent.preventDefault();
          const y = moveEvent.clientY - wrapper.getBoundingClientRect().top;
          targetIndex = Math.max(1, boxes.filter((box) => (box.top + box.bottom) / 2 < y).length);
          const from = boxes.findIndex((box) => box.section === section);
          indicator.toggle(targetIndex !== from && targetIndex !== from + 1);
          const halfGap = 6;
          const gapY = targetIndex === boxes.length ? boxes[boxes.length - 1].bottom + halfGap : (boxes[targetIndex - 1].bottom + boxes[targetIndex].top) / 2;
          indicator.style.top = `${gapY - 1}px`;
        };
        const end = (commit) => {
          win.removeEventListener("mousemove", onMove);
          win.removeEventListener("mouseup", onUp);
          win.removeEventListener("keydown", onKey, true);
          if (!dragging) return;
          wrapper.doc.body.removeClass("typ-block-dragging");
          blockEls.get(section).removeClass("is-dragging");
          indicator?.remove();
          const order = boxes.map((box) => box.section);
          const from = order.indexOf(section);
          if (!commit || targetIndex === null || targetIndex === from || targetIndex === from + 1) return;
          order.splice(from, 1);
          order.splice(from < targetIndex ? targetIndex - 1 : targetIndex, 0, section);
          onMoveSection?.(order);
        };
        const onUp = () => end(true);
        const onKey = (keyEvent) => {
          if (keyEvent.key !== "Escape") return;
          keyEvent.preventDefault();
          keyEvent.stopPropagation();
          end(false);
        };
        win.addEventListener("mousemove", onMove);
        win.addEventListener("mouseup", onUp);
        win.addEventListener("keydown", onKey, true);
      }
      registerPropertyDrag();
      return api;
      function registerPropertyDrag() {
        const anchor = api.editors[0];
        if (!anchor || sections.length < 2) return;
        let drag = null;
        let drop = null;
        const sectionAt = (clientY) => sections.find((section) => {
          const rect = blockEls.get(section).getBoundingClientRect();
          return clientY >= rect.top && clientY <= rect.bottom;
        });
        const clearPlaceholder = () => {
          drag.placeholder?.remove();
          drag.placeholder = null;
          drag.rowEl.style.removeProperty("display");
          drag.target = null;
        };
        wrapper.addEventListener(
          "mousedown",
          (event) => {
            if (event.button !== 0) return;
            const rowEl = event.target.closest(".metadata-property-icon")?.closest(".metadata-property");
            const section = rowEl?.closest(".typ-block")?.typSection;
            const editor = section === void 0 ? null : editors.get(section);
            const key = editor?.rendered.find((row) => row.containerEl === rowEl)?.entry.key;
            if (!key) return;
            drag = {
              section,
              key,
              rowEl,
              // Measured now: once hidden for the placeholder, offsetHeight is 0.
              height: rowEl.offsetHeight,
              spacer: editor.propertyListEl.createDiv({ cls: "typ-drag-spacer" }),
              placeholder: null,
              target: null
            };
            drop = null;
          },
          true
        );
        const onWinMove = (event) => {
          if (!drag) return;
          const target = sectionAt(event.clientY);
          if (target === void 0 || target === drag.section) {
            if (drag.placeholder) clearPlaceholder();
            return;
          }
          const list = editors.get(target).propertyListEl;
          if (!drag.placeholder) {
            drag.rowEl.style.display = "none";
            drag.placeholder = createDiv({ cls: "metadata-property drag-ghost-hidden typ-drag-placeholder" });
            drag.placeholder.style.height = `${drag.height}px`;
          }
          const rows = [...list.children].filter((el) => el !== drag.placeholder && el !== drag.spacer);
          const before = rows.find((el) => {
            const rect = el.getBoundingClientRect();
            return event.clientY < rect.top + rect.height / 2;
          });
          drag.target = { section: target, index: before ? rows.indexOf(before) : rows.length };
          list.insertBefore(drag.placeholder, before ?? null);
        };
        const onWinUp = () => {
          if (!drag) return;
          const { spacer, placeholder, rowEl, target } = drag;
          drag = null;
          drop = target;
          placeholder?.remove();
          rowEl.style.removeProperty("display");
          wrapper.win.setTimeout(() => spacer.remove(), 0);
        };
        wrapper.win.addEventListener("mousemove", onWinMove, true);
        wrapper.win.addEventListener("mouseup", onWinUp, true);
        anchor.register(() => {
          wrapper.win.removeEventListener("mousemove", onWinMove, true);
          wrapper.win.removeEventListener("mouseup", onWinUp, true);
        });
        for (const [section, editor] of editors) {
          const originalReorderKey = editor.reorderKey;
          editor.reorderKey = function(entry, index) {
            const target = drop;
            drop = null;
            if (!target) return originalReorderKey.call(this, entry, index);
            moveProperty(section, target.section, entry.key, target.index);
          };
        }
      }
      async function moveProperty(from, to, key, index) {
        const source = stores.get(from);
        const target = stores.get(to);
        if (!source || !target || from === to) return;
        const sourceFrontmatter = { ...source.getFrontmatter() };
        const value = sourceFrontmatter[key];
        const wasFloating = source.getFloating().includes(key);
        const sourceShortcuts = { ...source.getShortcuts() };
        const shortcut = sourceShortcuts[key] ?? null;
        delete sourceShortcuts[key];
        delete sourceFrontmatter[key];
        source.setFrontmatter(sourceFrontmatter);
        source.setFloating(source.getFloating().filter((k) => k !== key));
        source.setShortcuts(sourceShortcuts);
        const targetFrontmatter = target.getFrontmatter();
        const existing = Object.keys(targetFrontmatter).find((k) => k.toLowerCase() === key.toLowerCase());
        if (existing !== void 0) {
          if (isEmptyValue(targetFrontmatter[existing])) target.setFrontmatter({ ...targetFrontmatter, [existing]: value });
        } else {
          const keys = Object.keys(targetFrontmatter);
          const at = Math.max(0, Math.min(index, keys.length));
          const next = {};
          for (const k of keys.slice(0, at)) next[k] = targetFrontmatter[k];
          next[key] = value;
          for (const k of keys.slice(at)) next[k] = targetFrontmatter[k];
          target.setFrontmatter(next);
          if (wasFloating) target.setFloating([...target.getFloating(), key]);
          if (shortcut) target.setShortcuts({ ...target.getShortcuts(), [key]: shortcut });
        }
        await view.plugin.saveSettings();
        view.plugin.refreshTypColorsExcept?.(view);
        view.render();
      }
    }
    module2.exports = { mountFrontmatterBlocks };
  }
});

// src/typ-settings.js
var require_typ_settings = __commonJS({
  "src/typ-settings.js"(exports2, module2) {
    var { moveTypSubtyps, deleteTypSubtyps } = require_subtyps();
    var TYP_SETTING_TABLES = [
      "typColors",
      "typDescriptions",
      "typDefaultFrontmatter",
      "typFloatingKeys",
      "typShortcuts",
      "typManual"
    ];
    function moveTypSettings(settings, from, to) {
      const index = settings.typs.indexOf(from);
      if (index !== -1) settings.typs[index] = to;
      for (const table of TYP_SETTING_TABLES) {
        if (settings[table]?.[from] === void 0) continue;
        settings[table] ?? (settings[table] = {});
        settings[table][to] = settings[table][from];
        delete settings[table][from];
      }
      moveTypSubtyps(settings, from, to);
    }
    function deleteTypSettings(settings, typ) {
      settings.typs = settings.typs.filter((t) => t !== typ);
      for (const table of TYP_SETTING_TABLES) {
        if (settings[table]) delete settings[table][typ];
      }
      deleteTypSubtyps(settings, typ);
    }
    module2.exports = { TYP_SETTING_TABLES, moveTypSettings, deleteTypSettings };
  }
});

// src/typ-pane.js
var require_typ_pane = __commonJS({
  "src/typ-pane.js"(exports2, module2) {
    var { ItemView, Menu, Notice, setIcon, debounce } = require("obsidian");
    var { ConfirmModal, typNameNode, subtypNameNode } = require_confirm_modal();
    var { snapshotSettings, offerUndo } = require_undo();
    var { mountFrontmatterBlocks } = require_frontmatter_blocks();
    var { moveTypSettings, deleteTypSettings } = require_typ_settings();
    var { runOrReportError } = require_commands();
    var { isBasesEnabled, createBaseFor } = require_bases();
    var { sortTypFrontmatter } = require_frontmatter_sort();
    var {
      normalizeSubtypName,
      getSubtypNames: getSubtypNames2,
      ensureSubtyp,
      mergeTypSubtyps,
      getSubtyp: getSubtyp2,
      isSubtypManual: isSubtypManual2,
      setSubtypManual,
      setAllSubtypsManual,
      renameSubtyp,
      reorderSubtyps,
      deleteSubtyp,
      mergeSubtyps,
      renameSubtypInNotes
    } = require_subtyps();
    var { normalizeTypName, compareTyps, sortTypsByMode: sortTypsByMode2, plural, joinAnd } = require_typ_utils();
    var { typKeyOf, propertyValue, setCanonicalProperty: setCanonicalProperty2, TYP_PROPERTY: TYP_PROPERTY2, SUBTYP_PROPERTY: SUBTYP_PROPERTY2 } = require_typ_index();
    var {
      subtypColor,
      applyColorOffset,
      hasColorOffset,
      subtypHasOwnColor,
      paintColorDot,
      nameColor,
      channelBounds,
      clampedOffset,
      SUBTYP_COLOR_CHANNELS,
      DEFAULT_TYP_COLOR
    } = require_typ_colors();
    var VIEW_TYPE_TYP_PANE = "typ-system-pane";
    var DEFAULT_SORT_ORDER2 = "count-desc";
    var DEFAULT_SECONDARY = "subtyps";
    var SECONDARY_MODES = [
      { mode: "subtyps", title: "Subtyp list", icon: "list-tree" },
      { mode: "description", title: "Description", icon: "text-cursor-input" },
      { mode: "none", title: "Nothing", icon: "minus" }
    ];
    var SORT_OPTIONS = [
      // Unlike the others, "manual" has no comparison: the order of settings.typs
      // itself is the storage (see render() and renderRegisteredItem() for the
      // drag & drop rendering built on it). First on purpose - its own group at
      // the top of the menu (see showSortMenu).
      { mode: "manual", title: "Manual (drag & drop)" },
      { mode: "count-desc", title: "Most notes first" },
      { mode: "count-asc", title: "Fewest notes first" },
      { mode: "name-asc", title: "Name (A to Z)" },
      { mode: "name-desc", title: "Name (Z to A)" },
      { mode: "color-asc", title: "Color (red \u2192 violet)" },
      { mode: "color-desc", title: "Color (violet \u2192 red)" }
    ];
    async function renameTypInNotes(plugin, oldKey, newValue) {
      let changed = 0;
      for (const file of plugin.typIndex.filesWithTyp(oldKey)) {
        let matched = false;
        await plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
          if (typKeyOf(propertyValue(frontmatter, TYP_PROPERTY2)) !== oldKey) return;
          setCanonicalProperty2(frontmatter, TYP_PROPERTY2, newValue);
          matched = true;
        });
        if (matched) changed++;
      }
      return changed;
    }
    function normalizeRawTyp(raw, normalize = normalizeTypName) {
      if (Array.isArray(raw)) {
        return raw.map((v) => normalize(String(v ?? ""))).filter(Boolean).join(", ");
      }
      return normalize(String(raw));
    }
    var FIELD_SELECTOR = 'input, textarea, [contenteditable="true"], [contenteditable=""], .metadata-property';
    var isField = (el) => !!el?.matches?.(FIELD_SELECTOR) && !el.matches('input[type="color"]');
    function displayTypKey(typKey) {
      return typKey !== typKey.trim() ? `"${typKey}"` : typKey;
    }
    var TypPane = class extends ItemView {
      constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
      }
      getViewType() {
        return VIEW_TYPE_TYP_PANE;
      }
      getDisplayText() {
        return "TYP";
      }
      getIcon() {
        return "shapes";
      }
      async onOpen() {
        this.isEditing = false;
        this.selectedTyp = null;
        this.frontmatterBlocks = null;
        this.frontmatterEditors = [];
        this.contentEl.empty();
        this.contentEl.addClass("typ-system-pane");
        this.registerDomEvent(this.contentEl, "focusout", (event) => {
          if (!this._renderPending || isField(event.relatedTarget)) return;
          window.setTimeout(() => {
            if (this._renderPending && !this.hasFieldFocus()) this.render();
          }, 0);
        });
        this.registerDomEvent(this.contentEl, "keydown", (event) => {
          if (event.key === "Escape" && this.selectedTyp !== null) this.closeTypSettings();
        });
        this.render();
      }
      async onClose() {
        this.closeSubtypColorPopover?.();
      }
      openSearch(typ) {
        const globalSearch = this.plugin.app.internalPlugins.getPluginById("global-search");
        if (!globalSearch) return;
        const query = typ === null ? `-["${TYP_PROPERTY2}"] file:.md` : this.typClause(typ);
        globalSearch.instance.openGlobalSearch(query);
      }
      // Search clause for a TYP key. A list (unregistered key "[A, B]") has no
      // exact syntax, so it searches notes carrying all its items. Also used by
      // openSubtypSearch(), which can receive an unregistered (unclean) TYP key.
      typClause(typ) {
        const raw = this.plugin.typIndex.rawValueOf(typ);
        return Array.isArray(raw) ? raw.map((v) => `["${TYP_PROPERTY2}":"${String(v ?? "").trim()}"]`).join(" ") : `["${TYP_PROPERTY2}":"${typ}"]`;
      }
      // typKey comes straight from frontmatter values (see unregisteredRows in
      // render() and typKeyOf) - possibly lowercase, padded or a list. TYP entries
      // are always clean uppercase values, so the cleaned form is registered (see
      // normalizeRawTyp) and the affected notes are rewritten right away, so they
      // no longer show up as unregistered.
      async registerTyp(typKey) {
        const result = await this.applyTypRegistration(typKey);
        if (!result) return;
        await this.plugin.saveSettings();
        this.render();
        this.refreshOtherViews();
        if (result.renamed > 0) {
          new Notice(`TYP ${result.typ} registered, ${plural(result.renamed, "note")} updated.`);
        }
      }
      // The core of registerTyp() without saving, re-rendering and notice, so
      // registerTypWithSubtyp() can register TYP and Subtyp in turn and then save
      // and notify ONCE. Returns { typ, renamed }, or null if nothing usable is
      // left.
      async applyTypRegistration(typKey) {
        const raw = this.plugin.typIndex.rawValueOf(typKey);
        const normalized = normalizeRawTyp(raw === void 0 ? typKey : raw);
        if (!normalized) return null;
        if (!this.plugin.settings.typs.includes(normalized)) {
          this.plugin.settings.typs.push(normalized);
        }
        const renamed = normalized !== typKey ? await renameTypInNotes(this.plugin, typKey, normalized) : 0;
        return { typ: normalized, renamed };
      }
      // Colors and marks of every other view after a change made in this pane
      // (see refreshTypColorsExcept in main.js). This pane updates itself: either
      // the change is already visible (a property edit) or the caller renders.
      refreshOtherViews() {
        this.plugin.refreshTypColorsExcept?.(this);
      }
      // A new, empty tree item straight in edit mode - like Obsidian's own views
      // (a new bookmark group, say).
      startAdd() {
        if (this.isEditing) return;
        const treeItem = this.listEl.createDiv({ cls: "tree-item" });
        if (this.separatorEl) this.listEl.insertBefore(treeItem, this.separatorEl);
        const self = treeItem.createDiv({ cls: "tree-item-self is-clickable" });
        const inner = self.createDiv({ cls: "tree-item-inner" });
        this.startInlineEdit(inner, {
          classEl: self,
          onFinish: async (commit, text) => {
            const value = normalizeTypName(text);
            if (commit && value) {
              const existing = this.plugin.settings.typs.find((t) => t.toLowerCase() === value.toLowerCase());
              if (existing) {
                new Notice(`TYP ${existing} already exists.`);
              } else {
                this.plugin.settings.typs.push(value);
                await this.plugin.saveSettings();
                this.refreshOtherViews();
              }
            }
            this.render();
          }
        });
      }
      // Every inline input of the pane - a new TYP or Subtyp, renaming one in the
      // list, the detail title or a block heading - works the same way, like
      // Obsidian's tree items: no extra input, the text element itself becomes
      // contenteditable. Enter commits, Escape cancels, leaving the field (blur)
      // commits too. onFinish(commit, text) does the rest; it should end in
      // render() or a dialog whose callbacks render.
      //
      //   classEl     - gets the classes (the whole row in the list)
      //   classes     - marks the input state (styles.css, makeSearchable)
      //   stopAllKeys - keeps every key from the surroundings, not only Enter and
      //                 Escape (a block heading inside the property editors,
      //                 whose keyboard navigation would react too)
      //
      // While the input runs, render() is deferred (see there) - a rebuild would
      // remove the element, and the blur that follows would commit a half-typed or
      // empty name.
      startInlineEdit(el, { classEl = el, classes = ["is-being-renamed"], stopAllKeys = false, onFinish }) {
        if (this.isEditing) return false;
        this.isEditing = true;
        if (classes.length > 0) classEl.addClass(...classes);
        el.setAttribute("contenteditable", "true");
        el.setAttribute("spellcheck", "false");
        el.focus();
        const range = el.doc.createRange();
        range.selectNodeContents(el);
        const selection = el.win.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        let done = false;
        const finish = async (commit) => {
          if (done) return;
          done = true;
          this.isEditing = false;
          try {
            await onFinish(commit, el.textContent ?? "");
          } finally {
            if (this._renderPending) this.render();
          }
        };
        el.addEventListener("keydown", (event) => {
          if (stopAllKeys) event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            finish(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            finish(false);
          }
        });
        el.addEventListener("blur", () => queueMicrotask(() => finish(el.isConnected)));
        return true;
      }
      // Switching between list and detail view starts at the top; every other
      // render() keeps the scroll position (see there).
      openTypSettings(typ) {
        this.selectedTyp = typ;
        this._resetScroll = true;
        this.render();
      }
      closeTypSettings() {
        this.selectedTyp = null;
        this._resetScroll = true;
        this.render();
      }
      // The editors are component children (see mountFrontmatterEditor) and must
      // be unloaded before every rebuild - contentEl.empty() alone would remove the
      // DOM but leave each editor's metadataTypeManager listener behind.
      // frontmatterBlocks controls all blocks (used by "Add TYP-Frontmatter
      // property"), frontmatterEditors holds every editor incl. Subtyp blocks.
      destroyFrontmatterEditor() {
        for (const editor of this.frontmatterEditors ?? []) this.removeChild(editor);
        this.frontmatterEditors = [];
        this.frontmatterBlocks = null;
      }
      // Focus in one of the pane's fields (see isField).
      hasFieldFocus() {
        const active = this.contentEl.doc.activeElement;
        return !!active && this.contentEl.contains(active) && isField(active);
      }
      // A rebuild requested from outside (registerTypPane: refreshTypColors(), an
      // index change, Sync, Undo). While someone types in this pane - a
      // description, a property, an inline name - it would throw the field away
      // with text, cursor and focus, so it waits until the focus leaves the
      // fields (see onOpen) or the inline input ends (see startInlineEdit). The
      // pane's own actions call render() directly and take effect at once.
      requestRender() {
        if (this.hasFieldFocus()) {
          this._renderPending = true;
          return;
        }
        this.render();
      }
      render() {
        if (this._rendering) return;
        if (this.isEditing) {
          this._renderPending = true;
          return;
        }
        this._renderPending = false;
        this._rendering = true;
        const scrollTop = this._resetScroll ? 0 : this.contentEl.scrollTop;
        this._resetScroll = false;
        try {
          this.destroyFrontmatterEditor();
          if (this.selectedTyp !== null) {
            this.renderTypSettings(this.selectedTyp);
            return;
          }
          const { contentEl } = this;
          contentEl.empty();
          const { counts, noTyp } = this.plugin.typIndex.typCounts();
          const registered = this.plugin.settings.typs;
          const typColors = this.plugin.settings.typColors;
          const sortOrder = this.plugin.settings.typSortOrder ?? DEFAULT_SORT_ORDER2;
          const isManualSort = sortOrder === "manual";
          const byCurrentOrder = (a, b) => compareTyps(sortOrder, a, b, counts, typColors);
          this.renderListHeader(contentEl);
          const unregisteredRows = [...counts.keys()].filter((typ) => !registered.includes(typ)).sort(byCurrentOrder).map((typ) => ({ typ, count: counts.get(typ) ?? 0 }));
          const unregisteredSubtypRows = this.unregisteredSubtypRows();
          const listCls = "typ-list nav-files-container" + (this.secondaryMode() === "none" ? " typ-list-no-secondary" : "");
          this.listEl = contentEl.createDiv({ cls: listCls });
          this.separatorEl = null;
          const registeredOrder = sortTypsByMode2(registered, sortOrder, counts, typColors);
          registeredOrder.forEach((typ, index) => {
            this.renderRegisteredItem(typ, counts.get(typ) ?? 0, { draggable: isManualSort, index });
          });
          const separator = () => {
            const el = this.listEl.createDiv({ cls: "typ-separator" });
            this.separatorEl = this.separatorEl ?? el;
          };
          if (unregisteredRows.length > 0 || unregisteredSubtypRows.length > 0 || noTyp > 0) separator();
          for (const row of unregisteredRows) this.renderUnregisteredItem(row.typ, row.count);
          if (unregisteredSubtypRows.length > 0) {
            if (unregisteredRows.length > 0) separator();
            for (const row of unregisteredSubtypRows) this.renderUnregisteredSubtypItem(row);
          }
          if (noTyp > 0) this.renderNoTypItem(noTyp);
        } finally {
          this.contentEl.scrollTop = scrollTop;
          this._rendering = false;
        }
      }
      // Like the "Change sort order" button in Obsidian's tags and all-properties
      // views.
      renderListHeader(contentEl) {
        const header = contentEl.createDiv({ cls: "nav-header" });
        const buttonsContainer = header.createDiv({ cls: "nav-buttons-container" });
        const addBtn = buttonsContainer.createDiv({
          cls: "clickable-icon nav-action-button",
          attr: { "aria-label": "Add TYP" }
        });
        setIcon(addBtn, "plus");
        addBtn.addEventListener("click", () => this.startAdd());
        const sortBtn = buttonsContainer.createDiv({
          cls: "clickable-icon nav-action-button",
          attr: { "aria-label": "Change sort order" }
        });
        setIcon(sortBtn, "lucide-sort-asc");
        sortBtn.addEventListener("click", (event) => this.showSortMenu(event));
        const current = SECONDARY_MODES[this.secondaryIndex()];
        const secondaryBtn = buttonsContainer.createDiv({
          cls: "clickable-icon nav-action-button",
          attr: { "aria-label": `Next to name: ${current.title}` }
        });
        setIcon(secondaryBtn, current.icon);
        secondaryBtn.addEventListener("click", () => this.cycleSecondary());
      }
      // settings.typListSecondary, but always a valid mode - older data may lack
      // the key, and a mode removed later shouldn't leave the list empty.
      secondaryMode() {
        const mode = this.plugin.settings.typListSecondary;
        return SECONDARY_MODES.some((entry) => entry.mode === mode) ? mode : DEFAULT_SECONDARY;
      }
      secondaryIndex() {
        return SECONDARY_MODES.findIndex((entry) => entry.mode === this.secondaryMode());
      }
      async cycleSecondary() {
        const next = SECONDARY_MODES[(this.secondaryIndex() + 1) % SECONDARY_MODES.length];
        this.plugin.settings.typListSecondary = next.mode;
        await this.plugin.saveSettings();
        this.render();
      }
      showSortMenu(event) {
        const current = this.plugin.settings.typSortOrder ?? DEFAULT_SORT_ORDER2;
        const menu = new Menu();
        const addGroup = (start, end) => {
          for (let i = start; i < end; i++) {
            const { mode, title } = SORT_OPTIONS[i];
            menu.addItem(
              (item) => item.setTitle(title).setChecked(current === mode).onClick(async () => {
                this.plugin.settings.typSortOrder = mode;
                await this.plugin.saveSettings();
                this.render();
              })
            );
          }
        };
        addGroup(0, 1);
        menu.addSeparator();
        addGroup(1, 3);
        menu.addSeparator();
        addGroup(3, 5);
        menu.addSeparator();
        addGroup(5, 7);
        menu.showAtMouseEvent(event);
      }
      renderNoTypItem(count) {
        const treeItem = this.listEl.createDiv({ cls: "tree-item" });
        const self = treeItem.createDiv({ cls: "tree-item-self is-clickable typ-unregistered" });
        self.createDiv({ cls: "tree-item-inner", text: "[NO TYP]" });
        this.renderCountFlair(self, count);
        self.addEventListener("click", () => this.openSearch(null));
        self.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.openSearch(null);
        });
      }
      // Chromium's input[type=color] has a minimum swatch that won't scale below
      // text size, so it is only an invisible trigger over a freely scalable dot.
      // Without a color the dot is a hollow gray ring (see paintColorDot); with
      // showReset (detail view) a tooltip names the state and the reset button is
      // grayed out.
      renderColorPicker(parent, typ, onChange, { showReset = false } = {}) {
        const currentColor = this.plugin.settings.typColors[typ] ?? DEFAULT_TYP_COLOR;
        const colorWrap = parent.createDiv({ cls: "typ-color-wrap" });
        const colorDot = colorWrap.createDiv({ cls: "typ-color-dot" });
        let resetBtn = null;
        const showState = (color, isDefault) => {
          paintColorDot(colorDot, color, isDefault);
          if (!showReset) return;
          colorWrap.setAttribute("aria-label", isDefault ? "Default (no color)" : "Change color");
          resetBtn?.toggleClass("is-disabled", isDefault);
        };
        const colorInput = colorWrap.createEl("input", { type: "color", cls: "typ-color-input" });
        colorInput.value = currentColor;
        const saveSoon = debounce(() => this.plugin.saveSettings(), 400, true);
        let undoSnapshot = null;
        colorInput.addEventListener("click", (event) => {
          event.stopPropagation();
          undoSnapshot = null;
        });
        colorInput.addEventListener("input", () => {
          undoSnapshot ?? (undoSnapshot = snapshotSettings(this.plugin));
          showState(colorInput.value, false);
          this.plugin.settings.typColors[typ] = colorInput.value;
          onChange?.(colorInput.value);
          saveSoon();
        });
        colorInput.addEventListener("change", async () => {
          saveSoon.cancel();
          const snapshot = undoSnapshot;
          undoSnapshot = null;
          await this.plugin.saveSettings();
          if (snapshot && snapshot.typColors[typ] !== this.plugin.settings.typColors[typ]) {
            offerUndo(this.plugin, `Color of ${typ} changed.`, snapshot);
          }
          this.refreshOtherViews();
          this.render();
        });
        if (showReset) {
          resetBtn = parent.createDiv({
            cls: "clickable-icon typ-color-reset",
            attr: { "aria-label": "Reset color" }
          });
          setIcon(resetBtn, "rotate-ccw");
          resetBtn.addEventListener("click", async () => {
            if (this.plugin.settings.typColors[typ] === void 0) return;
            const snapshot = snapshotSettings(this.plugin);
            delete this.plugin.settings.typColors[typ];
            colorInput.value = DEFAULT_TYP_COLOR;
            showState(DEFAULT_TYP_COLOR, true);
            await this.plugin.saveSettings();
            offerUndo(this.plugin, `Color of ${typ} reset.`, snapshot);
            onChange?.(DEFAULT_TYP_COLOR);
            this.refreshOtherViews();
            this.render();
          });
        }
        showState(currentColor, this.plugin.settings.typColors[typ] === void 0);
        return colorWrap;
      }
      // Guards settings objects loaded before typManual existed (a running
      // session across a hot reload, say) - otherwise every access below would
      // throw and take the rest of renderTypSettings() down with it.
      ensureTypManual() {
        if (!this.plugin.settings.typManual) this.plugin.settings.typManual = {};
        return this.plugin.settings.typManual;
      }
      // The shared "Manually creatable" button of TYP (renderManualToggle) and
      // Subtyp (renderSubtypManualToggle), each between rename and delete. An
      // icon button rather than a labeled toggle - too small a setting for its own
      // row. State via a class (is-active, see styles.css), meaning in the tooltip;
      // role/aria-checked keep it readable as a switch.
      //
      // onToggle gets the new state, saves it and updates the dependent buttons
      // (see syncManualToggles) - the click doesn't paint itself, since a toggle
      // here never affects just this one button.
      renderManualIcon(parent, cls, isOn, onToggle) {
        const btn = parent.createDiv({
          cls: `clickable-icon typ-manual-icon ${cls}`,
          attr: { tabindex: "0", role: "checkbox" }
        });
        setIcon(btn, "file-pen-line");
        btn.typShowManualState = (on) => {
          btn.toggleClass("is-active", on);
          btn.setAttribute("aria-checked", String(on));
          btn.setAttribute("aria-label", on ? "Manually creatable" : "Not manually creatable");
        };
        btn.typShowManualState(isOn);
        const toggle = () => onToggle(!btn.hasClass("is-active"));
        btn.addEventListener("click", toggle);
        btn.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle();
          }
        });
        return btn;
      }
      // The TYP's "Manually creatable", in the detail header between rename and
      // delete. On by default, so only "off" (false) is stored. Decides whether
      // getTyps() (main.js) returns the TYP.
      //
      // The TYP always takes its Subtyps along: the picker only reaches them
      // through it, so a TYP switched off would silently make them unreachable
      // (see setAllSubtypsManual in subtyps.js).
      renderManualToggle(parent, typ) {
        return this.renderManualIcon(parent, "typ-manual-typ", this.ensureTypManual()[typ] !== false, async (on) => {
          if (on) delete this.ensureTypManual()[typ];
          else this.ensureTypManual()[typ] = false;
          setAllSubtypsManual(this.plugin.settings, typ, on);
          await this.plugin.saveSettings();
          this.syncManualToggles(typ);
        });
      }
      // A Subtyp's "Manually creatable", in its block footer between rename and
      // delete (see renderSectionFooter). Unlike the TYP button it pulls only one
      // way: switching a Subtyp on also switches its TYP on (else it would be
      // unreachable), the other Subtyps stay as they are - that is the point.
      renderSubtypManualToggle(parent, typ, subtyp) {
        const btn = this.renderManualIcon(
          parent,
          "typ-manual-subtyp",
          isSubtypManual2(this.plugin.settings, typ, subtyp),
          async (on) => {
            setSubtypManual(this.plugin.settings, typ, subtyp, on);
            if (on) delete this.ensureTypManual()[typ];
            await this.plugin.saveSettings();
            this.syncManualToggles(typ);
          }
        );
        btn.typSubtyp = subtyp;
        return btn;
      }
      // Repaints every manual button of the detail view after one changed the
      // others. Only the buttons, not render(): a rebuild would recreate every
      // block's editors, including a row being edited. Found via the DOM like the
      // Subtyp color dots - frontmatter-blocks.js builds the footers, no list of
      // them lives here.
      syncManualToggles(typ) {
        this.contentEl.querySelector(".typ-manual-typ")?.typShowManualState(this.ensureTypManual()[typ] !== false);
        for (const el of this.contentEl.querySelectorAll(".typ-manual-subtyp")) {
          el.typShowManualState(isSubtypManual2(this.plugin.settings, typ, el.typSubtyp));
        }
      }
      renderRegisteredItem(typ, count, { draggable = false, index = -1 } = {}) {
        const treeItem = this.listEl.createDiv({ cls: "tree-item" });
        const self = treeItem.createDiv({ cls: "tree-item-self is-clickable" });
        let nameEl;
        this.renderColorPicker(self, typ, (newColor) => {
          if (nameEl && this.plugin.settings.colorViews.typList) nameEl.style.color = newColor;
        });
        nameEl = self.createDiv({ cls: "tree-item-inner", text: typ });
        const color = this.plugin.settings.colorViews.typList ? this.plugin.settings.typColors[typ] : null;
        if (color) nameEl.style.color = color;
        const secondary = this.secondaryMode();
        if (secondary === "description") this.renderDescriptionInput(self, typ);
        else if (secondary === "subtyps") this.renderSubtypPreview(self, typ);
        this.renderCountFlair(self, count);
        self.addEventListener("click", () => {
          if (this.isEditing) return;
          this.openTypSettings(typ);
        });
        self.addEventListener("contextmenu", (event) => {
          if (this.isEditing) return;
          event.preventDefault();
          event.stopPropagation();
          this.showTypMenu(event, typ, self, nameEl);
        });
        if (draggable) {
          self.draggable = true;
          self.addEventListener("dragstart", (event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", String(index));
            self.classList.add("is-dragging");
          });
          self.addEventListener("dragend", () => self.classList.remove("is-dragging"));
          self.addEventListener("dragover", (event) => {
            event.preventDefault();
            const rect = self.getBoundingClientRect();
            const isAfter = event.clientY - rect.top > rect.height / 2;
            self.classList.toggle("is-drop-before", !isAfter);
            self.classList.toggle("is-drop-after", isAfter);
          });
          self.addEventListener("dragleave", () => self.classList.remove("is-drop-before", "is-drop-after"));
          self.addEventListener("drop", async (event) => {
            event.preventDefault();
            const isAfter = self.classList.contains("is-drop-after");
            self.classList.remove("is-drop-before", "is-drop-after");
            const fromIndex = Number(event.dataTransfer.getData("text/plain"));
            if (Number.isNaN(fromIndex) || fromIndex === index) return;
            let insertBefore = isAfter ? index + 1 : index;
            if (fromIndex < insertBefore) insertBefore -= 1;
            const typs = this.plugin.settings.typs;
            const [moved] = typs.splice(fromIndex, 1);
            typs.splice(insertBefore, 0, moved);
            await this.plugin.saveSettings();
            this.render();
          });
        }
      }
      // Right-click on a registered TYP: the actions of the detail header plus
      // search, Base and sorting, without opening the detail view. "Manually
      // creatable" stays in the detail view - a state, not an action. The rows
      // below the separator keep right-click = search: they have no settings to
      // act on.
      showTypMenu(event, typ, self, nameEl) {
        const menu = new Menu();
        menu.addItem((item) => item.setTitle("Search notes").setIcon("search").onClick(() => this.openSearch(typ)));
        menu.addSeparator();
        menu.addItem(
          (item) => item.setTitle("Rename").setIcon("pencil").onClick(() => this.startListRename(typ, self, nameEl))
        );
        menu.addItem(
          (item) => item.setTitle("Rename and update notes").setIcon("pencil").onClick(() => this.startListRename(typ, self, nameEl, { updateNotes: true }))
        );
        menu.addItem(
          (item) => item.setTitle("Delete").setIcon("trash").setWarning(true).onClick(() => this.showDeleteConfirm(typ))
        );
        menu.addSeparator();
        if (isBasesEnabled(this.app)) {
          menu.addItem(
            (item) => item.setTitle("Create Base").setIcon("table").onClick(runOrReportError("Create Base", () => createBaseFor(this.plugin, { typ, subtyp: null })))
          );
        }
        menu.addItem(
          (item) => item.setTitle("Sort frontmatter for this TYP").setIcon("arrow-down-up").onClick(runOrReportError("Frontmatter sorting", () => sortTypFrontmatter(this.plugin, typ)))
        );
        menu.showAtMouseEvent(event);
      }
      // A real input, so the description can be edited right in the list. Its
      // click must NOT trigger the row (which would open the detail view).
      renderDescriptionInput(self, typ) {
        const descInput = self.createEl("input", {
          type: "text",
          cls: "typ-list-description-input"
        });
        descInput.value = this.plugin.settings.typDescriptions[typ] ?? "";
        descInput.addEventListener("click", (event) => event.stopPropagation());
        descInput.addEventListener("change", async () => {
          const value = descInput.value.trim();
          if (value) this.plugin.settings.typDescriptions[typ] = value;
          else delete this.plugin.settings.typDescriptions[typ];
          await this.plugin.saveSettings();
        });
      }
      // "(Subtyp 1, Subtyp 2)" instead of the description - the same look as the
      // preview in the separate TYP-Picker (shared nameColor in typ-colors.js):
      // brackets and commas muted, each name in its Subtyp color. Only registered
      // Subtyps and no counts - unregistered values have no color, and counts
      // would make the row unreadable. Display only; click and right-click belong
      // to the row. Left or right alignment is a Style Settings body class (see
      // @settings and .typ-list-subtyps in styles.css); the markup is the same.
      renderSubtypPreview(self, typ) {
        const subtyps = getSubtypNames2(this.plugin.settings, typ);
        if (subtyps.length === 0) return;
        const colorize = this.plugin.settings.colorViews.typList;
        const wrap = self.createSpan({ cls: "typ-list-subtyps" });
        wrap.appendText("(");
        subtyps.forEach((subtyp, index) => {
          if (index > 0) wrap.appendText(", ");
          const span = wrap.createSpan({ text: subtyp });
          if (colorize) span.style.color = nameColor(this.plugin.settings, typ, subtyp).color;
        });
        wrap.appendText(")");
      }
      renderUnregisteredItem(typ, count) {
        const treeItem = this.listEl.createDiv({ cls: "tree-item" });
        const self = treeItem.createDiv({ cls: "tree-item-self is-clickable typ-unregistered" });
        self.createDiv({ cls: "tree-item-inner", text: displayTypKey(typ) });
        this.renderCountFlair(self, count);
        self.addEventListener("click", () => this.registerTyp(typ));
        self.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.openSearch(typ);
        });
      }
      // Every SUBTYP value that occurs in notes but isn't registered under its TYP
      // - across the vault, unlike renderUnregisteredSubtyps() in the detail view.
      // The index keeps buckets for ALL TYP keys, unregistered ones included, so
      // their Subtyps come along (a click then registers both, see
      // registerTypWithSubtyp).
      //
      // Sorted by count, then by row text (TYP, then Subtyp) - like the detail
      // view. Deliberately NOT by the list's sort button: "color" and "manual"
      // mean nothing for unregistered values.
      //
      // A note without a TYP is left out: the index drops its SUBTYP already (see
      // aggregate() in typ-index.js), a SUBTYP without a TYP has no context.
      unregisteredSubtypRows() {
        const registered = this.plugin.settings.typs;
        const rows = [];
        for (const [typ, bucket] of this.plugin.typIndex.subtypCounts()) {
          const known = getSubtypNames2(this.plugin.settings, typ);
          for (const [subtyp, count] of bucket.counts) {
            if (known.includes(subtyp)) continue;
            rows.push({ typ, subtyp, count, typRegistered: registered.includes(typ) });
          }
        }
        return rows.sort((a, b) => b.count - a.count || a.typ.localeCompare(b.typ) || a.subtyp.localeCompare(b.subtyp));
      }
      // "NOTIZ / Kurz Geschichte" - the Subtyp alone would be ambiguous, the same
      // name can exist under several TYP entries. If the TYP is registered, its
      // part carries its color (or a dot, depending on "TYP-Pane" coloring),
      // toned down by the Style Setting "Color in unregistered Subtyp rows" so
      // these rows stay behind the registered entries above. If the TYP isn't
      // registered either, the whole row is muted like the entries above it.
      renderUnregisteredSubtypItem({ typ, subtyp, count, typRegistered }) {
        const treeItem = this.listEl.createDiv({ cls: "tree-item" });
        const self = treeItem.createDiv({ cls: "tree-item-self is-clickable typ-unregistered" });
        const colorize = this.plugin.settings.colorViews.typList;
        const { color, isDefault } = nameColor(this.plugin.settings, typ);
        if (typRegistered && !colorize) {
          const wrap = self.createDiv({ cls: "typ-color-wrap typ-unregistered-subtyp-color" });
          paintColorDot(wrap.createDiv({ cls: "typ-color-dot" }), color, isDefault);
        }
        const inner = self.createDiv({ cls: "tree-item-inner" });
        const typEl = inner.createSpan({ cls: "typ-unregistered-subtyp-typ", text: displayTypKey(typ) });
        if (typRegistered && colorize && !isDefault) {
          typEl.style.color = color;
          typEl.addClass("typ-unregistered-subtyp-color");
        }
        inner.createSpan({ cls: "typ-unregistered-subtyp-slash", text: " / " });
        inner.createSpan({ text: displayTypKey(subtyp) });
        this.renderCountFlair(self, count);
        self.addEventListener("click", () => this.registerTypWithSubtyp(typ, subtyp));
        self.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.openSubtypSearch(typ, subtyp);
        });
      }
      // Clicking such a row registers the Subtyp and, if needed, its TYP. TYP
      // first, then Subtyp - necessarily: registering a TYP can clean its value in
      // the notes (" buch" -> "BUCH"), and the Subtyp pass must then use the NEW
      // TYP name or renameSubtypInNotes() finds no file.
      //
      // No confirmation: it only registers. Notes change only when a raw value was
      // unclean and gets cleaned - a clean value touches no file.
      async registerTypWithSubtyp(typKey, subtypKey) {
        const bucket = this.plugin.typIndex.subtypBucket(typKey);
        const typResult = this.plugin.settings.typs.includes(typKey) ? { typ: typKey, renamed: 0 } : await this.applyTypRegistration(typKey);
        if (!typResult) return;
        const subtypResult = await this.applySubtypRegistration(typResult.typ, subtypKey, bucket);
        await this.plugin.saveSettings();
        this.render();
        this.refreshOtherViews();
        if (!subtypResult) return;
        const parts = [];
        if (typResult.typ !== typKey) parts.push(`TYP ${typResult.typ}`);
        parts.push(`Subtyp ${subtypResult.subtyp}`);
        const changed = typResult.renamed + subtypResult.renamed;
        new Notice(`${joinAnd(parts)} registered${changed > 0 ? `, ${plural(changed, "note")} updated` : ""}.`);
      }
      renderTypSettings(typ) {
        const { contentEl } = this;
        contentEl.empty();
        const header = contentEl.createDiv({ cls: "typ-detail-header" });
        const backBtn = header.createDiv({ cls: "clickable-icon typ-back", attr: { "aria-label": "Back" } });
        setIcon(backBtn, "arrow-left");
        backBtn.addEventListener("click", () => this.closeTypSettings());
        const titleEl = header.createDiv({ cls: "typ-detail-title", text: typ });
        const titleColor = this.plugin.settings.colorViews.typList ? this.plugin.settings.typColors[typ] : null;
        if (titleColor) titleEl.style.setProperty("--typ-name-color", titleColor);
        this.makeSearchable(titleEl, () => this.openSearch(typ));
        const { counts } = this.plugin.typIndex.typCounts();
        header.createSpan({ cls: "typ-detail-count", text: String(counts.get(typ) ?? 0) });
        const renameWithNotesBtn = header.createDiv({
          cls: "clickable-icon typ-detail-rename-notes",
          attr: { "aria-label": "Rename and update notes" }
        });
        setIcon(renameWithNotesBtn, "pencil");
        renameWithNotesBtn.addEventListener("click", () => this.startDetailRename(typ, titleEl, { updateNotes: true }));
        const renameBtn = header.createDiv({ cls: "clickable-icon typ-detail-rename", attr: { "aria-label": "Rename" } });
        setIcon(renameBtn, "pencil");
        renameBtn.addEventListener("click", () => this.startDetailRename(typ, titleEl));
        this.renderManualToggle(header, typ);
        const deleteBtn = header.createDiv({ cls: "clickable-icon typ-detail-delete", attr: { "aria-label": "Delete" } });
        setIcon(deleteBtn, "trash");
        deleteBtn.addEventListener("click", () => this.showDeleteConfirm(typ));
        const body = contentEl.createDiv({ cls: "typ-detail-body" });
        const optionsHeader = body.createDiv({ cls: "typ-frontmatter-header typ-options-header" });
        const colorRow = optionsHeader.createDiv({ cls: "typ-detail-color-row" });
        this.renderColorPicker(
          colorRow,
          typ,
          (newColor) => {
            if (!this.plugin.settings.colorViews.typList) return;
            titleEl.style.setProperty("--typ-name-color", newColor);
          },
          { showReset: true }
        );
        const descInput = optionsHeader.createEl("input", {
          type: "text",
          cls: "typ-description-input",
          attr: { placeholder: "Description" }
        });
        descInput.value = this.plugin.settings.typDescriptions[typ] ?? "";
        descInput.addEventListener("change", async () => {
          const value = descInput.value.trim();
          if (value) this.plugin.settings.typDescriptions[typ] = value;
          else delete this.plugin.settings.typDescriptions[typ];
          await this.plugin.saveSettings();
        });
        body.createDiv({ cls: "typ-detail-separator" });
        const bucket = this.plugin.typIndex.subtypBucket(typ);
        this.frontmatterBlocks = mountFrontmatterBlocks(this, body, typ, {
          renderHeader: (section, el, blocks) => this.renderSectionHeader(el, typ, section, bucket, blocks),
          renderFooter: (section, el) => {
            if (section !== null) this.renderSectionFooter(el, typ, section);
          },
          onMoveSection: async (order) => {
            reorderSubtyps(this.plugin.settings, typ, order);
            await this.plugin.saveSettings();
            this.render();
          }
        });
        this.frontmatterEditors.push(...this.frontmatterBlocks.editors);
        this.subtypAddBtnEl = body.createEl("button", { cls: "mod-cta typ-subtyp-add" });
        setIcon(this.subtypAddBtnEl.createSpan({ cls: "typ-subtyp-add-icon" }), "plus");
        this.subtypAddBtnEl.createSpan({ text: "Add Subtyp" });
        this.subtypAddBtnEl.addEventListener("click", () => this.startAddSubtyp(typ));
        this.renderUnregisteredSubtyps(body, typ, bucket);
        body.createDiv({ cls: "typ-detail-separator" });
        this.renderFloatingHint(body);
        this.plugin.refreshFrontmatterHighlight?.();
      }
      // A block's heading (see frontmatter-blocks.js): title with note count (for
      // the TYP-Frontmatter the notes without SUBTYP, the only ones it applies to
      // alone), search on click, and the two add buttons for a blank row in this
      // block.
      renderSectionHeader(el, typ, section, bucket, blocks) {
        const titleGroup = el.createDiv({ cls: "typ-frontmatter-title-group" });
        const titleEl = titleGroup.createDiv({ cls: "typ-detail-section-title", text: section ?? `${typ}-Frontmatter` });
        const count = section === null ? bucket.noSubtyp : bucket.counts.get(section) ?? 0;
        titleGroup.createSpan({ cls: "typ-subtyp-count", text: String(count) });
        this.makeSearchable(titleEl, () => this.openSubtypSearch(typ, section));
        const addButtons = el.createDiv({ cls: "typ-frontmatter-add-group" });
        const addFloatingPropertyBtn = addButtons.createDiv({
          cls: "clickable-icon typ-frontmatter-add-floating",
          attr: { "aria-label": "Add floating property" }
        });
        setIcon(addFloatingPropertyBtn, "plus");
        addFloatingPropertyBtn.addEventListener("click", () => blocks.addBlank(section, true));
        const addPropertyBtn = addButtons.createDiv({
          cls: "clickable-icon typ-frontmatter-add",
          attr: { "aria-label": "Add property" }
        });
        setIcon(addPropertyBtn, "plus");
        addPropertyBtn.addEventListener("click", () => blocks.addBlank(section, false));
      }
      // Footer of a Subtyp block: on the left the Subtyp color (a dot opening the
      // sliders, reset next to it), on the right the same actions in the same order
      // as the detail header (rename and update notes, rename, manually creatable,
      // delete). The TYP-Frontmatter has no footer. The title is looked up on
      // click - heading and footer are rebuilt on every synchronize().
      renderSectionFooter(el, typ, subtyp) {
        el.addClass("typ-subtyp-actions");
        const colorGroup = el.createDiv({ cls: "typ-subtyp-color-group" });
        const ownColor = subtypHasOwnColor(this.plugin.settings, typ, subtyp);
        const typHasColor = !!this.plugin.settings.typColors[typ];
        const colorDot = colorGroup.createDiv({
          cls: "typ-subtyp-color-dot",
          attr: { "aria-label": !typHasColor ? "TYP has no color" : ownColor ? "Adjust color" : "Uses TYP color" }
        });
        colorDot.typSubtyp = subtyp;
        paintColorDot(colorDot, subtypColor(this.plugin.settings, typ, subtyp) ?? DEFAULT_TYP_COLOR, !ownColor || !typHasColor);
        colorDot.addEventListener("click", () => this.openSubtypColorPopover(colorDot, typ, subtyp));
        const resetBtn = colorGroup.createDiv({ cls: "clickable-icon typ-color-reset", attr: { "aria-label": "Reset color" } });
        resetBtn.toggleClass("is-disabled", !ownColor);
        setIcon(resetBtn, "rotate-ccw");
        resetBtn.addEventListener("click", async () => {
          const data = getSubtyp2(this.plugin.settings, typ, subtyp);
          if (!data?.color) return;
          const snapshot = snapshotSettings(this.plugin);
          delete data.color;
          await this.plugin.saveSettings();
          offerUndo(this.plugin, `Color of Subtyp ${subtyp} reset.`, snapshot);
          this.refreshOtherViews();
          this.render();
        });
        const actions = el.createDiv({ cls: "typ-subtyp-action-group" });
        const titleEl = () => {
          let sibling = el.previousElementSibling;
          while (sibling && !sibling.hasClass("typ-section-header")) sibling = sibling.previousElementSibling;
          return sibling?.querySelector(".typ-detail-section-title") ?? null;
        };
        const rename = (updateNotes) => {
          const target = titleEl();
          if (target) this.startSubtypRename(typ, subtyp, target, { updateNotes });
        };
        const renameWithNotesBtn = actions.createDiv({
          cls: "clickable-icon typ-detail-rename-notes",
          attr: { "aria-label": "Rename and update notes" }
        });
        setIcon(renameWithNotesBtn, "pencil");
        renameWithNotesBtn.addEventListener("click", () => rename(true));
        const renameBtn = actions.createDiv({ cls: "clickable-icon typ-detail-rename", attr: { "aria-label": "Rename" } });
        setIcon(renameBtn, "pencil");
        renameBtn.addEventListener("click", () => rename(false));
        this.renderSubtypManualToggle(actions, typ, subtyp);
        const deleteBtn = actions.createDiv({ cls: "clickable-icon typ-detail-delete", attr: { "aria-label": "Delete" } });
        setIcon(deleteBtn, "trash");
        deleteBtn.addEventListener("click", () => this.deleteSubtypWithConfirm(typ, subtyp));
      }
      // Popover below a Subtyp block's dot: one slider per channel, limited to the
      // range from the settings (see typ-colors.js), each track showing the colors
      // it can reach. Dragging only updates the dot here; saving, updating the
      // other views and re-rendering this one happen on close (click outside or
      // Escape), and only if the color changed.
      //
      // A Subtyp color is an offset from the TYP color: while the TYP has none,
      // there is nothing to offset, so the popover says so and the sliders are
      // locked (the dot stays a hollow ring, see renderSectionFooter).
      openSubtypColorPopover(anchorEl, typ, subtyp) {
        this.closeSubtypColorPopover?.();
        const { settings } = this.plugin;
        const data = getSubtyp2(settings, typ, subtyp);
        if (!data) return;
        const typHasColor = !!settings.typColors[typ];
        const typColor = settings.typColors[typ] ?? DEFAULT_TYP_COLOR;
        const offset = clampedOffset(settings, data.color) ?? Object.fromEntries(SUBTYP_COLOR_CHANNELS.map(({ key }) => [key, 0]));
        const doc = anchorEl.doc;
        const popover = doc.body.createDiv({ cls: "menu typ-subtyp-color-popover" });
        if (!typHasColor) popover.createDiv({ cls: "typ-subtyp-color-hint", text: `Set a color for ${typ} first.` });
        const rows = [];
        const update = () => {
          const color = applyColorOffset(typColor, offset);
          for (const el of this.contentEl.querySelectorAll(".typ-subtyp-color-dot")) {
            if (el.typSubtyp === subtyp) paintColorDot(el, color, !hasColorOffset(offset) || !settings.typColors[typ]);
          }
          for (const row of rows) row();
        };
        for (const { key, label, unit } of SUBTYP_COLOR_CHANNELS) {
          const [min, max] = channelBounds(settings, key);
          const row = popover.createDiv({ cls: "typ-subtyp-color-row" });
          row.createSpan({ cls: "typ-subtyp-color-label", text: label });
          const input = row.createEl("input", { type: "range", cls: "slider typ-subtyp-color-slider" });
          input.min = String(min);
          input.max = String(max);
          input.step = "1";
          input.value = String(offset[key]);
          input.disabled = min === max || !typHasColor;
          const valueEl = row.createSpan({ cls: "typ-subtyp-color-value" });
          input.addEventListener("input", () => {
            offset[key] = Number(input.value);
            update();
          });
          rows.push(() => {
            const steps = 8;
            const stops = [];
            for (let i = 0; i <= steps; i++) {
              stops.push(applyColorOffset(typColor, { ...offset, [key]: min + (max - min) * i / steps }));
            }
            input.style.setProperty("--typ-track", `linear-gradient(to right, ${stops.join(", ")})`);
            valueEl.setText(`${offset[key] > 0 ? "+" : ""}${offset[key]}${unit}`);
          });
        }
        update();
        const rect = anchorEl.getBoundingClientRect();
        const win = doc.defaultView;
        const width = popover.offsetWidth;
        const height = popover.offsetHeight;
        popover.style.left = `${Math.max(8, Math.min(rect.left, win.innerWidth - width - 8))}px`;
        popover.style.top = `${rect.bottom + 6 + height > win.innerHeight - 8 ? rect.top - 6 - height : rect.bottom + 6}px`;
        const onPointerDown = (event) => {
          if (!popover.contains(event.target)) close();
        };
        const onKeyDown = (event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          close();
        };
        const close = async () => {
          this.closeSubtypColorPopover = null;
          doc.removeEventListener("mousedown", onPointerDown, true);
          doc.removeEventListener("keydown", onKeyDown, true);
          popover.remove();
          const current = getSubtyp2(settings, typ, subtyp);
          if (!current) return;
          const next = hasColorOffset(offset) ? { ...offset } : null;
          if (JSON.stringify(next) === JSON.stringify(current.color ?? null)) return;
          const snapshot = snapshotSettings(this.plugin);
          if (next) current.color = next;
          else delete current.color;
          await this.plugin.saveSettings();
          offerUndo(this.plugin, `Color of Subtyp ${subtyp} changed.`, snapshot);
          this.refreshOtherViews();
          this.render();
        };
        this.closeSubtypColorPopover = close;
        doc.addEventListener("mousedown", onPointerDown, true);
        doc.addEventListener("keydown", onKeyDown, true);
      }
      // Deletes the Subtyp block with its properties. Notes keep their SUBTYP
      // value (it then shows as unregistered below), so confirmation is only
      // needed when properties would be lost. Either way an undo is offered
      // afterwards (see undo.js).
      deleteSubtypWithConfirm(typ, subtyp) {
        const apply = async () => {
          const snapshot = snapshotSettings(this.plugin);
          deleteSubtyp(this.plugin.settings, typ, subtyp);
          await this.plugin.saveSettings();
          offerUndo(this.plugin, `Subtyp ${subtyp} deleted.`, snapshot);
          this.refreshOtherViews();
          this.render();
        };
        const keys = Object.keys(getSubtyp2(this.plugin.settings, typ, subtyp)?.frontmatter ?? {}).filter((key) => key !== "");
        if (keys.length === 0) {
          apply();
          return;
        }
        const { plugin } = this;
        this.confirmDeletion(
          {
            title: [
              "Delete ",
              subtypNameNode(plugin, typ, subtyp),
              " of ",
              typNameNode(plugin, typ, plugin.settings.typColors[typ] ?? null),
              "?"
            ],
            body: [
              keys.length === 1 ? `Its property ${keys[0]} will be lost.` : `Its ${keys.length} properties ${keys.join(", ")} will be lost.`
            ]
          },
          apply
        );
      }
      // "Delete TYP" and "Delete Subtyp" change nothing but the settings and offer
      // Undo afterwards, so - unlike every dialog that rewrites notes - their
      // confirmation can be switched off: setting "Confirm deletion", or "Don't
      // ask again" in the dialog itself. Without it apply() runs at once.
      confirmDeletion({ title, body }, apply) {
        if (!this.plugin.settings.confirmDeletion) {
          apply();
          return;
        }
        new ConfirmModal(this.app, {
          title,
          body,
          confirmText: "Delete",
          warning: true,
          focus: "cancel",
          dontAskAgain: true,
          onConfirm: (dontAskAgain) => {
            if (dontAskAgain) this.plugin.settings.confirmDeletion = false;
            apply();
          }
        }).open();
      }
      // Like startDetailRename(), on a Subtyp block's title. The block keeps its
      // position; updateNotes: true also rewrites the SUBTYP of the affected notes
      // after confirmation. An existing name offers a merge instead (which always
      // rewrites the notes).
      startSubtypRename(typ, subtyp, titleEl, { updateNotes = false } = {}) {
        this.startInlineEdit(titleEl, {
          classes: ["typ-subtyp-name-input", "is-being-renamed"],
          // The title sits among Obsidian's property editors, whose keyboard
          // navigation would react too.
          stopAllKeys: true,
          onFinish: (commit, text) => commit ? this.commitSubtypRename(typ, subtyp, text, { updateNotes }) : this.render()
        });
      }
      async commitSubtypRename(typ, subtyp, rawText, { updateNotes }) {
        const value = normalizeSubtypName(rawText);
        if (!value || value === subtyp) {
          this.render();
          return;
        }
        const countOf = (name) => this.plugin.typIndex.subtypBucket(typ).counts.get(name) ?? 0;
        const applyRename = async ({ withNotes }) => {
          renameSubtyp(this.plugin.settings, typ, subtyp, value);
          await this.plugin.saveSettings();
          const renamed = withNotes ? await renameSubtypInNotes(this.plugin, typ, subtyp, value) : 0;
          this.refreshOtherViews();
          if (withNotes) new Notice(`Subtyp ${value}: ${plural(renamed, "note")} updated.`);
          this.render();
        };
        const existing = getSubtypNames2(this.plugin.settings, typ).find(
          (name) => name.toLowerCase() === value.toLowerCase() && name !== subtyp
        );
        if (existing) {
          new ConfirmModal(this.app, {
            title: [
              "Merge ",
              subtypNameNode(this.plugin, typ, subtyp),
              " into ",
              subtypNameNode(this.plugin, typ, existing),
              "?"
            ],
            body: [
              `${existing} already exists in ${typ}. ${plural(countOf(subtyp), "note")} ${countOf(subtyp) === 1 ? "moves" : "move"} to it, and the properties of ${subtyp} move into its block.`
            ],
            confirmText: "Merge",
            warning: true,
            focus: "cancel",
            onConfirm: async () => {
              mergeSubtyps(this.plugin.settings, typ, subtyp, existing);
              await this.plugin.saveSettings();
              const renamed = await renameSubtypInNotes(this.plugin, typ, subtyp, existing);
              this.refreshOtherViews();
              new Notice(`Subtyp ${subtyp} merged into ${existing}, ${plural(renamed, "note")} updated.`);
              this.render();
            },
            onCancel: () => this.render()
          }).open();
          return;
        }
        if (!updateNotes) {
          await applyRename({ withNotes: false });
          return;
        }
        new ConfirmModal(this.app, {
          title: [
            "Rename ",
            subtypNameNode(this.plugin, typ, subtyp),
            " to ",
            subtypNameNode(this.plugin, typ, value, subtyp),
            "?"
          ],
          body: [`${plural(countOf(subtyp), "note")} will be updated.`],
          confirmText: "Rename",
          focus: "confirm",
          onConfirm: () => applyRename({ withNotes: true }),
          onCancel: () => this.render()
        }).open();
      }
      // Like the unregistered entries of the TYP-List: SUBTYP values of this TYP's
      // notes that have no block yet (notes without any SUBTYP count for the
      // TYP-Frontmatter instead). Shown like Subtyp blocks, but only heading and
      // count. A click on the block registers the value; a click on the name opens
      // the search instead - checking what a value holds before registering it is
      // the common case. The name lights up in accent color on hover to show it
      // does something different from the area around it.
      renderUnregisteredSubtyps(parent, typ, bucket) {
        const registered = getSubtypNames2(this.plugin.settings, typ);
        const unregistered = [...bucket.counts.keys()].filter((key) => !registered.includes(key)).sort((a, b) => bucket.counts.get(b) - bucket.counts.get(a) || a.localeCompare(b));
        if (unregistered.length === 0) return;
        const listEl = parent.createDiv({ cls: "typ-subtyp-unregistered-list" });
        for (const key of unregistered) {
          const block = listEl.createDiv({ cls: "typ-frontmatter-block typ-subtyp-block typ-subtyp-unregistered" });
          const header = block.createDiv({ cls: "typ-frontmatter-header" });
          const titleGroup = header.createDiv({ cls: "typ-frontmatter-title-group" });
          const titleEl = titleGroup.createDiv({ cls: "typ-detail-section-title", text: displayTypKey(key) });
          titleGroup.createSpan({ cls: "typ-subtyp-count", text: String(bucket.counts.get(key)) });
          block.addEventListener("click", () => this.registerSubtyp(typ, key, bucket));
          this.makeSearchable(titleEl, () => this.openSubtypSearch(typ, key), { stopPropagation: true });
        }
      }
      // A name whose click opens the search: pointer cursor and accent color on
      // hover (.typ-searchable), so the view itself shows where something happens.
      // The name is where one expects "show me these notes". While renaming, the
      // element is an input (is-being-renamed) and a click just places the cursor.
      makeSearchable(el, onSearch, { stopPropagation = false } = {}) {
        el.addClass("typ-searchable");
        el.addEventListener("click", (event) => {
          if (el.hasClass("is-being-renamed")) return;
          if (stopPropagation) event.stopPropagation();
          onSearch();
        });
      }
      // subtypKey === null means notes of this TYP without SUBTYP. A list has no
      // exact search syntax (as in openSearch()), so it searches notes carrying all
      // its items.
      openSubtypSearch(typ, subtypKey) {
        const globalSearch = this.plugin.app.internalPlugins.getPluginById("global-search");
        if (!globalSearch) return;
        const typClause = this.typClause(typ);
        let subtypClause;
        if (subtypKey === null) {
          subtypClause = `-["${SUBTYP_PROPERTY2}"]`;
        } else {
          const raw = this.plugin.typIndex.subtypBucket(typ).rawByKey.get(subtypKey);
          subtypClause = Array.isArray(raw) ? raw.map((v) => `["${SUBTYP_PROPERTY2}":"${String(v ?? "").trim()}"]`).join(" ") : `["${SUBTYP_PROPERTY2}":"${subtypKey}"]`;
        }
        globalSearch.instance.openGlobalSearch(`${typClause} ${subtypClause}`);
      }
      // Like registerTyp(): registers the cleaned form (title case, a list as one
      // value "A, B") as a Subtyp of this TYP and rewrites the SUBTYP of the
      // affected notes. If the Subtyp exists in another spelling, the notes go
      // there.
      async registerSubtyp(typ, subtypKey, bucket) {
        const result = await this.applySubtypRegistration(typ, subtypKey, bucket);
        if (!result) return;
        await this.plugin.saveSettings();
        this.refreshOtherViews();
        this.render();
        if (result.renamed > 0) new Notice(`Subtyp ${result.subtyp} registered, ${plural(result.renamed, "note")} updated.`);
      }
      // Like applyTypRegistration: the core without saving and notice, so
      // registerTypWithSubtyp() can bundle it. Returns { subtyp, renamed } or null.
      async applySubtypRegistration(typ, subtypKey, bucket) {
        const raw = bucket.rawByKey.get(subtypKey);
        const normalized = normalizeRawTyp(raw === void 0 ? subtypKey : raw, normalizeSubtypName);
        if (!normalized) return null;
        const existing = getSubtypNames2(this.plugin.settings, typ).find((name) => name.toLowerCase() === normalized.toLowerCase());
        const subtyp = existing ?? normalized;
        ensureSubtyp(this.plugin.settings, typ, subtyp);
        const renamed = subtyp !== subtypKey ? await renameSubtypInNotes(this.plugin, typ, subtypKey, subtyp) : 0;
        return { subtyp, renamed };
      }
      // A new, empty Subtyp block right above the "Add Subtyp" button, its name
      // typed inline (like startAdd() in the list).
      startAddSubtyp(typ) {
        if (this.isEditing || !this.subtypAddBtnEl) return;
        const block = createDiv({ cls: "typ-frontmatter-block typ-subtyp-block typ-subtyp-pending" });
        this.subtypAddBtnEl.parentElement.insertBefore(block, this.subtypAddBtnEl);
        const header = block.createDiv({ cls: "typ-frontmatter-header" });
        const titleGroup = header.createDiv({ cls: "typ-frontmatter-title-group" });
        const nameEl = titleGroup.createDiv({ cls: "typ-detail-section-title typ-subtyp-name-input is-being-renamed" });
        const addButtons = header.createDiv({ cls: "typ-frontmatter-add-group" });
        setIcon(addButtons.createDiv({ cls: "clickable-icon typ-frontmatter-add-floating" }), "plus");
        setIcon(addButtons.createDiv({ cls: "clickable-icon typ-frontmatter-add" }), "plus");
        const footer = block.createDiv({ cls: "typ-section-footer typ-subtyp-actions" });
        const colorGroup = footer.createDiv({ cls: "typ-subtyp-color-group" });
        paintColorDot(colorGroup.createDiv({ cls: "typ-subtyp-color-dot" }), this.plugin.settings.typColors[typ] ?? DEFAULT_TYP_COLOR, true);
        setIcon(colorGroup.createDiv({ cls: "clickable-icon typ-color-reset is-disabled" }), "rotate-ccw");
        const actions = footer.createDiv({ cls: "typ-subtyp-action-group" });
        setIcon(actions.createDiv({ cls: "clickable-icon typ-detail-rename-notes" }), "pencil");
        setIcon(actions.createDiv({ cls: "clickable-icon typ-detail-rename" }), "pencil");
        const manualCls = "clickable-icon typ-manual-icon" + (this.ensureTypManual()[typ] !== false ? " is-active" : "");
        setIcon(actions.createDiv({ cls: manualCls }), "file-pen-line");
        setIcon(actions.createDiv({ cls: "clickable-icon typ-detail-delete" }), "trash");
        this.startInlineEdit(nameEl, {
          // nameEl carries the input classes from the start.
          classes: [],
          onFinish: async (commit, text) => {
            const value = normalizeSubtypName(text);
            if (commit && value) {
              const existing = getSubtypNames2(this.plugin.settings, typ).find((name) => name.toLowerCase() === value.toLowerCase());
              if (existing) {
                new Notice(`${typ} already has Subtyp ${existing}.`);
              } else {
                ensureSubtyp(this.plugin.settings, typ, value);
                await this.plugin.saveSettings();
              }
            }
            this.render();
          }
        });
      }
      // Notes keep their TYP (it then shows as unregistered), so this only changes
      // settings: Undo afterwards, and the confirmation can be switched off (see
      // confirmDeletion). From the detail header or the list's context menu.
      showDeleteConfirm(typ) {
        const apply = async () => {
          const snapshot = snapshotSettings(this.plugin);
          deleteTypSettings(this.plugin.settings, typ);
          if (this.selectedTyp === typ) this.closeTypSettings();
          else this.render();
          await this.plugin.saveSettings();
          offerUndo(this.plugin, `TYP ${typ} deleted.`, snapshot);
          this.refreshOtherViews();
        };
        this.confirmDeletion(
          { title: ["Delete ", typNameNode(this.plugin, typ, this.plugin.settings.typColors[typ] ?? null), "?"] },
          apply
        );
      }
      // "Rename" / "Rename and update notes" from the list's context menu: the
      // name in the row becomes the input, the rest is the same as in the detail
      // view (commitTypRename).
      startListRename(typ, self, nameEl, options = {}) {
        if (this.isEditing) return;
        self.draggable = false;
        this.startInlineEdit(nameEl, {
          classEl: self,
          onFinish: (commit, text) => commit ? this.commitTypRename(typ, text, options) : this.render()
        });
      }
      // The rename buttons of the detail header, on the title.
      startDetailRename(typ, titleEl, options = {}) {
        this.startInlineEdit(titleEl, {
          onFinish: (commit, text) => commit ? this.commitTypRename(typ, text, options) : this.render()
        });
      }
      // The rename itself, shared by list and detail view. updateNotes: true (the
      // highlighted button) also rewrites the TYP of every affected note after
      // confirmation (see renameTypInNotes) instead of only the settings. An
      // existing name offers a merge (showMergeConfirm).
      async commitTypRename(typ, rawText, { updateNotes = false } = {}) {
        const value = normalizeTypName(rawText);
        if (!value || value === typ) {
          this.render();
          return;
        }
        const existing = this.plugin.settings.typs.find((t) => t.toLowerCase() === value.toLowerCase() && t !== typ);
        if (existing) {
          this.showMergeConfirm(typ, existing);
          return;
        }
        if (!updateNotes) {
          await this.renameTypSettings(typ, value);
          this.render();
          return;
        }
        const { counts } = this.plugin.typIndex.typCounts();
        const color = this.plugin.settings.typColors[typ] ?? null;
        new ConfirmModal(this.app, {
          title: ["Rename ", typNameNode(this.plugin, typ, color), " to ", typNameNode(this.plugin, value, color), "?"],
          body: [`${plural(counts.get(typ) ?? 0, "note")} will be updated.`],
          confirmText: "Rename",
          focus: "confirm",
          onConfirm: async () => {
            await this.renameTypSettings(typ, value);
            const renamed = await renameTypInNotes(this.plugin, typ, value);
            new Notice(`TYP ${value}: ${plural(renamed, "note")} updated.`);
            this.render();
          },
          onCancel: () => this.render()
        }).open();
      }
      // Moves only the settings (list position, color, description,
      // TYP-Frontmatter, manual toggle, Subtyps - see typ-settings.js) to the new
      // name; touches no notes. An open detail view follows the new name, a
      // rename from the list stays in the list.
      async renameTypSettings(typ, value) {
        moveTypSettings(this.plugin.settings, typ, value);
        if (this.selectedTyp === typ) this.selectedTyp = value;
        await this.plugin.saveSettings();
        this.refreshOtherViews();
      }
      // Renaming to the name of an already registered TYP (see commitTypRename)
      // offers to merge both (see mergeTyp) instead of silently dropping the
      // rename. It always rewrites the notes, whichever rename button started it:
      // a merge in the settings only would leave the source TYP's notes as an
      // unregistered entry.
      showMergeConfirm(source, target) {
        const { settings } = this.plugin;
        const count = this.plugin.typIndex.typCounts().counts.get(source) ?? 0;
        new ConfirmModal(this.app, {
          title: [
            "Merge ",
            typNameNode(this.plugin, source, settings.typColors[source] ?? null),
            " into ",
            typNameNode(this.plugin, target, settings.typColors[target] ?? null),
            "?"
          ],
          body: [
            `${target} already exists. ${plural(count, "note")} ${count === 1 ? "moves" : "move"} to it. The color, description and TYP-Frontmatter of ${source} are dropped. Every Subtyp moves along; blocks with the same name are merged.`
          ],
          confirmText: "Merge",
          warning: true,
          focus: "cancel",
          onConfirm: () => this.mergeTyp(source, target),
          onCancel: () => this.render()
        }).open();
      }
      // Merges source into target: notes are rewritten to target, source leaves
      // the list with its settings (target keeps its own). Source's Subtyps move
      // over first, same-named blocks are combined (see mergeTypSubtyps in
      // subtyps.js); then the rest of source goes like a deleted TYP.
      //
      // "Manually creatable" is where a merge does more than move data: the moved
      // Subtyps bring source's toggles but end up under target's. With source on
      // and target off they would be switched-on Subtyps under a switched-off TYP,
      // unreachable in the picker. So a switched-off target switches them off too,
      // as its own button would (see renderManualToggle). With target on they stay
      // as they were.
      //
      // An open detail view of source moves to target; a merge started from the
      // list stays in the list.
      async mergeTyp(source, target) {
        const settings = this.plugin.settings;
        const renamed = await renameTypInNotes(this.plugin, source, target);
        mergeTypSubtyps(settings, source, target);
        deleteTypSettings(settings, source);
        if (this.ensureTypManual()[target] === false) setAllSubtypsManual(settings, target, false);
        if (this.selectedTyp === source) this.selectedTyp = target;
        await this.plugin.saveSettings();
        this.refreshOtherViews();
        new Notice(`TYP ${source} merged into ${target}, ${plural(renamed, "note")} updated.`);
        this.render();
      }
      renderCountFlair(self, count) {
        const flairOuter = self.createDiv({ cls: "tree-item-flair-outer" });
        flairOuter.createSpan({ cls: "tree-item-flair", text: String(count) });
      }
      // Explains the floating toggle (right-click on a property above, see
      // ensurePropertyMenuPatch). No heading - right below the list it is clear
      // what it refers to.
      renderFloatingHint(parent) {
        const section = parent.createDiv({ cls: "typ-floating-hint-section" });
        section.createDiv({
          cls: "typ-floating-hint",
          text: "Right-click a property to make it floating."
        });
      }
    };
    function registerTypPane2(plugin) {
      plugin.registerView(VIEW_TYPE_TYP_PANE, (leaf) => new TypPane(leaf, plugin));
      plugin.addCommand({
        id: "open-typ-pane",
        name: "Open TYP-Pane",
        callback: () => activateTypPane(plugin)
      });
      plugin.addCommand({
        id: "add-typ-property",
        name: "Add TYP-Frontmatter property",
        callback: () => addTypPropertyCommand(plugin)
      });
      plugin.app.workspace.onLayoutReady(() => openTypPaneOnStart(plugin));
      const refresh = (exceptView = null) => {
        for (const leaf of plugin.app.workspace.getLeavesOfType(VIEW_TYPE_TYP_PANE)) {
          if (leaf.view === exceptView) continue;
          if (leaf.view?.requestRender) leaf.view.requestRender();
          else leaf.view?.render?.();
        }
      };
      const debouncedRefresh = debounce(() => refresh(), 500, true);
      plugin.registerEvent(plugin.typIndex.on("change", debouncedRefresh));
      plugin.registerEvent(plugin.app.vault.on("config-changed", debouncedRefresh));
      return refresh;
    }
    var PANE_CREATED_KEY = "typ-system-pane-created";
    async function openTypPaneOnStart(plugin) {
      const app = plugin.app;
      const firstRun = plugin.isFirstRun && !app.loadLocalStorage(PANE_CREATED_KEY);
      await activateTypPane(plugin, firstRun, firstRun);
      if (firstRun) app.saveLocalStorage(PANE_CREATED_KEY, true);
    }
    async function activateTypPane(plugin, reveal = true, createIfMissing = true) {
      const app = plugin.app;
      const { workspace } = app;
      const candidates = [];
      workspace.iterateAllLeaves((leaf2) => {
        if (leaf2 === app.__typSystemLeaf || leaf2.view && leaf2.view.getViewType() === VIEW_TYPE_TYP_PANE) {
          candidates.push(leaf2);
        }
      });
      let leaf = candidates.shift() ?? null;
      for (const extra of candidates) extra.detach();
      if (!leaf) {
        if (!createIfMissing) return;
        leaf = workspace.getLeftLeaf(false);
        await leaf.setViewState({ type: VIEW_TYPE_TYP_PANE, active: true });
      } else if (!(leaf.view instanceof TypPane)) {
        await leaf.setViewState({ type: VIEW_TYPE_TYP_PANE, active: false });
      }
      app.__typSystemLeaf = leaf;
      if (reveal) workspace.revealLeaf(leaf);
    }
    async function addTypPropertyCommand(plugin) {
      const app = plugin.app;
      const activeTypPane = app.workspace.getActiveViewOfType(TypPane);
      if (activeTypPane && activeTypPane.selectedTyp !== null) {
        activeTypPane.frontmatterBlocks?.addBlank(null);
        return;
      }
      const file = app.workspace.getActiveFile();
      const typ = plugin.typIndex.typOf(file);
      if (!typ) {
        const openLeaf = app.workspace.getLeavesOfType(VIEW_TYPE_TYP_PANE).find((leaf) => leaf.view instanceof TypPane && leaf.view.selectedTyp !== null);
        if (openLeaf) {
          await app.workspace.revealLeaf(openLeaf);
          openLeaf.view.frontmatterBlocks?.addBlank(null);
          return;
        }
        new Notice(
          file ? "The active note has no TYP, and no TYP is open in the TYP-Pane." : "No note is open, and no TYP is open in the TYP-Pane."
        );
        return;
      }
      await activateTypPane(plugin);
      const view = app.__typSystemLeaf?.view;
      if (!(view instanceof TypPane)) return;
      view.openTypSettings(typ);
      view.frontmatterBlocks?.addBlank(null);
    }
    module2.exports = { registerTypPane: registerTypPane2, VIEW_TYPE_TYP_PANE, compareTyps, sortTypsByMode: sortTypsByMode2, DEFAULT_SORT_ORDER: DEFAULT_SORT_ORDER2, DEFAULT_TYP_COLOR };
  }
});

// src/file-explorer-colors.js
var require_file_explorer_colors = __commonJS({
  "src/file-explorer-colors.js"(exports2, module2) {
    var { TFile, TFolder } = require("obsidian");
    var { colorForFile, setInlineColor } = require_typ_colors();
    var FILE_EXPLORER_VIEW_TYPE = "file-explorer";
    var FOLDER_NOTES_PLUGIN_ID = "folder-notes";
    function getFolderNoteFile(plugin, folder) {
      const folderNotes = plugin.app.plugins.plugins[FOLDER_NOTES_PLUGIN_ID];
      const settings = folderNotes?.settings;
      if (!settings) return null;
      const fileName = (settings.folderNoteName || "{{folder_name}}").replace("{{folder_name}}", folder.name) + (settings.folderNoteType || ".md");
      const dirPath = settings.storageLocation === "parentFolder" ? folder.parent?.path ?? "" : folder.path;
      const path = dirPath ? `${dirPath}/${fileName}` : fileName;
      const file = plugin.app.vault.getAbstractFileByPath(path);
      return file instanceof TFile ? file : null;
    }
    function applyColorToTitle(plugin, titleEl, file) {
      const contentEl = titleEl.querySelector(".nav-file-title-content, .nav-folder-title-content");
      if (!contentEl) return;
      const color = plugin.settings.colorViews.fileExplorer ? colorForFile(plugin, file, "fileExplorer") : null;
      setInlineColor(contentEl, color);
    }
    function applyFileExplorerColors(plugin) {
      for (const leaf of plugin.app.workspace.getLeavesOfType(FILE_EXPLORER_VIEW_TYPE)) {
        const fileTitleEls = leaf.view.containerEl.querySelectorAll(".nav-file-title[data-path]");
        for (const titleEl of fileTitleEls) {
          const file = plugin.app.vault.getAbstractFileByPath(titleEl.getAttribute("data-path"));
          applyColorToTitle(plugin, titleEl, file instanceof TFile ? file : null);
        }
        const folderTitleEls = leaf.view.containerEl.querySelectorAll(".nav-folder-title[data-path]");
        for (const titleEl of folderTitleEls) {
          const folder = plugin.app.vault.getAbstractFileByPath(titleEl.getAttribute("data-path"));
          const noteFile = folder instanceof TFolder ? getFolderNoteFile(plugin, folder) : null;
          applyColorToTitle(plugin, titleEl, noteFile);
        }
      }
    }
    function registerFileExplorerColors2(plugin) {
      const refresh = () => applyFileExplorerColors(plugin);
      const observer = new MutationObserver(refresh);
      const observeExplorerLeaves = () => {
        for (const leaf of plugin.app.workspace.getLeavesOfType(FILE_EXPLORER_VIEW_TYPE)) {
          observer.observe(leaf.view.containerEl, { childList: true, subtree: true });
        }
      };
      plugin.register(() => observer.disconnect());
      plugin.registerEvent(plugin.typIndex.on("change", refresh));
      plugin.registerEvent(plugin.app.vault.on("rename", refresh));
      plugin.registerEvent(
        plugin.app.workspace.on("layout-change", () => {
          observeExplorerLeaves();
          refresh();
        })
      );
      plugin.app.workspace.onLayoutReady(() => {
        observeExplorerLeaves();
        refresh();
      });
      return refresh;
    }
    module2.exports = { registerFileExplorerColors: registerFileExplorerColors2 };
  }
});

// src/graph-colors.js
var require_graph_colors = __commonJS({
  "src/graph-colors.js"(exports2, module2) {
    var { colorForFile } = require_typ_colors();
    var GRAPH_VIEW_TYPES = ["graph", "localgraph"];
    function hexToInt(hex) {
      return parseInt(hex.replace("#", ""), 16);
    }
    function patchRenderer(plugin, renderer) {
      if (renderer.__typSystemColorPatched) return;
      renderer.__typSystemColorPatched = true;
      const original = renderer.setData;
      renderer.setData = function(data) {
        for (const path in data.nodes) {
          const node = data.nodes[path];
          if (node.color) continue;
          if (node.type === "tag") {
            continue;
          }
          const file = plugin.app.vault.getAbstractFileByPath(path);
          let color = null;
          if (file && file.extension !== "md") {
          } else if (plugin.settings.colorViews.graph) {
            color = colorForFile(plugin, file, "graph");
          }
          if (color) node.color = { a: 1, rgb: hexToInt(color) };
        }
        return original.call(this, data);
      };
      plugin.register(() => {
        renderer.setData = original;
        delete renderer.__typSystemColorPatched;
      });
    }
    function getGraphLeaves(app) {
      const leaves = [];
      for (const viewType of GRAPH_VIEW_TYPES) leaves.push(...app.workspace.getLeavesOfType(viewType));
      return leaves;
    }
    function registerGraphColors2(plugin) {
      const refresh = () => {
        for (const leaf of getGraphLeaves(plugin.app)) {
          if (leaf.view?.renderer) patchRenderer(plugin, leaf.view.renderer);
          (leaf.view?.dataEngine ?? leaf.view?.engine)?.render();
        }
      };
      plugin.register(() => {
        for (const leaf of getGraphLeaves(plugin.app)) (leaf.view?.dataEngine ?? leaf.view?.engine)?.render();
      });
      plugin.registerEvent(plugin.app.workspace.on("layout-change", refresh));
      plugin.registerEvent(plugin.typIndex.on("change", refresh));
      plugin.app.workspace.onLayoutReady(refresh);
      return refresh;
    }
    module2.exports = { registerGraphColors: registerGraphColors2 };
  }
});

// src/search-colors.js
var require_search_colors = __commonJS({
  "src/search-colors.js"(exports2, module2) {
    var { colorForFile, setInlineColor } = require_typ_colors();
    var SEARCH_VIEW_TYPE = "search";
    function applySearchColors(plugin) {
      for (const leaf of plugin.app.workspace.getLeavesOfType(SEARCH_VIEW_TYPE)) {
        const resultDomLookup = leaf.view?.dom?.resultDomLookup;
        if (!resultDomLookup) continue;
        for (const [file, resultDom] of resultDomLookup) {
          const titleEl = resultDom.el?.querySelector(".search-result-file-title .tree-item-inner");
          if (!titleEl) continue;
          const color = plugin.settings.colorViews.search ? colorForFile(plugin, file, "search") : null;
          setInlineColor(titleEl, color);
        }
      }
    }
    function registerSearchColors2(plugin) {
      const refresh = () => applySearchColors(plugin);
      const observer = new MutationObserver(refresh);
      const observeLeaves = () => {
        for (const leaf of plugin.app.workspace.getLeavesOfType(SEARCH_VIEW_TYPE)) {
          observer.observe(leaf.view.containerEl, { childList: true, subtree: true });
        }
      };
      plugin.register(() => observer.disconnect());
      plugin.registerEvent(plugin.typIndex.on("change", refresh));
      plugin.registerEvent(
        plugin.app.workspace.on("layout-change", () => {
          observeLeaves();
          refresh();
        })
      );
      plugin.app.workspace.onLayoutReady(() => {
        observeLeaves();
        refresh();
      });
      return refresh;
    }
    module2.exports = { registerSearchColors: registerSearchColors2 };
  }
});

// src/recent-files-colors.js
var require_recent_files_colors = __commonJS({
  "src/recent-files-colors.js"(exports2, module2) {
    var { colorForFile, setInlineColor } = require_typ_colors();
    var RECENT_FILES_VIEW_TYPE = "recent-files";
    function applyRecentFilesColors(plugin) {
      for (const leaf of plugin.app.workspace.getLeavesOfType(RECENT_FILES_VIEW_TYPE)) {
        const recentFiles = leaf.view?.data?.recentFiles;
        if (!Array.isArray(recentFiles)) continue;
        const titleEls = leaf.view.containerEl.querySelectorAll(".recent-files-title .nav-file-title-content");
        titleEls.forEach((titleEl, index) => {
          const entry = recentFiles[index];
          const file = entry ? plugin.app.vault.getAbstractFileByPath(entry.path) : null;
          const color = plugin.settings.colorViews.recentFiles ? colorForFile(plugin, file, "recentFiles") : null;
          setInlineColor(titleEl, color);
        });
      }
    }
    function registerRecentFilesColors2(plugin) {
      const refresh = () => applyRecentFilesColors(plugin);
      const observer = new MutationObserver(refresh);
      const observeLeaves = () => {
        for (const leaf of plugin.app.workspace.getLeavesOfType(RECENT_FILES_VIEW_TYPE)) {
          observer.observe(leaf.view.containerEl, { childList: true, subtree: true });
        }
      };
      plugin.register(() => observer.disconnect());
      plugin.registerEvent(plugin.typIndex.on("change", refresh));
      plugin.registerEvent(
        plugin.app.workspace.on("layout-change", () => {
          observeLeaves();
          refresh();
        })
      );
      plugin.app.workspace.onLayoutReady(() => {
        observeLeaves();
        refresh();
      });
      return refresh;
    }
    module2.exports = { registerRecentFilesColors: registerRecentFilesColors2 };
  }
});

// src/backlink-colors.js
var require_backlink_colors = __commonJS({
  "src/backlink-colors.js"(exports2, module2) {
    var { colorForFile, setInlineColor } = require_typ_colors();
    var BACKLINK_VIEW_TYPE = "backlink";
    function getResultDomLookups(view) {
      const renderer = view?.backlink;
      const candidates = [renderer?.backlinkDom, renderer?.unlinkedDom, view?.backlinkDom, view?.unlinkedDom, view?.dom];
      const lookups = [];
      for (const dom of candidates) {
        if (dom?.resultDomLookup instanceof Map) lookups.push(dom.resultDomLookup);
      }
      return lookups;
    }
    function colorTitleEl(plugin, el, file) {
      const color = plugin.settings.colorViews.backlinks ? colorForFile(plugin, file, "backlinks") : null;
      setInlineColor(el, color);
    }
    function applyBacklinkPaneColors(plugin) {
      for (const leaf of plugin.app.workspace.getLeavesOfType(BACKLINK_VIEW_TYPE)) {
        for (const lookup of getResultDomLookups(leaf.view)) {
          for (const [file, resultDom] of lookup) {
            const titleEl = resultDom.el?.querySelector(".search-result-file-title .tree-item-inner");
            if (titleEl) colorTitleEl(plugin, titleEl, file);
          }
        }
      }
    }
    function applyEmbeddedBacklinkColors(plugin) {
      for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
        const paneEl = leaf.view.containerEl.querySelector(".embedded-backlinks .backlink-pane");
        if (!paneEl) continue;
        const sourcePath = leaf.view.file?.path ?? "";
        const titleEls = paneEl.querySelectorAll(".search-result-file-title .tree-item-inner");
        for (const titleEl of titleEls) {
          const basename = titleEl.textContent;
          const file = basename ? plugin.app.metadataCache.getFirstLinkpathDest(basename, sourcePath) : null;
          colorTitleEl(plugin, titleEl, file);
        }
      }
    }
    function applyBacklinkColors(plugin) {
      applyBacklinkPaneColors(plugin);
      applyEmbeddedBacklinkColors(plugin);
    }
    function registerBacklinkColors2(plugin) {
      const refresh = () => applyBacklinkColors(plugin);
      const observer = new MutationObserver(refresh);
      const observeLeaves = () => {
        for (const leaf of plugin.app.workspace.getLeavesOfType(BACKLINK_VIEW_TYPE)) {
          observer.observe(leaf.view.containerEl, { childList: true, subtree: true });
        }
      };
      plugin.register(() => observer.disconnect());
      plugin.registerEvent(plugin.typIndex.on("change", refresh));
      plugin.registerEvent(plugin.app.metadataCache.on("resolved", () => applyEmbeddedBacklinkColors(plugin)));
      plugin.registerEvent(
        plugin.app.workspace.on("layout-change", () => {
          observeLeaves();
          refresh();
        })
      );
      plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", refresh));
      plugin.app.workspace.onLayoutReady(() => {
        observeLeaves();
        refresh();
      });
      return refresh;
    }
    module2.exports = { registerBacklinkColors: registerBacklinkColors2 };
  }
});

// src/bookmark-colors.js
var require_bookmark_colors = __commonJS({
  "src/bookmark-colors.js"(exports2, module2) {
    var { colorForFile, setInlineColor } = require_typ_colors();
    var BOOKMARKS_VIEW_TYPE = "bookmarks";
    var BOOKMARKS_PLUGIN_ID = "bookmarks";
    function forEachFileBookmark(items, callback) {
      for (const item of items ?? []) {
        if (item.type === "file") callback(item);
        else if (item.type === "group") forEachFileBookmark(item.items, callback);
      }
    }
    function applyBookmarksColors(plugin) {
      const bookmarksPlugin = plugin.app.internalPlugins.getEnabledPluginById(BOOKMARKS_PLUGIN_ID);
      if (!bookmarksPlugin) return;
      for (const leaf of plugin.app.workspace.getLeavesOfType(BOOKMARKS_VIEW_TYPE)) {
        const itemDoms = leaf.view?.itemDoms;
        if (!itemDoms) continue;
        forEachFileBookmark(bookmarksPlugin.items, (item) => {
          const titleEl = itemDoms.get(item)?.titleEl;
          if (!titleEl) return;
          const file = plugin.app.vault.getAbstractFileByPath(item.path);
          const color = plugin.settings.colorViews.bookmarks ? colorForFile(plugin, file, "bookmarks") : null;
          setInlineColor(titleEl, color);
        });
      }
    }
    function registerBookmarksColors2(plugin) {
      const refresh = () => applyBookmarksColors(plugin);
      const observer = new MutationObserver(refresh);
      const observeLeaves = () => {
        for (const leaf of plugin.app.workspace.getLeavesOfType(BOOKMARKS_VIEW_TYPE)) {
          observer.observe(leaf.view.containerEl, { childList: true, subtree: true });
        }
      };
      plugin.register(() => observer.disconnect());
      plugin.registerEvent(plugin.typIndex.on("change", refresh));
      plugin.registerEvent(
        plugin.app.workspace.on("layout-change", () => {
          observeLeaves();
          refresh();
        })
      );
      plugin.app.workspace.onLayoutReady(() => {
        observeLeaves();
        refresh();
      });
      return refresh;
    }
    module2.exports = { registerBookmarksColors: registerBookmarksColors2 };
  }
});

// src/active-title-colors.js
var require_active_title_colors = __commonJS({
  "src/active-title-colors.js"(exports2, module2) {
    var { TFile } = require("obsidian");
    var { colorForFile, subtypColor, subtypHasOwnColor, setInlineColor } = require_typ_colors();
    var { getSubtyp: getSubtyp2 } = require_subtyps();
    var DOT_CLASS = "typ-title-dot";
    var DOT_HOLLOW_CLASS = "typ-title-dot-hollow";
    var DEFAULT_DOT_COLOR = "#888888";
    var BADGE_CLASS = "typ-title-badge";
    var BADGE_PLAIN_CLASS = "typ-title-badge-plain";
    var COLOR_VAR = "--typ-title-color";
    var BLOCK_BADGE_CLASS = "typ-block-badge";
    var BLOCK_BADGE_PLAIN_CLASS = "typ-block-badge-plain";
    var BLOCK_ALIGN_TOP_CLASS = "typ-block-badge-top";
    var BLOCK_ALIGN_BOTTOM_CLASS = "typ-block-badge-bottom";
    var BLOCK_COLOR_VAR = "--typ-block-color";
    function resolveMarker(plugin, file) {
      const style = plugin.settings.noteTitleStyle;
      if (style === "none") return { kind: "none" };
      if (style === "dot") return { kind: "dot", ...resolveDot(plugin, file) };
      const { settings } = plugin;
      const typ = plugin.typIndex.typOf(file);
      if (!typ) return { kind: "none" };
      const colored = settings.noteTitleBadgeColored;
      if (colored && !settings.typColors[typ] && !settings.typs.includes(typ)) return { kind: "none" };
      const typColor = settings.typColors[typ] ?? DEFAULT_DOT_COLOR;
      const label = badgeLabel(plugin, file, typ);
      if (!label) return { kind: "none" };
      const { text, useSubtypColor, subtyp } = label;
      const color = colored ? useSubtypColor ? subtypColor(settings, typ, subtyp) ?? typColor : typColor : null;
      const position = settings.noteTitleBadgePosition;
      return { kind: position === "block" ? "block-badge" : "title-badge", colored, color, typName: text };
    }
    function badgeLabel(plugin, file, typ) {
      const { settings } = plugin;
      const subtyp = plugin.typIndex.subtypOf(file);
      const mode = settings.noteTitleBadgeLabel ?? "typ";
      if (mode === "subtyp") return subtyp ? { text: subtyp, useSubtypColor: true, subtyp } : null;
      if (!subtyp || mode === "typ") return { text: typ, useSubtypColor: false, subtyp };
      return { text: `${typ}/${subtyp}`, useSubtypColor: !!settings.colorViews.noteTitleMarkerSubtyp, subtyp };
    }
    function resolveDot(plugin, file) {
      const typ = plugin.typIndex.typOf(file);
      if (!typ) return { color: null, hollow: false };
      const { settings } = plugin;
      const typColor = settings.typColors[typ];
      if (!typColor) {
        return settings.typs.includes(typ) ? { color: DEFAULT_DOT_COLOR, hollow: true } : { color: null, hollow: false };
      }
      const subtyp = plugin.typIndex.subtypOf(file);
      if (settings.colorViews.noteTitleMarkerSubtyp && subtyp && getSubtyp2(settings, typ, subtyp)) {
        return { color: subtypColor(settings, typ, subtyp), hollow: !subtypHasOwnColor(settings, typ, subtyp) };
      }
      return { color: typColor, hollow: false };
    }
    function applyStyleToTitle(titleEl, marker) {
      const isDot = marker.kind === "dot" && !!marker.color;
      const isBadge = marker.kind === "title-badge";
      titleEl.classList.toggle(DOT_CLASS, isDot);
      titleEl.classList.toggle(DOT_HOLLOW_CLASS, isDot && !!marker.hollow);
      titleEl.classList.toggle(BADGE_CLASS, isBadge && marker.colored);
      titleEl.classList.toggle(BADGE_PLAIN_CLASS, isBadge && !marker.colored);
      if (isBadge) titleEl.dataset.typ = marker.typName;
      else delete titleEl.dataset.typ;
      const markerColor = isDot && marker.color || isBadge && marker.colored && marker.color ? marker.color : null;
      if (markerColor) titleEl.style.setProperty(COLOR_VAR, markerColor);
      else titleEl.style.removeProperty(COLOR_VAR);
    }
    function applyStyleToBlock(plugin, blockEl, marker) {
      const isBlockBadge = marker.kind === "block-badge";
      blockEl.classList.toggle(BLOCK_BADGE_CLASS, isBlockBadge && marker.colored);
      blockEl.classList.toggle(BLOCK_BADGE_PLAIN_CLASS, isBlockBadge && !marker.colored);
      const align = plugin.settings.noteTitleVerticalAlign;
      blockEl.classList.toggle(BLOCK_ALIGN_TOP_CLASS, isBlockBadge && align !== "bottom");
      blockEl.classList.toggle(BLOCK_ALIGN_BOTTOM_CLASS, isBlockBadge && align === "bottom");
      if (isBlockBadge) blockEl.dataset.typ = marker.typName;
      else delete blockEl.dataset.typ;
      const blockColor = isBlockBadge && marker.colored && marker.color ? marker.color : null;
      if (blockColor) blockEl.style.setProperty(BLOCK_COLOR_VAR, blockColor);
      else blockEl.style.removeProperty(BLOCK_COLOR_VAR);
    }
    function applyActiveTitleColors(plugin) {
      for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
        const containerEl = leaf.view.containerEl;
        const file = leaf.view.file;
        const typedFile = file instanceof TFile ? file : null;
        const marker = resolveMarker(plugin, typedFile);
        const titleEl = containerEl.querySelector(".inline-title");
        if (titleEl) {
          applyStyleToTitle(titleEl, marker);
          const textColor = plugin.settings.colorViews.noteTitleColor ? colorForFile(plugin, typedFile, "noteTitleColor") : null;
          setInlineColor(titleEl, textColor);
        }
        const blockEl = containerEl.querySelector(".metadata-container");
        if (blockEl) applyStyleToBlock(plugin, blockEl, marker);
      }
    }
    function registerActiveTitleColors2(plugin) {
      const refresh = () => applyActiveTitleColors(plugin);
      plugin.registerEvent(plugin.typIndex.on("change", refresh));
      plugin.registerEvent(plugin.app.workspace.on("file-open", refresh));
      plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", refresh));
      plugin.registerEvent(plugin.app.workspace.on("layout-change", refresh));
      plugin.app.workspace.onLayoutReady(refresh);
      plugin.register(() => {
        const none = { kind: "none" };
        for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
          const containerEl = leaf.view.containerEl;
          const titleEl = containerEl.querySelector(".inline-title");
          if (titleEl) applyStyleToTitle(titleEl, none);
          const blockEl = containerEl.querySelector(".metadata-container");
          if (blockEl) applyStyleToBlock(plugin, blockEl, none);
        }
      });
      return refresh;
    }
    module2.exports = { registerActiveTitleColors: registerActiveTitleColors2 };
  }
});

// src/link-colors.js
var require_link_colors = __commonJS({
  "src/link-colors.js"(exports2, module2) {
    var { editorInfoField, getLinkpath } = require("obsidian");
    var { ViewPlugin, Decoration } = require("@codemirror/view");
    var { Prec, RangeSetBuilder, StateEffect } = require("@codemirror/state");
    var { syntaxTree } = require("@codemirror/language");
    var { colorForFile, allDocuments: allDocuments2 } = require_typ_colors();
    var COLOR_VAR = "--link-color";
    var SOURCE_ATTR = "data-typ-src";
    var WIKILINK_PATTERN = /(?<!!)\[\[([^[\]]+?)\]\]/g;
    function colorForLinktext(plugin, linktext, sourcePath) {
      const target = linktext.split(/\\?\|/)[0].trim();
      const linkpath = getLinkpath(target);
      if (!linkpath) return null;
      const file = plugin.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
      return colorForFile(plugin, file, "links");
    }
    function applyToAnchor(plugin, anchorEl) {
      const href = anchorEl.getAttribute("data-href");
      const color = plugin.settings.colorViews.links && href && !anchorEl.classList.contains("is-unresolved") ? colorForLinktext(plugin, href, anchorEl.getAttribute(SOURCE_ATTR) ?? "") : null;
      if (color) anchorEl.style.setProperty(COLOR_VAR, color);
      else anchorEl.style.removeProperty(COLOR_VAR);
    }
    function refreshRenderedLinks(plugin) {
      for (const doc of allDocuments2(plugin.app)) {
        for (const anchorEl of doc.querySelectorAll(`a.internal-link[${SOURCE_ATTR}]`)) applyToAnchor(plugin, anchorEl);
      }
    }
    var refreshEffect = StateEffect.define();
    function buildLinkViewPlugin(plugin) {
      const decorationsByColor = /* @__PURE__ */ new Map();
      const decorationFor = (color) => {
        let decoration = decorationsByColor.get(color);
        if (!decoration) {
          decoration = Decoration.mark({
            class: "typ-link",
            attributes: { style: `${COLOR_VAR}: ${color};` }
          });
          decorationsByColor.set(color, decoration);
        }
        return decoration;
      };
      const build = (view) => {
        if (!plugin.settings.colorViews.links) return Decoration.none;
        const sourcePath = view.state.field(editorInfoField, false)?.file?.path ?? "";
        const tree = syntaxTree(view.state);
        const builder = new RangeSetBuilder();
        for (const { from, to } of view.visibleRanges) {
          const text = view.state.sliceDoc(from, to);
          WIKILINK_PATTERN.lastIndex = 0;
          for (let match; match = WIKILINK_PATTERN.exec(text); ) {
            const start = from + match.index;
            if (!tree.resolveInner(start + 2, 1).name.includes("hmd-internal-link")) continue;
            const color = colorForLinktext(plugin, match[1], sourcePath);
            if (color) builder.add(start, start + match[0].length, decorationFor(color));
          }
        }
        return builder.finish();
      };
      return ViewPlugin.fromClass(
        class {
          constructor(view) {
            this.decorations = build(view);
          }
          // The parser may work through the visible range bit by bit, so a new
          // syntax tree also triggers a rebuild.
          update(update) {
            if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state) || update.transactions.some((tr) => tr.effects.some((effect) => effect.is(refreshEffect)))) {
              this.decorations = build(update.view);
            }
          }
        },
        { decorations: (value) => value.decorations }
      );
    }
    function createEditorRefresher(plugin) {
      let frame = null;
      const run = () => {
        frame = null;
        let busy = false;
        plugin.app.workspace.iterateAllLeaves((leaf) => {
          const cm = leaf.view?.editor?.cm;
          if (!cm) return;
          if (cm.updateState !== 0) {
            busy = true;
            return;
          }
          try {
            cm.dispatch({ effects: refreshEffect.of(null) });
          } catch (error) {
            console.error("[TYP link colors]", error);
          }
        });
        if (busy) schedule();
      };
      const schedule = () => {
        if (frame === null) frame = window.requestAnimationFrame(run);
      };
      plugin.register(() => {
        if (frame !== null) window.cancelAnimationFrame(frame);
        frame = null;
      });
      return schedule;
    }
    function registerLinkColors2(plugin) {
      plugin.registerMarkdownPostProcessor((el, ctx) => {
        for (const anchorEl of el.querySelectorAll("a.internal-link")) {
          anchorEl.setAttribute(SOURCE_ATTR, ctx.sourcePath);
          applyToAnchor(plugin, anchorEl);
        }
      });
      plugin.registerEditorExtension(Prec.lowest(buildLinkViewPlugin(plugin)));
      const refreshEditors = createEditorRefresher(plugin);
      const refresh = () => {
        refreshRenderedLinks(plugin);
        refreshEditors();
      };
      plugin.registerEvent(plugin.typIndex.on("change", refresh));
      plugin.register(() => {
        plugin.app.workspace.iterateAllLeaves((leaf) => {
          for (const anchorEl of leaf.view.containerEl.querySelectorAll(`a.internal-link[${SOURCE_ATTR}]`)) {
            anchorEl.style.removeProperty(COLOR_VAR);
          }
        });
      });
      return refresh;
    }
    module2.exports = { registerLinkColors: registerLinkColors2 };
  }
});

// src/frontmatter-default-highlight.js
var require_frontmatter_default_highlight = __commonJS({
  "src/frontmatter-default-highlight.js"(exports2, module2) {
    var { getSubtypNames: getSubtypNames2, getSubtyp: getSubtyp2 } = require_subtyps();
    var { subtypColor, setInlineColor, allDocuments: allDocuments2 } = require_typ_colors();
    var { VIEW_TYPE_TYP_PANE } = require_typ_pane();
    var ALL_PROPERTIES_VIEW_TYPE = "all-properties";
    var HIGHLIGHT_CLASS = "typ-default-property";
    var FLOATING_CLASS = "typ-floating-property";
    function rawKeysForTyp(typ, defaults) {
      if (!typ || !defaults) return null;
      const keys = Object.keys(defaults).filter((key) => key !== "");
      return keys.length > 0 ? keys.map((key) => key.toLowerCase()) : null;
    }
    var ALL_SUBTYPS = Symbol("all-subtyps");
    function blockOf(defaults, floatingKeys, section = null) {
      const keys = rawKeysForTyp(true, defaults) ?? [];
      return { section, keys, floating: new Set((floatingKeys ?? []).map((key) => key.toLowerCase())) };
    }
    function blocksForTyp(plugin, typ, subtyp) {
      const { settings } = plugin;
      const blocks = [blockOf(settings.typDefaultFrontmatter[typ], settings.typFloatingKeys[typ], null)];
      const subtypNames = subtyp === ALL_SUBTYPS ? getSubtypNames2(settings, typ) : subtyp ? [subtyp] : [];
      for (const name of subtypNames) {
        const data = getSubtyp2(settings, typ, name);
        if (data) blocks.push(blockOf(data.frontmatter, data.floatingKeys, name));
      }
      return blocks;
    }
    function splitKeys(blocks) {
      const isFloating = /* @__PURE__ */ new Map();
      for (const { keys, floating: floating2 } of blocks) {
        for (const key of keys) isFloating.set(key, floating2.has(key));
      }
      const standard = /* @__PURE__ */ new Set();
      const floating = /* @__PURE__ */ new Set();
      for (const [key, flag] of isFloating) (flag ? floating : standard).add(key);
      return { standard: standard.size > 0 ? standard : null, floating: floating.size > 0 ? floating : null };
    }
    var NO_KEYS = { standard: null, floating: null };
    function keysForFile(plugin, file) {
      const { colorViews } = plugin.settings;
      if (!colorViews.frontmatterDefaults) return NO_KEYS;
      const typ = plugin.typIndex.typOf(file);
      if (!typ) return NO_KEYS;
      const subtyp = colorViews.frontmatterDefaultsSubtyp ? plugin.typIndex.subtypOf(file) : null;
      return splitKeys(blocksForTyp(plugin, typ, subtyp));
    }
    function keysForStore(plugin, store) {
      const { colorViews } = plugin.settings;
      if (!colorViews.frontmatterDefaults || !store) return NO_KEYS;
      if (store.subtyp && !colorViews.frontmatterDefaultsSubtyp) return NO_KEYS;
      return splitKeys([blockOf(store.getFrontmatter(), store.getFloating())]);
    }
    function typsUsingKeyMap(plugin) {
      const map = /* @__PURE__ */ new Map();
      const { colorViews } = plugin.settings;
      if (!colorViews.allProperties) return map;
      const typs = /* @__PURE__ */ new Set([
        ...Object.keys(plugin.settings.typDefaultFrontmatter),
        ...colorViews.allPropertiesSubtyp ? Object.keys(plugin.settings.typSubtyps ?? {}) : []
      ]);
      for (const typ of typs) {
        const blocks = blocksForTyp(plugin, typ, colorViews.allPropertiesSubtyp ? ALL_SUBTYPS : null);
        for (const { section, keys, floating } of blocks) {
          for (const key of keys) {
            if (!map.has(key)) map.set(key, { typs: /* @__PURE__ */ new Map(), allFloating: true });
            const entry = map.get(key);
            if (!entry.typs.has(typ)) entry.typs.set(typ, []);
            entry.typs.get(typ).push(section);
            entry.allFloating = entry.allFloating && floating.has(key);
          }
        }
      }
      return map;
    }
    function applyToContainer(containerEl, standardKeys, floatingKeys) {
      if (!containerEl) return;
      const rows = containerEl.querySelectorAll(".metadata-property[data-property-key]");
      for (const row of rows) {
        const keyEl = row.querySelector(".metadata-property-key-input");
        if (!keyEl) continue;
        const propertyKey = row.getAttribute("data-property-key");
        keyEl.classList.toggle(HIGHLIGHT_CLASS, !!standardKeys && standardKeys.has(propertyKey));
        keyEl.classList.toggle(FLOATING_CLASS, !!floatingKeys && floatingKeys.has(propertyKey));
      }
    }
    function applyToAllPropertiesView(plugin) {
      const usageMap = typsUsingKeyMap(plugin);
      for (const leaf of plugin.app.workspace.getLeavesOfType(ALL_PROPERTIES_VIEW_TYPE)) {
        const doms = leaf.view?.doms;
        if (!doms) continue;
        for (const [key, dom] of Object.entries(doms)) {
          const titleEl = dom?.titleEl;
          if (!titleEl) continue;
          const entry = usageMap.get(key.toLowerCase());
          const typs = entry?.typs;
          const count = typs ? typs.size : 0;
          titleEl.classList.toggle(HIGHLIGHT_CLASS, count > 1);
          titleEl.classList.toggle(FLOATING_CLASS, count > 0 && entry.allFloating);
          if (count === 1) {
            const [[onlyTyp, sections]] = typs;
            const color = plugin.settings.colorViews.allPropertiesSubtyp ? subtypColor(plugin.settings, onlyTyp, sections.length === 1 ? sections[0] : null) : plugin.settings.typColors[onlyTyp];
            setInlineColor(titleEl, color, "important");
          } else {
            setInlineColor(titleEl, null);
          }
        }
      }
    }
    function applyFrontmatterDefaultHighlight(plugin) {
      for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
        const view = leaf.view;
        const { standard, floating } = keysForFile(plugin, view?.file);
        applyToContainer(view?.metadataEditor?.containerEl, standard, floating);
      }
      for (const leaf of plugin.app.workspace.getLeavesOfType("file-properties")) {
        const view = leaf.view;
        const file = view?.file ?? plugin.app.workspace.getActiveFile();
        const { standard, floating } = keysForFile(plugin, file);
        applyToContainer(view?.metadataEditor?.containerEl, standard, floating);
      }
      for (const leaf of plugin.app.workspace.getLeavesOfType(VIEW_TYPE_TYP_PANE)) {
        for (const editor of leaf.view?.frontmatterEditors ?? []) {
          const { standard, floating } = keysForStore(plugin, editor.owner?.typStore);
          applyToContainer(editor.containerEl, standard, floating);
        }
      }
      applyToAllPropertiesView(plugin);
    }
    function registerFrontmatterDefaultHighlight2(plugin) {
      const refresh = () => applyFrontmatterDefaultHighlight(plugin);
      plugin.registerEvent(plugin.app.metadataCache.on("changed", refresh));
      plugin.registerEvent(plugin.app.metadataCache.on("resolved", refresh));
      plugin.registerEvent(plugin.app.workspace.on("layout-change", refresh));
      plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", refresh));
      plugin.app.workspace.onLayoutReady(refresh);
      plugin.register(() => {
        for (const doc of allDocuments2(plugin.app)) {
          for (const el of doc.querySelectorAll(`.${HIGHLIGHT_CLASS}, .${FLOATING_CLASS}`)) {
            el.classList.remove(HIGHLIGHT_CLASS, FLOATING_CLASS);
          }
        }
      });
      return refresh;
    }
    module2.exports = { registerFrontmatterDefaultHighlight: registerFrontmatterDefaultHighlight2 };
  }
});

// src/property-rename-sync.js
var require_property_rename_sync = __commonJS({
  "src/property-rename-sync.js"(exports2, module2) {
    var { Notice } = require("obsidian");
    var { typStore, subtypStore } = require_typ_frontmatter_editor();
    var { getSubtypNames: getSubtypNames2, isEmptyValue } = require_subtyps();
    var { plural, joinAnd } = require_typ_utils();
    var { TYP_PROPERTY: TYP_PROPERTY2, SUBTYP_PROPERTY: SUBTYP_PROPERTY2 } = require_typ_index();
    function sameKey(a, b) {
      return a.toLowerCase() === b.toLowerCase();
    }
    function renameInStore(store, oldKey, newKey) {
      const defaults = store.getFrontmatter();
      const keys = Object.keys(defaults);
      const sourceKey = keys.find((key) => sameKey(key, oldKey));
      if (sourceKey === void 0) return false;
      const targetKey = keys.find((key) => key !== sourceKey && sameKey(key, newKey));
      if (targetKey === void 0 && sourceKey === newKey) return false;
      const next = {};
      for (const key of keys) {
        if (key !== sourceKey) {
          next[key] = defaults[key];
        } else if (targetKey === void 0) {
          next[newKey] = defaults[sourceKey];
        }
      }
      if (targetKey !== void 0 && isEmptyValue(next[targetKey])) next[targetKey] = defaults[sourceKey];
      store.setFrontmatter(next);
      const floating = store.getFloating();
      if (floating.length > 0) {
        store.setFloating(
          targetKey !== void 0 ? floating.filter((key) => key !== sourceKey) : floating.map((key) => key === sourceKey ? newKey : key)
        );
      }
      const shortcuts = { ...store.getShortcuts() };
      if (shortcuts[sourceKey]) {
        if (targetKey === void 0) shortcuts[newKey] = shortcuts[sourceKey];
        delete shortcuts[sourceKey];
        store.setShortcuts(shortcuts);
      }
      return true;
    }
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
      if ([oldKey, newKey].some((key) => sameKey(key, TYP_PROPERTY2) || sameKey(key, SUBTYP_PROPERTY2))) return;
      const { settings } = plugin;
      let typCount = 0;
      let subtypCount = 0;
      const count = (store) => store.subtyp ? subtypCount++ : typCount++;
      const typs = /* @__PURE__ */ new Set([...Object.keys(settings.typDefaultFrontmatter), ...Object.keys(settings.typSubtyps ?? {})]);
      for (const typ of typs) {
        const stores = [typStore(plugin, typ), ...getSubtypNames2(settings, typ).map((subtyp) => subtypStore(plugin, typ, subtyp))];
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
      new Notice(`TYP-System: renamed "${oldKey}" \u2192 "${newKey}" in ${joinAnd(parts)}.`);
    }
    function registerPropertyRenameSync2(plugin) {
      const fileManager = plugin.app.fileManager;
      if (fileManager.__typSystemRenameSyncPatched) return;
      fileManager.__typSystemRenameSyncPatched = true;
      const original = fileManager.renameProperty;
      fileManager.renameProperty = async function(oldKey, newKey, ...rest) {
        const result = await original.call(this, oldKey, newKey, ...rest);
        try {
          await syncRename(plugin, oldKey, newKey);
        } catch (error) {
          console.error("TYP-System: property rename not applied", error);
          new Notice(`TYP-System: rename of "${oldKey}" not applied \u2013 ${error.message}`);
        }
        return result;
      };
      plugin.register(() => {
        fileManager.renameProperty = original;
        delete fileManager.__typSystemRenameSyncPatched;
      });
    }
    module2.exports = { registerPropertyRenameSync: registerPropertyRenameSync2 };
  }
});

// src/typ-picker.js
var require_typ_picker = __commonJS({
  "src/typ-picker.js"(exports2, module2) {
    var { FuzzySuggestModal, Notice, prepareFuzzySearch } = require("obsidian");
    var { compareTyps, DEFAULT_SORT_ORDER: DEFAULT_SORT_ORDER2 } = require_typ_pane();
    var { nameColor, paintColorDot } = require_typ_colors();
    var TypPickerModal = class extends FuzzySuggestModal {
      constructor(app, plugin, items, resolve) {
        super(app);
        this.plugin = plugin;
        this.items = items;
        this.resolve = resolve;
        this.chosen = false;
        this.setPlaceholder("ESC to cancel");
      }
      getItems() {
        return this.items;
      }
      // Search also covers the description and, where shown in the row
      // (showSubtyps), the Subtyp names: what you see you expect to be able to type.
      getItemText(item) {
        return [item.typ, item.subtyps?.join(" "), item.description].filter(Boolean).join(" ");
      }
      renderSuggestion(match, el) {
        const item = match.item;
        el.addClass("typ-picker-suggestion");
        if (item.unregistered) el.addClass("typ-picker-unregistered");
        if (item.unregistered) {
          el.createSpan({ cls: "typ-picker-name", text: item.typ });
        } else {
          this.renderColoredName(el, item.typ, item.typ);
        }
        if (item.subtyps?.length) this.renderSubtypPreview(el, item);
        if (item.description) {
          el.createSpan({ cls: "typ-picker-desc", text: item.description });
        }
        el.createSpan({ cls: "typ-picker-count", text: String(item.count) });
      }
      // Name in the color of colorTyp (or of the Subtyp, see nameColor in
      // typ-colors.js) - as colored text or with a dot before it, depending on
      // the "TYP-Pane" coloring setting.
      renderColoredName(el, text, colorTyp, subtyp = null) {
        const { color, isDefault } = nameColor(this.plugin.settings, colorTyp, subtyp);
        if (this.plugin.settings.colorViews.typList) {
          el.createSpan({ cls: "typ-picker-name", text }).style.color = color;
        } else {
          paintColorDot(el.createSpan({ cls: "typ-picker-dot" }), color, isDefault);
          el.createSpan({ cls: "typ-picker-name", text });
        }
      }
      // "TYP (Subtyp 1, Subtyp 2)" - shows what lies below the TYP before the
      // separate Subtyp-Picker comes. Each Subtyp in its own color, brackets and
      // commas muted; uncolored like the name when "TYP-Pane" coloring is off.
      renderSubtypPreview(el, item) {
        const colorize = this.plugin.settings.colorViews.typList;
        const wrap = el.createSpan({ cls: "typ-picker-subtyps" });
        wrap.appendText("(");
        item.subtyps.forEach((subtyp, index) => {
          if (index > 0) wrap.appendText(", ");
          const span = wrap.createSpan({ text: subtyp });
          if (colorize) span.style.color = nameColor(this.plugin.settings, item.typ, subtyp).color;
        });
        wrap.appendText(")");
      }
      // Obsidian's selectSuggestion() calls close() BEFORE onChooseItem(). Set
      // "chosen" any later and onClose() resolves with null first - a promise only
      // resolves once, so every choice would come back as null.
      selectSuggestion(item, evt) {
        this.chosen = true;
        this.query = this.inputEl.value.trim();
        super.selectSuggestion(item, evt);
      }
      onChooseItem(item) {
        this.resolve(item.typ);
      }
      // ESC or a click outside closes without selectSuggestion: resolve with null
      // instead of leaving the promise hanging, like tp.system.suggester.
      onClose() {
        super.onClose();
        if (!this.chosen) this.resolve(null);
      }
    };
    var SubtypPickerModal = class extends TypPickerModal {
      constructor(app, plugin, typ, items, resolve, query = "") {
        super(app, plugin, items, resolve);
        this.typ = typ;
        this.setPlaceholder(`Subtyp for ${typ} \u2013 ESC to go back`);
        this.items = sortByQuery(items, query, (item) => this.getItemText(item));
      }
      // The "no Subtyp" row is also found by the TYP name it shows, so "ORGA"
      // typed in the TYP-Picker brings it back to the top.
      getItemText(item) {
        return item.none ? `${this.typ} ${item.typ}` : super.getItemText(item);
      }
      renderSuggestion(match, el) {
        const item = match.item;
        el.addClass("typ-picker-suggestion");
        if (item.none) {
          this.renderColoredName(el, this.typ, this.typ);
          el.createSpan({ cls: "typ-picker-none", text: `(${item.typ})` });
        } else {
          this.renderColoredName(el, item.typ, this.typ, item.typ);
        }
        el.createSpan({ cls: "typ-picker-count", text: String(item.count) });
      }
      onChooseItem(item) {
        this.resolve(item.none ? "" : item.typ);
      }
    };
    var TypSubtypPickerModal = class extends TypPickerModal {
      constructor(app, plugin, groups, resolve) {
        super(app, plugin, groups.map((group) => group.item), resolve);
        this.groups = groups;
      }
      getSuggestions(query) {
        const search = query.trim() ? prepareFuzzySearch(query.trim()) : null;
        const noMatch = { score: 0, matches: [] };
        const results = [];
        for (const { item, subtyps } of this.groups) {
          const typMatch = search ? search(this.getItemText(item)) : noMatch;
          let subtypMatches = subtyps.map((subtyp) => ({ item: subtyp, match: search ? search(subtyp.subtyp) : noMatch }));
          if (!typMatch) subtypMatches = subtypMatches.filter((entry) => entry.match);
          if (!typMatch && subtypMatches.length === 0) continue;
          const scores = [typMatch, ...subtypMatches.map((entry) => entry.match)].filter(Boolean).map((match) => match.score);
          results.push({
            score: Math.max(...scores),
            rows: [{ item, match: typMatch ?? noMatch }, ...subtypMatches.map((entry) => ({ item: entry.item, match: entry.match ?? noMatch }))]
          });
        }
        if (search) results.sort((a, b) => b.score - a.score);
        return results.flatMap((group) => group.rows);
      }
      renderSuggestion(match, el) {
        const item = match.item;
        if (!item.subtyp) {
          super.renderSuggestion(match, el);
          return;
        }
        el.addClass("typ-picker-suggestion", "typ-picker-subtyp");
        this.renderColoredName(el, item.subtyp, item.typ, item.subtyp);
        el.createSpan({ cls: "typ-picker-count", text: String(item.count) });
      }
      onChooseItem(item) {
        this.resolve({ typ: item.typ, subtyp: item.subtyp ?? null });
      }
    };
    function sortByQuery(items, query, itemText) {
      const search = query?.trim() ? prepareFuzzySearch(query.trim()) : null;
      if (!search) return items;
      const scored = items.map((item, index) => ({ item, index, score: search(itemText(item))?.score ?? null }));
      if (scored.every((entry) => entry.score === null)) return items;
      scored.sort((a, b) => {
        if (a.score === null || b.score === null) return a.score === b.score ? a.index - b.index : a.score === null ? 1 : -1;
        return b.score - a.score || a.index - b.index;
      });
      return scored.map((entry) => entry.item);
    }
    function pickSubtyp(app, plugin, typ, query = "", options = {}) {
      return new Promise((resolve) => {
        const items = plugin.getSubtyps(typ, options).map(({ subtyp, count }) => ({ typ: subtyp, description: "", count }));
        if (items.length === 0) {
          resolve("");
          return;
        }
        const noneCount = plugin.typIndex.subtypBucket(typ).noSubtyp;
        items.unshift({ typ: "no Subtyp", description: "", count: noneCount, none: true });
        new SubtypPickerModal(app, plugin, typ, items, resolve, query).open();
      });
    }
    function unregisteredItems(app, plugin) {
      const registered = new Set(plugin.settings.typs);
      const { counts } = plugin.typIndex.typCounts();
      const sortOrder = plugin.settings.typSortOrder ?? DEFAULT_SORT_ORDER2;
      return [...counts.keys()].filter((typ) => !registered.has(typ) && plugin.typIndex.isCleanKey(typ)).sort((a, b) => compareTyps(sortOrder, a, b, counts, plugin.settings.typColors)).map((typ) => ({ typ, description: "", count: counts.get(typ) ?? 0, unregistered: true }));
    }
    function pickTyp(app, plugin, options = {}) {
      return pickTypEntry(app, plugin, options).then((entry) => entry?.typ ?? null);
    }
    function pickTypEntry(app, plugin, options = {}) {
      return new Promise((resolve) => {
        const items = typItems(app, plugin, options);
        if (!items) {
          resolve(null);
          return;
        }
        const modal = new TypPickerModal(app, plugin, items, (typ) => resolve(typ === null ? null : { typ, query: modal.query }));
        modal.open();
      });
    }
    function typItems(app, plugin, { includeManualOff = false, includeUnregistered = false, showSubtyps = false } = {}) {
      const items = plugin.getTyps({ includeManualOff }).map((item) => ({ ...item, unregistered: false }));
      if (includeUnregistered) items.push(...unregisteredItems(app, plugin));
      if (showSubtyps) {
        for (const item of items) item.subtyps = plugin.getSubtyps(item.typ, { includeManualOff }).map(({ subtyp }) => subtyp);
      }
      if (items.length > 0) return items;
      new Notice("No TYP available.");
      return null;
    }
    async function pickTypAndSubtyp(app, plugin, options = {}) {
      if (plugin.settings.separateSubtypPicker) {
        while (true) {
          const entry = await pickTypEntry(app, plugin, { ...options, showSubtyps: true });
          if (!entry) return null;
          const subtyp = await pickSubtyp(app, plugin, entry.typ, entry.query, options);
          if (subtyp !== null) return { typ: entry.typ, subtyp: subtyp || null };
        }
      }
      const items = typItems(app, plugin, options);
      if (!items) return null;
      const groups = items.map((item) => ({
        item,
        subtyps: plugin.getSubtyps(item.typ, options).map(({ subtyp, count }) => ({ typ: item.typ, subtyp, count }))
      }));
      return new Promise((resolve) => new TypSubtypPickerModal(app, plugin, groups, resolve).open());
    }
    module2.exports = { pickTyp, pickSubtyp, pickTypAndSubtyp };
  }
});

// src/shortcut-scripts.js
var require_shortcut_scripts = __commonJS({
  "src/shortcut-scripts.js"(exports2, module2) {
    var { TFile, Vault, debounce, normalizePath } = require("obsidian");
    var SHORTCUT_MARKER = /^[ \t]*(?:\/\/+|\/\*+|\*)[ \t]*@typ-shortcut\b(?:\(([^)]*)\))?[ \t]*(.*?)[ \t]*(?:\*\/)?[ \t]*$/m;
    function parseParams(raw) {
      const names = (raw ?? "").split(",").map((name) => name.trim()).filter((name) => name !== "");
      return [...new Set(names)];
    }
    function registerShortcutScripts2(plugin) {
      const { app } = plugin;
      let scriptFolder = null;
      let scripts = [];
      const currentScriptFolder = () => {
        const folder = app.plugins.plugins["templater-obsidian"]?.settings?.user_scripts_folder;
        return folder ? normalizePath(folder) : null;
      };
      const isInScriptFolder = (path) => !!scriptFolder && !!path && path.startsWith(scriptFolder + "/");
      async function refreshScripts() {
        const folderPath = currentScriptFolder();
        scriptFolder = folderPath;
        const folder = folderPath ? app.vault.getFolderByPath(folderPath) : null;
        const files = [];
        if (folder) {
          Vault.recurseChildren(folder, (child) => {
            if (child instanceof TFile && child.extension === "js") files.push(child);
          });
        }
        const found = [];
        for (const file of files) {
          try {
            const match = (await app.vault.cachedRead(file)).match(SHORTCUT_MARKER);
            if (match) {
              found.push({
                name: file.basename,
                params: match[1] === void 0 ? null : parseParams(match[1]),
                description: match[2] ?? ""
              });
            }
          } catch (e) {
            console.error(`TYP-System: can't read Templater script ${file.path}`, e);
          }
        }
        if (folderPath !== scriptFolder) return;
        scripts = found.sort((a, b) => a.name.localeCompare(b.name));
      }
      const scheduleRefresh = debounce(refreshScripts, 300, true);
      const onFileChange = (file, oldPath) => {
        if (isInScriptFolder(file?.path) || isInScriptFolder(oldPath)) scheduleRefresh();
      };
      plugin.registerEvent(app.vault.on("create", onFileChange));
      plugin.registerEvent(app.vault.on("modify", onFileChange));
      plugin.registerEvent(app.vault.on("delete", onFileChange));
      plugin.registerEvent(app.vault.on("rename", onFileChange));
      app.workspace.onLayoutReady(refreshScripts);
      return () => {
        if (currentScriptFolder() !== scriptFolder) scheduleRefresh();
        return scripts;
      };
    }
    module2.exports = { registerShortcutScripts: registerShortcutScripts2, SHORTCUT_MARKER, parseParams };
  }
});

// src/main.js
var { Plugin } = require("obsidian");
var { DEFAULT_SETTINGS, TypSystemSettingTab } = require_settings();
var { registerCommands } = require_commands();
var { registerTypPane, sortTypsByMode, DEFAULT_SORT_ORDER } = require_typ_pane();
var { TypIndex, setCanonicalProperty, deleteProperty, TYP_PROPERTY, SUBTYP_PROPERTY } = require_typ_index();
var { getSubtyp, getSubtypNames, isSubtypManual } = require_subtyps();
var { registerFileExplorerColors } = require_file_explorer_colors();
var { registerGraphColors } = require_graph_colors();
var { registerSearchColors } = require_search_colors();
var { registerRecentFilesColors } = require_recent_files_colors();
var { registerBacklinkColors } = require_backlink_colors();
var { registerBookmarksColors } = require_bookmark_colors();
var { registerActiveTitleColors } = require_active_title_colors();
var { registerLinkColors } = require_link_colors();
var { registerFrontmatterDefaultHighlight } = require_frontmatter_default_highlight();
var { registerPropertyRenameSync } = require_property_rename_sync();
var { removePropertyMenuPatch } = require_typ_frontmatter_editor();
var { normalizeGlobalOrder, sortFrontmatterFor, placePropertyFor } = require_frontmatter_sort();
var { resolveShortcuts, scriptNameOf, resolveCallArgs } = require_shortcuts();
var {
  pickTyp: pickTypModal,
  pickSubtyp: pickSubtypModal,
  pickTypAndSubtyp: pickTypAndSubtypModal
} = require_typ_picker();
var { registerShortcutScripts } = require_shortcut_scripts();
var { clearInlineColors, allDocuments } = require_typ_colors();
module.exports = class TypSystemPlugin extends Plugin {
  async onload() {
    const data = await this.loadData();
    this.isFirstRun = data == null;
    await this.loadSettings(data);
    this.register(() => {
      for (const doc of allDocuments(this.app)) clearInlineColors(doc);
    });
    this.typIndex = new TypIndex(this);
    this.typIndex.register();
    registerCommands(this);
    this.addSettingTab(new TypSystemSettingTab(this.app, this));
    registerPropertyRenameSync(this);
    this.register(removePropertyMenuPatch);
    this.getShortcutScripts = registerShortcutScripts(this);
    this.refreshFrontmatterHighlight = registerFrontmatterDefaultHighlight(this);
    const refreshTypPane = registerTypPane(this);
    const refreshFns = [
      registerFileExplorerColors(this),
      registerGraphColors(this),
      registerSearchColors(this),
      registerRecentFilesColors(this),
      registerBacklinkColors(this),
      registerBookmarksColors(this),
      registerActiveTitleColors(this),
      registerLinkColors(this),
      this.refreshFrontmatterHighlight
    ];
    this.refreshTypColorsExcept = (exceptView) => {
      refreshTypPane(exceptView);
      refreshFns.forEach((fn) => fn());
    };
    this.refreshTypColors = () => this.refreshTypColorsExcept(null);
    const parseStyleSettings = window.setTimeout(() => this.app.workspace.trigger("parse-style-settings"), 0);
    this.register(() => window.clearTimeout(parseStyleSettings));
  }
  onunload() {
  }
  // For _obsidian/templater-scripts/TYP.js: the TYP-Frontmatter of a TYP, so
  // Templater can apply it to a new note instead of keeping a second copy. A
  // copy, so callers may change it freely.
  //
  // Properties with a fixed shortcut (today/now/created, see shortcuts.js)
  // carry its value, computed fresh on each call. Properties with a script
  // shortcut carry null: only Templater can resolve them, TYP.js gets them via
  // getTypShortcuts() and fills them in. Key and position stay either way.
  //
  // includeFloating (default false) keeps floating keys in the result; they
  // are not created for every new note, only when a script asks for them.
  //
  // file (optional) goes to resolveShortcuts() for "created", which returns
  // the file's creation date instead of the call time.
  //
  // subtyp (optional) appends that Subtyp's block. A key in BOTH blocks keeps
  // the TYP-Frontmatter position, but value, floating flag and shortcut come
  // from the Subtyp. Frontmatter sorting must use the same rule (see
  // orderedDefaultKeys in frontmatter-sort.js), or it would re-sort a new note
  // right away.
  getTypDefaults(typ, { includeFloating = false, file, subtyp = null } = {}) {
    const { defaults, shortcuts } = this.collectBlocks(typ, subtyp, includeFloating);
    return resolveShortcuts(defaults, shortcuts, { file, app: this.app });
  }
  // Shared base of getTypDefaults() and getTypShortcuts(): the TYP-Frontmatter
  // plus the Subtyp's block. A key in BOTH keeps the TYP-Frontmatter position;
  // value, floating flag AND shortcut come from the Subtyp - "no shortcut"
  // counts as the Subtyp's choice too and cancels the TYP's.
  collectBlocks(typ, subtyp, includeFloating) {
    const defaults = {};
    const shortcuts = {};
    const isFloating = /* @__PURE__ */ new Map();
    const addBlock = (frontmatter, floatingKeys, blockShortcuts) => {
      const actualKeys = new Map(Object.keys(defaults).map((key) => [key.toLowerCase(), key]));
      for (const [key, value] of Object.entries(frontmatter ?? {})) {
        if (key === "") continue;
        const target = actualKeys.get(key.toLowerCase()) ?? key;
        defaults[target] = value;
        isFloating.set(target, (floatingKeys ?? []).includes(key));
        const record = (blockShortcuts ?? {})[key];
        if (record) shortcuts[target] = record;
        else delete shortcuts[target];
      }
    };
    const subtypData = subtyp ? getSubtyp(this.settings, typ, subtyp) : null;
    addBlock(
      this.settings.typDefaultFrontmatter[typ],
      this.settings.typFloatingKeys[typ],
      this.settings.typShortcuts[typ]
    );
    if (subtypData) addBlock(subtypData.frontmatter, subtypData.floatingKeys, subtypData.shortcuts);
    if (!includeFloating) {
      for (const [key, floating] of isFloating) {
        if (!floating) continue;
        delete defaults[key];
        delete shortcuts[key];
      }
    }
    return { defaults, shortcuts };
  }
  // For TYP.js: the properties of this TYP whose value comes from a Templater
  // script, as { [property]: { name, params, args, fallback } } in
  // TYP-Frontmatter order (the scripts run in turn and see earlier results).
  //
  //   name      script name without "tp.", i.e. tp.user.<name>
  //   params    the parameter list declared in the @typ-shortcut marker, or
  //             null without parentheses. Taken from the current scan, so a
  //             changed declaration applies at once. TYP.js turns it into the
  //             call's arguments with resolveShortcutArgs()
  //   args      the typed arguments, named after the non-reserved parameters;
  //             an empty field is missing so "args.x ?? fallback" works
  //   fallback  the fixed value stored for the property. Only a FALLBACK:
  //             TYP.js writes it if the script is missing or throws. A script
  //             that deliberately returns null/"" (ESC in a picker) has not
  //             failed - the property stays empty then.
  //
  // Fixed shortcuts (today/now/created) don't appear here; getTypDefaults()
  // already resolves them and returns the script keys as null.
  //
  // Options as in getTypDefaults(); includeFloating defaults to false so no
  // script runs unasked for a floating property.
  getTypShortcuts(typ, { includeFloating = false, subtyp = null } = {}) {
    const { defaults, shortcuts } = this.collectBlocks(typ, subtyp, includeFloating);
    const scripts = this.getShortcutScripts?.() ?? [];
    const result = {};
    for (const [key, record] of Object.entries(shortcuts)) {
      const name = scriptNameOf(record.name);
      if (name === null) continue;
      const script = scripts.find((s) => s.name === name);
      result[key] = {
        name,
        params: script?.params ?? null,
        args: { ...record.args ?? {} },
        fallback: defaults[key] ?? null
      };
    }
    return result;
  }
  // For TYP.js: turns a shortcut's parameter list into the arguments of
  // tp.user.<name>(tp, ...) - see resolveCallArgs in shortcuts.js. Lives here
  // so the rules (reserved names, dotted names) exist in one place; only
  // TYP.js knows newFile and ctx, so it passes them in.
  resolveShortcutArgs(params, args, { newFile = null, ctx = null, key = null } = {}) {
    return resolveCallArgs(params, args, { newFile, ctx, key });
  }
  // For TYP.js: registered Subtyps of a TYP in block order, with note counts.
  // Subtyps that aren't manually creatable are left out unless
  // includeManualOff is set, like such TYP entries in getTyps().
  getSubtyps(typ, { includeManualOff = false } = {}) {
    const { counts } = this.typIndex.subtypBucket(typ);
    return getSubtypNames(this.settings, typ).filter((subtyp) => includeManualOff || isSubtypManual(this.settings, typ, subtyp)).map((subtyp) => ({ subtyp, count: counts.get(subtyp) ?? 0 }));
  }
  // For TYP.js: the Subtyp-Picker (see typ-picker.js). Resolves with the
  // Subtyp, "" for "no Subtyp" (or without a picker if the TYP has none), or
  // null on ESC (TYP.js then goes back to the TYP choice). query (optional):
  // an already typed search that pre-sorts the list. options as in getSubtyps.
  pickSubtyp(typ, query = "", options = {}) {
    return pickSubtypModal(this.app, this, typ, query, options);
  }
  // For TYP.js, inside processFrontMatter: sets TYP and SUBTYP in canonical
  // spelling - a variant like "typ" or "Subtyp" is renamed in place rather than
  // duplicated. subtyp null removes an existing SUBTYP.
  applyTypProperties(frontmatter, typ, subtyp) {
    setCanonicalProperty(frontmatter, TYP_PROPERTY, typ);
    if (subtyp) setCanonicalProperty(frontmatter, SUBTYP_PROPERTY, subtyp);
    else deleteProperty(frontmatter, SUBTYP_PROPERTY);
  }
  // For TYP.js, inside processFrontMatter and after all other changes: puts the
  // frontmatter into sorting order, or newly added properties (SUBTYP in an
  // existing note, say) would end up last.
  sortFrontmatter(frontmatter, typ, subtyp = null) {
    return sortFrontmatterFor(this, frontmatter, typ, subtyp);
  }
  // Inside processFrontMatter: moves only property `key` to its sorted place
  // (TYP/SUBTYP read from the object), everything else stays - for Fred's
  // property backlinking, so a new property doesn't end up last.
  placeProperty(frontmatter, key) {
    return placePropertyFor(this, frontmatter, key);
  }
  // For TYP.js: the registered TYP entries with their descriptions, in the
  // order of the TYP-List (its current sort setting). TYP entries that aren't
  // manually creatable are left out unless includeManualOff is true.
  getTyps({ includeManualOff = false } = {}) {
    const { counts } = this.typIndex.typCounts();
    const sortOrder = this.settings.typSortOrder ?? DEFAULT_SORT_ORDER;
    return sortTypsByMode(this.settings.typs, sortOrder, counts, this.settings.typColors).filter((typ) => includeManualOff || (this.settings.typManual ?? {})[typ] !== false).map((typ) => ({
      typ,
      description: this.settings.typDescriptions[typ] ?? "",
      count: counts.get(typ) ?? 0
    }));
  }
  // For TYP.js: the native TYP-Picker (see typ-picker.js) with color,
  // description and note count. includeManualOff as in getTyps(). Resolves
  // with the TYP, or null on ESC.
  pickTyp(options) {
    return pickTypModal(this.app, this, options);
  }
  // For TYP.js: TYP and Subtyp in one go (see typ-picker.js) - one picker with
  // indented Subtyps or both pickers in turn, per "Separate Subtyp-Picker".
  // Resolves with { typ, subtyp } (subtyp null for "no Subtyp"), or null on
  // ESC.
  pickTypAndSubtyp(options) {
    return pickTypAndSubtypModal(this.app, this, options);
  }
  // data: what loadData() returned, if the caller already has it (onload);
  // without it (onExternalSettingsChange) data.json is read here.
  async loadSettings(data) {
    if (data === void 0) data = await this.loadData();
    this.settings = Object.assign(structuredClone(DEFAULT_SETTINGS), data);
    this.settings.colorViews = { ...DEFAULT_SETTINGS.colorViews, ...this.settings.colorViews };
    this.settings.globalPropertyOrder = normalizeGlobalOrder(this.settings.globalPropertyOrder);
  }
  // settingsRevision counts every change of the settings (here and in
  // onExternalSettingsChange). Undo (undo.js) compares it to tell whether
  // anything happened after the action it would revert. Bumped synchronously,
  // before the await, so a caller that doesn't await still counts at once.
  async saveSettings() {
    this.settingsRevision = (this.settingsRevision ?? 0) + 1;
    await this.saveData(this.settings);
  }
  // Called when data.json changes from outside, in practice through Obsidian
  // Sync. Without it this device would keep its old settings in memory and
  // overwrite the new ones on the next save. Obsidian rebuilds an open
  // settings tab itself; colors and the TYP-Pane are refreshed here.
  async onExternalSettingsChange() {
    this.settingsRevision = (this.settingsRevision ?? 0) + 1;
    await this.loadSettings();
    this.refreshTypColors();
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL3R5cC1pbmRleC5qcyIsICJzcmMvc3VidHlwcy5qcyIsICJzcmMvdHlwLXV0aWxzLmpzIiwgInNyYy9mcm9udG1hdHRlci1zb3J0LmpzIiwgInNyYy9mcm9udG1hdHRlci1vcmRlci1lZGl0b3IuanMiLCAic3JjL3R5cC1jb2xvcnMuanMiLCAic3JjL3NldHRpbmdzLmpzIiwgInNyYy9iYXNlLWRpYWxvZ3MuanMiLCAic3JjL2Jhc2VzLmpzIiwgInNyYy9jb21tYW5kcy5qcyIsICJzcmMvY29uZmlybS1tb2RhbC5qcyIsICJzcmMvdW5kby5qcyIsICJzcmMvc2hvcnRjdXRzLmpzIiwgInNyYy9zaG9ydGN1dC1waWNrZXIuanMiLCAic3JjL3R5cC1mcm9udG1hdHRlci1lZGl0b3IuanMiLCAic3JjL2Zyb250bWF0dGVyLWJsb2Nrcy5qcyIsICJzcmMvdHlwLXNldHRpbmdzLmpzIiwgInNyYy90eXAtcGFuZS5qcyIsICJzcmMvZmlsZS1leHBsb3Jlci1jb2xvcnMuanMiLCAic3JjL2dyYXBoLWNvbG9ycy5qcyIsICJzcmMvc2VhcmNoLWNvbG9ycy5qcyIsICJzcmMvcmVjZW50LWZpbGVzLWNvbG9ycy5qcyIsICJzcmMvYmFja2xpbmstY29sb3JzLmpzIiwgInNyYy9ib29rbWFyay1jb2xvcnMuanMiLCAic3JjL2FjdGl2ZS10aXRsZS1jb2xvcnMuanMiLCAic3JjL2xpbmstY29sb3JzLmpzIiwgInNyYy9mcm9udG1hdHRlci1kZWZhdWx0LWhpZ2hsaWdodC5qcyIsICJzcmMvcHJvcGVydHktcmVuYW1lLXN5bmMuanMiLCAic3JjL3R5cC1waWNrZXIuanMiLCAic3JjL3Nob3J0Y3V0LXNjcmlwdHMuanMiLCAic3JjL21haW4uanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IHsgRXZlbnRzLCBURmlsZSwgZGVib3VuY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcblxuY29uc3QgVFlQX1BST1BFUlRZID0gXCJUWVBcIjtcbmNvbnN0IFNVQlRZUF9QUk9QRVJUWSA9IFwiU1VCVFlQXCI7XG5jb25zdCBFTVBUWV9FTlRSWSA9IE9iamVjdC5mcmVlemUoeyB0eXBLZXk6IG51bGwsIHJhd1R5cDogbnVsbCwgc3VidHlwS2V5OiBudWxsLCByYXdTdWJ0eXA6IG51bGwgfSk7XG5cbi8vIENvbGxlY3RzIGNoYW5nZXMgdG8gbWFueSBmaWxlcyAocmVuYW1pbmcgYSBUWVAgaW4gbWFueSBub3Rlcywgc3luYykgaW50byBvbmVcbi8vIFwiY2hhbmdlXCIgZXZlbnQuIE5vIHJlc2V0VGltZXIsIHNvIGEgY29uc3RhbnQgc3RyZWFtIHN0aWxsIGdldHMgdGhyb3VnaFxuLy8gcmVndWxhcmx5LlxuY29uc3QgRkxVU0hfREVMQVlfTVMgPSAxMDA7XG5cbmZ1bmN0aW9uIHJhd0l0ZW0odmFsdWUpIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBcIlwiO1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiID8gSlNPTi5zdHJpbmdpZnkodmFsdWUpIDogU3RyaW5nKHZhbHVlKTtcbn1cblxuLy8gSG93IHRoZSB3aG9sZSBwbHVnaW4gcmVhZHMgYSBUWVAgdmFsdWU6IGRlbGliZXJhdGVseSBOT1Qgbm9ybWFsaXplZCAtIHRoZVxuLy8gcmF3IGZvcm0gaXMgdGhlIGtleS4gQSBUWVAgaXMgZXhhY3RseSBvbmUgY2xlYW4gdmFsdWU7IGFueXRoaW5nIGVsc2UgKHBhZGRlZCxcbi8vIGxvd2VyY2FzZSwgYSBsaXN0IC0gZXZlbiB3aXRoIG9uZSBpdGVtKSBiZWNvbWVzIGl0cyBvd24ga2V5IHRoYXQgbWF0Y2hlcyBub1xuLy8gcmVnaXN0ZXJlZCBUWVA6IG5vIGNvbG9yLCBub3QgY291bnRlZCBmb3IgdGhlIFwicmVhbFwiIFRZUCwgYW5kIGxpc3RlZCBpbiB0aGVcbi8vIFRZUC1QYW5lIGFzIGFuIHVucmVnaXN0ZXJlZCBlbnRyeSB0aGF0IGEgY2xpY2sgY2xlYW5zIHVwIChzZWUgcmVnaXN0ZXJUeXAgaW5cbi8vIHR5cC1wYW5lLmpzKS4gTGlzdHMgc2hvdyBhcyBcIltBLCBCXVwiIGFuZCBuZXZlciBjb2luY2lkZSB3aXRoIGEgdmFsdWUgXCJBLCBCXCIuXG4vLyBudWxsID0gbm8gVFlQIChtaXNzaW5nLCBlbXB0eSwgYmxhbmssIGVtcHR5IGxpc3QpLlxuZnVuY3Rpb24gdHlwS2V5T2YodmFsdWUpIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgY29uc3QgaXRlbXMgPSB2YWx1ZS5tYXAocmF3SXRlbSk7XG4gICAgaWYgKGl0ZW1zLmV2ZXJ5KChpdGVtKSA9PiBpdGVtLnRyaW0oKSA9PT0gXCJcIikpIHJldHVybiBudWxsO1xuICAgIHJldHVybiBgWyR7aXRlbXMuam9pbihcIiwgXCIpfV1gO1xuICB9XG4gIGNvbnN0IHRleHQgPSByYXdJdGVtKHZhbHVlKTtcbiAgcmV0dXJuIHRleHQudHJpbSgpID09PSBcIlwiID8gbnVsbCA6IHRleHQ7XG59XG5cbi8vIE9ic2lkaWFuIHRyZWF0cyBwcm9wZXJ0eSBuYW1lcyBjYXNlLWluc2Vuc2l0aXZlbHkgKFwiU3VidHlwXCIgYW5kIFwiU1VCVFlQXCJcbi8vIGFyZSBvbmUgcHJvcGVydHkgaW4gXCJBbGwgcHJvcGVydGllc1wiKSwgc28gVFlQIGFuZCBTVUJUWVAgYXJlIHJlYWQgdGhlIHNhbWVcbi8vIHdheS4gVGhlIGV4YWN0IHNwZWxsaW5nIHdpbnMgaWYgYSBub3RlICh3cm9uZ2x5KSBoYXMgc2V2ZXJhbC5cbmZ1bmN0aW9uIHByb3BlcnR5S2V5T2YoZnJvbnRtYXR0ZXIsIG5hbWUpIHtcbiAgaWYgKCFmcm9udG1hdHRlcikgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChmcm9udG1hdHRlciwgbmFtZSkpIHJldHVybiBuYW1lO1xuICBjb25zdCBsb3dlciA9IG5hbWUudG9Mb3dlckNhc2UoKTtcbiAgcmV0dXJuIE9iamVjdC5rZXlzKGZyb250bWF0dGVyKS5maW5kKChrZXkpID0+IGtleS50b0xvd2VyQ2FzZSgpID09PSBsb3dlcik7XG59XG5cbmZ1bmN0aW9uIHByb3BlcnR5VmFsdWUoZnJvbnRtYXR0ZXIsIG5hbWUpIHtcbiAgY29uc3Qga2V5ID0gcHJvcGVydHlLZXlPZihmcm9udG1hdHRlciwgbmFtZSk7XG4gIHJldHVybiBrZXkgPT09IHVuZGVmaW5lZCA/IHVuZGVmaW5lZCA6IGZyb250bWF0dGVyW2tleV07XG59XG5cbi8vIFdyaXRlcyB2YWx1ZSB1bmRlciB0aGUgY2Fub25pY2FsIHNwZWxsaW5nIGBuYW1lYCAoZS5nLiBcIlNVQlRZUFwiKSBpbnRvIHRoZVxuLy8gcHJvY2Vzc0Zyb250TWF0dGVyIG9iamVjdC4gQSBkaWZmZXJlbnRseSBzcGVsbGVkIHZhcmlhbnQgKFwiU3VidHlwXCIpIGlzXG4vLyByZW5hbWVkIGluIHBsYWNlIC0gaW5zZXJ0aW9uIG9yZGVyIGlzIFlBTUwgb3JkZXIsIHNvIGFsbCBrZXlzIGFyZSByZS1hZGRlZFxuLy8gaW4gdGhlaXIgb3JkZXIgaWYgbmVlZGVkIChhcyBpbiBmcm9udG1hdHRlci1zb3J0LmpzKS5cbmZ1bmN0aW9uIHNldENhbm9uaWNhbFByb3BlcnR5KGZyb250bWF0dGVyLCBuYW1lLCB2YWx1ZSkge1xuICBjb25zdCBsb3dlciA9IG5hbWUudG9Mb3dlckNhc2UoKTtcbiAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKGZyb250bWF0dGVyKTtcbiAgaWYgKCFrZXlzLnNvbWUoKGtleSkgPT4ga2V5ICE9PSBuYW1lICYmIGtleS50b0xvd2VyQ2FzZSgpID09PSBsb3dlcikpIHtcbiAgICBmcm9udG1hdHRlcltuYW1lXSA9IHZhbHVlO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBzbmFwc2hvdCA9IHsgLi4uZnJvbnRtYXR0ZXIgfTtcbiAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykgZGVsZXRlIGZyb250bWF0dGVyW2tleV07XG4gIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICBpZiAoa2V5LnRvTG93ZXJDYXNlKCkgIT09IGxvd2VyKSBmcm9udG1hdHRlcltrZXldID0gc25hcHNob3Rba2V5XTtcbiAgICBlbHNlIGlmICghKG5hbWUgaW4gZnJvbnRtYXR0ZXIpKSBmcm9udG1hdHRlcltuYW1lXSA9IHZhbHVlO1xuICB9XG59XG5cbi8vIFJlbW92ZXMgYG5hbWVgIGluIGFueSBzcGVsbGluZyBmcm9tIHRoZSBwcm9jZXNzRnJvbnRNYXR0ZXIgb2JqZWN0LlxuZnVuY3Rpb24gZGVsZXRlUHJvcGVydHkoZnJvbnRtYXR0ZXIsIG5hbWUpIHtcbiAgY29uc3QgbG93ZXIgPSBuYW1lLnRvTG93ZXJDYXNlKCk7XG4gIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGZyb250bWF0dGVyKSkge1xuICAgIGlmIChrZXkudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXIpIGRlbGV0ZSBmcm9udG1hdHRlcltrZXldO1xuICB9XG59XG5cbi8vIFNVQlRZUCBpcyByZWFkIHRoZSBzYW1lIHdheSAodHlwS2V5T2YpOiBhdCBtb3N0IG9uZSBjbGVhbiB2YWx1ZSBwZXIgbm90ZSxcbi8vIGFueXRoaW5nIGVsc2UgaXMgaXRzIG93biB1bnJlZ2lzdGVyZWQga2V5LlxuZnVuY3Rpb24gc2FtZUVudHJ5KGEsIGIpIHtcbiAgcmV0dXJuICEhYSAmJiAhIWIgJiYgYS50eXBLZXkgPT09IGIudHlwS2V5ICYmIGEuc3VidHlwS2V5ID09PSBiLnN1YnR5cEtleTtcbn1cblxuLy8gQ2VudHJhbCBUWVAvU1VCVFlQIGluZGV4IG92ZXIgYWxsIG1hcmtkb3duIGZpbGVzIChwYXRoIC0+IHZhbHVlcykuXG4vL1xuLy8gbWV0YWRhdGFDYWNoZSBcImNoYW5nZWRcIi9cInJlc29sdmVkXCIgZmlyZSBvbiBFVkVSWSBlZGl0IHRvIGFueSBub3RlIChhYm91dFxuLy8gZXZlcnkgdHdvIHNlY29uZHMgd2hpbGUgdHlwaW5nKS4gVGhlIGluZGV4IGNvbXBhcmVzIHBlciBmaWxlIHdoZXRoZXIgVFlQIG9yXG4vLyBTVUJUWVAgcmVhbGx5IGNoYW5nZWQgKG9yIGEgbm90ZSBhcHBlYXJlZC9kaXNhcHBlYXJlZCkgYW5kIG9ubHkgdGhlbiBmaXJlc1xuLy8gaXRzIG93biBcImNoYW5nZVwiIGV2ZW50IChhcmd1bWVudDogc2V0IG9mIGFmZmVjdGVkIHBhdGhzKS4gQWxsIGNvbG9yaW5nIGhhbmdzXG4vLyBvbiB0aGlzIGV2ZW50LCBzbyBub3JtYWwgdHlwaW5nIHRyaWdnZXJzIG5vIHJlY29sb3JpbmcuXG4vL1xuLy8gSXQgYWxzbyBjYWNoZXMgdGhlIHZhdWx0LXdpZGUgY291bnRzIChUWVAtTGlzdCwgU3VidHlwIGxpc3QsIHBpY2tlcnMsXG4vLyBnZXRUeXBzKCkpIGluc3RlYWQgb2YgcmVzY2FubmluZyBldmVyeSBub3RlIG9uIGVhY2ggY2FsbC5cbmNsYXNzIFR5cEluZGV4IGV4dGVuZHMgRXZlbnRzIHtcbiAgY29uc3RydWN0b3IocGx1Z2luKSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgICB0aGlzLmFwcCA9IHBsdWdpbi5hcHA7XG4gICAgdGhpcy5lbnRyaWVzID0gbmV3IE1hcCgpO1xuICAgIHRoaXMuYnVpbHQgPSBmYWxzZTtcbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsO1xuICAgIHRoaXMucGVuZGluZ1BhdGhzID0gbmV3IFNldCgpO1xuICAgIHRoaXMuZmx1c2ggPSBkZWJvdW5jZSgoKSA9PiB7XG4gICAgICBjb25zdCBwYXRocyA9IHRoaXMucGVuZGluZ1BhdGhzO1xuICAgICAgdGhpcy5wZW5kaW5nUGF0aHMgPSBuZXcgU2V0KCk7XG4gICAgICB0aGlzLnRyaWdnZXIoXCJjaGFuZ2VcIiwgcGF0aHMpO1xuICAgIH0sIEZMVVNIX0RFTEFZX01TKTtcbiAgfVxuXG4gIHJlZ2lzdGVyKCkge1xuICAgIGNvbnN0IHsgcGx1Z2luLCBhcHAgfSA9IHRoaXM7XG4gICAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoYXBwLm1ldGFkYXRhQ2FjaGUub24oXCJjaGFuZ2VkXCIsIChmaWxlKSA9PiB0aGlzLnVwZGF0ZShmaWxlKSkpO1xuICAgIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC5tZXRhZGF0YUNhY2hlLm9uKFwiZGVsZXRlZFwiLCAoZmlsZSkgPT4gdGhpcy5yZW1vdmUoZmlsZS5wYXRoKSkpO1xuICAgIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC52YXVsdC5vbihcInJlbmFtZVwiLCAoZmlsZSwgb2xkUGF0aCkgPT4gdGhpcy5yZW5hbWUoZmlsZSwgb2xkUGF0aCkpKTtcbiAgICAvLyBcIkV4Y2x1ZGVkIGZpbGVzXCIgY2hhbmdlZDogdGhlIGVudHJpZXMgc3RheSB2YWxpZCwgb25seSB0aGUgZmlsdGVyZWRcbiAgICAvLyBjb3VudHMgZG9uJ3QuXG4gICAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoYXBwLnZhdWx0Lm9uKFwiY29uZmlnLWNoYW5nZWRcIiwgKCkgPT4gKHRoaXMuYWdncmVnYXRlcyA9IG51bGwpKSk7XG5cbiAgICAvLyBBdCBzdGFydHVwIHRoZSBmaXJzdCAobGF6eSkgYWNjZXNzIGNhbiBjb21lIGJlZm9yZSB0aGUgbWV0YWRhdGEgY2FjaGUgaXNcbiAgICAvLyBmdWxseSBsb2FkZWQuIFJlYnVpbGQgb25jZSBhZnRlciBpdHMgZmlyc3QgY29tcGxldGUgcmVzb2x2ZTsgZGlmZmVyZW5jZXNcbiAgICAvLyBnbyBvdXQgdGhyb3VnaCB0aGUgXCJjaGFuZ2VcIiBldmVudCBsaWtlIGFueSBvdGhlciBjaGFuZ2UuXG4gICAgY29uc3QgcmVzb2x2ZWRSZWYgPSBhcHAubWV0YWRhdGFDYWNoZS5vbihcInJlc29sdmVkXCIsICgpID0+IHtcbiAgICAgIGFwcC5tZXRhZGF0YUNhY2hlLm9mZnJlZihyZXNvbHZlZFJlZik7XG4gICAgICB0aGlzLnJlYnVpbGQoKTtcbiAgICB9KTtcbiAgICBwbHVnaW4ucmVnaXN0ZXJFdmVudChyZXNvbHZlZFJlZik7XG5cbiAgICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4gdGhpcy5mbHVzaC5jYW5jZWwoKSk7XG4gIH1cblxuICByZWFkKGZpbGUpIHtcbiAgICBjb25zdCBmcm9udG1hdHRlciA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlcjtcbiAgICBjb25zdCByYXdUeXAgPSBwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBUWVBfUFJPUEVSVFkpID8/IG51bGw7XG4gICAgY29uc3QgcmF3U3VidHlwID0gcHJvcGVydHlWYWx1ZShmcm9udG1hdHRlciwgU1VCVFlQX1BST1BFUlRZKSA/PyBudWxsO1xuICAgIHJldHVybiB7IHR5cEtleTogdHlwS2V5T2YocmF3VHlwKSwgcmF3VHlwLCBzdWJ0eXBLZXk6IHR5cEtleU9mKHJhd1N1YnR5cCksIHJhd1N1YnR5cCB9O1xuICB9XG5cbiAgZW5zdXJlQnVpbHQoKSB7XG4gICAgaWYgKCF0aGlzLmJ1aWx0KSB0aGlzLnJlYnVpbGQoKTtcbiAgfVxuXG4gIHJlYnVpbGQoKSB7XG4gICAgY29uc3QgcHJldmlvdXMgPSB0aGlzLmVudHJpZXM7XG4gICAgY29uc3Qgd2FzQnVpbHQgPSB0aGlzLmJ1aWx0O1xuICAgIHRoaXMuZW50cmllcyA9IG5ldyBNYXAoKTtcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpKSB0aGlzLmVudHJpZXMuc2V0KGZpbGUucGF0aCwgdGhpcy5yZWFkKGZpbGUpKTtcbiAgICB0aGlzLmJ1aWx0ID0gdHJ1ZTtcbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsO1xuICAgIGlmICghd2FzQnVpbHQpIHJldHVybjtcblxuICAgIGZvciAoY29uc3QgW3BhdGgsIGVudHJ5XSBvZiB0aGlzLmVudHJpZXMpIHtcbiAgICAgIGlmICghc2FtZUVudHJ5KHByZXZpb3VzLmdldChwYXRoKSwgZW50cnkpKSB0aGlzLnBlbmRpbmdQYXRocy5hZGQocGF0aCk7XG4gICAgfVxuICAgIGZvciAoY29uc3QgcGF0aCBvZiBwcmV2aW91cy5rZXlzKCkpIHtcbiAgICAgIGlmICghdGhpcy5lbnRyaWVzLmhhcyhwYXRoKSkgdGhpcy5wZW5kaW5nUGF0aHMuYWRkKHBhdGgpO1xuICAgIH1cbiAgICBpZiAodGhpcy5wZW5kaW5nUGF0aHMuc2l6ZSA+IDApIHRoaXMuZmx1c2goKTtcbiAgfVxuXG4gIG1hcmtDaGFuZ2VkKHBhdGgpIHtcbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsO1xuICAgIHRoaXMucGVuZGluZ1BhdGhzLmFkZChwYXRoKTtcbiAgICB0aGlzLmZsdXNoKCk7XG4gIH1cblxuICB1cGRhdGUoZmlsZSkge1xuICAgIC8vIEJlZm9yZSB0aGUgZmlyc3QgYWNjZXNzIHRoZXJlIGlzIG5vdGhpbmcgc3RhbGU7IHRoZSBsYXp5IGJ1aWxkIHJlYWRzXG4gICAgLy8gZnJlc2ggZnJvbSB0aGUgY2FjaGUgYW55d2F5LlxuICAgIGlmICghdGhpcy5idWlsdCB8fCAhKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkgfHwgZmlsZS5leHRlbnNpb24gIT09IFwibWRcIikgcmV0dXJuO1xuICAgIGNvbnN0IG5leHQgPSB0aGlzLnJlYWQoZmlsZSk7XG4gICAgaWYgKHNhbWVFbnRyeSh0aGlzLmVudHJpZXMuZ2V0KGZpbGUucGF0aCksIG5leHQpKSByZXR1cm47XG4gICAgdGhpcy5lbnRyaWVzLnNldChmaWxlLnBhdGgsIG5leHQpO1xuICAgIHRoaXMubWFya0NoYW5nZWQoZmlsZS5wYXRoKTtcbiAgfVxuXG4gIHJlbW92ZShwYXRoKSB7XG4gICAgaWYgKCF0aGlzLmJ1aWx0IHx8ICF0aGlzLmVudHJpZXMuZGVsZXRlKHBhdGgpKSByZXR1cm47XG4gICAgdGhpcy5tYXJrQ2hhbmdlZChwYXRoKTtcbiAgfVxuXG4gIHJlbmFtZShmaWxlLCBvbGRQYXRoKSB7XG4gICAgaWYgKCF0aGlzLmJ1aWx0KSByZXR1cm47XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLmVudHJpZXMuZ2V0KG9sZFBhdGgpO1xuICAgIGlmIChlbnRyeSkge1xuICAgICAgdGhpcy5lbnRyaWVzLmRlbGV0ZShvbGRQYXRoKTtcbiAgICAgIHRoaXMubWFya0NoYW5nZWQob2xkUGF0aCk7XG4gICAgfVxuICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZpbGUgJiYgZmlsZS5leHRlbnNpb24gPT09IFwibWRcIikge1xuICAgICAgdGhpcy5lbnRyaWVzLnNldChmaWxlLnBhdGgsIGVudHJ5ID8/IHRoaXMucmVhZChmaWxlKSk7XG4gICAgICB0aGlzLm1hcmtDaGFuZ2VkKGZpbGUucGF0aCk7XG4gICAgfVxuICB9XG5cbiAgZW50cnlGb3IoZmlsZSkge1xuICAgIGlmICghZmlsZSkgcmV0dXJuIEVNUFRZX0VOVFJZO1xuICAgIHRoaXMuZW5zdXJlQnVpbHQoKTtcbiAgICByZXR1cm4gdGhpcy5lbnRyaWVzLmdldChmaWxlLnBhdGgpID8/IEVNUFRZX0VOVFJZO1xuICB9XG5cbiAgLy8gVFlQIGtleSAoc2VlIHR5cEtleU9mKSBvciBudWxsOyBmb3IgYSBjbGVhbiB2YWx1ZSBzaW1wbHkgdGhlIFRZUCBuYW1lLlxuICB0eXBPZihmaWxlKSB7XG4gICAgcmV0dXJuIHRoaXMuZW50cnlGb3IoZmlsZSkudHlwS2V5O1xuICB9XG5cbiAgLy8gU1VCVFlQIGtleSAoc2VlIHR5cEtleU9mKSBvciBudWxsLlxuICBzdWJ0eXBPZihmaWxlKSB7XG4gICAgcmV0dXJuIHRoaXMuZW50cnlGb3IoZmlsZSkuc3VidHlwS2V5O1xuICB9XG5cbiAgLy8gQW4gYWN0dWFsIGZyb250bWF0dGVyIHZhbHVlIGZvciBhIGtleSAtIGZvciBkaXNwbGF5LCBzZWFyY2ggYW5kIGNsZWFuaW5nXG4gIC8vIHVwIHVucmVnaXN0ZXJlZCBlbnRyaWVzIChhbGwgbm90ZXMgb2YgYSBrZXkgc2hhcmUgdGhlIHNhbWUgcmF3IGZvcm0pLlxuICByYXdWYWx1ZU9mKHR5cEtleSkge1xuICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZSgpLnJhd0J5S2V5LmdldCh0eXBLZXkpO1xuICB9XG5cbiAgLy8gQ2xlYW4gPSBhIHNpbmdsZSB2YWx1ZSB3aXRob3V0IHBhZGRpbmcuIExvd2VyY2FzZSBjb3VudHMgYXMgY2xlYW4gKGEgdmFsaWRcbiAgLy8gVFlQIG5hbWUsIGp1c3Qgbm90IHJlZ2lzdGVyZWQgeWV0KTsgbGlzdHMgYW5kIHBhZGRpbmcgZG9uJ3QuXG4gIGlzQ2xlYW5LZXkodHlwS2V5KSB7XG4gICAgY29uc3QgcmF3ID0gdGhpcy5yYXdWYWx1ZU9mKHR5cEtleSk7XG4gICAgcmV0dXJuIHJhdyAhPT0gdW5kZWZpbmVkICYmICFBcnJheS5pc0FycmF5KHJhdykgJiYgdHlwS2V5ID09PSB0eXBLZXkudHJpbSgpO1xuICB9XG5cbiAgLy8gRmlsZXMgd2l0aCBleGFjdGx5IHRoaXMgVFlQIGtleSwgaG9ub3JpbmcgdGhlIGV4Y2x1ZGVkLWZpbGVzIHNldHRpbmcuXG4gIGZpbGVzV2l0aFR5cCh0eXBLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5maWxlc01hdGNoaW5nKChlbnRyeSkgPT4gZW50cnkudHlwS2V5ID09PSB0eXBLZXkpO1xuICB9XG5cbiAgLy8gRmlsZXMgd2l0aCBleGFjdGx5IHRoaXMgVFlQIGFuZCBTVUJUWVAga2V5LlxuICBmaWxlc1dpdGhTdWJ0eXAodHlwS2V5LCBzdWJ0eXBLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5maWxlc01hdGNoaW5nKChlbnRyeSkgPT4gZW50cnkudHlwS2V5ID09PSB0eXBLZXkgJiYgZW50cnkuc3VidHlwS2V5ID09PSBzdWJ0eXBLZXkpO1xuICB9XG5cbiAgZmlsZXNNYXRjaGluZyhwcmVkaWNhdGUpIHtcbiAgICB0aGlzLmVuc3VyZUJ1aWx0KCk7XG4gICAgY29uc3QgaW5jbHVkZUlnbm9yZWQgPSAhIXRoaXMucGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXM7XG4gICAgY29uc3QgZmlsZXMgPSBbXTtcbiAgICBmb3IgKGNvbnN0IFtwYXRoLCBlbnRyeV0gb2YgdGhpcy5lbnRyaWVzKSB7XG4gICAgICBpZiAoIXByZWRpY2F0ZShlbnRyeSkpIGNvbnRpbnVlO1xuICAgICAgaWYgKCFpbmNsdWRlSWdub3JlZCAmJiB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmlzVXNlcklnbm9yZWQocGF0aCkpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChwYXRoKTtcbiAgICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZpbGUpIGZpbGVzLnB1c2goZmlsZSk7XG4gICAgfVxuICAgIHJldHVybiBmaWxlcztcbiAgfVxuXG4gIC8vIEhvbm9ycyBPYnNpZGlhbidzIFwiRXhjbHVkZWQgZmlsZXNcIiAod2hlcmUgSGlkZSBGb2xkZXJzIGFsc28gcHV0cyBoaWRkZW5cbiAgLy8gZm9sZGVycykgdW5sZXNzIFwiSW5jbHVkZSBleGNsdWRlZCBmaWxlc1wiIGlzIG9uLiBBIG5vdGUgd2l0aG91dCBhIFRZUCBoYXNcbiAgLy8gbm8gU1VCVFlQIGNvbnRleHQuXG4gIGFnZ3JlZ2F0ZSgpIHtcbiAgICB0aGlzLmVuc3VyZUJ1aWx0KCk7XG4gICAgY29uc3QgaW5jbHVkZUlnbm9yZWQgPSAhIXRoaXMucGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXM7XG4gICAgaWYgKHRoaXMuYWdncmVnYXRlcz8uaW5jbHVkZUlnbm9yZWQgPT09IGluY2x1ZGVJZ25vcmVkKSByZXR1cm4gdGhpcy5hZ2dyZWdhdGVzO1xuXG4gICAgY29uc3QgY291bnRzID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IHJhd0J5S2V5ID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IHN1YnR5cHNCeVR5cCA9IG5ldyBNYXAoKTtcbiAgICBsZXQgbm9UeXAgPSAwO1xuICAgIGZvciAoY29uc3QgW3BhdGgsIHsgdHlwS2V5LCByYXdUeXAsIHN1YnR5cEtleSwgcmF3U3VidHlwIH1dIG9mIHRoaXMuZW50cmllcykge1xuICAgICAgaWYgKCFpbmNsdWRlSWdub3JlZCAmJiB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmlzVXNlcklnbm9yZWQocGF0aCkpIGNvbnRpbnVlO1xuICAgICAgaWYgKHR5cEtleSA9PT0gbnVsbCkge1xuICAgICAgICBub1R5cCsrO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvdW50cy5zZXQodHlwS2V5LCAoY291bnRzLmdldCh0eXBLZXkpID8/IDApICsgMSk7XG4gICAgICBpZiAoIXJhd0J5S2V5Lmhhcyh0eXBLZXkpKSByYXdCeUtleS5zZXQodHlwS2V5LCByYXdUeXApO1xuICAgICAgbGV0IGJ1Y2tldCA9IHN1YnR5cHNCeVR5cC5nZXQodHlwS2V5KTtcbiAgICAgIGlmICghYnVja2V0KSB7XG4gICAgICAgIGJ1Y2tldCA9IHsgY291bnRzOiBuZXcgTWFwKCksIG5vU3VidHlwOiAwLCByYXdCeUtleTogbmV3IE1hcCgpIH07XG4gICAgICAgIHN1YnR5cHNCeVR5cC5zZXQodHlwS2V5LCBidWNrZXQpO1xuICAgICAgfVxuICAgICAgaWYgKHN1YnR5cEtleSA9PT0gbnVsbCkge1xuICAgICAgICBidWNrZXQubm9TdWJ0eXArKztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGJ1Y2tldC5jb3VudHMuc2V0KHN1YnR5cEtleSwgKGJ1Y2tldC5jb3VudHMuZ2V0KHN1YnR5cEtleSkgPz8gMCkgKyAxKTtcbiAgICAgICAgaWYgKCFidWNrZXQucmF3QnlLZXkuaGFzKHN1YnR5cEtleSkpIGJ1Y2tldC5yYXdCeUtleS5zZXQoc3VidHlwS2V5LCByYXdTdWJ0eXApO1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSB7IGluY2x1ZGVJZ25vcmVkLCBjb3VudHMsIG5vVHlwLCByYXdCeUtleSwgc3VidHlwc0J5VHlwIH07XG4gICAgcmV0dXJuIHRoaXMuYWdncmVnYXRlcztcbiAgfVxuXG4gIC8vIENhY2hlZCAtIGRvbid0IG1vZGlmeSB0aGUgcmV0dXJuZWQgbWFwcy5cbiAgdHlwQ291bnRzKCkge1xuICAgIGNvbnN0IHsgY291bnRzLCBub1R5cCB9ID0gdGhpcy5hZ2dyZWdhdGUoKTtcbiAgICByZXR1cm4geyBjb3VudHMsIG5vVHlwIH07XG4gIH1cblxuICAvLyBUWVAgLT4geyBjb3VudHM6IE1hcChTVUJUWVAga2V5IC0+IGNvdW50KSwgbm9TdWJ0eXAsIHJhd0J5S2V5IH0uXG4gIC8vIENhY2hlZCAtIGRvbid0IG1vZGlmeS5cbiAgc3VidHlwQ291bnRzKCkge1xuICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZSgpLnN1YnR5cHNCeVR5cDtcbiAgfVxuXG4gIHN1YnR5cEJ1Y2tldCh0eXBLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5zdWJ0eXBDb3VudHMoKS5nZXQodHlwS2V5KSA/PyBFTVBUWV9CVUNLRVQ7XG4gIH1cbn1cblxuY29uc3QgRU1QVFlfQlVDS0VUID0gT2JqZWN0LmZyZWV6ZSh7IGNvdW50czogbmV3IE1hcCgpLCBub1N1YnR5cDogMCwgcmF3QnlLZXk6IG5ldyBNYXAoKSB9KTtcblxubW9kdWxlLmV4cG9ydHMgPSB7IFR5cEluZGV4LCB0eXBLZXlPZiwgcHJvcGVydHlWYWx1ZSwgc2V0Q2Fub25pY2FsUHJvcGVydHksIGRlbGV0ZVByb3BlcnR5LCBUWVBfUFJPUEVSVFksIFNVQlRZUF9QUk9QRVJUWSB9O1xuIiwgImNvbnN0IHsgdHlwS2V5T2YsIHByb3BlcnR5VmFsdWUsIHNldENhbm9uaWNhbFByb3BlcnR5LCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcblxuLy8gU3VidHlwIG5hbWVzIGFyZSB0aXRsZSBjYXNlIHBlciB3b3JkICh1bmxpa2UgVFlQIG5hbWVzLCBzZWVcbi8vIG5vcm1hbGl6ZVR5cE5hbWUpOiBcImt1cnogR0VTQ0hJQ0hURVwiIC0+IFwiS3VyeiBHZXNjaGljaHRlXCIuIFRoZSBTVUJUWVBcbi8vIHByb3BlcnR5IGl0c2VsZiBzdGF5cyB1cHBlcmNhc2UuIFwiZGVcIiBsb2NhbGUgYmVjYXVzZSB0aGUgbmFtZXMgYXJlIEdlcm1hbi5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVN1YnR5cE5hbWUocmF3KSB7XG4gIHJldHVybiByYXcudHJpbSgpLnJlcGxhY2UoL1xcUysvZywgKHdvcmQpID0+IHdvcmQuY2hhckF0KDApLnRvTG9jYWxlVXBwZXJDYXNlKFwiZGVcIikgKyB3b3JkLnNsaWNlKDEpLnRvTG9jYWxlTG93ZXJDYXNlKFwiZGVcIikpO1xufVxuXG4vLyBSZWdpc3RlcmVkIFN1YnR5cHMgcGVyIFRZUCAoc2V0dGluZ3MudHlwU3VidHlwcyk6XG4vLyAgIHsgW1RZUF06IHsgW1NVQlRZUF06IHsgZnJvbnRtYXR0ZXI6IHsuLi59LCBmbG9hdGluZ0tleXM6IFsuLi5dLCBzaG9ydGN1dHM6IHsuLi59LCBtYW51YWw/OiBmYWxzZSB9IH0gfVxuLy8gQSBTdWJ0eXAgYmVsb25ncyB0byBleGFjdGx5IG9uZSBUWVAsIHRob3VnaCB0aGUgc2FtZSBuYW1lIG1heSBhbHNvIGV4aXN0XG4vLyB1bmRlciBhbm90aGVyIFRZUC4gS2V5IG9yZGVyIGlzIHRoZSBibG9jayBvcmRlciBpbiB0aGUgVFlQLVBhbmUsIGFsd2F5c1xuLy8gYmVsb3cgdGhlIFRZUC1Gcm9udG1hdHRlci4gZnJvbnRtYXR0ZXIgYWRkcyB0byBvciBvdmVycmlkZXMgdGhlXG4vLyBUWVAtRnJvbnRtYXR0ZXI7IGZsb2F0aW5nS2V5cyBhbmQgc2hvcnRjdXRzIHdvcmsgbGlrZSB0eXBGbG9hdGluZ0tleXMgYW5kXG4vLyB0eXBTaG9ydGN1dHMuIE9sZGVyIGRhdGEgbGFja3Mgc2hvcnRjdXRzLCBzbyByZWFkZXJzIHRyZWF0IGl0IGFzIG9wdGlvbmFsLlxuLy8gbWFudWFsIHdvcmtzIGxpa2UgdHlwTWFudWFsOiBvbmx5IHRoZSBkZXZpYXRpb24gKGZhbHNlKSBpcyBzdG9yZWQuXG4vL1xuLy8gVGhlIHNhbWUga2V5IG1heSBhcHBlYXIgaW4gc2V2ZXJhbCBibG9ja3Mgb2Ygb25lIFRZUCAob25seSB3aXRoaW4gT05FIGJsb2NrXG4vLyBpcyBpdCBuZWNlc3NhcmlseSB1bmlxdWUpOlxuLy8gICAtIGluIHR3byBTdWJ0eXAgYmxvY2tzOiBubyBjb25mbGljdCwgYSBub3RlIGhhcyBhdCBtb3N0IG9uZSBTVUJUWVA7XG4vLyAgIC0gaW4gdGhlIFRZUC1Gcm9udG1hdHRlciBBTkQgYSBTdWJ0eXAgYmxvY2s6IHRoZSBTdWJ0eXAgb3ZlcnJpZGVzIHZhbHVlXG4vLyAgICAgYW5kIGZsb2F0aW5nIGZsYWcsIHRoZSByb3cga2VlcHMgdGhlIFRZUC1Gcm9udG1hdHRlciBwb3NpdGlvbi4gZ2V0VHlwRGVmYXVsdHNcbi8vICAgICAobWFpbi5qcykgYW5kIG9yZGVyZWREZWZhdWx0S2V5cyAoZnJvbnRtYXR0ZXItc29ydC5qcykgbXVzdCB1c2UgdGhlIHNhbWVcbi8vICAgICBydWxlLCBvciBzb3J0aW5nIHdvdWxkIHJlLXNvcnQgYSBmcmVzaGx5IGNyZWF0ZWQgbm90ZSByaWdodCBhd2F5LlxuXG4vLyBcIlN0aWxsIHRvIGJlIGZpbGxlZFwiOiB3aGVuIHR3byBibG9ja3Mgb3IgdHdvIHByb3BlcnRpZXMgbWVyZ2UsIHN1Y2ggYSB2YWx1ZVxuLy8gaXMgZmlsbGVkIGZyb20gdGhlIG90aGVyIGluc3RlYWQgb2Ygb3ZlcndyaXRpbmcgdGhlIGV4aXN0aW5nIGVudHJ5IChzZWVcbi8vIG1lcmdlU3VidHlwcyBoZXJlIGFuZCByZW5hbWVJblN0b3JlIGluIHByb3BlcnR5LXJlbmFtZS1zeW5jLmpzKS5cbmZ1bmN0aW9uIGlzRW1wdHlWYWx1ZSh2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gXCJcIjtcbn1cblxuZnVuY3Rpb24gZ2V0U3VidHlwTmFtZXMoc2V0dGluZ3MsIHR5cCkge1xuICByZXR1cm4gT2JqZWN0LmtleXMoc2V0dGluZ3MudHlwU3VidHlwcz8uW3R5cF0gPz8ge30pO1xufVxuXG5mdW5jdGlvbiBnZXRTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgc3VidHlwKSB7XG4gIHJldHVybiBzZXR0aW5ncy50eXBTdWJ0eXBzPy5bdHlwXT8uW3N1YnR5cF0gPz8gbnVsbDtcbn1cblxuZnVuY3Rpb24gZW5zdXJlU3VidHlwKHNldHRpbmdzLCB0eXAsIHN1YnR5cCkge1xuICBpZiAoIXNldHRpbmdzLnR5cFN1YnR5cHMpIHNldHRpbmdzLnR5cFN1YnR5cHMgPSB7fTtcbiAgaWYgKCFzZXR0aW5ncy50eXBTdWJ0eXBzW3R5cF0pIHNldHRpbmdzLnR5cFN1YnR5cHNbdHlwXSA9IHt9O1xuICBjb25zdCBieU5hbWUgPSBzZXR0aW5ncy50eXBTdWJ0eXBzW3R5cF07XG4gIGlmICghYnlOYW1lW3N1YnR5cF0pIHtcbiAgICBieU5hbWVbc3VidHlwXSA9IHsgZnJvbnRtYXR0ZXI6IHt9LCBmbG9hdGluZ0tleXM6IFtdLCBzaG9ydGN1dHM6IHt9IH07XG4gICAgLy8gQSBuZXcgU3VidHlwIG9mIGEgVFlQIHRoYXQgaXNuJ3QgbWFudWFsbHkgY3JlYXRhYmxlIGlzbid0IGVpdGhlciAoc2VlXG4gICAgLy8gaXNTdWJ0eXBNYW51YWwpLlxuICAgIGlmIChzZXR0aW5ncy50eXBNYW51YWw/Llt0eXBdID09PSBmYWxzZSkgYnlOYW1lW3N1YnR5cF0ubWFudWFsID0gZmFsc2U7XG4gIH1cbiAgcmV0dXJuIGJ5TmFtZVtzdWJ0eXBdO1xufVxuXG4vKiAtLS0gXCJNYW51YWxseSBjcmVhdGFibGVcIiBwZXIgU3VidHlwIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICogTGlrZSB0eXBNYW51YWwgZm9yIFRZUCBlbnRyaWVzOiBvbmx5IHN3aXRjaGluZyBvZmYgaXMgc3RvcmVkXG4gKiAobWFudWFsOiBmYWxzZSk7IG5vIGVudHJ5IG9yIHRydWUgbWVhbnMgb24uIERlY2lkZXMgd2hldGhlciB0aGUgU3VidHlwXG4gKiBzaG93cyB1cCBpbiBnZXRTdWJ0eXBzKCkgKG1haW4uanMpIGFuZCB0aHVzIGluIHRoZSBTdWJ0eXAtUGlja2VyLlxuICpcbiAqIFRZUCBhbmQgU3VidHlwIGFyZSBsaW5rZWQsIGJlY2F1c2UgdGhlIHBpY2tlciBvbmx5IHJlYWNoZXMgYSBTdWJ0eXAgdGhyb3VnaFxuICogaXRzIFRZUDogc3dpdGNoaW5nIGEgVFlQIG9mZiBzd2l0Y2hlcyBhbGwgaXRzIFN1YnR5cHMgb2ZmLCBzd2l0Y2hpbmcgaXQgb25cbiAqIHN3aXRjaGVzIHRoZW0gYWxsIG9uIChzZXRBbGxTdWJ0eXBzTWFudWFsKSwgYW5kIHN3aXRjaGluZyBhIHNpbmdsZSBTdWJ0eXAgb25cbiAqIGFsc28gc3dpdGNoZXMgaXRzIFRZUCBvbiwgbGVhdmluZyB0aGUgb3RoZXIgU3VidHlwcyBhbG9uZSAoc2VlXG4gKiByZW5kZXJTdWJ0eXBNYW51YWxUb2dnbGUgaW4gdHlwLXBhbmUuanMpLiBTbyBhIFN1YnR5cCBpcyBvbmx5IGV2ZXIgbWFudWFsbHlcbiAqIGNyZWF0YWJsZSBpZiBpdHMgVFlQIGlzLlxuICogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5mdW5jdGlvbiBpc1N1YnR5cE1hbnVhbChzZXR0aW5ncywgdHlwLCBzdWJ0eXApIHtcbiAgcmV0dXJuIGdldFN1YnR5cChzZXR0aW5ncywgdHlwLCBzdWJ0eXApPy5tYW51YWwgIT09IGZhbHNlO1xufVxuXG5mdW5jdGlvbiBzZXRTdWJ0eXBNYW51YWwoc2V0dGluZ3MsIHR5cCwgc3VidHlwLCBvbikge1xuICBjb25zdCBkYXRhID0gZ2V0U3VidHlwKHNldHRpbmdzLCB0eXAsIHN1YnR5cCk7XG4gIGlmICghZGF0YSkgcmV0dXJuO1xuICBpZiAob24pIGRlbGV0ZSBkYXRhLm1hbnVhbDtcbiAgZWxzZSBkYXRhLm1hbnVhbCA9IGZhbHNlO1xufVxuXG5mdW5jdGlvbiBzZXRBbGxTdWJ0eXBzTWFudWFsKHNldHRpbmdzLCB0eXAsIG9uKSB7XG4gIGZvciAoY29uc3Qgc3VidHlwIG9mIGdldFN1YnR5cE5hbWVzKHNldHRpbmdzLCB0eXApKSBzZXRTdWJ0eXBNYW51YWwoc2V0dGluZ3MsIHR5cCwgc3VidHlwLCBvbik7XG59XG5cbi8vIFdoZW4gYSBUWVAgaXMgcmVuYW1lZCwgaXRzIFN1YnR5cHMgbW92ZSB0byB0aGUgbmV3IG5hbWUuXG5mdW5jdGlvbiBtb3ZlVHlwU3VidHlwcyhzZXR0aW5ncywgb2xkVHlwLCBuZXdUeXApIHtcbiAgaWYgKCFzZXR0aW5ncy50eXBTdWJ0eXBzPy5bb2xkVHlwXSkgcmV0dXJuO1xuICBzZXR0aW5ncy50eXBTdWJ0eXBzW25ld1R5cF0gPSBzZXR0aW5ncy50eXBTdWJ0eXBzW29sZFR5cF07XG4gIGRlbGV0ZSBzZXR0aW5ncy50eXBTdWJ0eXBzW29sZFR5cF07XG59XG5cbmZ1bmN0aW9uIGRlbGV0ZVR5cFN1YnR5cHMoc2V0dGluZ3MsIHR5cCkge1xuICBpZiAoc2V0dGluZ3MudHlwU3VidHlwcykgZGVsZXRlIHNldHRpbmdzLnR5cFN1YnR5cHNbdHlwXTtcbn1cblxuLy8gTWVyZ2luZyB0d28gVFlQIGVudHJpZXM6IFN1YnR5cHMgb25seSBpbiBzb3VyY2UgbW92ZSBvdmVyLiBCbG9ja3Mgd2l0aCB0aGVcbi8vIHNhbWUgbmFtZSBhcmUgY29tYmluZWQgLSBmb3IgYSBzaGFyZWQga2V5IHRoZSB0YXJnZXQncyB2YWx1ZSBhbmQgZmxvYXRpbmdcbi8vIGZsYWcgd2luLCBrZXlzIG9ubHkgaW4gc291cmNlIGFyZSBhcHBlbmRlZC4gQSBtb3ZlZCBrZXkgdGhhdCBpcyBhbHNvIGluIHRoZVxuLy8gdGFyZ2V0J3MgVFlQLUZyb250bWF0dGVyIHN0YXlzIGluIGJvdGgsIHdoaWNoIGlzIHRoZSBub3JtYWwgb3ZlcnJpZGUuXG5mdW5jdGlvbiBtZXJnZVR5cFN1YnR5cHMoc2V0dGluZ3MsIHNvdXJjZSwgdGFyZ2V0KSB7XG4gIGNvbnN0IHNvdXJjZVN1YnR5cHMgPSBzZXR0aW5ncy50eXBTdWJ0eXBzPy5bc291cmNlXTtcbiAgaWYgKCFzb3VyY2VTdWJ0eXBzKSByZXR1cm47XG4gIGZvciAoY29uc3QgW25hbWUsIHNvdXJjZURhdGFdIG9mIE9iamVjdC5lbnRyaWVzKHNvdXJjZVN1YnR5cHMpKSB7XG4gICAgY29uc3QgdGFyZ2V0RGF0YSA9IGdldFN1YnR5cChzZXR0aW5ncywgdGFyZ2V0LCBuYW1lKTtcbiAgICBpZiAoIXRhcmdldERhdGEpIHtcbiAgICAgIGVuc3VyZVN1YnR5cChzZXR0aW5ncywgdGFyZ2V0LCBuYW1lKTtcbiAgICAgIHNldHRpbmdzLnR5cFN1YnR5cHNbdGFyZ2V0XVtuYW1lXSA9IHNvdXJjZURhdGE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgdGFyZ2V0TG93ZXIgPSBuZXcgU2V0KE9iamVjdC5rZXlzKHRhcmdldERhdGEuZnJvbnRtYXR0ZXIpLm1hcCgoa2V5KSA9PiBrZXkudG9Mb3dlckNhc2UoKSkpO1xuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHNvdXJjZURhdGEuZnJvbnRtYXR0ZXIpKSB7XG4gICAgICBpZiAoa2V5ID09PSBcIlwiIHx8IHRhcmdldExvd2VyLmhhcyhrZXkudG9Mb3dlckNhc2UoKSkpIGNvbnRpbnVlO1xuICAgICAgdGFyZ2V0RGF0YS5mcm9udG1hdHRlcltrZXldID0gdmFsdWU7XG4gICAgICBpZiAoc291cmNlRGF0YS5mbG9hdGluZ0tleXMuaW5jbHVkZXMoa2V5KSkgdGFyZ2V0RGF0YS5mbG9hdGluZ0tleXMucHVzaChrZXkpO1xuICAgICAgLy8gVGhlIHNob3J0Y3V0IGJlbG9uZ3MgdG8gdGhlIGtleSBhbmQgbW92ZXMgd2l0aCBpdC5cbiAgICAgIGNvbnN0IHNob3J0Y3V0ID0gc291cmNlRGF0YS5zaG9ydGN1dHM/LltrZXldO1xuICAgICAgaWYgKHNob3J0Y3V0KSAodGFyZ2V0RGF0YS5zaG9ydGN1dHMgPz89IHt9KVtrZXldID0gc2hvcnRjdXQ7XG4gICAgfVxuICB9XG4gIGRlbGV0ZSBzZXR0aW5ncy50eXBTdWJ0eXBzW3NvdXJjZV07XG59XG5cbi8vIFJlbmFtZXMgYSBTdWJ0eXAgd2l0aGluIGl0cyBUWVA7IHRoZSBibG9jayBrZWVwcyBpdHMgcG9zaXRpb24gKGRpc3BsYXlcbi8vIG9yZGVyID0ga2V5IG9yZGVyKS5cbmZ1bmN0aW9uIHJlbmFtZVN1YnR5cChzZXR0aW5ncywgdHlwLCBvbGROYW1lLCBuZXdOYW1lKSB7XG4gIGNvbnN0IGJ5TmFtZSA9IHNldHRpbmdzLnR5cFN1YnR5cHM/Llt0eXBdO1xuICBpZiAoIWJ5TmFtZT8uW29sZE5hbWVdIHx8IG9sZE5hbWUgPT09IG5ld05hbWUpIHJldHVybjtcbiAgc2V0dGluZ3MudHlwU3VidHlwc1t0eXBdID0gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgIE9iamVjdC5lbnRyaWVzKGJ5TmFtZSkubWFwKChbbmFtZSwgZGF0YV0pID0+IFtuYW1lID09PSBvbGROYW1lID8gbmV3TmFtZSA6IG5hbWUsIGRhdGFdKVxuICApO1xufVxuXG4vLyBPcmRlciBvZiBhbGwgYmxvY2tzIG9mIGEgVFlQLCBudWxsID0gVFlQLUZyb250bWF0dGVyIChhbHdheXMgZmlyc3QpLCB0aGVuXG4vLyB0aGUgU3VidHlwcyBpbiBrZXkgb3JkZXIuIERyaXZlcyB0aGUgVFlQLVBhbmUgYXMgd2VsbCBhcyBmcm9udG1hdHRlclxuLy8gc29ydGluZyAoc2VlIG9yZGVyZWREZWZhdWx0S2V5cykuXG5mdW5jdGlvbiBnZXRTZWN0aW9uT3JkZXIoc2V0dGluZ3MsIHR5cCkge1xuICByZXR1cm4gW251bGwsIC4uLmdldFN1YnR5cE5hbWVzKHNldHRpbmdzLCB0eXApXTtcbn1cblxuLy8gTmV3IGJsb2NrIG9yZGVyIGZyb20gZHJhZyAmIGRyb3AgaW4gdGhlIFRZUC1QYW5lLCBzaGFwZWQgbGlrZVxuLy8gZ2V0U2VjdGlvbk9yZGVyOyB0aGUgbGVhZGluZyBudWxsIGlzIGlnbm9yZWQgKHRoZSBUWVAtRnJvbnRtYXR0ZXIgY2FuJ3Rcbi8vIG1vdmUpLiBTdWJ0eXBzIG5vdCBsaXN0ZWQgc3RheSBhdCB0aGUgZW5kLlxuZnVuY3Rpb24gcmVvcmRlclN1YnR5cHMoc2V0dGluZ3MsIHR5cCwgb3JkZXIpIHtcbiAgY29uc3QgYnlOYW1lID0gc2V0dGluZ3MudHlwU3VidHlwcz8uW3R5cF07XG4gIGlmICghYnlOYW1lKSByZXR1cm47XG4gIGNvbnN0IG5hbWVzID0gb3JkZXIuZmlsdGVyKChuYW1lKSA9PiBuYW1lICE9PSBudWxsICYmIGJ5TmFtZVtuYW1lXSk7XG4gIGNvbnN0IG9yZGVyZWQgPSBbLi4ubmFtZXMsIC4uLk9iamVjdC5rZXlzKGJ5TmFtZSkuZmlsdGVyKChuYW1lKSA9PiAhbmFtZXMuaW5jbHVkZXMobmFtZSkpXTtcbiAgc2V0dGluZ3MudHlwU3VidHlwc1t0eXBdID0gT2JqZWN0LmZyb21FbnRyaWVzKG9yZGVyZWQubWFwKChuYW1lKSA9PiBbbmFtZSwgYnlOYW1lW25hbWVdXSkpO1xufVxuXG5mdW5jdGlvbiBkZWxldGVTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgbmFtZSkge1xuICBjb25zdCBieU5hbWUgPSBzZXR0aW5ncy50eXBTdWJ0eXBzPy5bdHlwXTtcbiAgaWYgKCFieU5hbWUpIHJldHVybjtcbiAgZGVsZXRlIGJ5TmFtZVtuYW1lXTtcbiAgaWYgKE9iamVjdC5rZXlzKGJ5TmFtZSkubGVuZ3RoID09PSAwKSBkZWxldGUgc2V0dGluZ3MudHlwU3VidHlwc1t0eXBdO1xufVxuXG4vLyBNZXJnaW5nIHR3byBTdWJ0eXBzIG9mIG9uZSBUWVA6IHNvdXJjZSdzIHByb3BlcnRpZXMgZ28gdG8gdGhlIGVuZCBvZiB0aGVcbi8vIHRhcmdldCBibG9jaywgc291cmNlIGRpc2FwcGVhcnMuIElmIHRoZSB0YXJnZXQgYWxyZWFkeSBoYXMgYSBrZXksIGl0IGtlZXBzXG4vLyBwb3NpdGlvbiwgdmFsdWUgYW5kIGZsb2F0aW5nIGZsYWc7IG9ubHkgYW4gZW1wdHkgdGFyZ2V0IHZhbHVlIGlzIGZpbGxlZFxuLy8gZnJvbSBzb3VyY2UgKHNhbWUgcGF0dGVybiBhcyByZW5hbWVJblN0b3JlIGluIHByb3BlcnR5LXJlbmFtZS1zeW5jLmpzKS5cbmZ1bmN0aW9uIG1lcmdlU3VidHlwcyhzZXR0aW5ncywgdHlwLCBzb3VyY2UsIHRhcmdldCkge1xuICBjb25zdCBzb3VyY2VEYXRhID0gZ2V0U3VidHlwKHNldHRpbmdzLCB0eXAsIHNvdXJjZSk7XG4gIGNvbnN0IHRhcmdldERhdGEgPSBnZXRTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgdGFyZ2V0KTtcbiAgaWYgKCFzb3VyY2VEYXRhIHx8ICF0YXJnZXREYXRhIHx8IHNvdXJjZSA9PT0gdGFyZ2V0KSByZXR1cm47XG5cbiAgY29uc3QgdGFyZ2V0S2V5cyA9IG5ldyBNYXAoT2JqZWN0LmtleXModGFyZ2V0RGF0YS5mcm9udG1hdHRlcikubWFwKChrZXkpID0+IFtrZXkudG9Mb3dlckNhc2UoKSwga2V5XSkpO1xuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzb3VyY2VEYXRhLmZyb250bWF0dGVyKSkge1xuICAgIGlmIChrZXkgPT09IFwiXCIpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGV4aXN0aW5nID0gdGFyZ2V0S2V5cy5nZXQoa2V5LnRvTG93ZXJDYXNlKCkpO1xuICAgIGlmIChleGlzdGluZyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0YXJnZXREYXRhLmZyb250bWF0dGVyW2tleV0gPSB2YWx1ZTtcbiAgICAgIHRhcmdldEtleXMuc2V0KGtleS50b0xvd2VyQ2FzZSgpLCBrZXkpO1xuICAgICAgaWYgKHNvdXJjZURhdGEuZmxvYXRpbmdLZXlzLmluY2x1ZGVzKGtleSkgJiYgIXRhcmdldERhdGEuZmxvYXRpbmdLZXlzLmluY2x1ZGVzKGtleSkpIHRhcmdldERhdGEuZmxvYXRpbmdLZXlzLnB1c2goa2V5KTtcbiAgICAgIC8vIFRoZSBzaG9ydGN1dCBiZWxvbmdzIHRvIHRoZSBrZXkgYW5kIG1vdmVzIHdpdGggaXQuXG4gICAgICBjb25zdCBzaG9ydGN1dCA9IHNvdXJjZURhdGEuc2hvcnRjdXRzPy5ba2V5XTtcbiAgICAgIGlmIChzaG9ydGN1dCkgKHRhcmdldERhdGEuc2hvcnRjdXRzID8/PSB7fSlba2V5XSA9IHNob3J0Y3V0O1xuICAgIH0gZWxzZSBpZiAoaXNFbXB0eVZhbHVlKHRhcmdldERhdGEuZnJvbnRtYXR0ZXJbZXhpc3RpbmddKSkge1xuICAgICAgdGFyZ2V0RGF0YS5mcm9udG1hdHRlcltleGlzdGluZ10gPSB2YWx1ZTtcbiAgICB9XG4gIH1cbiAgZGVsZXRlU3VidHlwKHNldHRpbmdzLCB0eXAsIHNvdXJjZSk7XG59XG5cbi8vIFJld3JpdGVzIHRoZSBTVUJUWVAgb2YgZXZlcnkgbm90ZSB3aXRoIFRZUCBrZXkgYHR5cGAgYW5kIFNVQlRZUCBrZXkgb2xkS2V5XG4vLyB0byB0aGUgc2luZ2xlIHZhbHVlIG5ld1ZhbHVlIC0gbGlrZSByZW5hbWVUeXBJbk5vdGVzKCkgaW4gdHlwLXBhbmUuanMuXG5hc3luYyBmdW5jdGlvbiByZW5hbWVTdWJ0eXBJbk5vdGVzKHBsdWdpbiwgdHlwLCBvbGRLZXksIG5ld1ZhbHVlKSB7XG4gIGxldCBjaGFuZ2VkID0gMDtcbiAgZm9yIChjb25zdCBmaWxlIG9mIHBsdWdpbi50eXBJbmRleC5maWxlc1dpdGhTdWJ0eXAodHlwLCBvbGRLZXkpKSB7XG4gICAgbGV0IG1hdGNoZWQgPSBmYWxzZTtcbiAgICBhd2FpdCBwbHVnaW4uYXBwLmZpbGVNYW5hZ2VyLnByb2Nlc3NGcm9udE1hdHRlcihmaWxlLCAoZnJvbnRtYXR0ZXIpID0+IHtcbiAgICAgIGlmICh0eXBLZXlPZihwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBTVUJUWVBfUFJPUEVSVFkpKSAhPT0gb2xkS2V5KSByZXR1cm47XG4gICAgICBzZXRDYW5vbmljYWxQcm9wZXJ0eShmcm9udG1hdHRlciwgU1VCVFlQX1BST1BFUlRZLCBuZXdWYWx1ZSk7XG4gICAgICBtYXRjaGVkID0gdHJ1ZTtcbiAgICB9KTtcbiAgICBpZiAobWF0Y2hlZCkgY2hhbmdlZCsrO1xuICB9XG4gIHJldHVybiBjaGFuZ2VkO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgbm9ybWFsaXplU3VidHlwTmFtZSxcbiAgaXNFbXB0eVZhbHVlLFxuICBnZXRTdWJ0eXBOYW1lcyxcbiAgZ2V0U3VidHlwLFxuICBlbnN1cmVTdWJ0eXAsXG4gIGlzU3VidHlwTWFudWFsLFxuICBzZXRTdWJ0eXBNYW51YWwsXG4gIHNldEFsbFN1YnR5cHNNYW51YWwsXG4gIG1vdmVUeXBTdWJ0eXBzLFxuICBkZWxldGVUeXBTdWJ0eXBzLFxuICBtZXJnZVR5cFN1YnR5cHMsXG4gIHJlbmFtZVN1YnR5cCxcbiAgZ2V0U2VjdGlvbk9yZGVyLFxuICByZW9yZGVyU3VidHlwcyxcbiAgZGVsZXRlU3VidHlwLFxuICBtZXJnZVN1YnR5cHMsXG4gIHJlbmFtZVN1YnR5cEluTm90ZXMsXG59O1xuIiwgIi8vIFN0YXRlbGVzcyBoZWxwZXJzIGFyb3VuZCBUWVAgbmFtZXMsIHNvcnRpbmcgYW5kIG1lc3NhZ2UgdGV4dC5cblxuLy8gVFlQIG5hbWVzIHR5cGVkIGludG8gdGhlIGxpc3QgYXJlIGFsd2F5cyB1cHBlcmNhc2UuIFZhbHVlcyB3cml0dGVuIGRpcmVjdGx5XG4vLyBpbnRvIGEgbm90ZSdzIGZyb250bWF0dGVyIGFyZSBsZWZ0IGFsb25lIChzZWUgdGhlIHVucmVnaXN0ZXJlZCByb3dzIGluXG4vLyB0eXAtcGFuZS5qcykuXG5mdW5jdGlvbiBub3JtYWxpemVUeXBOYW1lKHJhdykge1xuICByZXR1cm4gcmF3LnRyaW0oKS50b1VwcGVyQ2FzZSgpO1xufVxuXG4vLyBcIjEgbm90ZVwiLCBcIjMgbm90ZXNcIi4gd29yZCBpcyB0aGUgRW5nbGlzaCBzaW5ndWxhcjsgaXJyZWd1bGFyIHBsdXJhbHMgYXJlXG4vLyBwYXNzZWQgZXhwbGljaXRseS5cbmZ1bmN0aW9uIHBsdXJhbChjb3VudCwgd29yZCwgcGx1cmFsV29yZCA9IGAke3dvcmR9c2ApIHtcbiAgcmV0dXJuIGAke2NvdW50fSAke2NvdW50ID09PSAxID8gd29yZCA6IHBsdXJhbFdvcmR9YDtcbn1cblxuLy8gXCJhXCIsIFwiYSBhbmQgYlwiLCBcImEsIGIgYW5kIGNcIi5cbmZ1bmN0aW9uIGpvaW5BbmQocGFydHMpIHtcbiAgcmV0dXJuIHBhcnRzLmxlbmd0aCA8PSAxID8gcGFydHMuam9pbihcIlwiKSA6IGAke3BhcnRzLnNsaWNlKDAsIC0xKS5qb2luKFwiLCBcIil9IGFuZCAke3BhcnRzW3BhcnRzLmxlbmd0aCAtIDFdfWA7XG59XG5cbi8vIEh1ZSAoMC0zNjBcdTAwQjApIG9mIGEgaGV4IGNvbG9yLCBzbyBjb2xvcnMgc29ydCBhbG9uZyB0aGUgc3BlY3RydW0gaW5zdGVhZCBvZiBieVxuLy8gaGV4IHN0cmluZy4gQWNocm9tYXRpYyBjb2xvcnMgKGdyYXkvYmxhY2svd2hpdGUpIGhhdmUgbm8gaHVlIGFuZCByZXR1cm4gbnVsbDtcbi8vIGNvbXBhcmVUeXBzIGtlZXBzIHRoZW0gbGFzdCBpbiBib3RoIGRpcmVjdGlvbnMuXG5mdW5jdGlvbiBoZXhUb0h1ZShoZXgpIHtcbiAgY29uc3QgbWF0Y2ggPSAvXiM/KFswLTlhLWZdezZ9KSQvaS5leGVjKGhleCA/PyBcIlwiKTtcbiAgaWYgKCFtYXRjaCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGludCA9IHBhcnNlSW50KG1hdGNoWzFdLCAxNik7XG4gIGNvbnN0IHIgPSAoKGludCA+PiAxNikgJiAyNTUpIC8gMjU1O1xuICBjb25zdCBnID0gKChpbnQgPj4gOCkgJiAyNTUpIC8gMjU1O1xuICBjb25zdCBiID0gKGludCAmIDI1NSkgLyAyNTU7XG4gIGNvbnN0IG1heCA9IE1hdGgubWF4KHIsIGcsIGIpO1xuICBjb25zdCBtaW4gPSBNYXRoLm1pbihyLCBnLCBiKTtcbiAgY29uc3QgZGVsdGEgPSBtYXggLSBtaW47XG4gIGlmIChkZWx0YSA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgbGV0IGh1ZTtcbiAgaWYgKG1heCA9PT0gcikgaHVlID0gKChnIC0gYikgLyBkZWx0YSkgJSA2O1xuICBlbHNlIGlmIChtYXggPT09IGcpIGh1ZSA9IChiIC0gcikgLyBkZWx0YSArIDI7XG4gIGVsc2UgaHVlID0gKHIgLSBnKSAvIGRlbHRhICsgNDtcbiAgaHVlICo9IDYwO1xuICByZXR1cm4gaHVlIDwgMCA/IGh1ZSArIDM2MCA6IGh1ZTtcbn1cblxuLy8gU2hhcmVkIGNvbXBhcmlzb24gZm9yIFRZUCBhbmQgU1VCVFlQIGxpc3RzLiB0eXBDb2xvcnMgbWF5IGJlIGVtcHR5IChhIFN1YnR5cFxuLy8gaGFzIG5vIGNvbG9yIG9mIGl0cyBvd24pOyB0aGUgXCJjb2xvclwiIG1vZGUgaXMgdGhlbiBuZXZlciBzZWxlY3RlZC5cbmZ1bmN0aW9uIGNvbXBhcmVUeXBzKG1vZGUsIGEsIGIsIGNvdW50cywgdHlwQ29sb3JzKSB7XG4gIGNvbnN0IFtrZXksIGRpcl0gPSBtb2RlLnNwbGl0KFwiLVwiKTtcbiAgbGV0IGNtcDtcbiAgaWYgKGtleSA9PT0gXCJjb3VudFwiKSB7XG4gICAgY21wID0gKGNvdW50cy5nZXQoYSkgPz8gMCkgLSAoY291bnRzLmdldChiKSA/PyAwKTtcbiAgICBpZiAoZGlyID09PSBcImRlc2NcIikgY21wID0gLWNtcDtcbiAgfSBlbHNlIGlmIChrZXkgPT09IFwiY29sb3JcIikge1xuICAgIGNvbnN0IGh1ZUEgPSBoZXhUb0h1ZSh0eXBDb2xvcnNbYV0gPz8gbnVsbCk7XG4gICAgY29uc3QgaHVlQiA9IGhleFRvSHVlKHR5cENvbG9yc1tiXSA/PyBudWxsKTtcbiAgICAvLyBBY2hyb21hdGljIGNvbG9ycyBzdGF5IGF0IHRoZSBlbmQgaW4gYm90aCBkaXJlY3Rpb25zLlxuICAgIGlmIChodWVBID09PSBudWxsICYmIGh1ZUIgPT09IG51bGwpIGNtcCA9IDA7XG4gICAgZWxzZSBpZiAoaHVlQSA9PT0gbnVsbCkgY21wID0gMTtcbiAgICBlbHNlIGlmIChodWVCID09PSBudWxsKSBjbXAgPSAtMTtcbiAgICBlbHNlIHtcbiAgICAgIGNtcCA9IGh1ZUEgLSBodWVCO1xuICAgICAgaWYgKGRpciA9PT0gXCJkZXNjXCIpIGNtcCA9IC1jbXA7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIGNtcCA9IGEubG9jYWxlQ29tcGFyZShiKTtcbiAgICBpZiAoZGlyID09PSBcImRlc2NcIikgY21wID0gLWNtcDtcbiAgfVxuICByZXR1cm4gY21wIHx8IGEubG9jYWxlQ29tcGFyZShiKTtcbn1cblxuLy8gXCJtYW51YWxcIiBrZWVwcyB0aGUgZ2l2ZW4gb3JkZXI6IGl0IGlzIHRoZSBzdG9yZWQgb3JkZXIgKHNldHRpbmdzLnR5cHMsXG4vLyByZWFycmFuZ2VkIGJ5IGRyYWcgJiBkcm9wKSwgd2hpY2ggbm8gcGFpcndpc2UgY29tcGFyaXNvbiBjb3VsZCBkZXJpdmUuXG4vLyBVc2VkIGJ5IG1haW4uanMgKGdldFR5cHMpIGFuZCB0eXAtcGFuZS5qcyBzbyBib3RoIHNob3cgdGhlIHNhbWUgb3JkZXIuXG5mdW5jdGlvbiBzb3J0VHlwc0J5TW9kZSh0eXBzLCBtb2RlLCBjb3VudHMsIHR5cENvbG9ycykge1xuICBpZiAobW9kZSA9PT0gXCJtYW51YWxcIikgcmV0dXJuIFsuLi50eXBzXTtcbiAgcmV0dXJuIFsuLi50eXBzXS5zb3J0KChhLCBiKSA9PiBjb21wYXJlVHlwcyhtb2RlLCBhLCBiLCBjb3VudHMsIHR5cENvbG9ycykpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgbm9ybWFsaXplVHlwTmFtZSwgcGx1cmFsLCBqb2luQW5kLCBoZXhUb0h1ZSwgY29tcGFyZVR5cHMsIHNvcnRUeXBzQnlNb2RlIH07XG4iLCAiY29uc3QgeyBOb3RpY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgZ2V0U3VidHlwIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBzXCIpO1xuY29uc3QgeyB0eXBLZXlPZiwgcHJvcGVydHlWYWx1ZSwgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcbmNvbnN0IHsgcGx1cmFsIH0gPSByZXF1aXJlKFwiLi90eXAtdXRpbHNcIik7XG5cbi8vIFRoZSBmb3VyIHBsYWNlaG9sZGVycyBvZiB0aGUgZ2xvYmFsIG9yZGVyOyB0aGUgb3JkZXIgZWRpdG9yIGxldHMgeW91IG1vdmVcbi8vIHRoZW0gYnV0IG5vdCByZW1vdmUgdGhlbS4gXCJ0eXBWYWx1ZVwiIGlzIHRoZSBUWVAgcHJvcGVydHkgaXRzZWxmLFxuLy8gXCJzdWJ0eXBWYWx1ZVwiIHRoZSBTVUJUWVAgcHJvcGVydHksIFwidHlwXCIgdGhlIFRZUC1Gcm9udG1hdHRlciBsaXN0LFxuLy8gXCJvdGhlclwiIGV2ZXJ5dGhpbmcgZWxzZS5cbmNvbnN0IERFRkFVTFRfR0xPQkFMX09SREVSID0gW3sga2luZDogXCJ0eXBWYWx1ZVwiIH0sIHsga2luZDogXCJzdWJ0eXBWYWx1ZVwiIH0sIHsga2luZDogXCJ0eXBcIiB9LCB7IGtpbmQ6IFwib3RoZXJcIiB9XTtcblxuLy8gRW5zdXJlcyBleGFjdGx5IG9uZSBlbnRyeSBwZXIgcGxhY2Vob2xkZXIuIE9sZGVyIHNhdmVkIG9yZGVycyBwcmVkYXRlIHNvbWVcbi8vIG9mIHRoZW07IG1pc3Npbmcgb25lcyBhcmUgYWRkZWQgYXQgYSBzZW5zaWJsZSBzcG90IChcInN1YnR5cFZhbHVlXCIgcmlnaHRcbi8vIGFmdGVyIFwidHlwVmFsdWVcIiwgdGhlIG90aGVycyBhdCB0aGUgZWRnZXMpIHdpdGhvdXQgdG91Y2hpbmcgdGhlIG9yZGVyIHRoZVxuLy8gdXNlciBhcnJhbmdlZC5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUdsb2JhbE9yZGVyKG9yZGVyKSB7XG4gIGNvbnN0IHJlc3VsdCA9IEFycmF5LmlzQXJyYXkob3JkZXIpID8gb3JkZXIuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkgJiYgdHlwZW9mIGVudHJ5ID09PSBcIm9iamVjdFwiKSA6IFtdO1xuICBjb25zdCBoYXNLaW5kID0gKGtpbmQpID0+IHJlc3VsdC5zb21lKChlbnRyeSkgPT4gZW50cnkua2luZCA9PT0ga2luZCk7XG4gIGlmICghaGFzS2luZChcInR5cFZhbHVlXCIpKSByZXN1bHQudW5zaGlmdCh7IGtpbmQ6IFwidHlwVmFsdWVcIiB9KTtcbiAgaWYgKCFoYXNLaW5kKFwic3VidHlwVmFsdWVcIikpIHtcbiAgICBjb25zdCB0eXBWYWx1ZUluZGV4ID0gcmVzdWx0LmZpbmRJbmRleCgoZW50cnkpID0+IGVudHJ5LmtpbmQgPT09IFwidHlwVmFsdWVcIik7XG4gICAgcmVzdWx0LnNwbGljZSh0eXBWYWx1ZUluZGV4ICsgMSwgMCwgeyBraW5kOiBcInN1YnR5cFZhbHVlXCIgfSk7XG4gIH1cbiAgaWYgKCFoYXNLaW5kKFwidHlwXCIpKSByZXN1bHQucHVzaCh7IGtpbmQ6IFwidHlwXCIgfSk7XG4gIGlmICghaGFzS2luZChcIm90aGVyXCIpKSByZXN1bHQucHVzaCh7IGtpbmQ6IFwib3RoZXJcIiB9KTtcbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gKiBGcm9udG1hdHRlciBzb3J0aW5nXG4gKiBQdXRzIHRoZSBwcm9wZXJ0aWVzIGEgbm90ZSBIQVMgaW50byBhIGZpeGVkIG9yZGVyIGJ1aWx0IGZyb21cbiAqIGdsb2JhbFByb3BlcnR5T3JkZXI6IHBpbm5lZCBzaW5nbGUgcHJvcGVydGllcywgdGhlIFRZUCBhbmRcbiAqIFNVQlRZUCBwcm9wZXJ0aWVzLCB0aGUgXCJUWVAtRnJvbnRtYXR0ZXJcIiBibG9jayAodGhlIFRZUCdzIGxpc3RcbiAqIGZvbGxvd2VkIGJ5IGl0cyBTdWJ0eXAgYmxvY2spIGFuZCBcIk90aGVyIHByb3BlcnRpZXNcIi4gTmV2ZXIgYWRkc1xuICogcHJvcGVydGllcyBvciBjaGFuZ2VzIHZhbHVlcy5cbiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqL1xuXG4vLyBLZXkgb3JkZXIgb2YgYSBUWVAncyBmcm9udG1hdHRlciwgZmxvYXRpbmcga2V5cyBpbmNsdWRlZCBhdCB0aGVpciBsaXN0XG4vLyBwb3NpdGlvbiAoZ2V0VHlwRGVmYXVsdHMgbGVhdmVzIHRoZW0gb3V0LCBidXQgYSBub3RlIHRoYXQgaGFzIG9uZSBzaG91bGRcbi8vIHN0aWxsIGdldCBpdCBpbiBwbGFjZSkuIFdpdGhvdXQgVFlQL1NVQlRZUCBhbmQgdGhlIGVkaXRvcidzIGJsYW5rIHJvdy5cbi8vIG51bGwgaWYgdGhlcmUgaXMgbm8gVFlQIG9yIG5vIGxpc3QuXG4vL1xuLy8gV2l0aCBzdWJ0eXAsIHRoZSBrZXlzIG9mIGl0cyBibG9jayBmb2xsb3cuIEEga2V5IGluIEJPVEggYmxvY2tzIGtlZXBzIHRoZVxuLy8gVFlQLUZyb250bWF0dGVyIHBvc2l0aW9uIC0gdGhlIHNhbWUgcnVsZSBhcyBjb2xsZWN0QmxvY2tzIGluIG1haW4uanMsIG9yIGFcbi8vIGZyZXNobHkgY3JlYXRlZCBub3RlIHdvdWxkIGJlIHJlLXNvcnRlZCByaWdodCBhd2F5LlxuZnVuY3Rpb24gb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgdHlwLCBzdWJ0eXAgPSBudWxsKSB7XG4gIGlmICghdHlwKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgaXNTeXN0ZW1LZXkgPSAoa2V5KSA9PiBrZXkgPT09IFwiXCIgfHwgW1RZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZXS5zb21lKChwKSA9PiBrZXkudG9Mb3dlckNhc2UoKSA9PT0gcC50b0xvd2VyQ2FzZSgpKTtcbiAgY29uc3Qgc3VidHlwRGF0YSA9IHN1YnR5cCA/IGdldFN1YnR5cChwbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKSA6IG51bGw7XG4gIGNvbnN0IGJsb2NrcyA9IFtwbHVnaW4uc2V0dGluZ3MudHlwRGVmYXVsdEZyb250bWF0dGVyW3R5cF0sIHN1YnR5cERhdGE/LmZyb250bWF0dGVyXTtcbiAgY29uc3Qga2V5cyA9IFtdO1xuICBjb25zdCBzZWVuID0gbmV3IFNldCgpO1xuICBmb3IgKGNvbnN0IGJsb2NrIG9mIGJsb2Nrcykge1xuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGJsb2NrID8/IHt9KSkge1xuICAgICAgaWYgKGlzU3lzdGVtS2V5KGtleSkgfHwgc2Vlbi5oYXMoa2V5LnRvTG93ZXJDYXNlKCkpKSBjb250aW51ZTtcbiAgICAgIGtleXMucHVzaChrZXkpO1xuICAgICAgc2Vlbi5hZGQoa2V5LnRvTG93ZXJDYXNlKCkpO1xuICAgIH1cbiAgfVxuICByZXR1cm4ga2V5cy5sZW5ndGggPiAwID8ga2V5cyA6IG51bGw7XG59XG5cbi8vIFRhcmdldCBvcmRlciBvZiBhIG5vdGUncyBleGlzdGluZyBwcm9wZXJ0aWVzLCBmdWxseSBkZWZpbmVkIGJ5IGdsb2JhbE9yZGVyLlxuLy9cbi8vIFdoaWNoIGJsb2NrIGNsYWltcyBhIHByb3BlcnR5IGlzIGRlY2lkZWQgQkVGT1JFIHRoZSBvcmRlciBpcyBidWlsdCAocGlubmVkLFxuLy8gVFlQIGJsb2NrIGFuZCByZXN0IGFyZSBkaXNqb2ludCksIHNvIHRoZSByZXN1bHQgZG9lc24ndCBkZXBlbmQgb24gd2hlcmUgdGhlXG4vLyBibG9ja3Mgc2l0IGluIGdsb2JhbE9yZGVyOiBhIHBpbm5lZCBwcm9wZXJ0eSBuZXZlciBhbHNvIGxhbmRzIGluIHRoZSBUWVBcbi8vIGJsb2NrLCBhbmQgXCJvdGhlclwiIG9ubHkgZXZlciBob2xkcyB0cnVlIGxlZnRvdmVycy5cbmZ1bmN0aW9uIGNvbXB1dGVTb3J0ZWRLZXlzKGV4aXN0aW5nS2V5cywgZ2xvYmFsT3JkZXIsIHR5cERlZmF1bHRLZXlzKSB7XG4gIGNvbnN0IGxvd2VyVG9BY3R1YWwgPSBuZXcgTWFwKGV4aXN0aW5nS2V5cy5tYXAoKGtleSkgPT4gW2tleS50b0xvd2VyQ2FzZSgpLCBrZXldKSk7XG4gIGNvbnN0IHJlc29sdmUgPSAobmFtZSkgPT4gbG93ZXJUb0FjdHVhbC5nZXQobmFtZS50b0xvd2VyQ2FzZSgpKTtcblxuICBjb25zdCBwaW5uZWQgPSBuZXcgU2V0KFxuICAgIGdsb2JhbE9yZGVyXG4gICAgICAuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkua2luZCA9PT0gXCJwcm9wZXJ0eVwiKVxuICAgICAgLm1hcCgoZW50cnkpID0+IHJlc29sdmUoZW50cnkubmFtZSkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICk7XG4gIGNvbnN0IHR5cEtleSA9IHJlc29sdmUoVFlQX1BST1BFUlRZKTtcbiAgY29uc3Qgc3VidHlwS2V5ID0gcmVzb2x2ZShTVUJUWVBfUFJPUEVSVFkpO1xuICBjb25zdCB0eXBCbG9ja0tleXMgPSBuZXcgU2V0KFxuICAgICh0eXBEZWZhdWx0S2V5cyA/PyBbXSkubWFwKHJlc29sdmUpLmZpbHRlcigoa2V5KSA9PiBrZXkgJiYga2V5ICE9PSB0eXBLZXkgJiYgIXBpbm5lZC5oYXMoa2V5KSlcbiAgKTtcbiAgY29uc3QgY2xhaW1lZCA9IG5ldyBTZXQocGlubmVkKTtcbiAgZm9yIChjb25zdCBrZXkgb2YgdHlwQmxvY2tLZXlzKSBjbGFpbWVkLmFkZChrZXkpO1xuICBpZiAodHlwS2V5KSBjbGFpbWVkLmFkZCh0eXBLZXkpO1xuICBpZiAoc3VidHlwS2V5KSBjbGFpbWVkLmFkZChzdWJ0eXBLZXkpO1xuXG4gIGNvbnN0IHNvcnRlZEtleXMgPSBbXTtcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQoKTtcbiAgY29uc3QgcHVzaCA9IChrZXkpID0+IHtcbiAgICBpZiAoa2V5ICYmICFzZWVuLmhhcyhrZXkpKSB7XG4gICAgICBzb3J0ZWRLZXlzLnB1c2goa2V5KTtcbiAgICAgIHNlZW4uYWRkKGtleSk7XG4gICAgfVxuICB9O1xuXG4gIGZvciAoY29uc3QgZW50cnkgb2YgZ2xvYmFsT3JkZXIpIHtcbiAgICBpZiAoZW50cnkua2luZCA9PT0gXCJwcm9wZXJ0eVwiKSBwdXNoKHJlc29sdmUoZW50cnkubmFtZSkpO1xuICAgIGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwidHlwVmFsdWVcIikgcHVzaCh0eXBLZXkpO1xuICAgIGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwic3VidHlwVmFsdWVcIikgcHVzaChzdWJ0eXBLZXkpO1xuICAgIGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwidHlwXCIpIHtcbiAgICAgIGZvciAoY29uc3QgbmFtZSBvZiB0eXBEZWZhdWx0S2V5cyA/PyBbXSkge1xuICAgICAgICBjb25zdCBrZXkgPSByZXNvbHZlKG5hbWUpO1xuICAgICAgICBpZiAoa2V5ICYmIHR5cEJsb2NrS2V5cy5oYXMoa2V5KSkgcHVzaChrZXkpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoZW50cnkua2luZCA9PT0gXCJvdGhlclwiKSB7XG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBleGlzdGluZ0tleXMpIHtcbiAgICAgICAgaWYgKCFjbGFpbWVkLmhhcyhrZXkpKSBwdXNoKGtleSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gU2FmZXR5IG5ldCBmb3IgYW4gaW5jb21wbGV0ZSBnbG9iYWxPcmRlciAoY29ycnVwdCBzZXR0aW5ncykuXG4gIGZvciAoY29uc3Qga2V5IG9mIGV4aXN0aW5nS2V5cykgcHVzaChrZXkpO1xuICByZXR1cm4gc29ydGVkS2V5cztcbn1cblxuLy8gXCJwb3NpdGlvblwiIGlzIE9ic2lkaWFuJ3MgbG9jYXRpb24gb2YgdGhlIGZyb250bWF0dGVyIGJsb2NrLCBwcmVzZW50IG9ubHkgaW5cbi8vIHRoZSBjYWNoZSBvYmplY3QsIG5vdCBhIHByb3BlcnR5LlxuZnVuY3Rpb24gY2FjaGVkRnJvbnRtYXR0ZXJLZXlzKGFwcCwgZmlsZSkge1xuICBjb25zdCBmcm9udG1hdHRlciA9IGFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXI7XG4gIGlmICghZnJvbnRtYXR0ZXIpIHJldHVybiBudWxsO1xuICByZXR1cm4gT2JqZWN0LmtleXMoZnJvbnRtYXR0ZXIpLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwicG9zaXRpb25cIik7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNvcnRGaWxlRnJvbnRtYXR0ZXIoYXBwLCBmaWxlLCBnbG9iYWxPcmRlciwgdHlwRGVmYXVsdEtleXMpIHtcbiAgLy8gQ2hlYXAgcHJlLWNoZWNrIGFnYWluc3QgdGhlIGluLW1lbW9yeSBjYWNoZTogbW9zdCBub3RlcyBhcmUgYWxyZWFkeVxuICAvLyBzb3J0ZWQsIGFuZCB0aGlzIHNraXBzIG9wZW5pbmcgdGhlbSBhdCBhbGwgLSB0aGF0IGlzIHdoZXJlIHJlcGVhdGVkIHZhdWx0XG4gIC8vIHJ1bnMgZ2V0IHRoZWlyIHNwZWVkLiBwcm9jZXNzRnJvbnRNYXR0ZXIgc3RheXMgdGhlIHNvdXJjZSBvZiB0cnV0aCBmb3IgdGhlXG4gIC8vIGFjdHVhbCB3cml0ZSwgc2luY2UgdGhlIGNhY2hlIGNhbiBsYWcgYmVoaW5kLlxuICBjb25zdCBjYWNoZWRLZXlzID0gY2FjaGVkRnJvbnRtYXR0ZXJLZXlzKGFwcCwgZmlsZSk7XG4gIGlmICghY2FjaGVkS2V5cyB8fCBjYWNoZWRLZXlzLmxlbmd0aCA8PSAxKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IGNhY2hlZFNvcnRlZCA9IGNvbXB1dGVTb3J0ZWRLZXlzKGNhY2hlZEtleXMsIGdsb2JhbE9yZGVyLCB0eXBEZWZhdWx0S2V5cyk7XG4gIGlmIChjYWNoZWRTb3J0ZWQuZXZlcnkoKGtleSwgaSkgPT4ga2V5ID09PSBjYWNoZWRLZXlzW2ldKSkgcmV0dXJuIGZhbHNlO1xuXG4gIGxldCBjaGFuZ2VkID0gZmFsc2U7XG4gIGF3YWl0IGFwcC5maWxlTWFuYWdlci5wcm9jZXNzRnJvbnRNYXR0ZXIoZmlsZSwgKGZyb250bWF0dGVyKSA9PiB7XG4gICAgY2hhbmdlZCA9IHNvcnRGcm9udG1hdHRlck9iamVjdChmcm9udG1hdHRlciwgZ2xvYmFsT3JkZXIsIHR5cERlZmF1bHRLZXlzKTtcbiAgfSk7XG4gIHJldHVybiBjaGFuZ2VkO1xufVxuXG4vLyBTb3J0cyB0aGUgcHJvY2Vzc0Zyb250TWF0dGVyIG9iamVjdCBpbiBwbGFjZTogaW5zZXJ0aW9uIG9yZGVyIGJlY29tZXMgdGhlXG4vLyBZQU1MIG9yZGVyLCBzbyBhbGwga2V5cyBhcmUgZGVsZXRlZCBhbmQgcmUtYWRkZWQuIFJldHVybnMgdHJ1ZSBvbiBhIGNoYW5nZS5cbmZ1bmN0aW9uIHNvcnRGcm9udG1hdHRlck9iamVjdChmcm9udG1hdHRlciwgZ2xvYmFsT3JkZXIsIHR5cERlZmF1bHRLZXlzKSB7XG4gIGNvbnN0IGV4aXN0aW5nS2V5cyA9IE9iamVjdC5rZXlzKGZyb250bWF0dGVyKTtcbiAgaWYgKGV4aXN0aW5nS2V5cy5sZW5ndGggPD0gMSkgcmV0dXJuIGZhbHNlO1xuXG4gIGNvbnN0IHNvcnRlZEtleXMgPSBjb21wdXRlU29ydGVkS2V5cyhleGlzdGluZ0tleXMsIGdsb2JhbE9yZGVyLCB0eXBEZWZhdWx0S2V5cyk7XG4gIGlmIChzb3J0ZWRLZXlzLmV2ZXJ5KChrZXksIGkpID0+IGtleSA9PT0gZXhpc3RpbmdLZXlzW2ldKSkgcmV0dXJuIGZhbHNlO1xuXG4gIGNvbnN0IHNuYXBzaG90ID0geyAuLi5mcm9udG1hdHRlciB9O1xuICBmb3IgKGNvbnN0IGtleSBvZiBleGlzdGluZ0tleXMpIGRlbGV0ZSBmcm9udG1hdHRlcltrZXldO1xuICBmb3IgKGNvbnN0IGtleSBvZiBzb3J0ZWRLZXlzKSBmcm9udG1hdHRlcltrZXldID0gc25hcHNob3Rba2V5XTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbi8vIEZvciBjYWxsZXJzIGFscmVhZHkgaW5zaWRlIHByb2Nlc3NGcm9udE1hdHRlciAoVFlQLmpzKTogVFlQIGFuZCBTdWJ0eXAgYXJlXG4vLyBwYXNzZWQgZXhwbGljaXRseSwgYmVjYXVzZSBpbmRleCBhbmQgY2FjaGUgZG9uJ3Qga25vdyB0aGUgdmFsdWVzIGp1c3Rcbi8vIHdyaXR0ZW4geWV0LlxuZnVuY3Rpb24gc29ydEZyb250bWF0dGVyRm9yKHBsdWdpbiwgZnJvbnRtYXR0ZXIsIHR5cCwgc3VidHlwKSB7XG4gIGNvbnN0IGdsb2JhbE9yZGVyID0gbm9ybWFsaXplR2xvYmFsT3JkZXIocGx1Z2luLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIpO1xuICByZXR1cm4gc29ydEZyb250bWF0dGVyT2JqZWN0KGZyb250bWF0dGVyLCBnbG9iYWxPcmRlciwgb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgdHlwLCBzdWJ0eXApKTtcbn1cblxuLy8gTW92ZXMgb25seSBga2V5YCB0byBpdHMgc29ydGVkIHBsYWNlIGFuZCBsZWF2ZXMgZXZlcnkgb3RoZXIga2V5IHdoZXJlIGl0IGlzXG4vLyAtIGZvciBjYWxsZXJzIHRoYXQganVzdCBhZGRlZCBhIHByb3BlcnR5IChGcmVkJ3MgcHJvcGVydHkgYmFja2xpbmtpbmcpIGFuZFxuLy8gc2hvdWxkbid0IHJlc2h1ZmZsZSBhIGRlbGliZXJhdGVseSBkaWZmZXJlbnQgb3JkZXIuIFRZUC9TVUJUWVAgYXJlIHJlYWQgZnJvbVxuLy8gdGhlIG9iamVjdCBpdHNlbGY7IGluZGV4IGFuZCBjYWNoZSBtYXkgc3RpbGwgYmUgYmVoaW5kLlxuLy9cbi8vIFRoZSBwbGFjZSBpcyByaWdodCBhZnRlciBrZXkncyBuZWFyZXN0IHByZWRlY2Vzc29yIGluIHRoZSBmdWxseSBzb3J0ZWRcbi8vIG9yZGVyIChmaXJzdCBpZiB0aGVyZSBpcyBub25lKS4gUmV0dXJucyB0cnVlIG9uIGEgY2hhbmdlLlxuZnVuY3Rpb24gcGxhY2VQcm9wZXJ0eUZvcihwbHVnaW4sIGZyb250bWF0dGVyLCBrZXkpIHtcbiAgY29uc3QgZXhpc3RpbmdLZXlzID0gT2JqZWN0LmtleXMoZnJvbnRtYXR0ZXIpO1xuICBjb25zdCBhY3R1YWxLZXkgPSBleGlzdGluZ0tleXMuZmluZCgoaykgPT4gay50b0xvd2VyQ2FzZSgpID09PSBrZXkudG9Mb3dlckNhc2UoKSk7XG4gIGlmICghYWN0dWFsS2V5IHx8IGV4aXN0aW5nS2V5cy5sZW5ndGggPD0gMSkgcmV0dXJuIGZhbHNlO1xuXG4gIGNvbnN0IGdsb2JhbE9yZGVyID0gbm9ybWFsaXplR2xvYmFsT3JkZXIocGx1Z2luLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIpO1xuICBjb25zdCB0eXAgPSB0eXBLZXlPZihwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBUWVBfUFJPUEVSVFkpKTtcbiAgY29uc3Qgc3VidHlwID0gdHlwS2V5T2YocHJvcGVydHlWYWx1ZShmcm9udG1hdHRlciwgU1VCVFlQX1BST1BFUlRZKSk7XG4gIGNvbnN0IHNvcnRlZEtleXMgPSBjb21wdXRlU29ydGVkS2V5cyhleGlzdGluZ0tleXMsIGdsb2JhbE9yZGVyLCBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCB0eXAsIHN1YnR5cCkpO1xuXG4gIGNvbnN0IHJlc3QgPSBleGlzdGluZ0tleXMuZmlsdGVyKChrKSA9PiBrICE9PSBhY3R1YWxLZXkpO1xuICBjb25zdCBwcmVkZWNlc3NvciA9IHNvcnRlZEtleXMuc2xpY2UoMCwgc29ydGVkS2V5cy5pbmRleE9mKGFjdHVhbEtleSkpLnBvcCgpO1xuICBjb25zdCBuZXdLZXlzID0gWy4uLnJlc3RdO1xuICBuZXdLZXlzLnNwbGljZShwcmVkZWNlc3NvciA9PT0gdW5kZWZpbmVkID8gMCA6IHJlc3QuaW5kZXhPZihwcmVkZWNlc3NvcikgKyAxLCAwLCBhY3R1YWxLZXkpO1xuICBpZiAobmV3S2V5cy5ldmVyeSgoaywgaSkgPT4gayA9PT0gZXhpc3RpbmdLZXlzW2ldKSkgcmV0dXJuIGZhbHNlO1xuXG4gIGNvbnN0IHNuYXBzaG90ID0geyAuLi5mcm9udG1hdHRlciB9O1xuICBmb3IgKGNvbnN0IGsgb2YgZXhpc3RpbmdLZXlzKSBkZWxldGUgZnJvbnRtYXR0ZXJba107XG4gIGZvciAoY29uc3QgayBvZiBuZXdLZXlzKSBmcm9udG1hdHRlcltrXSA9IHNuYXBzaG90W2tdO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc29ydFNpbmdsZUZpbGVGcm9udG1hdHRlcihhcHAsIHBsdWdpbiwgZmlsZSkge1xuICBjb25zdCBnbG9iYWxPcmRlciA9IG5vcm1hbGl6ZUdsb2JhbE9yZGVyKHBsdWdpbi5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyKTtcbiAgLy8gQW4gdW5jbGVhbiBUWVAgdmFsdWUgKGxpc3QsIHBhZGRlZCkgaGFzIG5vIFRZUC1Gcm9udG1hdHRlcjsgb25seSB0aGUgZ2xvYmFsXG4gIC8vIG9yZGVyIGFwcGxpZXMgdGhlbiAoc2VlIHR5cEtleU9mIGluIHR5cC1pbmRleC5qcykuXG4gIGNvbnN0IHR5cCA9IHBsdWdpbi50eXBJbmRleC50eXBPZihmaWxlKTtcbiAgY29uc3QgdHlwRGVmYXVsdEtleXMgPSBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCB0eXAsIHBsdWdpbi50eXBJbmRleC5zdWJ0eXBPZihmaWxlKSk7XG4gIHJldHVybiBzb3J0RmlsZUZyb250bWF0dGVyKGFwcCwgZmlsZSwgZ2xvYmFsT3JkZXIsIHR5cERlZmF1bHRLZXlzKTtcbn1cblxuLy8gb25seVR5cCAob3B0aW9uYWwpIGxpbWl0cyB0aGUgcnVuIHRvIG5vdGVzIG9mIHRoYXQgVFlQLiBXaXRob3V0IGl0IGV2ZXJ5XG4vLyBub3RlIGlzIGNoZWNrZWQsIGluY2x1ZGluZyBub3RlcyB3aXRob3V0IGEgVFlQOiBwaW5uZWQgcHJvcGVydGllcyBzdWNoIGFzXG4vLyBjc3NjbGFzc2VzIGFwcGx5IHJlZ2FyZGxlc3Mgb2YgVFlQLlxuYXN5bmMgZnVuY3Rpb24gc29ydEFsbEZyb250bWF0dGVyKGFwcCwgcGx1Z2luLCBvbmx5VHlwKSB7XG4gIGxldCBjaGVja2VkID0gMDtcbiAgbGV0IGNoYW5nZWQgPSAwO1xuICBjb25zdCBnbG9iYWxPcmRlciA9IG5vcm1hbGl6ZUdsb2JhbE9yZGVyKHBsdWdpbi5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyKTtcbiAgLy8gT25seSBtZWFuaW5nZnVsIGZvciBhIHNpbmdsZSBUWVA6IGxldHMgdGhlIGNvbW1hbmQgZXhwbGFpbiBhIHJ1biB0aGF0XG4gIC8vIGNoYW5nZWQgbm90aGluZyBiZWNhdXNlIHRoZSBUWVAgaGFzIG5vIFRZUC1Gcm9udG1hdHRlci5cbiAgY29uc3QgaGFzVHlwRGVmYXVsdHMgPSBvbmx5VHlwID8gb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgb25seVR5cCkgIT09IG51bGwgOiBudWxsO1xuXG4gIGZvciAoY29uc3QgZmlsZSBvZiBhcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpKSB7XG4gICAgaWYgKCFwbHVnaW4uc2V0dGluZ3MuaW5jbHVkZUlnbm9yZWRGaWxlcyAmJiBhcHAubWV0YWRhdGFDYWNoZS5pc1VzZXJJZ25vcmVkKGZpbGUucGF0aCkpIGNvbnRpbnVlO1xuXG4gICAgY29uc3QgdHlwID0gcGx1Z2luLnR5cEluZGV4LnR5cE9mKGZpbGUpO1xuICAgIGlmIChvbmx5VHlwICYmIHR5cCAhPT0gb25seVR5cCkgY29udGludWU7XG5cbiAgICBjb25zdCB0eXBEZWZhdWx0S2V5cyA9IG9yZGVyZWREZWZhdWx0S2V5cyhwbHVnaW4sIHR5cCwgcGx1Z2luLnR5cEluZGV4LnN1YnR5cE9mKGZpbGUpKTtcbiAgICBjaGVja2VkKys7XG4gICAgaWYgKGF3YWl0IHNvcnRGaWxlRnJvbnRtYXR0ZXIoYXBwLCBmaWxlLCBnbG9iYWxPcmRlciwgdHlwRGVmYXVsdEtleXMpKSBjaGFuZ2VkKys7XG4gIH1cblxuICByZXR1cm4geyBjaGVja2VkLCBjaGFuZ2VkLCBoYXNUeXBEZWZhdWx0cyB9O1xufVxuXG4vLyBTb3J0cyBldmVyeSBub3RlIG9mIG9uZSBUWVAgYW5kIHJlcG9ydHMgaXQgaW4gYSBub3RpY2UgLSB0aGUgY29tbWFuZCBcIlNvcnRcbi8vIGZyb250bWF0dGVyIGZvciBvbmUgVFlQXCIgKGFmdGVyIGl0cyBwaWNrZXIpIGFuZCB0aGUgVFlQLVBhbmUncyBjb250ZXh0IG1lbnVcbi8vICh3aXRoIHRoZSBUWVAgb2YgdGhlIHJvdykuXG5hc3luYyBmdW5jdGlvbiBzb3J0VHlwRnJvbnRtYXR0ZXIocGx1Z2luLCB0eXApIHtcbiAgY29uc3QgeyBjaGVja2VkLCBjaGFuZ2VkLCBoYXNUeXBEZWZhdWx0cyB9ID0gYXdhaXQgc29ydEFsbEZyb250bWF0dGVyKHBsdWdpbi5hcHAsIHBsdWdpbiwgdHlwKTtcbiAgbGV0IG1lc3NhZ2UgPSBzb3J0U3VtbWFyeShgRnJvbnRtYXR0ZXIgc29ydGluZyAke3R5cH1gLCBjaGVja2VkLCBjaGFuZ2VkKTtcbiAgLy8gTm90IGFuIGVycm9yLCBidXQgZXhwbGFpbnMgd2h5IG5vdGhpbmcgbWF5IGhhdmUgY2hhbmdlZC5cbiAgaWYgKGhhc1R5cERlZmF1bHRzID09PSBmYWxzZSkge1xuICAgIG1lc3NhZ2UgKz0gYCBOb3RlOiAke3R5cH0gaGFzIG5vIFRZUC1Gcm9udG1hdHRlciwgc28gb25seSB0aGUgZ2xvYmFsIG9yZGVyIHdhcyBhcHBsaWVkLmA7XG4gIH1cbiAgbmV3IE5vdGljZShtZXNzYWdlKTtcbn1cblxuLy8gUmVzdWx0IG5vdGljZSBvZiBhIHNvcnRpbmcgcnVuLCBzaGFyZWQgYnkgdGhlIGNvbW1hbmRzIGFuZCB0aGUgcGxheSBidXR0b25cbi8vIG9mIHRoZSBnbG9iYWwgb3JkZXIuXG5mdW5jdGlvbiBzb3J0U3VtbWFyeShsYWJlbCwgY2hlY2tlZCwgY2hhbmdlZCkge1xuICByZXR1cm4gY2hhbmdlZCA+IDBcbiAgICA/IGAke2xhYmVsfTogY2hlY2tlZCAke3BsdXJhbChjaGVja2VkLCBcIm5vdGVcIil9LCBzb3J0ZWQgJHtjaGFuZ2VkfS5gXG4gICAgOiBgJHtsYWJlbH06IGNoZWNrZWQgJHtwbHVyYWwoY2hlY2tlZCwgXCJub3RlXCIpfSwgYWxsIGFscmVhZHkgc29ydGVkLmA7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBzb3J0QWxsRnJvbnRtYXR0ZXIsXG4gIHNvcnRTaW5nbGVGaWxlRnJvbnRtYXR0ZXIsXG4gIHNvcnRUeXBGcm9udG1hdHRlcixcbiAgc29ydEZyb250bWF0dGVyRm9yLFxuICBwbGFjZVByb3BlcnR5Rm9yLFxuICBub3JtYWxpemVHbG9iYWxPcmRlcixcbiAgc29ydFN1bW1hcnksXG4gIERFRkFVTFRfR0xPQkFMX09SREVSLFxuICBUWVBfUFJPUEVSVFksXG4gIFNVQlRZUF9QUk9QRVJUWSxcbn07XG4iLCAiY29uc3QgeyBzZXRJY29uLCBOb3RpY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFksIHNvcnRBbGxGcm9udG1hdHRlciwgc29ydFN1bW1hcnkgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLXNvcnRcIik7XG5cbi8vIExhYmVscyBvZiB0aGUgZm91ciBwbGFjZWhvbGRlciByb3dzOyBjb21wdXRlU29ydGVkS2V5cyBpbiBmcm9udG1hdHRlci1zb3J0LmpzXG4vLyByZXNvbHZlcyB3aGF0IGVhY2ggb25lIHN0YW5kcyBmb3IuXG5jb25zdCBQTEFDRUhPTERFUl9MQUJFTFMgPSB7XG4gIHR5cFZhbHVlOiBcIlRZUFwiLFxuICBzdWJ0eXBWYWx1ZTogXCJTVUJUWVBcIixcbiAgdHlwOiBcIlRZUC1Gcm9udG1hdHRlclwiLFxuICBvdGhlcjogXCJPdGhlciBwcm9wZXJ0aWVzXCIsXG59O1xuXG4vLyBFZGl0b3IgZm9yIHNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXI6IGEgcGxhaW4gbGlzdCBvZiBuYW1lcyB3aXRoIGRyYWcgJlxuLy8gZHJvcC4gSXQgaG9sZHMgbm8gdmFsdWVzLCBzbyB1bmxpa2UgdHlwLWZyb250bWF0dGVyLWVkaXRvci5qcyBpdCBuZWVkcyBub1xuLy8gZGV0b3VyIHRocm91Z2ggT2JzaWRpYW4ncyBwcml2YXRlIHByb3BlcnR5IHdpZGdldC4gVGhlIHBsYWNlaG9sZGVyIHJvd3MgY2FuXG4vLyBiZSBtb3ZlZCBidXQgbm90IHJlbW92ZWQuXG5mdW5jdGlvbiBtb3VudEdsb2JhbE9yZGVyRWRpdG9yKGNvbnRhaW5lckVsLCBwbHVnaW4pIHtcbiAgY29uc3QgaGVhZGVyID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci1oZWFkZXJcIiB9KTtcblxuICAvLyBCdXR0b24gYW5kIHRpdGxlIHNoYXJlIGEgZ3JvdXA6IHRoZSBoZWFkZXIgdXNlcyBzcGFjZS1iZXR3ZWVuLCBzbyBhIHRoaXJkXG4gIC8vIGRpcmVjdCBjaGlsZCB3b3VsZCBmbG9hdCBpbiB0aGUgbWlkZGxlIGluc3RlYWQgb2YgbmV4dCB0byB0aGUgdGl0bGUuXG4gIGNvbnN0IHRpdGxlR3JvdXAgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci10aXRsZS1ncm91cFwiIH0pO1xuXG4gIC8vIFNhbWUgcnVuIGFzIHRoZSBcIlNvcnQgZnJvbnRtYXR0ZXIgaW4gYWxsIG5vdGVzXCIgY29tbWFuZC5cbiAgY29uc3QgYXBwbHlCdG4gPSB0aXRsZUdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvblwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkFwcGx5IHRvIGFsbCBub3Rlc1wiIH0gfSk7XG4gIHNldEljb24oYXBwbHlCdG4sIFwicGxheVwiKTtcbiAgYXBwbHlCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGFzeW5jICgpID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgeyBjaGVja2VkLCBjaGFuZ2VkIH0gPSBhd2FpdCBzb3J0QWxsRnJvbnRtYXR0ZXIocGx1Z2luLmFwcCwgcGx1Z2luLCBudWxsKTtcbiAgICAgIG5ldyBOb3RpY2Uoc29ydFN1bW1hcnkoXCJGcm9udG1hdHRlciBzb3J0aW5nXCIsIGNoZWNrZWQsIGNoYW5nZWQpKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihcIltGcm9udG1hdHRlciBzb3J0aW5nXVwiLCBlcnJvcik7XG4gICAgICBuZXcgTm90aWNlKGBGcm9udG1hdHRlciBzb3J0aW5nIGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgIH1cbiAgfSk7XG5cbiAgdGl0bGVHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIsIHRleHQ6IFwiR2xvYmFsIHByb3BlcnR5IG9yZGVyXCIgfSk7XG5cbiAgY29uc3QgYWRkQnRuID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvblwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkFkZCBwcm9wZXJ0eVwiIH0gfSk7XG4gIHNldEljb24oYWRkQnRuLCBcInBsdXNcIik7XG5cbiAgY29uc3QgbGlzdEVsID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1vcmRlci1saXN0XCIgfSk7XG5cbiAgY29uc3Qgb3JkZXIgPSAoKSA9PiBwbHVnaW4uc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcjtcblxuICAvLyBBIG5ldyByb3cgb25seSBqb2lucyBnbG9iYWxQcm9wZXJ0eU9yZGVyIG9uY2UgaXQgaGFzIGEgdmFsaWQgbmFtZS4gVW50aWxcbiAgLy8gdGhlbiBpdCBpcyBhIGxvY2FsIGRyYWZ0IGFwcGVuZGVkIG9uIHJlbmRlciwgc28gYW4gZW1wdHkgbmFtZSBuZXZlciBlbmRzXG4gIC8vIHVwIGluIHRoZSBzZXR0aW5ncywgZXZlbiBpZiBzb21ldGhpbmcgZWxzZSBzYXZlcyBpbiBiZXR3ZWVuLlxuICBsZXQgZHJhZnRFbnRyeSA9IG51bGw7XG5cbiAgY29uc3QgaXNEdXBsaWNhdGVOYW1lID0gKHZhbHVlLCBvd25FbnRyeSkgPT4ge1xuICAgIGNvbnN0IGxvd2VyID0gdmFsdWUudG9Mb3dlckNhc2UoKTtcbiAgICBpZiAobG93ZXIgPT09IFRZUF9QUk9QRVJUWS50b0xvd2VyQ2FzZSgpIHx8IGxvd2VyID09PSBTVUJUWVBfUFJPUEVSVFkudG9Mb3dlckNhc2UoKSkgcmV0dXJuIHRydWU7XG4gICAgcmV0dXJuIG9yZGVyKCkuc29tZSgob3RoZXIpID0+IG90aGVyICE9PSBvd25FbnRyeSAmJiBvdGhlci5raW5kID09PSBcInByb3BlcnR5XCIgJiYgb3RoZXIubmFtZS50b0xvd2VyQ2FzZSgpID09PSBsb3dlcik7XG4gIH07XG5cbiAgY29uc3QgcmVuZGVyID0gKCkgPT4ge1xuICAgIGxpc3RFbC5lbXB0eSgpO1xuICAgIGNvbnN0IGVudHJpZXMgPSBkcmFmdEVudHJ5ID8gWy4uLm9yZGVyKCksIGRyYWZ0RW50cnldIDogb3JkZXIoKTtcblxuICAgIGVudHJpZXMuZm9yRWFjaCgoZW50cnksIGluZGV4KSA9PiB7XG4gICAgICBjb25zdCBpc0RyYWZ0ID0gZW50cnkgPT09IGRyYWZ0RW50cnk7XG4gICAgICBjb25zdCBpc1BsYWNlaG9sZGVyID0gZW50cnkua2luZCAhPT0gXCJwcm9wZXJ0eVwiO1xuICAgICAgY29uc3Qgcm93Q2xzID1cbiAgICAgICAgXCJ0eXAtb3JkZXItcm93XCIgKyAoaXNQbGFjZWhvbGRlciA/IFwiIGlzLXBsYWNlaG9sZGVyXCIgOiBcIlwiKSArIChlbnRyeS5raW5kID09PSBcInR5cFwiID8gXCIgaXMtdHlwLWRlZmF1bHRzXCIgOiBcIlwiKTtcbiAgICAgIGNvbnN0IHJvdyA9IGxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IHJvd0NscyB9KTtcblxuICAgICAgY29uc3QgZHJhZ0hhbmRsZSA9IHJvdy5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLW9yZGVyLWRyYWdcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJEcmFnIHRvIG1vdmVcIiB9IH0pO1xuICAgICAgc2V0SWNvbihkcmFnSGFuZGxlLCBcImdyaXAtdmVydGljYWxcIik7XG5cbiAgICAgIGlmIChpc1BsYWNlaG9sZGVyKSB7XG4gICAgICAgIHJvdy5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLW9yZGVyLWxhYmVsXCIsIHRleHQ6IFBMQUNFSE9MREVSX0xBQkVMU1tlbnRyeS5raW5kXSB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IGlucHV0ID0gcm93LmNyZWF0ZUVsKFwiaW5wdXRcIiwge1xuICAgICAgICAgIHR5cGU6IFwidGV4dFwiLFxuICAgICAgICAgIGNsczogXCJ0eXAtb3JkZXItbmFtZS1pbnB1dFwiLFxuICAgICAgICAgIGF0dHI6IHsgcGxhY2Vob2xkZXI6IFwiUHJvcGVydHkgbmFtZVwiIH0sXG4gICAgICAgIH0pO1xuICAgICAgICBpbnB1dC52YWx1ZSA9IGVudHJ5Lm5hbWU7XG5cbiAgICAgICAgLy8gXCJibHVyXCIsIG5vdCBcImNoYW5nZVwiOiBjaGFuZ2UgZG9lc24ndCBmaXJlIGZvciBhIGZpZWxkIGxlZnQgZW1wdHksIHNvXG4gICAgICAgIC8vIHRoZSBkcmFmdCB3b3VsZCBuZXZlciBiZSBjbGVhbmVkIHVwLlxuICAgICAgICBpbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiYmx1clwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgY29uc3QgdmFsdWUgPSBpbnB1dC52YWx1ZS50cmltKCk7XG5cbiAgICAgICAgICBpZiAoIXZhbHVlKSB7XG4gICAgICAgICAgICBpZiAoaXNEcmFmdCkge1xuICAgICAgICAgICAgICBkcmFmdEVudHJ5ID0gbnVsbDtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIG9yZGVyKCkuc3BsaWNlKG9yZGVyKCkuaW5kZXhPZihlbnRyeSksIDEpO1xuICAgICAgICAgICAgICBhd2FpdCBwbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZW5kZXIoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoaXNEdXBsaWNhdGVOYW1lKHZhbHVlLCBpc0RyYWZ0ID8gbnVsbCA6IGVudHJ5KSkge1xuICAgICAgICAgICAgbmV3IE5vdGljZShgXCIke3ZhbHVlfVwiIGlzIGFscmVhZHkgaW4gdGhlIGxpc3QuYCk7XG4gICAgICAgICAgICBpbnB1dC52YWx1ZSA9IGVudHJ5Lm5hbWU7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZW50cnkubmFtZSA9IHZhbHVlO1xuICAgICAgICAgIGlmIChpc0RyYWZ0KSB7XG4gICAgICAgICAgICBvcmRlcigpLnB1c2goZW50cnkpO1xuICAgICAgICAgICAgZHJhZnRFbnRyeSA9IG51bGw7XG4gICAgICAgICAgfVxuICAgICAgICAgIGF3YWl0IHBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICByZW5kZXIoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgcmVtb3ZlQnRuID0gcm93LmNyZWF0ZURpdih7IGNsczogXCJ0eXAtb3JkZXItcmVtb3ZlIGNsaWNrYWJsZS1pY29uXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiUmVtb3ZlXCIgfSB9KTtcbiAgICAgICAgc2V0SWNvbihyZW1vdmVCdG4sIFwieFwiKTtcbiAgICAgICAgcmVtb3ZlQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgaWYgKGlzRHJhZnQpIHtcbiAgICAgICAgICAgIGRyYWZ0RW50cnkgPSBudWxsO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBvcmRlcigpLnNwbGljZShvcmRlcigpLmluZGV4T2YoZW50cnkpLCAxKTtcbiAgICAgICAgICAgIGF3YWl0IHBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmVuZGVyKCk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICAvLyBBIGRyYWZ0IGhhcyBubyBwbGFjZSBpbiB0aGUgcmVhbCBsaXN0IHlldCwgc28gaXQgY2FuJ3QgYmUgbW92ZWQuXG4gICAgICBpZiAoaXNEcmFmdCkgcmV0dXJuO1xuXG4gICAgICByb3cuZHJhZ2dhYmxlID0gdHJ1ZTtcbiAgICAgIHJvdy5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ3N0YXJ0XCIsIChldmVudCkgPT4ge1xuICAgICAgICBldmVudC5kYXRhVHJhbnNmZXIuZWZmZWN0QWxsb3dlZCA9IFwibW92ZVwiO1xuICAgICAgICBldmVudC5kYXRhVHJhbnNmZXIuc2V0RGF0YShcInRleHQvcGxhaW5cIiwgU3RyaW5nKGluZGV4KSk7XG4gICAgICAgIHJvdy5jbGFzc0xpc3QuYWRkKFwiaXMtZHJhZ2dpbmdcIik7XG4gICAgICB9KTtcbiAgICAgIHJvdy5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ2VuZFwiLCAoKSA9PiByb3cuY2xhc3NMaXN0LnJlbW92ZShcImlzLWRyYWdnaW5nXCIpKTtcbiAgICAgIHJvdy5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ292ZXJcIiwgKGV2ZW50KSA9PiB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIC8vIFVwcGVyIG9yIGxvd2VyIGhhbGYgZGVjaWRlcyBiZWZvcmUvYWZ0ZXIgLSBvdGhlcndpc2Ugbm90aGluZyBjb3VsZFxuICAgICAgICAvLyBiZSBkcm9wcGVkIGJlbG93IHRoZSBsYXN0IHJvdy5cbiAgICAgICAgY29uc3QgcmVjdCA9IHJvdy5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgICAgY29uc3QgaXNBZnRlciA9IGV2ZW50LmNsaWVudFkgLSByZWN0LnRvcCA+IHJlY3QuaGVpZ2h0IC8gMjtcbiAgICAgICAgcm93LmNsYXNzTGlzdC50b2dnbGUoXCJpcy1kcm9wLWJlZm9yZVwiLCAhaXNBZnRlcik7XG4gICAgICAgIHJvdy5jbGFzc0xpc3QudG9nZ2xlKFwiaXMtZHJvcC1hZnRlclwiLCBpc0FmdGVyKTtcbiAgICAgIH0pO1xuICAgICAgcm93LmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnbGVhdmVcIiwgKCkgPT4gcm93LmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcm9wLWJlZm9yZVwiLCBcImlzLWRyb3AtYWZ0ZXJcIikpO1xuICAgICAgcm93LmFkZEV2ZW50TGlzdGVuZXIoXCJkcm9wXCIsIGFzeW5jIChldmVudCkgPT4ge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBjb25zdCBpc0FmdGVyID0gcm93LmNsYXNzTGlzdC5jb250YWlucyhcImlzLWRyb3AtYWZ0ZXJcIik7XG4gICAgICAgIHJvdy5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJvcC1iZWZvcmVcIiwgXCJpcy1kcm9wLWFmdGVyXCIpO1xuXG4gICAgICAgIGNvbnN0IGZyb21JbmRleCA9IE51bWJlcihldmVudC5kYXRhVHJhbnNmZXIuZ2V0RGF0YShcInRleHQvcGxhaW5cIikpO1xuICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKGZyb21JbmRleCkpIHJldHVybjtcblxuICAgICAgICAvLyBUYXJnZXQgaW5kZXggY291bnRlZCBiZWZvcmUgZnJvbUluZGV4IGlzIHJlbW92ZWQuXG4gICAgICAgIGxldCBpbnNlcnRCZWZvcmUgPSBpc0FmdGVyID8gaW5kZXggKyAxIDogaW5kZXg7XG4gICAgICAgIGlmIChmcm9tSW5kZXggPCBpbnNlcnRCZWZvcmUpIGluc2VydEJlZm9yZSAtPSAxO1xuXG4gICAgICAgIGNvbnN0IFttb3ZlZF0gPSBvcmRlcigpLnNwbGljZShmcm9tSW5kZXgsIDEpO1xuICAgICAgICBvcmRlcigpLnNwbGljZShpbnNlcnRCZWZvcmUsIDAsIG1vdmVkKTtcbiAgICAgICAgYXdhaXQgcGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICByZW5kZXIoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9O1xuXG4gIGFkZEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgIGlmICghZHJhZnRFbnRyeSkge1xuICAgICAgZHJhZnRFbnRyeSA9IHsga2luZDogXCJwcm9wZXJ0eVwiLCBuYW1lOiBcIlwiIH07XG4gICAgICByZW5kZXIoKTtcbiAgICB9XG4gICAgY29uc3QgaW5wdXRzID0gbGlzdEVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIudHlwLW9yZGVyLW5hbWUtaW5wdXRcIik7XG4gICAgaW5wdXRzW2lucHV0cy5sZW5ndGggLSAxXT8uZm9jdXMoKTtcbiAgfSk7XG5cbiAgcmVuZGVyKCk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBtb3VudEdsb2JhbE9yZGVyRWRpdG9yIH07XG4iLCAiY29uc3QgeyBnZXRTdWJ0eXAgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cHNcIik7XG5cbi8vIENvbG9yIG9mIGEgVFlQIHdpdGhvdXQgaXRzIG93biBjb2xvci4gTGl2ZXMgaGVyZSBiZWNhdXNlIGNvZGUgYmVsb3cgdGhlXG4vLyB2aWV3IG5lZWRzIGl0IChzZWUgbmFtZUNvbG9yKTsgdHlwLXBhbmUuanMgcmUtZXhwb3J0cyBpdC5cbmNvbnN0IERFRkFVTFRfVFlQX0NPTE9SID0gXCIjODg4ODg4XCI7XG5cbi8vIC0tLSBTdWJ0eXAgY29sb3JzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEEgU3VidHlwIHN0b3JlcyBubyBjb2xvciwgb25seSBhbiBvZmZzZXQgZnJvbSBpdHMgVFlQJ3MgY29sb3Jcbi8vIChzZXR0aW5ncy50eXBTdWJ0eXBzW1RZUF1bU1VCVFlQXS5jb2xvciA9IHsgaCwgbCB9KS4gVGhlIHJlYWwgY29sb3IgaXNcbi8vIGNvbXB1dGVkIGZyb20gdGhlIGN1cnJlbnQgVFlQIGNvbG9yIGV2ZXJ5IHRpbWUsIHNvIHdoZW4gdGhhdCBjaGFuZ2VzIGFsbFxuLy8gU3VidHlwcyBmb2xsb3cgYW5kIHN0YXkgaW4gdGhlIGZhbWlseS5cbi8vIFRoZSBtYXRoIHJ1bnMgaW4gT0tMQ0gsIHdoZXJlIGEgbGlnaHRuZXNzIGNoYW5nZSBsb29rcyBhYm91dCBlcXVhbGx5IHN0cm9uZ1xuLy8gYWNyb3NzIGh1ZXMgKGluIEhTTCB5ZWxsb3cgd291bGQgYmUgZmFyIGJyaWdodGVyIHRoYW4gYmx1ZSkuIFdpdGhvdXQgYW5cbi8vIG9mZnNldCBhIFN1YnR5cCBoYXMgdGhlIFRZUCBjb2xvci5cbi8vICAgaDogaHVlLCBzaGlmdGVkIGluIGRlZ3JlZXM7XG4vLyAgIGw6IGxpZ2h0bmVzcyBhcyAlIG9mIHRoZSB3YXkgdG8gd2hpdGUgKCspIG9yIGJsYWNrICgtKS5cbi8vIFRoZSBhbGxvd2VkIHJhbmdlIGlzIGEgc2V0dGluZyAoc2V0dGluZ3Muc3VidHlwQ29sb3JSYW5nZXMpOyBhIGxhcmdlciBzdG9yZWRcbi8vIG9mZnNldCBpcyBjbGFtcGVkIHRvIGl0LlxuLy9cbi8vIFRoaXMgbGlzdCBpcyB0aGUgc2luZ2xlIHNvdXJjZSBmb3IgdGhlIHBvcG92ZXIgc2xpZGVycywgdGhlIHNldHRpbmcgbGltaXRzXG4vLyBhbmQgdGhlIGNsYW1waW5nOyBjb21tZW50aW5nIGEgY2hhbm5lbCBvdXQgcmVtb3ZlcyBpdCBldmVyeXdoZXJlLlxuLy9cbi8vIFNhdHVyYXRpb24gaXMgZGlzYWJsZWQuIEl0IG9uY2UgY29tcGVuc2F0ZWQgZm9yIGNocm9tYSB0aGF0IGxpZ2h0bmVzcyBhbmRcbi8vIGh1ZSB0b29rIGF3YXk7IHNpbmNlIGJvdGggbm93IGNhcnJ5IGNocm9tYSBhbG9uZyAoc2VlIGNvbXB1dGVDb2xvck9mZnNldCksXG4vLyBpdCBjb3VsZCBvbmx5IHNheSBcInRoaXMgU3VidHlwIGhvbGRzIGJhY2tcIiwgbm90IHdvcnRoIGEgdGhpcmQgc2xpZGVyLiBUb1xuLy8gcmV2aXZlIGl0LCB1bmNvbW1lbnQgaXQgaGVyZSwgaW4gREVGQVVMVF9TVUJUWVBfQ09MT1JfUkFOR0VTLCBpblxuLy8gY29tcHV0ZUNvbG9yT2Zmc2V0IGFuZCBhdCByYW5nZU1heC9yYW5nZURlc2MgaW4gc2V0dGluZ3MuanMuXG4vLyBkb3duT25seTogdGhlIHNsaWRlciBvbmx5IGdvZXMgZnJvbSAtbGltaXQgdG8gMCAtIGEgU3VidHlwIG1heSBob2xkIGJhY2sgYnV0XG4vLyBuZXZlciBiZSBsb3VkZXIgdGhhbiBpdHMgVFlQLlxuY29uc3QgU1VCVFlQX0NPTE9SX0NIQU5ORUxTID0gW1xuICB7IGtleTogXCJoXCIsIGxhYmVsOiBcIkh1ZVwiLCB1bml0OiBcIlx1MDBCMFwiIH0sXG4gIC8vIHsga2V5OiBcInNcIiwgbGFiZWw6IFwiU2F0dXJhdGlvblwiLCB1bml0OiBcIiVcIiwgZG93bk9ubHk6IHRydWUgfSxcbiAgeyBrZXk6IFwibFwiLCBsYWJlbDogXCJMaWdodG5lc3NcIiwgdW5pdDogXCIlXCIgfSxcbl07XG4vLyBTdWJ0eXBzIHNob3VsZCBhYm92ZSBhbGwgYmUgZGlzdGluZ3Vpc2hhYmxlOiBodWUgY29udHJpYnV0ZXMgbW9zdCBhbmQgZ2V0c1xuLy8gdGhlIHdpZGVzdCByYW5nZSwgbGlnaHRuZXNzIGFzIHRoZSBzZWNvbmQgY2xlYXIgYXhpcyBnZXRzIHBsZW50eSB0b28uXG5jb25zdCBERUZBVUxUX1NVQlRZUF9DT0xPUl9SQU5HRVMgPSB7IGg6IDM1LCAvKiBzOiA0MCwgKi8gbDogNDAgfTtcblxuZnVuY3Rpb24gY29sb3JSYW5nZShzZXR0aW5ncywga2V5KSB7XG4gIGNvbnN0IHZhbHVlID0gTnVtYmVyKHNldHRpbmdzLnN1YnR5cENvbG9yUmFuZ2VzPy5ba2V5XSk7XG4gIHJldHVybiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpICYmIHZhbHVlID49IDAgPyB2YWx1ZSA6IERFRkFVTFRfU1VCVFlQX0NPTE9SX1JBTkdFU1trZXldO1xufVxuXG4vLyBTbGlkZXIgcmFuZ2UgLSBvbmUgcGxhY2UgZm9yIHBvcG92ZXIsIGNsYW1waW5nIGFuZCBncmFkaWVudCBwcmV2aWV3IHNvIHRoZXlcbi8vIGNhbid0IGRyaWZ0IGFwYXJ0LlxuZnVuY3Rpb24gY2hhbm5lbEJvdW5kcyhzZXR0aW5ncywga2V5KSB7XG4gIGNvbnN0IHJhbmdlID0gY29sb3JSYW5nZShzZXR0aW5ncywga2V5KTtcbiAgcmV0dXJuIFNVQlRZUF9DT0xPUl9DSEFOTkVMUy5maW5kKChjaGFubmVsKSA9PiBjaGFubmVsLmtleSA9PT0ga2V5KT8uZG93bk9ubHkgPyBbLXJhbmdlLCAwXSA6IFstcmFuZ2UsIHJhbmdlXTtcbn1cblxuLy8gQSBTdWJ0eXAncyBvZmZzZXQsIGNsYW1wZWQgdG8gdGhlIGNvbmZpZ3VyZWQgbGltaXRzLlxuZnVuY3Rpb24gY2xhbXBlZE9mZnNldChzZXR0aW5ncywgb2Zmc2V0KSB7XG4gIGlmICghb2Zmc2V0KSByZXR1cm4gbnVsbDtcbiAgY29uc3QgcmVzdWx0ID0ge307XG4gIGZvciAoY29uc3QgeyBrZXkgfSBvZiBTVUJUWVBfQ09MT1JfQ0hBTk5FTFMpIHtcbiAgICBjb25zdCBbbWluLCBtYXhdID0gY2hhbm5lbEJvdW5kcyhzZXR0aW5ncywga2V5KTtcbiAgICByZXN1bHRba2V5XSA9IE1hdGgubWluKG1heCwgTWF0aC5tYXgobWluLCBOdW1iZXIob2Zmc2V0W2tleV0pIHx8IDApKTtcbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuXG5jb25zdCB0b0xpbmVhciA9IChjKSA9PiAoYyA8PSAwLjA0MDQ1ID8gYyAvIDEyLjkyIDogKChjICsgMC4wNTUpIC8gMS4wNTUpICoqIDIuNCk7XG5jb25zdCB0b0dhbW1hID0gKGMpID0+IChjIDw9IDAuMDAzMTMwOCA/IDEyLjkyICogYyA6IDEuMDU1ICogYyAqKiAoMSAvIDIuNCkgLSAwLjA1NSk7XG5cbmZ1bmN0aW9uIGhleFRvT2tsY2goaGV4KSB7XG4gIGNvbnN0IG1hdGNoID0gL14jPyhbMC05YS1mXXs2fSkkL2kuZXhlYyhoZXggPz8gXCJcIik7XG4gIGlmICghbWF0Y2gpIHJldHVybiBudWxsO1xuICBjb25zdCBpbnQgPSBwYXJzZUludChtYXRjaFsxXSwgMTYpO1xuICBjb25zdCBbciwgZywgYl0gPSBbKGludCA+PiAxNikgJiAyNTUsIChpbnQgPj4gOCkgJiAyNTUsIGludCAmIDI1NV0ubWFwKChjKSA9PiB0b0xpbmVhcihjIC8gMjU1KSk7XG4gIGNvbnN0IGwgPSBNYXRoLmNicnQoMC40MTIyMjE0NzA4ICogciArIDAuNTM2MzMyNTM2MyAqIGcgKyAwLjA1MTQ0NTk5MjkgKiBiKTtcbiAgY29uc3QgbSA9IE1hdGguY2JydCgwLjIxMTkwMzQ5ODIgKiByICsgMC42ODA2OTk1NDUxICogZyArIDAuMTA3Mzk2OTU2NiAqIGIpO1xuICBjb25zdCBzID0gTWF0aC5jYnJ0KDAuMDg4MzAyNDYxOSAqIHIgKyAwLjI4MTcxODgzNzYgKiBnICsgMC42Mjk5Nzg3MDA1ICogYik7XG4gIGNvbnN0IEwgPSAwLjIxMDQ1NDI1NTMgKiBsICsgMC43OTM2MTc3ODUgKiBtIC0gMC4wMDQwNzIwNDY4ICogcztcbiAgY29uc3QgQSA9IDEuOTc3OTk4NDk1MSAqIGwgLSAyLjQyODU5MjIwNSAqIG0gKyAwLjQ1MDU5MzcwOTkgKiBzO1xuICBjb25zdCBCID0gMC4wMjU5MDQwMzcxICogbCArIDAuNzgyNzcxNzY2MiAqIG0gLSAwLjgwODY3NTc2NiAqIHM7XG4gIHJldHVybiB7IEwsIEM6IE1hdGguaHlwb3QoQSwgQiksIEg6ICgoTWF0aC5hdGFuMihCLCBBKSAqIDE4MCkgLyBNYXRoLlBJICsgMzYwKSAlIDM2MCB9O1xufVxuXG4vLyBMaW5lYXIgc1JHQjsgY2hhbm5lbHMgbWF5IGZhbGwgb3V0c2lkZSAwLi4xIChvdXQgb2YgZ2FtdXQpLlxuZnVuY3Rpb24gb2tsY2hUb0xpbmVhcih7IEwsIEMsIEggfSkge1xuICBjb25zdCBBID0gQyAqIE1hdGguY29zKChIICogTWF0aC5QSSkgLyAxODApO1xuICBjb25zdCBCID0gQyAqIE1hdGguc2luKChIICogTWF0aC5QSSkgLyAxODApO1xuICBjb25zdCBsID0gKEwgKyAwLjM5NjMzNzc3NzQgKiBBICsgMC4yMTU4MDM3NTczICogQikgKiogMztcbiAgY29uc3QgbSA9IChMIC0gMC4xMDU1NjEzNDU4ICogQSAtIDAuMDYzODU0MTcyOCAqIEIpICoqIDM7XG4gIGNvbnN0IHMgPSAoTCAtIDAuMDg5NDg0MTc3NSAqIEEgLSAxLjI5MTQ4NTU0OCAqIEIpICoqIDM7XG4gIHJldHVybiBbXG4gICAgNC4wNzY3NDE2NjIxICogbCAtIDMuMzA3NzExNTkxMyAqIG0gKyAwLjIzMDk2OTkyOTIgKiBzLFxuICAgIC0xLjI2ODQzODAwNDYgKiBsICsgMi42MDk3NTc0MDExICogbSAtIDAuMzQxMzE5Mzk2NSAqIHMsXG4gICAgLTAuMDA0MTk2MDg2MyAqIGwgLSAwLjcwMzQxODYxNDcgKiBtICsgMS43MDc2MTQ3MDEgKiBzLFxuICBdO1xufVxuXG5jb25zdCBpbkdhbXV0ID0gKHJnYikgPT4gcmdiLmV2ZXJ5KChjKSA9PiBjID49IC0wLjAwMDEgJiYgYyA8PSAxLjAwMDEpO1xuXG4vLyBMYXJnZXN0IGNocm9tYSBzUkdCIGNhbiBzaG93IGF0IHRoaXMgbGlnaHRuZXNzIGFuZCBodWUuIFRoZSBsaW1pdCB2YXJpZXMgYVxuLy8gbG90IChwdXJlIHllbGxvdyBvbmx5IGNhcnJpZXMgbXVjaCBjaHJvbWEganVzdCBiZWxvdyB3aGl0ZSwgYmx1ZSBpbiB0aGVcbi8vIG1pZGRsZSksIHdoaWNoIGlzIGV4YWN0bHkgd2hlcmUgYW55IG1hdGggaG9sZGluZyBjaHJvbWEgYWJzb2x1dGUgYnJlYWtzLlxuZnVuY3Rpb24gbWF4Q2hyb21hKEwsIEgpIHtcbiAgbGV0IGxvdyA9IDA7XG4gIGxldCBoaWdoID0gMC40OyAvLyBhYm92ZSB0aGUgc1JHQiBtYXhpbXVtICh+MC4zMilcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCAyMDsgaSsrKSB7XG4gICAgY29uc3QgbWlkID0gKGxvdyArIGhpZ2gpIC8gMjtcbiAgICBpZiAoaW5HYW11dChva2xjaFRvTGluZWFyKHsgTCwgQzogbWlkLCBIIH0pKSkgbG93ID0gbWlkO1xuICAgIGVsc2UgaGlnaCA9IG1pZDtcbiAgfVxuICByZXR1cm4gbG93O1xufVxuXG4vLyBPdXQtb2YtZ2FtdXQgY29sb3JzIGxvc2UgY2hyb21hIHVudGlsIHRoZXkgZml0OyBodWUgYW5kIGxpZ2h0bmVzcyBzdGF5LlxuLy8gRm9yIGFwcGx5Q29sb3JPZmZzZXQgb25seSBhIHNhZmV0eSBuZXQsIHNpbmNlIGNocm9tYSBpcyBhbHJlYWR5IGEgc2hhcmUgb2Zcbi8vIHRoZSBkaXNwbGF5YWJsZSBtYXhpbXVtIHRoZXJlLlxuZnVuY3Rpb24gb2tsY2hUb0hleChjb2xvcikge1xuICBsZXQgcmdiID0gb2tsY2hUb0xpbmVhcihjb2xvcik7XG4gIGlmICghaW5HYW11dChyZ2IpKSByZ2IgPSBva2xjaFRvTGluZWFyKHsgLi4uY29sb3IsIEM6IG1heENocm9tYShjb2xvci5MLCBjb2xvci5IKSB9KTtcbiAgcmV0dXJuIChcbiAgICBcIiNcIiArXG4gICAgcmdiXG4gICAgICAubWFwKChjKSA9PiBNYXRoLnJvdW5kKE1hdGgubWluKDEsIE1hdGgubWF4KDAsIHRvR2FtbWEoTWF0aC5taW4oMSwgTWF0aC5tYXgoMCwgYykpKSkpICogMjU1KSlcbiAgICAgIC5tYXAoKGMpID0+IGMudG9TdHJpbmcoMTYpLnBhZFN0YXJ0KDIsIFwiMFwiKSlcbiAgICAgIC5qb2luKFwiXCIpXG4gICk7XG59XG5cbi8vIExpZ2h0bmVzcyBvZiBhIGh1ZSdzIGN1c3AsIHdoZXJlIGl0IGNhcnJpZXMgdGhlIG1vc3QgY2hyb21hLiBtYXhDaHJvbWEgcmlzZXNcbi8vIHVwIHRvIGl0IGFuZCBmYWxscyBhZnRlciwgc28gdGhlIHBlYWsgY2FuIGJlIG5hcnJvd2VkIGRvd24uIE9uZSB2YWx1ZSBwZXJcbi8vIGh1ZSBhbmQgdGhlIHNlYXJjaCBpcyBjb3N0bHksIHNvIGl0IGlzIGNhY2hlZCBwZXIgd2hvbGUgZGVncmVlLlxuY29uc3QgY3VzcENhY2hlID0gbmV3IE1hcCgpO1xuXG4vLyBBYm92ZSB0aGlzIGEgY29sb3IgY291bnRzIGFzIGNocm9tYXRpYy4gQSBwdXJlIGdyYXkgY29tZXMgYmFjayBmcm9tXG4vLyBoZXhUb09rbGNoIHdpdGggY2hyb21hIGFyb3VuZCAyZS04IGFuZCBhbiBhcmJpdHJhcnkgaHVlIChyb3VuZGVkIG1hdHJpeFxuLy8gY29uc3RhbnRzKTsgdGVzdGluZyBcIj4gMFwiIG1hZGUgYSBncmF5IGZvbGxvdyB0aGUgY3VzcCBvZiBhIGh1ZSBpdCBkb2Vzbid0XG4vLyBoYXZlLiBGYXIgYmVsb3cgYW55dGhpbmcgdmlzaWJsZSBpbiA4IGJpdCAob25lIHN0ZXAgaXMgYWJvdXQgMC4wMDIpLlxuY29uc3QgTkVVVFJBTF9DSFJPTUEgPSAxZS00O1xuXG5mdW5jdGlvbiBjdXNwTGlnaHRuZXNzKEgpIHtcbiAgY29uc3Qga2V5ID0gTWF0aC5yb3VuZChIKSAlIDM2MDtcbiAgY29uc3QgY2FjaGVkID0gY3VzcENhY2hlLmdldChrZXkpO1xuICBpZiAoY2FjaGVkICE9PSB1bmRlZmluZWQpIHJldHVybiBjYWNoZWQ7XG4gIGxldCBsb3cgPSAwO1xuICBsZXQgaGlnaCA9IDE7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgMjQ7IGkrKykge1xuICAgIGNvbnN0IHRoaXJkID0gKGhpZ2ggLSBsb3cpIC8gMztcbiAgICBpZiAobWF4Q2hyb21hKGxvdyArIHRoaXJkLCBrZXkpIDwgbWF4Q2hyb21hKGhpZ2ggLSB0aGlyZCwga2V5KSkgbG93ICs9IHRoaXJkO1xuICAgIGVsc2UgaGlnaCAtPSB0aGlyZDtcbiAgfVxuICBjb25zdCByZXN1bHQgPSAobG93ICsgaGlnaCkgLyAyO1xuICBjdXNwQ2FjaGUuc2V0KGtleSwgcmVzdWx0KTtcbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLy8gVGhlIHNhbWUgbGlnaHRuZXNzLCBtZWFzdXJlZCBhZ2FpbnN0IHRoZSB0YXJnZXQgaHVlJ3MgY3VzcCBpbnN0ZWFkIG9mIGl0c1xuLy8gb3duOiBjdXNwIG1hcHMgdG8gY3VzcCwgYmxhY2sgdG8gYmxhY2ssIHdoaXRlIHRvIHdoaXRlLCBsaW5lYXIgaW4gYmV0d2Vlbi5cbi8vIFdpdGhvdXQgYSBodWUgc2hpZnQgTCBjb21lcyBiYWNrIHVuY2hhbmdlZC5cbmZ1bmN0aW9uIHJlbWFwVG9DdXNwKEwsIGZyb21ILCB0b0gpIHtcbiAgY29uc3QgZnJvbSA9IGN1c3BMaWdodG5lc3MoZnJvbUgpO1xuICBjb25zdCB0byA9IGN1c3BMaWdodG5lc3ModG9IKTtcbiAgaWYgKEwgPD0gZnJvbSkgcmV0dXJuIGZyb20gPiAwID8gKEwgLyBmcm9tKSAqIHRvIDogdG87XG4gIHJldHVybiBmcm9tIDwgMSA/IHRvICsgKChMIC0gZnJvbSkgLyAoMSAtIGZyb20pKSAqICgxIC0gdG8pIDogdG87XG59XG5cbi8vIFRoZSB0d28gZ2FtdXQgc2VhcmNoZXMgY29zdCBhYm91dCAxMCBcdTAwQjVzIHBlciBjb2xvciAtIHRvbyBtdWNoIHdoZW4gdGhlIGZpbGVcbi8vIHRyZWUgb3IgZ3JhcGggYXNrcyBmb3IgZXZlcnkgZmlsZSAoc2VlIGNvbG9yRm9yRmlsZSkuIFRoZXJlIGFyZSBvbmx5IGFcbi8vIGhhbmRmdWwgb2YgZGlzdGluY3QgY29sb3JzLCBzbyBhIGNhY2hlIHN1ZmZpY2VzOyBkcmFnZ2luZyBhIHNsaWRlciBhZGRzXG4vLyBldmVyeSBpbnRlcm1lZGlhdGUgdmFsdWUsIGhlbmNlIHRoZSBvY2Nhc2lvbmFsIHJlc2V0LlxuY29uc3Qgb2Zmc2V0Q2FjaGUgPSBuZXcgTWFwKCk7XG5cbmZ1bmN0aW9uIGFwcGx5Q29sb3JPZmZzZXQoaGV4LCBvZmZzZXQpIHtcbiAgaWYgKCFvZmZzZXQpIHJldHVybiBoZXg7XG4gIGNvbnN0IGNhY2hlS2V5ID0gaGV4ICsgXCJ8XCIgKyAob2Zmc2V0LmggPz8gMCkgKyBcInxcIiArIChvZmZzZXQubCA/PyAwKTtcbiAgY29uc3QgY2FjaGVkID0gb2Zmc2V0Q2FjaGUuZ2V0KGNhY2hlS2V5KTtcbiAgaWYgKGNhY2hlZCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gY2FjaGVkO1xuICBjb25zdCByZXN1bHQgPSBjb21wdXRlQ29sb3JPZmZzZXQoaGV4LCBvZmZzZXQpO1xuICBpZiAob2Zmc2V0Q2FjaGUuc2l6ZSA+IDUwMCkgb2Zmc2V0Q2FjaGUuY2xlYXIoKTtcbiAgb2Zmc2V0Q2FjaGUuc2V0KGNhY2hlS2V5LCByZXN1bHQpO1xuICByZXR1cm4gcmVzdWx0O1xufVxuXG4vLyBCb3RoIHNsaWRlcnMgYWN0IHJlbGF0aXZlIHRvIHRoZSBUWVAgY29sb3Igc28gdGhlIFN1YnR5cCBzdGF5cyBpbiB0aGVcbi8vIGZhbWlseS4gQWJzb2x1dGUgdmFsdWVzIGRvbid0IGtlZXAgdGhlaXIgcHJvbWlzZSwgYmVjYXVzZSBob3cgbXVjaCBjb2xvclxuLy8gc1JHQiBhbGxvd3MgZGVwZW5kcyBvbiBsaWdodG5lc3MgQU5EIGh1ZTpcbi8vICAgbDogc2hhcmUgb2YgdGhlIHdheSB0byB3aGl0ZSAoKykgb3IgYmxhY2sgKC0pLiBBYnNvbHV0ZSBPS0xDSCBwb2ludHMgcmFuIGFcbi8vICAgICAgbGlnaHQgVFlQIGNvbG9yIGludG8gcHVyZSB3aGl0ZSBpbiB0aGUgZmlyc3QgaGFsZiBvZiB0aGUgc2xpZGVyLlxuLy8gICBoOiBkZWdyZWVzIC0gdGhlIG9ubHkgYWJzb2x1dGUgb25lLCBCVVQgaXQgY2FycmllcyBsaWdodG5lc3MgYWxvbmcgKHNlZVxuLy8gICAgICByZW1hcFRvQ3VzcCkuIEVhY2ggaHVlIHBlYWtzIGF0IGEgZGlmZmVyZW50IGxpZ2h0bmVzcyAoeWVsbG93IGF0IEwgMC45Mixcbi8vICAgICAgb3JhbmdlIDAuNzgsIGJsdWUgMC40OSkuIFR1cm5pbmcgYSBsaWdodCB5ZWxsb3cgdG8gb3JhbmdlIGF0IGZpeGVkXG4vLyAgICAgIGxpZ2h0bmVzcyBsYW5kcyBmYXIgYWJvdmUgb3JhbmdlJ3MgY3VzcCwgd2hlcmUgdGhlcmUgaXMgaGFyZGx5IGFueVxuLy8gICAgICBjaHJvbWEgbGVmdDogYSB3YXNoZWQtb3V0IHBhc3RlbC4gRm9sbG93aW5nIHRoZSBjdXNwIGtlZXBzIHRoZSBjb2xvclxuLy8gICAgICBzdHJlbmd0aCBuZWFybHkgY29uc3RhbnQgdGhyb3VnaCB0aGUgdHVybi5cbi8vIENocm9tYSBpcyB0aGVuIHNpbXBseSBhIHNoYXJlIG9mIHRoZSBjZWlsaW5nIChiYXNlLkMgLyBtYXhDaHJvbWEgYXQgdGhlXG4vLyBzdGFydCwgdGltZXMgbWF4Q2hyb21hIGF0IHRoZSB0YXJnZXQpOyBvbmx5IHdpdGggcmVsYXRlZCBsaWdodG5lc3NlcyBhcmVcbi8vIHR3byBodWVzJyBjZWlsaW5ncyBjb21wYXJhYmxlLlxuLy9cbi8vIE5vdGUgd2hhdCB0aGF0IHNoYXJlIGlzOiBhIHN0YXRlbWVudCBhYm91dCBzUkdCLCBub3QgYWJvdXQgcGVyY2VwdGlvbi4gSXRcbi8vIGtlZXBzIFwiZXF1YWxseSBleGhhdXN0ZWRcIiwgbm90IFwiZXF1YWxseSBjb2xvcmZ1bFwiIChjb25zdGFudCBDKSBub3IgXCJlcXVhbGx5XG4vLyBzYXR1cmF0ZWRcIiAoY29uc3RhbnQgQy9MKS4gU28gdGhlIG1vZGVsIGlzIHRpZWQgdG8gc1JHQjsgYWZ0ZXIgYSBodWUgdHVybiBhXG4vLyBTdWJ0eXAgaXMgZXF1YWxseSBlbXBoYXRpYyByYXRoZXIgdGhhbiBlcXVhbGx5IGxpZ2h0IChhIGRlc2lnbiBjaG9pY2UpOyBhbmRcbi8vIGNocm9tYSBpc24ndCBtb25vdG9uaWMgaW4gbGlnaHRuZXNzIC0gYWJvdmUgaXRzIGN1c3AgYSBUWVAgY29sb3IgZmlyc3QgZ2FpbnNcbi8vIGNocm9tYSBnb2luZyBkb3duLCB0aGVuIGxvc2VzIGl0ICgjNzg3OGRjIGhhcyBtb3JlIGF0IC0yMCAlIHRoYW4gYXQgMCAlIG9yXG4vLyAtNDAgJSkuIEZpbmUgZm9yIGNvbG9yZWQgZmlsZSBuYW1lczsgYSBzdHJpY3RlciBtb2RlbCBuZWVkcyBhIGRpZmZlcmVudFxuLy8gcmVmZXJlbmNlLCBub3QgcGF0Y2hlZCBmb3JtdWxhcy5cbi8vXG4vLyBPS0xhYiBpdHNlbGYgaXMgb2ZmIGluIHRoZSBibHVlIHJhbmdlIChIIDI2MC0yOTApOiBibHVlIGRyaWZ0cyB0b3dhcmQgdmlvbGV0XG4vLyB3aGVuIGxpZ2h0ZW5lZCB3aGlsZSB0aGUgbnVtYmVycyBzYXkgdGhlIGh1ZSBpcyBjb25zdGFudC4gQ2hlY2sgc3VjaCBUWVBcbi8vIGNvbG9ycyBieSBleWUuXG5mdW5jdGlvbiBjb21wdXRlQ29sb3JPZmZzZXQoaGV4LCBvZmZzZXQpIHtcbiAgY29uc3QgYmFzZSA9IGhleFRvT2tsY2goaGV4KTtcbiAgaWYgKCFiYXNlKSByZXR1cm4gaGV4O1xuICBjb25zdCBIID0gKGJhc2UuSCArIChvZmZzZXQuaCA/PyAwKSArIDM2MCkgJSAzNjA7XG4gIGNvbnN0IGJhc2VDZWlsaW5nID0gbWF4Q2hyb21hKGJhc2UuTCwgYmFzZS5IKTtcbiAgLy8gQSBncmF5IFRZUCBjb2xvciBzdGF5cyBncmF5OyBpdHMgaHVlIG1lYW5zIG5vdGhpbmcsIHNvIHRoZXJlIGlzIG5vIGN1c3AgdG9cbiAgLy8gZm9sbG93IGVpdGhlci5cbiAgY29uc3QgbmV1dHJhbCA9IGJhc2UuQyA8IE5FVVRSQUxfQ0hST01BIHx8IGJhc2VDZWlsaW5nIDw9IDA7XG4gIGNvbnN0IHJlbGF0aXZlID0gbmV1dHJhbCA/IDAgOiBiYXNlLkMgLyBiYXNlQ2VpbGluZztcbiAgY29uc3Qgc2hpZnRlZCA9IG5ldXRyYWwgPyBiYXNlLkwgOiByZW1hcFRvQ3VzcChiYXNlLkwsIGJhc2UuSCwgSCk7XG4gIGNvbnN0IHNoYXJlID0gKG9mZnNldC5sID8/IDApIC8gMTAwO1xuICBjb25zdCBMID0gTWF0aC5taW4oMSwgTWF0aC5tYXgoMCwgc2hpZnRlZCArIHNoYXJlICogKHNoYXJlID49IDAgPyAxIC0gc2hpZnRlZCA6IHNoaWZ0ZWQpKSk7XG4gIGNvbnN0IEMgPSByZWxhdGl2ZSAqIG1heENocm9tYShMLCBIKTsgLyogKiAoMSArIChvZmZzZXQucyA/PyAwKSAvIDEwMCkgLSBzYXR1cmF0aW9uIGRpc2FibGVkICovXG4gIHJldHVybiBva2xjaFRvSGV4KHsgTCwgQzogTWF0aC5tYXgoMCwgQyksIEggfSk7XG59XG5cbmZ1bmN0aW9uIGhhc0NvbG9yT2Zmc2V0KG9mZnNldCkge1xuICByZXR1cm4gISFvZmZzZXQgJiYgU1VCVFlQX0NPTE9SX0NIQU5ORUxTLnNvbWUoKHsga2V5IH0pID0+IChvZmZzZXRba2V5XSA/PyAwKSAhPT0gMCk7XG59XG5cbi8vIEEgU3VidHlwJ3MgY29sb3IgKHRoZSBUWVAncyB3aGlsZSBpdCBoYXMgbm8gb2Zmc2V0KTsgbnVsbCBpZiB0aGUgVFlQIGl0c2VsZlxuLy8gaGFzIG5vIGNvbG9yLlxuZnVuY3Rpb24gc3VidHlwQ29sb3Ioc2V0dGluZ3MsIHR5cCwgc3VidHlwKSB7XG4gIGNvbnN0IHR5cENvbG9yID0gc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPz8gbnVsbDtcbiAgaWYgKCF0eXBDb2xvciB8fCAhc3VidHlwKSByZXR1cm4gdHlwQ29sb3I7XG4gIGNvbnN0IG9mZnNldCA9IGNsYW1wZWRPZmZzZXQoc2V0dGluZ3MsIGdldFN1YnR5cChzZXR0aW5ncywgdHlwLCBzdWJ0eXApPy5jb2xvcik7XG4gIHJldHVybiBoYXNDb2xvck9mZnNldChvZmZzZXQpID8gYXBwbHlDb2xvck9mZnNldCh0eXBDb2xvciwgb2Zmc2V0KSA6IHR5cENvbG9yO1xufVxuXG4vLyBEb2VzIHRoZSBTdWJ0eXAgaGF2ZSBhbiBvZmZzZXQgb2YgaXRzIG93biAoZWZmZWN0aXZlIHdpdGhpbiB0aGUgbGltaXRzKT9cbmZ1bmN0aW9uIHN1YnR5cEhhc093bkNvbG9yKHNldHRpbmdzLCB0eXAsIHN1YnR5cCkge1xuICByZXR1cm4gaGFzQ29sb3JPZmZzZXQoY2xhbXBlZE9mZnNldChzZXR0aW5ncywgZ2V0U3VidHlwKHNldHRpbmdzLCB0eXAsIHN1YnR5cCk/LmNvbG9yKSk7XG59XG5cbi8vIENvbG9yIG9mIGEgVFlQIG9yIFN1YnR5cCBuYW1lIC0gc2hhcmVkIGJ5IHRoZSBwaWNrZXIgKHR5cC1waWNrZXIuanMpIGFuZCB0aGVcbi8vIFN1YnR5cCBwcmV2aWV3IGluIHRoZSBUWVAtTGlzdCBzbyB0aGV5IGNhbid0IGRyaWZ0IGFwYXJ0LiBXaXRoIHN1YnR5cCwgdGhlXG4vLyBTdWJ0eXAgY29sb3IsIGJ1dCBvbmx5IGlmIHRoZSBcIlN1YnR5cFwiIHN1Yi10b2dnbGUgb2YgXCJUWVAtUGFuZVwiIGFsbG93cyBpdC5cbi8vIGlzRGVmYXVsdCBtZWFucyBhIGhvbGxvdyByaW5nIGluc3RlYWQgb2YgYSBmaWxsZWQgZG90IChzZWUgcGFpbnRDb2xvckRvdCkuXG5mdW5jdGlvbiBuYW1lQ29sb3Ioc2V0dGluZ3MsIHR5cCwgc3VidHlwID0gbnVsbCkge1xuICBjb25zdCB1c2VTdWJ0eXAgPSAhIXN1YnR5cCAmJiBzZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3RTdWJ0eXA7XG4gIGNvbnN0IHR5cENvbG9yID0gc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPz8gbnVsbDtcbiAgcmV0dXJuIHtcbiAgICBjb2xvcjogKHVzZVN1YnR5cCA/IHN1YnR5cENvbG9yKHNldHRpbmdzLCB0eXAsIHN1YnR5cCkgOiB0eXBDb2xvcikgPz8gREVGQVVMVF9UWVBfQ09MT1IsXG4gICAgaXNEZWZhdWx0OiAhdHlwQ29sb3IgfHwgKHVzZVN1YnR5cCAmJiAhc3VidHlwSGFzT3duQ29sb3Ioc2V0dGluZ3MsIHR5cCwgc3VidHlwKSksXG4gIH07XG59XG5cbi8vIENvbG9yIGRvdCAoVFlQLUxpc3QsIGRldGFpbCB2aWV3LCBwaWNrZXJzLCBkaWFsb2dzKTogZmlsbGVkIGZvciBhbiBvd25cbi8vIGNvbG9yLCBhIGhvbGxvdyByaW5nIGZvciB0aGUgZGVmYXVsdCAtIGdyYXkgZm9yIGEgVFlQIHdpdGhvdXQgYSBjb2xvciwgdGhlXG4vLyBpbmhlcml0ZWQgVFlQIGNvbG9yIGZvciBhIFN1YnR5cCB3aXRob3V0IGFuIG9mZnNldC5cbmZ1bmN0aW9uIHBhaW50Q29sb3JEb3QoZWwsIGNvbG9yLCBpc0RlZmF1bHQpIHtcbiAgZWwuc3R5bGUuYmFja2dyb3VuZENvbG9yID0gaXNEZWZhdWx0ID8gXCJ0cmFuc3BhcmVudFwiIDogY29sb3I7XG4gIGVsLnN0eWxlLmJveFNoYWRvdyA9IGlzRGVmYXVsdCA/IGBpbnNldCAwIDAgMCBtYXgoMS41cHgsIDAuMTVlbSkgJHtjb2xvcn1gIDogXCJcIjtcbn1cblxuLy8gdmlld0tleSAob3B0aW9uYWwpOiB0aGUgdmlldydzIGtleSBpbiBjb2xvclZpZXdzLiBJZiBpdHMgXCI8dmlld0tleT5TdWJ0eXBcIlxuLy8gc3ViLXRvZ2dsZSBpcyBvbiwgdGhlIG5vdGUncyBTdWJ0eXAgY29sb3IgaXMgdXNlZCBpbnN0ZWFkIG9mIGl0cyBUWVAncy5cbmZ1bmN0aW9uIGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIHZpZXdLZXkgPSBudWxsKSB7XG4gIGNvbnN0IHR5cCA9IHBsdWdpbi50eXBJbmRleC50eXBPZihmaWxlKTtcbiAgaWYgKCF0eXApIHJldHVybiBudWxsO1xuICBjb25zdCB7IHNldHRpbmdzIH0gPSBwbHVnaW47XG4gIGlmICghdmlld0tleSB8fCAhc2V0dGluZ3MuY29sb3JWaWV3c1tgJHt2aWV3S2V5fVN1YnR5cGBdKSByZXR1cm4gc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPz8gbnVsbDtcbiAgcmV0dXJuIHN1YnR5cENvbG9yKHNldHRpbmdzLCB0eXAsIHBsdWdpbi50eXBJbmRleC5zdWJ0eXBPZihmaWxlKSk7XG59XG5cbi8vIC0tLSBJbmxpbmUgY29sb3JzIGluIG90aGVyIHZpZXdzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEV4cGxvcmVyLCBzZWFyY2gsIFJlY2VudCBGaWxlcywgYmFja2xpbmtzLCBib29rbWFya3MsIHRoZSBub3RlIHRpdGxlIGFuZFxuLy8gXCJBbGwgcHJvcGVydGllc1wiIGFyZSBjb2xvcmVkIHRocm91Z2ggc3R5bGUuY29sb3Igb24gT2JzaWRpYW4ncyBvd25cbi8vIGVsZW1lbnRzLiBUaG9zZSB2aWV3cyBvbmx5IHJlLXJlbmRlciBub3cgYW5kIHRoZW4sIHNvIHRoZSBjb2xvcnMgd291bGQgc3RheVxuLy8gYWZ0ZXIgdGhlIHBsdWdpbiBpcyBkaXNhYmxlZC4gRXZlcnkgZWxlbWVudCBjb2xvcmVkIHRoaXMgd2F5IGlzIG1hcmtlZCwgYW5kXG4vLyBvbiB1bmxvYWQgZXhhY3RseSB0aGUgbWFya2VkIG9uZXMgYXJlIGNsZWFyZWQgLSBuZXZlciBhbiBpbmxpbmUgY29sb3Igc29tZVxuLy8gb3RoZXIgcGx1Z2luIG9yIHRoZW1lIHB1dCB0aGVyZS5cbmNvbnN0IENPTE9SRURfQVRUUiA9IFwiZGF0YS10eXAtY29sb3JlZFwiO1xuXG4vLyBjb2xvciBudWxsL1wiXCIgcmVtb3ZlcyB0aGUgY29sb3IsIGJ1dCBvbmx5IGZyb20gYW4gZWxlbWVudCB3ZSBjb2xvcmVkLlxuLy8gcHJpb3JpdHk6IFwiaW1wb3J0YW50XCIgd2hlcmUgYSBDU1MgcnVsZSB3aXRoICFpbXBvcnRhbnQgY29tcGV0ZXMuXG5mdW5jdGlvbiBzZXRJbmxpbmVDb2xvcihlbCwgY29sb3IsIHByaW9yaXR5ID0gXCJcIikge1xuICBpZiAoY29sb3IpIHtcbiAgICBlbC5zdHlsZS5zZXRQcm9wZXJ0eShcImNvbG9yXCIsIGNvbG9yLCBwcmlvcml0eSk7XG4gICAgZWwuc2V0QXR0cmlidXRlKENPTE9SRURfQVRUUiwgXCJcIik7XG4gIH0gZWxzZSBpZiAoZWwuaGFzQXR0cmlidXRlKENPTE9SRURfQVRUUikpIHtcbiAgICBlbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImNvbG9yXCIpO1xuICAgIGVsLnJlbW92ZUF0dHJpYnV0ZShDT0xPUkVEX0FUVFIpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNsZWFySW5saW5lQ29sb3JzKGRvYykge1xuICBmb3IgKGNvbnN0IGVsIG9mIGRvYy5xdWVyeVNlbGVjdG9yQWxsKGBbJHtDT0xPUkVEX0FUVFJ9XWApKSBzZXRJbmxpbmVDb2xvcihlbCwgbnVsbCk7XG59XG5cbi8vIFRoZSBkb2N1bWVudHMgb2YgYWxsIHdpbmRvd3MgKHBvcC1vdXRzIGluY2x1ZGVkKSwgY29sbGVjdGVkIHRocm91Z2ggdGhlaXJcbi8vIGxlYXZlcy5cbmZ1bmN0aW9uIGFsbERvY3VtZW50cyhhcHApIHtcbiAgY29uc3QgZG9jcyA9IG5ldyBTZXQoKTtcbiAgYXBwLndvcmtzcGFjZS5pdGVyYXRlQWxsTGVhdmVzKChsZWFmKSA9PiBkb2NzLmFkZChsZWFmLnZpZXcuY29udGFpbmVyRWwub3duZXJEb2N1bWVudCkpO1xuICByZXR1cm4gZG9jcztcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIHNldElubGluZUNvbG9yLFxuICBjbGVhcklubGluZUNvbG9ycyxcbiAgYWxsRG9jdW1lbnRzLFxuICBjb2xvckZvckZpbGUsXG4gIG5hbWVDb2xvcixcbiAgREVGQVVMVF9UWVBfQ09MT1IsXG4gIHN1YnR5cENvbG9yLFxuICBhcHBseUNvbG9yT2Zmc2V0LFxuICBoYXNDb2xvck9mZnNldCxcbiAgc3VidHlwSGFzT3duQ29sb3IsXG4gIHBhaW50Q29sb3JEb3QsXG4gIGNvbG9yUmFuZ2UsXG4gIGNoYW5uZWxCb3VuZHMsXG4gIGNsYW1wZWRPZmZzZXQsXG4gIFNVQlRZUF9DT0xPUl9DSEFOTkVMUyxcbiAgREVGQVVMVF9TVUJUWVBfQ09MT1JfUkFOR0VTLFxufTtcbiIsICJjb25zdCB7IFBsdWdpblNldHRpbmdUYWIsIFNldHRpbmdHcm91cCwgVG9nZ2xlQ29tcG9uZW50LCBEcm9wZG93bkNvbXBvbmVudCwgZGVib3VuY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgbW91bnRHbG9iYWxPcmRlckVkaXRvciB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItb3JkZXItZWRpdG9yXCIpO1xuY29uc3QgeyBERUZBVUxUX0dMT0JBTF9PUkRFUiB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItc29ydFwiKTtcbmNvbnN0IHsgU1VCVFlQX0NPTE9SX0NIQU5ORUxTLCBERUZBVUxUX1NVQlRZUF9DT0xPUl9SQU5HRVMsIGNvbG9yUmFuZ2UgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5cbmNvbnN0IERFRkFVTFRfU0VUVElOR1MgPSB7XG4gIHR5cHM6IFtdLFxuICB0eXBDb2xvcnM6IHt9LFxuICB0eXBEZXNjcmlwdGlvbnM6IHt9LFxuICB0eXBEZWZhdWx0RnJvbnRtYXR0ZXI6IHt9LFxuICAvLyBLZXlzIG9mIHR5cERlZmF1bHRGcm9udG1hdHRlclt0eXBdIG1hcmtlZCBhcyBmbG9hdGluZy4gVGhleSBzaGFyZSB0aGUgbGlzdFxuICAvLyBhbmQgaXRzIG9yZGVyICh3aGljaCBmcm9udG1hdHRlciBzb3J0aW5nIHVzZXMpLCBidXQgZ2V0VHlwRGVmYXVsdHMoKSBsZWF2ZXNcbiAgLy8gdGhlbSBvdXQgdW5sZXNzIGFza2VkIHdpdGggaW5jbHVkZUZsb2F0aW5nLCBzbyBuZXcgbm90ZXMgZG9uJ3QgZ2V0IHRoZW1cbiAgLy8gYXV0b21hdGljYWxseS5cbiAgdHlwRmxvYXRpbmdLZXlzOiB7fSxcbiAgLy8gU2hvcnRjdXRzIHBlciBrZXkgb2YgdHlwRGVmYXVsdEZyb250bWF0dGVyW3R5cF06XG4gIC8vICAgeyBbVFlQXTogeyBbUHJvcGVydHldOiB7IG5hbWU6IFwidG9kYXlcIiB8IFwidHAuPHNjcmlwdD5cIiB9IH0gfVxuICAvLyBLZXB0IE5FWFQgVE8gdGhlIGZyb250bWF0dGVyLCBub3QgYXMgaXRzIHZhbHVlIC0gc2VlIHNob3J0Y3V0cy5qcy5cbiAgdHlwU2hvcnRjdXRzOiB7fSxcbiAgdHlwTWFudWFsOiB7fSxcbiAgLy8gUmVnaXN0ZXJlZCBTdWJ0eXBzIHBlciBUWVAgd2l0aCB0aGVpciBvd24gZnJvbnRtYXR0ZXIgYmxvY2ssIHNlZSBzdWJ0eXBzLmpzLlxuICB0eXBTdWJ0eXBzOiB7fSxcbiAgLy8gUGlubmVkIHNpbmdsZSBwcm9wZXJ0aWVzIChraW5kOiBcInByb3BlcnR5XCIpIHBsdXMgdGhlIGZvdXIgZml4ZWRcbiAgLy8gcGxhY2Vob2xkZXJzIFwidHlwVmFsdWVcIiwgXCJzdWJ0eXBWYWx1ZVwiLCBcInR5cFwiIGFuZCBcIm90aGVyXCIgLSBzZWVcbiAgLy8gZnJvbnRtYXR0ZXItc29ydC5qcy5cbiAgZ2xvYmFsUHJvcGVydHlPcmRlcjogREVGQVVMVF9HTE9CQUxfT1JERVIsXG4gIC8vIEhvdyB0aGUgb3BlbiBub3RlIHNob3dzIGl0cyBUWVAgKHNlZSBhY3RpdmUtdGl0bGUtY29sb3JzLmpzKTogXCJub25lXCIsXG4gIC8vIFwiZG90XCIgb3IgXCJiYWRnZVwiLiBUaGUgdGhyZWUgYmFkZ2Ugc2V0dGluZ3MgYmVsb3cgb25seSBtYXR0ZXIgZm9yIFwiYmFkZ2VcIi5cbiAgLy8gY29sb3JWaWV3cy5ub3RlVGl0bGVDb2xvciAodGhlIHRpdGxlIHRleHQgaXRzZWxmKSBpcyBpbmRlcGVuZGVudC5cbiAgbm90ZVRpdGxlU3R5bGU6IFwiZG90XCIsXG4gIC8vIEJhZGdlIGNvbG9yZWQgKFRZUCBjb2xvcikgb3IgbmV1dHJhbCAodGV4dC1tdXRlZCkuXG4gIG5vdGVUaXRsZUJhZGdlQ29sb3JlZDogdHJ1ZSxcbiAgLy8gQmFkZ2UgbGFiZWw6IFwidHlwXCIgKFtUWVBdKSwgXCJ0eXAtc3VidHlwXCIgKFtUWVAvU3VidHlwXSkgb3IgXCJzdWJ0eXBcIlxuICAvLyAoW1N1YnR5cF07IG5vIGJhZGdlIHdpdGhvdXQgYSBTdWJ0eXApLiBDb2xvcmVkIGluIHRoZSBUWVAgb3IgU3VidHlwIGNvbG9yO1xuICAvLyBmb3IgXCJ0eXAtc3VidHlwXCIgY2hvc2VuIHdpdGggY29sb3JWaWV3cy5ub3RlVGl0bGVNYXJrZXJTdWJ0eXAuXG4gIG5vdGVUaXRsZUJhZGdlTGFiZWw6IFwidHlwXCIsXG4gIC8vIFwidGl0bGVcIiAobmV4dCB0byB0aGUgaW5saW5lIHRpdGxlKSBvciBcImJsb2NrXCIgKGxlZnQgb2YgdGhlIHByb3BlcnR5XG4gIC8vIGJsb2NrLCB0dXJuZWQgOTBcdTAwQjApLlxuICBub3RlVGl0bGVCYWRnZVBvc2l0aW9uOiBcInRpdGxlXCIsXG4gIC8vIEZvciBwb3NpdGlvbiBcImJsb2NrXCI6IHRvcCBvciBib3R0b20gZWRnZSBvZiB0aGUgcHJvcGVydHkgYmxvY2suXG4gIG5vdGVUaXRsZVZlcnRpY2FsQWxpZ246IFwidG9wXCIsXG4gIHR5cFNvcnRPcmRlcjogXCJjb3VudC1kZXNjXCIsXG4gIC8vIFdoYXQgdGhlIFRZUC1MaXN0IHNob3dzIG5leHQgdG8gdGhlIG5hbWU6IFwic3VidHlwc1wiLCBcImRlc2NyaXB0aW9uXCIgb3JcbiAgLy8gXCJub25lXCIuIFN3aXRjaGVkIGJ5IHRoZSBoZWFkZXIgYnV0dG9uIG5leHQgdG8gc29ydGluZyAoU0VDT05EQVJZX01PREVTIGluXG4gIC8vIHR5cC1wYW5lLmpzKSwgbm90IGhlcmU6IGxpa2UgdGhlIHNvcnQgb3JkZXIgaXQgb25seSBjb25jZXJucyB0aGF0IGxpc3QuXG4gIHR5cExpc3RTZWNvbmRhcnk6IFwic3VidHlwc1wiLFxuICAvLyBTZWUgcGlja1R5cEFuZFN1YnR5cCBpbiB0eXAtcGlja2VyLmpzOiBmYWxzZSA9IGVhY2ggU3VidHlwIGluZGVudGVkIGluIHRoZVxuICAvLyBUWVAtUGlja2VyLCB0cnVlID0gYSBzZXBhcmF0ZSBTdWJ0eXAtUGlja2VyIGFmdGVyIHRoZSBUWVAgY2hvaWNlLlxuICBzZXBhcmF0ZVN1YnR5cFBpY2tlcjogZmFsc2UsXG4gIGluY2x1ZGVJZ25vcmVkRmlsZXM6IGZhbHNlLFxuICAvLyBBc2sgYmVmb3JlIGRlbGV0aW5nIGEgVFlQIG9yIGEgU3VidHlwIHdpdGggcHJvcGVydGllcy4gT25seSBkZWxldGlvbnMgdGhhdFxuICAvLyB0b3VjaCBub3RoaW5nIGJ1dCB0aGVzZSBzZXR0aW5ncyBjYW4gYmUgc3dpdGNoZWQgb2ZmIChcIkRvbid0IGFzayBhZ2FpblwiIGluXG4gIC8vIHRoZSBkaWFsb2cpIC0gdGhleSBjYW4gYmUgdW5kb25lICh1bmRvLmpzKS4gQW55dGhpbmcgdGhhdCByZXdyaXRlcyBub3Rlc1xuICAvLyBvciBmaWxlcyBhbHdheXMgYXNrcy5cbiAgY29uZmlybURlbGV0aW9uOiB0cnVlLFxuICAvLyBPd24gdGFnL2F0dGFjaG1lbnQgY29sb3JzIGluIHRoZSBncmFwaCBkaXNhYmxlZCAoMjAyNi0wOS0zMCk6IHRoZSBNaW5pbWFsXG4gIC8vIHRoZW1lJ3MgU3R5bGUgU2V0dGluZ3MgY292ZXIgYm90aCwgc2VlIGdyYXBoLWNvbG9ycy5qcy5cbiAgLy8gZ3JhcGhUYWdDb2xvckVuYWJsZWQ6IGZhbHNlLFxuICAvLyBncmFwaFRhZ0NvbG9yOiBcIlwiLFxuICAvLyBncmFwaEF0dGFjaG1lbnRDb2xvckVuYWJsZWQ6IGZhbHNlLFxuICAvLyBncmFwaEF0dGFjaG1lbnRDb2xvcjogXCJcIixcbiAgLy8gSG93IGZhciBhIFN1YnR5cCdzIGNvbG9yIG1heSBkaWZmZXIgZnJvbSBpdHMgVFlQJ3MgKFx1MDBCMSksIHNlZSB0eXAtY29sb3JzLmpzOlxuICAvLyBodWUgaW4gZGVncmVlcywgbGlnaHRuZXNzIGluICUgb2YgdGhlIHdheSB0byB3aGl0ZSBvciBibGFjay5cbiAgc3VidHlwQ29sb3JSYW5nZXM6IHsgLi4uREVGQVVMVF9TVUJUWVBfQ09MT1JfUkFOR0VTIH0sXG4gIGNvbG9yVmlld3M6IHtcbiAgICBmaWxlRXhwbG9yZXI6IHRydWUsXG4gICAgZ3JhcGg6IHRydWUsXG4gICAgc2VhcmNoOiB0cnVlLFxuICAgIHJlY2VudEZpbGVzOiB0cnVlLFxuICAgIGJhY2tsaW5rczogdHJ1ZSxcbiAgICBib29rbWFya3M6IHRydWUsXG4gICAgLy8gXCI8dmlldz5TdWJ0eXBcIiBzdWItdG9nZ2xlczogdXNlIGEgbm90ZSdzIFN1YnR5cCBjb2xvciBpbnN0ZWFkIG9mIGl0c1xuICAgIC8vIFRZUCdzIChzZWUgY29sb3JGb3JGaWxlIGluIHR5cC1jb2xvcnMuanMpLlxuICAgIGZpbGVFeHBsb3JlclN1YnR5cDogdHJ1ZSxcbiAgICBncmFwaFN1YnR5cDogdHJ1ZSxcbiAgICBzZWFyY2hTdWJ0eXA6IHRydWUsXG4gICAgcmVjZW50RmlsZXNTdWJ0eXA6IHRydWUsXG4gICAgYmFja2xpbmtzU3VidHlwOiB0cnVlLFxuICAgIGJvb2ttYXJrc1N1YnR5cDogdHJ1ZSxcbiAgICBsaW5rc1N1YnR5cDogdHJ1ZSxcbiAgICB0eXBMaXN0U3VidHlwOiB0cnVlLFxuICAgIG5vdGVUaXRsZUNvbG9yU3VidHlwOiB0cnVlLFxuICAgIG5vdGVUaXRsZU1hcmtlclN1YnR5cDogdHJ1ZSxcbiAgICBmcm9udG1hdHRlckRlZmF1bHRzOiB0cnVlLFxuICAgIC8vIFN1Yi10b2dnbGUgb2YgZnJvbnRtYXR0ZXJEZWZhdWx0cyBhbmQgYWxsUHJvcGVydGllczogaW5jbHVkZSB0aGUgU3VidHlwXG4gICAgLy8gYmxvY2tzIChzZWUgZnJvbnRtYXR0ZXItZGVmYXVsdC1oaWdobGlnaHQuanMpOyBmb3IgYWxsUHJvcGVydGllcyBhbHNvIGluXG4gICAgLy8gdGhlIFN1YnR5cCBjb2xvci5cbiAgICBmcm9udG1hdHRlckRlZmF1bHRzU3VidHlwOiB0cnVlLFxuICAgIHR5cExpc3Q6IHRydWUsXG4gICAgYWxsUHJvcGVydGllczogdHJ1ZSxcbiAgICBhbGxQcm9wZXJ0aWVzU3VidHlwOiB0cnVlLFxuICAgIG5vdGVUaXRsZUNvbG9yOiB0cnVlLFxuICAgIGxpbmtzOiB0cnVlLFxuICB9LFxufTtcblxuY2xhc3MgVHlwU3lzdGVtU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xuICBjb25zdHJ1Y3RvcihhcHAsIHBsdWdpbikge1xuICAgIHN1cGVyKGFwcCwgcGx1Z2luKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgfVxuXG4gIC8vIEVhY2ggc2VjdGlvbiBpcyBhIFNldHRpbmdHcm91cCAoaGVhZGluZyBwbHVzIG9uZSBib3gsIGVudHJpZXMgc2VwYXJhdGVkIGJ5XG4gIC8vIGxpbmVzKSwgbGlrZSBPYnNpZGlhbidzIGNvcmUgc2V0dGluZ3MuIFNldHRpbmdzIGNyZWF0ZWQgb25lIGJ5IG9uZSB3aXRoXG4gIC8vIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKSB3b3VsZCBlYWNoIGdldCB0aGVpciBvd24gc21hbGwgYm94LlxuICBkaXNwbGF5KCkge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgLy8gS2VlcCB0aGUgc2Nyb2xsIHBvc2l0aW9uIGFjcm9zcyByZWJ1aWxkcyAodG9nZ2xlcyB3aXRoIHN1Yi1vcHRpb25zIGNhbGxcbiAgICAvLyBkaXNwbGF5KCkpOiB0aGUgVFlQIG1hcmtlciBkcm9wZG93biBtZWFzdXJlcyBpdHNlbGYgb24gc2V0VmFsdWUoKSBhbmRcbiAgICAvLyBmb3JjZXMgYSBsYXlvdXQgd2hpbGUgdGhlIHBhZ2UgaXMgb25seSBwYXJ0bHkgYnVpbHQsIHNvIHRoZSBicm93c2VyXG4gICAgLy8gY2xhbXBzIHNjcm9sbFRvcCB0byB0aGF0IGhlaWdodCBhbmQgdGhlIHBhZ2Ugd291bGQganVtcCB1cC5cbiAgICBjb25zdCB7IHNjcm9sbFRvcCB9ID0gY29udGFpbmVyRWw7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcblxuICAgIG5ldyBTZXR0aW5nR3JvdXAoY29udGFpbmVyRWwpXG4gICAgICAuc2V0SGVhZGluZyhcIlRZUC1MaXN0XCIpXG4gICAgICAuYWRkU2V0dGluZygoc2V0dGluZykgPT5cbiAgICAgICAgc2V0dGluZ1xuICAgICAgICAgIC5zZXROYW1lKFwiSW5jbHVkZSBleGNsdWRlZCBmaWxlc1wiKVxuICAgICAgICAgIC5zZXREZXNjKFxuICAgICAgICAgICAgXCJDb3VudCBub3RlcyBmcm9tIE9ic2lkaWFuJ3MgXFxcIkV4Y2x1ZGVkIGZpbGVzXFxcIiAoZS5nLiBmb2xkZXJzIGhpZGRlbiBieSBIaWRlIEZvbGRlcnMpIGluIFRZUCBjb3VudHMsIHRoZSBUWVAtUGlja2VyIGFuZCBmcm9udG1hdHRlciBzb3J0aW5nLlwiXG4gICAgICAgICAgKVxuICAgICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5pbmNsdWRlSWdub3JlZEZpbGVzKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuaW5jbHVkZUlnbm9yZWRGaWxlcyA9IHZhbHVlO1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgICAgICB9KVxuICAgICAgICAgIClcbiAgICAgIClcbiAgICAgIC5hZGRTZXR0aW5nKChzZXR0aW5nKSA9PlxuICAgICAgICBzZXR0aW5nXG4gICAgICAgICAgLnNldE5hbWUoXCJDb25maXJtIGRlbGV0aW9uXCIpXG4gICAgICAgICAgLnNldERlc2MoXG4gICAgICAgICAgICBcIkFzayBiZWZvcmUgZGVsZXRpbmcgYSBUWVAgb3IgYSBTdWJ0eXAgd2l0aCBwcm9wZXJ0aWVzLiBXaGVuIG9mZiwgdGhleSBhcmUgZGVsZXRlZCBhdCBvbmNlOyBlaXRoZXIgd2F5IHRoZSBub3RpY2UgYWZ0ZXJ3YXJkcyBvZmZlcnMgVW5kby4gRGlhbG9ncyB0aGF0IHJld3JpdGUgbm90ZXMgKHJlbmFtZSBhbmQgdXBkYXRlIG5vdGVzLCBtZXJnZSkgYWx3YXlzIGFzay5cIlxuICAgICAgICAgIClcbiAgICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuY29uZmlybURlbGV0aW9uKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29uZmlybURlbGV0aW9uID0gdmFsdWU7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICApXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmdHcm91cChjb250YWluZXJFbCkuc2V0SGVhZGluZyhcIlRZUC1QaWNrZXJcIikuYWRkU2V0dGluZygoc2V0dGluZykgPT5cbiAgICAgIHNldHRpbmdcbiAgICAgICAgLnNldE5hbWUoXCJTZXBhcmF0ZSBTdWJ0eXAtUGlja2VyXCIpXG4gICAgICAgIC5zZXREZXNjKFxuICAgICAgICAgIFwiQWZ0ZXIgY2hvb3NpbmcgYSBUWVAsIGNob29zZSB0aGUgU3VidHlwIGluIGEgc2Vjb25kIHBpY2tlci4gV2hlbiBvZmYsIGVhY2ggU3VidHlwIGlzIGxpc3RlZCBpbmRlbnRlZCBiZWxvdyBpdHMgVFlQLlwiXG4gICAgICAgIClcbiAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5zZXBhcmF0ZVN1YnR5cFBpY2tlcikub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5zZXBhcmF0ZVN1YnR5cFBpY2tlciA9IHZhbHVlO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgICAgKVxuICAgICk7XG5cbiAgICAvLyBzdWJ0eXBLZXkgKG9wdGlvbmFsKTogdHdvIGxhYmVsZWQgdG9nZ2xlcyBpbnN0ZWFkIG9mIG9uZSAtIFwiVFlQXCIgZm9yIHRoZVxuICAgIC8vIHNldHRpbmcgaXRzZWxmIGFuZCBiZWxvdyBpdCBcIlN1YnR5cFwiLCBzaG93biBvbmx5IHdoaWxlIFwiVFlQXCIgaXMgb24uIFRoZVxuICAgIC8vIGRlZmF1bHQgdG9vbHRpcHMgZml0IHRoZSBjb2xvcmluZyB0b2dnbGVzLlxuICAgIGNvbnN0IGNvbG9yVmlld1RvZ2dsZSA9IChcbiAgICAgIGdyb3VwLFxuICAgICAga2V5LFxuICAgICAgbmFtZSxcbiAgICAgIGRlc2MsXG4gICAgICBzdWJ0eXBLZXkgPSBudWxsLFxuICAgICAgeyB0eXBUb29sdGlwID0gXCJDb2xvciBieSBUWVBcIiwgc3VidHlwVG9vbHRpcCA9IFwiVXNlIFN1YnR5cCBjb2xvciBpbnN0ZWFkIG9mIFRZUCBjb2xvclwiIH0gPSB7fVxuICAgICkgPT5cbiAgICAgIGdyb3VwLmFkZFNldHRpbmcoKHNldHRpbmcpID0+IHtcbiAgICAgICAgc2V0dGluZy5zZXROYW1lKG5hbWUpLnNldERlc2MoZGVzYyk7XG4gICAgICAgIGNvbnN0IHNhdmUgPSBhc3luYyAoc2V0dGluZ0tleSwgdmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzW3NldHRpbmdLZXldID0gdmFsdWU7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgIH07XG5cbiAgICAgICAgaWYgKCFzdWJ0eXBLZXkpIHtcbiAgICAgICAgICBzZXR0aW5nLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PiB0b2dnbGUuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3c1trZXldKS5vbkNoYW5nZSgodmFsdWUpID0+IHNhdmUoa2V5LCB2YWx1ZSkpKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBzZXR0aW5nLnNldHRpbmdFbC5hZGRDbGFzcyhcInR5cC1ub3RlLXRpdGxlLXNldHRpbmdcIik7XG4gICAgICAgIGNvbnN0IGFkZFJvdyA9IChsYWJlbCwgdG9vbHRpcCwgc2V0dGluZ0tleSwgb25DaGFuZ2VkKSA9PiB7XG4gICAgICAgICAgY29uc3Qgcm93ID0gc2V0dGluZy5jb250cm9sRWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1ub3RlLXRpdGxlLXRvZ2dsZS1yb3dcIiB9KTtcbiAgICAgICAgICByb3cuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtbm90ZS10aXRsZS10b2dnbGUtbGFiZWxcIiwgdGV4dDogbGFiZWwgfSk7XG4gICAgICAgICAgbmV3IFRvZ2dsZUNvbXBvbmVudChyb3cpXG4gICAgICAgICAgICAuc2V0VG9vbHRpcCh0b29sdGlwKVxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Nbc2V0dGluZ0tleV0pXG4gICAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIGF3YWl0IHNhdmUoc2V0dGluZ0tleSwgdmFsdWUpO1xuICAgICAgICAgICAgICBvbkNoYW5nZWQ/LigpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH07XG4gICAgICAgIGFkZFJvdyhcIlRZUFwiLCB0eXBUb29sdGlwLCBrZXksICgpID0+IHRoaXMuZGlzcGxheSgpKTtcbiAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Nba2V5XSkgYWRkUm93KFwiU3VidHlwXCIsIHN1YnR5cFRvb2x0aXAsIHN1YnR5cEtleSk7XG4gICAgICB9KTtcblxuICAgIGNvbnN0IGNvbG9yaW5nR3JvdXAgPSBuZXcgU2V0dGluZ0dyb3VwKGNvbnRhaW5lckVsKS5zZXRIZWFkaW5nKFwiQ29sb3JpbmdcIik7XG5cbiAgICBjb2xvclZpZXdUb2dnbGUoY29sb3JpbmdHcm91cCwgXCJmaWxlRXhwbG9yZXJcIiwgXCJGaWxlIGV4cGxvcmVyXCIsIFwiQ29sb3Igbm90ZSBuYW1lcyBpbiB0aGUgZmlsZSBleHBsb3Jlci5cIiwgXCJmaWxlRXhwbG9yZXJTdWJ0eXBcIik7XG4gICAgY29sb3JWaWV3VG9nZ2xlKGNvbG9yaW5nR3JvdXAsIFwiZ3JhcGhcIiwgXCJHcmFwaFwiLCBcIkNvbG9yIG5vZGVzIGluIHRoZSBnbG9iYWwgYW5kIGxvY2FsIGdyYXBoLlwiLCBcImdyYXBoU3VidHlwXCIpO1xuICAgIGNvbG9yVmlld1RvZ2dsZShjb2xvcmluZ0dyb3VwLCBcInNlYXJjaFwiLCBcIlNlYXJjaFwiLCBcIkNvbG9yIHJlc3VsdCB0aXRsZXMgaW4gc2VhcmNoLlwiLCBcInNlYXJjaFN1YnR5cFwiKTtcbiAgICBjb2xvclZpZXdUb2dnbGUoY29sb3JpbmdHcm91cCwgXCJyZWNlbnRGaWxlc1wiLCBcIlJlY2VudCBGaWxlc1wiLCBcIkNvbG9yIGVudHJpZXMgaW4gdGhlIFJlY2VudCBGaWxlcyBwbHVnaW4uXCIsIFwicmVjZW50RmlsZXNTdWJ0eXBcIik7XG4gICAgY29sb3JWaWV3VG9nZ2xlKFxuICAgICAgY29sb3JpbmdHcm91cCxcbiAgICAgIFwibGlua3NcIixcbiAgICAgIFwiTGlua3MgaW4gbm90ZXNcIixcbiAgICAgIFwiQ29sb3IgaW50ZXJuYWwgbGlua3MgYnkgdGhlIFRZUCBvZiB0aGVpciB0YXJnZXQgKHJlYWRpbmcgdmlldywgTGl2ZSBQcmV2aWV3LCBob3ZlciBwcmV2aWV3KS4gVW5yZXNvbHZlZCBsaW5rcyBzdGF5IGFzIHRoZXkgYXJlLlwiLFxuICAgICAgXCJsaW5rc1N1YnR5cFwiXG4gICAgKTtcbiAgICBjb2xvclZpZXdUb2dnbGUoY29sb3JpbmdHcm91cCwgXCJ0eXBMaXN0XCIsIFwiVFlQLVBhbmVcIiwgXCJDb2xvciBuYW1lcyBpbiB0aGUgVFlQLVBhbmUgYW5kIFRZUC1QaWNrZXIuXCIsIFwidHlwTGlzdFN1YnR5cFwiKTtcbiAgICBjb2xvclZpZXdUb2dnbGUoXG4gICAgICBjb2xvcmluZ0dyb3VwLFxuICAgICAgXCJub3RlVGl0bGVDb2xvclwiLFxuICAgICAgXCJDb2xvciBub3RlIHRpdGxlXCIsXG4gICAgICBcIkNvbG9yIHRoZSBpbmxpbmUgdGl0bGUgb2YgdGhlIG9wZW4gbm90ZS5cIixcbiAgICAgIFwibm90ZVRpdGxlQ29sb3JTdWJ0eXBcIlxuICAgICk7XG5cbiAgICAvLyBQcm9ncmVzc2l2ZSBkaXNjbG9zdXJlOiBcImJhZGdlXCIgYWRkcyB0b2dnbGVzIChjb2xvciwgcG9zaXRpb24pIHRvIHRoaXNcbiAgICAvLyBvbmUgc2V0dGluZyByb3csIHBvc2l0aW9uIFwiYmxvY2tcIiBvbmUgbW9yZSAoYWxpZ25tZW50KS4gRWFjaCByZS1yZW5kZXJzXG4gICAgLy8gdmlhIGRpc3BsYXkoKSBzbyBvbmx5IHRoZSByZWxldmFudCBvbmVzIHNob3cuXG4gICAgY29uc3QgaXNCYWRnZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVN0eWxlID09PSBcImJhZGdlXCI7XG4gICAgY29uc3QgaXNCbG9ja1Bvc2l0aW9uID0gdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VQb3NpdGlvbiA9PT0gXCJibG9ja1wiO1xuXG4gICAgY29sb3JpbmdHcm91cC5hZGRTZXR0aW5nKChub3RlVGl0bGVTZXR0aW5nKSA9PiB7XG4gICAgICBub3RlVGl0bGVTZXR0aW5nXG4gICAgICAgIC5zZXROYW1lKFwiVFlQIG1hcmtlciBpbiBub3RlXCIpXG4gICAgICAgIC5zZXREZXNjKGlzQmFkZ2UgPyBcIkJhZGdlIG9wdGlvbnM6IGxhYmVsLCBjb2xvciwgcG9zaXRpb24uXCIgOiBcIkhvdyB0aGUgb3BlbiBub3RlIHNob3dzIGl0cyBUWVAuXCIpXG4gICAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XG4gICAgICAgICAgZHJvcGRvd25cbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJub25lXCIsIFwiTm9uZVwiKVxuICAgICAgICAgICAgLmFkZE9wdGlvbihcImRvdFwiLCBcIkRvdCBhdCB0aXRsZVwiKVxuICAgICAgICAgICAgLmFkZE9wdGlvbihcImJhZGdlXCIsIFwiQmFkZ2Ugd2l0aCBUWVAgbmFtZVwiKVxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVN0eWxlKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVTdHlsZSA9IHZhbHVlO1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgKTtcblxuICAgICAgLy8gXCJTdWJ0eXBcIiAoU3VidHlwIGNvbG9yIGluc3RlYWQgb2YgVFlQIGNvbG9yKSBvbmx5IHdoaWxlIHRoZSBtYXJrZXIgaXNcbiAgICAgIC8vIGNvbG9yZWQgYXQgYWxsOiBhbHdheXMgZm9yIHRoZSBkb3QsIGZvciB0aGUgYmFkZ2Ugb25seSB3aXRoIFwiQ29sb3JlZFwiXG4gICAgICAvLyBhbmQgbGFiZWwgW1RZUC9TdWJ0eXBdIC0gd2l0aCBbVFlQXSBvciBbU3VidHlwXSB0aGUgY29sb3IgZm9sbG93cyB0aGVcbiAgICAgIC8vIGxhYmVsLlxuICAgICAgY29uc3QgYmFkZ2VMYWJlbCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlTGFiZWwgPz8gXCJ0eXBcIjtcbiAgICAgIGNvbnN0IHNob3dTdWJ0eXAgPVxuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVTdHlsZSA9PT0gXCJkb3RcIiB8fFxuICAgICAgICAoaXNCYWRnZSAmJiB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUNvbG9yZWQgJiYgYmFkZ2VMYWJlbCA9PT0gXCJ0eXAtc3VidHlwXCIpO1xuICAgICAgaWYgKCFpc0JhZGdlICYmICFzaG93U3VidHlwKSByZXR1cm47XG5cbiAgICAgIC8vIFN0YWNrcyB0aGUgZXh0cmEgdG9nZ2xlcyBpbnN0ZWFkIG9mIE9ic2lkaWFuJ3Mgc2lkZS1ieS1zaWRlIGxheW91dCxcbiAgICAgIC8vIHNlZSAudHlwLW5vdGUtdGl0bGUtc2V0dGluZyBpbiBzdHlsZXMuY3NzLlxuICAgICAgbm90ZVRpdGxlU2V0dGluZy5zZXR0aW5nRWwuYWRkQ2xhc3MoXCJ0eXAtbm90ZS10aXRsZS1zZXR0aW5nXCIpO1xuXG4gICAgICAvLyBBIHNtYWxsIGxhYmVsIHBlciB0b2dnbGUgLSBhZGRUb2dnbGUoKSBhbG9uZSBhZGRzIGEgYmFyZSBzd2l0Y2guXG4gICAgICBjb25zdCBhZGRMYWJlbGVkVG9nZ2xlID0gKGxhYmVsLCB0b29sdGlwLCB2YWx1ZSwgb25DaGFuZ2UpID0+IHtcbiAgICAgICAgY29uc3Qgcm93ID0gbm90ZVRpdGxlU2V0dGluZy5jb250cm9sRWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1ub3RlLXRpdGxlLXRvZ2dsZS1yb3dcIiB9KTtcbiAgICAgICAgcm93LmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLW5vdGUtdGl0bGUtdG9nZ2xlLWxhYmVsXCIsIHRleHQ6IGxhYmVsIH0pO1xuICAgICAgICBuZXcgVG9nZ2xlQ29tcG9uZW50KHJvdykuc2V0VG9vbHRpcCh0b29sdGlwKS5zZXRWYWx1ZSh2YWx1ZSkub25DaGFuZ2Uob25DaGFuZ2UpO1xuICAgICAgfTtcblxuICAgICAgY29uc3QgYWRkU3VidHlwVG9nZ2xlID0gKGxhYmVsKSA9PlxuICAgICAgICBhZGRMYWJlbGVkVG9nZ2xlKFxuICAgICAgICAgIGxhYmVsLFxuICAgICAgICAgIFwiVXNlIFN1YnR5cCBjb2xvciBpbnN0ZWFkIG9mIFRZUCBjb2xvclwiLFxuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Mubm90ZVRpdGxlTWFya2VyU3VidHlwLFxuICAgICAgICAgIGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5ub3RlVGl0bGVNYXJrZXJTdWJ0eXAgPSB2YWx1ZTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgICAgfVxuICAgICAgICApO1xuXG4gICAgICBpZiAoIWlzQmFkZ2UpIHtcbiAgICAgICAgYWRkU3VidHlwVG9nZ2xlKFwiU3VidHlwXCIpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGxhYmVsUm93ID0gbm90ZVRpdGxlU2V0dGluZy5jb250cm9sRWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1ub3RlLXRpdGxlLXRvZ2dsZS1yb3dcIiB9KTtcbiAgICAgIGxhYmVsUm93LmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLW5vdGUtdGl0bGUtdG9nZ2xlLWxhYmVsXCIsIHRleHQ6IFwiTGFiZWxcIiB9KTtcbiAgICAgIG5ldyBEcm9wZG93bkNvbXBvbmVudChsYWJlbFJvdylcbiAgICAgICAgLmFkZE9wdGlvbihcInR5cFwiLCBcIltUWVBdXCIpXG4gICAgICAgIC5hZGRPcHRpb24oXCJ0eXAtc3VidHlwXCIsIFwiW1RZUC9TdWJ0eXBdXCIpXG4gICAgICAgIC5hZGRPcHRpb24oXCJzdWJ0eXBcIiwgXCJbU3VidHlwXVwiKVxuICAgICAgICAuc2V0VmFsdWUoYmFkZ2VMYWJlbClcbiAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlTGFiZWwgPSB2YWx1ZTtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgIGFkZExhYmVsZWRUb2dnbGUoXCJDb2xvcmVkXCIsIFwiQ29sb3JlZCBpbnN0ZWFkIG9mIG5ldXRyYWxcIiwgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VDb2xvcmVkLCBhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VDb2xvcmVkID0gdmFsdWU7XG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICB9KTtcbiAgICAgIGlmIChzaG93U3VidHlwKSBhZGRTdWJ0eXBUb2dnbGUoXCJTdWJ0eXAgY29sb3JcIik7XG5cbiAgICAgIGFkZExhYmVsZWRUb2dnbGUoXCJBdCBwcm9wZXJ0eSBibG9ja1wiLCBcIkF0IHRoZSBwcm9wZXJ0eSBibG9jayAocm90YXRlZCkgaW5zdGVhZCBvZiB0aGUgdGl0bGVcIiwgaXNCbG9ja1Bvc2l0aW9uLCBhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VQb3NpdGlvbiA9IHZhbHVlID8gXCJibG9ja1wiIDogXCJ0aXRsZVwiO1xuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgfSk7XG5cbiAgICAgIGlmIChpc0Jsb2NrUG9zaXRpb24pIHtcbiAgICAgICAgYWRkTGFiZWxlZFRvZ2dsZShcbiAgICAgICAgICBcIlRvcCBpbnN0ZWFkIG9mIGJvdHRvbVwiLFxuICAgICAgICAgIFwiVG9wIG9mIHRoZSBwcm9wZXJ0eSBibG9jayBpbnN0ZWFkIG9mIGJvdHRvbVwiLFxuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVZlcnRpY2FsQWxpZ24gPT09IFwidG9wXCIsXG4gICAgICAgICAgYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVWZXJ0aWNhbEFsaWduID0gdmFsdWUgPyBcInRvcFwiIDogXCJib3R0b21cIjtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgICAgfVxuICAgICAgICApO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29sb3JWaWV3VG9nZ2xlKFxuICAgICAgY29sb3JpbmdHcm91cCxcbiAgICAgIFwiYmFja2xpbmtzXCIsXG4gICAgICBcIkJhY2tsaW5rc1wiLFxuICAgICAgXCJDb2xvciByZXN1bHRzIGluIHRoZSBiYWNrbGlua3MgcGFuZSBhbmQgaW4gZW1iZWRkZWQgYmFja2xpbmtzLCBpbmNsdWRpbmcgdW5saW5rZWQgbWVudGlvbnMuXCIsXG4gICAgICBcImJhY2tsaW5rc1N1YnR5cFwiXG4gICAgKTtcbiAgICBjb2xvclZpZXdUb2dnbGUoY29sb3JpbmdHcm91cCwgXCJib29rbWFya3NcIiwgXCJCb29rbWFya3NcIiwgXCJDb2xvciBib29rbWFya3MgdGhhdCBwb2ludCBkaXJlY3RseSB0byBhIG5vdGUuXCIsIFwiYm9va21hcmtzU3VidHlwXCIpO1xuICAgIGNvbG9yVmlld1RvZ2dsZShcbiAgICAgIGNvbG9yaW5nR3JvdXAsXG4gICAgICBcImFsbFByb3BlcnRpZXNcIixcbiAgICAgIFwiQWxsIFByb3BlcnRpZXNcIixcbiAgICAgIFwiSW4gT2JzaWRpYW4ncyBcXFwiQWxsIHByb3BlcnRpZXNcXFwiIHZpZXcsIGNvbG9yIHByb3BlcnR5IG5hbWVzIHRoYXQgYmVsb25nIHRvIGV4YWN0bHkgb25lIFRZUC1Gcm9udG1hdHRlciwgb3IgYm9sZCB0aGVtIGlmIG1vcmUgdGhhbiBvbmUgVFlQIHVzZXMgdGhlbS4gV2l0aCBTdWJ0eXAsIFN1YnR5cCBibG9ja3MgY291bnQgYXMgd2VsbCwgaW4gdGhlIFN1YnR5cCBjb2xvci5cIixcbiAgICAgIFwiYWxsUHJvcGVydGllc1N1YnR5cFwiLFxuICAgICAgeyB0eXBUb29sdGlwOiBcIlRZUC1Gcm9udG1hdHRlclwiLCBzdWJ0eXBUb29sdGlwOiBcIkluY2x1ZGUgU3VidHlwIGJsb2NrcywgaW4gU3VidHlwIGNvbG9yXCIgfVxuICAgICk7XG5cbiAgICAvLyBMaW1pdHMgb2YgdGhlIHNsaWRlcnMgYSBTdWJ0eXAgZGVyaXZlcyBpdHMgY29sb3Igd2l0aCAoZG90IGF0IHRoZSBib3R0b21cbiAgICAvLyBvZiBhIFN1YnR5cCBibG9jaywgc2VlIHR5cC1jb2xvcnMuanMpLiBBIGxhcmdlciBzdG9yZWQgb2Zmc2V0IGlzIGNsYW1wZWRcbiAgICAvLyB0byB0aGUgbmV3IGxpbWl0LlxuICAgIGNvbnN0IHN1YnR5cENvbG9yR3JvdXAgPSBuZXcgU2V0dGluZ0dyb3VwKGNvbnRhaW5lckVsKS5zZXRIZWFkaW5nKFwiU3VidHlwIGNvbG9yc1wiKTtcbiAgICBjb25zdCByYW5nZU1heCA9IHsgaDogMTgwLCAvKiBzOiAxMDAsICovIGw6IDEwMCB9O1xuICAgIGNvbnN0IHJhbmdlRGVzYyA9IHtcbiAgICAgIGg6IFwiTWF4aW11bSBodWUgZGlmZmVyZW5jZSBiZXR3ZWVuIGEgU3VidHlwIGFuZCBpdHMgVFlQLlwiLFxuICAgICAgLy8gczogXCJNYXhpbXVtIHNoYXJlIGJ5IHdoaWNoIGEgU3VidHlwIG1heSBiZSBwYWxlciB0aGFuIGl0cyBUWVAuIE9ubHkgZ29lcyBkb3duIC0gYSBTdWJ0eXAgc2hvdWxkbid0IGJlIGxvdWRlciB0aGFuIGl0cyBUWVAuXCIsXG4gICAgICBsOiBcIk1heGltdW0gbGlnaHRuZXNzIGRpZmZlcmVuY2UgYmV0d2VlbiBhIFN1YnR5cCBhbmQgaXRzIFRZUCwgYXMgYSBzaGFyZSBvZiB0aGUgd2F5IHRvIHdoaXRlIG9yIGJsYWNrLlwiLFxuICAgIH07XG4gICAgLy8gVGhlIHNsaWRlciByZXBvcnRzIGV2ZXJ5IHN0ZXA7IHRoZSBvdGhlciB2aWV3cyBvbmx5IGZvbGxvdyBvbmNlIGl0IHJlc3RzLlxuICAgIGNvbnN0IHJlZnJlc2hDb2xvcnNTb29uID0gZGVib3VuY2UoKCkgPT4gdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCksIDMwMCwgdHJ1ZSk7XG4gICAgZm9yIChjb25zdCB7IGtleSwgbGFiZWwsIHVuaXQsIGRvd25Pbmx5IH0gb2YgU1VCVFlQX0NPTE9SX0NIQU5ORUxTKSB7XG4gICAgICBzdWJ0eXBDb2xvckdyb3VwLmFkZFNldHRpbmcoKHNldHRpbmcpID0+XG4gICAgICAgIHNldHRpbmdcbiAgICAgICAgICAuc2V0TmFtZShgJHtsYWJlbH0gKCR7ZG93bk9ubHkgPyBcIlx1MjIxMlwiIDogXCJcdTAwQjFcIn0gJHt1bml0fSlgKVxuICAgICAgICAgIC5zZXREZXNjKHJhbmdlRGVzY1trZXldKVxuICAgICAgICAgIC5hZGRTbGlkZXIoKHNsaWRlcikgPT5cbiAgICAgICAgICAgIHNsaWRlclxuICAgICAgICAgICAgICAuc2V0TGltaXRzKDAsIHJhbmdlTWF4W2tleV0sIDEpXG4gICAgICAgICAgICAgIC5zZXRWYWx1ZShjb2xvclJhbmdlKHRoaXMucGx1Z2luLnNldHRpbmdzLCBrZXkpKVxuICAgICAgICAgICAgICAuc2V0RHluYW1pY1Rvb2x0aXAoKVxuICAgICAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Muc3VidHlwQ29sb3JSYW5nZXMgPSB7IC4uLkRFRkFVTFRfU1VCVFlQX0NPTE9SX1JBTkdFUywgLi4udGhpcy5wbHVnaW4uc2V0dGluZ3Muc3VidHlwQ29sb3JSYW5nZXMsIFtrZXldOiB2YWx1ZSB9O1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgICAgIHJlZnJlc2hDb2xvcnNTb29uKCk7XG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgKVxuICAgICAgICAgIC5hZGRFeHRyYUJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICAgICAgYnV0dG9uXG4gICAgICAgICAgICAgIC5zZXRJY29uKFwicm90YXRlLWNjd1wiKVxuICAgICAgICAgICAgICAuc2V0VG9vbHRpcChgUmVzZXQgdG8gJHtERUZBVUxUX1NVQlRZUF9DT0xPUl9SQU5HRVNba2V5XX1gKVxuICAgICAgICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Muc3VidHlwQ29sb3JSYW5nZXMgPSB7IC4uLkRFRkFVTFRfU1VCVFlQX0NPTE9SX1JBTkdFUywgLi4udGhpcy5wbHVnaW4uc2V0dGluZ3Muc3VidHlwQ29sb3JSYW5nZXMsIFtrZXldOiBERUZBVUxUX1NVQlRZUF9DT0xPUl9SQU5HRVNba2V5XSB9O1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICAgICAgICB9KVxuICAgICAgICAgIClcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gR3JvdXAgXCJHcmFwaFwiICh0YWcvYXR0YWNobWVudCBjb2xvcnMpIGRpc2FibGVkICgyMDI2LTA5LTMwKTogdGhlIE1pbmltYWxcbiAgICAvLyB0aGVtZSdzIFN0eWxlIFNldHRpbmdzIGNvdmVyIGJvdGgsIHNlZSBncmFwaC1jb2xvcnMuanMuIENvbG9yaW5nIG5vdGVcbiAgICAvLyBub2RlcyBieSBUWVAgc3RheXMsIHVuZGVyIFwiQ29sb3JpbmdcIiBcdTIxOTIgXCJHcmFwaFwiLlxuICAgIC8vICAgICBjb25zdCBncmFwaEdyb3VwID0gbmV3IFNldHRpbmdHcm91cChjb250YWluZXJFbCkuc2V0SGVhZGluZyhcIkdyYXBoXCIpO1xuICAgIC8vXG4gICAgLy8gICAgIC8vIE9uZSBzZXR0aW5nIHBlciBub2RlIGtpbmQgdGhlIGdyYXBoIGVuZ2luZSBrbm93cywgc2FtZSBsYXlvdXRcbiAgICAvLyAgICAgLy8gKHRvZ2dsZSArIGNvbG9yIHBpY2tlciArIHJlc2V0KSBmb3IgZWFjaC5cbiAgICAvLyAgICAgY29uc3QgZ3JhcGhDb2xvclNldHRpbmcgPSAoZW5hYmxlZEtleSwgY29sb3JLZXksIGRlZmF1bHRDb2xvciwgbmFtZSwgZGVzYykgPT5cbiAgICAvLyAgICAgICBncmFwaEdyb3VwLmFkZFNldHRpbmcoKHNldHRpbmcpID0+XG4gICAgLy8gICAgICAgICBzZXR0aW5nXG4gICAgLy8gICAgICAgICAgIC5zZXROYW1lKG5hbWUpXG4gICAgLy8gICAgICAgICAgIC5zZXREZXNjKGRlc2MpXG4gICAgLy8gICAgICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAvLyAgICAgICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3NbZW5hYmxlZEtleV0pLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgIC8vICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3NbZW5hYmxlZEtleV0gPSB2YWx1ZTtcbiAgICAvLyAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgIC8vICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgLy8gICAgICAgICAgICAgfSlcbiAgICAvLyAgICAgICAgICAgKVxuICAgIC8vICAgICAgICAgICAuYWRkQ29sb3JQaWNrZXIoKHBpY2tlcikgPT5cbiAgICAvLyAgICAgICAgICAgICBwaWNrZXIuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3NbY29sb3JLZXldIHx8IGRlZmF1bHRDb2xvcikub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgLy8gICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5nc1tjb2xvcktleV0gPSB2YWx1ZTtcbiAgICAvLyAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgIC8vICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgLy8gICAgICAgICAgICAgfSlcbiAgICAvLyAgICAgICAgICAgKVxuICAgIC8vICAgICAgICAgICAuYWRkRXh0cmFCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAvLyAgICAgICAgICAgICBidXR0b25cbiAgICAvLyAgICAgICAgICAgICAgIC5zZXRJY29uKFwicm90YXRlLWNjd1wiKVxuICAgIC8vICAgICAgICAgICAgICAgLnNldFRvb2x0aXAoXCJSZXNldCB0byBkZWZhdWx0IGNvbG9yXCIpXG4gICAgLy8gICAgICAgICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgLy8gICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzW2NvbG9yS2V5XSA9IFwiXCI7XG4gICAgLy8gICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgIC8vICAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAvLyAgICAgICAgICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgLy8gICAgICAgICAgICAgICB9KVxuICAgIC8vICAgICAgICAgICApXG4gICAgLy8gICAgICAgKTtcbiAgICAvL1xuICAgIC8vICAgICBncmFwaENvbG9yU2V0dGluZyhcbiAgICAvLyAgICAgICBcImdyYXBoVGFnQ29sb3JFbmFibGVkXCIsXG4gICAgLy8gICAgICAgXCJncmFwaFRhZ0NvbG9yXCIsXG4gICAgLy8gICAgICAgXCIjODg4ODg4XCIsXG4gICAgLy8gICAgICAgXCJUYWcgY29sb3JcIixcbiAgICAvLyAgICAgICBcIk93biBjb2xvciBmb3IgdGFnIG5vZGVzIGluIHRoZSBnbG9iYWwgYW5kIGxvY2FsIGdyYXBoLiBDb2xvciBncm91cHMgc3RpbGwgdGFrZSBwcmVjZWRlbmNlLlwiXG4gICAgLy8gICAgICk7XG4gICAgLy8gICAgIGdyYXBoQ29sb3JTZXR0aW5nKFxuICAgIC8vICAgICAgIFwiZ3JhcGhBdHRhY2htZW50Q29sb3JFbmFibGVkXCIsXG4gICAgLy8gICAgICAgXCJncmFwaEF0dGFjaG1lbnRDb2xvclwiLFxuICAgIC8vICAgICAgIFwiI2UwYWMwMFwiLFxuICAgIC8vICAgICAgIFwiQXR0YWNobWVudCBjb2xvclwiLFxuICAgIC8vICAgICAgIFwiT3duIGNvbG9yIGZvciBhdHRhY2htZW50IG5vZGVzIChub24tbWFya2Rvd24gZmlsZXMgc3VjaCBhcyBpbWFnZXMgb3IgUERGcykgaW4gdGhlIGdyYXBoLlwiXG4gICAgLy8gICAgICk7XG5cbiAgICBjb25zdCBmcm9udG1hdHRlckdyb3VwID0gbmV3IFNldHRpbmdHcm91cChjb250YWluZXJFbCkuc2V0SGVhZGluZyhcIlRZUC1Gcm9udG1hdHRlclwiKTtcblxuICAgIGNvbG9yVmlld1RvZ2dsZShcbiAgICAgIGZyb250bWF0dGVyR3JvdXAsXG4gICAgICBcImZyb250bWF0dGVyRGVmYXVsdHNcIixcbiAgICAgIFwiQm9sZCBUWVAgcHJvcGVydGllc1wiLFxuICAgICAgXCJTaG93IFRZUC1Gcm9udG1hdHRlciBwcm9wZXJ0eSBuYW1lcyBpbiBib2xkIGluIG5vdGVzIGFuZCB0aGUgcHJvcGVydGllcyBzaWRlYmFyLiBXaXRoIFN1YnR5cCwgdGhlIG5vdGUncyBTdWJ0eXAgYmxvY2sgY291bnRzIGFzIHdlbGwuXCIsXG4gICAgICBcImZyb250bWF0dGVyRGVmYXVsdHNTdWJ0eXBcIixcbiAgICAgIHsgdHlwVG9vbHRpcDogXCJUWVAtRnJvbnRtYXR0ZXJcIiwgc3VidHlwVG9vbHRpcDogXCJJbmNsdWRlIFN1YnR5cCBibG9ja3NcIiB9XG4gICAgKTtcblxuICAgIC8vIFRoZSBvcmRlciBlZGl0b3IgYnJpbmdzIGl0cyBvd24gaGVhZGluZyBhbmQgYnV0dG9ucywgc28gaXQgZ29lcyBzdHJhaWdodFxuICAgIC8vIGludG8gaW5mb0VsIGluc3RlYWQgb2Ygc2V0TmFtZS9zZXREZXNjIChzZWUgLnR5cC1vcmRlci1zZXR0aW5nKS5cbiAgICBmcm9udG1hdHRlckdyb3VwLmFkZFNldHRpbmcoKHNldHRpbmcpID0+IHtcbiAgICAgIHNldHRpbmcuc2V0dGluZ0VsLmFkZENsYXNzKFwidHlwLW9yZGVyLXNldHRpbmdcIik7XG4gICAgICBtb3VudEdsb2JhbE9yZGVyRWRpdG9yKHNldHRpbmcuaW5mb0VsLCB0aGlzLnBsdWdpbik7XG4gICAgICBzZXR0aW5nLmluZm9FbC5jcmVhdGVEaXYoe1xuICAgICAgICBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIsXG4gICAgICAgIHRleHQ6XG4gICAgICAgICAgJ09yZGVyIGFwcGxpZWQgYnkgdGhlIFwiU29ydCBmcm9udG1hdHRlclwiIGNvbW1hbmRzOyB2YWx1ZXMgYXJlIG5ldmVyIGNoYW5nZWQuIFBpbiBzaW5nbGUgcHJvcGVydGllcyBzdWNoIGFzIGNzc2NsYXNzZXMgb3IgYWxpYXNlcy4gVFlQIGFuZCBTVUJUWVAgYXJlIHRoZSBwcm9wZXJ0aWVzIHRoZW1zZWx2ZXMsIFwiVFlQLUZyb250bWF0dGVyXCIgaXMgdGhlIFRZUFxcJ3MgbGlzdCBmb2xsb3dlZCBieSBpdHMgU3VidHlwIGJsb2NrLCBcIk90aGVyIHByb3BlcnRpZXNcIiBpcyBldmVyeXRoaW5nIGVsc2UuIERyYWcgdG8gcmVvcmRlcjsgdGhlIGZvdXIgcGxhY2Vob2xkZXIgcm93cyBjYW5cXCd0IGJlIHJlbW92ZWQuJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgY29udGFpbmVyRWwuc2Nyb2xsVG9wID0gc2Nyb2xsVG9wO1xuICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBERUZBVUxUX1NFVFRJTkdTLCBUeXBTeXN0ZW1TZXR0aW5nVGFiIH07XG4iLCAiY29uc3QgeyBNb2RhbCwgU2V0dGluZyB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBwbHVyYWwgfSA9IHJlcXVpcmUoXCIuL3R5cC11dGlsc1wiKTtcblxuLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gKiBUaGUgdHdvIGRpYWxvZ3Mgb2YgdGhlIEJhc2UgY29tbWFuZHMgKHNlZSBiYXNlcy5qcyk6XG4gKiAgLSBjb2x1bW4gb3B0aW9ucyBiZWZvcmUgY3JlYXRpbmcvdXBkYXRpbmdcbiAqICAtIGNvbmZpcm1pbmcgcmVtb3ZhbHMgd2hlbiB1cGRhdGluZ1xuICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovXG5cbmNvbnN0IE5PVEVfUFJFRklYID0gXCJub3RlLlwiO1xuXG4vLyBDb2x1bW4gbGFiZWw6IHRoZSBzaG9ydCBmb3JtIHRoZSBwcm9wZXJ0eSBoYXMgaW4gdGhlIC5iYXNlIGZpbGVcbi8vIChcIlRpdGVsXCIgaW5zdGVhZCBvZiBcIm5vdGUuVGl0ZWxcIikuXG5mdW5jdGlvbiBjb2x1bW5MYWJlbChpZCkge1xuICByZXR1cm4gaWQuc3RhcnRzV2l0aChOT1RFX1BSRUZJWCkgPyBpZC5zbGljZShOT1RFX1BSRUZJWC5sZW5ndGgpIDogaWQ7XG59XG5cbmZ1bmN0aW9uIHRhcmdldExhYmVsKHRhcmdldCkge1xuICBpZiAoIXRhcmdldC50eXApIHJldHVybiBgU3VidHlwICR7dGFyZ2V0LnN1YnR5cH1gO1xuICByZXR1cm4gdGFyZ2V0LnN1YnR5cCA/IGAke3RhcmdldC50eXB9IC8gJHt0YXJnZXQuc3VidHlwfWAgOiBgVFlQICR7dGFyZ2V0LnR5cH1gO1xufVxuXG4vKiAtLS0gQ29sdW1uIG9wdGlvbnMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbi8vIFRocmVlIHRvZ2dsZXMsIGFsbCBvZmYgYnkgZGVmYXVsdCAoZmlsZS5uYW1lIHBsdXMgVFlQLUZyb250bWF0dGVyIGlzIHRoZVxuLy8gbm9ybWFsIGNhc2UpLCB3aXRoIGEgbGl2ZSBwcmV2aWV3IG9mIHRoZSByZXN1bHRpbmcgY29sdW1ucyBzbyBhIHRvZ2dsZSdzXG4vLyBlZmZlY3QgbmVlZG4ndCBiZSBndWVzc2VkLiBcIkFsbCBTdWJ0eXAgcHJvcGVydGllc1wiIG9ubHkgc2hvd3MgZm9yIGEgVFlQXG4vLyB0YXJnZXQ6IGluIGEgU3VidHlwIHZpZXcgdGhlIG90aGVyIFN1YnR5cCBibG9ja3Mgd291bGQgc3RheSBlbXB0eS5cbmNsYXNzIENvbHVtbk9wdGlvbnNNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgY29uc3RydWN0b3IocGx1Z2luLCB0YXJnZXQsIHByZXZpZXcsIHJlc29sdmUpIHtcbiAgICBzdXBlcihwbHVnaW4uYXBwKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgICB0aGlzLnRhcmdldCA9IHRhcmdldDtcbiAgICB0aGlzLnByZXZpZXcgPSBwcmV2aWV3O1xuICAgIHRoaXMucmVzb2x2ZSA9IHJlc29sdmU7XG4gICAgdGhpcy5vcHRpb25zID0geyBmbG9hdGluZzogZmFsc2UsIGFsbFN1YnR5cHM6IGZhbHNlLCB0YWdzOiBmYWxzZSB9O1xuICAgIHRoaXMuY29uZmlybWVkID0gZmFsc2U7XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgdGhpcy5tb2RhbEVsLmFkZENsYXNzKFwidHlwLWJhc2Utb3B0aW9ucy1tb2RhbFwiKTtcbiAgICB0aGlzLnRpdGxlRWwuc2V0VGV4dChgQ29sdW1ucyBmb3IgJHt0YXJnZXRMYWJlbCh0aGlzLnRhcmdldCl9YCk7XG5cbiAgICBjb25zdCB0b2dnbGUgPSAobmFtZSwgZGVzY3JpcHRpb24sIGtleSkgPT4ge1xuICAgICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgICAuc2V0TmFtZShuYW1lKVxuICAgICAgICAuc2V0RGVzYyhkZXNjcmlwdGlvbilcbiAgICAgICAgLmFkZFRvZ2dsZSgoY29udHJvbCkgPT5cbiAgICAgICAgICBjb250cm9sLnNldFZhbHVlKHRoaXMub3B0aW9uc1trZXldKS5vbkNoYW5nZSgodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMub3B0aW9uc1trZXldID0gdmFsdWU7XG4gICAgICAgICAgICB0aGlzLnJlbmRlclByZXZpZXcoKTtcbiAgICAgICAgICB9KVxuICAgICAgICApO1xuICAgIH07XG5cbiAgICB0b2dnbGUoXCJGbG9hdGluZyBwcm9wZXJ0aWVzXCIsIFwiSW5jbHVkZSB0aGUgYmxvY2sncyBmbG9hdGluZyAoaXRhbGljKSBwcm9wZXJ0aWVzLlwiLCBcImZsb2F0aW5nXCIpO1xuICAgIGlmICghdGhpcy50YXJnZXQuc3VidHlwKSB7XG4gICAgICB0b2dnbGUoXCJBbGwgU3VidHlwIHByb3BlcnRpZXNcIiwgXCJBbHNvIGluY2x1ZGUgdGhlIHByb3BlcnRpZXMgb2YgZXZlcnkgU3VidHlwIGJsb2NrIG9mIHRoaXMgVFlQLlwiLCBcImFsbFN1YnR5cHNcIik7XG4gICAgfVxuICAgIHRvZ2dsZShcInRhZ3NcIiwgXCJBZGQgdGhlIHRhZ3MgcHJvcGVydHkgYXMgYSBjb2x1bW4uXCIsIFwidGFnc1wiKTtcblxuICAgIHRoaXMucHJldmlld0VsID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtYmFzZS1wcmV2aWV3XCIgfSk7XG4gICAgdGhpcy5yZW5kZXJQcmV2aWV3KCk7XG5cbiAgICBjb25zdCBidXR0b25Sb3cgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcIm1vZGFsLWJ1dHRvbi1jb250YWluZXJcIiB9KTtcbiAgICBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkNhbmNlbFwiIH0pLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xuICAgIGNvbnN0IGNvbmZpcm0gPSBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IFwibW9kLWN0YVwiLCB0ZXh0OiBcIkFwcGx5XCIgfSk7XG4gICAgY29uZmlybS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5jb25maXJtZWQgPSB0cnVlO1xuICAgICAgdGhpcy5jbG9zZSgpO1xuICAgIH0pO1xuICB9XG5cbiAgcmVuZGVyUHJldmlldygpIHtcbiAgICBjb25zdCBpZHMgPSB0aGlzLnByZXZpZXcodGhpcy5vcHRpb25zKTtcbiAgICB0aGlzLnByZXZpZXdFbC5lbXB0eSgpO1xuICAgIHRoaXMucHJldmlld0VsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtYmFzZS1wcmV2aWV3LXRpdGxlXCIsIHRleHQ6IHBsdXJhbChpZHMubGVuZ3RoLCBcImNvbHVtblwiKSB9KTtcbiAgICBjb25zdCBsaXN0ID0gdGhpcy5wcmV2aWV3RWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1iYXNlLXByZXZpZXctbGlzdFwiIH0pO1xuICAgIGZvciAoY29uc3QgaWQgb2YgaWRzKSBsaXN0LmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLWJhc2UtcHJldmlldy1jb2x1bW5cIiwgdGV4dDogY29sdW1uTGFiZWwoaWQpIH0pO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIC8vIEVTQyBvciBhIGNsaWNrIG91dHNpZGUgY291bnRzIGFzIGNhbmNlbC5cbiAgICB0aGlzLnJlc29sdmUodGhpcy5jb25maXJtZWQgPyB0aGlzLm9wdGlvbnMgOiBudWxsKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBhc2tDb2x1bW5PcHRpb25zKHBsdWdpbiwgdGFyZ2V0LCBwcmV2aWV3KSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gbmV3IENvbHVtbk9wdGlvbnNNb2RhbChwbHVnaW4sIHRhcmdldCwgcHJldmlldywgcmVzb2x2ZSkub3BlbigpKTtcbn1cblxuLyogLS0tIENvbmZpcm0gcmVtb3ZhbHMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuXG4vLyBBZGRpbmcgYW5kIHJlb3JkZXJpbmcgY29sdW1ucyBoYXBwZW4gc2lsZW50bHk7IG9ubHkgcmVtb3ZpbmcgaXMgc2hvd24sXG4vLyBiZWNhdXNlIG9ubHkgdGhhdCBsb3NlcyBzb21ldGhpbmcuIEV2ZXJ5IGVudHJ5IHN0YXJ0cyBjaGVja2VkOyBhbiB1bmNoZWNrZWRcbi8vIGNvbHVtbiBpcyBrZXB0IChhdCB0aGUgZnJvbnQsIHNlZSB1cGRhdGVBY3RpdmVWaWV3KS5cbmNsYXNzIFJlbW92YWxNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgY29uc3RydWN0b3IocGx1Z2luLCBjb2x1bW5zLCB2aWV3TmFtZSwgcmVzb2x2ZSkge1xuICAgIHN1cGVyKHBsdWdpbi5hcHApO1xuICAgIHRoaXMuY29sdW1ucyA9IGNvbHVtbnM7XG4gICAgdGhpcy52aWV3TmFtZSA9IHZpZXdOYW1lO1xuICAgIHRoaXMucmVzb2x2ZSA9IHJlc29sdmU7XG4gICAgdGhpcy5tYXJrZWQgPSBuZXcgU2V0KGNvbHVtbnMpO1xuICAgIHRoaXMuY29uZmlybWVkID0gZmFsc2U7XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgdGhpcy5tb2RhbEVsLmFkZENsYXNzKFwidHlwLWJhc2UtcmVtb3ZhbC1tb2RhbFwiKTtcbiAgICB0aGlzLnRpdGxlRWwuc2V0VGV4dChgUmVtb3ZlIGNvbHVtbnMgZnJvbSBcIiR7dGhpcy52aWV3TmFtZX1cImApO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgY2xzOiBcInR5cC1iYXNlLXJlbW92YWwtaW50cm9cIixcbiAgICAgIHRleHQ6IFwiVGhlc2UgY29sdW1ucyBkb24ndCBiZWxvbmcgdG8gdGhlIFRZUC4gVW5jaGVja2VkIG9uZXMgYXJlIGtlcHQuXCIsXG4gICAgfSk7XG5cbiAgICBmb3IgKGNvbnN0IGlkIG9mIHRoaXMuY29sdW1ucykge1xuICAgICAgbmV3IFNldHRpbmcoY29udGVudEVsKS5zZXROYW1lKGNvbHVtbkxhYmVsKGlkKSkuYWRkVG9nZ2xlKChjb250cm9sKSA9PlxuICAgICAgICBjb250cm9sLnNldFZhbHVlKHRydWUpLm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGlmICh2YWx1ZSkgdGhpcy5tYXJrZWQuYWRkKGlkKTtcbiAgICAgICAgICBlbHNlIHRoaXMubWFya2VkLmRlbGV0ZShpZCk7XG4gICAgICAgIH0pXG4gICAgICApO1xuICAgIH1cblxuICAgIGNvbnN0IGJ1dHRvblJvdyA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibW9kYWwtYnV0dG9uLWNvbnRhaW5lclwiIH0pO1xuICAgIGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiQ2FuY2VsXCIgfSkuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY2xvc2UoKSk7XG4gICAgY29uc3QgY29uZmlybSA9IGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IGNsczogXCJtb2QtY3RhXCIsIHRleHQ6IFwiQXBwbHlcIiB9KTtcbiAgICBjb25maXJtLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICB0aGlzLmNvbmZpcm1lZCA9IHRydWU7XG4gICAgICB0aGlzLmNsb3NlKCk7XG4gICAgfSk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gICAgdGhpcy5yZXNvbHZlKHRoaXMuY29uZmlybWVkID8gdGhpcy5tYXJrZWQgOiBudWxsKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBhc2tSZW1vdmFscyhwbHVnaW4sIGNvbHVtbnMsIHZpZXdOYW1lKSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gbmV3IFJlbW92YWxNb2RhbChwbHVnaW4sIGNvbHVtbnMsIHZpZXdOYW1lLCByZXNvbHZlKS5vcGVuKCkpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgYXNrQ29sdW1uT3B0aW9ucywgYXNrUmVtb3ZhbHMgfTtcbiIsICJjb25zdCB7IE5vdGljZSwgVEZpbGUsIHN0cmluZ2lmeVlhbWwgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgZ2V0U3VidHlwTmFtZXMgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cHNcIik7XG5jb25zdCB7IG5vcm1hbGl6ZUdsb2JhbE9yZGVyLCBUWVBfUFJPUEVSVFksIFNVQlRZUF9QUk9QRVJUWSB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItc29ydFwiKTtcbmNvbnN0IHsgYXNrQ29sdW1uT3B0aW9ucywgYXNrUmVtb3ZhbHMgfSA9IHJlcXVpcmUoXCIuL2Jhc2UtZGlhbG9nc1wiKTtcbmNvbnN0IHsgcGx1cmFsIH0gPSByZXF1aXJlKFwiLi90eXAtdXRpbHNcIik7XG5cbi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICogQmFzZXMgZnJvbSBhIFRZUFxuICogQ3JlYXRlcyBhIC5iYXNlIGluIHRoZSB2YXVsdCByb290IGZvciBhIFRZUCAob3IgYSBTdWJ0eXAgbmFtZSk6XG4gKiBhIFRZUCBmaWx0ZXIsIG9uZSB0YWJsZSB2aWV3IHBlciBTdWJ0eXAsIGFuZCBjb2x1bW5zIGZyb20gdGhlXG4gKiBUWVAtRnJvbnRtYXR0ZXIgcGx1cyB0aGUgZ2xvYmFsIHByb3BlcnR5IG9yZGVyLiBUaGUgc2Vjb25kXG4gKiBjb21tYW5kIGJyaW5ncyB0aGUgY29sdW1ucyBvZiBhbiBleGlzdGluZyB2aWV3IHVwIHRvIGRhdGUuXG4gKlxuICogV3JpdGVzIG9ubHkgdGhyb3VnaCBPYnNpZGlhbidzIG93biBCYXNlcyBBUEkgYW5kIHNlcmlhbGl6YXRpb25cbiAqIChzZWUgYXBwZW5kVmlld3MpLCBuZXZlciB0aHJvdWdoIHNlbGYtcGFyc2VkIFlBTUwgLSBmb3JtdWxhXG4gKiBibG9ja3MgYW5kIHNwZWNpYWwga2V5cyB3b3VsZG4ndCByZWxpYWJseSBzdXJ2aXZlIHRoZSByb3VuZCB0cmlwLlxuICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovXG5cbi8vIFZpZXcgcHJvcGVydHkgaWRzIGFyZSBmdWxseSBxdWFsaWZpZWQgaW4gbWVtb3J5IChcIm5vdGUuVGl0ZWxcIiwgXCJmaWxlLm5hbWVcIixcbi8vIFwiZm9ybXVsYS5YXCIpIGJ1dCBzdG9yZWQgd2l0aG91dCBcIm5vdGUuXCIgaW4gdGhlIGZpbGUuIGNmZy5zZXRPcmRlcigpIHdhbnRzXG4vLyB0aGUgcXVhbGlmaWVkIGZvcm0sIGEgdmlldyBvYmplY3QgYnVpbHQgZm9yIHRoZSBmaWxlIHRoZSBzaG9ydCBvbmUgLVxuLy8gc2VyaWFsaXplSWQoKSBjb252ZXJ0cy5cbmNvbnN0IEZJTEVfTkFNRV9JRCA9IFwiZmlsZS5uYW1lXCI7XG5jb25zdCBOT1RFX1BSRUZJWCA9IFwibm90ZS5cIjtcbmNvbnN0IFRBR1NfUFJPUEVSVFkgPSBcInRhZ3NcIjtcbmNvbnN0IEJBU0VfRVhURU5TSU9OID0gXCJiYXNlXCI7XG4vLyBJZCBvZiB0aGUgQmFzZXMgY29yZSBwbHVnaW4gKGFzIGluIC5vYnNpZGlhbi9jb3JlLXBsdWdpbnMuanNvbikuXG5jb25zdCBCQVNFU19QTFVHSU5fSUQgPSBcImJhc2VzXCI7XG5cbi8vIFdpdGhvdXQgdGhlIEJhc2VzIGNvcmUgcGx1Z2luIGEgLmJhc2UgZmlsZSBjYW4ndCBiZSBvcGVuZWQsIHNvIGNyZWF0aW5nIG9uZVxuLy8gd291bGQgb25seSBsZWF2ZSBhIGRlYWQgZmlsZSBiZWhpbmQgKHNlZSBcImNyZWF0ZS1iYXNlLWZvci10eXBcIiBpblxuLy8gY29tbWFuZHMuanMpLlxuZnVuY3Rpb24gaXNCYXNlc0VuYWJsZWQoYXBwKSB7XG4gIHJldHVybiAhIWFwcC5pbnRlcm5hbFBsdWdpbnM/LmdldEVuYWJsZWRQbHVnaW5CeUlkPy4oQkFTRVNfUExVR0lOX0lEKTtcbn1cblxuZnVuY3Rpb24gbm90ZUlkKGtleSkge1xuICByZXR1cm4gTk9URV9QUkVGSVggKyBrZXk7XG59XG5cbmZ1bmN0aW9uIHNlcmlhbGl6ZUlkKGlkKSB7XG4gIHJldHVybiBpZC5zdGFydHNXaXRoKE5PVEVfUFJFRklYKSA/IGlkLnNsaWNlKE5PVEVfUFJFRklYLmxlbmd0aCkgOiBpZDtcbn1cblxuZnVuY3Rpb24gc2FtZUlkKGEsIGIpIHtcbiAgcmV0dXJuIGEudG9Mb3dlckNhc2UoKSA9PT0gYi50b0xvd2VyQ2FzZSgpO1xufVxuXG4vLyBBIGZpbHRlciBleHByZXNzaW9uIHRoZSB3YXkgQmFzZXMgd3JpdGVzIGl0OiBUWVAgPT0gXCJNRURJQVwiLiBKU09OLnN0cmluZ2lmeVxuLy8gcXVvdGVzIGNvcnJlY3RseSBldmVuIGlmIHRoZSBuYW1lIGNvbnRhaW5zIGEgcXVvdGUuXG5mdW5jdGlvbiBlcXVhbHNGaWx0ZXIocHJvcGVydHksIHZhbHVlKSB7XG4gIHJldHVybiBgJHtwcm9wZXJ0eX0gPT0gJHtKU09OLnN0cmluZ2lmeShTdHJpbmcodmFsdWUpKX1gO1xufVxuXG4vKiAtLS0gUmVhZGluZyBUWVAvU3VidHlwIGZyb20gYW4gZXhpc3RpbmcgZmlsdGVyIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gKiBBIGdlbmVyYXRlZCB2aWV3IGNhcnJpZXMgaXRzIFRZUCBpbiB0aGUgcm9vdCBvciB2aWV3IGZpbHRlcjsgdGhlIHVwZGF0ZVxuICogY29tbWFuZCByZWFkcyBpdCBmcm9tIHRoZXJlIGluc3RlYWQgb2YgYXNraW5nLiBPbmx5IHVuYW1iaWd1b3VzIGZpbHRlcnNcbiAqIGNvdW50OiBhIHB1cmUgQU5EIHdpdGggZXhhY3RseSBvbmUgVFlQIG9yIFNVQlRZUCBjb21wYXJpc29uLiBBbiBPUiBncm91cFxuICogZG9lc24ndCBuZWNlc3NhcmlseSByZXN0cmljdCwgYW5kIGEgc2Vjb25kLCBkaWZmZXJlbnQgdmFsdWUgY29udHJhZGljdHMgLVxuICogYm90aCBnaXZlIG51bGwgYW5kIHRoZSBjb21tYW5kIGFza3MgaW5zdGVhZCAoc2VlIHVwZGF0ZUFjdGl2ZVZpZXcpLlxuICogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5jb25zdCBFUVVBTFNfUEFUVEVSTiA9IG5ldyBSZWdFeHAoYF5cXFxccyooJHtUWVBfUFJPUEVSVFl9fCR7U1VCVFlQX1BST1BFUlRZfSlcXFxccyo9PVxcXFxzKiguKz8pXFxcXHMqJGAsIFwiaVwiKTtcblxuZnVuY3Rpb24gZmlsdGVyTGl0ZXJhbChyYXcpIHtcbiAgaWYgKHJhdy5sZW5ndGggPj0gMiAmJiByYXdbMF0gPT09ICdcIicgJiYgcmF3LmVuZHNXaXRoKCdcIicpKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBKU09OLnBhcnNlKHJhdyk7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH1cbiAgaWYgKHJhdy5sZW5ndGggPj0gMiAmJiByYXdbMF0gPT09IFwiJ1wiICYmIHJhdy5lbmRzV2l0aChcIidcIikpIHJldHVybiByYXcuc2xpY2UoMSwgLTEpO1xuICByZXR1cm4gbnVsbDtcbn1cblxuZnVuY3Rpb24gY29sbGVjdEVxdWFscyhub2RlLCBmb3VuZCkge1xuICBpZiAoIW5vZGUpIHJldHVybjtcbiAgaWYgKHR5cGVvZiBub2RlID09PSBcInN0cmluZ1wiKSB7XG4gICAgY29uc3QgbWF0Y2ggPSBFUVVBTFNfUEFUVEVSTi5leGVjKG5vZGUpO1xuICAgIGlmICghbWF0Y2gpIHJldHVybjtcbiAgICBjb25zdCB2YWx1ZSA9IGZpbHRlckxpdGVyYWwobWF0Y2hbMl0pO1xuICAgIGlmICh2YWx1ZSAhPT0gbnVsbCkgZm91bmRbbWF0Y2hbMV0udG9VcHBlckNhc2UoKV0uYWRkKHZhbHVlKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKEFycmF5LmlzQXJyYXkobm9kZSkpIHtcbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIG5vZGUpIGNvbGxlY3RFcXVhbHMoZW50cnksIGZvdW5kKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gQU5EIG9ubHk6IGFuIE9SL05PVCBncm91cCBzYXlzIG5vdGhpbmcgcmVsaWFibGUgYWJvdXQgdGhlIFRZUCBvZiB0aGUgaGl0cy5cbiAgaWYgKG5vZGUuYW5kKSBjb2xsZWN0RXF1YWxzKG5vZGUuYW5kLCBmb3VuZCk7XG59XG5cbmZ1bmN0aW9uIHJlYWRUYXJnZXQoLi4uZmlsdGVyR3JvdXBzKSB7XG4gIGNvbnN0IGZvdW5kID0geyBbVFlQX1BST1BFUlRZXTogbmV3IFNldCgpLCBbU1VCVFlQX1BST1BFUlRZXTogbmV3IFNldCgpIH07XG4gIGZvciAoY29uc3QgZ3JvdXAgb2YgZmlsdGVyR3JvdXBzKSBjb2xsZWN0RXF1YWxzKGdyb3VwLCBmb3VuZCk7XG4gIGNvbnN0IHR5cHMgPSBbLi4uZm91bmRbVFlQX1BST1BFUlRZXV07XG4gIGNvbnN0IHN1YnR5cHMgPSBbLi4uZm91bmRbU1VCVFlQX1BST1BFUlRZXV07XG4gIGlmICh0eXBzLmxlbmd0aCA+IDEgfHwgc3VidHlwcy5sZW5ndGggPiAxKSByZXR1cm4gbnVsbDtcbiAgaWYgKHR5cHMubGVuZ3RoID09PSAwICYmIHN1YnR5cHMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHsgdHlwOiB0eXBzWzBdID8/IG51bGwsIHN1YnR5cDogc3VidHlwc1swXSA/PyBudWxsIH07XG59XG5cbi8qIC0tLSBDb2x1bW5zIG9mIGEgdGFyZ2V0IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuLy8gVFlQIGFuZCBTVUJUWVAgbmV2ZXIgYmVjb21lIGNvbHVtbnMgKGZpbHRlciBhbmQgZ3JvdXBpbmcgYWxyZWFkeSBzaG93XG4vLyB0aGVtKSwgbm9yIGRvZXMgdGhlIGVkaXRvcidzIGJsYW5rIHJvdy5cbmZ1bmN0aW9uIGlzU3lzdGVtS2V5KGtleSkge1xuICByZXR1cm4ga2V5ID09PSBcIlwiIHx8IHNhbWVJZChrZXksIFRZUF9QUk9QRVJUWSkgfHwgc2FtZUlkKGtleSwgU1VCVFlQX1BST1BFUlRZKTtcbn1cblxuLy8gQSBibG9jaydzIHByb3BlcnRpZXMgaW4gc3RvcmVkIG9yZGVyLCB2aWEgY29sbGVjdEJsb2NrcygpIChtYWluLmpzKSwgc28gdGhlXG4vLyBzYW1lIHJ1bGVzIGFwcGx5OiB0aGUgU3VidHlwIGJsb2NrIGZvbGxvd3MgdGhlIFRZUC1Gcm9udG1hdHRlciwgYSBrZXkgaW4gYm90aFxuLy8ga2VlcHMgdGhlIFRZUC1Gcm9udG1hdHRlciBwb3NpdGlvbiwgYW5kIHRoZSBTdWJ0eXAncyBmbG9hdGluZyBmbGFnIHdpbnMgLSBhXG4vLyBTdWJ0eXAgY2FuIGtlZXAgYSBzdGFuZGFyZCBwcm9wZXJ0eSBvdXQgb2YgaXRzIHZpZXcgdGhhdCB3YXkuXG5mdW5jdGlvbiBibG9ja0tleXMocGx1Z2luLCB0eXAsIHN1YnR5cCwgaW5jbHVkZUZsb2F0aW5nKSB7XG4gIGNvbnN0IHsgZGVmYXVsdHMgfSA9IHBsdWdpbi5jb2xsZWN0QmxvY2tzKHR5cCwgc3VidHlwLCBpbmNsdWRlRmxvYXRpbmcpO1xuICByZXR1cm4gT2JqZWN0LmtleXMoZGVmYXVsdHMpLmZpbHRlcigoa2V5KSA9PiAhaXNTeXN0ZW1LZXkoa2V5KSk7XG59XG5cbi8vIEV2ZXJ5IFRZUCB0aGF0IGhhcyBhIFN1YnR5cCBvZiB0aGlzIG5hbWUsIGluIFRZUC1MaXN0IG9yZGVyLiBUaGUgc2FtZVxuLy8gU3VidHlwIG5hbWUgbWF5IGV4aXN0IHVuZGVyIHNldmVyYWwgVFlQIGVudHJpZXM7IGEgc3RhbmRhbG9uZSBTdWJ0eXAgQmFzZVxuLy8gZmlsdGVycyBieSBTVUJUWVAgb25seSBhbmQgc28gc2hvd3MgYWxsIG9mIHRoZW0uXG5mdW5jdGlvbiB0eXBzRm9yU3VidHlwKHBsdWdpbiwgc3VidHlwKSB7XG4gIHJldHVybiBwbHVnaW4uc2V0dGluZ3MudHlwcy5maWx0ZXIoKHR5cCkgPT4gZ2V0U3VidHlwTmFtZXMocGx1Z2luLnNldHRpbmdzLCB0eXApLmluY2x1ZGVzKHN1YnR5cCkpO1xufVxuXG4vLyBBIHRhcmdldCBpcyB7IHR5cCwgc3VidHlwIH06XG4vLyAgIHsgdHlwLCBzdWJ0eXA6IG51bGwgfSAgLSB0aGUgVFlQIGl0c2VsZlxuLy8gICB7IHR5cCwgc3VidHlwIH0gICAgICAgIC0gYSBTdWJ0eXAgd2l0aGluIGl0cyBUWVBcbi8vICAgeyB0eXA6IG51bGwsIHN1YnR5cCB9ICAtIGEgU3VidHlwIG5hbWUgbm90IGJvdW5kIHRvIGEgVFlQIChzdGFuZGFsb25lXG4vLyAgICAgICAgICAgICAgICAgICAgICAgICAgICBTdWJ0eXAgQmFzZSwgY29sdW1ucyBtZXJnZWQgYWNyb3NzIFRZUCBlbnRyaWVzKVxuZnVuY3Rpb24gdGFyZ2V0S2V5cyhwbHVnaW4sIHRhcmdldCwgb3B0aW9ucykge1xuICBjb25zdCBzZWVuID0gbmV3IFNldCgpO1xuICBjb25zdCBtYWluID0gW107XG4gIGNvbnN0IG90aGVycyA9IFtdO1xuICBjb25zdCBhZGQgPSAobGlzdCwga2V5cykgPT4ge1xuICAgIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICAgIGNvbnN0IGxvd2VyID0ga2V5LnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAoc2Vlbi5oYXMobG93ZXIpKSBjb250aW51ZTtcbiAgICAgIHNlZW4uYWRkKGxvd2VyKTtcbiAgICAgIGxpc3QucHVzaChrZXkpO1xuICAgIH1cbiAgfTtcblxuICBpZiAoIXRhcmdldC50eXApIHtcbiAgICBmb3IgKGNvbnN0IHR5cCBvZiB0eXBzRm9yU3VidHlwKHBsdWdpbiwgdGFyZ2V0LnN1YnR5cCkpIHtcbiAgICAgIGFkZChtYWluLCBibG9ja0tleXMocGx1Z2luLCB0eXAsIHRhcmdldC5zdWJ0eXAsIG9wdGlvbnMuZmxvYXRpbmcpKTtcbiAgICB9XG4gICAgcmV0dXJuIHsgbWFpbiwgb3RoZXJzIH07XG4gIH1cblxuICBhZGQobWFpbiwgYmxvY2tLZXlzKHBsdWdpbiwgdGFyZ2V0LnR5cCwgdGFyZ2V0LnN1YnR5cCwgb3B0aW9ucy5mbG9hdGluZykpO1xuICAvLyBPbmx5IGZvciB0aGUgVFlQIHZpZXc6IGluIGEgU3VidHlwIHZpZXcgdGhlIG90aGVyIGJsb2NrcyB3b3VsZCBzdGF5IGVtcHR5LFxuICAvLyBzaW5jZSBhIG5vdGUgaGFzIGF0IG1vc3Qgb25lIFNVQlRZUC4gS2V5cyBhbHJlYWR5IGluIG1haW4gZHJvcCBvdXQgdmlhXG4gIC8vIFwic2VlblwiLlxuICBpZiAob3B0aW9ucy5hbGxTdWJ0eXBzICYmICF0YXJnZXQuc3VidHlwKSB7XG4gICAgZm9yIChjb25zdCBzdWJ0eXAgb2YgZ2V0U3VidHlwTmFtZXMocGx1Z2luLnNldHRpbmdzLCB0YXJnZXQudHlwKSkge1xuICAgICAgYWRkKG90aGVycywgYmxvY2tLZXlzKHBsdWdpbiwgdGFyZ2V0LnR5cCwgc3VidHlwLCBvcHRpb25zLmZsb2F0aW5nKSk7XG4gICAgfVxuICB9XG4gIHJldHVybiB7IG1haW4sIG90aGVycyB9O1xufVxuXG4vLyBUaGUgZmluYWwgY29sdW1uIGxpc3Q6IGZpbGUubmFtZSBmaXJzdCwgdGhlbiB0aGUgZ2xvYmFsIHByb3BlcnR5IG9yZGVyIGFzXG4vLyB0aGUgZnJhbWUuIEl0cyBwbGFjZWhvbGRlcnMgbWVhbiBoZXJlOlxuLy8gICBcInR5cFwiICAgICAgICAgICAgICAgICAgICAgLSBUWVAtRnJvbnRtYXR0ZXIgcGx1cyB0aGUgdGFyZ2V0J3MgU3VidHlwIGJsb2NrXG4vLyAgIFwib3RoZXJcIiAgICAgICAgICAgICAgICAgICAtIHRoZSBwcm9wZXJ0aWVzIG9mIHRoZSBvdGhlciBTdWJ0eXAgYmxvY2tzXG4vLyAgIFwidHlwVmFsdWVcIi9cInN1YnR5cFZhbHVlXCIgIC0gc2tpcHBlZCwgVFlQL1NVQlRZUCBhcmUgbm8gY29sdW1uc1xuLy8gT2YgdGhlIHBpbm5lZCBwcm9wZXJ0aWVzIG9ubHkgdGFncyBjb3VudHMgKGFuZCBvbmx5IHdoZW4gY2hlY2tlZCk6XG4vLyBjc3NjbGFzc2VzIG9yIGFsaWFzZXMgbWFrZSBubyBzZW5zZSBhcyBjb2x1bW5zIG9mIGFuIG92ZXJ2aWV3IHRhYmxlLlxuZnVuY3Rpb24gY29sdW1uSWRzKHBsdWdpbiwgdGFyZ2V0LCBvcHRpb25zKSB7XG4gIGNvbnN0IHsgbWFpbiwgb3RoZXJzIH0gPSB0YXJnZXRLZXlzKHBsdWdpbiwgdGFyZ2V0LCBvcHRpb25zKTtcbiAgY29uc3QgaWRzID0gW107XG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0KCk7XG4gIGNvbnN0IHB1c2ggPSAoaWQpID0+IHtcbiAgICBjb25zdCBsb3dlciA9IGlkLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKHNlZW4uaGFzKGxvd2VyKSkgcmV0dXJuO1xuICAgIHNlZW4uYWRkKGxvd2VyKTtcbiAgICBpZHMucHVzaChpZCk7XG4gIH07XG5cbiAgcHVzaChGSUxFX05BTUVfSUQpO1xuICBsZXQgdGFnc1BsYWNlZCA9IGZhbHNlO1xuICBmb3IgKGNvbnN0IGVudHJ5IG9mIG5vcm1hbGl6ZUdsb2JhbE9yZGVyKHBsdWdpbi5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyKSkge1xuICAgIGlmIChlbnRyeS5raW5kID09PSBcInByb3BlcnR5XCIpIHtcbiAgICAgIGlmIChvcHRpb25zLnRhZ3MgJiYgZW50cnkubmFtZSAmJiBzYW1lSWQoZW50cnkubmFtZSwgVEFHU19QUk9QRVJUWSkpIHtcbiAgICAgICAgcHVzaChub3RlSWQoZW50cnkubmFtZSkpO1xuICAgICAgICB0YWdzUGxhY2VkID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwidHlwXCIpIHtcbiAgICAgIGZvciAoY29uc3Qga2V5IG9mIG1haW4pIHB1c2gobm90ZUlkKGtleSkpO1xuICAgIH0gZWxzZSBpZiAoZW50cnkua2luZCA9PT0gXCJvdGhlclwiKSB7XG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBvdGhlcnMpIHB1c2gobm90ZUlkKGtleSkpO1xuICAgIH1cbiAgfVxuICAvLyBTYWZldHkgbmV0OiBpZiB0YWdzIGlzbid0IGluIHRoZSBnbG9iYWwgb3JkZXIsIGl0IHN0aWxsIGdvZXMgbGFzdC5cbiAgaWYgKG9wdGlvbnMudGFncyAmJiAhdGFnc1BsYWNlZCkgcHVzaChub3RlSWQoVEFHU19QUk9QRVJUWSkpO1xuICByZXR1cm4gaWRzO1xufVxuXG4vKiAtLS0gVmlld3Mgb2YgYSB0YXJnZXQgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbi8vIHNjb3BlZDogd2hldGhlciBlYWNoIHZpZXcgbXVzdCBjYXJyeSBpdHMgZnVsbCBmaWx0ZXIuIEluIGEgbmV3IEJhc2UgdGhlIFRZUFxuLy8gc2l0cyBpbiB0aGUgcm9vdCBmaWx0ZXIgYW5kIFN1YnR5cCB2aWV3cyBvbmx5IGFkZCBTVUJUWVAuIFZpZXdzIGFwcGVuZGVkIHRvXG4vLyBhbiBleGlzdGluZyBCYXNlIGxlYXZlIGl0cyByb290IGZpbHRlciBhbG9uZSBhbmQgZmlsdGVyIHRoZW1zZWx2ZXMuXG5mdW5jdGlvbiB0YXJnZXRWaWV3cyhwbHVnaW4sIHRhcmdldCwgb3B0aW9ucywgeyBzY29wZWQgfSkge1xuICBpZiAoIXRhcmdldC50eXApIHtcbiAgICBjb25zdCB2aWV3ID0ge1xuICAgICAgdHlwZTogXCJ0YWJsZVwiLFxuICAgICAgbmFtZTogdGFyZ2V0LnN1YnR5cCxcbiAgICAgIG9yZGVyOiBjb2x1bW5JZHMocGx1Z2luLCB0YXJnZXQsIG9wdGlvbnMpLFxuICAgIH07XG4gICAgaWYgKHNjb3BlZCkgdmlldy5maWx0ZXJzID0geyBhbmQ6IFtlcXVhbHNGaWx0ZXIoU1VCVFlQX1BST1BFUlRZLCB0YXJnZXQuc3VidHlwKV0gfTtcbiAgICAvLyBTZXZlcmFsIFRZUCBlbnRyaWVzIHdpdGggdGhpcyBTdWJ0eXAgbmFtZTogZ3JvdXBpbmcgc2VwYXJhdGVzIHRoZW1cbiAgICAvLyB3aXRob3V0IGEgdmlldyBwZXIgVFlQLlxuICAgIGlmICh0eXBzRm9yU3VidHlwKHBsdWdpbiwgdGFyZ2V0LnN1YnR5cCkubGVuZ3RoID4gMSkge1xuICAgICAgdmlldy5ncm91cEJ5ID0geyBwcm9wZXJ0eTogbm90ZUlkKFRZUF9QUk9QRVJUWSksIGRpcmVjdGlvbjogXCJBU0NcIiB9O1xuICAgIH1cbiAgICByZXR1cm4gW3ZpZXddO1xuICB9XG5cbiAgY29uc3QgdHlwID0gdGFyZ2V0LnR5cDtcbiAgY29uc3Qgc3VidHlwcyA9IGdldFN1YnR5cE5hbWVzKHBsdWdpbi5zZXR0aW5ncywgdHlwKTtcbiAgY29uc3QgbWFpbiA9IHtcbiAgICB0eXBlOiBcInRhYmxlXCIsXG4gICAgbmFtZTogdHlwLFxuICAgIG9yZGVyOiBjb2x1bW5JZHMocGx1Z2luLCB7IHR5cCwgc3VidHlwOiBudWxsIH0sIG9wdGlvbnMpLFxuICB9O1xuICBpZiAoc2NvcGVkKSBtYWluLmZpbHRlcnMgPSB7IGFuZDogW2VxdWFsc0ZpbHRlcihUWVBfUFJPUEVSVFksIHR5cCldIH07XG4gIC8vIFdpdGhvdXQgYW55IFN1YnR5cCwgZ3JvdXBpbmcgYnkgYW4gYWx3YXlzLWVtcHR5IHByb3BlcnR5IHdvdWxkIG9ubHkgZ2l2ZVxuICAvLyBvbmUgXCJubyB2YWx1ZVwiIGdyb3VwLlxuICBpZiAoc3VidHlwcy5sZW5ndGggPiAwKSBtYWluLmdyb3VwQnkgPSB7IHByb3BlcnR5OiBub3RlSWQoU1VCVFlQX1BST1BFUlRZKSwgZGlyZWN0aW9uOiBcIkFTQ1wiIH07XG5cbiAgY29uc3Qgdmlld3MgPSBbbWFpbl07XG4gIGZvciAoY29uc3Qgc3VidHlwIG9mIHN1YnR5cHMpIHtcbiAgICB2aWV3cy5wdXNoKHtcbiAgICAgIHR5cGU6IFwidGFibGVcIixcbiAgICAgIG5hbWU6IHN1YnR5cCxcbiAgICAgIC8vIGFsbFN1YnR5cHMgaXMgYWx3YXlzIG9mZiBpbiBhIFN1YnR5cCB2aWV3IChzZWUgdGFyZ2V0S2V5cykuXG4gICAgICBvcmRlcjogY29sdW1uSWRzKHBsdWdpbiwgeyB0eXAsIHN1YnR5cCB9LCB7IC4uLm9wdGlvbnMsIGFsbFN1YnR5cHM6IGZhbHNlIH0pLFxuICAgICAgZmlsdGVyczoge1xuICAgICAgICBhbmQ6IHNjb3BlZFxuICAgICAgICAgID8gW2VxdWFsc0ZpbHRlcihUWVBfUFJPUEVSVFksIHR5cCksIGVxdWFsc0ZpbHRlcihTVUJUWVBfUFJPUEVSVFksIHN1YnR5cCldXG4gICAgICAgICAgOiBbZXF1YWxzRmlsdGVyKFNVQlRZUF9QUk9QRVJUWSwgc3VidHlwKV0sXG4gICAgICB9LFxuICAgIH0pO1xuICB9XG4gIHJldHVybiB2aWV3cztcbn1cblxuLy8gQSB2aWV3IG9iamVjdCBhcyBpdCBhcHBlYXJzIGluIHRoZSBmaWxlOiB3aXRob3V0IFwibm90ZS5cIiBhbmQgd2l0aCB0aGUga2V5XG4vLyBvcmRlciBCYXNlcyBpdHNlbGYgd3JpdGVzLlxuZnVuY3Rpb24gc2VyaWFsaXplVmlldyh2aWV3KSB7XG4gIGNvbnN0IG91dCA9IHsgdHlwZTogdmlldy50eXBlLCBuYW1lOiB2aWV3Lm5hbWUgfTtcbiAgaWYgKHZpZXcuZmlsdGVycykgb3V0LmZpbHRlcnMgPSB2aWV3LmZpbHRlcnM7XG4gIGlmICh2aWV3Lm9yZGVyKSBvdXQub3JkZXIgPSB2aWV3Lm9yZGVyLm1hcChzZXJpYWxpemVJZCk7XG4gIGlmICh2aWV3Lmdyb3VwQnkpIHtcbiAgICBvdXQuZ3JvdXBCeSA9IHsgcHJvcGVydHk6IHNlcmlhbGl6ZUlkKHZpZXcuZ3JvdXBCeS5wcm9wZXJ0eSksIGRpcmVjdGlvbjogdmlldy5ncm91cEJ5LmRpcmVjdGlvbiB9O1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qIC0tLSBPcGVuaW5nIGFuZCB3cml0aW5nIHRoZSBmaWxlIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuZnVuY3Rpb24gd2FpdEZvcihtcykge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHdpbmRvdy5zZXRUaW1lb3V0KHJlc29sdmUsIG1zKSk7XG59XG5cbi8vIE9wZW5zIHRoZSBCYXNlIGFuZCB3YWl0cyB1bnRpbCBpdHMgcXVlcnkgaXMgcGFyc2VkOyBvbmx5IHRoZW4gY2FuIGl0IGJlXG4vLyByZWFkIGFuZCB3cml0dGVuLiBSZXVzZXMgYSB0YWIgdGhhdCBhbHJlYWR5IHNob3dzIHRoZSBmaWxlLlxuYXN5bmMgZnVuY3Rpb24gb3BlbkJhc2UoYXBwLCBmaWxlKSB7XG4gIGNvbnN0IG9wZW4gPSBhcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcImJhc2VzXCIpLmZpbmQoKGxlYWYpID0+IGxlYWYudmlldz8uZmlsZT8ucGF0aCA9PT0gZmlsZS5wYXRoKTtcbiAgY29uc3QgbGVhZiA9IG9wZW4gPz8gYXBwLndvcmtzcGFjZS5nZXRMZWFmKFwidGFiXCIpO1xuICBpZiAob3BlbikgYXBwLndvcmtzcGFjZS5yZXZlYWxMZWFmKGxlYWYpO1xuICBlbHNlIGF3YWl0IGxlYWYub3BlbkZpbGUoZmlsZSwgeyBhY3RpdmU6IHRydWUgfSk7XG4gIGZvciAobGV0IGF0dGVtcHQgPSAwOyBhdHRlbXB0IDwgNDAgJiYgIWxlYWYudmlldz8ucXVlcnk7IGF0dGVtcHQrKykgYXdhaXQgd2FpdEZvcigyNSk7XG4gIHJldHVybiBsZWFmLnZpZXc/LnF1ZXJ5ID8gbGVhZi52aWV3IDogbnVsbDtcbn1cblxuLy8gQXBwZW5kcyB2aWV3cyB0byBhbiBleGlzdGluZyBCYXNlLiBnZXRTZXJpYWxpemFibGUoKSByZXR1cm5zIGV4YWN0bHkgd2hhdFxuLy8gQmFzZXMgd3JpdGVzIHdoZW4gaXQgc2F2ZXMgKHZlcmlmaWVkOiB0aGUgcm91bmQgdHJpcCByZXByb2R1Y2VzIGV4aXN0aW5nXG4vLyBmaWxlcyBieXRlIGZvciBieXRlLCBmb3JtdWxhIGJsb2NrcyBhbmQgc3BlY2lhbCBrZXlzIGluY2x1ZGVkKTsgb25seSB0aGVcbi8vIHZpZXdzIGxpc3QgaXMgdG91Y2hlZC5cbi8vXG4vLyB2YXVsdC5wcm9jZXNzIHJhdGhlciB0aGFuIHZhdWx0Lm1vZGlmeSwgYXMgT2JzaWRpYW4gcmVjb21tZW5kcyBmb3IgY2hhbmdlc1xuLy8gdG8gYSBmaWxlIHRoYXQgbWF5IGJlIG9wZW46IGl0IHdyaXRlcyBhdG9taWNhbGx5LiBUaGUgY2FsbGJhY2sgaWdub3JlcyB0aGVcbi8vIGZpbGUgdGV4dCBvbiBwdXJwb3NlIC0gZGF0YSBjb21lcyBmcm9tIHRoZSBwYXJzZWQgcXVlcnksIHdoaWNoIHRoZSBvcGVuXG4vLyBCYXNlIGtlZXBzIGluIHN0ZXAgd2l0aCB0aGUgZmlsZS5cbmFzeW5jIGZ1bmN0aW9uIGFwcGVuZFZpZXdzKGFwcCwgdmlldywgdmlld3MpIHtcbiAgY29uc3QgZGF0YSA9IHZpZXcucXVlcnkuZ2V0U2VyaWFsaXphYmxlKCk7XG4gIGRhdGEudmlld3MgPSBbLi4uKGRhdGEudmlld3MgPz8gW10pLCAuLi52aWV3cy5tYXAoc2VyaWFsaXplVmlldyldO1xuICBhd2FpdCBhcHAudmF1bHQucHJvY2Vzcyh2aWV3LmZpbGUsICgpID0+IHN0cmluZ2lmeVlhbWwoZGF0YSkpO1xufVxuXG4vKiAtLS0gQ29tbWFuZDogQ3JlYXRlIEJhc2UgZm9yIFRZUCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUJhc2UocGx1Z2luLCB0YXJnZXQsIG9wdGlvbnMpIHtcbiAgY29uc3QgYXBwID0gcGx1Z2luLmFwcDtcbiAgY29uc3QgbmFtZSA9IHRhcmdldC5zdWJ0eXAgPz8gdGFyZ2V0LnR5cDtcbiAgY29uc3QgcGF0aCA9IGAke25hbWV9LiR7QkFTRV9FWFRFTlNJT059YDtcbiAgY29uc3QgZXhpc3RpbmcgPSBhcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHBhdGgpO1xuXG4gIGlmIChleGlzdGluZyAmJiAhKGV4aXN0aW5nIGluc3RhbmNlb2YgVEZpbGUpKSB7XG4gICAgbmV3IE5vdGljZShgXCIke3BhdGh9XCIgaXMgbm90IGEgZmlsZSBcdTIwMTMgQmFzZSBub3QgY3JlYXRlZC5gKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgY29uc3Qgdmlld3MgPSB0YXJnZXRWaWV3cyhwbHVnaW4sIHRhcmdldCwgb3B0aW9ucywgeyBzY29wZWQ6IGZhbHNlIH0pO1xuICAgIGNvbnN0IHJvb3QgPSB0YXJnZXQudHlwXG4gICAgICA/IHsgYW5kOiBbZXF1YWxzRmlsdGVyKFRZUF9QUk9QRVJUWSwgdGFyZ2V0LnR5cCldIH1cbiAgICAgIDogeyBhbmQ6IFtlcXVhbHNGaWx0ZXIoU1VCVFlQX1BST1BFUlRZLCB0YXJnZXQuc3VidHlwKV0gfTtcbiAgICBjb25zdCBmaWxlID0gYXdhaXQgYXBwLnZhdWx0LmNyZWF0ZShwYXRoLCBzdHJpbmdpZnlZYW1sKHsgZmlsdGVyczogcm9vdCwgdmlld3M6IHZpZXdzLm1hcChzZXJpYWxpemVWaWV3KSB9KSk7XG4gICAgYXdhaXQgb3BlbkJhc2UoYXBwLCBmaWxlKTtcbiAgICBuZXcgTm90aWNlKGBDcmVhdGVkICR7cGF0aH0gd2l0aCAke3BsdXJhbCh2aWV3cy5sZW5ndGgsIFwidmlld1wiKX0uYCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gVGhlIGZpbGUgZXhpc3RzOiBhZGQgd2hhdCBpcyBtaXNzaW5nLiBBIHZpZXcgd2l0aCB0aGUgc2FtZSBuYW1lIHN0YXlzXG4gIC8vIHVudG91Y2hlZCAtIGl0IG1heSBiZSBoYW5kLW1hZGUsIGFuZCBvdmVyd3JpdGluZyBpdCB3b3VsZCBiZSBhIHNpbGVudCBsb3NzLlxuICBjb25zdCB2aWV3ID0gYXdhaXQgb3BlbkJhc2UoYXBwLCBleGlzdGluZyk7XG4gIGlmICghdmlldykge1xuICAgIG5ldyBOb3RpY2UoYENvdWxkbid0IHJlYWQgJHtwYXRofSBcdTIwMTMgQmFzZSBub3QgdXBkYXRlZC5gKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgcHJlc2VudCA9IG5ldyBTZXQodmlldy5xdWVyeS52aWV3cy5tYXAoKGNmZykgPT4gY2ZnLm5hbWUpKTtcbiAgY29uc3Qgd2FudGVkID0gdGFyZ2V0Vmlld3MocGx1Z2luLCB0YXJnZXQsIG9wdGlvbnMsIHsgc2NvcGVkOiB0cnVlIH0pO1xuICBjb25zdCB0b0FkZCA9IHdhbnRlZC5maWx0ZXIoKGVudHJ5KSA9PiAhcHJlc2VudC5oYXMoZW50cnkubmFtZSkpO1xuICBjb25zdCBza2lwcGVkID0gd2FudGVkLmZpbHRlcigoZW50cnkpID0+IHByZXNlbnQuaGFzKGVudHJ5Lm5hbWUpKS5tYXAoKGVudHJ5KSA9PiBlbnRyeS5uYW1lKTtcblxuICBpZiAodG9BZGQubGVuZ3RoID4gMCkgYXdhaXQgYXBwZW5kVmlld3MoYXBwLCB2aWV3LCB0b0FkZCk7XG5cbiAgY29uc3QgcGFydHMgPSBbXTtcbiAgcGFydHMucHVzaCh0b0FkZC5sZW5ndGggPiAwID8gYCR7cGF0aH06IGFkZGVkICR7cGx1cmFsKHRvQWRkLmxlbmd0aCwgXCJ2aWV3XCIpfS5gIDogYCR7cGF0aH06IG5vdGhpbmcgdG8gYWRkLmApO1xuICBpZiAoc2tpcHBlZC5sZW5ndGggPiAwKSBwYXJ0cy5wdXNoKGBBbHJlYWR5IHByZXNlbnQsIGxlZnQgdW5jaGFuZ2VkOiAke3NraXBwZWQuam9pbihcIiwgXCIpfS5gKTtcbiAgbmV3IE5vdGljZShwYXJ0cy5qb2luKFwiIFwiKSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUJhc2VDb21tYW5kKHBsdWdpbikge1xuICAvLyBpbmNsdWRlTWFudWFsT2ZmOiBhIEJhc2UgaXMgZXNwZWNpYWxseSB1c2VmdWwgZm9yIFRZUCBlbnRyaWVzIHRoYXQgYXJlbid0XG4gIC8vIHNldCBieSBoYW5kIChLT05UQUtULCBNRURJQSwgRVhURVJOKS4gVW5yZWdpc3RlcmVkIHZhbHVlcyBhcmUgbGVmdCBvdXQgLVxuICAvLyB0aGV5IGhhdmUgbm8gVFlQLUZyb250bWF0dGVyIGFuZCBzbyBubyBjb2x1bW5zLlxuICBjb25zdCBjaG9pY2UgPSBhd2FpdCBwbHVnaW4ucGlja1R5cEFuZFN1YnR5cCh7IGluY2x1ZGVNYW51YWxPZmY6IHRydWUgfSk7XG4gIGlmICghY2hvaWNlKSByZXR1cm47XG5cbiAgLy8gQSBTdWJ0eXAgcGlja2VkIGhlcmUgbWVhbnMgdGhlIHN0YW5kYWxvbmUgU3VidHlwIEJhc2U6IGl0IGZpbHRlcnMgYnlcbiAgLy8gU1VCVFlQIG9ubHkgYW5kIG1lcmdlcyB0aGUgY29sdW1ucyBvZiBldmVyeSBUWVAgd2l0aCB0aGF0IFN1YnR5cCBuYW1lLlxuICBjb25zdCB0YXJnZXQgPSBjaG9pY2Uuc3VidHlwID8geyB0eXA6IG51bGwsIHN1YnR5cDogY2hvaWNlLnN1YnR5cCB9IDogeyB0eXA6IGNob2ljZS50eXAsIHN1YnR5cDogbnVsbCB9O1xuICBhd2FpdCBjcmVhdGVCYXNlRm9yKHBsdWdpbiwgdGFyZ2V0KTtcbn1cblxuLy8gVGhlIGNvbW1hbmQgYWZ0ZXIgaXRzIHBpY2tlciwgYWxzbyB0aGUgZW50cnkgd2l0aCBhIGZpeGVkIHRhcmdldCAoY29udGV4dFxuLy8gbWVudSBvZiB0aGUgVFlQLUxpc3QpOiBjb2x1bW4gb3B0aW9ucywgdGhlbiBjcmVhdGUgb3IgY29tcGxldGUgdGhlIGZpbGUuXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVCYXNlRm9yKHBsdWdpbiwgdGFyZ2V0KSB7XG4gIGNvbnN0IG9wdGlvbnMgPSBhd2FpdCBhc2tDb2x1bW5PcHRpb25zKHBsdWdpbiwgdGFyZ2V0LCAoY3VycmVudCkgPT4gY29sdW1uSWRzKHBsdWdpbiwgdGFyZ2V0LCBjdXJyZW50KSk7XG4gIGlmICghb3B0aW9ucykgcmV0dXJuO1xuICBhd2FpdCBjcmVhdGVCYXNlKHBsdWdpbiwgdGFyZ2V0LCBvcHRpb25zKTtcbn1cblxuLyogLS0tIENvbW1hbmQ6IFVwZGF0ZSBjb2x1bW5zIG9mIEJhc2UgdmlldyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuXG4vLyBUaGUgbW9zdCByZWNlbnQgbGVhZiBvZiB0aGUgbWFpbiBhcmVhLCBub3Qgd29ya3NwYWNlLmFjdGl2ZUxlYWYgKGRlcHJlY2F0ZWQpOlxuLy8gdGhhdCBpcyBhbHNvIGEgc2lkZWJhciBsZWFmLCBlLmcuIHRoZSBUWVAtUGFuZSB3aGVuIGl0IHdhcyBjbGlja2VkIGxhc3QuXG5mdW5jdGlvbiBhY3RpdmVCYXNlVmlldyhwbHVnaW4pIHtcbiAgY29uc3QgbGVhZiA9IHBsdWdpbi5hcHAud29ya3NwYWNlLmdldE1vc3RSZWNlbnRMZWFmKCk7XG4gIGNvbnN0IHZpZXcgPSBsZWFmPy52aWV3O1xuICBpZiAoIXZpZXcgfHwgdHlwZW9mIHZpZXcuZ2V0Vmlld1R5cGUgIT09IFwiZnVuY3Rpb25cIiB8fCB2aWV3LmdldFZpZXdUeXBlKCkgIT09IFwiYmFzZXNcIikgcmV0dXJuIG51bGw7XG4gIHJldHVybiB2aWV3LnF1ZXJ5ID8gdmlldyA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIHNlcmlhbGl6ZUZpbHRlcnMoZmlsdGVycykge1xuICByZXR1cm4gdHlwZW9mIGZpbHRlcnM/LnNlcmlhbGl6ZSA9PT0gXCJmdW5jdGlvblwiID8gZmlsdGVycy5zZXJpYWxpemUoKSA6IG51bGw7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHVwZGF0ZUFjdGl2ZVZpZXcocGx1Z2luLCB2aWV3KSB7XG4gIGNvbnN0IHF1ZXJ5ID0gdmlldy5xdWVyeTtcbiAgY29uc3Qgdmlld05hbWUgPSB2aWV3LmNvbnRyb2xsZXI/LnZpZXdOYW1lO1xuICBjb25zdCBjZmcgPSAodmlld05hbWUgPyBxdWVyeS5nZXRWaWV3Q29uZmlnKHZpZXdOYW1lKSA6IG51bGwpID8/IHF1ZXJ5LnZpZXdzWzBdO1xuICBpZiAoIWNmZykge1xuICAgIG5ldyBOb3RpY2UoXCJObyBhY3RpdmUgdmlldy5cIik7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgbGV0IHRhcmdldCA9IHJlYWRUYXJnZXQoc2VyaWFsaXplRmlsdGVycyhxdWVyeS5maWx0ZXJzKSwgc2VyaWFsaXplRmlsdGVycyhjZmcuZmlsdGVycykpO1xuICBpZiAoIXRhcmdldCkge1xuICAgIC8vIE5vIHVuYW1iaWd1b3VzIFRZUCBpbiB0aGUgZmlsdGVyIChoYW5kLXdyaXR0ZW4gT1IgZ3JvdXAsIG5vIGZpbHRlciBhdFxuICAgIC8vIGFsbCk6IGFzaywgYW5kIHN0b3JlIHRoZSBhbnN3ZXIgYXMgYSBmaWx0ZXIgc28gdGhlIG5leHQgcnVuIHJlYWRzIGl0LlxuICAgIGNvbnN0IGNob2ljZSA9IGF3YWl0IHBsdWdpbi5waWNrVHlwQW5kU3VidHlwKHsgaW5jbHVkZU1hbnVhbE9mZjogdHJ1ZSB9KTtcbiAgICBpZiAoIWNob2ljZSkgcmV0dXJuO1xuICAgIHRhcmdldCA9IHsgdHlwOiBjaG9pY2UudHlwLCBzdWJ0eXA6IGNob2ljZS5zdWJ0eXAgfTtcbiAgICBjb25zdCBhbmQgPSBbZXF1YWxzRmlsdGVyKFRZUF9QUk9QRVJUWSwgY2hvaWNlLnR5cCldO1xuICAgIGlmIChjaG9pY2Uuc3VidHlwKSBhbmQucHVzaChlcXVhbHNGaWx0ZXIoU1VCVFlQX1BST1BFUlRZLCBjaG9pY2Uuc3VidHlwKSk7XG4gICAgcXVlcnkuc2V0Vmlld0ZpbHRlcnMoY2ZnLm5hbWUsIHsgYW5kIH0pO1xuICB9XG5cbiAgY29uc3Qgb3B0aW9ucyA9IGF3YWl0IGFza0NvbHVtbk9wdGlvbnMocGx1Z2luLCB0YXJnZXQsIChjdXJyZW50KSA9PiBjb2x1bW5JZHMocGx1Z2luLCB0YXJnZXQsIGN1cnJlbnQpKTtcbiAgaWYgKCFvcHRpb25zKSByZXR1cm47XG5cbiAgY29uc3QgZGVzaXJlZCA9IGNvbHVtbklkcyhwbHVnaW4sIHRhcmdldCwgb3B0aW9ucyk7XG4gIGNvbnN0IGRlc2lyZWRMb3dlciA9IG5ldyBTZXQoZGVzaXJlZC5tYXAoKGlkKSA9PiBpZC50b0xvd2VyQ2FzZSgpKSk7XG4gIC8vIEEgdmlldyB3aXRob3V0IGl0cyBvd24gb3JkZXIgc2hvd3MgZXZlcnkgcHJvcGVydHkgLSBub3RoaW5nIHRvIHJlbW92ZSxcbiAgLy8gdGhlIGdlbmVyYXRlZCBsaXN0IHNpbXBseSB0YWtlcyBpdHMgcGxhY2UuXG4gIGNvbnN0IGN1cnJlbnQgPSBBcnJheS5pc0FycmF5KGNmZy5vcmRlcikgPyBbLi4uY2ZnLm9yZGVyXSA6IFtdO1xuICBjb25zdCBleHRyYXMgPSBjdXJyZW50LmZpbHRlcigoaWQpID0+ICFkZXNpcmVkTG93ZXIuaGFzKGlkLnRvTG93ZXJDYXNlKCkpKTtcblxuICBsZXQga2VwdCA9IFtdO1xuICBpZiAoZXh0cmFzLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCByZW1vdmFscyA9IGF3YWl0IGFza1JlbW92YWxzKHBsdWdpbiwgZXh0cmFzLCBjZmcubmFtZSk7XG4gICAgaWYgKCFyZW1vdmFscykgcmV0dXJuO1xuICAgIGtlcHQgPSBleHRyYXMuZmlsdGVyKChpZCkgPT4gIXJlbW92YWxzLmhhcyhpZCkpO1xuICB9XG5cbiAgLy8gS2VwdCBjb2x1bW5zIHN0YXkgdXAgZnJvbnQsIHJpZ2h0IGFmdGVyIGZpbGUubmFtZTogaGFuZC1hZGRlZCBvbmVzXG4gIC8vIChmb3JtdWxhIGNvbHVtbnMsIHNheSkgc2hvdWxkbid0IHNsaWRlIHRvIHRoZSBlbmQuXG4gIGNvbnN0IG5ld09yZGVyID0gW1xuICAgIEZJTEVfTkFNRV9JRCxcbiAgICAuLi5rZXB0LmZpbHRlcigoaWQpID0+ICFzYW1lSWQoaWQsIEZJTEVfTkFNRV9JRCkpLFxuICAgIC4uLmRlc2lyZWQuZmlsdGVyKChpZCkgPT4gIXNhbWVJZChpZCwgRklMRV9OQU1FX0lEKSksXG4gIF07XG5cbiAgaWYgKG5ld09yZGVyLmxlbmd0aCA9PT0gY3VycmVudC5sZW5ndGggJiYgbmV3T3JkZXIuZXZlcnkoKGlkLCBpbmRleCkgPT4gaWQgPT09IGN1cnJlbnRbaW5kZXhdKSkge1xuICAgIG5ldyBOb3RpY2UoYFZpZXcgXCIke2NmZy5uYW1lfVwiOiBjb2x1bW5zIGFyZSBhbHJlYWR5IHVwIHRvIGRhdGUuYCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgYWRkZWQgPSBkZXNpcmVkLmZpbHRlcigoaWQpID0+ICFjdXJyZW50LnNvbWUoKGV4aXN0aW5nKSA9PiBzYW1lSWQoZXhpc3RpbmcsIGlkKSkpLmxlbmd0aDtcbiAgY29uc3QgcmVtb3ZlZCA9IGV4dHJhcy5sZW5ndGggLSBrZXB0Lmxlbmd0aDtcbiAgY2ZnLnNldE9yZGVyKG5ld09yZGVyKTtcbiAgbmV3IE5vdGljZShgVmlldyBcIiR7Y2ZnLm5hbWV9XCI6IGFkZGVkICR7cGx1cmFsKGFkZGVkLCBcImNvbHVtblwiKX0sIHJlbW92ZWQgJHtyZW1vdmVkfS5gKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIGlzQmFzZXNFbmFibGVkLFxuICBjcmVhdGVCYXNlQ29tbWFuZCxcbiAgY3JlYXRlQmFzZUZvcixcbiAgYWN0aXZlQmFzZVZpZXcsXG4gIHVwZGF0ZUFjdGl2ZVZpZXcsXG4gIC8vIEV4cG9zZWQgZm9yIHRlc3Rpbmcgc2luZ2xlIGJ1aWxkaW5nIGJsb2Nrc1xuICBjb2x1bW5JZHMsXG4gIHJlYWRUYXJnZXQsXG4gIHRhcmdldFZpZXdzLFxufTtcbiIsICJjb25zdCB7IE5vdGljZSB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBzb3J0QWxsRnJvbnRtYXR0ZXIsIHNvcnRTaW5nbGVGaWxlRnJvbnRtYXR0ZXIsIHNvcnRUeXBGcm9udG1hdHRlciwgc29ydFN1bW1hcnkgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLXNvcnRcIik7XG5jb25zdCB7IGlzQmFzZXNFbmFibGVkLCBjcmVhdGVCYXNlQ29tbWFuZCwgYWN0aXZlQmFzZVZpZXcsIHVwZGF0ZUFjdGl2ZVZpZXcgfSA9IHJlcXVpcmUoXCIuL2Jhc2VzXCIpO1xuXG4vLyBPYnNpZGlhbiBuZWl0aGVyIGF3YWl0cyBhIGNvbW1hbmQgY2FsbGJhY2sgKG9yIGEgbWVudSBpdGVtJ3Mgb25DbGljaykgbm9yXG4vLyBjYXRjaGVzIGl0cyBlcnJvcnMsIHNvIGFuIGV4Y2VwdGlvbiB3b3VsZCB2YW5pc2ggaW50byB0aGUgY29uc29sZS4gVGhlc2Vcbi8vIGFjdGlvbnMgYWx3YXlzIGVuZCBpbiBhIG5vdGljZSBpbnN0ZWFkLiBBbHNvIHVzZWQgYnkgdGhlIFRZUC1QYW5lJ3MgY29udGV4dFxuLy8gbWVudS5cbmNvbnN0IHJ1bk9yUmVwb3J0RXJyb3IgPSAobGFiZWwsIGZuKSA9PiBhc3luYyAoKSA9PiB7XG4gIHRyeSB7XG4gICAgYXdhaXQgZm4oKTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKGBbJHtsYWJlbH1dYCwgZXJyb3IpO1xuICAgIG5ldyBOb3RpY2UoYCR7bGFiZWx9IGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfWApO1xuICB9XG59O1xuXG5mdW5jdGlvbiByZWdpc3RlckNvbW1hbmRzKHBsdWdpbikge1xuXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJzb3J0LWZyb250bWF0dGVyLWFsbFwiLFxuICAgIG5hbWU6IFwiU29ydCBmcm9udG1hdHRlciBpbiBhbGwgbm90ZXNcIixcbiAgICBjYWxsYmFjazogcnVuT3JSZXBvcnRFcnJvcihcIkZyb250bWF0dGVyIHNvcnRpbmdcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgeyBjaGVja2VkLCBjaGFuZ2VkIH0gPSBhd2FpdCBzb3J0QWxsRnJvbnRtYXR0ZXIocGx1Z2luLmFwcCwgcGx1Z2luLCBudWxsKTtcbiAgICAgIG5ldyBOb3RpY2Uoc29ydFN1bW1hcnkoXCJGcm9udG1hdHRlciBzb3J0aW5nXCIsIGNoZWNrZWQsIGNoYW5nZWQpKTtcbiAgICB9KSxcbiAgfSk7XG5cbiAgcGx1Z2luLmFkZENvbW1hbmQoe1xuICAgIGlkOiBcInNvcnQtZnJvbnRtYXR0ZXItdHlwXCIsXG4gICAgbmFtZTogXCJTb3J0IGZyb250bWF0dGVyIGZvciBvbmUgVFlQXCIsXG4gICAgY2FsbGJhY2s6IHJ1bk9yUmVwb3J0RXJyb3IoXCJGcm9udG1hdHRlciBzb3J0aW5nXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIFNvcnRpbmcgbWFrZXMgc2Vuc2UgZm9yIGFueSBUWVAsIG1hbnVhbGx5IGNyZWF0YWJsZSBvciBub3QsIHJlZ2lzdGVyZWRcbiAgICAgIC8vIG9yIG5vdC5cbiAgICAgIGNvbnN0IHR5cCA9IGF3YWl0IHBsdWdpbi5waWNrVHlwKHsgaW5jbHVkZU1hbnVhbE9mZjogdHJ1ZSwgaW5jbHVkZVVucmVnaXN0ZXJlZDogdHJ1ZSB9KTtcbiAgICAgIGlmICghdHlwKSByZXR1cm47XG4gICAgICBhd2FpdCBzb3J0VHlwRnJvbnRtYXR0ZXIocGx1Z2luLCB0eXApO1xuICAgIH0pLFxuICB9KTtcblxuICBwbHVnaW4uYWRkQ29tbWFuZCh7XG4gICAgaWQ6IFwic29ydC1mcm9udG1hdHRlci1hY3RpdmUtbm90ZVwiLFxuICAgIG5hbWU6IFwiU29ydCBmcm9udG1hdHRlciBvZiBhY3RpdmUgbm90ZVwiLFxuICAgIGNoZWNrQ2FsbGJhY2s6IChjaGVja2luZykgPT4ge1xuICAgICAgY29uc3QgZmlsZSA9IHBsdWdpbi5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICAgIGlmICghZmlsZSB8fCBmaWxlLmV4dGVuc2lvbiAhPT0gXCJtZFwiKSByZXR1cm4gZmFsc2U7XG4gICAgICBpZiAoY2hlY2tpbmcpIHJldHVybiB0cnVlO1xuXG4gICAgICBydW5PclJlcG9ydEVycm9yKFwiRnJvbnRtYXR0ZXIgc29ydGluZ1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGNoYW5nZWQgPSBhd2FpdCBzb3J0U2luZ2xlRmlsZUZyb250bWF0dGVyKHBsdWdpbi5hcHAsIHBsdWdpbiwgZmlsZSk7XG4gICAgICAgIG5ldyBOb3RpY2UoY2hhbmdlZCA/IGBTb3J0ZWQgZnJvbnRtYXR0ZXIgb2YgXCIke2ZpbGUuYmFzZW5hbWV9XCIuYCA6IGBGcm9udG1hdHRlciBvZiBcIiR7ZmlsZS5iYXNlbmFtZX1cIiB3YXMgYWxyZWFkeSBzb3J0ZWQuYCk7XG4gICAgICB9KSgpO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSxcbiAgfSk7XG5cbiAgLy8gQ3JlYXRlcyBhIC5iYXNlIGZvciB0aGUgY2hvc2VuIFRZUCBvciBTdWJ0eXAgaW4gdGhlIHZhdWx0IHJvb3QsIHNlZSBiYXNlcy5qcy5cbiAgLy8gSGlkZGVuIHdoaWxlIHRoZSBCYXNlcyBjb3JlIHBsdWdpbiBpcyBvZmY6IHRoZSBmaWxlIGNvdWxkbid0IGJlIG9wZW5lZC5cbiAgcGx1Z2luLmFkZENvbW1hbmQoe1xuICAgIGlkOiBcImNyZWF0ZS1iYXNlLWZvci10eXBcIixcbiAgICBuYW1lOiBcIkNyZWF0ZSBCYXNlIGZvciBUWVBcIixcbiAgICBjaGVja0NhbGxiYWNrOiAoY2hlY2tpbmcpID0+IHtcbiAgICAgIGlmICghaXNCYXNlc0VuYWJsZWQocGx1Z2luLmFwcCkpIHJldHVybiBmYWxzZTtcbiAgICAgIGlmIChjaGVja2luZykgcmV0dXJuIHRydWU7XG5cbiAgICAgIHJ1bk9yUmVwb3J0RXJyb3IoXCJDcmVhdGUgQmFzZVwiLCAoKSA9PiBjcmVhdGVCYXNlQ29tbWFuZChwbHVnaW4pKSgpO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSxcbiAgfSk7XG5cbiAgLy8gQnJpbmdzIHRoZSBjb2x1bW5zIG9mIHRoZSB2aXNpYmxlIEJhc2UgdmlldyBpbiBsaW5lIHdpdGggaXRzIFRZUC4gV2l0aG91dFxuICAvLyBhbiBvcGVuIEJhc2UgdGhlIGNvbW1hbmQgaGFzIG5vIHRhcmdldCBhbmQgaXMgaGlkZGVuLlxuICBwbHVnaW4uYWRkQ29tbWFuZCh7XG4gICAgaWQ6IFwidXBkYXRlLWJhc2Utdmlldy1jb2x1bW5zXCIsXG4gICAgbmFtZTogXCJVcGRhdGUgY29sdW1ucyBvZiBCYXNlIHZpZXdcIixcbiAgICBjaGVja0NhbGxiYWNrOiAoY2hlY2tpbmcpID0+IHtcbiAgICAgIGNvbnN0IHZpZXcgPSBhY3RpdmVCYXNlVmlldyhwbHVnaW4pO1xuICAgICAgaWYgKCF2aWV3KSByZXR1cm4gZmFsc2U7XG4gICAgICBpZiAoY2hlY2tpbmcpIHJldHVybiB0cnVlO1xuXG4gICAgICBydW5PclJlcG9ydEVycm9yKFwiVXBkYXRlIEJhc2VcIiwgKCkgPT4gdXBkYXRlQWN0aXZlVmlldyhwbHVnaW4sIHZpZXcpKSgpO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSxcbiAgfSk7XG5cbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyQ29tbWFuZHMsIHJ1bk9yUmVwb3J0RXJyb3IgfTtcbiIsICJjb25zdCB7IENvbmZpcm1hdGlvbk1vZGFsLCBQbGF0Zm9ybSB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBuYW1lQ29sb3IsIHBhaW50Q29sb3JEb3QsIERFRkFVTFRfVFlQX0NPTE9SIH0gPSByZXF1aXJlKFwiLi90eXAtY29sb3JzXCIpO1xuXG4vLyBBIFRZUCBuYW1lIGluIHJ1bm5pbmcgdGV4dCAoZGlhbG9ncyk6IGNvbG9yZWQgd2hlbiBcIlRZUC1QYW5lXCIgY29sb3JpbmcgaXMgb25cbi8vIChjb2xvclZpZXdzLnR5cExpc3QpLCBvdGhlcndpc2UgYSBkb3QgYmVmb3JlIHBsYWluIHRleHQgLSB0aGUgc2FtZSBzd2l0Y2ggYXNcbi8vIGluIHRoZSBwaWNrZXIgYW5kIHRoZSBsaXN0LiBUaGUgY2FsbGVyIHBhc3NlcyBjb2xvciBzbyBhIHJlbmFtZSBjYW4gdXNlIHRoZVxuLy8gc2FtZSAob2xkKSBjb2xvciBmb3Igb2xkIGFuZCBuZXcgbmFtZS4gY29sb3IgbnVsbCA9IFRZUCB3aXRob3V0IGEgY29sb3IuXG5mdW5jdGlvbiBhcHBlbmRUeXBOYW1lKHBhcmVudEVsLCBwbHVnaW4sIHR5cCwgY29sb3IpIHtcbiAgaWYgKHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3QpIHtcbiAgICBjb25zdCBuYW1lRWwgPSBwYXJlbnRFbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1pbmxpbmUtbmFtZVwiLCB0ZXh0OiB0eXAgfSk7XG4gICAgaWYgKGNvbG9yKSBuYW1lRWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcbiAgfSBlbHNlIHtcbiAgICBwYWludENvbG9yRG90KHBhcmVudEVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLWlubGluZS1kb3RcIiB9KSwgY29sb3IgPz8gREVGQVVMVF9UWVBfQ09MT1IsICFjb2xvcik7XG4gICAgcGFyZW50RWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtaW5saW5lLW5hbWVcIiwgdGV4dDogdHlwIH0pO1xuICB9XG59XG5cbi8vIExpa2UgYXBwZW5kVHlwTmFtZSBmb3IgYSBTdWJ0eXAgb2YgdHlwLCBpbiB0aGUgU3VidHlwIGNvbG9yIChzZWUgbmFtZUNvbG9yXG4vLyBpbiB0eXAtY29sb3JzLmpzLCB3aGljaCBhbHNvIGhvbm9ycyB0aGUgXCJTdWJ0eXBcIiBzdWItdG9nZ2xlIG9mIFwiVFlQLVBhbmVcIikuXG4vLyBjb2xvclN1YnR5cCBpcyB0aGUgU3VidHlwIHdob3NlIGNvbG9yIGlzIHVzZWQgLSBhIHJlbmFtZSBzaG93cyB0aGUgbmV3IG5hbWUsXG4vLyB3aGljaCBoYXMgbm8gZW50cnkgeWV0LCBpbiB0aGUgb2xkIG9uZSdzIGNvbG9yLiBBcyB3aXRoIGFwcGVuZFR5cE5hbWUsIGEgVFlQXG4vLyB3aXRob3V0IGEgY29sb3IgbGVhdmVzIHRoZSB0ZXh0IHVuY29sb3JlZC5cbmZ1bmN0aW9uIGFwcGVuZFN1YnR5cE5hbWUocGFyZW50RWwsIHBsdWdpbiwgdHlwLCBuYW1lLCBjb2xvclN1YnR5cCA9IG5hbWUpIHtcbiAgY29uc3QgeyBjb2xvciwgaXNEZWZhdWx0IH0gPSBuYW1lQ29sb3IocGx1Z2luLnNldHRpbmdzLCB0eXAsIGNvbG9yU3VidHlwKTtcbiAgaWYgKHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3QpIHtcbiAgICBjb25zdCBuYW1lRWwgPSBwYXJlbnRFbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1pbmxpbmUtbmFtZVwiLCB0ZXh0OiBuYW1lIH0pO1xuICAgIGlmIChwbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0pIG5hbWVFbC5zdHlsZS5jb2xvciA9IGNvbG9yO1xuICB9IGVsc2Uge1xuICAgIHBhaW50Q29sb3JEb3QocGFyZW50RWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtaW5saW5lLWRvdFwiIH0pLCBjb2xvciwgaXNEZWZhdWx0KTtcbiAgICBwYXJlbnRFbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1pbmxpbmUtbmFtZVwiLCB0ZXh0OiBuYW1lIH0pO1xuICB9XG59XG5cbi8vIFRoZSBzYW1lIGFzIG5vZGVzIGZvciBhIENvbmZpcm1Nb2RhbCB0aXRsZSBvciBib2R5LlxuY29uc3QgdHlwTmFtZU5vZGUgPSAocGx1Z2luLCB0eXAsIGNvbG9yKSA9PiBjcmVhdGVGcmFnbWVudCgoZikgPT4gYXBwZW5kVHlwTmFtZShmLCBwbHVnaW4sIHR5cCwgY29sb3IpKTtcbmNvbnN0IHN1YnR5cE5hbWVOb2RlID0gKHBsdWdpbiwgdHlwLCBuYW1lLCBjb2xvclN1YnR5cCA9IG5hbWUpID0+XG4gIGNyZWF0ZUZyYWdtZW50KChmKSA9PiBhcHBlbmRTdWJ0eXBOYW1lKGYsIHBsdWdpbiwgdHlwLCBuYW1lLCBjb2xvclN1YnR5cCkpO1xuXG4vLyBGaWxscyBlbCB3aXRoIGEgc3RyaW5nIG9yIGFuIGFycmF5IG9mIHN0cmluZ3MgYW5kIG5vZGVzLlxuZnVuY3Rpb24gYXBwZW5kUGFydHMoZWwsIHBhcnRzKSB7XG4gIGZvciAoY29uc3QgcGFydCBvZiBBcnJheS5pc0FycmF5KHBhcnRzKSA/IHBhcnRzIDogW3BhcnRzXSkge1xuICAgIGlmICh0eXBlb2YgcGFydCA9PT0gXCJzdHJpbmdcIikgZWwuYXBwZW5kVGV4dChwYXJ0KTtcbiAgICBlbHNlIGVsLmFwcGVuZENoaWxkKHBhcnQpO1xuICB9XG59XG5cbi8vIFRoZSBvbmUgY29uZmlybWF0aW9uIGRpYWxvZyBvZiB0aGUgcGx1Z2luLCBidWlsdCBvbiBPYnNpZGlhbidzIG93blxuLy8gQ29uZmlybWF0aW9uTW9kYWwgLSB0aGUgYmFzZSBvZiBpdHMgXCJEZWxldGUgZmlsZVwiIGV0Yy4gLSBzbyBsb29rLCBidXR0b25cbi8vIG9yZGVyIFtDYW5jZWxdIFtBY3Rpb25dLCBib3R0b20gc2hlZXQgb24gcGhvbmVzIGFuZCBrZXlib2FyZCBmb2N1cyBtYXRjaFxuLy8gT2JzaWRpYW4ncyBkaWFsb2dzIGV4YWN0bHkuXG4vL1xuLy8gTGlrZSBPYnNpZGlhbidzIFwiTWVyZ2UgcHJvcGVydHkgLi4uIHdpdGggLi4uP1wiIChBbGwgcHJvcGVydGllcyksIHRoZVxuLy8gcXVlc3Rpb24gaXRzZWxmIGlzIHRoZSB0aXRsZSBhbmQgdGhlIHRleHQgb25seSBhZGRzIHdoYXQgdGhlIHRpdGxlIGRvZXNuJ3Rcbi8vIHNheSAtIG9mdGVuIG5vdGhpbmcuXG4vL1xuLy8gICB0aXRsZSAgICAgICAtIHRoZSBxdWVzdGlvbiAoXCJEZWxldGUgVEVSTUlOP1wiKTsgYSBzdHJpbmcgb3IgYW4gYXJyYXkgb2Zcbi8vICAgICAgICAgICAgICAgICBzdHJpbmdzIGFuZCBub2RlcyAoZm9yIGNvbG9yZWQgbmFtZXMsIHNlZSBhcHBlbmRUeXBOYW1lL1xuLy8gICAgICAgICAgICAgICAgIGFwcGVuZFN1YnR5cE5hbWUpXG4vLyAgIGJvZHkgICAgICAgIC0gb3B0aW9uYWwgcGFyYWdyYXBocywgZWFjaCBzaGFwZWQgbGlrZSB0aXRsZVxuLy8gICBjb25maXJtVGV4dCAtIGxhYmVsIG9mIHRoZSBhY3Rpb24gYnV0dG9uXG4vLyAgIHdhcm5pbmcgICAgIC0gZGVzdHJ1Y3RpdmUgYWN0aW9uIChyZWQgYnV0dG9uKVxuLy8gICBmb2N1cyAgICAgICAtIFwiY29uZmlybVwiIG9yIFwiY2FuY2VsXCI6IHdoaWNoIGJ1dHRvbiBFbnRlciB0cmlnZ2Vycy4gUmVuYW1lXG4vLyAgICAgICAgICAgICAgICAgZm9jdXNlcyB0aGUgYWN0aW9uLCBkZWxldGUgYW5kIG1lcmdlIGZvY3VzIENhbmNlbC5cbi8vICAgb25Db25maXJtIC8gb25DYW5jZWwgLSBvbkNhbmNlbCBhbHNvIGNvdmVycyBFc2NhcGUgYW5kIGEgY2xpY2sgb3V0c2lkZS5cbi8vICAgZG9udEFza0FnYWluIC0gb3B0aW9uYWw6IHNob3dzIE9ic2lkaWFuJ3MgXCJEb24ndCBhc2sgYWdhaW5cIiBjaGVja2JveCAoYXNcbi8vICAgICAgICAgICAgICAgICBpbiBpdHMgXCJEZWxldGUgZmlsZVwiLCBkZXNrdG9wIG9ubHkpIGFuZCBwYXNzZXMgaXRzIHN0YXRlIHRvXG4vLyAgICAgICAgICAgICAgICAgb25Db25maXJtKGRvbnRBc2tBZ2FpbikuIE9ubHkgZm9yIGRpYWxvZ3MgdGhhdCBtYXkgYmVcbi8vICAgICAgICAgICAgICAgICBzd2l0Y2hlZCBvZmYsIGkuZS4gYWN0aW9ucyB0aGF0IGNhbiBiZSB1bmRvbmUuXG4vL1xuLy8gQm90aCBjYWxsYmFja3MgcnVuIGZyb20gb25DbG9zZSwgaS5lLiBvbmNlIHRoZSBkaWFsb2cgaXMgZ29uZSAtIGFzIGJlZm9yZVxuLy8gdGhlIHN3aXRjaCB0byBDb25maXJtYXRpb25Nb2RhbCwgYW5kIHNvIGEgbG9uZyBvbkNvbmZpcm0gKHJld3JpdGluZyBtYW55XG4vLyBub3RlcykgbmVpdGhlciBrZWVwcyB0aGUgZGlhbG9nIG9wZW4gbm9yIHJ1bnMgdHdpY2UuXG5jbGFzcyBDb25maXJtTW9kYWwgZXh0ZW5kcyBDb25maXJtYXRpb25Nb2RhbCB7XG4gIGNvbnN0cnVjdG9yKGFwcCwgeyB0aXRsZSwgYm9keSA9IFtdLCBjb25maXJtVGV4dCwgd2FybmluZyA9IGZhbHNlLCBmb2N1cyA9IFwiY29uZmlybVwiLCBkb250QXNrQWdhaW4gPSBmYWxzZSwgb25Db25maXJtLCBvbkNhbmNlbCB9KSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLnRpdGxlID0gdGl0bGU7XG4gICAgdGhpcy5ib2R5ID0gYm9keTtcbiAgICB0aGlzLm9uQ29uZmlybSA9IG9uQ29uZmlybTtcbiAgICB0aGlzLm9uQ2FuY2VsID0gb25DYW5jZWw7XG4gICAgdGhpcy5jb25maXJtZWQgPSBmYWxzZTtcbiAgICB0aGlzLmRvbnRBc2tBZ2FpbiA9IGZhbHNlO1xuXG4gICAgLy8gQmVmb3JlIHRoZSBidXR0b25zLCBzbyBpdCBzaXRzIG9uIHRoZSBsZWZ0IGFzIGluIE9ic2lkaWFuJ3MgZGlhbG9ncy5cbiAgICBpZiAoZG9udEFza0FnYWluICYmICFQbGF0Zm9ybS5pc01vYmlsZSkge1xuICAgICAgdGhpcy5hZGRDaGVja2JveChcIkRvbid0IGFzayBhZ2FpblwiLCAoY2hlY2tlZCkgPT4ge1xuICAgICAgICB0aGlzLmRvbnRBc2tBZ2FpbiA9IGNoZWNrZWQ7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBCdXR0b25zIGFscmVhZHkgaGVyZSwgbm90IGluIG9uT3BlbjogQ29uZmlybWF0aW9uTW9kYWwub3BlbigpIGxvb2tzIGZvclxuICAgIC8vIHRoZSBpbml0aWFsLWZvY3VzIGJ1dHRvbiBiZWZvcmUgaXQgY2FsbHMgb25PcGVuLlxuICAgIHRoaXMuYWRkQnV0dG9uKChidXR0b24pID0+IHtcbiAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KFwiQ2FuY2VsXCIpLnNldENhbmNlbCgpO1xuICAgICAgaWYgKGZvY3VzID09PSBcImNhbmNlbFwiKSBidXR0b24uc2V0SW5pdGlhbEZvY3VzKCk7XG4gICAgfSk7XG4gICAgdGhpcy5hZGRCdXR0b24oKGJ1dHRvbikgPT4ge1xuICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoY29uZmlybVRleHQpLnNldEN0YSgpO1xuICAgICAgaWYgKHdhcm5pbmcpIGJ1dHRvbi5zZXREZXN0cnVjdGl2ZSgpO1xuICAgICAgaWYgKGZvY3VzID09PSBcImNvbmZpcm1cIikgYnV0dG9uLnNldEluaXRpYWxGb2N1cygpO1xuICAgICAgLy8gQnJhY2VzLCBubyByZXR1cm4gdmFsdWU6IENvbmZpcm1hdGlvbkJ1dHRvbiBrZWVwcyB0aGUgZGlhbG9nIG9wZW4gaWZcbiAgICAgIC8vIHRoZSBoYW5kbGVyIHJldHVybnMgc29tZXRoaW5nIHRydXRoeSwgYW5kIHdhaXRzIGZvciBhIHByb21pc2UuXG4gICAgICBidXR0b24ub25DbGljaygoKSA9PiB7XG4gICAgICAgIHRoaXMuY29uZmlybWVkID0gdHJ1ZTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGFwcGVuZFBhcnRzKHRoaXMudGl0bGVFbCwgdGhpcy50aXRsZSk7XG4gICAgZm9yIChjb25zdCBwYXJhZ3JhcGggb2YgdGhpcy5ib2R5KSBhcHBlbmRQYXJ0cyh0aGlzLmNvbnRlbnRFbC5jcmVhdGVFbChcInBcIiksIHBhcmFncmFwaCk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHN1cGVyLm9uQ2xvc2UoKTtcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIGlmICh0aGlzLmNvbmZpcm1lZCkgdGhpcy5vbkNvbmZpcm0/Lih0aGlzLmRvbnRBc2tBZ2Fpbik7XG4gICAgZWxzZSB0aGlzLm9uQ2FuY2VsPy4oKTtcbiAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgQ29uZmlybU1vZGFsLCBhcHBlbmRUeXBOYW1lLCBhcHBlbmRTdWJ0eXBOYW1lLCB0eXBOYW1lTm9kZSwgc3VidHlwTmFtZU5vZGUgfTtcbiIsICJjb25zdCB7IE5vdGljZSB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuXG4vLyBVbmRvIGZvciB0aGUgYWN0aW9ucyB0aGF0IHJ1biB3aXRob3V0IGFza2luZyAoZGVsZXRlIGEgU3VidHlwLCByZW1vdmUgYVxuLy8gc2hvcnRjdXQsIHRvZ2dsZSBmbG9hdGluZywgcmVzZXQgYSBjb2xvcik6IGEgbm90aWNlIHdpdGggYW4gXCJVbmRvXCIgYnV0dG9uXG4vLyByaWdodCBhZnRlciB0aGUgYWN0aW9uLiBPbmx5IHBsdWdpbiBzZXR0aW5ncywgbmV2ZXIgbm90ZXMsIGFuZCBvbmx5IHRoZVxuLy8gTEFTVCBhY3Rpb24gLSBhIG5ldyBvZmZlciByZXBsYWNlcyB0aGUgcHJldmlvdXMgb25lLCBzbyB0aGVyZSBpcyBubyBoaXN0b3J5XG4vLyBhbmQgbm8gY29tbWFuZC5cbi8vXG4vLyBQYXR0ZXJuIGF0IHRoZSBjYWxsIHNpdGU6IHNuYXBzaG90ID0gc25hcHNob3RTZXR0aW5ncyhwbHVnaW4pIGJlZm9yZSB0aGVcbi8vIGNoYW5nZSwgdGhlbiB0aGUgYWN0aW9uIGFzIHVzdWFsIChpbmNsdWRpbmcgc2F2ZVNldHRpbmdzKCkpLCB0aGVuXG4vLyBvZmZlclVuZG8oKS4gb2ZmZXJVbmRvKCkgbXVzdCBjb21lIGFmdGVyIHNhdmVTZXR0aW5ncygpIGhhcyBiZWVuIENBTExFRCAobm90XG4vLyBuZWNlc3NhcmlseSBhd2FpdGVkKSwgc2luY2UgdGhhdCBpcyB3aGF0IGJ1bXBzIHNldHRpbmdzUmV2aXNpb24uXG5cbmNvbnN0IFVORE9fTk9USUNFX0RVUkFUSU9OID0gODAwMDtcblxuLy8geyB0b2tlbiwgcmV2aXNpb24sIHNuYXBzaG90IH0gb2YgdGhlIGxhc3QgYWN0aW9uLCBvciBudWxsLlxubGV0IGN1cnJlbnQgPSBudWxsO1xuXG4vLyBUaGUgc2V0dGluZ3MgYXJlIHBsYWluIEpTT04sIHNvIHN0cnVjdHVyZWRDbG9uZSBpcyBhIGNvbXBsZXRlIGNvcHkuXG5mdW5jdGlvbiBzbmFwc2hvdFNldHRpbmdzKHBsdWdpbikge1xuICByZXR1cm4gc3RydWN0dXJlZENsb25lKHBsdWdpbi5zZXR0aW5ncyk7XG59XG5cbmZ1bmN0aW9uIG9mZmVyVW5kbyhwbHVnaW4sIG1lc3NhZ2UsIHNuYXBzaG90KSB7XG4gIGNvbnN0IHRva2VuID0ge307XG4gIC8vIHNldHRpbmdzUmV2aXNpb24gY291bnRzIGV2ZXJ5IHNhdmUgYW5kIGV2ZXJ5IGV4dGVybmFsIHJlbG9hZCAoc2VlXG4gIC8vIHNhdmVTZXR0aW5ncyBpbiBtYWluLmpzKS4gSWYgaXQgbW92ZWQgb24gYnkgdGhlIHRpbWUgVW5kbyBpcyBjbGlja2VkLFxuICAvLyBzb21ldGhpbmcgZWxzZSBjaGFuZ2VkIHRoZSBzZXR0aW5ncyBpbiBiZXR3ZWVuIC0gcmVzdG9yaW5nIHRoZSBzbmFwc2hvdFxuICAvLyB3b3VsZCBzaWxlbnRseSByZXZlcnQgdGhhdCB0b28uXG4gIGN1cnJlbnQgPSB7IHRva2VuLCByZXZpc2lvbjogcGx1Z2luLnNldHRpbmdzUmV2aXNpb24gPz8gMCwgc25hcHNob3QgfTtcbiAgY29uc3QgZnJhZ21lbnQgPSBjcmVhdGVGcmFnbWVudCgoZikgPT4ge1xuICAgIGYuYXBwZW5kVGV4dChtZXNzYWdlKTtcbiAgICAvLyBPYnNpZGlhbiBoaWRlcyB0aGUgbm90aWNlIG9uIGFueSBjbGljayBpbnNpZGUgaXQsIHRoZSBidXR0b24gaW5jbHVkZWQuXG4gICAgY29uc3QgYnV0dG9uID0gZi5jcmVhdGVFbChcImJ1dHRvblwiLCB7IGNsczogXCJ0eXAtdW5kby1idXR0b25cIiwgdGV4dDogXCJVbmRvXCIgfSk7XG4gICAgYnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB1bmRvKHBsdWdpbiwgdG9rZW4pKTtcbiAgfSk7XG4gIG5ldyBOb3RpY2UoZnJhZ21lbnQsIFVORE9fTk9USUNFX0RVUkFUSU9OKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gdW5kbyhwbHVnaW4sIHRva2VuKSB7XG4gIGlmIChjdXJyZW50Py50b2tlbiAhPT0gdG9rZW4gfHwgKHBsdWdpbi5zZXR0aW5nc1JldmlzaW9uID8/IDApICE9PSBjdXJyZW50LnJldmlzaW9uKSB7XG4gICAgbmV3IE5vdGljZShcIkNhbid0IHVuZG8gXHUyMDEzIHRoZSBzZXR0aW5ncyBoYXZlIGNoYW5nZWQgc2luY2UuXCIpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB7IHNuYXBzaG90IH0gPSBjdXJyZW50O1xuICBjdXJyZW50ID0gbnVsbDtcbiAgLy8gSW4gcGxhY2UsIHNvIGV2ZXJ5IHJlZmVyZW5jZSB0byBwbHVnaW4uc2V0dGluZ3Mgc3RheXMgdmFsaWQuIFRoZSBzbmFwc2hvdFxuICAvLyBpcyB1c2VkIG9ubHkgb25jZSwgbm8gc2Vjb25kIGNvcHkgbmVlZGVkLlxuICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhwbHVnaW4uc2V0dGluZ3MpKSBkZWxldGUgcGx1Z2luLnNldHRpbmdzW2tleV07XG4gIE9iamVjdC5hc3NpZ24ocGx1Z2luLnNldHRpbmdzLCBzbmFwc2hvdCk7XG4gIGF3YWl0IHBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgLy8gVGhlIGZ1bGwgcmVmcmVzaCBvbiBwdXJwb3NlOiBpdCByZS1yZW5kZXJzIHRoZSBUWVAtUGFuZSwgd2hvc2UgZnJvbnRtYXR0ZXJcbiAgLy8gZWRpdG9ycyBvbmx5IHJlYWQgdGhlIHNldHRpbmdzIHdoZW4gbW91bnRlZC5cbiAgcGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgc25hcHNob3RTZXR0aW5ncywgb2ZmZXJVbmRvIH07XG4iLCAiY29uc3QgeyBtb21lbnQgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcblxuLy8gQSBzaG9ydGN1dCBpcyBhIHZhbHVlIGNvbXB1dGVkIG9ubHkgd2hlbiBhIG5vdGUgaXMgY3JlYXRlZC4gSXQgaXMgc3RvcmVkXG4vLyBORVhUIFRPIHRoZSBwcm9wZXJ0eSdzIGZyb250bWF0dGVyIHZhbHVlLCBub3QgaW4gaXQ6IGluXG4vLyBzZXR0aW5ncy50eXBTaG9ydGN1dHNbVFlQXVtrZXldIGZvciB0aGUgVFlQLUZyb250bWF0dGVyLCBvciBpbiB0aGUgc2hvcnRjdXRzXG4vLyBvYmplY3Qgb2YgYSBTdWJ0eXAgYmxvY2sgKHNlZSBzdWJ0eXBzLmpzKTpcbi8vICAgeyBuYW1lOiBcInRvZGF5XCIgfSAgICAgICAgICAgIC0gZml4ZWQgdG9rZW4sIHJlc29sdmVkIGJ5IHRoZSBwbHVnaW5cbi8vICAgeyBuYW1lOiBcInRwLjxzY3JpcHQ+XCIgfSAgICAgIC0gVGVtcGxhdGVyIHNjcmlwdCwgb25seSBUWVAuanMgY2FuIHJlc29sdmUgaXRcbi8vICAgeyBuYW1lOiBcInRwLjxzY3JpcHQ+XCIsIGFyZ3M6IHsgZm9sZGVyOiBcIkxpdGVyYXR1clwiLCB5ZWFyOiAyMDI0IH0gfVxuLy8gICAgIC0gdGhlIHNhbWUgd2l0aCBhcmd1bWVudHMuIFRoZSBzY3JpcHQgZGVjbGFyZXMgdGhlIHBhcmFtZXRlciBuYW1lcyBpblxuLy8gICAgICAgaXRzIEB0eXAtc2hvcnRjdXQgbWFya2VyIChzZWUgc2hvcnRjdXQtc2NyaXB0cy5qcyk7IFRZUC5qcyBwYXNzZXMgdGhlXG4vLyAgICAgICBvYmplY3Qgb24gYXMgY3R4LmFyZ3MuIEZpeGVkIHRva2VucyBuZXZlciBoYXZlIGFyZ3VtZW50cy5cbi8vXG4vLyBXaHkgbmV4dCB0byB0aGUgdmFsdWU6IE9ic2lkaWFuIHBpY2tzIGEgcm93J3MgaW5wdXQgZnJvbSB0aGUgcHJvcGVydHkgdHlwZVxuLy8gaW4gdHlwZXMuanNvbi4gQSBkYXRlL251bWJlci9jaGVja2JveCBwcm9wZXJ0eSBjYW4ndCB0YWtlIGEgdG9rZW4gbGlrZVxuLy8gXCJ7e3RvZGF5fX1cIiBhdCBhbGwsIGEgc3RvcmVkIG9uZSB0cmlnZ2VycyB0aGUgXCJUeXBlIG1pc21hdGNoXCIgd2FybmluZywgYW5kXG4vLyB0aGUgbGlzdCB3aWRnZXQgc2lsZW50bHkgdHVybnMgYSBzdHJpbmcgaW50byBhbiBhcnJheSBvbiBmaXJzdCBlZGl0LiBLZXB0XG4vLyBhcGFydCwgdGhlIHZhbHVlIHN0YXlzIHR5cGUtY2xlYW4gYW5kIHRoZSBuYXRpdmUgd2lkZ2V0IHVudG91Y2hlZC5cbi8vXG4vLyBUaGUgZnJvbnRtYXR0ZXIgdmFsdWUgc3RheXMgYW5kIHNlcnZlcyBhcyBGQUxMQkFDSzogaWYgdGhlIHNjcmlwdCBpcyBtaXNzaW5nXG4vLyBvciB0aHJvd3MsIFRZUC5qcyB3cml0ZXMgaXQgaW5zdGVhZCBvZiBhbiBlbXB0eSB2YWx1ZS4gQSBzY3JpcHQgdGhhdFxuLy8gZGVsaWJlcmF0ZWx5IHJldHVybnMgbnVsbC9cIlwiIChlLmcuIEVTQyBpbiBhIHBpY2tlcikgaXMgbm90IGEgZmFpbHVyZSBhbmRcbi8vIGxlYXZlcyB0aGUgcHJvcGVydHkgZW1wdHkuXG5cbi8vIFRva2VucyB0aGUgcGx1Z2luIHJlc29sdmVzIGl0c2VsZiwgd2l0aG91dCBUZW1wbGF0ZXIgLSBzbyBnZXRUeXBEZWZhdWx0cygpXG4vLyBmaWxscyB0aGVtIGluLiBSZXNvbHZlZCBvbiBlYWNoIGNhbGwsIG5vdCB3aGVuIHNldCwgc28gXCJ0b2RheVwiIGlzIHRoZSBkYXlcbi8vIHRoZSBub3RlIGlzIGNyZWF0ZWQuXG5jb25zdCBGSVhFRF9TSE9SVENVVFMgPSBbXG4gIHtcbiAgICBuYW1lOiBcInRvZGF5XCIsXG4gICAgZGVzY3JpcHRpb246IFwiSGV1dGlnZXMgRGF0dW0gKEpKSkotTU0tVFQpXCIsXG4gICAgcmVzb2x2ZTogKCkgPT4gbW9tZW50KCkuZm9ybWF0KFwiWVlZWS1NTS1ERFwiKSxcbiAgfSxcbiAge1xuICAgIG5hbWU6IFwibm93XCIsXG4gICAgZGVzY3JpcHRpb246IFwiQWt0dWVsbGVzIERhdHVtIG1pdCBVaHJ6ZWl0IChKSkpKLU1NLVRUIEhIOm1tKVwiLFxuICAgIHJlc29sdmU6ICgpID0+IG1vbWVudCgpLmZvcm1hdChcIllZWVktTU0tREQgSEg6bW1cIiksXG4gIH0sXG4gIHtcbiAgICAvLyBUaGUgZmlsZSdzIGNyZWF0aW9uIGRhdGUgKGZpbGUuc3RhdC5jdGltZSksIG5vdCB0aGUgY2FsbCB0aW1lOyBmYWxsc1xuICAgIC8vIGJhY2sgdG8gbm93IHdpdGhvdXQgYSBmaWxlLlxuICAgIG5hbWU6IFwiY3JlYXRlZFwiLFxuICAgIGRlc2NyaXB0aW9uOiBcIkVyc3RlbGx1bmdzZGF0dW0gZGVyIERhdGVpIChKSkpKLU1NLVRUKVwiLFxuICAgIHJlc29sdmU6IChmaWxlKSA9PiBtb21lbnQoZmlsZT8uc3RhdD8uY3RpbWUgPz8gRGF0ZS5ub3coKSkuZm9ybWF0KFwiWVlZWS1NTS1ERFwiKSxcbiAgfSxcbl07XG5cbi8vIFNjcmlwdCBzaG9ydGN1dHMgY2FycnkgdGhpcyBwcmVmaXggc28gYSBzY3JpcHQgY2FuIG5ldmVyIGNvbGxpZGUgd2l0aCBhXG4vLyBmaXhlZCB0b2tlbiwgbm90IGV2ZW4gYSBcInRvZGF5LmpzXCIgaW4gdGhlIHNjcmlwdCBmb2xkZXIuXG5jb25zdCBTQ1JJUFRfUFJFRklYID0gXCJ0cC5cIjtcblxuZnVuY3Rpb24gZmluZEZpeGVkU2hvcnRjdXQobmFtZSkge1xuICByZXR1cm4gRklYRURfU0hPUlRDVVRTLmZpbmQoKHNob3J0Y3V0KSA9PiBzaG9ydGN1dC5uYW1lID09PSBuYW1lKSA/PyBudWxsO1xufVxuXG4vLyBTY3JpcHQgbmFtZSBvZiBhIFwidHAuPHNjcmlwdD5cIiBzaG9ydGN1dCwgb3RoZXJ3aXNlIG51bGwuIFRoZSBzY3JpcHQgbmFtZSBpc1xuLy8gdGhlIGZpbGUgbmFtZSB3aXRob3V0IFwiLmpzXCIsIHNvIHVtbGF1dHMsIFwiLVwiIGFuZCBzcGFjZXMgYXJlIGFsbG93ZWQuXG5mdW5jdGlvbiBzY3JpcHROYW1lT2YobmFtZSkge1xuICByZXR1cm4gdHlwZW9mIG5hbWUgPT09IFwic3RyaW5nXCIgJiYgbmFtZS5zdGFydHNXaXRoKFNDUklQVF9QUkVGSVgpID8gbmFtZS5zbGljZShTQ1JJUFRfUFJFRklYLmxlbmd0aCkgOiBudWxsO1xufVxuXG5mdW5jdGlvbiBpc1NjcmlwdFNob3J0Y3V0KHJlY29yZCkge1xuICByZXR1cm4gc2NyaXB0TmFtZU9mKHJlY29yZD8ubmFtZSkgIT09IG51bGw7XG59XG5cbi8vIERpc3BsYXkgZm9ybSBpbiB0aGUgcHJvcGVydHkgcm93IChjaGlwKSBhbmQgdGhlIHBpY2tlcjogdGhlIGJhcmUgbmFtZSBwbHVzXG4vLyBpdHMgYXJndW1lbnRzLiBUaGUgY2hpcCBpdHNlbGYgbWFya3MgaXQgYXMgYSBzaG9ydGN1dCwgc28gbm8gYnJhY2VzLlxuZnVuY3Rpb24gc2hvcnRjdXRMYWJlbChyZWNvcmQpIHtcbiAgaWYgKCFyZWNvcmQ/Lm5hbWUpIHJldHVybiBcIlwiO1xuICBjb25zdCB2YWx1ZXMgPSBPYmplY3QudmFsdWVzKHJlY29yZC5hcmdzID8/IHt9KS5maWx0ZXIoKHZhbHVlKSA9PiB2YWx1ZSAhPT0gdW5kZWZpbmVkKTtcbiAgcmV0dXJuIHZhbHVlcy5sZW5ndGggPiAwID8gYCR7cmVjb3JkLm5hbWV9OiAke3ZhbHVlcy5qb2luKFwiLCBcIil9YCA6IHJlY29yZC5uYW1lO1xufVxuXG4vLyBDb252ZXJ0cyBhIHR5cGVkIGFyZ3VtZW50IHRvIHRoZSB0eXBlIGl0IG9idmlvdXNseSBtZWFucywgc28gYSBzY3JpcHQgZ2V0c1xuLy8gNSBhcyBhIG51bWJlciBhbmQgdHJ1ZSBhcyBhIGJvb2xlYW4gKG1hdHRlcnMgd2hlbiB0aGUgdmFsdWUgbGFuZHMgaW4gYVxuLy8gbnVtYmVyIHByb3BlcnR5KS4gRGVsaWJlcmF0ZWx5IHRoZXNlIGZldyBjYXNlcyBpbnN0ZWFkIG9mIEpTT04ucGFyc2UsIHdoaWNoXG4vLyB3b3VsZCBmYWlsIG9uIFwiTGl0ZXJhdHVyXCIuIEFuIGVtcHR5IGZpZWxkIG1lYW5zIFwibm90IHNldFwiICh1bmRlZmluZWQpIGFuZFxuLy8gZHJvcHMgb3V0IG9mIHRoZSBhcmd1bWVudCBvYmplY3QsIHNvIFwiYXJncy55ZWFyID8/IGZhbGxiYWNrXCIgd29ya3MuXG5mdW5jdGlvbiBwYXJzZUFyZ1ZhbHVlKHJhdykge1xuICBjb25zdCB0ZXh0ID0gU3RyaW5nKHJhdyA/PyBcIlwiKS50cmltKCk7XG4gIGlmICh0ZXh0ID09PSBcIlwiKSByZXR1cm4gdW5kZWZpbmVkO1xuICBpZiAodGV4dCA9PT0gXCJ0cnVlXCIpIHJldHVybiB0cnVlO1xuICBpZiAodGV4dCA9PT0gXCJmYWxzZVwiKSByZXR1cm4gZmFsc2U7XG4gIGlmICh0ZXh0ID09PSBcIm51bGxcIikgcmV0dXJuIG51bGw7XG4gIGlmICgvXi0/XFxkKyg/OlxcLlxcZCspPyQvLnRlc3QodGV4dCkpIHJldHVybiBOdW1iZXIodGV4dCk7XG4gIHJldHVybiB0ZXh0O1xufVxuXG4vLyBQYXJhbWV0ZXIgbmFtZXMgd2hvc2UgdmFsdWVzIHRoZSBwbHVnaW4gb3IgVFlQLmpzIGFscmVhZHkga25vdzsgdGhleSBhcmVcbi8vIGZpbGxlZCBpbiBhdCBjYWxsIHRpbWUsIG5vdCBhc2tlZCBmb3I6XG4vLyAgIG5ld0ZpbGUgIHRoZSBuZXdseSBjcmVhdGVkIG5vdGVcbi8vICAgY3R4ICAgICAgdGhlIGNvbnRleHQgeyB0eXAsIHN1YnR5cCwga2V5LCB2YWx1ZXMsIGFmdGVyLCBhcmdzIH1cbi8vICAga2V5ICAgICAgdGhlIHByb3BlcnR5IHRoZSBzaG9ydGN1dCBzaXRzIG9uLCBzbyBhIHNjcmlwdCBsaWtlIHJlbGF0aW9uLmpzXG4vLyAgICAgICAgICAgIGdldHMgdGhlIHJpZ2h0IG9uZSB3aGVyZXZlciB0aGUgc2hvcnRjdXQgaXMgdXNlZFxuLy8gXCJ0cFwiIGFsd2F5cyBjb21lcyBmaXJzdCBhbmQgbmVlZG4ndCBiZSBkZWNsYXJlZDsgaWYgaXQgaXMsIGl0IGlzIHNraXBwZWQuXG5jb25zdCBSRVNFUlZFRF9QQVJBTVMgPSBbXCJuZXdGaWxlXCIsIFwiY3R4XCIsIFwia2V5XCJdO1xuXG4vLyBQYXJhbWV0ZXJzIHRoYXQgZ2V0IGFuIGlucHV0IGZpZWxkOiBldmVyeXRoaW5nIG5vdCByZXNlcnZlZC4gcGFyYW1zID09PSBudWxsXG4vLyAobWFya2VyIHdpdGhvdXQgcGFyZW50aGVzZXMpIG1lYW5zIHRoZSBjbGFzc2ljIGNhbGwsIGFsc28gd2l0aG91dCBmaWVsZHMuXG5mdW5jdGlvbiBpbnB1dFBhcmFtcyhwYXJhbXMpIHtcbiAgcmV0dXJuIChwYXJhbXMgPz8gW10pLmZpbHRlcigobmFtZSkgPT4gbmFtZSAhPT0gXCJ0cFwiICYmICFSRVNFUlZFRF9QQVJBTVMuaW5jbHVkZXMobmFtZSkpO1xufVxuXG4vLyBJbnB1dHMgKG9uZSBzdHJpbmcgcGVyIHBhcmFtZXRlcikgdG8gdGhlIHN0b3JlZCBhcmd1bWVudCBvYmplY3QsIGluIHRoZVxuLy8gZGVjbGFyZWQgb3JkZXIgc28gc2hvcnRjdXRMYWJlbCgpIHNob3dzIHRoZW0gdGhhdCB3YXkuIEVtcHR5IGZpZWxkcyBhcmUgbGVmdFxuLy8gb3V0LlxuZnVuY3Rpb24gYnVpbGRBcmdzKHBhcmFtcywgaW5wdXRzKSB7XG4gIGNvbnN0IGFyZ3MgPSB7fTtcbiAgZm9yIChjb25zdCBuYW1lIG9mIGlucHV0UGFyYW1zKHBhcmFtcykpIHtcbiAgICBjb25zdCB2YWx1ZSA9IHBhcnNlQXJnVmFsdWUoaW5wdXRzW25hbWVdKTtcbiAgICBpZiAodmFsdWUgIT09IHVuZGVmaW5lZCkgYXJnc1tuYW1lXSA9IHZhbHVlO1xuICB9XG4gIHJldHVybiBhcmdzO1xufVxuXG4vLyBCdWlsZHMgdGhlIGFyZ3VtZW50cyBmb3IgZih0cCwgLi4uaGVyZSkgZnJvbSB0aGUgZGVjbGFyZWQgcGFyYW1ldGVyIGxpc3QuXG4vLyBDYWxsZWQgZnJvbSBUWVAuanMsIHRoZSBvbmx5IHBsYWNlIHRoYXQga25vd3MgbmV3RmlsZSBhbmQgY3R4LlxuLy9cbi8vIFdpdGhvdXQgcGFyZW50aGVzZXMgKHBhcmFtcyA9PT0gbnVsbCkgaXQgc3RheXMgdGhlIGNsYXNzaWMgZih0cCwgbmV3RmlsZSxcbi8vIGN0eCkuIE90aGVyd2lzZSBlYWNoIGVudHJ5IHJlc29sdmVzIHRvIHRoZSBwYXNzZWQgdmFsdWUgKHJlc2VydmVkIG5hbWVzKSBvclxuLy8gdGhlIHR5cGVkIGFyZ3VtZW50LlxuLy9cbi8vIEEgZG90dGVkIG5hbWUgKFwib3B0aW9ucy50eXBcIikgaXMgYSBGSUVMRCBvZiBhbiBvYmplY3QgYXJndW1lbnQ6IGFsbFxuLy8gXCJvcHRpb25zLipcIiBjb2xsZWN0IGludG8gb25lIG9iamVjdCBhdCB0aGUgcG9zaXRpb24gb2YgdGhlIGZpcnN0IG9uZS4gVGhpc1xuLy8gc2VydmVzIHNjcmlwdHMgdGhhdCB0YWtlIGFuIG9wdGlvbnMgb2JqZWN0IHdpdGhvdXQgdHlwaW5nIEpTT04uIE9uZSBsZXZlbFxuLy8gb25seSAtIFwiYS5iLmNcIiBnaXZlcyBhIGZpZWxkIGxpdGVyYWxseSBuYW1lZCBcImIuY1wiLlxuZnVuY3Rpb24gcmVzb2x2ZUNhbGxBcmdzKHBhcmFtcywgYXJncywgcmVzZXJ2ZWQgPSB7fSkge1xuICBpZiAocGFyYW1zID09PSBudWxsIHx8IHBhcmFtcyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gW3Jlc2VydmVkLm5ld0ZpbGUsIHJlc2VydmVkLmN0eF07XG5cbiAgY29uc3QgY2FsbEFyZ3MgPSBbXTtcbiAgY29uc3Qgb2JqZWN0SW5kZXggPSBuZXcgTWFwKCk7XG4gIGZvciAoY29uc3QgbmFtZSBvZiBwYXJhbXMpIHtcbiAgICBpZiAobmFtZSA9PT0gXCJ0cFwiKSBjb250aW51ZTtcbiAgICBpZiAoUkVTRVJWRURfUEFSQU1TLmluY2x1ZGVzKG5hbWUpKSB7XG4gICAgICBjYWxsQXJncy5wdXNoKHJlc2VydmVkW25hbWVdKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBkb3QgPSBuYW1lLmluZGV4T2YoXCIuXCIpO1xuICAgIGlmIChkb3QgPT09IC0xKSB7XG4gICAgICBjYWxsQXJncy5wdXNoKGFyZ3M/LltuYW1lXSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgYmFzZSA9IG5hbWUuc2xpY2UoMCwgZG90KTtcbiAgICBpZiAoIW9iamVjdEluZGV4LmhhcyhiYXNlKSkge1xuICAgICAgb2JqZWN0SW5kZXguc2V0KGJhc2UsIGNhbGxBcmdzLmxlbmd0aCk7XG4gICAgICBjYWxsQXJncy5wdXNoKHt9KTtcbiAgICB9XG4gICAgY29uc3QgdmFsdWUgPSBhcmdzPy5bbmFtZV07XG4gICAgaWYgKHZhbHVlICE9PSB1bmRlZmluZWQpIGNhbGxBcmdzW29iamVjdEluZGV4LmdldChiYXNlKV1bbmFtZS5zbGljZShkb3QgKyAxKV0gPSB2YWx1ZTtcbiAgfVxuICByZXR1cm4gY2FsbEFyZ3M7XG59XG5cbi8vIFdoZXRoZXIgdHlwZXMuanNvbiAob3IsIGlmIHVuc2V0LCB0aGUgcHJvcGVydHkncyB1c2FnZSkgZGVjbGFyZXMgYSBsaXN0LlxuLy8gVGhlbiBhIHJlc29sdmVkIHNob3J0Y3V0IHZhbHVlIGlzIHdyYXBwZWQgaW4gYSBvbmUtZWxlbWVudCBhcnJheSB0byBtYXRjaC5cbi8vIFdpdGhvdXQgYXBwICh0ZXN0cykgbm90aGluZyBpcyB3cmFwcGVkLlxuZnVuY3Rpb24gaXNMaXN0UHJvcGVydHkoYXBwLCBrZXkpIHtcbiAgcmV0dXJuIGFwcD8ubWV0YWRhdGFUeXBlTWFuYWdlcj8uZ2V0VHlwZUluZm8/LihrZXkpPy5leHBlY3RlZD8udHlwZSA9PT0gXCJtdWx0aXRleHRcIjtcbn1cblxuLy8gQ29weSBvZiBmcm9udG1hdHRlciBpbiB3aGljaCBldmVyeSBrZXkgd2l0aCBhIHNob3J0Y3V0IGNhcnJpZXMgaXRzIHZhbHVlOlxuLy8gICAtIGZpeGVkIHRva2VuIC0+IHJlc29sdmVkICh3cmFwcGVkIGZvciBsaXN0IHByb3BlcnRpZXMpLFxuLy8gICAtIFwidHAuPHNjcmlwdD5cIiAtPiBudWxsOyBvbmx5IFRlbXBsYXRlciBjYW4gcmVzb2x2ZSBpdCwgVFlQLmpzIGdldHMgdGhlc2Vcbi8vICAgICBrZXlzIGZyb20gZ2V0VHlwU2hvcnRjdXRzKCkgYW5kIGZpbGxzIHRoZW0gaW4gaXRzZWxmLlxuLy8gS2V5cyB3aXRob3V0IGEgc2hvcnRjdXQgc3RheSBhcyB0aGV5IGFyZS4gVGhlIHN0b3JlZCB2YWx1ZSBvZiBhIGtleSBXSVRIIGFcbi8vIHNob3J0Y3V0IGlzIG9ubHkgb3ZlcnJpZGRlbiBoZXJlLCBuZXZlciBkZWxldGVkIC0gaXQgaXMgdGhlIGZhbGxiYWNrLlxuZnVuY3Rpb24gcmVzb2x2ZVNob3J0Y3V0cyhmcm9udG1hdHRlciwgc2hvcnRjdXRzLCB7IGZpbGUsIGFwcCB9ID0ge30pIHtcbiAgY29uc3QgcmVzb2x2ZWQgPSB7fTtcbiAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoZnJvbnRtYXR0ZXIpKSB7XG4gICAgY29uc3QgcmVjb3JkID0gc2hvcnRjdXRzPy5ba2V5XTtcbiAgICBjb25zdCBmaXhlZCA9IHJlY29yZCA/IGZpbmRGaXhlZFNob3J0Y3V0KHJlY29yZC5uYW1lKSA6IG51bGw7XG4gICAgaWYgKGZpeGVkKSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBmaXhlZC5yZXNvbHZlKGZpbGUpO1xuICAgICAgcmVzb2x2ZWRba2V5XSA9IGlzTGlzdFByb3BlcnR5KGFwcCwga2V5KSA/IFtyZXN1bHRdIDogcmVzdWx0O1xuICAgIH0gZWxzZSBpZiAoaXNTY3JpcHRTaG9ydGN1dChyZWNvcmQpKSB7XG4gICAgICByZXNvbHZlZFtrZXldID0gbnVsbDtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVzb2x2ZWRba2V5XSA9IHZhbHVlO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzb2x2ZWQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBGSVhFRF9TSE9SVENVVFMsXG4gIFNDUklQVF9QUkVGSVgsXG4gIGZpbmRGaXhlZFNob3J0Y3V0LFxuICBzY3JpcHROYW1lT2YsXG4gIGlzU2NyaXB0U2hvcnRjdXQsXG4gIHNob3J0Y3V0TGFiZWwsXG4gIHBhcnNlQXJnVmFsdWUsXG4gIGJ1aWxkQXJncyxcbiAgaW5wdXRQYXJhbXMsXG4gIHJlc29sdmVDYWxsQXJncyxcbiAgUkVTRVJWRURfUEFSQU1TLFxuICByZXNvbHZlU2hvcnRjdXRzLFxufTtcbiIsICJjb25zdCB7IEZ1enp5U3VnZ2VzdE1vZGFsLCBNb2RhbCwgU2V0dGluZyB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBGSVhFRF9TSE9SVENVVFMsIFNDUklQVF9QUkVGSVgsIGJ1aWxkQXJncywgaW5wdXRQYXJhbXMgfSA9IHJlcXVpcmUoXCIuL3Nob3J0Y3V0c1wiKTtcblxuLy8gTGlzdCBsYWJlbDogdGhlIG5hbWUsIHBsdXMgdGhlIGRlY2xhcmVkIHBhcmFtZXRlciBuYW1lcyBmb3IgYSBzY3JpcHQsIHNvXG4vLyB0aGUgcGlja2VyIGFscmVhZHkgc2hvd3MgdGhhdCAoYW5kIGhvdykgaXQgdGFrZXMgYXJndW1lbnRzLlxuZnVuY3Rpb24gaXRlbUxhYmVsKGl0ZW0pIHtcbiAgcmV0dXJuIGl0ZW0ucGFyYW1zID8gYCR7aXRlbS5uYW1lfSgke2l0ZW0ucGFyYW1zLmpvaW4oXCIsIFwiKX0pYCA6IGl0ZW0ubmFtZTtcbn1cblxuLy8gUGlja3MgYSBzaG9ydGN1dCBmb3IgYSBUWVAtRnJvbnRtYXR0ZXIgcHJvcGVydHkgKGJ1dHRvbiBvciBjaGlwIGluIHRoZSByb3csXG4vLyBzZWUgdHlwLWZyb250bWF0dGVyLWVkaXRvci5qcykuIFNlYXJjaGFibGUsIGFuZCBzY3JpcHRzIHNob3cgdGhlIGRlc2NyaXB0aW9uXG4vLyBmcm9tIHRoZWlyIEB0eXAtc2hvcnRjdXQgbWFya2VyLiBOZXZlciBmcmVlIHRleHQ6IHRoZSBsaXN0IGlzIHRoZSBzb3VyY2Ugb2Zcbi8vIHRydXRoLCBzbyBhIHR5cG8gaW4gYSBzY3JpcHQgbmFtZSBpcyBpbXBvc3NpYmxlLlxuY2xhc3MgU2hvcnRjdXRQaWNrZXJNb2RhbCBleHRlbmRzIEZ1enp5U3VnZ2VzdE1vZGFsIHtcbiAgY29uc3RydWN0b3IoYXBwLCBrZXksIGl0ZW1zLCByZXNvbHZlKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLml0ZW1zID0gaXRlbXM7XG4gICAgdGhpcy5yZXNvbHZlID0gcmVzb2x2ZTtcbiAgICB0aGlzLmNob3NlbiA9IGZhbHNlO1xuICAgIHRoaXMuc2V0UGxhY2Vob2xkZXIoYFNob3J0Y3V0IGZcdTAwRkNyIFx1MjAxRSR7a2V5fVx1MjAxQyBcdTIwMTMgRVNDIGZcdTAwRkNyIEFiYnJ1Y2hgKTtcbiAgfVxuXG4gIGdldEl0ZW1zKCkge1xuICAgIHJldHVybiB0aGlzLml0ZW1zO1xuICB9XG5cbiAgLy8gRnV6enkgc2VhcmNoIGFsc28gY292ZXJzIHRoZSBkZXNjcmlwdGlvbjogXCJFcnN0ZWxsdW5nc2RhdHVtXCIgZmluZHMgXCJjcmVhdGVkXCIuXG4gIGdldEl0ZW1UZXh0KGl0ZW0pIHtcbiAgICBjb25zdCBsYWJlbCA9IGl0ZW1MYWJlbChpdGVtKTtcbiAgICByZXR1cm4gaXRlbS5kZXNjcmlwdGlvbiA/IGAke2xhYmVsfSAke2l0ZW0uZGVzY3JpcHRpb259YCA6IGxhYmVsO1xuICB9XG5cbiAgcmVuZGVyU3VnZ2VzdGlvbihtYXRjaCwgZWwpIHtcbiAgICBjb25zdCBpdGVtID0gbWF0Y2guaXRlbTtcbiAgICBlbC5hZGRDbGFzcyhcInR5cC1zaG9ydGN1dC1zdWdnZXN0aW9uXCIpO1xuICAgIGVsLmNyZWF0ZUVsKFwiY29kZVwiLCB7IGNsczogXCJ0eXAtc2hvcnRjdXQtc3VnZ2VzdGlvbi1uYW1lXCIsIHRleHQ6IGl0ZW1MYWJlbChpdGVtKSB9KTtcbiAgICBpZiAoaXRlbS5kZXNjcmlwdGlvbikgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtc2hvcnRjdXQtc3VnZ2VzdGlvbi1kZXNjXCIsIHRleHQ6IGl0ZW0uZGVzY3JpcHRpb24gfSk7XG4gIH1cblxuICAvLyBPYnNpZGlhbidzIHNlbGVjdFN1Z2dlc3Rpb24oKSBjYWxscyBjbG9zZSgpIEJFRk9SRSBvbkNob29zZUl0ZW0oKSwgc29cbiAgLy8gXCJjaG9zZW5cIiBtdXN0IGJlIHNldCBoZXJlIC0gb3RoZXJ3aXNlIG9uQ2xvc2UoKSByZXNvbHZlcyB3aXRoIG51bGwgZmlyc3RcbiAgLy8gYW5kIHRoZSBjaG9pY2UgaXMgbG9zdC4gU2FtZSBhcyBpbiBUeXBQaWNrZXJNb2RhbCAodHlwLXBpY2tlci5qcykuXG4gIHNlbGVjdFN1Z2dlc3Rpb24oaXRlbSwgZXZ0KSB7XG4gICAgdGhpcy5jaG9zZW4gPSB0cnVlO1xuICAgIHN1cGVyLnNlbGVjdFN1Z2dlc3Rpb24oaXRlbSwgZXZ0KTtcbiAgfVxuXG4gIG9uQ2hvb3NlSXRlbShpdGVtKSB7XG4gICAgdGhpcy5yZXNvbHZlKGl0ZW0pO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICBzdXBlci5vbkNsb3NlKCk7XG4gICAgaWYgKCF0aGlzLmNob3NlbikgdGhpcy5yZXNvbHZlKG51bGwpO1xuICB9XG59XG5cbi8vIEFza3MgZm9yIHRoZSBhcmd1bWVudHMgb2YgYSBzY3JpcHQgdGhhdCBkZWNsYXJlcyBzb21lOiBvbmUgZGlhbG9nIHdpdGggYWxsXG4vLyBmaWVsZHMsIG5hbWVkIGFmdGVyIHRoZSBzY3JpcHQncyBwYXJhbWV0ZXJzIGFuZCBwcmVmaWxsZWQgd2l0aCB0aGUgc3RvcmVkXG4vLyB2YWx1ZXMsIHNvIHBpY2tpbmcgdGhlIHNhbWUgc2NyaXB0IGFnYWluIGlzIGhvdyBzaW5nbGUgdmFsdWVzIGdldCBmaXhlZC5cbi8vIEFuIGVtcHR5IGZpZWxkIG1lYW5zIFwibm90IHNldFwiIChzZWUgYnVpbGRBcmdzKTsgdGhlcmUgaXMgbm8gdmFsaWRhdGlvbixcbi8vIHNpbmNlIG9ubHkgdGhlIHNjcmlwdCBrbm93cyB3aGF0IGl0IG5lZWRzLlxuY2xhc3MgU2hvcnRjdXRBcmdzTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKGFwcCwgaXRlbSwgZXhpc3RpbmcsIHJlc29sdmUpIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMuaXRlbSA9IGl0ZW07XG4gICAgdGhpcy5yZXNvbHZlID0gcmVzb2x2ZTtcbiAgICB0aGlzLmZpZWxkcyA9IGlucHV0UGFyYW1zKGl0ZW0ucGFyYW1zKTtcbiAgICB0aGlzLmlucHV0cyA9IHt9O1xuICAgIGZvciAoY29uc3QgbmFtZSBvZiB0aGlzLmZpZWxkcykge1xuICAgICAgY29uc3QgdmFsdWUgPSBleGlzdGluZz8uW25hbWVdO1xuICAgICAgdGhpcy5pbnB1dHNbbmFtZV0gPSB2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSBudWxsID8gXCJcIiA6IFN0cmluZyh2YWx1ZSk7XG4gICAgfVxuICAgIHRoaXMuY29uZmlybWVkID0gZmFsc2U7XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgdGhpcy50aXRsZUVsLnNldFRleHQoYEFyZ3VtZW50ZSBmXHUwMEZDciAke3RoaXMuaXRlbS5uYW1lfWApO1xuICAgIGlmICh0aGlzLml0ZW0uZGVzY3JpcHRpb24pIHtcbiAgICAgIHRoaXMuY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtc2hvcnRjdXQtYXJncy1kZXNjXCIsIHRleHQ6IHRoaXMuaXRlbS5kZXNjcmlwdGlvbiB9KTtcbiAgICB9XG4gICAgZm9yIChjb25zdCBuYW1lIG9mIHRoaXMuZmllbGRzKSB7XG4gICAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRlbnRFbCkuc2V0TmFtZShuYW1lKS5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0XG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMuaW5wdXRzW25hbWVdKVxuICAgICAgICAgIC5vbkNoYW5nZSgodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMuaW5wdXRzW25hbWVdID0gdmFsdWU7XG4gICAgICAgICAgfSlcbiAgICAgICAgICAvLyBFbnRlciBzdWJtaXRzLCBsaWtlIE9ic2lkaWFuJ3Mgb3duIHJlbmFtZSBkaWFsb2dzLlxuICAgICAgICAgIC5pbnB1dEVsLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIChldmVudCkgPT4ge1xuICAgICAgICAgICAgaWYgKGV2ZW50LmtleSA9PT0gXCJFbnRlclwiICYmICFldmVudC5pc0NvbXBvc2luZykge1xuICAgICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgICB0aGlzLnN1Ym1pdCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pXG4gICAgICApO1xuICAgIH1cbiAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRlbnRFbCkuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICBidXR0b25cbiAgICAgICAgLnNldEJ1dHRvblRleHQoXCJcdTAwRENiZXJuZWhtZW5cIilcbiAgICAgICAgLnNldEN0YSgpXG4gICAgICAgIC5vbkNsaWNrKCgpID0+IHRoaXMuc3VibWl0KCkpXG4gICAgKTtcbiAgfVxuXG4gIHN1Ym1pdCgpIHtcbiAgICB0aGlzLmNvbmZpcm1lZCA9IHRydWU7XG4gICAgdGhpcy5jbG9zZSgpO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIC8vIEVTQyBvciBhIGNsaWNrIG91dHNpZGUga2VlcHMgdGhlIGN1cnJlbnQgc2hvcnRjdXQgLSBhbiBhY2NpZGVudGFsIGNsb3NlXG4gICAgLy8gbXVzdCBub3Qgc2lsZW50bHkgbG9zZSBkYXRhLlxuICAgIHRoaXMucmVzb2x2ZSh0aGlzLmNvbmZpcm1lZCA/IGJ1aWxkQXJncyh0aGlzLmZpZWxkcywgdGhpcy5pbnB1dHMpIDogbnVsbCk7XG4gIH1cbn1cblxuLy8gT3BlbnMgdGhlIHBpY2tlciBmb3IgcHJvcGVydHkgYGtleWAuIGdldFNjcmlwdHMgaXMgdGhlIGFjY2Vzc29yIGZyb21cbi8vIHJlZ2lzdGVyU2hvcnRjdXRTY3JpcHRzKCk7IGN1cnJlbnQgaXMgdGhlIHNob3J0Y3V0IHNldCBub3cgKHRvIHByZWZpbGwgdGhlXG4vLyBhcmd1bWVudHMpLiBSZXNvbHZlcyB3aXRoIHRoZSBuZXcgcmVjb3JkICh7IG5hbWUgfSBvciB7IG5hbWUsIGFyZ3MgfSksIG9yXG4vLyBudWxsIG9uIGNhbmNlbCAtIGFsc28gd2hlbiBhIHNjcmlwdCB3YXMgcGlja2VkIGJ1dCBpdHMgYXJndW1lbnQgZGlhbG9nIHdhc1xuLy8gY2FuY2VsbGVkLlxuYXN5bmMgZnVuY3Rpb24gcGlja1Nob3J0Y3V0KGFwcCwga2V5LCBnZXRTY3JpcHRzLCBjdXJyZW50ID0gbnVsbCkge1xuICBjb25zdCBpdGVtcyA9IFtcbiAgICAuLi5GSVhFRF9TSE9SVENVVFMubWFwKCh7IG5hbWUsIGRlc2NyaXB0aW9uIH0pID0+ICh7IG5hbWUsIGRlc2NyaXB0aW9uLCBwYXJhbXM6IG51bGwgfSkpLFxuICAgIC4uLmdldFNjcmlwdHMoKS5tYXAoKHsgbmFtZSwgcGFyYW1zLCBkZXNjcmlwdGlvbiB9KSA9PiAoeyBuYW1lOiBTQ1JJUFRfUFJFRklYICsgbmFtZSwgcGFyYW1zLCBkZXNjcmlwdGlvbiB9KSksXG4gIF07XG5cbiAgY29uc3QgaXRlbSA9IGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBuZXcgU2hvcnRjdXRQaWNrZXJNb2RhbChhcHAsIGtleSwgaXRlbXMsIHJlc29sdmUpLm9wZW4oKSk7XG4gIGlmICghaXRlbSkgcmV0dXJuIG51bGw7XG4gIC8vIE5vIGZpZWxkcyB0byBhc2sgZm9yIChmaXhlZCB0b2tlbnMsIG9yIG9ubHkgcmVzZXJ2ZWQgbmFtZXMgbGlrZVxuICAvLyBcIihuZXdGaWxlKVwiKTogbm8gc2Vjb25kIHN0ZXAuXG4gIGlmIChpbnB1dFBhcmFtcyhpdGVtLnBhcmFtcykubGVuZ3RoID09PSAwKSByZXR1cm4geyBuYW1lOiBpdGVtLm5hbWUgfTtcblxuICAvLyBQcmVmaWxsIG9ubHkgZm9yIHRoZSBzYW1lIHNjcmlwdDsgb2xkIHZhbHVlcyBtZWFuIG5vdGhpbmcgdG8gYW5vdGhlciBvbmUuXG4gIGNvbnN0IHByZWZpbGwgPSBjdXJyZW50Py5uYW1lID09PSBpdGVtLm5hbWUgPyBjdXJyZW50LmFyZ3MgOiBudWxsO1xuICBjb25zdCBhcmdzID0gYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IG5ldyBTaG9ydGN1dEFyZ3NNb2RhbChhcHAsIGl0ZW0sIHByZWZpbGwsIHJlc29sdmUpLm9wZW4oKSk7XG4gIGlmIChhcmdzID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIE9iamVjdC5rZXlzKGFyZ3MpLmxlbmd0aCA+IDAgPyB7IG5hbWU6IGl0ZW0ubmFtZSwgYXJncyB9IDogeyBuYW1lOiBpdGVtLm5hbWUgfTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHBpY2tTaG9ydGN1dCB9O1xuIiwgImNvbnN0IHsgTWFya2Rvd25WaWV3LCBNZW51LCBXb3Jrc3BhY2VMZWFmLCBzZXRJY29uIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IHNob3J0Y3V0TGFiZWwgfSA9IHJlcXVpcmUoXCIuL3Nob3J0Y3V0c1wiKTtcbmNvbnN0IHsgcGlja1Nob3J0Y3V0IH0gPSByZXF1aXJlKFwiLi9zaG9ydGN1dC1waWNrZXJcIik7XG5jb25zdCB7IGdldFN1YnR5cCwgZW5zdXJlU3VidHlwIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBzXCIpO1xuY29uc3QgeyBUWVBfUFJPUEVSVFksIFNVQlRZUF9QUk9QRVJUWSB9ID0gcmVxdWlyZShcIi4vdHlwLWluZGV4XCIpO1xuY29uc3QgeyBzbmFwc2hvdFNldHRpbmdzLCBvZmZlclVuZG8gfSA9IHJlcXVpcmUoXCIuL3VuZG9cIik7XG5cbi8vIE1hcmtzIHRoZSBUWVAtRnJvbnRtYXR0ZXIgZWRpdG9yJ3MgY29udGFpbmVyIHNvIHRoZSBzaG9ydGN1dCBydWxlcyBpblxuLy8gc3R5bGVzLmNzcyBhcHBseSBvbmx5IGhlcmUsIG5ldmVyIGluIHJlYWwgbm90ZXMuXG5jb25zdCBFRElUT1JfQ0xBU1MgPSBcInR5cC1mcm9udG1hdHRlci1lZGl0b3JcIjtcblxuY29uc3QgU1lTVEVNX1BST1BFUlRJRVMgPSBbVFlQX1BST1BFUlRZLnRvTG93ZXJDYXNlKCksIFNVQlRZUF9QUk9QRVJUWS50b0xvd2VyQ2FzZSgpXTtcblxuLy8gVGhlIHZhbHVlIG9mIFRZUC9TVUJUWVAgaXMgYnkgZGVmaW5pdGlvbiB0aGUgVFlQIG9yIFN1YnR5cCBuYW1lIGl0c2VsZjsgYXNcbi8vIGEgc3RhbmRhcmQgcHJvcGVydHkgaXQgd291bGQgYmUgcmVkdW5kYW50IGFuZCBjb3VsZCBzaWxlbnRseSBkcmlmdCBmcm9tIHRoZVxuLy8gcmVhbCBuYW1lIGFmdGVyIGEgcmVuYW1lLCBzbyBpdCBuZXZlciBhcHBlYXJzIGFzIGEgcm93IGhlcmUuXG4vLyBNdXRhdGVzIGluIHBsYWNlIGluc3RlYWQgb2YgcmV0dXJuaW5nIGEgY29weTogT2JzaWRpYW4ncyBwcm9wZXJ0eSBlZGl0b3Jcbi8vIHNlZW1zIHRvIHJlbHkgb24gYSBzdGFibGUgb2JqZWN0IHJlZmVyZW5jZSBpbiBzeW5jaHJvbml6ZSgpOyBhIGZyZXNoIGNvcHlcbi8vIGNhdXNlZCBhIHN0YWNrIG92ZXJmbG93IGluIGl0cyByZW5kZXJQcm9wZXJ0eSgpIHBpcGVsaW5lIG9uIGZpcnN0IHJlbmRlci5cbmZ1bmN0aW9uIHN0cmlwVHlwUHJvcGVydHkoZnJvbnRtYXR0ZXIpIHtcbiAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoZnJvbnRtYXR0ZXIpKSB7XG4gICAgaWYgKFNZU1RFTV9QUk9QRVJUSUVTLmluY2x1ZGVzKGtleS50cmltKCkudG9Mb3dlckNhc2UoKSkpIGRlbGV0ZSBmcm9udG1hdHRlcltrZXldO1xuICB9XG4gIHJldHVybiBmcm9udG1hdHRlcjtcbn1cblxuLy8gV2hlcmUgYSBmcm9udG1hdHRlciBibG9jayBsaXZlcyBpbiB0aGUgc2V0dGluZ3M6IGEgVFlQJ3MgVFlQLUZyb250bWF0dGVyXG4vLyAodHlwRGVmYXVsdEZyb250bWF0dGVyL3R5cEZsb2F0aW5nS2V5cy90eXBTaG9ydGN1dHMpIG9yIG9uZSBvZiBpdHMgU3VidHlwXG4vLyBibG9ja3MgKHR5cFN1YnR5cHMsIHNlZSBzdWJ0eXBzLmpzKS4gRWRpdG9yLCBmbG9hdGluZyBtZW51LCBzaG9ydGN1dCBidXR0b25cbi8vIGFuZCBwcm9wZXJ0eSByZW5hbWUgb25seSB1c2UgdGhpcyBpbnRlcmZhY2UgYW5kIG5lZWRuJ3Qga25vdyB3aGljaC5cbi8vXG4vLyBnZXRTaG9ydGN1dHMvc2V0U2hvcnRjdXRzIGhvbGQgdGhlIHNob3J0Y3V0IHJlY29yZHMgcGVyIGtleSAoc2VlXG4vLyBzaG9ydGN1dHMuanMpIC0gbmV4dCB0byB0aGUgZnJvbnRtYXR0ZXIsIG5vdCBpbiBpdCwgc28gdGhlIHZhbHVlIHN0YXlzXG4vLyB0eXBlLWNsZWFuLiBXaXRoIGEgc2hvcnRjdXQgc2V0LCB0aGUgdmFsdWUgcmVtYWlucyBhcyBmYWxsYmFjay5cbmZ1bmN0aW9uIHR5cFN0b3JlKHBsdWdpbiwgdHlwKSB7XG4gIHJldHVybiB7XG4gICAgdHlwLFxuICAgIHN1YnR5cDogbnVsbCxcbiAgICBnZXRGcm9udG1hdHRlcjogKCkgPT4gcGx1Z2luLnNldHRpbmdzLnR5cERlZmF1bHRGcm9udG1hdHRlclt0eXBdID8/IHt9LFxuICAgIHNldEZyb250bWF0dGVyOiAoZnJvbnRtYXR0ZXIpID0+IHtcbiAgICAgIHBsdWdpbi5zZXR0aW5ncy50eXBEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwXSA9IGZyb250bWF0dGVyO1xuICAgIH0sXG4gICAgZ2V0RmxvYXRpbmc6ICgpID0+IHBsdWdpbi5zZXR0aW5ncy50eXBGbG9hdGluZ0tleXNbdHlwXSA/PyBbXSxcbiAgICBzZXRGbG9hdGluZzogKGtleXMpID0+IHtcbiAgICAgIGlmIChrZXlzLmxlbmd0aCA+IDApIHBsdWdpbi5zZXR0aW5ncy50eXBGbG9hdGluZ0tleXNbdHlwXSA9IGtleXM7XG4gICAgICBlbHNlIGRlbGV0ZSBwbHVnaW4uc2V0dGluZ3MudHlwRmxvYXRpbmdLZXlzW3R5cF07XG4gICAgfSxcbiAgICBnZXRTaG9ydGN1dHM6ICgpID0+IHBsdWdpbi5zZXR0aW5ncy50eXBTaG9ydGN1dHNbdHlwXSA/PyB7fSxcbiAgICBzZXRTaG9ydGN1dHM6IChzaG9ydGN1dHMpID0+IHtcbiAgICAgIGlmIChPYmplY3Qua2V5cyhzaG9ydGN1dHMpLmxlbmd0aCA+IDApIHBsdWdpbi5zZXR0aW5ncy50eXBTaG9ydGN1dHNbdHlwXSA9IHNob3J0Y3V0cztcbiAgICAgIGVsc2UgZGVsZXRlIHBsdWdpbi5zZXR0aW5ncy50eXBTaG9ydGN1dHNbdHlwXTtcbiAgICB9LFxuICB9O1xufVxuXG5mdW5jdGlvbiBzdWJ0eXBTdG9yZShwbHVnaW4sIHR5cCwgc3VidHlwKSB7XG4gIHJldHVybiB7XG4gICAgdHlwLFxuICAgIHN1YnR5cCxcbiAgICBnZXRGcm9udG1hdHRlcjogKCkgPT4gZ2V0U3VidHlwKHBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApPy5mcm9udG1hdHRlciA/PyB7fSxcbiAgICBzZXRGcm9udG1hdHRlcjogKGZyb250bWF0dGVyKSA9PiB7XG4gICAgICBlbnN1cmVTdWJ0eXAocGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCkuZnJvbnRtYXR0ZXIgPSBmcm9udG1hdHRlcjtcbiAgICB9LFxuICAgIGdldEZsb2F0aW5nOiAoKSA9PiBnZXRTdWJ0eXAocGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCk/LmZsb2F0aW5nS2V5cyA/PyBbXSxcbiAgICBzZXRGbG9hdGluZzogKGtleXMpID0+IHtcbiAgICAgIGVuc3VyZVN1YnR5cChwbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKS5mbG9hdGluZ0tleXMgPSBrZXlzO1xuICAgIH0sXG4gICAgZ2V0U2hvcnRjdXRzOiAoKSA9PiBnZXRTdWJ0eXAocGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCk/LnNob3J0Y3V0cyA/PyB7fSxcbiAgICBzZXRTaG9ydGN1dHM6IChzaG9ydGN1dHMpID0+IHtcbiAgICAgIGVuc3VyZVN1YnR5cChwbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKS5zaG9ydGN1dHMgPSBzaG9ydGN1dHM7XG4gICAgfSxcbiAgfTtcbn1cblxuLy8gT2JzaWRpYW4ncyBwcm9wZXJ0aWVzIHdpZGdldCBpcyBubyBvZmZpY2lhbCBBUEkuIEludGVybmFsbHkgaXQgaXMgYVxuLy8gY29tcG9uZW50IGNsYXNzIChtaW5pZmllZCBcIk1ldGFkYXRhRWRpdG9yXCIpIHRoYXQgZXZlcnkgTWFya2Rvd25WaWV3IGFuZCB0aGVcbi8vIGZpbGUgcHJvcGVydGllcyBwYW5lIGluc3RhbnRpYXRlIGFzIHZpZXcubWV0YWRhdGFFZGl0b3IuIEl0IGlzbid0IGV4cG9ydGVkLFxuLy8gYnV0IGFueSBpbnN0YW5jZSByZWFjaGVzIGl0IHZpYSAuY29uc3RydWN0b3IsIGFuZCBpdCBpcyBzdGFibGUgZm9yIHRoZVxuLy8gc2Vzc2lvbiAtIGdyYWJiaW5nIGl0IG9uY2UgaXMgZW5vdWdoLlxubGV0IGNhY2hlZEVkaXRvckNsYXNzID0gbnVsbDtcblxuZnVuY3Rpb24gZ2V0TWV0YWRhdGFFZGl0b3JDbGFzcyhhcHApIHtcbiAgaWYgKGNhY2hlZEVkaXRvckNsYXNzKSByZXR1cm4gY2FjaGVkRWRpdG9yQ2xhc3M7XG5cbiAgY29uc3QgYWN0aXZlID0gYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gIGlmIChhY3RpdmU/Lm1ldGFkYXRhRWRpdG9yKSB7XG4gICAgY2FjaGVkRWRpdG9yQ2xhc3MgPSBhY3RpdmUubWV0YWRhdGFFZGl0b3IuY29uc3RydWN0b3I7XG4gICAgcmV0dXJuIGNhY2hlZEVkaXRvckNsYXNzO1xuICB9XG4gIGZvciAoY29uc3QgbGVhZiBvZiBhcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpKSB7XG4gICAgaWYgKGxlYWYudmlldz8ubWV0YWRhdGFFZGl0b3IpIHtcbiAgICAgIGNhY2hlZEVkaXRvckNsYXNzID0gbGVhZi52aWV3Lm1ldGFkYXRhRWRpdG9yLmNvbnN0cnVjdG9yO1xuICAgICAgcmV0dXJuIGNhY2hlZEVkaXRvckNsYXNzO1xuICAgIH1cbiAgfVxuICBjYWNoZWRFZGl0b3JDbGFzcyA9IGhhcnZlc3RFZGl0b3JDbGFzcyhhcHApO1xuICByZXR1cm4gY2FjaGVkRWRpdG9yQ2xhc3M7XG59XG5cbi8vIEJlZm9yZSBhbnkgbm90ZSB3YXMgb3BlbiB0aGlzIHNlc3Npb24gdGhlcmUgaXMgbm8gaW5zdGFuY2UgdG8gcmVhY2ggdGhlXG4vLyBjbGFzcyB0aHJvdWdoLiBUaGVuIHdlIGJ1aWxkIG9uZTogYSBmcmVlIFdvcmtzcGFjZUxlYWYgKG5vIHBhcmVudCwgbmV2ZXIgaW5cbi8vIHRoZSBET00pIHdpdGggYSBNYXJrZG93blZpZXcgZnJvbSBPYnNpZGlhbidzIHZpZXcgcmVnaXN0cnksIHdob3NlXG4vLyBjb25zdHJ1Y3RvciBjcmVhdGVzIG1ldGFkYXRhRWRpdG9yLiBPbmx5IHRoZSBjbGFzcyBpcyBuZWVkZWQ7IHRoZSB2aWV3IGlzXG4vLyB1bmxvYWRlZCByaWdodCBhd2F5LiBEZWxpYmVyYXRlbHkgTk9UIGxlYWYuZGV0YWNoKCk6IHRoYXQgZXhwZWN0cyBhIHBhcmVudFxuLy8gdGhpcyBsZWFmIG5ldmVyIGhhZC5cbmZ1bmN0aW9uIGhhcnZlc3RFZGl0b3JDbGFzcyhhcHApIHtcbiAgbGV0IHZpZXcgPSBudWxsO1xuICB0cnkge1xuICAgIGNvbnN0IGNyZWF0ZVZpZXcgPSBhcHAudmlld1JlZ2lzdHJ5Py5nZXRWaWV3Q3JlYXRvckJ5VHlwZT8uKFwibWFya2Rvd25cIik7XG4gICAgaWYgKCFjcmVhdGVWaWV3KSByZXR1cm4gbnVsbDtcbiAgICB2aWV3ID0gY3JlYXRlVmlldyhuZXcgV29ya3NwYWNlTGVhZihhcHApKTtcbiAgICByZXR1cm4gdmlldy5tZXRhZGF0YUVkaXRvcj8uY29uc3RydWN0b3IgPz8gbnVsbDtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKFwiW3R5cC1zeXN0ZW1dIGNvdWxkbid0IGZpbmQgdGhlIE1ldGFkYXRhRWRpdG9yIGNsYXNzXCIsIGVycm9yKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfSBmaW5hbGx5IHtcbiAgICB0cnkge1xuICAgICAgdmlldz8udW5sb2FkKCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJbdHlwLXN5c3RlbV0gY291bGRuJ3QgZGlzY2FyZCB0aGUgaGVscGVyIE1hcmtkb3duVmlld1wiLCBlcnJvcik7XG4gICAgfVxuICB9XG59XG5cbi8vIExpa2UgZ2V0TWV0YWRhdGFFZGl0b3JDbGFzczogdGhlIHByaXZhdGUgcHJvcGVydHkgcm93IGNsYXNzLCB0YWtlbiBmcm9tIGFuXG4vLyBhbHJlYWR5IHJlbmRlcmVkIHJvdy4gT25seSBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaCgpIG5lZWRzIGl0LCBhbmQgYGVkaXRvcmBcbi8vIHVzdWFsbHkgaGFzIGEgcm93IGJ5IHRoZW4sIHNvIGl0IGlzIHRyaWVkIGZpcnN0LlxubGV0IGNhY2hlZFByb3BlcnR5Um93Q2xhc3MgPSBudWxsO1xuXG5mdW5jdGlvbiBnZXRQcm9wZXJ0eVJvd0NsYXNzKGFwcCwgZWRpdG9yKSB7XG4gIGlmIChjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzKSByZXR1cm4gY2FjaGVkUHJvcGVydHlSb3dDbGFzcztcbiAgaWYgKGVkaXRvcj8ucmVuZGVyZWQ/LlswXSkge1xuICAgIGNhY2hlZFByb3BlcnR5Um93Q2xhc3MgPSBlZGl0b3IucmVuZGVyZWRbMF0uY29uc3RydWN0b3I7XG4gICAgcmV0dXJuIGNhY2hlZFByb3BlcnR5Um93Q2xhc3M7XG4gIH1cbiAgY29uc3QgYWN0aXZlID0gYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gIGlmIChhY3RpdmU/Lm1ldGFkYXRhRWRpdG9yPy5yZW5kZXJlZD8uWzBdKSB7XG4gICAgY2FjaGVkUHJvcGVydHlSb3dDbGFzcyA9IGFjdGl2ZS5tZXRhZGF0YUVkaXRvci5yZW5kZXJlZFswXS5jb25zdHJ1Y3RvcjtcbiAgICByZXR1cm4gY2FjaGVkUHJvcGVydHlSb3dDbGFzcztcbiAgfVxuICBmb3IgKGNvbnN0IGxlYWYgb2YgYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xuICAgIGlmIChsZWFmLnZpZXc/Lm1ldGFkYXRhRWRpdG9yPy5yZW5kZXJlZD8uWzBdKSB7XG4gICAgICBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzID0gbGVhZi52aWV3Lm1ldGFkYXRhRWRpdG9yLnJlbmRlcmVkWzBdLmNvbnN0cnVjdG9yO1xuICAgICAgcmV0dXJuIGNhY2hlZFByb3BlcnR5Um93Q2xhc3M7XG4gICAgfVxuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vLyBBZGRzIGEgXCJGbG9hdGluZ1wiIHRvZ2dsZSBhdCB0aGUgdmVyeSB0b3Agb2YgYSBwcm9wZXJ0eSByb3cncyBjb250ZXh0IG1lbnUgLVxuLy8gb25seSBmb3Igcm93cyBvZiB0aGUgcGx1Z2luJ3Mgb3duIFRZUC1QYW5lIChyZWNvZ25pemVkIGJ5IG93bmVyLnR5cFN0b3JlKSxcbi8vIG5ldmVyIGluIHJlYWwgbm90ZXMuIFVubGlrZSB0aGUgZXh0cmEgXCIrXCIgYnV0dG9uICh0eXBQZW5kaW5nRmxvYXRpbmdBZGQpLFxuLy8gd2hpY2ggb25seSBhZmZlY3RzIGEgTkVXIHByb3BlcnR5LCB0aGlzIHdvcmtzIG9uIGFueSBleGlzdGluZyBvbmUsIGJvdGggd2F5cy5cbi8vXG4vLyBUaGUgcHJvcGVydHkgbWVudSBpcyBubyBvZmZpY2lhbCBleHRlbnNpb24gcG9pbnQ6IG9uIGRlc2t0b3AgaXQgYnVpbGRzIGFcbi8vIE5BVElWRSBFbGVjdHJvbiBtZW51IGZyb20gYW4gaW50ZXJuYWwgTWVudSBhbmQgc2hvd3MgaXQgd2l0aGluXG4vLyBzaG93UHJvcGVydHlNZW51KCkgaW4gb25lIHN5bmNocm9ub3VzIGNhbGwgLSBubyB3b3Jrc3BhY2UgZXZlbnQsIG5vIERPTVxuLy8gcG9wdXAgdG8gYW1lbmQgYWZ0ZXJ3YXJkcy4gU28gdGhlIHByaXZhdGUgcm93IGNsYXNzIGlzIHBhdGNoZWQsIGFzIG5hcnJvd2x5XG4vLyBhcyBwb3NzaWJsZTogZm9yIG91ciByb3dzLCByaWdodCBiZWZvcmUgT2JzaWRpYW4gc2hvd3MgaXRzIGZpbmlzaGVkIG1lbnUsXG4vLyBvbmUgYWRkSXRlbSgpIGlzIHNsaXBwZWQgaW4gdGhyb3VnaCBhIHBhdGNoIG9uIE1lbnUucHJvdG90eXBlLnNob3dBdE1vdXNlRXZlbnRcbi8vIHRoYXQgcmVzZXRzIGl0c2VsZiBhZnRlciB0aGlzIG9uZSBjYWxsIChzYWZlLCBKUyBpcyBzaW5nbGUtdGhyZWFkZWQpLiBUaGVcbi8vIHJlc3Qgb2YgdGhlIG5hdGl2ZSBtZW51IHN0YXlzIHVudG91Y2hlZC5cbmxldCB1bmRvUHJvcGVydHlNZW51UGF0Y2ggPSBudWxsO1xuXG5mdW5jdGlvbiBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaChhcHAsIGVkaXRvcikge1xuICBjb25zdCBSb3dDbGFzcyA9IGdldFByb3BlcnR5Um93Q2xhc3MoYXBwLCBlZGl0b3IpO1xuICBpZiAoIVJvd0NsYXNzIHx8IFJvd0NsYXNzLl90eXBTeXN0ZW1NZW51UGF0Y2hlZCkgcmV0dXJuO1xuICBSb3dDbGFzcy5fdHlwU3lzdGVtTWVudVBhdGNoZWQgPSB0cnVlO1xuXG4gIGNvbnN0IG9yaWdpbmFsU2hvd1Byb3BlcnR5TWVudSA9IFJvd0NsYXNzLnByb3RvdHlwZS5zaG93UHJvcGVydHlNZW51O1xuICB1bmRvUHJvcGVydHlNZW51UGF0Y2ggPSAoKSA9PiB7XG4gICAgUm93Q2xhc3MucHJvdG90eXBlLnNob3dQcm9wZXJ0eU1lbnUgPSBvcmlnaW5hbFNob3dQcm9wZXJ0eU1lbnU7XG4gICAgZGVsZXRlIFJvd0NsYXNzLl90eXBTeXN0ZW1NZW51UGF0Y2hlZDtcbiAgfTtcbiAgUm93Q2xhc3MucHJvdG90eXBlLnNob3dQcm9wZXJ0eU1lbnUgPSBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICBjb25zdCBvd25lciA9IHRoaXMubWV0YWRhdGFFZGl0b3I/Lm93bmVyO1xuICAgIGlmICghb3duZXI/LnR5cFN0b3JlKSByZXR1cm4gb3JpZ2luYWxTaG93UHJvcGVydHlNZW51LmNhbGwodGhpcywgZXZlbnQpO1xuXG4gICAgY29uc3Qgcm93ID0gdGhpcztcbiAgICBjb25zdCBvcmlnaW5hbFNob3dBdE1vdXNlRXZlbnQgPSBNZW51LnByb3RvdHlwZS5zaG93QXRNb3VzZUV2ZW50O1xuICAgIE1lbnUucHJvdG90eXBlLnNob3dBdE1vdXNlRXZlbnQgPSBmdW5jdGlvbiAobW91c2VFdmVudCkge1xuICAgICAgTWVudS5wcm90b3R5cGUuc2hvd0F0TW91c2VFdmVudCA9IG9yaWdpbmFsU2hvd0F0TW91c2VFdmVudDtcbiAgICAgIGNvbnN0IGlzRmxvYXRpbmcgPSBvd25lci50eXBTdG9yZS5nZXRGbG9hdGluZygpLmluY2x1ZGVzKHJvdy5lbnRyeS5rZXkpO1xuICAgICAgLy8gXCJ0aXRsZVwiIGlzIHRoZSBmaXJzdCBzZWN0aW9uIHNob3dQcm9wZXJ0eU1lbnUgcmVnaXN0ZXJzIGFuZCBpcyBlbXB0eVxuICAgICAgLy8gb24gZGVza3RvcCwgc28gdGhpcyBsYW5kcyByZWxpYWJseSBvbiB0b3AuIFwicGluLW9mZlwiID0gbm90IHBpbm5lZCA9XG4gICAgICAvLyBmbG9hdGluZy5cbiAgICAgIHRoaXMuYWRkSXRlbSgoaXRlbSkgPT5cbiAgICAgICAgaXRlbVxuICAgICAgICAgIC5zZXRUaXRsZShcIkZsb2F0aW5nXCIpXG4gICAgICAgICAgLnNldEljb24oXCJwaW4tb2ZmXCIpXG4gICAgICAgICAgLnNldENoZWNrZWQoaXNGbG9hdGluZylcbiAgICAgICAgICAuc2V0U2VjdGlvbihcInRpdGxlXCIpXG4gICAgICAgICAgLm9uQ2xpY2soKCkgPT4gdG9nZ2xlRmxvYXRpbmdQcm9wZXJ0eShvd25lci50eXBQYW5lLCBvd25lci50eXBTdG9yZSwgcm93LmVudHJ5LmtleSkpXG4gICAgICApO1xuICAgICAgcmV0dXJuIG9yaWdpbmFsU2hvd0F0TW91c2VFdmVudC5jYWxsKHRoaXMsIG1vdXNlRXZlbnQpO1xuICAgIH07XG5cbiAgICByZXR1cm4gb3JpZ2luYWxTaG93UHJvcGVydHlNZW51LmNhbGwodGhpcywgZXZlbnQpO1xuICB9O1xufVxuXG4vLyBPbiB1bmxvYWQ7IG90aGVyd2lzZSB0aGUgcGF0Y2ggd291bGQgb3V0bGl2ZSBhIGhvdCByZWxvYWQgd2l0aCB0aGUgb2xkXG4vLyBtb2R1bGUncyBjbG9zdXJlcy5cbmZ1bmN0aW9uIHJlbW92ZVByb3BlcnR5TWVudVBhdGNoKCkge1xuICB1bmRvUHJvcGVydHlNZW51UGF0Y2g/LigpO1xuICB1bmRvUHJvcGVydHlNZW51UGF0Y2ggPSBudWxsO1xufVxuXG5mdW5jdGlvbiB0b2dnbGVGbG9hdGluZ1Byb3BlcnR5KHZpZXcsIHN0b3JlLCBrZXkpIHtcbiAgY29uc3QgZmxvYXRpbmcgPSBzdG9yZS5nZXRGbG9hdGluZygpO1xuICBzdG9yZS5zZXRGbG9hdGluZyhmbG9hdGluZy5pbmNsdWRlcyhrZXkpID8gZmxvYXRpbmcuZmlsdGVyKChrKSA9PiBrICE9PSBrZXkpIDogWy4uLmZsb2F0aW5nLCBrZXldKTtcbiAgdmlldy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gIC8vIFVwZGF0ZXMgdGhlIGJvbGQvaXRhbGljIG1hcmtzIGF0IG9uY2UsIGhlcmUgKHJlZnJlc2hGcm9udG1hdHRlckhpZ2hsaWdodFxuICAvLyBjb3ZlcnMgdGhlIFRZUC1QYW5lJ3Mgb3duIGVkaXRvcnMpIGFuZCBpbiBvcGVuIG5vdGVzIC0gd2l0aG91dFxuICAvLyByZS1yZW5kZXJpbmcgdGhpcyBUWVAtUGFuZSwgc2VlIHJlZnJlc2hUeXBDb2xvcnNFeGNlcHQgaW4gbWFpbi5qcy5cbiAgdmlldy5wbHVnaW4ucmVmcmVzaFR5cENvbG9yc0V4Y2VwdD8uKHZpZXcpO1xufVxuXG4vLyBLZXlib2FyZCBuYXZpZ2F0aW9uIGJleW9uZCBvbmUgZWRpdG9yIGluc3RhbmNlIChzZWUgZnJvbnRtYXR0ZXItYmxvY2tzLmpzKTpcbi8vIE9ic2lkaWFuIG1vdmVzIGZvY3VzIG9ubHkgd2l0aGluIGl0cyBvd24gcm93IGxpc3QsIGFuZCBhdCBlaXRoZXIgZW5kIG9udG9cbi8vIHRoZSBlZGl0b3IncyBoZWFkaW5nIG9yIFwiQWRkIHByb3BlcnR5XCIgYnV0dG9uIC0gYm90aCBoaWRkZW4gaGVyZSBieSBDU1MsIHNvXG4vLyB0aGUgY2hhaW4gc3RvcHBlZCBhdCB0aGUgYmxvY2sgZWRnZS5cbi8vXG4vLyBvd25lci5zaGlmdEZvY3VzQmVmb3JlL0FmdGVyIGFyZSBvbmx5IHJlYWNoZWQgdGhyb3VnaCBleGFjdGx5IHRob3NlIGhpZGRlblxuLy8gZWxlbWVudHMsIHNvIGluc3RlYWQgYSBjYXB0dXJlLXBoYXNlIGhhbmRsZXIgcnVucyBCRUZPUkUgdGhlIHJvdydzIG93bi4gSXRcbi8vIG9ubHkgYWN0cyB3aGlsZSB0aGUgcm93IElUU0VMRiBoYXMgZm9jdXMgKGV2ZW50LnRhcmdldCBpcyB0aGUgcm93J3Ncbi8vIGNvbnRhaW5lcikgLSB0aGUgc2FtZSBjb25kaXRpb24gdW5kZXIgd2hpY2ggT2JzaWRpYW4gYWxsb3dzIGovaywgc28gbmV2ZXJcbi8vIHdoaWxlIHR5cGluZyBpbiBhIGZpZWxkLlxuZnVuY3Rpb24gcmVnaXN0ZXJGb2N1c0NoYWluKGVkaXRvciwgb25TaGlmdEZvY3VzKSB7XG4gIGVkaXRvci5jb250YWluZXJFbC5hZGRFdmVudExpc3RlbmVyKFxuICAgIFwia2V5ZG93blwiLFxuICAgIChldmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmlzQ29tcG9zaW5nIHx8IGV2ZW50LmRlZmF1bHRQcmV2ZW50ZWQpIHJldHVybjtcbiAgICAgIC8vIE11bHRpLXNlbGVjdGlvbjogT2JzaWRpYW4gZXh0ZW5kcyB0aGUgc2VsZWN0aW9uIGluc3RlYWQgb2YgbW92aW5nLlxuICAgICAgaWYgKGVkaXRvci5zZWxlY3RlZExpbmVzPy5zaXplID4gMSkgcmV0dXJuO1xuICAgICAgaWYgKGV2ZW50LnNoaWZ0S2V5ICYmIChldmVudC5rZXkgPT09IFwiQXJyb3dVcFwiIHx8IGV2ZW50LmtleSA9PT0gXCJBcnJvd0Rvd25cIikpIHJldHVybjtcblxuICAgICAgY29uc3QgaW5kZXggPSBlZGl0b3IucmVuZGVyZWQuZmluZEluZGV4KChyb3cpID0+IHJvdy5jb250YWluZXJFbCA9PT0gZXZlbnQudGFyZ2V0KTtcbiAgICAgIGlmIChpbmRleCA9PT0gLTEpIHJldHVybjtcblxuICAgICAgY29uc3QgdXAgPSBldmVudC5rZXkgPT09IFwiQXJyb3dVcFwiIHx8IGV2ZW50LmtleSA9PT0gXCJrXCIgfHwgKGV2ZW50LmtleSA9PT0gXCJUYWJcIiAmJiBldmVudC5zaGlmdEtleSk7XG4gICAgICBjb25zdCBkb3duID0gZXZlbnQua2V5ID09PSBcIkFycm93RG93blwiIHx8IGV2ZW50LmtleSA9PT0gXCJqXCIgfHwgKGV2ZW50LmtleSA9PT0gXCJUYWJcIiAmJiAhZXZlbnQuc2hpZnRLZXkpO1xuICAgICAgbGV0IHN0ZXAgPSAwO1xuICAgICAgaWYgKHVwICYmIGluZGV4ID09PSAwKSBzdGVwID0gLTE7XG4gICAgICBlbHNlIGlmIChkb3duICYmIGluZGV4ID09PSBlZGl0b3IucmVuZGVyZWQubGVuZ3RoIC0gMSkgc3RlcCA9IDE7XG4gICAgICBpZiAoc3RlcCA9PT0gMCB8fCAhb25TaGlmdEZvY3VzKHN0ZXApKSByZXR1cm47XG5cbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICB9LFxuICAgIHRydWVcbiAgKTtcbn1cblxuLy8gVGhlIHdpZGdldCB0YWtlcyBhbiBcIm93bmVyXCIgYXMgc2Vjb25kIGNvbnN0cnVjdG9yIGFyZ3VtZW50IC0gdGhlIG9ubHkgdGhpbmdcbi8vIGJpbmRpbmcgaXQgdG8gYSBmaWxlLiBIZXJlIGl0IGlzIGJvdW5kIHRvIGEgcGxhaW4gb2JqZWN0IGluIHRoZSBzZXR0aW5nczpcbi8vIHNhdmVGcm9udG1hdHRlcihvYmopIGdldHMgdGhlIGZ1bGwgcHJvcGVydHkgc2V0IG9uIGV2ZXJ5IGNoYW5nZS5cbi8vIHNoaWZ0Rm9jdXNCZWZvcmUvQWZ0ZXIgbWF5IGJlIG5vLW9wcy4gZ2V0RmlsZSgpIGlzIGNhbGxlZCBieSBldmVyeSByb3cgd2hpbGVcbi8vIHJlbmRlcmluZyAoZm9yIHNvdXJjZVBhdGgpOyB0aGVyZSBpcyBubyByZWFsIGZpbGUsIGJ1dCB0aGUgbWV0aG9kIG11c3QgZXhpc3Rcbi8vIG9yIHRoZSB3aWRnZXQgY3Jhc2hlcy5cbi8vXG4vLyBPbmUgZWRpdG9yIHBlciBibG9jayAoVFlQIG9yIFN1YnR5cCksIGJvdW5kIHRvIGBzdG9yZWAuIFN0YW5kYXJkIGFuZFxuLy8gZmxvYXRpbmcgcHJvcGVydGllcyBzaGFyZSBvbmUgbGlzdCBhbmQgb3JkZXI7IGdldFR5cERlZmF1bHRzKCkganVzdCBsZWF2ZXNcbi8vIHRoZSBmbG9hdGluZyBvbmVzIG91dC4gZWRpdG9yLnR5cFBlbmRpbmdGbG9hdGluZ0FkZCwgc2V0IGJlZm9yZVxuLy8gYWRkQmxhbmtQcm9wZXJ0eSgpLCBtYXJrcyB0aGUgbmV4dCBhZGRlZCAob3IgcmVuYW1lZCkgcHJvcGVydHkgYXMgZmxvYXRpbmcgLVxuLy8gc2VlIHNhdmVGcm9udG1hdHRlci5cbmZ1bmN0aW9uIG1vdW50RnJvbnRtYXR0ZXJFZGl0b3IodmlldywgY29udGFpbmVyRWwsIHN0b3JlLCB7IG9uU2hpZnRGb2N1cyB9ID0ge30pIHtcbiAgY29uc3QgYXBwID0gdmlldy5hcHA7XG4gIGNvbnN0IEVkaXRvckNsYXNzID0gZ2V0TWV0YWRhdGFFZGl0b3JDbGFzcyhhcHApO1xuICBpZiAoIUVkaXRvckNsYXNzKSB7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgIGNsczogXCJ0eXAtZnJvbnRtYXR0ZXItdW5hdmFpbGFibGVcIixcbiAgICAgIHRleHQ6IFwiWnVtIEluaXRpYWxpc2llcmVuIGRlcyBFZGl0b3JzIGJpdHRlIHp1ZXJzdCBlaW5tYWwgZWluZSBOb3RpeiBcdTAwRjZmZm5lbi5cIixcbiAgICB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IG93bmVyID0ge1xuICAgIGFwcCxcbiAgICAvLyBMZXRzIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoKCkgcmVjb2duaXplIHJvd3Mgb2YgdGhpcyBlZGl0b3IgYW5kIGdpdmVzXG4gICAgLy8gdGhlIGdsb2JhbCBtZW51IHBhdGNoIHRoZSBzdG9yZSBhbmQgdmlldyBwZXIgcm93ICh0aGUgcGF0Y2ggaXRzZWxmIGlzXG4gICAgLy8gaW5zdGFsbGVkIG9ubHkgb25jZSkuXG4gICAgdHlwU3RvcmU6IHN0b3JlLFxuICAgIHR5cFBhbmU6IHZpZXcsXG4gICAgZ2V0RmlsZSgpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH0sXG4gICAgLy8gT25seSBmb3IgT2JzaWRpYW4ncyBob3ZlciBwcmV2aWV3IG9mIGludGVybmFsIGxpbmtzIGluIGEgdmFsdWU7IGFueVxuICAgIC8vIHN0cmluZyB3aWxsIGRvLlxuICAgIGdldEhvdmVyU291cmNlKCkge1xuICAgICAgcmV0dXJuIFwidHlwLWZyb250bWF0dGVyXCI7XG4gICAgfSxcbiAgICBzaGlmdEZvY3VzQmVmb3JlKCkge30sXG4gICAgc2hpZnRGb2N1c0FmdGVyKCkge30sXG4gICAgLy8gQ2FsbGVkIG9uY2UgcGVyIGNvbXBsZXRlZCBjaGFuZ2UgKGEgcmVuYW1lIG9ubHkgb24gYmx1ciBvZiB0aGUga2V5XG4gICAgLy8gaW5wdXQpLCBzbyBlYWNoIGNhbGwgYWRkcyBhbmQvb3IgcmVtb3ZlcyBhdCBtb3N0IG9uZSBub24tZW1wdHkgcHJvcGVydHksXG4gICAgLy8gZXhjZXB0IGEgbXVsdGktZGVsZXRlLiBUaGF0IGtlZXBzIHRoZSBmbG9hdGluZyBmbGFnIGVhc3kgdG8gdHJhY2tcbiAgICAvLyB3aXRob3V0IGZvbGxvd2luZyBpbnRlcm1lZGlhdGUgdHlwaW5nIHN0YXRlcy5cbiAgICBzYXZlRnJvbnRtYXR0ZXIoZnJvbnRtYXR0ZXIpIHtcbiAgICAgIC8vIEEgcm93IGp1c3QgbmFtZWQgXCJUWVBcIi9cIlNVQlRZUFwiIGlzbid0IHNhdmVkLiBJdCBzdGF5cyB2aXNpYmxlIHVudGlsXG4gICAgICAvLyB0aGUgbmV4dCBtb3VudCAobm8gc3luY2hyb25pemUoKSBoZXJlLCBzZWUgc3RyaXBUeXBQcm9wZXJ0eSkuXG4gICAgICBzdHJpcFR5cFByb3BlcnR5KGZyb250bWF0dGVyKTtcblxuICAgICAgY29uc3QgcHJldmlvdXMgPSBzdG9yZS5nZXRGcm9udG1hdHRlcigpO1xuICAgICAgY29uc3QgcHJldmlvdXNLZXlzID0gT2JqZWN0LmtleXMocHJldmlvdXMpLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwiXCIpO1xuICAgICAgY29uc3QgY3VycmVudEtleXMgPSBPYmplY3Qua2V5cyhmcm9udG1hdHRlcikuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gXCJcIik7XG4gICAgICBjb25zdCByZW1vdmVkS2V5cyA9IHByZXZpb3VzS2V5cy5maWx0ZXIoKGtleSkgPT4gIWN1cnJlbnRLZXlzLmluY2x1ZGVzKGtleSkpO1xuICAgICAgY29uc3QgYWRkZWRLZXlzID0gY3VycmVudEtleXMuZmlsdGVyKChrZXkpID0+ICFwcmV2aW91c0tleXMuaW5jbHVkZXMoa2V5KSk7XG4gICAgICAvLyBEZWxldGluZyByb3dzIGxvc2VzIHZhbHVlLCBzaG9ydGN1dCBhbmQgZmxvYXRpbmcgZmxhZyBhdCBvbmNlIC0gdGhlXG4gICAgICAvLyBvbmUgY2hhbmdlIGhlcmUgdGhhdCBnZXRzIGFuIHVuZG8gKHNlZSB1bmRvLmpzKS4gU25hcHNob3QgYmVmb3JlIGFueVxuICAgICAgLy8gc3RvcmUgd3JpdGUsIGFuZCBvbmx5IGZvciBhIGRlbGV0aW9uIC0gbm8gZnVsbCBjb3B5IG9uIGV2ZXJ5IGVkaXQuXG4gICAgICBjb25zdCByZW1vdmVkT25seSA9IHJlbW92ZWRLZXlzLmxlbmd0aCA+IDAgJiYgYWRkZWRLZXlzLmxlbmd0aCA9PT0gMDtcbiAgICAgIGNvbnN0IHVuZG9TbmFwc2hvdCA9IHJlbW92ZWRPbmx5ID8gc25hcHNob3RTZXR0aW5ncyh2aWV3LnBsdWdpbikgOiBudWxsO1xuXG4gICAgICBsZXQgZmxvYXRpbmcgPSBzdG9yZS5nZXRGbG9hdGluZygpO1xuICAgICAgaWYgKHJlbW92ZWRLZXlzLmxlbmd0aCA9PT0gMSAmJiBhZGRlZEtleXMubGVuZ3RoID09PSAxKSB7XG4gICAgICAgIC8vIEEgcmVuYW1lOiB0aGUgZmxvYXRpbmcgZmxhZyBtb3ZlcyBhbG9uZy5cbiAgICAgICAgZmxvYXRpbmcgPSBmbG9hdGluZy5tYXAoKGtleSkgPT4gKGtleSA9PT0gcmVtb3ZlZEtleXNbMF0gPyBhZGRlZEtleXNbMF0gOiBrZXkpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChyZW1vdmVkS2V5cy5sZW5ndGggPiAwKSBmbG9hdGluZyA9IGZsb2F0aW5nLmZpbHRlcigoa2V5KSA9PiAhcmVtb3ZlZEtleXMuaW5jbHVkZXMoa2V5KSk7XG4gICAgICAgIGlmIChlZGl0b3IudHlwUGVuZGluZ0Zsb2F0aW5nQWRkICYmIGFkZGVkS2V5cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgICBmbG9hdGluZyA9IFsuLi5mbG9hdGluZywgYWRkZWRLZXlzWzBdXTtcbiAgICAgICAgICBlZGl0b3IudHlwUGVuZGluZ0Zsb2F0aW5nQWRkID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIFNob3J0Y3V0cyBiZWxvbmcgdG8gdGhlIGtleSB0b286IHRoZXkgbW92ZSBvbiByZW5hbWUgYW5kIGdvIG9uIGRlbGV0ZS5cbiAgICAgIGNvbnN0IHNob3J0Y3V0cyA9IHsgLi4uc3RvcmUuZ2V0U2hvcnRjdXRzKCkgfTtcbiAgICAgIGlmIChyZW1vdmVkS2V5cy5sZW5ndGggPT09IDEgJiYgYWRkZWRLZXlzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICBpZiAoc2hvcnRjdXRzW3JlbW92ZWRLZXlzWzBdXSkge1xuICAgICAgICAgIHNob3J0Y3V0c1thZGRlZEtleXNbMF1dID0gc2hvcnRjdXRzW3JlbW92ZWRLZXlzWzBdXTtcbiAgICAgICAgICBkZWxldGUgc2hvcnRjdXRzW3JlbW92ZWRLZXlzWzBdXTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZm9yIChjb25zdCBrZXkgb2YgcmVtb3ZlZEtleXMpIGRlbGV0ZSBzaG9ydGN1dHNba2V5XTtcbiAgICAgIH1cblxuICAgICAgc3RvcmUuc2V0RnJvbnRtYXR0ZXIoZnJvbnRtYXR0ZXIpO1xuICAgICAgc3RvcmUuc2V0RmxvYXRpbmcoZmxvYXRpbmcpO1xuICAgICAgc3RvcmUuc2V0U2hvcnRjdXRzKHNob3J0Y3V0cyk7XG4gICAgICB2aWV3LnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgIGlmICh1bmRvU25hcHNob3QpIHtcbiAgICAgICAgY29uc3QgYmxvY2tOYW1lID0gc3RvcmUuc3VidHlwID8/IHN0b3JlLnR5cDtcbiAgICAgICAgb2ZmZXJVbmRvKFxuICAgICAgICAgIHZpZXcucGx1Z2luLFxuICAgICAgICAgIHJlbW92ZWRLZXlzLmxlbmd0aCA9PT0gMVxuICAgICAgICAgICAgPyBgUHJvcGVydHkgXCIke3JlbW92ZWRLZXlzWzBdfVwiIHJlbW92ZWQgZnJvbSAke2Jsb2NrTmFtZX0uYFxuICAgICAgICAgICAgOiBgJHtyZW1vdmVkS2V5cy5sZW5ndGh9IHByb3BlcnRpZXMgcmVtb3ZlZCBmcm9tICR7YmxvY2tOYW1lfS5gLFxuICAgICAgICAgIHVuZG9TbmFwc2hvdFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgLy8gQSBuZXdseSBuYW1lZCByb3cgZ2V0cyBpdHMgYnV0dG9uLCBhIGRlbGV0ZWQgb25lIHRha2VzIGl0IGFsb25nLlxuICAgICAgcmVuZGVyU2hvcnRjdXRDb250cm9scyh2aWV3LCBlZGl0b3IsIHN0b3JlKTtcbiAgICAgIC8vIEJvbGQvaXRhbGljIG1hcmtzIGluIG9wZW4gbm90ZXMgZm9sbG93IHRoZSBjaGFuZ2VkIGxpc3QgYXQgb25jZS4gTm90XG4gICAgICAvLyB0aGUgZnVsbCByZWZyZXNoVHlwQ29sb3JzKCk6IGl0IHdvdWxkIHJlLXJlbmRlciB0aGlzIFRZUC1QYW5lLCBhbmRcbiAgICAgIC8vIHRoZSBlZGl0IHRoYXQgY2FsbGVkIHNhdmVGcm9udG1hdHRlciB3b3VsZCBsb3NlIGl0cyBmb2N1cyAoVGFiIHRvIHRoZVxuICAgICAgLy8gbmV4dCByb3cgd2VudCBub3doZXJlKSAtIHRoZSBlZGl0b3IgYWxyZWFkeSBzaG93cyB0aGUgY2hhbmdlLlxuICAgICAgdmlldy5wbHVnaW4ucmVmcmVzaFR5cENvbG9yc0V4Y2VwdD8uKHZpZXcpO1xuICAgIH0sXG4gIH07XG5cbiAgY29uc3QgZWRpdG9yID0gbmV3IEVkaXRvckNsYXNzKGFwcCwgb3duZXIpO1xuICBlZGl0b3IudHlwUGVuZGluZ0Zsb2F0aW5nQWRkID0gZmFsc2U7XG4gIGlmIChvblNoaWZ0Rm9jdXMpIHJlZ2lzdGVyRm9jdXNDaGFpbihlZGl0b3IsIG9uU2hpZnRGb2N1cyk7XG4gIGVkaXRvci5jb250YWluZXJFbC5hZGRDbGFzcyhFRElUT1JfQ0xBU1MpO1xuICBjb250YWluZXJFbC5hcHBlbmRDaGlsZChlZGl0b3IuY29udGFpbmVyRWwpO1xuICB2aWV3LmFkZENoaWxkKGVkaXRvcik7XG5cbiAgZWRpdG9yLnN5bmNocm9uaXplKHN0b3JlLmdldEZyb250bWF0dGVyKCkpO1xuICByZW5kZXJTaG9ydGN1dENvbnRyb2xzKHZpZXcsIGVkaXRvciwgc3RvcmUpO1xuICAvLyBPbmx5IGFmdGVyIHRoZSBmaXJzdCBzeW5jaHJvbml6ZSgpIChzZWUgZ2V0UHJvcGVydHlSb3dDbGFzcykuIEEgbm8tb3AgZm9yXG4gIC8vIGEgc3RpbGwgZW1wdHkgVFlQOyB0aGUgbmV4dCBub24tZW1wdHkgb25lIChvciBhbiBvcGVuIG5vdGUpIHN1cHBsaWVzIHRoZVxuICAvLyBjbGFzcy5cbiAgZW5zdXJlUHJvcGVydHlNZW51UGF0Y2goYXBwLCBlZGl0b3IpO1xuICByZXR1cm4gZWRpdG9yO1xufVxuXG5jb25zdCBDSElQX0NMQVNTID0gXCJ0eXAtc2hvcnRjdXQtY2hpcFwiO1xuY29uc3QgQ0hJUF9URVhUX0NMQVNTID0gXCJ0eXAtc2hvcnRjdXQtY2hpcC10ZXh0XCI7XG5jb25zdCBCVVRUT05fQ0xBU1MgPSBcInR5cC1zaG9ydGN1dC1idXR0b25cIjtcbmNvbnN0IFJPV19DTEFTUyA9IFwidHlwLWhhcy1zaG9ydGN1dFwiO1xuY29uc3QgV0FSTklOR19DTEFTUyA9IFwidHlwLXNob3J0Y3V0LWJsb2NrZWRcIjtcblxuLy8gQnV0dG9uIGFuZCBjaGlwIHBlciBwcm9wZXJ0eSByb3cuIEJvdGggaGFuZyBvbiB0aGUgcm93J3MgY29udGFpbmVyRWwsIE5PVCBpdHNcbi8vIHZhbHVlRWw6IHJlbmRlclByb3BlcnR5KCkgb25seSBldmVyIGVtcHRpZXMgdmFsdWVFbCwgc28gYW55dGhpbmcgYXR0YWNoZWQgdG9cbi8vIGNvbnRhaW5lckVsIHN1cnZpdmVzIGV2ZXJ5IHR5cGUgb3IgdmFsdWUgY2hhbmdlIHdpdGhvdXQgdG91Y2hpbmdcbi8vIE9ic2lkaWFuJ3MgcmVuZGVyIHBpcGVsaW5lLlxuLy9cbi8vIFRoZSBidXR0b24gdG9nZ2xlczogd2l0aG91dCBhIHNob3J0Y3V0IGl0IG9wZW5zIHRoZSBwaWNrZXIsIHdpdGggb25lIGl0XG4vLyByZW1vdmVzIGl0LiBUaGUgY2hpcCBpdHNlbGYgaXMgZm9yIENIQU5HSU5HIGl0LiBDU1Mgc2hvd3MgdGhlIGJ1dHRvbiBvbmx5IG9uXG4vLyByb3cgaG92ZXIvZm9jdXMgKGFuZCBwZXJtYW5lbnRseSB3aGlsZSBhIHNob3J0Y3V0IGlzIHNldCkgLSBvdGhlcndpc2UgZXZlcnlcbi8vIHJvdyB3b3VsZCBjYXJyeSBhIGNvbnRyb2wgbW9zdCBuZXZlciBuZWVkLlxuLy9cbi8vIEhpZGluZyB0aGUgdmFsdWUgZmllbGQgd2hpbGUgYSBzaG9ydGN1dCBpcyBzZXQgaXMgcHVyZSBDU1MgKFJPV19DTEFTUyBpblxuLy8gc3R5bGVzLmNzcyk7IHRoZSBuYXRpdmUgd2lkZ2V0IGtlZXBzIHJlbmRlcmluZyB1bmRlcm5lYXRoLiBTZXR0aW5nIGFuZFxuLy8gcmVtb3ZpbmcgaXMganVzdCBhIGNsYXNzIHRvZ2dsZSwgbm8gcmVuZGVyUHJvcGVydHkoKS9zeW5jaHJvbml6ZSgpIC0gd2hpY2hcbi8vIHdvdWxkIGJlIHJpc2t5IGhlcmUgYW55d2F5IChzZWUgc3RyaXBUeXBQcm9wZXJ0eSkuXG5mdW5jdGlvbiByZW5kZXJTaG9ydGN1dENvbnRyb2xzKHZpZXcsIGVkaXRvciwgc3RvcmUpIHtcbiAgY29uc3Qgc2hvcnRjdXRzID0gc3RvcmUuZ2V0U2hvcnRjdXRzKCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIGVkaXRvci5yZW5kZXJlZCA/PyBbXSkge1xuICAgIGNvbnN0IGNvbnRhaW5lckVsID0gcm93LmNvbnRhaW5lckVsO1xuICAgIGNvbnN0IGtleSA9IHJvdy5lbnRyeT8ua2V5ID8/IFwiXCI7XG4gICAgLy8gQW4gdW5uYW1lZCByb3cgY2FuJ3QgY2FycnkgYSBzaG9ydGN1dCAtIHRoZXJlIGlzIG5vIGtleSB0byBzdG9yZSBpdFxuICAgIC8vIHVuZGVyLiBUaGUgYnV0dG9uIGFwcGVhcnMgb25jZSBpdCBoYXMgYSBuYW1lIChldmVyeSBjaGFuZ2UgcGFzc2VzXG4gICAgLy8gdGhyb3VnaCBzYXZlRnJvbnRtYXR0ZXIgYW5kIHNvIHRocm91Z2ggaGVyZSkuXG4gICAgY29uc3QgcmVjb3JkID0ga2V5ID09PSBcIlwiID8gbnVsbCA6IHNob3J0Y3V0c1trZXldID8/IG51bGw7XG4gICAgY29udGFpbmVyRWwudG9nZ2xlQ2xhc3MoUk9XX0NMQVNTLCAhIXJlY29yZCk7XG5cbiAgICAvLyBPYnNpZGlhbidzIHdhcm5pbmcgdHJpYW5nbGUgc2l0cyBhYnNvbHV0ZWx5IGF0IHRoZSByb3cncyByaWdodCBlZGdlIC1cbiAgICAvLyBleGFjdGx5IHdoZXJlIHRoZSBzaG9ydGN1dCBidXR0b24gZ29lcy4gSWYgdGhlIHJvdyBzaG93cyBhIHR5cGUgd2FybmluZ1xuICAgIC8vIGFuZCBoYXMgTk8gc2hvcnRjdXQsIHRoZSBidXR0b24gZ2l2ZXMgd2F5LiBXaXRoIGEgc2hvcnRjdXQgc2V0LCB0aGVcbiAgICAvLyBidXR0b24gc3RheXMgKGl0IGlzIHRoZSBvbmx5IHdheSB0byByZW1vdmUgdGhlIHNob3J0Y3V0KSBhbmQgdGhlXG4gICAgLy8gdHJpYW5nbGUgZ2l2ZXMgd2F5IGluc3RlYWQgKHN0eWxlcy5jc3MpOiBpdCB3b3VsZCB0aGVuIHJlZmVyIHRvIHRoZVxuICAgIC8vIGhpZGRlbiBmYWxsYmFjayB2YWx1ZSwgd2hpY2ggY2FuJ3QgYmUgZml4ZWQgdGhlcmUgYW55d2F5LlxuICAgIGNvbnN0IG1pc21hdGNoID0gISFyb3cudHlwZUluZm8gJiYgcm93LnR5cGVJbmZvLmV4cGVjdGVkICE9PSByb3cudHlwZUluZm8uaW5mZXJyZWQ7XG4gICAgY29udGFpbmVyRWwudG9nZ2xlQ2xhc3MoV0FSTklOR19DTEFTUywgbWlzbWF0Y2ggJiYgIXJlY29yZCk7XG5cbiAgICBsZXQgYnV0dG9uRWwgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKGA6c2NvcGUgPiAuJHtCVVRUT05fQ0xBU1N9YCk7XG4gICAgaWYgKGtleSA9PT0gXCJcIikge1xuICAgICAgYnV0dG9uRWw/LnJlbW92ZSgpO1xuICAgICAgY29udGFpbmVyRWwucXVlcnlTZWxlY3RvcihgOnNjb3BlID4gLiR7Q0hJUF9DTEFTU31gKT8ucmVtb3ZlKCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKCFidXR0b25FbCkge1xuICAgICAgYnV0dG9uRWwgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IGBjbGlja2FibGUtaWNvbiAke0JVVFRPTl9DTEFTU31gIH0pO1xuICAgICAgc2V0SWNvbihidXR0b25FbCwgXCJzcXVhcmUtZnVuY3Rpb25cIik7XG4gICAgICAvLyBSZWFkIHRoZSBrZXkgb24gY2xpY2ssIG5vdCBoZXJlOiBhIHJlbmFtZSBjaGFuZ2VzIHJvdy5lbnRyeS5rZXlcbiAgICAgIC8vIHdpdGhvdXQgcmVjcmVhdGluZyB0aGUgcm93LlxuICAgICAgYnV0dG9uRWwuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgICAgaWYgKHN0b3JlLmdldFNob3J0Y3V0cygpW3Jvdy5lbnRyeT8ua2V5ID8/IFwiXCJdKSByZW1vdmVTaG9ydGN1dCh2aWV3LCBlZGl0b3IsIHN0b3JlLCByb3cpO1xuICAgICAgICBlbHNlIG9wZW5TaG9ydGN1dFBpY2tlcih2aWV3LCBlZGl0b3IsIHN0b3JlLCByb3cpO1xuICAgICAgfSk7XG4gICAgfVxuICAgIGJ1dHRvbkVsLnNldEF0dHIoXCJhcmlhLWxhYmVsXCIsIHJlY29yZCA/IFwiU2hvcnRjdXQgZW50ZmVybmVuXCIgOiBcIlNob3J0Y3V0IHNldHplblwiKTtcblxuICAgIGxldCBjaGlwRWwgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKGA6c2NvcGUgPiAuJHtDSElQX0NMQVNTfWApO1xuICAgIGlmICghcmVjb3JkKSB7XG4gICAgICBjaGlwRWw/LnJlbW92ZSgpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICghY2hpcEVsKSB7XG4gICAgICBjaGlwRWwgPSBjcmVhdGVFbChcImNvZGVcIiwgeyBjbHM6IENISVBfQ0xBU1MgfSk7XG4gICAgICAvLyBUZXh0IGluIGl0cyBvd24gc3BhbjogdGhlIGNoaXAgaXMgYSBmbGV4IGNvbnRhaW5lciAodmVydGljYWxcbiAgICAgIC8vIGNlbnRlcmluZyBsaWtlIHRoZSByZWFsIHZhbHVlIGZpZWxkKSwgYW5kIHRleHQtb3ZlcmZsb3c6IGVsbGlwc2lzXG4gICAgICAvLyBvbmx5IHdvcmtzIG9uIGEgYmxvY2sgZWxlbWVudC5cbiAgICAgIGNoaXBFbC5jcmVhdGVTcGFuKHsgY2xzOiBDSElQX1RFWFRfQ0xBU1MgfSk7XG4gICAgICBjaGlwRWwuc2V0QXR0cihcImFyaWEtbGFiZWxcIiwgXCJTaG9ydGN1dCBcdTAwRTRuZGVyblwiKTtcbiAgICAgIGNoaXBFbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gb3BlblNob3J0Y3V0UGlja2VyKHZpZXcsIGVkaXRvciwgc3RvcmUsIHJvdykpO1xuICAgICAgLy8gQmVmb3JlIHRoZSBidXR0b24sIHNvIHRoZSByb3cgYWx3YXlzIHJlYWRzIFwibmFtZSB8IGNoaXAgfCBidXR0b25cIi5cbiAgICAgIGNvbnRhaW5lckVsLmluc2VydEJlZm9yZShjaGlwRWwsIGJ1dHRvbkVsKTtcbiAgICB9XG4gICAgY2hpcEVsLmZpcnN0RWxlbWVudENoaWxkLnNldFRleHQoc2hvcnRjdXRMYWJlbChyZWNvcmQpKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBvcGVuU2hvcnRjdXRQaWNrZXIodmlldywgZWRpdG9yLCBzdG9yZSwgcm93KSB7XG4gIGNvbnN0IGtleSA9IHJvdy5lbnRyeT8ua2V5ID8/IFwiXCI7XG4gIGlmIChrZXkgPT09IFwiXCIpIHJldHVybjtcbiAgLy8gUGFzc2luZyB0aGUgY3VycmVudCByZWNvcmQgcHJlZmlsbHMgdGhlIGFyZ3VtZW50IGRpYWxvZyB3aGVuIHRoZSBzYW1lXG4gIC8vIHNjcmlwdCBpcyBwaWNrZWQgYWdhaW4gLSB0aGF0IGlzIGhvdyBzaW5nbGUgYXJndW1lbnRzIGdldCBjb3JyZWN0ZWQuXG4gIGNvbnN0IHJlY29yZCA9IGF3YWl0IHBpY2tTaG9ydGN1dCh2aWV3LmFwcCwga2V5LCB2aWV3LnBsdWdpbi5nZXRTaG9ydGN1dFNjcmlwdHMsIHN0b3JlLmdldFNob3J0Y3V0cygpW2tleV0gPz8gbnVsbCk7XG4gIGlmICghcmVjb3JkKSByZXR1cm47XG4gIC8vIFRoZSBwcm9wZXJ0eSBtYXkgaGF2ZSB2YW5pc2hlZCB3aGlsZSB0aGUgZGlhbG9nIHdhcyBvcGVuICh2aWV3IHJlYnVpbHQpLlxuICAvLyBXaXRob3V0IHRoaXMgY2hlY2sgdGhlIHNob3J0Y3V0IHdvdWxkIGJlIGFuIGludmlzaWJsZSBvcnBoYW4gaW4gdGhlXG4gIC8vIHNldHRpbmdzIHRoYXQgbm90aGluZyBldmVyIGNsZWFucyB1cC5cbiAgaWYgKCFPYmplY3QuaGFzT3duKHN0b3JlLmdldEZyb250bWF0dGVyKCksIGtleSkpIHJldHVybjtcbiAgc3RvcmUuc2V0U2hvcnRjdXRzKHsgLi4uc3RvcmUuZ2V0U2hvcnRjdXRzKCksIFtrZXldOiByZWNvcmQgfSk7XG4gIHNhdmVTaG9ydGN1dHModmlldywgZWRpdG9yLCBzdG9yZSk7XG59XG5cbmZ1bmN0aW9uIHJlbW92ZVNob3J0Y3V0KHZpZXcsIGVkaXRvciwgc3RvcmUsIHJvdykge1xuICBjb25zdCBrZXkgPSByb3cuZW50cnk/LmtleSA/PyBcIlwiO1xuICBjb25zdCBzaG9ydGN1dHMgPSB7IC4uLnN0b3JlLmdldFNob3J0Y3V0cygpIH07XG4gIGlmICghKGtleSBpbiBzaG9ydGN1dHMpKSByZXR1cm47XG4gIGNvbnN0IHNuYXBzaG90ID0gc25hcHNob3RTZXR0aW5ncyh2aWV3LnBsdWdpbik7XG4gIGRlbGV0ZSBzaG9ydGN1dHNba2V5XTtcbiAgc3RvcmUuc2V0U2hvcnRjdXRzKHNob3J0Y3V0cyk7XG4gIHNhdmVTaG9ydGN1dHModmlldywgZWRpdG9yLCBzdG9yZSk7XG4gIG9mZmVyVW5kbyh2aWV3LnBsdWdpbiwgYFNob3J0Y3V0IHJlbW92ZWQgZnJvbSBcIiR7a2V5fVwiLmAsIHNuYXBzaG90KTtcbn1cblxuZnVuY3Rpb24gc2F2ZVNob3J0Y3V0cyh2aWV3LCBlZGl0b3IsIHN0b3JlKSB7XG4gIHZpZXcucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICByZW5kZXJTaG9ydGN1dENvbnRyb2xzKHZpZXcsIGVkaXRvciwgc3RvcmUpO1xufVxuXG4vLyBBIHNpbXBsZSBcImFkZCBwcm9wZXJ0eVwiIGluc3RlYWQgb2YgdGhlIGludGVybmFsIGVkaXRvci5hZGRQcm9wZXJ0eSgpOiBhZGRzXG4vLyBhbiBlbXB0eSBrZXkgd2l0aCB2YWx1ZSBudWxsIGFuZCBsZXRzIHRoZSB3aWRnZXQgcmVuZGVyIGl0IG5vcm1hbGx5IChzYW1lXG4vLyBsb29rIGFzIGluIGEgbm90ZSwgc2luY2Ugc3luY2hyb25pemUoKSBydW5zIE9ic2lkaWFuJ3Mgb3duIHBpcGVsaW5lKSwgdGhlblxuLy8gZm9jdXNlcyB0aGUgbmV3IGtleSBmaWVsZC5cbmZ1bmN0aW9uIGFkZEJsYW5rUHJvcGVydHkoZWRpdG9yKSB7XG4gIGlmICghZWRpdG9yKSByZXR1cm47XG4gIGNvbnN0IGN1cnJlbnQgPSBlZGl0b3Iuc2VyaWFsaXplKCk7XG4gIGlmICghY3VycmVudC5oYXNPd25Qcm9wZXJ0eShcIlwiKSkge1xuICAgIGN1cnJlbnRbXCJcIl0gPSBudWxsO1xuICAgIGVkaXRvci5zeW5jaHJvbml6ZShjdXJyZW50KTtcbiAgICAvLyBFeGlzdGluZyByb3dzIGtlZXAgdGhlaXIgYnV0dG9uIChpdCBzaXRzIG9uIGNvbnRhaW5lckVsKSwgdGhlIG5ldyBvbmVcbiAgICAvLyBuZWVkcyBvbmUuXG4gICAgcmVuZGVyU2hvcnRjdXRDb250cm9scyhlZGl0b3Iub3duZXIudHlwUGFuZSwgZWRpdG9yLCBlZGl0b3Iub3duZXIudHlwU3RvcmUpO1xuICB9XG4gIGVkaXRvci5mb2N1c0tleShcIlwiKTtcbiAgLy8gQ292ZXJzIHRoZSBjYXNlIHdoZXJlIG1vdW50RnJvbnRtYXR0ZXJFZGl0b3IoKSBmb3VuZCBubyByb3cgY2xhc3MgdG8gcGF0Y2hcbiAgLy8gKGVtcHR5IFRZUCwgbm8gb3BlbiBub3RlKSAtIG5vdyB0aGVyZSBpcyBhdCBsZWFzdCBvbmUgcm93LlxuICBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaChlZGl0b3Iub3duZXIuYXBwLCBlZGl0b3IpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgbW91bnRGcm9udG1hdHRlckVkaXRvciwgYWRkQmxhbmtQcm9wZXJ0eSwgZW5zdXJlUHJvcGVydHlNZW51UGF0Y2gsIHJlbW92ZVByb3BlcnR5TWVudVBhdGNoLCB0eXBTdG9yZSwgc3VidHlwU3RvcmUgfTtcbiIsICJjb25zdCB7IG1vdW50RnJvbnRtYXR0ZXJFZGl0b3IsIGFkZEJsYW5rUHJvcGVydHksIHR5cFN0b3JlLCBzdWJ0eXBTdG9yZSB9ID0gcmVxdWlyZShcIi4vdHlwLWZyb250bWF0dGVyLWVkaXRvclwiKTtcbmNvbnN0IHsgZ2V0U2VjdGlvbk9yZGVyLCBpc0VtcHR5VmFsdWUgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cHNcIik7XG5cbi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICogVGhlIGZyb250bWF0dGVyIGJsb2NrcyBvZiBhIFRZUCBpbiB0aGUgVFlQLVBhbmUgZGV0YWlsIChzZWVcbiAqIHJlbmRlclR5cFNldHRpbmdzIGluIHR5cC1wYW5lLmpzKTogdGhlIFRZUC1Gcm9udG1hdHRlciBvbiB0b3AsXG4gKiBiZWxvdyBpdCBvbmUgYmxvY2sgcGVyIHJlZ2lzdGVyZWQgU3VidHlwLlxuICpcbiAqIEVhY2ggYmxvY2sgaGFzIGl0cyBvd24gaW5zdGFuY2Ugb2YgT2JzaWRpYW4ncyBwcm9wZXJ0eSBlZGl0b3IsXG4gKiBib3VuZCB0byB0eXBTdG9yZSBvciBzdWJ0eXBTdG9yZSAoc2VlIHR5cC1mcm9udG1hdHRlci1lZGl0b3IuanMpLlxuICogVGhhdCBpcyB3aGF0IGxldHMgdGhlIHNhbWUga2V5IGFwcGVhciBpbiBzZXZlcmFsIGJsb2NrcyAtIG9uZVxuICogc2hhcmVkIGVkaXRvciB3b3VsZCBob2xkIGV2ZXJ5dGhpbmcgaW4gYSBzaW5nbGUgZmxhdCBvYmplY3QuXG4gKlxuICogT2JzaWRpYW4ncyByb3cgZHJhZyBvbmx5IHdvcmtzIHdpdGhpbiBvbmUgaW5zdGFuY2UsIHNvXG4gKiByZWdpc3RlclByb3BlcnR5RHJhZygpIGJlbG93IGJ1aWxkcyBvbiB0aGF0IGRyYWcgdG8gbW92ZSBhXG4gKiBwcm9wZXJ0eSBiZXR3ZWVuIGJsb2Nrcy4gS2V5Ym9hcmQgbmF2aWdhdGlvbiBhY3Jvc3MgYmxvY2tzIGlzXG4gKiByZWdpc3RlckZvY3VzQ2hhaW4oKSBpbiB0eXAtZnJvbnRtYXR0ZXItZWRpdG9yLmpzLlxuICpcbiAqIFNlY3Rpb246IG51bGwgPSBUWVAtRnJvbnRtYXR0ZXIsIG90aGVyd2lzZSB0aGUgU3VidHlwIG5hbWUuXG4gKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi9cblxuLy8gQSB3aG9sZSBibG9jayBjYW4gYmUgZ3JhYmJlZCBhbnl3aGVyZSBvdXRzaWRlIGl0cyBwcm9wZXJ0eSByb3dzIC0gaGVhZGluZyxcbi8vIGZvb3Rlciwgc2lkZSBtYXJnaW5zLiBDb250cm9scyBhbmQgYSB0aXRsZSBiZWluZyBlZGl0ZWQgYXJlIGV4Y2x1ZGVkLlxuZnVuY3Rpb24gaXNHcmFiVGFyZ2V0KHRhcmdldCkge1xuICBpZiAodGFyZ2V0LmNsb3Nlc3QoXCIuY2xpY2thYmxlLWljb24sIC50eXAtc3VidHlwLWNvbG9yLWRvdCwgW2NvbnRlbnRlZGl0YWJsZT0ndHJ1ZSddLCBpbnB1dCwgdGV4dGFyZWFcIikpIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuICF0YXJnZXQuY2xvc2VzdChcIi5tZXRhZGF0YS1wcm9wZXJ0eVwiKTtcbn1cblxuLy8gcmVuZGVySGVhZGVyKHNlY3Rpb24sIGVsLCBibG9ja3MpIC8gcmVuZGVyRm9vdGVyKHNlY3Rpb24sIGVsLCBibG9ja3MpIGZpbGwgYVxuLy8gYmxvY2sncyBoZWFkaW5nIGFuZCBmb290ZXIuIG9uTW92ZVNlY3Rpb24ob3JkZXIpIHJlcG9ydHMgdGhlIG5ldyBibG9jayBvcmRlclxuLy8gYWZ0ZXIgYSBibG9jayBkcmFnIChzaGFwZWQgbGlrZSBnZXRTZWN0aW9uT3JkZXIsIGxlYWRpbmcgbnVsbCBpbmNsdWRlZCkuXG5mdW5jdGlvbiBtb3VudEZyb250bWF0dGVyQmxvY2tzKHZpZXcsIGNvbnRhaW5lckVsLCB0eXAsIHsgcmVuZGVySGVhZGVyLCByZW5kZXJGb290ZXIsIG9uTW92ZVNlY3Rpb24gfSkge1xuICBjb25zdCB3cmFwcGVyID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1ibG9ja3NcIiB9KTtcbiAgY29uc3Qgc2VjdGlvbnMgPSBnZXRTZWN0aW9uT3JkZXIodmlldy5wbHVnaW4uc2V0dGluZ3MsIHR5cCk7XG4gIGNvbnN0IGVkaXRvcnMgPSBuZXcgTWFwKCk7XG4gIGNvbnN0IGJsb2NrRWxzID0gbmV3IE1hcCgpO1xuICBjb25zdCBzdG9yZXMgPSBuZXcgTWFwKCk7XG5cbiAgY29uc3QgYXBpID0ge1xuICAgIC8vIEFsbCBlZGl0b3IgaW5zdGFuY2VzIGluIGJsb2NrIG9yZGVyOyB0eXAtcGFuZS5qcyBhZGRzIHRoZW0gYXMgY29tcG9uZW50XG4gICAgLy8gY2hpbGRyZW4gYW5kIHVubG9hZHMgdGhlbSBiZWZvcmUgZWFjaCByZWJ1aWxkLlxuICAgIGVkaXRvcnM6IFtdLFxuICAgIC8vIEFkZHMgYSBibGFuayByb3cgYXQgdGhlIGVuZCBvZiB0aGUgYmxvY2sgd2l0aCBmb2N1cyBpbiB0aGUga2V5IGZpZWxkXG4gICAgLy8gKHNlZSBhZGRCbGFua1Byb3BlcnR5KS4gZmxvYXRpbmcgbWFya3MgdGhlIG5leHQgbmFtZWQgcHJvcGVydHkgYXNcbiAgICAvLyBmbG9hdGluZy5cbiAgICBhZGRCbGFuayhzZWN0aW9uLCBmbG9hdGluZyA9IGZhbHNlKSB7XG4gICAgICBjb25zdCBlZGl0b3IgPSBlZGl0b3JzLmdldChzZWN0aW9uKTtcbiAgICAgIGlmICghZWRpdG9yKSByZXR1cm47XG4gICAgICBlZGl0b3IudHlwUGVuZGluZ0Zsb2F0aW5nQWRkID0gZmxvYXRpbmc7XG4gICAgICBhZGRCbGFua1Byb3BlcnR5KGVkaXRvcik7XG4gICAgfSxcbiAgfTtcblxuICAvLyBOZXh0IGJsb2NrIGluIGRpcmVjdGlvbiBzdGVwIHRoYXQgaGFzIGEgcm93IHRvIGp1bXAgdG87IGVtcHR5IGJsb2NrcyBhcmVcbiAgLy8gc2tpcHBlZC5cbiAgY29uc3QgZm9jdXNOZWlnaGJvciA9IChzZWN0aW9uLCBzdGVwKSA9PiB7XG4gICAgZm9yIChsZXQgaSA9IHNlY3Rpb25zLmluZGV4T2Yoc2VjdGlvbikgKyBzdGVwOyBpID49IDAgJiYgaSA8IHNlY3Rpb25zLmxlbmd0aDsgaSArPSBzdGVwKSB7XG4gICAgICBjb25zdCBlZGl0b3IgPSBlZGl0b3JzLmdldChzZWN0aW9uc1tpXSk7XG4gICAgICBpZiAoIWVkaXRvciB8fCBlZGl0b3IucmVuZGVyZWQubGVuZ3RoID09PSAwKSBjb250aW51ZTtcbiAgICAgIGVkaXRvci5mb2N1c1Byb3BlcnR5QXRJbmRleChzdGVwID4gMCA/IDAgOiAtMSk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9O1xuXG4gIGZvciAoY29uc3Qgc2VjdGlvbiBvZiBzZWN0aW9ucykge1xuICAgIGNvbnN0IGlzU3ViID0gc2VjdGlvbiAhPT0gbnVsbDtcbiAgICBjb25zdCBibG9ja0VsID0gd3JhcHBlci5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcInR5cC1ibG9ja1wiICsgKGlzU3ViID8gXCIgdHlwLWZyb250bWF0dGVyLWJsb2NrIHR5cC1zdWJ0eXAtYmxvY2tcIiA6IFwiXCIpLFxuICAgIH0pO1xuICAgIGJsb2NrRWxzLnNldChzZWN0aW9uLCBibG9ja0VsKTtcbiAgICBibG9ja0VsLnR5cFNlY3Rpb24gPSBzZWN0aW9uO1xuXG4gICAgY29uc3QgaGVhZGVyID0gYmxvY2tFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLWhlYWRlciB0eXAtc2VjdGlvbi1oZWFkZXJcIiB9KTtcbiAgICBoZWFkZXIudG9nZ2xlQ2xhc3MoXCJ0eXAtc2VjdGlvbi1zdWJcIiwgaXNTdWIpO1xuXG4gICAgY29uc3Qgc3RvcmUgPSBzZWN0aW9uID09PSBudWxsID8gdHlwU3RvcmUodmlldy5wbHVnaW4sIHR5cCkgOiBzdWJ0eXBTdG9yZSh2aWV3LnBsdWdpbiwgdHlwLCBzZWN0aW9uKTtcbiAgICBzdG9yZXMuc2V0KHNlY3Rpb24sIHN0b3JlKTtcbiAgICBjb25zdCBlZGl0b3IgPSBtb3VudEZyb250bWF0dGVyRWRpdG9yKHZpZXcsIGJsb2NrRWwsIHN0b3JlLCB7XG4gICAgICBvblNoaWZ0Rm9jdXM6IChzdGVwKSA9PiBmb2N1c05laWdoYm9yKHNlY3Rpb24sIHN0ZXApLFxuICAgIH0pO1xuICAgIGlmIChlZGl0b3IpIHtcbiAgICAgIGVkaXRvcnMuc2V0KHNlY3Rpb24sIGVkaXRvcik7XG4gICAgICBhcGkuZWRpdG9ycy5wdXNoKGVkaXRvcik7XG4gICAgfVxuXG4gICAgY29uc3QgZm9vdGVyID0gYmxvY2tFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLXNlY3Rpb24tZm9vdGVyXCIgfSk7XG4gICAgZm9vdGVyLnRvZ2dsZUNsYXNzKFwidHlwLXNlY3Rpb24tc3ViXCIsIGlzU3ViKTtcbiAgICByZW5kZXJIZWFkZXIoc2VjdGlvbiwgaGVhZGVyLCBhcGkpO1xuICAgIHJlbmRlckZvb3Rlcj8uKHNlY3Rpb24sIGZvb3RlciwgYXBpKTtcblxuICAgIGlmICghaXNTdWIpIGNvbnRpbnVlO1xuICAgIGJsb2NrRWwuYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlZG93blwiLCAoZXZlbnQpID0+IHN0YXJ0QmxvY2tEcmFnKGV2ZW50LCBzZWN0aW9uKSk7XG4gIH1cblxuICAvLyBNb3VzZSBkcmFnIGluc3RlYWQgb2YgSFRNTDUgZHJhZ2dhYmxlOiBhIGRyYWdnYWJsZSBhbmNlc3RvciBicm9rZSB0ZXh0XG4gIC8vIHNlbGVjdGlvbiBpbiB0aGUgcm93IGlucHV0cy4gU3RhcnRzIGFmdGVyIGEgZmV3IHBpeGVsczsgYW4gYWNjZW50IGxpbmVcbiAgLy8gc2hvd3MgdGhlIHRhcmdldCBnYXAsIEVzY2FwZSBjYW5jZWxzLiBUaGUgVFlQLUZyb250bWF0dGVyIGlzIGZpeGVkIG9uIHRvcFxuICAvLyAoc2VlIGdldFNlY3Rpb25PcmRlciksIHNvIHRhcmdldCAwIGRvZXNuJ3QgZXhpc3QuXG4gIGZ1bmN0aW9uIHN0YXJ0QmxvY2tEcmFnKGV2ZW50LCBzZWN0aW9uKSB7XG4gICAgaWYgKGV2ZW50LmJ1dHRvbiAhPT0gMCB8fCAhaXNHcmFiVGFyZ2V0KGV2ZW50LnRhcmdldCkpIHJldHVybjtcbiAgICBjb25zdCB3aW4gPSB3cmFwcGVyLndpbjtcbiAgICBjb25zdCBzdGFydFkgPSBldmVudC5jbGllbnRZO1xuICAgIGxldCBkcmFnZ2luZyA9IGZhbHNlO1xuICAgIGxldCBpbmRpY2F0b3IgPSBudWxsO1xuICAgIGxldCBib3hlcyA9IFtdO1xuICAgIGxldCB0YXJnZXRJbmRleCA9IG51bGw7XG5cbiAgICBjb25zdCBtZWFzdXJlID0gKCkgPT4ge1xuICAgICAgY29uc3QgYmFzZSA9IHdyYXBwZXIuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICBib3hlcyA9IHNlY3Rpb25zLm1hcCgobmFtZSkgPT4ge1xuICAgICAgICBjb25zdCByZWN0ID0gYmxvY2tFbHMuZ2V0KG5hbWUpLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgICByZXR1cm4geyBzZWN0aW9uOiBuYW1lLCB0b3A6IHJlY3QudG9wIC0gYmFzZS50b3AsIGJvdHRvbTogcmVjdC5ib3R0b20gLSBiYXNlLnRvcCB9O1xuICAgICAgfSk7XG4gICAgfTtcblxuICAgIGNvbnN0IG9uTW92ZSA9IChtb3ZlRXZlbnQpID0+IHtcbiAgICAgIGlmICghZHJhZ2dpbmcpIHtcbiAgICAgICAgaWYgKE1hdGguYWJzKG1vdmVFdmVudC5jbGllbnRZIC0gc3RhcnRZKSA8IDQpIHJldHVybjtcbiAgICAgICAgZHJhZ2dpbmcgPSB0cnVlO1xuICAgICAgICB3cmFwcGVyLmRvYy5ib2R5LmFkZENsYXNzKFwidHlwLWJsb2NrLWRyYWdnaW5nXCIpO1xuICAgICAgICB3aW4uZ2V0U2VsZWN0aW9uKCk/LnJlbW92ZUFsbFJhbmdlcygpO1xuICAgICAgICBibG9ja0Vscy5nZXQoc2VjdGlvbikuYWRkQ2xhc3MoXCJpcy1kcmFnZ2luZ1wiKTtcbiAgICAgICAgbWVhc3VyZSgpO1xuICAgICAgICBpbmRpY2F0b3IgPSB3cmFwcGVyLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtYmxvY2stZHJvcC1pbmRpY2F0b3JcIiB9KTtcbiAgICAgIH1cbiAgICAgIG1vdmVFdmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgY29uc3QgeSA9IG1vdmVFdmVudC5jbGllbnRZIC0gd3JhcHBlci5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKS50b3A7XG4gICAgICB0YXJnZXRJbmRleCA9IE1hdGgubWF4KDEsIGJveGVzLmZpbHRlcigoYm94KSA9PiAoYm94LnRvcCArIGJveC5ib3R0b20pIC8gMiA8IHkpLmxlbmd0aCk7XG4gICAgICBjb25zdCBmcm9tID0gYm94ZXMuZmluZEluZGV4KChib3gpID0+IGJveC5zZWN0aW9uID09PSBzZWN0aW9uKTtcbiAgICAgIGluZGljYXRvci50b2dnbGUodGFyZ2V0SW5kZXggIT09IGZyb20gJiYgdGFyZ2V0SW5kZXggIT09IGZyb20gKyAxKTtcbiAgICAgIC8vIE1pZGRsZSBvZiB0aGUgZ2FwIGJldHdlZW4gdHdvIGJsb2NrcyAoc2VlIC50eXAtYmxvY2sgKyAudHlwLWJsb2NrIGluXG4gICAgICAvLyBzdHlsZXMuY3NzKS5cbiAgICAgIGNvbnN0IGhhbGZHYXAgPSA2O1xuICAgICAgY29uc3QgZ2FwWSA9XG4gICAgICAgIHRhcmdldEluZGV4ID09PSBib3hlcy5sZW5ndGhcbiAgICAgICAgICA/IGJveGVzW2JveGVzLmxlbmd0aCAtIDFdLmJvdHRvbSArIGhhbGZHYXBcbiAgICAgICAgICA6IChib3hlc1t0YXJnZXRJbmRleCAtIDFdLmJvdHRvbSArIGJveGVzW3RhcmdldEluZGV4XS50b3ApIC8gMjtcbiAgICAgIGluZGljYXRvci5zdHlsZS50b3AgPSBgJHtnYXBZIC0gMX1weGA7XG4gICAgfTtcblxuICAgIGNvbnN0IGVuZCA9IChjb21taXQpID0+IHtcbiAgICAgIHdpbi5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIG9uTW92ZSk7XG4gICAgICB3aW4ucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNldXBcIiwgb25VcCk7XG4gICAgICB3aW4ucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgb25LZXksIHRydWUpO1xuICAgICAgaWYgKCFkcmFnZ2luZykgcmV0dXJuO1xuICAgICAgd3JhcHBlci5kb2MuYm9keS5yZW1vdmVDbGFzcyhcInR5cC1ibG9jay1kcmFnZ2luZ1wiKTtcbiAgICAgIGJsb2NrRWxzLmdldChzZWN0aW9uKS5yZW1vdmVDbGFzcyhcImlzLWRyYWdnaW5nXCIpO1xuICAgICAgaW5kaWNhdG9yPy5yZW1vdmUoKTtcblxuICAgICAgY29uc3Qgb3JkZXIgPSBib3hlcy5tYXAoKGJveCkgPT4gYm94LnNlY3Rpb24pO1xuICAgICAgY29uc3QgZnJvbSA9IG9yZGVyLmluZGV4T2Yoc2VjdGlvbik7XG4gICAgICBpZiAoIWNvbW1pdCB8fCB0YXJnZXRJbmRleCA9PT0gbnVsbCB8fCB0YXJnZXRJbmRleCA9PT0gZnJvbSB8fCB0YXJnZXRJbmRleCA9PT0gZnJvbSArIDEpIHJldHVybjtcbiAgICAgIG9yZGVyLnNwbGljZShmcm9tLCAxKTtcbiAgICAgIG9yZGVyLnNwbGljZShmcm9tIDwgdGFyZ2V0SW5kZXggPyB0YXJnZXRJbmRleCAtIDEgOiB0YXJnZXRJbmRleCwgMCwgc2VjdGlvbik7XG4gICAgICBvbk1vdmVTZWN0aW9uPy4ob3JkZXIpO1xuICAgIH07XG4gICAgY29uc3Qgb25VcCA9ICgpID0+IGVuZCh0cnVlKTtcbiAgICBjb25zdCBvbktleSA9IChrZXlFdmVudCkgPT4ge1xuICAgICAgaWYgKGtleUV2ZW50LmtleSAhPT0gXCJFc2NhcGVcIikgcmV0dXJuO1xuICAgICAga2V5RXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGtleUV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgZW5kKGZhbHNlKTtcbiAgICB9O1xuICAgIHdpbi5hZGRFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIG9uTW92ZSk7XG4gICAgd2luLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZXVwXCIsIG9uVXApO1xuICAgIHdpbi5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCBvbktleSwgdHJ1ZSk7XG4gIH1cblxuICByZWdpc3RlclByb3BlcnR5RHJhZygpO1xuICByZXR1cm4gYXBpO1xuXG4gIC8qIC0tLSBEcmFnZ2luZyBhIHByb3BlcnR5IGludG8gYW5vdGhlciBibG9jayAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAqIEJ1aWx0IG9uIE9ic2lkaWFuJ3Mgb3duIHJvdyBkcmFnIHJhdGhlciB0aGFuIGEgc2Vjb25kIG9uZSBuZXh0IHRvIGl0OlxuICAgKiBpdCBzdGFydHMgYXQgdGhlIHJvdydzIHR5cGUgaWNvbiwgcHV0cyBhIC5kcmFnLXJlb3JkZXItZ2hvc3Qgb24gdGhlXG4gICAqIGJvZHkgKHNvIGl0IGZvbGxvd3MgdGhlIGN1cnNvciBhY3Jvc3MgYmxvY2tzIGFueXdheSkgYW5kIG1hcmtzIHRoZVxuICAgKiBzb3VyY2Ugcm93IHdpdGggLmRyYWctZ2hvc3QtaGlkZGVuLCB0aGUgYWNjZW50IGJveCBzaG93aW5nIHRoZSBkcm9wXG4gICAqIHNwb3QuIFdpdGhpbiBvbmUgYmxvY2sgT2JzaWRpYW4gZG9lcyBldmVyeXRoaW5nIGFzIHVzdWFsLiBBZGRlZCBoZXJlOlxuICAgKlxuICAgKiAgLSBhbiBlbXB0eSBleHRyYSBjaGlsZCBpbiB0aGUgbGlzdCB3aGlsZSBkcmFnZ2luZzogb3RoZXJ3aXNlIE9ic2lkaWFuXG4gICAqICAgIGRvZXNuJ3Qgc3RhcnQgdGhlIGRyYWcgaW4gYSBibG9jayB3aXRoIGEgc2luZ2xlIHJvdyAoaXRzIG1vdXNlZG93blxuICAgKiAgICBjaGVja3Mgbi5maXJzdENoaWxkICE9PSBuLmxhc3RDaGlsZCk7XG4gICAqICAtIGEgcGxhY2Vob2xkZXIgd2l0aCB0aGUgc2FtZSAuZHJhZy1naG9zdC1oaWRkZW4gY2xhc3MgaW4gdGhlIHRhcmdldFxuICAgKiAgICBibG9jayBvbmNlIHRoZSBjdXJzb3IgcmVhY2hlcyBhbm90aGVyIGJsb2NrOyB0aGUgc291cmNlIHJvdyBpc1xuICAgKiAgICBoaWRkZW4gbWVhbndoaWxlIHNvIHRoZXJlIGFyZW4ndCB0d28gYm94ZXM7XG4gICAqICAtIGEgcmVvcmRlcktleSBwZXIgaW5zdGFuY2UgdGhhdCBtb3ZlcyB0aGUgcHJvcGVydHkgdG8gdGhlIG90aGVyXG4gICAqICAgIGJsb2NrIG9uIGRyb3AgaW5zdGVhZCBvZiBzb3J0aW5nIHdpdGhpbiBpdHMgb3duLlxuICAgKlxuICAgKiBPdXIgaGFuZGxlcnMgcnVuIGluIHRoZSBjYXB0dXJlIHBoYXNlIG9uIHRoZSB3aW5kb3csIGJlZm9yZSBPYnNpZGlhbidzXG4gICAqICh3aGljaCBpdCBhZGRzIHRvIHdpbmRvdyBpbiBpdHMgbW91c2Vkb3duIGhhbmRsZXIpLlxuICAgKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuICBmdW5jdGlvbiByZWdpc3RlclByb3BlcnR5RHJhZygpIHtcbiAgICAvLyBXaXRob3V0IGEgc2Vjb25kIGJsb2NrIHRoZXJlIGlzIG5vIHRhcmdldDsgT2JzaWRpYW4ncyBkcmFnIHN0YXlzIGFzIGlzLlxuICAgIGNvbnN0IGFuY2hvciA9IGFwaS5lZGl0b3JzWzBdO1xuICAgIGlmICghYW5jaG9yIHx8IHNlY3Rpb25zLmxlbmd0aCA8IDIpIHJldHVybjtcblxuICAgIC8vIFN0YXRlIG9mIGEgcnVubmluZyBkcmFnOyBkcm9wIGtlZXBzIHRoZSB0YXJnZXQgZm9yIHRoZSByZW9yZGVyS2V5IGNhbGxcbiAgICAvLyB0aGF0IGZvbGxvd3MgdGhlIG1vdXNldXAuXG4gICAgbGV0IGRyYWcgPSBudWxsO1xuICAgIGxldCBkcm9wID0gbnVsbDtcblxuICAgIGNvbnN0IHNlY3Rpb25BdCA9IChjbGllbnRZKSA9PlxuICAgICAgc2VjdGlvbnMuZmluZCgoc2VjdGlvbikgPT4ge1xuICAgICAgICBjb25zdCByZWN0ID0gYmxvY2tFbHMuZ2V0KHNlY3Rpb24pLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgICByZXR1cm4gY2xpZW50WSA+PSByZWN0LnRvcCAmJiBjbGllbnRZIDw9IHJlY3QuYm90dG9tO1xuICAgICAgfSk7XG5cbiAgICBjb25zdCBjbGVhclBsYWNlaG9sZGVyID0gKCkgPT4ge1xuICAgICAgZHJhZy5wbGFjZWhvbGRlcj8ucmVtb3ZlKCk7XG4gICAgICBkcmFnLnBsYWNlaG9sZGVyID0gbnVsbDtcbiAgICAgIGRyYWcucm93RWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJkaXNwbGF5XCIpO1xuICAgICAgZHJhZy50YXJnZXQgPSBudWxsO1xuICAgIH07XG5cbiAgICB3cmFwcGVyLmFkZEV2ZW50TGlzdGVuZXIoXG4gICAgICBcIm1vdXNlZG93blwiLFxuICAgICAgKGV2ZW50KSA9PiB7XG4gICAgICAgIGlmIChldmVudC5idXR0b24gIT09IDApIHJldHVybjtcbiAgICAgICAgY29uc3Qgcm93RWwgPSBldmVudC50YXJnZXQuY2xvc2VzdChcIi5tZXRhZGF0YS1wcm9wZXJ0eS1pY29uXCIpPy5jbG9zZXN0KFwiLm1ldGFkYXRhLXByb3BlcnR5XCIpO1xuICAgICAgICBjb25zdCBzZWN0aW9uID0gcm93RWw/LmNsb3Nlc3QoXCIudHlwLWJsb2NrXCIpPy50eXBTZWN0aW9uO1xuICAgICAgICBjb25zdCBlZGl0b3IgPSBzZWN0aW9uID09PSB1bmRlZmluZWQgPyBudWxsIDogZWRpdG9ycy5nZXQoc2VjdGlvbik7XG4gICAgICAgIGNvbnN0IGtleSA9IGVkaXRvcj8ucmVuZGVyZWQuZmluZCgocm93KSA9PiByb3cuY29udGFpbmVyRWwgPT09IHJvd0VsKT8uZW50cnkua2V5O1xuICAgICAgICAvLyBBbiB1bm5hbWVkIHJvdyBoYXMgbm8gYnVzaW5lc3MgaW4gYW5vdGhlciBibG9jazsgT2JzaWRpYW4gc29ydHMgaXQuXG4gICAgICAgIGlmICgha2V5KSByZXR1cm47XG4gICAgICAgIGRyYWcgPSB7XG4gICAgICAgICAgc2VjdGlvbixcbiAgICAgICAgICBrZXksXG4gICAgICAgICAgcm93RWwsXG4gICAgICAgICAgLy8gTWVhc3VyZWQgbm93OiBvbmNlIGhpZGRlbiBmb3IgdGhlIHBsYWNlaG9sZGVyLCBvZmZzZXRIZWlnaHQgaXMgMC5cbiAgICAgICAgICBoZWlnaHQ6IHJvd0VsLm9mZnNldEhlaWdodCxcbiAgICAgICAgICBzcGFjZXI6IGVkaXRvci5wcm9wZXJ0eUxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWRyYWctc3BhY2VyXCIgfSksXG4gICAgICAgICAgcGxhY2Vob2xkZXI6IG51bGwsXG4gICAgICAgICAgdGFyZ2V0OiBudWxsLFxuICAgICAgICB9O1xuICAgICAgICBkcm9wID0gbnVsbDtcbiAgICAgIH0sXG4gICAgICB0cnVlXG4gICAgKTtcblxuICAgIC8vIE9uIHRoZSB3aW5kb3cgc28gYSBkcmFnIGlzIHRyYWNrZWQgb3V0c2lkZSB0aGUgYmxvY2tzIHRvbzsgcmVtb3ZlZCB3aXRoXG4gICAgLy8gdGhlIGZpcnN0IGVkaXRvciwgd2hpY2ggdW5sb2FkcyBvbiB0aGUgbmV4dCByZWJ1aWxkIG9mIHRoZSBkZXRhaWwgdmlldy5cbiAgICBjb25zdCBvbldpbk1vdmUgPSAoZXZlbnQpID0+IHtcbiAgICAgIGlmICghZHJhZykgcmV0dXJuO1xuICAgICAgY29uc3QgdGFyZ2V0ID0gc2VjdGlvbkF0KGV2ZW50LmNsaWVudFkpO1xuICAgICAgaWYgKHRhcmdldCA9PT0gdW5kZWZpbmVkIHx8IHRhcmdldCA9PT0gZHJhZy5zZWN0aW9uKSB7XG4gICAgICAgIGlmIChkcmFnLnBsYWNlaG9sZGVyKSBjbGVhclBsYWNlaG9sZGVyKCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgY29uc3QgbGlzdCA9IGVkaXRvcnMuZ2V0KHRhcmdldCkucHJvcGVydHlMaXN0RWw7XG4gICAgICBpZiAoIWRyYWcucGxhY2Vob2xkZXIpIHtcbiAgICAgICAgZHJhZy5yb3dFbC5zdHlsZS5kaXNwbGF5ID0gXCJub25lXCI7XG4gICAgICAgIGRyYWcucGxhY2Vob2xkZXIgPSBjcmVhdGVEaXYoeyBjbHM6IFwibWV0YWRhdGEtcHJvcGVydHkgZHJhZy1naG9zdC1oaWRkZW4gdHlwLWRyYWctcGxhY2Vob2xkZXJcIiB9KTtcbiAgICAgICAgZHJhZy5wbGFjZWhvbGRlci5zdHlsZS5oZWlnaHQgPSBgJHtkcmFnLmhlaWdodH1weGA7XG4gICAgICB9XG4gICAgICAvLyBEcm9wIHNwb3QgYXMgT2JzaWRpYW4gZG9lcyBpdDogYmVmb3JlIHRoZSBmaXJzdCByb3cgd2hvc2UgbWlkZGxlIGlzXG4gICAgICAvLyBiZWxvdyB0aGUgY3Vyc29yLlxuICAgICAgY29uc3Qgcm93cyA9IFsuLi5saXN0LmNoaWxkcmVuXS5maWx0ZXIoKGVsKSA9PiBlbCAhPT0gZHJhZy5wbGFjZWhvbGRlciAmJiBlbCAhPT0gZHJhZy5zcGFjZXIpO1xuICAgICAgY29uc3QgYmVmb3JlID0gcm93cy5maW5kKChlbCkgPT4ge1xuICAgICAgICBjb25zdCByZWN0ID0gZWwuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICAgIHJldHVybiBldmVudC5jbGllbnRZIDwgcmVjdC50b3AgKyByZWN0LmhlaWdodCAvIDI7XG4gICAgICB9KTtcbiAgICAgIGRyYWcudGFyZ2V0ID0geyBzZWN0aW9uOiB0YXJnZXQsIGluZGV4OiBiZWZvcmUgPyByb3dzLmluZGV4T2YoYmVmb3JlKSA6IHJvd3MubGVuZ3RoIH07XG4gICAgICBsaXN0Lmluc2VydEJlZm9yZShkcmFnLnBsYWNlaG9sZGVyLCBiZWZvcmUgPz8gbnVsbCk7XG4gICAgfTtcblxuICAgIGNvbnN0IG9uV2luVXAgPSAoKSA9PiB7XG4gICAgICBpZiAoIWRyYWcpIHJldHVybjtcbiAgICAgIGNvbnN0IHsgc3BhY2VyLCBwbGFjZWhvbGRlciwgcm93RWwsIHRhcmdldCB9ID0gZHJhZztcbiAgICAgIGRyYWcgPSBudWxsO1xuICAgICAgZHJvcCA9IHRhcmdldDtcbiAgICAgIHBsYWNlaG9sZGVyPy5yZW1vdmUoKTtcbiAgICAgIHJvd0VsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiZGlzcGxheVwiKTtcbiAgICAgIC8vIE9ubHkgYWZ0ZXIgT2JzaWRpYW4gZmluaXNoZXMgaXRzIGRyYWc6IGl0IHN0aWxsIHJlYWRzIHRoZSBkcm9wIHNwb3RcbiAgICAgIC8vIGluIHRoZSBzb3VyY2UgYmxvY2sgZnJvbSB0aGUgY2hpbGQgbGlzdCwgd2hlcmUgdGhlIHNwYWNlciBtYXJrcyB0aGVcbiAgICAgIC8vIGxhc3QgcG9zaXRpb24uXG4gICAgICB3cmFwcGVyLndpbi5zZXRUaW1lb3V0KCgpID0+IHNwYWNlci5yZW1vdmUoKSwgMCk7XG4gICAgfTtcblxuICAgIHdyYXBwZXIud2luLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZW1vdmVcIiwgb25XaW5Nb3ZlLCB0cnVlKTtcbiAgICB3cmFwcGVyLndpbi5hZGRFdmVudExpc3RlbmVyKFwibW91c2V1cFwiLCBvbldpblVwLCB0cnVlKTtcbiAgICBhbmNob3IucmVnaXN0ZXIoKCkgPT4ge1xuICAgICAgd3JhcHBlci53aW4ucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNlbW92ZVwiLCBvbldpbk1vdmUsIHRydWUpO1xuICAgICAgd3JhcHBlci53aW4ucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNldXBcIiwgb25XaW5VcCwgdHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBmb3IgKGNvbnN0IFtzZWN0aW9uLCBlZGl0b3JdIG9mIGVkaXRvcnMpIHtcbiAgICAgIGNvbnN0IG9yaWdpbmFsUmVvcmRlcktleSA9IGVkaXRvci5yZW9yZGVyS2V5O1xuICAgICAgZWRpdG9yLnJlb3JkZXJLZXkgPSBmdW5jdGlvbiAoZW50cnksIGluZGV4KSB7XG4gICAgICAgIGNvbnN0IHRhcmdldCA9IGRyb3A7XG4gICAgICAgIGRyb3AgPSBudWxsO1xuICAgICAgICBpZiAoIXRhcmdldCkgcmV0dXJuIG9yaWdpbmFsUmVvcmRlcktleS5jYWxsKHRoaXMsIGVudHJ5LCBpbmRleCk7XG4gICAgICAgIG1vdmVQcm9wZXJ0eShzZWN0aW9uLCB0YXJnZXQuc2VjdGlvbiwgZW50cnkua2V5LCB0YXJnZXQuaW5kZXgpO1xuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICAvLyBNb3ZlcyBrZXkgZnJvbSBibG9jayBgZnJvbWAgdG8gYmxvY2sgYHRvYCBhdCBwb3NpdGlvbiBpbmRleC4gSWYgdGhlIHRhcmdldFxuICAvLyBhbHJlYWR5IGhhcyB0aGUgbmFtZSAodW5pcXVlIHdpdGhpbiBhIGJsb2NrKSwgdGhlIHR3byBtZXJnZTogdGhlIGV4aXN0aW5nXG4gIC8vIGVudHJ5IGtlZXBzIHBvc2l0aW9uLCB2YWx1ZSwgZmxvYXRpbmcgZmxhZyBhbmQgc2hvcnRjdXQ7IG9ubHkgYW4gZW1wdHlcbiAgLy8gdmFsdWUgaXMgZmlsbGVkIGZyb20gdGhlIGRyYWdnZWQgb25lIC0gc2FtZSBydWxlIGFzIG1lcmdlU3VidHlwc1xuICAvLyAoc3VidHlwcy5qcykgYW5kIHJlbmFtZUluU3RvcmUgKHByb3BlcnR5LXJlbmFtZS1zeW5jLmpzKS5cbiAgYXN5bmMgZnVuY3Rpb24gbW92ZVByb3BlcnR5KGZyb20sIHRvLCBrZXksIGluZGV4KSB7XG4gICAgY29uc3Qgc291cmNlID0gc3RvcmVzLmdldChmcm9tKTtcbiAgICBjb25zdCB0YXJnZXQgPSBzdG9yZXMuZ2V0KHRvKTtcbiAgICBpZiAoIXNvdXJjZSB8fCAhdGFyZ2V0IHx8IGZyb20gPT09IHRvKSByZXR1cm47XG5cbiAgICBjb25zdCBzb3VyY2VGcm9udG1hdHRlciA9IHsgLi4uc291cmNlLmdldEZyb250bWF0dGVyKCkgfTtcbiAgICBjb25zdCB2YWx1ZSA9IHNvdXJjZUZyb250bWF0dGVyW2tleV07XG4gICAgY29uc3Qgd2FzRmxvYXRpbmcgPSBzb3VyY2UuZ2V0RmxvYXRpbmcoKS5pbmNsdWRlcyhrZXkpO1xuICAgIC8vIFRoZSBzaG9ydGN1dCBiZWxvbmdzIHRvIHRoZSBrZXkgYW5kIG1vdmVzIHdpdGggaXQuXG4gICAgY29uc3Qgc291cmNlU2hvcnRjdXRzID0geyAuLi5zb3VyY2UuZ2V0U2hvcnRjdXRzKCkgfTtcbiAgICBjb25zdCBzaG9ydGN1dCA9IHNvdXJjZVNob3J0Y3V0c1trZXldID8/IG51bGw7XG4gICAgZGVsZXRlIHNvdXJjZVNob3J0Y3V0c1trZXldO1xuICAgIGRlbGV0ZSBzb3VyY2VGcm9udG1hdHRlcltrZXldO1xuICAgIHNvdXJjZS5zZXRGcm9udG1hdHRlcihzb3VyY2VGcm9udG1hdHRlcik7XG4gICAgc291cmNlLnNldEZsb2F0aW5nKHNvdXJjZS5nZXRGbG9hdGluZygpLmZpbHRlcigoaykgPT4gayAhPT0ga2V5KSk7XG4gICAgc291cmNlLnNldFNob3J0Y3V0cyhzb3VyY2VTaG9ydGN1dHMpO1xuXG4gICAgY29uc3QgdGFyZ2V0RnJvbnRtYXR0ZXIgPSB0YXJnZXQuZ2V0RnJvbnRtYXR0ZXIoKTtcbiAgICBjb25zdCBleGlzdGluZyA9IE9iamVjdC5rZXlzKHRhcmdldEZyb250bWF0dGVyKS5maW5kKChrKSA9PiBrLnRvTG93ZXJDYXNlKCkgPT09IGtleS50b0xvd2VyQ2FzZSgpKTtcbiAgICBpZiAoZXhpc3RpbmcgIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKGlzRW1wdHlWYWx1ZSh0YXJnZXRGcm9udG1hdHRlcltleGlzdGluZ10pKSB0YXJnZXQuc2V0RnJvbnRtYXR0ZXIoeyAuLi50YXJnZXRGcm9udG1hdHRlciwgW2V4aXN0aW5nXTogdmFsdWUgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyh0YXJnZXRGcm9udG1hdHRlcik7XG4gICAgICBjb25zdCBhdCA9IE1hdGgubWF4KDAsIE1hdGgubWluKGluZGV4LCBrZXlzLmxlbmd0aCkpO1xuICAgICAgY29uc3QgbmV4dCA9IHt9O1xuICAgICAgZm9yIChjb25zdCBrIG9mIGtleXMuc2xpY2UoMCwgYXQpKSBuZXh0W2tdID0gdGFyZ2V0RnJvbnRtYXR0ZXJba107XG4gICAgICBuZXh0W2tleV0gPSB2YWx1ZTtcbiAgICAgIGZvciAoY29uc3QgayBvZiBrZXlzLnNsaWNlKGF0KSkgbmV4dFtrXSA9IHRhcmdldEZyb250bWF0dGVyW2tdO1xuICAgICAgdGFyZ2V0LnNldEZyb250bWF0dGVyKG5leHQpO1xuICAgICAgaWYgKHdhc0Zsb2F0aW5nKSB0YXJnZXQuc2V0RmxvYXRpbmcoWy4uLnRhcmdldC5nZXRGbG9hdGluZygpLCBrZXldKTtcbiAgICAgIGlmIChzaG9ydGN1dCkgdGFyZ2V0LnNldFNob3J0Y3V0cyh7IC4uLnRhcmdldC5nZXRTaG9ydGN1dHMoKSwgW2tleV06IHNob3J0Y3V0IH0pO1xuICAgIH1cblxuICAgIGF3YWl0IHZpZXcucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgIC8vIEJvdGggYmxvY2tzIGNoYW5nZWQsIHNvIHRoaXMgZGV0YWlsIHZpZXcgaXMgcmVidWlsdCBmcm9tIHRoZSBzZXR0aW5ncztcbiAgICAvLyB0aGUgb3RoZXIgdmlld3Mgb25seSBuZWVkIHRoZWlyIGNvbG9ycyBhbmQgbWFya3MgcmVmcmVzaGVkLlxuICAgIHZpZXcucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnNFeGNlcHQ/Lih2aWV3KTtcbiAgICB2aWV3LnJlbmRlcigpO1xuICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBtb3VudEZyb250bWF0dGVyQmxvY2tzIH07XG4iLCAiY29uc3QgeyBtb3ZlVHlwU3VidHlwcywgZGVsZXRlVHlwU3VidHlwcyB9ID0gcmVxdWlyZShcIi4vc3VidHlwc1wiKTtcblxuLy8gVGhlIHBlci1UWVAgdGFibGVzIG9mIHRoZSBzZXR0aW5ncywgZWFjaCBrZXllZCBieSBUWVAgbmFtZSAtIHRoZSBvbmUgbGlzdFxuLy8gdGhhdCByZW5hbWluZywgbWVyZ2luZyBhbmQgZGVsZXRpbmcgYSBUWVAgZ28gdGhyb3VnaCwgc28gYSB0YWJsZSBhZGRlZCBsYXRlclxuLy8gY2FuJ3QgYmUgZm9yZ290dGVuIGluIG9uZSBvZiB0aGVtLiB0eXBTdWJ0eXBzIGlzIGhhbmRsZWQgc2VwYXJhdGVseSAoc2VlXG4vLyBzdWJ0eXBzLmpzKTogYSBtZXJnZSBjb21iaW5lcyBTdWJ0eXAgYmxvY2tzIGluc3RlYWQgb2YgZHJvcHBpbmcgdGhlbS5cbi8vIHR5cE1hbnVhbCBtYXkgYmUgbWlzc2luZyBpbiBvbGRlciBzZXR0aW5ncywgc28gYSB0YWJsZSBpcyBvbmx5IGNyZWF0ZWQgd2hlblxuLy8gdGhlcmUgaXMgc29tZXRoaW5nIHRvIG1vdmUgaW50byBpdC5cbmNvbnN0IFRZUF9TRVRUSU5HX1RBQkxFUyA9IFtcbiAgXCJ0eXBDb2xvcnNcIixcbiAgXCJ0eXBEZXNjcmlwdGlvbnNcIixcbiAgXCJ0eXBEZWZhdWx0RnJvbnRtYXR0ZXJcIixcbiAgXCJ0eXBGbG9hdGluZ0tleXNcIixcbiAgXCJ0eXBTaG9ydGN1dHNcIixcbiAgXCJ0eXBNYW51YWxcIixcbl07XG5cbi8vIFJlbmFtaW5nIGluIHRoZSBzZXR0aW5nczogdGhlIFRZUCBrZWVwcyBpdHMgcGxhY2UgaW4gc2V0dGluZ3MudHlwcyAodGhlXG4vLyBtYW51YWwgb3JkZXIpLCBldmVyeSB0YWJsZSBlbnRyeSBhbmQgdGhlIFN1YnR5cHMgbW92ZSB0byB0aGUgbmV3IG5hbWUuXG5mdW5jdGlvbiBtb3ZlVHlwU2V0dGluZ3Moc2V0dGluZ3MsIGZyb20sIHRvKSB7XG4gIGNvbnN0IGluZGV4ID0gc2V0dGluZ3MudHlwcy5pbmRleE9mKGZyb20pO1xuICBpZiAoaW5kZXggIT09IC0xKSBzZXR0aW5ncy50eXBzW2luZGV4XSA9IHRvO1xuICBmb3IgKGNvbnN0IHRhYmxlIG9mIFRZUF9TRVRUSU5HX1RBQkxFUykge1xuICAgIGlmIChzZXR0aW5nc1t0YWJsZV0/Lltmcm9tXSA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICBzZXR0aW5nc1t0YWJsZV0gPz89IHt9O1xuICAgIHNldHRpbmdzW3RhYmxlXVt0b10gPSBzZXR0aW5nc1t0YWJsZV1bZnJvbV07XG4gICAgZGVsZXRlIHNldHRpbmdzW3RhYmxlXVtmcm9tXTtcbiAgfVxuICBtb3ZlVHlwU3VidHlwcyhzZXR0aW5ncywgZnJvbSwgdG8pO1xufVxuXG4vLyBSZW1vdmVzIHRoZSBUWVAgZnJvbSB0aGUgbGlzdCBhbmQgZnJvbSBldmVyeSB0YWJsZSwgU3VidHlwcyBpbmNsdWRlZC5cbmZ1bmN0aW9uIGRlbGV0ZVR5cFNldHRpbmdzKHNldHRpbmdzLCB0eXApIHtcbiAgc2V0dGluZ3MudHlwcyA9IHNldHRpbmdzLnR5cHMuZmlsdGVyKCh0KSA9PiB0ICE9PSB0eXApO1xuICBmb3IgKGNvbnN0IHRhYmxlIG9mIFRZUF9TRVRUSU5HX1RBQkxFUykge1xuICAgIGlmIChzZXR0aW5nc1t0YWJsZV0pIGRlbGV0ZSBzZXR0aW5nc1t0YWJsZV1bdHlwXTtcbiAgfVxuICBkZWxldGVUeXBTdWJ0eXBzKHNldHRpbmdzLCB0eXApO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgVFlQX1NFVFRJTkdfVEFCTEVTLCBtb3ZlVHlwU2V0dGluZ3MsIGRlbGV0ZVR5cFNldHRpbmdzIH07XG4iLCAiY29uc3QgeyBJdGVtVmlldywgTWVudSwgTm90aWNlLCBzZXRJY29uLCBkZWJvdW5jZSB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBDb25maXJtTW9kYWwsIHR5cE5hbWVOb2RlLCBzdWJ0eXBOYW1lTm9kZSB9ID0gcmVxdWlyZShcIi4vY29uZmlybS1tb2RhbFwiKTtcbmNvbnN0IHsgc25hcHNob3RTZXR0aW5ncywgb2ZmZXJVbmRvIH0gPSByZXF1aXJlKFwiLi91bmRvXCIpO1xuY29uc3QgeyBtb3VudEZyb250bWF0dGVyQmxvY2tzIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1ibG9ja3NcIik7XG5jb25zdCB7IG1vdmVUeXBTZXR0aW5ncywgZGVsZXRlVHlwU2V0dGluZ3MgfSA9IHJlcXVpcmUoXCIuL3R5cC1zZXR0aW5nc1wiKTtcbmNvbnN0IHsgcnVuT3JSZXBvcnRFcnJvciB9ID0gcmVxdWlyZShcIi4vY29tbWFuZHNcIik7XG5jb25zdCB7IGlzQmFzZXNFbmFibGVkLCBjcmVhdGVCYXNlRm9yIH0gPSByZXF1aXJlKFwiLi9iYXNlc1wiKTtcbmNvbnN0IHsgc29ydFR5cEZyb250bWF0dGVyIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1zb3J0XCIpO1xuY29uc3Qge1xuICBub3JtYWxpemVTdWJ0eXBOYW1lLFxuICBnZXRTdWJ0eXBOYW1lcyxcbiAgZW5zdXJlU3VidHlwLFxuICBtZXJnZVR5cFN1YnR5cHMsXG4gIGdldFN1YnR5cCxcbiAgaXNTdWJ0eXBNYW51YWwsXG4gIHNldFN1YnR5cE1hbnVhbCxcbiAgc2V0QWxsU3VidHlwc01hbnVhbCxcbiAgcmVuYW1lU3VidHlwLFxuICByZW9yZGVyU3VidHlwcyxcbiAgZGVsZXRlU3VidHlwLFxuICBtZXJnZVN1YnR5cHMsXG4gIHJlbmFtZVN1YnR5cEluTm90ZXMsXG59ID0gcmVxdWlyZShcIi4vc3VidHlwc1wiKTtcbmNvbnN0IHsgbm9ybWFsaXplVHlwTmFtZSwgY29tcGFyZVR5cHMsIHNvcnRUeXBzQnlNb2RlLCBwbHVyYWwsIGpvaW5BbmQgfSA9IHJlcXVpcmUoXCIuL3R5cC11dGlsc1wiKTtcbmNvbnN0IHsgdHlwS2V5T2YsIHByb3BlcnR5VmFsdWUsIHNldENhbm9uaWNhbFByb3BlcnR5LCBUWVBfUFJPUEVSVFksIFNVQlRZUF9QUk9QRVJUWSB9ID0gcmVxdWlyZShcIi4vdHlwLWluZGV4XCIpO1xuY29uc3Qge1xuICBzdWJ0eXBDb2xvcixcbiAgYXBwbHlDb2xvck9mZnNldCxcbiAgaGFzQ29sb3JPZmZzZXQsXG4gIHN1YnR5cEhhc093bkNvbG9yLFxuICBwYWludENvbG9yRG90LFxuICBuYW1lQ29sb3IsXG4gIGNoYW5uZWxCb3VuZHMsXG4gIGNsYW1wZWRPZmZzZXQsXG4gIFNVQlRZUF9DT0xPUl9DSEFOTkVMUyxcbiAgREVGQVVMVF9UWVBfQ09MT1IsXG59ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxuY29uc3QgVklFV19UWVBFX1RZUF9QQU5FID0gXCJ0eXAtc3lzdGVtLXBhbmVcIjtcbmNvbnN0IERFRkFVTFRfU09SVF9PUkRFUiA9IFwiY291bnQtZGVzY1wiO1xuY29uc3QgREVGQVVMVF9TRUNPTkRBUlkgPSBcInN1YnR5cHNcIjtcblxuLy8gV2hhdCB0aGUgVFlQLUxpc3Qgc2hvd3MgbmV4dCB0byB0aGUgbmFtZSAoc2V0dGluZ3MudHlwTGlzdFNlY29uZGFyeSksXG4vLyBjeWNsZWQgYnkgYSBoZWFkZXIgYnV0dG9uIG5leHQgdG8gc29ydGluZyAoc2VlIGN5Y2xlU2Vjb25kYXJ5KSAtIHRvbyBmZXcsXG4vLyB0b28gaW1tZWRpYXRlbHkgdmlzaWJsZSBzdGF0ZXMgZm9yIGEgbWVudS5cbi8vICAgc3VidHlwcyAgICAgLSB0aGUgVFlQJ3MgU3VidHlwcyBpbiBicmFja2V0cywgZWFjaCBpbiBpdHMgY29sb3IgKGxpa2UgdGhlXG4vLyAgICAgICAgICAgICAgICAgcHJldmlldyBpbiB0aGUgc2VwYXJhdGUgVFlQLVBpY2tlcilcbi8vICAgZGVzY3JpcHRpb24gLSB0ZXh0IGZpZWxkIHRvIGVkaXQgdGhlIFRZUCBkZXNjcmlwdGlvblxuLy8gICBub25lICAgICAgICAtIG5vdGhpbmcsIHRoZSBuYW1lIGdldHMgdGhlIHdob2xlIHJvd1xuLy8gVGhlIG9yZGVyIGlzIGFsc28gdGhlIGN5Y2xlIG9yZGVyOyB0aGUgZmlyc3QgaXMgdGhlIGRlZmF1bHQ6IHRoZSBTdWJ0eXBzXG4vLyBhcHBlYXIgbm93aGVyZSBlbHNlIGluIHRoZSBsaXN0LCB0aGUgZGVzY3JpcHRpb24gYWxzbyBpbiB0aGUgZGV0YWlsIHZpZXcuXG5jb25zdCBTRUNPTkRBUllfTU9ERVMgPSBbXG4gIHsgbW9kZTogXCJzdWJ0eXBzXCIsIHRpdGxlOiBcIlN1YnR5cCBsaXN0XCIsIGljb246IFwibGlzdC10cmVlXCIgfSxcbiAgeyBtb2RlOiBcImRlc2NyaXB0aW9uXCIsIHRpdGxlOiBcIkRlc2NyaXB0aW9uXCIsIGljb246IFwidGV4dC1jdXJzb3ItaW5wdXRcIiB9LFxuICB7IG1vZGU6IFwibm9uZVwiLCB0aXRsZTogXCJOb3RoaW5nXCIsIGljb246IFwibWludXNcIiB9LFxuXTtcblxuY29uc3QgU09SVF9PUFRJT05TID0gW1xuICAvLyBVbmxpa2UgdGhlIG90aGVycywgXCJtYW51YWxcIiBoYXMgbm8gY29tcGFyaXNvbjogdGhlIG9yZGVyIG9mIHNldHRpbmdzLnR5cHNcbiAgLy8gaXRzZWxmIGlzIHRoZSBzdG9yYWdlIChzZWUgcmVuZGVyKCkgYW5kIHJlbmRlclJlZ2lzdGVyZWRJdGVtKCkgZm9yIHRoZVxuICAvLyBkcmFnICYgZHJvcCByZW5kZXJpbmcgYnVpbHQgb24gaXQpLiBGaXJzdCBvbiBwdXJwb3NlIC0gaXRzIG93biBncm91cCBhdFxuICAvLyB0aGUgdG9wIG9mIHRoZSBtZW51IChzZWUgc2hvd1NvcnRNZW51KS5cbiAgeyBtb2RlOiBcIm1hbnVhbFwiLCB0aXRsZTogXCJNYW51YWwgKGRyYWcgJiBkcm9wKVwiIH0sXG4gIHsgbW9kZTogXCJjb3VudC1kZXNjXCIsIHRpdGxlOiBcIk1vc3Qgbm90ZXMgZmlyc3RcIiB9LFxuICB7IG1vZGU6IFwiY291bnQtYXNjXCIsIHRpdGxlOiBcIkZld2VzdCBub3RlcyBmaXJzdFwiIH0sXG4gIHsgbW9kZTogXCJuYW1lLWFzY1wiLCB0aXRsZTogXCJOYW1lIChBIHRvIFopXCIgfSxcbiAgeyBtb2RlOiBcIm5hbWUtZGVzY1wiLCB0aXRsZTogXCJOYW1lIChaIHRvIEEpXCIgfSxcbiAgeyBtb2RlOiBcImNvbG9yLWFzY1wiLCB0aXRsZTogXCJDb2xvciAocmVkIFx1MjE5MiB2aW9sZXQpXCIgfSxcbiAgeyBtb2RlOiBcImNvbG9yLWRlc2NcIiwgdGl0bGU6IFwiQ29sb3IgKHZpb2xldCBcdTIxOTIgcmVkKVwiIH0sXG5dO1xuXG4vLyBSZXdyaXRlcyB0aGUgVFlQIG9mIGV2ZXJ5IG5vdGUgd2l0aCBrZXkgb2xkS2V5IChzZWUgdHlwS2V5T2YgaW5cbi8vIHR5cC1pbmRleC5qcyAtIHRoZSBUWVAgbmFtZSBmb3IgYSBjbGVhbiB2YWx1ZSwgb3RoZXJ3aXNlIHRoZSByYXcgZm9ybSBsaWtlXG4vLyBcIiBidWNoXCIgb3IgXCJbUEVSU09OLCBCVUNIXVwiKSB0byB0aGUgc2luZ2xlIHZhbHVlIG5ld1ZhbHVlLiBVc2VkIGZvclxuLy8gcmVnaXN0ZXJUeXAoKSAoY2xlYW51cCksIHJlbmFtaW5nIGFuZCBtZXJnaW5nLiBNYXRjaGluZyBpcyBleGFjdCBvbiB0aGUga2V5LFxuLy8gc28gYSBsaXN0IGlzIHJlcGxhY2VkIGFzIGEgd2hvbGUuIEEgZGlmZmVyZW50bHkgc3BlbGxlZCBwcm9wZXJ0eSAoXCJ0eXBcIilcbi8vIGJlY29tZXMgXCJUWVBcIi5cbmFzeW5jIGZ1bmN0aW9uIHJlbmFtZVR5cEluTm90ZXMocGx1Z2luLCBvbGRLZXksIG5ld1ZhbHVlKSB7XG4gIGxldCBjaGFuZ2VkID0gMDtcbiAgZm9yIChjb25zdCBmaWxlIG9mIHBsdWdpbi50eXBJbmRleC5maWxlc1dpdGhUeXAob2xkS2V5KSkge1xuICAgIGxldCBtYXRjaGVkID0gZmFsc2U7XG4gICAgYXdhaXQgcGx1Z2luLmFwcC5maWxlTWFuYWdlci5wcm9jZXNzRnJvbnRNYXR0ZXIoZmlsZSwgKGZyb250bWF0dGVyKSA9PiB7XG4gICAgICBpZiAodHlwS2V5T2YocHJvcGVydHlWYWx1ZShmcm9udG1hdHRlciwgVFlQX1BST1BFUlRZKSkgIT09IG9sZEtleSkgcmV0dXJuO1xuICAgICAgc2V0Q2Fub25pY2FsUHJvcGVydHkoZnJvbnRtYXR0ZXIsIFRZUF9QUk9QRVJUWSwgbmV3VmFsdWUpO1xuICAgICAgbWF0Y2hlZCA9IHRydWU7XG4gICAgfSk7XG4gICAgaWYgKG1hdGNoZWQpIGNoYW5nZWQrKztcbiAgfVxuICByZXR1cm4gY2hhbmdlZDtcbn1cblxuLy8gQ2xlYW5lZCBmb3JtIG9mIGEgcmF3IHZhbHVlIGZvciByZWdpc3RlclR5cCgpOiBhIHNpbmdsZSB2YWx1ZSB0cmltbWVkIGFuZFxuLy8gdXBwZXJjYXNlZDsgYSBsaXN0IGlzIGRlbGliZXJhdGVseSBOT1QgcmVkdWNlZCB0byBvbmUgaXRlbSBidXQgam9pbmVkIGludG9cbi8vIG9uZSB2YWx1ZSBcIkEsIEJcIiAtIHdoaWNoIGEgcmVuYW1lIGNhbiB0aGVuIHR1cm4gaW50byBhbm90aGVyIFRZUCAoc2VlXG4vLyBzdGFydERldGFpbFJlbmFtZS9zaG93TWVyZ2VDb25maXJtKS4gbm9ybWFsaXplIHNwZWxscyB0aGUgc2luZ2xlIG5hbWVzIC1cbi8vIG5vcm1hbGl6ZVN1YnR5cE5hbWUgZm9yIFN1YnR5cHMuXG5mdW5jdGlvbiBub3JtYWxpemVSYXdUeXAocmF3LCBub3JtYWxpemUgPSBub3JtYWxpemVUeXBOYW1lKSB7XG4gIGlmIChBcnJheS5pc0FycmF5KHJhdykpIHtcbiAgICByZXR1cm4gcmF3XG4gICAgICAubWFwKCh2KSA9PiBub3JtYWxpemUoU3RyaW5nKHYgPz8gXCJcIikpKVxuICAgICAgLmZpbHRlcihCb29sZWFuKVxuICAgICAgLmpvaW4oXCIsIFwiKTtcbiAgfVxuICByZXR1cm4gbm9ybWFsaXplKFN0cmluZyhyYXcpKTtcbn1cblxuLy8gV2hlcmUgdHlwaW5nIGhhcHBlbnMgaW4gdGhlIHBhbmU6IHRleHQgZmllbGRzLCBjb250ZW50ZWRpdGFibGUgbmFtZXMgYW5kXG4vLyBPYnNpZGlhbidzIHByb3BlcnR5IGVkaXRvciAoaXRzIHJvd3MgdGhlbXNlbHZlcyBhcmUgZm9jdXMgc3RvcHMgb2YgaXRzXG4vLyBrZXlib2FyZCBuYXZpZ2F0aW9uIC0gVGFiIGZyb20gYSB2YWx1ZSBsYW5kcyBvbiB0aGUgbmV4dCByb3cpLiBUaGUgbmF0aXZlXG4vLyBjb2xvciBwaWNrZXIgZG9lc24ndCBjb3VudDogaXQga2VlcHMgdGhlIGZvY3VzIGFmdGVyIGNsb3NpbmcsIHdoaWNoIHdvdWxkXG4vLyBob2xkIGJhY2sgZXZlcnkgcmVmcmVzaCwgYW5kIGEgcmVmcmVzaCB3aGlsZSBpdCBpcyBvcGVuIG9ubHkgY2xvc2VzIGl0LlxuY29uc3QgRklFTERfU0VMRUNUT1IgPSAnaW5wdXQsIHRleHRhcmVhLCBbY29udGVudGVkaXRhYmxlPVwidHJ1ZVwiXSwgW2NvbnRlbnRlZGl0YWJsZT1cIlwiXSwgLm1ldGFkYXRhLXByb3BlcnR5JztcbmNvbnN0IGlzRmllbGQgPSAoZWwpID0+ICEhZWw/Lm1hdGNoZXM/LihGSUVMRF9TRUxFQ1RPUikgJiYgIWVsLm1hdGNoZXMoJ2lucHV0W3R5cGU9XCJjb2xvclwiXScpO1xuXG4vLyBTaG93cyBhbiB1bnJlZ2lzdGVyZWQga2V5OiBwYWRkaW5nIHdvdWxkIGJlIGludmlzaWJsZSBhcyBwbGFpbiB0ZXh0LCBzbyBpdFxuLy8gZ2V0cyBxdW90ZXMuIExpc3RzIGFscmVhZHkgY2FycnkgdGhlaXIgYnJhY2tldHMgaW4gdGhlIGtleS5cbmZ1bmN0aW9uIGRpc3BsYXlUeXBLZXkodHlwS2V5KSB7XG4gIHJldHVybiB0eXBLZXkgIT09IHR5cEtleS50cmltKCkgPyBgXCIke3R5cEtleX1cImAgOiB0eXBLZXk7XG59XG5cbmNsYXNzIFR5cFBhbmUgZXh0ZW5kcyBJdGVtVmlldyB7XG4gIGNvbnN0cnVjdG9yKGxlYWYsIHBsdWdpbikge1xuICAgIHN1cGVyKGxlYWYpO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICB9XG5cbiAgZ2V0Vmlld1R5cGUoKSB7XG4gICAgcmV0dXJuIFZJRVdfVFlQRV9UWVBfUEFORTtcbiAgfVxuXG4gIGdldERpc3BsYXlUZXh0KCkge1xuICAgIHJldHVybiBcIlRZUFwiO1xuICB9XG5cbiAgZ2V0SWNvbigpIHtcbiAgICByZXR1cm4gXCJzaGFwZXNcIjtcbiAgfVxuXG4gIGFzeW5jIG9uT3BlbigpIHtcbiAgICB0aGlzLmlzRWRpdGluZyA9IGZhbHNlO1xuICAgIHRoaXMuc2VsZWN0ZWRUeXAgPSBudWxsO1xuICAgIHRoaXMuZnJvbnRtYXR0ZXJCbG9ja3MgPSBudWxsO1xuICAgIHRoaXMuZnJvbnRtYXR0ZXJFZGl0b3JzID0gW107XG5cbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIHRoaXMuY29udGVudEVsLmFkZENsYXNzKFwidHlwLXN5c3RlbS1wYW5lXCIpO1xuXG4gICAgLy8gQSByZWZyZXNoIGZyb20gb3V0c2lkZSB0aGF0IHdhaXRlZCBmb3IgYSBmaWVsZCAoc2VlIHJlcXVlc3RSZW5kZXIpIHJ1bnNcbiAgICAvLyBvbmNlIHRoZSBmb2N1cyBoYXMgbGVmdCB0aGUgZmllbGRzIG9mIHRoaXMgcGFuZSAtIGNoZWNrZWQgYSB0aWNrIGxhdGVyLFxuICAgIC8vIHdoZW4gdGhlIGZvY3VzIGhhcyBzZXR0bGVkLiBNb3ZpbmcgZnJvbSBmaWVsZCB0byBmaWVsZCAoVGFiKSBrZWVwc1xuICAgIC8vIHdhaXRpbmcuXG4gICAgdGhpcy5yZWdpc3RlckRvbUV2ZW50KHRoaXMuY29udGVudEVsLCBcImZvY3Vzb3V0XCIsIChldmVudCkgPT4ge1xuICAgICAgaWYgKCF0aGlzLl9yZW5kZXJQZW5kaW5nIHx8IGlzRmllbGQoZXZlbnQucmVsYXRlZFRhcmdldCkpIHJldHVybjtcbiAgICAgIHdpbmRvdy5zZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuX3JlbmRlclBlbmRpbmcgJiYgIXRoaXMuaGFzRmllbGRGb2N1cygpKSB0aGlzLnJlbmRlcigpO1xuICAgICAgfSwgMCk7XG4gICAgfSk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyRG9tRXZlbnQodGhpcy5jb250ZW50RWwsIFwia2V5ZG93blwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRXNjYXBlXCIgJiYgdGhpcy5zZWxlY3RlZFR5cCAhPT0gbnVsbCkgdGhpcy5jbG9zZVR5cFNldHRpbmdzKCk7XG4gICAgfSk7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfVxuXG4gIGFzeW5jIG9uQ2xvc2UoKSB7XG4gICAgdGhpcy5jbG9zZVN1YnR5cENvbG9yUG9wb3Zlcj8uKCk7XG4gIH1cblxuICBvcGVuU2VhcmNoKHR5cCkge1xuICAgIGNvbnN0IGdsb2JhbFNlYXJjaCA9IHRoaXMucGx1Z2luLmFwcC5pbnRlcm5hbFBsdWdpbnMuZ2V0UGx1Z2luQnlJZChcImdsb2JhbC1zZWFyY2hcIik7XG4gICAgaWYgKCFnbG9iYWxTZWFyY2gpIHJldHVybjtcbiAgICAvLyBcIk5vIFRZUFwiIHdpdGhvdXQgYSBmaWx0ZXIgd291bGQgYWxzbyBtYXRjaCBldmVyeSBub24tbWFya2Rvd24gZmlsZSxcbiAgICAvLyB3aGljaCBjYW4ndCBoYXZlIGZyb250bWF0dGVyIC0gaGVuY2UgZmlsZToubWQuXG4gICAgY29uc3QgcXVlcnkgPSB0eXAgPT09IG51bGwgPyBgLVtcIiR7VFlQX1BST1BFUlRZfVwiXSBmaWxlOi5tZGAgOiB0aGlzLnR5cENsYXVzZSh0eXApO1xuICAgIGdsb2JhbFNlYXJjaC5pbnN0YW5jZS5vcGVuR2xvYmFsU2VhcmNoKHF1ZXJ5KTtcbiAgfVxuXG4gIC8vIFNlYXJjaCBjbGF1c2UgZm9yIGEgVFlQIGtleS4gQSBsaXN0ICh1bnJlZ2lzdGVyZWQga2V5IFwiW0EsIEJdXCIpIGhhcyBub1xuICAvLyBleGFjdCBzeW50YXgsIHNvIGl0IHNlYXJjaGVzIG5vdGVzIGNhcnJ5aW5nIGFsbCBpdHMgaXRlbXMuIEFsc28gdXNlZCBieVxuICAvLyBvcGVuU3VidHlwU2VhcmNoKCksIHdoaWNoIGNhbiByZWNlaXZlIGFuIHVucmVnaXN0ZXJlZCAodW5jbGVhbikgVFlQIGtleS5cbiAgdHlwQ2xhdXNlKHR5cCkge1xuICAgIGNvbnN0IHJhdyA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnJhd1ZhbHVlT2YodHlwKTtcbiAgICByZXR1cm4gQXJyYXkuaXNBcnJheShyYXcpXG4gICAgICA/IHJhdy5tYXAoKHYpID0+IGBbXCIke1RZUF9QUk9QRVJUWX1cIjpcIiR7U3RyaW5nKHYgPz8gXCJcIikudHJpbSgpfVwiXWApLmpvaW4oXCIgXCIpXG4gICAgICA6IGBbXCIke1RZUF9QUk9QRVJUWX1cIjpcIiR7dHlwfVwiXWA7XG4gIH1cblxuICAvLyB0eXBLZXkgY29tZXMgc3RyYWlnaHQgZnJvbSBmcm9udG1hdHRlciB2YWx1ZXMgKHNlZSB1bnJlZ2lzdGVyZWRSb3dzIGluXG4gIC8vIHJlbmRlcigpIGFuZCB0eXBLZXlPZikgLSBwb3NzaWJseSBsb3dlcmNhc2UsIHBhZGRlZCBvciBhIGxpc3QuIFRZUCBlbnRyaWVzXG4gIC8vIGFyZSBhbHdheXMgY2xlYW4gdXBwZXJjYXNlIHZhbHVlcywgc28gdGhlIGNsZWFuZWQgZm9ybSBpcyByZWdpc3RlcmVkIChzZWVcbiAgLy8gbm9ybWFsaXplUmF3VHlwKSBhbmQgdGhlIGFmZmVjdGVkIG5vdGVzIGFyZSByZXdyaXR0ZW4gcmlnaHQgYXdheSwgc28gdGhleVxuICAvLyBubyBsb25nZXIgc2hvdyB1cCBhcyB1bnJlZ2lzdGVyZWQuXG4gIGFzeW5jIHJlZ2lzdGVyVHlwKHR5cEtleSkge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuYXBwbHlUeXBSZWdpc3RyYXRpb24odHlwS2V5KTtcbiAgICBpZiAoIXJlc3VsdCkgcmV0dXJuO1xuXG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgICB0aGlzLnJlZnJlc2hPdGhlclZpZXdzKCk7XG5cbiAgICBpZiAocmVzdWx0LnJlbmFtZWQgPiAwKSB7XG4gICAgICBuZXcgTm90aWNlKGBUWVAgJHtyZXN1bHQudHlwfSByZWdpc3RlcmVkLCAke3BsdXJhbChyZXN1bHQucmVuYW1lZCwgXCJub3RlXCIpfSB1cGRhdGVkLmApO1xuICAgIH1cbiAgfVxuXG4gIC8vIFRoZSBjb3JlIG9mIHJlZ2lzdGVyVHlwKCkgd2l0aG91dCBzYXZpbmcsIHJlLXJlbmRlcmluZyBhbmQgbm90aWNlLCBzb1xuICAvLyByZWdpc3RlclR5cFdpdGhTdWJ0eXAoKSBjYW4gcmVnaXN0ZXIgVFlQIGFuZCBTdWJ0eXAgaW4gdHVybiBhbmQgdGhlbiBzYXZlXG4gIC8vIGFuZCBub3RpZnkgT05DRS4gUmV0dXJucyB7IHR5cCwgcmVuYW1lZCB9LCBvciBudWxsIGlmIG5vdGhpbmcgdXNhYmxlIGlzXG4gIC8vIGxlZnQuXG4gIGFzeW5jIGFwcGx5VHlwUmVnaXN0cmF0aW9uKHR5cEtleSkge1xuICAgIGNvbnN0IHJhdyA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnJhd1ZhbHVlT2YodHlwS2V5KTtcbiAgICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplUmF3VHlwKHJhdyA9PT0gdW5kZWZpbmVkID8gdHlwS2V5IDogcmF3KTtcbiAgICBpZiAoIW5vcm1hbGl6ZWQpIHJldHVybiBudWxsO1xuICAgIGlmICghdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwcy5pbmNsdWRlcyhub3JtYWxpemVkKSkge1xuICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwcy5wdXNoKG5vcm1hbGl6ZWQpO1xuICAgIH1cbiAgICBjb25zdCByZW5hbWVkID0gbm9ybWFsaXplZCAhPT0gdHlwS2V5ID8gYXdhaXQgcmVuYW1lVHlwSW5Ob3Rlcyh0aGlzLnBsdWdpbiwgdHlwS2V5LCBub3JtYWxpemVkKSA6IDA7XG4gICAgcmV0dXJuIHsgdHlwOiBub3JtYWxpemVkLCByZW5hbWVkIH07XG4gIH1cblxuICAvLyBDb2xvcnMgYW5kIG1hcmtzIG9mIGV2ZXJ5IG90aGVyIHZpZXcgYWZ0ZXIgYSBjaGFuZ2UgbWFkZSBpbiB0aGlzIHBhbmVcbiAgLy8gKHNlZSByZWZyZXNoVHlwQ29sb3JzRXhjZXB0IGluIG1haW4uanMpLiBUaGlzIHBhbmUgdXBkYXRlcyBpdHNlbGY6IGVpdGhlclxuICAvLyB0aGUgY2hhbmdlIGlzIGFscmVhZHkgdmlzaWJsZSAoYSBwcm9wZXJ0eSBlZGl0KSBvciB0aGUgY2FsbGVyIHJlbmRlcnMuXG4gIHJlZnJlc2hPdGhlclZpZXdzKCkge1xuICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnNFeGNlcHQ/Lih0aGlzKTtcbiAgfVxuXG4gIC8vIEEgbmV3LCBlbXB0eSB0cmVlIGl0ZW0gc3RyYWlnaHQgaW4gZWRpdCBtb2RlIC0gbGlrZSBPYnNpZGlhbidzIG93biB2aWV3c1xuICAvLyAoYSBuZXcgYm9va21hcmsgZ3JvdXAsIHNheSkuXG4gIHN0YXJ0QWRkKCkge1xuICAgIGlmICh0aGlzLmlzRWRpdGluZykgcmV0dXJuO1xuXG4gICAgY29uc3QgdHJlZUl0ZW0gPSB0aGlzLmxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtXCIgfSk7XG4gICAgaWYgKHRoaXMuc2VwYXJhdG9yRWwpIHRoaXMubGlzdEVsLmluc2VydEJlZm9yZSh0cmVlSXRlbSwgdGhpcy5zZXBhcmF0b3JFbCk7XG4gICAgY29uc3Qgc2VsZiA9IHRyZWVJdGVtLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0tc2VsZiBpcy1jbGlja2FibGVcIiB9KTtcbiAgICBjb25zdCBpbm5lciA9IHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1pbm5lclwiIH0pO1xuXG4gICAgdGhpcy5zdGFydElubGluZUVkaXQoaW5uZXIsIHtcbiAgICAgIGNsYXNzRWw6IHNlbGYsXG4gICAgICBvbkZpbmlzaDogYXN5bmMgKGNvbW1pdCwgdGV4dCkgPT4ge1xuICAgICAgICBjb25zdCB2YWx1ZSA9IG5vcm1hbGl6ZVR5cE5hbWUodGV4dCk7XG4gICAgICAgIGlmIChjb21taXQgJiYgdmFsdWUpIHtcbiAgICAgICAgICAvLyBMaWtlIGEgU3VidHlwIHRoYXQgYWxyZWFkeSBleGlzdHMgKHNlZSBzdGFydEFkZFN1YnR5cCk6IHNheSBzb1xuICAgICAgICAgIC8vIGluc3RlYWQgb2YgbGV0dGluZyB0aGUgaW5wdXQgdmFuaXNoIHdpdGhvdXQgYSB3b3JkLlxuICAgICAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwcy5maW5kKCh0KSA9PiB0LnRvTG93ZXJDYXNlKCkgPT09IHZhbHVlLnRvTG93ZXJDYXNlKCkpO1xuICAgICAgICAgIGlmIChleGlzdGluZykge1xuICAgICAgICAgICAgbmV3IE5vdGljZShgVFlQICR7ZXhpc3Rpbmd9IGFscmVhZHkgZXhpc3RzLmApO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBzLnB1c2godmFsdWUpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICB0aGlzLnJlZnJlc2hPdGhlclZpZXdzKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICB9LFxuICAgIH0pO1xuICB9XG5cbiAgLy8gRXZlcnkgaW5saW5lIGlucHV0IG9mIHRoZSBwYW5lIC0gYSBuZXcgVFlQIG9yIFN1YnR5cCwgcmVuYW1pbmcgb25lIGluIHRoZVxuICAvLyBsaXN0LCB0aGUgZGV0YWlsIHRpdGxlIG9yIGEgYmxvY2sgaGVhZGluZyAtIHdvcmtzIHRoZSBzYW1lIHdheSwgbGlrZVxuICAvLyBPYnNpZGlhbidzIHRyZWUgaXRlbXM6IG5vIGV4dHJhIGlucHV0LCB0aGUgdGV4dCBlbGVtZW50IGl0c2VsZiBiZWNvbWVzXG4gIC8vIGNvbnRlbnRlZGl0YWJsZS4gRW50ZXIgY29tbWl0cywgRXNjYXBlIGNhbmNlbHMsIGxlYXZpbmcgdGhlIGZpZWxkIChibHVyKVxuICAvLyBjb21taXRzIHRvby4gb25GaW5pc2goY29tbWl0LCB0ZXh0KSBkb2VzIHRoZSByZXN0OyBpdCBzaG91bGQgZW5kIGluXG4gIC8vIHJlbmRlcigpIG9yIGEgZGlhbG9nIHdob3NlIGNhbGxiYWNrcyByZW5kZXIuXG4gIC8vXG4gIC8vICAgY2xhc3NFbCAgICAgLSBnZXRzIHRoZSBjbGFzc2VzICh0aGUgd2hvbGUgcm93IGluIHRoZSBsaXN0KVxuICAvLyAgIGNsYXNzZXMgICAgIC0gbWFya3MgdGhlIGlucHV0IHN0YXRlIChzdHlsZXMuY3NzLCBtYWtlU2VhcmNoYWJsZSlcbiAgLy8gICBzdG9wQWxsS2V5cyAtIGtlZXBzIGV2ZXJ5IGtleSBmcm9tIHRoZSBzdXJyb3VuZGluZ3MsIG5vdCBvbmx5IEVudGVyIGFuZFxuICAvLyAgICAgICAgICAgICAgICAgRXNjYXBlIChhIGJsb2NrIGhlYWRpbmcgaW5zaWRlIHRoZSBwcm9wZXJ0eSBlZGl0b3JzLFxuICAvLyAgICAgICAgICAgICAgICAgd2hvc2Uga2V5Ym9hcmQgbmF2aWdhdGlvbiB3b3VsZCByZWFjdCB0b28pXG4gIC8vXG4gIC8vIFdoaWxlIHRoZSBpbnB1dCBydW5zLCByZW5kZXIoKSBpcyBkZWZlcnJlZCAoc2VlIHRoZXJlKSAtIGEgcmVidWlsZCB3b3VsZFxuICAvLyByZW1vdmUgdGhlIGVsZW1lbnQsIGFuZCB0aGUgYmx1ciB0aGF0IGZvbGxvd3Mgd291bGQgY29tbWl0IGEgaGFsZi10eXBlZCBvclxuICAvLyBlbXB0eSBuYW1lLlxuICBzdGFydElubGluZUVkaXQoZWwsIHsgY2xhc3NFbCA9IGVsLCBjbGFzc2VzID0gW1wiaXMtYmVpbmctcmVuYW1lZFwiXSwgc3RvcEFsbEtleXMgPSBmYWxzZSwgb25GaW5pc2ggfSkge1xuICAgIGlmICh0aGlzLmlzRWRpdGluZykgcmV0dXJuIGZhbHNlO1xuICAgIHRoaXMuaXNFZGl0aW5nID0gdHJ1ZTtcblxuICAgIGlmIChjbGFzc2VzLmxlbmd0aCA+IDApIGNsYXNzRWwuYWRkQ2xhc3MoLi4uY2xhc3Nlcyk7XG4gICAgZWwuc2V0QXR0cmlidXRlKFwiY29udGVudGVkaXRhYmxlXCIsIFwidHJ1ZVwiKTtcbiAgICBlbC5zZXRBdHRyaWJ1dGUoXCJzcGVsbGNoZWNrXCIsIFwiZmFsc2VcIik7XG4gICAgZWwuZm9jdXMoKTtcblxuICAgIGNvbnN0IHJhbmdlID0gZWwuZG9jLmNyZWF0ZVJhbmdlKCk7XG4gICAgcmFuZ2Uuc2VsZWN0Tm9kZUNvbnRlbnRzKGVsKTtcbiAgICBjb25zdCBzZWxlY3Rpb24gPSBlbC53aW4uZ2V0U2VsZWN0aW9uKCk7XG4gICAgc2VsZWN0aW9uLnJlbW92ZUFsbFJhbmdlcygpO1xuICAgIHNlbGVjdGlvbi5hZGRSYW5nZShyYW5nZSk7XG5cbiAgICBsZXQgZG9uZSA9IGZhbHNlO1xuICAgIGNvbnN0IGZpbmlzaCA9IGFzeW5jIChjb21taXQpID0+IHtcbiAgICAgIGlmIChkb25lKSByZXR1cm47XG4gICAgICBkb25lID0gdHJ1ZTtcbiAgICAgIHRoaXMuaXNFZGl0aW5nID0gZmFsc2U7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBvbkZpbmlzaChjb21taXQsIGVsLnRleHRDb250ZW50ID8/IFwiXCIpO1xuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgLy8gQSByZW5kZXIgcmVxdWVzdGVkIGR1cmluZyB0aGUgaW5wdXQgd2FzIG9ubHkgZGVmZXJyZWQuIG9uRmluaXNoXG4gICAgICAgIC8vIHVzdWFsbHkgcmVuZGVyZWQgYWxyZWFkeSAod2hpY2ggY2xlYXJzIHRoZSBmbGFnKTsgaWYgaXQgbGVmdCB0aGVcbiAgICAgICAgLy8gdmlldyB0byBhIGRpYWxvZywgY2F0Y2ggdXAgbm93LlxuICAgICAgICBpZiAodGhpcy5fcmVuZGVyUGVuZGluZykgdGhpcy5yZW5kZXIoKTtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgZWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoc3RvcEFsbEtleXMpIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgaWYgKGV2ZW50LmtleSA9PT0gXCJFbnRlclwiKSB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICBmaW5pc2godHJ1ZSk7XG4gICAgICB9IGVsc2UgaWYgKGV2ZW50LmtleSA9PT0gXCJFc2NhcGVcIikge1xuICAgICAgICAvLyBzdG9wUHJvcGFnYXRpb24sIG9yIHRoZSBkZXRhaWwgdmlldydzIG93biBFc2NhcGUgaGFuZGxlciAoc2VlXG4gICAgICAgIC8vIG9uT3Blbikgd291bGQgbGVhdmUgaXQgYXMgd2VsbC5cbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgIGZpbmlzaChmYWxzZSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgLy8gQSBibHVyIGJlY2F1c2UgdGhlIGVsZW1lbnQgbGVmdCB0aGUgRE9NICh0aGUgdmlldyBjbG9zZWQsIHNheSkgaXMgbm9cbiAgICAvLyBkZWNpc2lvbiBvZiB0aGUgdXNlcidzIGFuZCBtdXN0IG5vdCBjb21taXQuIENoZWNrZWQgYSBtaWNyb3Rhc2sgbGF0ZXI6XG4gICAgLy8gd2hpbGUgaXQgaXMgYmVpbmcgcmVtb3ZlZCwgdGhlIGVsZW1lbnQgbWF5IHN0aWxsIGNvdW50IGFzIGNvbm5lY3RlZC5cbiAgICBlbC5hZGRFdmVudExpc3RlbmVyKFwiYmx1clwiLCAoKSA9PiBxdWV1ZU1pY3JvdGFzaygoKSA9PiBmaW5pc2goZWwuaXNDb25uZWN0ZWQpKSk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvLyBTd2l0Y2hpbmcgYmV0d2VlbiBsaXN0IGFuZCBkZXRhaWwgdmlldyBzdGFydHMgYXQgdGhlIHRvcDsgZXZlcnkgb3RoZXJcbiAgLy8gcmVuZGVyKCkga2VlcHMgdGhlIHNjcm9sbCBwb3NpdGlvbiAoc2VlIHRoZXJlKS5cbiAgb3BlblR5cFNldHRpbmdzKHR5cCkge1xuICAgIHRoaXMuc2VsZWN0ZWRUeXAgPSB0eXA7XG4gICAgdGhpcy5fcmVzZXRTY3JvbGwgPSB0cnVlO1xuICAgIHRoaXMucmVuZGVyKCk7XG4gIH1cblxuICBjbG9zZVR5cFNldHRpbmdzKCkge1xuICAgIHRoaXMuc2VsZWN0ZWRUeXAgPSBudWxsO1xuICAgIHRoaXMuX3Jlc2V0U2Nyb2xsID0gdHJ1ZTtcbiAgICB0aGlzLnJlbmRlcigpO1xuICB9XG5cbiAgLy8gVGhlIGVkaXRvcnMgYXJlIGNvbXBvbmVudCBjaGlsZHJlbiAoc2VlIG1vdW50RnJvbnRtYXR0ZXJFZGl0b3IpIGFuZCBtdXN0XG4gIC8vIGJlIHVubG9hZGVkIGJlZm9yZSBldmVyeSByZWJ1aWxkIC0gY29udGVudEVsLmVtcHR5KCkgYWxvbmUgd291bGQgcmVtb3ZlIHRoZVxuICAvLyBET00gYnV0IGxlYXZlIGVhY2ggZWRpdG9yJ3MgbWV0YWRhdGFUeXBlTWFuYWdlciBsaXN0ZW5lciBiZWhpbmQuXG4gIC8vIGZyb250bWF0dGVyQmxvY2tzIGNvbnRyb2xzIGFsbCBibG9ja3MgKHVzZWQgYnkgXCJBZGQgVFlQLUZyb250bWF0dGVyXG4gIC8vIHByb3BlcnR5XCIpLCBmcm9udG1hdHRlckVkaXRvcnMgaG9sZHMgZXZlcnkgZWRpdG9yIGluY2wuIFN1YnR5cCBibG9ja3MuXG4gIGRlc3Ryb3lGcm9udG1hdHRlckVkaXRvcigpIHtcbiAgICBmb3IgKGNvbnN0IGVkaXRvciBvZiB0aGlzLmZyb250bWF0dGVyRWRpdG9ycyA/PyBbXSkgdGhpcy5yZW1vdmVDaGlsZChlZGl0b3IpO1xuICAgIHRoaXMuZnJvbnRtYXR0ZXJFZGl0b3JzID0gW107XG4gICAgdGhpcy5mcm9udG1hdHRlckJsb2NrcyA9IG51bGw7XG4gIH1cblxuICAvLyBGb2N1cyBpbiBvbmUgb2YgdGhlIHBhbmUncyBmaWVsZHMgKHNlZSBpc0ZpZWxkKS5cbiAgaGFzRmllbGRGb2N1cygpIHtcbiAgICBjb25zdCBhY3RpdmUgPSB0aGlzLmNvbnRlbnRFbC5kb2MuYWN0aXZlRWxlbWVudDtcbiAgICByZXR1cm4gISFhY3RpdmUgJiYgdGhpcy5jb250ZW50RWwuY29udGFpbnMoYWN0aXZlKSAmJiBpc0ZpZWxkKGFjdGl2ZSk7XG4gIH1cblxuICAvLyBBIHJlYnVpbGQgcmVxdWVzdGVkIGZyb20gb3V0c2lkZSAocmVnaXN0ZXJUeXBQYW5lOiByZWZyZXNoVHlwQ29sb3JzKCksIGFuXG4gIC8vIGluZGV4IGNoYW5nZSwgU3luYywgVW5kbykuIFdoaWxlIHNvbWVvbmUgdHlwZXMgaW4gdGhpcyBwYW5lIC0gYVxuICAvLyBkZXNjcmlwdGlvbiwgYSBwcm9wZXJ0eSwgYW4gaW5saW5lIG5hbWUgLSBpdCB3b3VsZCB0aHJvdyB0aGUgZmllbGQgYXdheVxuICAvLyB3aXRoIHRleHQsIGN1cnNvciBhbmQgZm9jdXMsIHNvIGl0IHdhaXRzIHVudGlsIHRoZSBmb2N1cyBsZWF2ZXMgdGhlXG4gIC8vIGZpZWxkcyAoc2VlIG9uT3Blbikgb3IgdGhlIGlubGluZSBpbnB1dCBlbmRzIChzZWUgc3RhcnRJbmxpbmVFZGl0KS4gVGhlXG4gIC8vIHBhbmUncyBvd24gYWN0aW9ucyBjYWxsIHJlbmRlcigpIGRpcmVjdGx5IGFuZCB0YWtlIGVmZmVjdCBhdCBvbmNlLlxuICByZXF1ZXN0UmVuZGVyKCkge1xuICAgIGlmICh0aGlzLmhhc0ZpZWxkRm9jdXMoKSkge1xuICAgICAgdGhpcy5fcmVuZGVyUGVuZGluZyA9IHRydWU7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMucmVuZGVyKCk7XG4gIH1cblxuICByZW5kZXIoKSB7XG4gICAgLy8gUmVlbnRyYW5jeSBndWFyZDogYSByZW5kZXIgcmVhY2hlZCBmcm9tIGluc2lkZSByZW5kZXIoKSBtdXN0IG5vdFxuICAgIC8vIHJlYnVpbGQgdGhlIGhhbGYtYnVpbHQgdmlldy4gSXQgb25jZSByZWN1cnNlZCBpbnRvIGEgc3RhY2sgb3ZlcmZsb3cgb25cbiAgICAvLyBldmVyeSBUWVAgb3BlbmVkLCB3aGVuIHJlbmRlclR5cFNldHRpbmdzKCkgc3RpbGwgZW5kZWQgd2l0aCB0aGUgZnVsbFxuICAgIC8vIHJlZnJlc2hUeXBDb2xvcnMoKSAoaXQgbm93IGNhbGxzIG9ubHkgcmVmcmVzaEZyb250bWF0dGVySGlnaGxpZ2h0KS5cbiAgICBpZiAodGhpcy5fcmVuZGVyaW5nKSByZXR1cm47XG4gICAgLy8gQW4gaW5saW5lIGlucHV0IGlzIHJ1bm5pbmcgKHNlZSBzdGFydElubGluZUVkaXQpOiBhIHJlYnVpbGQgbm93IHdvdWxkXG4gICAgLy8gdGhyb3cgaXQgYXdheSBtaWQtdHlwaW5nIC0gYW5kIGNvbW1pdCBpdCB0aHJvdWdoIHRoZSBibHVyLiBTbyB0aGUgcmVuZGVyXG4gICAgLy8gKGFuIGluZGV4IGNoYW5nZSwgYSByZWZyZXNoIGZyb20gZWxzZXdoZXJlKSB3YWl0cyBmb3IgdGhlIGlucHV0IHRvIGVuZC5cbiAgICBpZiAodGhpcy5pc0VkaXRpbmcpIHtcbiAgICAgIHRoaXMuX3JlbmRlclBlbmRpbmcgPSB0cnVlO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLl9yZW5kZXJQZW5kaW5nID0gZmFsc2U7XG4gICAgdGhpcy5fcmVuZGVyaW5nID0gdHJ1ZTtcbiAgICAvLyBUaGUgcmVidWlsZCBrZWVwcyB0aGUgc2Nyb2xsIHBvc2l0aW9uLCBzbyBhIGxvbmcgVFlQIGRvZXNuJ3QganVtcCB0byB0aGVcbiAgICAvLyB0b3AgYWZ0ZXIgZXZlcnkgY2hhbmdlOyBvbmx5IHN3aXRjaGluZyBiZXR3ZWVuIGxpc3QgYW5kIGRldGFpbCB2aWV3XG4gICAgLy8gc3RhcnRzIGF0IHRoZSB0b3AgKG9wZW5UeXBTZXR0aW5ncy9jbG9zZVR5cFNldHRpbmdzKS5cbiAgICBjb25zdCBzY3JvbGxUb3AgPSB0aGlzLl9yZXNldFNjcm9sbCA/IDAgOiB0aGlzLmNvbnRlbnRFbC5zY3JvbGxUb3A7XG4gICAgdGhpcy5fcmVzZXRTY3JvbGwgPSBmYWxzZTtcbiAgICB0cnkge1xuICAgICAgdGhpcy5kZXN0cm95RnJvbnRtYXR0ZXJFZGl0b3IoKTtcbiAgICAgIGlmICh0aGlzLnNlbGVjdGVkVHlwICE9PSBudWxsKSB7XG4gICAgICAgIHRoaXMucmVuZGVyVHlwU2V0dGluZ3ModGhpcy5zZWxlY3RlZFR5cCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgICBjb250ZW50RWwuZW1wdHkoKTtcblxuICAgICAgY29uc3QgeyBjb3VudHMsIG5vVHlwIH0gPSB0aGlzLnBsdWdpbi50eXBJbmRleC50eXBDb3VudHMoKTtcbiAgICAgIGNvbnN0IHJlZ2lzdGVyZWQgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBzO1xuICAgICAgY29uc3QgdHlwQ29sb3JzID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzO1xuICAgICAgY29uc3Qgc29ydE9yZGVyID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwU29ydE9yZGVyID8/IERFRkFVTFRfU09SVF9PUkRFUjtcbiAgICAgIGNvbnN0IGlzTWFudWFsU29ydCA9IHNvcnRPcmRlciA9PT0gXCJtYW51YWxcIjtcbiAgICAgIGNvbnN0IGJ5Q3VycmVudE9yZGVyID0gKGEsIGIpID0+IGNvbXBhcmVUeXBzKHNvcnRPcmRlciwgYSwgYiwgY291bnRzLCB0eXBDb2xvcnMpO1xuXG4gICAgICB0aGlzLnJlbmRlckxpc3RIZWFkZXIoY29udGVudEVsKTtcblxuICAgICAgY29uc3QgdW5yZWdpc3RlcmVkUm93cyA9IFsuLi5jb3VudHMua2V5cygpXVxuICAgICAgICAuZmlsdGVyKCh0eXApID0+ICFyZWdpc3RlcmVkLmluY2x1ZGVzKHR5cCkpXG4gICAgICAgIC5zb3J0KGJ5Q3VycmVudE9yZGVyKVxuICAgICAgICAubWFwKCh0eXApID0+ICh7IHR5cCwgY291bnQ6IGNvdW50cy5nZXQodHlwKSA/PyAwIH0pKTtcbiAgICAgIGNvbnN0IHVucmVnaXN0ZXJlZFN1YnR5cFJvd3MgPSB0aGlzLnVucmVnaXN0ZXJlZFN1YnR5cFJvd3MoKTtcblxuICAgICAgLy8gV2l0aG91dCBhIHNlY29uZCBjb2x1bW4gdGhlIG5hbWUgbWF5IHRha2UgdGhlIHdob2xlIHJvdyAoc2VlXG4gICAgICAvLyAudHlwLWxpc3Qtbm8tc2Vjb25kYXJ5IGluIHN0eWxlcy5jc3MpLlxuICAgICAgY29uc3QgbGlzdENscyA9IFwidHlwLWxpc3QgbmF2LWZpbGVzLWNvbnRhaW5lclwiICsgKHRoaXMuc2Vjb25kYXJ5TW9kZSgpID09PSBcIm5vbmVcIiA/IFwiIHR5cC1saXN0LW5vLXNlY29uZGFyeVwiIDogXCJcIik7XG4gICAgICB0aGlzLmxpc3RFbCA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IGxpc3RDbHMgfSk7XG4gICAgICB0aGlzLnNlcGFyYXRvckVsID0gbnVsbDtcblxuICAgICAgLy8gSW4gbWFudWFsIG1vZGUgc29ydFR5cHNCeU1vZGUoKSBrZWVwcyB0aGUgb3JkZXIgb2Ygc2V0dGluZ3MudHlwcyxcbiAgICAgIC8vIHdoaWNoIGRyYWcgJiBkcm9wIGluIHJlbmRlclJlZ2lzdGVyZWRJdGVtKCkgcmVhcnJhbmdlczsgaW5kZXggaXMgdGhlXG4gICAgICAvLyBwb3NpdGlvbiBpbiB0aGF0IG9yZGVyLlxuICAgICAgY29uc3QgcmVnaXN0ZXJlZE9yZGVyID0gc29ydFR5cHNCeU1vZGUocmVnaXN0ZXJlZCwgc29ydE9yZGVyLCBjb3VudHMsIHR5cENvbG9ycyk7XG4gICAgICByZWdpc3RlcmVkT3JkZXIuZm9yRWFjaCgodHlwLCBpbmRleCkgPT4ge1xuICAgICAgICB0aGlzLnJlbmRlclJlZ2lzdGVyZWRJdGVtKHR5cCwgY291bnRzLmdldCh0eXApID8/IDAsIHsgZHJhZ2dhYmxlOiBpc01hbnVhbFNvcnQsIGluZGV4IH0pO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIEJlbG93IHRoZSBzZXBhcmF0b3IgdGhyZWUgb3B0aW9uYWwgc2VjdGlvbnM6IHVucmVnaXN0ZXJlZCBUWVAgdmFsdWVzLFxuICAgICAgLy8gdW5yZWdpc3RlcmVkIFN1YnR5cHMsIFwiW05PIFRZUF1cIi4gVGhlIFN1YnR5cHMgZ2V0IHRoZWlyIG93biBzZXBhcmF0b3JcbiAgICAgIC8vIGJlY2F1c2UgdGhleSBzb3J0IGJ5IGEgZGlmZmVyZW50IHJ1bGUgKGNvdW50LCBub3QgdGhlIHNvcnQgYnV0dG9uKSAtXG4gICAgICAvLyB3aXRob3V0IGEgdmlzaWJsZSBjdXQgaXQgd291bGQgbG9vayBsaWtlIGJyb2tlbiBzb3J0aW5nLiBcIltOTyBUWVBdXCIgaXNcbiAgICAgIC8vIG5vIHJlYWwgVFlQLCB0YWtlcyBubyBwYXJ0IGluIHNvcnRpbmcgYW5kIGFsd2F5cyBjb21lcyBsYXN0LCB3aXRob3V0IGFcbiAgICAgIC8vIHRoaXJkIGxpbmUuXG4gICAgICAvL1xuICAgICAgLy8gdGhpcy5zZXBhcmF0b3JFbCBzdGF5cyB0aGUgRklSU1QgbGluZTogc3RhcnRBZGQoKSBpbnNlcnRzIHRoZSBuZXcgaXRlbVxuICAgICAgLy8gYmVmb3JlIGl0LCBhbmQgYSBuZXcgVFlQIGJlbG9uZ3MgYWZ0ZXIgdGhlIHJlZ2lzdGVyZWQgb25lcy5cbiAgICAgIGNvbnN0IHNlcGFyYXRvciA9ICgpID0+IHtcbiAgICAgICAgY29uc3QgZWwgPSB0aGlzLmxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLXNlcGFyYXRvclwiIH0pO1xuICAgICAgICB0aGlzLnNlcGFyYXRvckVsID0gdGhpcy5zZXBhcmF0b3JFbCA/PyBlbDtcbiAgICAgIH07XG5cbiAgICAgIGlmICh1bnJlZ2lzdGVyZWRSb3dzLmxlbmd0aCA+IDAgfHwgdW5yZWdpc3RlcmVkU3VidHlwUm93cy5sZW5ndGggPiAwIHx8IG5vVHlwID4gMCkgc2VwYXJhdG9yKCk7XG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiB1bnJlZ2lzdGVyZWRSb3dzKSB0aGlzLnJlbmRlclVucmVnaXN0ZXJlZEl0ZW0ocm93LnR5cCwgcm93LmNvdW50KTtcblxuICAgICAgaWYgKHVucmVnaXN0ZXJlZFN1YnR5cFJvd3MubGVuZ3RoID4gMCkge1xuICAgICAgICBpZiAodW5yZWdpc3RlcmVkUm93cy5sZW5ndGggPiAwKSBzZXBhcmF0b3IoKTtcbiAgICAgICAgZm9yIChjb25zdCByb3cgb2YgdW5yZWdpc3RlcmVkU3VidHlwUm93cykgdGhpcy5yZW5kZXJVbnJlZ2lzdGVyZWRTdWJ0eXBJdGVtKHJvdyk7XG4gICAgICB9XG5cbiAgICAgIGlmIChub1R5cCA+IDApIHRoaXMucmVuZGVyTm9UeXBJdGVtKG5vVHlwKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5jb250ZW50RWwuc2Nyb2xsVG9wID0gc2Nyb2xsVG9wO1xuICAgICAgdGhpcy5fcmVuZGVyaW5nID0gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgLy8gTGlrZSB0aGUgXCJDaGFuZ2Ugc29ydCBvcmRlclwiIGJ1dHRvbiBpbiBPYnNpZGlhbidzIHRhZ3MgYW5kIGFsbC1wcm9wZXJ0aWVzXG4gIC8vIHZpZXdzLlxuICByZW5kZXJMaXN0SGVhZGVyKGNvbnRlbnRFbCkge1xuICAgIGNvbnN0IGhlYWRlciA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibmF2LWhlYWRlclwiIH0pO1xuICAgIGNvbnN0IGJ1dHRvbnNDb250YWluZXIgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcIm5hdi1idXR0b25zLWNvbnRhaW5lclwiIH0pO1xuXG4gICAgY29uc3QgYWRkQnRuID0gYnV0dG9uc0NvbnRhaW5lci5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIG5hdi1hY3Rpb24tYnV0dG9uXCIsXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkFkZCBUWVBcIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24oYWRkQnRuLCBcInBsdXNcIik7XG4gICAgYWRkQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnN0YXJ0QWRkKCkpO1xuXG4gICAgY29uc3Qgc29ydEJ0biA9IGJ1dHRvbnNDb250YWluZXIuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiBuYXYtYWN0aW9uLWJ1dHRvblwiLFxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJDaGFuZ2Ugc29ydCBvcmRlclwiIH0sXG4gICAgfSk7XG4gICAgc2V0SWNvbihzb3J0QnRuLCBcImx1Y2lkZS1zb3J0LWFzY1wiKTtcbiAgICBzb3J0QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IHRoaXMuc2hvd1NvcnRNZW51KGV2ZW50KSk7XG5cbiAgICAvLyBTZWNvbmQgY29sdW1uOiBhIGJ1dHRvbiBjeWNsaW5nIHRoZSB0aHJlZSBtb2RlcyByYXRoZXIgdGhhbiBhIG1lbnUgLVxuICAgIC8vIHdpdGggc28gZmV3IHN0YXRlcyB3aG9zZSBlZmZlY3Qgc2hvd3MgcmlnaHQgYmVsb3csIGNsaWNraW5nIHRocm91Z2ggaXNcbiAgICAvLyBmYXN0ZXIuIEljb24gYW5kIHRvb2x0aXAgc2hvdyB0aGUgY3VycmVudCBtb2RlLlxuICAgIGNvbnN0IGN1cnJlbnQgPSBTRUNPTkRBUllfTU9ERVNbdGhpcy5zZWNvbmRhcnlJbmRleCgpXTtcbiAgICBjb25zdCBzZWNvbmRhcnlCdG4gPSBidXR0b25zQ29udGFpbmVyLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gbmF2LWFjdGlvbi1idXR0b25cIixcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IGBOZXh0IHRvIG5hbWU6ICR7Y3VycmVudC50aXRsZX1gIH0sXG4gICAgfSk7XG4gICAgc2V0SWNvbihzZWNvbmRhcnlCdG4sIGN1cnJlbnQuaWNvbik7XG4gICAgc2Vjb25kYXJ5QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmN5Y2xlU2Vjb25kYXJ5KCkpO1xuICB9XG5cbiAgLy8gc2V0dGluZ3MudHlwTGlzdFNlY29uZGFyeSwgYnV0IGFsd2F5cyBhIHZhbGlkIG1vZGUgLSBvbGRlciBkYXRhIG1heSBsYWNrXG4gIC8vIHRoZSBrZXksIGFuZCBhIG1vZGUgcmVtb3ZlZCBsYXRlciBzaG91bGRuJ3QgbGVhdmUgdGhlIGxpc3QgZW1wdHkuXG4gIHNlY29uZGFyeU1vZGUoKSB7XG4gICAgY29uc3QgbW9kZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cExpc3RTZWNvbmRhcnk7XG4gICAgcmV0dXJuIFNFQ09OREFSWV9NT0RFUy5zb21lKChlbnRyeSkgPT4gZW50cnkubW9kZSA9PT0gbW9kZSkgPyBtb2RlIDogREVGQVVMVF9TRUNPTkRBUlk7XG4gIH1cblxuICBzZWNvbmRhcnlJbmRleCgpIHtcbiAgICByZXR1cm4gU0VDT05EQVJZX01PREVTLmZpbmRJbmRleCgoZW50cnkpID0+IGVudHJ5Lm1vZGUgPT09IHRoaXMuc2Vjb25kYXJ5TW9kZSgpKTtcbiAgfVxuXG4gIGFzeW5jIGN5Y2xlU2Vjb25kYXJ5KCkge1xuICAgIGNvbnN0IG5leHQgPSBTRUNPTkRBUllfTU9ERVNbKHRoaXMuc2Vjb25kYXJ5SW5kZXgoKSArIDEpICUgU0VDT05EQVJZX01PREVTLmxlbmd0aF07XG4gICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwTGlzdFNlY29uZGFyeSA9IG5leHQubW9kZTtcbiAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAvLyBPbmx5IHRoaXMgbGlzdCBjaGFuZ2VzLCBzbyBubyByZWZyZXNoVHlwQ29sb3JzKCkgYWNyb3NzIGFsbCB2aWV3cy5cbiAgICB0aGlzLnJlbmRlcigpO1xuICB9XG5cbiAgc2hvd1NvcnRNZW51KGV2ZW50KSB7XG4gICAgY29uc3QgY3VycmVudCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cFNvcnRPcmRlciA/PyBERUZBVUxUX1NPUlRfT1JERVI7XG4gICAgY29uc3QgbWVudSA9IG5ldyBNZW51KCk7XG5cbiAgICBjb25zdCBhZGRHcm91cCA9IChzdGFydCwgZW5kKSA9PiB7XG4gICAgICBmb3IgKGxldCBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgICAgICBjb25zdCB7IG1vZGUsIHRpdGxlIH0gPSBTT1JUX09QVElPTlNbaV07XG4gICAgICAgIG1lbnUuYWRkSXRlbSgoaXRlbSkgPT5cbiAgICAgICAgICBpdGVtXG4gICAgICAgICAgICAuc2V0VGl0bGUodGl0bGUpXG4gICAgICAgICAgICAuc2V0Q2hlY2tlZChjdXJyZW50ID09PSBtb2RlKVxuICAgICAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBTb3J0T3JkZXIgPSBtb2RlO1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfTtcblxuICAgIGFkZEdyb3VwKDAsIDEpO1xuICAgIG1lbnUuYWRkU2VwYXJhdG9yKCk7XG4gICAgYWRkR3JvdXAoMSwgMyk7XG4gICAgbWVudS5hZGRTZXBhcmF0b3IoKTtcbiAgICBhZGRHcm91cCgzLCA1KTtcbiAgICBtZW51LmFkZFNlcGFyYXRvcigpO1xuICAgIGFkZEdyb3VwKDUsIDcpO1xuXG4gICAgbWVudS5zaG93QXRNb3VzZUV2ZW50KGV2ZW50KTtcbiAgfVxuXG4gIHJlbmRlck5vVHlwSXRlbShjb3VudCkge1xuICAgIGNvbnN0IHRyZWVJdGVtID0gdGhpcy5saXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbVwiIH0pO1xuICAgIGNvbnN0IHNlbGYgPSB0cmVlSXRlbS5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLXNlbGYgaXMtY2xpY2thYmxlIHR5cC11bnJlZ2lzdGVyZWRcIiB9KTtcbiAgICBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0taW5uZXJcIiwgdGV4dDogXCJbTk8gVFlQXVwiIH0pO1xuICAgIHRoaXMucmVuZGVyQ291bnRGbGFpcihzZWxmLCBjb3VudCk7XG5cbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLm9wZW5TZWFyY2gobnVsbCkpO1xuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNvbnRleHRtZW51XCIsIChldmVudCkgPT4ge1xuICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgdGhpcy5vcGVuU2VhcmNoKG51bGwpO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gQ2hyb21pdW0ncyBpbnB1dFt0eXBlPWNvbG9yXSBoYXMgYSBtaW5pbXVtIHN3YXRjaCB0aGF0IHdvbid0IHNjYWxlIGJlbG93XG4gIC8vIHRleHQgc2l6ZSwgc28gaXQgaXMgb25seSBhbiBpbnZpc2libGUgdHJpZ2dlciBvdmVyIGEgZnJlZWx5IHNjYWxhYmxlIGRvdC5cbiAgLy8gV2l0aG91dCBhIGNvbG9yIHRoZSBkb3QgaXMgYSBob2xsb3cgZ3JheSByaW5nIChzZWUgcGFpbnRDb2xvckRvdCk7IHdpdGhcbiAgLy8gc2hvd1Jlc2V0IChkZXRhaWwgdmlldykgYSB0b29sdGlwIG5hbWVzIHRoZSBzdGF0ZSBhbmQgdGhlIHJlc2V0IGJ1dHRvbiBpc1xuICAvLyBncmF5ZWQgb3V0LlxuICByZW5kZXJDb2xvclBpY2tlcihwYXJlbnQsIHR5cCwgb25DaGFuZ2UsIHsgc2hvd1Jlc2V0ID0gZmFsc2UgfSA9IHt9KSB7XG4gICAgY29uc3QgY3VycmVudENvbG9yID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPz8gREVGQVVMVF9UWVBfQ09MT1I7XG4gICAgY29uc3QgY29sb3JXcmFwID0gcGFyZW50LmNyZWF0ZURpdih7IGNsczogXCJ0eXAtY29sb3Itd3JhcFwiIH0pO1xuICAgIGNvbnN0IGNvbG9yRG90ID0gY29sb3JXcmFwLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtY29sb3ItZG90XCIgfSk7XG4gICAgbGV0IHJlc2V0QnRuID0gbnVsbDtcbiAgICBjb25zdCBzaG93U3RhdGUgPSAoY29sb3IsIGlzRGVmYXVsdCkgPT4ge1xuICAgICAgcGFpbnRDb2xvckRvdChjb2xvckRvdCwgY29sb3IsIGlzRGVmYXVsdCk7XG4gICAgICBpZiAoIXNob3dSZXNldCkgcmV0dXJuO1xuICAgICAgY29sb3JXcmFwLnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgaXNEZWZhdWx0ID8gXCJEZWZhdWx0IChubyBjb2xvcilcIiA6IFwiQ2hhbmdlIGNvbG9yXCIpO1xuICAgICAgcmVzZXRCdG4/LnRvZ2dsZUNsYXNzKFwiaXMtZGlzYWJsZWRcIiwgaXNEZWZhdWx0KTtcbiAgICB9O1xuXG4gICAgY29uc3QgY29sb3JJbnB1dCA9IGNvbG9yV3JhcC5jcmVhdGVFbChcImlucHV0XCIsIHsgdHlwZTogXCJjb2xvclwiLCBjbHM6IFwidHlwLWNvbG9yLWlucHV0XCIgfSk7XG4gICAgY29sb3JJbnB1dC52YWx1ZSA9IGN1cnJlbnRDb2xvcjtcblxuICAgIC8vIFwiaW5wdXRcIiBmaXJlcyBmb3IgZXZlcnkgaW50ZXJtZWRpYXRlIGNvbG9yIHdoaWxlIHRoZSBuYXRpdmUgcGlja2VyIGlzXG4gICAgLy8gb3BlbiAtIG9ubHkgYSBsb2NhbCBwcmV2aWV3IGhlcmUuIFJlZnJlc2hpbmcgdGhlIHZpZXdzIHdvdWxkIHJlLXJlbmRlclxuICAgIC8vIHRoaXMgb25lLCByZW1vdmUgdGhpcyA8aW5wdXQgdHlwZT1jb2xvcj4gYW5kIGNsb3NlIHRoZSBuYXRpdmUgcGlja2VyXG4gICAgLy8gYmVmb3JlIGEgY29sb3IgY291bGQgZXZlbiBiZSBjaG9zZW4uXG4gICAgLy9cbiAgICAvLyBTYXZpbmcgaXMgYnVuZGxlZDogZGF0YS5qc29uIGlzIHdyaXR0ZW4gb25jZSB0aGUgcG9pbnRlciByZXN0cyBmb3IgYVxuICAgIC8vIG1vbWVudCAoc2F2ZVNvb24pIGFuZCBhdCB0aGUgbGF0ZXN0IG9uIFwiY2hhbmdlXCIsIG5vdCBvbiBldmVyeVxuICAgIC8vIGludGVybWVkaWF0ZSBjb2xvci5cbiAgICAvL1xuICAgIC8vIE9uZSB1bmRvIHNuYXBzaG90IHBlciBwaWNrZXIgc2Vzc2lvbjogdGFrZW4gYmVmb3JlIHRoZSBmaXJzdFxuICAgIC8vIGludGVybWVkaWF0ZSBjb2xvciwgb2ZmZXJlZCBvbmNlIHRoZSBjaG9pY2UgaXMgY29uZmlybWVkIChcImNoYW5nZVwiKS5cbiAgICAvLyBDbGVhcmVkIHdoZW4gdGhlIHBpY2tlciBvcGVucywgc28gYSBzZXNzaW9uIHRoYXQgZW5kZWQgd2l0aG91dCBcImNoYW5nZVwiXG4gICAgLy8gKGJhY2sgdG8gdGhlIG9sZCBjb2xvciwgb3IgY2FuY2VsbGVkKSBsZWF2ZXMgbm8gc3RhbGUgc25hcHNob3QgYmVoaW5kLlxuICAgIGNvbnN0IHNhdmVTb29uID0gZGVib3VuY2UoKCkgPT4gdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCksIDQwMCwgdHJ1ZSk7XG4gICAgbGV0IHVuZG9TbmFwc2hvdCA9IG51bGw7XG4gICAgY29sb3JJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHVuZG9TbmFwc2hvdCA9IG51bGw7XG4gICAgfSk7XG4gICAgY29sb3JJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiaW5wdXRcIiwgKCkgPT4ge1xuICAgICAgdW5kb1NuYXBzaG90ID8/PSBzbmFwc2hvdFNldHRpbmdzKHRoaXMucGx1Z2luKTtcbiAgICAgIHNob3dTdGF0ZShjb2xvcklucHV0LnZhbHVlLCBmYWxzZSk7XG4gICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdHlwXSA9IGNvbG9ySW5wdXQudmFsdWU7XG4gICAgICBvbkNoYW5nZT8uKGNvbG9ySW5wdXQudmFsdWUpO1xuICAgICAgc2F2ZVNvb24oKTtcbiAgICB9KTtcblxuICAgIC8vIE9uY2UgdGhlIGNob2ljZSBpcyBjb25maXJtZWQgYW5kIHRoZSBwaWNrZXIgY2xvc2VkLCBhIHJlLXJlbmRlciBjYW4ndFxuICAgIC8vIGJyZWFrIGFueXRoaW5nIGFueSBtb3JlLiBUaGUgcGVuZGluZyBzYXZlIGlzIGRvbmUgcmlnaHQgaGVyZSBpbnN0ZWFkIC1cbiAgICAvLyBiZWZvcmUgb2ZmZXJVbmRvKCksIHdoaWNoIHJlY29yZHMgdGhlIHNldHRpbmdzIHJldmlzaW9uIG9mIHRoaXMgc2F2ZVxuICAgIC8vIChhIGxhdGVyIGRlYm91bmNlZCBzYXZlIHdvdWxkIHZvaWQgdGhlIHVuZG8gYXQgb25jZSkuXG4gICAgY29sb3JJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIHNhdmVTb29uLmNhbmNlbCgpO1xuICAgICAgY29uc3Qgc25hcHNob3QgPSB1bmRvU25hcHNob3Q7XG4gICAgICB1bmRvU25hcHNob3QgPSBudWxsO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICBpZiAoc25hcHNob3QgJiYgc25hcHNob3QudHlwQ29sb3JzW3R5cF0gIT09IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdKSB7XG4gICAgICAgIG9mZmVyVW5kbyh0aGlzLnBsdWdpbiwgYENvbG9yIG9mICR7dHlwfSBjaGFuZ2VkLmAsIHNuYXBzaG90KTtcbiAgICAgIH1cbiAgICAgIHRoaXMucmVmcmVzaE90aGVyVmlld3MoKTtcbiAgICAgIC8vIFRoZSBTdWJ0eXAgY29sb3JzIChsaXN0IHByZXZpZXcsIGJsb2NrIGRvdHMpIGRlcml2ZSBmcm9tIHRoaXMgY29sb3IuXG4gICAgICB0aGlzLnJlbmRlcigpO1xuICAgIH0pO1xuXG4gICAgaWYgKHNob3dSZXNldCkge1xuICAgICAgcmVzZXRCdG4gPSBwYXJlbnQuY3JlYXRlRGl2KHtcbiAgICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1jb2xvci1yZXNldFwiLFxuICAgICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlJlc2V0IGNvbG9yXCIgfSxcbiAgICAgIH0pO1xuICAgICAgc2V0SWNvbihyZXNldEJ0biwgXCJyb3RhdGUtY2N3XCIpO1xuICAgICAgcmVzZXRCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgLy8gTm8gdW5kbyBvZmZlciBmb3IgYSBuby1vcCAodGhlIGJ1dHRvbiBpcyBvbmx5IGdyYXllZCBvdXQpLlxuICAgICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPT09IHVuZGVmaW5lZCkgcmV0dXJuO1xuICAgICAgICBjb25zdCBzbmFwc2hvdCA9IHNuYXBzaG90U2V0dGluZ3ModGhpcy5wbHVnaW4pO1xuICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF07XG4gICAgICAgIGNvbG9ySW5wdXQudmFsdWUgPSBERUZBVUxUX1RZUF9DT0xPUjtcbiAgICAgICAgc2hvd1N0YXRlKERFRkFVTFRfVFlQX0NPTE9SLCB0cnVlKTtcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIG9mZmVyVW5kbyh0aGlzLnBsdWdpbiwgYENvbG9yIG9mICR7dHlwfSByZXNldC5gLCBzbmFwc2hvdCk7XG4gICAgICAgIG9uQ2hhbmdlPy4oREVGQVVMVF9UWVBfQ09MT1IpO1xuICAgICAgICB0aGlzLnJlZnJlc2hPdGhlclZpZXdzKCk7XG4gICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgc2hvd1N0YXRlKGN1cnJlbnRDb2xvciwgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPT09IHVuZGVmaW5lZCk7XG5cbiAgICByZXR1cm4gY29sb3JXcmFwO1xuICB9XG5cbiAgLy8gR3VhcmRzIHNldHRpbmdzIG9iamVjdHMgbG9hZGVkIGJlZm9yZSB0eXBNYW51YWwgZXhpc3RlZCAoYSBydW5uaW5nXG4gIC8vIHNlc3Npb24gYWNyb3NzIGEgaG90IHJlbG9hZCwgc2F5KSAtIG90aGVyd2lzZSBldmVyeSBhY2Nlc3MgYmVsb3cgd291bGRcbiAgLy8gdGhyb3cgYW5kIHRha2UgdGhlIHJlc3Qgb2YgcmVuZGVyVHlwU2V0dGluZ3MoKSBkb3duIHdpdGggaXQuXG4gIGVuc3VyZVR5cE1hbnVhbCgpIHtcbiAgICBpZiAoIXRoaXMucGx1Z2luLnNldHRpbmdzLnR5cE1hbnVhbCkgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwTWFudWFsID0ge307XG4gICAgcmV0dXJuIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cE1hbnVhbDtcbiAgfVxuXG4gIC8vIFRoZSBzaGFyZWQgXCJNYW51YWxseSBjcmVhdGFibGVcIiBidXR0b24gb2YgVFlQIChyZW5kZXJNYW51YWxUb2dnbGUpIGFuZFxuICAvLyBTdWJ0eXAgKHJlbmRlclN1YnR5cE1hbnVhbFRvZ2dsZSksIGVhY2ggYmV0d2VlbiByZW5hbWUgYW5kIGRlbGV0ZS4gQW5cbiAgLy8gaWNvbiBidXR0b24gcmF0aGVyIHRoYW4gYSBsYWJlbGVkIHRvZ2dsZSAtIHRvbyBzbWFsbCBhIHNldHRpbmcgZm9yIGl0cyBvd25cbiAgLy8gcm93LiBTdGF0ZSB2aWEgYSBjbGFzcyAoaXMtYWN0aXZlLCBzZWUgc3R5bGVzLmNzcyksIG1lYW5pbmcgaW4gdGhlIHRvb2x0aXA7XG4gIC8vIHJvbGUvYXJpYS1jaGVja2VkIGtlZXAgaXQgcmVhZGFibGUgYXMgYSBzd2l0Y2guXG4gIC8vXG4gIC8vIG9uVG9nZ2xlIGdldHMgdGhlIG5ldyBzdGF0ZSwgc2F2ZXMgaXQgYW5kIHVwZGF0ZXMgdGhlIGRlcGVuZGVudCBidXR0b25zXG4gIC8vIChzZWUgc3luY01hbnVhbFRvZ2dsZXMpIC0gdGhlIGNsaWNrIGRvZXNuJ3QgcGFpbnQgaXRzZWxmLCBzaW5jZSBhIHRvZ2dsZVxuICAvLyBoZXJlIG5ldmVyIGFmZmVjdHMganVzdCB0aGlzIG9uZSBidXR0b24uXG4gIHJlbmRlck1hbnVhbEljb24ocGFyZW50LCBjbHMsIGlzT24sIG9uVG9nZ2xlKSB7XG4gICAgY29uc3QgYnRuID0gcGFyZW50LmNyZWF0ZURpdih7XG4gICAgICBjbHM6IGBjbGlja2FibGUtaWNvbiB0eXAtbWFudWFsLWljb24gJHtjbHN9YCxcbiAgICAgIGF0dHI6IHsgdGFiaW5kZXg6IFwiMFwiLCByb2xlOiBcImNoZWNrYm94XCIgfSxcbiAgICB9KTtcbiAgICBzZXRJY29uKGJ0biwgXCJmaWxlLXBlbi1saW5lXCIpO1xuXG4gICAgYnRuLnR5cFNob3dNYW51YWxTdGF0ZSA9IChvbikgPT4ge1xuICAgICAgYnRuLnRvZ2dsZUNsYXNzKFwiaXMtYWN0aXZlXCIsIG9uKTtcbiAgICAgIGJ0bi5zZXRBdHRyaWJ1dGUoXCJhcmlhLWNoZWNrZWRcIiwgU3RyaW5nKG9uKSk7XG4gICAgICBidG4uc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCBvbiA/IFwiTWFudWFsbHkgY3JlYXRhYmxlXCIgOiBcIk5vdCBtYW51YWxseSBjcmVhdGFibGVcIik7XG4gICAgfTtcbiAgICBidG4udHlwU2hvd01hbnVhbFN0YXRlKGlzT24pO1xuXG4gICAgY29uc3QgdG9nZ2xlID0gKCkgPT4gb25Ub2dnbGUoIWJ0bi5oYXNDbGFzcyhcImlzLWFjdGl2ZVwiKSk7XG4gICAgYnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCB0b2dnbGUpO1xuICAgIGJ0bi5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRW50ZXJcIiB8fCBldmVudC5rZXkgPT09IFwiIFwiKSB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIHRvZ2dsZSgpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGJ0bjtcbiAgfVxuXG4gIC8vIFRoZSBUWVAncyBcIk1hbnVhbGx5IGNyZWF0YWJsZVwiLCBpbiB0aGUgZGV0YWlsIGhlYWRlciBiZXR3ZWVuIHJlbmFtZSBhbmRcbiAgLy8gZGVsZXRlLiBPbiBieSBkZWZhdWx0LCBzbyBvbmx5IFwib2ZmXCIgKGZhbHNlKSBpcyBzdG9yZWQuIERlY2lkZXMgd2hldGhlclxuICAvLyBnZXRUeXBzKCkgKG1haW4uanMpIHJldHVybnMgdGhlIFRZUC5cbiAgLy9cbiAgLy8gVGhlIFRZUCBhbHdheXMgdGFrZXMgaXRzIFN1YnR5cHMgYWxvbmc6IHRoZSBwaWNrZXIgb25seSByZWFjaGVzIHRoZW1cbiAgLy8gdGhyb3VnaCBpdCwgc28gYSBUWVAgc3dpdGNoZWQgb2ZmIHdvdWxkIHNpbGVudGx5IG1ha2UgdGhlbSB1bnJlYWNoYWJsZVxuICAvLyAoc2VlIHNldEFsbFN1YnR5cHNNYW51YWwgaW4gc3VidHlwcy5qcykuXG4gIHJlbmRlck1hbnVhbFRvZ2dsZShwYXJlbnQsIHR5cCkge1xuICAgIHJldHVybiB0aGlzLnJlbmRlck1hbnVhbEljb24ocGFyZW50LCBcInR5cC1tYW51YWwtdHlwXCIsIHRoaXMuZW5zdXJlVHlwTWFudWFsKClbdHlwXSAhPT0gZmFsc2UsIGFzeW5jIChvbikgPT4ge1xuICAgICAgaWYgKG9uKSBkZWxldGUgdGhpcy5lbnN1cmVUeXBNYW51YWwoKVt0eXBdO1xuICAgICAgZWxzZSB0aGlzLmVuc3VyZVR5cE1hbnVhbCgpW3R5cF0gPSBmYWxzZTtcbiAgICAgIHNldEFsbFN1YnR5cHNNYW51YWwodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgb24pO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICB0aGlzLnN5bmNNYW51YWxUb2dnbGVzKHR5cCk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBBIFN1YnR5cCdzIFwiTWFudWFsbHkgY3JlYXRhYmxlXCIsIGluIGl0cyBibG9jayBmb290ZXIgYmV0d2VlbiByZW5hbWUgYW5kXG4gIC8vIGRlbGV0ZSAoc2VlIHJlbmRlclNlY3Rpb25Gb290ZXIpLiBVbmxpa2UgdGhlIFRZUCBidXR0b24gaXQgcHVsbHMgb25seSBvbmVcbiAgLy8gd2F5OiBzd2l0Y2hpbmcgYSBTdWJ0eXAgb24gYWxzbyBzd2l0Y2hlcyBpdHMgVFlQIG9uIChlbHNlIGl0IHdvdWxkIGJlXG4gIC8vIHVucmVhY2hhYmxlKSwgdGhlIG90aGVyIFN1YnR5cHMgc3RheSBhcyB0aGV5IGFyZSAtIHRoYXQgaXMgdGhlIHBvaW50LlxuICByZW5kZXJTdWJ0eXBNYW51YWxUb2dnbGUocGFyZW50LCB0eXAsIHN1YnR5cCkge1xuICAgIGNvbnN0IGJ0biA9IHRoaXMucmVuZGVyTWFudWFsSWNvbihcbiAgICAgIHBhcmVudCxcbiAgICAgIFwidHlwLW1hbnVhbC1zdWJ0eXBcIixcbiAgICAgIGlzU3VidHlwTWFudWFsKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCksXG4gICAgICBhc3luYyAob24pID0+IHtcbiAgICAgICAgc2V0U3VidHlwTWFudWFsKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCwgb24pO1xuICAgICAgICBpZiAob24pIGRlbGV0ZSB0aGlzLmVuc3VyZVR5cE1hbnVhbCgpW3R5cF07XG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB0aGlzLnN5bmNNYW51YWxUb2dnbGVzKHR5cCk7XG4gICAgICB9XG4gICAgKTtcbiAgICBidG4udHlwU3VidHlwID0gc3VidHlwO1xuICAgIHJldHVybiBidG47XG4gIH1cblxuICAvLyBSZXBhaW50cyBldmVyeSBtYW51YWwgYnV0dG9uIG9mIHRoZSBkZXRhaWwgdmlldyBhZnRlciBvbmUgY2hhbmdlZCB0aGVcbiAgLy8gb3RoZXJzLiBPbmx5IHRoZSBidXR0b25zLCBub3QgcmVuZGVyKCk6IGEgcmVidWlsZCB3b3VsZCByZWNyZWF0ZSBldmVyeVxuICAvLyBibG9jaydzIGVkaXRvcnMsIGluY2x1ZGluZyBhIHJvdyBiZWluZyBlZGl0ZWQuIEZvdW5kIHZpYSB0aGUgRE9NIGxpa2UgdGhlXG4gIC8vIFN1YnR5cCBjb2xvciBkb3RzIC0gZnJvbnRtYXR0ZXItYmxvY2tzLmpzIGJ1aWxkcyB0aGUgZm9vdGVycywgbm8gbGlzdCBvZlxuICAvLyB0aGVtIGxpdmVzIGhlcmUuXG4gIHN5bmNNYW51YWxUb2dnbGVzKHR5cCkge1xuICAgIHRoaXMuY29udGVudEVsLnF1ZXJ5U2VsZWN0b3IoXCIudHlwLW1hbnVhbC10eXBcIik/LnR5cFNob3dNYW51YWxTdGF0ZSh0aGlzLmVuc3VyZVR5cE1hbnVhbCgpW3R5cF0gIT09IGZhbHNlKTtcbiAgICBmb3IgKGNvbnN0IGVsIG9mIHRoaXMuY29udGVudEVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIudHlwLW1hbnVhbC1zdWJ0eXBcIikpIHtcbiAgICAgIGVsLnR5cFNob3dNYW51YWxTdGF0ZShpc1N1YnR5cE1hbnVhbCh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBlbC50eXBTdWJ0eXApKTtcbiAgICB9XG4gIH1cblxuICByZW5kZXJSZWdpc3RlcmVkSXRlbSh0eXAsIGNvdW50LCB7IGRyYWdnYWJsZSA9IGZhbHNlLCBpbmRleCA9IC0xIH0gPSB7fSkge1xuICAgIGNvbnN0IHRyZWVJdGVtID0gdGhpcy5saXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbVwiIH0pO1xuICAgIGNvbnN0IHNlbGYgPSB0cmVlSXRlbS5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLXNlbGYgaXMtY2xpY2thYmxlXCIgfSk7XG5cbiAgICBsZXQgbmFtZUVsO1xuICAgIHRoaXMucmVuZGVyQ29sb3JQaWNrZXIoc2VsZiwgdHlwLCAobmV3Q29sb3IpID0+IHtcbiAgICAgIGlmIChuYW1lRWwgJiYgdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0KSBuYW1lRWwuc3R5bGUuY29sb3IgPSBuZXdDb2xvcjtcbiAgICB9KTtcblxuICAgIG5hbWVFbCA9IHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1pbm5lclwiLCB0ZXh0OiB0eXAgfSk7XG4gICAgY29uc3QgY29sb3IgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3QgPyB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdHlwXSA6IG51bGw7XG4gICAgaWYgKGNvbG9yKSBuYW1lRWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcblxuICAgIC8vIFNlY29uZCBjb2x1bW4sIGN5Y2xlZCBieSB0aGUgaGVhZGVyIGJ1dHRvbiAoc2VlIFNFQ09OREFSWV9NT0RFUykuXG4gICAgY29uc3Qgc2Vjb25kYXJ5ID0gdGhpcy5zZWNvbmRhcnlNb2RlKCk7XG4gICAgaWYgKHNlY29uZGFyeSA9PT0gXCJkZXNjcmlwdGlvblwiKSB0aGlzLnJlbmRlckRlc2NyaXB0aW9uSW5wdXQoc2VsZiwgdHlwKTtcbiAgICBlbHNlIGlmIChzZWNvbmRhcnkgPT09IFwic3VidHlwc1wiKSB0aGlzLnJlbmRlclN1YnR5cFByZXZpZXcoc2VsZiwgdHlwKTtcblxuICAgIHRoaXMucmVuZGVyQ291bnRGbGFpcihzZWxmLCBjb3VudCk7XG5cbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5pc0VkaXRpbmcpIHJldHVybjtcbiAgICAgIHRoaXMub3BlblR5cFNldHRpbmdzKHR5cCk7XG4gICAgfSk7XG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY29udGV4dG1lbnVcIiwgKGV2ZW50KSA9PiB7XG4gICAgICAvLyBXaGlsZSByZW5hbWluZywgdGhlIHRleHQgZmllbGQncyBvd24gbWVudSAoY29weSwgcGFzdGUpIGFwcGxpZXMuXG4gICAgICBpZiAodGhpcy5pc0VkaXRpbmcpIHJldHVybjtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHRoaXMuc2hvd1R5cE1lbnUoZXZlbnQsIHR5cCwgc2VsZiwgbmFtZUVsKTtcbiAgICB9KTtcblxuICAgIC8vIE9ubHkgaW4gbWFudWFsIHNvcnQgbW9kZSAoc2VlIHJlbmRlcigpKTogdGhlIHdob2xlIHJvdyBjYW4gYmUgZHJhZ2dlZFxuICAgIC8vIChhIGRyYWcgc3RhcnRpbmcgb24gdGhlIGRvdCBvciBpbiB0aGUgZGVzY3JpcHRpb24gZmllbGQgZG9lc24ndCBjb3VudCAtXG4gICAgLy8gdGhvc2UgdGFrZSB0aGUgbW91c2Vkb3duIHRoZW1zZWx2ZXMpLiBNb3ZlcyBlbnRyaWVzIGluIHNldHRpbmdzLnR5cHMsXG4gICAgLy8gdGhlIGxpc3QgdGhhdCBpcyB0aGUgZGlzcGxheSBvcmRlciBpbiBtYW51YWwgbW9kZS5cbiAgICBpZiAoZHJhZ2dhYmxlKSB7XG4gICAgICBzZWxmLmRyYWdnYWJsZSA9IHRydWU7XG4gICAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnc3RhcnRcIiwgKGV2ZW50KSA9PiB7XG4gICAgICAgIGV2ZW50LmRhdGFUcmFuc2Zlci5lZmZlY3RBbGxvd2VkID0gXCJtb3ZlXCI7XG4gICAgICAgIGV2ZW50LmRhdGFUcmFuc2Zlci5zZXREYXRhKFwidGV4dC9wbGFpblwiLCBTdHJpbmcoaW5kZXgpKTtcbiAgICAgICAgc2VsZi5jbGFzc0xpc3QuYWRkKFwiaXMtZHJhZ2dpbmdcIik7XG4gICAgICB9KTtcbiAgICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdlbmRcIiwgKCkgPT4gc2VsZi5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJhZ2dpbmdcIikpO1xuICAgICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ292ZXJcIiwgKGV2ZW50KSA9PiB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGNvbnN0IHJlY3QgPSBzZWxmLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgICBjb25zdCBpc0FmdGVyID0gZXZlbnQuY2xpZW50WSAtIHJlY3QudG9wID4gcmVjdC5oZWlnaHQgLyAyO1xuICAgICAgICBzZWxmLmNsYXNzTGlzdC50b2dnbGUoXCJpcy1kcm9wLWJlZm9yZVwiLCAhaXNBZnRlcik7XG4gICAgICAgIHNlbGYuY2xhc3NMaXN0LnRvZ2dsZShcImlzLWRyb3AtYWZ0ZXJcIiwgaXNBZnRlcik7XG4gICAgICB9KTtcbiAgICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdsZWF2ZVwiLCAoKSA9PiBzZWxmLmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcm9wLWJlZm9yZVwiLCBcImlzLWRyb3AtYWZ0ZXJcIikpO1xuICAgICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiZHJvcFwiLCBhc3luYyAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgY29uc3QgaXNBZnRlciA9IHNlbGYuY2xhc3NMaXN0LmNvbnRhaW5zKFwiaXMtZHJvcC1hZnRlclwiKTtcbiAgICAgICAgc2VsZi5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJvcC1iZWZvcmVcIiwgXCJpcy1kcm9wLWFmdGVyXCIpO1xuXG4gICAgICAgIGNvbnN0IGZyb21JbmRleCA9IE51bWJlcihldmVudC5kYXRhVHJhbnNmZXIuZ2V0RGF0YShcInRleHQvcGxhaW5cIikpO1xuICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKGZyb21JbmRleCkgfHwgZnJvbUluZGV4ID09PSBpbmRleCkgcmV0dXJuO1xuXG4gICAgICAgIGxldCBpbnNlcnRCZWZvcmUgPSBpc0FmdGVyID8gaW5kZXggKyAxIDogaW5kZXg7XG4gICAgICAgIGlmIChmcm9tSW5kZXggPCBpbnNlcnRCZWZvcmUpIGluc2VydEJlZm9yZSAtPSAxO1xuXG4gICAgICAgIGNvbnN0IHR5cHMgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBzO1xuICAgICAgICBjb25zdCBbbW92ZWRdID0gdHlwcy5zcGxpY2UoZnJvbUluZGV4LCAxKTtcbiAgICAgICAgdHlwcy5zcGxpY2UoaW5zZXJ0QmVmb3JlLCAwLCBtb3ZlZCk7XG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB0aGlzLnJlbmRlcigpO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgLy8gUmlnaHQtY2xpY2sgb24gYSByZWdpc3RlcmVkIFRZUDogdGhlIGFjdGlvbnMgb2YgdGhlIGRldGFpbCBoZWFkZXIgcGx1c1xuICAvLyBzZWFyY2gsIEJhc2UgYW5kIHNvcnRpbmcsIHdpdGhvdXQgb3BlbmluZyB0aGUgZGV0YWlsIHZpZXcuIFwiTWFudWFsbHlcbiAgLy8gY3JlYXRhYmxlXCIgc3RheXMgaW4gdGhlIGRldGFpbCB2aWV3IC0gYSBzdGF0ZSwgbm90IGFuIGFjdGlvbi4gVGhlIHJvd3NcbiAgLy8gYmVsb3cgdGhlIHNlcGFyYXRvciBrZWVwIHJpZ2h0LWNsaWNrID0gc2VhcmNoOiB0aGV5IGhhdmUgbm8gc2V0dGluZ3MgdG9cbiAgLy8gYWN0IG9uLlxuICBzaG93VHlwTWVudShldmVudCwgdHlwLCBzZWxmLCBuYW1lRWwpIHtcbiAgICBjb25zdCBtZW51ID0gbmV3IE1lbnUoKTtcbiAgICBtZW51LmFkZEl0ZW0oKGl0ZW0pID0+IGl0ZW0uc2V0VGl0bGUoXCJTZWFyY2ggbm90ZXNcIikuc2V0SWNvbihcInNlYXJjaFwiKS5vbkNsaWNrKCgpID0+IHRoaXMub3BlblNlYXJjaCh0eXApKSk7XG4gICAgbWVudS5hZGRTZXBhcmF0b3IoKTtcbiAgICBtZW51LmFkZEl0ZW0oKGl0ZW0pID0+XG4gICAgICBpdGVtXG4gICAgICAgIC5zZXRUaXRsZShcIlJlbmFtZVwiKVxuICAgICAgICAuc2V0SWNvbihcInBlbmNpbFwiKVxuICAgICAgICAub25DbGljaygoKSA9PiB0aGlzLnN0YXJ0TGlzdFJlbmFtZSh0eXAsIHNlbGYsIG5hbWVFbCkpXG4gICAgKTtcbiAgICBtZW51LmFkZEl0ZW0oKGl0ZW0pID0+XG4gICAgICBpdGVtXG4gICAgICAgIC5zZXRUaXRsZShcIlJlbmFtZSBhbmQgdXBkYXRlIG5vdGVzXCIpXG4gICAgICAgIC5zZXRJY29uKFwicGVuY2lsXCIpXG4gICAgICAgIC5vbkNsaWNrKCgpID0+IHRoaXMuc3RhcnRMaXN0UmVuYW1lKHR5cCwgc2VsZiwgbmFtZUVsLCB7IHVwZGF0ZU5vdGVzOiB0cnVlIH0pKVxuICAgICk7XG4gICAgbWVudS5hZGRJdGVtKChpdGVtKSA9PlxuICAgICAgaXRlbVxuICAgICAgICAuc2V0VGl0bGUoXCJEZWxldGVcIilcbiAgICAgICAgLnNldEljb24oXCJ0cmFzaFwiKVxuICAgICAgICAuc2V0V2FybmluZyh0cnVlKVxuICAgICAgICAub25DbGljaygoKSA9PiB0aGlzLnNob3dEZWxldGVDb25maXJtKHR5cCkpXG4gICAgKTtcbiAgICBtZW51LmFkZFNlcGFyYXRvcigpO1xuICAgIC8vIExpa2UgdGhlIGNvbW1hbmQ6IHdpdGhvdXQgdGhlIEJhc2VzIGNvcmUgcGx1Z2luIHRoZSBmaWxlIGNvdWxkbid0IGJlXG4gICAgLy8gb3BlbmVkLlxuICAgIGlmIChpc0Jhc2VzRW5hYmxlZCh0aGlzLmFwcCkpIHtcbiAgICAgIG1lbnUuYWRkSXRlbSgoaXRlbSkgPT5cbiAgICAgICAgaXRlbVxuICAgICAgICAgIC5zZXRUaXRsZShcIkNyZWF0ZSBCYXNlXCIpXG4gICAgICAgICAgLnNldEljb24oXCJ0YWJsZVwiKVxuICAgICAgICAgIC5vbkNsaWNrKHJ1bk9yUmVwb3J0RXJyb3IoXCJDcmVhdGUgQmFzZVwiLCAoKSA9PiBjcmVhdGVCYXNlRm9yKHRoaXMucGx1Z2luLCB7IHR5cCwgc3VidHlwOiBudWxsIH0pKSlcbiAgICAgICk7XG4gICAgfVxuICAgIG1lbnUuYWRkSXRlbSgoaXRlbSkgPT5cbiAgICAgIGl0ZW1cbiAgICAgICAgLnNldFRpdGxlKFwiU29ydCBmcm9udG1hdHRlciBmb3IgdGhpcyBUWVBcIilcbiAgICAgICAgLnNldEljb24oXCJhcnJvdy1kb3duLXVwXCIpXG4gICAgICAgIC5vbkNsaWNrKHJ1bk9yUmVwb3J0RXJyb3IoXCJGcm9udG1hdHRlciBzb3J0aW5nXCIsICgpID0+IHNvcnRUeXBGcm9udG1hdHRlcih0aGlzLnBsdWdpbiwgdHlwKSkpXG4gICAgKTtcbiAgICBtZW51LnNob3dBdE1vdXNlRXZlbnQoZXZlbnQpO1xuICB9XG5cbiAgLy8gQSByZWFsIGlucHV0LCBzbyB0aGUgZGVzY3JpcHRpb24gY2FuIGJlIGVkaXRlZCByaWdodCBpbiB0aGUgbGlzdC4gSXRzXG4gIC8vIGNsaWNrIG11c3QgTk9UIHRyaWdnZXIgdGhlIHJvdyAod2hpY2ggd291bGQgb3BlbiB0aGUgZGV0YWlsIHZpZXcpLlxuICByZW5kZXJEZXNjcmlwdGlvbklucHV0KHNlbGYsIHR5cCkge1xuICAgIGNvbnN0IGRlc2NJbnB1dCA9IHNlbGYuY3JlYXRlRWwoXCJpbnB1dFwiLCB7XG4gICAgICB0eXBlOiBcInRleHRcIixcbiAgICAgIGNsczogXCJ0eXAtbGlzdC1kZXNjcmlwdGlvbi1pbnB1dFwiLFxuICAgIH0pO1xuICAgIGRlc2NJbnB1dC52YWx1ZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlc2NyaXB0aW9uc1t0eXBdID8/IFwiXCI7XG4gICAgZGVzY0lucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpKTtcbiAgICBkZXNjSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB2YWx1ZSA9IGRlc2NJbnB1dC52YWx1ZS50cmltKCk7XG4gICAgICBpZiAodmFsdWUpIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlc2NyaXB0aW9uc1t0eXBdID0gdmFsdWU7XG4gICAgICBlbHNlIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBEZXNjcmlwdGlvbnNbdHlwXTtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gXCIoU3VidHlwIDEsIFN1YnR5cCAyKVwiIGluc3RlYWQgb2YgdGhlIGRlc2NyaXB0aW9uIC0gdGhlIHNhbWUgbG9vayBhcyB0aGVcbiAgLy8gcHJldmlldyBpbiB0aGUgc2VwYXJhdGUgVFlQLVBpY2tlciAoc2hhcmVkIG5hbWVDb2xvciBpbiB0eXAtY29sb3JzLmpzKTpcbiAgLy8gYnJhY2tldHMgYW5kIGNvbW1hcyBtdXRlZCwgZWFjaCBuYW1lIGluIGl0cyBTdWJ0eXAgY29sb3IuIE9ubHkgcmVnaXN0ZXJlZFxuICAvLyBTdWJ0eXBzIGFuZCBubyBjb3VudHMgLSB1bnJlZ2lzdGVyZWQgdmFsdWVzIGhhdmUgbm8gY29sb3IsIGFuZCBjb3VudHNcbiAgLy8gd291bGQgbWFrZSB0aGUgcm93IHVucmVhZGFibGUuIERpc3BsYXkgb25seTsgY2xpY2sgYW5kIHJpZ2h0LWNsaWNrIGJlbG9uZ1xuICAvLyB0byB0aGUgcm93LiBMZWZ0IG9yIHJpZ2h0IGFsaWdubWVudCBpcyBhIFN0eWxlIFNldHRpbmdzIGJvZHkgY2xhc3MgKHNlZVxuICAvLyBAc2V0dGluZ3MgYW5kIC50eXAtbGlzdC1zdWJ0eXBzIGluIHN0eWxlcy5jc3MpOyB0aGUgbWFya3VwIGlzIHRoZSBzYW1lLlxuICByZW5kZXJTdWJ0eXBQcmV2aWV3KHNlbGYsIHR5cCkge1xuICAgIGNvbnN0IHN1YnR5cHMgPSBnZXRTdWJ0eXBOYW1lcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwKTtcbiAgICBpZiAoc3VidHlwcy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgIGNvbnN0IGNvbG9yaXplID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0O1xuICAgIGNvbnN0IHdyYXAgPSBzZWxmLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLWxpc3Qtc3VidHlwc1wiIH0pO1xuICAgIHdyYXAuYXBwZW5kVGV4dChcIihcIik7XG4gICAgc3VidHlwcy5mb3JFYWNoKChzdWJ0eXAsIGluZGV4KSA9PiB7XG4gICAgICBpZiAoaW5kZXggPiAwKSB3cmFwLmFwcGVuZFRleHQoXCIsIFwiKTtcbiAgICAgIGNvbnN0IHNwYW4gPSB3cmFwLmNyZWF0ZVNwYW4oeyB0ZXh0OiBzdWJ0eXAgfSk7XG4gICAgICBpZiAoY29sb3JpemUpIHNwYW4uc3R5bGUuY29sb3IgPSBuYW1lQ29sb3IodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKS5jb2xvcjtcbiAgICB9KTtcbiAgICB3cmFwLmFwcGVuZFRleHQoXCIpXCIpO1xuICB9XG5cbiAgcmVuZGVyVW5yZWdpc3RlcmVkSXRlbSh0eXAsIGNvdW50KSB7XG4gICAgY29uc3QgdHJlZUl0ZW0gPSB0aGlzLmxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtXCIgfSk7XG4gICAgY29uc3Qgc2VsZiA9IHRyZWVJdGVtLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0tc2VsZiBpcy1jbGlja2FibGUgdHlwLXVucmVnaXN0ZXJlZFwiIH0pO1xuICAgIHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1pbm5lclwiLCB0ZXh0OiBkaXNwbGF5VHlwS2V5KHR5cCkgfSk7XG4gICAgdGhpcy5yZW5kZXJDb3VudEZsYWlyKHNlbGYsIGNvdW50KTtcblxuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMucmVnaXN0ZXJUeXAodHlwKSk7XG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY29udGV4dG1lbnVcIiwgKGV2ZW50KSA9PiB7XG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICB0aGlzLm9wZW5TZWFyY2godHlwKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIEV2ZXJ5IFNVQlRZUCB2YWx1ZSB0aGF0IG9jY3VycyBpbiBub3RlcyBidXQgaXNuJ3QgcmVnaXN0ZXJlZCB1bmRlciBpdHMgVFlQXG4gIC8vIC0gYWNyb3NzIHRoZSB2YXVsdCwgdW5saWtlIHJlbmRlclVucmVnaXN0ZXJlZFN1YnR5cHMoKSBpbiB0aGUgZGV0YWlsIHZpZXcuXG4gIC8vIFRoZSBpbmRleCBrZWVwcyBidWNrZXRzIGZvciBBTEwgVFlQIGtleXMsIHVucmVnaXN0ZXJlZCBvbmVzIGluY2x1ZGVkLCBzb1xuICAvLyB0aGVpciBTdWJ0eXBzIGNvbWUgYWxvbmcgKGEgY2xpY2sgdGhlbiByZWdpc3RlcnMgYm90aCwgc2VlXG4gIC8vIHJlZ2lzdGVyVHlwV2l0aFN1YnR5cCkuXG4gIC8vXG4gIC8vIFNvcnRlZCBieSBjb3VudCwgdGhlbiBieSByb3cgdGV4dCAoVFlQLCB0aGVuIFN1YnR5cCkgLSBsaWtlIHRoZSBkZXRhaWxcbiAgLy8gdmlldy4gRGVsaWJlcmF0ZWx5IE5PVCBieSB0aGUgbGlzdCdzIHNvcnQgYnV0dG9uOiBcImNvbG9yXCIgYW5kIFwibWFudWFsXCJcbiAgLy8gbWVhbiBub3RoaW5nIGZvciB1bnJlZ2lzdGVyZWQgdmFsdWVzLlxuICAvL1xuICAvLyBBIG5vdGUgd2l0aG91dCBhIFRZUCBpcyBsZWZ0IG91dDogdGhlIGluZGV4IGRyb3BzIGl0cyBTVUJUWVAgYWxyZWFkeSAoc2VlXG4gIC8vIGFnZ3JlZ2F0ZSgpIGluIHR5cC1pbmRleC5qcyksIGEgU1VCVFlQIHdpdGhvdXQgYSBUWVAgaGFzIG5vIGNvbnRleHQuXG4gIHVucmVnaXN0ZXJlZFN1YnR5cFJvd3MoKSB7XG4gICAgY29uc3QgcmVnaXN0ZXJlZCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cHM7XG4gICAgY29uc3Qgcm93cyA9IFtdO1xuICAgIGZvciAoY29uc3QgW3R5cCwgYnVja2V0XSBvZiB0aGlzLnBsdWdpbi50eXBJbmRleC5zdWJ0eXBDb3VudHMoKSkge1xuICAgICAgY29uc3Qga25vd24gPSBnZXRTdWJ0eXBOYW1lcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwKTtcbiAgICAgIGZvciAoY29uc3QgW3N1YnR5cCwgY291bnRdIG9mIGJ1Y2tldC5jb3VudHMpIHtcbiAgICAgICAgaWYgKGtub3duLmluY2x1ZGVzKHN1YnR5cCkpIGNvbnRpbnVlO1xuICAgICAgICByb3dzLnB1c2goeyB0eXAsIHN1YnR5cCwgY291bnQsIHR5cFJlZ2lzdGVyZWQ6IHJlZ2lzdGVyZWQuaW5jbHVkZXModHlwKSB9KTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJvd3Muc29ydCgoYSwgYikgPT4gYi5jb3VudCAtIGEuY291bnQgfHwgYS50eXAubG9jYWxlQ29tcGFyZShiLnR5cCkgfHwgYS5zdWJ0eXAubG9jYWxlQ29tcGFyZShiLnN1YnR5cCkpO1xuICB9XG5cbiAgLy8gXCJOT1RJWiAvIEt1cnogR2VzY2hpY2h0ZVwiIC0gdGhlIFN1YnR5cCBhbG9uZSB3b3VsZCBiZSBhbWJpZ3VvdXMsIHRoZSBzYW1lXG4gIC8vIG5hbWUgY2FuIGV4aXN0IHVuZGVyIHNldmVyYWwgVFlQIGVudHJpZXMuIElmIHRoZSBUWVAgaXMgcmVnaXN0ZXJlZCwgaXRzXG4gIC8vIHBhcnQgY2FycmllcyBpdHMgY29sb3IgKG9yIGEgZG90LCBkZXBlbmRpbmcgb24gXCJUWVAtUGFuZVwiIGNvbG9yaW5nKSxcbiAgLy8gdG9uZWQgZG93biBieSB0aGUgU3R5bGUgU2V0dGluZyBcIkNvbG9yIGluIHVucmVnaXN0ZXJlZCBTdWJ0eXAgcm93c1wiIHNvXG4gIC8vIHRoZXNlIHJvd3Mgc3RheSBiZWhpbmQgdGhlIHJlZ2lzdGVyZWQgZW50cmllcyBhYm92ZS4gSWYgdGhlIFRZUCBpc24ndFxuICAvLyByZWdpc3RlcmVkIGVpdGhlciwgdGhlIHdob2xlIHJvdyBpcyBtdXRlZCBsaWtlIHRoZSBlbnRyaWVzIGFib3ZlIGl0LlxuICByZW5kZXJVbnJlZ2lzdGVyZWRTdWJ0eXBJdGVtKHsgdHlwLCBzdWJ0eXAsIGNvdW50LCB0eXBSZWdpc3RlcmVkIH0pIHtcbiAgICBjb25zdCB0cmVlSXRlbSA9IHRoaXMubGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW1cIiB9KTtcbiAgICBjb25zdCBzZWxmID0gdHJlZUl0ZW0uY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1zZWxmIGlzLWNsaWNrYWJsZSB0eXAtdW5yZWdpc3RlcmVkXCIgfSk7XG5cbiAgICBjb25zdCBjb2xvcml6ZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdDtcbiAgICBjb25zdCB7IGNvbG9yLCBpc0RlZmF1bHQgfSA9IG5hbWVDb2xvcih0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwKTtcbiAgICBpZiAodHlwUmVnaXN0ZXJlZCAmJiAhY29sb3JpemUpIHtcbiAgICAgIGNvbnN0IHdyYXAgPSBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtY29sb3Itd3JhcCB0eXAtdW5yZWdpc3RlcmVkLXN1YnR5cC1jb2xvclwiIH0pO1xuICAgICAgcGFpbnRDb2xvckRvdCh3cmFwLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtY29sb3ItZG90XCIgfSksIGNvbG9yLCBpc0RlZmF1bHQpO1xuICAgIH1cblxuICAgIGNvbnN0IGlubmVyID0gc2VsZi5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLWlubmVyXCIgfSk7XG4gICAgY29uc3QgdHlwRWwgPSBpbm5lci5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC11bnJlZ2lzdGVyZWQtc3VidHlwLXR5cFwiLCB0ZXh0OiBkaXNwbGF5VHlwS2V5KHR5cCkgfSk7XG4gICAgaWYgKHR5cFJlZ2lzdGVyZWQgJiYgY29sb3JpemUgJiYgIWlzRGVmYXVsdCkge1xuICAgICAgdHlwRWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcbiAgICAgIHR5cEVsLmFkZENsYXNzKFwidHlwLXVucmVnaXN0ZXJlZC1zdWJ0eXAtY29sb3JcIik7XG4gICAgfVxuICAgIGlubmVyLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXVucmVnaXN0ZXJlZC1zdWJ0eXAtc2xhc2hcIiwgdGV4dDogXCIgLyBcIiB9KTtcbiAgICBpbm5lci5jcmVhdGVTcGFuKHsgdGV4dDogZGlzcGxheVR5cEtleShzdWJ0eXApIH0pO1xuXG4gICAgdGhpcy5yZW5kZXJDb3VudEZsYWlyKHNlbGYsIGNvdW50KTtcblxuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMucmVnaXN0ZXJUeXBXaXRoU3VidHlwKHR5cCwgc3VidHlwKSk7XG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY29udGV4dG1lbnVcIiwgKGV2ZW50KSA9PiB7XG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICB0aGlzLm9wZW5TdWJ0eXBTZWFyY2godHlwLCBzdWJ0eXApO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gQ2xpY2tpbmcgc3VjaCBhIHJvdyByZWdpc3RlcnMgdGhlIFN1YnR5cCBhbmQsIGlmIG5lZWRlZCwgaXRzIFRZUC4gVFlQXG4gIC8vIGZpcnN0LCB0aGVuIFN1YnR5cCAtIG5lY2Vzc2FyaWx5OiByZWdpc3RlcmluZyBhIFRZUCBjYW4gY2xlYW4gaXRzIHZhbHVlIGluXG4gIC8vIHRoZSBub3RlcyAoXCIgYnVjaFwiIC0+IFwiQlVDSFwiKSwgYW5kIHRoZSBTdWJ0eXAgcGFzcyBtdXN0IHRoZW4gdXNlIHRoZSBORVdcbiAgLy8gVFlQIG5hbWUgb3IgcmVuYW1lU3VidHlwSW5Ob3RlcygpIGZpbmRzIG5vIGZpbGUuXG4gIC8vXG4gIC8vIE5vIGNvbmZpcm1hdGlvbjogaXQgb25seSByZWdpc3RlcnMuIE5vdGVzIGNoYW5nZSBvbmx5IHdoZW4gYSByYXcgdmFsdWUgd2FzXG4gIC8vIHVuY2xlYW4gYW5kIGdldHMgY2xlYW5lZCAtIGEgY2xlYW4gdmFsdWUgdG91Y2hlcyBubyBmaWxlLlxuICBhc3luYyByZWdpc3RlclR5cFdpdGhTdWJ0eXAodHlwS2V5LCBzdWJ0eXBLZXkpIHtcbiAgICBjb25zdCBidWNrZXQgPSB0aGlzLnBsdWdpbi50eXBJbmRleC5zdWJ0eXBCdWNrZXQodHlwS2V5KTtcbiAgICBjb25zdCB0eXBSZXN1bHQgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBzLmluY2x1ZGVzKHR5cEtleSlcbiAgICAgID8geyB0eXA6IHR5cEtleSwgcmVuYW1lZDogMCB9XG4gICAgICA6IGF3YWl0IHRoaXMuYXBwbHlUeXBSZWdpc3RyYXRpb24odHlwS2V5KTtcbiAgICBpZiAoIXR5cFJlc3VsdCkgcmV0dXJuO1xuXG4gICAgY29uc3Qgc3VidHlwUmVzdWx0ID0gYXdhaXQgdGhpcy5hcHBseVN1YnR5cFJlZ2lzdHJhdGlvbih0eXBSZXN1bHQudHlwLCBzdWJ0eXBLZXksIGJ1Y2tldCk7XG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgICB0aGlzLnJlZnJlc2hPdGhlclZpZXdzKCk7XG5cbiAgICBpZiAoIXN1YnR5cFJlc3VsdCkgcmV0dXJuO1xuICAgIGNvbnN0IHBhcnRzID0gW107XG4gICAgaWYgKHR5cFJlc3VsdC50eXAgIT09IHR5cEtleSkgcGFydHMucHVzaChgVFlQICR7dHlwUmVzdWx0LnR5cH1gKTtcbiAgICBwYXJ0cy5wdXNoKGBTdWJ0eXAgJHtzdWJ0eXBSZXN1bHQuc3VidHlwfWApO1xuICAgIGNvbnN0IGNoYW5nZWQgPSB0eXBSZXN1bHQucmVuYW1lZCArIHN1YnR5cFJlc3VsdC5yZW5hbWVkO1xuICAgIG5ldyBOb3RpY2UoYCR7am9pbkFuZChwYXJ0cyl9IHJlZ2lzdGVyZWQke2NoYW5nZWQgPiAwID8gYCwgJHtwbHVyYWwoY2hhbmdlZCwgXCJub3RlXCIpfSB1cGRhdGVkYCA6IFwiXCJ9LmApO1xuICB9XG5cbiAgcmVuZGVyVHlwU2V0dGluZ3ModHlwKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG5cbiAgICBjb25zdCBoZWFkZXIgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1kZXRhaWwtaGVhZGVyXCIgfSk7XG4gICAgY29uc3QgYmFja0J0biA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWJhY2tcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJCYWNrXCIgfSB9KTtcbiAgICBzZXRJY29uKGJhY2tCdG4sIFwiYXJyb3ctbGVmdFwiKTtcbiAgICBiYWNrQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlVHlwU2V0dGluZ3MoKSk7XG5cbiAgICBjb25zdCB0aXRsZUVsID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZGV0YWlsLXRpdGxlXCIsIHRleHQ6IHR5cCB9KTtcbiAgICBjb25zdCB0aXRsZUNvbG9yID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0ID8gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gOiBudWxsO1xuICAgIC8vIEEgY3VzdG9tIHByb3BlcnR5IGluc3RlYWQgb2YgY29sb3I6IGFuIGlubGluZSBjb2xvciBiZWF0cyBldmVyeVxuICAgIC8vIHN0eWxlc2hlZXQgcnVsZSwgYW5kIHRoZSBhY2NlbnQgY29sb3Igb24gaG92ZXIgKC50eXAtc2VhcmNoYWJsZSkgd291bGRcbiAgICAvLyBuZWVkICFpbXBvcnRhbnQuXG4gICAgaWYgKHRpdGxlQ29sb3IpIHRpdGxlRWwuc3R5bGUuc2V0UHJvcGVydHkoXCItLXR5cC1uYW1lLWNvbG9yXCIsIHRpdGxlQ29sb3IpO1xuICAgIHRoaXMubWFrZVNlYXJjaGFibGUodGl0bGVFbCwgKCkgPT4gdGhpcy5vcGVuU2VhcmNoKHR5cCkpO1xuXG4gICAgY29uc3QgeyBjb3VudHMgfSA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnR5cENvdW50cygpO1xuICAgIGhlYWRlci5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1kZXRhaWwtY291bnRcIiwgdGV4dDogU3RyaW5nKGNvdW50cy5nZXQodHlwKSA/PyAwKSB9KTtcblxuICAgIC8vIExlZnQgb2YgdGhlIHBsYWluIHJlbmFtZSBidXR0b24sIGhpZ2hsaWdodGVkIGluIGFjY2VudCBjb2xvcjogdGhpcyBvbmVcbiAgICAvLyBhbHNvIHJld3JpdGVzIHRoZSBUWVAgb2YgZXZlcnkgYWZmZWN0ZWQgbm90ZSAoYWZ0ZXIgY29uZmlybWF0aW9uLCBzZWVcbiAgICAvLyBzdGFydERldGFpbFJlbmFtZSkuXG4gICAgY29uc3QgcmVuYW1lV2l0aE5vdGVzQnRuID0gaGVhZGVyLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWRldGFpbC1yZW5hbWUtbm90ZXNcIixcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiUmVuYW1lIGFuZCB1cGRhdGUgbm90ZXNcIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24ocmVuYW1lV2l0aE5vdGVzQnRuLCBcInBlbmNpbFwiKTtcbiAgICByZW5hbWVXaXRoTm90ZXNCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuc3RhcnREZXRhaWxSZW5hbWUodHlwLCB0aXRsZUVsLCB7IHVwZGF0ZU5vdGVzOiB0cnVlIH0pKTtcblxuICAgIGNvbnN0IHJlbmFtZUJ0biA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWRldGFpbC1yZW5hbWVcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJSZW5hbWVcIiB9IH0pO1xuICAgIHNldEljb24ocmVuYW1lQnRuLCBcInBlbmNpbFwiKTtcbiAgICByZW5hbWVCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuc3RhcnREZXRhaWxSZW5hbWUodHlwLCB0aXRsZUVsKSk7XG5cbiAgICAvLyBCZXR3ZWVuIHJlbmFtZSBhbmQgZGVsZXRlLCBpbiB0aGUgc2FtZSBzcG90IGFzIGZvciBhIFN1YnR5cCAoc2VlXG4gICAgLy8gcmVuZGVyU2VjdGlvbkZvb3RlcikuXG4gICAgdGhpcy5yZW5kZXJNYW51YWxUb2dnbGUoaGVhZGVyLCB0eXApO1xuXG4gICAgY29uc3QgZGVsZXRlQnRuID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtZGV0YWlsLWRlbGV0ZVwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkRlbGV0ZVwiIH0gfSk7XG4gICAgc2V0SWNvbihkZWxldGVCdG4sIFwidHJhc2hcIik7XG4gICAgZGVsZXRlQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnNob3dEZWxldGVDb25maXJtKHR5cCkpO1xuXG4gICAgY29uc3QgYm9keSA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWRldGFpbC1ib2R5XCIgfSk7XG5cbiAgICAvLyBPbmUgcm93IGJlbG93IHRoZSBoZWFkZXI6IHRoZSBUWVAgY29sb3Igb24gdGhlIGxlZnQsIHRoZSBkZXNjcmlwdGlvblxuICAgIC8vIGZpbGxpbmcgdGhlIHJlc3QuXG4gICAgY29uc3Qgb3B0aW9uc0hlYWRlciA9IGJvZHkuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci1oZWFkZXIgdHlwLW9wdGlvbnMtaGVhZGVyXCIgfSk7XG5cbiAgICBjb25zdCBjb2xvclJvdyA9IG9wdGlvbnNIZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1kZXRhaWwtY29sb3Itcm93XCIgfSk7XG4gICAgdGhpcy5yZW5kZXJDb2xvclBpY2tlcihcbiAgICAgIGNvbG9yUm93LFxuICAgICAgdHlwLFxuICAgICAgKG5ld0NvbG9yKSA9PiB7XG4gICAgICAgIGlmICghdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0KSByZXR1cm47XG4gICAgICAgIC8vIFNhbWUgY3VzdG9tIHByb3BlcnR5IGFzIGFib3ZlLCBub3Qgc3R5bGUuY29sb3IgKHNlZSB0aGVyZSkuXG4gICAgICAgIHRpdGxlRWwuc3R5bGUuc2V0UHJvcGVydHkoXCItLXR5cC1uYW1lLWNvbG9yXCIsIG5ld0NvbG9yKTtcbiAgICAgIH0sXG4gICAgICB7IHNob3dSZXNldDogdHJ1ZSB9XG4gICAgKTtcblxuICAgIC8vIFNpbmdsZS1saW5lIGlucHV0IG5leHQgdG8gdGhlIGNvbG9yLCBsaWtlIHRoZSBvbmUgaW4gdGhlIFRZUC1MaXN0LiBOb1xuICAgIC8vIGhlYWRpbmc6IHdoaWxlIGVtcHR5LCBpdHMgZmFkZWQgcGxhY2Vob2xkZXIgc2F5cyB3aGF0IGl0IGlzLlxuICAgIGNvbnN0IGRlc2NJbnB1dCA9IG9wdGlvbnNIZWFkZXIuY3JlYXRlRWwoXCJpbnB1dFwiLCB7XG4gICAgICB0eXBlOiBcInRleHRcIixcbiAgICAgIGNsczogXCJ0eXAtZGVzY3JpcHRpb24taW5wdXRcIixcbiAgICAgIGF0dHI6IHsgcGxhY2Vob2xkZXI6IFwiRGVzY3JpcHRpb25cIiB9LFxuICAgIH0pO1xuICAgIGRlc2NJbnB1dC52YWx1ZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlc2NyaXB0aW9uc1t0eXBdID8/IFwiXCI7XG4gICAgZGVzY0lucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgdmFsdWUgPSBkZXNjSW5wdXQudmFsdWUudHJpbSgpO1xuICAgICAgaWYgKHZhbHVlKSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBEZXNjcmlwdGlvbnNbdHlwXSA9IHZhbHVlO1xuICAgICAgZWxzZSBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRGVzY3JpcHRpb25zW3R5cF07XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICB9KTtcblxuICAgIC8vIFNlcGFyYXRlcyB0aGUgZnJvbnRtYXR0ZXIgYmxvY2tzIGZyb20gdGhlIFRZUCdzIG90aGVyIHNldHRpbmdzLlxuICAgIGJvZHkuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1kZXRhaWwtc2VwYXJhdG9yXCIgfSk7XG5cbiAgICAvLyBUWVAtRnJvbnRtYXR0ZXIgYW5kIG9uZSBibG9jayBwZXIgcmVnaXN0ZXJlZCBTdWJ0eXAgYmVsb3csIGVhY2ggd2l0aCBpdHNcbiAgICAvLyBvd24gZWRpdG9yIChzZWUgZnJvbnRtYXR0ZXItYmxvY2tzLmpzKSwgc28gdGhlIHNhbWUga2V5IG1heSBhcHBlYXIgaW5cbiAgICAvLyBzZXZlcmFsIGJsb2Nrcy4gQSBTdWJ0eXAgYmxvY2sgYWRkcyB0byB0aGUgVFlQLUZyb250bWF0dGVyIGZvciBub3RlcyB3aXRoXG4gICAgLy8gdGhhdCBTVUJUWVAgYW5kIG92ZXJyaWRlcyBzYW1lLW5hbWVkIHByb3BlcnRpZXMgKHNlZSBzdWJ0eXBzLmpzKS5cbiAgICBjb25zdCBidWNrZXQgPSB0aGlzLnBsdWdpbi50eXBJbmRleC5zdWJ0eXBCdWNrZXQodHlwKTtcbiAgICB0aGlzLmZyb250bWF0dGVyQmxvY2tzID0gbW91bnRGcm9udG1hdHRlckJsb2Nrcyh0aGlzLCBib2R5LCB0eXAsIHtcbiAgICAgIHJlbmRlckhlYWRlcjogKHNlY3Rpb24sIGVsLCBibG9ja3MpID0+IHRoaXMucmVuZGVyU2VjdGlvbkhlYWRlcihlbCwgdHlwLCBzZWN0aW9uLCBidWNrZXQsIGJsb2NrcyksXG4gICAgICByZW5kZXJGb290ZXI6IChzZWN0aW9uLCBlbCkgPT4ge1xuICAgICAgICBpZiAoc2VjdGlvbiAhPT0gbnVsbCkgdGhpcy5yZW5kZXJTZWN0aW9uRm9vdGVyKGVsLCB0eXAsIHNlY3Rpb24pO1xuICAgICAgfSxcbiAgICAgIG9uTW92ZVNlY3Rpb246IGFzeW5jIChvcmRlcikgPT4ge1xuICAgICAgICByZW9yZGVyU3VidHlwcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBvcmRlcik7XG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB0aGlzLnJlbmRlcigpO1xuICAgICAgfSxcbiAgICB9KTtcbiAgICB0aGlzLmZyb250bWF0dGVyRWRpdG9ycy5wdXNoKC4uLnRoaXMuZnJvbnRtYXR0ZXJCbG9ja3MuZWRpdG9ycyk7XG5cbiAgICAvLyBGdWxsIHdpZHRoIGFuZCBhY2NlbnQgY29sb3IsIHRvIHN0YW5kIGFwYXJ0IGZyb20gdGhlIGJsb2Nrcycgc21hbGwgaWNvblxuICAgIC8vIGJ1dHRvbnMuXG4gICAgdGhpcy5zdWJ0eXBBZGRCdG5FbCA9IGJvZHkuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IFwibW9kLWN0YSB0eXAtc3VidHlwLWFkZFwiIH0pO1xuICAgIHNldEljb24odGhpcy5zdWJ0eXBBZGRCdG5FbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1zdWJ0eXAtYWRkLWljb25cIiB9KSwgXCJwbHVzXCIpO1xuICAgIHRoaXMuc3VidHlwQWRkQnRuRWwuY3JlYXRlU3Bhbih7IHRleHQ6IFwiQWRkIFN1YnR5cFwiIH0pO1xuICAgIHRoaXMuc3VidHlwQWRkQnRuRWwuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuc3RhcnRBZGRTdWJ0eXAodHlwKSk7XG5cbiAgICB0aGlzLnJlbmRlclVucmVnaXN0ZXJlZFN1YnR5cHMoYm9keSwgdHlwLCBidWNrZXQpO1xuXG4gICAgYm9keS5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWRldGFpbC1zZXBhcmF0b3JcIiB9KTtcbiAgICB0aGlzLnJlbmRlckZsb2F0aW5nSGludChib2R5KTtcbiAgICAvLyBUaGUgYm9sZCBtYXJrcyAoZnJvbnRtYXR0ZXItZGVmYXVsdC1oaWdobGlnaHQuanMpIG9ubHkgcmVhY3QgdG8gbWV0YWRhdGFcbiAgICAvLyBhbmQgbGF5b3V0IGV2ZW50czsgb3BlbmluZyB0aGlzIHZpZXcgZmlyZXMgbm9uZSwgc28gcmVmcmVzaCBoZXJlLiBPbmx5XG4gICAgLy8gdGhpcyBvbmUgcmVmcmVzaCwgbm90IHRoZSBmdWxsIHJlZnJlc2hUeXBDb2xvcnMoKSwgd2hpY2ggd291bGQgY2FsbFxuICAgIC8vIHJlbmRlcigpIG9uIHRoaXMgdmlldyB3aGlsZSBpdCBpcyBzdGlsbCByZW5kZXJpbmcuXG4gICAgdGhpcy5wbHVnaW4ucmVmcmVzaEZyb250bWF0dGVySGlnaGxpZ2h0Py4oKTtcbiAgfVxuXG4gIC8vIEEgYmxvY2sncyBoZWFkaW5nIChzZWUgZnJvbnRtYXR0ZXItYmxvY2tzLmpzKTogdGl0bGUgd2l0aCBub3RlIGNvdW50IChmb3JcbiAgLy8gdGhlIFRZUC1Gcm9udG1hdHRlciB0aGUgbm90ZXMgd2l0aG91dCBTVUJUWVAsIHRoZSBvbmx5IG9uZXMgaXQgYXBwbGllcyB0b1xuICAvLyBhbG9uZSksIHNlYXJjaCBvbiBjbGljaywgYW5kIHRoZSB0d28gYWRkIGJ1dHRvbnMgZm9yIGEgYmxhbmsgcm93IGluIHRoaXNcbiAgLy8gYmxvY2suXG4gIHJlbmRlclNlY3Rpb25IZWFkZXIoZWwsIHR5cCwgc2VjdGlvbiwgYnVja2V0LCBibG9ja3MpIHtcbiAgICBjb25zdCB0aXRsZUdyb3VwID0gZWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci10aXRsZS1ncm91cFwiIH0pO1xuICAgIC8vIE5ldmVyIGNvbG9yZWQsIHVubGlrZSB0aGUgZGV0YWlsIHRpdGxlIGFib3ZlOiBhIGJsb2NrJ3MgY29sb3Igc2l0cyBpblxuICAgIC8vIGl0cyBmb290ZXIgZG90IChzZWUgcmVuZGVyU2VjdGlvbkZvb3RlcikuXG4gICAgY29uc3QgdGl0bGVFbCA9IHRpdGxlR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1kZXRhaWwtc2VjdGlvbi10aXRsZVwiLCB0ZXh0OiBzZWN0aW9uID8/IGAke3R5cH0tRnJvbnRtYXR0ZXJgIH0pO1xuICAgIGNvbnN0IGNvdW50ID0gc2VjdGlvbiA9PT0gbnVsbCA/IGJ1Y2tldC5ub1N1YnR5cCA6IGJ1Y2tldC5jb3VudHMuZ2V0KHNlY3Rpb24pID8/IDA7XG4gICAgdGl0bGVHcm91cC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1zdWJ0eXAtY291bnRcIiwgdGV4dDogU3RyaW5nKGNvdW50KSB9KTtcbiAgICB0aGlzLm1ha2VTZWFyY2hhYmxlKHRpdGxlRWwsICgpID0+IHRoaXMub3BlblN1YnR5cFNlYXJjaCh0eXAsIHNlY3Rpb24pKTtcblxuICAgIC8vIEZsb2F0aW5nIHByb3BlcnRpZXMgc2hhcmUgdGhlIGxpc3QgYW5kIG9yZGVyIG9mIHRoZSBvdGhlcnMgKHdoaWNoXG4gICAgLy8gZnJvbnRtYXR0ZXIgc29ydGluZyByZWxpZXMgb24pLCBzbyB0aGV5IGxhbmQgd2hlcmV2ZXIgZHJhZyAmIGRyb3AgcHV0c1xuICAgIC8vIHRoZW0gaW5zdGVhZCBvZiBhdCB0aGUgZW5kIG9mIGEgc2Vjb25kIGxpc3QuXG4gICAgY29uc3QgYWRkQnV0dG9ucyA9IGVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZnJvbnRtYXR0ZXItYWRkLWdyb3VwXCIgfSk7XG5cbiAgICAvLyBMZWZ0IG9mIHRoZSBwbGFpbiBidXR0b24sIGluIGFjY2VudCBjb2xvcjogbWFya3MgdGhlIG5leHQgYWRkZWQgKG9yLFxuICAgIC8vIHVudGlsIHNhdmVkLCByZW5hbWVkKSBwcm9wZXJ0eSBhcyBmbG9hdGluZyAoc2VlXG4gICAgLy8gZWRpdG9yLnR5cFBlbmRpbmdGbG9hdGluZ0FkZCkuIEZsb2F0aW5nIHByb3BlcnRpZXMgYXJlbid0IGNyZWF0ZWQgZm9yIG5ld1xuICAgIC8vIG5vdGVzIChzZWUgZ2V0VHlwRGVmYXVsdHMoKSkgYW5kIHNob3cgaW4gaXRhbGljcyB3aGVyZSBwcmVzZW50LlxuICAgIGNvbnN0IGFkZEZsb2F0aW5nUHJvcGVydHlCdG4gPSBhZGRCdXR0b25zLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWZyb250bWF0dGVyLWFkZC1mbG9hdGluZ1wiLFxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJBZGQgZmxvYXRpbmcgcHJvcGVydHlcIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24oYWRkRmxvYXRpbmdQcm9wZXJ0eUJ0biwgXCJwbHVzXCIpO1xuICAgIGFkZEZsb2F0aW5nUHJvcGVydHlCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IGJsb2Nrcy5hZGRCbGFuayhzZWN0aW9uLCB0cnVlKSk7XG5cbiAgICBjb25zdCBhZGRQcm9wZXJ0eUJ0biA9IGFkZEJ1dHRvbnMuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtZnJvbnRtYXR0ZXItYWRkXCIsXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkFkZCBwcm9wZXJ0eVwiIH0sXG4gICAgfSk7XG4gICAgc2V0SWNvbihhZGRQcm9wZXJ0eUJ0biwgXCJwbHVzXCIpO1xuICAgIGFkZFByb3BlcnR5QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiBibG9ja3MuYWRkQmxhbmsoc2VjdGlvbiwgZmFsc2UpKTtcbiAgfVxuXG4gIC8vIEZvb3RlciBvZiBhIFN1YnR5cCBibG9jazogb24gdGhlIGxlZnQgdGhlIFN1YnR5cCBjb2xvciAoYSBkb3Qgb3BlbmluZyB0aGVcbiAgLy8gc2xpZGVycywgcmVzZXQgbmV4dCB0byBpdCksIG9uIHRoZSByaWdodCB0aGUgc2FtZSBhY3Rpb25zIGluIHRoZSBzYW1lIG9yZGVyXG4gIC8vIGFzIHRoZSBkZXRhaWwgaGVhZGVyIChyZW5hbWUgYW5kIHVwZGF0ZSBub3RlcywgcmVuYW1lLCBtYW51YWxseSBjcmVhdGFibGUsXG4gIC8vIGRlbGV0ZSkuIFRoZSBUWVAtRnJvbnRtYXR0ZXIgaGFzIG5vIGZvb3Rlci4gVGhlIHRpdGxlIGlzIGxvb2tlZCB1cCBvblxuICAvLyBjbGljayAtIGhlYWRpbmcgYW5kIGZvb3RlciBhcmUgcmVidWlsdCBvbiBldmVyeSBzeW5jaHJvbml6ZSgpLlxuICByZW5kZXJTZWN0aW9uRm9vdGVyKGVsLCB0eXAsIHN1YnR5cCkge1xuICAgIGVsLmFkZENsYXNzKFwidHlwLXN1YnR5cC1hY3Rpb25zXCIpO1xuICAgIGNvbnN0IGNvbG9yR3JvdXAgPSBlbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLXN1YnR5cC1jb2xvci1ncm91cFwiIH0pO1xuICAgIC8vIEEgcmluZyBhbHNvIHdoaWxlIHRoZSBUWVAgaXRzZWxmIGhhcyBubyBjb2xvciAtIHRoZW4gYW4gb2Zmc2V0IGNvbG9yc1xuICAgIC8vIG5vdGhpbmcgYW55d2hlcmUuXG4gICAgY29uc3Qgb3duQ29sb3IgPSBzdWJ0eXBIYXNPd25Db2xvcih0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApO1xuICAgIGNvbnN0IHR5cEhhc0NvbG9yID0gISF0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdHlwXTtcbiAgICBjb25zdCBjb2xvckRvdCA9IGNvbG9yR3JvdXAuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJ0eXAtc3VidHlwLWNvbG9yLWRvdFwiLFxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogIXR5cEhhc0NvbG9yID8gXCJUWVAgaGFzIG5vIGNvbG9yXCIgOiBvd25Db2xvciA/IFwiQWRqdXN0IGNvbG9yXCIgOiBcIlVzZXMgVFlQIGNvbG9yXCIgfSxcbiAgICB9KTtcbiAgICBjb2xvckRvdC50eXBTdWJ0eXAgPSBzdWJ0eXA7XG4gICAgcGFpbnRDb2xvckRvdChjb2xvckRvdCwgc3VidHlwQ29sb3IodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKSA/PyBERUZBVUxUX1RZUF9DT0xPUiwgIW93bkNvbG9yIHx8ICF0eXBIYXNDb2xvcik7XG4gICAgY29sb3JEb3QuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMub3BlblN1YnR5cENvbG9yUG9wb3Zlcihjb2xvckRvdCwgdHlwLCBzdWJ0eXApKTtcbiAgICBjb25zdCByZXNldEJ0biA9IGNvbG9yR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1jb2xvci1yZXNldFwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlJlc2V0IGNvbG9yXCIgfSB9KTtcbiAgICByZXNldEJ0bi50b2dnbGVDbGFzcyhcImlzLWRpc2FibGVkXCIsICFvd25Db2xvcik7XG4gICAgc2V0SWNvbihyZXNldEJ0biwgXCJyb3RhdGUtY2N3XCIpO1xuICAgIHJlc2V0QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBkYXRhID0gZ2V0U3VidHlwKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCk7XG4gICAgICBpZiAoIWRhdGE/LmNvbG9yKSByZXR1cm47XG4gICAgICBjb25zdCBzbmFwc2hvdCA9IHNuYXBzaG90U2V0dGluZ3ModGhpcy5wbHVnaW4pO1xuICAgICAgZGVsZXRlIGRhdGEuY29sb3I7XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgIG9mZmVyVW5kbyh0aGlzLnBsdWdpbiwgYENvbG9yIG9mIFN1YnR5cCAke3N1YnR5cH0gcmVzZXQuYCwgc25hcHNob3QpO1xuICAgICAgdGhpcy5yZWZyZXNoT3RoZXJWaWV3cygpO1xuICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICB9KTtcblxuICAgIGNvbnN0IGFjdGlvbnMgPSBlbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLXN1YnR5cC1hY3Rpb24tZ3JvdXBcIiB9KTtcbiAgICBjb25zdCB0aXRsZUVsID0gKCkgPT4ge1xuICAgICAgbGV0IHNpYmxpbmcgPSBlbC5wcmV2aW91c0VsZW1lbnRTaWJsaW5nO1xuICAgICAgd2hpbGUgKHNpYmxpbmcgJiYgIXNpYmxpbmcuaGFzQ2xhc3MoXCJ0eXAtc2VjdGlvbi1oZWFkZXJcIikpIHNpYmxpbmcgPSBzaWJsaW5nLnByZXZpb3VzRWxlbWVudFNpYmxpbmc7XG4gICAgICByZXR1cm4gc2libGluZz8ucXVlcnlTZWxlY3RvcihcIi50eXAtZGV0YWlsLXNlY3Rpb24tdGl0bGVcIikgPz8gbnVsbDtcbiAgICB9O1xuICAgIGNvbnN0IHJlbmFtZSA9ICh1cGRhdGVOb3RlcykgPT4ge1xuICAgICAgY29uc3QgdGFyZ2V0ID0gdGl0bGVFbCgpO1xuICAgICAgaWYgKHRhcmdldCkgdGhpcy5zdGFydFN1YnR5cFJlbmFtZSh0eXAsIHN1YnR5cCwgdGFyZ2V0LCB7IHVwZGF0ZU5vdGVzIH0pO1xuICAgIH07XG5cbiAgICBjb25zdCByZW5hbWVXaXRoTm90ZXNCdG4gPSBhY3Rpb25zLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWRldGFpbC1yZW5hbWUtbm90ZXNcIixcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiUmVuYW1lIGFuZCB1cGRhdGUgbm90ZXNcIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24ocmVuYW1lV2l0aE5vdGVzQnRuLCBcInBlbmNpbFwiKTtcbiAgICByZW5hbWVXaXRoTm90ZXNCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHJlbmFtZSh0cnVlKSk7XG5cbiAgICBjb25zdCByZW5hbWVCdG4gPSBhY3Rpb25zLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtZGV0YWlsLXJlbmFtZVwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlJlbmFtZVwiIH0gfSk7XG4gICAgc2V0SWNvbihyZW5hbWVCdG4sIFwicGVuY2lsXCIpO1xuICAgIHJlbmFtZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gcmVuYW1lKGZhbHNlKSk7XG5cbiAgICB0aGlzLnJlbmRlclN1YnR5cE1hbnVhbFRvZ2dsZShhY3Rpb25zLCB0eXAsIHN1YnR5cCk7XG5cbiAgICBjb25zdCBkZWxldGVCdG4gPSBhY3Rpb25zLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtZGV0YWlsLWRlbGV0ZVwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkRlbGV0ZVwiIH0gfSk7XG4gICAgc2V0SWNvbihkZWxldGVCdG4sIFwidHJhc2hcIik7XG4gICAgZGVsZXRlQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmRlbGV0ZVN1YnR5cFdpdGhDb25maXJtKHR5cCwgc3VidHlwKSk7XG4gIH1cblxuICAvLyBQb3BvdmVyIGJlbG93IGEgU3VidHlwIGJsb2NrJ3MgZG90OiBvbmUgc2xpZGVyIHBlciBjaGFubmVsLCBsaW1pdGVkIHRvIHRoZVxuICAvLyByYW5nZSBmcm9tIHRoZSBzZXR0aW5ncyAoc2VlIHR5cC1jb2xvcnMuanMpLCBlYWNoIHRyYWNrIHNob3dpbmcgdGhlIGNvbG9yc1xuICAvLyBpdCBjYW4gcmVhY2guIERyYWdnaW5nIG9ubHkgdXBkYXRlcyB0aGUgZG90IGhlcmU7IHNhdmluZywgdXBkYXRpbmcgdGhlXG4gIC8vIG90aGVyIHZpZXdzIGFuZCByZS1yZW5kZXJpbmcgdGhpcyBvbmUgaGFwcGVuIG9uIGNsb3NlIChjbGljayBvdXRzaWRlIG9yXG4gIC8vIEVzY2FwZSksIGFuZCBvbmx5IGlmIHRoZSBjb2xvciBjaGFuZ2VkLlxuICAvL1xuICAvLyBBIFN1YnR5cCBjb2xvciBpcyBhbiBvZmZzZXQgZnJvbSB0aGUgVFlQIGNvbG9yOiB3aGlsZSB0aGUgVFlQIGhhcyBub25lLFxuICAvLyB0aGVyZSBpcyBub3RoaW5nIHRvIG9mZnNldCwgc28gdGhlIHBvcG92ZXIgc2F5cyBzbyBhbmQgdGhlIHNsaWRlcnMgYXJlXG4gIC8vIGxvY2tlZCAodGhlIGRvdCBzdGF5cyBhIGhvbGxvdyByaW5nLCBzZWUgcmVuZGVyU2VjdGlvbkZvb3RlcikuXG4gIG9wZW5TdWJ0eXBDb2xvclBvcG92ZXIoYW5jaG9yRWwsIHR5cCwgc3VidHlwKSB7XG4gICAgdGhpcy5jbG9zZVN1YnR5cENvbG9yUG9wb3Zlcj8uKCk7XG4gICAgY29uc3QgeyBzZXR0aW5ncyB9ID0gdGhpcy5wbHVnaW47XG4gICAgY29uc3QgZGF0YSA9IGdldFN1YnR5cChzZXR0aW5ncywgdHlwLCBzdWJ0eXApO1xuICAgIGlmICghZGF0YSkgcmV0dXJuO1xuICAgIGNvbnN0IHR5cEhhc0NvbG9yID0gISFzZXR0aW5ncy50eXBDb2xvcnNbdHlwXTtcbiAgICBjb25zdCB0eXBDb2xvciA9IHNldHRpbmdzLnR5cENvbG9yc1t0eXBdID8/IERFRkFVTFRfVFlQX0NPTE9SO1xuICAgIC8vIFdpdGhvdXQgYW4gb2Zmc2V0IGV2ZXJ5IHNsaWRlciBzdGFydHMgYXQgMDsgU1VCVFlQX0NPTE9SX0NIQU5ORUxTIGFsb25lXG4gICAgLy8gc2F5cyB3aGljaCBleGlzdC5cbiAgICBjb25zdCBvZmZzZXQgPSBjbGFtcGVkT2Zmc2V0KHNldHRpbmdzLCBkYXRhLmNvbG9yKSA/PyBPYmplY3QuZnJvbUVudHJpZXMoU1VCVFlQX0NPTE9SX0NIQU5ORUxTLm1hcCgoeyBrZXkgfSkgPT4gW2tleSwgMF0pKTtcbiAgICBjb25zdCBkb2MgPSBhbmNob3JFbC5kb2M7XG4gICAgY29uc3QgcG9wb3ZlciA9IGRvYy5ib2R5LmNyZWF0ZURpdih7IGNsczogXCJtZW51IHR5cC1zdWJ0eXAtY29sb3ItcG9wb3ZlclwiIH0pO1xuICAgIGlmICghdHlwSGFzQ29sb3IpIHBvcG92ZXIuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zdWJ0eXAtY29sb3ItaGludFwiLCB0ZXh0OiBgU2V0IGEgY29sb3IgZm9yICR7dHlwfSBmaXJzdC5gIH0pO1xuXG4gICAgY29uc3Qgcm93cyA9IFtdO1xuICAgIGNvbnN0IHVwZGF0ZSA9ICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbG9yID0gYXBwbHlDb2xvck9mZnNldCh0eXBDb2xvciwgb2Zmc2V0KTtcbiAgICAgIGZvciAoY29uc3QgZWwgb2YgdGhpcy5jb250ZW50RWwucXVlcnlTZWxlY3RvckFsbChcIi50eXAtc3VidHlwLWNvbG9yLWRvdFwiKSkge1xuICAgICAgICBpZiAoZWwudHlwU3VidHlwID09PSBzdWJ0eXApIHBhaW50Q29sb3JEb3QoZWwsIGNvbG9yLCAhaGFzQ29sb3JPZmZzZXQob2Zmc2V0KSB8fCAhc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0pO1xuICAgICAgfVxuICAgICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykgcm93KCk7XG4gICAgfTtcblxuICAgIGZvciAoY29uc3QgeyBrZXksIGxhYmVsLCB1bml0IH0gb2YgU1VCVFlQX0NPTE9SX0NIQU5ORUxTKSB7XG4gICAgICBjb25zdCBbbWluLCBtYXhdID0gY2hhbm5lbEJvdW5kcyhzZXR0aW5ncywga2V5KTtcbiAgICAgIGNvbnN0IHJvdyA9IHBvcG92ZXIuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zdWJ0eXAtY29sb3Itcm93XCIgfSk7XG4gICAgICByb3cuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtc3VidHlwLWNvbG9yLWxhYmVsXCIsIHRleHQ6IGxhYmVsIH0pO1xuICAgICAgY29uc3QgaW5wdXQgPSByb3cuY3JlYXRlRWwoXCJpbnB1dFwiLCB7IHR5cGU6IFwicmFuZ2VcIiwgY2xzOiBcInNsaWRlciB0eXAtc3VidHlwLWNvbG9yLXNsaWRlclwiIH0pO1xuICAgICAgaW5wdXQubWluID0gU3RyaW5nKG1pbik7XG4gICAgICBpbnB1dC5tYXggPSBTdHJpbmcobWF4KTtcbiAgICAgIGlucHV0LnN0ZXAgPSBcIjFcIjtcbiAgICAgIGlucHV0LnZhbHVlID0gU3RyaW5nKG9mZnNldFtrZXldKTtcbiAgICAgIGlucHV0LmRpc2FibGVkID0gbWluID09PSBtYXggfHwgIXR5cEhhc0NvbG9yO1xuICAgICAgY29uc3QgdmFsdWVFbCA9IHJvdy5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1zdWJ0eXAtY29sb3ItdmFsdWVcIiB9KTtcbiAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJpbnB1dFwiLCAoKSA9PiB7XG4gICAgICAgIG9mZnNldFtrZXldID0gTnVtYmVyKGlucHV0LnZhbHVlKTtcbiAgICAgICAgdXBkYXRlKCk7XG4gICAgICB9KTtcbiAgICAgIHJvd3MucHVzaCgoKSA9PiB7XG4gICAgICAgIGNvbnN0IHN0ZXBzID0gODtcbiAgICAgICAgY29uc3Qgc3RvcHMgPSBbXTtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPD0gc3RlcHM7IGkrKykge1xuICAgICAgICAgIHN0b3BzLnB1c2goYXBwbHlDb2xvck9mZnNldCh0eXBDb2xvciwgeyAuLi5vZmZzZXQsIFtrZXldOiBtaW4gKyAoKG1heCAtIG1pbikgKiBpKSAvIHN0ZXBzIH0pKTtcbiAgICAgICAgfVxuICAgICAgICBpbnB1dC5zdHlsZS5zZXRQcm9wZXJ0eShcIi0tdHlwLXRyYWNrXCIsIGBsaW5lYXItZ3JhZGllbnQodG8gcmlnaHQsICR7c3RvcHMuam9pbihcIiwgXCIpfSlgKTtcbiAgICAgICAgdmFsdWVFbC5zZXRUZXh0KGAke29mZnNldFtrZXldID4gMCA/IFwiK1wiIDogXCJcIn0ke29mZnNldFtrZXldfSR7dW5pdH1gKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICB1cGRhdGUoKTtcblxuICAgIC8vIEJlbG93IHRoZSBkb3QsIGJ1dCBpbnNpZGUgdGhlIHdpbmRvdy5cbiAgICBjb25zdCByZWN0ID0gYW5jaG9yRWwuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgY29uc3Qgd2luID0gZG9jLmRlZmF1bHRWaWV3O1xuICAgIGNvbnN0IHdpZHRoID0gcG9wb3Zlci5vZmZzZXRXaWR0aDtcbiAgICBjb25zdCBoZWlnaHQgPSBwb3BvdmVyLm9mZnNldEhlaWdodDtcbiAgICBwb3BvdmVyLnN0eWxlLmxlZnQgPSBgJHtNYXRoLm1heCg4LCBNYXRoLm1pbihyZWN0LmxlZnQsIHdpbi5pbm5lcldpZHRoIC0gd2lkdGggLSA4KSl9cHhgO1xuICAgIHBvcG92ZXIuc3R5bGUudG9wID0gYCR7cmVjdC5ib3R0b20gKyA2ICsgaGVpZ2h0ID4gd2luLmlubmVySGVpZ2h0IC0gOCA/IHJlY3QudG9wIC0gNiAtIGhlaWdodCA6IHJlY3QuYm90dG9tICsgNn1weGA7XG5cbiAgICBjb25zdCBvblBvaW50ZXJEb3duID0gKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoIXBvcG92ZXIuY29udGFpbnMoZXZlbnQudGFyZ2V0KSkgY2xvc2UoKTtcbiAgICB9O1xuICAgIGNvbnN0IG9uS2V5RG93biA9IChldmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmtleSAhPT0gXCJFc2NhcGVcIikgcmV0dXJuO1xuICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgY2xvc2UoKTtcbiAgICB9O1xuICAgIGNvbnN0IGNsb3NlID0gYXN5bmMgKCkgPT4ge1xuICAgICAgdGhpcy5jbG9zZVN1YnR5cENvbG9yUG9wb3ZlciA9IG51bGw7XG4gICAgICBkb2MucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNlZG93blwiLCBvblBvaW50ZXJEb3duLCB0cnVlKTtcbiAgICAgIGRvYy5yZW1vdmVFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCBvbktleURvd24sIHRydWUpO1xuICAgICAgcG9wb3Zlci5yZW1vdmUoKTtcbiAgICAgIGNvbnN0IGN1cnJlbnQgPSBnZXRTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgc3VidHlwKTtcbiAgICAgIGlmICghY3VycmVudCkgcmV0dXJuO1xuICAgICAgLy8gVW5jaGFuZ2VkIChqdXN0IGxvb2tlZCwgb3Igc2xpZCBiYWNrKTogbm90aGluZyB0byBzYXZlLCBhbmQgbm9cbiAgICAgIC8vIHJlLXJlbmRlciB0aGF0IGNvdWxkIG1vdmUgYW55dGhpbmcuXG4gICAgICBjb25zdCBuZXh0ID0gaGFzQ29sb3JPZmZzZXQob2Zmc2V0KSA/IHsgLi4ub2Zmc2V0IH0gOiBudWxsO1xuICAgICAgaWYgKEpTT04uc3RyaW5naWZ5KG5leHQpID09PSBKU09OLnN0cmluZ2lmeShjdXJyZW50LmNvbG9yID8/IG51bGwpKSByZXR1cm47XG4gICAgICAvLyBUaGUgc2xpZGVycyBvbmx5IHRvdWNoZWQgdGhlIGRvdCBzbyBmYXIsIHNvIGEgc25hcHNob3QgdGFrZW4gbm93IGlzXG4gICAgICAvLyBzdGlsbCB0aGUgc3RhdGUgZnJvbSBvcGVuaW5nIC0gd2l0aG91dCByZXZlcnRpbmcgYW55dGhpbmcgc2F2ZWRcbiAgICAgIC8vIGVsc2V3aGVyZSBpbiB0aGUgbWVhbnRpbWUuXG4gICAgICBjb25zdCBzbmFwc2hvdCA9IHNuYXBzaG90U2V0dGluZ3ModGhpcy5wbHVnaW4pO1xuICAgICAgaWYgKG5leHQpIGN1cnJlbnQuY29sb3IgPSBuZXh0O1xuICAgICAgZWxzZSBkZWxldGUgY3VycmVudC5jb2xvcjtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgb2ZmZXJVbmRvKHRoaXMucGx1Z2luLCBgQ29sb3Igb2YgU3VidHlwICR7c3VidHlwfSBjaGFuZ2VkLmAsIHNuYXBzaG90KTtcbiAgICAgIHRoaXMucmVmcmVzaE90aGVyVmlld3MoKTtcbiAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgfTtcbiAgICB0aGlzLmNsb3NlU3VidHlwQ29sb3JQb3BvdmVyID0gY2xvc2U7XG4gICAgZG9jLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZWRvd25cIiwgb25Qb2ludGVyRG93biwgdHJ1ZSk7XG4gICAgZG9jLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIG9uS2V5RG93biwgdHJ1ZSk7XG4gIH1cblxuICAvLyBEZWxldGVzIHRoZSBTdWJ0eXAgYmxvY2sgd2l0aCBpdHMgcHJvcGVydGllcy4gTm90ZXMga2VlcCB0aGVpciBTVUJUWVBcbiAgLy8gdmFsdWUgKGl0IHRoZW4gc2hvd3MgYXMgdW5yZWdpc3RlcmVkIGJlbG93KSwgc28gY29uZmlybWF0aW9uIGlzIG9ubHlcbiAgLy8gbmVlZGVkIHdoZW4gcHJvcGVydGllcyB3b3VsZCBiZSBsb3N0LiBFaXRoZXIgd2F5IGFuIHVuZG8gaXMgb2ZmZXJlZFxuICAvLyBhZnRlcndhcmRzIChzZWUgdW5kby5qcykuXG4gIGRlbGV0ZVN1YnR5cFdpdGhDb25maXJtKHR5cCwgc3VidHlwKSB7XG4gICAgY29uc3QgYXBwbHkgPSBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBzbmFwc2hvdCA9IHNuYXBzaG90U2V0dGluZ3ModGhpcy5wbHVnaW4pO1xuICAgICAgZGVsZXRlU3VidHlwKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCk7XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgIG9mZmVyVW5kbyh0aGlzLnBsdWdpbiwgYFN1YnR5cCAke3N1YnR5cH0gZGVsZXRlZC5gLCBzbmFwc2hvdCk7XG4gICAgICB0aGlzLnJlZnJlc2hPdGhlclZpZXdzKCk7XG4gICAgICB0aGlzLnJlbmRlcigpO1xuICAgIH07XG4gICAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKGdldFN1YnR5cCh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApPy5mcm9udG1hdHRlciA/PyB7fSkuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gXCJcIik7XG4gICAgaWYgKGtleXMubGVuZ3RoID09PSAwKSB7XG4gICAgICBhcHBseSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB7IHBsdWdpbiB9ID0gdGhpcztcbiAgICB0aGlzLmNvbmZpcm1EZWxldGlvbihcbiAgICAgIHtcbiAgICAgICAgdGl0bGU6IFtcbiAgICAgICAgICBcIkRlbGV0ZSBcIixcbiAgICAgICAgICBzdWJ0eXBOYW1lTm9kZShwbHVnaW4sIHR5cCwgc3VidHlwKSxcbiAgICAgICAgICBcIiBvZiBcIixcbiAgICAgICAgICB0eXBOYW1lTm9kZShwbHVnaW4sIHR5cCwgcGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdID8/IG51bGwpLFxuICAgICAgICAgIFwiP1wiLFxuICAgICAgICBdLFxuICAgICAgICBib2R5OiBbXG4gICAgICAgICAga2V5cy5sZW5ndGggPT09IDFcbiAgICAgICAgICAgID8gYEl0cyBwcm9wZXJ0eSAke2tleXNbMF19IHdpbGwgYmUgbG9zdC5gXG4gICAgICAgICAgICA6IGBJdHMgJHtrZXlzLmxlbmd0aH0gcHJvcGVydGllcyAke2tleXMuam9pbihcIiwgXCIpfSB3aWxsIGJlIGxvc3QuYCxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgICBhcHBseVxuICAgICk7XG4gIH1cblxuICAvLyBcIkRlbGV0ZSBUWVBcIiBhbmQgXCJEZWxldGUgU3VidHlwXCIgY2hhbmdlIG5vdGhpbmcgYnV0IHRoZSBzZXR0aW5ncyBhbmQgb2ZmZXJcbiAgLy8gVW5kbyBhZnRlcndhcmRzLCBzbyAtIHVubGlrZSBldmVyeSBkaWFsb2cgdGhhdCByZXdyaXRlcyBub3RlcyAtIHRoZWlyXG4gIC8vIGNvbmZpcm1hdGlvbiBjYW4gYmUgc3dpdGNoZWQgb2ZmOiBzZXR0aW5nIFwiQ29uZmlybSBkZWxldGlvblwiLCBvciBcIkRvbid0XG4gIC8vIGFzayBhZ2FpblwiIGluIHRoZSBkaWFsb2cgaXRzZWxmLiBXaXRob3V0IGl0IGFwcGx5KCkgcnVucyBhdCBvbmNlLlxuICBjb25maXJtRGVsZXRpb24oeyB0aXRsZSwgYm9keSB9LCBhcHBseSkge1xuICAgIGlmICghdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29uZmlybURlbGV0aW9uKSB7XG4gICAgICBhcHBseSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBuZXcgQ29uZmlybU1vZGFsKHRoaXMuYXBwLCB7XG4gICAgICB0aXRsZSxcbiAgICAgIGJvZHksXG4gICAgICBjb25maXJtVGV4dDogXCJEZWxldGVcIixcbiAgICAgIHdhcm5pbmc6IHRydWUsXG4gICAgICBmb2N1czogXCJjYW5jZWxcIixcbiAgICAgIGRvbnRBc2tBZ2FpbjogdHJ1ZSxcbiAgICAgIG9uQ29uZmlybTogKGRvbnRBc2tBZ2FpbikgPT4ge1xuICAgICAgICAvLyBTZXQgYmVmb3JlIGFwcGx5KCksIHdoaWNoIHNhdmVzIGl0IGFsb25nIHdpdGggdGhlIGRlbGV0aW9uIGFuZFxuICAgICAgICAvLyB0YWtlcyBpdHMgdW5kbyBzbmFwc2hvdCBvbmx5IGFmdGVyd2FyZHMgLSBVbmRvIGRvZXNuJ3QgYnJpbmcgdGhlXG4gICAgICAgIC8vIGRpYWxvZyBiYWNrLlxuICAgICAgICBpZiAoZG9udEFza0FnYWluKSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb25maXJtRGVsZXRpb24gPSBmYWxzZTtcbiAgICAgICAgYXBwbHkoKTtcbiAgICAgIH0sXG4gICAgfSkub3BlbigpO1xuICB9XG5cbiAgLy8gTGlrZSBzdGFydERldGFpbFJlbmFtZSgpLCBvbiBhIFN1YnR5cCBibG9jaydzIHRpdGxlLiBUaGUgYmxvY2sga2VlcHMgaXRzXG4gIC8vIHBvc2l0aW9uOyB1cGRhdGVOb3RlczogdHJ1ZSBhbHNvIHJld3JpdGVzIHRoZSBTVUJUWVAgb2YgdGhlIGFmZmVjdGVkIG5vdGVzXG4gIC8vIGFmdGVyIGNvbmZpcm1hdGlvbi4gQW4gZXhpc3RpbmcgbmFtZSBvZmZlcnMgYSBtZXJnZSBpbnN0ZWFkICh3aGljaCBhbHdheXNcbiAgLy8gcmV3cml0ZXMgdGhlIG5vdGVzKS5cbiAgc3RhcnRTdWJ0eXBSZW5hbWUodHlwLCBzdWJ0eXAsIHRpdGxlRWwsIHsgdXBkYXRlTm90ZXMgPSBmYWxzZSB9ID0ge30pIHtcbiAgICB0aGlzLnN0YXJ0SW5saW5lRWRpdCh0aXRsZUVsLCB7XG4gICAgICBjbGFzc2VzOiBbXCJ0eXAtc3VidHlwLW5hbWUtaW5wdXRcIiwgXCJpcy1iZWluZy1yZW5hbWVkXCJdLFxuICAgICAgLy8gVGhlIHRpdGxlIHNpdHMgYW1vbmcgT2JzaWRpYW4ncyBwcm9wZXJ0eSBlZGl0b3JzLCB3aG9zZSBrZXlib2FyZFxuICAgICAgLy8gbmF2aWdhdGlvbiB3b3VsZCByZWFjdCB0b28uXG4gICAgICBzdG9wQWxsS2V5czogdHJ1ZSxcbiAgICAgIG9uRmluaXNoOiAoY29tbWl0LCB0ZXh0KSA9PlxuICAgICAgICBjb21taXQgPyB0aGlzLmNvbW1pdFN1YnR5cFJlbmFtZSh0eXAsIHN1YnR5cCwgdGV4dCwgeyB1cGRhdGVOb3RlcyB9KSA6IHRoaXMucmVuZGVyKCksXG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBjb21taXRTdWJ0eXBSZW5hbWUodHlwLCBzdWJ0eXAsIHJhd1RleHQsIHsgdXBkYXRlTm90ZXMgfSkge1xuICAgIGNvbnN0IHZhbHVlID0gbm9ybWFsaXplU3VidHlwTmFtZShyYXdUZXh0KTtcbiAgICBpZiAoIXZhbHVlIHx8IHZhbHVlID09PSBzdWJ0eXApIHtcbiAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgY291bnRPZiA9IChuYW1lKSA9PiB0aGlzLnBsdWdpbi50eXBJbmRleC5zdWJ0eXBCdWNrZXQodHlwKS5jb3VudHMuZ2V0KG5hbWUpID8/IDA7XG4gICAgY29uc3QgYXBwbHlSZW5hbWUgPSBhc3luYyAoeyB3aXRoTm90ZXMgfSkgPT4ge1xuICAgICAgcmVuYW1lU3VidHlwKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCwgdmFsdWUpO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICBjb25zdCByZW5hbWVkID0gd2l0aE5vdGVzID8gYXdhaXQgcmVuYW1lU3VidHlwSW5Ob3Rlcyh0aGlzLnBsdWdpbiwgdHlwLCBzdWJ0eXAsIHZhbHVlKSA6IDA7XG4gICAgICB0aGlzLnJlZnJlc2hPdGhlclZpZXdzKCk7XG4gICAgICBpZiAod2l0aE5vdGVzKSBuZXcgTm90aWNlKGBTdWJ0eXAgJHt2YWx1ZX06ICR7cGx1cmFsKHJlbmFtZWQsIFwibm90ZVwiKX0gdXBkYXRlZC5gKTtcbiAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgfTtcblxuICAgIGNvbnN0IGV4aXN0aW5nID0gZ2V0U3VidHlwTmFtZXModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCkuZmluZChcbiAgICAgIChuYW1lKSA9PiBuYW1lLnRvTG93ZXJDYXNlKCkgPT09IHZhbHVlLnRvTG93ZXJDYXNlKCkgJiYgbmFtZSAhPT0gc3VidHlwXG4gICAgKTtcbiAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgIG5ldyBDb25maXJtTW9kYWwodGhpcy5hcHAsIHtcbiAgICAgICAgdGl0bGU6IFtcbiAgICAgICAgICBcIk1lcmdlIFwiLFxuICAgICAgICAgIHN1YnR5cE5hbWVOb2RlKHRoaXMucGx1Z2luLCB0eXAsIHN1YnR5cCksXG4gICAgICAgICAgXCIgaW50byBcIixcbiAgICAgICAgICBzdWJ0eXBOYW1lTm9kZSh0aGlzLnBsdWdpbiwgdHlwLCBleGlzdGluZyksXG4gICAgICAgICAgXCI/XCIsXG4gICAgICAgIF0sXG4gICAgICAgIGJvZHk6IFtcbiAgICAgICAgICBgJHtleGlzdGluZ30gYWxyZWFkeSBleGlzdHMgaW4gJHt0eXB9LiBgICtcbiAgICAgICAgICAgIGAke3BsdXJhbChjb3VudE9mKHN1YnR5cCksIFwibm90ZVwiKX0gJHtjb3VudE9mKHN1YnR5cCkgPT09IDEgPyBcIm1vdmVzXCIgOiBcIm1vdmVcIn0gdG8gaXQsIGAgK1xuICAgICAgICAgICAgYGFuZCB0aGUgcHJvcGVydGllcyBvZiAke3N1YnR5cH0gbW92ZSBpbnRvIGl0cyBibG9jay5gLFxuICAgICAgICBdLFxuICAgICAgICBjb25maXJtVGV4dDogXCJNZXJnZVwiLFxuICAgICAgICB3YXJuaW5nOiB0cnVlLFxuICAgICAgICBmb2N1czogXCJjYW5jZWxcIixcbiAgICAgICAgb25Db25maXJtOiBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgbWVyZ2VTdWJ0eXBzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCwgZXhpc3RpbmcpO1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIGNvbnN0IHJlbmFtZWQgPSBhd2FpdCByZW5hbWVTdWJ0eXBJbk5vdGVzKHRoaXMucGx1Z2luLCB0eXAsIHN1YnR5cCwgZXhpc3RpbmcpO1xuICAgICAgICAgIHRoaXMucmVmcmVzaE90aGVyVmlld3MoKTtcbiAgICAgICAgICBuZXcgTm90aWNlKGBTdWJ0eXAgJHtzdWJ0eXB9IG1lcmdlZCBpbnRvICR7ZXhpc3Rpbmd9LCAke3BsdXJhbChyZW5hbWVkLCBcIm5vdGVcIil9IHVwZGF0ZWQuYCk7XG4gICAgICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgICAgfSxcbiAgICAgICAgb25DYW5jZWw6ICgpID0+IHRoaXMucmVuZGVyKCksXG4gICAgICB9KS5vcGVuKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCF1cGRhdGVOb3Rlcykge1xuICAgICAgYXdhaXQgYXBwbHlSZW5hbWUoeyB3aXRoTm90ZXM6IGZhbHNlIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICAvLyBTYW1lIGNvbG9yIGZvciBvbGQgYW5kIG5ldyBuYW1lOiB0aGUgbmV3IG9uZSB0YWtlcyBvdmVyIHRoZSBvbGQgb25lJ3NcbiAgICAvLyBvZmZzZXQgKHNlZSByZW5hbWVTdWJ0eXApLlxuICAgIG5ldyBDb25maXJtTW9kYWwodGhpcy5hcHAsIHtcbiAgICAgIHRpdGxlOiBbXG4gICAgICAgIFwiUmVuYW1lIFwiLFxuICAgICAgICBzdWJ0eXBOYW1lTm9kZSh0aGlzLnBsdWdpbiwgdHlwLCBzdWJ0eXApLFxuICAgICAgICBcIiB0byBcIixcbiAgICAgICAgc3VidHlwTmFtZU5vZGUodGhpcy5wbHVnaW4sIHR5cCwgdmFsdWUsIHN1YnR5cCksXG4gICAgICAgIFwiP1wiLFxuICAgICAgXSxcbiAgICAgIGJvZHk6IFtgJHtwbHVyYWwoY291bnRPZihzdWJ0eXApLCBcIm5vdGVcIil9IHdpbGwgYmUgdXBkYXRlZC5gXSxcbiAgICAgIGNvbmZpcm1UZXh0OiBcIlJlbmFtZVwiLFxuICAgICAgZm9jdXM6IFwiY29uZmlybVwiLFxuICAgICAgb25Db25maXJtOiAoKSA9PiBhcHBseVJlbmFtZSh7IHdpdGhOb3RlczogdHJ1ZSB9KSxcbiAgICAgIG9uQ2FuY2VsOiAoKSA9PiB0aGlzLnJlbmRlcigpLFxuICAgIH0pLm9wZW4oKTtcbiAgfVxuXG4gIC8vIExpa2UgdGhlIHVucmVnaXN0ZXJlZCBlbnRyaWVzIG9mIHRoZSBUWVAtTGlzdDogU1VCVFlQIHZhbHVlcyBvZiB0aGlzIFRZUCdzXG4gIC8vIG5vdGVzIHRoYXQgaGF2ZSBubyBibG9jayB5ZXQgKG5vdGVzIHdpdGhvdXQgYW55IFNVQlRZUCBjb3VudCBmb3IgdGhlXG4gIC8vIFRZUC1Gcm9udG1hdHRlciBpbnN0ZWFkKS4gU2hvd24gbGlrZSBTdWJ0eXAgYmxvY2tzLCBidXQgb25seSBoZWFkaW5nIGFuZFxuICAvLyBjb3VudC4gQSBjbGljayBvbiB0aGUgYmxvY2sgcmVnaXN0ZXJzIHRoZSB2YWx1ZTsgYSBjbGljayBvbiB0aGUgbmFtZSBvcGVuc1xuICAvLyB0aGUgc2VhcmNoIGluc3RlYWQgLSBjaGVja2luZyB3aGF0IGEgdmFsdWUgaG9sZHMgYmVmb3JlIHJlZ2lzdGVyaW5nIGl0IGlzXG4gIC8vIHRoZSBjb21tb24gY2FzZS4gVGhlIG5hbWUgbGlnaHRzIHVwIGluIGFjY2VudCBjb2xvciBvbiBob3ZlciB0byBzaG93IGl0XG4gIC8vIGRvZXMgc29tZXRoaW5nIGRpZmZlcmVudCBmcm9tIHRoZSBhcmVhIGFyb3VuZCBpdC5cbiAgcmVuZGVyVW5yZWdpc3RlcmVkU3VidHlwcyhwYXJlbnQsIHR5cCwgYnVja2V0KSB7XG4gICAgY29uc3QgcmVnaXN0ZXJlZCA9IGdldFN1YnR5cE5hbWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXApO1xuICAgIGNvbnN0IHVucmVnaXN0ZXJlZCA9IFsuLi5idWNrZXQuY291bnRzLmtleXMoKV1cbiAgICAgIC5maWx0ZXIoKGtleSkgPT4gIXJlZ2lzdGVyZWQuaW5jbHVkZXMoa2V5KSlcbiAgICAgIC5zb3J0KChhLCBiKSA9PiBidWNrZXQuY291bnRzLmdldChiKSAtIGJ1Y2tldC5jb3VudHMuZ2V0KGEpIHx8IGEubG9jYWxlQ29tcGFyZShiKSk7XG4gICAgaWYgKHVucmVnaXN0ZXJlZC5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgIGNvbnN0IGxpc3RFbCA9IHBhcmVudC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLXN1YnR5cC11bnJlZ2lzdGVyZWQtbGlzdFwiIH0pO1xuICAgIGZvciAoY29uc3Qga2V5IG9mIHVucmVnaXN0ZXJlZCkge1xuICAgICAgY29uc3QgYmxvY2sgPSBsaXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci1ibG9jayB0eXAtc3VidHlwLWJsb2NrIHR5cC1zdWJ0eXAtdW5yZWdpc3RlcmVkXCIgfSk7XG4gICAgICBjb25zdCBoZWFkZXIgPSBibG9jay5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLWhlYWRlclwiIH0pO1xuICAgICAgY29uc3QgdGl0bGVHcm91cCA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLXRpdGxlLWdyb3VwXCIgfSk7XG4gICAgICBjb25zdCB0aXRsZUVsID0gdGl0bGVHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIsIHRleHQ6IGRpc3BsYXlUeXBLZXkoa2V5KSB9KTtcbiAgICAgIHRpdGxlR3JvdXAuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtc3VidHlwLWNvdW50XCIsIHRleHQ6IFN0cmluZyhidWNrZXQuY291bnRzLmdldChrZXkpKSB9KTtcbiAgICAgIGJsb2NrLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnJlZ2lzdGVyU3VidHlwKHR5cCwga2V5LCBidWNrZXQpKTtcbiAgICAgIC8vIHN0b3BQcm9wYWdhdGlvbiwgb3IgdGhlIHNhbWUgY2xpY2sgd291bGQgYWxzbyByZWdpc3RlciB0aGUgdmFsdWUgb25lXG4gICAgICAvLyBvbmx5IHdhbnRlZCB0byBsb29rIHVwLlxuICAgICAgdGhpcy5tYWtlU2VhcmNoYWJsZSh0aXRsZUVsLCAoKSA9PiB0aGlzLm9wZW5TdWJ0eXBTZWFyY2godHlwLCBrZXkpLCB7IHN0b3BQcm9wYWdhdGlvbjogdHJ1ZSB9KTtcbiAgICB9XG4gIH1cblxuICAvLyBBIG5hbWUgd2hvc2UgY2xpY2sgb3BlbnMgdGhlIHNlYXJjaDogcG9pbnRlciBjdXJzb3IgYW5kIGFjY2VudCBjb2xvciBvblxuICAvLyBob3ZlciAoLnR5cC1zZWFyY2hhYmxlKSwgc28gdGhlIHZpZXcgaXRzZWxmIHNob3dzIHdoZXJlIHNvbWV0aGluZyBoYXBwZW5zLlxuICAvLyBUaGUgbmFtZSBpcyB3aGVyZSBvbmUgZXhwZWN0cyBcInNob3cgbWUgdGhlc2Ugbm90ZXNcIi4gV2hpbGUgcmVuYW1pbmcsIHRoZVxuICAvLyBlbGVtZW50IGlzIGFuIGlucHV0IChpcy1iZWluZy1yZW5hbWVkKSBhbmQgYSBjbGljayBqdXN0IHBsYWNlcyB0aGUgY3Vyc29yLlxuICBtYWtlU2VhcmNoYWJsZShlbCwgb25TZWFyY2gsIHsgc3RvcFByb3BhZ2F0aW9uID0gZmFsc2UgfSA9IHt9KSB7XG4gICAgZWwuYWRkQ2xhc3MoXCJ0eXAtc2VhcmNoYWJsZVwiKTtcbiAgICBlbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoZWwuaGFzQ2xhc3MoXCJpcy1iZWluZy1yZW5hbWVkXCIpKSByZXR1cm47XG4gICAgICBpZiAoc3RvcFByb3BhZ2F0aW9uKSBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIG9uU2VhcmNoKCk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBzdWJ0eXBLZXkgPT09IG51bGwgbWVhbnMgbm90ZXMgb2YgdGhpcyBUWVAgd2l0aG91dCBTVUJUWVAuIEEgbGlzdCBoYXMgbm9cbiAgLy8gZXhhY3Qgc2VhcmNoIHN5bnRheCAoYXMgaW4gb3BlblNlYXJjaCgpKSwgc28gaXQgc2VhcmNoZXMgbm90ZXMgY2FycnlpbmcgYWxsXG4gIC8vIGl0cyBpdGVtcy5cbiAgb3BlblN1YnR5cFNlYXJjaCh0eXAsIHN1YnR5cEtleSkge1xuICAgIGNvbnN0IGdsb2JhbFNlYXJjaCA9IHRoaXMucGx1Z2luLmFwcC5pbnRlcm5hbFBsdWdpbnMuZ2V0UGx1Z2luQnlJZChcImdsb2JhbC1zZWFyY2hcIik7XG4gICAgaWYgKCFnbG9iYWxTZWFyY2gpIHJldHVybjtcbiAgICBjb25zdCB0eXBDbGF1c2UgPSB0aGlzLnR5cENsYXVzZSh0eXApO1xuICAgIGxldCBzdWJ0eXBDbGF1c2U7XG4gICAgaWYgKHN1YnR5cEtleSA9PT0gbnVsbCkge1xuICAgICAgc3VidHlwQ2xhdXNlID0gYC1bXCIke1NVQlRZUF9QUk9QRVJUWX1cIl1gO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCByYXcgPSB0aGlzLnBsdWdpbi50eXBJbmRleC5zdWJ0eXBCdWNrZXQodHlwKS5yYXdCeUtleS5nZXQoc3VidHlwS2V5KTtcbiAgICAgIHN1YnR5cENsYXVzZSA9IEFycmF5LmlzQXJyYXkocmF3KVxuICAgICAgICA/IHJhdy5tYXAoKHYpID0+IGBbXCIke1NVQlRZUF9QUk9QRVJUWX1cIjpcIiR7U3RyaW5nKHYgPz8gXCJcIikudHJpbSgpfVwiXWApLmpvaW4oXCIgXCIpXG4gICAgICAgIDogYFtcIiR7U1VCVFlQX1BST1BFUlRZfVwiOlwiJHtzdWJ0eXBLZXl9XCJdYDtcbiAgICB9XG4gICAgZ2xvYmFsU2VhcmNoLmluc3RhbmNlLm9wZW5HbG9iYWxTZWFyY2goYCR7dHlwQ2xhdXNlfSAke3N1YnR5cENsYXVzZX1gKTtcbiAgfVxuXG4gIC8vIExpa2UgcmVnaXN0ZXJUeXAoKTogcmVnaXN0ZXJzIHRoZSBjbGVhbmVkIGZvcm0gKHRpdGxlIGNhc2UsIGEgbGlzdCBhcyBvbmVcbiAgLy8gdmFsdWUgXCJBLCBCXCIpIGFzIGEgU3VidHlwIG9mIHRoaXMgVFlQIGFuZCByZXdyaXRlcyB0aGUgU1VCVFlQIG9mIHRoZVxuICAvLyBhZmZlY3RlZCBub3Rlcy4gSWYgdGhlIFN1YnR5cCBleGlzdHMgaW4gYW5vdGhlciBzcGVsbGluZywgdGhlIG5vdGVzIGdvXG4gIC8vIHRoZXJlLlxuICBhc3luYyByZWdpc3RlclN1YnR5cCh0eXAsIHN1YnR5cEtleSwgYnVja2V0KSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5hcHBseVN1YnR5cFJlZ2lzdHJhdGlvbih0eXAsIHN1YnR5cEtleSwgYnVja2V0KTtcbiAgICBpZiAoIXJlc3VsdCkgcmV0dXJuO1xuXG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgdGhpcy5yZWZyZXNoT3RoZXJWaWV3cygpO1xuICAgIHRoaXMucmVuZGVyKCk7XG4gICAgaWYgKHJlc3VsdC5yZW5hbWVkID4gMCkgbmV3IE5vdGljZShgU3VidHlwICR7cmVzdWx0LnN1YnR5cH0gcmVnaXN0ZXJlZCwgJHtwbHVyYWwocmVzdWx0LnJlbmFtZWQsIFwibm90ZVwiKX0gdXBkYXRlZC5gKTtcbiAgfVxuXG4gIC8vIExpa2UgYXBwbHlUeXBSZWdpc3RyYXRpb246IHRoZSBjb3JlIHdpdGhvdXQgc2F2aW5nIGFuZCBub3RpY2UsIHNvXG4gIC8vIHJlZ2lzdGVyVHlwV2l0aFN1YnR5cCgpIGNhbiBidW5kbGUgaXQuIFJldHVybnMgeyBzdWJ0eXAsIHJlbmFtZWQgfSBvciBudWxsLlxuICBhc3luYyBhcHBseVN1YnR5cFJlZ2lzdHJhdGlvbih0eXAsIHN1YnR5cEtleSwgYnVja2V0KSB7XG4gICAgY29uc3QgcmF3ID0gYnVja2V0LnJhd0J5S2V5LmdldChzdWJ0eXBLZXkpO1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVSYXdUeXAocmF3ID09PSB1bmRlZmluZWQgPyBzdWJ0eXBLZXkgOiByYXcsIG5vcm1hbGl6ZVN1YnR5cE5hbWUpO1xuICAgIGlmICghbm9ybWFsaXplZCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgZXhpc3RpbmcgPSBnZXRTdWJ0eXBOYW1lcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwKS5maW5kKChuYW1lKSA9PiBuYW1lLnRvTG93ZXJDYXNlKCkgPT09IG5vcm1hbGl6ZWQudG9Mb3dlckNhc2UoKSk7XG4gICAgY29uc3Qgc3VidHlwID0gZXhpc3RpbmcgPz8gbm9ybWFsaXplZDtcbiAgICBlbnN1cmVTdWJ0eXAodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKTtcblxuICAgIGNvbnN0IHJlbmFtZWQgPSBzdWJ0eXAgIT09IHN1YnR5cEtleSA/IGF3YWl0IHJlbmFtZVN1YnR5cEluTm90ZXModGhpcy5wbHVnaW4sIHR5cCwgc3VidHlwS2V5LCBzdWJ0eXApIDogMDtcbiAgICByZXR1cm4geyBzdWJ0eXAsIHJlbmFtZWQgfTtcbiAgfVxuXG4gIC8vIEEgbmV3LCBlbXB0eSBTdWJ0eXAgYmxvY2sgcmlnaHQgYWJvdmUgdGhlIFwiQWRkIFN1YnR5cFwiIGJ1dHRvbiwgaXRzIG5hbWVcbiAgLy8gdHlwZWQgaW5saW5lIChsaWtlIHN0YXJ0QWRkKCkgaW4gdGhlIGxpc3QpLlxuICBzdGFydEFkZFN1YnR5cCh0eXApIHtcbiAgICBpZiAodGhpcy5pc0VkaXRpbmcgfHwgIXRoaXMuc3VidHlwQWRkQnRuRWwpIHJldHVybjtcblxuICAgIC8vIEJ1aWx0IGxpa2UgdGhlIGZpbmlzaGVkIChlbXB0eSkgYmxvY2ssIHdpdGggdGhlIFwiK1wiIGJ1dHRvbnMgYW5kIGZvb3RlclxuICAgIC8vIGFjdGlvbnMgdGhhdCBkbyBub3RoaW5nIHlldCwganVzdCB3aXRob3V0IGEgY291bnQgLSBzbyBub3RoaW5nIGp1bXBzXG4gICAgLy8gd2hlbiB0aGUgaW5wdXQgaXMgZG9uZSAoc2VlIC50eXAtc3VidHlwLXBlbmRpbmcpLlxuICAgIGNvbnN0IGJsb2NrID0gY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci1ibG9jayB0eXAtc3VidHlwLWJsb2NrIHR5cC1zdWJ0eXAtcGVuZGluZ1wiIH0pO1xuICAgIHRoaXMuc3VidHlwQWRkQnRuRWwucGFyZW50RWxlbWVudC5pbnNlcnRCZWZvcmUoYmxvY2ssIHRoaXMuc3VidHlwQWRkQnRuRWwpO1xuICAgIGNvbnN0IGhlYWRlciA9IGJsb2NrLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZnJvbnRtYXR0ZXItaGVhZGVyXCIgfSk7XG4gICAgY29uc3QgdGl0bGVHcm91cCA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLXRpdGxlLWdyb3VwXCIgfSk7XG4gICAgY29uc3QgbmFtZUVsID0gdGl0bGVHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlIHR5cC1zdWJ0eXAtbmFtZS1pbnB1dCBpcy1iZWluZy1yZW5hbWVkXCIgfSk7XG4gICAgY29uc3QgYWRkQnV0dG9ucyA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLWFkZC1ncm91cFwiIH0pO1xuICAgIHNldEljb24oYWRkQnV0dG9ucy5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWZyb250bWF0dGVyLWFkZC1mbG9hdGluZ1wiIH0pLCBcInBsdXNcIik7XG4gICAgc2V0SWNvbihhZGRCdXR0b25zLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtZnJvbnRtYXR0ZXItYWRkXCIgfSksIFwicGx1c1wiKTtcbiAgICBjb25zdCBmb290ZXIgPSBibG9jay5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLXNlY3Rpb24tZm9vdGVyIHR5cC1zdWJ0eXAtYWN0aW9uc1wiIH0pO1xuICAgIGNvbnN0IGNvbG9yR3JvdXAgPSBmb290ZXIuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zdWJ0eXAtY29sb3ItZ3JvdXBcIiB9KTtcbiAgICBwYWludENvbG9yRG90KGNvbG9yR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zdWJ0eXAtY29sb3ItZG90XCIgfSksIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdID8/IERFRkFVTFRfVFlQX0NPTE9SLCB0cnVlKTtcbiAgICBzZXRJY29uKGNvbG9yR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1jb2xvci1yZXNldCBpcy1kaXNhYmxlZFwiIH0pLCBcInJvdGF0ZS1jY3dcIik7XG4gICAgY29uc3QgYWN0aW9ucyA9IGZvb3Rlci5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLXN1YnR5cC1hY3Rpb24tZ3JvdXBcIiB9KTtcbiAgICBzZXRJY29uKGFjdGlvbnMuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1kZXRhaWwtcmVuYW1lLW5vdGVzXCIgfSksIFwicGVuY2lsXCIpO1xuICAgIHNldEljb24oYWN0aW9ucy5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWRldGFpbC1yZW5hbWVcIiB9KSwgXCJwZW5jaWxcIik7XG4gICAgLy8gVGhlIHN0YXRlIGVuc3VyZVN1YnR5cCB3aWxsIGdpdmUgdGhlIG5ldyBTdWJ0eXA6IHRoYXQgb2YgaXRzIFRZUC5cbiAgICBjb25zdCBtYW51YWxDbHMgPSBcImNsaWNrYWJsZS1pY29uIHR5cC1tYW51YWwtaWNvblwiICsgKHRoaXMuZW5zdXJlVHlwTWFudWFsKClbdHlwXSAhPT0gZmFsc2UgPyBcIiBpcy1hY3RpdmVcIiA6IFwiXCIpO1xuICAgIHNldEljb24oYWN0aW9ucy5jcmVhdGVEaXYoeyBjbHM6IG1hbnVhbENscyB9KSwgXCJmaWxlLXBlbi1saW5lXCIpO1xuICAgIHNldEljb24oYWN0aW9ucy5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWRldGFpbC1kZWxldGVcIiB9KSwgXCJ0cmFzaFwiKTtcblxuICAgIHRoaXMuc3RhcnRJbmxpbmVFZGl0KG5hbWVFbCwge1xuICAgICAgLy8gbmFtZUVsIGNhcnJpZXMgdGhlIGlucHV0IGNsYXNzZXMgZnJvbSB0aGUgc3RhcnQuXG4gICAgICBjbGFzc2VzOiBbXSxcbiAgICAgIG9uRmluaXNoOiBhc3luYyAoY29tbWl0LCB0ZXh0KSA9PiB7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gbm9ybWFsaXplU3VidHlwTmFtZSh0ZXh0KTtcbiAgICAgICAgaWYgKGNvbW1pdCAmJiB2YWx1ZSkge1xuICAgICAgICAgIGNvbnN0IGV4aXN0aW5nID0gZ2V0U3VidHlwTmFtZXModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCkuZmluZCgobmFtZSkgPT4gbmFtZS50b0xvd2VyQ2FzZSgpID09PSB2YWx1ZS50b0xvd2VyQ2FzZSgpKTtcbiAgICAgICAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoYCR7dHlwfSBhbHJlYWR5IGhhcyBTdWJ0eXAgJHtleGlzdGluZ30uYCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGVuc3VyZVN1YnR5cCh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCB2YWx1ZSk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICAvLyBOb3RlcyBrZWVwIHRoZWlyIFRZUCAoaXQgdGhlbiBzaG93cyBhcyB1bnJlZ2lzdGVyZWQpLCBzbyB0aGlzIG9ubHkgY2hhbmdlc1xuICAvLyBzZXR0aW5nczogVW5kbyBhZnRlcndhcmRzLCBhbmQgdGhlIGNvbmZpcm1hdGlvbiBjYW4gYmUgc3dpdGNoZWQgb2ZmIChzZWVcbiAgLy8gY29uZmlybURlbGV0aW9uKS4gRnJvbSB0aGUgZGV0YWlsIGhlYWRlciBvciB0aGUgbGlzdCdzIGNvbnRleHQgbWVudS5cbiAgc2hvd0RlbGV0ZUNvbmZpcm0odHlwKSB7XG4gICAgY29uc3QgYXBwbHkgPSBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBzbmFwc2hvdCA9IHNuYXBzaG90U2V0dGluZ3ModGhpcy5wbHVnaW4pO1xuICAgICAgZGVsZXRlVHlwU2V0dGluZ3ModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCk7XG4gICAgICAvLyBCYWNrIHRvIHRoZSBsaXN0IChvciB0aGUgbGlzdCByZWJ1aWx0KSByaWdodCBhd2F5LCBzbyB0aGUgZGVsZXRlZFxuICAgICAgLy8gVFlQJ3Mgbm93IGVtcHR5IGRldGFpbCB2aWV3IG5ldmVyIHNob3dzLlxuICAgICAgaWYgKHRoaXMuc2VsZWN0ZWRUeXAgPT09IHR5cCkgdGhpcy5jbG9zZVR5cFNldHRpbmdzKCk7XG4gICAgICBlbHNlIHRoaXMucmVuZGVyKCk7XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgIG9mZmVyVW5kbyh0aGlzLnBsdWdpbiwgYFRZUCAke3R5cH0gZGVsZXRlZC5gLCBzbmFwc2hvdCk7XG4gICAgICB0aGlzLnJlZnJlc2hPdGhlclZpZXdzKCk7XG4gICAgfTtcbiAgICB0aGlzLmNvbmZpcm1EZWxldGlvbihcbiAgICAgIHsgdGl0bGU6IFtcIkRlbGV0ZSBcIiwgdHlwTmFtZU5vZGUodGhpcy5wbHVnaW4sIHR5cCwgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPz8gbnVsbCksIFwiP1wiXSB9LFxuICAgICAgYXBwbHlcbiAgICApO1xuICB9XG5cbiAgLy8gXCJSZW5hbWVcIiAvIFwiUmVuYW1lIGFuZCB1cGRhdGUgbm90ZXNcIiBmcm9tIHRoZSBsaXN0J3MgY29udGV4dCBtZW51OiB0aGVcbiAgLy8gbmFtZSBpbiB0aGUgcm93IGJlY29tZXMgdGhlIGlucHV0LCB0aGUgcmVzdCBpcyB0aGUgc2FtZSBhcyBpbiB0aGUgZGV0YWlsXG4gIC8vIHZpZXcgKGNvbW1pdFR5cFJlbmFtZSkuXG4gIHN0YXJ0TGlzdFJlbmFtZSh0eXAsIHNlbGYsIG5hbWVFbCwgb3B0aW9ucyA9IHt9KSB7XG4gICAgaWYgKHRoaXMuaXNFZGl0aW5nKSByZXR1cm47XG4gICAgLy8gQSBkcmFnZ2FibGUgcm93IChtYW51YWwgc29ydGluZykgd291bGQgdGFrZSB0aGUgbW91c2UgYXdheSBmcm9tIHRoZVxuICAgIC8vIHRleHQgLSBubyBjdXJzb3IgcGxhY2VtZW50IG9yIHNlbGVjdGlvbiBpbiB0aGUgbmFtZS4gcmVuZGVyKCkgcmVidWlsZHNcbiAgICAvLyB0aGUgcm93IGFmdGVyd2FyZHMuXG4gICAgc2VsZi5kcmFnZ2FibGUgPSBmYWxzZTtcbiAgICB0aGlzLnN0YXJ0SW5saW5lRWRpdChuYW1lRWwsIHtcbiAgICAgIGNsYXNzRWw6IHNlbGYsXG4gICAgICBvbkZpbmlzaDogKGNvbW1pdCwgdGV4dCkgPT4gKGNvbW1pdCA/IHRoaXMuY29tbWl0VHlwUmVuYW1lKHR5cCwgdGV4dCwgb3B0aW9ucykgOiB0aGlzLnJlbmRlcigpKSxcbiAgICB9KTtcbiAgfVxuXG4gIC8vIFRoZSByZW5hbWUgYnV0dG9ucyBvZiB0aGUgZGV0YWlsIGhlYWRlciwgb24gdGhlIHRpdGxlLlxuICBzdGFydERldGFpbFJlbmFtZSh0eXAsIHRpdGxlRWwsIG9wdGlvbnMgPSB7fSkge1xuICAgIHRoaXMuc3RhcnRJbmxpbmVFZGl0KHRpdGxlRWwsIHtcbiAgICAgIG9uRmluaXNoOiAoY29tbWl0LCB0ZXh0KSA9PiAoY29tbWl0ID8gdGhpcy5jb21taXRUeXBSZW5hbWUodHlwLCB0ZXh0LCBvcHRpb25zKSA6IHRoaXMucmVuZGVyKCkpLFxuICAgIH0pO1xuICB9XG5cbiAgLy8gVGhlIHJlbmFtZSBpdHNlbGYsIHNoYXJlZCBieSBsaXN0IGFuZCBkZXRhaWwgdmlldy4gdXBkYXRlTm90ZXM6IHRydWUgKHRoZVxuICAvLyBoaWdobGlnaHRlZCBidXR0b24pIGFsc28gcmV3cml0ZXMgdGhlIFRZUCBvZiBldmVyeSBhZmZlY3RlZCBub3RlIGFmdGVyXG4gIC8vIGNvbmZpcm1hdGlvbiAoc2VlIHJlbmFtZVR5cEluTm90ZXMpIGluc3RlYWQgb2Ygb25seSB0aGUgc2V0dGluZ3MuIEFuXG4gIC8vIGV4aXN0aW5nIG5hbWUgb2ZmZXJzIGEgbWVyZ2UgKHNob3dNZXJnZUNvbmZpcm0pLlxuICBhc3luYyBjb21taXRUeXBSZW5hbWUodHlwLCByYXdUZXh0LCB7IHVwZGF0ZU5vdGVzID0gZmFsc2UgfSA9IHt9KSB7XG4gICAgY29uc3QgdmFsdWUgPSBub3JtYWxpemVUeXBOYW1lKHJhd1RleHQpO1xuICAgIGlmICghdmFsdWUgfHwgdmFsdWUgPT09IHR5cCkge1xuICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBleGlzdGluZyA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cHMuZmluZCgodCkgPT4gdC50b0xvd2VyQ2FzZSgpID09PSB2YWx1ZS50b0xvd2VyQ2FzZSgpICYmIHQgIT09IHR5cCk7XG4gICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICB0aGlzLnNob3dNZXJnZUNvbmZpcm0odHlwLCBleGlzdGluZyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCF1cGRhdGVOb3Rlcykge1xuICAgICAgYXdhaXQgdGhpcy5yZW5hbWVUeXBTZXR0aW5ncyh0eXAsIHZhbHVlKTtcbiAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gQSBidWxrIHdyaXRlIGFjcm9zcyBwb3NzaWJseSBtYW55IGZpbGVzIC0gY29uZmlybSBmaXJzdC4gU2FtZSBjb2xvciBmb3JcbiAgICAvLyBvbGQgYW5kIG5ldyBuYW1lOiB0aGUgbmV3IG9uZSBoYXMgbm8gdHlwQ29sb3JzIGVudHJ5IHlldCBidXQgdGFrZXMgb3ZlclxuICAgIC8vIHRoZSBvbGQgb25lJ3MgKHNlZSByZW5hbWVUeXBTZXR0aW5ncykuXG4gICAgY29uc3QgeyBjb3VudHMgfSA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnR5cENvdW50cygpO1xuICAgIGNvbnN0IGNvbG9yID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPz8gbnVsbDtcbiAgICBuZXcgQ29uZmlybU1vZGFsKHRoaXMuYXBwLCB7XG4gICAgICB0aXRsZTogW1wiUmVuYW1lIFwiLCB0eXBOYW1lTm9kZSh0aGlzLnBsdWdpbiwgdHlwLCBjb2xvciksIFwiIHRvIFwiLCB0eXBOYW1lTm9kZSh0aGlzLnBsdWdpbiwgdmFsdWUsIGNvbG9yKSwgXCI/XCJdLFxuICAgICAgYm9keTogW2Ake3BsdXJhbChjb3VudHMuZ2V0KHR5cCkgPz8gMCwgXCJub3RlXCIpfSB3aWxsIGJlIHVwZGF0ZWQuYF0sXG4gICAgICBjb25maXJtVGV4dDogXCJSZW5hbWVcIixcbiAgICAgIGZvY3VzOiBcImNvbmZpcm1cIixcbiAgICAgIG9uQ29uZmlybTogYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLnJlbmFtZVR5cFNldHRpbmdzKHR5cCwgdmFsdWUpO1xuICAgICAgICBjb25zdCByZW5hbWVkID0gYXdhaXQgcmVuYW1lVHlwSW5Ob3Rlcyh0aGlzLnBsdWdpbiwgdHlwLCB2YWx1ZSk7XG4gICAgICAgIG5ldyBOb3RpY2UoYFRZUCAke3ZhbHVlfTogJHtwbHVyYWwocmVuYW1lZCwgXCJub3RlXCIpfSB1cGRhdGVkLmApO1xuICAgICAgICB0aGlzLnJlbmRlcigpO1xuICAgICAgfSxcbiAgICAgIG9uQ2FuY2VsOiAoKSA9PiB0aGlzLnJlbmRlcigpLFxuICAgIH0pLm9wZW4oKTtcbiAgfVxuXG4gIC8vIE1vdmVzIG9ubHkgdGhlIHNldHRpbmdzIChsaXN0IHBvc2l0aW9uLCBjb2xvciwgZGVzY3JpcHRpb24sXG4gIC8vIFRZUC1Gcm9udG1hdHRlciwgbWFudWFsIHRvZ2dsZSwgU3VidHlwcyAtIHNlZSB0eXAtc2V0dGluZ3MuanMpIHRvIHRoZSBuZXdcbiAgLy8gbmFtZTsgdG91Y2hlcyBubyBub3Rlcy4gQW4gb3BlbiBkZXRhaWwgdmlldyBmb2xsb3dzIHRoZSBuZXcgbmFtZSwgYVxuICAvLyByZW5hbWUgZnJvbSB0aGUgbGlzdCBzdGF5cyBpbiB0aGUgbGlzdC5cbiAgYXN5bmMgcmVuYW1lVHlwU2V0dGluZ3ModHlwLCB2YWx1ZSkge1xuICAgIG1vdmVUeXBTZXR0aW5ncyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCB2YWx1ZSk7XG4gICAgaWYgKHRoaXMuc2VsZWN0ZWRUeXAgPT09IHR5cCkgdGhpcy5zZWxlY3RlZFR5cCA9IHZhbHVlO1xuICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgIHRoaXMucmVmcmVzaE90aGVyVmlld3MoKTtcbiAgfVxuXG4gIC8vIFJlbmFtaW5nIHRvIHRoZSBuYW1lIG9mIGFuIGFscmVhZHkgcmVnaXN0ZXJlZCBUWVAgKHNlZSBjb21taXRUeXBSZW5hbWUpXG4gIC8vIG9mZmVycyB0byBtZXJnZSBib3RoIChzZWUgbWVyZ2VUeXApIGluc3RlYWQgb2Ygc2lsZW50bHkgZHJvcHBpbmcgdGhlXG4gIC8vIHJlbmFtZS4gSXQgYWx3YXlzIHJld3JpdGVzIHRoZSBub3Rlcywgd2hpY2hldmVyIHJlbmFtZSBidXR0b24gc3RhcnRlZCBpdDpcbiAgLy8gYSBtZXJnZSBpbiB0aGUgc2V0dGluZ3Mgb25seSB3b3VsZCBsZWF2ZSB0aGUgc291cmNlIFRZUCdzIG5vdGVzIGFzIGFuXG4gIC8vIHVucmVnaXN0ZXJlZCBlbnRyeS5cbiAgc2hvd01lcmdlQ29uZmlybShzb3VyY2UsIHRhcmdldCkge1xuICAgIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHRoaXMucGx1Z2luO1xuICAgIGNvbnN0IGNvdW50ID0gdGhpcy5wbHVnaW4udHlwSW5kZXgudHlwQ291bnRzKCkuY291bnRzLmdldChzb3VyY2UpID8/IDA7XG4gICAgbmV3IENvbmZpcm1Nb2RhbCh0aGlzLmFwcCwge1xuICAgICAgdGl0bGU6IFtcbiAgICAgICAgXCJNZXJnZSBcIixcbiAgICAgICAgdHlwTmFtZU5vZGUodGhpcy5wbHVnaW4sIHNvdXJjZSwgc2V0dGluZ3MudHlwQ29sb3JzW3NvdXJjZV0gPz8gbnVsbCksXG4gICAgICAgIFwiIGludG8gXCIsXG4gICAgICAgIHR5cE5hbWVOb2RlKHRoaXMucGx1Z2luLCB0YXJnZXQsIHNldHRpbmdzLnR5cENvbG9yc1t0YXJnZXRdID8/IG51bGwpLFxuICAgICAgICBcIj9cIixcbiAgICAgIF0sXG4gICAgICBib2R5OiBbXG4gICAgICAgIGAke3RhcmdldH0gYWxyZWFkeSBleGlzdHMuICR7cGx1cmFsKGNvdW50LCBcIm5vdGVcIil9ICR7Y291bnQgPT09IDEgPyBcIm1vdmVzXCIgOiBcIm1vdmVcIn0gdG8gaXQuIGAgK1xuICAgICAgICAgIGBUaGUgY29sb3IsIGRlc2NyaXB0aW9uIGFuZCBUWVAtRnJvbnRtYXR0ZXIgb2YgJHtzb3VyY2V9IGFyZSBkcm9wcGVkLiBgICtcbiAgICAgICAgICBgRXZlcnkgU3VidHlwIG1vdmVzIGFsb25nOyBibG9ja3Mgd2l0aCB0aGUgc2FtZSBuYW1lIGFyZSBtZXJnZWQuYCxcbiAgICAgIF0sXG4gICAgICBjb25maXJtVGV4dDogXCJNZXJnZVwiLFxuICAgICAgd2FybmluZzogdHJ1ZSxcbiAgICAgIGZvY3VzOiBcImNhbmNlbFwiLFxuICAgICAgb25Db25maXJtOiAoKSA9PiB0aGlzLm1lcmdlVHlwKHNvdXJjZSwgdGFyZ2V0KSxcbiAgICAgIG9uQ2FuY2VsOiAoKSA9PiB0aGlzLnJlbmRlcigpLFxuICAgIH0pLm9wZW4oKTtcbiAgfVxuXG4gIC8vIE1lcmdlcyBzb3VyY2UgaW50byB0YXJnZXQ6IG5vdGVzIGFyZSByZXdyaXR0ZW4gdG8gdGFyZ2V0LCBzb3VyY2UgbGVhdmVzXG4gIC8vIHRoZSBsaXN0IHdpdGggaXRzIHNldHRpbmdzICh0YXJnZXQga2VlcHMgaXRzIG93bikuIFNvdXJjZSdzIFN1YnR5cHMgbW92ZVxuICAvLyBvdmVyIGZpcnN0LCBzYW1lLW5hbWVkIGJsb2NrcyBhcmUgY29tYmluZWQgKHNlZSBtZXJnZVR5cFN1YnR5cHMgaW5cbiAgLy8gc3VidHlwcy5qcyk7IHRoZW4gdGhlIHJlc3Qgb2Ygc291cmNlIGdvZXMgbGlrZSBhIGRlbGV0ZWQgVFlQLlxuICAvL1xuICAvLyBcIk1hbnVhbGx5IGNyZWF0YWJsZVwiIGlzIHdoZXJlIGEgbWVyZ2UgZG9lcyBtb3JlIHRoYW4gbW92ZSBkYXRhOiB0aGUgbW92ZWRcbiAgLy8gU3VidHlwcyBicmluZyBzb3VyY2UncyB0b2dnbGVzIGJ1dCBlbmQgdXAgdW5kZXIgdGFyZ2V0J3MuIFdpdGggc291cmNlIG9uXG4gIC8vIGFuZCB0YXJnZXQgb2ZmIHRoZXkgd291bGQgYmUgc3dpdGNoZWQtb24gU3VidHlwcyB1bmRlciBhIHN3aXRjaGVkLW9mZiBUWVAsXG4gIC8vIHVucmVhY2hhYmxlIGluIHRoZSBwaWNrZXIuIFNvIGEgc3dpdGNoZWQtb2ZmIHRhcmdldCBzd2l0Y2hlcyB0aGVtIG9mZiB0b28sXG4gIC8vIGFzIGl0cyBvd24gYnV0dG9uIHdvdWxkIChzZWUgcmVuZGVyTWFudWFsVG9nZ2xlKS4gV2l0aCB0YXJnZXQgb24gdGhleSBzdGF5XG4gIC8vIGFzIHRoZXkgd2VyZS5cbiAgLy9cbiAgLy8gQW4gb3BlbiBkZXRhaWwgdmlldyBvZiBzb3VyY2UgbW92ZXMgdG8gdGFyZ2V0OyBhIG1lcmdlIHN0YXJ0ZWQgZnJvbSB0aGVcbiAgLy8gbGlzdCBzdGF5cyBpbiB0aGUgbGlzdC5cbiAgYXN5bmMgbWVyZ2VUeXAoc291cmNlLCB0YXJnZXQpIHtcbiAgICBjb25zdCBzZXR0aW5ncyA9IHRoaXMucGx1Z2luLnNldHRpbmdzO1xuICAgIGNvbnN0IHJlbmFtZWQgPSBhd2FpdCByZW5hbWVUeXBJbk5vdGVzKHRoaXMucGx1Z2luLCBzb3VyY2UsIHRhcmdldCk7XG5cbiAgICBtZXJnZVR5cFN1YnR5cHMoc2V0dGluZ3MsIHNvdXJjZSwgdGFyZ2V0KTtcbiAgICBkZWxldGVUeXBTZXR0aW5ncyhzZXR0aW5ncywgc291cmNlKTtcbiAgICBpZiAodGhpcy5lbnN1cmVUeXBNYW51YWwoKVt0YXJnZXRdID09PSBmYWxzZSkgc2V0QWxsU3VidHlwc01hbnVhbChzZXR0aW5ncywgdGFyZ2V0LCBmYWxzZSk7XG5cbiAgICBpZiAodGhpcy5zZWxlY3RlZFR5cCA9PT0gc291cmNlKSB0aGlzLnNlbGVjdGVkVHlwID0gdGFyZ2V0O1xuICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgIHRoaXMucmVmcmVzaE90aGVyVmlld3MoKTtcbiAgICBuZXcgTm90aWNlKGBUWVAgJHtzb3VyY2V9IG1lcmdlZCBpbnRvICR7dGFyZ2V0fSwgJHtwbHVyYWwocmVuYW1lZCwgXCJub3RlXCIpfSB1cGRhdGVkLmApO1xuICAgIHRoaXMucmVuZGVyKCk7XG4gIH1cblxuICByZW5kZXJDb3VudEZsYWlyKHNlbGYsIGNvdW50KSB7XG4gICAgY29uc3QgZmxhaXJPdXRlciA9IHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1mbGFpci1vdXRlclwiIH0pO1xuICAgIGZsYWlyT3V0ZXIuY3JlYXRlU3Bhbih7IGNsczogXCJ0cmVlLWl0ZW0tZmxhaXJcIiwgdGV4dDogU3RyaW5nKGNvdW50KSB9KTtcbiAgfVxuXG4gIC8vIEV4cGxhaW5zIHRoZSBmbG9hdGluZyB0b2dnbGUgKHJpZ2h0LWNsaWNrIG9uIGEgcHJvcGVydHkgYWJvdmUsIHNlZVxuICAvLyBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaCkuIE5vIGhlYWRpbmcgLSByaWdodCBiZWxvdyB0aGUgbGlzdCBpdCBpcyBjbGVhclxuICAvLyB3aGF0IGl0IHJlZmVycyB0by5cbiAgcmVuZGVyRmxvYXRpbmdIaW50KHBhcmVudCkge1xuICAgIGNvbnN0IHNlY3Rpb24gPSBwYXJlbnQuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mbG9hdGluZy1oaW50LXNlY3Rpb25cIiB9KTtcbiAgICBzZWN0aW9uLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwidHlwLWZsb2F0aW5nLWhpbnRcIixcbiAgICAgIHRleHQ6IFwiUmlnaHQtY2xpY2sgYSBwcm9wZXJ0eSB0byBtYWtlIGl0IGZsb2F0aW5nLlwiLFxuICAgIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyVHlwUGFuZShwbHVnaW4pIHtcbiAgcGx1Z2luLnJlZ2lzdGVyVmlldyhWSUVXX1RZUEVfVFlQX1BBTkUsIChsZWFmKSA9PiBuZXcgVHlwUGFuZShsZWFmLCBwbHVnaW4pKTtcblxuICBwbHVnaW4uYWRkQ29tbWFuZCh7XG4gICAgaWQ6IFwib3Blbi10eXAtcGFuZVwiLFxuICAgIG5hbWU6IFwiT3BlbiBUWVAtUGFuZVwiLFxuICAgIGNhbGxiYWNrOiAoKSA9PiBhY3RpdmF0ZVR5cFBhbmUocGx1Z2luKSxcbiAgfSk7XG5cbiAgcGx1Z2luLmFkZENvbW1hbmQoe1xuICAgIGlkOiBcImFkZC10eXAtcHJvcGVydHlcIixcbiAgICBuYW1lOiBcIkFkZCBUWVAtRnJvbnRtYXR0ZXIgcHJvcGVydHlcIixcbiAgICBjYWxsYmFjazogKCkgPT4gYWRkVHlwUHJvcGVydHlDb21tYW5kKHBsdWdpbiksXG4gIH0pO1xuXG4gIC8vIE9uIGhvdCByZWxvYWQgdGhlIG9sZCBsZWFmIG9iamVjdCBzdXJ2aXZlcyAob25seSBvdXIgbW9kdWxlIHJlbG9hZHMpLCBidXRcbiAgLy8gXCJpbnN0YW5jZW9mIFR5cFBhbmVcIiBmYWlscyBhZ2FpbnN0IHRoZSByZWxvYWRlZCBjbGFzcywgYW5kIGdldFZpZXdUeXBlKClcbiAgLy8gY29tZXMgZnJvbSBsZWFmLnZpZXcgYWxvbmUuIGBhcHBgIHN1cnZpdmVzIHVuY2hhbmdlZCwgc28gdGhlIGxlYWZcbiAgLy8gcmVmZXJlbmNlIGlzIGtlcHQgdGhlcmUuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4gb3BlblR5cFBhbmVPblN0YXJ0KHBsdWdpbikpO1xuXG4gIC8vIGV4Y2VwdFZpZXc6IHRoZSBUWVAtUGFuZSB0aGF0IG1hZGUgdGhlIGNoYW5nZSBhbmQgdXBkYXRlcyBpdHNlbGYgKHNlZVxuICAvLyByZWZyZXNoVHlwQ29sb3JzRXhjZXB0IGluIG1haW4uanMpLlxuICBjb25zdCByZWZyZXNoID0gKGV4Y2VwdFZpZXcgPSBudWxsKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShWSUVXX1RZUEVfVFlQX1BBTkUpKSB7XG4gICAgICBpZiAobGVhZi52aWV3ID09PSBleGNlcHRWaWV3KSBjb250aW51ZTtcbiAgICAgIC8vIHJlbmRlcigpIGZvciBhIHZpZXcgb2YgdGhlIG1vZHVsZSBiZWZvcmUgYSBob3QgcmVsb2FkLlxuICAgICAgaWYgKGxlYWYudmlldz8ucmVxdWVzdFJlbmRlcikgbGVhZi52aWV3LnJlcXVlc3RSZW5kZXIoKTtcbiAgICAgIGVsc2UgbGVhZi52aWV3Py5yZW5kZXI/LigpO1xuICAgIH1cbiAgfTtcblxuICAvLyBLZWVwcyB0aGUgY291bnRzIGN1cnJlbnQgb24gZXZlcnkgVFlQLXJlbGV2YW50IGNoYW5nZSBlbHNld2hlcmUgKG5ldyBvclxuICAvLyBkZWxldGVkIG5vdGUsIFRZUCBvciBTVUJUWVAgY2hhbmdlZCkuIFRoZSBpbmRleCdzIFwiY2hhbmdlXCIgZmlyZXMgb25seSBmb3JcbiAgLy8gdGhvc2UsIG5vdCBvbiBldmVyeSBhdXRvc2F2ZS4gRGVib3VuY2VkIGFueXdheSBzaW5jZSByZW5kZXJpbmcgdGhlIGxpc3QgaXNcbiAgLy8gcmVsYXRpdmVseSBjb3N0bHk7IHJlc2V0VGltZXIgY29sbGVjdHMgYSBidXJzdCAoYnVsayBpbXBvcnQpIGludG8gb25lLlxuICAvLyBXaXRob3V0IHRoZSBldmVudCdzIGFyZ3VtZW50cywgd2hpY2ggYXJlbid0IGEgdmlldyB0byBsZWF2ZSBvdXQuXG4gIGNvbnN0IGRlYm91bmNlZFJlZnJlc2ggPSBkZWJvdW5jZSgoKSA9PiByZWZyZXNoKCksIDUwMCwgdHJ1ZSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCBkZWJvdW5jZWRSZWZyZXNoKSk7XG4gIC8vIFRoZSBcIkV4Y2x1ZGVkIGZpbGVzXCIgbGlzdCBjaGFuZ2VkIChIaWRlIEZvbGRlcnMgdG9nZ2xpbmcgYSBmb2xkZXIsIHNheSkuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAudmF1bHQub24oXCJjb25maWctY2hhbmdlZFwiLCBkZWJvdW5jZWRSZWZyZXNoKSk7XG5cbiAgLy8gRm9yIHBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzKEV4Y2VwdCk6IHJlLXJlbmRlcnMgdGhlIGxpc3Qgb3IgdGhlIGRldGFpbFxuICAvLyB2aWV3LlxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxuLy8gbG9jYWxTdG9yYWdlIGtleSAocGVyIHZhdWx0LCBzZWUgb3BlblR5cFBhbmVPblN0YXJ0KS5cbmNvbnN0IFBBTkVfQ1JFQVRFRF9LRVkgPSBcInR5cC1zeXN0ZW0tcGFuZS1jcmVhdGVkXCI7XG5cbi8vIFRoZSBhdXRvbWF0aWMgY2FsbCBvbmNlIHRoZSBsYXlvdXQgaXMgcmVhZHksIG9uIGV2ZXJ5IHN0YXJ0IGFuZCBob3QgcmVsb2FkLlxuLy8gTm9ybWFsbHkgaXQgb25seSByZWNvbm5lY3RzIGFuIGV4aXN0aW5nIGxlYWYgb3JwaGFuZWQgYnkgaG90IHJlbG9hZFxuLy8gKGNyZWF0ZUlmTWlzc2luZzogZmFsc2UpLCBzbyBhIHBhbmUgdGhhdCB3YXMgY2xvc2VkIHN0YXlzIGNsb3NlZC4gT25seSBvbiB0aGVcbi8vIHZlcnkgZmlyc3Qgc3RhcnQgaW4gdGhpcyB2YXVsdCAobm8gZGF0YS5qc29uIHlldCwgcGx1Z2luLmlzRmlyc3RSdW4pIGl0XG4vLyBjcmVhdGVzIHRoZSBwYW5lIGluIHRoZSBsZWZ0IHNpZGViYXIgYW5kIHJldmVhbHMgaXQsIHNvIGEgbmV3IHVzZXIgZmluZHMgaXRcbi8vIHdpdGhvdXQga25vd2luZyB0aGUgY29tbWFuZC5cbi8vIFwiQWxyZWFkeSBjcmVhdGVkXCIgaXMgcmVtZW1iZXJlZCBpbiB0aGlzIGRldmljZSdzIGxvY2FsU3RvcmFnZSBmb3IgdGhlIHZhdWx0XG4vLyAoYXBwLnNhdmVMb2NhbFN0b3JhZ2UpLCBub3QgaW4gZGF0YS5qc29uOiBkYXRhLmpzb24gaXMgc3RpbGwgbWlzc2luZyB0aGVuLFxuLy8gc28gYSBob3QgcmVsb2FkIHdvdWxkIG90aGVyd2lzZSBvcGVuIHRoZSBwYW5lIGFnYWluLiBXcml0aW5nIGRhdGEuanNvbiBqdXN0XG4vLyBmb3IgdGhpcyBtYXJrZXIgY291bGQgbGV0IFN5bmMgcHV0IGRlZmF1bHRzIG92ZXIgdGhlIHJlYWwgc2V0dGluZ3Mgb24gYVxuLy8gc2Vjb25kIGRldmljZSB3aGVyZSB0aGUgcGx1Z2luIGFycml2ZXMgYmVmb3JlIGl0cyBkYXRhLmpzb24uXG5hc3luYyBmdW5jdGlvbiBvcGVuVHlwUGFuZU9uU3RhcnQocGx1Z2luKSB7XG4gIGNvbnN0IGFwcCA9IHBsdWdpbi5hcHA7XG4gIGNvbnN0IGZpcnN0UnVuID0gcGx1Z2luLmlzRmlyc3RSdW4gJiYgIWFwcC5sb2FkTG9jYWxTdG9yYWdlKFBBTkVfQ1JFQVRFRF9LRVkpO1xuICBhd2FpdCBhY3RpdmF0ZVR5cFBhbmUocGx1Z2luLCBmaXJzdFJ1biwgZmlyc3RSdW4pO1xuICBpZiAoZmlyc3RSdW4pIGFwcC5zYXZlTG9jYWxTdG9yYWdlKFBBTkVfQ1JFQVRFRF9LRVksIHRydWUpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBhY3RpdmF0ZVR5cFBhbmUocGx1Z2luLCByZXZlYWwgPSB0cnVlLCBjcmVhdGVJZk1pc3NpbmcgPSB0cnVlKSB7XG4gIGNvbnN0IGFwcCA9IHBsdWdpbi5hcHA7XG4gIGNvbnN0IHsgd29ya3NwYWNlIH0gPSBhcHA7XG5cbiAgY29uc3QgY2FuZGlkYXRlcyA9IFtdO1xuICB3b3Jrc3BhY2UuaXRlcmF0ZUFsbExlYXZlcygobGVhZikgPT4ge1xuICAgIGlmIChcbiAgICAgIGxlYWYgPT09IGFwcC5fX3R5cFN5c3RlbUxlYWYgfHxcbiAgICAgIChsZWFmLnZpZXcgJiYgbGVhZi52aWV3LmdldFZpZXdUeXBlKCkgPT09IFZJRVdfVFlQRV9UWVBfUEFORSlcbiAgICApIHtcbiAgICAgIGNhbmRpZGF0ZXMucHVzaChsZWFmKTtcbiAgICB9XG4gIH0pO1xuXG4gIGxldCBsZWFmID0gY2FuZGlkYXRlcy5zaGlmdCgpID8/IG51bGw7XG4gIGZvciAoY29uc3QgZXh0cmEgb2YgY2FuZGlkYXRlcykgZXh0cmEuZGV0YWNoKCk7XG5cbiAgaWYgKCFsZWFmKSB7XG4gICAgaWYgKCFjcmVhdGVJZk1pc3NpbmcpIHJldHVybjtcbiAgICBsZWFmID0gd29ya3NwYWNlLmdldExlZnRMZWFmKGZhbHNlKTtcbiAgICBhd2FpdCBsZWFmLnNldFZpZXdTdGF0ZSh7IHR5cGU6IFZJRVdfVFlQRV9UWVBfUEFORSwgYWN0aXZlOiB0cnVlIH0pO1xuICB9IGVsc2UgaWYgKCEobGVhZi52aWV3IGluc3RhbmNlb2YgVHlwUGFuZSkpIHtcbiAgICAvLyBhY3RpdmU6IGZhbHNlIC0ganVzdCByZWNvbm5lY3RpbmcuIG9uTGF5b3V0UmVhZHkgZmlyZXMgYXQgb25jZSBvbmNlIHRoZVxuICAgIC8vIGxheW91dCBpcyByZWFkeSwgc28gYWN0aXZlOiB0cnVlIHdvdWxkIHN0ZWFsIGZvY3VzIG9uIGV2ZXJ5IGhvdCByZWxvYWQuXG4gICAgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoeyB0eXBlOiBWSUVXX1RZUEVfVFlQX1BBTkUsIGFjdGl2ZTogZmFsc2UgfSk7XG4gIH1cblxuICBhcHAuX190eXBTeXN0ZW1MZWFmID0gbGVhZjtcbiAgaWYgKHJldmVhbCkgd29ya3NwYWNlLnJldmVhbExlYWYobGVhZik7XG59XG5cbi8vIFByZWZlcnMgYW4gb3BlbiBUWVAtUGFuZSBkZXRhaWwgKGV4YWN0bHkgbGlrZSBpdHMgXCIrXCIgYnV0dG9uKTsgb3RoZXJ3aXNlXG4vLyBvcGVucyB0aGUgZGV0YWlsIHZpZXcgZm9yIHRoZSBhY3RpdmUgbm90ZSdzIFRZUCBhbmQgYWRkcyB0aGUgcHJvcGVydHkgdGhlcmUuXG4vLyBXaXRob3V0IGFuIG9wZW4gbm90ZSBvciBUWVAsIGEgVFlQLVBhbmUgc2hvd2luZyBhIGRldGFpbCB2aWV3IC0gZXZlblxuLy8gdW5mb2N1c2VkIC0gaXMgdGhlIGZhbGxiYWNrLiBUaGUgYmFyZSBsaXN0IGRvZXNuJ3QgY291bnQ6IGl0IGhhcyBubyBlZGl0b3Jcbi8vIHRvIGFkZCB0by5cbmFzeW5jIGZ1bmN0aW9uIGFkZFR5cFByb3BlcnR5Q29tbWFuZChwbHVnaW4pIHtcbiAgY29uc3QgYXBwID0gcGx1Z2luLmFwcDtcblxuICBjb25zdCBhY3RpdmVUeXBQYW5lID0gYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKFR5cFBhbmUpO1xuICBpZiAoYWN0aXZlVHlwUGFuZSAmJiBhY3RpdmVUeXBQYW5lLnNlbGVjdGVkVHlwICE9PSBudWxsKSB7XG4gICAgYWN0aXZlVHlwUGFuZS5mcm9udG1hdHRlckJsb2Nrcz8uYWRkQmxhbmsobnVsbCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgZmlsZSA9IGFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xuICBjb25zdCB0eXAgPSBwbHVnaW4udHlwSW5kZXgudHlwT2YoZmlsZSk7XG4gIGlmICghdHlwKSB7XG4gICAgY29uc3Qgb3BlbkxlYWYgPSBhcHAud29ya3NwYWNlXG4gICAgICAuZ2V0TGVhdmVzT2ZUeXBlKFZJRVdfVFlQRV9UWVBfUEFORSlcbiAgICAgIC5maW5kKChsZWFmKSA9PiBsZWFmLnZpZXcgaW5zdGFuY2VvZiBUeXBQYW5lICYmIGxlYWYudmlldy5zZWxlY3RlZFR5cCAhPT0gbnVsbCk7XG4gICAgaWYgKG9wZW5MZWFmKSB7XG4gICAgICBhd2FpdCBhcHAud29ya3NwYWNlLnJldmVhbExlYWYob3BlbkxlYWYpO1xuICAgICAgb3BlbkxlYWYudmlldy5mcm9udG1hdHRlckJsb2Nrcz8uYWRkQmxhbmsobnVsbCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIG5ldyBOb3RpY2UoXG4gICAgICBmaWxlXG4gICAgICAgID8gXCJUaGUgYWN0aXZlIG5vdGUgaGFzIG5vIFRZUCwgYW5kIG5vIFRZUCBpcyBvcGVuIGluIHRoZSBUWVAtUGFuZS5cIlxuICAgICAgICA6IFwiTm8gbm90ZSBpcyBvcGVuLCBhbmQgbm8gVFlQIGlzIG9wZW4gaW4gdGhlIFRZUC1QYW5lLlwiXG4gICAgKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBhd2FpdCBhY3RpdmF0ZVR5cFBhbmUocGx1Z2luKTtcbiAgY29uc3QgdmlldyA9IGFwcC5fX3R5cFN5c3RlbUxlYWY/LnZpZXc7XG4gIGlmICghKHZpZXcgaW5zdGFuY2VvZiBUeXBQYW5lKSkgcmV0dXJuO1xuICB2aWV3Lm9wZW5UeXBTZXR0aW5ncyh0eXApO1xuICB2aWV3LmZyb250bWF0dGVyQmxvY2tzPy5hZGRCbGFuayhudWxsKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyVHlwUGFuZSwgVklFV19UWVBFX1RZUF9QQU5FLCBjb21wYXJlVHlwcywgc29ydFR5cHNCeU1vZGUsIERFRkFVTFRfU09SVF9PUkRFUiwgREVGQVVMVF9UWVBfQ09MT1IgfTtcbiIsICJjb25zdCB7IFRGaWxlLCBURm9sZGVyIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IGNvbG9yRm9yRmlsZSwgc2V0SW5saW5lQ29sb3IgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5cbmNvbnN0IEZJTEVfRVhQTE9SRVJfVklFV19UWVBFID0gXCJmaWxlLWV4cGxvcmVyXCI7XG5jb25zdCBGT0xERVJfTk9URVNfUExVR0lOX0lEID0gXCJmb2xkZXItbm90ZXNcIjtcblxuLy8gRm9sZGVyIE5vdGVzIHNob3dzIGEgbm90ZSBhcyBpdHMgZm9sZGVyIGluc3RlYWQgb2YgYXMgaXRzIG93biByb3cuIEl0IGhhcyBub1xuLy8gcHVibGljIEFQSSBmb3IgdGhpcywgc28gdGhlIGZpbGUgbmFtZSBpcyByZWJ1aWx0IGZyb20gaXRzIGxpdmUgc2V0dGluZ3MuXG5mdW5jdGlvbiBnZXRGb2xkZXJOb3RlRmlsZShwbHVnaW4sIGZvbGRlcikge1xuICBjb25zdCBmb2xkZXJOb3RlcyA9IHBsdWdpbi5hcHAucGx1Z2lucy5wbHVnaW5zW0ZPTERFUl9OT1RFU19QTFVHSU5fSURdO1xuICBjb25zdCBzZXR0aW5ncyA9IGZvbGRlck5vdGVzPy5zZXR0aW5ncztcbiAgaWYgKCFzZXR0aW5ncykgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgZmlsZU5hbWUgPVxuICAgIChzZXR0aW5ncy5mb2xkZXJOb3RlTmFtZSB8fCBcInt7Zm9sZGVyX25hbWV9fVwiKS5yZXBsYWNlKFwie3tmb2xkZXJfbmFtZX19XCIsIGZvbGRlci5uYW1lKSArXG4gICAgKHNldHRpbmdzLmZvbGRlck5vdGVUeXBlIHx8IFwiLm1kXCIpO1xuICBjb25zdCBkaXJQYXRoID0gc2V0dGluZ3Muc3RvcmFnZUxvY2F0aW9uID09PSBcInBhcmVudEZvbGRlclwiID8gZm9sZGVyLnBhcmVudD8ucGF0aCA/PyBcIlwiIDogZm9sZGVyLnBhdGg7XG4gIGNvbnN0IHBhdGggPSBkaXJQYXRoID8gYCR7ZGlyUGF0aH0vJHtmaWxlTmFtZX1gIDogZmlsZU5hbWU7XG5cbiAgY29uc3QgZmlsZSA9IHBsdWdpbi5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHBhdGgpO1xuICByZXR1cm4gZmlsZSBpbnN0YW5jZW9mIFRGaWxlID8gZmlsZSA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIGFwcGx5Q29sb3JUb1RpdGxlKHBsdWdpbiwgdGl0bGVFbCwgZmlsZSkge1xuICBjb25zdCBjb250ZW50RWwgPSB0aXRsZUVsLnF1ZXJ5U2VsZWN0b3IoXCIubmF2LWZpbGUtdGl0bGUtY29udGVudCwgLm5hdi1mb2xkZXItdGl0bGUtY29udGVudFwiKTtcbiAgaWYgKCFjb250ZW50RWwpIHJldHVybjtcblxuICBjb25zdCBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmZpbGVFeHBsb3JlciA/IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIFwiZmlsZUV4cGxvcmVyXCIpIDogbnVsbDtcbiAgc2V0SW5saW5lQ29sb3IoY29udGVudEVsLCBjb2xvcik7XG59XG5cbmZ1bmN0aW9uIGFwcGx5RmlsZUV4cGxvcmVyQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEZJTEVfRVhQTE9SRVJfVklFV19UWVBFKSkge1xuICAgIGNvbnN0IGZpbGVUaXRsZUVscyA9IGxlYWYudmlldy5jb250YWluZXJFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLm5hdi1maWxlLXRpdGxlW2RhdGEtcGF0aF1cIik7XG4gICAgZm9yIChjb25zdCB0aXRsZUVsIG9mIGZpbGVUaXRsZUVscykge1xuICAgICAgY29uc3QgZmlsZSA9IHBsdWdpbi5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHRpdGxlRWwuZ2V0QXR0cmlidXRlKFwiZGF0YS1wYXRoXCIpKTtcbiAgICAgIGFwcGx5Q29sb3JUb1RpdGxlKHBsdWdpbiwgdGl0bGVFbCwgZmlsZSBpbnN0YW5jZW9mIFRGaWxlID8gZmlsZSA6IG51bGwpO1xuICAgIH1cblxuICAgIGNvbnN0IGZvbGRlclRpdGxlRWxzID0gbGVhZi52aWV3LmNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIubmF2LWZvbGRlci10aXRsZVtkYXRhLXBhdGhdXCIpO1xuICAgIGZvciAoY29uc3QgdGl0bGVFbCBvZiBmb2xkZXJUaXRsZUVscykge1xuICAgICAgY29uc3QgZm9sZGVyID0gcGx1Z2luLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgodGl0bGVFbC5nZXRBdHRyaWJ1dGUoXCJkYXRhLXBhdGhcIikpO1xuICAgICAgY29uc3Qgbm90ZUZpbGUgPSBmb2xkZXIgaW5zdGFuY2VvZiBURm9sZGVyID8gZ2V0Rm9sZGVyTm90ZUZpbGUocGx1Z2luLCBmb2xkZXIpIDogbnVsbDtcbiAgICAgIGFwcGx5Q29sb3JUb1RpdGxlKHBsdWdpbiwgdGl0bGVFbCwgbm90ZUZpbGUpO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlckZpbGVFeHBsb3JlckNvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5RmlsZUV4cGxvcmVyQ29sb3JzKHBsdWdpbik7XG5cbiAgLy8gVGhlIGV4cGxvcmVyIHJlLXJlbmRlcnMgcm93cyB3aGVuIGZvbGRlcnMgZXhwYW5kIG9yIGNvbGxhcHNlLlxuICBjb25zdCBvYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKHJlZnJlc2gpO1xuICBjb25zdCBvYnNlcnZlRXhwbG9yZXJMZWF2ZXMgPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShGSUxFX0VYUExPUkVSX1ZJRVdfVFlQRSkpIHtcbiAgICAgIG9ic2VydmVyLm9ic2VydmUobGVhZi52aWV3LmNvbnRhaW5lckVsLCB7IGNoaWxkTGlzdDogdHJ1ZSwgc3VidHJlZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiBvYnNlcnZlci5kaXNjb25uZWN0KCkpO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAudmF1bHQub24oXCJyZW5hbWVcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgb2JzZXJ2ZUV4cGxvcmVyTGVhdmVzKCk7XG4gICAgICByZWZyZXNoKCk7XG4gICAgfSlcbiAgKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICBvYnNlcnZlRXhwbG9yZXJMZWF2ZXMoKTtcbiAgICByZWZyZXNoKCk7XG4gIH0pO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJGaWxlRXhwbG9yZXJDb2xvcnMgfTtcbiIsICJjb25zdCB7IGNvbG9yRm9yRmlsZSB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxuY29uc3QgR1JBUEhfVklFV19UWVBFUyA9IFtcImdyYXBoXCIsIFwibG9jYWxncmFwaFwiXTtcblxuZnVuY3Rpb24gaGV4VG9JbnQoaGV4KSB7XG4gIHJldHVybiBwYXJzZUludChoZXgucmVwbGFjZShcIiNcIiwgXCJcIiksIDE2KTtcbn1cblxuLy8gZW5naW5lLnJlbmRlcigpIG9ubHkgY29uc3VsdHMgaXRzIGZpbGVGaWx0ZXIgb25jZSBhIGNvbG9yIGdyb3VwIGV4aXN0cztcbi8vIHdpdGhvdXQgb25lIGV2ZXJ5IGZpbGUganVzdCBnZXRzIGNvbG9yOnRydWUuIFNvIHdlIHBhdGNoIHJlbmRlcmVyLnNldERhdGEsXG4vLyByaWdodCBiZWZvcmUgdGhlIG5vZGUgZGF0YSByZWFjaGVzIHRoZSBXZWJHTCByZW5kZXJlciAtIHRoZSBzYW1lIHNwb3QgdGhlXG4vLyBjb21tdW5pdHkgcGx1Z2luIGdyYXBoLW5lc3RlZC10YWdzIHVzZXMuIE5vZGVzIGFscmVhZHkgY29sb3JlZCBieSBhIGNvbG9yXG4vLyBncm91cCBhcmUgbGVmdCBhbG9uZS5cbmZ1bmN0aW9uIHBhdGNoUmVuZGVyZXIocGx1Z2luLCByZW5kZXJlcikge1xuICBpZiAocmVuZGVyZXIuX190eXBTeXN0ZW1Db2xvclBhdGNoZWQpIHJldHVybjtcbiAgcmVuZGVyZXIuX190eXBTeXN0ZW1Db2xvclBhdGNoZWQgPSB0cnVlO1xuXG4gIGNvbnN0IG9yaWdpbmFsID0gcmVuZGVyZXIuc2V0RGF0YTtcbiAgcmVuZGVyZXIuc2V0RGF0YSA9IGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgZm9yIChjb25zdCBwYXRoIGluIGRhdGEubm9kZXMpIHtcbiAgICAgIGNvbnN0IG5vZGUgPSBkYXRhLm5vZGVzW3BhdGhdO1xuICAgICAgaWYgKG5vZGUuY29sb3IpIGNvbnRpbnVlO1xuXG4gICAgICBpZiAobm9kZS50eXBlID09PSBcInRhZ1wiKSB7XG4gICAgICAgIC8vIE93biB0YWcgY29sb3IgZGlzYWJsZWQgKDIwMjYtMDktMzApOiB0aGUgTWluaW1hbCB0aGVtZSdzIFN0eWxlXG4gICAgICAgIC8vIFNldHRpbmdzIGFscmVhZHkgY292ZXIgaXQgKEdyYXBocyBcdTIxOTIgVGFnIG5vZGUgY29sb3IpLlxuICAgICAgICAvLyBpZiAocGx1Z2luLnNldHRpbmdzLmdyYXBoVGFnQ29sb3JFbmFibGVkICYmIHBsdWdpbi5zZXR0aW5ncy5ncmFwaFRhZ0NvbG9yKSB7XG4gICAgICAgIC8vICAgbm9kZS5jb2xvciA9IHsgYTogMSwgcmdiOiBoZXhUb0ludChwbHVnaW4uc2V0dGluZ3MuZ3JhcGhUYWdDb2xvcikgfTtcbiAgICAgICAgLy8gfVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgZmlsZSA9IHBsdWdpbi5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHBhdGgpO1xuICAgICAgbGV0IGNvbG9yID0gbnVsbDtcblxuICAgICAgaWYgKGZpbGUgJiYgZmlsZS5leHRlbnNpb24gIT09IFwibWRcIikge1xuICAgICAgICAvLyBPd24gYXR0YWNobWVudCBjb2xvciBkaXNhYmxlZCAoMjAyNi0wOS0zMCksIHNlZSB0YWcgY29sb3IgYWJvdmVcbiAgICAgICAgLy8gKEdyYXBocyBcdTIxOTIgQXR0YWNobWVudCBub2RlIGNvbG9yKS5cbiAgICAgICAgLy8gaWYgKHBsdWdpbi5zZXR0aW5ncy5ncmFwaEF0dGFjaG1lbnRDb2xvckVuYWJsZWQgJiYgcGx1Z2luLnNldHRpbmdzLmdyYXBoQXR0YWNobWVudENvbG9yKSB7XG4gICAgICAgIC8vICAgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuZ3JhcGhBdHRhY2htZW50Q29sb3I7XG4gICAgICAgIC8vIH1cbiAgICAgIH0gZWxzZSBpZiAocGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MuZ3JhcGgpIHtcbiAgICAgICAgY29sb3IgPSBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCBcImdyYXBoXCIpO1xuICAgICAgfVxuXG4gICAgICBpZiAoY29sb3IpIG5vZGUuY29sb3IgPSB7IGE6IDEsIHJnYjogaGV4VG9JbnQoY29sb3IpIH07XG4gICAgfVxuICAgIHJldHVybiBvcmlnaW5hbC5jYWxsKHRoaXMsIGRhdGEpO1xuICB9O1xuXG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiB7XG4gICAgcmVuZGVyZXIuc2V0RGF0YSA9IG9yaWdpbmFsO1xuICAgIGRlbGV0ZSByZW5kZXJlci5fX3R5cFN5c3RlbUNvbG9yUGF0Y2hlZDtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGdldEdyYXBoTGVhdmVzKGFwcCkge1xuICBjb25zdCBsZWF2ZXMgPSBbXTtcbiAgZm9yIChjb25zdCB2aWV3VHlwZSBvZiBHUkFQSF9WSUVXX1RZUEVTKSBsZWF2ZXMucHVzaCguLi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZSh2aWV3VHlwZSkpO1xuICByZXR1cm4gbGVhdmVzO1xufVxuXG5mdW5jdGlvbiByZWdpc3RlckdyYXBoQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBnZXRHcmFwaExlYXZlcyhwbHVnaW4uYXBwKSkge1xuICAgICAgaWYgKGxlYWYudmlldz8ucmVuZGVyZXIpIHBhdGNoUmVuZGVyZXIocGx1Z2luLCBsZWFmLnZpZXcucmVuZGVyZXIpO1xuICAgICAgLy8gVGhlIGdsb2JhbCBncmFwaCBrZWVwcyBpdHMgZW5naW5lIGluIHZpZXcuZGF0YUVuZ2luZSwgdGhlIGxvY2FsIG9uZSBpblxuICAgICAgLy8gdmlldy5lbmdpbmUuXG4gICAgICAobGVhZi52aWV3Py5kYXRhRW5naW5lID8/IGxlYWYudmlldz8uZW5naW5lKT8ucmVuZGVyKCk7XG4gICAgfVxuICB9O1xuXG4gIC8vIFJlZ2lzdGVyZWQgYmVmb3JlIGFueSBwYXRjaFJlbmRlcmVyKCkgY2xlYW51cCwgc28gaXQgcnVucyBhZnRlciB0aGVtIG9uXG4gIC8vIHVubG9hZCAoT2JzaWRpYW4gcnVucyB0aGVzZSBjYWxsYmFja3MgbGFzdC1pbiwgZmlyc3Qtb3V0KTogd2l0aCBzZXREYXRhXG4gIC8vIGJhY2sgdG8gdGhlIG9yaWdpbmFsLCBvbmUgcmVuZGVyKCkgZHJhd3MgdGhlIGdyYXBoIHdpdGhvdXQgVFlQIGNvbG9ycyBhdFxuICAvLyBvbmNlIGluc3RlYWQgb2Ygb24gaXRzIG5leHQgY2hhbmdlLlxuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBnZXRHcmFwaExlYXZlcyhwbHVnaW4uYXBwKSkgKGxlYWYudmlldz8uZGF0YUVuZ2luZSA/PyBsZWFmLnZpZXc/LmVuZ2luZSk/LnJlbmRlcigpO1xuICB9KTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KHJlZnJlc2gpO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJHcmFwaENvbG9ycyB9O1xuIiwgImNvbnN0IHsgY29sb3JGb3JGaWxlLCBzZXRJbmxpbmVDb2xvciB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxuY29uc3QgU0VBUkNIX1ZJRVdfVFlQRSA9IFwic2VhcmNoXCI7XG5cbi8vIFNlYXJjaCByZXN1bHQgcm93cyBoYXZlIG5vIGRhdGEtcGF0aCwgYnV0IHRoZSB2aWV3IGtlZXBzIGEgVEZpbGUgLT4gcmVzdWx0XG4vLyBET00gbWFwIChkb20ucmVzdWx0RG9tTG9va3VwKSB0aGF0IGxpbmtzIGZpbGUgYW5kIHJvdyBkaXJlY3RseS5cbmZ1bmN0aW9uIGFwcGx5U2VhcmNoQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFNFQVJDSF9WSUVXX1RZUEUpKSB7XG4gICAgY29uc3QgcmVzdWx0RG9tTG9va3VwID0gbGVhZi52aWV3Py5kb20/LnJlc3VsdERvbUxvb2t1cDtcbiAgICBpZiAoIXJlc3VsdERvbUxvb2t1cCkgY29udGludWU7XG5cbiAgICBmb3IgKGNvbnN0IFtmaWxlLCByZXN1bHREb21dIG9mIHJlc3VsdERvbUxvb2t1cCkge1xuICAgICAgY29uc3QgdGl0bGVFbCA9IHJlc3VsdERvbS5lbD8ucXVlcnlTZWxlY3RvcihcIi5zZWFyY2gtcmVzdWx0LWZpbGUtdGl0bGUgLnRyZWUtaXRlbS1pbm5lclwiKTtcbiAgICAgIGlmICghdGl0bGVFbCkgY29udGludWU7XG5cbiAgICAgIGNvbnN0IGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Muc2VhcmNoID8gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSwgXCJzZWFyY2hcIikgOiBudWxsO1xuICAgICAgc2V0SW5saW5lQ29sb3IodGl0bGVFbCwgY29sb3IpO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlclNlYXJjaENvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5U2VhcmNoQ29sb3JzKHBsdWdpbik7XG5cbiAgLy8gUmVzdWx0cyBhcmUgcmVidWlsdCBvbiBldmVyeSBrZXlzdHJva2UuXG4gIGNvbnN0IG9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIocmVmcmVzaCk7XG4gIGNvbnN0IG9ic2VydmVMZWF2ZXMgPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShTRUFSQ0hfVklFV19UWVBFKSkge1xuICAgICAgb2JzZXJ2ZXIub2JzZXJ2ZShsZWFmLnZpZXcuY29udGFpbmVyRWwsIHsgY2hpbGRMaXN0OiB0cnVlLCBzdWJ0cmVlOiB0cnVlIH0pO1xuICAgIH1cbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IG9ic2VydmVyLmRpc2Nvbm5lY3QoKSk7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoXG4gICAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICAgIHJlZnJlc2goKTtcbiAgICB9KVxuICApO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICByZWZyZXNoKCk7XG4gIH0pO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJTZWFyY2hDb2xvcnMgfTtcbiIsICJjb25zdCB7IGNvbG9yRm9yRmlsZSwgc2V0SW5saW5lQ29sb3IgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5cbmNvbnN0IFJFQ0VOVF9GSUxFU19WSUVXX1RZUEUgPSBcInJlY2VudC1maWxlc1wiO1xuXG4vLyBSZWNlbnQgRmlsZXMgcm93cyBoYXZlIG5vIGRhdGEtcGF0aCwgYnV0IHRoZSBsaXN0IGlzIHJlbmRlcmVkIHN0cmFpZ2h0IGZyb21cbi8vIGRhdGEucmVjZW50RmlsZXMgd2l0aG91dCBza2lwcGluZyBlbnRyaWVzLCBzbyB0aGUgaW5kZXggbWFwcyByb3cgdG8gcGF0aC5cbmZ1bmN0aW9uIGFwcGx5UmVjZW50RmlsZXNDb2xvcnMocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoUkVDRU5UX0ZJTEVTX1ZJRVdfVFlQRSkpIHtcbiAgICBjb25zdCByZWNlbnRGaWxlcyA9IGxlYWYudmlldz8uZGF0YT8ucmVjZW50RmlsZXM7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHJlY2VudEZpbGVzKSkgY29udGludWU7XG5cbiAgICBjb25zdCB0aXRsZUVscyA9IGxlYWYudmlldy5jb250YWluZXJFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLnJlY2VudC1maWxlcy10aXRsZSAubmF2LWZpbGUtdGl0bGUtY29udGVudFwiKTtcbiAgICB0aXRsZUVscy5mb3JFYWNoKCh0aXRsZUVsLCBpbmRleCkgPT4ge1xuICAgICAgY29uc3QgZW50cnkgPSByZWNlbnRGaWxlc1tpbmRleF07XG4gICAgICBjb25zdCBmaWxlID0gZW50cnkgPyBwbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChlbnRyeS5wYXRoKSA6IG51bGw7XG4gICAgICBjb25zdCBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnJlY2VudEZpbGVzID8gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSwgXCJyZWNlbnRGaWxlc1wiKSA6IG51bGw7XG4gICAgICBzZXRJbmxpbmVDb2xvcih0aXRsZUVsLCBjb2xvcik7XG4gICAgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJSZWNlbnRGaWxlc0NvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5UmVjZW50RmlsZXNDb2xvcnMocGx1Z2luKTtcblxuICBjb25zdCBvYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKHJlZnJlc2gpO1xuICBjb25zdCBvYnNlcnZlTGVhdmVzID0gKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoUkVDRU5UX0ZJTEVTX1ZJRVdfVFlQRSkpIHtcbiAgICAgIG9ic2VydmVyLm9ic2VydmUobGVhZi52aWV3LmNvbnRhaW5lckVsLCB7IGNoaWxkTGlzdDogdHJ1ZSwgc3VidHJlZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiBvYnNlcnZlci5kaXNjb25uZWN0KCkpO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KFxuICAgIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgICByZWZyZXNoKCk7XG4gICAgfSlcbiAgKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgcmVmcmVzaCgpO1xuICB9KTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyUmVjZW50RmlsZXNDb2xvcnMgfTtcbiIsICJjb25zdCB7IGNvbG9yRm9yRmlsZSwgc2V0SW5saW5lQ29sb3IgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5cbmNvbnN0IEJBQ0tMSU5LX1ZJRVdfVFlQRSA9IFwiYmFja2xpbmtcIjtcblxuLy8gVGhlIGJhY2tsaW5rcyBwYW5lIHJlbmRlcnMgcmVzdWx0cyB3aXRoIHRoZSBzYW1lIFNlYXJjaFJlc3VsdERvbSBjbGFzcyBhc1xuLy8gc2VhcmNoLiBMaW5rZWQgYW5kIHVubGlua2VkIG1lbnRpb25zIGFyZSB0d28gcmVzdWx0RG9tTG9va3VwIG1hcHMgb24gdGhlXG4vLyByZW5kZXJlciAodmlldy5iYWNrbGluaykuIFRoZSBmaWVsZCBuYW1lcyBhcmUgdW5kb2N1bWVudGVkLCBzbyBzZXZlcmFsXG4vLyBrbm93biBwYXRocyBhcmUgdHJpZWQuXG5mdW5jdGlvbiBnZXRSZXN1bHREb21Mb29rdXBzKHZpZXcpIHtcbiAgY29uc3QgcmVuZGVyZXIgPSB2aWV3Py5iYWNrbGluaztcbiAgY29uc3QgY2FuZGlkYXRlcyA9IFtyZW5kZXJlcj8uYmFja2xpbmtEb20sIHJlbmRlcmVyPy51bmxpbmtlZERvbSwgdmlldz8uYmFja2xpbmtEb20sIHZpZXc/LnVubGlua2VkRG9tLCB2aWV3Py5kb21dO1xuXG4gIGNvbnN0IGxvb2t1cHMgPSBbXTtcbiAgZm9yIChjb25zdCBkb20gb2YgY2FuZGlkYXRlcykge1xuICAgIGlmIChkb20/LnJlc3VsdERvbUxvb2t1cCBpbnN0YW5jZW9mIE1hcCkgbG9va3Vwcy5wdXNoKGRvbS5yZXN1bHREb21Mb29rdXApO1xuICB9XG4gIHJldHVybiBsb29rdXBzO1xufVxuXG5mdW5jdGlvbiBjb2xvclRpdGxlRWwocGx1Z2luLCBlbCwgZmlsZSkge1xuICBjb25zdCBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmJhY2tsaW5rcyA/IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIFwiYmFja2xpbmtzXCIpIDogbnVsbDtcbiAgc2V0SW5saW5lQ29sb3IoZWwsIGNvbG9yKTtcbn1cblxuZnVuY3Rpb24gYXBwbHlCYWNrbGlua1BhbmVDb2xvcnMocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoQkFDS0xJTktfVklFV19UWVBFKSkge1xuICAgIGZvciAoY29uc3QgbG9va3VwIG9mIGdldFJlc3VsdERvbUxvb2t1cHMobGVhZi52aWV3KSkge1xuICAgICAgZm9yIChjb25zdCBbZmlsZSwgcmVzdWx0RG9tXSBvZiBsb29rdXApIHtcbiAgICAgICAgY29uc3QgdGl0bGVFbCA9IHJlc3VsdERvbS5lbD8ucXVlcnlTZWxlY3RvcihcIi5zZWFyY2gtcmVzdWx0LWZpbGUtdGl0bGUgLnRyZWUtaXRlbS1pbm5lclwiKTtcbiAgICAgICAgaWYgKHRpdGxlRWwpIGNvbG9yVGl0bGVFbChwbHVnaW4sIHRpdGxlRWwsIGZpbGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG4vLyBCYWNrbGlua3MgaW4gdGhlIGRvY3VtZW50IGFyZSBub3QgYSBsZWFmIG9mIHRoZWlyIG93biBidXQgZW1iZWRkZWQgYXQgdGhlXG4vLyBib3R0b20gb2YgdGhlIG1hcmtkb3duIHZpZXcgKC5lbWJlZGRlZC1iYWNrbGlua3MpLiBSb3dzIGhhdmUgbm8gZGF0YS1wYXRoLFxuLy8gc28gdGhlIGZpbGUgaXMgcmVzb2x2ZWQgZnJvbSB0aGUgc2hvd24gbmFtZSwgdGhlIHdheSBPYnNpZGlhbiByZXNvbHZlcyBsaW5rcy5cbmZ1bmN0aW9uIGFwcGx5RW1iZWRkZWRCYWNrbGlua0NvbG9ycyhwbHVnaW4pIHtcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpKSB7XG4gICAgY29uc3QgcGFuZUVsID0gbGVhZi52aWV3LmNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3IoXCIuZW1iZWRkZWQtYmFja2xpbmtzIC5iYWNrbGluay1wYW5lXCIpO1xuICAgIGlmICghcGFuZUVsKSBjb250aW51ZTtcblxuICAgIGNvbnN0IHNvdXJjZVBhdGggPSBsZWFmLnZpZXcuZmlsZT8ucGF0aCA/PyBcIlwiO1xuICAgIGNvbnN0IHRpdGxlRWxzID0gcGFuZUVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIuc2VhcmNoLXJlc3VsdC1maWxlLXRpdGxlIC50cmVlLWl0ZW0taW5uZXJcIik7XG4gICAgZm9yIChjb25zdCB0aXRsZUVsIG9mIHRpdGxlRWxzKSB7XG4gICAgICBjb25zdCBiYXNlbmFtZSA9IHRpdGxlRWwudGV4dENvbnRlbnQ7XG4gICAgICBjb25zdCBmaWxlID0gYmFzZW5hbWUgPyBwbHVnaW4uYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0Rmlyc3RMaW5rcGF0aERlc3QoYmFzZW5hbWUsIHNvdXJjZVBhdGgpIDogbnVsbDtcbiAgICAgIGNvbG9yVGl0bGVFbChwbHVnaW4sIHRpdGxlRWwsIGZpbGUpO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBhcHBseUJhY2tsaW5rQ29sb3JzKHBsdWdpbikge1xuICBhcHBseUJhY2tsaW5rUGFuZUNvbG9ycyhwbHVnaW4pO1xuICBhcHBseUVtYmVkZGVkQmFja2xpbmtDb2xvcnMocGx1Z2luKTtcbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJCYWNrbGlua0NvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5QmFja2xpbmtDb2xvcnMocGx1Z2luKTtcblxuICAvLyBPbmx5IHRoZSBzbWFsbCBzaWRlYmFyIHBhbmUgaXMgb2JzZXJ2ZWQsIG5ldmVyIGEgbWFya2Rvd24gdmlldzogYSBzdWJ0cmVlXG4gIC8vIG9ic2VydmVyIG5lYXIgdGhlIGVkaXRvciBmaXJlcyBvbiBldmVyeSBrZXlzdHJva2UgYW5kIG9uY2UgZnJvemUgdGhpc1xuICAvLyB2YXVsdC4gVGhlIGVtYmVkZGVkIGJhY2tsaW5rcyBvbmx5IGNoYW5nZSB3aGVuIGxpbmtzIGNoYW5nZSAoXCJyZXNvbHZlZFwiKVxuICAvLyBvciB0aGUgbm90ZSBjaGFuZ2VzIChsYXlvdXQtY2hhbmdlL2FjdGl2ZS1sZWFmLWNoYW5nZSksIGJvdGggY292ZXJlZCBiZWxvdy5cbiAgY29uc3Qgb2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcihyZWZyZXNoKTtcbiAgY29uc3Qgb2JzZXJ2ZUxlYXZlcyA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEJBQ0tMSU5LX1ZJRVdfVFlQRSkpIHtcbiAgICAgIG9ic2VydmVyLm9ic2VydmUobGVhZi52aWV3LmNvbnRhaW5lckVsLCB7IGNoaWxkTGlzdDogdHJ1ZSwgc3VidHJlZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiBvYnNlcnZlci5kaXNjb25uZWN0KCkpO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAubWV0YWRhdGFDYWNoZS5vbihcInJlc29sdmVkXCIsICgpID0+IGFwcGx5RW1iZWRkZWRCYWNrbGlua0NvbG9ycyhwbHVnaW4pKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KFxuICAgIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgICByZWZyZXNoKCk7XG4gICAgfSlcbiAgKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJhY3RpdmUtbGVhZi1jaGFuZ2VcIiwgcmVmcmVzaCkpO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICByZWZyZXNoKCk7XG4gIH0pO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJCYWNrbGlua0NvbG9ycyB9O1xuIiwgImNvbnN0IHsgY29sb3JGb3JGaWxlLCBzZXRJbmxpbmVDb2xvciB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxuY29uc3QgQk9PS01BUktTX1ZJRVdfVFlQRSA9IFwiYm9va21hcmtzXCI7XG5jb25zdCBCT09LTUFSS1NfUExVR0lOX0lEID0gXCJib29rbWFya3NcIjtcblxuLy8gQm9va21hcmsgcm93cyBoYXZlIG5vIGRhdGEtcGF0aC4gVGhlIHZpZXcga2VlcHMgYSBXZWFrTWFwICh2aWV3Lml0ZW1Eb21zOlxuLy8gaXRlbSAtPiB0cmVlIGl0ZW0gd2l0aCAudGl0bGVFbCksIHdoaWNoIGNhbid0IGJlIGl0ZXJhdGVkLCBzbyB3ZSB3YWxrIHRoZVxuLy8gcGx1Z2luJ3Mgb3duIGl0ZW0gdHJlZSAoYWx3YXlzIGNvbXBsZXRlLCB3aGF0ZXZlciBpcyBjb2xsYXBzZWQpIGFuZCBsb29rIHVwXG4vLyBlYWNoIGl0ZW0ncyByb3cgd2l0aCAuZ2V0KCkuXG5mdW5jdGlvbiBmb3JFYWNoRmlsZUJvb2ttYXJrKGl0ZW1zLCBjYWxsYmFjaykge1xuICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMgPz8gW10pIHtcbiAgICBpZiAoaXRlbS50eXBlID09PSBcImZpbGVcIikgY2FsbGJhY2soaXRlbSk7XG4gICAgZWxzZSBpZiAoaXRlbS50eXBlID09PSBcImdyb3VwXCIpIGZvckVhY2hGaWxlQm9va21hcmsoaXRlbS5pdGVtcywgY2FsbGJhY2spO1xuICB9XG59XG5cbmZ1bmN0aW9uIGFwcGx5Qm9va21hcmtzQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCBib29rbWFya3NQbHVnaW4gPSBwbHVnaW4uYXBwLmludGVybmFsUGx1Z2lucy5nZXRFbmFibGVkUGx1Z2luQnlJZChCT09LTUFSS1NfUExVR0lOX0lEKTtcbiAgaWYgKCFib29rbWFya3NQbHVnaW4pIHJldHVybjtcblxuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEJPT0tNQVJLU19WSUVXX1RZUEUpKSB7XG4gICAgY29uc3QgaXRlbURvbXMgPSBsZWFmLnZpZXc/Lml0ZW1Eb21zO1xuICAgIGlmICghaXRlbURvbXMpIGNvbnRpbnVlO1xuXG4gICAgZm9yRWFjaEZpbGVCb29rbWFyayhib29rbWFya3NQbHVnaW4uaXRlbXMsIChpdGVtKSA9PiB7XG4gICAgICBjb25zdCB0aXRsZUVsID0gaXRlbURvbXMuZ2V0KGl0ZW0pPy50aXRsZUVsO1xuICAgICAgaWYgKCF0aXRsZUVsKSByZXR1cm47XG5cbiAgICAgIGNvbnN0IGZpbGUgPSBwbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChpdGVtLnBhdGgpO1xuICAgICAgY29uc3QgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5ib29rbWFya3MgPyBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCBcImJvb2ttYXJrc1wiKSA6IG51bGw7XG4gICAgICBzZXRJbmxpbmVDb2xvcih0aXRsZUVsLCBjb2xvcik7XG4gICAgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJCb29rbWFya3NDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseUJvb2ttYXJrc0NvbG9ycyhwbHVnaW4pO1xuXG4gIC8vIFJvd3MgYXJlIHJlLXJlbmRlcmVkIHdoZW4gZ3JvdXBzIGV4cGFuZC9jb2xsYXBzZSBvciBib29rbWFya3MgY2hhbmdlLlxuICBjb25zdCBvYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKHJlZnJlc2gpO1xuICBjb25zdCBvYnNlcnZlTGVhdmVzID0gKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoQk9PS01BUktTX1ZJRVdfVFlQRSkpIHtcbiAgICAgIG9ic2VydmVyLm9ic2VydmUobGVhZi52aWV3LmNvbnRhaW5lckVsLCB7IGNoaWxkTGlzdDogdHJ1ZSwgc3VidHJlZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiBvYnNlcnZlci5kaXNjb25uZWN0KCkpO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KFxuICAgIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgICByZWZyZXNoKCk7XG4gICAgfSlcbiAgKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgcmVmcmVzaCgpO1xuICB9KTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyQm9va21hcmtzQ29sb3JzIH07XG4iLCAiY29uc3QgeyBURmlsZSB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBjb2xvckZvckZpbGUsIHN1YnR5cENvbG9yLCBzdWJ0eXBIYXNPd25Db2xvciwgc2V0SW5saW5lQ29sb3IgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5jb25zdCB7IGdldFN1YnR5cCB9ID0gcmVxdWlyZShcIi4vc3VidHlwc1wiKTtcblxuY29uc3QgRE9UX0NMQVNTID0gXCJ0eXAtdGl0bGUtZG90XCI7XG5jb25zdCBET1RfSE9MTE9XX0NMQVNTID0gXCJ0eXAtdGl0bGUtZG90LWhvbGxvd1wiO1xuLy8gU2FtZSBhcyBERUZBVUxUX1RZUF9DT0xPUiBpbiB0eXAtcGFuZS5qcyAoYSBUWVAgd2l0aG91dCBpdHMgb3duIGNvbG9yKS5cbmNvbnN0IERFRkFVTFRfRE9UX0NPTE9SID0gXCIjODg4ODg4XCI7XG5jb25zdCBCQURHRV9DTEFTUyA9IFwidHlwLXRpdGxlLWJhZGdlXCI7XG5jb25zdCBCQURHRV9QTEFJTl9DTEFTUyA9IFwidHlwLXRpdGxlLWJhZGdlLXBsYWluXCI7XG5jb25zdCBDT0xPUl9WQVIgPSBcIi0tdHlwLXRpdGxlLWNvbG9yXCI7XG5cbmNvbnN0IEJMT0NLX0JBREdFX0NMQVNTID0gXCJ0eXAtYmxvY2stYmFkZ2VcIjtcbmNvbnN0IEJMT0NLX0JBREdFX1BMQUlOX0NMQVNTID0gXCJ0eXAtYmxvY2stYmFkZ2UtcGxhaW5cIjtcbmNvbnN0IEJMT0NLX0FMSUdOX1RPUF9DTEFTUyA9IFwidHlwLWJsb2NrLWJhZGdlLXRvcFwiO1xuY29uc3QgQkxPQ0tfQUxJR05fQk9UVE9NX0NMQVNTID0gXCJ0eXAtYmxvY2stYmFkZ2UtYm90dG9tXCI7XG5jb25zdCBCTE9DS19DT0xPUl9WQVIgPSBcIi0tdHlwLWJsb2NrLWNvbG9yXCI7XG5cbi8vIG5vdGVUaXRsZVN0eWxlOiBcIm5vbmVcIiB8IFwiZG90XCIgfCBcImJhZGdlXCIuIEZvciBcImJhZGdlXCIsIG5vdGVUaXRsZUJhZGdlQ29sb3JlZFxuLy8gYW5kIG5vdGVUaXRsZUJhZGdlUG9zaXRpb24gKFwidGl0bGVcIiB8IFwiYmxvY2tcIiwgcGx1cyBub3RlVGl0bGVWZXJ0aWNhbEFsaWduXG4vLyBmb3IgXCJibG9ja1wiKSByZWZpbmUgaXQuIGNvbG9yVmlld3Mubm90ZVRpdGxlQ29sb3IgKHRoZSB0aXRsZSB0ZXh0IGl0c2VsZikgaXNcbi8vIGluZGVwZW5kZW50IGFuZCBjb21iaW5lcyB3aXRoIGFueSBvZiB0aGVzZS5cbmZ1bmN0aW9uIHJlc29sdmVNYXJrZXIocGx1Z2luLCBmaWxlKSB7XG4gIGNvbnN0IHN0eWxlID0gcGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVN0eWxlO1xuICBpZiAoc3R5bGUgPT09IFwibm9uZVwiKSByZXR1cm4geyBraW5kOiBcIm5vbmVcIiB9O1xuICBpZiAoc3R5bGUgPT09IFwiZG90XCIpIHJldHVybiB7IGtpbmQ6IFwiZG90XCIsIC4uLnJlc29sdmVEb3QocGx1Z2luLCBmaWxlKSB9O1xuXG4gIC8vIFwiYmFkZ2VcIjogY29sb3JlZCwgYSByZWdpc3RlcmVkIFRZUCB3aXRob3V0IGEgY29sb3IgZ2V0cyB0aGUgZ3JheSBkZWZhdWx0XG4gIC8vIChsaWtlIHRoZSByaW5nIGluIHJlc29sdmVEb3QpOyBhbiB1bnJlZ2lzdGVyZWQgVFlQIGdldHMgbm8gY29sb3JlZCBiYWRnZSxcbiAgLy8ganVzdCBhcyBpdCBnZXRzIG5vIGRvdC5cbiAgY29uc3QgeyBzZXR0aW5ncyB9ID0gcGx1Z2luO1xuICBjb25zdCB0eXAgPSBwbHVnaW4udHlwSW5kZXgudHlwT2YoZmlsZSk7XG4gIGlmICghdHlwKSByZXR1cm4geyBraW5kOiBcIm5vbmVcIiB9O1xuICBjb25zdCBjb2xvcmVkID0gc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VDb2xvcmVkO1xuICBpZiAoY29sb3JlZCAmJiAhc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gJiYgIXNldHRpbmdzLnR5cHMuaW5jbHVkZXModHlwKSkgcmV0dXJuIHsga2luZDogXCJub25lXCIgfTtcbiAgY29uc3QgdHlwQ29sb3IgPSBzZXR0aW5ncy50eXBDb2xvcnNbdHlwXSA/PyBERUZBVUxUX0RPVF9DT0xPUjtcblxuICBjb25zdCBsYWJlbCA9IGJhZGdlTGFiZWwocGx1Z2luLCBmaWxlLCB0eXApO1xuICBpZiAoIWxhYmVsKSByZXR1cm4geyBraW5kOiBcIm5vbmVcIiB9O1xuICBjb25zdCB7IHRleHQsIHVzZVN1YnR5cENvbG9yLCBzdWJ0eXAgfSA9IGxhYmVsO1xuICBjb25zdCBjb2xvciA9IGNvbG9yZWQgPyAodXNlU3VidHlwQ29sb3IgPyBzdWJ0eXBDb2xvcihzZXR0aW5ncywgdHlwLCBzdWJ0eXApID8/IHR5cENvbG9yIDogdHlwQ29sb3IpIDogbnVsbDtcbiAgY29uc3QgcG9zaXRpb24gPSBzZXR0aW5ncy5ub3RlVGl0bGVCYWRnZVBvc2l0aW9uO1xuICByZXR1cm4geyBraW5kOiBwb3NpdGlvbiA9PT0gXCJibG9ja1wiID8gXCJibG9jay1iYWRnZVwiIDogXCJ0aXRsZS1iYWRnZVwiLCBjb2xvcmVkLCBjb2xvciwgdHlwTmFtZTogdGV4dCB9O1xufVxuXG4vLyBCYWRnZSBsYWJlbCAobm90ZVRpdGxlQmFkZ2VMYWJlbCkgd2l0aCBpdHMgY29sb3I6IFtUWVBdIGluIHRoZSBUWVAgY29sb3IsXG4vLyBbU3VidHlwXSBpbiB0aGUgU3VidHlwIGNvbG9yIChubyBiYWRnZSB3aXRob3V0IGEgU3VidHlwKSwgW1RZUC9TdWJ0eXBdXG4vLyBkZXBlbmRpbmcgb24gdGhlIFwiU3VidHlwIGNvbG9yXCIgdG9nZ2xlIChjb2xvclZpZXdzLm5vdGVUaXRsZU1hcmtlclN1YnR5cCkuXG4vLyBBbiB1bnJlZ2lzdGVyZWQgU1VCVFlQIHZhbHVlIGlzIHNob3duIGJ1dCBoYXMgbm8gY29sb3Igb2YgaXRzIG93blxuLy8gKHN1YnR5cENvbG9yIHRoZW4gcmV0dXJucyB0aGUgVFlQIGNvbG9yKS5cbmZ1bmN0aW9uIGJhZGdlTGFiZWwocGx1Z2luLCBmaWxlLCB0eXApIHtcbiAgY29uc3QgeyBzZXR0aW5ncyB9ID0gcGx1Z2luO1xuICBjb25zdCBzdWJ0eXAgPSBwbHVnaW4udHlwSW5kZXguc3VidHlwT2YoZmlsZSk7XG4gIGNvbnN0IG1vZGUgPSBzZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUxhYmVsID8/IFwidHlwXCI7XG4gIGlmIChtb2RlID09PSBcInN1YnR5cFwiKSByZXR1cm4gc3VidHlwID8geyB0ZXh0OiBzdWJ0eXAsIHVzZVN1YnR5cENvbG9yOiB0cnVlLCBzdWJ0eXAgfSA6IG51bGw7XG4gIGlmICghc3VidHlwIHx8IG1vZGUgPT09IFwidHlwXCIpIHJldHVybiB7IHRleHQ6IHR5cCwgdXNlU3VidHlwQ29sb3I6IGZhbHNlLCBzdWJ0eXAgfTtcbiAgcmV0dXJuIHsgdGV4dDogYCR7dHlwfS8ke3N1YnR5cH1gLCB1c2VTdWJ0eXBDb2xvcjogISFzZXR0aW5ncy5jb2xvclZpZXdzLm5vdGVUaXRsZU1hcmtlclN1YnR5cCwgc3VidHlwIH07XG59XG5cbi8vIERvdCBhdCB0aGUgdGl0bGUuIExpa2UgdGhlIGRvdHMgaW4gdGhlIFRZUC1QYW5lIChwYWludENvbG9yRG90IGluXG4vLyB0eXAtY29sb3JzLmpzKSwgYSBkZWZhdWx0IGlzIHNob3duIGFzIGEgaG9sbG93IHJpbmc6IGdyYXkgZm9yIGEgcmVnaXN0ZXJlZFxuLy8gVFlQIHdpdGhvdXQgYSBjb2xvciwgdGhlIGluaGVyaXRlZCBUWVAgY29sb3IgZm9yIGEgU3VidHlwIHdpdGhvdXQgaXRzIG93bi5cbi8vIFVucmVnaXN0ZXJlZCBUWVAgdmFsdWVzIGdldCBubyBkb3QsIGFzIGluIHRoZSBUWVAtTGlzdC5cbmZ1bmN0aW9uIHJlc29sdmVEb3QocGx1Z2luLCBmaWxlKSB7XG4gIGNvbnN0IHR5cCA9IHBsdWdpbi50eXBJbmRleC50eXBPZihmaWxlKTtcbiAgaWYgKCF0eXApIHJldHVybiB7IGNvbG9yOiBudWxsLCBob2xsb3c6IGZhbHNlIH07XG4gIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHBsdWdpbjtcbiAgY29uc3QgdHlwQ29sb3IgPSBzZXR0aW5ncy50eXBDb2xvcnNbdHlwXTtcbiAgaWYgKCF0eXBDb2xvcikge1xuICAgIHJldHVybiBzZXR0aW5ncy50eXBzLmluY2x1ZGVzKHR5cCkgPyB7IGNvbG9yOiBERUZBVUxUX0RPVF9DT0xPUiwgaG9sbG93OiB0cnVlIH0gOiB7IGNvbG9yOiBudWxsLCBob2xsb3c6IGZhbHNlIH07XG4gIH1cbiAgY29uc3Qgc3VidHlwID0gcGx1Z2luLnR5cEluZGV4LnN1YnR5cE9mKGZpbGUpO1xuICBpZiAoc2V0dGluZ3MuY29sb3JWaWV3cy5ub3RlVGl0bGVNYXJrZXJTdWJ0eXAgJiYgc3VidHlwICYmIGdldFN1YnR5cChzZXR0aW5ncywgdHlwLCBzdWJ0eXApKSB7XG4gICAgcmV0dXJuIHsgY29sb3I6IHN1YnR5cENvbG9yKHNldHRpbmdzLCB0eXAsIHN1YnR5cCksIGhvbGxvdzogIXN1YnR5cEhhc093bkNvbG9yKHNldHRpbmdzLCB0eXAsIHN1YnR5cCkgfTtcbiAgfVxuICByZXR1cm4geyBjb2xvcjogdHlwQ29sb3IsIGhvbGxvdzogZmFsc2UgfTtcbn1cblxuLy8gVGhlIG5vdGUncyBpbmxpbmUgdGl0bGUuIERvbmUgYXMgOjpiZWZvcmUgKHNlZSBzdHlsZXMuY3NzKSwgbm90IGFzIGFuIGV4dHJhXG4vLyBlbGVtZW50IG9yIHdyYXBwZXI6IHNldmVyYWwgdGhlbWVzIChNaW5pbWFsIGFtb25nIHRoZW0pIHN0eWxlIC5pbmxpbmUtdGl0bGVcbi8vIHdpdGggY2hpbGQgc2VsZWN0b3JzLCB3aGljaCBhbiBleHRyYSBlbGVtZW50IHdvdWxkIGJyZWFrLiBBIDo6YmVmb3JlIGNhbid0XG4vLyBiZSBnaXZlbiBhIGNvbG9yIG9yIHRleHQgZGlyZWN0bHksIGhlbmNlIHRoZSBDU1MgdmFyaWFibGUgYW5kIHRoZSBkYXRhXG4vLyBhdHRyaWJ1dGUgdGhhdCBpdHMgcnVsZXMgcmVhZCAodmFyKCkvYXR0cigpKS5cbmZ1bmN0aW9uIGFwcGx5U3R5bGVUb1RpdGxlKHRpdGxlRWwsIG1hcmtlcikge1xuICBjb25zdCBpc0RvdCA9IG1hcmtlci5raW5kID09PSBcImRvdFwiICYmICEhbWFya2VyLmNvbG9yO1xuICBjb25zdCBpc0JhZGdlID0gbWFya2VyLmtpbmQgPT09IFwidGl0bGUtYmFkZ2VcIjtcblxuICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoRE9UX0NMQVNTLCBpc0RvdCk7XG4gIHRpdGxlRWwuY2xhc3NMaXN0LnRvZ2dsZShET1RfSE9MTE9XX0NMQVNTLCBpc0RvdCAmJiAhIW1hcmtlci5ob2xsb3cpO1xuICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoQkFER0VfQ0xBU1MsIGlzQmFkZ2UgJiYgbWFya2VyLmNvbG9yZWQpO1xuICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoQkFER0VfUExBSU5fQ0xBU1MsIGlzQmFkZ2UgJiYgIW1hcmtlci5jb2xvcmVkKTtcblxuICBpZiAoaXNCYWRnZSkgdGl0bGVFbC5kYXRhc2V0LnR5cCA9IG1hcmtlci50eXBOYW1lO1xuICBlbHNlIGRlbGV0ZSB0aXRsZUVsLmRhdGFzZXQudHlwO1xuXG4gIGNvbnN0IG1hcmtlckNvbG9yID0gKGlzRG90ICYmIG1hcmtlci5jb2xvcikgfHwgKGlzQmFkZ2UgJiYgbWFya2VyLmNvbG9yZWQgJiYgbWFya2VyLmNvbG9yKSA/IG1hcmtlci5jb2xvciA6IG51bGw7XG4gIGlmIChtYXJrZXJDb2xvcikgdGl0bGVFbC5zdHlsZS5zZXRQcm9wZXJ0eShDT0xPUl9WQVIsIG1hcmtlckNvbG9yKTtcbiAgZWxzZSB0aXRsZUVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KENPTE9SX1ZBUik7XG59XG5cbi8vIFRoZSBub3RlJ3MgcHJvcGVydHkgYmxvY2sgKC5tZXRhZGF0YS1jb250YWluZXIpLCBmb3IgcG9zaXRpb24gXCJibG9ja1wiOiB0aGVcbi8vIHNhbWUgYmFkZ2UsIHR1cm5lZCA5MFx1MDBCMCAod3JpdGluZy1tb2RlIHJhdGhlciB0aGFuIHJvdGF0ZSgpLCBzbyBpdCBncm93cyB3aXRoXG4vLyB0aGUgdGV4dCBpbiB0aGUgcmlnaHQgZGlyZWN0aW9uKSBhbmQgYW5jaG9yZWQgbGVmdCBhdCB0aGUgYmxvY2ssIHRvcCBvclxuLy8gYm90dG9tLiBBcyBhIDo6YmVmb3JlIGl0IGhpZGVzIGFuZCBzaG93cyB3aXRoIHRoZSBibG9jayAoUHJvcGVydHktQmxvY2suY3NzKS5cbmZ1bmN0aW9uIGFwcGx5U3R5bGVUb0Jsb2NrKHBsdWdpbiwgYmxvY2tFbCwgbWFya2VyKSB7XG4gIGNvbnN0IGlzQmxvY2tCYWRnZSA9IG1hcmtlci5raW5kID09PSBcImJsb2NrLWJhZGdlXCI7XG5cbiAgYmxvY2tFbC5jbGFzc0xpc3QudG9nZ2xlKEJMT0NLX0JBREdFX0NMQVNTLCBpc0Jsb2NrQmFkZ2UgJiYgbWFya2VyLmNvbG9yZWQpO1xuICBibG9ja0VsLmNsYXNzTGlzdC50b2dnbGUoQkxPQ0tfQkFER0VfUExBSU5fQ0xBU1MsIGlzQmxvY2tCYWRnZSAmJiAhbWFya2VyLmNvbG9yZWQpO1xuXG4gIGNvbnN0IGFsaWduID0gcGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVZlcnRpY2FsQWxpZ247XG4gIGJsb2NrRWwuY2xhc3NMaXN0LnRvZ2dsZShCTE9DS19BTElHTl9UT1BfQ0xBU1MsIGlzQmxvY2tCYWRnZSAmJiBhbGlnbiAhPT0gXCJib3R0b21cIik7XG4gIGJsb2NrRWwuY2xhc3NMaXN0LnRvZ2dsZShCTE9DS19BTElHTl9CT1RUT01fQ0xBU1MsIGlzQmxvY2tCYWRnZSAmJiBhbGlnbiA9PT0gXCJib3R0b21cIik7XG5cbiAgaWYgKGlzQmxvY2tCYWRnZSkgYmxvY2tFbC5kYXRhc2V0LnR5cCA9IG1hcmtlci50eXBOYW1lO1xuICBlbHNlIGRlbGV0ZSBibG9ja0VsLmRhdGFzZXQudHlwO1xuXG4gIGNvbnN0IGJsb2NrQ29sb3IgPSBpc0Jsb2NrQmFkZ2UgJiYgbWFya2VyLmNvbG9yZWQgJiYgbWFya2VyLmNvbG9yID8gbWFya2VyLmNvbG9yIDogbnVsbDtcbiAgaWYgKGJsb2NrQ29sb3IpIGJsb2NrRWwuc3R5bGUuc2V0UHJvcGVydHkoQkxPQ0tfQ09MT1JfVkFSLCBibG9ja0NvbG9yKTtcbiAgZWxzZSBibG9ja0VsLnN0eWxlLnJlbW92ZVByb3BlcnR5KEJMT0NLX0NPTE9SX1ZBUik7XG59XG5cbmZ1bmN0aW9uIGFwcGx5QWN0aXZlVGl0bGVDb2xvcnMocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xuICAgIGNvbnN0IGNvbnRhaW5lckVsID0gbGVhZi52aWV3LmNvbnRhaW5lckVsO1xuICAgIGNvbnN0IGZpbGUgPSBsZWFmLnZpZXcuZmlsZTtcbiAgICBjb25zdCB0eXBlZEZpbGUgPSBmaWxlIGluc3RhbmNlb2YgVEZpbGUgPyBmaWxlIDogbnVsbDtcbiAgICBjb25zdCBtYXJrZXIgPSByZXNvbHZlTWFya2VyKHBsdWdpbiwgdHlwZWRGaWxlKTtcblxuICAgIGNvbnN0IHRpdGxlRWwgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKFwiLmlubGluZS10aXRsZVwiKTtcbiAgICBpZiAodGl0bGVFbCkge1xuICAgICAgYXBwbHlTdHlsZVRvVGl0bGUodGl0bGVFbCwgbWFya2VyKTtcblxuICAgICAgY29uc3QgdGV4dENvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Mubm90ZVRpdGxlQ29sb3IgPyBjb2xvckZvckZpbGUocGx1Z2luLCB0eXBlZEZpbGUsIFwibm90ZVRpdGxlQ29sb3JcIikgOiBudWxsO1xuICAgICAgc2V0SW5saW5lQ29sb3IodGl0bGVFbCwgdGV4dENvbG9yKTtcbiAgICB9XG5cbiAgICBjb25zdCBibG9ja0VsID0gY29udGFpbmVyRWwucXVlcnlTZWxlY3RvcihcIi5tZXRhZGF0YS1jb250YWluZXJcIik7XG4gICAgaWYgKGJsb2NrRWwpIGFwcGx5U3R5bGVUb0Jsb2NrKHBsdWdpbiwgYmxvY2tFbCwgbWFya2VyKTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlckFjdGl2ZVRpdGxlQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlBY3RpdmVUaXRsZUNvbG9ycyhwbHVnaW4pO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwiZmlsZS1vcGVuXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJhY3RpdmUtbGVhZi1jaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgcmVmcmVzaCkpO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkocmVmcmVzaCk7XG5cbiAgLy8gRG90LCBiYWRnZSBhbmQgdGhlaXIgZGF0YSBhdHRyaWJ1dGUgYW5kIGNvbG9yIHZhcmlhYmxlcyB3b3VsZCBvdGhlcndpc2VcbiAgLy8gc3RheSBvbiBvcGVuIG5vdGVzIGFmdGVyIHRoZSBwbHVnaW4gaXMgZGlzYWJsZWQsIHVudGlsIHRoZSBub3RlIGlzXG4gIC8vIHJlLXJlbmRlcmVkLiBUaGUgdGl0bGUgdGV4dCBjb2xvciBpcyBjbGVhcmVkIHdpdGggdGhlIG90aGVyIGlubGluZSBjb2xvcnNcbiAgLy8gKGNsZWFySW5saW5lQ29sb3JzLCBzZWUgbWFpbi5qcykuXG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiB7XG4gICAgY29uc3Qgbm9uZSA9IHsga2luZDogXCJub25lXCIgfTtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikpIHtcbiAgICAgIGNvbnN0IGNvbnRhaW5lckVsID0gbGVhZi52aWV3LmNvbnRhaW5lckVsO1xuICAgICAgY29uc3QgdGl0bGVFbCA9IGNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3IoXCIuaW5saW5lLXRpdGxlXCIpO1xuICAgICAgaWYgKHRpdGxlRWwpIGFwcGx5U3R5bGVUb1RpdGxlKHRpdGxlRWwsIG5vbmUpO1xuICAgICAgY29uc3QgYmxvY2tFbCA9IGNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3IoXCIubWV0YWRhdGEtY29udGFpbmVyXCIpO1xuICAgICAgaWYgKGJsb2NrRWwpIGFwcGx5U3R5bGVUb0Jsb2NrKHBsdWdpbiwgYmxvY2tFbCwgbm9uZSk7XG4gICAgfVxuICB9KTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnMgfTtcbiIsICJjb25zdCB7IGVkaXRvckluZm9GaWVsZCwgZ2V0TGlua3BhdGggfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgVmlld1BsdWdpbiwgRGVjb3JhdGlvbiB9ID0gcmVxdWlyZShcIkBjb2RlbWlycm9yL3ZpZXdcIik7XG5jb25zdCB7IFByZWMsIFJhbmdlU2V0QnVpbGRlciwgU3RhdGVFZmZlY3QgfSA9IHJlcXVpcmUoXCJAY29kZW1pcnJvci9zdGF0ZVwiKTtcbmNvbnN0IHsgc3ludGF4VHJlZSB9ID0gcmVxdWlyZShcIkBjb2RlbWlycm9yL2xhbmd1YWdlXCIpO1xuY29uc3QgeyBjb2xvckZvckZpbGUsIGFsbERvY3VtZW50cyB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxuLy8gQ29sb3JzIGxpbmtzIGluIG5vdGUgdGV4dCBieSB0aGUgVFlQIG9mIHRoZWlyIHRhcmdldC4gT2JzaWRpYW4gY29sb3JzXG4vLyBpbnRlcm5hbCBsaW5rcyB0aHJvdWdoIHZhcigtLWxpbmstY29sb3IpLCBzbyBvbmx5IHRoYXQgdmFyaWFibGUgaXMgc2V0IHBlclxuLy8gbGluay4gLS1saW5rLWNvbG9yLWhvdmVyIHN0YXlzIHVudG91Y2hlZCAoaG92ZXIgc2hvd3MgdGhlIG5vcm1hbCBsaW5rIGNvbG9yKSxcbi8vIGFuZCB1bmRlcmxpbmUgYW5kIHRoZW1lIHR3ZWFrcyBrZWVwIHdvcmtpbmcuXG4vL1xuLy8gVHdvIHNlcGFyYXRlIHBhdGhzLCBiZWNhdXNlIHRoZSB0d28gcmVuZGVyaW5ncyBoYXZlIG5vdGhpbmcgaW4gY29tbW9uOlxuLy8gIC0gUmVhZGluZyB2aWV3LCBob3ZlciBwcmV2aWV3IGFuZCByZW5kZXJlZCBibG9ja3MgaW4gTGl2ZSBQcmV2aWV3ICh0YWJsZXMsXG4vLyAgICBjYWxsb3V0cyk6IHJlYWwgPGEgY2xhc3M9XCJpbnRlcm5hbC1saW5rXCIgZGF0YS1ocmVmPiBlbGVtZW50cyAtPlxuLy8gICAgbWFya2Rvd24gcG9zdC1wcm9jZXNzb3IsIG9uY2UgcGVyIGxpbmsgd2hlbiByZW5kZXJlZC5cbi8vICAtIExpdmUgUHJldmlldy9zb3VyY2UgbW9kZTogb25seSBDb2RlTWlycm9yIHNwYW5zIG92ZXIgdGhlIHJhdyB0ZXh0IC0+XG4vLyAgICBhIFZpZXdQbHVnaW4gdGhhdCBsb29rcyBhdCB0aGUgdmlzaWJsZSByYW5nZSBvbmx5LlxuLy9cbi8vIFJlY29sb3Jpbmcgb3RoZXJ3aXNlIG9ubHkgaGFwcGVucyBvbiBhIHJlYWwgVFlQIGNoYW5nZSAodHlwSW5kZXggXCJjaGFuZ2VcIilcbi8vIG9yIGEgc2V0dGluZ3MgY2hhbmdlLCBub3Qgb24gZXZlcnkgc2F2ZS5cblxuY29uc3QgQ09MT1JfVkFSID0gXCItLWxpbmstY29sb3JcIjtcbmNvbnN0IFNPVVJDRV9BVFRSID0gXCJkYXRhLXR5cC1zcmNcIjtcblxuLy8gW1t0YXJnZXRdXSwgW1t0YXJnZXR8YWxpYXNdXSwgW1t0YXJnZXQjaGVhZGluZ11dLiBFbWJlZHMgKCFbW1x1MjAyNl1dKSBhcmUgbm90XG4vLyBsaW5rcy4gSW5zaWRlIHRhYmxlcyB0aGUgYWxpYXMgcGlwZSBpcyBlc2NhcGVkIChcIlxcfFwiKS5cbmNvbnN0IFdJS0lMSU5LX1BBVFRFUk4gPSAvKD88ISEpXFxbXFxbKFteW1xcXV0rPylcXF1cXF0vZztcblxuZnVuY3Rpb24gY29sb3JGb3JMaW5rdGV4dChwbHVnaW4sIGxpbmt0ZXh0LCBzb3VyY2VQYXRoKSB7XG4gIGNvbnN0IHRhcmdldCA9IGxpbmt0ZXh0LnNwbGl0KC9cXFxcP1xcfC8pWzBdLnRyaW0oKTtcbiAgY29uc3QgbGlua3BhdGggPSBnZXRMaW5rcGF0aCh0YXJnZXQpO1xuICBpZiAoIWxpbmtwYXRoKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgZmlsZSA9IHBsdWdpbi5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaXJzdExpbmtwYXRoRGVzdChsaW5rcGF0aCwgc291cmNlUGF0aCk7XG4gIHJldHVybiBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCBcImxpbmtzXCIpO1xufVxuXG4vLyAtLS0gUmVhZGluZyB2aWV3IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZnVuY3Rpb24gYXBwbHlUb0FuY2hvcihwbHVnaW4sIGFuY2hvckVsKSB7XG4gIGNvbnN0IGhyZWYgPSBhbmNob3JFbC5nZXRBdHRyaWJ1dGUoXCJkYXRhLWhyZWZcIik7XG4gIGNvbnN0IGNvbG9yID1cbiAgICBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5saW5rcyAmJiBocmVmICYmICFhbmNob3JFbC5jbGFzc0xpc3QuY29udGFpbnMoXCJpcy11bnJlc29sdmVkXCIpXG4gICAgICA/IGNvbG9yRm9yTGlua3RleHQocGx1Z2luLCBocmVmLCBhbmNob3JFbC5nZXRBdHRyaWJ1dGUoU09VUkNFX0FUVFIpID8/IFwiXCIpXG4gICAgICA6IG51bGw7XG4gIGlmIChjb2xvcikgYW5jaG9yRWwuc3R5bGUuc2V0UHJvcGVydHkoQ09MT1JfVkFSLCBjb2xvcik7XG4gIGVsc2UgYW5jaG9yRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoQ09MT1JfVkFSKTtcbn1cblxuLy8gUmVjb2xvcnMgbGlua3MgdGhhdCBhcmUgYWxyZWFkeSByZW5kZXJlZC4gVGhlIHBvc3QtcHJvY2Vzc29yIHN0b3JlcyBlYWNoXG4vLyBsaW5rJ3Mgc291cmNlIG5vdGUgb24gaXQsIHdoaWNoIGFtYmlndW91cyBsaW5rIHRleHQgbmVlZHMgdG8gcmVzb2x2ZS5cbi8vIENvdmVycyBhbGwgd2luZG93cyAocG9wLW91dHMgaW5jbHVkZWQpLlxuZnVuY3Rpb24gcmVmcmVzaFJlbmRlcmVkTGlua3MocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgZG9jIG9mIGFsbERvY3VtZW50cyhwbHVnaW4uYXBwKSkge1xuICAgIGZvciAoY29uc3QgYW5jaG9yRWwgb2YgZG9jLnF1ZXJ5U2VsZWN0b3JBbGwoYGEuaW50ZXJuYWwtbGlua1ske1NPVVJDRV9BVFRSfV1gKSkgYXBwbHlUb0FuY2hvcihwbHVnaW4sIGFuY2hvckVsKTtcbiAgfVxufVxuXG4vLyAtLS0gTGl2ZSBQcmV2aWV3IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgcmVmcmVzaEVmZmVjdCA9IFN0YXRlRWZmZWN0LmRlZmluZSgpO1xuXG5mdW5jdGlvbiBidWlsZExpbmtWaWV3UGx1Z2luKHBsdWdpbikge1xuICBjb25zdCBkZWNvcmF0aW9uc0J5Q29sb3IgPSBuZXcgTWFwKCk7XG4gIGNvbnN0IGRlY29yYXRpb25Gb3IgPSAoY29sb3IpID0+IHtcbiAgICBsZXQgZGVjb3JhdGlvbiA9IGRlY29yYXRpb25zQnlDb2xvci5nZXQoY29sb3IpO1xuICAgIGlmICghZGVjb3JhdGlvbikge1xuICAgICAgZGVjb3JhdGlvbiA9IERlY29yYXRpb24ubWFyayh7XG4gICAgICAgIGNsYXNzOiBcInR5cC1saW5rXCIsXG4gICAgICAgIGF0dHJpYnV0ZXM6IHsgc3R5bGU6IGAke0NPTE9SX1ZBUn06ICR7Y29sb3J9O2AgfSxcbiAgICAgIH0pO1xuICAgICAgZGVjb3JhdGlvbnNCeUNvbG9yLnNldChjb2xvciwgZGVjb3JhdGlvbik7XG4gICAgfVxuICAgIHJldHVybiBkZWNvcmF0aW9uO1xuICB9O1xuXG4gIGNvbnN0IGJ1aWxkID0gKHZpZXcpID0+IHtcbiAgICBpZiAoIXBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmxpbmtzKSByZXR1cm4gRGVjb3JhdGlvbi5ub25lO1xuICAgIGNvbnN0IHNvdXJjZVBhdGggPSB2aWV3LnN0YXRlLmZpZWxkKGVkaXRvckluZm9GaWVsZCwgZmFsc2UpPy5maWxlPy5wYXRoID8/IFwiXCI7XG4gICAgY29uc3QgdHJlZSA9IHN5bnRheFRyZWUodmlldy5zdGF0ZSk7XG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyBSYW5nZVNldEJ1aWxkZXIoKTtcblxuICAgIGZvciAoY29uc3QgeyBmcm9tLCB0byB9IG9mIHZpZXcudmlzaWJsZVJhbmdlcykge1xuICAgICAgY29uc3QgdGV4dCA9IHZpZXcuc3RhdGUuc2xpY2VEb2MoZnJvbSwgdG8pO1xuICAgICAgV0lLSUxJTktfUEFUVEVSTi5sYXN0SW5kZXggPSAwO1xuICAgICAgZm9yIChsZXQgbWF0Y2g7IChtYXRjaCA9IFdJS0lMSU5LX1BBVFRFUk4uZXhlYyh0ZXh0KSk7ICkge1xuICAgICAgICBjb25zdCBzdGFydCA9IGZyb20gKyBtYXRjaC5pbmRleDtcbiAgICAgICAgLy8gT25seSB3aGF0IE9ic2lkaWFuJ3MgcGFyc2VyIHRyZWF0cyBhcyBhbiBpbnRlcm5hbCBsaW5rLCB3aGljaCBydWxlc1xuICAgICAgICAvLyBvdXQgW1tcdTIwMjZdXSBpbiBjb2RlIGJsb2NrcyBhbmQgaW5saW5lIGNvZGUuXG4gICAgICAgIGlmICghdHJlZS5yZXNvbHZlSW5uZXIoc3RhcnQgKyAyLCAxKS5uYW1lLmluY2x1ZGVzKFwiaG1kLWludGVybmFsLWxpbmtcIikpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBjb2xvciA9IGNvbG9yRm9yTGlua3RleHQocGx1Z2luLCBtYXRjaFsxXSwgc291cmNlUGF0aCk7XG4gICAgICAgIGlmIChjb2xvcikgYnVpbGRlci5hZGQoc3RhcnQsIHN0YXJ0ICsgbWF0Y2hbMF0ubGVuZ3RoLCBkZWNvcmF0aW9uRm9yKGNvbG9yKSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBidWlsZGVyLmZpbmlzaCgpO1xuICB9O1xuXG4gIHJldHVybiBWaWV3UGx1Z2luLmZyb21DbGFzcyhcbiAgICBjbGFzcyB7XG4gICAgICBjb25zdHJ1Y3Rvcih2aWV3KSB7XG4gICAgICAgIHRoaXMuZGVjb3JhdGlvbnMgPSBidWlsZCh2aWV3KTtcbiAgICAgIH1cblxuICAgICAgLy8gVGhlIHBhcnNlciBtYXkgd29yayB0aHJvdWdoIHRoZSB2aXNpYmxlIHJhbmdlIGJpdCBieSBiaXQsIHNvIGEgbmV3XG4gICAgICAvLyBzeW50YXggdHJlZSBhbHNvIHRyaWdnZXJzIGEgcmVidWlsZC5cbiAgICAgIHVwZGF0ZSh1cGRhdGUpIHtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIHVwZGF0ZS5kb2NDaGFuZ2VkIHx8XG4gICAgICAgICAgdXBkYXRlLnZpZXdwb3J0Q2hhbmdlZCB8fFxuICAgICAgICAgIHN5bnRheFRyZWUodXBkYXRlLnN0YXJ0U3RhdGUpICE9PSBzeW50YXhUcmVlKHVwZGF0ZS5zdGF0ZSkgfHxcbiAgICAgICAgICB1cGRhdGUudHJhbnNhY3Rpb25zLnNvbWUoKHRyKSA9PiB0ci5lZmZlY3RzLnNvbWUoKGVmZmVjdCkgPT4gZWZmZWN0LmlzKHJlZnJlc2hFZmZlY3QpKSlcbiAgICAgICAgKSB7XG4gICAgICAgICAgdGhpcy5kZWNvcmF0aW9ucyA9IGJ1aWxkKHVwZGF0ZS52aWV3KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0sXG4gICAgeyBkZWNvcmF0aW9uczogKHZhbHVlKSA9PiB2YWx1ZS5kZWNvcmF0aW9ucyB9XG4gICk7XG59XG5cbi8vIFJldHVybnMgc2NoZWR1bGUoKTogYXNrcyBldmVyeSBlZGl0b3IgdG8gcmVidWlsZCBpdHMgbGluayBkZWNvcmF0aW9ucywgYXRcbi8vIG1vc3Qgb25jZSBwZXIgYW5pbWF0aW9uIGZyYW1lLlxuLy9cbi8vIE5ldmVyIGRpc3BhdGNoZWQgc3luY2hyb25vdXNseTogYSByZWZyZXNoIGNhbiBhcnJpdmUgd2hpbGUgYW4gZWRpdG9yIGlzIGluXG4vLyB0aGUgbWlkZGxlIG9mIGl0cyBvd24gdXBkYXRlIChDb2RlTWlycm9yIHRoZW4gdGhyb3dzIFwiQ2FsbHMgdG9cbi8vIEVkaXRvclZpZXcudXBkYXRlIGFyZSBub3QgYWxsb3dlZCB3aGlsZSBhbiB1cGRhdGUgaXMgaW4gcHJvZ3Jlc3NcIiksIGZvclxuLy8gaW5zdGFuY2Ugd2hlbiBzb21ldGhpbmcgYW4gdXBkYXRlIHNldHMgb2ZmIGVuZHMgaW4gcmVmcmVzaFR5cENvbG9ycygpLiBUaGVcbi8vIGZyYW1lIGFsc28gYnVuZGxlcyBidXJzdHMgb2YgcmVmcmVzaGVzIC0gZHJhZ2dpbmcgYSBjb2xvciBzbGlkZXIgc2VuZHMgb25lXG4vLyBwZXIgaW5wdXQgZXZlbnQuIEFuIGVkaXRvciBzdGlsbCBidXN5IHdoZW4gdGhlIGZyYW1lIGNvbWVzICh1cGRhdGVTdGF0ZSBpc1xuLy8gQ29kZU1pcnJvcidzIGludGVybmFsIGZsYWcsIDAgPSBpZGxlOyBpdCBpcyBhbHNvIG5vbi16ZXJvIHdoaWxlIG1lYXN1cmluZylcbi8vIGlzIHJldHJpZWQgYSBmcmFtZSBsYXRlci5cbmZ1bmN0aW9uIGNyZWF0ZUVkaXRvclJlZnJlc2hlcihwbHVnaW4pIHtcbiAgbGV0IGZyYW1lID0gbnVsbDtcbiAgY29uc3QgcnVuID0gKCkgPT4ge1xuICAgIGZyYW1lID0gbnVsbDtcbiAgICBsZXQgYnVzeSA9IGZhbHNlO1xuICAgIHBsdWdpbi5hcHAud29ya3NwYWNlLml0ZXJhdGVBbGxMZWF2ZXMoKGxlYWYpID0+IHtcbiAgICAgIGNvbnN0IGNtID0gbGVhZi52aWV3Py5lZGl0b3I/LmNtO1xuICAgICAgaWYgKCFjbSkgcmV0dXJuO1xuICAgICAgaWYgKGNtLnVwZGF0ZVN0YXRlICE9PSAwKSB7XG4gICAgICAgIGJ1c3kgPSB0cnVlO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICB0cnkge1xuICAgICAgICBjbS5kaXNwYXRjaCh7IGVmZmVjdHM6IHJlZnJlc2hFZmZlY3Qub2YobnVsbCkgfSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAvLyBPbmUgZWRpdG9yIGZhaWxpbmcgbXVzdCBub3Qga2VlcCB0aGUgb3RoZXJzIGZyb20gcmVmcmVzaGluZy5cbiAgICAgICAgY29uc29sZS5lcnJvcihcIltUWVAgbGluayBjb2xvcnNdXCIsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBpZiAoYnVzeSkgc2NoZWR1bGUoKTtcbiAgfTtcbiAgY29uc3Qgc2NoZWR1bGUgPSAoKSA9PiB7XG4gICAgaWYgKGZyYW1lID09PSBudWxsKSBmcmFtZSA9IHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUocnVuKTtcbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IHtcbiAgICBpZiAoZnJhbWUgIT09IG51bGwpIHdpbmRvdy5jYW5jZWxBbmltYXRpb25GcmFtZShmcmFtZSk7XG4gICAgZnJhbWUgPSBudWxsO1xuICB9KTtcbiAgcmV0dXJuIHNjaGVkdWxlO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZnVuY3Rpb24gcmVnaXN0ZXJMaW5rQ29sb3JzKHBsdWdpbikge1xuICBwbHVnaW4ucmVnaXN0ZXJNYXJrZG93blBvc3RQcm9jZXNzb3IoKGVsLCBjdHgpID0+IHtcbiAgICAvLyBTdG9yZSB0aGUgc291cmNlIGV2ZW4gd2hpbGUgY29sb3JpbmcgaXMgb2ZmLCBzbyB0dXJuaW5nIGl0IG9uIGxhdGVyXG4gICAgLy8gYWxzbyBjb3ZlcnMgbGlua3MgdGhhdCBhcmUgYWxyZWFkeSByZW5kZXJlZC5cbiAgICBmb3IgKGNvbnN0IGFuY2hvckVsIG9mIGVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCJhLmludGVybmFsLWxpbmtcIikpIHtcbiAgICAgIGFuY2hvckVsLnNldEF0dHJpYnV0ZShTT1VSQ0VfQVRUUiwgY3R4LnNvdXJjZVBhdGgpO1xuICAgICAgYXBwbHlUb0FuY2hvcihwbHVnaW4sIGFuY2hvckVsKTtcbiAgICB9XG4gIH0pO1xuICAvLyBPYnNpZGlhbidzIFwiLmNtLWhtZC1pbnRlcm5hbC1saW5rXCIgc3BhbiBhbHdheXMgZW5kcyB1cCBvdXRzaWRlIG91ciBtYXJrLFxuICAvLyB3aGF0ZXZlciB0aGUgcHJpb3JpdHksIHNvIGEgcnVsZSBpbiBzdHlsZXMuY3NzICgudHlwLWxpbmspIHNldHMgdGhlIGNvbG9yLlxuICAvLyBMb3dlc3QgcHJpb3JpdHkgYXQgbGVhc3Qgd3JhcHMgXCIuY20tdW5kZXJsaW5lXCIsIGNvdmVyaW5nIHRoZSB3aG9sZSB0ZXh0LlxuICBwbHVnaW4ucmVnaXN0ZXJFZGl0b3JFeHRlbnNpb24oUHJlYy5sb3dlc3QoYnVpbGRMaW5rVmlld1BsdWdpbihwbHVnaW4pKSk7XG5cbiAgY29uc3QgcmVmcmVzaEVkaXRvcnMgPSBjcmVhdGVFZGl0b3JSZWZyZXNoZXIocGx1Z2luKTtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IHtcbiAgICByZWZyZXNoUmVuZGVyZWRMaW5rcyhwbHVnaW4pO1xuICAgIHJlZnJlc2hFZGl0b3JzKCk7XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIC8vIEVkaXRvciBkZWNvcmF0aW9ucyBnbyBhd2F5IHdpdGggdGhlIGV4dGVuc2lvbiBvbiB1bmxvYWQsIHRoZSBpbmxpbmVcbiAgLy8gdmFyaWFibGVzIG9uIHJlbmRlcmVkIGxpbmtzIGRvbid0LlxuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4ge1xuICAgIHBsdWdpbi5hcHAud29ya3NwYWNlLml0ZXJhdGVBbGxMZWF2ZXMoKGxlYWYpID0+IHtcbiAgICAgIGZvciAoY29uc3QgYW5jaG9yRWwgb2YgbGVhZi52aWV3LmNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3JBbGwoYGEuaW50ZXJuYWwtbGlua1ske1NPVVJDRV9BVFRSfV1gKSkge1xuICAgICAgICBhbmNob3JFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShDT0xPUl9WQVIpO1xuICAgICAgfVxuICAgIH0pO1xuICB9KTtcbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckxpbmtDb2xvcnMgfTtcbiIsICJjb25zdCB7IGdldFN1YnR5cE5hbWVzLCBnZXRTdWJ0eXAgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cHNcIik7XG5jb25zdCB7IHN1YnR5cENvbG9yLCBzZXRJbmxpbmVDb2xvciwgYWxsRG9jdW1lbnRzIH0gPSByZXF1aXJlKFwiLi90eXAtY29sb3JzXCIpO1xuY29uc3QgeyBWSUVXX1RZUEVfVFlQX1BBTkUgfSA9IHJlcXVpcmUoXCIuL3R5cC1wYW5lXCIpO1xuXG5jb25zdCBBTExfUFJPUEVSVElFU19WSUVXX1RZUEUgPSBcImFsbC1wcm9wZXJ0aWVzXCI7XG5jb25zdCBISUdITElHSFRfQ0xBU1MgPSBcInR5cC1kZWZhdWx0LXByb3BlcnR5XCI7XG4vLyBGbG9hdGluZyBwcm9wZXJ0aWVzIGFyZSBtYXJrZWQgaXRhbGljIGluc3RlYWQgb2YgYm9sZC5cbmNvbnN0IEZMT0FUSU5HX0NMQVNTID0gXCJ0eXAtZmxvYXRpbmctcHJvcGVydHlcIjtcblxuLy8gT2JzaWRpYW4gYWx3YXlzIGxvd2VyY2FzZXMgZGF0YS1wcm9wZXJ0eS1rZXksIHNvIGNvbXBhcmlzb25zIGlnbm9yZSBjYXNlLlxuZnVuY3Rpb24gcmF3S2V5c0ZvclR5cCh0eXAsIGRlZmF1bHRzKSB7XG4gIGlmICghdHlwIHx8ICFkZWZhdWx0cykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyhkZWZhdWx0cykuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gXCJcIik7XG4gIHJldHVybiBrZXlzLmxlbmd0aCA+IDAgPyBrZXlzLm1hcCgoa2V5KSA9PiBrZXkudG9Mb3dlckNhc2UoKSkgOiBudWxsO1xufVxuXG4vLyBBIFRZUCdzIGZyb250bWF0dGVyIGJsb2NrcyBhcyBbeyBzZWN0aW9uLCBrZXlzLCBmbG9hdGluZyB9XSAobG93ZXJjYXNlKTpcbi8vIHRoZSBUWVAtRnJvbnRtYXR0ZXIgZmlyc3QsIHRoZW4gb3B0aW9uYWxseSBvbmUgU3VidHlwJ3MgYmxvY2sgb3IsIHdpdGhcbi8vIEFMTF9TVUJUWVBTLCBldmVyeSBTdWJ0eXAncyBibG9jayAoc2VlIHN1YnR5cHMuanMpLlxuY29uc3QgQUxMX1NVQlRZUFMgPSBTeW1ib2woXCJhbGwtc3VidHlwc1wiKTtcblxuZnVuY3Rpb24gYmxvY2tPZihkZWZhdWx0cywgZmxvYXRpbmdLZXlzLCBzZWN0aW9uID0gbnVsbCkge1xuICBjb25zdCBrZXlzID0gcmF3S2V5c0ZvclR5cCh0cnVlLCBkZWZhdWx0cykgPz8gW107XG4gIHJldHVybiB7IHNlY3Rpb24sIGtleXMsIGZsb2F0aW5nOiBuZXcgU2V0KChmbG9hdGluZ0tleXMgPz8gW10pLm1hcCgoa2V5KSA9PiBrZXkudG9Mb3dlckNhc2UoKSkpIH07XG59XG5cbmZ1bmN0aW9uIGJsb2Nrc0ZvclR5cChwbHVnaW4sIHR5cCwgc3VidHlwKSB7XG4gIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHBsdWdpbjtcbiAgY29uc3QgYmxvY2tzID0gW2Jsb2NrT2Yoc2V0dGluZ3MudHlwRGVmYXVsdEZyb250bWF0dGVyW3R5cF0sIHNldHRpbmdzLnR5cEZsb2F0aW5nS2V5c1t0eXBdLCBudWxsKV07XG4gIGNvbnN0IHN1YnR5cE5hbWVzID0gc3VidHlwID09PSBBTExfU1VCVFlQUyA/IGdldFN1YnR5cE5hbWVzKHNldHRpbmdzLCB0eXApIDogc3VidHlwID8gW3N1YnR5cF0gOiBbXTtcbiAgZm9yIChjb25zdCBuYW1lIG9mIHN1YnR5cE5hbWVzKSB7XG4gICAgY29uc3QgZGF0YSA9IGdldFN1YnR5cChzZXR0aW5ncywgdHlwLCBuYW1lKTtcbiAgICBpZiAoZGF0YSkgYmxvY2tzLnB1c2goYmxvY2tPZihkYXRhLmZyb250bWF0dGVyLCBkYXRhLmZsb2F0aW5nS2V5cywgbmFtZSkpO1xuICB9XG4gIHJldHVybiBibG9ja3M7XG59XG5cbi8vIFNlcGFyYXRlIHNldHMgb2YgbmFtZXMgdG8gYm9sZCAoXCJzdGFuZGFyZFwiKSBhbmQgdG8gaXRhbGljaXplIChcImZsb2F0aW5nXCIpLlxuLy8gQSBmbG9hdGluZyBrZXkgbmV2ZXIgYWxzbyBjb3VudHMgYXMgc3RhbmRhcmQuIElmIGEga2V5IGlzIGluIHNldmVyYWwgYmxvY2tzLFxuLy8gdGhlIGxhdGVyIGJsb2NrIGRlY2lkZXMgLSBmb3IgYSBub3RlIHRoYXQgaXMgaXRzIFN1YnR5cCBibG9jaywgdGhlIHNhbWUgcnVsZVxuLy8gYXMgZm9yIHRoZSB2YWx1ZSBpbiBnZXRUeXBEZWZhdWx0cyAobWFpbi5qcykuXG5mdW5jdGlvbiBzcGxpdEtleXMoYmxvY2tzKSB7XG4gIGNvbnN0IGlzRmxvYXRpbmcgPSBuZXcgTWFwKCk7XG4gIGZvciAoY29uc3QgeyBrZXlzLCBmbG9hdGluZyB9IG9mIGJsb2Nrcykge1xuICAgIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIGlzRmxvYXRpbmcuc2V0KGtleSwgZmxvYXRpbmcuaGFzKGtleSkpO1xuICB9XG4gIGNvbnN0IHN0YW5kYXJkID0gbmV3IFNldCgpO1xuICBjb25zdCBmbG9hdGluZyA9IG5ldyBTZXQoKTtcbiAgZm9yIChjb25zdCBba2V5LCBmbGFnXSBvZiBpc0Zsb2F0aW5nKSAoZmxhZyA/IGZsb2F0aW5nIDogc3RhbmRhcmQpLmFkZChrZXkpO1xuICByZXR1cm4geyBzdGFuZGFyZDogc3RhbmRhcmQuc2l6ZSA+IDAgPyBzdGFuZGFyZCA6IG51bGwsIGZsb2F0aW5nOiBmbG9hdGluZy5zaXplID4gMCA/IGZsb2F0aW5nIDogbnVsbCB9O1xufVxuXG5jb25zdCBOT19LRVlTID0geyBzdGFuZGFyZDogbnVsbCwgZmxvYXRpbmc6IG51bGwgfTtcblxuZnVuY3Rpb24ga2V5c0ZvckZpbGUocGx1Z2luLCBmaWxlKSB7XG4gIGNvbnN0IHsgY29sb3JWaWV3cyB9ID0gcGx1Z2luLnNldHRpbmdzO1xuICBpZiAoIWNvbG9yVmlld3MuZnJvbnRtYXR0ZXJEZWZhdWx0cykgcmV0dXJuIE5PX0tFWVM7XG4gIGNvbnN0IHR5cCA9IHBsdWdpbi50eXBJbmRleC50eXBPZihmaWxlKTtcbiAgaWYgKCF0eXApIHJldHVybiBOT19LRVlTO1xuICBjb25zdCBzdWJ0eXAgPSBjb2xvclZpZXdzLmZyb250bWF0dGVyRGVmYXVsdHNTdWJ0eXAgPyBwbHVnaW4udHlwSW5kZXguc3VidHlwT2YoZmlsZSkgOiBudWxsO1xuICByZXR1cm4gc3BsaXRLZXlzKGJsb2Nrc0ZvclR5cChwbHVnaW4sIHR5cCwgc3VidHlwKSk7XG59XG5cbi8vIFRZUC1QYW5lIGRldGFpbCBlZGl0b3JzOiBvbmUgZWRpdG9yIHBlciBibG9jayAoc2VlIHR5cFN0b3JlL3N1YnR5cFN0b3JlIGluXG4vLyB0eXAtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKSwgc28gdGhlIG1hcmtzIHNob3cgZXhhY3RseSB0aGF0IGJsb2NrJ3Mga2V5cy5cbi8vIFN1YnR5cCBibG9ja3Mgb25seSB3aXRoIHRoZSBcIlN1YnR5cFwiIHN1Yi10b2dnbGUuXG5mdW5jdGlvbiBrZXlzRm9yU3RvcmUocGx1Z2luLCBzdG9yZSkge1xuICBjb25zdCB7IGNvbG9yVmlld3MgfSA9IHBsdWdpbi5zZXR0aW5ncztcbiAgaWYgKCFjb2xvclZpZXdzLmZyb250bWF0dGVyRGVmYXVsdHMgfHwgIXN0b3JlKSByZXR1cm4gTk9fS0VZUztcbiAgaWYgKHN0b3JlLnN1YnR5cCAmJiAhY29sb3JWaWV3cy5mcm9udG1hdHRlckRlZmF1bHRzU3VidHlwKSByZXR1cm4gTk9fS0VZUztcbiAgcmV0dXJuIHNwbGl0S2V5cyhbYmxvY2tPZihzdG9yZS5nZXRGcm9udG1hdHRlcigpLCBzdG9yZS5nZXRGbG9hdGluZygpKV0pO1xufVxuXG4vLyBQcm9wZXJ0eSBuYW1lIChsb3dlcmNhc2UpIC0+IHsgdHlwcywgYWxsRmxvYXRpbmcgfSBhY3Jvc3MgZXZlcnkgVFlQIHdob3NlXG4vLyBmcm9udG1hdHRlciAob3B0aW9uYWxseSB3aXRoIGl0cyBTdWJ0eXAgYmxvY2tzKSBoYXMgaXQuIFwiQWxsIHByb3BlcnRpZXNcIiBpc1xuLy8gdmF1bHQtd2lkZSB3aXRoIG5vIHNpbmdsZSBUWVAgY29udGV4dCwgc28gdGhlIGZ1bGwgbWFwcGluZyBpcyBjb2xsZWN0ZWQgdG9cbi8vIHRlbGwgXCJleGFjdGx5IG9uZSBUWVBcIiAoY29sb3IpIGZyb20gXCJzZXZlcmFsXCIgKGJvbGQpLiB0eXBzIG1hcHMgVFlQIC0+IHRoZVxuLy8gYmxvY2tzIGhvbGRpbmcgdGhlIGtleSAobnVsbCA9IHRoZSBUWVAtRnJvbnRtYXR0ZXIpOyBvbmx5IHRoZSB1bmFtYmlndW91c1xuLy8gY2FzZSBnZXRzIGNvbG9yZWQuIGFsbEZsb2F0aW5nIGlzIHRydWUgaWYgdGhlIGtleSBpcyBmbG9hdGluZyBpbiBFVkVSWSBibG9ja1xuLy8gb2YgRVZFUlkgVFlQIC0gYW55dGhpbmcgbGVzcyB3b3VsZCBtYWtlIGl0YWxpY3MgbWlzbGVhZGluZy5cbi8vXG4vLyBPd24gdG9nZ2xlIChjb2xvclZpZXdzLmFsbFByb3BlcnRpZXMpLCBpbmRlcGVuZGVudCBvZiBmcm9udG1hdHRlckRlZmF1bHRzLlxuLy8gQSBTdWJ0eXAgcHJvcGVydHkgY291bnRzIGZvciBpdHMgVFlQLlxuZnVuY3Rpb24gdHlwc1VzaW5nS2V5TWFwKHBsdWdpbikge1xuICBjb25zdCBtYXAgPSBuZXcgTWFwKCk7XG4gIGNvbnN0IHsgY29sb3JWaWV3cyB9ID0gcGx1Z2luLnNldHRpbmdzO1xuICBpZiAoIWNvbG9yVmlld3MuYWxsUHJvcGVydGllcykgcmV0dXJuIG1hcDtcbiAgY29uc3QgdHlwcyA9IG5ldyBTZXQoW1xuICAgIC4uLk9iamVjdC5rZXlzKHBsdWdpbi5zZXR0aW5ncy50eXBEZWZhdWx0RnJvbnRtYXR0ZXIpLFxuICAgIC4uLihjb2xvclZpZXdzLmFsbFByb3BlcnRpZXNTdWJ0eXAgPyBPYmplY3Qua2V5cyhwbHVnaW4uc2V0dGluZ3MudHlwU3VidHlwcyA/PyB7fSkgOiBbXSksXG4gIF0pO1xuICBmb3IgKGNvbnN0IHR5cCBvZiB0eXBzKSB7XG4gICAgY29uc3QgYmxvY2tzID0gYmxvY2tzRm9yVHlwKHBsdWdpbiwgdHlwLCBjb2xvclZpZXdzLmFsbFByb3BlcnRpZXNTdWJ0eXAgPyBBTExfU1VCVFlQUyA6IG51bGwpO1xuICAgIGZvciAoY29uc3QgeyBzZWN0aW9uLCBrZXlzLCBmbG9hdGluZyB9IG9mIGJsb2Nrcykge1xuICAgICAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykge1xuICAgICAgICBpZiAoIW1hcC5oYXMoa2V5KSkgbWFwLnNldChrZXksIHsgdHlwczogbmV3IE1hcCgpLCBhbGxGbG9hdGluZzogdHJ1ZSB9KTtcbiAgICAgICAgY29uc3QgZW50cnkgPSBtYXAuZ2V0KGtleSk7XG4gICAgICAgIGlmICghZW50cnkudHlwcy5oYXModHlwKSkgZW50cnkudHlwcy5zZXQodHlwLCBbXSk7XG4gICAgICAgIGVudHJ5LnR5cHMuZ2V0KHR5cCkucHVzaChzZWN0aW9uKTtcbiAgICAgICAgZW50cnkuYWxsRmxvYXRpbmcgPSBlbnRyeS5hbGxGbG9hdGluZyAmJiBmbG9hdGluZy5oYXMoa2V5KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIG1hcDtcbn1cblxuLy8gTWFya3Mgb25seSB0aGUgbmFtZSAoa2V5IGlucHV0KSwgbm90IHRoZSB2YWx1ZSAtIGluIG5vdGVzIChmcm9udG1hdHRlciBhbmRcbi8vIHByb3BlcnRpZXMgc2lkZWJhcikgYXMgd2VsbCBhcyBpbiB0aGUgcGx1Z2luJ3Mgb3duIFRZUC1QYW5lLlxuZnVuY3Rpb24gYXBwbHlUb0NvbnRhaW5lcihjb250YWluZXJFbCwgc3RhbmRhcmRLZXlzLCBmbG9hdGluZ0tleXMpIHtcbiAgaWYgKCFjb250YWluZXJFbCkgcmV0dXJuO1xuICBjb25zdCByb3dzID0gY29udGFpbmVyRWwucXVlcnlTZWxlY3RvckFsbChcIi5tZXRhZGF0YS1wcm9wZXJ0eVtkYXRhLXByb3BlcnR5LWtleV1cIik7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBjb25zdCBrZXlFbCA9IHJvdy5xdWVyeVNlbGVjdG9yKFwiLm1ldGFkYXRhLXByb3BlcnR5LWtleS1pbnB1dFwiKTtcbiAgICBpZiAoIWtleUVsKSBjb250aW51ZTtcbiAgICBjb25zdCBwcm9wZXJ0eUtleSA9IHJvdy5nZXRBdHRyaWJ1dGUoXCJkYXRhLXByb3BlcnR5LWtleVwiKTtcbiAgICBrZXlFbC5jbGFzc0xpc3QudG9nZ2xlKEhJR0hMSUdIVF9DTEFTUywgISFzdGFuZGFyZEtleXMgJiYgc3RhbmRhcmRLZXlzLmhhcyhwcm9wZXJ0eUtleSkpO1xuICAgIGtleUVsLmNsYXNzTGlzdC50b2dnbGUoRkxPQVRJTkdfQ0xBU1MsICEhZmxvYXRpbmdLZXlzICYmIGZsb2F0aW5nS2V5cy5oYXMocHJvcGVydHlLZXkpKTtcbiAgfVxufVxuXG4vLyBcIkFsbCBwcm9wZXJ0aWVzXCIgZG9lc24ndCB1c2UgdGhlIG1ldGFkYXRhIHdpZGdldCBidXQgaXRzIG93biB0cmVlIGl0ZW1zLFxuLy8gcmVhY2hhYmxlIHZpYSB2aWV3LmRvbXMgKG5hbWUgLT4gY29tcG9uZW50KTsgdGhlaXIgdGl0bGUgZWxlbWVudCBpc1xuLy8gLnRyZWUtaXRlbS1pbm5lci10ZXh0LlxuLy9cbi8vIE9uZSBUWVAgdXNpbmcgdGhlIHByb3BlcnR5OiB0aGUgbmFtZSBnZXRzIHRoYXQgVFlQJ3MgY29sb3IuIFNldmVyYWw6IGFcbi8vIHNpbmdsZSBjb2xvciB3b3VsZCBtaXNsZWFkLCBzbyBib2xkIGluc3RlYWQgKHNhbWUgbWFyayBhcyBpbiBhIG5vdGUpLlxuZnVuY3Rpb24gYXBwbHlUb0FsbFByb3BlcnRpZXNWaWV3KHBsdWdpbikge1xuICBjb25zdCB1c2FnZU1hcCA9IHR5cHNVc2luZ0tleU1hcChwbHVnaW4pO1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEFMTF9QUk9QRVJUSUVTX1ZJRVdfVFlQRSkpIHtcbiAgICBjb25zdCBkb21zID0gbGVhZi52aWV3Py5kb21zO1xuICAgIGlmICghZG9tcykgY29udGludWU7XG4gICAgZm9yIChjb25zdCBba2V5LCBkb21dIG9mIE9iamVjdC5lbnRyaWVzKGRvbXMpKSB7XG4gICAgICBjb25zdCB0aXRsZUVsID0gZG9tPy50aXRsZUVsO1xuICAgICAgaWYgKCF0aXRsZUVsKSBjb250aW51ZTtcblxuICAgICAgY29uc3QgZW50cnkgPSB1c2FnZU1hcC5nZXQoa2V5LnRvTG93ZXJDYXNlKCkpO1xuICAgICAgY29uc3QgdHlwcyA9IGVudHJ5Py50eXBzO1xuICAgICAgY29uc3QgY291bnQgPSB0eXBzID8gdHlwcy5zaXplIDogMDtcbiAgICAgIHRpdGxlRWwuY2xhc3NMaXN0LnRvZ2dsZShISUdITElHSFRfQ0xBU1MsIGNvdW50ID4gMSk7XG5cbiAgICAgIC8vIEl0YWxpYyBhcyBzb29uIGFzIGl0IGlzIGZsb2F0aW5nIEVWRVJZV0hFUkUuIFVubGlrZSBib2xkIHRoaXMgaXNuJ3RcbiAgICAgIC8vIGxpbWl0ZWQgdG8gb25lIFRZUCwgc28gYm90aCBjYW4gYXBwbHkgYXQgb25jZS5cbiAgICAgIHRpdGxlRWwuY2xhc3NMaXN0LnRvZ2dsZShGTE9BVElOR19DTEFTUywgY291bnQgPiAwICYmIGVudHJ5LmFsbEZsb2F0aW5nKTtcblxuICAgICAgLy8gV2l0aCBcIlN1YnR5cFwiLCB0aGUgY29sb3Igb2YgdGhlIFN1YnR5cCBibG9jayB0aGUgcHJvcGVydHkgY29tZXMgZnJvbSAtXG4gICAgICAvLyBidXQgb25seSBpZiBleGFjdGx5IG9uZSBibG9jayBvZiB0aGF0IFRZUCBoYXMgaXQuIE90aGVyd2lzZSB0aGUgY2hvaWNlXG4gICAgICAvLyB3b3VsZCBiZSBhcmJpdHJhcnkgYW5kIGNoYW5nZSB3aXRoIGJsb2NrIG9yZGVyLCBzbyB0aGUgVFlQIGNvbG9yXG4gICAgICAvLyAoc3VidHlwQ29sb3Igd2l0aCBudWxsKSBpcyB1c2VkLlxuICAgICAgaWYgKGNvdW50ID09PSAxKSB7XG4gICAgICAgIGNvbnN0IFtbb25seVR5cCwgc2VjdGlvbnNdXSA9IHR5cHM7XG4gICAgICAgIGNvbnN0IGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MuYWxsUHJvcGVydGllc1N1YnR5cFxuICAgICAgICAgID8gc3VidHlwQ29sb3IocGx1Z2luLnNldHRpbmdzLCBvbmx5VHlwLCBzZWN0aW9ucy5sZW5ndGggPT09IDEgPyBzZWN0aW9uc1swXSA6IG51bGwpXG4gICAgICAgICAgOiBwbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW29ubHlUeXBdO1xuICAgICAgICAvLyAhaW1wb3J0YW50LCBiZWNhdXNlIHRoZSBib2xkIHJ1bGUgaW4gc3R5bGVzLmNzcyBhbHNvIHNldHMgY29sb3JcbiAgICAgICAgLy8gIWltcG9ydGFudCBhbmQgY291bGQgc3RpbGwgYmUgYXR0YWNoZWQgZnJvbSBhbiBlYXJsaWVyIHN0YXRlLlxuICAgICAgICBzZXRJbmxpbmVDb2xvcih0aXRsZUVsLCBjb2xvciwgXCJpbXBvcnRhbnRcIik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzZXRJbmxpbmVDb2xvcih0aXRsZUVsLCBudWxsKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gYXBwbHlGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xuICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXc7XG4gICAgY29uc3QgeyBzdGFuZGFyZCwgZmxvYXRpbmcgfSA9IGtleXNGb3JGaWxlKHBsdWdpbiwgdmlldz8uZmlsZSk7XG4gICAgYXBwbHlUb0NvbnRhaW5lcih2aWV3Py5tZXRhZGF0YUVkaXRvcj8uY29udGFpbmVyRWwsIHN0YW5kYXJkLCBmbG9hdGluZyk7XG4gIH1cblxuICAvLyBUaGUgcHJvcGVydGllcyBzaWRlYmFyIGFsd2F5cyBzaG93cyB0aGUgYWN0aXZlIGZpbGUgYnV0IGtlZXBzIG5vIHJlbGlhYmxlXG4gIC8vIHJlZmVyZW5jZSB0byBpdCwgaGVuY2UgdGhlIGZhbGxiYWNrIHRvIHRoZSB3b3Jrc3BhY2UncyBhY3RpdmUgZmlsZS5cbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcImZpbGUtcHJvcGVydGllc1wiKSkge1xuICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXc7XG4gICAgY29uc3QgZmlsZSA9IHZpZXc/LmZpbGUgPz8gcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xuICAgIGNvbnN0IHsgc3RhbmRhcmQsIGZsb2F0aW5nIH0gPSBrZXlzRm9yRmlsZShwbHVnaW4sIGZpbGUpO1xuICAgIGFwcGx5VG9Db250YWluZXIodmlldz8ubWV0YWRhdGFFZGl0b3I/LmNvbnRhaW5lckVsLCBzdGFuZGFyZCwgZmxvYXRpbmcpO1xuICB9XG5cbiAgLy8gVGhlIFRZUC1QYW5lOiBlYWNoIGVkaXRvciBzaG93cyBleGFjdGx5IG9uZSBibG9jayAoVFlQIG9yIFN1YnR5cCkuXG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoVklFV19UWVBFX1RZUF9QQU5FKSkge1xuICAgIGZvciAoY29uc3QgZWRpdG9yIG9mIGxlYWYudmlldz8uZnJvbnRtYXR0ZXJFZGl0b3JzID8/IFtdKSB7XG4gICAgICBjb25zdCB7IHN0YW5kYXJkLCBmbG9hdGluZyB9ID0ga2V5c0ZvclN0b3JlKHBsdWdpbiwgZWRpdG9yLm93bmVyPy50eXBTdG9yZSk7XG4gICAgICBhcHBseVRvQ29udGFpbmVyKGVkaXRvci5jb250YWluZXJFbCwgc3RhbmRhcmQsIGZsb2F0aW5nKTtcbiAgICB9XG4gIH1cblxuICBhcHBseVRvQWxsUHJvcGVydGllc1ZpZXcocGx1Z2luKTtcbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseUZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodChwbHVnaW4pO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAubWV0YWRhdGFDYWNoZS5vbihcImNoYW5nZWRcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLm1ldGFkYXRhQ2FjaGUub24oXCJyZXNvbHZlZFwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwiYWN0aXZlLWxlYWYtY2hhbmdlXCIsIHJlZnJlc2gpKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KHJlZnJlc2gpO1xuXG4gIC8vIEJvbGQvaXRhbGljIG1hcmtzIHdvdWxkIG90aGVyd2lzZSBzdGF5IG9uIHByb3BlcnR5IG5hbWVzIGluIG9wZW4gbm90ZXMsXG4gIC8vIHRoZSBwcm9wZXJ0aWVzIHNpZGViYXIgYW5kIFwiQWxsIHByb3BlcnRpZXNcIiBhZnRlciB0aGUgcGx1Z2luIGlzIGRpc2FibGVkLlxuICAvLyBUaGUgY29sb3IgaW4gXCJBbGwgcHJvcGVydGllc1wiIGdvZXMgd2l0aCB0aGUgb3RoZXIgaW5saW5lIGNvbG9yc1xuICAvLyAoY2xlYXJJbmxpbmVDb2xvcnMsIHNlZSBtYWluLmpzKS5cbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGRvYyBvZiBhbGxEb2N1bWVudHMocGx1Z2luLmFwcCkpIHtcbiAgICAgIGZvciAoY29uc3QgZWwgb2YgZG9jLnF1ZXJ5U2VsZWN0b3JBbGwoYC4ke0hJR0hMSUdIVF9DTEFTU30sIC4ke0ZMT0FUSU5HX0NMQVNTfWApKSB7XG4gICAgICAgIGVsLmNsYXNzTGlzdC5yZW1vdmUoSElHSExJR0hUX0NMQVNTLCBGTE9BVElOR19DTEFTUyk7XG4gICAgICB9XG4gICAgfVxuICB9KTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyRnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0IH07XG4iLCAiY29uc3QgeyBOb3RpY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgdHlwU3RvcmUsIHN1YnR5cFN0b3JlIH0gPSByZXF1aXJlKFwiLi90eXAtZnJvbnRtYXR0ZXItZWRpdG9yXCIpO1xuY29uc3QgeyBnZXRTdWJ0eXBOYW1lcywgaXNFbXB0eVZhbHVlIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBzXCIpO1xuY29uc3QgeyBwbHVyYWwsIGpvaW5BbmQgfSA9IHJlcXVpcmUoXCIuL3R5cC11dGlsc1wiKTtcbmNvbnN0IHsgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcblxuLy8gT2JzaWRpYW4gbG93ZXJjYXNlcyBwcm9wZXJ0eSBuYW1lcyBpbnRlcm5hbGx5LCBzbyBtYXRjaGluZyBpZ25vcmVzIGNhc2U7XG4vLyB0aGUgbmV3IG5hbWUgaXMga2VwdCBleGFjdGx5IGFzIHR5cGVkLlxuZnVuY3Rpb24gc2FtZUtleShhLCBiKSB7XG4gIHJldHVybiBhLnRvTG93ZXJDYXNlKCkgPT09IGIudG9Mb3dlckNhc2UoKTtcbn1cblxuLy8gUmVuYW1lcyBvbGRLZXkgaW4gb25lIGZyb250bWF0dGVyIGJsb2NrIChUWVAgb3IgU3VidHlwLCBzZWUgdHlwU3RvcmUvXG4vLyBzdWJ0eXBTdG9yZSBpbiB0eXAtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKSwga2VlcGluZyBpdHMgcG9zaXRpb24sIGFuZCBtb3Zlc1xuLy8gdGhlIGZsb2F0aW5nIGZsYWcgYWxvbmcuIElmIG5ld0tleSBhbHJlYWR5IGV4aXN0cyB0aGVyZSAoYSBtZXJnZSwgbGlrZVxuLy8gT2JzaWRpYW4ncyBvd24gbWVyZ2UgaW4gdGhlIG5vdGVzKSwgdGhlIGV4aXN0aW5nIGVudHJ5IGtlZXBzIGl0cyBwb3NpdGlvblxuLy8gYW5kIG9ubHkgdGFrZXMgdGhlIG9sZCB2YWx1ZSBpZiBpdHMgb3duIGlzIGVtcHR5LiBSZXR1cm5zIHRydWUgb24gYSBjaGFuZ2UuXG5mdW5jdGlvbiByZW5hbWVJblN0b3JlKHN0b3JlLCBvbGRLZXksIG5ld0tleSkge1xuICBjb25zdCBkZWZhdWx0cyA9IHN0b3JlLmdldEZyb250bWF0dGVyKCk7XG4gIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyhkZWZhdWx0cyk7XG4gIGNvbnN0IHNvdXJjZUtleSA9IGtleXMuZmluZCgoa2V5KSA9PiBzYW1lS2V5KGtleSwgb2xkS2V5KSk7XG4gIGlmIChzb3VyY2VLZXkgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZhbHNlO1xuICAvLyBBIHB1cmUgY2hhbmdlIG9mIGNhc2UgZmluZHMgc291cmNlS2V5IGl0c2VsZiBmb3IgbmV3S2V5IC0gbm90IGEgbWVyZ2UuXG4gIGNvbnN0IHRhcmdldEtleSA9IGtleXMuZmluZCgoa2V5KSA9PiBrZXkgIT09IHNvdXJjZUtleSAmJiBzYW1lS2V5KGtleSwgbmV3S2V5KSk7XG4gIGlmICh0YXJnZXRLZXkgPT09IHVuZGVmaW5lZCAmJiBzb3VyY2VLZXkgPT09IG5ld0tleSkgcmV0dXJuIGZhbHNlO1xuXG4gIGNvbnN0IG5leHQgPSB7fTtcbiAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykge1xuICAgIGlmIChrZXkgIT09IHNvdXJjZUtleSkge1xuICAgICAgbmV4dFtrZXldID0gZGVmYXVsdHNba2V5XTtcbiAgICB9IGVsc2UgaWYgKHRhcmdldEtleSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBuZXh0W25ld0tleV0gPSBkZWZhdWx0c1tzb3VyY2VLZXldO1xuICAgIH1cbiAgfVxuICBpZiAodGFyZ2V0S2V5ICE9PSB1bmRlZmluZWQgJiYgaXNFbXB0eVZhbHVlKG5leHRbdGFyZ2V0S2V5XSkpIG5leHRbdGFyZ2V0S2V5XSA9IGRlZmF1bHRzW3NvdXJjZUtleV07XG4gIHN0b3JlLnNldEZyb250bWF0dGVyKG5leHQpO1xuXG4gIGNvbnN0IGZsb2F0aW5nID0gc3RvcmUuZ2V0RmxvYXRpbmcoKTtcbiAgaWYgKGZsb2F0aW5nLmxlbmd0aCA+IDApIHtcbiAgICAvLyBPbiBhIG1lcmdlIHRoZSB0YXJnZXQncyBmbG9hdGluZyBmbGFnIHdpbnMuXG4gICAgc3RvcmUuc2V0RmxvYXRpbmcoXG4gICAgICB0YXJnZXRLZXkgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IGZsb2F0aW5nLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IHNvdXJjZUtleSlcbiAgICAgICAgOiBmbG9hdGluZy5tYXAoKGtleSkgPT4gKGtleSA9PT0gc291cmNlS2V5ID8gbmV3S2V5IDoga2V5KSlcbiAgICApO1xuICB9XG5cbiAgLy8gVGhlIHNob3J0Y3V0IGJlbG9uZ3MgdG8gdGhlIGtleSBhbmQgbW92ZXMgd2l0aCBpdDsgb24gYSBtZXJnZSB0aGVcbiAgLy8gdGFyZ2V0J3Mgd2lucywgYXMgd2l0aCBmbG9hdGluZy5cbiAgY29uc3Qgc2hvcnRjdXRzID0geyAuLi5zdG9yZS5nZXRTaG9ydGN1dHMoKSB9O1xuICBpZiAoc2hvcnRjdXRzW3NvdXJjZUtleV0pIHtcbiAgICBpZiAodGFyZ2V0S2V5ID09PSB1bmRlZmluZWQpIHNob3J0Y3V0c1tuZXdLZXldID0gc2hvcnRjdXRzW3NvdXJjZUtleV07XG4gICAgZGVsZXRlIHNob3J0Y3V0c1tzb3VyY2VLZXldO1xuICAgIHN0b3JlLnNldFNob3J0Y3V0cyhzaG9ydGN1dHMpO1xuICB9XG4gIHJldHVybiB0cnVlO1xufVxuXG4vLyBQaW5uZWQgZW50cmllcyBvZiB0aGUgZ2xvYmFsIG9yZGVyIGFsbG93IG5vIGR1cGxpY2F0ZXMsIHNvIGFuIGV4aXN0aW5nXG4vLyB0YXJnZXQgZW50cnkga2VlcHMgaXRzIHBvc2l0aW9uIGFuZCB0aGUgb2xkIG9uZSBnb2VzLlxuZnVuY3Rpb24gcmVuYW1lSW5HbG9iYWxPcmRlcihzZXR0aW5ncywgb2xkS2V5LCBuZXdLZXkpIHtcbiAgY29uc3Qgb3JkZXIgPSBzZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyO1xuICBjb25zdCBzb3VyY2UgPSBvcmRlci5maW5kKChlbnRyeSkgPT4gZW50cnkua2luZCA9PT0gXCJwcm9wZXJ0eVwiICYmIHNhbWVLZXkoZW50cnkubmFtZSwgb2xkS2V5KSk7XG4gIGlmICghc291cmNlKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHRhcmdldCA9IG9yZGVyLmZpbmQoKGVudHJ5KSA9PiBlbnRyeSAhPT0gc291cmNlICYmIGVudHJ5LmtpbmQgPT09IFwicHJvcGVydHlcIiAmJiBzYW1lS2V5KGVudHJ5Lm5hbWUsIG5ld0tleSkpO1xuICBpZiAodGFyZ2V0KSBzZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyID0gb3JkZXIuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkgIT09IHNvdXJjZSk7XG4gIGVsc2UgaWYgKHNvdXJjZS5uYW1lID09PSBuZXdLZXkpIHJldHVybiBmYWxzZTtcbiAgZWxzZSBzb3VyY2UubmFtZSA9IG5ld0tleTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHN5bmNSZW5hbWUocGx1Z2luLCBvbGRLZXksIG5ld0tleSkge1xuICBpZiAodHlwZW9mIG9sZEtleSAhPT0gXCJzdHJpbmdcIiB8fCB0eXBlb2YgbmV3S2V5ICE9PSBcInN0cmluZ1wiKSByZXR1cm47XG4gIG5ld0tleSA9IG5ld0tleS50cmltKCk7XG4gIGlmIChvbGRLZXkgPT09IFwiXCIgfHwgbmV3S2V5ID09PSBcIlwiIHx8IG9sZEtleSA9PT0gbmV3S2V5KSByZXR1cm47XG4gIC8vIFRZUC9TVUJUWVAgYXJlIG5ldmVyIHBhcnQgb2YgYSBibG9jayAoc2VlIHN0cmlwVHlwUHJvcGVydHkgaW5cbiAgLy8gdHlwLWZyb250bWF0dGVyLWVkaXRvci5qcyksIHNvIHJlbmFtZXMgZnJvbSBvciB0byB0aGVtIGFyZSBpZ25vcmVkLlxuICBpZiAoW29sZEtleSwgbmV3S2V5XS5zb21lKChrZXkpID0+IHNhbWVLZXkoa2V5LCBUWVBfUFJPUEVSVFkpIHx8IHNhbWVLZXkoa2V5LCBTVUJUWVBfUFJPUEVSVFkpKSkgcmV0dXJuO1xuXG4gIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHBsdWdpbjtcbiAgbGV0IHR5cENvdW50ID0gMDtcbiAgbGV0IHN1YnR5cENvdW50ID0gMDtcbiAgY29uc3QgY291bnQgPSAoc3RvcmUpID0+IChzdG9yZS5zdWJ0eXAgPyBzdWJ0eXBDb3VudCsrIDogdHlwQ291bnQrKyk7XG4gIGNvbnN0IHR5cHMgPSBuZXcgU2V0KFsuLi5PYmplY3Qua2V5cyhzZXR0aW5ncy50eXBEZWZhdWx0RnJvbnRtYXR0ZXIpLCAuLi5PYmplY3Qua2V5cyhzZXR0aW5ncy50eXBTdWJ0eXBzID8/IHt9KV0pO1xuICBmb3IgKGNvbnN0IHR5cCBvZiB0eXBzKSB7XG4gICAgY29uc3Qgc3RvcmVzID0gW3R5cFN0b3JlKHBsdWdpbiwgdHlwKSwgLi4uZ2V0U3VidHlwTmFtZXMoc2V0dGluZ3MsIHR5cCkubWFwKChzdWJ0eXApID0+IHN1YnR5cFN0b3JlKHBsdWdpbiwgdHlwLCBzdWJ0eXApKV07XG5cbiAgICAvLyBBIHZhdWx0LXdpZGUgcmVuYW1lIGhpdHMgRVZFUlkgYmxvY2sgaG9sZGluZyB0aGUga2V5IC0gdGhlIHNhbWUga2V5IG1heVxuICAgIC8vIGFwcGVhciBpbiBzZXZlcmFsIGJsb2NrcyAoc2VlIHR5cFN1YnR5cHMgaW4gc3VidHlwcy5qcykuIE9ubHkgd2l0aGluIG9uZVxuICAgIC8vIGJsb2NrIGNhbiB0aGUgbmV3IG5hbWUgY29sbGlkZTsgcmVuYW1lSW5TdG9yZSBtZXJnZXMgdGhlIHR3byB0aGVyZS5cbiAgICBmb3IgKGNvbnN0IHN0b3JlIG9mIHN0b3Jlcykge1xuICAgICAgaWYgKHJlbmFtZUluU3RvcmUoc3RvcmUsIG9sZEtleSwgbmV3S2V5KSkgY291bnQoc3RvcmUpO1xuICAgIH1cbiAgfVxuICBjb25zdCBvcmRlckNoYW5nZWQgPSByZW5hbWVJbkdsb2JhbE9yZGVyKHNldHRpbmdzLCBvbGRLZXksIG5ld0tleSk7XG4gIGlmICh0eXBDb3VudCA9PT0gMCAmJiBzdWJ0eXBDb3VudCA9PT0gMCAmJiAhb3JkZXJDaGFuZ2VkKSByZXR1cm47XG5cbiAgYXdhaXQgcGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICBwbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG5cbiAgY29uc3QgcGFydHMgPSBbXTtcbiAgaWYgKHR5cENvdW50ID4gMCkgcGFydHMucHVzaChwbHVyYWwodHlwQ291bnQsIFwiVFlQIGJsb2NrXCIpKTtcbiAgaWYgKHN1YnR5cENvdW50ID4gMCkgcGFydHMucHVzaChwbHVyYWwoc3VidHlwQ291bnQsIFwiU3VidHlwIGJsb2NrXCIpKTtcbiAgaWYgKG9yZGVyQ2hhbmdlZCkgcGFydHMucHVzaChcInRoZSBnbG9iYWwgb3JkZXJcIik7XG4gIG5ldyBOb3RpY2UoYFRZUC1TeXN0ZW06IHJlbmFtZWQgXCIke29sZEtleX1cIiBcdTIxOTIgXCIke25ld0tleX1cIiBpbiAke2pvaW5BbmQocGFydHMpfS5gKTtcbn1cblxuLy8gT2JzaWRpYW4ncyBcIkFsbCBwcm9wZXJ0aWVzXCIgdmlldyBhbmQgQmFzZXMgKG5hbWluZyBhIG5ldyBub3RlIHByb3BlcnR5KVxuLy8gcmVuYW1lIHByb3BlcnRpZXMgdmF1bHQtd2lkZSBvbmx5IHRocm91Z2ggYXBwLmZpbGVNYW5hZ2VyLnJlbmFtZVByb3BlcnR5LFxuLy8gc28gd3JhcHBpbmcgdGhhdCBvbmUgbWV0aG9kIGNhdGNoZXMgZXZlcnkgcmVhbCByZW5hbWUuIEJhc2VzJyBcIkRpc3BsYXlcbi8vIG5hbWVcIiBvbmx5IGNoYW5nZXMgdGhlIC5iYXNlIGZpbGUsIG5vdCB0aGUgbm90ZXMsIGFuZCByaWdodGx5IGRvZXNuJ3QgcGFzc1xuLy8gdGhyb3VnaCBoZXJlLlxuZnVuY3Rpb24gcmVnaXN0ZXJQcm9wZXJ0eVJlbmFtZVN5bmMocGx1Z2luKSB7XG4gIGNvbnN0IGZpbGVNYW5hZ2VyID0gcGx1Z2luLmFwcC5maWxlTWFuYWdlcjtcbiAgaWYgKGZpbGVNYW5hZ2VyLl9fdHlwU3lzdGVtUmVuYW1lU3luY1BhdGNoZWQpIHJldHVybjtcbiAgZmlsZU1hbmFnZXIuX190eXBTeXN0ZW1SZW5hbWVTeW5jUGF0Y2hlZCA9IHRydWU7XG5cbiAgY29uc3Qgb3JpZ2luYWwgPSBmaWxlTWFuYWdlci5yZW5hbWVQcm9wZXJ0eTtcbiAgZmlsZU1hbmFnZXIucmVuYW1lUHJvcGVydHkgPSBhc3luYyBmdW5jdGlvbiAob2xkS2V5LCBuZXdLZXksIC4uLnJlc3QpIHtcbiAgICAvLyBJZiB0aGUgb3JpZ2luYWwgdGhyb3dzIChhY2NlcHRSZW5hbWUgaGFuZGxlcyB0aGF0KSwgc2V0dGluZ3Mgc3RheSBhc1xuICAgIC8vIHRoZXkgYXJlLlxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IG9yaWdpbmFsLmNhbGwodGhpcywgb2xkS2V5LCBuZXdLZXksIC4uLnJlc3QpO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBzeW5jUmVuYW1lKHBsdWdpbiwgb2xkS2V5LCBuZXdLZXkpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiVFlQLVN5c3RlbTogcHJvcGVydHkgcmVuYW1lIG5vdCBhcHBsaWVkXCIsIGVycm9yKTtcbiAgICAgIG5ldyBOb3RpY2UoYFRZUC1TeXN0ZW06IHJlbmFtZSBvZiBcIiR7b2xkS2V5fVwiIG5vdCBhcHBsaWVkIFx1MjAxMyAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IHtcbiAgICBmaWxlTWFuYWdlci5yZW5hbWVQcm9wZXJ0eSA9IG9yaWdpbmFsO1xuICAgIGRlbGV0ZSBmaWxlTWFuYWdlci5fX3R5cFN5c3RlbVJlbmFtZVN5bmNQYXRjaGVkO1xuICB9KTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyUHJvcGVydHlSZW5hbWVTeW5jIH07XG4iLCAiY29uc3QgeyBGdXp6eVN1Z2dlc3RNb2RhbCwgTm90aWNlLCBwcmVwYXJlRnV6enlTZWFyY2ggfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgY29tcGFyZVR5cHMsIERFRkFVTFRfU09SVF9PUkRFUiB9ID0gcmVxdWlyZShcIi4vdHlwLXBhbmVcIik7XG5jb25zdCB7IG5hbWVDb2xvciwgcGFpbnRDb2xvckRvdCB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxuLy8gTmF0aXZlIHJlcGxhY2VtZW50IGZvciBUZW1wbGF0ZXIncyB0cC5zeXN0ZW0uc3VnZ2VzdGVyIHdoZW4gY2hvb3NpbmcgYSBUWVBcbi8vIChzZWUgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qcyksIGJ1aWx0IG9uIE9ic2lkaWFuJ3Ncbi8vIEZ1enp5U3VnZ2VzdE1vZGFsIGxpa2UgVGVtcGxhdGVyJ3Mgb3duLCBidXQgc2hvd2luZyBjb2xvciBvciBkb3QsXG4vLyBkZXNjcmlwdGlvbiBhbmQgbm90ZSBjb3VudCBwZXIgcm93LiBVbnJlZ2lzdGVyZWQgZW50cmllcyBhcmUgbXV0ZWQsIGFzIGluXG4vLyB0aGUgVFlQLUxpc3QuXG5jbGFzcyBUeXBQaWNrZXJNb2RhbCBleHRlbmRzIEZ1enp5U3VnZ2VzdE1vZGFsIHtcbiAgY29uc3RydWN0b3IoYXBwLCBwbHVnaW4sIGl0ZW1zLCByZXNvbHZlKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgICB0aGlzLml0ZW1zID0gaXRlbXM7XG4gICAgdGhpcy5yZXNvbHZlID0gcmVzb2x2ZTtcbiAgICB0aGlzLmNob3NlbiA9IGZhbHNlO1xuICAgIHRoaXMuc2V0UGxhY2Vob2xkZXIoXCJFU0MgdG8gY2FuY2VsXCIpO1xuICB9XG5cbiAgZ2V0SXRlbXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuaXRlbXM7XG4gIH1cblxuICAvLyBTZWFyY2ggYWxzbyBjb3ZlcnMgdGhlIGRlc2NyaXB0aW9uIGFuZCwgd2hlcmUgc2hvd24gaW4gdGhlIHJvd1xuICAvLyAoc2hvd1N1YnR5cHMpLCB0aGUgU3VidHlwIG5hbWVzOiB3aGF0IHlvdSBzZWUgeW91IGV4cGVjdCB0byBiZSBhYmxlIHRvIHR5cGUuXG4gIGdldEl0ZW1UZXh0KGl0ZW0pIHtcbiAgICByZXR1cm4gW2l0ZW0udHlwLCBpdGVtLnN1YnR5cHM/LmpvaW4oXCIgXCIpLCBpdGVtLmRlc2NyaXB0aW9uXS5maWx0ZXIoQm9vbGVhbikuam9pbihcIiBcIik7XG4gIH1cblxuICByZW5kZXJTdWdnZXN0aW9uKG1hdGNoLCBlbCkge1xuICAgIGNvbnN0IGl0ZW0gPSBtYXRjaC5pdGVtO1xuICAgIGVsLmFkZENsYXNzKFwidHlwLXBpY2tlci1zdWdnZXN0aW9uXCIpO1xuICAgIGlmIChpdGVtLnVucmVnaXN0ZXJlZCkgZWwuYWRkQ2xhc3MoXCJ0eXAtcGlja2VyLXVucmVnaXN0ZXJlZFwiKTtcblxuICAgIGlmIChpdGVtLnVucmVnaXN0ZXJlZCkge1xuICAgICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtcGlja2VyLW5hbWVcIiwgdGV4dDogaXRlbS50eXAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucmVuZGVyQ29sb3JlZE5hbWUoZWwsIGl0ZW0udHlwLCBpdGVtLnR5cCk7XG4gICAgfVxuXG4gICAgaWYgKGl0ZW0uc3VidHlwcz8ubGVuZ3RoKSB0aGlzLnJlbmRlclN1YnR5cFByZXZpZXcoZWwsIGl0ZW0pO1xuXG4gICAgaWYgKGl0ZW0uZGVzY3JpcHRpb24pIHtcbiAgICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXBpY2tlci1kZXNjXCIsIHRleHQ6IGl0ZW0uZGVzY3JpcHRpb24gfSk7XG4gICAgfVxuXG4gICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtcGlja2VyLWNvdW50XCIsIHRleHQ6IFN0cmluZyhpdGVtLmNvdW50KSB9KTtcbiAgfVxuXG4gIC8vIE5hbWUgaW4gdGhlIGNvbG9yIG9mIGNvbG9yVHlwIChvciBvZiB0aGUgU3VidHlwLCBzZWUgbmFtZUNvbG9yIGluXG4gIC8vIHR5cC1jb2xvcnMuanMpIC0gYXMgY29sb3JlZCB0ZXh0IG9yIHdpdGggYSBkb3QgYmVmb3JlIGl0LCBkZXBlbmRpbmcgb25cbiAgLy8gdGhlIFwiVFlQLVBhbmVcIiBjb2xvcmluZyBzZXR0aW5nLlxuICByZW5kZXJDb2xvcmVkTmFtZShlbCwgdGV4dCwgY29sb3JUeXAsIHN1YnR5cCA9IG51bGwpIHtcbiAgICBjb25zdCB7IGNvbG9yLCBpc0RlZmF1bHQgfSA9IG5hbWVDb2xvcih0aGlzLnBsdWdpbi5zZXR0aW5ncywgY29sb3JUeXAsIHN1YnR5cCk7XG4gICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdCkge1xuICAgICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtcGlja2VyLW5hbWVcIiwgdGV4dCB9KS5zdHlsZS5jb2xvciA9IGNvbG9yO1xuICAgIH0gZWxzZSB7XG4gICAgICBwYWludENvbG9yRG90KGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXBpY2tlci1kb3RcIiB9KSwgY29sb3IsIGlzRGVmYXVsdCk7XG4gICAgICBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1waWNrZXItbmFtZVwiLCB0ZXh0IH0pO1xuICAgIH1cbiAgfVxuXG4gIC8vIFwiVFlQIChTdWJ0eXAgMSwgU3VidHlwIDIpXCIgLSBzaG93cyB3aGF0IGxpZXMgYmVsb3cgdGhlIFRZUCBiZWZvcmUgdGhlXG4gIC8vIHNlcGFyYXRlIFN1YnR5cC1QaWNrZXIgY29tZXMuIEVhY2ggU3VidHlwIGluIGl0cyBvd24gY29sb3IsIGJyYWNrZXRzIGFuZFxuICAvLyBjb21tYXMgbXV0ZWQ7IHVuY29sb3JlZCBsaWtlIHRoZSBuYW1lIHdoZW4gXCJUWVAtUGFuZVwiIGNvbG9yaW5nIGlzIG9mZi5cbiAgcmVuZGVyU3VidHlwUHJldmlldyhlbCwgaXRlbSkge1xuICAgIGNvbnN0IGNvbG9yaXplID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0O1xuICAgIGNvbnN0IHdyYXAgPSBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1waWNrZXItc3VidHlwc1wiIH0pO1xuICAgIHdyYXAuYXBwZW5kVGV4dChcIihcIik7XG4gICAgaXRlbS5zdWJ0eXBzLmZvckVhY2goKHN1YnR5cCwgaW5kZXgpID0+IHtcbiAgICAgIGlmIChpbmRleCA+IDApIHdyYXAuYXBwZW5kVGV4dChcIiwgXCIpO1xuICAgICAgY29uc3Qgc3BhbiA9IHdyYXAuY3JlYXRlU3Bhbih7IHRleHQ6IHN1YnR5cCB9KTtcbiAgICAgIGlmIChjb2xvcml6ZSkgc3Bhbi5zdHlsZS5jb2xvciA9IG5hbWVDb2xvcih0aGlzLnBsdWdpbi5zZXR0aW5ncywgaXRlbS50eXAsIHN1YnR5cCkuY29sb3I7XG4gICAgfSk7XG4gICAgd3JhcC5hcHBlbmRUZXh0KFwiKVwiKTtcbiAgfVxuXG4gIC8vIE9ic2lkaWFuJ3Mgc2VsZWN0U3VnZ2VzdGlvbigpIGNhbGxzIGNsb3NlKCkgQkVGT1JFIG9uQ2hvb3NlSXRlbSgpLiBTZXRcbiAgLy8gXCJjaG9zZW5cIiBhbnkgbGF0ZXIgYW5kIG9uQ2xvc2UoKSByZXNvbHZlcyB3aXRoIG51bGwgZmlyc3QgLSBhIHByb21pc2Ugb25seVxuICAvLyByZXNvbHZlcyBvbmNlLCBzbyBldmVyeSBjaG9pY2Ugd291bGQgY29tZSBiYWNrIGFzIG51bGwuXG4gIHNlbGVjdFN1Z2dlc3Rpb24oaXRlbSwgZXZ0KSB7XG4gICAgdGhpcy5jaG9zZW4gPSB0cnVlO1xuICAgIC8vIFdoYXQgd2FzIHR5cGVkIHdoZW4gY2hvb3Npbmc7IHRoZSBTdWJ0eXAtUGlja2VyIHNvcnRzIGJ5IGl0IChzZWVcbiAgICAvLyBwaWNrVHlwRW50cnkvc29ydEJ5UXVlcnkpLlxuICAgIHRoaXMucXVlcnkgPSB0aGlzLmlucHV0RWwudmFsdWUudHJpbSgpO1xuICAgIHN1cGVyLnNlbGVjdFN1Z2dlc3Rpb24oaXRlbSwgZXZ0KTtcbiAgfVxuXG4gIG9uQ2hvb3NlSXRlbShpdGVtKSB7XG4gICAgdGhpcy5yZXNvbHZlKGl0ZW0udHlwKTtcbiAgfVxuXG4gIC8vIEVTQyBvciBhIGNsaWNrIG91dHNpZGUgY2xvc2VzIHdpdGhvdXQgc2VsZWN0U3VnZ2VzdGlvbjogcmVzb2x2ZSB3aXRoIG51bGxcbiAgLy8gaW5zdGVhZCBvZiBsZWF2aW5nIHRoZSBwcm9taXNlIGhhbmdpbmcsIGxpa2UgdHAuc3lzdGVtLnN1Z2dlc3Rlci5cbiAgb25DbG9zZSgpIHtcbiAgICBzdXBlci5vbkNsb3NlKCk7XG4gICAgaWYgKCF0aGlzLmNob3NlbikgdGhpcy5yZXNvbHZlKG51bGwpO1xuICB9XG59XG5cbi8vIFBpY2tzIGEgU3VidHlwIGZvciBhbiBhbHJlYWR5IGNob3NlbiBUWVAgKHNlZSBwaWNrU3VidHlwKS4gTGlrZVxuLy8gVHlwUGlja2VyTW9kYWwsIHBsdXMgYSBmaXJzdCByb3cgXCJUWVAgKG5vIFN1YnR5cClcIiAoaXRlbS5ub25lKS4gRVNDIHJlc29sdmVzXG4vLyB3aXRoIG51bGwsIGFuZCBUWVAuanMgZ29lcyBiYWNrIHRvIHRoZSBUWVAgY2hvaWNlLiBxdWVyeSBpcyB0aGUgc2VhcmNoIGZyb21cbi8vIHRoZSBUWVAtUGlja2VyIHRoYXQgcHJlLXNvcnRzIHRoZSBsaXN0LlxuY2xhc3MgU3VidHlwUGlja2VyTW9kYWwgZXh0ZW5kcyBUeXBQaWNrZXJNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKGFwcCwgcGx1Z2luLCB0eXAsIGl0ZW1zLCByZXNvbHZlLCBxdWVyeSA9IFwiXCIpIHtcbiAgICBzdXBlcihhcHAsIHBsdWdpbiwgaXRlbXMsIHJlc29sdmUpO1xuICAgIHRoaXMudHlwID0gdHlwO1xuICAgIHRoaXMuc2V0UGxhY2Vob2xkZXIoYFN1YnR5cCBmb3IgJHt0eXB9IFx1MjAxMyBFU0MgdG8gZ28gYmFja2ApO1xuICAgIHRoaXMuaXRlbXMgPSBzb3J0QnlRdWVyeShpdGVtcywgcXVlcnksIChpdGVtKSA9PiB0aGlzLmdldEl0ZW1UZXh0KGl0ZW0pKTtcbiAgfVxuXG4gIC8vIFRoZSBcIm5vIFN1YnR5cFwiIHJvdyBpcyBhbHNvIGZvdW5kIGJ5IHRoZSBUWVAgbmFtZSBpdCBzaG93cywgc28gXCJPUkdBXCJcbiAgLy8gdHlwZWQgaW4gdGhlIFRZUC1QaWNrZXIgYnJpbmdzIGl0IGJhY2sgdG8gdGhlIHRvcC5cbiAgZ2V0SXRlbVRleHQoaXRlbSkge1xuICAgIHJldHVybiBpdGVtLm5vbmUgPyBgJHt0aGlzLnR5cH0gJHtpdGVtLnR5cH1gIDogc3VwZXIuZ2V0SXRlbVRleHQoaXRlbSk7XG4gIH1cblxuICByZW5kZXJTdWdnZXN0aW9uKG1hdGNoLCBlbCkge1xuICAgIGNvbnN0IGl0ZW0gPSBtYXRjaC5pdGVtO1xuICAgIGVsLmFkZENsYXNzKFwidHlwLXBpY2tlci1zdWdnZXN0aW9uXCIpO1xuICAgIGlmIChpdGVtLm5vbmUpIHtcbiAgICAgIC8vIFwiT1JHQSAobm8gU3VidHlwKVwiOiB0aGUgVFlQIGluIGl0cyBjb2xvciwgdGhlIHN1ZmZpeCBpbiBub3JtYWwgdGV4dFxuICAgICAgLy8gY29sb3IgcmF0aGVyIHRoYW4gbXV0ZWQgLSBpdCBpcyBhIHJlYWwgY2hvaWNlLCBub3QgYSBncmF5ZWQtb3V0XG4gICAgICAvLyBub24tY2hvaWNlLCBhbmQgaXQgc3RhbmRzIGFwYXJ0IGZyb20gdGhlIFN1YnR5cCByb3dzIGJlbG93LlxuICAgICAgdGhpcy5yZW5kZXJDb2xvcmVkTmFtZShlbCwgdGhpcy50eXAsIHRoaXMudHlwKTtcbiAgICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXBpY2tlci1ub25lXCIsIHRleHQ6IGAoJHtpdGVtLnR5cH0pYCB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5yZW5kZXJDb2xvcmVkTmFtZShlbCwgaXRlbS50eXAsIHRoaXMudHlwLCBpdGVtLnR5cCk7XG4gICAgfVxuICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXBpY2tlci1jb3VudFwiLCB0ZXh0OiBTdHJpbmcoaXRlbS5jb3VudCkgfSk7XG4gIH1cblxuICBvbkNob29zZUl0ZW0oaXRlbSkge1xuICAgIHRoaXMucmVzb2x2ZShpdGVtLm5vbmUgPyBcIlwiIDogaXRlbS50eXApO1xuICB9XG59XG5cbi8vIFRZUC1QaWNrZXIgd2l0aCBlYWNoIFN1YnR5cCBpbmRlbnRlZCBiZWxvdyBpdHMgVFlQICh0aGUgZGVmYXVsdCB3aGlsZVxuLy8gXCJTZXBhcmF0ZSBTdWJ0eXAtUGlja2VyXCIgaXMgb2ZmLCBzZWUgcGlja1R5cEFuZFN1YnR5cCkuIFRoZSBUWVAgcm93IGl0c2VsZlxuLy8gbWVhbnMgXCJubyBTdWJ0eXBcIi4gU2VhcmNoIHdvcmtzIHBlciBncm91cCBzbyBhIFN1YnR5cCBuZXZlciBhcHBlYXJzIHdpdGhvdXRcbi8vIGl0cyBUWVA6IGEgVFlQIG1hdGNoIGtlZXBzIGFsbCBpdHMgU3VidHlwcywgYSBTdWJ0eXAgbWF0Y2gga2VlcHMgdGhhdCBTdWJ0eXBcbi8vIHdpdGggaXRzIFRZUC4gR3JvdXBzIHNvcnQgYnkgdGhlaXIgYmVzdCBtYXRjaDsgd2l0aGluIGEgZ3JvdXAgYmxvY2sgb3JkZXJcbi8vIHN0YXlzLlxuY2xhc3MgVHlwU3VidHlwUGlja2VyTW9kYWwgZXh0ZW5kcyBUeXBQaWNrZXJNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKGFwcCwgcGx1Z2luLCBncm91cHMsIHJlc29sdmUpIHtcbiAgICBzdXBlcihhcHAsIHBsdWdpbiwgZ3JvdXBzLm1hcCgoZ3JvdXApID0+IGdyb3VwLml0ZW0pLCByZXNvbHZlKTtcbiAgICB0aGlzLmdyb3VwcyA9IGdyb3VwcztcbiAgfVxuXG4gIGdldFN1Z2dlc3Rpb25zKHF1ZXJ5KSB7XG4gICAgY29uc3Qgc2VhcmNoID0gcXVlcnkudHJpbSgpID8gcHJlcGFyZUZ1enp5U2VhcmNoKHF1ZXJ5LnRyaW0oKSkgOiBudWxsO1xuICAgIGNvbnN0IG5vTWF0Y2ggPSB7IHNjb3JlOiAwLCBtYXRjaGVzOiBbXSB9O1xuICAgIGNvbnN0IHJlc3VsdHMgPSBbXTtcbiAgICBmb3IgKGNvbnN0IHsgaXRlbSwgc3VidHlwcyB9IG9mIHRoaXMuZ3JvdXBzKSB7XG4gICAgICBjb25zdCB0eXBNYXRjaCA9IHNlYXJjaCA/IHNlYXJjaCh0aGlzLmdldEl0ZW1UZXh0KGl0ZW0pKSA6IG5vTWF0Y2g7XG4gICAgICBsZXQgc3VidHlwTWF0Y2hlcyA9IHN1YnR5cHMubWFwKChzdWJ0eXApID0+ICh7IGl0ZW06IHN1YnR5cCwgbWF0Y2g6IHNlYXJjaCA/IHNlYXJjaChzdWJ0eXAuc3VidHlwKSA6IG5vTWF0Y2ggfSkpO1xuICAgICAgaWYgKCF0eXBNYXRjaCkgc3VidHlwTWF0Y2hlcyA9IHN1YnR5cE1hdGNoZXMuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkubWF0Y2gpO1xuICAgICAgaWYgKCF0eXBNYXRjaCAmJiBzdWJ0eXBNYXRjaGVzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG5cbiAgICAgIGNvbnN0IHNjb3JlcyA9IFt0eXBNYXRjaCwgLi4uc3VidHlwTWF0Y2hlcy5tYXAoKGVudHJ5KSA9PiBlbnRyeS5tYXRjaCldLmZpbHRlcihCb29sZWFuKS5tYXAoKG1hdGNoKSA9PiBtYXRjaC5zY29yZSk7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzY29yZTogTWF0aC5tYXgoLi4uc2NvcmVzKSxcbiAgICAgICAgcm93czogW3sgaXRlbSwgbWF0Y2g6IHR5cE1hdGNoID8/IG5vTWF0Y2ggfSwgLi4uc3VidHlwTWF0Y2hlcy5tYXAoKGVudHJ5KSA9PiAoeyBpdGVtOiBlbnRyeS5pdGVtLCBtYXRjaDogZW50cnkubWF0Y2ggPz8gbm9NYXRjaCB9KSldLFxuICAgICAgfSk7XG4gICAgfVxuICAgIGlmIChzZWFyY2gpIHJlc3VsdHMuc29ydCgoYSwgYikgPT4gYi5zY29yZSAtIGEuc2NvcmUpO1xuICAgIHJldHVybiByZXN1bHRzLmZsYXRNYXAoKGdyb3VwKSA9PiBncm91cC5yb3dzKTtcbiAgfVxuXG4gIHJlbmRlclN1Z2dlc3Rpb24obWF0Y2gsIGVsKSB7XG4gICAgY29uc3QgaXRlbSA9IG1hdGNoLml0ZW07XG4gICAgaWYgKCFpdGVtLnN1YnR5cCkge1xuICAgICAgc3VwZXIucmVuZGVyU3VnZ2VzdGlvbihtYXRjaCwgZWwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBlbC5hZGRDbGFzcyhcInR5cC1waWNrZXItc3VnZ2VzdGlvblwiLCBcInR5cC1waWNrZXItc3VidHlwXCIpO1xuICAgIHRoaXMucmVuZGVyQ29sb3JlZE5hbWUoZWwsIGl0ZW0uc3VidHlwLCBpdGVtLnR5cCwgaXRlbS5zdWJ0eXApO1xuICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXBpY2tlci1jb3VudFwiLCB0ZXh0OiBTdHJpbmcoaXRlbS5jb3VudCkgfSk7XG4gIH1cblxuICBvbkNob29zZUl0ZW0oaXRlbSkge1xuICAgIHRoaXMucmVzb2x2ZSh7IHR5cDogaXRlbS50eXAsIHN1YnR5cDogaXRlbS5zdWJ0eXAgPz8gbnVsbCB9KTtcbiAgfVxufVxuXG4vLyBJbml0aWFsIG9yZGVyIG9mIGEgcGlja2VyIGxpc3QgZ2l2ZW4gYW4gYWxyZWFkeSB0eXBlZCBxdWVyeSAoZnJvbSB0aGVcbi8vIFRZUC1QaWNrZXIsIHNlZSBwaWNrVHlwRW50cnkpOiBtYXRjaGVzIGZpcnN0IGJ5IHNjb3JlLCB0aGUgcmVzdCBhZnRlciBpblxuLy8gdW5jaGFuZ2VkIG9yZGVyLiBJZiBub3RoaW5nIG1hdGNoZXMgKGEgZGVzY3JpcHRpb24gd2FzIHR5cGVkLCBzYXkpIHRoZVxuLy8gbGlzdCBzdGF5cyBhcyBpdCB3YXMuIFR5cGluZyBpbiB0aGUgcGlja2VyIGl0c2VsZiB1c2VzIE9ic2lkaWFuJ3Mgc2VhcmNoLlxuZnVuY3Rpb24gc29ydEJ5UXVlcnkoaXRlbXMsIHF1ZXJ5LCBpdGVtVGV4dCkge1xuICBjb25zdCBzZWFyY2ggPSBxdWVyeT8udHJpbSgpID8gcHJlcGFyZUZ1enp5U2VhcmNoKHF1ZXJ5LnRyaW0oKSkgOiBudWxsO1xuICBpZiAoIXNlYXJjaCkgcmV0dXJuIGl0ZW1zO1xuICBjb25zdCBzY29yZWQgPSBpdGVtcy5tYXAoKGl0ZW0sIGluZGV4KSA9PiAoeyBpdGVtLCBpbmRleCwgc2NvcmU6IHNlYXJjaChpdGVtVGV4dChpdGVtKSk/LnNjb3JlID8/IG51bGwgfSkpO1xuICBpZiAoc2NvcmVkLmV2ZXJ5KChlbnRyeSkgPT4gZW50cnkuc2NvcmUgPT09IG51bGwpKSByZXR1cm4gaXRlbXM7XG4gIHNjb3JlZC5zb3J0KChhLCBiKSA9PiB7XG4gICAgaWYgKGEuc2NvcmUgPT09IG51bGwgfHwgYi5zY29yZSA9PT0gbnVsbCkgcmV0dXJuIGEuc2NvcmUgPT09IGIuc2NvcmUgPyBhLmluZGV4IC0gYi5pbmRleCA6IGEuc2NvcmUgPT09IG51bGwgPyAxIDogLTE7XG4gICAgcmV0dXJuIGIuc2NvcmUgLSBhLnNjb3JlIHx8IGEuaW5kZXggLSBiLmluZGV4O1xuICB9KTtcbiAgcmV0dXJuIHNjb3JlZC5tYXAoKGVudHJ5KSA9PiBlbnRyeS5pdGVtKTtcbn1cblxuLy8gRm9yIFRZUC5qczogb3BlbnMgdGhlIFN1YnR5cC1QaWNrZXIgaWYgdGhlIFRZUCBoYXMgYXQgbGVhc3Qgb25lIHJlZ2lzdGVyZWRcbi8vIFN1YnR5cCAoaW4gYmxvY2sgb3JkZXIpLiBxdWVyeSBwcmUtc29ydHMgdGhlIGxpc3Q6IHR5cGluZyBcIkxlaHJ2ZXJhbnN0YWx0dW5nXCJcbi8vIHRvIHJlYWNoIE9SR0EgbWVhbnQgdGhhdCBTdWJ0eXAsIHdoaWNoIHRoZW4gc2l0cyBvbiB0b3AgLSBFbnRlciBzdWZmaWNlcy5cbi8vIG9wdGlvbnMgYXMgaW4gZ2V0U3VidHlwczogU3VidHlwcyB0aGF0IGFyZW4ndCBtYW51YWxseSBjcmVhdGFibGUgYXJlIGxlZnRcbi8vIG91dCBieSBkZWZhdWx0LCBsaWtlIHN1Y2ggVFlQIGVudHJpZXMgYmVmb3JlLiBSZXNvbHZlcyB3aXRoXG4vLyAgLSB0aGUgY2hvc2VuIFN1YnR5cCxcbi8vICAtIFwiXCIgZm9yIFwibm8gU3VidHlwXCIgKHRoZSBmaXJzdCByb3cgd2l0aG91dCBhIHF1ZXJ5KSAtIG9yIHJpZ2h0IGF3YXksXG4vLyAgICB3aXRob3V0IGEgcGlja2VyLCBpZiB0aGUgVFlQIGhhcyBubyBzZWxlY3RhYmxlIFN1YnR5cCxcbi8vICAtIG51bGwgb24gRVNDIChUWVAuanMgZ29lcyBiYWNrIHRvIHRoZSBUWVAgY2hvaWNlKS5cbmZ1bmN0aW9uIHBpY2tTdWJ0eXAoYXBwLCBwbHVnaW4sIHR5cCwgcXVlcnkgPSBcIlwiLCBvcHRpb25zID0ge30pIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgY29uc3QgaXRlbXMgPSBwbHVnaW4uZ2V0U3VidHlwcyh0eXAsIG9wdGlvbnMpLm1hcCgoeyBzdWJ0eXAsIGNvdW50IH0pID0+ICh7IHR5cDogc3VidHlwLCBkZXNjcmlwdGlvbjogXCJcIiwgY291bnQgfSkpO1xuICAgIGlmIChpdGVtcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHJlc29sdmUoXCJcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIC8vIFwibm8gU3VidHlwXCIgZmlyc3Q6IEVudGVyIHBpY2tzIGl0IHdpdGhvdXQgdHlwaW5nLCBhbmQgaXQgaXMgbW9yZSBjb21tb25cbiAgICAvLyB0aGFuIGFueSBzaW5nbGUgU3VidHlwLlxuICAgIGNvbnN0IG5vbmVDb3VudCA9IHBsdWdpbi50eXBJbmRleC5zdWJ0eXBCdWNrZXQodHlwKS5ub1N1YnR5cDtcbiAgICBpdGVtcy51bnNoaWZ0KHsgdHlwOiBcIm5vIFN1YnR5cFwiLCBkZXNjcmlwdGlvbjogXCJcIiwgY291bnQ6IG5vbmVDb3VudCwgbm9uZTogdHJ1ZSB9KTtcbiAgICBuZXcgU3VidHlwUGlja2VyTW9kYWwoYXBwLCBwbHVnaW4sIHR5cCwgaXRlbXMsIHJlc29sdmUsIHF1ZXJ5KS5vcGVuKCk7XG4gIH0pO1xufVxuXG4vLyBUWVAgdmFsdWVzIHRoYXQgb2NjdXIgaW4gbm90ZXMgYnV0IGFyZW4ndCBpbiBzZXR0aW5ncy50eXBzLCBsaWtlIHRoZVxuLy8gdW5yZWdpc3RlcmVkIHJvd3Mgb2YgdGhlIFRZUC1MaXN0LiBMaXN0cyBhbmQgcGFkZGVkIHZhbHVlcyAoc2VlIGlzQ2xlYW5LZXkpXG4vLyBhcmUgbGVmdCBvdXQ6IHRoZSBjaG9zZW4gdmFsdWUgaXMgd3JpdHRlbiBpbnRvIGEgbmV3IG5vdGUgYW5kIHNob3VsZG4ndCBiZSBhXG4vLyBjbGVhbnVwIGNhc2UgdGhlcmUuXG5mdW5jdGlvbiB1bnJlZ2lzdGVyZWRJdGVtcyhhcHAsIHBsdWdpbikge1xuICBjb25zdCByZWdpc3RlcmVkID0gbmV3IFNldChwbHVnaW4uc2V0dGluZ3MudHlwcyk7XG4gIGNvbnN0IHsgY291bnRzIH0gPSBwbHVnaW4udHlwSW5kZXgudHlwQ291bnRzKCk7XG4gIGNvbnN0IHNvcnRPcmRlciA9IHBsdWdpbi5zZXR0aW5ncy50eXBTb3J0T3JkZXIgPz8gREVGQVVMVF9TT1JUX09SREVSO1xuICByZXR1cm4gWy4uLmNvdW50cy5rZXlzKCldXG4gICAgLmZpbHRlcigodHlwKSA9PiAhcmVnaXN0ZXJlZC5oYXModHlwKSAmJiBwbHVnaW4udHlwSW5kZXguaXNDbGVhbktleSh0eXApKVxuICAgIC5zb3J0KChhLCBiKSA9PiBjb21wYXJlVHlwcyhzb3J0T3JkZXIsIGEsIGIsIGNvdW50cywgcGx1Z2luLnNldHRpbmdzLnR5cENvbG9ycykpXG4gICAgLm1hcCgodHlwKSA9PiAoeyB0eXAsIGRlc2NyaXB0aW9uOiBcIlwiLCBjb3VudDogY291bnRzLmdldCh0eXApID8/IDAsIHVucmVnaXN0ZXJlZDogdHJ1ZSB9KSk7XG59XG5cbi8vIFBpY2tzIGEgc2luZ2xlIFRZUCwgZm9yIFRZUC5qcyBhbmQgZXZlcnl3aGVyZSBpbiB0aGUgcGx1Z2luLiBpbmNsdWRlTWFudWFsT2ZmXG4vLyBhcyBpbiBnZXRUeXBzKCk7IGluY2x1ZGVVbnJlZ2lzdGVyZWQgYWRkcyB2YWx1ZXMgdGhhdCBvY2N1ciBpbiBub3RlcyBidXRcbi8vIGFyZW4ndCByZWdpc3RlcmVkIChtdXRlZCkuIHNob3dTdWJ0eXBzIHB1dHMgdGhlIFN1YnR5cCBuYW1lcyBhZnRlciB0aGUgVFlQXG4vLyBuYW1lLCBmb3IgdGhlIHNlcGFyYXRlIGZsb3cgd2hlcmUgdGhlIFN1YnR5cC1QaWNrZXIgY29tZXMgYWZ0ZXJ3YXJkcy5cbi8vIFJlc29sdmVzIHdpdGggdGhlIFRZUCwgb3IgbnVsbCBvbiBjYW5jZWwgb3IgaWYgdGhlcmUgaXMgbm90aGluZyB0byBzaG93LlxuZnVuY3Rpb24gcGlja1R5cChhcHAsIHBsdWdpbiwgb3B0aW9ucyA9IHt9KSB7XG4gIHJldHVybiBwaWNrVHlwRW50cnkoYXBwLCBwbHVnaW4sIG9wdGlvbnMpLnRoZW4oKGVudHJ5KSA9PiBlbnRyeT8udHlwID8/IG51bGwpO1xufVxuXG4vLyBMaWtlIHBpY2tUeXAsIGJ1dCByZXNvbHZlcyB3aXRoIHsgdHlwLCBxdWVyeSB9LCBxdWVyeSBiZWluZyB3aGF0IHdhcyB0eXBlZC5cbi8vIE9ubHkgZm9yIHBpY2tUeXBBbmRTdWJ0eXAsIHdoaWNoIHBhc3NlcyBpdCBvbiB0byB0aGUgU3VidHlwLVBpY2tlci5cbmZ1bmN0aW9uIHBpY2tUeXBFbnRyeShhcHAsIHBsdWdpbiwgb3B0aW9ucyA9IHt9KSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgIGNvbnN0IGl0ZW1zID0gdHlwSXRlbXMoYXBwLCBwbHVnaW4sIG9wdGlvbnMpO1xuICAgIGlmICghaXRlbXMpIHtcbiAgICAgIHJlc29sdmUobnVsbCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IG1vZGFsID0gbmV3IFR5cFBpY2tlck1vZGFsKGFwcCwgcGx1Z2luLCBpdGVtcywgKHR5cCkgPT4gcmVzb2x2ZSh0eXAgPT09IG51bGwgPyBudWxsIDogeyB0eXAsIHF1ZXJ5OiBtb2RhbC5xdWVyeSB9KSk7XG4gICAgbW9kYWwub3BlbigpO1xuICB9KTtcbn1cblxuLy8gU2hhcmVkIFRZUCBsaXN0IGZvciBwaWNrVHlwL3BpY2tUeXBBbmRTdWJ0eXA7IG51bGwgcGx1cyBhIG5vdGljZSBpZiB0aGVyZSBpc1xuLy8gbm90aGluZyB0byBzaG93IHdpdGggdGhlc2Ugb3B0aW9ucy5cbmZ1bmN0aW9uIHR5cEl0ZW1zKGFwcCwgcGx1Z2luLCB7IGluY2x1ZGVNYW51YWxPZmYgPSBmYWxzZSwgaW5jbHVkZVVucmVnaXN0ZXJlZCA9IGZhbHNlLCBzaG93U3VidHlwcyA9IGZhbHNlIH0gPSB7fSkge1xuICBjb25zdCBpdGVtcyA9IHBsdWdpbi5nZXRUeXBzKHsgaW5jbHVkZU1hbnVhbE9mZiB9KS5tYXAoKGl0ZW0pID0+ICh7IC4uLml0ZW0sIHVucmVnaXN0ZXJlZDogZmFsc2UgfSkpO1xuICBpZiAoaW5jbHVkZVVucmVnaXN0ZXJlZCkgaXRlbXMucHVzaCguLi51bnJlZ2lzdGVyZWRJdGVtcyhhcHAsIHBsdWdpbikpO1xuICAvLyBPbmx5IHJlZ2lzdGVyZWQgVFlQIGVudHJpZXMgaGF2ZSBTdWJ0eXBzOyB0aGUgb3RoZXJzIHN0YXkgdW5jaGFuZ2VkLlxuICBpZiAoc2hvd1N1YnR5cHMpIHtcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMpIGl0ZW0uc3VidHlwcyA9IHBsdWdpbi5nZXRTdWJ0eXBzKGl0ZW0udHlwLCB7IGluY2x1ZGVNYW51YWxPZmYgfSkubWFwKCh7IHN1YnR5cCB9KSA9PiBzdWJ0eXApO1xuICB9XG4gIGlmIChpdGVtcy5sZW5ndGggPiAwKSByZXR1cm4gaXRlbXM7XG4gIG5ldyBOb3RpY2UoXCJObyBUWVAgYXZhaWxhYmxlLlwiKTtcbiAgcmV0dXJuIG51bGw7XG59XG5cbi8vIEZvciBUWVAuanM6IFRZUCBhbmQgU3VidHlwIGluIG9uZSBnby4gV2l0aCBzZXBhcmF0ZVN1YnR5cFBpY2tlciBvZmYsIG9uZVxuLy8gcGlja2VyIHdpdGggZWFjaCBTdWJ0eXAgaW5kZW50ZWQgYmVsb3cgaXRzIFRZUDsgd2l0aCBpdCBvbiwgZmlyc3QgdGhlXG4vLyBUWVAtUGlja2VyIChTdWJ0eXAgbmFtZXMgYWZ0ZXIgdGhlIFRZUCBuYW1lKSBhbmQgdGhlbiwgaWYgdGhlcmUgaXMgYVxuLy8gc2VsZWN0YWJsZSBTdWJ0eXAsIHRoZSBTdWJ0eXAtUGlja2VyIHByZS1zb3J0ZWQgYnkgdGhlIHF1ZXJ5IChFU0MgZ29lcyBiYWNrXG4vLyB0byB0aGUgVFlQIGNob2ljZSkuIGluY2x1ZGVNYW51YWxPZmYgYWxzbyBhcHBsaWVzIHRvIHRoZSBTdWJ0eXBzLlxuLy8gUmVzb2x2ZXMgd2l0aCB7IHR5cCwgc3VidHlwIH0gKHN1YnR5cCBudWxsIGZvciBcIm5vIFN1YnR5cFwiKSwgb3IgbnVsbCBvblxuLy8gY2FuY2VsLlxuYXN5bmMgZnVuY3Rpb24gcGlja1R5cEFuZFN1YnR5cChhcHAsIHBsdWdpbiwgb3B0aW9ucyA9IHt9KSB7XG4gIGlmIChwbHVnaW4uc2V0dGluZ3Muc2VwYXJhdGVTdWJ0eXBQaWNrZXIpIHtcbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgY29uc3QgZW50cnkgPSBhd2FpdCBwaWNrVHlwRW50cnkoYXBwLCBwbHVnaW4sIHsgLi4ub3B0aW9ucywgc2hvd1N1YnR5cHM6IHRydWUgfSk7XG4gICAgICBpZiAoIWVudHJ5KSByZXR1cm4gbnVsbDtcbiAgICAgIGNvbnN0IHN1YnR5cCA9IGF3YWl0IHBpY2tTdWJ0eXAoYXBwLCBwbHVnaW4sIGVudHJ5LnR5cCwgZW50cnkucXVlcnksIG9wdGlvbnMpO1xuICAgICAgaWYgKHN1YnR5cCAhPT0gbnVsbCkgcmV0dXJuIHsgdHlwOiBlbnRyeS50eXAsIHN1YnR5cDogc3VidHlwIHx8IG51bGwgfTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBpdGVtcyA9IHR5cEl0ZW1zKGFwcCwgcGx1Z2luLCBvcHRpb25zKTtcbiAgaWYgKCFpdGVtcykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGdyb3VwcyA9IGl0ZW1zLm1hcCgoaXRlbSkgPT4gKHtcbiAgICBpdGVtLFxuICAgIHN1YnR5cHM6IHBsdWdpbi5nZXRTdWJ0eXBzKGl0ZW0udHlwLCBvcHRpb25zKS5tYXAoKHsgc3VidHlwLCBjb3VudCB9KSA9PiAoeyB0eXA6IGl0ZW0udHlwLCBzdWJ0eXAsIGNvdW50IH0pKSxcbiAgfSkpO1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IG5ldyBUeXBTdWJ0eXBQaWNrZXJNb2RhbChhcHAsIHBsdWdpbiwgZ3JvdXBzLCByZXNvbHZlKS5vcGVuKCkpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcGlja1R5cCwgcGlja1N1YnR5cCwgcGlja1R5cEFuZFN1YnR5cCB9O1xuIiwgImNvbnN0IHsgVEZpbGUsIFZhdWx0LCBkZWJvdW5jZSwgbm9ybWFsaXplUGF0aCB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuXG4vLyBPbmx5IFRlbXBsYXRlciBzY3JpcHRzIHdpdGggdGhpcyBtYXJrZXIgaW4gYSBjb21tZW50IGFyZSBvZmZlcmVkIGluIHRoZVxuLy8gc2hvcnRjdXQgcGlja2VyOyBoZWxwZXIgc2NyaXB0cyBtYWtlIG5vIHNlbnNlIGFzIHNob3J0Y3V0cy4gVGhlIHRleHQgYWZ0ZXJcbi8vIHRoZSBtYXJrZXIgdXAgdG8gdGhlIGxpbmUgZW5kIGlzIHRoZSBkZXNjcmlwdGlvbiAoYSBjbG9zaW5nIFwiKi9cIiBpcyBub3Rcbi8vIHBhcnQgb2YgaXQpLlxuLy9cbi8vIEFuIG9wdGlvbmFsIHBhcmFtZXRlciBsaXN0IGluIHBhcmVudGhlc2VzIHJpZ2h0IGFmdGVyIHRoZSBtYXJrZXIgZGVzY3JpYmVzXG4vLyB0aGUgQ09NUExFVEUgYXJndW1lbnQgbGlzdCBhZnRlciBcInRwXCIsIGluY2x1ZGluZyB3aGVyZSB0aGUgc2NyaXB0IHdhbnRzIHRoZVxuLy8gZmlsZSBvciBjb250ZXh0IChzZWUgUkVTRVJWRURfUEFSQU1TIGluIHNob3J0Y3V0cy5qcyk6XG4vLyAgIC8vIEB0eXAtc2hvcnRjdXQoZm9sZGVyLCB5ZWFyKSAgICAgIC0+IGYodHAsIFwiTGl0ZXJhdHVyXCIsIDIwMjQpXG4vLyAgIC8vIEB0eXAtc2hvcnRjdXQobmV3RmlsZSwgeWVhcikgICAgIC0+IGYodHAsIG5ld0ZpbGUsIDIwMjQpXG4vLyAgIC8vIEB0eXAtc2hvcnRjdXQocHJvcGVydHkpICAgICAgICAgIC0+IGYodHAsIFwiRmFtaWxpZVwiKVxuLy8gICAvLyBAdHlwLXNob3J0Y3V0ICAgICAgICAgICAgICAgICAgICAtPiBmKHRwLCBuZXdGaWxlLCBjdHgpXG4vLyBObyBwYXJlbnRoZXNlcyAocGFyYW1zID09PSBudWxsKSBpcyB0aGUgY2xhc3NpYyBjYWxsIGYodHAsIG5ld0ZpbGUsIGN0eCk7XG4vLyBlbXB0eSBwYXJlbnRoZXNlcyAocGFyYW1zID09PSBbXSkgcGFzcyBvbmx5IHRwLlxuLy9cbi8vIFRoZSBtYXJrZXIgbXVzdCBzdGFydCB0aGUgY29tbWVudC4gQWxsb3dpbmcgdGV4dCBiZWZvcmUgaXQgb25jZSB0dXJuZWRcbi8vIFRZUC5qcyBpbnRvIGEgc2hvcnRjdXQsIGp1c3QgYmVjYXVzZSBpdHMgaGVhZGVyIGNvbW1lbnQgbWVudGlvbnMgdGhlIG1hcmtlci5cbi8vIFwiXFxiXCIgYWZ0ZXIgdGhlIG5hbWUgcmVqZWN0cyBcIkB0eXAtc2hvcnRjdXRYWVpcIiBidXQgYWxsb3dzIHRoZSBcIihcIi5cbmNvbnN0IFNIT1JUQ1VUX01BUktFUiA9IC9eWyBcXHRdKig/OlxcL1xcLyt8XFwvXFwqK3xcXCopWyBcXHRdKkB0eXAtc2hvcnRjdXRcXGIoPzpcXCgoW14pXSopXFwpKT9bIFxcdF0qKC4qPylbIFxcdF0qKD86XFwqXFwvKT9bIFxcdF0qJC9tO1xuXG4vLyBQYXJhbWV0ZXIgbmFtZXMgZnJvbSB0aGUgbWFya2VyLCBpbiBkZWNsYXJlZCBvcmRlci4gRW1wdHkgZW50cmllcyAoXCIoKVwiLCBhXG4vLyBzdHJheSBjb21tYSkgYXJlIGRyb3BwZWQsIGR1cGxpY2F0ZXMga2VwdCBvbmNlIC0gdHdvIGZpZWxkcyB3cml0aW5nIHRoZSBzYW1lXG4vLyBlbnRyeSB3b3VsZCBvbmx5IGNvbmZ1c2UuXG5mdW5jdGlvbiBwYXJzZVBhcmFtcyhyYXcpIHtcbiAgY29uc3QgbmFtZXMgPSAocmF3ID8/IFwiXCIpXG4gICAgLnNwbGl0KFwiLFwiKVxuICAgIC5tYXAoKG5hbWUpID0+IG5hbWUudHJpbSgpKVxuICAgIC5maWx0ZXIoKG5hbWUpID0+IG5hbWUgIT09IFwiXCIpO1xuICByZXR1cm4gWy4uLm5ldyBTZXQobmFtZXMpXTtcbn1cblxuLy8gS2VlcHMgdGhlIGxpc3Qgb2YgbWFya2VkIFRlbXBsYXRlciBzY3JpcHRzIGN1cnJlbnQuIEl0IGlzIHJlYWQgYWhlYWQgb2YgdGltZVxuLy8gYW5kIHVwZGF0ZWQgb24gY2hhbmdlcywgc28gdGhlIHBpY2tlciBvcGVucyB3aXRob3V0IHdhaXRpbmcgYW5kIHdpdGhvdXQgZmlsZVxuLy8gYWNjZXNzLiBSZXR1cm5zIGFuIGFjY2Vzc29yIGZvciB0aGUgbGlzdCAoW3sgbmFtZSwgcGFyYW1zLCBkZXNjcmlwdGlvbiB9XSxcbi8vIHNvcnRlZCBieSBuYW1lKS5cbmZ1bmN0aW9uIHJlZ2lzdGVyU2hvcnRjdXRTY3JpcHRzKHBsdWdpbikge1xuICBjb25zdCB7IGFwcCB9ID0gcGx1Z2luO1xuXG4gIGxldCBzY3JpcHRGb2xkZXIgPSBudWxsO1xuICBsZXQgc2NyaXB0cyA9IFtdO1xuXG4gIGNvbnN0IGN1cnJlbnRTY3JpcHRGb2xkZXIgPSAoKSA9PiB7XG4gICAgY29uc3QgZm9sZGVyID0gYXBwLnBsdWdpbnMucGx1Z2luc1tcInRlbXBsYXRlci1vYnNpZGlhblwiXT8uc2V0dGluZ3M/LnVzZXJfc2NyaXB0c19mb2xkZXI7XG4gICAgcmV0dXJuIGZvbGRlciA/IG5vcm1hbGl6ZVBhdGgoZm9sZGVyKSA6IG51bGw7XG4gIH07XG5cbiAgY29uc3QgaXNJblNjcmlwdEZvbGRlciA9IChwYXRoKSA9PiAhIXNjcmlwdEZvbGRlciAmJiAhIXBhdGggJiYgcGF0aC5zdGFydHNXaXRoKHNjcmlwdEZvbGRlciArIFwiL1wiKTtcblxuICAvLyBMaWtlIFRlbXBsYXRlcjogZXZlcnkgLmpzIGluIHRoZSBzY3JpcHQgZm9sZGVyIGluY2x1ZGluZyBzdWJmb2xkZXJzLFxuICAvLyBzY3JpcHQgbmFtZSA9IGZpbGUgbmFtZSB3aXRob3V0IGV4dGVuc2lvbi5cbiAgYXN5bmMgZnVuY3Rpb24gcmVmcmVzaFNjcmlwdHMoKSB7XG4gICAgY29uc3QgZm9sZGVyUGF0aCA9IGN1cnJlbnRTY3JpcHRGb2xkZXIoKTtcbiAgICBzY3JpcHRGb2xkZXIgPSBmb2xkZXJQYXRoO1xuICAgIGNvbnN0IGZvbGRlciA9IGZvbGRlclBhdGggPyBhcHAudmF1bHQuZ2V0Rm9sZGVyQnlQYXRoKGZvbGRlclBhdGgpIDogbnVsbDtcbiAgICBjb25zdCBmaWxlcyA9IFtdO1xuICAgIGlmIChmb2xkZXIpIHtcbiAgICAgIFZhdWx0LnJlY3Vyc2VDaGlsZHJlbihmb2xkZXIsIChjaGlsZCkgPT4ge1xuICAgICAgICBpZiAoY2hpbGQgaW5zdGFuY2VvZiBURmlsZSAmJiBjaGlsZC5leHRlbnNpb24gPT09IFwianNcIikgZmlsZXMucHVzaChjaGlsZCk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgY29uc3QgZm91bmQgPSBbXTtcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG1hdGNoID0gKGF3YWl0IGFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpKS5tYXRjaChTSE9SVENVVF9NQVJLRVIpO1xuICAgICAgICAvLyBtYXRjaFsxXSBpcyB1bmRlZmluZWQgd2l0aG91dCBwYXJlbnRoZXNlcyBhbmQgXCJcIiB3aXRoIGVtcHR5IG9uZXM7XG4gICAgICAgIC8vIHRoYXQgZGlmZmVyZW5jZSBkZWNpZGVzIHRoZSBjYWxsIGZvcm0uXG4gICAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICAgIGZvdW5kLnB1c2goe1xuICAgICAgICAgICAgbmFtZTogZmlsZS5iYXNlbmFtZSxcbiAgICAgICAgICAgIHBhcmFtczogbWF0Y2hbMV0gPT09IHVuZGVmaW5lZCA/IG51bGwgOiBwYXJzZVBhcmFtcyhtYXRjaFsxXSksXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogbWF0Y2hbMl0gPz8gXCJcIixcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLmVycm9yKGBUWVAtU3lzdGVtOiBjYW4ndCByZWFkIFRlbXBsYXRlciBzY3JpcHQgJHtmaWxlLnBhdGh9YCwgZSk7XG4gICAgICB9XG4gICAgfVxuICAgIC8vIEZvbGRlciBjaGFuZ2VkIGluIFRlbXBsYXRlciBtZWFud2hpbGU6IGRyb3AgdGhpcyByZXN1bHQsIHRoZSBydW4gZm9yIHRoZVxuICAgIC8vIG5ldyBmb2xkZXIgaXMgYWxyZWFkeSBzY2hlZHVsZWQuXG4gICAgaWYgKGZvbGRlclBhdGggIT09IHNjcmlwdEZvbGRlcikgcmV0dXJuO1xuICAgIHNjcmlwdHMgPSBmb3VuZC5zb3J0KChhLCBiKSA9PiBhLm5hbWUubG9jYWxlQ29tcGFyZShiLm5hbWUpKTtcbiAgfVxuXG4gIGNvbnN0IHNjaGVkdWxlUmVmcmVzaCA9IGRlYm91bmNlKHJlZnJlc2hTY3JpcHRzLCAzMDAsIHRydWUpO1xuICBjb25zdCBvbkZpbGVDaGFuZ2UgPSAoZmlsZSwgb2xkUGF0aCkgPT4ge1xuICAgIGlmIChpc0luU2NyaXB0Rm9sZGVyKGZpbGU/LnBhdGgpIHx8IGlzSW5TY3JpcHRGb2xkZXIob2xkUGF0aCkpIHNjaGVkdWxlUmVmcmVzaCgpO1xuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJjcmVhdGVcIiwgb25GaWxlQ2hhbmdlKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC52YXVsdC5vbihcIm1vZGlmeVwiLCBvbkZpbGVDaGFuZ2UpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoYXBwLnZhdWx0Lm9uKFwiZGVsZXRlXCIsIG9uRmlsZUNoYW5nZSkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJyZW5hbWVcIiwgb25GaWxlQ2hhbmdlKSk7XG4gIGFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeShyZWZyZXNoU2NyaXB0cyk7XG5cbiAgcmV0dXJuICgpID0+IHtcbiAgICAvLyBUZW1wbGF0ZXIgZm9sZGVyIGNoYW5nZWQ6IHJlbG9hZCBmb3IgdGhlIG5leHQgY2FsbCwgYW5zd2VyIHdpdGggdGhlXG4gICAgLy8gY3VycmVudCBsaXN0IGZvciBub3cuXG4gICAgaWYgKGN1cnJlbnRTY3JpcHRGb2xkZXIoKSAhPT0gc2NyaXB0Rm9sZGVyKSBzY2hlZHVsZVJlZnJlc2goKTtcbiAgICByZXR1cm4gc2NyaXB0cztcbiAgfTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyU2hvcnRjdXRTY3JpcHRzLCBTSE9SVENVVF9NQVJLRVIsIHBhcnNlUGFyYW1zIH07XG4iLCAiY29uc3QgeyBQbHVnaW4gfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgREVGQVVMVF9TRVRUSU5HUywgVHlwU3lzdGVtU2V0dGluZ1RhYiB9ID0gcmVxdWlyZShcIi4vc2V0dGluZ3NcIik7XG5jb25zdCB7IHJlZ2lzdGVyQ29tbWFuZHMgfSA9IHJlcXVpcmUoXCIuL2NvbW1hbmRzXCIpO1xuY29uc3QgeyByZWdpc3RlclR5cFBhbmUsIHNvcnRUeXBzQnlNb2RlLCBERUZBVUxUX1NPUlRfT1JERVIgfSA9IHJlcXVpcmUoXCIuL3R5cC1wYW5lXCIpO1xuY29uc3QgeyBUeXBJbmRleCwgc2V0Q2Fub25pY2FsUHJvcGVydHksIGRlbGV0ZVByb3BlcnR5LCBUWVBfUFJPUEVSVFksIFNVQlRZUF9QUk9QRVJUWSB9ID0gcmVxdWlyZShcIi4vdHlwLWluZGV4XCIpO1xuY29uc3QgeyBnZXRTdWJ0eXAsIGdldFN1YnR5cE5hbWVzLCBpc1N1YnR5cE1hbnVhbCB9ID0gcmVxdWlyZShcIi4vc3VidHlwc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJGaWxlRXhwbG9yZXJDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL2ZpbGUtZXhwbG9yZXItY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlckdyYXBoQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9ncmFwaC1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyU2VhcmNoQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9zZWFyY2gtY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlclJlY2VudEZpbGVzQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9yZWNlbnQtZmlsZXMtY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlckJhY2tsaW5rQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9iYWNrbGluay1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyQm9va21hcmtzQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9ib29rbWFyay1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL2FjdGl2ZS10aXRsZS1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyTGlua0NvbG9ycyB9ID0gcmVxdWlyZShcIi4vbGluay1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyRnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0IH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1kZWZhdWx0LWhpZ2hsaWdodFwiKTtcbmNvbnN0IHsgcmVnaXN0ZXJQcm9wZXJ0eVJlbmFtZVN5bmMgfSA9IHJlcXVpcmUoXCIuL3Byb3BlcnR5LXJlbmFtZS1zeW5jXCIpO1xuY29uc3QgeyByZW1vdmVQcm9wZXJ0eU1lbnVQYXRjaCB9ID0gcmVxdWlyZShcIi4vdHlwLWZyb250bWF0dGVyLWVkaXRvclwiKTtcbmNvbnN0IHsgbm9ybWFsaXplR2xvYmFsT3JkZXIsIHNvcnRGcm9udG1hdHRlckZvciwgcGxhY2VQcm9wZXJ0eUZvciB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItc29ydFwiKTtcbmNvbnN0IHsgcmVzb2x2ZVNob3J0Y3V0cywgc2NyaXB0TmFtZU9mLCByZXNvbHZlQ2FsbEFyZ3MgfSA9IHJlcXVpcmUoXCIuL3Nob3J0Y3V0c1wiKTtcbmNvbnN0IHtcbiAgcGlja1R5cDogcGlja1R5cE1vZGFsLFxuICBwaWNrU3VidHlwOiBwaWNrU3VidHlwTW9kYWwsXG4gIHBpY2tUeXBBbmRTdWJ0eXA6IHBpY2tUeXBBbmRTdWJ0eXBNb2RhbCxcbn0gPSByZXF1aXJlKFwiLi90eXAtcGlja2VyXCIpO1xuY29uc3QgeyByZWdpc3RlclNob3J0Y3V0U2NyaXB0cyB9ID0gcmVxdWlyZShcIi4vc2hvcnRjdXQtc2NyaXB0c1wiKTtcbmNvbnN0IHsgY2xlYXJJbmxpbmVDb2xvcnMsIGFsbERvY3VtZW50cyB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxubW9kdWxlLmV4cG9ydHMgPSBjbGFzcyBUeXBTeXN0ZW1QbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBhc3luYyBvbmxvYWQoKSB7XG4gICAgLy8gUmVhZCBvbmNlIGhlcmU6IG5vIGRhdGEuanNvbiAobG9hZERhdGEoKSByZXNvbHZlcyBudWxsKSBtZWFucyB0aGUgcGx1Z2luXG4gICAgLy8gaXMgbG9hZGVkIGZvciB0aGUgdmVyeSBmaXJzdCB0aW1lIGluIHRoaXMgdmF1bHQsIGFuZCB0aGUgVFlQLVBhbmUgb3BlbnNcbiAgICAvLyBvbiBpdHMgb3duIG9uY2UgKHNlZSByZWdpc3RlclR5cFBhbmUpLlxuICAgIGNvbnN0IGRhdGEgPSBhd2FpdCB0aGlzLmxvYWREYXRhKCk7XG4gICAgdGhpcy5pc0ZpcnN0UnVuID0gZGF0YSA9PSBudWxsO1xuICAgIGF3YWl0IHRoaXMubG9hZFNldHRpbmdzKGRhdGEpO1xuXG4gICAgLy8gRGlzYWJsaW5nIHRoZSBwbHVnaW4gdGFrZXMgaXRzIGlubGluZSBjb2xvcnMgb3V0IG9mIHRoZSBleHBsb3JlcixcbiAgICAvLyBzZWFyY2gsIFJlY2VudCBGaWxlcywgYmFja2xpbmtzLCBib29rbWFya3MsIG5vdGUgdGl0bGVzIGFuZCBcIkFsbFxuICAgIC8vIHByb3BlcnRpZXNcIiAoc2VlIHNldElubGluZUNvbG9yIGluIHR5cC1jb2xvcnMuanMpOyB0aG9zZSB2aWV3cyB3b3VsZFxuICAgIC8vIGtlZXAgdGhlbSB1bnRpbCB0aGV5IGhhcHBlbiB0byByZS1yZW5kZXIuIFJlZ2lzdGVyZWQgZmlyc3Qgc28gaXQgcnVuc1xuICAgIC8vIGxhc3Qgb24gdW5sb2FkLCBhZnRlciB0aGUgbW9kdWxlcyBoYXZlIHN0b3BwZWQgb2JzZXJ2aW5nIGFuZCBsaXN0ZW5pbmcuXG4gICAgdGhpcy5yZWdpc3RlcigoKSA9PiB7XG4gICAgICBmb3IgKGNvbnN0IGRvYyBvZiBhbGxEb2N1bWVudHModGhpcy5hcHApKSBjbGVhcklubGluZUNvbG9ycyhkb2MpO1xuICAgIH0pO1xuXG4gICAgLy8gQmVmb3JlIGFsbCBvdGhlciBtb2R1bGVzOiB0aGV5IGxpc3RlbiB0byBpdHMgXCJjaGFuZ2VcIiBldmVudCBhbmQgcmVhZFxuICAgIC8vIFRZUC9TVUJUWVAgb25seSB0aHJvdWdoIGl0IChzZWUgdHlwLWluZGV4LmpzKS5cbiAgICB0aGlzLnR5cEluZGV4ID0gbmV3IFR5cEluZGV4KHRoaXMpO1xuICAgIHRoaXMudHlwSW5kZXgucmVnaXN0ZXIoKTtcblxuICAgIHJlZ2lzdGVyQ29tbWFuZHModGhpcyk7XG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBUeXBTeXN0ZW1TZXR0aW5nVGFiKHRoaXMuYXBwLCB0aGlzKSk7XG4gICAgLy8gQ2FycmllcyByZW5hbWVzIGZyb20gXCJBbGwgcHJvcGVydGllc1wiL0Jhc2VzIGludG8gdGhlIFRZUC1Gcm9udG1hdHRlci5cbiAgICByZWdpc3RlclByb3BlcnR5UmVuYW1lU3luYyh0aGlzKTtcbiAgICAvLyBUaGUgVFlQLVBhbmUgcGF0Y2hlcyB0aGUgcHJvcGVydHkgbWVudSBsYXppbHkgKGVuc3VyZVByb3BlcnR5TWVudVBhdGNoKS5cbiAgICB0aGlzLnJlZ2lzdGVyKHJlbW92ZVByb3BlcnR5TWVudVBhdGNoKTtcbiAgICAvLyBBY2Nlc3NvciBmb3IgdGhlIFRlbXBsYXRlciBzY3JpcHRzIG1hcmtlZCBcIkB0eXAtc2hvcnRjdXRcIiwgdXNlZCBieSB0aGVcbiAgICAvLyBzaG9ydGN1dCBwaWNrZXIgb2YgdGhlIHByb3BlcnR5IHJvd3MuXG4gICAgdGhpcy5nZXRTaG9ydGN1dFNjcmlwdHMgPSByZWdpc3RlclNob3J0Y3V0U2NyaXB0cyh0aGlzKTtcblxuICAgIC8vIEtlcHQgc2VwYXJhdGUgZnJvbSByZWZyZXNoRm5zOiBhZnRlciBtb3VudGluZyBpdHMgZWRpdG9ycyB0aGUgVFlQLVBhbmVcbiAgICAvLyBuZWVkcyBvbmx5IHRoaXMgcmVmcmVzaCAoYm9sZCBwcm9wZXJ0eSBuYW1lcykuIFRoZSB3aG9sZVxuICAgIC8vIHJlZnJlc2hUeXBDb2xvcnMoKSBidW5kbGUgd291bGQgYWxzbyB0cmlnZ2VyIHRoZSB2aWV3J3Mgb3duIHJlLXJlbmRlciBhbmRcbiAgICAvLyByZWN1cnNlIGludG8gYSBzdGFjayBvdmVyZmxvdyBvbiBldmVyeSBUWVAgb3BlbmVkLlxuICAgIHRoaXMucmVmcmVzaEZyb250bWF0dGVySGlnaGxpZ2h0ID0gcmVnaXN0ZXJGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQodGhpcyk7XG5cbiAgICAvLyBUd28gdmFyaWFudHMsIGxpa2UgcmVmcmVzaEZyb250bWF0dGVySGlnaGxpZ2h0IGFib3ZlOlxuICAgIC8vICAtIHJlZnJlc2hUeXBDb2xvcnMoKSByZWZyZXNoZXMgZXZlcnkgdmlldywgdGhlIFRZUC1QYW5lIGluY2x1ZGVkXG4gICAgLy8gICAgKHJlLXJlbmRlcmVkIGZyb20gdGhlIHNldHRpbmdzKSAtIGZvciBjaGFuZ2VzIG1hZGUgZWxzZXdoZXJlIChzZXR0aW5nc1xuICAgIC8vICAgIHRhYiwgcHJvcGVydHkgcmVuYW1lIHN5bmMsIFN5bmMsIFVuZG8pLlxuICAgIC8vICAtIHJlZnJlc2hUeXBDb2xvcnNFeGNlcHQodmlldykgbGVhdmVzIHRoYXQgb25lIFRZUC1QYW5lIG91dCAtIGZvciBpdHNcbiAgICAvLyAgICBvd24gYWN0aW9ucy4gQSBmdWxsIHJlLXJlbmRlciB0aGVyZSB3b3VsZCB0aHJvdyBhd2F5IGZvY3VzLCBhbiBvcGVuXG4gICAgLy8gICAgaW5saW5lIGlucHV0IG9yIHRoZSBlZGl0b3IgYmVpbmcgdHlwZWQgaW4sIHNvIHRoZSBwYW5lIHVwZGF0ZXMgaXRzZWxmXG4gICAgLy8gICAgYW5kIGNhbGxzIHJlbmRlcigpIG9ubHkgd2hlcmUgaXQgcmVhbGx5IGhhcyB0byByZWJ1aWxkLiBPdGhlclxuICAgIC8vICAgIFRZUC1QYW5lIGxlYXZlcyAocmFyZSAtIHNlZSBhY3RpdmF0ZVR5cFBhbmUpIGFyZSBzdGlsbCByZS1yZW5kZXJlZC5cbiAgICBjb25zdCByZWZyZXNoVHlwUGFuZSA9IHJlZ2lzdGVyVHlwUGFuZSh0aGlzKTtcbiAgICBjb25zdCByZWZyZXNoRm5zID0gW1xuICAgICAgcmVnaXN0ZXJGaWxlRXhwbG9yZXJDb2xvcnModGhpcyksXG4gICAgICByZWdpc3RlckdyYXBoQ29sb3JzKHRoaXMpLFxuICAgICAgcmVnaXN0ZXJTZWFyY2hDb2xvcnModGhpcyksXG4gICAgICByZWdpc3RlclJlY2VudEZpbGVzQ29sb3JzKHRoaXMpLFxuICAgICAgcmVnaXN0ZXJCYWNrbGlua0NvbG9ycyh0aGlzKSxcbiAgICAgIHJlZ2lzdGVyQm9va21hcmtzQ29sb3JzKHRoaXMpLFxuICAgICAgcmVnaXN0ZXJBY3RpdmVUaXRsZUNvbG9ycyh0aGlzKSxcbiAgICAgIHJlZ2lzdGVyTGlua0NvbG9ycyh0aGlzKSxcbiAgICAgIHRoaXMucmVmcmVzaEZyb250bWF0dGVySGlnaGxpZ2h0LFxuICAgIF07XG4gICAgdGhpcy5yZWZyZXNoVHlwQ29sb3JzRXhjZXB0ID0gKGV4Y2VwdFZpZXcpID0+IHtcbiAgICAgIHJlZnJlc2hUeXBQYW5lKGV4Y2VwdFZpZXcpO1xuICAgICAgcmVmcmVzaEZucy5mb3JFYWNoKChmbikgPT4gZm4oKSk7XG4gICAgfTtcbiAgICB0aGlzLnJlZnJlc2hUeXBDb2xvcnMgPSAoKSA9PiB0aGlzLnJlZnJlc2hUeXBDb2xvcnNFeGNlcHQobnVsbCk7XG5cbiAgICAvLyBTdHlsZSBTZXR0aW5ncyByZWFkcyBzdHlsZXNoZWV0cyB3aGVuIGl0IGxvYWRzIGFuZCBhZnRlcndhcmRzIG9ubHkgb25cbiAgICAvLyBcImNzcy1jaGFuZ2VcIiwgd2hpY2ggZmlyZXMgZm9yIHRoZW1lcyBhbmQgc25pcHBldHMgYnV0IG5vdCBmb3IgYSBwbHVnaW4nc1xuICAgIC8vIHN0eWxlcy5jc3MuIEEgcGx1Z2luIGxvYWRlZCBsYXRlciAob3IgaG90LXJlbG9hZGVkKSB3b3VsZCBiZSBtaXNzaW5nXG4gICAgLy8gdGhlcmU7IFwicGFyc2Utc3R5bGUtc2V0dGluZ3NcIiBpcyB0aGUgaW50ZW5kZWQgaG9vay4gV2l0aG91dCBTdHlsZVxuICAgIC8vIFNldHRpbmdzIG5vYm9keSBsaXN0ZW5zIGFuZCBub3RoaW5nIGhhcHBlbnMuXG4gICAgLy9cbiAgICAvLyBOZXh0IHRpY2ssIGJlY2F1c2UgT2JzaWRpYW4gYWRkcyBhIHBsdWdpbidzIHN0eWxlcy5jc3Mgb25seSBBRlRFUlxuICAgIC8vIG9ubG9hZCgpLiBvbkxheW91dFJlYWR5IGRvZXNuJ3QgaGVscDogb24gaG90IHJlbG9hZCB0aGUgbGF5b3V0IGlzIGxvbmdcbiAgICAvLyByZWFkeSBhbmQgdGhlIGNhbGxiYWNrIHdvdWxkIHJ1biBhdCBvbmNlLCBqdXN0IGFzIGVhcmx5LlxuICAgIGNvbnN0IHBhcnNlU3R5bGVTZXR0aW5ncyA9IHdpbmRvdy5zZXRUaW1lb3V0KCgpID0+IHRoaXMuYXBwLndvcmtzcGFjZS50cmlnZ2VyKFwicGFyc2Utc3R5bGUtc2V0dGluZ3NcIiksIDApO1xuICAgIHRoaXMucmVnaXN0ZXIoKCkgPT4gd2luZG93LmNsZWFyVGltZW91dChwYXJzZVN0eWxlU2V0dGluZ3MpKTtcbiAgfVxuXG4gIG9udW5sb2FkKCkge31cblxuICAvLyBGb3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qczogdGhlIFRZUC1Gcm9udG1hdHRlciBvZiBhIFRZUCwgc29cbiAgLy8gVGVtcGxhdGVyIGNhbiBhcHBseSBpdCB0byBhIG5ldyBub3RlIGluc3RlYWQgb2Yga2VlcGluZyBhIHNlY29uZCBjb3B5LiBBXG4gIC8vIGNvcHksIHNvIGNhbGxlcnMgbWF5IGNoYW5nZSBpdCBmcmVlbHkuXG4gIC8vXG4gIC8vIFByb3BlcnRpZXMgd2l0aCBhIGZpeGVkIHNob3J0Y3V0ICh0b2RheS9ub3cvY3JlYXRlZCwgc2VlIHNob3J0Y3V0cy5qcylcbiAgLy8gY2FycnkgaXRzIHZhbHVlLCBjb21wdXRlZCBmcmVzaCBvbiBlYWNoIGNhbGwuIFByb3BlcnRpZXMgd2l0aCBhIHNjcmlwdFxuICAvLyBzaG9ydGN1dCBjYXJyeSBudWxsOiBvbmx5IFRlbXBsYXRlciBjYW4gcmVzb2x2ZSB0aGVtLCBUWVAuanMgZ2V0cyB0aGVtIHZpYVxuICAvLyBnZXRUeXBTaG9ydGN1dHMoKSBhbmQgZmlsbHMgdGhlbSBpbi4gS2V5IGFuZCBwb3NpdGlvbiBzdGF5IGVpdGhlciB3YXkuXG4gIC8vXG4gIC8vIGluY2x1ZGVGbG9hdGluZyAoZGVmYXVsdCBmYWxzZSkga2VlcHMgZmxvYXRpbmcga2V5cyBpbiB0aGUgcmVzdWx0OyB0aGV5XG4gIC8vIGFyZSBub3QgY3JlYXRlZCBmb3IgZXZlcnkgbmV3IG5vdGUsIG9ubHkgd2hlbiBhIHNjcmlwdCBhc2tzIGZvciB0aGVtLlxuICAvL1xuICAvLyBmaWxlIChvcHRpb25hbCkgZ29lcyB0byByZXNvbHZlU2hvcnRjdXRzKCkgZm9yIFwiY3JlYXRlZFwiLCB3aGljaCByZXR1cm5zXG4gIC8vIHRoZSBmaWxlJ3MgY3JlYXRpb24gZGF0ZSBpbnN0ZWFkIG9mIHRoZSBjYWxsIHRpbWUuXG4gIC8vXG4gIC8vIHN1YnR5cCAob3B0aW9uYWwpIGFwcGVuZHMgdGhhdCBTdWJ0eXAncyBibG9jay4gQSBrZXkgaW4gQk9USCBibG9ja3Mga2VlcHNcbiAgLy8gdGhlIFRZUC1Gcm9udG1hdHRlciBwb3NpdGlvbiwgYnV0IHZhbHVlLCBmbG9hdGluZyBmbGFnIGFuZCBzaG9ydGN1dCBjb21lXG4gIC8vIGZyb20gdGhlIFN1YnR5cC4gRnJvbnRtYXR0ZXIgc29ydGluZyBtdXN0IHVzZSB0aGUgc2FtZSBydWxlIChzZWVcbiAgLy8gb3JkZXJlZERlZmF1bHRLZXlzIGluIGZyb250bWF0dGVyLXNvcnQuanMpLCBvciBpdCB3b3VsZCByZS1zb3J0IGEgbmV3IG5vdGVcbiAgLy8gcmlnaHQgYXdheS5cbiAgZ2V0VHlwRGVmYXVsdHModHlwLCB7IGluY2x1ZGVGbG9hdGluZyA9IGZhbHNlLCBmaWxlLCBzdWJ0eXAgPSBudWxsIH0gPSB7fSkge1xuICAgIGNvbnN0IHsgZGVmYXVsdHMsIHNob3J0Y3V0cyB9ID0gdGhpcy5jb2xsZWN0QmxvY2tzKHR5cCwgc3VidHlwLCBpbmNsdWRlRmxvYXRpbmcpO1xuICAgIHJldHVybiByZXNvbHZlU2hvcnRjdXRzKGRlZmF1bHRzLCBzaG9ydGN1dHMsIHsgZmlsZSwgYXBwOiB0aGlzLmFwcCB9KTtcbiAgfVxuXG4gIC8vIFNoYXJlZCBiYXNlIG9mIGdldFR5cERlZmF1bHRzKCkgYW5kIGdldFR5cFNob3J0Y3V0cygpOiB0aGUgVFlQLUZyb250bWF0dGVyXG4gIC8vIHBsdXMgdGhlIFN1YnR5cCdzIGJsb2NrLiBBIGtleSBpbiBCT1RIIGtlZXBzIHRoZSBUWVAtRnJvbnRtYXR0ZXIgcG9zaXRpb247XG4gIC8vIHZhbHVlLCBmbG9hdGluZyBmbGFnIEFORCBzaG9ydGN1dCBjb21lIGZyb20gdGhlIFN1YnR5cCAtIFwibm8gc2hvcnRjdXRcIlxuICAvLyBjb3VudHMgYXMgdGhlIFN1YnR5cCdzIGNob2ljZSB0b28gYW5kIGNhbmNlbHMgdGhlIFRZUCdzLlxuICBjb2xsZWN0QmxvY2tzKHR5cCwgc3VidHlwLCBpbmNsdWRlRmxvYXRpbmcpIHtcbiAgICBjb25zdCBkZWZhdWx0cyA9IHt9O1xuICAgIGNvbnN0IHNob3J0Y3V0cyA9IHt9O1xuICAgIGNvbnN0IGlzRmxvYXRpbmcgPSBuZXcgTWFwKCk7XG4gICAgY29uc3QgYWRkQmxvY2sgPSAoZnJvbnRtYXR0ZXIsIGZsb2F0aW5nS2V5cywgYmxvY2tTaG9ydGN1dHMpID0+IHtcbiAgICAgIGNvbnN0IGFjdHVhbEtleXMgPSBuZXcgTWFwKE9iamVjdC5rZXlzKGRlZmF1bHRzKS5tYXAoKGtleSkgPT4gW2tleS50b0xvd2VyQ2FzZSgpLCBrZXldKSk7XG4gICAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhmcm9udG1hdHRlciA/PyB7fSkpIHtcbiAgICAgICAgaWYgKGtleSA9PT0gXCJcIikgY29udGludWU7XG4gICAgICAgIGNvbnN0IHRhcmdldCA9IGFjdHVhbEtleXMuZ2V0KGtleS50b0xvd2VyQ2FzZSgpKSA/PyBrZXk7XG4gICAgICAgIGRlZmF1bHRzW3RhcmdldF0gPSB2YWx1ZTtcbiAgICAgICAgaXNGbG9hdGluZy5zZXQodGFyZ2V0LCAoZmxvYXRpbmdLZXlzID8/IFtdKS5pbmNsdWRlcyhrZXkpKTtcbiAgICAgICAgY29uc3QgcmVjb3JkID0gKGJsb2NrU2hvcnRjdXRzID8/IHt9KVtrZXldO1xuICAgICAgICBpZiAocmVjb3JkKSBzaG9ydGN1dHNbdGFyZ2V0XSA9IHJlY29yZDtcbiAgICAgICAgZWxzZSBkZWxldGUgc2hvcnRjdXRzW3RhcmdldF07XG4gICAgICB9XG4gICAgfTtcbiAgICBjb25zdCBzdWJ0eXBEYXRhID0gc3VidHlwID8gZ2V0U3VidHlwKHRoaXMuc2V0dGluZ3MsIHR5cCwgc3VidHlwKSA6IG51bGw7XG4gICAgYWRkQmxvY2soXG4gICAgICB0aGlzLnNldHRpbmdzLnR5cERlZmF1bHRGcm9udG1hdHRlclt0eXBdLFxuICAgICAgdGhpcy5zZXR0aW5ncy50eXBGbG9hdGluZ0tleXNbdHlwXSxcbiAgICAgIHRoaXMuc2V0dGluZ3MudHlwU2hvcnRjdXRzW3R5cF1cbiAgICApO1xuICAgIGlmIChzdWJ0eXBEYXRhKSBhZGRCbG9jayhzdWJ0eXBEYXRhLmZyb250bWF0dGVyLCBzdWJ0eXBEYXRhLmZsb2F0aW5nS2V5cywgc3VidHlwRGF0YS5zaG9ydGN1dHMpO1xuXG4gICAgaWYgKCFpbmNsdWRlRmxvYXRpbmcpIHtcbiAgICAgIGZvciAoY29uc3QgW2tleSwgZmxvYXRpbmddIG9mIGlzRmxvYXRpbmcpIHtcbiAgICAgICAgaWYgKCFmbG9hdGluZykgY29udGludWU7XG4gICAgICAgIGRlbGV0ZSBkZWZhdWx0c1trZXldO1xuICAgICAgICBkZWxldGUgc2hvcnRjdXRzW2tleV07XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB7IGRlZmF1bHRzLCBzaG9ydGN1dHMgfTtcbiAgfVxuXG4gIC8vIEZvciBUWVAuanM6IHRoZSBwcm9wZXJ0aWVzIG9mIHRoaXMgVFlQIHdob3NlIHZhbHVlIGNvbWVzIGZyb20gYSBUZW1wbGF0ZXJcbiAgLy8gc2NyaXB0LCBhcyB7IFtwcm9wZXJ0eV06IHsgbmFtZSwgcGFyYW1zLCBhcmdzLCBmYWxsYmFjayB9IH0gaW5cbiAgLy8gVFlQLUZyb250bWF0dGVyIG9yZGVyICh0aGUgc2NyaXB0cyBydW4gaW4gdHVybiBhbmQgc2VlIGVhcmxpZXIgcmVzdWx0cykuXG4gIC8vXG4gIC8vICAgbmFtZSAgICAgIHNjcmlwdCBuYW1lIHdpdGhvdXQgXCJ0cC5cIiwgaS5lLiB0cC51c2VyLjxuYW1lPlxuICAvLyAgIHBhcmFtcyAgICB0aGUgcGFyYW1ldGVyIGxpc3QgZGVjbGFyZWQgaW4gdGhlIEB0eXAtc2hvcnRjdXQgbWFya2VyLCBvclxuICAvLyAgICAgICAgICAgICBudWxsIHdpdGhvdXQgcGFyZW50aGVzZXMuIFRha2VuIGZyb20gdGhlIGN1cnJlbnQgc2Nhbiwgc28gYVxuICAvLyAgICAgICAgICAgICBjaGFuZ2VkIGRlY2xhcmF0aW9uIGFwcGxpZXMgYXQgb25jZS4gVFlQLmpzIHR1cm5zIGl0IGludG8gdGhlXG4gIC8vICAgICAgICAgICAgIGNhbGwncyBhcmd1bWVudHMgd2l0aCByZXNvbHZlU2hvcnRjdXRBcmdzKClcbiAgLy8gICBhcmdzICAgICAgdGhlIHR5cGVkIGFyZ3VtZW50cywgbmFtZWQgYWZ0ZXIgdGhlIG5vbi1yZXNlcnZlZCBwYXJhbWV0ZXJzO1xuICAvLyAgICAgICAgICAgICBhbiBlbXB0eSBmaWVsZCBpcyBtaXNzaW5nIHNvIFwiYXJncy54ID8/IGZhbGxiYWNrXCIgd29ya3NcbiAgLy8gICBmYWxsYmFjayAgdGhlIGZpeGVkIHZhbHVlIHN0b3JlZCBmb3IgdGhlIHByb3BlcnR5LiBPbmx5IGEgRkFMTEJBQ0s6XG4gIC8vICAgICAgICAgICAgIFRZUC5qcyB3cml0ZXMgaXQgaWYgdGhlIHNjcmlwdCBpcyBtaXNzaW5nIG9yIHRocm93cy4gQSBzY3JpcHRcbiAgLy8gICAgICAgICAgICAgdGhhdCBkZWxpYmVyYXRlbHkgcmV0dXJucyBudWxsL1wiXCIgKEVTQyBpbiBhIHBpY2tlcikgaGFzIG5vdFxuICAvLyAgICAgICAgICAgICBmYWlsZWQgLSB0aGUgcHJvcGVydHkgc3RheXMgZW1wdHkgdGhlbi5cbiAgLy9cbiAgLy8gRml4ZWQgc2hvcnRjdXRzICh0b2RheS9ub3cvY3JlYXRlZCkgZG9uJ3QgYXBwZWFyIGhlcmU7IGdldFR5cERlZmF1bHRzKClcbiAgLy8gYWxyZWFkeSByZXNvbHZlcyB0aGVtIGFuZCByZXR1cm5zIHRoZSBzY3JpcHQga2V5cyBhcyBudWxsLlxuICAvL1xuICAvLyBPcHRpb25zIGFzIGluIGdldFR5cERlZmF1bHRzKCk7IGluY2x1ZGVGbG9hdGluZyBkZWZhdWx0cyB0byBmYWxzZSBzbyBub1xuICAvLyBzY3JpcHQgcnVucyB1bmFza2VkIGZvciBhIGZsb2F0aW5nIHByb3BlcnR5LlxuICBnZXRUeXBTaG9ydGN1dHModHlwLCB7IGluY2x1ZGVGbG9hdGluZyA9IGZhbHNlLCBzdWJ0eXAgPSBudWxsIH0gPSB7fSkge1xuICAgIGNvbnN0IHsgZGVmYXVsdHMsIHNob3J0Y3V0cyB9ID0gdGhpcy5jb2xsZWN0QmxvY2tzKHR5cCwgc3VidHlwLCBpbmNsdWRlRmxvYXRpbmcpO1xuICAgIGNvbnN0IHNjcmlwdHMgPSB0aGlzLmdldFNob3J0Y3V0U2NyaXB0cz8uKCkgPz8gW107XG4gICAgY29uc3QgcmVzdWx0ID0ge307XG4gICAgZm9yIChjb25zdCBba2V5LCByZWNvcmRdIG9mIE9iamVjdC5lbnRyaWVzKHNob3J0Y3V0cykpIHtcbiAgICAgIGNvbnN0IG5hbWUgPSBzY3JpcHROYW1lT2YocmVjb3JkLm5hbWUpO1xuICAgICAgaWYgKG5hbWUgPT09IG51bGwpIGNvbnRpbnVlO1xuICAgICAgY29uc3Qgc2NyaXB0ID0gc2NyaXB0cy5maW5kKChzKSA9PiBzLm5hbWUgPT09IG5hbWUpO1xuICAgICAgcmVzdWx0W2tleV0gPSB7XG4gICAgICAgIG5hbWUsXG4gICAgICAgIHBhcmFtczogc2NyaXB0Py5wYXJhbXMgPz8gbnVsbCxcbiAgICAgICAgYXJnczogeyAuLi4ocmVjb3JkLmFyZ3MgPz8ge30pIH0sXG4gICAgICAgIGZhbGxiYWNrOiBkZWZhdWx0c1trZXldID8/IG51bGwsXG4gICAgICB9O1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgLy8gRm9yIFRZUC5qczogdHVybnMgYSBzaG9ydGN1dCdzIHBhcmFtZXRlciBsaXN0IGludG8gdGhlIGFyZ3VtZW50cyBvZlxuICAvLyB0cC51c2VyLjxuYW1lPih0cCwgLi4uKSAtIHNlZSByZXNvbHZlQ2FsbEFyZ3MgaW4gc2hvcnRjdXRzLmpzLiBMaXZlcyBoZXJlXG4gIC8vIHNvIHRoZSBydWxlcyAocmVzZXJ2ZWQgbmFtZXMsIGRvdHRlZCBuYW1lcykgZXhpc3QgaW4gb25lIHBsYWNlOyBvbmx5XG4gIC8vIFRZUC5qcyBrbm93cyBuZXdGaWxlIGFuZCBjdHgsIHNvIGl0IHBhc3NlcyB0aGVtIGluLlxuICByZXNvbHZlU2hvcnRjdXRBcmdzKHBhcmFtcywgYXJncywgeyBuZXdGaWxlID0gbnVsbCwgY3R4ID0gbnVsbCwga2V5ID0gbnVsbCB9ID0ge30pIHtcbiAgICByZXR1cm4gcmVzb2x2ZUNhbGxBcmdzKHBhcmFtcywgYXJncywgeyBuZXdGaWxlLCBjdHgsIGtleSB9KTtcbiAgfVxuXG4gIC8vIEZvciBUWVAuanM6IHJlZ2lzdGVyZWQgU3VidHlwcyBvZiBhIFRZUCBpbiBibG9jayBvcmRlciwgd2l0aCBub3RlIGNvdW50cy5cbiAgLy8gU3VidHlwcyB0aGF0IGFyZW4ndCBtYW51YWxseSBjcmVhdGFibGUgYXJlIGxlZnQgb3V0IHVubGVzc1xuICAvLyBpbmNsdWRlTWFudWFsT2ZmIGlzIHNldCwgbGlrZSBzdWNoIFRZUCBlbnRyaWVzIGluIGdldFR5cHMoKS5cbiAgZ2V0U3VidHlwcyh0eXAsIHsgaW5jbHVkZU1hbnVhbE9mZiA9IGZhbHNlIH0gPSB7fSkge1xuICAgIGNvbnN0IHsgY291bnRzIH0gPSB0aGlzLnR5cEluZGV4LnN1YnR5cEJ1Y2tldCh0eXApO1xuICAgIHJldHVybiBnZXRTdWJ0eXBOYW1lcyh0aGlzLnNldHRpbmdzLCB0eXApXG4gICAgICAuZmlsdGVyKChzdWJ0eXApID0+IGluY2x1ZGVNYW51YWxPZmYgfHwgaXNTdWJ0eXBNYW51YWwodGhpcy5zZXR0aW5ncywgdHlwLCBzdWJ0eXApKVxuICAgICAgLm1hcCgoc3VidHlwKSA9PiAoeyBzdWJ0eXAsIGNvdW50OiBjb3VudHMuZ2V0KHN1YnR5cCkgPz8gMCB9KSk7XG4gIH1cblxuICAvLyBGb3IgVFlQLmpzOiB0aGUgU3VidHlwLVBpY2tlciAoc2VlIHR5cC1waWNrZXIuanMpLiBSZXNvbHZlcyB3aXRoIHRoZVxuICAvLyBTdWJ0eXAsIFwiXCIgZm9yIFwibm8gU3VidHlwXCIgKG9yIHdpdGhvdXQgYSBwaWNrZXIgaWYgdGhlIFRZUCBoYXMgbm9uZSksIG9yXG4gIC8vIG51bGwgb24gRVNDIChUWVAuanMgdGhlbiBnb2VzIGJhY2sgdG8gdGhlIFRZUCBjaG9pY2UpLiBxdWVyeSAob3B0aW9uYWwpOlxuICAvLyBhbiBhbHJlYWR5IHR5cGVkIHNlYXJjaCB0aGF0IHByZS1zb3J0cyB0aGUgbGlzdC4gb3B0aW9ucyBhcyBpbiBnZXRTdWJ0eXBzLlxuICBwaWNrU3VidHlwKHR5cCwgcXVlcnkgPSBcIlwiLCBvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gcGlja1N1YnR5cE1vZGFsKHRoaXMuYXBwLCB0aGlzLCB0eXAsIHF1ZXJ5LCBvcHRpb25zKTtcbiAgfVxuXG4gIC8vIEZvciBUWVAuanMsIGluc2lkZSBwcm9jZXNzRnJvbnRNYXR0ZXI6IHNldHMgVFlQIGFuZCBTVUJUWVAgaW4gY2Fub25pY2FsXG4gIC8vIHNwZWxsaW5nIC0gYSB2YXJpYW50IGxpa2UgXCJ0eXBcIiBvciBcIlN1YnR5cFwiIGlzIHJlbmFtZWQgaW4gcGxhY2UgcmF0aGVyIHRoYW5cbiAgLy8gZHVwbGljYXRlZC4gc3VidHlwIG51bGwgcmVtb3ZlcyBhbiBleGlzdGluZyBTVUJUWVAuXG4gIGFwcGx5VHlwUHJvcGVydGllcyhmcm9udG1hdHRlciwgdHlwLCBzdWJ0eXApIHtcbiAgICBzZXRDYW5vbmljYWxQcm9wZXJ0eShmcm9udG1hdHRlciwgVFlQX1BST1BFUlRZLCB0eXApO1xuICAgIGlmIChzdWJ0eXApIHNldENhbm9uaWNhbFByb3BlcnR5KGZyb250bWF0dGVyLCBTVUJUWVBfUFJPUEVSVFksIHN1YnR5cCk7XG4gICAgZWxzZSBkZWxldGVQcm9wZXJ0eShmcm9udG1hdHRlciwgU1VCVFlQX1BST1BFUlRZKTtcbiAgfVxuXG4gIC8vIEZvciBUWVAuanMsIGluc2lkZSBwcm9jZXNzRnJvbnRNYXR0ZXIgYW5kIGFmdGVyIGFsbCBvdGhlciBjaGFuZ2VzOiBwdXRzIHRoZVxuICAvLyBmcm9udG1hdHRlciBpbnRvIHNvcnRpbmcgb3JkZXIsIG9yIG5ld2x5IGFkZGVkIHByb3BlcnRpZXMgKFNVQlRZUCBpbiBhblxuICAvLyBleGlzdGluZyBub3RlLCBzYXkpIHdvdWxkIGVuZCB1cCBsYXN0LlxuICBzb3J0RnJvbnRtYXR0ZXIoZnJvbnRtYXR0ZXIsIHR5cCwgc3VidHlwID0gbnVsbCkge1xuICAgIHJldHVybiBzb3J0RnJvbnRtYXR0ZXJGb3IodGhpcywgZnJvbnRtYXR0ZXIsIHR5cCwgc3VidHlwKTtcbiAgfVxuXG4gIC8vIEluc2lkZSBwcm9jZXNzRnJvbnRNYXR0ZXI6IG1vdmVzIG9ubHkgcHJvcGVydHkgYGtleWAgdG8gaXRzIHNvcnRlZCBwbGFjZVxuICAvLyAoVFlQL1NVQlRZUCByZWFkIGZyb20gdGhlIG9iamVjdCksIGV2ZXJ5dGhpbmcgZWxzZSBzdGF5cyAtIGZvciBGcmVkJ3NcbiAgLy8gcHJvcGVydHkgYmFja2xpbmtpbmcsIHNvIGEgbmV3IHByb3BlcnR5IGRvZXNuJ3QgZW5kIHVwIGxhc3QuXG4gIHBsYWNlUHJvcGVydHkoZnJvbnRtYXR0ZXIsIGtleSkge1xuICAgIHJldHVybiBwbGFjZVByb3BlcnR5Rm9yKHRoaXMsIGZyb250bWF0dGVyLCBrZXkpO1xuICB9XG5cbiAgLy8gRm9yIFRZUC5qczogdGhlIHJlZ2lzdGVyZWQgVFlQIGVudHJpZXMgd2l0aCB0aGVpciBkZXNjcmlwdGlvbnMsIGluIHRoZVxuICAvLyBvcmRlciBvZiB0aGUgVFlQLUxpc3QgKGl0cyBjdXJyZW50IHNvcnQgc2V0dGluZykuIFRZUCBlbnRyaWVzIHRoYXQgYXJlbid0XG4gIC8vIG1hbnVhbGx5IGNyZWF0YWJsZSBhcmUgbGVmdCBvdXQgdW5sZXNzIGluY2x1ZGVNYW51YWxPZmYgaXMgdHJ1ZS5cbiAgZ2V0VHlwcyh7IGluY2x1ZGVNYW51YWxPZmYgPSBmYWxzZSB9ID0ge30pIHtcbiAgICBjb25zdCB7IGNvdW50cyB9ID0gdGhpcy50eXBJbmRleC50eXBDb3VudHMoKTtcbiAgICBjb25zdCBzb3J0T3JkZXIgPSB0aGlzLnNldHRpbmdzLnR5cFNvcnRPcmRlciA/PyBERUZBVUxUX1NPUlRfT1JERVI7XG4gICAgcmV0dXJuIHNvcnRUeXBzQnlNb2RlKHRoaXMuc2V0dGluZ3MudHlwcywgc29ydE9yZGVyLCBjb3VudHMsIHRoaXMuc2V0dGluZ3MudHlwQ29sb3JzKVxuICAgICAgLmZpbHRlcigodHlwKSA9PiBpbmNsdWRlTWFudWFsT2ZmIHx8ICh0aGlzLnNldHRpbmdzLnR5cE1hbnVhbCA/PyB7fSlbdHlwXSAhPT0gZmFsc2UpXG4gICAgICAubWFwKCh0eXApID0+ICh7XG4gICAgICAgIHR5cCxcbiAgICAgICAgZGVzY3JpcHRpb246IHRoaXMuc2V0dGluZ3MudHlwRGVzY3JpcHRpb25zW3R5cF0gPz8gXCJcIixcbiAgICAgICAgY291bnQ6IGNvdW50cy5nZXQodHlwKSA/PyAwLFxuICAgICAgfSkpO1xuICB9XG5cbiAgLy8gRm9yIFRZUC5qczogdGhlIG5hdGl2ZSBUWVAtUGlja2VyIChzZWUgdHlwLXBpY2tlci5qcykgd2l0aCBjb2xvcixcbiAgLy8gZGVzY3JpcHRpb24gYW5kIG5vdGUgY291bnQuIGluY2x1ZGVNYW51YWxPZmYgYXMgaW4gZ2V0VHlwcygpLiBSZXNvbHZlc1xuICAvLyB3aXRoIHRoZSBUWVAsIG9yIG51bGwgb24gRVNDLlxuICBwaWNrVHlwKG9wdGlvbnMpIHtcbiAgICByZXR1cm4gcGlja1R5cE1vZGFsKHRoaXMuYXBwLCB0aGlzLCBvcHRpb25zKTtcbiAgfVxuXG4gIC8vIEZvciBUWVAuanM6IFRZUCBhbmQgU3VidHlwIGluIG9uZSBnbyAoc2VlIHR5cC1waWNrZXIuanMpIC0gb25lIHBpY2tlciB3aXRoXG4gIC8vIGluZGVudGVkIFN1YnR5cHMgb3IgYm90aCBwaWNrZXJzIGluIHR1cm4sIHBlciBcIlNlcGFyYXRlIFN1YnR5cC1QaWNrZXJcIi5cbiAgLy8gUmVzb2x2ZXMgd2l0aCB7IHR5cCwgc3VidHlwIH0gKHN1YnR5cCBudWxsIGZvciBcIm5vIFN1YnR5cFwiKSwgb3IgbnVsbCBvblxuICAvLyBFU0MuXG4gIHBpY2tUeXBBbmRTdWJ0eXAob3B0aW9ucykge1xuICAgIHJldHVybiBwaWNrVHlwQW5kU3VidHlwTW9kYWwodGhpcy5hcHAsIHRoaXMsIG9wdGlvbnMpO1xuICB9XG5cbiAgLy8gZGF0YTogd2hhdCBsb2FkRGF0YSgpIHJldHVybmVkLCBpZiB0aGUgY2FsbGVyIGFscmVhZHkgaGFzIGl0IChvbmxvYWQpO1xuICAvLyB3aXRob3V0IGl0IChvbkV4dGVybmFsU2V0dGluZ3NDaGFuZ2UpIGRhdGEuanNvbiBpcyByZWFkIGhlcmUuXG4gIGFzeW5jIGxvYWRTZXR0aW5ncyhkYXRhKSB7XG4gICAgaWYgKGRhdGEgPT09IHVuZGVmaW5lZCkgZGF0YSA9IGF3YWl0IHRoaXMubG9hZERhdGEoKTtcbiAgICAvLyBBIGRlZXAgY29weSBhcyB0aGUgYmFzZTogd2l0aG91dCBkYXRhLmpzb24gKGEgZnJlc2ggaW5zdGFsbCkgb3Igd2l0aCBrZXlzXG4gICAgLy8gbWlzc2luZyBmcm9tIGl0LCBzZXR0aW5ncy50eXBzLCB0eXBDb2xvcnMgYW5kIHNvIG9uIHdvdWxkIG90aGVyd2lzZSBCRVxuICAgIC8vIHRoZSBvYmplY3RzIGluIERFRkFVTFRfU0VUVElOR1MsIGFuZCBldmVyeSBjaGFuZ2Ugd291bGQgYWx0ZXIgdGhlXG4gICAgLy8gZGVmYXVsdHMgYWxvbmcgd2l0aCB0aGVtLlxuICAgIHRoaXMuc2V0dGluZ3MgPSBPYmplY3QuYXNzaWduKHN0cnVjdHVyZWRDbG9uZShERUZBVUxUX1NFVFRJTkdTKSwgZGF0YSk7XG4gICAgLy8gT2JqZWN0LmFzc2lnbiByZXBsYWNlcyBuZXN0ZWQgb2JqZWN0cyB3aG9sZTsgdmlld3MgYWRkZWQgbGF0ZXIgKGUuZy5cbiAgICAvLyBjb2xvclZpZXdzLmxpbmtzKSB3b3VsZCBvdGhlcndpc2UgYmUgc2lsZW50bHkgb2ZmIGluIG9sZGVyIHNldHRpbmdzLlxuICAgIHRoaXMuc2V0dGluZ3MuY29sb3JWaWV3cyA9IHsgLi4uREVGQVVMVF9TRVRUSU5HUy5jb2xvclZpZXdzLCAuLi50aGlzLnNldHRpbmdzLmNvbG9yVmlld3MgfTtcbiAgICB0aGlzLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIgPSBub3JtYWxpemVHbG9iYWxPcmRlcih0aGlzLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIpO1xuICB9XG5cbiAgLy8gc2V0dGluZ3NSZXZpc2lvbiBjb3VudHMgZXZlcnkgY2hhbmdlIG9mIHRoZSBzZXR0aW5ncyAoaGVyZSBhbmQgaW5cbiAgLy8gb25FeHRlcm5hbFNldHRpbmdzQ2hhbmdlKS4gVW5kbyAodW5kby5qcykgY29tcGFyZXMgaXQgdG8gdGVsbCB3aGV0aGVyXG4gIC8vIGFueXRoaW5nIGhhcHBlbmVkIGFmdGVyIHRoZSBhY3Rpb24gaXQgd291bGQgcmV2ZXJ0LiBCdW1wZWQgc3luY2hyb25vdXNseSxcbiAgLy8gYmVmb3JlIHRoZSBhd2FpdCwgc28gYSBjYWxsZXIgdGhhdCBkb2Vzbid0IGF3YWl0IHN0aWxsIGNvdW50cyBhdCBvbmNlLlxuICBhc3luYyBzYXZlU2V0dGluZ3MoKSB7XG4gICAgdGhpcy5zZXR0aW5nc1JldmlzaW9uID0gKHRoaXMuc2V0dGluZ3NSZXZpc2lvbiA/PyAwKSArIDE7XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcbiAgfVxuXG4gIC8vIENhbGxlZCB3aGVuIGRhdGEuanNvbiBjaGFuZ2VzIGZyb20gb3V0c2lkZSwgaW4gcHJhY3RpY2UgdGhyb3VnaCBPYnNpZGlhblxuICAvLyBTeW5jLiBXaXRob3V0IGl0IHRoaXMgZGV2aWNlIHdvdWxkIGtlZXAgaXRzIG9sZCBzZXR0aW5ncyBpbiBtZW1vcnkgYW5kXG4gIC8vIG92ZXJ3cml0ZSB0aGUgbmV3IG9uZXMgb24gdGhlIG5leHQgc2F2ZS4gT2JzaWRpYW4gcmVidWlsZHMgYW4gb3BlblxuICAvLyBzZXR0aW5ncyB0YWIgaXRzZWxmOyBjb2xvcnMgYW5kIHRoZSBUWVAtUGFuZSBhcmUgcmVmcmVzaGVkIGhlcmUuXG4gIGFzeW5jIG9uRXh0ZXJuYWxTZXR0aW5nc0NoYW5nZSgpIHtcbiAgICAvLyBJbnZhbGlkYXRlcyBhIHBlbmRpbmcgdW5kbzogaXRzIHNuYXBzaG90IHByZWRhdGVzIHRoZSBzeW5jZWQgc2V0dGluZ3MuXG4gICAgdGhpcy5zZXR0aW5nc1JldmlzaW9uID0gKHRoaXMuc2V0dGluZ3NSZXZpc2lvbiA/PyAwKSArIDE7XG4gICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcbiAgICB0aGlzLnJlZnJlc2hUeXBDb2xvcnMoKTtcbiAgfVxufTtcbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7OztBQUFBO0FBQUEscUJBQUFBLFVBQUFDLFNBQUE7QUFBQSxRQUFNLEVBQUUsUUFBUSxPQUFPLFNBQVMsSUFBSSxRQUFRLFVBQVU7QUFFdEQsUUFBTUMsZ0JBQWU7QUFDckIsUUFBTUMsbUJBQWtCO0FBQ3hCLFFBQU0sY0FBYyxPQUFPLE9BQU8sRUFBRSxRQUFRLE1BQU0sUUFBUSxNQUFNLFdBQVcsTUFBTSxXQUFXLEtBQUssQ0FBQztBQUtsRyxRQUFNLGlCQUFpQjtBQUV2QixhQUFTLFFBQVEsT0FBTztBQUN0QixVQUFJLFNBQVMsS0FBTSxRQUFPO0FBQzFCLGFBQU8sT0FBTyxVQUFVLFdBQVcsS0FBSyxVQUFVLEtBQUssSUFBSSxPQUFPLEtBQUs7QUFBQSxJQUN6RTtBQVNB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SyxTQUFTLHNCQUFzQixxQkFBcUIsS0FBSyxTQUFTLG1CQUFtQjtBQUFBLEVBQzVGO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQU1BLE1BQU0sZUFBZTtBQUNuQixTQUFLLG9CQUFvQixLQUFLLG9CQUFvQixLQUFLO0FBQ3ZELFVBQU0sS0FBSyxTQUFTLEtBQUssUUFBUTtBQUFBLEVBQ25DO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQU1BLE1BQU0sMkJBQTJCO0FBRS9CLFNBQUssb0JBQW9CLEtBQUssb0JBQW9CLEtBQUs7QUFDdkQsVUFBTSxLQUFLLGFBQWE7QUFDeEIsU0FBSyxpQkFBaUI7QUFBQSxFQUN4QjtBQUNGOyIsCiAgIm5hbWVzIjogWyJleHBvcnRzIiwgIm1vZHVsZSIsICJUWVBfUFJPUEVSVFkiLCAiU1VCVFlQX1BST1BFUlRZIiwgInNldENhbm9uaWNhbFByb3BlcnR5IiwgImRlbGV0ZVByb3BlcnR5IiwgIlR5cEluZGV4IiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInNldENhbm9uaWNhbFByb3BlcnR5IiwgIlNVQlRZUF9QUk9QRVJUWSIsICJnZXRTdWJ0eXBOYW1lcyIsICJnZXRTdWJ0eXAiLCAiaXNTdWJ0eXBNYW51YWwiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAic29ydFR5cHNCeU1vZGUiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZ2V0U3VidHlwIiwgIlRZUF9QUk9QRVJUWSIsICJTVUJUWVBfUFJPUEVSVFkiLCAibm9ybWFsaXplR2xvYmFsT3JkZXIiLCAic29ydEZyb250bWF0dGVyRm9yIiwgInBsYWNlUHJvcGVydHlGb3IiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXAiLCAiY2xlYXJJbmxpbmVDb2xvcnMiLCAiYWxsRG9jdW1lbnRzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgIkRFRkFVTFRfU0VUVElOR1MiLCAiVHlwU3lzdGVtU2V0dGluZ1RhYiIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXBOYW1lcyIsICJub3JtYWxpemVHbG9iYWxPcmRlciIsICJUWVBfUFJPUEVSVFkiLCAiU1VCVFlQX1BST1BFUlRZIiwgImxlYWYiLCAiY3VycmVudCIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlckNvbW1hbmRzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInNjcmlwdE5hbWVPZiIsICJyZXNvbHZlQ2FsbEFyZ3MiLCAicmVzb2x2ZVNob3J0Y3V0cyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXAiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJyZW1vdmVQcm9wZXJ0eU1lbnVQYXRjaCIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXBOYW1lcyIsICJnZXRTdWJ0eXAiLCAiaXNTdWJ0eXBNYW51YWwiLCAic29ydFR5cHNCeU1vZGUiLCAic2V0Q2Fub25pY2FsUHJvcGVydHkiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJERUZBVUxUX1NPUlRfT1JERVIiLCAicmVnaXN0ZXJUeXBQYW5lIiwgImxlYWYiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJGaWxlRXhwbG9yZXJDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJHcmFwaENvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlclNlYXJjaENvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlclJlY2VudEZpbGVzQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyQmFja2xpbmtDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJCb29rbWFya3NDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZ2V0U3VidHlwIiwgInJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiYWxsRG9jdW1lbnRzIiwgInJlZ2lzdGVyTGlua0NvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXBOYW1lcyIsICJnZXRTdWJ0eXAiLCAiYWxsRG9jdW1lbnRzIiwgImZsb2F0aW5nIiwgInJlZ2lzdGVyRnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0IiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImdldFN1YnR5cE5hbWVzIiwgIlRZUF9QUk9QRVJUWSIsICJTVUJUWVBfUFJPUEVSVFkiLCAicmVnaXN0ZXJQcm9wZXJ0eVJlbmFtZVN5bmMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiREVGQVVMVF9TT1JUX09SREVSIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyU2hvcnRjdXRTY3JpcHRzIl0KfQo=
