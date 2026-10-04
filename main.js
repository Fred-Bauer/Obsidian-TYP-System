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
    var { snapshotSettings, offerUndo } = require_undo();
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
        let undoSnapshot = null;
        colorInput.addEventListener("input", async () => {
          undoSnapshot ?? (undoSnapshot = snapshotSettings(this.plugin));
          showState(colorInput.value, false);
          this.plugin.settings.typColors[typ] = colorInput.value;
          await this.plugin.saveSettings();
          onChange?.(colorInput.value);
        });
        colorInput.addEventListener("change", () => {
          const snapshot = undoSnapshot;
          undoSnapshot = null;
          if (snapshot && snapshot.typColors[typ] !== this.plugin.settings.typColors[typ]) {
            offerUndo(this.plugin, `Color of ${typ} changed.`, snapshot);
          }
          this.plugin.refreshTypColors?.();
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
          const snapshot = snapshotSettings(this.plugin);
          delete data.color;
          await this.plugin.saveSettings();
          offerUndo(this.plugin, `Color of Subtyp ${subtyp} reset.`, snapshot);
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
          const snapshot = snapshotSettings(this.plugin);
          const before = JSON.stringify(current.color ?? null);
          if (hasColorOffset(offset)) current.color = { ...offset };
          else delete current.color;
          await this.plugin.saveSettings();
          if (JSON.stringify(current.color ?? null) !== before) {
            offerUndo(this.plugin, `Color of Subtyp ${subtyp} changed.`, snapshot);
          }
          this.plugin.refreshTypColors?.();
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
          this.plugin.refreshTypColors?.();
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
      // Notes keep their TYP (it then shows as unregistered), so this only changes
      // settings: Undo afterwards, and the confirmation can be switched off (see
      // confirmDeletion).
      showDeleteConfirm(typ) {
        const apply = async () => {
          const snapshot = snapshotSettings(this.plugin);
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
          offerUndo(this.plugin, `TYP ${typ} deleted.`, snapshot);
          this.plugin.refreshTypColors?.();
        };
        this.confirmDeletion(
          { title: ["Delete ", typNameNode(this.plugin, typ, this.plugin.settings.typColors[typ] ?? null), "?"] },
          apply
        );
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL3R5cC1pbmRleC5qcyIsICJzcmMvc3VidHlwcy5qcyIsICJzcmMvdHlwLXV0aWxzLmpzIiwgInNyYy9mcm9udG1hdHRlci1zb3J0LmpzIiwgInNyYy9mcm9udG1hdHRlci1vcmRlci1lZGl0b3IuanMiLCAic3JjL3R5cC1jb2xvcnMuanMiLCAic3JjL3NldHRpbmdzLmpzIiwgInNyYy9iYXNlLWRpYWxvZ3MuanMiLCAic3JjL2Jhc2VzLmpzIiwgInNyYy9jb21tYW5kcy5qcyIsICJzcmMvY29uZmlybS1tb2RhbC5qcyIsICJzcmMvdW5kby5qcyIsICJzcmMvc2hvcnRjdXRzLmpzIiwgInNyYy9zaG9ydGN1dC1waWNrZXIuanMiLCAic3JjL3R5cC1mcm9udG1hdHRlci1lZGl0b3IuanMiLCAic3JjL2Zyb250bWF0dGVyLWJsb2Nrcy5qcyIsICJzcmMvdHlwLXBhbmUuanMiLCAic3JjL2ZpbGUtZXhwbG9yZXItY29sb3JzLmpzIiwgInNyYy9ncmFwaC1jb2xvcnMuanMiLCAic3JjL3NlYXJjaC1jb2xvcnMuanMiLCAic3JjL3JlY2VudC1maWxlcy1jb2xvcnMuanMiLCAic3JjL2JhY2tsaW5rLWNvbG9ycy5qcyIsICJzcmMvYm9va21hcmstY29sb3JzLmpzIiwgInNyYy9hY3RpdmUtdGl0bGUtY29sb3JzLmpzIiwgInNyYy9saW5rLWNvbG9ycy5qcyIsICJzcmMvZnJvbnRtYXR0ZXItZGVmYXVsdC1oaWdobGlnaHQuanMiLCAic3JjL3Byb3BlcnR5LXJlbmFtZS1zeW5jLmpzIiwgInNyYy90eXAtcGlja2VyLmpzIiwgInNyYy9zaG9ydGN1dC1zY3JpcHRzLmpzIiwgInNyYy9tYWluLmpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJjb25zdCB7IEV2ZW50cywgVEZpbGUsIGRlYm91bmNlIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5cbmNvbnN0IFRZUF9QUk9QRVJUWSA9IFwiVFlQXCI7XG5jb25zdCBTVUJUWVBfUFJPUEVSVFkgPSBcIlNVQlRZUFwiO1xuY29uc3QgRU1QVFlfRU5UUlkgPSBPYmplY3QuZnJlZXplKHsgdHlwS2V5OiBudWxsLCByYXdUeXA6IG51bGwsIHN1YnR5cEtleTogbnVsbCwgcmF3U3VidHlwOiBudWxsIH0pO1xuXG4vLyBDb2xsZWN0cyBjaGFuZ2VzIHRvIG1hbnkgZmlsZXMgKHJlbmFtaW5nIGEgVFlQIGluIG1hbnkgbm90ZXMsIHN5bmMpIGludG8gb25lXG4vLyBcImNoYW5nZVwiIGV2ZW50LiBObyByZXNldFRpbWVyLCBzbyBhIGNvbnN0YW50IHN0cmVhbSBzdGlsbCBnZXRzIHRocm91Z2hcbi8vIHJlZ3VsYXJseS5cbmNvbnN0IEZMVVNIX0RFTEFZX01TID0gMTAwO1xuXG5mdW5jdGlvbiByYXdJdGVtKHZhbHVlKSB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gXCJcIjtcbiAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiA/IEpTT04uc3RyaW5naWZ5KHZhbHVlKSA6IFN0cmluZyh2YWx1ZSk7XG59XG5cbi8vIEhvdyB0aGUgd2hvbGUgcGx1Z2luIHJlYWRzIGEgVFlQIHZhbHVlOiBkZWxpYmVyYXRlbHkgTk9UIG5vcm1hbGl6ZWQgLSB0aGVcbi8vIHJhdyBmb3JtIGlzIHRoZSBrZXkuIEEgVFlQIGlzIGV4YWN0bHkgb25lIGNsZWFuIHZhbHVlOyBhbnl0aGluZyBlbHNlIChwYWRkZWQsXG4vLyBsb3dlcmNhc2UsIGEgbGlzdCAtIGV2ZW4gd2l0aCBvbmUgaXRlbSkgYmVjb21lcyBpdHMgb3duIGtleSB0aGF0IG1hdGNoZXMgbm9cbi8vIHJlZ2lzdGVyZWQgVFlQOiBubyBjb2xvciwgbm90IGNvdW50ZWQgZm9yIHRoZSBcInJlYWxcIiBUWVAsIGFuZCBsaXN0ZWQgaW4gdGhlXG4vLyBUWVAtUGFuZSBhcyBhbiB1bnJlZ2lzdGVyZWQgZW50cnkgdGhhdCBhIGNsaWNrIGNsZWFucyB1cCAoc2VlIHJlZ2lzdGVyVHlwIGluXG4vLyB0eXAtcGFuZS5qcykuIExpc3RzIHNob3cgYXMgXCJbQSwgQl1cIiBhbmQgbmV2ZXIgY29pbmNpZGUgd2l0aCBhIHZhbHVlIFwiQSwgQlwiLlxuLy8gbnVsbCA9IG5vIFRZUCAobWlzc2luZywgZW1wdHksIGJsYW5rLCBlbXB0eSBsaXN0KS5cbmZ1bmN0aW9uIHR5cEtleU9mKHZhbHVlKSB7XG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgIGNvbnN0IGl0ZW1zID0gdmFsdWUubWFwKHJhd0l0ZW0pO1xuICAgIGlmIChpdGVtcy5ldmVyeSgoaXRlbSkgPT4gaXRlbS50cmltKCkgPT09IFwiXCIpKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gYFske2l0ZW1zLmpvaW4oXCIsIFwiKX1dYDtcbiAgfVxuICBjb25zdCB0ZXh0ID0gcmF3SXRlbSh2YWx1ZSk7XG4gIHJldHVybiB0ZXh0LnRyaW0oKSA9PT0gXCJcIiA/IG51bGwgOiB0ZXh0O1xufVxuXG4vLyBPYnNpZGlhbiB0cmVhdHMgcHJvcGVydHkgbmFtZXMgY2FzZS1pbnNlbnNpdGl2ZWx5IChcIlN1YnR5cFwiIGFuZCBcIlNVQlRZUFwiXG4vLyBhcmUgb25lIHByb3BlcnR5IGluIFwiQWxsIHByb3BlcnRpZXNcIiksIHNvIFRZUCBhbmQgU1VCVFlQIGFyZSByZWFkIHRoZSBzYW1lXG4vLyB3YXkuIFRoZSBleGFjdCBzcGVsbGluZyB3aW5zIGlmIGEgbm90ZSAod3JvbmdseSkgaGFzIHNldmVyYWwuXG5mdW5jdGlvbiBwcm9wZXJ0eUtleU9mKGZyb250bWF0dGVyLCBuYW1lKSB7XG4gIGlmICghZnJvbnRtYXR0ZXIpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoZnJvbnRtYXR0ZXIsIG5hbWUpKSByZXR1cm4gbmFtZTtcbiAgY29uc3QgbG93ZXIgPSBuYW1lLnRvTG93ZXJDYXNlKCk7XG4gIHJldHVybiBPYmplY3Qua2V5cyhmcm9udG1hdHRlcikuZmluZCgoa2V5KSA9PiBrZXkudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXIpO1xufVxuXG5mdW5jdGlvbiBwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBuYW1lKSB7XG4gIGNvbnN0IGtleSA9IHByb3BlcnR5S2V5T2YoZnJvbnRtYXR0ZXIsIG5hbWUpO1xuICByZXR1cm4ga2V5ID09PSB1bmRlZmluZWQgPyB1bmRlZmluZWQgOiBmcm9udG1hdHRlcltrZXldO1xufVxuXG4vLyBXcml0ZXMgdmFsdWUgdW5kZXIgdGhlIGNhbm9uaWNhbCBzcGVsbGluZyBgbmFtZWAgKGUuZy4gXCJTVUJUWVBcIikgaW50byB0aGVcbi8vIHByb2Nlc3NGcm9udE1hdHRlciBvYmplY3QuIEEgZGlmZmVyZW50bHkgc3BlbGxlZCB2YXJpYW50IChcIlN1YnR5cFwiKSBpc1xuLy8gcmVuYW1lZCBpbiBwbGFjZSAtIGluc2VydGlvbiBvcmRlciBpcyBZQU1MIG9yZGVyLCBzbyBhbGwga2V5cyBhcmUgcmUtYWRkZWRcbi8vIGluIHRoZWlyIG9yZGVyIGlmIG5lZWRlZCAoYXMgaW4gZnJvbnRtYXR0ZXItc29ydC5qcykuXG5mdW5jdGlvbiBzZXRDYW5vbmljYWxQcm9wZXJ0eShmcm9udG1hdHRlciwgbmFtZSwgdmFsdWUpIHtcbiAgY29uc3QgbG93ZXIgPSBuYW1lLnRvTG93ZXJDYXNlKCk7XG4gIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyhmcm9udG1hdHRlcik7XG4gIGlmICgha2V5cy5zb21lKChrZXkpID0+IGtleSAhPT0gbmFtZSAmJiBrZXkudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXIpKSB7XG4gICAgZnJvbnRtYXR0ZXJbbmFtZV0gPSB2YWx1ZTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3Qgc25hcHNob3QgPSB7IC4uLmZyb250bWF0dGVyIH07XG4gIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIGRlbGV0ZSBmcm9udG1hdHRlcltrZXldO1xuICBmb3IgKGNvbnN0IGtleSBvZiBrZXlzKSB7XG4gICAgaWYgKGtleS50b0xvd2VyQ2FzZSgpICE9PSBsb3dlcikgZnJvbnRtYXR0ZXJba2V5XSA9IHNuYXBzaG90W2tleV07XG4gICAgZWxzZSBpZiAoIShuYW1lIGluIGZyb250bWF0dGVyKSkgZnJvbnRtYXR0ZXJbbmFtZV0gPSB2YWx1ZTtcbiAgfVxufVxuXG4vLyBSZW1vdmVzIGBuYW1lYCBpbiBhbnkgc3BlbGxpbmcgZnJvbSB0aGUgcHJvY2Vzc0Zyb250TWF0dGVyIG9iamVjdC5cbmZ1bmN0aW9uIGRlbGV0ZVByb3BlcnR5KGZyb250bWF0dGVyLCBuYW1lKSB7XG4gIGNvbnN0IGxvd2VyID0gbmFtZS50b0xvd2VyQ2FzZSgpO1xuICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhmcm9udG1hdHRlcikpIHtcbiAgICBpZiAoa2V5LnRvTG93ZXJDYXNlKCkgPT09IGxvd2VyKSBkZWxldGUgZnJvbnRtYXR0ZXJba2V5XTtcbiAgfVxufVxuXG4vLyBTVUJUWVAgaXMgcmVhZCB0aGUgc2FtZSB3YXkgKHR5cEtleU9mKTogYXQgbW9zdCBvbmUgY2xlYW4gdmFsdWUgcGVyIG5vdGUsXG4vLyBhbnl0aGluZyBlbHNlIGlzIGl0cyBvd24gdW5yZWdpc3RlcmVkIGtleS5cbmZ1bmN0aW9uIHNhbWVFbnRyeShhLCBiKSB7XG4gIHJldHVybiAhIWEgJiYgISFiICYmIGEudHlwS2V5ID09PSBiLnR5cEtleSAmJiBhLnN1YnR5cEtleSA9PT0gYi5zdWJ0eXBLZXk7XG59XG5cbi8vIENlbnRyYWwgVFlQL1NVQlRZUCBpbmRleCBvdmVyIGFsbCBtYXJrZG93biBmaWxlcyAocGF0aCAtPiB2YWx1ZXMpLlxuLy9cbi8vIG1ldGFkYXRhQ2FjaGUgXCJjaGFuZ2VkXCIvXCJyZXNvbHZlZFwiIGZpcmUgb24gRVZFUlkgZWRpdCB0byBhbnkgbm90ZSAoYWJvdXRcbi8vIGV2ZXJ5IHR3byBzZWNvbmRzIHdoaWxlIHR5cGluZykuIFRoZSBpbmRleCBjb21wYXJlcyBwZXIgZmlsZSB3aGV0aGVyIFRZUCBvclxuLy8gU1VCVFlQIHJlYWxseSBjaGFuZ2VkIChvciBhIG5vdGUgYXBwZWFyZWQvZGlzYXBwZWFyZWQpIGFuZCBvbmx5IHRoZW4gZmlyZXNcbi8vIGl0cyBvd24gXCJjaGFuZ2VcIiBldmVudCAoYXJndW1lbnQ6IHNldCBvZiBhZmZlY3RlZCBwYXRocykuIEFsbCBjb2xvcmluZyBoYW5nc1xuLy8gb24gdGhpcyBldmVudCwgc28gbm9ybWFsIHR5cGluZyB0cmlnZ2VycyBubyByZWNvbG9yaW5nLlxuLy9cbi8vIEl0IGFsc28gY2FjaGVzIHRoZSB2YXVsdC13aWRlIGNvdW50cyAoVFlQLUxpc3QsIFN1YnR5cCBsaXN0LCBwaWNrZXJzLFxuLy8gZ2V0VHlwcygpKSBpbnN0ZWFkIG9mIHJlc2Nhbm5pbmcgZXZlcnkgbm90ZSBvbiBlYWNoIGNhbGwuXG5jbGFzcyBUeXBJbmRleCBleHRlbmRzIEV2ZW50cyB7XG4gIGNvbnN0cnVjdG9yKHBsdWdpbikge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gICAgdGhpcy5hcHAgPSBwbHVnaW4uYXBwO1xuICAgIHRoaXMuZW50cmllcyA9IG5ldyBNYXAoKTtcbiAgICB0aGlzLmJ1aWx0ID0gZmFsc2U7XG4gICAgdGhpcy5hZ2dyZWdhdGVzID0gbnVsbDtcbiAgICB0aGlzLnBlbmRpbmdQYXRocyA9IG5ldyBTZXQoKTtcbiAgICB0aGlzLmZsdXNoID0gZGVib3VuY2UoKCkgPT4ge1xuICAgICAgY29uc3QgcGF0aHMgPSB0aGlzLnBlbmRpbmdQYXRocztcbiAgICAgIHRoaXMucGVuZGluZ1BhdGhzID0gbmV3IFNldCgpO1xuICAgICAgdGhpcy50cmlnZ2VyKFwiY2hhbmdlXCIsIHBhdGhzKTtcbiAgICB9LCBGTFVTSF9ERUxBWV9NUyk7XG4gIH1cblxuICByZWdpc3RlcigpIHtcbiAgICBjb25zdCB7IHBsdWdpbiwgYXBwIH0gPSB0aGlzO1xuICAgIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC5tZXRhZGF0YUNhY2hlLm9uKFwiY2hhbmdlZFwiLCAoZmlsZSkgPT4gdGhpcy51cGRhdGUoZmlsZSkpKTtcbiAgICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAubWV0YWRhdGFDYWNoZS5vbihcImRlbGV0ZWRcIiwgKGZpbGUpID0+IHRoaXMucmVtb3ZlKGZpbGUucGF0aCkpKTtcbiAgICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJyZW5hbWVcIiwgKGZpbGUsIG9sZFBhdGgpID0+IHRoaXMucmVuYW1lKGZpbGUsIG9sZFBhdGgpKSk7XG4gICAgLy8gXCJFeGNsdWRlZCBmaWxlc1wiIGNoYW5nZWQ6IHRoZSBlbnRyaWVzIHN0YXkgdmFsaWQsIG9ubHkgdGhlIGZpbHRlcmVkXG4gICAgLy8gY291bnRzIGRvbid0LlxuICAgIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC52YXVsdC5vbihcImNvbmZpZy1jaGFuZ2VkXCIsICgpID0+ICh0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsKSkpO1xuXG4gICAgLy8gQXQgc3RhcnR1cCB0aGUgZmlyc3QgKGxhenkpIGFjY2VzcyBjYW4gY29tZSBiZWZvcmUgdGhlIG1ldGFkYXRhIGNhY2hlIGlzXG4gICAgLy8gZnVsbHkgbG9hZGVkLiBSZWJ1aWxkIG9uY2UgYWZ0ZXIgaXRzIGZpcnN0IGNvbXBsZXRlIHJlc29sdmU7IGRpZmZlcmVuY2VzXG4gICAgLy8gZ28gb3V0IHRocm91Z2ggdGhlIFwiY2hhbmdlXCIgZXZlbnQgbGlrZSBhbnkgb3RoZXIgY2hhbmdlLlxuICAgIGNvbnN0IHJlc29sdmVkUmVmID0gYXBwLm1ldGFkYXRhQ2FjaGUub24oXCJyZXNvbHZlZFwiLCAoKSA9PiB7XG4gICAgICBhcHAubWV0YWRhdGFDYWNoZS5vZmZyZWYocmVzb2x2ZWRSZWYpO1xuICAgICAgdGhpcy5yZWJ1aWxkKCk7XG4gICAgfSk7XG4gICAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocmVzb2x2ZWRSZWYpO1xuXG4gICAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IHRoaXMuZmx1c2guY2FuY2VsKCkpO1xuICB9XG5cbiAgcmVhZChmaWxlKSB7XG4gICAgY29uc3QgZnJvbnRtYXR0ZXIgPSB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXI7XG4gICAgY29uc3QgcmF3VHlwID0gcHJvcGVydHlWYWx1ZShmcm9udG1hdHRlciwgVFlQX1BST1BFUlRZKSA/PyBudWxsO1xuICAgIGNvbnN0IHJhd1N1YnR5cCA9IHByb3BlcnR5VmFsdWUoZnJvbnRtYXR0ZXIsIFNVQlRZUF9QUk9QRVJUWSkgPz8gbnVsbDtcbiAgICByZXR1cm4geyB0eXBLZXk6IHR5cEtleU9mKHJhd1R5cCksIHJhd1R5cCwgc3VidHlwS2V5OiB0eXBLZXlPZihyYXdTdWJ0eXApLCByYXdTdWJ0eXAgfTtcbiAgfVxuXG4gIGVuc3VyZUJ1aWx0KCkge1xuICAgIGlmICghdGhpcy5idWlsdCkgdGhpcy5yZWJ1aWxkKCk7XG4gIH1cblxuICByZWJ1aWxkKCkge1xuICAgIGNvbnN0IHByZXZpb3VzID0gdGhpcy5lbnRyaWVzO1xuICAgIGNvbnN0IHdhc0J1aWx0ID0gdGhpcy5idWlsdDtcbiAgICB0aGlzLmVudHJpZXMgPSBuZXcgTWFwKCk7XG4gICAgZm9yIChjb25zdCBmaWxlIG9mIHRoaXMuYXBwLnZhdWx0LmdldE1hcmtkb3duRmlsZXMoKSkgdGhpcy5lbnRyaWVzLnNldChmaWxlLnBhdGgsIHRoaXMucmVhZChmaWxlKSk7XG4gICAgdGhpcy5idWlsdCA9IHRydWU7XG4gICAgdGhpcy5hZ2dyZWdhdGVzID0gbnVsbDtcbiAgICBpZiAoIXdhc0J1aWx0KSByZXR1cm47XG5cbiAgICBmb3IgKGNvbnN0IFtwYXRoLCBlbnRyeV0gb2YgdGhpcy5lbnRyaWVzKSB7XG4gICAgICBpZiAoIXNhbWVFbnRyeShwcmV2aW91cy5nZXQocGF0aCksIGVudHJ5KSkgdGhpcy5wZW5kaW5nUGF0aHMuYWRkKHBhdGgpO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IHBhdGggb2YgcHJldmlvdXMua2V5cygpKSB7XG4gICAgICBpZiAoIXRoaXMuZW50cmllcy5oYXMocGF0aCkpIHRoaXMucGVuZGluZ1BhdGhzLmFkZChwYXRoKTtcbiAgICB9XG4gICAgaWYgKHRoaXMucGVuZGluZ1BhdGhzLnNpemUgPiAwKSB0aGlzLmZsdXNoKCk7XG4gIH1cblxuICBtYXJrQ2hhbmdlZChwYXRoKSB7XG4gICAgdGhpcy5hZ2dyZWdhdGVzID0gbnVsbDtcbiAgICB0aGlzLnBlbmRpbmdQYXRocy5hZGQocGF0aCk7XG4gICAgdGhpcy5mbHVzaCgpO1xuICB9XG5cbiAgdXBkYXRlKGZpbGUpIHtcbiAgICAvLyBCZWZvcmUgdGhlIGZpcnN0IGFjY2VzcyB0aGVyZSBpcyBub3RoaW5nIHN0YWxlOyB0aGUgbGF6eSBidWlsZCByZWFkc1xuICAgIC8vIGZyZXNoIGZyb20gdGhlIGNhY2hlIGFueXdheS5cbiAgICBpZiAoIXRoaXMuYnVpbHQgfHwgIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpIHx8IGZpbGUuZXh0ZW5zaW9uICE9PSBcIm1kXCIpIHJldHVybjtcbiAgICBjb25zdCBuZXh0ID0gdGhpcy5yZWFkKGZpbGUpO1xuICAgIGlmIChzYW1lRW50cnkodGhpcy5lbnRyaWVzLmdldChmaWxlLnBhdGgpLCBuZXh0KSkgcmV0dXJuO1xuICAgIHRoaXMuZW50cmllcy5zZXQoZmlsZS5wYXRoLCBuZXh0KTtcbiAgICB0aGlzLm1hcmtDaGFuZ2VkKGZpbGUucGF0aCk7XG4gIH1cblxuICByZW1vdmUocGF0aCkge1xuICAgIGlmICghdGhpcy5idWlsdCB8fCAhdGhpcy5lbnRyaWVzLmRlbGV0ZShwYXRoKSkgcmV0dXJuO1xuICAgIHRoaXMubWFya0NoYW5nZWQocGF0aCk7XG4gIH1cblxuICByZW5hbWUoZmlsZSwgb2xkUGF0aCkge1xuICAgIGlmICghdGhpcy5idWlsdCkgcmV0dXJuO1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5lbnRyaWVzLmdldChvbGRQYXRoKTtcbiAgICBpZiAoZW50cnkpIHtcbiAgICAgIHRoaXMuZW50cmllcy5kZWxldGUob2xkUGF0aCk7XG4gICAgICB0aGlzLm1hcmtDaGFuZ2VkKG9sZFBhdGgpO1xuICAgIH1cbiAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlICYmIGZpbGUuZXh0ZW5zaW9uID09PSBcIm1kXCIpIHtcbiAgICAgIHRoaXMuZW50cmllcy5zZXQoZmlsZS5wYXRoLCBlbnRyeSA/PyB0aGlzLnJlYWQoZmlsZSkpO1xuICAgICAgdGhpcy5tYXJrQ2hhbmdlZChmaWxlLnBhdGgpO1xuICAgIH1cbiAgfVxuXG4gIGVudHJ5Rm9yKGZpbGUpIHtcbiAgICBpZiAoIWZpbGUpIHJldHVybiBFTVBUWV9FTlRSWTtcbiAgICB0aGlzLmVuc3VyZUJ1aWx0KCk7XG4gICAgcmV0dXJuIHRoaXMuZW50cmllcy5nZXQoZmlsZS5wYXRoKSA/PyBFTVBUWV9FTlRSWTtcbiAgfVxuXG4gIC8vIFRZUCBrZXkgKHNlZSB0eXBLZXlPZikgb3IgbnVsbDsgZm9yIGEgY2xlYW4gdmFsdWUgc2ltcGx5IHRoZSBUWVAgbmFtZS5cbiAgdHlwT2YoZmlsZSkge1xuICAgIHJldHVybiB0aGlzLmVudHJ5Rm9yKGZpbGUpLnR5cEtleTtcbiAgfVxuXG4gIC8vIFNVQlRZUCBrZXkgKHNlZSB0eXBLZXlPZikgb3IgbnVsbC5cbiAgc3VidHlwT2YoZmlsZSkge1xuICAgIHJldHVybiB0aGlzLmVudHJ5Rm9yKGZpbGUpLnN1YnR5cEtleTtcbiAgfVxuXG4gIC8vIEFuIGFjdHVhbCBmcm9udG1hdHRlciB2YWx1ZSBmb3IgYSBrZXkgLSBmb3IgZGlzcGxheSwgc2VhcmNoIGFuZCBjbGVhbmluZ1xuICAvLyB1cCB1bnJlZ2lzdGVyZWQgZW50cmllcyAoYWxsIG5vdGVzIG9mIGEga2V5IHNoYXJlIHRoZSBzYW1lIHJhdyBmb3JtKS5cbiAgcmF3VmFsdWVPZih0eXBLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5hZ2dyZWdhdGUoKS5yYXdCeUtleS5nZXQodHlwS2V5KTtcbiAgfVxuXG4gIC8vIENsZWFuID0gYSBzaW5nbGUgdmFsdWUgd2l0aG91dCBwYWRkaW5nLiBMb3dlcmNhc2UgY291bnRzIGFzIGNsZWFuIChhIHZhbGlkXG4gIC8vIFRZUCBuYW1lLCBqdXN0IG5vdCByZWdpc3RlcmVkIHlldCk7IGxpc3RzIGFuZCBwYWRkaW5nIGRvbid0LlxuICBpc0NsZWFuS2V5KHR5cEtleSkge1xuICAgIGNvbnN0IHJhdyA9IHRoaXMucmF3VmFsdWVPZih0eXBLZXkpO1xuICAgIHJldHVybiByYXcgIT09IHVuZGVmaW5lZCAmJiAhQXJyYXkuaXNBcnJheShyYXcpICYmIHR5cEtleSA9PT0gdHlwS2V5LnRyaW0oKTtcbiAgfVxuXG4gIC8vIEZpbGVzIHdpdGggZXhhY3RseSB0aGlzIFRZUCBrZXksIGhvbm9yaW5nIHRoZSBleGNsdWRlZC1maWxlcyBzZXR0aW5nLlxuICBmaWxlc1dpdGhUeXAodHlwS2V5KSB7XG4gICAgcmV0dXJuIHRoaXMuZmlsZXNNYXRjaGluZygoZW50cnkpID0+IGVudHJ5LnR5cEtleSA9PT0gdHlwS2V5KTtcbiAgfVxuXG4gIC8vIEZpbGVzIHdpdGggZXhhY3RseSB0aGlzIFRZUCBhbmQgU1VCVFlQIGtleS5cbiAgZmlsZXNXaXRoU3VidHlwKHR5cEtleSwgc3VidHlwS2V5KSB7XG4gICAgcmV0dXJuIHRoaXMuZmlsZXNNYXRjaGluZygoZW50cnkpID0+IGVudHJ5LnR5cEtleSA9PT0gdHlwS2V5ICYmIGVudHJ5LnN1YnR5cEtleSA9PT0gc3VidHlwS2V5KTtcbiAgfVxuXG4gIGZpbGVzTWF0Y2hpbmcocHJlZGljYXRlKSB7XG4gICAgdGhpcy5lbnN1cmVCdWlsdCgpO1xuICAgIGNvbnN0IGluY2x1ZGVJZ25vcmVkID0gISF0aGlzLnBsdWdpbi5zZXR0aW5ncy5pbmNsdWRlSWdub3JlZEZpbGVzO1xuICAgIGNvbnN0IGZpbGVzID0gW107XG4gICAgZm9yIChjb25zdCBbcGF0aCwgZW50cnldIG9mIHRoaXMuZW50cmllcykge1xuICAgICAgaWYgKCFwcmVkaWNhdGUoZW50cnkpKSBjb250aW51ZTtcbiAgICAgIGlmICghaW5jbHVkZUlnbm9yZWQgJiYgdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5pc1VzZXJJZ25vcmVkKHBhdGgpKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgocGF0aCk7XG4gICAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSBmaWxlcy5wdXNoKGZpbGUpO1xuICAgIH1cbiAgICByZXR1cm4gZmlsZXM7XG4gIH1cblxuICAvLyBIb25vcnMgT2JzaWRpYW4ncyBcIkV4Y2x1ZGVkIGZpbGVzXCIgKHdoZXJlIEhpZGUgRm9sZGVycyBhbHNvIHB1dHMgaGlkZGVuXG4gIC8vIGZvbGRlcnMpIHVubGVzcyBcIkluY2x1ZGUgZXhjbHVkZWQgZmlsZXNcIiBpcyBvbi4gQSBub3RlIHdpdGhvdXQgYSBUWVAgaGFzXG4gIC8vIG5vIFNVQlRZUCBjb250ZXh0LlxuICBhZ2dyZWdhdGUoKSB7XG4gICAgdGhpcy5lbnN1cmVCdWlsdCgpO1xuICAgIGNvbnN0IGluY2x1ZGVJZ25vcmVkID0gISF0aGlzLnBsdWdpbi5zZXR0aW5ncy5pbmNsdWRlSWdub3JlZEZpbGVzO1xuICAgIGlmICh0aGlzLmFnZ3JlZ2F0ZXM/LmluY2x1ZGVJZ25vcmVkID09PSBpbmNsdWRlSWdub3JlZCkgcmV0dXJuIHRoaXMuYWdncmVnYXRlcztcblxuICAgIGNvbnN0IGNvdW50cyA9IG5ldyBNYXAoKTtcbiAgICBjb25zdCByYXdCeUtleSA9IG5ldyBNYXAoKTtcbiAgICBjb25zdCBzdWJ0eXBzQnlUeXAgPSBuZXcgTWFwKCk7XG4gICAgbGV0IG5vVHlwID0gMDtcbiAgICBmb3IgKGNvbnN0IFtwYXRoLCB7IHR5cEtleSwgcmF3VHlwLCBzdWJ0eXBLZXksIHJhd1N1YnR5cCB9XSBvZiB0aGlzLmVudHJpZXMpIHtcbiAgICAgIGlmICghaW5jbHVkZUlnbm9yZWQgJiYgdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5pc1VzZXJJZ25vcmVkKHBhdGgpKSBjb250aW51ZTtcbiAgICAgIGlmICh0eXBLZXkgPT09IG51bGwpIHtcbiAgICAgICAgbm9UeXArKztcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb3VudHMuc2V0KHR5cEtleSwgKGNvdW50cy5nZXQodHlwS2V5KSA/PyAwKSArIDEpO1xuICAgICAgaWYgKCFyYXdCeUtleS5oYXModHlwS2V5KSkgcmF3QnlLZXkuc2V0KHR5cEtleSwgcmF3VHlwKTtcbiAgICAgIGxldCBidWNrZXQgPSBzdWJ0eXBzQnlUeXAuZ2V0KHR5cEtleSk7XG4gICAgICBpZiAoIWJ1Y2tldCkge1xuICAgICAgICBidWNrZXQgPSB7IGNvdW50czogbmV3IE1hcCgpLCBub1N1YnR5cDogMCwgcmF3QnlLZXk6IG5ldyBNYXAoKSB9O1xuICAgICAgICBzdWJ0eXBzQnlUeXAuc2V0KHR5cEtleSwgYnVja2V0KTtcbiAgICAgIH1cbiAgICAgIGlmIChzdWJ0eXBLZXkgPT09IG51bGwpIHtcbiAgICAgICAgYnVja2V0Lm5vU3VidHlwKys7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBidWNrZXQuY291bnRzLnNldChzdWJ0eXBLZXksIChidWNrZXQuY291bnRzLmdldChzdWJ0eXBLZXkpID8/IDApICsgMSk7XG4gICAgICAgIGlmICghYnVja2V0LnJhd0J5S2V5LmhhcyhzdWJ0eXBLZXkpKSBidWNrZXQucmF3QnlLZXkuc2V0KHN1YnR5cEtleSwgcmF3U3VidHlwKTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5hZ2dyZWdhdGVzID0geyBpbmNsdWRlSWdub3JlZCwgY291bnRzLCBub1R5cCwgcmF3QnlLZXksIHN1YnR5cHNCeVR5cCB9O1xuICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZXM7XG4gIH1cblxuICAvLyBDYWNoZWQgLSBkb24ndCBtb2RpZnkgdGhlIHJldHVybmVkIG1hcHMuXG4gIHR5cENvdW50cygpIHtcbiAgICBjb25zdCB7IGNvdW50cywgbm9UeXAgfSA9IHRoaXMuYWdncmVnYXRlKCk7XG4gICAgcmV0dXJuIHsgY291bnRzLCBub1R5cCB9O1xuICB9XG5cbiAgLy8gVFlQIC0+IHsgY291bnRzOiBNYXAoU1VCVFlQIGtleSAtPiBjb3VudCksIG5vU3VidHlwLCByYXdCeUtleSB9LlxuICAvLyBDYWNoZWQgLSBkb24ndCBtb2RpZnkuXG4gIHN1YnR5cENvdW50cygpIHtcbiAgICByZXR1cm4gdGhpcy5hZ2dyZWdhdGUoKS5zdWJ0eXBzQnlUeXA7XG4gIH1cblxuICBzdWJ0eXBCdWNrZXQodHlwS2V5KSB7XG4gICAgcmV0dXJuIHRoaXMuc3VidHlwQ291bnRzKCkuZ2V0KHR5cEtleSkgPz8gRU1QVFlfQlVDS0VUO1xuICB9XG59XG5cbmNvbnN0IEVNUFRZX0JVQ0tFVCA9IE9iamVjdC5mcmVlemUoeyBjb3VudHM6IG5ldyBNYXAoKSwgbm9TdWJ0eXA6IDAsIHJhd0J5S2V5OiBuZXcgTWFwKCkgfSk7XG5cbm1vZHVsZS5leHBvcnRzID0geyBUeXBJbmRleCwgdHlwS2V5T2YsIHByb3BlcnR5VmFsdWUsIHNldENhbm9uaWNhbFByb3BlcnR5LCBkZWxldGVQcm9wZXJ0eSwgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFkgfTtcbiIsICJjb25zdCB7IHR5cEtleU9mLCBwcm9wZXJ0eVZhbHVlLCBzZXRDYW5vbmljYWxQcm9wZXJ0eSwgU1VCVFlQX1BST1BFUlRZIH0gPSByZXF1aXJlKFwiLi90eXAtaW5kZXhcIik7XG5cbi8vIFN1YnR5cCBuYW1lcyBhcmUgdGl0bGUgY2FzZSBwZXIgd29yZCAodW5saWtlIFRZUCBuYW1lcywgc2VlXG4vLyBub3JtYWxpemVUeXBOYW1lKTogXCJrdXJ6IEdFU0NISUNIVEVcIiAtPiBcIkt1cnogR2VzY2hpY2h0ZVwiLiBUaGUgU1VCVFlQXG4vLyBwcm9wZXJ0eSBpdHNlbGYgc3RheXMgdXBwZXJjYXNlLiBcImRlXCIgbG9jYWxlIGJlY2F1c2UgdGhlIG5hbWVzIGFyZSBHZXJtYW4uXG5mdW5jdGlvbiBub3JtYWxpemVTdWJ0eXBOYW1lKHJhdykge1xuICByZXR1cm4gcmF3LnRyaW0oKS5yZXBsYWNlKC9cXFMrL2csICh3b3JkKSA9PiB3b3JkLmNoYXJBdCgwKS50b0xvY2FsZVVwcGVyQ2FzZShcImRlXCIpICsgd29yZC5zbGljZSgxKS50b0xvY2FsZUxvd2VyQ2FzZShcImRlXCIpKTtcbn1cblxuLy8gUmVnaXN0ZXJlZCBTdWJ0eXBzIHBlciBUWVAgKHNldHRpbmdzLnR5cFN1YnR5cHMpOlxuLy8gICB7IFtUWVBdOiB7IFtTVUJUWVBdOiB7IGZyb250bWF0dGVyOiB7Li4ufSwgZmxvYXRpbmdLZXlzOiBbLi4uXSwgc2hvcnRjdXRzOiB7Li4ufSwgbWFudWFsPzogZmFsc2UgfSB9IH1cbi8vIEEgU3VidHlwIGJlbG9uZ3MgdG8gZXhhY3RseSBvbmUgVFlQLCB0aG91Z2ggdGhlIHNhbWUgbmFtZSBtYXkgYWxzbyBleGlzdFxuLy8gdW5kZXIgYW5vdGhlciBUWVAuIEtleSBvcmRlciBpcyB0aGUgYmxvY2sgb3JkZXIgaW4gdGhlIFRZUC1QYW5lLCBhbHdheXNcbi8vIGJlbG93IHRoZSBUWVAtRnJvbnRtYXR0ZXIuIGZyb250bWF0dGVyIGFkZHMgdG8gb3Igb3ZlcnJpZGVzIHRoZVxuLy8gVFlQLUZyb250bWF0dGVyOyBmbG9hdGluZ0tleXMgYW5kIHNob3J0Y3V0cyB3b3JrIGxpa2UgdHlwRmxvYXRpbmdLZXlzIGFuZFxuLy8gdHlwU2hvcnRjdXRzLiBPbGRlciBkYXRhIGxhY2tzIHNob3J0Y3V0cywgc28gcmVhZGVycyB0cmVhdCBpdCBhcyBvcHRpb25hbC5cbi8vIG1hbnVhbCB3b3JrcyBsaWtlIHR5cE1hbnVhbDogb25seSB0aGUgZGV2aWF0aW9uIChmYWxzZSkgaXMgc3RvcmVkLlxuLy9cbi8vIFRoZSBzYW1lIGtleSBtYXkgYXBwZWFyIGluIHNldmVyYWwgYmxvY2tzIG9mIG9uZSBUWVAgKG9ubHkgd2l0aGluIE9ORSBibG9ja1xuLy8gaXMgaXQgbmVjZXNzYXJpbHkgdW5pcXVlKTpcbi8vICAgLSBpbiB0d28gU3VidHlwIGJsb2Nrczogbm8gY29uZmxpY3QsIGEgbm90ZSBoYXMgYXQgbW9zdCBvbmUgU1VCVFlQO1xuLy8gICAtIGluIHRoZSBUWVAtRnJvbnRtYXR0ZXIgQU5EIGEgU3VidHlwIGJsb2NrOiB0aGUgU3VidHlwIG92ZXJyaWRlcyB2YWx1ZVxuLy8gICAgIGFuZCBmbG9hdGluZyBmbGFnLCB0aGUgcm93IGtlZXBzIHRoZSBUWVAtRnJvbnRtYXR0ZXIgcG9zaXRpb24uIGdldFR5cERlZmF1bHRzXG4vLyAgICAgKG1haW4uanMpIGFuZCBvcmRlcmVkRGVmYXVsdEtleXMgKGZyb250bWF0dGVyLXNvcnQuanMpIG11c3QgdXNlIHRoZSBzYW1lXG4vLyAgICAgcnVsZSwgb3Igc29ydGluZyB3b3VsZCByZS1zb3J0IGEgZnJlc2hseSBjcmVhdGVkIG5vdGUgcmlnaHQgYXdheS5cblxuLy8gXCJTdGlsbCB0byBiZSBmaWxsZWRcIjogd2hlbiB0d28gYmxvY2tzIG9yIHR3byBwcm9wZXJ0aWVzIG1lcmdlLCBzdWNoIGEgdmFsdWVcbi8vIGlzIGZpbGxlZCBmcm9tIHRoZSBvdGhlciBpbnN0ZWFkIG9mIG92ZXJ3cml0aW5nIHRoZSBleGlzdGluZyBlbnRyeSAoc2VlXG4vLyBtZXJnZVN1YnR5cHMgaGVyZSBhbmQgcmVuYW1lSW5TdG9yZSBpbiBwcm9wZXJ0eS1yZW5hbWUtc3luYy5qcykuXG5mdW5jdGlvbiBpc0VtcHR5VmFsdWUodmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IFwiXCI7XG59XG5cbmZ1bmN0aW9uIGdldFN1YnR5cE5hbWVzKHNldHRpbmdzLCB0eXApIHtcbiAgcmV0dXJuIE9iamVjdC5rZXlzKHNldHRpbmdzLnR5cFN1YnR5cHM/Llt0eXBdID8/IHt9KTtcbn1cblxuZnVuY3Rpb24gZ2V0U3VidHlwKHNldHRpbmdzLCB0eXAsIHN1YnR5cCkge1xuICByZXR1cm4gc2V0dGluZ3MudHlwU3VidHlwcz8uW3R5cF0/LltzdWJ0eXBdID8/IG51bGw7XG59XG5cbmZ1bmN0aW9uIGVuc3VyZVN1YnR5cChzZXR0aW5ncywgdHlwLCBzdWJ0eXApIHtcbiAgaWYgKCFzZXR0aW5ncy50eXBTdWJ0eXBzKSBzZXR0aW5ncy50eXBTdWJ0eXBzID0ge307XG4gIGlmICghc2V0dGluZ3MudHlwU3VidHlwc1t0eXBdKSBzZXR0aW5ncy50eXBTdWJ0eXBzW3R5cF0gPSB7fTtcbiAgY29uc3QgYnlOYW1lID0gc2V0dGluZ3MudHlwU3VidHlwc1t0eXBdO1xuICBpZiAoIWJ5TmFtZVtzdWJ0eXBdKSB7XG4gICAgYnlOYW1lW3N1YnR5cF0gPSB7IGZyb250bWF0dGVyOiB7fSwgZmxvYXRpbmdLZXlzOiBbXSwgc2hvcnRjdXRzOiB7fSB9O1xuICAgIC8vIEEgbmV3IFN1YnR5cCBvZiBhIFRZUCB0aGF0IGlzbid0IG1hbnVhbGx5IGNyZWF0YWJsZSBpc24ndCBlaXRoZXIgKHNlZVxuICAgIC8vIGlzU3VidHlwTWFudWFsKS5cbiAgICBpZiAoc2V0dGluZ3MudHlwTWFudWFsPy5bdHlwXSA9PT0gZmFsc2UpIGJ5TmFtZVtzdWJ0eXBdLm1hbnVhbCA9IGZhbHNlO1xuICB9XG4gIHJldHVybiBieU5hbWVbc3VidHlwXTtcbn1cblxuLyogLS0tIFwiTWFudWFsbHkgY3JlYXRhYmxlXCIgcGVyIFN1YnR5cCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAqIExpa2UgdHlwTWFudWFsIGZvciBUWVAgZW50cmllczogb25seSBzd2l0Y2hpbmcgb2ZmIGlzIHN0b3JlZFxuICogKG1hbnVhbDogZmFsc2UpOyBubyBlbnRyeSBvciB0cnVlIG1lYW5zIG9uLiBEZWNpZGVzIHdoZXRoZXIgdGhlIFN1YnR5cFxuICogc2hvd3MgdXAgaW4gZ2V0U3VidHlwcygpIChtYWluLmpzKSBhbmQgdGh1cyBpbiB0aGUgU3VidHlwLVBpY2tlci5cbiAqXG4gKiBUWVAgYW5kIFN1YnR5cCBhcmUgbGlua2VkLCBiZWNhdXNlIHRoZSBwaWNrZXIgb25seSByZWFjaGVzIGEgU3VidHlwIHRocm91Z2hcbiAqIGl0cyBUWVA6IHN3aXRjaGluZyBhIFRZUCBvZmYgc3dpdGNoZXMgYWxsIGl0cyBTdWJ0eXBzIG9mZiwgc3dpdGNoaW5nIGl0IG9uXG4gKiBzd2l0Y2hlcyB0aGVtIGFsbCBvbiAoc2V0QWxsU3VidHlwc01hbnVhbCksIGFuZCBzd2l0Y2hpbmcgYSBzaW5nbGUgU3VidHlwIG9uXG4gKiBhbHNvIHN3aXRjaGVzIGl0cyBUWVAgb24sIGxlYXZpbmcgdGhlIG90aGVyIFN1YnR5cHMgYWxvbmUgKHNlZVxuICogcmVuZGVyU3VidHlwTWFudWFsVG9nZ2xlIGluIHR5cC1wYW5lLmpzKS4gU28gYSBTdWJ0eXAgaXMgb25seSBldmVyIG1hbnVhbGx5XG4gKiBjcmVhdGFibGUgaWYgaXRzIFRZUCBpcy5cbiAqIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuZnVuY3Rpb24gaXNTdWJ0eXBNYW51YWwoc2V0dGluZ3MsIHR5cCwgc3VidHlwKSB7XG4gIHJldHVybiBnZXRTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgc3VidHlwKT8ubWFudWFsICE9PSBmYWxzZTtcbn1cblxuZnVuY3Rpb24gc2V0U3VidHlwTWFudWFsKHNldHRpbmdzLCB0eXAsIHN1YnR5cCwgb24pIHtcbiAgY29uc3QgZGF0YSA9IGdldFN1YnR5cChzZXR0aW5ncywgdHlwLCBzdWJ0eXApO1xuICBpZiAoIWRhdGEpIHJldHVybjtcbiAgaWYgKG9uKSBkZWxldGUgZGF0YS5tYW51YWw7XG4gIGVsc2UgZGF0YS5tYW51YWwgPSBmYWxzZTtcbn1cblxuZnVuY3Rpb24gc2V0QWxsU3VidHlwc01hbnVhbChzZXR0aW5ncywgdHlwLCBvbikge1xuICBmb3IgKGNvbnN0IHN1YnR5cCBvZiBnZXRTdWJ0eXBOYW1lcyhzZXR0aW5ncywgdHlwKSkgc2V0U3VidHlwTWFudWFsKHNldHRpbmdzLCB0eXAsIHN1YnR5cCwgb24pO1xufVxuXG4vLyBXaGVuIGEgVFlQIGlzIHJlbmFtZWQsIGl0cyBTdWJ0eXBzIG1vdmUgdG8gdGhlIG5ldyBuYW1lLlxuZnVuY3Rpb24gbW92ZVR5cFN1YnR5cHMoc2V0dGluZ3MsIG9sZFR5cCwgbmV3VHlwKSB7XG4gIGlmICghc2V0dGluZ3MudHlwU3VidHlwcz8uW29sZFR5cF0pIHJldHVybjtcbiAgc2V0dGluZ3MudHlwU3VidHlwc1tuZXdUeXBdID0gc2V0dGluZ3MudHlwU3VidHlwc1tvbGRUeXBdO1xuICBkZWxldGUgc2V0dGluZ3MudHlwU3VidHlwc1tvbGRUeXBdO1xufVxuXG5mdW5jdGlvbiBkZWxldGVUeXBTdWJ0eXBzKHNldHRpbmdzLCB0eXApIHtcbiAgaWYgKHNldHRpbmdzLnR5cFN1YnR5cHMpIGRlbGV0ZSBzZXR0aW5ncy50eXBTdWJ0eXBzW3R5cF07XG59XG5cbi8vIE1lcmdpbmcgdHdvIFRZUCBlbnRyaWVzOiBTdWJ0eXBzIG9ubHkgaW4gc291cmNlIG1vdmUgb3Zlci4gQmxvY2tzIHdpdGggdGhlXG4vLyBzYW1lIG5hbWUgYXJlIGNvbWJpbmVkIC0gZm9yIGEgc2hhcmVkIGtleSB0aGUgdGFyZ2V0J3MgdmFsdWUgYW5kIGZsb2F0aW5nXG4vLyBmbGFnIHdpbiwga2V5cyBvbmx5IGluIHNvdXJjZSBhcmUgYXBwZW5kZWQuIEEgbW92ZWQga2V5IHRoYXQgaXMgYWxzbyBpbiB0aGVcbi8vIHRhcmdldCdzIFRZUC1Gcm9udG1hdHRlciBzdGF5cyBpbiBib3RoLCB3aGljaCBpcyB0aGUgbm9ybWFsIG92ZXJyaWRlLlxuZnVuY3Rpb24gbWVyZ2VUeXBTdWJ0eXBzKHNldHRpbmdzLCBzb3VyY2UsIHRhcmdldCkge1xuICBjb25zdCBzb3VyY2VTdWJ0eXBzID0gc2V0dGluZ3MudHlwU3VidHlwcz8uW3NvdXJjZV07XG4gIGlmICghc291cmNlU3VidHlwcykgcmV0dXJuO1xuICBmb3IgKGNvbnN0IFtuYW1lLCBzb3VyY2VEYXRhXSBvZiBPYmplY3QuZW50cmllcyhzb3VyY2VTdWJ0eXBzKSkge1xuICAgIGNvbnN0IHRhcmdldERhdGEgPSBnZXRTdWJ0eXAoc2V0dGluZ3MsIHRhcmdldCwgbmFtZSk7XG4gICAgaWYgKCF0YXJnZXREYXRhKSB7XG4gICAgICBlbnN1cmVTdWJ0eXAoc2V0dGluZ3MsIHRhcmdldCwgbmFtZSk7XG4gICAgICBzZXR0aW5ncy50eXBTdWJ0eXBzW3RhcmdldF1bbmFtZV0gPSBzb3VyY2VEYXRhO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IHRhcmdldExvd2VyID0gbmV3IFNldChPYmplY3Qua2V5cyh0YXJnZXREYXRhLmZyb250bWF0dGVyKS5tYXAoKGtleSkgPT4ga2V5LnRvTG93ZXJDYXNlKCkpKTtcbiAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzb3VyY2VEYXRhLmZyb250bWF0dGVyKSkge1xuICAgICAgaWYgKGtleSA9PT0gXCJcIiB8fCB0YXJnZXRMb3dlci5oYXMoa2V5LnRvTG93ZXJDYXNlKCkpKSBjb250aW51ZTtcbiAgICAgIHRhcmdldERhdGEuZnJvbnRtYXR0ZXJba2V5XSA9IHZhbHVlO1xuICAgICAgaWYgKHNvdXJjZURhdGEuZmxvYXRpbmdLZXlzLmluY2x1ZGVzKGtleSkpIHRhcmdldERhdGEuZmxvYXRpbmdLZXlzLnB1c2goa2V5KTtcbiAgICAgIC8vIFRoZSBzaG9ydGN1dCBiZWxvbmdzIHRvIHRoZSBrZXkgYW5kIG1vdmVzIHdpdGggaXQuXG4gICAgICBjb25zdCBzaG9ydGN1dCA9IHNvdXJjZURhdGEuc2hvcnRjdXRzPy5ba2V5XTtcbiAgICAgIGlmIChzaG9ydGN1dCkgKHRhcmdldERhdGEuc2hvcnRjdXRzID8/PSB7fSlba2V5XSA9IHNob3J0Y3V0O1xuICAgIH1cbiAgfVxuICBkZWxldGUgc2V0dGluZ3MudHlwU3VidHlwc1tzb3VyY2VdO1xufVxuXG4vLyBSZW5hbWVzIGEgU3VidHlwIHdpdGhpbiBpdHMgVFlQOyB0aGUgYmxvY2sga2VlcHMgaXRzIHBvc2l0aW9uIChkaXNwbGF5XG4vLyBvcmRlciA9IGtleSBvcmRlcikuXG5mdW5jdGlvbiByZW5hbWVTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgb2xkTmFtZSwgbmV3TmFtZSkge1xuICBjb25zdCBieU5hbWUgPSBzZXR0aW5ncy50eXBTdWJ0eXBzPy5bdHlwXTtcbiAgaWYgKCFieU5hbWU/LltvbGROYW1lXSB8fCBvbGROYW1lID09PSBuZXdOYW1lKSByZXR1cm47XG4gIHNldHRpbmdzLnR5cFN1YnR5cHNbdHlwXSA9IE9iamVjdC5mcm9tRW50cmllcyhcbiAgICBPYmplY3QuZW50cmllcyhieU5hbWUpLm1hcCgoW25hbWUsIGRhdGFdKSA9PiBbbmFtZSA9PT0gb2xkTmFtZSA/IG5ld05hbWUgOiBuYW1lLCBkYXRhXSlcbiAgKTtcbn1cblxuLy8gT3JkZXIgb2YgYWxsIGJsb2NrcyBvZiBhIFRZUCwgbnVsbCA9IFRZUC1Gcm9udG1hdHRlciAoYWx3YXlzIGZpcnN0KSwgdGhlblxuLy8gdGhlIFN1YnR5cHMgaW4ga2V5IG9yZGVyLiBEcml2ZXMgdGhlIFRZUC1QYW5lIGFzIHdlbGwgYXMgZnJvbnRtYXR0ZXJcbi8vIHNvcnRpbmcgKHNlZSBvcmRlcmVkRGVmYXVsdEtleXMpLlxuZnVuY3Rpb24gZ2V0U2VjdGlvbk9yZGVyKHNldHRpbmdzLCB0eXApIHtcbiAgcmV0dXJuIFtudWxsLCAuLi5nZXRTdWJ0eXBOYW1lcyhzZXR0aW5ncywgdHlwKV07XG59XG5cbi8vIE5ldyBibG9jayBvcmRlciBmcm9tIGRyYWcgJiBkcm9wIGluIHRoZSBUWVAtUGFuZSwgc2hhcGVkIGxpa2Vcbi8vIGdldFNlY3Rpb25PcmRlcjsgdGhlIGxlYWRpbmcgbnVsbCBpcyBpZ25vcmVkICh0aGUgVFlQLUZyb250bWF0dGVyIGNhbid0XG4vLyBtb3ZlKS4gU3VidHlwcyBub3QgbGlzdGVkIHN0YXkgYXQgdGhlIGVuZC5cbmZ1bmN0aW9uIHJlb3JkZXJTdWJ0eXBzKHNldHRpbmdzLCB0eXAsIG9yZGVyKSB7XG4gIGNvbnN0IGJ5TmFtZSA9IHNldHRpbmdzLnR5cFN1YnR5cHM/Llt0eXBdO1xuICBpZiAoIWJ5TmFtZSkgcmV0dXJuO1xuICBjb25zdCBuYW1lcyA9IG9yZGVyLmZpbHRlcigobmFtZSkgPT4gbmFtZSAhPT0gbnVsbCAmJiBieU5hbWVbbmFtZV0pO1xuICBjb25zdCBvcmRlcmVkID0gWy4uLm5hbWVzLCAuLi5PYmplY3Qua2V5cyhieU5hbWUpLmZpbHRlcigobmFtZSkgPT4gIW5hbWVzLmluY2x1ZGVzKG5hbWUpKV07XG4gIHNldHRpbmdzLnR5cFN1YnR5cHNbdHlwXSA9IE9iamVjdC5mcm9tRW50cmllcyhvcmRlcmVkLm1hcCgobmFtZSkgPT4gW25hbWUsIGJ5TmFtZVtuYW1lXV0pKTtcbn1cblxuZnVuY3Rpb24gZGVsZXRlU3VidHlwKHNldHRpbmdzLCB0eXAsIG5hbWUpIHtcbiAgY29uc3QgYnlOYW1lID0gc2V0dGluZ3MudHlwU3VidHlwcz8uW3R5cF07XG4gIGlmICghYnlOYW1lKSByZXR1cm47XG4gIGRlbGV0ZSBieU5hbWVbbmFtZV07XG4gIGlmIChPYmplY3Qua2V5cyhieU5hbWUpLmxlbmd0aCA9PT0gMCkgZGVsZXRlIHNldHRpbmdzLnR5cFN1YnR5cHNbdHlwXTtcbn1cblxuLy8gTWVyZ2luZyB0d28gU3VidHlwcyBvZiBvbmUgVFlQOiBzb3VyY2UncyBwcm9wZXJ0aWVzIGdvIHRvIHRoZSBlbmQgb2YgdGhlXG4vLyB0YXJnZXQgYmxvY2ssIHNvdXJjZSBkaXNhcHBlYXJzLiBJZiB0aGUgdGFyZ2V0IGFscmVhZHkgaGFzIGEga2V5LCBpdCBrZWVwc1xuLy8gcG9zaXRpb24sIHZhbHVlIGFuZCBmbG9hdGluZyBmbGFnOyBvbmx5IGFuIGVtcHR5IHRhcmdldCB2YWx1ZSBpcyBmaWxsZWRcbi8vIGZyb20gc291cmNlIChzYW1lIHBhdHRlcm4gYXMgcmVuYW1lSW5TdG9yZSBpbiBwcm9wZXJ0eS1yZW5hbWUtc3luYy5qcykuXG5mdW5jdGlvbiBtZXJnZVN1YnR5cHMoc2V0dGluZ3MsIHR5cCwgc291cmNlLCB0YXJnZXQpIHtcbiAgY29uc3Qgc291cmNlRGF0YSA9IGdldFN1YnR5cChzZXR0aW5ncywgdHlwLCBzb3VyY2UpO1xuICBjb25zdCB0YXJnZXREYXRhID0gZ2V0U3VidHlwKHNldHRpbmdzLCB0eXAsIHRhcmdldCk7XG4gIGlmICghc291cmNlRGF0YSB8fCAhdGFyZ2V0RGF0YSB8fCBzb3VyY2UgPT09IHRhcmdldCkgcmV0dXJuO1xuXG4gIGNvbnN0IHRhcmdldEtleXMgPSBuZXcgTWFwKE9iamVjdC5rZXlzKHRhcmdldERhdGEuZnJvbnRtYXR0ZXIpLm1hcCgoa2V5KSA9PiBba2V5LnRvTG93ZXJDYXNlKCksIGtleV0pKTtcbiAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoc291cmNlRGF0YS5mcm9udG1hdHRlcikpIHtcbiAgICBpZiAoa2V5ID09PSBcIlwiKSBjb250aW51ZTtcbiAgICBjb25zdCBleGlzdGluZyA9IHRhcmdldEtleXMuZ2V0KGtleS50b0xvd2VyQ2FzZSgpKTtcbiAgICBpZiAoZXhpc3RpbmcgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGFyZ2V0RGF0YS5mcm9udG1hdHRlcltrZXldID0gdmFsdWU7XG4gICAgICB0YXJnZXRLZXlzLnNldChrZXkudG9Mb3dlckNhc2UoKSwga2V5KTtcbiAgICAgIGlmIChzb3VyY2VEYXRhLmZsb2F0aW5nS2V5cy5pbmNsdWRlcyhrZXkpICYmICF0YXJnZXREYXRhLmZsb2F0aW5nS2V5cy5pbmNsdWRlcyhrZXkpKSB0YXJnZXREYXRhLmZsb2F0aW5nS2V5cy5wdXNoKGtleSk7XG4gICAgICAvLyBUaGUgc2hvcnRjdXQgYmVsb25ncyB0byB0aGUga2V5IGFuZCBtb3ZlcyB3aXRoIGl0LlxuICAgICAgY29uc3Qgc2hvcnRjdXQgPSBzb3VyY2VEYXRhLnNob3J0Y3V0cz8uW2tleV07XG4gICAgICBpZiAoc2hvcnRjdXQpICh0YXJnZXREYXRhLnNob3J0Y3V0cyA/Pz0ge30pW2tleV0gPSBzaG9ydGN1dDtcbiAgICB9IGVsc2UgaWYgKGlzRW1wdHlWYWx1ZSh0YXJnZXREYXRhLmZyb250bWF0dGVyW2V4aXN0aW5nXSkpIHtcbiAgICAgIHRhcmdldERhdGEuZnJvbnRtYXR0ZXJbZXhpc3RpbmddID0gdmFsdWU7XG4gICAgfVxuICB9XG4gIGRlbGV0ZVN1YnR5cChzZXR0aW5ncywgdHlwLCBzb3VyY2UpO1xufVxuXG4vLyBSZXdyaXRlcyB0aGUgU1VCVFlQIG9mIGV2ZXJ5IG5vdGUgd2l0aCBUWVAga2V5IGB0eXBgIGFuZCBTVUJUWVAga2V5IG9sZEtleVxuLy8gdG8gdGhlIHNpbmdsZSB2YWx1ZSBuZXdWYWx1ZSAtIGxpa2UgcmVuYW1lVHlwSW5Ob3RlcygpIGluIHR5cC1wYW5lLmpzLlxuYXN5bmMgZnVuY3Rpb24gcmVuYW1lU3VidHlwSW5Ob3RlcyhwbHVnaW4sIHR5cCwgb2xkS2V5LCBuZXdWYWx1ZSkge1xuICBsZXQgY2hhbmdlZCA9IDA7XG4gIGZvciAoY29uc3QgZmlsZSBvZiBwbHVnaW4udHlwSW5kZXguZmlsZXNXaXRoU3VidHlwKHR5cCwgb2xkS2V5KSkge1xuICAgIGxldCBtYXRjaGVkID0gZmFsc2U7XG4gICAgYXdhaXQgcGx1Z2luLmFwcC5maWxlTWFuYWdlci5wcm9jZXNzRnJvbnRNYXR0ZXIoZmlsZSwgKGZyb250bWF0dGVyKSA9PiB7XG4gICAgICBpZiAodHlwS2V5T2YocHJvcGVydHlWYWx1ZShmcm9udG1hdHRlciwgU1VCVFlQX1BST1BFUlRZKSkgIT09IG9sZEtleSkgcmV0dXJuO1xuICAgICAgc2V0Q2Fub25pY2FsUHJvcGVydHkoZnJvbnRtYXR0ZXIsIFNVQlRZUF9QUk9QRVJUWSwgbmV3VmFsdWUpO1xuICAgICAgbWF0Y2hlZCA9IHRydWU7XG4gICAgfSk7XG4gICAgaWYgKG1hdGNoZWQpIGNoYW5nZWQrKztcbiAgfVxuICByZXR1cm4gY2hhbmdlZDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIG5vcm1hbGl6ZVN1YnR5cE5hbWUsXG4gIGlzRW1wdHlWYWx1ZSxcbiAgZ2V0U3VidHlwTmFtZXMsXG4gIGdldFN1YnR5cCxcbiAgZW5zdXJlU3VidHlwLFxuICBpc1N1YnR5cE1hbnVhbCxcbiAgc2V0U3VidHlwTWFudWFsLFxuICBzZXRBbGxTdWJ0eXBzTWFudWFsLFxuICBtb3ZlVHlwU3VidHlwcyxcbiAgZGVsZXRlVHlwU3VidHlwcyxcbiAgbWVyZ2VUeXBTdWJ0eXBzLFxuICByZW5hbWVTdWJ0eXAsXG4gIGdldFNlY3Rpb25PcmRlcixcbiAgcmVvcmRlclN1YnR5cHMsXG4gIGRlbGV0ZVN1YnR5cCxcbiAgbWVyZ2VTdWJ0eXBzLFxuICByZW5hbWVTdWJ0eXBJbk5vdGVzLFxufTtcbiIsICIvLyBTdGF0ZWxlc3MgaGVscGVycyBhcm91bmQgVFlQIG5hbWVzLCBzb3J0aW5nIGFuZCBtZXNzYWdlIHRleHQuXG5cbi8vIFRZUCBuYW1lcyB0eXBlZCBpbnRvIHRoZSBsaXN0IGFyZSBhbHdheXMgdXBwZXJjYXNlLiBWYWx1ZXMgd3JpdHRlbiBkaXJlY3RseVxuLy8gaW50byBhIG5vdGUncyBmcm9udG1hdHRlciBhcmUgbGVmdCBhbG9uZSAoc2VlIHRoZSB1bnJlZ2lzdGVyZWQgcm93cyBpblxuLy8gdHlwLXBhbmUuanMpLlxuZnVuY3Rpb24gbm9ybWFsaXplVHlwTmFtZShyYXcpIHtcbiAgcmV0dXJuIHJhdy50cmltKCkudG9VcHBlckNhc2UoKTtcbn1cblxuLy8gXCIxIG5vdGVcIiwgXCIzIG5vdGVzXCIuIHdvcmQgaXMgdGhlIEVuZ2xpc2ggc2luZ3VsYXI7IGlycmVndWxhciBwbHVyYWxzIGFyZVxuLy8gcGFzc2VkIGV4cGxpY2l0bHkuXG5mdW5jdGlvbiBwbHVyYWwoY291bnQsIHdvcmQsIHBsdXJhbFdvcmQgPSBgJHt3b3JkfXNgKSB7XG4gIHJldHVybiBgJHtjb3VudH0gJHtjb3VudCA9PT0gMSA/IHdvcmQgOiBwbHVyYWxXb3JkfWA7XG59XG5cbi8vIFwiYVwiLCBcImEgYW5kIGJcIiwgXCJhLCBiIGFuZCBjXCIuXG5mdW5jdGlvbiBqb2luQW5kKHBhcnRzKSB7XG4gIHJldHVybiBwYXJ0cy5sZW5ndGggPD0gMSA/IHBhcnRzLmpvaW4oXCJcIikgOiBgJHtwYXJ0cy5zbGljZSgwLCAtMSkuam9pbihcIiwgXCIpfSBhbmQgJHtwYXJ0c1twYXJ0cy5sZW5ndGggLSAxXX1gO1xufVxuXG4vLyBIdWUgKDAtMzYwXHUwMEIwKSBvZiBhIGhleCBjb2xvciwgc28gY29sb3JzIHNvcnQgYWxvbmcgdGhlIHNwZWN0cnVtIGluc3RlYWQgb2YgYnlcbi8vIGhleCBzdHJpbmcuIEFjaHJvbWF0aWMgY29sb3JzIChncmF5L2JsYWNrL3doaXRlKSBoYXZlIG5vIGh1ZSBhbmQgcmV0dXJuIG51bGw7XG4vLyBjb21wYXJlVHlwcyBrZWVwcyB0aGVtIGxhc3QgaW4gYm90aCBkaXJlY3Rpb25zLlxuZnVuY3Rpb24gaGV4VG9IdWUoaGV4KSB7XG4gIGNvbnN0IG1hdGNoID0gL14jPyhbMC05YS1mXXs2fSkkL2kuZXhlYyhoZXggPz8gXCJcIik7XG4gIGlmICghbWF0Y2gpIHJldHVybiBudWxsO1xuICBjb25zdCBpbnQgPSBwYXJzZUludChtYXRjaFsxXSwgMTYpO1xuICBjb25zdCByID0gKChpbnQgPj4gMTYpICYgMjU1KSAvIDI1NTtcbiAgY29uc3QgZyA9ICgoaW50ID4+IDgpICYgMjU1KSAvIDI1NTtcbiAgY29uc3QgYiA9IChpbnQgJiAyNTUpIC8gMjU1O1xuICBjb25zdCBtYXggPSBNYXRoLm1heChyLCBnLCBiKTtcbiAgY29uc3QgbWluID0gTWF0aC5taW4ociwgZywgYik7XG4gIGNvbnN0IGRlbHRhID0gbWF4IC0gbWluO1xuICBpZiAoZGVsdGEgPT09IDApIHJldHVybiBudWxsO1xuXG4gIGxldCBodWU7XG4gIGlmIChtYXggPT09IHIpIGh1ZSA9ICgoZyAtIGIpIC8gZGVsdGEpICUgNjtcbiAgZWxzZSBpZiAobWF4ID09PSBnKSBodWUgPSAoYiAtIHIpIC8gZGVsdGEgKyAyO1xuICBlbHNlIGh1ZSA9IChyIC0gZykgLyBkZWx0YSArIDQ7XG4gIGh1ZSAqPSA2MDtcbiAgcmV0dXJuIGh1ZSA8IDAgPyBodWUgKyAzNjAgOiBodWU7XG59XG5cbi8vIFNoYXJlZCBjb21wYXJpc29uIGZvciBUWVAgYW5kIFNVQlRZUCBsaXN0cy4gdHlwQ29sb3JzIG1heSBiZSBlbXB0eSAoYSBTdWJ0eXBcbi8vIGhhcyBubyBjb2xvciBvZiBpdHMgb3duKTsgdGhlIFwiY29sb3JcIiBtb2RlIGlzIHRoZW4gbmV2ZXIgc2VsZWN0ZWQuXG5mdW5jdGlvbiBjb21wYXJlVHlwcyhtb2RlLCBhLCBiLCBjb3VudHMsIHR5cENvbG9ycykge1xuICBjb25zdCBba2V5LCBkaXJdID0gbW9kZS5zcGxpdChcIi1cIik7XG4gIGxldCBjbXA7XG4gIGlmIChrZXkgPT09IFwiY291bnRcIikge1xuICAgIGNtcCA9IChjb3VudHMuZ2V0KGEpID8/IDApIC0gKGNvdW50cy5nZXQoYikgPz8gMCk7XG4gICAgaWYgKGRpciA9PT0gXCJkZXNjXCIpIGNtcCA9IC1jbXA7XG4gIH0gZWxzZSBpZiAoa2V5ID09PSBcImNvbG9yXCIpIHtcbiAgICBjb25zdCBodWVBID0gaGV4VG9IdWUodHlwQ29sb3JzW2FdID8/IG51bGwpO1xuICAgIGNvbnN0IGh1ZUIgPSBoZXhUb0h1ZSh0eXBDb2xvcnNbYl0gPz8gbnVsbCk7XG4gICAgLy8gQWNocm9tYXRpYyBjb2xvcnMgc3RheSBhdCB0aGUgZW5kIGluIGJvdGggZGlyZWN0aW9ucy5cbiAgICBpZiAoaHVlQSA9PT0gbnVsbCAmJiBodWVCID09PSBudWxsKSBjbXAgPSAwO1xuICAgIGVsc2UgaWYgKGh1ZUEgPT09IG51bGwpIGNtcCA9IDE7XG4gICAgZWxzZSBpZiAoaHVlQiA9PT0gbnVsbCkgY21wID0gLTE7XG4gICAgZWxzZSB7XG4gICAgICBjbXAgPSBodWVBIC0gaHVlQjtcbiAgICAgIGlmIChkaXIgPT09IFwiZGVzY1wiKSBjbXAgPSAtY21wO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBjbXAgPSBhLmxvY2FsZUNvbXBhcmUoYik7XG4gICAgaWYgKGRpciA9PT0gXCJkZXNjXCIpIGNtcCA9IC1jbXA7XG4gIH1cbiAgcmV0dXJuIGNtcCB8fCBhLmxvY2FsZUNvbXBhcmUoYik7XG59XG5cbi8vIFwibWFudWFsXCIga2VlcHMgdGhlIGdpdmVuIG9yZGVyOiBpdCBpcyB0aGUgc3RvcmVkIG9yZGVyIChzZXR0aW5ncy50eXBzLFxuLy8gcmVhcnJhbmdlZCBieSBkcmFnICYgZHJvcCksIHdoaWNoIG5vIHBhaXJ3aXNlIGNvbXBhcmlzb24gY291bGQgZGVyaXZlLlxuLy8gVXNlZCBieSBtYWluLmpzIChnZXRUeXBzKSBhbmQgdHlwLXBhbmUuanMgc28gYm90aCBzaG93IHRoZSBzYW1lIG9yZGVyLlxuZnVuY3Rpb24gc29ydFR5cHNCeU1vZGUodHlwcywgbW9kZSwgY291bnRzLCB0eXBDb2xvcnMpIHtcbiAgaWYgKG1vZGUgPT09IFwibWFudWFsXCIpIHJldHVybiBbLi4udHlwc107XG4gIHJldHVybiBbLi4udHlwc10uc29ydCgoYSwgYikgPT4gY29tcGFyZVR5cHMobW9kZSwgYSwgYiwgY291bnRzLCB0eXBDb2xvcnMpKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IG5vcm1hbGl6ZVR5cE5hbWUsIHBsdXJhbCwgam9pbkFuZCwgaGV4VG9IdWUsIGNvbXBhcmVUeXBzLCBzb3J0VHlwc0J5TW9kZSB9O1xuIiwgImNvbnN0IHsgZ2V0U3VidHlwIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBzXCIpO1xuY29uc3QgeyB0eXBLZXlPZiwgcHJvcGVydHlWYWx1ZSwgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcbmNvbnN0IHsgcGx1cmFsIH0gPSByZXF1aXJlKFwiLi90eXAtdXRpbHNcIik7XG5cbi8vIFRoZSBmb3VyIHBsYWNlaG9sZGVycyBvZiB0aGUgZ2xvYmFsIG9yZGVyOyB0aGUgb3JkZXIgZWRpdG9yIGxldHMgeW91IG1vdmVcbi8vIHRoZW0gYnV0IG5vdCByZW1vdmUgdGhlbS4gXCJ0eXBWYWx1ZVwiIGlzIHRoZSBUWVAgcHJvcGVydHkgaXRzZWxmLFxuLy8gXCJzdWJ0eXBWYWx1ZVwiIHRoZSBTVUJUWVAgcHJvcGVydHksIFwidHlwXCIgdGhlIFRZUC1Gcm9udG1hdHRlciBsaXN0LFxuLy8gXCJvdGhlclwiIGV2ZXJ5dGhpbmcgZWxzZS5cbmNvbnN0IERFRkFVTFRfR0xPQkFMX09SREVSID0gW3sga2luZDogXCJ0eXBWYWx1ZVwiIH0sIHsga2luZDogXCJzdWJ0eXBWYWx1ZVwiIH0sIHsga2luZDogXCJ0eXBcIiB9LCB7IGtpbmQ6IFwib3RoZXJcIiB9XTtcblxuLy8gRW5zdXJlcyBleGFjdGx5IG9uZSBlbnRyeSBwZXIgcGxhY2Vob2xkZXIuIE9sZGVyIHNhdmVkIG9yZGVycyBwcmVkYXRlIHNvbWVcbi8vIG9mIHRoZW07IG1pc3Npbmcgb25lcyBhcmUgYWRkZWQgYXQgYSBzZW5zaWJsZSBzcG90IChcInN1YnR5cFZhbHVlXCIgcmlnaHRcbi8vIGFmdGVyIFwidHlwVmFsdWVcIiwgdGhlIG90aGVycyBhdCB0aGUgZWRnZXMpIHdpdGhvdXQgdG91Y2hpbmcgdGhlIG9yZGVyIHRoZVxuLy8gdXNlciBhcnJhbmdlZC5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUdsb2JhbE9yZGVyKG9yZGVyKSB7XG4gIGNvbnN0IHJlc3VsdCA9IEFycmF5LmlzQXJyYXkob3JkZXIpID8gb3JkZXIuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkgJiYgdHlwZW9mIGVudHJ5ID09PSBcIm9iamVjdFwiKSA6IFtdO1xuICBjb25zdCBoYXNLaW5kID0gKGtpbmQpID0+IHJlc3VsdC5zb21lKChlbnRyeSkgPT4gZW50cnkua2luZCA9PT0ga2luZCk7XG4gIGlmICghaGFzS2luZChcInR5cFZhbHVlXCIpKSByZXN1bHQudW5zaGlmdCh7IGtpbmQ6IFwidHlwVmFsdWVcIiB9KTtcbiAgaWYgKCFoYXNLaW5kKFwic3VidHlwVmFsdWVcIikpIHtcbiAgICBjb25zdCB0eXBWYWx1ZUluZGV4ID0gcmVzdWx0LmZpbmRJbmRleCgoZW50cnkpID0+IGVudHJ5LmtpbmQgPT09IFwidHlwVmFsdWVcIik7XG4gICAgcmVzdWx0LnNwbGljZSh0eXBWYWx1ZUluZGV4ICsgMSwgMCwgeyBraW5kOiBcInN1YnR5cFZhbHVlXCIgfSk7XG4gIH1cbiAgaWYgKCFoYXNLaW5kKFwidHlwXCIpKSByZXN1bHQucHVzaCh7IGtpbmQ6IFwidHlwXCIgfSk7XG4gIGlmICghaGFzS2luZChcIm90aGVyXCIpKSByZXN1bHQucHVzaCh7IGtpbmQ6IFwib3RoZXJcIiB9KTtcbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gKiBGcm9udG1hdHRlciBzb3J0aW5nXG4gKiBQdXRzIHRoZSBwcm9wZXJ0aWVzIGEgbm90ZSBIQVMgaW50byBhIGZpeGVkIG9yZGVyIGJ1aWx0IGZyb21cbiAqIGdsb2JhbFByb3BlcnR5T3JkZXI6IHBpbm5lZCBzaW5nbGUgcHJvcGVydGllcywgdGhlIFRZUCBhbmRcbiAqIFNVQlRZUCBwcm9wZXJ0aWVzLCB0aGUgXCJUWVAtRnJvbnRtYXR0ZXJcIiBibG9jayAodGhlIFRZUCdzIGxpc3RcbiAqIGZvbGxvd2VkIGJ5IGl0cyBTdWJ0eXAgYmxvY2spIGFuZCBcIk90aGVyIHByb3BlcnRpZXNcIi4gTmV2ZXIgYWRkc1xuICogcHJvcGVydGllcyBvciBjaGFuZ2VzIHZhbHVlcy5cbiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqL1xuXG4vLyBLZXkgb3JkZXIgb2YgYSBUWVAncyBmcm9udG1hdHRlciwgZmxvYXRpbmcga2V5cyBpbmNsdWRlZCBhdCB0aGVpciBsaXN0XG4vLyBwb3NpdGlvbiAoZ2V0VHlwRGVmYXVsdHMgbGVhdmVzIHRoZW0gb3V0LCBidXQgYSBub3RlIHRoYXQgaGFzIG9uZSBzaG91bGRcbi8vIHN0aWxsIGdldCBpdCBpbiBwbGFjZSkuIFdpdGhvdXQgVFlQL1NVQlRZUCBhbmQgdGhlIGVkaXRvcidzIGJsYW5rIHJvdy5cbi8vIG51bGwgaWYgdGhlcmUgaXMgbm8gVFlQIG9yIG5vIGxpc3QuXG4vL1xuLy8gV2l0aCBzdWJ0eXAsIHRoZSBrZXlzIG9mIGl0cyBibG9jayBmb2xsb3cuIEEga2V5IGluIEJPVEggYmxvY2tzIGtlZXBzIHRoZVxuLy8gVFlQLUZyb250bWF0dGVyIHBvc2l0aW9uIC0gdGhlIHNhbWUgcnVsZSBhcyBjb2xsZWN0QmxvY2tzIGluIG1haW4uanMsIG9yIGFcbi8vIGZyZXNobHkgY3JlYXRlZCBub3RlIHdvdWxkIGJlIHJlLXNvcnRlZCByaWdodCBhd2F5LlxuZnVuY3Rpb24gb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgdHlwLCBzdWJ0eXAgPSBudWxsKSB7XG4gIGlmICghdHlwKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgaXNTeXN0ZW1LZXkgPSAoa2V5KSA9PiBrZXkgPT09IFwiXCIgfHwgW1RZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZXS5zb21lKChwKSA9PiBrZXkudG9Mb3dlckNhc2UoKSA9PT0gcC50b0xvd2VyQ2FzZSgpKTtcbiAgY29uc3Qgc3VidHlwRGF0YSA9IHN1YnR5cCA/IGdldFN1YnR5cChwbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKSA6IG51bGw7XG4gIGNvbnN0IGJsb2NrcyA9IFtwbHVnaW4uc2V0dGluZ3MudHlwRGVmYXVsdEZyb250bWF0dGVyW3R5cF0sIHN1YnR5cERhdGE/LmZyb250bWF0dGVyXTtcbiAgY29uc3Qga2V5cyA9IFtdO1xuICBjb25zdCBzZWVuID0gbmV3IFNldCgpO1xuICBmb3IgKGNvbnN0IGJsb2NrIG9mIGJsb2Nrcykge1xuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGJsb2NrID8/IHt9KSkge1xuICAgICAgaWYgKGlzU3lzdGVtS2V5KGtleSkgfHwgc2Vlbi5oYXMoa2V5LnRvTG93ZXJDYXNlKCkpKSBjb250aW51ZTtcbiAgICAgIGtleXMucHVzaChrZXkpO1xuICAgICAgc2Vlbi5hZGQoa2V5LnRvTG93ZXJDYXNlKCkpO1xuICAgIH1cbiAgfVxuICByZXR1cm4ga2V5cy5sZW5ndGggPiAwID8ga2V5cyA6IG51bGw7XG59XG5cbi8vIFRhcmdldCBvcmRlciBvZiBhIG5vdGUncyBleGlzdGluZyBwcm9wZXJ0aWVzLCBmdWxseSBkZWZpbmVkIGJ5IGdsb2JhbE9yZGVyLlxuLy9cbi8vIFdoaWNoIGJsb2NrIGNsYWltcyBhIHByb3BlcnR5IGlzIGRlY2lkZWQgQkVGT1JFIHRoZSBvcmRlciBpcyBidWlsdCAocGlubmVkLFxuLy8gVFlQIGJsb2NrIGFuZCByZXN0IGFyZSBkaXNqb2ludCksIHNvIHRoZSByZXN1bHQgZG9lc24ndCBkZXBlbmQgb24gd2hlcmUgdGhlXG4vLyBibG9ja3Mgc2l0IGluIGdsb2JhbE9yZGVyOiBhIHBpbm5lZCBwcm9wZXJ0eSBuZXZlciBhbHNvIGxhbmRzIGluIHRoZSBUWVBcbi8vIGJsb2NrLCBhbmQgXCJvdGhlclwiIG9ubHkgZXZlciBob2xkcyB0cnVlIGxlZnRvdmVycy5cbmZ1bmN0aW9uIGNvbXB1dGVTb3J0ZWRLZXlzKGV4aXN0aW5nS2V5cywgZ2xvYmFsT3JkZXIsIHR5cERlZmF1bHRLZXlzKSB7XG4gIGNvbnN0IGxvd2VyVG9BY3R1YWwgPSBuZXcgTWFwKGV4aXN0aW5nS2V5cy5tYXAoKGtleSkgPT4gW2tleS50b0xvd2VyQ2FzZSgpLCBrZXldKSk7XG4gIGNvbnN0IHJlc29sdmUgPSAobmFtZSkgPT4gbG93ZXJUb0FjdHVhbC5nZXQobmFtZS50b0xvd2VyQ2FzZSgpKTtcblxuICBjb25zdCBwaW5uZWQgPSBuZXcgU2V0KFxuICAgIGdsb2JhbE9yZGVyXG4gICAgICAuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkua2luZCA9PT0gXCJwcm9wZXJ0eVwiKVxuICAgICAgLm1hcCgoZW50cnkpID0+IHJlc29sdmUoZW50cnkubmFtZSkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICk7XG4gIGNvbnN0IHR5cEtleSA9IHJlc29sdmUoVFlQX1BST1BFUlRZKTtcbiAgY29uc3Qgc3VidHlwS2V5ID0gcmVzb2x2ZShTVUJUWVBfUFJPUEVSVFkpO1xuICBjb25zdCB0eXBCbG9ja0tleXMgPSBuZXcgU2V0KFxuICAgICh0eXBEZWZhdWx0S2V5cyA/PyBbXSkubWFwKHJlc29sdmUpLmZpbHRlcigoa2V5KSA9PiBrZXkgJiYga2V5ICE9PSB0eXBLZXkgJiYgIXBpbm5lZC5oYXMoa2V5KSlcbiAgKTtcbiAgY29uc3QgY2xhaW1lZCA9IG5ldyBTZXQocGlubmVkKTtcbiAgZm9yIChjb25zdCBrZXkgb2YgdHlwQmxvY2tLZXlzKSBjbGFpbWVkLmFkZChrZXkpO1xuICBpZiAodHlwS2V5KSBjbGFpbWVkLmFkZCh0eXBLZXkpO1xuICBpZiAoc3VidHlwS2V5KSBjbGFpbWVkLmFkZChzdWJ0eXBLZXkpO1xuXG4gIGNvbnN0IHNvcnRlZEtleXMgPSBbXTtcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQoKTtcbiAgY29uc3QgcHVzaCA9IChrZXkpID0+IHtcbiAgICBpZiAoa2V5ICYmICFzZWVuLmhhcyhrZXkpKSB7XG4gICAgICBzb3J0ZWRLZXlzLnB1c2goa2V5KTtcbiAgICAgIHNlZW4uYWRkKGtleSk7XG4gICAgfVxuICB9O1xuXG4gIGZvciAoY29uc3QgZW50cnkgb2YgZ2xvYmFsT3JkZXIpIHtcbiAgICBpZiAoZW50cnkua2luZCA9PT0gXCJwcm9wZXJ0eVwiKSBwdXNoKHJlc29sdmUoZW50cnkubmFtZSkpO1xuICAgIGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwidHlwVmFsdWVcIikgcHVzaCh0eXBLZXkpO1xuICAgIGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwic3VidHlwVmFsdWVcIikgcHVzaChzdWJ0eXBLZXkpO1xuICAgIGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwidHlwXCIpIHtcbiAgICAgIGZvciAoY29uc3QgbmFtZSBvZiB0eXBEZWZhdWx0S2V5cyA/PyBbXSkge1xuICAgICAgICBjb25zdCBrZXkgPSByZXNvbHZlKG5hbWUpO1xuICAgICAgICBpZiAoa2V5ICYmIHR5cEJsb2NrS2V5cy5oYXMoa2V5KSkgcHVzaChrZXkpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoZW50cnkua2luZCA9PT0gXCJvdGhlclwiKSB7XG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBleGlzdGluZ0tleXMpIHtcbiAgICAgICAgaWYgKCFjbGFpbWVkLmhhcyhrZXkpKSBwdXNoKGtleSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gU2FmZXR5IG5ldCBmb3IgYW4gaW5jb21wbGV0ZSBnbG9iYWxPcmRlciAoY29ycnVwdCBzZXR0aW5ncykuXG4gIGZvciAoY29uc3Qga2V5IG9mIGV4aXN0aW5nS2V5cykgcHVzaChrZXkpO1xuICByZXR1cm4gc29ydGVkS2V5cztcbn1cblxuLy8gXCJwb3NpdGlvblwiIGlzIE9ic2lkaWFuJ3MgbG9jYXRpb24gb2YgdGhlIGZyb250bWF0dGVyIGJsb2NrLCBwcmVzZW50IG9ubHkgaW5cbi8vIHRoZSBjYWNoZSBvYmplY3QsIG5vdCBhIHByb3BlcnR5LlxuZnVuY3Rpb24gY2FjaGVkRnJvbnRtYXR0ZXJLZXlzKGFwcCwgZmlsZSkge1xuICBjb25zdCBmcm9udG1hdHRlciA9IGFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXI7XG4gIGlmICghZnJvbnRtYXR0ZXIpIHJldHVybiBudWxsO1xuICByZXR1cm4gT2JqZWN0LmtleXMoZnJvbnRtYXR0ZXIpLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwicG9zaXRpb25cIik7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNvcnRGaWxlRnJvbnRtYXR0ZXIoYXBwLCBmaWxlLCBnbG9iYWxPcmRlciwgdHlwRGVmYXVsdEtleXMpIHtcbiAgLy8gQ2hlYXAgcHJlLWNoZWNrIGFnYWluc3QgdGhlIGluLW1lbW9yeSBjYWNoZTogbW9zdCBub3RlcyBhcmUgYWxyZWFkeVxuICAvLyBzb3J0ZWQsIGFuZCB0aGlzIHNraXBzIG9wZW5pbmcgdGhlbSBhdCBhbGwgLSB0aGF0IGlzIHdoZXJlIHJlcGVhdGVkIHZhdWx0XG4gIC8vIHJ1bnMgZ2V0IHRoZWlyIHNwZWVkLiBwcm9jZXNzRnJvbnRNYXR0ZXIgc3RheXMgdGhlIHNvdXJjZSBvZiB0cnV0aCBmb3IgdGhlXG4gIC8vIGFjdHVhbCB3cml0ZSwgc2luY2UgdGhlIGNhY2hlIGNhbiBsYWcgYmVoaW5kLlxuICBjb25zdCBjYWNoZWRLZXlzID0gY2FjaGVkRnJvbnRtYXR0ZXJLZXlzKGFwcCwgZmlsZSk7XG4gIGlmICghY2FjaGVkS2V5cyB8fCBjYWNoZWRLZXlzLmxlbmd0aCA8PSAxKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IGNhY2hlZFNvcnRlZCA9IGNvbXB1dGVTb3J0ZWRLZXlzKGNhY2hlZEtleXMsIGdsb2JhbE9yZGVyLCB0eXBEZWZhdWx0S2V5cyk7XG4gIGlmIChjYWNoZWRTb3J0ZWQuZXZlcnkoKGtleSwgaSkgPT4ga2V5ID09PSBjYWNoZWRLZXlzW2ldKSkgcmV0dXJuIGZhbHNlO1xuXG4gIGxldCBjaGFuZ2VkID0gZmFsc2U7XG4gIGF3YWl0IGFwcC5maWxlTWFuYWdlci5wcm9jZXNzRnJvbnRNYXR0ZXIoZmlsZSwgKGZyb250bWF0dGVyKSA9PiB7XG4gICAgY2hhbmdlZCA9IHNvcnRGcm9udG1hdHRlck9iamVjdChmcm9udG1hdHRlciwgZ2xvYmFsT3JkZXIsIHR5cERlZmF1bHRLZXlzKTtcbiAgfSk7XG4gIHJldHVybiBjaGFuZ2VkO1xufVxuXG4vLyBTb3J0cyB0aGUgcHJvY2Vzc0Zyb250TWF0dGVyIG9iamVjdCBpbiBwbGFjZTogaW5zZXJ0aW9uIG9yZGVyIGJlY29tZXMgdGhlXG4vLyBZQU1MIG9yZGVyLCBzbyBhbGwga2V5cyBhcmUgZGVsZXRlZCBhbmQgcmUtYWRkZWQuIFJldHVybnMgdHJ1ZSBvbiBhIGNoYW5nZS5cbmZ1bmN0aW9uIHNvcnRGcm9udG1hdHRlck9iamVjdChmcm9udG1hdHRlciwgZ2xvYmFsT3JkZXIsIHR5cERlZmF1bHRLZXlzKSB7XG4gIGNvbnN0IGV4aXN0aW5nS2V5cyA9IE9iamVjdC5rZXlzKGZyb250bWF0dGVyKTtcbiAgaWYgKGV4aXN0aW5nS2V5cy5sZW5ndGggPD0gMSkgcmV0dXJuIGZhbHNlO1xuXG4gIGNvbnN0IHNvcnRlZEtleXMgPSBjb21wdXRlU29ydGVkS2V5cyhleGlzdGluZ0tleXMsIGdsb2JhbE9yZGVyLCB0eXBEZWZhdWx0S2V5cyk7XG4gIGlmIChzb3J0ZWRLZXlzLmV2ZXJ5KChrZXksIGkpID0+IGtleSA9PT0gZXhpc3RpbmdLZXlzW2ldKSkgcmV0dXJuIGZhbHNlO1xuXG4gIGNvbnN0IHNuYXBzaG90ID0geyAuLi5mcm9udG1hdHRlciB9O1xuICBmb3IgKGNvbnN0IGtleSBvZiBleGlzdGluZ0tleXMpIGRlbGV0ZSBmcm9udG1hdHRlcltrZXldO1xuICBmb3IgKGNvbnN0IGtleSBvZiBzb3J0ZWRLZXlzKSBmcm9udG1hdHRlcltrZXldID0gc25hcHNob3Rba2V5XTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbi8vIEZvciBjYWxsZXJzIGFscmVhZHkgaW5zaWRlIHByb2Nlc3NGcm9udE1hdHRlciAoVFlQLmpzKTogVFlQIGFuZCBTdWJ0eXAgYXJlXG4vLyBwYXNzZWQgZXhwbGljaXRseSwgYmVjYXVzZSBpbmRleCBhbmQgY2FjaGUgZG9uJ3Qga25vdyB0aGUgdmFsdWVzIGp1c3Rcbi8vIHdyaXR0ZW4geWV0LlxuZnVuY3Rpb24gc29ydEZyb250bWF0dGVyRm9yKHBsdWdpbiwgZnJvbnRtYXR0ZXIsIHR5cCwgc3VidHlwKSB7XG4gIGNvbnN0IGdsb2JhbE9yZGVyID0gbm9ybWFsaXplR2xvYmFsT3JkZXIocGx1Z2luLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIpO1xuICByZXR1cm4gc29ydEZyb250bWF0dGVyT2JqZWN0KGZyb250bWF0dGVyLCBnbG9iYWxPcmRlciwgb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgdHlwLCBzdWJ0eXApKTtcbn1cblxuLy8gTW92ZXMgb25seSBga2V5YCB0byBpdHMgc29ydGVkIHBsYWNlIGFuZCBsZWF2ZXMgZXZlcnkgb3RoZXIga2V5IHdoZXJlIGl0IGlzXG4vLyAtIGZvciBjYWxsZXJzIHRoYXQganVzdCBhZGRlZCBhIHByb3BlcnR5IChGcmVkJ3MgcHJvcGVydHkgYmFja2xpbmtpbmcpIGFuZFxuLy8gc2hvdWxkbid0IHJlc2h1ZmZsZSBhIGRlbGliZXJhdGVseSBkaWZmZXJlbnQgb3JkZXIuIFRZUC9TVUJUWVAgYXJlIHJlYWQgZnJvbVxuLy8gdGhlIG9iamVjdCBpdHNlbGY7IGluZGV4IGFuZCBjYWNoZSBtYXkgc3RpbGwgYmUgYmVoaW5kLlxuLy9cbi8vIFRoZSBwbGFjZSBpcyByaWdodCBhZnRlciBrZXkncyBuZWFyZXN0IHByZWRlY2Vzc29yIGluIHRoZSBmdWxseSBzb3J0ZWRcbi8vIG9yZGVyIChmaXJzdCBpZiB0aGVyZSBpcyBub25lKS4gUmV0dXJucyB0cnVlIG9uIGEgY2hhbmdlLlxuZnVuY3Rpb24gcGxhY2VQcm9wZXJ0eUZvcihwbHVnaW4sIGZyb250bWF0dGVyLCBrZXkpIHtcbiAgY29uc3QgZXhpc3RpbmdLZXlzID0gT2JqZWN0LmtleXMoZnJvbnRtYXR0ZXIpO1xuICBjb25zdCBhY3R1YWxLZXkgPSBleGlzdGluZ0tleXMuZmluZCgoaykgPT4gay50b0xvd2VyQ2FzZSgpID09PSBrZXkudG9Mb3dlckNhc2UoKSk7XG4gIGlmICghYWN0dWFsS2V5IHx8IGV4aXN0aW5nS2V5cy5sZW5ndGggPD0gMSkgcmV0dXJuIGZhbHNlO1xuXG4gIGNvbnN0IGdsb2JhbE9yZGVyID0gbm9ybWFsaXplR2xvYmFsT3JkZXIocGx1Z2luLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIpO1xuICBjb25zdCB0eXAgPSB0eXBLZXlPZihwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBUWVBfUFJPUEVSVFkpKTtcbiAgY29uc3Qgc3VidHlwID0gdHlwS2V5T2YocHJvcGVydHlWYWx1ZShmcm9udG1hdHRlciwgU1VCVFlQX1BST1BFUlRZKSk7XG4gIGNvbnN0IHNvcnRlZEtleXMgPSBjb21wdXRlU29ydGVkS2V5cyhleGlzdGluZ0tleXMsIGdsb2JhbE9yZGVyLCBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCB0eXAsIHN1YnR5cCkpO1xuXG4gIGNvbnN0IHJlc3QgPSBleGlzdGluZ0tleXMuZmlsdGVyKChrKSA9PiBrICE9PSBhY3R1YWxLZXkpO1xuICBjb25zdCBwcmVkZWNlc3NvciA9IHNvcnRlZEtleXMuc2xpY2UoMCwgc29ydGVkS2V5cy5pbmRleE9mKGFjdHVhbEtleSkpLnBvcCgpO1xuICBjb25zdCBuZXdLZXlzID0gWy4uLnJlc3RdO1xuICBuZXdLZXlzLnNwbGljZShwcmVkZWNlc3NvciA9PT0gdW5kZWZpbmVkID8gMCA6IHJlc3QuaW5kZXhPZihwcmVkZWNlc3NvcikgKyAxLCAwLCBhY3R1YWxLZXkpO1xuICBpZiAobmV3S2V5cy5ldmVyeSgoaywgaSkgPT4gayA9PT0gZXhpc3RpbmdLZXlzW2ldKSkgcmV0dXJuIGZhbHNlO1xuXG4gIGNvbnN0IHNuYXBzaG90ID0geyAuLi5mcm9udG1hdHRlciB9O1xuICBmb3IgKGNvbnN0IGsgb2YgZXhpc3RpbmdLZXlzKSBkZWxldGUgZnJvbnRtYXR0ZXJba107XG4gIGZvciAoY29uc3QgayBvZiBuZXdLZXlzKSBmcm9udG1hdHRlcltrXSA9IHNuYXBzaG90W2tdO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc29ydFNpbmdsZUZpbGVGcm9udG1hdHRlcihhcHAsIHBsdWdpbiwgZmlsZSkge1xuICBjb25zdCBnbG9iYWxPcmRlciA9IG5vcm1hbGl6ZUdsb2JhbE9yZGVyKHBsdWdpbi5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyKTtcbiAgLy8gQW4gdW5jbGVhbiBUWVAgdmFsdWUgKGxpc3QsIHBhZGRlZCkgaGFzIG5vIFRZUC1Gcm9udG1hdHRlcjsgb25seSB0aGUgZ2xvYmFsXG4gIC8vIG9yZGVyIGFwcGxpZXMgdGhlbiAoc2VlIHR5cEtleU9mIGluIHR5cC1pbmRleC5qcykuXG4gIGNvbnN0IHR5cCA9IHBsdWdpbi50eXBJbmRleC50eXBPZihmaWxlKTtcbiAgY29uc3QgdHlwRGVmYXVsdEtleXMgPSBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCB0eXAsIHBsdWdpbi50eXBJbmRleC5zdWJ0eXBPZihmaWxlKSk7XG4gIHJldHVybiBzb3J0RmlsZUZyb250bWF0dGVyKGFwcCwgZmlsZSwgZ2xvYmFsT3JkZXIsIHR5cERlZmF1bHRLZXlzKTtcbn1cblxuLy8gb25seVR5cCAob3B0aW9uYWwpIGxpbWl0cyB0aGUgcnVuIHRvIG5vdGVzIG9mIHRoYXQgVFlQLiBXaXRob3V0IGl0IGV2ZXJ5XG4vLyBub3RlIGlzIGNoZWNrZWQsIGluY2x1ZGluZyBub3RlcyB3aXRob3V0IGEgVFlQOiBwaW5uZWQgcHJvcGVydGllcyBzdWNoIGFzXG4vLyBjc3NjbGFzc2VzIGFwcGx5IHJlZ2FyZGxlc3Mgb2YgVFlQLlxuYXN5bmMgZnVuY3Rpb24gc29ydEFsbEZyb250bWF0dGVyKGFwcCwgcGx1Z2luLCBvbmx5VHlwKSB7XG4gIGxldCBjaGVja2VkID0gMDtcbiAgbGV0IGNoYW5nZWQgPSAwO1xuICBjb25zdCBnbG9iYWxPcmRlciA9IG5vcm1hbGl6ZUdsb2JhbE9yZGVyKHBsdWdpbi5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyKTtcbiAgLy8gT25seSBtZWFuaW5nZnVsIGZvciBhIHNpbmdsZSBUWVA6IGxldHMgdGhlIGNvbW1hbmQgZXhwbGFpbiBhIHJ1biB0aGF0XG4gIC8vIGNoYW5nZWQgbm90aGluZyBiZWNhdXNlIHRoZSBUWVAgaGFzIG5vIFRZUC1Gcm9udG1hdHRlci5cbiAgY29uc3QgaGFzVHlwRGVmYXVsdHMgPSBvbmx5VHlwID8gb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgb25seVR5cCkgIT09IG51bGwgOiBudWxsO1xuXG4gIGZvciAoY29uc3QgZmlsZSBvZiBhcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpKSB7XG4gICAgaWYgKCFwbHVnaW4uc2V0dGluZ3MuaW5jbHVkZUlnbm9yZWRGaWxlcyAmJiBhcHAubWV0YWRhdGFDYWNoZS5pc1VzZXJJZ25vcmVkKGZpbGUucGF0aCkpIGNvbnRpbnVlO1xuXG4gICAgY29uc3QgdHlwID0gcGx1Z2luLnR5cEluZGV4LnR5cE9mKGZpbGUpO1xuICAgIGlmIChvbmx5VHlwICYmIHR5cCAhPT0gb25seVR5cCkgY29udGludWU7XG5cbiAgICBjb25zdCB0eXBEZWZhdWx0S2V5cyA9IG9yZGVyZWREZWZhdWx0S2V5cyhwbHVnaW4sIHR5cCwgcGx1Z2luLnR5cEluZGV4LnN1YnR5cE9mKGZpbGUpKTtcbiAgICBjaGVja2VkKys7XG4gICAgaWYgKGF3YWl0IHNvcnRGaWxlRnJvbnRtYXR0ZXIoYXBwLCBmaWxlLCBnbG9iYWxPcmRlciwgdHlwRGVmYXVsdEtleXMpKSBjaGFuZ2VkKys7XG4gIH1cblxuICByZXR1cm4geyBjaGVja2VkLCBjaGFuZ2VkLCBoYXNUeXBEZWZhdWx0cyB9O1xufVxuXG4vLyBSZXN1bHQgbm90aWNlIG9mIGEgc29ydGluZyBydW4sIHNoYXJlZCBieSB0aGUgY29tbWFuZHMgYW5kIHRoZSBwbGF5IGJ1dHRvblxuLy8gb2YgdGhlIGdsb2JhbCBvcmRlci5cbmZ1bmN0aW9uIHNvcnRTdW1tYXJ5KGxhYmVsLCBjaGVja2VkLCBjaGFuZ2VkKSB7XG4gIHJldHVybiBjaGFuZ2VkID4gMFxuICAgID8gYCR7bGFiZWx9OiBjaGVja2VkICR7cGx1cmFsKGNoZWNrZWQsIFwibm90ZVwiKX0sIHNvcnRlZCAke2NoYW5nZWR9LmBcbiAgICA6IGAke2xhYmVsfTogY2hlY2tlZCAke3BsdXJhbChjaGVja2VkLCBcIm5vdGVcIil9LCBhbGwgYWxyZWFkeSBzb3J0ZWQuYDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIHNvcnRBbGxGcm9udG1hdHRlcixcbiAgc29ydFNpbmdsZUZpbGVGcm9udG1hdHRlcixcbiAgc29ydEZyb250bWF0dGVyRm9yLFxuICBwbGFjZVByb3BlcnR5Rm9yLFxuICBub3JtYWxpemVHbG9iYWxPcmRlcixcbiAgc29ydFN1bW1hcnksXG4gIERFRkFVTFRfR0xPQkFMX09SREVSLFxuICBUWVBfUFJPUEVSVFksXG4gIFNVQlRZUF9QUk9QRVJUWSxcbn07XG4iLCAiY29uc3QgeyBzZXRJY29uLCBOb3RpY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFksIHNvcnRBbGxGcm9udG1hdHRlciwgc29ydFN1bW1hcnkgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLXNvcnRcIik7XG5cbi8vIExhYmVscyBvZiB0aGUgZm91ciBwbGFjZWhvbGRlciByb3dzOyBjb21wdXRlU29ydGVkS2V5cyBpbiBmcm9udG1hdHRlci1zb3J0LmpzXG4vLyByZXNvbHZlcyB3aGF0IGVhY2ggb25lIHN0YW5kcyBmb3IuXG5jb25zdCBQTEFDRUhPTERFUl9MQUJFTFMgPSB7XG4gIHR5cFZhbHVlOiBcIlRZUFwiLFxuICBzdWJ0eXBWYWx1ZTogXCJTVUJUWVBcIixcbiAgdHlwOiBcIlRZUC1Gcm9udG1hdHRlclwiLFxuICBvdGhlcjogXCJPdGhlciBwcm9wZXJ0aWVzXCIsXG59O1xuXG4vLyBFZGl0b3IgZm9yIHNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXI6IGEgcGxhaW4gbGlzdCBvZiBuYW1lcyB3aXRoIGRyYWcgJlxuLy8gZHJvcC4gSXQgaG9sZHMgbm8gdmFsdWVzLCBzbyB1bmxpa2UgdHlwLWZyb250bWF0dGVyLWVkaXRvci5qcyBpdCBuZWVkcyBub1xuLy8gZGV0b3VyIHRocm91Z2ggT2JzaWRpYW4ncyBwcml2YXRlIHByb3BlcnR5IHdpZGdldC4gVGhlIHBsYWNlaG9sZGVyIHJvd3MgY2FuXG4vLyBiZSBtb3ZlZCBidXQgbm90IHJlbW92ZWQuXG5mdW5jdGlvbiBtb3VudEdsb2JhbE9yZGVyRWRpdG9yKGNvbnRhaW5lckVsLCBwbHVnaW4pIHtcbiAgY29uc3QgaGVhZGVyID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci1oZWFkZXJcIiB9KTtcblxuICAvLyBCdXR0b24gYW5kIHRpdGxlIHNoYXJlIGEgZ3JvdXA6IHRoZSBoZWFkZXIgdXNlcyBzcGFjZS1iZXR3ZWVuLCBzbyBhIHRoaXJkXG4gIC8vIGRpcmVjdCBjaGlsZCB3b3VsZCBmbG9hdCBpbiB0aGUgbWlkZGxlIGluc3RlYWQgb2YgbmV4dCB0byB0aGUgdGl0bGUuXG4gIGNvbnN0IHRpdGxlR3JvdXAgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci10aXRsZS1ncm91cFwiIH0pO1xuXG4gIC8vIFNhbWUgcnVuIGFzIHRoZSBcIlNvcnQgZnJvbnRtYXR0ZXIgaW4gYWxsIG5vdGVzXCIgY29tbWFuZC5cbiAgY29uc3QgYXBwbHlCdG4gPSB0aXRsZUdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvblwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkFwcGx5IHRvIGFsbCBub3Rlc1wiIH0gfSk7XG4gIHNldEljb24oYXBwbHlCdG4sIFwicGxheVwiKTtcbiAgYXBwbHlCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGFzeW5jICgpID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgeyBjaGVja2VkLCBjaGFuZ2VkIH0gPSBhd2FpdCBzb3J0QWxsRnJvbnRtYXR0ZXIocGx1Z2luLmFwcCwgcGx1Z2luLCBudWxsKTtcbiAgICAgIG5ldyBOb3RpY2Uoc29ydFN1bW1hcnkoXCJGcm9udG1hdHRlciBzb3J0aW5nXCIsIGNoZWNrZWQsIGNoYW5nZWQpKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihcIltGcm9udG1hdHRlciBzb3J0aW5nXVwiLCBlcnJvcik7XG4gICAgICBuZXcgTm90aWNlKGBGcm9udG1hdHRlciBzb3J0aW5nIGZhaWxlZDogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgIH1cbiAgfSk7XG5cbiAgdGl0bGVHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIsIHRleHQ6IFwiR2xvYmFsIHByb3BlcnR5IG9yZGVyXCIgfSk7XG5cbiAgY29uc3QgYWRkQnRuID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvblwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkFkZCBwcm9wZXJ0eVwiIH0gfSk7XG4gIHNldEljb24oYWRkQnRuLCBcInBsdXNcIik7XG5cbiAgY29uc3QgbGlzdEVsID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1vcmRlci1saXN0XCIgfSk7XG5cbiAgY29uc3Qgb3JkZXIgPSAoKSA9PiBwbHVnaW4uc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcjtcblxuICAvLyBBIG5ldyByb3cgb25seSBqb2lucyBnbG9iYWxQcm9wZXJ0eU9yZGVyIG9uY2UgaXQgaGFzIGEgdmFsaWQgbmFtZS4gVW50aWxcbiAgLy8gdGhlbiBpdCBpcyBhIGxvY2FsIGRyYWZ0IGFwcGVuZGVkIG9uIHJlbmRlciwgc28gYW4gZW1wdHkgbmFtZSBuZXZlciBlbmRzXG4gIC8vIHVwIGluIHRoZSBzZXR0aW5ncywgZXZlbiBpZiBzb21ldGhpbmcgZWxzZSBzYXZlcyBpbiBiZXR3ZWVuLlxuICBsZXQgZHJhZnRFbnRyeSA9IG51bGw7XG5cbiAgY29uc3QgaXNEdXBsaWNhdGVOYW1lID0gKHZhbHVlLCBvd25FbnRyeSkgPT4ge1xuICAgIGNvbnN0IGxvd2VyID0gdmFsdWUudG9Mb3dlckNhc2UoKTtcbiAgICBpZiAobG93ZXIgPT09IFRZUF9QUk9QRVJUWS50b0xvd2VyQ2FzZSgpIHx8IGxvd2VyID09PSBTVUJUWVBfUFJPUEVSVFkudG9Mb3dlckNhc2UoKSkgcmV0dXJuIHRydWU7XG4gICAgcmV0dXJuIG9yZGVyKCkuc29tZSgob3RoZXIpID0+IG90aGVyICE9PSBvd25FbnRyeSAmJiBvdGhlci5raW5kID09PSBcInByb3BlcnR5XCIgJiYgb3RoZXIubmFtZS50b0xvd2VyQ2FzZSgpID09PSBsb3dlcik7XG4gIH07XG5cbiAgY29uc3QgcmVuZGVyID0gKCkgPT4ge1xuICAgIGxpc3RFbC5lbXB0eSgpO1xuICAgIGNvbnN0IGVudHJpZXMgPSBkcmFmdEVudHJ5ID8gWy4uLm9yZGVyKCksIGRyYWZ0RW50cnldIDogb3JkZXIoKTtcblxuICAgIGVudHJpZXMuZm9yRWFjaCgoZW50cnksIGluZGV4KSA9PiB7XG4gICAgICBjb25zdCBpc0RyYWZ0ID0gZW50cnkgPT09IGRyYWZ0RW50cnk7XG4gICAgICBjb25zdCBpc1BsYWNlaG9sZGVyID0gZW50cnkua2luZCAhPT0gXCJwcm9wZXJ0eVwiO1xuICAgICAgY29uc3Qgcm93Q2xzID1cbiAgICAgICAgXCJ0eXAtb3JkZXItcm93XCIgKyAoaXNQbGFjZWhvbGRlciA/IFwiIGlzLXBsYWNlaG9sZGVyXCIgOiBcIlwiKSArIChlbnRyeS5raW5kID09PSBcInR5cFwiID8gXCIgaXMtdHlwLWRlZmF1bHRzXCIgOiBcIlwiKTtcbiAgICAgIGNvbnN0IHJvdyA9IGxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IHJvd0NscyB9KTtcblxuICAgICAgY29uc3QgZHJhZ0hhbmRsZSA9IHJvdy5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLW9yZGVyLWRyYWdcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJEcmFnIHRvIG1vdmVcIiB9IH0pO1xuICAgICAgc2V0SWNvbihkcmFnSGFuZGxlLCBcImdyaXAtdmVydGljYWxcIik7XG5cbiAgICAgIGlmIChpc1BsYWNlaG9sZGVyKSB7XG4gICAgICAgIHJvdy5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLW9yZGVyLWxhYmVsXCIsIHRleHQ6IFBMQUNFSE9MREVSX0xBQkVMU1tlbnRyeS5raW5kXSB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IGlucHV0ID0gcm93LmNyZWF0ZUVsKFwiaW5wdXRcIiwge1xuICAgICAgICAgIHR5cGU6IFwidGV4dFwiLFxuICAgICAgICAgIGNsczogXCJ0eXAtb3JkZXItbmFtZS1pbnB1dFwiLFxuICAgICAgICAgIGF0dHI6IHsgcGxhY2Vob2xkZXI6IFwiUHJvcGVydHkgbmFtZVwiIH0sXG4gICAgICAgIH0pO1xuICAgICAgICBpbnB1dC52YWx1ZSA9IGVudHJ5Lm5hbWU7XG5cbiAgICAgICAgLy8gXCJibHVyXCIsIG5vdCBcImNoYW5nZVwiOiBjaGFuZ2UgZG9lc24ndCBmaXJlIGZvciBhIGZpZWxkIGxlZnQgZW1wdHksIHNvXG4gICAgICAgIC8vIHRoZSBkcmFmdCB3b3VsZCBuZXZlciBiZSBjbGVhbmVkIHVwLlxuICAgICAgICBpbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiYmx1clwiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgY29uc3QgdmFsdWUgPSBpbnB1dC52YWx1ZS50cmltKCk7XG5cbiAgICAgICAgICBpZiAoIXZhbHVlKSB7XG4gICAgICAgICAgICBpZiAoaXNEcmFmdCkge1xuICAgICAgICAgICAgICBkcmFmdEVudHJ5ID0gbnVsbDtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIG9yZGVyKCkuc3BsaWNlKG9yZGVyKCkuaW5kZXhPZihlbnRyeSksIDEpO1xuICAgICAgICAgICAgICBhd2FpdCBwbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZW5kZXIoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoaXNEdXBsaWNhdGVOYW1lKHZhbHVlLCBpc0RyYWZ0ID8gbnVsbCA6IGVudHJ5KSkge1xuICAgICAgICAgICAgbmV3IE5vdGljZShgXCIke3ZhbHVlfVwiIGlzIGFscmVhZHkgaW4gdGhlIGxpc3QuYCk7XG4gICAgICAgICAgICBpbnB1dC52YWx1ZSA9IGVudHJ5Lm5hbWU7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZW50cnkubmFtZSA9IHZhbHVlO1xuICAgICAgICAgIGlmIChpc0RyYWZ0KSB7XG4gICAgICAgICAgICBvcmRlcigpLnB1c2goZW50cnkpO1xuICAgICAgICAgICAgZHJhZnRFbnRyeSA9IG51bGw7XG4gICAgICAgICAgfVxuICAgICAgICAgIGF3YWl0IHBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICByZW5kZXIoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgcmVtb3ZlQnRuID0gcm93LmNyZWF0ZURpdih7IGNsczogXCJ0eXAtb3JkZXItcmVtb3ZlIGNsaWNrYWJsZS1pY29uXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiUmVtb3ZlXCIgfSB9KTtcbiAgICAgICAgc2V0SWNvbihyZW1vdmVCdG4sIFwieFwiKTtcbiAgICAgICAgcmVtb3ZlQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgaWYgKGlzRHJhZnQpIHtcbiAgICAgICAgICAgIGRyYWZ0RW50cnkgPSBudWxsO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBvcmRlcigpLnNwbGljZShvcmRlcigpLmluZGV4T2YoZW50cnkpLCAxKTtcbiAgICAgICAgICAgIGF3YWl0IHBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmVuZGVyKCk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICAvLyBBIGRyYWZ0IGhhcyBubyBwbGFjZSBpbiB0aGUgcmVhbCBsaXN0IHlldCwgc28gaXQgY2FuJ3QgYmUgbW92ZWQuXG4gICAgICBpZiAoaXNEcmFmdCkgcmV0dXJuO1xuXG4gICAgICByb3cuZHJhZ2dhYmxlID0gdHJ1ZTtcbiAgICAgIHJvdy5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ3N0YXJ0XCIsIChldmVudCkgPT4ge1xuICAgICAgICBldmVudC5kYXRhVHJhbnNmZXIuZWZmZWN0QWxsb3dlZCA9IFwibW92ZVwiO1xuICAgICAgICBldmVudC5kYXRhVHJhbnNmZXIuc2V0RGF0YShcInRleHQvcGxhaW5cIiwgU3RyaW5nKGluZGV4KSk7XG4gICAgICAgIHJvdy5jbGFzc0xpc3QuYWRkKFwiaXMtZHJhZ2dpbmdcIik7XG4gICAgICB9KTtcbiAgICAgIHJvdy5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ2VuZFwiLCAoKSA9PiByb3cuY2xhc3NMaXN0LnJlbW92ZShcImlzLWRyYWdnaW5nXCIpKTtcbiAgICAgIHJvdy5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ292ZXJcIiwgKGV2ZW50KSA9PiB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIC8vIFVwcGVyIG9yIGxvd2VyIGhhbGYgZGVjaWRlcyBiZWZvcmUvYWZ0ZXIgLSBvdGhlcndpc2Ugbm90aGluZyBjb3VsZFxuICAgICAgICAvLyBiZSBkcm9wcGVkIGJlbG93IHRoZSBsYXN0IHJvdy5cbiAgICAgICAgY29uc3QgcmVjdCA9IHJvdy5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgICAgY29uc3QgaXNBZnRlciA9IGV2ZW50LmNsaWVudFkgLSByZWN0LnRvcCA+IHJlY3QuaGVpZ2h0IC8gMjtcbiAgICAgICAgcm93LmNsYXNzTGlzdC50b2dnbGUoXCJpcy1kcm9wLWJlZm9yZVwiLCAhaXNBZnRlcik7XG4gICAgICAgIHJvdy5jbGFzc0xpc3QudG9nZ2xlKFwiaXMtZHJvcC1hZnRlclwiLCBpc0FmdGVyKTtcbiAgICAgIH0pO1xuICAgICAgcm93LmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnbGVhdmVcIiwgKCkgPT4gcm93LmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcm9wLWJlZm9yZVwiLCBcImlzLWRyb3AtYWZ0ZXJcIikpO1xuICAgICAgcm93LmFkZEV2ZW50TGlzdGVuZXIoXCJkcm9wXCIsIGFzeW5jIChldmVudCkgPT4ge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBjb25zdCBpc0FmdGVyID0gcm93LmNsYXNzTGlzdC5jb250YWlucyhcImlzLWRyb3AtYWZ0ZXJcIik7XG4gICAgICAgIHJvdy5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJvcC1iZWZvcmVcIiwgXCJpcy1kcm9wLWFmdGVyXCIpO1xuXG4gICAgICAgIGNvbnN0IGZyb21JbmRleCA9IE51bWJlcihldmVudC5kYXRhVHJhbnNmZXIuZ2V0RGF0YShcInRleHQvcGxhaW5cIikpO1xuICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKGZyb21JbmRleCkpIHJldHVybjtcblxuICAgICAgICAvLyBUYXJnZXQgaW5kZXggY291bnRlZCBiZWZvcmUgZnJvbUluZGV4IGlzIHJlbW92ZWQuXG4gICAgICAgIGxldCBpbnNlcnRCZWZvcmUgPSBpc0FmdGVyID8gaW5kZXggKyAxIDogaW5kZXg7XG4gICAgICAgIGlmIChmcm9tSW5kZXggPCBpbnNlcnRCZWZvcmUpIGluc2VydEJlZm9yZSAtPSAxO1xuXG4gICAgICAgIGNvbnN0IFttb3ZlZF0gPSBvcmRlcigpLnNwbGljZShmcm9tSW5kZXgsIDEpO1xuICAgICAgICBvcmRlcigpLnNwbGljZShpbnNlcnRCZWZvcmUsIDAsIG1vdmVkKTtcbiAgICAgICAgYXdhaXQgcGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICByZW5kZXIoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9O1xuXG4gIGFkZEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgIGlmICghZHJhZnRFbnRyeSkge1xuICAgICAgZHJhZnRFbnRyeSA9IHsga2luZDogXCJwcm9wZXJ0eVwiLCBuYW1lOiBcIlwiIH07XG4gICAgICByZW5kZXIoKTtcbiAgICB9XG4gICAgY29uc3QgaW5wdXRzID0gbGlzdEVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIudHlwLW9yZGVyLW5hbWUtaW5wdXRcIik7XG4gICAgaW5wdXRzW2lucHV0cy5sZW5ndGggLSAxXT8uZm9jdXMoKTtcbiAgfSk7XG5cbiAgcmVuZGVyKCk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBtb3VudEdsb2JhbE9yZGVyRWRpdG9yIH07XG4iLCAiY29uc3QgeyBnZXRTdWJ0eXAgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cHNcIik7XG5cbi8vIENvbG9yIG9mIGEgVFlQIHdpdGhvdXQgaXRzIG93biBjb2xvci4gTGl2ZXMgaGVyZSBiZWNhdXNlIGNvZGUgYmVsb3cgdGhlXG4vLyB2aWV3IG5lZWRzIGl0IChzZWUgbmFtZUNvbG9yKTsgdHlwLXBhbmUuanMgcmUtZXhwb3J0cyBpdC5cbmNvbnN0IERFRkFVTFRfVFlQX0NPTE9SID0gXCIjODg4ODg4XCI7XG5cbi8vIC0tLSBTdWJ0eXAgY29sb3JzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEEgU3VidHlwIHN0b3JlcyBubyBjb2xvciwgb25seSBhbiBvZmZzZXQgZnJvbSBpdHMgVFlQJ3MgY29sb3Jcbi8vIChzZXR0aW5ncy50eXBTdWJ0eXBzW1RZUF1bU1VCVFlQXS5jb2xvciA9IHsgaCwgbCB9KS4gVGhlIHJlYWwgY29sb3IgaXNcbi8vIGNvbXB1dGVkIGZyb20gdGhlIGN1cnJlbnQgVFlQIGNvbG9yIGV2ZXJ5IHRpbWUsIHNvIHdoZW4gdGhhdCBjaGFuZ2VzIGFsbFxuLy8gU3VidHlwcyBmb2xsb3cgYW5kIHN0YXkgaW4gdGhlIGZhbWlseS5cbi8vIFRoZSBtYXRoIHJ1bnMgaW4gT0tMQ0gsIHdoZXJlIGEgbGlnaHRuZXNzIGNoYW5nZSBsb29rcyBhYm91dCBlcXVhbGx5IHN0cm9uZ1xuLy8gYWNyb3NzIGh1ZXMgKGluIEhTTCB5ZWxsb3cgd291bGQgYmUgZmFyIGJyaWdodGVyIHRoYW4gYmx1ZSkuIFdpdGhvdXQgYW5cbi8vIG9mZnNldCBhIFN1YnR5cCBoYXMgdGhlIFRZUCBjb2xvci5cbi8vICAgaDogaHVlLCBzaGlmdGVkIGluIGRlZ3JlZXM7XG4vLyAgIGw6IGxpZ2h0bmVzcyBhcyAlIG9mIHRoZSB3YXkgdG8gd2hpdGUgKCspIG9yIGJsYWNrICgtKS5cbi8vIFRoZSBhbGxvd2VkIHJhbmdlIGlzIGEgc2V0dGluZyAoc2V0dGluZ3Muc3VidHlwQ29sb3JSYW5nZXMpOyBhIGxhcmdlciBzdG9yZWRcbi8vIG9mZnNldCBpcyBjbGFtcGVkIHRvIGl0LlxuLy9cbi8vIFRoaXMgbGlzdCBpcyB0aGUgc2luZ2xlIHNvdXJjZSBmb3IgdGhlIHBvcG92ZXIgc2xpZGVycywgdGhlIHNldHRpbmcgbGltaXRzXG4vLyBhbmQgdGhlIGNsYW1waW5nOyBjb21tZW50aW5nIGEgY2hhbm5lbCBvdXQgcmVtb3ZlcyBpdCBldmVyeXdoZXJlLlxuLy9cbi8vIFNhdHVyYXRpb24gaXMgZGlzYWJsZWQuIEl0IG9uY2UgY29tcGVuc2F0ZWQgZm9yIGNocm9tYSB0aGF0IGxpZ2h0bmVzcyBhbmRcbi8vIGh1ZSB0b29rIGF3YXk7IHNpbmNlIGJvdGggbm93IGNhcnJ5IGNocm9tYSBhbG9uZyAoc2VlIGNvbXB1dGVDb2xvck9mZnNldCksXG4vLyBpdCBjb3VsZCBvbmx5IHNheSBcInRoaXMgU3VidHlwIGhvbGRzIGJhY2tcIiwgbm90IHdvcnRoIGEgdGhpcmQgc2xpZGVyLiBUb1xuLy8gcmV2aXZlIGl0LCB1bmNvbW1lbnQgaXQgaGVyZSwgaW4gREVGQVVMVF9TVUJUWVBfQ09MT1JfUkFOR0VTLCBpblxuLy8gY29tcHV0ZUNvbG9yT2Zmc2V0IGFuZCBhdCByYW5nZU1heC9yYW5nZURlc2MgaW4gc2V0dGluZ3MuanMuXG4vLyBkb3duT25seTogdGhlIHNsaWRlciBvbmx5IGdvZXMgZnJvbSAtbGltaXQgdG8gMCAtIGEgU3VidHlwIG1heSBob2xkIGJhY2sgYnV0XG4vLyBuZXZlciBiZSBsb3VkZXIgdGhhbiBpdHMgVFlQLlxuY29uc3QgU1VCVFlQX0NPTE9SX0NIQU5ORUxTID0gW1xuICB7IGtleTogXCJoXCIsIGxhYmVsOiBcIkh1ZVwiLCB1bml0OiBcIlx1MDBCMFwiIH0sXG4gIC8vIHsga2V5OiBcInNcIiwgbGFiZWw6IFwiU2F0dXJhdGlvblwiLCB1bml0OiBcIiVcIiwgZG93bk9ubHk6IHRydWUgfSxcbiAgeyBrZXk6IFwibFwiLCBsYWJlbDogXCJMaWdodG5lc3NcIiwgdW5pdDogXCIlXCIgfSxcbl07XG4vLyBTdWJ0eXBzIHNob3VsZCBhYm92ZSBhbGwgYmUgZGlzdGluZ3Vpc2hhYmxlOiBodWUgY29udHJpYnV0ZXMgbW9zdCBhbmQgZ2V0c1xuLy8gdGhlIHdpZGVzdCByYW5nZSwgbGlnaHRuZXNzIGFzIHRoZSBzZWNvbmQgY2xlYXIgYXhpcyBnZXRzIHBsZW50eSB0b28uXG5jb25zdCBERUZBVUxUX1NVQlRZUF9DT0xPUl9SQU5HRVMgPSB7IGg6IDM1LCAvKiBzOiA0MCwgKi8gbDogNDAgfTtcblxuZnVuY3Rpb24gY29sb3JSYW5nZShzZXR0aW5ncywga2V5KSB7XG4gIGNvbnN0IHZhbHVlID0gTnVtYmVyKHNldHRpbmdzLnN1YnR5cENvbG9yUmFuZ2VzPy5ba2V5XSk7XG4gIHJldHVybiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpICYmIHZhbHVlID49IDAgPyB2YWx1ZSA6IERFRkFVTFRfU1VCVFlQX0NPTE9SX1JBTkdFU1trZXldO1xufVxuXG4vLyBTbGlkZXIgcmFuZ2UgLSBvbmUgcGxhY2UgZm9yIHBvcG92ZXIsIGNsYW1waW5nIGFuZCBncmFkaWVudCBwcmV2aWV3IHNvIHRoZXlcbi8vIGNhbid0IGRyaWZ0IGFwYXJ0LlxuZnVuY3Rpb24gY2hhbm5lbEJvdW5kcyhzZXR0aW5ncywga2V5KSB7XG4gIGNvbnN0IHJhbmdlID0gY29sb3JSYW5nZShzZXR0aW5ncywga2V5KTtcbiAgcmV0dXJuIFNVQlRZUF9DT0xPUl9DSEFOTkVMUy5maW5kKChjaGFubmVsKSA9PiBjaGFubmVsLmtleSA9PT0ga2V5KT8uZG93bk9ubHkgPyBbLXJhbmdlLCAwXSA6IFstcmFuZ2UsIHJhbmdlXTtcbn1cblxuLy8gQSBTdWJ0eXAncyBvZmZzZXQsIGNsYW1wZWQgdG8gdGhlIGNvbmZpZ3VyZWQgbGltaXRzLlxuZnVuY3Rpb24gY2xhbXBlZE9mZnNldChzZXR0aW5ncywgb2Zmc2V0KSB7XG4gIGlmICghb2Zmc2V0KSByZXR1cm4gbnVsbDtcbiAgY29uc3QgcmVzdWx0ID0ge307XG4gIGZvciAoY29uc3QgeyBrZXkgfSBvZiBTVUJUWVBfQ09MT1JfQ0hBTk5FTFMpIHtcbiAgICBjb25zdCBbbWluLCBtYXhdID0gY2hhbm5lbEJvdW5kcyhzZXR0aW5ncywga2V5KTtcbiAgICByZXN1bHRba2V5XSA9IE1hdGgubWluKG1heCwgTWF0aC5tYXgobWluLCBOdW1iZXIob2Zmc2V0W2tleV0pIHx8IDApKTtcbiAgfVxuICByZXR1cm4gcmVzdWx0O1xufVxuXG5jb25zdCB0b0xpbmVhciA9IChjKSA9PiAoYyA8PSAwLjA0MDQ1ID8gYyAvIDEyLjkyIDogKChjICsgMC4wNTUpIC8gMS4wNTUpICoqIDIuNCk7XG5jb25zdCB0b0dhbW1hID0gKGMpID0+IChjIDw9IDAuMDAzMTMwOCA/IDEyLjkyICogYyA6IDEuMDU1ICogYyAqKiAoMSAvIDIuNCkgLSAwLjA1NSk7XG5cbmZ1bmN0aW9uIGhleFRvT2tsY2goaGV4KSB7XG4gIGNvbnN0IG1hdGNoID0gL14jPyhbMC05YS1mXXs2fSkkL2kuZXhlYyhoZXggPz8gXCJcIik7XG4gIGlmICghbWF0Y2gpIHJldHVybiBudWxsO1xuICBjb25zdCBpbnQgPSBwYXJzZUludChtYXRjaFsxXSwgMTYpO1xuICBjb25zdCBbciwgZywgYl0gPSBbKGludCA+PiAxNikgJiAyNTUsIChpbnQgPj4gOCkgJiAyNTUsIGludCAmIDI1NV0ubWFwKChjKSA9PiB0b0xpbmVhcihjIC8gMjU1KSk7XG4gIGNvbnN0IGwgPSBNYXRoLmNicnQoMC40MTIyMjE0NzA4ICogciArIDAuNTM2MzMyNTM2MyAqIGcgKyAwLjA1MTQ0NTk5MjkgKiBiKTtcbiAgY29uc3QgbSA9IE1hdGguY2JydCgwLjIxMTkwMzQ5ODIgKiByICsgMC42ODA2OTk1NDUxICogZyArIDAuMTA3Mzk2OTU2NiAqIGIpO1xuICBjb25zdCBzID0gTWF0aC5jYnJ0KDAuMDg4MzAyNDYxOSAqIHIgKyAwLjI4MTcxODgzNzYgKiBnICsgMC42Mjk5Nzg3MDA1ICogYik7XG4gIGNvbnN0IEwgPSAwLjIxMDQ1NDI1NTMgKiBsICsgMC43OTM2MTc3ODUgKiBtIC0gMC4wMDQwNzIwNDY4ICogcztcbiAgY29uc3QgQSA9IDEuOTc3OTk4NDk1MSAqIGwgLSAyLjQyODU5MjIwNSAqIG0gKyAwLjQ1MDU5MzcwOTkgKiBzO1xuICBjb25zdCBCID0gMC4wMjU5MDQwMzcxICogbCArIDAuNzgyNzcxNzY2MiAqIG0gLSAwLjgwODY3NTc2NiAqIHM7XG4gIHJldHVybiB7IEwsIEM6IE1hdGguaHlwb3QoQSwgQiksIEg6ICgoTWF0aC5hdGFuMihCLCBBKSAqIDE4MCkgLyBNYXRoLlBJICsgMzYwKSAlIDM2MCB9O1xufVxuXG4vLyBMaW5lYXIgc1JHQjsgY2hhbm5lbHMgbWF5IGZhbGwgb3V0c2lkZSAwLi4xIChvdXQgb2YgZ2FtdXQpLlxuZnVuY3Rpb24gb2tsY2hUb0xpbmVhcih7IEwsIEMsIEggfSkge1xuICBjb25zdCBBID0gQyAqIE1hdGguY29zKChIICogTWF0aC5QSSkgLyAxODApO1xuICBjb25zdCBCID0gQyAqIE1hdGguc2luKChIICogTWF0aC5QSSkgLyAxODApO1xuICBjb25zdCBsID0gKEwgKyAwLjM5NjMzNzc3NzQgKiBBICsgMC4yMTU4MDM3NTczICogQikgKiogMztcbiAgY29uc3QgbSA9IChMIC0gMC4xMDU1NjEzNDU4ICogQSAtIDAuMDYzODU0MTcyOCAqIEIpICoqIDM7XG4gIGNvbnN0IHMgPSAoTCAtIDAuMDg5NDg0MTc3NSAqIEEgLSAxLjI5MTQ4NTU0OCAqIEIpICoqIDM7XG4gIHJldHVybiBbXG4gICAgNC4wNzY3NDE2NjIxICogbCAtIDMuMzA3NzExNTkxMyAqIG0gKyAwLjIzMDk2OTkyOTIgKiBzLFxuICAgIC0xLjI2ODQzODAwNDYgKiBsICsgMi42MDk3NTc0MDExICogbSAtIDAuMzQxMzE5Mzk2NSAqIHMsXG4gICAgLTAuMDA0MTk2MDg2MyAqIGwgLSAwLjcwMzQxODYxNDcgKiBtICsgMS43MDc2MTQ3MDEgKiBzLFxuICBdO1xufVxuXG5jb25zdCBpbkdhbXV0ID0gKHJnYikgPT4gcmdiLmV2ZXJ5KChjKSA9PiBjID49IC0wLjAwMDEgJiYgYyA8PSAxLjAwMDEpO1xuXG4vLyBMYXJnZXN0IGNocm9tYSBzUkdCIGNhbiBzaG93IGF0IHRoaXMgbGlnaHRuZXNzIGFuZCBodWUuIFRoZSBsaW1pdCB2YXJpZXMgYVxuLy8gbG90IChwdXJlIHllbGxvdyBvbmx5IGNhcnJpZXMgbXVjaCBjaHJvbWEganVzdCBiZWxvdyB3aGl0ZSwgYmx1ZSBpbiB0aGVcbi8vIG1pZGRsZSksIHdoaWNoIGlzIGV4YWN0bHkgd2hlcmUgYW55IG1hdGggaG9sZGluZyBjaHJvbWEgYWJzb2x1dGUgYnJlYWtzLlxuZnVuY3Rpb24gbWF4Q2hyb21hKEwsIEgpIHtcbiAgbGV0IGxvdyA9IDA7XG4gIGxldCBoaWdoID0gMC40OyAvLyBhYm92ZSB0aGUgc1JHQiBtYXhpbXVtICh+MC4zMilcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCAyMDsgaSsrKSB7XG4gICAgY29uc3QgbWlkID0gKGxvdyArIGhpZ2gpIC8gMjtcbiAgICBpZiAoaW5HYW11dChva2xjaFRvTGluZWFyKHsgTCwgQzogbWlkLCBIIH0pKSkgbG93ID0gbWlkO1xuICAgIGVsc2UgaGlnaCA9IG1pZDtcbiAgfVxuICByZXR1cm4gbG93O1xufVxuXG4vLyBPdXQtb2YtZ2FtdXQgY29sb3JzIGxvc2UgY2hyb21hIHVudGlsIHRoZXkgZml0OyBodWUgYW5kIGxpZ2h0bmVzcyBzdGF5LlxuLy8gRm9yIGFwcGx5Q29sb3JPZmZzZXQgb25seSBhIHNhZmV0eSBuZXQsIHNpbmNlIGNocm9tYSBpcyBhbHJlYWR5IGEgc2hhcmUgb2Zcbi8vIHRoZSBkaXNwbGF5YWJsZSBtYXhpbXVtIHRoZXJlLlxuZnVuY3Rpb24gb2tsY2hUb0hleChjb2xvcikge1xuICBsZXQgcmdiID0gb2tsY2hUb0xpbmVhcihjb2xvcik7XG4gIGlmICghaW5HYW11dChyZ2IpKSByZ2IgPSBva2xjaFRvTGluZWFyKHsgLi4uY29sb3IsIEM6IG1heENocm9tYShjb2xvci5MLCBjb2xvci5IKSB9KTtcbiAgcmV0dXJuIChcbiAgICBcIiNcIiArXG4gICAgcmdiXG4gICAgICAubWFwKChjKSA9PiBNYXRoLnJvdW5kKE1hdGgubWluKDEsIE1hdGgubWF4KDAsIHRvR2FtbWEoTWF0aC5taW4oMSwgTWF0aC5tYXgoMCwgYykpKSkpICogMjU1KSlcbiAgICAgIC5tYXAoKGMpID0+IGMudG9TdHJpbmcoMTYpLnBhZFN0YXJ0KDIsIFwiMFwiKSlcbiAgICAgIC5qb2luKFwiXCIpXG4gICk7XG59XG5cbi8vIExpZ2h0bmVzcyBvZiBhIGh1ZSdzIGN1c3AsIHdoZXJlIGl0IGNhcnJpZXMgdGhlIG1vc3QgY2hyb21hLiBtYXhDaHJvbWEgcmlzZXNcbi8vIHVwIHRvIGl0IGFuZCBmYWxscyBhZnRlciwgc28gdGhlIHBlYWsgY2FuIGJlIG5hcnJvd2VkIGRvd24uIE9uZSB2YWx1ZSBwZXJcbi8vIGh1ZSBhbmQgdGhlIHNlYXJjaCBpcyBjb3N0bHksIHNvIGl0IGlzIGNhY2hlZCBwZXIgd2hvbGUgZGVncmVlLlxuY29uc3QgY3VzcENhY2hlID0gbmV3IE1hcCgpO1xuXG4vLyBBYm92ZSB0aGlzIGEgY29sb3IgY291bnRzIGFzIGNocm9tYXRpYy4gQSBwdXJlIGdyYXkgY29tZXMgYmFjayBmcm9tXG4vLyBoZXhUb09rbGNoIHdpdGggY2hyb21hIGFyb3VuZCAyZS04IGFuZCBhbiBhcmJpdHJhcnkgaHVlIChyb3VuZGVkIG1hdHJpeFxuLy8gY29uc3RhbnRzKTsgdGVzdGluZyBcIj4gMFwiIG1hZGUgYSBncmF5IGZvbGxvdyB0aGUgY3VzcCBvZiBhIGh1ZSBpdCBkb2Vzbid0XG4vLyBoYXZlLiBGYXIgYmVsb3cgYW55dGhpbmcgdmlzaWJsZSBpbiA4IGJpdCAob25lIHN0ZXAgaXMgYWJvdXQgMC4wMDIpLlxuY29uc3QgTkVVVFJBTF9DSFJPTUEgPSAxZS00O1xuXG5mdW5jdGlvbiBjdXNwTGlnaHRuZXNzKEgpIHtcbiAgY29uc3Qga2V5ID0gTWF0aC5yb3VuZChIKSAlIDM2MDtcbiAgY29uc3QgY2FjaGVkID0gY3VzcENhY2hlLmdldChrZXkpO1xuICBpZiAoY2FjaGVkICE9PSB1bmRlZmluZWQpIHJldHVybiBjYWNoZWQ7XG4gIGxldCBsb3cgPSAwO1xuICBsZXQgaGlnaCA9IDE7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgMjQ7IGkrKykge1xuICAgIGNvbnN0IHRoaXJkID0gKGhpZ2ggLSBsb3cpIC8gMztcbiAgICBpZiAobWF4Q2hyb21hKGxvdyArIHRoaXJkLCBrZXkpIDwgbWF4Q2hyb21hKGhpZ2ggLSB0aGlyZCwga2V5KSkgbG93ICs9IHRoaXJkO1xuICAgIGVsc2UgaGlnaCAtPSB0aGlyZDtcbiAgfVxuICBjb25zdCByZXN1bHQgPSAobG93ICsgaGlnaCkgLyAyO1xuICBjdXNwQ2FjaGUuc2V0KGtleSwgcmVzdWx0KTtcbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLy8gVGhlIHNhbWUgbGlnaHRuZXNzLCBtZWFzdXJlZCBhZ2FpbnN0IHRoZSB0YXJnZXQgaHVlJ3MgY3VzcCBpbnN0ZWFkIG9mIGl0c1xuLy8gb3duOiBjdXNwIG1hcHMgdG8gY3VzcCwgYmxhY2sgdG8gYmxhY2ssIHdoaXRlIHRvIHdoaXRlLCBsaW5lYXIgaW4gYmV0d2Vlbi5cbi8vIFdpdGhvdXQgYSBodWUgc2hpZnQgTCBjb21lcyBiYWNrIHVuY2hhbmdlZC5cbmZ1bmN0aW9uIHJlbWFwVG9DdXNwKEwsIGZyb21ILCB0b0gpIHtcbiAgY29uc3QgZnJvbSA9IGN1c3BMaWdodG5lc3MoZnJvbUgpO1xuICBjb25zdCB0byA9IGN1c3BMaWdodG5lc3ModG9IKTtcbiAgaWYgKEwgPD0gZnJvbSkgcmV0dXJuIGZyb20gPiAwID8gKEwgLyBmcm9tKSAqIHRvIDogdG87XG4gIHJldHVybiBmcm9tIDwgMSA/IHRvICsgKChMIC0gZnJvbSkgLyAoMSAtIGZyb20pKSAqICgxIC0gdG8pIDogdG87XG59XG5cbi8vIFRoZSB0d28gZ2FtdXQgc2VhcmNoZXMgY29zdCBhYm91dCAxMCBcdTAwQjVzIHBlciBjb2xvciAtIHRvbyBtdWNoIHdoZW4gdGhlIGZpbGVcbi8vIHRyZWUgb3IgZ3JhcGggYXNrcyBmb3IgZXZlcnkgZmlsZSAoc2VlIGNvbG9yRm9yRmlsZSkuIFRoZXJlIGFyZSBvbmx5IGFcbi8vIGhhbmRmdWwgb2YgZGlzdGluY3QgY29sb3JzLCBzbyBhIGNhY2hlIHN1ZmZpY2VzOyBkcmFnZ2luZyBhIHNsaWRlciBhZGRzXG4vLyBldmVyeSBpbnRlcm1lZGlhdGUgdmFsdWUsIGhlbmNlIHRoZSBvY2Nhc2lvbmFsIHJlc2V0LlxuY29uc3Qgb2Zmc2V0Q2FjaGUgPSBuZXcgTWFwKCk7XG5cbmZ1bmN0aW9uIGFwcGx5Q29sb3JPZmZzZXQoaGV4LCBvZmZzZXQpIHtcbiAgaWYgKCFvZmZzZXQpIHJldHVybiBoZXg7XG4gIGNvbnN0IGNhY2hlS2V5ID0gaGV4ICsgXCJ8XCIgKyAob2Zmc2V0LmggPz8gMCkgKyBcInxcIiArIChvZmZzZXQubCA/PyAwKTtcbiAgY29uc3QgY2FjaGVkID0gb2Zmc2V0Q2FjaGUuZ2V0KGNhY2hlS2V5KTtcbiAgaWYgKGNhY2hlZCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gY2FjaGVkO1xuICBjb25zdCByZXN1bHQgPSBjb21wdXRlQ29sb3JPZmZzZXQoaGV4LCBvZmZzZXQpO1xuICBpZiAob2Zmc2V0Q2FjaGUuc2l6ZSA+IDUwMCkgb2Zmc2V0Q2FjaGUuY2xlYXIoKTtcbiAgb2Zmc2V0Q2FjaGUuc2V0KGNhY2hlS2V5LCByZXN1bHQpO1xuICByZXR1cm4gcmVzdWx0O1xufVxuXG4vLyBCb3RoIHNsaWRlcnMgYWN0IHJlbGF0aXZlIHRvIHRoZSBUWVAgY29sb3Igc28gdGhlIFN1YnR5cCBzdGF5cyBpbiB0aGVcbi8vIGZhbWlseS4gQWJzb2x1dGUgdmFsdWVzIGRvbid0IGtlZXAgdGhlaXIgcHJvbWlzZSwgYmVjYXVzZSBob3cgbXVjaCBjb2xvclxuLy8gc1JHQiBhbGxvd3MgZGVwZW5kcyBvbiBsaWdodG5lc3MgQU5EIGh1ZTpcbi8vICAgbDogc2hhcmUgb2YgdGhlIHdheSB0byB3aGl0ZSAoKykgb3IgYmxhY2sgKC0pLiBBYnNvbHV0ZSBPS0xDSCBwb2ludHMgcmFuIGFcbi8vICAgICAgbGlnaHQgVFlQIGNvbG9yIGludG8gcHVyZSB3aGl0ZSBpbiB0aGUgZmlyc3QgaGFsZiBvZiB0aGUgc2xpZGVyLlxuLy8gICBoOiBkZWdyZWVzIC0gdGhlIG9ubHkgYWJzb2x1dGUgb25lLCBCVVQgaXQgY2FycmllcyBsaWdodG5lc3MgYWxvbmcgKHNlZVxuLy8gICAgICByZW1hcFRvQ3VzcCkuIEVhY2ggaHVlIHBlYWtzIGF0IGEgZGlmZmVyZW50IGxpZ2h0bmVzcyAoeWVsbG93IGF0IEwgMC45Mixcbi8vICAgICAgb3JhbmdlIDAuNzgsIGJsdWUgMC40OSkuIFR1cm5pbmcgYSBsaWdodCB5ZWxsb3cgdG8gb3JhbmdlIGF0IGZpeGVkXG4vLyAgICAgIGxpZ2h0bmVzcyBsYW5kcyBmYXIgYWJvdmUgb3JhbmdlJ3MgY3VzcCwgd2hlcmUgdGhlcmUgaXMgaGFyZGx5IGFueVxuLy8gICAgICBjaHJvbWEgbGVmdDogYSB3YXNoZWQtb3V0IHBhc3RlbC4gRm9sbG93aW5nIHRoZSBjdXNwIGtlZXBzIHRoZSBjb2xvclxuLy8gICAgICBzdHJlbmd0aCBuZWFybHkgY29uc3RhbnQgdGhyb3VnaCB0aGUgdHVybi5cbi8vIENocm9tYSBpcyB0aGVuIHNpbXBseSBhIHNoYXJlIG9mIHRoZSBjZWlsaW5nIChiYXNlLkMgLyBtYXhDaHJvbWEgYXQgdGhlXG4vLyBzdGFydCwgdGltZXMgbWF4Q2hyb21hIGF0IHRoZSB0YXJnZXQpOyBvbmx5IHdpdGggcmVsYXRlZCBsaWdodG5lc3NlcyBhcmVcbi8vIHR3byBodWVzJyBjZWlsaW5ncyBjb21wYXJhYmxlLlxuLy9cbi8vIE5vdGUgd2hhdCB0aGF0IHNoYXJlIGlzOiBhIHN0YXRlbWVudCBhYm91dCBzUkdCLCBub3QgYWJvdXQgcGVyY2VwdGlvbi4gSXRcbi8vIGtlZXBzIFwiZXF1YWxseSBleGhhdXN0ZWRcIiwgbm90IFwiZXF1YWxseSBjb2xvcmZ1bFwiIChjb25zdGFudCBDKSBub3IgXCJlcXVhbGx5XG4vLyBzYXR1cmF0ZWRcIiAoY29uc3RhbnQgQy9MKS4gU28gdGhlIG1vZGVsIGlzIHRpZWQgdG8gc1JHQjsgYWZ0ZXIgYSBodWUgdHVybiBhXG4vLyBTdWJ0eXAgaXMgZXF1YWxseSBlbXBoYXRpYyByYXRoZXIgdGhhbiBlcXVhbGx5IGxpZ2h0IChhIGRlc2lnbiBjaG9pY2UpOyBhbmRcbi8vIGNocm9tYSBpc24ndCBtb25vdG9uaWMgaW4gbGlnaHRuZXNzIC0gYWJvdmUgaXRzIGN1c3AgYSBUWVAgY29sb3IgZmlyc3QgZ2FpbnNcbi8vIGNocm9tYSBnb2luZyBkb3duLCB0aGVuIGxvc2VzIGl0ICgjNzg3OGRjIGhhcyBtb3JlIGF0IC0yMCAlIHRoYW4gYXQgMCAlIG9yXG4vLyAtNDAgJSkuIEZpbmUgZm9yIGNvbG9yZWQgZmlsZSBuYW1lczsgYSBzdHJpY3RlciBtb2RlbCBuZWVkcyBhIGRpZmZlcmVudFxuLy8gcmVmZXJlbmNlLCBub3QgcGF0Y2hlZCBmb3JtdWxhcy5cbi8vXG4vLyBPS0xhYiBpdHNlbGYgaXMgb2ZmIGluIHRoZSBibHVlIHJhbmdlIChIIDI2MC0yOTApOiBibHVlIGRyaWZ0cyB0b3dhcmQgdmlvbGV0XG4vLyB3aGVuIGxpZ2h0ZW5lZCB3aGlsZSB0aGUgbnVtYmVycyBzYXkgdGhlIGh1ZSBpcyBjb25zdGFudC4gQ2hlY2sgc3VjaCBUWVBcbi8vIGNvbG9ycyBieSBleWUuXG5mdW5jdGlvbiBjb21wdXRlQ29sb3JPZmZzZXQoaGV4LCBvZmZzZXQpIHtcbiAgY29uc3QgYmFzZSA9IGhleFRvT2tsY2goaGV4KTtcbiAgaWYgKCFiYXNlKSByZXR1cm4gaGV4O1xuICBjb25zdCBIID0gKGJhc2UuSCArIChvZmZzZXQuaCA/PyAwKSArIDM2MCkgJSAzNjA7XG4gIGNvbnN0IGJhc2VDZWlsaW5nID0gbWF4Q2hyb21hKGJhc2UuTCwgYmFzZS5IKTtcbiAgLy8gQSBncmF5IFRZUCBjb2xvciBzdGF5cyBncmF5OyBpdHMgaHVlIG1lYW5zIG5vdGhpbmcsIHNvIHRoZXJlIGlzIG5vIGN1c3AgdG9cbiAgLy8gZm9sbG93IGVpdGhlci5cbiAgY29uc3QgbmV1dHJhbCA9IGJhc2UuQyA8IE5FVVRSQUxfQ0hST01BIHx8IGJhc2VDZWlsaW5nIDw9IDA7XG4gIGNvbnN0IHJlbGF0aXZlID0gbmV1dHJhbCA/IDAgOiBiYXNlLkMgLyBiYXNlQ2VpbGluZztcbiAgY29uc3Qgc2hpZnRlZCA9IG5ldXRyYWwgPyBiYXNlLkwgOiByZW1hcFRvQ3VzcChiYXNlLkwsIGJhc2UuSCwgSCk7XG4gIGNvbnN0IHNoYXJlID0gKG9mZnNldC5sID8/IDApIC8gMTAwO1xuICBjb25zdCBMID0gTWF0aC5taW4oMSwgTWF0aC5tYXgoMCwgc2hpZnRlZCArIHNoYXJlICogKHNoYXJlID49IDAgPyAxIC0gc2hpZnRlZCA6IHNoaWZ0ZWQpKSk7XG4gIGNvbnN0IEMgPSByZWxhdGl2ZSAqIG1heENocm9tYShMLCBIKTsgLyogKiAoMSArIChvZmZzZXQucyA/PyAwKSAvIDEwMCkgLSBzYXR1cmF0aW9uIGRpc2FibGVkICovXG4gIHJldHVybiBva2xjaFRvSGV4KHsgTCwgQzogTWF0aC5tYXgoMCwgQyksIEggfSk7XG59XG5cbmZ1bmN0aW9uIGhhc0NvbG9yT2Zmc2V0KG9mZnNldCkge1xuICByZXR1cm4gISFvZmZzZXQgJiYgU1VCVFlQX0NPTE9SX0NIQU5ORUxTLnNvbWUoKHsga2V5IH0pID0+IChvZmZzZXRba2V5XSA/PyAwKSAhPT0gMCk7XG59XG5cbi8vIEEgU3VidHlwJ3MgY29sb3IgKHRoZSBUWVAncyB3aGlsZSBpdCBoYXMgbm8gb2Zmc2V0KTsgbnVsbCBpZiB0aGUgVFlQIGl0c2VsZlxuLy8gaGFzIG5vIGNvbG9yLlxuZnVuY3Rpb24gc3VidHlwQ29sb3Ioc2V0dGluZ3MsIHR5cCwgc3VidHlwKSB7XG4gIGNvbnN0IHR5cENvbG9yID0gc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPz8gbnVsbDtcbiAgaWYgKCF0eXBDb2xvciB8fCAhc3VidHlwKSByZXR1cm4gdHlwQ29sb3I7XG4gIGNvbnN0IG9mZnNldCA9IGNsYW1wZWRPZmZzZXQoc2V0dGluZ3MsIGdldFN1YnR5cChzZXR0aW5ncywgdHlwLCBzdWJ0eXApPy5jb2xvcik7XG4gIHJldHVybiBoYXNDb2xvck9mZnNldChvZmZzZXQpID8gYXBwbHlDb2xvck9mZnNldCh0eXBDb2xvciwgb2Zmc2V0KSA6IHR5cENvbG9yO1xufVxuXG4vLyBEb2VzIHRoZSBTdWJ0eXAgaGF2ZSBhbiBvZmZzZXQgb2YgaXRzIG93biAoZWZmZWN0aXZlIHdpdGhpbiB0aGUgbGltaXRzKT9cbmZ1bmN0aW9uIHN1YnR5cEhhc093bkNvbG9yKHNldHRpbmdzLCB0eXAsIHN1YnR5cCkge1xuICByZXR1cm4gaGFzQ29sb3JPZmZzZXQoY2xhbXBlZE9mZnNldChzZXR0aW5ncywgZ2V0U3VidHlwKHNldHRpbmdzLCB0eXAsIHN1YnR5cCk/LmNvbG9yKSk7XG59XG5cbi8vIENvbG9yIG9mIGEgVFlQIG9yIFN1YnR5cCBuYW1lIC0gc2hhcmVkIGJ5IHRoZSBwaWNrZXIgKHR5cC1waWNrZXIuanMpIGFuZCB0aGVcbi8vIFN1YnR5cCBwcmV2aWV3IGluIHRoZSBUWVAtTGlzdCBzbyB0aGV5IGNhbid0IGRyaWZ0IGFwYXJ0LiBXaXRoIHN1YnR5cCwgdGhlXG4vLyBTdWJ0eXAgY29sb3IsIGJ1dCBvbmx5IGlmIHRoZSBcIlN1YnR5cFwiIHN1Yi10b2dnbGUgb2YgXCJUWVAtUGFuZVwiIGFsbG93cyBpdC5cbi8vIGlzRGVmYXVsdCBtZWFucyBhIGhvbGxvdyByaW5nIGluc3RlYWQgb2YgYSBmaWxsZWQgZG90IChzZWUgcGFpbnRDb2xvckRvdCkuXG5mdW5jdGlvbiBuYW1lQ29sb3Ioc2V0dGluZ3MsIHR5cCwgc3VidHlwID0gbnVsbCkge1xuICBjb25zdCB1c2VTdWJ0eXAgPSAhIXN1YnR5cCAmJiBzZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3RTdWJ0eXA7XG4gIGNvbnN0IHR5cENvbG9yID0gc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPz8gbnVsbDtcbiAgcmV0dXJuIHtcbiAgICBjb2xvcjogKHVzZVN1YnR5cCA/IHN1YnR5cENvbG9yKHNldHRpbmdzLCB0eXAsIHN1YnR5cCkgOiB0eXBDb2xvcikgPz8gREVGQVVMVF9UWVBfQ09MT1IsXG4gICAgaXNEZWZhdWx0OiAhdHlwQ29sb3IgfHwgKHVzZVN1YnR5cCAmJiAhc3VidHlwSGFzT3duQ29sb3Ioc2V0dGluZ3MsIHR5cCwgc3VidHlwKSksXG4gIH07XG59XG5cbi8vIENvbG9yIGRvdCAoVFlQLUxpc3QsIGRldGFpbCB2aWV3LCBwaWNrZXJzLCBkaWFsb2dzKTogZmlsbGVkIGZvciBhbiBvd25cbi8vIGNvbG9yLCBhIGhvbGxvdyByaW5nIGZvciB0aGUgZGVmYXVsdCAtIGdyYXkgZm9yIGEgVFlQIHdpdGhvdXQgYSBjb2xvciwgdGhlXG4vLyBpbmhlcml0ZWQgVFlQIGNvbG9yIGZvciBhIFN1YnR5cCB3aXRob3V0IGFuIG9mZnNldC5cbmZ1bmN0aW9uIHBhaW50Q29sb3JEb3QoZWwsIGNvbG9yLCBpc0RlZmF1bHQpIHtcbiAgZWwuc3R5bGUuYmFja2dyb3VuZENvbG9yID0gaXNEZWZhdWx0ID8gXCJ0cmFuc3BhcmVudFwiIDogY29sb3I7XG4gIGVsLnN0eWxlLmJveFNoYWRvdyA9IGlzRGVmYXVsdCA/IGBpbnNldCAwIDAgMCBtYXgoMS41cHgsIDAuMTVlbSkgJHtjb2xvcn1gIDogXCJcIjtcbn1cblxuLy8gdmlld0tleSAob3B0aW9uYWwpOiB0aGUgdmlldydzIGtleSBpbiBjb2xvclZpZXdzLiBJZiBpdHMgXCI8dmlld0tleT5TdWJ0eXBcIlxuLy8gc3ViLXRvZ2dsZSBpcyBvbiwgdGhlIG5vdGUncyBTdWJ0eXAgY29sb3IgaXMgdXNlZCBpbnN0ZWFkIG9mIGl0cyBUWVAncy5cbmZ1bmN0aW9uIGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIHZpZXdLZXkgPSBudWxsKSB7XG4gIGNvbnN0IHR5cCA9IHBsdWdpbi50eXBJbmRleC50eXBPZihmaWxlKTtcbiAgaWYgKCF0eXApIHJldHVybiBudWxsO1xuICBjb25zdCB7IHNldHRpbmdzIH0gPSBwbHVnaW47XG4gIGlmICghdmlld0tleSB8fCAhc2V0dGluZ3MuY29sb3JWaWV3c1tgJHt2aWV3S2V5fVN1YnR5cGBdKSByZXR1cm4gc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPz8gbnVsbDtcbiAgcmV0dXJuIHN1YnR5cENvbG9yKHNldHRpbmdzLCB0eXAsIHBsdWdpbi50eXBJbmRleC5zdWJ0eXBPZihmaWxlKSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBjb2xvckZvckZpbGUsXG4gIG5hbWVDb2xvcixcbiAgREVGQVVMVF9UWVBfQ09MT1IsXG4gIHN1YnR5cENvbG9yLFxuICBhcHBseUNvbG9yT2Zmc2V0LFxuICBoYXNDb2xvck9mZnNldCxcbiAgc3VidHlwSGFzT3duQ29sb3IsXG4gIHBhaW50Q29sb3JEb3QsXG4gIGNvbG9yUmFuZ2UsXG4gIGNoYW5uZWxCb3VuZHMsXG4gIGNsYW1wZWRPZmZzZXQsXG4gIFNVQlRZUF9DT0xPUl9DSEFOTkVMUyxcbiAgREVGQVVMVF9TVUJUWVBfQ09MT1JfUkFOR0VTLFxufTtcbiIsICJjb25zdCB7IFBsdWdpblNldHRpbmdUYWIsIFNldHRpbmdHcm91cCwgVG9nZ2xlQ29tcG9uZW50LCBEcm9wZG93bkNvbXBvbmVudCwgZGVib3VuY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgbW91bnRHbG9iYWxPcmRlckVkaXRvciB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItb3JkZXItZWRpdG9yXCIpO1xuY29uc3QgeyBERUZBVUxUX0dMT0JBTF9PUkRFUiB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItc29ydFwiKTtcbmNvbnN0IHsgU1VCVFlQX0NPTE9SX0NIQU5ORUxTLCBERUZBVUxUX1NVQlRZUF9DT0xPUl9SQU5HRVMsIGNvbG9yUmFuZ2UgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5cbmNvbnN0IERFRkFVTFRfU0VUVElOR1MgPSB7XG4gIHR5cHM6IFtdLFxuICB0eXBDb2xvcnM6IHt9LFxuICB0eXBEZXNjcmlwdGlvbnM6IHt9LFxuICB0eXBEZWZhdWx0RnJvbnRtYXR0ZXI6IHt9LFxuICAvLyBLZXlzIG9mIHR5cERlZmF1bHRGcm9udG1hdHRlclt0eXBdIG1hcmtlZCBhcyBmbG9hdGluZy4gVGhleSBzaGFyZSB0aGUgbGlzdFxuICAvLyBhbmQgaXRzIG9yZGVyICh3aGljaCBmcm9udG1hdHRlciBzb3J0aW5nIHVzZXMpLCBidXQgZ2V0VHlwRGVmYXVsdHMoKSBsZWF2ZXNcbiAgLy8gdGhlbSBvdXQgdW5sZXNzIGFza2VkIHdpdGggaW5jbHVkZUZsb2F0aW5nLCBzbyBuZXcgbm90ZXMgZG9uJ3QgZ2V0IHRoZW1cbiAgLy8gYXV0b21hdGljYWxseS5cbiAgdHlwRmxvYXRpbmdLZXlzOiB7fSxcbiAgLy8gU2hvcnRjdXRzIHBlciBrZXkgb2YgdHlwRGVmYXVsdEZyb250bWF0dGVyW3R5cF06XG4gIC8vICAgeyBbVFlQXTogeyBbUHJvcGVydHldOiB7IG5hbWU6IFwidG9kYXlcIiB8IFwidHAuPHNjcmlwdD5cIiB9IH0gfVxuICAvLyBLZXB0IE5FWFQgVE8gdGhlIGZyb250bWF0dGVyLCBub3QgYXMgaXRzIHZhbHVlIC0gc2VlIHNob3J0Y3V0cy5qcy5cbiAgdHlwU2hvcnRjdXRzOiB7fSxcbiAgdHlwTWFudWFsOiB7fSxcbiAgLy8gUmVnaXN0ZXJlZCBTdWJ0eXBzIHBlciBUWVAgd2l0aCB0aGVpciBvd24gZnJvbnRtYXR0ZXIgYmxvY2ssIHNlZSBzdWJ0eXBzLmpzLlxuICB0eXBTdWJ0eXBzOiB7fSxcbiAgLy8gUGlubmVkIHNpbmdsZSBwcm9wZXJ0aWVzIChraW5kOiBcInByb3BlcnR5XCIpIHBsdXMgdGhlIGZvdXIgZml4ZWRcbiAgLy8gcGxhY2Vob2xkZXJzIFwidHlwVmFsdWVcIiwgXCJzdWJ0eXBWYWx1ZVwiLCBcInR5cFwiIGFuZCBcIm90aGVyXCIgLSBzZWVcbiAgLy8gZnJvbnRtYXR0ZXItc29ydC5qcy5cbiAgZ2xvYmFsUHJvcGVydHlPcmRlcjogREVGQVVMVF9HTE9CQUxfT1JERVIsXG4gIC8vIEhvdyB0aGUgb3BlbiBub3RlIHNob3dzIGl0cyBUWVAgKHNlZSBhY3RpdmUtdGl0bGUtY29sb3JzLmpzKTogXCJub25lXCIsXG4gIC8vIFwiZG90XCIgb3IgXCJiYWRnZVwiLiBUaGUgdGhyZWUgYmFkZ2Ugc2V0dGluZ3MgYmVsb3cgb25seSBtYXR0ZXIgZm9yIFwiYmFkZ2VcIi5cbiAgLy8gY29sb3JWaWV3cy5ub3RlVGl0bGVDb2xvciAodGhlIHRpdGxlIHRleHQgaXRzZWxmKSBpcyBpbmRlcGVuZGVudC5cbiAgbm90ZVRpdGxlU3R5bGU6IFwiZG90XCIsXG4gIC8vIEJhZGdlIGNvbG9yZWQgKFRZUCBjb2xvcikgb3IgbmV1dHJhbCAodGV4dC1tdXRlZCkuXG4gIG5vdGVUaXRsZUJhZGdlQ29sb3JlZDogdHJ1ZSxcbiAgLy8gQmFkZ2UgbGFiZWw6IFwidHlwXCIgKFtUWVBdKSwgXCJ0eXAtc3VidHlwXCIgKFtUWVAvU3VidHlwXSkgb3IgXCJzdWJ0eXBcIlxuICAvLyAoW1N1YnR5cF07IG5vIGJhZGdlIHdpdGhvdXQgYSBTdWJ0eXApLiBDb2xvcmVkIGluIHRoZSBUWVAgb3IgU3VidHlwIGNvbG9yO1xuICAvLyBmb3IgXCJ0eXAtc3VidHlwXCIgY2hvc2VuIHdpdGggY29sb3JWaWV3cy5ub3RlVGl0bGVNYXJrZXJTdWJ0eXAuXG4gIG5vdGVUaXRsZUJhZGdlTGFiZWw6IFwidHlwXCIsXG4gIC8vIFwidGl0bGVcIiAobmV4dCB0byB0aGUgaW5saW5lIHRpdGxlKSBvciBcImJsb2NrXCIgKGxlZnQgb2YgdGhlIHByb3BlcnR5XG4gIC8vIGJsb2NrLCB0dXJuZWQgOTBcdTAwQjApLlxuICBub3RlVGl0bGVCYWRnZVBvc2l0aW9uOiBcInRpdGxlXCIsXG4gIC8vIEZvciBwb3NpdGlvbiBcImJsb2NrXCI6IHRvcCBvciBib3R0b20gZWRnZSBvZiB0aGUgcHJvcGVydHkgYmxvY2suXG4gIG5vdGVUaXRsZVZlcnRpY2FsQWxpZ246IFwidG9wXCIsXG4gIHR5cFNvcnRPcmRlcjogXCJjb3VudC1kZXNjXCIsXG4gIC8vIFdoYXQgdGhlIFRZUC1MaXN0IHNob3dzIG5leHQgdG8gdGhlIG5hbWU6IFwic3VidHlwc1wiLCBcImRlc2NyaXB0aW9uXCIgb3JcbiAgLy8gXCJub25lXCIuIFN3aXRjaGVkIGJ5IHRoZSBoZWFkZXIgYnV0dG9uIG5leHQgdG8gc29ydGluZyAoU0VDT05EQVJZX01PREVTIGluXG4gIC8vIHR5cC1wYW5lLmpzKSwgbm90IGhlcmU6IGxpa2UgdGhlIHNvcnQgb3JkZXIgaXQgb25seSBjb25jZXJucyB0aGF0IGxpc3QuXG4gIHR5cExpc3RTZWNvbmRhcnk6IFwic3VidHlwc1wiLFxuICAvLyBTZWUgcGlja1R5cEFuZFN1YnR5cCBpbiB0eXAtcGlja2VyLmpzOiBmYWxzZSA9IGVhY2ggU3VidHlwIGluZGVudGVkIGluIHRoZVxuICAvLyBUWVAtUGlja2VyLCB0cnVlID0gYSBzZXBhcmF0ZSBTdWJ0eXAtUGlja2VyIGFmdGVyIHRoZSBUWVAgY2hvaWNlLlxuICBzZXBhcmF0ZVN1YnR5cFBpY2tlcjogZmFsc2UsXG4gIGluY2x1ZGVJZ25vcmVkRmlsZXM6IGZhbHNlLFxuICAvLyBBc2sgYmVmb3JlIGRlbGV0aW5nIGEgVFlQIG9yIGEgU3VidHlwIHdpdGggcHJvcGVydGllcy4gT25seSBkZWxldGlvbnMgdGhhdFxuICAvLyB0b3VjaCBub3RoaW5nIGJ1dCB0aGVzZSBzZXR0aW5ncyBjYW4gYmUgc3dpdGNoZWQgb2ZmIChcIkRvbid0IGFzayBhZ2FpblwiIGluXG4gIC8vIHRoZSBkaWFsb2cpIC0gdGhleSBjYW4gYmUgdW5kb25lICh1bmRvLmpzKS4gQW55dGhpbmcgdGhhdCByZXdyaXRlcyBub3Rlc1xuICAvLyBvciBmaWxlcyBhbHdheXMgYXNrcy5cbiAgY29uZmlybURlbGV0aW9uOiB0cnVlLFxuICAvLyBPd24gdGFnL2F0dGFjaG1lbnQgY29sb3JzIGluIHRoZSBncmFwaCBkaXNhYmxlZCAoMjAyNi0wOS0zMCk6IHRoZSBNaW5pbWFsXG4gIC8vIHRoZW1lJ3MgU3R5bGUgU2V0dGluZ3MgY292ZXIgYm90aCwgc2VlIGdyYXBoLWNvbG9ycy5qcy5cbiAgLy8gZ3JhcGhUYWdDb2xvckVuYWJsZWQ6IGZhbHNlLFxuICAvLyBncmFwaFRhZ0NvbG9yOiBcIlwiLFxuICAvLyBncmFwaEF0dGFjaG1lbnRDb2xvckVuYWJsZWQ6IGZhbHNlLFxuICAvLyBncmFwaEF0dGFjaG1lbnRDb2xvcjogXCJcIixcbiAgLy8gSG93IGZhciBhIFN1YnR5cCdzIGNvbG9yIG1heSBkaWZmZXIgZnJvbSBpdHMgVFlQJ3MgKFx1MDBCMSksIHNlZSB0eXAtY29sb3JzLmpzOlxuICAvLyBodWUgaW4gZGVncmVlcywgbGlnaHRuZXNzIGluICUgb2YgdGhlIHdheSB0byB3aGl0ZSBvciBibGFjay5cbiAgc3VidHlwQ29sb3JSYW5nZXM6IHsgLi4uREVGQVVMVF9TVUJUWVBfQ09MT1JfUkFOR0VTIH0sXG4gIGNvbG9yVmlld3M6IHtcbiAgICBmaWxlRXhwbG9yZXI6IHRydWUsXG4gICAgZ3JhcGg6IHRydWUsXG4gICAgc2VhcmNoOiB0cnVlLFxuICAgIHJlY2VudEZpbGVzOiB0cnVlLFxuICAgIGJhY2tsaW5rczogdHJ1ZSxcbiAgICBib29rbWFya3M6IHRydWUsXG4gICAgLy8gXCI8dmlldz5TdWJ0eXBcIiBzdWItdG9nZ2xlczogdXNlIGEgbm90ZSdzIFN1YnR5cCBjb2xvciBpbnN0ZWFkIG9mIGl0c1xuICAgIC8vIFRZUCdzIChzZWUgY29sb3JGb3JGaWxlIGluIHR5cC1jb2xvcnMuanMpLlxuICAgIGZpbGVFeHBsb3JlclN1YnR5cDogdHJ1ZSxcbiAgICBncmFwaFN1YnR5cDogdHJ1ZSxcbiAgICBzZWFyY2hTdWJ0eXA6IHRydWUsXG4gICAgcmVjZW50RmlsZXNTdWJ0eXA6IHRydWUsXG4gICAgYmFja2xpbmtzU3VidHlwOiB0cnVlLFxuICAgIGJvb2ttYXJrc1N1YnR5cDogdHJ1ZSxcbiAgICBsaW5rc1N1YnR5cDogdHJ1ZSxcbiAgICB0eXBMaXN0U3VidHlwOiB0cnVlLFxuICAgIG5vdGVUaXRsZUNvbG9yU3VidHlwOiB0cnVlLFxuICAgIG5vdGVUaXRsZU1hcmtlclN1YnR5cDogdHJ1ZSxcbiAgICBmcm9udG1hdHRlckRlZmF1bHRzOiB0cnVlLFxuICAgIC8vIFN1Yi10b2dnbGUgb2YgZnJvbnRtYXR0ZXJEZWZhdWx0cyBhbmQgYWxsUHJvcGVydGllczogaW5jbHVkZSB0aGUgU3VidHlwXG4gICAgLy8gYmxvY2tzIChzZWUgZnJvbnRtYXR0ZXItZGVmYXVsdC1oaWdobGlnaHQuanMpOyBmb3IgYWxsUHJvcGVydGllcyBhbHNvIGluXG4gICAgLy8gdGhlIFN1YnR5cCBjb2xvci5cbiAgICBmcm9udG1hdHRlckRlZmF1bHRzU3VidHlwOiB0cnVlLFxuICAgIHR5cExpc3Q6IHRydWUsXG4gICAgYWxsUHJvcGVydGllczogdHJ1ZSxcbiAgICBhbGxQcm9wZXJ0aWVzU3VidHlwOiB0cnVlLFxuICAgIG5vdGVUaXRsZUNvbG9yOiB0cnVlLFxuICAgIGxpbmtzOiB0cnVlLFxuICB9LFxufTtcblxuY2xhc3MgVHlwU3lzdGVtU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xuICBjb25zdHJ1Y3RvcihhcHAsIHBsdWdpbikge1xuICAgIHN1cGVyKGFwcCwgcGx1Z2luKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgfVxuXG4gIC8vIEVhY2ggc2VjdGlvbiBpcyBhIFNldHRpbmdHcm91cCAoaGVhZGluZyBwbHVzIG9uZSBib3gsIGVudHJpZXMgc2VwYXJhdGVkIGJ5XG4gIC8vIGxpbmVzKSwgbGlrZSBPYnNpZGlhbidzIGNvcmUgc2V0dGluZ3MuIFNldHRpbmdzIGNyZWF0ZWQgb25lIGJ5IG9uZSB3aXRoXG4gIC8vIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKSB3b3VsZCBlYWNoIGdldCB0aGVpciBvd24gc21hbGwgYm94LlxuICBkaXNwbGF5KCkge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgLy8gS2VlcCB0aGUgc2Nyb2xsIHBvc2l0aW9uIGFjcm9zcyByZWJ1aWxkcyAodG9nZ2xlcyB3aXRoIHN1Yi1vcHRpb25zIGNhbGxcbiAgICAvLyBkaXNwbGF5KCkpOiB0aGUgVFlQIG1hcmtlciBkcm9wZG93biBtZWFzdXJlcyBpdHNlbGYgb24gc2V0VmFsdWUoKSBhbmRcbiAgICAvLyBmb3JjZXMgYSBsYXlvdXQgd2hpbGUgdGhlIHBhZ2UgaXMgb25seSBwYXJ0bHkgYnVpbHQsIHNvIHRoZSBicm93c2VyXG4gICAgLy8gY2xhbXBzIHNjcm9sbFRvcCB0byB0aGF0IGhlaWdodCBhbmQgdGhlIHBhZ2Ugd291bGQganVtcCB1cC5cbiAgICBjb25zdCB7IHNjcm9sbFRvcCB9ID0gY29udGFpbmVyRWw7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcblxuICAgIG5ldyBTZXR0aW5nR3JvdXAoY29udGFpbmVyRWwpXG4gICAgICAuc2V0SGVhZGluZyhcIlRZUC1MaXN0XCIpXG4gICAgICAuYWRkU2V0dGluZygoc2V0dGluZykgPT5cbiAgICAgICAgc2V0dGluZ1xuICAgICAgICAgIC5zZXROYW1lKFwiSW5jbHVkZSBleGNsdWRlZCBmaWxlc1wiKVxuICAgICAgICAgIC5zZXREZXNjKFxuICAgICAgICAgICAgXCJDb3VudCBub3RlcyBmcm9tIE9ic2lkaWFuJ3MgXFxcIkV4Y2x1ZGVkIGZpbGVzXFxcIiAoZS5nLiBmb2xkZXJzIGhpZGRlbiBieSBIaWRlIEZvbGRlcnMpIGluIFRZUCBjb3VudHMsIHRoZSBUWVAtUGlja2VyIGFuZCBmcm9udG1hdHRlciBzb3J0aW5nLlwiXG4gICAgICAgICAgKVxuICAgICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5pbmNsdWRlSWdub3JlZEZpbGVzKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuaW5jbHVkZUlnbm9yZWRGaWxlcyA9IHZhbHVlO1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgICAgICB9KVxuICAgICAgICAgIClcbiAgICAgIClcbiAgICAgIC5hZGRTZXR0aW5nKChzZXR0aW5nKSA9PlxuICAgICAgICBzZXR0aW5nXG4gICAgICAgICAgLnNldE5hbWUoXCJDb25maXJtIGRlbGV0aW9uXCIpXG4gICAgICAgICAgLnNldERlc2MoXG4gICAgICAgICAgICBcIkFzayBiZWZvcmUgZGVsZXRpbmcgYSBUWVAgb3IgYSBTdWJ0eXAgd2l0aCBwcm9wZXJ0aWVzLiBXaGVuIG9mZiwgdGhleSBhcmUgZGVsZXRlZCBhdCBvbmNlOyBlaXRoZXIgd2F5IHRoZSBub3RpY2UgYWZ0ZXJ3YXJkcyBvZmZlcnMgVW5kby4gRGlhbG9ncyB0aGF0IHJld3JpdGUgbm90ZXMgKHJlbmFtZSBhbmQgdXBkYXRlIG5vdGVzLCBtZXJnZSkgYWx3YXlzIGFzay5cIlxuICAgICAgICAgIClcbiAgICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuY29uZmlybURlbGV0aW9uKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29uZmlybURlbGV0aW9uID0gdmFsdWU7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICApXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmdHcm91cChjb250YWluZXJFbCkuc2V0SGVhZGluZyhcIlRZUC1QaWNrZXJcIikuYWRkU2V0dGluZygoc2V0dGluZykgPT5cbiAgICAgIHNldHRpbmdcbiAgICAgICAgLnNldE5hbWUoXCJTZXBhcmF0ZSBTdWJ0eXAtUGlja2VyXCIpXG4gICAgICAgIC5zZXREZXNjKFxuICAgICAgICAgIFwiQWZ0ZXIgY2hvb3NpbmcgYSBUWVAsIGNob29zZSB0aGUgU3VidHlwIGluIGEgc2Vjb25kIHBpY2tlci4gV2hlbiBvZmYsIGVhY2ggU3VidHlwIGlzIGxpc3RlZCBpbmRlbnRlZCBiZWxvdyBpdHMgVFlQLlwiXG4gICAgICAgIClcbiAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5zZXBhcmF0ZVN1YnR5cFBpY2tlcikub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5zZXBhcmF0ZVN1YnR5cFBpY2tlciA9IHZhbHVlO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfSlcbiAgICAgICAgKVxuICAgICk7XG5cbiAgICAvLyBzdWJ0eXBLZXkgKG9wdGlvbmFsKTogdHdvIGxhYmVsZWQgdG9nZ2xlcyBpbnN0ZWFkIG9mIG9uZSAtIFwiVFlQXCIgZm9yIHRoZVxuICAgIC8vIHNldHRpbmcgaXRzZWxmIGFuZCBiZWxvdyBpdCBcIlN1YnR5cFwiLCBzaG93biBvbmx5IHdoaWxlIFwiVFlQXCIgaXMgb24uIFRoZVxuICAgIC8vIGRlZmF1bHQgdG9vbHRpcHMgZml0IHRoZSBjb2xvcmluZyB0b2dnbGVzLlxuICAgIGNvbnN0IGNvbG9yVmlld1RvZ2dsZSA9IChcbiAgICAgIGdyb3VwLFxuICAgICAga2V5LFxuICAgICAgbmFtZSxcbiAgICAgIGRlc2MsXG4gICAgICBzdWJ0eXBLZXkgPSBudWxsLFxuICAgICAgeyB0eXBUb29sdGlwID0gXCJDb2xvciBieSBUWVBcIiwgc3VidHlwVG9vbHRpcCA9IFwiVXNlIFN1YnR5cCBjb2xvciBpbnN0ZWFkIG9mIFRZUCBjb2xvclwiIH0gPSB7fVxuICAgICkgPT5cbiAgICAgIGdyb3VwLmFkZFNldHRpbmcoKHNldHRpbmcpID0+IHtcbiAgICAgICAgc2V0dGluZy5zZXROYW1lKG5hbWUpLnNldERlc2MoZGVzYyk7XG4gICAgICAgIGNvbnN0IHNhdmUgPSBhc3luYyAoc2V0dGluZ0tleSwgdmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzW3NldHRpbmdLZXldID0gdmFsdWU7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgIH07XG5cbiAgICAgICAgaWYgKCFzdWJ0eXBLZXkpIHtcbiAgICAgICAgICBzZXR0aW5nLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PiB0b2dnbGUuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3c1trZXldKS5vbkNoYW5nZSgodmFsdWUpID0+IHNhdmUoa2V5LCB2YWx1ZSkpKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBzZXR0aW5nLnNldHRpbmdFbC5hZGRDbGFzcyhcInR5cC1ub3RlLXRpdGxlLXNldHRpbmdcIik7XG4gICAgICAgIGNvbnN0IGFkZFJvdyA9IChsYWJlbCwgdG9vbHRpcCwgc2V0dGluZ0tleSwgb25DaGFuZ2VkKSA9PiB7XG4gICAgICAgICAgY29uc3Qgcm93ID0gc2V0dGluZy5jb250cm9sRWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1ub3RlLXRpdGxlLXRvZ2dsZS1yb3dcIiB9KTtcbiAgICAgICAgICByb3cuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtbm90ZS10aXRsZS10b2dnbGUtbGFiZWxcIiwgdGV4dDogbGFiZWwgfSk7XG4gICAgICAgICAgbmV3IFRvZ2dsZUNvbXBvbmVudChyb3cpXG4gICAgICAgICAgICAuc2V0VG9vbHRpcCh0b29sdGlwKVxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Nbc2V0dGluZ0tleV0pXG4gICAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIGF3YWl0IHNhdmUoc2V0dGluZ0tleSwgdmFsdWUpO1xuICAgICAgICAgICAgICBvbkNoYW5nZWQ/LigpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH07XG4gICAgICAgIGFkZFJvdyhcIlRZUFwiLCB0eXBUb29sdGlwLCBrZXksICgpID0+IHRoaXMuZGlzcGxheSgpKTtcbiAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Nba2V5XSkgYWRkUm93KFwiU3VidHlwXCIsIHN1YnR5cFRvb2x0aXAsIHN1YnR5cEtleSk7XG4gICAgICB9KTtcblxuICAgIGNvbnN0IGNvbG9yaW5nR3JvdXAgPSBuZXcgU2V0dGluZ0dyb3VwKGNvbnRhaW5lckVsKS5zZXRIZWFkaW5nKFwiQ29sb3JpbmdcIik7XG5cbiAgICBjb2xvclZpZXdUb2dnbGUoY29sb3JpbmdHcm91cCwgXCJmaWxlRXhwbG9yZXJcIiwgXCJGaWxlIGV4cGxvcmVyXCIsIFwiQ29sb3Igbm90ZSBuYW1lcyBpbiB0aGUgZmlsZSBleHBsb3Jlci5cIiwgXCJmaWxlRXhwbG9yZXJTdWJ0eXBcIik7XG4gICAgY29sb3JWaWV3VG9nZ2xlKGNvbG9yaW5nR3JvdXAsIFwiZ3JhcGhcIiwgXCJHcmFwaFwiLCBcIkNvbG9yIG5vZGVzIGluIHRoZSBnbG9iYWwgYW5kIGxvY2FsIGdyYXBoLlwiLCBcImdyYXBoU3VidHlwXCIpO1xuICAgIGNvbG9yVmlld1RvZ2dsZShjb2xvcmluZ0dyb3VwLCBcInNlYXJjaFwiLCBcIlNlYXJjaFwiLCBcIkNvbG9yIHJlc3VsdCB0aXRsZXMgaW4gc2VhcmNoLlwiLCBcInNlYXJjaFN1YnR5cFwiKTtcbiAgICBjb2xvclZpZXdUb2dnbGUoY29sb3JpbmdHcm91cCwgXCJyZWNlbnRGaWxlc1wiLCBcIlJlY2VudCBGaWxlc1wiLCBcIkNvbG9yIGVudHJpZXMgaW4gdGhlIFJlY2VudCBGaWxlcyBwbHVnaW4uXCIsIFwicmVjZW50RmlsZXNTdWJ0eXBcIik7XG4gICAgY29sb3JWaWV3VG9nZ2xlKFxuICAgICAgY29sb3JpbmdHcm91cCxcbiAgICAgIFwibGlua3NcIixcbiAgICAgIFwiTGlua3MgaW4gbm90ZXNcIixcbiAgICAgIFwiQ29sb3IgaW50ZXJuYWwgbGlua3MgYnkgdGhlIFRZUCBvZiB0aGVpciB0YXJnZXQgKHJlYWRpbmcgdmlldywgTGl2ZSBQcmV2aWV3LCBob3ZlciBwcmV2aWV3KS4gVW5yZXNvbHZlZCBsaW5rcyBzdGF5IGFzIHRoZXkgYXJlLlwiLFxuICAgICAgXCJsaW5rc1N1YnR5cFwiXG4gICAgKTtcbiAgICBjb2xvclZpZXdUb2dnbGUoY29sb3JpbmdHcm91cCwgXCJ0eXBMaXN0XCIsIFwiVFlQLVBhbmVcIiwgXCJDb2xvciBuYW1lcyBpbiB0aGUgVFlQLVBhbmUgYW5kIFRZUC1QaWNrZXIuXCIsIFwidHlwTGlzdFN1YnR5cFwiKTtcbiAgICBjb2xvclZpZXdUb2dnbGUoXG4gICAgICBjb2xvcmluZ0dyb3VwLFxuICAgICAgXCJub3RlVGl0bGVDb2xvclwiLFxuICAgICAgXCJDb2xvciBub3RlIHRpdGxlXCIsXG4gICAgICBcIkNvbG9yIHRoZSBpbmxpbmUgdGl0bGUgb2YgdGhlIG9wZW4gbm90ZS5cIixcbiAgICAgIFwibm90ZVRpdGxlQ29sb3JTdWJ0eXBcIlxuICAgICk7XG5cbiAgICAvLyBQcm9ncmVzc2l2ZSBkaXNjbG9zdXJlOiBcImJhZGdlXCIgYWRkcyB0b2dnbGVzIChjb2xvciwgcG9zaXRpb24pIHRvIHRoaXNcbiAgICAvLyBvbmUgc2V0dGluZyByb3csIHBvc2l0aW9uIFwiYmxvY2tcIiBvbmUgbW9yZSAoYWxpZ25tZW50KS4gRWFjaCByZS1yZW5kZXJzXG4gICAgLy8gdmlhIGRpc3BsYXkoKSBzbyBvbmx5IHRoZSByZWxldmFudCBvbmVzIHNob3cuXG4gICAgY29uc3QgaXNCYWRnZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVN0eWxlID09PSBcImJhZGdlXCI7XG4gICAgY29uc3QgaXNCbG9ja1Bvc2l0aW9uID0gdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VQb3NpdGlvbiA9PT0gXCJibG9ja1wiO1xuXG4gICAgY29sb3JpbmdHcm91cC5hZGRTZXR0aW5nKChub3RlVGl0bGVTZXR0aW5nKSA9PiB7XG4gICAgICBub3RlVGl0bGVTZXR0aW5nXG4gICAgICAgIC5zZXROYW1lKFwiVFlQIG1hcmtlciBpbiBub3RlXCIpXG4gICAgICAgIC5zZXREZXNjKGlzQmFkZ2UgPyBcIkJhZGdlIG9wdGlvbnM6IGxhYmVsLCBjb2xvciwgcG9zaXRpb24uXCIgOiBcIkhvdyB0aGUgb3BlbiBub3RlIHNob3dzIGl0cyBUWVAuXCIpXG4gICAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XG4gICAgICAgICAgZHJvcGRvd25cbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJub25lXCIsIFwiTm9uZVwiKVxuICAgICAgICAgICAgLmFkZE9wdGlvbihcImRvdFwiLCBcIkRvdCBhdCB0aXRsZVwiKVxuICAgICAgICAgICAgLmFkZE9wdGlvbihcImJhZGdlXCIsIFwiQmFkZ2Ugd2l0aCBUWVAgbmFtZVwiKVxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVN0eWxlKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVTdHlsZSA9IHZhbHVlO1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgKTtcblxuICAgICAgLy8gXCJTdWJ0eXBcIiAoU3VidHlwIGNvbG9yIGluc3RlYWQgb2YgVFlQIGNvbG9yKSBvbmx5IHdoaWxlIHRoZSBtYXJrZXIgaXNcbiAgICAgIC8vIGNvbG9yZWQgYXQgYWxsOiBhbHdheXMgZm9yIHRoZSBkb3QsIGZvciB0aGUgYmFkZ2Ugb25seSB3aXRoIFwiQ29sb3JlZFwiXG4gICAgICAvLyBhbmQgbGFiZWwgW1RZUC9TdWJ0eXBdIC0gd2l0aCBbVFlQXSBvciBbU3VidHlwXSB0aGUgY29sb3IgZm9sbG93cyB0aGVcbiAgICAgIC8vIGxhYmVsLlxuICAgICAgY29uc3QgYmFkZ2VMYWJlbCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlTGFiZWwgPz8gXCJ0eXBcIjtcbiAgICAgIGNvbnN0IHNob3dTdWJ0eXAgPVxuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVTdHlsZSA9PT0gXCJkb3RcIiB8fFxuICAgICAgICAoaXNCYWRnZSAmJiB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUNvbG9yZWQgJiYgYmFkZ2VMYWJlbCA9PT0gXCJ0eXAtc3VidHlwXCIpO1xuICAgICAgaWYgKCFpc0JhZGdlICYmICFzaG93U3VidHlwKSByZXR1cm47XG5cbiAgICAgIC8vIFN0YWNrcyB0aGUgZXh0cmEgdG9nZ2xlcyBpbnN0ZWFkIG9mIE9ic2lkaWFuJ3Mgc2lkZS1ieS1zaWRlIGxheW91dCxcbiAgICAgIC8vIHNlZSAudHlwLW5vdGUtdGl0bGUtc2V0dGluZyBpbiBzdHlsZXMuY3NzLlxuICAgICAgbm90ZVRpdGxlU2V0dGluZy5zZXR0aW5nRWwuYWRkQ2xhc3MoXCJ0eXAtbm90ZS10aXRsZS1zZXR0aW5nXCIpO1xuXG4gICAgICAvLyBBIHNtYWxsIGxhYmVsIHBlciB0b2dnbGUgLSBhZGRUb2dnbGUoKSBhbG9uZSBhZGRzIGEgYmFyZSBzd2l0Y2guXG4gICAgICBjb25zdCBhZGRMYWJlbGVkVG9nZ2xlID0gKGxhYmVsLCB0b29sdGlwLCB2YWx1ZSwgb25DaGFuZ2UpID0+IHtcbiAgICAgICAgY29uc3Qgcm93ID0gbm90ZVRpdGxlU2V0dGluZy5jb250cm9sRWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1ub3RlLXRpdGxlLXRvZ2dsZS1yb3dcIiB9KTtcbiAgICAgICAgcm93LmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLW5vdGUtdGl0bGUtdG9nZ2xlLWxhYmVsXCIsIHRleHQ6IGxhYmVsIH0pO1xuICAgICAgICBuZXcgVG9nZ2xlQ29tcG9uZW50KHJvdykuc2V0VG9vbHRpcCh0b29sdGlwKS5zZXRWYWx1ZSh2YWx1ZSkub25DaGFuZ2Uob25DaGFuZ2UpO1xuICAgICAgfTtcblxuICAgICAgY29uc3QgYWRkU3VidHlwVG9nZ2xlID0gKGxhYmVsKSA9PlxuICAgICAgICBhZGRMYWJlbGVkVG9nZ2xlKFxuICAgICAgICAgIGxhYmVsLFxuICAgICAgICAgIFwiVXNlIFN1YnR5cCBjb2xvciBpbnN0ZWFkIG9mIFRZUCBjb2xvclwiLFxuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Mubm90ZVRpdGxlTWFya2VyU3VidHlwLFxuICAgICAgICAgIGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5ub3RlVGl0bGVNYXJrZXJTdWJ0eXAgPSB2YWx1ZTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgICAgfVxuICAgICAgICApO1xuXG4gICAgICBpZiAoIWlzQmFkZ2UpIHtcbiAgICAgICAgYWRkU3VidHlwVG9nZ2xlKFwiU3VidHlwXCIpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGxhYmVsUm93ID0gbm90ZVRpdGxlU2V0dGluZy5jb250cm9sRWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1ub3RlLXRpdGxlLXRvZ2dsZS1yb3dcIiB9KTtcbiAgICAgIGxhYmVsUm93LmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLW5vdGUtdGl0bGUtdG9nZ2xlLWxhYmVsXCIsIHRleHQ6IFwiTGFiZWxcIiB9KTtcbiAgICAgIG5ldyBEcm9wZG93bkNvbXBvbmVudChsYWJlbFJvdylcbiAgICAgICAgLmFkZE9wdGlvbihcInR5cFwiLCBcIltUWVBdXCIpXG4gICAgICAgIC5hZGRPcHRpb24oXCJ0eXAtc3VidHlwXCIsIFwiW1RZUC9TdWJ0eXBdXCIpXG4gICAgICAgIC5hZGRPcHRpb24oXCJzdWJ0eXBcIiwgXCJbU3VidHlwXVwiKVxuICAgICAgICAuc2V0VmFsdWUoYmFkZ2VMYWJlbClcbiAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlTGFiZWwgPSB2YWx1ZTtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgIGFkZExhYmVsZWRUb2dnbGUoXCJDb2xvcmVkXCIsIFwiQ29sb3JlZCBpbnN0ZWFkIG9mIG5ldXRyYWxcIiwgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VDb2xvcmVkLCBhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VDb2xvcmVkID0gdmFsdWU7XG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICB9KTtcbiAgICAgIGlmIChzaG93U3VidHlwKSBhZGRTdWJ0eXBUb2dnbGUoXCJTdWJ0eXAgY29sb3JcIik7XG5cbiAgICAgIGFkZExhYmVsZWRUb2dnbGUoXCJBdCBwcm9wZXJ0eSBibG9ja1wiLCBcIkF0IHRoZSBwcm9wZXJ0eSBibG9jayAocm90YXRlZCkgaW5zdGVhZCBvZiB0aGUgdGl0bGVcIiwgaXNCbG9ja1Bvc2l0aW9uLCBhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VQb3NpdGlvbiA9IHZhbHVlID8gXCJibG9ja1wiIDogXCJ0aXRsZVwiO1xuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgfSk7XG5cbiAgICAgIGlmIChpc0Jsb2NrUG9zaXRpb24pIHtcbiAgICAgICAgYWRkTGFiZWxlZFRvZ2dsZShcbiAgICAgICAgICBcIlRvcCBpbnN0ZWFkIG9mIGJvdHRvbVwiLFxuICAgICAgICAgIFwiVG9wIG9mIHRoZSBwcm9wZXJ0eSBibG9jayBpbnN0ZWFkIG9mIGJvdHRvbVwiLFxuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVZlcnRpY2FsQWxpZ24gPT09IFwidG9wXCIsXG4gICAgICAgICAgYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVWZXJ0aWNhbEFsaWduID0gdmFsdWUgPyBcInRvcFwiIDogXCJib3R0b21cIjtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgICAgfVxuICAgICAgICApO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29sb3JWaWV3VG9nZ2xlKFxuICAgICAgY29sb3JpbmdHcm91cCxcbiAgICAgIFwiYmFja2xpbmtzXCIsXG4gICAgICBcIkJhY2tsaW5rc1wiLFxuICAgICAgXCJDb2xvciByZXN1bHRzIGluIHRoZSBiYWNrbGlua3MgcGFuZSBhbmQgaW4gZW1iZWRkZWQgYmFja2xpbmtzLCBpbmNsdWRpbmcgdW5saW5rZWQgbWVudGlvbnMuXCIsXG4gICAgICBcImJhY2tsaW5rc1N1YnR5cFwiXG4gICAgKTtcbiAgICBjb2xvclZpZXdUb2dnbGUoY29sb3JpbmdHcm91cCwgXCJib29rbWFya3NcIiwgXCJCb29rbWFya3NcIiwgXCJDb2xvciBib29rbWFya3MgdGhhdCBwb2ludCBkaXJlY3RseSB0byBhIG5vdGUuXCIsIFwiYm9va21hcmtzU3VidHlwXCIpO1xuICAgIGNvbG9yVmlld1RvZ2dsZShcbiAgICAgIGNvbG9yaW5nR3JvdXAsXG4gICAgICBcImFsbFByb3BlcnRpZXNcIixcbiAgICAgIFwiQWxsIFByb3BlcnRpZXNcIixcbiAgICAgIFwiSW4gT2JzaWRpYW4ncyBcXFwiQWxsIHByb3BlcnRpZXNcXFwiIHZpZXcsIGNvbG9yIHByb3BlcnR5IG5hbWVzIHRoYXQgYmVsb25nIHRvIGV4YWN0bHkgb25lIFRZUC1Gcm9udG1hdHRlciwgb3IgYm9sZCB0aGVtIGlmIG1vcmUgdGhhbiBvbmUgVFlQIHVzZXMgdGhlbS4gV2l0aCBTdWJ0eXAsIFN1YnR5cCBibG9ja3MgY291bnQgYXMgd2VsbCwgaW4gdGhlIFN1YnR5cCBjb2xvci5cIixcbiAgICAgIFwiYWxsUHJvcGVydGllc1N1YnR5cFwiLFxuICAgICAgeyB0eXBUb29sdGlwOiBcIlRZUC1Gcm9udG1hdHRlclwiLCBzdWJ0eXBUb29sdGlwOiBcIkluY2x1ZGUgU3VidHlwIGJsb2NrcywgaW4gU3VidHlwIGNvbG9yXCIgfVxuICAgICk7XG5cbiAgICAvLyBMaW1pdHMgb2YgdGhlIHNsaWRlcnMgYSBTdWJ0eXAgZGVyaXZlcyBpdHMgY29sb3Igd2l0aCAoZG90IGF0IHRoZSBib3R0b21cbiAgICAvLyBvZiBhIFN1YnR5cCBibG9jaywgc2VlIHR5cC1jb2xvcnMuanMpLiBBIGxhcmdlciBzdG9yZWQgb2Zmc2V0IGlzIGNsYW1wZWRcbiAgICAvLyB0byB0aGUgbmV3IGxpbWl0LlxuICAgIGNvbnN0IHN1YnR5cENvbG9yR3JvdXAgPSBuZXcgU2V0dGluZ0dyb3VwKGNvbnRhaW5lckVsKS5zZXRIZWFkaW5nKFwiU3VidHlwIGNvbG9yc1wiKTtcbiAgICBjb25zdCByYW5nZU1heCA9IHsgaDogMTgwLCAvKiBzOiAxMDAsICovIGw6IDEwMCB9O1xuICAgIGNvbnN0IHJhbmdlRGVzYyA9IHtcbiAgICAgIGg6IFwiTWF4aW11bSBodWUgZGlmZmVyZW5jZSBiZXR3ZWVuIGEgU3VidHlwIGFuZCBpdHMgVFlQLlwiLFxuICAgICAgLy8gczogXCJNYXhpbXVtIHNoYXJlIGJ5IHdoaWNoIGEgU3VidHlwIG1heSBiZSBwYWxlciB0aGFuIGl0cyBUWVAuIE9ubHkgZ29lcyBkb3duIC0gYSBTdWJ0eXAgc2hvdWxkbid0IGJlIGxvdWRlciB0aGFuIGl0cyBUWVAuXCIsXG4gICAgICBsOiBcIk1heGltdW0gbGlnaHRuZXNzIGRpZmZlcmVuY2UgYmV0d2VlbiBhIFN1YnR5cCBhbmQgaXRzIFRZUCwgYXMgYSBzaGFyZSBvZiB0aGUgd2F5IHRvIHdoaXRlIG9yIGJsYWNrLlwiLFxuICAgIH07XG4gICAgLy8gVGhlIHNsaWRlciByZXBvcnRzIGV2ZXJ5IHN0ZXA7IHRoZSBvdGhlciB2aWV3cyBvbmx5IGZvbGxvdyBvbmNlIGl0IHJlc3RzLlxuICAgIGNvbnN0IHJlZnJlc2hDb2xvcnNTb29uID0gZGVib3VuY2UoKCkgPT4gdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCksIDMwMCwgdHJ1ZSk7XG4gICAgZm9yIChjb25zdCB7IGtleSwgbGFiZWwsIHVuaXQsIGRvd25Pbmx5IH0gb2YgU1VCVFlQX0NPTE9SX0NIQU5ORUxTKSB7XG4gICAgICBzdWJ0eXBDb2xvckdyb3VwLmFkZFNldHRpbmcoKHNldHRpbmcpID0+XG4gICAgICAgIHNldHRpbmdcbiAgICAgICAgICAuc2V0TmFtZShgJHtsYWJlbH0gKCR7ZG93bk9ubHkgPyBcIlx1MjIxMlwiIDogXCJcdTAwQjFcIn0gJHt1bml0fSlgKVxuICAgICAgICAgIC5zZXREZXNjKHJhbmdlRGVzY1trZXldKVxuICAgICAgICAgIC5hZGRTbGlkZXIoKHNsaWRlcikgPT5cbiAgICAgICAgICAgIHNsaWRlclxuICAgICAgICAgICAgICAuc2V0TGltaXRzKDAsIHJhbmdlTWF4W2tleV0sIDEpXG4gICAgICAgICAgICAgIC5zZXRWYWx1ZShjb2xvclJhbmdlKHRoaXMucGx1Z2luLnNldHRpbmdzLCBrZXkpKVxuICAgICAgICAgICAgICAuc2V0RHluYW1pY1Rvb2x0aXAoKVxuICAgICAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Muc3VidHlwQ29sb3JSYW5nZXMgPSB7IC4uLkRFRkFVTFRfU1VCVFlQX0NPTE9SX1JBTkdFUywgLi4udGhpcy5wbHVnaW4uc2V0dGluZ3Muc3VidHlwQ29sb3JSYW5nZXMsIFtrZXldOiB2YWx1ZSB9O1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgICAgIHJlZnJlc2hDb2xvcnNTb29uKCk7XG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgKVxuICAgICAgICAgIC5hZGRFeHRyYUJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICAgICAgYnV0dG9uXG4gICAgICAgICAgICAgIC5zZXRJY29uKFwicm90YXRlLWNjd1wiKVxuICAgICAgICAgICAgICAuc2V0VG9vbHRpcChgUmVzZXQgdG8gJHtERUZBVUxUX1NVQlRZUF9DT0xPUl9SQU5HRVNba2V5XX1gKVxuICAgICAgICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Muc3VidHlwQ29sb3JSYW5nZXMgPSB7IC4uLkRFRkFVTFRfU1VCVFlQX0NPTE9SX1JBTkdFUywgLi4udGhpcy5wbHVnaW4uc2V0dGluZ3Muc3VidHlwQ29sb3JSYW5nZXMsIFtrZXldOiBERUZBVUxUX1NVQlRZUF9DT0xPUl9SQU5HRVNba2V5XSB9O1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICAgICAgICB9KVxuICAgICAgICAgIClcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gR3JvdXAgXCJHcmFwaFwiICh0YWcvYXR0YWNobWVudCBjb2xvcnMpIGRpc2FibGVkICgyMDI2LTA5LTMwKTogdGhlIE1pbmltYWxcbiAgICAvLyB0aGVtZSdzIFN0eWxlIFNldHRpbmdzIGNvdmVyIGJvdGgsIHNlZSBncmFwaC1jb2xvcnMuanMuIENvbG9yaW5nIG5vdGVcbiAgICAvLyBub2RlcyBieSBUWVAgc3RheXMsIHVuZGVyIFwiQ29sb3JpbmdcIiBcdTIxOTIgXCJHcmFwaFwiLlxuICAgIC8vICAgICBjb25zdCBncmFwaEdyb3VwID0gbmV3IFNldHRpbmdHcm91cChjb250YWluZXJFbCkuc2V0SGVhZGluZyhcIkdyYXBoXCIpO1xuICAgIC8vXG4gICAgLy8gICAgIC8vIE9uZSBzZXR0aW5nIHBlciBub2RlIGtpbmQgdGhlIGdyYXBoIGVuZ2luZSBrbm93cywgc2FtZSBsYXlvdXRcbiAgICAvLyAgICAgLy8gKHRvZ2dsZSArIGNvbG9yIHBpY2tlciArIHJlc2V0KSBmb3IgZWFjaC5cbiAgICAvLyAgICAgY29uc3QgZ3JhcGhDb2xvclNldHRpbmcgPSAoZW5hYmxlZEtleSwgY29sb3JLZXksIGRlZmF1bHRDb2xvciwgbmFtZSwgZGVzYykgPT5cbiAgICAvLyAgICAgICBncmFwaEdyb3VwLmFkZFNldHRpbmcoKHNldHRpbmcpID0+XG4gICAgLy8gICAgICAgICBzZXR0aW5nXG4gICAgLy8gICAgICAgICAgIC5zZXROYW1lKG5hbWUpXG4gICAgLy8gICAgICAgICAgIC5zZXREZXNjKGRlc2MpXG4gICAgLy8gICAgICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAvLyAgICAgICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3NbZW5hYmxlZEtleV0pLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgIC8vICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3NbZW5hYmxlZEtleV0gPSB2YWx1ZTtcbiAgICAvLyAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgIC8vICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgLy8gICAgICAgICAgICAgfSlcbiAgICAvLyAgICAgICAgICAgKVxuICAgIC8vICAgICAgICAgICAuYWRkQ29sb3JQaWNrZXIoKHBpY2tlcikgPT5cbiAgICAvLyAgICAgICAgICAgICBwaWNrZXIuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3NbY29sb3JLZXldIHx8IGRlZmF1bHRDb2xvcikub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgLy8gICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5nc1tjb2xvcktleV0gPSB2YWx1ZTtcbiAgICAvLyAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgIC8vICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgLy8gICAgICAgICAgICAgfSlcbiAgICAvLyAgICAgICAgICAgKVxuICAgIC8vICAgICAgICAgICAuYWRkRXh0cmFCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAvLyAgICAgICAgICAgICBidXR0b25cbiAgICAvLyAgICAgICAgICAgICAgIC5zZXRJY29uKFwicm90YXRlLWNjd1wiKVxuICAgIC8vICAgICAgICAgICAgICAgLnNldFRvb2x0aXAoXCJSZXNldCB0byBkZWZhdWx0IGNvbG9yXCIpXG4gICAgLy8gICAgICAgICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgLy8gICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzW2NvbG9yS2V5XSA9IFwiXCI7XG4gICAgLy8gICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgIC8vICAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAvLyAgICAgICAgICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgLy8gICAgICAgICAgICAgICB9KVxuICAgIC8vICAgICAgICAgICApXG4gICAgLy8gICAgICAgKTtcbiAgICAvL1xuICAgIC8vICAgICBncmFwaENvbG9yU2V0dGluZyhcbiAgICAvLyAgICAgICBcImdyYXBoVGFnQ29sb3JFbmFibGVkXCIsXG4gICAgLy8gICAgICAgXCJncmFwaFRhZ0NvbG9yXCIsXG4gICAgLy8gICAgICAgXCIjODg4ODg4XCIsXG4gICAgLy8gICAgICAgXCJUYWcgY29sb3JcIixcbiAgICAvLyAgICAgICBcIk93biBjb2xvciBmb3IgdGFnIG5vZGVzIGluIHRoZSBnbG9iYWwgYW5kIGxvY2FsIGdyYXBoLiBDb2xvciBncm91cHMgc3RpbGwgdGFrZSBwcmVjZWRlbmNlLlwiXG4gICAgLy8gICAgICk7XG4gICAgLy8gICAgIGdyYXBoQ29sb3JTZXR0aW5nKFxuICAgIC8vICAgICAgIFwiZ3JhcGhBdHRhY2htZW50Q29sb3JFbmFibGVkXCIsXG4gICAgLy8gICAgICAgXCJncmFwaEF0dGFjaG1lbnRDb2xvclwiLFxuICAgIC8vICAgICAgIFwiI2UwYWMwMFwiLFxuICAgIC8vICAgICAgIFwiQXR0YWNobWVudCBjb2xvclwiLFxuICAgIC8vICAgICAgIFwiT3duIGNvbG9yIGZvciBhdHRhY2htZW50IG5vZGVzIChub24tbWFya2Rvd24gZmlsZXMgc3VjaCBhcyBpbWFnZXMgb3IgUERGcykgaW4gdGhlIGdyYXBoLlwiXG4gICAgLy8gICAgICk7XG5cbiAgICBjb25zdCBmcm9udG1hdHRlckdyb3VwID0gbmV3IFNldHRpbmdHcm91cChjb250YWluZXJFbCkuc2V0SGVhZGluZyhcIlRZUC1Gcm9udG1hdHRlclwiKTtcblxuICAgIGNvbG9yVmlld1RvZ2dsZShcbiAgICAgIGZyb250bWF0dGVyR3JvdXAsXG4gICAgICBcImZyb250bWF0dGVyRGVmYXVsdHNcIixcbiAgICAgIFwiQm9sZCBUWVAgcHJvcGVydGllc1wiLFxuICAgICAgXCJTaG93IFRZUC1Gcm9udG1hdHRlciBwcm9wZXJ0eSBuYW1lcyBpbiBib2xkIGluIG5vdGVzIGFuZCB0aGUgcHJvcGVydGllcyBzaWRlYmFyLiBXaXRoIFN1YnR5cCwgdGhlIG5vdGUncyBTdWJ0eXAgYmxvY2sgY291bnRzIGFzIHdlbGwuXCIsXG4gICAgICBcImZyb250bWF0dGVyRGVmYXVsdHNTdWJ0eXBcIixcbiAgICAgIHsgdHlwVG9vbHRpcDogXCJUWVAtRnJvbnRtYXR0ZXJcIiwgc3VidHlwVG9vbHRpcDogXCJJbmNsdWRlIFN1YnR5cCBibG9ja3NcIiB9XG4gICAgKTtcblxuICAgIC8vIFRoZSBvcmRlciBlZGl0b3IgYnJpbmdzIGl0cyBvd24gaGVhZGluZyBhbmQgYnV0dG9ucywgc28gaXQgZ29lcyBzdHJhaWdodFxuICAgIC8vIGludG8gaW5mb0VsIGluc3RlYWQgb2Ygc2V0TmFtZS9zZXREZXNjIChzZWUgLnR5cC1vcmRlci1zZXR0aW5nKS5cbiAgICBmcm9udG1hdHRlckdyb3VwLmFkZFNldHRpbmcoKHNldHRpbmcpID0+IHtcbiAgICAgIHNldHRpbmcuc2V0dGluZ0VsLmFkZENsYXNzKFwidHlwLW9yZGVyLXNldHRpbmdcIik7XG4gICAgICBtb3VudEdsb2JhbE9yZGVyRWRpdG9yKHNldHRpbmcuaW5mb0VsLCB0aGlzLnBsdWdpbik7XG4gICAgICBzZXR0aW5nLmluZm9FbC5jcmVhdGVEaXYoe1xuICAgICAgICBjbHM6IFwic2V0dGluZy1pdGVtLWRlc2NyaXB0aW9uXCIsXG4gICAgICAgIHRleHQ6XG4gICAgICAgICAgJ09yZGVyIGFwcGxpZWQgYnkgdGhlIFwiU29ydCBmcm9udG1hdHRlclwiIGNvbW1hbmRzOyB2YWx1ZXMgYXJlIG5ldmVyIGNoYW5nZWQuIFBpbiBzaW5nbGUgcHJvcGVydGllcyBzdWNoIGFzIGNzc2NsYXNzZXMgb3IgYWxpYXNlcy4gVFlQIGFuZCBTVUJUWVAgYXJlIHRoZSBwcm9wZXJ0aWVzIHRoZW1zZWx2ZXMsIFwiVFlQLUZyb250bWF0dGVyXCIgaXMgdGhlIFRZUFxcJ3MgbGlzdCBmb2xsb3dlZCBieSBpdHMgU3VidHlwIGJsb2NrLCBcIk90aGVyIHByb3BlcnRpZXNcIiBpcyBldmVyeXRoaW5nIGVsc2UuIERyYWcgdG8gcmVvcmRlcjsgdGhlIGZvdXIgcGxhY2Vob2xkZXIgcm93cyBjYW5cXCd0IGJlIHJlbW92ZWQuJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgY29udGFpbmVyRWwuc2Nyb2xsVG9wID0gc2Nyb2xsVG9wO1xuICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBERUZBVUxUX1NFVFRJTkdTLCBUeXBTeXN0ZW1TZXR0aW5nVGFiIH07XG4iLCAiY29uc3QgeyBNb2RhbCwgU2V0dGluZyB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBwbHVyYWwgfSA9IHJlcXVpcmUoXCIuL3R5cC11dGlsc1wiKTtcblxuLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gKiBUaGUgdHdvIGRpYWxvZ3Mgb2YgdGhlIEJhc2UgY29tbWFuZHMgKHNlZSBiYXNlcy5qcyk6XG4gKiAgLSBjb2x1bW4gb3B0aW9ucyBiZWZvcmUgY3JlYXRpbmcvdXBkYXRpbmdcbiAqICAtIGNvbmZpcm1pbmcgcmVtb3ZhbHMgd2hlbiB1cGRhdGluZ1xuICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovXG5cbmNvbnN0IE5PVEVfUFJFRklYID0gXCJub3RlLlwiO1xuXG4vLyBDb2x1bW4gbGFiZWw6IHRoZSBzaG9ydCBmb3JtIHRoZSBwcm9wZXJ0eSBoYXMgaW4gdGhlIC5iYXNlIGZpbGVcbi8vIChcIlRpdGVsXCIgaW5zdGVhZCBvZiBcIm5vdGUuVGl0ZWxcIikuXG5mdW5jdGlvbiBjb2x1bW5MYWJlbChpZCkge1xuICByZXR1cm4gaWQuc3RhcnRzV2l0aChOT1RFX1BSRUZJWCkgPyBpZC5zbGljZShOT1RFX1BSRUZJWC5sZW5ndGgpIDogaWQ7XG59XG5cbmZ1bmN0aW9uIHRhcmdldExhYmVsKHRhcmdldCkge1xuICBpZiAoIXRhcmdldC50eXApIHJldHVybiBgU3VidHlwICR7dGFyZ2V0LnN1YnR5cH1gO1xuICByZXR1cm4gdGFyZ2V0LnN1YnR5cCA/IGAke3RhcmdldC50eXB9IC8gJHt0YXJnZXQuc3VidHlwfWAgOiBgVFlQICR7dGFyZ2V0LnR5cH1gO1xufVxuXG4vKiAtLS0gQ29sdW1uIG9wdGlvbnMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbi8vIFRocmVlIHRvZ2dsZXMsIGFsbCBvZmYgYnkgZGVmYXVsdCAoZmlsZS5uYW1lIHBsdXMgVFlQLUZyb250bWF0dGVyIGlzIHRoZVxuLy8gbm9ybWFsIGNhc2UpLCB3aXRoIGEgbGl2ZSBwcmV2aWV3IG9mIHRoZSByZXN1bHRpbmcgY29sdW1ucyBzbyBhIHRvZ2dsZSdzXG4vLyBlZmZlY3QgbmVlZG4ndCBiZSBndWVzc2VkLiBcIkFsbCBTdWJ0eXAgcHJvcGVydGllc1wiIG9ubHkgc2hvd3MgZm9yIGEgVFlQXG4vLyB0YXJnZXQ6IGluIGEgU3VidHlwIHZpZXcgdGhlIG90aGVyIFN1YnR5cCBibG9ja3Mgd291bGQgc3RheSBlbXB0eS5cbmNsYXNzIENvbHVtbk9wdGlvbnNNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgY29uc3RydWN0b3IocGx1Z2luLCB0YXJnZXQsIHByZXZpZXcsIHJlc29sdmUpIHtcbiAgICBzdXBlcihwbHVnaW4uYXBwKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgICB0aGlzLnRhcmdldCA9IHRhcmdldDtcbiAgICB0aGlzLnByZXZpZXcgPSBwcmV2aWV3O1xuICAgIHRoaXMucmVzb2x2ZSA9IHJlc29sdmU7XG4gICAgdGhpcy5vcHRpb25zID0geyBmbG9hdGluZzogZmFsc2UsIGFsbFN1YnR5cHM6IGZhbHNlLCB0YWdzOiBmYWxzZSB9O1xuICAgIHRoaXMuY29uZmlybWVkID0gZmFsc2U7XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgdGhpcy5tb2RhbEVsLmFkZENsYXNzKFwidHlwLWJhc2Utb3B0aW9ucy1tb2RhbFwiKTtcbiAgICB0aGlzLnRpdGxlRWwuc2V0VGV4dChgQ29sdW1ucyBmb3IgJHt0YXJnZXRMYWJlbCh0aGlzLnRhcmdldCl9YCk7XG5cbiAgICBjb25zdCB0b2dnbGUgPSAobmFtZSwgZGVzY3JpcHRpb24sIGtleSkgPT4ge1xuICAgICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgICAuc2V0TmFtZShuYW1lKVxuICAgICAgICAuc2V0RGVzYyhkZXNjcmlwdGlvbilcbiAgICAgICAgLmFkZFRvZ2dsZSgoY29udHJvbCkgPT5cbiAgICAgICAgICBjb250cm9sLnNldFZhbHVlKHRoaXMub3B0aW9uc1trZXldKS5vbkNoYW5nZSgodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMub3B0aW9uc1trZXldID0gdmFsdWU7XG4gICAgICAgICAgICB0aGlzLnJlbmRlclByZXZpZXcoKTtcbiAgICAgICAgICB9KVxuICAgICAgICApO1xuICAgIH07XG5cbiAgICB0b2dnbGUoXCJGbG9hdGluZyBwcm9wZXJ0aWVzXCIsIFwiSW5jbHVkZSB0aGUgYmxvY2sncyBmbG9hdGluZyAoaXRhbGljKSBwcm9wZXJ0aWVzLlwiLCBcImZsb2F0aW5nXCIpO1xuICAgIGlmICghdGhpcy50YXJnZXQuc3VidHlwKSB7XG4gICAgICB0b2dnbGUoXCJBbGwgU3VidHlwIHByb3BlcnRpZXNcIiwgXCJBbHNvIGluY2x1ZGUgdGhlIHByb3BlcnRpZXMgb2YgZXZlcnkgU3VidHlwIGJsb2NrIG9mIHRoaXMgVFlQLlwiLCBcImFsbFN1YnR5cHNcIik7XG4gICAgfVxuICAgIHRvZ2dsZShcInRhZ3NcIiwgXCJBZGQgdGhlIHRhZ3MgcHJvcGVydHkgYXMgYSBjb2x1bW4uXCIsIFwidGFnc1wiKTtcblxuICAgIHRoaXMucHJldmlld0VsID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtYmFzZS1wcmV2aWV3XCIgfSk7XG4gICAgdGhpcy5yZW5kZXJQcmV2aWV3KCk7XG5cbiAgICBjb25zdCBidXR0b25Sb3cgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcIm1vZGFsLWJ1dHRvbi1jb250YWluZXJcIiB9KTtcbiAgICBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkNhbmNlbFwiIH0pLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xuICAgIGNvbnN0IGNvbmZpcm0gPSBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IFwibW9kLWN0YVwiLCB0ZXh0OiBcIkFwcGx5XCIgfSk7XG4gICAgY29uZmlybS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5jb25maXJtZWQgPSB0cnVlO1xuICAgICAgdGhpcy5jbG9zZSgpO1xuICAgIH0pO1xuICB9XG5cbiAgcmVuZGVyUHJldmlldygpIHtcbiAgICBjb25zdCBpZHMgPSB0aGlzLnByZXZpZXcodGhpcy5vcHRpb25zKTtcbiAgICB0aGlzLnByZXZpZXdFbC5lbXB0eSgpO1xuICAgIHRoaXMucHJldmlld0VsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtYmFzZS1wcmV2aWV3LXRpdGxlXCIsIHRleHQ6IHBsdXJhbChpZHMubGVuZ3RoLCBcImNvbHVtblwiKSB9KTtcbiAgICBjb25zdCBsaXN0ID0gdGhpcy5wcmV2aWV3RWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1iYXNlLXByZXZpZXctbGlzdFwiIH0pO1xuICAgIGZvciAoY29uc3QgaWQgb2YgaWRzKSBsaXN0LmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLWJhc2UtcHJldmlldy1jb2x1bW5cIiwgdGV4dDogY29sdW1uTGFiZWwoaWQpIH0pO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIC8vIEVTQyBvciBhIGNsaWNrIG91dHNpZGUgY291bnRzIGFzIGNhbmNlbC5cbiAgICB0aGlzLnJlc29sdmUodGhpcy5jb25maXJtZWQgPyB0aGlzLm9wdGlvbnMgOiBudWxsKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBhc2tDb2x1bW5PcHRpb25zKHBsdWdpbiwgdGFyZ2V0LCBwcmV2aWV3KSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gbmV3IENvbHVtbk9wdGlvbnNNb2RhbChwbHVnaW4sIHRhcmdldCwgcHJldmlldywgcmVzb2x2ZSkub3BlbigpKTtcbn1cblxuLyogLS0tIENvbmZpcm0gcmVtb3ZhbHMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuXG4vLyBBZGRpbmcgYW5kIHJlb3JkZXJpbmcgY29sdW1ucyBoYXBwZW4gc2lsZW50bHk7IG9ubHkgcmVtb3ZpbmcgaXMgc2hvd24sXG4vLyBiZWNhdXNlIG9ubHkgdGhhdCBsb3NlcyBzb21ldGhpbmcuIEV2ZXJ5IGVudHJ5IHN0YXJ0cyBjaGVja2VkOyBhbiB1bmNoZWNrZWRcbi8vIGNvbHVtbiBpcyBrZXB0IChhdCB0aGUgZnJvbnQsIHNlZSB1cGRhdGVBY3RpdmVWaWV3KS5cbmNsYXNzIFJlbW92YWxNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgY29uc3RydWN0b3IocGx1Z2luLCBjb2x1bW5zLCB2aWV3TmFtZSwgcmVzb2x2ZSkge1xuICAgIHN1cGVyKHBsdWdpbi5hcHApO1xuICAgIHRoaXMuY29sdW1ucyA9IGNvbHVtbnM7XG4gICAgdGhpcy52aWV3TmFtZSA9IHZpZXdOYW1lO1xuICAgIHRoaXMucmVzb2x2ZSA9IHJlc29sdmU7XG4gICAgdGhpcy5tYXJrZWQgPSBuZXcgU2V0KGNvbHVtbnMpO1xuICAgIHRoaXMuY29uZmlybWVkID0gZmFsc2U7XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgdGhpcy5tb2RhbEVsLmFkZENsYXNzKFwidHlwLWJhc2UtcmVtb3ZhbC1tb2RhbFwiKTtcbiAgICB0aGlzLnRpdGxlRWwuc2V0VGV4dChgUmVtb3ZlIGNvbHVtbnMgZnJvbSBcIiR7dGhpcy52aWV3TmFtZX1cImApO1xuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgY2xzOiBcInR5cC1iYXNlLXJlbW92YWwtaW50cm9cIixcbiAgICAgIHRleHQ6IFwiVGhlc2UgY29sdW1ucyBkb24ndCBiZWxvbmcgdG8gdGhlIFRZUC4gVW5jaGVja2VkIG9uZXMgYXJlIGtlcHQuXCIsXG4gICAgfSk7XG5cbiAgICBmb3IgKGNvbnN0IGlkIG9mIHRoaXMuY29sdW1ucykge1xuICAgICAgbmV3IFNldHRpbmcoY29udGVudEVsKS5zZXROYW1lKGNvbHVtbkxhYmVsKGlkKSkuYWRkVG9nZ2xlKChjb250cm9sKSA9PlxuICAgICAgICBjb250cm9sLnNldFZhbHVlKHRydWUpLm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGlmICh2YWx1ZSkgdGhpcy5tYXJrZWQuYWRkKGlkKTtcbiAgICAgICAgICBlbHNlIHRoaXMubWFya2VkLmRlbGV0ZShpZCk7XG4gICAgICAgIH0pXG4gICAgICApO1xuICAgIH1cblxuICAgIGNvbnN0IGJ1dHRvblJvdyA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibW9kYWwtYnV0dG9uLWNvbnRhaW5lclwiIH0pO1xuICAgIGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiQ2FuY2VsXCIgfSkuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY2xvc2UoKSk7XG4gICAgY29uc3QgY29uZmlybSA9IGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IGNsczogXCJtb2QtY3RhXCIsIHRleHQ6IFwiQXBwbHlcIiB9KTtcbiAgICBjb25maXJtLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICB0aGlzLmNvbmZpcm1lZCA9IHRydWU7XG4gICAgICB0aGlzLmNsb3NlKCk7XG4gICAgfSk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gICAgdGhpcy5yZXNvbHZlKHRoaXMuY29uZmlybWVkID8gdGhpcy5tYXJrZWQgOiBudWxsKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBhc2tSZW1vdmFscyhwbHVnaW4sIGNvbHVtbnMsIHZpZXdOYW1lKSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gbmV3IFJlbW92YWxNb2RhbChwbHVnaW4sIGNvbHVtbnMsIHZpZXdOYW1lLCByZXNvbHZlKS5vcGVuKCkpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgYXNrQ29sdW1uT3B0aW9ucywgYXNrUmVtb3ZhbHMgfTtcbiIsICJjb25zdCB7IE5vdGljZSwgVEZpbGUsIHN0cmluZ2lmeVlhbWwgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgZ2V0U3VidHlwTmFtZXMgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cHNcIik7XG5jb25zdCB7IG5vcm1hbGl6ZUdsb2JhbE9yZGVyLCBUWVBfUFJPUEVSVFksIFNVQlRZUF9QUk9QRVJUWSB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItc29ydFwiKTtcbmNvbnN0IHsgYXNrQ29sdW1uT3B0aW9ucywgYXNrUmVtb3ZhbHMgfSA9IHJlcXVpcmUoXCIuL2Jhc2UtZGlhbG9nc1wiKTtcbmNvbnN0IHsgcGx1cmFsIH0gPSByZXF1aXJlKFwiLi90eXAtdXRpbHNcIik7XG5cbi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICogQmFzZXMgZnJvbSBhIFRZUFxuICogQ3JlYXRlcyBhIC5iYXNlIGluIHRoZSB2YXVsdCByb290IGZvciBhIFRZUCAob3IgYSBTdWJ0eXAgbmFtZSk6XG4gKiBhIFRZUCBmaWx0ZXIsIG9uZSB0YWJsZSB2aWV3IHBlciBTdWJ0eXAsIGFuZCBjb2x1bW5zIGZyb20gdGhlXG4gKiBUWVAtRnJvbnRtYXR0ZXIgcGx1cyB0aGUgZ2xvYmFsIHByb3BlcnR5IG9yZGVyLiBUaGUgc2Vjb25kXG4gKiBjb21tYW5kIGJyaW5ncyB0aGUgY29sdW1ucyBvZiBhbiBleGlzdGluZyB2aWV3IHVwIHRvIGRhdGUuXG4gKlxuICogV3JpdGVzIG9ubHkgdGhyb3VnaCBPYnNpZGlhbidzIG93biBCYXNlcyBBUEkgYW5kIHNlcmlhbGl6YXRpb25cbiAqIChzZWUgYXBwZW5kVmlld3MpLCBuZXZlciB0aHJvdWdoIHNlbGYtcGFyc2VkIFlBTUwgLSBmb3JtdWxhXG4gKiBibG9ja3MgYW5kIHNwZWNpYWwga2V5cyB3b3VsZG4ndCByZWxpYWJseSBzdXJ2aXZlIHRoZSByb3VuZCB0cmlwLlxuICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovXG5cbi8vIFZpZXcgcHJvcGVydHkgaWRzIGFyZSBmdWxseSBxdWFsaWZpZWQgaW4gbWVtb3J5IChcIm5vdGUuVGl0ZWxcIiwgXCJmaWxlLm5hbWVcIixcbi8vIFwiZm9ybXVsYS5YXCIpIGJ1dCBzdG9yZWQgd2l0aG91dCBcIm5vdGUuXCIgaW4gdGhlIGZpbGUuIGNmZy5zZXRPcmRlcigpIHdhbnRzXG4vLyB0aGUgcXVhbGlmaWVkIGZvcm0sIGEgdmlldyBvYmplY3QgYnVpbHQgZm9yIHRoZSBmaWxlIHRoZSBzaG9ydCBvbmUgLVxuLy8gc2VyaWFsaXplSWQoKSBjb252ZXJ0cy5cbmNvbnN0IEZJTEVfTkFNRV9JRCA9IFwiZmlsZS5uYW1lXCI7XG5jb25zdCBOT1RFX1BSRUZJWCA9IFwibm90ZS5cIjtcbmNvbnN0IFRBR1NfUFJPUEVSVFkgPSBcInRhZ3NcIjtcbmNvbnN0IEJBU0VfRVhURU5TSU9OID0gXCJiYXNlXCI7XG5cbmZ1bmN0aW9uIG5vdGVJZChrZXkpIHtcbiAgcmV0dXJuIE5PVEVfUFJFRklYICsga2V5O1xufVxuXG5mdW5jdGlvbiBzZXJpYWxpemVJZChpZCkge1xuICByZXR1cm4gaWQuc3RhcnRzV2l0aChOT1RFX1BSRUZJWCkgPyBpZC5zbGljZShOT1RFX1BSRUZJWC5sZW5ndGgpIDogaWQ7XG59XG5cbmZ1bmN0aW9uIHNhbWVJZChhLCBiKSB7XG4gIHJldHVybiBhLnRvTG93ZXJDYXNlKCkgPT09IGIudG9Mb3dlckNhc2UoKTtcbn1cblxuLy8gQSBmaWx0ZXIgZXhwcmVzc2lvbiB0aGUgd2F5IEJhc2VzIHdyaXRlcyBpdDogVFlQID09IFwiTUVESUFcIi4gSlNPTi5zdHJpbmdpZnlcbi8vIHF1b3RlcyBjb3JyZWN0bHkgZXZlbiBpZiB0aGUgbmFtZSBjb250YWlucyBhIHF1b3RlLlxuZnVuY3Rpb24gZXF1YWxzRmlsdGVyKHByb3BlcnR5LCB2YWx1ZSkge1xuICByZXR1cm4gYCR7cHJvcGVydHl9ID09ICR7SlNPTi5zdHJpbmdpZnkoU3RyaW5nKHZhbHVlKSl9YDtcbn1cblxuLyogLS0tIFJlYWRpbmcgVFlQL1N1YnR5cCBmcm9tIGFuIGV4aXN0aW5nIGZpbHRlciAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICogQSBnZW5lcmF0ZWQgdmlldyBjYXJyaWVzIGl0cyBUWVAgaW4gdGhlIHJvb3Qgb3IgdmlldyBmaWx0ZXI7IHRoZSB1cGRhdGVcbiAqIGNvbW1hbmQgcmVhZHMgaXQgZnJvbSB0aGVyZSBpbnN0ZWFkIG9mIGFza2luZy4gT25seSB1bmFtYmlndW91cyBmaWx0ZXJzXG4gKiBjb3VudDogYSBwdXJlIEFORCB3aXRoIGV4YWN0bHkgb25lIFRZUCBvciBTVUJUWVAgY29tcGFyaXNvbi4gQW4gT1IgZ3JvdXBcbiAqIGRvZXNuJ3QgbmVjZXNzYXJpbHkgcmVzdHJpY3QsIGFuZCBhIHNlY29uZCwgZGlmZmVyZW50IHZhbHVlIGNvbnRyYWRpY3RzIC1cbiAqIGJvdGggZ2l2ZSBudWxsIGFuZCB0aGUgY29tbWFuZCBhc2tzIGluc3RlYWQgKHNlZSB1cGRhdGVBY3RpdmVWaWV3KS5cbiAqIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuY29uc3QgRVFVQUxTX1BBVFRFUk4gPSBuZXcgUmVnRXhwKGBeXFxcXHMqKCR7VFlQX1BST1BFUlRZfXwke1NVQlRZUF9QUk9QRVJUWX0pXFxcXHMqPT1cXFxccyooLis/KVxcXFxzKiRgLCBcImlcIik7XG5cbmZ1bmN0aW9uIGZpbHRlckxpdGVyYWwocmF3KSB7XG4gIGlmIChyYXcubGVuZ3RoID49IDIgJiYgcmF3WzBdID09PSAnXCInICYmIHJhdy5lbmRzV2l0aCgnXCInKSkge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gSlNPTi5wYXJzZShyYXcpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICB9XG4gIGlmIChyYXcubGVuZ3RoID49IDIgJiYgcmF3WzBdID09PSBcIidcIiAmJiByYXcuZW5kc1dpdGgoXCInXCIpKSByZXR1cm4gcmF3LnNsaWNlKDEsIC0xKTtcbiAgcmV0dXJuIG51bGw7XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RFcXVhbHMobm9kZSwgZm91bmQpIHtcbiAgaWYgKCFub2RlKSByZXR1cm47XG4gIGlmICh0eXBlb2Ygbm9kZSA9PT0gXCJzdHJpbmdcIikge1xuICAgIGNvbnN0IG1hdGNoID0gRVFVQUxTX1BBVFRFUk4uZXhlYyhub2RlKTtcbiAgICBpZiAoIW1hdGNoKSByZXR1cm47XG4gICAgY29uc3QgdmFsdWUgPSBmaWx0ZXJMaXRlcmFsKG1hdGNoWzJdKTtcbiAgICBpZiAodmFsdWUgIT09IG51bGwpIGZvdW5kW21hdGNoWzFdLnRvVXBwZXJDYXNlKCldLmFkZCh2YWx1ZSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChBcnJheS5pc0FycmF5KG5vZGUpKSB7XG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBub2RlKSBjb2xsZWN0RXF1YWxzKGVudHJ5LCBmb3VuZCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIEFORCBvbmx5OiBhbiBPUi9OT1QgZ3JvdXAgc2F5cyBub3RoaW5nIHJlbGlhYmxlIGFib3V0IHRoZSBUWVAgb2YgdGhlIGhpdHMuXG4gIGlmIChub2RlLmFuZCkgY29sbGVjdEVxdWFscyhub2RlLmFuZCwgZm91bmQpO1xufVxuXG5mdW5jdGlvbiByZWFkVGFyZ2V0KC4uLmZpbHRlckdyb3Vwcykge1xuICBjb25zdCBmb3VuZCA9IHsgW1RZUF9QUk9QRVJUWV06IG5ldyBTZXQoKSwgW1NVQlRZUF9QUk9QRVJUWV06IG5ldyBTZXQoKSB9O1xuICBmb3IgKGNvbnN0IGdyb3VwIG9mIGZpbHRlckdyb3VwcykgY29sbGVjdEVxdWFscyhncm91cCwgZm91bmQpO1xuICBjb25zdCB0eXBzID0gWy4uLmZvdW5kW1RZUF9QUk9QRVJUWV1dO1xuICBjb25zdCBzdWJ0eXBzID0gWy4uLmZvdW5kW1NVQlRZUF9QUk9QRVJUWV1dO1xuICBpZiAodHlwcy5sZW5ndGggPiAxIHx8IHN1YnR5cHMubGVuZ3RoID4gMSkgcmV0dXJuIG51bGw7XG4gIGlmICh0eXBzLmxlbmd0aCA9PT0gMCAmJiBzdWJ0eXBzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IHR5cDogdHlwc1swXSA/PyBudWxsLCBzdWJ0eXA6IHN1YnR5cHNbMF0gPz8gbnVsbCB9O1xufVxuXG4vKiAtLS0gQ29sdW1ucyBvZiBhIHRhcmdldCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbi8vIFRZUCBhbmQgU1VCVFlQIG5ldmVyIGJlY29tZSBjb2x1bW5zIChmaWx0ZXIgYW5kIGdyb3VwaW5nIGFscmVhZHkgc2hvd1xuLy8gdGhlbSksIG5vciBkb2VzIHRoZSBlZGl0b3IncyBibGFuayByb3cuXG5mdW5jdGlvbiBpc1N5c3RlbUtleShrZXkpIHtcbiAgcmV0dXJuIGtleSA9PT0gXCJcIiB8fCBzYW1lSWQoa2V5LCBUWVBfUFJPUEVSVFkpIHx8IHNhbWVJZChrZXksIFNVQlRZUF9QUk9QRVJUWSk7XG59XG5cbi8vIEEgYmxvY2sncyBwcm9wZXJ0aWVzIGluIHN0b3JlZCBvcmRlciwgdmlhIGNvbGxlY3RCbG9ja3MoKSAobWFpbi5qcyksIHNvIHRoZVxuLy8gc2FtZSBydWxlcyBhcHBseTogdGhlIFN1YnR5cCBibG9jayBmb2xsb3dzIHRoZSBUWVAtRnJvbnRtYXR0ZXIsIGEga2V5IGluIGJvdGhcbi8vIGtlZXBzIHRoZSBUWVAtRnJvbnRtYXR0ZXIgcG9zaXRpb24sIGFuZCB0aGUgU3VidHlwJ3MgZmxvYXRpbmcgZmxhZyB3aW5zIC0gYVxuLy8gU3VidHlwIGNhbiBrZWVwIGEgc3RhbmRhcmQgcHJvcGVydHkgb3V0IG9mIGl0cyB2aWV3IHRoYXQgd2F5LlxuZnVuY3Rpb24gYmxvY2tLZXlzKHBsdWdpbiwgdHlwLCBzdWJ0eXAsIGluY2x1ZGVGbG9hdGluZykge1xuICBjb25zdCB7IGRlZmF1bHRzIH0gPSBwbHVnaW4uY29sbGVjdEJsb2Nrcyh0eXAsIHN1YnR5cCwgaW5jbHVkZUZsb2F0aW5nKTtcbiAgcmV0dXJuIE9iamVjdC5rZXlzKGRlZmF1bHRzKS5maWx0ZXIoKGtleSkgPT4gIWlzU3lzdGVtS2V5KGtleSkpO1xufVxuXG4vLyBFdmVyeSBUWVAgdGhhdCBoYXMgYSBTdWJ0eXAgb2YgdGhpcyBuYW1lLCBpbiBUWVAtTGlzdCBvcmRlci4gVGhlIHNhbWVcbi8vIFN1YnR5cCBuYW1lIG1heSBleGlzdCB1bmRlciBzZXZlcmFsIFRZUCBlbnRyaWVzOyBhIHN0YW5kYWxvbmUgU3VidHlwIEJhc2Vcbi8vIGZpbHRlcnMgYnkgU1VCVFlQIG9ubHkgYW5kIHNvIHNob3dzIGFsbCBvZiB0aGVtLlxuZnVuY3Rpb24gdHlwc0ZvclN1YnR5cChwbHVnaW4sIHN1YnR5cCkge1xuICByZXR1cm4gcGx1Z2luLnNldHRpbmdzLnR5cHMuZmlsdGVyKCh0eXApID0+IGdldFN1YnR5cE5hbWVzKHBsdWdpbi5zZXR0aW5ncywgdHlwKS5pbmNsdWRlcyhzdWJ0eXApKTtcbn1cblxuLy8gQSB0YXJnZXQgaXMgeyB0eXAsIHN1YnR5cCB9OlxuLy8gICB7IHR5cCwgc3VidHlwOiBudWxsIH0gIC0gdGhlIFRZUCBpdHNlbGZcbi8vICAgeyB0eXAsIHN1YnR5cCB9ICAgICAgICAtIGEgU3VidHlwIHdpdGhpbiBpdHMgVFlQXG4vLyAgIHsgdHlwOiBudWxsLCBzdWJ0eXAgfSAgLSBhIFN1YnR5cCBuYW1lIG5vdCBib3VuZCB0byBhIFRZUCAoc3RhbmRhbG9uZVxuLy8gICAgICAgICAgICAgICAgICAgICAgICAgICAgU3VidHlwIEJhc2UsIGNvbHVtbnMgbWVyZ2VkIGFjcm9zcyBUWVAgZW50cmllcylcbmZ1bmN0aW9uIHRhcmdldEtleXMocGx1Z2luLCB0YXJnZXQsIG9wdGlvbnMpIHtcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQoKTtcbiAgY29uc3QgbWFpbiA9IFtdO1xuICBjb25zdCBvdGhlcnMgPSBbXTtcbiAgY29uc3QgYWRkID0gKGxpc3QsIGtleXMpID0+IHtcbiAgICBmb3IgKGNvbnN0IGtleSBvZiBrZXlzKSB7XG4gICAgICBjb25zdCBsb3dlciA9IGtleS50b0xvd2VyQ2FzZSgpO1xuICAgICAgaWYgKHNlZW4uaGFzKGxvd2VyKSkgY29udGludWU7XG4gICAgICBzZWVuLmFkZChsb3dlcik7XG4gICAgICBsaXN0LnB1c2goa2V5KTtcbiAgICB9XG4gIH07XG5cbiAgaWYgKCF0YXJnZXQudHlwKSB7XG4gICAgZm9yIChjb25zdCB0eXAgb2YgdHlwc0ZvclN1YnR5cChwbHVnaW4sIHRhcmdldC5zdWJ0eXApKSB7XG4gICAgICBhZGQobWFpbiwgYmxvY2tLZXlzKHBsdWdpbiwgdHlwLCB0YXJnZXQuc3VidHlwLCBvcHRpb25zLmZsb2F0aW5nKSk7XG4gICAgfVxuICAgIHJldHVybiB7IG1haW4sIG90aGVycyB9O1xuICB9XG5cbiAgYWRkKG1haW4sIGJsb2NrS2V5cyhwbHVnaW4sIHRhcmdldC50eXAsIHRhcmdldC5zdWJ0eXAsIG9wdGlvbnMuZmxvYXRpbmcpKTtcbiAgLy8gT25seSBmb3IgdGhlIFRZUCB2aWV3OiBpbiBhIFN1YnR5cCB2aWV3IHRoZSBvdGhlciBibG9ja3Mgd291bGQgc3RheSBlbXB0eSxcbiAgLy8gc2luY2UgYSBub3RlIGhhcyBhdCBtb3N0IG9uZSBTVUJUWVAuIEtleXMgYWxyZWFkeSBpbiBtYWluIGRyb3Agb3V0IHZpYVxuICAvLyBcInNlZW5cIi5cbiAgaWYgKG9wdGlvbnMuYWxsU3VidHlwcyAmJiAhdGFyZ2V0LnN1YnR5cCkge1xuICAgIGZvciAoY29uc3Qgc3VidHlwIG9mIGdldFN1YnR5cE5hbWVzKHBsdWdpbi5zZXR0aW5ncywgdGFyZ2V0LnR5cCkpIHtcbiAgICAgIGFkZChvdGhlcnMsIGJsb2NrS2V5cyhwbHVnaW4sIHRhcmdldC50eXAsIHN1YnR5cCwgb3B0aW9ucy5mbG9hdGluZykpO1xuICAgIH1cbiAgfVxuICByZXR1cm4geyBtYWluLCBvdGhlcnMgfTtcbn1cblxuLy8gVGhlIGZpbmFsIGNvbHVtbiBsaXN0OiBmaWxlLm5hbWUgZmlyc3QsIHRoZW4gdGhlIGdsb2JhbCBwcm9wZXJ0eSBvcmRlciBhc1xuLy8gdGhlIGZyYW1lLiBJdHMgcGxhY2Vob2xkZXJzIG1lYW4gaGVyZTpcbi8vICAgXCJ0eXBcIiAgICAgICAgICAgICAgICAgICAgIC0gVFlQLUZyb250bWF0dGVyIHBsdXMgdGhlIHRhcmdldCdzIFN1YnR5cCBibG9ja1xuLy8gICBcIm90aGVyXCIgICAgICAgICAgICAgICAgICAgLSB0aGUgcHJvcGVydGllcyBvZiB0aGUgb3RoZXIgU3VidHlwIGJsb2Nrc1xuLy8gICBcInR5cFZhbHVlXCIvXCJzdWJ0eXBWYWx1ZVwiICAtIHNraXBwZWQsIFRZUC9TVUJUWVAgYXJlIG5vIGNvbHVtbnNcbi8vIE9mIHRoZSBwaW5uZWQgcHJvcGVydGllcyBvbmx5IHRhZ3MgY291bnRzIChhbmQgb25seSB3aGVuIGNoZWNrZWQpOlxuLy8gY3NzY2xhc3NlcyBvciBhbGlhc2VzIG1ha2Ugbm8gc2Vuc2UgYXMgY29sdW1ucyBvZiBhbiBvdmVydmlldyB0YWJsZS5cbmZ1bmN0aW9uIGNvbHVtbklkcyhwbHVnaW4sIHRhcmdldCwgb3B0aW9ucykge1xuICBjb25zdCB7IG1haW4sIG90aGVycyB9ID0gdGFyZ2V0S2V5cyhwbHVnaW4sIHRhcmdldCwgb3B0aW9ucyk7XG4gIGNvbnN0IGlkcyA9IFtdO1xuICBjb25zdCBzZWVuID0gbmV3IFNldCgpO1xuICBjb25zdCBwdXNoID0gKGlkKSA9PiB7XG4gICAgY29uc3QgbG93ZXIgPSBpZC50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChzZWVuLmhhcyhsb3dlcikpIHJldHVybjtcbiAgICBzZWVuLmFkZChsb3dlcik7XG4gICAgaWRzLnB1c2goaWQpO1xuICB9O1xuXG4gIHB1c2goRklMRV9OQU1FX0lEKTtcbiAgbGV0IHRhZ3NQbGFjZWQgPSBmYWxzZTtcbiAgZm9yIChjb25zdCBlbnRyeSBvZiBub3JtYWxpemVHbG9iYWxPcmRlcihwbHVnaW4uc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcikpIHtcbiAgICBpZiAoZW50cnkua2luZCA9PT0gXCJwcm9wZXJ0eVwiKSB7XG4gICAgICBpZiAob3B0aW9ucy50YWdzICYmIGVudHJ5Lm5hbWUgJiYgc2FtZUlkKGVudHJ5Lm5hbWUsIFRBR1NfUFJPUEVSVFkpKSB7XG4gICAgICAgIHB1c2gobm90ZUlkKGVudHJ5Lm5hbWUpKTtcbiAgICAgICAgdGFnc1BsYWNlZCA9IHRydWU7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChlbnRyeS5raW5kID09PSBcInR5cFwiKSB7XG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBtYWluKSBwdXNoKG5vdGVJZChrZXkpKTtcbiAgICB9IGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwib3RoZXJcIikge1xuICAgICAgZm9yIChjb25zdCBrZXkgb2Ygb3RoZXJzKSBwdXNoKG5vdGVJZChrZXkpKTtcbiAgICB9XG4gIH1cbiAgLy8gU2FmZXR5IG5ldDogaWYgdGFncyBpc24ndCBpbiB0aGUgZ2xvYmFsIG9yZGVyLCBpdCBzdGlsbCBnb2VzIGxhc3QuXG4gIGlmIChvcHRpb25zLnRhZ3MgJiYgIXRhZ3NQbGFjZWQpIHB1c2gobm90ZUlkKFRBR1NfUFJPUEVSVFkpKTtcbiAgcmV0dXJuIGlkcztcbn1cblxuLyogLS0tIFZpZXdzIG9mIGEgdGFyZ2V0IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuXG4vLyBzY29wZWQ6IHdoZXRoZXIgZWFjaCB2aWV3IG11c3QgY2FycnkgaXRzIGZ1bGwgZmlsdGVyLiBJbiBhIG5ldyBCYXNlIHRoZSBUWVBcbi8vIHNpdHMgaW4gdGhlIHJvb3QgZmlsdGVyIGFuZCBTdWJ0eXAgdmlld3Mgb25seSBhZGQgU1VCVFlQLiBWaWV3cyBhcHBlbmRlZCB0b1xuLy8gYW4gZXhpc3RpbmcgQmFzZSBsZWF2ZSBpdHMgcm9vdCBmaWx0ZXIgYWxvbmUgYW5kIGZpbHRlciB0aGVtc2VsdmVzLlxuZnVuY3Rpb24gdGFyZ2V0Vmlld3MocGx1Z2luLCB0YXJnZXQsIG9wdGlvbnMsIHsgc2NvcGVkIH0pIHtcbiAgaWYgKCF0YXJnZXQudHlwKSB7XG4gICAgY29uc3QgdmlldyA9IHtcbiAgICAgIHR5cGU6IFwidGFibGVcIixcbiAgICAgIG5hbWU6IHRhcmdldC5zdWJ0eXAsXG4gICAgICBvcmRlcjogY29sdW1uSWRzKHBsdWdpbiwgdGFyZ2V0LCBvcHRpb25zKSxcbiAgICB9O1xuICAgIGlmIChzY29wZWQpIHZpZXcuZmlsdGVycyA9IHsgYW5kOiBbZXF1YWxzRmlsdGVyKFNVQlRZUF9QUk9QRVJUWSwgdGFyZ2V0LnN1YnR5cCldIH07XG4gICAgLy8gU2V2ZXJhbCBUWVAgZW50cmllcyB3aXRoIHRoaXMgU3VidHlwIG5hbWU6IGdyb3VwaW5nIHNlcGFyYXRlcyB0aGVtXG4gICAgLy8gd2l0aG91dCBhIHZpZXcgcGVyIFRZUC5cbiAgICBpZiAodHlwc0ZvclN1YnR5cChwbHVnaW4sIHRhcmdldC5zdWJ0eXApLmxlbmd0aCA+IDEpIHtcbiAgICAgIHZpZXcuZ3JvdXBCeSA9IHsgcHJvcGVydHk6IG5vdGVJZChUWVBfUFJPUEVSVFkpLCBkaXJlY3Rpb246IFwiQVNDXCIgfTtcbiAgICB9XG4gICAgcmV0dXJuIFt2aWV3XTtcbiAgfVxuXG4gIGNvbnN0IHR5cCA9IHRhcmdldC50eXA7XG4gIGNvbnN0IHN1YnR5cHMgPSBnZXRTdWJ0eXBOYW1lcyhwbHVnaW4uc2V0dGluZ3MsIHR5cCk7XG4gIGNvbnN0IG1haW4gPSB7XG4gICAgdHlwZTogXCJ0YWJsZVwiLFxuICAgIG5hbWU6IHR5cCxcbiAgICBvcmRlcjogY29sdW1uSWRzKHBsdWdpbiwgeyB0eXAsIHN1YnR5cDogbnVsbCB9LCBvcHRpb25zKSxcbiAgfTtcbiAgaWYgKHNjb3BlZCkgbWFpbi5maWx0ZXJzID0geyBhbmQ6IFtlcXVhbHNGaWx0ZXIoVFlQX1BST1BFUlRZLCB0eXApXSB9O1xuICAvLyBXaXRob3V0IGFueSBTdWJ0eXAsIGdyb3VwaW5nIGJ5IGFuIGFsd2F5cy1lbXB0eSBwcm9wZXJ0eSB3b3VsZCBvbmx5IGdpdmVcbiAgLy8gb25lIFwibm8gdmFsdWVcIiBncm91cC5cbiAgaWYgKHN1YnR5cHMubGVuZ3RoID4gMCkgbWFpbi5ncm91cEJ5ID0geyBwcm9wZXJ0eTogbm90ZUlkKFNVQlRZUF9QUk9QRVJUWSksIGRpcmVjdGlvbjogXCJBU0NcIiB9O1xuXG4gIGNvbnN0IHZpZXdzID0gW21haW5dO1xuICBmb3IgKGNvbnN0IHN1YnR5cCBvZiBzdWJ0eXBzKSB7XG4gICAgdmlld3MucHVzaCh7XG4gICAgICB0eXBlOiBcInRhYmxlXCIsXG4gICAgICBuYW1lOiBzdWJ0eXAsXG4gICAgICAvLyBhbGxTdWJ0eXBzIGlzIGFsd2F5cyBvZmYgaW4gYSBTdWJ0eXAgdmlldyAoc2VlIHRhcmdldEtleXMpLlxuICAgICAgb3JkZXI6IGNvbHVtbklkcyhwbHVnaW4sIHsgdHlwLCBzdWJ0eXAgfSwgeyAuLi5vcHRpb25zLCBhbGxTdWJ0eXBzOiBmYWxzZSB9KSxcbiAgICAgIGZpbHRlcnM6IHtcbiAgICAgICAgYW5kOiBzY29wZWRcbiAgICAgICAgICA/IFtlcXVhbHNGaWx0ZXIoVFlQX1BST1BFUlRZLCB0eXApLCBlcXVhbHNGaWx0ZXIoU1VCVFlQX1BST1BFUlRZLCBzdWJ0eXApXVxuICAgICAgICAgIDogW2VxdWFsc0ZpbHRlcihTVUJUWVBfUFJPUEVSVFksIHN1YnR5cCldLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfVxuICByZXR1cm4gdmlld3M7XG59XG5cbi8vIEEgdmlldyBvYmplY3QgYXMgaXQgYXBwZWFycyBpbiB0aGUgZmlsZTogd2l0aG91dCBcIm5vdGUuXCIgYW5kIHdpdGggdGhlIGtleVxuLy8gb3JkZXIgQmFzZXMgaXRzZWxmIHdyaXRlcy5cbmZ1bmN0aW9uIHNlcmlhbGl6ZVZpZXcodmlldykge1xuICBjb25zdCBvdXQgPSB7IHR5cGU6IHZpZXcudHlwZSwgbmFtZTogdmlldy5uYW1lIH07XG4gIGlmICh2aWV3LmZpbHRlcnMpIG91dC5maWx0ZXJzID0gdmlldy5maWx0ZXJzO1xuICBpZiAodmlldy5vcmRlcikgb3V0Lm9yZGVyID0gdmlldy5vcmRlci5tYXAoc2VyaWFsaXplSWQpO1xuICBpZiAodmlldy5ncm91cEJ5KSB7XG4gICAgb3V0Lmdyb3VwQnkgPSB7IHByb3BlcnR5OiBzZXJpYWxpemVJZCh2aWV3Lmdyb3VwQnkucHJvcGVydHkpLCBkaXJlY3Rpb246IHZpZXcuZ3JvdXBCeS5kaXJlY3Rpb24gfTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKiAtLS0gT3BlbmluZyBhbmQgd3JpdGluZyB0aGUgZmlsZSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbmZ1bmN0aW9uIHdhaXRGb3IobXMpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB3aW5kb3cuc2V0VGltZW91dChyZXNvbHZlLCBtcykpO1xufVxuXG4vLyBPcGVucyB0aGUgQmFzZSBhbmQgd2FpdHMgdW50aWwgaXRzIHF1ZXJ5IGlzIHBhcnNlZDsgb25seSB0aGVuIGNhbiBpdCBiZVxuLy8gcmVhZCBhbmQgd3JpdHRlbi4gUmV1c2VzIGEgdGFiIHRoYXQgYWxyZWFkeSBzaG93cyB0aGUgZmlsZS5cbmFzeW5jIGZ1bmN0aW9uIG9wZW5CYXNlKGFwcCwgZmlsZSkge1xuICBjb25zdCBvcGVuID0gYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJiYXNlc1wiKS5maW5kKChsZWFmKSA9PiBsZWFmLnZpZXc/LmZpbGU/LnBhdGggPT09IGZpbGUucGF0aCk7XG4gIGNvbnN0IGxlYWYgPSBvcGVuID8/IGFwcC53b3Jrc3BhY2UuZ2V0TGVhZihcInRhYlwiKTtcbiAgaWYgKG9wZW4pIGFwcC53b3Jrc3BhY2UucmV2ZWFsTGVhZihsZWFmKTtcbiAgZWxzZSBhd2FpdCBsZWFmLm9wZW5GaWxlKGZpbGUsIHsgYWN0aXZlOiB0cnVlIH0pO1xuICBmb3IgKGxldCBhdHRlbXB0ID0gMDsgYXR0ZW1wdCA8IDQwICYmICFsZWFmLnZpZXc/LnF1ZXJ5OyBhdHRlbXB0KyspIGF3YWl0IHdhaXRGb3IoMjUpO1xuICByZXR1cm4gbGVhZi52aWV3Py5xdWVyeSA/IGxlYWYudmlldyA6IG51bGw7XG59XG5cbi8vIEFwcGVuZHMgdmlld3MgdG8gYW4gZXhpc3RpbmcgQmFzZS4gZ2V0U2VyaWFsaXphYmxlKCkgcmV0dXJucyBleGFjdGx5IHdoYXRcbi8vIEJhc2VzIHdyaXRlcyB3aGVuIGl0IHNhdmVzICh2ZXJpZmllZDogdGhlIHJvdW5kIHRyaXAgcmVwcm9kdWNlcyBleGlzdGluZ1xuLy8gZmlsZXMgYnl0ZSBmb3IgYnl0ZSwgZm9ybXVsYSBibG9ja3MgYW5kIHNwZWNpYWwga2V5cyBpbmNsdWRlZCk7IG9ubHkgdGhlXG4vLyB2aWV3cyBsaXN0IGlzIHRvdWNoZWQuXG5hc3luYyBmdW5jdGlvbiBhcHBlbmRWaWV3cyhhcHAsIHZpZXcsIHZpZXdzKSB7XG4gIGNvbnN0IGRhdGEgPSB2aWV3LnF1ZXJ5LmdldFNlcmlhbGl6YWJsZSgpO1xuICBkYXRhLnZpZXdzID0gWy4uLihkYXRhLnZpZXdzID8/IFtdKSwgLi4udmlld3MubWFwKHNlcmlhbGl6ZVZpZXcpXTtcbiAgYXdhaXQgYXBwLnZhdWx0Lm1vZGlmeSh2aWV3LmZpbGUsIHN0cmluZ2lmeVlhbWwoZGF0YSkpO1xufVxuXG4vKiAtLS0gQ29tbWFuZDogQ3JlYXRlIEJhc2UgZm9yIFRZUCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUJhc2UocGx1Z2luLCB0YXJnZXQsIG9wdGlvbnMpIHtcbiAgY29uc3QgYXBwID0gcGx1Z2luLmFwcDtcbiAgY29uc3QgbmFtZSA9IHRhcmdldC5zdWJ0eXAgPz8gdGFyZ2V0LnR5cDtcbiAgY29uc3QgcGF0aCA9IGAke25hbWV9LiR7QkFTRV9FWFRFTlNJT059YDtcbiAgY29uc3QgZXhpc3RpbmcgPSBhcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHBhdGgpO1xuXG4gIGlmIChleGlzdGluZyAmJiAhKGV4aXN0aW5nIGluc3RhbmNlb2YgVEZpbGUpKSB7XG4gICAgbmV3IE5vdGljZShgXCIke3BhdGh9XCIgaXMgbm90IGEgZmlsZSBcdTIwMTMgQmFzZSBub3QgY3JlYXRlZC5gKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgY29uc3Qgdmlld3MgPSB0YXJnZXRWaWV3cyhwbHVnaW4sIHRhcmdldCwgb3B0aW9ucywgeyBzY29wZWQ6IGZhbHNlIH0pO1xuICAgIGNvbnN0IHJvb3QgPSB0YXJnZXQudHlwXG4gICAgICA/IHsgYW5kOiBbZXF1YWxzRmlsdGVyKFRZUF9QUk9QRVJUWSwgdGFyZ2V0LnR5cCldIH1cbiAgICAgIDogeyBhbmQ6IFtlcXVhbHNGaWx0ZXIoU1VCVFlQX1BST1BFUlRZLCB0YXJnZXQuc3VidHlwKV0gfTtcbiAgICBjb25zdCBmaWxlID0gYXdhaXQgYXBwLnZhdWx0LmNyZWF0ZShwYXRoLCBzdHJpbmdpZnlZYW1sKHsgZmlsdGVyczogcm9vdCwgdmlld3M6IHZpZXdzLm1hcChzZXJpYWxpemVWaWV3KSB9KSk7XG4gICAgYXdhaXQgb3BlbkJhc2UoYXBwLCBmaWxlKTtcbiAgICBuZXcgTm90aWNlKGBDcmVhdGVkICR7cGF0aH0gd2l0aCAke3BsdXJhbCh2aWV3cy5sZW5ndGgsIFwidmlld1wiKX0uYCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gVGhlIGZpbGUgZXhpc3RzOiBhZGQgd2hhdCBpcyBtaXNzaW5nLiBBIHZpZXcgd2l0aCB0aGUgc2FtZSBuYW1lIHN0YXlzXG4gIC8vIHVudG91Y2hlZCAtIGl0IG1heSBiZSBoYW5kLW1hZGUsIGFuZCBvdmVyd3JpdGluZyBpdCB3b3VsZCBiZSBhIHNpbGVudCBsb3NzLlxuICBjb25zdCB2aWV3ID0gYXdhaXQgb3BlbkJhc2UoYXBwLCBleGlzdGluZyk7XG4gIGlmICghdmlldykge1xuICAgIG5ldyBOb3RpY2UoYENvdWxkbid0IHJlYWQgJHtwYXRofSBcdTIwMTMgQmFzZSBub3QgdXBkYXRlZC5gKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgcHJlc2VudCA9IG5ldyBTZXQodmlldy5xdWVyeS52aWV3cy5tYXAoKGNmZykgPT4gY2ZnLm5hbWUpKTtcbiAgY29uc3Qgd2FudGVkID0gdGFyZ2V0Vmlld3MocGx1Z2luLCB0YXJnZXQsIG9wdGlvbnMsIHsgc2NvcGVkOiB0cnVlIH0pO1xuICBjb25zdCB0b0FkZCA9IHdhbnRlZC5maWx0ZXIoKGVudHJ5KSA9PiAhcHJlc2VudC5oYXMoZW50cnkubmFtZSkpO1xuICBjb25zdCBza2lwcGVkID0gd2FudGVkLmZpbHRlcigoZW50cnkpID0+IHByZXNlbnQuaGFzKGVudHJ5Lm5hbWUpKS5tYXAoKGVudHJ5KSA9PiBlbnRyeS5uYW1lKTtcblxuICBpZiAodG9BZGQubGVuZ3RoID4gMCkgYXdhaXQgYXBwZW5kVmlld3MoYXBwLCB2aWV3LCB0b0FkZCk7XG5cbiAgY29uc3QgcGFydHMgPSBbXTtcbiAgcGFydHMucHVzaCh0b0FkZC5sZW5ndGggPiAwID8gYCR7cGF0aH06IGFkZGVkICR7cGx1cmFsKHRvQWRkLmxlbmd0aCwgXCJ2aWV3XCIpfS5gIDogYCR7cGF0aH06IG5vdGhpbmcgdG8gYWRkLmApO1xuICBpZiAoc2tpcHBlZC5sZW5ndGggPiAwKSBwYXJ0cy5wdXNoKGBBbHJlYWR5IHByZXNlbnQsIGxlZnQgdW5jaGFuZ2VkOiAke3NraXBwZWQuam9pbihcIiwgXCIpfS5gKTtcbiAgbmV3IE5vdGljZShwYXJ0cy5qb2luKFwiIFwiKSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUJhc2VDb21tYW5kKHBsdWdpbikge1xuICAvLyBpbmNsdWRlTWFudWFsT2ZmOiBhIEJhc2UgaXMgZXNwZWNpYWxseSB1c2VmdWwgZm9yIFRZUCBlbnRyaWVzIHRoYXQgYXJlbid0XG4gIC8vIHNldCBieSBoYW5kIChLT05UQUtULCBNRURJQSwgRVhURVJOKS4gVW5yZWdpc3RlcmVkIHZhbHVlcyBhcmUgbGVmdCBvdXQgLVxuICAvLyB0aGV5IGhhdmUgbm8gVFlQLUZyb250bWF0dGVyIGFuZCBzbyBubyBjb2x1bW5zLlxuICBjb25zdCBjaG9pY2UgPSBhd2FpdCBwbHVnaW4ucGlja1R5cEFuZFN1YnR5cCh7IGluY2x1ZGVNYW51YWxPZmY6IHRydWUgfSk7XG4gIGlmICghY2hvaWNlKSByZXR1cm47XG5cbiAgLy8gQSBTdWJ0eXAgcGlja2VkIGhlcmUgbWVhbnMgdGhlIHN0YW5kYWxvbmUgU3VidHlwIEJhc2U6IGl0IGZpbHRlcnMgYnlcbiAgLy8gU1VCVFlQIG9ubHkgYW5kIG1lcmdlcyB0aGUgY29sdW1ucyBvZiBldmVyeSBUWVAgd2l0aCB0aGF0IFN1YnR5cCBuYW1lLlxuICBjb25zdCB0YXJnZXQgPSBjaG9pY2Uuc3VidHlwID8geyB0eXA6IG51bGwsIHN1YnR5cDogY2hvaWNlLnN1YnR5cCB9IDogeyB0eXA6IGNob2ljZS50eXAsIHN1YnR5cDogbnVsbCB9O1xuICBjb25zdCBvcHRpb25zID0gYXdhaXQgYXNrQ29sdW1uT3B0aW9ucyhwbHVnaW4sIHRhcmdldCwgKGN1cnJlbnQpID0+IGNvbHVtbklkcyhwbHVnaW4sIHRhcmdldCwgY3VycmVudCkpO1xuICBpZiAoIW9wdGlvbnMpIHJldHVybjtcbiAgYXdhaXQgY3JlYXRlQmFzZShwbHVnaW4sIHRhcmdldCwgb3B0aW9ucyk7XG59XG5cbi8qIC0tLSBDb21tYW5kOiBVcGRhdGUgY29sdW1ucyBvZiBCYXNlIHZpZXcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuZnVuY3Rpb24gYWN0aXZlQmFzZVZpZXcocGx1Z2luKSB7XG4gIGNvbnN0IGxlYWYgPSBwbHVnaW4uYXBwLndvcmtzcGFjZS5hY3RpdmVMZWFmID8/IHBsdWdpbi5hcHAud29ya3NwYWNlLmdldE1vc3RSZWNlbnRMZWFmPy4oKTtcbiAgY29uc3QgdmlldyA9IGxlYWY/LnZpZXc7XG4gIGlmICghdmlldyB8fCB0eXBlb2Ygdmlldy5nZXRWaWV3VHlwZSAhPT0gXCJmdW5jdGlvblwiIHx8IHZpZXcuZ2V0Vmlld1R5cGUoKSAhPT0gXCJiYXNlc1wiKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHZpZXcucXVlcnkgPyB2aWV3IDogbnVsbDtcbn1cblxuZnVuY3Rpb24gc2VyaWFsaXplRmlsdGVycyhmaWx0ZXJzKSB7XG4gIHJldHVybiB0eXBlb2YgZmlsdGVycz8uc2VyaWFsaXplID09PSBcImZ1bmN0aW9uXCIgPyBmaWx0ZXJzLnNlcmlhbGl6ZSgpIDogbnVsbDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gdXBkYXRlQWN0aXZlVmlldyhwbHVnaW4sIHZpZXcpIHtcbiAgY29uc3QgcXVlcnkgPSB2aWV3LnF1ZXJ5O1xuICBjb25zdCB2aWV3TmFtZSA9IHZpZXcuY29udHJvbGxlcj8udmlld05hbWU7XG4gIGNvbnN0IGNmZyA9ICh2aWV3TmFtZSA/IHF1ZXJ5LmdldFZpZXdDb25maWcodmlld05hbWUpIDogbnVsbCkgPz8gcXVlcnkudmlld3NbMF07XG4gIGlmICghY2ZnKSB7XG4gICAgbmV3IE5vdGljZShcIk5vIGFjdGl2ZSB2aWV3LlwiKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBsZXQgdGFyZ2V0ID0gcmVhZFRhcmdldChzZXJpYWxpemVGaWx0ZXJzKHF1ZXJ5LmZpbHRlcnMpLCBzZXJpYWxpemVGaWx0ZXJzKGNmZy5maWx0ZXJzKSk7XG4gIGlmICghdGFyZ2V0KSB7XG4gICAgLy8gTm8gdW5hbWJpZ3VvdXMgVFlQIGluIHRoZSBmaWx0ZXIgKGhhbmQtd3JpdHRlbiBPUiBncm91cCwgbm8gZmlsdGVyIGF0XG4gICAgLy8gYWxsKTogYXNrLCBhbmQgc3RvcmUgdGhlIGFuc3dlciBhcyBhIGZpbHRlciBzbyB0aGUgbmV4dCBydW4gcmVhZHMgaXQuXG4gICAgY29uc3QgY2hvaWNlID0gYXdhaXQgcGx1Z2luLnBpY2tUeXBBbmRTdWJ0eXAoeyBpbmNsdWRlTWFudWFsT2ZmOiB0cnVlIH0pO1xuICAgIGlmICghY2hvaWNlKSByZXR1cm47XG4gICAgdGFyZ2V0ID0geyB0eXA6IGNob2ljZS50eXAsIHN1YnR5cDogY2hvaWNlLnN1YnR5cCB9O1xuICAgIGNvbnN0IGFuZCA9IFtlcXVhbHNGaWx0ZXIoVFlQX1BST1BFUlRZLCBjaG9pY2UudHlwKV07XG4gICAgaWYgKGNob2ljZS5zdWJ0eXApIGFuZC5wdXNoKGVxdWFsc0ZpbHRlcihTVUJUWVBfUFJPUEVSVFksIGNob2ljZS5zdWJ0eXApKTtcbiAgICBxdWVyeS5zZXRWaWV3RmlsdGVycyhjZmcubmFtZSwgeyBhbmQgfSk7XG4gIH1cblxuICBjb25zdCBvcHRpb25zID0gYXdhaXQgYXNrQ29sdW1uT3B0aW9ucyhwbHVnaW4sIHRhcmdldCwgKGN1cnJlbnQpID0+IGNvbHVtbklkcyhwbHVnaW4sIHRhcmdldCwgY3VycmVudCkpO1xuICBpZiAoIW9wdGlvbnMpIHJldHVybjtcblxuICBjb25zdCBkZXNpcmVkID0gY29sdW1uSWRzKHBsdWdpbiwgdGFyZ2V0LCBvcHRpb25zKTtcbiAgY29uc3QgZGVzaXJlZExvd2VyID0gbmV3IFNldChkZXNpcmVkLm1hcCgoaWQpID0+IGlkLnRvTG93ZXJDYXNlKCkpKTtcbiAgLy8gQSB2aWV3IHdpdGhvdXQgaXRzIG93biBvcmRlciBzaG93cyBldmVyeSBwcm9wZXJ0eSAtIG5vdGhpbmcgdG8gcmVtb3ZlLFxuICAvLyB0aGUgZ2VuZXJhdGVkIGxpc3Qgc2ltcGx5IHRha2VzIGl0cyBwbGFjZS5cbiAgY29uc3QgY3VycmVudCA9IEFycmF5LmlzQXJyYXkoY2ZnLm9yZGVyKSA/IFsuLi5jZmcub3JkZXJdIDogW107XG4gIGNvbnN0IGV4dHJhcyA9IGN1cnJlbnQuZmlsdGVyKChpZCkgPT4gIWRlc2lyZWRMb3dlci5oYXMoaWQudG9Mb3dlckNhc2UoKSkpO1xuXG4gIGxldCBrZXB0ID0gW107XG4gIGlmIChleHRyYXMubGVuZ3RoID4gMCkge1xuICAgIGNvbnN0IHJlbW92YWxzID0gYXdhaXQgYXNrUmVtb3ZhbHMocGx1Z2luLCBleHRyYXMsIGNmZy5uYW1lKTtcbiAgICBpZiAoIXJlbW92YWxzKSByZXR1cm47XG4gICAga2VwdCA9IGV4dHJhcy5maWx0ZXIoKGlkKSA9PiAhcmVtb3ZhbHMuaGFzKGlkKSk7XG4gIH1cblxuICAvLyBLZXB0IGNvbHVtbnMgc3RheSB1cCBmcm9udCwgcmlnaHQgYWZ0ZXIgZmlsZS5uYW1lOiBoYW5kLWFkZGVkIG9uZXNcbiAgLy8gKGZvcm11bGEgY29sdW1ucywgc2F5KSBzaG91bGRuJ3Qgc2xpZGUgdG8gdGhlIGVuZC5cbiAgY29uc3QgbmV3T3JkZXIgPSBbXG4gICAgRklMRV9OQU1FX0lELFxuICAgIC4uLmtlcHQuZmlsdGVyKChpZCkgPT4gIXNhbWVJZChpZCwgRklMRV9OQU1FX0lEKSksXG4gICAgLi4uZGVzaXJlZC5maWx0ZXIoKGlkKSA9PiAhc2FtZUlkKGlkLCBGSUxFX05BTUVfSUQpKSxcbiAgXTtcblxuICBpZiAobmV3T3JkZXIubGVuZ3RoID09PSBjdXJyZW50Lmxlbmd0aCAmJiBuZXdPcmRlci5ldmVyeSgoaWQsIGluZGV4KSA9PiBpZCA9PT0gY3VycmVudFtpbmRleF0pKSB7XG4gICAgbmV3IE5vdGljZShgVmlldyBcIiR7Y2ZnLm5hbWV9XCI6IGNvbHVtbnMgYXJlIGFscmVhZHkgdXAgdG8gZGF0ZS5gKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBhZGRlZCA9IGRlc2lyZWQuZmlsdGVyKChpZCkgPT4gIWN1cnJlbnQuc29tZSgoZXhpc3RpbmcpID0+IHNhbWVJZChleGlzdGluZywgaWQpKSkubGVuZ3RoO1xuICBjb25zdCByZW1vdmVkID0gZXh0cmFzLmxlbmd0aCAtIGtlcHQubGVuZ3RoO1xuICBjZmcuc2V0T3JkZXIobmV3T3JkZXIpO1xuICBuZXcgTm90aWNlKGBWaWV3IFwiJHtjZmcubmFtZX1cIjogYWRkZWQgJHtwbHVyYWwoYWRkZWQsIFwiY29sdW1uXCIpfSwgcmVtb3ZlZCAke3JlbW92ZWR9LmApO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgY3JlYXRlQmFzZUNvbW1hbmQsXG4gIGFjdGl2ZUJhc2VWaWV3LFxuICB1cGRhdGVBY3RpdmVWaWV3LFxuICAvLyBFeHBvc2VkIGZvciB0ZXN0aW5nIHNpbmdsZSBidWlsZGluZyBibG9ja3NcbiAgY29sdW1uSWRzLFxuICByZWFkVGFyZ2V0LFxuICB0YXJnZXRWaWV3cyxcbn07XG4iLCAiY29uc3QgeyBOb3RpY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgc29ydEFsbEZyb250bWF0dGVyLCBzb3J0U2luZ2xlRmlsZUZyb250bWF0dGVyLCBzb3J0U3VtbWFyeSB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItc29ydFwiKTtcbmNvbnN0IHsgY3JlYXRlQmFzZUNvbW1hbmQsIGFjdGl2ZUJhc2VWaWV3LCB1cGRhdGVBY3RpdmVWaWV3IH0gPSByZXF1aXJlKFwiLi9iYXNlc1wiKTtcblxuZnVuY3Rpb24gcmVnaXN0ZXJDb21tYW5kcyhwbHVnaW4pIHtcblxuICAvLyBPYnNpZGlhbiBuZWl0aGVyIGF3YWl0cyBhIGNvbW1hbmQgY2FsbGJhY2sgbm9yIGNhdGNoZXMgaXRzIGVycm9ycywgc28gYW5cbiAgLy8gZXhjZXB0aW9uIHdvdWxkIHZhbmlzaCBpbnRvIHRoZSBjb25zb2xlLiBUaGVzZSBjb21tYW5kcyBhbHdheXMgZW5kIGluIGFcbiAgLy8gbm90aWNlIGluc3RlYWQuXG4gIGNvbnN0IHJ1bk9yUmVwb3J0RXJyb3IgPSAobGFiZWwsIGZuKSA9PiBhc3luYyAoKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGZuKCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoYFske2xhYmVsfV1gLCBlcnJvcik7XG4gICAgICBuZXcgTm90aWNlKGAke2xhYmVsfSBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICB9XG4gIH07XG5cbiAgcGx1Z2luLmFkZENvbW1hbmQoe1xuICAgIGlkOiBcInNvcnQtZnJvbnRtYXR0ZXItYWxsXCIsXG4gICAgbmFtZTogXCJTb3J0IGZyb250bWF0dGVyIGluIGFsbCBub3Rlc1wiLFxuICAgIGNhbGxiYWNrOiBydW5PclJlcG9ydEVycm9yKFwiRnJvbnRtYXR0ZXIgc29ydGluZ1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB7IGNoZWNrZWQsIGNoYW5nZWQgfSA9IGF3YWl0IHNvcnRBbGxGcm9udG1hdHRlcihwbHVnaW4uYXBwLCBwbHVnaW4sIG51bGwpO1xuICAgICAgbmV3IE5vdGljZShzb3J0U3VtbWFyeShcIkZyb250bWF0dGVyIHNvcnRpbmdcIiwgY2hlY2tlZCwgY2hhbmdlZCkpO1xuICAgIH0pLFxuICB9KTtcblxuICBwbHVnaW4uYWRkQ29tbWFuZCh7XG4gICAgaWQ6IFwic29ydC1mcm9udG1hdHRlci10eXBcIixcbiAgICBuYW1lOiBcIlNvcnQgZnJvbnRtYXR0ZXIgZm9yIG9uZSBUWVBcIixcbiAgICBjYWxsYmFjazogcnVuT3JSZXBvcnRFcnJvcihcIkZyb250bWF0dGVyIHNvcnRpbmdcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gU29ydGluZyBtYWtlcyBzZW5zZSBmb3IgYW55IFRZUCwgbWFudWFsbHkgY3JlYXRhYmxlIG9yIG5vdCwgcmVnaXN0ZXJlZFxuICAgICAgLy8gb3Igbm90LlxuICAgICAgY29uc3QgdHlwID0gYXdhaXQgcGx1Z2luLnBpY2tUeXAoeyBpbmNsdWRlTWFudWFsT2ZmOiB0cnVlLCBpbmNsdWRlVW5yZWdpc3RlcmVkOiB0cnVlIH0pO1xuICAgICAgaWYgKCF0eXApIHJldHVybjtcbiAgICAgIGNvbnN0IHsgY2hlY2tlZCwgY2hhbmdlZCwgaGFzVHlwRGVmYXVsdHMgfSA9IGF3YWl0IHNvcnRBbGxGcm9udG1hdHRlcihwbHVnaW4uYXBwLCBwbHVnaW4sIHR5cCk7XG4gICAgICBsZXQgbWVzc2FnZSA9IHNvcnRTdW1tYXJ5KGBGcm9udG1hdHRlciBzb3J0aW5nICR7dHlwfWAsIGNoZWNrZWQsIGNoYW5nZWQpO1xuICAgICAgLy8gTm90IGFuIGVycm9yLCBidXQgZXhwbGFpbnMgd2h5IG5vdGhpbmcgbWF5IGhhdmUgY2hhbmdlZC5cbiAgICAgIGlmIChoYXNUeXBEZWZhdWx0cyA9PT0gZmFsc2UpIHtcbiAgICAgICAgbWVzc2FnZSArPSBgIE5vdGU6ICR7dHlwfSBoYXMgbm8gVFlQLUZyb250bWF0dGVyLCBzbyBvbmx5IHRoZSBnbG9iYWwgb3JkZXIgd2FzIGFwcGxpZWQuYDtcbiAgICAgIH1cbiAgICAgIG5ldyBOb3RpY2UobWVzc2FnZSk7XG4gICAgfSksXG4gIH0pO1xuXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJzb3J0LWZyb250bWF0dGVyLWFjdGl2ZS1ub3RlXCIsXG4gICAgbmFtZTogXCJTb3J0IGZyb250bWF0dGVyIG9mIGFjdGl2ZSBub3RlXCIsXG4gICAgY2hlY2tDYWxsYmFjazogKGNoZWNraW5nKSA9PiB7XG4gICAgICBjb25zdCBmaWxlID0gcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xuICAgICAgaWYgKCFmaWxlIHx8IGZpbGUuZXh0ZW5zaW9uICE9PSBcIm1kXCIpIHJldHVybiBmYWxzZTtcbiAgICAgIGlmIChjaGVja2luZykgcmV0dXJuIHRydWU7XG5cbiAgICAgIHJ1bk9yUmVwb3J0RXJyb3IoXCJGcm9udG1hdHRlciBzb3J0aW5nXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgY2hhbmdlZCA9IGF3YWl0IHNvcnRTaW5nbGVGaWxlRnJvbnRtYXR0ZXIocGx1Z2luLmFwcCwgcGx1Z2luLCBmaWxlKTtcbiAgICAgICAgbmV3IE5vdGljZShjaGFuZ2VkID8gYFNvcnRlZCBmcm9udG1hdHRlciBvZiBcIiR7ZmlsZS5iYXNlbmFtZX1cIi5gIDogYEZyb250bWF0dGVyIG9mIFwiJHtmaWxlLmJhc2VuYW1lfVwiIHdhcyBhbHJlYWR5IHNvcnRlZC5gKTtcbiAgICAgIH0pKCk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9LFxuICB9KTtcblxuICAvLyBDcmVhdGVzIGEgLmJhc2UgZm9yIHRoZSBjaG9zZW4gVFlQIG9yIFN1YnR5cCBpbiB0aGUgdmF1bHQgcm9vdCwgc2VlIGJhc2VzLmpzLlxuICBwbHVnaW4uYWRkQ29tbWFuZCh7XG4gICAgaWQ6IFwiY3JlYXRlLWJhc2UtZm9yLXR5cFwiLFxuICAgIG5hbWU6IFwiQ3JlYXRlIEJhc2UgZm9yIFRZUFwiLFxuICAgIGNhbGxiYWNrOiBydW5PclJlcG9ydEVycm9yKFwiQ3JlYXRlIEJhc2VcIiwgKCkgPT4gY3JlYXRlQmFzZUNvbW1hbmQocGx1Z2luKSksXG4gIH0pO1xuXG4gIC8vIEJyaW5ncyB0aGUgY29sdW1ucyBvZiB0aGUgdmlzaWJsZSBCYXNlIHZpZXcgaW4gbGluZSB3aXRoIGl0cyBUWVAuIFdpdGhvdXRcbiAgLy8gYW4gb3BlbiBCYXNlIHRoZSBjb21tYW5kIGhhcyBubyB0YXJnZXQgYW5kIGlzIGhpZGRlbi5cbiAgcGx1Z2luLmFkZENvbW1hbmQoe1xuICAgIGlkOiBcInVwZGF0ZS1iYXNlLXZpZXctY29sdW1uc1wiLFxuICAgIG5hbWU6IFwiVXBkYXRlIGNvbHVtbnMgb2YgQmFzZSB2aWV3XCIsXG4gICAgY2hlY2tDYWxsYmFjazogKGNoZWNraW5nKSA9PiB7XG4gICAgICBjb25zdCB2aWV3ID0gYWN0aXZlQmFzZVZpZXcocGx1Z2luKTtcbiAgICAgIGlmICghdmlldykgcmV0dXJuIGZhbHNlO1xuICAgICAgaWYgKGNoZWNraW5nKSByZXR1cm4gdHJ1ZTtcblxuICAgICAgcnVuT3JSZXBvcnRFcnJvcihcIlVwZGF0ZSBCYXNlXCIsICgpID0+IHVwZGF0ZUFjdGl2ZVZpZXcocGx1Z2luLCB2aWV3KSkoKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0sXG4gIH0pO1xuXG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckNvbW1hbmRzIH07XG4iLCAiY29uc3QgeyBDb25maXJtYXRpb25Nb2RhbCwgUGxhdGZvcm0gfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgbmFtZUNvbG9yLCBwYWludENvbG9yRG90LCBERUZBVUxUX1RZUF9DT0xPUiB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxuLy8gQSBUWVAgbmFtZSBpbiBydW5uaW5nIHRleHQgKGRpYWxvZ3MpOiBjb2xvcmVkIHdoZW4gXCJUWVAtUGFuZVwiIGNvbG9yaW5nIGlzIG9uXG4vLyAoY29sb3JWaWV3cy50eXBMaXN0KSwgb3RoZXJ3aXNlIGEgZG90IGJlZm9yZSBwbGFpbiB0ZXh0IC0gdGhlIHNhbWUgc3dpdGNoIGFzXG4vLyBpbiB0aGUgcGlja2VyIGFuZCB0aGUgbGlzdC4gVGhlIGNhbGxlciBwYXNzZXMgY29sb3Igc28gYSByZW5hbWUgY2FuIHVzZSB0aGVcbi8vIHNhbWUgKG9sZCkgY29sb3IgZm9yIG9sZCBhbmQgbmV3IG5hbWUuIGNvbG9yIG51bGwgPSBUWVAgd2l0aG91dCBhIGNvbG9yLlxuZnVuY3Rpb24gYXBwZW5kVHlwTmFtZShwYXJlbnRFbCwgcGx1Z2luLCB0eXAsIGNvbG9yKSB7XG4gIGlmIChwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0KSB7XG4gICAgY29uc3QgbmFtZUVsID0gcGFyZW50RWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtaW5saW5lLW5hbWVcIiwgdGV4dDogdHlwIH0pO1xuICAgIGlmIChjb2xvcikgbmFtZUVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gIH0gZWxzZSB7XG4gICAgcGFpbnRDb2xvckRvdChwYXJlbnRFbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1pbmxpbmUtZG90XCIgfSksIGNvbG9yID8/IERFRkFVTFRfVFlQX0NPTE9SLCAhY29sb3IpO1xuICAgIHBhcmVudEVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLWlubGluZS1uYW1lXCIsIHRleHQ6IHR5cCB9KTtcbiAgfVxufVxuXG4vLyBMaWtlIGFwcGVuZFR5cE5hbWUgZm9yIGEgU3VidHlwIG9mIHR5cCwgaW4gdGhlIFN1YnR5cCBjb2xvciAoc2VlIG5hbWVDb2xvclxuLy8gaW4gdHlwLWNvbG9ycy5qcywgd2hpY2ggYWxzbyBob25vcnMgdGhlIFwiU3VidHlwXCIgc3ViLXRvZ2dsZSBvZiBcIlRZUC1QYW5lXCIpLlxuLy8gY29sb3JTdWJ0eXAgaXMgdGhlIFN1YnR5cCB3aG9zZSBjb2xvciBpcyB1c2VkIC0gYSByZW5hbWUgc2hvd3MgdGhlIG5ldyBuYW1lLFxuLy8gd2hpY2ggaGFzIG5vIGVudHJ5IHlldCwgaW4gdGhlIG9sZCBvbmUncyBjb2xvci4gQXMgd2l0aCBhcHBlbmRUeXBOYW1lLCBhIFRZUFxuLy8gd2l0aG91dCBhIGNvbG9yIGxlYXZlcyB0aGUgdGV4dCB1bmNvbG9yZWQuXG5mdW5jdGlvbiBhcHBlbmRTdWJ0eXBOYW1lKHBhcmVudEVsLCBwbHVnaW4sIHR5cCwgbmFtZSwgY29sb3JTdWJ0eXAgPSBuYW1lKSB7XG4gIGNvbnN0IHsgY29sb3IsIGlzRGVmYXVsdCB9ID0gbmFtZUNvbG9yKHBsdWdpbi5zZXR0aW5ncywgdHlwLCBjb2xvclN1YnR5cCk7XG4gIGlmIChwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0KSB7XG4gICAgY29uc3QgbmFtZUVsID0gcGFyZW50RWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtaW5saW5lLW5hbWVcIiwgdGV4dDogbmFtZSB9KTtcbiAgICBpZiAocGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdKSBuYW1lRWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcbiAgfSBlbHNlIHtcbiAgICBwYWludENvbG9yRG90KHBhcmVudEVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLWlubGluZS1kb3RcIiB9KSwgY29sb3IsIGlzRGVmYXVsdCk7XG4gICAgcGFyZW50RWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtaW5saW5lLW5hbWVcIiwgdGV4dDogbmFtZSB9KTtcbiAgfVxufVxuXG4vLyBUaGUgc2FtZSBhcyBub2RlcyBmb3IgYSBDb25maXJtTW9kYWwgdGl0bGUgb3IgYm9keS5cbmNvbnN0IHR5cE5hbWVOb2RlID0gKHBsdWdpbiwgdHlwLCBjb2xvcikgPT4gY3JlYXRlRnJhZ21lbnQoKGYpID0+IGFwcGVuZFR5cE5hbWUoZiwgcGx1Z2luLCB0eXAsIGNvbG9yKSk7XG5jb25zdCBzdWJ0eXBOYW1lTm9kZSA9IChwbHVnaW4sIHR5cCwgbmFtZSwgY29sb3JTdWJ0eXAgPSBuYW1lKSA9PlxuICBjcmVhdGVGcmFnbWVudCgoZikgPT4gYXBwZW5kU3VidHlwTmFtZShmLCBwbHVnaW4sIHR5cCwgbmFtZSwgY29sb3JTdWJ0eXApKTtcblxuLy8gRmlsbHMgZWwgd2l0aCBhIHN0cmluZyBvciBhbiBhcnJheSBvZiBzdHJpbmdzIGFuZCBub2Rlcy5cbmZ1bmN0aW9uIGFwcGVuZFBhcnRzKGVsLCBwYXJ0cykge1xuICBmb3IgKGNvbnN0IHBhcnQgb2YgQXJyYXkuaXNBcnJheShwYXJ0cykgPyBwYXJ0cyA6IFtwYXJ0c10pIHtcbiAgICBpZiAodHlwZW9mIHBhcnQgPT09IFwic3RyaW5nXCIpIGVsLmFwcGVuZFRleHQocGFydCk7XG4gICAgZWxzZSBlbC5hcHBlbmRDaGlsZChwYXJ0KTtcbiAgfVxufVxuXG4vLyBUaGUgb25lIGNvbmZpcm1hdGlvbiBkaWFsb2cgb2YgdGhlIHBsdWdpbiwgYnVpbHQgb24gT2JzaWRpYW4ncyBvd25cbi8vIENvbmZpcm1hdGlvbk1vZGFsIC0gdGhlIGJhc2Ugb2YgaXRzIFwiRGVsZXRlIGZpbGVcIiBldGMuIC0gc28gbG9vaywgYnV0dG9uXG4vLyBvcmRlciBbQ2FuY2VsXSBbQWN0aW9uXSwgYm90dG9tIHNoZWV0IG9uIHBob25lcyBhbmQga2V5Ym9hcmQgZm9jdXMgbWF0Y2hcbi8vIE9ic2lkaWFuJ3MgZGlhbG9ncyBleGFjdGx5LlxuLy9cbi8vIExpa2UgT2JzaWRpYW4ncyBcIk1lcmdlIHByb3BlcnR5IC4uLiB3aXRoIC4uLj9cIiAoQWxsIHByb3BlcnRpZXMpLCB0aGVcbi8vIHF1ZXN0aW9uIGl0c2VsZiBpcyB0aGUgdGl0bGUgYW5kIHRoZSB0ZXh0IG9ubHkgYWRkcyB3aGF0IHRoZSB0aXRsZSBkb2Vzbid0XG4vLyBzYXkgLSBvZnRlbiBub3RoaW5nLlxuLy9cbi8vICAgdGl0bGUgICAgICAgLSB0aGUgcXVlc3Rpb24gKFwiRGVsZXRlIFRFUk1JTj9cIik7IGEgc3RyaW5nIG9yIGFuIGFycmF5IG9mXG4vLyAgICAgICAgICAgICAgICAgc3RyaW5ncyBhbmQgbm9kZXMgKGZvciBjb2xvcmVkIG5hbWVzLCBzZWUgYXBwZW5kVHlwTmFtZS9cbi8vICAgICAgICAgICAgICAgICBhcHBlbmRTdWJ0eXBOYW1lKVxuLy8gICBib2R5ICAgICAgICAtIG9wdGlvbmFsIHBhcmFncmFwaHMsIGVhY2ggc2hhcGVkIGxpa2UgdGl0bGVcbi8vICAgY29uZmlybVRleHQgLSBsYWJlbCBvZiB0aGUgYWN0aW9uIGJ1dHRvblxuLy8gICB3YXJuaW5nICAgICAtIGRlc3RydWN0aXZlIGFjdGlvbiAocmVkIGJ1dHRvbilcbi8vICAgZm9jdXMgICAgICAgLSBcImNvbmZpcm1cIiBvciBcImNhbmNlbFwiOiB3aGljaCBidXR0b24gRW50ZXIgdHJpZ2dlcnMuIFJlbmFtZVxuLy8gICAgICAgICAgICAgICAgIGZvY3VzZXMgdGhlIGFjdGlvbiwgZGVsZXRlIGFuZCBtZXJnZSBmb2N1cyBDYW5jZWwuXG4vLyAgIG9uQ29uZmlybSAvIG9uQ2FuY2VsIC0gb25DYW5jZWwgYWxzbyBjb3ZlcnMgRXNjYXBlIGFuZCBhIGNsaWNrIG91dHNpZGUuXG4vLyAgIGRvbnRBc2tBZ2FpbiAtIG9wdGlvbmFsOiBzaG93cyBPYnNpZGlhbidzIFwiRG9uJ3QgYXNrIGFnYWluXCIgY2hlY2tib3ggKGFzXG4vLyAgICAgICAgICAgICAgICAgaW4gaXRzIFwiRGVsZXRlIGZpbGVcIiwgZGVza3RvcCBvbmx5KSBhbmQgcGFzc2VzIGl0cyBzdGF0ZSB0b1xuLy8gICAgICAgICAgICAgICAgIG9uQ29uZmlybShkb250QXNrQWdhaW4pLiBPbmx5IGZvciBkaWFsb2dzIHRoYXQgbWF5IGJlXG4vLyAgICAgICAgICAgICAgICAgc3dpdGNoZWQgb2ZmLCBpLmUuIGFjdGlvbnMgdGhhdCBjYW4gYmUgdW5kb25lLlxuLy9cbi8vIEJvdGggY2FsbGJhY2tzIHJ1biBmcm9tIG9uQ2xvc2UsIGkuZS4gb25jZSB0aGUgZGlhbG9nIGlzIGdvbmUgLSBhcyBiZWZvcmVcbi8vIHRoZSBzd2l0Y2ggdG8gQ29uZmlybWF0aW9uTW9kYWwsIGFuZCBzbyBhIGxvbmcgb25Db25maXJtIChyZXdyaXRpbmcgbWFueVxuLy8gbm90ZXMpIG5laXRoZXIga2VlcHMgdGhlIGRpYWxvZyBvcGVuIG5vciBydW5zIHR3aWNlLlxuY2xhc3MgQ29uZmlybU1vZGFsIGV4dGVuZHMgQ29uZmlybWF0aW9uTW9kYWwge1xuICBjb25zdHJ1Y3RvcihhcHAsIHsgdGl0bGUsIGJvZHkgPSBbXSwgY29uZmlybVRleHQsIHdhcm5pbmcgPSBmYWxzZSwgZm9jdXMgPSBcImNvbmZpcm1cIiwgZG9udEFza0FnYWluID0gZmFsc2UsIG9uQ29uZmlybSwgb25DYW5jZWwgfSkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy50aXRsZSA9IHRpdGxlO1xuICAgIHRoaXMuYm9keSA9IGJvZHk7XG4gICAgdGhpcy5vbkNvbmZpcm0gPSBvbkNvbmZpcm07XG4gICAgdGhpcy5vbkNhbmNlbCA9IG9uQ2FuY2VsO1xuICAgIHRoaXMuY29uZmlybWVkID0gZmFsc2U7XG4gICAgdGhpcy5kb250QXNrQWdhaW4gPSBmYWxzZTtcblxuICAgIC8vIEJlZm9yZSB0aGUgYnV0dG9ucywgc28gaXQgc2l0cyBvbiB0aGUgbGVmdCBhcyBpbiBPYnNpZGlhbidzIGRpYWxvZ3MuXG4gICAgaWYgKGRvbnRBc2tBZ2FpbiAmJiAhUGxhdGZvcm0uaXNNb2JpbGUpIHtcbiAgICAgIHRoaXMuYWRkQ2hlY2tib3goXCJEb24ndCBhc2sgYWdhaW5cIiwgKGNoZWNrZWQpID0+IHtcbiAgICAgICAgdGhpcy5kb250QXNrQWdhaW4gPSBjaGVja2VkO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gQnV0dG9ucyBhbHJlYWR5IGhlcmUsIG5vdCBpbiBvbk9wZW46IENvbmZpcm1hdGlvbk1vZGFsLm9wZW4oKSBsb29rcyBmb3JcbiAgICAvLyB0aGUgaW5pdGlhbC1mb2N1cyBidXR0b24gYmVmb3JlIGl0IGNhbGxzIG9uT3Blbi5cbiAgICB0aGlzLmFkZEJ1dHRvbigoYnV0dG9uKSA9PiB7XG4gICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIkNhbmNlbFwiKS5zZXRDYW5jZWwoKTtcbiAgICAgIGlmIChmb2N1cyA9PT0gXCJjYW5jZWxcIikgYnV0dG9uLnNldEluaXRpYWxGb2N1cygpO1xuICAgIH0pO1xuICAgIHRoaXMuYWRkQnV0dG9uKChidXR0b24pID0+IHtcbiAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KGNvbmZpcm1UZXh0KS5zZXRDdGEoKTtcbiAgICAgIGlmICh3YXJuaW5nKSBidXR0b24uc2V0RGVzdHJ1Y3RpdmUoKTtcbiAgICAgIGlmIChmb2N1cyA9PT0gXCJjb25maXJtXCIpIGJ1dHRvbi5zZXRJbml0aWFsRm9jdXMoKTtcbiAgICAgIC8vIEJyYWNlcywgbm8gcmV0dXJuIHZhbHVlOiBDb25maXJtYXRpb25CdXR0b24ga2VlcHMgdGhlIGRpYWxvZyBvcGVuIGlmXG4gICAgICAvLyB0aGUgaGFuZGxlciByZXR1cm5zIHNvbWV0aGluZyB0cnV0aHksIGFuZCB3YWl0cyBmb3IgYSBwcm9taXNlLlxuICAgICAgYnV0dG9uLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpcm1lZCA9IHRydWU7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICBhcHBlbmRQYXJ0cyh0aGlzLnRpdGxlRWwsIHRoaXMudGl0bGUpO1xuICAgIGZvciAoY29uc3QgcGFyYWdyYXBoIG9mIHRoaXMuYm9keSkgYXBwZW5kUGFydHModGhpcy5jb250ZW50RWwuY3JlYXRlRWwoXCJwXCIpLCBwYXJhZ3JhcGgpO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICBzdXBlci5vbkNsb3NlKCk7XG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcbiAgICBpZiAodGhpcy5jb25maXJtZWQpIHRoaXMub25Db25maXJtPy4odGhpcy5kb250QXNrQWdhaW4pO1xuICAgIGVsc2UgdGhpcy5vbkNhbmNlbD8uKCk7XG4gIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IENvbmZpcm1Nb2RhbCwgYXBwZW5kVHlwTmFtZSwgYXBwZW5kU3VidHlwTmFtZSwgdHlwTmFtZU5vZGUsIHN1YnR5cE5hbWVOb2RlIH07XG4iLCAiY29uc3QgeyBOb3RpY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcblxuLy8gVW5kbyBmb3IgdGhlIGFjdGlvbnMgdGhhdCBydW4gd2l0aG91dCBhc2tpbmcgKGRlbGV0ZSBhIFN1YnR5cCwgcmVtb3ZlIGFcbi8vIHNob3J0Y3V0LCB0b2dnbGUgZmxvYXRpbmcsIHJlc2V0IGEgY29sb3IpOiBhIG5vdGljZSB3aXRoIGFuIFwiVW5kb1wiIGJ1dHRvblxuLy8gcmlnaHQgYWZ0ZXIgdGhlIGFjdGlvbi4gT25seSBwbHVnaW4gc2V0dGluZ3MsIG5ldmVyIG5vdGVzLCBhbmQgb25seSB0aGVcbi8vIExBU1QgYWN0aW9uIC0gYSBuZXcgb2ZmZXIgcmVwbGFjZXMgdGhlIHByZXZpb3VzIG9uZSwgc28gdGhlcmUgaXMgbm8gaGlzdG9yeVxuLy8gYW5kIG5vIGNvbW1hbmQuXG4vL1xuLy8gUGF0dGVybiBhdCB0aGUgY2FsbCBzaXRlOiBzbmFwc2hvdCA9IHNuYXBzaG90U2V0dGluZ3MocGx1Z2luKSBiZWZvcmUgdGhlXG4vLyBjaGFuZ2UsIHRoZW4gdGhlIGFjdGlvbiBhcyB1c3VhbCAoaW5jbHVkaW5nIHNhdmVTZXR0aW5ncygpKSwgdGhlblxuLy8gb2ZmZXJVbmRvKCkuIG9mZmVyVW5kbygpIG11c3QgY29tZSBhZnRlciBzYXZlU2V0dGluZ3MoKSBoYXMgYmVlbiBDQUxMRUQgKG5vdFxuLy8gbmVjZXNzYXJpbHkgYXdhaXRlZCksIHNpbmNlIHRoYXQgaXMgd2hhdCBidW1wcyBzZXR0aW5nc1JldmlzaW9uLlxuXG5jb25zdCBVTkRPX05PVElDRV9EVVJBVElPTiA9IDgwMDA7XG5cbi8vIHsgdG9rZW4sIHJldmlzaW9uLCBzbmFwc2hvdCB9IG9mIHRoZSBsYXN0IGFjdGlvbiwgb3IgbnVsbC5cbmxldCBjdXJyZW50ID0gbnVsbDtcblxuLy8gVGhlIHNldHRpbmdzIGFyZSBwbGFpbiBKU09OLCBzbyBzdHJ1Y3R1cmVkQ2xvbmUgaXMgYSBjb21wbGV0ZSBjb3B5LlxuZnVuY3Rpb24gc25hcHNob3RTZXR0aW5ncyhwbHVnaW4pIHtcbiAgcmV0dXJuIHN0cnVjdHVyZWRDbG9uZShwbHVnaW4uc2V0dGluZ3MpO1xufVxuXG5mdW5jdGlvbiBvZmZlclVuZG8ocGx1Z2luLCBtZXNzYWdlLCBzbmFwc2hvdCkge1xuICBjb25zdCB0b2tlbiA9IHt9O1xuICAvLyBzZXR0aW5nc1JldmlzaW9uIGNvdW50cyBldmVyeSBzYXZlIGFuZCBldmVyeSBleHRlcm5hbCByZWxvYWQgKHNlZVxuICAvLyBzYXZlU2V0dGluZ3MgaW4gbWFpbi5qcykuIElmIGl0IG1vdmVkIG9uIGJ5IHRoZSB0aW1lIFVuZG8gaXMgY2xpY2tlZCxcbiAgLy8gc29tZXRoaW5nIGVsc2UgY2hhbmdlZCB0aGUgc2V0dGluZ3MgaW4gYmV0d2VlbiAtIHJlc3RvcmluZyB0aGUgc25hcHNob3RcbiAgLy8gd291bGQgc2lsZW50bHkgcmV2ZXJ0IHRoYXQgdG9vLlxuICBjdXJyZW50ID0geyB0b2tlbiwgcmV2aXNpb246IHBsdWdpbi5zZXR0aW5nc1JldmlzaW9uID8/IDAsIHNuYXBzaG90IH07XG4gIGNvbnN0IGZyYWdtZW50ID0gY3JlYXRlRnJhZ21lbnQoKGYpID0+IHtcbiAgICBmLmFwcGVuZFRleHQobWVzc2FnZSk7XG4gICAgLy8gT2JzaWRpYW4gaGlkZXMgdGhlIG5vdGljZSBvbiBhbnkgY2xpY2sgaW5zaWRlIGl0LCB0aGUgYnV0dG9uIGluY2x1ZGVkLlxuICAgIGNvbnN0IGJ1dHRvbiA9IGYuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IFwidHlwLXVuZG8tYnV0dG9uXCIsIHRleHQ6IFwiVW5kb1wiIH0pO1xuICAgIGJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdW5kbyhwbHVnaW4sIHRva2VuKSk7XG4gIH0pO1xuICBuZXcgTm90aWNlKGZyYWdtZW50LCBVTkRPX05PVElDRV9EVVJBVElPTik7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHVuZG8ocGx1Z2luLCB0b2tlbikge1xuICBpZiAoY3VycmVudD8udG9rZW4gIT09IHRva2VuIHx8IChwbHVnaW4uc2V0dGluZ3NSZXZpc2lvbiA/PyAwKSAhPT0gY3VycmVudC5yZXZpc2lvbikge1xuICAgIG5ldyBOb3RpY2UoXCJDYW4ndCB1bmRvIFx1MjAxMyB0aGUgc2V0dGluZ3MgaGF2ZSBjaGFuZ2VkIHNpbmNlLlwiKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgeyBzbmFwc2hvdCB9ID0gY3VycmVudDtcbiAgY3VycmVudCA9IG51bGw7XG4gIC8vIEluIHBsYWNlLCBzbyBldmVyeSByZWZlcmVuY2UgdG8gcGx1Z2luLnNldHRpbmdzIHN0YXlzIHZhbGlkLiBUaGUgc25hcHNob3RcbiAgLy8gaXMgdXNlZCBvbmx5IG9uY2UsIG5vIHNlY29uZCBjb3B5IG5lZWRlZC5cbiAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMocGx1Z2luLnNldHRpbmdzKSkgZGVsZXRlIHBsdWdpbi5zZXR0aW5nc1trZXldO1xuICBPYmplY3QuYXNzaWduKHBsdWdpbi5zZXR0aW5ncywgc25hcHNob3QpO1xuICBhd2FpdCBwbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gIC8vIFRoZSBmdWxsIHJlZnJlc2ggb24gcHVycG9zZTogaXQgcmUtcmVuZGVycyB0aGUgVFlQLVBhbmUsIHdob3NlIGZyb250bWF0dGVyXG4gIC8vIGVkaXRvcnMgb25seSByZWFkIHRoZSBzZXR0aW5ncyB3aGVuIG1vdW50ZWQuXG4gIHBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHNuYXBzaG90U2V0dGluZ3MsIG9mZmVyVW5kbyB9O1xuIiwgImNvbnN0IHsgbW9tZW50IH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5cbi8vIEEgc2hvcnRjdXQgaXMgYSB2YWx1ZSBjb21wdXRlZCBvbmx5IHdoZW4gYSBub3RlIGlzIGNyZWF0ZWQuIEl0IGlzIHN0b3JlZFxuLy8gTkVYVCBUTyB0aGUgcHJvcGVydHkncyBmcm9udG1hdHRlciB2YWx1ZSwgbm90IGluIGl0OiBpblxuLy8gc2V0dGluZ3MudHlwU2hvcnRjdXRzW1RZUF1ba2V5XSBmb3IgdGhlIFRZUC1Gcm9udG1hdHRlciwgb3IgaW4gdGhlIHNob3J0Y3V0c1xuLy8gb2JqZWN0IG9mIGEgU3VidHlwIGJsb2NrIChzZWUgc3VidHlwcy5qcyk6XG4vLyAgIHsgbmFtZTogXCJ0b2RheVwiIH0gICAgICAgICAgICAtIGZpeGVkIHRva2VuLCByZXNvbHZlZCBieSB0aGUgcGx1Z2luXG4vLyAgIHsgbmFtZTogXCJ0cC48c2NyaXB0PlwiIH0gICAgICAtIFRlbXBsYXRlciBzY3JpcHQsIG9ubHkgVFlQLmpzIGNhbiByZXNvbHZlIGl0XG4vLyAgIHsgbmFtZTogXCJ0cC48c2NyaXB0PlwiLCBhcmdzOiB7IGZvbGRlcjogXCJMaXRlcmF0dXJcIiwgeWVhcjogMjAyNCB9IH1cbi8vICAgICAtIHRoZSBzYW1lIHdpdGggYXJndW1lbnRzLiBUaGUgc2NyaXB0IGRlY2xhcmVzIHRoZSBwYXJhbWV0ZXIgbmFtZXMgaW5cbi8vICAgICAgIGl0cyBAdHlwLXNob3J0Y3V0IG1hcmtlciAoc2VlIHNob3J0Y3V0LXNjcmlwdHMuanMpOyBUWVAuanMgcGFzc2VzIHRoZVxuLy8gICAgICAgb2JqZWN0IG9uIGFzIGN0eC5hcmdzLiBGaXhlZCB0b2tlbnMgbmV2ZXIgaGF2ZSBhcmd1bWVudHMuXG4vL1xuLy8gV2h5IG5leHQgdG8gdGhlIHZhbHVlOiBPYnNpZGlhbiBwaWNrcyBhIHJvdydzIGlucHV0IGZyb20gdGhlIHByb3BlcnR5IHR5cGVcbi8vIGluIHR5cGVzLmpzb24uIEEgZGF0ZS9udW1iZXIvY2hlY2tib3ggcHJvcGVydHkgY2FuJ3QgdGFrZSBhIHRva2VuIGxpa2Vcbi8vIFwie3t0b2RheX19XCIgYXQgYWxsLCBhIHN0b3JlZCBvbmUgdHJpZ2dlcnMgdGhlIFwiVHlwZSBtaXNtYXRjaFwiIHdhcm5pbmcsIGFuZFxuLy8gdGhlIGxpc3Qgd2lkZ2V0IHNpbGVudGx5IHR1cm5zIGEgc3RyaW5nIGludG8gYW4gYXJyYXkgb24gZmlyc3QgZWRpdC4gS2VwdFxuLy8gYXBhcnQsIHRoZSB2YWx1ZSBzdGF5cyB0eXBlLWNsZWFuIGFuZCB0aGUgbmF0aXZlIHdpZGdldCB1bnRvdWNoZWQuXG4vL1xuLy8gVGhlIGZyb250bWF0dGVyIHZhbHVlIHN0YXlzIGFuZCBzZXJ2ZXMgYXMgRkFMTEJBQ0s6IGlmIHRoZSBzY3JpcHQgaXMgbWlzc2luZ1xuLy8gb3IgdGhyb3dzLCBUWVAuanMgd3JpdGVzIGl0IGluc3RlYWQgb2YgYW4gZW1wdHkgdmFsdWUuIEEgc2NyaXB0IHRoYXRcbi8vIGRlbGliZXJhdGVseSByZXR1cm5zIG51bGwvXCJcIiAoZS5nLiBFU0MgaW4gYSBwaWNrZXIpIGlzIG5vdCBhIGZhaWx1cmUgYW5kXG4vLyBsZWF2ZXMgdGhlIHByb3BlcnR5IGVtcHR5LlxuXG4vLyBUb2tlbnMgdGhlIHBsdWdpbiByZXNvbHZlcyBpdHNlbGYsIHdpdGhvdXQgVGVtcGxhdGVyIC0gc28gZ2V0VHlwRGVmYXVsdHMoKVxuLy8gZmlsbHMgdGhlbSBpbi4gUmVzb2x2ZWQgb24gZWFjaCBjYWxsLCBub3Qgd2hlbiBzZXQsIHNvIFwidG9kYXlcIiBpcyB0aGUgZGF5XG4vLyB0aGUgbm90ZSBpcyBjcmVhdGVkLlxuY29uc3QgRklYRURfU0hPUlRDVVRTID0gW1xuICB7XG4gICAgbmFtZTogXCJ0b2RheVwiLFxuICAgIGRlc2NyaXB0aW9uOiBcIkhldXRpZ2VzIERhdHVtIChKSkpKLU1NLVRUKVwiLFxuICAgIHJlc29sdmU6ICgpID0+IG1vbWVudCgpLmZvcm1hdChcIllZWVktTU0tRERcIiksXG4gIH0sXG4gIHtcbiAgICBuYW1lOiBcIm5vd1wiLFxuICAgIGRlc2NyaXB0aW9uOiBcIkFrdHVlbGxlcyBEYXR1bSBtaXQgVWhyemVpdCAoSkpKSi1NTS1UVCBISDptbSlcIixcbiAgICByZXNvbHZlOiAoKSA9PiBtb21lbnQoKS5mb3JtYXQoXCJZWVlZLU1NLUREIEhIOm1tXCIpLFxuICB9LFxuICB7XG4gICAgLy8gVGhlIGZpbGUncyBjcmVhdGlvbiBkYXRlIChmaWxlLnN0YXQuY3RpbWUpLCBub3QgdGhlIGNhbGwgdGltZTsgZmFsbHNcbiAgICAvLyBiYWNrIHRvIG5vdyB3aXRob3V0IGEgZmlsZS5cbiAgICBuYW1lOiBcImNyZWF0ZWRcIixcbiAgICBkZXNjcmlwdGlvbjogXCJFcnN0ZWxsdW5nc2RhdHVtIGRlciBEYXRlaSAoSkpKSi1NTS1UVClcIixcbiAgICByZXNvbHZlOiAoZmlsZSkgPT4gbW9tZW50KGZpbGU/LnN0YXQ/LmN0aW1lID8/IERhdGUubm93KCkpLmZvcm1hdChcIllZWVktTU0tRERcIiksXG4gIH0sXG5dO1xuXG4vLyBTY3JpcHQgc2hvcnRjdXRzIGNhcnJ5IHRoaXMgcHJlZml4IHNvIGEgc2NyaXB0IGNhbiBuZXZlciBjb2xsaWRlIHdpdGggYVxuLy8gZml4ZWQgdG9rZW4sIG5vdCBldmVuIGEgXCJ0b2RheS5qc1wiIGluIHRoZSBzY3JpcHQgZm9sZGVyLlxuY29uc3QgU0NSSVBUX1BSRUZJWCA9IFwidHAuXCI7XG5cbmZ1bmN0aW9uIGZpbmRGaXhlZFNob3J0Y3V0KG5hbWUpIHtcbiAgcmV0dXJuIEZJWEVEX1NIT1JUQ1VUUy5maW5kKChzaG9ydGN1dCkgPT4gc2hvcnRjdXQubmFtZSA9PT0gbmFtZSkgPz8gbnVsbDtcbn1cblxuLy8gU2NyaXB0IG5hbWUgb2YgYSBcInRwLjxzY3JpcHQ+XCIgc2hvcnRjdXQsIG90aGVyd2lzZSBudWxsLiBUaGUgc2NyaXB0IG5hbWUgaXNcbi8vIHRoZSBmaWxlIG5hbWUgd2l0aG91dCBcIi5qc1wiLCBzbyB1bWxhdXRzLCBcIi1cIiBhbmQgc3BhY2VzIGFyZSBhbGxvd2VkLlxuZnVuY3Rpb24gc2NyaXB0TmFtZU9mKG5hbWUpIHtcbiAgcmV0dXJuIHR5cGVvZiBuYW1lID09PSBcInN0cmluZ1wiICYmIG5hbWUuc3RhcnRzV2l0aChTQ1JJUFRfUFJFRklYKSA/IG5hbWUuc2xpY2UoU0NSSVBUX1BSRUZJWC5sZW5ndGgpIDogbnVsbDtcbn1cblxuZnVuY3Rpb24gaXNTY3JpcHRTaG9ydGN1dChyZWNvcmQpIHtcbiAgcmV0dXJuIHNjcmlwdE5hbWVPZihyZWNvcmQ/Lm5hbWUpICE9PSBudWxsO1xufVxuXG4vLyBEaXNwbGF5IGZvcm0gaW4gdGhlIHByb3BlcnR5IHJvdyAoY2hpcCkgYW5kIHRoZSBwaWNrZXI6IHRoZSBiYXJlIG5hbWUgcGx1c1xuLy8gaXRzIGFyZ3VtZW50cy4gVGhlIGNoaXAgaXRzZWxmIG1hcmtzIGl0IGFzIGEgc2hvcnRjdXQsIHNvIG5vIGJyYWNlcy5cbmZ1bmN0aW9uIHNob3J0Y3V0TGFiZWwocmVjb3JkKSB7XG4gIGlmICghcmVjb3JkPy5uYW1lKSByZXR1cm4gXCJcIjtcbiAgY29uc3QgdmFsdWVzID0gT2JqZWN0LnZhbHVlcyhyZWNvcmQuYXJncyA/PyB7fSkuZmlsdGVyKCh2YWx1ZSkgPT4gdmFsdWUgIT09IHVuZGVmaW5lZCk7XG4gIHJldHVybiB2YWx1ZXMubGVuZ3RoID4gMCA/IGAke3JlY29yZC5uYW1lfTogJHt2YWx1ZXMuam9pbihcIiwgXCIpfWAgOiByZWNvcmQubmFtZTtcbn1cblxuLy8gQ29udmVydHMgYSB0eXBlZCBhcmd1bWVudCB0byB0aGUgdHlwZSBpdCBvYnZpb3VzbHkgbWVhbnMsIHNvIGEgc2NyaXB0IGdldHNcbi8vIDUgYXMgYSBudW1iZXIgYW5kIHRydWUgYXMgYSBib29sZWFuIChtYXR0ZXJzIHdoZW4gdGhlIHZhbHVlIGxhbmRzIGluIGFcbi8vIG51bWJlciBwcm9wZXJ0eSkuIERlbGliZXJhdGVseSB0aGVzZSBmZXcgY2FzZXMgaW5zdGVhZCBvZiBKU09OLnBhcnNlLCB3aGljaFxuLy8gd291bGQgZmFpbCBvbiBcIkxpdGVyYXR1clwiLiBBbiBlbXB0eSBmaWVsZCBtZWFucyBcIm5vdCBzZXRcIiAodW5kZWZpbmVkKSBhbmRcbi8vIGRyb3BzIG91dCBvZiB0aGUgYXJndW1lbnQgb2JqZWN0LCBzbyBcImFyZ3MueWVhciA/PyBmYWxsYmFja1wiIHdvcmtzLlxuZnVuY3Rpb24gcGFyc2VBcmdWYWx1ZShyYXcpIHtcbiAgY29uc3QgdGV4dCA9IFN0cmluZyhyYXcgPz8gXCJcIikudHJpbSgpO1xuICBpZiAodGV4dCA9PT0gXCJcIikgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKHRleHQgPT09IFwidHJ1ZVwiKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKHRleHQgPT09IFwiZmFsc2VcIikgcmV0dXJuIGZhbHNlO1xuICBpZiAodGV4dCA9PT0gXCJudWxsXCIpIHJldHVybiBudWxsO1xuICBpZiAoL14tP1xcZCsoPzpcXC5cXGQrKT8kLy50ZXN0KHRleHQpKSByZXR1cm4gTnVtYmVyKHRleHQpO1xuICByZXR1cm4gdGV4dDtcbn1cblxuLy8gUGFyYW1ldGVyIG5hbWVzIHdob3NlIHZhbHVlcyB0aGUgcGx1Z2luIG9yIFRZUC5qcyBhbHJlYWR5IGtub3c7IHRoZXkgYXJlXG4vLyBmaWxsZWQgaW4gYXQgY2FsbCB0aW1lLCBub3QgYXNrZWQgZm9yOlxuLy8gICBuZXdGaWxlICB0aGUgbmV3bHkgY3JlYXRlZCBub3RlXG4vLyAgIGN0eCAgICAgIHRoZSBjb250ZXh0IHsgdHlwLCBzdWJ0eXAsIGtleSwgdmFsdWVzLCBhZnRlciwgYXJncyB9XG4vLyAgIGtleSAgICAgIHRoZSBwcm9wZXJ0eSB0aGUgc2hvcnRjdXQgc2l0cyBvbiwgc28gYSBzY3JpcHQgbGlrZSByZWxhdGlvbi5qc1xuLy8gICAgICAgICAgICBnZXRzIHRoZSByaWdodCBvbmUgd2hlcmV2ZXIgdGhlIHNob3J0Y3V0IGlzIHVzZWRcbi8vIFwidHBcIiBhbHdheXMgY29tZXMgZmlyc3QgYW5kIG5lZWRuJ3QgYmUgZGVjbGFyZWQ7IGlmIGl0IGlzLCBpdCBpcyBza2lwcGVkLlxuY29uc3QgUkVTRVJWRURfUEFSQU1TID0gW1wibmV3RmlsZVwiLCBcImN0eFwiLCBcImtleVwiXTtcblxuLy8gUGFyYW1ldGVycyB0aGF0IGdldCBhbiBpbnB1dCBmaWVsZDogZXZlcnl0aGluZyBub3QgcmVzZXJ2ZWQuIHBhcmFtcyA9PT0gbnVsbFxuLy8gKG1hcmtlciB3aXRob3V0IHBhcmVudGhlc2VzKSBtZWFucyB0aGUgY2xhc3NpYyBjYWxsLCBhbHNvIHdpdGhvdXQgZmllbGRzLlxuZnVuY3Rpb24gaW5wdXRQYXJhbXMocGFyYW1zKSB7XG4gIHJldHVybiAocGFyYW1zID8/IFtdKS5maWx0ZXIoKG5hbWUpID0+IG5hbWUgIT09IFwidHBcIiAmJiAhUkVTRVJWRURfUEFSQU1TLmluY2x1ZGVzKG5hbWUpKTtcbn1cblxuLy8gSW5wdXRzIChvbmUgc3RyaW5nIHBlciBwYXJhbWV0ZXIpIHRvIHRoZSBzdG9yZWQgYXJndW1lbnQgb2JqZWN0LCBpbiB0aGVcbi8vIGRlY2xhcmVkIG9yZGVyIHNvIHNob3J0Y3V0TGFiZWwoKSBzaG93cyB0aGVtIHRoYXQgd2F5LiBFbXB0eSBmaWVsZHMgYXJlIGxlZnRcbi8vIG91dC5cbmZ1bmN0aW9uIGJ1aWxkQXJncyhwYXJhbXMsIGlucHV0cykge1xuICBjb25zdCBhcmdzID0ge307XG4gIGZvciAoY29uc3QgbmFtZSBvZiBpbnB1dFBhcmFtcyhwYXJhbXMpKSB7XG4gICAgY29uc3QgdmFsdWUgPSBwYXJzZUFyZ1ZhbHVlKGlucHV0c1tuYW1lXSk7XG4gICAgaWYgKHZhbHVlICE9PSB1bmRlZmluZWQpIGFyZ3NbbmFtZV0gPSB2YWx1ZTtcbiAgfVxuICByZXR1cm4gYXJncztcbn1cblxuLy8gQnVpbGRzIHRoZSBhcmd1bWVudHMgZm9yIGYodHAsIC4uLmhlcmUpIGZyb20gdGhlIGRlY2xhcmVkIHBhcmFtZXRlciBsaXN0LlxuLy8gQ2FsbGVkIGZyb20gVFlQLmpzLCB0aGUgb25seSBwbGFjZSB0aGF0IGtub3dzIG5ld0ZpbGUgYW5kIGN0eC5cbi8vXG4vLyBXaXRob3V0IHBhcmVudGhlc2VzIChwYXJhbXMgPT09IG51bGwpIGl0IHN0YXlzIHRoZSBjbGFzc2ljIGYodHAsIG5ld0ZpbGUsXG4vLyBjdHgpLiBPdGhlcndpc2UgZWFjaCBlbnRyeSByZXNvbHZlcyB0byB0aGUgcGFzc2VkIHZhbHVlIChyZXNlcnZlZCBuYW1lcykgb3Jcbi8vIHRoZSB0eXBlZCBhcmd1bWVudC5cbi8vXG4vLyBBIGRvdHRlZCBuYW1lIChcIm9wdGlvbnMudHlwXCIpIGlzIGEgRklFTEQgb2YgYW4gb2JqZWN0IGFyZ3VtZW50OiBhbGxcbi8vIFwib3B0aW9ucy4qXCIgY29sbGVjdCBpbnRvIG9uZSBvYmplY3QgYXQgdGhlIHBvc2l0aW9uIG9mIHRoZSBmaXJzdCBvbmUuIFRoaXNcbi8vIHNlcnZlcyBzY3JpcHRzIHRoYXQgdGFrZSBhbiBvcHRpb25zIG9iamVjdCB3aXRob3V0IHR5cGluZyBKU09OLiBPbmUgbGV2ZWxcbi8vIG9ubHkgLSBcImEuYi5jXCIgZ2l2ZXMgYSBmaWVsZCBsaXRlcmFsbHkgbmFtZWQgXCJiLmNcIi5cbmZ1bmN0aW9uIHJlc29sdmVDYWxsQXJncyhwYXJhbXMsIGFyZ3MsIHJlc2VydmVkID0ge30pIHtcbiAgaWYgKHBhcmFtcyA9PT0gbnVsbCB8fCBwYXJhbXMgPT09IHVuZGVmaW5lZCkgcmV0dXJuIFtyZXNlcnZlZC5uZXdGaWxlLCByZXNlcnZlZC5jdHhdO1xuXG4gIGNvbnN0IGNhbGxBcmdzID0gW107XG4gIGNvbnN0IG9iamVjdEluZGV4ID0gbmV3IE1hcCgpO1xuICBmb3IgKGNvbnN0IG5hbWUgb2YgcGFyYW1zKSB7XG4gICAgaWYgKG5hbWUgPT09IFwidHBcIikgY29udGludWU7XG4gICAgaWYgKFJFU0VSVkVEX1BBUkFNUy5pbmNsdWRlcyhuYW1lKSkge1xuICAgICAgY2FsbEFyZ3MucHVzaChyZXNlcnZlZFtuYW1lXSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgZG90ID0gbmFtZS5pbmRleE9mKFwiLlwiKTtcbiAgICBpZiAoZG90ID09PSAtMSkge1xuICAgICAgY2FsbEFyZ3MucHVzaChhcmdzPy5bbmFtZV0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGJhc2UgPSBuYW1lLnNsaWNlKDAsIGRvdCk7XG4gICAgaWYgKCFvYmplY3RJbmRleC5oYXMoYmFzZSkpIHtcbiAgICAgIG9iamVjdEluZGV4LnNldChiYXNlLCBjYWxsQXJncy5sZW5ndGgpO1xuICAgICAgY2FsbEFyZ3MucHVzaCh7fSk7XG4gICAgfVxuICAgIGNvbnN0IHZhbHVlID0gYXJncz8uW25hbWVdO1xuICAgIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkKSBjYWxsQXJnc1tvYmplY3RJbmRleC5nZXQoYmFzZSldW25hbWUuc2xpY2UoZG90ICsgMSldID0gdmFsdWU7XG4gIH1cbiAgcmV0dXJuIGNhbGxBcmdzO1xufVxuXG4vLyBXaGV0aGVyIHR5cGVzLmpzb24gKG9yLCBpZiB1bnNldCwgdGhlIHByb3BlcnR5J3MgdXNhZ2UpIGRlY2xhcmVzIGEgbGlzdC5cbi8vIFRoZW4gYSByZXNvbHZlZCBzaG9ydGN1dCB2YWx1ZSBpcyB3cmFwcGVkIGluIGEgb25lLWVsZW1lbnQgYXJyYXkgdG8gbWF0Y2guXG4vLyBXaXRob3V0IGFwcCAodGVzdHMpIG5vdGhpbmcgaXMgd3JhcHBlZC5cbmZ1bmN0aW9uIGlzTGlzdFByb3BlcnR5KGFwcCwga2V5KSB7XG4gIHJldHVybiBhcHA/Lm1ldGFkYXRhVHlwZU1hbmFnZXI/LmdldFR5cGVJbmZvPy4oa2V5KT8uZXhwZWN0ZWQ/LnR5cGUgPT09IFwibXVsdGl0ZXh0XCI7XG59XG5cbi8vIENvcHkgb2YgZnJvbnRtYXR0ZXIgaW4gd2hpY2ggZXZlcnkga2V5IHdpdGggYSBzaG9ydGN1dCBjYXJyaWVzIGl0cyB2YWx1ZTpcbi8vICAgLSBmaXhlZCB0b2tlbiAtPiByZXNvbHZlZCAod3JhcHBlZCBmb3IgbGlzdCBwcm9wZXJ0aWVzKSxcbi8vICAgLSBcInRwLjxzY3JpcHQ+XCIgLT4gbnVsbDsgb25seSBUZW1wbGF0ZXIgY2FuIHJlc29sdmUgaXQsIFRZUC5qcyBnZXRzIHRoZXNlXG4vLyAgICAga2V5cyBmcm9tIGdldFR5cFNob3J0Y3V0cygpIGFuZCBmaWxscyB0aGVtIGluIGl0c2VsZi5cbi8vIEtleXMgd2l0aG91dCBhIHNob3J0Y3V0IHN0YXkgYXMgdGhleSBhcmUuIFRoZSBzdG9yZWQgdmFsdWUgb2YgYSBrZXkgV0lUSCBhXG4vLyBzaG9ydGN1dCBpcyBvbmx5IG92ZXJyaWRkZW4gaGVyZSwgbmV2ZXIgZGVsZXRlZCAtIGl0IGlzIHRoZSBmYWxsYmFjay5cbmZ1bmN0aW9uIHJlc29sdmVTaG9ydGN1dHMoZnJvbnRtYXR0ZXIsIHNob3J0Y3V0cywgeyBmaWxlLCBhcHAgfSA9IHt9KSB7XG4gIGNvbnN0IHJlc29sdmVkID0ge307XG4gIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGZyb250bWF0dGVyKSkge1xuICAgIGNvbnN0IHJlY29yZCA9IHNob3J0Y3V0cz8uW2tleV07XG4gICAgY29uc3QgZml4ZWQgPSByZWNvcmQgPyBmaW5kRml4ZWRTaG9ydGN1dChyZWNvcmQubmFtZSkgOiBudWxsO1xuICAgIGlmIChmaXhlZCkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gZml4ZWQucmVzb2x2ZShmaWxlKTtcbiAgICAgIHJlc29sdmVkW2tleV0gPSBpc0xpc3RQcm9wZXJ0eShhcHAsIGtleSkgPyBbcmVzdWx0XSA6IHJlc3VsdDtcbiAgICB9IGVsc2UgaWYgKGlzU2NyaXB0U2hvcnRjdXQocmVjb3JkKSkge1xuICAgICAgcmVzb2x2ZWRba2V5XSA9IG51bGw7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc29sdmVkW2tleV0gPSB2YWx1ZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlc29sdmVkO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgRklYRURfU0hPUlRDVVRTLFxuICBTQ1JJUFRfUFJFRklYLFxuICBmaW5kRml4ZWRTaG9ydGN1dCxcbiAgc2NyaXB0TmFtZU9mLFxuICBpc1NjcmlwdFNob3J0Y3V0LFxuICBzaG9ydGN1dExhYmVsLFxuICBwYXJzZUFyZ1ZhbHVlLFxuICBidWlsZEFyZ3MsXG4gIGlucHV0UGFyYW1zLFxuICByZXNvbHZlQ2FsbEFyZ3MsXG4gIFJFU0VSVkVEX1BBUkFNUyxcbiAgcmVzb2x2ZVNob3J0Y3V0cyxcbn07XG4iLCAiY29uc3QgeyBGdXp6eVN1Z2dlc3RNb2RhbCwgTW9kYWwsIFNldHRpbmcgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgRklYRURfU0hPUlRDVVRTLCBTQ1JJUFRfUFJFRklYLCBidWlsZEFyZ3MsIGlucHV0UGFyYW1zIH0gPSByZXF1aXJlKFwiLi9zaG9ydGN1dHNcIik7XG5cbi8vIExpc3QgbGFiZWw6IHRoZSBuYW1lLCBwbHVzIHRoZSBkZWNsYXJlZCBwYXJhbWV0ZXIgbmFtZXMgZm9yIGEgc2NyaXB0LCBzb1xuLy8gdGhlIHBpY2tlciBhbHJlYWR5IHNob3dzIHRoYXQgKGFuZCBob3cpIGl0IHRha2VzIGFyZ3VtZW50cy5cbmZ1bmN0aW9uIGl0ZW1MYWJlbChpdGVtKSB7XG4gIHJldHVybiBpdGVtLnBhcmFtcyA/IGAke2l0ZW0ubmFtZX0oJHtpdGVtLnBhcmFtcy5qb2luKFwiLCBcIil9KWAgOiBpdGVtLm5hbWU7XG59XG5cbi8vIFBpY2tzIGEgc2hvcnRjdXQgZm9yIGEgVFlQLUZyb250bWF0dGVyIHByb3BlcnR5IChidXR0b24gb3IgY2hpcCBpbiB0aGUgcm93LFxuLy8gc2VlIHR5cC1mcm9udG1hdHRlci1lZGl0b3IuanMpLiBTZWFyY2hhYmxlLCBhbmQgc2NyaXB0cyBzaG93IHRoZSBkZXNjcmlwdGlvblxuLy8gZnJvbSB0aGVpciBAdHlwLXNob3J0Y3V0IG1hcmtlci4gTmV2ZXIgZnJlZSB0ZXh0OiB0aGUgbGlzdCBpcyB0aGUgc291cmNlIG9mXG4vLyB0cnV0aCwgc28gYSB0eXBvIGluIGEgc2NyaXB0IG5hbWUgaXMgaW1wb3NzaWJsZS5cbmNsYXNzIFNob3J0Y3V0UGlja2VyTW9kYWwgZXh0ZW5kcyBGdXp6eVN1Z2dlc3RNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKGFwcCwga2V5LCBpdGVtcywgcmVzb2x2ZSkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5pdGVtcyA9IGl0ZW1zO1xuICAgIHRoaXMucmVzb2x2ZSA9IHJlc29sdmU7XG4gICAgdGhpcy5jaG9zZW4gPSBmYWxzZTtcbiAgICB0aGlzLnNldFBsYWNlaG9sZGVyKGBTaG9ydGN1dCBmXHUwMEZDciBcdTIwMUUke2tleX1cdTIwMUMgXHUyMDEzIEVTQyBmXHUwMEZDciBBYmJydWNoYCk7XG4gIH1cblxuICBnZXRJdGVtcygpIHtcbiAgICByZXR1cm4gdGhpcy5pdGVtcztcbiAgfVxuXG4gIC8vIEZ1enp5IHNlYXJjaCBhbHNvIGNvdmVycyB0aGUgZGVzY3JpcHRpb246IFwiRXJzdGVsbHVuZ3NkYXR1bVwiIGZpbmRzIFwiY3JlYXRlZFwiLlxuICBnZXRJdGVtVGV4dChpdGVtKSB7XG4gICAgY29uc3QgbGFiZWwgPSBpdGVtTGFiZWwoaXRlbSk7XG4gICAgcmV0dXJuIGl0ZW0uZGVzY3JpcHRpb24gPyBgJHtsYWJlbH0gJHtpdGVtLmRlc2NyaXB0aW9ufWAgOiBsYWJlbDtcbiAgfVxuXG4gIHJlbmRlclN1Z2dlc3Rpb24obWF0Y2gsIGVsKSB7XG4gICAgY29uc3QgaXRlbSA9IG1hdGNoLml0ZW07XG4gICAgZWwuYWRkQ2xhc3MoXCJ0eXAtc2hvcnRjdXQtc3VnZ2VzdGlvblwiKTtcbiAgICBlbC5jcmVhdGVFbChcImNvZGVcIiwgeyBjbHM6IFwidHlwLXNob3J0Y3V0LXN1Z2dlc3Rpb24tbmFtZVwiLCB0ZXh0OiBpdGVtTGFiZWwoaXRlbSkgfSk7XG4gICAgaWYgKGl0ZW0uZGVzY3JpcHRpb24pIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXNob3J0Y3V0LXN1Z2dlc3Rpb24tZGVzY1wiLCB0ZXh0OiBpdGVtLmRlc2NyaXB0aW9uIH0pO1xuICB9XG5cbiAgLy8gT2JzaWRpYW4ncyBzZWxlY3RTdWdnZXN0aW9uKCkgY2FsbHMgY2xvc2UoKSBCRUZPUkUgb25DaG9vc2VJdGVtKCksIHNvXG4gIC8vIFwiY2hvc2VuXCIgbXVzdCBiZSBzZXQgaGVyZSAtIG90aGVyd2lzZSBvbkNsb3NlKCkgcmVzb2x2ZXMgd2l0aCBudWxsIGZpcnN0XG4gIC8vIGFuZCB0aGUgY2hvaWNlIGlzIGxvc3QuIFNhbWUgYXMgaW4gVHlwUGlja2VyTW9kYWwgKHR5cC1waWNrZXIuanMpLlxuICBzZWxlY3RTdWdnZXN0aW9uKGl0ZW0sIGV2dCkge1xuICAgIHRoaXMuY2hvc2VuID0gdHJ1ZTtcbiAgICBzdXBlci5zZWxlY3RTdWdnZXN0aW9uKGl0ZW0sIGV2dCk7XG4gIH1cblxuICBvbkNob29zZUl0ZW0oaXRlbSkge1xuICAgIHRoaXMucmVzb2x2ZShpdGVtKTtcbiAgfVxuXG4gIG9uQ2xvc2UoKSB7XG4gICAgc3VwZXIub25DbG9zZSgpO1xuICAgIGlmICghdGhpcy5jaG9zZW4pIHRoaXMucmVzb2x2ZShudWxsKTtcbiAgfVxufVxuXG4vLyBBc2tzIGZvciB0aGUgYXJndW1lbnRzIG9mIGEgc2NyaXB0IHRoYXQgZGVjbGFyZXMgc29tZTogb25lIGRpYWxvZyB3aXRoIGFsbFxuLy8gZmllbGRzLCBuYW1lZCBhZnRlciB0aGUgc2NyaXB0J3MgcGFyYW1ldGVycyBhbmQgcHJlZmlsbGVkIHdpdGggdGhlIHN0b3JlZFxuLy8gdmFsdWVzLCBzbyBwaWNraW5nIHRoZSBzYW1lIHNjcmlwdCBhZ2FpbiBpcyBob3cgc2luZ2xlIHZhbHVlcyBnZXQgZml4ZWQuXG4vLyBBbiBlbXB0eSBmaWVsZCBtZWFucyBcIm5vdCBzZXRcIiAoc2VlIGJ1aWxkQXJncyk7IHRoZXJlIGlzIG5vIHZhbGlkYXRpb24sXG4vLyBzaW5jZSBvbmx5IHRoZSBzY3JpcHQga25vd3Mgd2hhdCBpdCBuZWVkcy5cbmNsYXNzIFNob3J0Y3V0QXJnc01vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBjb25zdHJ1Y3RvcihhcHAsIGl0ZW0sIGV4aXN0aW5nLCByZXNvbHZlKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLml0ZW0gPSBpdGVtO1xuICAgIHRoaXMucmVzb2x2ZSA9IHJlc29sdmU7XG4gICAgdGhpcy5maWVsZHMgPSBpbnB1dFBhcmFtcyhpdGVtLnBhcmFtcyk7XG4gICAgdGhpcy5pbnB1dHMgPSB7fTtcbiAgICBmb3IgKGNvbnN0IG5hbWUgb2YgdGhpcy5maWVsZHMpIHtcbiAgICAgIGNvbnN0IHZhbHVlID0gZXhpc3Rpbmc/LltuYW1lXTtcbiAgICAgIHRoaXMuaW5wdXRzW25hbWVdID0gdmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gbnVsbCA/IFwiXCIgOiBTdHJpbmcodmFsdWUpO1xuICAgIH1cbiAgICB0aGlzLmNvbmZpcm1lZCA9IGZhbHNlO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIHRoaXMudGl0bGVFbC5zZXRUZXh0KGBBcmd1bWVudGUgZlx1MDBGQ3IgJHt0aGlzLml0ZW0ubmFtZX1gKTtcbiAgICBpZiAodGhpcy5pdGVtLmRlc2NyaXB0aW9uKSB7XG4gICAgICB0aGlzLmNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLXNob3J0Y3V0LWFyZ3MtZGVzY1wiLCB0ZXh0OiB0aGlzLml0ZW0uZGVzY3JpcHRpb24gfSk7XG4gICAgfVxuICAgIGZvciAoY29uc3QgbmFtZSBvZiB0aGlzLmZpZWxkcykge1xuICAgICAgbmV3IFNldHRpbmcodGhpcy5jb250ZW50RWwpLnNldE5hbWUobmFtZSkuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dFxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmlucHV0c1tuYW1lXSlcbiAgICAgICAgICAub25DaGFuZ2UoKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmlucHV0c1tuYW1lXSA9IHZhbHVlO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLy8gRW50ZXIgc3VibWl0cywgbGlrZSBPYnNpZGlhbidzIG93biByZW5hbWUgZGlhbG9ncy5cbiAgICAgICAgICAuaW5wdXRFbC5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCAoZXZlbnQpID0+IHtcbiAgICAgICAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRW50ZXJcIiAmJiAhZXZlbnQuaXNDb21wb3NpbmcpIHtcbiAgICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgICAgdGhpcy5zdWJtaXQoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9XG4gICAgbmV3IFNldHRpbmcodGhpcy5jb250ZW50RWwpLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgYnV0dG9uXG4gICAgICAgIC5zZXRCdXR0b25UZXh0KFwiXHUwMERDYmVybmVobWVuXCIpXG4gICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAub25DbGljaygoKSA9PiB0aGlzLnN1Ym1pdCgpKVxuICAgICk7XG4gIH1cblxuICBzdWJtaXQoKSB7XG4gICAgdGhpcy5jb25maXJtZWQgPSB0cnVlO1xuICAgIHRoaXMuY2xvc2UoKTtcbiAgfVxuXG4gIG9uQ2xvc2UoKSB7XG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcbiAgICAvLyBFU0Mgb3IgYSBjbGljayBvdXRzaWRlIGtlZXBzIHRoZSBjdXJyZW50IHNob3J0Y3V0IC0gYW4gYWNjaWRlbnRhbCBjbG9zZVxuICAgIC8vIG11c3Qgbm90IHNpbGVudGx5IGxvc2UgZGF0YS5cbiAgICB0aGlzLnJlc29sdmUodGhpcy5jb25maXJtZWQgPyBidWlsZEFyZ3ModGhpcy5maWVsZHMsIHRoaXMuaW5wdXRzKSA6IG51bGwpO1xuICB9XG59XG5cbi8vIE9wZW5zIHRoZSBwaWNrZXIgZm9yIHByb3BlcnR5IGBrZXlgLiBnZXRTY3JpcHRzIGlzIHRoZSBhY2Nlc3NvciBmcm9tXG4vLyByZWdpc3RlclNob3J0Y3V0U2NyaXB0cygpOyBjdXJyZW50IGlzIHRoZSBzaG9ydGN1dCBzZXQgbm93ICh0byBwcmVmaWxsIHRoZVxuLy8gYXJndW1lbnRzKS4gUmVzb2x2ZXMgd2l0aCB0aGUgbmV3IHJlY29yZCAoeyBuYW1lIH0gb3IgeyBuYW1lLCBhcmdzIH0pLCBvclxuLy8gbnVsbCBvbiBjYW5jZWwgLSBhbHNvIHdoZW4gYSBzY3JpcHQgd2FzIHBpY2tlZCBidXQgaXRzIGFyZ3VtZW50IGRpYWxvZyB3YXNcbi8vIGNhbmNlbGxlZC5cbmFzeW5jIGZ1bmN0aW9uIHBpY2tTaG9ydGN1dChhcHAsIGtleSwgZ2V0U2NyaXB0cywgY3VycmVudCA9IG51bGwpIHtcbiAgY29uc3QgaXRlbXMgPSBbXG4gICAgLi4uRklYRURfU0hPUlRDVVRTLm1hcCgoeyBuYW1lLCBkZXNjcmlwdGlvbiB9KSA9PiAoeyBuYW1lLCBkZXNjcmlwdGlvbiwgcGFyYW1zOiBudWxsIH0pKSxcbiAgICAuLi5nZXRTY3JpcHRzKCkubWFwKCh7IG5hbWUsIHBhcmFtcywgZGVzY3JpcHRpb24gfSkgPT4gKHsgbmFtZTogU0NSSVBUX1BSRUZJWCArIG5hbWUsIHBhcmFtcywgZGVzY3JpcHRpb24gfSkpLFxuICBdO1xuXG4gIGNvbnN0IGl0ZW0gPSBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gbmV3IFNob3J0Y3V0UGlja2VyTW9kYWwoYXBwLCBrZXksIGl0ZW1zLCByZXNvbHZlKS5vcGVuKCkpO1xuICBpZiAoIWl0ZW0pIHJldHVybiBudWxsO1xuICAvLyBObyBmaWVsZHMgdG8gYXNrIGZvciAoZml4ZWQgdG9rZW5zLCBvciBvbmx5IHJlc2VydmVkIG5hbWVzIGxpa2VcbiAgLy8gXCIobmV3RmlsZSlcIik6IG5vIHNlY29uZCBzdGVwLlxuICBpZiAoaW5wdXRQYXJhbXMoaXRlbS5wYXJhbXMpLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHsgbmFtZTogaXRlbS5uYW1lIH07XG5cbiAgLy8gUHJlZmlsbCBvbmx5IGZvciB0aGUgc2FtZSBzY3JpcHQ7IG9sZCB2YWx1ZXMgbWVhbiBub3RoaW5nIHRvIGFub3RoZXIgb25lLlxuICBjb25zdCBwcmVmaWxsID0gY3VycmVudD8ubmFtZSA9PT0gaXRlbS5uYW1lID8gY3VycmVudC5hcmdzIDogbnVsbDtcbiAgY29uc3QgYXJncyA9IGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBuZXcgU2hvcnRjdXRBcmdzTW9kYWwoYXBwLCBpdGVtLCBwcmVmaWxsLCByZXNvbHZlKS5vcGVuKCkpO1xuICBpZiAoYXJncyA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiBPYmplY3Qua2V5cyhhcmdzKS5sZW5ndGggPiAwID8geyBuYW1lOiBpdGVtLm5hbWUsIGFyZ3MgfSA6IHsgbmFtZTogaXRlbS5uYW1lIH07XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBwaWNrU2hvcnRjdXQgfTtcbiIsICJjb25zdCB7IE1hcmtkb3duVmlldywgTWVudSwgV29ya3NwYWNlTGVhZiwgc2V0SWNvbiB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBzaG9ydGN1dExhYmVsIH0gPSByZXF1aXJlKFwiLi9zaG9ydGN1dHNcIik7XG5jb25zdCB7IHBpY2tTaG9ydGN1dCB9ID0gcmVxdWlyZShcIi4vc2hvcnRjdXQtcGlja2VyXCIpO1xuY29uc3QgeyBnZXRTdWJ0eXAsIGVuc3VyZVN1YnR5cCB9ID0gcmVxdWlyZShcIi4vc3VidHlwc1wiKTtcbmNvbnN0IHsgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcbmNvbnN0IHsgc25hcHNob3RTZXR0aW5ncywgb2ZmZXJVbmRvIH0gPSByZXF1aXJlKFwiLi91bmRvXCIpO1xuXG4vLyBNYXJrcyB0aGUgVFlQLUZyb250bWF0dGVyIGVkaXRvcidzIGNvbnRhaW5lciBzbyB0aGUgc2hvcnRjdXQgcnVsZXMgaW5cbi8vIHN0eWxlcy5jc3MgYXBwbHkgb25seSBoZXJlLCBuZXZlciBpbiByZWFsIG5vdGVzLlxuY29uc3QgRURJVE9SX0NMQVNTID0gXCJ0eXAtZnJvbnRtYXR0ZXItZWRpdG9yXCI7XG5cbmNvbnN0IFNZU1RFTV9QUk9QRVJUSUVTID0gW1RZUF9QUk9QRVJUWS50b0xvd2VyQ2FzZSgpLCBTVUJUWVBfUFJPUEVSVFkudG9Mb3dlckNhc2UoKV07XG5cbi8vIFRoZSB2YWx1ZSBvZiBUWVAvU1VCVFlQIGlzIGJ5IGRlZmluaXRpb24gdGhlIFRZUCBvciBTdWJ0eXAgbmFtZSBpdHNlbGY7IGFzXG4vLyBhIHN0YW5kYXJkIHByb3BlcnR5IGl0IHdvdWxkIGJlIHJlZHVuZGFudCBhbmQgY291bGQgc2lsZW50bHkgZHJpZnQgZnJvbSB0aGVcbi8vIHJlYWwgbmFtZSBhZnRlciBhIHJlbmFtZSwgc28gaXQgbmV2ZXIgYXBwZWFycyBhcyBhIHJvdyBoZXJlLlxuLy8gTXV0YXRlcyBpbiBwbGFjZSBpbnN0ZWFkIG9mIHJldHVybmluZyBhIGNvcHk6IE9ic2lkaWFuJ3MgcHJvcGVydHkgZWRpdG9yXG4vLyBzZWVtcyB0byByZWx5IG9uIGEgc3RhYmxlIG9iamVjdCByZWZlcmVuY2UgaW4gc3luY2hyb25pemUoKTsgYSBmcmVzaCBjb3B5XG4vLyBjYXVzZWQgYSBzdGFjayBvdmVyZmxvdyBpbiBpdHMgcmVuZGVyUHJvcGVydHkoKSBwaXBlbGluZSBvbiBmaXJzdCByZW5kZXIuXG5mdW5jdGlvbiBzdHJpcFR5cFByb3BlcnR5KGZyb250bWF0dGVyKSB7XG4gIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGZyb250bWF0dGVyKSkge1xuICAgIGlmIChTWVNURU1fUFJPUEVSVElFUy5pbmNsdWRlcyhrZXkudHJpbSgpLnRvTG93ZXJDYXNlKCkpKSBkZWxldGUgZnJvbnRtYXR0ZXJba2V5XTtcbiAgfVxuICByZXR1cm4gZnJvbnRtYXR0ZXI7XG59XG5cbi8vIFdoZXJlIGEgZnJvbnRtYXR0ZXIgYmxvY2sgbGl2ZXMgaW4gdGhlIHNldHRpbmdzOiBhIFRZUCdzIFRZUC1Gcm9udG1hdHRlclxuLy8gKHR5cERlZmF1bHRGcm9udG1hdHRlci90eXBGbG9hdGluZ0tleXMvdHlwU2hvcnRjdXRzKSBvciBvbmUgb2YgaXRzIFN1YnR5cFxuLy8gYmxvY2tzICh0eXBTdWJ0eXBzLCBzZWUgc3VidHlwcy5qcykuIEVkaXRvciwgZmxvYXRpbmcgbWVudSwgc2hvcnRjdXQgYnV0dG9uXG4vLyBhbmQgcHJvcGVydHkgcmVuYW1lIG9ubHkgdXNlIHRoaXMgaW50ZXJmYWNlIGFuZCBuZWVkbid0IGtub3cgd2hpY2guXG4vL1xuLy8gZ2V0U2hvcnRjdXRzL3NldFNob3J0Y3V0cyBob2xkIHRoZSBzaG9ydGN1dCByZWNvcmRzIHBlciBrZXkgKHNlZVxuLy8gc2hvcnRjdXRzLmpzKSAtIG5leHQgdG8gdGhlIGZyb250bWF0dGVyLCBub3QgaW4gaXQsIHNvIHRoZSB2YWx1ZSBzdGF5c1xuLy8gdHlwZS1jbGVhbi4gV2l0aCBhIHNob3J0Y3V0IHNldCwgdGhlIHZhbHVlIHJlbWFpbnMgYXMgZmFsbGJhY2suXG5mdW5jdGlvbiB0eXBTdG9yZShwbHVnaW4sIHR5cCkge1xuICByZXR1cm4ge1xuICAgIHR5cCxcbiAgICBzdWJ0eXA6IG51bGwsXG4gICAgZ2V0RnJvbnRtYXR0ZXI6ICgpID0+IHBsdWdpbi5zZXR0aW5ncy50eXBEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwXSA/PyB7fSxcbiAgICBzZXRGcm9udG1hdHRlcjogKGZyb250bWF0dGVyKSA9PiB7XG4gICAgICBwbHVnaW4uc2V0dGluZ3MudHlwRGVmYXVsdEZyb250bWF0dGVyW3R5cF0gPSBmcm9udG1hdHRlcjtcbiAgICB9LFxuICAgIGdldEZsb2F0aW5nOiAoKSA9PiBwbHVnaW4uc2V0dGluZ3MudHlwRmxvYXRpbmdLZXlzW3R5cF0gPz8gW10sXG4gICAgc2V0RmxvYXRpbmc6IChrZXlzKSA9PiB7XG4gICAgICBpZiAoa2V5cy5sZW5ndGggPiAwKSBwbHVnaW4uc2V0dGluZ3MudHlwRmxvYXRpbmdLZXlzW3R5cF0gPSBrZXlzO1xuICAgICAgZWxzZSBkZWxldGUgcGx1Z2luLnNldHRpbmdzLnR5cEZsb2F0aW5nS2V5c1t0eXBdO1xuICAgIH0sXG4gICAgZ2V0U2hvcnRjdXRzOiAoKSA9PiBwbHVnaW4uc2V0dGluZ3MudHlwU2hvcnRjdXRzW3R5cF0gPz8ge30sXG4gICAgc2V0U2hvcnRjdXRzOiAoc2hvcnRjdXRzKSA9PiB7XG4gICAgICBpZiAoT2JqZWN0LmtleXMoc2hvcnRjdXRzKS5sZW5ndGggPiAwKSBwbHVnaW4uc2V0dGluZ3MudHlwU2hvcnRjdXRzW3R5cF0gPSBzaG9ydGN1dHM7XG4gICAgICBlbHNlIGRlbGV0ZSBwbHVnaW4uc2V0dGluZ3MudHlwU2hvcnRjdXRzW3R5cF07XG4gICAgfSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gc3VidHlwU3RvcmUocGx1Z2luLCB0eXAsIHN1YnR5cCkge1xuICByZXR1cm4ge1xuICAgIHR5cCxcbiAgICBzdWJ0eXAsXG4gICAgZ2V0RnJvbnRtYXR0ZXI6ICgpID0+IGdldFN1YnR5cChwbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKT8uZnJvbnRtYXR0ZXIgPz8ge30sXG4gICAgc2V0RnJvbnRtYXR0ZXI6IChmcm9udG1hdHRlcikgPT4ge1xuICAgICAgZW5zdXJlU3VidHlwKHBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApLmZyb250bWF0dGVyID0gZnJvbnRtYXR0ZXI7XG4gICAgfSxcbiAgICBnZXRGbG9hdGluZzogKCkgPT4gZ2V0U3VidHlwKHBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApPy5mbG9hdGluZ0tleXMgPz8gW10sXG4gICAgc2V0RmxvYXRpbmc6IChrZXlzKSA9PiB7XG4gICAgICBlbnN1cmVTdWJ0eXAocGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCkuZmxvYXRpbmdLZXlzID0ga2V5cztcbiAgICB9LFxuICAgIGdldFNob3J0Y3V0czogKCkgPT4gZ2V0U3VidHlwKHBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApPy5zaG9ydGN1dHMgPz8ge30sXG4gICAgc2V0U2hvcnRjdXRzOiAoc2hvcnRjdXRzKSA9PiB7XG4gICAgICBlbnN1cmVTdWJ0eXAocGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCkuc2hvcnRjdXRzID0gc2hvcnRjdXRzO1xuICAgIH0sXG4gIH07XG59XG5cbi8vIE9ic2lkaWFuJ3MgcHJvcGVydGllcyB3aWRnZXQgaXMgbm8gb2ZmaWNpYWwgQVBJLiBJbnRlcm5hbGx5IGl0IGlzIGFcbi8vIGNvbXBvbmVudCBjbGFzcyAobWluaWZpZWQgXCJNZXRhZGF0YUVkaXRvclwiKSB0aGF0IGV2ZXJ5IE1hcmtkb3duVmlldyBhbmQgdGhlXG4vLyBmaWxlIHByb3BlcnRpZXMgcGFuZSBpbnN0YW50aWF0ZSBhcyB2aWV3Lm1ldGFkYXRhRWRpdG9yLiBJdCBpc24ndCBleHBvcnRlZCxcbi8vIGJ1dCBhbnkgaW5zdGFuY2UgcmVhY2hlcyBpdCB2aWEgLmNvbnN0cnVjdG9yLCBhbmQgaXQgaXMgc3RhYmxlIGZvciB0aGVcbi8vIHNlc3Npb24gLSBncmFiYmluZyBpdCBvbmNlIGlzIGVub3VnaC5cbmxldCBjYWNoZWRFZGl0b3JDbGFzcyA9IG51bGw7XG5cbmZ1bmN0aW9uIGdldE1ldGFkYXRhRWRpdG9yQ2xhc3MoYXBwKSB7XG4gIGlmIChjYWNoZWRFZGl0b3JDbGFzcykgcmV0dXJuIGNhY2hlZEVkaXRvckNsYXNzO1xuXG4gIGNvbnN0IGFjdGl2ZSA9IGFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xuICBpZiAoYWN0aXZlPy5tZXRhZGF0YUVkaXRvcikge1xuICAgIGNhY2hlZEVkaXRvckNsYXNzID0gYWN0aXZlLm1ldGFkYXRhRWRpdG9yLmNvbnN0cnVjdG9yO1xuICAgIHJldHVybiBjYWNoZWRFZGl0b3JDbGFzcztcbiAgfVxuICBmb3IgKGNvbnN0IGxlYWYgb2YgYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xuICAgIGlmIChsZWFmLnZpZXc/Lm1ldGFkYXRhRWRpdG9yKSB7XG4gICAgICBjYWNoZWRFZGl0b3JDbGFzcyA9IGxlYWYudmlldy5tZXRhZGF0YUVkaXRvci5jb25zdHJ1Y3RvcjtcbiAgICAgIHJldHVybiBjYWNoZWRFZGl0b3JDbGFzcztcbiAgICB9XG4gIH1cbiAgY2FjaGVkRWRpdG9yQ2xhc3MgPSBoYXJ2ZXN0RWRpdG9yQ2xhc3MoYXBwKTtcbiAgcmV0dXJuIGNhY2hlZEVkaXRvckNsYXNzO1xufVxuXG4vLyBCZWZvcmUgYW55IG5vdGUgd2FzIG9wZW4gdGhpcyBzZXNzaW9uIHRoZXJlIGlzIG5vIGluc3RhbmNlIHRvIHJlYWNoIHRoZVxuLy8gY2xhc3MgdGhyb3VnaC4gVGhlbiB3ZSBidWlsZCBvbmU6IGEgZnJlZSBXb3Jrc3BhY2VMZWFmIChubyBwYXJlbnQsIG5ldmVyIGluXG4vLyB0aGUgRE9NKSB3aXRoIGEgTWFya2Rvd25WaWV3IGZyb20gT2JzaWRpYW4ncyB2aWV3IHJlZ2lzdHJ5LCB3aG9zZVxuLy8gY29uc3RydWN0b3IgY3JlYXRlcyBtZXRhZGF0YUVkaXRvci4gT25seSB0aGUgY2xhc3MgaXMgbmVlZGVkOyB0aGUgdmlldyBpc1xuLy8gdW5sb2FkZWQgcmlnaHQgYXdheS4gRGVsaWJlcmF0ZWx5IE5PVCBsZWFmLmRldGFjaCgpOiB0aGF0IGV4cGVjdHMgYSBwYXJlbnRcbi8vIHRoaXMgbGVhZiBuZXZlciBoYWQuXG5mdW5jdGlvbiBoYXJ2ZXN0RWRpdG9yQ2xhc3MoYXBwKSB7XG4gIGxldCB2aWV3ID0gbnVsbDtcbiAgdHJ5IHtcbiAgICBjb25zdCBjcmVhdGVWaWV3ID0gYXBwLnZpZXdSZWdpc3RyeT8uZ2V0Vmlld0NyZWF0b3JCeVR5cGU/LihcIm1hcmtkb3duXCIpO1xuICAgIGlmICghY3JlYXRlVmlldykgcmV0dXJuIG51bGw7XG4gICAgdmlldyA9IGNyZWF0ZVZpZXcobmV3IFdvcmtzcGFjZUxlYWYoYXBwKSk7XG4gICAgcmV0dXJuIHZpZXcubWV0YWRhdGFFZGl0b3I/LmNvbnN0cnVjdG9yID8/IG51bGw7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcihcIlt0eXAtc3lzdGVtXSBjb3VsZG4ndCBmaW5kIHRoZSBNZXRhZGF0YUVkaXRvciBjbGFzc1wiLCBlcnJvcik7XG4gICAgcmV0dXJuIG51bGw7XG4gIH0gZmluYWxseSB7XG4gICAgdHJ5IHtcbiAgICAgIHZpZXc/LnVubG9hZCgpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiW3R5cC1zeXN0ZW1dIGNvdWxkbid0IGRpc2NhcmQgdGhlIGhlbHBlciBNYXJrZG93blZpZXdcIiwgZXJyb3IpO1xuICAgIH1cbiAgfVxufVxuXG4vLyBMaWtlIGdldE1ldGFkYXRhRWRpdG9yQ2xhc3M6IHRoZSBwcml2YXRlIHByb3BlcnR5IHJvdyBjbGFzcywgdGFrZW4gZnJvbSBhblxuLy8gYWxyZWFkeSByZW5kZXJlZCByb3cuIE9ubHkgZW5zdXJlUHJvcGVydHlNZW51UGF0Y2goKSBuZWVkcyBpdCwgYW5kIGBlZGl0b3JgXG4vLyB1c3VhbGx5IGhhcyBhIHJvdyBieSB0aGVuLCBzbyBpdCBpcyB0cmllZCBmaXJzdC5cbmxldCBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzID0gbnVsbDtcblxuZnVuY3Rpb24gZ2V0UHJvcGVydHlSb3dDbGFzcyhhcHAsIGVkaXRvcikge1xuICBpZiAoY2FjaGVkUHJvcGVydHlSb3dDbGFzcykgcmV0dXJuIGNhY2hlZFByb3BlcnR5Um93Q2xhc3M7XG4gIGlmIChlZGl0b3I/LnJlbmRlcmVkPy5bMF0pIHtcbiAgICBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzID0gZWRpdG9yLnJlbmRlcmVkWzBdLmNvbnN0cnVjdG9yO1xuICAgIHJldHVybiBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzO1xuICB9XG4gIGNvbnN0IGFjdGl2ZSA9IGFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xuICBpZiAoYWN0aXZlPy5tZXRhZGF0YUVkaXRvcj8ucmVuZGVyZWQ/LlswXSkge1xuICAgIGNhY2hlZFByb3BlcnR5Um93Q2xhc3MgPSBhY3RpdmUubWV0YWRhdGFFZGl0b3IucmVuZGVyZWRbMF0uY29uc3RydWN0b3I7XG4gICAgcmV0dXJuIGNhY2hlZFByb3BlcnR5Um93Q2xhc3M7XG4gIH1cbiAgZm9yIChjb25zdCBsZWFmIG9mIGFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikpIHtcbiAgICBpZiAobGVhZi52aWV3Py5tZXRhZGF0YUVkaXRvcj8ucmVuZGVyZWQ/LlswXSkge1xuICAgICAgY2FjaGVkUHJvcGVydHlSb3dDbGFzcyA9IGxlYWYudmlldy5tZXRhZGF0YUVkaXRvci5yZW5kZXJlZFswXS5jb25zdHJ1Y3RvcjtcbiAgICAgIHJldHVybiBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLy8gQWRkcyBhIFwiRmxvYXRpbmdcIiB0b2dnbGUgYXQgdGhlIHZlcnkgdG9wIG9mIGEgcHJvcGVydHkgcm93J3MgY29udGV4dCBtZW51IC1cbi8vIG9ubHkgZm9yIHJvd3Mgb2YgdGhlIHBsdWdpbidzIG93biBUWVAtUGFuZSAocmVjb2duaXplZCBieSBvd25lci50eXBTdG9yZSksXG4vLyBuZXZlciBpbiByZWFsIG5vdGVzLiBVbmxpa2UgdGhlIGV4dHJhIFwiK1wiIGJ1dHRvbiAodHlwUGVuZGluZ0Zsb2F0aW5nQWRkKSxcbi8vIHdoaWNoIG9ubHkgYWZmZWN0cyBhIE5FVyBwcm9wZXJ0eSwgdGhpcyB3b3JrcyBvbiBhbnkgZXhpc3Rpbmcgb25lLCBib3RoIHdheXMuXG4vL1xuLy8gVGhlIHByb3BlcnR5IG1lbnUgaXMgbm8gb2ZmaWNpYWwgZXh0ZW5zaW9uIHBvaW50OiBvbiBkZXNrdG9wIGl0IGJ1aWxkcyBhXG4vLyBOQVRJVkUgRWxlY3Ryb24gbWVudSBmcm9tIGFuIGludGVybmFsIE1lbnUgYW5kIHNob3dzIGl0IHdpdGhpblxuLy8gc2hvd1Byb3BlcnR5TWVudSgpIGluIG9uZSBzeW5jaHJvbm91cyBjYWxsIC0gbm8gd29ya3NwYWNlIGV2ZW50LCBubyBET01cbi8vIHBvcHVwIHRvIGFtZW5kIGFmdGVyd2FyZHMuIFNvIHRoZSBwcml2YXRlIHJvdyBjbGFzcyBpcyBwYXRjaGVkLCBhcyBuYXJyb3dseVxuLy8gYXMgcG9zc2libGU6IGZvciBvdXIgcm93cywgcmlnaHQgYmVmb3JlIE9ic2lkaWFuIHNob3dzIGl0cyBmaW5pc2hlZCBtZW51LFxuLy8gb25lIGFkZEl0ZW0oKSBpcyBzbGlwcGVkIGluIHRocm91Z2ggYSBwYXRjaCBvbiBNZW51LnByb3RvdHlwZS5zaG93QXRNb3VzZUV2ZW50XG4vLyB0aGF0IHJlc2V0cyBpdHNlbGYgYWZ0ZXIgdGhpcyBvbmUgY2FsbCAoc2FmZSwgSlMgaXMgc2luZ2xlLXRocmVhZGVkKS4gVGhlXG4vLyByZXN0IG9mIHRoZSBuYXRpdmUgbWVudSBzdGF5cyB1bnRvdWNoZWQuXG5sZXQgdW5kb1Byb3BlcnR5TWVudVBhdGNoID0gbnVsbDtcblxuZnVuY3Rpb24gZW5zdXJlUHJvcGVydHlNZW51UGF0Y2goYXBwLCBlZGl0b3IpIHtcbiAgY29uc3QgUm93Q2xhc3MgPSBnZXRQcm9wZXJ0eVJvd0NsYXNzKGFwcCwgZWRpdG9yKTtcbiAgaWYgKCFSb3dDbGFzcyB8fCBSb3dDbGFzcy5fdHlwU3lzdGVtTWVudVBhdGNoZWQpIHJldHVybjtcbiAgUm93Q2xhc3MuX3R5cFN5c3RlbU1lbnVQYXRjaGVkID0gdHJ1ZTtcblxuICBjb25zdCBvcmlnaW5hbFNob3dQcm9wZXJ0eU1lbnUgPSBSb3dDbGFzcy5wcm90b3R5cGUuc2hvd1Byb3BlcnR5TWVudTtcbiAgdW5kb1Byb3BlcnR5TWVudVBhdGNoID0gKCkgPT4ge1xuICAgIFJvd0NsYXNzLnByb3RvdHlwZS5zaG93UHJvcGVydHlNZW51ID0gb3JpZ2luYWxTaG93UHJvcGVydHlNZW51O1xuICAgIGRlbGV0ZSBSb3dDbGFzcy5fdHlwU3lzdGVtTWVudVBhdGNoZWQ7XG4gIH07XG4gIFJvd0NsYXNzLnByb3RvdHlwZS5zaG93UHJvcGVydHlNZW51ID0gZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgY29uc3Qgb3duZXIgPSB0aGlzLm1ldGFkYXRhRWRpdG9yPy5vd25lcjtcbiAgICBpZiAoIW93bmVyPy50eXBTdG9yZSkgcmV0dXJuIG9yaWdpbmFsU2hvd1Byb3BlcnR5TWVudS5jYWxsKHRoaXMsIGV2ZW50KTtcblxuICAgIGNvbnN0IHJvdyA9IHRoaXM7XG4gICAgY29uc3Qgb3JpZ2luYWxTaG93QXRNb3VzZUV2ZW50ID0gTWVudS5wcm90b3R5cGUuc2hvd0F0TW91c2VFdmVudDtcbiAgICBNZW51LnByb3RvdHlwZS5zaG93QXRNb3VzZUV2ZW50ID0gZnVuY3Rpb24gKG1vdXNlRXZlbnQpIHtcbiAgICAgIE1lbnUucHJvdG90eXBlLnNob3dBdE1vdXNlRXZlbnQgPSBvcmlnaW5hbFNob3dBdE1vdXNlRXZlbnQ7XG4gICAgICBjb25zdCBpc0Zsb2F0aW5nID0gb3duZXIudHlwU3RvcmUuZ2V0RmxvYXRpbmcoKS5pbmNsdWRlcyhyb3cuZW50cnkua2V5KTtcbiAgICAgIC8vIFwidGl0bGVcIiBpcyB0aGUgZmlyc3Qgc2VjdGlvbiBzaG93UHJvcGVydHlNZW51IHJlZ2lzdGVycyBhbmQgaXMgZW1wdHlcbiAgICAgIC8vIG9uIGRlc2t0b3AsIHNvIHRoaXMgbGFuZHMgcmVsaWFibHkgb24gdG9wLiBcInBpbi1vZmZcIiA9IG5vdCBwaW5uZWQgPVxuICAgICAgLy8gZmxvYXRpbmcuXG4gICAgICB0aGlzLmFkZEl0ZW0oKGl0ZW0pID0+XG4gICAgICAgIGl0ZW1cbiAgICAgICAgICAuc2V0VGl0bGUoXCJGbG9hdGluZ1wiKVxuICAgICAgICAgIC5zZXRJY29uKFwicGluLW9mZlwiKVxuICAgICAgICAgIC5zZXRDaGVja2VkKGlzRmxvYXRpbmcpXG4gICAgICAgICAgLnNldFNlY3Rpb24oXCJ0aXRsZVwiKVxuICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHRvZ2dsZUZsb2F0aW5nUHJvcGVydHkob3duZXIudHlwUGFuZSwgb3duZXIudHlwU3RvcmUsIHJvdy5lbnRyeS5rZXkpKVxuICAgICAgKTtcbiAgICAgIHJldHVybiBvcmlnaW5hbFNob3dBdE1vdXNlRXZlbnQuY2FsbCh0aGlzLCBtb3VzZUV2ZW50KTtcbiAgICB9O1xuXG4gICAgcmV0dXJuIG9yaWdpbmFsU2hvd1Byb3BlcnR5TWVudS5jYWxsKHRoaXMsIGV2ZW50KTtcbiAgfTtcbn1cblxuLy8gT24gdW5sb2FkOyBvdGhlcndpc2UgdGhlIHBhdGNoIHdvdWxkIG91dGxpdmUgYSBob3QgcmVsb2FkIHdpdGggdGhlIG9sZFxuLy8gbW9kdWxlJ3MgY2xvc3VyZXMuXG5mdW5jdGlvbiByZW1vdmVQcm9wZXJ0eU1lbnVQYXRjaCgpIHtcbiAgdW5kb1Byb3BlcnR5TWVudVBhdGNoPy4oKTtcbiAgdW5kb1Byb3BlcnR5TWVudVBhdGNoID0gbnVsbDtcbn1cblxuZnVuY3Rpb24gdG9nZ2xlRmxvYXRpbmdQcm9wZXJ0eSh2aWV3LCBzdG9yZSwga2V5KSB7XG4gIGNvbnN0IGZsb2F0aW5nID0gc3RvcmUuZ2V0RmxvYXRpbmcoKTtcbiAgc3RvcmUuc2V0RmxvYXRpbmcoZmxvYXRpbmcuaW5jbHVkZXMoa2V5KSA/IGZsb2F0aW5nLmZpbHRlcigoaykgPT4gayAhPT0ga2V5KSA6IFsuLi5mbG9hdGluZywga2V5XSk7XG4gIHZpZXcucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAvLyBVcGRhdGVzIHRoZSBib2xkL2l0YWxpYyBtYXJrcyBhdCBvbmNlLCBoZXJlIGFuZCBpbiBvcGVuIG5vdGVzLlxuICB2aWV3LnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbn1cblxuLy8gS2V5Ym9hcmQgbmF2aWdhdGlvbiBiZXlvbmQgb25lIGVkaXRvciBpbnN0YW5jZSAoc2VlIGZyb250bWF0dGVyLWJsb2Nrcy5qcyk6XG4vLyBPYnNpZGlhbiBtb3ZlcyBmb2N1cyBvbmx5IHdpdGhpbiBpdHMgb3duIHJvdyBsaXN0LCBhbmQgYXQgZWl0aGVyIGVuZCBvbnRvXG4vLyB0aGUgZWRpdG9yJ3MgaGVhZGluZyBvciBcIkFkZCBwcm9wZXJ0eVwiIGJ1dHRvbiAtIGJvdGggaGlkZGVuIGhlcmUgYnkgQ1NTLCBzb1xuLy8gdGhlIGNoYWluIHN0b3BwZWQgYXQgdGhlIGJsb2NrIGVkZ2UuXG4vL1xuLy8gb3duZXIuc2hpZnRGb2N1c0JlZm9yZS9BZnRlciBhcmUgb25seSByZWFjaGVkIHRocm91Z2ggZXhhY3RseSB0aG9zZSBoaWRkZW5cbi8vIGVsZW1lbnRzLCBzbyBpbnN0ZWFkIGEgY2FwdHVyZS1waGFzZSBoYW5kbGVyIHJ1bnMgQkVGT1JFIHRoZSByb3cncyBvd24uIEl0XG4vLyBvbmx5IGFjdHMgd2hpbGUgdGhlIHJvdyBJVFNFTEYgaGFzIGZvY3VzIChldmVudC50YXJnZXQgaXMgdGhlIHJvdydzXG4vLyBjb250YWluZXIpIC0gdGhlIHNhbWUgY29uZGl0aW9uIHVuZGVyIHdoaWNoIE9ic2lkaWFuIGFsbG93cyBqL2ssIHNvIG5ldmVyXG4vLyB3aGlsZSB0eXBpbmcgaW4gYSBmaWVsZC5cbmZ1bmN0aW9uIHJlZ2lzdGVyRm9jdXNDaGFpbihlZGl0b3IsIG9uU2hpZnRGb2N1cykge1xuICBlZGl0b3IuY29udGFpbmVyRWwuYWRkRXZlbnRMaXN0ZW5lcihcbiAgICBcImtleWRvd25cIixcbiAgICAoZXZlbnQpID0+IHtcbiAgICAgIGlmIChldmVudC5pc0NvbXBvc2luZyB8fCBldmVudC5kZWZhdWx0UHJldmVudGVkKSByZXR1cm47XG4gICAgICAvLyBNdWx0aS1zZWxlY3Rpb246IE9ic2lkaWFuIGV4dGVuZHMgdGhlIHNlbGVjdGlvbiBpbnN0ZWFkIG9mIG1vdmluZy5cbiAgICAgIGlmIChlZGl0b3Iuc2VsZWN0ZWRMaW5lcz8uc2l6ZSA+IDEpIHJldHVybjtcbiAgICAgIGlmIChldmVudC5zaGlmdEtleSAmJiAoZXZlbnQua2V5ID09PSBcIkFycm93VXBcIiB8fCBldmVudC5rZXkgPT09IFwiQXJyb3dEb3duXCIpKSByZXR1cm47XG5cbiAgICAgIGNvbnN0IGluZGV4ID0gZWRpdG9yLnJlbmRlcmVkLmZpbmRJbmRleCgocm93KSA9PiByb3cuY29udGFpbmVyRWwgPT09IGV2ZW50LnRhcmdldCk7XG4gICAgICBpZiAoaW5kZXggPT09IC0xKSByZXR1cm47XG5cbiAgICAgIGNvbnN0IHVwID0gZXZlbnQua2V5ID09PSBcIkFycm93VXBcIiB8fCBldmVudC5rZXkgPT09IFwia1wiIHx8IChldmVudC5rZXkgPT09IFwiVGFiXCIgJiYgZXZlbnQuc2hpZnRLZXkpO1xuICAgICAgY29uc3QgZG93biA9IGV2ZW50LmtleSA9PT0gXCJBcnJvd0Rvd25cIiB8fCBldmVudC5rZXkgPT09IFwialwiIHx8IChldmVudC5rZXkgPT09IFwiVGFiXCIgJiYgIWV2ZW50LnNoaWZ0S2V5KTtcbiAgICAgIGxldCBzdGVwID0gMDtcbiAgICAgIGlmICh1cCAmJiBpbmRleCA9PT0gMCkgc3RlcCA9IC0xO1xuICAgICAgZWxzZSBpZiAoZG93biAmJiBpbmRleCA9PT0gZWRpdG9yLnJlbmRlcmVkLmxlbmd0aCAtIDEpIHN0ZXAgPSAxO1xuICAgICAgaWYgKHN0ZXAgPT09IDAgfHwgIW9uU2hpZnRGb2N1cyhzdGVwKSkgcmV0dXJuO1xuXG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgfSxcbiAgICB0cnVlXG4gICk7XG59XG5cbi8vIFRoZSB3aWRnZXQgdGFrZXMgYW4gXCJvd25lclwiIGFzIHNlY29uZCBjb25zdHJ1Y3RvciBhcmd1bWVudCAtIHRoZSBvbmx5IHRoaW5nXG4vLyBiaW5kaW5nIGl0IHRvIGEgZmlsZS4gSGVyZSBpdCBpcyBib3VuZCB0byBhIHBsYWluIG9iamVjdCBpbiB0aGUgc2V0dGluZ3M6XG4vLyBzYXZlRnJvbnRtYXR0ZXIob2JqKSBnZXRzIHRoZSBmdWxsIHByb3BlcnR5IHNldCBvbiBldmVyeSBjaGFuZ2UuXG4vLyBzaGlmdEZvY3VzQmVmb3JlL0FmdGVyIG1heSBiZSBuby1vcHMuIGdldEZpbGUoKSBpcyBjYWxsZWQgYnkgZXZlcnkgcm93IHdoaWxlXG4vLyByZW5kZXJpbmcgKGZvciBzb3VyY2VQYXRoKTsgdGhlcmUgaXMgbm8gcmVhbCBmaWxlLCBidXQgdGhlIG1ldGhvZCBtdXN0IGV4aXN0XG4vLyBvciB0aGUgd2lkZ2V0IGNyYXNoZXMuXG4vL1xuLy8gT25lIGVkaXRvciBwZXIgYmxvY2sgKFRZUCBvciBTdWJ0eXApLCBib3VuZCB0byBgc3RvcmVgLiBTdGFuZGFyZCBhbmRcbi8vIGZsb2F0aW5nIHByb3BlcnRpZXMgc2hhcmUgb25lIGxpc3QgYW5kIG9yZGVyOyBnZXRUeXBEZWZhdWx0cygpIGp1c3QgbGVhdmVzXG4vLyB0aGUgZmxvYXRpbmcgb25lcyBvdXQuIGVkaXRvci50eXBQZW5kaW5nRmxvYXRpbmdBZGQsIHNldCBiZWZvcmVcbi8vIGFkZEJsYW5rUHJvcGVydHkoKSwgbWFya3MgdGhlIG5leHQgYWRkZWQgKG9yIHJlbmFtZWQpIHByb3BlcnR5IGFzIGZsb2F0aW5nIC1cbi8vIHNlZSBzYXZlRnJvbnRtYXR0ZXIuXG5mdW5jdGlvbiBtb3VudEZyb250bWF0dGVyRWRpdG9yKHZpZXcsIGNvbnRhaW5lckVsLCBzdG9yZSwgeyBvblNoaWZ0Rm9jdXMgfSA9IHt9KSB7XG4gIGNvbnN0IGFwcCA9IHZpZXcuYXBwO1xuICBjb25zdCBFZGl0b3JDbGFzcyA9IGdldE1ldGFkYXRhRWRpdG9yQ2xhc3MoYXBwKTtcbiAgaWYgKCFFZGl0b3JDbGFzcykge1xuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICBjbHM6IFwidHlwLWZyb250bWF0dGVyLXVuYXZhaWxhYmxlXCIsXG4gICAgICB0ZXh0OiBcIlp1bSBJbml0aWFsaXNpZXJlbiBkZXMgRWRpdG9ycyBiaXR0ZSB6dWVyc3QgZWlubWFsIGVpbmUgTm90aXogXHUwMEY2ZmZuZW4uXCIsXG4gICAgfSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBvd25lciA9IHtcbiAgICBhcHAsXG4gICAgLy8gTGV0cyBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaCgpIHJlY29nbml6ZSByb3dzIG9mIHRoaXMgZWRpdG9yIGFuZCBnaXZlc1xuICAgIC8vIHRoZSBnbG9iYWwgbWVudSBwYXRjaCB0aGUgc3RvcmUgYW5kIHZpZXcgcGVyIHJvdyAodGhlIHBhdGNoIGl0c2VsZiBpc1xuICAgIC8vIGluc3RhbGxlZCBvbmx5IG9uY2UpLlxuICAgIHR5cFN0b3JlOiBzdG9yZSxcbiAgICB0eXBQYW5lOiB2aWV3LFxuICAgIGdldEZpbGUoKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9LFxuICAgIC8vIE9ubHkgZm9yIE9ic2lkaWFuJ3MgaG92ZXIgcHJldmlldyBvZiBpbnRlcm5hbCBsaW5rcyBpbiBhIHZhbHVlOyBhbnlcbiAgICAvLyBzdHJpbmcgd2lsbCBkby5cbiAgICBnZXRIb3ZlclNvdXJjZSgpIHtcbiAgICAgIHJldHVybiBcInR5cC1mcm9udG1hdHRlclwiO1xuICAgIH0sXG4gICAgc2hpZnRGb2N1c0JlZm9yZSgpIHt9LFxuICAgIHNoaWZ0Rm9jdXNBZnRlcigpIHt9LFxuICAgIC8vIENhbGxlZCBvbmNlIHBlciBjb21wbGV0ZWQgY2hhbmdlIChhIHJlbmFtZSBvbmx5IG9uIGJsdXIgb2YgdGhlIGtleVxuICAgIC8vIGlucHV0KSwgc28gZWFjaCBjYWxsIGFkZHMgYW5kL29yIHJlbW92ZXMgYXQgbW9zdCBvbmUgbm9uLWVtcHR5IHByb3BlcnR5LFxuICAgIC8vIGV4Y2VwdCBhIG11bHRpLWRlbGV0ZS4gVGhhdCBrZWVwcyB0aGUgZmxvYXRpbmcgZmxhZyBlYXN5IHRvIHRyYWNrXG4gICAgLy8gd2l0aG91dCBmb2xsb3dpbmcgaW50ZXJtZWRpYXRlIHR5cGluZyBzdGF0ZXMuXG4gICAgc2F2ZUZyb250bWF0dGVyKGZyb250bWF0dGVyKSB7XG4gICAgICAvLyBBIHJvdyBqdXN0IG5hbWVkIFwiVFlQXCIvXCJTVUJUWVBcIiBpc24ndCBzYXZlZC4gSXQgc3RheXMgdmlzaWJsZSB1bnRpbFxuICAgICAgLy8gdGhlIG5leHQgbW91bnQgKG5vIHN5bmNocm9uaXplKCkgaGVyZSwgc2VlIHN0cmlwVHlwUHJvcGVydHkpLlxuICAgICAgc3RyaXBUeXBQcm9wZXJ0eShmcm9udG1hdHRlcik7XG5cbiAgICAgIGNvbnN0IHByZXZpb3VzID0gc3RvcmUuZ2V0RnJvbnRtYXR0ZXIoKTtcbiAgICAgIGNvbnN0IHByZXZpb3VzS2V5cyA9IE9iamVjdC5rZXlzKHByZXZpb3VzKS5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBcIlwiKTtcbiAgICAgIGNvbnN0IGN1cnJlbnRLZXlzID0gT2JqZWN0LmtleXMoZnJvbnRtYXR0ZXIpLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwiXCIpO1xuICAgICAgY29uc3QgcmVtb3ZlZEtleXMgPSBwcmV2aW91c0tleXMuZmlsdGVyKChrZXkpID0+ICFjdXJyZW50S2V5cy5pbmNsdWRlcyhrZXkpKTtcbiAgICAgIGNvbnN0IGFkZGVkS2V5cyA9IGN1cnJlbnRLZXlzLmZpbHRlcigoa2V5KSA9PiAhcHJldmlvdXNLZXlzLmluY2x1ZGVzKGtleSkpO1xuICAgICAgLy8gRGVsZXRpbmcgcm93cyBsb3NlcyB2YWx1ZSwgc2hvcnRjdXQgYW5kIGZsb2F0aW5nIGZsYWcgYXQgb25jZSAtIHRoZVxuICAgICAgLy8gb25lIGNoYW5nZSBoZXJlIHRoYXQgZ2V0cyBhbiB1bmRvIChzZWUgdW5kby5qcykuIFNuYXBzaG90IGJlZm9yZSBhbnlcbiAgICAgIC8vIHN0b3JlIHdyaXRlLCBhbmQgb25seSBmb3IgYSBkZWxldGlvbiAtIG5vIGZ1bGwgY29weSBvbiBldmVyeSBlZGl0LlxuICAgICAgY29uc3QgcmVtb3ZlZE9ubHkgPSByZW1vdmVkS2V5cy5sZW5ndGggPiAwICYmIGFkZGVkS2V5cy5sZW5ndGggPT09IDA7XG4gICAgICBjb25zdCB1bmRvU25hcHNob3QgPSByZW1vdmVkT25seSA/IHNuYXBzaG90U2V0dGluZ3Modmlldy5wbHVnaW4pIDogbnVsbDtcblxuICAgICAgbGV0IGZsb2F0aW5nID0gc3RvcmUuZ2V0RmxvYXRpbmcoKTtcbiAgICAgIGlmIChyZW1vdmVkS2V5cy5sZW5ndGggPT09IDEgJiYgYWRkZWRLZXlzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAvLyBBIHJlbmFtZTogdGhlIGZsb2F0aW5nIGZsYWcgbW92ZXMgYWxvbmcuXG4gICAgICAgIGZsb2F0aW5nID0gZmxvYXRpbmcubWFwKChrZXkpID0+IChrZXkgPT09IHJlbW92ZWRLZXlzWzBdID8gYWRkZWRLZXlzWzBdIDoga2V5KSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAocmVtb3ZlZEtleXMubGVuZ3RoID4gMCkgZmxvYXRpbmcgPSBmbG9hdGluZy5maWx0ZXIoKGtleSkgPT4gIXJlbW92ZWRLZXlzLmluY2x1ZGVzKGtleSkpO1xuICAgICAgICBpZiAoZWRpdG9yLnR5cFBlbmRpbmdGbG9hdGluZ0FkZCAmJiBhZGRlZEtleXMubGVuZ3RoID09PSAxKSB7XG4gICAgICAgICAgZmxvYXRpbmcgPSBbLi4uZmxvYXRpbmcsIGFkZGVkS2V5c1swXV07XG4gICAgICAgICAgZWRpdG9yLnR5cFBlbmRpbmdGbG9hdGluZ0FkZCA9IGZhbHNlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICAvLyBTaG9ydGN1dHMgYmVsb25nIHRvIHRoZSBrZXkgdG9vOiB0aGV5IG1vdmUgb24gcmVuYW1lIGFuZCBnbyBvbiBkZWxldGUuXG4gICAgICBjb25zdCBzaG9ydGN1dHMgPSB7IC4uLnN0b3JlLmdldFNob3J0Y3V0cygpIH07XG4gICAgICBpZiAocmVtb3ZlZEtleXMubGVuZ3RoID09PSAxICYmIGFkZGVkS2V5cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgaWYgKHNob3J0Y3V0c1tyZW1vdmVkS2V5c1swXV0pIHtcbiAgICAgICAgICBzaG9ydGN1dHNbYWRkZWRLZXlzWzBdXSA9IHNob3J0Y3V0c1tyZW1vdmVkS2V5c1swXV07XG4gICAgICAgICAgZGVsZXRlIHNob3J0Y3V0c1tyZW1vdmVkS2V5c1swXV07XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZvciAoY29uc3Qga2V5IG9mIHJlbW92ZWRLZXlzKSBkZWxldGUgc2hvcnRjdXRzW2tleV07XG4gICAgICB9XG5cbiAgICAgIHN0b3JlLnNldEZyb250bWF0dGVyKGZyb250bWF0dGVyKTtcbiAgICAgIHN0b3JlLnNldEZsb2F0aW5nKGZsb2F0aW5nKTtcbiAgICAgIHN0b3JlLnNldFNob3J0Y3V0cyhzaG9ydGN1dHMpO1xuICAgICAgdmlldy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICBpZiAodW5kb1NuYXBzaG90KSB7XG4gICAgICAgIGNvbnN0IGJsb2NrTmFtZSA9IHN0b3JlLnN1YnR5cCA/PyBzdG9yZS50eXA7XG4gICAgICAgIG9mZmVyVW5kbyhcbiAgICAgICAgICB2aWV3LnBsdWdpbixcbiAgICAgICAgICByZW1vdmVkS2V5cy5sZW5ndGggPT09IDFcbiAgICAgICAgICAgID8gYFByb3BlcnR5IFwiJHtyZW1vdmVkS2V5c1swXX1cIiByZW1vdmVkIGZyb20gJHtibG9ja05hbWV9LmBcbiAgICAgICAgICAgIDogYCR7cmVtb3ZlZEtleXMubGVuZ3RofSBwcm9wZXJ0aWVzIHJlbW92ZWQgZnJvbSAke2Jsb2NrTmFtZX0uYCxcbiAgICAgICAgICB1bmRvU25hcHNob3RcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIC8vIEEgbmV3bHkgbmFtZWQgcm93IGdldHMgaXRzIGJ1dHRvbiwgYSBkZWxldGVkIG9uZSB0YWtlcyBpdCBhbG9uZy5cbiAgICAgIHJlbmRlclNob3J0Y3V0Q29udHJvbHModmlldywgZWRpdG9yLCBzdG9yZSk7XG4gICAgICAvLyBCb2xkL2l0YWxpYyBtYXJrcyBpbiBvcGVuIG5vdGVzIGZvbGxvdyB0aGUgY2hhbmdlZCBsaXN0IGF0IG9uY2UuXG4gICAgICB2aWV3LnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICB9LFxuICB9O1xuXG4gIGNvbnN0IGVkaXRvciA9IG5ldyBFZGl0b3JDbGFzcyhhcHAsIG93bmVyKTtcbiAgZWRpdG9yLnR5cFBlbmRpbmdGbG9hdGluZ0FkZCA9IGZhbHNlO1xuICBpZiAob25TaGlmdEZvY3VzKSByZWdpc3RlckZvY3VzQ2hhaW4oZWRpdG9yLCBvblNoaWZ0Rm9jdXMpO1xuICBlZGl0b3IuY29udGFpbmVyRWwuYWRkQ2xhc3MoRURJVE9SX0NMQVNTKTtcbiAgY29udGFpbmVyRWwuYXBwZW5kQ2hpbGQoZWRpdG9yLmNvbnRhaW5lckVsKTtcbiAgdmlldy5hZGRDaGlsZChlZGl0b3IpO1xuXG4gIGVkaXRvci5zeW5jaHJvbml6ZShzdG9yZS5nZXRGcm9udG1hdHRlcigpKTtcbiAgcmVuZGVyU2hvcnRjdXRDb250cm9scyh2aWV3LCBlZGl0b3IsIHN0b3JlKTtcbiAgLy8gT25seSBhZnRlciB0aGUgZmlyc3Qgc3luY2hyb25pemUoKSAoc2VlIGdldFByb3BlcnR5Um93Q2xhc3MpLiBBIG5vLW9wIGZvclxuICAvLyBhIHN0aWxsIGVtcHR5IFRZUDsgdGhlIG5leHQgbm9uLWVtcHR5IG9uZSAob3IgYW4gb3BlbiBub3RlKSBzdXBwbGllcyB0aGVcbiAgLy8gY2xhc3MuXG4gIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoKGFwcCwgZWRpdG9yKTtcbiAgcmV0dXJuIGVkaXRvcjtcbn1cblxuY29uc3QgQ0hJUF9DTEFTUyA9IFwidHlwLXNob3J0Y3V0LWNoaXBcIjtcbmNvbnN0IENISVBfVEVYVF9DTEFTUyA9IFwidHlwLXNob3J0Y3V0LWNoaXAtdGV4dFwiO1xuY29uc3QgQlVUVE9OX0NMQVNTID0gXCJ0eXAtc2hvcnRjdXQtYnV0dG9uXCI7XG5jb25zdCBST1dfQ0xBU1MgPSBcInR5cC1oYXMtc2hvcnRjdXRcIjtcbmNvbnN0IFdBUk5JTkdfQ0xBU1MgPSBcInR5cC1zaG9ydGN1dC1ibG9ja2VkXCI7XG5cbi8vIEJ1dHRvbiBhbmQgY2hpcCBwZXIgcHJvcGVydHkgcm93LiBCb3RoIGhhbmcgb24gdGhlIHJvdydzIGNvbnRhaW5lckVsLCBOT1QgaXRzXG4vLyB2YWx1ZUVsOiByZW5kZXJQcm9wZXJ0eSgpIG9ubHkgZXZlciBlbXB0aWVzIHZhbHVlRWwsIHNvIGFueXRoaW5nIGF0dGFjaGVkIHRvXG4vLyBjb250YWluZXJFbCBzdXJ2aXZlcyBldmVyeSB0eXBlIG9yIHZhbHVlIGNoYW5nZSB3aXRob3V0IHRvdWNoaW5nXG4vLyBPYnNpZGlhbidzIHJlbmRlciBwaXBlbGluZS5cbi8vXG4vLyBUaGUgYnV0dG9uIHRvZ2dsZXM6IHdpdGhvdXQgYSBzaG9ydGN1dCBpdCBvcGVucyB0aGUgcGlja2VyLCB3aXRoIG9uZSBpdFxuLy8gcmVtb3ZlcyBpdC4gVGhlIGNoaXAgaXRzZWxmIGlzIGZvciBDSEFOR0lORyBpdC4gQ1NTIHNob3dzIHRoZSBidXR0b24gb25seSBvblxuLy8gcm93IGhvdmVyL2ZvY3VzIChhbmQgcGVybWFuZW50bHkgd2hpbGUgYSBzaG9ydGN1dCBpcyBzZXQpIC0gb3RoZXJ3aXNlIGV2ZXJ5XG4vLyByb3cgd291bGQgY2FycnkgYSBjb250cm9sIG1vc3QgbmV2ZXIgbmVlZC5cbi8vXG4vLyBIaWRpbmcgdGhlIHZhbHVlIGZpZWxkIHdoaWxlIGEgc2hvcnRjdXQgaXMgc2V0IGlzIHB1cmUgQ1NTIChST1dfQ0xBU1MgaW5cbi8vIHN0eWxlcy5jc3MpOyB0aGUgbmF0aXZlIHdpZGdldCBrZWVwcyByZW5kZXJpbmcgdW5kZXJuZWF0aC4gU2V0dGluZyBhbmRcbi8vIHJlbW92aW5nIGlzIGp1c3QgYSBjbGFzcyB0b2dnbGUsIG5vIHJlbmRlclByb3BlcnR5KCkvc3luY2hyb25pemUoKSAtIHdoaWNoXG4vLyB3b3VsZCBiZSByaXNreSBoZXJlIGFueXdheSAoc2VlIHN0cmlwVHlwUHJvcGVydHkpLlxuZnVuY3Rpb24gcmVuZGVyU2hvcnRjdXRDb250cm9scyh2aWV3LCBlZGl0b3IsIHN0b3JlKSB7XG4gIGNvbnN0IHNob3J0Y3V0cyA9IHN0b3JlLmdldFNob3J0Y3V0cygpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiBlZGl0b3IucmVuZGVyZWQgPz8gW10pIHtcbiAgICBjb25zdCBjb250YWluZXJFbCA9IHJvdy5jb250YWluZXJFbDtcbiAgICBjb25zdCBrZXkgPSByb3cuZW50cnk/LmtleSA/PyBcIlwiO1xuICAgIC8vIEFuIHVubmFtZWQgcm93IGNhbid0IGNhcnJ5IGEgc2hvcnRjdXQgLSB0aGVyZSBpcyBubyBrZXkgdG8gc3RvcmUgaXRcbiAgICAvLyB1bmRlci4gVGhlIGJ1dHRvbiBhcHBlYXJzIG9uY2UgaXQgaGFzIGEgbmFtZSAoZXZlcnkgY2hhbmdlIHBhc3Nlc1xuICAgIC8vIHRocm91Z2ggc2F2ZUZyb250bWF0dGVyIGFuZCBzbyB0aHJvdWdoIGhlcmUpLlxuICAgIGNvbnN0IHJlY29yZCA9IGtleSA9PT0gXCJcIiA/IG51bGwgOiBzaG9ydGN1dHNba2V5XSA/PyBudWxsO1xuICAgIGNvbnRhaW5lckVsLnRvZ2dsZUNsYXNzKFJPV19DTEFTUywgISFyZWNvcmQpO1xuXG4gICAgLy8gT2JzaWRpYW4ncyB3YXJuaW5nIHRyaWFuZ2xlIHNpdHMgYWJzb2x1dGVseSBhdCB0aGUgcm93J3MgcmlnaHQgZWRnZSAtXG4gICAgLy8gZXhhY3RseSB3aGVyZSB0aGUgc2hvcnRjdXQgYnV0dG9uIGdvZXMuIElmIHRoZSByb3cgc2hvd3MgYSB0eXBlIHdhcm5pbmdcbiAgICAvLyBhbmQgaGFzIE5PIHNob3J0Y3V0LCB0aGUgYnV0dG9uIGdpdmVzIHdheS4gV2l0aCBhIHNob3J0Y3V0IHNldCwgdGhlXG4gICAgLy8gYnV0dG9uIHN0YXlzIChpdCBpcyB0aGUgb25seSB3YXkgdG8gcmVtb3ZlIHRoZSBzaG9ydGN1dCkgYW5kIHRoZVxuICAgIC8vIHRyaWFuZ2xlIGdpdmVzIHdheSBpbnN0ZWFkIChzdHlsZXMuY3NzKTogaXQgd291bGQgdGhlbiByZWZlciB0byB0aGVcbiAgICAvLyBoaWRkZW4gZmFsbGJhY2sgdmFsdWUsIHdoaWNoIGNhbid0IGJlIGZpeGVkIHRoZXJlIGFueXdheS5cbiAgICBjb25zdCBtaXNtYXRjaCA9ICEhcm93LnR5cGVJbmZvICYmIHJvdy50eXBlSW5mby5leHBlY3RlZCAhPT0gcm93LnR5cGVJbmZvLmluZmVycmVkO1xuICAgIGNvbnRhaW5lckVsLnRvZ2dsZUNsYXNzKFdBUk5JTkdfQ0xBU1MsIG1pc21hdGNoICYmICFyZWNvcmQpO1xuXG4gICAgbGV0IGJ1dHRvbkVsID0gY29udGFpbmVyRWwucXVlcnlTZWxlY3RvcihgOnNjb3BlID4gLiR7QlVUVE9OX0NMQVNTfWApO1xuICAgIGlmIChrZXkgPT09IFwiXCIpIHtcbiAgICAgIGJ1dHRvbkVsPy5yZW1vdmUoKTtcbiAgICAgIGNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3IoYDpzY29wZSA+IC4ke0NISVBfQ0xBU1N9YCk/LnJlbW92ZSgpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICghYnV0dG9uRWwpIHtcbiAgICAgIGJ1dHRvbkVsID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBgY2xpY2thYmxlLWljb24gJHtCVVRUT05fQ0xBU1N9YCB9KTtcbiAgICAgIHNldEljb24oYnV0dG9uRWwsIFwic3F1YXJlLWZ1bmN0aW9uXCIpO1xuICAgICAgLy8gUmVhZCB0aGUga2V5IG9uIGNsaWNrLCBub3QgaGVyZTogYSByZW5hbWUgY2hhbmdlcyByb3cuZW50cnkua2V5XG4gICAgICAvLyB3aXRob3V0IHJlY3JlYXRpbmcgdGhlIHJvdy5cbiAgICAgIGJ1dHRvbkVsLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICAgIGlmIChzdG9yZS5nZXRTaG9ydGN1dHMoKVtyb3cuZW50cnk/LmtleSA/PyBcIlwiXSkgcmVtb3ZlU2hvcnRjdXQodmlldywgZWRpdG9yLCBzdG9yZSwgcm93KTtcbiAgICAgICAgZWxzZSBvcGVuU2hvcnRjdXRQaWNrZXIodmlldywgZWRpdG9yLCBzdG9yZSwgcm93KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICBidXR0b25FbC5zZXRBdHRyKFwiYXJpYS1sYWJlbFwiLCByZWNvcmQgPyBcIlNob3J0Y3V0IGVudGZlcm5lblwiIDogXCJTaG9ydGN1dCBzZXR6ZW5cIik7XG5cbiAgICBsZXQgY2hpcEVsID0gY29udGFpbmVyRWwucXVlcnlTZWxlY3RvcihgOnNjb3BlID4gLiR7Q0hJUF9DTEFTU31gKTtcbiAgICBpZiAoIXJlY29yZCkge1xuICAgICAgY2hpcEVsPy5yZW1vdmUoKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoIWNoaXBFbCkge1xuICAgICAgY2hpcEVsID0gY3JlYXRlRWwoXCJjb2RlXCIsIHsgY2xzOiBDSElQX0NMQVNTIH0pO1xuICAgICAgLy8gVGV4dCBpbiBpdHMgb3duIHNwYW46IHRoZSBjaGlwIGlzIGEgZmxleCBjb250YWluZXIgKHZlcnRpY2FsXG4gICAgICAvLyBjZW50ZXJpbmcgbGlrZSB0aGUgcmVhbCB2YWx1ZSBmaWVsZCksIGFuZCB0ZXh0LW92ZXJmbG93OiBlbGxpcHNpc1xuICAgICAgLy8gb25seSB3b3JrcyBvbiBhIGJsb2NrIGVsZW1lbnQuXG4gICAgICBjaGlwRWwuY3JlYXRlU3Bhbih7IGNsczogQ0hJUF9URVhUX0NMQVNTIH0pO1xuICAgICAgY2hpcEVsLnNldEF0dHIoXCJhcmlhLWxhYmVsXCIsIFwiU2hvcnRjdXQgXHUwMEU0bmRlcm5cIik7XG4gICAgICBjaGlwRWwuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IG9wZW5TaG9ydGN1dFBpY2tlcih2aWV3LCBlZGl0b3IsIHN0b3JlLCByb3cpKTtcbiAgICAgIC8vIEJlZm9yZSB0aGUgYnV0dG9uLCBzbyB0aGUgcm93IGFsd2F5cyByZWFkcyBcIm5hbWUgfCBjaGlwIHwgYnV0dG9uXCIuXG4gICAgICBjb250YWluZXJFbC5pbnNlcnRCZWZvcmUoY2hpcEVsLCBidXR0b25FbCk7XG4gICAgfVxuICAgIGNoaXBFbC5maXJzdEVsZW1lbnRDaGlsZC5zZXRUZXh0KHNob3J0Y3V0TGFiZWwocmVjb3JkKSk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gb3BlblNob3J0Y3V0UGlja2VyKHZpZXcsIGVkaXRvciwgc3RvcmUsIHJvdykge1xuICBjb25zdCBrZXkgPSByb3cuZW50cnk/LmtleSA/PyBcIlwiO1xuICBpZiAoa2V5ID09PSBcIlwiKSByZXR1cm47XG4gIC8vIFBhc3NpbmcgdGhlIGN1cnJlbnQgcmVjb3JkIHByZWZpbGxzIHRoZSBhcmd1bWVudCBkaWFsb2cgd2hlbiB0aGUgc2FtZVxuICAvLyBzY3JpcHQgaXMgcGlja2VkIGFnYWluIC0gdGhhdCBpcyBob3cgc2luZ2xlIGFyZ3VtZW50cyBnZXQgY29ycmVjdGVkLlxuICBjb25zdCByZWNvcmQgPSBhd2FpdCBwaWNrU2hvcnRjdXQodmlldy5hcHAsIGtleSwgdmlldy5wbHVnaW4uZ2V0U2hvcnRjdXRTY3JpcHRzLCBzdG9yZS5nZXRTaG9ydGN1dHMoKVtrZXldID8/IG51bGwpO1xuICBpZiAoIXJlY29yZCkgcmV0dXJuO1xuICAvLyBUaGUgcHJvcGVydHkgbWF5IGhhdmUgdmFuaXNoZWQgd2hpbGUgdGhlIGRpYWxvZyB3YXMgb3BlbiAodmlldyByZWJ1aWx0KS5cbiAgLy8gV2l0aG91dCB0aGlzIGNoZWNrIHRoZSBzaG9ydGN1dCB3b3VsZCBiZSBhbiBpbnZpc2libGUgb3JwaGFuIGluIHRoZVxuICAvLyBzZXR0aW5ncyB0aGF0IG5vdGhpbmcgZXZlciBjbGVhbnMgdXAuXG4gIGlmICghT2JqZWN0Lmhhc093bihzdG9yZS5nZXRGcm9udG1hdHRlcigpLCBrZXkpKSByZXR1cm47XG4gIHN0b3JlLnNldFNob3J0Y3V0cyh7IC4uLnN0b3JlLmdldFNob3J0Y3V0cygpLCBba2V5XTogcmVjb3JkIH0pO1xuICBzYXZlU2hvcnRjdXRzKHZpZXcsIGVkaXRvciwgc3RvcmUpO1xufVxuXG5mdW5jdGlvbiByZW1vdmVTaG9ydGN1dCh2aWV3LCBlZGl0b3IsIHN0b3JlLCByb3cpIHtcbiAgY29uc3Qga2V5ID0gcm93LmVudHJ5Py5rZXkgPz8gXCJcIjtcbiAgY29uc3Qgc2hvcnRjdXRzID0geyAuLi5zdG9yZS5nZXRTaG9ydGN1dHMoKSB9O1xuICBpZiAoIShrZXkgaW4gc2hvcnRjdXRzKSkgcmV0dXJuO1xuICBjb25zdCBzbmFwc2hvdCA9IHNuYXBzaG90U2V0dGluZ3Modmlldy5wbHVnaW4pO1xuICBkZWxldGUgc2hvcnRjdXRzW2tleV07XG4gIHN0b3JlLnNldFNob3J0Y3V0cyhzaG9ydGN1dHMpO1xuICBzYXZlU2hvcnRjdXRzKHZpZXcsIGVkaXRvciwgc3RvcmUpO1xuICBvZmZlclVuZG8odmlldy5wbHVnaW4sIGBTaG9ydGN1dCByZW1vdmVkIGZyb20gXCIke2tleX1cIi5gLCBzbmFwc2hvdCk7XG59XG5cbmZ1bmN0aW9uIHNhdmVTaG9ydGN1dHModmlldywgZWRpdG9yLCBzdG9yZSkge1xuICB2aWV3LnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgcmVuZGVyU2hvcnRjdXRDb250cm9scyh2aWV3LCBlZGl0b3IsIHN0b3JlKTtcbn1cblxuLy8gQSBzaW1wbGUgXCJhZGQgcHJvcGVydHlcIiBpbnN0ZWFkIG9mIHRoZSBpbnRlcm5hbCBlZGl0b3IuYWRkUHJvcGVydHkoKTogYWRkc1xuLy8gYW4gZW1wdHkga2V5IHdpdGggdmFsdWUgbnVsbCBhbmQgbGV0cyB0aGUgd2lkZ2V0IHJlbmRlciBpdCBub3JtYWxseSAoc2FtZVxuLy8gbG9vayBhcyBpbiBhIG5vdGUsIHNpbmNlIHN5bmNocm9uaXplKCkgcnVucyBPYnNpZGlhbidzIG93biBwaXBlbGluZSksIHRoZW5cbi8vIGZvY3VzZXMgdGhlIG5ldyBrZXkgZmllbGQuXG5mdW5jdGlvbiBhZGRCbGFua1Byb3BlcnR5KGVkaXRvcikge1xuICBpZiAoIWVkaXRvcikgcmV0dXJuO1xuICBjb25zdCBjdXJyZW50ID0gZWRpdG9yLnNlcmlhbGl6ZSgpO1xuICBpZiAoIWN1cnJlbnQuaGFzT3duUHJvcGVydHkoXCJcIikpIHtcbiAgICBjdXJyZW50W1wiXCJdID0gbnVsbDtcbiAgICBlZGl0b3Iuc3luY2hyb25pemUoY3VycmVudCk7XG4gICAgLy8gRXhpc3Rpbmcgcm93cyBrZWVwIHRoZWlyIGJ1dHRvbiAoaXQgc2l0cyBvbiBjb250YWluZXJFbCksIHRoZSBuZXcgb25lXG4gICAgLy8gbmVlZHMgb25lLlxuICAgIHJlbmRlclNob3J0Y3V0Q29udHJvbHMoZWRpdG9yLm93bmVyLnR5cFBhbmUsIGVkaXRvciwgZWRpdG9yLm93bmVyLnR5cFN0b3JlKTtcbiAgfVxuICBlZGl0b3IuZm9jdXNLZXkoXCJcIik7XG4gIC8vIENvdmVycyB0aGUgY2FzZSB3aGVyZSBtb3VudEZyb250bWF0dGVyRWRpdG9yKCkgZm91bmQgbm8gcm93IGNsYXNzIHRvIHBhdGNoXG4gIC8vIChlbXB0eSBUWVAsIG5vIG9wZW4gbm90ZSkgLSBub3cgdGhlcmUgaXMgYXQgbGVhc3Qgb25lIHJvdy5cbiAgZW5zdXJlUHJvcGVydHlNZW51UGF0Y2goZWRpdG9yLm93bmVyLmFwcCwgZWRpdG9yKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IG1vdW50RnJvbnRtYXR0ZXJFZGl0b3IsIGFkZEJsYW5rUHJvcGVydHksIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoLCByZW1vdmVQcm9wZXJ0eU1lbnVQYXRjaCwgdHlwU3RvcmUsIHN1YnR5cFN0b3JlIH07XG4iLCAiY29uc3QgeyBtb3VudEZyb250bWF0dGVyRWRpdG9yLCBhZGRCbGFua1Byb3BlcnR5LCB0eXBTdG9yZSwgc3VidHlwU3RvcmUgfSA9IHJlcXVpcmUoXCIuL3R5cC1mcm9udG1hdHRlci1lZGl0b3JcIik7XG5jb25zdCB7IGdldFNlY3Rpb25PcmRlciwgaXNFbXB0eVZhbHVlIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBzXCIpO1xuXG4vKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAqIFRoZSBmcm9udG1hdHRlciBibG9ja3Mgb2YgYSBUWVAgaW4gdGhlIFRZUC1QYW5lIGRldGFpbCAoc2VlXG4gKiByZW5kZXJUeXBTZXR0aW5ncyBpbiB0eXAtcGFuZS5qcyk6IHRoZSBUWVAtRnJvbnRtYXR0ZXIgb24gdG9wLFxuICogYmVsb3cgaXQgb25lIGJsb2NrIHBlciByZWdpc3RlcmVkIFN1YnR5cC5cbiAqXG4gKiBFYWNoIGJsb2NrIGhhcyBpdHMgb3duIGluc3RhbmNlIG9mIE9ic2lkaWFuJ3MgcHJvcGVydHkgZWRpdG9yLFxuICogYm91bmQgdG8gdHlwU3RvcmUgb3Igc3VidHlwU3RvcmUgKHNlZSB0eXAtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKS5cbiAqIFRoYXQgaXMgd2hhdCBsZXRzIHRoZSBzYW1lIGtleSBhcHBlYXIgaW4gc2V2ZXJhbCBibG9ja3MgLSBvbmVcbiAqIHNoYXJlZCBlZGl0b3Igd291bGQgaG9sZCBldmVyeXRoaW5nIGluIGEgc2luZ2xlIGZsYXQgb2JqZWN0LlxuICpcbiAqIE9ic2lkaWFuJ3Mgcm93IGRyYWcgb25seSB3b3JrcyB3aXRoaW4gb25lIGluc3RhbmNlLCBzb1xuICogcmVnaXN0ZXJQcm9wZXJ0eURyYWcoKSBiZWxvdyBidWlsZHMgb24gdGhhdCBkcmFnIHRvIG1vdmUgYVxuICogcHJvcGVydHkgYmV0d2VlbiBibG9ja3MuIEtleWJvYXJkIG5hdmlnYXRpb24gYWNyb3NzIGJsb2NrcyBpc1xuICogcmVnaXN0ZXJGb2N1c0NoYWluKCkgaW4gdHlwLWZyb250bWF0dGVyLWVkaXRvci5qcy5cbiAqXG4gKiBTZWN0aW9uOiBudWxsID0gVFlQLUZyb250bWF0dGVyLCBvdGhlcndpc2UgdGhlIFN1YnR5cCBuYW1lLlxuICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovXG5cbi8vIEEgd2hvbGUgYmxvY2sgY2FuIGJlIGdyYWJiZWQgYW55d2hlcmUgb3V0c2lkZSBpdHMgcHJvcGVydHkgcm93cyAtIGhlYWRpbmcsXG4vLyBmb290ZXIsIHNpZGUgbWFyZ2lucy4gQ29udHJvbHMgYW5kIGEgdGl0bGUgYmVpbmcgZWRpdGVkIGFyZSBleGNsdWRlZC5cbmZ1bmN0aW9uIGlzR3JhYlRhcmdldCh0YXJnZXQpIHtcbiAgaWYgKHRhcmdldC5jbG9zZXN0KFwiLmNsaWNrYWJsZS1pY29uLCAudHlwLXN1YnR5cC1jb2xvci1kb3QsIFtjb250ZW50ZWRpdGFibGU9J3RydWUnXSwgaW5wdXQsIHRleHRhcmVhXCIpKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiAhdGFyZ2V0LmNsb3Nlc3QoXCIubWV0YWRhdGEtcHJvcGVydHlcIik7XG59XG5cbi8vIHJlbmRlckhlYWRlcihzZWN0aW9uLCBlbCwgYmxvY2tzKSAvIHJlbmRlckZvb3RlcihzZWN0aW9uLCBlbCwgYmxvY2tzKSBmaWxsIGFcbi8vIGJsb2NrJ3MgaGVhZGluZyBhbmQgZm9vdGVyLiBvbk1vdmVTZWN0aW9uKG9yZGVyKSByZXBvcnRzIHRoZSBuZXcgYmxvY2sgb3JkZXJcbi8vIGFmdGVyIGEgYmxvY2sgZHJhZyAoc2hhcGVkIGxpa2UgZ2V0U2VjdGlvbk9yZGVyLCBsZWFkaW5nIG51bGwgaW5jbHVkZWQpLlxuZnVuY3Rpb24gbW91bnRGcm9udG1hdHRlckJsb2Nrcyh2aWV3LCBjb250YWluZXJFbCwgdHlwLCB7IHJlbmRlckhlYWRlciwgcmVuZGVyRm9vdGVyLCBvbk1vdmVTZWN0aW9uIH0pIHtcbiAgY29uc3Qgd3JhcHBlciA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtYmxvY2tzXCIgfSk7XG4gIGNvbnN0IHNlY3Rpb25zID0gZ2V0U2VjdGlvbk9yZGVyKHZpZXcucGx1Z2luLnNldHRpbmdzLCB0eXApO1xuICBjb25zdCBlZGl0b3JzID0gbmV3IE1hcCgpO1xuICBjb25zdCBibG9ja0VscyA9IG5ldyBNYXAoKTtcbiAgY29uc3Qgc3RvcmVzID0gbmV3IE1hcCgpO1xuXG4gIGNvbnN0IGFwaSA9IHtcbiAgICAvLyBBbGwgZWRpdG9yIGluc3RhbmNlcyBpbiBibG9jayBvcmRlcjsgdHlwLXBhbmUuanMgYWRkcyB0aGVtIGFzIGNvbXBvbmVudFxuICAgIC8vIGNoaWxkcmVuIGFuZCB1bmxvYWRzIHRoZW0gYmVmb3JlIGVhY2ggcmVidWlsZC5cbiAgICBlZGl0b3JzOiBbXSxcbiAgICAvLyBBZGRzIGEgYmxhbmsgcm93IGF0IHRoZSBlbmQgb2YgdGhlIGJsb2NrIHdpdGggZm9jdXMgaW4gdGhlIGtleSBmaWVsZFxuICAgIC8vIChzZWUgYWRkQmxhbmtQcm9wZXJ0eSkuIGZsb2F0aW5nIG1hcmtzIHRoZSBuZXh0IG5hbWVkIHByb3BlcnR5IGFzXG4gICAgLy8gZmxvYXRpbmcuXG4gICAgYWRkQmxhbmsoc2VjdGlvbiwgZmxvYXRpbmcgPSBmYWxzZSkge1xuICAgICAgY29uc3QgZWRpdG9yID0gZWRpdG9ycy5nZXQoc2VjdGlvbik7XG4gICAgICBpZiAoIWVkaXRvcikgcmV0dXJuO1xuICAgICAgZWRpdG9yLnR5cFBlbmRpbmdGbG9hdGluZ0FkZCA9IGZsb2F0aW5nO1xuICAgICAgYWRkQmxhbmtQcm9wZXJ0eShlZGl0b3IpO1xuICAgIH0sXG4gIH07XG5cbiAgLy8gTmV4dCBibG9jayBpbiBkaXJlY3Rpb24gc3RlcCB0aGF0IGhhcyBhIHJvdyB0byBqdW1wIHRvOyBlbXB0eSBibG9ja3MgYXJlXG4gIC8vIHNraXBwZWQuXG4gIGNvbnN0IGZvY3VzTmVpZ2hib3IgPSAoc2VjdGlvbiwgc3RlcCkgPT4ge1xuICAgIGZvciAobGV0IGkgPSBzZWN0aW9ucy5pbmRleE9mKHNlY3Rpb24pICsgc3RlcDsgaSA+PSAwICYmIGkgPCBzZWN0aW9ucy5sZW5ndGg7IGkgKz0gc3RlcCkge1xuICAgICAgY29uc3QgZWRpdG9yID0gZWRpdG9ycy5nZXQoc2VjdGlvbnNbaV0pO1xuICAgICAgaWYgKCFlZGl0b3IgfHwgZWRpdG9yLnJlbmRlcmVkLmxlbmd0aCA9PT0gMCkgY29udGludWU7XG4gICAgICBlZGl0b3IuZm9jdXNQcm9wZXJ0eUF0SW5kZXgoc3RlcCA+IDAgPyAwIDogLTEpO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfTtcblxuICBmb3IgKGNvbnN0IHNlY3Rpb24gb2Ygc2VjdGlvbnMpIHtcbiAgICBjb25zdCBpc1N1YiA9IHNlY3Rpb24gIT09IG51bGw7XG4gICAgY29uc3QgYmxvY2tFbCA9IHdyYXBwZXIuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJ0eXAtYmxvY2tcIiArIChpc1N1YiA/IFwiIHR5cC1mcm9udG1hdHRlci1ibG9jayB0eXAtc3VidHlwLWJsb2NrXCIgOiBcIlwiKSxcbiAgICB9KTtcbiAgICBibG9ja0Vscy5zZXQoc2VjdGlvbiwgYmxvY2tFbCk7XG4gICAgYmxvY2tFbC50eXBTZWN0aW9uID0gc2VjdGlvbjtcblxuICAgIGNvbnN0IGhlYWRlciA9IGJsb2NrRWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci1oZWFkZXIgdHlwLXNlY3Rpb24taGVhZGVyXCIgfSk7XG4gICAgaGVhZGVyLnRvZ2dsZUNsYXNzKFwidHlwLXNlY3Rpb24tc3ViXCIsIGlzU3ViKTtcblxuICAgIGNvbnN0IHN0b3JlID0gc2VjdGlvbiA9PT0gbnVsbCA/IHR5cFN0b3JlKHZpZXcucGx1Z2luLCB0eXApIDogc3VidHlwU3RvcmUodmlldy5wbHVnaW4sIHR5cCwgc2VjdGlvbik7XG4gICAgc3RvcmVzLnNldChzZWN0aW9uLCBzdG9yZSk7XG4gICAgY29uc3QgZWRpdG9yID0gbW91bnRGcm9udG1hdHRlckVkaXRvcih2aWV3LCBibG9ja0VsLCBzdG9yZSwge1xuICAgICAgb25TaGlmdEZvY3VzOiAoc3RlcCkgPT4gZm9jdXNOZWlnaGJvcihzZWN0aW9uLCBzdGVwKSxcbiAgICB9KTtcbiAgICBpZiAoZWRpdG9yKSB7XG4gICAgICBlZGl0b3JzLnNldChzZWN0aW9uLCBlZGl0b3IpO1xuICAgICAgYXBpLmVkaXRvcnMucHVzaChlZGl0b3IpO1xuICAgIH1cblxuICAgIGNvbnN0IGZvb3RlciA9IGJsb2NrRWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zZWN0aW9uLWZvb3RlclwiIH0pO1xuICAgIGZvb3Rlci50b2dnbGVDbGFzcyhcInR5cC1zZWN0aW9uLXN1YlwiLCBpc1N1Yik7XG4gICAgcmVuZGVySGVhZGVyKHNlY3Rpb24sIGhlYWRlciwgYXBpKTtcbiAgICByZW5kZXJGb290ZXI/LihzZWN0aW9uLCBmb290ZXIsIGFwaSk7XG5cbiAgICBpZiAoIWlzU3ViKSBjb250aW51ZTtcbiAgICBibG9ja0VsLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZWRvd25cIiwgKGV2ZW50KSA9PiBzdGFydEJsb2NrRHJhZyhldmVudCwgc2VjdGlvbikpO1xuICB9XG5cbiAgLy8gTW91c2UgZHJhZyBpbnN0ZWFkIG9mIEhUTUw1IGRyYWdnYWJsZTogYSBkcmFnZ2FibGUgYW5jZXN0b3IgYnJva2UgdGV4dFxuICAvLyBzZWxlY3Rpb24gaW4gdGhlIHJvdyBpbnB1dHMuIFN0YXJ0cyBhZnRlciBhIGZldyBwaXhlbHM7IGFuIGFjY2VudCBsaW5lXG4gIC8vIHNob3dzIHRoZSB0YXJnZXQgZ2FwLCBFc2NhcGUgY2FuY2Vscy4gVGhlIFRZUC1Gcm9udG1hdHRlciBpcyBmaXhlZCBvbiB0b3BcbiAgLy8gKHNlZSBnZXRTZWN0aW9uT3JkZXIpLCBzbyB0YXJnZXQgMCBkb2Vzbid0IGV4aXN0LlxuICBmdW5jdGlvbiBzdGFydEJsb2NrRHJhZyhldmVudCwgc2VjdGlvbikge1xuICAgIGlmIChldmVudC5idXR0b24gIT09IDAgfHwgIWlzR3JhYlRhcmdldChldmVudC50YXJnZXQpKSByZXR1cm47XG4gICAgY29uc3Qgd2luID0gd3JhcHBlci53aW47XG4gICAgY29uc3Qgc3RhcnRZID0gZXZlbnQuY2xpZW50WTtcbiAgICBsZXQgZHJhZ2dpbmcgPSBmYWxzZTtcbiAgICBsZXQgaW5kaWNhdG9yID0gbnVsbDtcbiAgICBsZXQgYm94ZXMgPSBbXTtcbiAgICBsZXQgdGFyZ2V0SW5kZXggPSBudWxsO1xuXG4gICAgY29uc3QgbWVhc3VyZSA9ICgpID0+IHtcbiAgICAgIGNvbnN0IGJhc2UgPSB3cmFwcGVyLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgYm94ZXMgPSBzZWN0aW9ucy5tYXAoKG5hbWUpID0+IHtcbiAgICAgICAgY29uc3QgcmVjdCA9IGJsb2NrRWxzLmdldChuYW1lKS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgICAgcmV0dXJuIHsgc2VjdGlvbjogbmFtZSwgdG9wOiByZWN0LnRvcCAtIGJhc2UudG9wLCBib3R0b206IHJlY3QuYm90dG9tIC0gYmFzZS50b3AgfTtcbiAgICAgIH0pO1xuICAgIH07XG5cbiAgICBjb25zdCBvbk1vdmUgPSAobW92ZUV2ZW50KSA9PiB7XG4gICAgICBpZiAoIWRyYWdnaW5nKSB7XG4gICAgICAgIGlmIChNYXRoLmFicyhtb3ZlRXZlbnQuY2xpZW50WSAtIHN0YXJ0WSkgPCA0KSByZXR1cm47XG4gICAgICAgIGRyYWdnaW5nID0gdHJ1ZTtcbiAgICAgICAgd3JhcHBlci5kb2MuYm9keS5hZGRDbGFzcyhcInR5cC1ibG9jay1kcmFnZ2luZ1wiKTtcbiAgICAgICAgd2luLmdldFNlbGVjdGlvbigpPy5yZW1vdmVBbGxSYW5nZXMoKTtcbiAgICAgICAgYmxvY2tFbHMuZ2V0KHNlY3Rpb24pLmFkZENsYXNzKFwiaXMtZHJhZ2dpbmdcIik7XG4gICAgICAgIG1lYXN1cmUoKTtcbiAgICAgICAgaW5kaWNhdG9yID0gd3JhcHBlci5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWJsb2NrLWRyb3AtaW5kaWNhdG9yXCIgfSk7XG4gICAgICB9XG4gICAgICBtb3ZlRXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGNvbnN0IHkgPSBtb3ZlRXZlbnQuY2xpZW50WSAtIHdyYXBwZXIuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCkudG9wO1xuICAgICAgdGFyZ2V0SW5kZXggPSBNYXRoLm1heCgxLCBib3hlcy5maWx0ZXIoKGJveCkgPT4gKGJveC50b3AgKyBib3guYm90dG9tKSAvIDIgPCB5KS5sZW5ndGgpO1xuICAgICAgY29uc3QgZnJvbSA9IGJveGVzLmZpbmRJbmRleCgoYm94KSA9PiBib3guc2VjdGlvbiA9PT0gc2VjdGlvbik7XG4gICAgICBpbmRpY2F0b3IudG9nZ2xlKHRhcmdldEluZGV4ICE9PSBmcm9tICYmIHRhcmdldEluZGV4ICE9PSBmcm9tICsgMSk7XG4gICAgICAvLyBNaWRkbGUgb2YgdGhlIGdhcCBiZXR3ZWVuIHR3byBibG9ja3MgKHNlZSAudHlwLWJsb2NrICsgLnR5cC1ibG9jayBpblxuICAgICAgLy8gc3R5bGVzLmNzcykuXG4gICAgICBjb25zdCBoYWxmR2FwID0gNjtcbiAgICAgIGNvbnN0IGdhcFkgPVxuICAgICAgICB0YXJnZXRJbmRleCA9PT0gYm94ZXMubGVuZ3RoXG4gICAgICAgICAgPyBib3hlc1tib3hlcy5sZW5ndGggLSAxXS5ib3R0b20gKyBoYWxmR2FwXG4gICAgICAgICAgOiAoYm94ZXNbdGFyZ2V0SW5kZXggLSAxXS5ib3R0b20gKyBib3hlc1t0YXJnZXRJbmRleF0udG9wKSAvIDI7XG4gICAgICBpbmRpY2F0b3Iuc3R5bGUudG9wID0gYCR7Z2FwWSAtIDF9cHhgO1xuICAgIH07XG5cbiAgICBjb25zdCBlbmQgPSAoY29tbWl0KSA9PiB7XG4gICAgICB3aW4ucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNlbW92ZVwiLCBvbk1vdmUpO1xuICAgICAgd2luLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtb3VzZXVwXCIsIG9uVXApO1xuICAgICAgd2luLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIG9uS2V5LCB0cnVlKTtcbiAgICAgIGlmICghZHJhZ2dpbmcpIHJldHVybjtcbiAgICAgIHdyYXBwZXIuZG9jLmJvZHkucmVtb3ZlQ2xhc3MoXCJ0eXAtYmxvY2stZHJhZ2dpbmdcIik7XG4gICAgICBibG9ja0Vscy5nZXQoc2VjdGlvbikucmVtb3ZlQ2xhc3MoXCJpcy1kcmFnZ2luZ1wiKTtcbiAgICAgIGluZGljYXRvcj8ucmVtb3ZlKCk7XG5cbiAgICAgIGNvbnN0IG9yZGVyID0gYm94ZXMubWFwKChib3gpID0+IGJveC5zZWN0aW9uKTtcbiAgICAgIGNvbnN0IGZyb20gPSBvcmRlci5pbmRleE9mKHNlY3Rpb24pO1xuICAgICAgaWYgKCFjb21taXQgfHwgdGFyZ2V0SW5kZXggPT09IG51bGwgfHwgdGFyZ2V0SW5kZXggPT09IGZyb20gfHwgdGFyZ2V0SW5kZXggPT09IGZyb20gKyAxKSByZXR1cm47XG4gICAgICBvcmRlci5zcGxpY2UoZnJvbSwgMSk7XG4gICAgICBvcmRlci5zcGxpY2UoZnJvbSA8IHRhcmdldEluZGV4ID8gdGFyZ2V0SW5kZXggLSAxIDogdGFyZ2V0SW5kZXgsIDAsIHNlY3Rpb24pO1xuICAgICAgb25Nb3ZlU2VjdGlvbj8uKG9yZGVyKTtcbiAgICB9O1xuICAgIGNvbnN0IG9uVXAgPSAoKSA9PiBlbmQodHJ1ZSk7XG4gICAgY29uc3Qgb25LZXkgPSAoa2V5RXZlbnQpID0+IHtcbiAgICAgIGlmIChrZXlFdmVudC5rZXkgIT09IFwiRXNjYXBlXCIpIHJldHVybjtcbiAgICAgIGtleUV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBrZXlFdmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIGVuZChmYWxzZSk7XG4gICAgfTtcbiAgICB3aW4uYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlbW92ZVwiLCBvbk1vdmUpO1xuICAgIHdpbi5hZGRFdmVudExpc3RlbmVyKFwibW91c2V1cFwiLCBvblVwKTtcbiAgICB3aW4uYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgb25LZXksIHRydWUpO1xuICB9XG5cbiAgcmVnaXN0ZXJQcm9wZXJ0eURyYWcoKTtcbiAgcmV0dXJuIGFwaTtcblxuICAvKiAtLS0gRHJhZ2dpbmcgYSBwcm9wZXJ0eSBpbnRvIGFub3RoZXIgYmxvY2sgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgKiBCdWlsdCBvbiBPYnNpZGlhbidzIG93biByb3cgZHJhZyByYXRoZXIgdGhhbiBhIHNlY29uZCBvbmUgbmV4dCB0byBpdDpcbiAgICogaXQgc3RhcnRzIGF0IHRoZSByb3cncyB0eXBlIGljb24sIHB1dHMgYSAuZHJhZy1yZW9yZGVyLWdob3N0IG9uIHRoZVxuICAgKiBib2R5IChzbyBpdCBmb2xsb3dzIHRoZSBjdXJzb3IgYWNyb3NzIGJsb2NrcyBhbnl3YXkpIGFuZCBtYXJrcyB0aGVcbiAgICogc291cmNlIHJvdyB3aXRoIC5kcmFnLWdob3N0LWhpZGRlbiwgdGhlIGFjY2VudCBib3ggc2hvd2luZyB0aGUgZHJvcFxuICAgKiBzcG90LiBXaXRoaW4gb25lIGJsb2NrIE9ic2lkaWFuIGRvZXMgZXZlcnl0aGluZyBhcyB1c3VhbC4gQWRkZWQgaGVyZTpcbiAgICpcbiAgICogIC0gYW4gZW1wdHkgZXh0cmEgY2hpbGQgaW4gdGhlIGxpc3Qgd2hpbGUgZHJhZ2dpbmc6IG90aGVyd2lzZSBPYnNpZGlhblxuICAgKiAgICBkb2Vzbid0IHN0YXJ0IHRoZSBkcmFnIGluIGEgYmxvY2sgd2l0aCBhIHNpbmdsZSByb3cgKGl0cyBtb3VzZWRvd25cbiAgICogICAgY2hlY2tzIG4uZmlyc3RDaGlsZCAhPT0gbi5sYXN0Q2hpbGQpO1xuICAgKiAgLSBhIHBsYWNlaG9sZGVyIHdpdGggdGhlIHNhbWUgLmRyYWctZ2hvc3QtaGlkZGVuIGNsYXNzIGluIHRoZSB0YXJnZXRcbiAgICogICAgYmxvY2sgb25jZSB0aGUgY3Vyc29yIHJlYWNoZXMgYW5vdGhlciBibG9jazsgdGhlIHNvdXJjZSByb3cgaXNcbiAgICogICAgaGlkZGVuIG1lYW53aGlsZSBzbyB0aGVyZSBhcmVuJ3QgdHdvIGJveGVzO1xuICAgKiAgLSBhIHJlb3JkZXJLZXkgcGVyIGluc3RhbmNlIHRoYXQgbW92ZXMgdGhlIHByb3BlcnR5IHRvIHRoZSBvdGhlclxuICAgKiAgICBibG9jayBvbiBkcm9wIGluc3RlYWQgb2Ygc29ydGluZyB3aXRoaW4gaXRzIG93bi5cbiAgICpcbiAgICogT3VyIGhhbmRsZXJzIHJ1biBpbiB0aGUgY2FwdHVyZSBwaGFzZSBvbiB0aGUgd2luZG93LCBiZWZvcmUgT2JzaWRpYW4nc1xuICAgKiAod2hpY2ggaXQgYWRkcyB0byB3aW5kb3cgaW4gaXRzIG1vdXNlZG93biBoYW5kbGVyKS5cbiAgICogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cbiAgZnVuY3Rpb24gcmVnaXN0ZXJQcm9wZXJ0eURyYWcoKSB7XG4gICAgLy8gV2l0aG91dCBhIHNlY29uZCBibG9jayB0aGVyZSBpcyBubyB0YXJnZXQ7IE9ic2lkaWFuJ3MgZHJhZyBzdGF5cyBhcyBpcy5cbiAgICBjb25zdCBhbmNob3IgPSBhcGkuZWRpdG9yc1swXTtcbiAgICBpZiAoIWFuY2hvciB8fCBzZWN0aW9ucy5sZW5ndGggPCAyKSByZXR1cm47XG5cbiAgICAvLyBTdGF0ZSBvZiBhIHJ1bm5pbmcgZHJhZzsgZHJvcCBrZWVwcyB0aGUgdGFyZ2V0IGZvciB0aGUgcmVvcmRlcktleSBjYWxsXG4gICAgLy8gdGhhdCBmb2xsb3dzIHRoZSBtb3VzZXVwLlxuICAgIGxldCBkcmFnID0gbnVsbDtcbiAgICBsZXQgZHJvcCA9IG51bGw7XG5cbiAgICBjb25zdCBzZWN0aW9uQXQgPSAoY2xpZW50WSkgPT5cbiAgICAgIHNlY3Rpb25zLmZpbmQoKHNlY3Rpb24pID0+IHtcbiAgICAgICAgY29uc3QgcmVjdCA9IGJsb2NrRWxzLmdldChzZWN0aW9uKS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgICAgcmV0dXJuIGNsaWVudFkgPj0gcmVjdC50b3AgJiYgY2xpZW50WSA8PSByZWN0LmJvdHRvbTtcbiAgICAgIH0pO1xuXG4gICAgY29uc3QgY2xlYXJQbGFjZWhvbGRlciA9ICgpID0+IHtcbiAgICAgIGRyYWcucGxhY2Vob2xkZXI/LnJlbW92ZSgpO1xuICAgICAgZHJhZy5wbGFjZWhvbGRlciA9IG51bGw7XG4gICAgICBkcmFnLnJvd0VsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiZGlzcGxheVwiKTtcbiAgICAgIGRyYWcudGFyZ2V0ID0gbnVsbDtcbiAgICB9O1xuXG4gICAgd3JhcHBlci5hZGRFdmVudExpc3RlbmVyKFxuICAgICAgXCJtb3VzZWRvd25cIixcbiAgICAgIChldmVudCkgPT4ge1xuICAgICAgICBpZiAoZXZlbnQuYnV0dG9uICE9PSAwKSByZXR1cm47XG4gICAgICAgIGNvbnN0IHJvd0VsID0gZXZlbnQudGFyZ2V0LmNsb3Nlc3QoXCIubWV0YWRhdGEtcHJvcGVydHktaWNvblwiKT8uY2xvc2VzdChcIi5tZXRhZGF0YS1wcm9wZXJ0eVwiKTtcbiAgICAgICAgY29uc3Qgc2VjdGlvbiA9IHJvd0VsPy5jbG9zZXN0KFwiLnR5cC1ibG9ja1wiKT8udHlwU2VjdGlvbjtcbiAgICAgICAgY29uc3QgZWRpdG9yID0gc2VjdGlvbiA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IGVkaXRvcnMuZ2V0KHNlY3Rpb24pO1xuICAgICAgICBjb25zdCBrZXkgPSBlZGl0b3I/LnJlbmRlcmVkLmZpbmQoKHJvdykgPT4gcm93LmNvbnRhaW5lckVsID09PSByb3dFbCk/LmVudHJ5LmtleTtcbiAgICAgICAgLy8gQW4gdW5uYW1lZCByb3cgaGFzIG5vIGJ1c2luZXNzIGluIGFub3RoZXIgYmxvY2s7IE9ic2lkaWFuIHNvcnRzIGl0LlxuICAgICAgICBpZiAoIWtleSkgcmV0dXJuO1xuICAgICAgICBkcmFnID0ge1xuICAgICAgICAgIHNlY3Rpb24sXG4gICAgICAgICAga2V5LFxuICAgICAgICAgIHJvd0VsLFxuICAgICAgICAgIC8vIE1lYXN1cmVkIG5vdzogb25jZSBoaWRkZW4gZm9yIHRoZSBwbGFjZWhvbGRlciwgb2Zmc2V0SGVpZ2h0IGlzIDAuXG4gICAgICAgICAgaGVpZ2h0OiByb3dFbC5vZmZzZXRIZWlnaHQsXG4gICAgICAgICAgc3BhY2VyOiBlZGl0b3IucHJvcGVydHlMaXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1kcmFnLXNwYWNlclwiIH0pLFxuICAgICAgICAgIHBsYWNlaG9sZGVyOiBudWxsLFxuICAgICAgICAgIHRhcmdldDogbnVsbCxcbiAgICAgICAgfTtcbiAgICAgICAgZHJvcCA9IG51bGw7XG4gICAgICB9LFxuICAgICAgdHJ1ZVxuICAgICk7XG5cbiAgICAvLyBPbiB0aGUgd2luZG93IHNvIGEgZHJhZyBpcyB0cmFja2VkIG91dHNpZGUgdGhlIGJsb2NrcyB0b287IHJlbW92ZWQgd2l0aFxuICAgIC8vIHRoZSBmaXJzdCBlZGl0b3IsIHdoaWNoIHVubG9hZHMgb24gdGhlIG5leHQgcmVidWlsZCBvZiB0aGUgZGV0YWlsIHZpZXcuXG4gICAgY29uc3Qgb25XaW5Nb3ZlID0gKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoIWRyYWcpIHJldHVybjtcbiAgICAgIGNvbnN0IHRhcmdldCA9IHNlY3Rpb25BdChldmVudC5jbGllbnRZKTtcbiAgICAgIGlmICh0YXJnZXQgPT09IHVuZGVmaW5lZCB8fCB0YXJnZXQgPT09IGRyYWcuc2VjdGlvbikge1xuICAgICAgICBpZiAoZHJhZy5wbGFjZWhvbGRlcikgY2xlYXJQbGFjZWhvbGRlcigpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGxpc3QgPSBlZGl0b3JzLmdldCh0YXJnZXQpLnByb3BlcnR5TGlzdEVsO1xuICAgICAgaWYgKCFkcmFnLnBsYWNlaG9sZGVyKSB7XG4gICAgICAgIGRyYWcucm93RWwuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xuICAgICAgICBkcmFnLnBsYWNlaG9sZGVyID0gY3JlYXRlRGl2KHsgY2xzOiBcIm1ldGFkYXRhLXByb3BlcnR5IGRyYWctZ2hvc3QtaGlkZGVuIHR5cC1kcmFnLXBsYWNlaG9sZGVyXCIgfSk7XG4gICAgICAgIGRyYWcucGxhY2Vob2xkZXIuc3R5bGUuaGVpZ2h0ID0gYCR7ZHJhZy5oZWlnaHR9cHhgO1xuICAgICAgfVxuICAgICAgLy8gRHJvcCBzcG90IGFzIE9ic2lkaWFuIGRvZXMgaXQ6IGJlZm9yZSB0aGUgZmlyc3Qgcm93IHdob3NlIG1pZGRsZSBpc1xuICAgICAgLy8gYmVsb3cgdGhlIGN1cnNvci5cbiAgICAgIGNvbnN0IHJvd3MgPSBbLi4ubGlzdC5jaGlsZHJlbl0uZmlsdGVyKChlbCkgPT4gZWwgIT09IGRyYWcucGxhY2Vob2xkZXIgJiYgZWwgIT09IGRyYWcuc3BhY2VyKTtcbiAgICAgIGNvbnN0IGJlZm9yZSA9IHJvd3MuZmluZCgoZWwpID0+IHtcbiAgICAgICAgY29uc3QgcmVjdCA9IGVsLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgICByZXR1cm4gZXZlbnQuY2xpZW50WSA8IHJlY3QudG9wICsgcmVjdC5oZWlnaHQgLyAyO1xuICAgICAgfSk7XG4gICAgICBkcmFnLnRhcmdldCA9IHsgc2VjdGlvbjogdGFyZ2V0LCBpbmRleDogYmVmb3JlID8gcm93cy5pbmRleE9mKGJlZm9yZSkgOiByb3dzLmxlbmd0aCB9O1xuICAgICAgbGlzdC5pbnNlcnRCZWZvcmUoZHJhZy5wbGFjZWhvbGRlciwgYmVmb3JlID8/IG51bGwpO1xuICAgIH07XG5cbiAgICBjb25zdCBvbldpblVwID0gKCkgPT4ge1xuICAgICAgaWYgKCFkcmFnKSByZXR1cm47XG4gICAgICBjb25zdCB7IHNwYWNlciwgcGxhY2Vob2xkZXIsIHJvd0VsLCB0YXJnZXQgfSA9IGRyYWc7XG4gICAgICBkcmFnID0gbnVsbDtcbiAgICAgIGRyb3AgPSB0YXJnZXQ7XG4gICAgICBwbGFjZWhvbGRlcj8ucmVtb3ZlKCk7XG4gICAgICByb3dFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImRpc3BsYXlcIik7XG4gICAgICAvLyBPbmx5IGFmdGVyIE9ic2lkaWFuIGZpbmlzaGVzIGl0cyBkcmFnOiBpdCBzdGlsbCByZWFkcyB0aGUgZHJvcCBzcG90XG4gICAgICAvLyBpbiB0aGUgc291cmNlIGJsb2NrIGZyb20gdGhlIGNoaWxkIGxpc3QsIHdoZXJlIHRoZSBzcGFjZXIgbWFya3MgdGhlXG4gICAgICAvLyBsYXN0IHBvc2l0aW9uLlxuICAgICAgd3JhcHBlci53aW4uc2V0VGltZW91dCgoKSA9PiBzcGFjZXIucmVtb3ZlKCksIDApO1xuICAgIH07XG5cbiAgICB3cmFwcGVyLndpbi5hZGRFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIG9uV2luTW92ZSwgdHJ1ZSk7XG4gICAgd3JhcHBlci53aW4uYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNldXBcIiwgb25XaW5VcCwgdHJ1ZSk7XG4gICAgYW5jaG9yLnJlZ2lzdGVyKCgpID0+IHtcbiAgICAgIHdyYXBwZXIud2luLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtb3VzZW1vdmVcIiwgb25XaW5Nb3ZlLCB0cnVlKTtcbiAgICAgIHdyYXBwZXIud2luLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtb3VzZXVwXCIsIG9uV2luVXAsIHRydWUpO1xuICAgIH0pO1xuXG4gICAgZm9yIChjb25zdCBbc2VjdGlvbiwgZWRpdG9yXSBvZiBlZGl0b3JzKSB7XG4gICAgICBjb25zdCBvcmlnaW5hbFJlb3JkZXJLZXkgPSBlZGl0b3IucmVvcmRlcktleTtcbiAgICAgIGVkaXRvci5yZW9yZGVyS2V5ID0gZnVuY3Rpb24gKGVudHJ5LCBpbmRleCkge1xuICAgICAgICBjb25zdCB0YXJnZXQgPSBkcm9wO1xuICAgICAgICBkcm9wID0gbnVsbDtcbiAgICAgICAgaWYgKCF0YXJnZXQpIHJldHVybiBvcmlnaW5hbFJlb3JkZXJLZXkuY2FsbCh0aGlzLCBlbnRyeSwgaW5kZXgpO1xuICAgICAgICBtb3ZlUHJvcGVydHkoc2VjdGlvbiwgdGFyZ2V0LnNlY3Rpb24sIGVudHJ5LmtleSwgdGFyZ2V0LmluZGV4KTtcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgLy8gTW92ZXMga2V5IGZyb20gYmxvY2sgYGZyb21gIHRvIGJsb2NrIGB0b2AgYXQgcG9zaXRpb24gaW5kZXguIElmIHRoZSB0YXJnZXRcbiAgLy8gYWxyZWFkeSBoYXMgdGhlIG5hbWUgKHVuaXF1ZSB3aXRoaW4gYSBibG9jayksIHRoZSB0d28gbWVyZ2U6IHRoZSBleGlzdGluZ1xuICAvLyBlbnRyeSBrZWVwcyBwb3NpdGlvbiwgdmFsdWUsIGZsb2F0aW5nIGZsYWcgYW5kIHNob3J0Y3V0OyBvbmx5IGFuIGVtcHR5XG4gIC8vIHZhbHVlIGlzIGZpbGxlZCBmcm9tIHRoZSBkcmFnZ2VkIG9uZSAtIHNhbWUgcnVsZSBhcyBtZXJnZVN1YnR5cHNcbiAgLy8gKHN1YnR5cHMuanMpIGFuZCByZW5hbWVJblN0b3JlIChwcm9wZXJ0eS1yZW5hbWUtc3luYy5qcykuXG4gIGFzeW5jIGZ1bmN0aW9uIG1vdmVQcm9wZXJ0eShmcm9tLCB0bywga2V5LCBpbmRleCkge1xuICAgIGNvbnN0IHNvdXJjZSA9IHN0b3Jlcy5nZXQoZnJvbSk7XG4gICAgY29uc3QgdGFyZ2V0ID0gc3RvcmVzLmdldCh0byk7XG4gICAgaWYgKCFzb3VyY2UgfHwgIXRhcmdldCB8fCBmcm9tID09PSB0bykgcmV0dXJuO1xuXG4gICAgY29uc3Qgc291cmNlRnJvbnRtYXR0ZXIgPSB7IC4uLnNvdXJjZS5nZXRGcm9udG1hdHRlcigpIH07XG4gICAgY29uc3QgdmFsdWUgPSBzb3VyY2VGcm9udG1hdHRlcltrZXldO1xuICAgIGNvbnN0IHdhc0Zsb2F0aW5nID0gc291cmNlLmdldEZsb2F0aW5nKCkuaW5jbHVkZXMoa2V5KTtcbiAgICAvLyBUaGUgc2hvcnRjdXQgYmVsb25ncyB0byB0aGUga2V5IGFuZCBtb3ZlcyB3aXRoIGl0LlxuICAgIGNvbnN0IHNvdXJjZVNob3J0Y3V0cyA9IHsgLi4uc291cmNlLmdldFNob3J0Y3V0cygpIH07XG4gICAgY29uc3Qgc2hvcnRjdXQgPSBzb3VyY2VTaG9ydGN1dHNba2V5XSA/PyBudWxsO1xuICAgIGRlbGV0ZSBzb3VyY2VTaG9ydGN1dHNba2V5XTtcbiAgICBkZWxldGUgc291cmNlRnJvbnRtYXR0ZXJba2V5XTtcbiAgICBzb3VyY2Uuc2V0RnJvbnRtYXR0ZXIoc291cmNlRnJvbnRtYXR0ZXIpO1xuICAgIHNvdXJjZS5zZXRGbG9hdGluZyhzb3VyY2UuZ2V0RmxvYXRpbmcoKS5maWx0ZXIoKGspID0+IGsgIT09IGtleSkpO1xuICAgIHNvdXJjZS5zZXRTaG9ydGN1dHMoc291cmNlU2hvcnRjdXRzKTtcblxuICAgIGNvbnN0IHRhcmdldEZyb250bWF0dGVyID0gdGFyZ2V0LmdldEZyb250bWF0dGVyKCk7XG4gICAgY29uc3QgZXhpc3RpbmcgPSBPYmplY3Qua2V5cyh0YXJnZXRGcm9udG1hdHRlcikuZmluZCgoaykgPT4gay50b0xvd2VyQ2FzZSgpID09PSBrZXkudG9Mb3dlckNhc2UoKSk7XG4gICAgaWYgKGV4aXN0aW5nICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChpc0VtcHR5VmFsdWUodGFyZ2V0RnJvbnRtYXR0ZXJbZXhpc3RpbmddKSkgdGFyZ2V0LnNldEZyb250bWF0dGVyKHsgLi4udGFyZ2V0RnJvbnRtYXR0ZXIsIFtleGlzdGluZ106IHZhbHVlIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXModGFyZ2V0RnJvbnRtYXR0ZXIpO1xuICAgICAgY29uc3QgYXQgPSBNYXRoLm1heCgwLCBNYXRoLm1pbihpbmRleCwga2V5cy5sZW5ndGgpKTtcbiAgICAgIGNvbnN0IG5leHQgPSB7fTtcbiAgICAgIGZvciAoY29uc3QgayBvZiBrZXlzLnNsaWNlKDAsIGF0KSkgbmV4dFtrXSA9IHRhcmdldEZyb250bWF0dGVyW2tdO1xuICAgICAgbmV4dFtrZXldID0gdmFsdWU7XG4gICAgICBmb3IgKGNvbnN0IGsgb2Yga2V5cy5zbGljZShhdCkpIG5leHRba10gPSB0YXJnZXRGcm9udG1hdHRlcltrXTtcbiAgICAgIHRhcmdldC5zZXRGcm9udG1hdHRlcihuZXh0KTtcbiAgICAgIGlmICh3YXNGbG9hdGluZykgdGFyZ2V0LnNldEZsb2F0aW5nKFsuLi50YXJnZXQuZ2V0RmxvYXRpbmcoKSwga2V5XSk7XG4gICAgICBpZiAoc2hvcnRjdXQpIHRhcmdldC5zZXRTaG9ydGN1dHMoeyAuLi50YXJnZXQuZ2V0U2hvcnRjdXRzKCksIFtrZXldOiBzaG9ydGN1dCB9KTtcbiAgICB9XG5cbiAgICBhd2FpdCB2aWV3LnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAvLyBSZS1yZW5kZXJzIHRoaXMgZGV0YWlsIHZpZXcgYW1vbmcgb3RoZXJzOyBibG9ja3MgYW5kIGVkaXRvcnMgYXJlIHJlYnVpbHRcbiAgICAvLyBmcm9tIHRoZSBzZXR0aW5ncy5cbiAgICB2aWV3LnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgbW91bnRGcm9udG1hdHRlckJsb2NrcyB9O1xuIiwgImNvbnN0IHsgSXRlbVZpZXcsIE1lbnUsIE5vdGljZSwgc2V0SWNvbiwgZGVib3VuY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgQ29uZmlybU1vZGFsLCB0eXBOYW1lTm9kZSwgc3VidHlwTmFtZU5vZGUgfSA9IHJlcXVpcmUoXCIuL2NvbmZpcm0tbW9kYWxcIik7XG5jb25zdCB7IHNuYXBzaG90U2V0dGluZ3MsIG9mZmVyVW5kbyB9ID0gcmVxdWlyZShcIi4vdW5kb1wiKTtcbmNvbnN0IHsgbW91bnRGcm9udG1hdHRlckJsb2NrcyB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItYmxvY2tzXCIpO1xuY29uc3Qge1xuICBub3JtYWxpemVTdWJ0eXBOYW1lLFxuICBnZXRTdWJ0eXBOYW1lcyxcbiAgZW5zdXJlU3VidHlwLFxuICBtb3ZlVHlwU3VidHlwcyxcbiAgZGVsZXRlVHlwU3VidHlwcyxcbiAgbWVyZ2VUeXBTdWJ0eXBzLFxuICBnZXRTdWJ0eXAsXG4gIGlzU3VidHlwTWFudWFsLFxuICBzZXRTdWJ0eXBNYW51YWwsXG4gIHNldEFsbFN1YnR5cHNNYW51YWwsXG4gIHJlbmFtZVN1YnR5cCxcbiAgcmVvcmRlclN1YnR5cHMsXG4gIGRlbGV0ZVN1YnR5cCxcbiAgbWVyZ2VTdWJ0eXBzLFxuICByZW5hbWVTdWJ0eXBJbk5vdGVzLFxufSA9IHJlcXVpcmUoXCIuL3N1YnR5cHNcIik7XG5jb25zdCB7IG5vcm1hbGl6ZVR5cE5hbWUsIGNvbXBhcmVUeXBzLCBzb3J0VHlwc0J5TW9kZSwgcGx1cmFsLCBqb2luQW5kIH0gPSByZXF1aXJlKFwiLi90eXAtdXRpbHNcIik7XG5jb25zdCB7IHR5cEtleU9mLCBwcm9wZXJ0eVZhbHVlLCBzZXRDYW5vbmljYWxQcm9wZXJ0eSwgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcbmNvbnN0IHtcbiAgc3VidHlwQ29sb3IsXG4gIGFwcGx5Q29sb3JPZmZzZXQsXG4gIGhhc0NvbG9yT2Zmc2V0LFxuICBzdWJ0eXBIYXNPd25Db2xvcixcbiAgcGFpbnRDb2xvckRvdCxcbiAgbmFtZUNvbG9yLFxuICBjaGFubmVsQm91bmRzLFxuICBjbGFtcGVkT2Zmc2V0LFxuICBTVUJUWVBfQ09MT1JfQ0hBTk5FTFMsXG4gIERFRkFVTFRfVFlQX0NPTE9SLFxufSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5cbmNvbnN0IFZJRVdfVFlQRV9UWVBfUEFORSA9IFwidHlwLXN5c3RlbS1wYW5lXCI7XG5jb25zdCBERUZBVUxUX1NPUlRfT1JERVIgPSBcImNvdW50LWRlc2NcIjtcbmNvbnN0IERFRkFVTFRfU0VDT05EQVJZID0gXCJzdWJ0eXBzXCI7XG5cbi8vIFdoYXQgdGhlIFRZUC1MaXN0IHNob3dzIG5leHQgdG8gdGhlIG5hbWUgKHNldHRpbmdzLnR5cExpc3RTZWNvbmRhcnkpLFxuLy8gY3ljbGVkIGJ5IGEgaGVhZGVyIGJ1dHRvbiBuZXh0IHRvIHNvcnRpbmcgKHNlZSBjeWNsZVNlY29uZGFyeSkgLSB0b28gZmV3LFxuLy8gdG9vIGltbWVkaWF0ZWx5IHZpc2libGUgc3RhdGVzIGZvciBhIG1lbnUuXG4vLyAgIHN1YnR5cHMgICAgIC0gdGhlIFRZUCdzIFN1YnR5cHMgaW4gYnJhY2tldHMsIGVhY2ggaW4gaXRzIGNvbG9yIChsaWtlIHRoZVxuLy8gICAgICAgICAgICAgICAgIHByZXZpZXcgaW4gdGhlIHNlcGFyYXRlIFRZUC1QaWNrZXIpXG4vLyAgIGRlc2NyaXB0aW9uIC0gdGV4dCBmaWVsZCB0byBlZGl0IHRoZSBUWVAgZGVzY3JpcHRpb25cbi8vICAgbm9uZSAgICAgICAgLSBub3RoaW5nLCB0aGUgbmFtZSBnZXRzIHRoZSB3aG9sZSByb3dcbi8vIFRoZSBvcmRlciBpcyBhbHNvIHRoZSBjeWNsZSBvcmRlcjsgdGhlIGZpcnN0IGlzIHRoZSBkZWZhdWx0OiB0aGUgU3VidHlwc1xuLy8gYXBwZWFyIG5vd2hlcmUgZWxzZSBpbiB0aGUgbGlzdCwgdGhlIGRlc2NyaXB0aW9uIGFsc28gaW4gdGhlIGRldGFpbCB2aWV3LlxuY29uc3QgU0VDT05EQVJZX01PREVTID0gW1xuICB7IG1vZGU6IFwic3VidHlwc1wiLCB0aXRsZTogXCJTdWJ0eXAgbGlzdFwiLCBpY29uOiBcImxpc3QtdHJlZVwiIH0sXG4gIHsgbW9kZTogXCJkZXNjcmlwdGlvblwiLCB0aXRsZTogXCJEZXNjcmlwdGlvblwiLCBpY29uOiBcInRleHQtY3Vyc29yLWlucHV0XCIgfSxcbiAgeyBtb2RlOiBcIm5vbmVcIiwgdGl0bGU6IFwiTm90aGluZ1wiLCBpY29uOiBcIm1pbnVzXCIgfSxcbl07XG5cbmNvbnN0IFNPUlRfT1BUSU9OUyA9IFtcbiAgLy8gVW5saWtlIHRoZSBvdGhlcnMsIFwibWFudWFsXCIgaGFzIG5vIGNvbXBhcmlzb246IHRoZSBvcmRlciBvZiBzZXR0aW5ncy50eXBzXG4gIC8vIGl0c2VsZiBpcyB0aGUgc3RvcmFnZSAoc2VlIHJlbmRlcigpIGFuZCByZW5kZXJSZWdpc3RlcmVkSXRlbSgpIGZvciB0aGVcbiAgLy8gZHJhZyAmIGRyb3AgcmVuZGVyaW5nIGJ1aWx0IG9uIGl0KS4gRmlyc3Qgb24gcHVycG9zZSAtIGl0cyBvd24gZ3JvdXAgYXRcbiAgLy8gdGhlIHRvcCBvZiB0aGUgbWVudSAoc2VlIHNob3dTb3J0TWVudSkuXG4gIHsgbW9kZTogXCJtYW51YWxcIiwgdGl0bGU6IFwiTWFudWFsIChkcmFnICYgZHJvcClcIiB9LFxuICB7IG1vZGU6IFwiY291bnQtZGVzY1wiLCB0aXRsZTogXCJNb3N0IG5vdGVzIGZpcnN0XCIgfSxcbiAgeyBtb2RlOiBcImNvdW50LWFzY1wiLCB0aXRsZTogXCJGZXdlc3Qgbm90ZXMgZmlyc3RcIiB9LFxuICB7IG1vZGU6IFwibmFtZS1hc2NcIiwgdGl0bGU6IFwiTmFtZSAoQSB0byBaKVwiIH0sXG4gIHsgbW9kZTogXCJuYW1lLWRlc2NcIiwgdGl0bGU6IFwiTmFtZSAoWiB0byBBKVwiIH0sXG4gIHsgbW9kZTogXCJjb2xvci1hc2NcIiwgdGl0bGU6IFwiQ29sb3IgKHJlZCBcdTIxOTIgdmlvbGV0KVwiIH0sXG4gIHsgbW9kZTogXCJjb2xvci1kZXNjXCIsIHRpdGxlOiBcIkNvbG9yICh2aW9sZXQgXHUyMTkyIHJlZClcIiB9LFxuXTtcblxuLy8gUmV3cml0ZXMgdGhlIFRZUCBvZiBldmVyeSBub3RlIHdpdGgga2V5IG9sZEtleSAoc2VlIHR5cEtleU9mIGluXG4vLyB0eXAtaW5kZXguanMgLSB0aGUgVFlQIG5hbWUgZm9yIGEgY2xlYW4gdmFsdWUsIG90aGVyd2lzZSB0aGUgcmF3IGZvcm0gbGlrZVxuLy8gXCIgYnVjaFwiIG9yIFwiW1BFUlNPTiwgQlVDSF1cIikgdG8gdGhlIHNpbmdsZSB2YWx1ZSBuZXdWYWx1ZS4gVXNlZCBmb3Jcbi8vIHJlZ2lzdGVyVHlwKCkgKGNsZWFudXApLCByZW5hbWluZyBhbmQgbWVyZ2luZy4gTWF0Y2hpbmcgaXMgZXhhY3Qgb24gdGhlIGtleSxcbi8vIHNvIGEgbGlzdCBpcyByZXBsYWNlZCBhcyBhIHdob2xlLiBBIGRpZmZlcmVudGx5IHNwZWxsZWQgcHJvcGVydHkgKFwidHlwXCIpXG4vLyBiZWNvbWVzIFwiVFlQXCIuXG5hc3luYyBmdW5jdGlvbiByZW5hbWVUeXBJbk5vdGVzKHBsdWdpbiwgb2xkS2V5LCBuZXdWYWx1ZSkge1xuICBsZXQgY2hhbmdlZCA9IDA7XG4gIGZvciAoY29uc3QgZmlsZSBvZiBwbHVnaW4udHlwSW5kZXguZmlsZXNXaXRoVHlwKG9sZEtleSkpIHtcbiAgICBsZXQgbWF0Y2hlZCA9IGZhbHNlO1xuICAgIGF3YWl0IHBsdWdpbi5hcHAuZmlsZU1hbmFnZXIucHJvY2Vzc0Zyb250TWF0dGVyKGZpbGUsIChmcm9udG1hdHRlcikgPT4ge1xuICAgICAgaWYgKHR5cEtleU9mKHByb3BlcnR5VmFsdWUoZnJvbnRtYXR0ZXIsIFRZUF9QUk9QRVJUWSkpICE9PSBvbGRLZXkpIHJldHVybjtcbiAgICAgIHNldENhbm9uaWNhbFByb3BlcnR5KGZyb250bWF0dGVyLCBUWVBfUFJPUEVSVFksIG5ld1ZhbHVlKTtcbiAgICAgIG1hdGNoZWQgPSB0cnVlO1xuICAgIH0pO1xuICAgIGlmIChtYXRjaGVkKSBjaGFuZ2VkKys7XG4gIH1cbiAgcmV0dXJuIGNoYW5nZWQ7XG59XG5cbi8vIENsZWFuZWQgZm9ybSBvZiBhIHJhdyB2YWx1ZSBmb3IgcmVnaXN0ZXJUeXAoKTogYSBzaW5nbGUgdmFsdWUgdHJpbW1lZCBhbmRcbi8vIHVwcGVyY2FzZWQ7IGEgbGlzdCBpcyBkZWxpYmVyYXRlbHkgTk9UIHJlZHVjZWQgdG8gb25lIGl0ZW0gYnV0IGpvaW5lZCBpbnRvXG4vLyBvbmUgdmFsdWUgXCJBLCBCXCIgLSB3aGljaCBhIHJlbmFtZSBjYW4gdGhlbiB0dXJuIGludG8gYW5vdGhlciBUWVAgKHNlZVxuLy8gc3RhcnREZXRhaWxSZW5hbWUvc2hvd01lcmdlQ29uZmlybSkuIG5vcm1hbGl6ZSBzcGVsbHMgdGhlIHNpbmdsZSBuYW1lcyAtXG4vLyBub3JtYWxpemVTdWJ0eXBOYW1lIGZvciBTdWJ0eXBzLlxuZnVuY3Rpb24gbm9ybWFsaXplUmF3VHlwKHJhdywgbm9ybWFsaXplID0gbm9ybWFsaXplVHlwTmFtZSkge1xuICBpZiAoQXJyYXkuaXNBcnJheShyYXcpKSB7XG4gICAgcmV0dXJuIHJhd1xuICAgICAgLm1hcCgodikgPT4gbm9ybWFsaXplKFN0cmluZyh2ID8/IFwiXCIpKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAgIC5qb2luKFwiLCBcIik7XG4gIH1cbiAgcmV0dXJuIG5vcm1hbGl6ZShTdHJpbmcocmF3KSk7XG59XG5cbi8vIFNob3dzIGFuIHVucmVnaXN0ZXJlZCBrZXk6IHBhZGRpbmcgd291bGQgYmUgaW52aXNpYmxlIGFzIHBsYWluIHRleHQsIHNvIGl0XG4vLyBnZXRzIHF1b3Rlcy4gTGlzdHMgYWxyZWFkeSBjYXJyeSB0aGVpciBicmFja2V0cyBpbiB0aGUga2V5LlxuZnVuY3Rpb24gZGlzcGxheVR5cEtleSh0eXBLZXkpIHtcbiAgcmV0dXJuIHR5cEtleSAhPT0gdHlwS2V5LnRyaW0oKSA/IGBcIiR7dHlwS2V5fVwiYCA6IHR5cEtleTtcbn1cblxuY2xhc3MgVHlwUGFuZSBleHRlbmRzIEl0ZW1WaWV3IHtcbiAgY29uc3RydWN0b3IobGVhZiwgcGx1Z2luKSB7XG4gICAgc3VwZXIobGVhZik7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cblxuICBnZXRWaWV3VHlwZSgpIHtcbiAgICByZXR1cm4gVklFV19UWVBFX1RZUF9QQU5FO1xuICB9XG5cbiAgZ2V0RGlzcGxheVRleHQoKSB7XG4gICAgcmV0dXJuIFwiVFlQXCI7XG4gIH1cblxuICBnZXRJY29uKCkge1xuICAgIHJldHVybiBcInNoYXBlc1wiO1xuICB9XG5cbiAgYXN5bmMgb25PcGVuKCkge1xuICAgIHRoaXMuaXNFZGl0aW5nID0gZmFsc2U7XG4gICAgdGhpcy5zZWxlY3RlZFR5cCA9IG51bGw7XG4gICAgdGhpcy5mcm9udG1hdHRlckJsb2NrcyA9IG51bGw7XG4gICAgdGhpcy5mcm9udG1hdHRlckVkaXRvcnMgPSBbXTtcblxuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gICAgdGhpcy5jb250ZW50RWwuYWRkQ2xhc3MoXCJ0eXAtc3lzdGVtLXBhbmVcIik7XG5cbiAgICB0aGlzLnJlZ2lzdGVyRG9tRXZlbnQodGhpcy5jb250ZW50RWwsIFwia2V5ZG93blwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRXNjYXBlXCIgJiYgdGhpcy5zZWxlY3RlZFR5cCAhPT0gbnVsbCkgdGhpcy5jbG9zZVR5cFNldHRpbmdzKCk7XG4gICAgfSk7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfVxuXG4gIGFzeW5jIG9uQ2xvc2UoKSB7XG4gICAgdGhpcy5jbG9zZVN1YnR5cENvbG9yUG9wb3Zlcj8uKCk7XG4gIH1cblxuICBvcGVuU2VhcmNoKHR5cCkge1xuICAgIGNvbnN0IGdsb2JhbFNlYXJjaCA9IHRoaXMucGx1Z2luLmFwcC5pbnRlcm5hbFBsdWdpbnMuZ2V0UGx1Z2luQnlJZChcImdsb2JhbC1zZWFyY2hcIik7XG4gICAgaWYgKCFnbG9iYWxTZWFyY2gpIHJldHVybjtcbiAgICAvLyBcIk5vIFRZUFwiIHdpdGhvdXQgYSBmaWx0ZXIgd291bGQgYWxzbyBtYXRjaCBldmVyeSBub24tbWFya2Rvd24gZmlsZSxcbiAgICAvLyB3aGljaCBjYW4ndCBoYXZlIGZyb250bWF0dGVyIC0gaGVuY2UgZmlsZToubWQuXG4gICAgY29uc3QgcXVlcnkgPSB0eXAgPT09IG51bGwgPyBgLVtcIiR7VFlQX1BST1BFUlRZfVwiXSBmaWxlOi5tZGAgOiB0aGlzLnR5cENsYXVzZSh0eXApO1xuICAgIGdsb2JhbFNlYXJjaC5pbnN0YW5jZS5vcGVuR2xvYmFsU2VhcmNoKHF1ZXJ5KTtcbiAgfVxuXG4gIC8vIFNlYXJjaCBjbGF1c2UgZm9yIGEgVFlQIGtleS4gQSBsaXN0ICh1bnJlZ2lzdGVyZWQga2V5IFwiW0EsIEJdXCIpIGhhcyBub1xuICAvLyBleGFjdCBzeW50YXgsIHNvIGl0IHNlYXJjaGVzIG5vdGVzIGNhcnJ5aW5nIGFsbCBpdHMgaXRlbXMuIEFsc28gdXNlZCBieVxuICAvLyBvcGVuU3VidHlwU2VhcmNoKCksIHdoaWNoIGNhbiByZWNlaXZlIGFuIHVucmVnaXN0ZXJlZCAodW5jbGVhbikgVFlQIGtleS5cbiAgdHlwQ2xhdXNlKHR5cCkge1xuICAgIGNvbnN0IHJhdyA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnJhd1ZhbHVlT2YodHlwKTtcbiAgICByZXR1cm4gQXJyYXkuaXNBcnJheShyYXcpXG4gICAgICA/IHJhdy5tYXAoKHYpID0+IGBbXCIke1RZUF9QUk9QRVJUWX1cIjpcIiR7U3RyaW5nKHYgPz8gXCJcIikudHJpbSgpfVwiXWApLmpvaW4oXCIgXCIpXG4gICAgICA6IGBbXCIke1RZUF9QUk9QRVJUWX1cIjpcIiR7dHlwfVwiXWA7XG4gIH1cblxuICAvLyB0eXBLZXkgY29tZXMgc3RyYWlnaHQgZnJvbSBmcm9udG1hdHRlciB2YWx1ZXMgKHNlZSB1bnJlZ2lzdGVyZWRSb3dzIGluXG4gIC8vIHJlbmRlcigpIGFuZCB0eXBLZXlPZikgLSBwb3NzaWJseSBsb3dlcmNhc2UsIHBhZGRlZCBvciBhIGxpc3QuIFRZUCBlbnRyaWVzXG4gIC8vIGFyZSBhbHdheXMgY2xlYW4gdXBwZXJjYXNlIHZhbHVlcywgc28gdGhlIGNsZWFuZWQgZm9ybSBpcyByZWdpc3RlcmVkIChzZWVcbiAgLy8gbm9ybWFsaXplUmF3VHlwKSBhbmQgdGhlIGFmZmVjdGVkIG5vdGVzIGFyZSByZXdyaXR0ZW4gcmlnaHQgYXdheSwgc28gdGhleVxuICAvLyBubyBsb25nZXIgc2hvdyB1cCBhcyB1bnJlZ2lzdGVyZWQuXG4gIGFzeW5jIHJlZ2lzdGVyVHlwKHR5cEtleSkge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuYXBwbHlUeXBSZWdpc3RyYXRpb24odHlwS2V5KTtcbiAgICBpZiAoIXJlc3VsdCkgcmV0dXJuO1xuXG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcblxuICAgIGlmIChyZXN1bHQucmVuYW1lZCA+IDApIHtcbiAgICAgIG5ldyBOb3RpY2UoYFRZUCAke3Jlc3VsdC50eXB9IHJlZ2lzdGVyZWQsICR7cGx1cmFsKHJlc3VsdC5yZW5hbWVkLCBcIm5vdGVcIil9IHVwZGF0ZWQuYCk7XG4gICAgfVxuICB9XG5cbiAgLy8gVGhlIGNvcmUgb2YgcmVnaXN0ZXJUeXAoKSB3aXRob3V0IHNhdmluZywgcmUtcmVuZGVyaW5nIGFuZCBub3RpY2UsIHNvXG4gIC8vIHJlZ2lzdGVyVHlwV2l0aFN1YnR5cCgpIGNhbiByZWdpc3RlciBUWVAgYW5kIFN1YnR5cCBpbiB0dXJuIGFuZCB0aGVuIHNhdmVcbiAgLy8gYW5kIG5vdGlmeSBPTkNFLiBSZXR1cm5zIHsgdHlwLCByZW5hbWVkIH0sIG9yIG51bGwgaWYgbm90aGluZyB1c2FibGUgaXNcbiAgLy8gbGVmdC5cbiAgYXN5bmMgYXBwbHlUeXBSZWdpc3RyYXRpb24odHlwS2V5KSB7XG4gICAgY29uc3QgcmF3ID0gdGhpcy5wbHVnaW4udHlwSW5kZXgucmF3VmFsdWVPZih0eXBLZXkpO1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVSYXdUeXAocmF3ID09PSB1bmRlZmluZWQgPyB0eXBLZXkgOiByYXcpO1xuICAgIGlmICghbm9ybWFsaXplZCkgcmV0dXJuIG51bGw7XG4gICAgaWYgKCF0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBzLmluY2x1ZGVzKG5vcm1hbGl6ZWQpKSB7XG4gICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBzLnB1c2gobm9ybWFsaXplZCk7XG4gICAgfVxuICAgIGNvbnN0IHJlbmFtZWQgPSBub3JtYWxpemVkICE9PSB0eXBLZXkgPyBhd2FpdCByZW5hbWVUeXBJbk5vdGVzKHRoaXMucGx1Z2luLCB0eXBLZXksIG5vcm1hbGl6ZWQpIDogMDtcbiAgICByZXR1cm4geyB0eXA6IG5vcm1hbGl6ZWQsIHJlbmFtZWQgfTtcbiAgfVxuXG4gIC8vIEEgbmV3LCBlbXB0eSB0cmVlIGl0ZW0gc3RyYWlnaHQgaW4gZWRpdCBtb2RlIC0gbGlrZSBPYnNpZGlhbidzIG93biB2aWV3c1xuICAvLyAoYSBuZXcgYm9va21hcmsgZ3JvdXAsIHNheSkuXG4gIHN0YXJ0QWRkKCkge1xuICAgIGlmICh0aGlzLmlzRWRpdGluZykgcmV0dXJuO1xuXG4gICAgY29uc3QgdHJlZUl0ZW0gPSB0aGlzLmxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtXCIgfSk7XG4gICAgaWYgKHRoaXMuc2VwYXJhdG9yRWwpIHRoaXMubGlzdEVsLmluc2VydEJlZm9yZSh0cmVlSXRlbSwgdGhpcy5zZXBhcmF0b3JFbCk7XG4gICAgY29uc3Qgc2VsZiA9IHRyZWVJdGVtLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0tc2VsZiBpcy1jbGlja2FibGVcIiB9KTtcbiAgICBjb25zdCBpbm5lciA9IHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1pbm5lclwiIH0pO1xuXG4gICAgdGhpcy5zdGFydEVkaXRpbmcobnVsbCwgc2VsZiwgaW5uZXIpO1xuICB9XG5cbiAgLy8gTGlrZSBPYnNpZGlhbidzIHRyZWUgaXRlbXM6IG5vIGV4dHJhIGlucHV0LCB0aGUgdGV4dCBlbGVtZW50IGl0c2VsZlxuICAvLyBiZWNvbWVzIGNvbnRlbnRlZGl0YWJsZS4gdHlwID09PSBudWxsIG1lYW5zIGEgbmV3IGVudHJ5LCBvdGhlcndpc2UgYVxuICAvLyByZW5hbWUgb2YgdGhhdCBUWVAuXG4gIHN0YXJ0RWRpdGluZyh0eXAsIHNlbGYsIGlubmVyKSB7XG4gICAgaWYgKHRoaXMuaXNFZGl0aW5nKSByZXR1cm47XG4gICAgdGhpcy5pc0VkaXRpbmcgPSB0cnVlO1xuXG4gICAgc2VsZi5hZGRDbGFzcyhcImlzLWJlaW5nLXJlbmFtZWRcIik7XG4gICAgaW5uZXIuc2V0QXR0cmlidXRlKFwiY29udGVudGVkaXRhYmxlXCIsIFwidHJ1ZVwiKTtcbiAgICBpbm5lci5zZXRBdHRyaWJ1dGUoXCJzcGVsbGNoZWNrXCIsIFwiZmFsc2VcIik7XG4gICAgaW5uZXIuZm9jdXMoKTtcblxuICAgIGNvbnN0IHJhbmdlID0gaW5uZXIuZG9jLmNyZWF0ZVJhbmdlKCk7XG4gICAgcmFuZ2Uuc2VsZWN0Tm9kZUNvbnRlbnRzKGlubmVyKTtcbiAgICBjb25zdCBzZWxlY3Rpb24gPSBpbm5lci53aW4uZ2V0U2VsZWN0aW9uKCk7XG4gICAgc2VsZWN0aW9uLnJlbW92ZUFsbFJhbmdlcygpO1xuICAgIHNlbGVjdGlvbi5hZGRSYW5nZShyYW5nZSk7XG5cbiAgICBsZXQgZG9uZSA9IGZhbHNlO1xuICAgIGNvbnN0IGZpbmlzaCA9IGFzeW5jIChjb21taXQpID0+IHtcbiAgICAgIGlmIChkb25lKSByZXR1cm47XG4gICAgICBkb25lID0gdHJ1ZTtcbiAgICAgIHRoaXMuaXNFZGl0aW5nID0gZmFsc2U7XG5cbiAgICAgIGNvbnN0IHZhbHVlID0gbm9ybWFsaXplVHlwTmFtZShpbm5lci50ZXh0Q29udGVudCk7XG4gICAgICBpZiAoY29tbWl0ICYmIHZhbHVlICYmIHZhbHVlICE9PSB0eXApIHtcbiAgICAgICAgY29uc3QgZXhpc3RzID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwcy5zb21lKFxuICAgICAgICAgICh0KSA9PiB0LnRvTG93ZXJDYXNlKCkgPT09IHZhbHVlLnRvTG93ZXJDYXNlKCkgJiYgdCAhPT0gdHlwXG4gICAgICAgICk7XG4gICAgICAgIGlmICghZXhpc3RzKSB7XG4gICAgICAgICAgaWYgKHR5cCA9PT0gbnVsbCkge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwcy5wdXNoKHZhbHVlKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc3QgaWR4ID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwcy5pbmRleE9mKHR5cCk7XG4gICAgICAgICAgICBpZiAoaWR4ICE9PSAtMSkgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwc1tpZHhdID0gdmFsdWU7XG4gICAgICAgICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF07XG4gICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdHlwXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBEZXNjcmlwdGlvbnNbdHlwXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlc2NyaXB0aW9uc1t2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBEZXNjcmlwdGlvbnNbdHlwXTtcbiAgICAgICAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlc2NyaXB0aW9uc1t0eXBdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlZmF1bHRGcm9udG1hdHRlclt0eXBdICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRGVmYXVsdEZyb250bWF0dGVyW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlZmF1bHRGcm9udG1hdHRlclt0eXBdO1xuICAgICAgICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRGVmYXVsdEZyb250bWF0dGVyW3R5cF07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRmxvYXRpbmdLZXlzW3R5cF0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBGbG9hdGluZ0tleXNbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRmxvYXRpbmdLZXlzW3R5cF07XG4gICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBGbG9hdGluZ0tleXNbdHlwXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBTaG9ydGN1dHNbdHlwXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cFNob3J0Y3V0c1t2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBTaG9ydGN1dHNbdHlwXTtcbiAgICAgICAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cFNob3J0Y3V0c1t0eXBdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHRoaXMuZW5zdXJlVHlwTWFudWFsKClbdHlwXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cE1hbnVhbFt2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBNYW51YWxbdHlwXTtcbiAgICAgICAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cE1hbnVhbFt0eXBdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgbW92ZVR5cFN1YnR5cHModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgdmFsdWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICB9O1xuXG4gICAgaW5uZXIuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVudGVyXCIpIHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgZmluaXNoKHRydWUpO1xuICAgICAgfSBlbHNlIGlmIChldmVudC5rZXkgPT09IFwiRXNjYXBlXCIpIHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgZmluaXNoKGZhbHNlKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGlubmVyLmFkZEV2ZW50TGlzdGVuZXIoXCJibHVyXCIsICgpID0+IGZpbmlzaCh0cnVlKSk7XG4gIH1cblxuICBvcGVuVHlwU2V0dGluZ3ModHlwKSB7XG4gICAgdGhpcy5zZWxlY3RlZFR5cCA9IHR5cDtcbiAgICB0aGlzLnJlbmRlcigpO1xuICB9XG5cbiAgY2xvc2VUeXBTZXR0aW5ncygpIHtcbiAgICB0aGlzLnNlbGVjdGVkVHlwID0gbnVsbDtcbiAgICB0aGlzLnJlbmRlcigpO1xuICB9XG5cbiAgLy8gVGhlIGVkaXRvcnMgYXJlIGNvbXBvbmVudCBjaGlsZHJlbiAoc2VlIG1vdW50RnJvbnRtYXR0ZXJFZGl0b3IpIGFuZCBtdXN0XG4gIC8vIGJlIHVubG9hZGVkIGJlZm9yZSBldmVyeSByZWJ1aWxkIC0gY29udGVudEVsLmVtcHR5KCkgYWxvbmUgd291bGQgcmVtb3ZlIHRoZVxuICAvLyBET00gYnV0IGxlYXZlIGVhY2ggZWRpdG9yJ3MgbWV0YWRhdGFUeXBlTWFuYWdlciBsaXN0ZW5lciBiZWhpbmQuXG4gIC8vIGZyb250bWF0dGVyQmxvY2tzIGNvbnRyb2xzIGFsbCBibG9ja3MgKHVzZWQgYnkgXCJBZGQgVFlQLUZyb250bWF0dGVyXG4gIC8vIHByb3BlcnR5XCIpLCBmcm9udG1hdHRlckVkaXRvcnMgaG9sZHMgZXZlcnkgZWRpdG9yIGluY2wuIFN1YnR5cCBibG9ja3MuXG4gIGRlc3Ryb3lGcm9udG1hdHRlckVkaXRvcigpIHtcbiAgICBmb3IgKGNvbnN0IGVkaXRvciBvZiB0aGlzLmZyb250bWF0dGVyRWRpdG9ycyA/PyBbXSkgdGhpcy5yZW1vdmVDaGlsZChlZGl0b3IpO1xuICAgIHRoaXMuZnJvbnRtYXR0ZXJFZGl0b3JzID0gW107XG4gICAgdGhpcy5mcm9udG1hdHRlckJsb2NrcyA9IG51bGw7XG4gIH1cblxuICByZW5kZXIoKSB7XG4gICAgLy8gUmVlbnRyYW5jeSBndWFyZDogcmVuZGVyVHlwU2V0dGluZ3MoKSBlbmRzIHdpdGggcmVmcmVzaFR5cENvbG9ycygpLFxuICAgIC8vIHdoaWNoIHZpYSByZWdpc3RlclR5cFBhbmUgY2FsbHMgcmVuZGVyKCkgb24gZXZlcnkgVFlQLVBhbmUgbGVhZiAtXG4gICAgLy8gaW5jbHVkaW5nIHRoaXMgb25lLCBzdGlsbCBpbnNpZGUgdGhpcyBjYWxsLiBXaXRob3V0IHRoZSBndWFyZCB0aGF0XG4gICAgLy8gcmVjdXJzZXMgaW50byBhIHN0YWNrIG92ZXJmbG93IG9uIGV2ZXJ5IFRZUCBvcGVuZWQgb3IgcmVuYW1lZC5cbiAgICBpZiAodGhpcy5fcmVuZGVyaW5nKSByZXR1cm47XG4gICAgdGhpcy5fcmVuZGVyaW5nID0gdHJ1ZTtcbiAgICB0cnkge1xuICAgICAgdGhpcy5kZXN0cm95RnJvbnRtYXR0ZXJFZGl0b3IoKTtcbiAgICAgIGlmICh0aGlzLnNlbGVjdGVkVHlwICE9PSBudWxsKSB7XG4gICAgICAgIHRoaXMucmVuZGVyVHlwU2V0dGluZ3ModGhpcy5zZWxlY3RlZFR5cCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgICBjb250ZW50RWwuZW1wdHkoKTtcblxuICAgICAgY29uc3QgeyBjb3VudHMsIG5vVHlwIH0gPSB0aGlzLnBsdWdpbi50eXBJbmRleC50eXBDb3VudHMoKTtcbiAgICAgIGNvbnN0IHJlZ2lzdGVyZWQgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBzO1xuICAgICAgY29uc3QgdHlwQ29sb3JzID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzO1xuICAgICAgY29uc3Qgc29ydE9yZGVyID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwU29ydE9yZGVyID8/IERFRkFVTFRfU09SVF9PUkRFUjtcbiAgICAgIGNvbnN0IGlzTWFudWFsU29ydCA9IHNvcnRPcmRlciA9PT0gXCJtYW51YWxcIjtcbiAgICAgIGNvbnN0IGJ5Q3VycmVudE9yZGVyID0gKGEsIGIpID0+IGNvbXBhcmVUeXBzKHNvcnRPcmRlciwgYSwgYiwgY291bnRzLCB0eXBDb2xvcnMpO1xuXG4gICAgICB0aGlzLnJlbmRlckxpc3RIZWFkZXIoY29udGVudEVsKTtcblxuICAgICAgY29uc3QgdW5yZWdpc3RlcmVkUm93cyA9IFsuLi5jb3VudHMua2V5cygpXVxuICAgICAgICAuZmlsdGVyKCh0eXApID0+ICFyZWdpc3RlcmVkLmluY2x1ZGVzKHR5cCkpXG4gICAgICAgIC5zb3J0KGJ5Q3VycmVudE9yZGVyKVxuICAgICAgICAubWFwKCh0eXApID0+ICh7IHR5cCwgY291bnQ6IGNvdW50cy5nZXQodHlwKSA/PyAwIH0pKTtcbiAgICAgIGNvbnN0IHVucmVnaXN0ZXJlZFN1YnR5cFJvd3MgPSB0aGlzLnVucmVnaXN0ZXJlZFN1YnR5cFJvd3MoKTtcblxuICAgICAgLy8gV2l0aG91dCBhIHNlY29uZCBjb2x1bW4gdGhlIG5hbWUgbWF5IHRha2UgdGhlIHdob2xlIHJvdyAoc2VlXG4gICAgICAvLyAudHlwLWxpc3Qtbm8tc2Vjb25kYXJ5IGluIHN0eWxlcy5jc3MpLlxuICAgICAgY29uc3QgbGlzdENscyA9IFwidHlwLWxpc3QgbmF2LWZpbGVzLWNvbnRhaW5lclwiICsgKHRoaXMuc2Vjb25kYXJ5TW9kZSgpID09PSBcIm5vbmVcIiA/IFwiIHR5cC1saXN0LW5vLXNlY29uZGFyeVwiIDogXCJcIik7XG4gICAgICB0aGlzLmxpc3RFbCA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IGxpc3RDbHMgfSk7XG4gICAgICB0aGlzLnNlcGFyYXRvckVsID0gbnVsbDtcblxuICAgICAgLy8gSW4gbWFudWFsIG1vZGUgc29ydFR5cHNCeU1vZGUoKSBrZWVwcyB0aGUgb3JkZXIgb2Ygc2V0dGluZ3MudHlwcyxcbiAgICAgIC8vIHdoaWNoIGRyYWcgJiBkcm9wIGluIHJlbmRlclJlZ2lzdGVyZWRJdGVtKCkgcmVhcnJhbmdlczsgaW5kZXggaXMgdGhlXG4gICAgICAvLyBwb3NpdGlvbiBpbiB0aGF0IG9yZGVyLlxuICAgICAgY29uc3QgcmVnaXN0ZXJlZE9yZGVyID0gc29ydFR5cHNCeU1vZGUocmVnaXN0ZXJlZCwgc29ydE9yZGVyLCBjb3VudHMsIHR5cENvbG9ycyk7XG4gICAgICByZWdpc3RlcmVkT3JkZXIuZm9yRWFjaCgodHlwLCBpbmRleCkgPT4ge1xuICAgICAgICB0aGlzLnJlbmRlclJlZ2lzdGVyZWRJdGVtKHR5cCwgY291bnRzLmdldCh0eXApID8/IDAsIHsgZHJhZ2dhYmxlOiBpc01hbnVhbFNvcnQsIGluZGV4IH0pO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIEJlbG93IHRoZSBzZXBhcmF0b3IgdGhyZWUgb3B0aW9uYWwgc2VjdGlvbnM6IHVucmVnaXN0ZXJlZCBUWVAgdmFsdWVzLFxuICAgICAgLy8gdW5yZWdpc3RlcmVkIFN1YnR5cHMsIFwiW05PIFRZUF1cIi4gVGhlIFN1YnR5cHMgZ2V0IHRoZWlyIG93biBzZXBhcmF0b3JcbiAgICAgIC8vIGJlY2F1c2UgdGhleSBzb3J0IGJ5IGEgZGlmZmVyZW50IHJ1bGUgKGNvdW50LCBub3QgdGhlIHNvcnQgYnV0dG9uKSAtXG4gICAgICAvLyB3aXRob3V0IGEgdmlzaWJsZSBjdXQgaXQgd291bGQgbG9vayBsaWtlIGJyb2tlbiBzb3J0aW5nLiBcIltOTyBUWVBdXCIgaXNcbiAgICAgIC8vIG5vIHJlYWwgVFlQLCB0YWtlcyBubyBwYXJ0IGluIHNvcnRpbmcgYW5kIGFsd2F5cyBjb21lcyBsYXN0LCB3aXRob3V0IGFcbiAgICAgIC8vIHRoaXJkIGxpbmUuXG4gICAgICAvL1xuICAgICAgLy8gdGhpcy5zZXBhcmF0b3JFbCBzdGF5cyB0aGUgRklSU1QgbGluZTogc3RhcnRBZGQoKSBpbnNlcnRzIHRoZSBuZXcgaXRlbVxuICAgICAgLy8gYmVmb3JlIGl0LCBhbmQgYSBuZXcgVFlQIGJlbG9uZ3MgYWZ0ZXIgdGhlIHJlZ2lzdGVyZWQgb25lcy5cbiAgICAgIGNvbnN0IHNlcGFyYXRvciA9ICgpID0+IHtcbiAgICAgICAgY29uc3QgZWwgPSB0aGlzLmxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLXNlcGFyYXRvclwiIH0pO1xuICAgICAgICB0aGlzLnNlcGFyYXRvckVsID0gdGhpcy5zZXBhcmF0b3JFbCA/PyBlbDtcbiAgICAgIH07XG5cbiAgICAgIGlmICh1bnJlZ2lzdGVyZWRSb3dzLmxlbmd0aCA+IDAgfHwgdW5yZWdpc3RlcmVkU3VidHlwUm93cy5sZW5ndGggPiAwIHx8IG5vVHlwID4gMCkgc2VwYXJhdG9yKCk7XG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiB1bnJlZ2lzdGVyZWRSb3dzKSB0aGlzLnJlbmRlclVucmVnaXN0ZXJlZEl0ZW0ocm93LnR5cCwgcm93LmNvdW50KTtcblxuICAgICAgaWYgKHVucmVnaXN0ZXJlZFN1YnR5cFJvd3MubGVuZ3RoID4gMCkge1xuICAgICAgICBpZiAodW5yZWdpc3RlcmVkUm93cy5sZW5ndGggPiAwKSBzZXBhcmF0b3IoKTtcbiAgICAgICAgZm9yIChjb25zdCByb3cgb2YgdW5yZWdpc3RlcmVkU3VidHlwUm93cykgdGhpcy5yZW5kZXJVbnJlZ2lzdGVyZWRTdWJ0eXBJdGVtKHJvdyk7XG4gICAgICB9XG5cbiAgICAgIGlmIChub1R5cCA+IDApIHRoaXMucmVuZGVyTm9UeXBJdGVtKG5vVHlwKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5fcmVuZGVyaW5nID0gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgLy8gTGlrZSB0aGUgXCJDaGFuZ2Ugc29ydCBvcmRlclwiIGJ1dHRvbiBpbiBPYnNpZGlhbidzIHRhZ3MgYW5kIGFsbC1wcm9wZXJ0aWVzXG4gIC8vIHZpZXdzLlxuICByZW5kZXJMaXN0SGVhZGVyKGNvbnRlbnRFbCkge1xuICAgIGNvbnN0IGhlYWRlciA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibmF2LWhlYWRlclwiIH0pO1xuICAgIGNvbnN0IGJ1dHRvbnNDb250YWluZXIgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcIm5hdi1idXR0b25zLWNvbnRhaW5lclwiIH0pO1xuXG4gICAgY29uc3QgYWRkQnRuID0gYnV0dG9uc0NvbnRhaW5lci5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIG5hdi1hY3Rpb24tYnV0dG9uXCIsXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkFkZCBUWVBcIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24oYWRkQnRuLCBcInBsdXNcIik7XG4gICAgYWRkQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnN0YXJ0QWRkKCkpO1xuXG4gICAgY29uc3Qgc29ydEJ0biA9IGJ1dHRvbnNDb250YWluZXIuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiBuYXYtYWN0aW9uLWJ1dHRvblwiLFxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJDaGFuZ2Ugc29ydCBvcmRlclwiIH0sXG4gICAgfSk7XG4gICAgc2V0SWNvbihzb3J0QnRuLCBcImx1Y2lkZS1zb3J0LWFzY1wiKTtcbiAgICBzb3J0QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IHRoaXMuc2hvd1NvcnRNZW51KGV2ZW50KSk7XG5cbiAgICAvLyBTZWNvbmQgY29sdW1uOiBhIGJ1dHRvbiBjeWNsaW5nIHRoZSB0aHJlZSBtb2RlcyByYXRoZXIgdGhhbiBhIG1lbnUgLVxuICAgIC8vIHdpdGggc28gZmV3IHN0YXRlcyB3aG9zZSBlZmZlY3Qgc2hvd3MgcmlnaHQgYmVsb3csIGNsaWNraW5nIHRocm91Z2ggaXNcbiAgICAvLyBmYXN0ZXIuIEljb24gYW5kIHRvb2x0aXAgc2hvdyB0aGUgY3VycmVudCBtb2RlLlxuICAgIGNvbnN0IGN1cnJlbnQgPSBTRUNPTkRBUllfTU9ERVNbdGhpcy5zZWNvbmRhcnlJbmRleCgpXTtcbiAgICBjb25zdCBzZWNvbmRhcnlCdG4gPSBidXR0b25zQ29udGFpbmVyLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gbmF2LWFjdGlvbi1idXR0b25cIixcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IGBOZXh0IHRvIG5hbWU6ICR7Y3VycmVudC50aXRsZX1gIH0sXG4gICAgfSk7XG4gICAgc2V0SWNvbihzZWNvbmRhcnlCdG4sIGN1cnJlbnQuaWNvbik7XG4gICAgc2Vjb25kYXJ5QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmN5Y2xlU2Vjb25kYXJ5KCkpO1xuICB9XG5cbiAgLy8gc2V0dGluZ3MudHlwTGlzdFNlY29uZGFyeSwgYnV0IGFsd2F5cyBhIHZhbGlkIG1vZGUgLSBvbGRlciBkYXRhIG1heSBsYWNrXG4gIC8vIHRoZSBrZXksIGFuZCBhIG1vZGUgcmVtb3ZlZCBsYXRlciBzaG91bGRuJ3QgbGVhdmUgdGhlIGxpc3QgZW1wdHkuXG4gIHNlY29uZGFyeU1vZGUoKSB7XG4gICAgY29uc3QgbW9kZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cExpc3RTZWNvbmRhcnk7XG4gICAgcmV0dXJuIFNFQ09OREFSWV9NT0RFUy5zb21lKChlbnRyeSkgPT4gZW50cnkubW9kZSA9PT0gbW9kZSkgPyBtb2RlIDogREVGQVVMVF9TRUNPTkRBUlk7XG4gIH1cblxuICBzZWNvbmRhcnlJbmRleCgpIHtcbiAgICByZXR1cm4gU0VDT05EQVJZX01PREVTLmZpbmRJbmRleCgoZW50cnkpID0+IGVudHJ5Lm1vZGUgPT09IHRoaXMuc2Vjb25kYXJ5TW9kZSgpKTtcbiAgfVxuXG4gIGFzeW5jIGN5Y2xlU2Vjb25kYXJ5KCkge1xuICAgIGNvbnN0IG5leHQgPSBTRUNPTkRBUllfTU9ERVNbKHRoaXMuc2Vjb25kYXJ5SW5kZXgoKSArIDEpICUgU0VDT05EQVJZX01PREVTLmxlbmd0aF07XG4gICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwTGlzdFNlY29uZGFyeSA9IG5leHQubW9kZTtcbiAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAvLyBPbmx5IHRoaXMgbGlzdCBjaGFuZ2VzLCBzbyBubyByZWZyZXNoVHlwQ29sb3JzKCkgYWNyb3NzIGFsbCB2aWV3cy5cbiAgICB0aGlzLnJlbmRlcigpO1xuICB9XG5cbiAgc2hvd1NvcnRNZW51KGV2ZW50KSB7XG4gICAgY29uc3QgY3VycmVudCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cFNvcnRPcmRlciA/PyBERUZBVUxUX1NPUlRfT1JERVI7XG4gICAgY29uc3QgbWVudSA9IG5ldyBNZW51KCk7XG5cbiAgICBjb25zdCBhZGRHcm91cCA9IChzdGFydCwgZW5kKSA9PiB7XG4gICAgICBmb3IgKGxldCBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgICAgICBjb25zdCB7IG1vZGUsIHRpdGxlIH0gPSBTT1JUX09QVElPTlNbaV07XG4gICAgICAgIG1lbnUuYWRkSXRlbSgoaXRlbSkgPT5cbiAgICAgICAgICBpdGVtXG4gICAgICAgICAgICAuc2V0VGl0bGUodGl0bGUpXG4gICAgICAgICAgICAuc2V0Q2hlY2tlZChjdXJyZW50ID09PSBtb2RlKVxuICAgICAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBTb3J0T3JkZXIgPSBtb2RlO1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfTtcblxuICAgIGFkZEdyb3VwKDAsIDEpO1xuICAgIG1lbnUuYWRkU2VwYXJhdG9yKCk7XG4gICAgYWRkR3JvdXAoMSwgMyk7XG4gICAgbWVudS5hZGRTZXBhcmF0b3IoKTtcbiAgICBhZGRHcm91cCgzLCA1KTtcbiAgICBtZW51LmFkZFNlcGFyYXRvcigpO1xuICAgIGFkZEdyb3VwKDUsIDcpO1xuXG4gICAgbWVudS5zaG93QXRNb3VzZUV2ZW50KGV2ZW50KTtcbiAgfVxuXG4gIHJlbmRlck5vVHlwSXRlbShjb3VudCkge1xuICAgIGNvbnN0IHRyZWVJdGVtID0gdGhpcy5saXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbVwiIH0pO1xuICAgIGNvbnN0IHNlbGYgPSB0cmVlSXRlbS5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLXNlbGYgaXMtY2xpY2thYmxlIHR5cC11bnJlZ2lzdGVyZWRcIiB9KTtcbiAgICBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0taW5uZXJcIiwgdGV4dDogXCJbTk8gVFlQXVwiIH0pO1xuICAgIHRoaXMucmVuZGVyQ291bnRGbGFpcihzZWxmLCBjb3VudCk7XG5cbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLm9wZW5TZWFyY2gobnVsbCkpO1xuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNvbnRleHRtZW51XCIsIChldmVudCkgPT4ge1xuICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgdGhpcy5vcGVuU2VhcmNoKG51bGwpO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gQ2hyb21pdW0ncyBpbnB1dFt0eXBlPWNvbG9yXSBoYXMgYSBtaW5pbXVtIHN3YXRjaCB0aGF0IHdvbid0IHNjYWxlIGJlbG93XG4gIC8vIHRleHQgc2l6ZSwgc28gaXQgaXMgb25seSBhbiBpbnZpc2libGUgdHJpZ2dlciBvdmVyIGEgZnJlZWx5IHNjYWxhYmxlIGRvdC5cbiAgLy8gV2l0aG91dCBhIGNvbG9yIHRoZSBkb3QgaXMgYSBob2xsb3cgZ3JheSByaW5nIChzZWUgcGFpbnRDb2xvckRvdCk7IHdpdGhcbiAgLy8gc2hvd1Jlc2V0IChkZXRhaWwgdmlldykgYSB0b29sdGlwIG5hbWVzIHRoZSBzdGF0ZSBhbmQgdGhlIHJlc2V0IGJ1dHRvbiBpc1xuICAvLyBncmF5ZWQgb3V0LlxuICByZW5kZXJDb2xvclBpY2tlcihwYXJlbnQsIHR5cCwgb25DaGFuZ2UsIHsgc2hvd1Jlc2V0ID0gZmFsc2UgfSA9IHt9KSB7XG4gICAgY29uc3QgY3VycmVudENvbG9yID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPz8gREVGQVVMVF9UWVBfQ09MT1I7XG4gICAgY29uc3QgY29sb3JXcmFwID0gcGFyZW50LmNyZWF0ZURpdih7IGNsczogXCJ0eXAtY29sb3Itd3JhcFwiIH0pO1xuICAgIGNvbnN0IGNvbG9yRG90ID0gY29sb3JXcmFwLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtY29sb3ItZG90XCIgfSk7XG4gICAgbGV0IHJlc2V0QnRuID0gbnVsbDtcbiAgICBjb25zdCBzaG93U3RhdGUgPSAoY29sb3IsIGlzRGVmYXVsdCkgPT4ge1xuICAgICAgcGFpbnRDb2xvckRvdChjb2xvckRvdCwgY29sb3IsIGlzRGVmYXVsdCk7XG4gICAgICBpZiAoIXNob3dSZXNldCkgcmV0dXJuO1xuICAgICAgY29sb3JXcmFwLnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgaXNEZWZhdWx0ID8gXCJEZWZhdWx0IChubyBjb2xvcilcIiA6IFwiQ2hhbmdlIGNvbG9yXCIpO1xuICAgICAgcmVzZXRCdG4/LnRvZ2dsZUNsYXNzKFwiaXMtZGlzYWJsZWRcIiwgaXNEZWZhdWx0KTtcbiAgICB9O1xuXG4gICAgY29uc3QgY29sb3JJbnB1dCA9IGNvbG9yV3JhcC5jcmVhdGVFbChcImlucHV0XCIsIHsgdHlwZTogXCJjb2xvclwiLCBjbHM6IFwidHlwLWNvbG9yLWlucHV0XCIgfSk7XG4gICAgY29sb3JJbnB1dC52YWx1ZSA9IGN1cnJlbnRDb2xvcjtcbiAgICBjb2xvcklucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpKTtcblxuICAgIC8vIFwiaW5wdXRcIiBmaXJlcyBmb3IgZXZlcnkgaW50ZXJtZWRpYXRlIGNvbG9yIHdoaWxlIHRoZSBuYXRpdmUgcGlja2VyIGlzXG4gICAgLy8gb3BlbiAtIG9ubHkgYSBsb2NhbCBwcmV2aWV3IGhlcmUuIHJlZnJlc2hUeXBDb2xvcnMoKSB3b3VsZCByZS1yZW5kZXJcbiAgICAvLyB0aGlzIHZpZXcsIHJlbW92ZSB0aGlzIDxpbnB1dCB0eXBlPWNvbG9yPiBhbmQgY2xvc2UgdGhlIG5hdGl2ZSBwaWNrZXJcbiAgICAvLyBiZWZvcmUgYSBjb2xvciBjb3VsZCBldmVuIGJlIGNob3Nlbi5cbiAgICAvL1xuICAgIC8vIE9uZSB1bmRvIHNuYXBzaG90IHBlciBwaWNrZXIgc2Vzc2lvbjogdGFrZW4gYmVmb3JlIHRoZSBmaXJzdFxuICAgIC8vIGludGVybWVkaWF0ZSBjb2xvciwgb2ZmZXJlZCBvbmNlIHRoZSBjaG9pY2UgaXMgY29uZmlybWVkIChcImNoYW5nZVwiKS5cbiAgICBsZXQgdW5kb1NuYXBzaG90ID0gbnVsbDtcbiAgICBjb2xvcklucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJpbnB1dFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICB1bmRvU25hcHNob3QgPz89IHNuYXBzaG90U2V0dGluZ3ModGhpcy5wbHVnaW4pO1xuICAgICAgc2hvd1N0YXRlKGNvbG9ySW5wdXQudmFsdWUsIGZhbHNlKTtcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdID0gY29sb3JJbnB1dC52YWx1ZTtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgb25DaGFuZ2U/Lihjb2xvcklucHV0LnZhbHVlKTtcbiAgICB9KTtcblxuICAgIC8vIE9uY2UgdGhlIGNob2ljZSBpcyBjb25maXJtZWQgYW5kIHRoZSBwaWNrZXIgY2xvc2VkLCBhIHJlLXJlbmRlciBjYW4ndFxuICAgIC8vIGJyZWFrIGFueXRoaW5nIGFueSBtb3JlLlxuICAgIGNvbG9ySW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICBjb25zdCBzbmFwc2hvdCA9IHVuZG9TbmFwc2hvdDtcbiAgICAgIHVuZG9TbmFwc2hvdCA9IG51bGw7XG4gICAgICBpZiAoc25hcHNob3QgJiYgc25hcHNob3QudHlwQ29sb3JzW3R5cF0gIT09IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdKSB7XG4gICAgICAgIG9mZmVyVW5kbyh0aGlzLnBsdWdpbiwgYENvbG9yIG9mICR7dHlwfSBjaGFuZ2VkLmAsIHNuYXBzaG90KTtcbiAgICAgIH1cbiAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgIH0pO1xuXG4gICAgaWYgKHNob3dSZXNldCkge1xuICAgICAgcmVzZXRCdG4gPSBwYXJlbnQuY3JlYXRlRGl2KHtcbiAgICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1jb2xvci1yZXNldFwiLFxuICAgICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlJlc2V0IGNvbG9yXCIgfSxcbiAgICAgIH0pO1xuICAgICAgc2V0SWNvbihyZXNldEJ0biwgXCJyb3RhdGUtY2N3XCIpO1xuICAgICAgcmVzZXRCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgLy8gTm8gdW5kbyBvZmZlciBmb3IgYSBuby1vcCAodGhlIGJ1dHRvbiBpcyBvbmx5IGdyYXllZCBvdXQpLlxuICAgICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPT09IHVuZGVmaW5lZCkgcmV0dXJuO1xuICAgICAgICBjb25zdCBzbmFwc2hvdCA9IHNuYXBzaG90U2V0dGluZ3ModGhpcy5wbHVnaW4pO1xuICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF07XG4gICAgICAgIGNvbG9ySW5wdXQudmFsdWUgPSBERUZBVUxUX1RZUF9DT0xPUjtcbiAgICAgICAgc2hvd1N0YXRlKERFRkFVTFRfVFlQX0NPTE9SLCB0cnVlKTtcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIG9mZmVyVW5kbyh0aGlzLnBsdWdpbiwgYENvbG9yIG9mICR7dHlwfSByZXNldC5gLCBzbmFwc2hvdCk7XG4gICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICBvbkNoYW5nZT8uKERFRkFVTFRfVFlQX0NPTE9SKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICBzaG93U3RhdGUoY3VycmVudENvbG9yLCB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdHlwXSA9PT0gdW5kZWZpbmVkKTtcblxuICAgIHJldHVybiBjb2xvcldyYXA7XG4gIH1cblxuICAvLyBHdWFyZHMgc2V0dGluZ3Mgb2JqZWN0cyBsb2FkZWQgYmVmb3JlIHR5cE1hbnVhbCBleGlzdGVkIChhIHJ1bm5pbmdcbiAgLy8gc2Vzc2lvbiBhY3Jvc3MgYSBob3QgcmVsb2FkLCBzYXkpIC0gb3RoZXJ3aXNlIGV2ZXJ5IGFjY2VzcyBiZWxvdyB3b3VsZFxuICAvLyB0aHJvdyBhbmQgdGFrZSB0aGUgcmVzdCBvZiByZW5kZXJUeXBTZXR0aW5ncygpIGRvd24gd2l0aCBpdC5cbiAgZW5zdXJlVHlwTWFudWFsKCkge1xuICAgIGlmICghdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwTWFudWFsKSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBNYW51YWwgPSB7fTtcbiAgICByZXR1cm4gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwTWFudWFsO1xuICB9XG5cbiAgLy8gVGhlIHNoYXJlZCBcIk1hbnVhbGx5IGNyZWF0YWJsZVwiIGJ1dHRvbiBvZiBUWVAgKHJlbmRlck1hbnVhbFRvZ2dsZSkgYW5kXG4gIC8vIFN1YnR5cCAocmVuZGVyU3VidHlwTWFudWFsVG9nZ2xlKSwgZWFjaCBiZXR3ZWVuIHJlbmFtZSBhbmQgZGVsZXRlLiBBblxuICAvLyBpY29uIGJ1dHRvbiByYXRoZXIgdGhhbiBhIGxhYmVsZWQgdG9nZ2xlIC0gdG9vIHNtYWxsIGEgc2V0dGluZyBmb3IgaXRzIG93blxuICAvLyByb3cuIFN0YXRlIHZpYSBhIGNsYXNzIChpcy1hY3RpdmUsIHNlZSBzdHlsZXMuY3NzKSwgbWVhbmluZyBpbiB0aGUgdG9vbHRpcDtcbiAgLy8gcm9sZS9hcmlhLWNoZWNrZWQga2VlcCBpdCByZWFkYWJsZSBhcyBhIHN3aXRjaC5cbiAgLy9cbiAgLy8gb25Ub2dnbGUgZ2V0cyB0aGUgbmV3IHN0YXRlLCBzYXZlcyBpdCBhbmQgdXBkYXRlcyB0aGUgZGVwZW5kZW50IGJ1dHRvbnNcbiAgLy8gKHNlZSBzeW5jTWFudWFsVG9nZ2xlcykgLSB0aGUgY2xpY2sgZG9lc24ndCBwYWludCBpdHNlbGYsIHNpbmNlIGEgdG9nZ2xlXG4gIC8vIGhlcmUgbmV2ZXIgYWZmZWN0cyBqdXN0IHRoaXMgb25lIGJ1dHRvbi5cbiAgcmVuZGVyTWFudWFsSWNvbihwYXJlbnQsIGNscywgaXNPbiwgb25Ub2dnbGUpIHtcbiAgICBjb25zdCBidG4gPSBwYXJlbnQuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogYGNsaWNrYWJsZS1pY29uIHR5cC1tYW51YWwtaWNvbiAke2Nsc31gLFxuICAgICAgYXR0cjogeyB0YWJpbmRleDogXCIwXCIsIHJvbGU6IFwiY2hlY2tib3hcIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24oYnRuLCBcImZpbGUtcGVuLWxpbmVcIik7XG5cbiAgICBidG4udHlwU2hvd01hbnVhbFN0YXRlID0gKG9uKSA9PiB7XG4gICAgICBidG4udG9nZ2xlQ2xhc3MoXCJpcy1hY3RpdmVcIiwgb24pO1xuICAgICAgYnRuLnNldEF0dHJpYnV0ZShcImFyaWEtY2hlY2tlZFwiLCBTdHJpbmcob24pKTtcbiAgICAgIGJ0bi5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIG9uID8gXCJNYW51YWxseSBjcmVhdGFibGVcIiA6IFwiTm90IG1hbnVhbGx5IGNyZWF0YWJsZVwiKTtcbiAgICB9O1xuICAgIGJ0bi50eXBTaG93TWFudWFsU3RhdGUoaXNPbik7XG5cbiAgICBjb25zdCB0b2dnbGUgPSAoKSA9PiBvblRvZ2dsZSghYnRuLmhhc0NsYXNzKFwiaXMtYWN0aXZlXCIpKTtcbiAgICBidG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIHRvZ2dsZSk7XG4gICAgYnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIChldmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmtleSA9PT0gXCJFbnRlclwiIHx8IGV2ZW50LmtleSA9PT0gXCIgXCIpIHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgdG9nZ2xlKCk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gYnRuO1xuICB9XG5cbiAgLy8gVGhlIFRZUCdzIFwiTWFudWFsbHkgY3JlYXRhYmxlXCIsIGluIHRoZSBkZXRhaWwgaGVhZGVyIGJldHdlZW4gcmVuYW1lIGFuZFxuICAvLyBkZWxldGUuIE9uIGJ5IGRlZmF1bHQsIHNvIG9ubHkgXCJvZmZcIiAoZmFsc2UpIGlzIHN0b3JlZC4gRGVjaWRlcyB3aGV0aGVyXG4gIC8vIGdldFR5cHMoKSAobWFpbi5qcykgcmV0dXJucyB0aGUgVFlQLlxuICAvL1xuICAvLyBUaGUgVFlQIGFsd2F5cyB0YWtlcyBpdHMgU3VidHlwcyBhbG9uZzogdGhlIHBpY2tlciBvbmx5IHJlYWNoZXMgdGhlbVxuICAvLyB0aHJvdWdoIGl0LCBzbyBhIFRZUCBzd2l0Y2hlZCBvZmYgd291bGQgc2lsZW50bHkgbWFrZSB0aGVtIHVucmVhY2hhYmxlXG4gIC8vIChzZWUgc2V0QWxsU3VidHlwc01hbnVhbCBpbiBzdWJ0eXBzLmpzKS5cbiAgcmVuZGVyTWFudWFsVG9nZ2xlKHBhcmVudCwgdHlwKSB7XG4gICAgcmV0dXJuIHRoaXMucmVuZGVyTWFudWFsSWNvbihwYXJlbnQsIFwidHlwLW1hbnVhbC10eXBcIiwgdGhpcy5lbnN1cmVUeXBNYW51YWwoKVt0eXBdICE9PSBmYWxzZSwgYXN5bmMgKG9uKSA9PiB7XG4gICAgICBpZiAob24pIGRlbGV0ZSB0aGlzLmVuc3VyZVR5cE1hbnVhbCgpW3R5cF07XG4gICAgICBlbHNlIHRoaXMuZW5zdXJlVHlwTWFudWFsKClbdHlwXSA9IGZhbHNlO1xuICAgICAgc2V0QWxsU3VidHlwc01hbnVhbCh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBvbik7XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgIHRoaXMuc3luY01hbnVhbFRvZ2dsZXModHlwKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIEEgU3VidHlwJ3MgXCJNYW51YWxseSBjcmVhdGFibGVcIiwgaW4gaXRzIGJsb2NrIGZvb3RlciBiZXR3ZWVuIHJlbmFtZSBhbmRcbiAgLy8gZGVsZXRlIChzZWUgcmVuZGVyU2VjdGlvbkZvb3RlcikuIFVubGlrZSB0aGUgVFlQIGJ1dHRvbiBpdCBwdWxscyBvbmx5IG9uZVxuICAvLyB3YXk6IHN3aXRjaGluZyBhIFN1YnR5cCBvbiBhbHNvIHN3aXRjaGVzIGl0cyBUWVAgb24gKGVsc2UgaXQgd291bGQgYmVcbiAgLy8gdW5yZWFjaGFibGUpLCB0aGUgb3RoZXIgU3VidHlwcyBzdGF5IGFzIHRoZXkgYXJlIC0gdGhhdCBpcyB0aGUgcG9pbnQuXG4gIHJlbmRlclN1YnR5cE1hbnVhbFRvZ2dsZShwYXJlbnQsIHR5cCwgc3VidHlwKSB7XG4gICAgY29uc3QgYnRuID0gdGhpcy5yZW5kZXJNYW51YWxJY29uKFxuICAgICAgcGFyZW50LFxuICAgICAgXCJ0eXAtbWFudWFsLXN1YnR5cFwiLFxuICAgICAgaXNTdWJ0eXBNYW51YWwodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKSxcbiAgICAgIGFzeW5jIChvbikgPT4ge1xuICAgICAgICBzZXRTdWJ0eXBNYW51YWwodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwLCBvbik7XG4gICAgICAgIGlmIChvbikgZGVsZXRlIHRoaXMuZW5zdXJlVHlwTWFudWFsKClbdHlwXTtcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIHRoaXMuc3luY01hbnVhbFRvZ2dsZXModHlwKTtcbiAgICAgIH1cbiAgICApO1xuICAgIGJ0bi50eXBTdWJ0eXAgPSBzdWJ0eXA7XG4gICAgcmV0dXJuIGJ0bjtcbiAgfVxuXG4gIC8vIFJlcGFpbnRzIGV2ZXJ5IG1hbnVhbCBidXR0b24gb2YgdGhlIGRldGFpbCB2aWV3IGFmdGVyIG9uZSBjaGFuZ2VkIHRoZVxuICAvLyBvdGhlcnMuIE9ubHkgdGhlIGJ1dHRvbnMsIG5vdCByZW5kZXIoKTogYSByZWJ1aWxkIHdvdWxkIHJlY3JlYXRlIGV2ZXJ5XG4gIC8vIGJsb2NrJ3MgZWRpdG9ycywgaW5jbHVkaW5nIGEgcm93IGJlaW5nIGVkaXRlZC4gRm91bmQgdmlhIHRoZSBET00gbGlrZSB0aGVcbiAgLy8gU3VidHlwIGNvbG9yIGRvdHMgLSBmcm9udG1hdHRlci1ibG9ja3MuanMgYnVpbGRzIHRoZSBmb290ZXJzLCBubyBsaXN0IG9mXG4gIC8vIHRoZW0gbGl2ZXMgaGVyZS5cbiAgc3luY01hbnVhbFRvZ2dsZXModHlwKSB7XG4gICAgdGhpcy5jb250ZW50RWwucXVlcnlTZWxlY3RvcihcIi50eXAtbWFudWFsLXR5cFwiKT8udHlwU2hvd01hbnVhbFN0YXRlKHRoaXMuZW5zdXJlVHlwTWFudWFsKClbdHlwXSAhPT0gZmFsc2UpO1xuICAgIGZvciAoY29uc3QgZWwgb2YgdGhpcy5jb250ZW50RWwucXVlcnlTZWxlY3RvckFsbChcIi50eXAtbWFudWFsLXN1YnR5cFwiKSkge1xuICAgICAgZWwudHlwU2hvd01hbnVhbFN0YXRlKGlzU3VidHlwTWFudWFsKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIGVsLnR5cFN1YnR5cCkpO1xuICAgIH1cbiAgfVxuXG4gIHJlbmRlclJlZ2lzdGVyZWRJdGVtKHR5cCwgY291bnQsIHsgZHJhZ2dhYmxlID0gZmFsc2UsIGluZGV4ID0gLTEgfSA9IHt9KSB7XG4gICAgY29uc3QgdHJlZUl0ZW0gPSB0aGlzLmxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtXCIgfSk7XG4gICAgY29uc3Qgc2VsZiA9IHRyZWVJdGVtLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0tc2VsZiBpcy1jbGlja2FibGVcIiB9KTtcblxuICAgIGxldCBuYW1lRWw7XG4gICAgdGhpcy5yZW5kZXJDb2xvclBpY2tlcihzZWxmLCB0eXAsIChuZXdDb2xvcikgPT4ge1xuICAgICAgaWYgKG5hbWVFbCAmJiB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3QpIG5hbWVFbC5zdHlsZS5jb2xvciA9IG5ld0NvbG9yO1xuICAgIH0pO1xuXG4gICAgbmFtZUVsID0gc2VsZi5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLWlubmVyXCIsIHRleHQ6IHR5cCB9KTtcbiAgICBjb25zdCBjb2xvciA9IHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdCA/IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdIDogbnVsbDtcbiAgICBpZiAoY29sb3IpIG5hbWVFbC5zdHlsZS5jb2xvciA9IGNvbG9yO1xuXG4gICAgLy8gU2Vjb25kIGNvbHVtbiwgY3ljbGVkIGJ5IHRoZSBoZWFkZXIgYnV0dG9uIChzZWUgU0VDT05EQVJZX01PREVTKS5cbiAgICBjb25zdCBzZWNvbmRhcnkgPSB0aGlzLnNlY29uZGFyeU1vZGUoKTtcbiAgICBpZiAoc2Vjb25kYXJ5ID09PSBcImRlc2NyaXB0aW9uXCIpIHRoaXMucmVuZGVyRGVzY3JpcHRpb25JbnB1dChzZWxmLCB0eXApO1xuICAgIGVsc2UgaWYgKHNlY29uZGFyeSA9PT0gXCJzdWJ0eXBzXCIpIHRoaXMucmVuZGVyU3VidHlwUHJldmlldyhzZWxmLCB0eXApO1xuXG4gICAgdGhpcy5yZW5kZXJDb3VudEZsYWlyKHNlbGYsIGNvdW50KTtcblxuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIGlmICh0aGlzLmlzRWRpdGluZykgcmV0dXJuO1xuICAgICAgdGhpcy5vcGVuVHlwU2V0dGluZ3ModHlwKTtcbiAgICB9KTtcbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHRoaXMub3BlblNlYXJjaCh0eXApO1xuICAgIH0pO1xuXG4gICAgLy8gT25seSBpbiBtYW51YWwgc29ydCBtb2RlIChzZWUgcmVuZGVyKCkpOiB0aGUgd2hvbGUgcm93IGNhbiBiZSBkcmFnZ2VkXG4gICAgLy8gKGEgZHJhZyBzdGFydGluZyBvbiB0aGUgZG90IG9yIGluIHRoZSBkZXNjcmlwdGlvbiBmaWVsZCBkb2Vzbid0IGNvdW50IC1cbiAgICAvLyB0aG9zZSB0YWtlIHRoZSBtb3VzZWRvd24gdGhlbXNlbHZlcykuIE1vdmVzIGVudHJpZXMgaW4gc2V0dGluZ3MudHlwcyxcbiAgICAvLyB0aGUgbGlzdCB0aGF0IGlzIHRoZSBkaXNwbGF5IG9yZGVyIGluIG1hbnVhbCBtb2RlLlxuICAgIGlmIChkcmFnZ2FibGUpIHtcbiAgICAgIHNlbGYuZHJhZ2dhYmxlID0gdHJ1ZTtcbiAgICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdzdGFydFwiLCAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQuZGF0YVRyYW5zZmVyLmVmZmVjdEFsbG93ZWQgPSBcIm1vdmVcIjtcbiAgICAgICAgZXZlbnQuZGF0YVRyYW5zZmVyLnNldERhdGEoXCJ0ZXh0L3BsYWluXCIsIFN0cmluZyhpbmRleCkpO1xuICAgICAgICBzZWxmLmNsYXNzTGlzdC5hZGQoXCJpcy1kcmFnZ2luZ1wiKTtcbiAgICAgIH0pO1xuICAgICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ2VuZFwiLCAoKSA9PiBzZWxmLmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcmFnZ2luZ1wiKSk7XG4gICAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnb3ZlclwiLCAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgY29uc3QgcmVjdCA9IHNlbGYuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICAgIGNvbnN0IGlzQWZ0ZXIgPSBldmVudC5jbGllbnRZIC0gcmVjdC50b3AgPiByZWN0LmhlaWdodCAvIDI7XG4gICAgICAgIHNlbGYuY2xhc3NMaXN0LnRvZ2dsZShcImlzLWRyb3AtYmVmb3JlXCIsICFpc0FmdGVyKTtcbiAgICAgICAgc2VsZi5jbGFzc0xpc3QudG9nZ2xlKFwiaXMtZHJvcC1hZnRlclwiLCBpc0FmdGVyKTtcbiAgICAgIH0pO1xuICAgICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ2xlYXZlXCIsICgpID0+IHNlbGYuY2xhc3NMaXN0LnJlbW92ZShcImlzLWRyb3AtYmVmb3JlXCIsIFwiaXMtZHJvcC1hZnRlclwiKSk7XG4gICAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJkcm9wXCIsIGFzeW5jIChldmVudCkgPT4ge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBjb25zdCBpc0FmdGVyID0gc2VsZi5jbGFzc0xpc3QuY29udGFpbnMoXCJpcy1kcm9wLWFmdGVyXCIpO1xuICAgICAgICBzZWxmLmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcm9wLWJlZm9yZVwiLCBcImlzLWRyb3AtYWZ0ZXJcIik7XG5cbiAgICAgICAgY29uc3QgZnJvbUluZGV4ID0gTnVtYmVyKGV2ZW50LmRhdGFUcmFuc2Zlci5nZXREYXRhKFwidGV4dC9wbGFpblwiKSk7XG4gICAgICAgIGlmIChOdW1iZXIuaXNOYU4oZnJvbUluZGV4KSB8fCBmcm9tSW5kZXggPT09IGluZGV4KSByZXR1cm47XG5cbiAgICAgICAgbGV0IGluc2VydEJlZm9yZSA9IGlzQWZ0ZXIgPyBpbmRleCArIDEgOiBpbmRleDtcbiAgICAgICAgaWYgKGZyb21JbmRleCA8IGluc2VydEJlZm9yZSkgaW5zZXJ0QmVmb3JlIC09IDE7XG5cbiAgICAgICAgY29uc3QgdHlwcyA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cHM7XG4gICAgICAgIGNvbnN0IFttb3ZlZF0gPSB0eXBzLnNwbGljZShmcm9tSW5kZXgsIDEpO1xuICAgICAgICB0eXBzLnNwbGljZShpbnNlcnRCZWZvcmUsIDAsIG1vdmVkKTtcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICAvLyBBIHJlYWwgaW5wdXQsIHNvIHRoZSBkZXNjcmlwdGlvbiBjYW4gYmUgZWRpdGVkIHJpZ2h0IGluIHRoZSBsaXN0LiBJdHNcbiAgLy8gY2xpY2sgbXVzdCBOT1QgdHJpZ2dlciB0aGUgcm93ICh3aGljaCB3b3VsZCBvcGVuIHRoZSBkZXRhaWwgdmlldykuXG4gIHJlbmRlckRlc2NyaXB0aW9uSW5wdXQoc2VsZiwgdHlwKSB7XG4gICAgY29uc3QgZGVzY0lucHV0ID0gc2VsZi5jcmVhdGVFbChcImlucHV0XCIsIHtcbiAgICAgIHR5cGU6IFwidGV4dFwiLFxuICAgICAgY2xzOiBcInR5cC1saXN0LWRlc2NyaXB0aW9uLWlucHV0XCIsXG4gICAgfSk7XG4gICAgZGVzY0lucHV0LnZhbHVlID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRGVzY3JpcHRpb25zW3R5cF0gPz8gXCJcIjtcbiAgICBkZXNjSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChldmVudCkgPT4gZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCkpO1xuICAgIGRlc2NJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gZGVzY0lucHV0LnZhbHVlLnRyaW0oKTtcbiAgICAgIGlmICh2YWx1ZSkgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRGVzY3JpcHRpb25zW3R5cF0gPSB2YWx1ZTtcbiAgICAgIGVsc2UgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlc2NyaXB0aW9uc1t0eXBdO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBcIihTdWJ0eXAgMSwgU3VidHlwIDIpXCIgaW5zdGVhZCBvZiB0aGUgZGVzY3JpcHRpb24gLSB0aGUgc2FtZSBsb29rIGFzIHRoZVxuICAvLyBwcmV2aWV3IGluIHRoZSBzZXBhcmF0ZSBUWVAtUGlja2VyIChzaGFyZWQgbmFtZUNvbG9yIGluIHR5cC1jb2xvcnMuanMpOlxuICAvLyBicmFja2V0cyBhbmQgY29tbWFzIG11dGVkLCBlYWNoIG5hbWUgaW4gaXRzIFN1YnR5cCBjb2xvci4gT25seSByZWdpc3RlcmVkXG4gIC8vIFN1YnR5cHMgYW5kIG5vIGNvdW50cyAtIHVucmVnaXN0ZXJlZCB2YWx1ZXMgaGF2ZSBubyBjb2xvciwgYW5kIGNvdW50c1xuICAvLyB3b3VsZCBtYWtlIHRoZSByb3cgdW5yZWFkYWJsZS4gRGlzcGxheSBvbmx5OyBjbGljayBhbmQgcmlnaHQtY2xpY2sgYmVsb25nXG4gIC8vIHRvIHRoZSByb3cuIExlZnQgb3IgcmlnaHQgYWxpZ25tZW50IGlzIGEgU3R5bGUgU2V0dGluZ3MgYm9keSBjbGFzcyAoc2VlXG4gIC8vIEBzZXR0aW5ncyBhbmQgLnR5cC1saXN0LXN1YnR5cHMgaW4gc3R5bGVzLmNzcyk7IHRoZSBtYXJrdXAgaXMgdGhlIHNhbWUuXG4gIHJlbmRlclN1YnR5cFByZXZpZXcoc2VsZiwgdHlwKSB7XG4gICAgY29uc3Qgc3VidHlwcyA9IGdldFN1YnR5cE5hbWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXApO1xuICAgIGlmIChzdWJ0eXBzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gICAgY29uc3QgY29sb3JpemUgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3Q7XG4gICAgY29uc3Qgd3JhcCA9IHNlbGYuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtbGlzdC1zdWJ0eXBzXCIgfSk7XG4gICAgd3JhcC5hcHBlbmRUZXh0KFwiKFwiKTtcbiAgICBzdWJ0eXBzLmZvckVhY2goKHN1YnR5cCwgaW5kZXgpID0+IHtcbiAgICAgIGlmIChpbmRleCA+IDApIHdyYXAuYXBwZW5kVGV4dChcIiwgXCIpO1xuICAgICAgY29uc3Qgc3BhbiA9IHdyYXAuY3JlYXRlU3Bhbih7IHRleHQ6IHN1YnR5cCB9KTtcbiAgICAgIGlmIChjb2xvcml6ZSkgc3Bhbi5zdHlsZS5jb2xvciA9IG5hbWVDb2xvcih0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApLmNvbG9yO1xuICAgIH0pO1xuICAgIHdyYXAuYXBwZW5kVGV4dChcIilcIik7XG4gIH1cblxuICByZW5kZXJVbnJlZ2lzdGVyZWRJdGVtKHR5cCwgY291bnQpIHtcbiAgICBjb25zdCB0cmVlSXRlbSA9IHRoaXMubGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW1cIiB9KTtcbiAgICBjb25zdCBzZWxmID0gdHJlZUl0ZW0uY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1zZWxmIGlzLWNsaWNrYWJsZSB0eXAtdW5yZWdpc3RlcmVkXCIgfSk7XG4gICAgc2VsZi5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLWlubmVyXCIsIHRleHQ6IGRpc3BsYXlUeXBLZXkodHlwKSB9KTtcbiAgICB0aGlzLnJlbmRlckNvdW50RmxhaXIoc2VsZiwgY291bnQpO1xuXG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5yZWdpc3RlclR5cCh0eXApKTtcbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHRoaXMub3BlblNlYXJjaCh0eXApO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gRXZlcnkgU1VCVFlQIHZhbHVlIHRoYXQgb2NjdXJzIGluIG5vdGVzIGJ1dCBpc24ndCByZWdpc3RlcmVkIHVuZGVyIGl0cyBUWVBcbiAgLy8gLSBhY3Jvc3MgdGhlIHZhdWx0LCB1bmxpa2UgcmVuZGVyVW5yZWdpc3RlcmVkU3VidHlwcygpIGluIHRoZSBkZXRhaWwgdmlldy5cbiAgLy8gVGhlIGluZGV4IGtlZXBzIGJ1Y2tldHMgZm9yIEFMTCBUWVAga2V5cywgdW5yZWdpc3RlcmVkIG9uZXMgaW5jbHVkZWQsIHNvXG4gIC8vIHRoZWlyIFN1YnR5cHMgY29tZSBhbG9uZyAoYSBjbGljayB0aGVuIHJlZ2lzdGVycyBib3RoLCBzZWVcbiAgLy8gcmVnaXN0ZXJUeXBXaXRoU3VidHlwKS5cbiAgLy9cbiAgLy8gU29ydGVkIGJ5IGNvdW50LCB0aGVuIGJ5IHJvdyB0ZXh0IChUWVAsIHRoZW4gU3VidHlwKSAtIGxpa2UgdGhlIGRldGFpbFxuICAvLyB2aWV3LiBEZWxpYmVyYXRlbHkgTk9UIGJ5IHRoZSBsaXN0J3Mgc29ydCBidXR0b246IFwiY29sb3JcIiBhbmQgXCJtYW51YWxcIlxuICAvLyBtZWFuIG5vdGhpbmcgZm9yIHVucmVnaXN0ZXJlZCB2YWx1ZXMuXG4gIC8vXG4gIC8vIEEgbm90ZSB3aXRob3V0IGEgVFlQIGlzIGxlZnQgb3V0OiB0aGUgaW5kZXggZHJvcHMgaXRzIFNVQlRZUCBhbHJlYWR5IChzZWVcbiAgLy8gYWdncmVnYXRlKCkgaW4gdHlwLWluZGV4LmpzKSwgYSBTVUJUWVAgd2l0aG91dCBhIFRZUCBoYXMgbm8gY29udGV4dC5cbiAgdW5yZWdpc3RlcmVkU3VidHlwUm93cygpIHtcbiAgICBjb25zdCByZWdpc3RlcmVkID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwcztcbiAgICBjb25zdCByb3dzID0gW107XG4gICAgZm9yIChjb25zdCBbdHlwLCBidWNrZXRdIG9mIHRoaXMucGx1Z2luLnR5cEluZGV4LnN1YnR5cENvdW50cygpKSB7XG4gICAgICBjb25zdCBrbm93biA9IGdldFN1YnR5cE5hbWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXApO1xuICAgICAgZm9yIChjb25zdCBbc3VidHlwLCBjb3VudF0gb2YgYnVja2V0LmNvdW50cykge1xuICAgICAgICBpZiAoa25vd24uaW5jbHVkZXMoc3VidHlwKSkgY29udGludWU7XG4gICAgICAgIHJvd3MucHVzaCh7IHR5cCwgc3VidHlwLCBjb3VudCwgdHlwUmVnaXN0ZXJlZDogcmVnaXN0ZXJlZC5pbmNsdWRlcyh0eXApIH0pO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcm93cy5zb3J0KChhLCBiKSA9PiBiLmNvdW50IC0gYS5jb3VudCB8fCBhLnR5cC5sb2NhbGVDb21wYXJlKGIudHlwKSB8fCBhLnN1YnR5cC5sb2NhbGVDb21wYXJlKGIuc3VidHlwKSk7XG4gIH1cblxuICAvLyBcIk5PVElaIC8gS3VyeiBHZXNjaGljaHRlXCIgLSB0aGUgU3VidHlwIGFsb25lIHdvdWxkIGJlIGFtYmlndW91cywgdGhlIHNhbWVcbiAgLy8gbmFtZSBjYW4gZXhpc3QgdW5kZXIgc2V2ZXJhbCBUWVAgZW50cmllcy4gSWYgdGhlIFRZUCBpcyByZWdpc3RlcmVkLCBpdHNcbiAgLy8gcGFydCBjYXJyaWVzIGl0cyBjb2xvciAob3IgYSBkb3QsIGRlcGVuZGluZyBvbiBcIlRZUC1QYW5lXCIgY29sb3JpbmcpLFxuICAvLyB0b25lZCBkb3duIGJ5IHRoZSBTdHlsZSBTZXR0aW5nIFwiQ29sb3IgaW4gdW5yZWdpc3RlcmVkIFN1YnR5cCByb3dzXCIgc29cbiAgLy8gdGhlc2Ugcm93cyBzdGF5IGJlaGluZCB0aGUgcmVnaXN0ZXJlZCBlbnRyaWVzIGFib3ZlLiBJZiB0aGUgVFlQIGlzbid0XG4gIC8vIHJlZ2lzdGVyZWQgZWl0aGVyLCB0aGUgd2hvbGUgcm93IGlzIG11dGVkIGxpa2UgdGhlIGVudHJpZXMgYWJvdmUgaXQuXG4gIHJlbmRlclVucmVnaXN0ZXJlZFN1YnR5cEl0ZW0oeyB0eXAsIHN1YnR5cCwgY291bnQsIHR5cFJlZ2lzdGVyZWQgfSkge1xuICAgIGNvbnN0IHRyZWVJdGVtID0gdGhpcy5saXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbVwiIH0pO1xuICAgIGNvbnN0IHNlbGYgPSB0cmVlSXRlbS5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLXNlbGYgaXMtY2xpY2thYmxlIHR5cC11bnJlZ2lzdGVyZWRcIiB9KTtcblxuICAgIGNvbnN0IGNvbG9yaXplID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0O1xuICAgIGNvbnN0IHsgY29sb3IsIGlzRGVmYXVsdCB9ID0gbmFtZUNvbG9yKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXApO1xuICAgIGlmICh0eXBSZWdpc3RlcmVkICYmICFjb2xvcml6ZSkge1xuICAgICAgY29uc3Qgd3JhcCA9IHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1jb2xvci13cmFwIHR5cC11bnJlZ2lzdGVyZWQtc3VidHlwLWNvbG9yXCIgfSk7XG4gICAgICBwYWludENvbG9yRG90KHdyYXAuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1jb2xvci1kb3RcIiB9KSwgY29sb3IsIGlzRGVmYXVsdCk7XG4gICAgfVxuXG4gICAgY29uc3QgaW5uZXIgPSBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0taW5uZXJcIiB9KTtcbiAgICBjb25zdCB0eXBFbCA9IGlubmVyLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXVucmVnaXN0ZXJlZC1zdWJ0eXAtdHlwXCIsIHRleHQ6IGRpc3BsYXlUeXBLZXkodHlwKSB9KTtcbiAgICBpZiAodHlwUmVnaXN0ZXJlZCAmJiBjb2xvcml6ZSAmJiAhaXNEZWZhdWx0KSB7XG4gICAgICB0eXBFbC5zdHlsZS5jb2xvciA9IGNvbG9yO1xuICAgICAgdHlwRWwuYWRkQ2xhc3MoXCJ0eXAtdW5yZWdpc3RlcmVkLXN1YnR5cC1jb2xvclwiKTtcbiAgICB9XG4gICAgaW5uZXIuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtdW5yZWdpc3RlcmVkLXN1YnR5cC1zbGFzaFwiLCB0ZXh0OiBcIiAvIFwiIH0pO1xuICAgIGlubmVyLmNyZWF0ZVNwYW4oeyB0ZXh0OiBkaXNwbGF5VHlwS2V5KHN1YnR5cCkgfSk7XG5cbiAgICB0aGlzLnJlbmRlckNvdW50RmxhaXIoc2VsZiwgY291bnQpO1xuXG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5yZWdpc3RlclR5cFdpdGhTdWJ0eXAodHlwLCBzdWJ0eXApKTtcbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHRoaXMub3BlblN1YnR5cFNlYXJjaCh0eXAsIHN1YnR5cCk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBDbGlja2luZyBzdWNoIGEgcm93IHJlZ2lzdGVycyB0aGUgU3VidHlwIGFuZCwgaWYgbmVlZGVkLCBpdHMgVFlQLiBUWVBcbiAgLy8gZmlyc3QsIHRoZW4gU3VidHlwIC0gbmVjZXNzYXJpbHk6IHJlZ2lzdGVyaW5nIGEgVFlQIGNhbiBjbGVhbiBpdHMgdmFsdWUgaW5cbiAgLy8gdGhlIG5vdGVzIChcIiBidWNoXCIgLT4gXCJCVUNIXCIpLCBhbmQgdGhlIFN1YnR5cCBwYXNzIG11c3QgdGhlbiB1c2UgdGhlIE5FV1xuICAvLyBUWVAgbmFtZSBvciByZW5hbWVTdWJ0eXBJbk5vdGVzKCkgZmluZHMgbm8gZmlsZS5cbiAgLy9cbiAgLy8gTm8gY29uZmlybWF0aW9uOiBpdCBvbmx5IHJlZ2lzdGVycy4gTm90ZXMgY2hhbmdlIG9ubHkgd2hlbiBhIHJhdyB2YWx1ZSB3YXNcbiAgLy8gdW5jbGVhbiBhbmQgZ2V0cyBjbGVhbmVkIC0gYSBjbGVhbiB2YWx1ZSB0b3VjaGVzIG5vIGZpbGUuXG4gIGFzeW5jIHJlZ2lzdGVyVHlwV2l0aFN1YnR5cCh0eXBLZXksIHN1YnR5cEtleSkge1xuICAgIGNvbnN0IGJ1Y2tldCA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnN1YnR5cEJ1Y2tldCh0eXBLZXkpO1xuICAgIGNvbnN0IHR5cFJlc3VsdCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cHMuaW5jbHVkZXModHlwS2V5KVxuICAgICAgPyB7IHR5cDogdHlwS2V5LCByZW5hbWVkOiAwIH1cbiAgICAgIDogYXdhaXQgdGhpcy5hcHBseVR5cFJlZ2lzdHJhdGlvbih0eXBLZXkpO1xuICAgIGlmICghdHlwUmVzdWx0KSByZXR1cm47XG5cbiAgICBjb25zdCBzdWJ0eXBSZXN1bHQgPSBhd2FpdCB0aGlzLmFwcGx5U3VidHlwUmVnaXN0cmF0aW9uKHR5cFJlc3VsdC50eXAsIHN1YnR5cEtleSwgYnVja2V0KTtcbiAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICB0aGlzLnJlbmRlcigpO1xuICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuXG4gICAgaWYgKCFzdWJ0eXBSZXN1bHQpIHJldHVybjtcbiAgICBjb25zdCBwYXJ0cyA9IFtdO1xuICAgIGlmICh0eXBSZXN1bHQudHlwICE9PSB0eXBLZXkpIHBhcnRzLnB1c2goYFRZUCAke3R5cFJlc3VsdC50eXB9YCk7XG4gICAgcGFydHMucHVzaChgU3VidHlwICR7c3VidHlwUmVzdWx0LnN1YnR5cH1gKTtcbiAgICBjb25zdCBjaGFuZ2VkID0gdHlwUmVzdWx0LnJlbmFtZWQgKyBzdWJ0eXBSZXN1bHQucmVuYW1lZDtcbiAgICBuZXcgTm90aWNlKGAke2pvaW5BbmQocGFydHMpfSByZWdpc3RlcmVkJHtjaGFuZ2VkID4gMCA/IGAsICR7cGx1cmFsKGNoYW5nZWQsIFwibm90ZVwiKX0gdXBkYXRlZGAgOiBcIlwifS5gKTtcbiAgfVxuXG4gIHJlbmRlclR5cFNldHRpbmdzKHR5cCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuXG4gICAgY29uc3QgaGVhZGVyID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZGV0YWlsLWhlYWRlclwiIH0pO1xuICAgIGNvbnN0IGJhY2tCdG4gPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1iYWNrXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiQmFja1wiIH0gfSk7XG4gICAgc2V0SWNvbihiYWNrQnRuLCBcImFycm93LWxlZnRcIik7XG4gICAgYmFja0J0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5jbG9zZVR5cFNldHRpbmdzKCkpO1xuXG4gICAgY29uc3QgdGl0bGVFbCA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWRldGFpbC10aXRsZVwiLCB0ZXh0OiB0eXAgfSk7XG4gICAgY29uc3QgdGl0bGVDb2xvciA9IHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdCA/IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdIDogbnVsbDtcbiAgICAvLyBBIGN1c3RvbSBwcm9wZXJ0eSBpbnN0ZWFkIG9mIGNvbG9yOiBhbiBpbmxpbmUgY29sb3IgYmVhdHMgZXZlcnlcbiAgICAvLyBzdHlsZXNoZWV0IHJ1bGUsIGFuZCB0aGUgYWNjZW50IGNvbG9yIG9uIGhvdmVyICgudHlwLXNlYXJjaGFibGUpIHdvdWxkXG4gICAgLy8gbmVlZCAhaW1wb3J0YW50LlxuICAgIGlmICh0aXRsZUNvbG9yKSB0aXRsZUVsLnN0eWxlLnNldFByb3BlcnR5KFwiLS10eXAtbmFtZS1jb2xvclwiLCB0aXRsZUNvbG9yKTtcbiAgICB0aGlzLm1ha2VTZWFyY2hhYmxlKHRpdGxlRWwsICgpID0+IHRoaXMub3BlblNlYXJjaCh0eXApKTtcblxuICAgIGNvbnN0IHsgY291bnRzIH0gPSB0aGlzLnBsdWdpbi50eXBJbmRleC50eXBDb3VudHMoKTtcbiAgICBoZWFkZXIuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtZGV0YWlsLWNvdW50XCIsIHRleHQ6IFN0cmluZyhjb3VudHMuZ2V0KHR5cCkgPz8gMCkgfSk7XG5cbiAgICAvLyBMZWZ0IG9mIHRoZSBwbGFpbiByZW5hbWUgYnV0dG9uLCBoaWdobGlnaHRlZCBpbiBhY2NlbnQgY29sb3I6IHRoaXMgb25lXG4gICAgLy8gYWxzbyByZXdyaXRlcyB0aGUgVFlQIG9mIGV2ZXJ5IGFmZmVjdGVkIG5vdGUgKGFmdGVyIGNvbmZpcm1hdGlvbiwgc2VlXG4gICAgLy8gc3RhcnREZXRhaWxSZW5hbWUpLlxuICAgIGNvbnN0IHJlbmFtZVdpdGhOb3Rlc0J0biA9IGhlYWRlci5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1kZXRhaWwtcmVuYW1lLW5vdGVzXCIsXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlJlbmFtZSBhbmQgdXBkYXRlIG5vdGVzXCIgfSxcbiAgICB9KTtcbiAgICBzZXRJY29uKHJlbmFtZVdpdGhOb3Rlc0J0biwgXCJwZW5jaWxcIik7XG4gICAgcmVuYW1lV2l0aE5vdGVzQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnN0YXJ0RGV0YWlsUmVuYW1lKHR5cCwgdGl0bGVFbCwgeyB1cGRhdGVOb3RlczogdHJ1ZSB9KSk7XG5cbiAgICBjb25zdCByZW5hbWVCdG4gPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1kZXRhaWwtcmVuYW1lXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiUmVuYW1lXCIgfSB9KTtcbiAgICBzZXRJY29uKHJlbmFtZUJ0biwgXCJwZW5jaWxcIik7XG4gICAgcmVuYW1lQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnN0YXJ0RGV0YWlsUmVuYW1lKHR5cCwgdGl0bGVFbCkpO1xuXG4gICAgLy8gQmV0d2VlbiByZW5hbWUgYW5kIGRlbGV0ZSwgaW4gdGhlIHNhbWUgc3BvdCBhcyBmb3IgYSBTdWJ0eXAgKHNlZVxuICAgIC8vIHJlbmRlclNlY3Rpb25Gb290ZXIpLlxuICAgIHRoaXMucmVuZGVyTWFudWFsVG9nZ2xlKGhlYWRlciwgdHlwKTtcblxuICAgIGNvbnN0IGRlbGV0ZUJ0biA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWRldGFpbC1kZWxldGVcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJEZWxldGVcIiB9IH0pO1xuICAgIHNldEljb24oZGVsZXRlQnRuLCBcInRyYXNoXCIpO1xuICAgIGRlbGV0ZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5zaG93RGVsZXRlQ29uZmlybSh0eXApKTtcblxuICAgIGNvbnN0IGJvZHkgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1kZXRhaWwtYm9keVwiIH0pO1xuXG4gICAgLy8gT25lIHJvdyBiZWxvdyB0aGUgaGVhZGVyOiB0aGUgVFlQIGNvbG9yIG9uIHRoZSBsZWZ0LCB0aGUgZGVzY3JpcHRpb25cbiAgICAvLyBmaWxsaW5nIHRoZSByZXN0LlxuICAgIGNvbnN0IG9wdGlvbnNIZWFkZXIgPSBib2R5LmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZnJvbnRtYXR0ZXItaGVhZGVyIHR5cC1vcHRpb25zLWhlYWRlclwiIH0pO1xuXG4gICAgY29uc3QgY29sb3JSb3cgPSBvcHRpb25zSGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZGV0YWlsLWNvbG9yLXJvd1wiIH0pO1xuICAgIHRoaXMucmVuZGVyQ29sb3JQaWNrZXIoXG4gICAgICBjb2xvclJvdyxcbiAgICAgIHR5cCxcbiAgICAgIChuZXdDb2xvcikgPT4ge1xuICAgICAgICBpZiAoIXRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdCkgcmV0dXJuO1xuICAgICAgICAvLyBTYW1lIGN1c3RvbSBwcm9wZXJ0eSBhcyBhYm92ZSwgbm90IHN0eWxlLmNvbG9yIChzZWUgdGhlcmUpLlxuICAgICAgICB0aXRsZUVsLnN0eWxlLnNldFByb3BlcnR5KFwiLS10eXAtbmFtZS1jb2xvclwiLCBuZXdDb2xvcik7XG4gICAgICB9LFxuICAgICAgeyBzaG93UmVzZXQ6IHRydWUgfVxuICAgICk7XG5cbiAgICAvLyBTaW5nbGUtbGluZSBpbnB1dCBuZXh0IHRvIHRoZSBjb2xvciwgbGlrZSB0aGUgb25lIGluIHRoZSBUWVAtTGlzdC4gTm9cbiAgICAvLyBoZWFkaW5nOiB3aGlsZSBlbXB0eSwgaXRzIGZhZGVkIHBsYWNlaG9sZGVyIHNheXMgd2hhdCBpdCBpcy5cbiAgICBjb25zdCBkZXNjSW5wdXQgPSBvcHRpb25zSGVhZGVyLmNyZWF0ZUVsKFwiaW5wdXRcIiwge1xuICAgICAgdHlwZTogXCJ0ZXh0XCIsXG4gICAgICBjbHM6IFwidHlwLWRlc2NyaXB0aW9uLWlucHV0XCIsXG4gICAgICBhdHRyOiB7IHBsYWNlaG9sZGVyOiBcIkRlc2NyaXB0aW9uXCIgfSxcbiAgICB9KTtcbiAgICBkZXNjSW5wdXQudmFsdWUgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBEZXNjcmlwdGlvbnNbdHlwXSA/PyBcIlwiO1xuICAgIGRlc2NJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gZGVzY0lucHV0LnZhbHVlLnRyaW0oKTtcbiAgICAgIGlmICh2YWx1ZSkgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRGVzY3JpcHRpb25zW3R5cF0gPSB2YWx1ZTtcbiAgICAgIGVsc2UgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlc2NyaXB0aW9uc1t0eXBdO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgfSk7XG5cbiAgICAvLyBTZXBhcmF0ZXMgdGhlIGZyb250bWF0dGVyIGJsb2NrcyBmcm9tIHRoZSBUWVAncyBvdGhlciBzZXR0aW5ncy5cbiAgICBib2R5LmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZGV0YWlsLXNlcGFyYXRvclwiIH0pO1xuXG4gICAgLy8gVFlQLUZyb250bWF0dGVyIGFuZCBvbmUgYmxvY2sgcGVyIHJlZ2lzdGVyZWQgU3VidHlwIGJlbG93LCBlYWNoIHdpdGggaXRzXG4gICAgLy8gb3duIGVkaXRvciAoc2VlIGZyb250bWF0dGVyLWJsb2Nrcy5qcyksIHNvIHRoZSBzYW1lIGtleSBtYXkgYXBwZWFyIGluXG4gICAgLy8gc2V2ZXJhbCBibG9ja3MuIEEgU3VidHlwIGJsb2NrIGFkZHMgdG8gdGhlIFRZUC1Gcm9udG1hdHRlciBmb3Igbm90ZXMgd2l0aFxuICAgIC8vIHRoYXQgU1VCVFlQIGFuZCBvdmVycmlkZXMgc2FtZS1uYW1lZCBwcm9wZXJ0aWVzIChzZWUgc3VidHlwcy5qcykuXG4gICAgY29uc3QgYnVja2V0ID0gdGhpcy5wbHVnaW4udHlwSW5kZXguc3VidHlwQnVja2V0KHR5cCk7XG4gICAgdGhpcy5mcm9udG1hdHRlckJsb2NrcyA9IG1vdW50RnJvbnRtYXR0ZXJCbG9ja3ModGhpcywgYm9keSwgdHlwLCB7XG4gICAgICByZW5kZXJIZWFkZXI6IChzZWN0aW9uLCBlbCwgYmxvY2tzKSA9PiB0aGlzLnJlbmRlclNlY3Rpb25IZWFkZXIoZWwsIHR5cCwgc2VjdGlvbiwgYnVja2V0LCBibG9ja3MpLFxuICAgICAgcmVuZGVyRm9vdGVyOiAoc2VjdGlvbiwgZWwpID0+IHtcbiAgICAgICAgaWYgKHNlY3Rpb24gIT09IG51bGwpIHRoaXMucmVuZGVyU2VjdGlvbkZvb3RlcihlbCwgdHlwLCBzZWN0aW9uKTtcbiAgICAgIH0sXG4gICAgICBvbk1vdmVTZWN0aW9uOiBhc3luYyAob3JkZXIpID0+IHtcbiAgICAgICAgcmVvcmRlclN1YnR5cHModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgb3JkZXIpO1xuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgdGhpcy5mcm9udG1hdHRlckVkaXRvcnMucHVzaCguLi50aGlzLmZyb250bWF0dGVyQmxvY2tzLmVkaXRvcnMpO1xuXG4gICAgLy8gRnVsbCB3aWR0aCBhbmQgYWNjZW50IGNvbG9yLCB0byBzdGFuZCBhcGFydCBmcm9tIHRoZSBibG9ja3MnIHNtYWxsIGljb25cbiAgICAvLyBidXR0b25zLlxuICAgIHRoaXMuc3VidHlwQWRkQnRuRWwgPSBib2R5LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgY2xzOiBcIm1vZC1jdGEgdHlwLXN1YnR5cC1hZGRcIiB9KTtcbiAgICBzZXRJY29uKHRoaXMuc3VidHlwQWRkQnRuRWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtc3VidHlwLWFkZC1pY29uXCIgfSksIFwicGx1c1wiKTtcbiAgICB0aGlzLnN1YnR5cEFkZEJ0bkVsLmNyZWF0ZVNwYW4oeyB0ZXh0OiBcIkFkZCBTdWJ0eXBcIiB9KTtcbiAgICB0aGlzLnN1YnR5cEFkZEJ0bkVsLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnN0YXJ0QWRkU3VidHlwKHR5cCkpO1xuXG4gICAgdGhpcy5yZW5kZXJVbnJlZ2lzdGVyZWRTdWJ0eXBzKGJvZHksIHR5cCwgYnVja2V0KTtcblxuICAgIGJvZHkuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1kZXRhaWwtc2VwYXJhdG9yXCIgfSk7XG4gICAgdGhpcy5yZW5kZXJGbG9hdGluZ0hpbnQoYm9keSk7XG4gICAgLy8gVGhlIGJvbGQgbWFya3MgKGZyb250bWF0dGVyLWRlZmF1bHQtaGlnaGxpZ2h0LmpzKSBvbmx5IHJlYWN0IHRvIG1ldGFkYXRhXG4gICAgLy8gYW5kIGxheW91dCBldmVudHM7IG9wZW5pbmcgdGhpcyB2aWV3IGZpcmVzIG5vbmUsIHNvIHJlZnJlc2ggaGVyZS4gT25seVxuICAgIC8vIHRoaXMgb25lIHJlZnJlc2gsIG5vdCB0aGUgZnVsbCByZWZyZXNoVHlwQ29sb3JzKCksIHdoaWNoIHdvdWxkIGNhbGxcbiAgICAvLyByZW5kZXIoKSBvbiB0aGlzIHZpZXcgd2hpbGUgaXQgaXMgc3RpbGwgcmVuZGVyaW5nLlxuICAgIHRoaXMucGx1Z2luLnJlZnJlc2hGcm9udG1hdHRlckhpZ2hsaWdodD8uKCk7XG4gIH1cblxuICAvLyBBIGJsb2NrJ3MgaGVhZGluZyAoc2VlIGZyb250bWF0dGVyLWJsb2Nrcy5qcyk6IHRpdGxlIHdpdGggbm90ZSBjb3VudCAoZm9yXG4gIC8vIHRoZSBUWVAtRnJvbnRtYXR0ZXIgdGhlIG5vdGVzIHdpdGhvdXQgU1VCVFlQLCB0aGUgb25seSBvbmVzIGl0IGFwcGxpZXMgdG9cbiAgLy8gYWxvbmUpLCBzZWFyY2ggb24gY2xpY2ssIGFuZCB0aGUgdHdvIGFkZCBidXR0b25zIGZvciBhIGJsYW5rIHJvdyBpbiB0aGlzXG4gIC8vIGJsb2NrLlxuICByZW5kZXJTZWN0aW9uSGVhZGVyKGVsLCB0eXAsIHNlY3Rpb24sIGJ1Y2tldCwgYmxvY2tzKSB7XG4gICAgY29uc3QgdGl0bGVHcm91cCA9IGVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZnJvbnRtYXR0ZXItdGl0bGUtZ3JvdXBcIiB9KTtcbiAgICAvLyBOZXZlciBjb2xvcmVkLCB1bmxpa2UgdGhlIGRldGFpbCB0aXRsZSBhYm92ZTogYSBibG9jaydzIGNvbG9yIHNpdHMgaW5cbiAgICAvLyBpdHMgZm9vdGVyIGRvdCAoc2VlIHJlbmRlclNlY3Rpb25Gb290ZXIpLlxuICAgIGNvbnN0IHRpdGxlRWwgPSB0aXRsZUdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZGV0YWlsLXNlY3Rpb24tdGl0bGVcIiwgdGV4dDogc2VjdGlvbiA/PyBgJHt0eXB9LUZyb250bWF0dGVyYCB9KTtcbiAgICBjb25zdCBjb3VudCA9IHNlY3Rpb24gPT09IG51bGwgPyBidWNrZXQubm9TdWJ0eXAgOiBidWNrZXQuY291bnRzLmdldChzZWN0aW9uKSA/PyAwO1xuICAgIHRpdGxlR3JvdXAuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtc3VidHlwLWNvdW50XCIsIHRleHQ6IFN0cmluZyhjb3VudCkgfSk7XG4gICAgdGhpcy5tYWtlU2VhcmNoYWJsZSh0aXRsZUVsLCAoKSA9PiB0aGlzLm9wZW5TdWJ0eXBTZWFyY2godHlwLCBzZWN0aW9uKSk7XG5cbiAgICAvLyBGbG9hdGluZyBwcm9wZXJ0aWVzIHNoYXJlIHRoZSBsaXN0IGFuZCBvcmRlciBvZiB0aGUgb3RoZXJzICh3aGljaFxuICAgIC8vIGZyb250bWF0dGVyIHNvcnRpbmcgcmVsaWVzIG9uKSwgc28gdGhleSBsYW5kIHdoZXJldmVyIGRyYWcgJiBkcm9wIHB1dHNcbiAgICAvLyB0aGVtIGluc3RlYWQgb2YgYXQgdGhlIGVuZCBvZiBhIHNlY29uZCBsaXN0LlxuICAgIGNvbnN0IGFkZEJ1dHRvbnMgPSBlbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLWFkZC1ncm91cFwiIH0pO1xuXG4gICAgLy8gTGVmdCBvZiB0aGUgcGxhaW4gYnV0dG9uLCBpbiBhY2NlbnQgY29sb3I6IG1hcmtzIHRoZSBuZXh0IGFkZGVkIChvcixcbiAgICAvLyB1bnRpbCBzYXZlZCwgcmVuYW1lZCkgcHJvcGVydHkgYXMgZmxvYXRpbmcgKHNlZVxuICAgIC8vIGVkaXRvci50eXBQZW5kaW5nRmxvYXRpbmdBZGQpLiBGbG9hdGluZyBwcm9wZXJ0aWVzIGFyZW4ndCBjcmVhdGVkIGZvciBuZXdcbiAgICAvLyBub3RlcyAoc2VlIGdldFR5cERlZmF1bHRzKCkpIGFuZCBzaG93IGluIGl0YWxpY3Mgd2hlcmUgcHJlc2VudC5cbiAgICBjb25zdCBhZGRGbG9hdGluZ1Byb3BlcnR5QnRuID0gYWRkQnV0dG9ucy5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1mcm9udG1hdHRlci1hZGQtZmxvYXRpbmdcIixcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiQWRkIGZsb2F0aW5nIHByb3BlcnR5XCIgfSxcbiAgICB9KTtcbiAgICBzZXRJY29uKGFkZEZsb2F0aW5nUHJvcGVydHlCdG4sIFwicGx1c1wiKTtcbiAgICBhZGRGbG9hdGluZ1Byb3BlcnR5QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiBibG9ja3MuYWRkQmxhbmsoc2VjdGlvbiwgdHJ1ZSkpO1xuXG4gICAgY29uc3QgYWRkUHJvcGVydHlCdG4gPSBhZGRCdXR0b25zLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWZyb250bWF0dGVyLWFkZFwiLFxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJBZGQgcHJvcGVydHlcIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24oYWRkUHJvcGVydHlCdG4sIFwicGx1c1wiKTtcbiAgICBhZGRQcm9wZXJ0eUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gYmxvY2tzLmFkZEJsYW5rKHNlY3Rpb24sIGZhbHNlKSk7XG4gIH1cblxuICAvLyBGb290ZXIgb2YgYSBTdWJ0eXAgYmxvY2s6IG9uIHRoZSBsZWZ0IHRoZSBTdWJ0eXAgY29sb3IgKGEgZG90IG9wZW5pbmcgdGhlXG4gIC8vIHNsaWRlcnMsIHJlc2V0IG5leHQgdG8gaXQpLCBvbiB0aGUgcmlnaHQgdGhlIHNhbWUgYWN0aW9ucyBpbiB0aGUgc2FtZSBvcmRlclxuICAvLyBhcyB0aGUgZGV0YWlsIGhlYWRlciAocmVuYW1lIGFuZCB1cGRhdGUgbm90ZXMsIHJlbmFtZSwgbWFudWFsbHkgY3JlYXRhYmxlLFxuICAvLyBkZWxldGUpLiBUaGUgVFlQLUZyb250bWF0dGVyIGhhcyBubyBmb290ZXIuIFRoZSB0aXRsZSBpcyBsb29rZWQgdXAgb25cbiAgLy8gY2xpY2sgLSBoZWFkaW5nIGFuZCBmb290ZXIgYXJlIHJlYnVpbHQgb24gZXZlcnkgc3luY2hyb25pemUoKS5cbiAgcmVuZGVyU2VjdGlvbkZvb3RlcihlbCwgdHlwLCBzdWJ0eXApIHtcbiAgICBlbC5hZGRDbGFzcyhcInR5cC1zdWJ0eXAtYWN0aW9uc1wiKTtcbiAgICBjb25zdCBjb2xvckdyb3VwID0gZWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zdWJ0eXAtY29sb3ItZ3JvdXBcIiB9KTtcbiAgICAvLyBBIHJpbmcgYWxzbyB3aGlsZSB0aGUgVFlQIGl0c2VsZiBoYXMgbm8gY29sb3IgLSB0aGVuIGFuIG9mZnNldCBjb2xvcnNcbiAgICAvLyBub3RoaW5nIGFueXdoZXJlLlxuICAgIGNvbnN0IG93bkNvbG9yID0gc3VidHlwSGFzT3duQ29sb3IodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKTtcbiAgICBjb25zdCB0eXBIYXNDb2xvciA9ICEhdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF07XG4gICAgY29uc3QgY29sb3JEb3QgPSBjb2xvckdyb3VwLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwidHlwLXN1YnR5cC1jb2xvci1kb3RcIixcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6ICF0eXBIYXNDb2xvciA/IFwiVFlQIGhhcyBubyBjb2xvclwiIDogb3duQ29sb3IgPyBcIkFkanVzdCBjb2xvclwiIDogXCJVc2VzIFRZUCBjb2xvclwiIH0sXG4gICAgfSk7XG4gICAgY29sb3JEb3QudHlwU3VidHlwID0gc3VidHlwO1xuICAgIHBhaW50Q29sb3JEb3QoY29sb3JEb3QsIHN1YnR5cENvbG9yKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCkgPz8gREVGQVVMVF9UWVBfQ09MT1IsICFvd25Db2xvciB8fCAhdHlwSGFzQ29sb3IpO1xuICAgIGNvbG9yRG90LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLm9wZW5TdWJ0eXBDb2xvclBvcG92ZXIoY29sb3JEb3QsIHR5cCwgc3VidHlwKSk7XG4gICAgY29uc3QgcmVzZXRCdG4gPSBjb2xvckdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtY29sb3ItcmVzZXRcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJSZXNldCBjb2xvclwiIH0gfSk7XG4gICAgcmVzZXRCdG4udG9nZ2xlQ2xhc3MoXCJpcy1kaXNhYmxlZFwiLCAhb3duQ29sb3IpO1xuICAgIHNldEljb24ocmVzZXRCdG4sIFwicm90YXRlLWNjd1wiKTtcbiAgICByZXNldEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZGF0YSA9IGdldFN1YnR5cCh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApO1xuICAgICAgaWYgKCFkYXRhPy5jb2xvcikgcmV0dXJuO1xuICAgICAgY29uc3Qgc25hcHNob3QgPSBzbmFwc2hvdFNldHRpbmdzKHRoaXMucGx1Z2luKTtcbiAgICAgIGRlbGV0ZSBkYXRhLmNvbG9yO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICBvZmZlclVuZG8odGhpcy5wbHVnaW4sIGBDb2xvciBvZiBTdWJ0eXAgJHtzdWJ0eXB9IHJlc2V0LmAsIHNuYXBzaG90KTtcbiAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICB9KTtcblxuICAgIGNvbnN0IGFjdGlvbnMgPSBlbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLXN1YnR5cC1hY3Rpb24tZ3JvdXBcIiB9KTtcbiAgICBjb25zdCB0aXRsZUVsID0gKCkgPT4ge1xuICAgICAgbGV0IHNpYmxpbmcgPSBlbC5wcmV2aW91c0VsZW1lbnRTaWJsaW5nO1xuICAgICAgd2hpbGUgKHNpYmxpbmcgJiYgIXNpYmxpbmcuaGFzQ2xhc3MoXCJ0eXAtc2VjdGlvbi1oZWFkZXJcIikpIHNpYmxpbmcgPSBzaWJsaW5nLnByZXZpb3VzRWxlbWVudFNpYmxpbmc7XG4gICAgICByZXR1cm4gc2libGluZz8ucXVlcnlTZWxlY3RvcihcIi50eXAtZGV0YWlsLXNlY3Rpb24tdGl0bGVcIikgPz8gbnVsbDtcbiAgICB9O1xuICAgIGNvbnN0IHJlbmFtZSA9ICh1cGRhdGVOb3RlcykgPT4ge1xuICAgICAgY29uc3QgdGFyZ2V0ID0gdGl0bGVFbCgpO1xuICAgICAgaWYgKHRhcmdldCkgdGhpcy5zdGFydFN1YnR5cFJlbmFtZSh0eXAsIHN1YnR5cCwgdGFyZ2V0LCB7IHVwZGF0ZU5vdGVzIH0pO1xuICAgIH07XG5cbiAgICBjb25zdCByZW5hbWVXaXRoTm90ZXNCdG4gPSBhY3Rpb25zLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWRldGFpbC1yZW5hbWUtbm90ZXNcIixcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiUmVuYW1lIGFuZCB1cGRhdGUgbm90ZXNcIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24ocmVuYW1lV2l0aE5vdGVzQnRuLCBcInBlbmNpbFwiKTtcbiAgICByZW5hbWVXaXRoTm90ZXNCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHJlbmFtZSh0cnVlKSk7XG5cbiAgICBjb25zdCByZW5hbWVCdG4gPSBhY3Rpb25zLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtZGV0YWlsLXJlbmFtZVwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlJlbmFtZVwiIH0gfSk7XG4gICAgc2V0SWNvbihyZW5hbWVCdG4sIFwicGVuY2lsXCIpO1xuICAgIHJlbmFtZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gcmVuYW1lKGZhbHNlKSk7XG5cbiAgICB0aGlzLnJlbmRlclN1YnR5cE1hbnVhbFRvZ2dsZShhY3Rpb25zLCB0eXAsIHN1YnR5cCk7XG5cbiAgICBjb25zdCBkZWxldGVCdG4gPSBhY3Rpb25zLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtZGV0YWlsLWRlbGV0ZVwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkRlbGV0ZVwiIH0gfSk7XG4gICAgc2V0SWNvbihkZWxldGVCdG4sIFwidHJhc2hcIik7XG4gICAgZGVsZXRlQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmRlbGV0ZVN1YnR5cFdpdGhDb25maXJtKHR5cCwgc3VidHlwKSk7XG4gIH1cblxuICAvLyBQb3BvdmVyIGJlbG93IGEgU3VidHlwIGJsb2NrJ3MgZG90OiBvbmUgc2xpZGVyIHBlciBjaGFubmVsLCBsaW1pdGVkIHRvIHRoZVxuICAvLyByYW5nZSBmcm9tIHRoZSBzZXR0aW5ncyAoc2VlIHR5cC1jb2xvcnMuanMpLCBlYWNoIHRyYWNrIHNob3dpbmcgdGhlIGNvbG9yc1xuICAvLyBpdCBjYW4gcmVhY2guIERyYWdnaW5nIG9ubHkgdXBkYXRlcyB0aGUgZG90IGhlcmU7IHNhdmluZyBhbmQgdXBkYXRpbmcgdGhlXG4gIC8vIG90aGVyIHZpZXdzIGhhcHBlbnMgb24gY2xvc2UgKGNsaWNrIG91dHNpZGUgb3IgRXNjYXBlKSwgc2luY2VcbiAgLy8gcmVmcmVzaFR5cENvbG9ycygpIHJlLXJlbmRlcnMgdGhpcyB2aWV3IGFtb25nIG90aGVycy5cbiAgb3BlblN1YnR5cENvbG9yUG9wb3ZlcihhbmNob3JFbCwgdHlwLCBzdWJ0eXApIHtcbiAgICB0aGlzLmNsb3NlU3VidHlwQ29sb3JQb3BvdmVyPy4oKTtcbiAgICBjb25zdCB7IHNldHRpbmdzIH0gPSB0aGlzLnBsdWdpbjtcbiAgICBjb25zdCBkYXRhID0gZ2V0U3VidHlwKHNldHRpbmdzLCB0eXAsIHN1YnR5cCk7XG4gICAgaWYgKCFkYXRhKSByZXR1cm47XG4gICAgY29uc3QgdHlwQ29sb3IgPSBzZXR0aW5ncy50eXBDb2xvcnNbdHlwXSA/PyBERUZBVUxUX1RZUF9DT0xPUjtcbiAgICAvLyBXaXRob3V0IGFuIG9mZnNldCBldmVyeSBzbGlkZXIgc3RhcnRzIGF0IDA7IFNVQlRZUF9DT0xPUl9DSEFOTkVMUyBhbG9uZVxuICAgIC8vIHNheXMgd2hpY2ggZXhpc3QuXG4gICAgY29uc3Qgb2Zmc2V0ID0gY2xhbXBlZE9mZnNldChzZXR0aW5ncywgZGF0YS5jb2xvcikgPz8gT2JqZWN0LmZyb21FbnRyaWVzKFNVQlRZUF9DT0xPUl9DSEFOTkVMUy5tYXAoKHsga2V5IH0pID0+IFtrZXksIDBdKSk7XG4gICAgY29uc3QgZG9jID0gYW5jaG9yRWwuZG9jO1xuICAgIGNvbnN0IHBvcG92ZXIgPSBkb2MuYm9keS5jcmVhdGVEaXYoeyBjbHM6IFwibWVudSB0eXAtc3VidHlwLWNvbG9yLXBvcG92ZXJcIiB9KTtcblxuICAgIGNvbnN0IHJvd3MgPSBbXTtcbiAgICBjb25zdCB1cGRhdGUgPSAoKSA9PiB7XG4gICAgICBjb25zdCBjb2xvciA9IGFwcGx5Q29sb3JPZmZzZXQodHlwQ29sb3IsIG9mZnNldCk7XG4gICAgICBmb3IgKGNvbnN0IGVsIG9mIHRoaXMuY29udGVudEVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIudHlwLXN1YnR5cC1jb2xvci1kb3RcIikpIHtcbiAgICAgICAgaWYgKGVsLnR5cFN1YnR5cCA9PT0gc3VidHlwKSBwYWludENvbG9yRG90KGVsLCBjb2xvciwgIWhhc0NvbG9yT2Zmc2V0KG9mZnNldCkgfHwgIXNldHRpbmdzLnR5cENvbG9yc1t0eXBdKTtcbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHJvdygpO1xuICAgIH07XG5cbiAgICBmb3IgKGNvbnN0IHsga2V5LCBsYWJlbCwgdW5pdCB9IG9mIFNVQlRZUF9DT0xPUl9DSEFOTkVMUykge1xuICAgICAgY29uc3QgW21pbiwgbWF4XSA9IGNoYW5uZWxCb3VuZHMoc2V0dGluZ3MsIGtleSk7XG4gICAgICBjb25zdCByb3cgPSBwb3BvdmVyLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtc3VidHlwLWNvbG9yLXJvd1wiIH0pO1xuICAgICAgcm93LmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXN1YnR5cC1jb2xvci1sYWJlbFwiLCB0ZXh0OiBsYWJlbCB9KTtcbiAgICAgIGNvbnN0IGlucHV0ID0gcm93LmNyZWF0ZUVsKFwiaW5wdXRcIiwgeyB0eXBlOiBcInJhbmdlXCIsIGNsczogXCJzbGlkZXIgdHlwLXN1YnR5cC1jb2xvci1zbGlkZXJcIiB9KTtcbiAgICAgIGlucHV0Lm1pbiA9IFN0cmluZyhtaW4pO1xuICAgICAgaW5wdXQubWF4ID0gU3RyaW5nKG1heCk7XG4gICAgICBpbnB1dC5zdGVwID0gXCIxXCI7XG4gICAgICBpbnB1dC52YWx1ZSA9IFN0cmluZyhvZmZzZXRba2V5XSk7XG4gICAgICBpbnB1dC5kaXNhYmxlZCA9IG1pbiA9PT0gbWF4O1xuICAgICAgY29uc3QgdmFsdWVFbCA9IHJvdy5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1zdWJ0eXAtY29sb3ItdmFsdWVcIiB9KTtcbiAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJpbnB1dFwiLCAoKSA9PiB7XG4gICAgICAgIG9mZnNldFtrZXldID0gTnVtYmVyKGlucHV0LnZhbHVlKTtcbiAgICAgICAgdXBkYXRlKCk7XG4gICAgICB9KTtcbiAgICAgIHJvd3MucHVzaCgoKSA9PiB7XG4gICAgICAgIGNvbnN0IHN0ZXBzID0gODtcbiAgICAgICAgY29uc3Qgc3RvcHMgPSBbXTtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPD0gc3RlcHM7IGkrKykge1xuICAgICAgICAgIHN0b3BzLnB1c2goYXBwbHlDb2xvck9mZnNldCh0eXBDb2xvciwgeyAuLi5vZmZzZXQsIFtrZXldOiBtaW4gKyAoKG1heCAtIG1pbikgKiBpKSAvIHN0ZXBzIH0pKTtcbiAgICAgICAgfVxuICAgICAgICBpbnB1dC5zdHlsZS5zZXRQcm9wZXJ0eShcIi0tdHlwLXRyYWNrXCIsIGBsaW5lYXItZ3JhZGllbnQodG8gcmlnaHQsICR7c3RvcHMuam9pbihcIiwgXCIpfSlgKTtcbiAgICAgICAgdmFsdWVFbC5zZXRUZXh0KGAke29mZnNldFtrZXldID4gMCA/IFwiK1wiIDogXCJcIn0ke29mZnNldFtrZXldfSR7dW5pdH1gKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICB1cGRhdGUoKTtcblxuICAgIC8vIEJlbG93IHRoZSBkb3QsIGJ1dCBpbnNpZGUgdGhlIHdpbmRvdy5cbiAgICBjb25zdCByZWN0ID0gYW5jaG9yRWwuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgY29uc3Qgd2luID0gZG9jLmRlZmF1bHRWaWV3O1xuICAgIGNvbnN0IHdpZHRoID0gcG9wb3Zlci5vZmZzZXRXaWR0aDtcbiAgICBjb25zdCBoZWlnaHQgPSBwb3BvdmVyLm9mZnNldEhlaWdodDtcbiAgICBwb3BvdmVyLnN0eWxlLmxlZnQgPSBgJHtNYXRoLm1heCg4LCBNYXRoLm1pbihyZWN0LmxlZnQsIHdpbi5pbm5lcldpZHRoIC0gd2lkdGggLSA4KSl9cHhgO1xuICAgIHBvcG92ZXIuc3R5bGUudG9wID0gYCR7cmVjdC5ib3R0b20gKyA2ICsgaGVpZ2h0ID4gd2luLmlubmVySGVpZ2h0IC0gOCA/IHJlY3QudG9wIC0gNiAtIGhlaWdodCA6IHJlY3QuYm90dG9tICsgNn1weGA7XG5cbiAgICBjb25zdCBvblBvaW50ZXJEb3duID0gKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoIXBvcG92ZXIuY29udGFpbnMoZXZlbnQudGFyZ2V0KSkgY2xvc2UoKTtcbiAgICB9O1xuICAgIGNvbnN0IG9uS2V5RG93biA9IChldmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmtleSAhPT0gXCJFc2NhcGVcIikgcmV0dXJuO1xuICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgY2xvc2UoKTtcbiAgICB9O1xuICAgIGNvbnN0IGNsb3NlID0gYXN5bmMgKCkgPT4ge1xuICAgICAgdGhpcy5jbG9zZVN1YnR5cENvbG9yUG9wb3ZlciA9IG51bGw7XG4gICAgICBkb2MucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNlZG93blwiLCBvblBvaW50ZXJEb3duLCB0cnVlKTtcbiAgICAgIGRvYy5yZW1vdmVFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCBvbktleURvd24sIHRydWUpO1xuICAgICAgcG9wb3Zlci5yZW1vdmUoKTtcbiAgICAgIGNvbnN0IGN1cnJlbnQgPSBnZXRTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgc3VidHlwKTtcbiAgICAgIGlmICghY3VycmVudCkgcmV0dXJuO1xuICAgICAgLy8gVGhlIHNsaWRlcnMgb25seSB0b3VjaGVkIHRoZSBkb3Qgc28gZmFyLCBzbyBhIHNuYXBzaG90IHRha2VuIG5vdyBpc1xuICAgICAgLy8gc3RpbGwgdGhlIHN0YXRlIGZyb20gb3BlbmluZyAtIHdpdGhvdXQgcmV2ZXJ0aW5nIGFueXRoaW5nIHNhdmVkXG4gICAgICAvLyBlbHNld2hlcmUgaW4gdGhlIG1lYW50aW1lLlxuICAgICAgY29uc3Qgc25hcHNob3QgPSBzbmFwc2hvdFNldHRpbmdzKHRoaXMucGx1Z2luKTtcbiAgICAgIGNvbnN0IGJlZm9yZSA9IEpTT04uc3RyaW5naWZ5KGN1cnJlbnQuY29sb3IgPz8gbnVsbCk7XG4gICAgICBpZiAoaGFzQ29sb3JPZmZzZXQob2Zmc2V0KSkgY3VycmVudC5jb2xvciA9IHsgLi4ub2Zmc2V0IH07XG4gICAgICBlbHNlIGRlbGV0ZSBjdXJyZW50LmNvbG9yO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICBpZiAoSlNPTi5zdHJpbmdpZnkoY3VycmVudC5jb2xvciA/PyBudWxsKSAhPT0gYmVmb3JlKSB7XG4gICAgICAgIG9mZmVyVW5kbyh0aGlzLnBsdWdpbiwgYENvbG9yIG9mIFN1YnR5cCAke3N1YnR5cH0gY2hhbmdlZC5gLCBzbmFwc2hvdCk7XG4gICAgICB9XG4gICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgfTtcbiAgICB0aGlzLmNsb3NlU3VidHlwQ29sb3JQb3BvdmVyID0gY2xvc2U7XG4gICAgZG9jLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZWRvd25cIiwgb25Qb2ludGVyRG93biwgdHJ1ZSk7XG4gICAgZG9jLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIG9uS2V5RG93biwgdHJ1ZSk7XG4gIH1cblxuICAvLyBEZWxldGVzIHRoZSBTdWJ0eXAgYmxvY2sgd2l0aCBpdHMgcHJvcGVydGllcy4gTm90ZXMga2VlcCB0aGVpciBTVUJUWVBcbiAgLy8gdmFsdWUgKGl0IHRoZW4gc2hvd3MgYXMgdW5yZWdpc3RlcmVkIGJlbG93KSwgc28gY29uZmlybWF0aW9uIGlzIG9ubHlcbiAgLy8gbmVlZGVkIHdoZW4gcHJvcGVydGllcyB3b3VsZCBiZSBsb3N0LiBFaXRoZXIgd2F5IGFuIHVuZG8gaXMgb2ZmZXJlZFxuICAvLyBhZnRlcndhcmRzIChzZWUgdW5kby5qcykuXG4gIGRlbGV0ZVN1YnR5cFdpdGhDb25maXJtKHR5cCwgc3VidHlwKSB7XG4gICAgY29uc3QgYXBwbHkgPSBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBzbmFwc2hvdCA9IHNuYXBzaG90U2V0dGluZ3ModGhpcy5wbHVnaW4pO1xuICAgICAgZGVsZXRlU3VidHlwKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCk7XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgIG9mZmVyVW5kbyh0aGlzLnBsdWdpbiwgYFN1YnR5cCAke3N1YnR5cH0gZGVsZXRlZC5gLCBzbmFwc2hvdCk7XG4gICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgfTtcbiAgICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXMoZ2V0U3VidHlwKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCk/LmZyb250bWF0dGVyID8/IHt9KS5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBcIlwiKTtcbiAgICBpZiAoa2V5cy5sZW5ndGggPT09IDApIHtcbiAgICAgIGFwcGx5KCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHsgcGx1Z2luIH0gPSB0aGlzO1xuICAgIHRoaXMuY29uZmlybURlbGV0aW9uKFxuICAgICAge1xuICAgICAgICB0aXRsZTogW1xuICAgICAgICAgIFwiRGVsZXRlIFwiLFxuICAgICAgICAgIHN1YnR5cE5hbWVOb2RlKHBsdWdpbiwgdHlwLCBzdWJ0eXApLFxuICAgICAgICAgIFwiIG9mIFwiLFxuICAgICAgICAgIHR5cE5hbWVOb2RlKHBsdWdpbiwgdHlwLCBwbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPz8gbnVsbCksXG4gICAgICAgICAgXCI/XCIsXG4gICAgICAgIF0sXG4gICAgICAgIGJvZHk6IFtcbiAgICAgICAgICBrZXlzLmxlbmd0aCA9PT0gMVxuICAgICAgICAgICAgPyBgSXRzIHByb3BlcnR5ICR7a2V5c1swXX0gd2lsbCBiZSBsb3N0LmBcbiAgICAgICAgICAgIDogYEl0cyAke2tleXMubGVuZ3RofSBwcm9wZXJ0aWVzICR7a2V5cy5qb2luKFwiLCBcIil9IHdpbGwgYmUgbG9zdC5gLFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICAgIGFwcGx5XG4gICAgKTtcbiAgfVxuXG4gIC8vIFwiRGVsZXRlIFRZUFwiIGFuZCBcIkRlbGV0ZSBTdWJ0eXBcIiBjaGFuZ2Ugbm90aGluZyBidXQgdGhlIHNldHRpbmdzIGFuZCBvZmZlclxuICAvLyBVbmRvIGFmdGVyd2FyZHMsIHNvIC0gdW5saWtlIGV2ZXJ5IGRpYWxvZyB0aGF0IHJld3JpdGVzIG5vdGVzIC0gdGhlaXJcbiAgLy8gY29uZmlybWF0aW9uIGNhbiBiZSBzd2l0Y2hlZCBvZmY6IHNldHRpbmcgXCJDb25maXJtIGRlbGV0aW9uXCIsIG9yIFwiRG9uJ3RcbiAgLy8gYXNrIGFnYWluXCIgaW4gdGhlIGRpYWxvZyBpdHNlbGYuIFdpdGhvdXQgaXQgYXBwbHkoKSBydW5zIGF0IG9uY2UuXG4gIGNvbmZpcm1EZWxldGlvbih7IHRpdGxlLCBib2R5IH0sIGFwcGx5KSB7XG4gICAgaWYgKCF0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb25maXJtRGVsZXRpb24pIHtcbiAgICAgIGFwcGx5KCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIG5ldyBDb25maXJtTW9kYWwodGhpcy5hcHAsIHtcbiAgICAgIHRpdGxlLFxuICAgICAgYm9keSxcbiAgICAgIGNvbmZpcm1UZXh0OiBcIkRlbGV0ZVwiLFxuICAgICAgd2FybmluZzogdHJ1ZSxcbiAgICAgIGZvY3VzOiBcImNhbmNlbFwiLFxuICAgICAgZG9udEFza0FnYWluOiB0cnVlLFxuICAgICAgb25Db25maXJtOiAoZG9udEFza0FnYWluKSA9PiB7XG4gICAgICAgIC8vIFNldCBiZWZvcmUgYXBwbHkoKSwgd2hpY2ggc2F2ZXMgaXQgYWxvbmcgd2l0aCB0aGUgZGVsZXRpb24gYW5kXG4gICAgICAgIC8vIHRha2VzIGl0cyB1bmRvIHNuYXBzaG90IG9ubHkgYWZ0ZXJ3YXJkcyAtIFVuZG8gZG9lc24ndCBicmluZyB0aGVcbiAgICAgICAgLy8gZGlhbG9nIGJhY2suXG4gICAgICAgIGlmIChkb250QXNrQWdhaW4pIHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbmZpcm1EZWxldGlvbiA9IGZhbHNlO1xuICAgICAgICBhcHBseSgpO1xuICAgICAgfSxcbiAgICB9KS5vcGVuKCk7XG4gIH1cblxuICAvLyBMaWtlIHN0YXJ0RGV0YWlsUmVuYW1lKCksIG9uIGEgU3VidHlwIGJsb2NrJ3MgdGl0bGUuIFRoZSBibG9jayBrZWVwcyBpdHNcbiAgLy8gcG9zaXRpb247IHVwZGF0ZU5vdGVzOiB0cnVlIGFsc28gcmV3cml0ZXMgdGhlIFNVQlRZUCBvZiB0aGUgYWZmZWN0ZWQgbm90ZXNcbiAgLy8gYWZ0ZXIgY29uZmlybWF0aW9uLiBBbiBleGlzdGluZyBuYW1lIG9mZmVycyBhIG1lcmdlIGluc3RlYWQgKHdoaWNoIGFsd2F5c1xuICAvLyByZXdyaXRlcyB0aGUgbm90ZXMpLlxuICBzdGFydFN1YnR5cFJlbmFtZSh0eXAsIHN1YnR5cCwgdGl0bGVFbCwgeyB1cGRhdGVOb3RlcyA9IGZhbHNlIH0gPSB7fSkge1xuICAgIGlmICh0aGlzLmlzRWRpdGluZykgcmV0dXJuO1xuICAgIHRoaXMuaXNFZGl0aW5nID0gdHJ1ZTtcblxuICAgIHRpdGxlRWwuYWRkQ2xhc3MoXCJ0eXAtc3VidHlwLW5hbWUtaW5wdXRcIiwgXCJpcy1iZWluZy1yZW5hbWVkXCIpO1xuICAgIHRpdGxlRWwuc2V0QXR0cmlidXRlKFwiY29udGVudGVkaXRhYmxlXCIsIFwidHJ1ZVwiKTtcbiAgICB0aXRsZUVsLnNldEF0dHJpYnV0ZShcInNwZWxsY2hlY2tcIiwgXCJmYWxzZVwiKTtcbiAgICB0aXRsZUVsLmZvY3VzKCk7XG5cbiAgICBjb25zdCByYW5nZSA9IHRpdGxlRWwuZG9jLmNyZWF0ZVJhbmdlKCk7XG4gICAgcmFuZ2Uuc2VsZWN0Tm9kZUNvbnRlbnRzKHRpdGxlRWwpO1xuICAgIGNvbnN0IHNlbGVjdGlvbiA9IHRpdGxlRWwud2luLmdldFNlbGVjdGlvbigpO1xuICAgIHNlbGVjdGlvbi5yZW1vdmVBbGxSYW5nZXMoKTtcbiAgICBzZWxlY3Rpb24uYWRkUmFuZ2UocmFuZ2UpO1xuXG4gICAgY29uc3QgY291bnRPZiA9IChuYW1lKSA9PiB0aGlzLnBsdWdpbi50eXBJbmRleC5zdWJ0eXBCdWNrZXQodHlwKS5jb3VudHMuZ2V0KG5hbWUpID8/IDA7XG4gICAgY29uc3QgYXBwbHlSZW5hbWUgPSBhc3luYyAodmFsdWUsIHsgd2l0aE5vdGVzIH0pID0+IHtcbiAgICAgIHJlbmFtZVN1YnR5cCh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXAsIHZhbHVlKTtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgY29uc3QgcmVuYW1lZCA9IHdpdGhOb3RlcyA/IGF3YWl0IHJlbmFtZVN1YnR5cEluTm90ZXModGhpcy5wbHVnaW4sIHR5cCwgc3VidHlwLCB2YWx1ZSkgOiAwO1xuICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICBpZiAod2l0aE5vdGVzKSBuZXcgTm90aWNlKGBTdWJ0eXAgJHt2YWx1ZX06ICR7cGx1cmFsKHJlbmFtZWQsIFwibm90ZVwiKX0gdXBkYXRlZC5gKTtcbiAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgfTtcblxuICAgIGxldCBkb25lID0gZmFsc2U7XG4gICAgY29uc3QgZmluaXNoID0gYXN5bmMgKGNvbW1pdCkgPT4ge1xuICAgICAgaWYgKGRvbmUpIHJldHVybjtcbiAgICAgIGRvbmUgPSB0cnVlO1xuICAgICAgdGhpcy5pc0VkaXRpbmcgPSBmYWxzZTtcblxuICAgICAgY29uc3QgdmFsdWUgPSBub3JtYWxpemVTdWJ0eXBOYW1lKHRpdGxlRWwudGV4dENvbnRlbnQpO1xuICAgICAgaWYgKCFjb21taXQgfHwgIXZhbHVlIHx8IHZhbHVlID09PSBzdWJ0eXApIHtcbiAgICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBleGlzdGluZyA9IGdldFN1YnR5cE5hbWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXApLmZpbmQoXG4gICAgICAgIChuYW1lKSA9PiBuYW1lLnRvTG93ZXJDYXNlKCkgPT09IHZhbHVlLnRvTG93ZXJDYXNlKCkgJiYgbmFtZSAhPT0gc3VidHlwXG4gICAgICApO1xuICAgICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICAgIG5ldyBDb25maXJtTW9kYWwodGhpcy5hcHAsIHtcbiAgICAgICAgICB0aXRsZTogW1xuICAgICAgICAgICAgXCJNZXJnZSBcIixcbiAgICAgICAgICAgIHN1YnR5cE5hbWVOb2RlKHRoaXMucGx1Z2luLCB0eXAsIHN1YnR5cCksXG4gICAgICAgICAgICBcIiBpbnRvIFwiLFxuICAgICAgICAgICAgc3VidHlwTmFtZU5vZGUodGhpcy5wbHVnaW4sIHR5cCwgZXhpc3RpbmcpLFxuICAgICAgICAgICAgXCI/XCIsXG4gICAgICAgICAgXSxcbiAgICAgICAgICBib2R5OiBbXG4gICAgICAgICAgICBgJHtleGlzdGluZ30gYWxyZWFkeSBleGlzdHMgaW4gJHt0eXB9LiBgICtcbiAgICAgICAgICAgICAgYCR7cGx1cmFsKGNvdW50T2Yoc3VidHlwKSwgXCJub3RlXCIpfSAke2NvdW50T2Yoc3VidHlwKSA9PT0gMSA/IFwibW92ZXNcIiA6IFwibW92ZVwifSB0byBpdCwgYCArXG4gICAgICAgICAgICAgIGBhbmQgdGhlIHByb3BlcnRpZXMgb2YgJHtzdWJ0eXB9IG1vdmUgaW50byBpdHMgYmxvY2suYCxcbiAgICAgICAgICBdLFxuICAgICAgICAgIGNvbmZpcm1UZXh0OiBcIk1lcmdlXCIsXG4gICAgICAgICAgd2FybmluZzogdHJ1ZSxcbiAgICAgICAgICBmb2N1czogXCJjYW5jZWxcIixcbiAgICAgICAgICBvbkNvbmZpcm06IGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIG1lcmdlU3VidHlwcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXAsIGV4aXN0aW5nKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgY29uc3QgcmVuYW1lZCA9IGF3YWl0IHJlbmFtZVN1YnR5cEluTm90ZXModGhpcy5wbHVnaW4sIHR5cCwgc3VidHlwLCBleGlzdGluZyk7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoYFN1YnR5cCAke3N1YnR5cH0gbWVyZ2VkIGludG8gJHtleGlzdGluZ30sICR7cGx1cmFsKHJlbmFtZWQsIFwibm90ZVwiKX0gdXBkYXRlZC5gKTtcbiAgICAgICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICAgICAgfSxcbiAgICAgICAgICBvbkNhbmNlbDogKCkgPT4gdGhpcy5yZW5kZXIoKSxcbiAgICAgICAgfSkub3BlbigpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmICghdXBkYXRlTm90ZXMpIHtcbiAgICAgICAgYXdhaXQgYXBwbHlSZW5hbWUodmFsdWUsIHsgd2l0aE5vdGVzOiBmYWxzZSB9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgLy8gU2FtZSBjb2xvciBmb3Igb2xkIGFuZCBuZXcgbmFtZTogdGhlIG5ldyBvbmUgdGFrZXMgb3ZlciB0aGUgb2xkIG9uZSdzXG4gICAgICAvLyBvZmZzZXQgKHNlZSByZW5hbWVTdWJ0eXApLlxuICAgICAgbmV3IENvbmZpcm1Nb2RhbCh0aGlzLmFwcCwge1xuICAgICAgICB0aXRsZTogW1xuICAgICAgICAgIFwiUmVuYW1lIFwiLFxuICAgICAgICAgIHN1YnR5cE5hbWVOb2RlKHRoaXMucGx1Z2luLCB0eXAsIHN1YnR5cCksXG4gICAgICAgICAgXCIgdG8gXCIsXG4gICAgICAgICAgc3VidHlwTmFtZU5vZGUodGhpcy5wbHVnaW4sIHR5cCwgdmFsdWUsIHN1YnR5cCksXG4gICAgICAgICAgXCI/XCIsXG4gICAgICAgIF0sXG4gICAgICAgIGJvZHk6IFtgJHtwbHVyYWwoY291bnRPZihzdWJ0eXApLCBcIm5vdGVcIil9IHdpbGwgYmUgdXBkYXRlZC5gXSxcbiAgICAgICAgY29uZmlybVRleHQ6IFwiUmVuYW1lXCIsXG4gICAgICAgIGZvY3VzOiBcImNvbmZpcm1cIixcbiAgICAgICAgb25Db25maXJtOiAoKSA9PiBhcHBseVJlbmFtZSh2YWx1ZSwgeyB3aXRoTm90ZXM6IHRydWUgfSksXG4gICAgICAgIG9uQ2FuY2VsOiAoKSA9PiB0aGlzLnJlbmRlcigpLFxuICAgICAgfSkub3BlbigpO1xuICAgIH07XG5cbiAgICAvLyBLZWVwIGV2ZXJ5IGtleSBoZXJlOiB0aGUgdGl0bGUgc2l0cyBpbnNpZGUgT2JzaWRpYW4ncyBwcm9wZXJ0eSBlZGl0b3IsXG4gICAgLy8gd2hvc2Uga2V5Ym9hcmQgbmF2aWdhdGlvbiB3b3VsZCByZWFjdCB0b28gKEVzY2FwZSBhbHNvIGJlY2F1c2Ugb2YgdGhlXG4gICAgLy8gZGV0YWlsIHZpZXcsIHNlZSBvbk9wZW4pLlxuICAgIHRpdGxlRWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRW50ZXJcIikge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBmaW5pc2godHJ1ZSk7XG4gICAgICB9IGVsc2UgaWYgKGV2ZW50LmtleSA9PT0gXCJFc2NhcGVcIikge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBmaW5pc2goZmFsc2UpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIHRpdGxlRWwuYWRkRXZlbnRMaXN0ZW5lcihcImJsdXJcIiwgKCkgPT4gZmluaXNoKHRydWUpKTtcbiAgfVxuXG4gIC8vIExpa2UgdGhlIHVucmVnaXN0ZXJlZCBlbnRyaWVzIG9mIHRoZSBUWVAtTGlzdDogU1VCVFlQIHZhbHVlcyBvZiB0aGlzIFRZUCdzXG4gIC8vIG5vdGVzIHRoYXQgaGF2ZSBubyBibG9jayB5ZXQgKG5vdGVzIHdpdGhvdXQgYW55IFNVQlRZUCBjb3VudCBmb3IgdGhlXG4gIC8vIFRZUC1Gcm9udG1hdHRlciBpbnN0ZWFkKS4gU2hvd24gbGlrZSBTdWJ0eXAgYmxvY2tzLCBidXQgb25seSBoZWFkaW5nIGFuZFxuICAvLyBjb3VudC4gQSBjbGljayBvbiB0aGUgYmxvY2sgcmVnaXN0ZXJzIHRoZSB2YWx1ZTsgYSBjbGljayBvbiB0aGUgbmFtZSBvcGVuc1xuICAvLyB0aGUgc2VhcmNoIGluc3RlYWQgLSBjaGVja2luZyB3aGF0IGEgdmFsdWUgaG9sZHMgYmVmb3JlIHJlZ2lzdGVyaW5nIGl0IGlzXG4gIC8vIHRoZSBjb21tb24gY2FzZS4gVGhlIG5hbWUgbGlnaHRzIHVwIGluIGFjY2VudCBjb2xvciBvbiBob3ZlciB0byBzaG93IGl0XG4gIC8vIGRvZXMgc29tZXRoaW5nIGRpZmZlcmVudCBmcm9tIHRoZSBhcmVhIGFyb3VuZCBpdC5cbiAgcmVuZGVyVW5yZWdpc3RlcmVkU3VidHlwcyhwYXJlbnQsIHR5cCwgYnVja2V0KSB7XG4gICAgY29uc3QgcmVnaXN0ZXJlZCA9IGdldFN1YnR5cE5hbWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXApO1xuICAgIGNvbnN0IHVucmVnaXN0ZXJlZCA9IFsuLi5idWNrZXQuY291bnRzLmtleXMoKV1cbiAgICAgIC5maWx0ZXIoKGtleSkgPT4gIXJlZ2lzdGVyZWQuaW5jbHVkZXMoa2V5KSlcbiAgICAgIC5zb3J0KChhLCBiKSA9PiBidWNrZXQuY291bnRzLmdldChiKSAtIGJ1Y2tldC5jb3VudHMuZ2V0KGEpIHx8IGEubG9jYWxlQ29tcGFyZShiKSk7XG4gICAgaWYgKHVucmVnaXN0ZXJlZC5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgIGNvbnN0IGxpc3RFbCA9IHBhcmVudC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLXN1YnR5cC11bnJlZ2lzdGVyZWQtbGlzdFwiIH0pO1xuICAgIGZvciAoY29uc3Qga2V5IG9mIHVucmVnaXN0ZXJlZCkge1xuICAgICAgY29uc3QgYmxvY2sgPSBsaXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci1ibG9jayB0eXAtc3VidHlwLWJsb2NrIHR5cC1zdWJ0eXAtdW5yZWdpc3RlcmVkXCIgfSk7XG4gICAgICBjb25zdCBoZWFkZXIgPSBibG9jay5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLWhlYWRlclwiIH0pO1xuICAgICAgY29uc3QgdGl0bGVHcm91cCA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLXRpdGxlLWdyb3VwXCIgfSk7XG4gICAgICBjb25zdCB0aXRsZUVsID0gdGl0bGVHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIsIHRleHQ6IGRpc3BsYXlUeXBLZXkoa2V5KSB9KTtcbiAgICAgIHRpdGxlR3JvdXAuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtc3VidHlwLWNvdW50XCIsIHRleHQ6IFN0cmluZyhidWNrZXQuY291bnRzLmdldChrZXkpKSB9KTtcbiAgICAgIGJsb2NrLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnJlZ2lzdGVyU3VidHlwKHR5cCwga2V5LCBidWNrZXQpKTtcbiAgICAgIC8vIHN0b3BQcm9wYWdhdGlvbiwgb3IgdGhlIHNhbWUgY2xpY2sgd291bGQgYWxzbyByZWdpc3RlciB0aGUgdmFsdWUgb25lXG4gICAgICAvLyBvbmx5IHdhbnRlZCB0byBsb29rIHVwLlxuICAgICAgdGhpcy5tYWtlU2VhcmNoYWJsZSh0aXRsZUVsLCAoKSA9PiB0aGlzLm9wZW5TdWJ0eXBTZWFyY2godHlwLCBrZXkpLCB7IHN0b3BQcm9wYWdhdGlvbjogdHJ1ZSB9KTtcbiAgICB9XG4gIH1cblxuICAvLyBBIG5hbWUgd2hvc2UgY2xpY2sgb3BlbnMgdGhlIHNlYXJjaDogcG9pbnRlciBjdXJzb3IgYW5kIGFjY2VudCBjb2xvciBvblxuICAvLyBob3ZlciAoLnR5cC1zZWFyY2hhYmxlKSwgc28gdGhlIHZpZXcgaXRzZWxmIHNob3dzIHdoZXJlIHNvbWV0aGluZyBoYXBwZW5zLlxuICAvLyBUaGUgbmFtZSBpcyB3aGVyZSBvbmUgZXhwZWN0cyBcInNob3cgbWUgdGhlc2Ugbm90ZXNcIi4gV2hpbGUgcmVuYW1pbmcsIHRoZVxuICAvLyBlbGVtZW50IGlzIGFuIGlucHV0IChpcy1iZWluZy1yZW5hbWVkKSBhbmQgYSBjbGljayBqdXN0IHBsYWNlcyB0aGUgY3Vyc29yLlxuICBtYWtlU2VhcmNoYWJsZShlbCwgb25TZWFyY2gsIHsgc3RvcFByb3BhZ2F0aW9uID0gZmFsc2UgfSA9IHt9KSB7XG4gICAgZWwuYWRkQ2xhc3MoXCJ0eXAtc2VhcmNoYWJsZVwiKTtcbiAgICBlbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoZWwuaGFzQ2xhc3MoXCJpcy1iZWluZy1yZW5hbWVkXCIpKSByZXR1cm47XG4gICAgICBpZiAoc3RvcFByb3BhZ2F0aW9uKSBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIG9uU2VhcmNoKCk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBzdWJ0eXBLZXkgPT09IG51bGwgbWVhbnMgbm90ZXMgb2YgdGhpcyBUWVAgd2l0aG91dCBTVUJUWVAuIEEgbGlzdCBoYXMgbm9cbiAgLy8gZXhhY3Qgc2VhcmNoIHN5bnRheCAoYXMgaW4gb3BlblNlYXJjaCgpKSwgc28gaXQgc2VhcmNoZXMgbm90ZXMgY2FycnlpbmcgYWxsXG4gIC8vIGl0cyBpdGVtcy5cbiAgb3BlblN1YnR5cFNlYXJjaCh0eXAsIHN1YnR5cEtleSkge1xuICAgIGNvbnN0IGdsb2JhbFNlYXJjaCA9IHRoaXMucGx1Z2luLmFwcC5pbnRlcm5hbFBsdWdpbnMuZ2V0UGx1Z2luQnlJZChcImdsb2JhbC1zZWFyY2hcIik7XG4gICAgaWYgKCFnbG9iYWxTZWFyY2gpIHJldHVybjtcbiAgICBjb25zdCB0eXBDbGF1c2UgPSB0aGlzLnR5cENsYXVzZSh0eXApO1xuICAgIGxldCBzdWJ0eXBDbGF1c2U7XG4gICAgaWYgKHN1YnR5cEtleSA9PT0gbnVsbCkge1xuICAgICAgc3VidHlwQ2xhdXNlID0gYC1bXCIke1NVQlRZUF9QUk9QRVJUWX1cIl1gO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCByYXcgPSB0aGlzLnBsdWdpbi50eXBJbmRleC5zdWJ0eXBCdWNrZXQodHlwKS5yYXdCeUtleS5nZXQoc3VidHlwS2V5KTtcbiAgICAgIHN1YnR5cENsYXVzZSA9IEFycmF5LmlzQXJyYXkocmF3KVxuICAgICAgICA/IHJhdy5tYXAoKHYpID0+IGBbXCIke1NVQlRZUF9QUk9QRVJUWX1cIjpcIiR7U3RyaW5nKHYgPz8gXCJcIikudHJpbSgpfVwiXWApLmpvaW4oXCIgXCIpXG4gICAgICAgIDogYFtcIiR7U1VCVFlQX1BST1BFUlRZfVwiOlwiJHtzdWJ0eXBLZXl9XCJdYDtcbiAgICB9XG4gICAgZ2xvYmFsU2VhcmNoLmluc3RhbmNlLm9wZW5HbG9iYWxTZWFyY2goYCR7dHlwQ2xhdXNlfSAke3N1YnR5cENsYXVzZX1gKTtcbiAgfVxuXG4gIC8vIExpa2UgcmVnaXN0ZXJUeXAoKTogcmVnaXN0ZXJzIHRoZSBjbGVhbmVkIGZvcm0gKHRpdGxlIGNhc2UsIGEgbGlzdCBhcyBvbmVcbiAgLy8gdmFsdWUgXCJBLCBCXCIpIGFzIGEgU3VidHlwIG9mIHRoaXMgVFlQIGFuZCByZXdyaXRlcyB0aGUgU1VCVFlQIG9mIHRoZVxuICAvLyBhZmZlY3RlZCBub3Rlcy4gSWYgdGhlIFN1YnR5cCBleGlzdHMgaW4gYW5vdGhlciBzcGVsbGluZywgdGhlIG5vdGVzIGdvXG4gIC8vIHRoZXJlLlxuICBhc3luYyByZWdpc3RlclN1YnR5cCh0eXAsIHN1YnR5cEtleSwgYnVja2V0KSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5hcHBseVN1YnR5cFJlZ2lzdHJhdGlvbih0eXAsIHN1YnR5cEtleSwgYnVja2V0KTtcbiAgICBpZiAoIXJlc3VsdCkgcmV0dXJuO1xuXG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgaWYgKHJlc3VsdC5yZW5hbWVkID4gMCkgbmV3IE5vdGljZShgU3VidHlwICR7cmVzdWx0LnN1YnR5cH0gcmVnaXN0ZXJlZCwgJHtwbHVyYWwocmVzdWx0LnJlbmFtZWQsIFwibm90ZVwiKX0gdXBkYXRlZC5gKTtcbiAgfVxuXG4gIC8vIExpa2UgYXBwbHlUeXBSZWdpc3RyYXRpb246IHRoZSBjb3JlIHdpdGhvdXQgc2F2aW5nIGFuZCBub3RpY2UsIHNvXG4gIC8vIHJlZ2lzdGVyVHlwV2l0aFN1YnR5cCgpIGNhbiBidW5kbGUgaXQuIFJldHVybnMgeyBzdWJ0eXAsIHJlbmFtZWQgfSBvciBudWxsLlxuICBhc3luYyBhcHBseVN1YnR5cFJlZ2lzdHJhdGlvbih0eXAsIHN1YnR5cEtleSwgYnVja2V0KSB7XG4gICAgY29uc3QgcmF3ID0gYnVja2V0LnJhd0J5S2V5LmdldChzdWJ0eXBLZXkpO1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVSYXdUeXAocmF3ID09PSB1bmRlZmluZWQgPyBzdWJ0eXBLZXkgOiByYXcsIG5vcm1hbGl6ZVN1YnR5cE5hbWUpO1xuICAgIGlmICghbm9ybWFsaXplZCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgZXhpc3RpbmcgPSBnZXRTdWJ0eXBOYW1lcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwKS5maW5kKChuYW1lKSA9PiBuYW1lLnRvTG93ZXJDYXNlKCkgPT09IG5vcm1hbGl6ZWQudG9Mb3dlckNhc2UoKSk7XG4gICAgY29uc3Qgc3VidHlwID0gZXhpc3RpbmcgPz8gbm9ybWFsaXplZDtcbiAgICBlbnN1cmVTdWJ0eXAodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKTtcblxuICAgIGNvbnN0IHJlbmFtZWQgPSBzdWJ0eXAgIT09IHN1YnR5cEtleSA/IGF3YWl0IHJlbmFtZVN1YnR5cEluTm90ZXModGhpcy5wbHVnaW4sIHR5cCwgc3VidHlwS2V5LCBzdWJ0eXApIDogMDtcbiAgICByZXR1cm4geyBzdWJ0eXAsIHJlbmFtZWQgfTtcbiAgfVxuXG4gIC8vIEEgbmV3LCBlbXB0eSBTdWJ0eXAgYmxvY2sgcmlnaHQgYWJvdmUgdGhlIFwiQWRkIFN1YnR5cFwiIGJ1dHRvbiwgaXRzIG5hbWVcbiAgLy8gdHlwZWQgaW5saW5lIChsaWtlIHN0YXJ0QWRkKCkgaW4gdGhlIGxpc3QpLlxuICBzdGFydEFkZFN1YnR5cCh0eXApIHtcbiAgICBpZiAodGhpcy5pc0VkaXRpbmcgfHwgIXRoaXMuc3VidHlwQWRkQnRuRWwpIHJldHVybjtcbiAgICB0aGlzLmlzRWRpdGluZyA9IHRydWU7XG5cbiAgICAvLyBCdWlsdCBsaWtlIHRoZSBmaW5pc2hlZCAoZW1wdHkpIGJsb2NrLCB3aXRoIHRoZSBcIitcIiBidXR0b25zIGFuZCBmb290ZXJcbiAgICAvLyBhY3Rpb25zIHRoYXQgZG8gbm90aGluZyB5ZXQsIGp1c3Qgd2l0aG91dCBhIGNvdW50IC0gc28gbm90aGluZyBqdW1wc1xuICAgIC8vIHdoZW4gdGhlIGlucHV0IGlzIGRvbmUgKHNlZSAudHlwLXN1YnR5cC1wZW5kaW5nKS5cbiAgICBjb25zdCBibG9jayA9IGNyZWF0ZURpdih7IGNsczogXCJ0eXAtZnJvbnRtYXR0ZXItYmxvY2sgdHlwLXN1YnR5cC1ibG9jayB0eXAtc3VidHlwLXBlbmRpbmdcIiB9KTtcbiAgICB0aGlzLnN1YnR5cEFkZEJ0bkVsLnBhcmVudEVsZW1lbnQuaW5zZXJ0QmVmb3JlKGJsb2NrLCB0aGlzLnN1YnR5cEFkZEJ0bkVsKTtcbiAgICBjb25zdCBoZWFkZXIgPSBibG9jay5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLWhlYWRlclwiIH0pO1xuICAgIGNvbnN0IHRpdGxlR3JvdXAgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci10aXRsZS1ncm91cFwiIH0pO1xuICAgIGNvbnN0IG5hbWVFbCA9IHRpdGxlR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1kZXRhaWwtc2VjdGlvbi10aXRsZSB0eXAtc3VidHlwLW5hbWUtaW5wdXQgaXMtYmVpbmctcmVuYW1lZFwiIH0pO1xuICAgIGNvbnN0IGFkZEJ1dHRvbnMgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci1hZGQtZ3JvdXBcIiB9KTtcbiAgICBzZXRJY29uKGFkZEJ1dHRvbnMuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1mcm9udG1hdHRlci1hZGQtZmxvYXRpbmdcIiB9KSwgXCJwbHVzXCIpO1xuICAgIHNldEljb24oYWRkQnV0dG9ucy5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWZyb250bWF0dGVyLWFkZFwiIH0pLCBcInBsdXNcIik7XG4gICAgY29uc3QgZm9vdGVyID0gYmxvY2suY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zZWN0aW9uLWZvb3RlciB0eXAtc3VidHlwLWFjdGlvbnNcIiB9KTtcbiAgICBjb25zdCBjb2xvckdyb3VwID0gZm9vdGVyLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtc3VidHlwLWNvbG9yLWdyb3VwXCIgfSk7XG4gICAgcGFpbnRDb2xvckRvdChjb2xvckdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtc3VidHlwLWNvbG9yLWRvdFwiIH0pLCB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdHlwXSA/PyBERUZBVUxUX1RZUF9DT0xPUiwgdHJ1ZSk7XG4gICAgc2V0SWNvbihjb2xvckdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtY29sb3ItcmVzZXQgaXMtZGlzYWJsZWRcIiB9KSwgXCJyb3RhdGUtY2N3XCIpO1xuICAgIGNvbnN0IGFjdGlvbnMgPSBmb290ZXIuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zdWJ0eXAtYWN0aW9uLWdyb3VwXCIgfSk7XG4gICAgc2V0SWNvbihhY3Rpb25zLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtZGV0YWlsLXJlbmFtZS1ub3Rlc1wiIH0pLCBcInBlbmNpbFwiKTtcbiAgICBzZXRJY29uKGFjdGlvbnMuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1kZXRhaWwtcmVuYW1lXCIgfSksIFwicGVuY2lsXCIpO1xuICAgIC8vIFRoZSBzdGF0ZSBlbnN1cmVTdWJ0eXAgd2lsbCBnaXZlIHRoZSBuZXcgU3VidHlwOiB0aGF0IG9mIGl0cyBUWVAuXG4gICAgY29uc3QgbWFudWFsQ2xzID0gXCJjbGlja2FibGUtaWNvbiB0eXAtbWFudWFsLWljb25cIiArICh0aGlzLmVuc3VyZVR5cE1hbnVhbCgpW3R5cF0gIT09IGZhbHNlID8gXCIgaXMtYWN0aXZlXCIgOiBcIlwiKTtcbiAgICBzZXRJY29uKGFjdGlvbnMuY3JlYXRlRGl2KHsgY2xzOiBtYW51YWxDbHMgfSksIFwiZmlsZS1wZW4tbGluZVwiKTtcbiAgICBzZXRJY29uKGFjdGlvbnMuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1kZXRhaWwtZGVsZXRlXCIgfSksIFwidHJhc2hcIik7XG4gICAgbmFtZUVsLnNldEF0dHJpYnV0ZShcImNvbnRlbnRlZGl0YWJsZVwiLCBcInRydWVcIik7XG4gICAgbmFtZUVsLnNldEF0dHJpYnV0ZShcInNwZWxsY2hlY2tcIiwgXCJmYWxzZVwiKTtcbiAgICBuYW1lRWwuZm9jdXMoKTtcblxuICAgIGxldCBkb25lID0gZmFsc2U7XG4gICAgY29uc3QgZmluaXNoID0gYXN5bmMgKGNvbW1pdCkgPT4ge1xuICAgICAgaWYgKGRvbmUpIHJldHVybjtcbiAgICAgIGRvbmUgPSB0cnVlO1xuICAgICAgdGhpcy5pc0VkaXRpbmcgPSBmYWxzZTtcblxuICAgICAgY29uc3QgdmFsdWUgPSBub3JtYWxpemVTdWJ0eXBOYW1lKG5hbWVFbC50ZXh0Q29udGVudCk7XG4gICAgICBpZiAoY29tbWl0ICYmIHZhbHVlKSB7XG4gICAgICAgIGNvbnN0IGV4aXN0aW5nID0gZ2V0U3VidHlwTmFtZXModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCkuZmluZCgobmFtZSkgPT4gbmFtZS50b0xvd2VyQ2FzZSgpID09PSB2YWx1ZS50b0xvd2VyQ2FzZSgpKTtcbiAgICAgICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICAgICAgbmV3IE5vdGljZShgJHt0eXB9IGFscmVhZHkgaGFzIFN1YnR5cCAke2V4aXN0aW5nfS5gKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBlbnN1cmVTdWJ0eXAodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgdmFsdWUpO1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICB0aGlzLnJlbmRlcigpO1xuICAgIH07XG5cbiAgICBuYW1lRWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVudGVyXCIpIHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgIGZpbmlzaCh0cnVlKTtcbiAgICAgIH0gZWxzZSBpZiAoZXZlbnQua2V5ID09PSBcIkVzY2FwZVwiKSB7XG4gICAgICAgIC8vIHN0b3BQcm9wYWdhdGlvbiwgb3IgdGhlIGRldGFpbCB2aWV3J3Mgb3duIEVzY2FwZSBoYW5kbGVyIHdvdWxkIGxlYXZlXG4gICAgICAgIC8vIGl0IGFzIHdlbGwuXG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICBmaW5pc2goZmFsc2UpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIG5hbWVFbC5hZGRFdmVudExpc3RlbmVyKFwiYmx1clwiLCAoKSA9PiBmaW5pc2godHJ1ZSkpO1xuICB9XG5cbiAgLy8gTm90ZXMga2VlcCB0aGVpciBUWVAgKGl0IHRoZW4gc2hvd3MgYXMgdW5yZWdpc3RlcmVkKSwgc28gdGhpcyBvbmx5IGNoYW5nZXNcbiAgLy8gc2V0dGluZ3M6IFVuZG8gYWZ0ZXJ3YXJkcywgYW5kIHRoZSBjb25maXJtYXRpb24gY2FuIGJlIHN3aXRjaGVkIG9mZiAoc2VlXG4gIC8vIGNvbmZpcm1EZWxldGlvbikuXG4gIHNob3dEZWxldGVDb25maXJtKHR5cCkge1xuICAgIGNvbnN0IGFwcGx5ID0gYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgc25hcHNob3QgPSBzbmFwc2hvdFNldHRpbmdzKHRoaXMucGx1Z2luKTtcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cHMgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBzLmZpbHRlcigodCkgPT4gdCAhPT0gdHlwKTtcbiAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdHlwXTtcbiAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBEZXNjcmlwdGlvbnNbdHlwXTtcbiAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwXTtcbiAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBGbG9hdGluZ0tleXNbdHlwXTtcbiAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBTaG9ydGN1dHNbdHlwXTtcbiAgICAgIGRlbGV0ZSB0aGlzLmVuc3VyZVR5cE1hbnVhbCgpW3R5cF07XG4gICAgICBkZWxldGVUeXBTdWJ0eXBzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXApO1xuICAgICAgLy8gQmFjayB0byB0aGUgbGlzdCBiZWZvcmUgcmVmcmVzaFR5cENvbG9ycygpLCB3aGljaCByZS1yZW5kZXJzXG4gICAgICAvLyBzeW5jaHJvbm91c2x5IC0gb3RoZXJ3aXNlIHRoZSBkZWxldGVkIFRZUCdzIG5vdyBlbXB0eSBkZXRhaWwgdmlld1xuICAgICAgLy8gd291bGQgYnJpZWZseSByZW5kZXIgYWdhaW4uXG4gICAgICB0aGlzLmNsb3NlVHlwU2V0dGluZ3MoKTtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgb2ZmZXJVbmRvKHRoaXMucGx1Z2luLCBgVFlQICR7dHlwfSBkZWxldGVkLmAsIHNuYXBzaG90KTtcbiAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgIH07XG4gICAgdGhpcy5jb25maXJtRGVsZXRpb24oXG4gICAgICB7IHRpdGxlOiBbXCJEZWxldGUgXCIsIHR5cE5hbWVOb2RlKHRoaXMucGx1Z2luLCB0eXAsIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdID8/IG51bGwpLCBcIj9cIl0gfSxcbiAgICAgIGFwcGx5XG4gICAgKTtcbiAgfVxuXG4gIC8vIExpa2Ugc3RhcnRFZGl0aW5nKCksIGJ1dCBvbiB0aGUgZGV0YWlsIHZpZXcncyB0aXRsZSwgc3dpdGNoaW5nXG4gIC8vIHNlbGVjdGVkVHlwIGluc3RlYWQgb2YganVzdCByZS1yZW5kZXJpbmcgdGhlIGxpc3QuIHVwZGF0ZU5vdGVzOiB0cnVlICh0aGVcbiAgLy8gaGlnaGxpZ2h0ZWQgYnV0dG9uKSBhbHNvIHJld3JpdGVzIHRoZSBUWVAgb2YgZXZlcnkgYWZmZWN0ZWQgbm90ZSBhZnRlclxuICAvLyBjb25maXJtYXRpb24gKHNlZSByZW5hbWVUeXBJbk5vdGVzKSBpbnN0ZWFkIG9mIG9ubHkgdGhlIHNldHRpbmdzLlxuICBzdGFydERldGFpbFJlbmFtZSh0eXAsIHRpdGxlRWwsIHsgdXBkYXRlTm90ZXMgPSBmYWxzZSB9ID0ge30pIHtcbiAgICBpZiAodGhpcy5pc0VkaXRpbmcpIHJldHVybjtcbiAgICB0aGlzLmlzRWRpdGluZyA9IHRydWU7XG5cbiAgICB0aXRsZUVsLmFkZENsYXNzKFwiaXMtYmVpbmctcmVuYW1lZFwiKTtcbiAgICB0aXRsZUVsLnNldEF0dHJpYnV0ZShcImNvbnRlbnRlZGl0YWJsZVwiLCBcInRydWVcIik7XG4gICAgdGl0bGVFbC5zZXRBdHRyaWJ1dGUoXCJzcGVsbGNoZWNrXCIsIFwiZmFsc2VcIik7XG4gICAgdGl0bGVFbC5mb2N1cygpO1xuXG4gICAgY29uc3QgcmFuZ2UgPSB0aXRsZUVsLmRvYy5jcmVhdGVSYW5nZSgpO1xuICAgIHJhbmdlLnNlbGVjdE5vZGVDb250ZW50cyh0aXRsZUVsKTtcbiAgICBjb25zdCBzZWxlY3Rpb24gPSB0aXRsZUVsLndpbi5nZXRTZWxlY3Rpb24oKTtcbiAgICBzZWxlY3Rpb24ucmVtb3ZlQWxsUmFuZ2VzKCk7XG4gICAgc2VsZWN0aW9uLmFkZFJhbmdlKHJhbmdlKTtcblxuICAgIC8vIE1vdmVzIG9ubHkgdGhlIHNldHRpbmdzIChsaXN0LCBjb2xvciwgZGVzY3JpcHRpb24sIFRZUC1Gcm9udG1hdHRlcixcbiAgICAvLyBtYW51YWwgdG9nZ2xlKSB0byB0aGUgbmV3IG5hbWUgLSB0b3VjaGVzIG5vIG5vdGVzLiBTaGFyZWQgYnkgYm90aCByZW5hbWVcbiAgICAvLyBwYXRocy5cbiAgICBjb25zdCBhcHBseVJlbmFtZSA9IGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgY29uc3QgaWR4ID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwcy5pbmRleE9mKHR5cCk7XG4gICAgICBpZiAoaWR4ICE9PSAtMSkgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwc1tpZHhdID0gdmFsdWU7XG4gICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF07XG4gICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdHlwXTtcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBEZXNjcmlwdGlvbnNbdHlwXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlc2NyaXB0aW9uc1t2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBEZXNjcmlwdGlvbnNbdHlwXTtcbiAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlc2NyaXB0aW9uc1t0eXBdO1xuICAgICAgfVxuICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlZmF1bHRGcm9udG1hdHRlclt0eXBdICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRGVmYXVsdEZyb250bWF0dGVyW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlZmF1bHRGcm9udG1hdHRlclt0eXBdO1xuICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRGVmYXVsdEZyb250bWF0dGVyW3R5cF07XG4gICAgICB9XG4gICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRmxvYXRpbmdLZXlzW3R5cF0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBGbG9hdGluZ0tleXNbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRmxvYXRpbmdLZXlzW3R5cF07XG4gICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBGbG9hdGluZ0tleXNbdHlwXTtcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBTaG9ydGN1dHNbdHlwXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cFNob3J0Y3V0c1t2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBTaG9ydGN1dHNbdHlwXTtcbiAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cFNob3J0Y3V0c1t0eXBdO1xuICAgICAgfVxuICAgICAgaWYgKHRoaXMuZW5zdXJlVHlwTWFudWFsKClbdHlwXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cE1hbnVhbFt2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBNYW51YWxbdHlwXTtcbiAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cE1hbnVhbFt0eXBdO1xuICAgICAgfVxuICAgICAgbW92ZVR5cFN1YnR5cHModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgdmFsdWUpO1xuICAgICAgLy8gU2V0IGJlZm9yZSByZWZyZXNoVHlwQ29sb3JzKCksIHdoaWNoIGNhbGxzIHJlbmRlcigpIHN5bmNocm9ub3VzbHkgLVxuICAgICAgLy8gb3RoZXJ3aXNlIHRoZSBvbGQsIG5vdyBlbXB0eSBuYW1lIHdvdWxkIGJyaWVmbHkgcmVuZGVyLlxuICAgICAgdGhpcy5zZWxlY3RlZFR5cCA9IHZhbHVlO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICB9O1xuXG4gICAgbGV0IGRvbmUgPSBmYWxzZTtcbiAgICBjb25zdCBmaW5pc2ggPSBhc3luYyAoY29tbWl0KSA9PiB7XG4gICAgICBpZiAoZG9uZSkgcmV0dXJuO1xuICAgICAgZG9uZSA9IHRydWU7XG4gICAgICB0aGlzLmlzRWRpdGluZyA9IGZhbHNlO1xuXG4gICAgICBjb25zdCB2YWx1ZSA9IG5vcm1hbGl6ZVR5cE5hbWUodGl0bGVFbC50ZXh0Q29udGVudCk7XG4gICAgICBpZiAoIWNvbW1pdCB8fCAhdmFsdWUgfHwgdmFsdWUgPT09IHR5cCkge1xuICAgICAgICB0aGlzLnJlbmRlcigpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwcy5maW5kKFxuICAgICAgICAodCkgPT4gdC50b0xvd2VyQ2FzZSgpID09PSB2YWx1ZS50b0xvd2VyQ2FzZSgpICYmIHQgIT09IHR5cFxuICAgICAgKTtcbiAgICAgIGlmIChleGlzdGluZykge1xuICAgICAgICB0aGlzLnNob3dNZXJnZUNvbmZpcm0odHlwLCBleGlzdGluZyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKCF1cGRhdGVOb3Rlcykge1xuICAgICAgICBhd2FpdCBhcHBseVJlbmFtZSh2YWx1ZSk7XG4gICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgLy8gQSBidWxrIHdyaXRlIGFjcm9zcyBwb3NzaWJseSBtYW55IGZpbGVzIC0gY29uZmlybSBmaXJzdC4gU2FtZSBjb2xvclxuICAgICAgLy8gZm9yIG9sZCBhbmQgbmV3IG5hbWU6IHRoZSBuZXcgb25lIGhhcyBubyB0eXBDb2xvcnMgZW50cnkgeWV0IGJ1dCB0YWtlc1xuICAgICAgLy8gb3ZlciB0aGUgb2xkIG9uZSdzIChzZWUgYXBwbHlSZW5hbWUpLlxuICAgICAgY29uc3QgeyBjb3VudHMgfSA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnR5cENvdW50cygpO1xuICAgICAgY29uc3QgY29sb3IgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdHlwXSA/PyBudWxsO1xuICAgICAgbmV3IENvbmZpcm1Nb2RhbCh0aGlzLmFwcCwge1xuICAgICAgICB0aXRsZTogW1wiUmVuYW1lIFwiLCB0eXBOYW1lTm9kZSh0aGlzLnBsdWdpbiwgdHlwLCBjb2xvciksIFwiIHRvIFwiLCB0eXBOYW1lTm9kZSh0aGlzLnBsdWdpbiwgdmFsdWUsIGNvbG9yKSwgXCI/XCJdLFxuICAgICAgICBib2R5OiBbYCR7cGx1cmFsKGNvdW50cy5nZXQodHlwKSA/PyAwLCBcIm5vdGVcIil9IHdpbGwgYmUgdXBkYXRlZC5gXSxcbiAgICAgICAgY29uZmlybVRleHQ6IFwiUmVuYW1lXCIsXG4gICAgICAgIGZvY3VzOiBcImNvbmZpcm1cIixcbiAgICAgICAgb25Db25maXJtOiBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYXdhaXQgYXBwbHlSZW5hbWUodmFsdWUpO1xuICAgICAgICAgIGNvbnN0IHJlbmFtZWQgPSBhd2FpdCByZW5hbWVUeXBJbk5vdGVzKHRoaXMucGx1Z2luLCB0eXAsIHZhbHVlKTtcbiAgICAgICAgICBuZXcgTm90aWNlKGBUWVAgJHt2YWx1ZX06ICR7cGx1cmFsKHJlbmFtZWQsIFwibm90ZVwiKX0gdXBkYXRlZC5gKTtcbiAgICAgICAgICB0aGlzLnJlbmRlcigpO1xuICAgICAgICB9LFxuICAgICAgICBvbkNhbmNlbDogKCkgPT4gdGhpcy5yZW5kZXIoKSxcbiAgICAgIH0pLm9wZW4oKTtcbiAgICB9O1xuXG4gICAgdGl0bGVFbC5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRW50ZXJcIikge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgZmluaXNoKHRydWUpO1xuICAgICAgfSBlbHNlIGlmIChldmVudC5rZXkgPT09IFwiRXNjYXBlXCIpIHtcbiAgICAgICAgLy8gc3RvcFByb3BhZ2F0aW9uLCBvciB0aGUgZGV0YWlsIHZpZXcncyBFc2NhcGUgaGFuZGxlciB3b3VsZCBsZWF2ZSBpdFxuICAgICAgICAvLyBhcyB3ZWxsLlxuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgZmluaXNoKGZhbHNlKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHRpdGxlRWwuYWRkRXZlbnRMaXN0ZW5lcihcImJsdXJcIiwgKCkgPT4gZmluaXNoKHRydWUpKTtcbiAgfVxuXG4gIC8vIFJlbmFtaW5nIHRvIHRoZSBuYW1lIG9mIGFuIGFscmVhZHkgcmVnaXN0ZXJlZCBUWVAgKHNlZSBzdGFydERldGFpbFJlbmFtZSlcbiAgLy8gb2ZmZXJzIHRvIG1lcmdlIGJvdGggKHNlZSBtZXJnZVR5cCkgaW5zdGVhZCBvZiBzaWxlbnRseSBkcm9wcGluZyB0aGVcbiAgLy8gcmVuYW1lLiBJdCBhbHdheXMgcmV3cml0ZXMgdGhlIG5vdGVzLCB3aGljaGV2ZXIgcmVuYW1lIGJ1dHRvbiBzdGFydGVkIGl0OlxuICAvLyBhIG1lcmdlIGluIHRoZSBzZXR0aW5ncyBvbmx5IHdvdWxkIGxlYXZlIHRoZSBzb3VyY2UgVFlQJ3Mgbm90ZXMgYXMgYW5cbiAgLy8gdW5yZWdpc3RlcmVkIGVudHJ5LlxuICBzaG93TWVyZ2VDb25maXJtKHNvdXJjZSwgdGFyZ2V0KSB7XG4gICAgY29uc3QgeyBzZXR0aW5ncyB9ID0gdGhpcy5wbHVnaW47XG4gICAgY29uc3QgY291bnQgPSB0aGlzLnBsdWdpbi50eXBJbmRleC50eXBDb3VudHMoKS5jb3VudHMuZ2V0KHNvdXJjZSkgPz8gMDtcbiAgICBuZXcgQ29uZmlybU1vZGFsKHRoaXMuYXBwLCB7XG4gICAgICB0aXRsZTogW1xuICAgICAgICBcIk1lcmdlIFwiLFxuICAgICAgICB0eXBOYW1lTm9kZSh0aGlzLnBsdWdpbiwgc291cmNlLCBzZXR0aW5ncy50eXBDb2xvcnNbc291cmNlXSA/PyBudWxsKSxcbiAgICAgICAgXCIgaW50byBcIixcbiAgICAgICAgdHlwTmFtZU5vZGUodGhpcy5wbHVnaW4sIHRhcmdldCwgc2V0dGluZ3MudHlwQ29sb3JzW3RhcmdldF0gPz8gbnVsbCksXG4gICAgICAgIFwiP1wiLFxuICAgICAgXSxcbiAgICAgIGJvZHk6IFtcbiAgICAgICAgYCR7dGFyZ2V0fSBhbHJlYWR5IGV4aXN0cy4gJHtwbHVyYWwoY291bnQsIFwibm90ZVwiKX0gJHtjb3VudCA9PT0gMSA/IFwibW92ZXNcIiA6IFwibW92ZVwifSB0byBpdC4gYCArXG4gICAgICAgICAgYFRoZSBjb2xvciwgZGVzY3JpcHRpb24gYW5kIFRZUC1Gcm9udG1hdHRlciBvZiAke3NvdXJjZX0gYXJlIGRyb3BwZWQuIGAgK1xuICAgICAgICAgIGBFdmVyeSBTdWJ0eXAgbW92ZXMgYWxvbmc7IGJsb2NrcyB3aXRoIHRoZSBzYW1lIG5hbWUgYXJlIG1lcmdlZC5gLFxuICAgICAgXSxcbiAgICAgIGNvbmZpcm1UZXh0OiBcIk1lcmdlXCIsXG4gICAgICB3YXJuaW5nOiB0cnVlLFxuICAgICAgZm9jdXM6IFwiY2FuY2VsXCIsXG4gICAgICBvbkNvbmZpcm06ICgpID0+IHRoaXMubWVyZ2VUeXAoc291cmNlLCB0YXJnZXQpLFxuICAgICAgb25DYW5jZWw6ICgpID0+IHRoaXMucmVuZGVyKCksXG4gICAgfSkub3BlbigpO1xuICB9XG5cbiAgLy8gTWVyZ2VzIHNvdXJjZSBpbnRvIHRhcmdldDogbm90ZXMgYXJlIHJld3JpdHRlbiB0byB0YXJnZXQsIHNvdXJjZSBsZWF2ZXNcbiAgLy8gdGhlIGxpc3Qgd2l0aCBpdHMgc2V0dGluZ3MgKHRhcmdldCBrZWVwcyBpdHMgb3duKS4gU291cmNlJ3MgU3VidHlwcyBtb3ZlXG4gIC8vIG92ZXIsIHNhbWUtbmFtZWQgYmxvY2tzIGFyZSBjb21iaW5lZCAoc2VlIG1lcmdlVHlwU3VidHlwcyBpbiBzdWJ0eXBzLmpzKS5cbiAgLy9cbiAgLy8gXCJNYW51YWxseSBjcmVhdGFibGVcIiBpcyB3aGVyZSBhIG1lcmdlIGRvZXMgbW9yZSB0aGFuIG1vdmUgZGF0YTogdGhlIG1vdmVkXG4gIC8vIFN1YnR5cHMgYnJpbmcgc291cmNlJ3MgdG9nZ2xlcyBidXQgZW5kIHVwIHVuZGVyIHRhcmdldCdzLiBXaXRoIHNvdXJjZSBvblxuICAvLyBhbmQgdGFyZ2V0IG9mZiB0aGV5IHdvdWxkIGJlIHN3aXRjaGVkLW9uIFN1YnR5cHMgdW5kZXIgYSBzd2l0Y2hlZC1vZmYgVFlQLFxuICAvLyB1bnJlYWNoYWJsZSBpbiB0aGUgcGlja2VyLiBTbyBhIHN3aXRjaGVkLW9mZiB0YXJnZXQgc3dpdGNoZXMgdGhlbSBvZmYgdG9vLFxuICAvLyBhcyBpdHMgb3duIGJ1dHRvbiB3b3VsZCAoc2VlIHJlbmRlck1hbnVhbFRvZ2dsZSkuIFdpdGggdGFyZ2V0IG9uIHRoZXkgc3RheVxuICAvLyBhcyB0aGV5IHdlcmUuXG4gIGFzeW5jIG1lcmdlVHlwKHNvdXJjZSwgdGFyZ2V0KSB7XG4gICAgY29uc3Qgc2V0dGluZ3MgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncztcbiAgICBjb25zdCByZW5hbWVkID0gYXdhaXQgcmVuYW1lVHlwSW5Ob3Rlcyh0aGlzLnBsdWdpbiwgc291cmNlLCB0YXJnZXQpO1xuXG4gICAgc2V0dGluZ3MudHlwcyA9IHNldHRpbmdzLnR5cHMuZmlsdGVyKCh0KSA9PiB0ICE9PSBzb3VyY2UpO1xuICAgIGRlbGV0ZSBzZXR0aW5ncy50eXBDb2xvcnNbc291cmNlXTtcbiAgICBkZWxldGUgc2V0dGluZ3MudHlwRGVzY3JpcHRpb25zW3NvdXJjZV07XG4gICAgZGVsZXRlIHNldHRpbmdzLnR5cERlZmF1bHRGcm9udG1hdHRlcltzb3VyY2VdO1xuICAgIGRlbGV0ZSBzZXR0aW5ncy50eXBGbG9hdGluZ0tleXNbc291cmNlXTtcbiAgICBkZWxldGUgc2V0dGluZ3MudHlwU2hvcnRjdXRzW3NvdXJjZV07XG4gICAgZGVsZXRlIHRoaXMuZW5zdXJlVHlwTWFudWFsKClbc291cmNlXTtcbiAgICBtZXJnZVR5cFN1YnR5cHMoc2V0dGluZ3MsIHNvdXJjZSwgdGFyZ2V0KTtcbiAgICBpZiAodGhpcy5lbnN1cmVUeXBNYW51YWwoKVt0YXJnZXRdID09PSBmYWxzZSkgc2V0QWxsU3VidHlwc01hbnVhbChzZXR0aW5ncywgdGFyZ2V0LCBmYWxzZSk7XG5cbiAgICAvLyBTZXQgYmVmb3JlIHJlZnJlc2hUeXBDb2xvcnMoKSwgYXMgaW4gYXBwbHlSZW5hbWUuXG4gICAgdGhpcy5zZWxlY3RlZFR5cCA9IHRhcmdldDtcbiAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICBuZXcgTm90aWNlKGBUWVAgJHtzb3VyY2V9IG1lcmdlZCBpbnRvICR7dGFyZ2V0fSwgJHtwbHVyYWwocmVuYW1lZCwgXCJub3RlXCIpfSB1cGRhdGVkLmApO1xuICAgIHRoaXMucmVuZGVyKCk7XG4gIH1cblxuICByZW5kZXJDb3VudEZsYWlyKHNlbGYsIGNvdW50KSB7XG4gICAgY29uc3QgZmxhaXJPdXRlciA9IHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1mbGFpci1vdXRlclwiIH0pO1xuICAgIGZsYWlyT3V0ZXIuY3JlYXRlU3Bhbih7IGNsczogXCJ0cmVlLWl0ZW0tZmxhaXJcIiwgdGV4dDogU3RyaW5nKGNvdW50KSB9KTtcbiAgfVxuXG4gIC8vIEV4cGxhaW5zIHRoZSBmbG9hdGluZyB0b2dnbGUgKHJpZ2h0LWNsaWNrIG9uIGEgcHJvcGVydHkgYWJvdmUsIHNlZVxuICAvLyBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaCkuIE5vIGhlYWRpbmcgLSByaWdodCBiZWxvdyB0aGUgbGlzdCBpdCBpcyBjbGVhclxuICAvLyB3aGF0IGl0IHJlZmVycyB0by5cbiAgcmVuZGVyRmxvYXRpbmdIaW50KHBhcmVudCkge1xuICAgIGNvbnN0IHNlY3Rpb24gPSBwYXJlbnQuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mbG9hdGluZy1oaW50LXNlY3Rpb25cIiB9KTtcbiAgICBzZWN0aW9uLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwidHlwLWZsb2F0aW5nLWhpbnRcIixcbiAgICAgIHRleHQ6IFwiUmlnaHQtY2xpY2sgYSBwcm9wZXJ0eSB0byBtYWtlIGl0IGZsb2F0aW5nLlwiLFxuICAgIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyVHlwUGFuZShwbHVnaW4pIHtcbiAgcGx1Z2luLnJlZ2lzdGVyVmlldyhWSUVXX1RZUEVfVFlQX1BBTkUsIChsZWFmKSA9PiBuZXcgVHlwUGFuZShsZWFmLCBwbHVnaW4pKTtcblxuICBwbHVnaW4uYWRkQ29tbWFuZCh7XG4gICAgaWQ6IFwib3Blbi10eXAtcGFuZVwiLFxuICAgIG5hbWU6IFwiT3BlbiBUWVAtUGFuZVwiLFxuICAgIGNhbGxiYWNrOiAoKSA9PiBhY3RpdmF0ZVR5cFBhbmUocGx1Z2luKSxcbiAgfSk7XG5cbiAgcGx1Z2luLmFkZENvbW1hbmQoe1xuICAgIGlkOiBcImFkZC10eXAtcHJvcGVydHlcIixcbiAgICBuYW1lOiBcIkFkZCBUWVAtRnJvbnRtYXR0ZXIgcHJvcGVydHlcIixcbiAgICBjYWxsYmFjazogKCkgPT4gYWRkVHlwUHJvcGVydHlDb21tYW5kKHBsdWdpbiksXG4gIH0pO1xuXG4gIC8vIE9uIGhvdCByZWxvYWQgdGhlIG9sZCBsZWFmIG9iamVjdCBzdXJ2aXZlcyAob25seSBvdXIgbW9kdWxlIHJlbG9hZHMpLCBidXRcbiAgLy8gXCJpbnN0YW5jZW9mIFR5cFBhbmVcIiBmYWlscyBhZ2FpbnN0IHRoZSByZWxvYWRlZCBjbGFzcywgYW5kIGdldFZpZXdUeXBlKClcbiAgLy8gY29tZXMgZnJvbSBsZWFmLnZpZXcgYWxvbmUuIGBhcHBgIHN1cnZpdmVzIHVuY2hhbmdlZCwgc28gdGhlIGxlYWZcbiAgLy8gcmVmZXJlbmNlIGlzIGtlcHQgdGhlcmUuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4gYWN0aXZhdGVUeXBQYW5lKHBsdWdpbiwgZmFsc2UsIGZhbHNlKSk7XG5cbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFZJRVdfVFlQRV9UWVBfUEFORSkpIHtcbiAgICAgIGxlYWYudmlldz8ucmVuZGVyPy4oKTtcbiAgICB9XG4gIH07XG5cbiAgLy8gS2VlcHMgdGhlIGNvdW50cyBjdXJyZW50IG9uIGV2ZXJ5IFRZUC1yZWxldmFudCBjaGFuZ2UgZWxzZXdoZXJlIChuZXcgb3JcbiAgLy8gZGVsZXRlZCBub3RlLCBUWVAgb3IgU1VCVFlQIGNoYW5nZWQpLiBUaGUgaW5kZXgncyBcImNoYW5nZVwiIGZpcmVzIG9ubHkgZm9yXG4gIC8vIHRob3NlLCBub3Qgb24gZXZlcnkgYXV0b3NhdmUuIERlYm91bmNlZCBhbnl3YXkgc2luY2UgcmVuZGVyaW5nIHRoZSBsaXN0IGlzXG4gIC8vIHJlbGF0aXZlbHkgY29zdGx5OyByZXNldFRpbWVyIGNvbGxlY3RzIGEgYnVyc3QgKGJ1bGsgaW1wb3J0KSBpbnRvIG9uZS5cbiAgY29uc3QgZGVib3VuY2VkUmVmcmVzaCA9IGRlYm91bmNlKHJlZnJlc2gsIDUwMCwgdHJ1ZSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCBkZWJvdW5jZWRSZWZyZXNoKSk7XG4gIC8vIFRoZSBcIkV4Y2x1ZGVkIGZpbGVzXCIgbGlzdCBjaGFuZ2VkIChIaWRlIEZvbGRlcnMgdG9nZ2xpbmcgYSBmb2xkZXIsIHNheSkuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAudmF1bHQub24oXCJjb25maWctY2hhbmdlZFwiLCBkZWJvdW5jZWRSZWZyZXNoKSk7XG5cbiAgLy8gRm9yIHBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzOiByZS1yZW5kZXJzIHRoZSBsaXN0IG9yIHRoZSBkZXRhaWwgdmlldy5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbi8vIGNyZWF0ZUlmTWlzc2luZzogZmFsc2UgZm9yIHRoZSBhdXRvbWF0aWMgb25MYXlvdXRSZWFkeSBjYWxsIChzZWVcbi8vIHJlZ2lzdGVyVHlwUGFuZSksIHdoaWNoIHNob3VsZCBvbmx5IHJlY29ubmVjdCBhbiBleGlzdGluZyBsZWFmIG9ycGhhbmVkIGJ5XG4vLyBob3QgcmVsb2FkLCBub3QgY3JlYXRlIG9uZSBvbiBldmVyeSBzdGFydC4gQSBwYW5lIHRoYXQgd2FzIGNsb3NlZCBzdGF5c1xuLy8gY2xvc2VkLlxuYXN5bmMgZnVuY3Rpb24gYWN0aXZhdGVUeXBQYW5lKHBsdWdpbiwgcmV2ZWFsID0gdHJ1ZSwgY3JlYXRlSWZNaXNzaW5nID0gdHJ1ZSkge1xuICBjb25zdCBhcHAgPSBwbHVnaW4uYXBwO1xuICBjb25zdCB7IHdvcmtzcGFjZSB9ID0gYXBwO1xuXG4gIGNvbnN0IGNhbmRpZGF0ZXMgPSBbXTtcbiAgd29ya3NwYWNlLml0ZXJhdGVBbGxMZWF2ZXMoKGxlYWYpID0+IHtcbiAgICBpZiAoXG4gICAgICBsZWFmID09PSBhcHAuX190eXBTeXN0ZW1MZWFmIHx8XG4gICAgICAobGVhZi52aWV3ICYmIGxlYWYudmlldy5nZXRWaWV3VHlwZSgpID09PSBWSUVXX1RZUEVfVFlQX1BBTkUpXG4gICAgKSB7XG4gICAgICBjYW5kaWRhdGVzLnB1c2gobGVhZik7XG4gICAgfVxuICB9KTtcblxuICBsZXQgbGVhZiA9IGNhbmRpZGF0ZXMuc2hpZnQoKSA/PyBudWxsO1xuICBmb3IgKGNvbnN0IGV4dHJhIG9mIGNhbmRpZGF0ZXMpIGV4dHJhLmRldGFjaCgpO1xuXG4gIGlmICghbGVhZikge1xuICAgIGlmICghY3JlYXRlSWZNaXNzaW5nKSByZXR1cm47XG4gICAgbGVhZiA9IHdvcmtzcGFjZS5nZXRMZWZ0TGVhZihmYWxzZSk7XG4gICAgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoeyB0eXBlOiBWSUVXX1RZUEVfVFlQX1BBTkUsIGFjdGl2ZTogdHJ1ZSB9KTtcbiAgfSBlbHNlIGlmICghKGxlYWYudmlldyBpbnN0YW5jZW9mIFR5cFBhbmUpKSB7XG4gICAgLy8gYWN0aXZlOiBmYWxzZSAtIGp1c3QgcmVjb25uZWN0aW5nLiBvbkxheW91dFJlYWR5IGZpcmVzIGF0IG9uY2Ugb25jZSB0aGVcbiAgICAvLyBsYXlvdXQgaXMgcmVhZHksIHNvIGFjdGl2ZTogdHJ1ZSB3b3VsZCBzdGVhbCBmb2N1cyBvbiBldmVyeSBob3QgcmVsb2FkLlxuICAgIGF3YWl0IGxlYWYuc2V0Vmlld1N0YXRlKHsgdHlwZTogVklFV19UWVBFX1RZUF9QQU5FLCBhY3RpdmU6IGZhbHNlIH0pO1xuICB9XG5cbiAgYXBwLl9fdHlwU3lzdGVtTGVhZiA9IGxlYWY7XG4gIGlmIChyZXZlYWwpIHdvcmtzcGFjZS5yZXZlYWxMZWFmKGxlYWYpO1xufVxuXG4vLyBQcmVmZXJzIGFuIG9wZW4gVFlQLVBhbmUgZGV0YWlsIChleGFjdGx5IGxpa2UgaXRzIFwiK1wiIGJ1dHRvbik7IG90aGVyd2lzZVxuLy8gb3BlbnMgdGhlIGRldGFpbCB2aWV3IGZvciB0aGUgYWN0aXZlIG5vdGUncyBUWVAgYW5kIGFkZHMgdGhlIHByb3BlcnR5IHRoZXJlLlxuLy8gV2l0aG91dCBhbiBvcGVuIG5vdGUgb3IgVFlQLCBhIFRZUC1QYW5lIHNob3dpbmcgYSBkZXRhaWwgdmlldyAtIGV2ZW5cbi8vIHVuZm9jdXNlZCAtIGlzIHRoZSBmYWxsYmFjay4gVGhlIGJhcmUgbGlzdCBkb2Vzbid0IGNvdW50OiBpdCBoYXMgbm8gZWRpdG9yXG4vLyB0byBhZGQgdG8uXG5hc3luYyBmdW5jdGlvbiBhZGRUeXBQcm9wZXJ0eUNvbW1hbmQocGx1Z2luKSB7XG4gIGNvbnN0IGFwcCA9IHBsdWdpbi5hcHA7XG5cbiAgY29uc3QgYWN0aXZlVHlwUGFuZSA9IGFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShUeXBQYW5lKTtcbiAgaWYgKGFjdGl2ZVR5cFBhbmUgJiYgYWN0aXZlVHlwUGFuZS5zZWxlY3RlZFR5cCAhPT0gbnVsbCkge1xuICAgIGFjdGl2ZVR5cFBhbmUuZnJvbnRtYXR0ZXJCbG9ja3M/LmFkZEJsYW5rKG51bGwpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IGZpbGUgPSBhcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgY29uc3QgdHlwID0gcGx1Z2luLnR5cEluZGV4LnR5cE9mKGZpbGUpO1xuICBpZiAoIXR5cCkge1xuICAgIGNvbnN0IG9wZW5MZWFmID0gYXBwLndvcmtzcGFjZVxuICAgICAgLmdldExlYXZlc09mVHlwZShWSUVXX1RZUEVfVFlQX1BBTkUpXG4gICAgICAuZmluZCgobGVhZikgPT4gbGVhZi52aWV3IGluc3RhbmNlb2YgVHlwUGFuZSAmJiBsZWFmLnZpZXcuc2VsZWN0ZWRUeXAgIT09IG51bGwpO1xuICAgIGlmIChvcGVuTGVhZikge1xuICAgICAgYXdhaXQgYXBwLndvcmtzcGFjZS5yZXZlYWxMZWFmKG9wZW5MZWFmKTtcbiAgICAgIG9wZW5MZWFmLnZpZXcuZnJvbnRtYXR0ZXJCbG9ja3M/LmFkZEJsYW5rKG51bGwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBuZXcgTm90aWNlKFxuICAgICAgZmlsZVxuICAgICAgICA/IFwiVGhlIGFjdGl2ZSBub3RlIGhhcyBubyBUWVAsIGFuZCBubyBUWVAgaXMgb3BlbiBpbiB0aGUgVFlQLVBhbmUuXCJcbiAgICAgICAgOiBcIk5vIG5vdGUgaXMgb3BlbiwgYW5kIG5vIFRZUCBpcyBvcGVuIGluIHRoZSBUWVAtUGFuZS5cIlxuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgYXdhaXQgYWN0aXZhdGVUeXBQYW5lKHBsdWdpbik7XG4gIGNvbnN0IHZpZXcgPSBhcHAuX190eXBTeXN0ZW1MZWFmPy52aWV3O1xuICBpZiAoISh2aWV3IGluc3RhbmNlb2YgVHlwUGFuZSkpIHJldHVybjtcbiAgdmlldy5vcGVuVHlwU2V0dGluZ3ModHlwKTtcbiAgdmlldy5mcm9udG1hdHRlckJsb2Nrcz8uYWRkQmxhbmsobnVsbCk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlclR5cFBhbmUsIFZJRVdfVFlQRV9UWVBfUEFORSwgY29tcGFyZVR5cHMsIHNvcnRUeXBzQnlNb2RlLCBERUZBVUxUX1NPUlRfT1JERVIsIERFRkFVTFRfVFlQX0NPTE9SIH07XG4iLCAiY29uc3QgeyBURmlsZSwgVEZvbGRlciB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBjb2xvckZvckZpbGUgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5cbmNvbnN0IEZJTEVfRVhQTE9SRVJfVklFV19UWVBFID0gXCJmaWxlLWV4cGxvcmVyXCI7XG5jb25zdCBGT0xERVJfTk9URVNfUExVR0lOX0lEID0gXCJmb2xkZXItbm90ZXNcIjtcblxuLy8gRm9sZGVyIE5vdGVzIHNob3dzIGEgbm90ZSBhcyBpdHMgZm9sZGVyIGluc3RlYWQgb2YgYXMgaXRzIG93biByb3cuIEl0IGhhcyBub1xuLy8gcHVibGljIEFQSSBmb3IgdGhpcywgc28gdGhlIGZpbGUgbmFtZSBpcyByZWJ1aWx0IGZyb20gaXRzIGxpdmUgc2V0dGluZ3MuXG5mdW5jdGlvbiBnZXRGb2xkZXJOb3RlRmlsZShwbHVnaW4sIGZvbGRlcikge1xuICBjb25zdCBmb2xkZXJOb3RlcyA9IHBsdWdpbi5hcHAucGx1Z2lucy5wbHVnaW5zW0ZPTERFUl9OT1RFU19QTFVHSU5fSURdO1xuICBjb25zdCBzZXR0aW5ncyA9IGZvbGRlck5vdGVzPy5zZXR0aW5ncztcbiAgaWYgKCFzZXR0aW5ncykgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgZmlsZU5hbWUgPVxuICAgIChzZXR0aW5ncy5mb2xkZXJOb3RlTmFtZSB8fCBcInt7Zm9sZGVyX25hbWV9fVwiKS5yZXBsYWNlKFwie3tmb2xkZXJfbmFtZX19XCIsIGZvbGRlci5uYW1lKSArXG4gICAgKHNldHRpbmdzLmZvbGRlck5vdGVUeXBlIHx8IFwiLm1kXCIpO1xuICBjb25zdCBkaXJQYXRoID0gc2V0dGluZ3Muc3RvcmFnZUxvY2F0aW9uID09PSBcInBhcmVudEZvbGRlclwiID8gZm9sZGVyLnBhcmVudD8ucGF0aCA/PyBcIlwiIDogZm9sZGVyLnBhdGg7XG4gIGNvbnN0IHBhdGggPSBkaXJQYXRoID8gYCR7ZGlyUGF0aH0vJHtmaWxlTmFtZX1gIDogZmlsZU5hbWU7XG5cbiAgY29uc3QgZmlsZSA9IHBsdWdpbi5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHBhdGgpO1xuICByZXR1cm4gZmlsZSBpbnN0YW5jZW9mIFRGaWxlID8gZmlsZSA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIGFwcGx5Q29sb3JUb1RpdGxlKHBsdWdpbiwgdGl0bGVFbCwgZmlsZSkge1xuICBjb25zdCBjb250ZW50RWwgPSB0aXRsZUVsLnF1ZXJ5U2VsZWN0b3IoXCIubmF2LWZpbGUtdGl0bGUtY29udGVudCwgLm5hdi1mb2xkZXItdGl0bGUtY29udGVudFwiKTtcbiAgaWYgKCFjb250ZW50RWwpIHJldHVybjtcblxuICBjb25zdCBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmZpbGVFeHBsb3JlciA/IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIFwiZmlsZUV4cGxvcmVyXCIpIDogbnVsbDtcbiAgaWYgKGNvbG9yKSBjb250ZW50RWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcbiAgZWxzZSBjb250ZW50RWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcbn1cblxuZnVuY3Rpb24gYXBwbHlGaWxlRXhwbG9yZXJDb2xvcnMocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoRklMRV9FWFBMT1JFUl9WSUVXX1RZUEUpKSB7XG4gICAgY29uc3QgZmlsZVRpdGxlRWxzID0gbGVhZi52aWV3LmNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIubmF2LWZpbGUtdGl0bGVbZGF0YS1wYXRoXVwiKTtcbiAgICBmb3IgKGNvbnN0IHRpdGxlRWwgb2YgZmlsZVRpdGxlRWxzKSB7XG4gICAgICBjb25zdCBmaWxlID0gcGx1Z2luLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgodGl0bGVFbC5nZXRBdHRyaWJ1dGUoXCJkYXRhLXBhdGhcIikpO1xuICAgICAgYXBwbHlDb2xvclRvVGl0bGUocGx1Z2luLCB0aXRsZUVsLCBmaWxlIGluc3RhbmNlb2YgVEZpbGUgPyBmaWxlIDogbnVsbCk7XG4gICAgfVxuXG4gICAgY29uc3QgZm9sZGVyVGl0bGVFbHMgPSBsZWFmLnZpZXcuY29udGFpbmVyRWwucXVlcnlTZWxlY3RvckFsbChcIi5uYXYtZm9sZGVyLXRpdGxlW2RhdGEtcGF0aF1cIik7XG4gICAgZm9yIChjb25zdCB0aXRsZUVsIG9mIGZvbGRlclRpdGxlRWxzKSB7XG4gICAgICBjb25zdCBmb2xkZXIgPSBwbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aCh0aXRsZUVsLmdldEF0dHJpYnV0ZShcImRhdGEtcGF0aFwiKSk7XG4gICAgICBjb25zdCBub3RlRmlsZSA9IGZvbGRlciBpbnN0YW5jZW9mIFRGb2xkZXIgPyBnZXRGb2xkZXJOb3RlRmlsZShwbHVnaW4sIGZvbGRlcikgOiBudWxsO1xuICAgICAgYXBwbHlDb2xvclRvVGl0bGUocGx1Z2luLCB0aXRsZUVsLCBub3RlRmlsZSk7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyRmlsZUV4cGxvcmVyQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlGaWxlRXhwbG9yZXJDb2xvcnMocGx1Z2luKTtcblxuICAvLyBUaGUgZXhwbG9yZXIgcmUtcmVuZGVycyByb3dzIHdoZW4gZm9sZGVycyBleHBhbmQgb3IgY29sbGFwc2UuXG4gIGNvbnN0IG9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIocmVmcmVzaCk7XG4gIGNvbnN0IG9ic2VydmVFeHBsb3JlckxlYXZlcyA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEZJTEVfRVhQTE9SRVJfVklFV19UWVBFKSkge1xuICAgICAgb2JzZXJ2ZXIub2JzZXJ2ZShsZWFmLnZpZXcuY29udGFpbmVyRWwsIHsgY2hpbGRMaXN0OiB0cnVlLCBzdWJ0cmVlOiB0cnVlIH0pO1xuICAgIH1cbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IG9ic2VydmVyLmRpc2Nvbm5lY3QoKSk7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC52YXVsdC5vbihcInJlbmFtZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KFxuICAgIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICBvYnNlcnZlRXhwbG9yZXJMZWF2ZXMoKTtcbiAgICAgIHJlZnJlc2goKTtcbiAgICB9KVxuICApO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgIG9ic2VydmVFeHBsb3JlckxlYXZlcygpO1xuICAgIHJlZnJlc2goKTtcbiAgfSk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckZpbGVFeHBsb3JlckNvbG9ycyB9O1xuIiwgImNvbnN0IHsgY29sb3JGb3JGaWxlIH0gPSByZXF1aXJlKFwiLi90eXAtY29sb3JzXCIpO1xuXG5jb25zdCBHUkFQSF9WSUVXX1RZUEVTID0gW1wiZ3JhcGhcIiwgXCJsb2NhbGdyYXBoXCJdO1xuXG5mdW5jdGlvbiBoZXhUb0ludChoZXgpIHtcbiAgcmV0dXJuIHBhcnNlSW50KGhleC5yZXBsYWNlKFwiI1wiLCBcIlwiKSwgMTYpO1xufVxuXG4vLyBlbmdpbmUucmVuZGVyKCkgb25seSBjb25zdWx0cyBpdHMgZmlsZUZpbHRlciBvbmNlIGEgY29sb3IgZ3JvdXAgZXhpc3RzO1xuLy8gd2l0aG91dCBvbmUgZXZlcnkgZmlsZSBqdXN0IGdldHMgY29sb3I6dHJ1ZS4gU28gd2UgcGF0Y2ggcmVuZGVyZXIuc2V0RGF0YSxcbi8vIHJpZ2h0IGJlZm9yZSB0aGUgbm9kZSBkYXRhIHJlYWNoZXMgdGhlIFdlYkdMIHJlbmRlcmVyIC0gdGhlIHNhbWUgc3BvdCB0aGVcbi8vIGNvbW11bml0eSBwbHVnaW4gZ3JhcGgtbmVzdGVkLXRhZ3MgdXNlcy4gTm9kZXMgYWxyZWFkeSBjb2xvcmVkIGJ5IGEgY29sb3Jcbi8vIGdyb3VwIGFyZSBsZWZ0IGFsb25lLlxuZnVuY3Rpb24gcGF0Y2hSZW5kZXJlcihwbHVnaW4sIHJlbmRlcmVyKSB7XG4gIGlmIChyZW5kZXJlci5fX3R5cFN5c3RlbUNvbG9yUGF0Y2hlZCkgcmV0dXJuO1xuICByZW5kZXJlci5fX3R5cFN5c3RlbUNvbG9yUGF0Y2hlZCA9IHRydWU7XG5cbiAgY29uc3Qgb3JpZ2luYWwgPSByZW5kZXJlci5zZXREYXRhO1xuICByZW5kZXJlci5zZXREYXRhID0gZnVuY3Rpb24gKGRhdGEpIHtcbiAgICBmb3IgKGNvbnN0IHBhdGggaW4gZGF0YS5ub2Rlcykge1xuICAgICAgY29uc3Qgbm9kZSA9IGRhdGEubm9kZXNbcGF0aF07XG4gICAgICBpZiAobm9kZS5jb2xvcikgY29udGludWU7XG5cbiAgICAgIGlmIChub2RlLnR5cGUgPT09IFwidGFnXCIpIHtcbiAgICAgICAgLy8gT3duIHRhZyBjb2xvciBkaXNhYmxlZCAoMjAyNi0wOS0zMCk6IHRoZSBNaW5pbWFsIHRoZW1lJ3MgU3R5bGVcbiAgICAgICAgLy8gU2V0dGluZ3MgYWxyZWFkeSBjb3ZlciBpdCAoR3JhcGhzIFx1MjE5MiBUYWcgbm9kZSBjb2xvcikuXG4gICAgICAgIC8vIGlmIChwbHVnaW4uc2V0dGluZ3MuZ3JhcGhUYWdDb2xvckVuYWJsZWQgJiYgcGx1Z2luLnNldHRpbmdzLmdyYXBoVGFnQ29sb3IpIHtcbiAgICAgICAgLy8gICBub2RlLmNvbG9yID0geyBhOiAxLCByZ2I6IGhleFRvSW50KHBsdWdpbi5zZXR0aW5ncy5ncmFwaFRhZ0NvbG9yKSB9O1xuICAgICAgICAvLyB9XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBmaWxlID0gcGx1Z2luLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgocGF0aCk7XG4gICAgICBsZXQgY29sb3IgPSBudWxsO1xuXG4gICAgICBpZiAoZmlsZSAmJiBmaWxlLmV4dGVuc2lvbiAhPT0gXCJtZFwiKSB7XG4gICAgICAgIC8vIE93biBhdHRhY2htZW50IGNvbG9yIGRpc2FibGVkICgyMDI2LTA5LTMwKSwgc2VlIHRhZyBjb2xvciBhYm92ZVxuICAgICAgICAvLyAoR3JhcGhzIFx1MjE5MiBBdHRhY2htZW50IG5vZGUgY29sb3IpLlxuICAgICAgICAvLyBpZiAocGx1Z2luLnNldHRpbmdzLmdyYXBoQXR0YWNobWVudENvbG9yRW5hYmxlZCAmJiBwbHVnaW4uc2V0dGluZ3MuZ3JhcGhBdHRhY2htZW50Q29sb3IpIHtcbiAgICAgICAgLy8gICBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5ncmFwaEF0dGFjaG1lbnRDb2xvcjtcbiAgICAgICAgLy8gfVxuICAgICAgfSBlbHNlIGlmIChwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5ncmFwaCkge1xuICAgICAgICBjb2xvciA9IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIFwiZ3JhcGhcIik7XG4gICAgICB9XG5cbiAgICAgIGlmIChjb2xvcikgbm9kZS5jb2xvciA9IHsgYTogMSwgcmdiOiBoZXhUb0ludChjb2xvcikgfTtcbiAgICB9XG4gICAgcmV0dXJuIG9yaWdpbmFsLmNhbGwodGhpcywgZGF0YSk7XG4gIH07XG5cbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IHtcbiAgICByZW5kZXJlci5zZXREYXRhID0gb3JpZ2luYWw7XG4gICAgZGVsZXRlIHJlbmRlcmVyLl9fdHlwU3lzdGVtQ29sb3JQYXRjaGVkO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gZ2V0R3JhcGhMZWF2ZXMoYXBwKSB7XG4gIGNvbnN0IGxlYXZlcyA9IFtdO1xuICBmb3IgKGNvbnN0IHZpZXdUeXBlIG9mIEdSQVBIX1ZJRVdfVFlQRVMpIGxlYXZlcy5wdXNoKC4uLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKHZpZXdUeXBlKSk7XG4gIHJldHVybiBsZWF2ZXM7XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyR3JhcGhDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIGdldEdyYXBoTGVhdmVzKHBsdWdpbi5hcHApKSB7XG4gICAgICBpZiAobGVhZi52aWV3Py5yZW5kZXJlcikgcGF0Y2hSZW5kZXJlcihwbHVnaW4sIGxlYWYudmlldy5yZW5kZXJlcik7XG4gICAgICAvLyBUaGUgZ2xvYmFsIGdyYXBoIGtlZXBzIGl0cyBlbmdpbmUgaW4gdmlldy5kYXRhRW5naW5lLCB0aGUgbG9jYWwgb25lIGluXG4gICAgICAvLyB2aWV3LmVuZ2luZS5cbiAgICAgIChsZWFmLnZpZXc/LmRhdGFFbmdpbmUgPz8gbGVhZi52aWV3Py5lbmdpbmUpPy5yZW5kZXIoKTtcbiAgICB9XG4gIH07XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeShyZWZyZXNoKTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyR3JhcGhDb2xvcnMgfTtcbiIsICJjb25zdCB7IGNvbG9yRm9yRmlsZSB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxuY29uc3QgU0VBUkNIX1ZJRVdfVFlQRSA9IFwic2VhcmNoXCI7XG5cbi8vIFNlYXJjaCByZXN1bHQgcm93cyBoYXZlIG5vIGRhdGEtcGF0aCwgYnV0IHRoZSB2aWV3IGtlZXBzIGEgVEZpbGUgLT4gcmVzdWx0XG4vLyBET00gbWFwIChkb20ucmVzdWx0RG9tTG9va3VwKSB0aGF0IGxpbmtzIGZpbGUgYW5kIHJvdyBkaXJlY3RseS5cbmZ1bmN0aW9uIGFwcGx5U2VhcmNoQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFNFQVJDSF9WSUVXX1RZUEUpKSB7XG4gICAgY29uc3QgcmVzdWx0RG9tTG9va3VwID0gbGVhZi52aWV3Py5kb20/LnJlc3VsdERvbUxvb2t1cDtcbiAgICBpZiAoIXJlc3VsdERvbUxvb2t1cCkgY29udGludWU7XG5cbiAgICBmb3IgKGNvbnN0IFtmaWxlLCByZXN1bHREb21dIG9mIHJlc3VsdERvbUxvb2t1cCkge1xuICAgICAgY29uc3QgdGl0bGVFbCA9IHJlc3VsdERvbS5lbD8ucXVlcnlTZWxlY3RvcihcIi5zZWFyY2gtcmVzdWx0LWZpbGUtdGl0bGUgLnRyZWUtaXRlbS1pbm5lclwiKTtcbiAgICAgIGlmICghdGl0bGVFbCkgY29udGludWU7XG5cbiAgICAgIGNvbnN0IGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Muc2VhcmNoID8gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSwgXCJzZWFyY2hcIikgOiBudWxsO1xuICAgICAgaWYgKGNvbG9yKSB0aXRsZUVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gICAgICBlbHNlIHRpdGxlRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJTZWFyY2hDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseVNlYXJjaENvbG9ycyhwbHVnaW4pO1xuXG4gIC8vIFJlc3VsdHMgYXJlIHJlYnVpbHQgb24gZXZlcnkga2V5c3Ryb2tlLlxuICBjb25zdCBvYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKHJlZnJlc2gpO1xuICBjb25zdCBvYnNlcnZlTGVhdmVzID0gKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoU0VBUkNIX1ZJRVdfVFlQRSkpIHtcbiAgICAgIG9ic2VydmVyLm9ic2VydmUobGVhZi52aWV3LmNvbnRhaW5lckVsLCB7IGNoaWxkTGlzdDogdHJ1ZSwgc3VidHJlZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiBvYnNlcnZlci5kaXNjb25uZWN0KCkpO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KFxuICAgIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgICByZWZyZXNoKCk7XG4gICAgfSlcbiAgKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgcmVmcmVzaCgpO1xuICB9KTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyU2VhcmNoQ29sb3JzIH07XG4iLCAiY29uc3QgeyBjb2xvckZvckZpbGUgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5cbmNvbnN0IFJFQ0VOVF9GSUxFU19WSUVXX1RZUEUgPSBcInJlY2VudC1maWxlc1wiO1xuXG4vLyBSZWNlbnQgRmlsZXMgcm93cyBoYXZlIG5vIGRhdGEtcGF0aCwgYnV0IHRoZSBsaXN0IGlzIHJlbmRlcmVkIHN0cmFpZ2h0IGZyb21cbi8vIGRhdGEucmVjZW50RmlsZXMgd2l0aG91dCBza2lwcGluZyBlbnRyaWVzLCBzbyB0aGUgaW5kZXggbWFwcyByb3cgdG8gcGF0aC5cbmZ1bmN0aW9uIGFwcGx5UmVjZW50RmlsZXNDb2xvcnMocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoUkVDRU5UX0ZJTEVTX1ZJRVdfVFlQRSkpIHtcbiAgICBjb25zdCByZWNlbnRGaWxlcyA9IGxlYWYudmlldz8uZGF0YT8ucmVjZW50RmlsZXM7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHJlY2VudEZpbGVzKSkgY29udGludWU7XG5cbiAgICBjb25zdCB0aXRsZUVscyA9IGxlYWYudmlldy5jb250YWluZXJFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLnJlY2VudC1maWxlcy10aXRsZSAubmF2LWZpbGUtdGl0bGUtY29udGVudFwiKTtcbiAgICB0aXRsZUVscy5mb3JFYWNoKCh0aXRsZUVsLCBpbmRleCkgPT4ge1xuICAgICAgY29uc3QgZW50cnkgPSByZWNlbnRGaWxlc1tpbmRleF07XG4gICAgICBjb25zdCBmaWxlID0gZW50cnkgPyBwbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChlbnRyeS5wYXRoKSA6IG51bGw7XG4gICAgICBjb25zdCBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnJlY2VudEZpbGVzID8gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSwgXCJyZWNlbnRGaWxlc1wiKSA6IG51bGw7XG4gICAgICBpZiAoY29sb3IpIHRpdGxlRWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcbiAgICAgIGVsc2UgdGl0bGVFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImNvbG9yXCIpO1xuICAgIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyUmVjZW50RmlsZXNDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseVJlY2VudEZpbGVzQ29sb3JzKHBsdWdpbik7XG5cbiAgY29uc3Qgb2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcihyZWZyZXNoKTtcbiAgY29uc3Qgb2JzZXJ2ZUxlYXZlcyA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFJFQ0VOVF9GSUxFU19WSUVXX1RZUEUpKSB7XG4gICAgICBvYnNlcnZlci5vYnNlcnZlKGxlYWYudmlldy5jb250YWluZXJFbCwgeyBjaGlsZExpc3Q6IHRydWUsIHN1YnRyZWU6IHRydWUgfSk7XG4gICAgfVxuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4gb2JzZXJ2ZXIuZGlzY29ubmVjdCgpKTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgICAgcmVmcmVzaCgpO1xuICAgIH0pXG4gICk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgIHJlZnJlc2goKTtcbiAgfSk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlclJlY2VudEZpbGVzQ29sb3JzIH07XG4iLCAiY29uc3QgeyBjb2xvckZvckZpbGUgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5cbmNvbnN0IEJBQ0tMSU5LX1ZJRVdfVFlQRSA9IFwiYmFja2xpbmtcIjtcblxuLy8gVGhlIGJhY2tsaW5rcyBwYW5lIHJlbmRlcnMgcmVzdWx0cyB3aXRoIHRoZSBzYW1lIFNlYXJjaFJlc3VsdERvbSBjbGFzcyBhc1xuLy8gc2VhcmNoLiBMaW5rZWQgYW5kIHVubGlua2VkIG1lbnRpb25zIGFyZSB0d28gcmVzdWx0RG9tTG9va3VwIG1hcHMgb24gdGhlXG4vLyByZW5kZXJlciAodmlldy5iYWNrbGluaykuIFRoZSBmaWVsZCBuYW1lcyBhcmUgdW5kb2N1bWVudGVkLCBzbyBzZXZlcmFsXG4vLyBrbm93biBwYXRocyBhcmUgdHJpZWQuXG5mdW5jdGlvbiBnZXRSZXN1bHREb21Mb29rdXBzKHZpZXcpIHtcbiAgY29uc3QgcmVuZGVyZXIgPSB2aWV3Py5iYWNrbGluaztcbiAgY29uc3QgY2FuZGlkYXRlcyA9IFtyZW5kZXJlcj8uYmFja2xpbmtEb20sIHJlbmRlcmVyPy51bmxpbmtlZERvbSwgdmlldz8uYmFja2xpbmtEb20sIHZpZXc/LnVubGlua2VkRG9tLCB2aWV3Py5kb21dO1xuXG4gIGNvbnN0IGxvb2t1cHMgPSBbXTtcbiAgZm9yIChjb25zdCBkb20gb2YgY2FuZGlkYXRlcykge1xuICAgIGlmIChkb20/LnJlc3VsdERvbUxvb2t1cCBpbnN0YW5jZW9mIE1hcCkgbG9va3Vwcy5wdXNoKGRvbS5yZXN1bHREb21Mb29rdXApO1xuICB9XG4gIHJldHVybiBsb29rdXBzO1xufVxuXG5mdW5jdGlvbiBjb2xvclRpdGxlRWwocGx1Z2luLCBlbCwgZmlsZSkge1xuICBjb25zdCBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmJhY2tsaW5rcyA/IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIFwiYmFja2xpbmtzXCIpIDogbnVsbDtcbiAgaWYgKGNvbG9yKSBlbC5zdHlsZS5jb2xvciA9IGNvbG9yO1xuICBlbHNlIGVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiY29sb3JcIik7XG59XG5cbmZ1bmN0aW9uIGFwcGx5QmFja2xpbmtQYW5lQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEJBQ0tMSU5LX1ZJRVdfVFlQRSkpIHtcbiAgICBmb3IgKGNvbnN0IGxvb2t1cCBvZiBnZXRSZXN1bHREb21Mb29rdXBzKGxlYWYudmlldykpIHtcbiAgICAgIGZvciAoY29uc3QgW2ZpbGUsIHJlc3VsdERvbV0gb2YgbG9va3VwKSB7XG4gICAgICAgIGNvbnN0IHRpdGxlRWwgPSByZXN1bHREb20uZWw/LnF1ZXJ5U2VsZWN0b3IoXCIuc2VhcmNoLXJlc3VsdC1maWxlLXRpdGxlIC50cmVlLWl0ZW0taW5uZXJcIik7XG4gICAgICAgIGlmICh0aXRsZUVsKSBjb2xvclRpdGxlRWwocGx1Z2luLCB0aXRsZUVsLCBmaWxlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuLy8gQmFja2xpbmtzIGluIHRoZSBkb2N1bWVudCBhcmUgbm90IGEgbGVhZiBvZiB0aGVpciBvd24gYnV0IGVtYmVkZGVkIGF0IHRoZVxuLy8gYm90dG9tIG9mIHRoZSBtYXJrZG93biB2aWV3ICguZW1iZWRkZWQtYmFja2xpbmtzKS4gUm93cyBoYXZlIG5vIGRhdGEtcGF0aCxcbi8vIHNvIHRoZSBmaWxlIGlzIHJlc29sdmVkIGZyb20gdGhlIHNob3duIG5hbWUsIHRoZSB3YXkgT2JzaWRpYW4gcmVzb2x2ZXMgbGlua3MuXG5mdW5jdGlvbiBhcHBseUVtYmVkZGVkQmFja2xpbmtDb2xvcnMocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xuICAgIGNvbnN0IHBhbmVFbCA9IGxlYWYudmlldy5jb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKFwiLmVtYmVkZGVkLWJhY2tsaW5rcyAuYmFja2xpbmstcGFuZVwiKTtcbiAgICBpZiAoIXBhbmVFbCkgY29udGludWU7XG5cbiAgICBjb25zdCBzb3VyY2VQYXRoID0gbGVhZi52aWV3LmZpbGU/LnBhdGggPz8gXCJcIjtcbiAgICBjb25zdCB0aXRsZUVscyA9IHBhbmVFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLnNlYXJjaC1yZXN1bHQtZmlsZS10aXRsZSAudHJlZS1pdGVtLWlubmVyXCIpO1xuICAgIGZvciAoY29uc3QgdGl0bGVFbCBvZiB0aXRsZUVscykge1xuICAgICAgY29uc3QgYmFzZW5hbWUgPSB0aXRsZUVsLnRleHRDb250ZW50O1xuICAgICAgY29uc3QgZmlsZSA9IGJhc2VuYW1lID8gcGx1Z2luLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpcnN0TGlua3BhdGhEZXN0KGJhc2VuYW1lLCBzb3VyY2VQYXRoKSA6IG51bGw7XG4gICAgICBjb2xvclRpdGxlRWwocGx1Z2luLCB0aXRsZUVsLCBmaWxlKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gYXBwbHlCYWNrbGlua0NvbG9ycyhwbHVnaW4pIHtcbiAgYXBwbHlCYWNrbGlua1BhbmVDb2xvcnMocGx1Z2luKTtcbiAgYXBwbHlFbWJlZGRlZEJhY2tsaW5rQ29sb3JzKHBsdWdpbik7XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyQmFja2xpbmtDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseUJhY2tsaW5rQ29sb3JzKHBsdWdpbik7XG5cbiAgLy8gT25seSB0aGUgc21hbGwgc2lkZWJhciBwYW5lIGlzIG9ic2VydmVkLCBuZXZlciBhIG1hcmtkb3duIHZpZXc6IGEgc3VidHJlZVxuICAvLyBvYnNlcnZlciBuZWFyIHRoZSBlZGl0b3IgZmlyZXMgb24gZXZlcnkga2V5c3Ryb2tlIGFuZCBvbmNlIGZyb3plIHRoaXNcbiAgLy8gdmF1bHQuIFRoZSBlbWJlZGRlZCBiYWNrbGlua3Mgb25seSBjaGFuZ2Ugd2hlbiBsaW5rcyBjaGFuZ2UgKFwicmVzb2x2ZWRcIilcbiAgLy8gb3IgdGhlIG5vdGUgY2hhbmdlcyAobGF5b3V0LWNoYW5nZS9hY3RpdmUtbGVhZi1jaGFuZ2UpLCBib3RoIGNvdmVyZWQgYmVsb3cuXG4gIGNvbnN0IG9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIocmVmcmVzaCk7XG4gIGNvbnN0IG9ic2VydmVMZWF2ZXMgPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShCQUNLTElOS19WSUVXX1RZUEUpKSB7XG4gICAgICBvYnNlcnZlci5vYnNlcnZlKGxlYWYudmlldy5jb250YWluZXJFbCwgeyBjaGlsZExpc3Q6IHRydWUsIHN1YnRyZWU6IHRydWUgfSk7XG4gICAgfVxuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4gb2JzZXJ2ZXIuZGlzY29ubmVjdCgpKTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLm1ldGFkYXRhQ2FjaGUub24oXCJyZXNvbHZlZFwiLCAoKSA9PiBhcHBseUVtYmVkZGVkQmFja2xpbmtDb2xvcnMocGx1Z2luKSkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgICAgcmVmcmVzaCgpO1xuICAgIH0pXG4gICk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwiYWN0aXZlLWxlYWYtY2hhbmdlXCIsIHJlZnJlc2gpKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgcmVmcmVzaCgpO1xuICB9KTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyQmFja2xpbmtDb2xvcnMgfTtcbiIsICJjb25zdCB7IGNvbG9yRm9yRmlsZSB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxuY29uc3QgQk9PS01BUktTX1ZJRVdfVFlQRSA9IFwiYm9va21hcmtzXCI7XG5jb25zdCBCT09LTUFSS1NfUExVR0lOX0lEID0gXCJib29rbWFya3NcIjtcblxuLy8gQm9va21hcmsgcm93cyBoYXZlIG5vIGRhdGEtcGF0aC4gVGhlIHZpZXcga2VlcHMgYSBXZWFrTWFwICh2aWV3Lml0ZW1Eb21zOlxuLy8gaXRlbSAtPiB0cmVlIGl0ZW0gd2l0aCAudGl0bGVFbCksIHdoaWNoIGNhbid0IGJlIGl0ZXJhdGVkLCBzbyB3ZSB3YWxrIHRoZVxuLy8gcGx1Z2luJ3Mgb3duIGl0ZW0gdHJlZSAoYWx3YXlzIGNvbXBsZXRlLCB3aGF0ZXZlciBpcyBjb2xsYXBzZWQpIGFuZCBsb29rIHVwXG4vLyBlYWNoIGl0ZW0ncyByb3cgd2l0aCAuZ2V0KCkuXG5mdW5jdGlvbiBmb3JFYWNoRmlsZUJvb2ttYXJrKGl0ZW1zLCBjYWxsYmFjaykge1xuICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMgPz8gW10pIHtcbiAgICBpZiAoaXRlbS50eXBlID09PSBcImZpbGVcIikgY2FsbGJhY2soaXRlbSk7XG4gICAgZWxzZSBpZiAoaXRlbS50eXBlID09PSBcImdyb3VwXCIpIGZvckVhY2hGaWxlQm9va21hcmsoaXRlbS5pdGVtcywgY2FsbGJhY2spO1xuICB9XG59XG5cbmZ1bmN0aW9uIGFwcGx5Qm9va21hcmtzQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCBib29rbWFya3NQbHVnaW4gPSBwbHVnaW4uYXBwLmludGVybmFsUGx1Z2lucy5nZXRFbmFibGVkUGx1Z2luQnlJZChCT09LTUFSS1NfUExVR0lOX0lEKTtcbiAgaWYgKCFib29rbWFya3NQbHVnaW4pIHJldHVybjtcblxuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEJPT0tNQVJLU19WSUVXX1RZUEUpKSB7XG4gICAgY29uc3QgaXRlbURvbXMgPSBsZWFmLnZpZXc/Lml0ZW1Eb21zO1xuICAgIGlmICghaXRlbURvbXMpIGNvbnRpbnVlO1xuXG4gICAgZm9yRWFjaEZpbGVCb29rbWFyayhib29rbWFya3NQbHVnaW4uaXRlbXMsIChpdGVtKSA9PiB7XG4gICAgICBjb25zdCB0aXRsZUVsID0gaXRlbURvbXMuZ2V0KGl0ZW0pPy50aXRsZUVsO1xuICAgICAgaWYgKCF0aXRsZUVsKSByZXR1cm47XG5cbiAgICAgIGNvbnN0IGZpbGUgPSBwbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChpdGVtLnBhdGgpO1xuICAgICAgY29uc3QgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5ib29rbWFya3MgPyBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCBcImJvb2ttYXJrc1wiKSA6IG51bGw7XG4gICAgICBpZiAoY29sb3IpIHRpdGxlRWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcbiAgICAgIGVsc2UgdGl0bGVFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImNvbG9yXCIpO1xuICAgIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyQm9va21hcmtzQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlCb29rbWFya3NDb2xvcnMocGx1Z2luKTtcblxuICAvLyBSb3dzIGFyZSByZS1yZW5kZXJlZCB3aGVuIGdyb3VwcyBleHBhbmQvY29sbGFwc2Ugb3IgYm9va21hcmtzIGNoYW5nZS5cbiAgY29uc3Qgb2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcihyZWZyZXNoKTtcbiAgY29uc3Qgb2JzZXJ2ZUxlYXZlcyA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEJPT0tNQVJLU19WSUVXX1RZUEUpKSB7XG4gICAgICBvYnNlcnZlci5vYnNlcnZlKGxlYWYudmlldy5jb250YWluZXJFbCwgeyBjaGlsZExpc3Q6IHRydWUsIHN1YnRyZWU6IHRydWUgfSk7XG4gICAgfVxuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4gb2JzZXJ2ZXIuZGlzY29ubmVjdCgpKTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgICAgcmVmcmVzaCgpO1xuICAgIH0pXG4gICk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgIHJlZnJlc2goKTtcbiAgfSk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckJvb2ttYXJrc0NvbG9ycyB9O1xuIiwgImNvbnN0IHsgVEZpbGUgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgY29sb3JGb3JGaWxlLCBzdWJ0eXBDb2xvciwgc3VidHlwSGFzT3duQ29sb3IgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5jb25zdCB7IGdldFN1YnR5cCB9ID0gcmVxdWlyZShcIi4vc3VidHlwc1wiKTtcblxuY29uc3QgRE9UX0NMQVNTID0gXCJ0eXAtdGl0bGUtZG90XCI7XG5jb25zdCBET1RfSE9MTE9XX0NMQVNTID0gXCJ0eXAtdGl0bGUtZG90LWhvbGxvd1wiO1xuLy8gU2FtZSBhcyBERUZBVUxUX1RZUF9DT0xPUiBpbiB0eXAtcGFuZS5qcyAoYSBUWVAgd2l0aG91dCBpdHMgb3duIGNvbG9yKS5cbmNvbnN0IERFRkFVTFRfRE9UX0NPTE9SID0gXCIjODg4ODg4XCI7XG5jb25zdCBCQURHRV9DTEFTUyA9IFwidHlwLXRpdGxlLWJhZGdlXCI7XG5jb25zdCBCQURHRV9QTEFJTl9DTEFTUyA9IFwidHlwLXRpdGxlLWJhZGdlLXBsYWluXCI7XG5jb25zdCBDT0xPUl9WQVIgPSBcIi0tdHlwLXRpdGxlLWNvbG9yXCI7XG5cbmNvbnN0IEJMT0NLX0JBREdFX0NMQVNTID0gXCJ0eXAtYmxvY2stYmFkZ2VcIjtcbmNvbnN0IEJMT0NLX0JBREdFX1BMQUlOX0NMQVNTID0gXCJ0eXAtYmxvY2stYmFkZ2UtcGxhaW5cIjtcbmNvbnN0IEJMT0NLX0FMSUdOX1RPUF9DTEFTUyA9IFwidHlwLWJsb2NrLWJhZGdlLXRvcFwiO1xuY29uc3QgQkxPQ0tfQUxJR05fQk9UVE9NX0NMQVNTID0gXCJ0eXAtYmxvY2stYmFkZ2UtYm90dG9tXCI7XG5jb25zdCBCTE9DS19DT0xPUl9WQVIgPSBcIi0tdHlwLWJsb2NrLWNvbG9yXCI7XG5cbi8vIG5vdGVUaXRsZVN0eWxlOiBcIm5vbmVcIiB8IFwiZG90XCIgfCBcImJhZGdlXCIuIEZvciBcImJhZGdlXCIsIG5vdGVUaXRsZUJhZGdlQ29sb3JlZFxuLy8gYW5kIG5vdGVUaXRsZUJhZGdlUG9zaXRpb24gKFwidGl0bGVcIiB8IFwiYmxvY2tcIiwgcGx1cyBub3RlVGl0bGVWZXJ0aWNhbEFsaWduXG4vLyBmb3IgXCJibG9ja1wiKSByZWZpbmUgaXQuIGNvbG9yVmlld3Mubm90ZVRpdGxlQ29sb3IgKHRoZSB0aXRsZSB0ZXh0IGl0c2VsZikgaXNcbi8vIGluZGVwZW5kZW50IGFuZCBjb21iaW5lcyB3aXRoIGFueSBvZiB0aGVzZS5cbmZ1bmN0aW9uIHJlc29sdmVNYXJrZXIocGx1Z2luLCBmaWxlKSB7XG4gIGNvbnN0IHN0eWxlID0gcGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVN0eWxlO1xuICBpZiAoc3R5bGUgPT09IFwibm9uZVwiKSByZXR1cm4geyBraW5kOiBcIm5vbmVcIiB9O1xuICBpZiAoc3R5bGUgPT09IFwiZG90XCIpIHJldHVybiB7IGtpbmQ6IFwiZG90XCIsIC4uLnJlc29sdmVEb3QocGx1Z2luLCBmaWxlKSB9O1xuXG4gIC8vIFwiYmFkZ2VcIjogY29sb3JlZCwgYSByZWdpc3RlcmVkIFRZUCB3aXRob3V0IGEgY29sb3IgZ2V0cyB0aGUgZ3JheSBkZWZhdWx0XG4gIC8vIChsaWtlIHRoZSByaW5nIGluIHJlc29sdmVEb3QpOyBhbiB1bnJlZ2lzdGVyZWQgVFlQIGdldHMgbm8gY29sb3JlZCBiYWRnZSxcbiAgLy8ganVzdCBhcyBpdCBnZXRzIG5vIGRvdC5cbiAgY29uc3QgeyBzZXR0aW5ncyB9ID0gcGx1Z2luO1xuICBjb25zdCB0eXAgPSBwbHVnaW4udHlwSW5kZXgudHlwT2YoZmlsZSk7XG4gIGlmICghdHlwKSByZXR1cm4geyBraW5kOiBcIm5vbmVcIiB9O1xuICBjb25zdCBjb2xvcmVkID0gc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VDb2xvcmVkO1xuICBpZiAoY29sb3JlZCAmJiAhc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gJiYgIXNldHRpbmdzLnR5cHMuaW5jbHVkZXModHlwKSkgcmV0dXJuIHsga2luZDogXCJub25lXCIgfTtcbiAgY29uc3QgdHlwQ29sb3IgPSBzZXR0aW5ncy50eXBDb2xvcnNbdHlwXSA/PyBERUZBVUxUX0RPVF9DT0xPUjtcblxuICBjb25zdCBsYWJlbCA9IGJhZGdlTGFiZWwocGx1Z2luLCBmaWxlLCB0eXApO1xuICBpZiAoIWxhYmVsKSByZXR1cm4geyBraW5kOiBcIm5vbmVcIiB9O1xuICBjb25zdCB7IHRleHQsIHVzZVN1YnR5cENvbG9yLCBzdWJ0eXAgfSA9IGxhYmVsO1xuICBjb25zdCBjb2xvciA9IGNvbG9yZWQgPyAodXNlU3VidHlwQ29sb3IgPyBzdWJ0eXBDb2xvcihzZXR0aW5ncywgdHlwLCBzdWJ0eXApID8/IHR5cENvbG9yIDogdHlwQ29sb3IpIDogbnVsbDtcbiAgY29uc3QgcG9zaXRpb24gPSBzZXR0aW5ncy5ub3RlVGl0bGVCYWRnZVBvc2l0aW9uO1xuICByZXR1cm4geyBraW5kOiBwb3NpdGlvbiA9PT0gXCJibG9ja1wiID8gXCJibG9jay1iYWRnZVwiIDogXCJ0aXRsZS1iYWRnZVwiLCBjb2xvcmVkLCBjb2xvciwgdHlwTmFtZTogdGV4dCB9O1xufVxuXG4vLyBCYWRnZSBsYWJlbCAobm90ZVRpdGxlQmFkZ2VMYWJlbCkgd2l0aCBpdHMgY29sb3I6IFtUWVBdIGluIHRoZSBUWVAgY29sb3IsXG4vLyBbU3VidHlwXSBpbiB0aGUgU3VidHlwIGNvbG9yIChubyBiYWRnZSB3aXRob3V0IGEgU3VidHlwKSwgW1RZUC9TdWJ0eXBdXG4vLyBkZXBlbmRpbmcgb24gdGhlIFwiU3VidHlwIGNvbG9yXCIgdG9nZ2xlIChjb2xvclZpZXdzLm5vdGVUaXRsZU1hcmtlclN1YnR5cCkuXG4vLyBBbiB1bnJlZ2lzdGVyZWQgU1VCVFlQIHZhbHVlIGlzIHNob3duIGJ1dCBoYXMgbm8gY29sb3Igb2YgaXRzIG93blxuLy8gKHN1YnR5cENvbG9yIHRoZW4gcmV0dXJucyB0aGUgVFlQIGNvbG9yKS5cbmZ1bmN0aW9uIGJhZGdlTGFiZWwocGx1Z2luLCBmaWxlLCB0eXApIHtcbiAgY29uc3QgeyBzZXR0aW5ncyB9ID0gcGx1Z2luO1xuICBjb25zdCBzdWJ0eXAgPSBwbHVnaW4udHlwSW5kZXguc3VidHlwT2YoZmlsZSk7XG4gIGNvbnN0IG1vZGUgPSBzZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUxhYmVsID8/IFwidHlwXCI7XG4gIGlmIChtb2RlID09PSBcInN1YnR5cFwiKSByZXR1cm4gc3VidHlwID8geyB0ZXh0OiBzdWJ0eXAsIHVzZVN1YnR5cENvbG9yOiB0cnVlLCBzdWJ0eXAgfSA6IG51bGw7XG4gIGlmICghc3VidHlwIHx8IG1vZGUgPT09IFwidHlwXCIpIHJldHVybiB7IHRleHQ6IHR5cCwgdXNlU3VidHlwQ29sb3I6IGZhbHNlLCBzdWJ0eXAgfTtcbiAgcmV0dXJuIHsgdGV4dDogYCR7dHlwfS8ke3N1YnR5cH1gLCB1c2VTdWJ0eXBDb2xvcjogISFzZXR0aW5ncy5jb2xvclZpZXdzLm5vdGVUaXRsZU1hcmtlclN1YnR5cCwgc3VidHlwIH07XG59XG5cbi8vIERvdCBhdCB0aGUgdGl0bGUuIExpa2UgdGhlIGRvdHMgaW4gdGhlIFRZUC1QYW5lIChwYWludENvbG9yRG90IGluXG4vLyB0eXAtY29sb3JzLmpzKSwgYSBkZWZhdWx0IGlzIHNob3duIGFzIGEgaG9sbG93IHJpbmc6IGdyYXkgZm9yIGEgcmVnaXN0ZXJlZFxuLy8gVFlQIHdpdGhvdXQgYSBjb2xvciwgdGhlIGluaGVyaXRlZCBUWVAgY29sb3IgZm9yIGEgU3VidHlwIHdpdGhvdXQgaXRzIG93bi5cbi8vIFVucmVnaXN0ZXJlZCBUWVAgdmFsdWVzIGdldCBubyBkb3QsIGFzIGluIHRoZSBUWVAtTGlzdC5cbmZ1bmN0aW9uIHJlc29sdmVEb3QocGx1Z2luLCBmaWxlKSB7XG4gIGNvbnN0IHR5cCA9IHBsdWdpbi50eXBJbmRleC50eXBPZihmaWxlKTtcbiAgaWYgKCF0eXApIHJldHVybiB7IGNvbG9yOiBudWxsLCBob2xsb3c6IGZhbHNlIH07XG4gIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHBsdWdpbjtcbiAgY29uc3QgdHlwQ29sb3IgPSBzZXR0aW5ncy50eXBDb2xvcnNbdHlwXTtcbiAgaWYgKCF0eXBDb2xvcikge1xuICAgIHJldHVybiBzZXR0aW5ncy50eXBzLmluY2x1ZGVzKHR5cCkgPyB7IGNvbG9yOiBERUZBVUxUX0RPVF9DT0xPUiwgaG9sbG93OiB0cnVlIH0gOiB7IGNvbG9yOiBudWxsLCBob2xsb3c6IGZhbHNlIH07XG4gIH1cbiAgY29uc3Qgc3VidHlwID0gcGx1Z2luLnR5cEluZGV4LnN1YnR5cE9mKGZpbGUpO1xuICBpZiAoc2V0dGluZ3MuY29sb3JWaWV3cy5ub3RlVGl0bGVNYXJrZXJTdWJ0eXAgJiYgc3VidHlwICYmIGdldFN1YnR5cChzZXR0aW5ncywgdHlwLCBzdWJ0eXApKSB7XG4gICAgcmV0dXJuIHsgY29sb3I6IHN1YnR5cENvbG9yKHNldHRpbmdzLCB0eXAsIHN1YnR5cCksIGhvbGxvdzogIXN1YnR5cEhhc093bkNvbG9yKHNldHRpbmdzLCB0eXAsIHN1YnR5cCkgfTtcbiAgfVxuICByZXR1cm4geyBjb2xvcjogdHlwQ29sb3IsIGhvbGxvdzogZmFsc2UgfTtcbn1cblxuLy8gVGhlIG5vdGUncyBpbmxpbmUgdGl0bGUuIERvbmUgYXMgOjpiZWZvcmUgKHNlZSBzdHlsZXMuY3NzKSwgbm90IGFzIGFuIGV4dHJhXG4vLyBlbGVtZW50IG9yIHdyYXBwZXI6IHNldmVyYWwgdGhlbWVzIChNaW5pbWFsIGFtb25nIHRoZW0pIHN0eWxlIC5pbmxpbmUtdGl0bGVcbi8vIHdpdGggY2hpbGQgc2VsZWN0b3JzLCB3aGljaCBhbiBleHRyYSBlbGVtZW50IHdvdWxkIGJyZWFrLiBBIDo6YmVmb3JlIGNhbid0XG4vLyBiZSBnaXZlbiBhIGNvbG9yIG9yIHRleHQgZGlyZWN0bHksIGhlbmNlIHRoZSBDU1MgdmFyaWFibGUgYW5kIHRoZSBkYXRhXG4vLyBhdHRyaWJ1dGUgdGhhdCBpdHMgcnVsZXMgcmVhZCAodmFyKCkvYXR0cigpKS5cbmZ1bmN0aW9uIGFwcGx5U3R5bGVUb1RpdGxlKHRpdGxlRWwsIG1hcmtlcikge1xuICBjb25zdCBpc0RvdCA9IG1hcmtlci5raW5kID09PSBcImRvdFwiICYmICEhbWFya2VyLmNvbG9yO1xuICBjb25zdCBpc0JhZGdlID0gbWFya2VyLmtpbmQgPT09IFwidGl0bGUtYmFkZ2VcIjtcblxuICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoRE9UX0NMQVNTLCBpc0RvdCk7XG4gIHRpdGxlRWwuY2xhc3NMaXN0LnRvZ2dsZShET1RfSE9MTE9XX0NMQVNTLCBpc0RvdCAmJiAhIW1hcmtlci5ob2xsb3cpO1xuICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoQkFER0VfQ0xBU1MsIGlzQmFkZ2UgJiYgbWFya2VyLmNvbG9yZWQpO1xuICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoQkFER0VfUExBSU5fQ0xBU1MsIGlzQmFkZ2UgJiYgIW1hcmtlci5jb2xvcmVkKTtcblxuICBpZiAoaXNCYWRnZSkgdGl0bGVFbC5kYXRhc2V0LnR5cCA9IG1hcmtlci50eXBOYW1lO1xuICBlbHNlIGRlbGV0ZSB0aXRsZUVsLmRhdGFzZXQudHlwO1xuXG4gIGNvbnN0IG1hcmtlckNvbG9yID0gKGlzRG90ICYmIG1hcmtlci5jb2xvcikgfHwgKGlzQmFkZ2UgJiYgbWFya2VyLmNvbG9yZWQgJiYgbWFya2VyLmNvbG9yKSA/IG1hcmtlci5jb2xvciA6IG51bGw7XG4gIGlmIChtYXJrZXJDb2xvcikgdGl0bGVFbC5zdHlsZS5zZXRQcm9wZXJ0eShDT0xPUl9WQVIsIG1hcmtlckNvbG9yKTtcbiAgZWxzZSB0aXRsZUVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KENPTE9SX1ZBUik7XG59XG5cbi8vIFRoZSBub3RlJ3MgcHJvcGVydHkgYmxvY2sgKC5tZXRhZGF0YS1jb250YWluZXIpLCBmb3IgcG9zaXRpb24gXCJibG9ja1wiOiB0aGVcbi8vIHNhbWUgYmFkZ2UsIHR1cm5lZCA5MFx1MDBCMCAod3JpdGluZy1tb2RlIHJhdGhlciB0aGFuIHJvdGF0ZSgpLCBzbyBpdCBncm93cyB3aXRoXG4vLyB0aGUgdGV4dCBpbiB0aGUgcmlnaHQgZGlyZWN0aW9uKSBhbmQgYW5jaG9yZWQgbGVmdCBhdCB0aGUgYmxvY2ssIHRvcCBvclxuLy8gYm90dG9tLiBBcyBhIDo6YmVmb3JlIGl0IGhpZGVzIGFuZCBzaG93cyB3aXRoIHRoZSBibG9jayAoUHJvcGVydHktQmxvY2suY3NzKS5cbmZ1bmN0aW9uIGFwcGx5U3R5bGVUb0Jsb2NrKHBsdWdpbiwgYmxvY2tFbCwgbWFya2VyKSB7XG4gIGNvbnN0IGlzQmxvY2tCYWRnZSA9IG1hcmtlci5raW5kID09PSBcImJsb2NrLWJhZGdlXCI7XG5cbiAgYmxvY2tFbC5jbGFzc0xpc3QudG9nZ2xlKEJMT0NLX0JBREdFX0NMQVNTLCBpc0Jsb2NrQmFkZ2UgJiYgbWFya2VyLmNvbG9yZWQpO1xuICBibG9ja0VsLmNsYXNzTGlzdC50b2dnbGUoQkxPQ0tfQkFER0VfUExBSU5fQ0xBU1MsIGlzQmxvY2tCYWRnZSAmJiAhbWFya2VyLmNvbG9yZWQpO1xuXG4gIGNvbnN0IGFsaWduID0gcGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVZlcnRpY2FsQWxpZ247XG4gIGJsb2NrRWwuY2xhc3NMaXN0LnRvZ2dsZShCTE9DS19BTElHTl9UT1BfQ0xBU1MsIGlzQmxvY2tCYWRnZSAmJiBhbGlnbiAhPT0gXCJib3R0b21cIik7XG4gIGJsb2NrRWwuY2xhc3NMaXN0LnRvZ2dsZShCTE9DS19BTElHTl9CT1RUT01fQ0xBU1MsIGlzQmxvY2tCYWRnZSAmJiBhbGlnbiA9PT0gXCJib3R0b21cIik7XG5cbiAgaWYgKGlzQmxvY2tCYWRnZSkgYmxvY2tFbC5kYXRhc2V0LnR5cCA9IG1hcmtlci50eXBOYW1lO1xuICBlbHNlIGRlbGV0ZSBibG9ja0VsLmRhdGFzZXQudHlwO1xuXG4gIGNvbnN0IGJsb2NrQ29sb3IgPSBpc0Jsb2NrQmFkZ2UgJiYgbWFya2VyLmNvbG9yZWQgJiYgbWFya2VyLmNvbG9yID8gbWFya2VyLmNvbG9yIDogbnVsbDtcbiAgaWYgKGJsb2NrQ29sb3IpIGJsb2NrRWwuc3R5bGUuc2V0UHJvcGVydHkoQkxPQ0tfQ09MT1JfVkFSLCBibG9ja0NvbG9yKTtcbiAgZWxzZSBibG9ja0VsLnN0eWxlLnJlbW92ZVByb3BlcnR5KEJMT0NLX0NPTE9SX1ZBUik7XG59XG5cbmZ1bmN0aW9uIGFwcGx5QWN0aXZlVGl0bGVDb2xvcnMocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xuICAgIGNvbnN0IGNvbnRhaW5lckVsID0gbGVhZi52aWV3LmNvbnRhaW5lckVsO1xuICAgIGNvbnN0IGZpbGUgPSBsZWFmLnZpZXcuZmlsZTtcbiAgICBjb25zdCB0eXBlZEZpbGUgPSBmaWxlIGluc3RhbmNlb2YgVEZpbGUgPyBmaWxlIDogbnVsbDtcbiAgICBjb25zdCBtYXJrZXIgPSByZXNvbHZlTWFya2VyKHBsdWdpbiwgdHlwZWRGaWxlKTtcblxuICAgIGNvbnN0IHRpdGxlRWwgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKFwiLmlubGluZS10aXRsZVwiKTtcbiAgICBpZiAodGl0bGVFbCkge1xuICAgICAgYXBwbHlTdHlsZVRvVGl0bGUodGl0bGVFbCwgbWFya2VyKTtcblxuICAgICAgY29uc3QgdGV4dENvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Mubm90ZVRpdGxlQ29sb3IgPyBjb2xvckZvckZpbGUocGx1Z2luLCB0eXBlZEZpbGUsIFwibm90ZVRpdGxlQ29sb3JcIikgOiBudWxsO1xuICAgICAgaWYgKHRleHRDb2xvcikgdGl0bGVFbC5zdHlsZS5jb2xvciA9IHRleHRDb2xvcjtcbiAgICAgIGVsc2UgdGl0bGVFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImNvbG9yXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IGJsb2NrRWwgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKFwiLm1ldGFkYXRhLWNvbnRhaW5lclwiKTtcbiAgICBpZiAoYmxvY2tFbCkgYXBwbHlTdHlsZVRvQmxvY2socGx1Z2luLCBibG9ja0VsLCBtYXJrZXIpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseUFjdGl2ZVRpdGxlQ29sb3JzKHBsdWdpbik7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJmaWxlLW9wZW5cIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImFjdGl2ZS1sZWFmLWNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCByZWZyZXNoKSk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeShyZWZyZXNoKTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnMgfTtcbiIsICJjb25zdCB7IGVkaXRvckluZm9GaWVsZCwgZ2V0TGlua3BhdGggfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgVmlld1BsdWdpbiwgRGVjb3JhdGlvbiB9ID0gcmVxdWlyZShcIkBjb2RlbWlycm9yL3ZpZXdcIik7XG5jb25zdCB7IFByZWMsIFJhbmdlU2V0QnVpbGRlciwgU3RhdGVFZmZlY3QgfSA9IHJlcXVpcmUoXCJAY29kZW1pcnJvci9zdGF0ZVwiKTtcbmNvbnN0IHsgc3ludGF4VHJlZSB9ID0gcmVxdWlyZShcIkBjb2RlbWlycm9yL2xhbmd1YWdlXCIpO1xuY29uc3QgeyBjb2xvckZvckZpbGUgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5cbi8vIENvbG9ycyBsaW5rcyBpbiBub3RlIHRleHQgYnkgdGhlIFRZUCBvZiB0aGVpciB0YXJnZXQuIE9ic2lkaWFuIGNvbG9yc1xuLy8gaW50ZXJuYWwgbGlua3MgdGhyb3VnaCB2YXIoLS1saW5rLWNvbG9yKSwgc28gb25seSB0aGF0IHZhcmlhYmxlIGlzIHNldCBwZXJcbi8vIGxpbmsuIC0tbGluay1jb2xvci1ob3ZlciBzdGF5cyB1bnRvdWNoZWQgKGhvdmVyIHNob3dzIHRoZSBub3JtYWwgbGluayBjb2xvciksXG4vLyBhbmQgdW5kZXJsaW5lIGFuZCB0aGVtZSB0d2Vha3Mga2VlcCB3b3JraW5nLlxuLy9cbi8vIFR3byBzZXBhcmF0ZSBwYXRocywgYmVjYXVzZSB0aGUgdHdvIHJlbmRlcmluZ3MgaGF2ZSBub3RoaW5nIGluIGNvbW1vbjpcbi8vICAtIFJlYWRpbmcgdmlldywgaG92ZXIgcHJldmlldyBhbmQgcmVuZGVyZWQgYmxvY2tzIGluIExpdmUgUHJldmlldyAodGFibGVzLFxuLy8gICAgY2FsbG91dHMpOiByZWFsIDxhIGNsYXNzPVwiaW50ZXJuYWwtbGlua1wiIGRhdGEtaHJlZj4gZWxlbWVudHMgLT5cbi8vICAgIG1hcmtkb3duIHBvc3QtcHJvY2Vzc29yLCBvbmNlIHBlciBsaW5rIHdoZW4gcmVuZGVyZWQuXG4vLyAgLSBMaXZlIFByZXZpZXcvc291cmNlIG1vZGU6IG9ubHkgQ29kZU1pcnJvciBzcGFucyBvdmVyIHRoZSByYXcgdGV4dCAtPlxuLy8gICAgYSBWaWV3UGx1Z2luIHRoYXQgbG9va3MgYXQgdGhlIHZpc2libGUgcmFuZ2Ugb25seS5cbi8vXG4vLyBSZWNvbG9yaW5nIG90aGVyd2lzZSBvbmx5IGhhcHBlbnMgb24gYSByZWFsIFRZUCBjaGFuZ2UgKHR5cEluZGV4IFwiY2hhbmdlXCIpXG4vLyBvciBhIHNldHRpbmdzIGNoYW5nZSwgbm90IG9uIGV2ZXJ5IHNhdmUuXG5cbmNvbnN0IENPTE9SX1ZBUiA9IFwiLS1saW5rLWNvbG9yXCI7XG5jb25zdCBTT1VSQ0VfQVRUUiA9IFwiZGF0YS10eXAtc3JjXCI7XG5cbi8vIFtbdGFyZ2V0XV0sIFtbdGFyZ2V0fGFsaWFzXV0sIFtbdGFyZ2V0I2hlYWRpbmddXS4gRW1iZWRzICghW1tcdTIwMjZdXSkgYXJlIG5vdFxuLy8gbGlua3MuIEluc2lkZSB0YWJsZXMgdGhlIGFsaWFzIHBpcGUgaXMgZXNjYXBlZCAoXCJcXHxcIikuXG5jb25zdCBXSUtJTElOS19QQVRURVJOID0gLyg/PCEhKVxcW1xcWyhbXltcXF1dKz8pXFxdXFxdL2c7XG5cbmZ1bmN0aW9uIGNvbG9yRm9yTGlua3RleHQocGx1Z2luLCBsaW5rdGV4dCwgc291cmNlUGF0aCkge1xuICBjb25zdCB0YXJnZXQgPSBsaW5rdGV4dC5zcGxpdCgvXFxcXD9cXHwvKVswXS50cmltKCk7XG4gIGNvbnN0IGxpbmtwYXRoID0gZ2V0TGlua3BhdGgodGFyZ2V0KTtcbiAgaWYgKCFsaW5rcGF0aCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGZpbGUgPSBwbHVnaW4uYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0Rmlyc3RMaW5rcGF0aERlc3QobGlua3BhdGgsIHNvdXJjZVBhdGgpO1xuICByZXR1cm4gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSwgXCJsaW5rc1wiKTtcbn1cblxuLy8gLS0tIFJlYWRpbmcgdmlldyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmZ1bmN0aW9uIGFwcGx5VG9BbmNob3IocGx1Z2luLCBhbmNob3JFbCkge1xuICBjb25zdCBocmVmID0gYW5jaG9yRWwuZ2V0QXR0cmlidXRlKFwiZGF0YS1ocmVmXCIpO1xuICBjb25zdCBjb2xvciA9XG4gICAgcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MubGlua3MgJiYgaHJlZiAmJiAhYW5jaG9yRWwuY2xhc3NMaXN0LmNvbnRhaW5zKFwiaXMtdW5yZXNvbHZlZFwiKVxuICAgICAgPyBjb2xvckZvckxpbmt0ZXh0KHBsdWdpbiwgaHJlZiwgYW5jaG9yRWwuZ2V0QXR0cmlidXRlKFNPVVJDRV9BVFRSKSA/PyBcIlwiKVxuICAgICAgOiBudWxsO1xuICBpZiAoY29sb3IpIGFuY2hvckVsLnN0eWxlLnNldFByb3BlcnR5KENPTE9SX1ZBUiwgY29sb3IpO1xuICBlbHNlIGFuY2hvckVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KENPTE9SX1ZBUik7XG59XG5cbi8vIFJlY29sb3JzIGxpbmtzIHRoYXQgYXJlIGFscmVhZHkgcmVuZGVyZWQuIFRoZSBwb3N0LXByb2Nlc3NvciBzdG9yZXMgZWFjaFxuLy8gbGluaydzIHNvdXJjZSBub3RlIG9uIGl0LCB3aGljaCBhbWJpZ3VvdXMgbGluayB0ZXh0IG5lZWRzIHRvIHJlc29sdmUuXG4vLyBDb2xsZWN0cyBhbGwgd2luZG93cyAocG9wLW91dHMgaW5jbHVkZWQpIHRocm91Z2ggdGhlaXIgbGVhdmVzLlxuZnVuY3Rpb24gcmVmcmVzaFJlbmRlcmVkTGlua3MocGx1Z2luKSB7XG4gIGNvbnN0IGRvY3MgPSBuZXcgU2V0KCk7XG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLml0ZXJhdGVBbGxMZWF2ZXMoKGxlYWYpID0+IGRvY3MuYWRkKGxlYWYudmlldy5jb250YWluZXJFbC5vd25lckRvY3VtZW50KSk7XG4gIGZvciAoY29uc3QgZG9jIG9mIGRvY3MpIHtcbiAgICBmb3IgKGNvbnN0IGFuY2hvckVsIG9mIGRvYy5xdWVyeVNlbGVjdG9yQWxsKGBhLmludGVybmFsLWxpbmtbJHtTT1VSQ0VfQVRUUn1dYCkpIGFwcGx5VG9BbmNob3IocGx1Z2luLCBhbmNob3JFbCk7XG4gIH1cbn1cblxuLy8gLS0tIExpdmUgUHJldmlldyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IHJlZnJlc2hFZmZlY3QgPSBTdGF0ZUVmZmVjdC5kZWZpbmUoKTtcblxuZnVuY3Rpb24gYnVpbGRMaW5rVmlld1BsdWdpbihwbHVnaW4pIHtcbiAgY29uc3QgZGVjb3JhdGlvbnNCeUNvbG9yID0gbmV3IE1hcCgpO1xuICBjb25zdCBkZWNvcmF0aW9uRm9yID0gKGNvbG9yKSA9PiB7XG4gICAgbGV0IGRlY29yYXRpb24gPSBkZWNvcmF0aW9uc0J5Q29sb3IuZ2V0KGNvbG9yKTtcbiAgICBpZiAoIWRlY29yYXRpb24pIHtcbiAgICAgIGRlY29yYXRpb24gPSBEZWNvcmF0aW9uLm1hcmsoe1xuICAgICAgICBjbGFzczogXCJ0eXAtbGlua1wiLFxuICAgICAgICBhdHRyaWJ1dGVzOiB7IHN0eWxlOiBgJHtDT0xPUl9WQVJ9OiAke2NvbG9yfTtgIH0sXG4gICAgICB9KTtcbiAgICAgIGRlY29yYXRpb25zQnlDb2xvci5zZXQoY29sb3IsIGRlY29yYXRpb24pO1xuICAgIH1cbiAgICByZXR1cm4gZGVjb3JhdGlvbjtcbiAgfTtcblxuICBjb25zdCBidWlsZCA9ICh2aWV3KSA9PiB7XG4gICAgaWYgKCFwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5saW5rcykgcmV0dXJuIERlY29yYXRpb24ubm9uZTtcbiAgICBjb25zdCBzb3VyY2VQYXRoID0gdmlldy5zdGF0ZS5maWVsZChlZGl0b3JJbmZvRmllbGQsIGZhbHNlKT8uZmlsZT8ucGF0aCA/PyBcIlwiO1xuICAgIGNvbnN0IHRyZWUgPSBzeW50YXhUcmVlKHZpZXcuc3RhdGUpO1xuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgUmFuZ2VTZXRCdWlsZGVyKCk7XG5cbiAgICBmb3IgKGNvbnN0IHsgZnJvbSwgdG8gfSBvZiB2aWV3LnZpc2libGVSYW5nZXMpIHtcbiAgICAgIGNvbnN0IHRleHQgPSB2aWV3LnN0YXRlLnNsaWNlRG9jKGZyb20sIHRvKTtcbiAgICAgIFdJS0lMSU5LX1BBVFRFUk4ubGFzdEluZGV4ID0gMDtcbiAgICAgIGZvciAobGV0IG1hdGNoOyAobWF0Y2ggPSBXSUtJTElOS19QQVRURVJOLmV4ZWModGV4dCkpOyApIHtcbiAgICAgICAgY29uc3Qgc3RhcnQgPSBmcm9tICsgbWF0Y2guaW5kZXg7XG4gICAgICAgIC8vIE9ubHkgd2hhdCBPYnNpZGlhbidzIHBhcnNlciB0cmVhdHMgYXMgYW4gaW50ZXJuYWwgbGluaywgd2hpY2ggcnVsZXNcbiAgICAgICAgLy8gb3V0IFtbXHUyMDI2XV0gaW4gY29kZSBibG9ja3MgYW5kIGlubGluZSBjb2RlLlxuICAgICAgICBpZiAoIXRyZWUucmVzb2x2ZUlubmVyKHN0YXJ0ICsgMiwgMSkubmFtZS5pbmNsdWRlcyhcImhtZC1pbnRlcm5hbC1saW5rXCIpKSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgY29sb3IgPSBjb2xvckZvckxpbmt0ZXh0KHBsdWdpbiwgbWF0Y2hbMV0sIHNvdXJjZVBhdGgpO1xuICAgICAgICBpZiAoY29sb3IpIGJ1aWxkZXIuYWRkKHN0YXJ0LCBzdGFydCArIG1hdGNoWzBdLmxlbmd0aCwgZGVjb3JhdGlvbkZvcihjb2xvcikpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gYnVpbGRlci5maW5pc2goKTtcbiAgfTtcblxuICByZXR1cm4gVmlld1BsdWdpbi5mcm9tQ2xhc3MoXG4gICAgY2xhc3Mge1xuICAgICAgY29uc3RydWN0b3Iodmlldykge1xuICAgICAgICB0aGlzLmRlY29yYXRpb25zID0gYnVpbGQodmlldyk7XG4gICAgICB9XG5cbiAgICAgIC8vIFRoZSBwYXJzZXIgbWF5IHdvcmsgdGhyb3VnaCB0aGUgdmlzaWJsZSByYW5nZSBiaXQgYnkgYml0LCBzbyBhIG5ld1xuICAgICAgLy8gc3ludGF4IHRyZWUgYWxzbyB0cmlnZ2VycyBhIHJlYnVpbGQuXG4gICAgICB1cGRhdGUodXBkYXRlKSB7XG4gICAgICAgIGlmIChcbiAgICAgICAgICB1cGRhdGUuZG9jQ2hhbmdlZCB8fFxuICAgICAgICAgIHVwZGF0ZS52aWV3cG9ydENoYW5nZWQgfHxcbiAgICAgICAgICBzeW50YXhUcmVlKHVwZGF0ZS5zdGFydFN0YXRlKSAhPT0gc3ludGF4VHJlZSh1cGRhdGUuc3RhdGUpIHx8XG4gICAgICAgICAgdXBkYXRlLnRyYW5zYWN0aW9ucy5zb21lKCh0cikgPT4gdHIuZWZmZWN0cy5zb21lKChlZmZlY3QpID0+IGVmZmVjdC5pcyhyZWZyZXNoRWZmZWN0KSkpXG4gICAgICAgICkge1xuICAgICAgICAgIHRoaXMuZGVjb3JhdGlvbnMgPSBidWlsZCh1cGRhdGUudmlldyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LFxuICAgIHsgZGVjb3JhdGlvbnM6ICh2YWx1ZSkgPT4gdmFsdWUuZGVjb3JhdGlvbnMgfVxuICApO1xufVxuXG5mdW5jdGlvbiByZWZyZXNoRWRpdG9ycyhwbHVnaW4pIHtcbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2UuaXRlcmF0ZUFsbExlYXZlcygobGVhZikgPT4ge1xuICAgIGxlYWYudmlldz8uZWRpdG9yPy5jbT8uZGlzcGF0Y2goeyBlZmZlY3RzOiByZWZyZXNoRWZmZWN0Lm9mKG51bGwpIH0pO1xuICB9KTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmZ1bmN0aW9uIHJlZ2lzdGVyTGlua0NvbG9ycyhwbHVnaW4pIHtcbiAgcGx1Z2luLnJlZ2lzdGVyTWFya2Rvd25Qb3N0UHJvY2Vzc29yKChlbCwgY3R4KSA9PiB7XG4gICAgLy8gU3RvcmUgdGhlIHNvdXJjZSBldmVuIHdoaWxlIGNvbG9yaW5nIGlzIG9mZiwgc28gdHVybmluZyBpdCBvbiBsYXRlclxuICAgIC8vIGFsc28gY292ZXJzIGxpbmtzIHRoYXQgYXJlIGFscmVhZHkgcmVuZGVyZWQuXG4gICAgZm9yIChjb25zdCBhbmNob3JFbCBvZiBlbC5xdWVyeVNlbGVjdG9yQWxsKFwiYS5pbnRlcm5hbC1saW5rXCIpKSB7XG4gICAgICBhbmNob3JFbC5zZXRBdHRyaWJ1dGUoU09VUkNFX0FUVFIsIGN0eC5zb3VyY2VQYXRoKTtcbiAgICAgIGFwcGx5VG9BbmNob3IocGx1Z2luLCBhbmNob3JFbCk7XG4gICAgfVxuICB9KTtcbiAgLy8gT2JzaWRpYW4ncyBcIi5jbS1obWQtaW50ZXJuYWwtbGlua1wiIHNwYW4gYWx3YXlzIGVuZHMgdXAgb3V0c2lkZSBvdXIgbWFyayxcbiAgLy8gd2hhdGV2ZXIgdGhlIHByaW9yaXR5LCBzbyBhIHJ1bGUgaW4gc3R5bGVzLmNzcyAoLnR5cC1saW5rKSBzZXRzIHRoZSBjb2xvci5cbiAgLy8gTG93ZXN0IHByaW9yaXR5IGF0IGxlYXN0IHdyYXBzIFwiLmNtLXVuZGVybGluZVwiLCBjb3ZlcmluZyB0aGUgd2hvbGUgdGV4dC5cbiAgcGx1Z2luLnJlZ2lzdGVyRWRpdG9yRXh0ZW5zaW9uKFByZWMubG93ZXN0KGJ1aWxkTGlua1ZpZXdQbHVnaW4ocGx1Z2luKSkpO1xuXG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiB7XG4gICAgcmVmcmVzaFJlbmRlcmVkTGlua3MocGx1Z2luKTtcbiAgICByZWZyZXNoRWRpdG9ycyhwbHVnaW4pO1xuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICAvLyBFZGl0b3IgZGVjb3JhdGlvbnMgZ28gYXdheSB3aXRoIHRoZSBleHRlbnNpb24gb24gdW5sb2FkLCB0aGUgaW5saW5lXG4gIC8vIHZhcmlhYmxlcyBvbiByZW5kZXJlZCBsaW5rcyBkb24ndC5cbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IHtcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5pdGVyYXRlQWxsTGVhdmVzKChsZWFmKSA9PiB7XG4gICAgICBmb3IgKGNvbnN0IGFuY2hvckVsIG9mIGxlYWYudmlldy5jb250YWluZXJFbC5xdWVyeVNlbGVjdG9yQWxsKGBhLmludGVybmFsLWxpbmtbJHtTT1VSQ0VfQVRUUn1dYCkpIHtcbiAgICAgICAgYW5jaG9yRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoQ09MT1JfVkFSKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSk7XG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJMaW5rQ29sb3JzIH07XG4iLCAiY29uc3QgeyBnZXRTdWJ0eXBOYW1lcywgZ2V0U3VidHlwIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBzXCIpO1xuY29uc3QgeyBzdWJ0eXBDb2xvciB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcbmNvbnN0IHsgVklFV19UWVBFX1RZUF9QQU5FIH0gPSByZXF1aXJlKFwiLi90eXAtcGFuZVwiKTtcblxuY29uc3QgQUxMX1BST1BFUlRJRVNfVklFV19UWVBFID0gXCJhbGwtcHJvcGVydGllc1wiO1xuY29uc3QgSElHSExJR0hUX0NMQVNTID0gXCJ0eXAtZGVmYXVsdC1wcm9wZXJ0eVwiO1xuLy8gRmxvYXRpbmcgcHJvcGVydGllcyBhcmUgbWFya2VkIGl0YWxpYyBpbnN0ZWFkIG9mIGJvbGQuXG5jb25zdCBGTE9BVElOR19DTEFTUyA9IFwidHlwLWZsb2F0aW5nLXByb3BlcnR5XCI7XG5cbi8vIE9ic2lkaWFuIGFsd2F5cyBsb3dlcmNhc2VzIGRhdGEtcHJvcGVydHkta2V5LCBzbyBjb21wYXJpc29ucyBpZ25vcmUgY2FzZS5cbmZ1bmN0aW9uIHJhd0tleXNGb3JUeXAodHlwLCBkZWZhdWx0cykge1xuICBpZiAoIXR5cCB8fCAhZGVmYXVsdHMpIHJldHVybiBudWxsO1xuICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXMoZGVmYXVsdHMpLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwiXCIpO1xuICByZXR1cm4ga2V5cy5sZW5ndGggPiAwID8ga2V5cy5tYXAoKGtleSkgPT4ga2V5LnRvTG93ZXJDYXNlKCkpIDogbnVsbDtcbn1cblxuLy8gQSBUWVAncyBmcm9udG1hdHRlciBibG9ja3MgYXMgW3sgc2VjdGlvbiwga2V5cywgZmxvYXRpbmcgfV0gKGxvd2VyY2FzZSk6XG4vLyB0aGUgVFlQLUZyb250bWF0dGVyIGZpcnN0LCB0aGVuIG9wdGlvbmFsbHkgb25lIFN1YnR5cCdzIGJsb2NrIG9yLCB3aXRoXG4vLyBBTExfU1VCVFlQUywgZXZlcnkgU3VidHlwJ3MgYmxvY2sgKHNlZSBzdWJ0eXBzLmpzKS5cbmNvbnN0IEFMTF9TVUJUWVBTID0gU3ltYm9sKFwiYWxsLXN1YnR5cHNcIik7XG5cbmZ1bmN0aW9uIGJsb2NrT2YoZGVmYXVsdHMsIGZsb2F0aW5nS2V5cywgc2VjdGlvbiA9IG51bGwpIHtcbiAgY29uc3Qga2V5cyA9IHJhd0tleXNGb3JUeXAodHJ1ZSwgZGVmYXVsdHMpID8/IFtdO1xuICByZXR1cm4geyBzZWN0aW9uLCBrZXlzLCBmbG9hdGluZzogbmV3IFNldCgoZmxvYXRpbmdLZXlzID8/IFtdKS5tYXAoKGtleSkgPT4ga2V5LnRvTG93ZXJDYXNlKCkpKSB9O1xufVxuXG5mdW5jdGlvbiBibG9ja3NGb3JUeXAocGx1Z2luLCB0eXAsIHN1YnR5cCkge1xuICBjb25zdCB7IHNldHRpbmdzIH0gPSBwbHVnaW47XG4gIGNvbnN0IGJsb2NrcyA9IFtibG9ja09mKHNldHRpbmdzLnR5cERlZmF1bHRGcm9udG1hdHRlclt0eXBdLCBzZXR0aW5ncy50eXBGbG9hdGluZ0tleXNbdHlwXSwgbnVsbCldO1xuICBjb25zdCBzdWJ0eXBOYW1lcyA9IHN1YnR5cCA9PT0gQUxMX1NVQlRZUFMgPyBnZXRTdWJ0eXBOYW1lcyhzZXR0aW5ncywgdHlwKSA6IHN1YnR5cCA/IFtzdWJ0eXBdIDogW107XG4gIGZvciAoY29uc3QgbmFtZSBvZiBzdWJ0eXBOYW1lcykge1xuICAgIGNvbnN0IGRhdGEgPSBnZXRTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgbmFtZSk7XG4gICAgaWYgKGRhdGEpIGJsb2Nrcy5wdXNoKGJsb2NrT2YoZGF0YS5mcm9udG1hdHRlciwgZGF0YS5mbG9hdGluZ0tleXMsIG5hbWUpKTtcbiAgfVxuICByZXR1cm4gYmxvY2tzO1xufVxuXG4vLyBTZXBhcmF0ZSBzZXRzIG9mIG5hbWVzIHRvIGJvbGQgKFwic3RhbmRhcmRcIikgYW5kIHRvIGl0YWxpY2l6ZSAoXCJmbG9hdGluZ1wiKS5cbi8vIEEgZmxvYXRpbmcga2V5IG5ldmVyIGFsc28gY291bnRzIGFzIHN0YW5kYXJkLiBJZiBhIGtleSBpcyBpbiBzZXZlcmFsIGJsb2Nrcyxcbi8vIHRoZSBsYXRlciBibG9jayBkZWNpZGVzIC0gZm9yIGEgbm90ZSB0aGF0IGlzIGl0cyBTdWJ0eXAgYmxvY2ssIHRoZSBzYW1lIHJ1bGVcbi8vIGFzIGZvciB0aGUgdmFsdWUgaW4gZ2V0VHlwRGVmYXVsdHMgKG1haW4uanMpLlxuZnVuY3Rpb24gc3BsaXRLZXlzKGJsb2Nrcykge1xuICBjb25zdCBpc0Zsb2F0aW5nID0gbmV3IE1hcCgpO1xuICBmb3IgKGNvbnN0IHsga2V5cywgZmxvYXRpbmcgfSBvZiBibG9ja3MpIHtcbiAgICBmb3IgKGNvbnN0IGtleSBvZiBrZXlzKSBpc0Zsb2F0aW5nLnNldChrZXksIGZsb2F0aW5nLmhhcyhrZXkpKTtcbiAgfVxuICBjb25zdCBzdGFuZGFyZCA9IG5ldyBTZXQoKTtcbiAgY29uc3QgZmxvYXRpbmcgPSBuZXcgU2V0KCk7XG4gIGZvciAoY29uc3QgW2tleSwgZmxhZ10gb2YgaXNGbG9hdGluZykgKGZsYWcgPyBmbG9hdGluZyA6IHN0YW5kYXJkKS5hZGQoa2V5KTtcbiAgcmV0dXJuIHsgc3RhbmRhcmQ6IHN0YW5kYXJkLnNpemUgPiAwID8gc3RhbmRhcmQgOiBudWxsLCBmbG9hdGluZzogZmxvYXRpbmcuc2l6ZSA+IDAgPyBmbG9hdGluZyA6IG51bGwgfTtcbn1cblxuY29uc3QgTk9fS0VZUyA9IHsgc3RhbmRhcmQ6IG51bGwsIGZsb2F0aW5nOiBudWxsIH07XG5cbmZ1bmN0aW9uIGtleXNGb3JGaWxlKHBsdWdpbiwgZmlsZSkge1xuICBjb25zdCB7IGNvbG9yVmlld3MgfSA9IHBsdWdpbi5zZXR0aW5ncztcbiAgaWYgKCFjb2xvclZpZXdzLmZyb250bWF0dGVyRGVmYXVsdHMpIHJldHVybiBOT19LRVlTO1xuICBjb25zdCB0eXAgPSBwbHVnaW4udHlwSW5kZXgudHlwT2YoZmlsZSk7XG4gIGlmICghdHlwKSByZXR1cm4gTk9fS0VZUztcbiAgY29uc3Qgc3VidHlwID0gY29sb3JWaWV3cy5mcm9udG1hdHRlckRlZmF1bHRzU3VidHlwID8gcGx1Z2luLnR5cEluZGV4LnN1YnR5cE9mKGZpbGUpIDogbnVsbDtcbiAgcmV0dXJuIHNwbGl0S2V5cyhibG9ja3NGb3JUeXAocGx1Z2luLCB0eXAsIHN1YnR5cCkpO1xufVxuXG4vLyBUWVAtUGFuZSBkZXRhaWwgZWRpdG9yczogb25lIGVkaXRvciBwZXIgYmxvY2sgKHNlZSB0eXBTdG9yZS9zdWJ0eXBTdG9yZSBpblxuLy8gdHlwLWZyb250bWF0dGVyLWVkaXRvci5qcyksIHNvIHRoZSBtYXJrcyBzaG93IGV4YWN0bHkgdGhhdCBibG9jaydzIGtleXMuXG4vLyBTdWJ0eXAgYmxvY2tzIG9ubHkgd2l0aCB0aGUgXCJTdWJ0eXBcIiBzdWItdG9nZ2xlLlxuZnVuY3Rpb24ga2V5c0ZvclN0b3JlKHBsdWdpbiwgc3RvcmUpIHtcbiAgY29uc3QgeyBjb2xvclZpZXdzIH0gPSBwbHVnaW4uc2V0dGluZ3M7XG4gIGlmICghY29sb3JWaWV3cy5mcm9udG1hdHRlckRlZmF1bHRzIHx8ICFzdG9yZSkgcmV0dXJuIE5PX0tFWVM7XG4gIGlmIChzdG9yZS5zdWJ0eXAgJiYgIWNvbG9yVmlld3MuZnJvbnRtYXR0ZXJEZWZhdWx0c1N1YnR5cCkgcmV0dXJuIE5PX0tFWVM7XG4gIHJldHVybiBzcGxpdEtleXMoW2Jsb2NrT2Yoc3RvcmUuZ2V0RnJvbnRtYXR0ZXIoKSwgc3RvcmUuZ2V0RmxvYXRpbmcoKSldKTtcbn1cblxuLy8gUHJvcGVydHkgbmFtZSAobG93ZXJjYXNlKSAtPiB7IHR5cHMsIGFsbEZsb2F0aW5nIH0gYWNyb3NzIGV2ZXJ5IFRZUCB3aG9zZVxuLy8gZnJvbnRtYXR0ZXIgKG9wdGlvbmFsbHkgd2l0aCBpdHMgU3VidHlwIGJsb2NrcykgaGFzIGl0LiBcIkFsbCBwcm9wZXJ0aWVzXCIgaXNcbi8vIHZhdWx0LXdpZGUgd2l0aCBubyBzaW5nbGUgVFlQIGNvbnRleHQsIHNvIHRoZSBmdWxsIG1hcHBpbmcgaXMgY29sbGVjdGVkIHRvXG4vLyB0ZWxsIFwiZXhhY3RseSBvbmUgVFlQXCIgKGNvbG9yKSBmcm9tIFwic2V2ZXJhbFwiIChib2xkKS4gdHlwcyBtYXBzIFRZUCAtPiB0aGVcbi8vIGJsb2NrcyBob2xkaW5nIHRoZSBrZXkgKG51bGwgPSB0aGUgVFlQLUZyb250bWF0dGVyKTsgb25seSB0aGUgdW5hbWJpZ3VvdXNcbi8vIGNhc2UgZ2V0cyBjb2xvcmVkLiBhbGxGbG9hdGluZyBpcyB0cnVlIGlmIHRoZSBrZXkgaXMgZmxvYXRpbmcgaW4gRVZFUlkgYmxvY2tcbi8vIG9mIEVWRVJZIFRZUCAtIGFueXRoaW5nIGxlc3Mgd291bGQgbWFrZSBpdGFsaWNzIG1pc2xlYWRpbmcuXG4vL1xuLy8gT3duIHRvZ2dsZSAoY29sb3JWaWV3cy5hbGxQcm9wZXJ0aWVzKSwgaW5kZXBlbmRlbnQgb2YgZnJvbnRtYXR0ZXJEZWZhdWx0cy5cbi8vIEEgU3VidHlwIHByb3BlcnR5IGNvdW50cyBmb3IgaXRzIFRZUC5cbmZ1bmN0aW9uIHR5cHNVc2luZ0tleU1hcChwbHVnaW4pIHtcbiAgY29uc3QgbWFwID0gbmV3IE1hcCgpO1xuICBjb25zdCB7IGNvbG9yVmlld3MgfSA9IHBsdWdpbi5zZXR0aW5ncztcbiAgaWYgKCFjb2xvclZpZXdzLmFsbFByb3BlcnRpZXMpIHJldHVybiBtYXA7XG4gIGNvbnN0IHR5cHMgPSBuZXcgU2V0KFtcbiAgICAuLi5PYmplY3Qua2V5cyhwbHVnaW4uc2V0dGluZ3MudHlwRGVmYXVsdEZyb250bWF0dGVyKSxcbiAgICAuLi4oY29sb3JWaWV3cy5hbGxQcm9wZXJ0aWVzU3VidHlwID8gT2JqZWN0LmtleXMocGx1Z2luLnNldHRpbmdzLnR5cFN1YnR5cHMgPz8ge30pIDogW10pLFxuICBdKTtcbiAgZm9yIChjb25zdCB0eXAgb2YgdHlwcykge1xuICAgIGNvbnN0IGJsb2NrcyA9IGJsb2Nrc0ZvclR5cChwbHVnaW4sIHR5cCwgY29sb3JWaWV3cy5hbGxQcm9wZXJ0aWVzU3VidHlwID8gQUxMX1NVQlRZUFMgOiBudWxsKTtcbiAgICBmb3IgKGNvbnN0IHsgc2VjdGlvbiwga2V5cywgZmxvYXRpbmcgfSBvZiBibG9ja3MpIHtcbiAgICAgIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICAgICAgaWYgKCFtYXAuaGFzKGtleSkpIG1hcC5zZXQoa2V5LCB7IHR5cHM6IG5ldyBNYXAoKSwgYWxsRmxvYXRpbmc6IHRydWUgfSk7XG4gICAgICAgIGNvbnN0IGVudHJ5ID0gbWFwLmdldChrZXkpO1xuICAgICAgICBpZiAoIWVudHJ5LnR5cHMuaGFzKHR5cCkpIGVudHJ5LnR5cHMuc2V0KHR5cCwgW10pO1xuICAgICAgICBlbnRyeS50eXBzLmdldCh0eXApLnB1c2goc2VjdGlvbik7XG4gICAgICAgIGVudHJ5LmFsbEZsb2F0aW5nID0gZW50cnkuYWxsRmxvYXRpbmcgJiYgZmxvYXRpbmcuaGFzKGtleSk7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiBtYXA7XG59XG5cbi8vIE1hcmtzIG9ubHkgdGhlIG5hbWUgKGtleSBpbnB1dCksIG5vdCB0aGUgdmFsdWUgLSBpbiBub3RlcyAoZnJvbnRtYXR0ZXIgYW5kXG4vLyBwcm9wZXJ0aWVzIHNpZGViYXIpIGFzIHdlbGwgYXMgaW4gdGhlIHBsdWdpbidzIG93biBUWVAtUGFuZS5cbmZ1bmN0aW9uIGFwcGx5VG9Db250YWluZXIoY29udGFpbmVyRWwsIHN0YW5kYXJkS2V5cywgZmxvYXRpbmdLZXlzKSB7XG4gIGlmICghY29udGFpbmVyRWwpIHJldHVybjtcbiAgY29uc3Qgcm93cyA9IGNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIubWV0YWRhdGEtcHJvcGVydHlbZGF0YS1wcm9wZXJ0eS1rZXldXCIpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgY29uc3Qga2V5RWwgPSByb3cucXVlcnlTZWxlY3RvcihcIi5tZXRhZGF0YS1wcm9wZXJ0eS1rZXktaW5wdXRcIik7XG4gICAgaWYgKCFrZXlFbCkgY29udGludWU7XG4gICAgY29uc3QgcHJvcGVydHlLZXkgPSByb3cuZ2V0QXR0cmlidXRlKFwiZGF0YS1wcm9wZXJ0eS1rZXlcIik7XG4gICAga2V5RWwuY2xhc3NMaXN0LnRvZ2dsZShISUdITElHSFRfQ0xBU1MsICEhc3RhbmRhcmRLZXlzICYmIHN0YW5kYXJkS2V5cy5oYXMocHJvcGVydHlLZXkpKTtcbiAgICBrZXlFbC5jbGFzc0xpc3QudG9nZ2xlKEZMT0FUSU5HX0NMQVNTLCAhIWZsb2F0aW5nS2V5cyAmJiBmbG9hdGluZ0tleXMuaGFzKHByb3BlcnR5S2V5KSk7XG4gIH1cbn1cblxuLy8gXCJBbGwgcHJvcGVydGllc1wiIGRvZXNuJ3QgdXNlIHRoZSBtZXRhZGF0YSB3aWRnZXQgYnV0IGl0cyBvd24gdHJlZSBpdGVtcyxcbi8vIHJlYWNoYWJsZSB2aWEgdmlldy5kb21zIChuYW1lIC0+IGNvbXBvbmVudCk7IHRoZWlyIHRpdGxlIGVsZW1lbnQgaXNcbi8vIC50cmVlLWl0ZW0taW5uZXItdGV4dC5cbi8vXG4vLyBPbmUgVFlQIHVzaW5nIHRoZSBwcm9wZXJ0eTogdGhlIG5hbWUgZ2V0cyB0aGF0IFRZUCdzIGNvbG9yLiBTZXZlcmFsOiBhXG4vLyBzaW5nbGUgY29sb3Igd291bGQgbWlzbGVhZCwgc28gYm9sZCBpbnN0ZWFkIChzYW1lIG1hcmsgYXMgaW4gYSBub3RlKS5cbmZ1bmN0aW9uIGFwcGx5VG9BbGxQcm9wZXJ0aWVzVmlldyhwbHVnaW4pIHtcbiAgY29uc3QgdXNhZ2VNYXAgPSB0eXBzVXNpbmdLZXlNYXAocGx1Z2luKTtcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShBTExfUFJPUEVSVElFU19WSUVXX1RZUEUpKSB7XG4gICAgY29uc3QgZG9tcyA9IGxlYWYudmlldz8uZG9tcztcbiAgICBpZiAoIWRvbXMpIGNvbnRpbnVlO1xuICAgIGZvciAoY29uc3QgW2tleSwgZG9tXSBvZiBPYmplY3QuZW50cmllcyhkb21zKSkge1xuICAgICAgY29uc3QgdGl0bGVFbCA9IGRvbT8udGl0bGVFbDtcbiAgICAgIGlmICghdGl0bGVFbCkgY29udGludWU7XG5cbiAgICAgIGNvbnN0IGVudHJ5ID0gdXNhZ2VNYXAuZ2V0KGtleS50b0xvd2VyQ2FzZSgpKTtcbiAgICAgIGNvbnN0IHR5cHMgPSBlbnRyeT8udHlwcztcbiAgICAgIGNvbnN0IGNvdW50ID0gdHlwcyA/IHR5cHMuc2l6ZSA6IDA7XG4gICAgICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoSElHSExJR0hUX0NMQVNTLCBjb3VudCA+IDEpO1xuXG4gICAgICAvLyBJdGFsaWMgYXMgc29vbiBhcyBpdCBpcyBmbG9hdGluZyBFVkVSWVdIRVJFLiBVbmxpa2UgYm9sZCB0aGlzIGlzbid0XG4gICAgICAvLyBsaW1pdGVkIHRvIG9uZSBUWVAsIHNvIGJvdGggY2FuIGFwcGx5IGF0IG9uY2UuXG4gICAgICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoRkxPQVRJTkdfQ0xBU1MsIGNvdW50ID4gMCAmJiBlbnRyeS5hbGxGbG9hdGluZyk7XG5cbiAgICAgIC8vIFdpdGggXCJTdWJ0eXBcIiwgdGhlIGNvbG9yIG9mIHRoZSBTdWJ0eXAgYmxvY2sgdGhlIHByb3BlcnR5IGNvbWVzIGZyb20gLVxuICAgICAgLy8gYnV0IG9ubHkgaWYgZXhhY3RseSBvbmUgYmxvY2sgb2YgdGhhdCBUWVAgaGFzIGl0LiBPdGhlcndpc2UgdGhlIGNob2ljZVxuICAgICAgLy8gd291bGQgYmUgYXJiaXRyYXJ5IGFuZCBjaGFuZ2Ugd2l0aCBibG9jayBvcmRlciwgc28gdGhlIFRZUCBjb2xvclxuICAgICAgLy8gKHN1YnR5cENvbG9yIHdpdGggbnVsbCkgaXMgdXNlZC5cbiAgICAgIGlmIChjb3VudCA9PT0gMSkge1xuICAgICAgICBjb25zdCBbW29ubHlUeXAsIHNlY3Rpb25zXV0gPSB0eXBzO1xuICAgICAgICBjb25zdCBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmFsbFByb3BlcnRpZXNTdWJ0eXBcbiAgICAgICAgICA/IHN1YnR5cENvbG9yKHBsdWdpbi5zZXR0aW5ncywgb25seVR5cCwgc2VjdGlvbnMubGVuZ3RoID09PSAxID8gc2VjdGlvbnNbMF0gOiBudWxsKVxuICAgICAgICAgIDogcGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1tvbmx5VHlwXTtcbiAgICAgICAgLy8gIWltcG9ydGFudCwgYmVjYXVzZSB0aGUgYm9sZCBydWxlIGluIHN0eWxlcy5jc3MgYWxzbyBzZXRzIGNvbG9yXG4gICAgICAgIC8vICFpbXBvcnRhbnQgYW5kIGNvdWxkIHN0aWxsIGJlIGF0dGFjaGVkIGZyb20gYW4gZWFybGllciBzdGF0ZS5cbiAgICAgICAgaWYgKGNvbG9yKSB0aXRsZUVsLnN0eWxlLnNldFByb3BlcnR5KFwiY29sb3JcIiwgY29sb3IsIFwiaW1wb3J0YW50XCIpO1xuICAgICAgICBlbHNlIHRpdGxlRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRpdGxlRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gYXBwbHlGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xuICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXc7XG4gICAgY29uc3QgeyBzdGFuZGFyZCwgZmxvYXRpbmcgfSA9IGtleXNGb3JGaWxlKHBsdWdpbiwgdmlldz8uZmlsZSk7XG4gICAgYXBwbHlUb0NvbnRhaW5lcih2aWV3Py5tZXRhZGF0YUVkaXRvcj8uY29udGFpbmVyRWwsIHN0YW5kYXJkLCBmbG9hdGluZyk7XG4gIH1cblxuICAvLyBUaGUgcHJvcGVydGllcyBzaWRlYmFyIGFsd2F5cyBzaG93cyB0aGUgYWN0aXZlIGZpbGUgYnV0IGtlZXBzIG5vIHJlbGlhYmxlXG4gIC8vIHJlZmVyZW5jZSB0byBpdCwgaGVuY2UgdGhlIGZhbGxiYWNrIHRvIHRoZSB3b3Jrc3BhY2UncyBhY3RpdmUgZmlsZS5cbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcImZpbGUtcHJvcGVydGllc1wiKSkge1xuICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXc7XG4gICAgY29uc3QgZmlsZSA9IHZpZXc/LmZpbGUgPz8gcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xuICAgIGNvbnN0IHsgc3RhbmRhcmQsIGZsb2F0aW5nIH0gPSBrZXlzRm9yRmlsZShwbHVnaW4sIGZpbGUpO1xuICAgIGFwcGx5VG9Db250YWluZXIodmlldz8ubWV0YWRhdGFFZGl0b3I/LmNvbnRhaW5lckVsLCBzdGFuZGFyZCwgZmxvYXRpbmcpO1xuICB9XG5cbiAgLy8gVGhlIFRZUC1QYW5lOiBlYWNoIGVkaXRvciBzaG93cyBleGFjdGx5IG9uZSBibG9jayAoVFlQIG9yIFN1YnR5cCkuXG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoVklFV19UWVBFX1RZUF9QQU5FKSkge1xuICAgIGZvciAoY29uc3QgZWRpdG9yIG9mIGxlYWYudmlldz8uZnJvbnRtYXR0ZXJFZGl0b3JzID8/IFtdKSB7XG4gICAgICBjb25zdCB7IHN0YW5kYXJkLCBmbG9hdGluZyB9ID0ga2V5c0ZvclN0b3JlKHBsdWdpbiwgZWRpdG9yLm93bmVyPy50eXBTdG9yZSk7XG4gICAgICBhcHBseVRvQ29udGFpbmVyKGVkaXRvci5jb250YWluZXJFbCwgc3RhbmRhcmQsIGZsb2F0aW5nKTtcbiAgICB9XG4gIH1cblxuICBhcHBseVRvQWxsUHJvcGVydGllc1ZpZXcocGx1Z2luKTtcbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseUZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodChwbHVnaW4pO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAubWV0YWRhdGFDYWNoZS5vbihcImNoYW5nZWRcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLm1ldGFkYXRhQ2FjaGUub24oXCJyZXNvbHZlZFwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwiYWN0aXZlLWxlYWYtY2hhbmdlXCIsIHJlZnJlc2gpKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KHJlZnJlc2gpO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQgfTtcbiIsICJjb25zdCB7IE5vdGljZSB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyB0eXBTdG9yZSwgc3VidHlwU3RvcmUgfSA9IHJlcXVpcmUoXCIuL3R5cC1mcm9udG1hdHRlci1lZGl0b3JcIik7XG5jb25zdCB7IGdldFN1YnR5cE5hbWVzLCBpc0VtcHR5VmFsdWUgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cHNcIik7XG5jb25zdCB7IHBsdXJhbCwgam9pbkFuZCB9ID0gcmVxdWlyZShcIi4vdHlwLXV0aWxzXCIpO1xuY29uc3QgeyBUWVBfUFJPUEVSVFksIFNVQlRZUF9QUk9QRVJUWSB9ID0gcmVxdWlyZShcIi4vdHlwLWluZGV4XCIpO1xuXG4vLyBPYnNpZGlhbiBsb3dlcmNhc2VzIHByb3BlcnR5IG5hbWVzIGludGVybmFsbHksIHNvIG1hdGNoaW5nIGlnbm9yZXMgY2FzZTtcbi8vIHRoZSBuZXcgbmFtZSBpcyBrZXB0IGV4YWN0bHkgYXMgdHlwZWQuXG5mdW5jdGlvbiBzYW1lS2V5KGEsIGIpIHtcbiAgcmV0dXJuIGEudG9Mb3dlckNhc2UoKSA9PT0gYi50b0xvd2VyQ2FzZSgpO1xufVxuXG4vLyBSZW5hbWVzIG9sZEtleSBpbiBvbmUgZnJvbnRtYXR0ZXIgYmxvY2sgKFRZUCBvciBTdWJ0eXAsIHNlZSB0eXBTdG9yZS9cbi8vIHN1YnR5cFN0b3JlIGluIHR5cC1mcm9udG1hdHRlci1lZGl0b3IuanMpLCBrZWVwaW5nIGl0cyBwb3NpdGlvbiwgYW5kIG1vdmVzXG4vLyB0aGUgZmxvYXRpbmcgZmxhZyBhbG9uZy4gSWYgbmV3S2V5IGFscmVhZHkgZXhpc3RzIHRoZXJlIChhIG1lcmdlLCBsaWtlXG4vLyBPYnNpZGlhbidzIG93biBtZXJnZSBpbiB0aGUgbm90ZXMpLCB0aGUgZXhpc3RpbmcgZW50cnkga2VlcHMgaXRzIHBvc2l0aW9uXG4vLyBhbmQgb25seSB0YWtlcyB0aGUgb2xkIHZhbHVlIGlmIGl0cyBvd24gaXMgZW1wdHkuIFJldHVybnMgdHJ1ZSBvbiBhIGNoYW5nZS5cbmZ1bmN0aW9uIHJlbmFtZUluU3RvcmUoc3RvcmUsIG9sZEtleSwgbmV3S2V5KSB7XG4gIGNvbnN0IGRlZmF1bHRzID0gc3RvcmUuZ2V0RnJvbnRtYXR0ZXIoKTtcbiAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKGRlZmF1bHRzKTtcbiAgY29uc3Qgc291cmNlS2V5ID0ga2V5cy5maW5kKChrZXkpID0+IHNhbWVLZXkoa2V5LCBvbGRLZXkpKTtcbiAgaWYgKHNvdXJjZUtleSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7XG4gIC8vIEEgcHVyZSBjaGFuZ2Ugb2YgY2FzZSBmaW5kcyBzb3VyY2VLZXkgaXRzZWxmIGZvciBuZXdLZXkgLSBub3QgYSBtZXJnZS5cbiAgY29uc3QgdGFyZ2V0S2V5ID0ga2V5cy5maW5kKChrZXkpID0+IGtleSAhPT0gc291cmNlS2V5ICYmIHNhbWVLZXkoa2V5LCBuZXdLZXkpKTtcbiAgaWYgKHRhcmdldEtleSA9PT0gdW5kZWZpbmVkICYmIHNvdXJjZUtleSA9PT0gbmV3S2V5KSByZXR1cm4gZmFsc2U7XG5cbiAgY29uc3QgbmV4dCA9IHt9O1xuICBmb3IgKGNvbnN0IGtleSBvZiBrZXlzKSB7XG4gICAgaWYgKGtleSAhPT0gc291cmNlS2V5KSB7XG4gICAgICBuZXh0W2tleV0gPSBkZWZhdWx0c1trZXldO1xuICAgIH0gZWxzZSBpZiAodGFyZ2V0S2V5ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIG5leHRbbmV3S2V5XSA9IGRlZmF1bHRzW3NvdXJjZUtleV07XG4gICAgfVxuICB9XG4gIGlmICh0YXJnZXRLZXkgIT09IHVuZGVmaW5lZCAmJiBpc0VtcHR5VmFsdWUobmV4dFt0YXJnZXRLZXldKSkgbmV4dFt0YXJnZXRLZXldID0gZGVmYXVsdHNbc291cmNlS2V5XTtcbiAgc3RvcmUuc2V0RnJvbnRtYXR0ZXIobmV4dCk7XG5cbiAgY29uc3QgZmxvYXRpbmcgPSBzdG9yZS5nZXRGbG9hdGluZygpO1xuICBpZiAoZmxvYXRpbmcubGVuZ3RoID4gMCkge1xuICAgIC8vIE9uIGEgbWVyZ2UgdGhlIHRhcmdldCdzIGZsb2F0aW5nIGZsYWcgd2lucy5cbiAgICBzdG9yZS5zZXRGbG9hdGluZyhcbiAgICAgIHRhcmdldEtleSAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8gZmxvYXRpbmcuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gc291cmNlS2V5KVxuICAgICAgICA6IGZsb2F0aW5nLm1hcCgoa2V5KSA9PiAoa2V5ID09PSBzb3VyY2VLZXkgPyBuZXdLZXkgOiBrZXkpKVxuICAgICk7XG4gIH1cblxuICAvLyBUaGUgc2hvcnRjdXQgYmVsb25ncyB0byB0aGUga2V5IGFuZCBtb3ZlcyB3aXRoIGl0OyBvbiBhIG1lcmdlIHRoZVxuICAvLyB0YXJnZXQncyB3aW5zLCBhcyB3aXRoIGZsb2F0aW5nLlxuICBjb25zdCBzaG9ydGN1dHMgPSB7IC4uLnN0b3JlLmdldFNob3J0Y3V0cygpIH07XG4gIGlmIChzaG9ydGN1dHNbc291cmNlS2V5XSkge1xuICAgIGlmICh0YXJnZXRLZXkgPT09IHVuZGVmaW5lZCkgc2hvcnRjdXRzW25ld0tleV0gPSBzaG9ydGN1dHNbc291cmNlS2V5XTtcbiAgICBkZWxldGUgc2hvcnRjdXRzW3NvdXJjZUtleV07XG4gICAgc3RvcmUuc2V0U2hvcnRjdXRzKHNob3J0Y3V0cyk7XG4gIH1cbiAgcmV0dXJuIHRydWU7XG59XG5cbi8vIFBpbm5lZCBlbnRyaWVzIG9mIHRoZSBnbG9iYWwgb3JkZXIgYWxsb3cgbm8gZHVwbGljYXRlcywgc28gYW4gZXhpc3Rpbmdcbi8vIHRhcmdldCBlbnRyeSBrZWVwcyBpdHMgcG9zaXRpb24gYW5kIHRoZSBvbGQgb25lIGdvZXMuXG5mdW5jdGlvbiByZW5hbWVJbkdsb2JhbE9yZGVyKHNldHRpbmdzLCBvbGRLZXksIG5ld0tleSkge1xuICBjb25zdCBvcmRlciA9IHNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXI7XG4gIGNvbnN0IHNvdXJjZSA9IG9yZGVyLmZpbmQoKGVudHJ5KSA9PiBlbnRyeS5raW5kID09PSBcInByb3BlcnR5XCIgJiYgc2FtZUtleShlbnRyeS5uYW1lLCBvbGRLZXkpKTtcbiAgaWYgKCFzb3VyY2UpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgdGFyZ2V0ID0gb3JkZXIuZmluZCgoZW50cnkpID0+IGVudHJ5ICE9PSBzb3VyY2UgJiYgZW50cnkua2luZCA9PT0gXCJwcm9wZXJ0eVwiICYmIHNhbWVLZXkoZW50cnkubmFtZSwgbmV3S2V5KSk7XG4gIGlmICh0YXJnZXQpIHNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIgPSBvcmRlci5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeSAhPT0gc291cmNlKTtcbiAgZWxzZSBpZiAoc291cmNlLm5hbWUgPT09IG5ld0tleSkgcmV0dXJuIGZhbHNlO1xuICBlbHNlIHNvdXJjZS5uYW1lID0gbmV3S2V5O1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc3luY1JlbmFtZShwbHVnaW4sIG9sZEtleSwgbmV3S2V5KSB7XG4gIGlmICh0eXBlb2Ygb2xkS2V5ICE9PSBcInN0cmluZ1wiIHx8IHR5cGVvZiBuZXdLZXkgIT09IFwic3RyaW5nXCIpIHJldHVybjtcbiAgbmV3S2V5ID0gbmV3S2V5LnRyaW0oKTtcbiAgaWYgKG9sZEtleSA9PT0gXCJcIiB8fCBuZXdLZXkgPT09IFwiXCIgfHwgb2xkS2V5ID09PSBuZXdLZXkpIHJldHVybjtcbiAgLy8gVFlQL1NVQlRZUCBhcmUgbmV2ZXIgcGFydCBvZiBhIGJsb2NrIChzZWUgc3RyaXBUeXBQcm9wZXJ0eSBpblxuICAvLyB0eXAtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKSwgc28gcmVuYW1lcyBmcm9tIG9yIHRvIHRoZW0gYXJlIGlnbm9yZWQuXG4gIGlmIChbb2xkS2V5LCBuZXdLZXldLnNvbWUoKGtleSkgPT4gc2FtZUtleShrZXksIFRZUF9QUk9QRVJUWSkgfHwgc2FtZUtleShrZXksIFNVQlRZUF9QUk9QRVJUWSkpKSByZXR1cm47XG5cbiAgY29uc3QgeyBzZXR0aW5ncyB9ID0gcGx1Z2luO1xuICBsZXQgdHlwQ291bnQgPSAwO1xuICBsZXQgc3VidHlwQ291bnQgPSAwO1xuICBjb25zdCBjb3VudCA9IChzdG9yZSkgPT4gKHN0b3JlLnN1YnR5cCA/IHN1YnR5cENvdW50KysgOiB0eXBDb3VudCsrKTtcbiAgY29uc3QgdHlwcyA9IG5ldyBTZXQoWy4uLk9iamVjdC5rZXlzKHNldHRpbmdzLnR5cERlZmF1bHRGcm9udG1hdHRlciksIC4uLk9iamVjdC5rZXlzKHNldHRpbmdzLnR5cFN1YnR5cHMgPz8ge30pXSk7XG4gIGZvciAoY29uc3QgdHlwIG9mIHR5cHMpIHtcbiAgICBjb25zdCBzdG9yZXMgPSBbdHlwU3RvcmUocGx1Z2luLCB0eXApLCAuLi5nZXRTdWJ0eXBOYW1lcyhzZXR0aW5ncywgdHlwKS5tYXAoKHN1YnR5cCkgPT4gc3VidHlwU3RvcmUocGx1Z2luLCB0eXAsIHN1YnR5cCkpXTtcblxuICAgIC8vIEEgdmF1bHQtd2lkZSByZW5hbWUgaGl0cyBFVkVSWSBibG9jayBob2xkaW5nIHRoZSBrZXkgLSB0aGUgc2FtZSBrZXkgbWF5XG4gICAgLy8gYXBwZWFyIGluIHNldmVyYWwgYmxvY2tzIChzZWUgdHlwU3VidHlwcyBpbiBzdWJ0eXBzLmpzKS4gT25seSB3aXRoaW4gb25lXG4gICAgLy8gYmxvY2sgY2FuIHRoZSBuZXcgbmFtZSBjb2xsaWRlOyByZW5hbWVJblN0b3JlIG1lcmdlcyB0aGUgdHdvIHRoZXJlLlxuICAgIGZvciAoY29uc3Qgc3RvcmUgb2Ygc3RvcmVzKSB7XG4gICAgICBpZiAocmVuYW1lSW5TdG9yZShzdG9yZSwgb2xkS2V5LCBuZXdLZXkpKSBjb3VudChzdG9yZSk7XG4gICAgfVxuICB9XG4gIGNvbnN0IG9yZGVyQ2hhbmdlZCA9IHJlbmFtZUluR2xvYmFsT3JkZXIoc2V0dGluZ3MsIG9sZEtleSwgbmV3S2V5KTtcbiAgaWYgKHR5cENvdW50ID09PSAwICYmIHN1YnR5cENvdW50ID09PSAwICYmICFvcmRlckNoYW5nZWQpIHJldHVybjtcblxuICBhd2FpdCBwbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gIHBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcblxuICBjb25zdCBwYXJ0cyA9IFtdO1xuICBpZiAodHlwQ291bnQgPiAwKSBwYXJ0cy5wdXNoKHBsdXJhbCh0eXBDb3VudCwgXCJUWVAgYmxvY2tcIikpO1xuICBpZiAoc3VidHlwQ291bnQgPiAwKSBwYXJ0cy5wdXNoKHBsdXJhbChzdWJ0eXBDb3VudCwgXCJTdWJ0eXAgYmxvY2tcIikpO1xuICBpZiAob3JkZXJDaGFuZ2VkKSBwYXJ0cy5wdXNoKFwidGhlIGdsb2JhbCBvcmRlclwiKTtcbiAgbmV3IE5vdGljZShgVFlQLVN5c3RlbTogcmVuYW1lZCBcIiR7b2xkS2V5fVwiIFx1MjE5MiBcIiR7bmV3S2V5fVwiIGluICR7am9pbkFuZChwYXJ0cyl9LmApO1xufVxuXG4vLyBPYnNpZGlhbidzIFwiQWxsIHByb3BlcnRpZXNcIiB2aWV3IGFuZCBCYXNlcyAobmFtaW5nIGEgbmV3IG5vdGUgcHJvcGVydHkpXG4vLyByZW5hbWUgcHJvcGVydGllcyB2YXVsdC13aWRlIG9ubHkgdGhyb3VnaCBhcHAuZmlsZU1hbmFnZXIucmVuYW1lUHJvcGVydHksXG4vLyBzbyB3cmFwcGluZyB0aGF0IG9uZSBtZXRob2QgY2F0Y2hlcyBldmVyeSByZWFsIHJlbmFtZS4gQmFzZXMnIFwiRGlzcGxheVxuLy8gbmFtZVwiIG9ubHkgY2hhbmdlcyB0aGUgLmJhc2UgZmlsZSwgbm90IHRoZSBub3RlcywgYW5kIHJpZ2h0bHkgZG9lc24ndCBwYXNzXG4vLyB0aHJvdWdoIGhlcmUuXG5mdW5jdGlvbiByZWdpc3RlclByb3BlcnR5UmVuYW1lU3luYyhwbHVnaW4pIHtcbiAgY29uc3QgZmlsZU1hbmFnZXIgPSBwbHVnaW4uYXBwLmZpbGVNYW5hZ2VyO1xuICBpZiAoZmlsZU1hbmFnZXIuX190eXBTeXN0ZW1SZW5hbWVTeW5jUGF0Y2hlZCkgcmV0dXJuO1xuICBmaWxlTWFuYWdlci5fX3R5cFN5c3RlbVJlbmFtZVN5bmNQYXRjaGVkID0gdHJ1ZTtcblxuICBjb25zdCBvcmlnaW5hbCA9IGZpbGVNYW5hZ2VyLnJlbmFtZVByb3BlcnR5O1xuICBmaWxlTWFuYWdlci5yZW5hbWVQcm9wZXJ0eSA9IGFzeW5jIGZ1bmN0aW9uIChvbGRLZXksIG5ld0tleSwgLi4ucmVzdCkge1xuICAgIC8vIElmIHRoZSBvcmlnaW5hbCB0aHJvd3MgKGFjY2VwdFJlbmFtZSBoYW5kbGVzIHRoYXQpLCBzZXR0aW5ncyBzdGF5IGFzXG4gICAgLy8gdGhleSBhcmUuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgb3JpZ2luYWwuY2FsbCh0aGlzLCBvbGRLZXksIG5ld0tleSwgLi4ucmVzdCk7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHN5bmNSZW5hbWUocGx1Z2luLCBvbGRLZXksIG5ld0tleSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJUWVAtU3lzdGVtOiBwcm9wZXJ0eSByZW5hbWUgbm90IGFwcGxpZWRcIiwgZXJyb3IpO1xuICAgICAgbmV3IE5vdGljZShgVFlQLVN5c3RlbTogcmVuYW1lIG9mIFwiJHtvbGRLZXl9XCIgbm90IGFwcGxpZWQgXHUyMDEzICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcblxuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4ge1xuICAgIGZpbGVNYW5hZ2VyLnJlbmFtZVByb3BlcnR5ID0gb3JpZ2luYWw7XG4gICAgZGVsZXRlIGZpbGVNYW5hZ2VyLl9fdHlwU3lzdGVtUmVuYW1lU3luY1BhdGNoZWQ7XG4gIH0pO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJQcm9wZXJ0eVJlbmFtZVN5bmMgfTtcbiIsICJjb25zdCB7IEZ1enp5U3VnZ2VzdE1vZGFsLCBOb3RpY2UsIHByZXBhcmVGdXp6eVNlYXJjaCB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBjb21wYXJlVHlwcywgREVGQVVMVF9TT1JUX09SREVSIH0gPSByZXF1aXJlKFwiLi90eXAtcGFuZVwiKTtcbmNvbnN0IHsgbmFtZUNvbG9yLCBwYWludENvbG9yRG90IH0gPSByZXF1aXJlKFwiLi90eXAtY29sb3JzXCIpO1xuXG4vLyBOYXRpdmUgcmVwbGFjZW1lbnQgZm9yIFRlbXBsYXRlcidzIHRwLnN5c3RlbS5zdWdnZXN0ZXIgd2hlbiBjaG9vc2luZyBhIFRZUFxuLy8gKHNlZSBfb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzKSwgYnVpbHQgb24gT2JzaWRpYW4nc1xuLy8gRnV6enlTdWdnZXN0TW9kYWwgbGlrZSBUZW1wbGF0ZXIncyBvd24sIGJ1dCBzaG93aW5nIGNvbG9yIG9yIGRvdCxcbi8vIGRlc2NyaXB0aW9uIGFuZCBub3RlIGNvdW50IHBlciByb3cuIFVucmVnaXN0ZXJlZCBlbnRyaWVzIGFyZSBtdXRlZCwgYXMgaW5cbi8vIHRoZSBUWVAtTGlzdC5cbmNsYXNzIFR5cFBpY2tlck1vZGFsIGV4dGVuZHMgRnV6enlTdWdnZXN0TW9kYWwge1xuICBjb25zdHJ1Y3RvcihhcHAsIHBsdWdpbiwgaXRlbXMsIHJlc29sdmUpIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICAgIHRoaXMuaXRlbXMgPSBpdGVtcztcbiAgICB0aGlzLnJlc29sdmUgPSByZXNvbHZlO1xuICAgIHRoaXMuY2hvc2VuID0gZmFsc2U7XG4gICAgdGhpcy5zZXRQbGFjZWhvbGRlcihcIkVTQyB0byBjYW5jZWxcIik7XG4gIH1cblxuICBnZXRJdGVtcygpIHtcbiAgICByZXR1cm4gdGhpcy5pdGVtcztcbiAgfVxuXG4gIC8vIFNlYXJjaCBhbHNvIGNvdmVycyB0aGUgZGVzY3JpcHRpb24gYW5kLCB3aGVyZSBzaG93biBpbiB0aGUgcm93XG4gIC8vIChzaG93U3VidHlwcyksIHRoZSBTdWJ0eXAgbmFtZXM6IHdoYXQgeW91IHNlZSB5b3UgZXhwZWN0IHRvIGJlIGFibGUgdG8gdHlwZS5cbiAgZ2V0SXRlbVRleHQoaXRlbSkge1xuICAgIHJldHVybiBbaXRlbS50eXAsIGl0ZW0uc3VidHlwcz8uam9pbihcIiBcIiksIGl0ZW0uZGVzY3JpcHRpb25dLmZpbHRlcihCb29sZWFuKS5qb2luKFwiIFwiKTtcbiAgfVxuXG4gIHJlbmRlclN1Z2dlc3Rpb24obWF0Y2gsIGVsKSB7XG4gICAgY29uc3QgaXRlbSA9IG1hdGNoLml0ZW07XG4gICAgZWwuYWRkQ2xhc3MoXCJ0eXAtcGlja2VyLXN1Z2dlc3Rpb25cIik7XG4gICAgaWYgKGl0ZW0udW5yZWdpc3RlcmVkKSBlbC5hZGRDbGFzcyhcInR5cC1waWNrZXItdW5yZWdpc3RlcmVkXCIpO1xuXG4gICAgaWYgKGl0ZW0udW5yZWdpc3RlcmVkKSB7XG4gICAgICBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1waWNrZXItbmFtZVwiLCB0ZXh0OiBpdGVtLnR5cCB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5yZW5kZXJDb2xvcmVkTmFtZShlbCwgaXRlbS50eXAsIGl0ZW0udHlwKTtcbiAgICB9XG5cbiAgICBpZiAoaXRlbS5zdWJ0eXBzPy5sZW5ndGgpIHRoaXMucmVuZGVyU3VidHlwUHJldmlldyhlbCwgaXRlbSk7XG5cbiAgICBpZiAoaXRlbS5kZXNjcmlwdGlvbikge1xuICAgICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtcGlja2VyLWRlc2NcIiwgdGV4dDogaXRlbS5kZXNjcmlwdGlvbiB9KTtcbiAgICB9XG5cbiAgICBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1waWNrZXItY291bnRcIiwgdGV4dDogU3RyaW5nKGl0ZW0uY291bnQpIH0pO1xuICB9XG5cbiAgLy8gTmFtZSBpbiB0aGUgY29sb3Igb2YgY29sb3JUeXAgKG9yIG9mIHRoZSBTdWJ0eXAsIHNlZSBuYW1lQ29sb3IgaW5cbiAgLy8gdHlwLWNvbG9ycy5qcykgLSBhcyBjb2xvcmVkIHRleHQgb3Igd2l0aCBhIGRvdCBiZWZvcmUgaXQsIGRlcGVuZGluZyBvblxuICAvLyB0aGUgXCJUWVAtUGFuZVwiIGNvbG9yaW5nIHNldHRpbmcuXG4gIHJlbmRlckNvbG9yZWROYW1lKGVsLCB0ZXh0LCBjb2xvclR5cCwgc3VidHlwID0gbnVsbCkge1xuICAgIGNvbnN0IHsgY29sb3IsIGlzRGVmYXVsdCB9ID0gbmFtZUNvbG9yKHRoaXMucGx1Z2luLnNldHRpbmdzLCBjb2xvclR5cCwgc3VidHlwKTtcbiAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0KSB7XG4gICAgICBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1waWNrZXItbmFtZVwiLCB0ZXh0IH0pLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gICAgfSBlbHNlIHtcbiAgICAgIHBhaW50Q29sb3JEb3QoZWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtcGlja2VyLWRvdFwiIH0pLCBjb2xvciwgaXNEZWZhdWx0KTtcbiAgICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXBpY2tlci1uYW1lXCIsIHRleHQgfSk7XG4gICAgfVxuICB9XG5cbiAgLy8gXCJUWVAgKFN1YnR5cCAxLCBTdWJ0eXAgMilcIiAtIHNob3dzIHdoYXQgbGllcyBiZWxvdyB0aGUgVFlQIGJlZm9yZSB0aGVcbiAgLy8gc2VwYXJhdGUgU3VidHlwLVBpY2tlciBjb21lcy4gRWFjaCBTdWJ0eXAgaW4gaXRzIG93biBjb2xvciwgYnJhY2tldHMgYW5kXG4gIC8vIGNvbW1hcyBtdXRlZDsgdW5jb2xvcmVkIGxpa2UgdGhlIG5hbWUgd2hlbiBcIlRZUC1QYW5lXCIgY29sb3JpbmcgaXMgb2ZmLlxuICByZW5kZXJTdWJ0eXBQcmV2aWV3KGVsLCBpdGVtKSB7XG4gICAgY29uc3QgY29sb3JpemUgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3Q7XG4gICAgY29uc3Qgd3JhcCA9IGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXBpY2tlci1zdWJ0eXBzXCIgfSk7XG4gICAgd3JhcC5hcHBlbmRUZXh0KFwiKFwiKTtcbiAgICBpdGVtLnN1YnR5cHMuZm9yRWFjaCgoc3VidHlwLCBpbmRleCkgPT4ge1xuICAgICAgaWYgKGluZGV4ID4gMCkgd3JhcC5hcHBlbmRUZXh0KFwiLCBcIik7XG4gICAgICBjb25zdCBzcGFuID0gd3JhcC5jcmVhdGVTcGFuKHsgdGV4dDogc3VidHlwIH0pO1xuICAgICAgaWYgKGNvbG9yaXplKSBzcGFuLnN0eWxlLmNvbG9yID0gbmFtZUNvbG9yKHRoaXMucGx1Z2luLnNldHRpbmdzLCBpdGVtLnR5cCwgc3VidHlwKS5jb2xvcjtcbiAgICB9KTtcbiAgICB3cmFwLmFwcGVuZFRleHQoXCIpXCIpO1xuICB9XG5cbiAgLy8gT2JzaWRpYW4ncyBzZWxlY3RTdWdnZXN0aW9uKCkgY2FsbHMgY2xvc2UoKSBCRUZPUkUgb25DaG9vc2VJdGVtKCkuIFNldFxuICAvLyBcImNob3NlblwiIGFueSBsYXRlciBhbmQgb25DbG9zZSgpIHJlc29sdmVzIHdpdGggbnVsbCBmaXJzdCAtIGEgcHJvbWlzZSBvbmx5XG4gIC8vIHJlc29sdmVzIG9uY2UsIHNvIGV2ZXJ5IGNob2ljZSB3b3VsZCBjb21lIGJhY2sgYXMgbnVsbC5cbiAgc2VsZWN0U3VnZ2VzdGlvbihpdGVtLCBldnQpIHtcbiAgICB0aGlzLmNob3NlbiA9IHRydWU7XG4gICAgLy8gV2hhdCB3YXMgdHlwZWQgd2hlbiBjaG9vc2luZzsgdGhlIFN1YnR5cC1QaWNrZXIgc29ydHMgYnkgaXQgKHNlZVxuICAgIC8vIHBpY2tUeXBFbnRyeS9zb3J0QnlRdWVyeSkuXG4gICAgdGhpcy5xdWVyeSA9IHRoaXMuaW5wdXRFbC52YWx1ZS50cmltKCk7XG4gICAgc3VwZXIuc2VsZWN0U3VnZ2VzdGlvbihpdGVtLCBldnQpO1xuICB9XG5cbiAgb25DaG9vc2VJdGVtKGl0ZW0pIHtcbiAgICB0aGlzLnJlc29sdmUoaXRlbS50eXApO1xuICB9XG5cbiAgLy8gRVNDIG9yIGEgY2xpY2sgb3V0c2lkZSBjbG9zZXMgd2l0aG91dCBzZWxlY3RTdWdnZXN0aW9uOiByZXNvbHZlIHdpdGggbnVsbFxuICAvLyBpbnN0ZWFkIG9mIGxlYXZpbmcgdGhlIHByb21pc2UgaGFuZ2luZywgbGlrZSB0cC5zeXN0ZW0uc3VnZ2VzdGVyLlxuICBvbkNsb3NlKCkge1xuICAgIHN1cGVyLm9uQ2xvc2UoKTtcbiAgICBpZiAoIXRoaXMuY2hvc2VuKSB0aGlzLnJlc29sdmUobnVsbCk7XG4gIH1cbn1cblxuLy8gUGlja3MgYSBTdWJ0eXAgZm9yIGFuIGFscmVhZHkgY2hvc2VuIFRZUCAoc2VlIHBpY2tTdWJ0eXApLiBMaWtlXG4vLyBUeXBQaWNrZXJNb2RhbCwgcGx1cyBhIGZpcnN0IHJvdyBcIlRZUCAobm8gU3VidHlwKVwiIChpdGVtLm5vbmUpLiBFU0MgcmVzb2x2ZXNcbi8vIHdpdGggbnVsbCwgYW5kIFRZUC5qcyBnb2VzIGJhY2sgdG8gdGhlIFRZUCBjaG9pY2UuIHF1ZXJ5IGlzIHRoZSBzZWFyY2ggZnJvbVxuLy8gdGhlIFRZUC1QaWNrZXIgdGhhdCBwcmUtc29ydHMgdGhlIGxpc3QuXG5jbGFzcyBTdWJ0eXBQaWNrZXJNb2RhbCBleHRlbmRzIFR5cFBpY2tlck1vZGFsIHtcbiAgY29uc3RydWN0b3IoYXBwLCBwbHVnaW4sIHR5cCwgaXRlbXMsIHJlc29sdmUsIHF1ZXJ5ID0gXCJcIikge1xuICAgIHN1cGVyKGFwcCwgcGx1Z2luLCBpdGVtcywgcmVzb2x2ZSk7XG4gICAgdGhpcy50eXAgPSB0eXA7XG4gICAgdGhpcy5zZXRQbGFjZWhvbGRlcihgU3VidHlwIGZvciAke3R5cH0gXHUyMDEzIEVTQyB0byBnbyBiYWNrYCk7XG4gICAgdGhpcy5pdGVtcyA9IHNvcnRCeVF1ZXJ5KGl0ZW1zLCBxdWVyeSwgKGl0ZW0pID0+IHRoaXMuZ2V0SXRlbVRleHQoaXRlbSkpO1xuICB9XG5cbiAgLy8gVGhlIFwibm8gU3VidHlwXCIgcm93IGlzIGFsc28gZm91bmQgYnkgdGhlIFRZUCBuYW1lIGl0IHNob3dzLCBzbyBcIk9SR0FcIlxuICAvLyB0eXBlZCBpbiB0aGUgVFlQLVBpY2tlciBicmluZ3MgaXQgYmFjayB0byB0aGUgdG9wLlxuICBnZXRJdGVtVGV4dChpdGVtKSB7XG4gICAgcmV0dXJuIGl0ZW0ubm9uZSA/IGAke3RoaXMudHlwfSAke2l0ZW0udHlwfWAgOiBzdXBlci5nZXRJdGVtVGV4dChpdGVtKTtcbiAgfVxuXG4gIHJlbmRlclN1Z2dlc3Rpb24obWF0Y2gsIGVsKSB7XG4gICAgY29uc3QgaXRlbSA9IG1hdGNoLml0ZW07XG4gICAgZWwuYWRkQ2xhc3MoXCJ0eXAtcGlja2VyLXN1Z2dlc3Rpb25cIik7XG4gICAgaWYgKGl0ZW0ubm9uZSkge1xuICAgICAgLy8gXCJPUkdBIChubyBTdWJ0eXApXCI6IHRoZSBUWVAgaW4gaXRzIGNvbG9yLCB0aGUgc3VmZml4IGluIG5vcm1hbCB0ZXh0XG4gICAgICAvLyBjb2xvciByYXRoZXIgdGhhbiBtdXRlZCAtIGl0IGlzIGEgcmVhbCBjaG9pY2UsIG5vdCBhIGdyYXllZC1vdXRcbiAgICAgIC8vIG5vbi1jaG9pY2UsIGFuZCBpdCBzdGFuZHMgYXBhcnQgZnJvbSB0aGUgU3VidHlwIHJvd3MgYmVsb3cuXG4gICAgICB0aGlzLnJlbmRlckNvbG9yZWROYW1lKGVsLCB0aGlzLnR5cCwgdGhpcy50eXApO1xuICAgICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtcGlja2VyLW5vbmVcIiwgdGV4dDogYCgke2l0ZW0udHlwfSlgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnJlbmRlckNvbG9yZWROYW1lKGVsLCBpdGVtLnR5cCwgdGhpcy50eXAsIGl0ZW0udHlwKTtcbiAgICB9XG4gICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtcGlja2VyLWNvdW50XCIsIHRleHQ6IFN0cmluZyhpdGVtLmNvdW50KSB9KTtcbiAgfVxuXG4gIG9uQ2hvb3NlSXRlbShpdGVtKSB7XG4gICAgdGhpcy5yZXNvbHZlKGl0ZW0ubm9uZSA/IFwiXCIgOiBpdGVtLnR5cCk7XG4gIH1cbn1cblxuLy8gVFlQLVBpY2tlciB3aXRoIGVhY2ggU3VidHlwIGluZGVudGVkIGJlbG93IGl0cyBUWVAgKHRoZSBkZWZhdWx0IHdoaWxlXG4vLyBcIlNlcGFyYXRlIFN1YnR5cC1QaWNrZXJcIiBpcyBvZmYsIHNlZSBwaWNrVHlwQW5kU3VidHlwKS4gVGhlIFRZUCByb3cgaXRzZWxmXG4vLyBtZWFucyBcIm5vIFN1YnR5cFwiLiBTZWFyY2ggd29ya3MgcGVyIGdyb3VwIHNvIGEgU3VidHlwIG5ldmVyIGFwcGVhcnMgd2l0aG91dFxuLy8gaXRzIFRZUDogYSBUWVAgbWF0Y2gga2VlcHMgYWxsIGl0cyBTdWJ0eXBzLCBhIFN1YnR5cCBtYXRjaCBrZWVwcyB0aGF0IFN1YnR5cFxuLy8gd2l0aCBpdHMgVFlQLiBHcm91cHMgc29ydCBieSB0aGVpciBiZXN0IG1hdGNoOyB3aXRoaW4gYSBncm91cCBibG9jayBvcmRlclxuLy8gc3RheXMuXG5jbGFzcyBUeXBTdWJ0eXBQaWNrZXJNb2RhbCBleHRlbmRzIFR5cFBpY2tlck1vZGFsIHtcbiAgY29uc3RydWN0b3IoYXBwLCBwbHVnaW4sIGdyb3VwcywgcmVzb2x2ZSkge1xuICAgIHN1cGVyKGFwcCwgcGx1Z2luLCBncm91cHMubWFwKChncm91cCkgPT4gZ3JvdXAuaXRlbSksIHJlc29sdmUpO1xuICAgIHRoaXMuZ3JvdXBzID0gZ3JvdXBzO1xuICB9XG5cbiAgZ2V0U3VnZ2VzdGlvbnMocXVlcnkpIHtcbiAgICBjb25zdCBzZWFyY2ggPSBxdWVyeS50cmltKCkgPyBwcmVwYXJlRnV6enlTZWFyY2gocXVlcnkudHJpbSgpKSA6IG51bGw7XG4gICAgY29uc3Qgbm9NYXRjaCA9IHsgc2NvcmU6IDAsIG1hdGNoZXM6IFtdIH07XG4gICAgY29uc3QgcmVzdWx0cyA9IFtdO1xuICAgIGZvciAoY29uc3QgeyBpdGVtLCBzdWJ0eXBzIH0gb2YgdGhpcy5ncm91cHMpIHtcbiAgICAgIGNvbnN0IHR5cE1hdGNoID0gc2VhcmNoID8gc2VhcmNoKHRoaXMuZ2V0SXRlbVRleHQoaXRlbSkpIDogbm9NYXRjaDtcbiAgICAgIGxldCBzdWJ0eXBNYXRjaGVzID0gc3VidHlwcy5tYXAoKHN1YnR5cCkgPT4gKHsgaXRlbTogc3VidHlwLCBtYXRjaDogc2VhcmNoID8gc2VhcmNoKHN1YnR5cC5zdWJ0eXApIDogbm9NYXRjaCB9KSk7XG4gICAgICBpZiAoIXR5cE1hdGNoKSBzdWJ0eXBNYXRjaGVzID0gc3VidHlwTWF0Y2hlcy5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeS5tYXRjaCk7XG4gICAgICBpZiAoIXR5cE1hdGNoICYmIHN1YnR5cE1hdGNoZXMubGVuZ3RoID09PSAwKSBjb250aW51ZTtcblxuICAgICAgY29uc3Qgc2NvcmVzID0gW3R5cE1hdGNoLCAuLi5zdWJ0eXBNYXRjaGVzLm1hcCgoZW50cnkpID0+IGVudHJ5Lm1hdGNoKV0uZmlsdGVyKEJvb2xlYW4pLm1hcCgobWF0Y2gpID0+IG1hdGNoLnNjb3JlKTtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHNjb3JlOiBNYXRoLm1heCguLi5zY29yZXMpLFxuICAgICAgICByb3dzOiBbeyBpdGVtLCBtYXRjaDogdHlwTWF0Y2ggPz8gbm9NYXRjaCB9LCAuLi5zdWJ0eXBNYXRjaGVzLm1hcCgoZW50cnkpID0+ICh7IGl0ZW06IGVudHJ5Lml0ZW0sIG1hdGNoOiBlbnRyeS5tYXRjaCA/PyBub01hdGNoIH0pKV0sXG4gICAgICB9KTtcbiAgICB9XG4gICAgaWYgKHNlYXJjaCkgcmVzdWx0cy5zb3J0KChhLCBiKSA9PiBiLnNjb3JlIC0gYS5zY29yZSk7XG4gICAgcmV0dXJuIHJlc3VsdHMuZmxhdE1hcCgoZ3JvdXApID0+IGdyb3VwLnJvd3MpO1xuICB9XG5cbiAgcmVuZGVyU3VnZ2VzdGlvbihtYXRjaCwgZWwpIHtcbiAgICBjb25zdCBpdGVtID0gbWF0Y2guaXRlbTtcbiAgICBpZiAoIWl0ZW0uc3VidHlwKSB7XG4gICAgICBzdXBlci5yZW5kZXJTdWdnZXN0aW9uKG1hdGNoLCBlbCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGVsLmFkZENsYXNzKFwidHlwLXBpY2tlci1zdWdnZXN0aW9uXCIsIFwidHlwLXBpY2tlci1zdWJ0eXBcIik7XG4gICAgdGhpcy5yZW5kZXJDb2xvcmVkTmFtZShlbCwgaXRlbS5zdWJ0eXAsIGl0ZW0udHlwLCBpdGVtLnN1YnR5cCk7XG4gICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtcGlja2VyLWNvdW50XCIsIHRleHQ6IFN0cmluZyhpdGVtLmNvdW50KSB9KTtcbiAgfVxuXG4gIG9uQ2hvb3NlSXRlbShpdGVtKSB7XG4gICAgdGhpcy5yZXNvbHZlKHsgdHlwOiBpdGVtLnR5cCwgc3VidHlwOiBpdGVtLnN1YnR5cCA/PyBudWxsIH0pO1xuICB9XG59XG5cbi8vIEluaXRpYWwgb3JkZXIgb2YgYSBwaWNrZXIgbGlzdCBnaXZlbiBhbiBhbHJlYWR5IHR5cGVkIHF1ZXJ5IChmcm9tIHRoZVxuLy8gVFlQLVBpY2tlciwgc2VlIHBpY2tUeXBFbnRyeSk6IG1hdGNoZXMgZmlyc3QgYnkgc2NvcmUsIHRoZSByZXN0IGFmdGVyIGluXG4vLyB1bmNoYW5nZWQgb3JkZXIuIElmIG5vdGhpbmcgbWF0Y2hlcyAoYSBkZXNjcmlwdGlvbiB3YXMgdHlwZWQsIHNheSkgdGhlXG4vLyBsaXN0IHN0YXlzIGFzIGl0IHdhcy4gVHlwaW5nIGluIHRoZSBwaWNrZXIgaXRzZWxmIHVzZXMgT2JzaWRpYW4ncyBzZWFyY2guXG5mdW5jdGlvbiBzb3J0QnlRdWVyeShpdGVtcywgcXVlcnksIGl0ZW1UZXh0KSB7XG4gIGNvbnN0IHNlYXJjaCA9IHF1ZXJ5Py50cmltKCkgPyBwcmVwYXJlRnV6enlTZWFyY2gocXVlcnkudHJpbSgpKSA6IG51bGw7XG4gIGlmICghc2VhcmNoKSByZXR1cm4gaXRlbXM7XG4gIGNvbnN0IHNjb3JlZCA9IGl0ZW1zLm1hcCgoaXRlbSwgaW5kZXgpID0+ICh7IGl0ZW0sIGluZGV4LCBzY29yZTogc2VhcmNoKGl0ZW1UZXh0KGl0ZW0pKT8uc2NvcmUgPz8gbnVsbCB9KSk7XG4gIGlmIChzY29yZWQuZXZlcnkoKGVudHJ5KSA9PiBlbnRyeS5zY29yZSA9PT0gbnVsbCkpIHJldHVybiBpdGVtcztcbiAgc2NvcmVkLnNvcnQoKGEsIGIpID0+IHtcbiAgICBpZiAoYS5zY29yZSA9PT0gbnVsbCB8fCBiLnNjb3JlID09PSBudWxsKSByZXR1cm4gYS5zY29yZSA9PT0gYi5zY29yZSA/IGEuaW5kZXggLSBiLmluZGV4IDogYS5zY29yZSA9PT0gbnVsbCA/IDEgOiAtMTtcbiAgICByZXR1cm4gYi5zY29yZSAtIGEuc2NvcmUgfHwgYS5pbmRleCAtIGIuaW5kZXg7XG4gIH0pO1xuICByZXR1cm4gc2NvcmVkLm1hcCgoZW50cnkpID0+IGVudHJ5Lml0ZW0pO1xufVxuXG4vLyBGb3IgVFlQLmpzOiBvcGVucyB0aGUgU3VidHlwLVBpY2tlciBpZiB0aGUgVFlQIGhhcyBhdCBsZWFzdCBvbmUgcmVnaXN0ZXJlZFxuLy8gU3VidHlwIChpbiBibG9jayBvcmRlcikuIHF1ZXJ5IHByZS1zb3J0cyB0aGUgbGlzdDogdHlwaW5nIFwiTGVocnZlcmFuc3RhbHR1bmdcIlxuLy8gdG8gcmVhY2ggT1JHQSBtZWFudCB0aGF0IFN1YnR5cCwgd2hpY2ggdGhlbiBzaXRzIG9uIHRvcCAtIEVudGVyIHN1ZmZpY2VzLlxuLy8gb3B0aW9ucyBhcyBpbiBnZXRTdWJ0eXBzOiBTdWJ0eXBzIHRoYXQgYXJlbid0IG1hbnVhbGx5IGNyZWF0YWJsZSBhcmUgbGVmdFxuLy8gb3V0IGJ5IGRlZmF1bHQsIGxpa2Ugc3VjaCBUWVAgZW50cmllcyBiZWZvcmUuIFJlc29sdmVzIHdpdGhcbi8vICAtIHRoZSBjaG9zZW4gU3VidHlwLFxuLy8gIC0gXCJcIiBmb3IgXCJubyBTdWJ0eXBcIiAodGhlIGZpcnN0IHJvdyB3aXRob3V0IGEgcXVlcnkpIC0gb3IgcmlnaHQgYXdheSxcbi8vICAgIHdpdGhvdXQgYSBwaWNrZXIsIGlmIHRoZSBUWVAgaGFzIG5vIHNlbGVjdGFibGUgU3VidHlwLFxuLy8gIC0gbnVsbCBvbiBFU0MgKFRZUC5qcyBnb2VzIGJhY2sgdG8gdGhlIFRZUCBjaG9pY2UpLlxuZnVuY3Rpb24gcGlja1N1YnR5cChhcHAsIHBsdWdpbiwgdHlwLCBxdWVyeSA9IFwiXCIsIG9wdGlvbnMgPSB7fSkge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICBjb25zdCBpdGVtcyA9IHBsdWdpbi5nZXRTdWJ0eXBzKHR5cCwgb3B0aW9ucykubWFwKCh7IHN1YnR5cCwgY291bnQgfSkgPT4gKHsgdHlwOiBzdWJ0eXAsIGRlc2NyaXB0aW9uOiBcIlwiLCBjb3VudCB9KSk7XG4gICAgaWYgKGl0ZW1zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmVzb2x2ZShcIlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgLy8gXCJubyBTdWJ0eXBcIiBmaXJzdDogRW50ZXIgcGlja3MgaXQgd2l0aG91dCB0eXBpbmcsIGFuZCBpdCBpcyBtb3JlIGNvbW1vblxuICAgIC8vIHRoYW4gYW55IHNpbmdsZSBTdWJ0eXAuXG4gICAgY29uc3Qgbm9uZUNvdW50ID0gcGx1Z2luLnR5cEluZGV4LnN1YnR5cEJ1Y2tldCh0eXApLm5vU3VidHlwO1xuICAgIGl0ZW1zLnVuc2hpZnQoeyB0eXA6IFwibm8gU3VidHlwXCIsIGRlc2NyaXB0aW9uOiBcIlwiLCBjb3VudDogbm9uZUNvdW50LCBub25lOiB0cnVlIH0pO1xuICAgIG5ldyBTdWJ0eXBQaWNrZXJNb2RhbChhcHAsIHBsdWdpbiwgdHlwLCBpdGVtcywgcmVzb2x2ZSwgcXVlcnkpLm9wZW4oKTtcbiAgfSk7XG59XG5cbi8vIFRZUCB2YWx1ZXMgdGhhdCBvY2N1ciBpbiBub3RlcyBidXQgYXJlbid0IGluIHNldHRpbmdzLnR5cHMsIGxpa2UgdGhlXG4vLyB1bnJlZ2lzdGVyZWQgcm93cyBvZiB0aGUgVFlQLUxpc3QuIExpc3RzIGFuZCBwYWRkZWQgdmFsdWVzIChzZWUgaXNDbGVhbktleSlcbi8vIGFyZSBsZWZ0IG91dDogdGhlIGNob3NlbiB2YWx1ZSBpcyB3cml0dGVuIGludG8gYSBuZXcgbm90ZSBhbmQgc2hvdWxkbid0IGJlIGFcbi8vIGNsZWFudXAgY2FzZSB0aGVyZS5cbmZ1bmN0aW9uIHVucmVnaXN0ZXJlZEl0ZW1zKGFwcCwgcGx1Z2luKSB7XG4gIGNvbnN0IHJlZ2lzdGVyZWQgPSBuZXcgU2V0KHBsdWdpbi5zZXR0aW5ncy50eXBzKTtcbiAgY29uc3QgeyBjb3VudHMgfSA9IHBsdWdpbi50eXBJbmRleC50eXBDb3VudHMoKTtcbiAgY29uc3Qgc29ydE9yZGVyID0gcGx1Z2luLnNldHRpbmdzLnR5cFNvcnRPcmRlciA/PyBERUZBVUxUX1NPUlRfT1JERVI7XG4gIHJldHVybiBbLi4uY291bnRzLmtleXMoKV1cbiAgICAuZmlsdGVyKCh0eXApID0+ICFyZWdpc3RlcmVkLmhhcyh0eXApICYmIHBsdWdpbi50eXBJbmRleC5pc0NsZWFuS2V5KHR5cCkpXG4gICAgLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVUeXBzKHNvcnRPcmRlciwgYSwgYiwgY291bnRzLCBwbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzKSlcbiAgICAubWFwKCh0eXApID0+ICh7IHR5cCwgZGVzY3JpcHRpb246IFwiXCIsIGNvdW50OiBjb3VudHMuZ2V0KHR5cCkgPz8gMCwgdW5yZWdpc3RlcmVkOiB0cnVlIH0pKTtcbn1cblxuLy8gUGlja3MgYSBzaW5nbGUgVFlQLCBmb3IgVFlQLmpzIGFuZCBldmVyeXdoZXJlIGluIHRoZSBwbHVnaW4uIGluY2x1ZGVNYW51YWxPZmZcbi8vIGFzIGluIGdldFR5cHMoKTsgaW5jbHVkZVVucmVnaXN0ZXJlZCBhZGRzIHZhbHVlcyB0aGF0IG9jY3VyIGluIG5vdGVzIGJ1dFxuLy8gYXJlbid0IHJlZ2lzdGVyZWQgKG11dGVkKS4gc2hvd1N1YnR5cHMgcHV0cyB0aGUgU3VidHlwIG5hbWVzIGFmdGVyIHRoZSBUWVBcbi8vIG5hbWUsIGZvciB0aGUgc2VwYXJhdGUgZmxvdyB3aGVyZSB0aGUgU3VidHlwLVBpY2tlciBjb21lcyBhZnRlcndhcmRzLlxuLy8gUmVzb2x2ZXMgd2l0aCB0aGUgVFlQLCBvciBudWxsIG9uIGNhbmNlbCBvciBpZiB0aGVyZSBpcyBub3RoaW5nIHRvIHNob3cuXG5mdW5jdGlvbiBwaWNrVHlwKGFwcCwgcGx1Z2luLCBvcHRpb25zID0ge30pIHtcbiAgcmV0dXJuIHBpY2tUeXBFbnRyeShhcHAsIHBsdWdpbiwgb3B0aW9ucykudGhlbigoZW50cnkpID0+IGVudHJ5Py50eXAgPz8gbnVsbCk7XG59XG5cbi8vIExpa2UgcGlja1R5cCwgYnV0IHJlc29sdmVzIHdpdGggeyB0eXAsIHF1ZXJ5IH0sIHF1ZXJ5IGJlaW5nIHdoYXQgd2FzIHR5cGVkLlxuLy8gT25seSBmb3IgcGlja1R5cEFuZFN1YnR5cCwgd2hpY2ggcGFzc2VzIGl0IG9uIHRvIHRoZSBTdWJ0eXAtUGlja2VyLlxuZnVuY3Rpb24gcGlja1R5cEVudHJ5KGFwcCwgcGx1Z2luLCBvcHRpb25zID0ge30pIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgY29uc3QgaXRlbXMgPSB0eXBJdGVtcyhhcHAsIHBsdWdpbiwgb3B0aW9ucyk7XG4gICAgaWYgKCFpdGVtcykge1xuICAgICAgcmVzb2x2ZShudWxsKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgbW9kYWwgPSBuZXcgVHlwUGlja2VyTW9kYWwoYXBwLCBwbHVnaW4sIGl0ZW1zLCAodHlwKSA9PiByZXNvbHZlKHR5cCA9PT0gbnVsbCA/IG51bGwgOiB7IHR5cCwgcXVlcnk6IG1vZGFsLnF1ZXJ5IH0pKTtcbiAgICBtb2RhbC5vcGVuKCk7XG4gIH0pO1xufVxuXG4vLyBTaGFyZWQgVFlQIGxpc3QgZm9yIHBpY2tUeXAvcGlja1R5cEFuZFN1YnR5cDsgbnVsbCBwbHVzIGEgbm90aWNlIGlmIHRoZXJlIGlzXG4vLyBub3RoaW5nIHRvIHNob3cgd2l0aCB0aGVzZSBvcHRpb25zLlxuZnVuY3Rpb24gdHlwSXRlbXMoYXBwLCBwbHVnaW4sIHsgaW5jbHVkZU1hbnVhbE9mZiA9IGZhbHNlLCBpbmNsdWRlVW5yZWdpc3RlcmVkID0gZmFsc2UsIHNob3dTdWJ0eXBzID0gZmFsc2UgfSA9IHt9KSB7XG4gIGNvbnN0IGl0ZW1zID0gcGx1Z2luLmdldFR5cHMoeyBpbmNsdWRlTWFudWFsT2ZmIH0pLm1hcCgoaXRlbSkgPT4gKHsgLi4uaXRlbSwgdW5yZWdpc3RlcmVkOiBmYWxzZSB9KSk7XG4gIGlmIChpbmNsdWRlVW5yZWdpc3RlcmVkKSBpdGVtcy5wdXNoKC4uLnVucmVnaXN0ZXJlZEl0ZW1zKGFwcCwgcGx1Z2luKSk7XG4gIC8vIE9ubHkgcmVnaXN0ZXJlZCBUWVAgZW50cmllcyBoYXZlIFN1YnR5cHM7IHRoZSBvdGhlcnMgc3RheSB1bmNoYW5nZWQuXG4gIGlmIChzaG93U3VidHlwcykge1xuICAgIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcykgaXRlbS5zdWJ0eXBzID0gcGx1Z2luLmdldFN1YnR5cHMoaXRlbS50eXAsIHsgaW5jbHVkZU1hbnVhbE9mZiB9KS5tYXAoKHsgc3VidHlwIH0pID0+IHN1YnR5cCk7XG4gIH1cbiAgaWYgKGl0ZW1zLmxlbmd0aCA+IDApIHJldHVybiBpdGVtcztcbiAgbmV3IE5vdGljZShcIk5vIFRZUCBhdmFpbGFibGUuXCIpO1xuICByZXR1cm4gbnVsbDtcbn1cblxuLy8gRm9yIFRZUC5qczogVFlQIGFuZCBTdWJ0eXAgaW4gb25lIGdvLiBXaXRoIHNlcGFyYXRlU3VidHlwUGlja2VyIG9mZiwgb25lXG4vLyBwaWNrZXIgd2l0aCBlYWNoIFN1YnR5cCBpbmRlbnRlZCBiZWxvdyBpdHMgVFlQOyB3aXRoIGl0IG9uLCBmaXJzdCB0aGVcbi8vIFRZUC1QaWNrZXIgKFN1YnR5cCBuYW1lcyBhZnRlciB0aGUgVFlQIG5hbWUpIGFuZCB0aGVuLCBpZiB0aGVyZSBpcyBhXG4vLyBzZWxlY3RhYmxlIFN1YnR5cCwgdGhlIFN1YnR5cC1QaWNrZXIgcHJlLXNvcnRlZCBieSB0aGUgcXVlcnkgKEVTQyBnb2VzIGJhY2tcbi8vIHRvIHRoZSBUWVAgY2hvaWNlKS4gaW5jbHVkZU1hbnVhbE9mZiBhbHNvIGFwcGxpZXMgdG8gdGhlIFN1YnR5cHMuXG4vLyBSZXNvbHZlcyB3aXRoIHsgdHlwLCBzdWJ0eXAgfSAoc3VidHlwIG51bGwgZm9yIFwibm8gU3VidHlwXCIpLCBvciBudWxsIG9uXG4vLyBjYW5jZWwuXG5hc3luYyBmdW5jdGlvbiBwaWNrVHlwQW5kU3VidHlwKGFwcCwgcGx1Z2luLCBvcHRpb25zID0ge30pIHtcbiAgaWYgKHBsdWdpbi5zZXR0aW5ncy5zZXBhcmF0ZVN1YnR5cFBpY2tlcikge1xuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBjb25zdCBlbnRyeSA9IGF3YWl0IHBpY2tUeXBFbnRyeShhcHAsIHBsdWdpbiwgeyAuLi5vcHRpb25zLCBzaG93U3VidHlwczogdHJ1ZSB9KTtcbiAgICAgIGlmICghZW50cnkpIHJldHVybiBudWxsO1xuICAgICAgY29uc3Qgc3VidHlwID0gYXdhaXQgcGlja1N1YnR5cChhcHAsIHBsdWdpbiwgZW50cnkudHlwLCBlbnRyeS5xdWVyeSwgb3B0aW9ucyk7XG4gICAgICBpZiAoc3VidHlwICE9PSBudWxsKSByZXR1cm4geyB0eXA6IGVudHJ5LnR5cCwgc3VidHlwOiBzdWJ0eXAgfHwgbnVsbCB9O1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGl0ZW1zID0gdHlwSXRlbXMoYXBwLCBwbHVnaW4sIG9wdGlvbnMpO1xuICBpZiAoIWl0ZW1zKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgZ3JvdXBzID0gaXRlbXMubWFwKChpdGVtKSA9PiAoe1xuICAgIGl0ZW0sXG4gICAgc3VidHlwczogcGx1Z2luLmdldFN1YnR5cHMoaXRlbS50eXAsIG9wdGlvbnMpLm1hcCgoeyBzdWJ0eXAsIGNvdW50IH0pID0+ICh7IHR5cDogaXRlbS50eXAsIHN1YnR5cCwgY291bnQgfSkpLFxuICB9KSk7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gbmV3IFR5cFN1YnR5cFBpY2tlck1vZGFsKGFwcCwgcGx1Z2luLCBncm91cHMsIHJlc29sdmUpLm9wZW4oKSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBwaWNrVHlwLCBwaWNrU3VidHlwLCBwaWNrVHlwQW5kU3VidHlwIH07XG4iLCAiY29uc3QgeyBURmlsZSwgVmF1bHQsIGRlYm91bmNlLCBub3JtYWxpemVQYXRoIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5cbi8vIE9ubHkgVGVtcGxhdGVyIHNjcmlwdHMgd2l0aCB0aGlzIG1hcmtlciBpbiBhIGNvbW1lbnQgYXJlIG9mZmVyZWQgaW4gdGhlXG4vLyBzaG9ydGN1dCBwaWNrZXI7IGhlbHBlciBzY3JpcHRzIG1ha2Ugbm8gc2Vuc2UgYXMgc2hvcnRjdXRzLiBUaGUgdGV4dCBhZnRlclxuLy8gdGhlIG1hcmtlciB1cCB0byB0aGUgbGluZSBlbmQgaXMgdGhlIGRlc2NyaXB0aW9uIChhIGNsb3NpbmcgXCIqL1wiIGlzIG5vdFxuLy8gcGFydCBvZiBpdCkuXG4vL1xuLy8gQW4gb3B0aW9uYWwgcGFyYW1ldGVyIGxpc3QgaW4gcGFyZW50aGVzZXMgcmlnaHQgYWZ0ZXIgdGhlIG1hcmtlciBkZXNjcmliZXNcbi8vIHRoZSBDT01QTEVURSBhcmd1bWVudCBsaXN0IGFmdGVyIFwidHBcIiwgaW5jbHVkaW5nIHdoZXJlIHRoZSBzY3JpcHQgd2FudHMgdGhlXG4vLyBmaWxlIG9yIGNvbnRleHQgKHNlZSBSRVNFUlZFRF9QQVJBTVMgaW4gc2hvcnRjdXRzLmpzKTpcbi8vICAgLy8gQHR5cC1zaG9ydGN1dChmb2xkZXIsIHllYXIpICAgICAgLT4gZih0cCwgXCJMaXRlcmF0dXJcIiwgMjAyNClcbi8vICAgLy8gQHR5cC1zaG9ydGN1dChuZXdGaWxlLCB5ZWFyKSAgICAgLT4gZih0cCwgbmV3RmlsZSwgMjAyNClcbi8vICAgLy8gQHR5cC1zaG9ydGN1dChwcm9wZXJ0eSkgICAgICAgICAgLT4gZih0cCwgXCJGYW1pbGllXCIpXG4vLyAgIC8vIEB0eXAtc2hvcnRjdXQgICAgICAgICAgICAgICAgICAgIC0+IGYodHAsIG5ld0ZpbGUsIGN0eClcbi8vIE5vIHBhcmVudGhlc2VzIChwYXJhbXMgPT09IG51bGwpIGlzIHRoZSBjbGFzc2ljIGNhbGwgZih0cCwgbmV3RmlsZSwgY3R4KTtcbi8vIGVtcHR5IHBhcmVudGhlc2VzIChwYXJhbXMgPT09IFtdKSBwYXNzIG9ubHkgdHAuXG4vL1xuLy8gVGhlIG1hcmtlciBtdXN0IHN0YXJ0IHRoZSBjb21tZW50LiBBbGxvd2luZyB0ZXh0IGJlZm9yZSBpdCBvbmNlIHR1cm5lZFxuLy8gVFlQLmpzIGludG8gYSBzaG9ydGN1dCwganVzdCBiZWNhdXNlIGl0cyBoZWFkZXIgY29tbWVudCBtZW50aW9ucyB0aGUgbWFya2VyLlxuLy8gXCJcXGJcIiBhZnRlciB0aGUgbmFtZSByZWplY3RzIFwiQHR5cC1zaG9ydGN1dFhZWlwiIGJ1dCBhbGxvd3MgdGhlIFwiKFwiLlxuY29uc3QgU0hPUlRDVVRfTUFSS0VSID0gL15bIFxcdF0qKD86XFwvXFwvK3xcXC9cXCorfFxcKilbIFxcdF0qQHR5cC1zaG9ydGN1dFxcYig/OlxcKChbXildKilcXCkpP1sgXFx0XSooLio/KVsgXFx0XSooPzpcXCpcXC8pP1sgXFx0XSokL207XG5cbi8vIFBhcmFtZXRlciBuYW1lcyBmcm9tIHRoZSBtYXJrZXIsIGluIGRlY2xhcmVkIG9yZGVyLiBFbXB0eSBlbnRyaWVzIChcIigpXCIsIGFcbi8vIHN0cmF5IGNvbW1hKSBhcmUgZHJvcHBlZCwgZHVwbGljYXRlcyBrZXB0IG9uY2UgLSB0d28gZmllbGRzIHdyaXRpbmcgdGhlIHNhbWVcbi8vIGVudHJ5IHdvdWxkIG9ubHkgY29uZnVzZS5cbmZ1bmN0aW9uIHBhcnNlUGFyYW1zKHJhdykge1xuICBjb25zdCBuYW1lcyA9IChyYXcgPz8gXCJcIilcbiAgICAuc3BsaXQoXCIsXCIpXG4gICAgLm1hcCgobmFtZSkgPT4gbmFtZS50cmltKCkpXG4gICAgLmZpbHRlcigobmFtZSkgPT4gbmFtZSAhPT0gXCJcIik7XG4gIHJldHVybiBbLi4ubmV3IFNldChuYW1lcyldO1xufVxuXG4vLyBLZWVwcyB0aGUgbGlzdCBvZiBtYXJrZWQgVGVtcGxhdGVyIHNjcmlwdHMgY3VycmVudC4gSXQgaXMgcmVhZCBhaGVhZCBvZiB0aW1lXG4vLyBhbmQgdXBkYXRlZCBvbiBjaGFuZ2VzLCBzbyB0aGUgcGlja2VyIG9wZW5zIHdpdGhvdXQgd2FpdGluZyBhbmQgd2l0aG91dCBmaWxlXG4vLyBhY2Nlc3MuIFJldHVybnMgYW4gYWNjZXNzb3IgZm9yIHRoZSBsaXN0IChbeyBuYW1lLCBwYXJhbXMsIGRlc2NyaXB0aW9uIH1dLFxuLy8gc29ydGVkIGJ5IG5hbWUpLlxuZnVuY3Rpb24gcmVnaXN0ZXJTaG9ydGN1dFNjcmlwdHMocGx1Z2luKSB7XG4gIGNvbnN0IHsgYXBwIH0gPSBwbHVnaW47XG5cbiAgbGV0IHNjcmlwdEZvbGRlciA9IG51bGw7XG4gIGxldCBzY3JpcHRzID0gW107XG5cbiAgY29uc3QgY3VycmVudFNjcmlwdEZvbGRlciA9ICgpID0+IHtcbiAgICBjb25zdCBmb2xkZXIgPSBhcHAucGx1Z2lucy5wbHVnaW5zW1widGVtcGxhdGVyLW9ic2lkaWFuXCJdPy5zZXR0aW5ncz8udXNlcl9zY3JpcHRzX2ZvbGRlcjtcbiAgICByZXR1cm4gZm9sZGVyID8gbm9ybWFsaXplUGF0aChmb2xkZXIpIDogbnVsbDtcbiAgfTtcblxuICBjb25zdCBpc0luU2NyaXB0Rm9sZGVyID0gKHBhdGgpID0+ICEhc2NyaXB0Rm9sZGVyICYmICEhcGF0aCAmJiBwYXRoLnN0YXJ0c1dpdGgoc2NyaXB0Rm9sZGVyICsgXCIvXCIpO1xuXG4gIC8vIExpa2UgVGVtcGxhdGVyOiBldmVyeSAuanMgaW4gdGhlIHNjcmlwdCBmb2xkZXIgaW5jbHVkaW5nIHN1YmZvbGRlcnMsXG4gIC8vIHNjcmlwdCBuYW1lID0gZmlsZSBuYW1lIHdpdGhvdXQgZXh0ZW5zaW9uLlxuICBhc3luYyBmdW5jdGlvbiByZWZyZXNoU2NyaXB0cygpIHtcbiAgICBjb25zdCBmb2xkZXJQYXRoID0gY3VycmVudFNjcmlwdEZvbGRlcigpO1xuICAgIHNjcmlwdEZvbGRlciA9IGZvbGRlclBhdGg7XG4gICAgY29uc3QgZm9sZGVyID0gZm9sZGVyUGF0aCA/IGFwcC52YXVsdC5nZXRGb2xkZXJCeVBhdGgoZm9sZGVyUGF0aCkgOiBudWxsO1xuICAgIGNvbnN0IGZpbGVzID0gW107XG4gICAgaWYgKGZvbGRlcikge1xuICAgICAgVmF1bHQucmVjdXJzZUNoaWxkcmVuKGZvbGRlciwgKGNoaWxkKSA9PiB7XG4gICAgICAgIGlmIChjaGlsZCBpbnN0YW5jZW9mIFRGaWxlICYmIGNoaWxkLmV4dGVuc2lvbiA9PT0gXCJqc1wiKSBmaWxlcy5wdXNoKGNoaWxkKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICBjb25zdCBmb3VuZCA9IFtdO1xuICAgIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgbWF0Y2ggPSAoYXdhaXQgYXBwLnZhdWx0LmNhY2hlZFJlYWQoZmlsZSkpLm1hdGNoKFNIT1JUQ1VUX01BUktFUik7XG4gICAgICAgIC8vIG1hdGNoWzFdIGlzIHVuZGVmaW5lZCB3aXRob3V0IHBhcmVudGhlc2VzIGFuZCBcIlwiIHdpdGggZW1wdHkgb25lcztcbiAgICAgICAgLy8gdGhhdCBkaWZmZXJlbmNlIGRlY2lkZXMgdGhlIGNhbGwgZm9ybS5cbiAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgZm91bmQucHVzaCh7XG4gICAgICAgICAgICBuYW1lOiBmaWxlLmJhc2VuYW1lLFxuICAgICAgICAgICAgcGFyYW1zOiBtYXRjaFsxXSA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IHBhcnNlUGFyYW1zKG1hdGNoWzFdKSxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBtYXRjaFsyXSA/PyBcIlwiLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYFRZUC1TeXN0ZW06IGNhbid0IHJlYWQgVGVtcGxhdGVyIHNjcmlwdCAke2ZpbGUucGF0aH1gLCBlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gRm9sZGVyIGNoYW5nZWQgaW4gVGVtcGxhdGVyIG1lYW53aGlsZTogZHJvcCB0aGlzIHJlc3VsdCwgdGhlIHJ1biBmb3IgdGhlXG4gICAgLy8gbmV3IGZvbGRlciBpcyBhbHJlYWR5IHNjaGVkdWxlZC5cbiAgICBpZiAoZm9sZGVyUGF0aCAhPT0gc2NyaXB0Rm9sZGVyKSByZXR1cm47XG4gICAgc2NyaXB0cyA9IGZvdW5kLnNvcnQoKGEsIGIpID0+IGEubmFtZS5sb2NhbGVDb21wYXJlKGIubmFtZSkpO1xuICB9XG5cbiAgY29uc3Qgc2NoZWR1bGVSZWZyZXNoID0gZGVib3VuY2UocmVmcmVzaFNjcmlwdHMsIDMwMCwgdHJ1ZSk7XG4gIGNvbnN0IG9uRmlsZUNoYW5nZSA9IChmaWxlLCBvbGRQYXRoKSA9PiB7XG4gICAgaWYgKGlzSW5TY3JpcHRGb2xkZXIoZmlsZT8ucGF0aCkgfHwgaXNJblNjcmlwdEZvbGRlcihvbGRQYXRoKSkgc2NoZWR1bGVSZWZyZXNoKCk7XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC52YXVsdC5vbihcImNyZWF0ZVwiLCBvbkZpbGVDaGFuZ2UpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoYXBwLnZhdWx0Lm9uKFwibW9kaWZ5XCIsIG9uRmlsZUNoYW5nZSkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJkZWxldGVcIiwgb25GaWxlQ2hhbmdlKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC52YXVsdC5vbihcInJlbmFtZVwiLCBvbkZpbGVDaGFuZ2UpKTtcbiAgYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KHJlZnJlc2hTY3JpcHRzKTtcblxuICByZXR1cm4gKCkgPT4ge1xuICAgIC8vIFRlbXBsYXRlciBmb2xkZXIgY2hhbmdlZDogcmVsb2FkIGZvciB0aGUgbmV4dCBjYWxsLCBhbnN3ZXIgd2l0aCB0aGVcbiAgICAvLyBjdXJyZW50IGxpc3QgZm9yIG5vdy5cbiAgICBpZiAoY3VycmVudFNjcmlwdEZvbGRlcigpICE9PSBzY3JpcHRGb2xkZXIpIHNjaGVkdWxlUmVmcmVzaCgpO1xuICAgIHJldHVybiBzY3JpcHRzO1xuICB9O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJTaG9ydGN1dFNjcmlwdHMsIFNIT1JUQ1VUX01BUktFUiwgcGFyc2VQYXJhbXMgfTtcbiIsICJjb25zdCB7IFBsdWdpbiB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBERUZBVUxUX1NFVFRJTkdTLCBUeXBTeXN0ZW1TZXR0aW5nVGFiIH0gPSByZXF1aXJlKFwiLi9zZXR0aW5nc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJDb21tYW5kcyB9ID0gcmVxdWlyZShcIi4vY29tbWFuZHNcIik7XG5jb25zdCB7IHJlZ2lzdGVyVHlwUGFuZSwgc29ydFR5cHNCeU1vZGUsIERFRkFVTFRfU09SVF9PUkRFUiB9ID0gcmVxdWlyZShcIi4vdHlwLXBhbmVcIik7XG5jb25zdCB7IFR5cEluZGV4LCBzZXRDYW5vbmljYWxQcm9wZXJ0eSwgZGVsZXRlUHJvcGVydHksIFRZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZIH0gPSByZXF1aXJlKFwiLi90eXAtaW5kZXhcIik7XG5jb25zdCB7IGdldFN1YnR5cCwgZ2V0U3VidHlwTmFtZXMsIGlzU3VidHlwTWFudWFsIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBzXCIpO1xuY29uc3QgeyByZWdpc3RlckZpbGVFeHBsb3JlckNvbG9ycyB9ID0gcmVxdWlyZShcIi4vZmlsZS1leHBsb3Jlci1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyR3JhcGhDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL2dyYXBoLWNvbG9yc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJTZWFyY2hDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL3NlYXJjaC1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyUmVjZW50RmlsZXNDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL3JlY2VudC1maWxlcy1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyQmFja2xpbmtDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL2JhY2tsaW5rLWNvbG9yc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJCb29rbWFya3NDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL2Jvb2ttYXJrLWNvbG9yc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJBY3RpdmVUaXRsZUNvbG9ycyB9ID0gcmVxdWlyZShcIi4vYWN0aXZlLXRpdGxlLWNvbG9yc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJMaW5rQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9saW5rLWNvbG9yc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLWRlZmF1bHQtaGlnaGxpZ2h0XCIpO1xuY29uc3QgeyByZWdpc3RlclByb3BlcnR5UmVuYW1lU3luYyB9ID0gcmVxdWlyZShcIi4vcHJvcGVydHktcmVuYW1lLXN5bmNcIik7XG5jb25zdCB7IHJlbW92ZVByb3BlcnR5TWVudVBhdGNoIH0gPSByZXF1aXJlKFwiLi90eXAtZnJvbnRtYXR0ZXItZWRpdG9yXCIpO1xuY29uc3QgeyBub3JtYWxpemVHbG9iYWxPcmRlciwgc29ydEZyb250bWF0dGVyRm9yLCBwbGFjZVByb3BlcnR5Rm9yIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1zb3J0XCIpO1xuY29uc3QgeyByZXNvbHZlU2hvcnRjdXRzLCBzY3JpcHROYW1lT2YsIHJlc29sdmVDYWxsQXJncyB9ID0gcmVxdWlyZShcIi4vc2hvcnRjdXRzXCIpO1xuY29uc3Qge1xuICBwaWNrVHlwOiBwaWNrVHlwTW9kYWwsXG4gIHBpY2tTdWJ0eXA6IHBpY2tTdWJ0eXBNb2RhbCxcbiAgcGlja1R5cEFuZFN1YnR5cDogcGlja1R5cEFuZFN1YnR5cE1vZGFsLFxufSA9IHJlcXVpcmUoXCIuL3R5cC1waWNrZXJcIik7XG5jb25zdCB7IHJlZ2lzdGVyU2hvcnRjdXRTY3JpcHRzIH0gPSByZXF1aXJlKFwiLi9zaG9ydGN1dC1zY3JpcHRzXCIpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGNsYXNzIFR5cFN5c3RlbVBsdWdpbiBleHRlbmRzIFBsdWdpbiB7XG4gIGFzeW5jIG9ubG9hZCgpIHtcbiAgICBhd2FpdCB0aGlzLmxvYWRTZXR0aW5ncygpO1xuXG4gICAgLy8gQmVmb3JlIGFsbCBvdGhlciBtb2R1bGVzOiB0aGV5IGxpc3RlbiB0byBpdHMgXCJjaGFuZ2VcIiBldmVudCBhbmQgcmVhZFxuICAgIC8vIFRZUC9TVUJUWVAgb25seSB0aHJvdWdoIGl0IChzZWUgdHlwLWluZGV4LmpzKS5cbiAgICB0aGlzLnR5cEluZGV4ID0gbmV3IFR5cEluZGV4KHRoaXMpO1xuICAgIHRoaXMudHlwSW5kZXgucmVnaXN0ZXIoKTtcblxuICAgIHJlZ2lzdGVyQ29tbWFuZHModGhpcyk7XG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBUeXBTeXN0ZW1TZXR0aW5nVGFiKHRoaXMuYXBwLCB0aGlzKSk7XG4gICAgLy8gQ2FycmllcyByZW5hbWVzIGZyb20gXCJBbGwgcHJvcGVydGllc1wiL0Jhc2VzIGludG8gdGhlIFRZUC1Gcm9udG1hdHRlci5cbiAgICByZWdpc3RlclByb3BlcnR5UmVuYW1lU3luYyh0aGlzKTtcbiAgICAvLyBUaGUgVFlQLVBhbmUgcGF0Y2hlcyB0aGUgcHJvcGVydHkgbWVudSBsYXppbHkgKGVuc3VyZVByb3BlcnR5TWVudVBhdGNoKS5cbiAgICB0aGlzLnJlZ2lzdGVyKHJlbW92ZVByb3BlcnR5TWVudVBhdGNoKTtcbiAgICAvLyBBY2Nlc3NvciBmb3IgdGhlIFRlbXBsYXRlciBzY3JpcHRzIG1hcmtlZCBcIkB0eXAtc2hvcnRjdXRcIiwgdXNlZCBieSB0aGVcbiAgICAvLyBzaG9ydGN1dCBwaWNrZXIgb2YgdGhlIHByb3BlcnR5IHJvd3MuXG4gICAgdGhpcy5nZXRTaG9ydGN1dFNjcmlwdHMgPSByZWdpc3RlclNob3J0Y3V0U2NyaXB0cyh0aGlzKTtcblxuICAgIC8vIEtlcHQgc2VwYXJhdGUgZnJvbSByZWZyZXNoRm5zOiBhZnRlciBtb3VudGluZyBpdHMgZWRpdG9ycyB0aGUgVFlQLVBhbmVcbiAgICAvLyBuZWVkcyBvbmx5IHRoaXMgcmVmcmVzaCAoYm9sZCBwcm9wZXJ0eSBuYW1lcykuIFRoZSB3aG9sZVxuICAgIC8vIHJlZnJlc2hUeXBDb2xvcnMoKSBidW5kbGUgd291bGQgYWxzbyB0cmlnZ2VyIHRoZSB2aWV3J3Mgb3duIHJlLXJlbmRlciBhbmRcbiAgICAvLyByZWN1cnNlIGludG8gYSBzdGFjayBvdmVyZmxvdyBvbiBldmVyeSBUWVAgb3BlbmVkLlxuICAgIHRoaXMucmVmcmVzaEZyb250bWF0dGVySGlnaGxpZ2h0ID0gcmVnaXN0ZXJGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQodGhpcyk7XG5cbiAgICBjb25zdCByZWZyZXNoRm5zID0gW1xuICAgICAgcmVnaXN0ZXJUeXBQYW5lKHRoaXMpLFxuICAgICAgcmVnaXN0ZXJGaWxlRXhwbG9yZXJDb2xvcnModGhpcyksXG4gICAgICByZWdpc3RlckdyYXBoQ29sb3JzKHRoaXMpLFxuICAgICAgcmVnaXN0ZXJTZWFyY2hDb2xvcnModGhpcyksXG4gICAgICByZWdpc3RlclJlY2VudEZpbGVzQ29sb3JzKHRoaXMpLFxuICAgICAgcmVnaXN0ZXJCYWNrbGlua0NvbG9ycyh0aGlzKSxcbiAgICAgIHJlZ2lzdGVyQm9va21hcmtzQ29sb3JzKHRoaXMpLFxuICAgICAgcmVnaXN0ZXJBY3RpdmVUaXRsZUNvbG9ycyh0aGlzKSxcbiAgICAgIHJlZ2lzdGVyTGlua0NvbG9ycyh0aGlzKSxcbiAgICAgIHRoaXMucmVmcmVzaEZyb250bWF0dGVySGlnaGxpZ2h0LFxuICAgIF07XG4gICAgdGhpcy5yZWZyZXNoVHlwQ29sb3JzID0gKCkgPT4gcmVmcmVzaEZucy5mb3JFYWNoKChmbikgPT4gZm4oKSk7XG5cbiAgICAvLyBTdHlsZSBTZXR0aW5ncyByZWFkcyBzdHlsZXNoZWV0cyB3aGVuIGl0IGxvYWRzIGFuZCBhZnRlcndhcmRzIG9ubHkgb25cbiAgICAvLyBcImNzcy1jaGFuZ2VcIiwgd2hpY2ggZmlyZXMgZm9yIHRoZW1lcyBhbmQgc25pcHBldHMgYnV0IG5vdCBmb3IgYSBwbHVnaW4nc1xuICAgIC8vIHN0eWxlcy5jc3MuIEEgcGx1Z2luIGxvYWRlZCBsYXRlciAob3IgaG90LXJlbG9hZGVkKSB3b3VsZCBiZSBtaXNzaW5nXG4gICAgLy8gdGhlcmU7IFwicGFyc2Utc3R5bGUtc2V0dGluZ3NcIiBpcyB0aGUgaW50ZW5kZWQgaG9vay4gV2l0aG91dCBTdHlsZVxuICAgIC8vIFNldHRpbmdzIG5vYm9keSBsaXN0ZW5zIGFuZCBub3RoaW5nIGhhcHBlbnMuXG4gICAgLy9cbiAgICAvLyBOZXh0IHRpY2ssIGJlY2F1c2UgT2JzaWRpYW4gYWRkcyBhIHBsdWdpbidzIHN0eWxlcy5jc3Mgb25seSBBRlRFUlxuICAgIC8vIG9ubG9hZCgpLiBvbkxheW91dFJlYWR5IGRvZXNuJ3QgaGVscDogb24gaG90IHJlbG9hZCB0aGUgbGF5b3V0IGlzIGxvbmdcbiAgICAvLyByZWFkeSBhbmQgdGhlIGNhbGxiYWNrIHdvdWxkIHJ1biBhdCBvbmNlLCBqdXN0IGFzIGVhcmx5LlxuICAgIGNvbnN0IHBhcnNlU3R5bGVTZXR0aW5ncyA9IHdpbmRvdy5zZXRUaW1lb3V0KCgpID0+IHRoaXMuYXBwLndvcmtzcGFjZS50cmlnZ2VyKFwicGFyc2Utc3R5bGUtc2V0dGluZ3NcIiksIDApO1xuICAgIHRoaXMucmVnaXN0ZXIoKCkgPT4gd2luZG93LmNsZWFyVGltZW91dChwYXJzZVN0eWxlU2V0dGluZ3MpKTtcbiAgfVxuXG4gIG9udW5sb2FkKCkge31cblxuICAvLyBGb3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qczogdGhlIFRZUC1Gcm9udG1hdHRlciBvZiBhIFRZUCwgc29cbiAgLy8gVGVtcGxhdGVyIGNhbiBhcHBseSBpdCB0byBhIG5ldyBub3RlIGluc3RlYWQgb2Yga2VlcGluZyBhIHNlY29uZCBjb3B5LiBBXG4gIC8vIGNvcHksIHNvIGNhbGxlcnMgbWF5IGNoYW5nZSBpdCBmcmVlbHkuXG4gIC8vXG4gIC8vIFByb3BlcnRpZXMgd2l0aCBhIGZpeGVkIHNob3J0Y3V0ICh0b2RheS9ub3cvY3JlYXRlZCwgc2VlIHNob3J0Y3V0cy5qcylcbiAgLy8gY2FycnkgaXRzIHZhbHVlLCBjb21wdXRlZCBmcmVzaCBvbiBlYWNoIGNhbGwuIFByb3BlcnRpZXMgd2l0aCBhIHNjcmlwdFxuICAvLyBzaG9ydGN1dCBjYXJyeSBudWxsOiBvbmx5IFRlbXBsYXRlciBjYW4gcmVzb2x2ZSB0aGVtLCBUWVAuanMgZ2V0cyB0aGVtIHZpYVxuICAvLyBnZXRUeXBTaG9ydGN1dHMoKSBhbmQgZmlsbHMgdGhlbSBpbi4gS2V5IGFuZCBwb3NpdGlvbiBzdGF5IGVpdGhlciB3YXkuXG4gIC8vXG4gIC8vIGluY2x1ZGVGbG9hdGluZyAoZGVmYXVsdCBmYWxzZSkga2VlcHMgZmxvYXRpbmcga2V5cyBpbiB0aGUgcmVzdWx0OyB0aGV5XG4gIC8vIGFyZSBub3QgY3JlYXRlZCBmb3IgZXZlcnkgbmV3IG5vdGUsIG9ubHkgd2hlbiBhIHNjcmlwdCBhc2tzIGZvciB0aGVtLlxuICAvL1xuICAvLyBmaWxlIChvcHRpb25hbCkgZ29lcyB0byByZXNvbHZlU2hvcnRjdXRzKCkgZm9yIFwiY3JlYXRlZFwiLCB3aGljaCByZXR1cm5zXG4gIC8vIHRoZSBmaWxlJ3MgY3JlYXRpb24gZGF0ZSBpbnN0ZWFkIG9mIHRoZSBjYWxsIHRpbWUuXG4gIC8vXG4gIC8vIHN1YnR5cCAob3B0aW9uYWwpIGFwcGVuZHMgdGhhdCBTdWJ0eXAncyBibG9jay4gQSBrZXkgaW4gQk9USCBibG9ja3Mga2VlcHNcbiAgLy8gdGhlIFRZUC1Gcm9udG1hdHRlciBwb3NpdGlvbiwgYnV0IHZhbHVlLCBmbG9hdGluZyBmbGFnIGFuZCBzaG9ydGN1dCBjb21lXG4gIC8vIGZyb20gdGhlIFN1YnR5cC4gRnJvbnRtYXR0ZXIgc29ydGluZyBtdXN0IHVzZSB0aGUgc2FtZSBydWxlIChzZWVcbiAgLy8gb3JkZXJlZERlZmF1bHRLZXlzIGluIGZyb250bWF0dGVyLXNvcnQuanMpLCBvciBpdCB3b3VsZCByZS1zb3J0IGEgbmV3IG5vdGVcbiAgLy8gcmlnaHQgYXdheS5cbiAgZ2V0VHlwRGVmYXVsdHModHlwLCB7IGluY2x1ZGVGbG9hdGluZyA9IGZhbHNlLCBmaWxlLCBzdWJ0eXAgPSBudWxsIH0gPSB7fSkge1xuICAgIGNvbnN0IHsgZGVmYXVsdHMsIHNob3J0Y3V0cyB9ID0gdGhpcy5jb2xsZWN0QmxvY2tzKHR5cCwgc3VidHlwLCBpbmNsdWRlRmxvYXRpbmcpO1xuICAgIHJldHVybiByZXNvbHZlU2hvcnRjdXRzKGRlZmF1bHRzLCBzaG9ydGN1dHMsIHsgZmlsZSwgYXBwOiB0aGlzLmFwcCB9KTtcbiAgfVxuXG4gIC8vIFNoYXJlZCBiYXNlIG9mIGdldFR5cERlZmF1bHRzKCkgYW5kIGdldFR5cFNob3J0Y3V0cygpOiB0aGUgVFlQLUZyb250bWF0dGVyXG4gIC8vIHBsdXMgdGhlIFN1YnR5cCdzIGJsb2NrLiBBIGtleSBpbiBCT1RIIGtlZXBzIHRoZSBUWVAtRnJvbnRtYXR0ZXIgcG9zaXRpb247XG4gIC8vIHZhbHVlLCBmbG9hdGluZyBmbGFnIEFORCBzaG9ydGN1dCBjb21lIGZyb20gdGhlIFN1YnR5cCAtIFwibm8gc2hvcnRjdXRcIlxuICAvLyBjb3VudHMgYXMgdGhlIFN1YnR5cCdzIGNob2ljZSB0b28gYW5kIGNhbmNlbHMgdGhlIFRZUCdzLlxuICBjb2xsZWN0QmxvY2tzKHR5cCwgc3VidHlwLCBpbmNsdWRlRmxvYXRpbmcpIHtcbiAgICBjb25zdCBkZWZhdWx0cyA9IHt9O1xuICAgIGNvbnN0IHNob3J0Y3V0cyA9IHt9O1xuICAgIGNvbnN0IGlzRmxvYXRpbmcgPSBuZXcgTWFwKCk7XG4gICAgY29uc3QgYWRkQmxvY2sgPSAoZnJvbnRtYXR0ZXIsIGZsb2F0aW5nS2V5cywgYmxvY2tTaG9ydGN1dHMpID0+IHtcbiAgICAgIGNvbnN0IGFjdHVhbEtleXMgPSBuZXcgTWFwKE9iamVjdC5rZXlzKGRlZmF1bHRzKS5tYXAoKGtleSkgPT4gW2tleS50b0xvd2VyQ2FzZSgpLCBrZXldKSk7XG4gICAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhmcm9udG1hdHRlciA/PyB7fSkpIHtcbiAgICAgICAgaWYgKGtleSA9PT0gXCJcIikgY29udGludWU7XG4gICAgICAgIGNvbnN0IHRhcmdldCA9IGFjdHVhbEtleXMuZ2V0KGtleS50b0xvd2VyQ2FzZSgpKSA/PyBrZXk7XG4gICAgICAgIGRlZmF1bHRzW3RhcmdldF0gPSB2YWx1ZTtcbiAgICAgICAgaXNGbG9hdGluZy5zZXQodGFyZ2V0LCAoZmxvYXRpbmdLZXlzID8/IFtdKS5pbmNsdWRlcyhrZXkpKTtcbiAgICAgICAgY29uc3QgcmVjb3JkID0gKGJsb2NrU2hvcnRjdXRzID8/IHt9KVtrZXldO1xuICAgICAgICBpZiAocmVjb3JkKSBzaG9ydGN1dHNbdGFyZ2V0XSA9IHJlY29yZDtcbiAgICAgICAgZWxzZSBkZWxldGUgc2hvcnRjdXRzW3RhcmdldF07XG4gICAgICB9XG4gICAgfTtcbiAgICBjb25zdCBzdWJ0eXBEYXRhID0gc3VidHlwID8gZ2V0U3VidHlwKHRoaXMuc2V0dGluZ3MsIHR5cCwgc3VidHlwKSA6IG51bGw7XG4gICAgYWRkQmxvY2soXG4gICAgICB0aGlzLnNldHRpbmdzLnR5cERlZmF1bHRGcm9udG1hdHRlclt0eXBdLFxuICAgICAgdGhpcy5zZXR0aW5ncy50eXBGbG9hdGluZ0tleXNbdHlwXSxcbiAgICAgIHRoaXMuc2V0dGluZ3MudHlwU2hvcnRjdXRzW3R5cF1cbiAgICApO1xuICAgIGlmIChzdWJ0eXBEYXRhKSBhZGRCbG9jayhzdWJ0eXBEYXRhLmZyb250bWF0dGVyLCBzdWJ0eXBEYXRhLmZsb2F0aW5nS2V5cywgc3VidHlwRGF0YS5zaG9ydGN1dHMpO1xuXG4gICAgaWYgKCFpbmNsdWRlRmxvYXRpbmcpIHtcbiAgICAgIGZvciAoY29uc3QgW2tleSwgZmxvYXRpbmddIG9mIGlzRmxvYXRpbmcpIHtcbiAgICAgICAgaWYgKCFmbG9hdGluZykgY29udGludWU7XG4gICAgICAgIGRlbGV0ZSBkZWZhdWx0c1trZXldO1xuICAgICAgICBkZWxldGUgc2hvcnRjdXRzW2tleV07XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB7IGRlZmF1bHRzLCBzaG9ydGN1dHMgfTtcbiAgfVxuXG4gIC8vIEZvciBUWVAuanM6IHRoZSBwcm9wZXJ0aWVzIG9mIHRoaXMgVFlQIHdob3NlIHZhbHVlIGNvbWVzIGZyb20gYSBUZW1wbGF0ZXJcbiAgLy8gc2NyaXB0LCBhcyB7IFtwcm9wZXJ0eV06IHsgbmFtZSwgcGFyYW1zLCBhcmdzLCBmYWxsYmFjayB9IH0gaW5cbiAgLy8gVFlQLUZyb250bWF0dGVyIG9yZGVyICh0aGUgc2NyaXB0cyBydW4gaW4gdHVybiBhbmQgc2VlIGVhcmxpZXIgcmVzdWx0cykuXG4gIC8vXG4gIC8vICAgbmFtZSAgICAgIHNjcmlwdCBuYW1lIHdpdGhvdXQgXCJ0cC5cIiwgaS5lLiB0cC51c2VyLjxuYW1lPlxuICAvLyAgIHBhcmFtcyAgICB0aGUgcGFyYW1ldGVyIGxpc3QgZGVjbGFyZWQgaW4gdGhlIEB0eXAtc2hvcnRjdXQgbWFya2VyLCBvclxuICAvLyAgICAgICAgICAgICBudWxsIHdpdGhvdXQgcGFyZW50aGVzZXMuIFRha2VuIGZyb20gdGhlIGN1cnJlbnQgc2Nhbiwgc28gYVxuICAvLyAgICAgICAgICAgICBjaGFuZ2VkIGRlY2xhcmF0aW9uIGFwcGxpZXMgYXQgb25jZS4gVFlQLmpzIHR1cm5zIGl0IGludG8gdGhlXG4gIC8vICAgICAgICAgICAgIGNhbGwncyBhcmd1bWVudHMgd2l0aCByZXNvbHZlU2hvcnRjdXRBcmdzKClcbiAgLy8gICBhcmdzICAgICAgdGhlIHR5cGVkIGFyZ3VtZW50cywgbmFtZWQgYWZ0ZXIgdGhlIG5vbi1yZXNlcnZlZCBwYXJhbWV0ZXJzO1xuICAvLyAgICAgICAgICAgICBhbiBlbXB0eSBmaWVsZCBpcyBtaXNzaW5nIHNvIFwiYXJncy54ID8/IGZhbGxiYWNrXCIgd29ya3NcbiAgLy8gICBmYWxsYmFjayAgdGhlIGZpeGVkIHZhbHVlIHN0b3JlZCBmb3IgdGhlIHByb3BlcnR5LiBPbmx5IGEgRkFMTEJBQ0s6XG4gIC8vICAgICAgICAgICAgIFRZUC5qcyB3cml0ZXMgaXQgaWYgdGhlIHNjcmlwdCBpcyBtaXNzaW5nIG9yIHRocm93cy4gQSBzY3JpcHRcbiAgLy8gICAgICAgICAgICAgdGhhdCBkZWxpYmVyYXRlbHkgcmV0dXJucyBudWxsL1wiXCIgKEVTQyBpbiBhIHBpY2tlcikgaGFzIG5vdFxuICAvLyAgICAgICAgICAgICBmYWlsZWQgLSB0aGUgcHJvcGVydHkgc3RheXMgZW1wdHkgdGhlbi5cbiAgLy9cbiAgLy8gRml4ZWQgc2hvcnRjdXRzICh0b2RheS9ub3cvY3JlYXRlZCkgZG9uJ3QgYXBwZWFyIGhlcmU7IGdldFR5cERlZmF1bHRzKClcbiAgLy8gYWxyZWFkeSByZXNvbHZlcyB0aGVtIGFuZCByZXR1cm5zIHRoZSBzY3JpcHQga2V5cyBhcyBudWxsLlxuICAvL1xuICAvLyBPcHRpb25zIGFzIGluIGdldFR5cERlZmF1bHRzKCk7IGluY2x1ZGVGbG9hdGluZyBkZWZhdWx0cyB0byBmYWxzZSBzbyBub1xuICAvLyBzY3JpcHQgcnVucyB1bmFza2VkIGZvciBhIGZsb2F0aW5nIHByb3BlcnR5LlxuICBnZXRUeXBTaG9ydGN1dHModHlwLCB7IGluY2x1ZGVGbG9hdGluZyA9IGZhbHNlLCBzdWJ0eXAgPSBudWxsIH0gPSB7fSkge1xuICAgIGNvbnN0IHsgZGVmYXVsdHMsIHNob3J0Y3V0cyB9ID0gdGhpcy5jb2xsZWN0QmxvY2tzKHR5cCwgc3VidHlwLCBpbmNsdWRlRmxvYXRpbmcpO1xuICAgIGNvbnN0IHNjcmlwdHMgPSB0aGlzLmdldFNob3J0Y3V0U2NyaXB0cz8uKCkgPz8gW107XG4gICAgY29uc3QgcmVzdWx0ID0ge307XG4gICAgZm9yIChjb25zdCBba2V5LCByZWNvcmRdIG9mIE9iamVjdC5lbnRyaWVzKHNob3J0Y3V0cykpIHtcbiAgICAgIGNvbnN0IG5hbWUgPSBzY3JpcHROYW1lT2YocmVjb3JkLm5hbWUpO1xuICAgICAgaWYgKG5hbWUgPT09IG51bGwpIGNvbnRpbnVlO1xuICAgICAgY29uc3Qgc2NyaXB0ID0gc2NyaXB0cy5maW5kKChzKSA9PiBzLm5hbWUgPT09IG5hbWUpO1xuICAgICAgcmVzdWx0W2tleV0gPSB7XG4gICAgICAgIG5hbWUsXG4gICAgICAgIHBhcmFtczogc2NyaXB0Py5wYXJhbXMgPz8gbnVsbCxcbiAgICAgICAgYXJnczogeyAuLi4ocmVjb3JkLmFyZ3MgPz8ge30pIH0sXG4gICAgICAgIGZhbGxiYWNrOiBkZWZhdWx0c1trZXldID8/IG51bGwsXG4gICAgICB9O1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgLy8gRm9yIFRZUC5qczogdHVybnMgYSBzaG9ydGN1dCdzIHBhcmFtZXRlciBsaXN0IGludG8gdGhlIGFyZ3VtZW50cyBvZlxuICAvLyB0cC51c2VyLjxuYW1lPih0cCwgLi4uKSAtIHNlZSByZXNvbHZlQ2FsbEFyZ3MgaW4gc2hvcnRjdXRzLmpzLiBMaXZlcyBoZXJlXG4gIC8vIHNvIHRoZSBydWxlcyAocmVzZXJ2ZWQgbmFtZXMsIGRvdHRlZCBuYW1lcykgZXhpc3QgaW4gb25lIHBsYWNlOyBvbmx5XG4gIC8vIFRZUC5qcyBrbm93cyBuZXdGaWxlIGFuZCBjdHgsIHNvIGl0IHBhc3NlcyB0aGVtIGluLlxuICByZXNvbHZlU2hvcnRjdXRBcmdzKHBhcmFtcywgYXJncywgeyBuZXdGaWxlID0gbnVsbCwgY3R4ID0gbnVsbCwga2V5ID0gbnVsbCB9ID0ge30pIHtcbiAgICByZXR1cm4gcmVzb2x2ZUNhbGxBcmdzKHBhcmFtcywgYXJncywgeyBuZXdGaWxlLCBjdHgsIGtleSB9KTtcbiAgfVxuXG4gIC8vIEZvciBUWVAuanM6IHJlZ2lzdGVyZWQgU3VidHlwcyBvZiBhIFRZUCBpbiBibG9jayBvcmRlciwgd2l0aCBub3RlIGNvdW50cy5cbiAgLy8gU3VidHlwcyB0aGF0IGFyZW4ndCBtYW51YWxseSBjcmVhdGFibGUgYXJlIGxlZnQgb3V0IHVubGVzc1xuICAvLyBpbmNsdWRlTWFudWFsT2ZmIGlzIHNldCwgbGlrZSBzdWNoIFRZUCBlbnRyaWVzIGluIGdldFR5cHMoKS5cbiAgZ2V0U3VidHlwcyh0eXAsIHsgaW5jbHVkZU1hbnVhbE9mZiA9IGZhbHNlIH0gPSB7fSkge1xuICAgIGNvbnN0IHsgY291bnRzIH0gPSB0aGlzLnR5cEluZGV4LnN1YnR5cEJ1Y2tldCh0eXApO1xuICAgIHJldHVybiBnZXRTdWJ0eXBOYW1lcyh0aGlzLnNldHRpbmdzLCB0eXApXG4gICAgICAuZmlsdGVyKChzdWJ0eXApID0+IGluY2x1ZGVNYW51YWxPZmYgfHwgaXNTdWJ0eXBNYW51YWwodGhpcy5zZXR0aW5ncywgdHlwLCBzdWJ0eXApKVxuICAgICAgLm1hcCgoc3VidHlwKSA9PiAoeyBzdWJ0eXAsIGNvdW50OiBjb3VudHMuZ2V0KHN1YnR5cCkgPz8gMCB9KSk7XG4gIH1cblxuICAvLyBGb3IgVFlQLmpzOiB0aGUgU3VidHlwLVBpY2tlciAoc2VlIHR5cC1waWNrZXIuanMpLiBSZXNvbHZlcyB3aXRoIHRoZVxuICAvLyBTdWJ0eXAsIFwiXCIgZm9yIFwibm8gU3VidHlwXCIgKG9yIHdpdGhvdXQgYSBwaWNrZXIgaWYgdGhlIFRZUCBoYXMgbm9uZSksIG9yXG4gIC8vIG51bGwgb24gRVNDIChUWVAuanMgdGhlbiBnb2VzIGJhY2sgdG8gdGhlIFRZUCBjaG9pY2UpLiBxdWVyeSAob3B0aW9uYWwpOlxuICAvLyBhbiBhbHJlYWR5IHR5cGVkIHNlYXJjaCB0aGF0IHByZS1zb3J0cyB0aGUgbGlzdC4gb3B0aW9ucyBhcyBpbiBnZXRTdWJ0eXBzLlxuICBwaWNrU3VidHlwKHR5cCwgcXVlcnkgPSBcIlwiLCBvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gcGlja1N1YnR5cE1vZGFsKHRoaXMuYXBwLCB0aGlzLCB0eXAsIHF1ZXJ5LCBvcHRpb25zKTtcbiAgfVxuXG4gIC8vIEZvciBUWVAuanMsIGluc2lkZSBwcm9jZXNzRnJvbnRNYXR0ZXI6IHNldHMgVFlQIGFuZCBTVUJUWVAgaW4gY2Fub25pY2FsXG4gIC8vIHNwZWxsaW5nIC0gYSB2YXJpYW50IGxpa2UgXCJ0eXBcIiBvciBcIlN1YnR5cFwiIGlzIHJlbmFtZWQgaW4gcGxhY2UgcmF0aGVyIHRoYW5cbiAgLy8gZHVwbGljYXRlZC4gc3VidHlwIG51bGwgcmVtb3ZlcyBhbiBleGlzdGluZyBTVUJUWVAuXG4gIGFwcGx5VHlwUHJvcGVydGllcyhmcm9udG1hdHRlciwgdHlwLCBzdWJ0eXApIHtcbiAgICBzZXRDYW5vbmljYWxQcm9wZXJ0eShmcm9udG1hdHRlciwgVFlQX1BST1BFUlRZLCB0eXApO1xuICAgIGlmIChzdWJ0eXApIHNldENhbm9uaWNhbFByb3BlcnR5KGZyb250bWF0dGVyLCBTVUJUWVBfUFJPUEVSVFksIHN1YnR5cCk7XG4gICAgZWxzZSBkZWxldGVQcm9wZXJ0eShmcm9udG1hdHRlciwgU1VCVFlQX1BST1BFUlRZKTtcbiAgfVxuXG4gIC8vIEZvciBUWVAuanMsIGluc2lkZSBwcm9jZXNzRnJvbnRNYXR0ZXIgYW5kIGFmdGVyIGFsbCBvdGhlciBjaGFuZ2VzOiBwdXRzIHRoZVxuICAvLyBmcm9udG1hdHRlciBpbnRvIHNvcnRpbmcgb3JkZXIsIG9yIG5ld2x5IGFkZGVkIHByb3BlcnRpZXMgKFNVQlRZUCBpbiBhblxuICAvLyBleGlzdGluZyBub3RlLCBzYXkpIHdvdWxkIGVuZCB1cCBsYXN0LlxuICBzb3J0RnJvbnRtYXR0ZXIoZnJvbnRtYXR0ZXIsIHR5cCwgc3VidHlwID0gbnVsbCkge1xuICAgIHJldHVybiBzb3J0RnJvbnRtYXR0ZXJGb3IodGhpcywgZnJvbnRtYXR0ZXIsIHR5cCwgc3VidHlwKTtcbiAgfVxuXG4gIC8vIEluc2lkZSBwcm9jZXNzRnJvbnRNYXR0ZXI6IG1vdmVzIG9ubHkgcHJvcGVydHkgYGtleWAgdG8gaXRzIHNvcnRlZCBwbGFjZVxuICAvLyAoVFlQL1NVQlRZUCByZWFkIGZyb20gdGhlIG9iamVjdCksIGV2ZXJ5dGhpbmcgZWxzZSBzdGF5cyAtIGZvciBGcmVkJ3NcbiAgLy8gcHJvcGVydHkgYmFja2xpbmtpbmcsIHNvIGEgbmV3IHByb3BlcnR5IGRvZXNuJ3QgZW5kIHVwIGxhc3QuXG4gIHBsYWNlUHJvcGVydHkoZnJvbnRtYXR0ZXIsIGtleSkge1xuICAgIHJldHVybiBwbGFjZVByb3BlcnR5Rm9yKHRoaXMsIGZyb250bWF0dGVyLCBrZXkpO1xuICB9XG5cbiAgLy8gRm9yIFRZUC5qczogdGhlIHJlZ2lzdGVyZWQgVFlQIGVudHJpZXMgd2l0aCB0aGVpciBkZXNjcmlwdGlvbnMsIGluIHRoZVxuICAvLyBvcmRlciBvZiB0aGUgVFlQLUxpc3QgKGl0cyBjdXJyZW50IHNvcnQgc2V0dGluZykuIFRZUCBlbnRyaWVzIHRoYXQgYXJlbid0XG4gIC8vIG1hbnVhbGx5IGNyZWF0YWJsZSBhcmUgbGVmdCBvdXQgdW5sZXNzIGluY2x1ZGVNYW51YWxPZmYgaXMgdHJ1ZS5cbiAgZ2V0VHlwcyh7IGluY2x1ZGVNYW51YWxPZmYgPSBmYWxzZSB9ID0ge30pIHtcbiAgICBjb25zdCB7IGNvdW50cyB9ID0gdGhpcy50eXBJbmRleC50eXBDb3VudHMoKTtcbiAgICBjb25zdCBzb3J0T3JkZXIgPSB0aGlzLnNldHRpbmdzLnR5cFNvcnRPcmRlciA/PyBERUZBVUxUX1NPUlRfT1JERVI7XG4gICAgcmV0dXJuIHNvcnRUeXBzQnlNb2RlKHRoaXMuc2V0dGluZ3MudHlwcywgc29ydE9yZGVyLCBjb3VudHMsIHRoaXMuc2V0dGluZ3MudHlwQ29sb3JzKVxuICAgICAgLmZpbHRlcigodHlwKSA9PiBpbmNsdWRlTWFudWFsT2ZmIHx8ICh0aGlzLnNldHRpbmdzLnR5cE1hbnVhbCA/PyB7fSlbdHlwXSAhPT0gZmFsc2UpXG4gICAgICAubWFwKCh0eXApID0+ICh7XG4gICAgICAgIHR5cCxcbiAgICAgICAgZGVzY3JpcHRpb246IHRoaXMuc2V0dGluZ3MudHlwRGVzY3JpcHRpb25zW3R5cF0gPz8gXCJcIixcbiAgICAgICAgY291bnQ6IGNvdW50cy5nZXQodHlwKSA/PyAwLFxuICAgICAgfSkpO1xuICB9XG5cbiAgLy8gRm9yIFRZUC5qczogdGhlIG5hdGl2ZSBUWVAtUGlja2VyIChzZWUgdHlwLXBpY2tlci5qcykgd2l0aCBjb2xvcixcbiAgLy8gZGVzY3JpcHRpb24gYW5kIG5vdGUgY291bnQuIGluY2x1ZGVNYW51YWxPZmYgYXMgaW4gZ2V0VHlwcygpLiBSZXNvbHZlc1xuICAvLyB3aXRoIHRoZSBUWVAsIG9yIG51bGwgb24gRVNDLlxuICBwaWNrVHlwKG9wdGlvbnMpIHtcbiAgICByZXR1cm4gcGlja1R5cE1vZGFsKHRoaXMuYXBwLCB0aGlzLCBvcHRpb25zKTtcbiAgfVxuXG4gIC8vIEZvciBUWVAuanM6IFRZUCBhbmQgU3VidHlwIGluIG9uZSBnbyAoc2VlIHR5cC1waWNrZXIuanMpIC0gb25lIHBpY2tlciB3aXRoXG4gIC8vIGluZGVudGVkIFN1YnR5cHMgb3IgYm90aCBwaWNrZXJzIGluIHR1cm4sIHBlciBcIlNlcGFyYXRlIFN1YnR5cC1QaWNrZXJcIi5cbiAgLy8gUmVzb2x2ZXMgd2l0aCB7IHR5cCwgc3VidHlwIH0gKHN1YnR5cCBudWxsIGZvciBcIm5vIFN1YnR5cFwiKSwgb3IgbnVsbCBvblxuICAvLyBFU0MuXG4gIHBpY2tUeXBBbmRTdWJ0eXAob3B0aW9ucykge1xuICAgIHJldHVybiBwaWNrVHlwQW5kU3VidHlwTW9kYWwodGhpcy5hcHAsIHRoaXMsIG9wdGlvbnMpO1xuICB9XG5cbiAgYXN5bmMgbG9hZFNldHRpbmdzKCkge1xuICAgIHRoaXMuc2V0dGluZ3MgPSBPYmplY3QuYXNzaWduKHt9LCBERUZBVUxUX1NFVFRJTkdTLCBhd2FpdCB0aGlzLmxvYWREYXRhKCkpO1xuICAgIC8vIE9iamVjdC5hc3NpZ24gcmVwbGFjZXMgbmVzdGVkIG9iamVjdHMgd2hvbGU7IHZpZXdzIGFkZGVkIGxhdGVyIChlLmcuXG4gICAgLy8gY29sb3JWaWV3cy5saW5rcykgd291bGQgb3RoZXJ3aXNlIGJlIHNpbGVudGx5IG9mZiBpbiBvbGRlciBzZXR0aW5ncy5cbiAgICB0aGlzLnNldHRpbmdzLmNvbG9yVmlld3MgPSB7IC4uLkRFRkFVTFRfU0VUVElOR1MuY29sb3JWaWV3cywgLi4udGhpcy5zZXR0aW5ncy5jb2xvclZpZXdzIH07XG4gICAgdGhpcy5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyID0gbm9ybWFsaXplR2xvYmFsT3JkZXIodGhpcy5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyKTtcbiAgfVxuXG4gIC8vIHNldHRpbmdzUmV2aXNpb24gY291bnRzIGV2ZXJ5IGNoYW5nZSBvZiB0aGUgc2V0dGluZ3MgKGhlcmUgYW5kIGluXG4gIC8vIG9uRXh0ZXJuYWxTZXR0aW5nc0NoYW5nZSkuIFVuZG8gKHVuZG8uanMpIGNvbXBhcmVzIGl0IHRvIHRlbGwgd2hldGhlclxuICAvLyBhbnl0aGluZyBoYXBwZW5lZCBhZnRlciB0aGUgYWN0aW9uIGl0IHdvdWxkIHJldmVydC4gQnVtcGVkIHN5bmNocm9ub3VzbHksXG4gIC8vIGJlZm9yZSB0aGUgYXdhaXQsIHNvIGEgY2FsbGVyIHRoYXQgZG9lc24ndCBhd2FpdCBzdGlsbCBjb3VudHMgYXQgb25jZS5cbiAgYXN5bmMgc2F2ZVNldHRpbmdzKCkge1xuICAgIHRoaXMuc2V0dGluZ3NSZXZpc2lvbiA9ICh0aGlzLnNldHRpbmdzUmV2aXNpb24gPz8gMCkgKyAxO1xuICAgIGF3YWl0IHRoaXMuc2F2ZURhdGEodGhpcy5zZXR0aW5ncyk7XG4gIH1cblxuICAvLyBDYWxsZWQgd2hlbiBkYXRhLmpzb24gY2hhbmdlcyBmcm9tIG91dHNpZGUsIGluIHByYWN0aWNlIHRocm91Z2ggT2JzaWRpYW5cbiAgLy8gU3luYy4gV2l0aG91dCBpdCB0aGlzIGRldmljZSB3b3VsZCBrZWVwIGl0cyBvbGQgc2V0dGluZ3MgaW4gbWVtb3J5IGFuZFxuICAvLyBvdmVyd3JpdGUgdGhlIG5ldyBvbmVzIG9uIHRoZSBuZXh0IHNhdmUuIE9ic2lkaWFuIHJlYnVpbGRzIGFuIG9wZW5cbiAgLy8gc2V0dGluZ3MgdGFiIGl0c2VsZjsgY29sb3JzIGFuZCB0aGUgVFlQLVBhbmUgYXJlIHJlZnJlc2hlZCBoZXJlLlxuICBhc3luYyBvbkV4dGVybmFsU2V0dGluZ3NDaGFuZ2UoKSB7XG4gICAgLy8gSW52YWxpZGF0ZXMgYSBwZW5kaW5nIHVuZG86IGl0cyBzbmFwc2hvdCBwcmVkYXRlcyB0aGUgc3luY2VkIHNldHRpbmdzLlxuICAgIHRoaXMuc2V0dGluZ3NSZXZpc2lvbiA9ICh0aGlzLnNldHRpbmdzUmV2aXNpb24gPz8gMCkgKyAxO1xuICAgIGF3YWl0IHRoaXMubG9hZFNldHRpbmdzKCk7XG4gICAgdGhpcy5yZWZyZXNoVHlwQ29sb3JzKCk7XG4gIH1cbn07XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7QUFBQTtBQUFBLHFCQUFBQSxVQUFBQyxTQUFBO0FBQUEsUUFBTSxFQUFFLFFBQVEsT0FBTyxTQUFTLElBQUksUUFBUSxVQUFVO0FBRXRELFFBQU1DLGdCQUFlO0FBQ3JCLFFBQU1DLG1CQUFrQjtBQUN4QixRQUFNLGNBQWMsT0FBTyxPQUFPLEVBQUUsUUFBUSxNQUFNLFFBQVEsTUFBTSxXQUFXLE1BQU0sV0FBVyxLQUFLLENBQUM7QUFLbEcsUUFBTSxpQkFBaUI7QUFFdkIsYUFBUyxRQUFRLE9BQU87QUFDdEIsVUFBSSxTQUFTLEtBQU0sUUFBTztBQUMxQixhQUFPLE9BQU8sVUFBVSxXQUFXLEtBQUssVUFBVSxLQUFLLElBQUksT0FBTyxLQUFLO0FBQUEsSUFDekU7QUFTQSxhQUFTLFNBQVMsT0FBTztBQUN2QixVQUFJLE1BQU0sUUFBUSxLQUFLLEdBQUc7QUFDeEIsY0FBTSxRQUFRLE1BQU0sSUFBSSxPQUFPO0FBQy9CLFlBQUksTUFBTSxNQUFN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T1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJzZXRDYW5vbmljYWxQcm9wZXJ0eSIsICJkZWxldGVQcm9wZXJ0eSIsICJUeXBJbmRleCIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJzZXRDYW5vbmljYWxQcm9wZXJ0eSIsICJTVUJUWVBfUFJPUEVSVFkiLCAiZ2V0U3VidHlwTmFtZXMiLCAiZ2V0U3VidHlwIiwgImlzU3VidHlwTWFudWFsIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInNvcnRUeXBzQnlNb2RlIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImdldFN1YnR5cCIsICJUWVBfUFJPUEVSVFkiLCAiU1VCVFlQX1BST1BFUlRZIiwgIm5vcm1hbGl6ZUdsb2JhbE9yZGVyIiwgInNvcnRGcm9udG1hdHRlckZvciIsICJwbGFjZVByb3BlcnR5Rm9yIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgIlRZUF9QUk9QRVJUWSIsICJTVUJUWVBfUFJPUEVSVFkiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZ2V0U3VidHlwIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgIkRFRkFVTFRfU0VUVElOR1MiLCAiVHlwU3lzdGVtU2V0dGluZ1RhYiIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXBOYW1lcyIsICJub3JtYWxpemVHbG9iYWxPcmRlciIsICJUWVBfUFJPUEVSVFkiLCAiU1VCVFlQX1BST1BFUlRZIiwgImxlYWYiLCAiY3VycmVudCIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlckNvbW1hbmRzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInNjcmlwdE5hbWVPZiIsICJyZXNvbHZlQ2FsbEFyZ3MiLCAicmVzb2x2ZVNob3J0Y3V0cyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXAiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJyZW1vdmVQcm9wZXJ0eU1lbnVQYXRjaCIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXBOYW1lcyIsICJnZXRTdWJ0eXAiLCAiaXNTdWJ0eXBNYW51YWwiLCAic29ydFR5cHNCeU1vZGUiLCAic2V0Q2Fub25pY2FsUHJvcGVydHkiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJERUZBVUxUX1NPUlRfT1JERVIiLCAicmVnaXN0ZXJUeXBQYW5lIiwgImxlYWYiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJGaWxlRXhwbG9yZXJDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJHcmFwaENvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlclNlYXJjaENvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlclJlY2VudEZpbGVzQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyQmFja2xpbmtDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJCb29rbWFya3NDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZ2V0U3VidHlwIiwgInJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJMaW5rQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImdldFN1YnR5cE5hbWVzIiwgImdldFN1YnR5cCIsICJmbG9hdGluZyIsICJyZWdpc3RlckZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodCIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXBOYW1lcyIsICJUWVBfUFJPUEVSVFkiLCAiU1VCVFlQX1BST1BFUlRZIiwgInJlZ2lzdGVyUHJvcGVydHlSZW5hbWVTeW5jIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgIkRFRkFVTFRfU09SVF9PUkRFUiIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlclNob3J0Y3V0U2NyaXB0cyJdCn0K
