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
    function sortSummary(label, checked, changed) {
      return changed > 0 ? `${label}: checked ${plural(checked, "note")}, sorted ${changed}.` : `${label}: checked ${plural(checked, "note")}, all already sorted.`;
    }
    module2.exports = {
      sortAllFrontmatter,
      sortSingleFileFrontmatter,
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
    module2.exports = {
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
      await app.vault.modify(view.file, stringifyYaml(data));
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
      const options = await askColumnOptions(plugin, target, (current) => columnIds(plugin, target, current));
      if (!options) return;
      await createBase(plugin, target, options);
    }
    function activeBaseView(plugin) {
      const leaf = plugin.app.workspace.activeLeaf ?? plugin.app.workspace.getMostRecentLeaf?.();
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
      createBaseCommand,
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
    var { sortAllFrontmatter, sortSingleFileFrontmatter, sortSummary } = require_frontmatter_sort();
    var { createBaseCommand, activeBaseView, updateActiveView } = require_bases();
    function registerCommands2(plugin) {
      const runOrReportError = (label, fn) => async () => {
        try {
          await fn();
        } catch (error) {
          console.error(`[${label}]`, error);
          new Notice(`${label} failed: ${error.message}`);
        }
      };
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
          const { checked, changed, hasTypDefaults } = await sortAllFrontmatter(plugin.app, plugin, typ);
          let message = sortSummary(`Frontmatter sorting ${typ}`, checked, changed);
          if (hasTypDefaults === false) {
            message += ` Note: ${typ} has no TYP-Frontmatter, so only the global order was applied.`;
          }
          new Notice(message);
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
        callback: runOrReportError("Create Base", () => createBaseCommand(plugin))
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
    module2.exports = { registerCommands: registerCommands2 };
  }
});

// src/confirm-modal.js
var require_confirm_modal = __commonJS({
  "src/confirm-modal.js"(exports2, module2) {
    var { ConfirmationModal } = require("obsidian");
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
      constructor(app, { title, body = [], confirmText, warning = false, focus = "confirm", onConfirm, onCancel }) {
        super(app);
        this.title = title;
        this.body = body;
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;
        this.confirmed = false;
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
        if (this.confirmed) this.onConfirm?.();
        else this.onCancel?.();
      }
    };
    module2.exports = { ConfirmModal, appendTypName, appendSubtypName, typNameNode, subtypNameNode };
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
      view.plugin.refreshTypColors?.();
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
          renderShortcutControls(view, editor, store);
          view.plugin.refreshTypColors?.();
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
      delete shortcuts[key];
      store.setShortcuts(shortcuts);
      saveShortcuts(view, editor, store);
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
        view.plugin.refreshTypColors?.();
      }
    }
    module2.exports = { mountFrontmatterBlocks };
  }
});

// src/typ-pane.js
var require_typ_pane = __commonJS({
  "src/typ-pane.js"(exports2, module2) {
    var { ItemView, Menu, Notice, setIcon, debounce } = require("obsidian");
    var { ConfirmModal, typNameNode, subtypNameNode } = require_confirm_modal();
    var { mountFrontmatterBlocks } = require_frontmatter_blocks();
    var {
      normalizeSubtypName,
      getSubtypNames: getSubtypNames2,
      ensureSubtyp,
      moveTypSubtyps,
      deleteTypSubtyps,
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
        this.plugin.refreshTypColors?.();
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
      // A new, empty tree item straight in edit mode - like Obsidian's own views
      // (a new bookmark group, say).
      startAdd() {
        if (this.isEditing) return;
        const treeItem = this.listEl.createDiv({ cls: "tree-item" });
        if (this.separatorEl) this.listEl.insertBefore(treeItem, this.separatorEl);
        const self = treeItem.createDiv({ cls: "tree-item-self is-clickable" });
        const inner = self.createDiv({ cls: "tree-item-inner" });
        this.startEditing(null, self, inner);
      }
      // Like Obsidian's tree items: no extra input, the text element itself
      // becomes contenteditable. typ === null means a new entry, otherwise a
      // rename of that TYP.
      startEditing(typ, self, inner) {
        if (this.isEditing) return;
        this.isEditing = true;
        self.addClass("is-being-renamed");
        inner.setAttribute("contenteditable", "true");
        inner.setAttribute("spellcheck", "false");
        inner.focus();
        const range = inner.doc.createRange();
        range.selectNodeContents(inner);
        const selection = inner.win.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        let done = false;
        const finish = async (commit) => {
          if (done) return;
          done = true;
          this.isEditing = false;
          const value = normalizeTypName(inner.textContent);
          if (commit && value && value !== typ) {
            const exists = this.plugin.settings.typs.some(
              (t) => t.toLowerCase() === value.toLowerCase() && t !== typ
            );
            if (!exists) {
              if (typ === null) {
                this.plugin.settings.typs.push(value);
              } else {
                const idx = this.plugin.settings.typs.indexOf(typ);
                if (idx !== -1) this.plugin.settings.typs[idx] = value;
                if (this.plugin.settings.typColors[typ] !== void 0) {
                  this.plugin.settings.typColors[value] = this.plugin.settings.typColors[typ];
                  delete this.plugin.settings.typColors[typ];
                }
                if (this.plugin.settings.typDescriptions[typ] !== void 0) {
                  this.plugin.settings.typDescriptions[value] = this.plugin.settings.typDescriptions[typ];
                  delete this.plugin.settings.typDescriptions[typ];
                }
                if (this.plugin.settings.typDefaultFrontmatter[typ] !== void 0) {
                  this.plugin.settings.typDefaultFrontmatter[value] = this.plugin.settings.typDefaultFrontmatter[typ];
                  delete this.plugin.settings.typDefaultFrontmatter[typ];
                }
                if (this.plugin.settings.typFloatingKeys[typ] !== void 0) {
                  this.plugin.settings.typFloatingKeys[value] = this.plugin.settings.typFloatingKeys[typ];
                  delete this.plugin.settings.typFloatingKeys[typ];
                }
                if (this.plugin.settings.typShortcuts[typ] !== void 0) {
                  this.plugin.settings.typShortcuts[value] = this.plugin.settings.typShortcuts[typ];
                  delete this.plugin.settings.typShortcuts[typ];
                }
                if (this.ensureTypManual()[typ] !== void 0) {
                  this.plugin.settings.typManual[value] = this.plugin.settings.typManual[typ];
                  delete this.plugin.settings.typManual[typ];
                }
                moveTypSubtyps(this.plugin.settings, typ, value);
              }
              await this.plugin.saveSettings();
              this.plugin.refreshTypColors?.();
            }
          }
          this.render();
        };
        inner.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
          }
        });
        inner.addEventListener("blur", () => finish(true));
      }
      openTypSettings(typ) {
        this.selectedTyp = typ;
        this.render();
      }
      closeTypSettings() {
        this.selectedTyp = null;
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
      render() {
        if (this._rendering) return;
        this._rendering = true;
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
        colorInput.addEventListener("click", (event) => event.stopPropagation());
        colorInput.addEventListener("input", async () => {
          showState(colorInput.value, false);
          this.plugin.settings.typColors[typ] = colorInput.value;
          await this.plugin.saveSettings();
          onChange?.(colorInput.value);
        });
        colorInput.addEventListener("change", () => this.plugin.refreshTypColors?.());
        if (showReset) {
          resetBtn = parent.createDiv({
            cls: "clickable-icon typ-color-reset",
            attr: { "aria-label": "Reset color" }
          });
          setIcon(resetBtn, "rotate-ccw");
          resetBtn.addEventListener("click", async () => {
            delete this.plugin.settings.typColors[typ];
            colorInput.value = DEFAULT_TYP_COLOR;
            showState(DEFAULT_TYP_COLOR, true);
            await this.plugin.saveSettings();
            this.plugin.refreshTypColors?.();
            onChange?.(DEFAULT_TYP_COLOR);
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
          event.preventDefault();
          event.stopPropagation();
          this.openSearch(typ);
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
        this.plugin.refreshTypColors?.();
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
          delete data.color;
          await this.plugin.saveSettings();
          this.plugin.refreshTypColors?.();
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
      // it can reach. Dragging only updates the dot here; saving and updating the
      // other views happens on close (click outside or Escape), since
      // refreshTypColors() re-renders this view among others.
      openSubtypColorPopover(anchorEl, typ, subtyp) {
        this.closeSubtypColorPopover?.();
        const { settings } = this.plugin;
        const data = getSubtyp2(settings, typ, subtyp);
        if (!data) return;
        const typColor = settings.typColors[typ] ?? DEFAULT_TYP_COLOR;
        const offset = clampedOffset(settings, data.color) ?? Object.fromEntries(SUBTYP_COLOR_CHANNELS.map(({ key }) => [key, 0]));
        const doc = anchorEl.doc;
        const popover = doc.body.createDiv({ cls: "menu typ-subtyp-color-popover" });
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
          input.disabled = min === max;
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
          if (hasColorOffset(offset)) current.color = { ...offset };
          else delete current.color;
          await this.plugin.saveSettings();
          this.plugin.refreshTypColors?.();
          this.render();
        };
        this.closeSubtypColorPopover = close;
        doc.addEventListener("mousedown", onPointerDown, true);
        doc.addEventListener("keydown", onKeyDown, true);
      }
      // Deletes the Subtyp block with its properties. Notes keep their SUBTYP
      // value (it then shows as unregistered below), so confirmation is only
      // needed when properties would be lost.
      deleteSubtypWithConfirm(typ, subtyp) {
        const apply = async () => {
          deleteSubtyp(this.plugin.settings, typ, subtyp);
          await this.plugin.saveSettings();
          this.plugin.refreshTypColors?.();
          this.render();
        };
        const keys = Object.keys(getSubtyp2(this.plugin.settings, typ, subtyp)?.frontmatter ?? {}).filter((key) => key !== "");
        if (keys.length === 0) {
          apply();
          return;
        }
        const { plugin } = this;
        new ConfirmModal(this.app, {
          title: [
            "Delete ",
            subtypNameNode(plugin, typ, subtyp),
            " of ",
            typNameNode(plugin, typ, plugin.settings.typColors[typ] ?? null),
            "?"
          ],
          body: [
            keys.length === 1 ? `Its property ${keys[0]} will be lost.` : `Its ${keys.length} properties ${keys.join(", ")} will be lost.`
          ],
          confirmText: "Delete",
          warning: true,
          focus: "cancel",
          onConfirm: apply
        }).open();
      }
      // Like startDetailRename(), on a Subtyp block's title. The block keeps its
      // position; updateNotes: true also rewrites the SUBTYP of the affected notes
      // after confirmation. An existing name offers a merge instead (which always
      // rewrites the notes).
      startSubtypRename(typ, subtyp, titleEl, { updateNotes = false } = {}) {
        if (this.isEditing) return;
        this.isEditing = true;
        titleEl.addClass("typ-subtyp-name-input", "is-being-renamed");
        titleEl.setAttribute("contenteditable", "true");
        titleEl.setAttribute("spellcheck", "false");
        titleEl.focus();
        const range = titleEl.doc.createRange();
        range.selectNodeContents(titleEl);
        const selection = titleEl.win.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        const countOf = (name) => this.plugin.typIndex.subtypBucket(typ).counts.get(name) ?? 0;
        const applyRename = async (value, { withNotes }) => {
          renameSubtyp(this.plugin.settings, typ, subtyp, value);
          await this.plugin.saveSettings();
          const renamed = withNotes ? await renameSubtypInNotes(this.plugin, typ, subtyp, value) : 0;
          this.plugin.refreshTypColors?.();
          if (withNotes) new Notice(`Subtyp ${value}: ${plural(renamed, "note")} updated.`);
          this.render();
        };
        let done = false;
        const finish = async (commit) => {
          if (done) return;
          done = true;
          this.isEditing = false;
          const value = normalizeSubtypName(titleEl.textContent);
          if (!commit || !value || value === subtyp) {
            this.render();
            return;
          }
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
                this.plugin.refreshTypColors?.();
                new Notice(`Subtyp ${subtyp} merged into ${existing}, ${plural(renamed, "note")} updated.`);
                this.render();
              },
              onCancel: () => this.render()
            }).open();
            return;
          }
          if (!updateNotes) {
            await applyRename(value, { withNotes: false });
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
            onConfirm: () => applyRename(value, { withNotes: true }),
            onCancel: () => this.render()
          }).open();
        };
        titleEl.addEventListener("keydown", (event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
          }
        });
        titleEl.addEventListener("blur", () => finish(true));
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
        this.plugin.refreshTypColors?.();
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
        this.isEditing = true;
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
        nameEl.setAttribute("contenteditable", "true");
        nameEl.setAttribute("spellcheck", "false");
        nameEl.focus();
        let done = false;
        const finish = async (commit) => {
          if (done) return;
          done = true;
          this.isEditing = false;
          const value = normalizeSubtypName(nameEl.textContent);
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
        };
        nameEl.addEventListener("keydown", (event) => {
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
        nameEl.addEventListener("blur", () => finish(true));
      }
      showDeleteConfirm(typ) {
        const onConfirm = async () => {
          this.plugin.settings.typs = this.plugin.settings.typs.filter((t) => t !== typ);
          delete this.plugin.settings.typColors[typ];
          delete this.plugin.settings.typDescriptions[typ];
          delete this.plugin.settings.typDefaultFrontmatter[typ];
          delete this.plugin.settings.typFloatingKeys[typ];
          delete this.plugin.settings.typShortcuts[typ];
          delete this.ensureTypManual()[typ];
          deleteTypSubtyps(this.plugin.settings, typ);
          this.closeTypSettings();
          await this.plugin.saveSettings();
          this.plugin.refreshTypColors?.();
        };
        new ConfirmModal(this.app, {
          title: ["Delete ", typNameNode(this.plugin, typ, this.plugin.settings.typColors[typ] ?? null), "?"],
          confirmText: "Delete",
          warning: true,
          focus: "cancel",
          onConfirm
        }).open();
      }
      // Like startEditing(), but on the detail view's title, switching
      // selectedTyp instead of just re-rendering the list. updateNotes: true (the
      // highlighted button) also rewrites the TYP of every affected note after
      // confirmation (see renameTypInNotes) instead of only the settings.
      startDetailRename(typ, titleEl, { updateNotes = false } = {}) {
        if (this.isEditing) return;
        this.isEditing = true;
        titleEl.addClass("is-being-renamed");
        titleEl.setAttribute("contenteditable", "true");
        titleEl.setAttribute("spellcheck", "false");
        titleEl.focus();
        const range = titleEl.doc.createRange();
        range.selectNodeContents(titleEl);
        const selection = titleEl.win.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        const applyRename = async (value) => {
          const idx = this.plugin.settings.typs.indexOf(typ);
          if (idx !== -1) this.plugin.settings.typs[idx] = value;
          if (this.plugin.settings.typColors[typ] !== void 0) {
            this.plugin.settings.typColors[value] = this.plugin.settings.typColors[typ];
            delete this.plugin.settings.typColors[typ];
          }
          if (this.plugin.settings.typDescriptions[typ] !== void 0) {
            this.plugin.settings.typDescriptions[value] = this.plugin.settings.typDescriptions[typ];
            delete this.plugin.settings.typDescriptions[typ];
          }
          if (this.plugin.settings.typDefaultFrontmatter[typ] !== void 0) {
            this.plugin.settings.typDefaultFrontmatter[value] = this.plugin.settings.typDefaultFrontmatter[typ];
            delete this.plugin.settings.typDefaultFrontmatter[typ];
          }
          if (this.plugin.settings.typFloatingKeys[typ] !== void 0) {
            this.plugin.settings.typFloatingKeys[value] = this.plugin.settings.typFloatingKeys[typ];
            delete this.plugin.settings.typFloatingKeys[typ];
          }
          if (this.plugin.settings.typShortcuts[typ] !== void 0) {
            this.plugin.settings.typShortcuts[value] = this.plugin.settings.typShortcuts[typ];
            delete this.plugin.settings.typShortcuts[typ];
          }
          if (this.ensureTypManual()[typ] !== void 0) {
            this.plugin.settings.typManual[value] = this.plugin.settings.typManual[typ];
            delete this.plugin.settings.typManual[typ];
          }
          moveTypSubtyps(this.plugin.settings, typ, value);
          this.selectedTyp = value;
          await this.plugin.saveSettings();
          this.plugin.refreshTypColors?.();
        };
        let done = false;
        const finish = async (commit) => {
          if (done) return;
          done = true;
          this.isEditing = false;
          const value = normalizeTypName(titleEl.textContent);
          if (!commit || !value || value === typ) {
            this.render();
            return;
          }
          const existing = this.plugin.settings.typs.find(
            (t) => t.toLowerCase() === value.toLowerCase() && t !== typ
          );
          if (existing) {
            this.showMergeConfirm(typ, existing);
            return;
          }
          if (!updateNotes) {
            await applyRename(value);
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
              await applyRename(value);
              const renamed = await renameTypInNotes(this.plugin, typ, value);
              new Notice(`TYP ${value}: ${plural(renamed, "note")} updated.`);
              this.render();
            },
            onCancel: () => this.render()
          }).open();
        };
        titleEl.addEventListener("keydown", (event) => {
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
        titleEl.addEventListener("blur", () => finish(true));
      }
      // Renaming to the name of an already registered TYP (see startDetailRename)
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
      // over, same-named blocks are combined (see mergeTypSubtyps in subtyps.js).
      //
      // "Manually creatable" is where a merge does more than move data: the moved
      // Subtyps bring source's toggles but end up under target's. With source on
      // and target off they would be switched-on Subtyps under a switched-off TYP,
      // unreachable in the picker. So a switched-off target switches them off too,
      // as its own button would (see renderManualToggle). With target on they stay
      // as they were.
      async mergeTyp(source, target) {
        const settings = this.plugin.settings;
        const renamed = await renameTypInNotes(this.plugin, source, target);
        settings.typs = settings.typs.filter((t) => t !== source);
        delete settings.typColors[source];
        delete settings.typDescriptions[source];
        delete settings.typDefaultFrontmatter[source];
        delete settings.typFloatingKeys[source];
        delete settings.typShortcuts[source];
        delete this.ensureTypManual()[source];
        mergeTypSubtyps(settings, source, target);
        if (this.ensureTypManual()[target] === false) setAllSubtypsManual(settings, target, false);
        this.selectedTyp = target;
        await this.plugin.saveSettings();
        this.plugin.refreshTypColors?.();
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
      plugin.app.workspace.onLayoutReady(() => activateTypPane(plugin, false, false));
      const refresh = () => {
        for (const leaf of plugin.app.workspace.getLeavesOfType(VIEW_TYPE_TYP_PANE)) {
          leaf.view?.render?.();
        }
      };
      const debouncedRefresh = debounce(refresh, 500, true);
      plugin.registerEvent(plugin.typIndex.on("change", debouncedRefresh));
      plugin.registerEvent(plugin.app.vault.on("config-changed", debouncedRefresh));
      return refresh;
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
    var { colorForFile } = require_typ_colors();
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
      if (color) contentEl.style.color = color;
      else contentEl.style.removeProperty("color");
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
    var { colorForFile } = require_typ_colors();
    var SEARCH_VIEW_TYPE = "search";
    function applySearchColors(plugin) {
      for (const leaf of plugin.app.workspace.getLeavesOfType(SEARCH_VIEW_TYPE)) {
        const resultDomLookup = leaf.view?.dom?.resultDomLookup;
        if (!resultDomLookup) continue;
        for (const [file, resultDom] of resultDomLookup) {
          const titleEl = resultDom.el?.querySelector(".search-result-file-title .tree-item-inner");
          if (!titleEl) continue;
          const color = plugin.settings.colorViews.search ? colorForFile(plugin, file, "search") : null;
          if (color) titleEl.style.color = color;
          else titleEl.style.removeProperty("color");
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
    var { colorForFile } = require_typ_colors();
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
          if (color) titleEl.style.color = color;
          else titleEl.style.removeProperty("color");
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
    var { colorForFile } = require_typ_colors();
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
      if (color) el.style.color = color;
      else el.style.removeProperty("color");
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
    var { colorForFile } = require_typ_colors();
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
          if (color) titleEl.style.color = color;
          else titleEl.style.removeProperty("color");
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
    var { colorForFile, subtypColor, subtypHasOwnColor } = require_typ_colors();
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
          if (textColor) titleEl.style.color = textColor;
          else titleEl.style.removeProperty("color");
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
    var { colorForFile } = require_typ_colors();
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
      const docs = /* @__PURE__ */ new Set();
      plugin.app.workspace.iterateAllLeaves((leaf) => docs.add(leaf.view.containerEl.ownerDocument));
      for (const doc of docs) {
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
    function refreshEditors(plugin) {
      plugin.app.workspace.iterateAllLeaves((leaf) => {
        leaf.view?.editor?.cm?.dispatch({ effects: refreshEffect.of(null) });
      });
    }
    function registerLinkColors2(plugin) {
      plugin.registerMarkdownPostProcessor((el, ctx) => {
        for (const anchorEl of el.querySelectorAll("a.internal-link")) {
          anchorEl.setAttribute(SOURCE_ATTR, ctx.sourcePath);
          applyToAnchor(plugin, anchorEl);
        }
      });
      plugin.registerEditorExtension(Prec.lowest(buildLinkViewPlugin(plugin)));
      const refresh = () => {
        refreshRenderedLinks(plugin);
        refreshEditors(plugin);
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
    var { subtypColor } = require_typ_colors();
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
            if (color) titleEl.style.setProperty("color", color, "important");
            else titleEl.style.removeProperty("color");
          } else {
            titleEl.style.removeProperty("color");
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
module.exports = class TypSystemPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.typIndex = new TypIndex(this);
    this.typIndex.register();
    registerCommands(this);
    this.addSettingTab(new TypSystemSettingTab(this.app, this));
    registerPropertyRenameSync(this);
    this.register(removePropertyMenuPatch);
    this.getShortcutScripts = registerShortcutScripts(this);
    this.refreshFrontmatterHighlight = registerFrontmatterDefaultHighlight(this);
    const refreshFns = [
      registerTypPane(this),
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
    this.refreshTypColors = () => refreshFns.forEach((fn) => fn());
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
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.colorViews = { ...DEFAULT_SETTINGS.colorViews, ...this.settings.colorViews };
    this.settings.globalPropertyOrder = normalizeGlobalOrder(this.settings.globalPropertyOrder);
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  // Called when data.json changes from outside, in practice through Obsidian
  // Sync. Without it this device would keep its old settings in memory and
  // overwrite the new ones on the next save. Obsidian rebuilds an open
  // settings tab itself; colors and the TYP-Pane are refreshed here.
  async onExternalSettingsChange() {
    await this.loadSettings();
    this.refreshTypColors();
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL3R5cC1pbmRleC5qcyIsICJzcmMvc3VidHlwcy5qcyIsICJzcmMvdHlwLXV0aWxzLmpzIiwgInNyYy9mcm9udG1hdHRlci1zb3J0LmpzIiwgInNyYy9mcm9udG1hdHRlci1vcmRlci1lZGl0b3IuanMiLCAic3JjL3R5cC1jb2xvcnMuanMiLCAic3JjL3NldHRpbmdzLmpzIiwgInNyYy9iYXNlLWRpYWxvZ3MuanMiLCAic3JjL2Jhc2VzLmpzIiwgInNyYy9jb21tYW5kcy5qcyIsICJzcmMvY29uZmlybS1tb2RhbC5qcyIsICJzcmMvc2hvcnRjdXRzLmpzIiwgInNyYy9zaG9ydGN1dC1waWNrZXIuanMiLCAic3JjL3R5cC1mcm9udG1hdHRlci1lZGl0b3IuanMiLCAic3JjL2Zyb250bWF0dGVyLWJsb2Nrcy5qcyIsICJzcmMvdHlwLXBhbmUuanMiLCAic3JjL2ZpbGUtZXhwbG9yZXItY29sb3JzLmpzIiwgInNyYy9ncmFwaC1jb2xvcnMuanMiLCAic3JjL3NlYXJjaC1jb2xvcnMuanMiLCAic3JjL3JlY2VudC1maWxlcy1jb2xvcnMuanMiLCAic3JjL2JhY2tsaW5rLWNvbG9ycy5qcyIsICJzcmMvYm9va21hcmstY29sb3JzLmpzIiwgInNyYy9hY3RpdmUtdGl0bGUtY29sb3JzLmpzIiwgInNyYy9saW5rLWNvbG9ycy5qcyIsICJzcmMvZnJvbnRtYXR0ZXItZGVmYXVsdC1oaWdobGlnaHQuanMiLCAic3JjL3Byb3BlcnR5LXJlbmFtZS1zeW5jLmpzIiwgInNyYy90eXAtcGlja2VyLmpzIiwgInNyYy9zaG9ydGN1dC1zY3JpcHRzLmpzIiwgInNyYy9tYWluLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJjb25zdCB7IEV2ZW50cywgVEZpbGUsIGRlYm91bmNlIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5cbmNvbnN0IFRZUF9QUk9QRVJUWSA9IFwiVFlQXCI7XG5jb25zdCBTVUJUWVBfUFJPUEVSVFkgPSBcIlNVQlRZUFwiO1xuY29uc3QgRU1QVFlfRU5UUlkgPSBPYmplY3QuZnJlZXplKHsgdHlwS2V5OiBudWxsLCByYXdUeXA6IG51bGwsIHN1YnR5cEtleTogbnVsbCwgcmF3U3VidHlwOiBudWxsIH0pO1xuXG4vLyBDb2xsZWN0cyBjaGFuZ2VzIHRvIG1hbnkgZmlsZXMgKHJlbmFtaW5nIGEgVFlQIGluIG1hbnkgbm90ZXMsIHN5bmMpIGludG8gb25lXG4vLyBcImNoYW5nZVwiIGV2ZW50LiBObyByZXNldFRpbWVyLCBzbyBhIGNvbnN0YW50IHN0cmVhbSBzdGlsbCBnZXRzIHRocm91Z2hcbi8vIHJlZ3VsYXJseS5cbmNvbnN0IEZMVVNIX0RFTEFZX01TID0gMTAwO1xuXG5mdW5jdGlvbiByYXdJdGVtKHZhbHVlKSB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gXCJcIjtcbiAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiA/IEpTT04uc3RyaW5naWZ5KHZhbHVlKSA6IFN0cmluZyh2YWx1ZSk7XG59XG5cbi8vIEhvdyB0aGUgd2hvbGUgcGx1Z2luIHJlYWRzIGEgVFlQIHZhbHVlOiBkZWxpYmVyYXRlbHkgTk9UIG5vcm1hbGl6ZWQgLSB0aGVcbi8vIHJhdyBmb3JtIGlzIHRoZSBrZXkuIEEgVFlQIGlzIGV4YWN0bHkgb25lIGNsZWFuIHZhbHVlOyBhbnl0aGluZyBlbHNlIChwYWRkZWQsXG4vLyBsb3dlcmNhc2UsIGEgbGlzdCAtIGV2ZW4gd2l0aCBvbmUgaXRlbSkgYmVjb21lcyBpdHMgb3duIGtleSB0aGF0IG1hdGNoZXMgbm9cbi8vIHJlZ2lzdGVyZWQgVFlQOiBubyBjb2xvciwgbm90IGNvdW50ZWQgZm9yIHRoZSBcInJlYWxcIiBUWVAsIGFuZCBsaXN0ZWQgaW4gdGhlXG4vLyBUWVAtUGFuZSBhcyBhbiB1bnJlZ2lzdGVyZWQgZW50cnkgdGhhdCBhIGNsaWNrIGNsZWFucyB1cCAoc2VlIHJlZ2lzdGVyVHlwIGluXG4vLyB0eXAtcGFuZS5qcykuIExpc3RzIHNob3cgYXMgXCJbQSwgQl1cIiBhbmQgbmV2ZXIgY29pbmNpZGUgd2l0aCBhIHZhbHVlIFwiQSwgQlwiLlxuLy8gbnVsbCA9IG5vIFRZUCAobWlzc2luZywgZW1wdHksIGJsYW5rLCBlbXB0eSBsaXN0KS5cbmZ1bmN0aW9uIHR5cEtleU9mKHZhbHVlKSB7XG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgIGNvbnN0IGl0ZW1zID0gdmFsdWUubWFwKHJhd0l0ZW0pO1xuICAgIGlmIChpdGVtcy5ldmVyeSgoaXRlbSkgPT4gaXRlbS50cmltKCkgPT09IFwiXCIpKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gYFske2l0ZW1zLmpvaW4oXCIsIFwiKX1dYDtcbiAgfVxuICBjb25zdCB0ZXh0ID0gcmF3SXRlbSh2YWx1ZSk7XG4gIHJldHVybiB0ZXh0LnRyaW0oKSA9PT0gXCJcIiA/IG51bGwgOiB0ZXh0O1xufVxuXG4vLyBPYnNpZGlhbiB0cmVhdHMgcHJvcGVydHkgbmFtZXMgY2FzZS1pbnNlbnNpdGl2ZWx5IChcIlN1YnR5cFwiIGFuZCBcIlNVQlRZUFwiXG4vLyBhcmUgb25lIHByb3BlcnR5IGluIFwiQWxsIHByb3BlcnRpZXNcIiksIHNvIFRZUCBhbmQgU1VCVFlQIGFyZSByZWFkIHRoZSBzYW1lXG4vLyB3YXkuIFRoZSBleGFjdCBzcGVsbGluZyB3aW5zIGlmIGEgbm90ZSAod3JvbmdseSkgaGFzIHNldmVyYWwuXG5mdW5jdGlvbiBwcm9wZXJ0eUtleU9mKGZyb250bWF0dGVyLCBuYW1lKSB7XG4gIGlmICghZnJvbnRtYXR0ZXIpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoZnJvbnRtYXR0ZXIsIG5hbWUpKSByZXR1cm4gbmFtZTtcbiAgY29uc3QgbG93ZXIgPSBuYW1lLnRvTG93ZXJDYXNlKCk7XG4gIHJldHVybiBPYmplY3Qua2V5cyhmcm9udG1hdHRlcikuZmluZCgoa2V5KSA9PiBrZXkudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXIpO1xufVxuXG5mdW5jdGlvbiBwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBuYW1lKSB7XG4gIGNvbnN0IGtleSA9IHByb3BlcnR5S2V5T2YoZnJvbnRtYXR0ZXIsIG5hbWUpO1xuICByZXR1cm4ga2V5ID09PSB1bmRlZmluZWQgPyB1bmRlZmluZWQgOiBmcm9udG1hdHRlcltrZXldO1xufVxuXG4vLyBXcml0ZXMgdmFsdWUgdW5kZXIgdGhlIGNhbm9uaWNhbCBzcGVsbGluZyBgbmFtZWAgKGUuZy4gXCJTVUJUWVBcIikgaW50byB0aGVcbi8vIHByb2Nlc3NGcm9udE1hdHRlciBvYmplY3QuIEEgZGlmZmVyZW50bHkgc3BlbGxlZCB2YXJpYW50IChcIlN1YnR5cFwiKSBpc1xuLy8gcmVuYW1lZCBpbiBwbGFjZSAtIGluc2VydGlvbiBvcmRlciBpcyBZQU1MIG9yZGVyLCBzbyBhbGwga2V5cyBhcmUgcmUtYWRkZWRcbi8vIGluIHRoZWlyIG9yZGVyIGlmIG5lZWRlZCAoYXMgaW4gZnJvbnRtYXR0ZXItc29ydC5qcykuXG5mdW5jdGlvbiBzZXRDYW5vbmljYWxQcm9wZXJ0eShmcm9udG1hdHRlciwgbmFtZSwgdmFsdWUpIHtcbiAgY29uc3QgbG93ZXIgPSBuYW1lLnRvTG93ZXJDYXNlKCk7XG4gIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyhmcm9udG1hdHRlcik7XG4gIGlmICgha2V5cy5zb21lKChrZXkpID0+IGtleSAhPT0gbmFtZSAmJiBrZXkudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXIpKSB7XG4gICAgZnJvbnRtYXR0ZXJbbmFtZV0gPSB2YWx1ZTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgc25hcHNob3QgPSB7IC4uLmZyb250bWF0dGVyIH07XG4gIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIGRlbGV0ZSBmcm9udG1hdHRlcltrZXldO1xuICBmb3IgKGNvbnN0IGtleSBvZiBrZXlzKSB7XG4gICAgaWYgKGtleS50b0xvd2VyQ2FzZSgpICE9PSBsb3dlcikgZnJvbnRtYXR0ZXJba2V5XSA9IHNuYXBzaG90W2tleV07XG4gICAgZWxzZSBpZiAoIShuYW1lIGluIGZyb250bWF0dGVyKSkgZnJvbnRtYXR0ZXJbbmFtZV0gPSB2YWx1ZTtcbiAgfVxufVxuXG4vLyBSZW1vdmVzIGBuYW1lYCBpbiBhbnkgc3BlbGxpbmcgZnJvbSB0aGUgcHJvY2Vzc0Zyb250TWF0dGVyIG9iamVjdC5cbmZ1bmN0aW9uIGRlbGV0ZVByb3BlcnR5KGZyb250bWF0dGVyLCBuYW1lKSB7XG4gIGNvbnN0IGxvd2VyID0gbmFtZS50b0xvd2VyQ2FzZSgpO1xuICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhmcm9udG1hdHRlcikpIHtcbiAgICBpZiAoa2V5LnRvTG93ZXJDYXNlKCkgPT09IGxvd2VyKSBkZWxldGUgZnJvbnRtYXR0ZXJba2V5XTtcbiAgfVxufVxuXG4vLyBTVUJUWVAgaXMgcmVhZCB0aGUgc2FtZSB3YXkgKHR5cEtleU9mKTogYXQgbW9zdCBvbmUgY2xlYW4gdmFsdWUgcGVyIG5vdGUsXG4vLyBhbnl0aGluZyBlbHNlIGlzIGl0cyBvd24gdW5yZWdpc3RlcmVkIGtleS5cbmZ1bmN0aW9uIHNhbWVFbnRyeShhLCBiKSB7XG4gIHJldHVybiAhIWEgJiYgISFiICYmIGEudHlwS2V5ID09PSBiLnR5cEtleSAmJiBhLnN1YnR5cEtleSA9PT0gYi5zdWJ0eXBLZXk7XG59XG5cbi8vIENlbnRyYWwgVFlQL1NVQlRZUCBpbmRleCBvdmVyIGFsbCBtYXJrZG93biBmaWxlcyAocGF0aCAtPiB2YWx1ZXMpLlxuLy9cbi8vIG1ldGFkYXRhQ2FjaGUgXCJjaGFuZ2VkXCIvXCJyZXNvbHZlZFwiIGZpcmUgb24gRVZFUlkgZWRpdCB0byBhbnkgbm90ZSAoYWJvdXRcbi8vIGV2ZXJ5IHR3byBzZWNvbmRzIHdoaWxlIHR5cGluZykuIFRoZSBpbmRleCBjb21wYXJlcyBwZXIgZmlsZSB3aGV0aGVyIFRZUCBvclxuLy8gU1VCVFlQIHJlYWxseSBjaGFuZ2VkIChvciBhIG5vdGUgYXBwZWFyZWQvZGlzYXBwZWFyZWQpIGFuZCBvbmx5IHRoZW4gZmlyZXNcbi8vIGl0cyBvd24gXCJjaGFuZ2VcIiBldmVudCAoYXJndW1lbnQ6IHNldCBvZiBhZmZlY3RlZCBwYXRocykuIEFsbCBjb2xvcmluZyBoYW5nc1xuLy8gb24gdGhpcyBldmVudCwgc28gbm9ybWFsIHR5cGluZyB0cmlnZ2VycyBubyByZWNvbG9yaW5nLlxuLy9cbi8vIEl0IGFsc28gY2FjaGVzIHRoZSB2YXVsdC13aWRlIGNvdW50cyAoVFlQLUxpc3QsIFN1YnR5cCBsaXN0LCBwaWNrZXJzLFxuLy8gZ2V0VHlwcygpKSBpbnN0ZWFkIG9mIHJlc2Nhbm5pbmcgZXZlcnkgbm90ZSBvbiBlYWNoIGNhbGwuXG5jbGFzcyBUeXBJbmRleCBleHRlbmRzIEV2ZW50cyB7XG4gIGNvbnN0cnVjdG9yKHBsdWdpbikge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gICAgdGhpcy5hcHAgPSBwbHVnaW4uYXBwO1xuICAgIHRoaXMuZW50cmllcyA9IG5ldyBNYXAoKTtcbiAgICB0aGlzLmJ1aWx0ID0gZmFsc2U7XG4gICAgdGhpcy5hZ2dyZWdhdGVzID0gbnVsbDtcbiAgICB0aGlzLnBlbmRpbmdQYXRocyA9IG5ldyBTZXQoKTtcbiAgICB0aGlzLmZsdXNoID0gZGVib3VuY2UoKCkgPT4ge1xuICAgICAgY29uc3QgcGF0aHMgPSB0aGlzLnBlbmRpbmdQYXRocztcbiAgICAgIHRoaXMucGVuZGluZ1BhdGhzID0gbmV3IFNldCgpO1xuICAgICAgdGhpcy50cmlnZ2VyKFwiY2hhbmdlXCIsIHBhdGhzKTtcbiAgICB9LCBGTFVTSF9ERUxBWV9NUyk7XG4gIH1cblxuICByZWdpc3RlcigpIHtcbiAgICBjb25zdCB7IHBsdWdpbiwgYXBwIH0gPSB0aGlzO1xuICAgIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC5tZXRhZGF0YUNhY2hlLm9uKFwiY2hhbmdlZFwiLCAoZmlsZSkgPT4gdGhpcy51cGRhdGUoZmlsZSkpKTtcbiAgICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAubWV0YWRhdGFDYWNoZS5vbihcImRlbGV0ZWRcIiwgKGZpbGUpID0+IHRoaXMucmVtb3ZlKGZpbGUucGF0aCkpKTtcbiAgICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJyZW5hbWVcIiwgKGZpbGUsIG9sZFBhdGgpID0+IHRoaXMucmVuYW1lKGZpbGUsIG9sZFBhdGgpKSk7XG4gICAgLy8gXCJFeGNsdWRlZCBmaWxlc1wiIGNoYW5nZWQ6IHRoZSBlbnRyaWVzIHN0YXkgdmFsaWQsIG9ubHkgdGhlIGZpbHRlcmVkXG4gICAgLy8gY291bnRzIGRvbid0LlxuICAgIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC52YXVsdC5vbihcImNvbmZpZy1jaGFuZ2VkXCIsICgpID0+ICh0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsKSkpO1xuXG4gICAgLy8gQXQgc3RhcnR1cCB0aGUgZmlyc3QgKGxhenkpIGFjY2VzcyBjYW4gY29tZSBiZWZvcmUgdGhlIG1ldGFkYXRhIGNhY2hlIGlzXG4gICAgLy8gZnVsbHkgbG9hZGVkLiBSZWJ1aWxkIG9uY2UgYWZ0ZXIgaXRzIGZpcnN0IGNvbXBsZXRlIHJlc29sdmU7IGRpZmZlcmVuY2VzXG4gICAgLy8gZ28gb3V0IHRocm91Z2ggdGhlIFwiY2hhbmdlXCIgZXZlbnQgbGlrZSBhbnkgb3RoZXIgY2hhbmdlLlxuICAgIGNvbnN0IHJlc29sdmVkUmVmID0gYXBwLm1ldGFkYXRhQ2FjaGUub24oXCJyZXNvbHZlZFwiLCAoKSA9PiB7XG4gICAgICBhcHAubWV0YWRhdGFDYWNoZS5vZmZyZWYocmVzb2x2ZWRSZWYpO1xuICAgICAgdGhpcy5yZWJ1aWxkKCk7XG4gICAgfSk7XG4gICAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocmVzb2x2ZWRSZWYpO1xuXG4gICAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IHRoaXMuZmx1c2guY2FuY2VsKCkpO1xuICB9XG5cbiAgcmVhZChmaWxlKSB7XG4gICAgY29uc3QgZnJvbnRtYXR0ZXIgPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXI7XG4gICAgY29uc3QgcmF3VHlwID0gcHJvcGVydHlWYWx1ZShmcm9udG1hdHRlciwgVFlQX1BST1BFUlRZKSA/PyBudWxsO1xuICAgIGNvbnN0IHJhd1N1YnR5cCA9IHByb3BlcnR5VmFsdWUoZnJvbnRtYXR0ZXIsIFNVQlRZUF9QUk9QRVJUWSkgPz8gbnVsbDtcbiAgICByZXR1cm4geyB0eXBLZXk6IHR5cEtleU9mKHJhd1R5cCksIHJhd1R5cCwgc3VidHlwS2V5OiB0eXBLZXlPZihyYXdTdWJ0eXApLCByYXdTdWJ0eXAgfTtcbiAgfVxuXG4gIGVuc3VyZUJ1aWx0KCkge1xuICAgIGlmICghdGhpcy5idWlsdCkgdGhpcy5yZWJ1aWxkKCk7XG4gIH1cblxuICByZWJ1aWxkKCkge1xuICAgIGNvbnN0IHByZXZpb3VzID0gdGhpcy5lbnRyaWVzO1xuICAgIGNvbnN0IHdhc0J1aWx0ID0gdGhpcy5idWlsdDtcbiAgICB0aGlzLmVudHJpZXMgPSBuZXcgTWFwKCk7XG4gICAgZm9yIChjb25zdCBmaWxlIG9mIHRoaXMuYXBwLnZhdWx0LmdldE1hcmtkb3duRmlsZXMoKSkgdGhpcy5lbnRyaWVzLnNldChmaWxlLnBhdGgsIHRoaXMucmVhZChmaWxlKSk7XG4gICAgdGhpcy5idWlsdCA9IHRydWU7XG4gICAgdGhpcy5hZ2dyZWdhdGVzID0gbnVsbDtcbiAgICBpZiAoIXdhc0J1aWx0KSByZXR1cm47XG5cbiAgICBmb3IgKGNvbnN0IFtwYXRoLCBlbnRyeV0gb2YgdGhpcy5lbnRyaWVzKSB7XG4gICAgICBpZiAoIXNhbWVFbnRyeShwcmV2aW91cy5nZXQocGF0aCksIGVudHJ5KSkgdGhpcy5wZW5kaW5nUGF0aHMuYWRkKHBhdGgpO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IHBhdGggb2YgcHJldmlvdXMua2V5cygpKSB7XG4gICAgICBpZiAoIXRoaXMuZW50cmllcy5oYXMocGF0aCkpIHRoaXMucGVuZGluZ1BhdGhzLmFkZChwYXRoKTtcbiAgICB9XG4gICAgaWYgKHRoaXMucGVuZGluZ1BhdGhzLnNpemUgPiAwKSB0aGlzLmZsdXNoKCk7XG4gIH1cblxuICBtYXJrQ2hhbmdlZChwYXRoKSB7XG4gICAgdGhpcy5hZ2dyZWdhdGVzID0gbnVsbDtcbiAgICB0aGlzLnBlbmRpbmdQYXRocy5hZGQocGF0aCk7XG4gICAgdGhpcy5mbHVzaCgpO1xuICB9XG5cbiAgdXBkYXRlKGZpbGUpIHtcbiAgICAvLyBCZWZvcmUgdGhlIGZpcnN0IGFjY2VzcyB0aGVyZSBpcyBub3RoaW5nIHN0YWxlOyB0aGUgbGF6eSBidWlsZCByZWFkc1xuICAgIC8vIGZyZXNoIGZyb20gdGhlIGNhY2hlIGFueXdheS5cbiAgICBpZiAoIXRoaXMuYnVpbHQgfHwgIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpIHx8IGZpbGUuZXh0ZW5zaW9uICE9PSBcIm1kXCIpIHJldHVybjtcbiAgICBjb25zdCBuZXh0ID0gdGhpcy5yZWFkKGZpbGUpO1xuICAgIGlmIChzYW1lRW50cnkodGhpcy5lbnRyaWVzLmdldChmaWxlLnBhdGgpLCBuZXh0KSkgcmV0dXJuO1xuICAgIHRoaXMuZW50cmllcy5zZXQoZmlsZS5wYXRoLCBuZXh0KTtcbiAgICB0aGlzLm1hcmtDaGFuZ2VkKGZpbGUucGF0aCk7XG4gIH1cblxuICByZW1vdmUocGF0aCkge1xuICAgIGlmICghdGhpcy5idWlsdCB8fCAhdGhpcy5lbnRyaWVzLmRlbGV0ZShwYXRoKSkgcmV0dXJuO1xuICAgIHRoaXMubWFya0NoYW5nZWQocGF0aCk7XG4gIH1cblxuICByZW5hbWUoZmlsZSwgb2xkUGF0aCkge1xuICAgIGlmICghdGhpcy5idWlsdCkgcmV0dXJuO1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5lbnRyaWVzLmdldChvbGRQYXRoKTtcbiAgICBpZiAoZW50cnkpIHtcbiAgICAgIHRoaXMuZW50cmllcy5kZWxldGUob2xkUGF0aCk7XG4gICAgICB0aGlzLm1hcmtDaGFuZ2VkKG9sZFBhdGgpO1xuICAgIH1cbiAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlICYmIGZpbGUuZXh0ZW5zaW9uID09PSBcIm1kXCIpIHtcbiAgICAgIHRoaXMuZW50cmllcy5zZXQoZmlsZS5wYXRoLCBlbnRyeSA/PyB0aGlzLnJlYWQoZmlsZSkpO1xuICAgICAgdGhpcy5tYXJrQ2hhbmdlZChmaWxlLnBhdGgpO1xuICAgIH1cbiAgfVxuXG4gIGVudHJ5Rm9yKGZpbGUpIHtcbiAgICBpZiAoIWZpbGUpIHJldHVybiBFTVBUWV9FTlRSWTtcbiAgICB0aGlzLmVuc3VyZUJ1aWx0KCk7XG4gICAgcmV0dXJuIHRoaXMuZW50cmllcy5nZXQoZmlsZS5wYXRoKSA/PyBFTVBUWV9FTlRSWTtcbiAgfVxuXG4gIC8vIFRZUCBrZXkgKHNlZSB0eXBLZXlPZikgb3IgbnVsbDsgZm9yIGEgY2xlYW4gdmFsdWUgc2ltcGx5IHRoZSBUWVAgbmFtZS5cbiAgdHlwT2YoZmlsZSkge1xuICAgIHJldHVybiB0aGlzLmVudHJ5Rm9yKGZpbGUpLnR5cEtleTtcbiAgfVxuXG4gIC8vIFNVQlRZUCBrZXkgKHNlZSB0eXBLZXlPZikgb3IgbnVsbC5cbiAgc3VidHlwT2YoZmlsZSkge1xuICAgIHJldHVybiB0aGlzLmVudHJ5Rm9yKGZpbGUpLnN1YnR5cEtleTtcbiAgfVxuXG4gIC8vIEFuIGFjdHVhbCBmcm9udG1hdHRlciB2YWx1ZSBmb3IgYSBrZXkgLSBmb3IgZGlzcGxheSwgc2VhcmNoIGFuZCBjbGVhbmluZ1xuICAvLyB1cCB1bnJlZ2lzdGVyZWQgZW50cmllcyAoYWxsIG5vdGVzIG9mIGEga2V5IHNoYXJlIHRoZSBzYW1lIHJhdyBmb3JtKS5cbiAgcmF3VmFsdWVPZih0eXBLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5hZ2dyZWdhdGUoKS5yYXdCeUtleS5nZXQodHlwS2V5KTtcbiAgfVxuXG4gIC8vIENsZWFuID0gYSBzaW5nbGUgdmFsdWUgd2l0aG91dCBwYWRkaW5nLiBMb3dlcmNhc2UgY291bnRzIGFzIGNsZWFuIChhIHZhbGlkXG4gIC8vIFRZUCBuYW1lLCBqdXN0IG5vdCByZWdpc3RlcmVkIHlldCk7IGxpc3RzIGFuZCBwYWRkaW5nIGRvbid0LlxuICBpc0NsZWFuS2V5KHR5cEtleSkge1xuICAgIGNvbnN0IHJhdyA9IHRoaXMucmF3VmFsdWVPZih0eXBLZXkpO1xuICAgIHJldHVybiByYXcgIT09IHVuZGVmaW5lZCAmJiAhQXJyYXkuaXNBcnJheShyYXcpICYmIHR5cEtleSA9PT0gdHlwS2V5LnRyaW0oKTtcbiAgfVxuXG4gIC8vIEZpbGVzIHdpdGggZXhhY3RseSB0aGlzIFRZUCBrZXksIGhvbm9yaW5nIHRoZSBleGNsdWRlZC1maWxlcyBzZXR0aW5nLlxuICBmaWxlc1dpdGhUeXAodHlwS2V5KSB7XG4gICAgcmV0dXJuIHRoaXMuZmlsZXNNYXRjaGluZygoZW50cnkpID0+IGVudHJ5LnR5cEtleSA9PT0gdHlwS2V5KTtcbiAgfVxuXG4gIC8vIEZpbGVzIHdpdGggZXhhY3RseSB0aGlzIFRZUCBhbmQgU1VCVFlQIGtleS5cbiAgZmlsZXNXaXRoU3VidHlwKHR5cEtleSwgc3VidHlwS2V5KSB7XG4gICAgcmV0dXJuIHRoaXMuZmlsZXNNYXRjaGluZygoZW50cnkpID0+IGVudHJ5LnR5cEtleSA9PT0gdHlwS2V5ICYmIGVudHJ5LnN1YnR5cEtleSA9PT0gc3VidHlwS2V5KTtcbiAgfVxuXG4gIGZpbGVzTWF0Y2hpbmcocHJlZGljYXRlKSB7XG4gICAgdGhpcy5lbnN1cmVCdWlsdCgpO1xuICAgIGNvbnN0IGluY2x1ZGVJZ25vcmVkID0gISF0aGlzLnBsdWdpbi5zZXR0aW5ncy5pbmNsdWRlSWdub3JlZEZpbGVzO1xuICAgIGNvbnN0IGZpbGVzID0gW107XG4gICAgZm9yIChjb25zdCBbcGF0aCwgZW50cnldIG9mIHRoaXMuZW50cmllcykge1xuICAgICAgaWYgKCFwcmVkaWNhdGUoZW50cnkpKSBjb250aW51ZTtcbiAgICAgIGlmICghaW5jbHVkZUlnbm9yZWQgJiYgdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5pc1VzZXJJZ25vcmVkKHBhdGgpKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgocGF0aCk7XG4gICAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSBmaWxlcy5wdXNoKGZpbGUpO1xuICAgIH1cbiAgICByZXR1cm4gZmlsZXM7XG4gIH1cblxuICAvLyBIb25vcnMgT2JzaWRpYW4ncyBcIkV4Y2x1ZGVkIGZpbGVzXCIgKHdoZXJlIEhpZGUgRm9sZGVycyBhbHNvIHB1dHMgaGlkZGVuXG4gIC8vIGZvbGRlcnMpIHVubGVzcyBcIkluY2x1ZGUgZXhjbHVkZWQgZmlsZXNcIiBpcyBvbi4gQSBub3RlIHdpdGhvdXQgYSBUWVAgaGFzXG4gIC8vIG5vIFNVQlRZUCBjb250ZXh0LlxuICBhZ2dyZWdhdGUoKSB7XG4gICAgdGhpcy5lbnN1cmVCdWlsdCgpO1xuICAgIGNvbnN0IGluY2x1ZGVJZ25vcmVkID0gISF0aGlzLnBsdWdpbi5zZXR0aW5ncy5pbmNsdWRlSWdub3JlZEZpbGVzO1xuICAgIGlmICh0aGlzLmFnZ3JlZ2F0ZXM/LmluY2x1ZGVJZ25vcmVkID09PSBpbmNsdWRlSWdub3JlZCkgcmV0dXJuIHRoaXMuYWdncmVnYXRlcztcblxuICAgIGNvbnN0IGNvdW50cyA9IG5ldyBNYXAoKTtcbiAgICBjb25zdCByYXdCeUtleSA9IG5ldyBNYXAoKTtcbiAgICBjb25zdCBzdWJ0eXBzQnlUeXAgPSBuZXcgTWFwKCk7XG4gICAgbGV0IG5vVHlwID0gMDtcbiAgICBmb3IgKGNvbnN0IFtwYXRoLCB7IHR5cEtleSwgcmF3VHlwLCBzdWJ0eXBLZXksIHJhd1N1YnR5cCB9XSBvZiB0aGlzLmVudHJpZXMpIHtcbiAgICAgIGlmICghaW5jbHVkZUlnbm9yZWQgJiYgdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5pc1VzZXJJZ25vcmVkKHBhdGgpKSBjb250aW51ZTtcbiAgICAgIGlmICh0eXBLZXkgPT09IG51bGwpIHtcbiAgICAgICAgbm9UeXArKztcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb3VudHMuc2V0KHR5cEtleSwgKGNvdW50cy5nZXQodHlwS2V5KSA/PyAwKSArIDEpO1xuICAgICAgaWYgKCFyYXdCeUtleS5oYXModHlwS2V5KSkgcmF3QnlLZXkuc2V0KHR5cEtleSwgcmF3VHlwKTtcbiAgICAgIGxldCBidWNrZXQgPSBzdWJ0eXBzQnlUeXAuZ2V0KHR5cEtleSk7XG4gICAgICBpZiAoIWJ1Y2tldCkge1xuICAgICAgICBidWNrZXQgPSB7IGNvdW50czogbmV3IE1hcCgpLCBub1N1YnR5cDogMCwgcmF3QnlLZXk6IG5ldyBNYXAoKSB9O1xuICAgICAgICBzdWJ0eXBzQnlUeXAuc2V0KHR5cEtleSwgYnVja2V0KTtcbiAgICAgIH1cbiAgICAgIGlmIChzdWJ0eXBLZXkgPT09IG51bGwpIHtcbiAgICAgICAgYnVja2V0Lm5vU3VidHlwKys7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBidWNrZXQuY291bnRzLnNldChzdWJ0eXBLZXksIChidWNrZXQuY291bnRzLmdldChzdWJ0eXBLZXkpID8/IDApICsgMSk7XG4gICAgICAgIGlmICghYnVja2V0LnJhd0J5S2V5LmhhcyhzdWJ0eXBLZXkpKSBidWNrZXQucmF3QnlLZXkuc2V0KHN1YnR5cEtleSwgcmF3U3VidHlwKTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5hZ2dyZWdhdGVzID0geyBpbmNsdWRlSWdub3JlZCwgY291bnRzLCBub1R5cCwgcmF3QnlLZXksIHN1YnR5cHNCeVR5cCB9O1xuICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZXM7XG4gIH1cblxuICAvLyBDYWNoZWQgLSBkb24ndCBtb2RpZnkgdGhlIHJldHVybmVkIG1hcHMuXG4gIHR5cENvdW50cygpIHtcbiAgICBjb25zdCB7IGNvdW50cywgbm9UeXAgfSA9IHRoaXMuYWdncmVnYXRlKCk7XG4gICAgcmV0dXJuIHsgY291bnRzLCBub1R5cCB9O1xuICB9XG5cbiAgLy8gVFlQIC0+IHsgY291bnRzOiBNYXAoU1VCVFlQIGtleSAtPiBjb3VudCksIG5vU3VidHlwLCByYXdCeUtleSB9LlxuICAvLyBDYWNoZWQgLSBkb24ndCBtb2RpZnkuXG4gIHN1YnR5cENvdW50cygpIHtcbiAgICByZXR1cm4gdGhpcy5hZ2dyZWdhdGUoKS5zdWJ0eXBzQnlUeXA7XG4gIH1cblxuICBzdWJ0eXBCdWNrZXQodHlwS2V5KSB7XG4gICAgcmV0dXJuIHRoaXMuc3VidHlwQ291bnRzKCkuZ2V0KHR5cEtleSkgPz8gRU1QVFlfQlVDS0VUO1xuICB9XG59XG5cbmNvbnN0IEVNUFRZX0JVQ0tFVCA9IE9iamVjdC5mcmVlemUoeyBjb3VudHM6IG5ldyBNYXAoKSwgbm9TdWJ0eXA6IDAsIHJhd0J5S2V5OiBuZXcgTWFwKCkgfSk7XG5cbm1vZHVsZS5leHBvcnRzID0geyBUeXBJbmRleCwgdHlwS2V5T2YsIHByb3BlcnR5VmFsdWUsIHNldENhbm9uaWNhbFByb3BlcnR5LCBkZWxldGVQcm9wZXJ0eSwgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFkgfTtcbiIsICJjb25zdCB7IHR5cEtleU9mLCBwcm9wZXJ0eVZhbHVlLCBzZXRDYW5vbmljYWxQcm9wZXJ0eSwgU1VCVFlQX1BST1BFUlRZIH0gPSByZXF1aXJlKFwiLi90eXAtaW5kZXhcIik7XG5cbi8vIFN1YnR5cCBuYW1lcyBhcmUgdGl0bGUgY2FzZSBwZXIgd29yZCAodW5saWtlIFRZUCBuYW1lcywgc2VlXG4vLyBub3JtYWxpemVUeXBOYW1lKTogXCJrdXJ6IEdFU0NISUNIVEVcIiAtPiBcIkt1cnogR2VzY2hpY2h0ZVwiLiBUaGUgU1VCVFlQXG4vLyBwcm9wZXJ0eSBpdHNlbGYgc3RheXMgdXBwZXJjYXNlLiBcImRlXCIgbG9jYWxlIGJlY2F1c2UgdGhlIG5hbWVzIGFyZSBHZXJtYW4uXG5mdW5jdGlvbiBub3JtYWxpemVTdWJ0eXBOYW1lKHJhdykge1xuICByZXR1cm4gcmF3LnRyaW0oKS5yZXBsYWNlKC9cXFMrL2csICh3b3JkKSA9PiB3b3JkLmNoYXJBdCgwKS50b0xvY2FsZVVwcGVyQ2FzZShcImRlXCIpICsgd29yZC5zbGljZSgxKS50b0xvY2FsZUxvd2VyQ2FzZShcImRlXCIpKTtcbn1cblxuLy8gUmVnaXN0ZXJlZCBTdWJ0eXBzIHBlciBUWVAgKHNldHRpbmdzLnR5cFN1YnR5cHMpOlxuLy8gICB7IFtUWVBdOiB7IFtTVUJUWVBdOiB7IGZyb250bWF0dGVyOiB7Li4ufSwgZmxvYXRpbmdLZXlzOiBbLi4uXSwgc2hvcnRjdXRzOiB7Li4ufSwgbWFudWFsPzogZmFsc2UgfSB9IH1cbi8vIEEgU3VidHlwIGJlbG9uZ3MgdG8gZXhhY3RseSBvbmUgVFlQLCB0aG91Z2ggdGhlIHNhbWUgbmFtZSBtYXkgYWxzbyBleGlzdFxuLy8gdW5kZXIgYW5vdGhlciBUWVAuIEtleSBvcmRlciBpcyB0aGUgYmxvY2sgb3JkZXIgaW4gdGhlIFRZUC1QYW5lLCBhbHdheXNcbi8vIGJlbG93IHRoZSBUWVAtRnJvbnRtYXR0ZXIuIGZyb250bWF0dGVyIGFkZHMgdG8gb3Igb3ZlcnJpZGVzIHRoZVxuLy8gVFlQLUZyb250bWF0dGVyOyBmbG9hdGluZ0tleXMgYW5kIHNob3J0Y3V0cyB3b3JrIGxpa2UgdHlwRmxvYXRpbmdLZXlzIGFuZFxuLy8gdHlwU2hvcnRjdXRzLiBPbGRlciBkYXRhIGxhY2tzIHNob3J0Y3V0cywgc28gcmVhZGVycyB0cmVhdCBpdCBhcyBvcHRpb25hbC5cbi8vIG1hbnVhbCB3b3JrcyBsaWtlIHR5cE1hbnVhbDogb25seSB0aGUgZGV2aWF0aW9uIChmYWxzZSkgaXMgc3RvcmVkLlxuLy9cbi8vIFRoZSBzYW1lIGtleSBtYXkgYXBwZWFyIGluIHNldmVyYWwgYmxvY2tzIG9mIG9uZSBUWVAgKG9ubHkgd2l0aGluIE9ORSBibG9ja1xuLy8gaXMgaXQgbmVjZXNzYXJpbHkgdW5pcXVlKTpcbi8vICAgLSBpbiB0d28gU3VidHlwIGJsb2Nrczogbm8gY29uZmxpY3QsIGEgbm90ZSBoYXMgYXQgbW9zdCBvbmUgU1VCVFlQO1xuLy8gICAtIGluIHRoZSBUWVAtRnJvbnRtYXR0ZXIgQU5EIGEgU3VidHlwIGJsb2NrOiB0aGUgU3VidHlwIG92ZXJyaWRlcyB2YWx1ZVxuLy8gICAgIGFuZCBmbG9hdGluZyBmbGFnLCB0aGUgcm93IGtlZXBzIHRoZSBUWVAtRnJvbnRtYXR0ZXIgcG9zaXRpb24uIGdldFR5cERlZmF1bHRzXG4vLyAgICAgKG1haW4uanMpIGFuZCBvcmRlcmVkRGVmYXVsdEtleXMgKGZyb250bWF0dGVyLXNvcnQuanMpIG11c3QgdXNlIHRoZSBzYW1lXG4vLyAgICAgcnVsZSwgb3Igc29ydGluZyB3b3VsZCByZS1zb3J0IGEgZnJlc2hseSBjcmVhdGVkIG5vdGUgcmlnaHQgYXdheS5cblxuLy8gXCJTdGlsbCB0byBiZSBmaWxsZWRcIjogd2hlbiB0d28gYmxvY2tzIG9yIHR3byBwcm9wZXJ0aWVzIG1lcmdlLCBzdWNoIGEgdmFsdWVcbi8vIGlzIGZpbGxlZCBmcm9tIHRoZSBvdGhlciBpbnN0ZWFkIG9mIG92ZXJ3cml0aW5nIHRoZSBleGlzdGluZyBlbnRyeSAoc2VlXG4vLyBtZXJnZVN1YnR5cHMgaGVyZSBhbmQgcmVuYW1lSW5TdG9yZSBpbiBwcm9wZXJ0eS1yZW5hbWUtc3luYy5qcykuXG5mdW5jdGlvbiBpc0VtcHR5VmFsdWUodmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IFwiXCI7XG59XG5cbmZ1bmN0aW9uIGdldFN1YnR5cE5hbWVzKHNldHRpbmdzLCB0eXApIHtcbiAgcmV0dXJuIE9iamVjdC5rZXlzKHNldHRpbmdzLnR5cFN1YnR5cHM/Llt0eXBdID8/IHt9KTtcbn1cblxuZnVuY3Rpb24gZ2V0U3VidHlwKHNldHRpbmdzLCB0eXAsIHN1YnR5cCkge1xuICByZXR1cm4gc2V0dGluZ3MudHlwU3VidHlwcz8uW3R5cF0/LltzdWJ0eXBdID8/IG51bGw7XG59XG5cbmZ1bmN0aW9uIGVuc3VyZVN1YnR5cChzZXR0aW5ncywgdHlwLCBzdWJ0eXApIHtcbiAgaWYgKCFzZXR0aW5ncy50eXBTdWJ0eXBzKSBzZXR0aW5ncy50eXBTdWJ0eXBzID0ge307XG4gIGlmICghc2V0dGluZ3MudHlwU3VidHlwc1t0eXBdKSBzZXR0aW5ncy50eXBTdWJ0eXBzW3R5cF0gPSB7fTtcbiAgY29uc3QgYnlOYW1lID0gc2V0dGluZ3MudHlwU3VidHlwc1t0eXBdO1xuICBpZiAoIWJ5TmFtZVtzdWJ0eXBdKSB7XG4gICAgYnlOYW1lW3N1YnR5cF0gPSB7IGZyb250bWF0dGVyOiB7fSwgZmxvYXRpbmdLZXlzOiBbXSwgc2hvcnRjdXRzOiB7fSB9O1xuICAgIC8vIEEgbmV3IFN1YnR5cCBvZiBhIFRZUCB0aGF0IGlzbid0IG1hbnVhbGx5IGNyZWF0YWJsZSBpc24ndCBlaXRoZXIgKHNlZVxuICAgIC8vIGlzU3VidHlwTWFudWFsKS5cbiAgICBpZiAoc2V0dGluZ3MudHlwTWFudWFsPy5bdHlwXSA9PT0gZmFsc2UpIGJ5TmFtZVtzdWJ0eXBdLm1hbnVhbCA9IGZhbHNlO1xuICB9XG4gIHJldHVybiBieU5hbWVbc3VidHlwXTtcbn1cblxuLyogLS0tIFwiTWFudWFsbHkgY3JlYXRhYmxlXCIgcGVyIFN1YnR5cCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAqIExpa2UgdHlwTWFudWFsIGZvciBUWVAgZW50cmllczogb25seSBzd2l0Y2hpbmcgb2ZmIGlzIHN0b3JlZFxuICogKG1hbnVhbDogZmFsc2UpOyBubyBlbnRyeSBvciB0cnVlIG1lYW5zIG9uLiBEZWNpZGVzIHdoZXRoZXIgdGhlIFN1YnR5cFxuICogc2hvd3MgdXAgaW4gZ2V0U3VidHlwcygpIChtYWluLmpzKSBhbmQgdGh1cyBpbiB0aGUgU3VidHlwLVBpY2tlci5cbiAqXG4gKiBUWVAgYW5kIFN1YnR5cCBhcmUgbGlua2VkLCBiZWNhdXNlIHRoZSBwaWNrZXIgb25seSByZWFjaGVzIGEgU3VidHlwIHRocm91Z2hcbiAqIGl0cyBUWVA6IHN3aXRjaGluZyBhIFRZUCBvZmYgc3dpdGNoZXMgYWxsIGl0cyBTdWJ0eXBzIG9mZiwgc3dpdGNoaW5nIGl0IG9uXG4gKiBzd2l0Y2hlcyB0aGVtIGFsbCBvbiAoc2V0QWxsU3VidHlwc01hbnVhbCksIGFuZCBzd2l0Y2hpbmcgYSBzaW5nbGUgU3VidHlwIG9uXG4gKiBhbHNvIHN3aXRjaGVzIGl0cyBUWVAgb24sIGxlYXZpbmcgdGhlIG90aGVyIFN1YnR5cHMgYWxvbmUgKHNlZVxuICogcmVuZGVyU3VidHlwTWFudWFsVG9nZ2xlIGluIHR5cC1wYW5lLmpzKS4gU28gYSBTdWJ0eXAgaXMgb25seSBldmVyIG1hbnVhbGx5XG4gKiBjcmVhdGFibGUgaWYgaXRzIFRZUCBpcy5cbiAqIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuZnVuY3Rpb24gaXNTdWJ0eXBNYW51YWwoc2V0dGluZ3MsIHR5cCwgc3VidHlwKSB7XG4gIHJldHVybiBnZXRTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgc3VidHlwKT8ubWFudWFsICE9PSBmYWxzZTtcbn1cblxuZnVuY3Rpb24gc2V0U3VidHlwTWFudWFsKHNldHRpbmdzLCB0eXAsIHN1YnR5cCwgb24pIHtcbiAgY29uc3QgZGF0YSA9IGdldFN1YnR5cChzZXR0aW5ncywgdHlwLCBzdWJ0eXApO1xuICBpZiAoIWRhdGEpIHJldHVybjtcbiAgaWYgKG9uKSBkZWxldGUgZGF0YS5tYW51YWw7XG4gIGVsc2UgZGF0YS5tYW51YWwgPSBmYWxzZTtcbn1cblxuZnVuY3Rpb24gc2V0QWxsU3VidHlwc01hbnVhbChzZXR0aW5ncywgdHlwLCBvbikge1xuICBmb3IgKGNvbnN0IHN1YnR5cCBvZiBnZXRTdWJ0eXBOYW1lcyhzZXR0aW5ncywgdHlwKSkgc2V0U3VidHlwTWFudWFsKHNldHRpbmdzLCB0eXAsIHN1YnR5cCwgb24pO1xufVxuXG4vLyBXaGVuIGEgVFlQIGlzIHJlbmFtZWQsIGl0cyBTdWJ0eXBzIG1vdmUgdG8gdGhlIG5ldyBuYW1lLlxuZnVuY3Rpb24gbW92ZVR5cFN1YnR5cHMoc2V0dGluZ3MsIG9sZFR5cCwgbmV3VHlwKSB7XG4gIGlmICghc2V0dGluZ3MudHlwU3VidHlwcz8uW29sZFR5cF0pIHJldHVybjtcbiAgc2V0dGluZ3MudHlwU3VidHlwc1tuZXdUeXBdID0gc2V0dGluZ3MudHlwU3VidHlwc1tvbGRUeXBdO1xuICBkZWxldGUgc2V0dGluZ3MudHlwU3VidHlwc1tvbGRUeXBdO1xufVxuXG5mdW5jdGlvbiBkZWxldGVUeXBTdWJ0eXBzKHNldHRpbmdzLCB0eXApIHtcbiAgaWYgKHNldHRpbmdzLnR5cFN1YnR5cHMpIGRlbGV0ZSBzZXR0aW5ncy50eXBTdWJ0eXBzW3R5cF07XG59XG5cbi8vIE1lcmdpbmcgdHdvIFRZUCBlbnRyaWVzOiBTdWJ0eXBzIG9ubHkgaW4gc291cmNlIG1vdmUgb3Zlci4gQmxvY2tzIHdpdGggdGhlXG4vLyBzYW1lIG5hbWUgYXJlIGNvbWJpbmVkIC0gZm9yIGEgc2hhcmVkIGtleSB0aGUgdGFyZ2V0J3MgdmFsdWUgYW5kIGZsb2F0aW5nXG4vLyBmbGFnIHdpbiwga2V5cyBvbmx5IGluIHNvdXJjZSBhcmUgYXBwZW5kZWQuIEEgbW92ZWQga2V5IHRoYXQgaXMgYWxzbyBpbiB0aGVcbi8vIHRhcmdldCdzIFRZUC1Gcm9udG1hdHRlciBzdGF5cyBpbiBib3RoLCB3aGljaCBpcyB0aGUgbm9ybWFsIG92ZXJyaWRlLlxuZnVuY3Rpb24gbWVyZ2VUeXBTdWJ0eXBzKHNldHRpbmdzLCBzb3VyY2UsIHRhcmdldCkge1xuICBjb25zdCBzb3VyY2VTdWJ0eXBzID0gc2V0dGluZ3MudHlwU3VidHlwcz8uW3NvdXJjZV07XG4gIGlmICghc291cmNlU3VidHlwcykgcmV0dXJuO1xuICBmb3IgKGNvbnN0IFtuYW1lLCBzb3VyY2VEYXRhXSBvZiBPYmplY3QuZW50cmllcyhzb3VyY2VTdWJ0eXBzKSkge1xuICAgIGNvbnN0IHRhcmdldERhdGEgPSBnZXRTdWJ0eXAoc2V0dGluZ3MsIHRhcmdldCwgbmFtZSk7XG4gICAgaWYgKCF0YXJnZXREYXRhKSB7XG4gICAgICBlbnN1cmVTdWJ0eXAoc2V0dGluZ3MsIHRhcmdldCwgbmFtZSk7XG4gICAgICBzZXR0aW5ncy50eXBTdWJ0eXBzW3RhcmdldF1bbmFtZV0gPSBzb3VyY2VEYXRhO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IHRhcmdldExvd2VyID0gbmV3IFNldChPYmplY3Qua2V5cyh0YXJnZXREYXRhLmZyb250bWF0dGVyKS5tYXAoKGtleSkgPT4ga2V5LnRvTG93ZXJDYXNlKCkpKTtcbiAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzb3VyY2VEYXRhLmZyb250bWF0dGVyKSkge1xuICAgICAgaWYgKGtleSA9PT0gXCJcIiB8fCB0YXJnZXRMb3dlci5oYXMoa2V5LnRvTG93ZXJDYXNlKCkpKSBjb250aW51ZTtcbiAgICAgIHRhcmdldERhdGEuZnJvbnRtYXR0ZXJba2V5XSA9IHZhbHVlO1xuICAgICAgaWYgKHNvdXJjZURhdGEuZmxvYXRpbmdLZXlzLmluY2x1ZGVzKGtleSkpIHRhcmdldERhdGEuZmxvYXRpbmdLZXlzLnB1c2goa2V5KTtcbiAgICAgIC8vIFRoZSBzaG9ydGN1dCBiZWxvbmdzIHRvIHRoZSBrZXkgYW5kIG1vdmVzIHdpdGggaXQuXG4gICAgICBjb25zdCBzaG9ydGN1dCA9IHNvdXJjZURhdGEuc2hvcnRjdXRzPy5ba2V5XTtcbiAgICAgIGlmIChzaG9ydGN1dCkgKHRhcmdldERhdGEuc2hvcnRjdXRzID8/PSB7fSlba2V5XSA9IHNob3J0Y3V0O1xuICAgIH1cbiAgfVxuICBkZWxldGUgc2V0dGluZ3MudHlwU3VidHlwc1tzb3VyY2VdO1xufVxuXG4vLyBSZW5hbWVzIGEgU3VidHlwIHdpdGhpbiBpdHMgVFlQOyB0aGUgYmxvY2sga2VlcHMgaXRzIHBvc2l0aW9uIChkaXNwbGF5XG4vLyBvcmRlciA9IGtleSBvcmRlcikuXG5mdW5jdGlvbiByZW5hbWVTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgb2xkTmFtZSwgbmV3TmFtZSkge1xuICBjb25zdCBieU5hbWUgPSBzZXR0aW5ncy50eXBTdWJ0eXBzPy5bdHlwXTtcbiAgaWYgKCFieU5hbWU/LltvbGROYW1lXSB8fCBvbGROYW1lID09PSBuZXdOYW1lKSByZXR1cm47XG4gIHNldHRpbmdzLnR5cFN1YnR5cHNbdHlwXSA9IE9iamVjdC5mcm9tRW50cmllcyhcbiAgICBPYmplY3QuZW50cmllcyhieU5hbWUpLm1hcCgoW25hbWUsIGRhdGFdKSA9PiBbbmFtZSA9PT0gb2xkTmFtZSA/IG5ld05hbWUgOiBuYW1lLCBkYXRhXSlcbiAgKTtcbn1cblxuLy8gT3JkZXIgb2YgYWxsIGJsb2NrcyBvZiBhIFRZUCwgbnVsbCA9IFRZUC1Gcm9udG1hdHRlciAoYWx3YXlzIGZpcnN0KSwgdGhlblxuLy8gdGhlIFN1YnR5cHMgaW4ga2V5IG9yZGVyLiBEcml2ZXMgdGhlIFRZUC1QYW5lIGFzIHdlbGwgYXMgZnJvbnRtYXR0ZXJcbi8vIHNvcnRpbmcgKHNlZSBvcmRlcmVkRGVmYXVsdEtleXMpLlxuZnVuY3Rpb24gZ2V0U2VjdGlvbk9yZGVyKHNldHRpbmdzLCB0eXApIHtcbiAgcmV0dXJuIFtudWxsLCAuLi5nZXRTdWJ0eXBOYW1lcyhzZXR0aW5ncywgdHlwKV07XG59XG5cbi8vIE5ldyBibG9jayBvcmRlciBmcm9tIGRyYWcgJiBkcm9wIGluIHRoZSBUWVAtUGFuZSwgc2hhcGVkIGxpa2Vcbi8vIGdldFNlY3Rpb25PcmRlcjsgdGhlIGxlYWRpbmcgbnVsbCBpcyBpZ25vcmVkICh0aGUgVFlQLUZyb250bWF0dGVyIGNhbid0XG4vLyBtb3ZlKS4gU3VidHlwcyBub3QgbGlzdGVkIHN0YXkgYXQgdGhlIGVuZC5cbmZ1bmN0aW9uIHJlb3JkZXJTdWJ0eXBzKHNldHRpbmdzLCB0eXAsIG9yZGVyKSB7XG4gIGNvbnN0IGJ5TmFtZSA9IHNldHRpbmdzLnR5cFN1YnR5cHM/Llt0eXBdO1xuICBpZiAoIWJ5TmFtZSkgcmV0dXJuO1xuICBjb25zdCBuYW1lcyA9IG9yZGVyLmZpbHRlcigobmFtZSkgPT4gbmFtZSAhPT0gbnVsbCAmJiBieU5hbWVbbmFtZV0pO1xuICBjb25zdCBvcmRlcmVkID0gWy4uLm5hbWVzLCAuLi5PYmplY3Qua2V5cyhieU5hbWUpLmZpbHRlcigobmFtZSkgPT4gIW5hbWVzLmluY2x1ZGVzKG5hbWUpKV07XG4gIHNldHRpbmdzLnR5cFN1YnR5cHNbdHlwXSA9IE9iamVjdC5mcm9tRW50cmllcyhvcmRlcmVkLm1hcCgobmFtZSkgPT4gW25hbWUsIGJ5TmFtZVtuYW1lXV0pKTtcbn1cblxuZnVuY3Rpb24gZGVsZXRlU3VidHlwKHNldHRpbmdzLCB0eXAsIG5hbWUpIHtcbiAgY29uc3QgYnlOYW1lID0gc2V0dGluZ3MudHlwU3VidHlwcz8uW3R5cF07XG4gIGlmICghYnlOYW1lKSByZXR1cm47XG4gIGRlbGV0ZSBieU5hbWVbbmFtZV07XG4gIGlmIChPYmplY3Qua2V5cyhieU5hbWUpLmxlbmd0aCA9PT0gMCkgZGVsZXRlIHNldHRpbmdzLnR5cFN1YnR5cHNbdHlwXTtcbn1cblxuLy8gTWVyZ2luZyB0d28gU3VidHlwcyBvZiBvbmUgVFlQOiBzb3VyY2UncyBwcm9wZXJ0aWVzIGdvIHRvIHRoZSBlbmQgb2YgdGhlXG4vLyB0YXJnZXQgYmxvY2ssIHNvdXJjZSBkaXNhcHBlYXJzLiBJZiB0aGUgdGFyZ2V0IGFscmVhZHkgaGFzIGEga2V5LCBpdCBrZWVwc1xuLy8gcG9zaXRpb24sIHZhbHVlIGFuZCBmbG9hdGluZyBmbGFnOyBvbmx5IGFuIGVtcHR5IHRhcmdldCB2YWx1ZSBpcyBmaWxsZWRcbi8vIGZyb20gc291cmNlIChzYW1lIHBhdHRlcm4gYXMgcmVuYW1lSW5TdG9yZSBpbiBwcm9wZXJ0eS1yZW5hbWUtc3luYy5qcykuXG5mdW5jdGlvbiBtZXJnZVN1YnR5cHMoc2V0dGluZ3MsIHR5cCwgc291cmNlLCB0YXJnZXQpIHtcbiAgY29uc3Qgc291cmNlRGF0YSA9IGdldFN1YnR5cChzZXR0aW5ncywgdHlwLCBzb3VyY2UpO1xuICBjb25zdCB0YXJnZXREYXRhID0gZ2V0U3VidHlwKHNldHRpbmdzLCB0eXAsIHRhcmdldCk7XG4gIGlmICghc291cmNlRGF0YSB8fCAhdGFyZ2V0RGF0YSB8fCBzb3VyY2UgPT09IHRhcmdldCkgcmV0dXJuO1xuXG4gIGNvbnN0IHRhcmdldEtleXMgPSBuZXcgTWFwKE9iamVjdC5rZXlzKHRhcmdldERhdGEuZnJvbnRtYXR0ZXIpLm1hcCgoa2V5KSA9PiBba2V5LnRvTG93ZXJDYXNlKCksIGtleV0pKTtcbiAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoc291cmNlRGF0YS5mcm9udG1hdHRlcikpIHtcbiAgICBpZiAoa2V5ID09PSBcIlwiKSBjb250aW51ZTtcbiAgICBjb25zdCBleGlzdGluZyA9IHRhcmdldEtleXMuZ2V0KGtleS50b0xvd2VyQ2FzZSgpKTtcbiAgICBpZiAoZXhpc3RpbmcgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGFyZ2V0RGF0YS5mcm9udG1hdHRlcltrZXldID0gdmFsdWU7XG4gICAgICB0YXJnZXRLZXlzLnNldChrZXkudG9Mb3dlckNhc2UoKSwga2V5KTtcbiAgICAgIGlmIChzb3VyY2VEYXRhLmZsb2F0aW5nS2V5cy5pbmNsdWRlcyhrZXkpICYmICF0YXJnZXREYXRhLmZsb2F0aW5nS2V5cy5pbmNsdWRlcyhrZXkpKSB0YXJnZXREYXRhLmZsb2F0aW5nS2V5cy5wdXNoKGtleSk7XG4gICAgICAvLyBUaGUgc2hvcnRjdXQgYmVsb25ncyB0byB0aGUga2V5IGFuZCBtb3ZlcyB3aXRoIGl0LlxuICAgICAgY29uc3Qgc2hvcnRjdXQgPSBzb3VyY2VEYXRhLnNob3J0Y3V0cz8uW2tleV07XG4gICAgICBpZiAoc2hvcnRjdXQpICh0YXJnZXREYXRhLnNob3J0Y3V0cyA/Pz0ge30pW2tleV0gPSBzaG9ydGN1dDtcbiAgICB9IGVsc2UgaWYgKGlzRW1wdHlWYWx1ZSh0YXJnZXREYXRhLmZyb250bWF0dGVyW2V4aXN0aW5nXSkpIHtcbiAgICAgIHRhcmdldERhdGEuZnJvbnRtYXR0ZXJbZXhpc3RpbmddID0gdmFsdWU7XG4gICAgfVxuICB9XG4gIGRlbGV0ZVN1YnR5cChzZXR0aW5ncywgdHlwLCBzb3VyY2UpO1xufVxuXG4vLyBSZXdyaXRlcyB0aGUgU1VCVFlQIG9mIGV2ZXJ5IG5vdGUgd2l0aCBUWVAga2V5IGB0eXBgIGFuZCBTVUJUWVAga2V5IG9sZEtleVxuLy8gdG8gdGhlIHNpbmdsZSB2YWx1ZSBuZXdWYWx1ZSAtIGxpa2UgcmVuYW1lVHlwSW5Ob3RlcygpIGluIHR5cC1wYW5lLmpzLlxuYXN5bmMgZnVuY3Rpb24gcmVuYW1lU3VidHlwSW5Ob3RlcyhwbHVnaW4sIHR5cCwgb2xkS2V5LCBuZXdWYWx1ZSkge1xuICBsZXQgY2hhbmdlZCA9IDA7XG4gIGZvciAoY29uc3QgZmlsZSBvZiBwbHVnaW4udHlwSW5kZXguZmlsZXNXaXRoU3VidHlwKHR5cCwgb2xkS2V5KSkge1xuICAgIGxldCBtYXRjaGVkID0gZmFsc2U7XG4gICAgYXdhaXQgcGx1Z2luLmFwcC5maWxlTWFuYWdlci5wcm9jZXNzRnJvbnRNYXR0ZXIoZmlsZSwgKGZyb250bWF0dGVyKSA9PiB7XG4gICAgICBpZiAodHlwS2V5T2YocHJvcGVydHlWYWx1ZShmcm9udG1hdHRlciwgU1VCVFlQX1BST1BFUlRZKSkgIT09IG9sZEtleSkgcmV0dXJuO1xuICAgICAgc2V0Q2Fub25pY2FsUHJvcGVydHkoZnJvbnRtYXR0ZXIsIFNVQlRZUF9QUk9QRVJUWSwgbmV3VmFsdWUpO1xuICAgICAgbWF0Y2hlZCA9IHRydWU7XG4gICAgfSk7XG4gICAgaWYgKG1hdGNoZWQpIGNoYW5nZWQrKztcbiAgfVxuICByZXR1cm4gY2hhbmdlZDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIG5vcm1hbGl6ZVN1YnR5cE5hbWUsXG4gIGlzRW1wdHlWYWx1ZSxcbiAgZ2V0U3VidHlwTmFtZXMsXG4gIGdldFN1YnR5cCxcbiAgZW5zdXJlU3VidHlwLFxuICBpc1N1YnR5cE1hbnVhbCxcbiAgc2V0U3VidHlwTWFudWFsLFxuICBzZXRBbGxTdWJ0eXBzTWFudWFsLFxuICBtb3ZlVHlwU3VidHlwcyxcbiAgZGVsZXRlVHlwU3VidHlwcyxcbiAgbWVyZ2VUeXBTdWJ0eXBzLFxuICByZW5hbWVTdWJ0eXAsXG4gIGdldFNlY3Rpb25PcmRlcixcbiAgcmVvcmRlclN1YnR5cHMsXG4gIGRlbGV0ZVN1YnR5cCxcbiAgbWVyZ2VTdWJ0eXBzLFxuICByZW5hbWVTdWJ0eXBJbk5vdGVzLFxufTtcbiIsICIvLyBTdGF0ZWxlc3MgaGVscGVycyBhcm91bmQgVFlQIG5hbWVzLCBzb3J0aW5nIGFuZCBtZXNzYWdlIHRleHQuXG5cbi8vIFRZUCBuYW1lcyB0eXBlZCBpbnRvIHRoZSBsaXN0IGFyZSBhbHdheXMgdXBwZXJjYXNlLiBWYWx1ZXMgd3JpdHRlbiBkaXJlY3RseVxuLy8gaW50byBhIG5vdGUncyBmcm9udG1hdHRlciBhcmUgbGVmdCBhbG9uZSAoc2VlIHRoZSB1bnJlZ2lzdGVyZWQgcm93cyBpblxuLy8gdHlwLXBhbmUuanMpLlxuZnVuY3Rpb24gbm9ybWFsaXplVHlwTmFtZShyYXcpIHtcbiAgcmV0dXJuIHJhdy50cmltKCkudG9VcHBlckNhc2UoKTtcbn1cblxuLy8gXCIxIG5vdGVcIiwgXCIzIG5vdGVzXCIuIHdvcmQgaXMgdGhlIEVuZ2xpc2ggc2luZ3VsYXI7IGlycmVndWxhciBwbHVyYWxzIGFyZVxuLy8gcGFzc2VkIGV4cGxpY2l0bHkuXG5mdW5jdGlvbiBwbHVyYWwoY291bnQsIHdvcmQsIHBsdXJhbFdvcmQgPSBgJHt3b3JkfXNgKSB7XG4gIHJldHVybiBgJHtjb3VudH0gJHtjb3VudCA9PT0gMSA/IHdvcmQgOiBwbHVyYWxXb3JkfWA7XG59XG5cbi8vIFwiYVwiLCBcImEgYW5kIGJcIiwgXCJhLCBiIGFuZCBjXCIuXG5mdW5jdGlvbiBqb2luQW5kKHBhcnRzKSB7XG4gIHJldHVybiBwYXJ0cy5sZW5ndGggPD0gMSA/IHBhcnRzLmpvaW4oXCJcIikgOiBgJHtwYXJ0cy5zbGljZSgwLCAtMSkuam9pbihcIiwgXCIpfSBhbmQgJHtwYXJ0c1twYXJ0cy5sZW5ndGggLSAxXX1gO1xufVxuXG4vLyBIdWUgKDAtMzYwXHUwMEIwKSBvZiBhIGhleCBjb2xvciwgc28gY29sb3JzIHNvcnQgYWxvbmcgdGhlIHNwZWN0cnVtIGluc3RlYWQgb2YgYnlcbi8vIGhleCBzdHJpbmcuIEFjaHJvbWF0aWMgY29sb3JzIChncmF5L2JsYWNrL3doaXRlKSBoYXZlIG5vIGh1ZSBhbmQgcmV0dXJuIG51bGw7XG4vLyBjb21wYXJlVHlwcyBrZWVwcyB0aGVtIGxhc3QgaW4gYm90aCBkaXJlY3Rpb25zLlxuZnVuY3Rpb24gaGV4VG9IdWUoaGV4KSB7XG4gIGNvbnN0IG1hdGNoID0gL14jPyhbMC05YS1mXXs2fSkkL2kuZXhlYyhoZXggPz8gXCJcIik7XG4gIGlmICghbWF0Y2gpIHJldHVybiBudWxsO1xuICBjb25zdCBpbnQgPSBwYXJzZUludChtYXRjaFsxXSwgMTYpO1xuICBjb25zdCByID0gKChpbnQgPj4gMTYpICYgMjU1KSAvIDI1NTtcbiAgY29uc3QgZyA9ICgoaW50ID4+IDgpICYgMjU1KSAvIDI1NTtcbiAgY29uc3QgYiA9IChpbnQgJiAyNTUpIC8gMjU1O1xuICBjb25zdCBtYXggPSBNYXRoLm1heChyLCBnLCBiKTtcbiAgY29uc3QgbWluID0gTWF0aC5taW4ociwgZywgYik7XG4gIGNvbnN0IGRlbHRhID0gbWF4IC0gbWluO1xuICBpZiAoZGVsdGEgPT09IDApIHJldHVybiBudWxsO1xuXG4gIGxldCBodWU7XG4gIGlmIChtYXggPT09IHIpIGh1ZSA9ICgoZyAtIGIpIC8gZGVsdGEpICUgNjtcbiAgZWxzZSBpZiAobWF4ID09PSBnKSBodWUgPSAoYiAtIHIpIC8gZGVsdGEgKyAyO1xuICBlbHNlIGh1ZSA9IChyIC0gZykgLyBkZWx0YSArIDQ7XG4gIGh1ZSAqPSA2MDtcbiAgcmV0dXJuIGh1ZSA8IDAgPyBodWUgKyAzNjAgOiBodWU7XG59XG5cbi8vIFNoYXJlZCBjb21wYXJpc29uIGZvciBUWVAgYW5kIFNVQlRZUCBsaXN0cy4gdHlwQ29sb3JzIG1heSBiZSBlbXB0eSAoYSBTdWJ0eXBcbi8vIGhhcyBubyBjb2xvciBvZiBpdHMgb3duKTsgdGhlIFwiY29sb3JcIiBtb2RlIGlzIHRoZW4gbmV2ZXIgc2VsZWN0ZWQuXG5mdW5jdGlvbiBjb21wYXJlVHlwcyhtb2RlLCBhLCBiLCBjb3VudHMsIHR5cENvbG9ycykge1xuICBjb25zdCBba2V5LCBkaXJdID0gbW9kZS5zcGxpdChcIi1cIik7XG4gIGxldCBjbXA7XG4gIGlmIChrZXkgPT09IFwiY291bnRcIikge1xuICAgIGNtcCA9IChjb3VudHMuZ2V0KGEpID8/IDApIC0gKGNvdW50cy5nZXQoYikgPz8gMCk7XG4gICAgaWYgKGRpciA9PT0gXCJkZXNjXCIpIGNtcCA9IC1jbXA7XG4gIH0gZWxzZSBpZiAoa2V5ID09PSBcImNvbG9yXCIpIHtcbiAgICBjb25zdCBodWVBID0gaGV4VG9IdWUodHlwQ29sb3JzW2FdID8/IG51bGwpO1xuICAgIGNvbnN0IGh1ZUIgPSBoZXhUb0h1ZSh0eXBDb2xvcnNbYl0gPz8gbnVsbCk7XG4gICAgLy8gQWNocm9tYXRpYyBjb2xvcnMgc3RheSBhdCB0aGUgZW5kIGluIGJvdGggZGlyZWN0aW9ucy5cbiAgICBpZiAoaHVlQSA9PT0gbnVsbCAmJiBodWVCID09PSBudWxsKSBjbXAgPSAwO1xuICAgIGVsc2UgaWYgKGh1ZUEgPT09IG51bGwpIGNtcCA9IDE7XG4gICAgZWxzZSBpZiAoaHVlQiA9PT0gbnVsbCkgY21wID0gLTE7XG4gICAgZWxzZSB7XG4gICAgICBjbXAgPSBodWVBIC0gaHVlQjtcbiAgICAgIGlmIChkaXIgPT09IFwiZGVzY1wiKSBjbXAgPSAtY21wO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBjbXAgPSBhLmxvY2FsZUNvbXBhcmUoYik7XG4gICAgaWYgKGRpciA9PT0gXCJkZXNjXCIpIGNtcCA9IC1jbXA7XG4gIH1cbiAgcmV0dXJuIGNtcCB8fCBhLmxvY2FsZUNvbXBhcmUoYik7XG59XG5cbi8vIFwibWFudWFsXCIga2VlcHMgdGhlIGdpdmVuIG9yZGVyOiBpdCBpcyB0aGUgc3RvcmVkIG9yZGVyIChzZXR0aW5ncy50eXBzLFxuLy8gcmVhcnJhbmdlZCBieSBkcmFnICYgZHJvcCksIHdoaWNoIG5vIHBhaXJ3aXNlIGNvbXBhcmlzb24gY291bGQgZGVyaXZlLlxuLy8gVXNlZCBieSBtYWluLmpzIChnZXRUeXBzKSBhbmQgdHlwLXBhbmUuanMgc28gYm90aCBzaG93IHRoZSBzYW1lIG9yZGVyLlxuZnVuY3Rpb24gc29ydFR5cHNCeU1vZGUodHlwcywgbW9kZSwgY291bnRzLCB0eXBDb2xvcnMpIHtcbiAgaWYgKG1vZGUgPT09IFwibWFudWFsXCIpIHJldHVybiBbLi4udHlwc107XG4gIHJldHVybiBbLi4udHlwc10uc29ydCgoYSwgYikgPT4gY29tcGFyZVR5cHMobW9kZSwgYSwgYiwgY291bnRzLCB0eXBDb2xvcnMpKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IG5vcm1hbGl6ZVR5cE5hbWUsIHBsdXJhbCwgam9pbkFuZCwgaGV4VG9IdWUsIGNvbXBhcmVUeXBzLCBzb3J0VHlwc0J5TW9kZSB9O1xuIiwgImNvbnN0IHsgZ2V0U3VidHlwIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBzXCIpO1xuY29uc3QgeyB0eXBLZXlPZiwgcHJvcGVydHlWYWx1ZSwgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcbmNvbnN0IHsgcGx1cmFsIH0gPSByZXF1aXJlKFwiLi90eXAtdXRpbHNcIik7XG5cbi8vIFRoZSBmb3VyIHBsYWNlaG9sZGVycyBvZiB0aGUgZ2xvYmFsIG9yZGVyOyB0aGUgb3JkZXIgZWRpdG9yIGxldHMgeW91IG1vdmVcbi8vIHRoZW0gYnV0IG5vdCByZW1vdmUgdGhlbS4gXCJ0eXBWYWx1ZVwiIGlzIHRoZSBUWVAgcHJvcGVydHkgaXRzZWxmLFxuLy8gXCJzdWJ0eXBWYWx1ZVwiIHRoZSBTVUJUWVAgcHJvcGVydHksIFwidHlwXCIgdGhlIFRZUC1Gcm9udG1hdHRlciBsaXN0LFxuLy8gXCJvdGhlclwiIGV2ZXJ5dGhpbmcgZWxzZS5cbmNvbnN0IERFRkFVTFRfR0xPQkFMX09SREVSID0gW3sga2luZDogXCJ0eXBWYWx1ZVwiIH0sIHsga2luZDogXCJzdWJ0eXBWYWx1ZVwiIH0sIHsga2luZDogXCJ0eXBcIiB9LCB7IGtpbmQ6IFwib3RoZXJcIiB9XTtcblxuLy8gRW5zdXJlcyBleGFjdGx5IG9uZSBlbnRyeSBwZXIgcGxhY2Vob2xkZXIuIE9sZGVyIHNhdmVkIG9yZGVycyBwcmVkYXRlIHNvbWVcbi8vIG9mIHRoZW07IG1pc3Npbmcgb25lcyBhcmUgYWRkZWQgYXQgYSBzZW5zaWJsZSBzcG90IChcInN1YnR5cFZhbHVlXCIgcmlnaHRcbi8vIGFmdGVyIFwidHlwVmFsdWVcIiwgdGhlIG90aGVycyBhdCB0aGUgZWRnZXMpIHdpdGhvdXQgdG91Y2hpbmcgdGhlIG9yZGVyIHRoZVxuLy8gdXNlciBhcnJhbmdlZC5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUdsb2JhbE9yZGVyKG9yZGVyKSB7XG4gIGNvbnN0IHJlc3VsdCA9IEFycmF5LmlzQXJyYXkob3JkZXIpID8gb3JkZXIuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkgJiYgdHlwZW9mIGVudHJ5ID09PSBcIm9iamVjdFwiKSA6IFtdO1xuICBjb25zdCBoYXNLaW5kID0gKGtpbmQpID0+IHJlc3VsdC5zb21lKChlbnRyeSkgPT4gZW50cnkua2luZCA9PT0ga2luZCk7XG4gIGlmICghaGFzS2luZChcInR5cFZhbHVlXCIpKSByZXN1bHQudW5zaGlmdCh7IGtpbmQ6IFwidHlwVmFsdWVcIiB9KTtcbiAgaWYgKCFoYXNLaW5kKFwic3VidHlwVmFsdWVcIikpIHtcbiAgICBjb25zdCB0eXBWYWx1ZUluZGV4ID0gcmVzdWx0LmZpbmRJbmRleCgoZW50cnkpID0+IGVudHJ5LmtpbmQgPT09IFwidHlwVmFsdWVcIik7XG4gICAgcmVzdWx0LnNwbGljZSh0eXBWYWx1ZUluZGV4ICsgMSwgMCwgeyBraW5kOiBcInN1YnR5cFZhbHVlXCIgfSk7XG4gIH1cbiAgaWYgKCFoYXNLaW5kKFwidHlwXCIpKSByZXN1bHQucHVzaCh7IGtpbmQ6IFwidHlwXCIgfSk7XG4gIGlmICghaGFzS2luZChcIm90aGVyXCIpKSByZXN1bHQucHVzaCh7IGtpbmQ6IFwib3RoZXJcIiB9KTtcbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gKiBGcm9udG1hdHRlciBzb3J0aW5nXG4gKiBQdXRzIHRoZSBwcm9wZXJ0aWVzIGEgbm90ZSBIQVMgaW50byBhIGZpeGVkIG9yZGVyIGJ1aWx0IGZyb21cbiAqIGdsb2JhbFByb3BlcnR5T3JkZXI6IHBpbm5lZCBzaW5nbGUgcHJvcGVydGllcywgdGhlIFRZUCBhbmRcbiAqIFNVQlRZUCBwcm9wZXJ0aWVzLCB0aGUgXCJUWVAtRnJvbnRtYXR0ZXJcIiBibG9jayAodGhlIFRZUCdzIGxpc3RcbiAqIGZvbGxvd2VkIGJ5IGl0cyBTdWJ0eXAgYmxvY2spIGFuZCBcIk90aGVyIHByb3BlcnRpZXNcIi4gTmV2ZXIgYWRkc1xuICogcHJvcGVydGllcyBvciBjaGFuZ2VzIHZhbHVlcy5cbiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqL1xuXG4vLyBLZXkgb3JkZXIgb2YgYSBUWVAncyBmcm9udG1hdHRlciwgZmxvYXRpbmcga2V5cyBpbmNsdWRlZCBhdCB0aGVpciBsaXN0XG4vLyBwb3NpdGlvbiAoZ2V0VHlwRGVmYXVsdHMgbGVhdmVzIHRoZW0gb3V0LCBidXQgYSBub3RlIHRoYXQgaGFzIG9uZSBzaG91bGRcbi8vIHN0aWxsIGdldCBpdCBpbiBwbGFjZSkuIFdpdGhvdXQgVFlQL1NVQlRZUCBhbmQgdGhlIGVkaXRvcidzIGJsYW5rIHJvdy5cbi8vIG51bGwgaWYgdGhlcmUgaXMgbm8gVFlQIG9yIG5vIGxpc3QuXG4vL1xuLy8gV2l0aCBzdWJ0eXAsIHRoZSBrZXlzIG9mIGl0cyBibG9jayBmb2xsb3cuIEEga2V5IGluIEJPVEggYmxvY2tzIGtlZXBzIHRoZVxuLy8gVFlQLUZyb250bWF0dGVyIHBvc2l0aW9uIC0gdGhlIHNhbWUgcnVsZSBhcyBjb2xsZWN0QmxvY2tzIGluIG1haW4uanMsIG9yIGFcbi8vIGZyZXNobHkgY3JlYXRlZCBub3RlIHdvdWxkIGJlIHJlLXNvcnRlZCByaWdodCBhd2F5LlxuZnVuY3Rpb24gb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgdHlwLCBzdWJ0eXAgPSBudWxsKSB7XG4gIGlmICghdHlwKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgaXNTeXN0ZW1LZXkgPSAoa2V5KSA9PiBrZXkgPT09IFwiXCIgfHwgW1RZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZXS5zb21lKChwKSA9PiBrZXkudG9Mb3dlckNhc2UoKSA9PT0gcC50b0xvd2VyQ2FzZSgpKTtcbiAgY29uc3Qgc3VidHlwRGF0YSA9IHN1YnR5cCA/IGdldFN1YnR5cChwbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKSA6IG51bGw7XG4gIGNvbnN0IGJsb2NrcyA9IFtwbHVnaW4uc2V0dGluZ3MudHlwRGVmYXVsdEZyb250bWF0dGVyW3R5cF0sIHN1YnR5cERhdGE/LmZyb250bWF0dGVyXTtcbiAgY29uc3Qga2V5cyA9IFtdO1xuICBjb25zdCBzZWVuID0gbmV3IFNldCgpO1xuICBmb3IgKGNvbnN0IGJsb2NrIG9mIGJsb2Nrcykge1xuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGJsb2NrID8/IHt9KSkge1xuICAgICAgaWYgKGlzU3lzdGVtS2V5KGtleSkgfHwgc2Vlbi5oYXMoa2V5LnRvTG93ZXJDYXNlKCkpKSBjb250aW51ZTtcbiAgICAgIGtleXMucHVzaChrZXkpO1xuICAgICAgc2Vlbi5hZGQoa2V5LnRvTG93ZXJDYXNlKCkpO1xuICAgIH1cbiAgfVxuICByZXR1cm4ga2V5cy5sZW5ndGggPiAwID8ga2V5cyA6IG51bGw7XG59XG5cbi8vIFRhcmdldCBvcmRlciBvZiBhIG5vdGUncyBleGlzdGluZyBwcm9wZXJ0aWVzLCBmdWxseSBkZWZpbmVkIGJ5IGdsb2JhbE9yZGVyLlxuLy9cbi8vIFdoaWNoIGJsb2NrIGNsYWltcyBhIHByb3BlcnR5IGlzIGRlY2lkZWQgQkVGT1JFIHRoZSBvcmRlciBpcyBidWlsdCAocGlubmVkLFxuLy8gVFlQIGJsb2NrIGFuZCByZXN0IGFyZSBkaXNqb2ludCksIHNvIHRoZSByZXN1bHQgZG9lc24ndCBkZXBlbmQgb24gd2hlcmUgdGhlXG4vLyBibG9ja3Mgc2l0IGluIGdsb2JhbE9yZGVyOiBhIHBpbm5lZCBwcm9wZXJ0eSBuZXZlciBhbHNvIGxhbmRzIGluIHRoZSBUWVBcbi8vIGJsb2NrLCBhbmQgXCJvdGhlclwiIG9ubHkgZXZlciBob2xkcyB0cnVlIGxlZnRvdmVycy5cbmZ1bmN0aW9uIGNvbXB1dGVTb3J0ZWRLZXlzKGV4aXN0aW5nS2V5cywgZ2xvYmFsT3JkZXIsIHR5cERlZmF1bHRLZXlzKSB7XG4gIGNvbnN0IGxvd2VyVG9BY3R1YWwgPSBuZXcgTWFwKGV4aXN0aW5nS2V5cy5tYXAoKGtleSkgPT4gW2tleS50b0xvd2VyQ2FzZSgpLCBrZXldKSk7XG4gIGNvbnN0IHJlc29sdmUgPSAobmFtZSkgPT4gbG93ZXJUb0FjdHVhbC5nZXQobmFtZS50b0xvd2VyQ2FzZSgpKTtcblxuICBjb25zdCBwaW5uZWQgPSBuZXcgU2V0KFxuICAgIGdsb2JhbE9yZGVyXG4gICAgICAuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkua2luZCA9PT0gXCJwcm9wZXJ0eVwiKVxuICAgICAgLm1hcCgoZW50cnkpID0+IHJlc29sdmUoZW50cnkubmFtZSkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICk7XG4gIGNvbnN0IHR5cEtleSA9IHJlc29sdmUoVFlQX1BST1BFUlRZKTtcbiAgY29uc3Qgc3VidHlwS2V5ID0gcmVzb2x2ZShTVUJUWVBfUFJPUEVSVFkpO1xuICBjb25zdCB0eXBCbG9ja0tleXMgPSBuZXcgU2V0KFxuICAgICh0eXBEZWZhdWx0S2V5cyA/PyBbXSkubWFwKHJlc29sdmUpLmZpbHRlcigoa2V5KSA9PiBrZXkgJiYga2V5ICE9PSB0eXBLZXkgJiYgIXBpbm5lZC5oYXMoa2V5KSlcbiAgKTtcbiAgY29uc3QgY2xhaW1lZCA9IG5ldyBTZXQocGlubmVkKTtcbiAgZm9yIChjb25zdCBrZXkgb2YgdHlwQmxvY2tLZXlzKSBjbGFpbWVkLmFkZChrZXkpO1xuICBpZiAodHlwS2V5KSBjbGFpbWVkLmFkZCh0eXBLZXkpO1xuICBpZiAoc3VidHlwS2V5KSBjbGFpbWVkLmFkZChzdWJ0eXBLZXkpO1xuXG4gIGNvbnN0IHNvcnRlZEtleXMgPSBbXTtcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQoKTtcbiAgY29uc3QgcHVzaCA9IChrZXkpID0+IHtcbiAgICBpZiAoa2V5ICYmICFzZWVuLmhhcyhrZXkpKSB7XG4gICAgICBzb3J0ZWRLZXlzLnB1c2goa2V5KTtcbiAgICAgIHNlZW4uYWRkKGtleSk7XG4gICAgfVxuICB9O1xuXG4gIGZvciAoY29uc3QgZW50cnkgb2YgZ2xvYmFsT3JkZXIpIHtcbiAgICBpZiAoZW50cnkua2luZCA9PT0gXCJwcm9wZXJ0eVwiKSBwdXNoKHJlc29sdmUoZW50cnkubmFtZSkpO1xuICAgIGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwidHlwVmFsdWVcIikgcHVzaCh0eXBLZXkpO1xuICAgIGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwic3VidHlwVmFsdWVcIikgcHVzaChzdWJ0eXBLZXkpO1xuICAgIGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwidHlwXCIpIHtcbiAgICAgIGZvciAoY29uc3QgbmFtZSBvZiB0eXBEZWZhdWx0S2V5cyA/PyBbXSkge1xuICAgICAgICBjb25zdCBrZXkgPSByZXNvbHZlKG5hbWUpO1xuICAgICAgICBpZiAoa2V5ICYmIHR5cEJsb2NrS2V5cy5oYXMoa2V5KSkgcHVzaChrZXkpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoZW50cnkua2luZCA9PT0gXCJvdGhlclwiKSB7XG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBleGlzdGluZ0tleXMpIHtcbiAgICAgICAgaWYgKCFjbGFpbWVkLmhhcyhrZXkpKSBwdXNoKGtleSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gU2FmZXR5IG5ldCBmb3IgYW4gaW5jb21wbGV0ZSBnbG9iYWxPcmRlciAoY29ycnVwdCBzZXR0aW5ncykuXG4gIGZvciAoY29uc3Qga2V5IG9mIGV4aXN0aW5nS2V5cykgcHVzaChrZXkpO1xuICByZXR1cm4gc29ydGVkS2V5cztcbn1cblxuLy8gXCJwb3NpdGlvblwiIGlzIE9ic2lkaWFuJ3MgbG9jYXRpb24gb2YgdGhlIGZyb250bWF0dGVyIGJsb2NrLCBwcmVzZW50IG9ubHkgaW5cbi8vIHRoZSBjYWNoZSBvYmplY3QsIG5vdCBhIHByb3BlcnR5LlxuZnVuY3Rpb24gY2FjaGVkRnJvbnRtYXR0ZXJLZXlzKGFwcCwgZmlsZSkge1xuICBjb25zdCBmcm9udG1hdHRlciA9IGFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXI7XG4gIGlmICghZnJvbnRtYXR0ZXIpIHJldHVybiBudWxsO1xuICByZXR1cm4gT2JqZWN0LmtleXMoZnJvbnRtYXR0ZXIpLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwicG9zaXRpb25cIik7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNvcnRGaWxlRnJvbnRtYXR0ZXIoYXBwLCBmaWxlLCBnbG9iYWxPcmRlciwgdHlwRGVmYXVsdEtleXMpIHtcbiAgLy8gQ2hlYXAgcHJlLWNoZWNrIGFnYWluc3QgdGhlIGluLW1lbW9yeSBjYWNoZTogbW9zdCBub3RlcyBhcmUgYWxyZWFkeVxuICAvLyBzb3J0ZWQsIGFuZCB0aGlzIHNraXBzIG9wZW5pbmcgdGhlbSBhdCBhbGwgLSB0aGF0IGlzIHdoZXJlIHJlcGVhdGVkIHZhdWx0XG4gIC8vIHJ1bnMgZ2V0IHRoZWlyIHNwZWVkLiBwcm9jZXNzRnJvbnRNYXR0ZXIgc3RheXMgdGhlIHNvdXJjZSBvZiB0cnV0aCBmb3IgdGhlXG4gIC8vIGFjdHVhbCB3cml0ZSwgc2luY2UgdGhlIGNhY2hlIGNhbiBsYWcgYmVoaW5kLlxuICBjb25zdCBjYWNoZWRLZXlzID0gY2FjaGVkRnJvbnRtYXR0ZXJLZXlzKGFwcCwgZmlsZSk7XG4gIGlmICghY2FjaGVkS2V5cyB8fCBjYWNoZWRLZXlzLmxlbmd0aCA8PSAxKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IGNhY2hlZFNvcnRlZCA9IGNvbXB1dGVTb3J0ZWRLZXlzKGNhY2hlZEtleXMsIGdsb2JhbE9yZGVyLCB0eXBEZWZhdWx0S2V5cyk7XG4gIGlmIChjYWNoZWRTb3J0ZWQuZXZlcnkoKGtleSwgaSkgPT4ga2V5ID09PSBjYWNoZWRLZXlzW2ldKSkgcmV0dXJuIGZhbHNlO1xuXG4gIGxldCBjaGFuZ2VkID0gZmFsc2U7XG4gIGF3YWl0IGFwcC5maWxlTWFuYWdlci5wcm9jZXNzRnJvbnRNYXR0ZXIoZmlsZSwgKGZyb250bWF0dGVyKSA9PiB7XG4gICAgY2hhbmdlZCA9IHNvcnRGcm9udG1hdHRlck9iamVjdChmcm9udG1hdHRlciwgZ2xvYmFsT3JkZXIsIHR5cERlZmF1bHRLZXlzKTtcbiAgfSk7XG4gIHJldHVybiBjaGFuZ2VkO1xufVxuXG4vLyBTb3J0cyB0aGUgcHJvY2Vzc0Zyb250TWF0dGVyIG9iamVjdCBpbiBwbGFjZTogaW5zZXJ0aW9uIG9yZGVyIGJlY29tZXMgdGhlXG4vLyBZQU1MIG9yZGVyLCBzbyBhbGwga2V5cyBhcmUgZGVsZXRlZCBhbmQgcmUtYWRkZWQuIFJldHVybnMgdHJ1ZSBvbiBhIGNoYW5nZS5cbmZ1bmN0aW9uIHNvcnRGcm9udG1hdHRlck9iamVjdChmcm9udG1hdHRlciwgZ2xvYmFsT3JkZXIsIHR5cERlZmF1bHRLZXlzKSB7XG4gIGNvbnN0IGV4aXN0aW5nS2V5cyA9IE9iamVjdC5rZXlzKGZyb250bWF0dGVyKTtcbiAgaWYgKGV4aXN0aW5nS2V5cy5sZW5ndGggPD0gMSkgcmV0dXJuIGZhbHNlO1xuXG4gIGNvbnN0IHNvcnRlZEtleXMgPSBjb21wdXRlU29ydGVkS2V5cyhleGlzdGluZ0tleXMsIGdsb2JhbE9yZGVyLCB0eXBEZWZhdWx0S2V5cyk7XG4gIGlmIChzb3J0ZWRLZXlzLmV2ZXJ5KChrZXksIGkpID0+IGtleSA9PT0gZXhpc3RpbmdLZXlzW2ldKSkgcmV0dXJuIGZhbHNlO1xuXG4gIGNvbnN0IHNuYXBzaG90ID0geyAuLi5mcm9udG1hdHRlciB9O1xuICBmb3IgKGNvbnN0IGtleSBvZiBleGlzdGluZ0tleXMpIGRlbGV0ZSBmcm9udG1hdHRlcltrZXldO1xuICBmb3IgKGNvbnN0IGtleSBvZiBzb3J0ZWRLZXlzKSBmcm9udG1hdHRlcltrZXldID0gc25hcHNob3Rba2V5XTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbi8vIEZvciBjYWxsZXJzIGFscmVhZHkgaW5zaWRlIHByb2Nlc3NGcm9udE1hdHRlciAoVFlQLmpzKTogVFlQIGFuZCBTdWJ0eXAgYXJlXG4vLyBwYXNzZWQgZXhwbGljaXRseSwgYmVjYXVzZSBpbmRleCBhbmQgY2FjaGUgZG9uJ3Qga25vdyB0aGUgdmFsdWVzIGp1c3Rcbi8vIHdyaXR0ZW4geWV0LlxuZnVuY3Rpb24gc29ydEZyb250bWF0dGVyRm9yKHBsdWdpbiwgZnJvbnRtYXR0ZXIsIHR5cCwgc3VidHlwKSB7XG4gIGNvbnN0IGdsb2JhbE9yZGVyID0gbm9ybWFsaXplR2xvYmFsT3JkZXIocGx1Z2luLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIpO1xuICByZXR1cm4gc29ydEZyb250bWF0dGVyT2JqZWN0KGZyb250bWF0dGVyLCBnbG9iYWxPcmRlciwgb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgdHlwLCBzdWJ0eXApKTtcbn1cblxuLy8gTW92ZXMgb25seSBga2V5YCB0byBpdHMgc29ydGVkIHBsYWNlIGFuZCBsZWF2ZXMgZXZlcnkgb3RoZXIga2V5IHdoZXJlIGl0IGlzXG4vLyAtIGZvciBjYWxsZXJzIHRoYXQganVzdCBhZGRlZCBhIHByb3BlcnR5IChGcmVkJ3MgcHJvcGVydHkgYmFja2xpbmtpbmcpIGFuZFxuLy8gc2hvdWxkbid0IHJlc2h1ZmZsZSBhIGRlbGliZXJhdGVseSBkaWZmZXJlbnQgb3JkZXIuIFRZUC9TVUJUWVAgYXJlIHJlYWQgZnJvbVxuLy8gdGhlIG9iamVjdCBpdHNlbGY7IGluZGV4IGFuZCBjYWNoZSBtYXkgc3RpbGwgYmUgYmVoaW5kLlxuLy9cbi8vIFRoZSBwbGFjZSBpcyByaWdodCBhZnRlciBrZXkncyBuZWFyZXN0IHByZWRlY2Vzc29yIGluIHRoZSBmdWxseSBzb3J0ZWRcbi8vIG9yZGVyIChmaXJzdCBpZiB0aGVyZSBpcyBub25lKS4gUmV0dXJucyB0cnVlIG9uIGEgY2hhbmdlLlxuZnVuY3Rpb24gcGxhY2VQcm9wZXJ0eUZvcihwbHVnaW4sIGZyb250bWF0dGVyLCBrZXkpIHtcbiAgY29uc3QgZXhpc3RpbmdLZXlzID0gT2JqZWN0LmtleXMoZnJvbnRtYXR0ZXIpO1xuICBjb25zdCBhY3R1YWxLZXkgPSBleGlzdGluZ0tleXMuZmluZCgoaykgPT4gay50b0xvd2VyQ2FzZSgpID09PSBrZXkudG9Mb3dlckNhc2UoKSk7XG4gIGlmICghYWN0dWFsS2V5IHx8IGV4aXN0aW5nS2V5cy5sZW5ndGggPD0gMSkgcmV0dXJuIGZhbHNlO1xuXG4gIGNvbnN0IGdsb2JhbE9yZGVyID0gbm9ybWFsaXplR2xvYmFsT3JkZXIocGx1Z2luLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIpO1xuICBjb25zdCB0eXAgPSB0eXBLZXlPZihwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBUWVBfUFJPUEVSVFkpKTtcbiAgY29uc3Qgc3VidHlwID0gdHlwS2V5T2YocHJvcGVydHlWYWx1ZShmcm9udG1hdHRlciwgU1VCVFlQX1BST1BFUlRZKSk7XG4gIGNvbnN0IHNvcnRlZEtleXMgPSBjb21wdXRlU29ydGVkS2V5cyhleGlzdGluZ0tleXMsIGdsb2JhbE9yZGVyLCBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCB0eXAsIHN1YnR5cCkpO1xuXG4gIGNvbnN0IHJlc3QgPSBleGlzdGluZ0tleXMuZmlsdGVyKChrKSA9PiBrICE9PSBhY3R1YWxLZXkpO1xuICBjb25zdCBwcmVkZWNlc3NvciA9IHNvcnRlZEtleXMuc2xpY2UoMCwgc29ydGVkS2V5cy5pbmRleE9mKGFjdHVhbEtleSkpLnBvcCgpO1xuICBjb25zdCBuZXdLZXlzID0gWy4uLnJlc3RdO1xuICBuZXdLZXlzLnNwbGljZShwcmVkZWNlc3NvciA9PT0gdW5kZWZpbmVkID8gMCA6IHJlc3QuaW5kZXhPZihwcmVkZWNlc3NvcikgKyAxLCAwLCBhY3R1YWxLZXkpO1xuICBpZiAobmV3S2V5cy5ldmVyeSgoaywgaSkgPT4gayA9PT0gZXhpc3RpbmdLZXlzW2ldKSkgcmV0dXJuIGZhbHNlO1xuXG4gIGNvbnN0IHNuYXBzaG90ID0geyAuLi5mcm9udG1hdHRlciB9O1xuICBmb3IgKGNvbnN0IGsgb2YgZXhpc3RpbmdLZXlzKSBkZWxldGUgZnJvbnRtYXR0ZXJba107XG4gIGZvciAoY29uc3QgayBvZiBuZXdLZXlzKSBmcm9udG1hdHRlcltrXSA9IHNuYXBzaG90W2tdO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc29ydFNpbmdsZUZpbGVGcm9udG1hdHRlcihhcHAsIHBsdWdpbiwgZmlsZSkge1xuICBjb25zdCBnbG9iYWxPcmRlciA9IG5vcm1hbGl6ZUdsb2JhbE9yZGVyKHBsdWdpbi5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyKTtcbiAgLy8gQW4gdW5jbGVhbiBUWVAgdmFsdWUgKGxpc3QsIHBhZGRlZCkgaGFzIG5vIFRZUC1Gcm9udG1hdHRlcjsgb25seSB0aGUgZ2xvYmFsXG4gIC8vIG9yZGVyIGFwcGxpZXMgdGhlbiAoc2VlIHR5cEtleU9mIGluIHR5cC1pbmRleC5qcykuXG4gIGNvbnN0IHR5cCA9IHBsdWdpbi50eXBJbmRleC50eXBPZihmaWxlKTtcbiAgY29uc3QgdHlwRGVmYXVsdEtleXMgPSBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCB0eXAsIHBsdWdpbi50eXBJbmRleC5zdWJ0eXBPZihmaWxlKSk7XG4gIHJldHVybiBzb3J0RmlsZUZyb250bWF0dGVyKGFwcCwgZmlsZSwgZ2xvYmFsT3JkZXIsIHR5cERlZmF1bHRLZXlzKTtcbn1cblxuLy8gb25seVR5cCAob3B0aW9uYWwpIGxpbWl0cyB0aGUgcnVuIHRvIG5vdGVzIG9mIHRoYXQgVFlQLiBXaXRob3V0IGl0IGV2ZXJ5XG4vLyBub3RlIGlzIGNoZWNrZWQsIGluY2x1ZGluZyBub3RlcyB3aXRob3V0IGEgVFlQOiBwaW5uZWQgcHJvcGVydGllcyBzdWNoIGFzXG4vLyBjc3NjbGFzc2VzIGFwcGx5IHJlZ2FyZGxlc3Mgb2YgVFlQLlxuYXN5bmMgZnVuY3Rpb24gc29ydEFsbEZyb250bWF0dGVyKGFwcCwgcGx1Z2luLCBvbmx5VHlwKSB7XG4gIGxldCBjaGVja2VkID0gMDtcbiAgbGV0IGNoYW5nZWQgPSAwO1xuICBjb25zdCBnbG9iYWxPcmRlciA9IG5vcm1hbGl6ZUdsb2JhbE9yZGVyKHBsdWdpbi5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyKTtcbiAgLy8gT25seSBtZWFuaW5nZnVsIGZvciBhIHNpbmdsZSBUWVA6IGxldHMgdGhlIGNvbW1hbmQgZXhwbGFpbiBhIHJ1biB0aGF0XG4gIC8vIGNoYW5nZWQgbm90aGluZyBiZWNhdXNlIHRoZSBUWVAgaGFzIG5vIFRZUC1Gcm9udG1hdHRlci5cbiAgY29uc3QgaGFzVHlwRGVmYXVsdHMgPSBvbmx5VHlwID8gb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgb25seVR5cCkgIT09IG51bGwgOiBudWxsO1xuXG4gIGZvciAoY29uc3QgZmlsZSBvZiBhcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpKSB7XG4gICAgaWYgKCFwbHVnaW4uc2V0dGluZ3MuaW5jbHVkZUlnbm9yZWRGaWxlcyAmJiBhcHAubWV0YWRhdGFDYWNoZS5pc1VzZXJJZ25vcmVkKGZpbGUucGF0aCkpIGNvbnRpbnVlO1xuXG4gICAgY29uc3QgdHlwID0gcGx1Z2luLnR5cEluZGV4LnR5cE9mKGZpbGUpO1xuICAgIGlmIChvbmx5VHlwICYmIHR5cCAhPT0gb25seVR5cCkgY29udGludWU7XG5cbiAgICBjb25zdCB0eXBEZWZhdWx0S2V5cyA9IG9yZGVyZWREZWZhdWx0S2V5cyhwbHVnaW4sIHR5cCwgcGx1Z2luLnR5cEluZGV4LnN1YnR5cE9mKGZpbGUpKTtcbiAgICBjaGVja2VkKys7XG4gICAgaWYgKGF3YWl0IHNvcnRGaWxlRnJvbnRtYXR0ZXIoYXBwLCBmaWxlLCBnbG9iYWxPcmRlciwgdHlwRGVmYXVsdEtleXMpKSBjaGFuZ2VkKys7XG4gIH1cblxuICByZXR1cm4geyBjaGVja2VkLCBjaGFuZ2VkLCBoYXNUeXBEZWZhdWx0cyB9O1xufVxuXG4vLyBSZXN1bHQgbm90aWNlIG9mIGEgc29ydGluZyBydW4sIHNoYXJlZCBieSB0aGUgY29tbWFuZHMgYW5kIHRoZSBwbGF5IGJ1dHRvblxuLy8gb2YgdGhlIGdsb2JhbCBvcmRlci5cbmZ1bmN0aW9uIHNvcnRTdW1tYXJ5KGxhYmVsLCBjaGVja2VkLCBjaGFuZ2VkKSB7XG4gIHJldHVybiBjaGFuZ2VkID4gMFxuICAgID8gYCR7bGFiZWx9OiBjaGVja2VkICR7cGx1cmFsKGNoZWNrZWQsIFwibm90ZVwiKX0sIHNvcnRlZCAke2NoYW5nZWR9LmBcbiAgICA6IGAke2xhYmVsfTogY2hlY2tlZCAke3BsdXJhbChjaGVja2VkLCBcIm5vdGVcIil9LCBhbGwgYWxyZWFkeSBzb3J0ZWQuYDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIHNvcnRBbGxGcm9udG1hdHRlcixcbiAgc29ydFNpbmdsZUZpbGVGcm9udG1hdHRlcixcbiAgc29ydEZyb250bWF0dGVyRm9yLFxuICBwbGFjZVByb3BlcnR5Rm9yLFxuICBub3JtYWxpemVHbG9iYWxPcmRlcixcbiAgc29ydFN1bW1hcnksXG4gIERFRkFVTFRfR0xPQkFMX09SREVSLFxuICBUWVBfUFJPUEVSVFksXG4gIFNVQlRZUF9QUk9QRVJUWSxcbn07XG4iLCAiY29uc3QgeyBzZXRJY29uLCBOb3RpY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFksIHNvcnRBbGxGcm9udG1hdHRlciwgc29ydFN1bW1hcnkgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLXNvcnRcIik7XG5cbi8vIExhYmVscyBvZiB0aGUgZm91ciBwbGFjZWhvbGRlciByb3dzOyBjb21wdXRlU29ydGVkS2V5cyBpbiBmcm9udG1hdHRlci1zb3J0LmpzXG4vLyByZXNvbHZlcyB3aGF0IGVhY2ggb25lIHN0YW5kcyBmb3IuXG5jb25zdCBQTEFDRUhPTERFUl9MQUJFTFMgPSB7XG4gIHR5cFZhbHVlOiBcIlRZUFwiLFxuICBzdWJ0eXBWYWx1ZTogXCJTVUJUWVBcIixcbiAgdHlwOiBcIlRZUC1Gcm9udG1hdHRlclwiLFxuICBvdGhlcjogXCJPdGhlciBwcm9wZXJ0aWVzXCIsXG59O1xuXG4vLyBFZGl0b3IgZm9yIHNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXI6IGEgcGxhaW4gbGlzdCBvZiBuYW1lcyB3aXRoIGRyYWcgJlxuLy8gZHJvcC4gSXQgaG9sZHMgbm8gdmFsdWVzLCBzbyB1bmxpa2UgdHlwLWZyb250bWF0dGVyLWVkaXRvci5qcyBpdCBuZWVkcyBub1xuLy8gZGV0b3VyIHRocm91Z2ggT2JzaWRpYW4ncyBwcml2YXRlIHByb3BlcnR5IHdpZGdldC4gVGhlIHBsYWNlaG9sZGVyIHJvd3MgY2FuXG4vLyBiZSBtb3ZlZCBidXQgbm90IHJlbW92ZWQuXG5mdW5jdGlvbiBtb3VudEdsb2JhbE9yZGVyRWRpdG9yKGNvbnRhaW5lckVsLCBwbHVnaW4pIHtcbiAgY29uc3QgaGVhZGVyID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci1oZWFkZXJcIiB9KTtcblxuICAvLyBCdXR0b24gYW5kIHRpdGxlIHNoYXJlIGEgZ3JvdXA6IHRoZSBoZWFkZXIgdXNlcyBzcGFjZS1iZXR3ZWVuLCBzbyBhIHRoaXJkXG4gIC8vIGRpcmVjdCBjaGlsZCB3b3VsZCBmbG9hdCBpbiB0aGUgbWlkZGxlIGluc3RlYWQgb2YgbmV4dCB0byB0aGUgdGl0bGUuXG4gIGNvbnN0IHRpdGxlR3JvdXAgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci10aXRsZS1ncm91cFwiIH0pO1xuXG4gIC8vIFNhbWUgcnVuIGFzIHRoZSBcIlNvcnQgZnJvbnRtYXR0ZXIgaW4gYWxsIG5vdGVzXCIgY29tbWFuZC5cbiAgY29uc3QgYXBwbHlCdG4gPSB0aXRsZUdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvblwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkFwcGx5IHRvIGFsbCBub3Rlc1wiIH0gfSk7XG4gIHNldEljb24oYXBwbHlCdG4sIFwicGxheVwiKTtcbiAgYXBwbHlCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGFzeW5jICgpID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgeyBjaGVja2VkLCBjaGFuZ2VkIH0gPSBhd2FpdCBzb3J0QWxsRnJvbnRtYXR0ZXIocGx1Z2luLmFwcCwgcGx1Z2luLCBudWxsKTtcbiAgICAgIG5ldyBOb3RpY2Uoc29ydFN1bW1hcnkoXCJGcm9udG1hdHRlciBzb3J0aW5nXCIsIGNoZWNrZWQsIGNoYW5nZWQpKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihcIltGcm9udG1hdHRlciBzb3J0aW5nXVwiLCBlcnJvcik7XG4gICAgICBuZXcgTm90aWNlKGBGcm9udG1hdHRlciBzb3J0aW5nIGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgIH1cbiAgfSk7XG5cbiAgdGl0bGVHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIsIHRleHQ6IFwiR2xvYmFsIHByb3BlcnR5IG9yZGVyXCIgfSk7XG5cbiAgY29uc3QgYWRkQnRuID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvblwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkFkZCBwcm9wZXJ0eVwiIH0gfSk7XG4gIHNldEljb24oYWRkQnRuLCBcInBsdXNcIik7XG5cbiAgY29uc3QgbGlzdEVsID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1vcmRlci1saXN0XCIgfSk7XG5cbiAgY29uc3Qgb3JkZXIgPSAoKSA9PiBwbHVnaW4uc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcjtcblxuICAvLyBBIG5ldyByb3cgb25seSBqb2lucyBnbG9iYWxQcm9wZXJ0eU9yZGVyIG9uY2UgaXQgaGFzIGEgdmFsaWQgbmFtZS4gVW50aWxcbiAgLy8gdGhlbiBpdCBpcyBhIGxvY2FsIGRyYWZ0IGFwcGVuZGVkIG9uIHJlbmRlciwgc28gYW4gZW1wdHkgbmFtZSBuZXZlciBlbmRzXG4gIC8vIHVwIGluIHRoZSBzZXR0aW5ncywgZXZlbiBpZiBzb21ldGhpbmcgZWxzZSBzYXZlcyBpbiBiZXR3ZWVuLlxuICBsZXQgZHJhZnRFbnRyeSA9IG51bGw7XG5cbiAgY29uc3QgaXNEdXBsaWNhdGVOYW1lID0gKHZhbHVlLCBvd25FbnRyeSkgPT4ge1xuICAgIGNvbnN0IGxvd2VyID0gdmFsdWUudG9Mb3dlckNhc2UoKTtcbiAgICBpZiAobG93ZXIgPT09IFRZUF9QUk9QRVJUWS50b0xvd2VyQ2FzZSgpIHx8IGxvd2VyID09PSBTVUJUWVBfUFJPUEVSVFkudG9Mb3dlckNhc2UoKSkgcmV0dXJuIHRydWU7XG4gICAgcmV0dXJuIG9yZGVyKCkuc29tZSgob3RoZXIpID0+IG90aGVyICE9PSBvd25FbnRyeSAmJiBvdGhlci5raW5kID09PSBcInByb3BlcnR5XCIgJiYgb3RoZXIubmFtZS50b0xvd2VyQ2FzZSgpID09PSBsb3dlcik7XG4gIH07XG5cbiAgY29uc3QgcmVuZGVyID0gKCkgPT4ge1xuICAgIGxpc3RFbC5lbXB0eSgpO1xuICAgIGNvbnN0IGVudHJpZXMgPSBkcmFmdEVudHJ5ID8gWy4uLm9yZGVyKCksIGRyYWZ0RW50cnldIDogb3JkZXIoKTtcblxuICAgIGVudHJpZXMuZm9yRWFjaCgoZW50cnksIGluZGV4KSA9PiB7XG4gICAgICBjb25zdCBpc0RyYWZ0ID0gZW50cnkgPT09IGRyYWZ0RW50cnk7XG4gICAgICBjb25zdCBpc1BsYWNlaG9sZGVyID0gZW50cnkua2luZCAhPT0gXCJwcm9wZXJ0eVwiO1xuICAgICAgY29uc3Qgcm93Q2xzID1cbiAgICAgICAgXCJ0eXAtb3JkZXItcm93XCIgKyAoaXNQbGFjZWhvbGRlciA/IFwiIGlzLXBsYWNlaG9sZGVyXCIgOiBcIlwiKSArIChlbnRyeS5raW5kID09PSBcInR5cFwiID8gXCIgaXMtdHlwLWRlZmF1bHRzXCIgOiBcIlwiKTtcbiAgICAgIGNvbnN0IHJvdyA9IGxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IHJvd0NscyB9KTtcblxuICAgICAgY29uc3QgZHJhZ0hhbmRsZSA9IHJvdy5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLW9yZGVyLWRyYWdcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJEcmFnIHRvIG1vdmVcIiB9IH0pO1xuICAgICAgc2V0SWNvbihkcmFnSGFuZGxlLCBcImdyaXAtdmVydGljYWxcIik7XG5cbiAgICAgIGlmIChpc1BsYWNlaG9sZGVyKSB7XG4gICAgICAgIHJvdy5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLW9yZGVyLWxhYmVsXCIsIHRleHQ6IFBMQUNFSE9MREVSX0xBQkVMU1tlbnRyeS5raW5kXSB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IGlucHV0ID0gcm93LmNyZWF0ZUVsKFwiaW5wdXRcIiwge1xuICAgICAgICAgIHR5cGU6IFwidGV4dFwiLFxuICAgICAgICAgIGNsczogXCJ0eXAtb3JkZXItbmFtZS1pbnB1dFwiLFxuICAgICAgICAgIGF0dHI6IHsgcGxhY2Vob2xkZXI6IFwiUHJvcGVydHkgbmFtZVwiIH0sXG4gICAgICAgIH0pO1xuICAgICAgICBpbnB1dC52YWx1ZSA9IGVudHJ5Lm5hbWU7XG5cbiAgICAgICAgLy8gXCJibHVyXCIsIG5vdCBcImNoYW5nZVwiOiBjaGFuZ2UgZG9lc24ndCBmaXJlIGZvciBhIGZpZWxkIGxlZnQgZW1wdHksIHNvXG4gICAgICAgIC8vIHRoZSBkcmFmdCB3b3VsZCBuZXZlciBiZSBjbGVhbmVkIHVwLlxuICAgICAgICBpbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiYmx1clwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgY29uc3QgdmFsdWUgPSBpbnB1dC52YWx1ZS50cmltKCk7XG5cbiAgICAgICAgICBpZiAoIXZhbHVlKSB7XG4gICAgICAgICAgICBpZiAoaXNEcmFmdCkge1xuICAgICAgICAgICAgICBkcmFmdEVudHJ5ID0gbnVsbDtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIG9yZGVyKCkuc3BsaWNlKG9yZGVyKCkuaW5kZXhPZihlbnRyeSksIDEpO1xuICAgICAgICAgICAgICBhd2FpdCBwbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZW5kZXIoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoaXNEdXBsaWNhdGVOYW1lKHZhbHVlLCBpc0RyYWZ0ID8gbnVsbCA6IGVudHJ5KSkge1xuICAgICAgICAgICAgbmV3IE5vdGljZShgXCIke3ZhbHVlfVwiIGlzIGFscmVhZHkgaW4gdGhlIGxpc3QuYCk7XG4gICAgICAgICAgICBpbnB1dC52YWx1ZSA9IGVudHJ5Lm5hbWU7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZW50cnkubmFtZSA9IHZhbHVlO1xuICAgICAgICAgIGlmIChpc0RyYWZ0KSB7XG4gICAgICAgICAgICBvcmRlcigpLnB1c2goZW50cnkpO1xuICAgICAgICAgICAgZHJhZnRFbnRyeSA9IG51bGw7XG4gICAgICAgICAgfVxuICAgICAgICAgIGF3YWl0IHBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICByZW5kZXIoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgcmVtb3ZlQnRuID0gcm93LmNyZWF0ZURpdih7IGNsczogXCJ0eXAtb3JkZXItcmVtb3ZlIGNsaWNrYWJsZS1pY29uXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiUmVtb3ZlXCIgfSB9KTtcbiAgICAgICAgc2V0SWNvbihyZW1vdmVCdG4sIFwieFwiKTtcbiAgICAgICAgcmVtb3ZlQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgaWYgKGlzRHJhZnQpIHtcbiAgICAgICAgICAgIGRyYWZ0RW50cnkgPSBudWxsO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBvcmRlcigpLnNwbGljZShvcmRlcigpLmluZGV4T2YoZW50cnkpLCAxKTtcbiAgICAgICAgICAgIGF3YWl0IHBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmVuZGVyKCk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICAvLyBBIGRyYWZ0IGhhcyBubyBwbGFjZSBpbiB0aGUgcmVhbCBsaXN0IHlldCwgc28gaXQgY2FuJ3QgYmUgbW92ZWQuXG4gICAgICBpZiAoaXNEcmFmdCkgcmV0dXJuO1xuXG4gICAgICByb3cuZHJhZ2dhYmxlID0gdHJ1ZTtcbiAgICAgIHJvdy5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ3N0YXJ0XCIsIChldmVudCkgPT4ge1xuICAgICAgICBldmVudC5kYXRhVHJhbnNmZXIuZWZmZWN0QWxsb3dlZCA9IFwibW92ZVwiO1xuICAgICAgICBldmVudC5kYXRhVHJhbnNmZXIuc2V0RGF0YShcInRleHQvcGxhaW5cIiwgU3RyaW5nKGluZGV4KSk7XG4gICAgICAgIHJvdy5jbGFzc0xpc3QuYWRkKFwiaXMtZHJhZ2dpbmdcIik7XG4gICAgICB9KTtcbiAgICAgIHJvdy5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ2VuZFwiLCAoKSA9PiByb3cuY2xhc3NMaXN0LnJlbW92ZShcImlzLWRyYWdnaW5nXCIpKTtcbiAgICAgIHJvdy5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ292ZXJcIiwgKGV2ZW50KSA9PiB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIC8vIFVwcGVyIG9yIGxvd2VyIGhhbGYgZGVjaWRlcyBiZWZvcmUvYWZ0ZXIgLSBvdGhlcndpc2Ugbm90aGluZyBjb3VsZFxuICAgICAgICAvLyBiZSBkcm9wcGVkIGJlbG93IHRoZSBsYXN0IHJvdy5cbiAgICAgICAgY29uc3QgcmVjdCA9IHJvdy5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgICAgY29uc3QgaXNBZnRlciA9IGV2ZW50LmNsaWVudFkgLSByZWN0LnRvcCA+IHJlY3QuaGVpZ2h0IC8gMjtcbiAgICAgICAgcm93LmNsYXNzTGlzdC50b2dnbGUoXCJpcy1kcm9wLWJlZm9yZVwiLCAhaXNBZnRlcik7XG4gICAgICAgIHJvdy5jbGFzc0xpc3QudG9nZ2xlKFwiaXMtZHJvcC1hZnRlclwiLCBpc0FmdGVyKTtcbiAgICAgIH0pO1xuICAgICAgcm93LmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnbGVhdmVcIiwgKCkgPT4gcm93LmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcm9wLWJlZm9yZVwiLCBcImlzLWRyb3AtYWZ0ZXJcIikpO1xuICAgICAgcm93LmFkZEV2ZW50TGlzdGVuZXIoXCJkcm9wXCIsIGFzeW5jIChldmVudCkgPT4ge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBjb25zdCBpc0FmdGVyID0gcm93LmNsYXNzTGlzdC5jb250YWlucyhcImlzLWRyb3AtYWZ0ZXJcIik7XG4gICAgICAgIHJvdy5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJvcC1iZWZvcmVcIiwgXCJpcy1kcm9wLWFmdGVyXCIpO1xuXG4gICAgICAgIGNvbnN0IGZyb21JbmRleCA9IE51bWJlcihldmVudC5kYXRhVHJhbnNmZXIuZ2V0RGF0YShcInRleHQvcGxhaW5cIikpO1xuICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKGZyb21JbmRleCkpIHJldHVybjtcblxuICAgICAgICAvLyBUYXJnZXQgaW5kZXggY291bnRlZCBiZWZvcmUgZnJvbUluZGV4IGlzIHJlbW92ZWQuXG4gICAgICAgIGxldCBpbnNlcnRCZWZvcmUgPSBpc0FmdGVyID8gaW5kZXggKyAxIDogaW5kZXg7XG4gICAgICAgIGlmIChmcm9tSW5kZXggPCBpbnNlcnRCZWZvcmUpIGluc2VydEJlZm9yZSAtPSAxO1xuXG4gICAgICAgIGNvbnN0IFttb3ZlZF0gPSBvcmRlcigpLnNwbGljZShmcm9tSW5kZXgsIDEpO1xuICAgICAgICBvcmRlcigpLnNwbGljZShpbnNlcnRCZWZvcmUsIDAsIG1vdmVkKTtcbiAgICAgICAgYXdhaXQgcGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICByZW5kZXIoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9O1xuXG4gIGFkZEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgIGlmICghZHJhZnRFbnRyeSkge1xuICAgICAgZHJhZnRFbnRyeSA9IHsga2luZDogXCJwcm9wZXJ0eVwiLCBuYW1lOiBcIlwiIH07XG4gICAgICByZW5kZXIoKTtcbiAgICB9XG4gICAgY29uc3QgaW5wdXRzID0gbGlzdEVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIudHlwLW9yZGVyLW5hbWUtaW5wdXRcIik7XG4gICAgaW5wdXRzW2lucHV0cy5sZW5ndGggLSAxXT8uZm9jdXMoKTtcbiAgfSk7XG5cbiAgcmVuZGVyKCk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBtb3VudEdsb2JhbE9yZGVyRWRpdG9yIH07XG4iLCAiY29uc3QgeyBnZXRTdWJ0eXAgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cHNcIik7XG5cbi8vIENvbG9yIG9mIGEgVFlQIHdpdGhvdXQgaXRzIG93biBjb2xvci4gTGl2ZXMgaGVyZSBiZWNhdXNlIGNvZGUgYmVsb3cgdGhlXG4vLyB2aWV3IG5lZWRzIGl0IChzZWUgbmFtZUNvbG9yKTsgdHlwLXBhbmUuanMgcmUtZXhwb3J0cyBpdC5cbmNvbnN0IERFRkFVTFRfVFlQX0NPTE9SID0gXCIjODg4ODg4XCI7XG5cbi8vIC0tLSBTdWJ0eXAgY29sb3JzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEEgU3VidHlwIHN0b3JlcyBubyBjb2xvciwgb25seSBhbiBvZmZzZXQgZnJvbSBpdHMgVFlQJ3MgY29sb3Jcbi8vIChzZXR0aW5ncy50eXBTdWJ0eXBzW1RZUF1bU1VCVFlQXS5jb2xvciA9IHsgaCwgbCB9KS4gVGhlIHJlYWwgY29sb3IgaXNcbi8vIGNvbXB1dGVkIGZyb20gdGhlIGN1cnJlbnQgVFlQIGNvbG9yIGV2ZXJ5IHRpbWUsIHNvIHdoZW4gdGhhdCBjaGFuZ2VzIGFsbFxuLy8gU3VidHlwcyBmb2xsb3cgYW5kIHN0YXkgaW4gdGhlIGZhbWlseS5cbi8vIFRoZSBtYXRoIHJ1bnMgaW4gT0tMQ0gsIHdoZXJlIGEgbGlnaHRuZXNzIGNoYW5nZSBsb29rcyBhYm91dCBlcXVhbGx5IHN0cm9uZ1xuLy8gYWNyb3NzIGh1ZXMgKGluIEhTTCB5ZWxsb3cgd291bGQgYmUgZmFyIGJyaWdodGVyIHRoYW4gYmx1ZSkuIFdpdGhvdXQgYW5cbi8vIG9mZnNldCBhIFN1YnR5cCBoYXMgdGhlIFRZUCBjb2xvci5cbi8vICAgaDogaHVlLCBzaGlmdGVkIGluIGRlZ3JlZXM7XG4vLyAgIGw6IGxpZ2h0bmVzcyBhcyAlIG9mIHRoZSB3YXkgdG8gd2hpdGUgKCspIG9yIGJsYWNrICgtKS5cbi8vIFRoZSBhbGxvd2VkIHJhbmdlIGlzIGEgc2V0dGluZyAoc2V0dGluZ3Muc3VidHlwQ29sb3JSYW5nZXMpOyBhIGxhcmdlciBzdG9yZWRcbi8vIG9mZnNldCBpcyBjbGFtcGVkIHRvIGl0LlxuLy9cbi8vIFRoaXMgbGlzdCBpcyB0aGUgc2luZ2xlIHNvdXJjZSBmb3IgdGhlIHBvcG92ZXIgc2xpZGVycywgdGhlIHNldHRpbmcgbGltaXRzXG4vLyBhbmQgdGhlIGNsYW1waW5nOyBjb21tZW50aW5nIGEgY2hhbm5lbCBvdXQgcmVtb3ZlcyBpdCBldmVyeXdoZXJlLlxuLy9cbi8vIFNhdHVyYXRpb24gaXMgZGlzYWJsZWQuIEl0IG9uY2UgY29tcGVuc2F0ZWQgZm9yIGNocm9tYSB0aGF0IGxpZ2h0bmVzcyBhbmRcbi8vIGh1ZSB0b29rIGF3YXk7IHNpbmNlIGJvdGggbm93IGNhcnJ5IGNocm9tYSBhbG9uZyAoc2VlIGNvbXB1dGVDb2xvck9mZnNldCksXG4vLyBpdCBjb3VsZCBvbmx5IHNheSBcInRoaXMgU3VidHlwIGhvbGRzIGJhY2tcIiwgbm90IHdvcnRoIGEgdGhpcmQgc2xpZGVyLiBUb1xuLy8gcmV2aXZlIGl0LCB1bmNvbW1lbnQgaXQgaGVyZSwgaW4gREVGQVVMVF9TVUJUWVBfQ09MT1JfUkFOR0VTLCBpblxuLy8gY29tcHV0ZUNvbG9yT2Zmc2V0IGFuZCBhdCByYW5nZU1heC9yYW5nZURlc2MgaW4gc2V0dGluZ3MuanMuXG4vLyBkb3duT25seTogdGhlIHNsaWRlciBvbmx5IGdvZXMgZnJvbSAtbGltaXQgdG8gMCAtIGEgU3VidHlwIG1heSBob2xkIGJhY2sgYnV0XG4vLyBuZXZlciBiZSBsb3VkZXIgdGhhbiBpdHMgVFlQLlxuY29uc3QgU1VCVFlQX0NPTE9SX0NIQU5ORUxTID0gW1xuICB7IGtleTogXCJoXCIsIGxhYmVsOiBcIkh1ZVwiLCB1bml0OiBcIlx1MDBCMFwiIH0sXG4gIC8vIHsga2V5OiBcInNcIiwgbGFiZWw6IFwiU2F0dXJhdGlvblwiLCB1bml0OiBcIiVcIiwgZG93bk9ubHk6IHRydWUgfSxcbiAgeyBrZXk6IFwibFwiLCBsYWJlbDogXCJMaWdodG5lc3NcIiwgdW5pdDogXCIlXCIgfSxcbl07XG4vLyBTdWJ0eXBzIHNob3VsZCBhYm92ZSBhbGwgYmUgZGlzdGluZ3Vpc2hhYmxlOiBodWUgY29udHJpYnV0ZXMgbW9zdCBhbmQgZ2V0c1xuLy8gdGhlIHdpZGVzdCByYW5nZSwgbGlnaHRuZXNzIGFzIHRoZSBzZWNvbmQgY2xlYXIgYXhpcyBnZXRzIHBsZW50eSB0b28uXG5jb25zdCBERUZBVUxUX1NVQlRZUF9DT0xPUl9SQU5HRVMgPSB7IGg6IDM1LCAvKiBzOiA0MCwgKi8gbDogNDAgfTtcblxuZnVuY3Rpb24gY29sb3JSYW5nZShzZXR0aW5ncywga2V5KSB7XG4gIGNvbnN0IHZhbHVlID0gTnVtYmVyKHNldHRpbmdzLnN1YnR5cENvbG9yUmFuZ2VzPy5ba2V5XSk7XG4gIHJldHVybiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpICYmIHZhbHVlID49IDAgPyB2YWx1ZSA6IERFRkFVTFRfU1VCVFlQX0NPTE9SX1JBTkdFU1trZXldO1xufVxuXG4vLyBTbGlkZXIgcmFuZ2UgLSBvbmUgcGxhY2UgZm9yIHBvcG92ZXIsIGNsYW1waW5nIGFuZCBncmFkaWVudCBwcmV2aWV3IHNvIHRoZXlcbi8vIGNhbid0IGRyaWZ0IGFwYXJ0LlxuZnVuY3Rpb24gY2hhbm5lbEJvdW5kcyhzZXR0aW5ncywga2V5KSB7XG4gIGNvbnN0IHJhbmdlID0gY29sb3JSYW5nZShzZXR0aW5ncywga2V5KTtcbiAgcmV0dXJuIFNVQlRZUF9DT0xPUl9DSEFOTkVMUy5maW5kKChjaGFubmVsKSA9PiBjaGFubmVsLmtleSA9PT0ga2V5KT8uZG93bk9ubHkgPyBbLXJhbmdlLCAwXSA6IFstcmFuZ2UsIHJhbmdlXTtcbn1cblxuLy8gQSBTdWJ0eXAncyBvZmZzZXQsIGNsYW1wZWQgdG8gdGhlIGNvbmZpZ3VyZWQgbGltaXRzLlxuZnVuY3Rpb24gY2xhbXBlZE9mZnNldChzZXR0aW5ncywgb2Zmc2V0KSB7XG4gIGlmICghb2Zmc2V0KSByZXR1cm4gbnVsbDtcbiAgY29uc3QgcmVzdWx0ID0ge307XG4gIGZvciAoY29uc3QgeyBrZXkgfSBvZiBTVUJUWVBfQ09MT1JfQ0hBTk5FTFMpIHtcbiAgICBjb25zdCBbbWluLCBtYXhdID0gY2hhbm5lbEJvdW5kcyhzZXR0aW5ncywga2V5KTtcbiAgICByZXN1bHRba2V5XSA9IE1hdGgubWluKG1heCwgTWF0aC5tYXgobWluLCBOdW1iZXIob2Zmc2V0W2tleV0pIHx8IDApKTtcbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuXG5jb25zdCB0b0xpbmVhciA9IChjKSA9PiAoYyA8PSAwLjA0MDQ1ID8gYyAvIDEyLjkyIDogKChjICsgMC4wNTUpIC8gMS4wNTUpICoqIDIuNCk7XG5jb25zdCB0b0dhbW1hID0gKGMpID0+IChjIDw9IDAuMDAzMTMwOCA/IDEyLjkyICogYyA6IDEuMDU1ICogYyAqKiAoMSAvIDIuNCkgLSAwLjA1NSk7XG5cbmZ1bmN0aW9uIGhleFRvT2tsY2goaGV4KSB7XG4gIGNvbnN0IG1hdGNoID0gL14jPyhbMC05YS1mXXs2fSkkL2kuZXhlYyhoZXggPz8gXCJcIik7XG4gIGlmICghbWF0Y2gpIHJldHVybiBudWxsO1xuICBjb25zdCBpbnQgPSBwYXJzZUludChtYXRjaFsxXSwgMTYpO1xuICBjb25zdCBbciwgZywgYl0gPSBbKGludCA+PiAxNikgJiAyNTUsIChpbnQgPj4gOCkgJiAyNTUsIGludCAmIDI1NV0ubWFwKChjKSA9PiB0b0xpbmVhcihjIC8gMjU1KSk7XG4gIGNvbnN0IGwgPSBNYXRoLmNicnQoMC40MTIyMjE0NzA4ICogciArIDAuNTM2MzMyNTM2MyAqIGcgKyAwLjA1MTQ0NTk5MjkgKiBiKTtcbiAgY29uc3QgbSA9IE1hdGguY2JydCgwLjIxMTkwMzQ5ODIgKiByICsgMC42ODA2OTk1NDUxICogZyArIDAuMTA3Mzk2OTU2NiAqIGIpO1xuICBjb25zdCBzID0gTWF0aC5jYnJ0KDAuMDg4MzAyNDYxOSAqIHIgKyAwLjI4MTcxODgzNzYgKiBnICsgMC42Mjk5Nzg3MDA1ICogYik7XG4gIGNvbnN0IEwgPSAwLjIxMDQ1NDI1NTMgKiBsICsgMC43OTM2MTc3ODUgKiBtIC0gMC4wMDQwNzIwNDY4ICogcztcbiAgY29uc3QgQSA9IDEuOTc3OTk4NDk1MSAqIGwgLSAyLjQyODU5MjIwNSAqIG0gKyAwLjQ1MDU5MzcwOTkgKiBzO1xuICBjb25zdCBCID0gMC4wMjU5MDQwMzcxICogbCArIDAuNzgyNzcxNzY2MiAqIG0gLSAwLjgwODY3NTc2NiAqIHM7XG4gIHJldHVybiB7IEwsIEM6IE1hdGguaHlwb3QoQSwgQiksIEg6ICgoTWF0aC5hdGFuMihCLCBBKSAqIDE4MCkgLyBNYXRoLlBJICsgMzYwKSAlIDM2MCB9O1xufVxuXG4vLyBMaW5lYXIgc1JHQjsgY2hhbm5lbHMgbWF5IGZhbGwgb3V0c2lkZSAwLi4xIChvdXQgb2YgZ2FtdXQpLlxuZnVuY3Rpb24gb2tsY2hUb0xpbmVhcih7IEwsIEMsIEggfSkge1xuICBjb25zdCBBID0gQyAqIE1hdGguY29zKChIICogTWF0aC5QSSkgLyAxODApO1xuICBjb25zdCBCID0gQyAqIE1hdGguc2luKChIICogTWF0aC5QSSkgLyAxODApO1xuICBjb25zdCBsID0gKEwgKyAwLjM5NjMzNzc3NzQgKiBBICsgMC4yMTU4MDM3NTczICogQikgKiogMztcbiAgY29uc3QgbSA9IChMIC0gMC4xMDU1NjEzNDU4ICogQSAtIDAuMDYzODU0MTcyOCAqIEIpICoqIDM7XG4gIGNvbnN0IHMgPSAoTCAtIDAuMDg5NDg0MTc3NSAqIEEgLSAxLjI5MTQ4NTU0OCAqIEIpICoqIDM7XG4gIHJldHVybiBbXG4gICAgNC4wNzY3NDE2NjIxICogbCAtIDMuMzA3NzExNTkxMyAqIG0gKyAwLjIzMDk2OTkyOTIgKiBzLFxuICAgIC0xLjI2ODQzODAwNDYgKiBsICsgMi42MDk3NTc0MDExICogbSAtIDAuMzQxMzE5Mzk2NSAqIHMsXG4gICAgLTAuMDA0MTk2MDg2MyAqIGwgLSAwLjcwMzQxODYxNDcgKiBtICsgMS43MDc2MTQ3MDEgKiBzLFxuICBdO1xufVxuXG5jb25zdCBpbkdhbXV0ID0gKHJnYikgPT4gcmdiLmV2ZXJ5KChjKSA9PiBjID49IC0wLjAwMDEgJiYgYyA8PSAxLjAwMDEpO1xuXG4vLyBMYXJnZXN0IGNocm9tYSBzUkdCIGNhbiBzaG93IGF0IHRoaXMgbGlnaHRuZXNzIGFuZCBodWUuIFRoZSBsaW1pdCB2YXJpZXMgYVxuLy8gbG90IChwdXJlIHllbGxvdyBvbmx5IGNhcnJpZXMgbXVjaCBjaHJvbWEganVzdCBiZWxvdyB3aGl0ZSwgYmx1ZSBpbiB0aGVcbi8vIG1pZGRsZSksIHdoaWNoIGlzIGV4YWN0bHkgd2hlcmUgYW55IG1hdGggaG9sZGluZyBjaHJvbWEgYWJzb2x1dGUgYnJlYWtzLlxuZnVuY3Rpb24gbWF4Q2hyb21hKEwsIEgpIHtcbiAgbGV0IGxvdyA9IDA7XG4gIGxldCBoaWdoID0gMC40OyAvLyBhYm92ZSB0aGUgc1JHQiBtYXhpbXVtICh+MC4zMilcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCAyMDsgaSsrKSB7XG4gICAgY29uc3QgbWlkID0gKGxvdyArIGhpZ2gpIC8gMjtcbiAgICBpZiAoaW5HYW11dChva2xjaFRvTGluZWFyKHsgTCwgQzogbWlkLCBIIH0pKSkgbG93ID0gbWlkO1xuICAgIGVsc2UgaGlnaCA9IG1pZDtcbiAgfVxuICByZXR1cm4gbG93O1xufVxuXG4vLyBPdXQtb2YtZ2FtdXQgY29sb3JzIGxvc2UgY2hyb21hIHVudGlsIHRoZXkgZml0OyBodWUgYW5kIGxpZ2h0bmVzcyBzdGF5LlxuLy8gRm9yIGFwcGx5Q29sb3JPZmZzZXQgb25seSBhIHNhZmV0eSBuZXQsIHNpbmNlIGNocm9tYSBpcyBhbHJlYWR5IGEgc2hhcmUgb2Zcbi8vIHRoZSBkaXNwbGF5YWJsZSBtYXhpbXVtIHRoZXJlLlxuZnVuY3Rpb24gb2tsY2hUb0hleChjb2xvcikge1xuICBsZXQgcmdiID0gb2tsY2hUb0xpbmVhcihjb2xvcik7XG4gIGlmICghaW5HYW11dChyZ2IpKSByZ2IgPSBva2xjaFRvTGluZWFyKHsgLi4uY29sb3IsIEM6IG1heENocm9tYShjb2xvci5MLCBjb2xvci5IKSB9KTtcbiAgcmV0dXJuIChcbiAgICBcIiNcIiArXG4gICAgcmdiXG4gICAgICAubWFwKChjKSA9PiBNYXRoLnJvdW5kKE1hdGgubWluKDEsIE1hdGgubWF4KDAsIHRvR2FtbWEoTWF0aC5taW4oMSwgTWF0aC5tYXgoMCwgYykpKSkpICogMjU1KSlcbiAgICAgIC5tYXAoKGMpID0+IGMudG9TdHJpbmcoMTYpLnBhZFN0YXJ0KDIsIFwiMFwiKSlcbiAgICAgIC5qb2luKFwiXCIpXG4gICk7XG59XG5cbi8vIExpZ2h0bmVzcyBvZiBhIGh1ZSdzIGN1c3AsIHdoZXJlIGl0IGNhcnJpZXMgdGhlIG1vc3QgY2hyb21hLiBtYXhDaHJvbWEgcmlzZXNcbi8vIHVwIHRvIGl0IGFuZCBmYWxscyBhZnRlciwgc28gdGhlIHBlYWsgY2FuIGJlIG5hcnJvd2VkIGRvd24uIE9uZSB2YWx1ZSBwZXJcbi8vIGh1ZSBhbmQgdGhlIHNlYXJjaCBpcyBjb3N0bHksIHNvIGl0IGlzIGNhY2hlZCBwZXIgd2hvbGUgZGVncmVlLlxuY29uc3QgY3VzcENhY2hlID0gbmV3IE1hcCgpO1xuXG4vLyBBYm92ZSB0aGlzIGEgY29sb3IgY291bnRzIGFzIGNocm9tYXRpYy4gQSBwdXJlIGdyYXkgY29tZXMgYmFjayBmcm9tXG4vLyBoZXhUb09rbGNoIHdpdGggY2hyb21hIGFyb3VuZCAyZS04IGFuZCBhbiBhcmJpdHJhcnkgaHVlIChyb3VuZGVkIG1hdHJpeFxuLy8gY29uc3RhbnRzKTsgdGVzdGluZyBcIj4gMFwiIG1hZGUgYSBncmF5IGZvbGxvdyB0aGUgY3VzcCBvZiBhIGh1ZSBpdCBkb2Vzbid0XG4vLyBoYXZlLiBGYXIgYmVsb3cgYW55dGhpbmcgdmlzaWJsZSBpbiA4IGJpdCAob25lIHN0ZXAgaXMgYWJvdXQgMC4wMDIpLlxuY29uc3QgTkVVVFJBTF9DSFJPTUEgPSAxZS00O1xuXG5mdW5jdGlvbiBjdXNwTGlnaHRuZXNzKEgpIHtcbiAgY29uc3Qga2V5ID0gTWF0aC5yb3VuZChIKSAlIDM2MDtcbiAgY29uc3QgY2FjaGVkID0gY3VzcENhY2hlLmdldChrZXkpO1xuICBpZiAoY2FjaGVkICE9PSB1bmRlZmluZWQpIHJldHVybiBjYWNoZWQ7XG4gIGxldCBsb3cgPSAwO1xuICBsZXQgaGlnaCA9IDE7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgMjQ7IGkrKykge1xuICAgIGNvbnN0IHRoaXJkID0gKGhpZ2ggLSBsb3cpIC8gMztcbiAgICBpZiAobWF4Q2hyb21hKGxvdyArIHRoaXJkLCBrZXkpIDwgbWF4Q2hyb21hKGhpZ2ggLSB0aGlyZCwga2V5KSkgbG93ICs9IHRoaXJkO1xuICAgIGVsc2UgaGlnaCAtPSB0aGlyZDtcbiAgfVxuICBjb25zdCByZXN1bHQgPSAobG93ICsgaGlnaCkgLyAyO1xuICBjdXNwQ2FjaGUuc2V0KGtleSwgcmVzdWx0KTtcbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLy8gVGhlIHNhbWUgbGlnaHRuZXNzLCBtZWFzdXJlZCBhZ2FpbnN0IHRoZSB0YXJnZXQgaHVlJ3MgY3VzcCBpbnN0ZWFkIG9mIGl0c1xuLy8gb3duOiBjdXNwIG1hcHMgdG8gY3VzcCwgYmxhY2sgdG8gYmxhY2ssIHdoaXRlIHRvIHdoaXRlLCBsaW5lYXIgaW4gYmV0d2Vlbi5cbi8vIFdpdGhvdXQgYSBodWUgc2hpZnQgTCBjb21lcyBiYWNrIHVuY2hhbmdlZC5cbmZ1bmN0aW9uIHJlbWFwVG9DdXNwKEwsIGZyb21ILCB0b0gpIHtcbiAgY29uc3QgZnJvbSA9IGN1c3BMaWdodG5lc3MoZnJvbUgpO1xuICBjb25zdCB0byA9IGN1c3BMaWdodG5lc3ModG9IKTtcbiAgaWYgKEwgPD0gZnJvbSkgcmV0dXJuIGZyb20gPiAwID8gKEwgLyBmcm9tKSAqIHRvIDogdG87XG4gIHJldHVybiBmcm9tIDwgMSA/IHRvICsgKChMIC0gZnJvbSkgLyAoMSAtIGZyb20pKSAqICgxIC0gdG8pIDogdG87XG59XG5cbi8vIFRoZSB0d28gZ2FtdXQgc2VhcmNoZXMgY29zdCBhYm91dCAxMCBcdTAwQjVzIHBlciBjb2xvciAtIHRvbyBtdWNoIHdoZW4gdGhlIGZpbGVcbi8vIHRyZWUgb3IgZ3JhcGggYXNrcyBmb3IgZXZlcnkgZmlsZSAoc2VlIGNvbG9yRm9yRmlsZSkuIFRoZXJlIGFyZSBvbmx5IGFcbi8vIGhhbmRmdWwgb2YgZGlzdGluY3QgY29sb3JzLCBzbyBhIGNhY2hlIHN1ZmZpY2VzOyBkcmFnZ2luZyBhIHNsaWRlciBhZGRzXG4vLyBldmVyeSBpbnRlcm1lZGlhdGUgdmFsdWUsIGhlbmNlIHRoZSBvY2Nhc2lvbmFsIHJlc2V0LlxuY29uc3Qgb2Zmc2V0Q2FjaGUgPSBuZXcgTWFwKCk7XG5cbmZ1bmN0aW9uIGFwcGx5Q29sb3JPZmZzZXQoaGV4LCBvZmZzZXQpIHtcbiAgaWYgKCFvZmZzZXQpIHJldHVybiBoZXg7XG4gIGNvbnN0IGNhY2hlS2V5ID0gaGV4ICsgXCJ8XCIgKyAob2Zmc2V0LmggPz8gMCkgKyBcInxcIiArIChvZmZzZXQubCA/PyAwKTtcbiAgY29uc3QgY2FjaGVkID0gb2Zmc2V0Q2FjaGUuZ2V0KGNhY2hlS2V5KTtcbiAgaWYgKGNhY2hlZCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gY2FjaGVkO1xuICBjb25zdCByZXN1bHQgPSBjb21wdXRlQ29sb3JPZmZzZXQoaGV4LCBvZmZzZXQpO1xuICBpZiAob2Zmc2V0Q2FjaGUuc2l6ZSA+IDUwMCkgb2Zmc2V0Q2FjaGUuY2xlYXIoKTtcbiAgb2Zmc2V0Q2FjaGUuc2V0KGNhY2hlS2V5LCByZXN1bHQpO1xuICByZXR1cm4gcmVzdWx0O1xufVxuXG4vLyBCb3RoIHNsaWRlcnMgYWN0IHJlbGF0aXZlIHRvIHRoZSBUWVAgY29sb3Igc28gdGhlIFN1YnR5cCBzdGF5cyBpbiB0aGVcbi8vIGZhbWlseS4gQWJzb2x1dGUgdmFsdWVzIGRvbid0IGtlZXAgdGhlaXIgcHJvbWlzZSwgYmVjYXVzZSBob3cgbXVjaCBjb2xvclxuLy8gc1JHQiBhbGxvd3MgZGVwZW5kcyBvbiBsaWdodG5lc3MgQU5EIGh1ZTpcbi8vICAgbDogc2hhcmUgb2YgdGhlIHdheSB0byB3aGl0ZSAoKykgb3IgYmxhY2sgKC0pLiBBYnNvbHV0ZSBPS0xDSCBwb2ludHMgcmFuIGFcbi8vICAgICAgbGlnaHQgVFlQIGNvbG9yIGludG8gcHVyZSB3aGl0ZSBpbiB0aGUgZmlyc3QgaGFsZiBvZiB0aGUgc2xpZGVyLlxuLy8gICBoOiBkZWdyZWVzIC0gdGhlIG9ubHkgYWJzb2x1dGUgb25lLCBCVVQgaXQgY2FycmllcyBsaWdodG5lc3MgYWxvbmcgKHNlZVxuLy8gICAgICByZW1hcFRvQ3VzcCkuIEVhY2ggaHVlIHBlYWtzIGF0IGEgZGlmZmVyZW50IGxpZ2h0bmVzcyAoeWVsbG93IGF0IEwgMC45Mixcbi8vICAgICAgb3JhbmdlIDAuNzgsIGJsdWUgMC40OSkuIFR1cm5pbmcgYSBsaWdodCB5ZWxsb3cgdG8gb3JhbmdlIGF0IGZpeGVkXG4vLyAgICAgIGxpZ2h0bmVzcyBsYW5kcyBmYXIgYWJvdmUgb3JhbmdlJ3MgY3VzcCwgd2hlcmUgdGhlcmUgaXMgaGFyZGx5IGFueVxuLy8gICAgICBjaHJvbWEgbGVmdDogYSB3YXNoZWQtb3V0IHBhc3RlbC4gRm9sbG93aW5nIHRoZSBjdXNwIGtlZXBzIHRoZSBjb2xvclxuLy8gICAgICBzdHJlbmd0aCBuZWFybHkgY29uc3RhbnQgdGhyb3VnaCB0aGUgdHVybi5cbi8vIENocm9tYSBpcyB0aGVuIHNpbXBseSBhIHNoYXJlIG9mIHRoZSBjZWlsaW5nIChiYXNlLkMgLyBtYXhDaHJvbWEgYXQgdGhlXG4vLyBzdGFydCwgdGltZXMgbWF4Q2hyb21hIGF0IHRoZSB0YXJnZXQpOyBvbmx5IHdpdGggcmVsYXRlZCBsaWdodG5lc3NlcyBhcmVcbi8vIHR3byBodWVzJyBjZWlsaW5ncyBjb21wYXJhYmxlLlxuLy9cbi8vIE5vdGUgd2hhdCB0aGF0IHNoYXJlIGlzOiBhIHN0YXRlbWVudCBhYm91dCBzUkdCLCBub3QgYWJvdXQgcGVyY2VwdGlvbi4gSXRcbi8vIGtlZXBzIFwiZXF1YWxseSBleGhhdXN0ZWRcIiwgbm90IFwiZXF1YWxseSBjb2xvcmZ1bFwiIChjb25zdGFudCBDKSBub3IgXCJlcXVhbGx5XG4vLyBzYXR1cmF0ZWRcIiAoY29uc3RhbnQgQy9MKS4gU28gdGhlIG1vZGVsIGlzIHRpZWQgdG8gc1JHQjsgYWZ0ZXIgYSBodWUgdHVybiBhXG4vLyBTdWJ0eXAgaXMgZXF1YWxseSBlbXBoYXRpYyByYXRoZXIgdGhhbiBlcXVhbGx5IGxpZ2h0IChhIGRlc2lnbiBjaG9pY2UpOyBhbmRcbi8vIGNocm9tYSBpc24ndCBtb25vdG9uaWMgaW4gbGlnaHRuZXNzIC0gYWJvdmUgaXRzIGN1c3AgYSBUWVAgY29sb3IgZmlyc3QgZ2FpbnNcbi8vIGNocm9tYSBnb2luZyBkb3duLCB0aGVuIGxvc2VzIGl0ICgjNzg3OGRjIGhhcyBtb3JlIGF0IC0yMCAlIHRoYW4gYXQgMCAlIG9yXG4vLyAtNDAgJSkuIEZpbmUgZm9yIGNvbG9yZWQgZmlsZSBuYW1lczsgYSBzdHJpY3RlciBtb2RlbCBuZWVkcyBhIGRpZmZlcmVudFxuLy8gcmVmZXJlbmNlLCBub3QgcGF0Y2hlZCBmb3JtdWxhcy5cbi8vXG4vLyBPS0xhYiBpdHNlbGYgaXMgb2ZmIGluIHRoZSBibHVlIHJhbmdlIChIIDI2MC0yOTApOiBibHVlIGRyaWZ0cyB0b3dhcmQgdmlvbGV0XG4vLyB3aGVuIGxpZ2h0ZW5lZCB3aGlsZSB0aGUgbnVtYmVycyBzYXkgdGhlIGh1ZSBpcyBjb25zdGFudC4gQ2hlY2sgc3VjaCBUWVBcbi8vIGNvbG9ycyBieSBleWUuXG5mdW5jdGlvbiBjb21wdXRlQ29sb3JPZmZzZXQoaGV4LCBvZmZzZXQpIHtcbiAgY29uc3QgYmFzZSA9IGhleFRvT2tsY2goaGV4KTtcbiAgaWYgKCFiYXNlKSByZXR1cm4gaGV4O1xuICBjb25zdCBIID0gKGJhc2UuSCArIChvZmZzZXQuaCA/PyAwKSArIDM2MCkgJSAzNjA7XG4gIGNvbnN0IGJhc2VDZWlsaW5nID0gbWF4Q2hyb21hKGJhc2UuTCwgYmFzZS5IKTtcbiAgLy8gQSBncmF5IFRZUCBjb2xvciBzdGF5cyBncmF5OyBpdHMgaHVlIG1lYW5zIG5vdGhpbmcsIHNvIHRoZXJlIGlzIG5vIGN1c3AgdG9cbiAgLy8gZm9sbG93IGVpdGhlci5cbiAgY29uc3QgbmV1dHJhbCA9IGJhc2UuQyA8IE5FVVRSQUxfQ0hST01BIHx8IGJhc2VDZWlsaW5nIDw9IDA7XG4gIGNvbnN0IHJlbGF0aXZlID0gbmV1dHJhbCA/IDAgOiBiYXNlLkMgLyBiYXNlQ2VpbGluZztcbiAgY29uc3Qgc2hpZnRlZCA9IG5ldXRyYWwgPyBiYXNlLkwgOiByZW1hcFRvQ3VzcChiYXNlLkwsIGJhc2UuSCwgSCk7XG4gIGNvbnN0IHNoYXJlID0gKG9mZnNldC5sID8/IDApIC8gMTAwO1xuICBjb25zdCBMID0gTWF0aC5taW4oMSwgTWF0aC5tYXgoMCwgc2hpZnRlZCArIHNoYXJlICogKHNoYXJlID49IDAgPyAxIC0gc2hpZnRlZCA6IHNoaWZ0ZWQpKSk7XG4gIGNvbnN0IEMgPSByZWxhdGl2ZSAqIG1heENocm9tYShMLCBIKTsgLyogKiAoMSArIChvZmZzZXQucyA/PyAwKSAvIDEwMCkgLSBzYXR1cmF0aW9uIGRpc2FibGVkICovXG4gIHJldHVybiBva2xjaFRvSGV4KHsgTCwgQzogTWF0aC5tYXgoMCwgQyksIEggfSk7XG59XG5cbmZ1bmN0aW9uIGhhc0NvbG9yT2Zmc2V0KG9mZnNldCkge1xuICByZXR1cm4gISFvZmZzZXQgJiYgU1VCVFlQX0NPTE9SX0NIQU5ORUxTLnNvbWUoKHsga2V5IH0pID0+IChvZmZzZXRba2V5XSA/PyAwKSAhPT0gMCk7XG59XG5cbi8vIEEgU3VidHlwJ3MgY29sb3IgKHRoZSBUWVAncyB3aGlsZSBpdCBoYXMgbm8gb2Zmc2V0KTsgbnVsbCBpZiB0aGUgVFlQIGl0c2VsZlxuLy8gaGFzIG5vIGNvbG9yLlxuZnVuY3Rpb24gc3VidHlwQ29sb3Ioc2V0dGluZ3MsIHR5cCwgc3VidHlwKSB7XG4gIGNvbnN0IHR5cENvbG9yID0gc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPz8gbnVsbDtcbiAgaWYgKCF0eXBDb2xvciB8fCAhc3VidHlwKSByZXR1cm4gdHlwQ29sb3I7XG4gIGNvbnN0IG9mZnNldCA9IGNsYW1wZWRPZmZzZXQoc2V0dGluZ3MsIGdldFN1YnR5cChzZXR0aW5ncywgdHlwLCBzdWJ0eXApPy5jb2xvcik7XG4gIHJldHVybiBoYXNDb2xvck9mZnNldChvZmZzZXQpID8gYXBwbHlDb2xvck9mZnNldCh0eXBDb2xvciwgb2Zmc2V0KSA6IHR5cENvbG9yO1xufVxuXG4vLyBEb2VzIHRoZSBTdWJ0eXAgaGF2ZSBhbiBvZmZzZXQgb2YgaXRzIG93biAoZWZmZWN0aXZlIHdpdGhpbiB0aGUgbGltaXRzKT9cbmZ1bmN0aW9uIHN1YnR5cEhhc093bkNvbG9yKHNldHRpbmdzLCB0eXAsIHN1YnR5cCkge1xuICByZXR1cm4gaGFzQ29sb3JPZmZzZXQoY2xhbXBlZE9mZnNldChzZXR0aW5ncywgZ2V0U3VidHlwKHNldHRpbmdzLCB0eXAsIHN1YnR5cCk/LmNvbG9yKSk7XG59XG5cbi8vIENvbG9yIG9mIGEgVFlQIG9yIFN1YnR5cCBuYW1lIC0gc2hhcmVkIGJ5IHRoZSBwaWNrZXIgKHR5cC1waWNrZXIuanMpIGFuZCB0aGVcbi8vIFN1YnR5cCBwcmV2aWV3IGluIHRoZSBUWVAtTGlzdCBzbyB0aGV5IGNhbid0IGRyaWZ0IGFwYXJ0LiBXaXRoIHN1YnR5cCwgdGhlXG4vLyBTdWJ0eXAgY29sb3IsIGJ1dCBvbmx5IGlmIHRoZSBcIlN1YnR5cFwiIHN1Yi10b2dnbGUgb2YgXCJUWVAtUGFuZVwiIGFsbG93cyBpdC5cbi8vIGlzRGVmYXVsdCBtZWFucyBhIGhvbGxvdyByaW5nIGluc3RlYWQgb2YgYSBmaWxsZWQgZG90IChzZWUgcGFpbnRDb2xvckRvdCkuXG5mdW5jdGlvbiBuYW1lQ29sb3Ioc2V0dGluZ3MsIHR5cCwgc3VidHlwID0gbnVsbCkge1xuICBjb25zdCB1c2VTdWJ0eXAgPSAhIXN1YnR5cCAmJiBzZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3RTdWJ0eXA7XG4gIGNvbnN0IHR5cENvbG9yID0gc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPz8gbnVsbDtcbiAgcmV0dXJuIHtcbiAgICBjb2xvcjogKHVzZVN1YnR5cCA/IHN1YnR5cENvbG9yKHNldHRpbmdzLCB0eXAsIHN1YnR5cCkgOiB0eXBDb2xvcikgPz8gREVGQVVMVF9UWVBfQ09MT1IsXG4gICAgaXNEZWZhdWx0OiAhdHlwQ29sb3IgfHwgKHVzZVN1YnR5cCAmJiAhc3VidHlwSGFzT3duQ29sb3Ioc2V0dGluZ3MsIHR5cCwgc3VidHlwKSksXG4gIH07XG59XG5cbi8vIENvbG9yIGRvdCAoVFlQLUxpc3QsIGRldGFpbCB2aWV3LCBwaWNrZXJzLCBkaWFsb2dzKTogZmlsbGVkIGZvciBhbiBvd25cbi8vIGNvbG9yLCBhIGhvbGxvdyByaW5nIGZvciB0aGUgZGVmYXVsdCAtIGdyYXkgZm9yIGEgVFlQIHdpdGhvdXQgYSBjb2xvciwgdGhlXG4vLyBpbmhlcml0ZWQgVFlQIGNvbG9yIGZvciBhIFN1YnR5cCB3aXRob3V0IGFuIG9mZnNldC5cbmZ1bmN0aW9uIHBhaW50Q29sb3JEb3QoZWwsIGNvbG9yLCBpc0RlZmF1bHQpIHtcbiAgZWwuc3R5bGUuYmFja2dyb3VuZENvbG9yID0gaXNEZWZhdWx0ID8gXCJ0cmFuc3BhcmVudFwiIDogY29sb3I7XG4gIGVsLnN0eWxlLmJveFNoYWRvdyA9IGlzRGVmYXVsdCA/IGBpbnNldCAwIDAgMCBtYXgoMS41cHgsIDAuMTVlbSkgJHtjb2xvcn1gIDogXCJcIjtcbn1cblxuLy8gdmlld0tleSAob3B0aW9uYWwpOiB0aGUgdmlldydzIGtleSBpbiBjb2xvclZpZXdzLiBJZiBpdHMgXCI8dmlld0tleT5TdWJ0eXBcIlxuLy8gc3ViLXRvZ2dsZSBpcyBvbiwgdGhlIG5vdGUncyBTdWJ0eXAgY29sb3IgaXMgdXNlZCBpbnN0ZWFkIG9mIGl0cyBUWVAncy5cbmZ1bmN0aW9uIGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIHZpZXdLZXkgPSBudWxsKSB7XG4gIGNvbnN0IHR5cCA9IHBsdWdpbi50eXBJbmRleC50eXBPZihmaWxlKTtcbiAgaWYgKCF0eXApIHJldHVybiBudWxsO1xuICBjb25zdCB7IHNldHRpbmdzIH0gPSBwbHVnaW47XG4gIGlmICghdmlld0tleSB8fCAhc2V0dGluZ3MuY29sb3JWaWV3c1tgJHt2aWV3S2V5fVN1YnR5cGBdKSByZXR1cm4gc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPz8gbnVsbDtcbiAgcmV0dXJuIHN1YnR5cENvbG9yKHNldHRpbmdzLCB0eXAsIHBsdWdpbi50eXBJbmRleC5zdWJ0eXBPZihmaWxlKSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBjb2xvckZvckZpbGUsXG4gIG5hbWVDb2xvcixcbiAgREVGQVVMVF9UWVBfQ09MT1IsXG4gIHN1YnR5cENvbG9yLFxuICBhcHBseUNvbG9yT2Zmc2V0LFxuICBoYXNDb2xvck9mZnNldCxcbiAgc3VidHlwSGFzT3duQ29sb3IsXG4gIHBhaW50Q29sb3JEb3QsXG4gIGNvbG9yUmFuZ2UsXG4gIGNoYW5uZWxCb3VuZHMsXG4gIGNsYW1wZWRPZmZzZXQsXG4gIFNVQlRZUF9DT0xPUl9DSEFOTkVMUyxcbiAgREVGQVVMVF9TVUJUWVBfQ09MT1JfUkFOR0VTLFxufTtcbiIsICJjb25zdCB7IFBsdWdpblNldHRpbmdUYWIsIFNldHRpbmdHcm91cCwgVG9nZ2xlQ29tcG9uZW50LCBEcm9wZG93bkNvbXBvbmVudCwgZGVib3VuY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgbW91bnRHbG9iYWxPcmRlckVkaXRvciB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItb3JkZXItZWRpdG9yXCIpO1xuY29uc3QgeyBERUZBVUxUX0dMT0JBTF9PUkRFUiB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItc29ydFwiKTtcbmNvbnN0IHsgU1VCVFlQX0NPTE9SX0NIQU5ORUxTLCBERUZBVUxUX1NVQlRZUF9DT0xPUl9SQU5HRVMsIGNvbG9yUmFuZ2UgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5cbmNvbnN0IERFRkFVTFRfU0VUVElOR1MgPSB7XG4gIHR5cHM6IFtdLFxuICB0eXBDb2xvcnM6IHt9LFxuICB0eXBEZXNjcmlwdGlvbnM6IHt9LFxuICB0eXBEZWZhdWx0RnJvbnRtYXR0ZXI6IHt9LFxuICAvLyBLZXlzIG9mIHR5cERlZmF1bHRGcm9udG1hdHRlclt0eXBdIG1hcmtlZCBhcyBmbG9hdGluZy4gVGhleSBzaGFyZSB0aGUgbGlzdFxuICAvLyBhbmQgaXRzIG9yZGVyICh3aGljaCBmcm9udG1hdHRlciBzb3J0aW5nIHVzZXMpLCBidXQgZ2V0VHlwRGVmYXVsdHMoKSBsZWF2ZXNcbiAgLy8gdGhlbSBvdXQgdW5sZXNzIGFza2VkIHdpdGggaW5jbHVkZUZsb2F0aW5nLCBzbyBuZXcgbm90ZXMgZG9uJ3QgZ2V0IHRoZW1cbiAgLy8gYXV0b21hdGljYWxseS5cbiAgdHlwRmxvYXRpbmdLZXlzOiB7fSxcbiAgLy8gU2hvcnRjdXRzIHBlciBrZXkgb2YgdHlwRGVmYXVsdEZyb250bWF0dGVyW3R5cF06XG4gIC8vICAgeyBbVFlQXTogeyBbUHJvcGVydHldOiB7IG5hbWU6IFwidG9kYXlcIiB8IFwidHAuPHNjcmlwdD5cIiB9IH0gfVxuICAvLyBLZXB0IE5FWFQgVE8gdGhlIGZyb250bWF0dGVyLCBub3QgYXMgaXRzIHZhbHVlIC0gc2VlIHNob3J0Y3V0cy5qcy5cbiAgdHlwU2hvcnRjdXRzOiB7fSxcbiAgdHlwTWFudWFsOiB7fSxcbiAgLy8gUmVnaXN0ZXJlZCBTdWJ0eXBzIHBlciBUWVAgd2l0aCB0aGVpciBvd24gZnJvbnRtYXR0ZXIgYmxvY2ssIHNlZSBzdWJ0eXBzLmpzLlxuICB0eXBTdWJ0eXBzOiB7fSxcbiAgLy8gUGlubmVkIHNpbmdsZSBwcm9wZXJ0aWVzIChraW5kOiBcInByb3BlcnR5XCIpIHBsdXMgdGhlIGZvdXIgZml4ZWRcbiAgLy8gcGxhY2Vob2xkZXJzIFwidHlwVmFsdWVcIiwgXCJzdWJ0eXBWYWx1ZVwiLCBcInR5cFwiIGFuZCBcIm90aGVyXCIgLSBzZWVcbiAgLy8gZnJvbnRtYXR0ZXItc29ydC5qcy5cbiAgZ2xvYmFsUHJvcGVydHlPcmRlcjogREVGQVVMVF9HTE9CQUxfT1JERVIsXG4gIC8vIEhvdyB0aGUgb3BlbiBub3RlIHNob3dzIGl0cyBUWVAgKHNlZSBhY3RpdmUtdGl0bGUtY29sb3JzLmpzKTogXCJub25lXCIsXG4gIC8vIFwiZG90XCIgb3IgXCJiYWRnZVwiLiBUaGUgdGhyZWUgYmFkZ2Ugc2V0dGluZ3MgYmVsb3cgb25seSBtYXR0ZXIgZm9yIFwiYmFkZ2VcIi5cbiAgLy8gY29sb3JWaWV3cy5ub3RlVGl0bGVDb2xvciAodGhlIHRpdGxlIHRleHQgaXRzZWxmKSBpcyBpbmRlcGVuZGVudC5cbiAgbm90ZVRpdGxlU3R5bGU6IFwiZG90XCIsXG4gIC8vIEJhZGdlIGNvbG9yZWQgKFRZUCBjb2xvcikgb3IgbmV1dHJhbCAodGV4dC1tdXRlZCkuXG4gIG5vdGVUaXRsZUJhZGdlQ29sb3JlZDogdHJ1ZSxcbiAgLy8gQmFkZ2UgbGFiZWw6IFwidHlwXCIgKFtUWVBdKSwgXCJ0eXAtc3VidHlwXCIgKFtUWVAvU3VidHlwXSkgb3IgXCJzdWJ0eXBcIlxuICAvLyAoW1N1YnR5cF07IG5vIGJhZGdlIHdpdGhvdXQgYSBTdWJ0eXApLiBDb2xvcmVkIGluIHRoZSBUWVAgb3IgU3VidHlwIGNvbG9yO1xuICAvLyBmb3IgXCJ0eXAtc3VidHlwXCIgY2hvc2VuIHdpdGggY29sb3JWaWV3cy5ub3RlVGl0bGVNYXJrZXJTdWJ0eXAuXG4gIG5vdGVUaXRsZUJhZGdlTGFiZWw6IFwidHlwXCIsXG4gIC8vIFwidGl0bGVcIiAobmV4dCB0byB0aGUgaW5saW5lIHRpdGxlKSBvciBcImJsb2NrXCIgKGxlZnQgb2YgdGhlIHByb3BlcnR5XG4gIC8vIGJsb2NrLCB0dXJuZWQgOTBcdTAwQjApLlxuICBub3RlVGl0bGVCYWRnZVBvc2l0aW9uOiBcInRpdGxlXCIsXG4gIC8vIEZvciBwb3NpdGlvbiBcImJsb2NrXCI6IHRvcCBvciBib3R0b20gZWRnZSBvZiB0aGUgcHJvcGVydHkgYmxvY2suXG4gIG5vdGVUaXRsZVZlcnRpY2FsQWxpZ246IFwidG9wXCIsXG4gIHR5cFNvcnRPcmRlcjogXCJjb3VudC1kZXNjXCIsXG4gIC8vIFdoYXQgdGhlIFRZUC1MaXN0IHNob3dzIG5leHQgdG8gdGhlIG5hbWU6IFwic3VidHlwc1wiLCBcImRlc2NyaXB0aW9uXCIgb3JcbiAgLy8gXCJub25lXCIuIFN3aXRjaGVkIGJ5IHRoZSBoZWFkZXIgYnV0dG9uIG5leHQgdG8gc29ydGluZyAoU0VDT05EQVJZX01PREVTIGluXG4gIC8vIHR5cC1wYW5lLmpzKSwgbm90IGhlcmU6IGxpa2UgdGhlIHNvcnQgb3JkZXIgaXQgb25seSBjb25jZXJucyB0aGF0IGxpc3QuXG4gIHR5cExpc3RTZWNvbmRhcnk6IFwic3VidHlwc1wiLFxuICAvLyBTZWUgcGlja1R5cEFuZFN1YnR5cCBpbiB0eXAtcGlja2VyLmpzOiBmYWxzZSA9IGVhY2ggU3VidHlwIGluZGVudGVkIGluIHRoZVxuICAvLyBUWVAtUGlja2VyLCB0cnVlID0gYSBzZXBhcmF0ZSBTdWJ0eXAtUGlja2VyIGFmdGVyIHRoZSBUWVAgY2hvaWNlLlxuICBzZXBhcmF0ZVN1YnR5cFBpY2tlcjogZmFsc2UsXG4gIGluY2x1ZGVJZ25vcmVkRmlsZXM6IGZhbHNlLFxuICAvLyBPd24gdGFnL2F0dGFjaG1lbnQgY29sb3JzIGluIHRoZSBncmFwaCBkaXNhYmxlZCAoMjAyNi0wOS0zMCk6IHRoZSBNaW5pbWFsXG4gIC8vIHRoZW1lJ3MgU3R5bGUgU2V0dGluZ3MgY292ZXIgYm90aCwgc2VlIGdyYXBoLWNvbG9ycy5qcy5cbiAgLy8gZ3JhcGhUYWdDb2xvckVuYWJsZWQ6IGZhbHNlLFxuICAvLyBncmFwaFRhZ0NvbG9yOiBcIlwiLFxuICAvLyBncmFwaEF0dGFjaG1lbnRDb2xvckVuYWJsZWQ6IGZhbHNlLFxuICAvLyBncmFwaEF0dGFjaG1lbnRDb2xvcjogXCJcIixcbiAgLy8gSG93IGZhciBhIFN1YnR5cCdzIGNvbG9yIG1heSBkaWZmZXIgZnJvbSBpdHMgVFlQJ3MgKFx1MDBCMSksIHNlZSB0eXAtY29sb3JzLmpzOlxuICAvLyBodWUgaW4gZGVncmVlcywgbGlnaHRuZXNzIGluICUgb2YgdGhlIHdheSB0byB3aGl0ZSBvciBibGFjay5cbiAgc3VidHlwQ29sb3JSYW5nZXM6IHsgLi4uREVGQVVMVF9TVUJUWVBfQ09MT1JfUkFOR0VTIH0sXG4gIGNvbG9yVmlld3M6IHtcbiAgICBmaWxlRXhwbG9yZXI6IHRydWUsXG4gICAgZ3JhcGg6IHRydWUsXG4gICAgc2VhcmNoOiB0cnVlLFxuICAgIHJlY2VudEZpbGVzOiB0cnVlLFxuICAgIGJhY2tsaW5rczogdHJ1ZSxcbiAgICBib29rbWFya3M6IHRydWUsXG4gICAgLy8gXCI8dmlldz5TdWJ0eXBcIiBzdWItdG9nZ2xlczogdXNlIGEgbm90ZSdzIFN1YnR5cCBjb2xvciBpbnN0ZWFkIG9mIGl0c1xuICAgIC8vIFRZUCdzIChzZWUgY29sb3JGb3JGaWxlIGluIHR5cC1jb2xvcnMuanMpLlxuICAgIGZpbGVFeHBsb3JlclN1YnR5cDogdHJ1ZSxcbiAgICBncmFwaFN1YnR5cDogdHJ1ZSxcbiAgICBzZWFyY2hTdWJ0eXA6IHRydWUsXG4gICAgcmVjZW50RmlsZXNTdWJ0eXA6IHRydWUsXG4gICAgYmFja2xpbmtzU3VidHlwOiB0cnVlLFxuICAgIGJvb2ttYXJrc1N1YnR5cDogdHJ1ZSxcbiAgICBsaW5rc1N1YnR5cDogdHJ1ZSxcbiAgICB0eXBMaXN0U3VidHlwOiB0cnVlLFxuICAgIG5vdGVUaXRsZUNvbG9yU3VidHlwOiB0cnVlLFxuICAgIG5vdGVUaXRsZU1hcmtlclN1YnR5cDogdHJ1ZSxcbiAgICBmcm9udG1hdHRlckRlZmF1bHRzOiB0cnVlLFxuICAgIC8vIFN1Yi10b2dnbGUgb2YgZnJvbnRtYXR0ZXJEZWZhdWx0cyBhbmQgYWxsUHJvcGVydGllczogaW5jbHVkZSB0aGUgU3VidHlwXG4gICAgLy8gYmxvY2tzIChzZWUgZnJvbnRtYXR0ZXItZGVmYXVsdC1oaWdobGlnaHQuanMpOyBmb3IgYWxsUHJvcGVydGllcyBhbHNvIGluXG4gICAgLy8gdGhlIFN1YnR5cCBjb2xvci5cbiAgICBmcm9udG1hdHRlckRlZmF1bHRzU3VidHlwOiB0cnVlLFxuICAgIHR5cExpc3Q6IHRydWUsXG4gICAgYWxsUHJvcGVydGllczogdHJ1ZSxcbiAgICBhbGxQcm9wZXJ0aWVzU3VidHlwOiB0cnVlLFxuICAgIG5vdGVUaXRsZUNvbG9yOiB0cnVlLFxuICAgIGxpbmtzOiB0cnVlLFxuICB9LFxufTtcblxuY2xhc3MgVHlwU3lzdGVtU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xuICBjb25zdHJ1Y3RvcihhcHAsIHBsdWdpbikge1xuICAgIHN1cGVyKGFwcCwgcGx1Z2luKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgfVxuXG4gIC8vIEVhY2ggc2VjdGlvbiBpcyBhIFNldHRpbmdHcm91cCAoaGVhZGluZyBwbHVzIG9uZSBib3gsIGVudHJpZXMgc2VwYXJhdGVkIGJ5XG4gIC8vIGxpbmVzKSwgbGlrZSBPYnNpZGlhbidzIGNvcmUgc2V0dGluZ3MuIFNldHRpbmdzIGNyZWF0ZWQgb25lIGJ5IG9uZSB3aXRoXG4gIC8vIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKSB3b3VsZCBlYWNoIGdldCB0aGVpciBvd24gc21hbGwgYm94LlxuICBkaXNwbGF5KCkge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgLy8gS2VlcCB0aGUgc2Nyb2xsIHBvc2l0aW9uIGFjcm9zcyByZWJ1aWxkcyAodG9nZ2xlcyB3aXRoIHN1Yi1vcHRpb25zIGNhbGxcbiAgICAvLyBkaXNwbGF5KCkpOiB0aGUgVFlQIG1hcmtlciBkcm9wZG93biBtZWFzdXJlcyBpdHNlbGYgb24gc2V0VmFsdWUoKSBhbmRcbiAgICAvLyBmb3JjZXMgYSBsYXlvdXQgd2hpbGUgdGhlIHBhZ2UgaXMgb25seSBwYXJ0bHkgYnVpbHQsIHNvIHRoZSBicm93c2VyXG4gICAgLy8gY2xhbXBzIHNjcm9sbFRvcCB0byB0aGF0IGhlaWdodCBhbmQgdGhlIHBhZ2Ugd291bGQganVtcCB1cC5cbiAgICBjb25zdCB7IHNjcm9sbFRvcCB9ID0gY29udGFpbmVyRWw7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcblxuICAgIG5ldyBTZXR0aW5nR3JvdXAoY29udGFpbmVyRWwpXG4gICAgICAuc2V0SGVhZGluZyhcIlRZUC1MaXN0XCIpXG4gICAgICAuYWRkU2V0dGluZygoc2V0dGluZykgPT5cbiAgICAgICAgc2V0dGluZ1xuICAgICAgICAgIC5zZXROYW1lKFwiSW5jbHVkZSBleGNsdWRlZCBmaWxlc1wiKVxuICAgICAgICAgIC5zZXREZXNjKFxuICAgICAgICAgICAgXCJDb3VudCBub3RlcyBmcm9tIE9ic2lkaWFuJ3MgXFxcIkV4Y2x1ZGVkIGZpbGVzXFxcIiAoZS5nLiBmb2xkZXJzIGhpZGRlbiBieSBIaWRlIEZvbGRlcnMpIGluIFRZUCBjb3VudHMsIHRoZSBUWVAtUGlja2VyIGFuZCBmcm9udG1hdHRlciBzb3J0aW5nLlwiXG4gICAgICAgICAgKVxuICAgICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5pbmNsdWRlSWdub3JlZEZpbGVzKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuaW5jbHVkZUlnbm9yZWRGaWxlcyA9IHZhbHVlO1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgICAgICB9KVxuICAgICAgICAgIClcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZ0dyb3VwKGNvbnRhaW5lckVsKS5zZXRIZWFkaW5nKFwiVFlQLVBpY2tlclwiKS5hZGRTZXR0aW5nKChzZXR0aW5nKSA9PlxuICAgICAgc2V0dGluZ1xuICAgICAgICAuc2V0TmFtZShcIlNlcGFyYXRlIFN1YnR5cC1QaWNrZXJcIilcbiAgICAgICAgLnNldERlc2MoXG4gICAgICAgICAgXCJBZnRlciBjaG9vc2luZyBhIFRZUCwgY2hvb3NlIHRoZSBTdWJ0eXAgaW4gYSBzZWNvbmQgcGlja2VyLiBXaGVuIG9mZiwgZWFjaCBTdWJ0eXAgaXMgbGlzdGVkIGluZGVudGVkIGJlbG93IGl0cyBUWVAuXCJcbiAgICAgICAgKVxuICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLnNlcGFyYXRlU3VidHlwUGlja2VyKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnNlcGFyYXRlU3VidHlwUGlja2VyID0gdmFsdWU7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KVxuICAgICAgICApXG4gICAgKTtcblxuICAgIC8vIHN1YnR5cEtleSAob3B0aW9uYWwpOiB0d28gbGFiZWxlZCB0b2dnbGVzIGluc3RlYWQgb2Ygb25lIC0gXCJUWVBcIiBmb3IgdGhlXG4gICAgLy8gc2V0dGluZyBpdHNlbGYgYW5kIGJlbG93IGl0IFwiU3VidHlwXCIsIHNob3duIG9ubHkgd2hpbGUgXCJUWVBcIiBpcyBvbi4gVGhlXG4gICAgLy8gZGVmYXVsdCB0b29sdGlwcyBmaXQgdGhlIGNvbG9yaW5nIHRvZ2dsZXMuXG4gICAgY29uc3QgY29sb3JWaWV3VG9nZ2xlID0gKFxuICAgICAgZ3JvdXAsXG4gICAgICBrZXksXG4gICAgICBuYW1lLFxuICAgICAgZGVzYyxcbiAgICAgIHN1YnR5cEtleSA9IG51bGwsXG4gICAgICB7IHR5cFRvb2x0aXAgPSBcIkNvbG9yIGJ5IFRZUFwiLCBzdWJ0eXBUb29sdGlwID0gXCJVc2UgU3VidHlwIGNvbG9yIGluc3RlYWQgb2YgVFlQIGNvbG9yXCIgfSA9IHt9XG4gICAgKSA9PlxuICAgICAgZ3JvdXAuYWRkU2V0dGluZygoc2V0dGluZykgPT4ge1xuICAgICAgICBzZXR0aW5nLnNldE5hbWUobmFtZSkuc2V0RGVzYyhkZXNjKTtcbiAgICAgICAgY29uc3Qgc2F2ZSA9IGFzeW5jIChzZXR0aW5nS2V5LCB2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Nbc2V0dGluZ0tleV0gPSB2YWx1ZTtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgICAgfTtcblxuICAgICAgICBpZiAoIXN1YnR5cEtleSkge1xuICAgICAgICAgIHNldHRpbmcuYWRkVG9nZ2xlKCh0b2dnbGUpID0+IHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzW2tleV0pLm9uQ2hhbmdlKCh2YWx1ZSkgPT4gc2F2ZShrZXksIHZhbHVlKSkpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHNldHRpbmcuc2V0dGluZ0VsLmFkZENsYXNzKFwidHlwLW5vdGUtdGl0bGUtc2V0dGluZ1wiKTtcbiAgICAgICAgY29uc3QgYWRkUm93ID0gKGxhYmVsLCB0b29sdGlwLCBzZXR0aW5nS2V5LCBvbkNoYW5nZWQpID0+IHtcbiAgICAgICAgICBjb25zdCByb3cgPSBzZXR0aW5nLmNvbnRyb2xFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLW5vdGUtdGl0bGUtdG9nZ2xlLXJvd1wiIH0pO1xuICAgICAgICAgIHJvdy5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1ub3RlLXRpdGxlLXRvZ2dsZS1sYWJlbFwiLCB0ZXh0OiBsYWJlbCB9KTtcbiAgICAgICAgICBuZXcgVG9nZ2xlQ29tcG9uZW50KHJvdylcbiAgICAgICAgICAgIC5zZXRUb29sdGlwKHRvb2x0aXApXG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3c1tzZXR0aW5nS2V5XSlcbiAgICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgYXdhaXQgc2F2ZShzZXR0aW5nS2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICAgIG9uQ2hhbmdlZD8uKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfTtcbiAgICAgICAgYWRkUm93KFwiVFlQXCIsIHR5cFRvb2x0aXAsIGtleSwgKCkgPT4gdGhpcy5kaXNwbGF5KCkpO1xuICAgICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3c1trZXldKSBhZGRSb3coXCJTdWJ0eXBcIiwgc3VidHlwVG9vbHRpcCwgc3VidHlwS2V5KTtcbiAgICAgIH0pO1xuXG4gICAgY29uc3QgY29sb3JpbmdHcm91cCA9IG5ldyBTZXR0aW5nR3JvdXAoY29udGFpbmVyRWwpLnNldEhlYWRpbmcoXCJDb2xvcmluZ1wiKTtcblxuICAgIGNvbG9yVmlld1RvZ2dsZShjb2xvcmluZ0dyb3VwLCBcImZpbGVFeHBsb3JlclwiLCBcIkZpbGUgZXhwbG9yZXJcIiwgXCJDb2xvciBub3RlIG5hbWVzIGluIHRoZSBmaWxlIGV4cGxvcmVyLlwiLCBcImZpbGVFeHBsb3JlclN1YnR5cFwiKTtcbiAgICBjb2xvclZpZXdUb2dnbGUoY29sb3JpbmdHcm91cCwgXCJncmFwaFwiLCBcIkdyYXBoXCIsIFwiQ29sb3Igbm9kZXMgaW4gdGhlIGdsb2JhbCBhbmQgbG9jYWwgZ3JhcGguXCIsIFwiZ3JhcGhTdWJ0eXBcIik7XG4gICAgY29sb3JWaWV3VG9nZ2xlKGNvbG9yaW5nR3JvdXAsIFwic2VhcmNoXCIsIFwiU2VhcmNoXCIsIFwiQ29sb3IgcmVzdWx0IHRpdGxlcyBpbiBzZWFyY2guXCIsIFwic2VhcmNoU3VidHlwXCIpO1xuICAgIGNvbG9yVmlld1RvZ2dsZShjb2xvcmluZ0dyb3VwLCBcInJlY2VudEZpbGVzXCIsIFwiUmVjZW50IEZpbGVzXCIsIFwiQ29sb3IgZW50cmllcyBpbiB0aGUgUmVjZW50IEZpbGVzIHBsdWdpbi5cIiwgXCJyZWNlbnRGaWxlc1N1YnR5cFwiKTtcbiAgICBjb2xvclZpZXdUb2dnbGUoXG4gICAgICBjb2xvcmluZ0dyb3VwLFxuICAgICAgXCJsaW5rc1wiLFxuICAgICAgXCJMaW5rcyBpbiBub3Rlc1wiLFxuICAgICAgXCJDb2xvciBpbnRlcm5hbCBsaW5rcyBieSB0aGUgVFlQIG9mIHRoZWlyIHRhcmdldCAocmVhZGluZyB2aWV3LCBMaXZlIFByZXZpZXcsIGhvdmVyIHByZXZpZXcpLiBVbnJlc29sdmVkIGxpbmtzIHN0YXkgYXMgdGhleSBhcmUuXCIsXG4gICAgICBcImxpbmtzU3VidHlwXCJcbiAgICApO1xuICAgIGNvbG9yVmlld1RvZ2dsZShjb2xvcmluZ0dyb3VwLCBcInR5cExpc3RcIiwgXCJUWVAtUGFuZVwiLCBcIkNvbG9yIG5hbWVzIGluIHRoZSBUWVAtUGFuZSBhbmQgVFlQLVBpY2tlci5cIiwgXCJ0eXBMaXN0U3VidHlwXCIpO1xuICAgIGNvbG9yVmlld1RvZ2dsZShcbiAgICAgIGNvbG9yaW5nR3JvdXAsXG4gICAgICBcIm5vdGVUaXRsZUNvbG9yXCIsXG4gICAgICBcIkNvbG9yIG5vdGUgdGl0bGVcIixcbiAgICAgIFwiQ29sb3IgdGhlIGlubGluZSB0aXRsZSBvZiB0aGUgb3BlbiBub3RlLlwiLFxuICAgICAgXCJub3RlVGl0bGVDb2xvclN1YnR5cFwiXG4gICAgKTtcblxuICAgIC8vIFByb2dyZXNzaXZlIGRpc2Nsb3N1cmU6IFwiYmFkZ2VcIiBhZGRzIHRvZ2dsZXMgKGNvbG9yLCBwb3NpdGlvbikgdG8gdGhpc1xuICAgIC8vIG9uZSBzZXR0aW5nIHJvdywgcG9zaXRpb24gXCJibG9ja1wiIG9uZSBtb3JlIChhbGlnbm1lbnQpLiBFYWNoIHJlLXJlbmRlcnNcbiAgICAvLyB2aWEgZGlzcGxheSgpIHNvIG9ubHkgdGhlIHJlbGV2YW50IG9uZXMgc2hvdy5cbiAgICBjb25zdCBpc0JhZGdlID0gdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlU3R5bGUgPT09IFwiYmFkZ2VcIjtcbiAgICBjb25zdCBpc0Jsb2NrUG9zaXRpb24gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZVBvc2l0aW9uID09PSBcImJsb2NrXCI7XG5cbiAgICBjb2xvcmluZ0dyb3VwLmFkZFNldHRpbmcoKG5vdGVUaXRsZVNldHRpbmcpID0+IHtcbiAgICAgIG5vdGVUaXRsZVNldHRpbmdcbiAgICAgICAgLnNldE5hbWUoXCJUWVAgbWFya2VyIGluIG5vdGVcIilcbiAgICAgICAgLnNldERlc2MoaXNCYWRnZSA/IFwiQmFkZ2Ugb3B0aW9uczogbGFiZWwsIGNvbG9yLCBwb3NpdGlvbi5cIiA6IFwiSG93IHRoZSBvcGVuIG5vdGUgc2hvd3MgaXRzIFRZUC5cIilcbiAgICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT5cbiAgICAgICAgICBkcm9wZG93blxuICAgICAgICAgICAgLmFkZE9wdGlvbihcIm5vbmVcIiwgXCJOb25lXCIpXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwiZG90XCIsIFwiRG90IGF0IHRpdGxlXCIpXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwiYmFkZ2VcIiwgXCJCYWRnZSB3aXRoIFRZUCBuYW1lXCIpXG4gICAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlU3R5bGUpXG4gICAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVN0eWxlID0gdmFsdWU7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgICAgICB9KVxuICAgICAgICApO1xuXG4gICAgICAvLyBcIlN1YnR5cFwiIChTdWJ0eXAgY29sb3IgaW5zdGVhZCBvZiBUWVAgY29sb3IpIG9ubHkgd2hpbGUgdGhlIG1hcmtlciBpc1xuICAgICAgLy8gY29sb3JlZCBhdCBhbGw6IGFsd2F5cyBmb3IgdGhlIGRvdCwgZm9yIHRoZSBiYWRnZSBvbmx5IHdpdGggXCJDb2xvcmVkXCJcbiAgICAgIC8vIGFuZCBsYWJlbCBbVFlQL1N1YnR5cF0gLSB3aXRoIFtUWVBdIG9yIFtTdWJ0eXBdIHRoZSBjb2xvciBmb2xsb3dzIHRoZVxuICAgICAgLy8gbGFiZWwuXG4gICAgICBjb25zdCBiYWRnZUxhYmVsID0gdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VMYWJlbCA/PyBcInR5cFwiO1xuICAgICAgY29uc3Qgc2hvd1N1YnR5cCA9XG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVN0eWxlID09PSBcImRvdFwiIHx8XG4gICAgICAgIChpc0JhZGdlICYmIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlQ29sb3JlZCAmJiBiYWRnZUxhYmVsID09PSBcInR5cC1zdWJ0eXBcIik7XG4gICAgICBpZiAoIWlzQmFkZ2UgJiYgIXNob3dTdWJ0eXApIHJldHVybjtcblxuICAgICAgLy8gU3RhY2tzIHRoZSBleHRyYSB0b2dnbGVzIGluc3RlYWQgb2YgT2JzaWRpYW4ncyBzaWRlLWJ5LXNpZGUgbGF5b3V0LFxuICAgICAgLy8gc2VlIC50eXAtbm90ZS10aXRsZS1zZXR0aW5nIGluIHN0eWxlcy5jc3MuXG4gICAgICBub3RlVGl0bGVTZXR0aW5nLnNldHRpbmdFbC5hZGRDbGFzcyhcInR5cC1ub3RlLXRpdGxlLXNldHRpbmdcIik7XG5cbiAgICAgIC8vIEEgc21hbGwgbGFiZWwgcGVyIHRvZ2dsZSAtIGFkZFRvZ2dsZSgpIGFsb25lIGFkZHMgYSBiYXJlIHN3aXRjaC5cbiAgICAgIGNvbnN0IGFkZExhYmVsZWRUb2dnbGUgPSAobGFiZWwsIHRvb2x0aXAsIHZhbHVlLCBvbkNoYW5nZSkgPT4ge1xuICAgICAgICBjb25zdCByb3cgPSBub3RlVGl0bGVTZXR0aW5nLmNvbnRyb2xFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLW5vdGUtdGl0bGUtdG9nZ2xlLXJvd1wiIH0pO1xuICAgICAgICByb3cuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtbm90ZS10aXRsZS10b2dnbGUtbGFiZWxcIiwgdGV4dDogbGFiZWwgfSk7XG4gICAgICAgIG5ldyBUb2dnbGVDb21wb25lbnQocm93KS5zZXRUb29sdGlwKHRvb2x0aXApLnNldFZhbHVlKHZhbHVlKS5vbkNoYW5nZShvbkNoYW5nZSk7XG4gICAgICB9O1xuXG4gICAgICBjb25zdCBhZGRTdWJ0eXBUb2dnbGUgPSAobGFiZWwpID0+XG4gICAgICAgIGFkZExhYmVsZWRUb2dnbGUoXG4gICAgICAgICAgbGFiZWwsXG4gICAgICAgICAgXCJVc2UgU3VidHlwIGNvbG9yIGluc3RlYWQgb2YgVFlQIGNvbG9yXCIsXG4gICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5ub3RlVGl0bGVNYXJrZXJTdWJ0eXAsXG4gICAgICAgICAgYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLm5vdGVUaXRsZU1hcmtlclN1YnR5cCA9IHZhbHVlO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgICAgICB9XG4gICAgICAgICk7XG5cbiAgICAgIGlmICghaXNCYWRnZSkge1xuICAgICAgICBhZGRTdWJ0eXBUb2dnbGUoXCJTdWJ0eXBcIik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgY29uc3QgbGFiZWxSb3cgPSBub3RlVGl0bGVTZXR0aW5nLmNvbnRyb2xFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLW5vdGUtdGl0bGUtdG9nZ2xlLXJvd1wiIH0pO1xuICAgICAgbGFiZWxSb3cuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtbm90ZS10aXRsZS10b2dnbGUtbGFiZWxcIiwgdGV4dDogXCJMYWJlbFwiIH0pO1xuICAgICAgbmV3IERyb3Bkb3duQ29tcG9uZW50KGxhYmVsUm93KVxuICAgICAgICAuYWRkT3B0aW9uKFwidHlwXCIsIFwiW1RZUF1cIilcbiAgICAgICAgLmFkZE9wdGlvbihcInR5cC1zdWJ0eXBcIiwgXCJbVFlQL1N1YnR5cF1cIilcbiAgICAgICAgLmFkZE9wdGlvbihcInN1YnR5cFwiLCBcIltTdWJ0eXBdXCIpXG4gICAgICAgIC5zZXRWYWx1ZShiYWRnZUxhYmVsKVxuICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VMYWJlbCA9IHZhbHVlO1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICB9KTtcblxuICAgICAgYWRkTGFiZWxlZFRvZ2dsZShcIkNvbG9yZWRcIiwgXCJDb2xvcmVkIGluc3RlYWQgb2YgbmV1dHJhbFwiLCB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUNvbG9yZWQsIGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUNvbG9yZWQgPSB2YWx1ZTtcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgIH0pO1xuICAgICAgaWYgKHNob3dTdWJ0eXApIGFkZFN1YnR5cFRvZ2dsZShcIlN1YnR5cCBjb2xvclwiKTtcblxuICAgICAgYWRkTGFiZWxlZFRvZ2dsZShcIkF0IHByb3BlcnR5IGJsb2NrXCIsIFwiQXQgdGhlIHByb3BlcnR5IGJsb2NrIChyb3RhdGVkKSBpbnN0ZWFkIG9mIHRoZSB0aXRsZVwiLCBpc0Jsb2NrUG9zaXRpb24sIGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZVBvc2l0aW9uID0gdmFsdWUgPyBcImJsb2NrXCIgOiBcInRpdGxlXCI7XG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICB9KTtcblxuICAgICAgaWYgKGlzQmxvY2tQb3NpdGlvbikge1xuICAgICAgICBhZGRMYWJlbGVkVG9nZ2xlKFxuICAgICAgICAgIFwiVG9wIGluc3RlYWQgb2YgYm90dG9tXCIsXG4gICAgICAgICAgXCJUb3Agb2YgdGhlIHByb3BlcnR5IGJsb2NrIGluc3RlYWQgb2YgYm90dG9tXCIsXG4gICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlVmVydGljYWxBbGlnbiA9PT0gXCJ0b3BcIixcbiAgICAgICAgICBhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVZlcnRpY2FsQWxpZ24gPSB2YWx1ZSA/IFwidG9wXCIgOiBcImJvdHRvbVwiO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgICAgICB9XG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBjb2xvclZpZXdUb2dnbGUoXG4gICAgICBjb2xvcmluZ0dyb3VwLFxuICAgICAgXCJiYWNrbGlua3NcIixcbiAgICAgIFwiQmFja2xpbmtzXCIsXG4gICAgICBcIkNvbG9yIHJlc3VsdHMgaW4gdGhlIGJhY2tsaW5rcyBwYW5lIGFuZCBpbiBlbWJlZGRlZCBiYWNrbGlua3MsIGluY2x1ZGluZyB1bmxpbmtlZCBtZW50aW9ucy5cIixcbiAgICAgIFwiYmFja2xpbmtzU3VidHlwXCJcbiAgICApO1xuICAgIGNvbG9yVmlld1RvZ2dsZShjb2xvcmluZ0dyb3VwLCBcImJvb2ttYXJrc1wiLCBcIkJvb2ttYXJrc1wiLCBcIkNvbG9yIGJvb2ttYXJrcyB0aGF0IHBvaW50IGRpcmVjdGx5IHRvIGEgbm90ZS5cIiwgXCJib29rbWFya3NTdWJ0eXBcIik7XG4gICAgY29sb3JWaWV3VG9nZ2xlKFxuICAgICAgY29sb3JpbmdHcm91cCxcbiAgICAgIFwiYWxsUHJvcGVydGllc1wiLFxuICAgICAgXCJBbGwgUHJvcGVydGllc1wiLFxuICAgICAgXCJJbiBPYnNpZGlhbidzIFxcXCJBbGwgcHJvcGVydGllc1xcXCIgdmlldywgY29sb3IgcHJvcGVydHkgbmFtZXMgdGhhdCBiZWxvbmcgdG8gZXhhY3RseSBvbmUgVFlQLUZyb250bWF0dGVyLCBvciBib2xkIHRoZW0gaWYgbW9yZSB0aGFuIG9uZSBUWVAgdXNlcyB0aGVtLiBXaXRoIFN1YnR5cCwgU3VidHlwIGJsb2NrcyBjb3VudCBhcyB3ZWxsLCBpbiB0aGUgU3VidHlwIGNvbG9yLlwiLFxuICAgICAgXCJhbGxQcm9wZXJ0aWVzU3VidHlwXCIsXG4gICAgICB7IHR5cFRvb2x0aXA6IFwiVFlQLUZyb250bWF0dGVyXCIsIHN1YnR5cFRvb2x0aXA6IFwiSW5jbHVkZSBTdWJ0eXAgYmxvY2tzLCBpbiBTdWJ0eXAgY29sb3JcIiB9XG4gICAgKTtcblxuICAgIC8vIExpbWl0cyBvZiB0aGUgc2xpZGVycyBhIFN1YnR5cCBkZXJpdmVzIGl0cyBjb2xvciB3aXRoIChkb3QgYXQgdGhlIGJvdHRvbVxuICAgIC8vIG9mIGEgU3VidHlwIGJsb2NrLCBzZWUgdHlwLWNvbG9ycy5qcykuIEEgbGFyZ2VyIHN0b3JlZCBvZmZzZXQgaXMgY2xhbXBlZFxuICAgIC8vIHRvIHRoZSBuZXcgbGltaXQuXG4gICAgY29uc3Qgc3VidHlwQ29sb3JHcm91cCA9IG5ldyBTZXR0aW5nR3JvdXAoY29udGFpbmVyRWwpLnNldEhlYWRpbmcoXCJTdWJ0eXAgY29sb3JzXCIpO1xuICAgIGNvbnN0IHJhbmdlTWF4ID0geyBoOiAxODAsIC8qIHM6IDEwMCwgKi8gbDogMTAwIH07XG4gICAgY29uc3QgcmFuZ2VEZXNjID0ge1xuICAgICAgaDogXCJNYXhpbXVtIGh1ZSBkaWZmZXJlbmNlIGJldHdlZW4gYSBTdWJ0eXAgYW5kIGl0cyBUWVAuXCIsXG4gICAgICAvLyBzOiBcIk1heGltdW0gc2hhcmUgYnkgd2hpY2ggYSBTdWJ0eXAgbWF5IGJlIHBhbGVyIHRoYW4gaXRzIFRZUC4gT25seSBnb2VzIGRvd24gLSBhIFN1YnR5cCBzaG91bGRuJ3QgYmUgbG91ZGVyIHRoYW4gaXRzIFRZUC5cIixcbiAgICAgIGw6IFwiTWF4aW11bSBsaWdodG5lc3MgZGlmZmVyZW5jZSBiZXR3ZWVuIGEgU3VidHlwIGFuZCBpdHMgVFlQLCBhcyBhIHNoYXJlIG9mIHRoZSB3YXkgdG8gd2hpdGUgb3IgYmxhY2suXCIsXG4gICAgfTtcbiAgICAvLyBUaGUgc2xpZGVyIHJlcG9ydHMgZXZlcnkgc3RlcDsgdGhlIG90aGVyIHZpZXdzIG9ubHkgZm9sbG93IG9uY2UgaXQgcmVzdHMuXG4gICAgY29uc3QgcmVmcmVzaENvbG9yc1Nvb24gPSBkZWJvdW5jZSgoKSA9PiB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKSwgMzAwLCB0cnVlKTtcbiAgICBmb3IgKGNvbnN0IHsga2V5LCBsYWJlbCwgdW5pdCwgZG93bk9ubHkgfSBvZiBTVUJUWVBfQ09MT1JfQ0hBTk5FTFMpIHtcbiAgICAgIHN1YnR5cENvbG9yR3JvdXAuYWRkU2V0dGluZygoc2V0dGluZykgPT5cbiAgICAgICAgc2V0dGluZ1xuICAgICAgICAgIC5zZXROYW1lKGAke2xhYmVsfSAoJHtkb3duT25seSA/IFwiXHUyMjEyXCIgOiBcIlx1MDBCMVwifSAke3VuaXR9KWApXG4gICAgICAgICAgLnNldERlc2MocmFuZ2VEZXNjW2tleV0pXG4gICAgICAgICAgLmFkZFNsaWRlcigoc2xpZGVyKSA9PlxuICAgICAgICAgICAgc2xpZGVyXG4gICAgICAgICAgICAgIC5zZXRMaW1pdHMoMCwgcmFuZ2VNYXhba2V5XSwgMSlcbiAgICAgICAgICAgICAgLnNldFZhbHVlKGNvbG9yUmFuZ2UodGhpcy5wbHVnaW4uc2V0dGluZ3MsIGtleSkpXG4gICAgICAgICAgICAgIC5zZXREeW5hbWljVG9vbHRpcCgpXG4gICAgICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5zdWJ0eXBDb2xvclJhbmdlcyA9IHsgLi4uREVGQVVMVF9TVUJUWVBfQ09MT1JfUkFOR0VTLCAuLi50aGlzLnBsdWdpbi5zZXR0aW5ncy5zdWJ0eXBDb2xvclJhbmdlcywgW2tleV06IHZhbHVlIH07XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICAgICAgcmVmcmVzaENvbG9yc1Nvb24oKTtcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICApXG4gICAgICAgICAgLmFkZEV4dHJhQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgICAgICBidXR0b25cbiAgICAgICAgICAgICAgLnNldEljb24oXCJyb3RhdGUtY2N3XCIpXG4gICAgICAgICAgICAgIC5zZXRUb29sdGlwKGBSZXNldCB0byAke0RFRkFVTFRfU1VCVFlQX0NPTE9SX1JBTkdFU1trZXldfWApXG4gICAgICAgICAgICAgIC5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5zdWJ0eXBDb2xvclJhbmdlcyA9IHsgLi4uREVGQVVMVF9TVUJUWVBfQ09MT1JfUkFOR0VTLCAuLi50aGlzLnBsdWdpbi5zZXR0aW5ncy5zdWJ0eXBDb2xvclJhbmdlcywgW2tleV06IERFRkFVTFRfU1VCVFlQX0NPTE9SX1JBTkdFU1trZXldIH07XG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgKVxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBHcm91cCBcIkdyYXBoXCIgKHRhZy9hdHRhY2htZW50IGNvbG9ycykgZGlzYWJsZWQgKDIwMjYtMDktMzApOiB0aGUgTWluaW1hbFxuICAgIC8vIHRoZW1lJ3MgU3R5bGUgU2V0dGluZ3MgY292ZXIgYm90aCwgc2VlIGdyYXBoLWNvbG9ycy5qcy4gQ29sb3Jpbmcgbm90ZVxuICAgIC8vIG5vZGVzIGJ5IFRZUCBzdGF5cywgdW5kZXIgXCJDb2xvcmluZ1wiIFx1MjE5MiBcIkdyYXBoXCIuXG4gICAgLy8gICAgIGNvbnN0IGdyYXBoR3JvdXAgPSBuZXcgU2V0dGluZ0dyb3VwKGNvbnRhaW5lckVsKS5zZXRIZWFkaW5nKFwiR3JhcGhcIik7XG4gICAgLy9cbiAgICAvLyAgICAgLy8gT25lIHNldHRpbmcgcGVyIG5vZGUga2luZCB0aGUgZ3JhcGggZW5naW5lIGtub3dzLCBzYW1lIGxheW91dFxuICAgIC8vICAgICAvLyAodG9nZ2xlICsgY29sb3IgcGlja2VyICsgcmVzZXQpIGZvciBlYWNoLlxuICAgIC8vICAgICBjb25zdCBncmFwaENvbG9yU2V0dGluZyA9IChlbmFibGVkS2V5LCBjb2xvcktleSwgZGVmYXVsdENvbG9yLCBuYW1lLCBkZXNjKSA9PlxuICAgIC8vICAgICAgIGdyYXBoR3JvdXAuYWRkU2V0dGluZygoc2V0dGluZykgPT5cbiAgICAvLyAgICAgICAgIHNldHRpbmdcbiAgICAvLyAgICAgICAgICAgLnNldE5hbWUobmFtZSlcbiAgICAvLyAgICAgICAgICAgLnNldERlc2MoZGVzYylcbiAgICAvLyAgICAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgIC8vICAgICAgICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5nc1tlbmFibGVkS2V5XSkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgLy8gICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5nc1tlbmFibGVkS2V5XSA9IHZhbHVlO1xuICAgIC8vICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgLy8gICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAvLyAgICAgICAgICAgICB9KVxuICAgIC8vICAgICAgICAgICApXG4gICAgLy8gICAgICAgICAgIC5hZGRDb2xvclBpY2tlcigocGlja2VyKSA9PlxuICAgIC8vICAgICAgICAgICAgIHBpY2tlci5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5nc1tjb2xvcktleV0gfHwgZGVmYXVsdENvbG9yKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAvLyAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzW2NvbG9yS2V5XSA9IHZhbHVlO1xuICAgIC8vICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgLy8gICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAvLyAgICAgICAgICAgICB9KVxuICAgIC8vICAgICAgICAgICApXG4gICAgLy8gICAgICAgICAgIC5hZGRFeHRyYUJ1dHRvbigoYnV0dG9uKSA9PlxuICAgIC8vICAgICAgICAgICAgIGJ1dHRvblxuICAgIC8vICAgICAgICAgICAgICAgLnNldEljb24oXCJyb3RhdGUtY2N3XCIpXG4gICAgLy8gICAgICAgICAgICAgICAuc2V0VG9vbHRpcChcIlJlc2V0IHRvIGRlZmF1bHQgY29sb3JcIilcbiAgICAvLyAgICAgICAgICAgICAgIC5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAvLyAgICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3NbY29sb3JLZXldID0gXCJcIjtcbiAgICAvLyAgICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgLy8gICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgIC8vICAgICAgICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAvLyAgICAgICAgICAgICAgIH0pXG4gICAgLy8gICAgICAgICAgIClcbiAgICAvLyAgICAgICApO1xuICAgIC8vXG4gICAgLy8gICAgIGdyYXBoQ29sb3JTZXR0aW5nKFxuICAgIC8vICAgICAgIFwiZ3JhcGhUYWdDb2xvckVuYWJsZWRcIixcbiAgICAvLyAgICAgICBcImdyYXBoVGFnQ29sb3JcIixcbiAgICAvLyAgICAgICBcIiM4ODg4ODhcIixcbiAgICAvLyAgICAgICBcIlRhZyBjb2xvclwiLFxuICAgIC8vICAgICAgIFwiT3duIGNvbG9yIGZvciB0YWcgbm9kZXMgaW4gdGhlIGdsb2JhbCBhbmQgbG9jYWwgZ3JhcGguIENvbG9yIGdyb3VwcyBzdGlsbCB0YWtlIHByZWNlZGVuY2UuXCJcbiAgICAvLyAgICAgKTtcbiAgICAvLyAgICAgZ3JhcGhDb2xvclNldHRpbmcoXG4gICAgLy8gICAgICAgXCJncmFwaEF0dGFjaG1lbnRDb2xvckVuYWJsZWRcIixcbiAgICAvLyAgICAgICBcImdyYXBoQXR0YWNobWVudENvbG9yXCIsXG4gICAgLy8gICAgICAgXCIjZTBhYzAwXCIsXG4gICAgLy8gICAgICAgXCJBdHRhY2htZW50IGNvbG9yXCIsXG4gICAgLy8gICAgICAgXCJPd24gY29sb3IgZm9yIGF0dGFjaG1lbnQgbm9kZXMgKG5vbi1tYXJrZG93biBmaWxlcyBzdWNoIGFzIGltYWdlcyBvciBQREZzKSBpbiB0aGUgZ3JhcGguXCJcbiAgICAvLyAgICAgKTtcblxuICAgIGNvbnN0IGZyb250bWF0dGVyR3JvdXAgPSBuZXcgU2V0dGluZ0dyb3VwKGNvbnRhaW5lckVsKS5zZXRIZWFkaW5nKFwiVFlQLUZyb250bWF0dGVyXCIpO1xuXG4gICAgY29sb3JWaWV3VG9nZ2xlKFxuICAgICAgZnJvbnRtYXR0ZXJHcm91cCxcbiAgICAgIFwiZnJvbnRtYXR0ZXJEZWZhdWx0c1wiLFxuICAgICAgXCJCb2xkIFRZUCBwcm9wZXJ0aWVzXCIsXG4gICAgICBcIlNob3cgVFlQLUZyb250bWF0dGVyIHByb3BlcnR5IG5hbWVzIGluIGJvbGQgaW4gbm90ZXMgYW5kIHRoZSBwcm9wZXJ0aWVzIHNpZGViYXIuIFdpdGggU3VidHlwLCB0aGUgbm90ZSdzIFN1YnR5cCBibG9jayBjb3VudHMgYXMgd2VsbC5cIixcbiAgICAgIFwiZnJvbnRtYXR0ZXJEZWZhdWx0c1N1YnR5cFwiLFxuICAgICAgeyB0eXBUb29sdGlwOiBcIlRZUC1Gcm9udG1hdHRlclwiLCBzdWJ0eXBUb29sdGlwOiBcIkluY2x1ZGUgU3VidHlwIGJsb2Nrc1wiIH1cbiAgICApO1xuXG4gICAgLy8gVGhlIG9yZGVyIGVkaXRvciBicmluZ3MgaXRzIG93biBoZWFkaW5nIGFuZCBidXR0b25zLCBzbyBpdCBnb2VzIHN0cmFpZ2h0XG4gICAgLy8gaW50byBpbmZvRWwgaW5zdGVhZCBvZiBzZXROYW1lL3NldERlc2MgKHNlZSAudHlwLW9yZGVyLXNldHRpbmcpLlxuICAgIGZyb250bWF0dGVyR3JvdXAuYWRkU2V0dGluZygoc2V0dGluZykgPT4ge1xuICAgICAgc2V0dGluZy5zZXR0aW5nRWwuYWRkQ2xhc3MoXCJ0eXAtb3JkZXItc2V0dGluZ1wiKTtcbiAgICAgIG1vdW50R2xvYmFsT3JkZXJFZGl0b3Ioc2V0dGluZy5pbmZvRWwsIHRoaXMucGx1Z2luKTtcbiAgICAgIHNldHRpbmcuaW5mb0VsLmNyZWF0ZURpdih7XG4gICAgICAgIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIixcbiAgICAgICAgdGV4dDpcbiAgICAgICAgICAnT3JkZXIgYXBwbGllZCBieSB0aGUgXCJTb3J0IGZyb250bWF0dGVyXCIgY29tbWFuZHM7IHZhbHVlcyBhcmUgbmV2ZXIgY2hhbmdlZC4gUGluIHNpbmdsZSBwcm9wZXJ0aWVzIHN1Y2ggYXMgY3NzY2xhc3NlcyBvciBhbGlhc2VzLiBUWVAgYW5kIFNVQlRZUCBhcmUgdGhlIHByb3BlcnRpZXMgdGhlbXNlbHZlcywgXCJUWVAtRnJvbnRtYXR0ZXJcIiBpcyB0aGUgVFlQXFwncyBsaXN0IGZvbGxvd2VkIGJ5IGl0cyBTdWJ0eXAgYmxvY2ssIFwiT3RoZXIgcHJvcGVydGllc1wiIGlzIGV2ZXJ5dGhpbmcgZWxzZS4gRHJhZyB0byByZW9yZGVyOyB0aGUgZm91ciBwbGFjZWhvbGRlciByb3dzIGNhblxcJ3QgYmUgcmVtb3ZlZC4nLFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBjb250YWluZXJFbC5zY3JvbGxUb3AgPSBzY3JvbGxUb3A7XG4gIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IERFRkFVTFRfU0VUVElOR1MsIFR5cFN5c3RlbVNldHRpbmdUYWIgfTtcbiIsICJjb25zdCB7IE1vZGFsLCBTZXR0aW5nIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IHBsdXJhbCB9ID0gcmVxdWlyZShcIi4vdHlwLXV0aWxzXCIpO1xuXG4vKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAqIFRoZSB0d28gZGlhbG9ncyBvZiB0aGUgQmFzZSBjb21tYW5kcyAoc2VlIGJhc2VzLmpzKTpcbiAqICAtIGNvbHVtbiBvcHRpb25zIGJlZm9yZSBjcmVhdGluZy91cGRhdGluZ1xuICogIC0gY29uZmlybWluZyByZW1vdmFscyB3aGVuIHVwZGF0aW5nXG4gKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi9cblxuY29uc3QgTk9URV9QUkVGSVggPSBcIm5vdGUuXCI7XG5cbi8vIENvbHVtbiBsYWJlbDogdGhlIHNob3J0IGZvcm0gdGhlIHByb3BlcnR5IGhhcyBpbiB0aGUgLmJhc2UgZmlsZVxuLy8gKFwiVGl0ZWxcIiBpbnN0ZWFkIG9mIFwibm90ZS5UaXRlbFwiKS5cbmZ1bmN0aW9uIGNvbHVtbkxhYmVsKGlkKSB7XG4gIHJldHVybiBpZC5zdGFydHNXaXRoKE5PVEVfUFJFRklYKSA/IGlkLnNsaWNlKE5PVEVfUFJFRklYLmxlbmd0aCkgOiBpZDtcbn1cblxuZnVuY3Rpb24gdGFyZ2V0TGFiZWwodGFyZ2V0KSB7XG4gIGlmICghdGFyZ2V0LnR5cCkgcmV0dXJuIGBTdWJ0eXAgJHt0YXJnZXQuc3VidHlwfWA7XG4gIHJldHVybiB0YXJnZXQuc3VidHlwID8gYCR7dGFyZ2V0LnR5cH0gLyAke3RhcmdldC5zdWJ0eXB9YCA6IGBUWVAgJHt0YXJnZXQudHlwfWA7XG59XG5cbi8qIC0tLSBDb2x1bW4gb3B0aW9ucyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuLy8gVGhyZWUgdG9nZ2xlcywgYWxsIG9mZiBieSBkZWZhdWx0IChmaWxlLm5hbWUgcGx1cyBUWVAtRnJvbnRtYXR0ZXIgaXMgdGhlXG4vLyBub3JtYWwgY2FzZSksIHdpdGggYSBsaXZlIHByZXZpZXcgb2YgdGhlIHJlc3VsdGluZyBjb2x1bW5zIHNvIGEgdG9nZ2xlJ3Ncbi8vIGVmZmVjdCBuZWVkbid0IGJlIGd1ZXNzZWQuIFwiQWxsIFN1YnR5cCBwcm9wZXJ0aWVzXCIgb25seSBzaG93cyBmb3IgYSBUWVBcbi8vIHRhcmdldDogaW4gYSBTdWJ0eXAgdmlldyB0aGUgb3RoZXIgU3VidHlwIGJsb2NrcyB3b3VsZCBzdGF5IGVtcHR5LlxuY2xhc3MgQ29sdW1uT3B0aW9uc01vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBjb25zdHJ1Y3RvcihwbHVnaW4sIHRhcmdldCwgcHJldmlldywgcmVzb2x2ZSkge1xuICAgIHN1cGVyKHBsdWdpbi5hcHApO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICAgIHRoaXMudGFyZ2V0ID0gdGFyZ2V0O1xuICAgIHRoaXMucHJldmlldyA9IHByZXZpZXc7XG4gICAgdGhpcy5yZXNvbHZlID0gcmVzb2x2ZTtcbiAgICB0aGlzLm9wdGlvbnMgPSB7IGZsb2F0aW5nOiBmYWxzZSwgYWxsU3VidHlwczogZmFsc2UsIHRhZ3M6IGZhbHNlIH07XG4gICAgdGhpcy5jb25maXJtZWQgPSBmYWxzZTtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICB0aGlzLm1vZGFsRWwuYWRkQ2xhc3MoXCJ0eXAtYmFzZS1vcHRpb25zLW1vZGFsXCIpO1xuICAgIHRoaXMudGl0bGVFbC5zZXRUZXh0KGBDb2x1bW5zIGZvciAke3RhcmdldExhYmVsKHRoaXMudGFyZ2V0KX1gKTtcblxuICAgIGNvbnN0IHRvZ2dsZSA9IChuYW1lLCBkZXNjcmlwdGlvbiwga2V5KSA9PiB7XG4gICAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpXG4gICAgICAgIC5zZXROYW1lKG5hbWUpXG4gICAgICAgIC5zZXREZXNjKGRlc2NyaXB0aW9uKVxuICAgICAgICAuYWRkVG9nZ2xlKChjb250cm9sKSA9PlxuICAgICAgICAgIGNvbnRyb2wuc2V0VmFsdWUodGhpcy5vcHRpb25zW2tleV0pLm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5vcHRpb25zW2tleV0gPSB2YWx1ZTtcbiAgICAgICAgICAgIHRoaXMucmVuZGVyUHJldmlldygpO1xuICAgICAgICAgIH0pXG4gICAgICAgICk7XG4gICAgfTtcblxuICAgIHRvZ2dsZShcIkZsb2F0aW5nIHByb3BlcnRpZXNcIiwgXCJJbmNsdWRlIHRoZSBibG9jaydzIGZsb2F0aW5nIChpdGFsaWMpIHByb3BlcnRpZXMuXCIsIFwiZmxvYXRpbmdcIik7XG4gICAgaWYgKCF0aGlzLnRhcmdldC5zdWJ0eXApIHtcbiAgICAgIHRvZ2dsZShcIkFsbCBTdWJ0eXAgcHJvcGVydGllc1wiLCBcIkFsc28gaW5jbHVkZSB0aGUgcHJvcGVydGllcyBvZiBldmVyeSBTdWJ0eXAgYmxvY2sgb2YgdGhpcyBUWVAuXCIsIFwiYWxsU3VidHlwc1wiKTtcbiAgICB9XG4gICAgdG9nZ2xlKFwidGFnc1wiLCBcIkFkZCB0aGUgdGFncyBwcm9wZXJ0eSBhcyBhIGNvbHVtbi5cIiwgXCJ0YWdzXCIpO1xuXG4gICAgdGhpcy5wcmV2aWV3RWwgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1iYXNlLXByZXZpZXdcIiB9KTtcbiAgICB0aGlzLnJlbmRlclByZXZpZXcoKTtcblxuICAgIGNvbnN0IGJ1dHRvblJvdyA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibW9kYWwtYnV0dG9uLWNvbnRhaW5lclwiIH0pO1xuICAgIGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiQ2FuY2VsXCIgfSkuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY2xvc2UoKSk7XG4gICAgY29uc3QgY29uZmlybSA9IGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IGNsczogXCJtb2QtY3RhXCIsIHRleHQ6IFwiQXBwbHlcIiB9KTtcbiAgICBjb25maXJtLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICB0aGlzLmNvbmZpcm1lZCA9IHRydWU7XG4gICAgICB0aGlzLmNsb3NlKCk7XG4gICAgfSk7XG4gIH1cblxuICByZW5kZXJQcmV2aWV3KCkge1xuICAgIGNvbnN0IGlkcyA9IHRoaXMucHJldmlldyh0aGlzLm9wdGlvbnMpO1xuICAgIHRoaXMucHJldmlld0VsLmVtcHR5KCk7XG4gICAgdGhpcy5wcmV2aWV3RWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1iYXNlLXByZXZpZXctdGl0bGVcIiwgdGV4dDogcGx1cmFsKGlkcy5sZW5ndGgsIFwiY29sdW1uXCIpIH0pO1xuICAgIGNvbnN0IGxpc3QgPSB0aGlzLnByZXZpZXdFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWJhc2UtcHJldmlldy1saXN0XCIgfSk7XG4gICAgZm9yIChjb25zdCBpZCBvZiBpZHMpIGxpc3QuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtYmFzZS1wcmV2aWV3LWNvbHVtblwiLCB0ZXh0OiBjb2x1bW5MYWJlbChpZCkgfSk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gICAgLy8gRVNDIG9yIGEgY2xpY2sgb3V0c2lkZSBjb3VudHMgYXMgY2FuY2VsLlxuICAgIHRoaXMucmVzb2x2ZSh0aGlzLmNvbmZpcm1lZCA/IHRoaXMub3B0aW9ucyA6IG51bGwpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGFza0NvbHVtbk9wdGlvbnMocGx1Z2luLCB0YXJnZXQsIHByZXZpZXcpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBuZXcgQ29sdW1uT3B0aW9uc01vZGFsKHBsdWdpbiwgdGFyZ2V0LCBwcmV2aWV3LCByZXNvbHZlKS5vcGVuKCkpO1xufVxuXG4vKiAtLS0gQ29uZmlybSByZW1vdmFscyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbi8vIEFkZGluZyBhbmQgcmVvcmRlcmluZyBjb2x1bW5zIGhhcHBlbiBzaWxlbnRseTsgb25seSByZW1vdmluZyBpcyBzaG93bixcbi8vIGJlY2F1c2Ugb25seSB0aGF0IGxvc2VzIHNvbWV0aGluZy4gRXZlcnkgZW50cnkgc3RhcnRzIGNoZWNrZWQ7IGFuIHVuY2hlY2tlZFxuLy8gY29sdW1uIGlzIGtlcHQgKGF0IHRoZSBmcm9udCwgc2VlIHVwZGF0ZUFjdGl2ZVZpZXcpLlxuY2xhc3MgUmVtb3ZhbE1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBjb25zdHJ1Y3RvcihwbHVnaW4sIGNvbHVtbnMsIHZpZXdOYW1lLCByZXNvbHZlKSB7XG4gICAgc3VwZXIocGx1Z2luLmFwcCk7XG4gICAgdGhpcy5jb2x1bW5zID0gY29sdW1ucztcbiAgICB0aGlzLnZpZXdOYW1lID0gdmlld05hbWU7XG4gICAgdGhpcy5yZXNvbHZlID0gcmVzb2x2ZTtcbiAgICB0aGlzLm1hcmtlZCA9IG5ldyBTZXQoY29sdW1ucyk7XG4gICAgdGhpcy5jb25maXJtZWQgPSBmYWxzZTtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICB0aGlzLm1vZGFsRWwuYWRkQ2xhc3MoXCJ0eXAtYmFzZS1yZW1vdmFsLW1vZGFsXCIpO1xuICAgIHRoaXMudGl0bGVFbC5zZXRUZXh0KGBSZW1vdmUgY29sdW1ucyBmcm9tIFwiJHt0aGlzLnZpZXdOYW1lfVwiYCk7XG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICBjbHM6IFwidHlwLWJhc2UtcmVtb3ZhbC1pbnRyb1wiLFxuICAgICAgdGV4dDogXCJUaGVzZSBjb2x1bW5zIGRvbid0IGJlbG9uZyB0byB0aGUgVFlQLiBVbmNoZWNrZWQgb25lcyBhcmUga2VwdC5cIixcbiAgICB9KTtcblxuICAgIGZvciAoY29uc3QgaWQgb2YgdGhpcy5jb2x1bW5zKSB7XG4gICAgICBuZXcgU2V0dGluZyhjb250ZW50RWwpLnNldE5hbWUoY29sdW1uTGFiZWwoaWQpKS5hZGRUb2dnbGUoKGNvbnRyb2wpID0+XG4gICAgICAgIGNvbnRyb2wuc2V0VmFsdWUodHJ1ZSkub25DaGFuZ2UoKHZhbHVlKSA9PiB7XG4gICAgICAgICAgaWYgKHZhbHVlKSB0aGlzLm1hcmtlZC5hZGQoaWQpO1xuICAgICAgICAgIGVsc2UgdGhpcy5tYXJrZWQuZGVsZXRlKGlkKTtcbiAgICAgICAgfSlcbiAgICAgICk7XG4gICAgfVxuXG4gICAgY29uc3QgYnV0dG9uUm93ID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJtb2RhbC1idXR0b24tY29udGFpbmVyXCIgfSk7XG4gICAgYnV0dG9uUm93LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJDYW5jZWxcIiB9KS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5jbG9zZSgpKTtcbiAgICBjb25zdCBjb25maXJtID0gYnV0dG9uUm93LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgY2xzOiBcIm1vZC1jdGFcIiwgdGV4dDogXCJBcHBseVwiIH0pO1xuICAgIGNvbmZpcm0uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIHRoaXMuY29uZmlybWVkID0gdHJ1ZTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICB9KTtcbiAgfVxuXG4gIG9uQ2xvc2UoKSB7XG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcbiAgICB0aGlzLnJlc29sdmUodGhpcy5jb25maXJtZWQgPyB0aGlzLm1hcmtlZCA6IG51bGwpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGFza1JlbW92YWxzKHBsdWdpbiwgY29sdW1ucywgdmlld05hbWUpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBuZXcgUmVtb3ZhbE1vZGFsKHBsdWdpbiwgY29sdW1ucywgdmlld05hbWUsIHJlc29sdmUpLm9wZW4oKSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBhc2tDb2x1bW5PcHRpb25zLCBhc2tSZW1vdmFscyB9O1xuIiwgImNvbnN0IHsgTm90aWNlLCBURmlsZSwgc3RyaW5naWZ5WWFtbCB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBnZXRTdWJ0eXBOYW1lcyB9ID0gcmVxdWlyZShcIi4vc3VidHlwc1wiKTtcbmNvbnN0IHsgbm9ybWFsaXplR2xvYmFsT3JkZXIsIFRZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1zb3J0XCIpO1xuY29uc3QgeyBhc2tDb2x1bW5PcHRpb25zLCBhc2tSZW1vdmFscyB9ID0gcmVxdWlyZShcIi4vYmFzZS1kaWFsb2dzXCIpO1xuY29uc3QgeyBwbHVyYWwgfSA9IHJlcXVpcmUoXCIuL3R5cC11dGlsc1wiKTtcblxuLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gKiBCYXNlcyBmcm9tIGEgVFlQXG4gKiBDcmVhdGVzIGEgLmJhc2UgaW4gdGhlIHZhdWx0IHJvb3QgZm9yIGEgVFlQIChvciBhIFN1YnR5cCBuYW1lKTpcbiAqIGEgVFlQIGZpbHRlciwgb25lIHRhYmxlIHZpZXcgcGVyIFN1YnR5cCwgYW5kIGNvbHVtbnMgZnJvbSB0aGVcbiAqIFRZUC1Gcm9udG1hdHRlciBwbHVzIHRoZSBnbG9iYWwgcHJvcGVydHkgb3JkZXIuIFRoZSBzZWNvbmRcbiAqIGNvbW1hbmQgYnJpbmdzIHRoZSBjb2x1bW5zIG9mIGFuIGV4aXN0aW5nIHZpZXcgdXAgdG8gZGF0ZS5cbiAqXG4gKiBXcml0ZXMgb25seSB0aHJvdWdoIE9ic2lkaWFuJ3Mgb3duIEJhc2VzIEFQSSBhbmQgc2VyaWFsaXphdGlvblxuICogKHNlZSBhcHBlbmRWaWV3cyksIG5ldmVyIHRocm91Z2ggc2VsZi1wYXJzZWQgWUFNTCAtIGZvcm11bGFcbiAqIGJsb2NrcyBhbmQgc3BlY2lhbCBrZXlzIHdvdWxkbid0IHJlbGlhYmx5IHN1cnZpdmUgdGhlIHJvdW5kIHRyaXAuXG4gKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi9cblxuLy8gVmlldyBwcm9wZXJ0eSBpZHMgYXJlIGZ1bGx5IHF1YWxpZmllZCBpbiBtZW1vcnkgKFwibm90ZS5UaXRlbFwiLCBcImZpbGUubmFtZVwiLFxuLy8gXCJmb3JtdWxhLlhcIikgYnV0IHN0b3JlZCB3aXRob3V0IFwibm90ZS5cIiBpbiB0aGUgZmlsZS4gY2ZnLnNldE9yZGVyKCkgd2FudHNcbi8vIHRoZSBxdWFsaWZpZWQgZm9ybSwgYSB2aWV3IG9iamVjdCBidWlsdCBmb3IgdGhlIGZpbGUgdGhlIHNob3J0IG9uZSAtXG4vLyBzZXJpYWxpemVJZCgpIGNvbnZlcnRzLlxuY29uc3QgRklMRV9OQU1FX0lEID0gXCJmaWxlLm5hbWVcIjtcbmNvbnN0IE5PVEVfUFJFRklYID0gXCJub3RlLlwiO1xuY29uc3QgVEFHU19QUk9QRVJUWSA9IFwidGFnc1wiO1xuY29uc3QgQkFTRV9FWFRFTlNJT04gPSBcImJhc2VcIjtcblxuZnVuY3Rpb24gbm90ZUlkKGtleSkge1xuICByZXR1cm4gTk9URV9QUkVGSVggKyBrZXk7XG59XG5cbmZ1bmN0aW9uIHNlcmlhbGl6ZUlkKGlkKSB7XG4gIHJldHVybiBpZC5zdGFydHNXaXRoKE5PVEVfUFJFRklYKSA/IGlkLnNsaWNlKE5PVEVfUFJFRklYLmxlbmd0aCkgOiBpZDtcbn1cblxuZnVuY3Rpb24gc2FtZUlkKGEsIGIpIHtcbiAgcmV0dXJuIGEudG9Mb3dlckNhc2UoKSA9PT0gYi50b0xvd2VyQ2FzZSgpO1xufVxuXG4vLyBBIGZpbHRlciBleHByZXNzaW9uIHRoZSB3YXkgQmFzZXMgd3JpdGVzIGl0OiBUWVAgPT0gXCJNRURJQVwiLiBKU09OLnN0cmluZ2lmeVxuLy8gcXVvdGVzIGNvcnJlY3RseSBldmVuIGlmIHRoZSBuYW1lIGNvbnRhaW5zIGEgcXVvdGUuXG5mdW5jdGlvbiBlcXVhbHNGaWx0ZXIocHJvcGVydHksIHZhbHVlKSB7XG4gIHJldHVybiBgJHtwcm9wZXJ0eX0gPT0gJHtKU09OLnN0cmluZ2lmeShTdHJpbmcodmFsdWUpKX1gO1xufVxuXG4vKiAtLS0gUmVhZGluZyBUWVAvU3VidHlwIGZyb20gYW4gZXhpc3RpbmcgZmlsdGVyIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gKiBBIGdlbmVyYXRlZCB2aWV3IGNhcnJpZXMgaXRzIFRZUCBpbiB0aGUgcm9vdCBvciB2aWV3IGZpbHRlcjsgdGhlIHVwZGF0ZVxuICogY29tbWFuZCByZWFkcyBpdCBmcm9tIHRoZXJlIGluc3RlYWQgb2YgYXNraW5nLiBPbmx5IHVuYW1iaWd1b3VzIGZpbHRlcnNcbiAqIGNvdW50OiBhIHB1cmUgQU5EIHdpdGggZXhhY3RseSBvbmUgVFlQIG9yIFNVQlRZUCBjb21wYXJpc29uLiBBbiBPUiBncm91cFxuICogZG9lc24ndCBuZWNlc3NhcmlseSByZXN0cmljdCwgYW5kIGEgc2Vjb25kLCBkaWZmZXJlbnQgdmFsdWUgY29udHJhZGljdHMgLVxuICogYm90aCBnaXZlIG51bGwgYW5kIHRoZSBjb21tYW5kIGFza3MgaW5zdGVhZCAoc2VlIHVwZGF0ZUFjdGl2ZVZpZXcpLlxuICogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5jb25zdCBFUVVBTFNfUEFUVEVSTiA9IG5ldyBSZWdFeHAoYF5cXFxccyooJHtUWVBfUFJPUEVSVFl9fCR7U1VCVFlQX1BST1BFUlRZfSlcXFxccyo9PVxcXFxzKiguKz8pXFxcXHMqJGAsIFwiaVwiKTtcblxuZnVuY3Rpb24gZmlsdGVyTGl0ZXJhbChyYXcpIHtcbiAgaWYgKHJhdy5sZW5ndGggPj0gMiAmJiByYXdbMF0gPT09ICdcIicgJiYgcmF3LmVuZHNXaXRoKCdcIicpKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBKU09OLnBhcnNlKHJhdyk7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH1cbiAgaWYgKHJhdy5sZW5ndGggPj0gMiAmJiByYXdbMF0gPT09IFwiJ1wiICYmIHJhdy5lbmRzV2l0aChcIidcIikpIHJldHVybiByYXcuc2xpY2UoMSwgLTEpO1xuICByZXR1cm4gbnVsbDtcbn1cblxuZnVuY3Rpb24gY29sbGVjdEVxdWFscyhub2RlLCBmb3VuZCkge1xuICBpZiAoIW5vZGUpIHJldHVybjtcbiAgaWYgKHR5cGVvZiBub2RlID09PSBcInN0cmluZ1wiKSB7XG4gICAgY29uc3QgbWF0Y2ggPSBFUVVBTFNfUEFUVEVSTi5leGVjKG5vZGUpO1xuICAgIGlmICghbWF0Y2gpIHJldHVybjtcbiAgICBjb25zdCB2YWx1ZSA9IGZpbHRlckxpdGVyYWwobWF0Y2hbMl0pO1xuICAgIGlmICh2YWx1ZSAhPT0gbnVsbCkgZm91bmRbbWF0Y2hbMV0udG9VcHBlckNhc2UoKV0uYWRkKHZhbHVlKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKEFycmF5LmlzQXJyYXkobm9kZSkpIHtcbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIG5vZGUpIGNvbGxlY3RFcXVhbHMoZW50cnksIGZvdW5kKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gQU5EIG9ubHk6IGFuIE9SL05PVCBncm91cCBzYXlzIG5vdGhpbmcgcmVsaWFibGUgYWJvdXQgdGhlIFRZUCBvZiB0aGUgaGl0cy5cbiAgaWYgKG5vZGUuYW5kKSBjb2xsZWN0RXF1YWxzKG5vZGUuYW5kLCBmb3VuZCk7XG59XG5cbmZ1bmN0aW9uIHJlYWRUYXJnZXQoLi4uZmlsdGVyR3JvdXBzKSB7XG4gIGNvbnN0IGZvdW5kID0geyBbVFlQX1BST1BFUlRZXTogbmV3IFNldCgpLCBbU1VCVFlQX1BST1BFUlRZXTogbmV3IFNldCgpIH07XG4gIGZvciAoY29uc3QgZ3JvdXAgb2YgZmlsdGVyR3JvdXBzKSBjb2xsZWN0RXF1YWxzKGdyb3VwLCBmb3VuZCk7XG4gIGNvbnN0IHR5cHMgPSBbLi4uZm91bmRbVFlQX1BST1BFUlRZXV07XG4gIGNvbnN0IHN1YnR5cHMgPSBbLi4uZm91bmRbU1VCVFlQX1BST1BFUlRZXV07XG4gIGlmICh0eXBzLmxlbmd0aCA+IDEgfHwgc3VidHlwcy5sZW5ndGggPiAxKSByZXR1cm4gbnVsbDtcbiAgaWYgKHR5cHMubGVuZ3RoID09PSAwICYmIHN1YnR5cHMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHsgdHlwOiB0eXBzWzBdID8/IG51bGwsIHN1YnR5cDogc3VidHlwc1swXSA/PyBudWxsIH07XG59XG5cbi8qIC0tLSBDb2x1bW5zIG9mIGEgdGFyZ2V0IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuLy8gVFlQIGFuZCBTVUJUWVAgbmV2ZXIgYmVjb21lIGNvbHVtbnMgKGZpbHRlciBhbmQgZ3JvdXBpbmcgYWxyZWFkeSBzaG93XG4vLyB0aGVtKSwgbm9yIGRvZXMgdGhlIGVkaXRvcidzIGJsYW5rIHJvdy5cbmZ1bmN0aW9uIGlzU3lzdGVtS2V5KGtleSkge1xuICByZXR1cm4ga2V5ID09PSBcIlwiIHx8IHNhbWVJZChrZXksIFRZUF9QUk9QRVJUWSkgfHwgc2FtZUlkKGtleSwgU1VCVFlQX1BST1BFUlRZKTtcbn1cblxuLy8gQSBibG9jaydzIHByb3BlcnRpZXMgaW4gc3RvcmVkIG9yZGVyLCB2aWEgY29sbGVjdEJsb2NrcygpIChtYWluLmpzKSwgc28gdGhlXG4vLyBzYW1lIHJ1bGVzIGFwcGx5OiB0aGUgU3VidHlwIGJsb2NrIGZvbGxvd3MgdGhlIFRZUC1Gcm9udG1hdHRlciwgYSBrZXkgaW4gYm90aFxuLy8ga2VlcHMgdGhlIFRZUC1Gcm9udG1hdHRlciBwb3NpdGlvbiwgYW5kIHRoZSBTdWJ0eXAncyBmbG9hdGluZyBmbGFnIHdpbnMgLSBhXG4vLyBTdWJ0eXAgY2FuIGtlZXAgYSBzdGFuZGFyZCBwcm9wZXJ0eSBvdXQgb2YgaXRzIHZpZXcgdGhhdCB3YXkuXG5mdW5jdGlvbiBibG9ja0tleXMocGx1Z2luLCB0eXAsIHN1YnR5cCwgaW5jbHVkZUZsb2F0aW5nKSB7XG4gIGNvbnN0IHsgZGVmYXVsdHMgfSA9IHBsdWdpbi5jb2xsZWN0QmxvY2tzKHR5cCwgc3VidHlwLCBpbmNsdWRlRmxvYXRpbmcpO1xuICByZXR1cm4gT2JqZWN0LmtleXMoZGVmYXVsdHMpLmZpbHRlcigoa2V5KSA9PiAhaXNTeXN0ZW1LZXkoa2V5KSk7XG59XG5cbi8vIEV2ZXJ5IFRZUCB0aGF0IGhhcyBhIFN1YnR5cCBvZiB0aGlzIG5hbWUsIGluIFRZUC1MaXN0IG9yZGVyLiBUaGUgc2FtZVxuLy8gU3VidHlwIG5hbWUgbWF5IGV4aXN0IHVuZGVyIHNldmVyYWwgVFlQIGVudHJpZXM7IGEgc3RhbmRhbG9uZSBTdWJ0eXAgQmFzZVxuLy8gZmlsdGVycyBieSBTVUJUWVAgb25seSBhbmQgc28gc2hvd3MgYWxsIG9mIHRoZW0uXG5mdW5jdGlvbiB0eXBzRm9yU3VidHlwKHBsdWdpbiwgc3VidHlwKSB7XG4gIHJldHVybiBwbHVnaW4uc2V0dGluZ3MudHlwcy5maWx0ZXIoKHR5cCkgPT4gZ2V0U3VidHlwTmFtZXMocGx1Z2luLnNldHRpbmdzLCB0eXApLmluY2x1ZGVzKHN1YnR5cCkpO1xufVxuXG4vLyBBIHRhcmdldCBpcyB7IHR5cCwgc3VidHlwIH06XG4vLyAgIHsgdHlwLCBzdWJ0eXA6IG51bGwgfSAgLSB0aGUgVFlQIGl0c2VsZlxuLy8gICB7IHR5cCwgc3VidHlwIH0gICAgICAgIC0gYSBTdWJ0eXAgd2l0aGluIGl0cyBUWVBcbi8vICAgeyB0eXA6IG51bGwsIHN1YnR5cCB9ICAtIGEgU3VidHlwIG5hbWUgbm90IGJvdW5kIHRvIGEgVFlQIChzdGFuZGFsb25lXG4vLyAgICAgICAgICAgICAgICAgICAgICAgICAgICBTdWJ0eXAgQmFzZSwgY29sdW1ucyBtZXJnZWQgYWNyb3NzIFRZUCBlbnRyaWVzKVxuZnVuY3Rpb24gdGFyZ2V0S2V5cyhwbHVnaW4sIHRhcmdldCwgb3B0aW9ucykge1xuICBjb25zdCBzZWVuID0gbmV3IFNldCgpO1xuICBjb25zdCBtYWluID0gW107XG4gIGNvbnN0IG90aGVycyA9IFtdO1xuICBjb25zdCBhZGQgPSAobGlzdCwga2V5cykgPT4ge1xuICAgIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICAgIGNvbnN0IGxvd2VyID0ga2V5LnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAoc2Vlbi5oYXMobG93ZXIpKSBjb250aW51ZTtcbiAgICAgIHNlZW4uYWRkKGxvd2VyKTtcbiAgICAgIGxpc3QucHVzaChrZXkpO1xuICAgIH1cbiAgfTtcblxuICBpZiAoIXRhcmdldC50eXApIHtcbiAgICBmb3IgKGNvbnN0IHR5cCBvZiB0eXBzRm9yU3VidHlwKHBsdWdpbiwgdGFyZ2V0LnN1YnR5cCkpIHtcbiAgICAgIGFkZChtYWluLCBibG9ja0tleXMocGx1Z2luLCB0eXAsIHRhcmdldC5zdWJ0eXAsIG9wdGlvbnMuZmxvYXRpbmcpKTtcbiAgICB9XG4gICAgcmV0dXJuIHsgbWFpbiwgb3RoZXJzIH07XG4gIH1cblxuICBhZGQobWFpbiwgYmxvY2tLZXlzKHBsdWdpbiwgdGFyZ2V0LnR5cCwgdGFyZ2V0LnN1YnR5cCwgb3B0aW9ucy5mbG9hdGluZykpO1xuICAvLyBPbmx5IGZvciB0aGUgVFlQIHZpZXc6IGluIGEgU3VidHlwIHZpZXcgdGhlIG90aGVyIGJsb2NrcyB3b3VsZCBzdGF5IGVtcHR5LFxuICAvLyBzaW5jZSBhIG5vdGUgaGFzIGF0IG1vc3Qgb25lIFNVQlRZUC4gS2V5cyBhbHJlYWR5IGluIG1haW4gZHJvcCBvdXQgdmlhXG4gIC8vIFwic2VlblwiLlxuICBpZiAob3B0aW9ucy5hbGxTdWJ0eXBzICYmICF0YXJnZXQuc3VidHlwKSB7XG4gICAgZm9yIChjb25zdCBzdWJ0eXAgb2YgZ2V0U3VidHlwTmFtZXMocGx1Z2luLnNldHRpbmdzLCB0YXJnZXQudHlwKSkge1xuICAgICAgYWRkKG90aGVycywgYmxvY2tLZXlzKHBsdWdpbiwgdGFyZ2V0LnR5cCwgc3VidHlwLCBvcHRpb25zLmZsb2F0aW5nKSk7XG4gICAgfVxuICB9XG4gIHJldHVybiB7IG1haW4sIG90aGVycyB9O1xufVxuXG4vLyBUaGUgZmluYWwgY29sdW1uIGxpc3Q6IGZpbGUubmFtZSBmaXJzdCwgdGhlbiB0aGUgZ2xvYmFsIHByb3BlcnR5IG9yZGVyIGFzXG4vLyB0aGUgZnJhbWUuIEl0cyBwbGFjZWhvbGRlcnMgbWVhbiBoZXJlOlxuLy8gICBcInR5cFwiICAgICAgICAgICAgICAgICAgICAgLSBUWVAtRnJvbnRtYXR0ZXIgcGx1cyB0aGUgdGFyZ2V0J3MgU3VidHlwIGJsb2NrXG4vLyAgIFwib3RoZXJcIiAgICAgICAgICAgICAgICAgICAtIHRoZSBwcm9wZXJ0aWVzIG9mIHRoZSBvdGhlciBTdWJ0eXAgYmxvY2tzXG4vLyAgIFwidHlwVmFsdWVcIi9cInN1YnR5cFZhbHVlXCIgIC0gc2tpcHBlZCwgVFlQL1NVQlRZUCBhcmUgbm8gY29sdW1uc1xuLy8gT2YgdGhlIHBpbm5lZCBwcm9wZXJ0aWVzIG9ubHkgdGFncyBjb3VudHMgKGFuZCBvbmx5IHdoZW4gY2hlY2tlZCk6XG4vLyBjc3NjbGFzc2VzIG9yIGFsaWFzZXMgbWFrZSBubyBzZW5zZSBhcyBjb2x1bW5zIG9mIGFuIG92ZXJ2aWV3IHRhYmxlLlxuZnVuY3Rpb24gY29sdW1uSWRzKHBsdWdpbiwgdGFyZ2V0LCBvcHRpb25zKSB7XG4gIGNvbnN0IHsgbWFpbiwgb3RoZXJzIH0gPSB0YXJnZXRLZXlzKHBsdWdpbiwgdGFyZ2V0LCBvcHRpb25zKTtcbiAgY29uc3QgaWRzID0gW107XG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0KCk7XG4gIGNvbnN0IHB1c2ggPSAoaWQpID0+IHtcbiAgICBjb25zdCBsb3dlciA9IGlkLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKHNlZW4uaGFzKGxvd2VyKSkgcmV0dXJuO1xuICAgIHNlZW4uYWRkKGxvd2VyKTtcbiAgICBpZHMucHVzaChpZCk7XG4gIH07XG5cbiAgcHVzaChGSUxFX05BTUVfSUQpO1xuICBsZXQgdGFnc1BsYWNlZCA9IGZhbHNlO1xuICBmb3IgKGNvbnN0IGVudHJ5IG9mIG5vcm1hbGl6ZUdsb2JhbE9yZGVyKHBsdWdpbi5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyKSkge1xuICAgIGlmIChlbnRyeS5raW5kID09PSBcInByb3BlcnR5XCIpIHtcbiAgICAgIGlmIChvcHRpb25zLnRhZ3MgJiYgZW50cnkubmFtZSAmJiBzYW1lSWQoZW50cnkubmFtZSwgVEFHU19QUk9QRVJUWSkpIHtcbiAgICAgICAgcHVzaChub3RlSWQoZW50cnkubmFtZSkpO1xuICAgICAgICB0YWdzUGxhY2VkID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwidHlwXCIpIHtcbiAgICAgIGZvciAoY29uc3Qga2V5IG9mIG1haW4pIHB1c2gobm90ZUlkKGtleSkpO1xuICAgIH0gZWxzZSBpZiAoZW50cnkua2luZCA9PT0gXCJvdGhlclwiKSB7XG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBvdGhlcnMpIHB1c2gobm90ZUlkKGtleSkpO1xuICAgIH1cbiAgfVxuICAvLyBTYWZldHkgbmV0OiBpZiB0YWdzIGlzbid0IGluIHRoZSBnbG9iYWwgb3JkZXIsIGl0IHN0aWxsIGdvZXMgbGFzdC5cbiAgaWYgKG9wdGlvbnMudGFncyAmJiAhdGFnc1BsYWNlZCkgcHVzaChub3RlSWQoVEFHU19QUk9QRVJUWSkpO1xuICByZXR1cm4gaWRzO1xufVxuXG4vKiAtLS0gVmlld3Mgb2YgYSB0YXJnZXQgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbi8vIHNjb3BlZDogd2hldGhlciBlYWNoIHZpZXcgbXVzdCBjYXJyeSBpdHMgZnVsbCBmaWx0ZXIuIEluIGEgbmV3IEJhc2UgdGhlIFRZUFxuLy8gc2l0cyBpbiB0aGUgcm9vdCBmaWx0ZXIgYW5kIFN1YnR5cCB2aWV3cyBvbmx5IGFkZCBTVUJUWVAuIFZpZXdzIGFwcGVuZGVkIHRvXG4vLyBhbiBleGlzdGluZyBCYXNlIGxlYXZlIGl0cyByb290IGZpbHRlciBhbG9uZSBhbmQgZmlsdGVyIHRoZW1zZWx2ZXMuXG5mdW5jdGlvbiB0YXJnZXRWaWV3cyhwbHVnaW4sIHRhcmdldCwgb3B0aW9ucywgeyBzY29wZWQgfSkge1xuICBpZiAoIXRhcmdldC50eXApIHtcbiAgICBjb25zdCB2aWV3ID0ge1xuICAgICAgdHlwZTogXCJ0YWJsZVwiLFxuICAgICAgbmFtZTogdGFyZ2V0LnN1YnR5cCxcbiAgICAgIG9yZGVyOiBjb2x1bW5JZHMocGx1Z2luLCB0YXJnZXQsIG9wdGlvbnMpLFxuICAgIH07XG4gICAgaWYgKHNjb3BlZCkgdmlldy5maWx0ZXJzID0geyBhbmQ6IFtlcXVhbHNGaWx0ZXIoU1VCVFlQX1BST1BFUlRZLCB0YXJnZXQuc3VidHlwKV0gfTtcbiAgICAvLyBTZXZlcmFsIFRZUCBlbnRyaWVzIHdpdGggdGhpcyBTdWJ0eXAgbmFtZTogZ3JvdXBpbmcgc2VwYXJhdGVzIHRoZW1cbiAgICAvLyB3aXRob3V0IGEgdmlldyBwZXIgVFlQLlxuICAgIGlmICh0eXBzRm9yU3VidHlwKHBsdWdpbiwgdGFyZ2V0LnN1YnR5cCkubGVuZ3RoID4gMSkge1xuICAgICAgdmlldy5ncm91cEJ5ID0geyBwcm9wZXJ0eTogbm90ZUlkKFRZUF9QUk9QRVJUWSksIGRpcmVjdGlvbjogXCJBU0NcIiB9O1xuICAgIH1cbiAgICByZXR1cm4gW3ZpZXddO1xuICB9XG5cbiAgY29uc3QgdHlwID0gdGFyZ2V0LnR5cDtcbiAgY29uc3Qgc3VidHlwcyA9IGdldFN1YnR5cE5hbWVzKHBsdWdpbi5zZXR0aW5ncywgdHlwKTtcbiAgY29uc3QgbWFpbiA9IHtcbiAgICB0eXBlOiBcInRhYmxlXCIsXG4gICAgbmFtZTogdHlwLFxuICAgIG9yZGVyOiBjb2x1bW5JZHMocGx1Z2luLCB7IHR5cCwgc3VidHlwOiBudWxsIH0sIG9wdGlvbnMpLFxuICB9O1xuICBpZiAoc2NvcGVkKSBtYWluLmZpbHRlcnMgPSB7IGFuZDogW2VxdWFsc0ZpbHRlcihUWVBfUFJPUEVSVFksIHR5cCldIH07XG4gIC8vIFdpdGhvdXQgYW55IFN1YnR5cCwgZ3JvdXBpbmcgYnkgYW4gYWx3YXlzLWVtcHR5IHByb3BlcnR5IHdvdWxkIG9ubHkgZ2l2ZVxuICAvLyBvbmUgXCJubyB2YWx1ZVwiIGdyb3VwLlxuICBpZiAoc3VidHlwcy5sZW5ndGggPiAwKSBtYWluLmdyb3VwQnkgPSB7IHByb3BlcnR5OiBub3RlSWQoU1VCVFlQX1BST1BFUlRZKSwgZGlyZWN0aW9uOiBcIkFTQ1wiIH07XG5cbiAgY29uc3Qgdmlld3MgPSBbbWFpbl07XG4gIGZvciAoY29uc3Qgc3VidHlwIG9mIHN1YnR5cHMpIHtcbiAgICB2aWV3cy5wdXNoKHtcbiAgICAgIHR5cGU6IFwidGFibGVcIixcbiAgICAgIG5hbWU6IHN1YnR5cCxcbiAgICAgIC8vIGFsbFN1YnR5cHMgaXMgYWx3YXlzIG9mZiBpbiBhIFN1YnR5cCB2aWV3IChzZWUgdGFyZ2V0S2V5cykuXG4gICAgICBvcmRlcjogY29sdW1uSWRzKHBsdWdpbiwgeyB0eXAsIHN1YnR5cCB9LCB7IC4uLm9wdGlvbnMsIGFsbFN1YnR5cHM6IGZhbHNlIH0pLFxuICAgICAgZmlsdGVyczoge1xuICAgICAgICBhbmQ6IHNjb3BlZFxuICAgICAgICAgID8gW2VxdWFsc0ZpbHRlcihUWVBfUFJPUEVSVFksIHR5cCksIGVxdWFsc0ZpbHRlcihTVUJUWVBfUFJPUEVSVFksIHN1YnR5cCldXG4gICAgICAgICAgOiBbZXF1YWxzRmlsdGVyKFNVQlRZUF9QUk9QRVJUWSwgc3VidHlwKV0sXG4gICAgICB9LFxuICAgIH0pO1xuICB9XG4gIHJldHVybiB2aWV3cztcbn1cblxuLy8gQSB2aWV3IG9iamVjdCBhcyBpdCBhcHBlYXJzIGluIHRoZSBmaWxlOiB3aXRob3V0IFwibm90ZS5cIiBhbmQgd2l0aCB0aGUga2V5XG4vLyBvcmRlciBCYXNlcyBpdHNlbGYgd3JpdGVzLlxuZnVuY3Rpb24gc2VyaWFsaXplVmlldyh2aWV3KSB7XG4gIGNvbnN0IG91dCA9IHsgdHlwZTogdmlldy50eXBlLCBuYW1lOiB2aWV3Lm5hbWUgfTtcbiAgaWYgKHZpZXcuZmlsdGVycykgb3V0LmZpbHRlcnMgPSB2aWV3LmZpbHRlcnM7XG4gIGlmICh2aWV3Lm9yZGVyKSBvdXQub3JkZXIgPSB2aWV3Lm9yZGVyLm1hcChzZXJpYWxpemVJZCk7XG4gIGlmICh2aWV3Lmdyb3VwQnkpIHtcbiAgICBvdXQuZ3JvdXBCeSA9IHsgcHJvcGVydHk6IHNlcmlhbGl6ZUlkKHZpZXcuZ3JvdXBCeS5wcm9wZXJ0eSksIGRpcmVjdGlvbjogdmlldy5ncm91cEJ5LmRpcmVjdGlvbiB9O1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG5cbi8qIC0tLSBPcGVuaW5nIGFuZCB3cml0aW5nIHRoZSBmaWxlIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuZnVuY3Rpb24gd2FpdEZvcihtcykge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHdpbmRvdy5zZXRUaW1lb3V0KHJlc29sdmUsIG1zKSk7XG59XG5cbi8vIE9wZW5zIHRoZSBCYXNlIGFuZCB3YWl0cyB1bnRpbCBpdHMgcXVlcnkgaXMgcGFyc2VkOyBvbmx5IHRoZW4gY2FuIGl0IGJlXG4vLyByZWFkIGFuZCB3cml0dGVuLiBSZXVzZXMgYSB0YWIgdGhhdCBhbHJlYWR5IHNob3dzIHRoZSBmaWxlLlxuYXN5bmMgZnVuY3Rpb24gb3BlbkJhc2UoYXBwLCBmaWxlKSB7XG4gIGNvbnN0IG9wZW4gPSBhcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcImJhc2VzXCIpLmZpbmQoKGxlYWYpID0+IGxlYWYudmlldz8uZmlsZT8ucGF0aCA9PT0gZmlsZS5wYXRoKTtcbiAgY29uc3QgbGVhZiA9IG9wZW4gPz8gYXBwLndvcmtzcGFjZS5nZXRMZWFmKFwidGFiXCIpO1xuICBpZiAob3BlbikgYXBwLndvcmtzcGFjZS5yZXZlYWxMZWFmKGxlYWYpO1xuICBlbHNlIGF3YWl0IGxlYWYub3BlbkZpbGUoZmlsZSwgeyBhY3RpdmU6IHRydWUgfSk7XG4gIGZvciAobGV0IGF0dGVtcHQgPSAwOyBhdHRlbXB0IDwgNDAgJiYgIWxlYWYudmlldz8ucXVlcnk7IGF0dGVtcHQrKykgYXdhaXQgd2FpdEZvcigyNSk7XG4gIHJldHVybiBsZWFmLnZpZXc/LnF1ZXJ5ID8gbGVhZi52aWV3IDogbnVsbDtcbn1cblxuLy8gQXBwZW5kcyB2aWV3cyB0byBhbiBleGlzdGluZyBCYXNlLiBnZXRTZXJpYWxpemFibGUoKSByZXR1cm5zIGV4YWN0bHkgd2hhdFxuLy8gQmFzZXMgd3JpdGVzIHdoZW4gaXQgc2F2ZXMgKHZlcmlmaWVkOiB0aGUgcm91bmQgdHJpcCByZXByb2R1Y2VzIGV4aXN0aW5nXG4vLyBmaWxlcyBieXRlIGZvciBieXRlLCBmb3JtdWxhIGJsb2NrcyBhbmQgc3BlY2lhbCBrZXlzIGluY2x1ZGVkKTsgb25seSB0aGVcbi8vIHZpZXdzIGxpc3QgaXMgdG91Y2hlZC5cbmFzeW5jIGZ1bmN0aW9uIGFwcGVuZFZpZXdzKGFwcCwgdmlldywgdmlld3MpIHtcbiAgY29uc3QgZGF0YSA9IHZpZXcucXVlcnkuZ2V0U2VyaWFsaXphYmxlKCk7XG4gIGRhdGEudmlld3MgPSBbLi4uKGRhdGEudmlld3MgPz8gW10pLCAuLi52aWV3cy5tYXAoc2VyaWFsaXplVmlldyldO1xuICBhd2FpdCBhcHAudmF1bHQubW9kaWZ5KHZpZXcuZmlsZSwgc3RyaW5naWZ5WWFtbChkYXRhKSk7XG59XG5cbi8qIC0tLSBDb21tYW5kOiBDcmVhdGUgQmFzZSBmb3IgVFlQIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuYXN5bmMgZnVuY3Rpb24gY3JlYXRlQmFzZShwbHVnaW4sIHRhcmdldCwgb3B0aW9ucykge1xuICBjb25zdCBhcHAgPSBwbHVnaW4uYXBwO1xuICBjb25zdCBuYW1lID0gdGFyZ2V0LnN1YnR5cCA/PyB0YXJnZXQudHlwO1xuICBjb25zdCBwYXRoID0gYCR7bmFtZX0uJHtCQVNFX0VYVEVOU0lPTn1gO1xuICBjb25zdCBleGlzdGluZyA9IGFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgocGF0aCk7XG5cbiAgaWYgKGV4aXN0aW5nICYmICEoZXhpc3RpbmcgaW5zdGFuY2VvZiBURmlsZSkpIHtcbiAgICBuZXcgTm90aWNlKGBcIiR7cGF0aH1cIiBpcyBub3QgYSBmaWxlIFx1MjAxMyBCYXNlIG5vdCBjcmVhdGVkLmApO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmICghZXhpc3RpbmcpIHtcbiAgICBjb25zdCB2aWV3cyA9IHRhcmdldFZpZXdzKHBsdWdpbiwgdGFyZ2V0LCBvcHRpb25zLCB7IHNjb3BlZDogZmFsc2UgfSk7XG4gICAgY29uc3Qgcm9vdCA9IHRhcmdldC50eXBcbiAgICAgID8geyBhbmQ6IFtlcXVhbHNGaWx0ZXIoVFlQX1BST1BFUlRZLCB0YXJnZXQudHlwKV0gfVxuICAgICAgOiB7IGFuZDogW2VxdWFsc0ZpbHRlcihTVUJUWVBfUFJPUEVSVFksIHRhcmdldC5zdWJ0eXApXSB9O1xuICAgIGNvbnN0IGZpbGUgPSBhd2FpdCBhcHAudmF1bHQuY3JlYXRlKHBhdGgsIHN0cmluZ2lmeVlhbWwoeyBmaWx0ZXJzOiByb290LCB2aWV3czogdmlld3MubWFwKHNlcmlhbGl6ZVZpZXcpIH0pKTtcbiAgICBhd2FpdCBvcGVuQmFzZShhcHAsIGZpbGUpO1xuICAgIG5ldyBOb3RpY2UoYENyZWF0ZWQgJHtwYXRofSB3aXRoICR7cGx1cmFsKHZpZXdzLmxlbmd0aCwgXCJ2aWV3XCIpfS5gKTtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBUaGUgZmlsZSBleGlzdHM6IGFkZCB3aGF0IGlzIG1pc3NpbmcuIEEgdmlldyB3aXRoIHRoZSBzYW1lIG5hbWUgc3RheXNcbiAgLy8gdW50b3VjaGVkIC0gaXQgbWF5IGJlIGhhbmQtbWFkZSwgYW5kIG92ZXJ3cml0aW5nIGl0IHdvdWxkIGJlIGEgc2lsZW50IGxvc3MuXG4gIGNvbnN0IHZpZXcgPSBhd2FpdCBvcGVuQmFzZShhcHAsIGV4aXN0aW5nKTtcbiAgaWYgKCF2aWV3KSB7XG4gICAgbmV3IE5vdGljZShgQ291bGRuJ3QgcmVhZCAke3BhdGh9IFx1MjAxMyBCYXNlIG5vdCB1cGRhdGVkLmApO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBwcmVzZW50ID0gbmV3IFNldCh2aWV3LnF1ZXJ5LnZpZXdzLm1hcCgoY2ZnKSA9PiBjZmcubmFtZSkpO1xuICBjb25zdCB3YW50ZWQgPSB0YXJnZXRWaWV3cyhwbHVnaW4sIHRhcmdldCwgb3B0aW9ucywgeyBzY29wZWQ6IHRydWUgfSk7XG4gIGNvbnN0IHRvQWRkID0gd2FudGVkLmZpbHRlcigoZW50cnkpID0+ICFwcmVzZW50LmhhcyhlbnRyeS5uYW1lKSk7XG4gIGNvbnN0IHNraXBwZWQgPSB3YW50ZWQuZmlsdGVyKChlbnRyeSkgPT4gcHJlc2VudC5oYXMoZW50cnkubmFtZSkpLm1hcCgoZW50cnkpID0+IGVudHJ5Lm5hbWUpO1xuXG4gIGlmICh0b0FkZC5sZW5ndGggPiAwKSBhd2FpdCBhcHBlbmRWaWV3cyhhcHAsIHZpZXcsIHRvQWRkKTtcblxuICBjb25zdCBwYXJ0cyA9IFtdO1xuICBwYXJ0cy5wdXNoKHRvQWRkLmxlbmd0aCA+IDAgPyBgJHtwYXRofTogYWRkZWQgJHtwbHVyYWwodG9BZGQubGVuZ3RoLCBcInZpZXdcIil9LmAgOiBgJHtwYXRofTogbm90aGluZyB0byBhZGQuYCk7XG4gIGlmIChza2lwcGVkLmxlbmd0aCA+IDApIHBhcnRzLnB1c2goYEFscmVhZHkgcHJlc2VudCwgbGVmdCB1bmNoYW5nZWQ6ICR7c2tpcHBlZC5qb2luKFwiLCBcIil9LmApO1xuICBuZXcgTm90aWNlKHBhcnRzLmpvaW4oXCIgXCIpKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gY3JlYXRlQmFzZUNvbW1hbmQocGx1Z2luKSB7XG4gIC8vIGluY2x1ZGVNYW51YWxPZmY6IGEgQmFzZSBpcyBlc3BlY2lhbGx5IHVzZWZ1bCBmb3IgVFlQIGVudHJpZXMgdGhhdCBhcmVuJ3RcbiAgLy8gc2V0IGJ5IGhhbmQgKEtPTlRBS1QsIE1FRElBLCBFWFRFUk4pLiBVbnJlZ2lzdGVyZWQgdmFsdWVzIGFyZSBsZWZ0IG91dCAtXG4gIC8vIHRoZXkgaGF2ZSBubyBUWVAtRnJvbnRtYXR0ZXIgYW5kIHNvIG5vIGNvbHVtbnMuXG4gIGNvbnN0IGNob2ljZSA9IGF3YWl0IHBsdWdpbi5waWNrVHlwQW5kU3VidHlwKHsgaW5jbHVkZU1hbnVhbE9mZjogdHJ1ZSB9KTtcbiAgaWYgKCFjaG9pY2UpIHJldHVybjtcblxuICAvLyBBIFN1YnR5cCBwaWNrZWQgaGVyZSBtZWFucyB0aGUgc3RhbmRhbG9uZSBTdWJ0eXAgQmFzZTogaXQgZmlsdGVycyBieVxuICAvLyBTVUJUWVAgb25seSBhbmQgbWVyZ2VzIHRoZSBjb2x1bW5zIG9mIGV2ZXJ5IFRZUCB3aXRoIHRoYXQgU3VidHlwIG5hbWUuXG4gIGNvbnN0IHRhcmdldCA9IGNob2ljZS5zdWJ0eXAgPyB7IHR5cDogbnVsbCwgc3VidHlwOiBjaG9pY2Uuc3VidHlwIH0gOiB7IHR5cDogY2hvaWNlLnR5cCwgc3VidHlwOiBudWxsIH07XG4gIGNvbnN0IG9wdGlvbnMgPSBhd2FpdCBhc2tDb2x1bW5PcHRpb25zKHBsdWdpbiwgdGFyZ2V0LCAoY3VycmVudCkgPT4gY29sdW1uSWRzKHBsdWdpbiwgdGFyZ2V0LCBjdXJyZW50KSk7XG4gIGlmICghb3B0aW9ucykgcmV0dXJuO1xuICBhd2FpdCBjcmVhdGVCYXNlKHBsdWdpbiwgdGFyZ2V0LCBvcHRpb25zKTtcbn1cblxuLyogLS0tIENvbW1hbmQ6IFVwZGF0ZSBjb2x1bW5zIG9mIEJhc2UgdmlldyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuXG5mdW5jdGlvbiBhY3RpdmVCYXNlVmlldyhwbHVnaW4pIHtcbiAgY29uc3QgbGVhZiA9IHBsdWdpbi5hcHAud29ya3NwYWNlLmFjdGl2ZUxlYWYgPz8gcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TW9zdFJlY2VudExlYWY/LigpO1xuICBjb25zdCB2aWV3ID0gbGVhZj8udmlldztcbiAgaWYgKCF2aWV3IHx8IHR5cGVvZiB2aWV3LmdldFZpZXdUeXBlICE9PSBcImZ1bmN0aW9uXCIgfHwgdmlldy5nZXRWaWV3VHlwZSgpICE9PSBcImJhc2VzXCIpIHJldHVybiBudWxsO1xuICByZXR1cm4gdmlldy5xdWVyeSA/IHZpZXcgOiBudWxsO1xufVxuXG5mdW5jdGlvbiBzZXJpYWxpemVGaWx0ZXJzKGZpbHRlcnMpIHtcbiAgcmV0dXJuIHR5cGVvZiBmaWx0ZXJzPy5zZXJpYWxpemUgPT09IFwiZnVuY3Rpb25cIiA/IGZpbHRlcnMuc2VyaWFsaXplKCkgOiBudWxsO1xufVxuXG5hc3luYyBmdW5jdGlvbiB1cGRhdGVBY3RpdmVWaWV3KHBsdWdpbiwgdmlldykge1xuICBjb25zdCBxdWVyeSA9IHZpZXcucXVlcnk7XG4gIGNvbnN0IHZpZXdOYW1lID0gdmlldy5jb250cm9sbGVyPy52aWV3TmFtZTtcbiAgY29uc3QgY2ZnID0gKHZpZXdOYW1lID8gcXVlcnkuZ2V0Vmlld0NvbmZpZyh2aWV3TmFtZSkgOiBudWxsKSA/PyBxdWVyeS52aWV3c1swXTtcbiAgaWYgKCFjZmcpIHtcbiAgICBuZXcgTm90aWNlKFwiTm8gYWN0aXZlIHZpZXcuXCIpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGxldCB0YXJnZXQgPSByZWFkVGFyZ2V0KHNlcmlhbGl6ZUZpbHRlcnMocXVlcnkuZmlsdGVycyksIHNlcmlhbGl6ZUZpbHRlcnMoY2ZnLmZpbHRlcnMpKTtcbiAgaWYgKCF0YXJnZXQpIHtcbiAgICAvLyBObyB1bmFtYmlndW91cyBUWVAgaW4gdGhlIGZpbHRlciAoaGFuZC13cml0dGVuIE9SIGdyb3VwLCBubyBmaWx0ZXIgYXRcbiAgICAvLyBhbGwpOiBhc2ssIGFuZCBzdG9yZSB0aGUgYW5zd2VyIGFzIGEgZmlsdGVyIHNvIHRoZSBuZXh0IHJ1biByZWFkcyBpdC5cbiAgICBjb25zdCBjaG9pY2UgPSBhd2FpdCBwbHVnaW4ucGlja1R5cEFuZFN1YnR5cCh7IGluY2x1ZGVNYW51YWxPZmY6IHRydWUgfSk7XG4gICAgaWYgKCFjaG9pY2UpIHJldHVybjtcbiAgICB0YXJnZXQgPSB7IHR5cDogY2hvaWNlLnR5cCwgc3VidHlwOiBjaG9pY2Uuc3VidHlwIH07XG4gICAgY29uc3QgYW5kID0gW2VxdWFsc0ZpbHRlcihUWVBfUFJPUEVSVFksIGNob2ljZS50eXApXTtcbiAgICBpZiAoY2hvaWNlLnN1YnR5cCkgYW5kLnB1c2goZXF1YWxzRmlsdGVyKFNVQlRZUF9QUk9QRVJUWSwgY2hvaWNlLnN1YnR5cCkpO1xuICAgIHF1ZXJ5LnNldFZpZXdGaWx0ZXJzKGNmZy5uYW1lLCB7IGFuZCB9KTtcbiAgfVxuXG4gIGNvbnN0IG9wdGlvbnMgPSBhd2FpdCBhc2tDb2x1bW5PcHRpb25zKHBsdWdpbiwgdGFyZ2V0LCAoY3VycmVudCkgPT4gY29sdW1uSWRzKHBsdWdpbiwgdGFyZ2V0LCBjdXJyZW50KSk7XG4gIGlmICghb3B0aW9ucykgcmV0dXJuO1xuXG4gIGNvbnN0IGRlc2lyZWQgPSBjb2x1bW5JZHMocGx1Z2luLCB0YXJnZXQsIG9wdGlvbnMpO1xuICBjb25zdCBkZXNpcmVkTG93ZXIgPSBuZXcgU2V0KGRlc2lyZWQubWFwKChpZCkgPT4gaWQudG9Mb3dlckNhc2UoKSkpO1xuICAvLyBBIHZpZXcgd2l0aG91dCBpdHMgb3duIG9yZGVyIHNob3dzIGV2ZXJ5IHByb3BlcnR5IC0gbm90aGluZyB0byByZW1vdmUsXG4gIC8vIHRoZSBnZW5lcmF0ZWQgbGlzdCBzaW1wbHkgdGFrZXMgaXRzIHBsYWNlLlxuICBjb25zdCBjdXJyZW50ID0gQXJyYXkuaXNBcnJheShjZmcub3JkZXIpID8gWy4uLmNmZy5vcmRlcl0gOiBbXTtcbiAgY29uc3QgZXh0cmFzID0gY3VycmVudC5maWx0ZXIoKGlkKSA9PiAhZGVzaXJlZExvd2VyLmhhcyhpZC50b0xvd2VyQ2FzZSgpKSk7XG5cbiAgbGV0IGtlcHQgPSBbXTtcbiAgaWYgKGV4dHJhcy5sZW5ndGggPiAwKSB7XG4gICAgY29uc3QgcmVtb3ZhbHMgPSBhd2FpdCBhc2tSZW1vdmFscyhwbHVnaW4sIGV4dHJhcywgY2ZnLm5hbWUpO1xuICAgIGlmICghcmVtb3ZhbHMpIHJldHVybjtcbiAgICBrZXB0ID0gZXh0cmFzLmZpbHRlcigoaWQpID0+ICFyZW1vdmFscy5oYXMoaWQpKTtcbiAgfVxuXG4gIC8vIEtlcHQgY29sdW1ucyBzdGF5IHVwIGZyb250LCByaWdodCBhZnRlciBmaWxlLm5hbWU6IGhhbmQtYWRkZWQgb25lc1xuICAvLyAoZm9ybXVsYSBjb2x1bW5zLCBzYXkpIHNob3VsZG4ndCBzbGlkZSB0byB0aGUgZW5kLlxuICBjb25zdCBuZXdPcmRlciA9IFtcbiAgICBGSUxFX05BTUVfSUQsXG4gICAgLi4ua2VwdC5maWx0ZXIoKGlkKSA9PiAhc2FtZUlkKGlkLCBGSUxFX05BTUVfSUQpKSxcbiAgICAuLi5kZXNpcmVkLmZpbHRlcigoaWQpID0+ICFzYW1lSWQoaWQsIEZJTEVfTkFNRV9JRCkpLFxuICBdO1xuXG4gIGlmIChuZXdPcmRlci5sZW5ndGggPT09IGN1cnJlbnQubGVuZ3RoICYmIG5ld09yZGVyLmV2ZXJ5KChpZCwgaW5kZXgpID0+IGlkID09PSBjdXJyZW50W2luZGV4XSkpIHtcbiAgICBuZXcgTm90aWNlKGBWaWV3IFwiJHtjZmcubmFtZX1cIjogY29sdW1ucyBhcmUgYWxyZWFkeSB1cCB0byBkYXRlLmApO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IGFkZGVkID0gZGVzaXJlZC5maWx0ZXIoKGlkKSA9PiAhY3VycmVudC5zb21lKChleGlzdGluZykgPT4gc2FtZUlkKGV4aXN0aW5nLCBpZCkpKS5sZW5ndGg7XG4gIGNvbnN0IHJlbW92ZWQgPSBleHRyYXMubGVuZ3RoIC0ga2VwdC5sZW5ndGg7XG4gIGNmZy5zZXRPcmRlcihuZXdPcmRlcik7XG4gIG5ldyBOb3RpY2UoYFZpZXcgXCIke2NmZy5uYW1lfVwiOiBhZGRlZCAke3BsdXJhbChhZGRlZCwgXCJjb2x1bW5cIil9LCByZW1vdmVkICR7cmVtb3ZlZH0uYCk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBjcmVhdGVCYXNlQ29tbWFuZCxcbiAgYWN0aXZlQmFzZVZpZXcsXG4gIHVwZGF0ZUFjdGl2ZVZpZXcsXG4gIC8vIEV4cG9zZWQgZm9yIHRlc3Rpbmcgc2luZ2xlIGJ1aWxkaW5nIGJsb2Nrc1xuICBjb2x1bW5JZHMsXG4gIHJlYWRUYXJnZXQsXG4gIHRhcmdldFZpZXdzLFxufTtcbiIsICJjb25zdCB7IE5vdGljZSB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBzb3J0QWxsRnJvbnRtYXR0ZXIsIHNvcnRTaW5nbGVGaWxlRnJvbnRtYXR0ZXIsIHNvcnRTdW1tYXJ5IH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1zb3J0XCIpO1xuY29uc3QgeyBjcmVhdGVCYXNlQ29tbWFuZCwgYWN0aXZlQmFzZVZpZXcsIHVwZGF0ZUFjdGl2ZVZpZXcgfSA9IHJlcXVpcmUoXCIuL2Jhc2VzXCIpO1xuXG5mdW5jdGlvbiByZWdpc3RlckNvbW1hbmRzKHBsdWdpbikge1xuXG4gIC8vIE9ic2lkaWFuIG5laXRoZXIgYXdhaXRzIGEgY29tbWFuZCBjYWxsYmFjayBub3IgY2F0Y2hlcyBpdHMgZXJyb3JzLCBzbyBhblxuICAvLyBleGNlcHRpb24gd291bGQgdmFuaXNoIGludG8gdGhlIGNvbnNvbGUuIFRoZXNlIGNvbW1hbmRzIGFsd2F5cyBlbmQgaW4gYVxuICAvLyBub3RpY2UgaW5zdGVhZC5cbiAgY29uc3QgcnVuT3JSZXBvcnRFcnJvciA9IChsYWJlbCwgZm4pID0+IGFzeW5jICgpID0+IHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgZm4oKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihgWyR7bGFiZWx9XWAsIGVycm9yKTtcbiAgICAgIG5ldyBOb3RpY2UoYCR7bGFiZWx9IGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgIH1cbiAgfTtcblxuICBwbHVnaW4uYWRkQ29tbWFuZCh7XG4gICAgaWQ6IFwic29ydC1mcm9udG1hdHRlci1hbGxcIixcbiAgICBuYW1lOiBcIlNvcnQgZnJvbnRtYXR0ZXIgaW4gYWxsIG5vdGVzXCIsXG4gICAgY2FsbGJhY2s6IHJ1bk9yUmVwb3J0RXJyb3IoXCJGcm9udG1hdHRlciBzb3J0aW5nXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHsgY2hlY2tlZCwgY2hhbmdlZCB9ID0gYXdhaXQgc29ydEFsbEZyb250bWF0dGVyKHBsdWdpbi5hcHAsIHBsdWdpbiwgbnVsbCk7XG4gICAgICBuZXcgTm90aWNlKHNvcnRTdW1tYXJ5KFwiRnJvbnRtYXR0ZXIgc29ydGluZ1wiLCBjaGVja2VkLCBjaGFuZ2VkKSk7XG4gICAgfSksXG4gIH0pO1xuXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJzb3J0LWZyb250bWF0dGVyLXR5cFwiLFxuICAgIG5hbWU6IFwiU29ydCBmcm9udG1hdHRlciBmb3Igb25lIFRZUFwiLFxuICAgIGNhbGxiYWNrOiBydW5PclJlcG9ydEVycm9yKFwiRnJvbnRtYXR0ZXIgc29ydGluZ1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBTb3J0aW5nIG1ha2VzIHNlbnNlIGZvciBhbnkgVFlQLCBtYW51YWxseSBjcmVhdGFibGUgb3Igbm90LCByZWdpc3RlcmVkXG4gICAgICAvLyBvciBub3QuXG4gICAgICBjb25zdCB0eXAgPSBhd2FpdCBwbHVnaW4ucGlja1R5cCh7IGluY2x1ZGVNYW51YWxPZmY6IHRydWUsIGluY2x1ZGVVbnJlZ2lzdGVyZWQ6IHRydWUgfSk7XG4gICAgICBpZiAoIXR5cCkgcmV0dXJuO1xuICAgICAgY29uc3QgeyBjaGVja2VkLCBjaGFuZ2VkLCBoYXNUeXBEZWZhdWx0cyB9ID0gYXdhaXQgc29ydEFsbEZyb250bWF0dGVyKHBsdWdpbi5hcHAsIHBsdWdpbiwgdHlwKTtcbiAgICAgIGxldCBtZXNzYWdlID0gc29ydFN1bW1hcnkoYEZyb250bWF0dGVyIHNvcnRpbmcgJHt0eXB9YCwgY2hlY2tlZCwgY2hhbmdlZCk7XG4gICAgICAvLyBOb3QgYW4gZXJyb3IsIGJ1dCBleHBsYWlucyB3aHkgbm90aGluZyBtYXkgaGF2ZSBjaGFuZ2VkLlxuICAgICAgaWYgKGhhc1R5cERlZmF1bHRzID09PSBmYWxzZSkge1xuICAgICAgICBtZXNzYWdlICs9IGAgTm90ZTogJHt0eXB9IGhhcyBubyBUWVAtRnJvbnRtYXR0ZXIsIHNvIG9ubHkgdGhlIGdsb2JhbCBvcmRlciB3YXMgYXBwbGllZC5gO1xuICAgICAgfVxuICAgICAgbmV3IE5vdGljZShtZXNzYWdlKTtcbiAgICB9KSxcbiAgfSk7XG5cbiAgcGx1Z2luLmFkZENvbW1hbmQoe1xuICAgIGlkOiBcInNvcnQtZnJvbnRtYXR0ZXItYWN0aXZlLW5vdGVcIixcbiAgICBuYW1lOiBcIlNvcnQgZnJvbnRtYXR0ZXIgb2YgYWN0aXZlIG5vdGVcIixcbiAgICBjaGVja0NhbGxiYWNrOiAoY2hlY2tpbmcpID0+IHtcbiAgICAgIGNvbnN0IGZpbGUgPSBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gICAgICBpZiAoIWZpbGUgfHwgZmlsZS5leHRlbnNpb24gIT09IFwibWRcIikgcmV0dXJuIGZhbHNlO1xuICAgICAgaWYgKGNoZWNraW5nKSByZXR1cm4gdHJ1ZTtcblxuICAgICAgcnVuT3JSZXBvcnRFcnJvcihcIkZyb250bWF0dGVyIHNvcnRpbmdcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBjaGFuZ2VkID0gYXdhaXQgc29ydFNpbmdsZUZpbGVGcm9udG1hdHRlcihwbHVnaW4uYXBwLCBwbHVnaW4sIGZpbGUpO1xuICAgICAgICBuZXcgTm90aWNlKGNoYW5nZWQgPyBgU29ydGVkIGZyb250bWF0dGVyIG9mIFwiJHtmaWxlLmJhc2VuYW1lfVwiLmAgOiBgRnJvbnRtYXR0ZXIgb2YgXCIke2ZpbGUuYmFzZW5hbWV9XCIgd2FzIGFscmVhZHkgc29ydGVkLmApO1xuICAgICAgfSkoKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0sXG4gIH0pO1xuXG4gIC8vIENyZWF0ZXMgYSAuYmFzZSBmb3IgdGhlIGNob3NlbiBUWVAgb3IgU3VidHlwIGluIHRoZSB2YXVsdCByb290LCBzZWUgYmFzZXMuanMuXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJjcmVhdGUtYmFzZS1mb3ItdHlwXCIsXG4gICAgbmFtZTogXCJDcmVhdGUgQmFzZSBmb3IgVFlQXCIsXG4gICAgY2FsbGJhY2s6IHJ1bk9yUmVwb3J0RXJyb3IoXCJDcmVhdGUgQmFzZVwiLCAoKSA9PiBjcmVhdGVCYXNlQ29tbWFuZChwbHVnaW4pKSxcbiAgfSk7XG5cbiAgLy8gQnJpbmdzIHRoZSBjb2x1bW5zIG9mIHRoZSB2aXNpYmxlIEJhc2UgdmlldyBpbiBsaW5lIHdpdGggaXRzIFRZUC4gV2l0aG91dFxuICAvLyBhbiBvcGVuIEJhc2UgdGhlIGNvbW1hbmQgaGFzIG5vIHRhcmdldCBhbmQgaXMgaGlkZGVuLlxuICBwbHVnaW4uYWRkQ29tbWFuZCh7XG4gICAgaWQ6IFwidXBkYXRlLWJhc2Utdmlldy1jb2x1bW5zXCIsXG4gICAgbmFtZTogXCJVcGRhdGUgY29sdW1ucyBvZiBCYXNlIHZpZXdcIixcbiAgICBjaGVja0NhbGxiYWNrOiAoY2hlY2tpbmcpID0+IHtcbiAgICAgIGNvbnN0IHZpZXcgPSBhY3RpdmVCYXNlVmlldyhwbHVnaW4pO1xuICAgICAgaWYgKCF2aWV3KSByZXR1cm4gZmFsc2U7XG4gICAgICBpZiAoY2hlY2tpbmcpIHJldHVybiB0cnVlO1xuXG4gICAgICBydW5PclJlcG9ydEVycm9yKFwiVXBkYXRlIEJhc2VcIiwgKCkgPT4gdXBkYXRlQWN0aXZlVmlldyhwbHVnaW4sIHZpZXcpKSgpO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSxcbiAgfSk7XG5cbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyQ29tbWFuZHMgfTtcbiIsICJjb25zdCB7IENvbmZpcm1hdGlvbk1vZGFsIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IG5hbWVDb2xvciwgcGFpbnRDb2xvckRvdCwgREVGQVVMVF9UWVBfQ09MT1IgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5cbi8vIEEgVFlQIG5hbWUgaW4gcnVubmluZyB0ZXh0IChkaWFsb2dzKTogY29sb3JlZCB3aGVuIFwiVFlQLVBhbmVcIiBjb2xvcmluZyBpcyBvblxuLy8gKGNvbG9yVmlld3MudHlwTGlzdCksIG90aGVyd2lzZSBhIGRvdCBiZWZvcmUgcGxhaW4gdGV4dCAtIHRoZSBzYW1lIHN3aXRjaCBhc1xuLy8gaW4gdGhlIHBpY2tlciBhbmQgdGhlIGxpc3QuIFRoZSBjYWxsZXIgcGFzc2VzIGNvbG9yIHNvIGEgcmVuYW1lIGNhbiB1c2UgdGhlXG4vLyBzYW1lIChvbGQpIGNvbG9yIGZvciBvbGQgYW5kIG5ldyBuYW1lLiBjb2xvciBudWxsID0gVFlQIHdpdGhvdXQgYSBjb2xvci5cbmZ1bmN0aW9uIGFwcGVuZFR5cE5hbWUocGFyZW50RWwsIHBsdWdpbiwgdHlwLCBjb2xvcikge1xuICBpZiAocGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdCkge1xuICAgIGNvbnN0IG5hbWVFbCA9IHBhcmVudEVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLWlubGluZS1uYW1lXCIsIHRleHQ6IHR5cCB9KTtcbiAgICBpZiAoY29sb3IpIG5hbWVFbC5zdHlsZS5jb2xvciA9IGNvbG9yO1xuICB9IGVsc2Uge1xuICAgIHBhaW50Q29sb3JEb3QocGFyZW50RWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtaW5saW5lLWRvdFwiIH0pLCBjb2xvciA/PyBERUZBVUxUX1RZUF9DT0xPUiwgIWNvbG9yKTtcbiAgICBwYXJlbnRFbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1pbmxpbmUtbmFtZVwiLCB0ZXh0OiB0eXAgfSk7XG4gIH1cbn1cblxuLy8gTGlrZSBhcHBlbmRUeXBOYW1lIGZvciBhIFN1YnR5cCBvZiB0eXAsIGluIHRoZSBTdWJ0eXAgY29sb3IgKHNlZSBuYW1lQ29sb3Jcbi8vIGluIHR5cC1jb2xvcnMuanMsIHdoaWNoIGFsc28gaG9ub3JzIHRoZSBcIlN1YnR5cFwiIHN1Yi10b2dnbGUgb2YgXCJUWVAtUGFuZVwiKS5cbi8vIGNvbG9yU3VidHlwIGlzIHRoZSBTdWJ0eXAgd2hvc2UgY29sb3IgaXMgdXNlZCAtIGEgcmVuYW1lIHNob3dzIHRoZSBuZXcgbmFtZSxcbi8vIHdoaWNoIGhhcyBubyBlbnRyeSB5ZXQsIGluIHRoZSBvbGQgb25lJ3MgY29sb3IuIEFzIHdpdGggYXBwZW5kVHlwTmFtZSwgYSBUWVBcbi8vIHdpdGhvdXQgYSBjb2xvciBsZWF2ZXMgdGhlIHRleHQgdW5jb2xvcmVkLlxuZnVuY3Rpb24gYXBwZW5kU3VidHlwTmFtZShwYXJlbnRFbCwgcGx1Z2luLCB0eXAsIG5hbWUsIGNvbG9yU3VidHlwID0gbmFtZSkge1xuICBjb25zdCB7IGNvbG9yLCBpc0RlZmF1bHQgfSA9IG5hbWVDb2xvcihwbHVnaW4uc2V0dGluZ3MsIHR5cCwgY29sb3JTdWJ0eXApO1xuICBpZiAocGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdCkge1xuICAgIGNvbnN0IG5hbWVFbCA9IHBhcmVudEVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLWlubGluZS1uYW1lXCIsIHRleHQ6IG5hbWUgfSk7XG4gICAgaWYgKHBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdHlwXSkgbmFtZUVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gIH0gZWxzZSB7XG4gICAgcGFpbnRDb2xvckRvdChwYXJlbnRFbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1pbmxpbmUtZG90XCIgfSksIGNvbG9yLCBpc0RlZmF1bHQpO1xuICAgIHBhcmVudEVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLWlubGluZS1uYW1lXCIsIHRleHQ6IG5hbWUgfSk7XG4gIH1cbn1cblxuLy8gVGhlIHNhbWUgYXMgbm9kZXMgZm9yIGEgQ29uZmlybU1vZGFsIHRpdGxlIG9yIGJvZHkuXG5jb25zdCB0eXBOYW1lTm9kZSA9IChwbHVnaW4sIHR5cCwgY29sb3IpID0+IGNyZWF0ZUZyYWdtZW50KChmKSA9PiBhcHBlbmRUeXBOYW1lKGYsIHBsdWdpbiwgdHlwLCBjb2xvcikpO1xuY29uc3Qgc3VidHlwTmFtZU5vZGUgPSAocGx1Z2luLCB0eXAsIG5hbWUsIGNvbG9yU3VidHlwID0gbmFtZSkgPT5cbiAgY3JlYXRlRnJhZ21lbnQoKGYpID0+IGFwcGVuZFN1YnR5cE5hbWUoZiwgcGx1Z2luLCB0eXAsIG5hbWUsIGNvbG9yU3VidHlwKSk7XG5cbi8vIEZpbGxzIGVsIHdpdGggYSBzdHJpbmcgb3IgYW4gYXJyYXkgb2Ygc3RyaW5ncyBhbmQgbm9kZXMuXG5mdW5jdGlvbiBhcHBlbmRQYXJ0cyhlbCwgcGFydHMpIHtcbiAgZm9yIChjb25zdCBwYXJ0IG9mIEFycmF5LmlzQXJyYXkocGFydHMpID8gcGFydHMgOiBbcGFydHNdKSB7XG4gICAgaWYgKHR5cGVvZiBwYXJ0ID09PSBcInN0cmluZ1wiKSBlbC5hcHBlbmRUZXh0KHBhcnQpO1xuICAgIGVsc2UgZWwuYXBwZW5kQ2hpbGQocGFydCk7XG4gIH1cbn1cblxuLy8gVGhlIG9uZSBjb25maXJtYXRpb24gZGlhbG9nIG9mIHRoZSBwbHVnaW4sIGJ1aWx0IG9uIE9ic2lkaWFuJ3Mgb3duXG4vLyBDb25maXJtYXRpb25Nb2RhbCAtIHRoZSBiYXNlIG9mIGl0cyBcIkRlbGV0ZSBmaWxlXCIgZXRjLiAtIHNvIGxvb2ssIGJ1dHRvblxuLy8gb3JkZXIgW0NhbmNlbF0gW0FjdGlvbl0sIGJvdHRvbSBzaGVldCBvbiBwaG9uZXMgYW5kIGtleWJvYXJkIGZvY3VzIG1hdGNoXG4vLyBPYnNpZGlhbidzIGRpYWxvZ3MgZXhhY3RseS5cbi8vXG4vLyBMaWtlIE9ic2lkaWFuJ3MgXCJNZXJnZSBwcm9wZXJ0eSAuLi4gd2l0aCAuLi4/XCIgKEFsbCBwcm9wZXJ0aWVzKSwgdGhlXG4vLyBxdWVzdGlvbiBpdHNlbGYgaXMgdGhlIHRpdGxlIGFuZCB0aGUgdGV4dCBvbmx5IGFkZHMgd2hhdCB0aGUgdGl0bGUgZG9lc24ndFxuLy8gc2F5IC0gb2Z0ZW4gbm90aGluZy5cbi8vXG4vLyAgIHRpdGxlICAgICAgIC0gdGhlIHF1ZXN0aW9uIChcIkRlbGV0ZSBURVJNSU4/XCIpOyBhIHN0cmluZyBvciBhbiBhcnJheSBvZlxuLy8gICAgICAgICAgICAgICAgIHN0cmluZ3MgYW5kIG5vZGVzIChmb3IgY29sb3JlZCBuYW1lcywgc2VlIGFwcGVuZFR5cE5hbWUvXG4vLyAgICAgICAgICAgICAgICAgYXBwZW5kU3VidHlwTmFtZSlcbi8vICAgYm9keSAgICAgICAgLSBvcHRpb25hbCBwYXJhZ3JhcGhzLCBlYWNoIHNoYXBlZCBsaWtlIHRpdGxlXG4vLyAgIGNvbmZpcm1UZXh0IC0gbGFiZWwgb2YgdGhlIGFjdGlvbiBidXR0b25cbi8vICAgd2FybmluZyAgICAgLSBkZXN0cnVjdGl2ZSBhY3Rpb24gKHJlZCBidXR0b24pXG4vLyAgIGZvY3VzICAgICAgIC0gXCJjb25maXJtXCIgb3IgXCJjYW5jZWxcIjogd2hpY2ggYnV0dG9uIEVudGVyIHRyaWdnZXJzLiBSZW5hbWVcbi8vICAgICAgICAgICAgICAgICBmb2N1c2VzIHRoZSBhY3Rpb24sIGRlbGV0ZSBhbmQgbWVyZ2UgZm9jdXMgQ2FuY2VsLlxuLy8gICBvbkNvbmZpcm0gLyBvbkNhbmNlbCAtIG9uQ2FuY2VsIGFsc28gY292ZXJzIEVzY2FwZSBhbmQgYSBjbGljayBvdXRzaWRlLlxuLy9cbi8vIEJvdGggY2FsbGJhY2tzIHJ1biBmcm9tIG9uQ2xvc2UsIGkuZS4gb25jZSB0aGUgZGlhbG9nIGlzIGdvbmUgLSBhcyBiZWZvcmVcbi8vIHRoZSBzd2l0Y2ggdG8gQ29uZmlybWF0aW9uTW9kYWwsIGFuZCBzbyBhIGxvbmcgb25Db25maXJtIChyZXdyaXRpbmcgbWFueVxuLy8gbm90ZXMpIG5laXRoZXIga2VlcHMgdGhlIGRpYWxvZyBvcGVuIG5vciBydW5zIHR3aWNlLlxuY2xhc3MgQ29uZmlybU1vZGFsIGV4dGVuZHMgQ29uZmlybWF0aW9uTW9kYWwge1xuICBjb25zdHJ1Y3RvcihhcHAsIHsgdGl0bGUsIGJvZHkgPSBbXSwgY29uZmlybVRleHQsIHdhcm5pbmcgPSBmYWxzZSwgZm9jdXMgPSBcImNvbmZpcm1cIiwgb25Db25maXJtLCBvbkNhbmNlbCB9KSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLnRpdGxlID0gdGl0bGU7XG4gICAgdGhpcy5ib2R5ID0gYm9keTtcbiAgICB0aGlzLm9uQ29uZmlybSA9IG9uQ29uZmlybTtcbiAgICB0aGlzLm9uQ2FuY2VsID0gb25DYW5jZWw7XG4gICAgdGhpcy5jb25maXJtZWQgPSBmYWxzZTtcblxuICAgIC8vIEJ1dHRvbnMgYWxyZWFkeSBoZXJlLCBub3QgaW4gb25PcGVuOiBDb25maXJtYXRpb25Nb2RhbC5vcGVuKCkgbG9va3MgZm9yXG4gICAgLy8gdGhlIGluaXRpYWwtZm9jdXMgYnV0dG9uIGJlZm9yZSBpdCBjYWxscyBvbk9wZW4uXG4gICAgdGhpcy5hZGRCdXR0b24oKGJ1dHRvbikgPT4ge1xuICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoXCJDYW5jZWxcIikuc2V0Q2FuY2VsKCk7XG4gICAgICBpZiAoZm9jdXMgPT09IFwiY2FuY2VsXCIpIGJ1dHRvbi5zZXRJbml0aWFsRm9jdXMoKTtcbiAgICB9KTtcbiAgICB0aGlzLmFkZEJ1dHRvbigoYnV0dG9uKSA9PiB7XG4gICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChjb25maXJtVGV4dCkuc2V0Q3RhKCk7XG4gICAgICBpZiAod2FybmluZykgYnV0dG9uLnNldERlc3RydWN0aXZlKCk7XG4gICAgICBpZiAoZm9jdXMgPT09IFwiY29uZmlybVwiKSBidXR0b24uc2V0SW5pdGlhbEZvY3VzKCk7XG4gICAgICAvLyBCcmFjZXMsIG5vIHJldHVybiB2YWx1ZTogQ29uZmlybWF0aW9uQnV0dG9uIGtlZXBzIHRoZSBkaWFsb2cgb3BlbiBpZlxuICAgICAgLy8gdGhlIGhhbmRsZXIgcmV0dXJucyBzb21ldGhpbmcgdHJ1dGh5LCBhbmQgd2FpdHMgZm9yIGEgcHJvbWlzZS5cbiAgICAgIGJ1dHRvbi5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgdGhpcy5jb25maXJtZWQgPSB0cnVlO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgYXBwZW5kUGFydHModGhpcy50aXRsZUVsLCB0aGlzLnRpdGxlKTtcbiAgICBmb3IgKGNvbnN0IHBhcmFncmFwaCBvZiB0aGlzLmJvZHkpIGFwcGVuZFBhcnRzKHRoaXMuY29udGVudEVsLmNyZWF0ZUVsKFwicFwiKSwgcGFyYWdyYXBoKTtcbiAgfVxuXG4gIG9uQ2xvc2UoKSB7XG4gICAgc3VwZXIub25DbG9zZSgpO1xuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gICAgaWYgKHRoaXMuY29uZmlybWVkKSB0aGlzLm9uQ29uZmlybT8uKCk7XG4gICAgZWxzZSB0aGlzLm9uQ2FuY2VsPy4oKTtcbiAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgQ29uZmlybU1vZGFsLCBhcHBlbmRUeXBOYW1lLCBhcHBlbmRTdWJ0eXBOYW1lLCB0eXBOYW1lTm9kZSwgc3VidHlwTmFtZU5vZGUgfTtcbiIsICJjb25zdCB7IG1vbWVudCB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuXG4vLyBBIHNob3J0Y3V0IGlzIGEgdmFsdWUgY29tcHV0ZWQgb25seSB3aGVuIGEgbm90ZSBpcyBjcmVhdGVkLiBJdCBpcyBzdG9yZWRcbi8vIE5FWFQgVE8gdGhlIHByb3BlcnR5J3MgZnJvbnRtYXR0ZXIgdmFsdWUsIG5vdCBpbiBpdDogaW5cbi8vIHNldHRpbmdzLnR5cFNob3J0Y3V0c1tUWVBdW2tleV0gZm9yIHRoZSBUWVAtRnJvbnRtYXR0ZXIsIG9yIGluIHRoZSBzaG9ydGN1dHNcbi8vIG9iamVjdCBvZiBhIFN1YnR5cCBibG9jayAoc2VlIHN1YnR5cHMuanMpOlxuLy8gICB7IG5hbWU6IFwidG9kYXlcIiB9ICAgICAgICAgICAgLSBmaXhlZCB0b2tlbiwgcmVzb2x2ZWQgYnkgdGhlIHBsdWdpblxuLy8gICB7IG5hbWU6IFwidHAuPHNjcmlwdD5cIiB9ICAgICAgLSBUZW1wbGF0ZXIgc2NyaXB0LCBvbmx5IFRZUC5qcyBjYW4gcmVzb2x2ZSBpdFxuLy8gICB7IG5hbWU6IFwidHAuPHNjcmlwdD5cIiwgYXJnczogeyBmb2xkZXI6IFwiTGl0ZXJhdHVyXCIsIHllYXI6IDIwMjQgfSB9XG4vLyAgICAgLSB0aGUgc2FtZSB3aXRoIGFyZ3VtZW50cy4gVGhlIHNjcmlwdCBkZWNsYXJlcyB0aGUgcGFyYW1ldGVyIG5hbWVzIGluXG4vLyAgICAgICBpdHMgQHR5cC1zaG9ydGN1dCBtYXJrZXIgKHNlZSBzaG9ydGN1dC1zY3JpcHRzLmpzKTsgVFlQLmpzIHBhc3NlcyB0aGVcbi8vICAgICAgIG9iamVjdCBvbiBhcyBjdHguYXJncy4gRml4ZWQgdG9rZW5zIG5ldmVyIGhhdmUgYXJndW1lbnRzLlxuLy9cbi8vIFdoeSBuZXh0IHRvIHRoZSB2YWx1ZTogT2JzaWRpYW4gcGlja3MgYSByb3cncyBpbnB1dCBmcm9tIHRoZSBwcm9wZXJ0eSB0eXBlXG4vLyBpbiB0eXBlcy5qc29uLiBBIGRhdGUvbnVtYmVyL2NoZWNrYm94IHByb3BlcnR5IGNhbid0IHRha2UgYSB0b2tlbiBsaWtlXG4vLyBcInt7dG9kYXl9fVwiIGF0IGFsbCwgYSBzdG9yZWQgb25lIHRyaWdnZXJzIHRoZSBcIlR5cGUgbWlzbWF0Y2hcIiB3YXJuaW5nLCBhbmRcbi8vIHRoZSBsaXN0IHdpZGdldCBzaWxlbnRseSB0dXJucyBhIHN0cmluZyBpbnRvIGFuIGFycmF5IG9uIGZpcnN0IGVkaXQuIEtlcHRcbi8vIGFwYXJ0LCB0aGUgdmFsdWUgc3RheXMgdHlwZS1jbGVhbiBhbmQgdGhlIG5hdGl2ZSB3aWRnZXQgdW50b3VjaGVkLlxuLy9cbi8vIFRoZSBmcm9udG1hdHRlciB2YWx1ZSBzdGF5cyBhbmQgc2VydmVzIGFzIEZBTExCQUNLOiBpZiB0aGUgc2NyaXB0IGlzIG1pc3Npbmdcbi8vIG9yIHRocm93cywgVFlQLmpzIHdyaXRlcyBpdCBpbnN0ZWFkIG9mIGFuIGVtcHR5IHZhbHVlLiBBIHNjcmlwdCB0aGF0XG4vLyBkZWxpYmVyYXRlbHkgcmV0dXJucyBudWxsL1wiXCIgKGUuZy4gRVNDIGluIGEgcGlja2VyKSBpcyBub3QgYSBmYWlsdXJlIGFuZFxuLy8gbGVhdmVzIHRoZSBwcm9wZXJ0eSBlbXB0eS5cblxuLy8gVG9rZW5zIHRoZSBwbHVnaW4gcmVzb2x2ZXMgaXRzZWxmLCB3aXRob3V0IFRlbXBsYXRlciAtIHNvIGdldFR5cERlZmF1bHRzKClcbi8vIGZpbGxzIHRoZW0gaW4uIFJlc29sdmVkIG9uIGVhY2ggY2FsbCwgbm90IHdoZW4gc2V0LCBzbyBcInRvZGF5XCIgaXMgdGhlIGRheVxuLy8gdGhlIG5vdGUgaXMgY3JlYXRlZC5cbmNvbnN0IEZJWEVEX1NIT1JUQ1VUUyA9IFtcbiAge1xuICAgIG5hbWU6IFwidG9kYXlcIixcbiAgICBkZXNjcmlwdGlvbjogXCJIZXV0aWdlcyBEYXR1bSAoSkpKSi1NTS1UVClcIixcbiAgICByZXNvbHZlOiAoKSA9PiBtb21lbnQoKS5mb3JtYXQoXCJZWVlZLU1NLUREXCIpLFxuICB9LFxuICB7XG4gICAgbmFtZTogXCJub3dcIixcbiAgICBkZXNjcmlwdGlvbjogXCJBa3R1ZWxsZXMgRGF0dW0gbWl0IFVocnplaXQgKEpKSkotTU0tVFQgSEg6bW0pXCIsXG4gICAgcmVzb2x2ZTogKCkgPT4gbW9tZW50KCkuZm9ybWF0KFwiWVlZWS1NTS1ERCBISDptbVwiKSxcbiAgfSxcbiAge1xuICAgIC8vIFRoZSBmaWxlJ3MgY3JlYXRpb24gZGF0ZSAoZmlsZS5zdGF0LmN0aW1lKSwgbm90IHRoZSBjYWxsIHRpbWU7IGZhbGxzXG4gICAgLy8gYmFjayB0byBub3cgd2l0aG91dCBhIGZpbGUuXG4gICAgbmFtZTogXCJjcmVhdGVkXCIsXG4gICAgZGVzY3JpcHRpb246IFwiRXJzdGVsbHVuZ3NkYXR1bSBkZXIgRGF0ZWkgKEpKSkotTU0tVFQpXCIsXG4gICAgcmVzb2x2ZTogKGZpbGUpID0+IG1vbWVudChmaWxlPy5zdGF0Py5jdGltZSA/PyBEYXRlLm5vdygpKS5mb3JtYXQoXCJZWVlZLU1NLUREXCIpLFxuICB9LFxuXTtcblxuLy8gU2NyaXB0IHNob3J0Y3V0cyBjYXJyeSB0aGlzIHByZWZpeCBzbyBhIHNjcmlwdCBjYW4gbmV2ZXIgY29sbGlkZSB3aXRoIGFcbi8vIGZpeGVkIHRva2VuLCBub3QgZXZlbiBhIFwidG9kYXkuanNcIiBpbiB0aGUgc2NyaXB0IGZvbGRlci5cbmNvbnN0IFNDUklQVF9QUkVGSVggPSBcInRwLlwiO1xuXG5mdW5jdGlvbiBmaW5kRml4ZWRTaG9ydGN1dChuYW1lKSB7XG4gIHJldHVybiBGSVhFRF9TSE9SVENVVFMuZmluZCgoc2hvcnRjdXQpID0+IHNob3J0Y3V0Lm5hbWUgPT09IG5hbWUpID8/IG51bGw7XG59XG5cbi8vIFNjcmlwdCBuYW1lIG9mIGEgXCJ0cC48c2NyaXB0PlwiIHNob3J0Y3V0LCBvdGhlcndpc2UgbnVsbC4gVGhlIHNjcmlwdCBuYW1lIGlzXG4vLyB0aGUgZmlsZSBuYW1lIHdpdGhvdXQgXCIuanNcIiwgc28gdW1sYXV0cywgXCItXCIgYW5kIHNwYWNlcyBhcmUgYWxsb3dlZC5cbmZ1bmN0aW9uIHNjcmlwdE5hbWVPZihuYW1lKSB7XG4gIHJldHVybiB0eXBlb2YgbmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBuYW1lLnN0YXJ0c1dpdGgoU0NSSVBUX1BSRUZJWCkgPyBuYW1lLnNsaWNlKFNDUklQVF9QUkVGSVgubGVuZ3RoKSA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIGlzU2NyaXB0U2hvcnRjdXQocmVjb3JkKSB7XG4gIHJldHVybiBzY3JpcHROYW1lT2YocmVjb3JkPy5uYW1lKSAhPT0gbnVsbDtcbn1cblxuLy8gRGlzcGxheSBmb3JtIGluIHRoZSBwcm9wZXJ0eSByb3cgKGNoaXApIGFuZCB0aGUgcGlja2VyOiB0aGUgYmFyZSBuYW1lIHBsdXNcbi8vIGl0cyBhcmd1bWVudHMuIFRoZSBjaGlwIGl0c2VsZiBtYXJrcyBpdCBhcyBhIHNob3J0Y3V0LCBzbyBubyBicmFjZXMuXG5mdW5jdGlvbiBzaG9ydGN1dExhYmVsKHJlY29yZCkge1xuICBpZiAoIXJlY29yZD8ubmFtZSkgcmV0dXJuIFwiXCI7XG4gIGNvbnN0IHZhbHVlcyA9IE9iamVjdC52YWx1ZXMocmVjb3JkLmFyZ3MgPz8ge30pLmZpbHRlcigodmFsdWUpID0+IHZhbHVlICE9PSB1bmRlZmluZWQpO1xuICByZXR1cm4gdmFsdWVzLmxlbmd0aCA+IDAgPyBgJHtyZWNvcmQubmFtZX06ICR7dmFsdWVzLmpvaW4oXCIsIFwiKX1gIDogcmVjb3JkLm5hbWU7XG59XG5cbi8vIENvbnZlcnRzIGEgdHlwZWQgYXJndW1lbnQgdG8gdGhlIHR5cGUgaXQgb2J2aW91c2x5IG1lYW5zLCBzbyBhIHNjcmlwdCBnZXRzXG4vLyA1IGFzIGEgbnVtYmVyIGFuZCB0cnVlIGFzIGEgYm9vbGVhbiAobWF0dGVycyB3aGVuIHRoZSB2YWx1ZSBsYW5kcyBpbiBhXG4vLyBudW1iZXIgcHJvcGVydHkpLiBEZWxpYmVyYXRlbHkgdGhlc2UgZmV3IGNhc2VzIGluc3RlYWQgb2YgSlNPTi5wYXJzZSwgd2hpY2hcbi8vIHdvdWxkIGZhaWwgb24gXCJMaXRlcmF0dXJcIi4gQW4gZW1wdHkgZmllbGQgbWVhbnMgXCJub3Qgc2V0XCIgKHVuZGVmaW5lZCkgYW5kXG4vLyBkcm9wcyBvdXQgb2YgdGhlIGFyZ3VtZW50IG9iamVjdCwgc28gXCJhcmdzLnllYXIgPz8gZmFsbGJhY2tcIiB3b3Jrcy5cbmZ1bmN0aW9uIHBhcnNlQXJnVmFsdWUocmF3KSB7XG4gIGNvbnN0IHRleHQgPSBTdHJpbmcocmF3ID8/IFwiXCIpLnRyaW0oKTtcbiAgaWYgKHRleHQgPT09IFwiXCIpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmICh0ZXh0ID09PSBcInRydWVcIikgcmV0dXJuIHRydWU7XG4gIGlmICh0ZXh0ID09PSBcImZhbHNlXCIpIHJldHVybiBmYWxzZTtcbiAgaWYgKHRleHQgPT09IFwibnVsbFwiKSByZXR1cm4gbnVsbDtcbiAgaWYgKC9eLT9cXGQrKD86XFwuXFxkKyk/JC8udGVzdCh0ZXh0KSkgcmV0dXJuIE51bWJlcih0ZXh0KTtcbiAgcmV0dXJuIHRleHQ7XG59XG5cbi8vIFBhcmFtZXRlciBuYW1lcyB3aG9zZSB2YWx1ZXMgdGhlIHBsdWdpbiBvciBUWVAuanMgYWxyZWFkeSBrbm93OyB0aGV5IGFyZVxuLy8gZmlsbGVkIGluIGF0IGNhbGwgdGltZSwgbm90IGFza2VkIGZvcjpcbi8vICAgbmV3RmlsZSAgdGhlIG5ld2x5IGNyZWF0ZWQgbm90ZVxuLy8gICBjdHggICAgICB0aGUgY29udGV4dCB7IHR5cCwgc3VidHlwLCBrZXksIHZhbHVlcywgYWZ0ZXIsIGFyZ3MgfVxuLy8gICBrZXkgICAgICB0aGUgcHJvcGVydHkgdGhlIHNob3J0Y3V0IHNpdHMgb24sIHNvIGEgc2NyaXB0IGxpa2UgcmVsYXRpb24uanNcbi8vICAgICAgICAgICAgZ2V0cyB0aGUgcmlnaHQgb25lIHdoZXJldmVyIHRoZSBzaG9ydGN1dCBpcyB1c2VkXG4vLyBcInRwXCIgYWx3YXlzIGNvbWVzIGZpcnN0IGFuZCBuZWVkbid0IGJlIGRlY2xhcmVkOyBpZiBpdCBpcywgaXQgaXMgc2tpcHBlZC5cbmNvbnN0IFJFU0VSVkVEX1BBUkFNUyA9IFtcIm5ld0ZpbGVcIiwgXCJjdHhcIiwgXCJrZXlcIl07XG5cbi8vIFBhcmFtZXRlcnMgdGhhdCBnZXQgYW4gaW5wdXQgZmllbGQ6IGV2ZXJ5dGhpbmcgbm90IHJlc2VydmVkLiBwYXJhbXMgPT09IG51bGxcbi8vIChtYXJrZXIgd2l0aG91dCBwYXJlbnRoZXNlcykgbWVhbnMgdGhlIGNsYXNzaWMgY2FsbCwgYWxzbyB3aXRob3V0IGZpZWxkcy5cbmZ1bmN0aW9uIGlucHV0UGFyYW1zKHBhcmFtcykge1xuICByZXR1cm4gKHBhcmFtcyA/PyBbXSkuZmlsdGVyKChuYW1lKSA9PiBuYW1lICE9PSBcInRwXCIgJiYgIVJFU0VSVkVEX1BBUkFNUy5pbmNsdWRlcyhuYW1lKSk7XG59XG5cbi8vIElucHV0cyAob25lIHN0cmluZyBwZXIgcGFyYW1ldGVyKSB0byB0aGUgc3RvcmVkIGFyZ3VtZW50IG9iamVjdCwgaW4gdGhlXG4vLyBkZWNsYXJlZCBvcmRlciBzbyBzaG9ydGN1dExhYmVsKCkgc2hvd3MgdGhlbSB0aGF0IHdheS4gRW1wdHkgZmllbGRzIGFyZSBsZWZ0XG4vLyBvdXQuXG5mdW5jdGlvbiBidWlsZEFyZ3MocGFyYW1zLCBpbnB1dHMpIHtcbiAgY29uc3QgYXJncyA9IHt9O1xuICBmb3IgKGNvbnN0IG5hbWUgb2YgaW5wdXRQYXJhbXMocGFyYW1zKSkge1xuICAgIGNvbnN0IHZhbHVlID0gcGFyc2VBcmdWYWx1ZShpbnB1dHNbbmFtZV0pO1xuICAgIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkKSBhcmdzW25hbWVdID0gdmFsdWU7XG4gIH1cbiAgcmV0dXJuIGFyZ3M7XG59XG5cbi8vIEJ1aWxkcyB0aGUgYXJndW1lbnRzIGZvciBmKHRwLCAuLi5oZXJlKSBmcm9tIHRoZSBkZWNsYXJlZCBwYXJhbWV0ZXIgbGlzdC5cbi8vIENhbGxlZCBmcm9tIFRZUC5qcywgdGhlIG9ubHkgcGxhY2UgdGhhdCBrbm93cyBuZXdGaWxlIGFuZCBjdHguXG4vL1xuLy8gV2l0aG91dCBwYXJlbnRoZXNlcyAocGFyYW1zID09PSBudWxsKSBpdCBzdGF5cyB0aGUgY2xhc3NpYyBmKHRwLCBuZXdGaWxlLFxuLy8gY3R4KS4gT3RoZXJ3aXNlIGVhY2ggZW50cnkgcmVzb2x2ZXMgdG8gdGhlIHBhc3NlZCB2YWx1ZSAocmVzZXJ2ZWQgbmFtZXMpIG9yXG4vLyB0aGUgdHlwZWQgYXJndW1lbnQuXG4vL1xuLy8gQSBkb3R0ZWQgbmFtZSAoXCJvcHRpb25zLnR5cFwiKSBpcyBhIEZJRUxEIG9mIGFuIG9iamVjdCBhcmd1bWVudDogYWxsXG4vLyBcIm9wdGlvbnMuKlwiIGNvbGxlY3QgaW50byBvbmUgb2JqZWN0IGF0IHRoZSBwb3NpdGlvbiBvZiB0aGUgZmlyc3Qgb25lLiBUaGlzXG4vLyBzZXJ2ZXMgc2NyaXB0cyB0aGF0IHRha2UgYW4gb3B0aW9ucyBvYmplY3Qgd2l0aG91dCB0eXBpbmcgSlNPTi4gT25lIGxldmVsXG4vLyBvbmx5IC0gXCJhLmIuY1wiIGdpdmVzIGEgZmllbGQgbGl0ZXJhbGx5IG5hbWVkIFwiYi5jXCIuXG5mdW5jdGlvbiByZXNvbHZlQ2FsbEFyZ3MocGFyYW1zLCBhcmdzLCByZXNlcnZlZCA9IHt9KSB7XG4gIGlmIChwYXJhbXMgPT09IG51bGwgfHwgcGFyYW1zID09PSB1bmRlZmluZWQpIHJldHVybiBbcmVzZXJ2ZWQubmV3RmlsZSwgcmVzZXJ2ZWQuY3R4XTtcblxuICBjb25zdCBjYWxsQXJncyA9IFtdO1xuICBjb25zdCBvYmplY3RJbmRleCA9IG5ldyBNYXAoKTtcbiAgZm9yIChjb25zdCBuYW1lIG9mIHBhcmFtcykge1xuICAgIGlmIChuYW1lID09PSBcInRwXCIpIGNvbnRpbnVlO1xuICAgIGlmIChSRVNFUlZFRF9QQVJBTVMuaW5jbHVkZXMobmFtZSkpIHtcbiAgICAgIGNhbGxBcmdzLnB1c2gocmVzZXJ2ZWRbbmFtZV0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGRvdCA9IG5hbWUuaW5kZXhPZihcIi5cIik7XG4gICAgaWYgKGRvdCA9PT0gLTEpIHtcbiAgICAgIGNhbGxBcmdzLnB1c2goYXJncz8uW25hbWVdKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBiYXNlID0gbmFtZS5zbGljZSgwLCBkb3QpO1xuICAgIGlmICghb2JqZWN0SW5kZXguaGFzKGJhc2UpKSB7XG4gICAgICBvYmplY3RJbmRleC5zZXQoYmFzZSwgY2FsbEFyZ3MubGVuZ3RoKTtcbiAgICAgIGNhbGxBcmdzLnB1c2goe30pO1xuICAgIH1cbiAgICBjb25zdCB2YWx1ZSA9IGFyZ3M/LltuYW1lXTtcbiAgICBpZiAodmFsdWUgIT09IHVuZGVmaW5lZCkgY2FsbEFyZ3Nbb2JqZWN0SW5kZXguZ2V0KGJhc2UpXVtuYW1lLnNsaWNlKGRvdCArIDEpXSA9IHZhbHVlO1xuICB9XG4gIHJldHVybiBjYWxsQXJncztcbn1cblxuLy8gV2hldGhlciB0eXBlcy5qc29uIChvciwgaWYgdW5zZXQsIHRoZSBwcm9wZXJ0eSdzIHVzYWdlKSBkZWNsYXJlcyBhIGxpc3QuXG4vLyBUaGVuIGEgcmVzb2x2ZWQgc2hvcnRjdXQgdmFsdWUgaXMgd3JhcHBlZCBpbiBhIG9uZS1lbGVtZW50IGFycmF5IHRvIG1hdGNoLlxuLy8gV2l0aG91dCBhcHAgKHRlc3RzKSBub3RoaW5nIGlzIHdyYXBwZWQuXG5mdW5jdGlvbiBpc0xpc3RQcm9wZXJ0eShhcHAsIGtleSkge1xuICByZXR1cm4gYXBwPy5tZXRhZGF0YVR5cGVNYW5hZ2VyPy5nZXRUeXBlSW5mbz8uKGtleSk/LmV4cGVjdGVkPy50eXBlID09PSBcIm11bHRpdGV4dFwiO1xufVxuXG4vLyBDb3B5IG9mIGZyb250bWF0dGVyIGluIHdoaWNoIGV2ZXJ5IGtleSB3aXRoIGEgc2hvcnRjdXQgY2FycmllcyBpdHMgdmFsdWU6XG4vLyAgIC0gZml4ZWQgdG9rZW4gLT4gcmVzb2x2ZWQgKHdyYXBwZWQgZm9yIGxpc3QgcHJvcGVydGllcyksXG4vLyAgIC0gXCJ0cC48c2NyaXB0PlwiIC0+IG51bGw7IG9ubHkgVGVtcGxhdGVyIGNhbiByZXNvbHZlIGl0LCBUWVAuanMgZ2V0cyB0aGVzZVxuLy8gICAgIGtleXMgZnJvbSBnZXRUeXBTaG9ydGN1dHMoKSBhbmQgZmlsbHMgdGhlbSBpbiBpdHNlbGYuXG4vLyBLZXlzIHdpdGhvdXQgYSBzaG9ydGN1dCBzdGF5IGFzIHRoZXkgYXJlLiBUaGUgc3RvcmVkIHZhbHVlIG9mIGEga2V5IFdJVEggYVxuLy8gc2hvcnRjdXQgaXMgb25seSBvdmVycmlkZGVuIGhlcmUsIG5ldmVyIGRlbGV0ZWQgLSBpdCBpcyB0aGUgZmFsbGJhY2suXG5mdW5jdGlvbiByZXNvbHZlU2hvcnRjdXRzKGZyb250bWF0dGVyLCBzaG9ydGN1dHMsIHsgZmlsZSwgYXBwIH0gPSB7fSkge1xuICBjb25zdCByZXNvbHZlZCA9IHt9O1xuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhmcm9udG1hdHRlcikpIHtcbiAgICBjb25zdCByZWNvcmQgPSBzaG9ydGN1dHM/LltrZXldO1xuICAgIGNvbnN0IGZpeGVkID0gcmVjb3JkID8gZmluZEZpeGVkU2hvcnRjdXQocmVjb3JkLm5hbWUpIDogbnVsbDtcbiAgICBpZiAoZml4ZWQpIHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGZpeGVkLnJlc29sdmUoZmlsZSk7XG4gICAgICByZXNvbHZlZFtrZXldID0gaXNMaXN0UHJvcGVydHkoYXBwLCBrZXkpID8gW3Jlc3VsdF0gOiByZXN1bHQ7XG4gICAgfSBlbHNlIGlmIChpc1NjcmlwdFNob3J0Y3V0KHJlY29yZCkpIHtcbiAgICAgIHJlc29sdmVkW2tleV0gPSBudWxsO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXNvbHZlZFtrZXldID0gdmFsdWU7XG4gICAgfVxuICB9XG4gIHJldHVybiByZXNvbHZlZDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIEZJWEVEX1NIT1JUQ1VUUyxcbiAgU0NSSVBUX1BSRUZJWCxcbiAgZmluZEZpeGVkU2hvcnRjdXQsXG4gIHNjcmlwdE5hbWVPZixcbiAgaXNTY3JpcHRTaG9ydGN1dCxcbiAgc2hvcnRjdXRMYWJlbCxcbiAgcGFyc2VBcmdWYWx1ZSxcbiAgYnVpbGRBcmdzLFxuICBpbnB1dFBhcmFtcyxcbiAgcmVzb2x2ZUNhbGxBcmdzLFxuICBSRVNFUlZFRF9QQVJBTVMsXG4gIHJlc29sdmVTaG9ydGN1dHMsXG59O1xuIiwgImNvbnN0IHsgRnV6enlTdWdnZXN0TW9kYWwsIE1vZGFsLCBTZXR0aW5nIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IEZJWEVEX1NIT1JUQ1VUUywgU0NSSVBUX1BSRUZJWCwgYnVpbGRBcmdzLCBpbnB1dFBhcmFtcyB9ID0gcmVxdWlyZShcIi4vc2hvcnRjdXRzXCIpO1xuXG4vLyBMaXN0IGxhYmVsOiB0aGUgbmFtZSwgcGx1cyB0aGUgZGVjbGFyZWQgcGFyYW1ldGVyIG5hbWVzIGZvciBhIHNjcmlwdCwgc29cbi8vIHRoZSBwaWNrZXIgYWxyZWFkeSBzaG93cyB0aGF0IChhbmQgaG93KSBpdCB0YWtlcyBhcmd1bWVudHMuXG5mdW5jdGlvbiBpdGVtTGFiZWwoaXRlbSkge1xuICByZXR1cm4gaXRlbS5wYXJhbXMgPyBgJHtpdGVtLm5hbWV9KCR7aXRlbS5wYXJhbXMuam9pbihcIiwgXCIpfSlgIDogaXRlbS5uYW1lO1xufVxuXG4vLyBQaWNrcyBhIHNob3J0Y3V0IGZvciBhIFRZUC1Gcm9udG1hdHRlciBwcm9wZXJ0eSAoYnV0dG9uIG9yIGNoaXAgaW4gdGhlIHJvdyxcbi8vIHNlZSB0eXAtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKS4gU2VhcmNoYWJsZSwgYW5kIHNjcmlwdHMgc2hvdyB0aGUgZGVzY3JpcHRpb25cbi8vIGZyb20gdGhlaXIgQHR5cC1zaG9ydGN1dCBtYXJrZXIuIE5ldmVyIGZyZWUgdGV4dDogdGhlIGxpc3QgaXMgdGhlIHNvdXJjZSBvZlxuLy8gdHJ1dGgsIHNvIGEgdHlwbyBpbiBhIHNjcmlwdCBuYW1lIGlzIGltcG9zc2libGUuXG5jbGFzcyBTaG9ydGN1dFBpY2tlck1vZGFsIGV4dGVuZHMgRnV6enlTdWdnZXN0TW9kYWwge1xuICBjb25zdHJ1Y3RvcihhcHAsIGtleSwgaXRlbXMsIHJlc29sdmUpIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMuaXRlbXMgPSBpdGVtcztcbiAgICB0aGlzLnJlc29sdmUgPSByZXNvbHZlO1xuICAgIHRoaXMuY2hvc2VuID0gZmFsc2U7XG4gICAgdGhpcy5zZXRQbGFjZWhvbGRlcihgU2hvcnRjdXQgZlx1MDBGQ3IgXHUyMDFFJHtrZXl9XHUyMDFDIFx1MjAxMyBFU0MgZlx1MDBGQ3IgQWJicnVjaGApO1xuICB9XG5cbiAgZ2V0SXRlbXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuaXRlbXM7XG4gIH1cblxuICAvLyBGdXp6eSBzZWFyY2ggYWxzbyBjb3ZlcnMgdGhlIGRlc2NyaXB0aW9uOiBcIkVyc3RlbGx1bmdzZGF0dW1cIiBmaW5kcyBcImNyZWF0ZWRcIi5cbiAgZ2V0SXRlbVRleHQoaXRlbSkge1xuICAgIGNvbnN0IGxhYmVsID0gaXRlbUxhYmVsKGl0ZW0pO1xuICAgIHJldHVybiBpdGVtLmRlc2NyaXB0aW9uID8gYCR7bGFiZWx9ICR7aXRlbS5kZXNjcmlwdGlvbn1gIDogbGFiZWw7XG4gIH1cblxuICByZW5kZXJTdWdnZXN0aW9uKG1hdGNoLCBlbCkge1xuICAgIGNvbnN0IGl0ZW0gPSBtYXRjaC5pdGVtO1xuICAgIGVsLmFkZENsYXNzKFwidHlwLXNob3J0Y3V0LXN1Z2dlc3Rpb25cIik7XG4gICAgZWwuY3JlYXRlRWwoXCJjb2RlXCIsIHsgY2xzOiBcInR5cC1zaG9ydGN1dC1zdWdnZXN0aW9uLW5hbWVcIiwgdGV4dDogaXRlbUxhYmVsKGl0ZW0pIH0pO1xuICAgIGlmIChpdGVtLmRlc2NyaXB0aW9uKSBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1zaG9ydGN1dC1zdWdnZXN0aW9uLWRlc2NcIiwgdGV4dDogaXRlbS5kZXNjcmlwdGlvbiB9KTtcbiAgfVxuXG4gIC8vIE9ic2lkaWFuJ3Mgc2VsZWN0U3VnZ2VzdGlvbigpIGNhbGxzIGNsb3NlKCkgQkVGT1JFIG9uQ2hvb3NlSXRlbSgpLCBzb1xuICAvLyBcImNob3NlblwiIG11c3QgYmUgc2V0IGhlcmUgLSBvdGhlcndpc2Ugb25DbG9zZSgpIHJlc29sdmVzIHdpdGggbnVsbCBmaXJzdFxuICAvLyBhbmQgdGhlIGNob2ljZSBpcyBsb3N0LiBTYW1lIGFzIGluIFR5cFBpY2tlck1vZGFsICh0eXAtcGlja2VyLmpzKS5cbiAgc2VsZWN0U3VnZ2VzdGlvbihpdGVtLCBldnQpIHtcbiAgICB0aGlzLmNob3NlbiA9IHRydWU7XG4gICAgc3VwZXIuc2VsZWN0U3VnZ2VzdGlvbihpdGVtLCBldnQpO1xuICB9XG5cbiAgb25DaG9vc2VJdGVtKGl0ZW0pIHtcbiAgICB0aGlzLnJlc29sdmUoaXRlbSk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHN1cGVyLm9uQ2xvc2UoKTtcbiAgICBpZiAoIXRoaXMuY2hvc2VuKSB0aGlzLnJlc29sdmUobnVsbCk7XG4gIH1cbn1cblxuLy8gQXNrcyBmb3IgdGhlIGFyZ3VtZW50cyBvZiBhIHNjcmlwdCB0aGF0IGRlY2xhcmVzIHNvbWU6IG9uZSBkaWFsb2cgd2l0aCBhbGxcbi8vIGZpZWxkcywgbmFtZWQgYWZ0ZXIgdGhlIHNjcmlwdCdzIHBhcmFtZXRlcnMgYW5kIHByZWZpbGxlZCB3aXRoIHRoZSBzdG9yZWRcbi8vIHZhbHVlcywgc28gcGlja2luZyB0aGUgc2FtZSBzY3JpcHQgYWdhaW4gaXMgaG93IHNpbmdsZSB2YWx1ZXMgZ2V0IGZpeGVkLlxuLy8gQW4gZW1wdHkgZmllbGQgbWVhbnMgXCJub3Qgc2V0XCIgKHNlZSBidWlsZEFyZ3MpOyB0aGVyZSBpcyBubyB2YWxpZGF0aW9uLFxuLy8gc2luY2Ugb25seSB0aGUgc2NyaXB0IGtub3dzIHdoYXQgaXQgbmVlZHMuXG5jbGFzcyBTaG9ydGN1dEFyZ3NNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgY29uc3RydWN0b3IoYXBwLCBpdGVtLCBleGlzdGluZywgcmVzb2x2ZSkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5pdGVtID0gaXRlbTtcbiAgICB0aGlzLnJlc29sdmUgPSByZXNvbHZlO1xuICAgIHRoaXMuZmllbGRzID0gaW5wdXRQYXJhbXMoaXRlbS5wYXJhbXMpO1xuICAgIHRoaXMuaW5wdXRzID0ge307XG4gICAgZm9yIChjb25zdCBuYW1lIG9mIHRoaXMuZmllbGRzKSB7XG4gICAgICBjb25zdCB2YWx1ZSA9IGV4aXN0aW5nPy5bbmFtZV07XG4gICAgICB0aGlzLmlucHV0c1tuYW1lXSA9IHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IG51bGwgPyBcIlwiIDogU3RyaW5nKHZhbHVlKTtcbiAgICB9XG4gICAgdGhpcy5jb25maXJtZWQgPSBmYWxzZTtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICB0aGlzLnRpdGxlRWwuc2V0VGV4dChgQXJndW1lbnRlIGZcdTAwRkNyICR7dGhpcy5pdGVtLm5hbWV9YCk7XG4gICAgaWYgKHRoaXMuaXRlbS5kZXNjcmlwdGlvbikge1xuICAgICAgdGhpcy5jb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zaG9ydGN1dC1hcmdzLWRlc2NcIiwgdGV4dDogdGhpcy5pdGVtLmRlc2NyaXB0aW9uIH0pO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IG5hbWUgb2YgdGhpcy5maWVsZHMpIHtcbiAgICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGVudEVsKS5zZXROYW1lKG5hbWUpLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHRcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5pbnB1dHNbbmFtZV0pXG4gICAgICAgICAgLm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5pbnB1dHNbbmFtZV0gPSB2YWx1ZTtcbiAgICAgICAgICB9KVxuICAgICAgICAgIC8vIEVudGVyIHN1Ym1pdHMsIGxpa2UgT2JzaWRpYW4ncyBvd24gcmVuYW1lIGRpYWxvZ3MuXG4gICAgICAgICAgLmlucHV0RWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XG4gICAgICAgICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVudGVyXCIgJiYgIWV2ZW50LmlzQ29tcG9zaW5nKSB7XG4gICAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICAgIHRoaXMuc3VibWl0KCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSlcbiAgICAgICk7XG4gICAgfVxuICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGVudEVsKS5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgIGJ1dHRvblxuICAgICAgICAuc2V0QnV0dG9uVGV4dChcIlx1MDBEQ2Jlcm5laG1lblwiKVxuICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgLm9uQ2xpY2soKCkgPT4gdGhpcy5zdWJtaXQoKSlcbiAgICApO1xuICB9XG5cbiAgc3VibWl0KCkge1xuICAgIHRoaXMuY29uZmlybWVkID0gdHJ1ZTtcbiAgICB0aGlzLmNsb3NlKCk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gICAgLy8gRVNDIG9yIGEgY2xpY2sgb3V0c2lkZSBrZWVwcyB0aGUgY3VycmVudCBzaG9ydGN1dCAtIGFuIGFjY2lkZW50YWwgY2xvc2VcbiAgICAvLyBtdXN0IG5vdCBzaWxlbnRseSBsb3NlIGRhdGEuXG4gICAgdGhpcy5yZXNvbHZlKHRoaXMuY29uZmlybWVkID8gYnVpbGRBcmdzKHRoaXMuZmllbGRzLCB0aGlzLmlucHV0cykgOiBudWxsKTtcbiAgfVxufVxuXG4vLyBPcGVucyB0aGUgcGlja2VyIGZvciBwcm9wZXJ0eSBga2V5YC4gZ2V0U2NyaXB0cyBpcyB0aGUgYWNjZXNzb3IgZnJvbVxuLy8gcmVnaXN0ZXJTaG9ydGN1dFNjcmlwdHMoKTsgY3VycmVudCBpcyB0aGUgc2hvcnRjdXQgc2V0IG5vdyAodG8gcHJlZmlsbCB0aGVcbi8vIGFyZ3VtZW50cykuIFJlc29sdmVzIHdpdGggdGhlIG5ldyByZWNvcmQgKHsgbmFtZSB9IG9yIHsgbmFtZSwgYXJncyB9KSwgb3Jcbi8vIG51bGwgb24gY2FuY2VsIC0gYWxzbyB3aGVuIGEgc2NyaXB0IHdhcyBwaWNrZWQgYnV0IGl0cyBhcmd1bWVudCBkaWFsb2cgd2FzXG4vLyBjYW5jZWxsZWQuXG5hc3luYyBmdW5jdGlvbiBwaWNrU2hvcnRjdXQoYXBwLCBrZXksIGdldFNjcmlwdHMsIGN1cnJlbnQgPSBudWxsKSB7XG4gIGNvbnN0IGl0ZW1zID0gW1xuICAgIC4uLkZJWEVEX1NIT1JUQ1VUUy5tYXAoKHsgbmFtZSwgZGVzY3JpcHRpb24gfSkgPT4gKHsgbmFtZSwgZGVzY3JpcHRpb24sIHBhcmFtczogbnVsbCB9KSksXG4gICAgLi4uZ2V0U2NyaXB0cygpLm1hcCgoeyBuYW1lLCBwYXJhbXMsIGRlc2NyaXB0aW9uIH0pID0+ICh7IG5hbWU6IFNDUklQVF9QUkVGSVggKyBuYW1lLCBwYXJhbXMsIGRlc2NyaXB0aW9uIH0pKSxcbiAgXTtcblxuICBjb25zdCBpdGVtID0gYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IG5ldyBTaG9ydGN1dFBpY2tlck1vZGFsKGFwcCwga2V5LCBpdGVtcywgcmVzb2x2ZSkub3BlbigpKTtcbiAgaWYgKCFpdGVtKSByZXR1cm4gbnVsbDtcbiAgLy8gTm8gZmllbGRzIHRvIGFzayBmb3IgKGZpeGVkIHRva2Vucywgb3Igb25seSByZXNlcnZlZCBuYW1lcyBsaWtlXG4gIC8vIFwiKG5ld0ZpbGUpXCIpOiBubyBzZWNvbmQgc3RlcC5cbiAgaWYgKGlucHV0UGFyYW1zKGl0ZW0ucGFyYW1zKS5sZW5ndGggPT09IDApIHJldHVybiB7IG5hbWU6IGl0ZW0ubmFtZSB9O1xuXG4gIC8vIFByZWZpbGwgb25seSBmb3IgdGhlIHNhbWUgc2NyaXB0OyBvbGQgdmFsdWVzIG1lYW4gbm90aGluZyB0byBhbm90aGVyIG9uZS5cbiAgY29uc3QgcHJlZmlsbCA9IGN1cnJlbnQ/Lm5hbWUgPT09IGl0ZW0ubmFtZSA/IGN1cnJlbnQuYXJncyA6IG51bGw7XG4gIGNvbnN0IGFyZ3MgPSBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gbmV3IFNob3J0Y3V0QXJnc01vZGFsKGFwcCwgaXRlbSwgcHJlZmlsbCwgcmVzb2x2ZSkub3BlbigpKTtcbiAgaWYgKGFyZ3MgPT09IG51bGwpIHJldHVybiBudWxsO1xuICByZXR1cm4gT2JqZWN0LmtleXMoYXJncykubGVuZ3RoID4gMCA/IHsgbmFtZTogaXRlbS5uYW1lLCBhcmdzIH0gOiB7IG5hbWU6IGl0ZW0ubmFtZSB9O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcGlja1Nob3J0Y3V0IH07XG4iLCAiY29uc3QgeyBNYXJrZG93blZpZXcsIE1lbnUsIFdvcmtzcGFjZUxlYWYsIHNldEljb24gfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgc2hvcnRjdXRMYWJlbCB9ID0gcmVxdWlyZShcIi4vc2hvcnRjdXRzXCIpO1xuY29uc3QgeyBwaWNrU2hvcnRjdXQgfSA9IHJlcXVpcmUoXCIuL3Nob3J0Y3V0LXBpY2tlclwiKTtcbmNvbnN0IHsgZ2V0U3VidHlwLCBlbnN1cmVTdWJ0eXAgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cHNcIik7XG5jb25zdCB7IFRZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZIH0gPSByZXF1aXJlKFwiLi90eXAtaW5kZXhcIik7XG5cbi8vIE1hcmtzIHRoZSBUWVAtRnJvbnRtYXR0ZXIgZWRpdG9yJ3MgY29udGFpbmVyIHNvIHRoZSBzaG9ydGN1dCBydWxlcyBpblxuLy8gc3R5bGVzLmNzcyBhcHBseSBvbmx5IGhlcmUsIG5ldmVyIGluIHJlYWwgbm90ZXMuXG5jb25zdCBFRElUT1JfQ0xBU1MgPSBcInR5cC1mcm9udG1hdHRlci1lZGl0b3JcIjtcblxuY29uc3QgU1lTVEVNX1BST1BFUlRJRVMgPSBbVFlQX1BST1BFUlRZLnRvTG93ZXJDYXNlKCksIFNVQlRZUF9QUk9QRVJUWS50b0xvd2VyQ2FzZSgpXTtcblxuLy8gVGhlIHZhbHVlIG9mIFRZUC9TVUJUWVAgaXMgYnkgZGVmaW5pdGlvbiB0aGUgVFlQIG9yIFN1YnR5cCBuYW1lIGl0c2VsZjsgYXNcbi8vIGEgc3RhbmRhcmQgcHJvcGVydHkgaXQgd291bGQgYmUgcmVkdW5kYW50IGFuZCBjb3VsZCBzaWxlbnRseSBkcmlmdCBmcm9tIHRoZVxuLy8gcmVhbCBuYW1lIGFmdGVyIGEgcmVuYW1lLCBzbyBpdCBuZXZlciBhcHBlYXJzIGFzIGEgcm93IGhlcmUuXG4vLyBNdXRhdGVzIGluIHBsYWNlIGluc3RlYWQgb2YgcmV0dXJuaW5nIGEgY29weTogT2JzaWRpYW4ncyBwcm9wZXJ0eSBlZGl0b3Jcbi8vIHNlZW1zIHRvIHJlbHkgb24gYSBzdGFibGUgb2JqZWN0IHJlZmVyZW5jZSBpbiBzeW5jaHJvbml6ZSgpOyBhIGZyZXNoIGNvcHlcbi8vIGNhdXNlZCBhIHN0YWNrIG92ZXJmbG93IGluIGl0cyByZW5kZXJQcm9wZXJ0eSgpIHBpcGVsaW5lIG9uIGZpcnN0IHJlbmRlci5cbmZ1bmN0aW9uIHN0cmlwVHlwUHJvcGVydHkoZnJvbnRtYXR0ZXIpIHtcbiAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoZnJvbnRtYXR0ZXIpKSB7XG4gICAgaWYgKFNZU1RFTV9QUk9QRVJUSUVTLmluY2x1ZGVzKGtleS50cmltKCkudG9Mb3dlckNhc2UoKSkpIGRlbGV0ZSBmcm9udG1hdHRlcltrZXldO1xuICB9XG4gIHJldHVybiBmcm9udG1hdHRlcjtcbn1cblxuLy8gV2hlcmUgYSBmcm9udG1hdHRlciBibG9jayBsaXZlcyBpbiB0aGUgc2V0dGluZ3M6IGEgVFlQJ3MgVFlQLUZyb250bWF0dGVyXG4vLyAodHlwRGVmYXVsdEZyb250bWF0dGVyL3R5cEZsb2F0aW5nS2V5cy90eXBTaG9ydGN1dHMpIG9yIG9uZSBvZiBpdHMgU3VidHlwXG4vLyBibG9ja3MgKHR5cFN1YnR5cHMsIHNlZSBzdWJ0eXBzLmpzKS4gRWRpdG9yLCBmbG9hdGluZyBtZW51LCBzaG9ydGN1dCBidXR0b25cbi8vIGFuZCBwcm9wZXJ0eSByZW5hbWUgb25seSB1c2UgdGhpcyBpbnRlcmZhY2UgYW5kIG5lZWRuJ3Qga25vdyB3aGljaC5cbi8vXG4vLyBnZXRTaG9ydGN1dHMvc2V0U2hvcnRjdXRzIGhvbGQgdGhlIHNob3J0Y3V0IHJlY29yZHMgcGVyIGtleSAoc2VlXG4vLyBzaG9ydGN1dHMuanMpIC0gbmV4dCB0byB0aGUgZnJvbnRtYXR0ZXIsIG5vdCBpbiBpdCwgc28gdGhlIHZhbHVlIHN0YXlzXG4vLyB0eXBlLWNsZWFuLiBXaXRoIGEgc2hvcnRjdXQgc2V0LCB0aGUgdmFsdWUgcmVtYWlucyBhcyBmYWxsYmFjay5cbmZ1bmN0aW9uIHR5cFN0b3JlKHBsdWdpbiwgdHlwKSB7XG4gIHJldHVybiB7XG4gICAgdHlwLFxuICAgIHN1YnR5cDogbnVsbCxcbiAgICBnZXRGcm9udG1hdHRlcjogKCkgPT4gcGx1Z2luLnNldHRpbmdzLnR5cERlZmF1bHRGcm9udG1hdHRlclt0eXBdID8/IHt9LFxuICAgIHNldEZyb250bWF0dGVyOiAoZnJvbnRtYXR0ZXIpID0+IHtcbiAgICAgIHBsdWdpbi5zZXR0aW5ncy50eXBEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwXSA9IGZyb250bWF0dGVyO1xuICAgIH0sXG4gICAgZ2V0RmxvYXRpbmc6ICgpID0+IHBsdWdpbi5zZXR0aW5ncy50eXBGbG9hdGluZ0tleXNbdHlwXSA/PyBbXSxcbiAgICBzZXRGbG9hdGluZzogKGtleXMpID0+IHtcbiAgICAgIGlmIChrZXlzLmxlbmd0aCA+IDApIHBsdWdpbi5zZXR0aW5ncy50eXBGbG9hdGluZ0tleXNbdHlwXSA9IGtleXM7XG4gICAgICBlbHNlIGRlbGV0ZSBwbHVnaW4uc2V0dGluZ3MudHlwRmxvYXRpbmdLZXlzW3R5cF07XG4gICAgfSxcbiAgICBnZXRTaG9ydGN1dHM6ICgpID0+IHBsdWdpbi5zZXR0aW5ncy50eXBTaG9ydGN1dHNbdHlwXSA/PyB7fSxcbiAgICBzZXRTaG9ydGN1dHM6IChzaG9ydGN1dHMpID0+IHtcbiAgICAgIGlmIChPYmplY3Qua2V5cyhzaG9ydGN1dHMpLmxlbmd0aCA+IDApIHBsdWdpbi5zZXR0aW5ncy50eXBTaG9ydGN1dHNbdHlwXSA9IHNob3J0Y3V0cztcbiAgICAgIGVsc2UgZGVsZXRlIHBsdWdpbi5zZXR0aW5ncy50eXBTaG9ydGN1dHNbdHlwXTtcbiAgICB9LFxuICB9O1xufVxuXG5mdW5jdGlvbiBzdWJ0eXBTdG9yZShwbHVnaW4sIHR5cCwgc3VidHlwKSB7XG4gIHJldHVybiB7XG4gICAgdHlwLFxuICAgIHN1YnR5cCxcbiAgICBnZXRGcm9udG1hdHRlcjogKCkgPT4gZ2V0U3VidHlwKHBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApPy5mcm9udG1hdHRlciA/PyB7fSxcbiAgICBzZXRGcm9udG1hdHRlcjogKGZyb250bWF0dGVyKSA9PiB7XG4gICAgICBlbnN1cmVTdWJ0eXAocGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCkuZnJvbnRtYXR0ZXIgPSBmcm9udG1hdHRlcjtcbiAgICB9LFxuICAgIGdldEZsb2F0aW5nOiAoKSA9PiBnZXRTdWJ0eXAocGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCk/LmZsb2F0aW5nS2V5cyA/PyBbXSxcbiAgICBzZXRGbG9hdGluZzogKGtleXMpID0+IHtcbiAgICAgIGVuc3VyZVN1YnR5cChwbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKS5mbG9hdGluZ0tleXMgPSBrZXlzO1xuICAgIH0sXG4gICAgZ2V0U2hvcnRjdXRzOiAoKSA9PiBnZXRTdWJ0eXAocGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCk/LnNob3J0Y3V0cyA/PyB7fSxcbiAgICBzZXRTaG9ydGN1dHM6IChzaG9ydGN1dHMpID0+IHtcbiAgICAgIGVuc3VyZVN1YnR5cChwbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKS5zaG9ydGN1dHMgPSBzaG9ydGN1dHM7XG4gICAgfSxcbiAgfTtcbn1cblxuLy8gT2JzaWRpYW4ncyBwcm9wZXJ0aWVzIHdpZGdldCBpcyBubyBvZmZpY2lhbCBBUEkuIEludGVybmFsbHkgaXQgaXMgYVxuLy8gY29tcG9uZW50IGNsYXNzIChtaW5pZmllZCBcIk1ldGFkYXRhRWRpdG9yXCIpIHRoYXQgZXZlcnkgTWFya2Rvd25WaWV3IGFuZCB0aGVcbi8vIGZpbGUgcHJvcGVydGllcyBwYW5lIGluc3RhbnRpYXRlIGFzIHZpZXcubWV0YWRhdGFFZGl0b3IuIEl0IGlzbid0IGV4cG9ydGVkLFxuLy8gYnV0IGFueSBpbnN0YW5jZSByZWFjaGVzIGl0IHZpYSAuY29uc3RydWN0b3IsIGFuZCBpdCBpcyBzdGFibGUgZm9yIHRoZVxuLy8gc2Vzc2lvbiAtIGdyYWJiaW5nIGl0IG9uY2UgaXMgZW5vdWdoLlxubGV0IGNhY2hlZEVkaXRvckNsYXNzID0gbnVsbDtcblxuZnVuY3Rpb24gZ2V0TWV0YWRhdGFFZGl0b3JDbGFzcyhhcHApIHtcbiAgaWYgKGNhY2hlZEVkaXRvckNsYXNzKSByZXR1cm4gY2FjaGVkRWRpdG9yQ2xhc3M7XG5cbiAgY29uc3QgYWN0aXZlID0gYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gIGlmIChhY3RpdmU/Lm1ldGFkYXRhRWRpdG9yKSB7XG4gICAgY2FjaGVkRWRpdG9yQ2xhc3MgPSBhY3RpdmUubWV0YWRhdGFFZGl0b3IuY29uc3RydWN0b3I7XG4gICAgcmV0dXJuIGNhY2hlZEVkaXRvckNsYXNzO1xuICB9XG4gIGZvciAoY29uc3QgbGVhZiBvZiBhcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpKSB7XG4gICAgaWYgKGxlYWYudmlldz8ubWV0YWRhdGFFZGl0b3IpIHtcbiAgICAgIGNhY2hlZEVkaXRvckNsYXNzID0gbGVhZi52aWV3Lm1ldGFkYXRhRWRpdG9yLmNvbnN0cnVjdG9yO1xuICAgICAgcmV0dXJuIGNhY2hlZEVkaXRvckNsYXNzO1xuICAgIH1cbiAgfVxuICBjYWNoZWRFZGl0b3JDbGFzcyA9IGhhcnZlc3RFZGl0b3JDbGFzcyhhcHApO1xuICByZXR1cm4gY2FjaGVkRWRpdG9yQ2xhc3M7XG59XG5cbi8vIEJlZm9yZSBhbnkgbm90ZSB3YXMgb3BlbiB0aGlzIHNlc3Npb24gdGhlcmUgaXMgbm8gaW5zdGFuY2UgdG8gcmVhY2ggdGhlXG4vLyBjbGFzcyB0aHJvdWdoLiBUaGVuIHdlIGJ1aWxkIG9uZTogYSBmcmVlIFdvcmtzcGFjZUxlYWYgKG5vIHBhcmVudCwgbmV2ZXIgaW5cbi8vIHRoZSBET00pIHdpdGggYSBNYXJrZG93blZpZXcgZnJvbSBPYnNpZGlhbidzIHZpZXcgcmVnaXN0cnksIHdob3NlXG4vLyBjb25zdHJ1Y3RvciBjcmVhdGVzIG1ldGFkYXRhRWRpdG9yLiBPbmx5IHRoZSBjbGFzcyBpcyBuZWVkZWQ7IHRoZSB2aWV3IGlzXG4vLyB1bmxvYWRlZCByaWdodCBhd2F5LiBEZWxpYmVyYXRlbHkgTk9UIGxlYWYuZGV0YWNoKCk6IHRoYXQgZXhwZWN0cyBhIHBhcmVudFxuLy8gdGhpcyBsZWFmIG5ldmVyIGhhZC5cbmZ1bmN0aW9uIGhhcnZlc3RFZGl0b3JDbGFzcyhhcHApIHtcbiAgbGV0IHZpZXcgPSBudWxsO1xuICB0cnkge1xuICAgIGNvbnN0IGNyZWF0ZVZpZXcgPSBhcHAudmlld1JlZ2lzdHJ5Py5nZXRWaWV3Q3JlYXRvckJ5VHlwZT8uKFwibWFya2Rvd25cIik7XG4gICAgaWYgKCFjcmVhdGVWaWV3KSByZXR1cm4gbnVsbDtcbiAgICB2aWV3ID0gY3JlYXRlVmlldyhuZXcgV29ya3NwYWNlTGVhZihhcHApKTtcbiAgICByZXR1cm4gdmlldy5tZXRhZGF0YUVkaXRvcj8uY29uc3RydWN0b3IgPz8gbnVsbDtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKFwiW3R5cC1zeXN0ZW1dIGNvdWxkbid0IGZpbmQgdGhlIE1ldGFkYXRhRWRpdG9yIGNsYXNzXCIsIGVycm9yKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfSBmaW5hbGx5IHtcbiAgICB0cnkge1xuICAgICAgdmlldz8udW5sb2FkKCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJbdHlwLXN5c3RlbV0gY291bGRuJ3QgZGlzY2FyZCB0aGUgaGVscGVyIE1hcmtkb3duVmlld1wiLCBlcnJvcik7XG4gICAgfVxuICB9XG59XG5cbi8vIExpa2UgZ2V0TWV0YWRhdGFFZGl0b3JDbGFzczogdGhlIHByaXZhdGUgcHJvcGVydHkgcm93IGNsYXNzLCB0YWtlbiBmcm9tIGFuXG4vLyBhbHJlYWR5IHJlbmRlcmVkIHJvdy4gT25seSBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaCgpIG5lZWRzIGl0LCBhbmQgYGVkaXRvcmBcbi8vIHVzdWFsbHkgaGFzIGEgcm93IGJ5IHRoZW4sIHNvIGl0IGlzIHRyaWVkIGZpcnN0LlxubGV0IGNhY2hlZFByb3BlcnR5Um93Q2xhc3MgPSBudWxsO1xuXG5mdW5jdGlvbiBnZXRQcm9wZXJ0eVJvd0NsYXNzKGFwcCwgZWRpdG9yKSB7XG4gIGlmIChjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzKSByZXR1cm4gY2FjaGVkUHJvcGVydHlSb3dDbGFzcztcbiAgaWYgKGVkaXRvcj8ucmVuZGVyZWQ/LlswXSkge1xuICAgIGNhY2hlZFByb3BlcnR5Um93Q2xhc3MgPSBlZGl0b3IucmVuZGVyZWRbMF0uY29uc3RydWN0b3I7XG4gICAgcmV0dXJuIGNhY2hlZFByb3BlcnR5Um93Q2xhc3M7XG4gIH1cbiAgY29uc3QgYWN0aXZlID0gYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gIGlmIChhY3RpdmU/Lm1ldGFkYXRhRWRpdG9yPy5yZW5kZXJlZD8uWzBdKSB7XG4gICAgY2FjaGVkUHJvcGVydHlSb3dDbGFzcyA9IGFjdGl2ZS5tZXRhZGF0YUVkaXRvci5yZW5kZXJlZFswXS5jb25zdHJ1Y3RvcjtcbiAgICByZXR1cm4gY2FjaGVkUHJvcGVydHlSb3dDbGFzcztcbiAgfVxuICBmb3IgKGNvbnN0IGxlYWYgb2YgYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xuICAgIGlmIChsZWFmLnZpZXc/Lm1ldGFkYXRhRWRpdG9yPy5yZW5kZXJlZD8uWzBdKSB7XG4gICAgICBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzID0gbGVhZi52aWV3Lm1ldGFkYXRhRWRpdG9yLnJlbmRlcmVkWzBdLmNvbnN0cnVjdG9yO1xuICAgICAgcmV0dXJuIGNhY2hlZFByb3BlcnR5Um93Q2xhc3M7XG4gICAgfVxuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vLyBBZGRzIGEgXCJGbG9hdGluZ1wiIHRvZ2dsZSBhdCB0aGUgdmVyeSB0b3Agb2YgYSBwcm9wZXJ0eSByb3cncyBjb250ZXh0IG1lbnUgLVxuLy8gb25seSBmb3Igcm93cyBvZiB0aGUgcGx1Z2luJ3Mgb3duIFRZUC1QYW5lIChyZWNvZ25pemVkIGJ5IG93bmVyLnR5cFN0b3JlKSxcbi8vIG5ldmVyIGluIHJlYWwgbm90ZXMuIFVubGlrZSB0aGUgZXh0cmEgXCIrXCIgYnV0dG9uICh0eXBQZW5kaW5nRmxvYXRpbmdBZGQpLFxuLy8gd2hpY2ggb25seSBhZmZlY3RzIGEgTkVXIHByb3BlcnR5LCB0aGlzIHdvcmtzIG9uIGFueSBleGlzdGluZyBvbmUsIGJvdGggd2F5cy5cbi8vXG4vLyBUaGUgcHJvcGVydHkgbWVudSBpcyBubyBvZmZpY2lhbCBleHRlbnNpb24gcG9pbnQ6IG9uIGRlc2t0b3AgaXQgYnVpbGRzIGFcbi8vIE5BVElWRSBFbGVjdHJvbiBtZW51IGZyb20gYW4gaW50ZXJuYWwgTWVudSBhbmQgc2hvd3MgaXQgd2l0aGluXG4vLyBzaG93UHJvcGVydHlNZW51KCkgaW4gb25lIHN5bmNocm9ub3VzIGNhbGwgLSBubyB3b3Jrc3BhY2UgZXZlbnQsIG5vIERPTVxuLy8gcG9wdXAgdG8gYW1lbmQgYWZ0ZXJ3YXJkcy4gU28gdGhlIHByaXZhdGUgcm93IGNsYXNzIGlzIHBhdGNoZWQsIGFzIG5hcnJvd2x5XG4vLyBhcyBwb3NzaWJsZTogZm9yIG91ciByb3dzLCByaWdodCBiZWZvcmUgT2JzaWRpYW4gc2hvd3MgaXRzIGZpbmlzaGVkIG1lbnUsXG4vLyBvbmUgYWRkSXRlbSgpIGlzIHNsaXBwZWQgaW4gdGhyb3VnaCBhIHBhdGNoIG9uIE1lbnUucHJvdG90eXBlLnNob3dBdE1vdXNlRXZlbnRcbi8vIHRoYXQgcmVzZXRzIGl0c2VsZiBhZnRlciB0aGlzIG9uZSBjYWxsIChzYWZlLCBKUyBpcyBzaW5nbGUtdGhyZWFkZWQpLiBUaGVcbi8vIHJlc3Qgb2YgdGhlIG5hdGl2ZSBtZW51IHN0YXlzIHVudG91Y2hlZC5cbmxldCB1bmRvUHJvcGVydHlNZW51UGF0Y2ggPSBudWxsO1xuXG5mdW5jdGlvbiBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaChhcHAsIGVkaXRvcikge1xuICBjb25zdCBSb3dDbGFzcyA9IGdldFByb3BlcnR5Um93Q2xhc3MoYXBwLCBlZGl0b3IpO1xuICBpZiAoIVJvd0NsYXNzIHx8IFJvd0NsYXNzLl90eXBTeXN0ZW1NZW51UGF0Y2hlZCkgcmV0dXJuO1xuICBSb3dDbGFzcy5fdHlwU3lzdGVtTWVudVBhdGNoZWQgPSB0cnVlO1xuXG4gIGNvbnN0IG9yaWdpbmFsU2hvd1Byb3BlcnR5TWVudSA9IFJvd0NsYXNzLnByb3RvdHlwZS5zaG93UHJvcGVydHlNZW51O1xuICB1bmRvUHJvcGVydHlNZW51UGF0Y2ggPSAoKSA9PiB7XG4gICAgUm93Q2xhc3MucHJvdG90eXBlLnNob3dQcm9wZXJ0eU1lbnUgPSBvcmlnaW5hbFNob3dQcm9wZXJ0eU1lbnU7XG4gICAgZGVsZXRlIFJvd0NsYXNzLl90eXBTeXN0ZW1NZW51UGF0Y2hlZDtcbiAgfTtcbiAgUm93Q2xhc3MucHJvdG90eXBlLnNob3dQcm9wZXJ0eU1lbnUgPSBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICBjb25zdCBvd25lciA9IHRoaXMubWV0YWRhdGFFZGl0b3I/Lm93bmVyO1xuICAgIGlmICghb3duZXI/LnR5cFN0b3JlKSByZXR1cm4gb3JpZ2luYWxTaG93UHJvcGVydHlNZW51LmNhbGwodGhpcywgZXZlbnQpO1xuXG4gICAgY29uc3Qgcm93ID0gdGhpcztcbiAgICBjb25zdCBvcmlnaW5hbFNob3dBdE1vdXNlRXZlbnQgPSBNZW51LnByb3RvdHlwZS5zaG93QXRNb3VzZUV2ZW50O1xuICAgIE1lbnUucHJvdG90eXBlLnNob3dBdE1vdXNlRXZlbnQgPSBmdW5jdGlvbiAobW91c2VFdmVudCkge1xuICAgICAgTWVudS5wcm90b3R5cGUuc2hvd0F0TW91c2VFdmVudCA9IG9yaWdpbmFsU2hvd0F0TW91c2VFdmVudDtcbiAgICAgIGNvbnN0IGlzRmxvYXRpbmcgPSBvd25lci50eXBTdG9yZS5nZXRGbG9hdGluZygpLmluY2x1ZGVzKHJvdy5lbnRyeS5rZXkpO1xuICAgICAgLy8gXCJ0aXRsZVwiIGlzIHRoZSBmaXJzdCBzZWN0aW9uIHNob3dQcm9wZXJ0eU1lbnUgcmVnaXN0ZXJzIGFuZCBpcyBlbXB0eVxuICAgICAgLy8gb24gZGVza3RvcCwgc28gdGhpcyBsYW5kcyByZWxpYWJseSBvbiB0b3AuIFwicGluLW9mZlwiID0gbm90IHBpbm5lZCA9XG4gICAgICAvLyBmbG9hdGluZy5cbiAgICAgIHRoaXMuYWRkSXRlbSgoaXRlbSkgPT5cbiAgICAgICAgaXRlbVxuICAgICAgICAgIC5zZXRUaXRsZShcIkZsb2F0aW5nXCIpXG4gICAgICAgICAgLnNldEljb24oXCJwaW4tb2ZmXCIpXG4gICAgICAgICAgLnNldENoZWNrZWQoaXNGbG9hdGluZylcbiAgICAgICAgICAuc2V0U2VjdGlvbihcInRpdGxlXCIpXG4gICAgICAgICAgLm9uQ2xpY2soKCkgPT4gdG9nZ2xlRmxvYXRpbmdQcm9wZXJ0eShvd25lci50eXBQYW5lLCBvd25lci50eXBTdG9yZSwgcm93LmVudHJ5LmtleSkpXG4gICAgICApO1xuICAgICAgcmV0dXJuIG9yaWdpbmFsU2hvd0F0TW91c2VFdmVudC5jYWxsKHRoaXMsIG1vdXNlRXZlbnQpO1xuICAgIH07XG5cbiAgICByZXR1cm4gb3JpZ2luYWxTaG93UHJvcGVydHlNZW51LmNhbGwodGhpcywgZXZlbnQpO1xuICB9O1xufVxuXG4vLyBPbiB1bmxvYWQ7IG90aGVyd2lzZSB0aGUgcGF0Y2ggd291bGQgb3V0bGl2ZSBhIGhvdCByZWxvYWQgd2l0aCB0aGUgb2xkXG4vLyBtb2R1bGUncyBjbG9zdXJlcy5cbmZ1bmN0aW9uIHJlbW92ZVByb3BlcnR5TWVudVBhdGNoKCkge1xuICB1bmRvUHJvcGVydHlNZW51UGF0Y2g/LigpO1xuICB1bmRvUHJvcGVydHlNZW51UGF0Y2ggPSBudWxsO1xufVxuXG5mdW5jdGlvbiB0b2dnbGVGbG9hdGluZ1Byb3BlcnR5KHZpZXcsIHN0b3JlLCBrZXkpIHtcbiAgY29uc3QgZmxvYXRpbmcgPSBzdG9yZS5nZXRGbG9hdGluZygpO1xuICBzdG9yZS5zZXRGbG9hdGluZyhmbG9hdGluZy5pbmNsdWRlcyhrZXkpID8gZmxvYXRpbmcuZmlsdGVyKChrKSA9PiBrICE9PSBrZXkpIDogWy4uLmZsb2F0aW5nLCBrZXldKTtcbiAgdmlldy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gIC8vIFVwZGF0ZXMgdGhlIGJvbGQvaXRhbGljIG1hcmtzIGF0IG9uY2UsIGhlcmUgYW5kIGluIG9wZW4gbm90ZXMuXG4gIHZpZXcucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xufVxuXG4vLyBLZXlib2FyZCBuYXZpZ2F0aW9uIGJleW9uZCBvbmUgZWRpdG9yIGluc3RhbmNlIChzZWUgZnJvbnRtYXR0ZXItYmxvY2tzLmpzKTpcbi8vIE9ic2lkaWFuIG1vdmVzIGZvY3VzIG9ubHkgd2l0aGluIGl0cyBvd24gcm93IGxpc3QsIGFuZCBhdCBlaXRoZXIgZW5kIG9udG9cbi8vIHRoZSBlZGl0b3IncyBoZWFkaW5nIG9yIFwiQWRkIHByb3BlcnR5XCIgYnV0dG9uIC0gYm90aCBoaWRkZW4gaGVyZSBieSBDU1MsIHNvXG4vLyB0aGUgY2hhaW4gc3RvcHBlZCBhdCB0aGUgYmxvY2sgZWRnZS5cbi8vXG4vLyBvd25lci5zaGlmdEZvY3VzQmVmb3JlL0FmdGVyIGFyZSBvbmx5IHJlYWNoZWQgdGhyb3VnaCBleGFjdGx5IHRob3NlIGhpZGRlblxuLy8gZWxlbWVudHMsIHNvIGluc3RlYWQgYSBjYXB0dXJlLXBoYXNlIGhhbmRsZXIgcnVucyBCRUZPUkUgdGhlIHJvdydzIG93bi4gSXRcbi8vIG9ubHkgYWN0cyB3aGlsZSB0aGUgcm93IElUU0VMRiBoYXMgZm9jdXMgKGV2ZW50LnRhcmdldCBpcyB0aGUgcm93J3Ncbi8vIGNvbnRhaW5lcikgLSB0aGUgc2FtZSBjb25kaXRpb24gdW5kZXIgd2hpY2ggT2JzaWRpYW4gYWxsb3dzIGovaywgc28gbmV2ZXJcbi8vIHdoaWxlIHR5cGluZyBpbiBhIGZpZWxkLlxuZnVuY3Rpb24gcmVnaXN0ZXJGb2N1c0NoYWluKGVkaXRvciwgb25TaGlmdEZvY3VzKSB7XG4gIGVkaXRvci5jb250YWluZXJFbC5hZGRFdmVudExpc3RlbmVyKFxuICAgIFwia2V5ZG93blwiLFxuICAgIChldmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmlzQ29tcG9zaW5nIHx8IGV2ZW50LmRlZmF1bHRQcmV2ZW50ZWQpIHJldHVybjtcbiAgICAgIC8vIE11bHRpLXNlbGVjdGlvbjogT2JzaWRpYW4gZXh0ZW5kcyB0aGUgc2VsZWN0aW9uIGluc3RlYWQgb2YgbW92aW5nLlxuICAgICAgaWYgKGVkaXRvci5zZWxlY3RlZExpbmVzPy5zaXplID4gMSkgcmV0dXJuO1xuICAgICAgaWYgKGV2ZW50LnNoaWZ0S2V5ICYmIChldmVudC5rZXkgPT09IFwiQXJyb3dVcFwiIHx8IGV2ZW50LmtleSA9PT0gXCJBcnJvd0Rvd25cIikpIHJldHVybjtcblxuICAgICAgY29uc3QgaW5kZXggPSBlZGl0b3IucmVuZGVyZWQuZmluZEluZGV4KChyb3cpID0+IHJvdy5jb250YWluZXJFbCA9PT0gZXZlbnQudGFyZ2V0KTtcbiAgICAgIGlmIChpbmRleCA9PT0gLTEpIHJldHVybjtcblxuICAgICAgY29uc3QgdXAgPSBldmVudC5rZXkgPT09IFwiQXJyb3dVcFwiIHx8IGV2ZW50LmtleSA9PT0gXCJrXCIgfHwgKGV2ZW50LmtleSA9PT0gXCJUYWJcIiAmJiBldmVudC5zaGlmdEtleSk7XG4gICAgICBjb25zdCBkb3duID0gZXZlbnQua2V5ID09PSBcIkFycm93RG93blwiIHx8IGV2ZW50LmtleSA9PT0gXCJqXCIgfHwgKGV2ZW50LmtleSA9PT0gXCJUYWJcIiAmJiAhZXZlbnQuc2hpZnRLZXkpO1xuICAgICAgbGV0IHN0ZXAgPSAwO1xuICAgICAgaWYgKHVwICYmIGluZGV4ID09PSAwKSBzdGVwID0gLTE7XG4gICAgICBlbHNlIGlmIChkb3duICYmIGluZGV4ID09PSBlZGl0b3IucmVuZGVyZWQubGVuZ3RoIC0gMSkgc3RlcCA9IDE7XG4gICAgICBpZiAoc3RlcCA9PT0gMCB8fCAhb25TaGlmdEZvY3VzKHN0ZXApKSByZXR1cm47XG5cbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICB9LFxuICAgIHRydWVcbiAgKTtcbn1cblxuLy8gVGhlIHdpZGdldCB0YWtlcyBhbiBcIm93bmVyXCIgYXMgc2Vjb25kIGNvbnN0cnVjdG9yIGFyZ3VtZW50IC0gdGhlIG9ubHkgdGhpbmdcbi8vIGJpbmRpbmcgaXQgdG8gYSBmaWxlLiBIZXJlIGl0IGlzIGJvdW5kIHRvIGEgcGxhaW4gb2JqZWN0IGluIHRoZSBzZXR0aW5nczpcbi8vIHNhdmVGcm9udG1hdHRlcihvYmopIGdldHMgdGhlIGZ1bGwgcHJvcGVydHkgc2V0IG9uIGV2ZXJ5IGNoYW5nZS5cbi8vIHNoaWZ0Rm9jdXNCZWZvcmUvQWZ0ZXIgbWF5IGJlIG5vLW9wcy4gZ2V0RmlsZSgpIGlzIGNhbGxlZCBieSBldmVyeSByb3cgd2hpbGVcbi8vIHJlbmRlcmluZyAoZm9yIHNvdXJjZVBhdGgpOyB0aGVyZSBpcyBubyByZWFsIGZpbGUsIGJ1dCB0aGUgbWV0aG9kIG11c3QgZXhpc3Rcbi8vIG9yIHRoZSB3aWRnZXQgY3Jhc2hlcy5cbi8vXG4vLyBPbmUgZWRpdG9yIHBlciBibG9jayAoVFlQIG9yIFN1YnR5cCksIGJvdW5kIHRvIGBzdG9yZWAuIFN0YW5kYXJkIGFuZFxuLy8gZmxvYXRpbmcgcHJvcGVydGllcyBzaGFyZSBvbmUgbGlzdCBhbmQgb3JkZXI7IGdldFR5cERlZmF1bHRzKCkganVzdCBsZWF2ZXNcbi8vIHRoZSBmbG9hdGluZyBvbmVzIG91dC4gZWRpdG9yLnR5cFBlbmRpbmdGbG9hdGluZ0FkZCwgc2V0IGJlZm9yZVxuLy8gYWRkQmxhbmtQcm9wZXJ0eSgpLCBtYXJrcyB0aGUgbmV4dCBhZGRlZCAob3IgcmVuYW1lZCkgcHJvcGVydHkgYXMgZmxvYXRpbmcgLVxuLy8gc2VlIHNhdmVGcm9udG1hdHRlci5cbmZ1bmN0aW9uIG1vdW50RnJvbnRtYXR0ZXJFZGl0b3IodmlldywgY29udGFpbmVyRWwsIHN0b3JlLCB7IG9uU2hpZnRGb2N1cyB9ID0ge30pIHtcbiAgY29uc3QgYXBwID0gdmlldy5hcHA7XG4gIGNvbnN0IEVkaXRvckNsYXNzID0gZ2V0TWV0YWRhdGFFZGl0b3JDbGFzcyhhcHApO1xuICBpZiAoIUVkaXRvckNsYXNzKSB7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgIGNsczogXCJ0eXAtZnJvbnRtYXR0ZXItdW5hdmFpbGFibGVcIixcbiAgICAgIHRleHQ6IFwiWnVtIEluaXRpYWxpc2llcmVuIGRlcyBFZGl0b3JzIGJpdHRlIHp1ZXJzdCBlaW5tYWwgZWluZSBOb3RpeiBcdTAwRjZmZm5lbi5cIixcbiAgICB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IG93bmVyID0ge1xuICAgIGFwcCxcbiAgICAvLyBMZXRzIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoKCkgcmVjb2duaXplIHJvd3Mgb2YgdGhpcyBlZGl0b3IgYW5kIGdpdmVzXG4gICAgLy8gdGhlIGdsb2JhbCBtZW51IHBhdGNoIHRoZSBzdG9yZSBhbmQgdmlldyBwZXIgcm93ICh0aGUgcGF0Y2ggaXRzZWxmIGlzXG4gICAgLy8gaW5zdGFsbGVkIG9ubHkgb25jZSkuXG4gICAgdHlwU3RvcmU6IHN0b3JlLFxuICAgIHR5cFBhbmU6IHZpZXcsXG4gICAgZ2V0RmlsZSgpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH0sXG4gICAgLy8gT25seSBmb3IgT2JzaWRpYW4ncyBob3ZlciBwcmV2aWV3IG9mIGludGVybmFsIGxpbmtzIGluIGEgdmFsdWU7IGFueVxuICAgIC8vIHN0cmluZyB3aWxsIGRvLlxuICAgIGdldEhvdmVyU291cmNlKCkge1xuICAgICAgcmV0dXJuIFwidHlwLWZyb250bWF0dGVyXCI7XG4gICAgfSxcbiAgICBzaGlmdEZvY3VzQmVmb3JlKCkge30sXG4gICAgc2hpZnRGb2N1c0FmdGVyKCkge30sXG4gICAgLy8gQ2FsbGVkIG9uY2UgcGVyIGNvbXBsZXRlZCBjaGFuZ2UgKGEgcmVuYW1lIG9ubHkgb24gYmx1ciBvZiB0aGUga2V5XG4gICAgLy8gaW5wdXQpLCBzbyBlYWNoIGNhbGwgYWRkcyBhbmQvb3IgcmVtb3ZlcyBhdCBtb3N0IG9uZSBub24tZW1wdHkgcHJvcGVydHksXG4gICAgLy8gZXhjZXB0IGEgbXVsdGktZGVsZXRlLiBUaGF0IGtlZXBzIHRoZSBmbG9hdGluZyBmbGFnIGVhc3kgdG8gdHJhY2tcbiAgICAvLyB3aXRob3V0IGZvbGxvd2luZyBpbnRlcm1lZGlhdGUgdHlwaW5nIHN0YXRlcy5cbiAgICBzYXZlRnJvbnRtYXR0ZXIoZnJvbnRtYXR0ZXIpIHtcbiAgICAgIC8vIEEgcm93IGp1c3QgbmFtZWQgXCJUWVBcIi9cIlNVQlRZUFwiIGlzbid0IHNhdmVkLiBJdCBzdGF5cyB2aXNpYmxlIHVudGlsXG4gICAgICAvLyB0aGUgbmV4dCBtb3VudCAobm8gc3luY2hyb25pemUoKSBoZXJlLCBzZWUgc3RyaXBUeXBQcm9wZXJ0eSkuXG4gICAgICBzdHJpcFR5cFByb3BlcnR5KGZyb250bWF0dGVyKTtcblxuICAgICAgY29uc3QgcHJldmlvdXMgPSBzdG9yZS5nZXRGcm9udG1hdHRlcigpO1xuICAgICAgY29uc3QgcHJldmlvdXNLZXlzID0gT2JqZWN0LmtleXMocHJldmlvdXMpLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwiXCIpO1xuICAgICAgY29uc3QgY3VycmVudEtleXMgPSBPYmplY3Qua2V5cyhmcm9udG1hdHRlcikuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gXCJcIik7XG4gICAgICBjb25zdCByZW1vdmVkS2V5cyA9IHByZXZpb3VzS2V5cy5maWx0ZXIoKGtleSkgPT4gIWN1cnJlbnRLZXlzLmluY2x1ZGVzKGtleSkpO1xuICAgICAgY29uc3QgYWRkZWRLZXlzID0gY3VycmVudEtleXMuZmlsdGVyKChrZXkpID0+ICFwcmV2aW91c0tleXMuaW5jbHVkZXMoa2V5KSk7XG5cbiAgICAgIGxldCBmbG9hdGluZyA9IHN0b3JlLmdldEZsb2F0aW5nKCk7XG4gICAgICBpZiAocmVtb3ZlZEtleXMubGVuZ3RoID09PSAxICYmIGFkZGVkS2V5cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgLy8gQSByZW5hbWU6IHRoZSBmbG9hdGluZyBmbGFnIG1vdmVzIGFsb25nLlxuICAgICAgICBmbG9hdGluZyA9IGZsb2F0aW5nLm1hcCgoa2V5KSA9PiAoa2V5ID09PSByZW1vdmVkS2V5c1swXSA/IGFkZGVkS2V5c1swXSA6IGtleSkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKHJlbW92ZWRLZXlzLmxlbmd0aCA+IDApIGZsb2F0aW5nID0gZmxvYXRpbmcuZmlsdGVyKChrZXkpID0+ICFyZW1vdmVkS2V5cy5pbmNsdWRlcyhrZXkpKTtcbiAgICAgICAgaWYgKGVkaXRvci50eXBQZW5kaW5nRmxvYXRpbmdBZGQgJiYgYWRkZWRLZXlzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAgIGZsb2F0aW5nID0gWy4uLmZsb2F0aW5nLCBhZGRlZEtleXNbMF1dO1xuICAgICAgICAgIGVkaXRvci50eXBQZW5kaW5nRmxvYXRpbmdBZGQgPSBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gU2hvcnRjdXRzIGJlbG9uZyB0byB0aGUga2V5IHRvbzogdGhleSBtb3ZlIG9uIHJlbmFtZSBhbmQgZ28gb24gZGVsZXRlLlxuICAgICAgY29uc3Qgc2hvcnRjdXRzID0geyAuLi5zdG9yZS5nZXRTaG9ydGN1dHMoKSB9O1xuICAgICAgaWYgKHJlbW92ZWRLZXlzLmxlbmd0aCA9PT0gMSAmJiBhZGRlZEtleXMubGVuZ3RoID09PSAxKSB7XG4gICAgICAgIGlmIChzaG9ydGN1dHNbcmVtb3ZlZEtleXNbMF1dKSB7XG4gICAgICAgICAgc2hvcnRjdXRzW2FkZGVkS2V5c1swXV0gPSBzaG9ydGN1dHNbcmVtb3ZlZEtleXNbMF1dO1xuICAgICAgICAgIGRlbGV0ZSBzaG9ydGN1dHNbcmVtb3ZlZEtleXNbMF1dO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmb3IgKGNvbnN0IGtleSBvZiByZW1vdmVkS2V5cykgZGVsZXRlIHNob3J0Y3V0c1trZXldO1xuICAgICAgfVxuXG4gICAgICBzdG9yZS5zZXRGcm9udG1hdHRlcihmcm9udG1hdHRlcik7XG4gICAgICBzdG9yZS5zZXRGbG9hdGluZyhmbG9hdGluZyk7XG4gICAgICBzdG9yZS5zZXRTaG9ydGN1dHMoc2hvcnRjdXRzKTtcbiAgICAgIHZpZXcucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgLy8gQSBuZXdseSBuYW1lZCByb3cgZ2V0cyBpdHMgYnV0dG9uLCBhIGRlbGV0ZWQgb25lIHRha2VzIGl0IGFsb25nLlxuICAgICAgcmVuZGVyU2hvcnRjdXRDb250cm9scyh2aWV3LCBlZGl0b3IsIHN0b3JlKTtcbiAgICAgIC8vIEJvbGQvaXRhbGljIG1hcmtzIGluIG9wZW4gbm90ZXMgZm9sbG93IHRoZSBjaGFuZ2VkIGxpc3QgYXQgb25jZS5cbiAgICAgIHZpZXcucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgIH0sXG4gIH07XG5cbiAgY29uc3QgZWRpdG9yID0gbmV3IEVkaXRvckNsYXNzKGFwcCwgb3duZXIpO1xuICBlZGl0b3IudHlwUGVuZGluZ0Zsb2F0aW5nQWRkID0gZmFsc2U7XG4gIGlmIChvblNoaWZ0Rm9jdXMpIHJlZ2lzdGVyRm9jdXNDaGFpbihlZGl0b3IsIG9uU2hpZnRGb2N1cyk7XG4gIGVkaXRvci5jb250YWluZXJFbC5hZGRDbGFzcyhFRElUT1JfQ0xBU1MpO1xuICBjb250YWluZXJFbC5hcHBlbmRDaGlsZChlZGl0b3IuY29udGFpbmVyRWwpO1xuICB2aWV3LmFkZENoaWxkKGVkaXRvcik7XG5cbiAgZWRpdG9yLnN5bmNocm9uaXplKHN0b3JlLmdldEZyb250bWF0dGVyKCkpO1xuICByZW5kZXJTaG9ydGN1dENvbnRyb2xzKHZpZXcsIGVkaXRvciwgc3RvcmUpO1xuICAvLyBPbmx5IGFmdGVyIHRoZSBmaXJzdCBzeW5jaHJvbml6ZSgpIChzZWUgZ2V0UHJvcGVydHlSb3dDbGFzcykuIEEgbm8tb3AgZm9yXG4gIC8vIGEgc3RpbGwgZW1wdHkgVFlQOyB0aGUgbmV4dCBub24tZW1wdHkgb25lIChvciBhbiBvcGVuIG5vdGUpIHN1cHBsaWVzIHRoZVxuICAvLyBjbGFzcy5cbiAgZW5zdXJlUHJvcGVydHlNZW51UGF0Y2goYXBwLCBlZGl0b3IpO1xuICByZXR1cm4gZWRpdG9yO1xufVxuXG5jb25zdCBDSElQX0NMQVNTID0gXCJ0eXAtc2hvcnRjdXQtY2hpcFwiO1xuY29uc3QgQ0hJUF9URVhUX0NMQVNTID0gXCJ0eXAtc2hvcnRjdXQtY2hpcC10ZXh0XCI7XG5jb25zdCBCVVRUT05fQ0xBU1MgPSBcInR5cC1zaG9ydGN1dC1idXR0b25cIjtcbmNvbnN0IFJPV19DTEFTUyA9IFwidHlwLWhhcy1zaG9ydGN1dFwiO1xuY29uc3QgV0FSTklOR19DTEFTUyA9IFwidHlwLXNob3J0Y3V0LWJsb2NrZWRcIjtcblxuLy8gQnV0dG9uIGFuZCBjaGlwIHBlciBwcm9wZXJ0eSByb3cuIEJvdGggaGFuZyBvbiB0aGUgcm93J3MgY29udGFpbmVyRWwsIE5PVCBpdHNcbi8vIHZhbHVlRWw6IHJlbmRlclByb3BlcnR5KCkgb25seSBldmVyIGVtcHRpZXMgdmFsdWVFbCwgc28gYW55dGhpbmcgYXR0YWNoZWQgdG9cbi8vIGNvbnRhaW5lckVsIHN1cnZpdmVzIGV2ZXJ5IHR5cGUgb3IgdmFsdWUgY2hhbmdlIHdpdGhvdXQgdG91Y2hpbmdcbi8vIE9ic2lkaWFuJ3MgcmVuZGVyIHBpcGVsaW5lLlxuLy9cbi8vIFRoZSBidXR0b24gdG9nZ2xlczogd2l0aG91dCBhIHNob3J0Y3V0IGl0IG9wZW5zIHRoZSBwaWNrZXIsIHdpdGggb25lIGl0XG4vLyByZW1vdmVzIGl0LiBUaGUgY2hpcCBpdHNlbGYgaXMgZm9yIENIQU5HSU5HIGl0LiBDU1Mgc2hvd3MgdGhlIGJ1dHRvbiBvbmx5IG9uXG4vLyByb3cgaG92ZXIvZm9jdXMgKGFuZCBwZXJtYW5lbnRseSB3aGlsZSBhIHNob3J0Y3V0IGlzIHNldCkgLSBvdGhlcndpc2UgZXZlcnlcbi8vIHJvdyB3b3VsZCBjYXJyeSBhIGNvbnRyb2wgbW9zdCBuZXZlciBuZWVkLlxuLy9cbi8vIEhpZGluZyB0aGUgdmFsdWUgZmllbGQgd2hpbGUgYSBzaG9ydGN1dCBpcyBzZXQgaXMgcHVyZSBDU1MgKFJPV19DTEFTUyBpblxuLy8gc3R5bGVzLmNzcyk7IHRoZSBuYXRpdmUgd2lkZ2V0IGtlZXBzIHJlbmRlcmluZyB1bmRlcm5lYXRoLiBTZXR0aW5nIGFuZFxuLy8gcmVtb3ZpbmcgaXMganVzdCBhIGNsYXNzIHRvZ2dsZSwgbm8gcmVuZGVyUHJvcGVydHkoKS9zeW5jaHJvbml6ZSgpIC0gd2hpY2hcbi8vIHdvdWxkIGJlIHJpc2t5IGhlcmUgYW55d2F5IChzZWUgc3RyaXBUeXBQcm9wZXJ0eSkuXG5mdW5jdGlvbiByZW5kZXJTaG9ydGN1dENvbnRyb2xzKHZpZXcsIGVkaXRvciwgc3RvcmUpIHtcbiAgY29uc3Qgc2hvcnRjdXRzID0gc3RvcmUuZ2V0U2hvcnRjdXRzKCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIGVkaXRvci5yZW5kZXJlZCA/PyBbXSkge1xuICAgIGNvbnN0IGNvbnRhaW5lckVsID0gcm93LmNvbnRhaW5lckVsO1xuICAgIGNvbnN0IGtleSA9IHJvdy5lbnRyeT8ua2V5ID8/IFwiXCI7XG4gICAgLy8gQW4gdW5uYW1lZCByb3cgY2FuJ3QgY2FycnkgYSBzaG9ydGN1dCAtIHRoZXJlIGlzIG5vIGtleSB0byBzdG9yZSBpdFxuICAgIC8vIHVuZGVyLiBUaGUgYnV0dG9uIGFwcGVhcnMgb25jZSBpdCBoYXMgYSBuYW1lIChldmVyeSBjaGFuZ2UgcGFzc2VzXG4gICAgLy8gdGhyb3VnaCBzYXZlRnJvbnRtYXR0ZXIgYW5kIHNvIHRocm91Z2ggaGVyZSkuXG4gICAgY29uc3QgcmVjb3JkID0ga2V5ID09PSBcIlwiID8gbnVsbCA6IHNob3J0Y3V0c1trZXldID8/IG51bGw7XG4gICAgY29udGFpbmVyRWwudG9nZ2xlQ2xhc3MoUk9XX0NMQVNTLCAhIXJlY29yZCk7XG5cbiAgICAvLyBPYnNpZGlhbidzIHdhcm5pbmcgdHJpYW5nbGUgc2l0cyBhYnNvbHV0ZWx5IGF0IHRoZSByb3cncyByaWdodCBlZGdlIC1cbiAgICAvLyBleGFjdGx5IHdoZXJlIHRoZSBzaG9ydGN1dCBidXR0b24gZ29lcy4gSWYgdGhlIHJvdyBzaG93cyBhIHR5cGUgd2FybmluZ1xuICAgIC8vIGFuZCBoYXMgTk8gc2hvcnRjdXQsIHRoZSBidXR0b24gZ2l2ZXMgd2F5LiBXaXRoIGEgc2hvcnRjdXQgc2V0LCB0aGVcbiAgICAvLyBidXR0b24gc3RheXMgKGl0IGlzIHRoZSBvbmx5IHdheSB0byByZW1vdmUgdGhlIHNob3J0Y3V0KSBhbmQgdGhlXG4gICAgLy8gdHJpYW5nbGUgZ2l2ZXMgd2F5IGluc3RlYWQgKHN0eWxlcy5jc3MpOiBpdCB3b3VsZCB0aGVuIHJlZmVyIHRvIHRoZVxuICAgIC8vIGhpZGRlbiBmYWxsYmFjayB2YWx1ZSwgd2hpY2ggY2FuJ3QgYmUgZml4ZWQgdGhlcmUgYW55d2F5LlxuICAgIGNvbnN0IG1pc21hdGNoID0gISFyb3cudHlwZUluZm8gJiYgcm93LnR5cGVJbmZvLmV4cGVjdGVkICE9PSByb3cudHlwZUluZm8uaW5mZXJyZWQ7XG4gICAgY29udGFpbmVyRWwudG9nZ2xlQ2xhc3MoV0FSTklOR19DTEFTUywgbWlzbWF0Y2ggJiYgIXJlY29yZCk7XG5cbiAgICBsZXQgYnV0dG9uRWwgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKGA6c2NvcGUgPiAuJHtCVVRUT05fQ0xBU1N9YCk7XG4gICAgaWYgKGtleSA9PT0gXCJcIikge1xuICAgICAgYnV0dG9uRWw/LnJlbW92ZSgpO1xuICAgICAgY29udGFpbmVyRWwucXVlcnlTZWxlY3RvcihgOnNjb3BlID4gLiR7Q0hJUF9DTEFTU31gKT8ucmVtb3ZlKCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKCFidXR0b25FbCkge1xuICAgICAgYnV0dG9uRWwgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IGBjbGlja2FibGUtaWNvbiAke0JVVFRPTl9DTEFTU31gIH0pO1xuICAgICAgc2V0SWNvbihidXR0b25FbCwgXCJzcXVhcmUtZnVuY3Rpb25cIik7XG4gICAgICAvLyBSZWFkIHRoZSBrZXkgb24gY2xpY2ssIG5vdCBoZXJlOiBhIHJlbmFtZSBjaGFuZ2VzIHJvdy5lbnRyeS5rZXlcbiAgICAgIC8vIHdpdGhvdXQgcmVjcmVhdGluZyB0aGUgcm93LlxuICAgICAgYnV0dG9uRWwuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgICAgaWYgKHN0b3JlLmdldFNob3J0Y3V0cygpW3Jvdy5lbnRyeT8ua2V5ID8/IFwiXCJdKSByZW1vdmVTaG9ydGN1dCh2aWV3LCBlZGl0b3IsIHN0b3JlLCByb3cpO1xuICAgICAgICBlbHNlIG9wZW5TaG9ydGN1dFBpY2tlcih2aWV3LCBlZGl0b3IsIHN0b3JlLCByb3cpO1xuICAgICAgfSk7XG4gICAgfVxuICAgIGJ1dHRvbkVsLnNldEF0dHIoXCJhcmlhLWxhYmVsXCIsIHJlY29yZCA/IFwiU2hvcnRjdXQgZW50ZmVybmVuXCIgOiBcIlNob3J0Y3V0IHNldHplblwiKTtcblxuICAgIGxldCBjaGlwRWwgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKGA6c2NvcGUgPiAuJHtDSElQX0NMQVNTfWApO1xuICAgIGlmICghcmVjb3JkKSB7XG4gICAgICBjaGlwRWw/LnJlbW92ZSgpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICghY2hpcEVsKSB7XG4gICAgICBjaGlwRWwgPSBjcmVhdGVFbChcImNvZGVcIiwgeyBjbHM6IENISVBfQ0xBU1MgfSk7XG4gICAgICAvLyBUZXh0IGluIGl0cyBvd24gc3BhbjogdGhlIGNoaXAgaXMgYSBmbGV4IGNvbnRhaW5lciAodmVydGljYWxcbiAgICAgIC8vIGNlbnRlcmluZyBsaWtlIHRoZSByZWFsIHZhbHVlIGZpZWxkKSwgYW5kIHRleHQtb3ZlcmZsb3c6IGVsbGlwc2lzXG4gICAgICAvLyBvbmx5IHdvcmtzIG9uIGEgYmxvY2sgZWxlbWVudC5cbiAgICAgIGNoaXBFbC5jcmVhdGVTcGFuKHsgY2xzOiBDSElQX1RFWFRfQ0xBU1MgfSk7XG4gICAgICBjaGlwRWwuc2V0QXR0cihcImFyaWEtbGFiZWxcIiwgXCJTaG9ydGN1dCBcdTAwRTRuZGVyblwiKTtcbiAgICAgIGNoaXBFbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gb3BlblNob3J0Y3V0UGlja2VyKHZpZXcsIGVkaXRvciwgc3RvcmUsIHJvdykpO1xuICAgICAgLy8gQmVmb3JlIHRoZSBidXR0b24sIHNvIHRoZSByb3cgYWx3YXlzIHJlYWRzIFwibmFtZSB8IGNoaXAgfCBidXR0b25cIi5cbiAgICAgIGNvbnRhaW5lckVsLmluc2VydEJlZm9yZShjaGlwRWwsIGJ1dHRvbkVsKTtcbiAgICB9XG4gICAgY2hpcEVsLmZpcnN0RWxlbWVudENoaWxkLnNldFRleHQoc2hvcnRjdXRMYWJlbChyZWNvcmQpKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBvcGVuU2hvcnRjdXRQaWNrZXIodmlldywgZWRpdG9yLCBzdG9yZSwgcm93KSB7XG4gIGNvbnN0IGtleSA9IHJvdy5lbnRyeT8ua2V5ID8/IFwiXCI7XG4gIGlmIChrZXkgPT09IFwiXCIpIHJldHVybjtcbiAgLy8gUGFzc2luZyB0aGUgY3VycmVudCByZWNvcmQgcHJlZmlsbHMgdGhlIGFyZ3VtZW50IGRpYWxvZyB3aGVuIHRoZSBzYW1lXG4gIC8vIHNjcmlwdCBpcyBwaWNrZWQgYWdhaW4gLSB0aGF0IGlzIGhvdyBzaW5nbGUgYXJndW1lbnRzIGdldCBjb3JyZWN0ZWQuXG4gIGNvbnN0IHJlY29yZCA9IGF3YWl0IHBpY2tTaG9ydGN1dCh2aWV3LmFwcCwga2V5LCB2aWV3LnBsdWdpbi5nZXRTaG9ydGN1dFNjcmlwdHMsIHN0b3JlLmdldFNob3J0Y3V0cygpW2tleV0gPz8gbnVsbCk7XG4gIGlmICghcmVjb3JkKSByZXR1cm47XG4gIC8vIFRoZSBwcm9wZXJ0eSBtYXkgaGF2ZSB2YW5pc2hlZCB3aGlsZSB0aGUgZGlhbG9nIHdhcyBvcGVuICh2aWV3IHJlYnVpbHQpLlxuICAvLyBXaXRob3V0IHRoaXMgY2hlY2sgdGhlIHNob3J0Y3V0IHdvdWxkIGJlIGFuIGludmlzaWJsZSBvcnBoYW4gaW4gdGhlXG4gIC8vIHNldHRpbmdzIHRoYXQgbm90aGluZyBldmVyIGNsZWFucyB1cC5cbiAgaWYgKCFPYmplY3QuaGFzT3duKHN0b3JlLmdldEZyb250bWF0dGVyKCksIGtleSkpIHJldHVybjtcbiAgc3RvcmUuc2V0U2hvcnRjdXRzKHsgLi4uc3RvcmUuZ2V0U2hvcnRjdXRzKCksIFtrZXldOiByZWNvcmQgfSk7XG4gIHNhdmVTaG9ydGN1dHModmlldywgZWRpdG9yLCBzdG9yZSk7XG59XG5cbmZ1bmN0aW9uIHJlbW92ZVNob3J0Y3V0KHZpZXcsIGVkaXRvciwgc3RvcmUsIHJvdykge1xuICBjb25zdCBrZXkgPSByb3cuZW50cnk/LmtleSA/PyBcIlwiO1xuICBjb25zdCBzaG9ydGN1dHMgPSB7IC4uLnN0b3JlLmdldFNob3J0Y3V0cygpIH07XG4gIGlmICghKGtleSBpbiBzaG9ydGN1dHMpKSByZXR1cm47XG4gIGRlbGV0ZSBzaG9ydGN1dHNba2V5XTtcbiAgc3RvcmUuc2V0U2hvcnRjdXRzKHNob3J0Y3V0cyk7XG4gIHNhdmVTaG9ydGN1dHModmlldywgZWRpdG9yLCBzdG9yZSk7XG59XG5cbmZ1bmN0aW9uIHNhdmVTaG9ydGN1dHModmlldywgZWRpdG9yLCBzdG9yZSkge1xuICB2aWV3LnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgcmVuZGVyU2hvcnRjdXRDb250cm9scyh2aWV3LCBlZGl0b3IsIHN0b3JlKTtcbn1cblxuLy8gQSBzaW1wbGUgXCJhZGQgcHJvcGVydHlcIiBpbnN0ZWFkIG9mIHRoZSBpbnRlcm5hbCBlZGl0b3IuYWRkUHJvcGVydHkoKTogYWRkc1xuLy8gYW4gZW1wdHkga2V5IHdpdGggdmFsdWUgbnVsbCBhbmQgbGV0cyB0aGUgd2lkZ2V0IHJlbmRlciBpdCBub3JtYWxseSAoc2FtZVxuLy8gbG9vayBhcyBpbiBhIG5vdGUsIHNpbmNlIHN5bmNocm9uaXplKCkgcnVucyBPYnNpZGlhbidzIG93biBwaXBlbGluZSksIHRoZW5cbi8vIGZvY3VzZXMgdGhlIG5ldyBrZXkgZmllbGQuXG5mdW5jdGlvbiBhZGRCbGFua1Byb3BlcnR5KGVkaXRvcikge1xuICBpZiAoIWVkaXRvcikgcmV0dXJuO1xuICBjb25zdCBjdXJyZW50ID0gZWRpdG9yLnNlcmlhbGl6ZSgpO1xuICBpZiAoIWN1cnJlbnQuaGFzT3duUHJvcGVydHkoXCJcIikpIHtcbiAgICBjdXJyZW50W1wiXCJdID0gbnVsbDtcbiAgICBlZGl0b3Iuc3luY2hyb25pemUoY3VycmVudCk7XG4gICAgLy8gRXhpc3Rpbmcgcm93cyBrZWVwIHRoZWlyIGJ1dHRvbiAoaXQgc2l0cyBvbiBjb250YWluZXJFbCksIHRoZSBuZXcgb25lXG4gICAgLy8gbmVlZHMgb25lLlxuICAgIHJlbmRlclNob3J0Y3V0Q29udHJvbHMoZWRpdG9yLm93bmVyLnR5cFBhbmUsIGVkaXRvciwgZWRpdG9yLm93bmVyLnR5cFN0b3JlKTtcbiAgfVxuICBlZGl0b3IuZm9jdXNLZXkoXCJcIik7XG4gIC8vIENvdmVycyB0aGUgY2FzZSB3aGVyZSBtb3VudEZyb250bWF0dGVyRWRpdG9yKCkgZm91bmQgbm8gcm93IGNsYXNzIHRvIHBhdGNoXG4gIC8vIChlbXB0eSBUWVAsIG5vIG9wZW4gbm90ZSkgLSBub3cgdGhlcmUgaXMgYXQgbGVhc3Qgb25lIHJvdy5cbiAgZW5zdXJlUHJvcGVydHlNZW51UGF0Y2goZWRpdG9yLm93bmVyLmFwcCwgZWRpdG9yKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IG1vdW50RnJvbnRtYXR0ZXJFZGl0b3IsIGFkZEJsYW5rUHJvcGVydHksIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoLCByZW1vdmVQcm9wZXJ0eU1lbnVQYXRjaCwgdHlwU3RvcmUsIHN1YnR5cFN0b3JlIH07XG4iLCAiY29uc3QgeyBtb3VudEZyb250bWF0dGVyRWRpdG9yLCBhZGRCbGFua1Byb3BlcnR5LCB0eXBTdG9yZSwgc3VidHlwU3RvcmUgfSA9IHJlcXVpcmUoXCIuL3R5cC1mcm9udG1hdHRlci1lZGl0b3JcIik7XG5jb25zdCB7IGdldFNlY3Rpb25PcmRlciwgaXNFbXB0eVZhbHVlIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBzXCIpO1xuXG4vKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAqIFRoZSBmcm9udG1hdHRlciBibG9ja3Mgb2YgYSBUWVAgaW4gdGhlIFRZUC1QYW5lIGRldGFpbCAoc2VlXG4gKiByZW5kZXJUeXBTZXR0aW5ncyBpbiB0eXAtcGFuZS5qcyk6IHRoZSBUWVAtRnJvbnRtYXR0ZXIgb24gdG9wLFxuICogYmVsb3cgaXQgb25lIGJsb2NrIHBlciByZWdpc3RlcmVkIFN1YnR5cC5cbiAqXG4gKiBFYWNoIGJsb2NrIGhhcyBpdHMgb3duIGluc3RhbmNlIG9mIE9ic2lkaWFuJ3MgcHJvcGVydHkgZWRpdG9yLFxuICogYm91bmQgdG8gdHlwU3RvcmUgb3Igc3VidHlwU3RvcmUgKHNlZSB0eXAtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKS5cbiAqIFRoYXQgaXMgd2hhdCBsZXRzIHRoZSBzYW1lIGtleSBhcHBlYXIgaW4gc2V2ZXJhbCBibG9ja3MgLSBvbmVcbiAqIHNoYXJlZCBlZGl0b3Igd291bGQgaG9sZCBldmVyeXRoaW5nIGluIGEgc2luZ2xlIGZsYXQgb2JqZWN0LlxuICpcbiAqIE9ic2lkaWFuJ3Mgcm93IGRyYWcgb25seSB3b3JrcyB3aXRoaW4gb25lIGluc3RhbmNlLCBzb1xuICogcmVnaXN0ZXJQcm9wZXJ0eURyYWcoKSBiZWxvdyBidWlsZHMgb24gdGhhdCBkcmFnIHRvIG1vdmUgYVxuICogcHJvcGVydHkgYmV0d2VlbiBibG9ja3MuIEtleWJvYXJkIG5hdmlnYXRpb24gYWNyb3NzIGJsb2NrcyBpc1xuICogcmVnaXN0ZXJGb2N1c0NoYWluKCkgaW4gdHlwLWZyb250bWF0dGVyLWVkaXRvci5qcy5cbiAqXG4gKiBTZWN0aW9uOiBudWxsID0gVFlQLUZyb250bWF0dGVyLCBvdGhlcndpc2UgdGhlIFN1YnR5cCBuYW1lLlxuICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovXG5cbi8vIEEgd2hvbGUgYmxvY2sgY2FuIGJlIGdyYWJiZWQgYW55d2hlcmUgb3V0c2lkZSBpdHMgcHJvcGVydHkgcm93cyAtIGhlYWRpbmcsXG4vLyBmb290ZXIsIHNpZGUgbWFyZ2lucy4gQ29udHJvbHMgYW5kIGEgdGl0bGUgYmVpbmcgZWRpdGVkIGFyZSBleGNsdWRlZC5cbmZ1bmN0aW9uIGlzR3JhYlRhcmdldCh0YXJnZXQpIHtcbiAgaWYgKHRhcmdldC5jbG9zZXN0KFwiLmNsaWNrYWJsZS1pY29uLCAudHlwLXN1YnR5cC1jb2xvci1kb3QsIFtjb250ZW50ZWRpdGFibGU9J3RydWUnXSwgaW5wdXQsIHRleHRhcmVhXCIpKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiAhdGFyZ2V0LmNsb3Nlc3QoXCIubWV0YWRhdGEtcHJvcGVydHlcIik7XG59XG5cbi8vIHJlbmRlckhlYWRlcihzZWN0aW9uLCBlbCwgYmxvY2tzKSAvIHJlbmRlckZvb3RlcihzZWN0aW9uLCBlbCwgYmxvY2tzKSBmaWxsIGFcbi8vIGJsb2NrJ3MgaGVhZGluZyBhbmQgZm9vdGVyLiBvbk1vdmVTZWN0aW9uKG9yZGVyKSByZXBvcnRzIHRoZSBuZXcgYmxvY2sgb3JkZXJcbi8vIGFmdGVyIGEgYmxvY2sgZHJhZyAoc2hhcGVkIGxpa2UgZ2V0U2VjdGlvbk9yZGVyLCBsZWFkaW5nIG51bGwgaW5jbHVkZWQpLlxuZnVuY3Rpb24gbW91bnRGcm9udG1hdHRlckJsb2Nrcyh2aWV3LCBjb250YWluZXJFbCwgdHlwLCB7IHJlbmRlckhlYWRlciwgcmVuZGVyRm9vdGVyLCBvbk1vdmVTZWN0aW9uIH0pIHtcbiAgY29uc3Qgd3JhcHBlciA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtYmxvY2tzXCIgfSk7XG4gIGNvbnN0IHNlY3Rpb25zID0gZ2V0U2VjdGlvbk9yZGVyKHZpZXcucGx1Z2luLnNldHRpbmdzLCB0eXApO1xuICBjb25zdCBlZGl0b3JzID0gbmV3IE1hcCgpO1xuICBjb25zdCBibG9ja0VscyA9IG5ldyBNYXAoKTtcbiAgY29uc3Qgc3RvcmVzID0gbmV3IE1hcCgpO1xuXG4gIGNvbnN0IGFwaSA9IHtcbiAgICAvLyBBbGwgZWRpdG9yIGluc3RhbmNlcyBpbiBibG9jayBvcmRlcjsgdHlwLXBhbmUuanMgYWRkcyB0aGVtIGFzIGNvbXBvbmVudFxuICAgIC8vIGNoaWxkcmVuIGFuZCB1bmxvYWRzIHRoZW0gYmVmb3JlIGVhY2ggcmVidWlsZC5cbiAgICBlZGl0b3JzOiBbXSxcbiAgICAvLyBBZGRzIGEgYmxhbmsgcm93IGF0IHRoZSBlbmQgb2YgdGhlIGJsb2NrIHdpdGggZm9jdXMgaW4gdGhlIGtleSBmaWVsZFxuICAgIC8vIChzZWUgYWRkQmxhbmtQcm9wZXJ0eSkuIGZsb2F0aW5nIG1hcmtzIHRoZSBuZXh0IG5hbWVkIHByb3BlcnR5IGFzXG4gICAgLy8gZmxvYXRpbmcuXG4gICAgYWRkQmxhbmsoc2VjdGlvbiwgZmxvYXRpbmcgPSBmYWxzZSkge1xuICAgICAgY29uc3QgZWRpdG9yID0gZWRpdG9ycy5nZXQoc2VjdGlvbik7XG4gICAgICBpZiAoIWVkaXRvcikgcmV0dXJuO1xuICAgICAgZWRpdG9yLnR5cFBlbmRpbmdGbG9hdGluZ0FkZCA9IGZsb2F0aW5nO1xuICAgICAgYWRkQmxhbmtQcm9wZXJ0eShlZGl0b3IpO1xuICAgIH0sXG4gIH07XG5cbiAgLy8gTmV4dCBibG9jayBpbiBkaXJlY3Rpb24gc3RlcCB0aGF0IGhhcyBhIHJvdyB0byBqdW1wIHRvOyBlbXB0eSBibG9ja3MgYXJlXG4gIC8vIHNraXBwZWQuXG4gIGNvbnN0IGZvY3VzTmVpZ2hib3IgPSAoc2VjdGlvbiwgc3RlcCkgPT4ge1xuICAgIGZvciAobGV0IGkgPSBzZWN0aW9ucy5pbmRleE9mKHNlY3Rpb24pICsgc3RlcDsgaSA+PSAwICYmIGkgPCBzZWN0aW9ucy5sZW5ndGg7IGkgKz0gc3RlcCkge1xuICAgICAgY29uc3QgZWRpdG9yID0gZWRpdG9ycy5nZXQoc2VjdGlvbnNbaV0pO1xuICAgICAgaWYgKCFlZGl0b3IgfHwgZWRpdG9yLnJlbmRlcmVkLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgICBlZGl0b3IuZm9jdXNQcm9wZXJ0eUF0SW5kZXgoc3RlcCA+IDAgPyAwIDogLTEpO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfTtcblxuICBmb3IgKGNvbnN0IHNlY3Rpb24gb2Ygc2VjdGlvbnMpIHtcbiAgICBjb25zdCBpc1N1YiA9IHNlY3Rpb24gIT09IG51bGw7XG4gICAgY29uc3QgYmxvY2tFbCA9IHdyYXBwZXIuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJ0eXAtYmxvY2tcIiArIChpc1N1YiA/IFwiIHR5cC1mcm9udG1hdHRlci1ibG9jayB0eXAtc3VidHlwLWJsb2NrXCIgOiBcIlwiKSxcbiAgICB9KTtcbiAgICBibG9ja0Vscy5zZXQoc2VjdGlvbiwgYmxvY2tFbCk7XG4gICAgYmxvY2tFbC50eXBTZWN0aW9uID0gc2VjdGlvbjtcblxuICAgIGNvbnN0IGhlYWRlciA9IGJsb2NrRWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci1oZWFkZXIgdHlwLXNlY3Rpb24taGVhZGVyXCIgfSk7XG4gICAgaGVhZGVyLnRvZ2dsZUNsYXNzKFwidHlwLXNlY3Rpb24tc3ViXCIsIGlzU3ViKTtcblxuICAgIGNvbnN0IHN0b3JlID0gc2VjdGlvbiA9PT0gbnVsbCA/IHR5cFN0b3JlKHZpZXcucGx1Z2luLCB0eXApIDogc3VidHlwU3RvcmUodmlldy5wbHVnaW4sIHR5cCwgc2VjdGlvbik7XG4gICAgc3RvcmVzLnNldChzZWN0aW9uLCBzdG9yZSk7XG4gICAgY29uc3QgZWRpdG9yID0gbW91bnRGcm9udG1hdHRlckVkaXRvcih2aWV3LCBibG9ja0VsLCBzdG9yZSwge1xuICAgICAgb25TaGlmdEZvY3VzOiAoc3RlcCkgPT4gZm9jdXNOZWlnaGJvcihzZWN0aW9uLCBzdGVwKSxcbiAgICB9KTtcbiAgICBpZiAoZWRpdG9yKSB7XG4gICAgICBlZGl0b3JzLnNldChzZWN0aW9uLCBlZGl0b3IpO1xuICAgICAgYXBpLmVkaXRvcnMucHVzaChlZGl0b3IpO1xuICAgIH1cblxuICAgIGNvbnN0IGZvb3RlciA9IGJsb2NrRWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zZWN0aW9uLWZvb3RlclwiIH0pO1xuICAgIGZvb3Rlci50b2dnbGVDbGFzcyhcInR5cC1zZWN0aW9uLXN1YlwiLCBpc1N1Yik7XG4gICAgcmVuZGVySGVhZGVyKHNlY3Rpb24sIGhlYWRlciwgYXBpKTtcbiAgICByZW5kZXJGb290ZXI/LihzZWN0aW9uLCBmb290ZXIsIGFwaSk7XG5cbiAgICBpZiAoIWlzU3ViKSBjb250aW51ZTtcbiAgICBibG9ja0VsLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZWRvd25cIiwgKGV2ZW50KSA9PiBzdGFydEJsb2NrRHJhZyhldmVudCwgc2VjdGlvbikpO1xuICB9XG5cbiAgLy8gTW91c2UgZHJhZyBpbnN0ZWFkIG9mIEhUTUw1IGRyYWdnYWJsZTogYSBkcmFnZ2FibGUgYW5jZXN0b3IgYnJva2UgdGV4dFxuICAvLyBzZWxlY3Rpb24gaW4gdGhlIHJvdyBpbnB1dHMuIFN0YXJ0cyBhZnRlciBhIGZldyBwaXhlbHM7IGFuIGFjY2VudCBsaW5lXG4gIC8vIHNob3dzIHRoZSB0YXJnZXQgZ2FwLCBFc2NhcGUgY2FuY2Vscy4gVGhlIFRZUC1Gcm9udG1hdHRlciBpcyBmaXhlZCBvbiB0b3BcbiAgLy8gKHNlZSBnZXRTZWN0aW9uT3JkZXIpLCBzbyB0YXJnZXQgMCBkb2Vzbid0IGV4aXN0LlxuICBmdW5jdGlvbiBzdGFydEJsb2NrRHJhZyhldmVudCwgc2VjdGlvbikge1xuICAgIGlmIChldmVudC5idXR0b24gIT09IDAgfHwgIWlzR3JhYlRhcmdldChldmVudC50YXJnZXQpKSByZXR1cm47XG4gICAgY29uc3Qgd2luID0gd3JhcHBlci53aW47XG4gICAgY29uc3Qgc3RhcnRZID0gZXZlbnQuY2xpZW50WTtcbiAgICBsZXQgZHJhZ2dpbmcgPSBmYWxzZTtcbiAgICBsZXQgaW5kaWNhdG9yID0gbnVsbDtcbiAgICBsZXQgYm94ZXMgPSBbXTtcbiAgICBsZXQgdGFyZ2V0SW5kZXggPSBudWxsO1xuXG4gICAgY29uc3QgbWVhc3VyZSA9ICgpID0+IHtcbiAgICAgIGNvbnN0IGJhc2UgPSB3cmFwcGVyLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgYm94ZXMgPSBzZWN0aW9ucy5tYXAoKG5hbWUpID0+IHtcbiAgICAgICAgY29uc3QgcmVjdCA9IGJsb2NrRWxzLmdldChuYW1lKS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgICAgcmV0dXJuIHsgc2VjdGlvbjogbmFtZSwgdG9wOiByZWN0LnRvcCAtIGJhc2UudG9wLCBib3R0b206IHJlY3QuYm90dG9tIC0gYmFzZS50b3AgfTtcbiAgICAgIH0pO1xuICAgIH07XG5cbiAgICBjb25zdCBvbk1vdmUgPSAobW92ZUV2ZW50KSA9PiB7XG4gICAgICBpZiAoIWRyYWdnaW5nKSB7XG4gICAgICAgIGlmIChNYXRoLmFicyhtb3ZlRXZlbnQuY2xpZW50WSAtIHN0YXJ0WSkgPCA0KSByZXR1cm47XG4gICAgICAgIGRyYWdnaW5nID0gdHJ1ZTtcbiAgICAgICAgd3JhcHBlci5kb2MuYm9keS5hZGRDbGFzcyhcInR5cC1ibG9jay1kcmFnZ2luZ1wiKTtcbiAgICAgICAgd2luLmdldFNlbGVjdGlvbigpPy5yZW1vdmVBbGxSYW5nZXMoKTtcbiAgICAgICAgYmxvY2tFbHMuZ2V0KHNlY3Rpb24pLmFkZENsYXNzKFwiaXMtZHJhZ2dpbmdcIik7XG4gICAgICAgIG1lYXN1cmUoKTtcbiAgICAgICAgaW5kaWNhdG9yID0gd3JhcHBlci5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWJsb2NrLWRyb3AtaW5kaWNhdG9yXCIgfSk7XG4gICAgICB9XG4gICAgICBtb3ZlRXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGNvbnN0IHkgPSBtb3ZlRXZlbnQuY2xpZW50WSAtIHdyYXBwZXIuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCkudG9wO1xuICAgICAgdGFyZ2V0SW5kZXggPSBNYXRoLm1heCgxLCBib3hlcy5maWx0ZXIoKGJveCkgPT4gKGJveC50b3AgKyBib3guYm90dG9tKSAvIDIgPCB5KS5sZW5ndGgpO1xuICAgICAgY29uc3QgZnJvbSA9IGJveGVzLmZpbmRJbmRleCgoYm94KSA9PiBib3guc2VjdGlvbiA9PT0gc2VjdGlvbik7XG4gICAgICBpbmRpY2F0b3IudG9nZ2xlKHRhcmdldEluZGV4ICE9PSBmcm9tICYmIHRhcmdldEluZGV4ICE9PSBmcm9tICsgMSk7XG4gICAgICAvLyBNaWRkbGUgb2YgdGhlIGdhcCBiZXR3ZWVuIHR3byBibG9ja3MgKHNlZSAudHlwLWJsb2NrICsgLnR5cC1ibG9jayBpblxuICAgICAgLy8gc3R5bGVzLmNzcykuXG4gICAgICBjb25zdCBoYWxmR2FwID0gNjtcbiAgICAgIGNvbnN0IGdhcFkgPVxuICAgICAgICB0YXJnZXRJbmRleCA9PT0gYm94ZXMubGVuZ3RoXG4gICAgICAgICAgPyBib3hlc1tib3hlcy5sZW5ndGggLSAxXS5ib3R0b20gKyBoYWxmR2FwXG4gICAgICAgICAgOiAoYm94ZXNbdGFyZ2V0SW5kZXggLSAxXS5ib3R0b20gKyBib3hlc1t0YXJnZXRJbmRleF0udG9wKSAvIDI7XG4gICAgICBpbmRpY2F0b3Iuc3R5bGUudG9wID0gYCR7Z2FwWSAtIDF9cHhgO1xuICAgIH07XG5cbiAgICBjb25zdCBlbmQgPSAoY29tbWl0KSA9PiB7XG4gICAgICB3aW4ucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNlbW92ZVwiLCBvbk1vdmUpO1xuICAgICAgd2luLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtb3VzZXVwXCIsIG9uVXApO1xuICAgICAgd2luLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIG9uS2V5LCB0cnVlKTtcbiAgICAgIGlmICghZHJhZ2dpbmcpIHJldHVybjtcbiAgICAgIHdyYXBwZXIuZG9jLmJvZHkucmVtb3ZlQ2xhc3MoXCJ0eXAtYmxvY2stZHJhZ2dpbmdcIik7XG4gICAgICBibG9ja0Vscy5nZXQoc2VjdGlvbikucmVtb3ZlQ2xhc3MoXCJpcy1kcmFnZ2luZ1wiKTtcbiAgICAgIGluZGljYXRvcj8ucmVtb3ZlKCk7XG5cbiAgICAgIGNvbnN0IG9yZGVyID0gYm94ZXMubWFwKChib3gpID0+IGJveC5zZWN0aW9uKTtcbiAgICAgIGNvbnN0IGZyb20gPSBvcmRlci5pbmRleE9mKHNlY3Rpb24pO1xuICAgICAgaWYgKCFjb21taXQgfHwgdGFyZ2V0SW5kZXggPT09IG51bGwgfHwgdGFyZ2V0SW5kZXggPT09IGZyb20gfHwgdGFyZ2V0SW5kZXggPT09IGZyb20gKyAxKSByZXR1cm47XG4gICAgICBvcmRlci5zcGxpY2UoZnJvbSwgMSk7XG4gICAgICBvcmRlci5zcGxpY2UoZnJvbSA8IHRhcmdldEluZGV4ID8gdGFyZ2V0SW5kZXggLSAxIDogdGFyZ2V0SW5kZXgsIDAsIHNlY3Rpb24pO1xuICAgICAgb25Nb3ZlU2VjdGlvbj8uKG9yZGVyKTtcbiAgICB9O1xuICAgIGNvbnN0IG9uVXAgPSAoKSA9PiBlbmQodHJ1ZSk7XG4gICAgY29uc3Qgb25LZXkgPSAoa2V5RXZlbnQpID0+IHtcbiAgICAgIGlmIChrZXlFdmVudC5rZXkgIT09IFwiRXNjYXBlXCIpIHJldHVybjtcbiAgICAgIGtleUV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBrZXlFdmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIGVuZChmYWxzZSk7XG4gICAgfTtcbiAgICB3aW4uYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlbW92ZVwiLCBvbk1vdmUpO1xuICAgIHdpbi5hZGRFdmVudExpc3RlbmVyKFwibW91c2V1cFwiLCBvblVwKTtcbiAgICB3aW4uYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgb25LZXksIHRydWUpO1xuICB9XG5cbiAgcmVnaXN0ZXJQcm9wZXJ0eURyYWcoKTtcbiAgcmV0dXJuIGFwaTtcblxuICAvKiAtLS0gRHJhZ2dpbmcgYSBwcm9wZXJ0eSBpbnRvIGFub3RoZXIgYmxvY2sgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgKiBCdWlsdCBvbiBPYnNpZGlhbidzIG93biByb3cgZHJhZyByYXRoZXIgdGhhbiBhIHNlY29uZCBvbmUgbmV4dCB0byBpdDpcbiAgICogaXQgc3RhcnRzIGF0IHRoZSByb3cncyB0eXBlIGljb24sIHB1dHMgYSAuZHJhZy1yZW9yZGVyLWdob3N0IG9uIHRoZVxuICAgKiBib2R5IChzbyBpdCBmb2xsb3dzIHRoZSBjdXJzb3IgYWNyb3NzIGJsb2NrcyBhbnl3YXkpIGFuZCBtYXJrcyB0aGVcbiAgICogc291cmNlIHJvdyB3aXRoIC5kcmFnLWdob3N0LWhpZGRlbiwgdGhlIGFjY2VudCBib3ggc2hvd2luZyB0aGUgZHJvcFxuICAgKiBzcG90LiBXaXRoaW4gb25lIGJsb2NrIE9ic2lkaWFuIGRvZXMgZXZlcnl0aGluZyBhcyB1c3VhbC4gQWRkZWQgaGVyZTpcbiAgICpcbiAgICogIC0gYW4gZW1wdHkgZXh0cmEgY2hpbGQgaW4gdGhlIGxpc3Qgd2hpbGUgZHJhZ2dpbmc6IG90aGVyd2lzZSBPYnNpZGlhblxuICAgKiAgICBkb2Vzbid0IHN0YXJ0IHRoZSBkcmFnIGluIGEgYmxvY2sgd2l0aCBhIHNpbmdsZSByb3cgKGl0cyBtb3VzZWRvd25cbiAgICogICAgY2hlY2tzIG4uZmlyc3RDaGlsZCAhPT0gbi5sYXN0Q2hpbGQpO1xuICAgKiAgLSBhIHBsYWNlaG9sZGVyIHdpdGggdGhlIHNhbWUgLmRyYWctZ2hvc3QtaGlkZGVuIGNsYXNzIGluIHRoZSB0YXJnZXRcbiAgICogICAgYmxvY2sgb25jZSB0aGUgY3Vyc29yIHJlYWNoZXMgYW5vdGhlciBibG9jazsgdGhlIHNvdXJjZSByb3cgaXNcbiAgICogICAgaGlkZGVuIG1lYW53aGlsZSBzbyB0aGVyZSBhcmVuJ3QgdHdvIGJveGVzO1xuICAgKiAgLSBhIHJlb3JkZXJLZXkgcGVyIGluc3RhbmNlIHRoYXQgbW92ZXMgdGhlIHByb3BlcnR5IHRvIHRoZSBvdGhlclxuICAgKiAgICBibG9jayBvbiBkcm9wIGluc3RlYWQgb2Ygc29ydGluZyB3aXRoaW4gaXRzIG93bi5cbiAgICpcbiAgICogT3VyIGhhbmRsZXJzIHJ1biBpbiB0aGUgY2FwdHVyZSBwaGFzZSBvbiB0aGUgd2luZG93LCBiZWZvcmUgT2JzaWRpYW4nc1xuICAgKiAod2hpY2ggaXQgYWRkcyB0byB3aW5kb3cgaW4gaXRzIG1vdXNlZG93biBoYW5kbGVyKS5cbiAgICogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cbiAgZnVuY3Rpb24gcmVnaXN0ZXJQcm9wZXJ0eURyYWcoKSB7XG4gICAgLy8gV2l0aG91dCBhIHNlY29uZCBibG9jayB0aGVyZSBpcyBubyB0YXJnZXQ7IE9ic2lkaWFuJ3MgZHJhZyBzdGF5cyBhcyBpcy5cbiAgICBjb25zdCBhbmNob3IgPSBhcGkuZWRpdG9yc1swXTtcbiAgICBpZiAoIWFuY2hvciB8fCBzZWN0aW9ucy5sZW5ndGggPCAyKSByZXR1cm47XG5cbiAgICAvLyBTdGF0ZSBvZiBhIHJ1bm5pbmcgZHJhZzsgZHJvcCBrZWVwcyB0aGUgdGFyZ2V0IGZvciB0aGUgcmVvcmRlcktleSBjYWxsXG4gICAgLy8gdGhhdCBmb2xsb3dzIHRoZSBtb3VzZXVwLlxuICAgIGxldCBkcmFnID0gbnVsbDtcbiAgICBsZXQgZHJvcCA9IG51bGw7XG5cbiAgICBjb25zdCBzZWN0aW9uQXQgPSAoY2xpZW50WSkgPT5cbiAgICAgIHNlY3Rpb25zLmZpbmQoKHNlY3Rpb24pID0+IHtcbiAgICAgICAgY29uc3QgcmVjdCA9IGJsb2NrRWxzLmdldChzZWN0aW9uKS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgICAgcmV0dXJuIGNsaWVudFkgPj0gcmVjdC50b3AgJiYgY2xpZW50WSA8PSByZWN0LmJvdHRvbTtcbiAgICAgIH0pO1xuXG4gICAgY29uc3QgY2xlYXJQbGFjZWhvbGRlciA9ICgpID0+IHtcbiAgICAgIGRyYWcucGxhY2Vob2xkZXI/LnJlbW92ZSgpO1xuICAgICAgZHJhZy5wbGFjZWhvbGRlciA9IG51bGw7XG4gICAgICBkcmFnLnJvd0VsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiZGlzcGxheVwiKTtcbiAgICAgIGRyYWcudGFyZ2V0ID0gbnVsbDtcbiAgICB9O1xuXG4gICAgd3JhcHBlci5hZGRFdmVudExpc3RlbmVyKFxuICAgICAgXCJtb3VzZWRvd25cIixcbiAgICAgIChldmVudCkgPT4ge1xuICAgICAgICBpZiAoZXZlbnQuYnV0dG9uICE9PSAwKSByZXR1cm47XG4gICAgICAgIGNvbnN0IHJvd0VsID0gZXZlbnQudGFyZ2V0LmNsb3Nlc3QoXCIubWV0YWRhdGEtcHJvcGVydHktaWNvblwiKT8uY2xvc2VzdChcIi5tZXRhZGF0YS1wcm9wZXJ0eVwiKTtcbiAgICAgICAgY29uc3Qgc2VjdGlvbiA9IHJvd0VsPy5jbG9zZXN0KFwiLnR5cC1ibG9ja1wiKT8udHlwU2VjdGlvbjtcbiAgICAgICAgY29uc3QgZWRpdG9yID0gc2VjdGlvbiA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IGVkaXRvcnMuZ2V0KHNlY3Rpb24pO1xuICAgICAgICBjb25zdCBrZXkgPSBlZGl0b3I/LnJlbmRlcmVkLmZpbmQoKHJvdykgPT4gcm93LmNvbnRhaW5lckVsID09PSByb3dFbCk/LmVudHJ5LmtleTtcbiAgICAgICAgLy8gQW4gdW5uYW1lZCByb3cgaGFzIG5vIGJ1c2luZXNzIGluIGFub3RoZXIgYmxvY2s7IE9ic2lkaWFuIHNvcnRzIGl0LlxuICAgICAgICBpZiAoIWtleSkgcmV0dXJuO1xuICAgICAgICBkcmFnID0ge1xuICAgICAgICAgIHNlY3Rpb24sXG4gICAgICAgICAga2V5LFxuICAgICAgICAgIHJvd0VsLFxuICAgICAgICAgIC8vIE1lYXN1cmVkIG5vdzogb25jZSBoaWRkZW4gZm9yIHRoZSBwbGFjZWhvbGRlciwgb2Zmc2V0SGVpZ2h0IGlzIDAuXG4gICAgICAgICAgaGVpZ2h0OiByb3dFbC5vZmZzZXRIZWlnaHQsXG4gICAgICAgICAgc3BhY2VyOiBlZGl0b3IucHJvcGVydHlMaXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1kcmFnLXNwYWNlclwiIH0pLFxuICAgICAgICAgIHBsYWNlaG9sZGVyOiBudWxsLFxuICAgICAgICAgIHRhcmdldDogbnVsbCxcbiAgICAgICAgfTtcbiAgICAgICAgZHJvcCA9IG51bGw7XG4gICAgICB9LFxuICAgICAgdHJ1ZVxuICAgICk7XG5cbiAgICAvLyBPbiB0aGUgd2luZG93IHNvIGEgZHJhZyBpcyB0cmFja2VkIG91dHNpZGUgdGhlIGJsb2NrcyB0b287IHJlbW92ZWQgd2l0aFxuICAgIC8vIHRoZSBmaXJzdCBlZGl0b3IsIHdoaWNoIHVubG9hZHMgb24gdGhlIG5leHQgcmVidWlsZCBvZiB0aGUgZGV0YWlsIHZpZXcuXG4gICAgY29uc3Qgb25XaW5Nb3ZlID0gKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoIWRyYWcpIHJldHVybjtcbiAgICAgIGNvbnN0IHRhcmdldCA9IHNlY3Rpb25BdChldmVudC5jbGllbnRZKTtcbiAgICAgIGlmICh0YXJnZXQgPT09IHVuZGVmaW5lZCB8fCB0YXJnZXQgPT09IGRyYWcuc2VjdGlvbikge1xuICAgICAgICBpZiAoZHJhZy5wbGFjZWhvbGRlcikgY2xlYXJQbGFjZWhvbGRlcigpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGxpc3QgPSBlZGl0b3JzLmdldCh0YXJnZXQpLnByb3BlcnR5TGlzdEVsO1xuICAgICAgaWYgKCFkcmFnLnBsYWNlaG9sZGVyKSB7XG4gICAgICAgIGRyYWcucm93RWwuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xuICAgICAgICBkcmFnLnBsYWNlaG9sZGVyID0gY3JlYXRlRGl2KHsgY2xzOiBcIm1ldGFkYXRhLXByb3BlcnR5IGRyYWctZ2hvc3QtaGlkZGVuIHR5cC1kcmFnLXBsYWNlaG9sZGVyXCIgfSk7XG4gICAgICAgIGRyYWcucGxhY2Vob2xkZXIuc3R5bGUuaGVpZ2h0ID0gYCR7ZHJhZy5oZWlnaHR9cHhgO1xuICAgICAgfVxuICAgICAgLy8gRHJvcCBzcG90IGFzIE9ic2lkaWFuIGRvZXMgaXQ6IGJlZm9yZSB0aGUgZmlyc3Qgcm93IHdob3NlIG1pZGRsZSBpc1xuICAgICAgLy8gYmVsb3cgdGhlIGN1cnNvci5cbiAgICAgIGNvbnN0IHJvd3MgPSBbLi4ubGlzdC5jaGlsZHJlbl0uZmlsdGVyKChlbCkgPT4gZWwgIT09IGRyYWcucGxhY2Vob2xkZXIgJiYgZWwgIT09IGRyYWcuc3BhY2VyKTtcbiAgICAgIGNvbnN0IGJlZm9yZSA9IHJvd3MuZmluZCgoZWwpID0+IHtcbiAgICAgICAgY29uc3QgcmVjdCA9IGVsLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgICByZXR1cm4gZXZlbnQuY2xpZW50WSA8IHJlY3QudG9wICsgcmVjdC5oZWlnaHQgLyAyO1xuICAgICAgfSk7XG4gICAgICBkcmFnLnRhcmdldCA9IHsgc2VjdGlvbjogdGFyZ2V0LCBpbmRleDogYmVmb3JlID8gcm93cy5pbmRleE9mKGJlZm9yZSkgOiByb3dzLmxlbmd0aCB9O1xuICAgICAgbGlzdC5pbnNlcnRCZWZvcmUoZHJhZy5wbGFjZWhvbGRlciwgYmVmb3JlID8/IG51bGwpO1xuICAgIH07XG5cbiAgICBjb25zdCBvbldpblVwID0gKCkgPT4ge1xuICAgICAgaWYgKCFkcmFnKSByZXR1cm47XG4gICAgICBjb25zdCB7IHNwYWNlciwgcGxhY2Vob2xkZXIsIHJvd0VsLCB0YXJnZXQgfSA9IGRyYWc7XG4gICAgICBkcmFnID0gbnVsbDtcbiAgICAgIGRyb3AgPSB0YXJnZXQ7XG4gICAgICBwbGFjZWhvbGRlcj8ucmVtb3ZlKCk7XG4gICAgICByb3dFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImRpc3BsYXlcIik7XG4gICAgICAvLyBPbmx5IGFmdGVyIE9ic2lkaWFuIGZpbmlzaGVzIGl0cyBkcmFnOiBpdCBzdGlsbCByZWFkcyB0aGUgZHJvcCBzcG90XG4gICAgICAvLyBpbiB0aGUgc291cmNlIGJsb2NrIGZyb20gdGhlIGNoaWxkIGxpc3QsIHdoZXJlIHRoZSBzcGFjZXIgbWFya3MgdGhlXG4gICAgICAvLyBsYXN0IHBvc2l0aW9uLlxuICAgICAgd3JhcHBlci53aW4uc2V0VGltZW91dCgoKSA9PiBzcGFjZXIucmVtb3ZlKCksIDApO1xuICAgIH07XG5cbiAgICB3cmFwcGVyLndpbi5hZGRFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIG9uV2luTW92ZSwgdHJ1ZSk7XG4gICAgd3JhcHBlci53aW4uYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNldXBcIiwgb25XaW5VcCwgdHJ1ZSk7XG4gICAgYW5jaG9yLnJlZ2lzdGVyKCgpID0+IHtcbiAgICAgIHdyYXBwZXIud2luLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtb3VzZW1vdmVcIiwgb25XaW5Nb3ZlLCB0cnVlKTtcbiAgICAgIHdyYXBwZXIud2luLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtb3VzZXVwXCIsIG9uV2luVXAsIHRydWUpO1xuICAgIH0pO1xuXG4gICAgZm9yIChjb25zdCBbc2VjdGlvbiwgZWRpdG9yXSBvZiBlZGl0b3JzKSB7XG4gICAgICBjb25zdCBvcmlnaW5hbFJlb3JkZXJLZXkgPSBlZGl0b3IucmVvcmRlcktleTtcbiAgICAgIGVkaXRvci5yZW9yZGVyS2V5ID0gZnVuY3Rpb24gKGVudHJ5LCBpbmRleCkge1xuICAgICAgICBjb25zdCB0YXJnZXQgPSBkcm9wO1xuICAgICAgICBkcm9wID0gbnVsbDtcbiAgICAgICAgaWYgKCF0YXJnZXQpIHJldHVybiBvcmlnaW5hbFJlb3JkZXJLZXkuY2FsbCh0aGlzLCBlbnRyeSwgaW5kZXgpO1xuICAgICAgICBtb3ZlUHJvcGVydHkoc2VjdGlvbiwgdGFyZ2V0LnNlY3Rpb24sIGVudHJ5LmtleSwgdGFyZ2V0LmluZGV4KTtcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgLy8gTW92ZXMga2V5IGZyb20gYmxvY2sgYGZyb21gIHRvIGJsb2NrIGB0b2AgYXQgcG9zaXRpb24gaW5kZXguIElmIHRoZSB0YXJnZXRcbiAgLy8gYWxyZWFkeSBoYXMgdGhlIG5hbWUgKHVuaXF1ZSB3aXRoaW4gYSBibG9jayksIHRoZSB0d28gbWVyZ2U6IHRoZSBleGlzdGluZ1xuICAvLyBlbnRyeSBrZWVwcyBwb3NpdGlvbiwgdmFsdWUsIGZsb2F0aW5nIGZsYWcgYW5kIHNob3J0Y3V0OyBvbmx5IGFuIGVtcHR5XG4gIC8vIHZhbHVlIGlzIGZpbGxlZCBmcm9tIHRoZSBkcmFnZ2VkIG9uZSAtIHNhbWUgcnVsZSBhcyBtZXJnZVN1YnR5cHNcbiAgLy8gKHN1YnR5cHMuanMpIGFuZCByZW5hbWVJblN0b3JlIChwcm9wZXJ0eS1yZW5hbWUtc3luYy5qcykuXG4gIGFzeW5jIGZ1bmN0aW9uIG1vdmVQcm9wZXJ0eShmcm9tLCB0bywga2V5LCBpbmRleCkge1xuICAgIGNvbnN0IHNvdXJjZSA9IHN0b3Jlcy5nZXQoZnJvbSk7XG4gICAgY29uc3QgdGFyZ2V0ID0gc3RvcmVzLmdldCh0byk7XG4gICAgaWYgKCFzb3VyY2UgfHwgIXRhcmdldCB8fCBmcm9tID09PSB0bykgcmV0dXJuO1xuXG4gICAgY29uc3Qgc291cmNlRnJvbnRtYXR0ZXIgPSB7IC4uLnNvdXJjZS5nZXRGcm9udG1hdHRlcigpIH07XG4gICAgY29uc3QgdmFsdWUgPSBzb3VyY2VGcm9udG1hdHRlcltrZXldO1xuICAgIGNvbnN0IHdhc0Zsb2F0aW5nID0gc291cmNlLmdldEZsb2F0aW5nKCkuaW5jbHVkZXMoa2V5KTtcbiAgICAvLyBUaGUgc2hvcnRjdXQgYmVsb25ncyB0byB0aGUga2V5IGFuZCBtb3ZlcyB3aXRoIGl0LlxuICAgIGNvbnN0IHNvdXJjZVNob3J0Y3V0cyA9IHsgLi4uc291cmNlLmdldFNob3J0Y3V0cygpIH07XG4gICAgY29uc3Qgc2hvcnRjdXQgPSBzb3VyY2VTaG9ydGN1dHNba2V5XSA/PyBudWxsO1xuICAgIGRlbGV0ZSBzb3VyY2VTaG9ydGN1dHNba2V5XTtcbiAgICBkZWxldGUgc291cmNlRnJvbnRtYXR0ZXJba2V5XTtcbiAgICBzb3VyY2Uuc2V0RnJvbnRtYXR0ZXIoc291cmNlRnJvbnRtYXR0ZXIpO1xuICAgIHNvdXJjZS5zZXRGbG9hdGluZyhzb3VyY2UuZ2V0RmxvYXRpbmcoKS5maWx0ZXIoKGspID0+IGsgIT09IGtleSkpO1xuICAgIHNvdXJjZS5zZXRTaG9ydGN1dHMoc291cmNlU2hvcnRjdXRzKTtcblxuICAgIGNvbnN0IHRhcmdldEZyb250bWF0dGVyID0gdGFyZ2V0LmdldEZyb250bWF0dGVyKCk7XG4gICAgY29uc3QgZXhpc3RpbmcgPSBPYmplY3Qua2V5cyh0YXJnZXRGcm9udG1hdHRlcikuZmluZCgoaykgPT4gay50b0xvd2VyQ2FzZSgpID09PSBrZXkudG9Mb3dlckNhc2UoKSk7XG4gICAgaWYgKGV4aXN0aW5nICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChpc0VtcHR5VmFsdWUodGFyZ2V0RnJvbnRtYXR0ZXJbZXhpc3RpbmddKSkgdGFyZ2V0LnNldEZyb250bWF0dGVyKHsgLi4udGFyZ2V0RnJvbnRtYXR0ZXIsIFtleGlzdGluZ106IHZhbHVlIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXModGFyZ2V0RnJvbnRtYXR0ZXIpO1xuICAgICAgY29uc3QgYXQgPSBNYXRoLm1heCgwLCBNYXRoLm1pbihpbmRleCwga2V5cy5sZW5ndGgpKTtcbiAgICAgIGNvbnN0IG5leHQgPSB7fTtcbiAgICAgIGZvciAoY29uc3QgayBvZiBrZXlzLnNsaWNlKDAsIGF0KSkgbmV4dFtrXSA9IHRhcmdldEZyb250bWF0dGVyW2tdO1xuICAgICAgbmV4dFtrZXldID0gdmFsdWU7XG4gICAgICBmb3IgKGNvbnN0IGsgb2Yga2V5cy5zbGljZShhdCkpIG5leHRba10gPSB0YXJnZXRGcm9udG1hdHRlcltrXTtcbiAgICAgIHRhcmdldC5zZXRGcm9udG1hdHRlcihuZXh0KTtcbiAgICAgIGlmICh3YXNGbG9hdGluZykgdGFyZ2V0LnNldEZsb2F0aW5nKFsuLi50YXJnZXQuZ2V0RmxvYXRpbmcoKSwga2V5XSk7XG4gICAgICBpZiAoc2hvcnRjdXQpIHRhcmdldC5zZXRTaG9ydGN1dHMoeyAuLi50YXJnZXQuZ2V0U2hvcnRjdXRzKCksIFtrZXldOiBzaG9ydGN1dCB9KTtcbiAgICB9XG5cbiAgICBhd2FpdCB2aWV3LnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAvLyBSZS1yZW5kZXJzIHRoaXMgZGV0YWlsIHZpZXcgYW1vbmcgb3RoZXJzOyBibG9ja3MgYW5kIGVkaXRvcnMgYXJlIHJlYnVpbHRcbiAgICAvLyBmcm9tIHRoZSBzZXR0aW5ncy5cbiAgICB2aWV3LnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgbW91bnRGcm9udG1hdHRlckJsb2NrcyB9O1xuIiwgImNvbnN0IHsgSXRlbVZpZXcsIE1lbnUsIE5vdGljZSwgc2V0SWNvbiwgZGVib3VuY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgQ29uZmlybU1vZGFsLCB0eXBOYW1lTm9kZSwgc3VidHlwTmFtZU5vZGUgfSA9IHJlcXVpcmUoXCIuL2NvbmZpcm0tbW9kYWxcIik7XG5jb25zdCB7IG1vdW50RnJvbnRtYXR0ZXJCbG9ja3MgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLWJsb2Nrc1wiKTtcbmNvbnN0IHtcbiAgbm9ybWFsaXplU3VidHlwTmFtZSxcbiAgZ2V0U3VidHlwTmFtZXMsXG4gIGVuc3VyZVN1YnR5cCxcbiAgbW92ZVR5cFN1YnR5cHMsXG4gIGRlbGV0ZVR5cFN1YnR5cHMsXG4gIG1lcmdlVHlwU3VidHlwcyxcbiAgZ2V0U3VidHlwLFxuICBpc1N1YnR5cE1hbnVhbCxcbiAgc2V0U3VidHlwTWFudWFsLFxuICBzZXRBbGxTdWJ0eXBzTWFudWFsLFxuICByZW5hbWVTdWJ0eXAsXG4gIHJlb3JkZXJTdWJ0eXBzLFxuICBkZWxldGVTdWJ0eXAsXG4gIG1lcmdlU3VidHlwcyxcbiAgcmVuYW1lU3VidHlwSW5Ob3Rlcyxcbn0gPSByZXF1aXJlKFwiLi9zdWJ0eXBzXCIpO1xuY29uc3QgeyBub3JtYWxpemVUeXBOYW1lLCBjb21wYXJlVHlwcywgc29ydFR5cHNCeU1vZGUsIHBsdXJhbCwgam9pbkFuZCB9ID0gcmVxdWlyZShcIi4vdHlwLXV0aWxzXCIpO1xuY29uc3QgeyB0eXBLZXlPZiwgcHJvcGVydHlWYWx1ZSwgc2V0Q2Fub25pY2FsUHJvcGVydHksIFRZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZIH0gPSByZXF1aXJlKFwiLi90eXAtaW5kZXhcIik7XG5jb25zdCB7XG4gIHN1YnR5cENvbG9yLFxuICBhcHBseUNvbG9yT2Zmc2V0LFxuICBoYXNDb2xvck9mZnNldCxcbiAgc3VidHlwSGFzT3duQ29sb3IsXG4gIHBhaW50Q29sb3JEb3QsXG4gIG5hbWVDb2xvcixcbiAgY2hhbm5lbEJvdW5kcyxcbiAgY2xhbXBlZE9mZnNldCxcbiAgU1VCVFlQX0NPTE9SX0NIQU5ORUxTLFxuICBERUZBVUxUX1RZUF9DT0xPUixcbn0gPSByZXF1aXJlKFwiLi90eXAtY29sb3JzXCIpO1xuXG5jb25zdCBWSUVXX1RZUEVfVFlQX1BBTkUgPSBcInR5cC1zeXN0ZW0tcGFuZVwiO1xuY29uc3QgREVGQVVMVF9TT1JUX09SREVSID0gXCJjb3VudC1kZXNjXCI7XG5jb25zdCBERUZBVUxUX1NFQ09OREFSWSA9IFwic3VidHlwc1wiO1xuXG4vLyBXaGF0IHRoZSBUWVAtTGlzdCBzaG93cyBuZXh0IHRvIHRoZSBuYW1lIChzZXR0aW5ncy50eXBMaXN0U2Vjb25kYXJ5KSxcbi8vIGN5Y2xlZCBieSBhIGhlYWRlciBidXR0b24gbmV4dCB0byBzb3J0aW5nIChzZWUgY3ljbGVTZWNvbmRhcnkpIC0gdG9vIGZldyxcbi8vIHRvbyBpbW1lZGlhdGVseSB2aXNpYmxlIHN0YXRlcyBmb3IgYSBtZW51LlxuLy8gICBzdWJ0eXBzICAgICAtIHRoZSBUWVAncyBTdWJ0eXBzIGluIGJyYWNrZXRzLCBlYWNoIGluIGl0cyBjb2xvciAobGlrZSB0aGVcbi8vICAgICAgICAgICAgICAgICBwcmV2aWV3IGluIHRoZSBzZXBhcmF0ZSBUWVAtUGlja2VyKVxuLy8gICBkZXNjcmlwdGlvbiAtIHRleHQgZmllbGQgdG8gZWRpdCB0aGUgVFlQIGRlc2NyaXB0aW9uXG4vLyAgIG5vbmUgICAgICAgIC0gbm90aGluZywgdGhlIG5hbWUgZ2V0cyB0aGUgd2hvbGUgcm93XG4vLyBUaGUgb3JkZXIgaXMgYWxzbyB0aGUgY3ljbGUgb3JkZXI7IHRoZSBmaXJzdCBpcyB0aGUgZGVmYXVsdDogdGhlIFN1YnR5cHNcbi8vIGFwcGVhciBub3doZXJlIGVsc2UgaW4gdGhlIGxpc3QsIHRoZSBkZXNjcmlwdGlvbiBhbHNvIGluIHRoZSBkZXRhaWwgdmlldy5cbmNvbnN0IFNFQ09OREFSWV9NT0RFUyA9IFtcbiAgeyBtb2RlOiBcInN1YnR5cHNcIiwgdGl0bGU6IFwiU3VidHlwIGxpc3RcIiwgaWNvbjogXCJsaXN0LXRyZWVcIiB9LFxuICB7IG1vZGU6IFwiZGVzY3JpcHRpb25cIiwgdGl0bGU6IFwiRGVzY3JpcHRpb25cIiwgaWNvbjogXCJ0ZXh0LWN1cnNvci1pbnB1dFwiIH0sXG4gIHsgbW9kZTogXCJub25lXCIsIHRpdGxlOiBcIk5vdGhpbmdcIiwgaWNvbjogXCJtaW51c1wiIH0sXG5dO1xuXG5jb25zdCBTT1JUX09QVElPTlMgPSBbXG4gIC8vIFVubGlrZSB0aGUgb3RoZXJzLCBcIm1hbnVhbFwiIGhhcyBubyBjb21wYXJpc29uOiB0aGUgb3JkZXIgb2Ygc2V0dGluZ3MudHlwc1xuICAvLyBpdHNlbGYgaXMgdGhlIHN0b3JhZ2UgKHNlZSByZW5kZXIoKSBhbmQgcmVuZGVyUmVnaXN0ZXJlZEl0ZW0oKSBmb3IgdGhlXG4gIC8vIGRyYWcgJiBkcm9wIHJlbmRlcmluZyBidWlsdCBvbiBpdCkuIEZpcnN0IG9uIHB1cnBvc2UgLSBpdHMgb3duIGdyb3VwIGF0XG4gIC8vIHRoZSB0b3Agb2YgdGhlIG1lbnUgKHNlZSBzaG93U29ydE1lbnUpLlxuICB7IG1vZGU6IFwibWFudWFsXCIsIHRpdGxlOiBcIk1hbnVhbCAoZHJhZyAmIGRyb3ApXCIgfSxcbiAgeyBtb2RlOiBcImNvdW50LWRlc2NcIiwgdGl0bGU6IFwiTW9zdCBub3RlcyBmaXJzdFwiIH0sXG4gIHsgbW9kZTogXCJjb3VudC1hc2NcIiwgdGl0bGU6IFwiRmV3ZXN0IG5vdGVzIGZpcnN0XCIgfSxcbiAgeyBtb2RlOiBcIm5hbWUtYXNjXCIsIHRpdGxlOiBcIk5hbWUgKEEgdG8gWilcIiB9LFxuICB7IG1vZGU6IFwibmFtZS1kZXNjXCIsIHRpdGxlOiBcIk5hbWUgKFogdG8gQSlcIiB9LFxuICB7IG1vZGU6IFwiY29sb3ItYXNjXCIsIHRpdGxlOiBcIkNvbG9yIChyZWQgXHUyMTkyIHZpb2xldClcIiB9LFxuICB7IG1vZGU6IFwiY29sb3ItZGVzY1wiLCB0aXRsZTogXCJDb2xvciAodmlvbGV0IFx1MjE5MiByZWQpXCIgfSxcbl07XG5cbi8vIFJld3JpdGVzIHRoZSBUWVAgb2YgZXZlcnkgbm90ZSB3aXRoIGtleSBvbGRLZXkgKHNlZSB0eXBLZXlPZiBpblxuLy8gdHlwLWluZGV4LmpzIC0gdGhlIFRZUCBuYW1lIGZvciBhIGNsZWFuIHZhbHVlLCBvdGhlcndpc2UgdGhlIHJhdyBmb3JtIGxpa2Vcbi8vIFwiIGJ1Y2hcIiBvciBcIltQRVJTT04sIEJVQ0hdXCIpIHRvIHRoZSBzaW5nbGUgdmFsdWUgbmV3VmFsdWUuIFVzZWQgZm9yXG4vLyByZWdpc3RlclR5cCgpIChjbGVhbnVwKSwgcmVuYW1pbmcgYW5kIG1lcmdpbmcuIE1hdGNoaW5nIGlzIGV4YWN0IG9uIHRoZSBrZXksXG4vLyBzbyBhIGxpc3QgaXMgcmVwbGFjZWQgYXMgYSB3aG9sZS4gQSBkaWZmZXJlbnRseSBzcGVsbGVkIHByb3BlcnR5IChcInR5cFwiKVxuLy8gYmVjb21lcyBcIlRZUFwiLlxuYXN5bmMgZnVuY3Rpb24gcmVuYW1lVHlwSW5Ob3RlcyhwbHVnaW4sIG9sZEtleSwgbmV3VmFsdWUpIHtcbiAgbGV0IGNoYW5nZWQgPSAwO1xuICBmb3IgKGNvbnN0IGZpbGUgb2YgcGx1Z2luLnR5cEluZGV4LmZpbGVzV2l0aFR5cChvbGRLZXkpKSB7XG4gICAgbGV0IG1hdGNoZWQgPSBmYWxzZTtcbiAgICBhd2FpdCBwbHVnaW4uYXBwLmZpbGVNYW5hZ2VyLnByb2Nlc3NGcm9udE1hdHRlcihmaWxlLCAoZnJvbnRtYXR0ZXIpID0+IHtcbiAgICAgIGlmICh0eXBLZXlPZihwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBUWVBfUFJPUEVSVFkpKSAhPT0gb2xkS2V5KSByZXR1cm47XG4gICAgICBzZXRDYW5vbmljYWxQcm9wZXJ0eShmcm9udG1hdHRlciwgVFlQX1BST1BFUlRZLCBuZXdWYWx1ZSk7XG4gICAgICBtYXRjaGVkID0gdHJ1ZTtcbiAgICB9KTtcbiAgICBpZiAobWF0Y2hlZCkgY2hhbmdlZCsrO1xuICB9XG4gIHJldHVybiBjaGFuZ2VkO1xufVxuXG4vLyBDbGVhbmVkIGZvcm0gb2YgYSByYXcgdmFsdWUgZm9yIHJlZ2lzdGVyVHlwKCk6IGEgc2luZ2xlIHZhbHVlIHRyaW1tZWQgYW5kXG4vLyB1cHBlcmNhc2VkOyBhIGxpc3QgaXMgZGVsaWJlcmF0ZWx5IE5PVCByZWR1Y2VkIHRvIG9uZSBpdGVtIGJ1dCBqb2luZWQgaW50b1xuLy8gb25lIHZhbHVlIFwiQSwgQlwiIC0gd2hpY2ggYSByZW5hbWUgY2FuIHRoZW4gdHVybiBpbnRvIGFub3RoZXIgVFlQIChzZWVcbi8vIHN0YXJ0RGV0YWlsUmVuYW1lL3Nob3dNZXJnZUNvbmZpcm0pLiBub3JtYWxpemUgc3BlbGxzIHRoZSBzaW5nbGUgbmFtZXMgLVxuLy8gbm9ybWFsaXplU3VidHlwTmFtZSBmb3IgU3VidHlwcy5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVJhd1R5cChyYXcsIG5vcm1hbGl6ZSA9IG5vcm1hbGl6ZVR5cE5hbWUpIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkocmF3KSkge1xuICAgIHJldHVybiByYXdcbiAgICAgIC5tYXAoKHYpID0+IG5vcm1hbGl6ZShTdHJpbmcodiA/PyBcIlwiKSkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgICAuam9pbihcIiwgXCIpO1xuICB9XG4gIHJldHVybiBub3JtYWxpemUoU3RyaW5nKHJhdykpO1xufVxuXG4vLyBTaG93cyBhbiB1bnJlZ2lzdGVyZWQga2V5OiBwYWRkaW5nIHdvdWxkIGJlIGludmlzaWJsZSBhcyBwbGFpbiB0ZXh0LCBzbyBpdFxuLy8gZ2V0cyBxdW90ZXMuIExpc3RzIGFscmVhZHkgY2FycnkgdGhlaXIgYnJhY2tldHMgaW4gdGhlIGtleS5cbmZ1bmN0aW9uIGRpc3BsYXlUeXBLZXkodHlwS2V5KSB7XG4gIHJldHVybiB0eXBLZXkgIT09IHR5cEtleS50cmltKCkgPyBgXCIke3R5cEtleX1cImAgOiB0eXBLZXk7XG59XG5cbmNsYXNzIFR5cFBhbmUgZXh0ZW5kcyBJdGVtVmlldyB7XG4gIGNvbnN0cnVjdG9yKGxlYWYsIHBsdWdpbikge1xuICAgIHN1cGVyKGxlYWYpO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICB9XG5cbiAgZ2V0Vmlld1R5cGUoKSB7XG4gICAgcmV0dXJuIFZJRVdfVFlQRV9UWVBfUEFORTtcbiAgfVxuXG4gIGdldERpc3BsYXlUZXh0KCkge1xuICAgIHJldHVybiBcIlRZUFwiO1xuICB9XG5cbiAgZ2V0SWNvbigpIHtcbiAgICByZXR1cm4gXCJzaGFwZXNcIjtcbiAgfVxuXG4gIGFzeW5jIG9uT3BlbigpIHtcbiAgICB0aGlzLmlzRWRpdGluZyA9IGZhbHNlO1xuICAgIHRoaXMuc2VsZWN0ZWRUeXAgPSBudWxsO1xuICAgIHRoaXMuZnJvbnRtYXR0ZXJCbG9ja3MgPSBudWxsO1xuICAgIHRoaXMuZnJvbnRtYXR0ZXJFZGl0b3JzID0gW107XG5cbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIHRoaXMuY29udGVudEVsLmFkZENsYXNzKFwidHlwLXN5c3RlbS1wYW5lXCIpO1xuXG4gICAgdGhpcy5yZWdpc3RlckRvbUV2ZW50KHRoaXMuY29udGVudEVsLCBcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVzY2FwZVwiICYmIHRoaXMuc2VsZWN0ZWRUeXAgIT09IG51bGwpIHRoaXMuY2xvc2VUeXBTZXR0aW5ncygpO1xuICAgIH0pO1xuICAgIHRoaXMucmVuZGVyKCk7XG4gIH1cblxuICBhc3luYyBvbkNsb3NlKCkge1xuICAgIHRoaXMuY2xvc2VTdWJ0eXBDb2xvclBvcG92ZXI/LigpO1xuICB9XG5cbiAgb3BlblNlYXJjaCh0eXApIHtcbiAgICBjb25zdCBnbG9iYWxTZWFyY2ggPSB0aGlzLnBsdWdpbi5hcHAuaW50ZXJuYWxQbHVnaW5zLmdldFBsdWdpbkJ5SWQoXCJnbG9iYWwtc2VhcmNoXCIpO1xuICAgIGlmICghZ2xvYmFsU2VhcmNoKSByZXR1cm47XG4gICAgLy8gXCJObyBUWVBcIiB3aXRob3V0IGEgZmlsdGVyIHdvdWxkIGFsc28gbWF0Y2ggZXZlcnkgbm9uLW1hcmtkb3duIGZpbGUsXG4gICAgLy8gd2hpY2ggY2FuJ3QgaGF2ZSBmcm9udG1hdHRlciAtIGhlbmNlIGZpbGU6Lm1kLlxuICAgIGNvbnN0IHF1ZXJ5ID0gdHlwID09PSBudWxsID8gYC1bXCIke1RZUF9QUk9QRVJUWX1cIl0gZmlsZToubWRgIDogdGhpcy50eXBDbGF1c2UodHlwKTtcbiAgICBnbG9iYWxTZWFyY2guaW5zdGFuY2Uub3Blbkdsb2JhbFNlYXJjaChxdWVyeSk7XG4gIH1cblxuICAvLyBTZWFyY2ggY2xhdXNlIGZvciBhIFRZUCBrZXkuIEEgbGlzdCAodW5yZWdpc3RlcmVkIGtleSBcIltBLCBCXVwiKSBoYXMgbm9cbiAgLy8gZXhhY3Qgc3ludGF4LCBzbyBpdCBzZWFyY2hlcyBub3RlcyBjYXJyeWluZyBhbGwgaXRzIGl0ZW1zLiBBbHNvIHVzZWQgYnlcbiAgLy8gb3BlblN1YnR5cFNlYXJjaCgpLCB3aGljaCBjYW4gcmVjZWl2ZSBhbiB1bnJlZ2lzdGVyZWQgKHVuY2xlYW4pIFRZUCBrZXkuXG4gIHR5cENsYXVzZSh0eXApIHtcbiAgICBjb25zdCByYXcgPSB0aGlzLnBsdWdpbi50eXBJbmRleC5yYXdWYWx1ZU9mKHR5cCk7XG4gICAgcmV0dXJuIEFycmF5LmlzQXJyYXkocmF3KVxuICAgICAgPyByYXcubWFwKCh2KSA9PiBgW1wiJHtUWVBfUFJPUEVSVFl9XCI6XCIke1N0cmluZyh2ID8/IFwiXCIpLnRyaW0oKX1cIl1gKS5qb2luKFwiIFwiKVxuICAgICAgOiBgW1wiJHtUWVBfUFJPUEVSVFl9XCI6XCIke3R5cH1cIl1gO1xuICB9XG5cbiAgLy8gdHlwS2V5IGNvbWVzIHN0cmFpZ2h0IGZyb20gZnJvbnRtYXR0ZXIgdmFsdWVzIChzZWUgdW5yZWdpc3RlcmVkUm93cyBpblxuICAvLyByZW5kZXIoKSBhbmQgdHlwS2V5T2YpIC0gcG9zc2libHkgbG93ZXJjYXNlLCBwYWRkZWQgb3IgYSBsaXN0LiBUWVAgZW50cmllc1xuICAvLyBhcmUgYWx3YXlzIGNsZWFuIHVwcGVyY2FzZSB2YWx1ZXMsIHNvIHRoZSBjbGVhbmVkIGZvcm0gaXMgcmVnaXN0ZXJlZCAoc2VlXG4gIC8vIG5vcm1hbGl6ZVJhd1R5cCkgYW5kIHRoZSBhZmZlY3RlZCBub3RlcyBhcmUgcmV3cml0dGVuIHJpZ2h0IGF3YXksIHNvIHRoZXlcbiAgLy8gbm8gbG9uZ2VyIHNob3cgdXAgYXMgdW5yZWdpc3RlcmVkLlxuICBhc3luYyByZWdpc3RlclR5cCh0eXBLZXkpIHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmFwcGx5VHlwUmVnaXN0cmF0aW9uKHR5cEtleSk7XG4gICAgaWYgKCFyZXN1bHQpIHJldHVybjtcblxuICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgIHRoaXMucmVuZGVyKCk7XG4gICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG5cbiAgICBpZiAocmVzdWx0LnJlbmFtZWQgPiAwKSB7XG4gICAgICBuZXcgTm90aWNlKGBUWVAgJHtyZXN1bHQudHlwfSByZWdpc3RlcmVkLCAke3BsdXJhbChyZXN1bHQucmVuYW1lZCwgXCJub3RlXCIpfSB1cGRhdGVkLmApO1xuICAgIH1cbiAgfVxuXG4gIC8vIFRoZSBjb3JlIG9mIHJlZ2lzdGVyVHlwKCkgd2l0aG91dCBzYXZpbmcsIHJlLXJlbmRlcmluZyBhbmQgbm90aWNlLCBzb1xuICAvLyByZWdpc3RlclR5cFdpdGhTdWJ0eXAoKSBjYW4gcmVnaXN0ZXIgVFlQIGFuZCBTdWJ0eXAgaW4gdHVybiBhbmQgdGhlbiBzYXZlXG4gIC8vIGFuZCBub3RpZnkgT05DRS4gUmV0dXJucyB7IHR5cCwgcmVuYW1lZCB9LCBvciBudWxsIGlmIG5vdGhpbmcgdXNhYmxlIGlzXG4gIC8vIGxlZnQuXG4gIGFzeW5jIGFwcGx5VHlwUmVnaXN0cmF0aW9uKHR5cEtleSkge1xuICAgIGNvbnN0IHJhdyA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnJhd1ZhbHVlT2YodHlwS2V5KTtcbiAgICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplUmF3VHlwKHJhdyA9PT0gdW5kZWZpbmVkID8gdHlwS2V5IDogcmF3KTtcbiAgICBpZiAoIW5vcm1hbGl6ZWQpIHJldHVybiBudWxsO1xuICAgIGlmICghdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwcy5pbmNsdWRlcyhub3JtYWxpemVkKSkge1xuICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwcy5wdXNoKG5vcm1hbGl6ZWQpO1xuICAgIH1cbiAgICBjb25zdCByZW5hbWVkID0gbm9ybWFsaXplZCAhPT0gdHlwS2V5ID8gYXdhaXQgcmVuYW1lVHlwSW5Ob3Rlcyh0aGlzLnBsdWdpbiwgdHlwS2V5LCBub3JtYWxpemVkKSA6IDA7XG4gICAgcmV0dXJuIHsgdHlwOiBub3JtYWxpemVkLCByZW5hbWVkIH07XG4gIH1cblxuICAvLyBBIG5ldywgZW1wdHkgdHJlZSBpdGVtIHN0cmFpZ2h0IGluIGVkaXQgbW9kZSAtIGxpa2UgT2JzaWRpYW4ncyBvd24gdmlld3NcbiAgLy8gKGEgbmV3IGJvb2ttYXJrIGdyb3VwLCBzYXkpLlxuICBzdGFydEFkZCgpIHtcbiAgICBpZiAodGhpcy5pc0VkaXRpbmcpIHJldHVybjtcblxuICAgIGNvbnN0IHRyZWVJdGVtID0gdGhpcy5saXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbVwiIH0pO1xuICAgIGlmICh0aGlzLnNlcGFyYXRvckVsKSB0aGlzLmxpc3RFbC5pbnNlcnRCZWZvcmUodHJlZUl0ZW0sIHRoaXMuc2VwYXJhdG9yRWwpO1xuICAgIGNvbnN0IHNlbGYgPSB0cmVlSXRlbS5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLXNlbGYgaXMtY2xpY2thYmxlXCIgfSk7XG4gICAgY29uc3QgaW5uZXIgPSBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0taW5uZXJcIiB9KTtcblxuICAgIHRoaXMuc3RhcnRFZGl0aW5nKG51bGwsIHNlbGYsIGlubmVyKTtcbiAgfVxuXG4gIC8vIExpa2UgT2JzaWRpYW4ncyB0cmVlIGl0ZW1zOiBubyBleHRyYSBpbnB1dCwgdGhlIHRleHQgZWxlbWVudCBpdHNlbGZcbiAgLy8gYmVjb21lcyBjb250ZW50ZWRpdGFibGUuIHR5cCA9PT0gbnVsbCBtZWFucyBhIG5ldyBlbnRyeSwgb3RoZXJ3aXNlIGFcbiAgLy8gcmVuYW1lIG9mIHRoYXQgVFlQLlxuICBzdGFydEVkaXRpbmcodHlwLCBzZWxmLCBpbm5lcikge1xuICAgIGlmICh0aGlzLmlzRWRpdGluZykgcmV0dXJuO1xuICAgIHRoaXMuaXNFZGl0aW5nID0gdHJ1ZTtcblxuICAgIHNlbGYuYWRkQ2xhc3MoXCJpcy1iZWluZy1yZW5hbWVkXCIpO1xuICAgIGlubmVyLnNldEF0dHJpYnV0ZShcImNvbnRlbnRlZGl0YWJsZVwiLCBcInRydWVcIik7XG4gICAgaW5uZXIuc2V0QXR0cmlidXRlKFwic3BlbGxjaGVja1wiLCBcImZhbHNlXCIpO1xuICAgIGlubmVyLmZvY3VzKCk7XG5cbiAgICBjb25zdCByYW5nZSA9IGlubmVyLmRvYy5jcmVhdGVSYW5nZSgpO1xuICAgIHJhbmdlLnNlbGVjdE5vZGVDb250ZW50cyhpbm5lcik7XG4gICAgY29uc3Qgc2VsZWN0aW9uID0gaW5uZXIud2luLmdldFNlbGVjdGlvbigpO1xuICAgIHNlbGVjdGlvbi5yZW1vdmVBbGxSYW5nZXMoKTtcbiAgICBzZWxlY3Rpb24uYWRkUmFuZ2UocmFuZ2UpO1xuXG4gICAgbGV0IGRvbmUgPSBmYWxzZTtcbiAgICBjb25zdCBmaW5pc2ggPSBhc3luYyAoY29tbWl0KSA9PiB7XG4gICAgICBpZiAoZG9uZSkgcmV0dXJuO1xuICAgICAgZG9uZSA9IHRydWU7XG4gICAgICB0aGlzLmlzRWRpdGluZyA9IGZhbHNlO1xuXG4gICAgICBjb25zdCB2YWx1ZSA9IG5vcm1hbGl6ZVR5cE5hbWUoaW5uZXIudGV4dENvbnRlbnQpO1xuICAgICAgaWYgKGNvbW1pdCAmJiB2YWx1ZSAmJiB2YWx1ZSAhPT0gdHlwKSB7XG4gICAgICAgIGNvbnN0IGV4aXN0cyA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cHMuc29tZShcbiAgICAgICAgICAodCkgPT4gdC50b0xvd2VyQ2FzZSgpID09PSB2YWx1ZS50b0xvd2VyQ2FzZSgpICYmIHQgIT09IHR5cFxuICAgICAgICApO1xuICAgICAgICBpZiAoIWV4aXN0cykge1xuICAgICAgICAgIGlmICh0eXAgPT09IG51bGwpIHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cHMucHVzaCh2YWx1ZSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IGlkeCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cHMuaW5kZXhPZih0eXApO1xuICAgICAgICAgICAgaWYgKGlkeCAhPT0gLTEpIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cHNbaWR4XSA9IHZhbHVlO1xuICAgICAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdO1xuICAgICAgICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRGVzY3JpcHRpb25zW3R5cF0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBEZXNjcmlwdGlvbnNbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRGVzY3JpcHRpb25zW3R5cF07XG4gICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBEZXNjcmlwdGlvbnNbdHlwXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlZmF1bHRGcm9udG1hdHRlclt2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwXTtcbiAgICAgICAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlZmF1bHRGcm9udG1hdHRlclt0eXBdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cEZsb2F0aW5nS2V5c1t0eXBdICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRmxvYXRpbmdLZXlzW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cEZsb2F0aW5nS2V5c1t0eXBdO1xuICAgICAgICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRmxvYXRpbmdLZXlzW3R5cF07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwU2hvcnRjdXRzW3R5cF0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBTaG9ydGN1dHNbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwU2hvcnRjdXRzW3R5cF07XG4gICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBTaG9ydGN1dHNbdHlwXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICh0aGlzLmVuc3VyZVR5cE1hbnVhbCgpW3R5cF0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBNYW51YWxbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwTWFudWFsW3R5cF07XG4gICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBNYW51YWxbdHlwXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG1vdmVUeXBTdWJ0eXBzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHZhbHVlKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgfTtcblxuICAgIGlubmVyLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIChldmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmtleSA9PT0gXCJFbnRlclwiKSB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGZpbmlzaCh0cnVlKTtcbiAgICAgIH0gZWxzZSBpZiAoZXZlbnQua2V5ID09PSBcIkVzY2FwZVwiKSB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGZpbmlzaChmYWxzZSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBpbm5lci5hZGRFdmVudExpc3RlbmVyKFwiYmx1clwiLCAoKSA9PiBmaW5pc2godHJ1ZSkpO1xuICB9XG5cbiAgb3BlblR5cFNldHRpbmdzKHR5cCkge1xuICAgIHRoaXMuc2VsZWN0ZWRUeXAgPSB0eXA7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfVxuXG4gIGNsb3NlVHlwU2V0dGluZ3MoKSB7XG4gICAgdGhpcy5zZWxlY3RlZFR5cCA9IG51bGw7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfVxuXG4gIC8vIFRoZSBlZGl0b3JzIGFyZSBjb21wb25lbnQgY2hpbGRyZW4gKHNlZSBtb3VudEZyb250bWF0dGVyRWRpdG9yKSBhbmQgbXVzdFxuICAvLyBiZSB1bmxvYWRlZCBiZWZvcmUgZXZlcnkgcmVidWlsZCAtIGNvbnRlbnRFbC5lbXB0eSgpIGFsb25lIHdvdWxkIHJlbW92ZSB0aGVcbiAgLy8gRE9NIGJ1dCBsZWF2ZSBlYWNoIGVkaXRvcidzIG1ldGFkYXRhVHlwZU1hbmFnZXIgbGlzdGVuZXIgYmVoaW5kLlxuICAvLyBmcm9udG1hdHRlckJsb2NrcyBjb250cm9scyBhbGwgYmxvY2tzICh1c2VkIGJ5IFwiQWRkIFRZUC1Gcm9udG1hdHRlclxuICAvLyBwcm9wZXJ0eVwiKSwgZnJvbnRtYXR0ZXJFZGl0b3JzIGhvbGRzIGV2ZXJ5IGVkaXRvciBpbmNsLiBTdWJ0eXAgYmxvY2tzLlxuICBkZXN0cm95RnJvbnRtYXR0ZXJFZGl0b3IoKSB7XG4gICAgZm9yIChjb25zdCBlZGl0b3Igb2YgdGhpcy5mcm9udG1hdHRlckVkaXRvcnMgPz8gW10pIHRoaXMucmVtb3ZlQ2hpbGQoZWRpdG9yKTtcbiAgICB0aGlzLmZyb250bWF0dGVyRWRpdG9ycyA9IFtdO1xuICAgIHRoaXMuZnJvbnRtYXR0ZXJCbG9ja3MgPSBudWxsO1xuICB9XG5cbiAgcmVuZGVyKCkge1xuICAgIC8vIFJlZW50cmFuY3kgZ3VhcmQ6IHJlbmRlclR5cFNldHRpbmdzKCkgZW5kcyB3aXRoIHJlZnJlc2hUeXBDb2xvcnMoKSxcbiAgICAvLyB3aGljaCB2aWEgcmVnaXN0ZXJUeXBQYW5lIGNhbGxzIHJlbmRlcigpIG9uIGV2ZXJ5IFRZUC1QYW5lIGxlYWYgLVxuICAgIC8vIGluY2x1ZGluZyB0aGlzIG9uZSwgc3RpbGwgaW5zaWRlIHRoaXMgY2FsbC4gV2l0aG91dCB0aGUgZ3VhcmQgdGhhdFxuICAgIC8vIHJlY3Vyc2VzIGludG8gYSBzdGFjayBvdmVyZmxvdyBvbiBldmVyeSBUWVAgb3BlbmVkIG9yIHJlbmFtZWQuXG4gICAgaWYgKHRoaXMuX3JlbmRlcmluZykgcmV0dXJuO1xuICAgIHRoaXMuX3JlbmRlcmluZyA9IHRydWU7XG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuZGVzdHJveUZyb250bWF0dGVyRWRpdG9yKCk7XG4gICAgICBpZiAodGhpcy5zZWxlY3RlZFR5cCAhPT0gbnVsbCkge1xuICAgICAgICB0aGlzLnJlbmRlclR5cFNldHRpbmdzKHRoaXMuc2VsZWN0ZWRUeXApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgICAgY29udGVudEVsLmVtcHR5KCk7XG5cbiAgICAgIGNvbnN0IHsgY291bnRzLCBub1R5cCB9ID0gdGhpcy5wbHVnaW4udHlwSW5kZXgudHlwQ291bnRzKCk7XG4gICAgICBjb25zdCByZWdpc3RlcmVkID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwcztcbiAgICAgIGNvbnN0IHR5cENvbG9ycyA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9ycztcbiAgICAgIGNvbnN0IHNvcnRPcmRlciA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cFNvcnRPcmRlciA/PyBERUZBVUxUX1NPUlRfT1JERVI7XG4gICAgICBjb25zdCBpc01hbnVhbFNvcnQgPSBzb3J0T3JkZXIgPT09IFwibWFudWFsXCI7XG4gICAgICBjb25zdCBieUN1cnJlbnRPcmRlciA9IChhLCBiKSA9PiBjb21wYXJlVHlwcyhzb3J0T3JkZXIsIGEsIGIsIGNvdW50cywgdHlwQ29sb3JzKTtcblxuICAgICAgdGhpcy5yZW5kZXJMaXN0SGVhZGVyKGNvbnRlbnRFbCk7XG5cbiAgICAgIGNvbnN0IHVucmVnaXN0ZXJlZFJvd3MgPSBbLi4uY291bnRzLmtleXMoKV1cbiAgICAgICAgLmZpbHRlcigodHlwKSA9PiAhcmVnaXN0ZXJlZC5pbmNsdWRlcyh0eXApKVxuICAgICAgICAuc29ydChieUN1cnJlbnRPcmRlcilcbiAgICAgICAgLm1hcCgodHlwKSA9PiAoeyB0eXAsIGNvdW50OiBjb3VudHMuZ2V0KHR5cCkgPz8gMCB9KSk7XG4gICAgICBjb25zdCB1bnJlZ2lzdGVyZWRTdWJ0eXBSb3dzID0gdGhpcy51bnJlZ2lzdGVyZWRTdWJ0eXBSb3dzKCk7XG5cbiAgICAgIC8vIFdpdGhvdXQgYSBzZWNvbmQgY29sdW1uIHRoZSBuYW1lIG1heSB0YWtlIHRoZSB3aG9sZSByb3cgKHNlZVxuICAgICAgLy8gLnR5cC1saXN0LW5vLXNlY29uZGFyeSBpbiBzdHlsZXMuY3NzKS5cbiAgICAgIGNvbnN0IGxpc3RDbHMgPSBcInR5cC1saXN0IG5hdi1maWxlcy1jb250YWluZXJcIiArICh0aGlzLnNlY29uZGFyeU1vZGUoKSA9PT0gXCJub25lXCIgPyBcIiB0eXAtbGlzdC1uby1zZWNvbmRhcnlcIiA6IFwiXCIpO1xuICAgICAgdGhpcy5saXN0RWwgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBsaXN0Q2xzIH0pO1xuICAgICAgdGhpcy5zZXBhcmF0b3JFbCA9IG51bGw7XG5cbiAgICAgIC8vIEluIG1hbnVhbCBtb2RlIHNvcnRUeXBzQnlNb2RlKCkga2VlcHMgdGhlIG9yZGVyIG9mIHNldHRpbmdzLnR5cHMsXG4gICAgICAvLyB3aGljaCBkcmFnICYgZHJvcCBpbiByZW5kZXJSZWdpc3RlcmVkSXRlbSgpIHJlYXJyYW5nZXM7IGluZGV4IGlzIHRoZVxuICAgICAgLy8gcG9zaXRpb24gaW4gdGhhdCBvcmRlci5cbiAgICAgIGNvbnN0IHJlZ2lzdGVyZWRPcmRlciA9IHNvcnRUeXBzQnlNb2RlKHJlZ2lzdGVyZWQsIHNvcnRPcmRlciwgY291bnRzLCB0eXBDb2xvcnMpO1xuICAgICAgcmVnaXN0ZXJlZE9yZGVyLmZvckVhY2goKHR5cCwgaW5kZXgpID0+IHtcbiAgICAgICAgdGhpcy5yZW5kZXJSZWdpc3RlcmVkSXRlbSh0eXAsIGNvdW50cy5nZXQodHlwKSA/PyAwLCB7IGRyYWdnYWJsZTogaXNNYW51YWxTb3J0LCBpbmRleCB9KTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBCZWxvdyB0aGUgc2VwYXJhdG9yIHRocmVlIG9wdGlvbmFsIHNlY3Rpb25zOiB1bnJlZ2lzdGVyZWQgVFlQIHZhbHVlcyxcbiAgICAgIC8vIHVucmVnaXN0ZXJlZCBTdWJ0eXBzLCBcIltOTyBUWVBdXCIuIFRoZSBTdWJ0eXBzIGdldCB0aGVpciBvd24gc2VwYXJhdG9yXG4gICAgICAvLyBiZWNhdXNlIHRoZXkgc29ydCBieSBhIGRpZmZlcmVudCBydWxlIChjb3VudCwgbm90IHRoZSBzb3J0IGJ1dHRvbikgLVxuICAgICAgLy8gd2l0aG91dCBhIHZpc2libGUgY3V0IGl0IHdvdWxkIGxvb2sgbGlrZSBicm9rZW4gc29ydGluZy4gXCJbTk8gVFlQXVwiIGlzXG4gICAgICAvLyBubyByZWFsIFRZUCwgdGFrZXMgbm8gcGFydCBpbiBzb3J0aW5nIGFuZCBhbHdheXMgY29tZXMgbGFzdCwgd2l0aG91dCBhXG4gICAgICAvLyB0aGlyZCBsaW5lLlxuICAgICAgLy9cbiAgICAgIC8vIHRoaXMuc2VwYXJhdG9yRWwgc3RheXMgdGhlIEZJUlNUIGxpbmU6IHN0YXJ0QWRkKCkgaW5zZXJ0cyB0aGUgbmV3IGl0ZW1cbiAgICAgIC8vIGJlZm9yZSBpdCwgYW5kIGEgbmV3IFRZUCBiZWxvbmdzIGFmdGVyIHRoZSByZWdpc3RlcmVkIG9uZXMuXG4gICAgICBjb25zdCBzZXBhcmF0b3IgPSAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGVsID0gdGhpcy5saXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zZXBhcmF0b3JcIiB9KTtcbiAgICAgICAgdGhpcy5zZXBhcmF0b3JFbCA9IHRoaXMuc2VwYXJhdG9yRWwgPz8gZWw7XG4gICAgICB9O1xuXG4gICAgICBpZiAodW5yZWdpc3RlcmVkUm93cy5sZW5ndGggPiAwIHx8IHVucmVnaXN0ZXJlZFN1YnR5cFJvd3MubGVuZ3RoID4gMCB8fCBub1R5cCA+IDApIHNlcGFyYXRvcigpO1xuICAgICAgZm9yIChjb25zdCByb3cgb2YgdW5yZWdpc3RlcmVkUm93cykgdGhpcy5yZW5kZXJVbnJlZ2lzdGVyZWRJdGVtKHJvdy50eXAsIHJvdy5jb3VudCk7XG5cbiAgICAgIGlmICh1bnJlZ2lzdGVyZWRTdWJ0eXBSb3dzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgaWYgKHVucmVnaXN0ZXJlZFJvd3MubGVuZ3RoID4gMCkgc2VwYXJhdG9yKCk7XG4gICAgICAgIGZvciAoY29uc3Qgcm93IG9mIHVucmVnaXN0ZXJlZFN1YnR5cFJvd3MpIHRoaXMucmVuZGVyVW5yZWdpc3RlcmVkU3VidHlwSXRlbShyb3cpO1xuICAgICAgfVxuXG4gICAgICBpZiAobm9UeXAgPiAwKSB0aGlzLnJlbmRlck5vVHlwSXRlbShub1R5cCk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX3JlbmRlcmluZyA9IGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIC8vIExpa2UgdGhlIFwiQ2hhbmdlIHNvcnQgb3JkZXJcIiBidXR0b24gaW4gT2JzaWRpYW4ncyB0YWdzIGFuZCBhbGwtcHJvcGVydGllc1xuICAvLyB2aWV3cy5cbiAgcmVuZGVyTGlzdEhlYWRlcihjb250ZW50RWwpIHtcbiAgICBjb25zdCBoZWFkZXIgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcIm5hdi1oZWFkZXJcIiB9KTtcbiAgICBjb25zdCBidXR0b25zQ29udGFpbmVyID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJuYXYtYnV0dG9ucy1jb250YWluZXJcIiB9KTtcblxuICAgIGNvbnN0IGFkZEJ0biA9IGJ1dHRvbnNDb250YWluZXIuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiBuYXYtYWN0aW9uLWJ1dHRvblwiLFxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJBZGQgVFlQXCIgfSxcbiAgICB9KTtcbiAgICBzZXRJY29uKGFkZEJ0biwgXCJwbHVzXCIpO1xuICAgIGFkZEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5zdGFydEFkZCgpKTtcblxuICAgIGNvbnN0IHNvcnRCdG4gPSBidXR0b25zQ29udGFpbmVyLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gbmF2LWFjdGlvbi1idXR0b25cIixcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiQ2hhbmdlIHNvcnQgb3JkZXJcIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24oc29ydEJ0biwgXCJsdWNpZGUtc29ydC1hc2NcIik7XG4gICAgc29ydEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB0aGlzLnNob3dTb3J0TWVudShldmVudCkpO1xuXG4gICAgLy8gU2Vjb25kIGNvbHVtbjogYSBidXR0b24gY3ljbGluZyB0aGUgdGhyZWUgbW9kZXMgcmF0aGVyIHRoYW4gYSBtZW51IC1cbiAgICAvLyB3aXRoIHNvIGZldyBzdGF0ZXMgd2hvc2UgZWZmZWN0IHNob3dzIHJpZ2h0IGJlbG93LCBjbGlja2luZyB0aHJvdWdoIGlzXG4gICAgLy8gZmFzdGVyLiBJY29uIGFuZCB0b29sdGlwIHNob3cgdGhlIGN1cnJlbnQgbW9kZS5cbiAgICBjb25zdCBjdXJyZW50ID0gU0VDT05EQVJZX01PREVTW3RoaXMuc2Vjb25kYXJ5SW5kZXgoKV07XG4gICAgY29uc3Qgc2Vjb25kYXJ5QnRuID0gYnV0dG9uc0NvbnRhaW5lci5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIG5hdi1hY3Rpb24tYnV0dG9uXCIsXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBgTmV4dCB0byBuYW1lOiAke2N1cnJlbnQudGl0bGV9YCB9LFxuICAgIH0pO1xuICAgIHNldEljb24oc2Vjb25kYXJ5QnRuLCBjdXJyZW50Lmljb24pO1xuICAgIHNlY29uZGFyeUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5jeWNsZVNlY29uZGFyeSgpKTtcbiAgfVxuXG4gIC8vIHNldHRpbmdzLnR5cExpc3RTZWNvbmRhcnksIGJ1dCBhbHdheXMgYSB2YWxpZCBtb2RlIC0gb2xkZXIgZGF0YSBtYXkgbGFja1xuICAvLyB0aGUga2V5LCBhbmQgYSBtb2RlIHJlbW92ZWQgbGF0ZXIgc2hvdWxkbid0IGxlYXZlIHRoZSBsaXN0IGVtcHR5LlxuICBzZWNvbmRhcnlNb2RlKCkge1xuICAgIGNvbnN0IG1vZGUgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBMaXN0U2Vjb25kYXJ5O1xuICAgIHJldHVybiBTRUNPTkRBUllfTU9ERVMuc29tZSgoZW50cnkpID0+IGVudHJ5Lm1vZGUgPT09IG1vZGUpID8gbW9kZSA6IERFRkFVTFRfU0VDT05EQVJZO1xuICB9XG5cbiAgc2Vjb25kYXJ5SW5kZXgoKSB7XG4gICAgcmV0dXJuIFNFQ09OREFSWV9NT0RFUy5maW5kSW5kZXgoKGVudHJ5KSA9PiBlbnRyeS5tb2RlID09PSB0aGlzLnNlY29uZGFyeU1vZGUoKSk7XG4gIH1cblxuICBhc3luYyBjeWNsZVNlY29uZGFyeSgpIHtcbiAgICBjb25zdCBuZXh0ID0gU0VDT05EQVJZX01PREVTWyh0aGlzLnNlY29uZGFyeUluZGV4KCkgKyAxKSAlIFNFQ09OREFSWV9NT0RFUy5sZW5ndGhdO1xuICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cExpc3RTZWNvbmRhcnkgPSBuZXh0Lm1vZGU7XG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgLy8gT25seSB0aGlzIGxpc3QgY2hhbmdlcywgc28gbm8gcmVmcmVzaFR5cENvbG9ycygpIGFjcm9zcyBhbGwgdmlld3MuXG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfVxuXG4gIHNob3dTb3J0TWVudShldmVudCkge1xuICAgIGNvbnN0IGN1cnJlbnQgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBTb3J0T3JkZXIgPz8gREVGQVVMVF9TT1JUX09SREVSO1xuICAgIGNvbnN0IG1lbnUgPSBuZXcgTWVudSgpO1xuXG4gICAgY29uc3QgYWRkR3JvdXAgPSAoc3RhcnQsIGVuZCkgPT4ge1xuICAgICAgZm9yIChsZXQgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICAgICAgY29uc3QgeyBtb2RlLCB0aXRsZSB9ID0gU09SVF9PUFRJT05TW2ldO1xuICAgICAgICBtZW51LmFkZEl0ZW0oKGl0ZW0pID0+XG4gICAgICAgICAgaXRlbVxuICAgICAgICAgICAgLnNldFRpdGxlKHRpdGxlKVxuICAgICAgICAgICAgLnNldENoZWNrZWQoY3VycmVudCA9PT0gbW9kZSlcbiAgICAgICAgICAgIC5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwU29ydE9yZGVyID0gbW9kZTtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICAgICAgICB9KVxuICAgICAgICApO1xuICAgICAgfVxuICAgIH07XG5cbiAgICBhZGRHcm91cCgwLCAxKTtcbiAgICBtZW51LmFkZFNlcGFyYXRvcigpO1xuICAgIGFkZEdyb3VwKDEsIDMpO1xuICAgIG1lbnUuYWRkU2VwYXJhdG9yKCk7XG4gICAgYWRkR3JvdXAoMywgNSk7XG4gICAgbWVudS5hZGRTZXBhcmF0b3IoKTtcbiAgICBhZGRHcm91cCg1LCA3KTtcblxuICAgIG1lbnUuc2hvd0F0TW91c2VFdmVudChldmVudCk7XG4gIH1cblxuICByZW5kZXJOb1R5cEl0ZW0oY291bnQpIHtcbiAgICBjb25zdCB0cmVlSXRlbSA9IHRoaXMubGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW1cIiB9KTtcbiAgICBjb25zdCBzZWxmID0gdHJlZUl0ZW0uY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1zZWxmIGlzLWNsaWNrYWJsZSB0eXAtdW5yZWdpc3RlcmVkXCIgfSk7XG4gICAgc2VsZi5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLWlubmVyXCIsIHRleHQ6IFwiW05PIFRZUF1cIiB9KTtcbiAgICB0aGlzLnJlbmRlckNvdW50RmxhaXIoc2VsZiwgY291bnQpO1xuXG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5vcGVuU2VhcmNoKG51bGwpKTtcbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHRoaXMub3BlblNlYXJjaChudWxsKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIENocm9taXVtJ3MgaW5wdXRbdHlwZT1jb2xvcl0gaGFzIGEgbWluaW11bSBzd2F0Y2ggdGhhdCB3b24ndCBzY2FsZSBiZWxvd1xuICAvLyB0ZXh0IHNpemUsIHNvIGl0IGlzIG9ubHkgYW4gaW52aXNpYmxlIHRyaWdnZXIgb3ZlciBhIGZyZWVseSBzY2FsYWJsZSBkb3QuXG4gIC8vIFdpdGhvdXQgYSBjb2xvciB0aGUgZG90IGlzIGEgaG9sbG93IGdyYXkgcmluZyAoc2VlIHBhaW50Q29sb3JEb3QpOyB3aXRoXG4gIC8vIHNob3dSZXNldCAoZGV0YWlsIHZpZXcpIGEgdG9vbHRpcCBuYW1lcyB0aGUgc3RhdGUgYW5kIHRoZSByZXNldCBidXR0b24gaXNcbiAgLy8gZ3JheWVkIG91dC5cbiAgcmVuZGVyQ29sb3JQaWNrZXIocGFyZW50LCB0eXAsIG9uQ2hhbmdlLCB7IHNob3dSZXNldCA9IGZhbHNlIH0gPSB7fSkge1xuICAgIGNvbnN0IGN1cnJlbnRDb2xvciA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdID8/IERFRkFVTFRfVFlQX0NPTE9SO1xuICAgIGNvbnN0IGNvbG9yV3JhcCA9IHBhcmVudC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWNvbG9yLXdyYXBcIiB9KTtcbiAgICBjb25zdCBjb2xvckRvdCA9IGNvbG9yV3JhcC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWNvbG9yLWRvdFwiIH0pO1xuICAgIGxldCByZXNldEJ0biA9IG51bGw7XG4gICAgY29uc3Qgc2hvd1N0YXRlID0gKGNvbG9yLCBpc0RlZmF1bHQpID0+IHtcbiAgICAgIHBhaW50Q29sb3JEb3QoY29sb3JEb3QsIGNvbG9yLCBpc0RlZmF1bHQpO1xuICAgICAgaWYgKCFzaG93UmVzZXQpIHJldHVybjtcbiAgICAgIGNvbG9yV3JhcC5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIGlzRGVmYXVsdCA/IFwiRGVmYXVsdCAobm8gY29sb3IpXCIgOiBcIkNoYW5nZSBjb2xvclwiKTtcbiAgICAgIHJlc2V0QnRuPy50b2dnbGVDbGFzcyhcImlzLWRpc2FibGVkXCIsIGlzRGVmYXVsdCk7XG4gICAgfTtcblxuICAgIGNvbnN0IGNvbG9ySW5wdXQgPSBjb2xvcldyYXAuY3JlYXRlRWwoXCJpbnB1dFwiLCB7IHR5cGU6IFwiY29sb3JcIiwgY2xzOiBcInR5cC1jb2xvci1pbnB1dFwiIH0pO1xuICAgIGNvbG9ySW5wdXQudmFsdWUgPSBjdXJyZW50Q29sb3I7XG4gICAgY29sb3JJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiBldmVudC5zdG9wUHJvcGFnYXRpb24oKSk7XG5cbiAgICAvLyBcImlucHV0XCIgZmlyZXMgZm9yIGV2ZXJ5IGludGVybWVkaWF0ZSBjb2xvciB3aGlsZSB0aGUgbmF0aXZlIHBpY2tlciBpc1xuICAgIC8vIG9wZW4gLSBvbmx5IGEgbG9jYWwgcHJldmlldyBoZXJlLiByZWZyZXNoVHlwQ29sb3JzKCkgd291bGQgcmUtcmVuZGVyXG4gICAgLy8gdGhpcyB2aWV3LCByZW1vdmUgdGhpcyA8aW5wdXQgdHlwZT1jb2xvcj4gYW5kIGNsb3NlIHRoZSBuYXRpdmUgcGlja2VyXG4gICAgLy8gYmVmb3JlIGEgY29sb3IgY291bGQgZXZlbiBiZSBjaG9zZW4uXG4gICAgY29sb3JJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiaW5wdXRcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgc2hvd1N0YXRlKGNvbG9ySW5wdXQudmFsdWUsIGZhbHNlKTtcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdID0gY29sb3JJbnB1dC52YWx1ZTtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgb25DaGFuZ2U/Lihjb2xvcklucHV0LnZhbHVlKTtcbiAgICB9KTtcblxuICAgIC8vIE9uY2UgdGhlIGNob2ljZSBpcyBjb25maXJtZWQgYW5kIHRoZSBwaWNrZXIgY2xvc2VkLCBhIHJlLXJlbmRlciBjYW4ndFxuICAgIC8vIGJyZWFrIGFueXRoaW5nIGFueSBtb3JlLlxuICAgIGNvbG9ySW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCAoKSA9PiB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKSk7XG5cbiAgICBpZiAoc2hvd1Jlc2V0KSB7XG4gICAgICByZXNldEJ0biA9IHBhcmVudC5jcmVhdGVEaXYoe1xuICAgICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWNvbG9yLXJlc2V0XCIsXG4gICAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiUmVzZXQgY29sb3JcIiB9LFxuICAgICAgfSk7XG4gICAgICBzZXRJY29uKHJlc2V0QnRuLCBcInJvdGF0ZS1jY3dcIik7XG4gICAgICByZXNldEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF07XG4gICAgICAgIGNvbG9ySW5wdXQudmFsdWUgPSBERUZBVUxUX1RZUF9DT0xPUjtcbiAgICAgICAgc2hvd1N0YXRlKERFRkFVTFRfVFlQX0NPTE9SLCB0cnVlKTtcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICBvbkNoYW5nZT8uKERFRkFVTFRfVFlQX0NPTE9SKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICBzaG93U3RhdGUoY3VycmVudENvbG9yLCB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdHlwXSA9PT0gdW5kZWZpbmVkKTtcblxuICAgIHJldHVybiBjb2xvcldyYXA7XG4gIH1cblxuICAvLyBHdWFyZHMgc2V0dGluZ3Mgb2JqZWN0cyBsb2FkZWQgYmVmb3JlIHR5cE1hbnVhbCBleGlzdGVkIChhIHJ1bm5pbmdcbiAgLy8gc2Vzc2lvbiBhY3Jvc3MgYSBob3QgcmVsb2FkLCBzYXkpIC0gb3RoZXJ3aXNlIGV2ZXJ5IGFjY2VzcyBiZWxvdyB3b3VsZFxuICAvLyB0aHJvdyBhbmQgdGFrZSB0aGUgcmVzdCBvZiByZW5kZXJUeXBTZXR0aW5ncygpIGRvd24gd2l0aCBpdC5cbiAgZW5zdXJlVHlwTWFudWFsKCkge1xuICAgIGlmICghdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwTWFudWFsKSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBNYW51YWwgPSB7fTtcbiAgICByZXR1cm4gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwTWFudWFsO1xuICB9XG5cbiAgLy8gVGhlIHNoYXJlZCBcIk1hbnVhbGx5IGNyZWF0YWJsZVwiIGJ1dHRvbiBvZiBUWVAgKHJlbmRlck1hbnVhbFRvZ2dsZSkgYW5kXG4gIC8vIFN1YnR5cCAocmVuZGVyU3VidHlwTWFudWFsVG9nZ2xlKSwgZWFjaCBiZXR3ZWVuIHJlbmFtZSBhbmQgZGVsZXRlLiBBblxuICAvLyBpY29uIGJ1dHRvbiByYXRoZXIgdGhhbiBhIGxhYmVsZWQgdG9nZ2xlIC0gdG9vIHNtYWxsIGEgc2V0dGluZyBmb3IgaXRzIG93blxuICAvLyByb3cuIFN0YXRlIHZpYSBhIGNsYXNzIChpcy1hY3RpdmUsIHNlZSBzdHlsZXMuY3NzKSwgbWVhbmluZyBpbiB0aGUgdG9vbHRpcDtcbiAgLy8gcm9sZS9hcmlhLWNoZWNrZWQga2VlcCBpdCByZWFkYWJsZSBhcyBhIHN3aXRjaC5cbiAgLy9cbiAgLy8gb25Ub2dnbGUgZ2V0cyB0aGUgbmV3IHN0YXRlLCBzYXZlcyBpdCBhbmQgdXBkYXRlcyB0aGUgZGVwZW5kZW50IGJ1dHRvbnNcbiAgLy8gKHNlZSBzeW5jTWFudWFsVG9nZ2xlcykgLSB0aGUgY2xpY2sgZG9lc24ndCBwYWludCBpdHNlbGYsIHNpbmNlIGEgdG9nZ2xlXG4gIC8vIGhlcmUgbmV2ZXIgYWZmZWN0cyBqdXN0IHRoaXMgb25lIGJ1dHRvbi5cbiAgcmVuZGVyTWFudWFsSWNvbihwYXJlbnQsIGNscywgaXNPbiwgb25Ub2dnbGUpIHtcbiAgICBjb25zdCBidG4gPSBwYXJlbnQuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogYGNsaWNrYWJsZS1pY29uIHR5cC1tYW51YWwtaWNvbiAke2Nsc31gLFxuICAgICAgYXR0cjogeyB0YWJpbmRleDogXCIwXCIsIHJvbGU6IFwiY2hlY2tib3hcIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24oYnRuLCBcImZpbGUtcGVuLWxpbmVcIik7XG5cbiAgICBidG4udHlwU2hvd01hbnVhbFN0YXRlID0gKG9uKSA9PiB7XG4gICAgICBidG4udG9nZ2xlQ2xhc3MoXCJpcy1hY3RpdmVcIiwgb24pO1xuICAgICAgYnRuLnNldEF0dHJpYnV0ZShcImFyaWEtY2hlY2tlZFwiLCBTdHJpbmcob24pKTtcbiAgICAgIGJ0bi5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIG9uID8gXCJNYW51YWxseSBjcmVhdGFibGVcIiA6IFwiTm90IG1hbnVhbGx5IGNyZWF0YWJsZVwiKTtcbiAgICB9O1xuICAgIGJ0bi50eXBTaG93TWFudWFsU3RhdGUoaXNPbik7XG5cbiAgICBjb25zdCB0b2dnbGUgPSAoKSA9PiBvblRvZ2dsZSghYnRuLmhhc0NsYXNzKFwiaXMtYWN0aXZlXCIpKTtcbiAgICBidG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIHRvZ2dsZSk7XG4gICAgYnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIChldmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmtleSA9PT0gXCJFbnRlclwiIHx8IGV2ZW50LmtleSA9PT0gXCIgXCIpIHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgdG9nZ2xlKCk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gYnRuO1xuICB9XG5cbiAgLy8gVGhlIFRZUCdzIFwiTWFudWFsbHkgY3JlYXRhYmxlXCIsIGluIHRoZSBkZXRhaWwgaGVhZGVyIGJldHdlZW4gcmVuYW1lIGFuZFxuICAvLyBkZWxldGUuIE9uIGJ5IGRlZmF1bHQsIHNvIG9ubHkgXCJvZmZcIiAoZmFsc2UpIGlzIHN0b3JlZC4gRGVjaWRlcyB3aGV0aGVyXG4gIC8vIGdldFR5cHMoKSAobWFpbi5qcykgcmV0dXJucyB0aGUgVFlQLlxuICAvL1xuICAvLyBUaGUgVFlQIGFsd2F5cyB0YWtlcyBpdHMgU3VidHlwcyBhbG9uZzogdGhlIHBpY2tlciBvbmx5IHJlYWNoZXMgdGhlbVxuICAvLyB0aHJvdWdoIGl0LCBzbyBhIFRZUCBzd2l0Y2hlZCBvZmYgd291bGQgc2lsZW50bHkgbWFrZSB0aGVtIHVucmVhY2hhYmxlXG4gIC8vIChzZWUgc2V0QWxsU3VidHlwc01hbnVhbCBpbiBzdWJ0eXBzLmpzKS5cbiAgcmVuZGVyTWFudWFsVG9nZ2xlKHBhcmVudCwgdHlwKSB7XG4gICAgcmV0dXJuIHRoaXMucmVuZGVyTWFudWFsSWNvbihwYXJlbnQsIFwidHlwLW1hbnVhbC10eXBcIiwgdGhpcy5lbnN1cmVUeXBNYW51YWwoKVt0eXBdICE9PSBmYWxzZSwgYXN5bmMgKG9uKSA9PiB7XG4gICAgICBpZiAob24pIGRlbGV0ZSB0aGlzLmVuc3VyZVR5cE1hbnVhbCgpW3R5cF07XG4gICAgICBlbHNlIHRoaXMuZW5zdXJlVHlwTWFudWFsKClbdHlwXSA9IGZhbHNlO1xuICAgICAgc2V0QWxsU3VidHlwc01hbnVhbCh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBvbik7XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgIHRoaXMuc3luY01hbnVhbFRvZ2dsZXModHlwKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIEEgU3VidHlwJ3MgXCJNYW51YWxseSBjcmVhdGFibGVcIiwgaW4gaXRzIGJsb2NrIGZvb3RlciBiZXR3ZWVuIHJlbmFtZSBhbmRcbiAgLy8gZGVsZXRlIChzZWUgcmVuZGVyU2VjdGlvbkZvb3RlcikuIFVubGlrZSB0aGUgVFlQIGJ1dHRvbiBpdCBwdWxscyBvbmx5IG9uZVxuICAvLyB3YXk6IHN3aXRjaGluZyBhIFN1YnR5cCBvbiBhbHNvIHN3aXRjaGVzIGl0cyBUWVAgb24gKGVsc2UgaXQgd291bGQgYmVcbiAgLy8gdW5yZWFjaGFibGUpLCB0aGUgb3RoZXIgU3VidHlwcyBzdGF5IGFzIHRoZXkgYXJlIC0gdGhhdCBpcyB0aGUgcG9pbnQuXG4gIHJlbmRlclN1YnR5cE1hbnVhbFRvZ2dsZShwYXJlbnQsIHR5cCwgc3VidHlwKSB7XG4gICAgY29uc3QgYnRuID0gdGhpcy5yZW5kZXJNYW51YWxJY29uKFxuICAgICAgcGFyZW50LFxuICAgICAgXCJ0eXAtbWFudWFsLXN1YnR5cFwiLFxuICAgICAgaXNTdWJ0eXBNYW51YWwodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKSxcbiAgICAgIGFzeW5jIChvbikgPT4ge1xuICAgICAgICBzZXRTdWJ0eXBNYW51YWwodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwLCBvbik7XG4gICAgICAgIGlmIChvbikgZGVsZXRlIHRoaXMuZW5zdXJlVHlwTWFudWFsKClbdHlwXTtcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIHRoaXMuc3luY01hbnVhbFRvZ2dsZXModHlwKTtcbiAgICAgIH1cbiAgICApO1xuICAgIGJ0bi50eXBTdWJ0eXAgPSBzdWJ0eXA7XG4gICAgcmV0dXJuIGJ0bjtcbiAgfVxuXG4gIC8vIFJlcGFpbnRzIGV2ZXJ5IG1hbnVhbCBidXR0b24gb2YgdGhlIGRldGFpbCB2aWV3IGFmdGVyIG9uZSBjaGFuZ2VkIHRoZVxuICAvLyBvdGhlcnMuIE9ubHkgdGhlIGJ1dHRvbnMsIG5vdCByZW5kZXIoKTogYSByZWJ1aWxkIHdvdWxkIHJlY3JlYXRlIGV2ZXJ5XG4gIC8vIGJsb2NrJ3MgZWRpdG9ycywgaW5jbHVkaW5nIGEgcm93IGJlaW5nIGVkaXRlZC4gRm91bmQgdmlhIHRoZSBET00gbGlrZSB0aGVcbiAgLy8gU3VidHlwIGNvbG9yIGRvdHMgLSBmcm9udG1hdHRlci1ibG9ja3MuanMgYnVpbGRzIHRoZSBmb290ZXJzLCBubyBsaXN0IG9mXG4gIC8vIHRoZW0gbGl2ZXMgaGVyZS5cbiAgc3luY01hbnVhbFRvZ2dsZXModHlwKSB7XG4gICAgdGhpcy5jb250ZW50RWwucXVlcnlTZWxlY3RvcihcIi50eXAtbWFudWFsLXR5cFwiKT8udHlwU2hvd01hbnVhbFN0YXRlKHRoaXMuZW5zdXJlVHlwTWFudWFsKClbdHlwXSAhPT0gZmFsc2UpO1xuICAgIGZvciAoY29uc3QgZWwgb2YgdGhpcy5jb250ZW50RWwucXVlcnlTZWxlY3RvckFsbChcIi50eXAtbWFudWFsLXN1YnR5cFwiKSkge1xuICAgICAgZWwudHlwU2hvd01hbnVhbFN0YXRlKGlzU3VidHlwTWFudWFsKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIGVsLnR5cFN1YnR5cCkpO1xuICAgIH1cbiAgfVxuXG4gIHJlbmRlclJlZ2lzdGVyZWRJdGVtKHR5cCwgY291bnQsIHsgZHJhZ2dhYmxlID0gZmFsc2UsIGluZGV4ID0gLTEgfSA9IHt9KSB7XG4gICAgY29uc3QgdHJlZUl0ZW0gPSB0aGlzLmxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtXCIgfSk7XG4gICAgY29uc3Qgc2VsZiA9IHRyZWVJdGVtLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0tc2VsZiBpcy1jbGlja2FibGVcIiB9KTtcblxuICAgIGxldCBuYW1lRWw7XG4gICAgdGhpcy5yZW5kZXJDb2xvclBpY2tlcihzZWxmLCB0eXAsIChuZXdDb2xvcikgPT4ge1xuICAgICAgaWYgKG5hbWVFbCAmJiB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3QpIG5hbWVFbC5zdHlsZS5jb2xvciA9IG5ld0NvbG9yO1xuICAgIH0pO1xuXG4gICAgbmFtZUVsID0gc2VsZi5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLWlubmVyXCIsIHRleHQ6IHR5cCB9KTtcbiAgICBjb25zdCBjb2xvciA9IHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdCA/IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdIDogbnVsbDtcbiAgICBpZiAoY29sb3IpIG5hbWVFbC5zdHlsZS5jb2xvciA9IGNvbG9yO1xuXG4gICAgLy8gU2Vjb25kIGNvbHVtbiwgY3ljbGVkIGJ5IHRoZSBoZWFkZXIgYnV0dG9uIChzZWUgU0VDT05EQVJZX01PREVTKS5cbiAgICBjb25zdCBzZWNvbmRhcnkgPSB0aGlzLnNlY29uZGFyeU1vZGUoKTtcbiAgICBpZiAoc2Vjb25kYXJ5ID09PSBcImRlc2NyaXB0aW9uXCIpIHRoaXMucmVuZGVyRGVzY3JpcHRpb25JbnB1dChzZWxmLCB0eXApO1xuICAgIGVsc2UgaWYgKHNlY29uZGFyeSA9PT0gXCJzdWJ0eXBzXCIpIHRoaXMucmVuZGVyU3VidHlwUHJldmlldyhzZWxmLCB0eXApO1xuXG4gICAgdGhpcy5yZW5kZXJDb3VudEZsYWlyKHNlbGYsIGNvdW50KTtcblxuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIGlmICh0aGlzLmlzRWRpdGluZykgcmV0dXJuO1xuICAgICAgdGhpcy5vcGVuVHlwU2V0dGluZ3ModHlwKTtcbiAgICB9KTtcbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHRoaXMub3BlblNlYXJjaCh0eXApO1xuICAgIH0pO1xuXG4gICAgLy8gT25seSBpbiBtYW51YWwgc29ydCBtb2RlIChzZWUgcmVuZGVyKCkpOiB0aGUgd2hvbGUgcm93IGNhbiBiZSBkcmFnZ2VkXG4gICAgLy8gKGEgZHJhZyBzdGFydGluZyBvbiB0aGUgZG90IG9yIGluIHRoZSBkZXNjcmlwdGlvbiBmaWVsZCBkb2Vzbid0IGNvdW50IC1cbiAgICAvLyB0aG9zZSB0YWtlIHRoZSBtb3VzZWRvd24gdGhlbXNlbHZlcykuIE1vdmVzIGVudHJpZXMgaW4gc2V0dGluZ3MudHlwcyxcbiAgICAvLyB0aGUgbGlzdCB0aGF0IGlzIHRoZSBkaXNwbGF5IG9yZGVyIGluIG1hbnVhbCBtb2RlLlxuICAgIGlmIChkcmFnZ2FibGUpIHtcbiAgICAgIHNlbGYuZHJhZ2dhYmxlID0gdHJ1ZTtcbiAgICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdzdGFydFwiLCAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQuZGF0YVRyYW5zZmVyLmVmZmVjdEFsbG93ZWQgPSBcIm1vdmVcIjtcbiAgICAgICAgZXZlbnQuZGF0YVRyYW5zZmVyLnNldERhdGEoXCJ0ZXh0L3BsYWluXCIsIFN0cmluZyhpbmRleCkpO1xuICAgICAgICBzZWxmLmNsYXNzTGlzdC5hZGQoXCJpcy1kcmFnZ2luZ1wiKTtcbiAgICAgIH0pO1xuICAgICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ2VuZFwiLCAoKSA9PiBzZWxmLmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcmFnZ2luZ1wiKSk7XG4gICAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnb3ZlclwiLCAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgY29uc3QgcmVjdCA9IHNlbGYuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICAgIGNvbnN0IGlzQWZ0ZXIgPSBldmVudC5jbGllbnRZIC0gcmVjdC50b3AgPiByZWN0LmhlaWdodCAvIDI7XG4gICAgICAgIHNlbGYuY2xhc3NMaXN0LnRvZ2dsZShcImlzLWRyb3AtYmVmb3JlXCIsICFpc0FmdGVyKTtcbiAgICAgICAgc2VsZi5jbGFzc0xpc3QudG9nZ2xlKFwiaXMtZHJvcC1hZnRlclwiLCBpc0FmdGVyKTtcbiAgICAgIH0pO1xuICAgICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ2xlYXZlXCIsICgpID0+IHNlbGYuY2xhc3NMaXN0LnJlbW92ZShcImlzLWRyb3AtYmVmb3JlXCIsIFwiaXMtZHJvcC1hZnRlclwiKSk7XG4gICAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJkcm9wXCIsIGFzeW5jIChldmVudCkgPT4ge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBjb25zdCBpc0FmdGVyID0gc2VsZi5jbGFzc0xpc3QuY29udGFpbnMoXCJpcy1kcm9wLWFmdGVyXCIpO1xuICAgICAgICBzZWxmLmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcm9wLWJlZm9yZVwiLCBcImlzLWRyb3AtYWZ0ZXJcIik7XG5cbiAgICAgICAgY29uc3QgZnJvbUluZGV4ID0gTnVtYmVyKGV2ZW50LmRhdGFUcmFuc2Zlci5nZXREYXRhKFwidGV4dC9wbGFpblwiKSk7XG4gICAgICAgIGlmIChOdW1iZXIuaXNOYU4oZnJvbUluZGV4KSB8fCBmcm9tSW5kZXggPT09IGluZGV4KSByZXR1cm47XG5cbiAgICAgICAgbGV0IGluc2VydEJlZm9yZSA9IGlzQWZ0ZXIgPyBpbmRleCArIDEgOiBpbmRleDtcbiAgICAgICAgaWYgKGZyb21JbmRleCA8IGluc2VydEJlZm9yZSkgaW5zZXJ0QmVmb3JlIC09IDE7XG5cbiAgICAgICAgY29uc3QgdHlwcyA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cHM7XG4gICAgICAgIGNvbnN0IFttb3ZlZF0gPSB0eXBzLnNwbGljZShmcm9tSW5kZXgsIDEpO1xuICAgICAgICB0eXBzLnNwbGljZShpbnNlcnRCZWZvcmUsIDAsIG1vdmVkKTtcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICAvLyBBIHJlYWwgaW5wdXQsIHNvIHRoZSBkZXNjcmlwdGlvbiBjYW4gYmUgZWRpdGVkIHJpZ2h0IGluIHRoZSBsaXN0LiBJdHNcbiAgLy8gY2xpY2sgbXVzdCBOT1QgdHJpZ2dlciB0aGUgcm93ICh3aGljaCB3b3VsZCBvcGVuIHRoZSBkZXRhaWwgdmlldykuXG4gIHJlbmRlckRlc2NyaXB0aW9uSW5wdXQoc2VsZiwgdHlwKSB7XG4gICAgY29uc3QgZGVzY0lucHV0ID0gc2VsZi5jcmVhdGVFbChcImlucHV0XCIsIHtcbiAgICAgIHR5cGU6IFwidGV4dFwiLFxuICAgICAgY2xzOiBcInR5cC1saXN0LWRlc2NyaXB0aW9uLWlucHV0XCIsXG4gICAgfSk7XG4gICAgZGVzY0lucHV0LnZhbHVlID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRGVzY3JpcHRpb25zW3R5cF0gPz8gXCJcIjtcbiAgICBkZXNjSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChldmVudCkgPT4gZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCkpO1xuICAgIGRlc2NJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gZGVzY0lucHV0LnZhbHVlLnRyaW0oKTtcbiAgICAgIGlmICh2YWx1ZSkgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRGVzY3JpcHRpb25zW3R5cF0gPSB2YWx1ZTtcbiAgICAgIGVsc2UgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlc2NyaXB0aW9uc1t0eXBdO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBcIihTdWJ0eXAgMSwgU3VidHlwIDIpXCIgaW5zdGVhZCBvZiB0aGUgZGVzY3JpcHRpb24gLSB0aGUgc2FtZSBsb29rIGFzIHRoZVxuICAvLyBwcmV2aWV3IGluIHRoZSBzZXBhcmF0ZSBUWVAtUGlja2VyIChzaGFyZWQgbmFtZUNvbG9yIGluIHR5cC1jb2xvcnMuanMpOlxuICAvLyBicmFja2V0cyBhbmQgY29tbWFzIG11dGVkLCBlYWNoIG5hbWUgaW4gaXRzIFN1YnR5cCBjb2xvci4gT25seSByZWdpc3RlcmVkXG4gIC8vIFN1YnR5cHMgYW5kIG5vIGNvdW50cyAtIHVucmVnaXN0ZXJlZCB2YWx1ZXMgaGF2ZSBubyBjb2xvciwgYW5kIGNvdW50c1xuICAvLyB3b3VsZCBtYWtlIHRoZSByb3cgdW5yZWFkYWJsZS4gRGlzcGxheSBvbmx5OyBjbGljayBhbmQgcmlnaHQtY2xpY2sgYmVsb25nXG4gIC8vIHRvIHRoZSByb3cuIExlZnQgb3IgcmlnaHQgYWxpZ25tZW50IGlzIGEgU3R5bGUgU2V0dGluZ3MgYm9keSBjbGFzcyAoc2VlXG4gIC8vIEBzZXR0aW5ncyBhbmQgLnR5cC1saXN0LXN1YnR5cHMgaW4gc3R5bGVzLmNzcyk7IHRoZSBtYXJrdXAgaXMgdGhlIHNhbWUuXG4gIHJlbmRlclN1YnR5cFByZXZpZXcoc2VsZiwgdHlwKSB7XG4gICAgY29uc3Qgc3VidHlwcyA9IGdldFN1YnR5cE5hbWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXApO1xuICAgIGlmIChzdWJ0eXBzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gICAgY29uc3QgY29sb3JpemUgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3Q7XG4gICAgY29uc3Qgd3JhcCA9IHNlbGYuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtbGlzdC1zdWJ0eXBzXCIgfSk7XG4gICAgd3JhcC5hcHBlbmRUZXh0KFwiKFwiKTtcbiAgICBzdWJ0eXBzLmZvckVhY2goKHN1YnR5cCwgaW5kZXgpID0+IHtcbiAgICAgIGlmIChpbmRleCA+IDApIHdyYXAuYXBwZW5kVGV4dChcIiwgXCIpO1xuICAgICAgY29uc3Qgc3BhbiA9IHdyYXAuY3JlYXRlU3Bhbih7IHRleHQ6IHN1YnR5cCB9KTtcbiAgICAgIGlmIChjb2xvcml6ZSkgc3Bhbi5zdHlsZS5jb2xvciA9IG5hbWVDb2xvcih0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApLmNvbG9yO1xuICAgIH0pO1xuICAgIHdyYXAuYXBwZW5kVGV4dChcIilcIik7XG4gIH1cblxuICByZW5kZXJVbnJlZ2lzdGVyZWRJdGVtKHR5cCwgY291bnQpIHtcbiAgICBjb25zdCB0cmVlSXRlbSA9IHRoaXMubGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW1cIiB9KTtcbiAgICBjb25zdCBzZWxmID0gdHJlZUl0ZW0uY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1zZWxmIGlzLWNsaWNrYWJsZSB0eXAtdW5yZWdpc3RlcmVkXCIgfSk7XG4gICAgc2VsZi5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLWlubmVyXCIsIHRleHQ6IGRpc3BsYXlUeXBLZXkodHlwKSB9KTtcbiAgICB0aGlzLnJlbmRlckNvdW50RmxhaXIoc2VsZiwgY291bnQpO1xuXG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5yZWdpc3RlclR5cCh0eXApKTtcbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHRoaXMub3BlblNlYXJjaCh0eXApO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gRXZlcnkgU1VCVFlQIHZhbHVlIHRoYXQgb2NjdXJzIGluIG5vdGVzIGJ1dCBpc24ndCByZWdpc3RlcmVkIHVuZGVyIGl0cyBUWVBcbiAgLy8gLSBhY3Jvc3MgdGhlIHZhdWx0LCB1bmxpa2UgcmVuZGVyVW5yZWdpc3RlcmVkU3VidHlwcygpIGluIHRoZSBkZXRhaWwgdmlldy5cbiAgLy8gVGhlIGluZGV4IGtlZXBzIGJ1Y2tldHMgZm9yIEFMTCBUWVAga2V5cywgdW5yZWdpc3RlcmVkIG9uZXMgaW5jbHVkZWQsIHNvXG4gIC8vIHRoZWlyIFN1YnR5cHMgY29tZSBhbG9uZyAoYSBjbGljayB0aGVuIHJlZ2lzdGVycyBib3RoLCBzZWVcbiAgLy8gcmVnaXN0ZXJUeXBXaXRoU3VidHlwKS5cbiAgLy9cbiAgLy8gU29ydGVkIGJ5IGNvdW50LCB0aGVuIGJ5IHJvdyB0ZXh0IChUWVAsIHRoZW4gU3VidHlwKSAtIGxpa2UgdGhlIGRldGFpbFxuICAvLyB2aWV3LiBEZWxpYmVyYXRlbHkgTk9UIGJ5IHRoZSBsaXN0J3Mgc29ydCBidXR0b246IFwiY29sb3JcIiBhbmQgXCJtYW51YWxcIlxuICAvLyBtZWFuIG5vdGhpbmcgZm9yIHVucmVnaXN0ZXJlZCB2YWx1ZXMuXG4gIC8vXG4gIC8vIEEgbm90ZSB3aXRob3V0IGEgVFlQIGlzIGxlZnQgb3V0OiB0aGUgaW5kZXggZHJvcHMgaXRzIFNVQlRZUCBhbHJlYWR5IChzZWVcbiAgLy8gYWdncmVnYXRlKCkgaW4gdHlwLWluZGV4LmpzKSwgYSBTVUJUWVAgd2l0aG91dCBhIFRZUCBoYXMgbm8gY29udGV4dC5cbiAgdW5yZWdpc3RlcmVkU3VidHlwUm93cygpIHtcbiAgICBjb25zdCByZWdpc3RlcmVkID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwcztcbiAgICBjb25zdCByb3dzID0gW107XG4gICAgZm9yIChjb25zdCBbdHlwLCBidWNrZXRdIG9mIHRoaXMucGx1Z2luLnR5cEluZGV4LnN1YnR5cENvdW50cygpKSB7XG4gICAgICBjb25zdCBrbm93biA9IGdldFN1YnR5cE5hbWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXApO1xuICAgICAgZm9yIChjb25zdCBbc3VidHlwLCBjb3VudF0gb2YgYnVja2V0LmNvdW50cykge1xuICAgICAgICBpZiAoa25vd24uaW5jbHVkZXMoc3VidHlwKSkgY29udGludWU7XG4gICAgICAgIHJvd3MucHVzaCh7IHR5cCwgc3VidHlwLCBjb3VudCwgdHlwUmVnaXN0ZXJlZDogcmVnaXN0ZXJlZC5pbmNsdWRlcyh0eXApIH0pO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcm93cy5zb3J0KChhLCBiKSA9PiBiLmNvdW50IC0gYS5jb3VudCB8fCBhLnR5cC5sb2NhbGVDb21wYXJlKGIudHlwKSB8fCBhLnN1YnR5cC5sb2NhbGVDb21wYXJlKGIuc3VidHlwKSk7XG4gIH1cblxuICAvLyBcIk5PVElaIC8gS3VyeiBHZXNjaGljaHRlXCIgLSB0aGUgU3VidHlwIGFsb25lIHdvdWxkIGJlIGFtYmlndW91cywgdGhlIHNhbWVcbiAgLy8gbmFtZSBjYW4gZXhpc3QgdW5kZXIgc2V2ZXJhbCBUWVAgZW50cmllcy4gSWYgdGhlIFRZUCBpcyByZWdpc3RlcmVkLCBpdHNcbiAgLy8gcGFydCBjYXJyaWVzIGl0cyBjb2xvciAob3IgYSBkb3QsIGRlcGVuZGluZyBvbiBcIlRZUC1QYW5lXCIgY29sb3JpbmcpLFxuICAvLyB0b25lZCBkb3duIGJ5IHRoZSBTdHlsZSBTZXR0aW5nIFwiQ29sb3IgaW4gdW5yZWdpc3RlcmVkIFN1YnR5cCByb3dzXCIgc29cbiAgLy8gdGhlc2Ugcm93cyBzdGF5IGJlaGluZCB0aGUgcmVnaXN0ZXJlZCBlbnRyaWVzIGFib3ZlLiBJZiB0aGUgVFlQIGlzbid0XG4gIC8vIHJlZ2lzdGVyZWQgZWl0aGVyLCB0aGUgd2hvbGUgcm93IGlzIG11dGVkIGxpa2UgdGhlIGVudHJpZXMgYWJvdmUgaXQuXG4gIHJlbmRlclVucmVnaXN0ZXJlZFN1YnR5cEl0ZW0oeyB0eXAsIHN1YnR5cCwgY291bnQsIHR5cFJlZ2lzdGVyZWQgfSkge1xuICAgIGNvbnN0IHRyZWVJdGVtID0gdGhpcy5saXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbVwiIH0pO1xuICAgIGNvbnN0IHNlbGYgPSB0cmVlSXRlbS5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLXNlbGYgaXMtY2xpY2thYmxlIHR5cC11bnJlZ2lzdGVyZWRcIiB9KTtcblxuICAgIGNvbnN0IGNvbG9yaXplID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0O1xuICAgIGNvbnN0IHsgY29sb3IsIGlzRGVmYXVsdCB9ID0gbmFtZUNvbG9yKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXApO1xuICAgIGlmICh0eXBSZWdpc3RlcmVkICYmICFjb2xvcml6ZSkge1xuICAgICAgY29uc3Qgd3JhcCA9IHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1jb2xvci13cmFwIHR5cC11bnJlZ2lzdGVyZWQtc3VidHlwLWNvbG9yXCIgfSk7XG4gICAgICBwYWludENvbG9yRG90KHdyYXAuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1jb2xvci1kb3RcIiB9KSwgY29sb3IsIGlzRGVmYXVsdCk7XG4gICAgfVxuXG4gICAgY29uc3QgaW5uZXIgPSBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0taW5uZXJcIiB9KTtcbiAgICBjb25zdCB0eXBFbCA9IGlubmVyLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXVucmVnaXN0ZXJlZC1zdWJ0eXAtdHlwXCIsIHRleHQ6IGRpc3BsYXlUeXBLZXkodHlwKSB9KTtcbiAgICBpZiAodHlwUmVnaXN0ZXJlZCAmJiBjb2xvcml6ZSAmJiAhaXNEZWZhdWx0KSB7XG4gICAgICB0eXBFbC5zdHlsZS5jb2xvciA9IGNvbG9yO1xuICAgICAgdHlwRWwuYWRkQ2xhc3MoXCJ0eXAtdW5yZWdpc3RlcmVkLXN1YnR5cC1jb2xvclwiKTtcbiAgICB9XG4gICAgaW5uZXIuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtdW5yZWdpc3RlcmVkLXN1YnR5cC1zbGFzaFwiLCB0ZXh0OiBcIiAvIFwiIH0pO1xuICAgIGlubmVyLmNyZWF0ZVNwYW4oeyB0ZXh0OiBkaXNwbGF5VHlwS2V5KHN1YnR5cCkgfSk7XG5cbiAgICB0aGlzLnJlbmRlckNvdW50RmxhaXIoc2VsZiwgY291bnQpO1xuXG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5yZWdpc3RlclR5cFdpdGhTdWJ0eXAodHlwLCBzdWJ0eXApKTtcbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHRoaXMub3BlblN1YnR5cFNlYXJjaCh0eXAsIHN1YnR5cCk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBDbGlja2luZyBzdWNoIGEgcm93IHJlZ2lzdGVycyB0aGUgU3VidHlwIGFuZCwgaWYgbmVlZGVkLCBpdHMgVFlQLiBUWVBcbiAgLy8gZmlyc3QsIHRoZW4gU3VidHlwIC0gbmVjZXNzYXJpbHk6IHJlZ2lzdGVyaW5nIGEgVFlQIGNhbiBjbGVhbiBpdHMgdmFsdWUgaW5cbiAgLy8gdGhlIG5vdGVzIChcIiBidWNoXCIgLT4gXCJCVUNIXCIpLCBhbmQgdGhlIFN1YnR5cCBwYXNzIG11c3QgdGhlbiB1c2UgdGhlIE5FV1xuICAvLyBUWVAgbmFtZSBvciByZW5hbWVTdWJ0eXBJbk5vdGVzKCkgZmluZHMgbm8gZmlsZS5cbiAgLy9cbiAgLy8gTm8gY29uZmlybWF0aW9uOiBpdCBvbmx5IHJlZ2lzdGVycy4gTm90ZXMgY2hhbmdlIG9ubHkgd2hlbiBhIHJhdyB2YWx1ZSB3YXNcbiAgLy8gdW5jbGVhbiBhbmQgZ2V0cyBjbGVhbmVkIC0gYSBjbGVhbiB2YWx1ZSB0b3VjaGVzIG5vIGZpbGUuXG4gIGFzeW5jIHJlZ2lzdGVyVHlwV2l0aFN1YnR5cCh0eXBLZXksIHN1YnR5cEtleSkge1xuICAgIGNvbnN0IGJ1Y2tldCA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnN1YnR5cEJ1Y2tldCh0eXBLZXkpO1xuICAgIGNvbnN0IHR5cFJlc3VsdCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cHMuaW5jbHVkZXModHlwS2V5KVxuICAgICAgPyB7IHR5cDogdHlwS2V5LCByZW5hbWVkOiAwIH1cbiAgICAgIDogYXdhaXQgdGhpcy5hcHBseVR5cFJlZ2lzdHJhdGlvbih0eXBLZXkpO1xuICAgIGlmICghdHlwUmVzdWx0KSByZXR1cm47XG5cbiAgICBjb25zdCBzdWJ0eXBSZXN1bHQgPSBhd2FpdCB0aGlzLmFwcGx5U3VidHlwUmVnaXN0cmF0aW9uKHR5cFJlc3VsdC50eXAsIHN1YnR5cEtleSwgYnVja2V0KTtcbiAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICB0aGlzLnJlbmRlcigpO1xuICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuXG4gICAgaWYgKCFzdWJ0eXBSZXN1bHQpIHJldHVybjtcbiAgICBjb25zdCBwYXJ0cyA9IFtdO1xuICAgIGlmICh0eXBSZXN1bHQudHlwICE9PSB0eXBLZXkpIHBhcnRzLnB1c2goYFRZUCAke3R5cFJlc3VsdC50eXB9YCk7XG4gICAgcGFydHMucHVzaChgU3VidHlwICR7c3VidHlwUmVzdWx0LnN1YnR5cH1gKTtcbiAgICBjb25zdCBjaGFuZ2VkID0gdHlwUmVzdWx0LnJlbmFtZWQgKyBzdWJ0eXBSZXN1bHQucmVuYW1lZDtcbiAgICBuZXcgTm90aWNlKGAke2pvaW5BbmQocGFydHMpfSByZWdpc3RlcmVkJHtjaGFuZ2VkID4gMCA/IGAsICR7cGx1cmFsKGNoYW5nZWQsIFwibm90ZVwiKX0gdXBkYXRlZGAgOiBcIlwifS5gKTtcbiAgfVxuXG4gIHJlbmRlclR5cFNldHRpbmdzKHR5cCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuXG4gICAgY29uc3QgaGVhZGVyID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZGV0YWlsLWhlYWRlclwiIH0pO1xuICAgIGNvbnN0IGJhY2tCdG4gPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1iYWNrXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiQmFja1wiIH0gfSk7XG4gICAgc2V0SWNvbihiYWNrQnRuLCBcImFycm93LWxlZnRcIik7XG4gICAgYmFja0J0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5jbG9zZVR5cFNldHRpbmdzKCkpO1xuXG4gICAgY29uc3QgdGl0bGVFbCA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWRldGFpbC10aXRsZVwiLCB0ZXh0OiB0eXAgfSk7XG4gICAgY29uc3QgdGl0bGVDb2xvciA9IHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdCA/IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdIDogbnVsbDtcbiAgICAvLyBBIGN1c3RvbSBwcm9wZXJ0eSBpbnN0ZWFkIG9mIGNvbG9yOiBhbiBpbmxpbmUgY29sb3IgYmVhdHMgZXZlcnlcbiAgICAvLyBzdHlsZXNoZWV0IHJ1bGUsIGFuZCB0aGUgYWNjZW50IGNvbG9yIG9uIGhvdmVyICgudHlwLXNlYXJjaGFibGUpIHdvdWxkXG4gICAgLy8gbmVlZCAhaW1wb3J0YW50LlxuICAgIGlmICh0aXRsZUNvbG9yKSB0aXRsZUVsLnN0eWxlLnNldFByb3BlcnR5KFwiLS10eXAtbmFtZS1jb2xvclwiLCB0aXRsZUNvbG9yKTtcbiAgICB0aGlzLm1ha2VTZWFyY2hhYmxlKHRpdGxlRWwsICgpID0+IHRoaXMub3BlblNlYXJjaCh0eXApKTtcblxuICAgIGNvbnN0IHsgY291bnRzIH0gPSB0aGlzLnBsdWdpbi50eXBJbmRleC50eXBDb3VudHMoKTtcbiAgICBoZWFkZXIuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtZGV0YWlsLWNvdW50XCIsIHRleHQ6IFN0cmluZyhjb3VudHMuZ2V0KHR5cCkgPz8gMCkgfSk7XG5cbiAgICAvLyBMZWZ0IG9mIHRoZSBwbGFpbiByZW5hbWUgYnV0dG9uLCBoaWdobGlnaHRlZCBpbiBhY2NlbnQgY29sb3I6IHRoaXMgb25lXG4gICAgLy8gYWxzbyByZXdyaXRlcyB0aGUgVFlQIG9mIGV2ZXJ5IGFmZmVjdGVkIG5vdGUgKGFmdGVyIGNvbmZpcm1hdGlvbiwgc2VlXG4gICAgLy8gc3RhcnREZXRhaWxSZW5hbWUpLlxuICAgIGNvbnN0IHJlbmFtZVdpdGhOb3Rlc0J0biA9IGhlYWRlci5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1kZXRhaWwtcmVuYW1lLW5vdGVzXCIsXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlJlbmFtZSBhbmQgdXBkYXRlIG5vdGVzXCIgfSxcbiAgICB9KTtcbiAgICBzZXRJY29uKHJlbmFtZVdpdGhOb3Rlc0J0biwgXCJwZW5jaWxcIik7XG4gICAgcmVuYW1lV2l0aE5vdGVzQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnN0YXJ0RGV0YWlsUmVuYW1lKHR5cCwgdGl0bGVFbCwgeyB1cGRhdGVOb3RlczogdHJ1ZSB9KSk7XG5cbiAgICBjb25zdCByZW5hbWVCdG4gPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1kZXRhaWwtcmVuYW1lXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiUmVuYW1lXCIgfSB9KTtcbiAgICBzZXRJY29uKHJlbmFtZUJ0biwgXCJwZW5jaWxcIik7XG4gICAgcmVuYW1lQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnN0YXJ0RGV0YWlsUmVuYW1lKHR5cCwgdGl0bGVFbCkpO1xuXG4gICAgLy8gQmV0d2VlbiByZW5hbWUgYW5kIGRlbGV0ZSwgaW4gdGhlIHNhbWUgc3BvdCBhcyBmb3IgYSBTdWJ0eXAgKHNlZVxuICAgIC8vIHJlbmRlclNlY3Rpb25Gb290ZXIpLlxuICAgIHRoaXMucmVuZGVyTWFudWFsVG9nZ2xlKGhlYWRlciwgdHlwKTtcblxuICAgIGNvbnN0IGRlbGV0ZUJ0biA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWRldGFpbC1kZWxldGVcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJEZWxldGVcIiB9IH0pO1xuICAgIHNldEljb24oZGVsZXRlQnRuLCBcInRyYXNoXCIpO1xuICAgIGRlbGV0ZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5zaG93RGVsZXRlQ29uZmlybSh0eXApKTtcblxuICAgIGNvbnN0IGJvZHkgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1kZXRhaWwtYm9keVwiIH0pO1xuXG4gICAgLy8gT25lIHJvdyBiZWxvdyB0aGUgaGVhZGVyOiB0aGUgVFlQIGNvbG9yIG9uIHRoZSBsZWZ0LCB0aGUgZGVzY3JpcHRpb25cbiAgICAvLyBmaWxsaW5nIHRoZSByZXN0LlxuICAgIGNvbnN0IG9wdGlvbnNIZWFkZXIgPSBib2R5LmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZnJvbnRtYXR0ZXItaGVhZGVyIHR5cC1vcHRpb25zLWhlYWRlclwiIH0pO1xuXG4gICAgY29uc3QgY29sb3JSb3cgPSBvcHRpb25zSGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZGV0YWlsLWNvbG9yLXJvd1wiIH0pO1xuICAgIHRoaXMucmVuZGVyQ29sb3JQaWNrZXIoXG4gICAgICBjb2xvclJvdyxcbiAgICAgIHR5cCxcbiAgICAgIChuZXdDb2xvcikgPT4ge1xuICAgICAgICBpZiAoIXRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdCkgcmV0dXJuO1xuICAgICAgICAvLyBTYW1lIGN1c3RvbSBwcm9wZXJ0eSBhcyBhYm92ZSwgbm90IHN0eWxlLmNvbG9yIChzZWUgdGhlcmUpLlxuICAgICAgICB0aXRsZUVsLnN0eWxlLnNldFByb3BlcnR5KFwiLS10eXAtbmFtZS1jb2xvclwiLCBuZXdDb2xvcik7XG4gICAgICB9LFxuICAgICAgeyBzaG93UmVzZXQ6IHRydWUgfVxuICAgICk7XG5cbiAgICAvLyBTaW5nbGUtbGluZSBpbnB1dCBuZXh0IHRvIHRoZSBjb2xvciwgbGlrZSB0aGUgb25lIGluIHRoZSBUWVAtTGlzdC4gTm9cbiAgICAvLyBoZWFkaW5nOiB3aGlsZSBlbXB0eSwgaXRzIGZhZGVkIHBsYWNlaG9sZGVyIHNheXMgd2hhdCBpdCBpcy5cbiAgICBjb25zdCBkZXNjSW5wdXQgPSBvcHRpb25zSGVhZGVyLmNyZWF0ZUVsKFwiaW5wdXRcIiwge1xuICAgICAgdHlwZTogXCJ0ZXh0XCIsXG4gICAgICBjbHM6IFwidHlwLWRlc2NyaXB0aW9uLWlucHV0XCIsXG4gICAgICBhdHRyOiB7IHBsYWNlaG9sZGVyOiBcIkRlc2NyaXB0aW9uXCIgfSxcbiAgICB9KTtcbiAgICBkZXNjSW5wdXQudmFsdWUgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBEZXNjcmlwdGlvbnNbdHlwXSA/PyBcIlwiO1xuICAgIGRlc2NJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gZGVzY0lucHV0LnZhbHVlLnRyaW0oKTtcbiAgICAgIGlmICh2YWx1ZSkgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRGVzY3JpcHRpb25zW3R5cF0gPSB2YWx1ZTtcbiAgICAgIGVsc2UgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlc2NyaXB0aW9uc1t0eXBdO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgfSk7XG5cbiAgICAvLyBTZXBhcmF0ZXMgdGhlIGZyb250bWF0dGVyIGJsb2NrcyBmcm9tIHRoZSBUWVAncyBvdGhlciBzZXR0aW5ncy5cbiAgICBib2R5LmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZGV0YWlsLXNlcGFyYXRvclwiIH0pO1xuXG4gICAgLy8gVFlQLUZyb250bWF0dGVyIGFuZCBvbmUgYmxvY2sgcGVyIHJlZ2lzdGVyZWQgU3VidHlwIGJlbG93LCBlYWNoIHdpdGggaXRzXG4gICAgLy8gb3duIGVkaXRvciAoc2VlIGZyb250bWF0dGVyLWJsb2Nrcy5qcyksIHNvIHRoZSBzYW1lIGtleSBtYXkgYXBwZWFyIGluXG4gICAgLy8gc2V2ZXJhbCBibG9ja3MuIEEgU3VidHlwIGJsb2NrIGFkZHMgdG8gdGhlIFRZUC1Gcm9udG1hdHRlciBmb3Igbm90ZXMgd2l0aFxuICAgIC8vIHRoYXQgU1VCVFlQIGFuZCBvdmVycmlkZXMgc2FtZS1uYW1lZCBwcm9wZXJ0aWVzIChzZWUgc3VidHlwcy5qcykuXG4gICAgY29uc3QgYnVja2V0ID0gdGhpcy5wbHVnaW4udHlwSW5kZXguc3VidHlwQnVja2V0KHR5cCk7XG4gICAgdGhpcy5mcm9udG1hdHRlckJsb2NrcyA9IG1vdW50RnJvbnRtYXR0ZXJCbG9ja3ModGhpcywgYm9keSwgdHlwLCB7XG4gICAgICByZW5kZXJIZWFkZXI6IChzZWN0aW9uLCBlbCwgYmxvY2tzKSA9PiB0aGlzLnJlbmRlclNlY3Rpb25IZWFkZXIoZWwsIHR5cCwgc2VjdGlvbiwgYnVja2V0LCBibG9ja3MpLFxuICAgICAgcmVuZGVyRm9vdGVyOiAoc2VjdGlvbiwgZWwpID0+IHtcbiAgICAgICAgaWYgKHNlY3Rpb24gIT09IG51bGwpIHRoaXMucmVuZGVyU2VjdGlvbkZvb3RlcihlbCwgdHlwLCBzZWN0aW9uKTtcbiAgICAgIH0sXG4gICAgICBvbk1vdmVTZWN0aW9uOiBhc3luYyAob3JkZXIpID0+IHtcbiAgICAgICAgcmVvcmRlclN1YnR5cHModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgb3JkZXIpO1xuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgdGhpcy5mcm9udG1hdHRlckVkaXRvcnMucHVzaCguLi50aGlzLmZyb250bWF0dGVyQmxvY2tzLmVkaXRvcnMpO1xuXG4gICAgLy8gRnVsbCB3aWR0aCBhbmQgYWNjZW50IGNvbG9yLCB0byBzdGFuZCBhcGFydCBmcm9tIHRoZSBibG9ja3MnIHNtYWxsIGljb25cbiAgICAvLyBidXR0b25zLlxuICAgIHRoaXMuc3VidHlwQWRkQnRuRWwgPSBib2R5LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgY2xzOiBcIm1vZC1jdGEgdHlwLXN1YnR5cC1hZGRcIiB9KTtcbiAgICBzZXRJY29uKHRoaXMuc3VidHlwQWRkQnRuRWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtc3VidHlwLWFkZC1pY29uXCIgfSksIFwicGx1c1wiKTtcbiAgICB0aGlzLnN1YnR5cEFkZEJ0bkVsLmNyZWF0ZVNwYW4oeyB0ZXh0OiBcIkFkZCBTdWJ0eXBcIiB9KTtcbiAgICB0aGlzLnN1YnR5cEFkZEJ0bkVsLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnN0YXJ0QWRkU3VidHlwKHR5cCkpO1xuXG4gICAgdGhpcy5yZW5kZXJVbnJlZ2lzdGVyZWRTdWJ0eXBzKGJvZHksIHR5cCwgYnVja2V0KTtcblxuICAgIGJvZHkuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1kZXRhaWwtc2VwYXJhdG9yXCIgfSk7XG4gICAgdGhpcy5yZW5kZXJGbG9hdGluZ0hpbnQoYm9keSk7XG4gICAgLy8gVGhlIGJvbGQgbWFya3MgKGZyb250bWF0dGVyLWRlZmF1bHQtaGlnaGxpZ2h0LmpzKSBvbmx5IHJlYWN0IHRvIG1ldGFkYXRhXG4gICAgLy8gYW5kIGxheW91dCBldmVudHM7IG9wZW5pbmcgdGhpcyB2aWV3IGZpcmVzIG5vbmUsIHNvIHJlZnJlc2ggaGVyZS4gT25seVxuICAgIC8vIHRoaXMgb25lIHJlZnJlc2gsIG5vdCB0aGUgZnVsbCByZWZyZXNoVHlwQ29sb3JzKCksIHdoaWNoIHdvdWxkIGNhbGxcbiAgICAvLyByZW5kZXIoKSBvbiB0aGlzIHZpZXcgd2hpbGUgaXQgaXMgc3RpbGwgcmVuZGVyaW5nLlxuICAgIHRoaXMucGx1Z2luLnJlZnJlc2hGcm9udG1hdHRlckhpZ2hsaWdodD8uKCk7XG4gIH1cblxuICAvLyBBIGJsb2NrJ3MgaGVhZGluZyAoc2VlIGZyb250bWF0dGVyLWJsb2Nrcy5qcyk6IHRpdGxlIHdpdGggbm90ZSBjb3VudCAoZm9yXG4gIC8vIHRoZSBUWVAtRnJvbnRtYXR0ZXIgdGhlIG5vdGVzIHdpdGhvdXQgU1VCVFlQLCB0aGUgb25seSBvbmVzIGl0IGFwcGxpZXMgdG9cbiAgLy8gYWxvbmUpLCBzZWFyY2ggb24gY2xpY2ssIGFuZCB0aGUgdHdvIGFkZCBidXR0b25zIGZvciBhIGJsYW5rIHJvdyBpbiB0aGlzXG4gIC8vIGJsb2NrLlxuICByZW5kZXJTZWN0aW9uSGVhZGVyKGVsLCB0eXAsIHNlY3Rpb24sIGJ1Y2tldCwgYmxvY2tzKSB7XG4gICAgY29uc3QgdGl0bGVHcm91cCA9IGVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZnJvbnRtYXR0ZXItdGl0bGUtZ3JvdXBcIiB9KTtcbiAgICAvLyBOZXZlciBjb2xvcmVkLCB1bmxpa2UgdGhlIGRldGFpbCB0aXRsZSBhYm92ZTogYSBibG9jaydzIGNvbG9yIHNpdHMgaW5cbiAgICAvLyBpdHMgZm9vdGVyIGRvdCAoc2VlIHJlbmRlclNlY3Rpb25Gb290ZXIpLlxuICAgIGNvbnN0IHRpdGxlRWwgPSB0aXRsZUdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZGV0YWlsLXNlY3Rpb24tdGl0bGVcIiwgdGV4dDogc2VjdGlvbiA/PyBgJHt0eXB9LUZyb250bWF0dGVyYCB9KTtcbiAgICBjb25zdCBjb3VudCA9IHNlY3Rpb24gPT09IG51bGwgPyBidWNrZXQubm9TdWJ0eXAgOiBidWNrZXQuY291bnRzLmdldChzZWN0aW9uKSA/PyAwO1xuICAgIHRpdGxlR3JvdXAuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtc3VidHlwLWNvdW50XCIsIHRleHQ6IFN0cmluZyhjb3VudCkgfSk7XG4gICAgdGhpcy5tYWtlU2VhcmNoYWJsZSh0aXRsZUVsLCAoKSA9PiB0aGlzLm9wZW5TdWJ0eXBTZWFyY2godHlwLCBzZWN0aW9uKSk7XG5cbiAgICAvLyBGbG9hdGluZyBwcm9wZXJ0aWVzIHNoYXJlIHRoZSBsaXN0IGFuZCBvcmRlciBvZiB0aGUgb3RoZXJzICh3aGljaFxuICAgIC8vIGZyb250bWF0dGVyIHNvcnRpbmcgcmVsaWVzIG9uKSwgc28gdGhleSBsYW5kIHdoZXJldmVyIGRyYWcgJiBkcm9wIHB1dHNcbiAgICAvLyB0aGVtIGluc3RlYWQgb2YgYXQgdGhlIGVuZCBvZiBhIHNlY29uZCBsaXN0LlxuICAgIGNvbnN0IGFkZEJ1dHRvbnMgPSBlbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLWFkZC1ncm91cFwiIH0pO1xuXG4gICAgLy8gTGVmdCBvZiB0aGUgcGxhaW4gYnV0dG9uLCBpbiBhY2NlbnQgY29sb3I6IG1hcmtzIHRoZSBuZXh0IGFkZGVkIChvcixcbiAgICAvLyB1bnRpbCBzYXZlZCwgcmVuYW1lZCkgcHJvcGVydHkgYXMgZmxvYXRpbmcgKHNlZVxuICAgIC8vIGVkaXRvci50eXBQZW5kaW5nRmxvYXRpbmdBZGQpLiBGbG9hdGluZyBwcm9wZXJ0aWVzIGFyZW4ndCBjcmVhdGVkIGZvciBuZXdcbiAgICAvLyBub3RlcyAoc2VlIGdldFR5cERlZmF1bHRzKCkpIGFuZCBzaG93IGluIGl0YWxpY3Mgd2hlcmUgcHJlc2VudC5cbiAgICBjb25zdCBhZGRGbG9hdGluZ1Byb3BlcnR5QnRuID0gYWRkQnV0dG9ucy5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1mcm9udG1hdHRlci1hZGQtZmxvYXRpbmdcIixcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiQWRkIGZsb2F0aW5nIHByb3BlcnR5XCIgfSxcbiAgICB9KTtcbiAgICBzZXRJY29uKGFkZEZsb2F0aW5nUHJvcGVydHlCdG4sIFwicGx1c1wiKTtcbiAgICBhZGRGbG9hdGluZ1Byb3BlcnR5QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiBibG9ja3MuYWRkQmxhbmsoc2VjdGlvbiwgdHJ1ZSkpO1xuXG4gICAgY29uc3QgYWRkUHJvcGVydHlCdG4gPSBhZGRCdXR0b25zLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWZyb250bWF0dGVyLWFkZFwiLFxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJBZGQgcHJvcGVydHlcIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24oYWRkUHJvcGVydHlCdG4sIFwicGx1c1wiKTtcbiAgICBhZGRQcm9wZXJ0eUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gYmxvY2tzLmFkZEJsYW5rKHNlY3Rpb24sIGZhbHNlKSk7XG4gIH1cblxuICAvLyBGb290ZXIgb2YgYSBTdWJ0eXAgYmxvY2s6IG9uIHRoZSBsZWZ0IHRoZSBTdWJ0eXAgY29sb3IgKGEgZG90IG9wZW5pbmcgdGhlXG4gIC8vIHNsaWRlcnMsIHJlc2V0IG5leHQgdG8gaXQpLCBvbiB0aGUgcmlnaHQgdGhlIHNhbWUgYWN0aW9ucyBpbiB0aGUgc2FtZSBvcmRlclxuICAvLyBhcyB0aGUgZGV0YWlsIGhlYWRlciAocmVuYW1lIGFuZCB1cGRhdGUgbm90ZXMsIHJlbmFtZSwgbWFudWFsbHkgY3JlYXRhYmxlLFxuICAvLyBkZWxldGUpLiBUaGUgVFlQLUZyb250bWF0dGVyIGhhcyBubyBmb290ZXIuIFRoZSB0aXRsZSBpcyBsb29rZWQgdXAgb25cbiAgLy8gY2xpY2sgLSBoZWFkaW5nIGFuZCBmb290ZXIgYXJlIHJlYnVpbHQgb24gZXZlcnkgc3luY2hyb25pemUoKS5cbiAgcmVuZGVyU2VjdGlvbkZvb3RlcihlbCwgdHlwLCBzdWJ0eXApIHtcbiAgICBlbC5hZGRDbGFzcyhcInR5cC1zdWJ0eXAtYWN0aW9uc1wiKTtcbiAgICBjb25zdCBjb2xvckdyb3VwID0gZWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zdWJ0eXAtY29sb3ItZ3JvdXBcIiB9KTtcbiAgICAvLyBBIHJpbmcgYWxzbyB3aGlsZSB0aGUgVFlQIGl0c2VsZiBoYXMgbm8gY29sb3IgLSB0aGVuIGFuIG9mZnNldCBjb2xvcnNcbiAgICAvLyBub3RoaW5nIGFueXdoZXJlLlxuICAgIGNvbnN0IG93bkNvbG9yID0gc3VidHlwSGFzT3duQ29sb3IodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKTtcbiAgICBjb25zdCB0eXBIYXNDb2xvciA9ICEhdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF07XG4gICAgY29uc3QgY29sb3JEb3QgPSBjb2xvckdyb3VwLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwidHlwLXN1YnR5cC1jb2xvci1kb3RcIixcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6ICF0eXBIYXNDb2xvciA/IFwiVFlQIGhhcyBubyBjb2xvclwiIDogb3duQ29sb3IgPyBcIkFkanVzdCBjb2xvclwiIDogXCJVc2VzIFRZUCBjb2xvclwiIH0sXG4gICAgfSk7XG4gICAgY29sb3JEb3QudHlwU3VidHlwID0gc3VidHlwO1xuICAgIHBhaW50Q29sb3JEb3QoY29sb3JEb3QsIHN1YnR5cENvbG9yKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCkgPz8gREVGQVVMVF9UWVBfQ09MT1IsICFvd25Db2xvciB8fCAhdHlwSGFzQ29sb3IpO1xuICAgIGNvbG9yRG90LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLm9wZW5TdWJ0eXBDb2xvclBvcG92ZXIoY29sb3JEb3QsIHR5cCwgc3VidHlwKSk7XG4gICAgY29uc3QgcmVzZXRCdG4gPSBjb2xvckdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtY29sb3ItcmVzZXRcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJSZXNldCBjb2xvclwiIH0gfSk7XG4gICAgcmVzZXRCdG4udG9nZ2xlQ2xhc3MoXCJpcy1kaXNhYmxlZFwiLCAhb3duQ29sb3IpO1xuICAgIHNldEljb24ocmVzZXRCdG4sIFwicm90YXRlLWNjd1wiKTtcbiAgICByZXNldEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZGF0YSA9IGdldFN1YnR5cCh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApO1xuICAgICAgaWYgKCFkYXRhPy5jb2xvcikgcmV0dXJuO1xuICAgICAgZGVsZXRlIGRhdGEuY29sb3I7XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICB9KTtcblxuICAgIGNvbnN0IGFjdGlvbnMgPSBlbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLXN1YnR5cC1hY3Rpb24tZ3JvdXBcIiB9KTtcbiAgICBjb25zdCB0aXRsZUVsID0gKCkgPT4ge1xuICAgICAgbGV0IHNpYmxpbmcgPSBlbC5wcmV2aW91c0VsZW1lbnRTaWJsaW5nO1xuICAgICAgd2hpbGUgKHNpYmxpbmcgJiYgIXNpYmxpbmcuaGFzQ2xhc3MoXCJ0eXAtc2VjdGlvbi1oZWFkZXJcIikpIHNpYmxpbmcgPSBzaWJsaW5nLnByZXZpb3VzRWxlbWVudFNpYmxpbmc7XG4gICAgICByZXR1cm4gc2libGluZz8ucXVlcnlTZWxlY3RvcihcIi50eXAtZGV0YWlsLXNlY3Rpb24tdGl0bGVcIikgPz8gbnVsbDtcbiAgICB9O1xuICAgIGNvbnN0IHJlbmFtZSA9ICh1cGRhdGVOb3RlcykgPT4ge1xuICAgICAgY29uc3QgdGFyZ2V0ID0gdGl0bGVFbCgpO1xuICAgICAgaWYgKHRhcmdldCkgdGhpcy5zdGFydFN1YnR5cFJlbmFtZSh0eXAsIHN1YnR5cCwgdGFyZ2V0LCB7IHVwZGF0ZU5vdGVzIH0pO1xuICAgIH07XG5cbiAgICBjb25zdCByZW5hbWVXaXRoTm90ZXNCdG4gPSBhY3Rpb25zLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWRldGFpbC1yZW5hbWUtbm90ZXNcIixcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiUmVuYW1lIGFuZCB1cGRhdGUgbm90ZXNcIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24ocmVuYW1lV2l0aE5vdGVzQnRuLCBcInBlbmNpbFwiKTtcbiAgICByZW5hbWVXaXRoTm90ZXNCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHJlbmFtZSh0cnVlKSk7XG5cbiAgICBjb25zdCByZW5hbWVCdG4gPSBhY3Rpb25zLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtZGV0YWlsLXJlbmFtZVwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlJlbmFtZVwiIH0gfSk7XG4gICAgc2V0SWNvbihyZW5hbWVCdG4sIFwicGVuY2lsXCIpO1xuICAgIHJlbmFtZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gcmVuYW1lKGZhbHNlKSk7XG5cbiAgICB0aGlzLnJlbmRlclN1YnR5cE1hbnVhbFRvZ2dsZShhY3Rpb25zLCB0eXAsIHN1YnR5cCk7XG5cbiAgICBjb25zdCBkZWxldGVCdG4gPSBhY3Rpb25zLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtZGV0YWlsLWRlbGV0ZVwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkRlbGV0ZVwiIH0gfSk7XG4gICAgc2V0SWNvbihkZWxldGVCdG4sIFwidHJhc2hcIik7XG4gICAgZGVsZXRlQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmRlbGV0ZVN1YnR5cFdpdGhDb25maXJtKHR5cCwgc3VidHlwKSk7XG4gIH1cblxuICAvLyBQb3BvdmVyIGJlbG93IGEgU3VidHlwIGJsb2NrJ3MgZG90OiBvbmUgc2xpZGVyIHBlciBjaGFubmVsLCBsaW1pdGVkIHRvIHRoZVxuICAvLyByYW5nZSBmcm9tIHRoZSBzZXR0aW5ncyAoc2VlIHR5cC1jb2xvcnMuanMpLCBlYWNoIHRyYWNrIHNob3dpbmcgdGhlIGNvbG9yc1xuICAvLyBpdCBjYW4gcmVhY2guIERyYWdnaW5nIG9ubHkgdXBkYXRlcyB0aGUgZG90IGhlcmU7IHNhdmluZyBhbmQgdXBkYXRpbmcgdGhlXG4gIC8vIG90aGVyIHZpZXdzIGhhcHBlbnMgb24gY2xvc2UgKGNsaWNrIG91dHNpZGUgb3IgRXNjYXBlKSwgc2luY2VcbiAgLy8gcmVmcmVzaFR5cENvbG9ycygpIHJlLXJlbmRlcnMgdGhpcyB2aWV3IGFtb25nIG90aGVycy5cbiAgb3BlblN1YnR5cENvbG9yUG9wb3ZlcihhbmNob3JFbCwgdHlwLCBzdWJ0eXApIHtcbiAgICB0aGlzLmNsb3NlU3VidHlwQ29sb3JQb3BvdmVyPy4oKTtcbiAgICBjb25zdCB7IHNldHRpbmdzIH0gPSB0aGlzLnBsdWdpbjtcbiAgICBjb25zdCBkYXRhID0gZ2V0U3VidHlwKHNldHRpbmdzLCB0eXAsIHN1YnR5cCk7XG4gICAgaWYgKCFkYXRhKSByZXR1cm47XG4gICAgY29uc3QgdHlwQ29sb3IgPSBzZXR0aW5ncy50eXBDb2xvcnNbdHlwXSA/PyBERUZBVUxUX1RZUF9DT0xPUjtcbiAgICAvLyBXaXRob3V0IGFuIG9mZnNldCBldmVyeSBzbGlkZXIgc3RhcnRzIGF0IDA7IFNVQlRZUF9DT0xPUl9DSEFOTkVMUyBhbG9uZVxuICAgIC8vIHNheXMgd2hpY2ggZXhpc3QuXG4gICAgY29uc3Qgb2Zmc2V0ID0gY2xhbXBlZE9mZnNldChzZXR0aW5ncywgZGF0YS5jb2xvcikgPz8gT2JqZWN0LmZyb21FbnRyaWVzKFNVQlRZUF9DT0xPUl9DSEFOTkVMUy5tYXAoKHsga2V5IH0pID0+IFtrZXksIDBdKSk7XG4gICAgY29uc3QgZG9jID0gYW5jaG9yRWwuZG9jO1xuICAgIGNvbnN0IHBvcG92ZXIgPSBkb2MuYm9keS5jcmVhdGVEaXYoeyBjbHM6IFwibWVudSB0eXAtc3VidHlwLWNvbG9yLXBvcG92ZXJcIiB9KTtcblxuICAgIGNvbnN0IHJvd3MgPSBbXTtcbiAgICBjb25zdCB1cGRhdGUgPSAoKSA9PiB7XG4gICAgICBjb25zdCBjb2xvciA9IGFwcGx5Q29sb3JPZmZzZXQodHlwQ29sb3IsIG9mZnNldCk7XG4gICAgICBmb3IgKGNvbnN0IGVsIG9mIHRoaXMuY29udGVudEVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIudHlwLXN1YnR5cC1jb2xvci1kb3RcIikpIHtcbiAgICAgICAgaWYgKGVsLnR5cFN1YnR5cCA9PT0gc3VidHlwKSBwYWludENvbG9yRG90KGVsLCBjb2xvciwgIWhhc0NvbG9yT2Zmc2V0KG9mZnNldCkgfHwgIXNldHRpbmdzLnR5cENvbG9yc1t0eXBdKTtcbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHJvdygpO1xuICAgIH07XG5cbiAgICBmb3IgKGNvbnN0IHsga2V5LCBsYWJlbCwgdW5pdCB9IG9mIFNVQlRZUF9DT0xPUl9DSEFOTkVMUykge1xuICAgICAgY29uc3QgW21pbiwgbWF4XSA9IGNoYW5uZWxCb3VuZHMoc2V0dGluZ3MsIGtleSk7XG4gICAgICBjb25zdCByb3cgPSBwb3BvdmVyLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtc3VidHlwLWNvbG9yLXJvd1wiIH0pO1xuICAgICAgcm93LmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXN1YnR5cC1jb2xvci1sYWJlbFwiLCB0ZXh0OiBsYWJlbCB9KTtcbiAgICAgIGNvbnN0IGlucHV0ID0gcm93LmNyZWF0ZUVsKFwiaW5wdXRcIiwgeyB0eXBlOiBcInJhbmdlXCIsIGNsczogXCJzbGlkZXIgdHlwLXN1YnR5cC1jb2xvci1zbGlkZXJcIiB9KTtcbiAgICAgIGlucHV0Lm1pbiA9IFN0cmluZyhtaW4pO1xuICAgICAgaW5wdXQubWF4ID0gU3RyaW5nKG1heCk7XG4gICAgICBpbnB1dC5zdGVwID0gXCIxXCI7XG4gICAgICBpbnB1dC52YWx1ZSA9IFN0cmluZyhvZmZzZXRba2V5XSk7XG4gICAgICBpbnB1dC5kaXNhYmxlZCA9IG1pbiA9PT0gbWF4O1xuICAgICAgY29uc3QgdmFsdWVFbCA9IHJvdy5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1zdWJ0eXAtY29sb3ItdmFsdWVcIiB9KTtcbiAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJpbnB1dFwiLCAoKSA9PiB7XG4gICAgICAgIG9mZnNldFtrZXldID0gTnVtYmVyKGlucHV0LnZhbHVlKTtcbiAgICAgICAgdXBkYXRlKCk7XG4gICAgICB9KTtcbiAgICAgIHJvd3MucHVzaCgoKSA9PiB7XG4gICAgICAgIGNvbnN0IHN0ZXBzID0gODtcbiAgICAgICAgY29uc3Qgc3RvcHMgPSBbXTtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPD0gc3RlcHM7IGkrKykge1xuICAgICAgICAgIHN0b3BzLnB1c2goYXBwbHlDb2xvck9mZnNldCh0eXBDb2xvciwgeyAuLi5vZmZzZXQsIFtrZXldOiBtaW4gKyAoKG1heCAtIG1pbikgKiBpKSAvIHN0ZXBzIH0pKTtcbiAgICAgICAgfVxuICAgICAgICBpbnB1dC5zdHlsZS5zZXRQcm9wZXJ0eShcIi0tdHlwLXRyYWNrXCIsIGBsaW5lYXItZ3JhZGllbnQodG8gcmlnaHQsICR7c3RvcHMuam9pbihcIiwgXCIpfSlgKTtcbiAgICAgICAgdmFsdWVFbC5zZXRUZXh0KGAke29mZnNldFtrZXldID4gMCA/IFwiK1wiIDogXCJcIn0ke29mZnNldFtrZXldfSR7dW5pdH1gKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICB1cGRhdGUoKTtcblxuICAgIC8vIEJlbG93IHRoZSBkb3QsIGJ1dCBpbnNpZGUgdGhlIHdpbmRvdy5cbiAgICBjb25zdCByZWN0ID0gYW5jaG9yRWwuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgY29uc3Qgd2luID0gZG9jLmRlZmF1bHRWaWV3O1xuICAgIGNvbnN0IHdpZHRoID0gcG9wb3Zlci5vZmZzZXRXaWR0aDtcbiAgICBjb25zdCBoZWlnaHQgPSBwb3BvdmVyLm9mZnNldEhlaWdodDtcbiAgICBwb3BvdmVyLnN0eWxlLmxlZnQgPSBgJHtNYXRoLm1heCg4LCBNYXRoLm1pbihyZWN0LmxlZnQsIHdpbi5pbm5lcldpZHRoIC0gd2lkdGggLSA4KSl9cHhgO1xuICAgIHBvcG92ZXIuc3R5bGUudG9wID0gYCR7cmVjdC5ib3R0b20gKyA2ICsgaGVpZ2h0ID4gd2luLmlubmVySGVpZ2h0IC0gOCA/IHJlY3QudG9wIC0gNiAtIGhlaWdodCA6IHJlY3QuYm90dG9tICsgNn1weGA7XG5cbiAgICBjb25zdCBvblBvaW50ZXJEb3duID0gKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoIXBvcG92ZXIuY29udGFpbnMoZXZlbnQudGFyZ2V0KSkgY2xvc2UoKTtcbiAgICB9O1xuICAgIGNvbnN0IG9uS2V5RG93biA9IChldmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmtleSAhPT0gXCJFc2NhcGVcIikgcmV0dXJuO1xuICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgY2xvc2UoKTtcbiAgICB9O1xuICAgIGNvbnN0IGNsb3NlID0gYXN5bmMgKCkgPT4ge1xuICAgICAgdGhpcy5jbG9zZVN1YnR5cENvbG9yUG9wb3ZlciA9IG51bGw7XG4gICAgICBkb2MucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNlZG93blwiLCBvblBvaW50ZXJEb3duLCB0cnVlKTtcbiAgICAgIGRvYy5yZW1vdmVFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCBvbktleURvd24sIHRydWUpO1xuICAgICAgcG9wb3Zlci5yZW1vdmUoKTtcbiAgICAgIGNvbnN0IGN1cnJlbnQgPSBnZXRTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgc3VidHlwKTtcbiAgICAgIGlmICghY3VycmVudCkgcmV0dXJuO1xuICAgICAgaWYgKGhhc0NvbG9yT2Zmc2V0KG9mZnNldCkpIGN1cnJlbnQuY29sb3IgPSB7IC4uLm9mZnNldCB9O1xuICAgICAgZWxzZSBkZWxldGUgY3VycmVudC5jb2xvcjtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICB0aGlzLnJlbmRlcigpO1xuICAgIH07XG4gICAgdGhpcy5jbG9zZVN1YnR5cENvbG9yUG9wb3ZlciA9IGNsb3NlO1xuICAgIGRvYy5hZGRFdmVudExpc3RlbmVyKFwibW91c2Vkb3duXCIsIG9uUG9pbnRlckRvd24sIHRydWUpO1xuICAgIGRvYy5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCBvbktleURvd24sIHRydWUpO1xuICB9XG5cbiAgLy8gRGVsZXRlcyB0aGUgU3VidHlwIGJsb2NrIHdpdGggaXRzIHByb3BlcnRpZXMuIE5vdGVzIGtlZXAgdGhlaXIgU1VCVFlQXG4gIC8vIHZhbHVlIChpdCB0aGVuIHNob3dzIGFzIHVucmVnaXN0ZXJlZCBiZWxvdyksIHNvIGNvbmZpcm1hdGlvbiBpcyBvbmx5XG4gIC8vIG5lZWRlZCB3aGVuIHByb3BlcnRpZXMgd291bGQgYmUgbG9zdC5cbiAgZGVsZXRlU3VidHlwV2l0aENvbmZpcm0odHlwLCBzdWJ0eXApIHtcbiAgICBjb25zdCBhcHBseSA9IGFzeW5jICgpID0+IHtcbiAgICAgIGRlbGV0ZVN1YnR5cCh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgfTtcbiAgICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXMoZ2V0U3VidHlwKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCk/LmZyb250bWF0dGVyID8/IHt9KS5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBcIlwiKTtcbiAgICBpZiAoa2V5cy5sZW5ndGggPT09IDApIHtcbiAgICAgIGFwcGx5KCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHsgcGx1Z2luIH0gPSB0aGlzO1xuICAgIG5ldyBDb25maXJtTW9kYWwodGhpcy5hcHAsIHtcbiAgICAgIHRpdGxlOiBbXG4gICAgICAgIFwiRGVsZXRlIFwiLFxuICAgICAgICBzdWJ0eXBOYW1lTm9kZShwbHVnaW4sIHR5cCwgc3VidHlwKSxcbiAgICAgICAgXCIgb2YgXCIsXG4gICAgICAgIHR5cE5hbWVOb2RlKHBsdWdpbiwgdHlwLCBwbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPz8gbnVsbCksXG4gICAgICAgIFwiP1wiLFxuICAgICAgXSxcbiAgICAgIGJvZHk6IFtcbiAgICAgICAga2V5cy5sZW5ndGggPT09IDFcbiAgICAgICAgICA/IGBJdHMgcHJvcGVydHkgJHtrZXlzWzBdfSB3aWxsIGJlIGxvc3QuYFxuICAgICAgICAgIDogYEl0cyAke2tleXMubGVuZ3RofSBwcm9wZXJ0aWVzICR7a2V5cy5qb2luKFwiLCBcIil9IHdpbGwgYmUgbG9zdC5gLFxuICAgICAgXSxcbiAgICAgIGNvbmZpcm1UZXh0OiBcIkRlbGV0ZVwiLFxuICAgICAgd2FybmluZzogdHJ1ZSxcbiAgICAgIGZvY3VzOiBcImNhbmNlbFwiLFxuICAgICAgb25Db25maXJtOiBhcHBseSxcbiAgICB9KS5vcGVuKCk7XG4gIH1cblxuICAvLyBMaWtlIHN0YXJ0RGV0YWlsUmVuYW1lKCksIG9uIGEgU3VidHlwIGJsb2NrJ3MgdGl0bGUuIFRoZSBibG9jayBrZWVwcyBpdHNcbiAgLy8gcG9zaXRpb247IHVwZGF0ZU5vdGVzOiB0cnVlIGFsc28gcmV3cml0ZXMgdGhlIFNVQlRZUCBvZiB0aGUgYWZmZWN0ZWQgbm90ZXNcbiAgLy8gYWZ0ZXIgY29uZmlybWF0aW9uLiBBbiBleGlzdGluZyBuYW1lIG9mZmVycyBhIG1lcmdlIGluc3RlYWQgKHdoaWNoIGFsd2F5c1xuICAvLyByZXdyaXRlcyB0aGUgbm90ZXMpLlxuICBzdGFydFN1YnR5cFJlbmFtZSh0eXAsIHN1YnR5cCwgdGl0bGVFbCwgeyB1cGRhdGVOb3RlcyA9IGZhbHNlIH0gPSB7fSkge1xuICAgIGlmICh0aGlzLmlzRWRpdGluZykgcmV0dXJuO1xuICAgIHRoaXMuaXNFZGl0aW5nID0gdHJ1ZTtcblxuICAgIHRpdGxlRWwuYWRkQ2xhc3MoXCJ0eXAtc3VidHlwLW5hbWUtaW5wdXRcIiwgXCJpcy1iZWluZy1yZW5hbWVkXCIpO1xuICAgIHRpdGxlRWwuc2V0QXR0cmlidXRlKFwiY29udGVudGVkaXRhYmxlXCIsIFwidHJ1ZVwiKTtcbiAgICB0aXRsZUVsLnNldEF0dHJpYnV0ZShcInNwZWxsY2hlY2tcIiwgXCJmYWxzZVwiKTtcbiAgICB0aXRsZUVsLmZvY3VzKCk7XG5cbiAgICBjb25zdCByYW5nZSA9IHRpdGxlRWwuZG9jLmNyZWF0ZVJhbmdlKCk7XG4gICAgcmFuZ2Uuc2VsZWN0Tm9kZUNvbnRlbnRzKHRpdGxlRWwpO1xuICAgIGNvbnN0IHNlbGVjdGlvbiA9IHRpdGxlRWwud2luLmdldFNlbGVjdGlvbigpO1xuICAgIHNlbGVjdGlvbi5yZW1vdmVBbGxSYW5nZXMoKTtcbiAgICBzZWxlY3Rpb24uYWRkUmFuZ2UocmFuZ2UpO1xuXG4gICAgY29uc3QgY291bnRPZiA9IChuYW1lKSA9PiB0aGlzLnBsdWdpbi50eXBJbmRleC5zdWJ0eXBCdWNrZXQodHlwKS5jb3VudHMuZ2V0KG5hbWUpID8/IDA7XG4gICAgY29uc3QgYXBwbHlSZW5hbWUgPSBhc3luYyAodmFsdWUsIHsgd2l0aE5vdGVzIH0pID0+IHtcbiAgICAgIHJlbmFtZVN1YnR5cCh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXAsIHZhbHVlKTtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgY29uc3QgcmVuYW1lZCA9IHdpdGhOb3RlcyA/IGF3YWl0IHJlbmFtZVN1YnR5cEluTm90ZXModGhpcy5wbHVnaW4sIHR5cCwgc3VidHlwLCB2YWx1ZSkgOiAwO1xuICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICBpZiAod2l0aE5vdGVzKSBuZXcgTm90aWNlKGBTdWJ0eXAgJHt2YWx1ZX06ICR7cGx1cmFsKHJlbmFtZWQsIFwibm90ZVwiKX0gdXBkYXRlZC5gKTtcbiAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgfTtcblxuICAgIGxldCBkb25lID0gZmFsc2U7XG4gICAgY29uc3QgZmluaXNoID0gYXN5bmMgKGNvbW1pdCkgPT4ge1xuICAgICAgaWYgKGRvbmUpIHJldHVybjtcbiAgICAgIGRvbmUgPSB0cnVlO1xuICAgICAgdGhpcy5pc0VkaXRpbmcgPSBmYWxzZTtcblxuICAgICAgY29uc3QgdmFsdWUgPSBub3JtYWxpemVTdWJ0eXBOYW1lKHRpdGxlRWwudGV4dENvbnRlbnQpO1xuICAgICAgaWYgKCFjb21taXQgfHwgIXZhbHVlIHx8IHZhbHVlID09PSBzdWJ0eXApIHtcbiAgICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBleGlzdGluZyA9IGdldFN1YnR5cE5hbWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXApLmZpbmQoXG4gICAgICAgIChuYW1lKSA9PiBuYW1lLnRvTG93ZXJDYXNlKCkgPT09IHZhbHVlLnRvTG93ZXJDYXNlKCkgJiYgbmFtZSAhPT0gc3VidHlwXG4gICAgICApO1xuICAgICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICAgIG5ldyBDb25maXJtTW9kYWwodGhpcy5hcHAsIHtcbiAgICAgICAgICB0aXRsZTogW1xuICAgICAgICAgICAgXCJNZXJnZSBcIixcbiAgICAgICAgICAgIHN1YnR5cE5hbWVOb2RlKHRoaXMucGx1Z2luLCB0eXAsIHN1YnR5cCksXG4gICAgICAgICAgICBcIiBpbnRvIFwiLFxuICAgICAgICAgICAgc3VidHlwTmFtZU5vZGUodGhpcy5wbHVnaW4sIHR5cCwgZXhpc3RpbmcpLFxuICAgICAgICAgICAgXCI/XCIsXG4gICAgICAgICAgXSxcbiAgICAgICAgICBib2R5OiBbXG4gICAgICAgICAgICBgJHtleGlzdGluZ30gYWxyZWFkeSBleGlzdHMgaW4gJHt0eXB9LiBgICtcbiAgICAgICAgICAgICAgYCR7cGx1cmFsKGNvdW50T2Yoc3VidHlwKSwgXCJub3RlXCIpfSAke2NvdW50T2Yoc3VidHlwKSA9PT0gMSA/IFwibW92ZXNcIiA6IFwibW92ZVwifSB0byBpdCwgYCArXG4gICAgICAgICAgICAgIGBhbmQgdGhlIHByb3BlcnRpZXMgb2YgJHtzdWJ0eXB9IG1vdmUgaW50byBpdHMgYmxvY2suYCxcbiAgICAgICAgICBdLFxuICAgICAgICAgIGNvbmZpcm1UZXh0OiBcIk1lcmdlXCIsXG4gICAgICAgICAgd2FybmluZzogdHJ1ZSxcbiAgICAgICAgICBmb2N1czogXCJjYW5jZWxcIixcbiAgICAgICAgICBvbkNvbmZpcm06IGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIG1lcmdlU3VidHlwcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXAsIGV4aXN0aW5nKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgY29uc3QgcmVuYW1lZCA9IGF3YWl0IHJlbmFtZVN1YnR5cEluTm90ZXModGhpcy5wbHVnaW4sIHR5cCwgc3VidHlwLCBleGlzdGluZyk7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoYFN1YnR5cCAke3N1YnR5cH0gbWVyZ2VkIGludG8gJHtleGlzdGluZ30sICR7cGx1cmFsKHJlbmFtZWQsIFwibm90ZVwiKX0gdXBkYXRlZC5gKTtcbiAgICAgICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICAgICAgfSxcbiAgICAgICAgICBvbkNhbmNlbDogKCkgPT4gdGhpcy5yZW5kZXIoKSxcbiAgICAgICAgfSkub3BlbigpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmICghdXBkYXRlTm90ZXMpIHtcbiAgICAgICAgYXdhaXQgYXBwbHlSZW5hbWUodmFsdWUsIHsgd2l0aE5vdGVzOiBmYWxzZSB9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgLy8gU2FtZSBjb2xvciBmb3Igb2xkIGFuZCBuZXcgbmFtZTogdGhlIG5ldyBvbmUgdGFrZXMgb3ZlciB0aGUgb2xkIG9uZSdzXG4gICAgICAvLyBvZmZzZXQgKHNlZSByZW5hbWVTdWJ0eXApLlxuICAgICAgbmV3IENvbmZpcm1Nb2RhbCh0aGlzLmFwcCwge1xuICAgICAgICB0aXRsZTogW1xuICAgICAgICAgIFwiUmVuYW1lIFwiLFxuICAgICAgICAgIHN1YnR5cE5hbWVOb2RlKHRoaXMucGx1Z2luLCB0eXAsIHN1YnR5cCksXG4gICAgICAgICAgXCIgdG8gXCIsXG4gICAgICAgICAgc3VidHlwTmFtZU5vZGUodGhpcy5wbHVnaW4sIHR5cCwgdmFsdWUsIHN1YnR5cCksXG4gICAgICAgICAgXCI/XCIsXG4gICAgICAgIF0sXG4gICAgICAgIGJvZHk6IFtgJHtwbHVyYWwoY291bnRPZihzdWJ0eXApLCBcIm5vdGVcIil9IHdpbGwgYmUgdXBkYXRlZC5gXSxcbiAgICAgICAgY29uZmlybVRleHQ6IFwiUmVuYW1lXCIsXG4gICAgICAgIGZvY3VzOiBcImNvbmZpcm1cIixcbiAgICAgICAgb25Db25maXJtOiAoKSA9PiBhcHBseVJlbmFtZSh2YWx1ZSwgeyB3aXRoTm90ZXM6IHRydWUgfSksXG4gICAgICAgIG9uQ2FuY2VsOiAoKSA9PiB0aGlzLnJlbmRlcigpLFxuICAgICAgfSkub3BlbigpO1xuICAgIH07XG5cbiAgICAvLyBLZWVwIGV2ZXJ5IGtleSBoZXJlOiB0aGUgdGl0bGUgc2l0cyBpbnNpZGUgT2JzaWRpYW4ncyBwcm9wZXJ0eSBlZGl0b3IsXG4gICAgLy8gd2hvc2Uga2V5Ym9hcmQgbmF2aWdhdGlvbiB3b3VsZCByZWFjdCB0b28gKEVzY2FwZSBhbHNvIGJlY2F1c2Ugb2YgdGhlXG4gICAgLy8gZGV0YWlsIHZpZXcsIHNlZSBvbk9wZW4pLlxuICAgIHRpdGxlRWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRW50ZXJcIikge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBmaW5pc2godHJ1ZSk7XG4gICAgICB9IGVsc2UgaWYgKGV2ZW50LmtleSA9PT0gXCJFc2NhcGVcIikge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBmaW5pc2goZmFsc2UpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHRpdGxlRWwuYWRkRXZlbnRMaXN0ZW5lcihcImJsdXJcIiwgKCkgPT4gZmluaXNoKHRydWUpKTtcbiAgfVxuXG4gIC8vIExpa2UgdGhlIHVucmVnaXN0ZXJlZCBlbnRyaWVzIG9mIHRoZSBUWVAtTGlzdDogU1VCVFlQIHZhbHVlcyBvZiB0aGlzIFRZUCdzXG4gIC8vIG5vdGVzIHRoYXQgaGF2ZSBubyBibG9jayB5ZXQgKG5vdGVzIHdpdGhvdXQgYW55IFNVQlRZUCBjb3VudCBmb3IgdGhlXG4gIC8vIFRZUC1Gcm9udG1hdHRlciBpbnN0ZWFkKS4gU2hvd24gbGlrZSBTdWJ0eXAgYmxvY2tzLCBidXQgb25seSBoZWFkaW5nIGFuZFxuICAvLyBjb3VudC4gQSBjbGljayBvbiB0aGUgYmxvY2sgcmVnaXN0ZXJzIHRoZSB2YWx1ZTsgYSBjbGljayBvbiB0aGUgbmFtZSBvcGVuc1xuICAvLyB0aGUgc2VhcmNoIGluc3RlYWQgLSBjaGVja2luZyB3aGF0IGEgdmFsdWUgaG9sZHMgYmVmb3JlIHJlZ2lzdGVyaW5nIGl0IGlzXG4gIC8vIHRoZSBjb21tb24gY2FzZS4gVGhlIG5hbWUgbGlnaHRzIHVwIGluIGFjY2VudCBjb2xvciBvbiBob3ZlciB0byBzaG93IGl0XG4gIC8vIGRvZXMgc29tZXRoaW5nIGRpZmZlcmVudCBmcm9tIHRoZSBhcmVhIGFyb3VuZCBpdC5cbiAgcmVuZGVyVW5yZWdpc3RlcmVkU3VidHlwcyhwYXJlbnQsIHR5cCwgYnVja2V0KSB7XG4gICAgY29uc3QgcmVnaXN0ZXJlZCA9IGdldFN1YnR5cE5hbWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXApO1xuICAgIGNvbnN0IHVucmVnaXN0ZXJlZCA9IFsuLi5idWNrZXQuY291bnRzLmtleXMoKV1cbiAgICAgIC5maWx0ZXIoKGtleSkgPT4gIXJlZ2lzdGVyZWQuaW5jbHVkZXMoa2V5KSlcbiAgICAgIC5zb3J0KChhLCBiKSA9PiBidWNrZXQuY291bnRzLmdldChiKSAtIGJ1Y2tldC5jb3VudHMuZ2V0KGEpIHx8IGEubG9jYWxlQ29tcGFyZShiKSk7XG4gICAgaWYgKHVucmVnaXN0ZXJlZC5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgIGNvbnN0IGxpc3RFbCA9IHBhcmVudC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLXN1YnR5cC11bnJlZ2lzdGVyZWQtbGlzdFwiIH0pO1xuICAgIGZvciAoY29uc3Qga2V5IG9mIHVucmVnaXN0ZXJlZCkge1xuICAgICAgY29uc3QgYmxvY2sgPSBsaXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci1ibG9jayB0eXAtc3VidHlwLWJsb2NrIHR5cC1zdWJ0eXAtdW5yZWdpc3RlcmVkXCIgfSk7XG4gICAgICBjb25zdCBoZWFkZXIgPSBibG9jay5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLWhlYWRlclwiIH0pO1xuICAgICAgY29uc3QgdGl0bGVHcm91cCA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLXRpdGxlLWdyb3VwXCIgfSk7XG4gICAgICBjb25zdCB0aXRsZUVsID0gdGl0bGVHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIsIHRleHQ6IGRpc3BsYXlUeXBLZXkoa2V5KSB9KTtcbiAgICAgIHRpdGxlR3JvdXAuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtc3VidHlwLWNvdW50XCIsIHRleHQ6IFN0cmluZyhidWNrZXQuY291bnRzLmdldChrZXkpKSB9KTtcbiAgICAgIGJsb2NrLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnJlZ2lzdGVyU3VidHlwKHR5cCwga2V5LCBidWNrZXQpKTtcbiAgICAgIC8vIHN0b3BQcm9wYWdhdGlvbiwgb3IgdGhlIHNhbWUgY2xpY2sgd291bGQgYWxzbyByZWdpc3RlciB0aGUgdmFsdWUgb25lXG4gICAgICAvLyBvbmx5IHdhbnRlZCB0byBsb29rIHVwLlxuICAgICAgdGhpcy5tYWtlU2VhcmNoYWJsZSh0aXRsZUVsLCAoKSA9PiB0aGlzLm9wZW5TdWJ0eXBTZWFyY2godHlwLCBrZXkpLCB7IHN0b3BQcm9wYWdhdGlvbjogdHJ1ZSB9KTtcbiAgICB9XG4gIH1cblxuICAvLyBBIG5hbWUgd2hvc2UgY2xpY2sgb3BlbnMgdGhlIHNlYXJjaDogcG9pbnRlciBjdXJzb3IgYW5kIGFjY2VudCBjb2xvciBvblxuICAvLyBob3ZlciAoLnR5cC1zZWFyY2hhYmxlKSwgc28gdGhlIHZpZXcgaXRzZWxmIHNob3dzIHdoZXJlIHNvbWV0aGluZyBoYXBwZW5zLlxuICAvLyBUaGUgbmFtZSBpcyB3aGVyZSBvbmUgZXhwZWN0cyBcInNob3cgbWUgdGhlc2Ugbm90ZXNcIi4gV2hpbGUgcmVuYW1pbmcsIHRoZVxuICAvLyBlbGVtZW50IGlzIGFuIGlucHV0IChpcy1iZWluZy1yZW5hbWVkKSBhbmQgYSBjbGljayBqdXN0IHBsYWNlcyB0aGUgY3Vyc29yLlxuICBtYWtlU2VhcmNoYWJsZShlbCwgb25TZWFyY2gsIHsgc3RvcFByb3BhZ2F0aW9uID0gZmFsc2UgfSA9IHt9KSB7XG4gICAgZWwuYWRkQ2xhc3MoXCJ0eXAtc2VhcmNoYWJsZVwiKTtcbiAgICBlbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoZWwuaGFzQ2xhc3MoXCJpcy1iZWluZy1yZW5hbWVkXCIpKSByZXR1cm47XG4gICAgICBpZiAoc3RvcFByb3BhZ2F0aW9uKSBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIG9uU2VhcmNoKCk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBzdWJ0eXBLZXkgPT09IG51bGwgbWVhbnMgbm90ZXMgb2YgdGhpcyBUWVAgd2l0aG91dCBTVUJUWVAuIEEgbGlzdCBoYXMgbm9cbiAgLy8gZXhhY3Qgc2VhcmNoIHN5bnRheCAoYXMgaW4gb3BlblNlYXJjaCgpKSwgc28gaXQgc2VhcmNoZXMgbm90ZXMgY2FycnlpbmcgYWxsXG4gIC8vIGl0cyBpdGVtcy5cbiAgb3BlblN1YnR5cFNlYXJjaCh0eXAsIHN1YnR5cEtleSkge1xuICAgIGNvbnN0IGdsb2JhbFNlYXJjaCA9IHRoaXMucGx1Z2luLmFwcC5pbnRlcm5hbFBsdWdpbnMuZ2V0UGx1Z2luQnlJZChcImdsb2JhbC1zZWFyY2hcIik7XG4gICAgaWYgKCFnbG9iYWxTZWFyY2gpIHJldHVybjtcbiAgICBjb25zdCB0eXBDbGF1c2UgPSB0aGlzLnR5cENsYXVzZSh0eXApO1xuICAgIGxldCBzdWJ0eXBDbGF1c2U7XG4gICAgaWYgKHN1YnR5cEtleSA9PT0gbnVsbCkge1xuICAgICAgc3VidHlwQ2xhdXNlID0gYC1bXCIke1NVQlRZUF9QUk9QRVJUWX1cIl1gO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCByYXcgPSB0aGlzLnBsdWdpbi50eXBJbmRleC5zdWJ0eXBCdWNrZXQodHlwKS5yYXdCeUtleS5nZXQoc3VidHlwS2V5KTtcbiAgICAgIHN1YnR5cENsYXVzZSA9IEFycmF5LmlzQXJyYXkocmF3KVxuICAgICAgICA/IHJhdy5tYXAoKHYpID0+IGBbXCIke1NVQlRZUF9QUk9QRVJUWX1cIjpcIiR7U3RyaW5nKHYgPz8gXCJcIikudHJpbSgpfVwiXWApLmpvaW4oXCIgXCIpXG4gICAgICAgIDogYFtcIiR7U1VCVFlQX1BST1BFUlRZfVwiOlwiJHtzdWJ0eXBLZXl9XCJdYDtcbiAgICB9XG4gICAgZ2xvYmFsU2VhcmNoLmluc3RhbmNlLm9wZW5HbG9iYWxTZWFyY2goYCR7dHlwQ2xhdXNlfSAke3N1YnR5cENsYXVzZX1gKTtcbiAgfVxuXG4gIC8vIExpa2UgcmVnaXN0ZXJUeXAoKTogcmVnaXN0ZXJzIHRoZSBjbGVhbmVkIGZvcm0gKHRpdGxlIGNhc2UsIGEgbGlzdCBhcyBvbmVcbiAgLy8gdmFsdWUgXCJBLCBCXCIpIGFzIGEgU3VidHlwIG9mIHRoaXMgVFlQIGFuZCByZXdyaXRlcyB0aGUgU1VCVFlQIG9mIHRoZVxuICAvLyBhZmZlY3RlZCBub3Rlcy4gSWYgdGhlIFN1YnR5cCBleGlzdHMgaW4gYW5vdGhlciBzcGVsbGluZywgdGhlIG5vdGVzIGdvXG4gIC8vIHRoZXJlLlxuICBhc3luYyByZWdpc3RlclN1YnR5cCh0eXAsIHN1YnR5cEtleSwgYnVja2V0KSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5hcHBseVN1YnR5cFJlZ2lzdHJhdGlvbih0eXAsIHN1YnR5cEtleSwgYnVja2V0KTtcbiAgICBpZiAoIXJlc3VsdCkgcmV0dXJuO1xuXG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgaWYgKHJlc3VsdC5yZW5hbWVkID4gMCkgbmV3IE5vdGljZShgU3VidHlwICR7cmVzdWx0LnN1YnR5cH0gcmVnaXN0ZXJlZCwgJHtwbHVyYWwocmVzdWx0LnJlbmFtZWQsIFwibm90ZVwiKX0gdXBkYXRlZC5gKTtcbiAgfVxuXG4gIC8vIExpa2UgYXBwbHlUeXBSZWdpc3RyYXRpb246IHRoZSBjb3JlIHdpdGhvdXQgc2F2aW5nIGFuZCBub3RpY2UsIHNvXG4gIC8vIHJlZ2lzdGVyVHlwV2l0aFN1YnR5cCgpIGNhbiBidW5kbGUgaXQuIFJldHVybnMgeyBzdWJ0eXAsIHJlbmFtZWQgfSBvciBudWxsLlxuICBhc3luYyBhcHBseVN1YnR5cFJlZ2lzdHJhdGlvbih0eXAsIHN1YnR5cEtleSwgYnVja2V0KSB7XG4gICAgY29uc3QgcmF3ID0gYnVja2V0LnJhd0J5S2V5LmdldChzdWJ0eXBLZXkpO1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVSYXdUeXAocmF3ID09PSB1bmRlZmluZWQgPyBzdWJ0eXBLZXkgOiByYXcsIG5vcm1hbGl6ZVN1YnR5cE5hbWUpO1xuICAgIGlmICghbm9ybWFsaXplZCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgZXhpc3RpbmcgPSBnZXRTdWJ0eXBOYW1lcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwKS5maW5kKChuYW1lKSA9PiBuYW1lLnRvTG93ZXJDYXNlKCkgPT09IG5vcm1hbGl6ZWQudG9Mb3dlckNhc2UoKSk7XG4gICAgY29uc3Qgc3VidHlwID0gZXhpc3RpbmcgPz8gbm9ybWFsaXplZDtcbiAgICBlbnN1cmVTdWJ0eXAodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKTtcblxuICAgIGNvbnN0IHJlbmFtZWQgPSBzdWJ0eXAgIT09IHN1YnR5cEtleSA/IGF3YWl0IHJlbmFtZVN1YnR5cEluTm90ZXModGhpcy5wbHVnaW4sIHR5cCwgc3VidHlwS2V5LCBzdWJ0eXApIDogMDtcbiAgICByZXR1cm4geyBzdWJ0eXAsIHJlbmFtZWQgfTtcbiAgfVxuXG4gIC8vIEEgbmV3LCBlbXB0eSBTdWJ0eXAgYmxvY2sgcmlnaHQgYWJvdmUgdGhlIFwiQWRkIFN1YnR5cFwiIGJ1dHRvbiwgaXRzIG5hbWVcbiAgLy8gdHlwZWQgaW5saW5lIChsaWtlIHN0YXJ0QWRkKCkgaW4gdGhlIGxpc3QpLlxuICBzdGFydEFkZFN1YnR5cCh0eXApIHtcbiAgICBpZiAodGhpcy5pc0VkaXRpbmcgfHwgIXRoaXMuc3VidHlwQWRkQnRuRWwpIHJldHVybjtcbiAgICB0aGlzLmlzRWRpdGluZyA9IHRydWU7XG5cbiAgICAvLyBCdWlsdCBsaWtlIHRoZSBmaW5pc2hlZCAoZW1wdHkpIGJsb2NrLCB3aXRoIHRoZSBcIitcIiBidXR0b25zIGFuZCBmb290ZXJcbiAgICAvLyBhY3Rpb25zIHRoYXQgZG8gbm90aGluZyB5ZXQsIGp1c3Qgd2l0aG91dCBhIGNvdW50IC0gc28gbm90aGluZyBqdW1wc1xuICAgIC8vIHdoZW4gdGhlIGlucHV0IGlzIGRvbmUgKHNlZSAudHlwLXN1YnR5cC1wZW5kaW5nKS5cbiAgICBjb25zdCBibG9jayA9IGNyZWF0ZURpdih7IGNsczogXCJ0eXAtZnJvbnRtYXR0ZXItYmxvY2sgdHlwLXN1YnR5cC1ibG9jayB0eXAtc3VidHlwLXBlbmRpbmdcIiB9KTtcbiAgICB0aGlzLnN1YnR5cEFkZEJ0bkVsLnBhcmVudEVsZW1lbnQuaW5zZXJ0QmVmb3JlKGJsb2NrLCB0aGlzLnN1YnR5cEFkZEJ0bkVsKTtcbiAgICBjb25zdCBoZWFkZXIgPSBibG9jay5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLWhlYWRlclwiIH0pO1xuICAgIGNvbnN0IHRpdGxlR3JvdXAgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci10aXRsZS1ncm91cFwiIH0pO1xuICAgIGNvbnN0IG5hbWVFbCA9IHRpdGxlR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1kZXRhaWwtc2VjdGlvbi10aXRsZSB0eXAtc3VidHlwLW5hbWUtaW5wdXQgaXMtYmVpbmctcmVuYW1lZFwiIH0pO1xuICAgIGNvbnN0IGFkZEJ1dHRvbnMgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci1hZGQtZ3JvdXBcIiB9KTtcbiAgICBzZXRJY29uKGFkZEJ1dHRvbnMuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1mcm9udG1hdHRlci1hZGQtZmxvYXRpbmdcIiB9KSwgXCJwbHVzXCIpO1xuICAgIHNldEljb24oYWRkQnV0dG9ucy5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWZyb250bWF0dGVyLWFkZFwiIH0pLCBcInBsdXNcIik7XG4gICAgY29uc3QgZm9vdGVyID0gYmxvY2suY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zZWN0aW9uLWZvb3RlciB0eXAtc3VidHlwLWFjdGlvbnNcIiB9KTtcbiAgICBjb25zdCBjb2xvckdyb3VwID0gZm9vdGVyLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtc3VidHlwLWNvbG9yLWdyb3VwXCIgfSk7XG4gICAgcGFpbnRDb2xvckRvdChjb2xvckdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtc3VidHlwLWNvbG9yLWRvdFwiIH0pLCB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdHlwXSA/PyBERUZBVUxUX1RZUF9DT0xPUiwgdHJ1ZSk7XG4gICAgc2V0SWNvbihjb2xvckdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtY29sb3ItcmVzZXQgaXMtZGlzYWJsZWRcIiB9KSwgXCJyb3RhdGUtY2N3XCIpO1xuICAgIGNvbnN0IGFjdGlvbnMgPSBmb290ZXIuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zdWJ0eXAtYWN0aW9uLWdyb3VwXCIgfSk7XG4gICAgc2V0SWNvbihhY3Rpb25zLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtZGV0YWlsLXJlbmFtZS1ub3Rlc1wiIH0pLCBcInBlbmNpbFwiKTtcbiAgICBzZXRJY29uKGFjdGlvbnMuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1kZXRhaWwtcmVuYW1lXCIgfSksIFwicGVuY2lsXCIpO1xuICAgIC8vIFRoZSBzdGF0ZSBlbnN1cmVTdWJ0eXAgd2lsbCBnaXZlIHRoZSBuZXcgU3VidHlwOiB0aGF0IG9mIGl0cyBUWVAuXG4gICAgY29uc3QgbWFudWFsQ2xzID0gXCJjbGlja2FibGUtaWNvbiB0eXAtbWFudWFsLWljb25cIiArICh0aGlzLmVuc3VyZVR5cE1hbnVhbCgpW3R5cF0gIT09IGZhbHNlID8gXCIgaXMtYWN0aXZlXCIgOiBcIlwiKTtcbiAgICBzZXRJY29uKGFjdGlvbnMuY3JlYXRlRGl2KHsgY2xzOiBtYW51YWxDbHMgfSksIFwiZmlsZS1wZW4tbGluZVwiKTtcbiAgICBzZXRJY29uKGFjdGlvbnMuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1kZXRhaWwtZGVsZXRlXCIgfSksIFwidHJhc2hcIik7XG4gICAgbmFtZUVsLnNldEF0dHJpYnV0ZShcImNvbnRlbnRlZGl0YWJsZVwiLCBcInRydWVcIik7XG4gICAgbmFtZUVsLnNldEF0dHJpYnV0ZShcInNwZWxsY2hlY2tcIiwgXCJmYWxzZVwiKTtcbiAgICBuYW1lRWwuZm9jdXMoKTtcblxuICAgIGxldCBkb25lID0gZmFsc2U7XG4gICAgY29uc3QgZmluaXNoID0gYXN5bmMgKGNvbW1pdCkgPT4ge1xuICAgICAgaWYgKGRvbmUpIHJldHVybjtcbiAgICAgIGRvbmUgPSB0cnVlO1xuICAgICAgdGhpcy5pc0VkaXRpbmcgPSBmYWxzZTtcblxuICAgICAgY29uc3QgdmFsdWUgPSBub3JtYWxpemVTdWJ0eXBOYW1lKG5hbWVFbC50ZXh0Q29udGVudCk7XG4gICAgICBpZiAoY29tbWl0ICYmIHZhbHVlKSB7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nID0gZ2V0U3VidHlwTmFtZXModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCkuZmluZCgobmFtZSkgPT4gbmFtZS50b0xvd2VyQ2FzZSgpID09PSB2YWx1ZS50b0xvd2VyQ2FzZSgpKTtcbiAgICAgICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICAgICAgbmV3IE5vdGljZShgJHt0eXB9IGFscmVhZHkgaGFzIFN1YnR5cCAke2V4aXN0aW5nfS5gKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBlbnN1cmVTdWJ0eXAodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgdmFsdWUpO1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICB0aGlzLnJlbmRlcigpO1xuICAgIH07XG5cbiAgICBuYW1lRWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVudGVyXCIpIHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgIGZpbmlzaCh0cnVlKTtcbiAgICAgIH0gZWxzZSBpZiAoZXZlbnQua2V5ID09PSBcIkVzY2FwZVwiKSB7XG4gICAgICAgIC8vIHN0b3BQcm9wYWdhdGlvbiwgb3IgdGhlIGRldGFpbCB2aWV3J3Mgb3duIEVzY2FwZSBoYW5kbGVyIHdvdWxkIGxlYXZlXG4gICAgICAgIC8vIGl0IGFzIHdlbGwuXG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICBmaW5pc2goZmFsc2UpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIG5hbWVFbC5hZGRFdmVudExpc3RlbmVyKFwiYmx1clwiLCAoKSA9PiBmaW5pc2godHJ1ZSkpO1xuICB9XG5cbiAgc2hvd0RlbGV0ZUNvbmZpcm0odHlwKSB7XG4gICAgY29uc3Qgb25Db25maXJtID0gYXN5bmMgKCkgPT4ge1xuICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwcyA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cHMuZmlsdGVyKCh0KSA9PiB0ICE9PSB0eXApO1xuICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdO1xuICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlc2NyaXB0aW9uc1t0eXBdO1xuICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlZmF1bHRGcm9udG1hdHRlclt0eXBdO1xuICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cEZsb2F0aW5nS2V5c1t0eXBdO1xuICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cFNob3J0Y3V0c1t0eXBdO1xuICAgICAgZGVsZXRlIHRoaXMuZW5zdXJlVHlwTWFudWFsKClbdHlwXTtcbiAgICAgIGRlbGV0ZVR5cFN1YnR5cHModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCk7XG4gICAgICAvLyBCYWNrIHRvIHRoZSBsaXN0IGJlZm9yZSByZWZyZXNoVHlwQ29sb3JzKCksIHdoaWNoIHJlLXJlbmRlcnNcbiAgICAgIC8vIHN5bmNocm9ub3VzbHkgLSBvdGhlcndpc2UgdGhlIGRlbGV0ZWQgVFlQJ3Mgbm93IGVtcHR5IGRldGFpbCB2aWV3XG4gICAgICAvLyB3b3VsZCBicmllZmx5IHJlbmRlciBhZ2Fpbi5cbiAgICAgIHRoaXMuY2xvc2VUeXBTZXR0aW5ncygpO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICB9O1xuICAgIG5ldyBDb25maXJtTW9kYWwodGhpcy5hcHAsIHtcbiAgICAgIHRpdGxlOiBbXCJEZWxldGUgXCIsIHR5cE5hbWVOb2RlKHRoaXMucGx1Z2luLCB0eXAsIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdID8/IG51bGwpLCBcIj9cIl0sXG4gICAgICBjb25maXJtVGV4dDogXCJEZWxldGVcIixcbiAgICAgIHdhcm5pbmc6IHRydWUsXG4gICAgICBmb2N1czogXCJjYW5jZWxcIixcbiAgICAgIG9uQ29uZmlybSxcbiAgICB9KS5vcGVuKCk7XG4gIH1cblxuICAvLyBMaWtlIHN0YXJ0RWRpdGluZygpLCBidXQgb24gdGhlIGRldGFpbCB2aWV3J3MgdGl0bGUsIHN3aXRjaGluZ1xuICAvLyBzZWxlY3RlZFR5cCBpbnN0ZWFkIG9mIGp1c3QgcmUtcmVuZGVyaW5nIHRoZSBsaXN0LiB1cGRhdGVOb3RlczogdHJ1ZSAodGhlXG4gIC8vIGhpZ2hsaWdodGVkIGJ1dHRvbikgYWxzbyByZXdyaXRlcyB0aGUgVFlQIG9mIGV2ZXJ5IGFmZmVjdGVkIG5vdGUgYWZ0ZXJcbiAgLy8gY29uZmlybWF0aW9uIChzZWUgcmVuYW1lVHlwSW5Ob3RlcykgaW5zdGVhZCBvZiBvbmx5IHRoZSBzZXR0aW5ncy5cbiAgc3RhcnREZXRhaWxSZW5hbWUodHlwLCB0aXRsZUVsLCB7IHVwZGF0ZU5vdGVzID0gZmFsc2UgfSA9IHt9KSB7XG4gICAgaWYgKHRoaXMuaXNFZGl0aW5nKSByZXR1cm47XG4gICAgdGhpcy5pc0VkaXRpbmcgPSB0cnVlO1xuXG4gICAgdGl0bGVFbC5hZGRDbGFzcyhcImlzLWJlaW5nLXJlbmFtZWRcIik7XG4gICAgdGl0bGVFbC5zZXRBdHRyaWJ1dGUoXCJjb250ZW50ZWRpdGFibGVcIiwgXCJ0cnVlXCIpO1xuICAgIHRpdGxlRWwuc2V0QXR0cmlidXRlKFwic3BlbGxjaGVja1wiLCBcImZhbHNlXCIpO1xuICAgIHRpdGxlRWwuZm9jdXMoKTtcblxuICAgIGNvbnN0IHJhbmdlID0gdGl0bGVFbC5kb2MuY3JlYXRlUmFuZ2UoKTtcbiAgICByYW5nZS5zZWxlY3ROb2RlQ29udGVudHModGl0bGVFbCk7XG4gICAgY29uc3Qgc2VsZWN0aW9uID0gdGl0bGVFbC53aW4uZ2V0U2VsZWN0aW9uKCk7XG4gICAgc2VsZWN0aW9uLnJlbW92ZUFsbFJhbmdlcygpO1xuICAgIHNlbGVjdGlvbi5hZGRSYW5nZShyYW5nZSk7XG5cbiAgICAvLyBNb3ZlcyBvbmx5IHRoZSBzZXR0aW5ncyAobGlzdCwgY29sb3IsIGRlc2NyaXB0aW9uLCBUWVAtRnJvbnRtYXR0ZXIsXG4gICAgLy8gbWFudWFsIHRvZ2dsZSkgdG8gdGhlIG5ldyBuYW1lIC0gdG91Y2hlcyBubyBub3Rlcy4gU2hhcmVkIGJ5IGJvdGggcmVuYW1lXG4gICAgLy8gcGF0aHMuXG4gICAgY29uc3QgYXBwbHlSZW5hbWUgPSBhc3luYyAodmFsdWUpID0+IHtcbiAgICAgIGNvbnN0IGlkeCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cHMuaW5kZXhPZih0eXApO1xuICAgICAgaWYgKGlkeCAhPT0gLTEpIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cHNbaWR4XSA9IHZhbHVlO1xuICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdO1xuICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF07XG4gICAgICB9XG4gICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRGVzY3JpcHRpb25zW3R5cF0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBEZXNjcmlwdGlvbnNbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRGVzY3JpcHRpb25zW3R5cF07XG4gICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBEZXNjcmlwdGlvbnNbdHlwXTtcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlZmF1bHRGcm9udG1hdHRlclt2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwXTtcbiAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlZmF1bHRGcm9udG1hdHRlclt0eXBdO1xuICAgICAgfVxuICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cEZsb2F0aW5nS2V5c1t0eXBdICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRmxvYXRpbmdLZXlzW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cEZsb2F0aW5nS2V5c1t0eXBdO1xuICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRmxvYXRpbmdLZXlzW3R5cF07XG4gICAgICB9XG4gICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwU2hvcnRjdXRzW3R5cF0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBTaG9ydGN1dHNbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwU2hvcnRjdXRzW3R5cF07XG4gICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBTaG9ydGN1dHNbdHlwXTtcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLmVuc3VyZVR5cE1hbnVhbCgpW3R5cF0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBNYW51YWxbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwTWFudWFsW3R5cF07XG4gICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBNYW51YWxbdHlwXTtcbiAgICAgIH1cbiAgICAgIG1vdmVUeXBTdWJ0eXBzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHZhbHVlKTtcbiAgICAgIC8vIFNldCBiZWZvcmUgcmVmcmVzaFR5cENvbG9ycygpLCB3aGljaCBjYWxscyByZW5kZXIoKSBzeW5jaHJvbm91c2x5IC1cbiAgICAgIC8vIG90aGVyd2lzZSB0aGUgb2xkLCBub3cgZW1wdHkgbmFtZSB3b3VsZCBicmllZmx5IHJlbmRlci5cbiAgICAgIHRoaXMuc2VsZWN0ZWRUeXAgPSB2YWx1ZTtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgfTtcblxuICAgIGxldCBkb25lID0gZmFsc2U7XG4gICAgY29uc3QgZmluaXNoID0gYXN5bmMgKGNvbW1pdCkgPT4ge1xuICAgICAgaWYgKGRvbmUpIHJldHVybjtcbiAgICAgIGRvbmUgPSB0cnVlO1xuICAgICAgdGhpcy5pc0VkaXRpbmcgPSBmYWxzZTtcblxuICAgICAgY29uc3QgdmFsdWUgPSBub3JtYWxpemVUeXBOYW1lKHRpdGxlRWwudGV4dENvbnRlbnQpO1xuICAgICAgaWYgKCFjb21taXQgfHwgIXZhbHVlIHx8IHZhbHVlID09PSB0eXApIHtcbiAgICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cHMuZmluZChcbiAgICAgICAgKHQpID0+IHQudG9Mb3dlckNhc2UoKSA9PT0gdmFsdWUudG9Mb3dlckNhc2UoKSAmJiB0ICE9PSB0eXBcbiAgICAgICk7XG4gICAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgICAgdGhpcy5zaG93TWVyZ2VDb25maXJtKHR5cCwgZXhpc3RpbmcpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmICghdXBkYXRlTm90ZXMpIHtcbiAgICAgICAgYXdhaXQgYXBwbHlSZW5hbWUodmFsdWUpO1xuICAgICAgICB0aGlzLnJlbmRlcigpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIC8vIEEgYnVsayB3cml0ZSBhY3Jvc3MgcG9zc2libHkgbWFueSBmaWxlcyAtIGNvbmZpcm0gZmlyc3QuIFNhbWUgY29sb3JcbiAgICAgIC8vIGZvciBvbGQgYW5kIG5ldyBuYW1lOiB0aGUgbmV3IG9uZSBoYXMgbm8gdHlwQ29sb3JzIGVudHJ5IHlldCBidXQgdGFrZXNcbiAgICAgIC8vIG92ZXIgdGhlIG9sZCBvbmUncyAoc2VlIGFwcGx5UmVuYW1lKS5cbiAgICAgIGNvbnN0IHsgY291bnRzIH0gPSB0aGlzLnBsdWdpbi50eXBJbmRleC50eXBDb3VudHMoKTtcbiAgICAgIGNvbnN0IGNvbG9yID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPz8gbnVsbDtcbiAgICAgIG5ldyBDb25maXJtTW9kYWwodGhpcy5hcHAsIHtcbiAgICAgICAgdGl0bGU6IFtcIlJlbmFtZSBcIiwgdHlwTmFtZU5vZGUodGhpcy5wbHVnaW4sIHR5cCwgY29sb3IpLCBcIiB0byBcIiwgdHlwTmFtZU5vZGUodGhpcy5wbHVnaW4sIHZhbHVlLCBjb2xvciksIFwiP1wiXSxcbiAgICAgICAgYm9keTogW2Ake3BsdXJhbChjb3VudHMuZ2V0KHR5cCkgPz8gMCwgXCJub3RlXCIpfSB3aWxsIGJlIHVwZGF0ZWQuYF0sXG4gICAgICAgIGNvbmZpcm1UZXh0OiBcIlJlbmFtZVwiLFxuICAgICAgICBmb2N1czogXCJjb25maXJtXCIsXG4gICAgICAgIG9uQ29uZmlybTogYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGF3YWl0IGFwcGx5UmVuYW1lKHZhbHVlKTtcbiAgICAgICAgICBjb25zdCByZW5hbWVkID0gYXdhaXQgcmVuYW1lVHlwSW5Ob3Rlcyh0aGlzLnBsdWdpbiwgdHlwLCB2YWx1ZSk7XG4gICAgICAgICAgbmV3IE5vdGljZShgVFlQICR7dmFsdWV9OiAke3BsdXJhbChyZW5hbWVkLCBcIm5vdGVcIil9IHVwZGF0ZWQuYCk7XG4gICAgICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgICAgfSxcbiAgICAgICAgb25DYW5jZWw6ICgpID0+IHRoaXMucmVuZGVyKCksXG4gICAgICB9KS5vcGVuKCk7XG4gICAgfTtcblxuICAgIHRpdGxlRWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVudGVyXCIpIHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgIGZpbmlzaCh0cnVlKTtcbiAgICAgIH0gZWxzZSBpZiAoZXZlbnQua2V5ID09PSBcIkVzY2FwZVwiKSB7XG4gICAgICAgIC8vIHN0b3BQcm9wYWdhdGlvbiwgb3IgdGhlIGRldGFpbCB2aWV3J3MgRXNjYXBlIGhhbmRsZXIgd291bGQgbGVhdmUgaXRcbiAgICAgICAgLy8gYXMgd2VsbC5cbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgIGZpbmlzaChmYWxzZSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICB0aXRsZUVsLmFkZEV2ZW50TGlzdGVuZXIoXCJibHVyXCIsICgpID0+IGZpbmlzaCh0cnVlKSk7XG4gIH1cblxuICAvLyBSZW5hbWluZyB0byB0aGUgbmFtZSBvZiBhbiBhbHJlYWR5IHJlZ2lzdGVyZWQgVFlQIChzZWUgc3RhcnREZXRhaWxSZW5hbWUpXG4gIC8vIG9mZmVycyB0byBtZXJnZSBib3RoIChzZWUgbWVyZ2VUeXApIGluc3RlYWQgb2Ygc2lsZW50bHkgZHJvcHBpbmcgdGhlXG4gIC8vIHJlbmFtZS4gSXQgYWx3YXlzIHJld3JpdGVzIHRoZSBub3Rlcywgd2hpY2hldmVyIHJlbmFtZSBidXR0b24gc3RhcnRlZCBpdDpcbiAgLy8gYSBtZXJnZSBpbiB0aGUgc2V0dGluZ3Mgb25seSB3b3VsZCBsZWF2ZSB0aGUgc291cmNlIFRZUCdzIG5vdGVzIGFzIGFuXG4gIC8vIHVucmVnaXN0ZXJlZCBlbnRyeS5cbiAgc2hvd01lcmdlQ29uZmlybShzb3VyY2UsIHRhcmdldCkge1xuICAgIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHRoaXMucGx1Z2luO1xuICAgIGNvbnN0IGNvdW50ID0gdGhpcy5wbHVnaW4udHlwSW5kZXgudHlwQ291bnRzKCkuY291bnRzLmdldChzb3VyY2UpID8/IDA7XG4gICAgbmV3IENvbmZpcm1Nb2RhbCh0aGlzLmFwcCwge1xuICAgICAgdGl0bGU6IFtcbiAgICAgICAgXCJNZXJnZSBcIixcbiAgICAgICAgdHlwTmFtZU5vZGUodGhpcy5wbHVnaW4sIHNvdXJjZSwgc2V0dGluZ3MudHlwQ29sb3JzW3NvdXJjZV0gPz8gbnVsbCksXG4gICAgICAgIFwiIGludG8gXCIsXG4gICAgICAgIHR5cE5hbWVOb2RlKHRoaXMucGx1Z2luLCB0YXJnZXQsIHNldHRpbmdzLnR5cENvbG9yc1t0YXJnZXRdID8/IG51bGwpLFxuICAgICAgICBcIj9cIixcbiAgICAgIF0sXG4gICAgICBib2R5OiBbXG4gICAgICAgIGAke3RhcmdldH0gYWxyZWFkeSBleGlzdHMuICR7cGx1cmFsKGNvdW50LCBcIm5vdGVcIil9ICR7Y291bnQgPT09IDEgPyBcIm1vdmVzXCIgOiBcIm1vdmVcIn0gdG8gaXQuIGAgK1xuICAgICAgICAgIGBUaGUgY29sb3IsIGRlc2NyaXB0aW9uIGFuZCBUWVAtRnJvbnRtYXR0ZXIgb2YgJHtzb3VyY2V9IGFyZSBkcm9wcGVkLiBgICtcbiAgICAgICAgICBgRXZlcnkgU3VidHlwIG1vdmVzIGFsb25nOyBibG9ja3Mgd2l0aCB0aGUgc2FtZSBuYW1lIGFyZSBtZXJnZWQuYCxcbiAgICAgIF0sXG4gICAgICBjb25maXJtVGV4dDogXCJNZXJnZVwiLFxuICAgICAgd2FybmluZzogdHJ1ZSxcbiAgICAgIGZvY3VzOiBcImNhbmNlbFwiLFxuICAgICAgb25Db25maXJtOiAoKSA9PiB0aGlzLm1lcmdlVHlwKHNvdXJjZSwgdGFyZ2V0KSxcbiAgICAgIG9uQ2FuY2VsOiAoKSA9PiB0aGlzLnJlbmRlcigpLFxuICAgIH0pLm9wZW4oKTtcbiAgfVxuXG4gIC8vIE1lcmdlcyBzb3VyY2UgaW50byB0YXJnZXQ6IG5vdGVzIGFyZSByZXdyaXR0ZW4gdG8gdGFyZ2V0LCBzb3VyY2UgbGVhdmVzXG4gIC8vIHRoZSBsaXN0IHdpdGggaXRzIHNldHRpbmdzICh0YXJnZXQga2VlcHMgaXRzIG93bikuIFNvdXJjZSdzIFN1YnR5cHMgbW92ZVxuICAvLyBvdmVyLCBzYW1lLW5hbWVkIGJsb2NrcyBhcmUgY29tYmluZWQgKHNlZSBtZXJnZVR5cFN1YnR5cHMgaW4gc3VidHlwcy5qcykuXG4gIC8vXG4gIC8vIFwiTWFudWFsbHkgY3JlYXRhYmxlXCIgaXMgd2hlcmUgYSBtZXJnZSBkb2VzIG1vcmUgdGhhbiBtb3ZlIGRhdGE6IHRoZSBtb3ZlZFxuICAvLyBTdWJ0eXBzIGJyaW5nIHNvdXJjZSdzIHRvZ2dsZXMgYnV0IGVuZCB1cCB1bmRlciB0YXJnZXQncy4gV2l0aCBzb3VyY2Ugb25cbiAgLy8gYW5kIHRhcmdldCBvZmYgdGhleSB3b3VsZCBiZSBzd2l0Y2hlZC1vbiBTdWJ0eXBzIHVuZGVyIGEgc3dpdGNoZWQtb2ZmIFRZUCxcbiAgLy8gdW5yZWFjaGFibGUgaW4gdGhlIHBpY2tlci4gU28gYSBzd2l0Y2hlZC1vZmYgdGFyZ2V0IHN3aXRjaGVzIHRoZW0gb2ZmIHRvbyxcbiAgLy8gYXMgaXRzIG93biBidXR0b24gd291bGQgKHNlZSByZW5kZXJNYW51YWxUb2dnbGUpLiBXaXRoIHRhcmdldCBvbiB0aGV5IHN0YXlcbiAgLy8gYXMgdGhleSB3ZXJlLlxuICBhc3luYyBtZXJnZVR5cChzb3VyY2UsIHRhcmdldCkge1xuICAgIGNvbnN0IHNldHRpbmdzID0gdGhpcy5wbHVnaW4uc2V0dGluZ3M7XG4gICAgY29uc3QgcmVuYW1lZCA9IGF3YWl0IHJlbmFtZVR5cEluTm90ZXModGhpcy5wbHVnaW4sIHNvdXJjZSwgdGFyZ2V0KTtcblxuICAgIHNldHRpbmdzLnR5cHMgPSBzZXR0aW5ncy50eXBzLmZpbHRlcigodCkgPT4gdCAhPT0gc291cmNlKTtcbiAgICBkZWxldGUgc2V0dGluZ3MudHlwQ29sb3JzW3NvdXJjZV07XG4gICAgZGVsZXRlIHNldHRpbmdzLnR5cERlc2NyaXB0aW9uc1tzb3VyY2VdO1xuICAgIGRlbGV0ZSBzZXR0aW5ncy50eXBEZWZhdWx0RnJvbnRtYXR0ZXJbc291cmNlXTtcbiAgICBkZWxldGUgc2V0dGluZ3MudHlwRmxvYXRpbmdLZXlzW3NvdXJjZV07XG4gICAgZGVsZXRlIHNldHRpbmdzLnR5cFNob3J0Y3V0c1tzb3VyY2VdO1xuICAgIGRlbGV0ZSB0aGlzLmVuc3VyZVR5cE1hbnVhbCgpW3NvdXJjZV07XG4gICAgbWVyZ2VUeXBTdWJ0eXBzKHNldHRpbmdzLCBzb3VyY2UsIHRhcmdldCk7XG4gICAgaWYgKHRoaXMuZW5zdXJlVHlwTWFudWFsKClbdGFyZ2V0XSA9PT0gZmFsc2UpIHNldEFsbFN1YnR5cHNNYW51YWwoc2V0dGluZ3MsIHRhcmdldCwgZmFsc2UpO1xuXG4gICAgLy8gU2V0IGJlZm9yZSByZWZyZXNoVHlwQ29sb3JzKCksIGFzIGluIGFwcGx5UmVuYW1lLlxuICAgIHRoaXMuc2VsZWN0ZWRUeXAgPSB0YXJnZXQ7XG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgbmV3IE5vdGljZShgVFlQICR7c291cmNlfSBtZXJnZWQgaW50byAke3RhcmdldH0sICR7cGx1cmFsKHJlbmFtZWQsIFwibm90ZVwiKX0gdXBkYXRlZC5gKTtcbiAgICB0aGlzLnJlbmRlcigpO1xuICB9XG5cbiAgcmVuZGVyQ291bnRGbGFpcihzZWxmLCBjb3VudCkge1xuICAgIGNvbnN0IGZsYWlyT3V0ZXIgPSBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0tZmxhaXItb3V0ZXJcIiB9KTtcbiAgICBmbGFpck91dGVyLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHJlZS1pdGVtLWZsYWlyXCIsIHRleHQ6IFN0cmluZyhjb3VudCkgfSk7XG4gIH1cblxuICAvLyBFeHBsYWlucyB0aGUgZmxvYXRpbmcgdG9nZ2xlIChyaWdodC1jbGljayBvbiBhIHByb3BlcnR5IGFib3ZlLCBzZWVcbiAgLy8gZW5zdXJlUHJvcGVydHlNZW51UGF0Y2gpLiBObyBoZWFkaW5nIC0gcmlnaHQgYmVsb3cgdGhlIGxpc3QgaXQgaXMgY2xlYXJcbiAgLy8gd2hhdCBpdCByZWZlcnMgdG8uXG4gIHJlbmRlckZsb2F0aW5nSGludChwYXJlbnQpIHtcbiAgICBjb25zdCBzZWN0aW9uID0gcGFyZW50LmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZmxvYXRpbmctaGludC1zZWN0aW9uXCIgfSk7XG4gICAgc2VjdGlvbi5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcInR5cC1mbG9hdGluZy1oaW50XCIsXG4gICAgICB0ZXh0OiBcIlJpZ2h0LWNsaWNrIGEgcHJvcGVydHkgdG8gbWFrZSBpdCBmbG9hdGluZy5cIixcbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlclR5cFBhbmUocGx1Z2luKSB7XG4gIHBsdWdpbi5yZWdpc3RlclZpZXcoVklFV19UWVBFX1RZUF9QQU5FLCAobGVhZikgPT4gbmV3IFR5cFBhbmUobGVhZiwgcGx1Z2luKSk7XG5cbiAgcGx1Z2luLmFkZENvbW1hbmQoe1xuICAgIGlkOiBcIm9wZW4tdHlwLXBhbmVcIixcbiAgICBuYW1lOiBcIk9wZW4gVFlQLVBhbmVcIixcbiAgICBjYWxsYmFjazogKCkgPT4gYWN0aXZhdGVUeXBQYW5lKHBsdWdpbiksXG4gIH0pO1xuXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJhZGQtdHlwLXByb3BlcnR5XCIsXG4gICAgbmFtZTogXCJBZGQgVFlQLUZyb250bWF0dGVyIHByb3BlcnR5XCIsXG4gICAgY2FsbGJhY2s6ICgpID0+IGFkZFR5cFByb3BlcnR5Q29tbWFuZChwbHVnaW4pLFxuICB9KTtcblxuICAvLyBPbiBob3QgcmVsb2FkIHRoZSBvbGQgbGVhZiBvYmplY3Qgc3Vydml2ZXMgKG9ubHkgb3VyIG1vZHVsZSByZWxvYWRzKSwgYnV0XG4gIC8vIFwiaW5zdGFuY2VvZiBUeXBQYW5lXCIgZmFpbHMgYWdhaW5zdCB0aGUgcmVsb2FkZWQgY2xhc3MsIGFuZCBnZXRWaWV3VHlwZSgpXG4gIC8vIGNvbWVzIGZyb20gbGVhZi52aWV3IGFsb25lLiBgYXBwYCBzdXJ2aXZlcyB1bmNoYW5nZWQsIHNvIHRoZSBsZWFmXG4gIC8vIHJlZmVyZW5jZSBpcyBrZXB0IHRoZXJlLlxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IGFjdGl2YXRlVHlwUGFuZShwbHVnaW4sIGZhbHNlLCBmYWxzZSkpO1xuXG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShWSUVXX1RZUEVfVFlQX1BBTkUpKSB7XG4gICAgICBsZWFmLnZpZXc/LnJlbmRlcj8uKCk7XG4gICAgfVxuICB9O1xuXG4gIC8vIEtlZXBzIHRoZSBjb3VudHMgY3VycmVudCBvbiBldmVyeSBUWVAtcmVsZXZhbnQgY2hhbmdlIGVsc2V3aGVyZSAobmV3IG9yXG4gIC8vIGRlbGV0ZWQgbm90ZSwgVFlQIG9yIFNVQlRZUCBjaGFuZ2VkKS4gVGhlIGluZGV4J3MgXCJjaGFuZ2VcIiBmaXJlcyBvbmx5IGZvclxuICAvLyB0aG9zZSwgbm90IG9uIGV2ZXJ5IGF1dG9zYXZlLiBEZWJvdW5jZWQgYW55d2F5IHNpbmNlIHJlbmRlcmluZyB0aGUgbGlzdCBpc1xuICAvLyByZWxhdGl2ZWx5IGNvc3RseTsgcmVzZXRUaW1lciBjb2xsZWN0cyBhIGJ1cnN0IChidWxrIGltcG9ydCkgaW50byBvbmUuXG4gIGNvbnN0IGRlYm91bmNlZFJlZnJlc2ggPSBkZWJvdW5jZShyZWZyZXNoLCA1MDAsIHRydWUpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgZGVib3VuY2VkUmVmcmVzaCkpO1xuICAvLyBUaGUgXCJFeGNsdWRlZCBmaWxlc1wiIGxpc3QgY2hhbmdlZCAoSGlkZSBGb2xkZXJzIHRvZ2dsaW5nIGEgZm9sZGVyLCBzYXkpLlxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLnZhdWx0Lm9uKFwiY29uZmlnLWNoYW5nZWRcIiwgZGVib3VuY2VkUmVmcmVzaCkpO1xuXG4gIC8vIEZvciBwbHVnaW4ucmVmcmVzaFR5cENvbG9yczogcmUtcmVuZGVycyB0aGUgbGlzdCBvciB0aGUgZGV0YWlsIHZpZXcuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG4vLyBjcmVhdGVJZk1pc3Npbmc6IGZhbHNlIGZvciB0aGUgYXV0b21hdGljIG9uTGF5b3V0UmVhZHkgY2FsbCAoc2VlXG4vLyByZWdpc3RlclR5cFBhbmUpLCB3aGljaCBzaG91bGQgb25seSByZWNvbm5lY3QgYW4gZXhpc3RpbmcgbGVhZiBvcnBoYW5lZCBieVxuLy8gaG90IHJlbG9hZCwgbm90IGNyZWF0ZSBvbmUgb24gZXZlcnkgc3RhcnQuIEEgcGFuZSB0aGF0IHdhcyBjbG9zZWQgc3RheXNcbi8vIGNsb3NlZC5cbmFzeW5jIGZ1bmN0aW9uIGFjdGl2YXRlVHlwUGFuZShwbHVnaW4sIHJldmVhbCA9IHRydWUsIGNyZWF0ZUlmTWlzc2luZyA9IHRydWUpIHtcbiAgY29uc3QgYXBwID0gcGx1Z2luLmFwcDtcbiAgY29uc3QgeyB3b3Jrc3BhY2UgfSA9IGFwcDtcblxuICBjb25zdCBjYW5kaWRhdGVzID0gW107XG4gIHdvcmtzcGFjZS5pdGVyYXRlQWxsTGVhdmVzKChsZWFmKSA9PiB7XG4gICAgaWYgKFxuICAgICAgbGVhZiA9PT0gYXBwLl9fdHlwU3lzdGVtTGVhZiB8fFxuICAgICAgKGxlYWYudmlldyAmJiBsZWFmLnZpZXcuZ2V0Vmlld1R5cGUoKSA9PT0gVklFV19UWVBFX1RZUF9QQU5FKVxuICAgICkge1xuICAgICAgY2FuZGlkYXRlcy5wdXNoKGxlYWYpO1xuICAgIH1cbiAgfSk7XG5cbiAgbGV0IGxlYWYgPSBjYW5kaWRhdGVzLnNoaWZ0KCkgPz8gbnVsbDtcbiAgZm9yIChjb25zdCBleHRyYSBvZiBjYW5kaWRhdGVzKSBleHRyYS5kZXRhY2goKTtcblxuICBpZiAoIWxlYWYpIHtcbiAgICBpZiAoIWNyZWF0ZUlmTWlzc2luZykgcmV0dXJuO1xuICAgIGxlYWYgPSB3b3Jrc3BhY2UuZ2V0TGVmdExlYWYoZmFsc2UpO1xuICAgIGF3YWl0IGxlYWYuc2V0Vmlld1N0YXRlKHsgdHlwZTogVklFV19UWVBFX1RZUF9QQU5FLCBhY3RpdmU6IHRydWUgfSk7XG4gIH0gZWxzZSBpZiAoIShsZWFmLnZpZXcgaW5zdGFuY2VvZiBUeXBQYW5lKSkge1xuICAgIC8vIGFjdGl2ZTogZmFsc2UgLSBqdXN0IHJlY29ubmVjdGluZy4gb25MYXlvdXRSZWFkeSBmaXJlcyBhdCBvbmNlIG9uY2UgdGhlXG4gICAgLy8gbGF5b3V0IGlzIHJlYWR5LCBzbyBhY3RpdmU6IHRydWUgd291bGQgc3RlYWwgZm9jdXMgb24gZXZlcnkgaG90IHJlbG9hZC5cbiAgICBhd2FpdCBsZWFmLnNldFZpZXdTdGF0ZSh7IHR5cGU6IFZJRVdfVFlQRV9UWVBfUEFORSwgYWN0aXZlOiBmYWxzZSB9KTtcbiAgfVxuXG4gIGFwcC5fX3R5cFN5c3RlbUxlYWYgPSBsZWFmO1xuICBpZiAocmV2ZWFsKSB3b3Jrc3BhY2UucmV2ZWFsTGVhZihsZWFmKTtcbn1cblxuLy8gUHJlZmVycyBhbiBvcGVuIFRZUC1QYW5lIGRldGFpbCAoZXhhY3RseSBsaWtlIGl0cyBcIitcIiBidXR0b24pOyBvdGhlcndpc2Vcbi8vIG9wZW5zIHRoZSBkZXRhaWwgdmlldyBmb3IgdGhlIGFjdGl2ZSBub3RlJ3MgVFlQIGFuZCBhZGRzIHRoZSBwcm9wZXJ0eSB0aGVyZS5cbi8vIFdpdGhvdXQgYW4gb3BlbiBub3RlIG9yIFRZUCwgYSBUWVAtUGFuZSBzaG93aW5nIGEgZGV0YWlsIHZpZXcgLSBldmVuXG4vLyB1bmZvY3VzZWQgLSBpcyB0aGUgZmFsbGJhY2suIFRoZSBiYXJlIGxpc3QgZG9lc24ndCBjb3VudDogaXQgaGFzIG5vIGVkaXRvclxuLy8gdG8gYWRkIHRvLlxuYXN5bmMgZnVuY3Rpb24gYWRkVHlwUHJvcGVydHlDb21tYW5kKHBsdWdpbikge1xuICBjb25zdCBhcHAgPSBwbHVnaW4uYXBwO1xuXG4gIGNvbnN0IGFjdGl2ZVR5cFBhbmUgPSBhcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoVHlwUGFuZSk7XG4gIGlmIChhY3RpdmVUeXBQYW5lICYmIGFjdGl2ZVR5cFBhbmUuc2VsZWN0ZWRUeXAgIT09IG51bGwpIHtcbiAgICBhY3RpdmVUeXBQYW5lLmZyb250bWF0dGVyQmxvY2tzPy5hZGRCbGFuayhudWxsKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBmaWxlID0gYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gIGNvbnN0IHR5cCA9IHBsdWdpbi50eXBJbmRleC50eXBPZihmaWxlKTtcbiAgaWYgKCF0eXApIHtcbiAgICBjb25zdCBvcGVuTGVhZiA9IGFwcC53b3Jrc3BhY2VcbiAgICAgIC5nZXRMZWF2ZXNPZlR5cGUoVklFV19UWVBFX1RZUF9QQU5FKVxuICAgICAgLmZpbmQoKGxlYWYpID0+IGxlYWYudmlldyBpbnN0YW5jZW9mIFR5cFBhbmUgJiYgbGVhZi52aWV3LnNlbGVjdGVkVHlwICE9PSBudWxsKTtcbiAgICBpZiAob3BlbkxlYWYpIHtcbiAgICAgIGF3YWl0IGFwcC53b3Jrc3BhY2UucmV2ZWFsTGVhZihvcGVuTGVhZik7XG4gICAgICBvcGVuTGVhZi52aWV3LmZyb250bWF0dGVyQmxvY2tzPy5hZGRCbGFuayhudWxsKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgbmV3IE5vdGljZShcbiAgICAgIGZpbGVcbiAgICAgICAgPyBcIlRoZSBhY3RpdmUgbm90ZSBoYXMgbm8gVFlQLCBhbmQgbm8gVFlQIGlzIG9wZW4gaW4gdGhlIFRZUC1QYW5lLlwiXG4gICAgICAgIDogXCJObyBub3RlIGlzIG9wZW4sIGFuZCBubyBUWVAgaXMgb3BlbiBpbiB0aGUgVFlQLVBhbmUuXCJcbiAgICApO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGF3YWl0IGFjdGl2YXRlVHlwUGFuZShwbHVnaW4pO1xuICBjb25zdCB2aWV3ID0gYXBwLl9fdHlwU3lzdGVtTGVhZj8udmlldztcbiAgaWYgKCEodmlldyBpbnN0YW5jZW9mIFR5cFBhbmUpKSByZXR1cm47XG4gIHZpZXcub3BlblR5cFNldHRpbmdzKHR5cCk7XG4gIHZpZXcuZnJvbnRtYXR0ZXJCbG9ja3M/LmFkZEJsYW5rKG51bGwpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJUeXBQYW5lLCBWSUVXX1RZUEVfVFlQX1BBTkUsIGNvbXBhcmVUeXBzLCBzb3J0VHlwc0J5TW9kZSwgREVGQVVMVF9TT1JUX09SREVSLCBERUZBVUxUX1RZUF9DT0xPUiB9O1xuIiwgImNvbnN0IHsgVEZpbGUsIFRGb2xkZXIgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgY29sb3JGb3JGaWxlIH0gPSByZXF1aXJlKFwiLi90eXAtY29sb3JzXCIpO1xuXG5jb25zdCBGSUxFX0VYUExPUkVSX1ZJRVdfVFlQRSA9IFwiZmlsZS1leHBsb3JlclwiO1xuY29uc3QgRk9MREVSX05PVEVTX1BMVUdJTl9JRCA9IFwiZm9sZGVyLW5vdGVzXCI7XG5cbi8vIEZvbGRlciBOb3RlcyBzaG93cyBhIG5vdGUgYXMgaXRzIGZvbGRlciBpbnN0ZWFkIG9mIGFzIGl0cyBvd24gcm93LiBJdCBoYXMgbm9cbi8vIHB1YmxpYyBBUEkgZm9yIHRoaXMsIHNvIHRoZSBmaWxlIG5hbWUgaXMgcmVidWlsdCBmcm9tIGl0cyBsaXZlIHNldHRpbmdzLlxuZnVuY3Rpb24gZ2V0Rm9sZGVyTm90ZUZpbGUocGx1Z2luLCBmb2xkZXIpIHtcbiAgY29uc3QgZm9sZGVyTm90ZXMgPSBwbHVnaW4uYXBwLnBsdWdpbnMucGx1Z2luc1tGT0xERVJfTk9URVNfUExVR0lOX0lEXTtcbiAgY29uc3Qgc2V0dGluZ3MgPSBmb2xkZXJOb3Rlcz8uc2V0dGluZ3M7XG4gIGlmICghc2V0dGluZ3MpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGZpbGVOYW1lID1cbiAgICAoc2V0dGluZ3MuZm9sZGVyTm90ZU5hbWUgfHwgXCJ7e2ZvbGRlcl9uYW1lfX1cIikucmVwbGFjZShcInt7Zm9sZGVyX25hbWV9fVwiLCBmb2xkZXIubmFtZSkgK1xuICAgIChzZXR0aW5ncy5mb2xkZXJOb3RlVHlwZSB8fCBcIi5tZFwiKTtcbiAgY29uc3QgZGlyUGF0aCA9IHNldHRpbmdzLnN0b3JhZ2VMb2NhdGlvbiA9PT0gXCJwYXJlbnRGb2xkZXJcIiA/IGZvbGRlci5wYXJlbnQ/LnBhdGggPz8gXCJcIiA6IGZvbGRlci5wYXRoO1xuICBjb25zdCBwYXRoID0gZGlyUGF0aCA/IGAke2RpclBhdGh9LyR7ZmlsZU5hbWV9YCA6IGZpbGVOYW1lO1xuXG4gIGNvbnN0IGZpbGUgPSBwbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChwYXRoKTtcbiAgcmV0dXJuIGZpbGUgaW5zdGFuY2VvZiBURmlsZSA/IGZpbGUgOiBudWxsO1xufVxuXG5mdW5jdGlvbiBhcHBseUNvbG9yVG9UaXRsZShwbHVnaW4sIHRpdGxlRWwsIGZpbGUpIHtcbiAgY29uc3QgY29udGVudEVsID0gdGl0bGVFbC5xdWVyeVNlbGVjdG9yKFwiLm5hdi1maWxlLXRpdGxlLWNvbnRlbnQsIC5uYXYtZm9sZGVyLXRpdGxlLWNvbnRlbnRcIik7XG4gIGlmICghY29udGVudEVsKSByZXR1cm47XG5cbiAgY29uc3QgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5maWxlRXhwbG9yZXIgPyBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCBcImZpbGVFeHBsb3JlclwiKSA6IG51bGw7XG4gIGlmIChjb2xvcikgY29udGVudEVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gIGVsc2UgY29udGVudEVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiY29sb3JcIik7XG59XG5cbmZ1bmN0aW9uIGFwcGx5RmlsZUV4cGxvcmVyQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEZJTEVfRVhQTE9SRVJfVklFV19UWVBFKSkge1xuICAgIGNvbnN0IGZpbGVUaXRsZUVscyA9IGxlYWYudmlldy5jb250YWluZXJFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLm5hdi1maWxlLXRpdGxlW2RhdGEtcGF0aF1cIik7XG4gICAgZm9yIChjb25zdCB0aXRsZUVsIG9mIGZpbGVUaXRsZUVscykge1xuICAgICAgY29uc3QgZmlsZSA9IHBsdWdpbi5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHRpdGxlRWwuZ2V0QXR0cmlidXRlKFwiZGF0YS1wYXRoXCIpKTtcbiAgICAgIGFwcGx5Q29sb3JUb1RpdGxlKHBsdWdpbiwgdGl0bGVFbCwgZmlsZSBpbnN0YW5jZW9mIFRGaWxlID8gZmlsZSA6IG51bGwpO1xuICAgIH1cblxuICAgIGNvbnN0IGZvbGRlclRpdGxlRWxzID0gbGVhZi52aWV3LmNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIubmF2LWZvbGRlci10aXRsZVtkYXRhLXBhdGhdXCIpO1xuICAgIGZvciAoY29uc3QgdGl0bGVFbCBvZiBmb2xkZXJUaXRsZUVscykge1xuICAgICAgY29uc3QgZm9sZGVyID0gcGx1Z2luLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgodGl0bGVFbC5nZXRBdHRyaWJ1dGUoXCJkYXRhLXBhdGhcIikpO1xuICAgICAgY29uc3Qgbm90ZUZpbGUgPSBmb2xkZXIgaW5zdGFuY2VvZiBURm9sZGVyID8gZ2V0Rm9sZGVyTm90ZUZpbGUocGx1Z2luLCBmb2xkZXIpIDogbnVsbDtcbiAgICAgIGFwcGx5Q29sb3JUb1RpdGxlKHBsdWdpbiwgdGl0bGVFbCwgbm90ZUZpbGUpO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlckZpbGVFeHBsb3JlckNvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5RmlsZUV4cGxvcmVyQ29sb3JzKHBsdWdpbik7XG5cbiAgLy8gVGhlIGV4cGxvcmVyIHJlLXJlbmRlcnMgcm93cyB3aGVuIGZvbGRlcnMgZXhwYW5kIG9yIGNvbGxhcHNlLlxuICBjb25zdCBvYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKHJlZnJlc2gpO1xuICBjb25zdCBvYnNlcnZlRXhwbG9yZXJMZWF2ZXMgPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShGSUxFX0VYUExPUkVSX1ZJRVdfVFlQRSkpIHtcbiAgICAgIG9ic2VydmVyLm9ic2VydmUobGVhZi52aWV3LmNvbnRhaW5lckVsLCB7IGNoaWxkTGlzdDogdHJ1ZSwgc3VidHJlZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiBvYnNlcnZlci5kaXNjb25uZWN0KCkpO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAudmF1bHQub24oXCJyZW5hbWVcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgb2JzZXJ2ZUV4cGxvcmVyTGVhdmVzKCk7XG4gICAgICByZWZyZXNoKCk7XG4gICAgfSlcbiAgKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICBvYnNlcnZlRXhwbG9yZXJMZWF2ZXMoKTtcbiAgICByZWZyZXNoKCk7XG4gIH0pO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJGaWxlRXhwbG9yZXJDb2xvcnMgfTtcbiIsICJjb25zdCB7IGNvbG9yRm9yRmlsZSB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxuY29uc3QgR1JBUEhfVklFV19UWVBFUyA9IFtcImdyYXBoXCIsIFwibG9jYWxncmFwaFwiXTtcblxuZnVuY3Rpb24gaGV4VG9JbnQoaGV4KSB7XG4gIHJldHVybiBwYXJzZUludChoZXgucmVwbGFjZShcIiNcIiwgXCJcIiksIDE2KTtcbn1cblxuLy8gZW5naW5lLnJlbmRlcigpIG9ubHkgY29uc3VsdHMgaXRzIGZpbGVGaWx0ZXIgb25jZSBhIGNvbG9yIGdyb3VwIGV4aXN0cztcbi8vIHdpdGhvdXQgb25lIGV2ZXJ5IGZpbGUganVzdCBnZXRzIGNvbG9yOnRydWUuIFNvIHdlIHBhdGNoIHJlbmRlcmVyLnNldERhdGEsXG4vLyByaWdodCBiZWZvcmUgdGhlIG5vZGUgZGF0YSByZWFjaGVzIHRoZSBXZWJHTCByZW5kZXJlciAtIHRoZSBzYW1lIHNwb3QgdGhlXG4vLyBjb21tdW5pdHkgcGx1Z2luIGdyYXBoLW5lc3RlZC10YWdzIHVzZXMuIE5vZGVzIGFscmVhZHkgY29sb3JlZCBieSBhIGNvbG9yXG4vLyBncm91cCBhcmUgbGVmdCBhbG9uZS5cbmZ1bmN0aW9uIHBhdGNoUmVuZGVyZXIocGx1Z2luLCByZW5kZXJlcikge1xuICBpZiAocmVuZGVyZXIuX190eXBTeXN0ZW1Db2xvclBhdGNoZWQpIHJldHVybjtcbiAgcmVuZGVyZXIuX190eXBTeXN0ZW1Db2xvclBhdGNoZWQgPSB0cnVlO1xuXG4gIGNvbnN0IG9yaWdpbmFsID0gcmVuZGVyZXIuc2V0RGF0YTtcbiAgcmVuZGVyZXIuc2V0RGF0YSA9IGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgZm9yIChjb25zdCBwYXRoIGluIGRhdGEubm9kZXMpIHtcbiAgICAgIGNvbnN0IG5vZGUgPSBkYXRhLm5vZGVzW3BhdGhdO1xuICAgICAgaWYgKG5vZGUuY29sb3IpIGNvbnRpbnVlO1xuXG4gICAgICBpZiAobm9kZS50eXBlID09PSBcInRhZ1wiKSB7XG4gICAgICAgIC8vIE93biB0YWcgY29sb3IgZGlzYWJsZWQgKDIwMjYtMDktMzApOiB0aGUgTWluaW1hbCB0aGVtZSdzIFN0eWxlXG4gICAgICAgIC8vIFNldHRpbmdzIGFscmVhZHkgY292ZXIgaXQgKEdyYXBocyBcdTIxOTIgVGFnIG5vZGUgY29sb3IpLlxuICAgICAgICAvLyBpZiAocGx1Z2luLnNldHRpbmdzLmdyYXBoVGFnQ29sb3JFbmFibGVkICYmIHBsdWdpbi5zZXR0aW5ncy5ncmFwaFRhZ0NvbG9yKSB7XG4gICAgICAgIC8vICAgbm9kZS5jb2xvciA9IHsgYTogMSwgcmdiOiBoZXhUb0ludChwbHVnaW4uc2V0dGluZ3MuZ3JhcGhUYWdDb2xvcikgfTtcbiAgICAgICAgLy8gfVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgZmlsZSA9IHBsdWdpbi5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHBhdGgpO1xuICAgICAgbGV0IGNvbG9yID0gbnVsbDtcblxuICAgICAgaWYgKGZpbGUgJiYgZmlsZS5leHRlbnNpb24gIT09IFwibWRcIikge1xuICAgICAgICAvLyBPd24gYXR0YWNobWVudCBjb2xvciBkaXNhYmxlZCAoMjAyNi0wOS0zMCksIHNlZSB0YWcgY29sb3IgYWJvdmVcbiAgICAgICAgLy8gKEdyYXBocyBcdTIxOTIgQXR0YWNobWVudCBub2RlIGNvbG9yKS5cbiAgICAgICAgLy8gaWYgKHBsdWdpbi5zZXR0aW5ncy5ncmFwaEF0dGFjaG1lbnRDb2xvckVuYWJsZWQgJiYgcGx1Z2luLnNldHRpbmdzLmdyYXBoQXR0YWNobWVudENvbG9yKSB7XG4gICAgICAgIC8vICAgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuZ3JhcGhBdHRhY2htZW50Q29sb3I7XG4gICAgICAgIC8vIH1cbiAgICAgIH0gZWxzZSBpZiAocGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MuZ3JhcGgpIHtcbiAgICAgICAgY29sb3IgPSBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCBcImdyYXBoXCIpO1xuICAgICAgfVxuXG4gICAgICBpZiAoY29sb3IpIG5vZGUuY29sb3IgPSB7IGE6IDEsIHJnYjogaGV4VG9JbnQoY29sb3IpIH07XG4gICAgfVxuICAgIHJldHVybiBvcmlnaW5hbC5jYWxsKHRoaXMsIGRhdGEpO1xuICB9O1xuXG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiB7XG4gICAgcmVuZGVyZXIuc2V0RGF0YSA9IG9yaWdpbmFsO1xuICAgIGRlbGV0ZSByZW5kZXJlci5fX3R5cFN5c3RlbUNvbG9yUGF0Y2hlZDtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGdldEdyYXBoTGVhdmVzKGFwcCkge1xuICBjb25zdCBsZWF2ZXMgPSBbXTtcbiAgZm9yIChjb25zdCB2aWV3VHlwZSBvZiBHUkFQSF9WSUVXX1RZUEVTKSBsZWF2ZXMucHVzaCguLi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZSh2aWV3VHlwZSkpO1xuICByZXR1cm4gbGVhdmVzO1xufVxuXG5mdW5jdGlvbiByZWdpc3RlckdyYXBoQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBnZXRHcmFwaExlYXZlcyhwbHVnaW4uYXBwKSkge1xuICAgICAgaWYgKGxlYWYudmlldz8ucmVuZGVyZXIpIHBhdGNoUmVuZGVyZXIocGx1Z2luLCBsZWFmLnZpZXcucmVuZGVyZXIpO1xuICAgICAgLy8gVGhlIGdsb2JhbCBncmFwaCBrZWVwcyBpdHMgZW5naW5lIGluIHZpZXcuZGF0YUVuZ2luZSwgdGhlIGxvY2FsIG9uZSBpblxuICAgICAgLy8gdmlldy5lbmdpbmUuXG4gICAgICAobGVhZi52aWV3Py5kYXRhRW5naW5lID8/IGxlYWYudmlldz8uZW5naW5lKT8ucmVuZGVyKCk7XG4gICAgfVxuICB9O1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkocmVmcmVzaCk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckdyYXBoQ29sb3JzIH07XG4iLCAiY29uc3QgeyBjb2xvckZvckZpbGUgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5cbmNvbnN0IFNFQVJDSF9WSUVXX1RZUEUgPSBcInNlYXJjaFwiO1xuXG4vLyBTZWFyY2ggcmVzdWx0IHJvd3MgaGF2ZSBubyBkYXRhLXBhdGgsIGJ1dCB0aGUgdmlldyBrZWVwcyBhIFRGaWxlIC0+IHJlc3VsdFxuLy8gRE9NIG1hcCAoZG9tLnJlc3VsdERvbUxvb2t1cCkgdGhhdCBsaW5rcyBmaWxlIGFuZCByb3cgZGlyZWN0bHkuXG5mdW5jdGlvbiBhcHBseVNlYXJjaENvbG9ycyhwbHVnaW4pIHtcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShTRUFSQ0hfVklFV19UWVBFKSkge1xuICAgIGNvbnN0IHJlc3VsdERvbUxvb2t1cCA9IGxlYWYudmlldz8uZG9tPy5yZXN1bHREb21Mb29rdXA7XG4gICAgaWYgKCFyZXN1bHREb21Mb29rdXApIGNvbnRpbnVlO1xuXG4gICAgZm9yIChjb25zdCBbZmlsZSwgcmVzdWx0RG9tXSBvZiByZXN1bHREb21Mb29rdXApIHtcbiAgICAgIGNvbnN0IHRpdGxlRWwgPSByZXN1bHREb20uZWw/LnF1ZXJ5U2VsZWN0b3IoXCIuc2VhcmNoLXJlc3VsdC1maWxlLXRpdGxlIC50cmVlLWl0ZW0taW5uZXJcIik7XG4gICAgICBpZiAoIXRpdGxlRWwpIGNvbnRpbnVlO1xuXG4gICAgICBjb25zdCBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnNlYXJjaCA/IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIFwic2VhcmNoXCIpIDogbnVsbDtcbiAgICAgIGlmIChjb2xvcikgdGl0bGVFbC5zdHlsZS5jb2xvciA9IGNvbG9yO1xuICAgICAgZWxzZSB0aXRsZUVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiY29sb3JcIik7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyU2VhcmNoQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlTZWFyY2hDb2xvcnMocGx1Z2luKTtcblxuICAvLyBSZXN1bHRzIGFyZSByZWJ1aWx0IG9uIGV2ZXJ5IGtleXN0cm9rZS5cbiAgY29uc3Qgb2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcihyZWZyZXNoKTtcbiAgY29uc3Qgb2JzZXJ2ZUxlYXZlcyA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFNFQVJDSF9WSUVXX1RZUEUpKSB7XG4gICAgICBvYnNlcnZlci5vYnNlcnZlKGxlYWYudmlldy5jb250YWluZXJFbCwgeyBjaGlsZExpc3Q6IHRydWUsIHN1YnRyZWU6IHRydWUgfSk7XG4gICAgfVxuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4gb2JzZXJ2ZXIuZGlzY29ubmVjdCgpKTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgICAgcmVmcmVzaCgpO1xuICAgIH0pXG4gICk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgIHJlZnJlc2goKTtcbiAgfSk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlclNlYXJjaENvbG9ycyB9O1xuIiwgImNvbnN0IHsgY29sb3JGb3JGaWxlIH0gPSByZXF1aXJlKFwiLi90eXAtY29sb3JzXCIpO1xuXG5jb25zdCBSRUNFTlRfRklMRVNfVklFV19UWVBFID0gXCJyZWNlbnQtZmlsZXNcIjtcblxuLy8gUmVjZW50IEZpbGVzIHJvd3MgaGF2ZSBubyBkYXRhLXBhdGgsIGJ1dCB0aGUgbGlzdCBpcyByZW5kZXJlZCBzdHJhaWdodCBmcm9tXG4vLyBkYXRhLnJlY2VudEZpbGVzIHdpdGhvdXQgc2tpcHBpbmcgZW50cmllcywgc28gdGhlIGluZGV4IG1hcHMgcm93IHRvIHBhdGguXG5mdW5jdGlvbiBhcHBseVJlY2VudEZpbGVzQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFJFQ0VOVF9GSUxFU19WSUVXX1RZUEUpKSB7XG4gICAgY29uc3QgcmVjZW50RmlsZXMgPSBsZWFmLnZpZXc/LmRhdGE/LnJlY2VudEZpbGVzO1xuICAgIGlmICghQXJyYXkuaXNBcnJheShyZWNlbnRGaWxlcykpIGNvbnRpbnVlO1xuXG4gICAgY29uc3QgdGl0bGVFbHMgPSBsZWFmLnZpZXcuY29udGFpbmVyRWwucXVlcnlTZWxlY3RvckFsbChcIi5yZWNlbnQtZmlsZXMtdGl0bGUgLm5hdi1maWxlLXRpdGxlLWNvbnRlbnRcIik7XG4gICAgdGl0bGVFbHMuZm9yRWFjaCgodGl0bGVFbCwgaW5kZXgpID0+IHtcbiAgICAgIGNvbnN0IGVudHJ5ID0gcmVjZW50RmlsZXNbaW5kZXhdO1xuICAgICAgY29uc3QgZmlsZSA9IGVudHJ5ID8gcGx1Z2luLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoZW50cnkucGF0aCkgOiBudWxsO1xuICAgICAgY29uc3QgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5yZWNlbnRGaWxlcyA/IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIFwicmVjZW50RmlsZXNcIikgOiBudWxsO1xuICAgICAgaWYgKGNvbG9yKSB0aXRsZUVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gICAgICBlbHNlIHRpdGxlRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlclJlY2VudEZpbGVzQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlSZWNlbnRGaWxlc0NvbG9ycyhwbHVnaW4pO1xuXG4gIGNvbnN0IG9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIocmVmcmVzaCk7XG4gIGNvbnN0IG9ic2VydmVMZWF2ZXMgPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShSRUNFTlRfRklMRVNfVklFV19UWVBFKSkge1xuICAgICAgb2JzZXJ2ZXIub2JzZXJ2ZShsZWFmLnZpZXcuY29udGFpbmVyRWwsIHsgY2hpbGRMaXN0OiB0cnVlLCBzdWJ0cmVlOiB0cnVlIH0pO1xuICAgIH1cbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IG9ic2VydmVyLmRpc2Nvbm5lY3QoKSk7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoXG4gICAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICAgIHJlZnJlc2goKTtcbiAgICB9KVxuICApO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICByZWZyZXNoKCk7XG4gIH0pO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJSZWNlbnRGaWxlc0NvbG9ycyB9O1xuIiwgImNvbnN0IHsgY29sb3JGb3JGaWxlIH0gPSByZXF1aXJlKFwiLi90eXAtY29sb3JzXCIpO1xuXG5jb25zdCBCQUNLTElOS19WSUVXX1RZUEUgPSBcImJhY2tsaW5rXCI7XG5cbi8vIFRoZSBiYWNrbGlua3MgcGFuZSByZW5kZXJzIHJlc3VsdHMgd2l0aCB0aGUgc2FtZSBTZWFyY2hSZXN1bHREb20gY2xhc3MgYXNcbi8vIHNlYXJjaC4gTGlua2VkIGFuZCB1bmxpbmtlZCBtZW50aW9ucyBhcmUgdHdvIHJlc3VsdERvbUxvb2t1cCBtYXBzIG9uIHRoZVxuLy8gcmVuZGVyZXIgKHZpZXcuYmFja2xpbmspLiBUaGUgZmllbGQgbmFtZXMgYXJlIHVuZG9jdW1lbnRlZCwgc28gc2V2ZXJhbFxuLy8ga25vd24gcGF0aHMgYXJlIHRyaWVkLlxuZnVuY3Rpb24gZ2V0UmVzdWx0RG9tTG9va3Vwcyh2aWV3KSB7XG4gIGNvbnN0IHJlbmRlcmVyID0gdmlldz8uYmFja2xpbms7XG4gIGNvbnN0IGNhbmRpZGF0ZXMgPSBbcmVuZGVyZXI/LmJhY2tsaW5rRG9tLCByZW5kZXJlcj8udW5saW5rZWREb20sIHZpZXc/LmJhY2tsaW5rRG9tLCB2aWV3Py51bmxpbmtlZERvbSwgdmlldz8uZG9tXTtcblxuICBjb25zdCBsb29rdXBzID0gW107XG4gIGZvciAoY29uc3QgZG9tIG9mIGNhbmRpZGF0ZXMpIHtcbiAgICBpZiAoZG9tPy5yZXN1bHREb21Mb29rdXAgaW5zdGFuY2VvZiBNYXApIGxvb2t1cHMucHVzaChkb20ucmVzdWx0RG9tTG9va3VwKTtcbiAgfVxuICByZXR1cm4gbG9va3Vwcztcbn1cblxuZnVuY3Rpb24gY29sb3JUaXRsZUVsKHBsdWdpbiwgZWwsIGZpbGUpIHtcbiAgY29uc3QgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5iYWNrbGlua3MgPyBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCBcImJhY2tsaW5rc1wiKSA6IG51bGw7XG4gIGlmIChjb2xvcikgZWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcbiAgZWxzZSBlbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImNvbG9yXCIpO1xufVxuXG5mdW5jdGlvbiBhcHBseUJhY2tsaW5rUGFuZUNvbG9ycyhwbHVnaW4pIHtcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShCQUNLTElOS19WSUVXX1RZUEUpKSB7XG4gICAgZm9yIChjb25zdCBsb29rdXAgb2YgZ2V0UmVzdWx0RG9tTG9va3VwcyhsZWFmLnZpZXcpKSB7XG4gICAgICBmb3IgKGNvbnN0IFtmaWxlLCByZXN1bHREb21dIG9mIGxvb2t1cCkge1xuICAgICAgICBjb25zdCB0aXRsZUVsID0gcmVzdWx0RG9tLmVsPy5xdWVyeVNlbGVjdG9yKFwiLnNlYXJjaC1yZXN1bHQtZmlsZS10aXRsZSAudHJlZS1pdGVtLWlubmVyXCIpO1xuICAgICAgICBpZiAodGl0bGVFbCkgY29sb3JUaXRsZUVsKHBsdWdpbiwgdGl0bGVFbCwgZmlsZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG59XG5cbi8vIEJhY2tsaW5rcyBpbiB0aGUgZG9jdW1lbnQgYXJlIG5vdCBhIGxlYWYgb2YgdGhlaXIgb3duIGJ1dCBlbWJlZGRlZCBhdCB0aGVcbi8vIGJvdHRvbSBvZiB0aGUgbWFya2Rvd24gdmlldyAoLmVtYmVkZGVkLWJhY2tsaW5rcykuIFJvd3MgaGF2ZSBubyBkYXRhLXBhdGgsXG4vLyBzbyB0aGUgZmlsZSBpcyByZXNvbHZlZCBmcm9tIHRoZSBzaG93biBuYW1lLCB0aGUgd2F5IE9ic2lkaWFuIHJlc29sdmVzIGxpbmtzLlxuZnVuY3Rpb24gYXBwbHlFbWJlZGRlZEJhY2tsaW5rQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikpIHtcbiAgICBjb25zdCBwYW5lRWwgPSBsZWFmLnZpZXcuY29udGFpbmVyRWwucXVlcnlTZWxlY3RvcihcIi5lbWJlZGRlZC1iYWNrbGlua3MgLmJhY2tsaW5rLXBhbmVcIik7XG4gICAgaWYgKCFwYW5lRWwpIGNvbnRpbnVlO1xuXG4gICAgY29uc3Qgc291cmNlUGF0aCA9IGxlYWYudmlldy5maWxlPy5wYXRoID8/IFwiXCI7XG4gICAgY29uc3QgdGl0bGVFbHMgPSBwYW5lRWwucXVlcnlTZWxlY3RvckFsbChcIi5zZWFyY2gtcmVzdWx0LWZpbGUtdGl0bGUgLnRyZWUtaXRlbS1pbm5lclwiKTtcbiAgICBmb3IgKGNvbnN0IHRpdGxlRWwgb2YgdGl0bGVFbHMpIHtcbiAgICAgIGNvbnN0IGJhc2VuYW1lID0gdGl0bGVFbC50ZXh0Q29udGVudDtcbiAgICAgIGNvbnN0IGZpbGUgPSBiYXNlbmFtZSA/IHBsdWdpbi5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaXJzdExpbmtwYXRoRGVzdChiYXNlbmFtZSwgc291cmNlUGF0aCkgOiBudWxsO1xuICAgICAgY29sb3JUaXRsZUVsKHBsdWdpbiwgdGl0bGVFbCwgZmlsZSk7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGFwcGx5QmFja2xpbmtDb2xvcnMocGx1Z2luKSB7XG4gIGFwcGx5QmFja2xpbmtQYW5lQ29sb3JzKHBsdWdpbik7XG4gIGFwcGx5RW1iZWRkZWRCYWNrbGlua0NvbG9ycyhwbHVnaW4pO1xufVxuXG5mdW5jdGlvbiByZWdpc3RlckJhY2tsaW5rQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlCYWNrbGlua0NvbG9ycyhwbHVnaW4pO1xuXG4gIC8vIE9ubHkgdGhlIHNtYWxsIHNpZGViYXIgcGFuZSBpcyBvYnNlcnZlZCwgbmV2ZXIgYSBtYXJrZG93biB2aWV3OiBhIHN1YnRyZWVcbiAgLy8gb2JzZXJ2ZXIgbmVhciB0aGUgZWRpdG9yIGZpcmVzIG9uIGV2ZXJ5IGtleXN0cm9rZSBhbmQgb25jZSBmcm96ZSB0aGlzXG4gIC8vIHZhdWx0LiBUaGUgZW1iZWRkZWQgYmFja2xpbmtzIG9ubHkgY2hhbmdlIHdoZW4gbGlua3MgY2hhbmdlIChcInJlc29sdmVkXCIpXG4gIC8vIG9yIHRoZSBub3RlIGNoYW5nZXMgKGxheW91dC1jaGFuZ2UvYWN0aXZlLWxlYWYtY2hhbmdlKSwgYm90aCBjb3ZlcmVkIGJlbG93LlxuICBjb25zdCBvYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKHJlZnJlc2gpO1xuICBjb25zdCBvYnNlcnZlTGVhdmVzID0gKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoQkFDS0xJTktfVklFV19UWVBFKSkge1xuICAgICAgb2JzZXJ2ZXIub2JzZXJ2ZShsZWFmLnZpZXcuY29udGFpbmVyRWwsIHsgY2hpbGRMaXN0OiB0cnVlLCBzdWJ0cmVlOiB0cnVlIH0pO1xuICAgIH1cbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IG9ic2VydmVyLmRpc2Nvbm5lY3QoKSk7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC5tZXRhZGF0YUNhY2hlLm9uKFwicmVzb2x2ZWRcIiwgKCkgPT4gYXBwbHlFbWJlZGRlZEJhY2tsaW5rQ29sb3JzKHBsdWdpbikpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoXG4gICAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICAgIHJlZnJlc2goKTtcbiAgICB9KVxuICApO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImFjdGl2ZS1sZWFmLWNoYW5nZVwiLCByZWZyZXNoKSk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgIHJlZnJlc2goKTtcbiAgfSk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckJhY2tsaW5rQ29sb3JzIH07XG4iLCAiY29uc3QgeyBjb2xvckZvckZpbGUgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5cbmNvbnN0IEJPT0tNQVJLU19WSUVXX1RZUEUgPSBcImJvb2ttYXJrc1wiO1xuY29uc3QgQk9PS01BUktTX1BMVUdJTl9JRCA9IFwiYm9va21hcmtzXCI7XG5cbi8vIEJvb2ttYXJrIHJvd3MgaGF2ZSBubyBkYXRhLXBhdGguIFRoZSB2aWV3IGtlZXBzIGEgV2Vha01hcCAodmlldy5pdGVtRG9tczpcbi8vIGl0ZW0gLT4gdHJlZSBpdGVtIHdpdGggLnRpdGxlRWwpLCB3aGljaCBjYW4ndCBiZSBpdGVyYXRlZCwgc28gd2Ugd2FsayB0aGVcbi8vIHBsdWdpbidzIG93biBpdGVtIHRyZWUgKGFsd2F5cyBjb21wbGV0ZSwgd2hhdGV2ZXIgaXMgY29sbGFwc2VkKSBhbmQgbG9vayB1cFxuLy8gZWFjaCBpdGVtJ3Mgcm93IHdpdGggLmdldCgpLlxuZnVuY3Rpb24gZm9yRWFjaEZpbGVCb29rbWFyayhpdGVtcywgY2FsbGJhY2spIHtcbiAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zID8/IFtdKSB7XG4gICAgaWYgKGl0ZW0udHlwZSA9PT0gXCJmaWxlXCIpIGNhbGxiYWNrKGl0ZW0pO1xuICAgIGVsc2UgaWYgKGl0ZW0udHlwZSA9PT0gXCJncm91cFwiKSBmb3JFYWNoRmlsZUJvb2ttYXJrKGl0ZW0uaXRlbXMsIGNhbGxiYWNrKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBhcHBseUJvb2ttYXJrc0NvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgYm9va21hcmtzUGx1Z2luID0gcGx1Z2luLmFwcC5pbnRlcm5hbFBsdWdpbnMuZ2V0RW5hYmxlZFBsdWdpbkJ5SWQoQk9PS01BUktTX1BMVUdJTl9JRCk7XG4gIGlmICghYm9va21hcmtzUGx1Z2luKSByZXR1cm47XG5cbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShCT09LTUFSS1NfVklFV19UWVBFKSkge1xuICAgIGNvbnN0IGl0ZW1Eb21zID0gbGVhZi52aWV3Py5pdGVtRG9tcztcbiAgICBpZiAoIWl0ZW1Eb21zKSBjb250aW51ZTtcblxuICAgIGZvckVhY2hGaWxlQm9va21hcmsoYm9va21hcmtzUGx1Z2luLml0ZW1zLCAoaXRlbSkgPT4ge1xuICAgICAgY29uc3QgdGl0bGVFbCA9IGl0ZW1Eb21zLmdldChpdGVtKT8udGl0bGVFbDtcbiAgICAgIGlmICghdGl0bGVFbCkgcmV0dXJuO1xuXG4gICAgICBjb25zdCBmaWxlID0gcGx1Z2luLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoaXRlbS5wYXRoKTtcbiAgICAgIGNvbnN0IGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MuYm9va21hcmtzID8gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSwgXCJib29rbWFya3NcIikgOiBudWxsO1xuICAgICAgaWYgKGNvbG9yKSB0aXRsZUVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gICAgICBlbHNlIHRpdGxlRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlckJvb2ttYXJrc0NvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5Qm9va21hcmtzQ29sb3JzKHBsdWdpbik7XG5cbiAgLy8gUm93cyBhcmUgcmUtcmVuZGVyZWQgd2hlbiBncm91cHMgZXhwYW5kL2NvbGxhcHNlIG9yIGJvb2ttYXJrcyBjaGFuZ2UuXG4gIGNvbnN0IG9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIocmVmcmVzaCk7XG4gIGNvbnN0IG9ic2VydmVMZWF2ZXMgPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShCT09LTUFSS1NfVklFV19UWVBFKSkge1xuICAgICAgb2JzZXJ2ZXIub2JzZXJ2ZShsZWFmLnZpZXcuY29udGFpbmVyRWwsIHsgY2hpbGRMaXN0OiB0cnVlLCBzdWJ0cmVlOiB0cnVlIH0pO1xuICAgIH1cbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IG9ic2VydmVyLmRpc2Nvbm5lY3QoKSk7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoXG4gICAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICAgIHJlZnJlc2goKTtcbiAgICB9KVxuICApO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICByZWZyZXNoKCk7XG4gIH0pO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJCb29rbWFya3NDb2xvcnMgfTtcbiIsICJjb25zdCB7IFRGaWxlIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IGNvbG9yRm9yRmlsZSwgc3VidHlwQ29sb3IsIHN1YnR5cEhhc093bkNvbG9yIH0gPSByZXF1aXJlKFwiLi90eXAtY29sb3JzXCIpO1xuY29uc3QgeyBnZXRTdWJ0eXAgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cHNcIik7XG5cbmNvbnN0IERPVF9DTEFTUyA9IFwidHlwLXRpdGxlLWRvdFwiO1xuY29uc3QgRE9UX0hPTExPV19DTEFTUyA9IFwidHlwLXRpdGxlLWRvdC1ob2xsb3dcIjtcbi8vIFNhbWUgYXMgREVGQVVMVF9UWVBfQ09MT1IgaW4gdHlwLXBhbmUuanMgKGEgVFlQIHdpdGhvdXQgaXRzIG93biBjb2xvcikuXG5jb25zdCBERUZBVUxUX0RPVF9DT0xPUiA9IFwiIzg4ODg4OFwiO1xuY29uc3QgQkFER0VfQ0xBU1MgPSBcInR5cC10aXRsZS1iYWRnZVwiO1xuY29uc3QgQkFER0VfUExBSU5fQ0xBU1MgPSBcInR5cC10aXRsZS1iYWRnZS1wbGFpblwiO1xuY29uc3QgQ09MT1JfVkFSID0gXCItLXR5cC10aXRsZS1jb2xvclwiO1xuXG5jb25zdCBCTE9DS19CQURHRV9DTEFTUyA9IFwidHlwLWJsb2NrLWJhZGdlXCI7XG5jb25zdCBCTE9DS19CQURHRV9QTEFJTl9DTEFTUyA9IFwidHlwLWJsb2NrLWJhZGdlLXBsYWluXCI7XG5jb25zdCBCTE9DS19BTElHTl9UT1BfQ0xBU1MgPSBcInR5cC1ibG9jay1iYWRnZS10b3BcIjtcbmNvbnN0IEJMT0NLX0FMSUdOX0JPVFRPTV9DTEFTUyA9IFwidHlwLWJsb2NrLWJhZGdlLWJvdHRvbVwiO1xuY29uc3QgQkxPQ0tfQ09MT1JfVkFSID0gXCItLXR5cC1ibG9jay1jb2xvclwiO1xuXG4vLyBub3RlVGl0bGVTdHlsZTogXCJub25lXCIgfCBcImRvdFwiIHwgXCJiYWRnZVwiLiBGb3IgXCJiYWRnZVwiLCBub3RlVGl0bGVCYWRnZUNvbG9yZWRcbi8vIGFuZCBub3RlVGl0bGVCYWRnZVBvc2l0aW9uIChcInRpdGxlXCIgfCBcImJsb2NrXCIsIHBsdXMgbm90ZVRpdGxlVmVydGljYWxBbGlnblxuLy8gZm9yIFwiYmxvY2tcIikgcmVmaW5lIGl0LiBjb2xvclZpZXdzLm5vdGVUaXRsZUNvbG9yICh0aGUgdGl0bGUgdGV4dCBpdHNlbGYpIGlzXG4vLyBpbmRlcGVuZGVudCBhbmQgY29tYmluZXMgd2l0aCBhbnkgb2YgdGhlc2UuXG5mdW5jdGlvbiByZXNvbHZlTWFya2VyKHBsdWdpbiwgZmlsZSkge1xuICBjb25zdCBzdHlsZSA9IHBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVTdHlsZTtcbiAgaWYgKHN0eWxlID09PSBcIm5vbmVcIikgcmV0dXJuIHsga2luZDogXCJub25lXCIgfTtcbiAgaWYgKHN0eWxlID09PSBcImRvdFwiKSByZXR1cm4geyBraW5kOiBcImRvdFwiLCAuLi5yZXNvbHZlRG90KHBsdWdpbiwgZmlsZSkgfTtcblxuICAvLyBcImJhZGdlXCI6IGNvbG9yZWQsIGEgcmVnaXN0ZXJlZCBUWVAgd2l0aG91dCBhIGNvbG9yIGdldHMgdGhlIGdyYXkgZGVmYXVsdFxuICAvLyAobGlrZSB0aGUgcmluZyBpbiByZXNvbHZlRG90KTsgYW4gdW5yZWdpc3RlcmVkIFRZUCBnZXRzIG5vIGNvbG9yZWQgYmFkZ2UsXG4gIC8vIGp1c3QgYXMgaXQgZ2V0cyBubyBkb3QuXG4gIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHBsdWdpbjtcbiAgY29uc3QgdHlwID0gcGx1Z2luLnR5cEluZGV4LnR5cE9mKGZpbGUpO1xuICBpZiAoIXR5cCkgcmV0dXJuIHsga2luZDogXCJub25lXCIgfTtcbiAgY29uc3QgY29sb3JlZCA9IHNldHRpbmdzLm5vdGVUaXRsZUJhZGdlQ29sb3JlZDtcbiAgaWYgKGNvbG9yZWQgJiYgIXNldHRpbmdzLnR5cENvbG9yc1t0eXBdICYmICFzZXR0aW5ncy50eXBzLmluY2x1ZGVzKHR5cCkpIHJldHVybiB7IGtpbmQ6IFwibm9uZVwiIH07XG4gIGNvbnN0IHR5cENvbG9yID0gc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPz8gREVGQVVMVF9ET1RfQ09MT1I7XG5cbiAgY29uc3QgbGFiZWwgPSBiYWRnZUxhYmVsKHBsdWdpbiwgZmlsZSwgdHlwKTtcbiAgaWYgKCFsYWJlbCkgcmV0dXJuIHsga2luZDogXCJub25lXCIgfTtcbiAgY29uc3QgeyB0ZXh0LCB1c2VTdWJ0eXBDb2xvciwgc3VidHlwIH0gPSBsYWJlbDtcbiAgY29uc3QgY29sb3IgPSBjb2xvcmVkID8gKHVzZVN1YnR5cENvbG9yID8gc3VidHlwQ29sb3Ioc2V0dGluZ3MsIHR5cCwgc3VidHlwKSA/PyB0eXBDb2xvciA6IHR5cENvbG9yKSA6IG51bGw7XG4gIGNvbnN0IHBvc2l0aW9uID0gc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VQb3NpdGlvbjtcbiAgcmV0dXJuIHsga2luZDogcG9zaXRpb24gPT09IFwiYmxvY2tcIiA/IFwiYmxvY2stYmFkZ2VcIiA6IFwidGl0bGUtYmFkZ2VcIiwgY29sb3JlZCwgY29sb3IsIHR5cE5hbWU6IHRleHQgfTtcbn1cblxuLy8gQmFkZ2UgbGFiZWwgKG5vdGVUaXRsZUJhZGdlTGFiZWwpIHdpdGggaXRzIGNvbG9yOiBbVFlQXSBpbiB0aGUgVFlQIGNvbG9yLFxuLy8gW1N1YnR5cF0gaW4gdGhlIFN1YnR5cCBjb2xvciAobm8gYmFkZ2Ugd2l0aG91dCBhIFN1YnR5cCksIFtUWVAvU3VidHlwXVxuLy8gZGVwZW5kaW5nIG9uIHRoZSBcIlN1YnR5cCBjb2xvclwiIHRvZ2dsZSAoY29sb3JWaWV3cy5ub3RlVGl0bGVNYXJrZXJTdWJ0eXApLlxuLy8gQW4gdW5yZWdpc3RlcmVkIFNVQlRZUCB2YWx1ZSBpcyBzaG93biBidXQgaGFzIG5vIGNvbG9yIG9mIGl0cyBvd25cbi8vIChzdWJ0eXBDb2xvciB0aGVuIHJldHVybnMgdGhlIFRZUCBjb2xvcikuXG5mdW5jdGlvbiBiYWRnZUxhYmVsKHBsdWdpbiwgZmlsZSwgdHlwKSB7XG4gIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHBsdWdpbjtcbiAgY29uc3Qgc3VidHlwID0gcGx1Z2luLnR5cEluZGV4LnN1YnR5cE9mKGZpbGUpO1xuICBjb25zdCBtb2RlID0gc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VMYWJlbCA/PyBcInR5cFwiO1xuICBpZiAobW9kZSA9PT0gXCJzdWJ0eXBcIikgcmV0dXJuIHN1YnR5cCA/IHsgdGV4dDogc3VidHlwLCB1c2VTdWJ0eXBDb2xvcjogdHJ1ZSwgc3VidHlwIH0gOiBudWxsO1xuICBpZiAoIXN1YnR5cCB8fCBtb2RlID09PSBcInR5cFwiKSByZXR1cm4geyB0ZXh0OiB0eXAsIHVzZVN1YnR5cENvbG9yOiBmYWxzZSwgc3VidHlwIH07XG4gIHJldHVybiB7IHRleHQ6IGAke3R5cH0vJHtzdWJ0eXB9YCwgdXNlU3VidHlwQ29sb3I6ICEhc2V0dGluZ3MuY29sb3JWaWV3cy5ub3RlVGl0bGVNYXJrZXJTdWJ0eXAsIHN1YnR5cCB9O1xufVxuXG4vLyBEb3QgYXQgdGhlIHRpdGxlLiBMaWtlIHRoZSBkb3RzIGluIHRoZSBUWVAtUGFuZSAocGFpbnRDb2xvckRvdCBpblxuLy8gdHlwLWNvbG9ycy5qcyksIGEgZGVmYXVsdCBpcyBzaG93biBhcyBhIGhvbGxvdyByaW5nOiBncmF5IGZvciBhIHJlZ2lzdGVyZWRcbi8vIFRZUCB3aXRob3V0IGEgY29sb3IsIHRoZSBpbmhlcml0ZWQgVFlQIGNvbG9yIGZvciBhIFN1YnR5cCB3aXRob3V0IGl0cyBvd24uXG4vLyBVbnJlZ2lzdGVyZWQgVFlQIHZhbHVlcyBnZXQgbm8gZG90LCBhcyBpbiB0aGUgVFlQLUxpc3QuXG5mdW5jdGlvbiByZXNvbHZlRG90KHBsdWdpbiwgZmlsZSkge1xuICBjb25zdCB0eXAgPSBwbHVnaW4udHlwSW5kZXgudHlwT2YoZmlsZSk7XG4gIGlmICghdHlwKSByZXR1cm4geyBjb2xvcjogbnVsbCwgaG9sbG93OiBmYWxzZSB9O1xuICBjb25zdCB7IHNldHRpbmdzIH0gPSBwbHVnaW47XG4gIGNvbnN0IHR5cENvbG9yID0gc2V0dGluZ3MudHlwQ29sb3JzW3R5cF07XG4gIGlmICghdHlwQ29sb3IpIHtcbiAgICByZXR1cm4gc2V0dGluZ3MudHlwcy5pbmNsdWRlcyh0eXApID8geyBjb2xvcjogREVGQVVMVF9ET1RfQ09MT1IsIGhvbGxvdzogdHJ1ZSB9IDogeyBjb2xvcjogbnVsbCwgaG9sbG93OiBmYWxzZSB9O1xuICB9XG4gIGNvbnN0IHN1YnR5cCA9IHBsdWdpbi50eXBJbmRleC5zdWJ0eXBPZihmaWxlKTtcbiAgaWYgKHNldHRpbmdzLmNvbG9yVmlld3Mubm90ZVRpdGxlTWFya2VyU3VidHlwICYmIHN1YnR5cCAmJiBnZXRTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgc3VidHlwKSkge1xuICAgIHJldHVybiB7IGNvbG9yOiBzdWJ0eXBDb2xvcihzZXR0aW5ncywgdHlwLCBzdWJ0eXApLCBob2xsb3c6ICFzdWJ0eXBIYXNPd25Db2xvcihzZXR0aW5ncywgdHlwLCBzdWJ0eXApIH07XG4gIH1cbiAgcmV0dXJuIHsgY29sb3I6IHR5cENvbG9yLCBob2xsb3c6IGZhbHNlIH07XG59XG5cbi8vIFRoZSBub3RlJ3MgaW5saW5lIHRpdGxlLiBEb25lIGFzIDo6YmVmb3JlIChzZWUgc3R5bGVzLmNzcyksIG5vdCBhcyBhbiBleHRyYVxuLy8gZWxlbWVudCBvciB3cmFwcGVyOiBzZXZlcmFsIHRoZW1lcyAoTWluaW1hbCBhbW9uZyB0aGVtKSBzdHlsZSAuaW5saW5lLXRpdGxlXG4vLyB3aXRoIGNoaWxkIHNlbGVjdG9ycywgd2hpY2ggYW4gZXh0cmEgZWxlbWVudCB3b3VsZCBicmVhay4gQSA6OmJlZm9yZSBjYW4ndFxuLy8gYmUgZ2l2ZW4gYSBjb2xvciBvciB0ZXh0IGRpcmVjdGx5LCBoZW5jZSB0aGUgQ1NTIHZhcmlhYmxlIGFuZCB0aGUgZGF0YVxuLy8gYXR0cmlidXRlIHRoYXQgaXRzIHJ1bGVzIHJlYWQgKHZhcigpL2F0dHIoKSkuXG5mdW5jdGlvbiBhcHBseVN0eWxlVG9UaXRsZSh0aXRsZUVsLCBtYXJrZXIpIHtcbiAgY29uc3QgaXNEb3QgPSBtYXJrZXIua2luZCA9PT0gXCJkb3RcIiAmJiAhIW1hcmtlci5jb2xvcjtcbiAgY29uc3QgaXNCYWRnZSA9IG1hcmtlci5raW5kID09PSBcInRpdGxlLWJhZGdlXCI7XG5cbiAgdGl0bGVFbC5jbGFzc0xpc3QudG9nZ2xlKERPVF9DTEFTUywgaXNEb3QpO1xuICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoRE9UX0hPTExPV19DTEFTUywgaXNEb3QgJiYgISFtYXJrZXIuaG9sbG93KTtcbiAgdGl0bGVFbC5jbGFzc0xpc3QudG9nZ2xlKEJBREdFX0NMQVNTLCBpc0JhZGdlICYmIG1hcmtlci5jb2xvcmVkKTtcbiAgdGl0bGVFbC5jbGFzc0xpc3QudG9nZ2xlKEJBREdFX1BMQUlOX0NMQVNTLCBpc0JhZGdlICYmICFtYXJrZXIuY29sb3JlZCk7XG5cbiAgaWYgKGlzQmFkZ2UpIHRpdGxlRWwuZGF0YXNldC50eXAgPSBtYXJrZXIudHlwTmFtZTtcbiAgZWxzZSBkZWxldGUgdGl0bGVFbC5kYXRhc2V0LnR5cDtcblxuICBjb25zdCBtYXJrZXJDb2xvciA9IChpc0RvdCAmJiBtYXJrZXIuY29sb3IpIHx8IChpc0JhZGdlICYmIG1hcmtlci5jb2xvcmVkICYmIG1hcmtlci5jb2xvcikgPyBtYXJrZXIuY29sb3IgOiBudWxsO1xuICBpZiAobWFya2VyQ29sb3IpIHRpdGxlRWwuc3R5bGUuc2V0UHJvcGVydHkoQ09MT1JfVkFSLCBtYXJrZXJDb2xvcik7XG4gIGVsc2UgdGl0bGVFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShDT0xPUl9WQVIpO1xufVxuXG4vLyBUaGUgbm90ZSdzIHByb3BlcnR5IGJsb2NrICgubWV0YWRhdGEtY29udGFpbmVyKSwgZm9yIHBvc2l0aW9uIFwiYmxvY2tcIjogdGhlXG4vLyBzYW1lIGJhZGdlLCB0dXJuZWQgOTBcdTAwQjAgKHdyaXRpbmctbW9kZSByYXRoZXIgdGhhbiByb3RhdGUoKSwgc28gaXQgZ3Jvd3Mgd2l0aFxuLy8gdGhlIHRleHQgaW4gdGhlIHJpZ2h0IGRpcmVjdGlvbikgYW5kIGFuY2hvcmVkIGxlZnQgYXQgdGhlIGJsb2NrLCB0b3Agb3Jcbi8vIGJvdHRvbS4gQXMgYSA6OmJlZm9yZSBpdCBoaWRlcyBhbmQgc2hvd3Mgd2l0aCB0aGUgYmxvY2sgKFByb3BlcnR5LUJsb2NrLmNzcykuXG5mdW5jdGlvbiBhcHBseVN0eWxlVG9CbG9jayhwbHVnaW4sIGJsb2NrRWwsIG1hcmtlcikge1xuICBjb25zdCBpc0Jsb2NrQmFkZ2UgPSBtYXJrZXIua2luZCA9PT0gXCJibG9jay1iYWRnZVwiO1xuXG4gIGJsb2NrRWwuY2xhc3NMaXN0LnRvZ2dsZShCTE9DS19CQURHRV9DTEFTUywgaXNCbG9ja0JhZGdlICYmIG1hcmtlci5jb2xvcmVkKTtcbiAgYmxvY2tFbC5jbGFzc0xpc3QudG9nZ2xlKEJMT0NLX0JBREdFX1BMQUlOX0NMQVNTLCBpc0Jsb2NrQmFkZ2UgJiYgIW1hcmtlci5jb2xvcmVkKTtcblxuICBjb25zdCBhbGlnbiA9IHBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVWZXJ0aWNhbEFsaWduO1xuICBibG9ja0VsLmNsYXNzTGlzdC50b2dnbGUoQkxPQ0tfQUxJR05fVE9QX0NMQVNTLCBpc0Jsb2NrQmFkZ2UgJiYgYWxpZ24gIT09IFwiYm90dG9tXCIpO1xuICBibG9ja0VsLmNsYXNzTGlzdC50b2dnbGUoQkxPQ0tfQUxJR05fQk9UVE9NX0NMQVNTLCBpc0Jsb2NrQmFkZ2UgJiYgYWxpZ24gPT09IFwiYm90dG9tXCIpO1xuXG4gIGlmIChpc0Jsb2NrQmFkZ2UpIGJsb2NrRWwuZGF0YXNldC50eXAgPSBtYXJrZXIudHlwTmFtZTtcbiAgZWxzZSBkZWxldGUgYmxvY2tFbC5kYXRhc2V0LnR5cDtcblxuICBjb25zdCBibG9ja0NvbG9yID0gaXNCbG9ja0JhZGdlICYmIG1hcmtlci5jb2xvcmVkICYmIG1hcmtlci5jb2xvciA/IG1hcmtlci5jb2xvciA6IG51bGw7XG4gIGlmIChibG9ja0NvbG9yKSBibG9ja0VsLnN0eWxlLnNldFByb3BlcnR5KEJMT0NLX0NPTE9SX1ZBUiwgYmxvY2tDb2xvcik7XG4gIGVsc2UgYmxvY2tFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShCTE9DS19DT0xPUl9WQVIpO1xufVxuXG5mdW5jdGlvbiBhcHBseUFjdGl2ZVRpdGxlQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikpIHtcbiAgICBjb25zdCBjb250YWluZXJFbCA9IGxlYWYudmlldy5jb250YWluZXJFbDtcbiAgICBjb25zdCBmaWxlID0gbGVhZi52aWV3LmZpbGU7XG4gICAgY29uc3QgdHlwZWRGaWxlID0gZmlsZSBpbnN0YW5jZW9mIFRGaWxlID8gZmlsZSA6IG51bGw7XG4gICAgY29uc3QgbWFya2VyID0gcmVzb2x2ZU1hcmtlcihwbHVnaW4sIHR5cGVkRmlsZSk7XG5cbiAgICBjb25zdCB0aXRsZUVsID0gY29udGFpbmVyRWwucXVlcnlTZWxlY3RvcihcIi5pbmxpbmUtdGl0bGVcIik7XG4gICAgaWYgKHRpdGxlRWwpIHtcbiAgICAgIGFwcGx5U3R5bGVUb1RpdGxlKHRpdGxlRWwsIG1hcmtlcik7XG5cbiAgICAgIGNvbnN0IHRleHRDb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLm5vdGVUaXRsZUNvbG9yID8gY29sb3JGb3JGaWxlKHBsdWdpbiwgdHlwZWRGaWxlLCBcIm5vdGVUaXRsZUNvbG9yXCIpIDogbnVsbDtcbiAgICAgIGlmICh0ZXh0Q29sb3IpIHRpdGxlRWwuc3R5bGUuY29sb3IgPSB0ZXh0Q29sb3I7XG4gICAgICBlbHNlIHRpdGxlRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBibG9ja0VsID0gY29udGFpbmVyRWwucXVlcnlTZWxlY3RvcihcIi5tZXRhZGF0YS1jb250YWluZXJcIik7XG4gICAgaWYgKGJsb2NrRWwpIGFwcGx5U3R5bGVUb0Jsb2NrKHBsdWdpbiwgYmxvY2tFbCwgbWFya2VyKTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlckFjdGl2ZVRpdGxlQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlBY3RpdmVUaXRsZUNvbG9ycyhwbHVnaW4pO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwiZmlsZS1vcGVuXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJhY3RpdmUtbGVhZi1jaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgcmVmcmVzaCkpO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkocmVmcmVzaCk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckFjdGl2ZVRpdGxlQ29sb3JzIH07XG4iLCAiY29uc3QgeyBlZGl0b3JJbmZvRmllbGQsIGdldExpbmtwYXRoIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IFZpZXdQbHVnaW4sIERlY29yYXRpb24gfSA9IHJlcXVpcmUoXCJAY29kZW1pcnJvci92aWV3XCIpO1xuY29uc3QgeyBQcmVjLCBSYW5nZVNldEJ1aWxkZXIsIFN0YXRlRWZmZWN0IH0gPSByZXF1aXJlKFwiQGNvZGVtaXJyb3Ivc3RhdGVcIik7XG5jb25zdCB7IHN5bnRheFRyZWUgfSA9IHJlcXVpcmUoXCJAY29kZW1pcnJvci9sYW5ndWFnZVwiKTtcbmNvbnN0IHsgY29sb3JGb3JGaWxlIH0gPSByZXF1aXJlKFwiLi90eXAtY29sb3JzXCIpO1xuXG4vLyBDb2xvcnMgbGlua3MgaW4gbm90ZSB0ZXh0IGJ5IHRoZSBUWVAgb2YgdGhlaXIgdGFyZ2V0LiBPYnNpZGlhbiBjb2xvcnNcbi8vIGludGVybmFsIGxpbmtzIHRocm91Z2ggdmFyKC0tbGluay1jb2xvciksIHNvIG9ubHkgdGhhdCB2YXJpYWJsZSBpcyBzZXQgcGVyXG4vLyBsaW5rLiAtLWxpbmstY29sb3ItaG92ZXIgc3RheXMgdW50b3VjaGVkIChob3ZlciBzaG93cyB0aGUgbm9ybWFsIGxpbmsgY29sb3IpLFxuLy8gYW5kIHVuZGVybGluZSBhbmQgdGhlbWUgdHdlYWtzIGtlZXAgd29ya2luZy5cbi8vXG4vLyBUd28gc2VwYXJhdGUgcGF0aHMsIGJlY2F1c2UgdGhlIHR3byByZW5kZXJpbmdzIGhhdmUgbm90aGluZyBpbiBjb21tb246XG4vLyAgLSBSZWFkaW5nIHZpZXcsIGhvdmVyIHByZXZpZXcgYW5kIHJlbmRlcmVkIGJsb2NrcyBpbiBMaXZlIFByZXZpZXcgKHRhYmxlcyxcbi8vICAgIGNhbGxvdXRzKTogcmVhbCA8YSBjbGFzcz1cImludGVybmFsLWxpbmtcIiBkYXRhLWhyZWY+IGVsZW1lbnRzIC0+XG4vLyAgICBtYXJrZG93biBwb3N0LXByb2Nlc3Nvciwgb25jZSBwZXIgbGluayB3aGVuIHJlbmRlcmVkLlxuLy8gIC0gTGl2ZSBQcmV2aWV3L3NvdXJjZSBtb2RlOiBvbmx5IENvZGVNaXJyb3Igc3BhbnMgb3ZlciB0aGUgcmF3IHRleHQgLT5cbi8vICAgIGEgVmlld1BsdWdpbiB0aGF0IGxvb2tzIGF0IHRoZSB2aXNpYmxlIHJhbmdlIG9ubHkuXG4vL1xuLy8gUmVjb2xvcmluZyBvdGhlcndpc2Ugb25seSBoYXBwZW5zIG9uIGEgcmVhbCBUWVAgY2hhbmdlICh0eXBJbmRleCBcImNoYW5nZVwiKVxuLy8gb3IgYSBzZXR0aW5ncyBjaGFuZ2UsIG5vdCBvbiBldmVyeSBzYXZlLlxuXG5jb25zdCBDT0xPUl9WQVIgPSBcIi0tbGluay1jb2xvclwiO1xuY29uc3QgU09VUkNFX0FUVFIgPSBcImRhdGEtdHlwLXNyY1wiO1xuXG4vLyBbW3RhcmdldF1dLCBbW3RhcmdldHxhbGlhc11dLCBbW3RhcmdldCNoZWFkaW5nXV0uIEVtYmVkcyAoIVtbXHUyMDI2XV0pIGFyZSBub3Rcbi8vIGxpbmtzLiBJbnNpZGUgdGFibGVzIHRoZSBhbGlhcyBwaXBlIGlzIGVzY2FwZWQgKFwiXFx8XCIpLlxuY29uc3QgV0lLSUxJTktfUEFUVEVSTiA9IC8oPzwhISlcXFtcXFsoW15bXFxdXSs/KVxcXVxcXS9nO1xuXG5mdW5jdGlvbiBjb2xvckZvckxpbmt0ZXh0KHBsdWdpbiwgbGlua3RleHQsIHNvdXJjZVBhdGgpIHtcbiAgY29uc3QgdGFyZ2V0ID0gbGlua3RleHQuc3BsaXQoL1xcXFw/XFx8LylbMF0udHJpbSgpO1xuICBjb25zdCBsaW5rcGF0aCA9IGdldExpbmtwYXRoKHRhcmdldCk7XG4gIGlmICghbGlua3BhdGgpIHJldHVybiBudWxsO1xuICBjb25zdCBmaWxlID0gcGx1Z2luLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpcnN0TGlua3BhdGhEZXN0KGxpbmtwYXRoLCBzb3VyY2VQYXRoKTtcbiAgcmV0dXJuIGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIFwibGlua3NcIik7XG59XG5cbi8vIC0tLSBSZWFkaW5nIHZpZXcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5mdW5jdGlvbiBhcHBseVRvQW5jaG9yKHBsdWdpbiwgYW5jaG9yRWwpIHtcbiAgY29uc3QgaHJlZiA9IGFuY2hvckVsLmdldEF0dHJpYnV0ZShcImRhdGEtaHJlZlwiKTtcbiAgY29uc3QgY29sb3IgPVxuICAgIHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmxpbmtzICYmIGhyZWYgJiYgIWFuY2hvckVsLmNsYXNzTGlzdC5jb250YWlucyhcImlzLXVucmVzb2x2ZWRcIilcbiAgICAgID8gY29sb3JGb3JMaW5rdGV4dChwbHVnaW4sIGhyZWYsIGFuY2hvckVsLmdldEF0dHJpYnV0ZShTT1VSQ0VfQVRUUikgPz8gXCJcIilcbiAgICAgIDogbnVsbDtcbiAgaWYgKGNvbG9yKSBhbmNob3JFbC5zdHlsZS5zZXRQcm9wZXJ0eShDT0xPUl9WQVIsIGNvbG9yKTtcbiAgZWxzZSBhbmNob3JFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShDT0xPUl9WQVIpO1xufVxuXG4vLyBSZWNvbG9ycyBsaW5rcyB0aGF0IGFyZSBhbHJlYWR5IHJlbmRlcmVkLiBUaGUgcG9zdC1wcm9jZXNzb3Igc3RvcmVzIGVhY2hcbi8vIGxpbmsncyBzb3VyY2Ugbm90ZSBvbiBpdCwgd2hpY2ggYW1iaWd1b3VzIGxpbmsgdGV4dCBuZWVkcyB0byByZXNvbHZlLlxuLy8gQ29sbGVjdHMgYWxsIHdpbmRvd3MgKHBvcC1vdXRzIGluY2x1ZGVkKSB0aHJvdWdoIHRoZWlyIGxlYXZlcy5cbmZ1bmN0aW9uIHJlZnJlc2hSZW5kZXJlZExpbmtzKHBsdWdpbikge1xuICBjb25zdCBkb2NzID0gbmV3IFNldCgpO1xuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5pdGVyYXRlQWxsTGVhdmVzKChsZWFmKSA9PiBkb2NzLmFkZChsZWFmLnZpZXcuY29udGFpbmVyRWwub3duZXJEb2N1bWVudCkpO1xuICBmb3IgKGNvbnN0IGRvYyBvZiBkb2NzKSB7XG4gICAgZm9yIChjb25zdCBhbmNob3JFbCBvZiBkb2MucXVlcnlTZWxlY3RvckFsbChgYS5pbnRlcm5hbC1saW5rWyR7U09VUkNFX0FUVFJ9XWApKSBhcHBseVRvQW5jaG9yKHBsdWdpbiwgYW5jaG9yRWwpO1xuICB9XG59XG5cbi8vIC0tLSBMaXZlIFByZXZpZXcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCByZWZyZXNoRWZmZWN0ID0gU3RhdGVFZmZlY3QuZGVmaW5lKCk7XG5cbmZ1bmN0aW9uIGJ1aWxkTGlua1ZpZXdQbHVnaW4ocGx1Z2luKSB7XG4gIGNvbnN0IGRlY29yYXRpb25zQnlDb2xvciA9IG5ldyBNYXAoKTtcbiAgY29uc3QgZGVjb3JhdGlvbkZvciA9IChjb2xvcikgPT4ge1xuICAgIGxldCBkZWNvcmF0aW9uID0gZGVjb3JhdGlvbnNCeUNvbG9yLmdldChjb2xvcik7XG4gICAgaWYgKCFkZWNvcmF0aW9uKSB7XG4gICAgICBkZWNvcmF0aW9uID0gRGVjb3JhdGlvbi5tYXJrKHtcbiAgICAgICAgY2xhc3M6IFwidHlwLWxpbmtcIixcbiAgICAgICAgYXR0cmlidXRlczogeyBzdHlsZTogYCR7Q09MT1JfVkFSfTogJHtjb2xvcn07YCB9LFxuICAgICAgfSk7XG4gICAgICBkZWNvcmF0aW9uc0J5Q29sb3Iuc2V0KGNvbG9yLCBkZWNvcmF0aW9uKTtcbiAgICB9XG4gICAgcmV0dXJuIGRlY29yYXRpb247XG4gIH07XG5cbiAgY29uc3QgYnVpbGQgPSAodmlldykgPT4ge1xuICAgIGlmICghcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MubGlua3MpIHJldHVybiBEZWNvcmF0aW9uLm5vbmU7XG4gICAgY29uc3Qgc291cmNlUGF0aCA9IHZpZXcuc3RhdGUuZmllbGQoZWRpdG9ySW5mb0ZpZWxkLCBmYWxzZSk/LmZpbGU/LnBhdGggPz8gXCJcIjtcbiAgICBjb25zdCB0cmVlID0gc3ludGF4VHJlZSh2aWV3LnN0YXRlKTtcbiAgICBjb25zdCBidWlsZGVyID0gbmV3IFJhbmdlU2V0QnVpbGRlcigpO1xuXG4gICAgZm9yIChjb25zdCB7IGZyb20sIHRvIH0gb2Ygdmlldy52aXNpYmxlUmFuZ2VzKSB7XG4gICAgICBjb25zdCB0ZXh0ID0gdmlldy5zdGF0ZS5zbGljZURvYyhmcm9tLCB0byk7XG4gICAgICBXSUtJTElOS19QQVRURVJOLmxhc3RJbmRleCA9IDA7XG4gICAgICBmb3IgKGxldCBtYXRjaDsgKG1hdGNoID0gV0lLSUxJTktfUEFUVEVSTi5leGVjKHRleHQpKTsgKSB7XG4gICAgICAgIGNvbnN0IHN0YXJ0ID0gZnJvbSArIG1hdGNoLmluZGV4O1xuICAgICAgICAvLyBPbmx5IHdoYXQgT2JzaWRpYW4ncyBwYXJzZXIgdHJlYXRzIGFzIGFuIGludGVybmFsIGxpbmssIHdoaWNoIHJ1bGVzXG4gICAgICAgIC8vIG91dCBbW1x1MjAyNl1dIGluIGNvZGUgYmxvY2tzIGFuZCBpbmxpbmUgY29kZS5cbiAgICAgICAgaWYgKCF0cmVlLnJlc29sdmVJbm5lcihzdGFydCArIDIsIDEpLm5hbWUuaW5jbHVkZXMoXCJobWQtaW50ZXJuYWwtbGlua1wiKSkgY29udGludWU7XG4gICAgICAgIGNvbnN0IGNvbG9yID0gY29sb3JGb3JMaW5rdGV4dChwbHVnaW4sIG1hdGNoWzFdLCBzb3VyY2VQYXRoKTtcbiAgICAgICAgaWYgKGNvbG9yKSBidWlsZGVyLmFkZChzdGFydCwgc3RhcnQgKyBtYXRjaFswXS5sZW5ndGgsIGRlY29yYXRpb25Gb3IoY29sb3IpKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGJ1aWxkZXIuZmluaXNoKCk7XG4gIH07XG5cbiAgcmV0dXJuIFZpZXdQbHVnaW4uZnJvbUNsYXNzKFxuICAgIGNsYXNzIHtcbiAgICAgIGNvbnN0cnVjdG9yKHZpZXcpIHtcbiAgICAgICAgdGhpcy5kZWNvcmF0aW9ucyA9IGJ1aWxkKHZpZXcpO1xuICAgICAgfVxuXG4gICAgICAvLyBUaGUgcGFyc2VyIG1heSB3b3JrIHRocm91Z2ggdGhlIHZpc2libGUgcmFuZ2UgYml0IGJ5IGJpdCwgc28gYSBuZXdcbiAgICAgIC8vIHN5bnRheCB0cmVlIGFsc28gdHJpZ2dlcnMgYSByZWJ1aWxkLlxuICAgICAgdXBkYXRlKHVwZGF0ZSkge1xuICAgICAgICBpZiAoXG4gICAgICAgICAgdXBkYXRlLmRvY0NoYW5nZWQgfHxcbiAgICAgICAgICB1cGRhdGUudmlld3BvcnRDaGFuZ2VkIHx8XG4gICAgICAgICAgc3ludGF4VHJlZSh1cGRhdGUuc3RhcnRTdGF0ZSkgIT09IHN5bnRheFRyZWUodXBkYXRlLnN0YXRlKSB8fFxuICAgICAgICAgIHVwZGF0ZS50cmFuc2FjdGlvbnMuc29tZSgodHIpID0+IHRyLmVmZmVjdHMuc29tZSgoZWZmZWN0KSA9PiBlZmZlY3QuaXMocmVmcmVzaEVmZmVjdCkpKVxuICAgICAgICApIHtcbiAgICAgICAgICB0aGlzLmRlY29yYXRpb25zID0gYnVpbGQodXBkYXRlLnZpZXcpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSxcbiAgICB7IGRlY29yYXRpb25zOiAodmFsdWUpID0+IHZhbHVlLmRlY29yYXRpb25zIH1cbiAgKTtcbn1cblxuZnVuY3Rpb24gcmVmcmVzaEVkaXRvcnMocGx1Z2luKSB7XG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLml0ZXJhdGVBbGxMZWF2ZXMoKGxlYWYpID0+IHtcbiAgICBsZWFmLnZpZXc/LmVkaXRvcj8uY20/LmRpc3BhdGNoKHsgZWZmZWN0czogcmVmcmVzaEVmZmVjdC5vZihudWxsKSB9KTtcbiAgfSk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5mdW5jdGlvbiByZWdpc3RlckxpbmtDb2xvcnMocGx1Z2luKSB7XG4gIHBsdWdpbi5yZWdpc3Rlck1hcmtkb3duUG9zdFByb2Nlc3NvcigoZWwsIGN0eCkgPT4ge1xuICAgIC8vIFN0b3JlIHRoZSBzb3VyY2UgZXZlbiB3aGlsZSBjb2xvcmluZyBpcyBvZmYsIHNvIHR1cm5pbmcgaXQgb24gbGF0ZXJcbiAgICAvLyBhbHNvIGNvdmVycyBsaW5rcyB0aGF0IGFyZSBhbHJlYWR5IHJlbmRlcmVkLlxuICAgIGZvciAoY29uc3QgYW5jaG9yRWwgb2YgZWwucXVlcnlTZWxlY3RvckFsbChcImEuaW50ZXJuYWwtbGlua1wiKSkge1xuICAgICAgYW5jaG9yRWwuc2V0QXR0cmlidXRlKFNPVVJDRV9BVFRSLCBjdHguc291cmNlUGF0aCk7XG4gICAgICBhcHBseVRvQW5jaG9yKHBsdWdpbiwgYW5jaG9yRWwpO1xuICAgIH1cbiAgfSk7XG4gIC8vIE9ic2lkaWFuJ3MgXCIuY20taG1kLWludGVybmFsLWxpbmtcIiBzcGFuIGFsd2F5cyBlbmRzIHVwIG91dHNpZGUgb3VyIG1hcmssXG4gIC8vIHdoYXRldmVyIHRoZSBwcmlvcml0eSwgc28gYSBydWxlIGluIHN0eWxlcy5jc3MgKC50eXAtbGluaykgc2V0cyB0aGUgY29sb3IuXG4gIC8vIExvd2VzdCBwcmlvcml0eSBhdCBsZWFzdCB3cmFwcyBcIi5jbS11bmRlcmxpbmVcIiwgY292ZXJpbmcgdGhlIHdob2xlIHRleHQuXG4gIHBsdWdpbi5yZWdpc3RlckVkaXRvckV4dGVuc2lvbihQcmVjLmxvd2VzdChidWlsZExpbmtWaWV3UGx1Z2luKHBsdWdpbikpKTtcblxuICBjb25zdCByZWZyZXNoID0gKCkgPT4ge1xuICAgIHJlZnJlc2hSZW5kZXJlZExpbmtzKHBsdWdpbik7XG4gICAgcmVmcmVzaEVkaXRvcnMocGx1Z2luKTtcbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgLy8gRWRpdG9yIGRlY29yYXRpb25zIGdvIGF3YXkgd2l0aCB0aGUgZXh0ZW5zaW9uIG9uIHVubG9hZCwgdGhlIGlubGluZVxuICAvLyB2YXJpYWJsZXMgb24gcmVuZGVyZWQgbGlua3MgZG9uJ3QuXG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiB7XG4gICAgcGx1Z2luLmFwcC53b3Jrc3BhY2UuaXRlcmF0ZUFsbExlYXZlcygobGVhZikgPT4ge1xuICAgICAgZm9yIChjb25zdCBhbmNob3JFbCBvZiBsZWFmLnZpZXcuY29udGFpbmVyRWwucXVlcnlTZWxlY3RvckFsbChgYS5pbnRlcm5hbC1saW5rWyR7U09VUkNFX0FUVFJ9XWApKSB7XG4gICAgICAgIGFuY2hvckVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KENPTE9SX1ZBUik7XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyTGlua0NvbG9ycyB9O1xuIiwgImNvbnN0IHsgZ2V0U3VidHlwTmFtZXMsIGdldFN1YnR5cCB9ID0gcmVxdWlyZShcIi4vc3VidHlwc1wiKTtcbmNvbnN0IHsgc3VidHlwQ29sb3IgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5jb25zdCB7IFZJRVdfVFlQRV9UWVBfUEFORSB9ID0gcmVxdWlyZShcIi4vdHlwLXBhbmVcIik7XG5cbmNvbnN0IEFMTF9QUk9QRVJUSUVTX1ZJRVdfVFlQRSA9IFwiYWxsLXByb3BlcnRpZXNcIjtcbmNvbnN0IEhJR0hMSUdIVF9DTEFTUyA9IFwidHlwLWRlZmF1bHQtcHJvcGVydHlcIjtcbi8vIEZsb2F0aW5nIHByb3BlcnRpZXMgYXJlIG1hcmtlZCBpdGFsaWMgaW5zdGVhZCBvZiBib2xkLlxuY29uc3QgRkxPQVRJTkdfQ0xBU1MgPSBcInR5cC1mbG9hdGluZy1wcm9wZXJ0eVwiO1xuXG4vLyBPYnNpZGlhbiBhbHdheXMgbG93ZXJjYXNlcyBkYXRhLXByb3BlcnR5LWtleSwgc28gY29tcGFyaXNvbnMgaWdub3JlIGNhc2UuXG5mdW5jdGlvbiByYXdLZXlzRm9yVHlwKHR5cCwgZGVmYXVsdHMpIHtcbiAgaWYgKCF0eXAgfHwgIWRlZmF1bHRzKSByZXR1cm4gbnVsbDtcbiAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKGRlZmF1bHRzKS5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBcIlwiKTtcbiAgcmV0dXJuIGtleXMubGVuZ3RoID4gMCA/IGtleXMubWFwKChrZXkpID0+IGtleS50b0xvd2VyQ2FzZSgpKSA6IG51bGw7XG59XG5cbi8vIEEgVFlQJ3MgZnJvbnRtYXR0ZXIgYmxvY2tzIGFzIFt7IHNlY3Rpb24sIGtleXMsIGZsb2F0aW5nIH1dIChsb3dlcmNhc2UpOlxuLy8gdGhlIFRZUC1Gcm9udG1hdHRlciBmaXJzdCwgdGhlbiBvcHRpb25hbGx5IG9uZSBTdWJ0eXAncyBibG9jayBvciwgd2l0aFxuLy8gQUxMX1NVQlRZUFMsIGV2ZXJ5IFN1YnR5cCdzIGJsb2NrIChzZWUgc3VidHlwcy5qcykuXG5jb25zdCBBTExfU1VCVFlQUyA9IFN5bWJvbChcImFsbC1zdWJ0eXBzXCIpO1xuXG5mdW5jdGlvbiBibG9ja09mKGRlZmF1bHRzLCBmbG9hdGluZ0tleXMsIHNlY3Rpb24gPSBudWxsKSB7XG4gIGNvbnN0IGtleXMgPSByYXdLZXlzRm9yVHlwKHRydWUsIGRlZmF1bHRzKSA/PyBbXTtcbiAgcmV0dXJuIHsgc2VjdGlvbiwga2V5cywgZmxvYXRpbmc6IG5ldyBTZXQoKGZsb2F0aW5nS2V5cyA/PyBbXSkubWFwKChrZXkpID0+IGtleS50b0xvd2VyQ2FzZSgpKSkgfTtcbn1cblxuZnVuY3Rpb24gYmxvY2tzRm9yVHlwKHBsdWdpbiwgdHlwLCBzdWJ0eXApIHtcbiAgY29uc3QgeyBzZXR0aW5ncyB9ID0gcGx1Z2luO1xuICBjb25zdCBibG9ja3MgPSBbYmxvY2tPZihzZXR0aW5ncy50eXBEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwXSwgc2V0dGluZ3MudHlwRmxvYXRpbmdLZXlzW3R5cF0sIG51bGwpXTtcbiAgY29uc3Qgc3VidHlwTmFtZXMgPSBzdWJ0eXAgPT09IEFMTF9TVUJUWVBTID8gZ2V0U3VidHlwTmFtZXMoc2V0dGluZ3MsIHR5cCkgOiBzdWJ0eXAgPyBbc3VidHlwXSA6IFtdO1xuICBmb3IgKGNvbnN0IG5hbWUgb2Ygc3VidHlwTmFtZXMpIHtcbiAgICBjb25zdCBkYXRhID0gZ2V0U3VidHlwKHNldHRpbmdzLCB0eXAsIG5hbWUpO1xuICAgIGlmIChkYXRhKSBibG9ja3MucHVzaChibG9ja09mKGRhdGEuZnJvbnRtYXR0ZXIsIGRhdGEuZmxvYXRpbmdLZXlzLCBuYW1lKSk7XG4gIH1cbiAgcmV0dXJuIGJsb2Nrcztcbn1cblxuLy8gU2VwYXJhdGUgc2V0cyBvZiBuYW1lcyB0byBib2xkIChcInN0YW5kYXJkXCIpIGFuZCB0byBpdGFsaWNpemUgKFwiZmxvYXRpbmdcIikuXG4vLyBBIGZsb2F0aW5nIGtleSBuZXZlciBhbHNvIGNvdW50cyBhcyBzdGFuZGFyZC4gSWYgYSBrZXkgaXMgaW4gc2V2ZXJhbCBibG9ja3MsXG4vLyB0aGUgbGF0ZXIgYmxvY2sgZGVjaWRlcyAtIGZvciBhIG5vdGUgdGhhdCBpcyBpdHMgU3VidHlwIGJsb2NrLCB0aGUgc2FtZSBydWxlXG4vLyBhcyBmb3IgdGhlIHZhbHVlIGluIGdldFR5cERlZmF1bHRzIChtYWluLmpzKS5cbmZ1bmN0aW9uIHNwbGl0S2V5cyhibG9ja3MpIHtcbiAgY29uc3QgaXNGbG9hdGluZyA9IG5ldyBNYXAoKTtcbiAgZm9yIChjb25zdCB7IGtleXMsIGZsb2F0aW5nIH0gb2YgYmxvY2tzKSB7XG4gICAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykgaXNGbG9hdGluZy5zZXQoa2V5LCBmbG9hdGluZy5oYXMoa2V5KSk7XG4gIH1cbiAgY29uc3Qgc3RhbmRhcmQgPSBuZXcgU2V0KCk7XG4gIGNvbnN0IGZsb2F0aW5nID0gbmV3IFNldCgpO1xuICBmb3IgKGNvbnN0IFtrZXksIGZsYWddIG9mIGlzRmxvYXRpbmcpIChmbGFnID8gZmxvYXRpbmcgOiBzdGFuZGFyZCkuYWRkKGtleSk7XG4gIHJldHVybiB7IHN0YW5kYXJkOiBzdGFuZGFyZC5zaXplID4gMCA/IHN0YW5kYXJkIDogbnVsbCwgZmxvYXRpbmc6IGZsb2F0aW5nLnNpemUgPiAwID8gZmxvYXRpbmcgOiBudWxsIH07XG59XG5cbmNvbnN0IE5PX0tFWVMgPSB7IHN0YW5kYXJkOiBudWxsLCBmbG9hdGluZzogbnVsbCB9O1xuXG5mdW5jdGlvbiBrZXlzRm9yRmlsZShwbHVnaW4sIGZpbGUpIHtcbiAgY29uc3QgeyBjb2xvclZpZXdzIH0gPSBwbHVnaW4uc2V0dGluZ3M7XG4gIGlmICghY29sb3JWaWV3cy5mcm9udG1hdHRlckRlZmF1bHRzKSByZXR1cm4gTk9fS0VZUztcbiAgY29uc3QgdHlwID0gcGx1Z2luLnR5cEluZGV4LnR5cE9mKGZpbGUpO1xuICBpZiAoIXR5cCkgcmV0dXJuIE5PX0tFWVM7XG4gIGNvbnN0IHN1YnR5cCA9IGNvbG9yVmlld3MuZnJvbnRtYXR0ZXJEZWZhdWx0c1N1YnR5cCA/IHBsdWdpbi50eXBJbmRleC5zdWJ0eXBPZihmaWxlKSA6IG51bGw7XG4gIHJldHVybiBzcGxpdEtleXMoYmxvY2tzRm9yVHlwKHBsdWdpbiwgdHlwLCBzdWJ0eXApKTtcbn1cblxuLy8gVFlQLVBhbmUgZGV0YWlsIGVkaXRvcnM6IG9uZSBlZGl0b3IgcGVyIGJsb2NrIChzZWUgdHlwU3RvcmUvc3VidHlwU3RvcmUgaW5cbi8vIHR5cC1mcm9udG1hdHRlci1lZGl0b3IuanMpLCBzbyB0aGUgbWFya3Mgc2hvdyBleGFjdGx5IHRoYXQgYmxvY2sncyBrZXlzLlxuLy8gU3VidHlwIGJsb2NrcyBvbmx5IHdpdGggdGhlIFwiU3VidHlwXCIgc3ViLXRvZ2dsZS5cbmZ1bmN0aW9uIGtleXNGb3JTdG9yZShwbHVnaW4sIHN0b3JlKSB7XG4gIGNvbnN0IHsgY29sb3JWaWV3cyB9ID0gcGx1Z2luLnNldHRpbmdzO1xuICBpZiAoIWNvbG9yVmlld3MuZnJvbnRtYXR0ZXJEZWZhdWx0cyB8fCAhc3RvcmUpIHJldHVybiBOT19LRVlTO1xuICBpZiAoc3RvcmUuc3VidHlwICYmICFjb2xvclZpZXdzLmZyb250bWF0dGVyRGVmYXVsdHNTdWJ0eXApIHJldHVybiBOT19LRVlTO1xuICByZXR1cm4gc3BsaXRLZXlzKFtibG9ja09mKHN0b3JlLmdldEZyb250bWF0dGVyKCksIHN0b3JlLmdldEZsb2F0aW5nKCkpXSk7XG59XG5cbi8vIFByb3BlcnR5IG5hbWUgKGxvd2VyY2FzZSkgLT4geyB0eXBzLCBhbGxGbG9hdGluZyB9IGFjcm9zcyBldmVyeSBUWVAgd2hvc2Vcbi8vIGZyb250bWF0dGVyIChvcHRpb25hbGx5IHdpdGggaXRzIFN1YnR5cCBibG9ja3MpIGhhcyBpdC4gXCJBbGwgcHJvcGVydGllc1wiIGlzXG4vLyB2YXVsdC13aWRlIHdpdGggbm8gc2luZ2xlIFRZUCBjb250ZXh0LCBzbyB0aGUgZnVsbCBtYXBwaW5nIGlzIGNvbGxlY3RlZCB0b1xuLy8gdGVsbCBcImV4YWN0bHkgb25lIFRZUFwiIChjb2xvcikgZnJvbSBcInNldmVyYWxcIiAoYm9sZCkuIHR5cHMgbWFwcyBUWVAgLT4gdGhlXG4vLyBibG9ja3MgaG9sZGluZyB0aGUga2V5IChudWxsID0gdGhlIFRZUC1Gcm9udG1hdHRlcik7IG9ubHkgdGhlIHVuYW1iaWd1b3VzXG4vLyBjYXNlIGdldHMgY29sb3JlZC4gYWxsRmxvYXRpbmcgaXMgdHJ1ZSBpZiB0aGUga2V5IGlzIGZsb2F0aW5nIGluIEVWRVJZIGJsb2NrXG4vLyBvZiBFVkVSWSBUWVAgLSBhbnl0aGluZyBsZXNzIHdvdWxkIG1ha2UgaXRhbGljcyBtaXNsZWFkaW5nLlxuLy9cbi8vIE93biB0b2dnbGUgKGNvbG9yVmlld3MuYWxsUHJvcGVydGllcyksIGluZGVwZW5kZW50IG9mIGZyb250bWF0dGVyRGVmYXVsdHMuXG4vLyBBIFN1YnR5cCBwcm9wZXJ0eSBjb3VudHMgZm9yIGl0cyBUWVAuXG5mdW5jdGlvbiB0eXBzVXNpbmdLZXlNYXAocGx1Z2luKSB7XG4gIGNvbnN0IG1hcCA9IG5ldyBNYXAoKTtcbiAgY29uc3QgeyBjb2xvclZpZXdzIH0gPSBwbHVnaW4uc2V0dGluZ3M7XG4gIGlmICghY29sb3JWaWV3cy5hbGxQcm9wZXJ0aWVzKSByZXR1cm4gbWFwO1xuICBjb25zdCB0eXBzID0gbmV3IFNldChbXG4gICAgLi4uT2JqZWN0LmtleXMocGx1Z2luLnNldHRpbmdzLnR5cERlZmF1bHRGcm9udG1hdHRlciksXG4gICAgLi4uKGNvbG9yVmlld3MuYWxsUHJvcGVydGllc1N1YnR5cCA/IE9iamVjdC5rZXlzKHBsdWdpbi5zZXR0aW5ncy50eXBTdWJ0eXBzID8/IHt9KSA6IFtdKSxcbiAgXSk7XG4gIGZvciAoY29uc3QgdHlwIG9mIHR5cHMpIHtcbiAgICBjb25zdCBibG9ja3MgPSBibG9ja3NGb3JUeXAocGx1Z2luLCB0eXAsIGNvbG9yVmlld3MuYWxsUHJvcGVydGllc1N1YnR5cCA/IEFMTF9TVUJUWVBTIDogbnVsbCk7XG4gICAgZm9yIChjb25zdCB7IHNlY3Rpb24sIGtleXMsIGZsb2F0aW5nIH0gb2YgYmxvY2tzKSB7XG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBrZXlzKSB7XG4gICAgICAgIGlmICghbWFwLmhhcyhrZXkpKSBtYXAuc2V0KGtleSwgeyB0eXBzOiBuZXcgTWFwKCksIGFsbEZsb2F0aW5nOiB0cnVlIH0pO1xuICAgICAgICBjb25zdCBlbnRyeSA9IG1hcC5nZXQoa2V5KTtcbiAgICAgICAgaWYgKCFlbnRyeS50eXBzLmhhcyh0eXApKSBlbnRyeS50eXBzLnNldCh0eXAsIFtdKTtcbiAgICAgICAgZW50cnkudHlwcy5nZXQodHlwKS5wdXNoKHNlY3Rpb24pO1xuICAgICAgICBlbnRyeS5hbGxGbG9hdGluZyA9IGVudHJ5LmFsbEZsb2F0aW5nICYmIGZsb2F0aW5nLmhhcyhrZXkpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gbWFwO1xufVxuXG4vLyBNYXJrcyBvbmx5IHRoZSBuYW1lIChrZXkgaW5wdXQpLCBub3QgdGhlIHZhbHVlIC0gaW4gbm90ZXMgKGZyb250bWF0dGVyIGFuZFxuLy8gcHJvcGVydGllcyBzaWRlYmFyKSBhcyB3ZWxsIGFzIGluIHRoZSBwbHVnaW4ncyBvd24gVFlQLVBhbmUuXG5mdW5jdGlvbiBhcHBseVRvQ29udGFpbmVyKGNvbnRhaW5lckVsLCBzdGFuZGFyZEtleXMsIGZsb2F0aW5nS2V5cykge1xuICBpZiAoIWNvbnRhaW5lckVsKSByZXR1cm47XG4gIGNvbnN0IHJvd3MgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLm1ldGFkYXRhLXByb3BlcnR5W2RhdGEtcHJvcGVydHkta2V5XVwiKTtcbiAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgIGNvbnN0IGtleUVsID0gcm93LnF1ZXJ5U2VsZWN0b3IoXCIubWV0YWRhdGEtcHJvcGVydHkta2V5LWlucHV0XCIpO1xuICAgIGlmICgha2V5RWwpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHByb3BlcnR5S2V5ID0gcm93LmdldEF0dHJpYnV0ZShcImRhdGEtcHJvcGVydHkta2V5XCIpO1xuICAgIGtleUVsLmNsYXNzTGlzdC50b2dnbGUoSElHSExJR0hUX0NMQVNTLCAhIXN0YW5kYXJkS2V5cyAmJiBzdGFuZGFyZEtleXMuaGFzKHByb3BlcnR5S2V5KSk7XG4gICAga2V5RWwuY2xhc3NMaXN0LnRvZ2dsZShGTE9BVElOR19DTEFTUywgISFmbG9hdGluZ0tleXMgJiYgZmxvYXRpbmdLZXlzLmhhcyhwcm9wZXJ0eUtleSkpO1xuICB9XG59XG5cbi8vIFwiQWxsIHByb3BlcnRpZXNcIiBkb2Vzbid0IHVzZSB0aGUgbWV0YWRhdGEgd2lkZ2V0IGJ1dCBpdHMgb3duIHRyZWUgaXRlbXMsXG4vLyByZWFjaGFibGUgdmlhIHZpZXcuZG9tcyAobmFtZSAtPiBjb21wb25lbnQpOyB0aGVpciB0aXRsZSBlbGVtZW50IGlzXG4vLyAudHJlZS1pdGVtLWlubmVyLXRleHQuXG4vL1xuLy8gT25lIFRZUCB1c2luZyB0aGUgcHJvcGVydHk6IHRoZSBuYW1lIGdldHMgdGhhdCBUWVAncyBjb2xvci4gU2V2ZXJhbDogYVxuLy8gc2luZ2xlIGNvbG9yIHdvdWxkIG1pc2xlYWQsIHNvIGJvbGQgaW5zdGVhZCAoc2FtZSBtYXJrIGFzIGluIGEgbm90ZSkuXG5mdW5jdGlvbiBhcHBseVRvQWxsUHJvcGVydGllc1ZpZXcocGx1Z2luKSB7XG4gIGNvbnN0IHVzYWdlTWFwID0gdHlwc1VzaW5nS2V5TWFwKHBsdWdpbik7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoQUxMX1BST1BFUlRJRVNfVklFV19UWVBFKSkge1xuICAgIGNvbnN0IGRvbXMgPSBsZWFmLnZpZXc/LmRvbXM7XG4gICAgaWYgKCFkb21zKSBjb250aW51ZTtcbiAgICBmb3IgKGNvbnN0IFtrZXksIGRvbV0gb2YgT2JqZWN0LmVudHJpZXMoZG9tcykpIHtcbiAgICAgIGNvbnN0IHRpdGxlRWwgPSBkb20/LnRpdGxlRWw7XG4gICAgICBpZiAoIXRpdGxlRWwpIGNvbnRpbnVlO1xuXG4gICAgICBjb25zdCBlbnRyeSA9IHVzYWdlTWFwLmdldChrZXkudG9Mb3dlckNhc2UoKSk7XG4gICAgICBjb25zdCB0eXBzID0gZW50cnk/LnR5cHM7XG4gICAgICBjb25zdCBjb3VudCA9IHR5cHMgPyB0eXBzLnNpemUgOiAwO1xuICAgICAgdGl0bGVFbC5jbGFzc0xpc3QudG9nZ2xlKEhJR0hMSUdIVF9DTEFTUywgY291bnQgPiAxKTtcblxuICAgICAgLy8gSXRhbGljIGFzIHNvb24gYXMgaXQgaXMgZmxvYXRpbmcgRVZFUllXSEVSRS4gVW5saWtlIGJvbGQgdGhpcyBpc24ndFxuICAgICAgLy8gbGltaXRlZCB0byBvbmUgVFlQLCBzbyBib3RoIGNhbiBhcHBseSBhdCBvbmNlLlxuICAgICAgdGl0bGVFbC5jbGFzc0xpc3QudG9nZ2xlKEZMT0FUSU5HX0NMQVNTLCBjb3VudCA+IDAgJiYgZW50cnkuYWxsRmxvYXRpbmcpO1xuXG4gICAgICAvLyBXaXRoIFwiU3VidHlwXCIsIHRoZSBjb2xvciBvZiB0aGUgU3VidHlwIGJsb2NrIHRoZSBwcm9wZXJ0eSBjb21lcyBmcm9tIC1cbiAgICAgIC8vIGJ1dCBvbmx5IGlmIGV4YWN0bHkgb25lIGJsb2NrIG9mIHRoYXQgVFlQIGhhcyBpdC4gT3RoZXJ3aXNlIHRoZSBjaG9pY2VcbiAgICAgIC8vIHdvdWxkIGJlIGFyYml0cmFyeSBhbmQgY2hhbmdlIHdpdGggYmxvY2sgb3JkZXIsIHNvIHRoZSBUWVAgY29sb3JcbiAgICAgIC8vIChzdWJ0eXBDb2xvciB3aXRoIG51bGwpIGlzIHVzZWQuXG4gICAgICBpZiAoY291bnQgPT09IDEpIHtcbiAgICAgICAgY29uc3QgW1tvbmx5VHlwLCBzZWN0aW9uc11dID0gdHlwcztcbiAgICAgICAgY29uc3QgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5hbGxQcm9wZXJ0aWVzU3VidHlwXG4gICAgICAgICAgPyBzdWJ0eXBDb2xvcihwbHVnaW4uc2V0dGluZ3MsIG9ubHlUeXAsIHNlY3Rpb25zLmxlbmd0aCA9PT0gMSA/IHNlY3Rpb25zWzBdIDogbnVsbClcbiAgICAgICAgICA6IHBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbb25seVR5cF07XG4gICAgICAgIC8vICFpbXBvcnRhbnQsIGJlY2F1c2UgdGhlIGJvbGQgcnVsZSBpbiBzdHlsZXMuY3NzIGFsc28gc2V0cyBjb2xvclxuICAgICAgICAvLyAhaW1wb3J0YW50IGFuZCBjb3VsZCBzdGlsbCBiZSBhdHRhY2hlZCBmcm9tIGFuIGVhcmxpZXIgc3RhdGUuXG4gICAgICAgIGlmIChjb2xvcikgdGl0bGVFbC5zdHlsZS5zZXRQcm9wZXJ0eShcImNvbG9yXCIsIGNvbG9yLCBcImltcG9ydGFudFwiKTtcbiAgICAgICAgZWxzZSB0aXRsZUVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiY29sb3JcIik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aXRsZUVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiY29sb3JcIik7XG4gICAgICB9XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGFwcGx5RnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0KHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikpIHtcbiAgICBjb25zdCB2aWV3ID0gbGVhZi52aWV3O1xuICAgIGNvbnN0IHsgc3RhbmRhcmQsIGZsb2F0aW5nIH0gPSBrZXlzRm9yRmlsZShwbHVnaW4sIHZpZXc/LmZpbGUpO1xuICAgIGFwcGx5VG9Db250YWluZXIodmlldz8ubWV0YWRhdGFFZGl0b3I/LmNvbnRhaW5lckVsLCBzdGFuZGFyZCwgZmxvYXRpbmcpO1xuICB9XG5cbiAgLy8gVGhlIHByb3BlcnRpZXMgc2lkZWJhciBhbHdheXMgc2hvd3MgdGhlIGFjdGl2ZSBmaWxlIGJ1dCBrZWVwcyBubyByZWxpYWJsZVxuICAvLyByZWZlcmVuY2UgdG8gaXQsIGhlbmNlIHRoZSBmYWxsYmFjayB0byB0aGUgd29ya3NwYWNlJ3MgYWN0aXZlIGZpbGUuXG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJmaWxlLXByb3BlcnRpZXNcIikpIHtcbiAgICBjb25zdCB2aWV3ID0gbGVhZi52aWV3O1xuICAgIGNvbnN0IGZpbGUgPSB2aWV3Py5maWxlID8/IHBsdWdpbi5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICBjb25zdCB7IHN0YW5kYXJkLCBmbG9hdGluZyB9ID0ga2V5c0ZvckZpbGUocGx1Z2luLCBmaWxlKTtcbiAgICBhcHBseVRvQ29udGFpbmVyKHZpZXc/Lm1ldGFkYXRhRWRpdG9yPy5jb250YWluZXJFbCwgc3RhbmRhcmQsIGZsb2F0aW5nKTtcbiAgfVxuXG4gIC8vIFRoZSBUWVAtUGFuZTogZWFjaCBlZGl0b3Igc2hvd3MgZXhhY3RseSBvbmUgYmxvY2sgKFRZUCBvciBTdWJ0eXApLlxuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFZJRVdfVFlQRV9UWVBfUEFORSkpIHtcbiAgICBmb3IgKGNvbnN0IGVkaXRvciBvZiBsZWFmLnZpZXc/LmZyb250bWF0dGVyRWRpdG9ycyA/PyBbXSkge1xuICAgICAgY29uc3QgeyBzdGFuZGFyZCwgZmxvYXRpbmcgfSA9IGtleXNGb3JTdG9yZShwbHVnaW4sIGVkaXRvci5vd25lcj8udHlwU3RvcmUpO1xuICAgICAgYXBwbHlUb0NvbnRhaW5lcihlZGl0b3IuY29udGFpbmVyRWwsIHN0YW5kYXJkLCBmbG9hdGluZyk7XG4gICAgfVxuICB9XG5cbiAgYXBwbHlUb0FsbFByb3BlcnRpZXNWaWV3KHBsdWdpbik7XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyRnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0KHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQocGx1Z2luKTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLm1ldGFkYXRhQ2FjaGUub24oXCJjaGFuZ2VkXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC5tZXRhZGF0YUNhY2hlLm9uKFwicmVzb2x2ZWRcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImFjdGl2ZS1sZWFmLWNoYW5nZVwiLCByZWZyZXNoKSk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeShyZWZyZXNoKTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyRnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0IH07XG4iLCAiY29uc3QgeyBOb3RpY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgdHlwU3RvcmUsIHN1YnR5cFN0b3JlIH0gPSByZXF1aXJlKFwiLi90eXAtZnJvbnRtYXR0ZXItZWRpdG9yXCIpO1xuY29uc3QgeyBnZXRTdWJ0eXBOYW1lcywgaXNFbXB0eVZhbHVlIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBzXCIpO1xuY29uc3QgeyBwbHVyYWwsIGpvaW5BbmQgfSA9IHJlcXVpcmUoXCIuL3R5cC11dGlsc1wiKTtcbmNvbnN0IHsgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcblxuLy8gT2JzaWRpYW4gbG93ZXJjYXNlcyBwcm9wZXJ0eSBuYW1lcyBpbnRlcm5hbGx5LCBzbyBtYXRjaGluZyBpZ25vcmVzIGNhc2U7XG4vLyB0aGUgbmV3IG5hbWUgaXMga2VwdCBleGFjdGx5IGFzIHR5cGVkLlxuZnVuY3Rpb24gc2FtZUtleShhLCBiKSB7XG4gIHJldHVybiBhLnRvTG93ZXJDYXNlKCkgPT09IGIudG9Mb3dlckNhc2UoKTtcbn1cblxuLy8gUmVuYW1lcyBvbGRLZXkgaW4gb25lIGZyb250bWF0dGVyIGJsb2NrIChUWVAgb3IgU3VidHlwLCBzZWUgdHlwU3RvcmUvXG4vLyBzdWJ0eXBTdG9yZSBpbiB0eXAtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKSwga2VlcGluZyBpdHMgcG9zaXRpb24sIGFuZCBtb3Zlc1xuLy8gdGhlIGZsb2F0aW5nIGZsYWcgYWxvbmcuIElmIG5ld0tleSBhbHJlYWR5IGV4aXN0cyB0aGVyZSAoYSBtZXJnZSwgbGlrZVxuLy8gT2JzaWRpYW4ncyBvd24gbWVyZ2UgaW4gdGhlIG5vdGVzKSwgdGhlIGV4aXN0aW5nIGVudHJ5IGtlZXBzIGl0cyBwb3NpdGlvblxuLy8gYW5kIG9ubHkgdGFrZXMgdGhlIG9sZCB2YWx1ZSBpZiBpdHMgb3duIGlzIGVtcHR5LiBSZXR1cm5zIHRydWUgb24gYSBjaGFuZ2UuXG5mdW5jdGlvbiByZW5hbWVJblN0b3JlKHN0b3JlLCBvbGRLZXksIG5ld0tleSkge1xuICBjb25zdCBkZWZhdWx0cyA9IHN0b3JlLmdldEZyb250bWF0dGVyKCk7XG4gIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyhkZWZhdWx0cyk7XG4gIGNvbnN0IHNvdXJjZUtleSA9IGtleXMuZmluZCgoa2V5KSA9PiBzYW1lS2V5KGtleSwgb2xkS2V5KSk7XG4gIGlmIChzb3VyY2VLZXkgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZhbHNlO1xuICAvLyBBIHB1cmUgY2hhbmdlIG9mIGNhc2UgZmluZHMgc291cmNlS2V5IGl0c2VsZiBmb3IgbmV3S2V5IC0gbm90IGEgbWVyZ2UuXG4gIGNvbnN0IHRhcmdldEtleSA9IGtleXMuZmluZCgoa2V5KSA9PiBrZXkgIT09IHNvdXJjZUtleSAmJiBzYW1lS2V5KGtleSwgbmV3S2V5KSk7XG4gIGlmICh0YXJnZXRLZXkgPT09IHVuZGVmaW5lZCAmJiBzb3VyY2VLZXkgPT09IG5ld0tleSkgcmV0dXJuIGZhbHNlO1xuXG4gIGNvbnN0IG5leHQgPSB7fTtcbiAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykge1xuICAgIGlmIChrZXkgIT09IHNvdXJjZUtleSkge1xuICAgICAgbmV4dFtrZXldID0gZGVmYXVsdHNba2V5XTtcbiAgICB9IGVsc2UgaWYgKHRhcmdldEtleSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBuZXh0W25ld0tleV0gPSBkZWZhdWx0c1tzb3VyY2VLZXldO1xuICAgIH1cbiAgfVxuICBpZiAodGFyZ2V0S2V5ICE9PSB1bmRlZmluZWQgJiYgaXNFbXB0eVZhbHVlKG5leHRbdGFyZ2V0S2V5XSkpIG5leHRbdGFyZ2V0S2V5XSA9IGRlZmF1bHRzW3NvdXJjZUtleV07XG4gIHN0b3JlLnNldEZyb250bWF0dGVyKG5leHQpO1xuXG4gIGNvbnN0IGZsb2F0aW5nID0gc3RvcmUuZ2V0RmxvYXRpbmcoKTtcbiAgaWYgKGZsb2F0aW5nLmxlbmd0aCA+IDApIHtcbiAgICAvLyBPbiBhIG1lcmdlIHRoZSB0YXJnZXQncyBmbG9hdGluZyBmbGFnIHdpbnMuXG4gICAgc3RvcmUuc2V0RmxvYXRpbmcoXG4gICAgICB0YXJnZXRLZXkgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IGZsb2F0aW5nLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IHNvdXJjZUtleSlcbiAgICAgICAgOiBmbG9hdGluZy5tYXAoKGtleSkgPT4gKGtleSA9PT0gc291cmNlS2V5ID8gbmV3S2V5IDoga2V5KSlcbiAgICApO1xuICB9XG5cbiAgLy8gVGhlIHNob3J0Y3V0IGJlbG9uZ3MgdG8gdGhlIGtleSBhbmQgbW92ZXMgd2l0aCBpdDsgb24gYSBtZXJnZSB0aGVcbiAgLy8gdGFyZ2V0J3Mgd2lucywgYXMgd2l0aCBmbG9hdGluZy5cbiAgY29uc3Qgc2hvcnRjdXRzID0geyAuLi5zdG9yZS5nZXRTaG9ydGN1dHMoKSB9O1xuICBpZiAoc2hvcnRjdXRzW3NvdXJjZUtleV0pIHtcbiAgICBpZiAodGFyZ2V0S2V5ID09PSB1bmRlZmluZWQpIHNob3J0Y3V0c1tuZXdLZXldID0gc2hvcnRjdXRzW3NvdXJjZUtleV07XG4gICAgZGVsZXRlIHNob3J0Y3V0c1tzb3VyY2VLZXldO1xuICAgIHN0b3JlLnNldFNob3J0Y3V0cyhzaG9ydGN1dHMpO1xuICB9XG4gIHJldHVybiB0cnVlO1xufVxuXG4vLyBQaW5uZWQgZW50cmllcyBvZiB0aGUgZ2xvYmFsIG9yZGVyIGFsbG93IG5vIGR1cGxpY2F0ZXMsIHNvIGFuIGV4aXN0aW5nXG4vLyB0YXJnZXQgZW50cnkga2VlcHMgaXRzIHBvc2l0aW9uIGFuZCB0aGUgb2xkIG9uZSBnb2VzLlxuZnVuY3Rpb24gcmVuYW1lSW5HbG9iYWxPcmRlcihzZXR0aW5ncywgb2xkS2V5LCBuZXdLZXkpIHtcbiAgY29uc3Qgb3JkZXIgPSBzZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyO1xuICBjb25zdCBzb3VyY2UgPSBvcmRlci5maW5kKChlbnRyeSkgPT4gZW50cnkua2luZCA9PT0gXCJwcm9wZXJ0eVwiICYmIHNhbWVLZXkoZW50cnkubmFtZSwgb2xkS2V5KSk7XG4gIGlmICghc291cmNlKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHRhcmdldCA9IG9yZGVyLmZpbmQoKGVudHJ5KSA9PiBlbnRyeSAhPT0gc291cmNlICYmIGVudHJ5LmtpbmQgPT09IFwicHJvcGVydHlcIiAmJiBzYW1lS2V5KGVudHJ5Lm5hbWUsIG5ld0tleSkpO1xuICBpZiAodGFyZ2V0KSBzZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyID0gb3JkZXIuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkgIT09IHNvdXJjZSk7XG4gIGVsc2UgaWYgKHNvdXJjZS5uYW1lID09PSBuZXdLZXkpIHJldHVybiBmYWxzZTtcbiAgZWxzZSBzb3VyY2UubmFtZSA9IG5ld0tleTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHN5bmNSZW5hbWUocGx1Z2luLCBvbGRLZXksIG5ld0tleSkge1xuICBpZiAodHlwZW9mIG9sZEtleSAhPT0gXCJzdHJpbmdcIiB8fCB0eXBlb2YgbmV3S2V5ICE9PSBcInN0cmluZ1wiKSByZXR1cm47XG4gIG5ld0tleSA9IG5ld0tleS50cmltKCk7XG4gIGlmIChvbGRLZXkgPT09IFwiXCIgfHwgbmV3S2V5ID09PSBcIlwiIHx8IG9sZEtleSA9PT0gbmV3S2V5KSByZXR1cm47XG4gIC8vIFRZUC9TVUJUWVAgYXJlIG5ldmVyIHBhcnQgb2YgYSBibG9jayAoc2VlIHN0cmlwVHlwUHJvcGVydHkgaW5cbiAgLy8gdHlwLWZyb250bWF0dGVyLWVkaXRvci5qcyksIHNvIHJlbmFtZXMgZnJvbSBvciB0byB0aGVtIGFyZSBpZ25vcmVkLlxuICBpZiAoW29sZEtleSwgbmV3S2V5XS5zb21lKChrZXkpID0+IHNhbWVLZXkoa2V5LCBUWVBfUFJPUEVSVFkpIHx8IHNhbWVLZXkoa2V5LCBTVUJUWVBfUFJPUEVSVFkpKSkgcmV0dXJuO1xuXG4gIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHBsdWdpbjtcbiAgbGV0IHR5cENvdW50ID0gMDtcbiAgbGV0IHN1YnR5cENvdW50ID0gMDtcbiAgY29uc3QgY291bnQgPSAoc3RvcmUpID0+IChzdG9yZS5zdWJ0eXAgPyBzdWJ0eXBDb3VudCsrIDogdHlwQ291bnQrKyk7XG4gIGNvbnN0IHR5cHMgPSBuZXcgU2V0KFsuLi5PYmplY3Qua2V5cyhzZXR0aW5ncy50eXBEZWZhdWx0RnJvbnRtYXR0ZXIpLCAuLi5PYmplY3Qua2V5cyhzZXR0aW5ncy50eXBTdWJ0eXBzID8/IHt9KV0pO1xuICBmb3IgKGNvbnN0IHR5cCBvZiB0eXBzKSB7XG4gICAgY29uc3Qgc3RvcmVzID0gW3R5cFN0b3JlKHBsdWdpbiwgdHlwKSwgLi4uZ2V0U3VidHlwTmFtZXMoc2V0dGluZ3MsIHR5cCkubWFwKChzdWJ0eXApID0+IHN1YnR5cFN0b3JlKHBsdWdpbiwgdHlwLCBzdWJ0eXApKV07XG5cbiAgICAvLyBBIHZhdWx0LXdpZGUgcmVuYW1lIGhpdHMgRVZFUlkgYmxvY2sgaG9sZGluZyB0aGUga2V5IC0gdGhlIHNhbWUga2V5IG1heVxuICAgIC8vIGFwcGVhciBpbiBzZXZlcmFsIGJsb2NrcyAoc2VlIHR5cFN1YnR5cHMgaW4gc3VidHlwcy5qcykuIE9ubHkgd2l0aGluIG9uZVxuICAgIC8vIGJsb2NrIGNhbiB0aGUgbmV3IG5hbWUgY29sbGlkZTsgcmVuYW1lSW5TdG9yZSBtZXJnZXMgdGhlIHR3byB0aGVyZS5cbiAgICBmb3IgKGNvbnN0IHN0b3JlIG9mIHN0b3Jlcykge1xuICAgICAgaWYgKHJlbmFtZUluU3RvcmUoc3RvcmUsIG9sZEtleSwgbmV3S2V5KSkgY291bnQoc3RvcmUpO1xuICAgIH1cbiAgfVxuICBjb25zdCBvcmRlckNoYW5nZWQgPSByZW5hbWVJbkdsb2JhbE9yZGVyKHNldHRpbmdzLCBvbGRLZXksIG5ld0tleSk7XG4gIGlmICh0eXBDb3VudCA9PT0gMCAmJiBzdWJ0eXBDb3VudCA9PT0gMCAmJiAhb3JkZXJDaGFuZ2VkKSByZXR1cm47XG5cbiAgYXdhaXQgcGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICBwbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG5cbiAgY29uc3QgcGFydHMgPSBbXTtcbiAgaWYgKHR5cENvdW50ID4gMCkgcGFydHMucHVzaChwbHVyYWwodHlwQ291bnQsIFwiVFlQIGJsb2NrXCIpKTtcbiAgaWYgKHN1YnR5cENvdW50ID4gMCkgcGFydHMucHVzaChwbHVyYWwoc3VidHlwQ291bnQsIFwiU3VidHlwIGJsb2NrXCIpKTtcbiAgaWYgKG9yZGVyQ2hhbmdlZCkgcGFydHMucHVzaChcInRoZSBnbG9iYWwgb3JkZXJcIik7XG4gIG5ldyBOb3RpY2UoYFRZUC1TeXN0ZW06IHJlbmFtZWQgXCIke29sZEtleX1cIiBcdTIxOTIgXCIke25ld0tleX1cIiBpbiAke2pvaW5BbmQocGFydHMpfS5gKTtcbn1cblxuLy8gT2JzaWRpYW4ncyBcIkFsbCBwcm9wZXJ0aWVzXCIgdmlldyBhbmQgQmFzZXMgKG5hbWluZyBhIG5ldyBub3RlIHByb3BlcnR5KVxuLy8gcmVuYW1lIHByb3BlcnRpZXMgdmF1bHQtd2lkZSBvbmx5IHRocm91Z2ggYXBwLmZpbGVNYW5hZ2VyLnJlbmFtZVByb3BlcnR5LFxuLy8gc28gd3JhcHBpbmcgdGhhdCBvbmUgbWV0aG9kIGNhdGNoZXMgZXZlcnkgcmVhbCByZW5hbWUuIEJhc2VzJyBcIkRpc3BsYXlcbi8vIG5hbWVcIiBvbmx5IGNoYW5nZXMgdGhlIC5iYXNlIGZpbGUsIG5vdCB0aGUgbm90ZXMsIGFuZCByaWdodGx5IGRvZXNuJ3QgcGFzc1xuLy8gdGhyb3VnaCBoZXJlLlxuZnVuY3Rpb24gcmVnaXN0ZXJQcm9wZXJ0eVJlbmFtZVN5bmMocGx1Z2luKSB7XG4gIGNvbnN0IGZpbGVNYW5hZ2VyID0gcGx1Z2luLmFwcC5maWxlTWFuYWdlcjtcbiAgaWYgKGZpbGVNYW5hZ2VyLl9fdHlwU3lzdGVtUmVuYW1lU3luY1BhdGNoZWQpIHJldHVybjtcbiAgZmlsZU1hbmFnZXIuX190eXBTeXN0ZW1SZW5hbWVTeW5jUGF0Y2hlZCA9IHRydWU7XG5cbiAgY29uc3Qgb3JpZ2luYWwgPSBmaWxlTWFuYWdlci5yZW5hbWVQcm9wZXJ0eTtcbiAgZmlsZU1hbmFnZXIucmVuYW1lUHJvcGVydHkgPSBhc3luYyBmdW5jdGlvbiAob2xkS2V5LCBuZXdLZXksIC4uLnJlc3QpIHtcbiAgICAvLyBJZiB0aGUgb3JpZ2luYWwgdGhyb3dzIChhY2NlcHRSZW5hbWUgaGFuZGxlcyB0aGF0KSwgc2V0dGluZ3Mgc3RheSBhc1xuICAgIC8vIHRoZXkgYXJlLlxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IG9yaWdpbmFsLmNhbGwodGhpcywgb2xkS2V5LCBuZXdLZXksIC4uLnJlc3QpO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBzeW5jUmVuYW1lKHBsdWdpbiwgb2xkS2V5LCBuZXdLZXkpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiVFlQLVN5c3RlbTogcHJvcGVydHkgcmVuYW1lIG5vdCBhcHBsaWVkXCIsIGVycm9yKTtcbiAgICAgIG5ldyBOb3RpY2UoYFRZUC1TeXN0ZW06IHJlbmFtZSBvZiBcIiR7b2xkS2V5fVwiIG5vdCBhcHBsaWVkIFx1MjAxMyAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IHtcbiAgICBmaWxlTWFuYWdlci5yZW5hbWVQcm9wZXJ0eSA9IG9yaWdpbmFsO1xuICAgIGRlbGV0ZSBmaWxlTWFuYWdlci5fX3R5cFN5c3RlbVJlbmFtZVN5bmNQYXRjaGVkO1xuICB9KTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyUHJvcGVydHlSZW5hbWVTeW5jIH07XG4iLCAiY29uc3QgeyBGdXp6eVN1Z2dlc3RNb2RhbCwgTm90aWNlLCBwcmVwYXJlRnV6enlTZWFyY2ggfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgY29tcGFyZVR5cHMsIERFRkFVTFRfU09SVF9PUkRFUiB9ID0gcmVxdWlyZShcIi4vdHlwLXBhbmVcIik7XG5jb25zdCB7IG5hbWVDb2xvciwgcGFpbnRDb2xvckRvdCB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxuLy8gTmF0aXZlIHJlcGxhY2VtZW50IGZvciBUZW1wbGF0ZXIncyB0cC5zeXN0ZW0uc3VnZ2VzdGVyIHdoZW4gY2hvb3NpbmcgYSBUWVBcbi8vIChzZWUgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qcyksIGJ1aWx0IG9uIE9ic2lkaWFuJ3Ncbi8vIEZ1enp5U3VnZ2VzdE1vZGFsIGxpa2UgVGVtcGxhdGVyJ3Mgb3duLCBidXQgc2hvd2luZyBjb2xvciBvciBkb3QsXG4vLyBkZXNjcmlwdGlvbiBhbmQgbm90ZSBjb3VudCBwZXIgcm93LiBVbnJlZ2lzdGVyZWQgZW50cmllcyBhcmUgbXV0ZWQsIGFzIGluXG4vLyB0aGUgVFlQLUxpc3QuXG5jbGFzcyBUeXBQaWNrZXJNb2RhbCBleHRlbmRzIEZ1enp5U3VnZ2VzdE1vZGFsIHtcbiAgY29uc3RydWN0b3IoYXBwLCBwbHVnaW4sIGl0ZW1zLCByZXNvbHZlKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgICB0aGlzLml0ZW1zID0gaXRlbXM7XG4gICAgdGhpcy5yZXNvbHZlID0gcmVzb2x2ZTtcbiAgICB0aGlzLmNob3NlbiA9IGZhbHNlO1xuICAgIHRoaXMuc2V0UGxhY2Vob2xkZXIoXCJFU0MgdG8gY2FuY2VsXCIpO1xuICB9XG5cbiAgZ2V0SXRlbXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuaXRlbXM7XG4gIH1cblxuICAvLyBTZWFyY2ggYWxzbyBjb3ZlcnMgdGhlIGRlc2NyaXB0aW9uIGFuZCwgd2hlcmUgc2hvd24gaW4gdGhlIHJvd1xuICAvLyAoc2hvd1N1YnR5cHMpLCB0aGUgU3VidHlwIG5hbWVzOiB3aGF0IHlvdSBzZWUgeW91IGV4cGVjdCB0byBiZSBhYmxlIHRvIHR5cGUuXG4gIGdldEl0ZW1UZXh0KGl0ZW0pIHtcbiAgICByZXR1cm4gW2l0ZW0udHlwLCBpdGVtLnN1YnR5cHM/LmpvaW4oXCIgXCIpLCBpdGVtLmRlc2NyaXB0aW9uXS5maWx0ZXIoQm9vbGVhbikuam9pbihcIiBcIik7XG4gIH1cblxuICByZW5kZXJTdWdnZXN0aW9uKG1hdGNoLCBlbCkge1xuICAgIGNvbnN0IGl0ZW0gPSBtYXRjaC5pdGVtO1xuICAgIGVsLmFkZENsYXNzKFwidHlwLXBpY2tlci1zdWdnZXN0aW9uXCIpO1xuICAgIGlmIChpdGVtLnVucmVnaXN0ZXJlZCkgZWwuYWRkQ2xhc3MoXCJ0eXAtcGlja2VyLXVucmVnaXN0ZXJlZFwiKTtcblxuICAgIGlmIChpdGVtLnVucmVnaXN0ZXJlZCkge1xuICAgICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtcGlja2VyLW5hbWVcIiwgdGV4dDogaXRlbS50eXAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucmVuZGVyQ29sb3JlZE5hbWUoZWwsIGl0ZW0udHlwLCBpdGVtLnR5cCk7XG4gICAgfVxuXG4gICAgaWYgKGl0ZW0uc3VidHlwcz8ubGVuZ3RoKSB0aGlzLnJlbmRlclN1YnR5cFByZXZpZXcoZWwsIGl0ZW0pO1xuXG4gICAgaWYgKGl0ZW0uZGVzY3JpcHRpb24pIHtcbiAgICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXBpY2tlci1kZXNjXCIsIHRleHQ6IGl0ZW0uZGVzY3JpcHRpb24gfSk7XG4gICAgfVxuXG4gICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtcGlja2VyLWNvdW50XCIsIHRleHQ6IFN0cmluZyhpdGVtLmNvdW50KSB9KTtcbiAgfVxuXG4gIC8vIE5hbWUgaW4gdGhlIGNvbG9yIG9mIGNvbG9yVHlwIChvciBvZiB0aGUgU3VidHlwLCBzZWUgbmFtZUNvbG9yIGluXG4gIC8vIHR5cC1jb2xvcnMuanMpIC0gYXMgY29sb3JlZCB0ZXh0IG9yIHdpdGggYSBkb3QgYmVmb3JlIGl0LCBkZXBlbmRpbmcgb25cbiAgLy8gdGhlIFwiVFlQLVBhbmVcIiBjb2xvcmluZyBzZXR0aW5nLlxuICByZW5kZXJDb2xvcmVkTmFtZShlbCwgdGV4dCwgY29sb3JUeXAsIHN1YnR5cCA9IG51bGwpIHtcbiAgICBjb25zdCB7IGNvbG9yLCBpc0RlZmF1bHQgfSA9IG5hbWVDb2xvcih0aGlzLnBsdWdpbi5zZXR0aW5ncywgY29sb3JUeXAsIHN1YnR5cCk7XG4gICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdCkge1xuICAgICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtcGlja2VyLW5hbWVcIiwgdGV4dCB9KS5zdHlsZS5jb2xvciA9IGNvbG9yO1xuICAgIH0gZWxzZSB7XG4gICAgICBwYWludENvbG9yRG90KGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXBpY2tlci1kb3RcIiB9KSwgY29sb3IsIGlzRGVmYXVsdCk7XG4gICAgICBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1waWNrZXItbmFtZVwiLCB0ZXh0IH0pO1xuICAgIH1cbiAgfVxuXG4gIC8vIFwiVFlQIChTdWJ0eXAgMSwgU3VidHlwIDIpXCIgLSBzaG93cyB3aGF0IGxpZXMgYmVsb3cgdGhlIFRZUCBiZWZvcmUgdGhlXG4gIC8vIHNlcGFyYXRlIFN1YnR5cC1QaWNrZXIgY29tZXMuIEVhY2ggU3VidHlwIGluIGl0cyBvd24gY29sb3IsIGJyYWNrZXRzIGFuZFxuICAvLyBjb21tYXMgbXV0ZWQ7IHVuY29sb3JlZCBsaWtlIHRoZSBuYW1lIHdoZW4gXCJUWVAtUGFuZVwiIGNvbG9yaW5nIGlzIG9mZi5cbiAgcmVuZGVyU3VidHlwUHJldmlldyhlbCwgaXRlbSkge1xuICAgIGNvbnN0IGNvbG9yaXplID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0O1xuICAgIGNvbnN0IHdyYXAgPSBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1waWNrZXItc3VidHlwc1wiIH0pO1xuICAgIHdyYXAuYXBwZW5kVGV4dChcIihcIik7XG4gICAgaXRlbS5zdWJ0eXBzLmZvckVhY2goKHN1YnR5cCwgaW5kZXgpID0+IHtcbiAgICAgIGlmIChpbmRleCA+IDApIHdyYXAuYXBwZW5kVGV4dChcIiwgXCIpO1xuICAgICAgY29uc3Qgc3BhbiA9IHdyYXAuY3JlYXRlU3Bhbih7IHRleHQ6IHN1YnR5cCB9KTtcbiAgICAgIGlmIChjb2xvcml6ZSkgc3Bhbi5zdHlsZS5jb2xvciA9IG5hbWVDb2xvcih0aGlzLnBsdWdpbi5zZXR0aW5ncywgaXRlbS50eXAsIHN1YnR5cCkuY29sb3I7XG4gICAgfSk7XG4gICAgd3JhcC5hcHBlbmRUZXh0KFwiKVwiKTtcbiAgfVxuXG4gIC8vIE9ic2lkaWFuJ3Mgc2VsZWN0U3VnZ2VzdGlvbigpIGNhbGxzIGNsb3NlKCkgQkVGT1JFIG9uQ2hvb3NlSXRlbSgpLiBTZXRcbiAgLy8gXCJjaG9zZW5cIiBhbnkgbGF0ZXIgYW5kIG9uQ2xvc2UoKSByZXNvbHZlcyB3aXRoIG51bGwgZmlyc3QgLSBhIHByb21pc2Ugb25seVxuICAvLyByZXNvbHZlcyBvbmNlLCBzbyBldmVyeSBjaG9pY2Ugd291bGQgY29tZSBiYWNrIGFzIG51bGwuXG4gIHNlbGVjdFN1Z2dlc3Rpb24oaXRlbSwgZXZ0KSB7XG4gICAgdGhpcy5jaG9zZW4gPSB0cnVlO1xuICAgIC8vIFdoYXQgd2FzIHR5cGVkIHdoZW4gY2hvb3Npbmc7IHRoZSBTdWJ0eXAtUGlja2VyIHNvcnRzIGJ5IGl0IChzZWVcbiAgICAvLyBwaWNrVHlwRW50cnkvc29ydEJ5UXVlcnkpLlxuICAgIHRoaXMucXVlcnkgPSB0aGlzLmlucHV0RWwudmFsdWUudHJpbSgpO1xuICAgIHN1cGVyLnNlbGVjdFN1Z2dlc3Rpb24oaXRlbSwgZXZ0KTtcbiAgfVxuXG4gIG9uQ2hvb3NlSXRlbShpdGVtKSB7XG4gICAgdGhpcy5yZXNvbHZlKGl0ZW0udHlwKTtcbiAgfVxuXG4gIC8vIEVTQyBvciBhIGNsaWNrIG91dHNpZGUgY2xvc2VzIHdpdGhvdXQgc2VsZWN0U3VnZ2VzdGlvbjogcmVzb2x2ZSB3aXRoIG51bGxcbiAgLy8gaW5zdGVhZCBvZiBsZWF2aW5nIHRoZSBwcm9taXNlIGhhbmdpbmcsIGxpa2UgdHAuc3lzdGVtLnN1Z2dlc3Rlci5cbiAgb25DbG9zZSgpIHtcbiAgICBzdXBlci5vbkNsb3NlKCk7XG4gICAgaWYgKCF0aGlzLmNob3NlbikgdGhpcy5yZXNvbHZlKG51bGwpO1xuICB9XG59XG5cbi8vIFBpY2tzIGEgU3VidHlwIGZvciBhbiBhbHJlYWR5IGNob3NlbiBUWVAgKHNlZSBwaWNrU3VidHlwKS4gTGlrZVxuLy8gVHlwUGlja2VyTW9kYWwsIHBsdXMgYSBmaXJzdCByb3cgXCJUWVAgKG5vIFN1YnR5cClcIiAoaXRlbS5ub25lKS4gRVNDIHJlc29sdmVzXG4vLyB3aXRoIG51bGwsIGFuZCBUWVAuanMgZ29lcyBiYWNrIHRvIHRoZSBUWVAgY2hvaWNlLiBxdWVyeSBpcyB0aGUgc2VhcmNoIGZyb21cbi8vIHRoZSBUWVAtUGlja2VyIHRoYXQgcHJlLXNvcnRzIHRoZSBsaXN0LlxuY2xhc3MgU3VidHlwUGlja2VyTW9kYWwgZXh0ZW5kcyBUeXBQaWNrZXJNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKGFwcCwgcGx1Z2luLCB0eXAsIGl0ZW1zLCByZXNvbHZlLCBxdWVyeSA9IFwiXCIpIHtcbiAgICBzdXBlcihhcHAsIHBsdWdpbiwgaXRlbXMsIHJlc29sdmUpO1xuICAgIHRoaXMudHlwID0gdHlwO1xuICAgIHRoaXMuc2V0UGxhY2Vob2xkZXIoYFN1YnR5cCBmb3IgJHt0eXB9IFx1MjAxMyBFU0MgdG8gZ28gYmFja2ApO1xuICAgIHRoaXMuaXRlbXMgPSBzb3J0QnlRdWVyeShpdGVtcywgcXVlcnksIChpdGVtKSA9PiB0aGlzLmdldEl0ZW1UZXh0KGl0ZW0pKTtcbiAgfVxuXG4gIC8vIFRoZSBcIm5vIFN1YnR5cFwiIHJvdyBpcyBhbHNvIGZvdW5kIGJ5IHRoZSBUWVAgbmFtZSBpdCBzaG93cywgc28gXCJPUkdBXCJcbiAgLy8gdHlwZWQgaW4gdGhlIFRZUC1QaWNrZXIgYnJpbmdzIGl0IGJhY2sgdG8gdGhlIHRvcC5cbiAgZ2V0SXRlbVRleHQoaXRlbSkge1xuICAgIHJldHVybiBpdGVtLm5vbmUgPyBgJHt0aGlzLnR5cH0gJHtpdGVtLnR5cH1gIDogc3VwZXIuZ2V0SXRlbVRleHQoaXRlbSk7XG4gIH1cblxuICByZW5kZXJTdWdnZXN0aW9uKG1hdGNoLCBlbCkge1xuICAgIGNvbnN0IGl0ZW0gPSBtYXRjaC5pdGVtO1xuICAgIGVsLmFkZENsYXNzKFwidHlwLXBpY2tlci1zdWdnZXN0aW9uXCIpO1xuICAgIGlmIChpdGVtLm5vbmUpIHtcbiAgICAgIC8vIFwiT1JHQSAobm8gU3VidHlwKVwiOiB0aGUgVFlQIGluIGl0cyBjb2xvciwgdGhlIHN1ZmZpeCBpbiBub3JtYWwgdGV4dFxuICAgICAgLy8gY29sb3IgcmF0aGVyIHRoYW4gbXV0ZWQgLSBpdCBpcyBhIHJlYWwgY2hvaWNlLCBub3QgYSBncmF5ZWQtb3V0XG4gICAgICAvLyBub24tY2hvaWNlLCBhbmQgaXQgc3RhbmRzIGFwYXJ0IGZyb20gdGhlIFN1YnR5cCByb3dzIGJlbG93LlxuICAgICAgdGhpcy5yZW5kZXJDb2xvcmVkTmFtZShlbCwgdGhpcy50eXAsIHRoaXMudHlwKTtcbiAgICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXBpY2tlci1ub25lXCIsIHRleHQ6IGAoJHtpdGVtLnR5cH0pYCB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5yZW5kZXJDb2xvcmVkTmFtZShlbCwgaXRlbS50eXAsIHRoaXMudHlwLCBpdGVtLnR5cCk7XG4gICAgfVxuICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXBpY2tlci1jb3VudFwiLCB0ZXh0OiBTdHJpbmcoaXRlbS5jb3VudCkgfSk7XG4gIH1cblxuICBvbkNob29zZUl0ZW0oaXRlbSkge1xuICAgIHRoaXMucmVzb2x2ZShpdGVtLm5vbmUgPyBcIlwiIDogaXRlbS50eXApO1xuICB9XG59XG5cbi8vIFRZUC1QaWNrZXIgd2l0aCBlYWNoIFN1YnR5cCBpbmRlbnRlZCBiZWxvdyBpdHMgVFlQICh0aGUgZGVmYXVsdCB3aGlsZVxuLy8gXCJTZXBhcmF0ZSBTdWJ0eXAtUGlja2VyXCIgaXMgb2ZmLCBzZWUgcGlja1R5cEFuZFN1YnR5cCkuIFRoZSBUWVAgcm93IGl0c2VsZlxuLy8gbWVhbnMgXCJubyBTdWJ0eXBcIi4gU2VhcmNoIHdvcmtzIHBlciBncm91cCBzbyBhIFN1YnR5cCBuZXZlciBhcHBlYXJzIHdpdGhvdXRcbi8vIGl0cyBUWVA6IGEgVFlQIG1hdGNoIGtlZXBzIGFsbCBpdHMgU3VidHlwcywgYSBTdWJ0eXAgbWF0Y2gga2VlcHMgdGhhdCBTdWJ0eXBcbi8vIHdpdGggaXRzIFRZUC4gR3JvdXBzIHNvcnQgYnkgdGhlaXIgYmVzdCBtYXRjaDsgd2l0aGluIGEgZ3JvdXAgYmxvY2sgb3JkZXJcbi8vIHN0YXlzLlxuY2xhc3MgVHlwU3VidHlwUGlja2VyTW9kYWwgZXh0ZW5kcyBUeXBQaWNrZXJNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKGFwcCwgcGx1Z2luLCBncm91cHMsIHJlc29sdmUpIHtcbiAgICBzdXBlcihhcHAsIHBsdWdpbiwgZ3JvdXBzLm1hcCgoZ3JvdXApID0+IGdyb3VwLml0ZW0pLCByZXNvbHZlKTtcbiAgICB0aGlzLmdyb3VwcyA9IGdyb3VwcztcbiAgfVxuXG4gIGdldFN1Z2dlc3Rpb25zKHF1ZXJ5KSB7XG4gICAgY29uc3Qgc2VhcmNoID0gcXVlcnkudHJpbSgpID8gcHJlcGFyZUZ1enp5U2VhcmNoKHF1ZXJ5LnRyaW0oKSkgOiBudWxsO1xuICAgIGNvbnN0IG5vTWF0Y2ggPSB7IHNjb3JlOiAwLCBtYXRjaGVzOiBbXSB9O1xuICAgIGNvbnN0IHJlc3VsdHMgPSBbXTtcbiAgICBmb3IgKGNvbnN0IHsgaXRlbSwgc3VidHlwcyB9IG9mIHRoaXMuZ3JvdXBzKSB7XG4gICAgICBjb25zdCB0eXBNYXRjaCA9IHNlYXJjaCA/IHNlYXJjaCh0aGlzLmdldEl0ZW1UZXh0KGl0ZW0pKSA6IG5vTWF0Y2g7XG4gICAgICBsZXQgc3VidHlwTWF0Y2hlcyA9IHN1YnR5cHMubWFwKChzdWJ0eXApID0+ICh7IGl0ZW06IHN1YnR5cCwgbWF0Y2g6IHNlYXJjaCA/IHNlYXJjaChzdWJ0eXAuc3VidHlwKSA6IG5vTWF0Y2ggfSkpO1xuICAgICAgaWYgKCF0eXBNYXRjaCkgc3VidHlwTWF0Y2hlcyA9IHN1YnR5cE1hdGNoZXMuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkubWF0Y2gpO1xuICAgICAgaWYgKCF0eXBNYXRjaCAmJiBzdWJ0eXBNYXRjaGVzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG5cbiAgICAgIGNvbnN0IHNjb3JlcyA9IFt0eXBNYXRjaCwgLi4uc3VidHlwTWF0Y2hlcy5tYXAoKGVudHJ5KSA9PiBlbnRyeS5tYXRjaCldLmZpbHRlcihCb29sZWFuKS5tYXAoKG1hdGNoKSA9PiBtYXRjaC5zY29yZSk7XG4gICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICBzY29yZTogTWF0aC5tYXgoLi4uc2NvcmVzKSxcbiAgICAgICAgcm93czogW3sgaXRlbSwgbWF0Y2g6IHR5cE1hdGNoID8/IG5vTWF0Y2ggfSwgLi4uc3VidHlwTWF0Y2hlcy5tYXAoKGVudHJ5KSA9PiAoeyBpdGVtOiBlbnRyeS5pdGVtLCBtYXRjaDogZW50cnkubWF0Y2ggPz8gbm9NYXRjaCB9KSldLFxuICAgICAgfSk7XG4gICAgfVxuICAgIGlmIChzZWFyY2gpIHJlc3VsdHMuc29ydCgoYSwgYikgPT4gYi5zY29yZSAtIGEuc2NvcmUpO1xuICAgIHJldHVybiByZXN1bHRzLmZsYXRNYXAoKGdyb3VwKSA9PiBncm91cC5yb3dzKTtcbiAgfVxuXG4gIHJlbmRlclN1Z2dlc3Rpb24obWF0Y2gsIGVsKSB7XG4gICAgY29uc3QgaXRlbSA9IG1hdGNoLml0ZW07XG4gICAgaWYgKCFpdGVtLnN1YnR5cCkge1xuICAgICAgc3VwZXIucmVuZGVyU3VnZ2VzdGlvbihtYXRjaCwgZWwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBlbC5hZGRDbGFzcyhcInR5cC1waWNrZXItc3VnZ2VzdGlvblwiLCBcInR5cC1waWNrZXItc3VidHlwXCIpO1xuICAgIHRoaXMucmVuZGVyQ29sb3JlZE5hbWUoZWwsIGl0ZW0uc3VidHlwLCBpdGVtLnR5cCwgaXRlbS5zdWJ0eXApO1xuICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXBpY2tlci1jb3VudFwiLCB0ZXh0OiBTdHJpbmcoaXRlbS5jb3VudCkgfSk7XG4gIH1cblxuICBvbkNob29zZUl0ZW0oaXRlbSkge1xuICAgIHRoaXMucmVzb2x2ZSh7IHR5cDogaXRlbS50eXAsIHN1YnR5cDogaXRlbS5zdWJ0eXAgPz8gbnVsbCB9KTtcbiAgfVxufVxuXG4vLyBJbml0aWFsIG9yZGVyIG9mIGEgcGlja2VyIGxpc3QgZ2l2ZW4gYW4gYWxyZWFkeSB0eXBlZCBxdWVyeSAoZnJvbSB0aGVcbi8vIFRZUC1QaWNrZXIsIHNlZSBwaWNrVHlwRW50cnkpOiBtYXRjaGVzIGZpcnN0IGJ5IHNjb3JlLCB0aGUgcmVzdCBhZnRlciBpblxuLy8gdW5jaGFuZ2VkIG9yZGVyLiBJZiBub3RoaW5nIG1hdGNoZXMgKGEgZGVzY3JpcHRpb24gd2FzIHR5cGVkLCBzYXkpIHRoZVxuLy8gbGlzdCBzdGF5cyBhcyBpdCB3YXMuIFR5cGluZyBpbiB0aGUgcGlja2VyIGl0c2VsZiB1c2VzIE9ic2lkaWFuJ3Mgc2VhcmNoLlxuZnVuY3Rpb24gc29ydEJ5UXVlcnkoaXRlbXMsIHF1ZXJ5LCBpdGVtVGV4dCkge1xuICBjb25zdCBzZWFyY2ggPSBxdWVyeT8udHJpbSgpID8gcHJlcGFyZUZ1enp5U2VhcmNoKHF1ZXJ5LnRyaW0oKSkgOiBudWxsO1xuICBpZiAoIXNlYXJjaCkgcmV0dXJuIGl0ZW1zO1xuICBjb25zdCBzY29yZWQgPSBpdGVtcy5tYXAoKGl0ZW0sIGluZGV4KSA9PiAoeyBpdGVtLCBpbmRleCwgc2NvcmU6IHNlYXJjaChpdGVtVGV4dChpdGVtKSk/LnNjb3JlID8/IG51bGwgfSkpO1xuICBpZiAoc2NvcmVkLmV2ZXJ5KChlbnRyeSkgPT4gZW50cnkuc2NvcmUgPT09IG51bGwpKSByZXR1cm4gaXRlbXM7XG4gIHNjb3JlZC5zb3J0KChhLCBiKSA9PiB7XG4gICAgaWYgKGEuc2NvcmUgPT09IG51bGwgfHwgYi5zY29yZSA9PT0gbnVsbCkgcmV0dXJuIGEuc2NvcmUgPT09IGIuc2NvcmUgPyBhLmluZGV4IC0gYi5pbmRleCA6IGEuc2NvcmUgPT09IG51bGwgPyAxIDogLTE7XG4gICAgcmV0dXJuIGIuc2NvcmUgLSBhLnNjb3JlIHx8IGEuaW5kZXggLSBiLmluZGV4O1xuICB9KTtcbiAgcmV0dXJuIHNjb3JlZC5tYXAoKGVudHJ5KSA9PiBlbnRyeS5pdGVtKTtcbn1cblxuLy8gRm9yIFRZUC5qczogb3BlbnMgdGhlIFN1YnR5cC1QaWNrZXIgaWYgdGhlIFRZUCBoYXMgYXQgbGVhc3Qgb25lIHJlZ2lzdGVyZWRcbi8vIFN1YnR5cCAoaW4gYmxvY2sgb3JkZXIpLiBxdWVyeSBwcmUtc29ydHMgdGhlIGxpc3Q6IHR5cGluZyBcIkxlaHJ2ZXJhbnN0YWx0dW5nXCJcbi8vIHRvIHJlYWNoIE9SR0EgbWVhbnQgdGhhdCBTdWJ0eXAsIHdoaWNoIHRoZW4gc2l0cyBvbiB0b3AgLSBFbnRlciBzdWZmaWNlcy5cbi8vIG9wdGlvbnMgYXMgaW4gZ2V0U3VidHlwczogU3VidHlwcyB0aGF0IGFyZW4ndCBtYW51YWxseSBjcmVhdGFibGUgYXJlIGxlZnRcbi8vIG91dCBieSBkZWZhdWx0LCBsaWtlIHN1Y2ggVFlQIGVudHJpZXMgYmVmb3JlLiBSZXNvbHZlcyB3aXRoXG4vLyAgLSB0aGUgY2hvc2VuIFN1YnR5cCxcbi8vICAtIFwiXCIgZm9yIFwibm8gU3VidHlwXCIgKHRoZSBmaXJzdCByb3cgd2l0aG91dCBhIHF1ZXJ5KSAtIG9yIHJpZ2h0IGF3YXksXG4vLyAgICB3aXRob3V0IGEgcGlja2VyLCBpZiB0aGUgVFlQIGhhcyBubyBzZWxlY3RhYmxlIFN1YnR5cCxcbi8vICAtIG51bGwgb24gRVNDIChUWVAuanMgZ29lcyBiYWNrIHRvIHRoZSBUWVAgY2hvaWNlKS5cbmZ1bmN0aW9uIHBpY2tTdWJ0eXAoYXBwLCBwbHVnaW4sIHR5cCwgcXVlcnkgPSBcIlwiLCBvcHRpb25zID0ge30pIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgY29uc3QgaXRlbXMgPSBwbHVnaW4uZ2V0U3VidHlwcyh0eXAsIG9wdGlvbnMpLm1hcCgoeyBzdWJ0eXAsIGNvdW50IH0pID0+ICh7IHR5cDogc3VidHlwLCBkZXNjcmlwdGlvbjogXCJcIiwgY291bnQgfSkpO1xuICAgIGlmIChpdGVtcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHJlc29sdmUoXCJcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIC8vIFwibm8gU3VidHlwXCIgZmlyc3Q6IEVudGVyIHBpY2tzIGl0IHdpdGhvdXQgdHlwaW5nLCBhbmQgaXQgaXMgbW9yZSBjb21tb25cbiAgICAvLyB0aGFuIGFueSBzaW5nbGUgU3VidHlwLlxuICAgIGNvbnN0IG5vbmVDb3VudCA9IHBsdWdpbi50eXBJbmRleC5zdWJ0eXBCdWNrZXQodHlwKS5ub1N1YnR5cDtcbiAgICBpdGVtcy51bnNoaWZ0KHsgdHlwOiBcIm5vIFN1YnR5cFwiLCBkZXNjcmlwdGlvbjogXCJcIiwgY291bnQ6IG5vbmVDb3VudCwgbm9uZTogdHJ1ZSB9KTtcbiAgICBuZXcgU3VidHlwUGlja2VyTW9kYWwoYXBwLCBwbHVnaW4sIHR5cCwgaXRlbXMsIHJlc29sdmUsIHF1ZXJ5KS5vcGVuKCk7XG4gIH0pO1xufVxuXG4vLyBUWVAgdmFsdWVzIHRoYXQgb2NjdXIgaW4gbm90ZXMgYnV0IGFyZW4ndCBpbiBzZXR0aW5ncy50eXBzLCBsaWtlIHRoZVxuLy8gdW5yZWdpc3RlcmVkIHJvd3Mgb2YgdGhlIFRZUC1MaXN0LiBMaXN0cyBhbmQgcGFkZGVkIHZhbHVlcyAoc2VlIGlzQ2xlYW5LZXkpXG4vLyBhcmUgbGVmdCBvdXQ6IHRoZSBjaG9zZW4gdmFsdWUgaXMgd3JpdHRlbiBpbnRvIGEgbmV3IG5vdGUgYW5kIHNob3VsZG4ndCBiZSBhXG4vLyBjbGVhbnVwIGNhc2UgdGhlcmUuXG5mdW5jdGlvbiB1bnJlZ2lzdGVyZWRJdGVtcyhhcHAsIHBsdWdpbikge1xuICBjb25zdCByZWdpc3RlcmVkID0gbmV3IFNldChwbHVnaW4uc2V0dGluZ3MudHlwcyk7XG4gIGNvbnN0IHsgY291bnRzIH0gPSBwbHVnaW4udHlwSW5kZXgudHlwQ291bnRzKCk7XG4gIGNvbnN0IHNvcnRPcmRlciA9IHBsdWdpbi5zZXR0aW5ncy50eXBTb3J0T3JkZXIgPz8gREVGQVVMVF9TT1JUX09SREVSO1xuICByZXR1cm4gWy4uLmNvdW50cy5rZXlzKCldXG4gICAgLmZpbHRlcigodHlwKSA9PiAhcmVnaXN0ZXJlZC5oYXModHlwKSAmJiBwbHVnaW4udHlwSW5kZXguaXNDbGVhbktleSh0eXApKVxuICAgIC5zb3J0KChhLCBiKSA9PiBjb21wYXJlVHlwcyhzb3J0T3JkZXIsIGEsIGIsIGNvdW50cywgcGx1Z2luLnNldHRpbmdzLnR5cENvbG9ycykpXG4gICAgLm1hcCgodHlwKSA9PiAoeyB0eXAsIGRlc2NyaXB0aW9uOiBcIlwiLCBjb3VudDogY291bnRzLmdldCh0eXApID8/IDAsIHVucmVnaXN0ZXJlZDogdHJ1ZSB9KSk7XG59XG5cbi8vIFBpY2tzIGEgc2luZ2xlIFRZUCwgZm9yIFRZUC5qcyBhbmQgZXZlcnl3aGVyZSBpbiB0aGUgcGx1Z2luLiBpbmNsdWRlTWFudWFsT2ZmXG4vLyBhcyBpbiBnZXRUeXBzKCk7IGluY2x1ZGVVbnJlZ2lzdGVyZWQgYWRkcyB2YWx1ZXMgdGhhdCBvY2N1ciBpbiBub3RlcyBidXRcbi8vIGFyZW4ndCByZWdpc3RlcmVkIChtdXRlZCkuIHNob3dTdWJ0eXBzIHB1dHMgdGhlIFN1YnR5cCBuYW1lcyBhZnRlciB0aGUgVFlQXG4vLyBuYW1lLCBmb3IgdGhlIHNlcGFyYXRlIGZsb3cgd2hlcmUgdGhlIFN1YnR5cC1QaWNrZXIgY29tZXMgYWZ0ZXJ3YXJkcy5cbi8vIFJlc29sdmVzIHdpdGggdGhlIFRZUCwgb3IgbnVsbCBvbiBjYW5jZWwgb3IgaWYgdGhlcmUgaXMgbm90aGluZyB0byBzaG93LlxuZnVuY3Rpb24gcGlja1R5cChhcHAsIHBsdWdpbiwgb3B0aW9ucyA9IHt9KSB7XG4gIHJldHVybiBwaWNrVHlwRW50cnkoYXBwLCBwbHVnaW4sIG9wdGlvbnMpLnRoZW4oKGVudHJ5KSA9PiBlbnRyeT8udHlwID8/IG51bGwpO1xufVxuXG4vLyBMaWtlIHBpY2tUeXAsIGJ1dCByZXNvbHZlcyB3aXRoIHsgdHlwLCBxdWVyeSB9LCBxdWVyeSBiZWluZyB3aGF0IHdhcyB0eXBlZC5cbi8vIE9ubHkgZm9yIHBpY2tUeXBBbmRTdWJ0eXAsIHdoaWNoIHBhc3NlcyBpdCBvbiB0byB0aGUgU3VidHlwLVBpY2tlci5cbmZ1bmN0aW9uIHBpY2tUeXBFbnRyeShhcHAsIHBsdWdpbiwgb3B0aW9ucyA9IHt9KSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgIGNvbnN0IGl0ZW1zID0gdHlwSXRlbXMoYXBwLCBwbHVnaW4sIG9wdGlvbnMpO1xuICAgIGlmICghaXRlbXMpIHtcbiAgICAgIHJlc29sdmUobnVsbCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IG1vZGFsID0gbmV3IFR5cFBpY2tlck1vZGFsKGFwcCwgcGx1Z2luLCBpdGVtcywgKHR5cCkgPT4gcmVzb2x2ZSh0eXAgPT09IG51bGwgPyBudWxsIDogeyB0eXAsIHF1ZXJ5OiBtb2RhbC5xdWVyeSB9KSk7XG4gICAgbW9kYWwub3BlbigpO1xuICB9KTtcbn1cblxuLy8gU2hhcmVkIFRZUCBsaXN0IGZvciBwaWNrVHlwL3BpY2tUeXBBbmRTdWJ0eXA7IG51bGwgcGx1cyBhIG5vdGljZSBpZiB0aGVyZSBpc1xuLy8gbm90aGluZyB0byBzaG93IHdpdGggdGhlc2Ugb3B0aW9ucy5cbmZ1bmN0aW9uIHR5cEl0ZW1zKGFwcCwgcGx1Z2luLCB7IGluY2x1ZGVNYW51YWxPZmYgPSBmYWxzZSwgaW5jbHVkZVVucmVnaXN0ZXJlZCA9IGZhbHNlLCBzaG93U3VidHlwcyA9IGZhbHNlIH0gPSB7fSkge1xuICBjb25zdCBpdGVtcyA9IHBsdWdpbi5nZXRUeXBzKHsgaW5jbHVkZU1hbnVhbE9mZiB9KS5tYXAoKGl0ZW0pID0+ICh7IC4uLml0ZW0sIHVucmVnaXN0ZXJlZDogZmFsc2UgfSkpO1xuICBpZiAoaW5jbHVkZVVucmVnaXN0ZXJlZCkgaXRlbXMucHVzaCguLi51bnJlZ2lzdGVyZWRJdGVtcyhhcHAsIHBsdWdpbikpO1xuICAvLyBPbmx5IHJlZ2lzdGVyZWQgVFlQIGVudHJpZXMgaGF2ZSBTdWJ0eXBzOyB0aGUgb3RoZXJzIHN0YXkgdW5jaGFuZ2VkLlxuICBpZiAoc2hvd1N1YnR5cHMpIHtcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMpIGl0ZW0uc3VidHlwcyA9IHBsdWdpbi5nZXRTdWJ0eXBzKGl0ZW0udHlwLCB7IGluY2x1ZGVNYW51YWxPZmYgfSkubWFwKCh7IHN1YnR5cCB9KSA9PiBzdWJ0eXApO1xuICB9XG4gIGlmIChpdGVtcy5sZW5ndGggPiAwKSByZXR1cm4gaXRlbXM7XG4gIG5ldyBOb3RpY2UoXCJObyBUWVAgYXZhaWxhYmxlLlwiKTtcbiAgcmV0dXJuIG51bGw7XG59XG5cbi8vIEZvciBUWVAuanM6IFRZUCBhbmQgU3VidHlwIGluIG9uZSBnby4gV2l0aCBzZXBhcmF0ZVN1YnR5cFBpY2tlciBvZmYsIG9uZVxuLy8gcGlja2VyIHdpdGggZWFjaCBTdWJ0eXAgaW5kZW50ZWQgYmVsb3cgaXRzIFRZUDsgd2l0aCBpdCBvbiwgZmlyc3QgdGhlXG4vLyBUWVAtUGlja2VyIChTdWJ0eXAgbmFtZXMgYWZ0ZXIgdGhlIFRZUCBuYW1lKSBhbmQgdGhlbiwgaWYgdGhlcmUgaXMgYVxuLy8gc2VsZWN0YWJsZSBTdWJ0eXAsIHRoZSBTdWJ0eXAtUGlja2VyIHByZS1zb3J0ZWQgYnkgdGhlIHF1ZXJ5IChFU0MgZ29lcyBiYWNrXG4vLyB0byB0aGUgVFlQIGNob2ljZSkuIGluY2x1ZGVNYW51YWxPZmYgYWxzbyBhcHBsaWVzIHRvIHRoZSBTdWJ0eXBzLlxuLy8gUmVzb2x2ZXMgd2l0aCB7IHR5cCwgc3VidHlwIH0gKHN1YnR5cCBudWxsIGZvciBcIm5vIFN1YnR5cFwiKSwgb3IgbnVsbCBvblxuLy8gY2FuY2VsLlxuYXN5bmMgZnVuY3Rpb24gcGlja1R5cEFuZFN1YnR5cChhcHAsIHBsdWdpbiwgb3B0aW9ucyA9IHt9KSB7XG4gIGlmIChwbHVnaW4uc2V0dGluZ3Muc2VwYXJhdGVTdWJ0eXBQaWNrZXIpIHtcbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgY29uc3QgZW50cnkgPSBhd2FpdCBwaWNrVHlwRW50cnkoYXBwLCBwbHVnaW4sIHsgLi4ub3B0aW9ucywgc2hvd1N1YnR5cHM6IHRydWUgfSk7XG4gICAgICBpZiAoIWVudHJ5KSByZXR1cm4gbnVsbDtcbiAgICAgIGNvbnN0IHN1YnR5cCA9IGF3YWl0IHBpY2tTdWJ0eXAoYXBwLCBwbHVnaW4sIGVudHJ5LnR5cCwgZW50cnkucXVlcnksIG9wdGlvbnMpO1xuICAgICAgaWYgKHN1YnR5cCAhPT0gbnVsbCkgcmV0dXJuIHsgdHlwOiBlbnRyeS50eXAsIHN1YnR5cDogc3VidHlwIHx8IG51bGwgfTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBpdGVtcyA9IHR5cEl0ZW1zKGFwcCwgcGx1Z2luLCBvcHRpb25zKTtcbiAgaWYgKCFpdGVtcykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGdyb3VwcyA9IGl0ZW1zLm1hcCgoaXRlbSkgPT4gKHtcbiAgICBpdGVtLFxuICAgIHN1YnR5cHM6IHBsdWdpbi5nZXRTdWJ0eXBzKGl0ZW0udHlwLCBvcHRpb25zKS5tYXAoKHsgc3VidHlwLCBjb3VudCB9KSA9PiAoeyB0eXA6IGl0ZW0udHlwLCBzdWJ0eXAsIGNvdW50IH0pKSxcbiAgfSkpO1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IG5ldyBUeXBTdWJ0eXBQaWNrZXJNb2RhbChhcHAsIHBsdWdpbiwgZ3JvdXBzLCByZXNvbHZlKS5vcGVuKCkpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcGlja1R5cCwgcGlja1N1YnR5cCwgcGlja1R5cEFuZFN1YnR5cCB9O1xuIiwgImNvbnN0IHsgVEZpbGUsIFZhdWx0LCBkZWJvdW5jZSwgbm9ybWFsaXplUGF0aCB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuXG4vLyBPbmx5IFRlbXBsYXRlciBzY3JpcHRzIHdpdGggdGhpcyBtYXJrZXIgaW4gYSBjb21tZW50IGFyZSBvZmZlcmVkIGluIHRoZVxuLy8gc2hvcnRjdXQgcGlja2VyOyBoZWxwZXIgc2NyaXB0cyBtYWtlIG5vIHNlbnNlIGFzIHNob3J0Y3V0cy4gVGhlIHRleHQgYWZ0ZXJcbi8vIHRoZSBtYXJrZXIgdXAgdG8gdGhlIGxpbmUgZW5kIGlzIHRoZSBkZXNjcmlwdGlvbiAoYSBjbG9zaW5nIFwiKi9cIiBpcyBub3Rcbi8vIHBhcnQgb2YgaXQpLlxuLy9cbi8vIEFuIG9wdGlvbmFsIHBhcmFtZXRlciBsaXN0IGluIHBhcmVudGhlc2VzIHJpZ2h0IGFmdGVyIHRoZSBtYXJrZXIgZGVzY3JpYmVzXG4vLyB0aGUgQ09NUExFVEUgYXJndW1lbnQgbGlzdCBhZnRlciBcInRwXCIsIGluY2x1ZGluZyB3aGVyZSB0aGUgc2NyaXB0IHdhbnRzIHRoZVxuLy8gZmlsZSBvciBjb250ZXh0IChzZWUgUkVTRVJWRURfUEFSQU1TIGluIHNob3J0Y3V0cy5qcyk6XG4vLyAgIC8vIEB0eXAtc2hvcnRjdXQoZm9sZGVyLCB5ZWFyKSAgICAgIC0+IGYodHAsIFwiTGl0ZXJhdHVyXCIsIDIwMjQpXG4vLyAgIC8vIEB0eXAtc2hvcnRjdXQobmV3RmlsZSwgeWVhcikgICAgIC0+IGYodHAsIG5ld0ZpbGUsIDIwMjQpXG4vLyAgIC8vIEB0eXAtc2hvcnRjdXQocHJvcGVydHkpICAgICAgICAgIC0+IGYodHAsIFwiRmFtaWxpZVwiKVxuLy8gICAvLyBAdHlwLXNob3J0Y3V0ICAgICAgICAgICAgICAgICAgICAtPiBmKHRwLCBuZXdGaWxlLCBjdHgpXG4vLyBObyBwYXJlbnRoZXNlcyAocGFyYW1zID09PSBudWxsKSBpcyB0aGUgY2xhc3NpYyBjYWxsIGYodHAsIG5ld0ZpbGUsIGN0eCk7XG4vLyBlbXB0eSBwYXJlbnRoZXNlcyAocGFyYW1zID09PSBbXSkgcGFzcyBvbmx5IHRwLlxuLy9cbi8vIFRoZSBtYXJrZXIgbXVzdCBzdGFydCB0aGUgY29tbWVudC4gQWxsb3dpbmcgdGV4dCBiZWZvcmUgaXQgb25jZSB0dXJuZWRcbi8vIFRZUC5qcyBpbnRvIGEgc2hvcnRjdXQsIGp1c3QgYmVjYXVzZSBpdHMgaGVhZGVyIGNvbW1lbnQgbWVudGlvbnMgdGhlIG1hcmtlci5cbi8vIFwiXFxiXCIgYWZ0ZXIgdGhlIG5hbWUgcmVqZWN0cyBcIkB0eXAtc2hvcnRjdXRYWVpcIiBidXQgYWxsb3dzIHRoZSBcIihcIi5cbmNvbnN0IFNIT1JUQ1VUX01BUktFUiA9IC9eWyBcXHRdKig/OlxcL1xcLyt8XFwvXFwqK3xcXCopWyBcXHRdKkB0eXAtc2hvcnRjdXRcXGIoPzpcXCgoW14pXSopXFwpKT9bIFxcdF0qKC4qPylbIFxcdF0qKD86XFwqXFwvKT9bIFxcdF0qJC9tO1xuXG4vLyBQYXJhbWV0ZXIgbmFtZXMgZnJvbSB0aGUgbWFya2VyLCBpbiBkZWNsYXJlZCBvcmRlci4gRW1wdHkgZW50cmllcyAoXCIoKVwiLCBhXG4vLyBzdHJheSBjb21tYSkgYXJlIGRyb3BwZWQsIGR1cGxpY2F0ZXMga2VwdCBvbmNlIC0gdHdvIGZpZWxkcyB3cml0aW5nIHRoZSBzYW1lXG4vLyBlbnRyeSB3b3VsZCBvbmx5IGNvbmZ1c2UuXG5mdW5jdGlvbiBwYXJzZVBhcmFtcyhyYXcpIHtcbiAgY29uc3QgbmFtZXMgPSAocmF3ID8/IFwiXCIpXG4gICAgLnNwbGl0KFwiLFwiKVxuICAgIC5tYXAoKG5hbWUpID0+IG5hbWUudHJpbSgpKVxuICAgIC5maWx0ZXIoKG5hbWUpID0+IG5hbWUgIT09IFwiXCIpO1xuICByZXR1cm4gWy4uLm5ldyBTZXQobmFtZXMpXTtcbn1cblxuLy8gS2VlcHMgdGhlIGxpc3Qgb2YgbWFya2VkIFRlbXBsYXRlciBzY3JpcHRzIGN1cnJlbnQuIEl0IGlzIHJlYWQgYWhlYWQgb2YgdGltZVxuLy8gYW5kIHVwZGF0ZWQgb24gY2hhbmdlcywgc28gdGhlIHBpY2tlciBvcGVucyB3aXRob3V0IHdhaXRpbmcgYW5kIHdpdGhvdXQgZmlsZVxuLy8gYWNjZXNzLiBSZXR1cm5zIGFuIGFjY2Vzc29yIGZvciB0aGUgbGlzdCAoW3sgbmFtZSwgcGFyYW1zLCBkZXNjcmlwdGlvbiB9XSxcbi8vIHNvcnRlZCBieSBuYW1lKS5cbmZ1bmN0aW9uIHJlZ2lzdGVyU2hvcnRjdXRTY3JpcHRzKHBsdWdpbikge1xuICBjb25zdCB7IGFwcCB9ID0gcGx1Z2luO1xuXG4gIGxldCBzY3JpcHRGb2xkZXIgPSBudWxsO1xuICBsZXQgc2NyaXB0cyA9IFtdO1xuXG4gIGNvbnN0IGN1cnJlbnRTY3JpcHRGb2xkZXIgPSAoKSA9PiB7XG4gICAgY29uc3QgZm9sZGVyID0gYXBwLnBsdWdpbnMucGx1Z2luc1tcInRlbXBsYXRlci1vYnNpZGlhblwiXT8uc2V0dGluZ3M/LnVzZXJfc2NyaXB0c19mb2xkZXI7XG4gICAgcmV0dXJuIGZvbGRlciA/IG5vcm1hbGl6ZVBhdGgoZm9sZGVyKSA6IG51bGw7XG4gIH07XG5cbiAgY29uc3QgaXNJblNjcmlwdEZvbGRlciA9IChwYXRoKSA9PiAhIXNjcmlwdEZvbGRlciAmJiAhIXBhdGggJiYgcGF0aC5zdGFydHNXaXRoKHNjcmlwdEZvbGRlciArIFwiL1wiKTtcblxuICAvLyBMaWtlIFRlbXBsYXRlcjogZXZlcnkgLmpzIGluIHRoZSBzY3JpcHQgZm9sZGVyIGluY2x1ZGluZyBzdWJmb2xkZXJzLFxuICAvLyBzY3JpcHQgbmFtZSA9IGZpbGUgbmFtZSB3aXRob3V0IGV4dGVuc2lvbi5cbiAgYXN5bmMgZnVuY3Rpb24gcmVmcmVzaFNjcmlwdHMoKSB7XG4gICAgY29uc3QgZm9sZGVyUGF0aCA9IGN1cnJlbnRTY3JpcHRGb2xkZXIoKTtcbiAgICBzY3JpcHRGb2xkZXIgPSBmb2xkZXJQYXRoO1xuICAgIGNvbnN0IGZvbGRlciA9IGZvbGRlclBhdGggPyBhcHAudmF1bHQuZ2V0Rm9sZGVyQnlQYXRoKGZvbGRlclBhdGgpIDogbnVsbDtcbiAgICBjb25zdCBmaWxlcyA9IFtdO1xuICAgIGlmIChmb2xkZXIpIHtcbiAgICAgIFZhdWx0LnJlY3Vyc2VDaGlsZHJlbihmb2xkZXIsIChjaGlsZCkgPT4ge1xuICAgICAgICBpZiAoY2hpbGQgaW5zdGFuY2VvZiBURmlsZSAmJiBjaGlsZC5leHRlbnNpb24gPT09IFwianNcIikgZmlsZXMucHVzaChjaGlsZCk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgY29uc3QgZm91bmQgPSBbXTtcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG1hdGNoID0gKGF3YWl0IGFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpKS5tYXRjaChTSE9SVENVVF9NQVJLRVIpO1xuICAgICAgICAvLyBtYXRjaFsxXSBpcyB1bmRlZmluZWQgd2l0aG91dCBwYXJlbnRoZXNlcyBhbmQgXCJcIiB3aXRoIGVtcHR5IG9uZXM7XG4gICAgICAgIC8vIHRoYXQgZGlmZmVyZW5jZSBkZWNpZGVzIHRoZSBjYWxsIGZvcm0uXG4gICAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICAgIGZvdW5kLnB1c2goe1xuICAgICAgICAgICAgbmFtZTogZmlsZS5iYXNlbmFtZSxcbiAgICAgICAgICAgIHBhcmFtczogbWF0Y2hbMV0gPT09IHVuZGVmaW5lZCA/IG51bGwgOiBwYXJzZVBhcmFtcyhtYXRjaFsxXSksXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogbWF0Y2hbMl0gPz8gXCJcIixcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLmVycm9yKGBUWVAtU3lzdGVtOiBjYW4ndCByZWFkIFRlbXBsYXRlciBzY3JpcHQgJHtmaWxlLnBhdGh9YCwgZSk7XG4gICAgICB9XG4gICAgfVxuICAgIC8vIEZvbGRlciBjaGFuZ2VkIGluIFRlbXBsYXRlciBtZWFud2hpbGU6IGRyb3AgdGhpcyByZXN1bHQsIHRoZSBydW4gZm9yIHRoZVxuICAgIC8vIG5ldyBmb2xkZXIgaXMgYWxyZWFkeSBzY2hlZHVsZWQuXG4gICAgaWYgKGZvbGRlclBhdGggIT09IHNjcmlwdEZvbGRlcikgcmV0dXJuO1xuICAgIHNjcmlwdHMgPSBmb3VuZC5zb3J0KChhLCBiKSA9PiBhLm5hbWUubG9jYWxlQ29tcGFyZShiLm5hbWUpKTtcbiAgfVxuXG4gIGNvbnN0IHNjaGVkdWxlUmVmcmVzaCA9IGRlYm91bmNlKHJlZnJlc2hTY3JpcHRzLCAzMDAsIHRydWUpO1xuICBjb25zdCBvbkZpbGVDaGFuZ2UgPSAoZmlsZSwgb2xkUGF0aCkgPT4ge1xuICAgIGlmIChpc0luU2NyaXB0Rm9sZGVyKGZpbGU/LnBhdGgpIHx8IGlzSW5TY3JpcHRGb2xkZXIob2xkUGF0aCkpIHNjaGVkdWxlUmVmcmVzaCgpO1xuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJjcmVhdGVcIiwgb25GaWxlQ2hhbmdlKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC52YXVsdC5vbihcIm1vZGlmeVwiLCBvbkZpbGVDaGFuZ2UpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoYXBwLnZhdWx0Lm9uKFwiZGVsZXRlXCIsIG9uRmlsZUNoYW5nZSkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJyZW5hbWVcIiwgb25GaWxlQ2hhbmdlKSk7XG4gIGFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeShyZWZyZXNoU2NyaXB0cyk7XG5cbiAgcmV0dXJuICgpID0+IHtcbiAgICAvLyBUZW1wbGF0ZXIgZm9sZGVyIGNoYW5nZWQ6IHJlbG9hZCBmb3IgdGhlIG5leHQgY2FsbCwgYW5zd2VyIHdpdGggdGhlXG4gICAgLy8gY3VycmVudCBsaXN0IGZvciBub3cuXG4gICAgaWYgKGN1cnJlbnRTY3JpcHRGb2xkZXIoKSAhPT0gc2NyaXB0Rm9sZGVyKSBzY2hlZHVsZVJlZnJlc2goKTtcbiAgICByZXR1cm4gc2NyaXB0cztcbiAgfTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyU2hvcnRjdXRTY3JpcHRzLCBTSE9SVENVVF9NQVJLRVIsIHBhcnNlUGFyYW1zIH07XG4iLCAiY29uc3QgeyBQbHVnaW4gfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgREVGQVVMVF9TRVRUSU5HUywgVHlwU3lzdGVtU2V0dGluZ1RhYiB9ID0gcmVxdWlyZShcIi4vc2V0dGluZ3NcIik7XG5jb25zdCB7IHJlZ2lzdGVyQ29tbWFuZHMgfSA9IHJlcXVpcmUoXCIuL2NvbW1hbmRzXCIpO1xuY29uc3QgeyByZWdpc3RlclR5cFBhbmUsIHNvcnRUeXBzQnlNb2RlLCBERUZBVUxUX1NPUlRfT1JERVIgfSA9IHJlcXVpcmUoXCIuL3R5cC1wYW5lXCIpO1xuY29uc3QgeyBUeXBJbmRleCwgc2V0Q2Fub25pY2FsUHJvcGVydHksIGRlbGV0ZVByb3BlcnR5LCBUWVBfUFJPUEVSVFksIFNVQlRZUF9QUk9QRVJUWSB9ID0gcmVxdWlyZShcIi4vdHlwLWluZGV4XCIpO1xuY29uc3QgeyBnZXRTdWJ0eXAsIGdldFN1YnR5cE5hbWVzLCBpc1N1YnR5cE1hbnVhbCB9ID0gcmVxdWlyZShcIi4vc3VidHlwc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJGaWxlRXhwbG9yZXJDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL2ZpbGUtZXhwbG9yZXItY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlckdyYXBoQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9ncmFwaC1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyU2VhcmNoQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9zZWFyY2gtY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlclJlY2VudEZpbGVzQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9yZWNlbnQtZmlsZXMtY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlckJhY2tsaW5rQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9iYWNrbGluay1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyQm9va21hcmtzQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9ib29rbWFyay1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL2FjdGl2ZS10aXRsZS1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyTGlua0NvbG9ycyB9ID0gcmVxdWlyZShcIi4vbGluay1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyRnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0IH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1kZWZhdWx0LWhpZ2hsaWdodFwiKTtcbmNvbnN0IHsgcmVnaXN0ZXJQcm9wZXJ0eVJlbmFtZVN5bmMgfSA9IHJlcXVpcmUoXCIuL3Byb3BlcnR5LXJlbmFtZS1zeW5jXCIpO1xuY29uc3QgeyByZW1vdmVQcm9wZXJ0eU1lbnVQYXRjaCB9ID0gcmVxdWlyZShcIi4vdHlwLWZyb250bWF0dGVyLWVkaXRvclwiKTtcbmNvbnN0IHsgbm9ybWFsaXplR2xvYmFsT3JkZXIsIHNvcnRGcm9udG1hdHRlckZvciwgcGxhY2VQcm9wZXJ0eUZvciB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItc29ydFwiKTtcbmNvbnN0IHsgcmVzb2x2ZVNob3J0Y3V0cywgc2NyaXB0TmFtZU9mLCByZXNvbHZlQ2FsbEFyZ3MgfSA9IHJlcXVpcmUoXCIuL3Nob3J0Y3V0c1wiKTtcbmNvbnN0IHtcbiAgcGlja1R5cDogcGlja1R5cE1vZGFsLFxuICBwaWNrU3VidHlwOiBwaWNrU3VidHlwTW9kYWwsXG4gIHBpY2tUeXBBbmRTdWJ0eXA6IHBpY2tUeXBBbmRTdWJ0eXBNb2RhbCxcbn0gPSByZXF1aXJlKFwiLi90eXAtcGlja2VyXCIpO1xuY29uc3QgeyByZWdpc3RlclNob3J0Y3V0U2NyaXB0cyB9ID0gcmVxdWlyZShcIi4vc2hvcnRjdXQtc2NyaXB0c1wiKTtcblxubW9kdWxlLmV4cG9ydHMgPSBjbGFzcyBUeXBTeXN0ZW1QbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBhc3luYyBvbmxvYWQoKSB7XG4gICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcblxuICAgIC8vIEJlZm9yZSBhbGwgb3RoZXIgbW9kdWxlczogdGhleSBsaXN0ZW4gdG8gaXRzIFwiY2hhbmdlXCIgZXZlbnQgYW5kIHJlYWRcbiAgICAvLyBUWVAvU1VCVFlQIG9ubHkgdGhyb3VnaCBpdCAoc2VlIHR5cC1pbmRleC5qcykuXG4gICAgdGhpcy50eXBJbmRleCA9IG5ldyBUeXBJbmRleCh0aGlzKTtcbiAgICB0aGlzLnR5cEluZGV4LnJlZ2lzdGVyKCk7XG5cbiAgICByZWdpc3RlckNvbW1hbmRzKHRoaXMpO1xuICAgIHRoaXMuYWRkU2V0dGluZ1RhYihuZXcgVHlwU3lzdGVtU2V0dGluZ1RhYih0aGlzLmFwcCwgdGhpcykpO1xuICAgIC8vIENhcnJpZXMgcmVuYW1lcyBmcm9tIFwiQWxsIHByb3BlcnRpZXNcIi9CYXNlcyBpbnRvIHRoZSBUWVAtRnJvbnRtYXR0ZXIuXG4gICAgcmVnaXN0ZXJQcm9wZXJ0eVJlbmFtZVN5bmModGhpcyk7XG4gICAgLy8gVGhlIFRZUC1QYW5lIHBhdGNoZXMgdGhlIHByb3BlcnR5IG1lbnUgbGF6aWx5IChlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaCkuXG4gICAgdGhpcy5yZWdpc3RlcihyZW1vdmVQcm9wZXJ0eU1lbnVQYXRjaCk7XG4gICAgLy8gQWNjZXNzb3IgZm9yIHRoZSBUZW1wbGF0ZXIgc2NyaXB0cyBtYXJrZWQgXCJAdHlwLXNob3J0Y3V0XCIsIHVzZWQgYnkgdGhlXG4gICAgLy8gc2hvcnRjdXQgcGlja2VyIG9mIHRoZSBwcm9wZXJ0eSByb3dzLlxuICAgIHRoaXMuZ2V0U2hvcnRjdXRTY3JpcHRzID0gcmVnaXN0ZXJTaG9ydGN1dFNjcmlwdHModGhpcyk7XG5cbiAgICAvLyBLZXB0IHNlcGFyYXRlIGZyb20gcmVmcmVzaEZuczogYWZ0ZXIgbW91bnRpbmcgaXRzIGVkaXRvcnMgdGhlIFRZUC1QYW5lXG4gICAgLy8gbmVlZHMgb25seSB0aGlzIHJlZnJlc2ggKGJvbGQgcHJvcGVydHkgbmFtZXMpLiBUaGUgd2hvbGVcbiAgICAvLyByZWZyZXNoVHlwQ29sb3JzKCkgYnVuZGxlIHdvdWxkIGFsc28gdHJpZ2dlciB0aGUgdmlldydzIG93biByZS1yZW5kZXIgYW5kXG4gICAgLy8gcmVjdXJzZSBpbnRvIGEgc3RhY2sgb3ZlcmZsb3cgb24gZXZlcnkgVFlQIG9wZW5lZC5cbiAgICB0aGlzLnJlZnJlc2hGcm9udG1hdHRlckhpZ2hsaWdodCA9IHJlZ2lzdGVyRnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0KHRoaXMpO1xuXG4gICAgY29uc3QgcmVmcmVzaEZucyA9IFtcbiAgICAgIHJlZ2lzdGVyVHlwUGFuZSh0aGlzKSxcbiAgICAgIHJlZ2lzdGVyRmlsZUV4cGxvcmVyQ29sb3JzKHRoaXMpLFxuICAgICAgcmVnaXN0ZXJHcmFwaENvbG9ycyh0aGlzKSxcbiAgICAgIHJlZ2lzdGVyU2VhcmNoQ29sb3JzKHRoaXMpLFxuICAgICAgcmVnaXN0ZXJSZWNlbnRGaWxlc0NvbG9ycyh0aGlzKSxcbiAgICAgIHJlZ2lzdGVyQmFja2xpbmtDb2xvcnModGhpcyksXG4gICAgICByZWdpc3RlckJvb2ttYXJrc0NvbG9ycyh0aGlzKSxcbiAgICAgIHJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnModGhpcyksXG4gICAgICByZWdpc3RlckxpbmtDb2xvcnModGhpcyksXG4gICAgICB0aGlzLnJlZnJlc2hGcm9udG1hdHRlckhpZ2hsaWdodCxcbiAgICBdO1xuICAgIHRoaXMucmVmcmVzaFR5cENvbG9ycyA9ICgpID0+IHJlZnJlc2hGbnMuZm9yRWFjaCgoZm4pID0+IGZuKCkpO1xuXG4gICAgLy8gU3R5bGUgU2V0dGluZ3MgcmVhZHMgc3R5bGVzaGVldHMgd2hlbiBpdCBsb2FkcyBhbmQgYWZ0ZXJ3YXJkcyBvbmx5IG9uXG4gICAgLy8gXCJjc3MtY2hhbmdlXCIsIHdoaWNoIGZpcmVzIGZvciB0aGVtZXMgYW5kIHNuaXBwZXRzIGJ1dCBub3QgZm9yIGEgcGx1Z2luJ3NcbiAgICAvLyBzdHlsZXMuY3NzLiBBIHBsdWdpbiBsb2FkZWQgbGF0ZXIgKG9yIGhvdC1yZWxvYWRlZCkgd291bGQgYmUgbWlzc2luZ1xuICAgIC8vIHRoZXJlOyBcInBhcnNlLXN0eWxlLXNldHRpbmdzXCIgaXMgdGhlIGludGVuZGVkIGhvb2suIFdpdGhvdXQgU3R5bGVcbiAgICAvLyBTZXR0aW5ncyBub2JvZHkgbGlzdGVucyBhbmQgbm90aGluZyBoYXBwZW5zLlxuICAgIC8vXG4gICAgLy8gTmV4dCB0aWNrLCBiZWNhdXNlIE9ic2lkaWFuIGFkZHMgYSBwbHVnaW4ncyBzdHlsZXMuY3NzIG9ubHkgQUZURVJcbiAgICAvLyBvbmxvYWQoKS4gb25MYXlvdXRSZWFkeSBkb2Vzbid0IGhlbHA6IG9uIGhvdCByZWxvYWQgdGhlIGxheW91dCBpcyBsb25nXG4gICAgLy8gcmVhZHkgYW5kIHRoZSBjYWxsYmFjayB3b3VsZCBydW4gYXQgb25jZSwganVzdCBhcyBlYXJseS5cbiAgICBjb25zdCBwYXJzZVN0eWxlU2V0dGluZ3MgPSB3aW5kb3cuc2V0VGltZW91dCgoKSA9PiB0aGlzLmFwcC53b3Jrc3BhY2UudHJpZ2dlcihcInBhcnNlLXN0eWxlLXNldHRpbmdzXCIpLCAwKTtcbiAgICB0aGlzLnJlZ2lzdGVyKCgpID0+IHdpbmRvdy5jbGVhclRpbWVvdXQocGFyc2VTdHlsZVNldHRpbmdzKSk7XG4gIH1cblxuICBvbnVubG9hZCgpIHt9XG5cbiAgLy8gRm9yIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanM6IHRoZSBUWVAtRnJvbnRtYXR0ZXIgb2YgYSBUWVAsIHNvXG4gIC8vIFRlbXBsYXRlciBjYW4gYXBwbHkgaXQgdG8gYSBuZXcgbm90ZSBpbnN0ZWFkIG9mIGtlZXBpbmcgYSBzZWNvbmQgY29weS4gQVxuICAvLyBjb3B5LCBzbyBjYWxsZXJzIG1heSBjaGFuZ2UgaXQgZnJlZWx5LlxuICAvL1xuICAvLyBQcm9wZXJ0aWVzIHdpdGggYSBmaXhlZCBzaG9ydGN1dCAodG9kYXkvbm93L2NyZWF0ZWQsIHNlZSBzaG9ydGN1dHMuanMpXG4gIC8vIGNhcnJ5IGl0cyB2YWx1ZSwgY29tcHV0ZWQgZnJlc2ggb24gZWFjaCBjYWxsLiBQcm9wZXJ0aWVzIHdpdGggYSBzY3JpcHRcbiAgLy8gc2hvcnRjdXQgY2FycnkgbnVsbDogb25seSBUZW1wbGF0ZXIgY2FuIHJlc29sdmUgdGhlbSwgVFlQLmpzIGdldHMgdGhlbSB2aWFcbiAgLy8gZ2V0VHlwU2hvcnRjdXRzKCkgYW5kIGZpbGxzIHRoZW0gaW4uIEtleSBhbmQgcG9zaXRpb24gc3RheSBlaXRoZXIgd2F5LlxuICAvL1xuICAvLyBpbmNsdWRlRmxvYXRpbmcgKGRlZmF1bHQgZmFsc2UpIGtlZXBzIGZsb2F0aW5nIGtleXMgaW4gdGhlIHJlc3VsdDsgdGhleVxuICAvLyBhcmUgbm90IGNyZWF0ZWQgZm9yIGV2ZXJ5IG5ldyBub3RlLCBvbmx5IHdoZW4gYSBzY3JpcHQgYXNrcyBmb3IgdGhlbS5cbiAgLy9cbiAgLy8gZmlsZSAob3B0aW9uYWwpIGdvZXMgdG8gcmVzb2x2ZVNob3J0Y3V0cygpIGZvciBcImNyZWF0ZWRcIiwgd2hpY2ggcmV0dXJuc1xuICAvLyB0aGUgZmlsZSdzIGNyZWF0aW9uIGRhdGUgaW5zdGVhZCBvZiB0aGUgY2FsbCB0aW1lLlxuICAvL1xuICAvLyBzdWJ0eXAgKG9wdGlvbmFsKSBhcHBlbmRzIHRoYXQgU3VidHlwJ3MgYmxvY2suIEEga2V5IGluIEJPVEggYmxvY2tzIGtlZXBzXG4gIC8vIHRoZSBUWVAtRnJvbnRtYXR0ZXIgcG9zaXRpb24sIGJ1dCB2YWx1ZSwgZmxvYXRpbmcgZmxhZyBhbmQgc2hvcnRjdXQgY29tZVxuICAvLyBmcm9tIHRoZSBTdWJ0eXAuIEZyb250bWF0dGVyIHNvcnRpbmcgbXVzdCB1c2UgdGhlIHNhbWUgcnVsZSAoc2VlXG4gIC8vIG9yZGVyZWREZWZhdWx0S2V5cyBpbiBmcm9udG1hdHRlci1zb3J0LmpzKSwgb3IgaXQgd291bGQgcmUtc29ydCBhIG5ldyBub3RlXG4gIC8vIHJpZ2h0IGF3YXkuXG4gIGdldFR5cERlZmF1bHRzKHR5cCwgeyBpbmNsdWRlRmxvYXRpbmcgPSBmYWxzZSwgZmlsZSwgc3VidHlwID0gbnVsbCB9ID0ge30pIHtcbiAgICBjb25zdCB7IGRlZmF1bHRzLCBzaG9ydGN1dHMgfSA9IHRoaXMuY29sbGVjdEJsb2Nrcyh0eXAsIHN1YnR5cCwgaW5jbHVkZUZsb2F0aW5nKTtcbiAgICByZXR1cm4gcmVzb2x2ZVNob3J0Y3V0cyhkZWZhdWx0cywgc2hvcnRjdXRzLCB7IGZpbGUsIGFwcDogdGhpcy5hcHAgfSk7XG4gIH1cblxuICAvLyBTaGFyZWQgYmFzZSBvZiBnZXRUeXBEZWZhdWx0cygpIGFuZCBnZXRUeXBTaG9ydGN1dHMoKTogdGhlIFRZUC1Gcm9udG1hdHRlclxuICAvLyBwbHVzIHRoZSBTdWJ0eXAncyBibG9jay4gQSBrZXkgaW4gQk9USCBrZWVwcyB0aGUgVFlQLUZyb250bWF0dGVyIHBvc2l0aW9uO1xuICAvLyB2YWx1ZSwgZmxvYXRpbmcgZmxhZyBBTkQgc2hvcnRjdXQgY29tZSBmcm9tIHRoZSBTdWJ0eXAgLSBcIm5vIHNob3J0Y3V0XCJcbiAgLy8gY291bnRzIGFzIHRoZSBTdWJ0eXAncyBjaG9pY2UgdG9vIGFuZCBjYW5jZWxzIHRoZSBUWVAncy5cbiAgY29sbGVjdEJsb2Nrcyh0eXAsIHN1YnR5cCwgaW5jbHVkZUZsb2F0aW5nKSB7XG4gICAgY29uc3QgZGVmYXVsdHMgPSB7fTtcbiAgICBjb25zdCBzaG9ydGN1dHMgPSB7fTtcbiAgICBjb25zdCBpc0Zsb2F0aW5nID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IGFkZEJsb2NrID0gKGZyb250bWF0dGVyLCBmbG9hdGluZ0tleXMsIGJsb2NrU2hvcnRjdXRzKSA9PiB7XG4gICAgICBjb25zdCBhY3R1YWxLZXlzID0gbmV3IE1hcChPYmplY3Qua2V5cyhkZWZhdWx0cykubWFwKChrZXkpID0+IFtrZXkudG9Mb3dlckNhc2UoKSwga2V5XSkpO1xuICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoZnJvbnRtYXR0ZXIgPz8ge30pKSB7XG4gICAgICAgIGlmIChrZXkgPT09IFwiXCIpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCB0YXJnZXQgPSBhY3R1YWxLZXlzLmdldChrZXkudG9Mb3dlckNhc2UoKSkgPz8ga2V5O1xuICAgICAgICBkZWZhdWx0c1t0YXJnZXRdID0gdmFsdWU7XG4gICAgICAgIGlzRmxvYXRpbmcuc2V0KHRhcmdldCwgKGZsb2F0aW5nS2V5cyA/PyBbXSkuaW5jbHVkZXMoa2V5KSk7XG4gICAgICAgIGNvbnN0IHJlY29yZCA9IChibG9ja1Nob3J0Y3V0cyA/PyB7fSlba2V5XTtcbiAgICAgICAgaWYgKHJlY29yZCkgc2hvcnRjdXRzW3RhcmdldF0gPSByZWNvcmQ7XG4gICAgICAgIGVsc2UgZGVsZXRlIHNob3J0Y3V0c1t0YXJnZXRdO1xuICAgICAgfVxuICAgIH07XG4gICAgY29uc3Qgc3VidHlwRGF0YSA9IHN1YnR5cCA/IGdldFN1YnR5cCh0aGlzLnNldHRpbmdzLCB0eXAsIHN1YnR5cCkgOiBudWxsO1xuICAgIGFkZEJsb2NrKFxuICAgICAgdGhpcy5zZXR0aW5ncy50eXBEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwXSxcbiAgICAgIHRoaXMuc2V0dGluZ3MudHlwRmxvYXRpbmdLZXlzW3R5cF0sXG4gICAgICB0aGlzLnNldHRpbmdzLnR5cFNob3J0Y3V0c1t0eXBdXG4gICAgKTtcbiAgICBpZiAoc3VidHlwRGF0YSkgYWRkQmxvY2soc3VidHlwRGF0YS5mcm9udG1hdHRlciwgc3VidHlwRGF0YS5mbG9hdGluZ0tleXMsIHN1YnR5cERhdGEuc2hvcnRjdXRzKTtcblxuICAgIGlmICghaW5jbHVkZUZsb2F0aW5nKSB7XG4gICAgICBmb3IgKGNvbnN0IFtrZXksIGZsb2F0aW5nXSBvZiBpc0Zsb2F0aW5nKSB7XG4gICAgICAgIGlmICghZmxvYXRpbmcpIGNvbnRpbnVlO1xuICAgICAgICBkZWxldGUgZGVmYXVsdHNba2V5XTtcbiAgICAgICAgZGVsZXRlIHNob3J0Y3V0c1trZXldO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4geyBkZWZhdWx0cywgc2hvcnRjdXRzIH07XG4gIH1cblxuICAvLyBGb3IgVFlQLmpzOiB0aGUgcHJvcGVydGllcyBvZiB0aGlzIFRZUCB3aG9zZSB2YWx1ZSBjb21lcyBmcm9tIGEgVGVtcGxhdGVyXG4gIC8vIHNjcmlwdCwgYXMgeyBbcHJvcGVydHldOiB7IG5hbWUsIHBhcmFtcywgYXJncywgZmFsbGJhY2sgfSB9IGluXG4gIC8vIFRZUC1Gcm9udG1hdHRlciBvcmRlciAodGhlIHNjcmlwdHMgcnVuIGluIHR1cm4gYW5kIHNlZSBlYXJsaWVyIHJlc3VsdHMpLlxuICAvL1xuICAvLyAgIG5hbWUgICAgICBzY3JpcHQgbmFtZSB3aXRob3V0IFwidHAuXCIsIGkuZS4gdHAudXNlci48bmFtZT5cbiAgLy8gICBwYXJhbXMgICAgdGhlIHBhcmFtZXRlciBsaXN0IGRlY2xhcmVkIGluIHRoZSBAdHlwLXNob3J0Y3V0IG1hcmtlciwgb3JcbiAgLy8gICAgICAgICAgICAgbnVsbCB3aXRob3V0IHBhcmVudGhlc2VzLiBUYWtlbiBmcm9tIHRoZSBjdXJyZW50IHNjYW4sIHNvIGFcbiAgLy8gICAgICAgICAgICAgY2hhbmdlZCBkZWNsYXJhdGlvbiBhcHBsaWVzIGF0IG9uY2UuIFRZUC5qcyB0dXJucyBpdCBpbnRvIHRoZVxuICAvLyAgICAgICAgICAgICBjYWxsJ3MgYXJndW1lbnRzIHdpdGggcmVzb2x2ZVNob3J0Y3V0QXJncygpXG4gIC8vICAgYXJncyAgICAgIHRoZSB0eXBlZCBhcmd1bWVudHMsIG5hbWVkIGFmdGVyIHRoZSBub24tcmVzZXJ2ZWQgcGFyYW1ldGVycztcbiAgLy8gICAgICAgICAgICAgYW4gZW1wdHkgZmllbGQgaXMgbWlzc2luZyBzbyBcImFyZ3MueCA/PyBmYWxsYmFja1wiIHdvcmtzXG4gIC8vICAgZmFsbGJhY2sgIHRoZSBmaXhlZCB2YWx1ZSBzdG9yZWQgZm9yIHRoZSBwcm9wZXJ0eS4gT25seSBhIEZBTExCQUNLOlxuICAvLyAgICAgICAgICAgICBUWVAuanMgd3JpdGVzIGl0IGlmIHRoZSBzY3JpcHQgaXMgbWlzc2luZyBvciB0aHJvd3MuIEEgc2NyaXB0XG4gIC8vICAgICAgICAgICAgIHRoYXQgZGVsaWJlcmF0ZWx5IHJldHVybnMgbnVsbC9cIlwiIChFU0MgaW4gYSBwaWNrZXIpIGhhcyBub3RcbiAgLy8gICAgICAgICAgICAgZmFpbGVkIC0gdGhlIHByb3BlcnR5IHN0YXlzIGVtcHR5IHRoZW4uXG4gIC8vXG4gIC8vIEZpeGVkIHNob3J0Y3V0cyAodG9kYXkvbm93L2NyZWF0ZWQpIGRvbid0IGFwcGVhciBoZXJlOyBnZXRUeXBEZWZhdWx0cygpXG4gIC8vIGFscmVhZHkgcmVzb2x2ZXMgdGhlbSBhbmQgcmV0dXJucyB0aGUgc2NyaXB0IGtleXMgYXMgbnVsbC5cbiAgLy9cbiAgLy8gT3B0aW9ucyBhcyBpbiBnZXRUeXBEZWZhdWx0cygpOyBpbmNsdWRlRmxvYXRpbmcgZGVmYXVsdHMgdG8gZmFsc2Ugc28gbm9cbiAgLy8gc2NyaXB0IHJ1bnMgdW5hc2tlZCBmb3IgYSBmbG9hdGluZyBwcm9wZXJ0eS5cbiAgZ2V0VHlwU2hvcnRjdXRzKHR5cCwgeyBpbmNsdWRlRmxvYXRpbmcgPSBmYWxzZSwgc3VidHlwID0gbnVsbCB9ID0ge30pIHtcbiAgICBjb25zdCB7IGRlZmF1bHRzLCBzaG9ydGN1dHMgfSA9IHRoaXMuY29sbGVjdEJsb2Nrcyh0eXAsIHN1YnR5cCwgaW5jbHVkZUZsb2F0aW5nKTtcbiAgICBjb25zdCBzY3JpcHRzID0gdGhpcy5nZXRTaG9ydGN1dFNjcmlwdHM/LigpID8/IFtdO1xuICAgIGNvbnN0IHJlc3VsdCA9IHt9O1xuICAgIGZvciAoY29uc3QgW2tleSwgcmVjb3JkXSBvZiBPYmplY3QuZW50cmllcyhzaG9ydGN1dHMpKSB7XG4gICAgICBjb25zdCBuYW1lID0gc2NyaXB0TmFtZU9mKHJlY29yZC5uYW1lKTtcbiAgICAgIGlmIChuYW1lID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IHNjcmlwdCA9IHNjcmlwdHMuZmluZCgocykgPT4gcy5uYW1lID09PSBuYW1lKTtcbiAgICAgIHJlc3VsdFtrZXldID0ge1xuICAgICAgICBuYW1lLFxuICAgICAgICBwYXJhbXM6IHNjcmlwdD8ucGFyYW1zID8/IG51bGwsXG4gICAgICAgIGFyZ3M6IHsgLi4uKHJlY29yZC5hcmdzID8/IHt9KSB9LFxuICAgICAgICBmYWxsYmFjazogZGVmYXVsdHNba2V5XSA/PyBudWxsLFxuICAgICAgfTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIC8vIEZvciBUWVAuanM6IHR1cm5zIGEgc2hvcnRjdXQncyBwYXJhbWV0ZXIgbGlzdCBpbnRvIHRoZSBhcmd1bWVudHMgb2ZcbiAgLy8gdHAudXNlci48bmFtZT4odHAsIC4uLikgLSBzZWUgcmVzb2x2ZUNhbGxBcmdzIGluIHNob3J0Y3V0cy5qcy4gTGl2ZXMgaGVyZVxuICAvLyBzbyB0aGUgcnVsZXMgKHJlc2VydmVkIG5hbWVzLCBkb3R0ZWQgbmFtZXMpIGV4aXN0IGluIG9uZSBwbGFjZTsgb25seVxuICAvLyBUWVAuanMga25vd3MgbmV3RmlsZSBhbmQgY3R4LCBzbyBpdCBwYXNzZXMgdGhlbSBpbi5cbiAgcmVzb2x2ZVNob3J0Y3V0QXJncyhwYXJhbXMsIGFyZ3MsIHsgbmV3RmlsZSA9IG51bGwsIGN0eCA9IG51bGwsIGtleSA9IG51bGwgfSA9IHt9KSB7XG4gICAgcmV0dXJuIHJlc29sdmVDYWxsQXJncyhwYXJhbXMsIGFyZ3MsIHsgbmV3RmlsZSwgY3R4LCBrZXkgfSk7XG4gIH1cblxuICAvLyBGb3IgVFlQLmpzOiByZWdpc3RlcmVkIFN1YnR5cHMgb2YgYSBUWVAgaW4gYmxvY2sgb3JkZXIsIHdpdGggbm90ZSBjb3VudHMuXG4gIC8vIFN1YnR5cHMgdGhhdCBhcmVuJ3QgbWFudWFsbHkgY3JlYXRhYmxlIGFyZSBsZWZ0IG91dCB1bmxlc3NcbiAgLy8gaW5jbHVkZU1hbnVhbE9mZiBpcyBzZXQsIGxpa2Ugc3VjaCBUWVAgZW50cmllcyBpbiBnZXRUeXBzKCkuXG4gIGdldFN1YnR5cHModHlwLCB7IGluY2x1ZGVNYW51YWxPZmYgPSBmYWxzZSB9ID0ge30pIHtcbiAgICBjb25zdCB7IGNvdW50cyB9ID0gdGhpcy50eXBJbmRleC5zdWJ0eXBCdWNrZXQodHlwKTtcbiAgICByZXR1cm4gZ2V0U3VidHlwTmFtZXModGhpcy5zZXR0aW5ncywgdHlwKVxuICAgICAgLmZpbHRlcigoc3VidHlwKSA9PiBpbmNsdWRlTWFudWFsT2ZmIHx8IGlzU3VidHlwTWFudWFsKHRoaXMuc2V0dGluZ3MsIHR5cCwgc3VidHlwKSlcbiAgICAgIC5tYXAoKHN1YnR5cCkgPT4gKHsgc3VidHlwLCBjb3VudDogY291bnRzLmdldChzdWJ0eXApID8/IDAgfSkpO1xuICB9XG5cbiAgLy8gRm9yIFRZUC5qczogdGhlIFN1YnR5cC1QaWNrZXIgKHNlZSB0eXAtcGlja2VyLmpzKS4gUmVzb2x2ZXMgd2l0aCB0aGVcbiAgLy8gU3VidHlwLCBcIlwiIGZvciBcIm5vIFN1YnR5cFwiIChvciB3aXRob3V0IGEgcGlja2VyIGlmIHRoZSBUWVAgaGFzIG5vbmUpLCBvclxuICAvLyBudWxsIG9uIEVTQyAoVFlQLmpzIHRoZW4gZ29lcyBiYWNrIHRvIHRoZSBUWVAgY2hvaWNlKS4gcXVlcnkgKG9wdGlvbmFsKTpcbiAgLy8gYW4gYWxyZWFkeSB0eXBlZCBzZWFyY2ggdGhhdCBwcmUtc29ydHMgdGhlIGxpc3QuIG9wdGlvbnMgYXMgaW4gZ2V0U3VidHlwcy5cbiAgcGlja1N1YnR5cCh0eXAsIHF1ZXJ5ID0gXCJcIiwgb3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIHBpY2tTdWJ0eXBNb2RhbCh0aGlzLmFwcCwgdGhpcywgdHlwLCBxdWVyeSwgb3B0aW9ucyk7XG4gIH1cblxuICAvLyBGb3IgVFlQLmpzLCBpbnNpZGUgcHJvY2Vzc0Zyb250TWF0dGVyOiBzZXRzIFRZUCBhbmQgU1VCVFlQIGluIGNhbm9uaWNhbFxuICAvLyBzcGVsbGluZyAtIGEgdmFyaWFudCBsaWtlIFwidHlwXCIgb3IgXCJTdWJ0eXBcIiBpcyByZW5hbWVkIGluIHBsYWNlIHJhdGhlciB0aGFuXG4gIC8vIGR1cGxpY2F0ZWQuIHN1YnR5cCBudWxsIHJlbW92ZXMgYW4gZXhpc3RpbmcgU1VCVFlQLlxuICBhcHBseVR5cFByb3BlcnRpZXMoZnJvbnRtYXR0ZXIsIHR5cCwgc3VidHlwKSB7XG4gICAgc2V0Q2Fub25pY2FsUHJvcGVydHkoZnJvbnRtYXR0ZXIsIFRZUF9QUk9QRVJUWSwgdHlwKTtcbiAgICBpZiAoc3VidHlwKSBzZXRDYW5vbmljYWxQcm9wZXJ0eShmcm9udG1hdHRlciwgU1VCVFlQX1BST1BFUlRZLCBzdWJ0eXApO1xuICAgIGVsc2UgZGVsZXRlUHJvcGVydHkoZnJvbnRtYXR0ZXIsIFNVQlRZUF9QUk9QRVJUWSk7XG4gIH1cblxuICAvLyBGb3IgVFlQLmpzLCBpbnNpZGUgcHJvY2Vzc0Zyb250TWF0dGVyIGFuZCBhZnRlciBhbGwgb3RoZXIgY2hhbmdlczogcHV0cyB0aGVcbiAgLy8gZnJvbnRtYXR0ZXIgaW50byBzb3J0aW5nIG9yZGVyLCBvciBuZXdseSBhZGRlZCBwcm9wZXJ0aWVzIChTVUJUWVAgaW4gYW5cbiAgLy8gZXhpc3Rpbmcgbm90ZSwgc2F5KSB3b3VsZCBlbmQgdXAgbGFzdC5cbiAgc29ydEZyb250bWF0dGVyKGZyb250bWF0dGVyLCB0eXAsIHN1YnR5cCA9IG51bGwpIHtcbiAgICByZXR1cm4gc29ydEZyb250bWF0dGVyRm9yKHRoaXMsIGZyb250bWF0dGVyLCB0eXAsIHN1YnR5cCk7XG4gIH1cblxuICAvLyBJbnNpZGUgcHJvY2Vzc0Zyb250TWF0dGVyOiBtb3ZlcyBvbmx5IHByb3BlcnR5IGBrZXlgIHRvIGl0cyBzb3J0ZWQgcGxhY2VcbiAgLy8gKFRZUC9TVUJUWVAgcmVhZCBmcm9tIHRoZSBvYmplY3QpLCBldmVyeXRoaW5nIGVsc2Ugc3RheXMgLSBmb3IgRnJlZCdzXG4gIC8vIHByb3BlcnR5IGJhY2tsaW5raW5nLCBzbyBhIG5ldyBwcm9wZXJ0eSBkb2Vzbid0IGVuZCB1cCBsYXN0LlxuICBwbGFjZVByb3BlcnR5KGZyb250bWF0dGVyLCBrZXkpIHtcbiAgICByZXR1cm4gcGxhY2VQcm9wZXJ0eUZvcih0aGlzLCBmcm9udG1hdHRlciwga2V5KTtcbiAgfVxuXG4gIC8vIEZvciBUWVAuanM6IHRoZSByZWdpc3RlcmVkIFRZUCBlbnRyaWVzIHdpdGggdGhlaXIgZGVzY3JpcHRpb25zLCBpbiB0aGVcbiAgLy8gb3JkZXIgb2YgdGhlIFRZUC1MaXN0IChpdHMgY3VycmVudCBzb3J0IHNldHRpbmcpLiBUWVAgZW50cmllcyB0aGF0IGFyZW4ndFxuICAvLyBtYW51YWxseSBjcmVhdGFibGUgYXJlIGxlZnQgb3V0IHVubGVzcyBpbmNsdWRlTWFudWFsT2ZmIGlzIHRydWUuXG4gIGdldFR5cHMoeyBpbmNsdWRlTWFudWFsT2ZmID0gZmFsc2UgfSA9IHt9KSB7XG4gICAgY29uc3QgeyBjb3VudHMgfSA9IHRoaXMudHlwSW5kZXgudHlwQ291bnRzKCk7XG4gICAgY29uc3Qgc29ydE9yZGVyID0gdGhpcy5zZXR0aW5ncy50eXBTb3J0T3JkZXIgPz8gREVGQVVMVF9TT1JUX09SREVSO1xuICAgIHJldHVybiBzb3J0VHlwc0J5TW9kZSh0aGlzLnNldHRpbmdzLnR5cHMsIHNvcnRPcmRlciwgY291bnRzLCB0aGlzLnNldHRpbmdzLnR5cENvbG9ycylcbiAgICAgIC5maWx0ZXIoKHR5cCkgPT4gaW5jbHVkZU1hbnVhbE9mZiB8fCAodGhpcy5zZXR0aW5ncy50eXBNYW51YWwgPz8ge30pW3R5cF0gIT09IGZhbHNlKVxuICAgICAgLm1hcCgodHlwKSA9PiAoe1xuICAgICAgICB0eXAsXG4gICAgICAgIGRlc2NyaXB0aW9uOiB0aGlzLnNldHRpbmdzLnR5cERlc2NyaXB0aW9uc1t0eXBdID8/IFwiXCIsXG4gICAgICAgIGNvdW50OiBjb3VudHMuZ2V0KHR5cCkgPz8gMCxcbiAgICAgIH0pKTtcbiAgfVxuXG4gIC8vIEZvciBUWVAuanM6IHRoZSBuYXRpdmUgVFlQLVBpY2tlciAoc2VlIHR5cC1waWNrZXIuanMpIHdpdGggY29sb3IsXG4gIC8vIGRlc2NyaXB0aW9uIGFuZCBub3RlIGNvdW50LiBpbmNsdWRlTWFudWFsT2ZmIGFzIGluIGdldFR5cHMoKS4gUmVzb2x2ZXNcbiAgLy8gd2l0aCB0aGUgVFlQLCBvciBudWxsIG9uIEVTQy5cbiAgcGlja1R5cChvcHRpb25zKSB7XG4gICAgcmV0dXJuIHBpY2tUeXBNb2RhbCh0aGlzLmFwcCwgdGhpcywgb3B0aW9ucyk7XG4gIH1cblxuICAvLyBGb3IgVFlQLmpzOiBUWVAgYW5kIFN1YnR5cCBpbiBvbmUgZ28gKHNlZSB0eXAtcGlja2VyLmpzKSAtIG9uZSBwaWNrZXIgd2l0aFxuICAvLyBpbmRlbnRlZCBTdWJ0eXBzIG9yIGJvdGggcGlja2VycyBpbiB0dXJuLCBwZXIgXCJTZXBhcmF0ZSBTdWJ0eXAtUGlja2VyXCIuXG4gIC8vIFJlc29sdmVzIHdpdGggeyB0eXAsIHN1YnR5cCB9IChzdWJ0eXAgbnVsbCBmb3IgXCJubyBTdWJ0eXBcIiksIG9yIG51bGwgb25cbiAgLy8gRVNDLlxuICBwaWNrVHlwQW5kU3VidHlwKG9wdGlvbnMpIHtcbiAgICByZXR1cm4gcGlja1R5cEFuZFN1YnR5cE1vZGFsKHRoaXMuYXBwLCB0aGlzLCBvcHRpb25zKTtcbiAgfVxuXG4gIGFzeW5jIGxvYWRTZXR0aW5ncygpIHtcbiAgICB0aGlzLnNldHRpbmdzID0gT2JqZWN0LmFzc2lnbih7fSwgREVGQVVMVF9TRVRUSU5HUywgYXdhaXQgdGhpcy5sb2FkRGF0YSgpKTtcbiAgICAvLyBPYmplY3QuYXNzaWduIHJlcGxhY2VzIG5lc3RlZCBvYmplY3RzIHdob2xlOyB2aWV3cyBhZGRlZCBsYXRlciAoZS5nLlxuICAgIC8vIGNvbG9yVmlld3MubGlua3MpIHdvdWxkIG90aGVyd2lzZSBiZSBzaWxlbnRseSBvZmYgaW4gb2xkZXIgc2V0dGluZ3MuXG4gICAgdGhpcy5zZXR0aW5ncy5jb2xvclZpZXdzID0geyAuLi5ERUZBVUxUX1NFVFRJTkdTLmNvbG9yVmlld3MsIC4uLnRoaXMuc2V0dGluZ3MuY29sb3JWaWV3cyB9O1xuICAgIHRoaXMuc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlciA9IG5vcm1hbGl6ZUdsb2JhbE9yZGVyKHRoaXMuc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcik7XG4gIH1cblxuICBhc3luYyBzYXZlU2V0dGluZ3MoKSB7XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcbiAgfVxuXG4gIC8vIENhbGxlZCB3aGVuIGRhdGEuanNvbiBjaGFuZ2VzIGZyb20gb3V0c2lkZSwgaW4gcHJhY3RpY2UgdGhyb3VnaCBPYnNpZGlhblxuICAvLyBTeW5jLiBXaXRob3V0IGl0IHRoaXMgZGV2aWNlIHdvdWxkIGtlZXAgaXRzIG9sZCBzZXR0aW5ncyBpbiBtZW1vcnkgYW5kXG4gIC8vIG92ZXJ3cml0ZSB0aGUgbmV3IG9uZXMgb24gdGhlIG5leHQgc2F2ZS4gT2JzaWRpYW4gcmVidWlsZHMgYW4gb3BlblxuICAvLyBzZXR0aW5ncyB0YWIgaXRzZWxmOyBjb2xvcnMgYW5kIHRoZSBUWVAtUGFuZSBhcmUgcmVmcmVzaGVkIGhlcmUuXG4gIGFzeW5jIG9uRXh0ZXJuYWxTZXR0aW5nc0NoYW5nZSgpIHtcbiAgICBhd2FpdCB0aGlzLmxvYWRTZXR0aW5ncygpO1xuICAgIHRoaXMucmVmcmVzaFR5cENvbG9ycygpO1xuICB9XG59O1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7O0FBQUE7QUFBQSxxQkFBQUEsVUFBQUMsU0FBQTtBQUFBLFFBQU0sRUFBRSxRQUFRLE9BQU8sU0FBUyxJQUFJLFFBQVEsVUFBVTtBQUV0RCxRQUFNQyxnQkFBZTtBQUNyQixRQUFNQyxtQkFBa0I7QUFDeEIsUUFBTSxjQUFjLE9BQU8sT0FBTyxFQUFFLFFBQVEsTUFBTSxRQUFRLE1BQU0sV0FBVyxNQUFNLFdBQVcsS0FBSyxDQUFDO0FBS2xHLFFBQU0saUJBQWlCO0FBRXZCLGFBQVMsUUFBUSxPQUFPO0FBQ3RCLFVBQUksU0FBUyxLQUFNLFFBQU87QUFDMUIsYUFBTyxPQUFPLFVBQVUsV0FBVyxLQUFLLFVBQVUsS0FBSyxJQUFJLE9BQU8sS0FBSztBQUFBLElBQ3pFO0FBU0EsYUFBUyxTQUFTLE9BQU87QUFDdkIsVUFBSSxNQUFNLFFBQVEsS0FBSyxHQUFHO0FBQ3hCLGNBQU0sUUFBUSxNQUFNLElBQUksT0FBTztBQUMvQixZQUFJLE1BQU0sTUFBTSxDQUFDLFNBQVMsS0FBSyxLQUFLLE1BQU0sRUFBRSxFQUFHLFFBQU87QUFDdEQsZUFBTyxJQUFJLE1BQU0sS0FBSyxJQUFJLENBQUM7QUFBQSxNQUM3QjtBQUNBLFlBQU0sT0FBTyxRQUFRLEtBQUs7QUFDMUIsYUFBTyxLQUFL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QUFHLEdBQUcsTUFBTSxLQUFLLEVBQ2xGLElBQUksQ0FBQyxTQUFTO0FBQUEsTUFDYjtBQUFBLE1BQ0EsYUFBYSxLQUFLLFNBQVMsZ0JBQWdCLEdBQUcsS0FBSztBQUFBLE1BQ25ELE9BQU8sT0FBTyxJQUFJLEdBQUcsS0FBSztBQUFBLElBQzVCLEVBQUU7QUFBQSxFQUNOO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFLQSxRQUFRLFNBQVM7QUFDZixXQUFPLGFBQWEsS0FBSyxLQUFLLE1BQU0sT0FBTztBQUFBLEVBQzdDO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQU1BLGlCQUFpQixTQUFTO0FBQ3hCLFdBQU8sc0JBQXNCLEtBQUssS0FBSyxNQUFNLE9BQU87QUFBQSxFQUN0RDtBQUFBLEVBRUEsTUFBTSxlQUFlO0FBQ25CLFNBQUssV0FBVyxPQUFPLE9BQU8sQ0FBQyxHQUFHLGtCQUFrQixNQUFNLEtBQUssU0FBUyxDQUFDO0FBR3pFLFNBQUssU0FBUyxhQUFhLEVBQUUsR0FBRyxpQkFBaUIsWUFBWSxHQUFHLEtBQUssU0FBUyxXQUFXO0FBQ3pGLFNBQUssU0FBUyxzQkFBc0IscUJBQXFCLEtBQUssU0FBUyxtQkFBbUI7QUFBQSxFQUM1RjtBQUFBLEVBRUEsTUFBTSxlQUFlO0FBQ25CLFVBQU0sS0FBSyxTQUFTLEtBQUssUUFBUTtBQUFBLEVBQ25DO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQU1BLE1BQU0sMkJBQTJCO0FBQy9CLFVBQU0sS0FBSyxhQUFhO0FBQ3hCLFNBQUssaUJBQWlCO0FBQUEsRUFDeEI7QUFDRjsiLAogICJuYW1lcyI6IFsiZXhwb3J0cyIsICJtb2R1bGUiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJzZXRDYW5vbmljYWxQcm9wZXJ0eSIsICJkZWxldGVQcm9wZXJ0eSIsICJUeXBJbmRleCIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJzZXRDYW5vbmljYWxQcm9wZXJ0eSIsICJTVUJUWVBfUFJPUEVSVFkiLCAiZ2V0U3VidHlwTmFtZXMiLCAiZ2V0U3VidHlwIiwgImlzU3VidHlwTWFudWFsIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInNvcnRUeXBzQnlNb2RlIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImdldFN1YnR5cCIsICJUWVBfUFJPUEVSVFkiLCAiU1VCVFlQX1BST1BFUlRZIiwgIm5vcm1hbGl6ZUdsb2JhbE9yZGVyIiwgInNvcnRGcm9udG1hdHRlckZvciIsICJwbGFjZVByb3BlcnR5Rm9yIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgIlRZUF9QUk9QRVJUWSIsICJTVUJUWVBfUFJPUEVSVFkiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZ2V0U3VidHlwIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgIkRFRkFVTFRfU0VUVElOR1MiLCAiVHlwU3lzdGVtU2V0dGluZ1RhYiIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXBOYW1lcyIsICJub3JtYWxpemVHbG9iYWxPcmRlciIsICJUWVBfUFJPUEVSVFkiLCAiU1VCVFlQX1BST1BFUlRZIiwgImxlYWYiLCAiY3VycmVudCIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlckNvbW1hbmRzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInNjcmlwdE5hbWVPZiIsICJyZXNvbHZlQ2FsbEFyZ3MiLCAicmVzb2x2ZVNob3J0Y3V0cyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXAiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJyZW1vdmVQcm9wZXJ0eU1lbnVQYXRjaCIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXBOYW1lcyIsICJnZXRTdWJ0eXAiLCAiaXNTdWJ0eXBNYW51YWwiLCAic29ydFR5cHNCeU1vZGUiLCAic2V0Q2Fub25pY2FsUHJvcGVydHkiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJERUZBVUxUX1NPUlRfT1JERVIiLCAicmVnaXN0ZXJUeXBQYW5lIiwgImxlYWYiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJGaWxlRXhwbG9yZXJDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJHcmFwaENvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlclNlYXJjaENvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlclJlY2VudEZpbGVzQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyQmFja2xpbmtDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJCb29rbWFya3NDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZ2V0U3VidHlwIiwgInJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJMaW5rQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImdldFN1YnR5cE5hbWVzIiwgImdldFN1YnR5cCIsICJmbG9hdGluZyIsICJyZWdpc3RlckZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodCIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXBOYW1lcyIsICJUWVBfUFJPUEVSVFkiLCAiU1VCVFlQX1BST1BFUlRZIiwgInJlZ2lzdGVyUHJvcGVydHlSZW5hbWVTeW5jIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgIkRFRkFVTFRfU09SVF9PUkRFUiIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlclNob3J0Y3V0U2NyaXB0cyJdCn0K
