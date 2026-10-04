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
    function pickerInstructions(escPurpose = "to cancel") {
      return [
        { command: "\u2191\u2193", purpose: "to navigate" },
        { command: "\u21B5", purpose: "to choose" },
        { command: "esc", purpose: escPurpose }
      ];
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
    module2.exports = { normalizeTypName, plural, joinAnd, pickerInstructions, hexToHue, compareTyps, sortTypsByMode: sortTypsByMode2 };
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
        description: "Today's date (YYYY-MM-DD)",
        resolve: () => moment().format("YYYY-MM-DD")
      },
      {
        name: "now",
        description: "Current date and time (YYYY-MM-DD HH:mm)",
        resolve: () => moment().format("YYYY-MM-DD HH:mm")
      },
      {
        // The file's creation date (file.stat.ctime), not the call time; falls
        // back to now without a file.
        name: "created",
        description: "The file's creation date (YYYY-MM-DD)",
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
    var { FuzzySuggestModal, Modal, Setting, renderMatches } = require("obsidian");
    var { FIXED_SHORTCUTS, SCRIPT_PREFIX, buildArgs, inputParams } = require_shortcuts();
    var { pickerInstructions } = require_typ_utils();
    function itemLabel(item) {
      return item.params ? `${item.name}(${item.params.join(", ")})` : item.name;
    }
    var ShortcutPickerModal = class extends FuzzySuggestModal {
      constructor(app, key, items, resolve) {
        super(app);
        this.items = items;
        this.resolve = resolve;
        this.chosen = false;
        this.setPlaceholder(`Choose shortcut for "${key}"\u2026`);
        this.setInstructions(pickerInstructions());
      }
      getItems() {
        return this.items;
      }
      // Fuzzy search also covers the description: "creation" finds "created".
      getItemText(item) {
        const label = itemLabel(item);
        return item.description ? `${label} ${item.description}` : label;
      }
      // Matched characters marked like in Obsidian's own suggesters. The ranges
      // refer to the whole search text (getItemText), so the description's are
      // shifted back by the label and the space before it.
      renderSuggestion(match, el) {
        const item = match.item;
        const label = itemLabel(item);
        const matches = match.match?.matches?.length ? match.match.matches : null;
        el.addClass("typ-shortcut-suggestion");
        renderMatches(el.createEl("code", { cls: "typ-shortcut-suggestion-name" }), label, matches, 0);
        if (item.description) {
          renderMatches(el.createSpan({ cls: "typ-shortcut-suggestion-desc" }), item.description, matches, -(label.length + 1));
        }
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
        this.titleEl.setText(`Arguments for ${this.item.name}`);
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
          (button) => button.setButtonText("Apply").setCta().onClick(() => this.submit())
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
    var { shortcutLabel, scriptNameOf: scriptNameOf2 } = require_shortcuts();
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
          text: "Open a note once to initialize the editor."
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
    var MISSING_CLASS = "typ-shortcut-missing";
    var BUTTON_STATES = {
      none: { icon: "square-function", label: "Set shortcut" },
      set: { icon: "x", label: "Remove shortcut" },
      missing: { icon: "alert-triangle", label: "Script not found \u2013 the fallback value will be used. Click to remove the shortcut." }
    };
    function renderShortcutControls(view, editor, store) {
      const shortcuts = store.getShortcuts();
      const getScripts = view.plugin.getShortcutScripts;
      const scriptNames = getScripts?.isLoaded?.() ? new Set(getScripts().map((script) => script.name)) : null;
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
          buttonEl.addEventListener("click", () => {
            if (store.getShortcuts()[row.entry?.key ?? ""]) removeShortcut(view, editor, store, row);
            else openShortcutPicker(view, editor, store, row);
          });
        }
        const scriptName = record ? scriptNameOf2(record.name) : null;
        const missing = scriptName !== null && scriptNames !== null && !scriptNames.has(scriptName);
        const state = !record ? "none" : missing ? "missing" : "set";
        if (buttonEl.dataset.typState !== state) {
          buttonEl.dataset.typState = state;
          setIcon(buttonEl, BUTTON_STATES[state].icon);
          buttonEl.setAttr("aria-label", BUTTON_STATES[state].label);
          buttonEl.toggleClass(MISSING_CLASS, state === "missing");
        }
        let chipEl = containerEl.querySelector(`:scope > .${CHIP_CLASS}`);
        if (!record) {
          chipEl?.remove();
          continue;
        }
        if (!chipEl) {
          chipEl = createEl("code", { cls: CHIP_CLASS });
          chipEl.createSpan({ cls: CHIP_TEXT_CLASS });
          chipEl.setAttr("aria-label", "Change shortcut");
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
    module2.exports = {
      mountFrontmatterEditor,
      addBlankProperty,
      renderShortcutControls,
      ensurePropertyMenuPatch,
      removePropertyMenuPatch: removePropertyMenuPatch2,
      typStore,
      subtypStore
    };
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
    var { renderShortcutControls } = require_typ_frontmatter_editor();
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
      // The list of Templater scripts changed (see registerTypPane): only the
      // shortcut buttons of the open editors follow - their "script not found"
      // warning depends on it. No render(): nothing else changed, and a rebuild
      // would cost the focus of a field being typed in.
      refreshShortcutControls() {
        for (const editor of this.frontmatterEditors ?? []) {
          const store = editor.owner?.typStore;
          if (store) renderShortcutControls(this, editor, store);
        }
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
      const offScripts = plugin.getShortcutScripts?.onChange?.(() => {
        for (const leaf of plugin.app.workspace.getLeavesOfType(VIEW_TYPE_TYP_PANE)) leaf.view?.refreshShortcutControls?.();
      });
      if (offScripts) plugin.register(offScripts);
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
    var { FuzzySuggestModal, Notice, prepareFuzzySearch, renderMatches } = require("obsidian");
    var { compareTyps, DEFAULT_SORT_ORDER: DEFAULT_SORT_ORDER2 } = require_typ_pane();
    var { nameColor, paintColorDot } = require_typ_colors();
    var { pickerInstructions } = require_typ_utils();
    function textParts(item) {
      const parts = [];
      let start = 0;
      const add = (key, text) => {
        if (!text) return;
        parts.push({ key, text, start });
        start += text.length + 1;
      };
      add("typ", item.typ);
      add("subtyps", item.subtyps?.join(" "));
      add("description", item.description);
      return parts;
    }
    function highlight(el, text, matches, start = 0) {
      renderMatches(el, text, matches?.length ? matches : null, -start);
    }
    var TypPickerModal = class extends FuzzySuggestModal {
      constructor(app, plugin, items, resolve) {
        super(app);
        this.plugin = plugin;
        this.items = items;
        this.resolve = resolve;
        this.chosen = false;
        this.setPlaceholder("Choose TYP\u2026");
        this.setInstructions(pickerInstructions());
      }
      getItems() {
        return this.items;
      }
      // Search also covers the description and, where shown in the row
      // (showSubtyps), the Subtyp names: what you see you expect to be able to type.
      getItemText(item) {
        return textParts(item).map((part) => part.text).join(" ");
      }
      renderSuggestion(match, el) {
        const item = match.item;
        const matches = match.match?.matches ?? [];
        const parts = Object.fromEntries(textParts(item).map((part) => [part.key, part]));
        el.addClass("typ-picker-suggestion");
        if (item.unregistered) el.addClass("typ-picker-unregistered");
        if (item.unregistered) {
          highlight(el.createSpan({ cls: "typ-picker-name" }), item.typ, matches);
        } else {
          this.renderColoredName(el, item.typ, item.typ, null, matches);
        }
        if (item.subtyps?.length) this.renderSubtypPreview(el, item, matches, parts.subtyps.start);
        if (item.description) {
          highlight(el.createSpan({ cls: "typ-picker-desc" }), item.description, matches, parts.description.start);
        }
        el.createSpan({ cls: "typ-picker-count", text: String(item.count) });
      }
      // Name in the color of colorTyp (or of the Subtyp, see nameColor in
      // typ-colors.js) - as colored text or with a dot before it, depending on
      // the "TYP-Pane" coloring setting. matches/start as in highlight().
      renderColoredName(el, text, colorTyp, subtyp = null, matches = [], start = 0) {
        const { color, isDefault } = nameColor(this.plugin.settings, colorTyp, subtyp);
        const colorize = this.plugin.settings.colorViews.typList;
        if (!colorize) paintColorDot(el.createSpan({ cls: "typ-picker-dot" }), color, isDefault);
        const nameEl = el.createSpan({ cls: "typ-picker-name" });
        if (colorize) nameEl.style.color = color;
        highlight(nameEl, text, matches, start);
      }
      // "TYP (Subtyp 1, Subtyp 2)" - shows what lies below the TYP before the
      // separate Subtyp-Picker comes. Each Subtyp in its own color, brackets and
      // commas muted; uncolored like the name when "TYP-Pane" coloring is off.
      // start is where the Subtyp names begin in the search text; there they are
      // separated by one space instead of ", ", so each name starts one character
      // after the end of the one before.
      renderSubtypPreview(el, item, matches = [], start = 0) {
        const colorize = this.plugin.settings.colorViews.typList;
        const wrap = el.createSpan({ cls: "typ-picker-subtyps" });
        wrap.appendText("(");
        let position = start;
        item.subtyps.forEach((subtyp, index) => {
          if (index > 0) wrap.appendText(", ");
          const span = wrap.createSpan();
          highlight(span, subtyp, matches, position);
          position += subtyp.length + 1;
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
        this.setPlaceholder(`Choose Subtyp for ${typ}\u2026`);
        this.setInstructions(pickerInstructions("to go back"));
        this.items = sortByQuery(items, query, (item) => this.getItemText(item));
      }
      // The "no Subtyp" row is also found by the TYP name it shows, so "ORGA"
      // typed in the TYP-Picker brings it back to the top.
      getItemText(item) {
        return item.none ? `${this.typ} ${item.typ}` : super.getItemText(item);
      }
      renderSuggestion(match, el) {
        const item = match.item;
        const matches = match.match?.matches ?? [];
        el.addClass("typ-picker-suggestion");
        if (item.none) {
          this.renderColoredName(el, this.typ, this.typ, null, matches);
          const noneEl = el.createSpan({ cls: "typ-picker-none" });
          noneEl.appendText("(");
          highlight(noneEl, item.typ, matches, this.typ.length + 1);
          noneEl.appendText(")");
        } else {
          this.renderColoredName(el, item.typ, this.typ, item.typ, matches);
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
        this.setPlaceholder("Choose TYP or Subtyp\u2026");
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
        this.renderColoredName(el, item.subtyp, item.typ, item.subtyp, match.match?.matches ?? []);
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
      let loaded = false;
      const listeners = /* @__PURE__ */ new Set();
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
        found.sort((a, b) => a.name.localeCompare(b.name));
        const changed = !loaded || JSON.stringify(found) !== JSON.stringify(scripts);
        scripts = found;
        loaded = true;
        if (!changed) return;
        for (const listener of listeners) {
          try {
            listener();
          } catch (error) {
            console.error("TYP-System: shortcut script listener failed", error);
          }
        }
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
      const accessor = () => {
        if (currentScriptFolder() !== scriptFolder) scheduleRefresh();
        return scripts;
      };
      accessor.isLoaded = () => loaded;
      accessor.onChange = (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      };
      return accessor;
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL3R5cC1pbmRleC5qcyIsICJzcmMvc3VidHlwcy5qcyIsICJzcmMvdHlwLXV0aWxzLmpzIiwgInNyYy9mcm9udG1hdHRlci1zb3J0LmpzIiwgInNyYy9mcm9udG1hdHRlci1vcmRlci1lZGl0b3IuanMiLCAic3JjL3R5cC1jb2xvcnMuanMiLCAic3JjL3NldHRpbmdzLmpzIiwgInNyYy9iYXNlLWRpYWxvZ3MuanMiLCAic3JjL2Jhc2VzLmpzIiwgInNyYy9jb21tYW5kcy5qcyIsICJzcmMvY29uZmlybS1tb2RhbC5qcyIsICJzcmMvdW5kby5qcyIsICJzcmMvc2hvcnRjdXRzLmpzIiwgInNyYy9zaG9ydGN1dC1waWNrZXIuanMiLCAic3JjL3R5cC1mcm9udG1hdHRlci1lZGl0b3IuanMiLCAic3JjL2Zyb250bWF0dGVyLWJsb2Nrcy5qcyIsICJzcmMvdHlwLXNldHRpbmdzLmpzIiwgInNyYy90eXAtcGFuZS5qcyIsICJzcmMvZmlsZS1leHBsb3Jlci1jb2xvcnMuanMiLCAic3JjL2dyYXBoLWNvbG9ycy5qcyIsICJzcmMvc2VhcmNoLWNvbG9ycy5qcyIsICJzcmMvcmVjZW50LWZpbGVzLWNvbG9ycy5qcyIsICJzcmMvYmFja2xpbmstY29sb3JzLmpzIiwgInNyYy9ib29rbWFyay1jb2xvcnMuanMiLCAic3JjL2FjdGl2ZS10aXRsZS1jb2xvcnMuanMiLCAic3JjL2xpbmstY29sb3JzLmpzIiwgInNyYy9mcm9udG1hdHRlci1kZWZhdWx0LWhpZ2hsaWdodC5qcyIsICJzcmMvcHJvcGVydHktcmVuYW1lLXN5bmMuanMiLCAic3JjL3R5cC1waWNrZXIuanMiLCAic3JjL3Nob3J0Y3V0LXNjcmlwdHMuanMiLCAic3JjL21haW4uanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IHsgRXZlbnRzLCBURmlsZSwgZGVib3VuY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcblxuY29uc3QgVFlQX1BST1BFUlRZID0gXCJUWVBcIjtcbmNvbnN0IFNVQlRZUF9QUk9QRVJUWSA9IFwiU1VCVFlQXCI7XG5jb25zdCBFTVBUWV9FTlRSWSA9IE9iamVjdC5mcmVlemUoeyB0eXBLZXk6IG51bGwsIHJhd1R5cDogbnVsbCwgc3VidHlwS2V5OiBudWxsLCByYXdTdWJ0eXA6IG51bGwgfSk7XG5cbi8vIENvbGxlY3RzIGNoYW5nZXMgdG8gbWFueSBmaWxlcyAocmVuYW1pbmcgYSBUWVAgaW4gbWFueSBub3Rlcywgc3luYykgaW50byBvbmVcbi8vIFwiY2hhbmdlXCIgZXZlbnQuIE5vIHJlc2V0VGltZXIsIHNvIGEgY29uc3RhbnQgc3RyZWFtIHN0aWxsIGdldHMgdGhyb3VnaFxuLy8gcmVndWxhcmx5LlxuY29uc3QgRkxVU0hfREVMQVlfTVMgPSAxMDA7XG5cbmZ1bmN0aW9uIHJhd0l0ZW0odmFsdWUpIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBcIlwiO1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiID8gSlNPTi5zdHJpbmdpZnkodmFsdWUpIDogU3RyaW5nKHZhbHVlKTtcbn1cblxuLy8gSG93IHRoZSB3aG9sZSBwbHVnaW4gcmVhZHMgYSBUWVAgdmFsdWU6IGRlbGliZXJhdGVseSBOT1Qgbm9ybWFsaXplZCAtIHRoZVxuLy8gcmF3IGZvcm0gaXMgdGhlIGtleS4gQSBUWVAgaXMgZXhhY3RseSBvbmUgY2xlYW4gdmFsdWU7IGFueXRoaW5nIGVsc2UgKHBhZGRlZCxcbi8vIGxvd2VyY2FzZSwgYSBsaXN0IC0gZXZlbiB3aXRoIG9uZSBpdGVtKSBiZWNvbWVzIGl0cyBvd24ga2V5IHRoYXQgbWF0Y2hlcyBub1xuLy8gcmVnaXN0ZXJlZCBUWVA6IG5vIGNvbG9yLCBub3QgY291bnRlZCBmb3IgdGhlIFwicmVhbFwiIFRZUCwgYW5kIGxpc3RlZCBpbiB0aGVcbi8vIFRZUC1QYW5lIGFzIGFuIHVucmVnaXN0ZXJlZCBlbnRyeSB0aGF0IGEgY2xpY2sgY2xlYW5zIHVwIChzZWUgcmVnaXN0ZXJUeXAgaW5cbi8vIHR5cC1wYW5lLmpzKS4gTGlzdHMgc2hvdyBhcyBcIltBLCBCXVwiIGFuZCBuZXZlciBjb2luY2lkZSB3aXRoIGEgdmFsdWUgXCJBLCBCXCIuXG4vLyBudWxsID0gbm8gVFlQIChtaXNzaW5nLCBlbXB0eSwgYmxhbmssIGVtcHR5IGxpc3QpLlxuZnVuY3Rpb24gdHlwS2V5T2YodmFsdWUpIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgY29uc3QgaXRlbXMgPSB2YWx1ZS5tYXAocmF3SXRlbSk7XG4gICAgaWYgKGl0ZW1zLmV2ZXJ5KChpdGVtKSA9PiBpdGVtLnRyaW0oKSA9PT0gXCJcIikpIHJldHVybiBudWxsO1xuICAgIHJldHVybiBgWyR7aXRlbXMuam9pbihcIiwgXCIpfV1gO1xuICB9XG4gIGNvbnN0IHRleHQgPSByYXdJdGVtKHZhbHVlKTtcbiAgcmV0dXJuIHRleHQudHJpbSgpID09PSBcIlwiID8gbnVsbCA6IHRleHQ7XG59XG5cbi8vIE9ic2lkaWFuIHRyZWF0cyBwcm9wZXJ0eSBuYW1lcyBjYXNlLWluc2Vuc2l0aXZlbHkgKFwiU3VidHlwXCIgYW5kIFwiU1VCVFlQXCJcbi8vIGFyZSBvbmUgcHJvcGVydHkgaW4gXCJBbGwgcHJvcGVydGllc1wiKSwgc28gVFlQIGFuZCBTVUJUWVAgYXJlIHJlYWQgdGhlIHNhbWVcbi8vIHdheS4gVGhlIGV4YWN0IHNwZWxsaW5nIHdpbnMgaWYgYSBub3RlICh3cm9uZ2x5KSBoYXMgc2V2ZXJhbC5cbmZ1bmN0aW9uIHByb3BlcnR5S2V5T2YoZnJvbnRtYXR0ZXIsIG5hbWUpIHtcbiAgaWYgKCFmcm9udG1hdHRlcikgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChmcm9udG1hdHRlciwgbmFtZSkpIHJldHVybiBuYW1lO1xuICBjb25zdCBsb3dlciA9IG5hbWUudG9Mb3dlckNhc2UoKTtcbiAgcmV0dXJuIE9iamVjdC5rZXlzKGZyb250bWF0dGVyKS5maW5kKChrZXkpID0+IGtleS50b0xvd2VyQ2FzZSgpID09PSBsb3dlcik7XG59XG5cbmZ1bmN0aW9uIHByb3BlcnR5VmFsdWUoZnJvbnRtYXR0ZXIsIG5hbWUpIHtcbiAgY29uc3Qga2V5ID0gcHJvcGVydHlLZXlPZihmcm9udG1hdHRlciwgbmFtZSk7XG4gIHJldHVybiBrZXkgPT09IHVuZGVmaW5lZCA/IHVuZGVmaW5lZCA6IGZyb250bWF0dGVyW2tleV07XG59XG5cbi8vIFdyaXRlcyB2YWx1ZSB1bmRlciB0aGUgY2Fub25pY2FsIHNwZWxsaW5nIGBuYW1lYCAoZS5nLiBcIlNVQlRZUFwiKSBpbnRvIHRoZVxuLy8gcHJvY2Vzc0Zyb250TWF0dGVyIG9iamVjdC4gQSBkaWZmZXJlbnRseSBzcGVsbGVkIHZhcmlhbnQgKFwiU3VidHlwXCIpIGlzXG4vLyByZW5hbWVkIGluIHBsYWNlIC0gaW5zZXJ0aW9uIG9yZGVyIGlzIFlBTUwgb3JkZXIsIHNvIGFsbCBrZXlzIGFyZSByZS1hZGRlZFxuLy8gaW4gdGhlaXIgb3JkZXIgaWYgbmVlZGVkIChhcyBpbiBmcm9udG1hdHRlci1zb3J0LmpzKS5cbmZ1bmN0aW9uIHNldENhbm9uaWNhbFByb3BlcnR5KGZyb250bWF0dGVyLCBuYW1lLCB2YWx1ZSkge1xuICBjb25zdCBsb3dlciA9IG5hbWUudG9Mb3dlckNhc2UoKTtcbiAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKGZyb250bWF0dGVyKTtcbiAgaWYgKCFrZXlzLnNvbWUoKGtleSkgPT4ga2V5ICE9PSBuYW1lICYmIGtleS50b0xvd2VyQ2FzZSgpID09PSBsb3dlcikpIHtcbiAgICBmcm9udG1hdHRlcltuYW1lXSA9IHZhbHVlO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBzbmFwc2hvdCA9IHsgLi4uZnJvbnRtYXR0ZXIgfTtcbiAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykgZGVsZXRlIGZyb250bWF0dGVyW2tleV07XG4gIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICBpZiAoa2V5LnRvTG93ZXJDYXNlKCkgIT09IGxvd2VyKSBmcm9udG1hdHRlcltrZXldID0gc25hcHNob3Rba2V5XTtcbiAgICBlbHNlIGlmICghKG5hbWUgaW4gZnJvbnRtYXR0ZXIpKSBmcm9udG1hdHRlcltuYW1lXSA9IHZhbHVlO1xuICB9XG59XG5cbi8vIFJlbW92ZXMgYG5hbWVgIGluIGFueSBzcGVsbGluZyBmcm9tIHRoZSBwcm9jZXNzRnJvbnRNYXR0ZXIgb2JqZWN0LlxuZnVuY3Rpb24gZGVsZXRlUHJvcGVydHkoZnJvbnRtYXR0ZXIsIG5hbWUpIHtcbiAgY29uc3QgbG93ZXIgPSBuYW1lLnRvTG93ZXJDYXNlKCk7XG4gIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGZyb250bWF0dGVyKSkge1xuICAgIGlmIChrZXkudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXIpIGRlbGV0ZSBmcm9udG1hdHRlcltrZXldO1xuICB9XG59XG5cbi8vIFNVQlRZUCBpcyByZWFkIHRoZSBzYW1lIHdheSAodHlwS2V5T2YpOiBhdCBtb3N0IG9uZSBjbGVhbiB2YWx1ZSBwZXIgbm90ZSxcbi8vIGFueXRoaW5nIGVsc2UgaXMgaXRzIG93biB1bnJlZ2lzdGVyZWQga2V5LlxuZnVuY3Rpb24gc2FtZUVudHJ5KGEsIGIpIHtcbiAgcmV0dXJuICEhYSAmJiAhIWIgJiYgYS50eXBLZXkgPT09IGIudHlwS2V5ICYmIGEuc3VidHlwS2V5ID09PSBiLnN1YnR5cEtleTtcbn1cblxuLy8gQ2VudHJhbCBUWVAvU1VCVFlQIGluZGV4IG92ZXIgYWxsIG1hcmtkb3duIGZpbGVzIChwYXRoIC0+IHZhbHVlcykuXG4vL1xuLy8gbWV0YWRhdGFDYWNoZSBcImNoYW5nZWRcIi9cInJlc29sdmVkXCIgZmlyZSBvbiBFVkVSWSBlZGl0IHRvIGFueSBub3RlIChhYm91dFxuLy8gZXZlcnkgdHdvIHNlY29uZHMgd2hpbGUgdHlwaW5nKS4gVGhlIGluZGV4IGNvbXBhcmVzIHBlciBmaWxlIHdoZXRoZXIgVFlQIG9yXG4vLyBTVUJUWVAgcmVhbGx5IGNoYW5nZWQgKG9yIGEgbm90ZSBhcHBlYXJlZC9kaXNhcHBlYXJlZCkgYW5kIG9ubHkgdGhlbiBmaXJlc1xuLy8gaXRzIG93biBcImNoYW5nZVwiIGV2ZW50IChhcmd1bWVudDogc2V0IG9mIGFmZmVjdGVkIHBhdGhzKS4gQWxsIGNvbG9yaW5nIGhhbmdzXG4vLyBvbiB0aGlzIGV2ZW50LCBzbyBub3JtYWwgdHlwaW5nIHRyaWdnZXJzIG5vIHJlY29sb3JpbmcuXG4vL1xuLy8gSXQgYWxzbyBjYWNoZXMgdGhlIHZhdWx0LXdpZGUgY291bnRzIChUWVAtTGlzdCwgU3VidHlwIGxpc3QsIHBpY2tlcnMsXG4vLyBnZXRUeXBzKCkpIGluc3RlYWQgb2YgcmVzY2FubmluZyBldmVyeSBub3RlIG9uIGVhY2ggY2FsbC5cbmNsYXNzIFR5cEluZGV4IGV4dGVuZHMgRXZlbnRzIHtcbiAgY29uc3RydWN0b3IocGx1Z2luKSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgICB0aGlzLmFwcCA9IHBsdWdpbi5hcHA7XG4gICAgdGhpcy5lbnRyaWVzID0gbmV3IE1hcCgpO1xuICAgIHRoaXMuYnVpbHQgPSBmYWxzZTtcbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsO1xuICAgIHRoaXMucGVuZGluZ1BhdGhzID0gbmV3IFNldCgpO1xuICAgIHRoaXMuZmx1c2ggPSBkZWJvdW5jZSgoKSA9PiB7XG4gICAgICBjb25zdCBwYXRocyA9IHRoaXMucGVuZGluZ1BhdGhzO1xuICAgICAgdGhpcy5wZW5kaW5nUGF0aHMgPSBuZXcgU2V0KCk7XG4gICAgICB0aGlzLnRyaWdnZXIoXCJjaGFuZ2VcIiwgcGF0aHMpO1xuICAgIH0sIEZMVVNIX0RFTEFZX01TKTtcbiAgfVxuXG4gIHJlZ2lzdGVyKCkge1xuICAgIGNvbnN0IHsgcGx1Z2luLCBhcHAgfSA9IHRoaXM7XG4gICAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoYXBwLm1ldGFkYXRhQ2FjaGUub24oXCJjaGFuZ2VkXCIsIChmaWxlKSA9PiB0aGlzLnVwZGF0ZShmaWxlKSkpO1xuICAgIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC5tZXRhZGF0YUNhY2hlLm9uKFwiZGVsZXRlZFwiLCAoZmlsZSkgPT4gdGhpcy5yZW1vdmUoZmlsZS5wYXRoKSkpO1xuICAgIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC52YXVsdC5vbihcInJlbmFtZVwiLCAoZmlsZSwgb2xkUGF0aCkgPT4gdGhpcy5yZW5hbWUoZmlsZSwgb2xkUGF0aCkpKTtcbiAgICAvLyBcIkV4Y2x1ZGVkIGZpbGVzXCIgY2hhbmdlZDogdGhlIGVudHJpZXMgc3RheSB2YWxpZCwgb25seSB0aGUgZmlsdGVyZWRcbiAgICAvLyBjb3VudHMgZG9uJ3QuXG4gICAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoYXBwLnZhdWx0Lm9uKFwiY29uZmlnLWNoYW5nZWRcIiwgKCkgPT4gKHRoaXMuYWdncmVnYXRlcyA9IG51bGwpKSk7XG5cbiAgICAvLyBBdCBzdGFydHVwIHRoZSBmaXJzdCAobGF6eSkgYWNjZXNzIGNhbiBjb21lIGJlZm9yZSB0aGUgbWV0YWRhdGEgY2FjaGUgaXNcbiAgICAvLyBmdWxseSBsb2FkZWQuIFJlYnVpbGQgb25jZSBhZnRlciBpdHMgZmlyc3QgY29tcGxldGUgcmVzb2x2ZTsgZGlmZmVyZW5jZXNcbiAgICAvLyBnbyBvdXQgdGhyb3VnaCB0aGUgXCJjaGFuZ2VcIiBldmVudCBsaWtlIGFueSBvdGhlciBjaGFuZ2UuXG4gICAgY29uc3QgcmVzb2x2ZWRSZWYgPSBhcHAubWV0YWRhdGFDYWNoZS5vbihcInJlc29sdmVkXCIsICgpID0+IHtcbiAgICAgIGFwcC5tZXRhZGF0YUNhY2hlLm9mZnJlZihyZXNvbHZlZFJlZik7XG4gICAgICB0aGlzLnJlYnVpbGQoKTtcbiAgICB9KTtcbiAgICBwbHVnaW4ucmVnaXN0ZXJFdmVudChyZXNvbHZlZFJlZik7XG5cbiAgICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4gdGhpcy5mbHVzaC5jYW5jZWwoKSk7XG4gIH1cblxuICByZWFkKGZpbGUpIHtcbiAgICBjb25zdCBmcm9udG1hdHRlciA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlcjtcbiAgICBjb25zdCByYXdUeXAgPSBwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBUWVBfUFJPUEVSVFkpID8/IG51bGw7XG4gICAgY29uc3QgcmF3U3VidHlwID0gcHJvcGVydHlWYWx1ZShmcm9udG1hdHRlciwgU1VCVFlQX1BST1BFUlRZKSA/PyBudWxsO1xuICAgIHJldHVybiB7IHR5cEtleTogdHlwS2V5T2YocmF3VHlwKSwgcmF3VHlwLCBzdWJ0eXBLZXk6IHR5cEtleU9mKHJhd1N1YnR5cCksIHJhd1N1YnR5cCB9O1xuICB9XG5cbiAgZW5zdXJlQnVpbHQoKSB7XG4gICAgaWYgKCF0aGlzLmJ1aWx0KSB0aGlzLnJlYnVpbGQoKTtcbiAgfVxuXG4gIHJlYnVpbGQoKSB7XG4gICAgY29uc3QgcHJldmlvdXMgPSB0aGlzLmVudHJpZXM7XG4gICAgY29uc3Qgd2FzQnVpbHQgPSB0aGlzLmJ1aWx0O1xuICAgIHRoaXMuZW50cmllcyA9IG5ldyBNYXAoKTtcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpKSB0aGlzLmVudHJpZXMuc2V0KGZpbGUucGF0aCwgdGhpcy5yZWFkKGZpbGUpKTtcbiAgICB0aGlzLmJ1aWx0ID0gdHJ1ZTtcbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsO1xuICAgIGlmICghd2FzQnVpbHQpIHJldHVybjtcblxuICAgIGZvciAoY29uc3QgW3BhdGgsIGVudHJ5XSBvZiB0aGlzLmVudHJpZXMpIHtcbiAgICAgIGlmICghc2FtZUVudHJ5KHByZXZpb3VzLmdldChwYXRoKSwgZW50cnkpKSB0aGlzLnBlbmRpbmdQYXRocy5hZGQocGF0aCk7XG4gICAgfVxuICAgIGZvciAoY29uc3QgcGF0aCBvZiBwcmV2aW91cy5rZXlzKCkpIHtcbiAgICAgIGlmICghdGhpcy5lbnRyaWVzLmhhcyhwYXRoKSkgdGhpcy5wZW5kaW5nUGF0aHMuYWRkKHBhdGgpO1xuICAgIH1cbiAgICBpZiAodGhpcy5wZW5kaW5nUGF0aHMuc2l6ZSA+IDApIHRoaXMuZmx1c2goKTtcbiAgfVxuXG4gIG1hcmtDaGFuZ2VkKHBhdGgpIHtcbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsO1xuICAgIHRoaXMucGVuZGluZ1BhdGhzLmFkZChwYXRoKTtcbiAgICB0aGlzLmZsdXNoKCk7XG4gIH1cblxuICB1cGRhdGUoZmlsZSkge1xuICAgIC8vIEJlZm9yZSB0aGUgZmlyc3QgYWNjZXNzIHRoZXJlIGlzIG5vdGhpbmcgc3RhbGU7IHRoZSBsYXp5IGJ1aWxkIHJlYWRzXG4gICAgLy8gZnJlc2ggZnJvbSB0aGUgY2FjaGUgYW55d2F5LlxuICAgIGlmICghdGhpcy5idWlsdCB8fCAhKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkgfHwgZmlsZS5leHRlbnNpb24gIT09IFwibWRcIikgcmV0dXJuO1xuICAgIGNvbnN0IG5leHQgPSB0aGlzLnJlYWQoZmlsZSk7XG4gICAgaWYgKHNhbWVFbnRyeSh0aGlzLmVudHJpZXMuZ2V0KGZpbGUucGF0aCksIG5leHQpKSByZXR1cm47XG4gICAgdGhpcy5lbnRyaWVzLnNldChmaWxlLnBhdGgsIG5leHQpO1xuICAgIHRoaXMubWFya0NoYW5nZWQoZmlsZS5wYXRoKTtcbiAgfVxuXG4gIHJlbW92ZShwYXRoKSB7XG4gICAgaWYgKCF0aGlzLmJ1aWx0IHx8ICF0aGlzLmVudHJpZXMuZGVsZXRlKHBhdGgpKSByZXR1cm47XG4gICAgdGhpcy5tYXJrQ2hhbmdlZChwYXRoKTtcbiAgfVxuXG4gIHJlbmFtZShmaWxlLCBvbGRQYXRoKSB7XG4gICAgaWYgKCF0aGlzLmJ1aWx0KSByZXR1cm47XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLmVudHJpZXMuZ2V0KG9sZFBhdGgpO1xuICAgIGlmIChlbnRyeSkge1xuICAgICAgdGhpcy5lbnRyaWVzLmRlbGV0ZShvbGRQYXRoKTtcbiAgICAgIHRoaXMubWFya0NoYW5nZWQob2xkUGF0aCk7XG4gICAgfVxuICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZpbGUgJiYgZmlsZS5leHRlbnNpb24gPT09IFwibWRcIikge1xuICAgICAgdGhpcy5lbnRyaWVzLnNldChmaWxlLnBhdGgsIGVudHJ5ID8/IHRoaXMucmVhZChmaWxlKSk7XG4gICAgICB0aGlzLm1hcmtDaGFuZ2VkKGZpbGUucGF0aCk7XG4gICAgfVxuICB9XG5cbiAgZW50cnlGb3IoZmlsZSkge1xuICAgIGlmICghZmlsZSkgcmV0dXJuIEVNUFRZX0VOVFJZO1xuICAgIHRoaXMuZW5zdXJlQnVpbHQoKTtcbiAgICByZXR1cm4gdGhpcy5lbnRyaWVzLmdldChmaWxlLnBhdGgpID8/IEVNUFRZX0VOVFJZO1xuICB9XG5cbiAgLy8gVFlQIGtleSAoc2VlIHR5cEtleU9mKSBvciBudWxsOyBmb3IgYSBjbGVhbiB2YWx1ZSBzaW1wbHkgdGhlIFRZUCBuYW1lLlxuICB0eXBPZihmaWxlKSB7XG4gICAgcmV0dXJuIHRoaXMuZW50cnlGb3IoZmlsZSkudHlwS2V5O1xuICB9XG5cbiAgLy8gU1VCVFlQIGtleSAoc2VlIHR5cEtleU9mKSBvciBudWxsLlxuICBzdWJ0eXBPZihmaWxlKSB7XG4gICAgcmV0dXJuIHRoaXMuZW50cnlGb3IoZmlsZSkuc3VidHlwS2V5O1xuICB9XG5cbiAgLy8gQW4gYWN0dWFsIGZyb250bWF0dGVyIHZhbHVlIGZvciBhIGtleSAtIGZvciBkaXNwbGF5LCBzZWFyY2ggYW5kIGNsZWFuaW5nXG4gIC8vIHVwIHVucmVnaXN0ZXJlZCBlbnRyaWVzIChhbGwgbm90ZXMgb2YgYSBrZXkgc2hhcmUgdGhlIHNhbWUgcmF3IGZvcm0pLlxuICByYXdWYWx1ZU9mKHR5cEtleSkge1xuICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZSgpLnJhd0J5S2V5LmdldCh0eXBLZXkpO1xuICB9XG5cbiAgLy8gQ2xlYW4gPSBhIHNpbmdsZSB2YWx1ZSB3aXRob3V0IHBhZGRpbmcuIExvd2VyY2FzZSBjb3VudHMgYXMgY2xlYW4gKGEgdmFsaWRcbiAgLy8gVFlQIG5hbWUsIGp1c3Qgbm90IHJlZ2lzdGVyZWQgeWV0KTsgbGlzdHMgYW5kIHBhZGRpbmcgZG9uJ3QuXG4gIGlzQ2xlYW5LZXkodHlwS2V5KSB7XG4gICAgY29uc3QgcmF3ID0gdGhpcy5yYXdWYWx1ZU9mKHR5cEtleSk7XG4gICAgcmV0dXJuIHJhdyAhPT0gdW5kZWZpbmVkICYmICFBcnJheS5pc0FycmF5KHJhdykgJiYgdHlwS2V5ID09PSB0eXBLZXkudHJpbSgpO1xuICB9XG5cbiAgLy8gRmlsZXMgd2l0aCBleGFjdGx5IHRoaXMgVFlQIGtleSwgaG9ub3JpbmcgdGhlIGV4Y2x1ZGVkLWZpbGVzIHNldHRpbmcuXG4gIGZpbGVzV2l0aFR5cCh0eXBLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5maWxlc01hdGNoaW5nKChlbnRyeSkgPT4gZW50cnkudHlwS2V5ID09PSB0eXBLZXkpO1xuICB9XG5cbiAgLy8gRmlsZXMgd2l0aCBleGFjdGx5IHRoaXMgVFlQIGFuZCBTVUJUWVAga2V5LlxuICBmaWxlc1dpdGhTdWJ0eXAodHlwS2V5LCBzdWJ0eXBLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5maWxlc01hdGNoaW5nKChlbnRyeSkgPT4gZW50cnkudHlwS2V5ID09PSB0eXBLZXkgJiYgZW50cnkuc3VidHlwS2V5ID09PSBzdWJ0eXBLZXkpO1xuICB9XG5cbiAgZmlsZXNNYXRjaGluZyhwcmVkaWNhdGUpIHtcbiAgICB0aGlzLmVuc3VyZUJ1aWx0KCk7XG4gICAgY29uc3QgaW5jbHVkZUlnbm9yZWQgPSAhIXRoaXMucGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXM7XG4gICAgY29uc3QgZmlsZXMgPSBbXTtcbiAgICBmb3IgKGNvbnN0IFtwYXRoLCBlbnRyeV0gb2YgdGhpcy5lbnRyaWVzKSB7XG4gICAgICBpZiAoIXByZWRpY2F0ZShlbnRyeSkpIGNvbnRpbnVlO1xuICAgICAgaWYgKCFpbmNsdWRlSWdub3JlZCAmJiB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmlzVXNlcklnbm9yZWQocGF0aCkpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChwYXRoKTtcbiAgICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZpbGUpIGZpbGVzLnB1c2goZmlsZSk7XG4gICAgfVxuICAgIHJldHVybiBmaWxlcztcbiAgfVxuXG4gIC8vIEhvbm9ycyBPYnNpZGlhbidzIFwiRXhjbHVkZWQgZmlsZXNcIiAod2hlcmUgSGlkZSBGb2xkZXJzIGFsc28gcHV0cyBoaWRkZW5cbiAgLy8gZm9sZGVycykgdW5sZXNzIFwiSW5jbHVkZSBleGNsdWRlZCBmaWxlc1wiIGlzIG9uLiBBIG5vdGUgd2l0aG91dCBhIFRZUCBoYXNcbiAgLy8gbm8gU1VCVFlQIGNvbnRleHQuXG4gIGFnZ3JlZ2F0ZSgpIHtcbiAgICB0aGlzLmVuc3VyZUJ1aWx0KCk7XG4gICAgY29uc3QgaW5jbHVkZUlnbm9yZWQgPSAhIXRoaXMucGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXM7XG4gICAgaWYgKHRoaXMuYWdncmVnYXRlcz8uaW5jbHVkZUlnbm9yZWQgPT09IGluY2x1ZGVJZ25vcmVkKSByZXR1cm4gdGhpcy5hZ2dyZWdhdGVzO1xuXG4gICAgY29uc3QgY291bnRzID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IHJhd0J5S2V5ID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IHN1YnR5cHNCeVR5cCA9IG5ldyBNYXAoKTtcbiAgICBsZXQgbm9UeXAgPSAwO1xuICAgIGZvciAoY29uc3QgW3BhdGgsIHsgdHlwS2V5LCByYXdUeXAsIHN1YnR5cEtleSwgcmF3U3VidHlwIH1dIG9mIHRoaXMuZW50cmllcykge1xuICAgICAgaWYgKCFpbmNsdWRlSWdub3JlZCAmJiB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmlzVXNlcklnbm9yZWQocGF0aCkpIGNvbnRpbnVlO1xuICAgICAgaWYgKHR5cEtleSA9PT0gbnVsbCkge1xuICAgICAgICBub1R5cCsrO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvdW50cy5zZXQodHlwS2V5LCAoY291bnRzLmdldCh0eXBLZXkpID8/IDApICsgMSk7XG4gICAgICBpZiAoIXJhd0J5S2V5Lmhhcyh0eXBLZXkpKSByYXdCeUtleS5zZXQodHlwS2V5LCByYXdUeXApO1xuICAgICAgbGV0IGJ1Y2tldCA9IHN1YnR5cHNCeVR5cC5nZXQodHlwS2V5KTtcbiAgICAgIGlmICghYnVja2V0KSB7XG4gICAgICAgIGJ1Y2tldCA9IHsgY291bnRzOiBuZXcgTWFwKCksIG5vU3VidHlwOiAwLCByYXdCeUtleTogbmV3IE1hcCgpIH07XG4gICAgICAgIHN1YnR5cHNCeVR5cC5zZXQodHlwS2V5LCBidWNrZXQpO1xuICAgICAgfVxuICAgICAgaWYgKHN1YnR5cEtleSA9PT0gbnVsbCkge1xuICAgICAgICBidWNrZXQubm9TdWJ0eXArKztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGJ1Y2tldC5jb3VudHMuc2V0KHN1YnR5cEtleSwgKGJ1Y2tldC5jb3VudHMuZ2V0KHN1YnR5cEtleSkgPz8gMCkgKyAxKTtcbiAgICAgICAgaWYgKCFidWNrZXQucmF3QnlLZXkuaGFzKHN1YnR5cEtleSkpIGJ1Y2tldC5yYXdCeUtleS5zZXQoc3VidHlwS2V5LCByYXdTdWJ0eXApO1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSB7IGluY2x1ZGVJZ25vcmVkLCBjb3VudHMsIG5vVHlwLCByYXdCeUtleSwgc3VidHlwc0J5VHlwIH07XG4gICAgcmV0dXJuIHRoaXMuYWdncmVnYXRlcztcbiAgfVxuXG4gIC8vIENhY2hlZCAtIGRvbid0IG1vZGlmeSB0aGUgcmV0dXJuZWQgbWFwcy5cbiAgdHlwQ291bnRzKCkge1xuICAgIGNvbnN0IHsgY291bnRzLCBub1R5cCB9ID0gdGhpcy5hZ2dyZWdhdGUoKTtcbiAgICByZXR1cm4geyBjb3VudHMsIG5vVHlwIH07XG4gIH1cblxuICAvLyBUWVAgLT4geyBjb3VudHM6IE1hcChTVUJUWVAga2V5IC0+IGNvdW50KSwgbm9TdWJ0eXAsIHJhd0J5S2V5IH0uXG4gIC8vIENhY2hlZCAtIGRvbid0IG1vZGlmeS5cbiAgc3VidHlwQ291bnRzKCkge1xuICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZSgpLnN1YnR5cHNCeVR5cDtcbiAgfVxuXG4gIHN1YnR5cEJ1Y2tldCh0eXBLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5zdWJ0eXBDb3VudHMoKS5nZXQodHlwS2V5KSA/PyBFTVBUWV9CVUNLRVQ7XG4gIH1cbn1cblxuY29uc3QgRU1QVFlfQlVDS0VUID0gT2JqZWN0LmZyZWV6ZSh7IGNvdW50czogbmV3IE1hcCgpLCBub1N1YnR5cDogMCwgcmF3QnlLZXk6IG5ldyBNYXAoKSB9KTtcblxubW9kdWxlLmV4cG9ydHMgPSB7IFR5cEluZGV4LCB0eXBLZXlPZiwgcHJvcGVydHlWYWx1ZSwgc2V0Q2Fub25pY2FsUHJvcGVydHksIGRlbGV0ZVByb3BlcnR5LCBUWVBfUFJPUEVSVFksIFNVQlRZUF9QUk9QRVJUWSB9O1xuIiwgImNvbnN0IHsgdHlwS2V5T2YsIHByb3BlcnR5VmFsdWUsIHNldENhbm9uaWNhbFByb3BlcnR5LCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcblxuLy8gU3VidHlwIG5hbWVzIGFyZSB0aXRsZSBjYXNlIHBlciB3b3JkICh1bmxpa2UgVFlQIG5hbWVzLCBzZWVcbi8vIG5vcm1hbGl6ZVR5cE5hbWUpOiBcImt1cnogR0VTQ0hJQ0hURVwiIC0+IFwiS3VyeiBHZXNjaGljaHRlXCIuIFRoZSBTVUJUWVBcbi8vIHByb3BlcnR5IGl0c2VsZiBzdGF5cyB1cHBlcmNhc2UuIFwiZGVcIiBsb2NhbGUgYmVjYXVzZSB0aGUgbmFtZXMgYXJlIEdlcm1hbi5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVN1YnR5cE5hbWUocmF3KSB7XG4gIHJldHVybiByYXcudHJpbSgpLnJlcGxhY2UoL1xcUysvZywgKHdvcmQpID0+IHdvcmQuY2hhckF0KDApLnRvTG9jYWxlVXBwZXJDYXNlKFwiZGVcIikgKyB3b3JkLnNsaWNlKDEpLnRvTG9jYWxlTG93ZXJDYXNlKFwiZGVcIikpO1xufVxuXG4vLyBSZWdpc3RlcmVkIFN1YnR5cHMgcGVyIFRZUCAoc2V0dGluZ3MudHlwU3VidHlwcyk6XG4vLyAgIHsgW1RZUF06IHsgW1NVQlRZUF06IHsgZnJvbnRtYXR0ZXI6IHsuLi59LCBmbG9hdGluZ0tleXM6IFsuLi5dLCBzaG9ydGN1dHM6IHsuLi59LCBtYW51YWw/OiBmYWxzZSB9IH0gfVxuLy8gQSBTdWJ0eXAgYmVsb25ncyB0byBleGFjdGx5IG9uZSBUWVAsIHRob3VnaCB0aGUgc2FtZSBuYW1lIG1heSBhbHNvIGV4aXN0XG4vLyB1bmRlciBhbm90aGVyIFRZUC4gS2V5IG9yZGVyIGlzIHRoZSBibG9jayBvcmRlciBpbiB0aGUgVFlQLVBhbmUsIGFsd2F5c1xuLy8gYmVsb3cgdGhlIFRZUC1Gcm9udG1hdHRlci4gZnJvbnRtYXR0ZXIgYWRkcyB0byBvciBvdmVycmlkZXMgdGhlXG4vLyBUWVAtRnJvbnRtYXR0ZXI7IGZsb2F0aW5nS2V5cyBhbmQgc2hvcnRjdXRzIHdvcmsgbGlrZSB0eXBGbG9hdGluZ0tleXMgYW5kXG4vLyB0eXBTaG9ydGN1dHMuIE9sZGVyIGRhdGEgbGFja3Mgc2hvcnRjdXRzLCBzbyByZWFkZXJzIHRyZWF0IGl0IGFzIG9wdGlvbmFsLlxuLy8gbWFudWFsIHdvcmtzIGxpa2UgdHlwTWFudWFsOiBvbmx5IHRoZSBkZXZpYXRpb24gKGZhbHNlKSBpcyBzdG9yZWQuXG4vL1xuLy8gVGhlIHNhbWUga2V5IG1heSBhcHBlYXIgaW4gc2V2ZXJhbCBibG9ja3Mgb2Ygb25lIFRZUCAob25seSB3aXRoaW4gT05FIGJsb2NrXG4vLyBpcyBpdCBuZWNlc3NhcmlseSB1bmlxdWUpOlxuLy8gICAtIGluIHR3byBTdWJ0eXAgYmxvY2tzOiBubyBjb25mbGljdCwgYSBub3RlIGhhcyBhdCBtb3N0IG9uZSBTVUJUWVA7XG4vLyAgIC0gaW4gdGhlIFRZUC1Gcm9udG1hdHRlciBBTkQgYSBTdWJ0eXAgYmxvY2s6IHRoZSBTdWJ0eXAgb3ZlcnJpZGVzIHZhbHVlXG4vLyAgICAgYW5kIGZsb2F0aW5nIGZsYWcsIHRoZSByb3cga2VlcHMgdGhlIFRZUC1Gcm9udG1hdHRlciBwb3NpdGlvbi4gZ2V0VHlwRGVmYXVsdHNcbi8vICAgICAobWFpbi5qcykgYW5kIG9yZGVyZWREZWZhdWx0S2V5cyAoZnJvbnRtYXR0ZXItc29ydC5qcykgbXVzdCB1c2UgdGhlIHNhbWVcbi8vICAgICBydWxlLCBvciBzb3J0aW5nIHdvdWxkIHJlLXNvcnQgYSBmcmVzaGx5IGNyZWF0ZWQgbm90ZSByaWdodCBhd2F5LlxuXG4vLyBcIlN0aWxsIHRvIGJlIGZpbGxlZFwiOiB3aGVuIHR3byBibG9ja3Mgb3IgdHdvIHByb3BlcnRpZXMgbWVyZ2UsIHN1Y2ggYSB2YWx1ZVxuLy8gaXMgZmlsbGVkIGZyb20gdGhlIG90aGVyIGluc3RlYWQgb2Ygb3ZlcndyaXRpbmcgdGhlIGV4aXN0aW5nIGVudHJ5IChzZWVcbi8vIG1lcmdlU3VidHlwcyBoZXJlIGFuZCByZW5hbWVJblN0b3JlIGluIHByb3BlcnR5LXJlbmFtZS1zeW5jLmpzKS5cbmZ1bmN0aW9uIGlzRW1wdHlWYWx1ZSh2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gXCJcIjtcbn1cblxuZnVuY3Rpb24gZ2V0U3VidHlwTmFtZXMoc2V0dGluZ3MsIHR5cCkge1xuICByZXR1cm4gT2JqZWN0LmtleXMoc2V0dGluZ3MudHlwU3VidHlwcz8uW3R5cF0gPz8ge30pO1xufVxuXG5mdW5jdGlvbiBnZXRTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgc3VidHlwKSB7XG4gIHJldHVybiBzZXR0aW5ncy50eXBTdWJ0eXBzPy5bdHlwXT8uW3N1YnR5cF0gPz8gbnVsbDtcbn1cblxuZnVuY3Rpb24gZW5zdXJlU3VidHlwKHNldHRpbmdzLCB0eXAsIHN1YnR5cCkge1xuICBpZiAoIXNldHRpbmdzLnR5cFN1YnR5cHMpIHNldHRpbmdzLnR5cFN1YnR5cHMgPSB7fTtcbiAgaWYgKCFzZXR0aW5ncy50eXBTdWJ0eXBzW3R5cF0pIHNldHRpbmdzLnR5cFN1YnR5cHNbdHlwXSA9IHt9O1xuICBjb25zdCBieU5hbWUgPSBzZXR0aW5ncy50eXBTdWJ0eXBzW3R5cF07XG4gIGlmICghYnlOYW1lW3N1YnR5cF0pIHtcbiAgICBieU5hbWVbc3VidHlwXSA9IHsgZnJvbnRtYXR0ZXI6IHt9LCBmbG9hdGluZ0tleXM6IFtdLCBzaG9ydGN1dHM6IHt9IH07XG4gICAgLy8gQSBuZXcgU3VidHlwIG9mIGEgVFlQIHRoYXQgaXNuJ3QgbWFudWFsbHkgY3JlYXRhYmxlIGlzbid0IGVpdGhlciAoc2VlXG4gICAgLy8gaXNTdWJ0eXBNYW51YWwpLlxuICAgIGlmIChzZXR0aW5ncy50eXBNYW51YWw/Llt0eXBdID09PSBmYWxzZSkgYnlOYW1lW3N1YnR5cF0ubWFudWFsID0gZmFsc2U7XG4gIH1cbiAgcmV0dXJuIGJ5TmFtZVtzdWJ0eXBdO1xufVxuXG4vKiAtLS0gXCJNYW51YWxseSBjcmVhdGFibGVcIiBwZXIgU3VidHlwIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICogTGlrZSB0eXBNYW51YWwgZm9yIFRZUCBlbnRyaWVzOiBvbmx5IHN3aXRjaGluZyBvZmYgaXMgc3RvcmVkXG4gKiAobWFudWFsOiBmYWxzZSk7IG5vIGVudHJ5IG9yIHRydWUgbWVhbnMgb24uIERlY2lkZXMgd2hldGhlciB0aGUgU3VidHlwXG4gKiBzaG93cyB1cCBpbiBnZXRTdWJ0eXBzKCkgKG1haW4uanMpIGFuZCB0aHVzIGluIHRoZSBTdWJ0eXAtUGlja2VyLlxuICpcbiAqIFRZUCBhbmQgU3VidHlwIGFyZSBsaW5rZWQsIGJlY2F1c2UgdGhlIHBpY2tlciBvbmx5IHJlYWNoZXMgYSBTdWJ0eXAgdGhyb3VnaFxuICogaXRzIFRZUDogc3dpdGNoaW5nIGEgVFlQIG9mZiBzd2l0Y2hlcyBhbGwgaXRzIFN1YnR5cHMgb2ZmLCBzd2l0Y2hpbmcgaXQgb25cbiAqIHN3aXRjaGVzIHRoZW0gYWxsIG9uIChzZXRBbGxTdWJ0eXBzTWFudWFsKSwgYW5kIHN3aXRjaGluZyBhIHNpbmdsZSBTdWJ0eXAgb25cbiAqIGFsc28gc3dpdGNoZXMgaXRzIFRZUCBvbiwgbGVhdmluZyB0aGUgb3RoZXIgU3VidHlwcyBhbG9uZSAoc2VlXG4gKiByZW5kZXJTdWJ0eXBNYW51YWxUb2dnbGUgaW4gdHlwLXBhbmUuanMpLiBTbyBhIFN1YnR5cCBpcyBvbmx5IGV2ZXIgbWFudWFsbHlcbiAqIGNyZWF0YWJsZSBpZiBpdHMgVFlQIGlzLlxuICogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5mdW5jdGlvbiBpc1N1YnR5cE1hbnVhbChzZXR0aW5ncywgdHlwLCBzdWJ0eXApIHtcbiAgcmV0dXJuIGdldFN1YnR5cChzZXR0aW5ncywgdHlwLCBzdWJ0eXApPy5tYW51YWwgIT09IGZhbHNlO1xufVxuXG5mdW5jdGlvbiBzZXRTdWJ0eXBNYW51YWwoc2V0dGluZ3MsIHR5cCwgc3VidHlwLCBvbikge1xuICBjb25zdCBkYXRhID0gZ2V0U3VidHlwKHNldHRpbmdzLCB0eXAsIHN1YnR5cCk7XG4gIGlmICghZGF0YSkgcmV0dXJuO1xuICBpZiAob24pIGRlbGV0ZSBkYXRhLm1hbnVhbDtcbiAgZWxzZSBkYXRhLm1hbnVhbCA9IGZhbHNlO1xufVxuXG5mdW5jdGlvbiBzZXRBbGxTdWJ0eXBzTWFudWFsKHNldHRpbmdzLCB0eXAsIG9uKSB7XG4gIGZvciAoY29uc3Qgc3VidHlwIG9mIGdldFN1YnR5cE5hbWVzKHNldHRpbmdzLCB0eXApKSBzZXRTdWJ0eXBNYW51YWwoc2V0dGluZ3MsIHR5cCwgc3VidHlwLCBvbik7XG59XG5cbi8vIFdoZW4gYSBUWVAgaXMgcmVuYW1lZCwgaXRzIFN1YnR5cHMgbW92ZSB0byB0aGUgbmV3IG5hbWUuXG5mdW5jdGlvbiBtb3ZlVHlwU3VidHlwcyhzZXR0aW5ncywgb2xkVHlwLCBuZXdUeXApIHtcbiAgaWYgKCFzZXR0aW5ncy50eXBTdWJ0eXBzPy5bb2xkVHlwXSkgcmV0dXJuO1xuICBzZXR0aW5ncy50eXBTdWJ0eXBzW25ld1R5cF0gPSBzZXR0aW5ncy50eXBTdWJ0eXBzW29sZFR5cF07XG4gIGRlbGV0ZSBzZXR0aW5ncy50eXBTdWJ0eXBzW29sZFR5cF07XG59XG5cbmZ1bmN0aW9uIGRlbGV0ZVR5cFN1YnR5cHMoc2V0dGluZ3MsIHR5cCkge1xuICBpZiAoc2V0dGluZ3MudHlwU3VidHlwcykgZGVsZXRlIHNldHRpbmdzLnR5cFN1YnR5cHNbdHlwXTtcbn1cblxuLy8gTWVyZ2luZyB0d28gVFlQIGVudHJpZXM6IFN1YnR5cHMgb25seSBpbiBzb3VyY2UgbW92ZSBvdmVyLiBCbG9ja3Mgd2l0aCB0aGVcbi8vIHNhbWUgbmFtZSBhcmUgY29tYmluZWQgLSBmb3IgYSBzaGFyZWQga2V5IHRoZSB0YXJnZXQncyB2YWx1ZSBhbmQgZmxvYXRpbmdcbi8vIGZsYWcgd2luLCBrZXlzIG9ubHkgaW4gc291cmNlIGFyZSBhcHBlbmRlZC4gQSBtb3ZlZCBrZXkgdGhhdCBpcyBhbHNvIGluIHRoZVxuLy8gdGFyZ2V0J3MgVFlQLUZyb250bWF0dGVyIHN0YXlzIGluIGJvdGgsIHdoaWNoIGlzIHRoZSBub3JtYWwgb3ZlcnJpZGUuXG5mdW5jdGlvbiBtZXJnZVR5cFN1YnR5cHMoc2V0dGluZ3MsIHNvdXJjZSwgdGFyZ2V0KSB7XG4gIGNvbnN0IHNvdXJjZVN1YnR5cHMgPSBzZXR0aW5ncy50eXBTdWJ0eXBzPy5bc291cmNlXTtcbiAgaWYgKCFzb3VyY2VTdWJ0eXBzKSByZXR1cm47XG4gIGZvciAoY29uc3QgW25hbWUsIHNvdXJjZURhdGFdIG9mIE9iamVjdC5lbnRyaWVzKHNvdXJjZVN1YnR5cHMpKSB7XG4gICAgY29uc3QgdGFyZ2V0RGF0YSA9IGdldFN1YnR5cChzZXR0aW5ncywgdGFyZ2V0LCBuYW1lKTtcbiAgICBpZiAoIXRhcmdldERhdGEpIHtcbiAgICAgIGVuc3VyZVN1YnR5cChzZXR0aW5ncywgdGFyZ2V0LCBuYW1lKTtcbiAgICAgIHNldHRpbmdzLnR5cFN1YnR5cHNbdGFyZ2V0XVtuYW1lXSA9IHNvdXJjZURhdGE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgdGFyZ2V0TG93ZXIgPSBuZXcgU2V0KE9iamVjdC5rZXlzKHRhcmdldERhdGEuZnJvbnRtYXR0ZXIpLm1hcCgoa2V5KSA9PiBrZXkudG9Mb3dlckNhc2UoKSkpO1xuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHNvdXJjZURhdGEuZnJvbnRtYXR0ZXIpKSB7XG4gICAgICBpZiAoa2V5ID09PSBcIlwiIHx8IHRhcmdldExvd2VyLmhhcyhrZXkudG9Mb3dlckNhc2UoKSkpIGNvbnRpbnVlO1xuICAgICAgdGFyZ2V0RGF0YS5mcm9udG1hdHRlcltrZXldID0gdmFsdWU7XG4gICAgICBpZiAoc291cmNlRGF0YS5mbG9hdGluZ0tleXMuaW5jbHVkZXMoa2V5KSkgdGFyZ2V0RGF0YS5mbG9hdGluZ0tleXMucHVzaChrZXkpO1xuICAgICAgLy8gVGhlIHNob3J0Y3V0IGJlbG9uZ3MgdG8gdGhlIGtleSBhbmQgbW92ZXMgd2l0aCBpdC5cbiAgICAgIGNvbnN0IHNob3J0Y3V0ID0gc291cmNlRGF0YS5zaG9ydGN1dHM/LltrZXldO1xuICAgICAgaWYgKHNob3J0Y3V0KSAodGFyZ2V0RGF0YS5zaG9ydGN1dHMgPz89IHt9KVtrZXldID0gc2hvcnRjdXQ7XG4gICAgfVxuICB9XG4gIGRlbGV0ZSBzZXR0aW5ncy50eXBTdWJ0eXBzW3NvdXJjZV07XG59XG5cbi8vIFJlbmFtZXMgYSBTdWJ0eXAgd2l0aGluIGl0cyBUWVA7IHRoZSBibG9jayBrZWVwcyBpdHMgcG9zaXRpb24gKGRpc3BsYXlcbi8vIG9yZGVyID0ga2V5IG9yZGVyKS5cbmZ1bmN0aW9uIHJlbmFtZVN1YnR5cChzZXR0aW5ncywgdHlwLCBvbGROYW1lLCBuZXdOYW1lKSB7XG4gIGNvbnN0IGJ5TmFtZSA9IHNldHRpbmdzLnR5cFN1YnR5cHM/Llt0eXBdO1xuICBpZiAoIWJ5TmFtZT8uW29sZE5hbWVdIHx8IG9sZE5hbWUgPT09IG5ld05hbWUpIHJldHVybjtcbiAgc2V0dGluZ3MudHlwU3VidHlwc1t0eXBdID0gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgIE9iamVjdC5lbnRyaWVzKGJ5TmFtZSkubWFwKChbbmFtZSwgZGF0YV0pID0+IFtuYW1lID09PSBvbGROYW1lID8gbmV3TmFtZSA6IG5hbWUsIGRhdGFdKVxuICApO1xufVxuXG4vLyBPcmRlciBvZiBhbGwgYmxvY2tzIG9mIGEgVFlQLCBudWxsID0gVFlQLUZyb250bWF0dGVyIChhbHdheXMgZmlyc3QpLCB0aGVuXG4vLyB0aGUgU3VidHlwcyBpbiBrZXkgb3JkZXIuIERyaXZlcyB0aGUgVFlQLVBhbmUgYXMgd2VsbCBhcyBmcm9udG1hdHRlclxuLy8gc29ydGluZyAoc2VlIG9yZGVyZWREZWZhdWx0S2V5cykuXG5mdW5jdGlvbiBnZXRTZWN0aW9uT3JkZXIoc2V0dGluZ3MsIHR5cCkge1xuICByZXR1cm4gW251bGwsIC4uLmdldFN1YnR5cE5hbWVzKHNldHRpbmdzLCB0eXApXTtcbn1cblxuLy8gTmV3IGJsb2NrIG9yZGVyIGZyb20gZHJhZyAmIGRyb3AgaW4gdGhlIFRZUC1QYW5lLCBzaGFwZWQgbGlrZVxuLy8gZ2V0U2VjdGlvbk9yZGVyOyB0aGUgbGVhZGluZyBudWxsIGlzIGlnbm9yZWQgKHRoZSBUWVAtRnJvbnRtYXR0ZXIgY2FuJ3Rcbi8vIG1vdmUpLiBTdWJ0eXBzIG5vdCBsaXN0ZWQgc3RheSBhdCB0aGUgZW5kLlxuZnVuY3Rpb24gcmVvcmRlclN1YnR5cHMoc2V0dGluZ3MsIHR5cCwgb3JkZXIpIHtcbiAgY29uc3QgYnlOYW1lID0gc2V0dGluZ3MudHlwU3VidHlwcz8uW3R5cF07XG4gIGlmICghYnlOYW1lKSByZXR1cm47XG4gIGNvbnN0IG5hbWVzID0gb3JkZXIuZmlsdGVyKChuYW1lKSA9PiBuYW1lICE9PSBudWxsICYmIGJ5TmFtZVtuYW1lXSk7XG4gIGNvbnN0IG9yZGVyZWQgPSBbLi4ubmFtZXMsIC4uLk9iamVjdC5rZXlzKGJ5TmFtZSkuZmlsdGVyKChuYW1lKSA9PiAhbmFtZXMuaW5jbHVkZXMobmFtZSkpXTtcbiAgc2V0dGluZ3MudHlwU3VidHlwc1t0eXBdID0gT2JqZWN0LmZyb21FbnRyaWVzKG9yZGVyZWQubWFwKChuYW1lKSA9PiBbbmFtZSwgYnlOYW1lW25hbWVdXSkpO1xufVxuXG5mdW5jdGlvbiBkZWxldGVTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgbmFtZSkge1xuICBjb25zdCBieU5hbWUgPSBzZXR0aW5ncy50eXBTdWJ0eXBzPy5bdHlwXTtcbiAgaWYgKCFieU5hbWUpIHJldHVybjtcbiAgZGVsZXRlIGJ5TmFtZVtuYW1lXTtcbiAgaWYgKE9iamVjdC5rZXlzKGJ5TmFtZSkubGVuZ3RoID09PSAwKSBkZWxldGUgc2V0dGluZ3MudHlwU3VidHlwc1t0eXBdO1xufVxuXG4vLyBNZXJnaW5nIHR3byBTdWJ0eXBzIG9mIG9uZSBUWVA6IHNvdXJjZSdzIHByb3BlcnRpZXMgZ28gdG8gdGhlIGVuZCBvZiB0aGVcbi8vIHRhcmdldCBibG9jaywgc291cmNlIGRpc2FwcGVhcnMuIElmIHRoZSB0YXJnZXQgYWxyZWFkeSBoYXMgYSBrZXksIGl0IGtlZXBzXG4vLyBwb3NpdGlvbiwgdmFsdWUgYW5kIGZsb2F0aW5nIGZsYWc7IG9ubHkgYW4gZW1wdHkgdGFyZ2V0IHZhbHVlIGlzIGZpbGxlZFxuLy8gZnJvbSBzb3VyY2UgKHNhbWUgcGF0dGVybiBhcyByZW5hbWVJblN0b3JlIGluIHByb3BlcnR5LXJlbmFtZS1zeW5jLmpzKS5cbmZ1bmN0aW9uIG1lcmdlU3VidHlwcyhzZXR0aW5ncywgdHlwLCBzb3VyY2UsIHRhcmdldCkge1xuICBjb25zdCBzb3VyY2VEYXRhID0gZ2V0U3VidHlwKHNldHRpbmdzLCB0eXAsIHNvdXJjZSk7XG4gIGNvbnN0IHRhcmdldERhdGEgPSBnZXRTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgdGFyZ2V0KTtcbiAgaWYgKCFzb3VyY2VEYXRhIHx8ICF0YXJnZXREYXRhIHx8IHNvdXJjZSA9PT0gdGFyZ2V0KSByZXR1cm47XG5cbiAgY29uc3QgdGFyZ2V0S2V5cyA9IG5ldyBNYXAoT2JqZWN0LmtleXModGFyZ2V0RGF0YS5mcm9udG1hdHRlcikubWFwKChrZXkpID0+IFtrZXkudG9Mb3dlckNhc2UoKSwga2V5XSkpO1xuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzb3VyY2VEYXRhLmZyb250bWF0dGVyKSkge1xuICAgIGlmIChrZXkgPT09IFwiXCIpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGV4aXN0aW5nID0gdGFyZ2V0S2V5cy5nZXQoa2V5LnRvTG93ZXJDYXNlKCkpO1xuICAgIGlmIChleGlzdGluZyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0YXJnZXREYXRhLmZyb250bWF0dGVyW2tleV0gPSB2YWx1ZTtcbiAgICAgIHRhcmdldEtleXMuc2V0KGtleS50b0xvd2VyQ2FzZSgpLCBrZXkpO1xuICAgICAgaWYgKHNvdXJjZURhdGEuZmxvYXRpbmdLZXlzLmluY2x1ZGVzKGtleSkgJiYgIXRhcmdldERhdGEuZmxvYXRpbmdLZXlzLmluY2x1ZGVzKGtleSkpIHRhcmdldERhdGEuZmxvYXRpbmdLZXlzLnB1c2goa2V5KTtcbiAgICAgIC8vIFRoZSBzaG9ydGN1dCBiZWxvbmdzIHRvIHRoZSBrZXkgYW5kIG1vdmVzIHdpdGggaXQuXG4gICAgICBjb25zdCBzaG9ydGN1dCA9IHNvdXJjZURhdGEuc2hvcnRjdXRzPy5ba2V5XTtcbiAgICAgIGlmIChzaG9ydGN1dCkgKHRhcmdldERhdGEuc2hvcnRjdXRzID8/PSB7fSlba2V5XSA9IHNob3J0Y3V0O1xuICAgIH0gZWxzZSBpZiAoaXNFbXB0eVZhbHVlKHRhcmdldERhdGEuZnJvbnRtYXR0ZXJbZXhpc3RpbmddKSkge1xuICAgICAgdGFyZ2V0RGF0YS5mcm9udG1hdHRlcltleGlzdGluZ10gPSB2YWx1ZTtcbiAgICB9XG4gIH1cbiAgZGVsZXRlU3VidHlwKHNldHRpbmdzLCB0eXAsIHNvdXJjZSk7XG59XG5cbi8vIFJld3JpdGVzIHRoZSBTVUJUWVAgb2YgZXZlcnkgbm90ZSB3aXRoIFRZUCBrZXkgYHR5cGAgYW5kIFNVQlRZUCBrZXkgb2xkS2V5XG4vLyB0byB0aGUgc2luZ2xlIHZhbHVlIG5ld1ZhbHVlIC0gbGlrZSByZW5hbWVUeXBJbk5vdGVzKCkgaW4gdHlwLXBhbmUuanMuXG5hc3luYyBmdW5jdGlvbiByZW5hbWVTdWJ0eXBJbk5vdGVzKHBsdWdpbiwgdHlwLCBvbGRLZXksIG5ld1ZhbHVlKSB7XG4gIGxldCBjaGFuZ2VkID0gMDtcbiAgZm9yIChjb25zdCBmaWxlIG9mIHBsdWdpbi50eXBJbmRleC5maWxlc1dpdGhTdWJ0eXAodHlwLCBvbGRLZXkpKSB7XG4gICAgbGV0IG1hdGNoZWQgPSBmYWxzZTtcbiAgICBhd2FpdCBwbHVnaW4uYXBwLmZpbGVNYW5hZ2VyLnByb2Nlc3NGcm9udE1hdHRlcihmaWxlLCAoZnJvbnRtYXR0ZXIpID0+IHtcbiAgICAgIGlmICh0eXBLZXlPZihwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBTVUJUWVBfUFJPUEVSVFkpKSAhPT0gb2xkS2V5KSByZXR1cm47XG4gICAgICBzZXRDYW5vbmljYWxQcm9wZXJ0eShmcm9udG1hdHRlciwgU1VCVFlQX1BST1BFUlRZLCBuZXdWYWx1ZSk7XG4gICAgICBtYXRjaGVkID0gdHJ1ZTtcbiAgICB9KTtcbiAgICBpZiAobWF0Y2hlZCkgY2hhbmdlZCsrO1xuICB9XG4gIHJldHVybiBjaGFuZ2VkO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgbm9ybWFsaXplU3VidHlwTmFtZSxcbiAgaXNFbXB0eVZhbHVlLFxuICBnZXRTdWJ0eXBOYW1lcyxcbiAgZ2V0U3VidHlwLFxuICBlbnN1cmVTdWJ0eXAsXG4gIGlzU3VidHlwTWFudWFsLFxuICBzZXRTdWJ0eXBNYW51YWwsXG4gIHNldEFsbFN1YnR5cHNNYW51YWwsXG4gIG1vdmVUeXBTdWJ0eXBzLFxuICBkZWxldGVUeXBTdWJ0eXBzLFxuICBtZXJnZVR5cFN1YnR5cHMsXG4gIHJlbmFtZVN1YnR5cCxcbiAgZ2V0U2VjdGlvbk9yZGVyLFxuICByZW9yZGVyU3VidHlwcyxcbiAgZGVsZXRlU3VidHlwLFxuICBtZXJnZVN1YnR5cHMsXG4gIHJlbmFtZVN1YnR5cEluTm90ZXMsXG59O1xuIiwgIi8vIFN0YXRlbGVzcyBoZWxwZXJzIGFyb3VuZCBUWVAgbmFtZXMsIHNvcnRpbmcgYW5kIG1lc3NhZ2UgdGV4dC5cblxuLy8gVFlQIG5hbWVzIHR5cGVkIGludG8gdGhlIGxpc3QgYXJlIGFsd2F5cyB1cHBlcmNhc2UuIFZhbHVlcyB3cml0dGVuIGRpcmVjdGx5XG4vLyBpbnRvIGEgbm90ZSdzIGZyb250bWF0dGVyIGFyZSBsZWZ0IGFsb25lIChzZWUgdGhlIHVucmVnaXN0ZXJlZCByb3dzIGluXG4vLyB0eXAtcGFuZS5qcykuXG5mdW5jdGlvbiBub3JtYWxpemVUeXBOYW1lKHJhdykge1xuICByZXR1cm4gcmF3LnRyaW0oKS50b1VwcGVyQ2FzZSgpO1xufVxuXG4vLyBcIjEgbm90ZVwiLCBcIjMgbm90ZXNcIi4gd29yZCBpcyB0aGUgRW5nbGlzaCBzaW5ndWxhcjsgaXJyZWd1bGFyIHBsdXJhbHMgYXJlXG4vLyBwYXNzZWQgZXhwbGljaXRseS5cbmZ1bmN0aW9uIHBsdXJhbChjb3VudCwgd29yZCwgcGx1cmFsV29yZCA9IGAke3dvcmR9c2ApIHtcbiAgcmV0dXJuIGAke2NvdW50fSAke2NvdW50ID09PSAxID8gd29yZCA6IHBsdXJhbFdvcmR9YDtcbn1cblxuLy8gXCJhXCIsIFwiYSBhbmQgYlwiLCBcImEsIGIgYW5kIGNcIi5cbmZ1bmN0aW9uIGpvaW5BbmQocGFydHMpIHtcbiAgcmV0dXJuIHBhcnRzLmxlbmd0aCA8PSAxID8gcGFydHMuam9pbihcIlwiKSA6IGAke3BhcnRzLnNsaWNlKDAsIC0xKS5qb2luKFwiLCBcIil9IGFuZCAke3BhcnRzW3BhcnRzLmxlbmd0aCAtIDFdfWA7XG59XG5cbi8vIEtleSBoaW50cyBhdCB0aGUgYm90dG9tIG9mIGEgcGlja2VyLCB3b3JkZWQgbGlrZSB0aG9zZSBvZiBPYnNpZGlhbidzIG93blxuLy8gc3VnZ2VzdGVycy4gZXNjUHVycG9zZTogdGhlIFN1YnR5cC1QaWNrZXIgc2F5cyBcInRvIGdvIGJhY2tcIiwgc2luY2UgRVNDIHRoZXJlXG4vLyByZXR1cm5zIHRvIHRoZSBUWVAgY2hvaWNlLlxuZnVuY3Rpb24gcGlja2VySW5zdHJ1Y3Rpb25zKGVzY1B1cnBvc2UgPSBcInRvIGNhbmNlbFwiKSB7XG4gIHJldHVybiBbXG4gICAgeyBjb21tYW5kOiBcIlx1MjE5MVx1MjE5M1wiLCBwdXJwb3NlOiBcInRvIG5hdmlnYXRlXCIgfSxcbiAgICB7IGNvbW1hbmQ6IFwiXHUyMUI1XCIsIHB1cnBvc2U6IFwidG8gY2hvb3NlXCIgfSxcbiAgICB7IGNvbW1hbmQ6IFwiZXNjXCIsIHB1cnBvc2U6IGVzY1B1cnBvc2UgfSxcbiAgXTtcbn1cblxuLy8gSHVlICgwLTM2MFx1MDBCMCkgb2YgYSBoZXggY29sb3IsIHNvIGNvbG9ycyBzb3J0IGFsb25nIHRoZSBzcGVjdHJ1bSBpbnN0ZWFkIG9mIGJ5XG4vLyBoZXggc3RyaW5nLiBBY2hyb21hdGljIGNvbG9ycyAoZ3JheS9ibGFjay93aGl0ZSkgaGF2ZSBubyBodWUgYW5kIHJldHVybiBudWxsO1xuLy8gY29tcGFyZVR5cHMga2VlcHMgdGhlbSBsYXN0IGluIGJvdGggZGlyZWN0aW9ucy5cbmZ1bmN0aW9uIGhleFRvSHVlKGhleCkge1xuICBjb25zdCBtYXRjaCA9IC9eIz8oWzAtOWEtZl17Nn0pJC9pLmV4ZWMoaGV4ID8/IFwiXCIpO1xuICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgaW50ID0gcGFyc2VJbnQobWF0Y2hbMV0sIDE2KTtcbiAgY29uc3QgciA9ICgoaW50ID4+IDE2KSAmIDI1NSkgLyAyNTU7XG4gIGNvbnN0IGcgPSAoKGludCA+PiA4KSAmIDI1NSkgLyAyNTU7XG4gIGNvbnN0IGIgPSAoaW50ICYgMjU1KSAvIDI1NTtcbiAgY29uc3QgbWF4ID0gTWF0aC5tYXgociwgZywgYik7XG4gIGNvbnN0IG1pbiA9IE1hdGgubWluKHIsIGcsIGIpO1xuICBjb25zdCBkZWx0YSA9IG1heCAtIG1pbjtcbiAgaWYgKGRlbHRhID09PSAwKSByZXR1cm4gbnVsbDtcblxuICBsZXQgaHVlO1xuICBpZiAobWF4ID09PSByKSBodWUgPSAoKGcgLSBiKSAvIGRlbHRhKSAlIDY7XG4gIGVsc2UgaWYgKG1heCA9PT0gZykgaHVlID0gKGIgLSByKSAvIGRlbHRhICsgMjtcbiAgZWxzZSBodWUgPSAociAtIGcpIC8gZGVsdGEgKyA0O1xuICBodWUgKj0gNjA7XG4gIHJldHVybiBodWUgPCAwID8gaHVlICsgMzYwIDogaHVlO1xufVxuXG4vLyBTaGFyZWQgY29tcGFyaXNvbiBmb3IgVFlQIGFuZCBTVUJUWVAgbGlzdHMuIHR5cENvbG9ycyBtYXkgYmUgZW1wdHkgKGEgU3VidHlwXG4vLyBoYXMgbm8gY29sb3Igb2YgaXRzIG93bik7IHRoZSBcImNvbG9yXCIgbW9kZSBpcyB0aGVuIG5ldmVyIHNlbGVjdGVkLlxuZnVuY3Rpb24gY29tcGFyZVR5cHMobW9kZSwgYSwgYiwgY291bnRzLCB0eXBDb2xvcnMpIHtcbiAgY29uc3QgW2tleSwgZGlyXSA9IG1vZGUuc3BsaXQoXCItXCIpO1xuICBsZXQgY21wO1xuICBpZiAoa2V5ID09PSBcImNvdW50XCIpIHtcbiAgICBjbXAgPSAoY291bnRzLmdldChhKSA/PyAwKSAtIChjb3VudHMuZ2V0KGIpID8/IDApO1xuICAgIGlmIChkaXIgPT09IFwiZGVzY1wiKSBjbXAgPSAtY21wO1xuICB9IGVsc2UgaWYgKGtleSA9PT0gXCJjb2xvclwiKSB7XG4gICAgY29uc3QgaHVlQSA9IGhleFRvSHVlKHR5cENvbG9yc1thXSA/PyBudWxsKTtcbiAgICBjb25zdCBodWVCID0gaGV4VG9IdWUodHlwQ29sb3JzW2JdID8/IG51bGwpO1xuICAgIC8vIEFjaHJvbWF0aWMgY29sb3JzIHN0YXkgYXQgdGhlIGVuZCBpbiBib3RoIGRpcmVjdGlvbnMuXG4gICAgaWYgKGh1ZUEgPT09IG51bGwgJiYgaHVlQiA9PT0gbnVsbCkgY21wID0gMDtcbiAgICBlbHNlIGlmIChodWVBID09PSBudWxsKSBjbXAgPSAxO1xuICAgIGVsc2UgaWYgKGh1ZUIgPT09IG51bGwpIGNtcCA9IC0xO1xuICAgIGVsc2Uge1xuICAgICAgY21wID0gaHVlQSAtIGh1ZUI7XG4gICAgICBpZiAoZGlyID09PSBcImRlc2NcIikgY21wID0gLWNtcDtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgY21wID0gYS5sb2NhbGVDb21wYXJlKGIpO1xuICAgIGlmIChkaXIgPT09IFwiZGVzY1wiKSBjbXAgPSAtY21wO1xuICB9XG4gIHJldHVybiBjbXAgfHwgYS5sb2NhbGVDb21wYXJlKGIpO1xufVxuXG4vLyBcIm1hbnVhbFwiIGtlZXBzIHRoZSBnaXZlbiBvcmRlcjogaXQgaXMgdGhlIHN0b3JlZCBvcmRlciAoc2V0dGluZ3MudHlwcyxcbi8vIHJlYXJyYW5nZWQgYnkgZHJhZyAmIGRyb3ApLCB3aGljaCBubyBwYWlyd2lzZSBjb21wYXJpc29uIGNvdWxkIGRlcml2ZS5cbi8vIFVzZWQgYnkgbWFpbi5qcyAoZ2V0VHlwcykgYW5kIHR5cC1wYW5lLmpzIHNvIGJvdGggc2hvdyB0aGUgc2FtZSBvcmRlci5cbmZ1bmN0aW9uIHNvcnRUeXBzQnlNb2RlKHR5cHMsIG1vZGUsIGNvdW50cywgdHlwQ29sb3JzKSB7XG4gIGlmIChtb2RlID09PSBcIm1hbnVhbFwiKSByZXR1cm4gWy4uLnR5cHNdO1xuICByZXR1cm4gWy4uLnR5cHNdLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVUeXBzKG1vZGUsIGEsIGIsIGNvdW50cywgdHlwQ29sb3JzKSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBub3JtYWxpemVUeXBOYW1lLCBwbHVyYWwsIGpvaW5BbmQsIHBpY2tlckluc3RydWN0aW9ucywgaGV4VG9IdWUsIGNvbXBhcmVUeXBzLCBzb3J0VHlwc0J5TW9kZSB9O1xuIiwgImNvbnN0IHsgTm90aWNlIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IGdldFN1YnR5cCB9ID0gcmVxdWlyZShcIi4vc3VidHlwc1wiKTtcbmNvbnN0IHsgdHlwS2V5T2YsIHByb3BlcnR5VmFsdWUsIFRZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZIH0gPSByZXF1aXJlKFwiLi90eXAtaW5kZXhcIik7XG5jb25zdCB7IHBsdXJhbCB9ID0gcmVxdWlyZShcIi4vdHlwLXV0aWxzXCIpO1xuXG4vLyBUaGUgZm91ciBwbGFjZWhvbGRlcnMgb2YgdGhlIGdsb2JhbCBvcmRlcjsgdGhlIG9yZGVyIGVkaXRvciBsZXRzIHlvdSBtb3ZlXG4vLyB0aGVtIGJ1dCBub3QgcmVtb3ZlIHRoZW0uIFwidHlwVmFsdWVcIiBpcyB0aGUgVFlQIHByb3BlcnR5IGl0c2VsZixcbi8vIFwic3VidHlwVmFsdWVcIiB0aGUgU1VCVFlQIHByb3BlcnR5LCBcInR5cFwiIHRoZSBUWVAtRnJvbnRtYXR0ZXIgbGlzdCxcbi8vIFwib3RoZXJcIiBldmVyeXRoaW5nIGVsc2UuXG5jb25zdCBERUZBVUxUX0dMT0JBTF9PUkRFUiA9IFt7IGtpbmQ6IFwidHlwVmFsdWVcIiB9LCB7IGtpbmQ6IFwic3VidHlwVmFsdWVcIiB9LCB7IGtpbmQ6IFwidHlwXCIgfSwgeyBraW5kOiBcIm90aGVyXCIgfV07XG5cbi8vIEVuc3VyZXMgZXhhY3RseSBvbmUgZW50cnkgcGVyIHBsYWNlaG9sZGVyLiBPbGRlciBzYXZlZCBvcmRlcnMgcHJlZGF0ZSBzb21lXG4vLyBvZiB0aGVtOyBtaXNzaW5nIG9uZXMgYXJlIGFkZGVkIGF0IGEgc2Vuc2libGUgc3BvdCAoXCJzdWJ0eXBWYWx1ZVwiIHJpZ2h0XG4vLyBhZnRlciBcInR5cFZhbHVlXCIsIHRoZSBvdGhlcnMgYXQgdGhlIGVkZ2VzKSB3aXRob3V0IHRvdWNoaW5nIHRoZSBvcmRlciB0aGVcbi8vIHVzZXIgYXJyYW5nZWQuXG5mdW5jdGlvbiBub3JtYWxpemVHbG9iYWxPcmRlcihvcmRlcikge1xuICBjb25zdCByZXN1bHQgPSBBcnJheS5pc0FycmF5KG9yZGVyKSA/IG9yZGVyLmZpbHRlcigoZW50cnkpID0+IGVudHJ5ICYmIHR5cGVvZiBlbnRyeSA9PT0gXCJvYmplY3RcIikgOiBbXTtcbiAgY29uc3QgaGFzS2luZCA9IChraW5kKSA9PiByZXN1bHQuc29tZSgoZW50cnkpID0+IGVudHJ5LmtpbmQgPT09IGtpbmQpO1xuICBpZiAoIWhhc0tpbmQoXCJ0eXBWYWx1ZVwiKSkgcmVzdWx0LnVuc2hpZnQoeyBraW5kOiBcInR5cFZhbHVlXCIgfSk7XG4gIGlmICghaGFzS2luZChcInN1YnR5cFZhbHVlXCIpKSB7XG4gICAgY29uc3QgdHlwVmFsdWVJbmRleCA9IHJlc3VsdC5maW5kSW5kZXgoKGVudHJ5KSA9PiBlbnRyeS5raW5kID09PSBcInR5cFZhbHVlXCIpO1xuICAgIHJlc3VsdC5zcGxpY2UodHlwVmFsdWVJbmRleCArIDEsIDAsIHsga2luZDogXCJzdWJ0eXBWYWx1ZVwiIH0pO1xuICB9XG4gIGlmICghaGFzS2luZChcInR5cFwiKSkgcmVzdWx0LnB1c2goeyBraW5kOiBcInR5cFwiIH0pO1xuICBpZiAoIWhhc0tpbmQoXCJvdGhlclwiKSkgcmVzdWx0LnB1c2goeyBraW5kOiBcIm90aGVyXCIgfSk7XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICogRnJvbnRtYXR0ZXIgc29ydGluZ1xuICogUHV0cyB0aGUgcHJvcGVydGllcyBhIG5vdGUgSEFTIGludG8gYSBmaXhlZCBvcmRlciBidWlsdCBmcm9tXG4gKiBnbG9iYWxQcm9wZXJ0eU9yZGVyOiBwaW5uZWQgc2luZ2xlIHByb3BlcnRpZXMsIHRoZSBUWVAgYW5kXG4gKiBTVUJUWVAgcHJvcGVydGllcywgdGhlIFwiVFlQLUZyb250bWF0dGVyXCIgYmxvY2sgKHRoZSBUWVAncyBsaXN0XG4gKiBmb2xsb3dlZCBieSBpdHMgU3VidHlwIGJsb2NrKSBhbmQgXCJPdGhlciBwcm9wZXJ0aWVzXCIuIE5ldmVyIGFkZHNcbiAqIHByb3BlcnRpZXMgb3IgY2hhbmdlcyB2YWx1ZXMuXG4gKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi9cblxuLy8gS2V5IG9yZGVyIG9mIGEgVFlQJ3MgZnJvbnRtYXR0ZXIsIGZsb2F0aW5nIGtleXMgaW5jbHVkZWQgYXQgdGhlaXIgbGlzdFxuLy8gcG9zaXRpb24gKGdldFR5cERlZmF1bHRzIGxlYXZlcyB0aGVtIG91dCwgYnV0IGEgbm90ZSB0aGF0IGhhcyBvbmUgc2hvdWxkXG4vLyBzdGlsbCBnZXQgaXQgaW4gcGxhY2UpLiBXaXRob3V0IFRZUC9TVUJUWVAgYW5kIHRoZSBlZGl0b3IncyBibGFuayByb3cuXG4vLyBudWxsIGlmIHRoZXJlIGlzIG5vIFRZUCBvciBubyBsaXN0LlxuLy9cbi8vIFdpdGggc3VidHlwLCB0aGUga2V5cyBvZiBpdHMgYmxvY2sgZm9sbG93LiBBIGtleSBpbiBCT1RIIGJsb2NrcyBrZWVwcyB0aGVcbi8vIFRZUC1Gcm9udG1hdHRlciBwb3NpdGlvbiAtIHRoZSBzYW1lIHJ1bGUgYXMgY29sbGVjdEJsb2NrcyBpbiBtYWluLmpzLCBvciBhXG4vLyBmcmVzaGx5IGNyZWF0ZWQgbm90ZSB3b3VsZCBiZSByZS1zb3J0ZWQgcmlnaHQgYXdheS5cbmZ1bmN0aW9uIG9yZGVyZWREZWZhdWx0S2V5cyhwbHVnaW4sIHR5cCwgc3VidHlwID0gbnVsbCkge1xuICBpZiAoIXR5cCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGlzU3lzdGVtS2V5ID0gKGtleSkgPT4ga2V5ID09PSBcIlwiIHx8IFtUWVBfUFJPUEVSVFksIFNVQlRZUF9QUk9QRVJUWV0uc29tZSgocCkgPT4ga2V5LnRvTG93ZXJDYXNlKCkgPT09IHAudG9Mb3dlckNhc2UoKSk7XG4gIGNvbnN0IHN1YnR5cERhdGEgPSBzdWJ0eXAgPyBnZXRTdWJ0eXAocGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCkgOiBudWxsO1xuICBjb25zdCBibG9ja3MgPSBbcGx1Z2luLnNldHRpbmdzLnR5cERlZmF1bHRGcm9udG1hdHRlclt0eXBdLCBzdWJ0eXBEYXRhPy5mcm9udG1hdHRlcl07XG4gIGNvbnN0IGtleXMgPSBbXTtcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQoKTtcbiAgZm9yIChjb25zdCBibG9jayBvZiBibG9ja3MpIHtcbiAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhibG9jayA/PyB7fSkpIHtcbiAgICAgIGlmIChpc1N5c3RlbUtleShrZXkpIHx8IHNlZW4uaGFzKGtleS50b0xvd2VyQ2FzZSgpKSkgY29udGludWU7XG4gICAgICBrZXlzLnB1c2goa2V5KTtcbiAgICAgIHNlZW4uYWRkKGtleS50b0xvd2VyQ2FzZSgpKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGtleXMubGVuZ3RoID4gMCA/IGtleXMgOiBudWxsO1xufVxuXG4vLyBUYXJnZXQgb3JkZXIgb2YgYSBub3RlJ3MgZXhpc3RpbmcgcHJvcGVydGllcywgZnVsbHkgZGVmaW5lZCBieSBnbG9iYWxPcmRlci5cbi8vXG4vLyBXaGljaCBibG9jayBjbGFpbXMgYSBwcm9wZXJ0eSBpcyBkZWNpZGVkIEJFRk9SRSB0aGUgb3JkZXIgaXMgYnVpbHQgKHBpbm5lZCxcbi8vIFRZUCBibG9jayBhbmQgcmVzdCBhcmUgZGlzam9pbnQpLCBzbyB0aGUgcmVzdWx0IGRvZXNuJ3QgZGVwZW5kIG9uIHdoZXJlIHRoZVxuLy8gYmxvY2tzIHNpdCBpbiBnbG9iYWxPcmRlcjogYSBwaW5uZWQgcHJvcGVydHkgbmV2ZXIgYWxzbyBsYW5kcyBpbiB0aGUgVFlQXG4vLyBibG9jaywgYW5kIFwib3RoZXJcIiBvbmx5IGV2ZXIgaG9sZHMgdHJ1ZSBsZWZ0b3ZlcnMuXG5mdW5jdGlvbiBjb21wdXRlU29ydGVkS2V5cyhleGlzdGluZ0tleXMsIGdsb2JhbE9yZGVyLCB0eXBEZWZhdWx0S2V5cykge1xuICBjb25zdCBsb3dlclRvQWN0dWFsID0gbmV3IE1hcChleGlzdGluZ0tleXMubWFwKChrZXkpID0+IFtrZXkudG9Mb3dlckNhc2UoKSwga2V5XSkpO1xuICBjb25zdCByZXNvbHZlID0gKG5hbWUpID0+IGxvd2VyVG9BY3R1YWwuZ2V0KG5hbWUudG9Mb3dlckNhc2UoKSk7XG5cbiAgY29uc3QgcGlubmVkID0gbmV3IFNldChcbiAgICBnbG9iYWxPcmRlclxuICAgICAgLmZpbHRlcigoZW50cnkpID0+IGVudHJ5LmtpbmQgPT09IFwicHJvcGVydHlcIilcbiAgICAgIC5tYXAoKGVudHJ5KSA9PiByZXNvbHZlKGVudHJ5Lm5hbWUpKVxuICAgICAgLmZpbHRlcihCb29sZWFuKVxuICApO1xuICBjb25zdCB0eXBLZXkgPSByZXNvbHZlKFRZUF9QUk9QRVJUWSk7XG4gIGNvbnN0IHN1YnR5cEtleSA9IHJlc29sdmUoU1VCVFlQX1BST1BFUlRZKTtcbiAgY29uc3QgdHlwQmxvY2tLZXlzID0gbmV3IFNldChcbiAgICAodHlwRGVmYXVsdEtleXMgPz8gW10pLm1hcChyZXNvbHZlKS5maWx0ZXIoKGtleSkgPT4ga2V5ICYmIGtleSAhPT0gdHlwS2V5ICYmICFwaW5uZWQuaGFzKGtleSkpXG4gICk7XG4gIGNvbnN0IGNsYWltZWQgPSBuZXcgU2V0KHBpbm5lZCk7XG4gIGZvciAoY29uc3Qga2V5IG9mIHR5cEJsb2NrS2V5cykgY2xhaW1lZC5hZGQoa2V5KTtcbiAgaWYgKHR5cEtleSkgY2xhaW1lZC5hZGQodHlwS2V5KTtcbiAgaWYgKHN1YnR5cEtleSkgY2xhaW1lZC5hZGQoc3VidHlwS2V5KTtcblxuICBjb25zdCBzb3J0ZWRLZXlzID0gW107XG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0KCk7XG4gIGNvbnN0IHB1c2ggPSAoa2V5KSA9PiB7XG4gICAgaWYgKGtleSAmJiAhc2Vlbi5oYXMoa2V5KSkge1xuICAgICAgc29ydGVkS2V5cy5wdXNoKGtleSk7XG4gICAgICBzZWVuLmFkZChrZXkpO1xuICAgIH1cbiAgfTtcblxuICBmb3IgKGNvbnN0IGVudHJ5IG9mIGdsb2JhbE9yZGVyKSB7XG4gICAgaWYgKGVudHJ5LmtpbmQgPT09IFwicHJvcGVydHlcIikgcHVzaChyZXNvbHZlKGVudHJ5Lm5hbWUpKTtcbiAgICBlbHNlIGlmIChlbnRyeS5raW5kID09PSBcInR5cFZhbHVlXCIpIHB1c2godHlwS2V5KTtcbiAgICBlbHNlIGlmIChlbnRyeS5raW5kID09PSBcInN1YnR5cFZhbHVlXCIpIHB1c2goc3VidHlwS2V5KTtcbiAgICBlbHNlIGlmIChlbnRyeS5raW5kID09PSBcInR5cFwiKSB7XG4gICAgICBmb3IgKGNvbnN0IG5hbWUgb2YgdHlwRGVmYXVsdEtleXMgPz8gW10pIHtcbiAgICAgICAgY29uc3Qga2V5ID0gcmVzb2x2ZShuYW1lKTtcbiAgICAgICAgaWYgKGtleSAmJiB0eXBCbG9ja0tleXMuaGFzKGtleSkpIHB1c2goa2V5KTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwib3RoZXJcIikge1xuICAgICAgZm9yIChjb25zdCBrZXkgb2YgZXhpc3RpbmdLZXlzKSB7XG4gICAgICAgIGlmICghY2xhaW1lZC5oYXMoa2V5KSkgcHVzaChrZXkpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIFNhZmV0eSBuZXQgZm9yIGFuIGluY29tcGxldGUgZ2xvYmFsT3JkZXIgKGNvcnJ1cHQgc2V0dGluZ3MpLlxuICBmb3IgKGNvbnN0IGtleSBvZiBleGlzdGluZ0tleXMpIHB1c2goa2V5KTtcbiAgcmV0dXJuIHNvcnRlZEtleXM7XG59XG5cbi8vIFwicG9zaXRpb25cIiBpcyBPYnNpZGlhbidzIGxvY2F0aW9uIG9mIHRoZSBmcm9udG1hdHRlciBibG9jaywgcHJlc2VudCBvbmx5IGluXG4vLyB0aGUgY2FjaGUgb2JqZWN0LCBub3QgYSBwcm9wZXJ0eS5cbmZ1bmN0aW9uIGNhY2hlZEZyb250bWF0dGVyS2V5cyhhcHAsIGZpbGUpIHtcbiAgY29uc3QgZnJvbnRtYXR0ZXIgPSBhcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyO1xuICBpZiAoIWZyb250bWF0dGVyKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIE9iamVjdC5rZXlzKGZyb250bWF0dGVyKS5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBcInBvc2l0aW9uXCIpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzb3J0RmlsZUZyb250bWF0dGVyKGFwcCwgZmlsZSwgZ2xvYmFsT3JkZXIsIHR5cERlZmF1bHRLZXlzKSB7XG4gIC8vIENoZWFwIHByZS1jaGVjayBhZ2FpbnN0IHRoZSBpbi1tZW1vcnkgY2FjaGU6IG1vc3Qgbm90ZXMgYXJlIGFscmVhZHlcbiAgLy8gc29ydGVkLCBhbmQgdGhpcyBza2lwcyBvcGVuaW5nIHRoZW0gYXQgYWxsIC0gdGhhdCBpcyB3aGVyZSByZXBlYXRlZCB2YXVsdFxuICAvLyBydW5zIGdldCB0aGVpciBzcGVlZC4gcHJvY2Vzc0Zyb250TWF0dGVyIHN0YXlzIHRoZSBzb3VyY2Ugb2YgdHJ1dGggZm9yIHRoZVxuICAvLyBhY3R1YWwgd3JpdGUsIHNpbmNlIHRoZSBjYWNoZSBjYW4gbGFnIGJlaGluZC5cbiAgY29uc3QgY2FjaGVkS2V5cyA9IGNhY2hlZEZyb250bWF0dGVyS2V5cyhhcHAsIGZpbGUpO1xuICBpZiAoIWNhY2hlZEtleXMgfHwgY2FjaGVkS2V5cy5sZW5ndGggPD0gMSkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBjYWNoZWRTb3J0ZWQgPSBjb21wdXRlU29ydGVkS2V5cyhjYWNoZWRLZXlzLCBnbG9iYWxPcmRlciwgdHlwRGVmYXVsdEtleXMpO1xuICBpZiAoY2FjaGVkU29ydGVkLmV2ZXJ5KChrZXksIGkpID0+IGtleSA9PT0gY2FjaGVkS2V5c1tpXSkpIHJldHVybiBmYWxzZTtcblxuICBsZXQgY2hhbmdlZCA9IGZhbHNlO1xuICBhd2FpdCBhcHAuZmlsZU1hbmFnZXIucHJvY2Vzc0Zyb250TWF0dGVyKGZpbGUsIChmcm9udG1hdHRlcikgPT4ge1xuICAgIGNoYW5nZWQgPSBzb3J0RnJvbnRtYXR0ZXJPYmplY3QoZnJvbnRtYXR0ZXIsIGdsb2JhbE9yZGVyLCB0eXBEZWZhdWx0S2V5cyk7XG4gIH0pO1xuICByZXR1cm4gY2hhbmdlZDtcbn1cblxuLy8gU29ydHMgdGhlIHByb2Nlc3NGcm9udE1hdHRlciBvYmplY3QgaW4gcGxhY2U6IGluc2VydGlvbiBvcmRlciBiZWNvbWVzIHRoZVxuLy8gWUFNTCBvcmRlciwgc28gYWxsIGtleXMgYXJlIGRlbGV0ZWQgYW5kIHJlLWFkZGVkLiBSZXR1cm5zIHRydWUgb24gYSBjaGFuZ2UuXG5mdW5jdGlvbiBzb3J0RnJvbnRtYXR0ZXJPYmplY3QoZnJvbnRtYXR0ZXIsIGdsb2JhbE9yZGVyLCB0eXBEZWZhdWx0S2V5cykge1xuICBjb25zdCBleGlzdGluZ0tleXMgPSBPYmplY3Qua2V5cyhmcm9udG1hdHRlcik7XG4gIGlmIChleGlzdGluZ0tleXMubGVuZ3RoIDw9IDEpIHJldHVybiBmYWxzZTtcblxuICBjb25zdCBzb3J0ZWRLZXlzID0gY29tcHV0ZVNvcnRlZEtleXMoZXhpc3RpbmdLZXlzLCBnbG9iYWxPcmRlciwgdHlwRGVmYXVsdEtleXMpO1xuICBpZiAoc29ydGVkS2V5cy5ldmVyeSgoa2V5LCBpKSA9PiBrZXkgPT09IGV4aXN0aW5nS2V5c1tpXSkpIHJldHVybiBmYWxzZTtcblxuICBjb25zdCBzbmFwc2hvdCA9IHsgLi4uZnJvbnRtYXR0ZXIgfTtcbiAgZm9yIChjb25zdCBrZXkgb2YgZXhpc3RpbmdLZXlzKSBkZWxldGUgZnJvbnRtYXR0ZXJba2V5XTtcbiAgZm9yIChjb25zdCBrZXkgb2Ygc29ydGVkS2V5cykgZnJvbnRtYXR0ZXJba2V5XSA9IHNuYXBzaG90W2tleV07XG4gIHJldHVybiB0cnVlO1xufVxuXG4vLyBGb3IgY2FsbGVycyBhbHJlYWR5IGluc2lkZSBwcm9jZXNzRnJvbnRNYXR0ZXIgKFRZUC5qcyk6IFRZUCBhbmQgU3VidHlwIGFyZVxuLy8gcGFzc2VkIGV4cGxpY2l0bHksIGJlY2F1c2UgaW5kZXggYW5kIGNhY2hlIGRvbid0IGtub3cgdGhlIHZhbHVlcyBqdXN0XG4vLyB3cml0dGVuIHlldC5cbmZ1bmN0aW9uIHNvcnRGcm9udG1hdHRlckZvcihwbHVnaW4sIGZyb250bWF0dGVyLCB0eXAsIHN1YnR5cCkge1xuICBjb25zdCBnbG9iYWxPcmRlciA9IG5vcm1hbGl6ZUdsb2JhbE9yZGVyKHBsdWdpbi5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyKTtcbiAgcmV0dXJuIHNvcnRGcm9udG1hdHRlck9iamVjdChmcm9udG1hdHRlciwgZ2xvYmFsT3JkZXIsIG9yZGVyZWREZWZhdWx0S2V5cyhwbHVnaW4sIHR5cCwgc3VidHlwKSk7XG59XG5cbi8vIE1vdmVzIG9ubHkgYGtleWAgdG8gaXRzIHNvcnRlZCBwbGFjZSBhbmQgbGVhdmVzIGV2ZXJ5IG90aGVyIGtleSB3aGVyZSBpdCBpc1xuLy8gLSBmb3IgY2FsbGVycyB0aGF0IGp1c3QgYWRkZWQgYSBwcm9wZXJ0eSAoRnJlZCdzIHByb3BlcnR5IGJhY2tsaW5raW5nKSBhbmRcbi8vIHNob3VsZG4ndCByZXNodWZmbGUgYSBkZWxpYmVyYXRlbHkgZGlmZmVyZW50IG9yZGVyLiBUWVAvU1VCVFlQIGFyZSByZWFkIGZyb21cbi8vIHRoZSBvYmplY3QgaXRzZWxmOyBpbmRleCBhbmQgY2FjaGUgbWF5IHN0aWxsIGJlIGJlaGluZC5cbi8vXG4vLyBUaGUgcGxhY2UgaXMgcmlnaHQgYWZ0ZXIga2V5J3MgbmVhcmVzdCBwcmVkZWNlc3NvciBpbiB0aGUgZnVsbHkgc29ydGVkXG4vLyBvcmRlciAoZmlyc3QgaWYgdGhlcmUgaXMgbm9uZSkuIFJldHVybnMgdHJ1ZSBvbiBhIGNoYW5nZS5cbmZ1bmN0aW9uIHBsYWNlUHJvcGVydHlGb3IocGx1Z2luLCBmcm9udG1hdHRlciwga2V5KSB7XG4gIGNvbnN0IGV4aXN0aW5nS2V5cyA9IE9iamVjdC5rZXlzKGZyb250bWF0dGVyKTtcbiAgY29uc3QgYWN0dWFsS2V5ID0gZXhpc3RpbmdLZXlzLmZpbmQoKGspID0+IGsudG9Mb3dlckNhc2UoKSA9PT0ga2V5LnRvTG93ZXJDYXNlKCkpO1xuICBpZiAoIWFjdHVhbEtleSB8fCBleGlzdGluZ0tleXMubGVuZ3RoIDw9IDEpIHJldHVybiBmYWxzZTtcblxuICBjb25zdCBnbG9iYWxPcmRlciA9IG5vcm1hbGl6ZUdsb2JhbE9yZGVyKHBsdWdpbi5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyKTtcbiAgY29uc3QgdHlwID0gdHlwS2V5T2YocHJvcGVydHlWYWx1ZShmcm9udG1hdHRlciwgVFlQX1BST1BFUlRZKSk7XG4gIGNvbnN0IHN1YnR5cCA9IHR5cEtleU9mKHByb3BlcnR5VmFsdWUoZnJvbnRtYXR0ZXIsIFNVQlRZUF9QUk9QRVJUWSkpO1xuICBjb25zdCBzb3J0ZWRLZXlzID0gY29tcHV0ZVNvcnRlZEtleXMoZXhpc3RpbmdLZXlzLCBnbG9iYWxPcmRlciwgb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgdHlwLCBzdWJ0eXApKTtcblxuICBjb25zdCByZXN0ID0gZXhpc3RpbmdLZXlzLmZpbHRlcigoaykgPT4gayAhPT0gYWN0dWFsS2V5KTtcbiAgY29uc3QgcHJlZGVjZXNzb3IgPSBzb3J0ZWRLZXlzLnNsaWNlKDAsIHNvcnRlZEtleXMuaW5kZXhPZihhY3R1YWxLZXkpKS5wb3AoKTtcbiAgY29uc3QgbmV3S2V5cyA9IFsuLi5yZXN0XTtcbiAgbmV3S2V5cy5zcGxpY2UocHJlZGVjZXNzb3IgPT09IHVuZGVmaW5lZCA/IDAgOiByZXN0LmluZGV4T2YocHJlZGVjZXNzb3IpICsgMSwgMCwgYWN0dWFsS2V5KTtcbiAgaWYgKG5ld0tleXMuZXZlcnkoKGssIGkpID0+IGsgPT09IGV4aXN0aW5nS2V5c1tpXSkpIHJldHVybiBmYWxzZTtcblxuICBjb25zdCBzbmFwc2hvdCA9IHsgLi4uZnJvbnRtYXR0ZXIgfTtcbiAgZm9yIChjb25zdCBrIG9mIGV4aXN0aW5nS2V5cykgZGVsZXRlIGZyb250bWF0dGVyW2tdO1xuICBmb3IgKGNvbnN0IGsgb2YgbmV3S2V5cykgZnJvbnRtYXR0ZXJba10gPSBzbmFwc2hvdFtrXTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNvcnRTaW5nbGVGaWxlRnJvbnRtYXR0ZXIoYXBwLCBwbHVnaW4sIGZpbGUpIHtcbiAgY29uc3QgZ2xvYmFsT3JkZXIgPSBub3JtYWxpemVHbG9iYWxPcmRlcihwbHVnaW4uc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcik7XG4gIC8vIEFuIHVuY2xlYW4gVFlQIHZhbHVlIChsaXN0LCBwYWRkZWQpIGhhcyBubyBUWVAtRnJvbnRtYXR0ZXI7IG9ubHkgdGhlIGdsb2JhbFxuICAvLyBvcmRlciBhcHBsaWVzIHRoZW4gKHNlZSB0eXBLZXlPZiBpbiB0eXAtaW5kZXguanMpLlxuICBjb25zdCB0eXAgPSBwbHVnaW4udHlwSW5kZXgudHlwT2YoZmlsZSk7XG4gIGNvbnN0IHR5cERlZmF1bHRLZXlzID0gb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgdHlwLCBwbHVnaW4udHlwSW5kZXguc3VidHlwT2YoZmlsZSkpO1xuICByZXR1cm4gc29ydEZpbGVGcm9udG1hdHRlcihhcHAsIGZpbGUsIGdsb2JhbE9yZGVyLCB0eXBEZWZhdWx0S2V5cyk7XG59XG5cbi8vIG9ubHlUeXAgKG9wdGlvbmFsKSBsaW1pdHMgdGhlIHJ1biB0byBub3RlcyBvZiB0aGF0IFRZUC4gV2l0aG91dCBpdCBldmVyeVxuLy8gbm90ZSBpcyBjaGVja2VkLCBpbmNsdWRpbmcgbm90ZXMgd2l0aG91dCBhIFRZUDogcGlubmVkIHByb3BlcnRpZXMgc3VjaCBhc1xuLy8gY3NzY2xhc3NlcyBhcHBseSByZWdhcmRsZXNzIG9mIFRZUC5cbmFzeW5jIGZ1bmN0aW9uIHNvcnRBbGxGcm9udG1hdHRlcihhcHAsIHBsdWdpbiwgb25seVR5cCkge1xuICBsZXQgY2hlY2tlZCA9IDA7XG4gIGxldCBjaGFuZ2VkID0gMDtcbiAgY29uc3QgZ2xvYmFsT3JkZXIgPSBub3JtYWxpemVHbG9iYWxPcmRlcihwbHVnaW4uc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcik7XG4gIC8vIE9ubHkgbWVhbmluZ2Z1bCBmb3IgYSBzaW5nbGUgVFlQOiBsZXRzIHRoZSBjb21tYW5kIGV4cGxhaW4gYSBydW4gdGhhdFxuICAvLyBjaGFuZ2VkIG5vdGhpbmcgYmVjYXVzZSB0aGUgVFlQIGhhcyBubyBUWVAtRnJvbnRtYXR0ZXIuXG4gIGNvbnN0IGhhc1R5cERlZmF1bHRzID0gb25seVR5cCA/IG9yZGVyZWREZWZhdWx0S2V5cyhwbHVnaW4sIG9ubHlUeXApICE9PSBudWxsIDogbnVsbDtcblxuICBmb3IgKGNvbnN0IGZpbGUgb2YgYXBwLnZhdWx0LmdldE1hcmtkb3duRmlsZXMoKSkge1xuICAgIGlmICghcGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXMgJiYgYXBwLm1ldGFkYXRhQ2FjaGUuaXNVc2VySWdub3JlZChmaWxlLnBhdGgpKSBjb250aW51ZTtcblxuICAgIGNvbnN0IHR5cCA9IHBsdWdpbi50eXBJbmRleC50eXBPZihmaWxlKTtcbiAgICBpZiAob25seVR5cCAmJiB0eXAgIT09IG9ubHlUeXApIGNvbnRpbnVlO1xuXG4gICAgY29uc3QgdHlwRGVmYXVsdEtleXMgPSBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCB0eXAsIHBsdWdpbi50eXBJbmRleC5zdWJ0eXBPZihmaWxlKSk7XG4gICAgY2hlY2tlZCsrO1xuICAgIGlmIChhd2FpdCBzb3J0RmlsZUZyb250bWF0dGVyKGFwcCwgZmlsZSwgZ2xvYmFsT3JkZXIsIHR5cERlZmF1bHRLZXlzKSkgY2hhbmdlZCsrO1xuICB9XG5cbiAgcmV0dXJuIHsgY2hlY2tlZCwgY2hhbmdlZCwgaGFzVHlwRGVmYXVsdHMgfTtcbn1cblxuLy8gU29ydHMgZXZlcnkgbm90ZSBvZiBvbmUgVFlQIGFuZCByZXBvcnRzIGl0IGluIGEgbm90aWNlIC0gdGhlIGNvbW1hbmQgXCJTb3J0XG4vLyBmcm9udG1hdHRlciBmb3Igb25lIFRZUFwiIChhZnRlciBpdHMgcGlja2VyKSBhbmQgdGhlIFRZUC1QYW5lJ3MgY29udGV4dCBtZW51XG4vLyAod2l0aCB0aGUgVFlQIG9mIHRoZSByb3cpLlxuYXN5bmMgZnVuY3Rpb24gc29ydFR5cEZyb250bWF0dGVyKHBsdWdpbiwgdHlwKSB7XG4gIGNvbnN0IHsgY2hlY2tlZCwgY2hhbmdlZCwgaGFzVHlwRGVmYXVsdHMgfSA9IGF3YWl0IHNvcnRBbGxGcm9udG1hdHRlcihwbHVnaW4uYXBwLCBwbHVnaW4sIHR5cCk7XG4gIGxldCBtZXNzYWdlID0gc29ydFN1bW1hcnkoYEZyb250bWF0dGVyIHNvcnRpbmcgJHt0eXB9YCwgY2hlY2tlZCwgY2hhbmdlZCk7XG4gIC8vIE5vdCBhbiBlcnJvciwgYnV0IGV4cGxhaW5zIHdoeSBub3RoaW5nIG1heSBoYXZlIGNoYW5nZWQuXG4gIGlmIChoYXNUeXBEZWZhdWx0cyA9PT0gZmFsc2UpIHtcbiAgICBtZXNzYWdlICs9IGAgTm90ZTogJHt0eXB9IGhhcyBubyBUWVAtRnJvbnRtYXR0ZXIsIHNvIG9ubHkgdGhlIGdsb2JhbCBvcmRlciB3YXMgYXBwbGllZC5gO1xuICB9XG4gIG5ldyBOb3RpY2UobWVzc2FnZSk7XG59XG5cbi8vIFJlc3VsdCBub3RpY2Ugb2YgYSBzb3J0aW5nIHJ1biwgc2hhcmVkIGJ5IHRoZSBjb21tYW5kcyBhbmQgdGhlIHBsYXkgYnV0dG9uXG4vLyBvZiB0aGUgZ2xvYmFsIG9yZGVyLlxuZnVuY3Rpb24gc29ydFN1bW1hcnkobGFiZWwsIGNoZWNrZWQsIGNoYW5nZWQpIHtcbiAgcmV0dXJuIGNoYW5nZWQgPiAwXG4gICAgPyBgJHtsYWJlbH06IGNoZWNrZWQgJHtwbHVyYWwoY2hlY2tlZCwgXCJub3RlXCIpfSwgc29ydGVkICR7Y2hhbmdlZH0uYFxuICAgIDogYCR7bGFiZWx9OiBjaGVja2VkICR7cGx1cmFsKGNoZWNrZWQsIFwibm90ZVwiKX0sIGFsbCBhbHJlYWR5IHNvcnRlZC5gO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgc29ydEFsbEZyb250bWF0dGVyLFxuICBzb3J0U2luZ2xlRmlsZUZyb250bWF0dGVyLFxuICBzb3J0VHlwRnJvbnRtYXR0ZXIsXG4gIHNvcnRGcm9udG1hdHRlckZvcixcbiAgcGxhY2VQcm9wZXJ0eUZvcixcbiAgbm9ybWFsaXplR2xvYmFsT3JkZXIsXG4gIHNvcnRTdW1tYXJ5LFxuICBERUZBVUxUX0dMT0JBTF9PUkRFUixcbiAgVFlQX1BST1BFUlRZLFxuICBTVUJUWVBfUFJPUEVSVFksXG59O1xuIiwgImNvbnN0IHsgc2V0SWNvbiwgTm90aWNlIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IFRZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZLCBzb3J0QWxsRnJvbnRtYXR0ZXIsIHNvcnRTdW1tYXJ5IH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1zb3J0XCIpO1xuXG4vLyBMYWJlbHMgb2YgdGhlIGZvdXIgcGxhY2Vob2xkZXIgcm93czsgY29tcHV0ZVNvcnRlZEtleXMgaW4gZnJvbnRtYXR0ZXItc29ydC5qc1xuLy8gcmVzb2x2ZXMgd2hhdCBlYWNoIG9uZSBzdGFuZHMgZm9yLlxuY29uc3QgUExBQ0VIT0xERVJfTEFCRUxTID0ge1xuICB0eXBWYWx1ZTogXCJUWVBcIixcbiAgc3VidHlwVmFsdWU6IFwiU1VCVFlQXCIsXG4gIHR5cDogXCJUWVAtRnJvbnRtYXR0ZXJcIixcbiAgb3RoZXI6IFwiT3RoZXIgcHJvcGVydGllc1wiLFxufTtcblxuLy8gRWRpdG9yIGZvciBzZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyOiBhIHBsYWluIGxpc3Qgb2YgbmFtZXMgd2l0aCBkcmFnICZcbi8vIGRyb3AuIEl0IGhvbGRzIG5vIHZhbHVlcywgc28gdW5saWtlIHR5cC1mcm9udG1hdHRlci1lZGl0b3IuanMgaXQgbmVlZHMgbm9cbi8vIGRldG91ciB0aHJvdWdoIE9ic2lkaWFuJ3MgcHJpdmF0ZSBwcm9wZXJ0eSB3aWRnZXQuIFRoZSBwbGFjZWhvbGRlciByb3dzIGNhblxuLy8gYmUgbW92ZWQgYnV0IG5vdCByZW1vdmVkLlxuZnVuY3Rpb24gbW91bnRHbG9iYWxPcmRlckVkaXRvcihjb250YWluZXJFbCwgcGx1Z2luKSB7XG4gIGNvbnN0IGhlYWRlciA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZnJvbnRtYXR0ZXItaGVhZGVyXCIgfSk7XG5cbiAgLy8gQnV0dG9uIGFuZCB0aXRsZSBzaGFyZSBhIGdyb3VwOiB0aGUgaGVhZGVyIHVzZXMgc3BhY2UtYmV0d2Vlbiwgc28gYSB0aGlyZFxuICAvLyBkaXJlY3QgY2hpbGQgd291bGQgZmxvYXQgaW4gdGhlIG1pZGRsZSBpbnN0ZWFkIG9mIG5leHQgdG8gdGhlIHRpdGxlLlxuICBjb25zdCB0aXRsZUdyb3VwID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZnJvbnRtYXR0ZXItdGl0bGUtZ3JvdXBcIiB9KTtcblxuICAvLyBTYW1lIHJ1biBhcyB0aGUgXCJTb3J0IGZyb250bWF0dGVyIGluIGFsbCBub3Rlc1wiIGNvbW1hbmQuXG4gIGNvbnN0IGFwcGx5QnRuID0gdGl0bGVHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb25cIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJBcHBseSB0byBhbGwgbm90ZXNcIiB9IH0pO1xuICBzZXRJY29uKGFwcGx5QnRuLCBcInBsYXlcIik7XG4gIGFwcGx5QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHsgY2hlY2tlZCwgY2hhbmdlZCB9ID0gYXdhaXQgc29ydEFsbEZyb250bWF0dGVyKHBsdWdpbi5hcHAsIHBsdWdpbiwgbnVsbCk7XG4gICAgICBuZXcgTm90aWNlKHNvcnRTdW1tYXJ5KFwiRnJvbnRtYXR0ZXIgc29ydGluZ1wiLCBjaGVja2VkLCBjaGFuZ2VkKSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJbRnJvbnRtYXR0ZXIgc29ydGluZ11cIiwgZXJyb3IpO1xuICAgICAgbmV3IE5vdGljZShgRnJvbnRtYXR0ZXIgc29ydGluZyBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICB9XG4gIH0pO1xuXG4gIHRpdGxlR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1kZXRhaWwtc2VjdGlvbi10aXRsZVwiLCB0ZXh0OiBcIkdsb2JhbCBwcm9wZXJ0eSBvcmRlclwiIH0pO1xuXG4gIGNvbnN0IGFkZEJ0biA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb25cIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJBZGQgcHJvcGVydHlcIiB9IH0pO1xuICBzZXRJY29uKGFkZEJ0biwgXCJwbHVzXCIpO1xuXG4gIGNvbnN0IGxpc3RFbCA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtb3JkZXItbGlzdFwiIH0pO1xuXG4gIGNvbnN0IG9yZGVyID0gKCkgPT4gcGx1Z2luLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXI7XG5cbiAgLy8gQSBuZXcgcm93IG9ubHkgam9pbnMgZ2xvYmFsUHJvcGVydHlPcmRlciBvbmNlIGl0IGhhcyBhIHZhbGlkIG5hbWUuIFVudGlsXG4gIC8vIHRoZW4gaXQgaXMgYSBsb2NhbCBkcmFmdCBhcHBlbmRlZCBvbiByZW5kZXIsIHNvIGFuIGVtcHR5IG5hbWUgbmV2ZXIgZW5kc1xuICAvLyB1cCBpbiB0aGUgc2V0dGluZ3MsIGV2ZW4gaWYgc29tZXRoaW5nIGVsc2Ugc2F2ZXMgaW4gYmV0d2Vlbi5cbiAgbGV0IGRyYWZ0RW50cnkgPSBudWxsO1xuXG4gIGNvbnN0IGlzRHVwbGljYXRlTmFtZSA9ICh2YWx1ZSwgb3duRW50cnkpID0+IHtcbiAgICBjb25zdCBsb3dlciA9IHZhbHVlLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKGxvd2VyID09PSBUWVBfUFJPUEVSVFkudG9Mb3dlckNhc2UoKSB8fCBsb3dlciA9PT0gU1VCVFlQX1BST1BFUlRZLnRvTG93ZXJDYXNlKCkpIHJldHVybiB0cnVlO1xuICAgIHJldHVybiBvcmRlcigpLnNvbWUoKG90aGVyKSA9PiBvdGhlciAhPT0gb3duRW50cnkgJiYgb3RoZXIua2luZCA9PT0gXCJwcm9wZXJ0eVwiICYmIG90aGVyLm5hbWUudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXIpO1xuICB9O1xuXG4gIGNvbnN0IHJlbmRlciA9ICgpID0+IHtcbiAgICBsaXN0RWwuZW1wdHkoKTtcbiAgICBjb25zdCBlbnRyaWVzID0gZHJhZnRFbnRyeSA/IFsuLi5vcmRlcigpLCBkcmFmdEVudHJ5XSA6IG9yZGVyKCk7XG5cbiAgICBlbnRyaWVzLmZvckVhY2goKGVudHJ5LCBpbmRleCkgPT4ge1xuICAgICAgY29uc3QgaXNEcmFmdCA9IGVudHJ5ID09PSBkcmFmdEVudHJ5O1xuICAgICAgY29uc3QgaXNQbGFjZWhvbGRlciA9IGVudHJ5LmtpbmQgIT09IFwicHJvcGVydHlcIjtcbiAgICAgIGNvbnN0IHJvd0NscyA9XG4gICAgICAgIFwidHlwLW9yZGVyLXJvd1wiICsgKGlzUGxhY2Vob2xkZXIgPyBcIiBpcy1wbGFjZWhvbGRlclwiIDogXCJcIikgKyAoZW50cnkua2luZCA9PT0gXCJ0eXBcIiA/IFwiIGlzLXR5cC1kZWZhdWx0c1wiIDogXCJcIik7XG4gICAgICBjb25zdCByb3cgPSBsaXN0RWwuY3JlYXRlRGl2KHsgY2xzOiByb3dDbHMgfSk7XG5cbiAgICAgIGNvbnN0IGRyYWdIYW5kbGUgPSByb3cuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1vcmRlci1kcmFnXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiRHJhZyB0byBtb3ZlXCIgfSB9KTtcbiAgICAgIHNldEljb24oZHJhZ0hhbmRsZSwgXCJncmlwLXZlcnRpY2FsXCIpO1xuXG4gICAgICBpZiAoaXNQbGFjZWhvbGRlcikge1xuICAgICAgICByb3cuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1vcmRlci1sYWJlbFwiLCB0ZXh0OiBQTEFDRUhPTERFUl9MQUJFTFNbZW50cnkua2luZF0gfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBpbnB1dCA9IHJvdy5jcmVhdGVFbChcImlucHV0XCIsIHtcbiAgICAgICAgICB0eXBlOiBcInRleHRcIixcbiAgICAgICAgICBjbHM6IFwidHlwLW9yZGVyLW5hbWUtaW5wdXRcIixcbiAgICAgICAgICBhdHRyOiB7IHBsYWNlaG9sZGVyOiBcIlByb3BlcnR5IG5hbWVcIiB9LFxuICAgICAgICB9KTtcbiAgICAgICAgaW5wdXQudmFsdWUgPSBlbnRyeS5uYW1lO1xuXG4gICAgICAgIC8vIFwiYmx1clwiLCBub3QgXCJjaGFuZ2VcIjogY2hhbmdlIGRvZXNuJ3QgZmlyZSBmb3IgYSBmaWVsZCBsZWZ0IGVtcHR5LCBzb1xuICAgICAgICAvLyB0aGUgZHJhZnQgd291bGQgbmV2ZXIgYmUgY2xlYW5lZCB1cC5cbiAgICAgICAgaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImJsdXJcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IHZhbHVlID0gaW5wdXQudmFsdWUudHJpbSgpO1xuXG4gICAgICAgICAgaWYgKCF2YWx1ZSkge1xuICAgICAgICAgICAgaWYgKGlzRHJhZnQpIHtcbiAgICAgICAgICAgICAgZHJhZnRFbnRyeSA9IG51bGw7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBvcmRlcigpLnNwbGljZShvcmRlcigpLmluZGV4T2YoZW50cnkpLCAxKTtcbiAgICAgICAgICAgICAgYXdhaXQgcGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVuZGVyKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGlzRHVwbGljYXRlTmFtZSh2YWx1ZSwgaXNEcmFmdCA/IG51bGwgOiBlbnRyeSkpIHtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoYFwiJHt2YWx1ZX1cIiBpcyBhbHJlYWR5IGluIHRoZSBsaXN0LmApO1xuICAgICAgICAgICAgaW5wdXQudmFsdWUgPSBlbnRyeS5uYW1lO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGVudHJ5Lm5hbWUgPSB2YWx1ZTtcbiAgICAgICAgICBpZiAoaXNEcmFmdCkge1xuICAgICAgICAgICAgb3JkZXIoKS5wdXNoKGVudHJ5KTtcbiAgICAgICAgICAgIGRyYWZ0RW50cnkgPSBudWxsO1xuICAgICAgICAgIH1cbiAgICAgICAgICBhd2FpdCBwbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgcmVuZGVyKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHJlbW92ZUJ0biA9IHJvdy5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLW9yZGVyLXJlbW92ZSBjbGlja2FibGUtaWNvblwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlJlbW92ZVwiIH0gfSk7XG4gICAgICAgIHNldEljb24ocmVtb3ZlQnRuLCBcInhcIik7XG4gICAgICAgIHJlbW92ZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGlmIChpc0RyYWZ0KSB7XG4gICAgICAgICAgICBkcmFmdEVudHJ5ID0gbnVsbDtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgb3JkZXIoKS5zcGxpY2Uob3JkZXIoKS5pbmRleE9mKGVudHJ5KSwgMSk7XG4gICAgICAgICAgICBhd2FpdCBwbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJlbmRlcigpO1xuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgLy8gQSBkcmFmdCBoYXMgbm8gcGxhY2UgaW4gdGhlIHJlYWwgbGlzdCB5ZXQsIHNvIGl0IGNhbid0IGJlIG1vdmVkLlxuICAgICAgaWYgKGlzRHJhZnQpIHJldHVybjtcblxuICAgICAgcm93LmRyYWdnYWJsZSA9IHRydWU7XG4gICAgICByb3cuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdzdGFydFwiLCAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQuZGF0YVRyYW5zZmVyLmVmZmVjdEFsbG93ZWQgPSBcIm1vdmVcIjtcbiAgICAgICAgZXZlbnQuZGF0YVRyYW5zZmVyLnNldERhdGEoXCJ0ZXh0L3BsYWluXCIsIFN0cmluZyhpbmRleCkpO1xuICAgICAgICByb3cuY2xhc3NMaXN0LmFkZChcImlzLWRyYWdnaW5nXCIpO1xuICAgICAgfSk7XG4gICAgICByb3cuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdlbmRcIiwgKCkgPT4gcm93LmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcmFnZ2luZ1wiKSk7XG4gICAgICByb3cuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdvdmVyXCIsIChldmVudCkgPT4ge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAvLyBVcHBlciBvciBsb3dlciBoYWxmIGRlY2lkZXMgYmVmb3JlL2FmdGVyIC0gb3RoZXJ3aXNlIG5vdGhpbmcgY291bGRcbiAgICAgICAgLy8gYmUgZHJvcHBlZCBiZWxvdyB0aGUgbGFzdCByb3cuXG4gICAgICAgIGNvbnN0IHJlY3QgPSByb3cuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICAgIGNvbnN0IGlzQWZ0ZXIgPSBldmVudC5jbGllbnRZIC0gcmVjdC50b3AgPiByZWN0LmhlaWdodCAvIDI7XG4gICAgICAgIHJvdy5jbGFzc0xpc3QudG9nZ2xlKFwiaXMtZHJvcC1iZWZvcmVcIiwgIWlzQWZ0ZXIpO1xuICAgICAgICByb3cuY2xhc3NMaXN0LnRvZ2dsZShcImlzLWRyb3AtYWZ0ZXJcIiwgaXNBZnRlcik7XG4gICAgICB9KTtcbiAgICAgIHJvdy5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ2xlYXZlXCIsICgpID0+IHJvdy5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJvcC1iZWZvcmVcIiwgXCJpcy1kcm9wLWFmdGVyXCIpKTtcbiAgICAgIHJvdy5hZGRFdmVudExpc3RlbmVyKFwiZHJvcFwiLCBhc3luYyAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgY29uc3QgaXNBZnRlciA9IHJvdy5jbGFzc0xpc3QuY29udGFpbnMoXCJpcy1kcm9wLWFmdGVyXCIpO1xuICAgICAgICByb3cuY2xhc3NMaXN0LnJlbW92ZShcImlzLWRyb3AtYmVmb3JlXCIsIFwiaXMtZHJvcC1hZnRlclwiKTtcblxuICAgICAgICBjb25zdCBmcm9tSW5kZXggPSBOdW1iZXIoZXZlbnQuZGF0YVRyYW5zZmVyLmdldERhdGEoXCJ0ZXh0L3BsYWluXCIpKTtcbiAgICAgICAgaWYgKE51bWJlci5pc05hTihmcm9tSW5kZXgpKSByZXR1cm47XG5cbiAgICAgICAgLy8gVGFyZ2V0IGluZGV4IGNvdW50ZWQgYmVmb3JlIGZyb21JbmRleCBpcyByZW1vdmVkLlxuICAgICAgICBsZXQgaW5zZXJ0QmVmb3JlID0gaXNBZnRlciA/IGluZGV4ICsgMSA6IGluZGV4O1xuICAgICAgICBpZiAoZnJvbUluZGV4IDwgaW5zZXJ0QmVmb3JlKSBpbnNlcnRCZWZvcmUgLT0gMTtcblxuICAgICAgICBjb25zdCBbbW92ZWRdID0gb3JkZXIoKS5zcGxpY2UoZnJvbUluZGV4LCAxKTtcbiAgICAgICAgb3JkZXIoKS5zcGxpY2UoaW5zZXJ0QmVmb3JlLCAwLCBtb3ZlZCk7XG4gICAgICAgIGF3YWl0IHBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgcmVuZGVyKCk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfTtcblxuICBhZGRCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICBpZiAoIWRyYWZ0RW50cnkpIHtcbiAgICAgIGRyYWZ0RW50cnkgPSB7IGtpbmQ6IFwicHJvcGVydHlcIiwgbmFtZTogXCJcIiB9O1xuICAgICAgcmVuZGVyKCk7XG4gICAgfVxuICAgIGNvbnN0IGlucHV0cyA9IGxpc3RFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLnR5cC1vcmRlci1uYW1lLWlucHV0XCIpO1xuICAgIGlucHV0c1tpbnB1dHMubGVuZ3RoIC0gMV0/LmZvY3VzKCk7XG4gIH0pO1xuXG4gIHJlbmRlcigpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgbW91bnRHbG9iYWxPcmRlckVkaXRvciB9O1xuIiwgImNvbnN0IHsgZ2V0U3VidHlwIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBzXCIpO1xuXG4vLyBDb2xvciBvZiBhIFRZUCB3aXRob3V0IGl0cyBvd24gY29sb3IuIExpdmVzIGhlcmUgYmVjYXVzZSBjb2RlIGJlbG93IHRoZVxuLy8gdmlldyBuZWVkcyBpdCAoc2VlIG5hbWVDb2xvcik7IHR5cC1wYW5lLmpzIHJlLWV4cG9ydHMgaXQuXG5jb25zdCBERUZBVUxUX1RZUF9DT0xPUiA9IFwiIzg4ODg4OFwiO1xuXG4vLyAtLS0gU3VidHlwIGNvbG9ycyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBBIFN1YnR5cCBzdG9yZXMgbm8gY29sb3IsIG9ubHkgYW4gb2Zmc2V0IGZyb20gaXRzIFRZUCdzIGNvbG9yXG4vLyAoc2V0dGluZ3MudHlwU3VidHlwc1tUWVBdW1NVQlRZUF0uY29sb3IgPSB7IGgsIGwgfSkuIFRoZSByZWFsIGNvbG9yIGlzXG4vLyBjb21wdXRlZCBmcm9tIHRoZSBjdXJyZW50IFRZUCBjb2xvciBldmVyeSB0aW1lLCBzbyB3aGVuIHRoYXQgY2hhbmdlcyBhbGxcbi8vIFN1YnR5cHMgZm9sbG93IGFuZCBzdGF5IGluIHRoZSBmYW1pbHkuXG4vLyBUaGUgbWF0aCBydW5zIGluIE9LTENILCB3aGVyZSBhIGxpZ2h0bmVzcyBjaGFuZ2UgbG9va3MgYWJvdXQgZXF1YWxseSBzdHJvbmdcbi8vIGFjcm9zcyBodWVzIChpbiBIU0wgeWVsbG93IHdvdWxkIGJlIGZhciBicmlnaHRlciB0aGFuIGJsdWUpLiBXaXRob3V0IGFuXG4vLyBvZmZzZXQgYSBTdWJ0eXAgaGFzIHRoZSBUWVAgY29sb3IuXG4vLyAgIGg6IGh1ZSwgc2hpZnRlZCBpbiBkZWdyZWVzO1xuLy8gICBsOiBsaWdodG5lc3MgYXMgJSBvZiB0aGUgd2F5IHRvIHdoaXRlICgrKSBvciBibGFjayAoLSkuXG4vLyBUaGUgYWxsb3dlZCByYW5nZSBpcyBhIHNldHRpbmcgKHNldHRpbmdzLnN1YnR5cENvbG9yUmFuZ2VzKTsgYSBsYXJnZXIgc3RvcmVkXG4vLyBvZmZzZXQgaXMgY2xhbXBlZCB0byBpdC5cbi8vXG4vLyBUaGlzIGxpc3QgaXMgdGhlIHNpbmdsZSBzb3VyY2UgZm9yIHRoZSBwb3BvdmVyIHNsaWRlcnMsIHRoZSBzZXR0aW5nIGxpbWl0c1xuLy8gYW5kIHRoZSBjbGFtcGluZzsgY29tbWVudGluZyBhIGNoYW5uZWwgb3V0IHJlbW92ZXMgaXQgZXZlcnl3aGVyZS5cbi8vXG4vLyBTYXR1cmF0aW9uIGlzIGRpc2FibGVkLiBJdCBvbmNlIGNvbXBlbnNhdGVkIGZvciBjaHJvbWEgdGhhdCBsaWdodG5lc3MgYW5kXG4vLyBodWUgdG9vayBhd2F5OyBzaW5jZSBib3RoIG5vdyBjYXJyeSBjaHJvbWEgYWxvbmcgKHNlZSBjb21wdXRlQ29sb3JPZmZzZXQpLFxuLy8gaXQgY291bGQgb25seSBzYXkgXCJ0aGlzIFN1YnR5cCBob2xkcyBiYWNrXCIsIG5vdCB3b3J0aCBhIHRoaXJkIHNsaWRlci4gVG9cbi8vIHJldml2ZSBpdCwgdW5jb21tZW50IGl0IGhlcmUsIGluIERFRkFVTFRfU1VCVFlQX0NPTE9SX1JBTkdFUywgaW5cbi8vIGNvbXB1dGVDb2xvck9mZnNldCBhbmQgYXQgcmFuZ2VNYXgvcmFuZ2VEZXNjIGluIHNldHRpbmdzLmpzLlxuLy8gZG93bk9ubHk6IHRoZSBzbGlkZXIgb25seSBnb2VzIGZyb20gLWxpbWl0IHRvIDAgLSBhIFN1YnR5cCBtYXkgaG9sZCBiYWNrIGJ1dFxuLy8gbmV2ZXIgYmUgbG91ZGVyIHRoYW4gaXRzIFRZUC5cbmNvbnN0IFNVQlRZUF9DT0xPUl9DSEFOTkVMUyA9IFtcbiAgeyBrZXk6IFwiaFwiLCBsYWJlbDogXCJIdWVcIiwgdW5pdDogXCJcdTAwQjBcIiB9LFxuICAvLyB7IGtleTogXCJzXCIsIGxhYmVsOiBcIlNhdHVyYXRpb25cIiwgdW5pdDogXCIlXCIsIGRvd25Pbmx5OiB0cnVlIH0sXG4gIHsga2V5OiBcImxcIiwgbGFiZWw6IFwiTGlnaHRuZXNzXCIsIHVuaXQ6IFwiJVwiIH0sXG5dO1xuLy8gU3VidHlwcyBzaG91bGQgYWJvdmUgYWxsIGJlIGRpc3Rpbmd1aXNoYWJsZTogaHVlIGNvbnRyaWJ1dGVzIG1vc3QgYW5kIGdldHNcbi8vIHRoZSB3aWRlc3QgcmFuZ2UsIGxpZ2h0bmVzcyBhcyB0aGUgc2Vjb25kIGNsZWFyIGF4aXMgZ2V0cyBwbGVudHkgdG9vLlxuY29uc3QgREVGQVVMVF9TVUJUWVBfQ09MT1JfUkFOR0VTID0geyBoOiAzNSwgLyogczogNDAsICovIGw6IDQwIH07XG5cbmZ1bmN0aW9uIGNvbG9yUmFuZ2Uoc2V0dGluZ3MsIGtleSkge1xuICBjb25zdCB2YWx1ZSA9IE51bWJlcihzZXR0aW5ncy5zdWJ0eXBDb2xvclJhbmdlcz8uW2tleV0pO1xuICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKHZhbHVlKSAmJiB2YWx1ZSA+PSAwID8gdmFsdWUgOiBERUZBVUxUX1NVQlRZUF9DT0xPUl9SQU5HRVNba2V5XTtcbn1cblxuLy8gU2xpZGVyIHJhbmdlIC0gb25lIHBsYWNlIGZvciBwb3BvdmVyLCBjbGFtcGluZyBhbmQgZ3JhZGllbnQgcHJldmlldyBzbyB0aGV5XG4vLyBjYW4ndCBkcmlmdCBhcGFydC5cbmZ1bmN0aW9uIGNoYW5uZWxCb3VuZHMoc2V0dGluZ3MsIGtleSkge1xuICBjb25zdCByYW5nZSA9IGNvbG9yUmFuZ2Uoc2V0dGluZ3MsIGtleSk7XG4gIHJldHVybiBTVUJUWVBfQ09MT1JfQ0hBTk5FTFMuZmluZCgoY2hhbm5lbCkgPT4gY2hhbm5lbC5rZXkgPT09IGtleSk/LmRvd25Pbmx5ID8gWy1yYW5nZSwgMF0gOiBbLXJhbmdlLCByYW5nZV07XG59XG5cbi8vIEEgU3VidHlwJ3Mgb2Zmc2V0LCBjbGFtcGVkIHRvIHRoZSBjb25maWd1cmVkIGxpbWl0cy5cbmZ1bmN0aW9uIGNsYW1wZWRPZmZzZXQoc2V0dGluZ3MsIG9mZnNldCkge1xuICBpZiAoIW9mZnNldCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHJlc3VsdCA9IHt9O1xuICBmb3IgKGNvbnN0IHsga2V5IH0gb2YgU1VCVFlQX0NPTE9SX0NIQU5ORUxTKSB7XG4gICAgY29uc3QgW21pbiwgbWF4XSA9IGNoYW5uZWxCb3VuZHMoc2V0dGluZ3MsIGtleSk7XG4gICAgcmVzdWx0W2tleV0gPSBNYXRoLm1pbihtYXgsIE1hdGgubWF4KG1pbiwgTnVtYmVyKG9mZnNldFtrZXldKSB8fCAwKSk7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuY29uc3QgdG9MaW5lYXIgPSAoYykgPT4gKGMgPD0gMC4wNDA0NSA/IGMgLyAxMi45MiA6ICgoYyArIDAuMDU1KSAvIDEuMDU1KSAqKiAyLjQpO1xuY29uc3QgdG9HYW1tYSA9IChjKSA9PiAoYyA8PSAwLjAwMzEzMDggPyAxMi45MiAqIGMgOiAxLjA1NSAqIGMgKiogKDEgLyAyLjQpIC0gMC4wNTUpO1xuXG5mdW5jdGlvbiBoZXhUb09rbGNoKGhleCkge1xuICBjb25zdCBtYXRjaCA9IC9eIz8oWzAtOWEtZl17Nn0pJC9pLmV4ZWMoaGV4ID8/IFwiXCIpO1xuICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgaW50ID0gcGFyc2VJbnQobWF0Y2hbMV0sIDE2KTtcbiAgY29uc3QgW3IsIGcsIGJdID0gWyhpbnQgPj4gMTYpICYgMjU1LCAoaW50ID4+IDgpICYgMjU1LCBpbnQgJiAyNTVdLm1hcCgoYykgPT4gdG9MaW5lYXIoYyAvIDI1NSkpO1xuICBjb25zdCBsID0gTWF0aC5jYnJ0KDAuNDEyMjIxNDcwOCAqIHIgKyAwLjUzNjMzMjUzNjMgKiBnICsgMC4wNTE0NDU5OTI5ICogYik7XG4gIGNvbnN0IG0gPSBNYXRoLmNicnQoMC4yMTE5MDM0OTgyICogciArIDAuNjgwNjk5NTQ1MSAqIGcgKyAwLjEwNzM5Njk1NjYgKiBiKTtcbiAgY29uc3QgcyA9IE1hdGguY2JydCgwLjA4ODMwMjQ2MTkgKiByICsgMC4yODE3MTg4Mzc2ICogZyArIDAuNjI5OTc4NzAwNSAqIGIpO1xuICBjb25zdCBMID0gMC4yMTA0NTQyNTUzICogbCArIDAuNzkzNjE3Nzg1ICogbSAtIDAuMDA0MDcyMDQ2OCAqIHM7XG4gIGNvbnN0IEEgPSAxLjk3Nzk5ODQ5NTEgKiBsIC0gMi40Mjg1OTIyMDUgKiBtICsgMC40NTA1OTM3MDk5ICogcztcbiAgY29uc3QgQiA9IDAuMDI1OTA0MDM3MSAqIGwgKyAwLjc4Mjc3MTc2NjIgKiBtIC0gMC44MDg2NzU3NjYgKiBzO1xuICByZXR1cm4geyBMLCBDOiBNYXRoLmh5cG90KEEsIEIpLCBIOiAoKE1hdGguYXRhbjIoQiwgQSkgKiAxODApIC8gTWF0aC5QSSArIDM2MCkgJSAzNjAgfTtcbn1cblxuLy8gTGluZWFyIHNSR0I7IGNoYW5uZWxzIG1heSBmYWxsIG91dHNpZGUgMC4uMSAob3V0IG9mIGdhbXV0KS5cbmZ1bmN0aW9uIG9rbGNoVG9MaW5lYXIoeyBMLCBDLCBIIH0pIHtcbiAgY29uc3QgQSA9IEMgKiBNYXRoLmNvcygoSCAqIE1hdGguUEkpIC8gMTgwKTtcbiAgY29uc3QgQiA9IEMgKiBNYXRoLnNpbigoSCAqIE1hdGguUEkpIC8gMTgwKTtcbiAgY29uc3QgbCA9IChMICsgMC4zOTYzMzc3Nzc0ICogQSArIDAuMjE1ODAzNzU3MyAqIEIpICoqIDM7XG4gIGNvbnN0IG0gPSAoTCAtIDAuMTA1NTYxMzQ1OCAqIEEgLSAwLjA2Mzg1NDE3MjggKiBCKSAqKiAzO1xuICBjb25zdCBzID0gKEwgLSAwLjA4OTQ4NDE3NzUgKiBBIC0gMS4yOTE0ODU1NDggKiBCKSAqKiAzO1xuICByZXR1cm4gW1xuICAgIDQuMDc2NzQxNjYyMSAqIGwgLSAzLjMwNzcxMTU5MTMgKiBtICsgMC4yMzA5Njk5MjkyICogcyxcbiAgICAtMS4yNjg0MzgwMDQ2ICogbCArIDIuNjA5NzU3NDAxMSAqIG0gLSAwLjM0MTMxOTM5NjUgKiBzLFxuICAgIC0wLjAwNDE5NjA4NjMgKiBsIC0gMC43MDM0MTg2MTQ3ICogbSArIDEuNzA3NjE0NzAxICogcyxcbiAgXTtcbn1cblxuY29uc3QgaW5HYW11dCA9IChyZ2IpID0+IHJnYi5ldmVyeSgoYykgPT4gYyA+PSAtMC4wMDAxICYmIGMgPD0gMS4wMDAxKTtcblxuLy8gTGFyZ2VzdCBjaHJvbWEgc1JHQiBjYW4gc2hvdyBhdCB0aGlzIGxpZ2h0bmVzcyBhbmQgaHVlLiBUaGUgbGltaXQgdmFyaWVzIGFcbi8vIGxvdCAocHVyZSB5ZWxsb3cgb25seSBjYXJyaWVzIG11Y2ggY2hyb21hIGp1c3QgYmVsb3cgd2hpdGUsIGJsdWUgaW4gdGhlXG4vLyBtaWRkbGUpLCB3aGljaCBpcyBleGFjdGx5IHdoZXJlIGFueSBtYXRoIGhvbGRpbmcgY2hyb21hIGFic29sdXRlIGJyZWFrcy5cbmZ1bmN0aW9uIG1heENocm9tYShMLCBIKSB7XG4gIGxldCBsb3cgPSAwO1xuICBsZXQgaGlnaCA9IDAuNDsgLy8gYWJvdmUgdGhlIHNSR0IgbWF4aW11bSAofjAuMzIpXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgMjA7IGkrKykge1xuICAgIGNvbnN0IG1pZCA9IChsb3cgKyBoaWdoKSAvIDI7XG4gICAgaWYgKGluR2FtdXQob2tsY2hUb0xpbmVhcih7IEwsIEM6IG1pZCwgSCB9KSkpIGxvdyA9IG1pZDtcbiAgICBlbHNlIGhpZ2ggPSBtaWQ7XG4gIH1cbiAgcmV0dXJuIGxvdztcbn1cblxuLy8gT3V0LW9mLWdhbXV0IGNvbG9ycyBsb3NlIGNocm9tYSB1bnRpbCB0aGV5IGZpdDsgaHVlIGFuZCBsaWdodG5lc3Mgc3RheS5cbi8vIEZvciBhcHBseUNvbG9yT2Zmc2V0IG9ubHkgYSBzYWZldHkgbmV0LCBzaW5jZSBjaHJvbWEgaXMgYWxyZWFkeSBhIHNoYXJlIG9mXG4vLyB0aGUgZGlzcGxheWFibGUgbWF4aW11bSB0aGVyZS5cbmZ1bmN0aW9uIG9rbGNoVG9IZXgoY29sb3IpIHtcbiAgbGV0IHJnYiA9IG9rbGNoVG9MaW5lYXIoY29sb3IpO1xuICBpZiAoIWluR2FtdXQocmdiKSkgcmdiID0gb2tsY2hUb0xpbmVhcih7IC4uLmNvbG9yLCBDOiBtYXhDaHJvbWEoY29sb3IuTCwgY29sb3IuSCkgfSk7XG4gIHJldHVybiAoXG4gICAgXCIjXCIgK1xuICAgIHJnYlxuICAgICAgLm1hcCgoYykgPT4gTWF0aC5yb3VuZChNYXRoLm1pbigxLCBNYXRoLm1heCgwLCB0b0dhbW1hKE1hdGgubWluKDEsIE1hdGgubWF4KDAsIGMpKSkpKSAqIDI1NSkpXG4gICAgICAubWFwKChjKSA9PiBjLnRvU3RyaW5nKDE2KS5wYWRTdGFydCgyLCBcIjBcIikpXG4gICAgICAuam9pbihcIlwiKVxuICApO1xufVxuXG4vLyBMaWdodG5lc3Mgb2YgYSBodWUncyBjdXNwLCB3aGVyZSBpdCBjYXJyaWVzIHRoZSBtb3N0IGNocm9tYS4gbWF4Q2hyb21hIHJpc2VzXG4vLyB1cCB0byBpdCBhbmQgZmFsbHMgYWZ0ZXIsIHNvIHRoZSBwZWFrIGNhbiBiZSBuYXJyb3dlZCBkb3duLiBPbmUgdmFsdWUgcGVyXG4vLyBodWUgYW5kIHRoZSBzZWFyY2ggaXMgY29zdGx5LCBzbyBpdCBpcyBjYWNoZWQgcGVyIHdob2xlIGRlZ3JlZS5cbmNvbnN0IGN1c3BDYWNoZSA9IG5ldyBNYXAoKTtcblxuLy8gQWJvdmUgdGhpcyBhIGNvbG9yIGNvdW50cyBhcyBjaHJvbWF0aWMuIEEgcHVyZSBncmF5IGNvbWVzIGJhY2sgZnJvbVxuLy8gaGV4VG9Pa2xjaCB3aXRoIGNocm9tYSBhcm91bmQgMmUtOCBhbmQgYW4gYXJiaXRyYXJ5IGh1ZSAocm91bmRlZCBtYXRyaXhcbi8vIGNvbnN0YW50cyk7IHRlc3RpbmcgXCI+IDBcIiBtYWRlIGEgZ3JheSBmb2xsb3cgdGhlIGN1c3Agb2YgYSBodWUgaXQgZG9lc24ndFxuLy8gaGF2ZS4gRmFyIGJlbG93IGFueXRoaW5nIHZpc2libGUgaW4gOCBiaXQgKG9uZSBzdGVwIGlzIGFib3V0IDAuMDAyKS5cbmNvbnN0IE5FVVRSQUxfQ0hST01BID0gMWUtNDtcblxuZnVuY3Rpb24gY3VzcExpZ2h0bmVzcyhIKSB7XG4gIGNvbnN0IGtleSA9IE1hdGgucm91bmQoSCkgJSAzNjA7XG4gIGNvbnN0IGNhY2hlZCA9IGN1c3BDYWNoZS5nZXQoa2V5KTtcbiAgaWYgKGNhY2hlZCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gY2FjaGVkO1xuICBsZXQgbG93ID0gMDtcbiAgbGV0IGhpZ2ggPSAxO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDI0OyBpKyspIHtcbiAgICBjb25zdCB0aGlyZCA9IChoaWdoIC0gbG93KSAvIDM7XG4gICAgaWYgKG1heENocm9tYShsb3cgKyB0aGlyZCwga2V5KSA8IG1heENocm9tYShoaWdoIC0gdGhpcmQsIGtleSkpIGxvdyArPSB0aGlyZDtcbiAgICBlbHNlIGhpZ2ggLT0gdGhpcmQ7XG4gIH1cbiAgY29uc3QgcmVzdWx0ID0gKGxvdyArIGhpZ2gpIC8gMjtcbiAgY3VzcENhY2hlLnNldChrZXksIHJlc3VsdCk7XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbi8vIFRoZSBzYW1lIGxpZ2h0bmVzcywgbWVhc3VyZWQgYWdhaW5zdCB0aGUgdGFyZ2V0IGh1ZSdzIGN1c3AgaW5zdGVhZCBvZiBpdHNcbi8vIG93bjogY3VzcCBtYXBzIHRvIGN1c3AsIGJsYWNrIHRvIGJsYWNrLCB3aGl0ZSB0byB3aGl0ZSwgbGluZWFyIGluIGJldHdlZW4uXG4vLyBXaXRob3V0IGEgaHVlIHNoaWZ0IEwgY29tZXMgYmFjayB1bmNoYW5nZWQuXG5mdW5jdGlvbiByZW1hcFRvQ3VzcChMLCBmcm9tSCwgdG9IKSB7XG4gIGNvbnN0IGZyb20gPSBjdXNwTGlnaHRuZXNzKGZyb21IKTtcbiAgY29uc3QgdG8gPSBjdXNwTGlnaHRuZXNzKHRvSCk7XG4gIGlmIChMIDw9IGZyb20pIHJldHVybiBmcm9tID4gMCA/IChMIC8gZnJvbSkgKiB0byA6IHRvO1xuICByZXR1cm4gZnJvbSA8IDEgPyB0byArICgoTCAtIGZyb20pIC8gKDEgLSBmcm9tKSkgKiAoMSAtIHRvKSA6IHRvO1xufVxuXG4vLyBUaGUgdHdvIGdhbXV0IHNlYXJjaGVzIGNvc3QgYWJvdXQgMTAgXHUwMEI1cyBwZXIgY29sb3IgLSB0b28gbXVjaCB3aGVuIHRoZSBmaWxlXG4vLyB0cmVlIG9yIGdyYXBoIGFza3MgZm9yIGV2ZXJ5IGZpbGUgKHNlZSBjb2xvckZvckZpbGUpLiBUaGVyZSBhcmUgb25seSBhXG4vLyBoYW5kZnVsIG9mIGRpc3RpbmN0IGNvbG9ycywgc28gYSBjYWNoZSBzdWZmaWNlczsgZHJhZ2dpbmcgYSBzbGlkZXIgYWRkc1xuLy8gZXZlcnkgaW50ZXJtZWRpYXRlIHZhbHVlLCBoZW5jZSB0aGUgb2NjYXNpb25hbCByZXNldC5cbmNvbnN0IG9mZnNldENhY2hlID0gbmV3IE1hcCgpO1xuXG5mdW5jdGlvbiBhcHBseUNvbG9yT2Zmc2V0KGhleCwgb2Zmc2V0KSB7XG4gIGlmICghb2Zmc2V0KSByZXR1cm4gaGV4O1xuICBjb25zdCBjYWNoZUtleSA9IGhleCArIFwifFwiICsgKG9mZnNldC5oID8/IDApICsgXCJ8XCIgKyAob2Zmc2V0LmwgPz8gMCk7XG4gIGNvbnN0IGNhY2hlZCA9IG9mZnNldENhY2hlLmdldChjYWNoZUtleSk7XG4gIGlmIChjYWNoZWQgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGNhY2hlZDtcbiAgY29uc3QgcmVzdWx0ID0gY29tcHV0ZUNvbG9yT2Zmc2V0KGhleCwgb2Zmc2V0KTtcbiAgaWYgKG9mZnNldENhY2hlLnNpemUgPiA1MDApIG9mZnNldENhY2hlLmNsZWFyKCk7XG4gIG9mZnNldENhY2hlLnNldChjYWNoZUtleSwgcmVzdWx0KTtcbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLy8gQm90aCBzbGlkZXJzIGFjdCByZWxhdGl2ZSB0byB0aGUgVFlQIGNvbG9yIHNvIHRoZSBTdWJ0eXAgc3RheXMgaW4gdGhlXG4vLyBmYW1pbHkuIEFic29sdXRlIHZhbHVlcyBkb24ndCBrZWVwIHRoZWlyIHByb21pc2UsIGJlY2F1c2UgaG93IG11Y2ggY29sb3Jcbi8vIHNSR0IgYWxsb3dzIGRlcGVuZHMgb24gbGlnaHRuZXNzIEFORCBodWU6XG4vLyAgIGw6IHNoYXJlIG9mIHRoZSB3YXkgdG8gd2hpdGUgKCspIG9yIGJsYWNrICgtKS4gQWJzb2x1dGUgT0tMQ0ggcG9pbnRzIHJhbiBhXG4vLyAgICAgIGxpZ2h0IFRZUCBjb2xvciBpbnRvIHB1cmUgd2hpdGUgaW4gdGhlIGZpcnN0IGhhbGYgb2YgdGhlIHNsaWRlci5cbi8vICAgaDogZGVncmVlcyAtIHRoZSBvbmx5IGFic29sdXRlIG9uZSwgQlVUIGl0IGNhcnJpZXMgbGlnaHRuZXNzIGFsb25nIChzZWVcbi8vICAgICAgcmVtYXBUb0N1c3ApLiBFYWNoIGh1ZSBwZWFrcyBhdCBhIGRpZmZlcmVudCBsaWdodG5lc3MgKHllbGxvdyBhdCBMIDAuOTIsXG4vLyAgICAgIG9yYW5nZSAwLjc4LCBibHVlIDAuNDkpLiBUdXJuaW5nIGEgbGlnaHQgeWVsbG93IHRvIG9yYW5nZSBhdCBmaXhlZFxuLy8gICAgICBsaWdodG5lc3MgbGFuZHMgZmFyIGFib3ZlIG9yYW5nZSdzIGN1c3AsIHdoZXJlIHRoZXJlIGlzIGhhcmRseSBhbnlcbi8vICAgICAgY2hyb21hIGxlZnQ6IGEgd2FzaGVkLW91dCBwYXN0ZWwuIEZvbGxvd2luZyB0aGUgY3VzcCBrZWVwcyB0aGUgY29sb3Jcbi8vICAgICAgc3RyZW5ndGggbmVhcmx5IGNvbnN0YW50IHRocm91Z2ggdGhlIHR1cm4uXG4vLyBDaHJvbWEgaXMgdGhlbiBzaW1wbHkgYSBzaGFyZSBvZiB0aGUgY2VpbGluZyAoYmFzZS5DIC8gbWF4Q2hyb21hIGF0IHRoZVxuLy8gc3RhcnQsIHRpbWVzIG1heENocm9tYSBhdCB0aGUgdGFyZ2V0KTsgb25seSB3aXRoIHJlbGF0ZWQgbGlnaHRuZXNzZXMgYXJlXG4vLyB0d28gaHVlcycgY2VpbGluZ3MgY29tcGFyYWJsZS5cbi8vXG4vLyBOb3RlIHdoYXQgdGhhdCBzaGFyZSBpczogYSBzdGF0ZW1lbnQgYWJvdXQgc1JHQiwgbm90IGFib3V0IHBlcmNlcHRpb24uIEl0XG4vLyBrZWVwcyBcImVxdWFsbHkgZXhoYXVzdGVkXCIsIG5vdCBcImVxdWFsbHkgY29sb3JmdWxcIiAoY29uc3RhbnQgQykgbm9yIFwiZXF1YWxseVxuLy8gc2F0dXJhdGVkXCIgKGNvbnN0YW50IEMvTCkuIFNvIHRoZSBtb2RlbCBpcyB0aWVkIHRvIHNSR0I7IGFmdGVyIGEgaHVlIHR1cm4gYVxuLy8gU3VidHlwIGlzIGVxdWFsbHkgZW1waGF0aWMgcmF0aGVyIHRoYW4gZXF1YWxseSBsaWdodCAoYSBkZXNpZ24gY2hvaWNlKTsgYW5kXG4vLyBjaHJvbWEgaXNuJ3QgbW9ub3RvbmljIGluIGxpZ2h0bmVzcyAtIGFib3ZlIGl0cyBjdXNwIGEgVFlQIGNvbG9yIGZpcnN0IGdhaW5zXG4vLyBjaHJvbWEgZ29pbmcgZG93biwgdGhlbiBsb3NlcyBpdCAoIzc4NzhkYyBoYXMgbW9yZSBhdCAtMjAgJSB0aGFuIGF0IDAgJSBvclxuLy8gLTQwICUpLiBGaW5lIGZvciBjb2xvcmVkIGZpbGUgbmFtZXM7IGEgc3RyaWN0ZXIgbW9kZWwgbmVlZHMgYSBkaWZmZXJlbnRcbi8vIHJlZmVyZW5jZSwgbm90IHBhdGNoZWQgZm9ybXVsYXMuXG4vL1xuLy8gT0tMYWIgaXRzZWxmIGlzIG9mZiBpbiB0aGUgYmx1ZSByYW5nZSAoSCAyNjAtMjkwKTogYmx1ZSBkcmlmdHMgdG93YXJkIHZpb2xldFxuLy8gd2hlbiBsaWdodGVuZWQgd2hpbGUgdGhlIG51bWJlcnMgc2F5IHRoZSBodWUgaXMgY29uc3RhbnQuIENoZWNrIHN1Y2ggVFlQXG4vLyBjb2xvcnMgYnkgZXllLlxuZnVuY3Rpb24gY29tcHV0ZUNvbG9yT2Zmc2V0KGhleCwgb2Zmc2V0KSB7XG4gIGNvbnN0IGJhc2UgPSBoZXhUb09rbGNoKGhleCk7XG4gIGlmICghYmFzZSkgcmV0dXJuIGhleDtcbiAgY29uc3QgSCA9IChiYXNlLkggKyAob2Zmc2V0LmggPz8gMCkgKyAzNjApICUgMzYwO1xuICBjb25zdCBiYXNlQ2VpbGluZyA9IG1heENocm9tYShiYXNlLkwsIGJhc2UuSCk7XG4gIC8vIEEgZ3JheSBUWVAgY29sb3Igc3RheXMgZ3JheTsgaXRzIGh1ZSBtZWFucyBub3RoaW5nLCBzbyB0aGVyZSBpcyBubyBjdXNwIHRvXG4gIC8vIGZvbGxvdyBlaXRoZXIuXG4gIGNvbnN0IG5ldXRyYWwgPSBiYXNlLkMgPCBORVVUUkFMX0NIUk9NQSB8fCBiYXNlQ2VpbGluZyA8PSAwO1xuICBjb25zdCByZWxhdGl2ZSA9IG5ldXRyYWwgPyAwIDogYmFzZS5DIC8gYmFzZUNlaWxpbmc7XG4gIGNvbnN0IHNoaWZ0ZWQgPSBuZXV0cmFsID8gYmFzZS5MIDogcmVtYXBUb0N1c3AoYmFzZS5MLCBiYXNlLkgsIEgpO1xuICBjb25zdCBzaGFyZSA9IChvZmZzZXQubCA/PyAwKSAvIDEwMDtcbiAgY29uc3QgTCA9IE1hdGgubWluKDEsIE1hdGgubWF4KDAsIHNoaWZ0ZWQgKyBzaGFyZSAqIChzaGFyZSA+PSAwID8gMSAtIHNoaWZ0ZWQgOiBzaGlmdGVkKSkpO1xuICBjb25zdCBDID0gcmVsYXRpdmUgKiBtYXhDaHJvbWEoTCwgSCk7IC8qICogKDEgKyAob2Zmc2V0LnMgPz8gMCkgLyAxMDApIC0gc2F0dXJhdGlvbiBkaXNhYmxlZCAqL1xuICByZXR1cm4gb2tsY2hUb0hleCh7IEwsIEM6IE1hdGgubWF4KDAsIEMpLCBIIH0pO1xufVxuXG5mdW5jdGlvbiBoYXNDb2xvck9mZnNldChvZmZzZXQpIHtcbiAgcmV0dXJuICEhb2Zmc2V0ICYmIFNVQlRZUF9DT0xPUl9DSEFOTkVMUy5zb21lKCh7IGtleSB9KSA9PiAob2Zmc2V0W2tleV0gPz8gMCkgIT09IDApO1xufVxuXG4vLyBBIFN1YnR5cCdzIGNvbG9yICh0aGUgVFlQJ3Mgd2hpbGUgaXQgaGFzIG5vIG9mZnNldCk7IG51bGwgaWYgdGhlIFRZUCBpdHNlbGZcbi8vIGhhcyBubyBjb2xvci5cbmZ1bmN0aW9uIHN1YnR5cENvbG9yKHNldHRpbmdzLCB0eXAsIHN1YnR5cCkge1xuICBjb25zdCB0eXBDb2xvciA9IHNldHRpbmdzLnR5cENvbG9yc1t0eXBdID8/IG51bGw7XG4gIGlmICghdHlwQ29sb3IgfHwgIXN1YnR5cCkgcmV0dXJuIHR5cENvbG9yO1xuICBjb25zdCBvZmZzZXQgPSBjbGFtcGVkT2Zmc2V0KHNldHRpbmdzLCBnZXRTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgc3VidHlwKT8uY29sb3IpO1xuICByZXR1cm4gaGFzQ29sb3JPZmZzZXQob2Zmc2V0KSA/IGFwcGx5Q29sb3JPZmZzZXQodHlwQ29sb3IsIG9mZnNldCkgOiB0eXBDb2xvcjtcbn1cblxuLy8gRG9lcyB0aGUgU3VidHlwIGhhdmUgYW4gb2Zmc2V0IG9mIGl0cyBvd24gKGVmZmVjdGl2ZSB3aXRoaW4gdGhlIGxpbWl0cyk/XG5mdW5jdGlvbiBzdWJ0eXBIYXNPd25Db2xvcihzZXR0aW5ncywgdHlwLCBzdWJ0eXApIHtcbiAgcmV0dXJuIGhhc0NvbG9yT2Zmc2V0KGNsYW1wZWRPZmZzZXQoc2V0dGluZ3MsIGdldFN1YnR5cChzZXR0aW5ncywgdHlwLCBzdWJ0eXApPy5jb2xvcikpO1xufVxuXG4vLyBDb2xvciBvZiBhIFRZUCBvciBTdWJ0eXAgbmFtZSAtIHNoYXJlZCBieSB0aGUgcGlja2VyICh0eXAtcGlja2VyLmpzKSBhbmQgdGhlXG4vLyBTdWJ0eXAgcHJldmlldyBpbiB0aGUgVFlQLUxpc3Qgc28gdGhleSBjYW4ndCBkcmlmdCBhcGFydC4gV2l0aCBzdWJ0eXAsIHRoZVxuLy8gU3VidHlwIGNvbG9yLCBidXQgb25seSBpZiB0aGUgXCJTdWJ0eXBcIiBzdWItdG9nZ2xlIG9mIFwiVFlQLVBhbmVcIiBhbGxvd3MgaXQuXG4vLyBpc0RlZmF1bHQgbWVhbnMgYSBob2xsb3cgcmluZyBpbnN0ZWFkIG9mIGEgZmlsbGVkIGRvdCAoc2VlIHBhaW50Q29sb3JEb3QpLlxuZnVuY3Rpb24gbmFtZUNvbG9yKHNldHRpbmdzLCB0eXAsIHN1YnR5cCA9IG51bGwpIHtcbiAgY29uc3QgdXNlU3VidHlwID0gISFzdWJ0eXAgJiYgc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0U3VidHlwO1xuICBjb25zdCB0eXBDb2xvciA9IHNldHRpbmdzLnR5cENvbG9yc1t0eXBdID8/IG51bGw7XG4gIHJldHVybiB7XG4gICAgY29sb3I6ICh1c2VTdWJ0eXAgPyBzdWJ0eXBDb2xvcihzZXR0aW5ncywgdHlwLCBzdWJ0eXApIDogdHlwQ29sb3IpID8/IERFRkFVTFRfVFlQX0NPTE9SLFxuICAgIGlzRGVmYXVsdDogIXR5cENvbG9yIHx8ICh1c2VTdWJ0eXAgJiYgIXN1YnR5cEhhc093bkNvbG9yKHNldHRpbmdzLCB0eXAsIHN1YnR5cCkpLFxuICB9O1xufVxuXG4vLyBDb2xvciBkb3QgKFRZUC1MaXN0LCBkZXRhaWwgdmlldywgcGlja2VycywgZGlhbG9ncyk6IGZpbGxlZCBmb3IgYW4gb3duXG4vLyBjb2xvciwgYSBob2xsb3cgcmluZyBmb3IgdGhlIGRlZmF1bHQgLSBncmF5IGZvciBhIFRZUCB3aXRob3V0IGEgY29sb3IsIHRoZVxuLy8gaW5oZXJpdGVkIFRZUCBjb2xvciBmb3IgYSBTdWJ0eXAgd2l0aG91dCBhbiBvZmZzZXQuXG5mdW5jdGlvbiBwYWludENvbG9yRG90KGVsLCBjb2xvciwgaXNEZWZhdWx0KSB7XG4gIGVsLnN0eWxlLmJhY2tncm91bmRDb2xvciA9IGlzRGVmYXVsdCA/IFwidHJhbnNwYXJlbnRcIiA6IGNvbG9yO1xuICBlbC5zdHlsZS5ib3hTaGFkb3cgPSBpc0RlZmF1bHQgPyBgaW5zZXQgMCAwIDAgbWF4KDEuNXB4LCAwLjE1ZW0pICR7Y29sb3J9YCA6IFwiXCI7XG59XG5cbi8vIHZpZXdLZXkgKG9wdGlvbmFsKTogdGhlIHZpZXcncyBrZXkgaW4gY29sb3JWaWV3cy4gSWYgaXRzIFwiPHZpZXdLZXk+U3VidHlwXCJcbi8vIHN1Yi10b2dnbGUgaXMgb24sIHRoZSBub3RlJ3MgU3VidHlwIGNvbG9yIGlzIHVzZWQgaW5zdGVhZCBvZiBpdHMgVFlQJ3MuXG5mdW5jdGlvbiBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCB2aWV3S2V5ID0gbnVsbCkge1xuICBjb25zdCB0eXAgPSBwbHVnaW4udHlwSW5kZXgudHlwT2YoZmlsZSk7XG4gIGlmICghdHlwKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgeyBzZXR0aW5ncyB9ID0gcGx1Z2luO1xuICBpZiAoIXZpZXdLZXkgfHwgIXNldHRpbmdzLmNvbG9yVmlld3NbYCR7dmlld0tleX1TdWJ0eXBgXSkgcmV0dXJuIHNldHRpbmdzLnR5cENvbG9yc1t0eXBdID8/IG51bGw7XG4gIHJldHVybiBzdWJ0eXBDb2xvcihzZXR0aW5ncywgdHlwLCBwbHVnaW4udHlwSW5kZXguc3VidHlwT2YoZmlsZSkpO1xufVxuXG4vLyAtLS0gSW5saW5lIGNvbG9ycyBpbiBvdGhlciB2aWV3cyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBFeHBsb3Jlciwgc2VhcmNoLCBSZWNlbnQgRmlsZXMsIGJhY2tsaW5rcywgYm9va21hcmtzLCB0aGUgbm90ZSB0aXRsZSBhbmRcbi8vIFwiQWxsIHByb3BlcnRpZXNcIiBhcmUgY29sb3JlZCB0aHJvdWdoIHN0eWxlLmNvbG9yIG9uIE9ic2lkaWFuJ3Mgb3duXG4vLyBlbGVtZW50cy4gVGhvc2Ugdmlld3Mgb25seSByZS1yZW5kZXIgbm93IGFuZCB0aGVuLCBzbyB0aGUgY29sb3JzIHdvdWxkIHN0YXlcbi8vIGFmdGVyIHRoZSBwbHVnaW4gaXMgZGlzYWJsZWQuIEV2ZXJ5IGVsZW1lbnQgY29sb3JlZCB0aGlzIHdheSBpcyBtYXJrZWQsIGFuZFxuLy8gb24gdW5sb2FkIGV4YWN0bHkgdGhlIG1hcmtlZCBvbmVzIGFyZSBjbGVhcmVkIC0gbmV2ZXIgYW4gaW5saW5lIGNvbG9yIHNvbWVcbi8vIG90aGVyIHBsdWdpbiBvciB0aGVtZSBwdXQgdGhlcmUuXG5jb25zdCBDT0xPUkVEX0FUVFIgPSBcImRhdGEtdHlwLWNvbG9yZWRcIjtcblxuLy8gY29sb3IgbnVsbC9cIlwiIHJlbW92ZXMgdGhlIGNvbG9yLCBidXQgb25seSBmcm9tIGFuIGVsZW1lbnQgd2UgY29sb3JlZC5cbi8vIHByaW9yaXR5OiBcImltcG9ydGFudFwiIHdoZXJlIGEgQ1NTIHJ1bGUgd2l0aCAhaW1wb3J0YW50IGNvbXBldGVzLlxuZnVuY3Rpb24gc2V0SW5saW5lQ29sb3IoZWwsIGNvbG9yLCBwcmlvcml0eSA9IFwiXCIpIHtcbiAgaWYgKGNvbG9yKSB7XG4gICAgZWwuc3R5bGUuc2V0UHJvcGVydHkoXCJjb2xvclwiLCBjb2xvciwgcHJpb3JpdHkpO1xuICAgIGVsLnNldEF0dHJpYnV0ZShDT0xPUkVEX0FUVFIsIFwiXCIpO1xuICB9IGVsc2UgaWYgKGVsLmhhc0F0dHJpYnV0ZShDT0xPUkVEX0FUVFIpKSB7XG4gICAgZWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcbiAgICBlbC5yZW1vdmVBdHRyaWJ1dGUoQ09MT1JFRF9BVFRSKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjbGVhcklubGluZUNvbG9ycyhkb2MpIHtcbiAgZm9yIChjb25zdCBlbCBvZiBkb2MucXVlcnlTZWxlY3RvckFsbChgWyR7Q09MT1JFRF9BVFRSfV1gKSkgc2V0SW5saW5lQ29sb3IoZWwsIG51bGwpO1xufVxuXG4vLyBUaGUgZG9jdW1lbnRzIG9mIGFsbCB3aW5kb3dzIChwb3Atb3V0cyBpbmNsdWRlZCksIGNvbGxlY3RlZCB0aHJvdWdoIHRoZWlyXG4vLyBsZWF2ZXMuXG5mdW5jdGlvbiBhbGxEb2N1bWVudHMoYXBwKSB7XG4gIGNvbnN0IGRvY3MgPSBuZXcgU2V0KCk7XG4gIGFwcC53b3Jrc3BhY2UuaXRlcmF0ZUFsbExlYXZlcygobGVhZikgPT4gZG9jcy5hZGQobGVhZi52aWV3LmNvbnRhaW5lckVsLm93bmVyRG9jdW1lbnQpKTtcbiAgcmV0dXJuIGRvY3M7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBzZXRJbmxpbmVDb2xvcixcbiAgY2xlYXJJbmxpbmVDb2xvcnMsXG4gIGFsbERvY3VtZW50cyxcbiAgY29sb3JGb3JGaWxlLFxuICBuYW1lQ29sb3IsXG4gIERFRkFVTFRfVFlQX0NPTE9SLFxuICBzdWJ0eXBDb2xvcixcbiAgYXBwbHlDb2xvck9mZnNldCxcbiAgaGFzQ29sb3JPZmZzZXQsXG4gIHN1YnR5cEhhc093bkNvbG9yLFxuICBwYWludENvbG9yRG90LFxuICBjb2xvclJhbmdlLFxuICBjaGFubmVsQm91bmRzLFxuICBjbGFtcGVkT2Zmc2V0LFxuICBTVUJUWVBfQ09MT1JfQ0hBTk5FTFMsXG4gIERFRkFVTFRfU1VCVFlQX0NPTE9SX1JBTkdFUyxcbn07XG4iLCAiY29uc3QgeyBQbHVnaW5TZXR0aW5nVGFiLCBTZXR0aW5nR3JvdXAsIFRvZ2dsZUNvbXBvbmVudCwgRHJvcGRvd25Db21wb25lbnQsIGRlYm91bmNlIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IG1vdW50R2xvYmFsT3JkZXJFZGl0b3IgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLW9yZGVyLWVkaXRvclwiKTtcbmNvbnN0IHsgREVGQVVMVF9HTE9CQUxfT1JERVIgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLXNvcnRcIik7XG5jb25zdCB7IFNVQlRZUF9DT0xPUl9DSEFOTkVMUywgREVGQVVMVF9TVUJUWVBfQ09MT1JfUkFOR0VTLCBjb2xvclJhbmdlIH0gPSByZXF1aXJlKFwiLi90eXAtY29sb3JzXCIpO1xuXG5jb25zdCBERUZBVUxUX1NFVFRJTkdTID0ge1xuICB0eXBzOiBbXSxcbiAgdHlwQ29sb3JzOiB7fSxcbiAgdHlwRGVzY3JpcHRpb25zOiB7fSxcbiAgdHlwRGVmYXVsdEZyb250bWF0dGVyOiB7fSxcbiAgLy8gS2V5cyBvZiB0eXBEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwXSBtYXJrZWQgYXMgZmxvYXRpbmcuIFRoZXkgc2hhcmUgdGhlIGxpc3RcbiAgLy8gYW5kIGl0cyBvcmRlciAod2hpY2ggZnJvbnRtYXR0ZXIgc29ydGluZyB1c2VzKSwgYnV0IGdldFR5cERlZmF1bHRzKCkgbGVhdmVzXG4gIC8vIHRoZW0gb3V0IHVubGVzcyBhc2tlZCB3aXRoIGluY2x1ZGVGbG9hdGluZywgc28gbmV3IG5vdGVzIGRvbid0IGdldCB0aGVtXG4gIC8vIGF1dG9tYXRpY2FsbHkuXG4gIHR5cEZsb2F0aW5nS2V5czoge30sXG4gIC8vIFNob3J0Y3V0cyBwZXIga2V5IG9mIHR5cERlZmF1bHRGcm9udG1hdHRlclt0eXBdOlxuICAvLyAgIHsgW1RZUF06IHsgW1Byb3BlcnR5XTogeyBuYW1lOiBcInRvZGF5XCIgfCBcInRwLjxzY3JpcHQ+XCIgfSB9IH1cbiAgLy8gS2VwdCBORVhUIFRPIHRoZSBmcm9udG1hdHRlciwgbm90IGFzIGl0cyB2YWx1ZSAtIHNlZSBzaG9ydGN1dHMuanMuXG4gIHR5cFNob3J0Y3V0czoge30sXG4gIHR5cE1hbnVhbDoge30sXG4gIC8vIFJlZ2lzdGVyZWQgU3VidHlwcyBwZXIgVFlQIHdpdGggdGhlaXIgb3duIGZyb250bWF0dGVyIGJsb2NrLCBzZWUgc3VidHlwcy5qcy5cbiAgdHlwU3VidHlwczoge30sXG4gIC8vIFBpbm5lZCBzaW5nbGUgcHJvcGVydGllcyAoa2luZDogXCJwcm9wZXJ0eVwiKSBwbHVzIHRoZSBmb3VyIGZpeGVkXG4gIC8vIHBsYWNlaG9sZGVycyBcInR5cFZhbHVlXCIsIFwic3VidHlwVmFsdWVcIiwgXCJ0eXBcIiBhbmQgXCJvdGhlclwiIC0gc2VlXG4gIC8vIGZyb250bWF0dGVyLXNvcnQuanMuXG4gIGdsb2JhbFByb3BlcnR5T3JkZXI6IERFRkFVTFRfR0xPQkFMX09SREVSLFxuICAvLyBIb3cgdGhlIG9wZW4gbm90ZSBzaG93cyBpdHMgVFlQIChzZWUgYWN0aXZlLXRpdGxlLWNvbG9ycy5qcyk6IFwibm9uZVwiLFxuICAvLyBcImRvdFwiIG9yIFwiYmFkZ2VcIi4gVGhlIHRocmVlIGJhZGdlIHNldHRpbmdzIGJlbG93IG9ubHkgbWF0dGVyIGZvciBcImJhZGdlXCIuXG4gIC8vIGNvbG9yVmlld3Mubm90ZVRpdGxlQ29sb3IgKHRoZSB0aXRsZSB0ZXh0IGl0c2VsZikgaXMgaW5kZXBlbmRlbnQuXG4gIG5vdGVUaXRsZVN0eWxlOiBcImRvdFwiLFxuICAvLyBCYWRnZSBjb2xvcmVkIChUWVAgY29sb3IpIG9yIG5ldXRyYWwgKHRleHQtbXV0ZWQpLlxuICBub3RlVGl0bGVCYWRnZUNvbG9yZWQ6IHRydWUsXG4gIC8vIEJhZGdlIGxhYmVsOiBcInR5cFwiIChbVFlQXSksIFwidHlwLXN1YnR5cFwiIChbVFlQL1N1YnR5cF0pIG9yIFwic3VidHlwXCJcbiAgLy8gKFtTdWJ0eXBdOyBubyBiYWRnZSB3aXRob3V0IGEgU3VidHlwKS4gQ29sb3JlZCBpbiB0aGUgVFlQIG9yIFN1YnR5cCBjb2xvcjtcbiAgLy8gZm9yIFwidHlwLXN1YnR5cFwiIGNob3NlbiB3aXRoIGNvbG9yVmlld3Mubm90ZVRpdGxlTWFya2VyU3VidHlwLlxuICBub3RlVGl0bGVCYWRnZUxhYmVsOiBcInR5cFwiLFxuICAvLyBcInRpdGxlXCIgKG5leHQgdG8gdGhlIGlubGluZSB0aXRsZSkgb3IgXCJibG9ja1wiIChsZWZ0IG9mIHRoZSBwcm9wZXJ0eVxuICAvLyBibG9jaywgdHVybmVkIDkwXHUwMEIwKS5cbiAgbm90ZVRpdGxlQmFkZ2VQb3NpdGlvbjogXCJ0aXRsZVwiLFxuICAvLyBGb3IgcG9zaXRpb24gXCJibG9ja1wiOiB0b3Agb3IgYm90dG9tIGVkZ2Ugb2YgdGhlIHByb3BlcnR5IGJsb2NrLlxuICBub3RlVGl0bGVWZXJ0aWNhbEFsaWduOiBcInRvcFwiLFxuICB0eXBTb3J0T3JkZXI6IFwiY291bnQtZGVzY1wiLFxuICAvLyBXaGF0IHRoZSBUWVAtTGlzdCBzaG93cyBuZXh0IHRvIHRoZSBuYW1lOiBcInN1YnR5cHNcIiwgXCJkZXNjcmlwdGlvblwiIG9yXG4gIC8vIFwibm9uZVwiLiBTd2l0Y2hlZCBieSB0aGUgaGVhZGVyIGJ1dHRvbiBuZXh0IHRvIHNvcnRpbmcgKFNFQ09OREFSWV9NT0RFUyBpblxuICAvLyB0eXAtcGFuZS5qcyksIG5vdCBoZXJlOiBsaWtlIHRoZSBzb3J0IG9yZGVyIGl0IG9ubHkgY29uY2VybnMgdGhhdCBsaXN0LlxuICB0eXBMaXN0U2Vjb25kYXJ5OiBcInN1YnR5cHNcIixcbiAgLy8gU2VlIHBpY2tUeXBBbmRTdWJ0eXAgaW4gdHlwLXBpY2tlci5qczogZmFsc2UgPSBlYWNoIFN1YnR5cCBpbmRlbnRlZCBpbiB0aGVcbiAgLy8gVFlQLVBpY2tlciwgdHJ1ZSA9IGEgc2VwYXJhdGUgU3VidHlwLVBpY2tlciBhZnRlciB0aGUgVFlQIGNob2ljZS5cbiAgc2VwYXJhdGVTdWJ0eXBQaWNrZXI6IGZhbHNlLFxuICBpbmNsdWRlSWdub3JlZEZpbGVzOiBmYWxzZSxcbiAgLy8gQXNrIGJlZm9yZSBkZWxldGluZyBhIFRZUCBvciBhIFN1YnR5cCB3aXRoIHByb3BlcnRpZXMuIE9ubHkgZGVsZXRpb25zIHRoYXRcbiAgLy8gdG91Y2ggbm90aGluZyBidXQgdGhlc2Ugc2V0dGluZ3MgY2FuIGJlIHN3aXRjaGVkIG9mZiAoXCJEb24ndCBhc2sgYWdhaW5cIiBpblxuICAvLyB0aGUgZGlhbG9nKSAtIHRoZXkgY2FuIGJlIHVuZG9uZSAodW5kby5qcykuIEFueXRoaW5nIHRoYXQgcmV3cml0ZXMgbm90ZXNcbiAgLy8gb3IgZmlsZXMgYWx3YXlzIGFza3MuXG4gIGNvbmZpcm1EZWxldGlvbjogdHJ1ZSxcbiAgLy8gT3duIHRhZy9hdHRhY2htZW50IGNvbG9ycyBpbiB0aGUgZ3JhcGggZGlzYWJsZWQgKDIwMjYtMDktMzApOiB0aGUgTWluaW1hbFxuICAvLyB0aGVtZSdzIFN0eWxlIFNldHRpbmdzIGNvdmVyIGJvdGgsIHNlZSBncmFwaC1jb2xvcnMuanMuXG4gIC8vIGdyYXBoVGFnQ29sb3JFbmFibGVkOiBmYWxzZSxcbiAgLy8gZ3JhcGhUYWdDb2xvcjogXCJcIixcbiAgLy8gZ3JhcGhBdHRhY2htZW50Q29sb3JFbmFibGVkOiBmYWxzZSxcbiAgLy8gZ3JhcGhBdHRhY2htZW50Q29sb3I6IFwiXCIsXG4gIC8vIEhvdyBmYXIgYSBTdWJ0eXAncyBjb2xvciBtYXkgZGlmZmVyIGZyb20gaXRzIFRZUCdzIChcdTAwQjEpLCBzZWUgdHlwLWNvbG9ycy5qczpcbiAgLy8gaHVlIGluIGRlZ3JlZXMsIGxpZ2h0bmVzcyBpbiAlIG9mIHRoZSB3YXkgdG8gd2hpdGUgb3IgYmxhY2suXG4gIHN1YnR5cENvbG9yUmFuZ2VzOiB7IC4uLkRFRkFVTFRfU1VCVFlQX0NPTE9SX1JBTkdFUyB9LFxuICBjb2xvclZpZXdzOiB7XG4gICAgZmlsZUV4cGxvcmVyOiB0cnVlLFxuICAgIGdyYXBoOiB0cnVlLFxuICAgIHNlYXJjaDogdHJ1ZSxcbiAgICByZWNlbnRGaWxlczogdHJ1ZSxcbiAgICBiYWNrbGlua3M6IHRydWUsXG4gICAgYm9va21hcmtzOiB0cnVlLFxuICAgIC8vIFwiPHZpZXc+U3VidHlwXCIgc3ViLXRvZ2dsZXM6IHVzZSBhIG5vdGUncyBTdWJ0eXAgY29sb3IgaW5zdGVhZCBvZiBpdHNcbiAgICAvLyBUWVAncyAoc2VlIGNvbG9yRm9yRmlsZSBpbiB0eXAtY29sb3JzLmpzKS5cbiAgICBmaWxlRXhwbG9yZXJTdWJ0eXA6IHRydWUsXG4gICAgZ3JhcGhTdWJ0eXA6IHRydWUsXG4gICAgc2VhcmNoU3VidHlwOiB0cnVlLFxuICAgIHJlY2VudEZpbGVzU3VidHlwOiB0cnVlLFxuICAgIGJhY2tsaW5rc1N1YnR5cDogdHJ1ZSxcbiAgICBib29rbWFya3NTdWJ0eXA6IHRydWUsXG4gICAgbGlua3NTdWJ0eXA6IHRydWUsXG4gICAgdHlwTGlzdFN1YnR5cDogdHJ1ZSxcbiAgICBub3RlVGl0bGVDb2xvclN1YnR5cDogdHJ1ZSxcbiAgICBub3RlVGl0bGVNYXJrZXJTdWJ0eXA6IHRydWUsXG4gICAgZnJvbnRtYXR0ZXJEZWZhdWx0czogdHJ1ZSxcbiAgICAvLyBTdWItdG9nZ2xlIG9mIGZyb250bWF0dGVyRGVmYXVsdHMgYW5kIGFsbFByb3BlcnRpZXM6IGluY2x1ZGUgdGhlIFN1YnR5cFxuICAgIC8vIGJsb2NrcyAoc2VlIGZyb250bWF0dGVyLWRlZmF1bHQtaGlnaGxpZ2h0LmpzKTsgZm9yIGFsbFByb3BlcnRpZXMgYWxzbyBpblxuICAgIC8vIHRoZSBTdWJ0eXAgY29sb3IuXG4gICAgZnJvbnRtYXR0ZXJEZWZhdWx0c1N1YnR5cDogdHJ1ZSxcbiAgICB0eXBMaXN0OiB0cnVlLFxuICAgIGFsbFByb3BlcnRpZXM6IHRydWUsXG4gICAgYWxsUHJvcGVydGllc1N1YnR5cDogdHJ1ZSxcbiAgICBub3RlVGl0bGVDb2xvcjogdHJ1ZSxcbiAgICBsaW5rczogdHJ1ZSxcbiAgfSxcbn07XG5cbmNsYXNzIFR5cFN5c3RlbVNldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcbiAgY29uc3RydWN0b3IoYXBwLCBwbHVnaW4pIHtcbiAgICBzdXBlcihhcHAsIHBsdWdpbik7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cblxuICAvLyBFYWNoIHNlY3Rpb24gaXMgYSBTZXR0aW5nR3JvdXAgKGhlYWRpbmcgcGx1cyBvbmUgYm94LCBlbnRyaWVzIHNlcGFyYXRlZCBieVxuICAvLyBsaW5lcyksIGxpa2UgT2JzaWRpYW4ncyBjb3JlIHNldHRpbmdzLiBTZXR0aW5ncyBjcmVhdGVkIG9uZSBieSBvbmUgd2l0aFxuICAvLyBuZXcgU2V0dGluZyhjb250YWluZXJFbCkgd291bGQgZWFjaCBnZXQgdGhlaXIgb3duIHNtYWxsIGJveC5cbiAgZGlzcGxheSgpIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIC8vIEtlZXAgdGhlIHNjcm9sbCBwb3NpdGlvbiBhY3Jvc3MgcmVidWlsZHMgKHRvZ2dsZXMgd2l0aCBzdWItb3B0aW9ucyBjYWxsXG4gICAgLy8gZGlzcGxheSgpKTogdGhlIFRZUCBtYXJrZXIgZHJvcGRvd24gbWVhc3VyZXMgaXRzZWxmIG9uIHNldFZhbHVlKCkgYW5kXG4gICAgLy8gZm9yY2VzIGEgbGF5b3V0IHdoaWxlIHRoZSBwYWdlIGlzIG9ubHkgcGFydGx5IGJ1aWx0LCBzbyB0aGUgYnJvd3NlclxuICAgIC8vIGNsYW1wcyBzY3JvbGxUb3AgdG8gdGhhdCBoZWlnaHQgYW5kIHRoZSBwYWdlIHdvdWxkIGp1bXAgdXAuXG4gICAgY29uc3QgeyBzY3JvbGxUb3AgfSA9IGNvbnRhaW5lckVsO1xuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG5cbiAgICBuZXcgU2V0dGluZ0dyb3VwKGNvbnRhaW5lckVsKVxuICAgICAgLnNldEhlYWRpbmcoXCJUWVAtTGlzdFwiKVxuICAgICAgLmFkZFNldHRpbmcoKHNldHRpbmcpID0+XG4gICAgICAgIHNldHRpbmdcbiAgICAgICAgICAuc2V0TmFtZShcIkluY2x1ZGUgZXhjbHVkZWQgZmlsZXNcIilcbiAgICAgICAgICAuc2V0RGVzYyhcbiAgICAgICAgICAgIFwiQ291bnQgbm90ZXMgZnJvbSBPYnNpZGlhbidzIFxcXCJFeGNsdWRlZCBmaWxlc1xcXCIgKGUuZy4gZm9sZGVycyBoaWRkZW4gYnkgSGlkZSBGb2xkZXJzKSBpbiBUWVAgY291bnRzLCB0aGUgVFlQLVBpY2tlciBhbmQgZnJvbnRtYXR0ZXIgc29ydGluZy5cIlxuICAgICAgICAgIClcbiAgICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuaW5jbHVkZUlnbm9yZWRGaWxlcykub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXMgPSB2YWx1ZTtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICApXG4gICAgICApXG4gICAgICAuYWRkU2V0dGluZygoc2V0dGluZykgPT5cbiAgICAgICAgc2V0dGluZ1xuICAgICAgICAgIC5zZXROYW1lKFwiQ29uZmlybSBkZWxldGlvblwiKVxuICAgICAgICAgIC5zZXREZXNjKFxuICAgICAgICAgICAgXCJBc2sgYmVmb3JlIGRlbGV0aW5nIGEgVFlQIG9yIGEgU3VidHlwIHdpdGggcHJvcGVydGllcy4gV2hlbiBvZmYsIHRoZXkgYXJlIGRlbGV0ZWQgYXQgb25jZTsgZWl0aGVyIHdheSB0aGUgbm90aWNlIGFmdGVyd2FyZHMgb2ZmZXJzIFVuZG8uIERpYWxvZ3MgdGhhdCByZXdyaXRlIG5vdGVzIChyZW5hbWUgYW5kIHVwZGF0ZSBub3RlcywgbWVyZ2UpIGFsd2F5cyBhc2suXCJcbiAgICAgICAgICApXG4gICAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbmZpcm1EZWxldGlvbikub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbmZpcm1EZWxldGlvbiA9IHZhbHVlO1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgKVxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nR3JvdXAoY29udGFpbmVyRWwpLnNldEhlYWRpbmcoXCJUWVAtUGlja2VyXCIpLmFkZFNldHRpbmcoKHNldHRpbmcpID0+XG4gICAgICBzZXR0aW5nXG4gICAgICAgIC5zZXROYW1lKFwiU2VwYXJhdGUgU3VidHlwLVBpY2tlclwiKVxuICAgICAgICAuc2V0RGVzYyhcbiAgICAgICAgICBcIkFmdGVyIGNob29zaW5nIGEgVFlQLCBjaG9vc2UgdGhlIFN1YnR5cCBpbiBhIHNlY29uZCBwaWNrZXIuIFdoZW4gb2ZmLCBlYWNoIFN1YnR5cCBpcyBsaXN0ZWQgaW5kZW50ZWQgYmVsb3cgaXRzIFRZUC5cIlxuICAgICAgICApXG4gICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3Muc2VwYXJhdGVTdWJ0eXBQaWNrZXIpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Muc2VwYXJhdGVTdWJ0eXBQaWNrZXIgPSB2YWx1ZTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH0pXG4gICAgICAgIClcbiAgICApO1xuXG4gICAgLy8gc3VidHlwS2V5IChvcHRpb25hbCk6IHR3byBsYWJlbGVkIHRvZ2dsZXMgaW5zdGVhZCBvZiBvbmUgLSBcIlRZUFwiIGZvciB0aGVcbiAgICAvLyBzZXR0aW5nIGl0c2VsZiBhbmQgYmVsb3cgaXQgXCJTdWJ0eXBcIiwgc2hvd24gb25seSB3aGlsZSBcIlRZUFwiIGlzIG9uLiBUaGVcbiAgICAvLyBkZWZhdWx0IHRvb2x0aXBzIGZpdCB0aGUgY29sb3JpbmcgdG9nZ2xlcy5cbiAgICBjb25zdCBjb2xvclZpZXdUb2dnbGUgPSAoXG4gICAgICBncm91cCxcbiAgICAgIGtleSxcbiAgICAgIG5hbWUsXG4gICAgICBkZXNjLFxuICAgICAgc3VidHlwS2V5ID0gbnVsbCxcbiAgICAgIHsgdHlwVG9vbHRpcCA9IFwiQ29sb3IgYnkgVFlQXCIsIHN1YnR5cFRvb2x0aXAgPSBcIlVzZSBTdWJ0eXAgY29sb3IgaW5zdGVhZCBvZiBUWVAgY29sb3JcIiB9ID0ge31cbiAgICApID0+XG4gICAgICBncm91cC5hZGRTZXR0aW5nKChzZXR0aW5nKSA9PiB7XG4gICAgICAgIHNldHRpbmcuc2V0TmFtZShuYW1lKS5zZXREZXNjKGRlc2MpO1xuICAgICAgICBjb25zdCBzYXZlID0gYXN5bmMgKHNldHRpbmdLZXksIHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3c1tzZXR0aW5nS2V5XSA9IHZhbHVlO1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICB9O1xuXG4gICAgICAgIGlmICghc3VidHlwS2V5KSB7XG4gICAgICAgICAgc2V0dGluZy5hZGRUb2dnbGUoKHRvZ2dsZSkgPT4gdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Nba2V5XSkub25DaGFuZ2UoKHZhbHVlKSA9PiBzYXZlKGtleSwgdmFsdWUpKSk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgc2V0dGluZy5zZXR0aW5nRWwuYWRkQ2xhc3MoXCJ0eXAtbm90ZS10aXRsZS1zZXR0aW5nXCIpO1xuICAgICAgICBjb25zdCBhZGRSb3cgPSAobGFiZWwsIHRvb2x0aXAsIHNldHRpbmdLZXksIG9uQ2hhbmdlZCkgPT4ge1xuICAgICAgICAgIGNvbnN0IHJvdyA9IHNldHRpbmcuY29udHJvbEVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtbm90ZS10aXRsZS10b2dnbGUtcm93XCIgfSk7XG4gICAgICAgICAgcm93LmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLW5vdGUtdGl0bGUtdG9nZ2xlLWxhYmVsXCIsIHRleHQ6IGxhYmVsIH0pO1xuICAgICAgICAgIG5ldyBUb2dnbGVDb21wb25lbnQocm93KVxuICAgICAgICAgICAgLnNldFRvb2x0aXAodG9vbHRpcClcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzW3NldHRpbmdLZXldKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgICBhd2FpdCBzYXZlKHNldHRpbmdLZXksIHZhbHVlKTtcbiAgICAgICAgICAgICAgb25DaGFuZ2VkPy4oKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9O1xuICAgICAgICBhZGRSb3coXCJUWVBcIiwgdHlwVG9vbHRpcCwga2V5LCAoKSA9PiB0aGlzLmRpc3BsYXkoKSk7XG4gICAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzW2tleV0pIGFkZFJvdyhcIlN1YnR5cFwiLCBzdWJ0eXBUb29sdGlwLCBzdWJ0eXBLZXkpO1xuICAgICAgfSk7XG5cbiAgICBjb25zdCBjb2xvcmluZ0dyb3VwID0gbmV3IFNldHRpbmdHcm91cChjb250YWluZXJFbCkuc2V0SGVhZGluZyhcIkNvbG9yaW5nXCIpO1xuXG4gICAgY29sb3JWaWV3VG9nZ2xlKGNvbG9yaW5nR3JvdXAsIFwiZmlsZUV4cGxvcmVyXCIsIFwiRmlsZSBleHBsb3JlclwiLCBcIkNvbG9yIG5vdGUgbmFtZXMgaW4gdGhlIGZpbGUgZXhwbG9yZXIuXCIsIFwiZmlsZUV4cGxvcmVyU3VidHlwXCIpO1xuICAgIGNvbG9yVmlld1RvZ2dsZShjb2xvcmluZ0dyb3VwLCBcImdyYXBoXCIsIFwiR3JhcGhcIiwgXCJDb2xvciBub2RlcyBpbiB0aGUgZ2xvYmFsIGFuZCBsb2NhbCBncmFwaC5cIiwgXCJncmFwaFN1YnR5cFwiKTtcbiAgICBjb2xvclZpZXdUb2dnbGUoY29sb3JpbmdHcm91cCwgXCJzZWFyY2hcIiwgXCJTZWFyY2hcIiwgXCJDb2xvciByZXN1bHQgdGl0bGVzIGluIHNlYXJjaC5cIiwgXCJzZWFyY2hTdWJ0eXBcIik7XG4gICAgY29sb3JWaWV3VG9nZ2xlKGNvbG9yaW5nR3JvdXAsIFwicmVjZW50RmlsZXNcIiwgXCJSZWNlbnQgRmlsZXNcIiwgXCJDb2xvciBlbnRyaWVzIGluIHRoZSBSZWNlbnQgRmlsZXMgcGx1Z2luLlwiLCBcInJlY2VudEZpbGVzU3VidHlwXCIpO1xuICAgIGNvbG9yVmlld1RvZ2dsZShcbiAgICAgIGNvbG9yaW5nR3JvdXAsXG4gICAgICBcImxpbmtzXCIsXG4gICAgICBcIkxpbmtzIGluIG5vdGVzXCIsXG4gICAgICBcIkNvbG9yIGludGVybmFsIGxpbmtzIGJ5IHRoZSBUWVAgb2YgdGhlaXIgdGFyZ2V0IChyZWFkaW5nIHZpZXcsIExpdmUgUHJldmlldywgaG92ZXIgcHJldmlldykuIFVucmVzb2x2ZWQgbGlua3Mgc3RheSBhcyB0aGV5IGFyZS5cIixcbiAgICAgIFwibGlua3NTdWJ0eXBcIlxuICAgICk7XG4gICAgY29sb3JWaWV3VG9nZ2xlKGNvbG9yaW5nR3JvdXAsIFwidHlwTGlzdFwiLCBcIlRZUC1QYW5lXCIsIFwiQ29sb3IgbmFtZXMgaW4gdGhlIFRZUC1QYW5lIGFuZCBUWVAtUGlja2VyLlwiLCBcInR5cExpc3RTdWJ0eXBcIik7XG4gICAgY29sb3JWaWV3VG9nZ2xlKFxuICAgICAgY29sb3JpbmdHcm91cCxcbiAgICAgIFwibm90ZVRpdGxlQ29sb3JcIixcbiAgICAgIFwiQ29sb3Igbm90ZSB0aXRsZVwiLFxuICAgICAgXCJDb2xvciB0aGUgaW5saW5lIHRpdGxlIG9mIHRoZSBvcGVuIG5vdGUuXCIsXG4gICAgICBcIm5vdGVUaXRsZUNvbG9yU3VidHlwXCJcbiAgICApO1xuXG4gICAgLy8gUHJvZ3Jlc3NpdmUgZGlzY2xvc3VyZTogXCJiYWRnZVwiIGFkZHMgdG9nZ2xlcyAoY29sb3IsIHBvc2l0aW9uKSB0byB0aGlzXG4gICAgLy8gb25lIHNldHRpbmcgcm93LCBwb3NpdGlvbiBcImJsb2NrXCIgb25lIG1vcmUgKGFsaWdubWVudCkuIEVhY2ggcmUtcmVuZGVyc1xuICAgIC8vIHZpYSBkaXNwbGF5KCkgc28gb25seSB0aGUgcmVsZXZhbnQgb25lcyBzaG93LlxuICAgIGNvbnN0IGlzQmFkZ2UgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVTdHlsZSA9PT0gXCJiYWRnZVwiO1xuICAgIGNvbnN0IGlzQmxvY2tQb3NpdGlvbiA9IHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlUG9zaXRpb24gPT09IFwiYmxvY2tcIjtcblxuICAgIGNvbG9yaW5nR3JvdXAuYWRkU2V0dGluZygobm90ZVRpdGxlU2V0dGluZykgPT4ge1xuICAgICAgbm90ZVRpdGxlU2V0dGluZ1xuICAgICAgICAuc2V0TmFtZShcIlRZUCBtYXJrZXIgaW4gbm90ZVwiKVxuICAgICAgICAuc2V0RGVzYyhpc0JhZGdlID8gXCJCYWRnZSBvcHRpb25zOiBsYWJlbCwgY29sb3IsIHBvc2l0aW9uLlwiIDogXCJIb3cgdGhlIG9wZW4gbm90ZSBzaG93cyBpdHMgVFlQLlwiKVxuICAgICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PlxuICAgICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwibm9uZVwiLCBcIk5vbmVcIilcbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJkb3RcIiwgXCJEb3QgYXQgdGl0bGVcIilcbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJiYWRnZVwiLCBcIkJhZGdlIHdpdGggVFlQIG5hbWVcIilcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVTdHlsZSlcbiAgICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlU3R5bGUgPSB2YWx1ZTtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICk7XG5cbiAgICAgIC8vIFwiU3VidHlwXCIgKFN1YnR5cCBjb2xvciBpbnN0ZWFkIG9mIFRZUCBjb2xvcikgb25seSB3aGlsZSB0aGUgbWFya2VyIGlzXG4gICAgICAvLyBjb2xvcmVkIGF0IGFsbDogYWx3YXlzIGZvciB0aGUgZG90LCBmb3IgdGhlIGJhZGdlIG9ubHkgd2l0aCBcIkNvbG9yZWRcIlxuICAgICAgLy8gYW5kIGxhYmVsIFtUWVAvU3VidHlwXSAtIHdpdGggW1RZUF0gb3IgW1N1YnR5cF0gdGhlIGNvbG9yIGZvbGxvd3MgdGhlXG4gICAgICAvLyBsYWJlbC5cbiAgICAgIGNvbnN0IGJhZGdlTGFiZWwgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUxhYmVsID8/IFwidHlwXCI7XG4gICAgICBjb25zdCBzaG93U3VidHlwID1cbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlU3R5bGUgPT09IFwiZG90XCIgfHxcbiAgICAgICAgKGlzQmFkZ2UgJiYgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VDb2xvcmVkICYmIGJhZGdlTGFiZWwgPT09IFwidHlwLXN1YnR5cFwiKTtcbiAgICAgIGlmICghaXNCYWRnZSAmJiAhc2hvd1N1YnR5cCkgcmV0dXJuO1xuXG4gICAgICAvLyBTdGFja3MgdGhlIGV4dHJhIHRvZ2dsZXMgaW5zdGVhZCBvZiBPYnNpZGlhbidzIHNpZGUtYnktc2lkZSBsYXlvdXQsXG4gICAgICAvLyBzZWUgLnR5cC1ub3RlLXRpdGxlLXNldHRpbmcgaW4gc3R5bGVzLmNzcy5cbiAgICAgIG5vdGVUaXRsZVNldHRpbmcuc2V0dGluZ0VsLmFkZENsYXNzKFwidHlwLW5vdGUtdGl0bGUtc2V0dGluZ1wiKTtcblxuICAgICAgLy8gQSBzbWFsbCBsYWJlbCBwZXIgdG9nZ2xlIC0gYWRkVG9nZ2xlKCkgYWxvbmUgYWRkcyBhIGJhcmUgc3dpdGNoLlxuICAgICAgY29uc3QgYWRkTGFiZWxlZFRvZ2dsZSA9IChsYWJlbCwgdG9vbHRpcCwgdmFsdWUsIG9uQ2hhbmdlKSA9PiB7XG4gICAgICAgIGNvbnN0IHJvdyA9IG5vdGVUaXRsZVNldHRpbmcuY29udHJvbEVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtbm90ZS10aXRsZS10b2dnbGUtcm93XCIgfSk7XG4gICAgICAgIHJvdy5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1ub3RlLXRpdGxlLXRvZ2dsZS1sYWJlbFwiLCB0ZXh0OiBsYWJlbCB9KTtcbiAgICAgICAgbmV3IFRvZ2dsZUNvbXBvbmVudChyb3cpLnNldFRvb2x0aXAodG9vbHRpcCkuc2V0VmFsdWUodmFsdWUpLm9uQ2hhbmdlKG9uQ2hhbmdlKTtcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGFkZFN1YnR5cFRvZ2dsZSA9IChsYWJlbCkgPT5cbiAgICAgICAgYWRkTGFiZWxlZFRvZ2dsZShcbiAgICAgICAgICBsYWJlbCxcbiAgICAgICAgICBcIlVzZSBTdWJ0eXAgY29sb3IgaW5zdGVhZCBvZiBUWVAgY29sb3JcIixcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLm5vdGVUaXRsZU1hcmtlclN1YnR5cCxcbiAgICAgICAgICBhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Mubm90ZVRpdGxlTWFya2VyU3VidHlwID0gdmFsdWU7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICAgIH1cbiAgICAgICAgKTtcblxuICAgICAgaWYgKCFpc0JhZGdlKSB7XG4gICAgICAgIGFkZFN1YnR5cFRvZ2dsZShcIlN1YnR5cFwiKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBsYWJlbFJvdyA9IG5vdGVUaXRsZVNldHRpbmcuY29udHJvbEVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtbm90ZS10aXRsZS10b2dnbGUtcm93XCIgfSk7XG4gICAgICBsYWJlbFJvdy5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1ub3RlLXRpdGxlLXRvZ2dsZS1sYWJlbFwiLCB0ZXh0OiBcIkxhYmVsXCIgfSk7XG4gICAgICBuZXcgRHJvcGRvd25Db21wb25lbnQobGFiZWxSb3cpXG4gICAgICAgIC5hZGRPcHRpb24oXCJ0eXBcIiwgXCJbVFlQXVwiKVxuICAgICAgICAuYWRkT3B0aW9uKFwidHlwLXN1YnR5cFwiLCBcIltUWVAvU3VidHlwXVwiKVxuICAgICAgICAuYWRkT3B0aW9uKFwic3VidHlwXCIsIFwiW1N1YnR5cF1cIilcbiAgICAgICAgLnNldFZhbHVlKGJhZGdlTGFiZWwpXG4gICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUxhYmVsID0gdmFsdWU7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgIH0pO1xuXG4gICAgICBhZGRMYWJlbGVkVG9nZ2xlKFwiQ29sb3JlZFwiLCBcIkNvbG9yZWQgaW5zdGVhZCBvZiBuZXV0cmFsXCIsIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlQ29sb3JlZCwgYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlQ29sb3JlZCA9IHZhbHVlO1xuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgfSk7XG4gICAgICBpZiAoc2hvd1N1YnR5cCkgYWRkU3VidHlwVG9nZ2xlKFwiU3VidHlwIGNvbG9yXCIpO1xuXG4gICAgICBhZGRMYWJlbGVkVG9nZ2xlKFwiQXQgcHJvcGVydHkgYmxvY2tcIiwgXCJBdCB0aGUgcHJvcGVydHkgYmxvY2sgKHJvdGF0ZWQpIGluc3RlYWQgb2YgdGhlIHRpdGxlXCIsIGlzQmxvY2tQb3NpdGlvbiwgYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlUG9zaXRpb24gPSB2YWx1ZSA/IFwiYmxvY2tcIiA6IFwidGl0bGVcIjtcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoaXNCbG9ja1Bvc2l0aW9uKSB7XG4gICAgICAgIGFkZExhYmVsZWRUb2dnbGUoXG4gICAgICAgICAgXCJUb3AgaW5zdGVhZCBvZiBib3R0b21cIixcbiAgICAgICAgICBcIlRvcCBvZiB0aGUgcHJvcGVydHkgYmxvY2sgaW5zdGVhZCBvZiBib3R0b21cIixcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVWZXJ0aWNhbEFsaWduID09PSBcInRvcFwiLFxuICAgICAgICAgIGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlVmVydGljYWxBbGlnbiA9IHZhbHVlID8gXCJ0b3BcIiA6IFwiYm90dG9tXCI7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICAgIH1cbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbG9yVmlld1RvZ2dsZShcbiAgICAgIGNvbG9yaW5nR3JvdXAsXG4gICAgICBcImJhY2tsaW5rc1wiLFxuICAgICAgXCJCYWNrbGlua3NcIixcbiAgICAgIFwiQ29sb3IgcmVzdWx0cyBpbiB0aGUgYmFja2xpbmtzIHBhbmUgYW5kIGluIGVtYmVkZGVkIGJhY2tsaW5rcywgaW5jbHVkaW5nIHVubGlua2VkIG1lbnRpb25zLlwiLFxuICAgICAgXCJiYWNrbGlua3NTdWJ0eXBcIlxuICAgICk7XG4gICAgY29sb3JWaWV3VG9nZ2xlKGNvbG9yaW5nR3JvdXAsIFwiYm9va21hcmtzXCIsIFwiQm9va21hcmtzXCIsIFwiQ29sb3IgYm9va21hcmtzIHRoYXQgcG9pbnQgZGlyZWN0bHkgdG8gYSBub3RlLlwiLCBcImJvb2ttYXJrc1N1YnR5cFwiKTtcbiAgICBjb2xvclZpZXdUb2dnbGUoXG4gICAgICBjb2xvcmluZ0dyb3VwLFxuICAgICAgXCJhbGxQcm9wZXJ0aWVzXCIsXG4gICAgICBcIkFsbCBQcm9wZXJ0aWVzXCIsXG4gICAgICBcIkluIE9ic2lkaWFuJ3MgXFxcIkFsbCBwcm9wZXJ0aWVzXFxcIiB2aWV3LCBjb2xvciBwcm9wZXJ0eSBuYW1lcyB0aGF0IGJlbG9uZyB0byBleGFjdGx5IG9uZSBUWVAtRnJvbnRtYXR0ZXIsIG9yIGJvbGQgdGhlbSBpZiBtb3JlIHRoYW4gb25lIFRZUCB1c2VzIHRoZW0uIFdpdGggU3VidHlwLCBTdWJ0eXAgYmxvY2tzIGNvdW50IGFzIHdlbGwsIGluIHRoZSBTdWJ0eXAgY29sb3IuXCIsXG4gICAgICBcImFsbFByb3BlcnRpZXNTdWJ0eXBcIixcbiAgICAgIHsgdHlwVG9vbHRpcDogXCJUWVAtRnJvbnRtYXR0ZXJcIiwgc3VidHlwVG9vbHRpcDogXCJJbmNsdWRlIFN1YnR5cCBibG9ja3MsIGluIFN1YnR5cCBjb2xvclwiIH1cbiAgICApO1xuXG4gICAgLy8gTGltaXRzIG9mIHRoZSBzbGlkZXJzIGEgU3VidHlwIGRlcml2ZXMgaXRzIGNvbG9yIHdpdGggKGRvdCBhdCB0aGUgYm90dG9tXG4gICAgLy8gb2YgYSBTdWJ0eXAgYmxvY2ssIHNlZSB0eXAtY29sb3JzLmpzKS4gQSBsYXJnZXIgc3RvcmVkIG9mZnNldCBpcyBjbGFtcGVkXG4gICAgLy8gdG8gdGhlIG5ldyBsaW1pdC5cbiAgICBjb25zdCBzdWJ0eXBDb2xvckdyb3VwID0gbmV3IFNldHRpbmdHcm91cChjb250YWluZXJFbCkuc2V0SGVhZGluZyhcIlN1YnR5cCBjb2xvcnNcIik7XG4gICAgY29uc3QgcmFuZ2VNYXggPSB7IGg6IDE4MCwgLyogczogMTAwLCAqLyBsOiAxMDAgfTtcbiAgICBjb25zdCByYW5nZURlc2MgPSB7XG4gICAgICBoOiBcIk1heGltdW0gaHVlIGRpZmZlcmVuY2UgYmV0d2VlbiBhIFN1YnR5cCBhbmQgaXRzIFRZUC5cIixcbiAgICAgIC8vIHM6IFwiTWF4aW11bSBzaGFyZSBieSB3aGljaCBhIFN1YnR5cCBtYXkgYmUgcGFsZXIgdGhhbiBpdHMgVFlQLiBPbmx5IGdvZXMgZG93biAtIGEgU3VidHlwIHNob3VsZG4ndCBiZSBsb3VkZXIgdGhhbiBpdHMgVFlQLlwiLFxuICAgICAgbDogXCJNYXhpbXVtIGxpZ2h0bmVzcyBkaWZmZXJlbmNlIGJldHdlZW4gYSBTdWJ0eXAgYW5kIGl0cyBUWVAsIGFzIGEgc2hhcmUgb2YgdGhlIHdheSB0byB3aGl0ZSBvciBibGFjay5cIixcbiAgICB9O1xuICAgIC8vIFRoZSBzbGlkZXIgcmVwb3J0cyBldmVyeSBzdGVwOyB0aGUgb3RoZXIgdmlld3Mgb25seSBmb2xsb3cgb25jZSBpdCByZXN0cy5cbiAgICBjb25zdCByZWZyZXNoQ29sb3JzU29vbiA9IGRlYm91bmNlKCgpID0+IHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpLCAzMDAsIHRydWUpO1xuICAgIGZvciAoY29uc3QgeyBrZXksIGxhYmVsLCB1bml0LCBkb3duT25seSB9IG9mIFNVQlRZUF9DT0xPUl9DSEFOTkVMUykge1xuICAgICAgc3VidHlwQ29sb3JHcm91cC5hZGRTZXR0aW5nKChzZXR0aW5nKSA9PlxuICAgICAgICBzZXR0aW5nXG4gICAgICAgICAgLnNldE5hbWUoYCR7bGFiZWx9ICgke2Rvd25Pbmx5ID8gXCJcdTIyMTJcIiA6IFwiXHUwMEIxXCJ9ICR7dW5pdH0pYClcbiAgICAgICAgICAuc2V0RGVzYyhyYW5nZURlc2Nba2V5XSlcbiAgICAgICAgICAuYWRkU2xpZGVyKChzbGlkZXIpID0+XG4gICAgICAgICAgICBzbGlkZXJcbiAgICAgICAgICAgICAgLnNldExpbWl0cygwLCByYW5nZU1heFtrZXldLCAxKVxuICAgICAgICAgICAgICAuc2V0VmFsdWUoY29sb3JSYW5nZSh0aGlzLnBsdWdpbi5zZXR0aW5ncywga2V5KSlcbiAgICAgICAgICAgICAgLnNldER5bmFtaWNUb29sdGlwKClcbiAgICAgICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnN1YnR5cENvbG9yUmFuZ2VzID0geyAuLi5ERUZBVUxUX1NVQlRZUF9DT0xPUl9SQU5HRVMsIC4uLnRoaXMucGx1Z2luLnNldHRpbmdzLnN1YnR5cENvbG9yUmFuZ2VzLCBba2V5XTogdmFsdWUgfTtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgICByZWZyZXNoQ29sb3JzU29vbigpO1xuICAgICAgICAgICAgICB9KVxuICAgICAgICAgIClcbiAgICAgICAgICAuYWRkRXh0cmFCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgICAgIGJ1dHRvblxuICAgICAgICAgICAgICAuc2V0SWNvbihcInJvdGF0ZS1jY3dcIilcbiAgICAgICAgICAgICAgLnNldFRvb2x0aXAoYFJlc2V0IHRvICR7REVGQVVMVF9TVUJUWVBfQ09MT1JfUkFOR0VTW2tleV19YClcbiAgICAgICAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnN1YnR5cENvbG9yUmFuZ2VzID0geyAuLi5ERUZBVUxUX1NVQlRZUF9DT0xPUl9SQU5HRVMsIC4uLnRoaXMucGx1Z2luLnNldHRpbmdzLnN1YnR5cENvbG9yUmFuZ2VzLCBba2V5XTogREVGQVVMVF9TVUJUWVBfQ09MT1JfUkFOR0VTW2tleV0gfTtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICApXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIEdyb3VwIFwiR3JhcGhcIiAodGFnL2F0dGFjaG1lbnQgY29sb3JzKSBkaXNhYmxlZCAoMjAyNi0wOS0zMCk6IHRoZSBNaW5pbWFsXG4gICAgLy8gdGhlbWUncyBTdHlsZSBTZXR0aW5ncyBjb3ZlciBib3RoLCBzZWUgZ3JhcGgtY29sb3JzLmpzLiBDb2xvcmluZyBub3RlXG4gICAgLy8gbm9kZXMgYnkgVFlQIHN0YXlzLCB1bmRlciBcIkNvbG9yaW5nXCIgXHUyMTkyIFwiR3JhcGhcIi5cbiAgICAvLyAgICAgY29uc3QgZ3JhcGhHcm91cCA9IG5ldyBTZXR0aW5nR3JvdXAoY29udGFpbmVyRWwpLnNldEhlYWRpbmcoXCJHcmFwaFwiKTtcbiAgICAvL1xuICAgIC8vICAgICAvLyBPbmUgc2V0dGluZyBwZXIgbm9kZSBraW5kIHRoZSBncmFwaCBlbmdpbmUga25vd3MsIHNhbWUgbGF5b3V0XG4gICAgLy8gICAgIC8vICh0b2dnbGUgKyBjb2xvciBwaWNrZXIgKyByZXNldCkgZm9yIGVhY2guXG4gICAgLy8gICAgIGNvbnN0IGdyYXBoQ29sb3JTZXR0aW5nID0gKGVuYWJsZWRLZXksIGNvbG9yS2V5LCBkZWZhdWx0Q29sb3IsIG5hbWUsIGRlc2MpID0+XG4gICAgLy8gICAgICAgZ3JhcGhHcm91cC5hZGRTZXR0aW5nKChzZXR0aW5nKSA9PlxuICAgIC8vICAgICAgICAgc2V0dGluZ1xuICAgIC8vICAgICAgICAgICAuc2V0TmFtZShuYW1lKVxuICAgIC8vICAgICAgICAgICAuc2V0RGVzYyhkZXNjKVxuICAgIC8vICAgICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgLy8gICAgICAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzW2VuYWJsZWRLZXldKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAvLyAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzW2VuYWJsZWRLZXldID0gdmFsdWU7XG4gICAgLy8gICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAvLyAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgIC8vICAgICAgICAgICAgIH0pXG4gICAgLy8gICAgICAgICAgIClcbiAgICAvLyAgICAgICAgICAgLmFkZENvbG9yUGlja2VyKChwaWNrZXIpID0+XG4gICAgLy8gICAgICAgICAgICAgcGlja2VyLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzW2NvbG9yS2V5XSB8fCBkZWZhdWx0Q29sb3IpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgIC8vICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3NbY29sb3JLZXldID0gdmFsdWU7XG4gICAgLy8gICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAvLyAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgIC8vICAgICAgICAgICAgIH0pXG4gICAgLy8gICAgICAgICAgIClcbiAgICAvLyAgICAgICAgICAgLmFkZEV4dHJhQnV0dG9uKChidXR0b24pID0+XG4gICAgLy8gICAgICAgICAgICAgYnV0dG9uXG4gICAgLy8gICAgICAgICAgICAgICAuc2V0SWNvbihcInJvdGF0ZS1jY3dcIilcbiAgICAvLyAgICAgICAgICAgICAgIC5zZXRUb29sdGlwKFwiUmVzZXQgdG8gZGVmYXVsdCBjb2xvclwiKVxuICAgIC8vICAgICAgICAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgIC8vICAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5nc1tjb2xvcktleV0gPSBcIlwiO1xuICAgIC8vICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAvLyAgICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgLy8gICAgICAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgIC8vICAgICAgICAgICAgICAgfSlcbiAgICAvLyAgICAgICAgICAgKVxuICAgIC8vICAgICAgICk7XG4gICAgLy9cbiAgICAvLyAgICAgZ3JhcGhDb2xvclNldHRpbmcoXG4gICAgLy8gICAgICAgXCJncmFwaFRhZ0NvbG9yRW5hYmxlZFwiLFxuICAgIC8vICAgICAgIFwiZ3JhcGhUYWdDb2xvclwiLFxuICAgIC8vICAgICAgIFwiIzg4ODg4OFwiLFxuICAgIC8vICAgICAgIFwiVGFnIGNvbG9yXCIsXG4gICAgLy8gICAgICAgXCJPd24gY29sb3IgZm9yIHRhZyBub2RlcyBpbiB0aGUgZ2xvYmFsIGFuZCBsb2NhbCBncmFwaC4gQ29sb3IgZ3JvdXBzIHN0aWxsIHRha2UgcHJlY2VkZW5jZS5cIlxuICAgIC8vICAgICApO1xuICAgIC8vICAgICBncmFwaENvbG9yU2V0dGluZyhcbiAgICAvLyAgICAgICBcImdyYXBoQXR0YWNobWVudENvbG9yRW5hYmxlZFwiLFxuICAgIC8vICAgICAgIFwiZ3JhcGhBdHRhY2htZW50Q29sb3JcIixcbiAgICAvLyAgICAgICBcIiNlMGFjMDBcIixcbiAgICAvLyAgICAgICBcIkF0dGFjaG1lbnQgY29sb3JcIixcbiAgICAvLyAgICAgICBcIk93biBjb2xvciBmb3IgYXR0YWNobWVudCBub2RlcyAobm9uLW1hcmtkb3duIGZpbGVzIHN1Y2ggYXMgaW1hZ2VzIG9yIFBERnMpIGluIHRoZSBncmFwaC5cIlxuICAgIC8vICAgICApO1xuXG4gICAgY29uc3QgZnJvbnRtYXR0ZXJHcm91cCA9IG5ldyBTZXR0aW5nR3JvdXAoY29udGFpbmVyRWwpLnNldEhlYWRpbmcoXCJUWVAtRnJvbnRtYXR0ZXJcIik7XG5cbiAgICBjb2xvclZpZXdUb2dnbGUoXG4gICAgICBmcm9udG1hdHRlckdyb3VwLFxuICAgICAgXCJmcm9udG1hdHRlckRlZmF1bHRzXCIsXG4gICAgICBcIkJvbGQgVFlQIHByb3BlcnRpZXNcIixcbiAgICAgIFwiU2hvdyBUWVAtRnJvbnRtYXR0ZXIgcHJvcGVydHkgbmFtZXMgaW4gYm9sZCBpbiBub3RlcyBhbmQgdGhlIHByb3BlcnRpZXMgc2lkZWJhci4gV2l0aCBTdWJ0eXAsIHRoZSBub3RlJ3MgU3VidHlwIGJsb2NrIGNvdW50cyBhcyB3ZWxsLlwiLFxuICAgICAgXCJmcm9udG1hdHRlckRlZmF1bHRzU3VidHlwXCIsXG4gICAgICB7IHR5cFRvb2x0aXA6IFwiVFlQLUZyb250bWF0dGVyXCIsIHN1YnR5cFRvb2x0aXA6IFwiSW5jbHVkZSBTdWJ0eXAgYmxvY2tzXCIgfVxuICAgICk7XG5cbiAgICAvLyBUaGUgb3JkZXIgZWRpdG9yIGJyaW5ncyBpdHMgb3duIGhlYWRpbmcgYW5kIGJ1dHRvbnMsIHNvIGl0IGdvZXMgc3RyYWlnaHRcbiAgICAvLyBpbnRvIGluZm9FbCBpbnN0ZWFkIG9mIHNldE5hbWUvc2V0RGVzYyAoc2VlIC50eXAtb3JkZXItc2V0dGluZykuXG4gICAgZnJvbnRtYXR0ZXJHcm91cC5hZGRTZXR0aW5nKChzZXR0aW5nKSA9PiB7XG4gICAgICBzZXR0aW5nLnNldHRpbmdFbC5hZGRDbGFzcyhcInR5cC1vcmRlci1zZXR0aW5nXCIpO1xuICAgICAgbW91bnRHbG9iYWxPcmRlckVkaXRvcihzZXR0aW5nLmluZm9FbCwgdGhpcy5wbHVnaW4pO1xuICAgICAgc2V0dGluZy5pbmZvRWwuY3JlYXRlRGl2KHtcbiAgICAgICAgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiLFxuICAgICAgICB0ZXh0OlxuICAgICAgICAgICdPcmRlciBhcHBsaWVkIGJ5IHRoZSBcIlNvcnQgZnJvbnRtYXR0ZXJcIiBjb21tYW5kczsgdmFsdWVzIGFyZSBuZXZlciBjaGFuZ2VkLiBQaW4gc2luZ2xlIHByb3BlcnRpZXMgc3VjaCBhcyBjc3NjbGFzc2VzIG9yIGFsaWFzZXMuIFRZUCBhbmQgU1VCVFlQIGFyZSB0aGUgcHJvcGVydGllcyB0aGVtc2VsdmVzLCBcIlRZUC1Gcm9udG1hdHRlclwiIGlzIHRoZSBUWVBcXCdzIGxpc3QgZm9sbG93ZWQgYnkgaXRzIFN1YnR5cCBibG9jaywgXCJPdGhlciBwcm9wZXJ0aWVzXCIgaXMgZXZlcnl0aGluZyBlbHNlLiBEcmFnIHRvIHJlb3JkZXI7IHRoZSBmb3VyIHBsYWNlaG9sZGVyIHJvd3MgY2FuXFwndCBiZSByZW1vdmVkLicsXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGNvbnRhaW5lckVsLnNjcm9sbFRvcCA9IHNjcm9sbFRvcDtcbiAgfVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgREVGQVVMVF9TRVRUSU5HUywgVHlwU3lzdGVtU2V0dGluZ1RhYiB9O1xuIiwgImNvbnN0IHsgTW9kYWwsIFNldHRpbmcgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgcGx1cmFsIH0gPSByZXF1aXJlKFwiLi90eXAtdXRpbHNcIik7XG5cbi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICogVGhlIHR3byBkaWFsb2dzIG9mIHRoZSBCYXNlIGNvbW1hbmRzIChzZWUgYmFzZXMuanMpOlxuICogIC0gY29sdW1uIG9wdGlvbnMgYmVmb3JlIGNyZWF0aW5nL3VwZGF0aW5nXG4gKiAgLSBjb25maXJtaW5nIHJlbW92YWxzIHdoZW4gdXBkYXRpbmdcbiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqL1xuXG5jb25zdCBOT1RFX1BSRUZJWCA9IFwibm90ZS5cIjtcblxuLy8gQ29sdW1uIGxhYmVsOiB0aGUgc2hvcnQgZm9ybSB0aGUgcHJvcGVydHkgaGFzIGluIHRoZSAuYmFzZSBmaWxlXG4vLyAoXCJUaXRlbFwiIGluc3RlYWQgb2YgXCJub3RlLlRpdGVsXCIpLlxuZnVuY3Rpb24gY29sdW1uTGFiZWwoaWQpIHtcbiAgcmV0dXJuIGlkLnN0YXJ0c1dpdGgoTk9URV9QUkVGSVgpID8gaWQuc2xpY2UoTk9URV9QUkVGSVgubGVuZ3RoKSA6IGlkO1xufVxuXG5mdW5jdGlvbiB0YXJnZXRMYWJlbCh0YXJnZXQpIHtcbiAgaWYgKCF0YXJnZXQudHlwKSByZXR1cm4gYFN1YnR5cCAke3RhcmdldC5zdWJ0eXB9YDtcbiAgcmV0dXJuIHRhcmdldC5zdWJ0eXAgPyBgJHt0YXJnZXQudHlwfSAvICR7dGFyZ2V0LnN1YnR5cH1gIDogYFRZUCAke3RhcmdldC50eXB9YDtcbn1cblxuLyogLS0tIENvbHVtbiBvcHRpb25zIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuXG4vLyBUaHJlZSB0b2dnbGVzLCBhbGwgb2ZmIGJ5IGRlZmF1bHQgKGZpbGUubmFtZSBwbHVzIFRZUC1Gcm9udG1hdHRlciBpcyB0aGVcbi8vIG5vcm1hbCBjYXNlKSwgd2l0aCBhIGxpdmUgcHJldmlldyBvZiB0aGUgcmVzdWx0aW5nIGNvbHVtbnMgc28gYSB0b2dnbGUnc1xuLy8gZWZmZWN0IG5lZWRuJ3QgYmUgZ3Vlc3NlZC4gXCJBbGwgU3VidHlwIHByb3BlcnRpZXNcIiBvbmx5IHNob3dzIGZvciBhIFRZUFxuLy8gdGFyZ2V0OiBpbiBhIFN1YnR5cCB2aWV3IHRoZSBvdGhlciBTdWJ0eXAgYmxvY2tzIHdvdWxkIHN0YXkgZW1wdHkuXG5jbGFzcyBDb2x1bW5PcHRpb25zTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKHBsdWdpbiwgdGFyZ2V0LCBwcmV2aWV3LCByZXNvbHZlKSB7XG4gICAgc3VwZXIocGx1Z2luLmFwcCk7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gICAgdGhpcy50YXJnZXQgPSB0YXJnZXQ7XG4gICAgdGhpcy5wcmV2aWV3ID0gcHJldmlldztcbiAgICB0aGlzLnJlc29sdmUgPSByZXNvbHZlO1xuICAgIHRoaXMub3B0aW9ucyA9IHsgZmxvYXRpbmc6IGZhbHNlLCBhbGxTdWJ0eXBzOiBmYWxzZSwgdGFnczogZmFsc2UgfTtcbiAgICB0aGlzLmNvbmZpcm1lZCA9IGZhbHNlO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIHRoaXMubW9kYWxFbC5hZGRDbGFzcyhcInR5cC1iYXNlLW9wdGlvbnMtbW9kYWxcIik7XG4gICAgdGhpcy50aXRsZUVsLnNldFRleHQoYENvbHVtbnMgZm9yICR7dGFyZ2V0TGFiZWwodGhpcy50YXJnZXQpfWApO1xuXG4gICAgY29uc3QgdG9nZ2xlID0gKG5hbWUsIGRlc2NyaXB0aW9uLCBrZXkpID0+IHtcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcbiAgICAgICAgLnNldE5hbWUobmFtZSlcbiAgICAgICAgLnNldERlc2MoZGVzY3JpcHRpb24pXG4gICAgICAgIC5hZGRUb2dnbGUoKGNvbnRyb2wpID0+XG4gICAgICAgICAgY29udHJvbC5zZXRWYWx1ZSh0aGlzLm9wdGlvbnNba2V5XSkub25DaGFuZ2UoKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLm9wdGlvbnNba2V5XSA9IHZhbHVlO1xuICAgICAgICAgICAgdGhpcy5yZW5kZXJQcmV2aWV3KCk7XG4gICAgICAgICAgfSlcbiAgICAgICAgKTtcbiAgICB9O1xuXG4gICAgdG9nZ2xlKFwiRmxvYXRpbmcgcHJvcGVydGllc1wiLCBcIkluY2x1ZGUgdGhlIGJsb2NrJ3MgZmxvYXRpbmcgKGl0YWxpYykgcHJvcGVydGllcy5cIiwgXCJmbG9hdGluZ1wiKTtcbiAgICBpZiAoIXRoaXMudGFyZ2V0LnN1YnR5cCkge1xuICAgICAgdG9nZ2xlKFwiQWxsIFN1YnR5cCBwcm9wZXJ0aWVzXCIsIFwiQWxzbyBpbmNsdWRlIHRoZSBwcm9wZXJ0aWVzIG9mIGV2ZXJ5IFN1YnR5cCBibG9jayBvZiB0aGlzIFRZUC5cIiwgXCJhbGxTdWJ0eXBzXCIpO1xuICAgIH1cbiAgICB0b2dnbGUoXCJ0YWdzXCIsIFwiQWRkIHRoZSB0YWdzIHByb3BlcnR5IGFzIGEgY29sdW1uLlwiLCBcInRhZ3NcIik7XG5cbiAgICB0aGlzLnByZXZpZXdFbCA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWJhc2UtcHJldmlld1wiIH0pO1xuICAgIHRoaXMucmVuZGVyUHJldmlldygpO1xuXG4gICAgY29uc3QgYnV0dG9uUm93ID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJtb2RhbC1idXR0b24tY29udGFpbmVyXCIgfSk7XG4gICAgYnV0dG9uUm93LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJDYW5jZWxcIiB9KS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5jbG9zZSgpKTtcbiAgICBjb25zdCBjb25maXJtID0gYnV0dG9uUm93LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgY2xzOiBcIm1vZC1jdGFcIiwgdGV4dDogXCJBcHBseVwiIH0pO1xuICAgIGNvbmZpcm0uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIHRoaXMuY29uZmlybWVkID0gdHJ1ZTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICB9KTtcbiAgfVxuXG4gIHJlbmRlclByZXZpZXcoKSB7XG4gICAgY29uc3QgaWRzID0gdGhpcy5wcmV2aWV3KHRoaXMub3B0aW9ucyk7XG4gICAgdGhpcy5wcmV2aWV3RWwuZW1wdHkoKTtcbiAgICB0aGlzLnByZXZpZXdFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWJhc2UtcHJldmlldy10aXRsZVwiLCB0ZXh0OiBwbHVyYWwoaWRzLmxlbmd0aCwgXCJjb2x1bW5cIikgfSk7XG4gICAgY29uc3QgbGlzdCA9IHRoaXMucHJldmlld0VsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtYmFzZS1wcmV2aWV3LWxpc3RcIiB9KTtcbiAgICBmb3IgKGNvbnN0IGlkIG9mIGlkcykgbGlzdC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1iYXNlLXByZXZpZXctY29sdW1uXCIsIHRleHQ6IGNvbHVtbkxhYmVsKGlkKSB9KTtcbiAgfVxuXG4gIG9uQ2xvc2UoKSB7XG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcbiAgICAvLyBFU0Mgb3IgYSBjbGljayBvdXRzaWRlIGNvdW50cyBhcyBjYW5jZWwuXG4gICAgdGhpcy5yZXNvbHZlKHRoaXMuY29uZmlybWVkID8gdGhpcy5vcHRpb25zIDogbnVsbCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gYXNrQ29sdW1uT3B0aW9ucyhwbHVnaW4sIHRhcmdldCwgcHJldmlldykge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IG5ldyBDb2x1bW5PcHRpb25zTW9kYWwocGx1Z2luLCB0YXJnZXQsIHByZXZpZXcsIHJlc29sdmUpLm9wZW4oKSk7XG59XG5cbi8qIC0tLSBDb25maXJtIHJlbW92YWxzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuLy8gQWRkaW5nIGFuZCByZW9yZGVyaW5nIGNvbHVtbnMgaGFwcGVuIHNpbGVudGx5OyBvbmx5IHJlbW92aW5nIGlzIHNob3duLFxuLy8gYmVjYXVzZSBvbmx5IHRoYXQgbG9zZXMgc29tZXRoaW5nLiBFdmVyeSBlbnRyeSBzdGFydHMgY2hlY2tlZDsgYW4gdW5jaGVja2VkXG4vLyBjb2x1bW4gaXMga2VwdCAoYXQgdGhlIGZyb250LCBzZWUgdXBkYXRlQWN0aXZlVmlldykuXG5jbGFzcyBSZW1vdmFsTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKHBsdWdpbiwgY29sdW1ucywgdmlld05hbWUsIHJlc29sdmUpIHtcbiAgICBzdXBlcihwbHVnaW4uYXBwKTtcbiAgICB0aGlzLmNvbHVtbnMgPSBjb2x1bW5zO1xuICAgIHRoaXMudmlld05hbWUgPSB2aWV3TmFtZTtcbiAgICB0aGlzLnJlc29sdmUgPSByZXNvbHZlO1xuICAgIHRoaXMubWFya2VkID0gbmV3IFNldChjb2x1bW5zKTtcbiAgICB0aGlzLmNvbmZpcm1lZCA9IGZhbHNlO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIHRoaXMubW9kYWxFbC5hZGRDbGFzcyhcInR5cC1iYXNlLXJlbW92YWwtbW9kYWxcIik7XG4gICAgdGhpcy50aXRsZUVsLnNldFRleHQoYFJlbW92ZSBjb2x1bW5zIGZyb20gXCIke3RoaXMudmlld05hbWV9XCJgKTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgIGNsczogXCJ0eXAtYmFzZS1yZW1vdmFsLWludHJvXCIsXG4gICAgICB0ZXh0OiBcIlRoZXNlIGNvbHVtbnMgZG9uJ3QgYmVsb25nIHRvIHRoZSBUWVAuIFVuY2hlY2tlZCBvbmVzIGFyZSBrZXB0LlwiLFxuICAgIH0pO1xuXG4gICAgZm9yIChjb25zdCBpZCBvZiB0aGlzLmNvbHVtbnMpIHtcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbCkuc2V0TmFtZShjb2x1bW5MYWJlbChpZCkpLmFkZFRvZ2dsZSgoY29udHJvbCkgPT5cbiAgICAgICAgY29udHJvbC5zZXRWYWx1ZSh0cnVlKS5vbkNoYW5nZSgodmFsdWUpID0+IHtcbiAgICAgICAgICBpZiAodmFsdWUpIHRoaXMubWFya2VkLmFkZChpZCk7XG4gICAgICAgICAgZWxzZSB0aGlzLm1hcmtlZC5kZWxldGUoaWQpO1xuICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9XG5cbiAgICBjb25zdCBidXR0b25Sb3cgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcIm1vZGFsLWJ1dHRvbi1jb250YWluZXJcIiB9KTtcbiAgICBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkNhbmNlbFwiIH0pLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xuICAgIGNvbnN0IGNvbmZpcm0gPSBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IFwibW9kLWN0YVwiLCB0ZXh0OiBcIkFwcGx5XCIgfSk7XG4gICAgY29uZmlybS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5jb25maXJtZWQgPSB0cnVlO1xuICAgICAgdGhpcy5jbG9zZSgpO1xuICAgIH0pO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIHRoaXMucmVzb2x2ZSh0aGlzLmNvbmZpcm1lZCA/IHRoaXMubWFya2VkIDogbnVsbCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gYXNrUmVtb3ZhbHMocGx1Z2luLCBjb2x1bW5zLCB2aWV3TmFtZSkge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IG5ldyBSZW1vdmFsTW9kYWwocGx1Z2luLCBjb2x1bW5zLCB2aWV3TmFtZSwgcmVzb2x2ZSkub3BlbigpKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IGFza0NvbHVtbk9wdGlvbnMsIGFza1JlbW92YWxzIH07XG4iLCAiY29uc3QgeyBOb3RpY2UsIFRGaWxlLCBzdHJpbmdpZnlZYW1sIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IGdldFN1YnR5cE5hbWVzIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBzXCIpO1xuY29uc3QgeyBub3JtYWxpemVHbG9iYWxPcmRlciwgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLXNvcnRcIik7XG5jb25zdCB7IGFza0NvbHVtbk9wdGlvbnMsIGFza1JlbW92YWxzIH0gPSByZXF1aXJlKFwiLi9iYXNlLWRpYWxvZ3NcIik7XG5jb25zdCB7IHBsdXJhbCB9ID0gcmVxdWlyZShcIi4vdHlwLXV0aWxzXCIpO1xuXG4vKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAqIEJhc2VzIGZyb20gYSBUWVBcbiAqIENyZWF0ZXMgYSAuYmFzZSBpbiB0aGUgdmF1bHQgcm9vdCBmb3IgYSBUWVAgKG9yIGEgU3VidHlwIG5hbWUpOlxuICogYSBUWVAgZmlsdGVyLCBvbmUgdGFibGUgdmlldyBwZXIgU3VidHlwLCBhbmQgY29sdW1ucyBmcm9tIHRoZVxuICogVFlQLUZyb250bWF0dGVyIHBsdXMgdGhlIGdsb2JhbCBwcm9wZXJ0eSBvcmRlci4gVGhlIHNlY29uZFxuICogY29tbWFuZCBicmluZ3MgdGhlIGNvbHVtbnMgb2YgYW4gZXhpc3RpbmcgdmlldyB1cCB0byBkYXRlLlxuICpcbiAqIFdyaXRlcyBvbmx5IHRocm91Z2ggT2JzaWRpYW4ncyBvd24gQmFzZXMgQVBJIGFuZCBzZXJpYWxpemF0aW9uXG4gKiAoc2VlIGFwcGVuZFZpZXdzKSwgbmV2ZXIgdGhyb3VnaCBzZWxmLXBhcnNlZCBZQU1MIC0gZm9ybXVsYVxuICogYmxvY2tzIGFuZCBzcGVjaWFsIGtleXMgd291bGRuJ3QgcmVsaWFibHkgc3Vydml2ZSB0aGUgcm91bmQgdHJpcC5cbiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqL1xuXG4vLyBWaWV3IHByb3BlcnR5IGlkcyBhcmUgZnVsbHkgcXVhbGlmaWVkIGluIG1lbW9yeSAoXCJub3RlLlRpdGVsXCIsIFwiZmlsZS5uYW1lXCIsXG4vLyBcImZvcm11bGEuWFwiKSBidXQgc3RvcmVkIHdpdGhvdXQgXCJub3RlLlwiIGluIHRoZSBmaWxlLiBjZmcuc2V0T3JkZXIoKSB3YW50c1xuLy8gdGhlIHF1YWxpZmllZCBmb3JtLCBhIHZpZXcgb2JqZWN0IGJ1aWx0IGZvciB0aGUgZmlsZSB0aGUgc2hvcnQgb25lIC1cbi8vIHNlcmlhbGl6ZUlkKCkgY29udmVydHMuXG5jb25zdCBGSUxFX05BTUVfSUQgPSBcImZpbGUubmFtZVwiO1xuY29uc3QgTk9URV9QUkVGSVggPSBcIm5vdGUuXCI7XG5jb25zdCBUQUdTX1BST1BFUlRZID0gXCJ0YWdzXCI7XG5jb25zdCBCQVNFX0VYVEVOU0lPTiA9IFwiYmFzZVwiO1xuLy8gSWQgb2YgdGhlIEJhc2VzIGNvcmUgcGx1Z2luIChhcyBpbiAub2JzaWRpYW4vY29yZS1wbHVnaW5zLmpzb24pLlxuY29uc3QgQkFTRVNfUExVR0lOX0lEID0gXCJiYXNlc1wiO1xuXG4vLyBXaXRob3V0IHRoZSBCYXNlcyBjb3JlIHBsdWdpbiBhIC5iYXNlIGZpbGUgY2FuJ3QgYmUgb3BlbmVkLCBzbyBjcmVhdGluZyBvbmVcbi8vIHdvdWxkIG9ubHkgbGVhdmUgYSBkZWFkIGZpbGUgYmVoaW5kIChzZWUgXCJjcmVhdGUtYmFzZS1mb3ItdHlwXCIgaW5cbi8vIGNvbW1hbmRzLmpzKS5cbmZ1bmN0aW9uIGlzQmFzZXNFbmFibGVkKGFwcCkge1xuICByZXR1cm4gISFhcHAuaW50ZXJuYWxQbHVnaW5zPy5nZXRFbmFibGVkUGx1Z2luQnlJZD8uKEJBU0VTX1BMVUdJTl9JRCk7XG59XG5cbmZ1bmN0aW9uIG5vdGVJZChrZXkpIHtcbiAgcmV0dXJuIE5PVEVfUFJFRklYICsga2V5O1xufVxuXG5mdW5jdGlvbiBzZXJpYWxpemVJZChpZCkge1xuICByZXR1cm4gaWQuc3RhcnRzV2l0aChOT1RFX1BSRUZJWCkgPyBpZC5zbGljZShOT1RFX1BSRUZJWC5sZW5ndGgpIDogaWQ7XG59XG5cbmZ1bmN0aW9uIHNhbWVJZChhLCBiKSB7XG4gIHJldHVybiBhLnRvTG93ZXJDYXNlKCkgPT09IGIudG9Mb3dlckNhc2UoKTtcbn1cblxuLy8gQSBmaWx0ZXIgZXhwcmVzc2lvbiB0aGUgd2F5IEJhc2VzIHdyaXRlcyBpdDogVFlQID09IFwiTUVESUFcIi4gSlNPTi5zdHJpbmdpZnlcbi8vIHF1b3RlcyBjb3JyZWN0bHkgZXZlbiBpZiB0aGUgbmFtZSBjb250YWlucyBhIHF1b3RlLlxuZnVuY3Rpb24gZXF1YWxzRmlsdGVyKHByb3BlcnR5LCB2YWx1ZSkge1xuICByZXR1cm4gYCR7cHJvcGVydHl9ID09ICR7SlNPTi5zdHJpbmdpZnkoU3RyaW5nKHZhbHVlKSl9YDtcbn1cblxuLyogLS0tIFJlYWRpbmcgVFlQL1N1YnR5cCBmcm9tIGFuIGV4aXN0aW5nIGZpbHRlciAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICogQSBnZW5lcmF0ZWQgdmlldyBjYXJyaWVzIGl0cyBUWVAgaW4gdGhlIHJvb3Qgb3IgdmlldyBmaWx0ZXI7IHRoZSB1cGRhdGVcbiAqIGNvbW1hbmQgcmVhZHMgaXQgZnJvbSB0aGVyZSBpbnN0ZWFkIG9mIGFza2luZy4gT25seSB1bmFtYmlndW91cyBmaWx0ZXJzXG4gKiBjb3VudDogYSBwdXJlIEFORCB3aXRoIGV4YWN0bHkgb25lIFRZUCBvciBTVUJUWVAgY29tcGFyaXNvbi4gQW4gT1IgZ3JvdXBcbiAqIGRvZXNuJ3QgbmVjZXNzYXJpbHkgcmVzdHJpY3QsIGFuZCBhIHNlY29uZCwgZGlmZmVyZW50IHZhbHVlIGNvbnRyYWRpY3RzIC1cbiAqIGJvdGggZ2l2ZSBudWxsIGFuZCB0aGUgY29tbWFuZCBhc2tzIGluc3RlYWQgKHNlZSB1cGRhdGVBY3RpdmVWaWV3KS5cbiAqIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuY29uc3QgRVFVQUxTX1BBVFRFUk4gPSBuZXcgUmVnRXhwKGBeXFxcXHMqKCR7VFlQX1BST1BFUlRZfXwke1NVQlRZUF9QUk9QRVJUWX0pXFxcXHMqPT1cXFxccyooLis/KVxcXFxzKiRgLCBcImlcIik7XG5cbmZ1bmN0aW9uIGZpbHRlckxpdGVyYWwocmF3KSB7XG4gIGlmIChyYXcubGVuZ3RoID49IDIgJiYgcmF3WzBdID09PSAnXCInICYmIHJhdy5lbmRzV2l0aCgnXCInKSkge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gSlNPTi5wYXJzZShyYXcpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICB9XG4gIGlmIChyYXcubGVuZ3RoID49IDIgJiYgcmF3WzBdID09PSBcIidcIiAmJiByYXcuZW5kc1dpdGgoXCInXCIpKSByZXR1cm4gcmF3LnNsaWNlKDEsIC0xKTtcbiAgcmV0dXJuIG51bGw7XG59XG5cbmZ1bmN0aW9uIGNvbGxlY3RFcXVhbHMobm9kZSwgZm91bmQpIHtcbiAgaWYgKCFub2RlKSByZXR1cm47XG4gIGlmICh0eXBlb2Ygbm9kZSA9PT0gXCJzdHJpbmdcIikge1xuICAgIGNvbnN0IG1hdGNoID0gRVFVQUxTX1BBVFRFUk4uZXhlYyhub2RlKTtcbiAgICBpZiAoIW1hdGNoKSByZXR1cm47XG4gICAgY29uc3QgdmFsdWUgPSBmaWx0ZXJMaXRlcmFsKG1hdGNoWzJdKTtcbiAgICBpZiAodmFsdWUgIT09IG51bGwpIGZvdW5kW21hdGNoWzFdLnRvVXBwZXJDYXNlKCldLmFkZCh2YWx1ZSk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmIChBcnJheS5pc0FycmF5KG5vZGUpKSB7XG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBub2RlKSBjb2xsZWN0RXF1YWxzKGVudHJ5LCBmb3VuZCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIEFORCBvbmx5OiBhbiBPUi9OT1QgZ3JvdXAgc2F5cyBub3RoaW5nIHJlbGlhYmxlIGFib3V0IHRoZSBUWVAgb2YgdGhlIGhpdHMuXG4gIGlmIChub2RlLmFuZCkgY29sbGVjdEVxdWFscyhub2RlLmFuZCwgZm91bmQpO1xufVxuXG5mdW5jdGlvbiByZWFkVGFyZ2V0KC4uLmZpbHRlckdyb3Vwcykge1xuICBjb25zdCBmb3VuZCA9IHsgW1RZUF9QUk9QRVJUWV06IG5ldyBTZXQoKSwgW1NVQlRZUF9QUk9QRVJUWV06IG5ldyBTZXQoKSB9O1xuICBmb3IgKGNvbnN0IGdyb3VwIG9mIGZpbHRlckdyb3VwcykgY29sbGVjdEVxdWFscyhncm91cCwgZm91bmQpO1xuICBjb25zdCB0eXBzID0gWy4uLmZvdW5kW1RZUF9QUk9QRVJUWV1dO1xuICBjb25zdCBzdWJ0eXBzID0gWy4uLmZvdW5kW1NVQlRZUF9QUk9QRVJUWV1dO1xuICBpZiAodHlwcy5sZW5ndGggPiAxIHx8IHN1YnR5cHMubGVuZ3RoID4gMSkgcmV0dXJuIG51bGw7XG4gIGlmICh0eXBzLmxlbmd0aCA9PT0gMCAmJiBzdWJ0eXBzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IHR5cDogdHlwc1swXSA/PyBudWxsLCBzdWJ0eXA6IHN1YnR5cHNbMF0gPz8gbnVsbCB9O1xufVxuXG4vKiAtLS0gQ29sdW1ucyBvZiBhIHRhcmdldCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbi8vIFRZUCBhbmQgU1VCVFlQIG5ldmVyIGJlY29tZSBjb2x1bW5zIChmaWx0ZXIgYW5kIGdyb3VwaW5nIGFscmVhZHkgc2hvd1xuLy8gdGhlbSksIG5vciBkb2VzIHRoZSBlZGl0b3IncyBibGFuayByb3cuXG5mdW5jdGlvbiBpc1N5c3RlbUtleShrZXkpIHtcbiAgcmV0dXJuIGtleSA9PT0gXCJcIiB8fCBzYW1lSWQoa2V5LCBUWVBfUFJPUEVSVFkpIHx8IHNhbWVJZChrZXksIFNVQlRZUF9QUk9QRVJUWSk7XG59XG5cbi8vIEEgYmxvY2sncyBwcm9wZXJ0aWVzIGluIHN0b3JlZCBvcmRlciwgdmlhIGNvbGxlY3RCbG9ja3MoKSAobWFpbi5qcyksIHNvIHRoZVxuLy8gc2FtZSBydWxlcyBhcHBseTogdGhlIFN1YnR5cCBibG9jayBmb2xsb3dzIHRoZSBUWVAtRnJvbnRtYXR0ZXIsIGEga2V5IGluIGJvdGhcbi8vIGtlZXBzIHRoZSBUWVAtRnJvbnRtYXR0ZXIgcG9zaXRpb24sIGFuZCB0aGUgU3VidHlwJ3MgZmxvYXRpbmcgZmxhZyB3aW5zIC0gYVxuLy8gU3VidHlwIGNhbiBrZWVwIGEgc3RhbmRhcmQgcHJvcGVydHkgb3V0IG9mIGl0cyB2aWV3IHRoYXQgd2F5LlxuZnVuY3Rpb24gYmxvY2tLZXlzKHBsdWdpbiwgdHlwLCBzdWJ0eXAsIGluY2x1ZGVGbG9hdGluZykge1xuICBjb25zdCB7IGRlZmF1bHRzIH0gPSBwbHVnaW4uY29sbGVjdEJsb2Nrcyh0eXAsIHN1YnR5cCwgaW5jbHVkZUZsb2F0aW5nKTtcbiAgcmV0dXJuIE9iamVjdC5rZXlzKGRlZmF1bHRzKS5maWx0ZXIoKGtleSkgPT4gIWlzU3lzdGVtS2V5KGtleSkpO1xufVxuXG4vLyBFdmVyeSBUWVAgdGhhdCBoYXMgYSBTdWJ0eXAgb2YgdGhpcyBuYW1lLCBpbiBUWVAtTGlzdCBvcmRlci4gVGhlIHNhbWVcbi8vIFN1YnR5cCBuYW1lIG1heSBleGlzdCB1bmRlciBzZXZlcmFsIFRZUCBlbnRyaWVzOyBhIHN0YW5kYWxvbmUgU3VidHlwIEJhc2Vcbi8vIGZpbHRlcnMgYnkgU1VCVFlQIG9ubHkgYW5kIHNvIHNob3dzIGFsbCBvZiB0aGVtLlxuZnVuY3Rpb24gdHlwc0ZvclN1YnR5cChwbHVnaW4sIHN1YnR5cCkge1xuICByZXR1cm4gcGx1Z2luLnNldHRpbmdzLnR5cHMuZmlsdGVyKCh0eXApID0+IGdldFN1YnR5cE5hbWVzKHBsdWdpbi5zZXR0aW5ncywgdHlwKS5pbmNsdWRlcyhzdWJ0eXApKTtcbn1cblxuLy8gQSB0YXJnZXQgaXMgeyB0eXAsIHN1YnR5cCB9OlxuLy8gICB7IHR5cCwgc3VidHlwOiBudWxsIH0gIC0gdGhlIFRZUCBpdHNlbGZcbi8vICAgeyB0eXAsIHN1YnR5cCB9ICAgICAgICAtIGEgU3VidHlwIHdpdGhpbiBpdHMgVFlQXG4vLyAgIHsgdHlwOiBudWxsLCBzdWJ0eXAgfSAgLSBhIFN1YnR5cCBuYW1lIG5vdCBib3VuZCB0byBhIFRZUCAoc3RhbmRhbG9uZVxuLy8gICAgICAgICAgICAgICAgICAgICAgICAgICAgU3VidHlwIEJhc2UsIGNvbHVtbnMgbWVyZ2VkIGFjcm9zcyBUWVAgZW50cmllcylcbmZ1bmN0aW9uIHRhcmdldEtleXMocGx1Z2luLCB0YXJnZXQsIG9wdGlvbnMpIHtcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQoKTtcbiAgY29uc3QgbWFpbiA9IFtdO1xuICBjb25zdCBvdGhlcnMgPSBbXTtcbiAgY29uc3QgYWRkID0gKGxpc3QsIGtleXMpID0+IHtcbiAgICBmb3IgKGNvbnN0IGtleSBvZiBrZXlzKSB7XG4gICAgICBjb25zdCBsb3dlciA9IGtleS50b0xvd2VyQ2FzZSgpO1xuICAgICAgaWYgKHNlZW4uaGFzKGxvd2VyKSkgY29udGludWU7XG4gICAgICBzZWVuLmFkZChsb3dlcik7XG4gICAgICBsaXN0LnB1c2goa2V5KTtcbiAgICB9XG4gIH07XG5cbiAgaWYgKCF0YXJnZXQudHlwKSB7XG4gICAgZm9yIChjb25zdCB0eXAgb2YgdHlwc0ZvclN1YnR5cChwbHVnaW4sIHRhcmdldC5zdWJ0eXApKSB7XG4gICAgICBhZGQobWFpbiwgYmxvY2tLZXlzKHBsdWdpbiwgdHlwLCB0YXJnZXQuc3VidHlwLCBvcHRpb25zLmZsb2F0aW5nKSk7XG4gICAgfVxuICAgIHJldHVybiB7IG1haW4sIG90aGVycyB9O1xuICB9XG5cbiAgYWRkKG1haW4sIGJsb2NrS2V5cyhwbHVnaW4sIHRhcmdldC50eXAsIHRhcmdldC5zdWJ0eXAsIG9wdGlvbnMuZmxvYXRpbmcpKTtcbiAgLy8gT25seSBmb3IgdGhlIFRZUCB2aWV3OiBpbiBhIFN1YnR5cCB2aWV3IHRoZSBvdGhlciBibG9ja3Mgd291bGQgc3RheSBlbXB0eSxcbiAgLy8gc2luY2UgYSBub3RlIGhhcyBhdCBtb3N0IG9uZSBTVUJUWVAuIEtleXMgYWxyZWFkeSBpbiBtYWluIGRyb3Agb3V0IHZpYVxuICAvLyBcInNlZW5cIi5cbiAgaWYgKG9wdGlvbnMuYWxsU3VidHlwcyAmJiAhdGFyZ2V0LnN1YnR5cCkge1xuICAgIGZvciAoY29uc3Qgc3VidHlwIG9mIGdldFN1YnR5cE5hbWVzKHBsdWdpbi5zZXR0aW5ncywgdGFyZ2V0LnR5cCkpIHtcbiAgICAgIGFkZChvdGhlcnMsIGJsb2NrS2V5cyhwbHVnaW4sIHRhcmdldC50eXAsIHN1YnR5cCwgb3B0aW9ucy5mbG9hdGluZykpO1xuICAgIH1cbiAgfVxuICByZXR1cm4geyBtYWluLCBvdGhlcnMgfTtcbn1cblxuLy8gVGhlIGZpbmFsIGNvbHVtbiBsaXN0OiBmaWxlLm5hbWUgZmlyc3QsIHRoZW4gdGhlIGdsb2JhbCBwcm9wZXJ0eSBvcmRlciBhc1xuLy8gdGhlIGZyYW1lLiBJdHMgcGxhY2Vob2xkZXJzIG1lYW4gaGVyZTpcbi8vICAgXCJ0eXBcIiAgICAgICAgICAgICAgICAgICAgIC0gVFlQLUZyb250bWF0dGVyIHBsdXMgdGhlIHRhcmdldCdzIFN1YnR5cCBibG9ja1xuLy8gICBcIm90aGVyXCIgICAgICAgICAgICAgICAgICAgLSB0aGUgcHJvcGVydGllcyBvZiB0aGUgb3RoZXIgU3VidHlwIGJsb2Nrc1xuLy8gICBcInR5cFZhbHVlXCIvXCJzdWJ0eXBWYWx1ZVwiICAtIHNraXBwZWQsIFRZUC9TVUJUWVAgYXJlIG5vIGNvbHVtbnNcbi8vIE9mIHRoZSBwaW5uZWQgcHJvcGVydGllcyBvbmx5IHRhZ3MgY291bnRzIChhbmQgb25seSB3aGVuIGNoZWNrZWQpOlxuLy8gY3NzY2xhc3NlcyBvciBhbGlhc2VzIG1ha2Ugbm8gc2Vuc2UgYXMgY29sdW1ucyBvZiBhbiBvdmVydmlldyB0YWJsZS5cbmZ1bmN0aW9uIGNvbHVtbklkcyhwbHVnaW4sIHRhcmdldCwgb3B0aW9ucykge1xuICBjb25zdCB7IG1haW4sIG90aGVycyB9ID0gdGFyZ2V0S2V5cyhwbHVnaW4sIHRhcmdldCwgb3B0aW9ucyk7XG4gIGNvbnN0IGlkcyA9IFtdO1xuICBjb25zdCBzZWVuID0gbmV3IFNldCgpO1xuICBjb25zdCBwdXNoID0gKGlkKSA9PiB7XG4gICAgY29uc3QgbG93ZXIgPSBpZC50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChzZWVuLmhhcyhsb3dlcikpIHJldHVybjtcbiAgICBzZWVuLmFkZChsb3dlcik7XG4gICAgaWRzLnB1c2goaWQpO1xuICB9O1xuXG4gIHB1c2goRklMRV9OQU1FX0lEKTtcbiAgbGV0IHRhZ3NQbGFjZWQgPSBmYWxzZTtcbiAgZm9yIChjb25zdCBlbnRyeSBvZiBub3JtYWxpemVHbG9iYWxPcmRlcihwbHVnaW4uc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcikpIHtcbiAgICBpZiAoZW50cnkua2luZCA9PT0gXCJwcm9wZXJ0eVwiKSB7XG4gICAgICBpZiAob3B0aW9ucy50YWdzICYmIGVudHJ5Lm5hbWUgJiYgc2FtZUlkKGVudHJ5Lm5hbWUsIFRBR1NfUFJPUEVSVFkpKSB7XG4gICAgICAgIHB1c2gobm90ZUlkKGVudHJ5Lm5hbWUpKTtcbiAgICAgICAgdGFnc1BsYWNlZCA9IHRydWU7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChlbnRyeS5raW5kID09PSBcInR5cFwiKSB7XG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBtYWluKSBwdXNoKG5vdGVJZChrZXkpKTtcbiAgICB9IGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwib3RoZXJcIikge1xuICAgICAgZm9yIChjb25zdCBrZXkgb2Ygb3RoZXJzKSBwdXNoKG5vdGVJZChrZXkpKTtcbiAgICB9XG4gIH1cbiAgLy8gU2FmZXR5IG5ldDogaWYgdGFncyBpc24ndCBpbiB0aGUgZ2xvYmFsIG9yZGVyLCBpdCBzdGlsbCBnb2VzIGxhc3QuXG4gIGlmIChvcHRpb25zLnRhZ3MgJiYgIXRhZ3NQbGFjZWQpIHB1c2gobm90ZUlkKFRBR1NfUFJPUEVSVFkpKTtcbiAgcmV0dXJuIGlkcztcbn1cblxuLyogLS0tIFZpZXdzIG9mIGEgdGFyZ2V0IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuXG4vLyBzY29wZWQ6IHdoZXRoZXIgZWFjaCB2aWV3IG11c3QgY2FycnkgaXRzIGZ1bGwgZmlsdGVyLiBJbiBhIG5ldyBCYXNlIHRoZSBUWVBcbi8vIHNpdHMgaW4gdGhlIHJvb3QgZmlsdGVyIGFuZCBTdWJ0eXAgdmlld3Mgb25seSBhZGQgU1VCVFlQLiBWaWV3cyBhcHBlbmRlZCB0b1xuLy8gYW4gZXhpc3RpbmcgQmFzZSBsZWF2ZSBpdHMgcm9vdCBmaWx0ZXIgYWxvbmUgYW5kIGZpbHRlciB0aGVtc2VsdmVzLlxuZnVuY3Rpb24gdGFyZ2V0Vmlld3MocGx1Z2luLCB0YXJnZXQsIG9wdGlvbnMsIHsgc2NvcGVkIH0pIHtcbiAgaWYgKCF0YXJnZXQudHlwKSB7XG4gICAgY29uc3QgdmlldyA9IHtcbiAgICAgIHR5cGU6IFwidGFibGVcIixcbiAgICAgIG5hbWU6IHRhcmdldC5zdWJ0eXAsXG4gICAgICBvcmRlcjogY29sdW1uSWRzKHBsdWdpbiwgdGFyZ2V0LCBvcHRpb25zKSxcbiAgICB9O1xuICAgIGlmIChzY29wZWQpIHZpZXcuZmlsdGVycyA9IHsgYW5kOiBbZXF1YWxzRmlsdGVyKFNVQlRZUF9QUk9QRVJUWSwgdGFyZ2V0LnN1YnR5cCldIH07XG4gICAgLy8gU2V2ZXJhbCBUWVAgZW50cmllcyB3aXRoIHRoaXMgU3VidHlwIG5hbWU6IGdyb3VwaW5nIHNlcGFyYXRlcyB0aGVtXG4gICAgLy8gd2l0aG91dCBhIHZpZXcgcGVyIFRZUC5cbiAgICBpZiAodHlwc0ZvclN1YnR5cChwbHVnaW4sIHRhcmdldC5zdWJ0eXApLmxlbmd0aCA+IDEpIHtcbiAgICAgIHZpZXcuZ3JvdXBCeSA9IHsgcHJvcGVydHk6IG5vdGVJZChUWVBfUFJPUEVSVFkpLCBkaXJlY3Rpb246IFwiQVNDXCIgfTtcbiAgICB9XG4gICAgcmV0dXJuIFt2aWV3XTtcbiAgfVxuXG4gIGNvbnN0IHR5cCA9IHRhcmdldC50eXA7XG4gIGNvbnN0IHN1YnR5cHMgPSBnZXRTdWJ0eXBOYW1lcyhwbHVnaW4uc2V0dGluZ3MsIHR5cCk7XG4gIGNvbnN0IG1haW4gPSB7XG4gICAgdHlwZTogXCJ0YWJsZVwiLFxuICAgIG5hbWU6IHR5cCxcbiAgICBvcmRlcjogY29sdW1uSWRzKHBsdWdpbiwgeyB0eXAsIHN1YnR5cDogbnVsbCB9LCBvcHRpb25zKSxcbiAgfTtcbiAgaWYgKHNjb3BlZCkgbWFpbi5maWx0ZXJzID0geyBhbmQ6IFtlcXVhbHNGaWx0ZXIoVFlQX1BST1BFUlRZLCB0eXApXSB9O1xuICAvLyBXaXRob3V0IGFueSBTdWJ0eXAsIGdyb3VwaW5nIGJ5IGFuIGFsd2F5cy1lbXB0eSBwcm9wZXJ0eSB3b3VsZCBvbmx5IGdpdmVcbiAgLy8gb25lIFwibm8gdmFsdWVcIiBncm91cC5cbiAgaWYgKHN1YnR5cHMubGVuZ3RoID4gMCkgbWFpbi5ncm91cEJ5ID0geyBwcm9wZXJ0eTogbm90ZUlkKFNVQlRZUF9QUk9QRVJUWSksIGRpcmVjdGlvbjogXCJBU0NcIiB9O1xuXG4gIGNvbnN0IHZpZXdzID0gW21haW5dO1xuICBmb3IgKGNvbnN0IHN1YnR5cCBvZiBzdWJ0eXBzKSB7XG4gICAgdmlld3MucHVzaCh7XG4gICAgICB0eXBlOiBcInRhYmxlXCIsXG4gICAgICBuYW1lOiBzdWJ0eXAsXG4gICAgICAvLyBhbGxTdWJ0eXBzIGlzIGFsd2F5cyBvZmYgaW4gYSBTdWJ0eXAgdmlldyAoc2VlIHRhcmdldEtleXMpLlxuICAgICAgb3JkZXI6IGNvbHVtbklkcyhwbHVnaW4sIHsgdHlwLCBzdWJ0eXAgfSwgeyAuLi5vcHRpb25zLCBhbGxTdWJ0eXBzOiBmYWxzZSB9KSxcbiAgICAgIGZpbHRlcnM6IHtcbiAgICAgICAgYW5kOiBzY29wZWRcbiAgICAgICAgICA/IFtlcXVhbHNGaWx0ZXIoVFlQX1BST1BFUlRZLCB0eXApLCBlcXVhbHNGaWx0ZXIoU1VCVFlQX1BST1BFUlRZLCBzdWJ0eXApXVxuICAgICAgICAgIDogW2VxdWFsc0ZpbHRlcihTVUJUWVBfUFJPUEVSVFksIHN1YnR5cCldLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfVxuICByZXR1cm4gdmlld3M7XG59XG5cbi8vIEEgdmlldyBvYmplY3QgYXMgaXQgYXBwZWFycyBpbiB0aGUgZmlsZTogd2l0aG91dCBcIm5vdGUuXCIgYW5kIHdpdGggdGhlIGtleVxuLy8gb3JkZXIgQmFzZXMgaXRzZWxmIHdyaXRlcy5cbmZ1bmN0aW9uIHNlcmlhbGl6ZVZpZXcodmlldykge1xuICBjb25zdCBvdXQgPSB7IHR5cGU6IHZpZXcudHlwZSwgbmFtZTogdmlldy5uYW1lIH07XG4gIGlmICh2aWV3LmZpbHRlcnMpIG91dC5maWx0ZXJzID0gdmlldy5maWx0ZXJzO1xuICBpZiAodmlldy5vcmRlcikgb3V0Lm9yZGVyID0gdmlldy5vcmRlci5tYXAoc2VyaWFsaXplSWQpO1xuICBpZiAodmlldy5ncm91cEJ5KSB7XG4gICAgb3V0Lmdyb3VwQnkgPSB7IHByb3BlcnR5OiBzZXJpYWxpemVJZCh2aWV3Lmdyb3VwQnkucHJvcGVydHkpLCBkaXJlY3Rpb246IHZpZXcuZ3JvdXBCeS5kaXJlY3Rpb24gfTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG4vKiAtLS0gT3BlbmluZyBhbmQgd3JpdGluZyB0aGUgZmlsZSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbmZ1bmN0aW9uIHdhaXRGb3IobXMpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB3aW5kb3cuc2V0VGltZW91dChyZXNvbHZlLCBtcykpO1xufVxuXG4vLyBPcGVucyB0aGUgQmFzZSBhbmQgd2FpdHMgdW50aWwgaXRzIHF1ZXJ5IGlzIHBhcnNlZDsgb25seSB0aGVuIGNhbiBpdCBiZVxuLy8gcmVhZCBhbmQgd3JpdHRlbi4gUmV1c2VzIGEgdGFiIHRoYXQgYWxyZWFkeSBzaG93cyB0aGUgZmlsZS5cbmFzeW5jIGZ1bmN0aW9uIG9wZW5CYXNlKGFwcCwgZmlsZSkge1xuICBjb25zdCBvcGVuID0gYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJiYXNlc1wiKS5maW5kKChsZWFmKSA9PiBsZWFmLnZpZXc/LmZpbGU/LnBhdGggPT09IGZpbGUucGF0aCk7XG4gIGNvbnN0IGxlYWYgPSBvcGVuID8/IGFwcC53b3Jrc3BhY2UuZ2V0TGVhZihcInRhYlwiKTtcbiAgaWYgKG9wZW4pIGFwcC53b3Jrc3BhY2UucmV2ZWFsTGVhZihsZWFmKTtcbiAgZWxzZSBhd2FpdCBsZWFmLm9wZW5GaWxlKGZpbGUsIHsgYWN0aXZlOiB0cnVlIH0pO1xuICBmb3IgKGxldCBhdHRlbXB0ID0gMDsgYXR0ZW1wdCA8IDQwICYmICFsZWFmLnZpZXc/LnF1ZXJ5OyBhdHRlbXB0KyspIGF3YWl0IHdhaXRGb3IoMjUpO1xuICByZXR1cm4gbGVhZi52aWV3Py5xdWVyeSA/IGxlYWYudmlldyA6IG51bGw7XG59XG5cbi8vIEFwcGVuZHMgdmlld3MgdG8gYW4gZXhpc3RpbmcgQmFzZS4gZ2V0U2VyaWFsaXphYmxlKCkgcmV0dXJucyBleGFjdGx5IHdoYXRcbi8vIEJhc2VzIHdyaXRlcyB3aGVuIGl0IHNhdmVzICh2ZXJpZmllZDogdGhlIHJvdW5kIHRyaXAgcmVwcm9kdWNlcyBleGlzdGluZ1xuLy8gZmlsZXMgYnl0ZSBmb3IgYnl0ZSwgZm9ybXVsYSBibG9ja3MgYW5kIHNwZWNpYWwga2V5cyBpbmNsdWRlZCk7IG9ubHkgdGhlXG4vLyB2aWV3cyBsaXN0IGlzIHRvdWNoZWQuXG4vL1xuLy8gdmF1bHQucHJvY2VzcyByYXRoZXIgdGhhbiB2YXVsdC5tb2RpZnksIGFzIE9ic2lkaWFuIHJlY29tbWVuZHMgZm9yIGNoYW5nZXNcbi8vIHRvIGEgZmlsZSB0aGF0IG1heSBiZSBvcGVuOiBpdCB3cml0ZXMgYXRvbWljYWxseS4gVGhlIGNhbGxiYWNrIGlnbm9yZXMgdGhlXG4vLyBmaWxlIHRleHQgb24gcHVycG9zZSAtIGRhdGEgY29tZXMgZnJvbSB0aGUgcGFyc2VkIHF1ZXJ5LCB3aGljaCB0aGUgb3BlblxuLy8gQmFzZSBrZWVwcyBpbiBzdGVwIHdpdGggdGhlIGZpbGUuXG5hc3luYyBmdW5jdGlvbiBhcHBlbmRWaWV3cyhhcHAsIHZpZXcsIHZpZXdzKSB7XG4gIGNvbnN0IGRhdGEgPSB2aWV3LnF1ZXJ5LmdldFNlcmlhbGl6YWJsZSgpO1xuICBkYXRhLnZpZXdzID0gWy4uLihkYXRhLnZpZXdzID8/IFtdKSwgLi4udmlld3MubWFwKHNlcmlhbGl6ZVZpZXcpXTtcbiAgYXdhaXQgYXBwLnZhdWx0LnByb2Nlc3Modmlldy5maWxlLCAoKSA9PiBzdHJpbmdpZnlZYW1sKGRhdGEpKTtcbn1cblxuLyogLS0tIENvbW1hbmQ6IENyZWF0ZSBCYXNlIGZvciBUWVAgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVCYXNlKHBsdWdpbiwgdGFyZ2V0LCBvcHRpb25zKSB7XG4gIGNvbnN0IGFwcCA9IHBsdWdpbi5hcHA7XG4gIGNvbnN0IG5hbWUgPSB0YXJnZXQuc3VidHlwID8/IHRhcmdldC50eXA7XG4gIGNvbnN0IHBhdGggPSBgJHtuYW1lfS4ke0JBU0VfRVhURU5TSU9OfWA7XG4gIGNvbnN0IGV4aXN0aW5nID0gYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChwYXRoKTtcblxuICBpZiAoZXhpc3RpbmcgJiYgIShleGlzdGluZyBpbnN0YW5jZW9mIFRGaWxlKSkge1xuICAgIG5ldyBOb3RpY2UoYFwiJHtwYXRofVwiIGlzIG5vdCBhIGZpbGUgXHUyMDEzIEJhc2Ugbm90IGNyZWF0ZWQuYCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgaWYgKCFleGlzdGluZykge1xuICAgIGNvbnN0IHZpZXdzID0gdGFyZ2V0Vmlld3MocGx1Z2luLCB0YXJnZXQsIG9wdGlvbnMsIHsgc2NvcGVkOiBmYWxzZSB9KTtcbiAgICBjb25zdCByb290ID0gdGFyZ2V0LnR5cFxuICAgICAgPyB7IGFuZDogW2VxdWFsc0ZpbHRlcihUWVBfUFJPUEVSVFksIHRhcmdldC50eXApXSB9XG4gICAgICA6IHsgYW5kOiBbZXF1YWxzRmlsdGVyKFNVQlRZUF9QUk9QRVJUWSwgdGFyZ2V0LnN1YnR5cCldIH07XG4gICAgY29uc3QgZmlsZSA9IGF3YWl0IGFwcC52YXVsdC5jcmVhdGUocGF0aCwgc3RyaW5naWZ5WWFtbCh7IGZpbHRlcnM6IHJvb3QsIHZpZXdzOiB2aWV3cy5tYXAoc2VyaWFsaXplVmlldykgfSkpO1xuICAgIGF3YWl0IG9wZW5CYXNlKGFwcCwgZmlsZSk7XG4gICAgbmV3IE5vdGljZShgQ3JlYXRlZCAke3BhdGh9IHdpdGggJHtwbHVyYWwodmlld3MubGVuZ3RoLCBcInZpZXdcIil9LmApO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIFRoZSBmaWxlIGV4aXN0czogYWRkIHdoYXQgaXMgbWlzc2luZy4gQSB2aWV3IHdpdGggdGhlIHNhbWUgbmFtZSBzdGF5c1xuICAvLyB1bnRvdWNoZWQgLSBpdCBtYXkgYmUgaGFuZC1tYWRlLCBhbmQgb3ZlcndyaXRpbmcgaXQgd291bGQgYmUgYSBzaWxlbnQgbG9zcy5cbiAgY29uc3QgdmlldyA9IGF3YWl0IG9wZW5CYXNlKGFwcCwgZXhpc3RpbmcpO1xuICBpZiAoIXZpZXcpIHtcbiAgICBuZXcgTm90aWNlKGBDb3VsZG4ndCByZWFkICR7cGF0aH0gXHUyMDEzIEJhc2Ugbm90IHVwZGF0ZWQuYCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHByZXNlbnQgPSBuZXcgU2V0KHZpZXcucXVlcnkudmlld3MubWFwKChjZmcpID0+IGNmZy5uYW1lKSk7XG4gIGNvbnN0IHdhbnRlZCA9IHRhcmdldFZpZXdzKHBsdWdpbiwgdGFyZ2V0LCBvcHRpb25zLCB7IHNjb3BlZDogdHJ1ZSB9KTtcbiAgY29uc3QgdG9BZGQgPSB3YW50ZWQuZmlsdGVyKChlbnRyeSkgPT4gIXByZXNlbnQuaGFzKGVudHJ5Lm5hbWUpKTtcbiAgY29uc3Qgc2tpcHBlZCA9IHdhbnRlZC5maWx0ZXIoKGVudHJ5KSA9PiBwcmVzZW50LmhhcyhlbnRyeS5uYW1lKSkubWFwKChlbnRyeSkgPT4gZW50cnkubmFtZSk7XG5cbiAgaWYgKHRvQWRkLmxlbmd0aCA+IDApIGF3YWl0IGFwcGVuZFZpZXdzKGFwcCwgdmlldywgdG9BZGQpO1xuXG4gIGNvbnN0IHBhcnRzID0gW107XG4gIHBhcnRzLnB1c2godG9BZGQubGVuZ3RoID4gMCA/IGAke3BhdGh9OiBhZGRlZCAke3BsdXJhbCh0b0FkZC5sZW5ndGgsIFwidmlld1wiKX0uYCA6IGAke3BhdGh9OiBub3RoaW5nIHRvIGFkZC5gKTtcbiAgaWYgKHNraXBwZWQubGVuZ3RoID4gMCkgcGFydHMucHVzaChgQWxyZWFkeSBwcmVzZW50LCBsZWZ0IHVuY2hhbmdlZDogJHtza2lwcGVkLmpvaW4oXCIsIFwiKX0uYCk7XG4gIG5ldyBOb3RpY2UocGFydHMuam9pbihcIiBcIikpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVCYXNlQ29tbWFuZChwbHVnaW4pIHtcbiAgLy8gaW5jbHVkZU1hbnVhbE9mZjogYSBCYXNlIGlzIGVzcGVjaWFsbHkgdXNlZnVsIGZvciBUWVAgZW50cmllcyB0aGF0IGFyZW4ndFxuICAvLyBzZXQgYnkgaGFuZCAoS09OVEFLVCwgTUVESUEsIEVYVEVSTikuIFVucmVnaXN0ZXJlZCB2YWx1ZXMgYXJlIGxlZnQgb3V0IC1cbiAgLy8gdGhleSBoYXZlIG5vIFRZUC1Gcm9udG1hdHRlciBhbmQgc28gbm8gY29sdW1ucy5cbiAgY29uc3QgY2hvaWNlID0gYXdhaXQgcGx1Z2luLnBpY2tUeXBBbmRTdWJ0eXAoeyBpbmNsdWRlTWFudWFsT2ZmOiB0cnVlIH0pO1xuICBpZiAoIWNob2ljZSkgcmV0dXJuO1xuXG4gIC8vIEEgU3VidHlwIHBpY2tlZCBoZXJlIG1lYW5zIHRoZSBzdGFuZGFsb25lIFN1YnR5cCBCYXNlOiBpdCBmaWx0ZXJzIGJ5XG4gIC8vIFNVQlRZUCBvbmx5IGFuZCBtZXJnZXMgdGhlIGNvbHVtbnMgb2YgZXZlcnkgVFlQIHdpdGggdGhhdCBTdWJ0eXAgbmFtZS5cbiAgY29uc3QgdGFyZ2V0ID0gY2hvaWNlLnN1YnR5cCA/IHsgdHlwOiBudWxsLCBzdWJ0eXA6IGNob2ljZS5zdWJ0eXAgfSA6IHsgdHlwOiBjaG9pY2UudHlwLCBzdWJ0eXA6IG51bGwgfTtcbiAgYXdhaXQgY3JlYXRlQmFzZUZvcihwbHVnaW4sIHRhcmdldCk7XG59XG5cbi8vIFRoZSBjb21tYW5kIGFmdGVyIGl0cyBwaWNrZXIsIGFsc28gdGhlIGVudHJ5IHdpdGggYSBmaXhlZCB0YXJnZXQgKGNvbnRleHRcbi8vIG1lbnUgb2YgdGhlIFRZUC1MaXN0KTogY29sdW1uIG9wdGlvbnMsIHRoZW4gY3JlYXRlIG9yIGNvbXBsZXRlIHRoZSBmaWxlLlxuYXN5bmMgZnVuY3Rpb24gY3JlYXRlQmFzZUZvcihwbHVnaW4sIHRhcmdldCkge1xuICBjb25zdCBvcHRpb25zID0gYXdhaXQgYXNrQ29sdW1uT3B0aW9ucyhwbHVnaW4sIHRhcmdldCwgKGN1cnJlbnQpID0+IGNvbHVtbklkcyhwbHVnaW4sIHRhcmdldCwgY3VycmVudCkpO1xuICBpZiAoIW9wdGlvbnMpIHJldHVybjtcbiAgYXdhaXQgY3JlYXRlQmFzZShwbHVnaW4sIHRhcmdldCwgb3B0aW9ucyk7XG59XG5cbi8qIC0tLSBDb21tYW5kOiBVcGRhdGUgY29sdW1ucyBvZiBCYXNlIHZpZXcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuLy8gVGhlIG1vc3QgcmVjZW50IGxlYWYgb2YgdGhlIG1haW4gYXJlYSwgbm90IHdvcmtzcGFjZS5hY3RpdmVMZWFmIChkZXByZWNhdGVkKTpcbi8vIHRoYXQgaXMgYWxzbyBhIHNpZGViYXIgbGVhZiwgZS5nLiB0aGUgVFlQLVBhbmUgd2hlbiBpdCB3YXMgY2xpY2tlZCBsYXN0LlxuZnVuY3Rpb24gYWN0aXZlQmFzZVZpZXcocGx1Z2luKSB7XG4gIGNvbnN0IGxlYWYgPSBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRNb3N0UmVjZW50TGVhZigpO1xuICBjb25zdCB2aWV3ID0gbGVhZj8udmlldztcbiAgaWYgKCF2aWV3IHx8IHR5cGVvZiB2aWV3LmdldFZpZXdUeXBlICE9PSBcImZ1bmN0aW9uXCIgfHwgdmlldy5nZXRWaWV3VHlwZSgpICE9PSBcImJhc2VzXCIpIHJldHVybiBudWxsO1xuICByZXR1cm4gdmlldy5xdWVyeSA/IHZpZXcgOiBudWxsO1xufVxuXG5mdW5jdGlvbiBzZXJpYWxpemVGaWx0ZXJzKGZpbHRlcnMpIHtcbiAgcmV0dXJuIHR5cGVvZiBmaWx0ZXJzPy5zZXJpYWxpemUgPT09IFwiZnVuY3Rpb25cIiA/IGZpbHRlcnMuc2VyaWFsaXplKCkgOiBudWxsO1xufVxuXG5hc3luYyBmdW5jdGlvbiB1cGRhdGVBY3RpdmVWaWV3KHBsdWdpbiwgdmlldykge1xuICBjb25zdCBxdWVyeSA9IHZpZXcucXVlcnk7XG4gIGNvbnN0IHZpZXdOYW1lID0gdmlldy5jb250cm9sbGVyPy52aWV3TmFtZTtcbiAgY29uc3QgY2ZnID0gKHZpZXdOYW1lID8gcXVlcnkuZ2V0Vmlld0NvbmZpZyh2aWV3TmFtZSkgOiBudWxsKSA/PyBxdWVyeS52aWV3c1swXTtcbiAgaWYgKCFjZmcpIHtcbiAgICBuZXcgTm90aWNlKFwiTm8gYWN0aXZlIHZpZXcuXCIpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGxldCB0YXJnZXQgPSByZWFkVGFyZ2V0KHNlcmlhbGl6ZUZpbHRlcnMocXVlcnkuZmlsdGVycyksIHNlcmlhbGl6ZUZpbHRlcnMoY2ZnLmZpbHRlcnMpKTtcbiAgaWYgKCF0YXJnZXQpIHtcbiAgICAvLyBObyB1bmFtYmlndW91cyBUWVAgaW4gdGhlIGZpbHRlciAoaGFuZC13cml0dGVuIE9SIGdyb3VwLCBubyBmaWx0ZXIgYXRcbiAgICAvLyBhbGwpOiBhc2ssIGFuZCBzdG9yZSB0aGUgYW5zd2VyIGFzIGEgZmlsdGVyIHNvIHRoZSBuZXh0IHJ1biByZWFkcyBpdC5cbiAgICBjb25zdCBjaG9pY2UgPSBhd2FpdCBwbHVnaW4ucGlja1R5cEFuZFN1YnR5cCh7IGluY2x1ZGVNYW51YWxPZmY6IHRydWUgfSk7XG4gICAgaWYgKCFjaG9pY2UpIHJldHVybjtcbiAgICB0YXJnZXQgPSB7IHR5cDogY2hvaWNlLnR5cCwgc3VidHlwOiBjaG9pY2Uuc3VidHlwIH07XG4gICAgY29uc3QgYW5kID0gW2VxdWFsc0ZpbHRlcihUWVBfUFJPUEVSVFksIGNob2ljZS50eXApXTtcbiAgICBpZiAoY2hvaWNlLnN1YnR5cCkgYW5kLnB1c2goZXF1YWxzRmlsdGVyKFNVQlRZUF9QUk9QRVJUWSwgY2hvaWNlLnN1YnR5cCkpO1xuICAgIHF1ZXJ5LnNldFZpZXdGaWx0ZXJzKGNmZy5uYW1lLCB7IGFuZCB9KTtcbiAgfVxuXG4gIGNvbnN0IG9wdGlvbnMgPSBhd2FpdCBhc2tDb2x1bW5PcHRpb25zKHBsdWdpbiwgdGFyZ2V0LCAoY3VycmVudCkgPT4gY29sdW1uSWRzKHBsdWdpbiwgdGFyZ2V0LCBjdXJyZW50KSk7XG4gIGlmICghb3B0aW9ucykgcmV0dXJuO1xuXG4gIGNvbnN0IGRlc2lyZWQgPSBjb2x1bW5JZHMocGx1Z2luLCB0YXJnZXQsIG9wdGlvbnMpO1xuICBjb25zdCBkZXNpcmVkTG93ZXIgPSBuZXcgU2V0KGRlc2lyZWQubWFwKChpZCkgPT4gaWQudG9Mb3dlckNhc2UoKSkpO1xuICAvLyBBIHZpZXcgd2l0aG91dCBpdHMgb3duIG9yZGVyIHNob3dzIGV2ZXJ5IHByb3BlcnR5IC0gbm90aGluZyB0byByZW1vdmUsXG4gIC8vIHRoZSBnZW5lcmF0ZWQgbGlzdCBzaW1wbHkgdGFrZXMgaXRzIHBsYWNlLlxuICBjb25zdCBjdXJyZW50ID0gQXJyYXkuaXNBcnJheShjZmcub3JkZXIpID8gWy4uLmNmZy5vcmRlcl0gOiBbXTtcbiAgY29uc3QgZXh0cmFzID0gY3VycmVudC5maWx0ZXIoKGlkKSA9PiAhZGVzaXJlZExvd2VyLmhhcyhpZC50b0xvd2VyQ2FzZSgpKSk7XG5cbiAgbGV0IGtlcHQgPSBbXTtcbiAgaWYgKGV4dHJhcy5sZW5ndGggPiAwKSB7XG4gICAgY29uc3QgcmVtb3ZhbHMgPSBhd2FpdCBhc2tSZW1vdmFscyhwbHVnaW4sIGV4dHJhcywgY2ZnLm5hbWUpO1xuICAgIGlmICghcmVtb3ZhbHMpIHJldHVybjtcbiAgICBrZXB0ID0gZXh0cmFzLmZpbHRlcigoaWQpID0+ICFyZW1vdmFscy5oYXMoaWQpKTtcbiAgfVxuXG4gIC8vIEtlcHQgY29sdW1ucyBzdGF5IHVwIGZyb250LCByaWdodCBhZnRlciBmaWxlLm5hbWU6IGhhbmQtYWRkZWQgb25lc1xuICAvLyAoZm9ybXVsYSBjb2x1bW5zLCBzYXkpIHNob3VsZG4ndCBzbGlkZSB0byB0aGUgZW5kLlxuICBjb25zdCBuZXdPcmRlciA9IFtcbiAgICBGSUxFX05BTUVfSUQsXG4gICAgLi4ua2VwdC5maWx0ZXIoKGlkKSA9PiAhc2FtZUlkKGlkLCBGSUxFX05BTUVfSUQpKSxcbiAgICAuLi5kZXNpcmVkLmZpbHRlcigoaWQpID0+ICFzYW1lSWQoaWQsIEZJTEVfTkFNRV9JRCkpLFxuICBdO1xuXG4gIGlmIChuZXdPcmRlci5sZW5ndGggPT09IGN1cnJlbnQubGVuZ3RoICYmIG5ld09yZGVyLmV2ZXJ5KChpZCwgaW5kZXgpID0+IGlkID09PSBjdXJyZW50W2luZGV4XSkpIHtcbiAgICBuZXcgTm90aWNlKGBWaWV3IFwiJHtjZmcubmFtZX1cIjogY29sdW1ucyBhcmUgYWxyZWFkeSB1cCB0byBkYXRlLmApO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IGFkZGVkID0gZGVzaXJlZC5maWx0ZXIoKGlkKSA9PiAhY3VycmVudC5zb21lKChleGlzdGluZykgPT4gc2FtZUlkKGV4aXN0aW5nLCBpZCkpKS5sZW5ndGg7XG4gIGNvbnN0IHJlbW92ZWQgPSBleHRyYXMubGVuZ3RoIC0ga2VwdC5sZW5ndGg7XG4gIGNmZy5zZXRPcmRlcihuZXdPcmRlcik7XG4gIG5ldyBOb3RpY2UoYFZpZXcgXCIke2NmZy5uYW1lfVwiOiBhZGRlZCAke3BsdXJhbChhZGRlZCwgXCJjb2x1bW5cIil9LCByZW1vdmVkICR7cmVtb3ZlZH0uYCk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBpc0Jhc2VzRW5hYmxlZCxcbiAgY3JlYXRlQmFzZUNvbW1hbmQsXG4gIGNyZWF0ZUJhc2VGb3IsXG4gIGFjdGl2ZUJhc2VWaWV3LFxuICB1cGRhdGVBY3RpdmVWaWV3LFxuICAvLyBFeHBvc2VkIGZvciB0ZXN0aW5nIHNpbmdsZSBidWlsZGluZyBibG9ja3NcbiAgY29sdW1uSWRzLFxuICByZWFkVGFyZ2V0LFxuICB0YXJnZXRWaWV3cyxcbn07XG4iLCAiY29uc3QgeyBOb3RpY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgc29ydEFsbEZyb250bWF0dGVyLCBzb3J0U2luZ2xlRmlsZUZyb250bWF0dGVyLCBzb3J0VHlwRnJvbnRtYXR0ZXIsIHNvcnRTdW1tYXJ5IH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1zb3J0XCIpO1xuY29uc3QgeyBpc0Jhc2VzRW5hYmxlZCwgY3JlYXRlQmFzZUNvbW1hbmQsIGFjdGl2ZUJhc2VWaWV3LCB1cGRhdGVBY3RpdmVWaWV3IH0gPSByZXF1aXJlKFwiLi9iYXNlc1wiKTtcblxuLy8gT2JzaWRpYW4gbmVpdGhlciBhd2FpdHMgYSBjb21tYW5kIGNhbGxiYWNrIChvciBhIG1lbnUgaXRlbSdzIG9uQ2xpY2spIG5vclxuLy8gY2F0Y2hlcyBpdHMgZXJyb3JzLCBzbyBhbiBleGNlcHRpb24gd291bGQgdmFuaXNoIGludG8gdGhlIGNvbnNvbGUuIFRoZXNlXG4vLyBhY3Rpb25zIGFsd2F5cyBlbmQgaW4gYSBub3RpY2UgaW5zdGVhZC4gQWxzbyB1c2VkIGJ5IHRoZSBUWVAtUGFuZSdzIGNvbnRleHRcbi8vIG1lbnUuXG5jb25zdCBydW5PclJlcG9ydEVycm9yID0gKGxhYmVsLCBmbikgPT4gYXN5bmMgKCkgPT4ge1xuICB0cnkge1xuICAgIGF3YWl0IGZuKCk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcihgWyR7bGFiZWx9XWAsIGVycm9yKTtcbiAgICBuZXcgTm90aWNlKGAke2xhYmVsfSBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgfVxufTtcblxuZnVuY3Rpb24gcmVnaXN0ZXJDb21tYW5kcyhwbHVnaW4pIHtcblxuICBwbHVnaW4uYWRkQ29tbWFuZCh7XG4gICAgaWQ6IFwic29ydC1mcm9udG1hdHRlci1hbGxcIixcbiAgICBuYW1lOiBcIlNvcnQgZnJvbnRtYXR0ZXIgaW4gYWxsIG5vdGVzXCIsXG4gICAgY2FsbGJhY2s6IHJ1bk9yUmVwb3J0RXJyb3IoXCJGcm9udG1hdHRlciBzb3J0aW5nXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHsgY2hlY2tlZCwgY2hhbmdlZCB9ID0gYXdhaXQgc29ydEFsbEZyb250bWF0dGVyKHBsdWdpbi5hcHAsIHBsdWdpbiwgbnVsbCk7XG4gICAgICBuZXcgTm90aWNlKHNvcnRTdW1tYXJ5KFwiRnJvbnRtYXR0ZXIgc29ydGluZ1wiLCBjaGVja2VkLCBjaGFuZ2VkKSk7XG4gICAgfSksXG4gIH0pO1xuXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJzb3J0LWZyb250bWF0dGVyLXR5cFwiLFxuICAgIG5hbWU6IFwiU29ydCBmcm9udG1hdHRlciBmb3Igb25lIFRZUFwiLFxuICAgIGNhbGxiYWNrOiBydW5PclJlcG9ydEVycm9yKFwiRnJvbnRtYXR0ZXIgc29ydGluZ1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBTb3J0aW5nIG1ha2VzIHNlbnNlIGZvciBhbnkgVFlQLCBtYW51YWxseSBjcmVhdGFibGUgb3Igbm90LCByZWdpc3RlcmVkXG4gICAgICAvLyBvciBub3QuXG4gICAgICBjb25zdCB0eXAgPSBhd2FpdCBwbHVnaW4ucGlja1R5cCh7IGluY2x1ZGVNYW51YWxPZmY6IHRydWUsIGluY2x1ZGVVbnJlZ2lzdGVyZWQ6IHRydWUgfSk7XG4gICAgICBpZiAoIXR5cCkgcmV0dXJuO1xuICAgICAgYXdhaXQgc29ydFR5cEZyb250bWF0dGVyKHBsdWdpbiwgdHlwKTtcbiAgICB9KSxcbiAgfSk7XG5cbiAgcGx1Z2luLmFkZENvbW1hbmQoe1xuICAgIGlkOiBcInNvcnQtZnJvbnRtYXR0ZXItYWN0aXZlLW5vdGVcIixcbiAgICBuYW1lOiBcIlNvcnQgZnJvbnRtYXR0ZXIgb2YgYWN0aXZlIG5vdGVcIixcbiAgICBjaGVja0NhbGxiYWNrOiAoY2hlY2tpbmcpID0+IHtcbiAgICAgIGNvbnN0IGZpbGUgPSBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gICAgICBpZiAoIWZpbGUgfHwgZmlsZS5leHRlbnNpb24gIT09IFwibWRcIikgcmV0dXJuIGZhbHNlO1xuICAgICAgaWYgKGNoZWNraW5nKSByZXR1cm4gdHJ1ZTtcblxuICAgICAgcnVuT3JSZXBvcnRFcnJvcihcIkZyb250bWF0dGVyIHNvcnRpbmdcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBjaGFuZ2VkID0gYXdhaXQgc29ydFNpbmdsZUZpbGVGcm9udG1hdHRlcihwbHVnaW4uYXBwLCBwbHVnaW4sIGZpbGUpO1xuICAgICAgICBuZXcgTm90aWNlKGNoYW5nZWQgPyBgU29ydGVkIGZyb250bWF0dGVyIG9mIFwiJHtmaWxlLmJhc2VuYW1lfVwiLmAgOiBgRnJvbnRtYXR0ZXIgb2YgXCIke2ZpbGUuYmFzZW5hbWV9XCIgd2FzIGFscmVhZHkgc29ydGVkLmApO1xuICAgICAgfSkoKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0sXG4gIH0pO1xuXG4gIC8vIENyZWF0ZXMgYSAuYmFzZSBmb3IgdGhlIGNob3NlbiBUWVAgb3IgU3VidHlwIGluIHRoZSB2YXVsdCByb290LCBzZWUgYmFzZXMuanMuXG4gIC8vIEhpZGRlbiB3aGlsZSB0aGUgQmFzZXMgY29yZSBwbHVnaW4gaXMgb2ZmOiB0aGUgZmlsZSBjb3VsZG4ndCBiZSBvcGVuZWQuXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJjcmVhdGUtYmFzZS1mb3ItdHlwXCIsXG4gICAgbmFtZTogXCJDcmVhdGUgQmFzZSBmb3IgVFlQXCIsXG4gICAgY2hlY2tDYWxsYmFjazogKGNoZWNraW5nKSA9PiB7XG4gICAgICBpZiAoIWlzQmFzZXNFbmFibGVkKHBsdWdpbi5hcHApKSByZXR1cm4gZmFsc2U7XG4gICAgICBpZiAoY2hlY2tpbmcpIHJldHVybiB0cnVlO1xuXG4gICAgICBydW5PclJlcG9ydEVycm9yKFwiQ3JlYXRlIEJhc2VcIiwgKCkgPT4gY3JlYXRlQmFzZUNvbW1hbmQocGx1Z2luKSkoKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0sXG4gIH0pO1xuXG4gIC8vIEJyaW5ncyB0aGUgY29sdW1ucyBvZiB0aGUgdmlzaWJsZSBCYXNlIHZpZXcgaW4gbGluZSB3aXRoIGl0cyBUWVAuIFdpdGhvdXRcbiAgLy8gYW4gb3BlbiBCYXNlIHRoZSBjb21tYW5kIGhhcyBubyB0YXJnZXQgYW5kIGlzIGhpZGRlbi5cbiAgcGx1Z2luLmFkZENvbW1hbmQoe1xuICAgIGlkOiBcInVwZGF0ZS1iYXNlLXZpZXctY29sdW1uc1wiLFxuICAgIG5hbWU6IFwiVXBkYXRlIGNvbHVtbnMgb2YgQmFzZSB2aWV3XCIsXG4gICAgY2hlY2tDYWxsYmFjazogKGNoZWNraW5nKSA9PiB7XG4gICAgICBjb25zdCB2aWV3ID0gYWN0aXZlQmFzZVZpZXcocGx1Z2luKTtcbiAgICAgIGlmICghdmlldykgcmV0dXJuIGZhbHNlO1xuICAgICAgaWYgKGNoZWNraW5nKSByZXR1cm4gdHJ1ZTtcblxuICAgICAgcnVuT3JSZXBvcnRFcnJvcihcIlVwZGF0ZSBCYXNlXCIsICgpID0+IHVwZGF0ZUFjdGl2ZVZpZXcocGx1Z2luLCB2aWV3KSkoKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0sXG4gIH0pO1xuXG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckNvbW1hbmRzLCBydW5PclJlcG9ydEVycm9yIH07XG4iLCAiY29uc3QgeyBDb25maXJtYXRpb25Nb2RhbCwgUGxhdGZvcm0gfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgbmFtZUNvbG9yLCBwYWludENvbG9yRG90LCBERUZBVUxUX1RZUF9DT0xPUiB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxuLy8gQSBUWVAgbmFtZSBpbiBydW5uaW5nIHRleHQgKGRpYWxvZ3MpOiBjb2xvcmVkIHdoZW4gXCJUWVAtUGFuZVwiIGNvbG9yaW5nIGlzIG9uXG4vLyAoY29sb3JWaWV3cy50eXBMaXN0KSwgb3RoZXJ3aXNlIGEgZG90IGJlZm9yZSBwbGFpbiB0ZXh0IC0gdGhlIHNhbWUgc3dpdGNoIGFzXG4vLyBpbiB0aGUgcGlja2VyIGFuZCB0aGUgbGlzdC4gVGhlIGNhbGxlciBwYXNzZXMgY29sb3Igc28gYSByZW5hbWUgY2FuIHVzZSB0aGVcbi8vIHNhbWUgKG9sZCkgY29sb3IgZm9yIG9sZCBhbmQgbmV3IG5hbWUuIGNvbG9yIG51bGwgPSBUWVAgd2l0aG91dCBhIGNvbG9yLlxuZnVuY3Rpb24gYXBwZW5kVHlwTmFtZShwYXJlbnRFbCwgcGx1Z2luLCB0eXAsIGNvbG9yKSB7XG4gIGlmIChwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0KSB7XG4gICAgY29uc3QgbmFtZUVsID0gcGFyZW50RWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtaW5saW5lLW5hbWVcIiwgdGV4dDogdHlwIH0pO1xuICAgIGlmIChjb2xvcikgbmFtZUVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gIH0gZWxzZSB7XG4gICAgcGFpbnRDb2xvckRvdChwYXJlbnRFbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1pbmxpbmUtZG90XCIgfSksIGNvbG9yID8/IERFRkFVTFRfVFlQX0NPTE9SLCAhY29sb3IpO1xuICAgIHBhcmVudEVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLWlubGluZS1uYW1lXCIsIHRleHQ6IHR5cCB9KTtcbiAgfVxufVxuXG4vLyBMaWtlIGFwcGVuZFR5cE5hbWUgZm9yIGEgU3VidHlwIG9mIHR5cCwgaW4gdGhlIFN1YnR5cCBjb2xvciAoc2VlIG5hbWVDb2xvclxuLy8gaW4gdHlwLWNvbG9ycy5qcywgd2hpY2ggYWxzbyBob25vcnMgdGhlIFwiU3VidHlwXCIgc3ViLXRvZ2dsZSBvZiBcIlRZUC1QYW5lXCIpLlxuLy8gY29sb3JTdWJ0eXAgaXMgdGhlIFN1YnR5cCB3aG9zZSBjb2xvciBpcyB1c2VkIC0gYSByZW5hbWUgc2hvd3MgdGhlIG5ldyBuYW1lLFxuLy8gd2hpY2ggaGFzIG5vIGVudHJ5IHlldCwgaW4gdGhlIG9sZCBvbmUncyBjb2xvci4gQXMgd2l0aCBhcHBlbmRUeXBOYW1lLCBhIFRZUFxuLy8gd2l0aG91dCBhIGNvbG9yIGxlYXZlcyB0aGUgdGV4dCB1bmNvbG9yZWQuXG5mdW5jdGlvbiBhcHBlbmRTdWJ0eXBOYW1lKHBhcmVudEVsLCBwbHVnaW4sIHR5cCwgbmFtZSwgY29sb3JTdWJ0eXAgPSBuYW1lKSB7XG4gIGNvbnN0IHsgY29sb3IsIGlzRGVmYXVsdCB9ID0gbmFtZUNvbG9yKHBsdWdpbi5zZXR0aW5ncywgdHlwLCBjb2xvclN1YnR5cCk7XG4gIGlmIChwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0KSB7XG4gICAgY29uc3QgbmFtZUVsID0gcGFyZW50RWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtaW5saW5lLW5hbWVcIiwgdGV4dDogbmFtZSB9KTtcbiAgICBpZiAocGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdKSBuYW1lRWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcbiAgfSBlbHNlIHtcbiAgICBwYWludENvbG9yRG90KHBhcmVudEVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLWlubGluZS1kb3RcIiB9KSwgY29sb3IsIGlzRGVmYXVsdCk7XG4gICAgcGFyZW50RWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtaW5saW5lLW5hbWVcIiwgdGV4dDogbmFtZSB9KTtcbiAgfVxufVxuXG4vLyBUaGUgc2FtZSBhcyBub2RlcyBmb3IgYSBDb25maXJtTW9kYWwgdGl0bGUgb3IgYm9keS5cbmNvbnN0IHR5cE5hbWVOb2RlID0gKHBsdWdpbiwgdHlwLCBjb2xvcikgPT4gY3JlYXRlRnJhZ21lbnQoKGYpID0+IGFwcGVuZFR5cE5hbWUoZiwgcGx1Z2luLCB0eXAsIGNvbG9yKSk7XG5jb25zdCBzdWJ0eXBOYW1lTm9kZSA9IChwbHVnaW4sIHR5cCwgbmFtZSwgY29sb3JTdWJ0eXAgPSBuYW1lKSA9PlxuICBjcmVhdGVGcmFnbWVudCgoZikgPT4gYXBwZW5kU3VidHlwTmFtZShmLCBwbHVnaW4sIHR5cCwgbmFtZSwgY29sb3JTdWJ0eXApKTtcblxuLy8gRmlsbHMgZWwgd2l0aCBhIHN0cmluZyBvciBhbiBhcnJheSBvZiBzdHJpbmdzIGFuZCBub2Rlcy5cbmZ1bmN0aW9uIGFwcGVuZFBhcnRzKGVsLCBwYXJ0cykge1xuICBmb3IgKGNvbnN0IHBhcnQgb2YgQXJyYXkuaXNBcnJheShwYXJ0cykgPyBwYXJ0cyA6IFtwYXJ0c10pIHtcbiAgICBpZiAodHlwZW9mIHBhcnQgPT09IFwic3RyaW5nXCIpIGVsLmFwcGVuZFRleHQocGFydCk7XG4gICAgZWxzZSBlbC5hcHBlbmRDaGlsZChwYXJ0KTtcbiAgfVxufVxuXG4vLyBUaGUgb25lIGNvbmZpcm1hdGlvbiBkaWFsb2cgb2YgdGhlIHBsdWdpbiwgYnVpbHQgb24gT2JzaWRpYW4ncyBvd25cbi8vIENvbmZpcm1hdGlvbk1vZGFsIC0gdGhlIGJhc2Ugb2YgaXRzIFwiRGVsZXRlIGZpbGVcIiBldGMuIC0gc28gbG9vaywgYnV0dG9uXG4vLyBvcmRlciBbQ2FuY2VsXSBbQWN0aW9uXSwgYm90dG9tIHNoZWV0IG9uIHBob25lcyBhbmQga2V5Ym9hcmQgZm9jdXMgbWF0Y2hcbi8vIE9ic2lkaWFuJ3MgZGlhbG9ncyBleGFjdGx5LlxuLy9cbi8vIExpa2UgT2JzaWRpYW4ncyBcIk1lcmdlIHByb3BlcnR5IC4uLiB3aXRoIC4uLj9cIiAoQWxsIHByb3BlcnRpZXMpLCB0aGVcbi8vIHF1ZXN0aW9uIGl0c2VsZiBpcyB0aGUgdGl0bGUgYW5kIHRoZSB0ZXh0IG9ubHkgYWRkcyB3aGF0IHRoZSB0aXRsZSBkb2Vzbid0XG4vLyBzYXkgLSBvZnRlbiBub3RoaW5nLlxuLy9cbi8vICAgdGl0bGUgICAgICAgLSB0aGUgcXVlc3Rpb24gKFwiRGVsZXRlIFRFUk1JTj9cIik7IGEgc3RyaW5nIG9yIGFuIGFycmF5IG9mXG4vLyAgICAgICAgICAgICAgICAgc3RyaW5ncyBhbmQgbm9kZXMgKGZvciBjb2xvcmVkIG5hbWVzLCBzZWUgYXBwZW5kVHlwTmFtZS9cbi8vICAgICAgICAgICAgICAgICBhcHBlbmRTdWJ0eXBOYW1lKVxuLy8gICBib2R5ICAgICAgICAtIG9wdGlvbmFsIHBhcmFncmFwaHMsIGVhY2ggc2hhcGVkIGxpa2UgdGl0bGVcbi8vICAgY29uZmlybVRleHQgLSBsYWJlbCBvZiB0aGUgYWN0aW9uIGJ1dHRvblxuLy8gICB3YXJuaW5nICAgICAtIGRlc3RydWN0aXZlIGFjdGlvbiAocmVkIGJ1dHRvbilcbi8vICAgZm9jdXMgICAgICAgLSBcImNvbmZpcm1cIiBvciBcImNhbmNlbFwiOiB3aGljaCBidXR0b24gRW50ZXIgdHJpZ2dlcnMuIFJlbmFtZVxuLy8gICAgICAgICAgICAgICAgIGZvY3VzZXMgdGhlIGFjdGlvbiwgZGVsZXRlIGFuZCBtZXJnZSBmb2N1cyBDYW5jZWwuXG4vLyAgIG9uQ29uZmlybSAvIG9uQ2FuY2VsIC0gb25DYW5jZWwgYWxzbyBjb3ZlcnMgRXNjYXBlIGFuZCBhIGNsaWNrIG91dHNpZGUuXG4vLyAgIGRvbnRBc2tBZ2FpbiAtIG9wdGlvbmFsOiBzaG93cyBPYnNpZGlhbidzIFwiRG9uJ3QgYXNrIGFnYWluXCIgY2hlY2tib3ggKGFzXG4vLyAgICAgICAgICAgICAgICAgaW4gaXRzIFwiRGVsZXRlIGZpbGVcIiwgZGVza3RvcCBvbmx5KSBhbmQgcGFzc2VzIGl0cyBzdGF0ZSB0b1xuLy8gICAgICAgICAgICAgICAgIG9uQ29uZmlybShkb250QXNrQWdhaW4pLiBPbmx5IGZvciBkaWFsb2dzIHRoYXQgbWF5IGJlXG4vLyAgICAgICAgICAgICAgICAgc3dpdGNoZWQgb2ZmLCBpLmUuIGFjdGlvbnMgdGhhdCBjYW4gYmUgdW5kb25lLlxuLy9cbi8vIEJvdGggY2FsbGJhY2tzIHJ1biBmcm9tIG9uQ2xvc2UsIGkuZS4gb25jZSB0aGUgZGlhbG9nIGlzIGdvbmUgLSBhcyBiZWZvcmVcbi8vIHRoZSBzd2l0Y2ggdG8gQ29uZmlybWF0aW9uTW9kYWwsIGFuZCBzbyBhIGxvbmcgb25Db25maXJtIChyZXdyaXRpbmcgbWFueVxuLy8gbm90ZXMpIG5laXRoZXIga2VlcHMgdGhlIGRpYWxvZyBvcGVuIG5vciBydW5zIHR3aWNlLlxuY2xhc3MgQ29uZmlybU1vZGFsIGV4dGVuZHMgQ29uZmlybWF0aW9uTW9kYWwge1xuICBjb25zdHJ1Y3RvcihhcHAsIHsgdGl0bGUsIGJvZHkgPSBbXSwgY29uZmlybVRleHQsIHdhcm5pbmcgPSBmYWxzZSwgZm9jdXMgPSBcImNvbmZpcm1cIiwgZG9udEFza0FnYWluID0gZmFsc2UsIG9uQ29uZmlybSwgb25DYW5jZWwgfSkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy50aXRsZSA9IHRpdGxlO1xuICAgIHRoaXMuYm9keSA9IGJvZHk7XG4gICAgdGhpcy5vbkNvbmZpcm0gPSBvbkNvbmZpcm07XG4gICAgdGhpcy5vbkNhbmNlbCA9IG9uQ2FuY2VsO1xuICAgIHRoaXMuY29uZmlybWVkID0gZmFsc2U7XG4gICAgdGhpcy5kb250QXNrQWdhaW4gPSBmYWxzZTtcblxuICAgIC8vIEJlZm9yZSB0aGUgYnV0dG9ucywgc28gaXQgc2l0cyBvbiB0aGUgbGVmdCBhcyBpbiBPYnNpZGlhbidzIGRpYWxvZ3MuXG4gICAgaWYgKGRvbnRBc2tBZ2FpbiAmJiAhUGxhdGZvcm0uaXNNb2JpbGUpIHtcbiAgICAgIHRoaXMuYWRkQ2hlY2tib3goXCJEb24ndCBhc2sgYWdhaW5cIiwgKGNoZWNrZWQpID0+IHtcbiAgICAgICAgdGhpcy5kb250QXNrQWdhaW4gPSBjaGVja2VkO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gQnV0dG9ucyBhbHJlYWR5IGhlcmUsIG5vdCBpbiBvbk9wZW46IENvbmZpcm1hdGlvbk1vZGFsLm9wZW4oKSBsb29rcyBmb3JcbiAgICAvLyB0aGUgaW5pdGlhbC1mb2N1cyBidXR0b24gYmVmb3JlIGl0IGNhbGxzIG9uT3Blbi5cbiAgICB0aGlzLmFkZEJ1dHRvbigoYnV0dG9uKSA9PiB7XG4gICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIkNhbmNlbFwiKS5zZXRDYW5jZWwoKTtcbiAgICAgIGlmIChmb2N1cyA9PT0gXCJjYW5jZWxcIikgYnV0dG9uLnNldEluaXRpYWxGb2N1cygpO1xuICAgIH0pO1xuICAgIHRoaXMuYWRkQnV0dG9uKChidXR0b24pID0+IHtcbiAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KGNvbmZpcm1UZXh0KS5zZXRDdGEoKTtcbiAgICAgIGlmICh3YXJuaW5nKSBidXR0b24uc2V0RGVzdHJ1Y3RpdmUoKTtcbiAgICAgIGlmIChmb2N1cyA9PT0gXCJjb25maXJtXCIpIGJ1dHRvbi5zZXRJbml0aWFsRm9jdXMoKTtcbiAgICAgIC8vIEJyYWNlcywgbm8gcmV0dXJuIHZhbHVlOiBDb25maXJtYXRpb25CdXR0b24ga2VlcHMgdGhlIGRpYWxvZyBvcGVuIGlmXG4gICAgICAvLyB0aGUgaGFuZGxlciByZXR1cm5zIHNvbWV0aGluZyB0cnV0aHksIGFuZCB3YWl0cyBmb3IgYSBwcm9taXNlLlxuICAgICAgYnV0dG9uLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpcm1lZCA9IHRydWU7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICBhcHBlbmRQYXJ0cyh0aGlzLnRpdGxlRWwsIHRoaXMudGl0bGUpO1xuICAgIGZvciAoY29uc3QgcGFyYWdyYXBoIG9mIHRoaXMuYm9keSkgYXBwZW5kUGFydHModGhpcy5jb250ZW50RWwuY3JlYXRlRWwoXCJwXCIpLCBwYXJhZ3JhcGgpO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICBzdXBlci5vbkNsb3NlKCk7XG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcbiAgICBpZiAodGhpcy5jb25maXJtZWQpIHRoaXMub25Db25maXJtPy4odGhpcy5kb250QXNrQWdhaW4pO1xuICAgIGVsc2UgdGhpcy5vbkNhbmNlbD8uKCk7XG4gIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IENvbmZpcm1Nb2RhbCwgYXBwZW5kVHlwTmFtZSwgYXBwZW5kU3VidHlwTmFtZSwgdHlwTmFtZU5vZGUsIHN1YnR5cE5hbWVOb2RlIH07XG4iLCAiY29uc3QgeyBOb3RpY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcblxuLy8gVW5kbyBmb3IgdGhlIGFjdGlvbnMgdGhhdCBydW4gd2l0aG91dCBhc2tpbmcgKGRlbGV0ZSBhIFN1YnR5cCwgcmVtb3ZlIGFcbi8vIHNob3J0Y3V0LCB0b2dnbGUgZmxvYXRpbmcsIHJlc2V0IGEgY29sb3IpOiBhIG5vdGljZSB3aXRoIGFuIFwiVW5kb1wiIGJ1dHRvblxuLy8gcmlnaHQgYWZ0ZXIgdGhlIGFjdGlvbi4gT25seSBwbHVnaW4gc2V0dGluZ3MsIG5ldmVyIG5vdGVzLCBhbmQgb25seSB0aGVcbi8vIExBU1QgYWN0aW9uIC0gYSBuZXcgb2ZmZXIgcmVwbGFjZXMgdGhlIHByZXZpb3VzIG9uZSwgc28gdGhlcmUgaXMgbm8gaGlzdG9yeVxuLy8gYW5kIG5vIGNvbW1hbmQuXG4vL1xuLy8gUGF0dGVybiBhdCB0aGUgY2FsbCBzaXRlOiBzbmFwc2hvdCA9IHNuYXBzaG90U2V0dGluZ3MocGx1Z2luKSBiZWZvcmUgdGhlXG4vLyBjaGFuZ2UsIHRoZW4gdGhlIGFjdGlvbiBhcyB1c3VhbCAoaW5jbHVkaW5nIHNhdmVTZXR0aW5ncygpKSwgdGhlblxuLy8gb2ZmZXJVbmRvKCkuIG9mZmVyVW5kbygpIG11c3QgY29tZSBhZnRlciBzYXZlU2V0dGluZ3MoKSBoYXMgYmVlbiBDQUxMRUQgKG5vdFxuLy8gbmVjZXNzYXJpbHkgYXdhaXRlZCksIHNpbmNlIHRoYXQgaXMgd2hhdCBidW1wcyBzZXR0aW5nc1JldmlzaW9uLlxuXG5jb25zdCBVTkRPX05PVElDRV9EVVJBVElPTiA9IDgwMDA7XG5cbi8vIHsgdG9rZW4sIHJldmlzaW9uLCBzbmFwc2hvdCB9IG9mIHRoZSBsYXN0IGFjdGlvbiwgb3IgbnVsbC5cbmxldCBjdXJyZW50ID0gbnVsbDtcblxuLy8gVGhlIHNldHRpbmdzIGFyZSBwbGFpbiBKU09OLCBzbyBzdHJ1Y3R1cmVkQ2xvbmUgaXMgYSBjb21wbGV0ZSBjb3B5LlxuZnVuY3Rpb24gc25hcHNob3RTZXR0aW5ncyhwbHVnaW4pIHtcbiAgcmV0dXJuIHN0cnVjdHVyZWRDbG9uZShwbHVnaW4uc2V0dGluZ3MpO1xufVxuXG5mdW5jdGlvbiBvZmZlclVuZG8ocGx1Z2luLCBtZXNzYWdlLCBzbmFwc2hvdCkge1xuICBjb25zdCB0b2tlbiA9IHt9O1xuICAvLyBzZXR0aW5nc1JldmlzaW9uIGNvdW50cyBldmVyeSBzYXZlIGFuZCBldmVyeSBleHRlcm5hbCByZWxvYWQgKHNlZVxuICAvLyBzYXZlU2V0dGluZ3MgaW4gbWFpbi5qcykuIElmIGl0IG1vdmVkIG9uIGJ5IHRoZSB0aW1lIFVuZG8gaXMgY2xpY2tlZCxcbiAgLy8gc29tZXRoaW5nIGVsc2UgY2hhbmdlZCB0aGUgc2V0dGluZ3MgaW4gYmV0d2VlbiAtIHJlc3RvcmluZyB0aGUgc25hcHNob3RcbiAgLy8gd291bGQgc2lsZW50bHkgcmV2ZXJ0IHRoYXQgdG9vLlxuICBjdXJyZW50ID0geyB0b2tlbiwgcmV2aXNpb246IHBsdWdpbi5zZXR0aW5nc1JldmlzaW9uID8/IDAsIHNuYXBzaG90IH07XG4gIGNvbnN0IGZyYWdtZW50ID0gY3JlYXRlRnJhZ21lbnQoKGYpID0+IHtcbiAgICBmLmFwcGVuZFRleHQobWVzc2FnZSk7XG4gICAgLy8gT2JzaWRpYW4gaGlkZXMgdGhlIG5vdGljZSBvbiBhbnkgY2xpY2sgaW5zaWRlIGl0LCB0aGUgYnV0dG9uIGluY2x1ZGVkLlxuICAgIGNvbnN0IGJ1dHRvbiA9IGYuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IFwidHlwLXVuZG8tYnV0dG9uXCIsIHRleHQ6IFwiVW5kb1wiIH0pO1xuICAgIGJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdW5kbyhwbHVnaW4sIHRva2VuKSk7XG4gIH0pO1xuICBuZXcgTm90aWNlKGZyYWdtZW50LCBVTkRPX05PVElDRV9EVVJBVElPTik7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHVuZG8ocGx1Z2luLCB0b2tlbikge1xuICBpZiAoY3VycmVudD8udG9rZW4gIT09IHRva2VuIHx8IChwbHVnaW4uc2V0dGluZ3NSZXZpc2lvbiA/PyAwKSAhPT0gY3VycmVudC5yZXZpc2lvbikge1xuICAgIG5ldyBOb3RpY2UoXCJDYW4ndCB1bmRvIFx1MjAxMyB0aGUgc2V0dGluZ3MgaGF2ZSBjaGFuZ2VkIHNpbmNlLlwiKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgeyBzbmFwc2hvdCB9ID0gY3VycmVudDtcbiAgY3VycmVudCA9IG51bGw7XG4gIC8vIEluIHBsYWNlLCBzbyBldmVyeSByZWZlcmVuY2UgdG8gcGx1Z2luLnNldHRpbmdzIHN0YXlzIHZhbGlkLiBUaGUgc25hcHNob3RcbiAgLy8gaXMgdXNlZCBvbmx5IG9uY2UsIG5vIHNlY29uZCBjb3B5IG5lZWRlZC5cbiAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMocGx1Z2luLnNldHRpbmdzKSkgZGVsZXRlIHBsdWdpbi5zZXR0aW5nc1trZXldO1xuICBPYmplY3QuYXNzaWduKHBsdWdpbi5zZXR0aW5ncywgc25hcHNob3QpO1xuICBhd2FpdCBwbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gIC8vIFRoZSBmdWxsIHJlZnJlc2ggb24gcHVycG9zZTogaXQgcmUtcmVuZGVycyB0aGUgVFlQLVBhbmUsIHdob3NlIGZyb250bWF0dGVyXG4gIC8vIGVkaXRvcnMgb25seSByZWFkIHRoZSBzZXR0aW5ncyB3aGVuIG1vdW50ZWQuXG4gIHBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHNuYXBzaG90U2V0dGluZ3MsIG9mZmVyVW5kbyB9O1xuIiwgImNvbnN0IHsgbW9tZW50IH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5cbi8vIEEgc2hvcnRjdXQgaXMgYSB2YWx1ZSBjb21wdXRlZCBvbmx5IHdoZW4gYSBub3RlIGlzIGNyZWF0ZWQuIEl0IGlzIHN0b3JlZFxuLy8gTkVYVCBUTyB0aGUgcHJvcGVydHkncyBmcm9udG1hdHRlciB2YWx1ZSwgbm90IGluIGl0OiBpblxuLy8gc2V0dGluZ3MudHlwU2hvcnRjdXRzW1RZUF1ba2V5XSBmb3IgdGhlIFRZUC1Gcm9udG1hdHRlciwgb3IgaW4gdGhlIHNob3J0Y3V0c1xuLy8gb2JqZWN0IG9mIGEgU3VidHlwIGJsb2NrIChzZWUgc3VidHlwcy5qcyk6XG4vLyAgIHsgbmFtZTogXCJ0b2RheVwiIH0gICAgICAgICAgICAtIGZpeGVkIHRva2VuLCByZXNvbHZlZCBieSB0aGUgcGx1Z2luXG4vLyAgIHsgbmFtZTogXCJ0cC48c2NyaXB0PlwiIH0gICAgICAtIFRlbXBsYXRlciBzY3JpcHQsIG9ubHkgVFlQLmpzIGNhbiByZXNvbHZlIGl0XG4vLyAgIHsgbmFtZTogXCJ0cC48c2NyaXB0PlwiLCBhcmdzOiB7IGZvbGRlcjogXCJMaXRlcmF0dXJcIiwgeWVhcjogMjAyNCB9IH1cbi8vICAgICAtIHRoZSBzYW1lIHdpdGggYXJndW1lbnRzLiBUaGUgc2NyaXB0IGRlY2xhcmVzIHRoZSBwYXJhbWV0ZXIgbmFtZXMgaW5cbi8vICAgICAgIGl0cyBAdHlwLXNob3J0Y3V0IG1hcmtlciAoc2VlIHNob3J0Y3V0LXNjcmlwdHMuanMpOyBUWVAuanMgcGFzc2VzIHRoZVxuLy8gICAgICAgb2JqZWN0IG9uIGFzIGN0eC5hcmdzLiBGaXhlZCB0b2tlbnMgbmV2ZXIgaGF2ZSBhcmd1bWVudHMuXG4vL1xuLy8gV2h5IG5leHQgdG8gdGhlIHZhbHVlOiBPYnNpZGlhbiBwaWNrcyBhIHJvdydzIGlucHV0IGZyb20gdGhlIHByb3BlcnR5IHR5cGVcbi8vIGluIHR5cGVzLmpzb24uIEEgZGF0ZS9udW1iZXIvY2hlY2tib3ggcHJvcGVydHkgY2FuJ3QgdGFrZSBhIHRva2VuIGxpa2Vcbi8vIFwie3t0b2RheX19XCIgYXQgYWxsLCBhIHN0b3JlZCBvbmUgdHJpZ2dlcnMgdGhlIFwiVHlwZSBtaXNtYXRjaFwiIHdhcm5pbmcsIGFuZFxuLy8gdGhlIGxpc3Qgd2lkZ2V0IHNpbGVudGx5IHR1cm5zIGEgc3RyaW5nIGludG8gYW4gYXJyYXkgb24gZmlyc3QgZWRpdC4gS2VwdFxuLy8gYXBhcnQsIHRoZSB2YWx1ZSBzdGF5cyB0eXBlLWNsZWFuIGFuZCB0aGUgbmF0aXZlIHdpZGdldCB1bnRvdWNoZWQuXG4vL1xuLy8gVGhlIGZyb250bWF0dGVyIHZhbHVlIHN0YXlzIGFuZCBzZXJ2ZXMgYXMgRkFMTEJBQ0s6IGlmIHRoZSBzY3JpcHQgaXMgbWlzc2luZ1xuLy8gb3IgdGhyb3dzLCBUWVAuanMgd3JpdGVzIGl0IGluc3RlYWQgb2YgYW4gZW1wdHkgdmFsdWUuIEEgc2NyaXB0IHRoYXRcbi8vIGRlbGliZXJhdGVseSByZXR1cm5zIG51bGwvXCJcIiAoZS5nLiBFU0MgaW4gYSBwaWNrZXIpIGlzIG5vdCBhIGZhaWx1cmUgYW5kXG4vLyBsZWF2ZXMgdGhlIHByb3BlcnR5IGVtcHR5LlxuXG4vLyBUb2tlbnMgdGhlIHBsdWdpbiByZXNvbHZlcyBpdHNlbGYsIHdpdGhvdXQgVGVtcGxhdGVyIC0gc28gZ2V0VHlwRGVmYXVsdHMoKVxuLy8gZmlsbHMgdGhlbSBpbi4gUmVzb2x2ZWQgb24gZWFjaCBjYWxsLCBub3Qgd2hlbiBzZXQsIHNvIFwidG9kYXlcIiBpcyB0aGUgZGF5XG4vLyB0aGUgbm90ZSBpcyBjcmVhdGVkLlxuY29uc3QgRklYRURfU0hPUlRDVVRTID0gW1xuICB7XG4gICAgbmFtZTogXCJ0b2RheVwiLFxuICAgIGRlc2NyaXB0aW9uOiBcIlRvZGF5J3MgZGF0ZSAoWVlZWS1NTS1ERClcIixcbiAgICByZXNvbHZlOiAoKSA9PiBtb21lbnQoKS5mb3JtYXQoXCJZWVlZLU1NLUREXCIpLFxuICB9LFxuICB7XG4gICAgbmFtZTogXCJub3dcIixcbiAgICBkZXNjcmlwdGlvbjogXCJDdXJyZW50IGRhdGUgYW5kIHRpbWUgKFlZWVktTU0tREQgSEg6bW0pXCIsXG4gICAgcmVzb2x2ZTogKCkgPT4gbW9tZW50KCkuZm9ybWF0KFwiWVlZWS1NTS1ERCBISDptbVwiKSxcbiAgfSxcbiAge1xuICAgIC8vIFRoZSBmaWxlJ3MgY3JlYXRpb24gZGF0ZSAoZmlsZS5zdGF0LmN0aW1lKSwgbm90IHRoZSBjYWxsIHRpbWU7IGZhbGxzXG4gICAgLy8gYmFjayB0byBub3cgd2l0aG91dCBhIGZpbGUuXG4gICAgbmFtZTogXCJjcmVhdGVkXCIsXG4gICAgZGVzY3JpcHRpb246IFwiVGhlIGZpbGUncyBjcmVhdGlvbiBkYXRlIChZWVlZLU1NLUREKVwiLFxuICAgIHJlc29sdmU6IChmaWxlKSA9PiBtb21lbnQoZmlsZT8uc3RhdD8uY3RpbWUgPz8gRGF0ZS5ub3coKSkuZm9ybWF0KFwiWVlZWS1NTS1ERFwiKSxcbiAgfSxcbl07XG5cbi8vIFNjcmlwdCBzaG9ydGN1dHMgY2FycnkgdGhpcyBwcmVmaXggc28gYSBzY3JpcHQgY2FuIG5ldmVyIGNvbGxpZGUgd2l0aCBhXG4vLyBmaXhlZCB0b2tlbiwgbm90IGV2ZW4gYSBcInRvZGF5LmpzXCIgaW4gdGhlIHNjcmlwdCBmb2xkZXIuXG5jb25zdCBTQ1JJUFRfUFJFRklYID0gXCJ0cC5cIjtcblxuZnVuY3Rpb24gZmluZEZpeGVkU2hvcnRjdXQobmFtZSkge1xuICByZXR1cm4gRklYRURfU0hPUlRDVVRTLmZpbmQoKHNob3J0Y3V0KSA9PiBzaG9ydGN1dC5uYW1lID09PSBuYW1lKSA/PyBudWxsO1xufVxuXG4vLyBTY3JpcHQgbmFtZSBvZiBhIFwidHAuPHNjcmlwdD5cIiBzaG9ydGN1dCwgb3RoZXJ3aXNlIG51bGwuIFRoZSBzY3JpcHQgbmFtZSBpc1xuLy8gdGhlIGZpbGUgbmFtZSB3aXRob3V0IFwiLmpzXCIsIHNvIHVtbGF1dHMsIFwiLVwiIGFuZCBzcGFjZXMgYXJlIGFsbG93ZWQuXG5mdW5jdGlvbiBzY3JpcHROYW1lT2YobmFtZSkge1xuICByZXR1cm4gdHlwZW9mIG5hbWUgPT09IFwic3RyaW5nXCIgJiYgbmFtZS5zdGFydHNXaXRoKFNDUklQVF9QUkVGSVgpID8gbmFtZS5zbGljZShTQ1JJUFRfUFJFRklYLmxlbmd0aCkgOiBudWxsO1xufVxuXG5mdW5jdGlvbiBpc1NjcmlwdFNob3J0Y3V0KHJlY29yZCkge1xuICByZXR1cm4gc2NyaXB0TmFtZU9mKHJlY29yZD8ubmFtZSkgIT09IG51bGw7XG59XG5cbi8vIERpc3BsYXkgZm9ybSBpbiB0aGUgcHJvcGVydHkgcm93IChjaGlwKSBhbmQgdGhlIHBpY2tlcjogdGhlIGJhcmUgbmFtZSBwbHVzXG4vLyBpdHMgYXJndW1lbnRzLiBUaGUgY2hpcCBpdHNlbGYgbWFya3MgaXQgYXMgYSBzaG9ydGN1dCwgc28gbm8gYnJhY2VzLlxuZnVuY3Rpb24gc2hvcnRjdXRMYWJlbChyZWNvcmQpIHtcbiAgaWYgKCFyZWNvcmQ/Lm5hbWUpIHJldHVybiBcIlwiO1xuICBjb25zdCB2YWx1ZXMgPSBPYmplY3QudmFsdWVzKHJlY29yZC5hcmdzID8/IHt9KS5maWx0ZXIoKHZhbHVlKSA9PiB2YWx1ZSAhPT0gdW5kZWZpbmVkKTtcbiAgcmV0dXJuIHZhbHVlcy5sZW5ndGggPiAwID8gYCR7cmVjb3JkLm5hbWV9OiAke3ZhbHVlcy5qb2luKFwiLCBcIil9YCA6IHJlY29yZC5uYW1lO1xufVxuXG4vLyBDb252ZXJ0cyBhIHR5cGVkIGFyZ3VtZW50IHRvIHRoZSB0eXBlIGl0IG9idmlvdXNseSBtZWFucywgc28gYSBzY3JpcHQgZ2V0c1xuLy8gNSBhcyBhIG51bWJlciBhbmQgdHJ1ZSBhcyBhIGJvb2xlYW4gKG1hdHRlcnMgd2hlbiB0aGUgdmFsdWUgbGFuZHMgaW4gYVxuLy8gbnVtYmVyIHByb3BlcnR5KS4gRGVsaWJlcmF0ZWx5IHRoZXNlIGZldyBjYXNlcyBpbnN0ZWFkIG9mIEpTT04ucGFyc2UsIHdoaWNoXG4vLyB3b3VsZCBmYWlsIG9uIFwiTGl0ZXJhdHVyXCIuIEFuIGVtcHR5IGZpZWxkIG1lYW5zIFwibm90IHNldFwiICh1bmRlZmluZWQpIGFuZFxuLy8gZHJvcHMgb3V0IG9mIHRoZSBhcmd1bWVudCBvYmplY3QsIHNvIFwiYXJncy55ZWFyID8/IGZhbGxiYWNrXCIgd29ya3MuXG5mdW5jdGlvbiBwYXJzZUFyZ1ZhbHVlKHJhdykge1xuICBjb25zdCB0ZXh0ID0gU3RyaW5nKHJhdyA/PyBcIlwiKS50cmltKCk7XG4gIGlmICh0ZXh0ID09PSBcIlwiKSByZXR1cm4gdW5kZWZpbmVkO1xuICBpZiAodGV4dCA9PT0gXCJ0cnVlXCIpIHJldHVybiB0cnVlO1xuICBpZiAodGV4dCA9PT0gXCJmYWxzZVwiKSByZXR1cm4gZmFsc2U7XG4gIGlmICh0ZXh0ID09PSBcIm51bGxcIikgcmV0dXJuIG51bGw7XG4gIGlmICgvXi0/XFxkKyg/OlxcLlxcZCspPyQvLnRlc3QodGV4dCkpIHJldHVybiBOdW1iZXIodGV4dCk7XG4gIHJldHVybiB0ZXh0O1xufVxuXG4vLyBQYXJhbWV0ZXIgbmFtZXMgd2hvc2UgdmFsdWVzIHRoZSBwbHVnaW4gb3IgVFlQLmpzIGFscmVhZHkga25vdzsgdGhleSBhcmVcbi8vIGZpbGxlZCBpbiBhdCBjYWxsIHRpbWUsIG5vdCBhc2tlZCBmb3I6XG4vLyAgIG5ld0ZpbGUgIHRoZSBuZXdseSBjcmVhdGVkIG5vdGVcbi8vICAgY3R4ICAgICAgdGhlIGNvbnRleHQgeyB0eXAsIHN1YnR5cCwga2V5LCB2YWx1ZXMsIGFmdGVyLCBhcmdzIH1cbi8vICAga2V5ICAgICAgdGhlIHByb3BlcnR5IHRoZSBzaG9ydGN1dCBzaXRzIG9uLCBzbyBhIHNjcmlwdCBsaWtlIHJlbGF0aW9uLmpzXG4vLyAgICAgICAgICAgIGdldHMgdGhlIHJpZ2h0IG9uZSB3aGVyZXZlciB0aGUgc2hvcnRjdXQgaXMgdXNlZFxuLy8gXCJ0cFwiIGFsd2F5cyBjb21lcyBmaXJzdCBhbmQgbmVlZG4ndCBiZSBkZWNsYXJlZDsgaWYgaXQgaXMsIGl0IGlzIHNraXBwZWQuXG5jb25zdCBSRVNFUlZFRF9QQVJBTVMgPSBbXCJuZXdGaWxlXCIsIFwiY3R4XCIsIFwia2V5XCJdO1xuXG4vLyBQYXJhbWV0ZXJzIHRoYXQgZ2V0IGFuIGlucHV0IGZpZWxkOiBldmVyeXRoaW5nIG5vdCByZXNlcnZlZC4gcGFyYW1zID09PSBudWxsXG4vLyAobWFya2VyIHdpdGhvdXQgcGFyZW50aGVzZXMpIG1lYW5zIHRoZSBjbGFzc2ljIGNhbGwsIGFsc28gd2l0aG91dCBmaWVsZHMuXG5mdW5jdGlvbiBpbnB1dFBhcmFtcyhwYXJhbXMpIHtcbiAgcmV0dXJuIChwYXJhbXMgPz8gW10pLmZpbHRlcigobmFtZSkgPT4gbmFtZSAhPT0gXCJ0cFwiICYmICFSRVNFUlZFRF9QQVJBTVMuaW5jbHVkZXMobmFtZSkpO1xufVxuXG4vLyBJbnB1dHMgKG9uZSBzdHJpbmcgcGVyIHBhcmFtZXRlcikgdG8gdGhlIHN0b3JlZCBhcmd1bWVudCBvYmplY3QsIGluIHRoZVxuLy8gZGVjbGFyZWQgb3JkZXIgc28gc2hvcnRjdXRMYWJlbCgpIHNob3dzIHRoZW0gdGhhdCB3YXkuIEVtcHR5IGZpZWxkcyBhcmUgbGVmdFxuLy8gb3V0LlxuZnVuY3Rpb24gYnVpbGRBcmdzKHBhcmFtcywgaW5wdXRzKSB7XG4gIGNvbnN0IGFyZ3MgPSB7fTtcbiAgZm9yIChjb25zdCBuYW1lIG9mIGlucHV0UGFyYW1zKHBhcmFtcykpIHtcbiAgICBjb25zdCB2YWx1ZSA9IHBhcnNlQXJnVmFsdWUoaW5wdXRzW25hbWVdKTtcbiAgICBpZiAodmFsdWUgIT09IHVuZGVmaW5lZCkgYXJnc1tuYW1lXSA9IHZhbHVlO1xuICB9XG4gIHJldHVybiBhcmdzO1xufVxuXG4vLyBCdWlsZHMgdGhlIGFyZ3VtZW50cyBmb3IgZih0cCwgLi4uaGVyZSkgZnJvbSB0aGUgZGVjbGFyZWQgcGFyYW1ldGVyIGxpc3QuXG4vLyBDYWxsZWQgZnJvbSBUWVAuanMsIHRoZSBvbmx5IHBsYWNlIHRoYXQga25vd3MgbmV3RmlsZSBhbmQgY3R4LlxuLy9cbi8vIFdpdGhvdXQgcGFyZW50aGVzZXMgKHBhcmFtcyA9PT0gbnVsbCkgaXQgc3RheXMgdGhlIGNsYXNzaWMgZih0cCwgbmV3RmlsZSxcbi8vIGN0eCkuIE90aGVyd2lzZSBlYWNoIGVudHJ5IHJlc29sdmVzIHRvIHRoZSBwYXNzZWQgdmFsdWUgKHJlc2VydmVkIG5hbWVzKSBvclxuLy8gdGhlIHR5cGVkIGFyZ3VtZW50LlxuLy9cbi8vIEEgZG90dGVkIG5hbWUgKFwib3B0aW9ucy50eXBcIikgaXMgYSBGSUVMRCBvZiBhbiBvYmplY3QgYXJndW1lbnQ6IGFsbFxuLy8gXCJvcHRpb25zLipcIiBjb2xsZWN0IGludG8gb25lIG9iamVjdCBhdCB0aGUgcG9zaXRpb24gb2YgdGhlIGZpcnN0IG9uZS4gVGhpc1xuLy8gc2VydmVzIHNjcmlwdHMgdGhhdCB0YWtlIGFuIG9wdGlvbnMgb2JqZWN0IHdpdGhvdXQgdHlwaW5nIEpTT04uIE9uZSBsZXZlbFxuLy8gb25seSAtIFwiYS5iLmNcIiBnaXZlcyBhIGZpZWxkIGxpdGVyYWxseSBuYW1lZCBcImIuY1wiLlxuZnVuY3Rpb24gcmVzb2x2ZUNhbGxBcmdzKHBhcmFtcywgYXJncywgcmVzZXJ2ZWQgPSB7fSkge1xuICBpZiAocGFyYW1zID09PSBudWxsIHx8IHBhcmFtcyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gW3Jlc2VydmVkLm5ld0ZpbGUsIHJlc2VydmVkLmN0eF07XG5cbiAgY29uc3QgY2FsbEFyZ3MgPSBbXTtcbiAgY29uc3Qgb2JqZWN0SW5kZXggPSBuZXcgTWFwKCk7XG4gIGZvciAoY29uc3QgbmFtZSBvZiBwYXJhbXMpIHtcbiAgICBpZiAobmFtZSA9PT0gXCJ0cFwiKSBjb250aW51ZTtcbiAgICBpZiAoUkVTRVJWRURfUEFSQU1TLmluY2x1ZGVzKG5hbWUpKSB7XG4gICAgICBjYWxsQXJncy5wdXNoKHJlc2VydmVkW25hbWVdKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBkb3QgPSBuYW1lLmluZGV4T2YoXCIuXCIpO1xuICAgIGlmIChkb3QgPT09IC0xKSB7XG4gICAgICBjYWxsQXJncy5wdXNoKGFyZ3M/LltuYW1lXSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgYmFzZSA9IG5hbWUuc2xpY2UoMCwgZG90KTtcbiAgICBpZiAoIW9iamVjdEluZGV4LmhhcyhiYXNlKSkge1xuICAgICAgb2JqZWN0SW5kZXguc2V0KGJhc2UsIGNhbGxBcmdzLmxlbmd0aCk7XG4gICAgICBjYWxsQXJncy5wdXNoKHt9KTtcbiAgICB9XG4gICAgY29uc3QgdmFsdWUgPSBhcmdzPy5bbmFtZV07XG4gICAgaWYgKHZhbHVlICE9PSB1bmRlZmluZWQpIGNhbGxBcmdzW29iamVjdEluZGV4LmdldChiYXNlKV1bbmFtZS5zbGljZShkb3QgKyAxKV0gPSB2YWx1ZTtcbiAgfVxuICByZXR1cm4gY2FsbEFyZ3M7XG59XG5cbi8vIFdoZXRoZXIgdHlwZXMuanNvbiAob3IsIGlmIHVuc2V0LCB0aGUgcHJvcGVydHkncyB1c2FnZSkgZGVjbGFyZXMgYSBsaXN0LlxuLy8gVGhlbiBhIHJlc29sdmVkIHNob3J0Y3V0IHZhbHVlIGlzIHdyYXBwZWQgaW4gYSBvbmUtZWxlbWVudCBhcnJheSB0byBtYXRjaC5cbi8vIFdpdGhvdXQgYXBwICh0ZXN0cykgbm90aGluZyBpcyB3cmFwcGVkLlxuZnVuY3Rpb24gaXNMaXN0UHJvcGVydHkoYXBwLCBrZXkpIHtcbiAgcmV0dXJuIGFwcD8ubWV0YWRhdGFUeXBlTWFuYWdlcj8uZ2V0VHlwZUluZm8/LihrZXkpPy5leHBlY3RlZD8udHlwZSA9PT0gXCJtdWx0aXRleHRcIjtcbn1cblxuLy8gQ29weSBvZiBmcm9udG1hdHRlciBpbiB3aGljaCBldmVyeSBrZXkgd2l0aCBhIHNob3J0Y3V0IGNhcnJpZXMgaXRzIHZhbHVlOlxuLy8gICAtIGZpeGVkIHRva2VuIC0+IHJlc29sdmVkICh3cmFwcGVkIGZvciBsaXN0IHByb3BlcnRpZXMpLFxuLy8gICAtIFwidHAuPHNjcmlwdD5cIiAtPiBudWxsOyBvbmx5IFRlbXBsYXRlciBjYW4gcmVzb2x2ZSBpdCwgVFlQLmpzIGdldHMgdGhlc2Vcbi8vICAgICBrZXlzIGZyb20gZ2V0VHlwU2hvcnRjdXRzKCkgYW5kIGZpbGxzIHRoZW0gaW4gaXRzZWxmLlxuLy8gS2V5cyB3aXRob3V0IGEgc2hvcnRjdXQgc3RheSBhcyB0aGV5IGFyZS4gVGhlIHN0b3JlZCB2YWx1ZSBvZiBhIGtleSBXSVRIIGFcbi8vIHNob3J0Y3V0IGlzIG9ubHkgb3ZlcnJpZGRlbiBoZXJlLCBuZXZlciBkZWxldGVkIC0gaXQgaXMgdGhlIGZhbGxiYWNrLlxuZnVuY3Rpb24gcmVzb2x2ZVNob3J0Y3V0cyhmcm9udG1hdHRlciwgc2hvcnRjdXRzLCB7IGZpbGUsIGFwcCB9ID0ge30pIHtcbiAgY29uc3QgcmVzb2x2ZWQgPSB7fTtcbiAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoZnJvbnRtYXR0ZXIpKSB7XG4gICAgY29uc3QgcmVjb3JkID0gc2hvcnRjdXRzPy5ba2V5XTtcbiAgICBjb25zdCBmaXhlZCA9IHJlY29yZCA/IGZpbmRGaXhlZFNob3J0Y3V0KHJlY29yZC5uYW1lKSA6IG51bGw7XG4gICAgaWYgKGZpeGVkKSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBmaXhlZC5yZXNvbHZlKGZpbGUpO1xuICAgICAgcmVzb2x2ZWRba2V5XSA9IGlzTGlzdFByb3BlcnR5KGFwcCwga2V5KSA/IFtyZXN1bHRdIDogcmVzdWx0O1xuICAgIH0gZWxzZSBpZiAoaXNTY3JpcHRTaG9ydGN1dChyZWNvcmQpKSB7XG4gICAgICByZXNvbHZlZFtrZXldID0gbnVsbDtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVzb2x2ZWRba2V5XSA9IHZhbHVlO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzb2x2ZWQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBGSVhFRF9TSE9SVENVVFMsXG4gIFNDUklQVF9QUkVGSVgsXG4gIGZpbmRGaXhlZFNob3J0Y3V0LFxuICBzY3JpcHROYW1lT2YsXG4gIGlzU2NyaXB0U2hvcnRjdXQsXG4gIHNob3J0Y3V0TGFiZWwsXG4gIHBhcnNlQXJnVmFsdWUsXG4gIGJ1aWxkQXJncyxcbiAgaW5wdXRQYXJhbXMsXG4gIHJlc29sdmVDYWxsQXJncyxcbiAgUkVTRVJWRURfUEFSQU1TLFxuICByZXNvbHZlU2hvcnRjdXRzLFxufTtcbiIsICJjb25zdCB7IEZ1enp5U3VnZ2VzdE1vZGFsLCBNb2RhbCwgU2V0dGluZywgcmVuZGVyTWF0Y2hlcyB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBGSVhFRF9TSE9SVENVVFMsIFNDUklQVF9QUkVGSVgsIGJ1aWxkQXJncywgaW5wdXRQYXJhbXMgfSA9IHJlcXVpcmUoXCIuL3Nob3J0Y3V0c1wiKTtcbmNvbnN0IHsgcGlja2VySW5zdHJ1Y3Rpb25zIH0gPSByZXF1aXJlKFwiLi90eXAtdXRpbHNcIik7XG5cbi8vIExpc3QgbGFiZWw6IHRoZSBuYW1lLCBwbHVzIHRoZSBkZWNsYXJlZCBwYXJhbWV0ZXIgbmFtZXMgZm9yIGEgc2NyaXB0LCBzb1xuLy8gdGhlIHBpY2tlciBhbHJlYWR5IHNob3dzIHRoYXQgKGFuZCBob3cpIGl0IHRha2VzIGFyZ3VtZW50cy5cbmZ1bmN0aW9uIGl0ZW1MYWJlbChpdGVtKSB7XG4gIHJldHVybiBpdGVtLnBhcmFtcyA/IGAke2l0ZW0ubmFtZX0oJHtpdGVtLnBhcmFtcy5qb2luKFwiLCBcIil9KWAgOiBpdGVtLm5hbWU7XG59XG5cbi8vIFBpY2tzIGEgc2hvcnRjdXQgZm9yIGEgVFlQLUZyb250bWF0dGVyIHByb3BlcnR5IChidXR0b24gb3IgY2hpcCBpbiB0aGUgcm93LFxuLy8gc2VlIHR5cC1mcm9udG1hdHRlci1lZGl0b3IuanMpLiBTZWFyY2hhYmxlLCBhbmQgc2NyaXB0cyBzaG93IHRoZSBkZXNjcmlwdGlvblxuLy8gZnJvbSB0aGVpciBAdHlwLXNob3J0Y3V0IG1hcmtlci4gTmV2ZXIgZnJlZSB0ZXh0OiB0aGUgbGlzdCBpcyB0aGUgc291cmNlIG9mXG4vLyB0cnV0aCwgc28gYSB0eXBvIGluIGEgc2NyaXB0IG5hbWUgaXMgaW1wb3NzaWJsZS5cbmNsYXNzIFNob3J0Y3V0UGlja2VyTW9kYWwgZXh0ZW5kcyBGdXp6eVN1Z2dlc3RNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKGFwcCwga2V5LCBpdGVtcywgcmVzb2x2ZSkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5pdGVtcyA9IGl0ZW1zO1xuICAgIHRoaXMucmVzb2x2ZSA9IHJlc29sdmU7XG4gICAgdGhpcy5jaG9zZW4gPSBmYWxzZTtcbiAgICB0aGlzLnNldFBsYWNlaG9sZGVyKGBDaG9vc2Ugc2hvcnRjdXQgZm9yIFwiJHtrZXl9XCJcdTIwMjZgKTtcbiAgICB0aGlzLnNldEluc3RydWN0aW9ucyhwaWNrZXJJbnN0cnVjdGlvbnMoKSk7XG4gIH1cblxuICBnZXRJdGVtcygpIHtcbiAgICByZXR1cm4gdGhpcy5pdGVtcztcbiAgfVxuXG4gIC8vIEZ1enp5IHNlYXJjaCBhbHNvIGNvdmVycyB0aGUgZGVzY3JpcHRpb246IFwiY3JlYXRpb25cIiBmaW5kcyBcImNyZWF0ZWRcIi5cbiAgZ2V0SXRlbVRleHQoaXRlbSkge1xuICAgIGNvbnN0IGxhYmVsID0gaXRlbUxhYmVsKGl0ZW0pO1xuICAgIHJldHVybiBpdGVtLmRlc2NyaXB0aW9uID8gYCR7bGFiZWx9ICR7aXRlbS5kZXNjcmlwdGlvbn1gIDogbGFiZWw7XG4gIH1cblxuICAvLyBNYXRjaGVkIGNoYXJhY3RlcnMgbWFya2VkIGxpa2UgaW4gT2JzaWRpYW4ncyBvd24gc3VnZ2VzdGVycy4gVGhlIHJhbmdlc1xuICAvLyByZWZlciB0byB0aGUgd2hvbGUgc2VhcmNoIHRleHQgKGdldEl0ZW1UZXh0KSwgc28gdGhlIGRlc2NyaXB0aW9uJ3MgYXJlXG4gIC8vIHNoaWZ0ZWQgYmFjayBieSB0aGUgbGFiZWwgYW5kIHRoZSBzcGFjZSBiZWZvcmUgaXQuXG4gIHJlbmRlclN1Z2dlc3Rpb24obWF0Y2gsIGVsKSB7XG4gICAgY29uc3QgaXRlbSA9IG1hdGNoLml0ZW07XG4gICAgY29uc3QgbGFiZWwgPSBpdGVtTGFiZWwoaXRlbSk7XG4gICAgY29uc3QgbWF0Y2hlcyA9IG1hdGNoLm1hdGNoPy5tYXRjaGVzPy5sZW5ndGggPyBtYXRjaC5tYXRjaC5tYXRjaGVzIDogbnVsbDtcbiAgICBlbC5hZGRDbGFzcyhcInR5cC1zaG9ydGN1dC1zdWdnZXN0aW9uXCIpO1xuICAgIHJlbmRlck1hdGNoZXMoZWwuY3JlYXRlRWwoXCJjb2RlXCIsIHsgY2xzOiBcInR5cC1zaG9ydGN1dC1zdWdnZXN0aW9uLW5hbWVcIiB9KSwgbGFiZWwsIG1hdGNoZXMsIDApO1xuICAgIGlmIChpdGVtLmRlc2NyaXB0aW9uKSB7XG4gICAgICByZW5kZXJNYXRjaGVzKGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXNob3J0Y3V0LXN1Z2dlc3Rpb24tZGVzY1wiIH0pLCBpdGVtLmRlc2NyaXB0aW9uLCBtYXRjaGVzLCAtKGxhYmVsLmxlbmd0aCArIDEpKTtcbiAgICB9XG4gIH1cblxuICAvLyBPYnNpZGlhbidzIHNlbGVjdFN1Z2dlc3Rpb24oKSBjYWxscyBjbG9zZSgpIEJFRk9SRSBvbkNob29zZUl0ZW0oKSwgc29cbiAgLy8gXCJjaG9zZW5cIiBtdXN0IGJlIHNldCBoZXJlIC0gb3RoZXJ3aXNlIG9uQ2xvc2UoKSByZXNvbHZlcyB3aXRoIG51bGwgZmlyc3RcbiAgLy8gYW5kIHRoZSBjaG9pY2UgaXMgbG9zdC4gU2FtZSBhcyBpbiBUeXBQaWNrZXJNb2RhbCAodHlwLXBpY2tlci5qcykuXG4gIHNlbGVjdFN1Z2dlc3Rpb24oaXRlbSwgZXZ0KSB7XG4gICAgdGhpcy5jaG9zZW4gPSB0cnVlO1xuICAgIHN1cGVyLnNlbGVjdFN1Z2dlc3Rpb24oaXRlbSwgZXZ0KTtcbiAgfVxuXG4gIG9uQ2hvb3NlSXRlbShpdGVtKSB7XG4gICAgdGhpcy5yZXNvbHZlKGl0ZW0pO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICBzdXBlci5vbkNsb3NlKCk7XG4gICAgaWYgKCF0aGlzLmNob3NlbikgdGhpcy5yZXNvbHZlKG51bGwpO1xuICB9XG59XG5cbi8vIEFza3MgZm9yIHRoZSBhcmd1bWVudHMgb2YgYSBzY3JpcHQgdGhhdCBkZWNsYXJlcyBzb21lOiBvbmUgZGlhbG9nIHdpdGggYWxsXG4vLyBmaWVsZHMsIG5hbWVkIGFmdGVyIHRoZSBzY3JpcHQncyBwYXJhbWV0ZXJzIGFuZCBwcmVmaWxsZWQgd2l0aCB0aGUgc3RvcmVkXG4vLyB2YWx1ZXMsIHNvIHBpY2tpbmcgdGhlIHNhbWUgc2NyaXB0IGFnYWluIGlzIGhvdyBzaW5nbGUgdmFsdWVzIGdldCBmaXhlZC5cbi8vIEFuIGVtcHR5IGZpZWxkIG1lYW5zIFwibm90IHNldFwiIChzZWUgYnVpbGRBcmdzKTsgdGhlcmUgaXMgbm8gdmFsaWRhdGlvbixcbi8vIHNpbmNlIG9ubHkgdGhlIHNjcmlwdCBrbm93cyB3aGF0IGl0IG5lZWRzLlxuY2xhc3MgU2hvcnRjdXRBcmdzTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKGFwcCwgaXRlbSwgZXhpc3RpbmcsIHJlc29sdmUpIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMuaXRlbSA9IGl0ZW07XG4gICAgdGhpcy5yZXNvbHZlID0gcmVzb2x2ZTtcbiAgICB0aGlzLmZpZWxkcyA9IGlucHV0UGFyYW1zKGl0ZW0ucGFyYW1zKTtcbiAgICB0aGlzLmlucHV0cyA9IHt9O1xuICAgIGZvciAoY29uc3QgbmFtZSBvZiB0aGlzLmZpZWxkcykge1xuICAgICAgY29uc3QgdmFsdWUgPSBleGlzdGluZz8uW25hbWVdO1xuICAgICAgdGhpcy5pbnB1dHNbbmFtZV0gPSB2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSBudWxsID8gXCJcIiA6IFN0cmluZyh2YWx1ZSk7XG4gICAgfVxuICAgIHRoaXMuY29uZmlybWVkID0gZmFsc2U7XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgdGhpcy50aXRsZUVsLnNldFRleHQoYEFyZ3VtZW50cyBmb3IgJHt0aGlzLml0ZW0ubmFtZX1gKTtcbiAgICBpZiAodGhpcy5pdGVtLmRlc2NyaXB0aW9uKSB7XG4gICAgICB0aGlzLmNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLXNob3J0Y3V0LWFyZ3MtZGVzY1wiLCB0ZXh0OiB0aGlzLml0ZW0uZGVzY3JpcHRpb24gfSk7XG4gICAgfVxuICAgIGZvciAoY29uc3QgbmFtZSBvZiB0aGlzLmZpZWxkcykge1xuICAgICAgbmV3IFNldHRpbmcodGhpcy5jb250ZW50RWwpLnNldE5hbWUobmFtZSkuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dFxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLmlucHV0c1tuYW1lXSlcbiAgICAgICAgICAub25DaGFuZ2UoKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmlucHV0c1tuYW1lXSA9IHZhbHVlO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLy8gRW50ZXIgc3VibWl0cywgbGlrZSBPYnNpZGlhbidzIG93biByZW5hbWUgZGlhbG9ncy5cbiAgICAgICAgICAuaW5wdXRFbC5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCAoZXZlbnQpID0+IHtcbiAgICAgICAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRW50ZXJcIiAmJiAhZXZlbnQuaXNDb21wb3NpbmcpIHtcbiAgICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgICAgdGhpcy5zdWJtaXQoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9XG4gICAgbmV3IFNldHRpbmcodGhpcy5jb250ZW50RWwpLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgYnV0dG9uXG4gICAgICAgIC5zZXRCdXR0b25UZXh0KFwiQXBwbHlcIilcbiAgICAgICAgLnNldEN0YSgpXG4gICAgICAgIC5vbkNsaWNrKCgpID0+IHRoaXMuc3VibWl0KCkpXG4gICAgKTtcbiAgfVxuXG4gIHN1Ym1pdCgpIHtcbiAgICB0aGlzLmNvbmZpcm1lZCA9IHRydWU7XG4gICAgdGhpcy5jbG9zZSgpO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIC8vIEVTQyBvciBhIGNsaWNrIG91dHNpZGUga2VlcHMgdGhlIGN1cnJlbnQgc2hvcnRjdXQgLSBhbiBhY2NpZGVudGFsIGNsb3NlXG4gICAgLy8gbXVzdCBub3Qgc2lsZW50bHkgbG9zZSBkYXRhLlxuICAgIHRoaXMucmVzb2x2ZSh0aGlzLmNvbmZpcm1lZCA/IGJ1aWxkQXJncyh0aGlzLmZpZWxkcywgdGhpcy5pbnB1dHMpIDogbnVsbCk7XG4gIH1cbn1cblxuLy8gT3BlbnMgdGhlIHBpY2tlciBmb3IgcHJvcGVydHkgYGtleWAuIGdldFNjcmlwdHMgaXMgdGhlIGFjY2Vzc29yIGZyb21cbi8vIHJlZ2lzdGVyU2hvcnRjdXRTY3JpcHRzKCk7IGN1cnJlbnQgaXMgdGhlIHNob3J0Y3V0IHNldCBub3cgKHRvIHByZWZpbGwgdGhlXG4vLyBhcmd1bWVudHMpLiBSZXNvbHZlcyB3aXRoIHRoZSBuZXcgcmVjb3JkICh7IG5hbWUgfSBvciB7IG5hbWUsIGFyZ3MgfSksIG9yXG4vLyBudWxsIG9uIGNhbmNlbCAtIGFsc28gd2hlbiBhIHNjcmlwdCB3YXMgcGlja2VkIGJ1dCBpdHMgYXJndW1lbnQgZGlhbG9nIHdhc1xuLy8gY2FuY2VsbGVkLlxuYXN5bmMgZnVuY3Rpb24gcGlja1Nob3J0Y3V0KGFwcCwga2V5LCBnZXRTY3JpcHRzLCBjdXJyZW50ID0gbnVsbCkge1xuICBjb25zdCBpdGVtcyA9IFtcbiAgICAuLi5GSVhFRF9TSE9SVENVVFMubWFwKCh7IG5hbWUsIGRlc2NyaXB0aW9uIH0pID0+ICh7IG5hbWUsIGRlc2NyaXB0aW9uLCBwYXJhbXM6IG51bGwgfSkpLFxuICAgIC4uLmdldFNjcmlwdHMoKS5tYXAoKHsgbmFtZSwgcGFyYW1zLCBkZXNjcmlwdGlvbiB9KSA9PiAoeyBuYW1lOiBTQ1JJUFRfUFJFRklYICsgbmFtZSwgcGFyYW1zLCBkZXNjcmlwdGlvbiB9KSksXG4gIF07XG5cbiAgY29uc3QgaXRlbSA9IGF3YWl0IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBuZXcgU2hvcnRjdXRQaWNrZXJNb2RhbChhcHAsIGtleSwgaXRlbXMsIHJlc29sdmUpLm9wZW4oKSk7XG4gIGlmICghaXRlbSkgcmV0dXJuIG51bGw7XG4gIC8vIE5vIGZpZWxkcyB0byBhc2sgZm9yIChmaXhlZCB0b2tlbnMsIG9yIG9ubHkgcmVzZXJ2ZWQgbmFtZXMgbGlrZVxuICAvLyBcIihuZXdGaWxlKVwiKTogbm8gc2Vjb25kIHN0ZXAuXG4gIGlmIChpbnB1dFBhcmFtcyhpdGVtLnBhcmFtcykubGVuZ3RoID09PSAwKSByZXR1cm4geyBuYW1lOiBpdGVtLm5hbWUgfTtcblxuICAvLyBQcmVmaWxsIG9ubHkgZm9yIHRoZSBzYW1lIHNjcmlwdDsgb2xkIHZhbHVlcyBtZWFuIG5vdGhpbmcgdG8gYW5vdGhlciBvbmUuXG4gIGNvbnN0IHByZWZpbGwgPSBjdXJyZW50Py5uYW1lID09PSBpdGVtLm5hbWUgPyBjdXJyZW50LmFyZ3MgOiBudWxsO1xuICBjb25zdCBhcmdzID0gYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IG5ldyBTaG9ydGN1dEFyZ3NNb2RhbChhcHAsIGl0ZW0sIHByZWZpbGwsIHJlc29sdmUpLm9wZW4oKSk7XG4gIGlmIChhcmdzID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIE9iamVjdC5rZXlzKGFyZ3MpLmxlbmd0aCA+IDAgPyB7IG5hbWU6IGl0ZW0ubmFtZSwgYXJncyB9IDogeyBuYW1lOiBpdGVtLm5hbWUgfTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHBpY2tTaG9ydGN1dCB9O1xuIiwgImNvbnN0IHsgTWFya2Rvd25WaWV3LCBNZW51LCBXb3Jrc3BhY2VMZWFmLCBzZXRJY29uIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IHNob3J0Y3V0TGFiZWwsIHNjcmlwdE5hbWVPZiB9ID0gcmVxdWlyZShcIi4vc2hvcnRjdXRzXCIpO1xuY29uc3QgeyBwaWNrU2hvcnRjdXQgfSA9IHJlcXVpcmUoXCIuL3Nob3J0Y3V0LXBpY2tlclwiKTtcbmNvbnN0IHsgZ2V0U3VidHlwLCBlbnN1cmVTdWJ0eXAgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cHNcIik7XG5jb25zdCB7IFRZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZIH0gPSByZXF1aXJlKFwiLi90eXAtaW5kZXhcIik7XG5jb25zdCB7IHNuYXBzaG90U2V0dGluZ3MsIG9mZmVyVW5kbyB9ID0gcmVxdWlyZShcIi4vdW5kb1wiKTtcblxuLy8gTWFya3MgdGhlIFRZUC1Gcm9udG1hdHRlciBlZGl0b3IncyBjb250YWluZXIgc28gdGhlIHNob3J0Y3V0IHJ1bGVzIGluXG4vLyBzdHlsZXMuY3NzIGFwcGx5IG9ubHkgaGVyZSwgbmV2ZXIgaW4gcmVhbCBub3Rlcy5cbmNvbnN0IEVESVRPUl9DTEFTUyA9IFwidHlwLWZyb250bWF0dGVyLWVkaXRvclwiO1xuXG5jb25zdCBTWVNURU1fUFJPUEVSVElFUyA9IFtUWVBfUFJPUEVSVFkudG9Mb3dlckNhc2UoKSwgU1VCVFlQX1BST1BFUlRZLnRvTG93ZXJDYXNlKCldO1xuXG4vLyBUaGUgdmFsdWUgb2YgVFlQL1NVQlRZUCBpcyBieSBkZWZpbml0aW9uIHRoZSBUWVAgb3IgU3VidHlwIG5hbWUgaXRzZWxmOyBhc1xuLy8gYSBzdGFuZGFyZCBwcm9wZXJ0eSBpdCB3b3VsZCBiZSByZWR1bmRhbnQgYW5kIGNvdWxkIHNpbGVudGx5IGRyaWZ0IGZyb20gdGhlXG4vLyByZWFsIG5hbWUgYWZ0ZXIgYSByZW5hbWUsIHNvIGl0IG5ldmVyIGFwcGVhcnMgYXMgYSByb3cgaGVyZS5cbi8vIE11dGF0ZXMgaW4gcGxhY2UgaW5zdGVhZCBvZiByZXR1cm5pbmcgYSBjb3B5OiBPYnNpZGlhbidzIHByb3BlcnR5IGVkaXRvclxuLy8gc2VlbXMgdG8gcmVseSBvbiBhIHN0YWJsZSBvYmplY3QgcmVmZXJlbmNlIGluIHN5bmNocm9uaXplKCk7IGEgZnJlc2ggY29weVxuLy8gY2F1c2VkIGEgc3RhY2sgb3ZlcmZsb3cgaW4gaXRzIHJlbmRlclByb3BlcnR5KCkgcGlwZWxpbmUgb24gZmlyc3QgcmVuZGVyLlxuZnVuY3Rpb24gc3RyaXBUeXBQcm9wZXJ0eShmcm9udG1hdHRlcikge1xuICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhmcm9udG1hdHRlcikpIHtcbiAgICBpZiAoU1lTVEVNX1BST1BFUlRJRVMuaW5jbHVkZXMoa2V5LnRyaW0oKS50b0xvd2VyQ2FzZSgpKSkgZGVsZXRlIGZyb250bWF0dGVyW2tleV07XG4gIH1cbiAgcmV0dXJuIGZyb250bWF0dGVyO1xufVxuXG4vLyBXaGVyZSBhIGZyb250bWF0dGVyIGJsb2NrIGxpdmVzIGluIHRoZSBzZXR0aW5nczogYSBUWVAncyBUWVAtRnJvbnRtYXR0ZXJcbi8vICh0eXBEZWZhdWx0RnJvbnRtYXR0ZXIvdHlwRmxvYXRpbmdLZXlzL3R5cFNob3J0Y3V0cykgb3Igb25lIG9mIGl0cyBTdWJ0eXBcbi8vIGJsb2NrcyAodHlwU3VidHlwcywgc2VlIHN1YnR5cHMuanMpLiBFZGl0b3IsIGZsb2F0aW5nIG1lbnUsIHNob3J0Y3V0IGJ1dHRvblxuLy8gYW5kIHByb3BlcnR5IHJlbmFtZSBvbmx5IHVzZSB0aGlzIGludGVyZmFjZSBhbmQgbmVlZG4ndCBrbm93IHdoaWNoLlxuLy9cbi8vIGdldFNob3J0Y3V0cy9zZXRTaG9ydGN1dHMgaG9sZCB0aGUgc2hvcnRjdXQgcmVjb3JkcyBwZXIga2V5IChzZWVcbi8vIHNob3J0Y3V0cy5qcykgLSBuZXh0IHRvIHRoZSBmcm9udG1hdHRlciwgbm90IGluIGl0LCBzbyB0aGUgdmFsdWUgc3RheXNcbi8vIHR5cGUtY2xlYW4uIFdpdGggYSBzaG9ydGN1dCBzZXQsIHRoZSB2YWx1ZSByZW1haW5zIGFzIGZhbGxiYWNrLlxuZnVuY3Rpb24gdHlwU3RvcmUocGx1Z2luLCB0eXApIHtcbiAgcmV0dXJuIHtcbiAgICB0eXAsXG4gICAgc3VidHlwOiBudWxsLFxuICAgIGdldEZyb250bWF0dGVyOiAoKSA9PiBwbHVnaW4uc2V0dGluZ3MudHlwRGVmYXVsdEZyb250bWF0dGVyW3R5cF0gPz8ge30sXG4gICAgc2V0RnJvbnRtYXR0ZXI6IChmcm9udG1hdHRlcikgPT4ge1xuICAgICAgcGx1Z2luLnNldHRpbmdzLnR5cERlZmF1bHRGcm9udG1hdHRlclt0eXBdID0gZnJvbnRtYXR0ZXI7XG4gICAgfSxcbiAgICBnZXRGbG9hdGluZzogKCkgPT4gcGx1Z2luLnNldHRpbmdzLnR5cEZsb2F0aW5nS2V5c1t0eXBdID8/IFtdLFxuICAgIHNldEZsb2F0aW5nOiAoa2V5cykgPT4ge1xuICAgICAgaWYgKGtleXMubGVuZ3RoID4gMCkgcGx1Z2luLnNldHRpbmdzLnR5cEZsb2F0aW5nS2V5c1t0eXBdID0ga2V5cztcbiAgICAgIGVsc2UgZGVsZXRlIHBsdWdpbi5zZXR0aW5ncy50eXBGbG9hdGluZ0tleXNbdHlwXTtcbiAgICB9LFxuICAgIGdldFNob3J0Y3V0czogKCkgPT4gcGx1Z2luLnNldHRpbmdzLnR5cFNob3J0Y3V0c1t0eXBdID8/IHt9LFxuICAgIHNldFNob3J0Y3V0czogKHNob3J0Y3V0cykgPT4ge1xuICAgICAgaWYgKE9iamVjdC5rZXlzKHNob3J0Y3V0cykubGVuZ3RoID4gMCkgcGx1Z2luLnNldHRpbmdzLnR5cFNob3J0Y3V0c1t0eXBdID0gc2hvcnRjdXRzO1xuICAgICAgZWxzZSBkZWxldGUgcGx1Z2luLnNldHRpbmdzLnR5cFNob3J0Y3V0c1t0eXBdO1xuICAgIH0sXG4gIH07XG59XG5cbmZ1bmN0aW9uIHN1YnR5cFN0b3JlKHBsdWdpbiwgdHlwLCBzdWJ0eXApIHtcbiAgcmV0dXJuIHtcbiAgICB0eXAsXG4gICAgc3VidHlwLFxuICAgIGdldEZyb250bWF0dGVyOiAoKSA9PiBnZXRTdWJ0eXAocGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCk/LmZyb250bWF0dGVyID8/IHt9LFxuICAgIHNldEZyb250bWF0dGVyOiAoZnJvbnRtYXR0ZXIpID0+IHtcbiAgICAgIGVuc3VyZVN1YnR5cChwbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKS5mcm9udG1hdHRlciA9IGZyb250bWF0dGVyO1xuICAgIH0sXG4gICAgZ2V0RmxvYXRpbmc6ICgpID0+IGdldFN1YnR5cChwbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKT8uZmxvYXRpbmdLZXlzID8/IFtdLFxuICAgIHNldEZsb2F0aW5nOiAoa2V5cykgPT4ge1xuICAgICAgZW5zdXJlU3VidHlwKHBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApLmZsb2F0aW5nS2V5cyA9IGtleXM7XG4gICAgfSxcbiAgICBnZXRTaG9ydGN1dHM6ICgpID0+IGdldFN1YnR5cChwbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKT8uc2hvcnRjdXRzID8/IHt9LFxuICAgIHNldFNob3J0Y3V0czogKHNob3J0Y3V0cykgPT4ge1xuICAgICAgZW5zdXJlU3VidHlwKHBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApLnNob3J0Y3V0cyA9IHNob3J0Y3V0cztcbiAgICB9LFxuICB9O1xufVxuXG4vLyBPYnNpZGlhbidzIHByb3BlcnRpZXMgd2lkZ2V0IGlzIG5vIG9mZmljaWFsIEFQSS4gSW50ZXJuYWxseSBpdCBpcyBhXG4vLyBjb21wb25lbnQgY2xhc3MgKG1pbmlmaWVkIFwiTWV0YWRhdGFFZGl0b3JcIikgdGhhdCBldmVyeSBNYXJrZG93blZpZXcgYW5kIHRoZVxuLy8gZmlsZSBwcm9wZXJ0aWVzIHBhbmUgaW5zdGFudGlhdGUgYXMgdmlldy5tZXRhZGF0YUVkaXRvci4gSXQgaXNuJ3QgZXhwb3J0ZWQsXG4vLyBidXQgYW55IGluc3RhbmNlIHJlYWNoZXMgaXQgdmlhIC5jb25zdHJ1Y3RvciwgYW5kIGl0IGlzIHN0YWJsZSBmb3IgdGhlXG4vLyBzZXNzaW9uIC0gZ3JhYmJpbmcgaXQgb25jZSBpcyBlbm91Z2guXG5sZXQgY2FjaGVkRWRpdG9yQ2xhc3MgPSBudWxsO1xuXG5mdW5jdGlvbiBnZXRNZXRhZGF0YUVkaXRvckNsYXNzKGFwcCkge1xuICBpZiAoY2FjaGVkRWRpdG9yQ2xhc3MpIHJldHVybiBjYWNoZWRFZGl0b3JDbGFzcztcblxuICBjb25zdCBhY3RpdmUgPSBhcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcbiAgaWYgKGFjdGl2ZT8ubWV0YWRhdGFFZGl0b3IpIHtcbiAgICBjYWNoZWRFZGl0b3JDbGFzcyA9IGFjdGl2ZS5tZXRhZGF0YUVkaXRvci5jb25zdHJ1Y3RvcjtcbiAgICByZXR1cm4gY2FjaGVkRWRpdG9yQ2xhc3M7XG4gIH1cbiAgZm9yIChjb25zdCBsZWFmIG9mIGFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikpIHtcbiAgICBpZiAobGVhZi52aWV3Py5tZXRhZGF0YUVkaXRvcikge1xuICAgICAgY2FjaGVkRWRpdG9yQ2xhc3MgPSBsZWFmLnZpZXcubWV0YWRhdGFFZGl0b3IuY29uc3RydWN0b3I7XG4gICAgICByZXR1cm4gY2FjaGVkRWRpdG9yQ2xhc3M7XG4gICAgfVxuICB9XG4gIGNhY2hlZEVkaXRvckNsYXNzID0gaGFydmVzdEVkaXRvckNsYXNzKGFwcCk7XG4gIHJldHVybiBjYWNoZWRFZGl0b3JDbGFzcztcbn1cblxuLy8gQmVmb3JlIGFueSBub3RlIHdhcyBvcGVuIHRoaXMgc2Vzc2lvbiB0aGVyZSBpcyBubyBpbnN0YW5jZSB0byByZWFjaCB0aGVcbi8vIGNsYXNzIHRocm91Z2guIFRoZW4gd2UgYnVpbGQgb25lOiBhIGZyZWUgV29ya3NwYWNlTGVhZiAobm8gcGFyZW50LCBuZXZlciBpblxuLy8gdGhlIERPTSkgd2l0aCBhIE1hcmtkb3duVmlldyBmcm9tIE9ic2lkaWFuJ3MgdmlldyByZWdpc3RyeSwgd2hvc2Vcbi8vIGNvbnN0cnVjdG9yIGNyZWF0ZXMgbWV0YWRhdGFFZGl0b3IuIE9ubHkgdGhlIGNsYXNzIGlzIG5lZWRlZDsgdGhlIHZpZXcgaXNcbi8vIHVubG9hZGVkIHJpZ2h0IGF3YXkuIERlbGliZXJhdGVseSBOT1QgbGVhZi5kZXRhY2goKTogdGhhdCBleHBlY3RzIGEgcGFyZW50XG4vLyB0aGlzIGxlYWYgbmV2ZXIgaGFkLlxuZnVuY3Rpb24gaGFydmVzdEVkaXRvckNsYXNzKGFwcCkge1xuICBsZXQgdmlldyA9IG51bGw7XG4gIHRyeSB7XG4gICAgY29uc3QgY3JlYXRlVmlldyA9IGFwcC52aWV3UmVnaXN0cnk/LmdldFZpZXdDcmVhdG9yQnlUeXBlPy4oXCJtYXJrZG93blwiKTtcbiAgICBpZiAoIWNyZWF0ZVZpZXcpIHJldHVybiBudWxsO1xuICAgIHZpZXcgPSBjcmVhdGVWaWV3KG5ldyBXb3Jrc3BhY2VMZWFmKGFwcCkpO1xuICAgIHJldHVybiB2aWV3Lm1ldGFkYXRhRWRpdG9yPy5jb25zdHJ1Y3RvciA/PyBudWxsO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnNvbGUuZXJyb3IoXCJbdHlwLXN5c3RlbV0gY291bGRuJ3QgZmluZCB0aGUgTWV0YWRhdGFFZGl0b3IgY2xhc3NcIiwgZXJyb3IpO1xuICAgIHJldHVybiBudWxsO1xuICB9IGZpbmFsbHkge1xuICAgIHRyeSB7XG4gICAgICB2aWV3Py51bmxvYWQoKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihcIlt0eXAtc3lzdGVtXSBjb3VsZG4ndCBkaXNjYXJkIHRoZSBoZWxwZXIgTWFya2Rvd25WaWV3XCIsIGVycm9yKTtcbiAgICB9XG4gIH1cbn1cblxuLy8gTGlrZSBnZXRNZXRhZGF0YUVkaXRvckNsYXNzOiB0aGUgcHJpdmF0ZSBwcm9wZXJ0eSByb3cgY2xhc3MsIHRha2VuIGZyb20gYW5cbi8vIGFscmVhZHkgcmVuZGVyZWQgcm93LiBPbmx5IGVuc3VyZVByb3BlcnR5TWVudVBhdGNoKCkgbmVlZHMgaXQsIGFuZCBgZWRpdG9yYFxuLy8gdXN1YWxseSBoYXMgYSByb3cgYnkgdGhlbiwgc28gaXQgaXMgdHJpZWQgZmlyc3QuXG5sZXQgY2FjaGVkUHJvcGVydHlSb3dDbGFzcyA9IG51bGw7XG5cbmZ1bmN0aW9uIGdldFByb3BlcnR5Um93Q2xhc3MoYXBwLCBlZGl0b3IpIHtcbiAgaWYgKGNhY2hlZFByb3BlcnR5Um93Q2xhc3MpIHJldHVybiBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzO1xuICBpZiAoZWRpdG9yPy5yZW5kZXJlZD8uWzBdKSB7XG4gICAgY2FjaGVkUHJvcGVydHlSb3dDbGFzcyA9IGVkaXRvci5yZW5kZXJlZFswXS5jb25zdHJ1Y3RvcjtcbiAgICByZXR1cm4gY2FjaGVkUHJvcGVydHlSb3dDbGFzcztcbiAgfVxuICBjb25zdCBhY3RpdmUgPSBhcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcbiAgaWYgKGFjdGl2ZT8ubWV0YWRhdGFFZGl0b3I/LnJlbmRlcmVkPy5bMF0pIHtcbiAgICBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzID0gYWN0aXZlLm1ldGFkYXRhRWRpdG9yLnJlbmRlcmVkWzBdLmNvbnN0cnVjdG9yO1xuICAgIHJldHVybiBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzO1xuICB9XG4gIGZvciAoY29uc3QgbGVhZiBvZiBhcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpKSB7XG4gICAgaWYgKGxlYWYudmlldz8ubWV0YWRhdGFFZGl0b3I/LnJlbmRlcmVkPy5bMF0pIHtcbiAgICAgIGNhY2hlZFByb3BlcnR5Um93Q2xhc3MgPSBsZWFmLnZpZXcubWV0YWRhdGFFZGl0b3IucmVuZGVyZWRbMF0uY29uc3RydWN0b3I7XG4gICAgICByZXR1cm4gY2FjaGVkUHJvcGVydHlSb3dDbGFzcztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8vIEFkZHMgYSBcIkZsb2F0aW5nXCIgdG9nZ2xlIGF0IHRoZSB2ZXJ5IHRvcCBvZiBhIHByb3BlcnR5IHJvdydzIGNvbnRleHQgbWVudSAtXG4vLyBvbmx5IGZvciByb3dzIG9mIHRoZSBwbHVnaW4ncyBvd24gVFlQLVBhbmUgKHJlY29nbml6ZWQgYnkgb3duZXIudHlwU3RvcmUpLFxuLy8gbmV2ZXIgaW4gcmVhbCBub3Rlcy4gVW5saWtlIHRoZSBleHRyYSBcIitcIiBidXR0b24gKHR5cFBlbmRpbmdGbG9hdGluZ0FkZCksXG4vLyB3aGljaCBvbmx5IGFmZmVjdHMgYSBORVcgcHJvcGVydHksIHRoaXMgd29ya3Mgb24gYW55IGV4aXN0aW5nIG9uZSwgYm90aCB3YXlzLlxuLy9cbi8vIFRoZSBwcm9wZXJ0eSBtZW51IGlzIG5vIG9mZmljaWFsIGV4dGVuc2lvbiBwb2ludDogb24gZGVza3RvcCBpdCBidWlsZHMgYVxuLy8gTkFUSVZFIEVsZWN0cm9uIG1lbnUgZnJvbSBhbiBpbnRlcm5hbCBNZW51IGFuZCBzaG93cyBpdCB3aXRoaW5cbi8vIHNob3dQcm9wZXJ0eU1lbnUoKSBpbiBvbmUgc3luY2hyb25vdXMgY2FsbCAtIG5vIHdvcmtzcGFjZSBldmVudCwgbm8gRE9NXG4vLyBwb3B1cCB0byBhbWVuZCBhZnRlcndhcmRzLiBTbyB0aGUgcHJpdmF0ZSByb3cgY2xhc3MgaXMgcGF0Y2hlZCwgYXMgbmFycm93bHlcbi8vIGFzIHBvc3NpYmxlOiBmb3Igb3VyIHJvd3MsIHJpZ2h0IGJlZm9yZSBPYnNpZGlhbiBzaG93cyBpdHMgZmluaXNoZWQgbWVudSxcbi8vIG9uZSBhZGRJdGVtKCkgaXMgc2xpcHBlZCBpbiB0aHJvdWdoIGEgcGF0Y2ggb24gTWVudS5wcm90b3R5cGUuc2hvd0F0TW91c2VFdmVudFxuLy8gdGhhdCByZXNldHMgaXRzZWxmIGFmdGVyIHRoaXMgb25lIGNhbGwgKHNhZmUsIEpTIGlzIHNpbmdsZS10aHJlYWRlZCkuIFRoZVxuLy8gcmVzdCBvZiB0aGUgbmF0aXZlIG1lbnUgc3RheXMgdW50b3VjaGVkLlxubGV0IHVuZG9Qcm9wZXJ0eU1lbnVQYXRjaCA9IG51bGw7XG5cbmZ1bmN0aW9uIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoKGFwcCwgZWRpdG9yKSB7XG4gIGNvbnN0IFJvd0NsYXNzID0gZ2V0UHJvcGVydHlSb3dDbGFzcyhhcHAsIGVkaXRvcik7XG4gIGlmICghUm93Q2xhc3MgfHwgUm93Q2xhc3MuX3R5cFN5c3RlbU1lbnVQYXRjaGVkKSByZXR1cm47XG4gIFJvd0NsYXNzLl90eXBTeXN0ZW1NZW51UGF0Y2hlZCA9IHRydWU7XG5cbiAgY29uc3Qgb3JpZ2luYWxTaG93UHJvcGVydHlNZW51ID0gUm93Q2xhc3MucHJvdG90eXBlLnNob3dQcm9wZXJ0eU1lbnU7XG4gIHVuZG9Qcm9wZXJ0eU1lbnVQYXRjaCA9ICgpID0+IHtcbiAgICBSb3dDbGFzcy5wcm90b3R5cGUuc2hvd1Byb3BlcnR5TWVudSA9IG9yaWdpbmFsU2hvd1Byb3BlcnR5TWVudTtcbiAgICBkZWxldGUgUm93Q2xhc3MuX3R5cFN5c3RlbU1lbnVQYXRjaGVkO1xuICB9O1xuICBSb3dDbGFzcy5wcm90b3R5cGUuc2hvd1Byb3BlcnR5TWVudSA9IGZ1bmN0aW9uIChldmVudCkge1xuICAgIGNvbnN0IG93bmVyID0gdGhpcy5tZXRhZGF0YUVkaXRvcj8ub3duZXI7XG4gICAgaWYgKCFvd25lcj8udHlwU3RvcmUpIHJldHVybiBvcmlnaW5hbFNob3dQcm9wZXJ0eU1lbnUuY2FsbCh0aGlzLCBldmVudCk7XG5cbiAgICBjb25zdCByb3cgPSB0aGlzO1xuICAgIGNvbnN0IG9yaWdpbmFsU2hvd0F0TW91c2VFdmVudCA9IE1lbnUucHJvdG90eXBlLnNob3dBdE1vdXNlRXZlbnQ7XG4gICAgTWVudS5wcm90b3R5cGUuc2hvd0F0TW91c2VFdmVudCA9IGZ1bmN0aW9uIChtb3VzZUV2ZW50KSB7XG4gICAgICBNZW51LnByb3RvdHlwZS5zaG93QXRNb3VzZUV2ZW50ID0gb3JpZ2luYWxTaG93QXRNb3VzZUV2ZW50O1xuICAgICAgY29uc3QgaXNGbG9hdGluZyA9IG93bmVyLnR5cFN0b3JlLmdldEZsb2F0aW5nKCkuaW5jbHVkZXMocm93LmVudHJ5LmtleSk7XG4gICAgICAvLyBcInRpdGxlXCIgaXMgdGhlIGZpcnN0IHNlY3Rpb24gc2hvd1Byb3BlcnR5TWVudSByZWdpc3RlcnMgYW5kIGlzIGVtcHR5XG4gICAgICAvLyBvbiBkZXNrdG9wLCBzbyB0aGlzIGxhbmRzIHJlbGlhYmx5IG9uIHRvcC4gXCJwaW4tb2ZmXCIgPSBub3QgcGlubmVkID1cbiAgICAgIC8vIGZsb2F0aW5nLlxuICAgICAgdGhpcy5hZGRJdGVtKChpdGVtKSA9PlxuICAgICAgICBpdGVtXG4gICAgICAgICAgLnNldFRpdGxlKFwiRmxvYXRpbmdcIilcbiAgICAgICAgICAuc2V0SWNvbihcInBpbi1vZmZcIilcbiAgICAgICAgICAuc2V0Q2hlY2tlZChpc0Zsb2F0aW5nKVxuICAgICAgICAgIC5zZXRTZWN0aW9uKFwidGl0bGVcIilcbiAgICAgICAgICAub25DbGljaygoKSA9PiB0b2dnbGVGbG9hdGluZ1Byb3BlcnR5KG93bmVyLnR5cFBhbmUsIG93bmVyLnR5cFN0b3JlLCByb3cuZW50cnkua2V5KSlcbiAgICAgICk7XG4gICAgICByZXR1cm4gb3JpZ2luYWxTaG93QXRNb3VzZUV2ZW50LmNhbGwodGhpcywgbW91c2VFdmVudCk7XG4gICAgfTtcblxuICAgIHJldHVybiBvcmlnaW5hbFNob3dQcm9wZXJ0eU1lbnUuY2FsbCh0aGlzLCBldmVudCk7XG4gIH07XG59XG5cbi8vIE9uIHVubG9hZDsgb3RoZXJ3aXNlIHRoZSBwYXRjaCB3b3VsZCBvdXRsaXZlIGEgaG90IHJlbG9hZCB3aXRoIHRoZSBvbGRcbi8vIG1vZHVsZSdzIGNsb3N1cmVzLlxuZnVuY3Rpb24gcmVtb3ZlUHJvcGVydHlNZW51UGF0Y2goKSB7XG4gIHVuZG9Qcm9wZXJ0eU1lbnVQYXRjaD8uKCk7XG4gIHVuZG9Qcm9wZXJ0eU1lbnVQYXRjaCA9IG51bGw7XG59XG5cbmZ1bmN0aW9uIHRvZ2dsZUZsb2F0aW5nUHJvcGVydHkodmlldywgc3RvcmUsIGtleSkge1xuICBjb25zdCBmbG9hdGluZyA9IHN0b3JlLmdldEZsb2F0aW5nKCk7XG4gIHN0b3JlLnNldEZsb2F0aW5nKGZsb2F0aW5nLmluY2x1ZGVzKGtleSkgPyBmbG9hdGluZy5maWx0ZXIoKGspID0+IGsgIT09IGtleSkgOiBbLi4uZmxvYXRpbmcsIGtleV0pO1xuICB2aWV3LnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgLy8gVXBkYXRlcyB0aGUgYm9sZC9pdGFsaWMgbWFya3MgYXQgb25jZSwgaGVyZSAocmVmcmVzaEZyb250bWF0dGVySGlnaGxpZ2h0XG4gIC8vIGNvdmVycyB0aGUgVFlQLVBhbmUncyBvd24gZWRpdG9ycykgYW5kIGluIG9wZW4gbm90ZXMgLSB3aXRob3V0XG4gIC8vIHJlLXJlbmRlcmluZyB0aGlzIFRZUC1QYW5lLCBzZWUgcmVmcmVzaFR5cENvbG9yc0V4Y2VwdCBpbiBtYWluLmpzLlxuICB2aWV3LnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzRXhjZXB0Py4odmlldyk7XG59XG5cbi8vIEtleWJvYXJkIG5hdmlnYXRpb24gYmV5b25kIG9uZSBlZGl0b3IgaW5zdGFuY2UgKHNlZSBmcm9udG1hdHRlci1ibG9ja3MuanMpOlxuLy8gT2JzaWRpYW4gbW92ZXMgZm9jdXMgb25seSB3aXRoaW4gaXRzIG93biByb3cgbGlzdCwgYW5kIGF0IGVpdGhlciBlbmQgb250b1xuLy8gdGhlIGVkaXRvcidzIGhlYWRpbmcgb3IgXCJBZGQgcHJvcGVydHlcIiBidXR0b24gLSBib3RoIGhpZGRlbiBoZXJlIGJ5IENTUywgc29cbi8vIHRoZSBjaGFpbiBzdG9wcGVkIGF0IHRoZSBibG9jayBlZGdlLlxuLy9cbi8vIG93bmVyLnNoaWZ0Rm9jdXNCZWZvcmUvQWZ0ZXIgYXJlIG9ubHkgcmVhY2hlZCB0aHJvdWdoIGV4YWN0bHkgdGhvc2UgaGlkZGVuXG4vLyBlbGVtZW50cywgc28gaW5zdGVhZCBhIGNhcHR1cmUtcGhhc2UgaGFuZGxlciBydW5zIEJFRk9SRSB0aGUgcm93J3Mgb3duLiBJdFxuLy8gb25seSBhY3RzIHdoaWxlIHRoZSByb3cgSVRTRUxGIGhhcyBmb2N1cyAoZXZlbnQudGFyZ2V0IGlzIHRoZSByb3cnc1xuLy8gY29udGFpbmVyKSAtIHRoZSBzYW1lIGNvbmRpdGlvbiB1bmRlciB3aGljaCBPYnNpZGlhbiBhbGxvd3Mgai9rLCBzbyBuZXZlclxuLy8gd2hpbGUgdHlwaW5nIGluIGEgZmllbGQuXG5mdW5jdGlvbiByZWdpc3RlckZvY3VzQ2hhaW4oZWRpdG9yLCBvblNoaWZ0Rm9jdXMpIHtcbiAgZWRpdG9yLmNvbnRhaW5lckVsLmFkZEV2ZW50TGlzdGVuZXIoXG4gICAgXCJrZXlkb3duXCIsXG4gICAgKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoZXZlbnQuaXNDb21wb3NpbmcgfHwgZXZlbnQuZGVmYXVsdFByZXZlbnRlZCkgcmV0dXJuO1xuICAgICAgLy8gTXVsdGktc2VsZWN0aW9uOiBPYnNpZGlhbiBleHRlbmRzIHRoZSBzZWxlY3Rpb24gaW5zdGVhZCBvZiBtb3ZpbmcuXG4gICAgICBpZiAoZWRpdG9yLnNlbGVjdGVkTGluZXM/LnNpemUgPiAxKSByZXR1cm47XG4gICAgICBpZiAoZXZlbnQuc2hpZnRLZXkgJiYgKGV2ZW50LmtleSA9PT0gXCJBcnJvd1VwXCIgfHwgZXZlbnQua2V5ID09PSBcIkFycm93RG93blwiKSkgcmV0dXJuO1xuXG4gICAgICBjb25zdCBpbmRleCA9IGVkaXRvci5yZW5kZXJlZC5maW5kSW5kZXgoKHJvdykgPT4gcm93LmNvbnRhaW5lckVsID09PSBldmVudC50YXJnZXQpO1xuICAgICAgaWYgKGluZGV4ID09PSAtMSkgcmV0dXJuO1xuXG4gICAgICBjb25zdCB1cCA9IGV2ZW50LmtleSA9PT0gXCJBcnJvd1VwXCIgfHwgZXZlbnQua2V5ID09PSBcImtcIiB8fCAoZXZlbnQua2V5ID09PSBcIlRhYlwiICYmIGV2ZW50LnNoaWZ0S2V5KTtcbiAgICAgIGNvbnN0IGRvd24gPSBldmVudC5rZXkgPT09IFwiQXJyb3dEb3duXCIgfHwgZXZlbnQua2V5ID09PSBcImpcIiB8fCAoZXZlbnQua2V5ID09PSBcIlRhYlwiICYmICFldmVudC5zaGlmdEtleSk7XG4gICAgICBsZXQgc3RlcCA9IDA7XG4gICAgICBpZiAodXAgJiYgaW5kZXggPT09IDApIHN0ZXAgPSAtMTtcbiAgICAgIGVsc2UgaWYgKGRvd24gJiYgaW5kZXggPT09IGVkaXRvci5yZW5kZXJlZC5sZW5ndGggLSAxKSBzdGVwID0gMTtcbiAgICAgIGlmIChzdGVwID09PSAwIHx8ICFvblNoaWZ0Rm9jdXMoc3RlcCkpIHJldHVybjtcblxuICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgIH0sXG4gICAgdHJ1ZVxuICApO1xufVxuXG4vLyBUaGUgd2lkZ2V0IHRha2VzIGFuIFwib3duZXJcIiBhcyBzZWNvbmQgY29uc3RydWN0b3IgYXJndW1lbnQgLSB0aGUgb25seSB0aGluZ1xuLy8gYmluZGluZyBpdCB0byBhIGZpbGUuIEhlcmUgaXQgaXMgYm91bmQgdG8gYSBwbGFpbiBvYmplY3QgaW4gdGhlIHNldHRpbmdzOlxuLy8gc2F2ZUZyb250bWF0dGVyKG9iaikgZ2V0cyB0aGUgZnVsbCBwcm9wZXJ0eSBzZXQgb24gZXZlcnkgY2hhbmdlLlxuLy8gc2hpZnRGb2N1c0JlZm9yZS9BZnRlciBtYXkgYmUgbm8tb3BzLiBnZXRGaWxlKCkgaXMgY2FsbGVkIGJ5IGV2ZXJ5IHJvdyB3aGlsZVxuLy8gcmVuZGVyaW5nIChmb3Igc291cmNlUGF0aCk7IHRoZXJlIGlzIG5vIHJlYWwgZmlsZSwgYnV0IHRoZSBtZXRob2QgbXVzdCBleGlzdFxuLy8gb3IgdGhlIHdpZGdldCBjcmFzaGVzLlxuLy9cbi8vIE9uZSBlZGl0b3IgcGVyIGJsb2NrIChUWVAgb3IgU3VidHlwKSwgYm91bmQgdG8gYHN0b3JlYC4gU3RhbmRhcmQgYW5kXG4vLyBmbG9hdGluZyBwcm9wZXJ0aWVzIHNoYXJlIG9uZSBsaXN0IGFuZCBvcmRlcjsgZ2V0VHlwRGVmYXVsdHMoKSBqdXN0IGxlYXZlc1xuLy8gdGhlIGZsb2F0aW5nIG9uZXMgb3V0LiBlZGl0b3IudHlwUGVuZGluZ0Zsb2F0aW5nQWRkLCBzZXQgYmVmb3JlXG4vLyBhZGRCbGFua1Byb3BlcnR5KCksIG1hcmtzIHRoZSBuZXh0IGFkZGVkIChvciByZW5hbWVkKSBwcm9wZXJ0eSBhcyBmbG9hdGluZyAtXG4vLyBzZWUgc2F2ZUZyb250bWF0dGVyLlxuZnVuY3Rpb24gbW91bnRGcm9udG1hdHRlckVkaXRvcih2aWV3LCBjb250YWluZXJFbCwgc3RvcmUsIHsgb25TaGlmdEZvY3VzIH0gPSB7fSkge1xuICBjb25zdCBhcHAgPSB2aWV3LmFwcDtcbiAgY29uc3QgRWRpdG9yQ2xhc3MgPSBnZXRNZXRhZGF0YUVkaXRvckNsYXNzKGFwcCk7XG4gIGlmICghRWRpdG9yQ2xhc3MpIHtcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgY2xzOiBcInR5cC1mcm9udG1hdHRlci11bmF2YWlsYWJsZVwiLFxuICAgICAgdGV4dDogXCJPcGVuIGEgbm90ZSBvbmNlIHRvIGluaXRpYWxpemUgdGhlIGVkaXRvci5cIixcbiAgICB9KTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGNvbnN0IG93bmVyID0ge1xuICAgIGFwcCxcbiAgICAvLyBMZXRzIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoKCkgcmVjb2duaXplIHJvd3Mgb2YgdGhpcyBlZGl0b3IgYW5kIGdpdmVzXG4gICAgLy8gdGhlIGdsb2JhbCBtZW51IHBhdGNoIHRoZSBzdG9yZSBhbmQgdmlldyBwZXIgcm93ICh0aGUgcGF0Y2ggaXRzZWxmIGlzXG4gICAgLy8gaW5zdGFsbGVkIG9ubHkgb25jZSkuXG4gICAgdHlwU3RvcmU6IHN0b3JlLFxuICAgIHR5cFBhbmU6IHZpZXcsXG4gICAgZ2V0RmlsZSgpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH0sXG4gICAgLy8gT25seSBmb3IgT2JzaWRpYW4ncyBob3ZlciBwcmV2aWV3IG9mIGludGVybmFsIGxpbmtzIGluIGEgdmFsdWU7IGFueVxuICAgIC8vIHN0cmluZyB3aWxsIGRvLlxuICAgIGdldEhvdmVyU291cmNlKCkge1xuICAgICAgcmV0dXJuIFwidHlwLWZyb250bWF0dGVyXCI7XG4gICAgfSxcbiAgICBzaGlmdEZvY3VzQmVmb3JlKCkge30sXG4gICAgc2hpZnRGb2N1c0FmdGVyKCkge30sXG4gICAgLy8gQ2FsbGVkIG9uY2UgcGVyIGNvbXBsZXRlZCBjaGFuZ2UgKGEgcmVuYW1lIG9ubHkgb24gYmx1ciBvZiB0aGUga2V5XG4gICAgLy8gaW5wdXQpLCBzbyBlYWNoIGNhbGwgYWRkcyBhbmQvb3IgcmVtb3ZlcyBhdCBtb3N0IG9uZSBub24tZW1wdHkgcHJvcGVydHksXG4gICAgLy8gZXhjZXB0IGEgbXVsdGktZGVsZXRlLiBUaGF0IGtlZXBzIHRoZSBmbG9hdGluZyBmbGFnIGVhc3kgdG8gdHJhY2tcbiAgICAvLyB3aXRob3V0IGZvbGxvd2luZyBpbnRlcm1lZGlhdGUgdHlwaW5nIHN0YXRlcy5cbiAgICBzYXZlRnJvbnRtYXR0ZXIoZnJvbnRtYXR0ZXIpIHtcbiAgICAgIC8vIEEgcm93IGp1c3QgbmFtZWQgXCJUWVBcIi9cIlNVQlRZUFwiIGlzbid0IHNhdmVkLiBJdCBzdGF5cyB2aXNpYmxlIHVudGlsXG4gICAgICAvLyB0aGUgbmV4dCBtb3VudCAobm8gc3luY2hyb25pemUoKSBoZXJlLCBzZWUgc3RyaXBUeXBQcm9wZXJ0eSkuXG4gICAgICBzdHJpcFR5cFByb3BlcnR5KGZyb250bWF0dGVyKTtcblxuICAgICAgY29uc3QgcHJldmlvdXMgPSBzdG9yZS5nZXRGcm9udG1hdHRlcigpO1xuICAgICAgY29uc3QgcHJldmlvdXNLZXlzID0gT2JqZWN0LmtleXMocHJldmlvdXMpLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwiXCIpO1xuICAgICAgY29uc3QgY3VycmVudEtleXMgPSBPYmplY3Qua2V5cyhmcm9udG1hdHRlcikuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gXCJcIik7XG4gICAgICBjb25zdCByZW1vdmVkS2V5cyA9IHByZXZpb3VzS2V5cy5maWx0ZXIoKGtleSkgPT4gIWN1cnJlbnRLZXlzLmluY2x1ZGVzKGtleSkpO1xuICAgICAgY29uc3QgYWRkZWRLZXlzID0gY3VycmVudEtleXMuZmlsdGVyKChrZXkpID0+ICFwcmV2aW91c0tleXMuaW5jbHVkZXMoa2V5KSk7XG4gICAgICAvLyBEZWxldGluZyByb3dzIGxvc2VzIHZhbHVlLCBzaG9ydGN1dCBhbmQgZmxvYXRpbmcgZmxhZyBhdCBvbmNlIC0gdGhlXG4gICAgICAvLyBvbmUgY2hhbmdlIGhlcmUgdGhhdCBnZXRzIGFuIHVuZG8gKHNlZSB1bmRvLmpzKS4gU25hcHNob3QgYmVmb3JlIGFueVxuICAgICAgLy8gc3RvcmUgd3JpdGUsIGFuZCBvbmx5IGZvciBhIGRlbGV0aW9uIC0gbm8gZnVsbCBjb3B5IG9uIGV2ZXJ5IGVkaXQuXG4gICAgICBjb25zdCByZW1vdmVkT25seSA9IHJlbW92ZWRLZXlzLmxlbmd0aCA+IDAgJiYgYWRkZWRLZXlzLmxlbmd0aCA9PT0gMDtcbiAgICAgIGNvbnN0IHVuZG9TbmFwc2hvdCA9IHJlbW92ZWRPbmx5ID8gc25hcHNob3RTZXR0aW5ncyh2aWV3LnBsdWdpbikgOiBudWxsO1xuXG4gICAgICBsZXQgZmxvYXRpbmcgPSBzdG9yZS5nZXRGbG9hdGluZygpO1xuICAgICAgaWYgKHJlbW92ZWRLZXlzLmxlbmd0aCA9PT0gMSAmJiBhZGRlZEtleXMubGVuZ3RoID09PSAxKSB7XG4gICAgICAgIC8vIEEgcmVuYW1lOiB0aGUgZmxvYXRpbmcgZmxhZyBtb3ZlcyBhbG9uZy5cbiAgICAgICAgZmxvYXRpbmcgPSBmbG9hdGluZy5tYXAoKGtleSkgPT4gKGtleSA9PT0gcmVtb3ZlZEtleXNbMF0gPyBhZGRlZEtleXNbMF0gOiBrZXkpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChyZW1vdmVkS2V5cy5sZW5ndGggPiAwKSBmbG9hdGluZyA9IGZsb2F0aW5nLmZpbHRlcigoa2V5KSA9PiAhcmVtb3ZlZEtleXMuaW5jbHVkZXMoa2V5KSk7XG4gICAgICAgIGlmIChlZGl0b3IudHlwUGVuZGluZ0Zsb2F0aW5nQWRkICYmIGFkZGVkS2V5cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgICBmbG9hdGluZyA9IFsuLi5mbG9hdGluZywgYWRkZWRLZXlzWzBdXTtcbiAgICAgICAgICBlZGl0b3IudHlwUGVuZGluZ0Zsb2F0aW5nQWRkID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIFNob3J0Y3V0cyBiZWxvbmcgdG8gdGhlIGtleSB0b286IHRoZXkgbW92ZSBvbiByZW5hbWUgYW5kIGdvIG9uIGRlbGV0ZS5cbiAgICAgIGNvbnN0IHNob3J0Y3V0cyA9IHsgLi4uc3RvcmUuZ2V0U2hvcnRjdXRzKCkgfTtcbiAgICAgIGlmIChyZW1vdmVkS2V5cy5sZW5ndGggPT09IDEgJiYgYWRkZWRLZXlzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICBpZiAoc2hvcnRjdXRzW3JlbW92ZWRLZXlzWzBdXSkge1xuICAgICAgICAgIHNob3J0Y3V0c1thZGRlZEtleXNbMF1dID0gc2hvcnRjdXRzW3JlbW92ZWRLZXlzWzBdXTtcbiAgICAgICAgICBkZWxldGUgc2hvcnRjdXRzW3JlbW92ZWRLZXlzWzBdXTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZm9yIChjb25zdCBrZXkgb2YgcmVtb3ZlZEtleXMpIGRlbGV0ZSBzaG9ydGN1dHNba2V5XTtcbiAgICAgIH1cblxuICAgICAgc3RvcmUuc2V0RnJvbnRtYXR0ZXIoZnJvbnRtYXR0ZXIpO1xuICAgICAgc3RvcmUuc2V0RmxvYXRpbmcoZmxvYXRpbmcpO1xuICAgICAgc3RvcmUuc2V0U2hvcnRjdXRzKHNob3J0Y3V0cyk7XG4gICAgICB2aWV3LnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgIGlmICh1bmRvU25hcHNob3QpIHtcbiAgICAgICAgY29uc3QgYmxvY2tOYW1lID0gc3RvcmUuc3VidHlwID8/IHN0b3JlLnR5cDtcbiAgICAgICAgb2ZmZXJVbmRvKFxuICAgICAgICAgIHZpZXcucGx1Z2luLFxuICAgICAgICAgIHJlbW92ZWRLZXlzLmxlbmd0aCA9PT0gMVxuICAgICAgICAgICAgPyBgUHJvcGVydHkgXCIke3JlbW92ZWRLZXlzWzBdfVwiIHJlbW92ZWQgZnJvbSAke2Jsb2NrTmFtZX0uYFxuICAgICAgICAgICAgOiBgJHtyZW1vdmVkS2V5cy5sZW5ndGh9IHByb3BlcnRpZXMgcmVtb3ZlZCBmcm9tICR7YmxvY2tOYW1lfS5gLFxuICAgICAgICAgIHVuZG9TbmFwc2hvdFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgLy8gQSBuZXdseSBuYW1lZCByb3cgZ2V0cyBpdHMgYnV0dG9uLCBhIGRlbGV0ZWQgb25lIHRha2VzIGl0IGFsb25nLlxuICAgICAgcmVuZGVyU2hvcnRjdXRDb250cm9scyh2aWV3LCBlZGl0b3IsIHN0b3JlKTtcbiAgICAgIC8vIEJvbGQvaXRhbGljIG1hcmtzIGluIG9wZW4gbm90ZXMgZm9sbG93IHRoZSBjaGFuZ2VkIGxpc3QgYXQgb25jZS4gTm90XG4gICAgICAvLyB0aGUgZnVsbCByZWZyZXNoVHlwQ29sb3JzKCk6IGl0IHdvdWxkIHJlLXJlbmRlciB0aGlzIFRZUC1QYW5lLCBhbmRcbiAgICAgIC8vIHRoZSBlZGl0IHRoYXQgY2FsbGVkIHNhdmVGcm9udG1hdHRlciB3b3VsZCBsb3NlIGl0cyBmb2N1cyAoVGFiIHRvIHRoZVxuICAgICAgLy8gbmV4dCByb3cgd2VudCBub3doZXJlKSAtIHRoZSBlZGl0b3IgYWxyZWFkeSBzaG93cyB0aGUgY2hhbmdlLlxuICAgICAgdmlldy5wbHVnaW4ucmVmcmVzaFR5cENvbG9yc0V4Y2VwdD8uKHZpZXcpO1xuICAgIH0sXG4gIH07XG5cbiAgY29uc3QgZWRpdG9yID0gbmV3IEVkaXRvckNsYXNzKGFwcCwgb3duZXIpO1xuICBlZGl0b3IudHlwUGVuZGluZ0Zsb2F0aW5nQWRkID0gZmFsc2U7XG4gIGlmIChvblNoaWZ0Rm9jdXMpIHJlZ2lzdGVyRm9jdXNDaGFpbihlZGl0b3IsIG9uU2hpZnRGb2N1cyk7XG4gIGVkaXRvci5jb250YWluZXJFbC5hZGRDbGFzcyhFRElUT1JfQ0xBU1MpO1xuICBjb250YWluZXJFbC5hcHBlbmRDaGlsZChlZGl0b3IuY29udGFpbmVyRWwpO1xuICB2aWV3LmFkZENoaWxkKGVkaXRvcik7XG5cbiAgZWRpdG9yLnN5bmNocm9uaXplKHN0b3JlLmdldEZyb250bWF0dGVyKCkpO1xuICByZW5kZXJTaG9ydGN1dENvbnRyb2xzKHZpZXcsIGVkaXRvciwgc3RvcmUpO1xuICAvLyBPbmx5IGFmdGVyIHRoZSBmaXJzdCBzeW5jaHJvbml6ZSgpIChzZWUgZ2V0UHJvcGVydHlSb3dDbGFzcykuIEEgbm8tb3AgZm9yXG4gIC8vIGEgc3RpbGwgZW1wdHkgVFlQOyB0aGUgbmV4dCBub24tZW1wdHkgb25lIChvciBhbiBvcGVuIG5vdGUpIHN1cHBsaWVzIHRoZVxuICAvLyBjbGFzcy5cbiAgZW5zdXJlUHJvcGVydHlNZW51UGF0Y2goYXBwLCBlZGl0b3IpO1xuICByZXR1cm4gZWRpdG9yO1xufVxuXG5jb25zdCBDSElQX0NMQVNTID0gXCJ0eXAtc2hvcnRjdXQtY2hpcFwiO1xuY29uc3QgQ0hJUF9URVhUX0NMQVNTID0gXCJ0eXAtc2hvcnRjdXQtY2hpcC10ZXh0XCI7XG5jb25zdCBCVVRUT05fQ0xBU1MgPSBcInR5cC1zaG9ydGN1dC1idXR0b25cIjtcbmNvbnN0IFJPV19DTEFTUyA9IFwidHlwLWhhcy1zaG9ydGN1dFwiO1xuY29uc3QgV0FSTklOR19DTEFTUyA9IFwidHlwLXNob3J0Y3V0LWJsb2NrZWRcIjtcbmNvbnN0IE1JU1NJTkdfQ0xBU1MgPSBcInR5cC1zaG9ydGN1dC1taXNzaW5nXCI7XG5cbi8vIFRoZSBidXR0b24ncyB0aHJlZSBsb29rcy4gXCJtaXNzaW5nXCI6IGEgXCJ0cC5cIiBzaG9ydGN1dCB3aG9zZSBUZW1wbGF0ZXJcbi8vIHNjcmlwdCBpcyBnb25lIChkZWxldGVkLCByZW5hbWVkLCBtYXJrZXIgcmVtb3ZlZCkgLSBUWVAuanMgd291bGQgd3JpdGUgdGhlXG4vLyBmYWxsYmFjayB2YWx1ZS4gU2FtZSB0cmlhbmdsZSBhcyBPYnNpZGlhbidzIHR5cGUgd2FybmluZywgYW5kIGEgY2xpY2tcbi8vIHJlbW92ZXMgdGhlIHNob3J0Y3V0IGxpa2UgdGhlIFwieFwiICh0aGUgY2hpcCBzdGlsbCBjaGFuZ2VzIGl0KS5cbmNvbnN0IEJVVFRPTl9TVEFURVMgPSB7XG4gIG5vbmU6IHsgaWNvbjogXCJzcXVhcmUtZnVuY3Rpb25cIiwgbGFiZWw6IFwiU2V0IHNob3J0Y3V0XCIgfSxcbiAgc2V0OiB7IGljb246IFwieFwiLCBsYWJlbDogXCJSZW1vdmUgc2hvcnRjdXRcIiB9LFxuICBtaXNzaW5nOiB7IGljb246IFwiYWxlcnQtdHJpYW5nbGVcIiwgbGFiZWw6IFwiU2NyaXB0IG5vdCBmb3VuZCBcdTIwMTMgdGhlIGZhbGxiYWNrIHZhbHVlIHdpbGwgYmUgdXNlZC4gQ2xpY2sgdG8gcmVtb3ZlIHRoZSBzaG9ydGN1dC5cIiB9LFxufTtcblxuLy8gQnV0dG9uIGFuZCBjaGlwIHBlciBwcm9wZXJ0eSByb3cuIEJvdGggaGFuZyBvbiB0aGUgcm93J3MgY29udGFpbmVyRWwsIE5PVCBpdHNcbi8vIHZhbHVlRWw6IHJlbmRlclByb3BlcnR5KCkgb25seSBldmVyIGVtcHRpZXMgdmFsdWVFbCwgc28gYW55dGhpbmcgYXR0YWNoZWQgdG9cbi8vIGNvbnRhaW5lckVsIHN1cnZpdmVzIGV2ZXJ5IHR5cGUgb3IgdmFsdWUgY2hhbmdlIHdpdGhvdXQgdG91Y2hpbmdcbi8vIE9ic2lkaWFuJ3MgcmVuZGVyIHBpcGVsaW5lLlxuLy9cbi8vIFRoZSBidXR0b24gdG9nZ2xlczogd2l0aG91dCBhIHNob3J0Y3V0IGl0IG9wZW5zIHRoZSBwaWNrZXIgKFwic3F1YXJlLWZ1bmN0aW9uXCIpLFxuLy8gd2l0aCBvbmUgaXQgcmVtb3ZlcyBpdCAoXCJ4XCIsIG9yIHRoZSB3YXJuaW5nIHRyaWFuZ2xlIGlmIHRoZSBzY3JpcHQgaXNcbi8vIG1pc3NpbmcgLSBzZWUgQlVUVE9OX1NUQVRFUykuIFRoZSBjaGlwIGl0c2VsZiBpcyBmb3IgQ0hBTkdJTkcgaXQuIENTUyBzaG93c1xuLy8gdGhlIGJ1dHRvbiBvbmx5IG9uIHJvdyBob3Zlci9mb2N1cyAoYW5kIHBlcm1hbmVudGx5IHdoaWxlIGEgc2hvcnRjdXQgaXNcbi8vIHNldCkgLSBvdGhlcndpc2UgZXZlcnkgcm93IHdvdWxkIGNhcnJ5IGEgY29udHJvbCBtb3N0IG5ldmVyIG5lZWQuXG4vL1xuLy8gQ2FsbGVkIGFnYWluIHdoZW5ldmVyIHRoZSBzY3JpcHQgbGlzdCBjaGFuZ2VzIChzZWUgcmVmcmVzaFNob3J0Y3V0Q29udHJvbHNcbi8vIGluIHR5cC1wYW5lLmpzKSwgc28gdGhlIHdhcm5pbmcgZm9sbG93cyBhIHNjcmlwdCBiZWluZyByZW5hbWVkIG9yIHJlc3RvcmVkLlxuLy9cbi8vIEhpZGluZyB0aGUgdmFsdWUgZmllbGQgd2hpbGUgYSBzaG9ydGN1dCBpcyBzZXQgaXMgcHVyZSBDU1MgKFJPV19DTEFTUyBpblxuLy8gc3R5bGVzLmNzcyk7IHRoZSBuYXRpdmUgd2lkZ2V0IGtlZXBzIHJlbmRlcmluZyB1bmRlcm5lYXRoLiBTZXR0aW5nIGFuZFxuLy8gcmVtb3ZpbmcgaXMganVzdCBhIGNsYXNzIHRvZ2dsZSwgbm8gcmVuZGVyUHJvcGVydHkoKS9zeW5jaHJvbml6ZSgpIC0gd2hpY2hcbi8vIHdvdWxkIGJlIHJpc2t5IGhlcmUgYW55d2F5IChzZWUgc3RyaXBUeXBQcm9wZXJ0eSkuXG5mdW5jdGlvbiByZW5kZXJTaG9ydGN1dENvbnRyb2xzKHZpZXcsIGVkaXRvciwgc3RvcmUpIHtcbiAgY29uc3Qgc2hvcnRjdXRzID0gc3RvcmUuZ2V0U2hvcnRjdXRzKCk7XG4gIC8vIEJlZm9yZSB0aGUgc2NyaXB0IGZvbGRlciB3YXMgcmVhZCBvbmNlLCBub3RoaW5nIGNvdW50cyBhcyBtaXNzaW5nIC1cbiAgLy8gb3RoZXJ3aXNlIGV2ZXJ5IFwidHAuXCIgc2hvcnRjdXQgd291bGQgZmxhc2ggdGhlIHdhcm5pbmcgb24gc3RhcnR1cC5cbiAgY29uc3QgZ2V0U2NyaXB0cyA9IHZpZXcucGx1Z2luLmdldFNob3J0Y3V0U2NyaXB0cztcbiAgY29uc3Qgc2NyaXB0TmFtZXMgPSBnZXRTY3JpcHRzPy5pc0xvYWRlZD8uKCkgPyBuZXcgU2V0KGdldFNjcmlwdHMoKS5tYXAoKHNjcmlwdCkgPT4gc2NyaXB0Lm5hbWUpKSA6IG51bGw7XG4gIGZvciAoY29uc3Qgcm93IG9mIGVkaXRvci5yZW5kZXJlZCA/PyBbXSkge1xuICAgIGNvbnN0IGNvbnRhaW5lckVsID0gcm93LmNvbnRhaW5lckVsO1xuICAgIGNvbnN0IGtleSA9IHJvdy5lbnRyeT8ua2V5ID8/IFwiXCI7XG4gICAgLy8gQW4gdW5uYW1lZCByb3cgY2FuJ3QgY2FycnkgYSBzaG9ydGN1dCAtIHRoZXJlIGlzIG5vIGtleSB0byBzdG9yZSBpdFxuICAgIC8vIHVuZGVyLiBUaGUgYnV0dG9uIGFwcGVhcnMgb25jZSBpdCBoYXMgYSBuYW1lIChldmVyeSBjaGFuZ2UgcGFzc2VzXG4gICAgLy8gdGhyb3VnaCBzYXZlRnJvbnRtYXR0ZXIgYW5kIHNvIHRocm91Z2ggaGVyZSkuXG4gICAgY29uc3QgcmVjb3JkID0ga2V5ID09PSBcIlwiID8gbnVsbCA6IHNob3J0Y3V0c1trZXldID8/IG51bGw7XG4gICAgY29udGFpbmVyRWwudG9nZ2xlQ2xhc3MoUk9XX0NMQVNTLCAhIXJlY29yZCk7XG5cbiAgICAvLyBPYnNpZGlhbidzIHdhcm5pbmcgdHJpYW5nbGUgc2l0cyBhYnNvbHV0ZWx5IGF0IHRoZSByb3cncyByaWdodCBlZGdlIC1cbiAgICAvLyBleGFjdGx5IHdoZXJlIHRoZSBzaG9ydGN1dCBidXR0b24gZ29lcy4gSWYgdGhlIHJvdyBzaG93cyBhIHR5cGUgd2FybmluZ1xuICAgIC8vIGFuZCBoYXMgTk8gc2hvcnRjdXQsIHRoZSBidXR0b24gZ2l2ZXMgd2F5LiBXaXRoIGEgc2hvcnRjdXQgc2V0LCB0aGVcbiAgICAvLyBidXR0b24gc3RheXMgKGl0IGlzIHRoZSBvbmx5IHdheSB0byByZW1vdmUgdGhlIHNob3J0Y3V0KSBhbmQgdGhlXG4gICAgLy8gdHJpYW5nbGUgZ2l2ZXMgd2F5IGluc3RlYWQgKHN0eWxlcy5jc3MpOiBpdCB3b3VsZCB0aGVuIHJlZmVyIHRvIHRoZVxuICAgIC8vIGhpZGRlbiBmYWxsYmFjayB2YWx1ZSwgd2hpY2ggY2FuJ3QgYmUgZml4ZWQgdGhlcmUgYW55d2F5LlxuICAgIGNvbnN0IG1pc21hdGNoID0gISFyb3cudHlwZUluZm8gJiYgcm93LnR5cGVJbmZvLmV4cGVjdGVkICE9PSByb3cudHlwZUluZm8uaW5mZXJyZWQ7XG4gICAgY29udGFpbmVyRWwudG9nZ2xlQ2xhc3MoV0FSTklOR19DTEFTUywgbWlzbWF0Y2ggJiYgIXJlY29yZCk7XG5cbiAgICBsZXQgYnV0dG9uRWwgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKGA6c2NvcGUgPiAuJHtCVVRUT05fQ0xBU1N9YCk7XG4gICAgaWYgKGtleSA9PT0gXCJcIikge1xuICAgICAgYnV0dG9uRWw/LnJlbW92ZSgpO1xuICAgICAgY29udGFpbmVyRWwucXVlcnlTZWxlY3RvcihgOnNjb3BlID4gLiR7Q0hJUF9DTEFTU31gKT8ucmVtb3ZlKCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKCFidXR0b25FbCkge1xuICAgICAgLy8gSWNvbiBhbmQgbGFiZWwgZm9sbG93IGJlbG93LCBwZXIgc3RhdGUuXG4gICAgICBidXR0b25FbCA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogYGNsaWNrYWJsZS1pY29uICR7QlVUVE9OX0NMQVNTfWAgfSk7XG4gICAgICAvLyBSZWFkIHRoZSBrZXkgb24gY2xpY2ssIG5vdCBoZXJlOiBhIHJlbmFtZSBjaGFuZ2VzIHJvdy5lbnRyeS5rZXlcbiAgICAgIC8vIHdpdGhvdXQgcmVjcmVhdGluZyB0aGUgcm93LlxuICAgICAgYnV0dG9uRWwuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgICAgaWYgKHN0b3JlLmdldFNob3J0Y3V0cygpW3Jvdy5lbnRyeT8ua2V5ID8/IFwiXCJdKSByZW1vdmVTaG9ydGN1dCh2aWV3LCBlZGl0b3IsIHN0b3JlLCByb3cpO1xuICAgICAgICBlbHNlIG9wZW5TaG9ydGN1dFBpY2tlcih2aWV3LCBlZGl0b3IsIHN0b3JlLCByb3cpO1xuICAgICAgfSk7XG4gICAgfVxuICAgIGNvbnN0IHNjcmlwdE5hbWUgPSByZWNvcmQgPyBzY3JpcHROYW1lT2YocmVjb3JkLm5hbWUpIDogbnVsbDtcbiAgICBjb25zdCBtaXNzaW5nID0gc2NyaXB0TmFtZSAhPT0gbnVsbCAmJiBzY3JpcHROYW1lcyAhPT0gbnVsbCAmJiAhc2NyaXB0TmFtZXMuaGFzKHNjcmlwdE5hbWUpO1xuICAgIGNvbnN0IHN0YXRlID0gIXJlY29yZCA/IFwibm9uZVwiIDogbWlzc2luZyA/IFwibWlzc2luZ1wiIDogXCJzZXRcIjtcbiAgICAvLyBPbmx5IG9uIGEgY2hhbmdlOiBzZXRJY29uIHdvdWxkIHJlcGxhY2UgdGhlIFNWRyBvbiBldmVyeSBjYWxsLlxuICAgIGlmIChidXR0b25FbC5kYXRhc2V0LnR5cFN0YXRlICE9PSBzdGF0ZSkge1xuICAgICAgYnV0dG9uRWwuZGF0YXNldC50eXBTdGF0ZSA9IHN0YXRlO1xuICAgICAgc2V0SWNvbihidXR0b25FbCwgQlVUVE9OX1NUQVRFU1tzdGF0ZV0uaWNvbik7XG4gICAgICBidXR0b25FbC5zZXRBdHRyKFwiYXJpYS1sYWJlbFwiLCBCVVRUT05fU1RBVEVTW3N0YXRlXS5sYWJlbCk7XG4gICAgICBidXR0b25FbC50b2dnbGVDbGFzcyhNSVNTSU5HX0NMQVNTLCBzdGF0ZSA9PT0gXCJtaXNzaW5nXCIpO1xuICAgIH1cblxuICAgIGxldCBjaGlwRWwgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKGA6c2NvcGUgPiAuJHtDSElQX0NMQVNTfWApO1xuICAgIGlmICghcmVjb3JkKSB7XG4gICAgICBjaGlwRWw/LnJlbW92ZSgpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICghY2hpcEVsKSB7XG4gICAgICBjaGlwRWwgPSBjcmVhdGVFbChcImNvZGVcIiwgeyBjbHM6IENISVBfQ0xBU1MgfSk7XG4gICAgICAvLyBUZXh0IGluIGl0cyBvd24gc3BhbjogdGhlIGNoaXAgaXMgYSBmbGV4IGNvbnRhaW5lciAodmVydGljYWxcbiAgICAgIC8vIGNlbnRlcmluZyBsaWtlIHRoZSByZWFsIHZhbHVlIGZpZWxkKSwgYW5kIHRleHQtb3ZlcmZsb3c6IGVsbGlwc2lzXG4gICAgICAvLyBvbmx5IHdvcmtzIG9uIGEgYmxvY2sgZWxlbWVudC5cbiAgICAgIGNoaXBFbC5jcmVhdGVTcGFuKHsgY2xzOiBDSElQX1RFWFRfQ0xBU1MgfSk7XG4gICAgICBjaGlwRWwuc2V0QXR0cihcImFyaWEtbGFiZWxcIiwgXCJDaGFuZ2Ugc2hvcnRjdXRcIik7XG4gICAgICBjaGlwRWwuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IG9wZW5TaG9ydGN1dFBpY2tlcih2aWV3LCBlZGl0b3IsIHN0b3JlLCByb3cpKTtcbiAgICAgIC8vIEJlZm9yZSB0aGUgYnV0dG9uLCBzbyB0aGUgcm93IGFsd2F5cyByZWFkcyBcIm5hbWUgfCBjaGlwIHwgYnV0dG9uXCIuXG4gICAgICBjb250YWluZXJFbC5pbnNlcnRCZWZvcmUoY2hpcEVsLCBidXR0b25FbCk7XG4gICAgfVxuICAgIGNoaXBFbC5maXJzdEVsZW1lbnRDaGlsZC5zZXRUZXh0KHNob3J0Y3V0TGFiZWwocmVjb3JkKSk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gb3BlblNob3J0Y3V0UGlja2VyKHZpZXcsIGVkaXRvciwgc3RvcmUsIHJvdykge1xuICBjb25zdCBrZXkgPSByb3cuZW50cnk/LmtleSA/PyBcIlwiO1xuICBpZiAoa2V5ID09PSBcIlwiKSByZXR1cm47XG4gIC8vIFBhc3NpbmcgdGhlIGN1cnJlbnQgcmVjb3JkIHByZWZpbGxzIHRoZSBhcmd1bWVudCBkaWFsb2cgd2hlbiB0aGUgc2FtZVxuICAvLyBzY3JpcHQgaXMgcGlja2VkIGFnYWluIC0gdGhhdCBpcyBob3cgc2luZ2xlIGFyZ3VtZW50cyBnZXQgY29ycmVjdGVkLlxuICBjb25zdCByZWNvcmQgPSBhd2FpdCBwaWNrU2hvcnRjdXQodmlldy5hcHAsIGtleSwgdmlldy5wbHVnaW4uZ2V0U2hvcnRjdXRTY3JpcHRzLCBzdG9yZS5nZXRTaG9ydGN1dHMoKVtrZXldID8/IG51bGwpO1xuICBpZiAoIXJlY29yZCkgcmV0dXJuO1xuICAvLyBUaGUgcHJvcGVydHkgbWF5IGhhdmUgdmFuaXNoZWQgd2hpbGUgdGhlIGRpYWxvZyB3YXMgb3BlbiAodmlldyByZWJ1aWx0KS5cbiAgLy8gV2l0aG91dCB0aGlzIGNoZWNrIHRoZSBzaG9ydGN1dCB3b3VsZCBiZSBhbiBpbnZpc2libGUgb3JwaGFuIGluIHRoZVxuICAvLyBzZXR0aW5ncyB0aGF0IG5vdGhpbmcgZXZlciBjbGVhbnMgdXAuXG4gIGlmICghT2JqZWN0Lmhhc093bihzdG9yZS5nZXRGcm9udG1hdHRlcigpLCBrZXkpKSByZXR1cm47XG4gIHN0b3JlLnNldFNob3J0Y3V0cyh7IC4uLnN0b3JlLmdldFNob3J0Y3V0cygpLCBba2V5XTogcmVjb3JkIH0pO1xuICBzYXZlU2hvcnRjdXRzKHZpZXcsIGVkaXRvciwgc3RvcmUpO1xufVxuXG5mdW5jdGlvbiByZW1vdmVTaG9ydGN1dCh2aWV3LCBlZGl0b3IsIHN0b3JlLCByb3cpIHtcbiAgY29uc3Qga2V5ID0gcm93LmVudHJ5Py5rZXkgPz8gXCJcIjtcbiAgY29uc3Qgc2hvcnRjdXRzID0geyAuLi5zdG9yZS5nZXRTaG9ydGN1dHMoKSB9O1xuICBpZiAoIShrZXkgaW4gc2hvcnRjdXRzKSkgcmV0dXJuO1xuICBjb25zdCBzbmFwc2hvdCA9IHNuYXBzaG90U2V0dGluZ3Modmlldy5wbHVnaW4pO1xuICBkZWxldGUgc2hvcnRjdXRzW2tleV07XG4gIHN0b3JlLnNldFNob3J0Y3V0cyhzaG9ydGN1dHMpO1xuICBzYXZlU2hvcnRjdXRzKHZpZXcsIGVkaXRvciwgc3RvcmUpO1xuICBvZmZlclVuZG8odmlldy5wbHVnaW4sIGBTaG9ydGN1dCByZW1vdmVkIGZyb20gXCIke2tleX1cIi5gLCBzbmFwc2hvdCk7XG59XG5cbmZ1bmN0aW9uIHNhdmVTaG9ydGN1dHModmlldywgZWRpdG9yLCBzdG9yZSkge1xuICB2aWV3LnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgcmVuZGVyU2hvcnRjdXRDb250cm9scyh2aWV3LCBlZGl0b3IsIHN0b3JlKTtcbn1cblxuLy8gQSBzaW1wbGUgXCJhZGQgcHJvcGVydHlcIiBpbnN0ZWFkIG9mIHRoZSBpbnRlcm5hbCBlZGl0b3IuYWRkUHJvcGVydHkoKTogYWRkc1xuLy8gYW4gZW1wdHkga2V5IHdpdGggdmFsdWUgbnVsbCBhbmQgbGV0cyB0aGUgd2lkZ2V0IHJlbmRlciBpdCBub3JtYWxseSAoc2FtZVxuLy8gbG9vayBhcyBpbiBhIG5vdGUsIHNpbmNlIHN5bmNocm9uaXplKCkgcnVucyBPYnNpZGlhbidzIG93biBwaXBlbGluZSksIHRoZW5cbi8vIGZvY3VzZXMgdGhlIG5ldyBrZXkgZmllbGQuXG5mdW5jdGlvbiBhZGRCbGFua1Byb3BlcnR5KGVkaXRvcikge1xuICBpZiAoIWVkaXRvcikgcmV0dXJuO1xuICBjb25zdCBjdXJyZW50ID0gZWRpdG9yLnNlcmlhbGl6ZSgpO1xuICBpZiAoIWN1cnJlbnQuaGFzT3duUHJvcGVydHkoXCJcIikpIHtcbiAgICBjdXJyZW50W1wiXCJdID0gbnVsbDtcbiAgICBlZGl0b3Iuc3luY2hyb25pemUoY3VycmVudCk7XG4gICAgLy8gRXhpc3Rpbmcgcm93cyBrZWVwIHRoZWlyIGJ1dHRvbiAoaXQgc2l0cyBvbiBjb250YWluZXJFbCksIHRoZSBuZXcgb25lXG4gICAgLy8gbmVlZHMgb25lLlxuICAgIHJlbmRlclNob3J0Y3V0Q29udHJvbHMoZWRpdG9yLm93bmVyLnR5cFBhbmUsIGVkaXRvciwgZWRpdG9yLm93bmVyLnR5cFN0b3JlKTtcbiAgfVxuICBlZGl0b3IuZm9jdXNLZXkoXCJcIik7XG4gIC8vIENvdmVycyB0aGUgY2FzZSB3aGVyZSBtb3VudEZyb250bWF0dGVyRWRpdG9yKCkgZm91bmQgbm8gcm93IGNsYXNzIHRvIHBhdGNoXG4gIC8vIChlbXB0eSBUWVAsIG5vIG9wZW4gbm90ZSkgLSBub3cgdGhlcmUgaXMgYXQgbGVhc3Qgb25lIHJvdy5cbiAgZW5zdXJlUHJvcGVydHlNZW51UGF0Y2goZWRpdG9yLm93bmVyLmFwcCwgZWRpdG9yKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIG1vdW50RnJvbnRtYXR0ZXJFZGl0b3IsXG4gIGFkZEJsYW5rUHJvcGVydHksXG4gIHJlbmRlclNob3J0Y3V0Q29udHJvbHMsXG4gIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoLFxuICByZW1vdmVQcm9wZXJ0eU1lbnVQYXRjaCxcbiAgdHlwU3RvcmUsXG4gIHN1YnR5cFN0b3JlLFxufTtcbiIsICJjb25zdCB7IG1vdW50RnJvbnRtYXR0ZXJFZGl0b3IsIGFkZEJsYW5rUHJvcGVydHksIHR5cFN0b3JlLCBzdWJ0eXBTdG9yZSB9ID0gcmVxdWlyZShcIi4vdHlwLWZyb250bWF0dGVyLWVkaXRvclwiKTtcbmNvbnN0IHsgZ2V0U2VjdGlvbk9yZGVyLCBpc0VtcHR5VmFsdWUgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cHNcIik7XG5cbi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICogVGhlIGZyb250bWF0dGVyIGJsb2NrcyBvZiBhIFRZUCBpbiB0aGUgVFlQLVBhbmUgZGV0YWlsIChzZWVcbiAqIHJlbmRlclR5cFNldHRpbmdzIGluIHR5cC1wYW5lLmpzKTogdGhlIFRZUC1Gcm9udG1hdHRlciBvbiB0b3AsXG4gKiBiZWxvdyBpdCBvbmUgYmxvY2sgcGVyIHJlZ2lzdGVyZWQgU3VidHlwLlxuICpcbiAqIEVhY2ggYmxvY2sgaGFzIGl0cyBvd24gaW5zdGFuY2Ugb2YgT2JzaWRpYW4ncyBwcm9wZXJ0eSBlZGl0b3IsXG4gKiBib3VuZCB0byB0eXBTdG9yZSBvciBzdWJ0eXBTdG9yZSAoc2VlIHR5cC1mcm9udG1hdHRlci1lZGl0b3IuanMpLlxuICogVGhhdCBpcyB3aGF0IGxldHMgdGhlIHNhbWUga2V5IGFwcGVhciBpbiBzZXZlcmFsIGJsb2NrcyAtIG9uZVxuICogc2hhcmVkIGVkaXRvciB3b3VsZCBob2xkIGV2ZXJ5dGhpbmcgaW4gYSBzaW5nbGUgZmxhdCBvYmplY3QuXG4gKlxuICogT2JzaWRpYW4ncyByb3cgZHJhZyBvbmx5IHdvcmtzIHdpdGhpbiBvbmUgaW5zdGFuY2UsIHNvXG4gKiByZWdpc3RlclByb3BlcnR5RHJhZygpIGJlbG93IGJ1aWxkcyBvbiB0aGF0IGRyYWcgdG8gbW92ZSBhXG4gKiBwcm9wZXJ0eSBiZXR3ZWVuIGJsb2Nrcy4gS2V5Ym9hcmQgbmF2aWdhdGlvbiBhY3Jvc3MgYmxvY2tzIGlzXG4gKiByZWdpc3RlckZvY3VzQ2hhaW4oKSBpbiB0eXAtZnJvbnRtYXR0ZXItZWRpdG9yLmpzLlxuICpcbiAqIFNlY3Rpb246IG51bGwgPSBUWVAtRnJvbnRtYXR0ZXIsIG90aGVyd2lzZSB0aGUgU3VidHlwIG5hbWUuXG4gKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi9cblxuLy8gQSB3aG9sZSBibG9jayBjYW4gYmUgZ3JhYmJlZCBhbnl3aGVyZSBvdXRzaWRlIGl0cyBwcm9wZXJ0eSByb3dzIC0gaGVhZGluZyxcbi8vIGZvb3Rlciwgc2lkZSBtYXJnaW5zLiBDb250cm9scyBhbmQgYSB0aXRsZSBiZWluZyBlZGl0ZWQgYXJlIGV4Y2x1ZGVkLlxuZnVuY3Rpb24gaXNHcmFiVGFyZ2V0KHRhcmdldCkge1xuICBpZiAodGFyZ2V0LmNsb3Nlc3QoXCIuY2xpY2thYmxlLWljb24sIC50eXAtc3VidHlwLWNvbG9yLWRvdCwgW2NvbnRlbnRlZGl0YWJsZT0ndHJ1ZSddLCBpbnB1dCwgdGV4dGFyZWFcIikpIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuICF0YXJnZXQuY2xvc2VzdChcIi5tZXRhZGF0YS1wcm9wZXJ0eVwiKTtcbn1cblxuLy8gcmVuZGVySGVhZGVyKHNlY3Rpb24sIGVsLCBibG9ja3MpIC8gcmVuZGVyRm9vdGVyKHNlY3Rpb24sIGVsLCBibG9ja3MpIGZpbGwgYVxuLy8gYmxvY2sncyBoZWFkaW5nIGFuZCBmb290ZXIuIG9uTW92ZVNlY3Rpb24ob3JkZXIpIHJlcG9ydHMgdGhlIG5ldyBibG9jayBvcmRlclxuLy8gYWZ0ZXIgYSBibG9jayBkcmFnIChzaGFwZWQgbGlrZSBnZXRTZWN0aW9uT3JkZXIsIGxlYWRpbmcgbnVsbCBpbmNsdWRlZCkuXG5mdW5jdGlvbiBtb3VudEZyb250bWF0dGVyQmxvY2tzKHZpZXcsIGNvbnRhaW5lckVsLCB0eXAsIHsgcmVuZGVySGVhZGVyLCByZW5kZXJGb290ZXIsIG9uTW92ZVNlY3Rpb24gfSkge1xuICBjb25zdCB3cmFwcGVyID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1ibG9ja3NcIiB9KTtcbiAgY29uc3Qgc2VjdGlvbnMgPSBnZXRTZWN0aW9uT3JkZXIodmlldy5wbHVnaW4uc2V0dGluZ3MsIHR5cCk7XG4gIGNvbnN0IGVkaXRvcnMgPSBuZXcgTWFwKCk7XG4gIGNvbnN0IGJsb2NrRWxzID0gbmV3IE1hcCgpO1xuICBjb25zdCBzdG9yZXMgPSBuZXcgTWFwKCk7XG5cbiAgY29uc3QgYXBpID0ge1xuICAgIC8vIEFsbCBlZGl0b3IgaW5zdGFuY2VzIGluIGJsb2NrIG9yZGVyOyB0eXAtcGFuZS5qcyBhZGRzIHRoZW0gYXMgY29tcG9uZW50XG4gICAgLy8gY2hpbGRyZW4gYW5kIHVubG9hZHMgdGhlbSBiZWZvcmUgZWFjaCByZWJ1aWxkLlxuICAgIGVkaXRvcnM6IFtdLFxuICAgIC8vIEFkZHMgYSBibGFuayByb3cgYXQgdGhlIGVuZCBvZiB0aGUgYmxvY2sgd2l0aCBmb2N1cyBpbiB0aGUga2V5IGZpZWxkXG4gICAgLy8gKHNlZSBhZGRCbGFua1Byb3BlcnR5KS4gZmxvYXRpbmcgbWFya3MgdGhlIG5leHQgbmFtZWQgcHJvcGVydHkgYXNcbiAgICAvLyBmbG9hdGluZy5cbiAgICBhZGRCbGFuayhzZWN0aW9uLCBmbG9hdGluZyA9IGZhbHNlKSB7XG4gICAgICBjb25zdCBlZGl0b3IgPSBlZGl0b3JzLmdldChzZWN0aW9uKTtcbiAgICAgIGlmICghZWRpdG9yKSByZXR1cm47XG4gICAgICBlZGl0b3IudHlwUGVuZGluZ0Zsb2F0aW5nQWRkID0gZmxvYXRpbmc7XG4gICAgICBhZGRCbGFua1Byb3BlcnR5KGVkaXRvcik7XG4gICAgfSxcbiAgfTtcblxuICAvLyBOZXh0IGJsb2NrIGluIGRpcmVjdGlvbiBzdGVwIHRoYXQgaGFzIGEgcm93IHRvIGp1bXAgdG87IGVtcHR5IGJsb2NrcyBhcmVcbiAgLy8gc2tpcHBlZC5cbiAgY29uc3QgZm9jdXNOZWlnaGJvciA9IChzZWN0aW9uLCBzdGVwKSA9PiB7XG4gICAgZm9yIChsZXQgaSA9IHNlY3Rpb25zLmluZGV4T2Yoc2VjdGlvbikgKyBzdGVwOyBpID49IDAgJiYgaSA8IHNlY3Rpb25zLmxlbmd0aDsgaSArPSBzdGVwKSB7XG4gICAgICBjb25zdCBlZGl0b3IgPSBlZGl0b3JzLmdldChzZWN0aW9uc1tpXSk7XG4gICAgICBpZiAoIWVkaXRvciB8fCBlZGl0b3IucmVuZGVyZWQubGVuZ3RoID09PSAwKSBjb250aW51ZTtcbiAgICAgIGVkaXRvci5mb2N1c1Byb3BlcnR5QXRJbmRleChzdGVwID4gMCA/IDAgOiAtMSk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9O1xuXG4gIGZvciAoY29uc3Qgc2VjdGlvbiBvZiBzZWN0aW9ucykge1xuICAgIGNvbnN0IGlzU3ViID0gc2VjdGlvbiAhPT0gbnVsbDtcbiAgICBjb25zdCBibG9ja0VsID0gd3JhcHBlci5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcInR5cC1ibG9ja1wiICsgKGlzU3ViID8gXCIgdHlwLWZyb250bWF0dGVyLWJsb2NrIHR5cC1zdWJ0eXAtYmxvY2tcIiA6IFwiXCIpLFxuICAgIH0pO1xuICAgIGJsb2NrRWxzLnNldChzZWN0aW9uLCBibG9ja0VsKTtcbiAgICBibG9ja0VsLnR5cFNlY3Rpb24gPSBzZWN0aW9uO1xuXG4gICAgY29uc3QgaGVhZGVyID0gYmxvY2tFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLWhlYWRlciB0eXAtc2VjdGlvbi1oZWFkZXJcIiB9KTtcbiAgICBoZWFkZXIudG9nZ2xlQ2xhc3MoXCJ0eXAtc2VjdGlvbi1zdWJcIiwgaXNTdWIpO1xuXG4gICAgY29uc3Qgc3RvcmUgPSBzZWN0aW9uID09PSBudWxsID8gdHlwU3RvcmUodmlldy5wbHVnaW4sIHR5cCkgOiBzdWJ0eXBTdG9yZSh2aWV3LnBsdWdpbiwgdHlwLCBzZWN0aW9uKTtcbiAgICBzdG9yZXMuc2V0KHNlY3Rpb24sIHN0b3JlKTtcbiAgICBjb25zdCBlZGl0b3IgPSBtb3VudEZyb250bWF0dGVyRWRpdG9yKHZpZXcsIGJsb2NrRWwsIHN0b3JlLCB7XG4gICAgICBvblNoaWZ0Rm9jdXM6IChzdGVwKSA9PiBmb2N1c05laWdoYm9yKHNlY3Rpb24sIHN0ZXApLFxuICAgIH0pO1xuICAgIGlmIChlZGl0b3IpIHtcbiAgICAgIGVkaXRvcnMuc2V0KHNlY3Rpb24sIGVkaXRvcik7XG4gICAgICBhcGkuZWRpdG9ycy5wdXNoKGVkaXRvcik7XG4gICAgfVxuXG4gICAgY29uc3QgZm9vdGVyID0gYmxvY2tFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLXNlY3Rpb24tZm9vdGVyXCIgfSk7XG4gICAgZm9vdGVyLnRvZ2dsZUNsYXNzKFwidHlwLXNlY3Rpb24tc3ViXCIsIGlzU3ViKTtcbiAgICByZW5kZXJIZWFkZXIoc2VjdGlvbiwgaGVhZGVyLCBhcGkpO1xuICAgIHJlbmRlckZvb3Rlcj8uKHNlY3Rpb24sIGZvb3RlciwgYXBpKTtcblxuICAgIGlmICghaXNTdWIpIGNvbnRpbnVlO1xuICAgIGJsb2NrRWwuYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlZG93blwiLCAoZXZlbnQpID0+IHN0YXJ0QmxvY2tEcmFnKGV2ZW50LCBzZWN0aW9uKSk7XG4gIH1cblxuICAvLyBNb3VzZSBkcmFnIGluc3RlYWQgb2YgSFRNTDUgZHJhZ2dhYmxlOiBhIGRyYWdnYWJsZSBhbmNlc3RvciBicm9rZSB0ZXh0XG4gIC8vIHNlbGVjdGlvbiBpbiB0aGUgcm93IGlucHV0cy4gU3RhcnRzIGFmdGVyIGEgZmV3IHBpeGVsczsgYW4gYWNjZW50IGxpbmVcbiAgLy8gc2hvd3MgdGhlIHRhcmdldCBnYXAsIEVzY2FwZSBjYW5jZWxzLiBUaGUgVFlQLUZyb250bWF0dGVyIGlzIGZpeGVkIG9uIHRvcFxuICAvLyAoc2VlIGdldFNlY3Rpb25PcmRlciksIHNvIHRhcmdldCAwIGRvZXNuJ3QgZXhpc3QuXG4gIGZ1bmN0aW9uIHN0YXJ0QmxvY2tEcmFnKGV2ZW50LCBzZWN0aW9uKSB7XG4gICAgaWYgKGV2ZW50LmJ1dHRvbiAhPT0gMCB8fCAhaXNHcmFiVGFyZ2V0KGV2ZW50LnRhcmdldCkpIHJldHVybjtcbiAgICBjb25zdCB3aW4gPSB3cmFwcGVyLndpbjtcbiAgICBjb25zdCBzdGFydFkgPSBldmVudC5jbGllbnRZO1xuICAgIGxldCBkcmFnZ2luZyA9IGZhbHNlO1xuICAgIGxldCBpbmRpY2F0b3IgPSBudWxsO1xuICAgIGxldCBib3hlcyA9IFtdO1xuICAgIGxldCB0YXJnZXRJbmRleCA9IG51bGw7XG5cbiAgICBjb25zdCBtZWFzdXJlID0gKCkgPT4ge1xuICAgICAgY29uc3QgYmFzZSA9IHdyYXBwZXIuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICBib3hlcyA9IHNlY3Rpb25zLm1hcCgobmFtZSkgPT4ge1xuICAgICAgICBjb25zdCByZWN0ID0gYmxvY2tFbHMuZ2V0KG5hbWUpLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgICByZXR1cm4geyBzZWN0aW9uOiBuYW1lLCB0b3A6IHJlY3QudG9wIC0gYmFzZS50b3AsIGJvdHRvbTogcmVjdC5ib3R0b20gLSBiYXNlLnRvcCB9O1xuICAgICAgfSk7XG4gICAgfTtcblxuICAgIGNvbnN0IG9uTW92ZSA9IChtb3ZlRXZlbnQpID0+IHtcbiAgICAgIGlmICghZHJhZ2dpbmcpIHtcbiAgICAgICAgaWYgKE1hdGguYWJzKG1vdmVFdmVudC5jbGllbnRZIC0gc3RhcnRZKSA8IDQpIHJldHVybjtcbiAgICAgICAgZHJhZ2dpbmcgPSB0cnVlO1xuICAgICAgICB3cmFwcGVyLmRvYy5ib2R5LmFkZENsYXNzKFwidHlwLWJsb2NrLWRyYWdnaW5nXCIpO1xuICAgICAgICB3aW4uZ2V0U2VsZWN0aW9uKCk/LnJlbW92ZUFsbFJhbmdlcygpO1xuICAgICAgICBibG9ja0Vscy5nZXQoc2VjdGlvbikuYWRkQ2xhc3MoXCJpcy1kcmFnZ2luZ1wiKTtcbiAgICAgICAgbWVhc3VyZSgpO1xuICAgICAgICBpbmRpY2F0b3IgPSB3cmFwcGVyLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtYmxvY2stZHJvcC1pbmRpY2F0b3JcIiB9KTtcbiAgICAgIH1cbiAgICAgIG1vdmVFdmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgY29uc3QgeSA9IG1vdmVFdmVudC5jbGllbnRZIC0gd3JhcHBlci5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKS50b3A7XG4gICAgICB0YXJnZXRJbmRleCA9IE1hdGgubWF4KDEsIGJveGVzLmZpbHRlcigoYm94KSA9PiAoYm94LnRvcCArIGJveC5ib3R0b20pIC8gMiA8IHkpLmxlbmd0aCk7XG4gICAgICBjb25zdCBmcm9tID0gYm94ZXMuZmluZEluZGV4KChib3gpID0+IGJveC5zZWN0aW9uID09PSBzZWN0aW9uKTtcbiAgICAgIGluZGljYXRvci50b2dnbGUodGFyZ2V0SW5kZXggIT09IGZyb20gJiYgdGFyZ2V0SW5kZXggIT09IGZyb20gKyAxKTtcbiAgICAgIC8vIE1pZGRsZSBvZiB0aGUgZ2FwIGJldHdlZW4gdHdvIGJsb2NrcyAoc2VlIC50eXAtYmxvY2sgKyAudHlwLWJsb2NrIGluXG4gICAgICAvLyBzdHlsZXMuY3NzKS5cbiAgICAgIGNvbnN0IGhhbGZHYXAgPSA2O1xuICAgICAgY29uc3QgZ2FwWSA9XG4gICAgICAgIHRhcmdldEluZGV4ID09PSBib3hlcy5sZW5ndGhcbiAgICAgICAgICA/IGJveGVzW2JveGVzLmxlbmd0aCAtIDFdLmJvdHRvbSArIGhhbGZHYXBcbiAgICAgICAgICA6IChib3hlc1t0YXJnZXRJbmRleCAtIDFdLmJvdHRvbSArIGJveGVzW3RhcmdldEluZGV4XS50b3ApIC8gMjtcbiAgICAgIGluZGljYXRvci5zdHlsZS50b3AgPSBgJHtnYXBZIC0gMX1weGA7XG4gICAgfTtcblxuICAgIGNvbnN0IGVuZCA9IChjb21taXQpID0+IHtcbiAgICAgIHdpbi5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIG9uTW92ZSk7XG4gICAgICB3aW4ucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNldXBcIiwgb25VcCk7XG4gICAgICB3aW4ucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgb25LZXksIHRydWUpO1xuICAgICAgaWYgKCFkcmFnZ2luZykgcmV0dXJuO1xuICAgICAgd3JhcHBlci5kb2MuYm9keS5yZW1vdmVDbGFzcyhcInR5cC1ibG9jay1kcmFnZ2luZ1wiKTtcbiAgICAgIGJsb2NrRWxzLmdldChzZWN0aW9uKS5yZW1vdmVDbGFzcyhcImlzLWRyYWdnaW5nXCIpO1xuICAgICAgaW5kaWNhdG9yPy5yZW1vdmUoKTtcblxuICAgICAgY29uc3Qgb3JkZXIgPSBib3hlcy5tYXAoKGJveCkgPT4gYm94LnNlY3Rpb24pO1xuICAgICAgY29uc3QgZnJvbSA9IG9yZGVyLmluZGV4T2Yoc2VjdGlvbik7XG4gICAgICBpZiAoIWNvbW1pdCB8fCB0YXJnZXRJbmRleCA9PT0gbnVsbCB8fCB0YXJnZXRJbmRleCA9PT0gZnJvbSB8fCB0YXJnZXRJbmRleCA9PT0gZnJvbSArIDEpIHJldHVybjtcbiAgICAgIG9yZGVyLnNwbGljZShmcm9tLCAxKTtcbiAgICAgIG9yZGVyLnNwbGljZShmcm9tIDwgdGFyZ2V0SW5kZXggPyB0YXJnZXRJbmRleCAtIDEgOiB0YXJnZXRJbmRleCwgMCwgc2VjdGlvbik7XG4gICAgICBvbk1vdmVTZWN0aW9uPy4ob3JkZXIpO1xuICAgIH07XG4gICAgY29uc3Qgb25VcCA9ICgpID0+IGVuZCh0cnVlKTtcbiAgICBjb25zdCBvbktleSA9IChrZXlFdmVudCkgPT4ge1xuICAgICAgaWYgKGtleUV2ZW50LmtleSAhPT0gXCJFc2NhcGVcIikgcmV0dXJuO1xuICAgICAga2V5RXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGtleUV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgZW5kKGZhbHNlKTtcbiAgICB9O1xuICAgIHdpbi5hZGRFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIG9uTW92ZSk7XG4gICAgd2luLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZXVwXCIsIG9uVXApO1xuICAgIHdpbi5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCBvbktleSwgdHJ1ZSk7XG4gIH1cblxuICByZWdpc3RlclByb3BlcnR5RHJhZygpO1xuICByZXR1cm4gYXBpO1xuXG4gIC8qIC0tLSBEcmFnZ2luZyBhIHByb3BlcnR5IGludG8gYW5vdGhlciBibG9jayAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAqIEJ1aWx0IG9uIE9ic2lkaWFuJ3Mgb3duIHJvdyBkcmFnIHJhdGhlciB0aGFuIGEgc2Vjb25kIG9uZSBuZXh0IHRvIGl0OlxuICAgKiBpdCBzdGFydHMgYXQgdGhlIHJvdydzIHR5cGUgaWNvbiwgcHV0cyBhIC5kcmFnLXJlb3JkZXItZ2hvc3Qgb24gdGhlXG4gICAqIGJvZHkgKHNvIGl0IGZvbGxvd3MgdGhlIGN1cnNvciBhY3Jvc3MgYmxvY2tzIGFueXdheSkgYW5kIG1hcmtzIHRoZVxuICAgKiBzb3VyY2Ugcm93IHdpdGggLmRyYWctZ2hvc3QtaGlkZGVuLCB0aGUgYWNjZW50IGJveCBzaG93aW5nIHRoZSBkcm9wXG4gICAqIHNwb3QuIFdpdGhpbiBvbmUgYmxvY2sgT2JzaWRpYW4gZG9lcyBldmVyeXRoaW5nIGFzIHVzdWFsLiBBZGRlZCBoZXJlOlxuICAgKlxuICAgKiAgLSBhbiBlbXB0eSBleHRyYSBjaGlsZCBpbiB0aGUgbGlzdCB3aGlsZSBkcmFnZ2luZzogb3RoZXJ3aXNlIE9ic2lkaWFuXG4gICAqICAgIGRvZXNuJ3Qgc3RhcnQgdGhlIGRyYWcgaW4gYSBibG9jayB3aXRoIGEgc2luZ2xlIHJvdyAoaXRzIG1vdXNlZG93blxuICAgKiAgICBjaGVja3Mgbi5maXJzdENoaWxkICE9PSBuLmxhc3RDaGlsZCk7XG4gICAqICAtIGEgcGxhY2Vob2xkZXIgd2l0aCB0aGUgc2FtZSAuZHJhZy1naG9zdC1oaWRkZW4gY2xhc3MgaW4gdGhlIHRhcmdldFxuICAgKiAgICBibG9jayBvbmNlIHRoZSBjdXJzb3IgcmVhY2hlcyBhbm90aGVyIGJsb2NrOyB0aGUgc291cmNlIHJvdyBpc1xuICAgKiAgICBoaWRkZW4gbWVhbndoaWxlIHNvIHRoZXJlIGFyZW4ndCB0d28gYm94ZXM7XG4gICAqICAtIGEgcmVvcmRlcktleSBwZXIgaW5zdGFuY2UgdGhhdCBtb3ZlcyB0aGUgcHJvcGVydHkgdG8gdGhlIG90aGVyXG4gICAqICAgIGJsb2NrIG9uIGRyb3AgaW5zdGVhZCBvZiBzb3J0aW5nIHdpdGhpbiBpdHMgb3duLlxuICAgKlxuICAgKiBPdXIgaGFuZGxlcnMgcnVuIGluIHRoZSBjYXB0dXJlIHBoYXNlIG9uIHRoZSB3aW5kb3csIGJlZm9yZSBPYnNpZGlhbidzXG4gICAqICh3aGljaCBpdCBhZGRzIHRvIHdpbmRvdyBpbiBpdHMgbW91c2Vkb3duIGhhbmRsZXIpLlxuICAgKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuICBmdW5jdGlvbiByZWdpc3RlclByb3BlcnR5RHJhZygpIHtcbiAgICAvLyBXaXRob3V0IGEgc2Vjb25kIGJsb2NrIHRoZXJlIGlzIG5vIHRhcmdldDsgT2JzaWRpYW4ncyBkcmFnIHN0YXlzIGFzIGlzLlxuICAgIGNvbnN0IGFuY2hvciA9IGFwaS5lZGl0b3JzWzBdO1xuICAgIGlmICghYW5jaG9yIHx8IHNlY3Rpb25zLmxlbmd0aCA8IDIpIHJldHVybjtcblxuICAgIC8vIFN0YXRlIG9mIGEgcnVubmluZyBkcmFnOyBkcm9wIGtlZXBzIHRoZSB0YXJnZXQgZm9yIHRoZSByZW9yZGVyS2V5IGNhbGxcbiAgICAvLyB0aGF0IGZvbGxvd3MgdGhlIG1vdXNldXAuXG4gICAgbGV0IGRyYWcgPSBudWxsO1xuICAgIGxldCBkcm9wID0gbnVsbDtcblxuICAgIGNvbnN0IHNlY3Rpb25BdCA9IChjbGllbnRZKSA9PlxuICAgICAgc2VjdGlvbnMuZmluZCgoc2VjdGlvbikgPT4ge1xuICAgICAgICBjb25zdCByZWN0ID0gYmxvY2tFbHMuZ2V0KHNlY3Rpb24pLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgICByZXR1cm4gY2xpZW50WSA+PSByZWN0LnRvcCAmJiBjbGllbnRZIDw9IHJlY3QuYm90dG9tO1xuICAgICAgfSk7XG5cbiAgICBjb25zdCBjbGVhclBsYWNlaG9sZGVyID0gKCkgPT4ge1xuICAgICAgZHJhZy5wbGFjZWhvbGRlcj8ucmVtb3ZlKCk7XG4gICAgICBkcmFnLnBsYWNlaG9sZGVyID0gbnVsbDtcbiAgICAgIGRyYWcucm93RWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJkaXNwbGF5XCIpO1xuICAgICAgZHJhZy50YXJnZXQgPSBudWxsO1xuICAgIH07XG5cbiAgICB3cmFwcGVyLmFkZEV2ZW50TGlzdGVuZXIoXG4gICAgICBcIm1vdXNlZG93blwiLFxuICAgICAgKGV2ZW50KSA9PiB7XG4gICAgICAgIGlmIChldmVudC5idXR0b24gIT09IDApIHJldHVybjtcbiAgICAgICAgY29uc3Qgcm93RWwgPSBldmVudC50YXJnZXQuY2xvc2VzdChcIi5tZXRhZGF0YS1wcm9wZXJ0eS1pY29uXCIpPy5jbG9zZXN0KFwiLm1ldGFkYXRhLXByb3BlcnR5XCIpO1xuICAgICAgICBjb25zdCBzZWN0aW9uID0gcm93RWw/LmNsb3Nlc3QoXCIudHlwLWJsb2NrXCIpPy50eXBTZWN0aW9uO1xuICAgICAgICBjb25zdCBlZGl0b3IgPSBzZWN0aW9uID09PSB1bmRlZmluZWQgPyBudWxsIDogZWRpdG9ycy5nZXQoc2VjdGlvbik7XG4gICAgICAgIGNvbnN0IGtleSA9IGVkaXRvcj8ucmVuZGVyZWQuZmluZCgocm93KSA9PiByb3cuY29udGFpbmVyRWwgPT09IHJvd0VsKT8uZW50cnkua2V5O1xuICAgICAgICAvLyBBbiB1bm5hbWVkIHJvdyBoYXMgbm8gYnVzaW5lc3MgaW4gYW5vdGhlciBibG9jazsgT2JzaWRpYW4gc29ydHMgaXQuXG4gICAgICAgIGlmICgha2V5KSByZXR1cm47XG4gICAgICAgIGRyYWcgPSB7XG4gICAgICAgICAgc2VjdGlvbixcbiAgICAgICAgICBrZXksXG4gICAgICAgICAgcm93RWwsXG4gICAgICAgICAgLy8gTWVhc3VyZWQgbm93OiBvbmNlIGhpZGRlbiBmb3IgdGhlIHBsYWNlaG9sZGVyLCBvZmZzZXRIZWlnaHQgaXMgMC5cbiAgICAgICAgICBoZWlnaHQ6IHJvd0VsLm9mZnNldEhlaWdodCxcbiAgICAgICAgICBzcGFjZXI6IGVkaXRvci5wcm9wZXJ0eUxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWRyYWctc3BhY2VyXCIgfSksXG4gICAgICAgICAgcGxhY2Vob2xkZXI6IG51bGwsXG4gICAgICAgICAgdGFyZ2V0OiBudWxsLFxuICAgICAgICB9O1xuICAgICAgICBkcm9wID0gbnVsbDtcbiAgICAgIH0sXG4gICAgICB0cnVlXG4gICAgKTtcblxuICAgIC8vIE9uIHRoZSB3aW5kb3cgc28gYSBkcmFnIGlzIHRyYWNrZWQgb3V0c2lkZSB0aGUgYmxvY2tzIHRvbzsgcmVtb3ZlZCB3aXRoXG4gICAgLy8gdGhlIGZpcnN0IGVkaXRvciwgd2hpY2ggdW5sb2FkcyBvbiB0aGUgbmV4dCByZWJ1aWxkIG9mIHRoZSBkZXRhaWwgdmlldy5cbiAgICBjb25zdCBvbldpbk1vdmUgPSAoZXZlbnQpID0+IHtcbiAgICAgIGlmICghZHJhZykgcmV0dXJuO1xuICAgICAgY29uc3QgdGFyZ2V0ID0gc2VjdGlvbkF0KGV2ZW50LmNsaWVudFkpO1xuICAgICAgaWYgKHRhcmdldCA9PT0gdW5kZWZpbmVkIHx8IHRhcmdldCA9PT0gZHJhZy5zZWN0aW9uKSB7XG4gICAgICAgIGlmIChkcmFnLnBsYWNlaG9sZGVyKSBjbGVhclBsYWNlaG9sZGVyKCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgY29uc3QgbGlzdCA9IGVkaXRvcnMuZ2V0KHRhcmdldCkucHJvcGVydHlMaXN0RWw7XG4gICAgICBpZiAoIWRyYWcucGxhY2Vob2xkZXIpIHtcbiAgICAgICAgZHJhZy5yb3dFbC5zdHlsZS5kaXNwbGF5ID0gXCJub25lXCI7XG4gICAgICAgIGRyYWcucGxhY2Vob2xkZXIgPSBjcmVhdGVEaXYoeyBjbHM6IFwibWV0YWRhdGEtcHJvcGVydHkgZHJhZy1naG9zdC1oaWRkZW4gdHlwLWRyYWctcGxhY2Vob2xkZXJcIiB9KTtcbiAgICAgICAgZHJhZy5wbGFjZWhvbGRlci5zdHlsZS5oZWlnaHQgPSBgJHtkcmFnLmhlaWdodH1weGA7XG4gICAgICB9XG4gICAgICAvLyBEcm9wIHNwb3QgYXMgT2JzaWRpYW4gZG9lcyBpdDogYmVmb3JlIHRoZSBmaXJzdCByb3cgd2hvc2UgbWlkZGxlIGlzXG4gICAgICAvLyBiZWxvdyB0aGUgY3Vyc29yLlxuICAgICAgY29uc3Qgcm93cyA9IFsuLi5saXN0LmNoaWxkcmVuXS5maWx0ZXIoKGVsKSA9PiBlbCAhPT0gZHJhZy5wbGFjZWhvbGRlciAmJiBlbCAhPT0gZHJhZy5zcGFjZXIpO1xuICAgICAgY29uc3QgYmVmb3JlID0gcm93cy5maW5kKChlbCkgPT4ge1xuICAgICAgICBjb25zdCByZWN0ID0gZWwuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICAgIHJldHVybiBldmVudC5jbGllbnRZIDwgcmVjdC50b3AgKyByZWN0LmhlaWdodCAvIDI7XG4gICAgICB9KTtcbiAgICAgIGRyYWcudGFyZ2V0ID0geyBzZWN0aW9uOiB0YXJnZXQsIGluZGV4OiBiZWZvcmUgPyByb3dzLmluZGV4T2YoYmVmb3JlKSA6IHJvd3MubGVuZ3RoIH07XG4gICAgICBsaXN0Lmluc2VydEJlZm9yZShkcmFnLnBsYWNlaG9sZGVyLCBiZWZvcmUgPz8gbnVsbCk7XG4gICAgfTtcblxuICAgIGNvbnN0IG9uV2luVXAgPSAoKSA9PiB7XG4gICAgICBpZiAoIWRyYWcpIHJldHVybjtcbiAgICAgIGNvbnN0IHsgc3BhY2VyLCBwbGFjZWhvbGRlciwgcm93RWwsIHRhcmdldCB9ID0gZHJhZztcbiAgICAgIGRyYWcgPSBudWxsO1xuICAgICAgZHJvcCA9IHRhcmdldDtcbiAgICAgIHBsYWNlaG9sZGVyPy5yZW1vdmUoKTtcbiAgICAgIHJvd0VsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiZGlzcGxheVwiKTtcbiAgICAgIC8vIE9ubHkgYWZ0ZXIgT2JzaWRpYW4gZmluaXNoZXMgaXRzIGRyYWc6IGl0IHN0aWxsIHJlYWRzIHRoZSBkcm9wIHNwb3RcbiAgICAgIC8vIGluIHRoZSBzb3VyY2UgYmxvY2sgZnJvbSB0aGUgY2hpbGQgbGlzdCwgd2hlcmUgdGhlIHNwYWNlciBtYXJrcyB0aGVcbiAgICAgIC8vIGxhc3QgcG9zaXRpb24uXG4gICAgICB3cmFwcGVyLndpbi5zZXRUaW1lb3V0KCgpID0+IHNwYWNlci5yZW1vdmUoKSwgMCk7XG4gICAgfTtcblxuICAgIHdyYXBwZXIud2luLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZW1vdmVcIiwgb25XaW5Nb3ZlLCB0cnVlKTtcbiAgICB3cmFwcGVyLndpbi5hZGRFdmVudExpc3RlbmVyKFwibW91c2V1cFwiLCBvbldpblVwLCB0cnVlKTtcbiAgICBhbmNob3IucmVnaXN0ZXIoKCkgPT4ge1xuICAgICAgd3JhcHBlci53aW4ucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNlbW92ZVwiLCBvbldpbk1vdmUsIHRydWUpO1xuICAgICAgd3JhcHBlci53aW4ucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNldXBcIiwgb25XaW5VcCwgdHJ1ZSk7XG4gICAgfSk7XG5cbiAgICBmb3IgKGNvbnN0IFtzZWN0aW9uLCBlZGl0b3JdIG9mIGVkaXRvcnMpIHtcbiAgICAgIGNvbnN0IG9yaWdpbmFsUmVvcmRlcktleSA9IGVkaXRvci5yZW9yZGVyS2V5O1xuICAgICAgZWRpdG9yLnJlb3JkZXJLZXkgPSBmdW5jdGlvbiAoZW50cnksIGluZGV4KSB7XG4gICAgICAgIGNvbnN0IHRhcmdldCA9IGRyb3A7XG4gICAgICAgIGRyb3AgPSBudWxsO1xuICAgICAgICBpZiAoIXRhcmdldCkgcmV0dXJuIG9yaWdpbmFsUmVvcmRlcktleS5jYWxsKHRoaXMsIGVudHJ5LCBpbmRleCk7XG4gICAgICAgIG1vdmVQcm9wZXJ0eShzZWN0aW9uLCB0YXJnZXQuc2VjdGlvbiwgZW50cnkua2V5LCB0YXJnZXQuaW5kZXgpO1xuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICAvLyBNb3ZlcyBrZXkgZnJvbSBibG9jayBgZnJvbWAgdG8gYmxvY2sgYHRvYCBhdCBwb3NpdGlvbiBpbmRleC4gSWYgdGhlIHRhcmdldFxuICAvLyBhbHJlYWR5IGhhcyB0aGUgbmFtZSAodW5pcXVlIHdpdGhpbiBhIGJsb2NrKSwgdGhlIHR3byBtZXJnZTogdGhlIGV4aXN0aW5nXG4gIC8vIGVudHJ5IGtlZXBzIHBvc2l0aW9uLCB2YWx1ZSwgZmxvYXRpbmcgZmxhZyBhbmQgc2hvcnRjdXQ7IG9ubHkgYW4gZW1wdHlcbiAgLy8gdmFsdWUgaXMgZmlsbGVkIGZyb20gdGhlIGRyYWdnZWQgb25lIC0gc2FtZSBydWxlIGFzIG1lcmdlU3VidHlwc1xuICAvLyAoc3VidHlwcy5qcykgYW5kIHJlbmFtZUluU3RvcmUgKHByb3BlcnR5LXJlbmFtZS1zeW5jLmpzKS5cbiAgYXN5bmMgZnVuY3Rpb24gbW92ZVByb3BlcnR5KGZyb20sIHRvLCBrZXksIGluZGV4KSB7XG4gICAgY29uc3Qgc291cmNlID0gc3RvcmVzLmdldChmcm9tKTtcbiAgICBjb25zdCB0YXJnZXQgPSBzdG9yZXMuZ2V0KHRvKTtcbiAgICBpZiAoIXNvdXJjZSB8fCAhdGFyZ2V0IHx8IGZyb20gPT09IHRvKSByZXR1cm47XG5cbiAgICBjb25zdCBzb3VyY2VGcm9udG1hdHRlciA9IHsgLi4uc291cmNlLmdldEZyb250bWF0dGVyKCkgfTtcbiAgICBjb25zdCB2YWx1ZSA9IHNvdXJjZUZyb250bWF0dGVyW2tleV07XG4gICAgY29uc3Qgd2FzRmxvYXRpbmcgPSBzb3VyY2UuZ2V0RmxvYXRpbmcoKS5pbmNsdWRlcyhrZXkpO1xuICAgIC8vIFRoZSBzaG9ydGN1dCBiZWxvbmdzIHRvIHRoZSBrZXkgYW5kIG1vdmVzIHdpdGggaXQuXG4gICAgY29uc3Qgc291cmNlU2hvcnRjdXRzID0geyAuLi5zb3VyY2UuZ2V0U2hvcnRjdXRzKCkgfTtcbiAgICBjb25zdCBzaG9ydGN1dCA9IHNvdXJjZVNob3J0Y3V0c1trZXldID8/IG51bGw7XG4gICAgZGVsZXRlIHNvdXJjZVNob3J0Y3V0c1trZXldO1xuICAgIGRlbGV0ZSBzb3VyY2VGcm9udG1hdHRlcltrZXldO1xuICAgIHNvdXJjZS5zZXRGcm9udG1hdHRlcihzb3VyY2VGcm9udG1hdHRlcik7XG4gICAgc291cmNlLnNldEZsb2F0aW5nKHNvdXJjZS5nZXRGbG9hdGluZygpLmZpbHRlcigoaykgPT4gayAhPT0ga2V5KSk7XG4gICAgc291cmNlLnNldFNob3J0Y3V0cyhzb3VyY2VTaG9ydGN1dHMpO1xuXG4gICAgY29uc3QgdGFyZ2V0RnJvbnRtYXR0ZXIgPSB0YXJnZXQuZ2V0RnJvbnRtYXR0ZXIoKTtcbiAgICBjb25zdCBleGlzdGluZyA9IE9iamVjdC5rZXlzKHRhcmdldEZyb250bWF0dGVyKS5maW5kKChrKSA9PiBrLnRvTG93ZXJDYXNlKCkgPT09IGtleS50b0xvd2VyQ2FzZSgpKTtcbiAgICBpZiAoZXhpc3RpbmcgIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKGlzRW1wdHlWYWx1ZSh0YXJnZXRGcm9udG1hdHRlcltleGlzdGluZ10pKSB0YXJnZXQuc2V0RnJvbnRtYXR0ZXIoeyAuLi50YXJnZXRGcm9udG1hdHRlciwgW2V4aXN0aW5nXTogdmFsdWUgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyh0YXJnZXRGcm9udG1hdHRlcik7XG4gICAgICBjb25zdCBhdCA9IE1hdGgubWF4KDAsIE1hdGgubWluKGluZGV4LCBrZXlzLmxlbmd0aCkpO1xuICAgICAgY29uc3QgbmV4dCA9IHt9O1xuICAgICAgZm9yIChjb25zdCBrIG9mIGtleXMuc2xpY2UoMCwgYXQpKSBuZXh0W2tdID0gdGFyZ2V0RnJvbnRtYXR0ZXJba107XG4gICAgICBuZXh0W2tleV0gPSB2YWx1ZTtcbiAgICAgIGZvciAoY29uc3QgayBvZiBrZXlzLnNsaWNlKGF0KSkgbmV4dFtrXSA9IHRhcmdldEZyb250bWF0dGVyW2tdO1xuICAgICAgdGFyZ2V0LnNldEZyb250bWF0dGVyKG5leHQpO1xuICAgICAgaWYgKHdhc0Zsb2F0aW5nKSB0YXJnZXQuc2V0RmxvYXRpbmcoWy4uLnRhcmdldC5nZXRGbG9hdGluZygpLCBrZXldKTtcbiAgICAgIGlmIChzaG9ydGN1dCkgdGFyZ2V0LnNldFNob3J0Y3V0cyh7IC4uLnRhcmdldC5nZXRTaG9ydGN1dHMoKSwgW2tleV06IHNob3J0Y3V0IH0pO1xuICAgIH1cblxuICAgIGF3YWl0IHZpZXcucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgIC8vIEJvdGggYmxvY2tzIGNoYW5nZWQsIHNvIHRoaXMgZGV0YWlsIHZpZXcgaXMgcmVidWlsdCBmcm9tIHRoZSBzZXR0aW5ncztcbiAgICAvLyB0aGUgb3RoZXIgdmlld3Mgb25seSBuZWVkIHRoZWlyIGNvbG9ycyBhbmQgbWFya3MgcmVmcmVzaGVkLlxuICAgIHZpZXcucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnNFeGNlcHQ/Lih2aWV3KTtcbiAgICB2aWV3LnJlbmRlcigpO1xuICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBtb3VudEZyb250bWF0dGVyQmxvY2tzIH07XG4iLCAiY29uc3QgeyBtb3ZlVHlwU3VidHlwcywgZGVsZXRlVHlwU3VidHlwcyB9ID0gcmVxdWlyZShcIi4vc3VidHlwc1wiKTtcblxuLy8gVGhlIHBlci1UWVAgdGFibGVzIG9mIHRoZSBzZXR0aW5ncywgZWFjaCBrZXllZCBieSBUWVAgbmFtZSAtIHRoZSBvbmUgbGlzdFxuLy8gdGhhdCByZW5hbWluZywgbWVyZ2luZyBhbmQgZGVsZXRpbmcgYSBUWVAgZ28gdGhyb3VnaCwgc28gYSB0YWJsZSBhZGRlZCBsYXRlclxuLy8gY2FuJ3QgYmUgZm9yZ290dGVuIGluIG9uZSBvZiB0aGVtLiB0eXBTdWJ0eXBzIGlzIGhhbmRsZWQgc2VwYXJhdGVseSAoc2VlXG4vLyBzdWJ0eXBzLmpzKTogYSBtZXJnZSBjb21iaW5lcyBTdWJ0eXAgYmxvY2tzIGluc3RlYWQgb2YgZHJvcHBpbmcgdGhlbS5cbi8vIHR5cE1hbnVhbCBtYXkgYmUgbWlzc2luZyBpbiBvbGRlciBzZXR0aW5ncywgc28gYSB0YWJsZSBpcyBvbmx5IGNyZWF0ZWQgd2hlblxuLy8gdGhlcmUgaXMgc29tZXRoaW5nIHRvIG1vdmUgaW50byBpdC5cbmNvbnN0IFRZUF9TRVRUSU5HX1RBQkxFUyA9IFtcbiAgXCJ0eXBDb2xvcnNcIixcbiAgXCJ0eXBEZXNjcmlwdGlvbnNcIixcbiAgXCJ0eXBEZWZhdWx0RnJvbnRtYXR0ZXJcIixcbiAgXCJ0eXBGbG9hdGluZ0tleXNcIixcbiAgXCJ0eXBTaG9ydGN1dHNcIixcbiAgXCJ0eXBNYW51YWxcIixcbl07XG5cbi8vIFJlbmFtaW5nIGluIHRoZSBzZXR0aW5nczogdGhlIFRZUCBrZWVwcyBpdHMgcGxhY2UgaW4gc2V0dGluZ3MudHlwcyAodGhlXG4vLyBtYW51YWwgb3JkZXIpLCBldmVyeSB0YWJsZSBlbnRyeSBhbmQgdGhlIFN1YnR5cHMgbW92ZSB0byB0aGUgbmV3IG5hbWUuXG5mdW5jdGlvbiBtb3ZlVHlwU2V0dGluZ3Moc2V0dGluZ3MsIGZyb20sIHRvKSB7XG4gIGNvbnN0IGluZGV4ID0gc2V0dGluZ3MudHlwcy5pbmRleE9mKGZyb20pO1xuICBpZiAoaW5kZXggIT09IC0xKSBzZXR0aW5ncy50eXBzW2luZGV4XSA9IHRvO1xuICBmb3IgKGNvbnN0IHRhYmxlIG9mIFRZUF9TRVRUSU5HX1RBQkxFUykge1xuICAgIGlmIChzZXR0aW5nc1t0YWJsZV0/Lltmcm9tXSA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICBzZXR0aW5nc1t0YWJsZV0gPz89IHt9O1xuICAgIHNldHRpbmdzW3RhYmxlXVt0b10gPSBzZXR0aW5nc1t0YWJsZV1bZnJvbV07XG4gICAgZGVsZXRlIHNldHRpbmdzW3RhYmxlXVtmcm9tXTtcbiAgfVxuICBtb3ZlVHlwU3VidHlwcyhzZXR0aW5ncywgZnJvbSwgdG8pO1xufVxuXG4vLyBSZW1vdmVzIHRoZSBUWVAgZnJvbSB0aGUgbGlzdCBhbmQgZnJvbSBldmVyeSB0YWJsZSwgU3VidHlwcyBpbmNsdWRlZC5cbmZ1bmN0aW9uIGRlbGV0ZVR5cFNldHRpbmdzKHNldHRpbmdzLCB0eXApIHtcbiAgc2V0dGluZ3MudHlwcyA9IHNldHRpbmdzLnR5cHMuZmlsdGVyKCh0KSA9PiB0ICE9PSB0eXApO1xuICBmb3IgKGNvbnN0IHRhYmxlIG9mIFRZUF9TRVRUSU5HX1RBQkxFUykge1xuICAgIGlmIChzZXR0aW5nc1t0YWJsZV0pIGRlbGV0ZSBzZXR0aW5nc1t0YWJsZV1bdHlwXTtcbiAgfVxuICBkZWxldGVUeXBTdWJ0eXBzKHNldHRpbmdzLCB0eXApO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgVFlQX1NFVFRJTkdfVEFCTEVTLCBtb3ZlVHlwU2V0dGluZ3MsIGRlbGV0ZVR5cFNldHRpbmdzIH07XG4iLCAiY29uc3QgeyBJdGVtVmlldywgTWVudSwgTm90aWNlLCBzZXRJY29uLCBkZWJvdW5jZSB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBDb25maXJtTW9kYWwsIHR5cE5hbWVOb2RlLCBzdWJ0eXBOYW1lTm9kZSB9ID0gcmVxdWlyZShcIi4vY29uZmlybS1tb2RhbFwiKTtcbmNvbnN0IHsgc25hcHNob3RTZXR0aW5ncywgb2ZmZXJVbmRvIH0gPSByZXF1aXJlKFwiLi91bmRvXCIpO1xuY29uc3QgeyBtb3VudEZyb250bWF0dGVyQmxvY2tzIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1ibG9ja3NcIik7XG5jb25zdCB7IHJlbmRlclNob3J0Y3V0Q29udHJvbHMgfSA9IHJlcXVpcmUoXCIuL3R5cC1mcm9udG1hdHRlci1lZGl0b3JcIik7XG5jb25zdCB7IG1vdmVUeXBTZXR0aW5ncywgZGVsZXRlVHlwU2V0dGluZ3MgfSA9IHJlcXVpcmUoXCIuL3R5cC1zZXR0aW5nc1wiKTtcbmNvbnN0IHsgcnVuT3JSZXBvcnRFcnJvciB9ID0gcmVxdWlyZShcIi4vY29tbWFuZHNcIik7XG5jb25zdCB7IGlzQmFzZXNFbmFibGVkLCBjcmVhdGVCYXNlRm9yIH0gPSByZXF1aXJlKFwiLi9iYXNlc1wiKTtcbmNvbnN0IHsgc29ydFR5cEZyb250bWF0dGVyIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1zb3J0XCIpO1xuY29uc3Qge1xuICBub3JtYWxpemVTdWJ0eXBOYW1lLFxuICBnZXRTdWJ0eXBOYW1lcyxcbiAgZW5zdXJlU3VidHlwLFxuICBtZXJnZVR5cFN1YnR5cHMsXG4gIGdldFN1YnR5cCxcbiAgaXNTdWJ0eXBNYW51YWwsXG4gIHNldFN1YnR5cE1hbnVhbCxcbiAgc2V0QWxsU3VidHlwc01hbnVhbCxcbiAgcmVuYW1lU3VidHlwLFxuICByZW9yZGVyU3VidHlwcyxcbiAgZGVsZXRlU3VidHlwLFxuICBtZXJnZVN1YnR5cHMsXG4gIHJlbmFtZVN1YnR5cEluTm90ZXMsXG59ID0gcmVxdWlyZShcIi4vc3VidHlwc1wiKTtcbmNvbnN0IHsgbm9ybWFsaXplVHlwTmFtZSwgY29tcGFyZVR5cHMsIHNvcnRUeXBzQnlNb2RlLCBwbHVyYWwsIGpvaW5BbmQgfSA9IHJlcXVpcmUoXCIuL3R5cC11dGlsc1wiKTtcbmNvbnN0IHsgdHlwS2V5T2YsIHByb3BlcnR5VmFsdWUsIHNldENhbm9uaWNhbFByb3BlcnR5LCBUWVBfUFJPUEVSVFksIFNVQlRZUF9QUk9QRVJUWSB9ID0gcmVxdWlyZShcIi4vdHlwLWluZGV4XCIpO1xuY29uc3Qge1xuICBzdWJ0eXBDb2xvcixcbiAgYXBwbHlDb2xvck9mZnNldCxcbiAgaGFzQ29sb3JPZmZzZXQsXG4gIHN1YnR5cEhhc093bkNvbG9yLFxuICBwYWludENvbG9yRG90LFxuICBuYW1lQ29sb3IsXG4gIGNoYW5uZWxCb3VuZHMsXG4gIGNsYW1wZWRPZmZzZXQsXG4gIFNVQlRZUF9DT0xPUl9DSEFOTkVMUyxcbiAgREVGQVVMVF9UWVBfQ09MT1IsXG59ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxuY29uc3QgVklFV19UWVBFX1RZUF9QQU5FID0gXCJ0eXAtc3lzdGVtLXBhbmVcIjtcbmNvbnN0IERFRkFVTFRfU09SVF9PUkRFUiA9IFwiY291bnQtZGVzY1wiO1xuY29uc3QgREVGQVVMVF9TRUNPTkRBUlkgPSBcInN1YnR5cHNcIjtcblxuLy8gV2hhdCB0aGUgVFlQLUxpc3Qgc2hvd3MgbmV4dCB0byB0aGUgbmFtZSAoc2V0dGluZ3MudHlwTGlzdFNlY29uZGFyeSksXG4vLyBjeWNsZWQgYnkgYSBoZWFkZXIgYnV0dG9uIG5leHQgdG8gc29ydGluZyAoc2VlIGN5Y2xlU2Vjb25kYXJ5KSAtIHRvbyBmZXcsXG4vLyB0b28gaW1tZWRpYXRlbHkgdmlzaWJsZSBzdGF0ZXMgZm9yIGEgbWVudS5cbi8vICAgc3VidHlwcyAgICAgLSB0aGUgVFlQJ3MgU3VidHlwcyBpbiBicmFja2V0cywgZWFjaCBpbiBpdHMgY29sb3IgKGxpa2UgdGhlXG4vLyAgICAgICAgICAgICAgICAgcHJldmlldyBpbiB0aGUgc2VwYXJhdGUgVFlQLVBpY2tlcilcbi8vICAgZGVzY3JpcHRpb24gLSB0ZXh0IGZpZWxkIHRvIGVkaXQgdGhlIFRZUCBkZXNjcmlwdGlvblxuLy8gICBub25lICAgICAgICAtIG5vdGhpbmcsIHRoZSBuYW1lIGdldHMgdGhlIHdob2xlIHJvd1xuLy8gVGhlIG9yZGVyIGlzIGFsc28gdGhlIGN5Y2xlIG9yZGVyOyB0aGUgZmlyc3QgaXMgdGhlIGRlZmF1bHQ6IHRoZSBTdWJ0eXBzXG4vLyBhcHBlYXIgbm93aGVyZSBlbHNlIGluIHRoZSBsaXN0LCB0aGUgZGVzY3JpcHRpb24gYWxzbyBpbiB0aGUgZGV0YWlsIHZpZXcuXG5jb25zdCBTRUNPTkRBUllfTU9ERVMgPSBbXG4gIHsgbW9kZTogXCJzdWJ0eXBzXCIsIHRpdGxlOiBcIlN1YnR5cCBsaXN0XCIsIGljb246IFwibGlzdC10cmVlXCIgfSxcbiAgeyBtb2RlOiBcImRlc2NyaXB0aW9uXCIsIHRpdGxlOiBcIkRlc2NyaXB0aW9uXCIsIGljb246IFwidGV4dC1jdXJzb3ItaW5wdXRcIiB9LFxuICB7IG1vZGU6IFwibm9uZVwiLCB0aXRsZTogXCJOb3RoaW5nXCIsIGljb246IFwibWludXNcIiB9LFxuXTtcblxuY29uc3QgU09SVF9PUFRJT05TID0gW1xuICAvLyBVbmxpa2UgdGhlIG90aGVycywgXCJtYW51YWxcIiBoYXMgbm8gY29tcGFyaXNvbjogdGhlIG9yZGVyIG9mIHNldHRpbmdzLnR5cHNcbiAgLy8gaXRzZWxmIGlzIHRoZSBzdG9yYWdlIChzZWUgcmVuZGVyKCkgYW5kIHJlbmRlclJlZ2lzdGVyZWRJdGVtKCkgZm9yIHRoZVxuICAvLyBkcmFnICYgZHJvcCByZW5kZXJpbmcgYnVpbHQgb24gaXQpLiBGaXJzdCBvbiBwdXJwb3NlIC0gaXRzIG93biBncm91cCBhdFxuICAvLyB0aGUgdG9wIG9mIHRoZSBtZW51IChzZWUgc2hvd1NvcnRNZW51KS5cbiAgeyBtb2RlOiBcIm1hbnVhbFwiLCB0aXRsZTogXCJNYW51YWwgKGRyYWcgJiBkcm9wKVwiIH0sXG4gIHsgbW9kZTogXCJjb3VudC1kZXNjXCIsIHRpdGxlOiBcIk1vc3Qgbm90ZXMgZmlyc3RcIiB9LFxuICB7IG1vZGU6IFwiY291bnQtYXNjXCIsIHRpdGxlOiBcIkZld2VzdCBub3RlcyBmaXJzdFwiIH0sXG4gIHsgbW9kZTogXCJuYW1lLWFzY1wiLCB0aXRsZTogXCJOYW1lIChBIHRvIFopXCIgfSxcbiAgeyBtb2RlOiBcIm5hbWUtZGVzY1wiLCB0aXRsZTogXCJOYW1lIChaIHRvIEEpXCIgfSxcbiAgeyBtb2RlOiBcImNvbG9yLWFzY1wiLCB0aXRsZTogXCJDb2xvciAocmVkIFx1MjE5MiB2aW9sZXQpXCIgfSxcbiAgeyBtb2RlOiBcImNvbG9yLWRlc2NcIiwgdGl0bGU6IFwiQ29sb3IgKHZpb2xldCBcdTIxOTIgcmVkKVwiIH0sXG5dO1xuXG4vLyBSZXdyaXRlcyB0aGUgVFlQIG9mIGV2ZXJ5IG5vdGUgd2l0aCBrZXkgb2xkS2V5IChzZWUgdHlwS2V5T2YgaW5cbi8vIHR5cC1pbmRleC5qcyAtIHRoZSBUWVAgbmFtZSBmb3IgYSBjbGVhbiB2YWx1ZSwgb3RoZXJ3aXNlIHRoZSByYXcgZm9ybSBsaWtlXG4vLyBcIiBidWNoXCIgb3IgXCJbUEVSU09OLCBCVUNIXVwiKSB0byB0aGUgc2luZ2xlIHZhbHVlIG5ld1ZhbHVlLiBVc2VkIGZvclxuLy8gcmVnaXN0ZXJUeXAoKSAoY2xlYW51cCksIHJlbmFtaW5nIGFuZCBtZXJnaW5nLiBNYXRjaGluZyBpcyBleGFjdCBvbiB0aGUga2V5LFxuLy8gc28gYSBsaXN0IGlzIHJlcGxhY2VkIGFzIGEgd2hvbGUuIEEgZGlmZmVyZW50bHkgc3BlbGxlZCBwcm9wZXJ0eSAoXCJ0eXBcIilcbi8vIGJlY29tZXMgXCJUWVBcIi5cbmFzeW5jIGZ1bmN0aW9uIHJlbmFtZVR5cEluTm90ZXMocGx1Z2luLCBvbGRLZXksIG5ld1ZhbHVlKSB7XG4gIGxldCBjaGFuZ2VkID0gMDtcbiAgZm9yIChjb25zdCBmaWxlIG9mIHBsdWdpbi50eXBJbmRleC5maWxlc1dpdGhUeXAob2xkS2V5KSkge1xuICAgIGxldCBtYXRjaGVkID0gZmFsc2U7XG4gICAgYXdhaXQgcGx1Z2luLmFwcC5maWxlTWFuYWdlci5wcm9jZXNzRnJvbnRNYXR0ZXIoZmlsZSwgKGZyb250bWF0dGVyKSA9PiB7XG4gICAgICBpZiAodHlwS2V5T2YocHJvcGVydHlWYWx1ZShmcm9udG1hdHRlciwgVFlQX1BST1BFUlRZKSkgIT09IG9sZEtleSkgcmV0dXJuO1xuICAgICAgc2V0Q2Fub25pY2FsUHJvcGVydHkoZnJvbnRtYXR0ZXIsIFRZUF9QUk9QRVJUWSwgbmV3VmFsdWUpO1xuICAgICAgbWF0Y2hlZCA9IHRydWU7XG4gICAgfSk7XG4gICAgaWYgKG1hdGNoZWQpIGNoYW5nZWQrKztcbiAgfVxuICByZXR1cm4gY2hhbmdlZDtcbn1cblxuLy8gQ2xlYW5lZCBmb3JtIG9mIGEgcmF3IHZhbHVlIGZvciByZWdpc3RlclR5cCgpOiBhIHNpbmdsZSB2YWx1ZSB0cmltbWVkIGFuZFxuLy8gdXBwZXJjYXNlZDsgYSBsaXN0IGlzIGRlbGliZXJhdGVseSBOT1QgcmVkdWNlZCB0byBvbmUgaXRlbSBidXQgam9pbmVkIGludG9cbi8vIG9uZSB2YWx1ZSBcIkEsIEJcIiAtIHdoaWNoIGEgcmVuYW1lIGNhbiB0aGVuIHR1cm4gaW50byBhbm90aGVyIFRZUCAoc2VlXG4vLyBzdGFydERldGFpbFJlbmFtZS9zaG93TWVyZ2VDb25maXJtKS4gbm9ybWFsaXplIHNwZWxscyB0aGUgc2luZ2xlIG5hbWVzIC1cbi8vIG5vcm1hbGl6ZVN1YnR5cE5hbWUgZm9yIFN1YnR5cHMuXG5mdW5jdGlvbiBub3JtYWxpemVSYXdUeXAocmF3LCBub3JtYWxpemUgPSBub3JtYWxpemVUeXBOYW1lKSB7XG4gIGlmIChBcnJheS5pc0FycmF5KHJhdykpIHtcbiAgICByZXR1cm4gcmF3XG4gICAgICAubWFwKCh2KSA9PiBub3JtYWxpemUoU3RyaW5nKHYgPz8gXCJcIikpKVxuICAgICAgLmZpbHRlcihCb29sZWFuKVxuICAgICAgLmpvaW4oXCIsIFwiKTtcbiAgfVxuICByZXR1cm4gbm9ybWFsaXplKFN0cmluZyhyYXcpKTtcbn1cblxuLy8gV2hlcmUgdHlwaW5nIGhhcHBlbnMgaW4gdGhlIHBhbmU6IHRleHQgZmllbGRzLCBjb250ZW50ZWRpdGFibGUgbmFtZXMgYW5kXG4vLyBPYnNpZGlhbidzIHByb3BlcnR5IGVkaXRvciAoaXRzIHJvd3MgdGhlbXNlbHZlcyBhcmUgZm9jdXMgc3RvcHMgb2YgaXRzXG4vLyBrZXlib2FyZCBuYXZpZ2F0aW9uIC0gVGFiIGZyb20gYSB2YWx1ZSBsYW5kcyBvbiB0aGUgbmV4dCByb3cpLiBUaGUgbmF0aXZlXG4vLyBjb2xvciBwaWNrZXIgZG9lc24ndCBjb3VudDogaXQga2VlcHMgdGhlIGZvY3VzIGFmdGVyIGNsb3NpbmcsIHdoaWNoIHdvdWxkXG4vLyBob2xkIGJhY2sgZXZlcnkgcmVmcmVzaCwgYW5kIGEgcmVmcmVzaCB3aGlsZSBpdCBpcyBvcGVuIG9ubHkgY2xvc2VzIGl0LlxuY29uc3QgRklFTERfU0VMRUNUT1IgPSAnaW5wdXQsIHRleHRhcmVhLCBbY29udGVudGVkaXRhYmxlPVwidHJ1ZVwiXSwgW2NvbnRlbnRlZGl0YWJsZT1cIlwiXSwgLm1ldGFkYXRhLXByb3BlcnR5JztcbmNvbnN0IGlzRmllbGQgPSAoZWwpID0+ICEhZWw/Lm1hdGNoZXM/LihGSUVMRF9TRUxFQ1RPUikgJiYgIWVsLm1hdGNoZXMoJ2lucHV0W3R5cGU9XCJjb2xvclwiXScpO1xuXG4vLyBTaG93cyBhbiB1bnJlZ2lzdGVyZWQga2V5OiBwYWRkaW5nIHdvdWxkIGJlIGludmlzaWJsZSBhcyBwbGFpbiB0ZXh0LCBzbyBpdFxuLy8gZ2V0cyBxdW90ZXMuIExpc3RzIGFscmVhZHkgY2FycnkgdGhlaXIgYnJhY2tldHMgaW4gdGhlIGtleS5cbmZ1bmN0aW9uIGRpc3BsYXlUeXBLZXkodHlwS2V5KSB7XG4gIHJldHVybiB0eXBLZXkgIT09IHR5cEtleS50cmltKCkgPyBgXCIke3R5cEtleX1cImAgOiB0eXBLZXk7XG59XG5cbmNsYXNzIFR5cFBhbmUgZXh0ZW5kcyBJdGVtVmlldyB7XG4gIGNvbnN0cnVjdG9yKGxlYWYsIHBsdWdpbikge1xuICAgIHN1cGVyKGxlYWYpO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICB9XG5cbiAgZ2V0Vmlld1R5cGUoKSB7XG4gICAgcmV0dXJuIFZJRVdfVFlQRV9UWVBfUEFORTtcbiAgfVxuXG4gIGdldERpc3BsYXlUZXh0KCkge1xuICAgIHJldHVybiBcIlRZUFwiO1xuICB9XG5cbiAgZ2V0SWNvbigpIHtcbiAgICByZXR1cm4gXCJzaGFwZXNcIjtcbiAgfVxuXG4gIGFzeW5jIG9uT3BlbigpIHtcbiAgICB0aGlzLmlzRWRpdGluZyA9IGZhbHNlO1xuICAgIHRoaXMuc2VsZWN0ZWRUeXAgPSBudWxsO1xuICAgIHRoaXMuZnJvbnRtYXR0ZXJCbG9ja3MgPSBudWxsO1xuICAgIHRoaXMuZnJvbnRtYXR0ZXJFZGl0b3JzID0gW107XG5cbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIHRoaXMuY29udGVudEVsLmFkZENsYXNzKFwidHlwLXN5c3RlbS1wYW5lXCIpO1xuXG4gICAgLy8gQSByZWZyZXNoIGZyb20gb3V0c2lkZSB0aGF0IHdhaXRlZCBmb3IgYSBmaWVsZCAoc2VlIHJlcXVlc3RSZW5kZXIpIHJ1bnNcbiAgICAvLyBvbmNlIHRoZSBmb2N1cyBoYXMgbGVmdCB0aGUgZmllbGRzIG9mIHRoaXMgcGFuZSAtIGNoZWNrZWQgYSB0aWNrIGxhdGVyLFxuICAgIC8vIHdoZW4gdGhlIGZvY3VzIGhhcyBzZXR0bGVkLiBNb3ZpbmcgZnJvbSBmaWVsZCB0byBmaWVsZCAoVGFiKSBrZWVwc1xuICAgIC8vIHdhaXRpbmcuXG4gICAgdGhpcy5yZWdpc3RlckRvbUV2ZW50KHRoaXMuY29udGVudEVsLCBcImZvY3Vzb3V0XCIsIChldmVudCkgPT4ge1xuICAgICAgaWYgKCF0aGlzLl9yZW5kZXJQZW5kaW5nIHx8IGlzRmllbGQoZXZlbnQucmVsYXRlZFRhcmdldCkpIHJldHVybjtcbiAgICAgIHdpbmRvdy5zZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuX3JlbmRlclBlbmRpbmcgJiYgIXRoaXMuaGFzRmllbGRGb2N1cygpKSB0aGlzLnJlbmRlcigpO1xuICAgICAgfSwgMCk7XG4gICAgfSk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyRG9tRXZlbnQodGhpcy5jb250ZW50RWwsIFwia2V5ZG93blwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRXNjYXBlXCIgJiYgdGhpcy5zZWxlY3RlZFR5cCAhPT0gbnVsbCkgdGhpcy5jbG9zZVR5cFNldHRpbmdzKCk7XG4gICAgfSk7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfVxuXG4gIGFzeW5jIG9uQ2xvc2UoKSB7XG4gICAgdGhpcy5jbG9zZVN1YnR5cENvbG9yUG9wb3Zlcj8uKCk7XG4gIH1cblxuICBvcGVuU2VhcmNoKHR5cCkge1xuICAgIGNvbnN0IGdsb2JhbFNlYXJjaCA9IHRoaXMucGx1Z2luLmFwcC5pbnRlcm5hbFBsdWdpbnMuZ2V0UGx1Z2luQnlJZChcImdsb2JhbC1zZWFyY2hcIik7XG4gICAgaWYgKCFnbG9iYWxTZWFyY2gpIHJldHVybjtcbiAgICAvLyBcIk5vIFRZUFwiIHdpdGhvdXQgYSBmaWx0ZXIgd291bGQgYWxzbyBtYXRjaCBldmVyeSBub24tbWFya2Rvd24gZmlsZSxcbiAgICAvLyB3aGljaCBjYW4ndCBoYXZlIGZyb250bWF0dGVyIC0gaGVuY2UgZmlsZToubWQuXG4gICAgY29uc3QgcXVlcnkgPSB0eXAgPT09IG51bGwgPyBgLVtcIiR7VFlQX1BST1BFUlRZfVwiXSBmaWxlOi5tZGAgOiB0aGlzLnR5cENsYXVzZSh0eXApO1xuICAgIGdsb2JhbFNlYXJjaC5pbnN0YW5jZS5vcGVuR2xvYmFsU2VhcmNoKHF1ZXJ5KTtcbiAgfVxuXG4gIC8vIFNlYXJjaCBjbGF1c2UgZm9yIGEgVFlQIGtleS4gQSBsaXN0ICh1bnJlZ2lzdGVyZWQga2V5IFwiW0EsIEJdXCIpIGhhcyBub1xuICAvLyBleGFjdCBzeW50YXgsIHNvIGl0IHNlYXJjaGVzIG5vdGVzIGNhcnJ5aW5nIGFsbCBpdHMgaXRlbXMuIEFsc28gdXNlZCBieVxuICAvLyBvcGVuU3VidHlwU2VhcmNoKCksIHdoaWNoIGNhbiByZWNlaXZlIGFuIHVucmVnaXN0ZXJlZCAodW5jbGVhbikgVFlQIGtleS5cbiAgdHlwQ2xhdXNlKHR5cCkge1xuICAgIGNvbnN0IHJhdyA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnJhd1ZhbHVlT2YodHlwKTtcbiAgICByZXR1cm4gQXJyYXkuaXNBcnJheShyYXcpXG4gICAgICA/IHJhdy5tYXAoKHYpID0+IGBbXCIke1RZUF9QUk9QRVJUWX1cIjpcIiR7U3RyaW5nKHYgPz8gXCJcIikudHJpbSgpfVwiXWApLmpvaW4oXCIgXCIpXG4gICAgICA6IGBbXCIke1RZUF9QUk9QRVJUWX1cIjpcIiR7dHlwfVwiXWA7XG4gIH1cblxuICAvLyB0eXBLZXkgY29tZXMgc3RyYWlnaHQgZnJvbSBmcm9udG1hdHRlciB2YWx1ZXMgKHNlZSB1bnJlZ2lzdGVyZWRSb3dzIGluXG4gIC8vIHJlbmRlcigpIGFuZCB0eXBLZXlPZikgLSBwb3NzaWJseSBsb3dlcmNhc2UsIHBhZGRlZCBvciBhIGxpc3QuIFRZUCBlbnRyaWVzXG4gIC8vIGFyZSBhbHdheXMgY2xlYW4gdXBwZXJjYXNlIHZhbHVlcywgc28gdGhlIGNsZWFuZWQgZm9ybSBpcyByZWdpc3RlcmVkIChzZWVcbiAgLy8gbm9ybWFsaXplUmF3VHlwKSBhbmQgdGhlIGFmZmVjdGVkIG5vdGVzIGFyZSByZXdyaXR0ZW4gcmlnaHQgYXdheSwgc28gdGhleVxuICAvLyBubyBsb25nZXIgc2hvdyB1cCBhcyB1bnJlZ2lzdGVyZWQuXG4gIGFzeW5jIHJlZ2lzdGVyVHlwKHR5cEtleSkge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuYXBwbHlUeXBSZWdpc3RyYXRpb24odHlwS2V5KTtcbiAgICBpZiAoIXJlc3VsdCkgcmV0dXJuO1xuXG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgICB0aGlzLnJlZnJlc2hPdGhlclZpZXdzKCk7XG5cbiAgICBpZiAocmVzdWx0LnJlbmFtZWQgPiAwKSB7XG4gICAgICBuZXcgTm90aWNlKGBUWVAgJHtyZXN1bHQudHlwfSByZWdpc3RlcmVkLCAke3BsdXJhbChyZXN1bHQucmVuYW1lZCwgXCJub3RlXCIpfSB1cGRhdGVkLmApO1xuICAgIH1cbiAgfVxuXG4gIC8vIFRoZSBjb3JlIG9mIHJlZ2lzdGVyVHlwKCkgd2l0aG91dCBzYXZpbmcsIHJlLXJlbmRlcmluZyBhbmQgbm90aWNlLCBzb1xuICAvLyByZWdpc3RlclR5cFdpdGhTdWJ0eXAoKSBjYW4gcmVnaXN0ZXIgVFlQIGFuZCBTdWJ0eXAgaW4gdHVybiBhbmQgdGhlbiBzYXZlXG4gIC8vIGFuZCBub3RpZnkgT05DRS4gUmV0dXJucyB7IHR5cCwgcmVuYW1lZCB9LCBvciBudWxsIGlmIG5vdGhpbmcgdXNhYmxlIGlzXG4gIC8vIGxlZnQuXG4gIGFzeW5jIGFwcGx5VHlwUmVnaXN0cmF0aW9uKHR5cEtleSkge1xuICAgIGNvbnN0IHJhdyA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnJhd1ZhbHVlT2YodHlwS2V5KTtcbiAgICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplUmF3VHlwKHJhdyA9PT0gdW5kZWZpbmVkID8gdHlwS2V5IDogcmF3KTtcbiAgICBpZiAoIW5vcm1hbGl6ZWQpIHJldHVybiBudWxsO1xuICAgIGlmICghdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwcy5pbmNsdWRlcyhub3JtYWxpemVkKSkge1xuICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwcy5wdXNoKG5vcm1hbGl6ZWQpO1xuICAgIH1cbiAgICBjb25zdCByZW5hbWVkID0gbm9ybWFsaXplZCAhPT0gdHlwS2V5ID8gYXdhaXQgcmVuYW1lVHlwSW5Ob3Rlcyh0aGlzLnBsdWdpbiwgdHlwS2V5LCBub3JtYWxpemVkKSA6IDA7XG4gICAgcmV0dXJuIHsgdHlwOiBub3JtYWxpemVkLCByZW5hbWVkIH07XG4gIH1cblxuICAvLyBDb2xvcnMgYW5kIG1hcmtzIG9mIGV2ZXJ5IG90aGVyIHZpZXcgYWZ0ZXIgYSBjaGFuZ2UgbWFkZSBpbiB0aGlzIHBhbmVcbiAgLy8gKHNlZSByZWZyZXNoVHlwQ29sb3JzRXhjZXB0IGluIG1haW4uanMpLiBUaGlzIHBhbmUgdXBkYXRlcyBpdHNlbGY6IGVpdGhlclxuICAvLyB0aGUgY2hhbmdlIGlzIGFscmVhZHkgdmlzaWJsZSAoYSBwcm9wZXJ0eSBlZGl0KSBvciB0aGUgY2FsbGVyIHJlbmRlcnMuXG4gIHJlZnJlc2hPdGhlclZpZXdzKCkge1xuICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnNFeGNlcHQ/Lih0aGlzKTtcbiAgfVxuXG4gIC8vIEEgbmV3LCBlbXB0eSB0cmVlIGl0ZW0gc3RyYWlnaHQgaW4gZWRpdCBtb2RlIC0gbGlrZSBPYnNpZGlhbidzIG93biB2aWV3c1xuICAvLyAoYSBuZXcgYm9va21hcmsgZ3JvdXAsIHNheSkuXG4gIHN0YXJ0QWRkKCkge1xuICAgIGlmICh0aGlzLmlzRWRpdGluZykgcmV0dXJuO1xuXG4gICAgY29uc3QgdHJlZUl0ZW0gPSB0aGlzLmxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtXCIgfSk7XG4gICAgaWYgKHRoaXMuc2VwYXJhdG9yRWwpIHRoaXMubGlzdEVsLmluc2VydEJlZm9yZSh0cmVlSXRlbSwgdGhpcy5zZXBhcmF0b3JFbCk7XG4gICAgY29uc3Qgc2VsZiA9IHRyZWVJdGVtLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0tc2VsZiBpcy1jbGlja2FibGVcIiB9KTtcbiAgICBjb25zdCBpbm5lciA9IHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1pbm5lclwiIH0pO1xuXG4gICAgdGhpcy5zdGFydElubGluZUVkaXQoaW5uZXIsIHtcbiAgICAgIGNsYXNzRWw6IHNlbGYsXG4gICAgICBvbkZpbmlzaDogYXN5bmMgKGNvbW1pdCwgdGV4dCkgPT4ge1xuICAgICAgICBjb25zdCB2YWx1ZSA9IG5vcm1hbGl6ZVR5cE5hbWUodGV4dCk7XG4gICAgICAgIGlmIChjb21taXQgJiYgdmFsdWUpIHtcbiAgICAgICAgICAvLyBMaWtlIGEgU3VidHlwIHRoYXQgYWxyZWFkeSBleGlzdHMgKHNlZSBzdGFydEFkZFN1YnR5cCk6IHNheSBzb1xuICAgICAgICAgIC8vIGluc3RlYWQgb2YgbGV0dGluZyB0aGUgaW5wdXQgdmFuaXNoIHdpdGhvdXQgYSB3b3JkLlxuICAgICAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwcy5maW5kKCh0KSA9PiB0LnRvTG93ZXJDYXNlKCkgPT09IHZhbHVlLnRvTG93ZXJDYXNlKCkpO1xuICAgICAgICAgIGlmIChleGlzdGluZykge1xuICAgICAgICAgICAgbmV3IE5vdGljZShgVFlQICR7ZXhpc3Rpbmd9IGFscmVhZHkgZXhpc3RzLmApO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBzLnB1c2godmFsdWUpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICB0aGlzLnJlZnJlc2hPdGhlclZpZXdzKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICB9LFxuICAgIH0pO1xuICB9XG5cbiAgLy8gRXZlcnkgaW5saW5lIGlucHV0IG9mIHRoZSBwYW5lIC0gYSBuZXcgVFlQIG9yIFN1YnR5cCwgcmVuYW1pbmcgb25lIGluIHRoZVxuICAvLyBsaXN0LCB0aGUgZGV0YWlsIHRpdGxlIG9yIGEgYmxvY2sgaGVhZGluZyAtIHdvcmtzIHRoZSBzYW1lIHdheSwgbGlrZVxuICAvLyBPYnNpZGlhbidzIHRyZWUgaXRlbXM6IG5vIGV4dHJhIGlucHV0LCB0aGUgdGV4dCBlbGVtZW50IGl0c2VsZiBiZWNvbWVzXG4gIC8vIGNvbnRlbnRlZGl0YWJsZS4gRW50ZXIgY29tbWl0cywgRXNjYXBlIGNhbmNlbHMsIGxlYXZpbmcgdGhlIGZpZWxkIChibHVyKVxuICAvLyBjb21taXRzIHRvby4gb25GaW5pc2goY29tbWl0LCB0ZXh0KSBkb2VzIHRoZSByZXN0OyBpdCBzaG91bGQgZW5kIGluXG4gIC8vIHJlbmRlcigpIG9yIGEgZGlhbG9nIHdob3NlIGNhbGxiYWNrcyByZW5kZXIuXG4gIC8vXG4gIC8vICAgY2xhc3NFbCAgICAgLSBnZXRzIHRoZSBjbGFzc2VzICh0aGUgd2hvbGUgcm93IGluIHRoZSBsaXN0KVxuICAvLyAgIGNsYXNzZXMgICAgIC0gbWFya3MgdGhlIGlucHV0IHN0YXRlIChzdHlsZXMuY3NzLCBtYWtlU2VhcmNoYWJsZSlcbiAgLy8gICBzdG9wQWxsS2V5cyAtIGtlZXBzIGV2ZXJ5IGtleSBmcm9tIHRoZSBzdXJyb3VuZGluZ3MsIG5vdCBvbmx5IEVudGVyIGFuZFxuICAvLyAgICAgICAgICAgICAgICAgRXNjYXBlIChhIGJsb2NrIGhlYWRpbmcgaW5zaWRlIHRoZSBwcm9wZXJ0eSBlZGl0b3JzLFxuICAvLyAgICAgICAgICAgICAgICAgd2hvc2Uga2V5Ym9hcmQgbmF2aWdhdGlvbiB3b3VsZCByZWFjdCB0b28pXG4gIC8vXG4gIC8vIFdoaWxlIHRoZSBpbnB1dCBydW5zLCByZW5kZXIoKSBpcyBkZWZlcnJlZCAoc2VlIHRoZXJlKSAtIGEgcmVidWlsZCB3b3VsZFxuICAvLyByZW1vdmUgdGhlIGVsZW1lbnQsIGFuZCB0aGUgYmx1ciB0aGF0IGZvbGxvd3Mgd291bGQgY29tbWl0IGEgaGFsZi10eXBlZCBvclxuICAvLyBlbXB0eSBuYW1lLlxuICBzdGFydElubGluZUVkaXQoZWwsIHsgY2xhc3NFbCA9IGVsLCBjbGFzc2VzID0gW1wiaXMtYmVpbmctcmVuYW1lZFwiXSwgc3RvcEFsbEtleXMgPSBmYWxzZSwgb25GaW5pc2ggfSkge1xuICAgIGlmICh0aGlzLmlzRWRpdGluZykgcmV0dXJuIGZhbHNlO1xuICAgIHRoaXMuaXNFZGl0aW5nID0gdHJ1ZTtcblxuICAgIGlmIChjbGFzc2VzLmxlbmd0aCA+IDApIGNsYXNzRWwuYWRkQ2xhc3MoLi4uY2xhc3Nlcyk7XG4gICAgZWwuc2V0QXR0cmlidXRlKFwiY29udGVudGVkaXRhYmxlXCIsIFwidHJ1ZVwiKTtcbiAgICBlbC5zZXRBdHRyaWJ1dGUoXCJzcGVsbGNoZWNrXCIsIFwiZmFsc2VcIik7XG4gICAgZWwuZm9jdXMoKTtcblxuICAgIGNvbnN0IHJhbmdlID0gZWwuZG9jLmNyZWF0ZVJhbmdlKCk7XG4gICAgcmFuZ2Uuc2VsZWN0Tm9kZUNvbnRlbnRzKGVsKTtcbiAgICBjb25zdCBzZWxlY3Rpb24gPSBlbC53aW4uZ2V0U2VsZWN0aW9uKCk7XG4gICAgc2VsZWN0aW9uLnJlbW92ZUFsbFJhbmdlcygpO1xuICAgIHNlbGVjdGlvbi5hZGRSYW5nZShyYW5nZSk7XG5cbiAgICBsZXQgZG9uZSA9IGZhbHNlO1xuICAgIGNvbnN0IGZpbmlzaCA9IGFzeW5jIChjb21taXQpID0+IHtcbiAgICAgIGlmIChkb25lKSByZXR1cm47XG4gICAgICBkb25lID0gdHJ1ZTtcbiAgICAgIHRoaXMuaXNFZGl0aW5nID0gZmFsc2U7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBvbkZpbmlzaChjb21taXQsIGVsLnRleHRDb250ZW50ID8/IFwiXCIpO1xuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgLy8gQSByZW5kZXIgcmVxdWVzdGVkIGR1cmluZyB0aGUgaW5wdXQgd2FzIG9ubHkgZGVmZXJyZWQuIG9uRmluaXNoXG4gICAgICAgIC8vIHVzdWFsbHkgcmVuZGVyZWQgYWxyZWFkeSAod2hpY2ggY2xlYXJzIHRoZSBmbGFnKTsgaWYgaXQgbGVmdCB0aGVcbiAgICAgICAgLy8gdmlldyB0byBhIGRpYWxvZywgY2F0Y2ggdXAgbm93LlxuICAgICAgICBpZiAodGhpcy5fcmVuZGVyUGVuZGluZykgdGhpcy5yZW5kZXIoKTtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgZWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoc3RvcEFsbEtleXMpIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgaWYgKGV2ZW50LmtleSA9PT0gXCJFbnRlclwiKSB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICBmaW5pc2godHJ1ZSk7XG4gICAgICB9IGVsc2UgaWYgKGV2ZW50LmtleSA9PT0gXCJFc2NhcGVcIikge1xuICAgICAgICAvLyBzdG9wUHJvcGFnYXRpb24sIG9yIHRoZSBkZXRhaWwgdmlldydzIG93biBFc2NhcGUgaGFuZGxlciAoc2VlXG4gICAgICAgIC8vIG9uT3Blbikgd291bGQgbGVhdmUgaXQgYXMgd2VsbC5cbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgIGZpbmlzaChmYWxzZSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgLy8gQSBibHVyIGJlY2F1c2UgdGhlIGVsZW1lbnQgbGVmdCB0aGUgRE9NICh0aGUgdmlldyBjbG9zZWQsIHNheSkgaXMgbm9cbiAgICAvLyBkZWNpc2lvbiBvZiB0aGUgdXNlcidzIGFuZCBtdXN0IG5vdCBjb21taXQuIENoZWNrZWQgYSBtaWNyb3Rhc2sgbGF0ZXI6XG4gICAgLy8gd2hpbGUgaXQgaXMgYmVpbmcgcmVtb3ZlZCwgdGhlIGVsZW1lbnQgbWF5IHN0aWxsIGNvdW50IGFzIGNvbm5lY3RlZC5cbiAgICBlbC5hZGRFdmVudExpc3RlbmVyKFwiYmx1clwiLCAoKSA9PiBxdWV1ZU1pY3JvdGFzaygoKSA9PiBmaW5pc2goZWwuaXNDb25uZWN0ZWQpKSk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvLyBTd2l0Y2hpbmcgYmV0d2VlbiBsaXN0IGFuZCBkZXRhaWwgdmlldyBzdGFydHMgYXQgdGhlIHRvcDsgZXZlcnkgb3RoZXJcbiAgLy8gcmVuZGVyKCkga2VlcHMgdGhlIHNjcm9sbCBwb3NpdGlvbiAoc2VlIHRoZXJlKS5cbiAgb3BlblR5cFNldHRpbmdzKHR5cCkge1xuICAgIHRoaXMuc2VsZWN0ZWRUeXAgPSB0eXA7XG4gICAgdGhpcy5fcmVzZXRTY3JvbGwgPSB0cnVlO1xuICAgIHRoaXMucmVuZGVyKCk7XG4gIH1cblxuICBjbG9zZVR5cFNldHRpbmdzKCkge1xuICAgIHRoaXMuc2VsZWN0ZWRUeXAgPSBudWxsO1xuICAgIHRoaXMuX3Jlc2V0U2Nyb2xsID0gdHJ1ZTtcbiAgICB0aGlzLnJlbmRlcigpO1xuICB9XG5cbiAgLy8gVGhlIGVkaXRvcnMgYXJlIGNvbXBvbmVudCBjaGlsZHJlbiAoc2VlIG1vdW50RnJvbnRtYXR0ZXJFZGl0b3IpIGFuZCBtdXN0XG4gIC8vIGJlIHVubG9hZGVkIGJlZm9yZSBldmVyeSByZWJ1aWxkIC0gY29udGVudEVsLmVtcHR5KCkgYWxvbmUgd291bGQgcmVtb3ZlIHRoZVxuICAvLyBET00gYnV0IGxlYXZlIGVhY2ggZWRpdG9yJ3MgbWV0YWRhdGFUeXBlTWFuYWdlciBsaXN0ZW5lciBiZWhpbmQuXG4gIC8vIGZyb250bWF0dGVyQmxvY2tzIGNvbnRyb2xzIGFsbCBibG9ja3MgKHVzZWQgYnkgXCJBZGQgVFlQLUZyb250bWF0dGVyXG4gIC8vIHByb3BlcnR5XCIpLCBmcm9udG1hdHRlckVkaXRvcnMgaG9sZHMgZXZlcnkgZWRpdG9yIGluY2wuIFN1YnR5cCBibG9ja3MuXG4gIGRlc3Ryb3lGcm9udG1hdHRlckVkaXRvcigpIHtcbiAgICBmb3IgKGNvbnN0IGVkaXRvciBvZiB0aGlzLmZyb250bWF0dGVyRWRpdG9ycyA/PyBbXSkgdGhpcy5yZW1vdmVDaGlsZChlZGl0b3IpO1xuICAgIHRoaXMuZnJvbnRtYXR0ZXJFZGl0b3JzID0gW107XG4gICAgdGhpcy5mcm9udG1hdHRlckJsb2NrcyA9IG51bGw7XG4gIH1cblxuICAvLyBUaGUgbGlzdCBvZiBUZW1wbGF0ZXIgc2NyaXB0cyBjaGFuZ2VkIChzZWUgcmVnaXN0ZXJUeXBQYW5lKTogb25seSB0aGVcbiAgLy8gc2hvcnRjdXQgYnV0dG9ucyBvZiB0aGUgb3BlbiBlZGl0b3JzIGZvbGxvdyAtIHRoZWlyIFwic2NyaXB0IG5vdCBmb3VuZFwiXG4gIC8vIHdhcm5pbmcgZGVwZW5kcyBvbiBpdC4gTm8gcmVuZGVyKCk6IG5vdGhpbmcgZWxzZSBjaGFuZ2VkLCBhbmQgYSByZWJ1aWxkXG4gIC8vIHdvdWxkIGNvc3QgdGhlIGZvY3VzIG9mIGEgZmllbGQgYmVpbmcgdHlwZWQgaW4uXG4gIHJlZnJlc2hTaG9ydGN1dENvbnRyb2xzKCkge1xuICAgIGZvciAoY29uc3QgZWRpdG9yIG9mIHRoaXMuZnJvbnRtYXR0ZXJFZGl0b3JzID8/IFtdKSB7XG4gICAgICBjb25zdCBzdG9yZSA9IGVkaXRvci5vd25lcj8udHlwU3RvcmU7XG4gICAgICBpZiAoc3RvcmUpIHJlbmRlclNob3J0Y3V0Q29udHJvbHModGhpcywgZWRpdG9yLCBzdG9yZSk7XG4gICAgfVxuICB9XG5cbiAgLy8gRm9jdXMgaW4gb25lIG9mIHRoZSBwYW5lJ3MgZmllbGRzIChzZWUgaXNGaWVsZCkuXG4gIGhhc0ZpZWxkRm9jdXMoKSB7XG4gICAgY29uc3QgYWN0aXZlID0gdGhpcy5jb250ZW50RWwuZG9jLmFjdGl2ZUVsZW1lbnQ7XG4gICAgcmV0dXJuICEhYWN0aXZlICYmIHRoaXMuY29udGVudEVsLmNvbnRhaW5zKGFjdGl2ZSkgJiYgaXNGaWVsZChhY3RpdmUpO1xuICB9XG5cbiAgLy8gQSByZWJ1aWxkIHJlcXVlc3RlZCBmcm9tIG91dHNpZGUgKHJlZ2lzdGVyVHlwUGFuZTogcmVmcmVzaFR5cENvbG9ycygpLCBhblxuICAvLyBpbmRleCBjaGFuZ2UsIFN5bmMsIFVuZG8pLiBXaGlsZSBzb21lb25lIHR5cGVzIGluIHRoaXMgcGFuZSAtIGFcbiAgLy8gZGVzY3JpcHRpb24sIGEgcHJvcGVydHksIGFuIGlubGluZSBuYW1lIC0gaXQgd291bGQgdGhyb3cgdGhlIGZpZWxkIGF3YXlcbiAgLy8gd2l0aCB0ZXh0LCBjdXJzb3IgYW5kIGZvY3VzLCBzbyBpdCB3YWl0cyB1bnRpbCB0aGUgZm9jdXMgbGVhdmVzIHRoZVxuICAvLyBmaWVsZHMgKHNlZSBvbk9wZW4pIG9yIHRoZSBpbmxpbmUgaW5wdXQgZW5kcyAoc2VlIHN0YXJ0SW5saW5lRWRpdCkuIFRoZVxuICAvLyBwYW5lJ3Mgb3duIGFjdGlvbnMgY2FsbCByZW5kZXIoKSBkaXJlY3RseSBhbmQgdGFrZSBlZmZlY3QgYXQgb25jZS5cbiAgcmVxdWVzdFJlbmRlcigpIHtcbiAgICBpZiAodGhpcy5oYXNGaWVsZEZvY3VzKCkpIHtcbiAgICAgIHRoaXMuX3JlbmRlclBlbmRpbmcgPSB0cnVlO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLnJlbmRlcigpO1xuICB9XG5cbiAgcmVuZGVyKCkge1xuICAgIC8vIFJlZW50cmFuY3kgZ3VhcmQ6IGEgcmVuZGVyIHJlYWNoZWQgZnJvbSBpbnNpZGUgcmVuZGVyKCkgbXVzdCBub3RcbiAgICAvLyByZWJ1aWxkIHRoZSBoYWxmLWJ1aWx0IHZpZXcuIEl0IG9uY2UgcmVjdXJzZWQgaW50byBhIHN0YWNrIG92ZXJmbG93IG9uXG4gICAgLy8gZXZlcnkgVFlQIG9wZW5lZCwgd2hlbiByZW5kZXJUeXBTZXR0aW5ncygpIHN0aWxsIGVuZGVkIHdpdGggdGhlIGZ1bGxcbiAgICAvLyByZWZyZXNoVHlwQ29sb3JzKCkgKGl0IG5vdyBjYWxscyBvbmx5IHJlZnJlc2hGcm9udG1hdHRlckhpZ2hsaWdodCkuXG4gICAgaWYgKHRoaXMuX3JlbmRlcmluZykgcmV0dXJuO1xuICAgIC8vIEFuIGlubGluZSBpbnB1dCBpcyBydW5uaW5nIChzZWUgc3RhcnRJbmxpbmVFZGl0KTogYSByZWJ1aWxkIG5vdyB3b3VsZFxuICAgIC8vIHRocm93IGl0IGF3YXkgbWlkLXR5cGluZyAtIGFuZCBjb21taXQgaXQgdGhyb3VnaCB0aGUgYmx1ci4gU28gdGhlIHJlbmRlclxuICAgIC8vIChhbiBpbmRleCBjaGFuZ2UsIGEgcmVmcmVzaCBmcm9tIGVsc2V3aGVyZSkgd2FpdHMgZm9yIHRoZSBpbnB1dCB0byBlbmQuXG4gICAgaWYgKHRoaXMuaXNFZGl0aW5nKSB7XG4gICAgICB0aGlzLl9yZW5kZXJQZW5kaW5nID0gdHJ1ZTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5fcmVuZGVyUGVuZGluZyA9IGZhbHNlO1xuICAgIHRoaXMuX3JlbmRlcmluZyA9IHRydWU7XG4gICAgLy8gVGhlIHJlYnVpbGQga2VlcHMgdGhlIHNjcm9sbCBwb3NpdGlvbiwgc28gYSBsb25nIFRZUCBkb2Vzbid0IGp1bXAgdG8gdGhlXG4gICAgLy8gdG9wIGFmdGVyIGV2ZXJ5IGNoYW5nZTsgb25seSBzd2l0Y2hpbmcgYmV0d2VlbiBsaXN0IGFuZCBkZXRhaWwgdmlld1xuICAgIC8vIHN0YXJ0cyBhdCB0aGUgdG9wIChvcGVuVHlwU2V0dGluZ3MvY2xvc2VUeXBTZXR0aW5ncykuXG4gICAgY29uc3Qgc2Nyb2xsVG9wID0gdGhpcy5fcmVzZXRTY3JvbGwgPyAwIDogdGhpcy5jb250ZW50RWwuc2Nyb2xsVG9wO1xuICAgIHRoaXMuX3Jlc2V0U2Nyb2xsID0gZmFsc2U7XG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuZGVzdHJveUZyb250bWF0dGVyRWRpdG9yKCk7XG4gICAgICBpZiAodGhpcy5zZWxlY3RlZFR5cCAhPT0gbnVsbCkge1xuICAgICAgICB0aGlzLnJlbmRlclR5cFNldHRpbmdzKHRoaXMuc2VsZWN0ZWRUeXApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgICAgY29udGVudEVsLmVtcHR5KCk7XG5cbiAgICAgIGNvbnN0IHsgY291bnRzLCBub1R5cCB9ID0gdGhpcy5wbHVnaW4udHlwSW5kZXgudHlwQ291bnRzKCk7XG4gICAgICBjb25zdCByZWdpc3RlcmVkID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwcztcbiAgICAgIGNvbnN0IHR5cENvbG9ycyA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9ycztcbiAgICAgIGNvbnN0IHNvcnRPcmRlciA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cFNvcnRPcmRlciA/PyBERUZBVUxUX1NPUlRfT1JERVI7XG4gICAgICBjb25zdCBpc01hbnVhbFNvcnQgPSBzb3J0T3JkZXIgPT09IFwibWFudWFsXCI7XG4gICAgICBjb25zdCBieUN1cnJlbnRPcmRlciA9IChhLCBiKSA9PiBjb21wYXJlVHlwcyhzb3J0T3JkZXIsIGEsIGIsIGNvdW50cywgdHlwQ29sb3JzKTtcblxuICAgICAgdGhpcy5yZW5kZXJMaXN0SGVhZGVyKGNvbnRlbnRFbCk7XG5cbiAgICAgIGNvbnN0IHVucmVnaXN0ZXJlZFJvd3MgPSBbLi4uY291bnRzLmtleXMoKV1cbiAgICAgICAgLmZpbHRlcigodHlwKSA9PiAhcmVnaXN0ZXJlZC5pbmNsdWRlcyh0eXApKVxuICAgICAgICAuc29ydChieUN1cnJlbnRPcmRlcilcbiAgICAgICAgLm1hcCgodHlwKSA9PiAoeyB0eXAsIGNvdW50OiBjb3VudHMuZ2V0KHR5cCkgPz8gMCB9KSk7XG4gICAgICBjb25zdCB1bnJlZ2lzdGVyZWRTdWJ0eXBSb3dzID0gdGhpcy51bnJlZ2lzdGVyZWRTdWJ0eXBSb3dzKCk7XG5cbiAgICAgIC8vIFdpdGhvdXQgYSBzZWNvbmQgY29sdW1uIHRoZSBuYW1lIG1heSB0YWtlIHRoZSB3aG9sZSByb3cgKHNlZVxuICAgICAgLy8gLnR5cC1saXN0LW5vLXNlY29uZGFyeSBpbiBzdHlsZXMuY3NzKS5cbiAgICAgIGNvbnN0IGxpc3RDbHMgPSBcInR5cC1saXN0IG5hdi1maWxlcy1jb250YWluZXJcIiArICh0aGlzLnNlY29uZGFyeU1vZGUoKSA9PT0gXCJub25lXCIgPyBcIiB0eXAtbGlzdC1uby1zZWNvbmRhcnlcIiA6IFwiXCIpO1xuICAgICAgdGhpcy5saXN0RWwgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBsaXN0Q2xzIH0pO1xuICAgICAgdGhpcy5zZXBhcmF0b3JFbCA9IG51bGw7XG5cbiAgICAgIC8vIEluIG1hbnVhbCBtb2RlIHNvcnRUeXBzQnlNb2RlKCkga2VlcHMgdGhlIG9yZGVyIG9mIHNldHRpbmdzLnR5cHMsXG4gICAgICAvLyB3aGljaCBkcmFnICYgZHJvcCBpbiByZW5kZXJSZWdpc3RlcmVkSXRlbSgpIHJlYXJyYW5nZXM7IGluZGV4IGlzIHRoZVxuICAgICAgLy8gcG9zaXRpb24gaW4gdGhhdCBvcmRlci5cbiAgICAgIGNvbnN0IHJlZ2lzdGVyZWRPcmRlciA9IHNvcnRUeXBzQnlNb2RlKHJlZ2lzdGVyZWQsIHNvcnRPcmRlciwgY291bnRzLCB0eXBDb2xvcnMpO1xuICAgICAgcmVnaXN0ZXJlZE9yZGVyLmZvckVhY2goKHR5cCwgaW5kZXgpID0+IHtcbiAgICAgICAgdGhpcy5yZW5kZXJSZWdpc3RlcmVkSXRlbSh0eXAsIGNvdW50cy5nZXQodHlwKSA/PyAwLCB7IGRyYWdnYWJsZTogaXNNYW51YWxTb3J0LCBpbmRleCB9KTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBCZWxvdyB0aGUgc2VwYXJhdG9yIHRocmVlIG9wdGlvbmFsIHNlY3Rpb25zOiB1bnJlZ2lzdGVyZWQgVFlQIHZhbHVlcyxcbiAgICAgIC8vIHVucmVnaXN0ZXJlZCBTdWJ0eXBzLCBcIltOTyBUWVBdXCIuIFRoZSBTdWJ0eXBzIGdldCB0aGVpciBvd24gc2VwYXJhdG9yXG4gICAgICAvLyBiZWNhdXNlIHRoZXkgc29ydCBieSBhIGRpZmZlcmVudCBydWxlIChjb3VudCwgbm90IHRoZSBzb3J0IGJ1dHRvbikgLVxuICAgICAgLy8gd2l0aG91dCBhIHZpc2libGUgY3V0IGl0IHdvdWxkIGxvb2sgbGlrZSBicm9rZW4gc29ydGluZy4gXCJbTk8gVFlQXVwiIGlzXG4gICAgICAvLyBubyByZWFsIFRZUCwgdGFrZXMgbm8gcGFydCBpbiBzb3J0aW5nIGFuZCBhbHdheXMgY29tZXMgbGFzdCwgd2l0aG91dCBhXG4gICAgICAvLyB0aGlyZCBsaW5lLlxuICAgICAgLy9cbiAgICAgIC8vIHRoaXMuc2VwYXJhdG9yRWwgc3RheXMgdGhlIEZJUlNUIGxpbmU6IHN0YXJ0QWRkKCkgaW5zZXJ0cyB0aGUgbmV3IGl0ZW1cbiAgICAgIC8vIGJlZm9yZSBpdCwgYW5kIGEgbmV3IFRZUCBiZWxvbmdzIGFmdGVyIHRoZSByZWdpc3RlcmVkIG9uZXMuXG4gICAgICBjb25zdCBzZXBhcmF0b3IgPSAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGVsID0gdGhpcy5saXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zZXBhcmF0b3JcIiB9KTtcbiAgICAgICAgdGhpcy5zZXBhcmF0b3JFbCA9IHRoaXMuc2VwYXJhdG9yRWwgPz8gZWw7XG4gICAgICB9O1xuXG4gICAgICBpZiAodW5yZWdpc3RlcmVkUm93cy5sZW5ndGggPiAwIHx8IHVucmVnaXN0ZXJlZFN1YnR5cFJvd3MubGVuZ3RoID4gMCB8fCBub1R5cCA+IDApIHNlcGFyYXRvcigpO1xuICAgICAgZm9yIChjb25zdCByb3cgb2YgdW5yZWdpc3RlcmVkUm93cykgdGhpcy5yZW5kZXJVbnJlZ2lzdGVyZWRJdGVtKHJvdy50eXAsIHJvdy5jb3VudCk7XG5cbiAgICAgIGlmICh1bnJlZ2lzdGVyZWRTdWJ0eXBSb3dzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgaWYgKHVucmVnaXN0ZXJlZFJvd3MubGVuZ3RoID4gMCkgc2VwYXJhdG9yKCk7XG4gICAgICAgIGZvciAoY29uc3Qgcm93IG9mIHVucmVnaXN0ZXJlZFN1YnR5cFJvd3MpIHRoaXMucmVuZGVyVW5yZWdpc3RlcmVkU3VidHlwSXRlbShyb3cpO1xuICAgICAgfVxuXG4gICAgICBpZiAobm9UeXAgPiAwKSB0aGlzLnJlbmRlck5vVHlwSXRlbShub1R5cCk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuY29udGVudEVsLnNjcm9sbFRvcCA9IHNjcm9sbFRvcDtcbiAgICAgIHRoaXMuX3JlbmRlcmluZyA9IGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIC8vIExpa2UgdGhlIFwiQ2hhbmdlIHNvcnQgb3JkZXJcIiBidXR0b24gaW4gT2JzaWRpYW4ncyB0YWdzIGFuZCBhbGwtcHJvcGVydGllc1xuICAvLyB2aWV3cy5cbiAgcmVuZGVyTGlzdEhlYWRlcihjb250ZW50RWwpIHtcbiAgICBjb25zdCBoZWFkZXIgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcIm5hdi1oZWFkZXJcIiB9KTtcbiAgICBjb25zdCBidXR0b25zQ29udGFpbmVyID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJuYXYtYnV0dG9ucy1jb250YWluZXJcIiB9KTtcblxuICAgIGNvbnN0IGFkZEJ0biA9IGJ1dHRvbnNDb250YWluZXIuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiBuYXYtYWN0aW9uLWJ1dHRvblwiLFxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJBZGQgVFlQXCIgfSxcbiAgICB9KTtcbiAgICBzZXRJY29uKGFkZEJ0biwgXCJwbHVzXCIpO1xuICAgIGFkZEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5zdGFydEFkZCgpKTtcblxuICAgIGNvbnN0IHNvcnRCdG4gPSBidXR0b25zQ29udGFpbmVyLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gbmF2LWFjdGlvbi1idXR0b25cIixcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiQ2hhbmdlIHNvcnQgb3JkZXJcIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24oc29ydEJ0biwgXCJsdWNpZGUtc29ydC1hc2NcIik7XG4gICAgc29ydEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB0aGlzLnNob3dTb3J0TWVudShldmVudCkpO1xuXG4gICAgLy8gU2Vjb25kIGNvbHVtbjogYSBidXR0b24gY3ljbGluZyB0aGUgdGhyZWUgbW9kZXMgcmF0aGVyIHRoYW4gYSBtZW51IC1cbiAgICAvLyB3aXRoIHNvIGZldyBzdGF0ZXMgd2hvc2UgZWZmZWN0IHNob3dzIHJpZ2h0IGJlbG93LCBjbGlja2luZyB0aHJvdWdoIGlzXG4gICAgLy8gZmFzdGVyLiBJY29uIGFuZCB0b29sdGlwIHNob3cgdGhlIGN1cnJlbnQgbW9kZS5cbiAgICBjb25zdCBjdXJyZW50ID0gU0VDT05EQVJZX01PREVTW3RoaXMuc2Vjb25kYXJ5SW5kZXgoKV07XG4gICAgY29uc3Qgc2Vjb25kYXJ5QnRuID0gYnV0dG9uc0NvbnRhaW5lci5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIG5hdi1hY3Rpb24tYnV0dG9uXCIsXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBgTmV4dCB0byBuYW1lOiAke2N1cnJlbnQudGl0bGV9YCB9LFxuICAgIH0pO1xuICAgIHNldEljb24oc2Vjb25kYXJ5QnRuLCBjdXJyZW50Lmljb24pO1xuICAgIHNlY29uZGFyeUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5jeWNsZVNlY29uZGFyeSgpKTtcbiAgfVxuXG4gIC8vIHNldHRpbmdzLnR5cExpc3RTZWNvbmRhcnksIGJ1dCBhbHdheXMgYSB2YWxpZCBtb2RlIC0gb2xkZXIgZGF0YSBtYXkgbGFja1xuICAvLyB0aGUga2V5LCBhbmQgYSBtb2RlIHJlbW92ZWQgbGF0ZXIgc2hvdWxkbid0IGxlYXZlIHRoZSBsaXN0IGVtcHR5LlxuICBzZWNvbmRhcnlNb2RlKCkge1xuICAgIGNvbnN0IG1vZGUgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBMaXN0U2Vjb25kYXJ5O1xuICAgIHJldHVybiBTRUNPTkRBUllfTU9ERVMuc29tZSgoZW50cnkpID0+IGVudHJ5Lm1vZGUgPT09IG1vZGUpID8gbW9kZSA6IERFRkFVTFRfU0VDT05EQVJZO1xuICB9XG5cbiAgc2Vjb25kYXJ5SW5kZXgoKSB7XG4gICAgcmV0dXJuIFNFQ09OREFSWV9NT0RFUy5maW5kSW5kZXgoKGVudHJ5KSA9PiBlbnRyeS5tb2RlID09PSB0aGlzLnNlY29uZGFyeU1vZGUoKSk7XG4gIH1cblxuICBhc3luYyBjeWNsZVNlY29uZGFyeSgpIHtcbiAgICBjb25zdCBuZXh0ID0gU0VDT05EQVJZX01PREVTWyh0aGlzLnNlY29uZGFyeUluZGV4KCkgKyAxKSAlIFNFQ09OREFSWV9NT0RFUy5sZW5ndGhdO1xuICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cExpc3RTZWNvbmRhcnkgPSBuZXh0Lm1vZGU7XG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgLy8gT25seSB0aGlzIGxpc3QgY2hhbmdlcywgc28gbm8gcmVmcmVzaFR5cENvbG9ycygpIGFjcm9zcyBhbGwgdmlld3MuXG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfVxuXG4gIHNob3dTb3J0TWVudShldmVudCkge1xuICAgIGNvbnN0IGN1cnJlbnQgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBTb3J0T3JkZXIgPz8gREVGQVVMVF9TT1JUX09SREVSO1xuICAgIGNvbnN0IG1lbnUgPSBuZXcgTWVudSgpO1xuXG4gICAgY29uc3QgYWRkR3JvdXAgPSAoc3RhcnQsIGVuZCkgPT4ge1xuICAgICAgZm9yIChsZXQgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICAgICAgY29uc3QgeyBtb2RlLCB0aXRsZSB9ID0gU09SVF9PUFRJT05TW2ldO1xuICAgICAgICBtZW51LmFkZEl0ZW0oKGl0ZW0pID0+XG4gICAgICAgICAgaXRlbVxuICAgICAgICAgICAgLnNldFRpdGxlKHRpdGxlKVxuICAgICAgICAgICAgLnNldENoZWNrZWQoY3VycmVudCA9PT0gbW9kZSlcbiAgICAgICAgICAgIC5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwU29ydE9yZGVyID0gbW9kZTtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICAgICAgICB9KVxuICAgICAgICApO1xuICAgICAgfVxuICAgIH07XG5cbiAgICBhZGRHcm91cCgwLCAxKTtcbiAgICBtZW51LmFkZFNlcGFyYXRvcigpO1xuICAgIGFkZEdyb3VwKDEsIDMpO1xuICAgIG1lbnUuYWRkU2VwYXJhdG9yKCk7XG4gICAgYWRkR3JvdXAoMywgNSk7XG4gICAgbWVudS5hZGRTZXBhcmF0b3IoKTtcbiAgICBhZGRHcm91cCg1LCA3KTtcblxuICAgIG1lbnUuc2hvd0F0TW91c2VFdmVudChldmVudCk7XG4gIH1cblxuICByZW5kZXJOb1R5cEl0ZW0oY291bnQpIHtcbiAgICBjb25zdCB0cmVlSXRlbSA9IHRoaXMubGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW1cIiB9KTtcbiAgICBjb25zdCBzZWxmID0gdHJlZUl0ZW0uY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1zZWxmIGlzLWNsaWNrYWJsZSB0eXAtdW5yZWdpc3RlcmVkXCIgfSk7XG4gICAgc2VsZi5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLWlubmVyXCIsIHRleHQ6IFwiW05PIFRZUF1cIiB9KTtcbiAgICB0aGlzLnJlbmRlckNvdW50RmxhaXIoc2VsZiwgY291bnQpO1xuXG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5vcGVuU2VhcmNoKG51bGwpKTtcbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHRoaXMub3BlblNlYXJjaChudWxsKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIENocm9taXVtJ3MgaW5wdXRbdHlwZT1jb2xvcl0gaGFzIGEgbWluaW11bSBzd2F0Y2ggdGhhdCB3b24ndCBzY2FsZSBiZWxvd1xuICAvLyB0ZXh0IHNpemUsIHNvIGl0IGlzIG9ubHkgYW4gaW52aXNpYmxlIHRyaWdnZXIgb3ZlciBhIGZyZWVseSBzY2FsYWJsZSBkb3QuXG4gIC8vIFdpdGhvdXQgYSBjb2xvciB0aGUgZG90IGlzIGEgaG9sbG93IGdyYXkgcmluZyAoc2VlIHBhaW50Q29sb3JEb3QpOyB3aXRoXG4gIC8vIHNob3dSZXNldCAoZGV0YWlsIHZpZXcpIGEgdG9vbHRpcCBuYW1lcyB0aGUgc3RhdGUgYW5kIHRoZSByZXNldCBidXR0b24gaXNcbiAgLy8gZ3JheWVkIG91dC5cbiAgcmVuZGVyQ29sb3JQaWNrZXIocGFyZW50LCB0eXAsIG9uQ2hhbmdlLCB7IHNob3dSZXNldCA9IGZhbHNlIH0gPSB7fSkge1xuICAgIGNvbnN0IGN1cnJlbnRDb2xvciA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdID8/IERFRkFVTFRfVFlQX0NPTE9SO1xuICAgIGNvbnN0IGNvbG9yV3JhcCA9IHBhcmVudC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWNvbG9yLXdyYXBcIiB9KTtcbiAgICBjb25zdCBjb2xvckRvdCA9IGNvbG9yV3JhcC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWNvbG9yLWRvdFwiIH0pO1xuICAgIGxldCByZXNldEJ0biA9IG51bGw7XG4gICAgY29uc3Qgc2hvd1N0YXRlID0gKGNvbG9yLCBpc0RlZmF1bHQpID0+IHtcbiAgICAgIHBhaW50Q29sb3JEb3QoY29sb3JEb3QsIGNvbG9yLCBpc0RlZmF1bHQpO1xuICAgICAgaWYgKCFzaG93UmVzZXQpIHJldHVybjtcbiAgICAgIGNvbG9yV3JhcC5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIGlzRGVmYXVsdCA/IFwiRGVmYXVsdCAobm8gY29sb3IpXCIgOiBcIkNoYW5nZSBjb2xvclwiKTtcbiAgICAgIHJlc2V0QnRuPy50b2dnbGVDbGFzcyhcImlzLWRpc2FibGVkXCIsIGlzRGVmYXVsdCk7XG4gICAgfTtcblxuICAgIGNvbnN0IGNvbG9ySW5wdXQgPSBjb2xvcldyYXAuY3JlYXRlRWwoXCJpbnB1dFwiLCB7IHR5cGU6IFwiY29sb3JcIiwgY2xzOiBcInR5cC1jb2xvci1pbnB1dFwiIH0pO1xuICAgIGNvbG9ySW5wdXQudmFsdWUgPSBjdXJyZW50Q29sb3I7XG5cbiAgICAvLyBcImlucHV0XCIgZmlyZXMgZm9yIGV2ZXJ5IGludGVybWVkaWF0ZSBjb2xvciB3aGlsZSB0aGUgbmF0aXZlIHBpY2tlciBpc1xuICAgIC8vIG9wZW4gLSBvbmx5IGEgbG9jYWwgcHJldmlldyBoZXJlLiBSZWZyZXNoaW5nIHRoZSB2aWV3cyB3b3VsZCByZS1yZW5kZXJcbiAgICAvLyB0aGlzIG9uZSwgcmVtb3ZlIHRoaXMgPGlucHV0IHR5cGU9Y29sb3I+IGFuZCBjbG9zZSB0aGUgbmF0aXZlIHBpY2tlclxuICAgIC8vIGJlZm9yZSBhIGNvbG9yIGNvdWxkIGV2ZW4gYmUgY2hvc2VuLlxuICAgIC8vXG4gICAgLy8gU2F2aW5nIGlzIGJ1bmRsZWQ6IGRhdGEuanNvbiBpcyB3cml0dGVuIG9uY2UgdGhlIHBvaW50ZXIgcmVzdHMgZm9yIGFcbiAgICAvLyBtb21lbnQgKHNhdmVTb29uKSBhbmQgYXQgdGhlIGxhdGVzdCBvbiBcImNoYW5nZVwiLCBub3Qgb24gZXZlcnlcbiAgICAvLyBpbnRlcm1lZGlhdGUgY29sb3IuXG4gICAgLy9cbiAgICAvLyBPbmUgdW5kbyBzbmFwc2hvdCBwZXIgcGlja2VyIHNlc3Npb246IHRha2VuIGJlZm9yZSB0aGUgZmlyc3RcbiAgICAvLyBpbnRlcm1lZGlhdGUgY29sb3IsIG9mZmVyZWQgb25jZSB0aGUgY2hvaWNlIGlzIGNvbmZpcm1lZCAoXCJjaGFuZ2VcIikuXG4gICAgLy8gQ2xlYXJlZCB3aGVuIHRoZSBwaWNrZXIgb3BlbnMsIHNvIGEgc2Vzc2lvbiB0aGF0IGVuZGVkIHdpdGhvdXQgXCJjaGFuZ2VcIlxuICAgIC8vIChiYWNrIHRvIHRoZSBvbGQgY29sb3IsIG9yIGNhbmNlbGxlZCkgbGVhdmVzIG5vIHN0YWxlIHNuYXBzaG90IGJlaGluZC5cbiAgICBjb25zdCBzYXZlU29vbiA9IGRlYm91bmNlKCgpID0+IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpLCA0MDAsIHRydWUpO1xuICAgIGxldCB1bmRvU25hcHNob3QgPSBudWxsO1xuICAgIGNvbG9ySW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChldmVudCkgPT4ge1xuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICB1bmRvU25hcHNob3QgPSBudWxsO1xuICAgIH0pO1xuICAgIGNvbG9ySW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImlucHV0XCIsICgpID0+IHtcbiAgICAgIHVuZG9TbmFwc2hvdCA/Pz0gc25hcHNob3RTZXR0aW5ncyh0aGlzLnBsdWdpbik7XG4gICAgICBzaG93U3RhdGUoY29sb3JJbnB1dC52YWx1ZSwgZmFsc2UpO1xuICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPSBjb2xvcklucHV0LnZhbHVlO1xuICAgICAgb25DaGFuZ2U/Lihjb2xvcklucHV0LnZhbHVlKTtcbiAgICAgIHNhdmVTb29uKCk7XG4gICAgfSk7XG5cbiAgICAvLyBPbmNlIHRoZSBjaG9pY2UgaXMgY29uZmlybWVkIGFuZCB0aGUgcGlja2VyIGNsb3NlZCwgYSByZS1yZW5kZXIgY2FuJ3RcbiAgICAvLyBicmVhayBhbnl0aGluZyBhbnkgbW9yZS4gVGhlIHBlbmRpbmcgc2F2ZSBpcyBkb25lIHJpZ2h0IGhlcmUgaW5zdGVhZCAtXG4gICAgLy8gYmVmb3JlIG9mZmVyVW5kbygpLCB3aGljaCByZWNvcmRzIHRoZSBzZXR0aW5ncyByZXZpc2lvbiBvZiB0aGlzIHNhdmVcbiAgICAvLyAoYSBsYXRlciBkZWJvdW5jZWQgc2F2ZSB3b3VsZCB2b2lkIHRoZSB1bmRvIGF0IG9uY2UpLlxuICAgIGNvbG9ySW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCBhc3luYyAoKSA9PiB7XG4gICAgICBzYXZlU29vbi5jYW5jZWwoKTtcbiAgICAgIGNvbnN0IHNuYXBzaG90ID0gdW5kb1NuYXBzaG90O1xuICAgICAgdW5kb1NuYXBzaG90ID0gbnVsbDtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgaWYgKHNuYXBzaG90ICYmIHNuYXBzaG90LnR5cENvbG9yc1t0eXBdICE9PSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdHlwXSkge1xuICAgICAgICBvZmZlclVuZG8odGhpcy5wbHVnaW4sIGBDb2xvciBvZiAke3R5cH0gY2hhbmdlZC5gLCBzbmFwc2hvdCk7XG4gICAgICB9XG4gICAgICB0aGlzLnJlZnJlc2hPdGhlclZpZXdzKCk7XG4gICAgICAvLyBUaGUgU3VidHlwIGNvbG9ycyAobGlzdCBwcmV2aWV3LCBibG9jayBkb3RzKSBkZXJpdmUgZnJvbSB0aGlzIGNvbG9yLlxuICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICB9KTtcblxuICAgIGlmIChzaG93UmVzZXQpIHtcbiAgICAgIHJlc2V0QnRuID0gcGFyZW50LmNyZWF0ZURpdih7XG4gICAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtY29sb3ItcmVzZXRcIixcbiAgICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJSZXNldCBjb2xvclwiIH0sXG4gICAgICB9KTtcbiAgICAgIHNldEljb24ocmVzZXRCdG4sIFwicm90YXRlLWNjd1wiKTtcbiAgICAgIHJlc2V0QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIC8vIE5vIHVuZG8gb2ZmZXIgZm9yIGEgbm8tb3AgKHRoZSBidXR0b24gaXMgb25seSBncmF5ZWQgb3V0KS5cbiAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdID09PSB1bmRlZmluZWQpIHJldHVybjtcbiAgICAgICAgY29uc3Qgc25hcHNob3QgPSBzbmFwc2hvdFNldHRpbmdzKHRoaXMucGx1Z2luKTtcbiAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdO1xuICAgICAgICBjb2xvcklucHV0LnZhbHVlID0gREVGQVVMVF9UWVBfQ09MT1I7XG4gICAgICAgIHNob3dTdGF0ZShERUZBVUxUX1RZUF9DT0xPUiwgdHJ1ZSk7XG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICBvZmZlclVuZG8odGhpcy5wbHVnaW4sIGBDb2xvciBvZiAke3R5cH0gcmVzZXQuYCwgc25hcHNob3QpO1xuICAgICAgICBvbkNoYW5nZT8uKERFRkFVTFRfVFlQX0NPTE9SKTtcbiAgICAgICAgdGhpcy5yZWZyZXNoT3RoZXJWaWV3cygpO1xuICAgICAgICB0aGlzLnJlbmRlcigpO1xuICAgICAgfSk7XG4gICAgfVxuICAgIHNob3dTdGF0ZShjdXJyZW50Q29sb3IsIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdID09PSB1bmRlZmluZWQpO1xuXG4gICAgcmV0dXJuIGNvbG9yV3JhcDtcbiAgfVxuXG4gIC8vIEd1YXJkcyBzZXR0aW5ncyBvYmplY3RzIGxvYWRlZCBiZWZvcmUgdHlwTWFudWFsIGV4aXN0ZWQgKGEgcnVubmluZ1xuICAvLyBzZXNzaW9uIGFjcm9zcyBhIGhvdCByZWxvYWQsIHNheSkgLSBvdGhlcndpc2UgZXZlcnkgYWNjZXNzIGJlbG93IHdvdWxkXG4gIC8vIHRocm93IGFuZCB0YWtlIHRoZSByZXN0IG9mIHJlbmRlclR5cFNldHRpbmdzKCkgZG93biB3aXRoIGl0LlxuICBlbnN1cmVUeXBNYW51YWwoKSB7XG4gICAgaWYgKCF0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBNYW51YWwpIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cE1hbnVhbCA9IHt9O1xuICAgIHJldHVybiB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBNYW51YWw7XG4gIH1cblxuICAvLyBUaGUgc2hhcmVkIFwiTWFudWFsbHkgY3JlYXRhYmxlXCIgYnV0dG9uIG9mIFRZUCAocmVuZGVyTWFudWFsVG9nZ2xlKSBhbmRcbiAgLy8gU3VidHlwIChyZW5kZXJTdWJ0eXBNYW51YWxUb2dnbGUpLCBlYWNoIGJldHdlZW4gcmVuYW1lIGFuZCBkZWxldGUuIEFuXG4gIC8vIGljb24gYnV0dG9uIHJhdGhlciB0aGFuIGEgbGFiZWxlZCB0b2dnbGUgLSB0b28gc21hbGwgYSBzZXR0aW5nIGZvciBpdHMgb3duXG4gIC8vIHJvdy4gU3RhdGUgdmlhIGEgY2xhc3MgKGlzLWFjdGl2ZSwgc2VlIHN0eWxlcy5jc3MpLCBtZWFuaW5nIGluIHRoZSB0b29sdGlwO1xuICAvLyByb2xlL2FyaWEtY2hlY2tlZCBrZWVwIGl0IHJlYWRhYmxlIGFzIGEgc3dpdGNoLlxuICAvL1xuICAvLyBvblRvZ2dsZSBnZXRzIHRoZSBuZXcgc3RhdGUsIHNhdmVzIGl0IGFuZCB1cGRhdGVzIHRoZSBkZXBlbmRlbnQgYnV0dG9uc1xuICAvLyAoc2VlIHN5bmNNYW51YWxUb2dnbGVzKSAtIHRoZSBjbGljayBkb2Vzbid0IHBhaW50IGl0c2VsZiwgc2luY2UgYSB0b2dnbGVcbiAgLy8gaGVyZSBuZXZlciBhZmZlY3RzIGp1c3QgdGhpcyBvbmUgYnV0dG9uLlxuICByZW5kZXJNYW51YWxJY29uKHBhcmVudCwgY2xzLCBpc09uLCBvblRvZ2dsZSkge1xuICAgIGNvbnN0IGJ0biA9IHBhcmVudC5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBgY2xpY2thYmxlLWljb24gdHlwLW1hbnVhbC1pY29uICR7Y2xzfWAsXG4gICAgICBhdHRyOiB7IHRhYmluZGV4OiBcIjBcIiwgcm9sZTogXCJjaGVja2JveFwiIH0sXG4gICAgfSk7XG4gICAgc2V0SWNvbihidG4sIFwiZmlsZS1wZW4tbGluZVwiKTtcblxuICAgIGJ0bi50eXBTaG93TWFudWFsU3RhdGUgPSAob24pID0+IHtcbiAgICAgIGJ0bi50b2dnbGVDbGFzcyhcImlzLWFjdGl2ZVwiLCBvbik7XG4gICAgICBidG4uc2V0QXR0cmlidXRlKFwiYXJpYS1jaGVja2VkXCIsIFN0cmluZyhvbikpO1xuICAgICAgYnRuLnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgb24gPyBcIk1hbnVhbGx5IGNyZWF0YWJsZVwiIDogXCJOb3QgbWFudWFsbHkgY3JlYXRhYmxlXCIpO1xuICAgIH07XG4gICAgYnRuLnR5cFNob3dNYW51YWxTdGF0ZShpc09uKTtcblxuICAgIGNvbnN0IHRvZ2dsZSA9ICgpID0+IG9uVG9nZ2xlKCFidG4uaGFzQ2xhc3MoXCJpcy1hY3RpdmVcIikpO1xuICAgIGJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgdG9nZ2xlKTtcbiAgICBidG4uYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVudGVyXCIgfHwgZXZlbnQua2V5ID09PSBcIiBcIikge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICB0b2dnbGUoKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiBidG47XG4gIH1cblxuICAvLyBUaGUgVFlQJ3MgXCJNYW51YWxseSBjcmVhdGFibGVcIiwgaW4gdGhlIGRldGFpbCBoZWFkZXIgYmV0d2VlbiByZW5hbWUgYW5kXG4gIC8vIGRlbGV0ZS4gT24gYnkgZGVmYXVsdCwgc28gb25seSBcIm9mZlwiIChmYWxzZSkgaXMgc3RvcmVkLiBEZWNpZGVzIHdoZXRoZXJcbiAgLy8gZ2V0VHlwcygpIChtYWluLmpzKSByZXR1cm5zIHRoZSBUWVAuXG4gIC8vXG4gIC8vIFRoZSBUWVAgYWx3YXlzIHRha2VzIGl0cyBTdWJ0eXBzIGFsb25nOiB0aGUgcGlja2VyIG9ubHkgcmVhY2hlcyB0aGVtXG4gIC8vIHRocm91Z2ggaXQsIHNvIGEgVFlQIHN3aXRjaGVkIG9mZiB3b3VsZCBzaWxlbnRseSBtYWtlIHRoZW0gdW5yZWFjaGFibGVcbiAgLy8gKHNlZSBzZXRBbGxTdWJ0eXBzTWFudWFsIGluIHN1YnR5cHMuanMpLlxuICByZW5kZXJNYW51YWxUb2dnbGUocGFyZW50LCB0eXApIHtcbiAgICByZXR1cm4gdGhpcy5yZW5kZXJNYW51YWxJY29uKHBhcmVudCwgXCJ0eXAtbWFudWFsLXR5cFwiLCB0aGlzLmVuc3VyZVR5cE1hbnVhbCgpW3R5cF0gIT09IGZhbHNlLCBhc3luYyAob24pID0+IHtcbiAgICAgIGlmIChvbikgZGVsZXRlIHRoaXMuZW5zdXJlVHlwTWFudWFsKClbdHlwXTtcbiAgICAgIGVsc2UgdGhpcy5lbnN1cmVUeXBNYW51YWwoKVt0eXBdID0gZmFsc2U7XG4gICAgICBzZXRBbGxTdWJ0eXBzTWFudWFsKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIG9uKTtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgdGhpcy5zeW5jTWFudWFsVG9nZ2xlcyh0eXApO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gQSBTdWJ0eXAncyBcIk1hbnVhbGx5IGNyZWF0YWJsZVwiLCBpbiBpdHMgYmxvY2sgZm9vdGVyIGJldHdlZW4gcmVuYW1lIGFuZFxuICAvLyBkZWxldGUgKHNlZSByZW5kZXJTZWN0aW9uRm9vdGVyKS4gVW5saWtlIHRoZSBUWVAgYnV0dG9uIGl0IHB1bGxzIG9ubHkgb25lXG4gIC8vIHdheTogc3dpdGNoaW5nIGEgU3VidHlwIG9uIGFsc28gc3dpdGNoZXMgaXRzIFRZUCBvbiAoZWxzZSBpdCB3b3VsZCBiZVxuICAvLyB1bnJlYWNoYWJsZSksIHRoZSBvdGhlciBTdWJ0eXBzIHN0YXkgYXMgdGhleSBhcmUgLSB0aGF0IGlzIHRoZSBwb2ludC5cbiAgcmVuZGVyU3VidHlwTWFudWFsVG9nZ2xlKHBhcmVudCwgdHlwLCBzdWJ0eXApIHtcbiAgICBjb25zdCBidG4gPSB0aGlzLnJlbmRlck1hbnVhbEljb24oXG4gICAgICBwYXJlbnQsXG4gICAgICBcInR5cC1tYW51YWwtc3VidHlwXCIsXG4gICAgICBpc1N1YnR5cE1hbnVhbCh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApLFxuICAgICAgYXN5bmMgKG9uKSA9PiB7XG4gICAgICAgIHNldFN1YnR5cE1hbnVhbCh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXAsIG9uKTtcbiAgICAgICAgaWYgKG9uKSBkZWxldGUgdGhpcy5lbnN1cmVUeXBNYW51YWwoKVt0eXBdO1xuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgdGhpcy5zeW5jTWFudWFsVG9nZ2xlcyh0eXApO1xuICAgICAgfVxuICAgICk7XG4gICAgYnRuLnR5cFN1YnR5cCA9IHN1YnR5cDtcbiAgICByZXR1cm4gYnRuO1xuICB9XG5cbiAgLy8gUmVwYWludHMgZXZlcnkgbWFudWFsIGJ1dHRvbiBvZiB0aGUgZGV0YWlsIHZpZXcgYWZ0ZXIgb25lIGNoYW5nZWQgdGhlXG4gIC8vIG90aGVycy4gT25seSB0aGUgYnV0dG9ucywgbm90IHJlbmRlcigpOiBhIHJlYnVpbGQgd291bGQgcmVjcmVhdGUgZXZlcnlcbiAgLy8gYmxvY2sncyBlZGl0b3JzLCBpbmNsdWRpbmcgYSByb3cgYmVpbmcgZWRpdGVkLiBGb3VuZCB2aWEgdGhlIERPTSBsaWtlIHRoZVxuICAvLyBTdWJ0eXAgY29sb3IgZG90cyAtIGZyb250bWF0dGVyLWJsb2Nrcy5qcyBidWlsZHMgdGhlIGZvb3RlcnMsIG5vIGxpc3Qgb2ZcbiAgLy8gdGhlbSBsaXZlcyBoZXJlLlxuICBzeW5jTWFudWFsVG9nZ2xlcyh0eXApIHtcbiAgICB0aGlzLmNvbnRlbnRFbC5xdWVyeVNlbGVjdG9yKFwiLnR5cC1tYW51YWwtdHlwXCIpPy50eXBTaG93TWFudWFsU3RhdGUodGhpcy5lbnN1cmVUeXBNYW51YWwoKVt0eXBdICE9PSBmYWxzZSk7XG4gICAgZm9yIChjb25zdCBlbCBvZiB0aGlzLmNvbnRlbnRFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLnR5cC1tYW51YWwtc3VidHlwXCIpKSB7XG4gICAgICBlbC50eXBTaG93TWFudWFsU3RhdGUoaXNTdWJ0eXBNYW51YWwodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgZWwudHlwU3VidHlwKSk7XG4gICAgfVxuICB9XG5cbiAgcmVuZGVyUmVnaXN0ZXJlZEl0ZW0odHlwLCBjb3VudCwgeyBkcmFnZ2FibGUgPSBmYWxzZSwgaW5kZXggPSAtMSB9ID0ge30pIHtcbiAgICBjb25zdCB0cmVlSXRlbSA9IHRoaXMubGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW1cIiB9KTtcbiAgICBjb25zdCBzZWxmID0gdHJlZUl0ZW0uY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1zZWxmIGlzLWNsaWNrYWJsZVwiIH0pO1xuXG4gICAgbGV0IG5hbWVFbDtcbiAgICB0aGlzLnJlbmRlckNvbG9yUGlja2VyKHNlbGYsIHR5cCwgKG5ld0NvbG9yKSA9PiB7XG4gICAgICBpZiAobmFtZUVsICYmIHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdCkgbmFtZUVsLnN0eWxlLmNvbG9yID0gbmV3Q29sb3I7XG4gICAgfSk7XG5cbiAgICBuYW1lRWwgPSBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0taW5uZXJcIiwgdGV4dDogdHlwIH0pO1xuICAgIGNvbnN0IGNvbG9yID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0ID8gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gOiBudWxsO1xuICAgIGlmIChjb2xvcikgbmFtZUVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG5cbiAgICAvLyBTZWNvbmQgY29sdW1uLCBjeWNsZWQgYnkgdGhlIGhlYWRlciBidXR0b24gKHNlZSBTRUNPTkRBUllfTU9ERVMpLlxuICAgIGNvbnN0IHNlY29uZGFyeSA9IHRoaXMuc2Vjb25kYXJ5TW9kZSgpO1xuICAgIGlmIChzZWNvbmRhcnkgPT09IFwiZGVzY3JpcHRpb25cIikgdGhpcy5yZW5kZXJEZXNjcmlwdGlvbklucHV0KHNlbGYsIHR5cCk7XG4gICAgZWxzZSBpZiAoc2Vjb25kYXJ5ID09PSBcInN1YnR5cHNcIikgdGhpcy5yZW5kZXJTdWJ0eXBQcmV2aWV3KHNlbGYsIHR5cCk7XG5cbiAgICB0aGlzLnJlbmRlckNvdW50RmxhaXIoc2VsZiwgY291bnQpO1xuXG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgaWYgKHRoaXMuaXNFZGl0aW5nKSByZXR1cm47XG4gICAgICB0aGlzLm9wZW5UeXBTZXR0aW5ncyh0eXApO1xuICAgIH0pO1xuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNvbnRleHRtZW51XCIsIChldmVudCkgPT4ge1xuICAgICAgLy8gV2hpbGUgcmVuYW1pbmcsIHRoZSB0ZXh0IGZpZWxkJ3Mgb3duIG1lbnUgKGNvcHksIHBhc3RlKSBhcHBsaWVzLlxuICAgICAgaWYgKHRoaXMuaXNFZGl0aW5nKSByZXR1cm47XG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICB0aGlzLnNob3dUeXBNZW51KGV2ZW50LCB0eXAsIHNlbGYsIG5hbWVFbCk7XG4gICAgfSk7XG5cbiAgICAvLyBPbmx5IGluIG1hbnVhbCBzb3J0IG1vZGUgKHNlZSByZW5kZXIoKSk6IHRoZSB3aG9sZSByb3cgY2FuIGJlIGRyYWdnZWRcbiAgICAvLyAoYSBkcmFnIHN0YXJ0aW5nIG9uIHRoZSBkb3Qgb3IgaW4gdGhlIGRlc2NyaXB0aW9uIGZpZWxkIGRvZXNuJ3QgY291bnQgLVxuICAgIC8vIHRob3NlIHRha2UgdGhlIG1vdXNlZG93biB0aGVtc2VsdmVzKS4gTW92ZXMgZW50cmllcyBpbiBzZXR0aW5ncy50eXBzLFxuICAgIC8vIHRoZSBsaXN0IHRoYXQgaXMgdGhlIGRpc3BsYXkgb3JkZXIgaW4gbWFudWFsIG1vZGUuXG4gICAgaWYgKGRyYWdnYWJsZSkge1xuICAgICAgc2VsZi5kcmFnZ2FibGUgPSB0cnVlO1xuICAgICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ3N0YXJ0XCIsIChldmVudCkgPT4ge1xuICAgICAgICBldmVudC5kYXRhVHJhbnNmZXIuZWZmZWN0QWxsb3dlZCA9IFwibW92ZVwiO1xuICAgICAgICBldmVudC5kYXRhVHJhbnNmZXIuc2V0RGF0YShcInRleHQvcGxhaW5cIiwgU3RyaW5nKGluZGV4KSk7XG4gICAgICAgIHNlbGYuY2xhc3NMaXN0LmFkZChcImlzLWRyYWdnaW5nXCIpO1xuICAgICAgfSk7XG4gICAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnZW5kXCIsICgpID0+IHNlbGYuY2xhc3NMaXN0LnJlbW92ZShcImlzLWRyYWdnaW5nXCIpKTtcbiAgICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdvdmVyXCIsIChldmVudCkgPT4ge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBjb25zdCByZWN0ID0gc2VsZi5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgICAgY29uc3QgaXNBZnRlciA9IGV2ZW50LmNsaWVudFkgLSByZWN0LnRvcCA+IHJlY3QuaGVpZ2h0IC8gMjtcbiAgICAgICAgc2VsZi5jbGFzc0xpc3QudG9nZ2xlKFwiaXMtZHJvcC1iZWZvcmVcIiwgIWlzQWZ0ZXIpO1xuICAgICAgICBzZWxmLmNsYXNzTGlzdC50b2dnbGUoXCJpcy1kcm9wLWFmdGVyXCIsIGlzQWZ0ZXIpO1xuICAgICAgfSk7XG4gICAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnbGVhdmVcIiwgKCkgPT4gc2VsZi5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJvcC1iZWZvcmVcIiwgXCJpcy1kcm9wLWFmdGVyXCIpKTtcbiAgICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImRyb3BcIiwgYXN5bmMgKGV2ZW50KSA9PiB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGNvbnN0IGlzQWZ0ZXIgPSBzZWxmLmNsYXNzTGlzdC5jb250YWlucyhcImlzLWRyb3AtYWZ0ZXJcIik7XG4gICAgICAgIHNlbGYuY2xhc3NMaXN0LnJlbW92ZShcImlzLWRyb3AtYmVmb3JlXCIsIFwiaXMtZHJvcC1hZnRlclwiKTtcblxuICAgICAgICBjb25zdCBmcm9tSW5kZXggPSBOdW1iZXIoZXZlbnQuZGF0YVRyYW5zZmVyLmdldERhdGEoXCJ0ZXh0L3BsYWluXCIpKTtcbiAgICAgICAgaWYgKE51bWJlci5pc05hTihmcm9tSW5kZXgpIHx8IGZyb21JbmRleCA9PT0gaW5kZXgpIHJldHVybjtcblxuICAgICAgICBsZXQgaW5zZXJ0QmVmb3JlID0gaXNBZnRlciA/IGluZGV4ICsgMSA6IGluZGV4O1xuICAgICAgICBpZiAoZnJvbUluZGV4IDwgaW5zZXJ0QmVmb3JlKSBpbnNlcnRCZWZvcmUgLT0gMTtcblxuICAgICAgICBjb25zdCB0eXBzID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwcztcbiAgICAgICAgY29uc3QgW21vdmVkXSA9IHR5cHMuc3BsaWNlKGZyb21JbmRleCwgMSk7XG4gICAgICAgIHR5cHMuc3BsaWNlKGluc2VydEJlZm9yZSwgMCwgbW92ZWQpO1xuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8vIFJpZ2h0LWNsaWNrIG9uIGEgcmVnaXN0ZXJlZCBUWVA6IHRoZSBhY3Rpb25zIG9mIHRoZSBkZXRhaWwgaGVhZGVyIHBsdXNcbiAgLy8gc2VhcmNoLCBCYXNlIGFuZCBzb3J0aW5nLCB3aXRob3V0IG9wZW5pbmcgdGhlIGRldGFpbCB2aWV3LiBcIk1hbnVhbGx5XG4gIC8vIGNyZWF0YWJsZVwiIHN0YXlzIGluIHRoZSBkZXRhaWwgdmlldyAtIGEgc3RhdGUsIG5vdCBhbiBhY3Rpb24uIFRoZSByb3dzXG4gIC8vIGJlbG93IHRoZSBzZXBhcmF0b3Iga2VlcCByaWdodC1jbGljayA9IHNlYXJjaDogdGhleSBoYXZlIG5vIHNldHRpbmdzIHRvXG4gIC8vIGFjdCBvbi5cbiAgc2hvd1R5cE1lbnUoZXZlbnQsIHR5cCwgc2VsZiwgbmFtZUVsKSB7XG4gICAgY29uc3QgbWVudSA9IG5ldyBNZW51KCk7XG4gICAgbWVudS5hZGRJdGVtKChpdGVtKSA9PiBpdGVtLnNldFRpdGxlKFwiU2VhcmNoIG5vdGVzXCIpLnNldEljb24oXCJzZWFyY2hcIikub25DbGljaygoKSA9PiB0aGlzLm9wZW5TZWFyY2godHlwKSkpO1xuICAgIG1lbnUuYWRkU2VwYXJhdG9yKCk7XG4gICAgbWVudS5hZGRJdGVtKChpdGVtKSA9PlxuICAgICAgaXRlbVxuICAgICAgICAuc2V0VGl0bGUoXCJSZW5hbWVcIilcbiAgICAgICAgLnNldEljb24oXCJwZW5jaWxcIilcbiAgICAgICAgLm9uQ2xpY2soKCkgPT4gdGhpcy5zdGFydExpc3RSZW5hbWUodHlwLCBzZWxmLCBuYW1lRWwpKVxuICAgICk7XG4gICAgbWVudS5hZGRJdGVtKChpdGVtKSA9PlxuICAgICAgaXRlbVxuICAgICAgICAuc2V0VGl0bGUoXCJSZW5hbWUgYW5kIHVwZGF0ZSBub3Rlc1wiKVxuICAgICAgICAuc2V0SWNvbihcInBlbmNpbFwiKVxuICAgICAgICAub25DbGljaygoKSA9PiB0aGlzLnN0YXJ0TGlzdFJlbmFtZSh0eXAsIHNlbGYsIG5hbWVFbCwgeyB1cGRhdGVOb3RlczogdHJ1ZSB9KSlcbiAgICApO1xuICAgIG1lbnUuYWRkSXRlbSgoaXRlbSkgPT5cbiAgICAgIGl0ZW1cbiAgICAgICAgLnNldFRpdGxlKFwiRGVsZXRlXCIpXG4gICAgICAgIC5zZXRJY29uKFwidHJhc2hcIilcbiAgICAgICAgLnNldFdhcm5pbmcodHJ1ZSlcbiAgICAgICAgLm9uQ2xpY2soKCkgPT4gdGhpcy5zaG93RGVsZXRlQ29uZmlybSh0eXApKVxuICAgICk7XG4gICAgbWVudS5hZGRTZXBhcmF0b3IoKTtcbiAgICAvLyBMaWtlIHRoZSBjb21tYW5kOiB3aXRob3V0IHRoZSBCYXNlcyBjb3JlIHBsdWdpbiB0aGUgZmlsZSBjb3VsZG4ndCBiZVxuICAgIC8vIG9wZW5lZC5cbiAgICBpZiAoaXNCYXNlc0VuYWJsZWQodGhpcy5hcHApKSB7XG4gICAgICBtZW51LmFkZEl0ZW0oKGl0ZW0pID0+XG4gICAgICAgIGl0ZW1cbiAgICAgICAgICAuc2V0VGl0bGUoXCJDcmVhdGUgQmFzZVwiKVxuICAgICAgICAgIC5zZXRJY29uKFwidGFibGVcIilcbiAgICAgICAgICAub25DbGljayhydW5PclJlcG9ydEVycm9yKFwiQ3JlYXRlIEJhc2VcIiwgKCkgPT4gY3JlYXRlQmFzZUZvcih0aGlzLnBsdWdpbiwgeyB0eXAsIHN1YnR5cDogbnVsbCB9KSkpXG4gICAgICApO1xuICAgIH1cbiAgICBtZW51LmFkZEl0ZW0oKGl0ZW0pID0+XG4gICAgICBpdGVtXG4gICAgICAgIC5zZXRUaXRsZShcIlNvcnQgZnJvbnRtYXR0ZXIgZm9yIHRoaXMgVFlQXCIpXG4gICAgICAgIC5zZXRJY29uKFwiYXJyb3ctZG93bi11cFwiKVxuICAgICAgICAub25DbGljayhydW5PclJlcG9ydEVycm9yKFwiRnJvbnRtYXR0ZXIgc29ydGluZ1wiLCAoKSA9PiBzb3J0VHlwRnJvbnRtYXR0ZXIodGhpcy5wbHVnaW4sIHR5cCkpKVxuICAgICk7XG4gICAgbWVudS5zaG93QXRNb3VzZUV2ZW50KGV2ZW50KTtcbiAgfVxuXG4gIC8vIEEgcmVhbCBpbnB1dCwgc28gdGhlIGRlc2NyaXB0aW9uIGNhbiBiZSBlZGl0ZWQgcmlnaHQgaW4gdGhlIGxpc3QuIEl0c1xuICAvLyBjbGljayBtdXN0IE5PVCB0cmlnZ2VyIHRoZSByb3cgKHdoaWNoIHdvdWxkIG9wZW4gdGhlIGRldGFpbCB2aWV3KS5cbiAgcmVuZGVyRGVzY3JpcHRpb25JbnB1dChzZWxmLCB0eXApIHtcbiAgICBjb25zdCBkZXNjSW5wdXQgPSBzZWxmLmNyZWF0ZUVsKFwiaW5wdXRcIiwge1xuICAgICAgdHlwZTogXCJ0ZXh0XCIsXG4gICAgICBjbHM6IFwidHlwLWxpc3QtZGVzY3JpcHRpb24taW5wdXRcIixcbiAgICB9KTtcbiAgICBkZXNjSW5wdXQudmFsdWUgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBEZXNjcmlwdGlvbnNbdHlwXSA/PyBcIlwiO1xuICAgIGRlc2NJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiBldmVudC5zdG9wUHJvcGFnYXRpb24oKSk7XG4gICAgZGVzY0lucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgdmFsdWUgPSBkZXNjSW5wdXQudmFsdWUudHJpbSgpO1xuICAgICAgaWYgKHZhbHVlKSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBEZXNjcmlwdGlvbnNbdHlwXSA9IHZhbHVlO1xuICAgICAgZWxzZSBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRGVzY3JpcHRpb25zW3R5cF07XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIFwiKFN1YnR5cCAxLCBTdWJ0eXAgMilcIiBpbnN0ZWFkIG9mIHRoZSBkZXNjcmlwdGlvbiAtIHRoZSBzYW1lIGxvb2sgYXMgdGhlXG4gIC8vIHByZXZpZXcgaW4gdGhlIHNlcGFyYXRlIFRZUC1QaWNrZXIgKHNoYXJlZCBuYW1lQ29sb3IgaW4gdHlwLWNvbG9ycy5qcyk6XG4gIC8vIGJyYWNrZXRzIGFuZCBjb21tYXMgbXV0ZWQsIGVhY2ggbmFtZSBpbiBpdHMgU3VidHlwIGNvbG9yLiBPbmx5IHJlZ2lzdGVyZWRcbiAgLy8gU3VidHlwcyBhbmQgbm8gY291bnRzIC0gdW5yZWdpc3RlcmVkIHZhbHVlcyBoYXZlIG5vIGNvbG9yLCBhbmQgY291bnRzXG4gIC8vIHdvdWxkIG1ha2UgdGhlIHJvdyB1bnJlYWRhYmxlLiBEaXNwbGF5IG9ubHk7IGNsaWNrIGFuZCByaWdodC1jbGljayBiZWxvbmdcbiAgLy8gdG8gdGhlIHJvdy4gTGVmdCBvciByaWdodCBhbGlnbm1lbnQgaXMgYSBTdHlsZSBTZXR0aW5ncyBib2R5IGNsYXNzIChzZWVcbiAgLy8gQHNldHRpbmdzIGFuZCAudHlwLWxpc3Qtc3VidHlwcyBpbiBzdHlsZXMuY3NzKTsgdGhlIG1hcmt1cCBpcyB0aGUgc2FtZS5cbiAgcmVuZGVyU3VidHlwUHJldmlldyhzZWxmLCB0eXApIHtcbiAgICBjb25zdCBzdWJ0eXBzID0gZ2V0U3VidHlwTmFtZXModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCk7XG4gICAgaWYgKHN1YnR5cHMubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgICBjb25zdCBjb2xvcml6ZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdDtcbiAgICBjb25zdCB3cmFwID0gc2VsZi5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1saXN0LXN1YnR5cHNcIiB9KTtcbiAgICB3cmFwLmFwcGVuZFRleHQoXCIoXCIpO1xuICAgIHN1YnR5cHMuZm9yRWFjaCgoc3VidHlwLCBpbmRleCkgPT4ge1xuICAgICAgaWYgKGluZGV4ID4gMCkgd3JhcC5hcHBlbmRUZXh0KFwiLCBcIik7XG4gICAgICBjb25zdCBzcGFuID0gd3JhcC5jcmVhdGVTcGFuKHsgdGV4dDogc3VidHlwIH0pO1xuICAgICAgaWYgKGNvbG9yaXplKSBzcGFuLnN0eWxlLmNvbG9yID0gbmFtZUNvbG9yKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCkuY29sb3I7XG4gICAgfSk7XG4gICAgd3JhcC5hcHBlbmRUZXh0KFwiKVwiKTtcbiAgfVxuXG4gIHJlbmRlclVucmVnaXN0ZXJlZEl0ZW0odHlwLCBjb3VudCkge1xuICAgIGNvbnN0IHRyZWVJdGVtID0gdGhpcy5saXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbVwiIH0pO1xuICAgIGNvbnN0IHNlbGYgPSB0cmVlSXRlbS5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLXNlbGYgaXMtY2xpY2thYmxlIHR5cC11bnJlZ2lzdGVyZWRcIiB9KTtcbiAgICBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0taW5uZXJcIiwgdGV4dDogZGlzcGxheVR5cEtleSh0eXApIH0pO1xuICAgIHRoaXMucmVuZGVyQ291bnRGbGFpcihzZWxmLCBjb3VudCk7XG5cbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnJlZ2lzdGVyVHlwKHR5cCkpO1xuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNvbnRleHRtZW51XCIsIChldmVudCkgPT4ge1xuICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgdGhpcy5vcGVuU2VhcmNoKHR5cCk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBFdmVyeSBTVUJUWVAgdmFsdWUgdGhhdCBvY2N1cnMgaW4gbm90ZXMgYnV0IGlzbid0IHJlZ2lzdGVyZWQgdW5kZXIgaXRzIFRZUFxuICAvLyAtIGFjcm9zcyB0aGUgdmF1bHQsIHVubGlrZSByZW5kZXJVbnJlZ2lzdGVyZWRTdWJ0eXBzKCkgaW4gdGhlIGRldGFpbCB2aWV3LlxuICAvLyBUaGUgaW5kZXgga2VlcHMgYnVja2V0cyBmb3IgQUxMIFRZUCBrZXlzLCB1bnJlZ2lzdGVyZWQgb25lcyBpbmNsdWRlZCwgc29cbiAgLy8gdGhlaXIgU3VidHlwcyBjb21lIGFsb25nIChhIGNsaWNrIHRoZW4gcmVnaXN0ZXJzIGJvdGgsIHNlZVxuICAvLyByZWdpc3RlclR5cFdpdGhTdWJ0eXApLlxuICAvL1xuICAvLyBTb3J0ZWQgYnkgY291bnQsIHRoZW4gYnkgcm93IHRleHQgKFRZUCwgdGhlbiBTdWJ0eXApIC0gbGlrZSB0aGUgZGV0YWlsXG4gIC8vIHZpZXcuIERlbGliZXJhdGVseSBOT1QgYnkgdGhlIGxpc3QncyBzb3J0IGJ1dHRvbjogXCJjb2xvclwiIGFuZCBcIm1hbnVhbFwiXG4gIC8vIG1lYW4gbm90aGluZyBmb3IgdW5yZWdpc3RlcmVkIHZhbHVlcy5cbiAgLy9cbiAgLy8gQSBub3RlIHdpdGhvdXQgYSBUWVAgaXMgbGVmdCBvdXQ6IHRoZSBpbmRleCBkcm9wcyBpdHMgU1VCVFlQIGFscmVhZHkgKHNlZVxuICAvLyBhZ2dyZWdhdGUoKSBpbiB0eXAtaW5kZXguanMpLCBhIFNVQlRZUCB3aXRob3V0IGEgVFlQIGhhcyBubyBjb250ZXh0LlxuICB1bnJlZ2lzdGVyZWRTdWJ0eXBSb3dzKCkge1xuICAgIGNvbnN0IHJlZ2lzdGVyZWQgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBzO1xuICAgIGNvbnN0IHJvd3MgPSBbXTtcbiAgICBmb3IgKGNvbnN0IFt0eXAsIGJ1Y2tldF0gb2YgdGhpcy5wbHVnaW4udHlwSW5kZXguc3VidHlwQ291bnRzKCkpIHtcbiAgICAgIGNvbnN0IGtub3duID0gZ2V0U3VidHlwTmFtZXModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCk7XG4gICAgICBmb3IgKGNvbnN0IFtzdWJ0eXAsIGNvdW50XSBvZiBidWNrZXQuY291bnRzKSB7XG4gICAgICAgIGlmIChrbm93bi5pbmNsdWRlcyhzdWJ0eXApKSBjb250aW51ZTtcbiAgICAgICAgcm93cy5wdXNoKHsgdHlwLCBzdWJ0eXAsIGNvdW50LCB0eXBSZWdpc3RlcmVkOiByZWdpc3RlcmVkLmluY2x1ZGVzKHR5cCkgfSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiByb3dzLnNvcnQoKGEsIGIpID0+IGIuY291bnQgLSBhLmNvdW50IHx8IGEudHlwLmxvY2FsZUNvbXBhcmUoYi50eXApIHx8IGEuc3VidHlwLmxvY2FsZUNvbXBhcmUoYi5zdWJ0eXApKTtcbiAgfVxuXG4gIC8vIFwiTk9USVogLyBLdXJ6IEdlc2NoaWNodGVcIiAtIHRoZSBTdWJ0eXAgYWxvbmUgd291bGQgYmUgYW1iaWd1b3VzLCB0aGUgc2FtZVxuICAvLyBuYW1lIGNhbiBleGlzdCB1bmRlciBzZXZlcmFsIFRZUCBlbnRyaWVzLiBJZiB0aGUgVFlQIGlzIHJlZ2lzdGVyZWQsIGl0c1xuICAvLyBwYXJ0IGNhcnJpZXMgaXRzIGNvbG9yIChvciBhIGRvdCwgZGVwZW5kaW5nIG9uIFwiVFlQLVBhbmVcIiBjb2xvcmluZyksXG4gIC8vIHRvbmVkIGRvd24gYnkgdGhlIFN0eWxlIFNldHRpbmcgXCJDb2xvciBpbiB1bnJlZ2lzdGVyZWQgU3VidHlwIHJvd3NcIiBzb1xuICAvLyB0aGVzZSByb3dzIHN0YXkgYmVoaW5kIHRoZSByZWdpc3RlcmVkIGVudHJpZXMgYWJvdmUuIElmIHRoZSBUWVAgaXNuJ3RcbiAgLy8gcmVnaXN0ZXJlZCBlaXRoZXIsIHRoZSB3aG9sZSByb3cgaXMgbXV0ZWQgbGlrZSB0aGUgZW50cmllcyBhYm92ZSBpdC5cbiAgcmVuZGVyVW5yZWdpc3RlcmVkU3VidHlwSXRlbSh7IHR5cCwgc3VidHlwLCBjb3VudCwgdHlwUmVnaXN0ZXJlZCB9KSB7XG4gICAgY29uc3QgdHJlZUl0ZW0gPSB0aGlzLmxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtXCIgfSk7XG4gICAgY29uc3Qgc2VsZiA9IHRyZWVJdGVtLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0tc2VsZiBpcy1jbGlja2FibGUgdHlwLXVucmVnaXN0ZXJlZFwiIH0pO1xuXG4gICAgY29uc3QgY29sb3JpemUgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3Q7XG4gICAgY29uc3QgeyBjb2xvciwgaXNEZWZhdWx0IH0gPSBuYW1lQ29sb3IodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCk7XG4gICAgaWYgKHR5cFJlZ2lzdGVyZWQgJiYgIWNvbG9yaXplKSB7XG4gICAgICBjb25zdCB3cmFwID0gc2VsZi5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWNvbG9yLXdyYXAgdHlwLXVucmVnaXN0ZXJlZC1zdWJ0eXAtY29sb3JcIiB9KTtcbiAgICAgIHBhaW50Q29sb3JEb3Qod3JhcC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWNvbG9yLWRvdFwiIH0pLCBjb2xvciwgaXNEZWZhdWx0KTtcbiAgICB9XG5cbiAgICBjb25zdCBpbm5lciA9IHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1pbm5lclwiIH0pO1xuICAgIGNvbnN0IHR5cEVsID0gaW5uZXIuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtdW5yZWdpc3RlcmVkLXN1YnR5cC10eXBcIiwgdGV4dDogZGlzcGxheVR5cEtleSh0eXApIH0pO1xuICAgIGlmICh0eXBSZWdpc3RlcmVkICYmIGNvbG9yaXplICYmICFpc0RlZmF1bHQpIHtcbiAgICAgIHR5cEVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gICAgICB0eXBFbC5hZGRDbGFzcyhcInR5cC11bnJlZ2lzdGVyZWQtc3VidHlwLWNvbG9yXCIpO1xuICAgIH1cbiAgICBpbm5lci5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC11bnJlZ2lzdGVyZWQtc3VidHlwLXNsYXNoXCIsIHRleHQ6IFwiIC8gXCIgfSk7XG4gICAgaW5uZXIuY3JlYXRlU3Bhbih7IHRleHQ6IGRpc3BsYXlUeXBLZXkoc3VidHlwKSB9KTtcblxuICAgIHRoaXMucmVuZGVyQ291bnRGbGFpcihzZWxmLCBjb3VudCk7XG5cbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnJlZ2lzdGVyVHlwV2l0aFN1YnR5cCh0eXAsIHN1YnR5cCkpO1xuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNvbnRleHRtZW51XCIsIChldmVudCkgPT4ge1xuICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgdGhpcy5vcGVuU3VidHlwU2VhcmNoKHR5cCwgc3VidHlwKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIENsaWNraW5nIHN1Y2ggYSByb3cgcmVnaXN0ZXJzIHRoZSBTdWJ0eXAgYW5kLCBpZiBuZWVkZWQsIGl0cyBUWVAuIFRZUFxuICAvLyBmaXJzdCwgdGhlbiBTdWJ0eXAgLSBuZWNlc3NhcmlseTogcmVnaXN0ZXJpbmcgYSBUWVAgY2FuIGNsZWFuIGl0cyB2YWx1ZSBpblxuICAvLyB0aGUgbm90ZXMgKFwiIGJ1Y2hcIiAtPiBcIkJVQ0hcIiksIGFuZCB0aGUgU3VidHlwIHBhc3MgbXVzdCB0aGVuIHVzZSB0aGUgTkVXXG4gIC8vIFRZUCBuYW1lIG9yIHJlbmFtZVN1YnR5cEluTm90ZXMoKSBmaW5kcyBubyBmaWxlLlxuICAvL1xuICAvLyBObyBjb25maXJtYXRpb246IGl0IG9ubHkgcmVnaXN0ZXJzLiBOb3RlcyBjaGFuZ2Ugb25seSB3aGVuIGEgcmF3IHZhbHVlIHdhc1xuICAvLyB1bmNsZWFuIGFuZCBnZXRzIGNsZWFuZWQgLSBhIGNsZWFuIHZhbHVlIHRvdWNoZXMgbm8gZmlsZS5cbiAgYXN5bmMgcmVnaXN0ZXJUeXBXaXRoU3VidHlwKHR5cEtleSwgc3VidHlwS2V5KSB7XG4gICAgY29uc3QgYnVja2V0ID0gdGhpcy5wbHVnaW4udHlwSW5kZXguc3VidHlwQnVja2V0KHR5cEtleSk7XG4gICAgY29uc3QgdHlwUmVzdWx0ID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwcy5pbmNsdWRlcyh0eXBLZXkpXG4gICAgICA/IHsgdHlwOiB0eXBLZXksIHJlbmFtZWQ6IDAgfVxuICAgICAgOiBhd2FpdCB0aGlzLmFwcGx5VHlwUmVnaXN0cmF0aW9uKHR5cEtleSk7XG4gICAgaWYgKCF0eXBSZXN1bHQpIHJldHVybjtcblxuICAgIGNvbnN0IHN1YnR5cFJlc3VsdCA9IGF3YWl0IHRoaXMuYXBwbHlTdWJ0eXBSZWdpc3RyYXRpb24odHlwUmVzdWx0LnR5cCwgc3VidHlwS2V5LCBidWNrZXQpO1xuICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgIHRoaXMucmVuZGVyKCk7XG4gICAgdGhpcy5yZWZyZXNoT3RoZXJWaWV3cygpO1xuXG4gICAgaWYgKCFzdWJ0eXBSZXN1bHQpIHJldHVybjtcbiAgICBjb25zdCBwYXJ0cyA9IFtdO1xuICAgIGlmICh0eXBSZXN1bHQudHlwICE9PSB0eXBLZXkpIHBhcnRzLnB1c2goYFRZUCAke3R5cFJlc3VsdC50eXB9YCk7XG4gICAgcGFydHMucHVzaChgU3VidHlwICR7c3VidHlwUmVzdWx0LnN1YnR5cH1gKTtcbiAgICBjb25zdCBjaGFuZ2VkID0gdHlwUmVzdWx0LnJlbmFtZWQgKyBzdWJ0eXBSZXN1bHQucmVuYW1lZDtcbiAgICBuZXcgTm90aWNlKGAke2pvaW5BbmQocGFydHMpfSByZWdpc3RlcmVkJHtjaGFuZ2VkID4gMCA/IGAsICR7cGx1cmFsKGNoYW5nZWQsIFwibm90ZVwiKX0gdXBkYXRlZGAgOiBcIlwifS5gKTtcbiAgfVxuXG4gIHJlbmRlclR5cFNldHRpbmdzKHR5cCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xuXG4gICAgY29uc3QgaGVhZGVyID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZGV0YWlsLWhlYWRlclwiIH0pO1xuICAgIGNvbnN0IGJhY2tCdG4gPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1iYWNrXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiQmFja1wiIH0gfSk7XG4gICAgc2V0SWNvbihiYWNrQnRuLCBcImFycm93LWxlZnRcIik7XG4gICAgYmFja0J0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5jbG9zZVR5cFNldHRpbmdzKCkpO1xuXG4gICAgY29uc3QgdGl0bGVFbCA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWRldGFpbC10aXRsZVwiLCB0ZXh0OiB0eXAgfSk7XG4gICAgY29uc3QgdGl0bGVDb2xvciA9IHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdCA/IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdIDogbnVsbDtcbiAgICAvLyBBIGN1c3RvbSBwcm9wZXJ0eSBpbnN0ZWFkIG9mIGNvbG9yOiBhbiBpbmxpbmUgY29sb3IgYmVhdHMgZXZlcnlcbiAgICAvLyBzdHlsZXNoZWV0IHJ1bGUsIGFuZCB0aGUgYWNjZW50IGNvbG9yIG9uIGhvdmVyICgudHlwLXNlYXJjaGFibGUpIHdvdWxkXG4gICAgLy8gbmVlZCAhaW1wb3J0YW50LlxuICAgIGlmICh0aXRsZUNvbG9yKSB0aXRsZUVsLnN0eWxlLnNldFByb3BlcnR5KFwiLS10eXAtbmFtZS1jb2xvclwiLCB0aXRsZUNvbG9yKTtcbiAgICB0aGlzLm1ha2VTZWFyY2hhYmxlKHRpdGxlRWwsICgpID0+IHRoaXMub3BlblNlYXJjaCh0eXApKTtcblxuICAgIGNvbnN0IHsgY291bnRzIH0gPSB0aGlzLnBsdWdpbi50eXBJbmRleC50eXBDb3VudHMoKTtcbiAgICBoZWFkZXIuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtZGV0YWlsLWNvdW50XCIsIHRleHQ6IFN0cmluZyhjb3VudHMuZ2V0KHR5cCkgPz8gMCkgfSk7XG5cbiAgICAvLyBMZWZ0IG9mIHRoZSBwbGFpbiByZW5hbWUgYnV0dG9uLCBoaWdobGlnaHRlZCBpbiBhY2NlbnQgY29sb3I6IHRoaXMgb25lXG4gICAgLy8gYWxzbyByZXdyaXRlcyB0aGUgVFlQIG9mIGV2ZXJ5IGFmZmVjdGVkIG5vdGUgKGFmdGVyIGNvbmZpcm1hdGlvbiwgc2VlXG4gICAgLy8gc3RhcnREZXRhaWxSZW5hbWUpLlxuICAgIGNvbnN0IHJlbmFtZVdpdGhOb3Rlc0J0biA9IGhlYWRlci5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1kZXRhaWwtcmVuYW1lLW5vdGVzXCIsXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlJlbmFtZSBhbmQgdXBkYXRlIG5vdGVzXCIgfSxcbiAgICB9KTtcbiAgICBzZXRJY29uKHJlbmFtZVdpdGhOb3Rlc0J0biwgXCJwZW5jaWxcIik7XG4gICAgcmVuYW1lV2l0aE5vdGVzQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnN0YXJ0RGV0YWlsUmVuYW1lKHR5cCwgdGl0bGVFbCwgeyB1cGRhdGVOb3RlczogdHJ1ZSB9KSk7XG5cbiAgICBjb25zdCByZW5hbWVCdG4gPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1kZXRhaWwtcmVuYW1lXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiUmVuYW1lXCIgfSB9KTtcbiAgICBzZXRJY29uKHJlbmFtZUJ0biwgXCJwZW5jaWxcIik7XG4gICAgcmVuYW1lQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnN0YXJ0RGV0YWlsUmVuYW1lKHR5cCwgdGl0bGVFbCkpO1xuXG4gICAgLy8gQmV0d2VlbiByZW5hbWUgYW5kIGRlbGV0ZSwgaW4gdGhlIHNhbWUgc3BvdCBhcyBmb3IgYSBTdWJ0eXAgKHNlZVxuICAgIC8vIHJlbmRlclNlY3Rpb25Gb290ZXIpLlxuICAgIHRoaXMucmVuZGVyTWFudWFsVG9nZ2xlKGhlYWRlciwgdHlwKTtcblxuICAgIGNvbnN0IGRlbGV0ZUJ0biA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWRldGFpbC1kZWxldGVcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJEZWxldGVcIiB9IH0pO1xuICAgIHNldEljb24oZGVsZXRlQnRuLCBcInRyYXNoXCIpO1xuICAgIGRlbGV0ZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5zaG93RGVsZXRlQ29uZmlybSh0eXApKTtcblxuICAgIGNvbnN0IGJvZHkgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1kZXRhaWwtYm9keVwiIH0pO1xuXG4gICAgLy8gT25lIHJvdyBiZWxvdyB0aGUgaGVhZGVyOiB0aGUgVFlQIGNvbG9yIG9uIHRoZSBsZWZ0LCB0aGUgZGVzY3JpcHRpb25cbiAgICAvLyBmaWxsaW5nIHRoZSByZXN0LlxuICAgIGNvbnN0IG9wdGlvbnNIZWFkZXIgPSBib2R5LmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZnJvbnRtYXR0ZXItaGVhZGVyIHR5cC1vcHRpb25zLWhlYWRlclwiIH0pO1xuXG4gICAgY29uc3QgY29sb3JSb3cgPSBvcHRpb25zSGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZGV0YWlsLWNvbG9yLXJvd1wiIH0pO1xuICAgIHRoaXMucmVuZGVyQ29sb3JQaWNrZXIoXG4gICAgICBjb2xvclJvdyxcbiAgICAgIHR5cCxcbiAgICAgIChuZXdDb2xvcikgPT4ge1xuICAgICAgICBpZiAoIXRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdCkgcmV0dXJuO1xuICAgICAgICAvLyBTYW1lIGN1c3RvbSBwcm9wZXJ0eSBhcyBhYm92ZSwgbm90IHN0eWxlLmNvbG9yIChzZWUgdGhlcmUpLlxuICAgICAgICB0aXRsZUVsLnN0eWxlLnNldFByb3BlcnR5KFwiLS10eXAtbmFtZS1jb2xvclwiLCBuZXdDb2xvcik7XG4gICAgICB9LFxuICAgICAgeyBzaG93UmVzZXQ6IHRydWUgfVxuICAgICk7XG5cbiAgICAvLyBTaW5nbGUtbGluZSBpbnB1dCBuZXh0IHRvIHRoZSBjb2xvciwgbGlrZSB0aGUgb25lIGluIHRoZSBUWVAtTGlzdC4gTm9cbiAgICAvLyBoZWFkaW5nOiB3aGlsZSBlbXB0eSwgaXRzIGZhZGVkIHBsYWNlaG9sZGVyIHNheXMgd2hhdCBpdCBpcy5cbiAgICBjb25zdCBkZXNjSW5wdXQgPSBvcHRpb25zSGVhZGVyLmNyZWF0ZUVsKFwiaW5wdXRcIiwge1xuICAgICAgdHlwZTogXCJ0ZXh0XCIsXG4gICAgICBjbHM6IFwidHlwLWRlc2NyaXB0aW9uLWlucHV0XCIsXG4gICAgICBhdHRyOiB7IHBsYWNlaG9sZGVyOiBcIkRlc2NyaXB0aW9uXCIgfSxcbiAgICB9KTtcbiAgICBkZXNjSW5wdXQudmFsdWUgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBEZXNjcmlwdGlvbnNbdHlwXSA/PyBcIlwiO1xuICAgIGRlc2NJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gZGVzY0lucHV0LnZhbHVlLnRyaW0oKTtcbiAgICAgIGlmICh2YWx1ZSkgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRGVzY3JpcHRpb25zW3R5cF0gPSB2YWx1ZTtcbiAgICAgIGVsc2UgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlc2NyaXB0aW9uc1t0eXBdO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgfSk7XG5cbiAgICAvLyBTZXBhcmF0ZXMgdGhlIGZyb250bWF0dGVyIGJsb2NrcyBmcm9tIHRoZSBUWVAncyBvdGhlciBzZXR0aW5ncy5cbiAgICBib2R5LmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZGV0YWlsLXNlcGFyYXRvclwiIH0pO1xuXG4gICAgLy8gVFlQLUZyb250bWF0dGVyIGFuZCBvbmUgYmxvY2sgcGVyIHJlZ2lzdGVyZWQgU3VidHlwIGJlbG93LCBlYWNoIHdpdGggaXRzXG4gICAgLy8gb3duIGVkaXRvciAoc2VlIGZyb250bWF0dGVyLWJsb2Nrcy5qcyksIHNvIHRoZSBzYW1lIGtleSBtYXkgYXBwZWFyIGluXG4gICAgLy8gc2V2ZXJhbCBibG9ja3MuIEEgU3VidHlwIGJsb2NrIGFkZHMgdG8gdGhlIFRZUC1Gcm9udG1hdHRlciBmb3Igbm90ZXMgd2l0aFxuICAgIC8vIHRoYXQgU1VCVFlQIGFuZCBvdmVycmlkZXMgc2FtZS1uYW1lZCBwcm9wZXJ0aWVzIChzZWUgc3VidHlwcy5qcykuXG4gICAgY29uc3QgYnVja2V0ID0gdGhpcy5wbHVnaW4udHlwSW5kZXguc3VidHlwQnVja2V0KHR5cCk7XG4gICAgdGhpcy5mcm9udG1hdHRlckJsb2NrcyA9IG1vdW50RnJvbnRtYXR0ZXJCbG9ja3ModGhpcywgYm9keSwgdHlwLCB7XG4gICAgICByZW5kZXJIZWFkZXI6IChzZWN0aW9uLCBlbCwgYmxvY2tzKSA9PiB0aGlzLnJlbmRlclNlY3Rpb25IZWFkZXIoZWwsIHR5cCwgc2VjdGlvbiwgYnVja2V0LCBibG9ja3MpLFxuICAgICAgcmVuZGVyRm9vdGVyOiAoc2VjdGlvbiwgZWwpID0+IHtcbiAgICAgICAgaWYgKHNlY3Rpb24gIT09IG51bGwpIHRoaXMucmVuZGVyU2VjdGlvbkZvb3RlcihlbCwgdHlwLCBzZWN0aW9uKTtcbiAgICAgIH0sXG4gICAgICBvbk1vdmVTZWN0aW9uOiBhc3luYyAob3JkZXIpID0+IHtcbiAgICAgICAgcmVvcmRlclN1YnR5cHModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgb3JkZXIpO1xuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgdGhpcy5mcm9udG1hdHRlckVkaXRvcnMucHVzaCguLi50aGlzLmZyb250bWF0dGVyQmxvY2tzLmVkaXRvcnMpO1xuXG4gICAgLy8gRnVsbCB3aWR0aCBhbmQgYWNjZW50IGNvbG9yLCB0byBzdGFuZCBhcGFydCBmcm9tIHRoZSBibG9ja3MnIHNtYWxsIGljb25cbiAgICAvLyBidXR0b25zLlxuICAgIHRoaXMuc3VidHlwQWRkQnRuRWwgPSBib2R5LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgY2xzOiBcIm1vZC1jdGEgdHlwLXN1YnR5cC1hZGRcIiB9KTtcbiAgICBzZXRJY29uKHRoaXMuc3VidHlwQWRkQnRuRWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtc3VidHlwLWFkZC1pY29uXCIgfSksIFwicGx1c1wiKTtcbiAgICB0aGlzLnN1YnR5cEFkZEJ0bkVsLmNyZWF0ZVNwYW4oeyB0ZXh0OiBcIkFkZCBTdWJ0eXBcIiB9KTtcbiAgICB0aGlzLnN1YnR5cEFkZEJ0bkVsLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnN0YXJ0QWRkU3VidHlwKHR5cCkpO1xuXG4gICAgdGhpcy5yZW5kZXJVbnJlZ2lzdGVyZWRTdWJ0eXBzKGJvZHksIHR5cCwgYnVja2V0KTtcblxuICAgIGJvZHkuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1kZXRhaWwtc2VwYXJhdG9yXCIgfSk7XG4gICAgdGhpcy5yZW5kZXJGbG9hdGluZ0hpbnQoYm9keSk7XG4gICAgLy8gVGhlIGJvbGQgbWFya3MgKGZyb250bWF0dGVyLWRlZmF1bHQtaGlnaGxpZ2h0LmpzKSBvbmx5IHJlYWN0IHRvIG1ldGFkYXRhXG4gICAgLy8gYW5kIGxheW91dCBldmVudHM7IG9wZW5pbmcgdGhpcyB2aWV3IGZpcmVzIG5vbmUsIHNvIHJlZnJlc2ggaGVyZS4gT25seVxuICAgIC8vIHRoaXMgb25lIHJlZnJlc2gsIG5vdCB0aGUgZnVsbCByZWZyZXNoVHlwQ29sb3JzKCksIHdoaWNoIHdvdWxkIGNhbGxcbiAgICAvLyByZW5kZXIoKSBvbiB0aGlzIHZpZXcgd2hpbGUgaXQgaXMgc3RpbGwgcmVuZGVyaW5nLlxuICAgIHRoaXMucGx1Z2luLnJlZnJlc2hGcm9udG1hdHRlckhpZ2hsaWdodD8uKCk7XG4gIH1cblxuICAvLyBBIGJsb2NrJ3MgaGVhZGluZyAoc2VlIGZyb250bWF0dGVyLWJsb2Nrcy5qcyk6IHRpdGxlIHdpdGggbm90ZSBjb3VudCAoZm9yXG4gIC8vIHRoZSBUWVAtRnJvbnRtYXR0ZXIgdGhlIG5vdGVzIHdpdGhvdXQgU1VCVFlQLCB0aGUgb25seSBvbmVzIGl0IGFwcGxpZXMgdG9cbiAgLy8gYWxvbmUpLCBzZWFyY2ggb24gY2xpY2ssIGFuZCB0aGUgdHdvIGFkZCBidXR0b25zIGZvciBhIGJsYW5rIHJvdyBpbiB0aGlzXG4gIC8vIGJsb2NrLlxuICByZW5kZXJTZWN0aW9uSGVhZGVyKGVsLCB0eXAsIHNlY3Rpb24sIGJ1Y2tldCwgYmxvY2tzKSB7XG4gICAgY29uc3QgdGl0bGVHcm91cCA9IGVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZnJvbnRtYXR0ZXItdGl0bGUtZ3JvdXBcIiB9KTtcbiAgICAvLyBOZXZlciBjb2xvcmVkLCB1bmxpa2UgdGhlIGRldGFpbCB0aXRsZSBhYm92ZTogYSBibG9jaydzIGNvbG9yIHNpdHMgaW5cbiAgICAvLyBpdHMgZm9vdGVyIGRvdCAoc2VlIHJlbmRlclNlY3Rpb25Gb290ZXIpLlxuICAgIGNvbnN0IHRpdGxlRWwgPSB0aXRsZUdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZGV0YWlsLXNlY3Rpb24tdGl0bGVcIiwgdGV4dDogc2VjdGlvbiA/PyBgJHt0eXB9LUZyb250bWF0dGVyYCB9KTtcbiAgICBjb25zdCBjb3VudCA9IHNlY3Rpb24gPT09IG51bGwgPyBidWNrZXQubm9TdWJ0eXAgOiBidWNrZXQuY291bnRzLmdldChzZWN0aW9uKSA/PyAwO1xuICAgIHRpdGxlR3JvdXAuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtc3VidHlwLWNvdW50XCIsIHRleHQ6IFN0cmluZyhjb3VudCkgfSk7XG4gICAgdGhpcy5tYWtlU2VhcmNoYWJsZSh0aXRsZUVsLCAoKSA9PiB0aGlzLm9wZW5TdWJ0eXBTZWFyY2godHlwLCBzZWN0aW9uKSk7XG5cbiAgICAvLyBGbG9hdGluZyBwcm9wZXJ0aWVzIHNoYXJlIHRoZSBsaXN0IGFuZCBvcmRlciBvZiB0aGUgb3RoZXJzICh3aGljaFxuICAgIC8vIGZyb250bWF0dGVyIHNvcnRpbmcgcmVsaWVzIG9uKSwgc28gdGhleSBsYW5kIHdoZXJldmVyIGRyYWcgJiBkcm9wIHB1dHNcbiAgICAvLyB0aGVtIGluc3RlYWQgb2YgYXQgdGhlIGVuZCBvZiBhIHNlY29uZCBsaXN0LlxuICAgIGNvbnN0IGFkZEJ1dHRvbnMgPSBlbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLWFkZC1ncm91cFwiIH0pO1xuXG4gICAgLy8gTGVmdCBvZiB0aGUgcGxhaW4gYnV0dG9uLCBpbiBhY2NlbnQgY29sb3I6IG1hcmtzIHRoZSBuZXh0IGFkZGVkIChvcixcbiAgICAvLyB1bnRpbCBzYXZlZCwgcmVuYW1lZCkgcHJvcGVydHkgYXMgZmxvYXRpbmcgKHNlZVxuICAgIC8vIGVkaXRvci50eXBQZW5kaW5nRmxvYXRpbmdBZGQpLiBGbG9hdGluZyBwcm9wZXJ0aWVzIGFyZW4ndCBjcmVhdGVkIGZvciBuZXdcbiAgICAvLyBub3RlcyAoc2VlIGdldFR5cERlZmF1bHRzKCkpIGFuZCBzaG93IGluIGl0YWxpY3Mgd2hlcmUgcHJlc2VudC5cbiAgICBjb25zdCBhZGRGbG9hdGluZ1Byb3BlcnR5QnRuID0gYWRkQnV0dG9ucy5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1mcm9udG1hdHRlci1hZGQtZmxvYXRpbmdcIixcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiQWRkIGZsb2F0aW5nIHByb3BlcnR5XCIgfSxcbiAgICB9KTtcbiAgICBzZXRJY29uKGFkZEZsb2F0aW5nUHJvcGVydHlCdG4sIFwicGx1c1wiKTtcbiAgICBhZGRGbG9hdGluZ1Byb3BlcnR5QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiBibG9ja3MuYWRkQmxhbmsoc2VjdGlvbiwgdHJ1ZSkpO1xuXG4gICAgY29uc3QgYWRkUHJvcGVydHlCdG4gPSBhZGRCdXR0b25zLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWZyb250bWF0dGVyLWFkZFwiLFxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJBZGQgcHJvcGVydHlcIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24oYWRkUHJvcGVydHlCdG4sIFwicGx1c1wiKTtcbiAgICBhZGRQcm9wZXJ0eUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gYmxvY2tzLmFkZEJsYW5rKHNlY3Rpb24sIGZhbHNlKSk7XG4gIH1cblxuICAvLyBGb290ZXIgb2YgYSBTdWJ0eXAgYmxvY2s6IG9uIHRoZSBsZWZ0IHRoZSBTdWJ0eXAgY29sb3IgKGEgZG90IG9wZW5pbmcgdGhlXG4gIC8vIHNsaWRlcnMsIHJlc2V0IG5leHQgdG8gaXQpLCBvbiB0aGUgcmlnaHQgdGhlIHNhbWUgYWN0aW9ucyBpbiB0aGUgc2FtZSBvcmRlclxuICAvLyBhcyB0aGUgZGV0YWlsIGhlYWRlciAocmVuYW1lIGFuZCB1cGRhdGUgbm90ZXMsIHJlbmFtZSwgbWFudWFsbHkgY3JlYXRhYmxlLFxuICAvLyBkZWxldGUpLiBUaGUgVFlQLUZyb250bWF0dGVyIGhhcyBubyBmb290ZXIuIFRoZSB0aXRsZSBpcyBsb29rZWQgdXAgb25cbiAgLy8gY2xpY2sgLSBoZWFkaW5nIGFuZCBmb290ZXIgYXJlIHJlYnVpbHQgb24gZXZlcnkgc3luY2hyb25pemUoKS5cbiAgcmVuZGVyU2VjdGlvbkZvb3RlcihlbCwgdHlwLCBzdWJ0eXApIHtcbiAgICBlbC5hZGRDbGFzcyhcInR5cC1zdWJ0eXAtYWN0aW9uc1wiKTtcbiAgICBjb25zdCBjb2xvckdyb3VwID0gZWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zdWJ0eXAtY29sb3ItZ3JvdXBcIiB9KTtcbiAgICAvLyBBIHJpbmcgYWxzbyB3aGlsZSB0aGUgVFlQIGl0c2VsZiBoYXMgbm8gY29sb3IgLSB0aGVuIGFuIG9mZnNldCBjb2xvcnNcbiAgICAvLyBub3RoaW5nIGFueXdoZXJlLlxuICAgIGNvbnN0IG93bkNvbG9yID0gc3VidHlwSGFzT3duQ29sb3IodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKTtcbiAgICBjb25zdCB0eXBIYXNDb2xvciA9ICEhdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF07XG4gICAgY29uc3QgY29sb3JEb3QgPSBjb2xvckdyb3VwLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwidHlwLXN1YnR5cC1jb2xvci1kb3RcIixcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6ICF0eXBIYXNDb2xvciA/IFwiVFlQIGhhcyBubyBjb2xvclwiIDogb3duQ29sb3IgPyBcIkFkanVzdCBjb2xvclwiIDogXCJVc2VzIFRZUCBjb2xvclwiIH0sXG4gICAgfSk7XG4gICAgY29sb3JEb3QudHlwU3VidHlwID0gc3VidHlwO1xuICAgIHBhaW50Q29sb3JEb3QoY29sb3JEb3QsIHN1YnR5cENvbG9yKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCkgPz8gREVGQVVMVF9UWVBfQ09MT1IsICFvd25Db2xvciB8fCAhdHlwSGFzQ29sb3IpO1xuICAgIGNvbG9yRG90LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLm9wZW5TdWJ0eXBDb2xvclBvcG92ZXIoY29sb3JEb3QsIHR5cCwgc3VidHlwKSk7XG4gICAgY29uc3QgcmVzZXRCdG4gPSBjb2xvckdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtY29sb3ItcmVzZXRcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJSZXNldCBjb2xvclwiIH0gfSk7XG4gICAgcmVzZXRCdG4udG9nZ2xlQ2xhc3MoXCJpcy1kaXNhYmxlZFwiLCAhb3duQ29sb3IpO1xuICAgIHNldEljb24ocmVzZXRCdG4sIFwicm90YXRlLWNjd1wiKTtcbiAgICByZXNldEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZGF0YSA9IGdldFN1YnR5cCh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApO1xuICAgICAgaWYgKCFkYXRhPy5jb2xvcikgcmV0dXJuO1xuICAgICAgY29uc3Qgc25hcHNob3QgPSBzbmFwc2hvdFNldHRpbmdzKHRoaXMucGx1Z2luKTtcbiAgICAgIGRlbGV0ZSBkYXRhLmNvbG9yO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICBvZmZlclVuZG8odGhpcy5wbHVnaW4sIGBDb2xvciBvZiBTdWJ0eXAgJHtzdWJ0eXB9IHJlc2V0LmAsIHNuYXBzaG90KTtcbiAgICAgIHRoaXMucmVmcmVzaE90aGVyVmlld3MoKTtcbiAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgfSk7XG5cbiAgICBjb25zdCBhY3Rpb25zID0gZWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zdWJ0eXAtYWN0aW9uLWdyb3VwXCIgfSk7XG4gICAgY29uc3QgdGl0bGVFbCA9ICgpID0+IHtcbiAgICAgIGxldCBzaWJsaW5nID0gZWwucHJldmlvdXNFbGVtZW50U2libGluZztcbiAgICAgIHdoaWxlIChzaWJsaW5nICYmICFzaWJsaW5nLmhhc0NsYXNzKFwidHlwLXNlY3Rpb24taGVhZGVyXCIpKSBzaWJsaW5nID0gc2libGluZy5wcmV2aW91c0VsZW1lbnRTaWJsaW5nO1xuICAgICAgcmV0dXJuIHNpYmxpbmc/LnF1ZXJ5U2VsZWN0b3IoXCIudHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIpID8/IG51bGw7XG4gICAgfTtcbiAgICBjb25zdCByZW5hbWUgPSAodXBkYXRlTm90ZXMpID0+IHtcbiAgICAgIGNvbnN0IHRhcmdldCA9IHRpdGxlRWwoKTtcbiAgICAgIGlmICh0YXJnZXQpIHRoaXMuc3RhcnRTdWJ0eXBSZW5hbWUodHlwLCBzdWJ0eXAsIHRhcmdldCwgeyB1cGRhdGVOb3RlcyB9KTtcbiAgICB9O1xuXG4gICAgY29uc3QgcmVuYW1lV2l0aE5vdGVzQnRuID0gYWN0aW9ucy5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1kZXRhaWwtcmVuYW1lLW5vdGVzXCIsXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlJlbmFtZSBhbmQgdXBkYXRlIG5vdGVzXCIgfSxcbiAgICB9KTtcbiAgICBzZXRJY29uKHJlbmFtZVdpdGhOb3Rlc0J0biwgXCJwZW5jaWxcIik7XG4gICAgcmVuYW1lV2l0aE5vdGVzQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiByZW5hbWUodHJ1ZSkpO1xuXG4gICAgY29uc3QgcmVuYW1lQnRuID0gYWN0aW9ucy5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWRldGFpbC1yZW5hbWVcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJSZW5hbWVcIiB9IH0pO1xuICAgIHNldEljb24ocmVuYW1lQnRuLCBcInBlbmNpbFwiKTtcbiAgICByZW5hbWVCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHJlbmFtZShmYWxzZSkpO1xuXG4gICAgdGhpcy5yZW5kZXJTdWJ0eXBNYW51YWxUb2dnbGUoYWN0aW9ucywgdHlwLCBzdWJ0eXApO1xuXG4gICAgY29uc3QgZGVsZXRlQnRuID0gYWN0aW9ucy5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWRldGFpbC1kZWxldGVcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJEZWxldGVcIiB9IH0pO1xuICAgIHNldEljb24oZGVsZXRlQnRuLCBcInRyYXNoXCIpO1xuICAgIGRlbGV0ZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5kZWxldGVTdWJ0eXBXaXRoQ29uZmlybSh0eXAsIHN1YnR5cCkpO1xuICB9XG5cbiAgLy8gUG9wb3ZlciBiZWxvdyBhIFN1YnR5cCBibG9jaydzIGRvdDogb25lIHNsaWRlciBwZXIgY2hhbm5lbCwgbGltaXRlZCB0byB0aGVcbiAgLy8gcmFuZ2UgZnJvbSB0aGUgc2V0dGluZ3MgKHNlZSB0eXAtY29sb3JzLmpzKSwgZWFjaCB0cmFjayBzaG93aW5nIHRoZSBjb2xvcnNcbiAgLy8gaXQgY2FuIHJlYWNoLiBEcmFnZ2luZyBvbmx5IHVwZGF0ZXMgdGhlIGRvdCBoZXJlOyBzYXZpbmcsIHVwZGF0aW5nIHRoZVxuICAvLyBvdGhlciB2aWV3cyBhbmQgcmUtcmVuZGVyaW5nIHRoaXMgb25lIGhhcHBlbiBvbiBjbG9zZSAoY2xpY2sgb3V0c2lkZSBvclxuICAvLyBFc2NhcGUpLCBhbmQgb25seSBpZiB0aGUgY29sb3IgY2hhbmdlZC5cbiAgLy9cbiAgLy8gQSBTdWJ0eXAgY29sb3IgaXMgYW4gb2Zmc2V0IGZyb20gdGhlIFRZUCBjb2xvcjogd2hpbGUgdGhlIFRZUCBoYXMgbm9uZSxcbiAgLy8gdGhlcmUgaXMgbm90aGluZyB0byBvZmZzZXQsIHNvIHRoZSBwb3BvdmVyIHNheXMgc28gYW5kIHRoZSBzbGlkZXJzIGFyZVxuICAvLyBsb2NrZWQgKHRoZSBkb3Qgc3RheXMgYSBob2xsb3cgcmluZywgc2VlIHJlbmRlclNlY3Rpb25Gb290ZXIpLlxuICBvcGVuU3VidHlwQ29sb3JQb3BvdmVyKGFuY2hvckVsLCB0eXAsIHN1YnR5cCkge1xuICAgIHRoaXMuY2xvc2VTdWJ0eXBDb2xvclBvcG92ZXI/LigpO1xuICAgIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHRoaXMucGx1Z2luO1xuICAgIGNvbnN0IGRhdGEgPSBnZXRTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgc3VidHlwKTtcbiAgICBpZiAoIWRhdGEpIHJldHVybjtcbiAgICBjb25zdCB0eXBIYXNDb2xvciA9ICEhc2V0dGluZ3MudHlwQ29sb3JzW3R5cF07XG4gICAgY29uc3QgdHlwQ29sb3IgPSBzZXR0aW5ncy50eXBDb2xvcnNbdHlwXSA/PyBERUZBVUxUX1RZUF9DT0xPUjtcbiAgICAvLyBXaXRob3V0IGFuIG9mZnNldCBldmVyeSBzbGlkZXIgc3RhcnRzIGF0IDA7IFNVQlRZUF9DT0xPUl9DSEFOTkVMUyBhbG9uZVxuICAgIC8vIHNheXMgd2hpY2ggZXhpc3QuXG4gICAgY29uc3Qgb2Zmc2V0ID0gY2xhbXBlZE9mZnNldChzZXR0aW5ncywgZGF0YS5jb2xvcikgPz8gT2JqZWN0LmZyb21FbnRyaWVzKFNVQlRZUF9DT0xPUl9DSEFOTkVMUy5tYXAoKHsga2V5IH0pID0+IFtrZXksIDBdKSk7XG4gICAgY29uc3QgZG9jID0gYW5jaG9yRWwuZG9jO1xuICAgIGNvbnN0IHBvcG92ZXIgPSBkb2MuYm9keS5jcmVhdGVEaXYoeyBjbHM6IFwibWVudSB0eXAtc3VidHlwLWNvbG9yLXBvcG92ZXJcIiB9KTtcbiAgICBpZiAoIXR5cEhhc0NvbG9yKSBwb3BvdmVyLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtc3VidHlwLWNvbG9yLWhpbnRcIiwgdGV4dDogYFNldCBhIGNvbG9yIGZvciAke3R5cH0gZmlyc3QuYCB9KTtcblxuICAgIGNvbnN0IHJvd3MgPSBbXTtcbiAgICBjb25zdCB1cGRhdGUgPSAoKSA9PiB7XG4gICAgICBjb25zdCBjb2xvciA9IGFwcGx5Q29sb3JPZmZzZXQodHlwQ29sb3IsIG9mZnNldCk7XG4gICAgICBmb3IgKGNvbnN0IGVsIG9mIHRoaXMuY29udGVudEVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIudHlwLXN1YnR5cC1jb2xvci1kb3RcIikpIHtcbiAgICAgICAgaWYgKGVsLnR5cFN1YnR5cCA9PT0gc3VidHlwKSBwYWludENvbG9yRG90KGVsLCBjb2xvciwgIWhhc0NvbG9yT2Zmc2V0KG9mZnNldCkgfHwgIXNldHRpbmdzLnR5cENvbG9yc1t0eXBdKTtcbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHJvdygpO1xuICAgIH07XG5cbiAgICBmb3IgKGNvbnN0IHsga2V5LCBsYWJlbCwgdW5pdCB9IG9mIFNVQlRZUF9DT0xPUl9DSEFOTkVMUykge1xuICAgICAgY29uc3QgW21pbiwgbWF4XSA9IGNoYW5uZWxCb3VuZHMoc2V0dGluZ3MsIGtleSk7XG4gICAgICBjb25zdCByb3cgPSBwb3BvdmVyLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtc3VidHlwLWNvbG9yLXJvd1wiIH0pO1xuICAgICAgcm93LmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXN1YnR5cC1jb2xvci1sYWJlbFwiLCB0ZXh0OiBsYWJlbCB9KTtcbiAgICAgIGNvbnN0IGlucHV0ID0gcm93LmNyZWF0ZUVsKFwiaW5wdXRcIiwgeyB0eXBlOiBcInJhbmdlXCIsIGNsczogXCJzbGlkZXIgdHlwLXN1YnR5cC1jb2xvci1zbGlkZXJcIiB9KTtcbiAgICAgIGlucHV0Lm1pbiA9IFN0cmluZyhtaW4pO1xuICAgICAgaW5wdXQubWF4ID0gU3RyaW5nKG1heCk7XG4gICAgICBpbnB1dC5zdGVwID0gXCIxXCI7XG4gICAgICBpbnB1dC52YWx1ZSA9IFN0cmluZyhvZmZzZXRba2V5XSk7XG4gICAgICBpbnB1dC5kaXNhYmxlZCA9IG1pbiA9PT0gbWF4IHx8ICF0eXBIYXNDb2xvcjtcbiAgICAgIGNvbnN0IHZhbHVlRWwgPSByb3cuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtc3VidHlwLWNvbG9yLXZhbHVlXCIgfSk7XG4gICAgICBpbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiaW5wdXRcIiwgKCkgPT4ge1xuICAgICAgICBvZmZzZXRba2V5XSA9IE51bWJlcihpbnB1dC52YWx1ZSk7XG4gICAgICAgIHVwZGF0ZSgpO1xuICAgICAgfSk7XG4gICAgICByb3dzLnB1c2goKCkgPT4ge1xuICAgICAgICBjb25zdCBzdGVwcyA9IDg7XG4gICAgICAgIGNvbnN0IHN0b3BzID0gW107XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDw9IHN0ZXBzOyBpKyspIHtcbiAgICAgICAgICBzdG9wcy5wdXNoKGFwcGx5Q29sb3JPZmZzZXQodHlwQ29sb3IsIHsgLi4ub2Zmc2V0LCBba2V5XTogbWluICsgKChtYXggLSBtaW4pICogaSkgLyBzdGVwcyB9KSk7XG4gICAgICAgIH1cbiAgICAgICAgaW5wdXQuc3R5bGUuc2V0UHJvcGVydHkoXCItLXR5cC10cmFja1wiLCBgbGluZWFyLWdyYWRpZW50KHRvIHJpZ2h0LCAke3N0b3BzLmpvaW4oXCIsIFwiKX0pYCk7XG4gICAgICAgIHZhbHVlRWwuc2V0VGV4dChgJHtvZmZzZXRba2V5XSA+IDAgPyBcIitcIiA6IFwiXCJ9JHtvZmZzZXRba2V5XX0ke3VuaXR9YCk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgdXBkYXRlKCk7XG5cbiAgICAvLyBCZWxvdyB0aGUgZG90LCBidXQgaW5zaWRlIHRoZSB3aW5kb3cuXG4gICAgY29uc3QgcmVjdCA9IGFuY2hvckVsLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgIGNvbnN0IHdpbiA9IGRvYy5kZWZhdWx0VmlldztcbiAgICBjb25zdCB3aWR0aCA9IHBvcG92ZXIub2Zmc2V0V2lkdGg7XG4gICAgY29uc3QgaGVpZ2h0ID0gcG9wb3Zlci5vZmZzZXRIZWlnaHQ7XG4gICAgcG9wb3Zlci5zdHlsZS5sZWZ0ID0gYCR7TWF0aC5tYXgoOCwgTWF0aC5taW4ocmVjdC5sZWZ0LCB3aW4uaW5uZXJXaWR0aCAtIHdpZHRoIC0gOCkpfXB4YDtcbiAgICBwb3BvdmVyLnN0eWxlLnRvcCA9IGAke3JlY3QuYm90dG9tICsgNiArIGhlaWdodCA+IHdpbi5pbm5lckhlaWdodCAtIDggPyByZWN0LnRvcCAtIDYgLSBoZWlnaHQgOiByZWN0LmJvdHRvbSArIDZ9cHhgO1xuXG4gICAgY29uc3Qgb25Qb2ludGVyRG93biA9IChldmVudCkgPT4ge1xuICAgICAgaWYgKCFwb3BvdmVyLmNvbnRhaW5zKGV2ZW50LnRhcmdldCkpIGNsb3NlKCk7XG4gICAgfTtcbiAgICBjb25zdCBvbktleURvd24gPSAoZXZlbnQpID0+IHtcbiAgICAgIGlmIChldmVudC5rZXkgIT09IFwiRXNjYXBlXCIpIHJldHVybjtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIGNsb3NlKCk7XG4gICAgfTtcbiAgICBjb25zdCBjbG9zZSA9IGFzeW5jICgpID0+IHtcbiAgICAgIHRoaXMuY2xvc2VTdWJ0eXBDb2xvclBvcG92ZXIgPSBudWxsO1xuICAgICAgZG9jLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtb3VzZWRvd25cIiwgb25Qb2ludGVyRG93biwgdHJ1ZSk7XG4gICAgICBkb2MucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgb25LZXlEb3duLCB0cnVlKTtcbiAgICAgIHBvcG92ZXIucmVtb3ZlKCk7XG4gICAgICBjb25zdCBjdXJyZW50ID0gZ2V0U3VidHlwKHNldHRpbmdzLCB0eXAsIHN1YnR5cCk7XG4gICAgICBpZiAoIWN1cnJlbnQpIHJldHVybjtcbiAgICAgIC8vIFVuY2hhbmdlZCAoanVzdCBsb29rZWQsIG9yIHNsaWQgYmFjayk6IG5vdGhpbmcgdG8gc2F2ZSwgYW5kIG5vXG4gICAgICAvLyByZS1yZW5kZXIgdGhhdCBjb3VsZCBtb3ZlIGFueXRoaW5nLlxuICAgICAgY29uc3QgbmV4dCA9IGhhc0NvbG9yT2Zmc2V0KG9mZnNldCkgPyB7IC4uLm9mZnNldCB9IDogbnVsbDtcbiAgICAgIGlmIChKU09OLnN0cmluZ2lmeShuZXh0KSA9PT0gSlNPTi5zdHJpbmdpZnkoY3VycmVudC5jb2xvciA/PyBudWxsKSkgcmV0dXJuO1xuICAgICAgLy8gVGhlIHNsaWRlcnMgb25seSB0b3VjaGVkIHRoZSBkb3Qgc28gZmFyLCBzbyBhIHNuYXBzaG90IHRha2VuIG5vdyBpc1xuICAgICAgLy8gc3RpbGwgdGhlIHN0YXRlIGZyb20gb3BlbmluZyAtIHdpdGhvdXQgcmV2ZXJ0aW5nIGFueXRoaW5nIHNhdmVkXG4gICAgICAvLyBlbHNld2hlcmUgaW4gdGhlIG1lYW50aW1lLlxuICAgICAgY29uc3Qgc25hcHNob3QgPSBzbmFwc2hvdFNldHRpbmdzKHRoaXMucGx1Z2luKTtcbiAgICAgIGlmIChuZXh0KSBjdXJyZW50LmNvbG9yID0gbmV4dDtcbiAgICAgIGVsc2UgZGVsZXRlIGN1cnJlbnQuY29sb3I7XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgIG9mZmVyVW5kbyh0aGlzLnBsdWdpbiwgYENvbG9yIG9mIFN1YnR5cCAke3N1YnR5cH0gY2hhbmdlZC5gLCBzbmFwc2hvdCk7XG4gICAgICB0aGlzLnJlZnJlc2hPdGhlclZpZXdzKCk7XG4gICAgICB0aGlzLnJlbmRlcigpO1xuICAgIH07XG4gICAgdGhpcy5jbG9zZVN1YnR5cENvbG9yUG9wb3ZlciA9IGNsb3NlO1xuICAgIGRvYy5hZGRFdmVudExpc3RlbmVyKFwibW91c2Vkb3duXCIsIG9uUG9pbnRlckRvd24sIHRydWUpO1xuICAgIGRvYy5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCBvbktleURvd24sIHRydWUpO1xuICB9XG5cbiAgLy8gRGVsZXRlcyB0aGUgU3VidHlwIGJsb2NrIHdpdGggaXRzIHByb3BlcnRpZXMuIE5vdGVzIGtlZXAgdGhlaXIgU1VCVFlQXG4gIC8vIHZhbHVlIChpdCB0aGVuIHNob3dzIGFzIHVucmVnaXN0ZXJlZCBiZWxvdyksIHNvIGNvbmZpcm1hdGlvbiBpcyBvbmx5XG4gIC8vIG5lZWRlZCB3aGVuIHByb3BlcnRpZXMgd291bGQgYmUgbG9zdC4gRWl0aGVyIHdheSBhbiB1bmRvIGlzIG9mZmVyZWRcbiAgLy8gYWZ0ZXJ3YXJkcyAoc2VlIHVuZG8uanMpLlxuICBkZWxldGVTdWJ0eXBXaXRoQ29uZmlybSh0eXAsIHN1YnR5cCkge1xuICAgIGNvbnN0IGFwcGx5ID0gYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgc25hcHNob3QgPSBzbmFwc2hvdFNldHRpbmdzKHRoaXMucGx1Z2luKTtcbiAgICAgIGRlbGV0ZVN1YnR5cCh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICBvZmZlclVuZG8odGhpcy5wbHVnaW4sIGBTdWJ0eXAgJHtzdWJ0eXB9IGRlbGV0ZWQuYCwgc25hcHNob3QpO1xuICAgICAgdGhpcy5yZWZyZXNoT3RoZXJWaWV3cygpO1xuICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICB9O1xuICAgIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyhnZXRTdWJ0eXAodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKT8uZnJvbnRtYXR0ZXIgPz8ge30pLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwiXCIpO1xuICAgIGlmIChrZXlzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgYXBwbHkoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgeyBwbHVnaW4gfSA9IHRoaXM7XG4gICAgdGhpcy5jb25maXJtRGVsZXRpb24oXG4gICAgICB7XG4gICAgICAgIHRpdGxlOiBbXG4gICAgICAgICAgXCJEZWxldGUgXCIsXG4gICAgICAgICAgc3VidHlwTmFtZU5vZGUocGx1Z2luLCB0eXAsIHN1YnR5cCksXG4gICAgICAgICAgXCIgb2YgXCIsXG4gICAgICAgICAgdHlwTmFtZU5vZGUocGx1Z2luLCB0eXAsIHBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdHlwXSA/PyBudWxsKSxcbiAgICAgICAgICBcIj9cIixcbiAgICAgICAgXSxcbiAgICAgICAgYm9keTogW1xuICAgICAgICAgIGtleXMubGVuZ3RoID09PSAxXG4gICAgICAgICAgICA/IGBJdHMgcHJvcGVydHkgJHtrZXlzWzBdfSB3aWxsIGJlIGxvc3QuYFxuICAgICAgICAgICAgOiBgSXRzICR7a2V5cy5sZW5ndGh9IHByb3BlcnRpZXMgJHtrZXlzLmpvaW4oXCIsIFwiKX0gd2lsbCBiZSBsb3N0LmAsXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgICAgYXBwbHlcbiAgICApO1xuICB9XG5cbiAgLy8gXCJEZWxldGUgVFlQXCIgYW5kIFwiRGVsZXRlIFN1YnR5cFwiIGNoYW5nZSBub3RoaW5nIGJ1dCB0aGUgc2V0dGluZ3MgYW5kIG9mZmVyXG4gIC8vIFVuZG8gYWZ0ZXJ3YXJkcywgc28gLSB1bmxpa2UgZXZlcnkgZGlhbG9nIHRoYXQgcmV3cml0ZXMgbm90ZXMgLSB0aGVpclxuICAvLyBjb25maXJtYXRpb24gY2FuIGJlIHN3aXRjaGVkIG9mZjogc2V0dGluZyBcIkNvbmZpcm0gZGVsZXRpb25cIiwgb3IgXCJEb24ndFxuICAvLyBhc2sgYWdhaW5cIiBpbiB0aGUgZGlhbG9nIGl0c2VsZi4gV2l0aG91dCBpdCBhcHBseSgpIHJ1bnMgYXQgb25jZS5cbiAgY29uZmlybURlbGV0aW9uKHsgdGl0bGUsIGJvZHkgfSwgYXBwbHkpIHtcbiAgICBpZiAoIXRoaXMucGx1Z2luLnNldHRpbmdzLmNvbmZpcm1EZWxldGlvbikge1xuICAgICAgYXBwbHkoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgbmV3IENvbmZpcm1Nb2RhbCh0aGlzLmFwcCwge1xuICAgICAgdGl0bGUsXG4gICAgICBib2R5LFxuICAgICAgY29uZmlybVRleHQ6IFwiRGVsZXRlXCIsXG4gICAgICB3YXJuaW5nOiB0cnVlLFxuICAgICAgZm9jdXM6IFwiY2FuY2VsXCIsXG4gICAgICBkb250QXNrQWdhaW46IHRydWUsXG4gICAgICBvbkNvbmZpcm06IChkb250QXNrQWdhaW4pID0+IHtcbiAgICAgICAgLy8gU2V0IGJlZm9yZSBhcHBseSgpLCB3aGljaCBzYXZlcyBpdCBhbG9uZyB3aXRoIHRoZSBkZWxldGlvbiBhbmRcbiAgICAgICAgLy8gdGFrZXMgaXRzIHVuZG8gc25hcHNob3Qgb25seSBhZnRlcndhcmRzIC0gVW5kbyBkb2Vzbid0IGJyaW5nIHRoZVxuICAgICAgICAvLyBkaWFsb2cgYmFjay5cbiAgICAgICAgaWYgKGRvbnRBc2tBZ2FpbikgdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29uZmlybURlbGV0aW9uID0gZmFsc2U7XG4gICAgICAgIGFwcGx5KCk7XG4gICAgICB9LFxuICAgIH0pLm9wZW4oKTtcbiAgfVxuXG4gIC8vIExpa2Ugc3RhcnREZXRhaWxSZW5hbWUoKSwgb24gYSBTdWJ0eXAgYmxvY2sncyB0aXRsZS4gVGhlIGJsb2NrIGtlZXBzIGl0c1xuICAvLyBwb3NpdGlvbjsgdXBkYXRlTm90ZXM6IHRydWUgYWxzbyByZXdyaXRlcyB0aGUgU1VCVFlQIG9mIHRoZSBhZmZlY3RlZCBub3Rlc1xuICAvLyBhZnRlciBjb25maXJtYXRpb24uIEFuIGV4aXN0aW5nIG5hbWUgb2ZmZXJzIGEgbWVyZ2UgaW5zdGVhZCAod2hpY2ggYWx3YXlzXG4gIC8vIHJld3JpdGVzIHRoZSBub3RlcykuXG4gIHN0YXJ0U3VidHlwUmVuYW1lKHR5cCwgc3VidHlwLCB0aXRsZUVsLCB7IHVwZGF0ZU5vdGVzID0gZmFsc2UgfSA9IHt9KSB7XG4gICAgdGhpcy5zdGFydElubGluZUVkaXQodGl0bGVFbCwge1xuICAgICAgY2xhc3NlczogW1widHlwLXN1YnR5cC1uYW1lLWlucHV0XCIsIFwiaXMtYmVpbmctcmVuYW1lZFwiXSxcbiAgICAgIC8vIFRoZSB0aXRsZSBzaXRzIGFtb25nIE9ic2lkaWFuJ3MgcHJvcGVydHkgZWRpdG9ycywgd2hvc2Uga2V5Ym9hcmRcbiAgICAgIC8vIG5hdmlnYXRpb24gd291bGQgcmVhY3QgdG9vLlxuICAgICAgc3RvcEFsbEtleXM6IHRydWUsXG4gICAgICBvbkZpbmlzaDogKGNvbW1pdCwgdGV4dCkgPT5cbiAgICAgICAgY29tbWl0ID8gdGhpcy5jb21taXRTdWJ0eXBSZW5hbWUodHlwLCBzdWJ0eXAsIHRleHQsIHsgdXBkYXRlTm90ZXMgfSkgOiB0aGlzLnJlbmRlcigpLFxuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgY29tbWl0U3VidHlwUmVuYW1lKHR5cCwgc3VidHlwLCByYXdUZXh0LCB7IHVwZGF0ZU5vdGVzIH0pIHtcbiAgICBjb25zdCB2YWx1ZSA9IG5vcm1hbGl6ZVN1YnR5cE5hbWUocmF3VGV4dCk7XG4gICAgaWYgKCF2YWx1ZSB8fCB2YWx1ZSA9PT0gc3VidHlwKSB7XG4gICAgICB0aGlzLnJlbmRlcigpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IGNvdW50T2YgPSAobmFtZSkgPT4gdGhpcy5wbHVnaW4udHlwSW5kZXguc3VidHlwQnVja2V0KHR5cCkuY291bnRzLmdldChuYW1lKSA/PyAwO1xuICAgIGNvbnN0IGFwcGx5UmVuYW1lID0gYXN5bmMgKHsgd2l0aE5vdGVzIH0pID0+IHtcbiAgICAgIHJlbmFtZVN1YnR5cCh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXAsIHZhbHVlKTtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgY29uc3QgcmVuYW1lZCA9IHdpdGhOb3RlcyA/IGF3YWl0IHJlbmFtZVN1YnR5cEluTm90ZXModGhpcy5wbHVnaW4sIHR5cCwgc3VidHlwLCB2YWx1ZSkgOiAwO1xuICAgICAgdGhpcy5yZWZyZXNoT3RoZXJWaWV3cygpO1xuICAgICAgaWYgKHdpdGhOb3RlcykgbmV3IE5vdGljZShgU3VidHlwICR7dmFsdWV9OiAke3BsdXJhbChyZW5hbWVkLCBcIm5vdGVcIil9IHVwZGF0ZWQuYCk7XG4gICAgICB0aGlzLnJlbmRlcigpO1xuICAgIH07XG5cbiAgICBjb25zdCBleGlzdGluZyA9IGdldFN1YnR5cE5hbWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXApLmZpbmQoXG4gICAgICAobmFtZSkgPT4gbmFtZS50b0xvd2VyQ2FzZSgpID09PSB2YWx1ZS50b0xvd2VyQ2FzZSgpICYmIG5hbWUgIT09IHN1YnR5cFxuICAgICk7XG4gICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICBuZXcgQ29uZmlybU1vZGFsKHRoaXMuYXBwLCB7XG4gICAgICAgIHRpdGxlOiBbXG4gICAgICAgICAgXCJNZXJnZSBcIixcbiAgICAgICAgICBzdWJ0eXBOYW1lTm9kZSh0aGlzLnBsdWdpbiwgdHlwLCBzdWJ0eXApLFxuICAgICAgICAgIFwiIGludG8gXCIsXG4gICAgICAgICAgc3VidHlwTmFtZU5vZGUodGhpcy5wbHVnaW4sIHR5cCwgZXhpc3RpbmcpLFxuICAgICAgICAgIFwiP1wiLFxuICAgICAgICBdLFxuICAgICAgICBib2R5OiBbXG4gICAgICAgICAgYCR7ZXhpc3Rpbmd9IGFscmVhZHkgZXhpc3RzIGluICR7dHlwfS4gYCArXG4gICAgICAgICAgICBgJHtwbHVyYWwoY291bnRPZihzdWJ0eXApLCBcIm5vdGVcIil9ICR7Y291bnRPZihzdWJ0eXApID09PSAxID8gXCJtb3Zlc1wiIDogXCJtb3ZlXCJ9IHRvIGl0LCBgICtcbiAgICAgICAgICAgIGBhbmQgdGhlIHByb3BlcnRpZXMgb2YgJHtzdWJ0eXB9IG1vdmUgaW50byBpdHMgYmxvY2suYCxcbiAgICAgICAgXSxcbiAgICAgICAgY29uZmlybVRleHQ6IFwiTWVyZ2VcIixcbiAgICAgICAgd2FybmluZzogdHJ1ZSxcbiAgICAgICAgZm9jdXM6IFwiY2FuY2VsXCIsXG4gICAgICAgIG9uQ29uZmlybTogYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIG1lcmdlU3VidHlwcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXAsIGV4aXN0aW5nKTtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICBjb25zdCByZW5hbWVkID0gYXdhaXQgcmVuYW1lU3VidHlwSW5Ob3Rlcyh0aGlzLnBsdWdpbiwgdHlwLCBzdWJ0eXAsIGV4aXN0aW5nKTtcbiAgICAgICAgICB0aGlzLnJlZnJlc2hPdGhlclZpZXdzKCk7XG4gICAgICAgICAgbmV3IE5vdGljZShgU3VidHlwICR7c3VidHlwfSBtZXJnZWQgaW50byAke2V4aXN0aW5nfSwgJHtwbHVyYWwocmVuYW1lZCwgXCJub3RlXCIpfSB1cGRhdGVkLmApO1xuICAgICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICAgIH0sXG4gICAgICAgIG9uQ2FuY2VsOiAoKSA9PiB0aGlzLnJlbmRlcigpLFxuICAgICAgfSkub3BlbigpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghdXBkYXRlTm90ZXMpIHtcbiAgICAgIGF3YWl0IGFwcGx5UmVuYW1lKHsgd2l0aE5vdGVzOiBmYWxzZSB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgLy8gU2FtZSBjb2xvciBmb3Igb2xkIGFuZCBuZXcgbmFtZTogdGhlIG5ldyBvbmUgdGFrZXMgb3ZlciB0aGUgb2xkIG9uZSdzXG4gICAgLy8gb2Zmc2V0IChzZWUgcmVuYW1lU3VidHlwKS5cbiAgICBuZXcgQ29uZmlybU1vZGFsKHRoaXMuYXBwLCB7XG4gICAgICB0aXRsZTogW1xuICAgICAgICBcIlJlbmFtZSBcIixcbiAgICAgICAgc3VidHlwTmFtZU5vZGUodGhpcy5wbHVnaW4sIHR5cCwgc3VidHlwKSxcbiAgICAgICAgXCIgdG8gXCIsXG4gICAgICAgIHN1YnR5cE5hbWVOb2RlKHRoaXMucGx1Z2luLCB0eXAsIHZhbHVlLCBzdWJ0eXApLFxuICAgICAgICBcIj9cIixcbiAgICAgIF0sXG4gICAgICBib2R5OiBbYCR7cGx1cmFsKGNvdW50T2Yoc3VidHlwKSwgXCJub3RlXCIpfSB3aWxsIGJlIHVwZGF0ZWQuYF0sXG4gICAgICBjb25maXJtVGV4dDogXCJSZW5hbWVcIixcbiAgICAgIGZvY3VzOiBcImNvbmZpcm1cIixcbiAgICAgIG9uQ29uZmlybTogKCkgPT4gYXBwbHlSZW5hbWUoeyB3aXRoTm90ZXM6IHRydWUgfSksXG4gICAgICBvbkNhbmNlbDogKCkgPT4gdGhpcy5yZW5kZXIoKSxcbiAgICB9KS5vcGVuKCk7XG4gIH1cblxuICAvLyBMaWtlIHRoZSB1bnJlZ2lzdGVyZWQgZW50cmllcyBvZiB0aGUgVFlQLUxpc3Q6IFNVQlRZUCB2YWx1ZXMgb2YgdGhpcyBUWVAnc1xuICAvLyBub3RlcyB0aGF0IGhhdmUgbm8gYmxvY2sgeWV0IChub3RlcyB3aXRob3V0IGFueSBTVUJUWVAgY291bnQgZm9yIHRoZVxuICAvLyBUWVAtRnJvbnRtYXR0ZXIgaW5zdGVhZCkuIFNob3duIGxpa2UgU3VidHlwIGJsb2NrcywgYnV0IG9ubHkgaGVhZGluZyBhbmRcbiAgLy8gY291bnQuIEEgY2xpY2sgb24gdGhlIGJsb2NrIHJlZ2lzdGVycyB0aGUgdmFsdWU7IGEgY2xpY2sgb24gdGhlIG5hbWUgb3BlbnNcbiAgLy8gdGhlIHNlYXJjaCBpbnN0ZWFkIC0gY2hlY2tpbmcgd2hhdCBhIHZhbHVlIGhvbGRzIGJlZm9yZSByZWdpc3RlcmluZyBpdCBpc1xuICAvLyB0aGUgY29tbW9uIGNhc2UuIFRoZSBuYW1lIGxpZ2h0cyB1cCBpbiBhY2NlbnQgY29sb3Igb24gaG92ZXIgdG8gc2hvdyBpdFxuICAvLyBkb2VzIHNvbWV0aGluZyBkaWZmZXJlbnQgZnJvbSB0aGUgYXJlYSBhcm91bmQgaXQuXG4gIHJlbmRlclVucmVnaXN0ZXJlZFN1YnR5cHMocGFyZW50LCB0eXAsIGJ1Y2tldCkge1xuICAgIGNvbnN0IHJlZ2lzdGVyZWQgPSBnZXRTdWJ0eXBOYW1lcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwKTtcbiAgICBjb25zdCB1bnJlZ2lzdGVyZWQgPSBbLi4uYnVja2V0LmNvdW50cy5rZXlzKCldXG4gICAgICAuZmlsdGVyKChrZXkpID0+ICFyZWdpc3RlcmVkLmluY2x1ZGVzKGtleSkpXG4gICAgICAuc29ydCgoYSwgYikgPT4gYnVja2V0LmNvdW50cy5nZXQoYikgLSBidWNrZXQuY291bnRzLmdldChhKSB8fCBhLmxvY2FsZUNvbXBhcmUoYikpO1xuICAgIGlmICh1bnJlZ2lzdGVyZWQubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgICBjb25zdCBsaXN0RWwgPSBwYXJlbnQuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zdWJ0eXAtdW5yZWdpc3RlcmVkLWxpc3RcIiB9KTtcbiAgICBmb3IgKGNvbnN0IGtleSBvZiB1bnJlZ2lzdGVyZWQpIHtcbiAgICAgIGNvbnN0IGJsb2NrID0gbGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZnJvbnRtYXR0ZXItYmxvY2sgdHlwLXN1YnR5cC1ibG9jayB0eXAtc3VidHlwLXVucmVnaXN0ZXJlZFwiIH0pO1xuICAgICAgY29uc3QgaGVhZGVyID0gYmxvY2suY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci1oZWFkZXJcIiB9KTtcbiAgICAgIGNvbnN0IHRpdGxlR3JvdXAgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci10aXRsZS1ncm91cFwiIH0pO1xuICAgICAgY29uc3QgdGl0bGVFbCA9IHRpdGxlR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1kZXRhaWwtc2VjdGlvbi10aXRsZVwiLCB0ZXh0OiBkaXNwbGF5VHlwS2V5KGtleSkgfSk7XG4gICAgICB0aXRsZUdyb3VwLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXN1YnR5cC1jb3VudFwiLCB0ZXh0OiBTdHJpbmcoYnVja2V0LmNvdW50cy5nZXQoa2V5KSkgfSk7XG4gICAgICBibG9jay5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5yZWdpc3RlclN1YnR5cCh0eXAsIGtleSwgYnVja2V0KSk7XG4gICAgICAvLyBzdG9wUHJvcGFnYXRpb24sIG9yIHRoZSBzYW1lIGNsaWNrIHdvdWxkIGFsc28gcmVnaXN0ZXIgdGhlIHZhbHVlIG9uZVxuICAgICAgLy8gb25seSB3YW50ZWQgdG8gbG9vayB1cC5cbiAgICAgIHRoaXMubWFrZVNlYXJjaGFibGUodGl0bGVFbCwgKCkgPT4gdGhpcy5vcGVuU3VidHlwU2VhcmNoKHR5cCwga2V5KSwgeyBzdG9wUHJvcGFnYXRpb246IHRydWUgfSk7XG4gICAgfVxuICB9XG5cbiAgLy8gQSBuYW1lIHdob3NlIGNsaWNrIG9wZW5zIHRoZSBzZWFyY2g6IHBvaW50ZXIgY3Vyc29yIGFuZCBhY2NlbnQgY29sb3Igb25cbiAgLy8gaG92ZXIgKC50eXAtc2VhcmNoYWJsZSksIHNvIHRoZSB2aWV3IGl0c2VsZiBzaG93cyB3aGVyZSBzb21ldGhpbmcgaGFwcGVucy5cbiAgLy8gVGhlIG5hbWUgaXMgd2hlcmUgb25lIGV4cGVjdHMgXCJzaG93IG1lIHRoZXNlIG5vdGVzXCIuIFdoaWxlIHJlbmFtaW5nLCB0aGVcbiAgLy8gZWxlbWVudCBpcyBhbiBpbnB1dCAoaXMtYmVpbmctcmVuYW1lZCkgYW5kIGEgY2xpY2sganVzdCBwbGFjZXMgdGhlIGN1cnNvci5cbiAgbWFrZVNlYXJjaGFibGUoZWwsIG9uU2VhcmNoLCB7IHN0b3BQcm9wYWdhdGlvbiA9IGZhbHNlIH0gPSB7fSkge1xuICAgIGVsLmFkZENsYXNzKFwidHlwLXNlYXJjaGFibGVcIik7XG4gICAgZWwuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChldmVudCkgPT4ge1xuICAgICAgaWYgKGVsLmhhc0NsYXNzKFwiaXMtYmVpbmctcmVuYW1lZFwiKSkgcmV0dXJuO1xuICAgICAgaWYgKHN0b3BQcm9wYWdhdGlvbikgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICBvblNlYXJjaCgpO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gc3VidHlwS2V5ID09PSBudWxsIG1lYW5zIG5vdGVzIG9mIHRoaXMgVFlQIHdpdGhvdXQgU1VCVFlQLiBBIGxpc3QgaGFzIG5vXG4gIC8vIGV4YWN0IHNlYXJjaCBzeW50YXggKGFzIGluIG9wZW5TZWFyY2goKSksIHNvIGl0IHNlYXJjaGVzIG5vdGVzIGNhcnJ5aW5nIGFsbFxuICAvLyBpdHMgaXRlbXMuXG4gIG9wZW5TdWJ0eXBTZWFyY2godHlwLCBzdWJ0eXBLZXkpIHtcbiAgICBjb25zdCBnbG9iYWxTZWFyY2ggPSB0aGlzLnBsdWdpbi5hcHAuaW50ZXJuYWxQbHVnaW5zLmdldFBsdWdpbkJ5SWQoXCJnbG9iYWwtc2VhcmNoXCIpO1xuICAgIGlmICghZ2xvYmFsU2VhcmNoKSByZXR1cm47XG4gICAgY29uc3QgdHlwQ2xhdXNlID0gdGhpcy50eXBDbGF1c2UodHlwKTtcbiAgICBsZXQgc3VidHlwQ2xhdXNlO1xuICAgIGlmIChzdWJ0eXBLZXkgPT09IG51bGwpIHtcbiAgICAgIHN1YnR5cENsYXVzZSA9IGAtW1wiJHtTVUJUWVBfUFJPUEVSVFl9XCJdYDtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgcmF3ID0gdGhpcy5wbHVnaW4udHlwSW5kZXguc3VidHlwQnVja2V0KHR5cCkucmF3QnlLZXkuZ2V0KHN1YnR5cEtleSk7XG4gICAgICBzdWJ0eXBDbGF1c2UgPSBBcnJheS5pc0FycmF5KHJhdylcbiAgICAgICAgPyByYXcubWFwKCh2KSA9PiBgW1wiJHtTVUJUWVBfUFJPUEVSVFl9XCI6XCIke1N0cmluZyh2ID8/IFwiXCIpLnRyaW0oKX1cIl1gKS5qb2luKFwiIFwiKVxuICAgICAgICA6IGBbXCIke1NVQlRZUF9QUk9QRVJUWX1cIjpcIiR7c3VidHlwS2V5fVwiXWA7XG4gICAgfVxuICAgIGdsb2JhbFNlYXJjaC5pbnN0YW5jZS5vcGVuR2xvYmFsU2VhcmNoKGAke3R5cENsYXVzZX0gJHtzdWJ0eXBDbGF1c2V9YCk7XG4gIH1cblxuICAvLyBMaWtlIHJlZ2lzdGVyVHlwKCk6IHJlZ2lzdGVycyB0aGUgY2xlYW5lZCBmb3JtICh0aXRsZSBjYXNlLCBhIGxpc3QgYXMgb25lXG4gIC8vIHZhbHVlIFwiQSwgQlwiKSBhcyBhIFN1YnR5cCBvZiB0aGlzIFRZUCBhbmQgcmV3cml0ZXMgdGhlIFNVQlRZUCBvZiB0aGVcbiAgLy8gYWZmZWN0ZWQgbm90ZXMuIElmIHRoZSBTdWJ0eXAgZXhpc3RzIGluIGFub3RoZXIgc3BlbGxpbmcsIHRoZSBub3RlcyBnb1xuICAvLyB0aGVyZS5cbiAgYXN5bmMgcmVnaXN0ZXJTdWJ0eXAodHlwLCBzdWJ0eXBLZXksIGJ1Y2tldCkge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuYXBwbHlTdWJ0eXBSZWdpc3RyYXRpb24odHlwLCBzdWJ0eXBLZXksIGJ1Y2tldCk7XG4gICAgaWYgKCFyZXN1bHQpIHJldHVybjtcblxuICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgIHRoaXMucmVmcmVzaE90aGVyVmlld3MoKTtcbiAgICB0aGlzLnJlbmRlcigpO1xuICAgIGlmIChyZXN1bHQucmVuYW1lZCA+IDApIG5ldyBOb3RpY2UoYFN1YnR5cCAke3Jlc3VsdC5zdWJ0eXB9IHJlZ2lzdGVyZWQsICR7cGx1cmFsKHJlc3VsdC5yZW5hbWVkLCBcIm5vdGVcIil9IHVwZGF0ZWQuYCk7XG4gIH1cblxuICAvLyBMaWtlIGFwcGx5VHlwUmVnaXN0cmF0aW9uOiB0aGUgY29yZSB3aXRob3V0IHNhdmluZyBhbmQgbm90aWNlLCBzb1xuICAvLyByZWdpc3RlclR5cFdpdGhTdWJ0eXAoKSBjYW4gYnVuZGxlIGl0LiBSZXR1cm5zIHsgc3VidHlwLCByZW5hbWVkIH0gb3IgbnVsbC5cbiAgYXN5bmMgYXBwbHlTdWJ0eXBSZWdpc3RyYXRpb24odHlwLCBzdWJ0eXBLZXksIGJ1Y2tldCkge1xuICAgIGNvbnN0IHJhdyA9IGJ1Y2tldC5yYXdCeUtleS5nZXQoc3VidHlwS2V5KTtcbiAgICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplUmF3VHlwKHJhdyA9PT0gdW5kZWZpbmVkID8gc3VidHlwS2V5IDogcmF3LCBub3JtYWxpemVTdWJ0eXBOYW1lKTtcbiAgICBpZiAoIW5vcm1hbGl6ZWQpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGV4aXN0aW5nID0gZ2V0U3VidHlwTmFtZXModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCkuZmluZCgobmFtZSkgPT4gbmFtZS50b0xvd2VyQ2FzZSgpID09PSBub3JtYWxpemVkLnRvTG93ZXJDYXNlKCkpO1xuICAgIGNvbnN0IHN1YnR5cCA9IGV4aXN0aW5nID8/IG5vcm1hbGl6ZWQ7XG4gICAgZW5zdXJlU3VidHlwKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCk7XG5cbiAgICBjb25zdCByZW5hbWVkID0gc3VidHlwICE9PSBzdWJ0eXBLZXkgPyBhd2FpdCByZW5hbWVTdWJ0eXBJbk5vdGVzKHRoaXMucGx1Z2luLCB0eXAsIHN1YnR5cEtleSwgc3VidHlwKSA6IDA7XG4gICAgcmV0dXJuIHsgc3VidHlwLCByZW5hbWVkIH07XG4gIH1cblxuICAvLyBBIG5ldywgZW1wdHkgU3VidHlwIGJsb2NrIHJpZ2h0IGFib3ZlIHRoZSBcIkFkZCBTdWJ0eXBcIiBidXR0b24sIGl0cyBuYW1lXG4gIC8vIHR5cGVkIGlubGluZSAobGlrZSBzdGFydEFkZCgpIGluIHRoZSBsaXN0KS5cbiAgc3RhcnRBZGRTdWJ0eXAodHlwKSB7XG4gICAgaWYgKHRoaXMuaXNFZGl0aW5nIHx8ICF0aGlzLnN1YnR5cEFkZEJ0bkVsKSByZXR1cm47XG5cbiAgICAvLyBCdWlsdCBsaWtlIHRoZSBmaW5pc2hlZCAoZW1wdHkpIGJsb2NrLCB3aXRoIHRoZSBcIitcIiBidXR0b25zIGFuZCBmb290ZXJcbiAgICAvLyBhY3Rpb25zIHRoYXQgZG8gbm90aGluZyB5ZXQsIGp1c3Qgd2l0aG91dCBhIGNvdW50IC0gc28gbm90aGluZyBqdW1wc1xuICAgIC8vIHdoZW4gdGhlIGlucHV0IGlzIGRvbmUgKHNlZSAudHlwLXN1YnR5cC1wZW5kaW5nKS5cbiAgICBjb25zdCBibG9jayA9IGNyZWF0ZURpdih7IGNsczogXCJ0eXAtZnJvbnRtYXR0ZXItYmxvY2sgdHlwLXN1YnR5cC1ibG9jayB0eXAtc3VidHlwLXBlbmRpbmdcIiB9KTtcbiAgICB0aGlzLnN1YnR5cEFkZEJ0bkVsLnBhcmVudEVsZW1lbnQuaW5zZXJ0QmVmb3JlKGJsb2NrLCB0aGlzLnN1YnR5cEFkZEJ0bkVsKTtcbiAgICBjb25zdCBoZWFkZXIgPSBibG9jay5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLWhlYWRlclwiIH0pO1xuICAgIGNvbnN0IHRpdGxlR3JvdXAgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci10aXRsZS1ncm91cFwiIH0pO1xuICAgIGNvbnN0IG5hbWVFbCA9IHRpdGxlR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1kZXRhaWwtc2VjdGlvbi10aXRsZSB0eXAtc3VidHlwLW5hbWUtaW5wdXQgaXMtYmVpbmctcmVuYW1lZFwiIH0pO1xuICAgIGNvbnN0IGFkZEJ1dHRvbnMgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci1hZGQtZ3JvdXBcIiB9KTtcbiAgICBzZXRJY29uKGFkZEJ1dHRvbnMuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1mcm9udG1hdHRlci1hZGQtZmxvYXRpbmdcIiB9KSwgXCJwbHVzXCIpO1xuICAgIHNldEljb24oYWRkQnV0dG9ucy5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWZyb250bWF0dGVyLWFkZFwiIH0pLCBcInBsdXNcIik7XG4gICAgY29uc3QgZm9vdGVyID0gYmxvY2suY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zZWN0aW9uLWZvb3RlciB0eXAtc3VidHlwLWFjdGlvbnNcIiB9KTtcbiAgICBjb25zdCBjb2xvckdyb3VwID0gZm9vdGVyLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtc3VidHlwLWNvbG9yLWdyb3VwXCIgfSk7XG4gICAgcGFpbnRDb2xvckRvdChjb2xvckdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtc3VidHlwLWNvbG9yLWRvdFwiIH0pLCB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdHlwXSA/PyBERUZBVUxUX1RZUF9DT0xPUiwgdHJ1ZSk7XG4gICAgc2V0SWNvbihjb2xvckdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtY29sb3ItcmVzZXQgaXMtZGlzYWJsZWRcIiB9KSwgXCJyb3RhdGUtY2N3XCIpO1xuICAgIGNvbnN0IGFjdGlvbnMgPSBmb290ZXIuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zdWJ0eXAtYWN0aW9uLWdyb3VwXCIgfSk7XG4gICAgc2V0SWNvbihhY3Rpb25zLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtZGV0YWlsLXJlbmFtZS1ub3Rlc1wiIH0pLCBcInBlbmNpbFwiKTtcbiAgICBzZXRJY29uKGFjdGlvbnMuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1kZXRhaWwtcmVuYW1lXCIgfSksIFwicGVuY2lsXCIpO1xuICAgIC8vIFRoZSBzdGF0ZSBlbnN1cmVTdWJ0eXAgd2lsbCBnaXZlIHRoZSBuZXcgU3VidHlwOiB0aGF0IG9mIGl0cyBUWVAuXG4gICAgY29uc3QgbWFudWFsQ2xzID0gXCJjbGlja2FibGUtaWNvbiB0eXAtbWFudWFsLWljb25cIiArICh0aGlzLmVuc3VyZVR5cE1hbnVhbCgpW3R5cF0gIT09IGZhbHNlID8gXCIgaXMtYWN0aXZlXCIgOiBcIlwiKTtcbiAgICBzZXRJY29uKGFjdGlvbnMuY3JlYXRlRGl2KHsgY2xzOiBtYW51YWxDbHMgfSksIFwiZmlsZS1wZW4tbGluZVwiKTtcbiAgICBzZXRJY29uKGFjdGlvbnMuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1kZXRhaWwtZGVsZXRlXCIgfSksIFwidHJhc2hcIik7XG5cbiAgICB0aGlzLnN0YXJ0SW5saW5lRWRpdChuYW1lRWwsIHtcbiAgICAgIC8vIG5hbWVFbCBjYXJyaWVzIHRoZSBpbnB1dCBjbGFzc2VzIGZyb20gdGhlIHN0YXJ0LlxuICAgICAgY2xhc3NlczogW10sXG4gICAgICBvbkZpbmlzaDogYXN5bmMgKGNvbW1pdCwgdGV4dCkgPT4ge1xuICAgICAgICBjb25zdCB2YWx1ZSA9IG5vcm1hbGl6ZVN1YnR5cE5hbWUodGV4dCk7XG4gICAgICAgIGlmIChjb21taXQgJiYgdmFsdWUpIHtcbiAgICAgICAgICBjb25zdCBleGlzdGluZyA9IGdldFN1YnR5cE5hbWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXApLmZpbmQoKG5hbWUpID0+IG5hbWUudG9Mb3dlckNhc2UoKSA9PT0gdmFsdWUudG9Mb3dlckNhc2UoKSk7XG4gICAgICAgICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICAgICAgICBuZXcgTm90aWNlKGAke3R5cH0gYWxyZWFkeSBoYXMgU3VidHlwICR7ZXhpc3Rpbmd9LmApO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBlbnN1cmVTdWJ0eXAodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgdmFsdWUpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICB9LFxuICAgIH0pO1xuICB9XG5cbiAgLy8gTm90ZXMga2VlcCB0aGVpciBUWVAgKGl0IHRoZW4gc2hvd3MgYXMgdW5yZWdpc3RlcmVkKSwgc28gdGhpcyBvbmx5IGNoYW5nZXNcbiAgLy8gc2V0dGluZ3M6IFVuZG8gYWZ0ZXJ3YXJkcywgYW5kIHRoZSBjb25maXJtYXRpb24gY2FuIGJlIHN3aXRjaGVkIG9mZiAoc2VlXG4gIC8vIGNvbmZpcm1EZWxldGlvbikuIEZyb20gdGhlIGRldGFpbCBoZWFkZXIgb3IgdGhlIGxpc3QncyBjb250ZXh0IG1lbnUuXG4gIHNob3dEZWxldGVDb25maXJtKHR5cCkge1xuICAgIGNvbnN0IGFwcGx5ID0gYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgc25hcHNob3QgPSBzbmFwc2hvdFNldHRpbmdzKHRoaXMucGx1Z2luKTtcbiAgICAgIGRlbGV0ZVR5cFNldHRpbmdzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXApO1xuICAgICAgLy8gQmFjayB0byB0aGUgbGlzdCAob3IgdGhlIGxpc3QgcmVidWlsdCkgcmlnaHQgYXdheSwgc28gdGhlIGRlbGV0ZWRcbiAgICAgIC8vIFRZUCdzIG5vdyBlbXB0eSBkZXRhaWwgdmlldyBuZXZlciBzaG93cy5cbiAgICAgIGlmICh0aGlzLnNlbGVjdGVkVHlwID09PSB0eXApIHRoaXMuY2xvc2VUeXBTZXR0aW5ncygpO1xuICAgICAgZWxzZSB0aGlzLnJlbmRlcigpO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICBvZmZlclVuZG8odGhpcy5wbHVnaW4sIGBUWVAgJHt0eXB9IGRlbGV0ZWQuYCwgc25hcHNob3QpO1xuICAgICAgdGhpcy5yZWZyZXNoT3RoZXJWaWV3cygpO1xuICAgIH07XG4gICAgdGhpcy5jb25maXJtRGVsZXRpb24oXG4gICAgICB7IHRpdGxlOiBbXCJEZWxldGUgXCIsIHR5cE5hbWVOb2RlKHRoaXMucGx1Z2luLCB0eXAsIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdID8/IG51bGwpLCBcIj9cIl0gfSxcbiAgICAgIGFwcGx5XG4gICAgKTtcbiAgfVxuXG4gIC8vIFwiUmVuYW1lXCIgLyBcIlJlbmFtZSBhbmQgdXBkYXRlIG5vdGVzXCIgZnJvbSB0aGUgbGlzdCdzIGNvbnRleHQgbWVudTogdGhlXG4gIC8vIG5hbWUgaW4gdGhlIHJvdyBiZWNvbWVzIHRoZSBpbnB1dCwgdGhlIHJlc3QgaXMgdGhlIHNhbWUgYXMgaW4gdGhlIGRldGFpbFxuICAvLyB2aWV3IChjb21taXRUeXBSZW5hbWUpLlxuICBzdGFydExpc3RSZW5hbWUodHlwLCBzZWxmLCBuYW1lRWwsIG9wdGlvbnMgPSB7fSkge1xuICAgIGlmICh0aGlzLmlzRWRpdGluZykgcmV0dXJuO1xuICAgIC8vIEEgZHJhZ2dhYmxlIHJvdyAobWFudWFsIHNvcnRpbmcpIHdvdWxkIHRha2UgdGhlIG1vdXNlIGF3YXkgZnJvbSB0aGVcbiAgICAvLyB0ZXh0IC0gbm8gY3Vyc29yIHBsYWNlbWVudCBvciBzZWxlY3Rpb24gaW4gdGhlIG5hbWUuIHJlbmRlcigpIHJlYnVpbGRzXG4gICAgLy8gdGhlIHJvdyBhZnRlcndhcmRzLlxuICAgIHNlbGYuZHJhZ2dhYmxlID0gZmFsc2U7XG4gICAgdGhpcy5zdGFydElubGluZUVkaXQobmFtZUVsLCB7XG4gICAgICBjbGFzc0VsOiBzZWxmLFxuICAgICAgb25GaW5pc2g6IChjb21taXQsIHRleHQpID0+IChjb21taXQgPyB0aGlzLmNvbW1pdFR5cFJlbmFtZSh0eXAsIHRleHQsIG9wdGlvbnMpIDogdGhpcy5yZW5kZXIoKSksXG4gICAgfSk7XG4gIH1cblxuICAvLyBUaGUgcmVuYW1lIGJ1dHRvbnMgb2YgdGhlIGRldGFpbCBoZWFkZXIsIG9uIHRoZSB0aXRsZS5cbiAgc3RhcnREZXRhaWxSZW5hbWUodHlwLCB0aXRsZUVsLCBvcHRpb25zID0ge30pIHtcbiAgICB0aGlzLnN0YXJ0SW5saW5lRWRpdCh0aXRsZUVsLCB7XG4gICAgICBvbkZpbmlzaDogKGNvbW1pdCwgdGV4dCkgPT4gKGNvbW1pdCA/IHRoaXMuY29tbWl0VHlwUmVuYW1lKHR5cCwgdGV4dCwgb3B0aW9ucykgOiB0aGlzLnJlbmRlcigpKSxcbiAgICB9KTtcbiAgfVxuXG4gIC8vIFRoZSByZW5hbWUgaXRzZWxmLCBzaGFyZWQgYnkgbGlzdCBhbmQgZGV0YWlsIHZpZXcuIHVwZGF0ZU5vdGVzOiB0cnVlICh0aGVcbiAgLy8gaGlnaGxpZ2h0ZWQgYnV0dG9uKSBhbHNvIHJld3JpdGVzIHRoZSBUWVAgb2YgZXZlcnkgYWZmZWN0ZWQgbm90ZSBhZnRlclxuICAvLyBjb25maXJtYXRpb24gKHNlZSByZW5hbWVUeXBJbk5vdGVzKSBpbnN0ZWFkIG9mIG9ubHkgdGhlIHNldHRpbmdzLiBBblxuICAvLyBleGlzdGluZyBuYW1lIG9mZmVycyBhIG1lcmdlIChzaG93TWVyZ2VDb25maXJtKS5cbiAgYXN5bmMgY29tbWl0VHlwUmVuYW1lKHR5cCwgcmF3VGV4dCwgeyB1cGRhdGVOb3RlcyA9IGZhbHNlIH0gPSB7fSkge1xuICAgIGNvbnN0IHZhbHVlID0gbm9ybWFsaXplVHlwTmFtZShyYXdUZXh0KTtcbiAgICBpZiAoIXZhbHVlIHx8IHZhbHVlID09PSB0eXApIHtcbiAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBzLmZpbmQoKHQpID0+IHQudG9Mb3dlckNhc2UoKSA9PT0gdmFsdWUudG9Mb3dlckNhc2UoKSAmJiB0ICE9PSB0eXApO1xuICAgIGlmIChleGlzdGluZykge1xuICAgICAgdGhpcy5zaG93TWVyZ2VDb25maXJtKHR5cCwgZXhpc3RpbmcpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghdXBkYXRlTm90ZXMpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVuYW1lVHlwU2V0dGluZ3ModHlwLCB2YWx1ZSk7XG4gICAgICB0aGlzLnJlbmRlcigpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIEEgYnVsayB3cml0ZSBhY3Jvc3MgcG9zc2libHkgbWFueSBmaWxlcyAtIGNvbmZpcm0gZmlyc3QuIFNhbWUgY29sb3IgZm9yXG4gICAgLy8gb2xkIGFuZCBuZXcgbmFtZTogdGhlIG5ldyBvbmUgaGFzIG5vIHR5cENvbG9ycyBlbnRyeSB5ZXQgYnV0IHRha2VzIG92ZXJcbiAgICAvLyB0aGUgb2xkIG9uZSdzIChzZWUgcmVuYW1lVHlwU2V0dGluZ3MpLlxuICAgIGNvbnN0IHsgY291bnRzIH0gPSB0aGlzLnBsdWdpbi50eXBJbmRleC50eXBDb3VudHMoKTtcbiAgICBjb25zdCBjb2xvciA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdID8/IG51bGw7XG4gICAgbmV3IENvbmZpcm1Nb2RhbCh0aGlzLmFwcCwge1xuICAgICAgdGl0bGU6IFtcIlJlbmFtZSBcIiwgdHlwTmFtZU5vZGUodGhpcy5wbHVnaW4sIHR5cCwgY29sb3IpLCBcIiB0byBcIiwgdHlwTmFtZU5vZGUodGhpcy5wbHVnaW4sIHZhbHVlLCBjb2xvciksIFwiP1wiXSxcbiAgICAgIGJvZHk6IFtgJHtwbHVyYWwoY291bnRzLmdldCh0eXApID8/IDAsIFwibm90ZVwiKX0gd2lsbCBiZSB1cGRhdGVkLmBdLFxuICAgICAgY29uZmlybVRleHQ6IFwiUmVuYW1lXCIsXG4gICAgICBmb2N1czogXCJjb25maXJtXCIsXG4gICAgICBvbkNvbmZpcm06IGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5yZW5hbWVUeXBTZXR0aW5ncyh0eXAsIHZhbHVlKTtcbiAgICAgICAgY29uc3QgcmVuYW1lZCA9IGF3YWl0IHJlbmFtZVR5cEluTm90ZXModGhpcy5wbHVnaW4sIHR5cCwgdmFsdWUpO1xuICAgICAgICBuZXcgTm90aWNlKGBUWVAgJHt2YWx1ZX06ICR7cGx1cmFsKHJlbmFtZWQsIFwibm90ZVwiKX0gdXBkYXRlZC5gKTtcbiAgICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgIH0sXG4gICAgICBvbkNhbmNlbDogKCkgPT4gdGhpcy5yZW5kZXIoKSxcbiAgICB9KS5vcGVuKCk7XG4gIH1cblxuICAvLyBNb3ZlcyBvbmx5IHRoZSBzZXR0aW5ncyAobGlzdCBwb3NpdGlvbiwgY29sb3IsIGRlc2NyaXB0aW9uLFxuICAvLyBUWVAtRnJvbnRtYXR0ZXIsIG1hbnVhbCB0b2dnbGUsIFN1YnR5cHMgLSBzZWUgdHlwLXNldHRpbmdzLmpzKSB0byB0aGUgbmV3XG4gIC8vIG5hbWU7IHRvdWNoZXMgbm8gbm90ZXMuIEFuIG9wZW4gZGV0YWlsIHZpZXcgZm9sbG93cyB0aGUgbmV3IG5hbWUsIGFcbiAgLy8gcmVuYW1lIGZyb20gdGhlIGxpc3Qgc3RheXMgaW4gdGhlIGxpc3QuXG4gIGFzeW5jIHJlbmFtZVR5cFNldHRpbmdzKHR5cCwgdmFsdWUpIHtcbiAgICBtb3ZlVHlwU2V0dGluZ3ModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgdmFsdWUpO1xuICAgIGlmICh0aGlzLnNlbGVjdGVkVHlwID09PSB0eXApIHRoaXMuc2VsZWN0ZWRUeXAgPSB2YWx1ZTtcbiAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICB0aGlzLnJlZnJlc2hPdGhlclZpZXdzKCk7XG4gIH1cblxuICAvLyBSZW5hbWluZyB0byB0aGUgbmFtZSBvZiBhbiBhbHJlYWR5IHJlZ2lzdGVyZWQgVFlQIChzZWUgY29tbWl0VHlwUmVuYW1lKVxuICAvLyBvZmZlcnMgdG8gbWVyZ2UgYm90aCAoc2VlIG1lcmdlVHlwKSBpbnN0ZWFkIG9mIHNpbGVudGx5IGRyb3BwaW5nIHRoZVxuICAvLyByZW5hbWUuIEl0IGFsd2F5cyByZXdyaXRlcyB0aGUgbm90ZXMsIHdoaWNoZXZlciByZW5hbWUgYnV0dG9uIHN0YXJ0ZWQgaXQ6XG4gIC8vIGEgbWVyZ2UgaW4gdGhlIHNldHRpbmdzIG9ubHkgd291bGQgbGVhdmUgdGhlIHNvdXJjZSBUWVAncyBub3RlcyBhcyBhblxuICAvLyB1bnJlZ2lzdGVyZWQgZW50cnkuXG4gIHNob3dNZXJnZUNvbmZpcm0oc291cmNlLCB0YXJnZXQpIHtcbiAgICBjb25zdCB7IHNldHRpbmdzIH0gPSB0aGlzLnBsdWdpbjtcbiAgICBjb25zdCBjb3VudCA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnR5cENvdW50cygpLmNvdW50cy5nZXQoc291cmNlKSA/PyAwO1xuICAgIG5ldyBDb25maXJtTW9kYWwodGhpcy5hcHAsIHtcbiAgICAgIHRpdGxlOiBbXG4gICAgICAgIFwiTWVyZ2UgXCIsXG4gICAgICAgIHR5cE5hbWVOb2RlKHRoaXMucGx1Z2luLCBzb3VyY2UsIHNldHRpbmdzLnR5cENvbG9yc1tzb3VyY2VdID8/IG51bGwpLFxuICAgICAgICBcIiBpbnRvIFwiLFxuICAgICAgICB0eXBOYW1lTm9kZSh0aGlzLnBsdWdpbiwgdGFyZ2V0LCBzZXR0aW5ncy50eXBDb2xvcnNbdGFyZ2V0XSA/PyBudWxsKSxcbiAgICAgICAgXCI/XCIsXG4gICAgICBdLFxuICAgICAgYm9keTogW1xuICAgICAgICBgJHt0YXJnZXR9IGFscmVhZHkgZXhpc3RzLiAke3BsdXJhbChjb3VudCwgXCJub3RlXCIpfSAke2NvdW50ID09PSAxID8gXCJtb3Zlc1wiIDogXCJtb3ZlXCJ9IHRvIGl0LiBgICtcbiAgICAgICAgICBgVGhlIGNvbG9yLCBkZXNjcmlwdGlvbiBhbmQgVFlQLUZyb250bWF0dGVyIG9mICR7c291cmNlfSBhcmUgZHJvcHBlZC4gYCArXG4gICAgICAgICAgYEV2ZXJ5IFN1YnR5cCBtb3ZlcyBhbG9uZzsgYmxvY2tzIHdpdGggdGhlIHNhbWUgbmFtZSBhcmUgbWVyZ2VkLmAsXG4gICAgICBdLFxuICAgICAgY29uZmlybVRleHQ6IFwiTWVyZ2VcIixcbiAgICAgIHdhcm5pbmc6IHRydWUsXG4gICAgICBmb2N1czogXCJjYW5jZWxcIixcbiAgICAgIG9uQ29uZmlybTogKCkgPT4gdGhpcy5tZXJnZVR5cChzb3VyY2UsIHRhcmdldCksXG4gICAgICBvbkNhbmNlbDogKCkgPT4gdGhpcy5yZW5kZXIoKSxcbiAgICB9KS5vcGVuKCk7XG4gIH1cblxuICAvLyBNZXJnZXMgc291cmNlIGludG8gdGFyZ2V0OiBub3RlcyBhcmUgcmV3cml0dGVuIHRvIHRhcmdldCwgc291cmNlIGxlYXZlc1xuICAvLyB0aGUgbGlzdCB3aXRoIGl0cyBzZXR0aW5ncyAodGFyZ2V0IGtlZXBzIGl0cyBvd24pLiBTb3VyY2UncyBTdWJ0eXBzIG1vdmVcbiAgLy8gb3ZlciBmaXJzdCwgc2FtZS1uYW1lZCBibG9ja3MgYXJlIGNvbWJpbmVkIChzZWUgbWVyZ2VUeXBTdWJ0eXBzIGluXG4gIC8vIHN1YnR5cHMuanMpOyB0aGVuIHRoZSByZXN0IG9mIHNvdXJjZSBnb2VzIGxpa2UgYSBkZWxldGVkIFRZUC5cbiAgLy9cbiAgLy8gXCJNYW51YWxseSBjcmVhdGFibGVcIiBpcyB3aGVyZSBhIG1lcmdlIGRvZXMgbW9yZSB0aGFuIG1vdmUgZGF0YTogdGhlIG1vdmVkXG4gIC8vIFN1YnR5cHMgYnJpbmcgc291cmNlJ3MgdG9nZ2xlcyBidXQgZW5kIHVwIHVuZGVyIHRhcmdldCdzLiBXaXRoIHNvdXJjZSBvblxuICAvLyBhbmQgdGFyZ2V0IG9mZiB0aGV5IHdvdWxkIGJlIHN3aXRjaGVkLW9uIFN1YnR5cHMgdW5kZXIgYSBzd2l0Y2hlZC1vZmYgVFlQLFxuICAvLyB1bnJlYWNoYWJsZSBpbiB0aGUgcGlja2VyLiBTbyBhIHN3aXRjaGVkLW9mZiB0YXJnZXQgc3dpdGNoZXMgdGhlbSBvZmYgdG9vLFxuICAvLyBhcyBpdHMgb3duIGJ1dHRvbiB3b3VsZCAoc2VlIHJlbmRlck1hbnVhbFRvZ2dsZSkuIFdpdGggdGFyZ2V0IG9uIHRoZXkgc3RheVxuICAvLyBhcyB0aGV5IHdlcmUuXG4gIC8vXG4gIC8vIEFuIG9wZW4gZGV0YWlsIHZpZXcgb2Ygc291cmNlIG1vdmVzIHRvIHRhcmdldDsgYSBtZXJnZSBzdGFydGVkIGZyb20gdGhlXG4gIC8vIGxpc3Qgc3RheXMgaW4gdGhlIGxpc3QuXG4gIGFzeW5jIG1lcmdlVHlwKHNvdXJjZSwgdGFyZ2V0KSB7XG4gICAgY29uc3Qgc2V0dGluZ3MgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncztcbiAgICBjb25zdCByZW5hbWVkID0gYXdhaXQgcmVuYW1lVHlwSW5Ob3Rlcyh0aGlzLnBsdWdpbiwgc291cmNlLCB0YXJnZXQpO1xuXG4gICAgbWVyZ2VUeXBTdWJ0eXBzKHNldHRpbmdzLCBzb3VyY2UsIHRhcmdldCk7XG4gICAgZGVsZXRlVHlwU2V0dGluZ3Moc2V0dGluZ3MsIHNvdXJjZSk7XG4gICAgaWYgKHRoaXMuZW5zdXJlVHlwTWFudWFsKClbdGFyZ2V0XSA9PT0gZmFsc2UpIHNldEFsbFN1YnR5cHNNYW51YWwoc2V0dGluZ3MsIHRhcmdldCwgZmFsc2UpO1xuXG4gICAgaWYgKHRoaXMuc2VsZWN0ZWRUeXAgPT09IHNvdXJjZSkgdGhpcy5zZWxlY3RlZFR5cCA9IHRhcmdldDtcbiAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICB0aGlzLnJlZnJlc2hPdGhlclZpZXdzKCk7XG4gICAgbmV3IE5vdGljZShgVFlQICR7c291cmNlfSBtZXJnZWQgaW50byAke3RhcmdldH0sICR7cGx1cmFsKHJlbmFtZWQsIFwibm90ZVwiKX0gdXBkYXRlZC5gKTtcbiAgICB0aGlzLnJlbmRlcigpO1xuICB9XG5cbiAgcmVuZGVyQ291bnRGbGFpcihzZWxmLCBjb3VudCkge1xuICAgIGNvbnN0IGZsYWlyT3V0ZXIgPSBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0tZmxhaXItb3V0ZXJcIiB9KTtcbiAgICBmbGFpck91dGVyLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHJlZS1pdGVtLWZsYWlyXCIsIHRleHQ6IFN0cmluZyhjb3VudCkgfSk7XG4gIH1cblxuICAvLyBFeHBsYWlucyB0aGUgZmxvYXRpbmcgdG9nZ2xlIChyaWdodC1jbGljayBvbiBhIHByb3BlcnR5IGFib3ZlLCBzZWVcbiAgLy8gZW5zdXJlUHJvcGVydHlNZW51UGF0Y2gpLiBObyBoZWFkaW5nIC0gcmlnaHQgYmVsb3cgdGhlIGxpc3QgaXQgaXMgY2xlYXJcbiAgLy8gd2hhdCBpdCByZWZlcnMgdG8uXG4gIHJlbmRlckZsb2F0aW5nSGludChwYXJlbnQpIHtcbiAgICBjb25zdCBzZWN0aW9uID0gcGFyZW50LmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZmxvYXRpbmctaGludC1zZWN0aW9uXCIgfSk7XG4gICAgc2VjdGlvbi5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcInR5cC1mbG9hdGluZy1oaW50XCIsXG4gICAgICB0ZXh0OiBcIlJpZ2h0LWNsaWNrIGEgcHJvcGVydHkgdG8gbWFrZSBpdCBmbG9hdGluZy5cIixcbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlclR5cFBhbmUocGx1Z2luKSB7XG4gIHBsdWdpbi5yZWdpc3RlclZpZXcoVklFV19UWVBFX1RZUF9QQU5FLCAobGVhZikgPT4gbmV3IFR5cFBhbmUobGVhZiwgcGx1Z2luKSk7XG5cbiAgcGx1Z2luLmFkZENvbW1hbmQoe1xuICAgIGlkOiBcIm9wZW4tdHlwLXBhbmVcIixcbiAgICBuYW1lOiBcIk9wZW4gVFlQLVBhbmVcIixcbiAgICBjYWxsYmFjazogKCkgPT4gYWN0aXZhdGVUeXBQYW5lKHBsdWdpbiksXG4gIH0pO1xuXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJhZGQtdHlwLXByb3BlcnR5XCIsXG4gICAgbmFtZTogXCJBZGQgVFlQLUZyb250bWF0dGVyIHByb3BlcnR5XCIsXG4gICAgY2FsbGJhY2s6ICgpID0+IGFkZFR5cFByb3BlcnR5Q29tbWFuZChwbHVnaW4pLFxuICB9KTtcblxuICAvLyBPbiBob3QgcmVsb2FkIHRoZSBvbGQgbGVhZiBvYmplY3Qgc3Vydml2ZXMgKG9ubHkgb3VyIG1vZHVsZSByZWxvYWRzKSwgYnV0XG4gIC8vIFwiaW5zdGFuY2VvZiBUeXBQYW5lXCIgZmFpbHMgYWdhaW5zdCB0aGUgcmVsb2FkZWQgY2xhc3MsIGFuZCBnZXRWaWV3VHlwZSgpXG4gIC8vIGNvbWVzIGZyb20gbGVhZi52aWV3IGFsb25lLiBgYXBwYCBzdXJ2aXZlcyB1bmNoYW5nZWQsIHNvIHRoZSBsZWFmXG4gIC8vIHJlZmVyZW5jZSBpcyBrZXB0IHRoZXJlLlxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IG9wZW5UeXBQYW5lT25TdGFydChwbHVnaW4pKTtcblxuICAvLyBleGNlcHRWaWV3OiB0aGUgVFlQLVBhbmUgdGhhdCBtYWRlIHRoZSBjaGFuZ2UgYW5kIHVwZGF0ZXMgaXRzZWxmIChzZWVcbiAgLy8gcmVmcmVzaFR5cENvbG9yc0V4Y2VwdCBpbiBtYWluLmpzKS5cbiAgY29uc3QgcmVmcmVzaCA9IChleGNlcHRWaWV3ID0gbnVsbCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoVklFV19UWVBFX1RZUF9QQU5FKSkge1xuICAgICAgaWYgKGxlYWYudmlldyA9PT0gZXhjZXB0VmlldykgY29udGludWU7XG4gICAgICAvLyByZW5kZXIoKSBmb3IgYSB2aWV3IG9mIHRoZSBtb2R1bGUgYmVmb3JlIGEgaG90IHJlbG9hZC5cbiAgICAgIGlmIChsZWFmLnZpZXc/LnJlcXVlc3RSZW5kZXIpIGxlYWYudmlldy5yZXF1ZXN0UmVuZGVyKCk7XG4gICAgICBlbHNlIGxlYWYudmlldz8ucmVuZGVyPy4oKTtcbiAgICB9XG4gIH07XG5cbiAgLy8gS2VlcHMgdGhlIGNvdW50cyBjdXJyZW50IG9uIGV2ZXJ5IFRZUC1yZWxldmFudCBjaGFuZ2UgZWxzZXdoZXJlIChuZXcgb3JcbiAgLy8gZGVsZXRlZCBub3RlLCBUWVAgb3IgU1VCVFlQIGNoYW5nZWQpLiBUaGUgaW5kZXgncyBcImNoYW5nZVwiIGZpcmVzIG9ubHkgZm9yXG4gIC8vIHRob3NlLCBub3Qgb24gZXZlcnkgYXV0b3NhdmUuIERlYm91bmNlZCBhbnl3YXkgc2luY2UgcmVuZGVyaW5nIHRoZSBsaXN0IGlzXG4gIC8vIHJlbGF0aXZlbHkgY29zdGx5OyByZXNldFRpbWVyIGNvbGxlY3RzIGEgYnVyc3QgKGJ1bGsgaW1wb3J0KSBpbnRvIG9uZS5cbiAgLy8gV2l0aG91dCB0aGUgZXZlbnQncyBhcmd1bWVudHMsIHdoaWNoIGFyZW4ndCBhIHZpZXcgdG8gbGVhdmUgb3V0LlxuICBjb25zdCBkZWJvdW5jZWRSZWZyZXNoID0gZGVib3VuY2UoKCkgPT4gcmVmcmVzaCgpLCA1MDAsIHRydWUpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgZGVib3VuY2VkUmVmcmVzaCkpO1xuICAvLyBUaGUgXCJFeGNsdWRlZCBmaWxlc1wiIGxpc3QgY2hhbmdlZCAoSGlkZSBGb2xkZXJzIHRvZ2dsaW5nIGEgZm9sZGVyLCBzYXkpLlxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLnZhdWx0Lm9uKFwiY29uZmlnLWNoYW5nZWRcIiwgZGVib3VuY2VkUmVmcmVzaCkpO1xuXG4gIC8vIEEgVGVtcGxhdGVyIHNjcmlwdCBhcHBlYXJlZCwgdmFuaXNoZWQgb3Igd2FzIHJlbmFtZWQ6IHRoZSBzaG9ydGN1dFxuICAvLyBidXR0b25zIHVwZGF0ZSB0aGVpciBcInNjcmlwdCBub3QgZm91bmRcIiB3YXJuaW5nIChyZWZyZXNoU2hvcnRjdXRDb250cm9scykuXG4gIC8vIFRoZSBsaXN0IGlzIHJlYWQgb25jZSB0aGUgbGF5b3V0IGlzIHJlYWR5IC0gb25seSB0aGVuIGRvZXMgdGhlIHdhcm5pbmdcbiAgLy8gc2hvdyBhdCBhbGwgKHNlZSByZW5kZXJTaG9ydGN1dENvbnRyb2xzKS5cbiAgY29uc3Qgb2ZmU2NyaXB0cyA9IHBsdWdpbi5nZXRTaG9ydGN1dFNjcmlwdHM/Lm9uQ2hhbmdlPy4oKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoVklFV19UWVBFX1RZUF9QQU5FKSkgbGVhZi52aWV3Py5yZWZyZXNoU2hvcnRjdXRDb250cm9scz8uKCk7XG4gIH0pO1xuICBpZiAob2ZmU2NyaXB0cykgcGx1Z2luLnJlZ2lzdGVyKG9mZlNjcmlwdHMpO1xuXG4gIC8vIEZvciBwbHVnaW4ucmVmcmVzaFR5cENvbG9ycyhFeGNlcHQpOiByZS1yZW5kZXJzIHRoZSBsaXN0IG9yIHRoZSBkZXRhaWxcbiAgLy8gdmlldy5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbi8vIGxvY2FsU3RvcmFnZSBrZXkgKHBlciB2YXVsdCwgc2VlIG9wZW5UeXBQYW5lT25TdGFydCkuXG5jb25zdCBQQU5FX0NSRUFURURfS0VZID0gXCJ0eXAtc3lzdGVtLXBhbmUtY3JlYXRlZFwiO1xuXG4vLyBUaGUgYXV0b21hdGljIGNhbGwgb25jZSB0aGUgbGF5b3V0IGlzIHJlYWR5LCBvbiBldmVyeSBzdGFydCBhbmQgaG90IHJlbG9hZC5cbi8vIE5vcm1hbGx5IGl0IG9ubHkgcmVjb25uZWN0cyBhbiBleGlzdGluZyBsZWFmIG9ycGhhbmVkIGJ5IGhvdCByZWxvYWRcbi8vIChjcmVhdGVJZk1pc3Npbmc6IGZhbHNlKSwgc28gYSBwYW5lIHRoYXQgd2FzIGNsb3NlZCBzdGF5cyBjbG9zZWQuIE9ubHkgb24gdGhlXG4vLyB2ZXJ5IGZpcnN0IHN0YXJ0IGluIHRoaXMgdmF1bHQgKG5vIGRhdGEuanNvbiB5ZXQsIHBsdWdpbi5pc0ZpcnN0UnVuKSBpdFxuLy8gY3JlYXRlcyB0aGUgcGFuZSBpbiB0aGUgbGVmdCBzaWRlYmFyIGFuZCByZXZlYWxzIGl0LCBzbyBhIG5ldyB1c2VyIGZpbmRzIGl0XG4vLyB3aXRob3V0IGtub3dpbmcgdGhlIGNvbW1hbmQuXG4vLyBcIkFscmVhZHkgY3JlYXRlZFwiIGlzIHJlbWVtYmVyZWQgaW4gdGhpcyBkZXZpY2UncyBsb2NhbFN0b3JhZ2UgZm9yIHRoZSB2YXVsdFxuLy8gKGFwcC5zYXZlTG9jYWxTdG9yYWdlKSwgbm90IGluIGRhdGEuanNvbjogZGF0YS5qc29uIGlzIHN0aWxsIG1pc3NpbmcgdGhlbixcbi8vIHNvIGEgaG90IHJlbG9hZCB3b3VsZCBvdGhlcndpc2Ugb3BlbiB0aGUgcGFuZSBhZ2Fpbi4gV3JpdGluZyBkYXRhLmpzb24ganVzdFxuLy8gZm9yIHRoaXMgbWFya2VyIGNvdWxkIGxldCBTeW5jIHB1dCBkZWZhdWx0cyBvdmVyIHRoZSByZWFsIHNldHRpbmdzIG9uIGFcbi8vIHNlY29uZCBkZXZpY2Ugd2hlcmUgdGhlIHBsdWdpbiBhcnJpdmVzIGJlZm9yZSBpdHMgZGF0YS5qc29uLlxuYXN5bmMgZnVuY3Rpb24gb3BlblR5cFBhbmVPblN0YXJ0KHBsdWdpbikge1xuICBjb25zdCBhcHAgPSBwbHVnaW4uYXBwO1xuICBjb25zdCBmaXJzdFJ1biA9IHBsdWdpbi5pc0ZpcnN0UnVuICYmICFhcHAubG9hZExvY2FsU3RvcmFnZShQQU5FX0NSRUFURURfS0VZKTtcbiAgYXdhaXQgYWN0aXZhdGVUeXBQYW5lKHBsdWdpbiwgZmlyc3RSdW4sIGZpcnN0UnVuKTtcbiAgaWYgKGZpcnN0UnVuKSBhcHAuc2F2ZUxvY2FsU3RvcmFnZShQQU5FX0NSRUFURURfS0VZLCB0cnVlKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gYWN0aXZhdGVUeXBQYW5lKHBsdWdpbiwgcmV2ZWFsID0gdHJ1ZSwgY3JlYXRlSWZNaXNzaW5nID0gdHJ1ZSkge1xuICBjb25zdCBhcHAgPSBwbHVnaW4uYXBwO1xuICBjb25zdCB7IHdvcmtzcGFjZSB9ID0gYXBwO1xuXG4gIGNvbnN0IGNhbmRpZGF0ZXMgPSBbXTtcbiAgd29ya3NwYWNlLml0ZXJhdGVBbGxMZWF2ZXMoKGxlYWYpID0+IHtcbiAgICBpZiAoXG4gICAgICBsZWFmID09PSBhcHAuX190eXBTeXN0ZW1MZWFmIHx8XG4gICAgICAobGVhZi52aWV3ICYmIGxlYWYudmlldy5nZXRWaWV3VHlwZSgpID09PSBWSUVXX1RZUEVfVFlQX1BBTkUpXG4gICAgKSB7XG4gICAgICBjYW5kaWRhdGVzLnB1c2gobGVhZik7XG4gICAgfVxuICB9KTtcblxuICBsZXQgbGVhZiA9IGNhbmRpZGF0ZXMuc2hpZnQoKSA/PyBudWxsO1xuICBmb3IgKGNvbnN0IGV4dHJhIG9mIGNhbmRpZGF0ZXMpIGV4dHJhLmRldGFjaCgpO1xuXG4gIGlmICghbGVhZikge1xuICAgIGlmICghY3JlYXRlSWZNaXNzaW5nKSByZXR1cm47XG4gICAgbGVhZiA9IHdvcmtzcGFjZS5nZXRMZWZ0TGVhZihmYWxzZSk7XG4gICAgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoeyB0eXBlOiBWSUVXX1RZUEVfVFlQX1BBTkUsIGFjdGl2ZTogdHJ1ZSB9KTtcbiAgfSBlbHNlIGlmICghKGxlYWYudmlldyBpbnN0YW5jZW9mIFR5cFBhbmUpKSB7XG4gICAgLy8gYWN0aXZlOiBmYWxzZSAtIGp1c3QgcmVjb25uZWN0aW5nLiBvbkxheW91dFJlYWR5IGZpcmVzIGF0IG9uY2Ugb25jZSB0aGVcbiAgICAvLyBsYXlvdXQgaXMgcmVhZHksIHNvIGFjdGl2ZTogdHJ1ZSB3b3VsZCBzdGVhbCBmb2N1cyBvbiBldmVyeSBob3QgcmVsb2FkLlxuICAgIGF3YWl0IGxlYWYuc2V0Vmlld1N0YXRlKHsgdHlwZTogVklFV19UWVBFX1RZUF9QQU5FLCBhY3RpdmU6IGZhbHNlIH0pO1xuICB9XG5cbiAgYXBwLl9fdHlwU3lzdGVtTGVhZiA9IGxlYWY7XG4gIGlmIChyZXZlYWwpIHdvcmtzcGFjZS5yZXZlYWxMZWFmKGxlYWYpO1xufVxuXG4vLyBQcmVmZXJzIGFuIG9wZW4gVFlQLVBhbmUgZGV0YWlsIChleGFjdGx5IGxpa2UgaXRzIFwiK1wiIGJ1dHRvbik7IG90aGVyd2lzZVxuLy8gb3BlbnMgdGhlIGRldGFpbCB2aWV3IGZvciB0aGUgYWN0aXZlIG5vdGUncyBUWVAgYW5kIGFkZHMgdGhlIHByb3BlcnR5IHRoZXJlLlxuLy8gV2l0aG91dCBhbiBvcGVuIG5vdGUgb3IgVFlQLCBhIFRZUC1QYW5lIHNob3dpbmcgYSBkZXRhaWwgdmlldyAtIGV2ZW5cbi8vIHVuZm9jdXNlZCAtIGlzIHRoZSBmYWxsYmFjay4gVGhlIGJhcmUgbGlzdCBkb2Vzbid0IGNvdW50OiBpdCBoYXMgbm8gZWRpdG9yXG4vLyB0byBhZGQgdG8uXG5hc3luYyBmdW5jdGlvbiBhZGRUeXBQcm9wZXJ0eUNvbW1hbmQocGx1Z2luKSB7XG4gIGNvbnN0IGFwcCA9IHBsdWdpbi5hcHA7XG5cbiAgY29uc3QgYWN0aXZlVHlwUGFuZSA9IGFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShUeXBQYW5lKTtcbiAgaWYgKGFjdGl2ZVR5cFBhbmUgJiYgYWN0aXZlVHlwUGFuZS5zZWxlY3RlZFR5cCAhPT0gbnVsbCkge1xuICAgIGFjdGl2ZVR5cFBhbmUuZnJvbnRtYXR0ZXJCbG9ja3M/LmFkZEJsYW5rKG51bGwpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IGZpbGUgPSBhcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgY29uc3QgdHlwID0gcGx1Z2luLnR5cEluZGV4LnR5cE9mKGZpbGUpO1xuICBpZiAoIXR5cCkge1xuICAgIGNvbnN0IG9wZW5MZWFmID0gYXBwLndvcmtzcGFjZVxuICAgICAgLmdldExlYXZlc09mVHlwZShWSUVXX1RZUEVfVFlQX1BBTkUpXG4gICAgICAuZmluZCgobGVhZikgPT4gbGVhZi52aWV3IGluc3RhbmNlb2YgVHlwUGFuZSAmJiBsZWFmLnZpZXcuc2VsZWN0ZWRUeXAgIT09IG51bGwpO1xuICAgIGlmIChvcGVuTGVhZikge1xuICAgICAgYXdhaXQgYXBwLndvcmtzcGFjZS5yZXZlYWxMZWFmKG9wZW5MZWFmKTtcbiAgICAgIG9wZW5MZWFmLnZpZXcuZnJvbnRtYXR0ZXJCbG9ja3M/LmFkZEJsYW5rKG51bGwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBuZXcgTm90aWNlKFxuICAgICAgZmlsZVxuICAgICAgICA/IFwiVGhlIGFjdGl2ZSBub3RlIGhhcyBubyBUWVAsIGFuZCBubyBUWVAgaXMgb3BlbiBpbiB0aGUgVFlQLVBhbmUuXCJcbiAgICAgICAgOiBcIk5vIG5vdGUgaXMgb3BlbiwgYW5kIG5vIFRZUCBpcyBvcGVuIGluIHRoZSBUWVAtUGFuZS5cIlxuICAgICk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgYXdhaXQgYWN0aXZhdGVUeXBQYW5lKHBsdWdpbik7XG4gIGNvbnN0IHZpZXcgPSBhcHAuX190eXBTeXN0ZW1MZWFmPy52aWV3O1xuICBpZiAoISh2aWV3IGluc3RhbmNlb2YgVHlwUGFuZSkpIHJldHVybjtcbiAgdmlldy5vcGVuVHlwU2V0dGluZ3ModHlwKTtcbiAgdmlldy5mcm9udG1hdHRlckJsb2Nrcz8uYWRkQmxhbmsobnVsbCk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlclR5cFBhbmUsIFZJRVdfVFlQRV9UWVBfUEFORSwgY29tcGFyZVR5cHMsIHNvcnRUeXBzQnlNb2RlLCBERUZBVUxUX1NPUlRfT1JERVIsIERFRkFVTFRfVFlQX0NPTE9SIH07XG4iLCAiY29uc3QgeyBURmlsZSwgVEZvbGRlciB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBjb2xvckZvckZpbGUsIHNldElubGluZUNvbG9yIH0gPSByZXF1aXJlKFwiLi90eXAtY29sb3JzXCIpO1xuXG5jb25zdCBGSUxFX0VYUExPUkVSX1ZJRVdfVFlQRSA9IFwiZmlsZS1leHBsb3JlclwiO1xuY29uc3QgRk9MREVSX05PVEVTX1BMVUdJTl9JRCA9IFwiZm9sZGVyLW5vdGVzXCI7XG5cbi8vIEZvbGRlciBOb3RlcyBzaG93cyBhIG5vdGUgYXMgaXRzIGZvbGRlciBpbnN0ZWFkIG9mIGFzIGl0cyBvd24gcm93LiBJdCBoYXMgbm9cbi8vIHB1YmxpYyBBUEkgZm9yIHRoaXMsIHNvIHRoZSBmaWxlIG5hbWUgaXMgcmVidWlsdCBmcm9tIGl0cyBsaXZlIHNldHRpbmdzLlxuZnVuY3Rpb24gZ2V0Rm9sZGVyTm90ZUZpbGUocGx1Z2luLCBmb2xkZXIpIHtcbiAgY29uc3QgZm9sZGVyTm90ZXMgPSBwbHVnaW4uYXBwLnBsdWdpbnMucGx1Z2luc1tGT0xERVJfTk9URVNfUExVR0lOX0lEXTtcbiAgY29uc3Qgc2V0dGluZ3MgPSBmb2xkZXJOb3Rlcz8uc2V0dGluZ3M7XG4gIGlmICghc2V0dGluZ3MpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGZpbGVOYW1lID1cbiAgICAoc2V0dGluZ3MuZm9sZGVyTm90ZU5hbWUgfHwgXCJ7e2ZvbGRlcl9uYW1lfX1cIikucmVwbGFjZShcInt7Zm9sZGVyX25hbWV9fVwiLCBmb2xkZXIubmFtZSkgK1xuICAgIChzZXR0aW5ncy5mb2xkZXJOb3RlVHlwZSB8fCBcIi5tZFwiKTtcbiAgY29uc3QgZGlyUGF0aCA9IHNldHRpbmdzLnN0b3JhZ2VMb2NhdGlvbiA9PT0gXCJwYXJlbnRGb2xkZXJcIiA/IGZvbGRlci5wYXJlbnQ/LnBhdGggPz8gXCJcIiA6IGZvbGRlci5wYXRoO1xuICBjb25zdCBwYXRoID0gZGlyUGF0aCA/IGAke2RpclBhdGh9LyR7ZmlsZU5hbWV9YCA6IGZpbGVOYW1lO1xuXG4gIGNvbnN0IGZpbGUgPSBwbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChwYXRoKTtcbiAgcmV0dXJuIGZpbGUgaW5zdGFuY2VvZiBURmlsZSA/IGZpbGUgOiBudWxsO1xufVxuXG5mdW5jdGlvbiBhcHBseUNvbG9yVG9UaXRsZShwbHVnaW4sIHRpdGxlRWwsIGZpbGUpIHtcbiAgY29uc3QgY29udGVudEVsID0gdGl0bGVFbC5xdWVyeVNlbGVjdG9yKFwiLm5hdi1maWxlLXRpdGxlLWNvbnRlbnQsIC5uYXYtZm9sZGVyLXRpdGxlLWNvbnRlbnRcIik7XG4gIGlmICghY29udGVudEVsKSByZXR1cm47XG5cbiAgY29uc3QgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5maWxlRXhwbG9yZXIgPyBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCBcImZpbGVFeHBsb3JlclwiKSA6IG51bGw7XG4gIHNldElubGluZUNvbG9yKGNvbnRlbnRFbCwgY29sb3IpO1xufVxuXG5mdW5jdGlvbiBhcHBseUZpbGVFeHBsb3JlckNvbG9ycyhwbHVnaW4pIHtcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShGSUxFX0VYUExPUkVSX1ZJRVdfVFlQRSkpIHtcbiAgICBjb25zdCBmaWxlVGl0bGVFbHMgPSBsZWFmLnZpZXcuY29udGFpbmVyRWwucXVlcnlTZWxlY3RvckFsbChcIi5uYXYtZmlsZS10aXRsZVtkYXRhLXBhdGhdXCIpO1xuICAgIGZvciAoY29uc3QgdGl0bGVFbCBvZiBmaWxlVGl0bGVFbHMpIHtcbiAgICAgIGNvbnN0IGZpbGUgPSBwbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aCh0aXRsZUVsLmdldEF0dHJpYnV0ZShcImRhdGEtcGF0aFwiKSk7XG4gICAgICBhcHBseUNvbG9yVG9UaXRsZShwbHVnaW4sIHRpdGxlRWwsIGZpbGUgaW5zdGFuY2VvZiBURmlsZSA/IGZpbGUgOiBudWxsKTtcbiAgICB9XG5cbiAgICBjb25zdCBmb2xkZXJUaXRsZUVscyA9IGxlYWYudmlldy5jb250YWluZXJFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLm5hdi1mb2xkZXItdGl0bGVbZGF0YS1wYXRoXVwiKTtcbiAgICBmb3IgKGNvbnN0IHRpdGxlRWwgb2YgZm9sZGVyVGl0bGVFbHMpIHtcbiAgICAgIGNvbnN0IGZvbGRlciA9IHBsdWdpbi5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHRpdGxlRWwuZ2V0QXR0cmlidXRlKFwiZGF0YS1wYXRoXCIpKTtcbiAgICAgIGNvbnN0IG5vdGVGaWxlID0gZm9sZGVyIGluc3RhbmNlb2YgVEZvbGRlciA/IGdldEZvbGRlck5vdGVGaWxlKHBsdWdpbiwgZm9sZGVyKSA6IG51bGw7XG4gICAgICBhcHBseUNvbG9yVG9UaXRsZShwbHVnaW4sIHRpdGxlRWwsIG5vdGVGaWxlKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJGaWxlRXhwbG9yZXJDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseUZpbGVFeHBsb3JlckNvbG9ycyhwbHVnaW4pO1xuXG4gIC8vIFRoZSBleHBsb3JlciByZS1yZW5kZXJzIHJvd3Mgd2hlbiBmb2xkZXJzIGV4cGFuZCBvciBjb2xsYXBzZS5cbiAgY29uc3Qgb2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcihyZWZyZXNoKTtcbiAgY29uc3Qgb2JzZXJ2ZUV4cGxvcmVyTGVhdmVzID0gKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoRklMRV9FWFBMT1JFUl9WSUVXX1RZUEUpKSB7XG4gICAgICBvYnNlcnZlci5vYnNlcnZlKGxlYWYudmlldy5jb250YWluZXJFbCwgeyBjaGlsZExpc3Q6IHRydWUsIHN1YnRyZWU6IHRydWUgfSk7XG4gICAgfVxuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4gb2JzZXJ2ZXIuZGlzY29ubmVjdCgpKTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLnZhdWx0Lm9uKFwicmVuYW1lXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoXG4gICAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgIG9ic2VydmVFeHBsb3JlckxlYXZlcygpO1xuICAgICAgcmVmcmVzaCgpO1xuICAgIH0pXG4gICk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgb2JzZXJ2ZUV4cGxvcmVyTGVhdmVzKCk7XG4gICAgcmVmcmVzaCgpO1xuICB9KTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyRmlsZUV4cGxvcmVyQ29sb3JzIH07XG4iLCAiY29uc3QgeyBjb2xvckZvckZpbGUgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5cbmNvbnN0IEdSQVBIX1ZJRVdfVFlQRVMgPSBbXCJncmFwaFwiLCBcImxvY2FsZ3JhcGhcIl07XG5cbmZ1bmN0aW9uIGhleFRvSW50KGhleCkge1xuICByZXR1cm4gcGFyc2VJbnQoaGV4LnJlcGxhY2UoXCIjXCIsIFwiXCIpLCAxNik7XG59XG5cbi8vIGVuZ2luZS5yZW5kZXIoKSBvbmx5IGNvbnN1bHRzIGl0cyBmaWxlRmlsdGVyIG9uY2UgYSBjb2xvciBncm91cCBleGlzdHM7XG4vLyB3aXRob3V0IG9uZSBldmVyeSBmaWxlIGp1c3QgZ2V0cyBjb2xvcjp0cnVlLiBTbyB3ZSBwYXRjaCByZW5kZXJlci5zZXREYXRhLFxuLy8gcmlnaHQgYmVmb3JlIHRoZSBub2RlIGRhdGEgcmVhY2hlcyB0aGUgV2ViR0wgcmVuZGVyZXIgLSB0aGUgc2FtZSBzcG90IHRoZVxuLy8gY29tbXVuaXR5IHBsdWdpbiBncmFwaC1uZXN0ZWQtdGFncyB1c2VzLiBOb2RlcyBhbHJlYWR5IGNvbG9yZWQgYnkgYSBjb2xvclxuLy8gZ3JvdXAgYXJlIGxlZnQgYWxvbmUuXG5mdW5jdGlvbiBwYXRjaFJlbmRlcmVyKHBsdWdpbiwgcmVuZGVyZXIpIHtcbiAgaWYgKHJlbmRlcmVyLl9fdHlwU3lzdGVtQ29sb3JQYXRjaGVkKSByZXR1cm47XG4gIHJlbmRlcmVyLl9fdHlwU3lzdGVtQ29sb3JQYXRjaGVkID0gdHJ1ZTtcblxuICBjb25zdCBvcmlnaW5hbCA9IHJlbmRlcmVyLnNldERhdGE7XG4gIHJlbmRlcmVyLnNldERhdGEgPSBmdW5jdGlvbiAoZGF0YSkge1xuICAgIGZvciAoY29uc3QgcGF0aCBpbiBkYXRhLm5vZGVzKSB7XG4gICAgICBjb25zdCBub2RlID0gZGF0YS5ub2Rlc1twYXRoXTtcbiAgICAgIGlmIChub2RlLmNvbG9yKSBjb250aW51ZTtcblxuICAgICAgaWYgKG5vZGUudHlwZSA9PT0gXCJ0YWdcIikge1xuICAgICAgICAvLyBPd24gdGFnIGNvbG9yIGRpc2FibGVkICgyMDI2LTA5LTMwKTogdGhlIE1pbmltYWwgdGhlbWUncyBTdHlsZVxuICAgICAgICAvLyBTZXR0aW5ncyBhbHJlYWR5IGNvdmVyIGl0IChHcmFwaHMgXHUyMTkyIFRhZyBub2RlIGNvbG9yKS5cbiAgICAgICAgLy8gaWYgKHBsdWdpbi5zZXR0aW5ncy5ncmFwaFRhZ0NvbG9yRW5hYmxlZCAmJiBwbHVnaW4uc2V0dGluZ3MuZ3JhcGhUYWdDb2xvcikge1xuICAgICAgICAvLyAgIG5vZGUuY29sb3IgPSB7IGE6IDEsIHJnYjogaGV4VG9JbnQocGx1Z2luLnNldHRpbmdzLmdyYXBoVGFnQ29sb3IpIH07XG4gICAgICAgIC8vIH1cbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGZpbGUgPSBwbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChwYXRoKTtcbiAgICAgIGxldCBjb2xvciA9IG51bGw7XG5cbiAgICAgIGlmIChmaWxlICYmIGZpbGUuZXh0ZW5zaW9uICE9PSBcIm1kXCIpIHtcbiAgICAgICAgLy8gT3duIGF0dGFjaG1lbnQgY29sb3IgZGlzYWJsZWQgKDIwMjYtMDktMzApLCBzZWUgdGFnIGNvbG9yIGFib3ZlXG4gICAgICAgIC8vIChHcmFwaHMgXHUyMTkyIEF0dGFjaG1lbnQgbm9kZSBjb2xvcikuXG4gICAgICAgIC8vIGlmIChwbHVnaW4uc2V0dGluZ3MuZ3JhcGhBdHRhY2htZW50Q29sb3JFbmFibGVkICYmIHBsdWdpbi5zZXR0aW5ncy5ncmFwaEF0dGFjaG1lbnRDb2xvcikge1xuICAgICAgICAvLyAgIGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmdyYXBoQXR0YWNobWVudENvbG9yO1xuICAgICAgICAvLyB9XG4gICAgICB9IGVsc2UgaWYgKHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmdyYXBoKSB7XG4gICAgICAgIGNvbG9yID0gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSwgXCJncmFwaFwiKTtcbiAgICAgIH1cblxuICAgICAgaWYgKGNvbG9yKSBub2RlLmNvbG9yID0geyBhOiAxLCByZ2I6IGhleFRvSW50KGNvbG9yKSB9O1xuICAgIH1cbiAgICByZXR1cm4gb3JpZ2luYWwuY2FsbCh0aGlzLCBkYXRhKTtcbiAgfTtcblxuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4ge1xuICAgIHJlbmRlcmVyLnNldERhdGEgPSBvcmlnaW5hbDtcbiAgICBkZWxldGUgcmVuZGVyZXIuX190eXBTeXN0ZW1Db2xvclBhdGNoZWQ7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBnZXRHcmFwaExlYXZlcyhhcHApIHtcbiAgY29uc3QgbGVhdmVzID0gW107XG4gIGZvciAoY29uc3Qgdmlld1R5cGUgb2YgR1JBUEhfVklFV19UWVBFUykgbGVhdmVzLnB1c2goLi4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUodmlld1R5cGUpKTtcbiAgcmV0dXJuIGxlYXZlcztcbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJHcmFwaENvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgZ2V0R3JhcGhMZWF2ZXMocGx1Z2luLmFwcCkpIHtcbiAgICAgIGlmIChsZWFmLnZpZXc/LnJlbmRlcmVyKSBwYXRjaFJlbmRlcmVyKHBsdWdpbiwgbGVhZi52aWV3LnJlbmRlcmVyKTtcbiAgICAgIC8vIFRoZSBnbG9iYWwgZ3JhcGgga2VlcHMgaXRzIGVuZ2luZSBpbiB2aWV3LmRhdGFFbmdpbmUsIHRoZSBsb2NhbCBvbmUgaW5cbiAgICAgIC8vIHZpZXcuZW5naW5lLlxuICAgICAgKGxlYWYudmlldz8uZGF0YUVuZ2luZSA/PyBsZWFmLnZpZXc/LmVuZ2luZSk/LnJlbmRlcigpO1xuICAgIH1cbiAgfTtcblxuICAvLyBSZWdpc3RlcmVkIGJlZm9yZSBhbnkgcGF0Y2hSZW5kZXJlcigpIGNsZWFudXAsIHNvIGl0IHJ1bnMgYWZ0ZXIgdGhlbSBvblxuICAvLyB1bmxvYWQgKE9ic2lkaWFuIHJ1bnMgdGhlc2UgY2FsbGJhY2tzIGxhc3QtaW4sIGZpcnN0LW91dCk6IHdpdGggc2V0RGF0YVxuICAvLyBiYWNrIHRvIHRoZSBvcmlnaW5hbCwgb25lIHJlbmRlcigpIGRyYXdzIHRoZSBncmFwaCB3aXRob3V0IFRZUCBjb2xvcnMgYXRcbiAgLy8gb25jZSBpbnN0ZWFkIG9mIG9uIGl0cyBuZXh0IGNoYW5nZS5cbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgZ2V0R3JhcGhMZWF2ZXMocGx1Z2luLmFwcCkpIChsZWFmLnZpZXc/LmRhdGFFbmdpbmUgPz8gbGVhZi52aWV3Py5lbmdpbmUpPy5yZW5kZXIoKTtcbiAgfSk7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeShyZWZyZXNoKTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyR3JhcGhDb2xvcnMgfTtcbiIsICJjb25zdCB7IGNvbG9yRm9yRmlsZSwgc2V0SW5saW5lQ29sb3IgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5cbmNvbnN0IFNFQVJDSF9WSUVXX1RZUEUgPSBcInNlYXJjaFwiO1xuXG4vLyBTZWFyY2ggcmVzdWx0IHJvd3MgaGF2ZSBubyBkYXRhLXBhdGgsIGJ1dCB0aGUgdmlldyBrZWVwcyBhIFRGaWxlIC0+IHJlc3VsdFxuLy8gRE9NIG1hcCAoZG9tLnJlc3VsdERvbUxvb2t1cCkgdGhhdCBsaW5rcyBmaWxlIGFuZCByb3cgZGlyZWN0bHkuXG5mdW5jdGlvbiBhcHBseVNlYXJjaENvbG9ycyhwbHVnaW4pIHtcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShTRUFSQ0hfVklFV19UWVBFKSkge1xuICAgIGNvbnN0IHJlc3VsdERvbUxvb2t1cCA9IGxlYWYudmlldz8uZG9tPy5yZXN1bHREb21Mb29rdXA7XG4gICAgaWYgKCFyZXN1bHREb21Mb29rdXApIGNvbnRpbnVlO1xuXG4gICAgZm9yIChjb25zdCBbZmlsZSwgcmVzdWx0RG9tXSBvZiByZXN1bHREb21Mb29rdXApIHtcbiAgICAgIGNvbnN0IHRpdGxlRWwgPSByZXN1bHREb20uZWw/LnF1ZXJ5U2VsZWN0b3IoXCIuc2VhcmNoLXJlc3VsdC1maWxlLXRpdGxlIC50cmVlLWl0ZW0taW5uZXJcIik7XG4gICAgICBpZiAoIXRpdGxlRWwpIGNvbnRpbnVlO1xuXG4gICAgICBjb25zdCBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnNlYXJjaCA/IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIFwic2VhcmNoXCIpIDogbnVsbDtcbiAgICAgIHNldElubGluZUNvbG9yKHRpdGxlRWwsIGNvbG9yKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJTZWFyY2hDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseVNlYXJjaENvbG9ycyhwbHVnaW4pO1xuXG4gIC8vIFJlc3VsdHMgYXJlIHJlYnVpbHQgb24gZXZlcnkga2V5c3Ryb2tlLlxuICBjb25zdCBvYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKHJlZnJlc2gpO1xuICBjb25zdCBvYnNlcnZlTGVhdmVzID0gKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoU0VBUkNIX1ZJRVdfVFlQRSkpIHtcbiAgICAgIG9ic2VydmVyLm9ic2VydmUobGVhZi52aWV3LmNvbnRhaW5lckVsLCB7IGNoaWxkTGlzdDogdHJ1ZSwgc3VidHJlZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiBvYnNlcnZlci5kaXNjb25uZWN0KCkpO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KFxuICAgIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgICByZWZyZXNoKCk7XG4gICAgfSlcbiAgKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgcmVmcmVzaCgpO1xuICB9KTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyU2VhcmNoQ29sb3JzIH07XG4iLCAiY29uc3QgeyBjb2xvckZvckZpbGUsIHNldElubGluZUNvbG9yIH0gPSByZXF1aXJlKFwiLi90eXAtY29sb3JzXCIpO1xuXG5jb25zdCBSRUNFTlRfRklMRVNfVklFV19UWVBFID0gXCJyZWNlbnQtZmlsZXNcIjtcblxuLy8gUmVjZW50IEZpbGVzIHJvd3MgaGF2ZSBubyBkYXRhLXBhdGgsIGJ1dCB0aGUgbGlzdCBpcyByZW5kZXJlZCBzdHJhaWdodCBmcm9tXG4vLyBkYXRhLnJlY2VudEZpbGVzIHdpdGhvdXQgc2tpcHBpbmcgZW50cmllcywgc28gdGhlIGluZGV4IG1hcHMgcm93IHRvIHBhdGguXG5mdW5jdGlvbiBhcHBseVJlY2VudEZpbGVzQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFJFQ0VOVF9GSUxFU19WSUVXX1RZUEUpKSB7XG4gICAgY29uc3QgcmVjZW50RmlsZXMgPSBsZWFmLnZpZXc/LmRhdGE/LnJlY2VudEZpbGVzO1xuICAgIGlmICghQXJyYXkuaXNBcnJheShyZWNlbnRGaWxlcykpIGNvbnRpbnVlO1xuXG4gICAgY29uc3QgdGl0bGVFbHMgPSBsZWFmLnZpZXcuY29udGFpbmVyRWwucXVlcnlTZWxlY3RvckFsbChcIi5yZWNlbnQtZmlsZXMtdGl0bGUgLm5hdi1maWxlLXRpdGxlLWNvbnRlbnRcIik7XG4gICAgdGl0bGVFbHMuZm9yRWFjaCgodGl0bGVFbCwgaW5kZXgpID0+IHtcbiAgICAgIGNvbnN0IGVudHJ5ID0gcmVjZW50RmlsZXNbaW5kZXhdO1xuICAgICAgY29uc3QgZmlsZSA9IGVudHJ5ID8gcGx1Z2luLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoZW50cnkucGF0aCkgOiBudWxsO1xuICAgICAgY29uc3QgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5yZWNlbnRGaWxlcyA/IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIFwicmVjZW50RmlsZXNcIikgOiBudWxsO1xuICAgICAgc2V0SW5saW5lQ29sb3IodGl0bGVFbCwgY29sb3IpO1xuICAgIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyUmVjZW50RmlsZXNDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseVJlY2VudEZpbGVzQ29sb3JzKHBsdWdpbik7XG5cbiAgY29uc3Qgb2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcihyZWZyZXNoKTtcbiAgY29uc3Qgb2JzZXJ2ZUxlYXZlcyA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFJFQ0VOVF9GSUxFU19WSUVXX1RZUEUpKSB7XG4gICAgICBvYnNlcnZlci5vYnNlcnZlKGxlYWYudmlldy5jb250YWluZXJFbCwgeyBjaGlsZExpc3Q6IHRydWUsIHN1YnRyZWU6IHRydWUgfSk7XG4gICAgfVxuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4gb2JzZXJ2ZXIuZGlzY29ubmVjdCgpKTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgICAgcmVmcmVzaCgpO1xuICAgIH0pXG4gICk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgIHJlZnJlc2goKTtcbiAgfSk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlclJlY2VudEZpbGVzQ29sb3JzIH07XG4iLCAiY29uc3QgeyBjb2xvckZvckZpbGUsIHNldElubGluZUNvbG9yIH0gPSByZXF1aXJlKFwiLi90eXAtY29sb3JzXCIpO1xuXG5jb25zdCBCQUNLTElOS19WSUVXX1RZUEUgPSBcImJhY2tsaW5rXCI7XG5cbi8vIFRoZSBiYWNrbGlua3MgcGFuZSByZW5kZXJzIHJlc3VsdHMgd2l0aCB0aGUgc2FtZSBTZWFyY2hSZXN1bHREb20gY2xhc3MgYXNcbi8vIHNlYXJjaC4gTGlua2VkIGFuZCB1bmxpbmtlZCBtZW50aW9ucyBhcmUgdHdvIHJlc3VsdERvbUxvb2t1cCBtYXBzIG9uIHRoZVxuLy8gcmVuZGVyZXIgKHZpZXcuYmFja2xpbmspLiBUaGUgZmllbGQgbmFtZXMgYXJlIHVuZG9jdW1lbnRlZCwgc28gc2V2ZXJhbFxuLy8ga25vd24gcGF0aHMgYXJlIHRyaWVkLlxuZnVuY3Rpb24gZ2V0UmVzdWx0RG9tTG9va3Vwcyh2aWV3KSB7XG4gIGNvbnN0IHJlbmRlcmVyID0gdmlldz8uYmFja2xpbms7XG4gIGNvbnN0IGNhbmRpZGF0ZXMgPSBbcmVuZGVyZXI/LmJhY2tsaW5rRG9tLCByZW5kZXJlcj8udW5saW5rZWREb20sIHZpZXc/LmJhY2tsaW5rRG9tLCB2aWV3Py51bmxpbmtlZERvbSwgdmlldz8uZG9tXTtcblxuICBjb25zdCBsb29rdXBzID0gW107XG4gIGZvciAoY29uc3QgZG9tIG9mIGNhbmRpZGF0ZXMpIHtcbiAgICBpZiAoZG9tPy5yZXN1bHREb21Mb29rdXAgaW5zdGFuY2VvZiBNYXApIGxvb2t1cHMucHVzaChkb20ucmVzdWx0RG9tTG9va3VwKTtcbiAgfVxuICByZXR1cm4gbG9va3Vwcztcbn1cblxuZnVuY3Rpb24gY29sb3JUaXRsZUVsKHBsdWdpbiwgZWwsIGZpbGUpIHtcbiAgY29uc3QgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5iYWNrbGlua3MgPyBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCBcImJhY2tsaW5rc1wiKSA6IG51bGw7XG4gIHNldElubGluZUNvbG9yKGVsLCBjb2xvcik7XG59XG5cbmZ1bmN0aW9uIGFwcGx5QmFja2xpbmtQYW5lQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEJBQ0tMSU5LX1ZJRVdfVFlQRSkpIHtcbiAgICBmb3IgKGNvbnN0IGxvb2t1cCBvZiBnZXRSZXN1bHREb21Mb29rdXBzKGxlYWYudmlldykpIHtcbiAgICAgIGZvciAoY29uc3QgW2ZpbGUsIHJlc3VsdERvbV0gb2YgbG9va3VwKSB7XG4gICAgICAgIGNvbnN0IHRpdGxlRWwgPSByZXN1bHREb20uZWw/LnF1ZXJ5U2VsZWN0b3IoXCIuc2VhcmNoLXJlc3VsdC1maWxlLXRpdGxlIC50cmVlLWl0ZW0taW5uZXJcIik7XG4gICAgICAgIGlmICh0aXRsZUVsKSBjb2xvclRpdGxlRWwocGx1Z2luLCB0aXRsZUVsLCBmaWxlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuLy8gQmFja2xpbmtzIGluIHRoZSBkb2N1bWVudCBhcmUgbm90IGEgbGVhZiBvZiB0aGVpciBvd24gYnV0IGVtYmVkZGVkIGF0IHRoZVxuLy8gYm90dG9tIG9mIHRoZSBtYXJrZG93biB2aWV3ICguZW1iZWRkZWQtYmFja2xpbmtzKS4gUm93cyBoYXZlIG5vIGRhdGEtcGF0aCxcbi8vIHNvIHRoZSBmaWxlIGlzIHJlc29sdmVkIGZyb20gdGhlIHNob3duIG5hbWUsIHRoZSB3YXkgT2JzaWRpYW4gcmVzb2x2ZXMgbGlua3MuXG5mdW5jdGlvbiBhcHBseUVtYmVkZGVkQmFja2xpbmtDb2xvcnMocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xuICAgIGNvbnN0IHBhbmVFbCA9IGxlYWYudmlldy5jb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKFwiLmVtYmVkZGVkLWJhY2tsaW5rcyAuYmFja2xpbmstcGFuZVwiKTtcbiAgICBpZiAoIXBhbmVFbCkgY29udGludWU7XG5cbiAgICBjb25zdCBzb3VyY2VQYXRoID0gbGVhZi52aWV3LmZpbGU/LnBhdGggPz8gXCJcIjtcbiAgICBjb25zdCB0aXRsZUVscyA9IHBhbmVFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLnNlYXJjaC1yZXN1bHQtZmlsZS10aXRsZSAudHJlZS1pdGVtLWlubmVyXCIpO1xuICAgIGZvciAoY29uc3QgdGl0bGVFbCBvZiB0aXRsZUVscykge1xuICAgICAgY29uc3QgYmFzZW5hbWUgPSB0aXRsZUVsLnRleHRDb250ZW50O1xuICAgICAgY29uc3QgZmlsZSA9IGJhc2VuYW1lID8gcGx1Z2luLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpcnN0TGlua3BhdGhEZXN0KGJhc2VuYW1lLCBzb3VyY2VQYXRoKSA6IG51bGw7XG4gICAgICBjb2xvclRpdGxlRWwocGx1Z2luLCB0aXRsZUVsLCBmaWxlKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gYXBwbHlCYWNrbGlua0NvbG9ycyhwbHVnaW4pIHtcbiAgYXBwbHlCYWNrbGlua1BhbmVDb2xvcnMocGx1Z2luKTtcbiAgYXBwbHlFbWJlZGRlZEJhY2tsaW5rQ29sb3JzKHBsdWdpbik7XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyQmFja2xpbmtDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseUJhY2tsaW5rQ29sb3JzKHBsdWdpbik7XG5cbiAgLy8gT25seSB0aGUgc21hbGwgc2lkZWJhciBwYW5lIGlzIG9ic2VydmVkLCBuZXZlciBhIG1hcmtkb3duIHZpZXc6IGEgc3VidHJlZVxuICAvLyBvYnNlcnZlciBuZWFyIHRoZSBlZGl0b3IgZmlyZXMgb24gZXZlcnkga2V5c3Ryb2tlIGFuZCBvbmNlIGZyb3plIHRoaXNcbiAgLy8gdmF1bHQuIFRoZSBlbWJlZGRlZCBiYWNrbGlua3Mgb25seSBjaGFuZ2Ugd2hlbiBsaW5rcyBjaGFuZ2UgKFwicmVzb2x2ZWRcIilcbiAgLy8gb3IgdGhlIG5vdGUgY2hhbmdlcyAobGF5b3V0LWNoYW5nZS9hY3RpdmUtbGVhZi1jaGFuZ2UpLCBib3RoIGNvdmVyZWQgYmVsb3cuXG4gIGNvbnN0IG9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIocmVmcmVzaCk7XG4gIGNvbnN0IG9ic2VydmVMZWF2ZXMgPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShCQUNLTElOS19WSUVXX1RZUEUpKSB7XG4gICAgICBvYnNlcnZlci5vYnNlcnZlKGxlYWYudmlldy5jb250YWluZXJFbCwgeyBjaGlsZExpc3Q6IHRydWUsIHN1YnRyZWU6IHRydWUgfSk7XG4gICAgfVxuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4gb2JzZXJ2ZXIuZGlzY29ubmVjdCgpKTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLm1ldGFkYXRhQ2FjaGUub24oXCJyZXNvbHZlZFwiLCAoKSA9PiBhcHBseUVtYmVkZGVkQmFja2xpbmtDb2xvcnMocGx1Z2luKSkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgICAgcmVmcmVzaCgpO1xuICAgIH0pXG4gICk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwiYWN0aXZlLWxlYWYtY2hhbmdlXCIsIHJlZnJlc2gpKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgcmVmcmVzaCgpO1xuICB9KTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyQmFja2xpbmtDb2xvcnMgfTtcbiIsICJjb25zdCB7IGNvbG9yRm9yRmlsZSwgc2V0SW5saW5lQ29sb3IgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5cbmNvbnN0IEJPT0tNQVJLU19WSUVXX1RZUEUgPSBcImJvb2ttYXJrc1wiO1xuY29uc3QgQk9PS01BUktTX1BMVUdJTl9JRCA9IFwiYm9va21hcmtzXCI7XG5cbi8vIEJvb2ttYXJrIHJvd3MgaGF2ZSBubyBkYXRhLXBhdGguIFRoZSB2aWV3IGtlZXBzIGEgV2Vha01hcCAodmlldy5pdGVtRG9tczpcbi8vIGl0ZW0gLT4gdHJlZSBpdGVtIHdpdGggLnRpdGxlRWwpLCB3aGljaCBjYW4ndCBiZSBpdGVyYXRlZCwgc28gd2Ugd2FsayB0aGVcbi8vIHBsdWdpbidzIG93biBpdGVtIHRyZWUgKGFsd2F5cyBjb21wbGV0ZSwgd2hhdGV2ZXIgaXMgY29sbGFwc2VkKSBhbmQgbG9vayB1cFxuLy8gZWFjaCBpdGVtJ3Mgcm93IHdpdGggLmdldCgpLlxuZnVuY3Rpb24gZm9yRWFjaEZpbGVCb29rbWFyayhpdGVtcywgY2FsbGJhY2spIHtcbiAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zID8/IFtdKSB7XG4gICAgaWYgKGl0ZW0udHlwZSA9PT0gXCJmaWxlXCIpIGNhbGxiYWNrKGl0ZW0pO1xuICAgIGVsc2UgaWYgKGl0ZW0udHlwZSA9PT0gXCJncm91cFwiKSBmb3JFYWNoRmlsZUJvb2ttYXJrKGl0ZW0uaXRlbXMsIGNhbGxiYWNrKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBhcHBseUJvb2ttYXJrc0NvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgYm9va21hcmtzUGx1Z2luID0gcGx1Z2luLmFwcC5pbnRlcm5hbFBsdWdpbnMuZ2V0RW5hYmxlZFBsdWdpbkJ5SWQoQk9PS01BUktTX1BMVUdJTl9JRCk7XG4gIGlmICghYm9va21hcmtzUGx1Z2luKSByZXR1cm47XG5cbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShCT09LTUFSS1NfVklFV19UWVBFKSkge1xuICAgIGNvbnN0IGl0ZW1Eb21zID0gbGVhZi52aWV3Py5pdGVtRG9tcztcbiAgICBpZiAoIWl0ZW1Eb21zKSBjb250aW51ZTtcblxuICAgIGZvckVhY2hGaWxlQm9va21hcmsoYm9va21hcmtzUGx1Z2luLml0ZW1zLCAoaXRlbSkgPT4ge1xuICAgICAgY29uc3QgdGl0bGVFbCA9IGl0ZW1Eb21zLmdldChpdGVtKT8udGl0bGVFbDtcbiAgICAgIGlmICghdGl0bGVFbCkgcmV0dXJuO1xuXG4gICAgICBjb25zdCBmaWxlID0gcGx1Z2luLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoaXRlbS5wYXRoKTtcbiAgICAgIGNvbnN0IGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MuYm9va21hcmtzID8gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSwgXCJib29rbWFya3NcIikgOiBudWxsO1xuICAgICAgc2V0SW5saW5lQ29sb3IodGl0bGVFbCwgY29sb3IpO1xuICAgIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyQm9va21hcmtzQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlCb29rbWFya3NDb2xvcnMocGx1Z2luKTtcblxuICAvLyBSb3dzIGFyZSByZS1yZW5kZXJlZCB3aGVuIGdyb3VwcyBleHBhbmQvY29sbGFwc2Ugb3IgYm9va21hcmtzIGNoYW5nZS5cbiAgY29uc3Qgb2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcihyZWZyZXNoKTtcbiAgY29uc3Qgb2JzZXJ2ZUxlYXZlcyA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEJPT0tNQVJLU19WSUVXX1RZUEUpKSB7XG4gICAgICBvYnNlcnZlci5vYnNlcnZlKGxlYWYudmlldy5jb250YWluZXJFbCwgeyBjaGlsZExpc3Q6IHRydWUsIHN1YnRyZWU6IHRydWUgfSk7XG4gICAgfVxuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4gb2JzZXJ2ZXIuZGlzY29ubmVjdCgpKTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgICAgcmVmcmVzaCgpO1xuICAgIH0pXG4gICk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgIHJlZnJlc2goKTtcbiAgfSk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckJvb2ttYXJrc0NvbG9ycyB9O1xuIiwgImNvbnN0IHsgVEZpbGUgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgY29sb3JGb3JGaWxlLCBzdWJ0eXBDb2xvciwgc3VidHlwSGFzT3duQ29sb3IsIHNldElubGluZUNvbG9yIH0gPSByZXF1aXJlKFwiLi90eXAtY29sb3JzXCIpO1xuY29uc3QgeyBnZXRTdWJ0eXAgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cHNcIik7XG5cbmNvbnN0IERPVF9DTEFTUyA9IFwidHlwLXRpdGxlLWRvdFwiO1xuY29uc3QgRE9UX0hPTExPV19DTEFTUyA9IFwidHlwLXRpdGxlLWRvdC1ob2xsb3dcIjtcbi8vIFNhbWUgYXMgREVGQVVMVF9UWVBfQ09MT1IgaW4gdHlwLXBhbmUuanMgKGEgVFlQIHdpdGhvdXQgaXRzIG93biBjb2xvcikuXG5jb25zdCBERUZBVUxUX0RPVF9DT0xPUiA9IFwiIzg4ODg4OFwiO1xuY29uc3QgQkFER0VfQ0xBU1MgPSBcInR5cC10aXRsZS1iYWRnZVwiO1xuY29uc3QgQkFER0VfUExBSU5fQ0xBU1MgPSBcInR5cC10aXRsZS1iYWRnZS1wbGFpblwiO1xuY29uc3QgQ09MT1JfVkFSID0gXCItLXR5cC10aXRsZS1jb2xvclwiO1xuXG5jb25zdCBCTE9DS19CQURHRV9DTEFTUyA9IFwidHlwLWJsb2NrLWJhZGdlXCI7XG5jb25zdCBCTE9DS19CQURHRV9QTEFJTl9DTEFTUyA9IFwidHlwLWJsb2NrLWJhZGdlLXBsYWluXCI7XG5jb25zdCBCTE9DS19BTElHTl9UT1BfQ0xBU1MgPSBcInR5cC1ibG9jay1iYWRnZS10b3BcIjtcbmNvbnN0IEJMT0NLX0FMSUdOX0JPVFRPTV9DTEFTUyA9IFwidHlwLWJsb2NrLWJhZGdlLWJvdHRvbVwiO1xuY29uc3QgQkxPQ0tfQ09MT1JfVkFSID0gXCItLXR5cC1ibG9jay1jb2xvclwiO1xuXG4vLyBub3RlVGl0bGVTdHlsZTogXCJub25lXCIgfCBcImRvdFwiIHwgXCJiYWRnZVwiLiBGb3IgXCJiYWRnZVwiLCBub3RlVGl0bGVCYWRnZUNvbG9yZWRcbi8vIGFuZCBub3RlVGl0bGVCYWRnZVBvc2l0aW9uIChcInRpdGxlXCIgfCBcImJsb2NrXCIsIHBsdXMgbm90ZVRpdGxlVmVydGljYWxBbGlnblxuLy8gZm9yIFwiYmxvY2tcIikgcmVmaW5lIGl0LiBjb2xvclZpZXdzLm5vdGVUaXRsZUNvbG9yICh0aGUgdGl0bGUgdGV4dCBpdHNlbGYpIGlzXG4vLyBpbmRlcGVuZGVudCBhbmQgY29tYmluZXMgd2l0aCBhbnkgb2YgdGhlc2UuXG5mdW5jdGlvbiByZXNvbHZlTWFya2VyKHBsdWdpbiwgZmlsZSkge1xuICBjb25zdCBzdHlsZSA9IHBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVTdHlsZTtcbiAgaWYgKHN0eWxlID09PSBcIm5vbmVcIikgcmV0dXJuIHsga2luZDogXCJub25lXCIgfTtcbiAgaWYgKHN0eWxlID09PSBcImRvdFwiKSByZXR1cm4geyBraW5kOiBcImRvdFwiLCAuLi5yZXNvbHZlRG90KHBsdWdpbiwgZmlsZSkgfTtcblxuICAvLyBcImJhZGdlXCI6IGNvbG9yZWQsIGEgcmVnaXN0ZXJlZCBUWVAgd2l0aG91dCBhIGNvbG9yIGdldHMgdGhlIGdyYXkgZGVmYXVsdFxuICAvLyAobGlrZSB0aGUgcmluZyBpbiByZXNvbHZlRG90KTsgYW4gdW5yZWdpc3RlcmVkIFRZUCBnZXRzIG5vIGNvbG9yZWQgYmFkZ2UsXG4gIC8vIGp1c3QgYXMgaXQgZ2V0cyBubyBkb3QuXG4gIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHBsdWdpbjtcbiAgY29uc3QgdHlwID0gcGx1Z2luLnR5cEluZGV4LnR5cE9mKGZpbGUpO1xuICBpZiAoIXR5cCkgcmV0dXJuIHsga2luZDogXCJub25lXCIgfTtcbiAgY29uc3QgY29sb3JlZCA9IHNldHRpbmdzLm5vdGVUaXRsZUJhZGdlQ29sb3JlZDtcbiAgaWYgKGNvbG9yZWQgJiYgIXNldHRpbmdzLnR5cENvbG9yc1t0eXBdICYmICFzZXR0aW5ncy50eXBzLmluY2x1ZGVzKHR5cCkpIHJldHVybiB7IGtpbmQ6IFwibm9uZVwiIH07XG4gIGNvbnN0IHR5cENvbG9yID0gc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPz8gREVGQVVMVF9ET1RfQ09MT1I7XG5cbiAgY29uc3QgbGFiZWwgPSBiYWRnZUxhYmVsKHBsdWdpbiwgZmlsZSwgdHlwKTtcbiAgaWYgKCFsYWJlbCkgcmV0dXJuIHsga2luZDogXCJub25lXCIgfTtcbiAgY29uc3QgeyB0ZXh0LCB1c2VTdWJ0eXBDb2xvciwgc3VidHlwIH0gPSBsYWJlbDtcbiAgY29uc3QgY29sb3IgPSBjb2xvcmVkID8gKHVzZVN1YnR5cENvbG9yID8gc3VidHlwQ29sb3Ioc2V0dGluZ3MsIHR5cCwgc3VidHlwKSA/PyB0eXBDb2xvciA6IHR5cENvbG9yKSA6IG51bGw7XG4gIGNvbnN0IHBvc2l0aW9uID0gc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VQb3NpdGlvbjtcbiAgcmV0dXJuIHsga2luZDogcG9zaXRpb24gPT09IFwiYmxvY2tcIiA/IFwiYmxvY2stYmFkZ2VcIiA6IFwidGl0bGUtYmFkZ2VcIiwgY29sb3JlZCwgY29sb3IsIHR5cE5hbWU6IHRleHQgfTtcbn1cblxuLy8gQmFkZ2UgbGFiZWwgKG5vdGVUaXRsZUJhZGdlTGFiZWwpIHdpdGggaXRzIGNvbG9yOiBbVFlQXSBpbiB0aGUgVFlQIGNvbG9yLFxuLy8gW1N1YnR5cF0gaW4gdGhlIFN1YnR5cCBjb2xvciAobm8gYmFkZ2Ugd2l0aG91dCBhIFN1YnR5cCksIFtUWVAvU3VidHlwXVxuLy8gZGVwZW5kaW5nIG9uIHRoZSBcIlN1YnR5cCBjb2xvclwiIHRvZ2dsZSAoY29sb3JWaWV3cy5ub3RlVGl0bGVNYXJrZXJTdWJ0eXApLlxuLy8gQW4gdW5yZWdpc3RlcmVkIFNVQlRZUCB2YWx1ZSBpcyBzaG93biBidXQgaGFzIG5vIGNvbG9yIG9mIGl0cyBvd25cbi8vIChzdWJ0eXBDb2xvciB0aGVuIHJldHVybnMgdGhlIFRZUCBjb2xvcikuXG5mdW5jdGlvbiBiYWRnZUxhYmVsKHBsdWdpbiwgZmlsZSwgdHlwKSB7XG4gIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHBsdWdpbjtcbiAgY29uc3Qgc3VidHlwID0gcGx1Z2luLnR5cEluZGV4LnN1YnR5cE9mKGZpbGUpO1xuICBjb25zdCBtb2RlID0gc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VMYWJlbCA/PyBcInR5cFwiO1xuICBpZiAobW9kZSA9PT0gXCJzdWJ0eXBcIikgcmV0dXJuIHN1YnR5cCA/IHsgdGV4dDogc3VidHlwLCB1c2VTdWJ0eXBDb2xvcjogdHJ1ZSwgc3VidHlwIH0gOiBudWxsO1xuICBpZiAoIXN1YnR5cCB8fCBtb2RlID09PSBcInR5cFwiKSByZXR1cm4geyB0ZXh0OiB0eXAsIHVzZVN1YnR5cENvbG9yOiBmYWxzZSwgc3VidHlwIH07XG4gIHJldHVybiB7IHRleHQ6IGAke3R5cH0vJHtzdWJ0eXB9YCwgdXNlU3VidHlwQ29sb3I6ICEhc2V0dGluZ3MuY29sb3JWaWV3cy5ub3RlVGl0bGVNYXJrZXJTdWJ0eXAsIHN1YnR5cCB9O1xufVxuXG4vLyBEb3QgYXQgdGhlIHRpdGxlLiBMaWtlIHRoZSBkb3RzIGluIHRoZSBUWVAtUGFuZSAocGFpbnRDb2xvckRvdCBpblxuLy8gdHlwLWNvbG9ycy5qcyksIGEgZGVmYXVsdCBpcyBzaG93biBhcyBhIGhvbGxvdyByaW5nOiBncmF5IGZvciBhIHJlZ2lzdGVyZWRcbi8vIFRZUCB3aXRob3V0IGEgY29sb3IsIHRoZSBpbmhlcml0ZWQgVFlQIGNvbG9yIGZvciBhIFN1YnR5cCB3aXRob3V0IGl0cyBvd24uXG4vLyBVbnJlZ2lzdGVyZWQgVFlQIHZhbHVlcyBnZXQgbm8gZG90LCBhcyBpbiB0aGUgVFlQLUxpc3QuXG5mdW5jdGlvbiByZXNvbHZlRG90KHBsdWdpbiwgZmlsZSkge1xuICBjb25zdCB0eXAgPSBwbHVnaW4udHlwSW5kZXgudHlwT2YoZmlsZSk7XG4gIGlmICghdHlwKSByZXR1cm4geyBjb2xvcjogbnVsbCwgaG9sbG93OiBmYWxzZSB9O1xuICBjb25zdCB7IHNldHRpbmdzIH0gPSBwbHVnaW47XG4gIGNvbnN0IHR5cENvbG9yID0gc2V0dGluZ3MudHlwQ29sb3JzW3R5cF07XG4gIGlmICghdHlwQ29sb3IpIHtcbiAgICByZXR1cm4gc2V0dGluZ3MudHlwcy5pbmNsdWRlcyh0eXApID8geyBjb2xvcjogREVGQVVMVF9ET1RfQ09MT1IsIGhvbGxvdzogdHJ1ZSB9IDogeyBjb2xvcjogbnVsbCwgaG9sbG93OiBmYWxzZSB9O1xuICB9XG4gIGNvbnN0IHN1YnR5cCA9IHBsdWdpbi50eXBJbmRleC5zdWJ0eXBPZihmaWxlKTtcbiAgaWYgKHNldHRpbmdzLmNvbG9yVmlld3Mubm90ZVRpdGxlTWFya2VyU3VidHlwICYmIHN1YnR5cCAmJiBnZXRTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgc3VidHlwKSkge1xuICAgIHJldHVybiB7IGNvbG9yOiBzdWJ0eXBDb2xvcihzZXR0aW5ncywgdHlwLCBzdWJ0eXApLCBob2xsb3c6ICFzdWJ0eXBIYXNPd25Db2xvcihzZXR0aW5ncywgdHlwLCBzdWJ0eXApIH07XG4gIH1cbiAgcmV0dXJuIHsgY29sb3I6IHR5cENvbG9yLCBob2xsb3c6IGZhbHNlIH07XG59XG5cbi8vIFRoZSBub3RlJ3MgaW5saW5lIHRpdGxlLiBEb25lIGFzIDo6YmVmb3JlIChzZWUgc3R5bGVzLmNzcyksIG5vdCBhcyBhbiBleHRyYVxuLy8gZWxlbWVudCBvciB3cmFwcGVyOiBzZXZlcmFsIHRoZW1lcyAoTWluaW1hbCBhbW9uZyB0aGVtKSBzdHlsZSAuaW5saW5lLXRpdGxlXG4vLyB3aXRoIGNoaWxkIHNlbGVjdG9ycywgd2hpY2ggYW4gZXh0cmEgZWxlbWVudCB3b3VsZCBicmVhay4gQSA6OmJlZm9yZSBjYW4ndFxuLy8gYmUgZ2l2ZW4gYSBjb2xvciBvciB0ZXh0IGRpcmVjdGx5LCBoZW5jZSB0aGUgQ1NTIHZhcmlhYmxlIGFuZCB0aGUgZGF0YVxuLy8gYXR0cmlidXRlIHRoYXQgaXRzIHJ1bGVzIHJlYWQgKHZhcigpL2F0dHIoKSkuXG5mdW5jdGlvbiBhcHBseVN0eWxlVG9UaXRsZSh0aXRsZUVsLCBtYXJrZXIpIHtcbiAgY29uc3QgaXNEb3QgPSBtYXJrZXIua2luZCA9PT0gXCJkb3RcIiAmJiAhIW1hcmtlci5jb2xvcjtcbiAgY29uc3QgaXNCYWRnZSA9IG1hcmtlci5raW5kID09PSBcInRpdGxlLWJhZGdlXCI7XG5cbiAgdGl0bGVFbC5jbGFzc0xpc3QudG9nZ2xlKERPVF9DTEFTUywgaXNEb3QpO1xuICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoRE9UX0hPTExPV19DTEFTUywgaXNEb3QgJiYgISFtYXJrZXIuaG9sbG93KTtcbiAgdGl0bGVFbC5jbGFzc0xpc3QudG9nZ2xlKEJBREdFX0NMQVNTLCBpc0JhZGdlICYmIG1hcmtlci5jb2xvcmVkKTtcbiAgdGl0bGVFbC5jbGFzc0xpc3QudG9nZ2xlKEJBREdFX1BMQUlOX0NMQVNTLCBpc0JhZGdlICYmICFtYXJrZXIuY29sb3JlZCk7XG5cbiAgaWYgKGlzQmFkZ2UpIHRpdGxlRWwuZGF0YXNldC50eXAgPSBtYXJrZXIudHlwTmFtZTtcbiAgZWxzZSBkZWxldGUgdGl0bGVFbC5kYXRhc2V0LnR5cDtcblxuICBjb25zdCBtYXJrZXJDb2xvciA9IChpc0RvdCAmJiBtYXJrZXIuY29sb3IpIHx8IChpc0JhZGdlICYmIG1hcmtlci5jb2xvcmVkICYmIG1hcmtlci5jb2xvcikgPyBtYXJrZXIuY29sb3IgOiBudWxsO1xuICBpZiAobWFya2VyQ29sb3IpIHRpdGxlRWwuc3R5bGUuc2V0UHJvcGVydHkoQ09MT1JfVkFSLCBtYXJrZXJDb2xvcik7XG4gIGVsc2UgdGl0bGVFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShDT0xPUl9WQVIpO1xufVxuXG4vLyBUaGUgbm90ZSdzIHByb3BlcnR5IGJsb2NrICgubWV0YWRhdGEtY29udGFpbmVyKSwgZm9yIHBvc2l0aW9uIFwiYmxvY2tcIjogdGhlXG4vLyBzYW1lIGJhZGdlLCB0dXJuZWQgOTBcdTAwQjAgKHdyaXRpbmctbW9kZSByYXRoZXIgdGhhbiByb3RhdGUoKSwgc28gaXQgZ3Jvd3Mgd2l0aFxuLy8gdGhlIHRleHQgaW4gdGhlIHJpZ2h0IGRpcmVjdGlvbikgYW5kIGFuY2hvcmVkIGxlZnQgYXQgdGhlIGJsb2NrLCB0b3Agb3Jcbi8vIGJvdHRvbS4gQXMgYSA6OmJlZm9yZSBpdCBoaWRlcyBhbmQgc2hvd3Mgd2l0aCB0aGUgYmxvY2sgKFByb3BlcnR5LUJsb2NrLmNzcykuXG5mdW5jdGlvbiBhcHBseVN0eWxlVG9CbG9jayhwbHVnaW4sIGJsb2NrRWwsIG1hcmtlcikge1xuICBjb25zdCBpc0Jsb2NrQmFkZ2UgPSBtYXJrZXIua2luZCA9PT0gXCJibG9jay1iYWRnZVwiO1xuXG4gIGJsb2NrRWwuY2xhc3NMaXN0LnRvZ2dsZShCTE9DS19CQURHRV9DTEFTUywgaXNCbG9ja0JhZGdlICYmIG1hcmtlci5jb2xvcmVkKTtcbiAgYmxvY2tFbC5jbGFzc0xpc3QudG9nZ2xlKEJMT0NLX0JBREdFX1BMQUlOX0NMQVNTLCBpc0Jsb2NrQmFkZ2UgJiYgIW1hcmtlci5jb2xvcmVkKTtcblxuICBjb25zdCBhbGlnbiA9IHBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVWZXJ0aWNhbEFsaWduO1xuICBibG9ja0VsLmNsYXNzTGlzdC50b2dnbGUoQkxPQ0tfQUxJR05fVE9QX0NMQVNTLCBpc0Jsb2NrQmFkZ2UgJiYgYWxpZ24gIT09IFwiYm90dG9tXCIpO1xuICBibG9ja0VsLmNsYXNzTGlzdC50b2dnbGUoQkxPQ0tfQUxJR05fQk9UVE9NX0NMQVNTLCBpc0Jsb2NrQmFkZ2UgJiYgYWxpZ24gPT09IFwiYm90dG9tXCIpO1xuXG4gIGlmIChpc0Jsb2NrQmFkZ2UpIGJsb2NrRWwuZGF0YXNldC50eXAgPSBtYXJrZXIudHlwTmFtZTtcbiAgZWxzZSBkZWxldGUgYmxvY2tFbC5kYXRhc2V0LnR5cDtcblxuICBjb25zdCBibG9ja0NvbG9yID0gaXNCbG9ja0JhZGdlICYmIG1hcmtlci5jb2xvcmVkICYmIG1hcmtlci5jb2xvciA/IG1hcmtlci5jb2xvciA6IG51bGw7XG4gIGlmIChibG9ja0NvbG9yKSBibG9ja0VsLnN0eWxlLnNldFByb3BlcnR5KEJMT0NLX0NPTE9SX1ZBUiwgYmxvY2tDb2xvcik7XG4gIGVsc2UgYmxvY2tFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShCTE9DS19DT0xPUl9WQVIpO1xufVxuXG5mdW5jdGlvbiBhcHBseUFjdGl2ZVRpdGxlQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikpIHtcbiAgICBjb25zdCBjb250YWluZXJFbCA9IGxlYWYudmlldy5jb250YWluZXJFbDtcbiAgICBjb25zdCBmaWxlID0gbGVhZi52aWV3LmZpbGU7XG4gICAgY29uc3QgdHlwZWRGaWxlID0gZmlsZSBpbnN0YW5jZW9mIFRGaWxlID8gZmlsZSA6IG51bGw7XG4gICAgY29uc3QgbWFya2VyID0gcmVzb2x2ZU1hcmtlcihwbHVnaW4sIHR5cGVkRmlsZSk7XG5cbiAgICBjb25zdCB0aXRsZUVsID0gY29udGFpbmVyRWwucXVlcnlTZWxlY3RvcihcIi5pbmxpbmUtdGl0bGVcIik7XG4gICAgaWYgKHRpdGxlRWwpIHtcbiAgICAgIGFwcGx5U3R5bGVUb1RpdGxlKHRpdGxlRWwsIG1hcmtlcik7XG5cbiAgICAgIGNvbnN0IHRleHRDb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLm5vdGVUaXRsZUNvbG9yID8gY29sb3JGb3JGaWxlKHBsdWdpbiwgdHlwZWRGaWxlLCBcIm5vdGVUaXRsZUNvbG9yXCIpIDogbnVsbDtcbiAgICAgIHNldElubGluZUNvbG9yKHRpdGxlRWwsIHRleHRDb2xvcik7XG4gICAgfVxuXG4gICAgY29uc3QgYmxvY2tFbCA9IGNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3IoXCIubWV0YWRhdGEtY29udGFpbmVyXCIpO1xuICAgIGlmIChibG9ja0VsKSBhcHBseVN0eWxlVG9CbG9jayhwbHVnaW4sIGJsb2NrRWwsIG1hcmtlcik7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJBY3RpdmVUaXRsZUNvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5QWN0aXZlVGl0bGVDb2xvcnMocGx1Z2luKTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImZpbGUtb3BlblwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwiYWN0aXZlLWxlYWYtY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsIHJlZnJlc2gpKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KHJlZnJlc2gpO1xuXG4gIC8vIERvdCwgYmFkZ2UgYW5kIHRoZWlyIGRhdGEgYXR0cmlidXRlIGFuZCBjb2xvciB2YXJpYWJsZXMgd291bGQgb3RoZXJ3aXNlXG4gIC8vIHN0YXkgb24gb3BlbiBub3RlcyBhZnRlciB0aGUgcGx1Z2luIGlzIGRpc2FibGVkLCB1bnRpbCB0aGUgbm90ZSBpc1xuICAvLyByZS1yZW5kZXJlZC4gVGhlIHRpdGxlIHRleHQgY29sb3IgaXMgY2xlYXJlZCB3aXRoIHRoZSBvdGhlciBpbmxpbmUgY29sb3JzXG4gIC8vIChjbGVhcklubGluZUNvbG9ycywgc2VlIG1haW4uanMpLlxuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4ge1xuICAgIGNvbnN0IG5vbmUgPSB7IGtpbmQ6IFwibm9uZVwiIH07XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpKSB7XG4gICAgICBjb25zdCBjb250YWluZXJFbCA9IGxlYWYudmlldy5jb250YWluZXJFbDtcbiAgICAgIGNvbnN0IHRpdGxlRWwgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKFwiLmlubGluZS10aXRsZVwiKTtcbiAgICAgIGlmICh0aXRsZUVsKSBhcHBseVN0eWxlVG9UaXRsZSh0aXRsZUVsLCBub25lKTtcbiAgICAgIGNvbnN0IGJsb2NrRWwgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKFwiLm1ldGFkYXRhLWNvbnRhaW5lclwiKTtcbiAgICAgIGlmIChibG9ja0VsKSBhcHBseVN0eWxlVG9CbG9jayhwbHVnaW4sIGJsb2NrRWwsIG5vbmUpO1xuICAgIH1cbiAgfSk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckFjdGl2ZVRpdGxlQ29sb3JzIH07XG4iLCAiY29uc3QgeyBlZGl0b3JJbmZvRmllbGQsIGdldExpbmtwYXRoIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IFZpZXdQbHVnaW4sIERlY29yYXRpb24gfSA9IHJlcXVpcmUoXCJAY29kZW1pcnJvci92aWV3XCIpO1xuY29uc3QgeyBQcmVjLCBSYW5nZVNldEJ1aWxkZXIsIFN0YXRlRWZmZWN0IH0gPSByZXF1aXJlKFwiQGNvZGVtaXJyb3Ivc3RhdGVcIik7XG5jb25zdCB7IHN5bnRheFRyZWUgfSA9IHJlcXVpcmUoXCJAY29kZW1pcnJvci9sYW5ndWFnZVwiKTtcbmNvbnN0IHsgY29sb3JGb3JGaWxlLCBhbGxEb2N1bWVudHMgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5cbi8vIENvbG9ycyBsaW5rcyBpbiBub3RlIHRleHQgYnkgdGhlIFRZUCBvZiB0aGVpciB0YXJnZXQuIE9ic2lkaWFuIGNvbG9yc1xuLy8gaW50ZXJuYWwgbGlua3MgdGhyb3VnaCB2YXIoLS1saW5rLWNvbG9yKSwgc28gb25seSB0aGF0IHZhcmlhYmxlIGlzIHNldCBwZXJcbi8vIGxpbmsuIC0tbGluay1jb2xvci1ob3ZlciBzdGF5cyB1bnRvdWNoZWQgKGhvdmVyIHNob3dzIHRoZSBub3JtYWwgbGluayBjb2xvciksXG4vLyBhbmQgdW5kZXJsaW5lIGFuZCB0aGVtZSB0d2Vha3Mga2VlcCB3b3JraW5nLlxuLy9cbi8vIFR3byBzZXBhcmF0ZSBwYXRocywgYmVjYXVzZSB0aGUgdHdvIHJlbmRlcmluZ3MgaGF2ZSBub3RoaW5nIGluIGNvbW1vbjpcbi8vICAtIFJlYWRpbmcgdmlldywgaG92ZXIgcHJldmlldyBhbmQgcmVuZGVyZWQgYmxvY2tzIGluIExpdmUgUHJldmlldyAodGFibGVzLFxuLy8gICAgY2FsbG91dHMpOiByZWFsIDxhIGNsYXNzPVwiaW50ZXJuYWwtbGlua1wiIGRhdGEtaHJlZj4gZWxlbWVudHMgLT5cbi8vICAgIG1hcmtkb3duIHBvc3QtcHJvY2Vzc29yLCBvbmNlIHBlciBsaW5rIHdoZW4gcmVuZGVyZWQuXG4vLyAgLSBMaXZlIFByZXZpZXcvc291cmNlIG1vZGU6IG9ubHkgQ29kZU1pcnJvciBzcGFucyBvdmVyIHRoZSByYXcgdGV4dCAtPlxuLy8gICAgYSBWaWV3UGx1Z2luIHRoYXQgbG9va3MgYXQgdGhlIHZpc2libGUgcmFuZ2Ugb25seS5cbi8vXG4vLyBSZWNvbG9yaW5nIG90aGVyd2lzZSBvbmx5IGhhcHBlbnMgb24gYSByZWFsIFRZUCBjaGFuZ2UgKHR5cEluZGV4IFwiY2hhbmdlXCIpXG4vLyBvciBhIHNldHRpbmdzIGNoYW5nZSwgbm90IG9uIGV2ZXJ5IHNhdmUuXG5cbmNvbnN0IENPTE9SX1ZBUiA9IFwiLS1saW5rLWNvbG9yXCI7XG5jb25zdCBTT1VSQ0VfQVRUUiA9IFwiZGF0YS10eXAtc3JjXCI7XG5cbi8vIFtbdGFyZ2V0XV0sIFtbdGFyZ2V0fGFsaWFzXV0sIFtbdGFyZ2V0I2hlYWRpbmddXS4gRW1iZWRzICghW1tcdTIwMjZdXSkgYXJlIG5vdFxuLy8gbGlua3MuIEluc2lkZSB0YWJsZXMgdGhlIGFsaWFzIHBpcGUgaXMgZXNjYXBlZCAoXCJcXHxcIikuXG5jb25zdCBXSUtJTElOS19QQVRURVJOID0gLyg/PCEhKVxcW1xcWyhbXltcXF1dKz8pXFxdXFxdL2c7XG5cbmZ1bmN0aW9uIGNvbG9yRm9yTGlua3RleHQocGx1Z2luLCBsaW5rdGV4dCwgc291cmNlUGF0aCkge1xuICBjb25zdCB0YXJnZXQgPSBsaW5rdGV4dC5zcGxpdCgvXFxcXD9cXHwvKVswXS50cmltKCk7XG4gIGNvbnN0IGxpbmtwYXRoID0gZ2V0TGlua3BhdGgodGFyZ2V0KTtcbiAgaWYgKCFsaW5rcGF0aCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGZpbGUgPSBwbHVnaW4uYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0Rmlyc3RMaW5rcGF0aERlc3QobGlua3BhdGgsIHNvdXJjZVBhdGgpO1xuICByZXR1cm4gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSwgXCJsaW5rc1wiKTtcbn1cblxuLy8gLS0tIFJlYWRpbmcgdmlldyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmZ1bmN0aW9uIGFwcGx5VG9BbmNob3IocGx1Z2luLCBhbmNob3JFbCkge1xuICBjb25zdCBocmVmID0gYW5jaG9yRWwuZ2V0QXR0cmlidXRlKFwiZGF0YS1ocmVmXCIpO1xuICBjb25zdCBjb2xvciA9XG4gICAgcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MubGlua3MgJiYgaHJlZiAmJiAhYW5jaG9yRWwuY2xhc3NMaXN0LmNvbnRhaW5zKFwiaXMtdW5yZXNvbHZlZFwiKVxuICAgICAgPyBjb2xvckZvckxpbmt0ZXh0KHBsdWdpbiwgaHJlZiwgYW5jaG9yRWwuZ2V0QXR0cmlidXRlKFNPVVJDRV9BVFRSKSA/PyBcIlwiKVxuICAgICAgOiBudWxsO1xuICBpZiAoY29sb3IpIGFuY2hvckVsLnN0eWxlLnNldFByb3BlcnR5KENPTE9SX1ZBUiwgY29sb3IpO1xuICBlbHNlIGFuY2hvckVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KENPTE9SX1ZBUik7XG59XG5cbi8vIFJlY29sb3JzIGxpbmtzIHRoYXQgYXJlIGFscmVhZHkgcmVuZGVyZWQuIFRoZSBwb3N0LXByb2Nlc3NvciBzdG9yZXMgZWFjaFxuLy8gbGluaydzIHNvdXJjZSBub3RlIG9uIGl0LCB3aGljaCBhbWJpZ3VvdXMgbGluayB0ZXh0IG5lZWRzIHRvIHJlc29sdmUuXG4vLyBDb3ZlcnMgYWxsIHdpbmRvd3MgKHBvcC1vdXRzIGluY2x1ZGVkKS5cbmZ1bmN0aW9uIHJlZnJlc2hSZW5kZXJlZExpbmtzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGRvYyBvZiBhbGxEb2N1bWVudHMocGx1Z2luLmFwcCkpIHtcbiAgICBmb3IgKGNvbnN0IGFuY2hvckVsIG9mIGRvYy5xdWVyeVNlbGVjdG9yQWxsKGBhLmludGVybmFsLWxpbmtbJHtTT1VSQ0VfQVRUUn1dYCkpIGFwcGx5VG9BbmNob3IocGx1Z2luLCBhbmNob3JFbCk7XG4gIH1cbn1cblxuLy8gLS0tIExpdmUgUHJldmlldyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IHJlZnJlc2hFZmZlY3QgPSBTdGF0ZUVmZmVjdC5kZWZpbmUoKTtcblxuZnVuY3Rpb24gYnVpbGRMaW5rVmlld1BsdWdpbihwbHVnaW4pIHtcbiAgY29uc3QgZGVjb3JhdGlvbnNCeUNvbG9yID0gbmV3IE1hcCgpO1xuICBjb25zdCBkZWNvcmF0aW9uRm9yID0gKGNvbG9yKSA9PiB7XG4gICAgbGV0IGRlY29yYXRpb24gPSBkZWNvcmF0aW9uc0J5Q29sb3IuZ2V0KGNvbG9yKTtcbiAgICBpZiAoIWRlY29yYXRpb24pIHtcbiAgICAgIGRlY29yYXRpb24gPSBEZWNvcmF0aW9uLm1hcmsoe1xuICAgICAgICBjbGFzczogXCJ0eXAtbGlua1wiLFxuICAgICAgICBhdHRyaWJ1dGVzOiB7IHN0eWxlOiBgJHtDT0xPUl9WQVJ9OiAke2NvbG9yfTtgIH0sXG4gICAgICB9KTtcbiAgICAgIGRlY29yYXRpb25zQnlDb2xvci5zZXQoY29sb3IsIGRlY29yYXRpb24pO1xuICAgIH1cbiAgICByZXR1cm4gZGVjb3JhdGlvbjtcbiAgfTtcblxuICBjb25zdCBidWlsZCA9ICh2aWV3KSA9PiB7XG4gICAgaWYgKCFwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5saW5rcykgcmV0dXJuIERlY29yYXRpb24ubm9uZTtcbiAgICBjb25zdCBzb3VyY2VQYXRoID0gdmlldy5zdGF0ZS5maWVsZChlZGl0b3JJbmZvRmllbGQsIGZhbHNlKT8uZmlsZT8ucGF0aCA/PyBcIlwiO1xuICAgIGNvbnN0IHRyZWUgPSBzeW50YXhUcmVlKHZpZXcuc3RhdGUpO1xuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgUmFuZ2VTZXRCdWlsZGVyKCk7XG5cbiAgICBmb3IgKGNvbnN0IHsgZnJvbSwgdG8gfSBvZiB2aWV3LnZpc2libGVSYW5nZXMpIHtcbiAgICAgIGNvbnN0IHRleHQgPSB2aWV3LnN0YXRlLnNsaWNlRG9jKGZyb20sIHRvKTtcbiAgICAgIFdJS0lMSU5LX1BBVFRFUk4ubGFzdEluZGV4ID0gMDtcbiAgICAgIGZvciAobGV0IG1hdGNoOyAobWF0Y2ggPSBXSUtJTElOS19QQVRURVJOLmV4ZWModGV4dCkpOyApIHtcbiAgICAgICAgY29uc3Qgc3RhcnQgPSBmcm9tICsgbWF0Y2guaW5kZXg7XG4gICAgICAgIC8vIE9ubHkgd2hhdCBPYnNpZGlhbidzIHBhcnNlciB0cmVhdHMgYXMgYW4gaW50ZXJuYWwgbGluaywgd2hpY2ggcnVsZXNcbiAgICAgICAgLy8gb3V0IFtbXHUyMDI2XV0gaW4gY29kZSBibG9ja3MgYW5kIGlubGluZSBjb2RlLlxuICAgICAgICBpZiAoIXRyZWUucmVzb2x2ZUlubmVyKHN0YXJ0ICsgMiwgMSkubmFtZS5pbmNsdWRlcyhcImhtZC1pbnRlcm5hbC1saW5rXCIpKSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgY29sb3IgPSBjb2xvckZvckxpbmt0ZXh0KHBsdWdpbiwgbWF0Y2hbMV0sIHNvdXJjZVBhdGgpO1xuICAgICAgICBpZiAoY29sb3IpIGJ1aWxkZXIuYWRkKHN0YXJ0LCBzdGFydCArIG1hdGNoWzBdLmxlbmd0aCwgZGVjb3JhdGlvbkZvcihjb2xvcikpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gYnVpbGRlci5maW5pc2goKTtcbiAgfTtcblxuICByZXR1cm4gVmlld1BsdWdpbi5mcm9tQ2xhc3MoXG4gICAgY2xhc3Mge1xuICAgICAgY29uc3RydWN0b3Iodmlldykge1xuICAgICAgICB0aGlzLmRlY29yYXRpb25zID0gYnVpbGQodmlldyk7XG4gICAgICB9XG5cbiAgICAgIC8vIFRoZSBwYXJzZXIgbWF5IHdvcmsgdGhyb3VnaCB0aGUgdmlzaWJsZSByYW5nZSBiaXQgYnkgYml0LCBzbyBhIG5ld1xuICAgICAgLy8gc3ludGF4IHRyZWUgYWxzbyB0cmlnZ2VycyBhIHJlYnVpbGQuXG4gICAgICB1cGRhdGUodXBkYXRlKSB7XG4gICAgICAgIGlmIChcbiAgICAgICAgICB1cGRhdGUuZG9jQ2hhbmdlZCB8fFxuICAgICAgICAgIHVwZGF0ZS52aWV3cG9ydENoYW5nZWQgfHxcbiAgICAgICAgICBzeW50YXhUcmVlKHVwZGF0ZS5zdGFydFN0YXRlKSAhPT0gc3ludGF4VHJlZSh1cGRhdGUuc3RhdGUpIHx8XG4gICAgICAgICAgdXBkYXRlLnRyYW5zYWN0aW9ucy5zb21lKCh0cikgPT4gdHIuZWZmZWN0cy5zb21lKChlZmZlY3QpID0+IGVmZmVjdC5pcyhyZWZyZXNoRWZmZWN0KSkpXG4gICAgICAgICkge1xuICAgICAgICAgIHRoaXMuZGVjb3JhdGlvbnMgPSBidWlsZCh1cGRhdGUudmlldyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LFxuICAgIHsgZGVjb3JhdGlvbnM6ICh2YWx1ZSkgPT4gdmFsdWUuZGVjb3JhdGlvbnMgfVxuICApO1xufVxuXG4vLyBSZXR1cm5zIHNjaGVkdWxlKCk6IGFza3MgZXZlcnkgZWRpdG9yIHRvIHJlYnVpbGQgaXRzIGxpbmsgZGVjb3JhdGlvbnMsIGF0XG4vLyBtb3N0IG9uY2UgcGVyIGFuaW1hdGlvbiBmcmFtZS5cbi8vXG4vLyBOZXZlciBkaXNwYXRjaGVkIHN5bmNocm9ub3VzbHk6IGEgcmVmcmVzaCBjYW4gYXJyaXZlIHdoaWxlIGFuIGVkaXRvciBpcyBpblxuLy8gdGhlIG1pZGRsZSBvZiBpdHMgb3duIHVwZGF0ZSAoQ29kZU1pcnJvciB0aGVuIHRocm93cyBcIkNhbGxzIHRvXG4vLyBFZGl0b3JWaWV3LnVwZGF0ZSBhcmUgbm90IGFsbG93ZWQgd2hpbGUgYW4gdXBkYXRlIGlzIGluIHByb2dyZXNzXCIpLCBmb3Jcbi8vIGluc3RhbmNlIHdoZW4gc29tZXRoaW5nIGFuIHVwZGF0ZSBzZXRzIG9mZiBlbmRzIGluIHJlZnJlc2hUeXBDb2xvcnMoKS4gVGhlXG4vLyBmcmFtZSBhbHNvIGJ1bmRsZXMgYnVyc3RzIG9mIHJlZnJlc2hlcyAtIGRyYWdnaW5nIGEgY29sb3Igc2xpZGVyIHNlbmRzIG9uZVxuLy8gcGVyIGlucHV0IGV2ZW50LiBBbiBlZGl0b3Igc3RpbGwgYnVzeSB3aGVuIHRoZSBmcmFtZSBjb21lcyAodXBkYXRlU3RhdGUgaXNcbi8vIENvZGVNaXJyb3IncyBpbnRlcm5hbCBmbGFnLCAwID0gaWRsZTsgaXQgaXMgYWxzbyBub24temVybyB3aGlsZSBtZWFzdXJpbmcpXG4vLyBpcyByZXRyaWVkIGEgZnJhbWUgbGF0ZXIuXG5mdW5jdGlvbiBjcmVhdGVFZGl0b3JSZWZyZXNoZXIocGx1Z2luKSB7XG4gIGxldCBmcmFtZSA9IG51bGw7XG4gIGNvbnN0IHJ1biA9ICgpID0+IHtcbiAgICBmcmFtZSA9IG51bGw7XG4gICAgbGV0IGJ1c3kgPSBmYWxzZTtcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5pdGVyYXRlQWxsTGVhdmVzKChsZWFmKSA9PiB7XG4gICAgICBjb25zdCBjbSA9IGxlYWYudmlldz8uZWRpdG9yPy5jbTtcbiAgICAgIGlmICghY20pIHJldHVybjtcbiAgICAgIGlmIChjbS51cGRhdGVTdGF0ZSAhPT0gMCkge1xuICAgICAgICBidXN5ID0gdHJ1ZTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdHJ5IHtcbiAgICAgICAgY20uZGlzcGF0Y2goeyBlZmZlY3RzOiByZWZyZXNoRWZmZWN0Lm9mKG51bGwpIH0pO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgLy8gT25lIGVkaXRvciBmYWlsaW5nIG11c3Qgbm90IGtlZXAgdGhlIG90aGVycyBmcm9tIHJlZnJlc2hpbmcuXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoXCJbVFlQIGxpbmsgY29sb3JzXVwiLCBlcnJvcik7XG4gICAgICB9XG4gICAgfSk7XG4gICAgaWYgKGJ1c3kpIHNjaGVkdWxlKCk7XG4gIH07XG4gIGNvbnN0IHNjaGVkdWxlID0gKCkgPT4ge1xuICAgIGlmIChmcmFtZSA9PT0gbnVsbCkgZnJhbWUgPSB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lKHJ1bik7XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiB7XG4gICAgaWYgKGZyYW1lICE9PSBudWxsKSB3aW5kb3cuY2FuY2VsQW5pbWF0aW9uRnJhbWUoZnJhbWUpO1xuICAgIGZyYW1lID0gbnVsbDtcbiAgfSk7XG4gIHJldHVybiBzY2hlZHVsZTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmZ1bmN0aW9uIHJlZ2lzdGVyTGlua0NvbG9ycyhwbHVnaW4pIHtcbiAgcGx1Z2luLnJlZ2lzdGVyTWFya2Rvd25Qb3N0UHJvY2Vzc29yKChlbCwgY3R4KSA9PiB7XG4gICAgLy8gU3RvcmUgdGhlIHNvdXJjZSBldmVuIHdoaWxlIGNvbG9yaW5nIGlzIG9mZiwgc28gdHVybmluZyBpdCBvbiBsYXRlclxuICAgIC8vIGFsc28gY292ZXJzIGxpbmtzIHRoYXQgYXJlIGFscmVhZHkgcmVuZGVyZWQuXG4gICAgZm9yIChjb25zdCBhbmNob3JFbCBvZiBlbC5xdWVyeVNlbGVjdG9yQWxsKFwiYS5pbnRlcm5hbC1saW5rXCIpKSB7XG4gICAgICBhbmNob3JFbC5zZXRBdHRyaWJ1dGUoU09VUkNFX0FUVFIsIGN0eC5zb3VyY2VQYXRoKTtcbiAgICAgIGFwcGx5VG9BbmNob3IocGx1Z2luLCBhbmNob3JFbCk7XG4gICAgfVxuICB9KTtcbiAgLy8gT2JzaWRpYW4ncyBcIi5jbS1obWQtaW50ZXJuYWwtbGlua1wiIHNwYW4gYWx3YXlzIGVuZHMgdXAgb3V0c2lkZSBvdXIgbWFyayxcbiAgLy8gd2hhdGV2ZXIgdGhlIHByaW9yaXR5LCBzbyBhIHJ1bGUgaW4gc3R5bGVzLmNzcyAoLnR5cC1saW5rKSBzZXRzIHRoZSBjb2xvci5cbiAgLy8gTG93ZXN0IHByaW9yaXR5IGF0IGxlYXN0IHdyYXBzIFwiLmNtLXVuZGVybGluZVwiLCBjb3ZlcmluZyB0aGUgd2hvbGUgdGV4dC5cbiAgcGx1Z2luLnJlZ2lzdGVyRWRpdG9yRXh0ZW5zaW9uKFByZWMubG93ZXN0KGJ1aWxkTGlua1ZpZXdQbHVnaW4ocGx1Z2luKSkpO1xuXG4gIGNvbnN0IHJlZnJlc2hFZGl0b3JzID0gY3JlYXRlRWRpdG9yUmVmcmVzaGVyKHBsdWdpbik7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiB7XG4gICAgcmVmcmVzaFJlbmRlcmVkTGlua3MocGx1Z2luKTtcbiAgICByZWZyZXNoRWRpdG9ycygpO1xuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICAvLyBFZGl0b3IgZGVjb3JhdGlvbnMgZ28gYXdheSB3aXRoIHRoZSBleHRlbnNpb24gb24gdW5sb2FkLCB0aGUgaW5saW5lXG4gIC8vIHZhcmlhYmxlcyBvbiByZW5kZXJlZCBsaW5rcyBkb24ndC5cbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IHtcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5pdGVyYXRlQWxsTGVhdmVzKChsZWFmKSA9PiB7XG4gICAgICBmb3IgKGNvbnN0IGFuY2hvckVsIG9mIGxlYWYudmlldy5jb250YWluZXJFbC5xdWVyeVNlbGVjdG9yQWxsKGBhLmludGVybmFsLWxpbmtbJHtTT1VSQ0VfQVRUUn1dYCkpIHtcbiAgICAgICAgYW5jaG9yRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoQ09MT1JfVkFSKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSk7XG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJMaW5rQ29sb3JzIH07XG4iLCAiY29uc3QgeyBnZXRTdWJ0eXBOYW1lcywgZ2V0U3VidHlwIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBzXCIpO1xuY29uc3QgeyBzdWJ0eXBDb2xvciwgc2V0SW5saW5lQ29sb3IsIGFsbERvY3VtZW50cyB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcbmNvbnN0IHsgVklFV19UWVBFX1RZUF9QQU5FIH0gPSByZXF1aXJlKFwiLi90eXAtcGFuZVwiKTtcblxuY29uc3QgQUxMX1BST1BFUlRJRVNfVklFV19UWVBFID0gXCJhbGwtcHJvcGVydGllc1wiO1xuY29uc3QgSElHSExJR0hUX0NMQVNTID0gXCJ0eXAtZGVmYXVsdC1wcm9wZXJ0eVwiO1xuLy8gRmxvYXRpbmcgcHJvcGVydGllcyBhcmUgbWFya2VkIGl0YWxpYyBpbnN0ZWFkIG9mIGJvbGQuXG5jb25zdCBGTE9BVElOR19DTEFTUyA9IFwidHlwLWZsb2F0aW5nLXByb3BlcnR5XCI7XG5cbi8vIE9ic2lkaWFuIGFsd2F5cyBsb3dlcmNhc2VzIGRhdGEtcHJvcGVydHkta2V5LCBzbyBjb21wYXJpc29ucyBpZ25vcmUgY2FzZS5cbmZ1bmN0aW9uIHJhd0tleXNGb3JUeXAodHlwLCBkZWZhdWx0cykge1xuICBpZiAoIXR5cCB8fCAhZGVmYXVsdHMpIHJldHVybiBudWxsO1xuICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXMoZGVmYXVsdHMpLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwiXCIpO1xuICByZXR1cm4ga2V5cy5sZW5ndGggPiAwID8ga2V5cy5tYXAoKGtleSkgPT4ga2V5LnRvTG93ZXJDYXNlKCkpIDogbnVsbDtcbn1cblxuLy8gQSBUWVAncyBmcm9udG1hdHRlciBibG9ja3MgYXMgW3sgc2VjdGlvbiwga2V5cywgZmxvYXRpbmcgfV0gKGxvd2VyY2FzZSk6XG4vLyB0aGUgVFlQLUZyb250bWF0dGVyIGZpcnN0LCB0aGVuIG9wdGlvbmFsbHkgb25lIFN1YnR5cCdzIGJsb2NrIG9yLCB3aXRoXG4vLyBBTExfU1VCVFlQUywgZXZlcnkgU3VidHlwJ3MgYmxvY2sgKHNlZSBzdWJ0eXBzLmpzKS5cbmNvbnN0IEFMTF9TVUJUWVBTID0gU3ltYm9sKFwiYWxsLXN1YnR5cHNcIik7XG5cbmZ1bmN0aW9uIGJsb2NrT2YoZGVmYXVsdHMsIGZsb2F0aW5nS2V5cywgc2VjdGlvbiA9IG51bGwpIHtcbiAgY29uc3Qga2V5cyA9IHJhd0tleXNGb3JUeXAodHJ1ZSwgZGVmYXVsdHMpID8/IFtdO1xuICByZXR1cm4geyBzZWN0aW9uLCBrZXlzLCBmbG9hdGluZzogbmV3IFNldCgoZmxvYXRpbmdLZXlzID8/IFtdKS5tYXAoKGtleSkgPT4ga2V5LnRvTG93ZXJDYXNlKCkpKSB9O1xufVxuXG5mdW5jdGlvbiBibG9ja3NGb3JUeXAocGx1Z2luLCB0eXAsIHN1YnR5cCkge1xuICBjb25zdCB7IHNldHRpbmdzIH0gPSBwbHVnaW47XG4gIGNvbnN0IGJsb2NrcyA9IFtibG9ja09mKHNldHRpbmdzLnR5cERlZmF1bHRGcm9udG1hdHRlclt0eXBdLCBzZXR0aW5ncy50eXBGbG9hdGluZ0tleXNbdHlwXSwgbnVsbCldO1xuICBjb25zdCBzdWJ0eXBOYW1lcyA9IHN1YnR5cCA9PT0gQUxMX1NVQlRZUFMgPyBnZXRTdWJ0eXBOYW1lcyhzZXR0aW5ncywgdHlwKSA6IHN1YnR5cCA/IFtzdWJ0eXBdIDogW107XG4gIGZvciAoY29uc3QgbmFtZSBvZiBzdWJ0eXBOYW1lcykge1xuICAgIGNvbnN0IGRhdGEgPSBnZXRTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgbmFtZSk7XG4gICAgaWYgKGRhdGEpIGJsb2Nrcy5wdXNoKGJsb2NrT2YoZGF0YS5mcm9udG1hdHRlciwgZGF0YS5mbG9hdGluZ0tleXMsIG5hbWUpKTtcbiAgfVxuICByZXR1cm4gYmxvY2tzO1xufVxuXG4vLyBTZXBhcmF0ZSBzZXRzIG9mIG5hbWVzIHRvIGJvbGQgKFwic3RhbmRhcmRcIikgYW5kIHRvIGl0YWxpY2l6ZSAoXCJmbG9hdGluZ1wiKS5cbi8vIEEgZmxvYXRpbmcga2V5IG5ldmVyIGFsc28gY291bnRzIGFzIHN0YW5kYXJkLiBJZiBhIGtleSBpcyBpbiBzZXZlcmFsIGJsb2Nrcyxcbi8vIHRoZSBsYXRlciBibG9jayBkZWNpZGVzIC0gZm9yIGEgbm90ZSB0aGF0IGlzIGl0cyBTdWJ0eXAgYmxvY2ssIHRoZSBzYW1lIHJ1bGVcbi8vIGFzIGZvciB0aGUgdmFsdWUgaW4gZ2V0VHlwRGVmYXVsdHMgKG1haW4uanMpLlxuZnVuY3Rpb24gc3BsaXRLZXlzKGJsb2Nrcykge1xuICBjb25zdCBpc0Zsb2F0aW5nID0gbmV3IE1hcCgpO1xuICBmb3IgKGNvbnN0IHsga2V5cywgZmxvYXRpbmcgfSBvZiBibG9ja3MpIHtcbiAgICBmb3IgKGNvbnN0IGtleSBvZiBrZXlzKSBpc0Zsb2F0aW5nLnNldChrZXksIGZsb2F0aW5nLmhhcyhrZXkpKTtcbiAgfVxuICBjb25zdCBzdGFuZGFyZCA9IG5ldyBTZXQoKTtcbiAgY29uc3QgZmxvYXRpbmcgPSBuZXcgU2V0KCk7XG4gIGZvciAoY29uc3QgW2tleSwgZmxhZ10gb2YgaXNGbG9hdGluZykgKGZsYWcgPyBmbG9hdGluZyA6IHN0YW5kYXJkKS5hZGQoa2V5KTtcbiAgcmV0dXJuIHsgc3RhbmRhcmQ6IHN0YW5kYXJkLnNpemUgPiAwID8gc3RhbmRhcmQgOiBudWxsLCBmbG9hdGluZzogZmxvYXRpbmcuc2l6ZSA+IDAgPyBmbG9hdGluZyA6IG51bGwgfTtcbn1cblxuY29uc3QgTk9fS0VZUyA9IHsgc3RhbmRhcmQ6IG51bGwsIGZsb2F0aW5nOiBudWxsIH07XG5cbmZ1bmN0aW9uIGtleXNGb3JGaWxlKHBsdWdpbiwgZmlsZSkge1xuICBjb25zdCB7IGNvbG9yVmlld3MgfSA9IHBsdWdpbi5zZXR0aW5ncztcbiAgaWYgKCFjb2xvclZpZXdzLmZyb250bWF0dGVyRGVmYXVsdHMpIHJldHVybiBOT19LRVlTO1xuICBjb25zdCB0eXAgPSBwbHVnaW4udHlwSW5kZXgudHlwT2YoZmlsZSk7XG4gIGlmICghdHlwKSByZXR1cm4gTk9fS0VZUztcbiAgY29uc3Qgc3VidHlwID0gY29sb3JWaWV3cy5mcm9udG1hdHRlckRlZmF1bHRzU3VidHlwID8gcGx1Z2luLnR5cEluZGV4LnN1YnR5cE9mKGZpbGUpIDogbnVsbDtcbiAgcmV0dXJuIHNwbGl0S2V5cyhibG9ja3NGb3JUeXAocGx1Z2luLCB0eXAsIHN1YnR5cCkpO1xufVxuXG4vLyBUWVAtUGFuZSBkZXRhaWwgZWRpdG9yczogb25lIGVkaXRvciBwZXIgYmxvY2sgKHNlZSB0eXBTdG9yZS9zdWJ0eXBTdG9yZSBpblxuLy8gdHlwLWZyb250bWF0dGVyLWVkaXRvci5qcyksIHNvIHRoZSBtYXJrcyBzaG93IGV4YWN0bHkgdGhhdCBibG9jaydzIGtleXMuXG4vLyBTdWJ0eXAgYmxvY2tzIG9ubHkgd2l0aCB0aGUgXCJTdWJ0eXBcIiBzdWItdG9nZ2xlLlxuZnVuY3Rpb24ga2V5c0ZvclN0b3JlKHBsdWdpbiwgc3RvcmUpIHtcbiAgY29uc3QgeyBjb2xvclZpZXdzIH0gPSBwbHVnaW4uc2V0dGluZ3M7XG4gIGlmICghY29sb3JWaWV3cy5mcm9udG1hdHRlckRlZmF1bHRzIHx8ICFzdG9yZSkgcmV0dXJuIE5PX0tFWVM7XG4gIGlmIChzdG9yZS5zdWJ0eXAgJiYgIWNvbG9yVmlld3MuZnJvbnRtYXR0ZXJEZWZhdWx0c1N1YnR5cCkgcmV0dXJuIE5PX0tFWVM7XG4gIHJldHVybiBzcGxpdEtleXMoW2Jsb2NrT2Yoc3RvcmUuZ2V0RnJvbnRtYXR0ZXIoKSwgc3RvcmUuZ2V0RmxvYXRpbmcoKSldKTtcbn1cblxuLy8gUHJvcGVydHkgbmFtZSAobG93ZXJjYXNlKSAtPiB7IHR5cHMsIGFsbEZsb2F0aW5nIH0gYWNyb3NzIGV2ZXJ5IFRZUCB3aG9zZVxuLy8gZnJvbnRtYXR0ZXIgKG9wdGlvbmFsbHkgd2l0aCBpdHMgU3VidHlwIGJsb2NrcykgaGFzIGl0LiBcIkFsbCBwcm9wZXJ0aWVzXCIgaXNcbi8vIHZhdWx0LXdpZGUgd2l0aCBubyBzaW5nbGUgVFlQIGNvbnRleHQsIHNvIHRoZSBmdWxsIG1hcHBpbmcgaXMgY29sbGVjdGVkIHRvXG4vLyB0ZWxsIFwiZXhhY3RseSBvbmUgVFlQXCIgKGNvbG9yKSBmcm9tIFwic2V2ZXJhbFwiIChib2xkKS4gdHlwcyBtYXBzIFRZUCAtPiB0aGVcbi8vIGJsb2NrcyBob2xkaW5nIHRoZSBrZXkgKG51bGwgPSB0aGUgVFlQLUZyb250bWF0dGVyKTsgb25seSB0aGUgdW5hbWJpZ3VvdXNcbi8vIGNhc2UgZ2V0cyBjb2xvcmVkLiBhbGxGbG9hdGluZyBpcyB0cnVlIGlmIHRoZSBrZXkgaXMgZmxvYXRpbmcgaW4gRVZFUlkgYmxvY2tcbi8vIG9mIEVWRVJZIFRZUCAtIGFueXRoaW5nIGxlc3Mgd291bGQgbWFrZSBpdGFsaWNzIG1pc2xlYWRpbmcuXG4vL1xuLy8gT3duIHRvZ2dsZSAoY29sb3JWaWV3cy5hbGxQcm9wZXJ0aWVzKSwgaW5kZXBlbmRlbnQgb2YgZnJvbnRtYXR0ZXJEZWZhdWx0cy5cbi8vIEEgU3VidHlwIHByb3BlcnR5IGNvdW50cyBmb3IgaXRzIFRZUC5cbmZ1bmN0aW9uIHR5cHNVc2luZ0tleU1hcChwbHVnaW4pIHtcbiAgY29uc3QgbWFwID0gbmV3IE1hcCgpO1xuICBjb25zdCB7IGNvbG9yVmlld3MgfSA9IHBsdWdpbi5zZXR0aW5ncztcbiAgaWYgKCFjb2xvclZpZXdzLmFsbFByb3BlcnRpZXMpIHJldHVybiBtYXA7XG4gIGNvbnN0IHR5cHMgPSBuZXcgU2V0KFtcbiAgICAuLi5PYmplY3Qua2V5cyhwbHVnaW4uc2V0dGluZ3MudHlwRGVmYXVsdEZyb250bWF0dGVyKSxcbiAgICAuLi4oY29sb3JWaWV3cy5hbGxQcm9wZXJ0aWVzU3VidHlwID8gT2JqZWN0LmtleXMocGx1Z2luLnNldHRpbmdzLnR5cFN1YnR5cHMgPz8ge30pIDogW10pLFxuICBdKTtcbiAgZm9yIChjb25zdCB0eXAgb2YgdHlwcykge1xuICAgIGNvbnN0IGJsb2NrcyA9IGJsb2Nrc0ZvclR5cChwbHVnaW4sIHR5cCwgY29sb3JWaWV3cy5hbGxQcm9wZXJ0aWVzU3VidHlwID8gQUxMX1NVQlRZUFMgOiBudWxsKTtcbiAgICBmb3IgKGNvbnN0IHsgc2VjdGlvbiwga2V5cywgZmxvYXRpbmcgfSBvZiBibG9ja3MpIHtcbiAgICAgIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICAgICAgaWYgKCFtYXAuaGFzKGtleSkpIG1hcC5zZXQoa2V5LCB7IHR5cHM6IG5ldyBNYXAoKSwgYWxsRmxvYXRpbmc6IHRydWUgfSk7XG4gICAgICAgIGNvbnN0IGVudHJ5ID0gbWFwLmdldChrZXkpO1xuICAgICAgICBpZiAoIWVudHJ5LnR5cHMuaGFzKHR5cCkpIGVudHJ5LnR5cHMuc2V0KHR5cCwgW10pO1xuICAgICAgICBlbnRyeS50eXBzLmdldCh0eXApLnB1c2goc2VjdGlvbik7XG4gICAgICAgIGVudHJ5LmFsbEZsb2F0aW5nID0gZW50cnkuYWxsRmxvYXRpbmcgJiYgZmxvYXRpbmcuaGFzKGtleSk7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiBtYXA7XG59XG5cbi8vIE1hcmtzIG9ubHkgdGhlIG5hbWUgKGtleSBpbnB1dCksIG5vdCB0aGUgdmFsdWUgLSBpbiBub3RlcyAoZnJvbnRtYXR0ZXIgYW5kXG4vLyBwcm9wZXJ0aWVzIHNpZGViYXIpIGFzIHdlbGwgYXMgaW4gdGhlIHBsdWdpbidzIG93biBUWVAtUGFuZS5cbmZ1bmN0aW9uIGFwcGx5VG9Db250YWluZXIoY29udGFpbmVyRWwsIHN0YW5kYXJkS2V5cywgZmxvYXRpbmdLZXlzKSB7XG4gIGlmICghY29udGFpbmVyRWwpIHJldHVybjtcbiAgY29uc3Qgcm93cyA9IGNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIubWV0YWRhdGEtcHJvcGVydHlbZGF0YS1wcm9wZXJ0eS1rZXldXCIpO1xuICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XG4gICAgY29uc3Qga2V5RWwgPSByb3cucXVlcnlTZWxlY3RvcihcIi5tZXRhZGF0YS1wcm9wZXJ0eS1rZXktaW5wdXRcIik7XG4gICAgaWYgKCFrZXlFbCkgY29udGludWU7XG4gICAgY29uc3QgcHJvcGVydHlLZXkgPSByb3cuZ2V0QXR0cmlidXRlKFwiZGF0YS1wcm9wZXJ0eS1rZXlcIik7XG4gICAga2V5RWwuY2xhc3NMaXN0LnRvZ2dsZShISUdITElHSFRfQ0xBU1MsICEhc3RhbmRhcmRLZXlzICYmIHN0YW5kYXJkS2V5cy5oYXMocHJvcGVydHlLZXkpKTtcbiAgICBrZXlFbC5jbGFzc0xpc3QudG9nZ2xlKEZMT0FUSU5HX0NMQVNTLCAhIWZsb2F0aW5nS2V5cyAmJiBmbG9hdGluZ0tleXMuaGFzKHByb3BlcnR5S2V5KSk7XG4gIH1cbn1cblxuLy8gXCJBbGwgcHJvcGVydGllc1wiIGRvZXNuJ3QgdXNlIHRoZSBtZXRhZGF0YSB3aWRnZXQgYnV0IGl0cyBvd24gdHJlZSBpdGVtcyxcbi8vIHJlYWNoYWJsZSB2aWEgdmlldy5kb21zIChuYW1lIC0+IGNvbXBvbmVudCk7IHRoZWlyIHRpdGxlIGVsZW1lbnQgaXNcbi8vIC50cmVlLWl0ZW0taW5uZXItdGV4dC5cbi8vXG4vLyBPbmUgVFlQIHVzaW5nIHRoZSBwcm9wZXJ0eTogdGhlIG5hbWUgZ2V0cyB0aGF0IFRZUCdzIGNvbG9yLiBTZXZlcmFsOiBhXG4vLyBzaW5nbGUgY29sb3Igd291bGQgbWlzbGVhZCwgc28gYm9sZCBpbnN0ZWFkIChzYW1lIG1hcmsgYXMgaW4gYSBub3RlKS5cbmZ1bmN0aW9uIGFwcGx5VG9BbGxQcm9wZXJ0aWVzVmlldyhwbHVnaW4pIHtcbiAgY29uc3QgdXNhZ2VNYXAgPSB0eXBzVXNpbmdLZXlNYXAocGx1Z2luKTtcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShBTExfUFJPUEVSVElFU19WSUVXX1RZUEUpKSB7XG4gICAgY29uc3QgZG9tcyA9IGxlYWYudmlldz8uZG9tcztcbiAgICBpZiAoIWRvbXMpIGNvbnRpbnVlO1xuICAgIGZvciAoY29uc3QgW2tleSwgZG9tXSBvZiBPYmplY3QuZW50cmllcyhkb21zKSkge1xuICAgICAgY29uc3QgdGl0bGVFbCA9IGRvbT8udGl0bGVFbDtcbiAgICAgIGlmICghdGl0bGVFbCkgY29udGludWU7XG5cbiAgICAgIGNvbnN0IGVudHJ5ID0gdXNhZ2VNYXAuZ2V0KGtleS50b0xvd2VyQ2FzZSgpKTtcbiAgICAgIGNvbnN0IHR5cHMgPSBlbnRyeT8udHlwcztcbiAgICAgIGNvbnN0IGNvdW50ID0gdHlwcyA/IHR5cHMuc2l6ZSA6IDA7XG4gICAgICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoSElHSExJR0hUX0NMQVNTLCBjb3VudCA+IDEpO1xuXG4gICAgICAvLyBJdGFsaWMgYXMgc29vbiBhcyBpdCBpcyBmbG9hdGluZyBFVkVSWVdIRVJFLiBVbmxpa2UgYm9sZCB0aGlzIGlzbid0XG4gICAgICAvLyBsaW1pdGVkIHRvIG9uZSBUWVAsIHNvIGJvdGggY2FuIGFwcGx5IGF0IG9uY2UuXG4gICAgICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoRkxPQVRJTkdfQ0xBU1MsIGNvdW50ID4gMCAmJiBlbnRyeS5hbGxGbG9hdGluZyk7XG5cbiAgICAgIC8vIFdpdGggXCJTdWJ0eXBcIiwgdGhlIGNvbG9yIG9mIHRoZSBTdWJ0eXAgYmxvY2sgdGhlIHByb3BlcnR5IGNvbWVzIGZyb20gLVxuICAgICAgLy8gYnV0IG9ubHkgaWYgZXhhY3RseSBvbmUgYmxvY2sgb2YgdGhhdCBUWVAgaGFzIGl0LiBPdGhlcndpc2UgdGhlIGNob2ljZVxuICAgICAgLy8gd291bGQgYmUgYXJiaXRyYXJ5IGFuZCBjaGFuZ2Ugd2l0aCBibG9jayBvcmRlciwgc28gdGhlIFRZUCBjb2xvclxuICAgICAgLy8gKHN1YnR5cENvbG9yIHdpdGggbnVsbCkgaXMgdXNlZC5cbiAgICAgIGlmIChjb3VudCA9PT0gMSkge1xuICAgICAgICBjb25zdCBbW29ubHlUeXAsIHNlY3Rpb25zXV0gPSB0eXBzO1xuICAgICAgICBjb25zdCBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmFsbFByb3BlcnRpZXNTdWJ0eXBcbiAgICAgICAgICA/IHN1YnR5cENvbG9yKHBsdWdpbi5zZXR0aW5ncywgb25seVR5cCwgc2VjdGlvbnMubGVuZ3RoID09PSAxID8gc2VjdGlvbnNbMF0gOiBudWxsKVxuICAgICAgICAgIDogcGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1tvbmx5VHlwXTtcbiAgICAgICAgLy8gIWltcG9ydGFudCwgYmVjYXVzZSB0aGUgYm9sZCBydWxlIGluIHN0eWxlcy5jc3MgYWxzbyBzZXRzIGNvbG9yXG4gICAgICAgIC8vICFpbXBvcnRhbnQgYW5kIGNvdWxkIHN0aWxsIGJlIGF0dGFjaGVkIGZyb20gYW4gZWFybGllciBzdGF0ZS5cbiAgICAgICAgc2V0SW5saW5lQ29sb3IodGl0bGVFbCwgY29sb3IsIFwiaW1wb3J0YW50XCIpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc2V0SW5saW5lQ29sb3IodGl0bGVFbCwgbnVsbCk7XG4gICAgICB9XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGFwcGx5RnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0KHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikpIHtcbiAgICBjb25zdCB2aWV3ID0gbGVhZi52aWV3O1xuICAgIGNvbnN0IHsgc3RhbmRhcmQsIGZsb2F0aW5nIH0gPSBrZXlzRm9yRmlsZShwbHVnaW4sIHZpZXc/LmZpbGUpO1xuICAgIGFwcGx5VG9Db250YWluZXIodmlldz8ubWV0YWRhdGFFZGl0b3I/LmNvbnRhaW5lckVsLCBzdGFuZGFyZCwgZmxvYXRpbmcpO1xuICB9XG5cbiAgLy8gVGhlIHByb3BlcnRpZXMgc2lkZWJhciBhbHdheXMgc2hvd3MgdGhlIGFjdGl2ZSBmaWxlIGJ1dCBrZWVwcyBubyByZWxpYWJsZVxuICAvLyByZWZlcmVuY2UgdG8gaXQsIGhlbmNlIHRoZSBmYWxsYmFjayB0byB0aGUgd29ya3NwYWNlJ3MgYWN0aXZlIGZpbGUuXG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJmaWxlLXByb3BlcnRpZXNcIikpIHtcbiAgICBjb25zdCB2aWV3ID0gbGVhZi52aWV3O1xuICAgIGNvbnN0IGZpbGUgPSB2aWV3Py5maWxlID8/IHBsdWdpbi5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICBjb25zdCB7IHN0YW5kYXJkLCBmbG9hdGluZyB9ID0ga2V5c0ZvckZpbGUocGx1Z2luLCBmaWxlKTtcbiAgICBhcHBseVRvQ29udGFpbmVyKHZpZXc/Lm1ldGFkYXRhRWRpdG9yPy5jb250YWluZXJFbCwgc3RhbmRhcmQsIGZsb2F0aW5nKTtcbiAgfVxuXG4gIC8vIFRoZSBUWVAtUGFuZTogZWFjaCBlZGl0b3Igc2hvd3MgZXhhY3RseSBvbmUgYmxvY2sgKFRZUCBvciBTdWJ0eXApLlxuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFZJRVdfVFlQRV9UWVBfUEFORSkpIHtcbiAgICBmb3IgKGNvbnN0IGVkaXRvciBvZiBsZWFmLnZpZXc/LmZyb250bWF0dGVyRWRpdG9ycyA/PyBbXSkge1xuICAgICAgY29uc3QgeyBzdGFuZGFyZCwgZmxvYXRpbmcgfSA9IGtleXNGb3JTdG9yZShwbHVnaW4sIGVkaXRvci5vd25lcj8udHlwU3RvcmUpO1xuICAgICAgYXBwbHlUb0NvbnRhaW5lcihlZGl0b3IuY29udGFpbmVyRWwsIHN0YW5kYXJkLCBmbG9hdGluZyk7XG4gICAgfVxuICB9XG5cbiAgYXBwbHlUb0FsbFByb3BlcnRpZXNWaWV3KHBsdWdpbik7XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyRnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0KHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQocGx1Z2luKTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLm1ldGFkYXRhQ2FjaGUub24oXCJjaGFuZ2VkXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC5tZXRhZGF0YUNhY2hlLm9uKFwicmVzb2x2ZWRcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImFjdGl2ZS1sZWFmLWNoYW5nZVwiLCByZWZyZXNoKSk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeShyZWZyZXNoKTtcblxuICAvLyBCb2xkL2l0YWxpYyBtYXJrcyB3b3VsZCBvdGhlcndpc2Ugc3RheSBvbiBwcm9wZXJ0eSBuYW1lcyBpbiBvcGVuIG5vdGVzLFxuICAvLyB0aGUgcHJvcGVydGllcyBzaWRlYmFyIGFuZCBcIkFsbCBwcm9wZXJ0aWVzXCIgYWZ0ZXIgdGhlIHBsdWdpbiBpcyBkaXNhYmxlZC5cbiAgLy8gVGhlIGNvbG9yIGluIFwiQWxsIHByb3BlcnRpZXNcIiBnb2VzIHdpdGggdGhlIG90aGVyIGlubGluZSBjb2xvcnNcbiAgLy8gKGNsZWFySW5saW5lQ29sb3JzLCBzZWUgbWFpbi5qcykuXG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiB7XG4gICAgZm9yIChjb25zdCBkb2Mgb2YgYWxsRG9jdW1lbnRzKHBsdWdpbi5hcHApKSB7XG4gICAgICBmb3IgKGNvbnN0IGVsIG9mIGRvYy5xdWVyeVNlbGVjdG9yQWxsKGAuJHtISUdITElHSFRfQ0xBU1N9LCAuJHtGTE9BVElOR19DTEFTU31gKSkge1xuICAgICAgICBlbC5jbGFzc0xpc3QucmVtb3ZlKEhJR0hMSUdIVF9DTEFTUywgRkxPQVRJTkdfQ0xBU1MpO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodCB9O1xuIiwgImNvbnN0IHsgTm90aWNlIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IHR5cFN0b3JlLCBzdWJ0eXBTdG9yZSB9ID0gcmVxdWlyZShcIi4vdHlwLWZyb250bWF0dGVyLWVkaXRvclwiKTtcbmNvbnN0IHsgZ2V0U3VidHlwTmFtZXMsIGlzRW1wdHlWYWx1ZSB9ID0gcmVxdWlyZShcIi4vc3VidHlwc1wiKTtcbmNvbnN0IHsgcGx1cmFsLCBqb2luQW5kIH0gPSByZXF1aXJlKFwiLi90eXAtdXRpbHNcIik7XG5jb25zdCB7IFRZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZIH0gPSByZXF1aXJlKFwiLi90eXAtaW5kZXhcIik7XG5cbi8vIE9ic2lkaWFuIGxvd2VyY2FzZXMgcHJvcGVydHkgbmFtZXMgaW50ZXJuYWxseSwgc28gbWF0Y2hpbmcgaWdub3JlcyBjYXNlO1xuLy8gdGhlIG5ldyBuYW1lIGlzIGtlcHQgZXhhY3RseSBhcyB0eXBlZC5cbmZ1bmN0aW9uIHNhbWVLZXkoYSwgYikge1xuICByZXR1cm4gYS50b0xvd2VyQ2FzZSgpID09PSBiLnRvTG93ZXJDYXNlKCk7XG59XG5cbi8vIFJlbmFtZXMgb2xkS2V5IGluIG9uZSBmcm9udG1hdHRlciBibG9jayAoVFlQIG9yIFN1YnR5cCwgc2VlIHR5cFN0b3JlL1xuLy8gc3VidHlwU3RvcmUgaW4gdHlwLWZyb250bWF0dGVyLWVkaXRvci5qcyksIGtlZXBpbmcgaXRzIHBvc2l0aW9uLCBhbmQgbW92ZXNcbi8vIHRoZSBmbG9hdGluZyBmbGFnIGFsb25nLiBJZiBuZXdLZXkgYWxyZWFkeSBleGlzdHMgdGhlcmUgKGEgbWVyZ2UsIGxpa2Vcbi8vIE9ic2lkaWFuJ3Mgb3duIG1lcmdlIGluIHRoZSBub3RlcyksIHRoZSBleGlzdGluZyBlbnRyeSBrZWVwcyBpdHMgcG9zaXRpb25cbi8vIGFuZCBvbmx5IHRha2VzIHRoZSBvbGQgdmFsdWUgaWYgaXRzIG93biBpcyBlbXB0eS4gUmV0dXJucyB0cnVlIG9uIGEgY2hhbmdlLlxuZnVuY3Rpb24gcmVuYW1lSW5TdG9yZShzdG9yZSwgb2xkS2V5LCBuZXdLZXkpIHtcbiAgY29uc3QgZGVmYXVsdHMgPSBzdG9yZS5nZXRGcm9udG1hdHRlcigpO1xuICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXMoZGVmYXVsdHMpO1xuICBjb25zdCBzb3VyY2VLZXkgPSBrZXlzLmZpbmQoKGtleSkgPT4gc2FtZUtleShrZXksIG9sZEtleSkpO1xuICBpZiAoc291cmNlS2V5ID09PSB1bmRlZmluZWQpIHJldHVybiBmYWxzZTtcbiAgLy8gQSBwdXJlIGNoYW5nZSBvZiBjYXNlIGZpbmRzIHNvdXJjZUtleSBpdHNlbGYgZm9yIG5ld0tleSAtIG5vdCBhIG1lcmdlLlxuICBjb25zdCB0YXJnZXRLZXkgPSBrZXlzLmZpbmQoKGtleSkgPT4ga2V5ICE9PSBzb3VyY2VLZXkgJiYgc2FtZUtleShrZXksIG5ld0tleSkpO1xuICBpZiAodGFyZ2V0S2V5ID09PSB1bmRlZmluZWQgJiYgc291cmNlS2V5ID09PSBuZXdLZXkpIHJldHVybiBmYWxzZTtcblxuICBjb25zdCBuZXh0ID0ge307XG4gIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICBpZiAoa2V5ICE9PSBzb3VyY2VLZXkpIHtcbiAgICAgIG5leHRba2V5XSA9IGRlZmF1bHRzW2tleV07XG4gICAgfSBlbHNlIGlmICh0YXJnZXRLZXkgPT09IHVuZGVmaW5lZCkge1xuICAgICAgbmV4dFtuZXdLZXldID0gZGVmYXVsdHNbc291cmNlS2V5XTtcbiAgICB9XG4gIH1cbiAgaWYgKHRhcmdldEtleSAhPT0gdW5kZWZpbmVkICYmIGlzRW1wdHlWYWx1ZShuZXh0W3RhcmdldEtleV0pKSBuZXh0W3RhcmdldEtleV0gPSBkZWZhdWx0c1tzb3VyY2VLZXldO1xuICBzdG9yZS5zZXRGcm9udG1hdHRlcihuZXh0KTtcblxuICBjb25zdCBmbG9hdGluZyA9IHN0b3JlLmdldEZsb2F0aW5nKCk7XG4gIGlmIChmbG9hdGluZy5sZW5ndGggPiAwKSB7XG4gICAgLy8gT24gYSBtZXJnZSB0aGUgdGFyZ2V0J3MgZmxvYXRpbmcgZmxhZyB3aW5zLlxuICAgIHN0b3JlLnNldEZsb2F0aW5nKFxuICAgICAgdGFyZ2V0S2V5ICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyBmbG9hdGluZy5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBzb3VyY2VLZXkpXG4gICAgICAgIDogZmxvYXRpbmcubWFwKChrZXkpID0+IChrZXkgPT09IHNvdXJjZUtleSA/IG5ld0tleSA6IGtleSkpXG4gICAgKTtcbiAgfVxuXG4gIC8vIFRoZSBzaG9ydGN1dCBiZWxvbmdzIHRvIHRoZSBrZXkgYW5kIG1vdmVzIHdpdGggaXQ7IG9uIGEgbWVyZ2UgdGhlXG4gIC8vIHRhcmdldCdzIHdpbnMsIGFzIHdpdGggZmxvYXRpbmcuXG4gIGNvbnN0IHNob3J0Y3V0cyA9IHsgLi4uc3RvcmUuZ2V0U2hvcnRjdXRzKCkgfTtcbiAgaWYgKHNob3J0Y3V0c1tzb3VyY2VLZXldKSB7XG4gICAgaWYgKHRhcmdldEtleSA9PT0gdW5kZWZpbmVkKSBzaG9ydGN1dHNbbmV3S2V5XSA9IHNob3J0Y3V0c1tzb3VyY2VLZXldO1xuICAgIGRlbGV0ZSBzaG9ydGN1dHNbc291cmNlS2V5XTtcbiAgICBzdG9yZS5zZXRTaG9ydGN1dHMoc2hvcnRjdXRzKTtcbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn1cblxuLy8gUGlubmVkIGVudHJpZXMgb2YgdGhlIGdsb2JhbCBvcmRlciBhbGxvdyBubyBkdXBsaWNhdGVzLCBzbyBhbiBleGlzdGluZ1xuLy8gdGFyZ2V0IGVudHJ5IGtlZXBzIGl0cyBwb3NpdGlvbiBhbmQgdGhlIG9sZCBvbmUgZ29lcy5cbmZ1bmN0aW9uIHJlbmFtZUluR2xvYmFsT3JkZXIoc2V0dGluZ3MsIG9sZEtleSwgbmV3S2V5KSB7XG4gIGNvbnN0IG9yZGVyID0gc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcjtcbiAgY29uc3Qgc291cmNlID0gb3JkZXIuZmluZCgoZW50cnkpID0+IGVudHJ5LmtpbmQgPT09IFwicHJvcGVydHlcIiAmJiBzYW1lS2V5KGVudHJ5Lm5hbWUsIG9sZEtleSkpO1xuICBpZiAoIXNvdXJjZSkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCB0YXJnZXQgPSBvcmRlci5maW5kKChlbnRyeSkgPT4gZW50cnkgIT09IHNvdXJjZSAmJiBlbnRyeS5raW5kID09PSBcInByb3BlcnR5XCIgJiYgc2FtZUtleShlbnRyeS5uYW1lLCBuZXdLZXkpKTtcbiAgaWYgKHRhcmdldCkgc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlciA9IG9yZGVyLmZpbHRlcigoZW50cnkpID0+IGVudHJ5ICE9PSBzb3VyY2UpO1xuICBlbHNlIGlmIChzb3VyY2UubmFtZSA9PT0gbmV3S2V5KSByZXR1cm4gZmFsc2U7XG4gIGVsc2Ugc291cmNlLm5hbWUgPSBuZXdLZXk7XG4gIHJldHVybiB0cnVlO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzeW5jUmVuYW1lKHBsdWdpbiwgb2xkS2V5LCBuZXdLZXkpIHtcbiAgaWYgKHR5cGVvZiBvbGRLZXkgIT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIG5ld0tleSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuO1xuICBuZXdLZXkgPSBuZXdLZXkudHJpbSgpO1xuICBpZiAob2xkS2V5ID09PSBcIlwiIHx8IG5ld0tleSA9PT0gXCJcIiB8fCBvbGRLZXkgPT09IG5ld0tleSkgcmV0dXJuO1xuICAvLyBUWVAvU1VCVFlQIGFyZSBuZXZlciBwYXJ0IG9mIGEgYmxvY2sgKHNlZSBzdHJpcFR5cFByb3BlcnR5IGluXG4gIC8vIHR5cC1mcm9udG1hdHRlci1lZGl0b3IuanMpLCBzbyByZW5hbWVzIGZyb20gb3IgdG8gdGhlbSBhcmUgaWdub3JlZC5cbiAgaWYgKFtvbGRLZXksIG5ld0tleV0uc29tZSgoa2V5KSA9PiBzYW1lS2V5KGtleSwgVFlQX1BST1BFUlRZKSB8fCBzYW1lS2V5KGtleSwgU1VCVFlQX1BST1BFUlRZKSkpIHJldHVybjtcblxuICBjb25zdCB7IHNldHRpbmdzIH0gPSBwbHVnaW47XG4gIGxldCB0eXBDb3VudCA9IDA7XG4gIGxldCBzdWJ0eXBDb3VudCA9IDA7XG4gIGNvbnN0IGNvdW50ID0gKHN0b3JlKSA9PiAoc3RvcmUuc3VidHlwID8gc3VidHlwQ291bnQrKyA6IHR5cENvdW50KyspO1xuICBjb25zdCB0eXBzID0gbmV3IFNldChbLi4uT2JqZWN0LmtleXMoc2V0dGluZ3MudHlwRGVmYXVsdEZyb250bWF0dGVyKSwgLi4uT2JqZWN0LmtleXMoc2V0dGluZ3MudHlwU3VidHlwcyA/PyB7fSldKTtcbiAgZm9yIChjb25zdCB0eXAgb2YgdHlwcykge1xuICAgIGNvbnN0IHN0b3JlcyA9IFt0eXBTdG9yZShwbHVnaW4sIHR5cCksIC4uLmdldFN1YnR5cE5hbWVzKHNldHRpbmdzLCB0eXApLm1hcCgoc3VidHlwKSA9PiBzdWJ0eXBTdG9yZShwbHVnaW4sIHR5cCwgc3VidHlwKSldO1xuXG4gICAgLy8gQSB2YXVsdC13aWRlIHJlbmFtZSBoaXRzIEVWRVJZIGJsb2NrIGhvbGRpbmcgdGhlIGtleSAtIHRoZSBzYW1lIGtleSBtYXlcbiAgICAvLyBhcHBlYXIgaW4gc2V2ZXJhbCBibG9ja3MgKHNlZSB0eXBTdWJ0eXBzIGluIHN1YnR5cHMuanMpLiBPbmx5IHdpdGhpbiBvbmVcbiAgICAvLyBibG9jayBjYW4gdGhlIG5ldyBuYW1lIGNvbGxpZGU7IHJlbmFtZUluU3RvcmUgbWVyZ2VzIHRoZSB0d28gdGhlcmUuXG4gICAgZm9yIChjb25zdCBzdG9yZSBvZiBzdG9yZXMpIHtcbiAgICAgIGlmIChyZW5hbWVJblN0b3JlKHN0b3JlLCBvbGRLZXksIG5ld0tleSkpIGNvdW50KHN0b3JlKTtcbiAgICB9XG4gIH1cbiAgY29uc3Qgb3JkZXJDaGFuZ2VkID0gcmVuYW1lSW5HbG9iYWxPcmRlcihzZXR0aW5ncywgb2xkS2V5LCBuZXdLZXkpO1xuICBpZiAodHlwQ291bnQgPT09IDAgJiYgc3VidHlwQ291bnQgPT09IDAgJiYgIW9yZGVyQ2hhbmdlZCkgcmV0dXJuO1xuXG4gIGF3YWl0IHBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgcGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuXG4gIGNvbnN0IHBhcnRzID0gW107XG4gIGlmICh0eXBDb3VudCA+IDApIHBhcnRzLnB1c2gocGx1cmFsKHR5cENvdW50LCBcIlRZUCBibG9ja1wiKSk7XG4gIGlmIChzdWJ0eXBDb3VudCA+IDApIHBhcnRzLnB1c2gocGx1cmFsKHN1YnR5cENvdW50LCBcIlN1YnR5cCBibG9ja1wiKSk7XG4gIGlmIChvcmRlckNoYW5nZWQpIHBhcnRzLnB1c2goXCJ0aGUgZ2xvYmFsIG9yZGVyXCIpO1xuICBuZXcgTm90aWNlKGBUWVAtU3lzdGVtOiByZW5hbWVkIFwiJHtvbGRLZXl9XCIgXHUyMTkyIFwiJHtuZXdLZXl9XCIgaW4gJHtqb2luQW5kKHBhcnRzKX0uYCk7XG59XG5cbi8vIE9ic2lkaWFuJ3MgXCJBbGwgcHJvcGVydGllc1wiIHZpZXcgYW5kIEJhc2VzIChuYW1pbmcgYSBuZXcgbm90ZSBwcm9wZXJ0eSlcbi8vIHJlbmFtZSBwcm9wZXJ0aWVzIHZhdWx0LXdpZGUgb25seSB0aHJvdWdoIGFwcC5maWxlTWFuYWdlci5yZW5hbWVQcm9wZXJ0eSxcbi8vIHNvIHdyYXBwaW5nIHRoYXQgb25lIG1ldGhvZCBjYXRjaGVzIGV2ZXJ5IHJlYWwgcmVuYW1lLiBCYXNlcycgXCJEaXNwbGF5XG4vLyBuYW1lXCIgb25seSBjaGFuZ2VzIHRoZSAuYmFzZSBmaWxlLCBub3QgdGhlIG5vdGVzLCBhbmQgcmlnaHRseSBkb2Vzbid0IHBhc3Ncbi8vIHRocm91Z2ggaGVyZS5cbmZ1bmN0aW9uIHJlZ2lzdGVyUHJvcGVydHlSZW5hbWVTeW5jKHBsdWdpbikge1xuICBjb25zdCBmaWxlTWFuYWdlciA9IHBsdWdpbi5hcHAuZmlsZU1hbmFnZXI7XG4gIGlmIChmaWxlTWFuYWdlci5fX3R5cFN5c3RlbVJlbmFtZVN5bmNQYXRjaGVkKSByZXR1cm47XG4gIGZpbGVNYW5hZ2VyLl9fdHlwU3lzdGVtUmVuYW1lU3luY1BhdGNoZWQgPSB0cnVlO1xuXG4gIGNvbnN0IG9yaWdpbmFsID0gZmlsZU1hbmFnZXIucmVuYW1lUHJvcGVydHk7XG4gIGZpbGVNYW5hZ2VyLnJlbmFtZVByb3BlcnR5ID0gYXN5bmMgZnVuY3Rpb24gKG9sZEtleSwgbmV3S2V5LCAuLi5yZXN0KSB7XG4gICAgLy8gSWYgdGhlIG9yaWdpbmFsIHRocm93cyAoYWNjZXB0UmVuYW1lIGhhbmRsZXMgdGhhdCksIHNldHRpbmdzIHN0YXkgYXNcbiAgICAvLyB0aGV5IGFyZS5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBvcmlnaW5hbC5jYWxsKHRoaXMsIG9sZEtleSwgbmV3S2V5LCAuLi5yZXN0KTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgc3luY1JlbmFtZShwbHVnaW4sIG9sZEtleSwgbmV3S2V5KTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihcIlRZUC1TeXN0ZW06IHByb3BlcnR5IHJlbmFtZSBub3QgYXBwbGllZFwiLCBlcnJvcik7XG4gICAgICBuZXcgTm90aWNlKGBUWVAtU3lzdGVtOiByZW5hbWUgb2YgXCIke29sZEtleX1cIiBub3QgYXBwbGllZCBcdTIwMTMgJHtlcnJvci5tZXNzYWdlfWApO1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9O1xuXG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiB7XG4gICAgZmlsZU1hbmFnZXIucmVuYW1lUHJvcGVydHkgPSBvcmlnaW5hbDtcbiAgICBkZWxldGUgZmlsZU1hbmFnZXIuX190eXBTeXN0ZW1SZW5hbWVTeW5jUGF0Y2hlZDtcbiAgfSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlclByb3BlcnR5UmVuYW1lU3luYyB9O1xuIiwgImNvbnN0IHsgRnV6enlTdWdnZXN0TW9kYWwsIE5vdGljZSwgcHJlcGFyZUZ1enp5U2VhcmNoLCByZW5kZXJNYXRjaGVzIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IGNvbXBhcmVUeXBzLCBERUZBVUxUX1NPUlRfT1JERVIgfSA9IHJlcXVpcmUoXCIuL3R5cC1wYW5lXCIpO1xuY29uc3QgeyBuYW1lQ29sb3IsIHBhaW50Q29sb3JEb3QgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5jb25zdCB7IHBpY2tlckluc3RydWN0aW9ucyB9ID0gcmVxdWlyZShcIi4vdHlwLXV0aWxzXCIpO1xuXG4vLyBUaGUgc2VhcmNoIHRleHQgb2YgYSBUWVAgcm93LCBhcyB0aGUgcGFydHMgdGhlIHJvdyByZW5kZXJzIHNlcGFyYXRlbHk6XG4vLyBbeyBrZXk6IFwidHlwXCIgfCBcInN1YnR5cHNcIiB8IFwiZGVzY3JpcHRpb25cIiwgdGV4dCwgc3RhcnQgfV0sIHN0YXJ0IGJlaW5nIHRoZVxuLy8gcGFydCdzIHBvc2l0aW9uIGluIHRoZSBzZWFyY2ggdGV4dC4gZ2V0SXRlbVRleHQgam9pbnMgZXhhY3RseSB0aGVzZSB3aXRoXG4vLyBcIiBcIiwgc28gdGhpcyBpcyB0aGUgb25lIHBsYWNlIHRoYXQgZGVmaW5lcyBpdCAtIHRoZSBtYXRjaCByYW5nZXMgT2JzaWRpYW5cbi8vIHJldHVybnMgcmVmZXIgdG8gdGhlIGpvaW5lZCB0ZXh0IGFuZCBhcmUgc3BsaXQgYmFjayBvbnRvIHRoZSBwYXJ0cyBieVxuLy8gc3RhcnQgKHNlZSBoaWdobGlnaHQpLiBUaGUgU3VidHlwIG5hbWVzIGFyZSBvbmUgcGFydCwgam9pbmVkIHdpdGggXCIgXCIgYXMgaW5cbi8vIHRoZSBzZWFyY2ggdGV4dCwgdGhvdWdoIHRoZSByb3cgc2hvd3MgdGhlbSB3aXRoIFwiLCBcIi5cbmZ1bmN0aW9uIHRleHRQYXJ0cyhpdGVtKSB7XG4gIGNvbnN0IHBhcnRzID0gW107XG4gIGxldCBzdGFydCA9IDA7XG4gIGNvbnN0IGFkZCA9IChrZXksIHRleHQpID0+IHtcbiAgICBpZiAoIXRleHQpIHJldHVybjtcbiAgICBwYXJ0cy5wdXNoKHsga2V5LCB0ZXh0LCBzdGFydCB9KTtcbiAgICBzdGFydCArPSB0ZXh0Lmxlbmd0aCArIDE7XG4gIH07XG4gIGFkZChcInR5cFwiLCBpdGVtLnR5cCk7XG4gIGFkZChcInN1YnR5cHNcIiwgaXRlbS5zdWJ0eXBzPy5qb2luKFwiIFwiKSk7XG4gIGFkZChcImRlc2NyaXB0aW9uXCIsIGl0ZW0uZGVzY3JpcHRpb24pO1xuICByZXR1cm4gcGFydHM7XG59XG5cbi8vIFdyaXRlcyB0ZXh0IGludG8gZWwgd2l0aCB0aGUgbWF0Y2hlZCBjaGFyYWN0ZXJzIG1hcmtlZCBsaWtlIGluIE9ic2lkaWFuJ3Ncbi8vIG93biBzdWdnZXN0ZXJzICguc3VnZ2VzdGlvbi1oaWdobGlnaHQpLiBzdGFydCBpcyB0aGUgdGV4dCdzIHBvc2l0aW9uIGluIHRoZVxuLy8gd2hvbGUgc2VhcmNoIHRleHQ7IHJlbmRlck1hdGNoZXMgc2hpZnRzIGV2ZXJ5IHJhbmdlIGJ5IGl0cyBvZmZzZXQgYW5kXG4vLyBjbGlwcyB3aGF0IGZhbGxzIG91dHNpZGUsIHNvIC1zdGFydCBtYXBzIHRoZSByYW5nZXMgb250byB0aGlzIHBhcnQuXG5mdW5jdGlvbiBoaWdobGlnaHQoZWwsIHRleHQsIG1hdGNoZXMsIHN0YXJ0ID0gMCkge1xuICByZW5kZXJNYXRjaGVzKGVsLCB0ZXh0LCBtYXRjaGVzPy5sZW5ndGggPyBtYXRjaGVzIDogbnVsbCwgLXN0YXJ0KTtcbn1cblxuLy8gTmF0aXZlIHJlcGxhY2VtZW50IGZvciBUZW1wbGF0ZXIncyB0cC5zeXN0ZW0uc3VnZ2VzdGVyIHdoZW4gY2hvb3NpbmcgYSBUWVBcbi8vIChzZWUgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qcyksIGJ1aWx0IG9uIE9ic2lkaWFuJ3Ncbi8vIEZ1enp5U3VnZ2VzdE1vZGFsIGxpa2UgVGVtcGxhdGVyJ3Mgb3duLCBidXQgc2hvd2luZyBjb2xvciBvciBkb3QsXG4vLyBkZXNjcmlwdGlvbiBhbmQgbm90ZSBjb3VudCBwZXIgcm93LiBVbnJlZ2lzdGVyZWQgZW50cmllcyBhcmUgbXV0ZWQsIGFzIGluXG4vLyB0aGUgVFlQLUxpc3QuXG5jbGFzcyBUeXBQaWNrZXJNb2RhbCBleHRlbmRzIEZ1enp5U3VnZ2VzdE1vZGFsIHtcbiAgY29uc3RydWN0b3IoYXBwLCBwbHVnaW4sIGl0ZW1zLCByZXNvbHZlKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgICB0aGlzLml0ZW1zID0gaXRlbXM7XG4gICAgdGhpcy5yZXNvbHZlID0gcmVzb2x2ZTtcbiAgICB0aGlzLmNob3NlbiA9IGZhbHNlO1xuICAgIHRoaXMuc2V0UGxhY2Vob2xkZXIoXCJDaG9vc2UgVFlQXHUyMDI2XCIpO1xuICAgIHRoaXMuc2V0SW5zdHJ1Y3Rpb25zKHBpY2tlckluc3RydWN0aW9ucygpKTtcbiAgfVxuXG4gIGdldEl0ZW1zKCkge1xuICAgIHJldHVybiB0aGlzLml0ZW1zO1xuICB9XG5cbiAgLy8gU2VhcmNoIGFsc28gY292ZXJzIHRoZSBkZXNjcmlwdGlvbiBhbmQsIHdoZXJlIHNob3duIGluIHRoZSByb3dcbiAgLy8gKHNob3dTdWJ0eXBzKSwgdGhlIFN1YnR5cCBuYW1lczogd2hhdCB5b3Ugc2VlIHlvdSBleHBlY3QgdG8gYmUgYWJsZSB0byB0eXBlLlxuICBnZXRJdGVtVGV4dChpdGVtKSB7XG4gICAgcmV0dXJuIHRleHRQYXJ0cyhpdGVtKVxuICAgICAgLm1hcCgocGFydCkgPT4gcGFydC50ZXh0KVxuICAgICAgLmpvaW4oXCIgXCIpO1xuICB9XG5cbiAgcmVuZGVyU3VnZ2VzdGlvbihtYXRjaCwgZWwpIHtcbiAgICBjb25zdCBpdGVtID0gbWF0Y2guaXRlbTtcbiAgICBjb25zdCBtYXRjaGVzID0gbWF0Y2gubWF0Y2g/Lm1hdGNoZXMgPz8gW107XG4gICAgY29uc3QgcGFydHMgPSBPYmplY3QuZnJvbUVudHJpZXModGV4dFBhcnRzKGl0ZW0pLm1hcCgocGFydCkgPT4gW3BhcnQua2V5LCBwYXJ0XSkpO1xuICAgIGVsLmFkZENsYXNzKFwidHlwLXBpY2tlci1zdWdnZXN0aW9uXCIpO1xuICAgIGlmIChpdGVtLnVucmVnaXN0ZXJlZCkgZWwuYWRkQ2xhc3MoXCJ0eXAtcGlja2VyLXVucmVnaXN0ZXJlZFwiKTtcblxuICAgIGlmIChpdGVtLnVucmVnaXN0ZXJlZCkge1xuICAgICAgaGlnaGxpZ2h0KGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXBpY2tlci1uYW1lXCIgfSksIGl0ZW0udHlwLCBtYXRjaGVzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5yZW5kZXJDb2xvcmVkTmFtZShlbCwgaXRlbS50eXAsIGl0ZW0udHlwLCBudWxsLCBtYXRjaGVzKTtcbiAgICB9XG5cbiAgICBpZiAoaXRlbS5zdWJ0eXBzPy5sZW5ndGgpIHRoaXMucmVuZGVyU3VidHlwUHJldmlldyhlbCwgaXRlbSwgbWF0Y2hlcywgcGFydHMuc3VidHlwcy5zdGFydCk7XG5cbiAgICBpZiAoaXRlbS5kZXNjcmlwdGlvbikge1xuICAgICAgaGlnaGxpZ2h0KGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXBpY2tlci1kZXNjXCIgfSksIGl0ZW0uZGVzY3JpcHRpb24sIG1hdGNoZXMsIHBhcnRzLmRlc2NyaXB0aW9uLnN0YXJ0KTtcbiAgICB9XG5cbiAgICBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1waWNrZXItY291bnRcIiwgdGV4dDogU3RyaW5nKGl0ZW0uY291bnQpIH0pO1xuICB9XG5cbiAgLy8gTmFtZSBpbiB0aGUgY29sb3Igb2YgY29sb3JUeXAgKG9yIG9mIHRoZSBTdWJ0eXAsIHNlZSBuYW1lQ29sb3IgaW5cbiAgLy8gdHlwLWNvbG9ycy5qcykgLSBhcyBjb2xvcmVkIHRleHQgb3Igd2l0aCBhIGRvdCBiZWZvcmUgaXQsIGRlcGVuZGluZyBvblxuICAvLyB0aGUgXCJUWVAtUGFuZVwiIGNvbG9yaW5nIHNldHRpbmcuIG1hdGNoZXMvc3RhcnQgYXMgaW4gaGlnaGxpZ2h0KCkuXG4gIHJlbmRlckNvbG9yZWROYW1lKGVsLCB0ZXh0LCBjb2xvclR5cCwgc3VidHlwID0gbnVsbCwgbWF0Y2hlcyA9IFtdLCBzdGFydCA9IDApIHtcbiAgICBjb25zdCB7IGNvbG9yLCBpc0RlZmF1bHQgfSA9IG5hbWVDb2xvcih0aGlzLnBsdWdpbi5zZXR0aW5ncywgY29sb3JUeXAsIHN1YnR5cCk7XG4gICAgY29uc3QgY29sb3JpemUgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3Q7XG4gICAgaWYgKCFjb2xvcml6ZSkgcGFpbnRDb2xvckRvdChlbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1waWNrZXItZG90XCIgfSksIGNvbG9yLCBpc0RlZmF1bHQpO1xuICAgIGNvbnN0IG5hbWVFbCA9IGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXBpY2tlci1uYW1lXCIgfSk7XG4gICAgaWYgKGNvbG9yaXplKSBuYW1lRWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcbiAgICBoaWdobGlnaHQobmFtZUVsLCB0ZXh0LCBtYXRjaGVzLCBzdGFydCk7XG4gIH1cblxuICAvLyBcIlRZUCAoU3VidHlwIDEsIFN1YnR5cCAyKVwiIC0gc2hvd3Mgd2hhdCBsaWVzIGJlbG93IHRoZSBUWVAgYmVmb3JlIHRoZVxuICAvLyBzZXBhcmF0ZSBTdWJ0eXAtUGlja2VyIGNvbWVzLiBFYWNoIFN1YnR5cCBpbiBpdHMgb3duIGNvbG9yLCBicmFja2V0cyBhbmRcbiAgLy8gY29tbWFzIG11dGVkOyB1bmNvbG9yZWQgbGlrZSB0aGUgbmFtZSB3aGVuIFwiVFlQLVBhbmVcIiBjb2xvcmluZyBpcyBvZmYuXG4gIC8vIHN0YXJ0IGlzIHdoZXJlIHRoZSBTdWJ0eXAgbmFtZXMgYmVnaW4gaW4gdGhlIHNlYXJjaCB0ZXh0OyB0aGVyZSB0aGV5IGFyZVxuICAvLyBzZXBhcmF0ZWQgYnkgb25lIHNwYWNlIGluc3RlYWQgb2YgXCIsIFwiLCBzbyBlYWNoIG5hbWUgc3RhcnRzIG9uZSBjaGFyYWN0ZXJcbiAgLy8gYWZ0ZXIgdGhlIGVuZCBvZiB0aGUgb25lIGJlZm9yZS5cbiAgcmVuZGVyU3VidHlwUHJldmlldyhlbCwgaXRlbSwgbWF0Y2hlcyA9IFtdLCBzdGFydCA9IDApIHtcbiAgICBjb25zdCBjb2xvcml6ZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdDtcbiAgICBjb25zdCB3cmFwID0gZWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtcGlja2VyLXN1YnR5cHNcIiB9KTtcbiAgICB3cmFwLmFwcGVuZFRleHQoXCIoXCIpO1xuICAgIGxldCBwb3NpdGlvbiA9IHN0YXJ0O1xuICAgIGl0ZW0uc3VidHlwcy5mb3JFYWNoKChzdWJ0eXAsIGluZGV4KSA9PiB7XG4gICAgICBpZiAoaW5kZXggPiAwKSB3cmFwLmFwcGVuZFRleHQoXCIsIFwiKTtcbiAgICAgIGNvbnN0IHNwYW4gPSB3cmFwLmNyZWF0ZVNwYW4oKTtcbiAgICAgIGhpZ2hsaWdodChzcGFuLCBzdWJ0eXAsIG1hdGNoZXMsIHBvc2l0aW9uKTtcbiAgICAgIHBvc2l0aW9uICs9IHN1YnR5cC5sZW5ndGggKyAxO1xuICAgICAgaWYgKGNvbG9yaXplKSBzcGFuLnN0eWxlLmNvbG9yID0gbmFtZUNvbG9yKHRoaXMucGx1Z2luLnNldHRpbmdzLCBpdGVtLnR5cCwgc3VidHlwKS5jb2xvcjtcbiAgICB9KTtcbiAgICB3cmFwLmFwcGVuZFRleHQoXCIpXCIpO1xuICB9XG5cbiAgLy8gT2JzaWRpYW4ncyBzZWxlY3RTdWdnZXN0aW9uKCkgY2FsbHMgY2xvc2UoKSBCRUZPUkUgb25DaG9vc2VJdGVtKCkuIFNldFxuICAvLyBcImNob3NlblwiIGFueSBsYXRlciBhbmQgb25DbG9zZSgpIHJlc29sdmVzIHdpdGggbnVsbCBmaXJzdCAtIGEgcHJvbWlzZSBvbmx5XG4gIC8vIHJlc29sdmVzIG9uY2UsIHNvIGV2ZXJ5IGNob2ljZSB3b3VsZCBjb21lIGJhY2sgYXMgbnVsbC5cbiAgc2VsZWN0U3VnZ2VzdGlvbihpdGVtLCBldnQpIHtcbiAgICB0aGlzLmNob3NlbiA9IHRydWU7XG4gICAgLy8gV2hhdCB3YXMgdHlwZWQgd2hlbiBjaG9vc2luZzsgdGhlIFN1YnR5cC1QaWNrZXIgc29ydHMgYnkgaXQgKHNlZVxuICAgIC8vIHBpY2tUeXBFbnRyeS9zb3J0QnlRdWVyeSkuXG4gICAgdGhpcy5xdWVyeSA9IHRoaXMuaW5wdXRFbC52YWx1ZS50cmltKCk7XG4gICAgc3VwZXIuc2VsZWN0U3VnZ2VzdGlvbihpdGVtLCBldnQpO1xuICB9XG5cbiAgb25DaG9vc2VJdGVtKGl0ZW0pIHtcbiAgICB0aGlzLnJlc29sdmUoaXRlbS50eXApO1xuICB9XG5cbiAgLy8gRVNDIG9yIGEgY2xpY2sgb3V0c2lkZSBjbG9zZXMgd2l0aG91dCBzZWxlY3RTdWdnZXN0aW9uOiByZXNvbHZlIHdpdGggbnVsbFxuICAvLyBpbnN0ZWFkIG9mIGxlYXZpbmcgdGhlIHByb21pc2UgaGFuZ2luZywgbGlrZSB0cC5zeXN0ZW0uc3VnZ2VzdGVyLlxuICBvbkNsb3NlKCkge1xuICAgIHN1cGVyLm9uQ2xvc2UoKTtcbiAgICBpZiAoIXRoaXMuY2hvc2VuKSB0aGlzLnJlc29sdmUobnVsbCk7XG4gIH1cbn1cblxuLy8gUGlja3MgYSBTdWJ0eXAgZm9yIGFuIGFscmVhZHkgY2hvc2VuIFRZUCAoc2VlIHBpY2tTdWJ0eXApLiBMaWtlXG4vLyBUeXBQaWNrZXJNb2RhbCwgcGx1cyBhIGZpcnN0IHJvdyBcIlRZUCAobm8gU3VidHlwKVwiIChpdGVtLm5vbmUpLiBFU0MgcmVzb2x2ZXNcbi8vIHdpdGggbnVsbCwgYW5kIFRZUC5qcyBnb2VzIGJhY2sgdG8gdGhlIFRZUCBjaG9pY2UuIHF1ZXJ5IGlzIHRoZSBzZWFyY2ggZnJvbVxuLy8gdGhlIFRZUC1QaWNrZXIgdGhhdCBwcmUtc29ydHMgdGhlIGxpc3QuXG5jbGFzcyBTdWJ0eXBQaWNrZXJNb2RhbCBleHRlbmRzIFR5cFBpY2tlck1vZGFsIHtcbiAgY29uc3RydWN0b3IoYXBwLCBwbHVnaW4sIHR5cCwgaXRlbXMsIHJlc29sdmUsIHF1ZXJ5ID0gXCJcIikge1xuICAgIHN1cGVyKGFwcCwgcGx1Z2luLCBpdGVtcywgcmVzb2x2ZSk7XG4gICAgdGhpcy50eXAgPSB0eXA7XG4gICAgdGhpcy5zZXRQbGFjZWhvbGRlcihgQ2hvb3NlIFN1YnR5cCBmb3IgJHt0eXB9XHUyMDI2YCk7XG4gICAgdGhpcy5zZXRJbnN0cnVjdGlvbnMocGlja2VySW5zdHJ1Y3Rpb25zKFwidG8gZ28gYmFja1wiKSk7XG4gICAgdGhpcy5pdGVtcyA9IHNvcnRCeVF1ZXJ5KGl0ZW1zLCBxdWVyeSwgKGl0ZW0pID0+IHRoaXMuZ2V0SXRlbVRleHQoaXRlbSkpO1xuICB9XG5cbiAgLy8gVGhlIFwibm8gU3VidHlwXCIgcm93IGlzIGFsc28gZm91bmQgYnkgdGhlIFRZUCBuYW1lIGl0IHNob3dzLCBzbyBcIk9SR0FcIlxuICAvLyB0eXBlZCBpbiB0aGUgVFlQLVBpY2tlciBicmluZ3MgaXQgYmFjayB0byB0aGUgdG9wLlxuICBnZXRJdGVtVGV4dChpdGVtKSB7XG4gICAgcmV0dXJuIGl0ZW0ubm9uZSA/IGAke3RoaXMudHlwfSAke2l0ZW0udHlwfWAgOiBzdXBlci5nZXRJdGVtVGV4dChpdGVtKTtcbiAgfVxuXG4gIHJlbmRlclN1Z2dlc3Rpb24obWF0Y2gsIGVsKSB7XG4gICAgY29uc3QgaXRlbSA9IG1hdGNoLml0ZW07XG4gICAgY29uc3QgbWF0Y2hlcyA9IG1hdGNoLm1hdGNoPy5tYXRjaGVzID8/IFtdO1xuICAgIGVsLmFkZENsYXNzKFwidHlwLXBpY2tlci1zdWdnZXN0aW9uXCIpO1xuICAgIGlmIChpdGVtLm5vbmUpIHtcbiAgICAgIC8vIFwiT1JHQSAobm8gU3VidHlwKVwiOiB0aGUgVFlQIGluIGl0cyBjb2xvciwgdGhlIHN1ZmZpeCBpbiBub3JtYWwgdGV4dFxuICAgICAgLy8gY29sb3IgcmF0aGVyIHRoYW4gbXV0ZWQgLSBpdCBpcyBhIHJlYWwgY2hvaWNlLCBub3QgYSBncmF5ZWQtb3V0XG4gICAgICAvLyBub24tY2hvaWNlLCBhbmQgaXQgc3RhbmRzIGFwYXJ0IGZyb20gdGhlIFN1YnR5cCByb3dzIGJlbG93LiBUaGVcbiAgICAgIC8vIHNlYXJjaCB0ZXh0IGlzIFwiT1JHQSBubyBTdWJ0eXBcIiAoc2VlIGdldEl0ZW1UZXh0KSwgc28gdGhlIHN1ZmZpeFxuICAgICAgLy8gc3RhcnRzIG9uZSBjaGFyYWN0ZXIgYWZ0ZXIgdGhlIFRZUCBuYW1lLlxuICAgICAgdGhpcy5yZW5kZXJDb2xvcmVkTmFtZShlbCwgdGhpcy50eXAsIHRoaXMudHlwLCBudWxsLCBtYXRjaGVzKTtcbiAgICAgIGNvbnN0IG5vbmVFbCA9IGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXBpY2tlci1ub25lXCIgfSk7XG4gICAgICBub25lRWwuYXBwZW5kVGV4dChcIihcIik7XG4gICAgICBoaWdobGlnaHQobm9uZUVsLCBpdGVtLnR5cCwgbWF0Y2hlcywgdGhpcy50eXAubGVuZ3RoICsgMSk7XG4gICAgICBub25lRWwuYXBwZW5kVGV4dChcIilcIik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucmVuZGVyQ29sb3JlZE5hbWUoZWwsIGl0ZW0udHlwLCB0aGlzLnR5cCwgaXRlbS50eXAsIG1hdGNoZXMpO1xuICAgIH1cbiAgICBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1waWNrZXItY291bnRcIiwgdGV4dDogU3RyaW5nKGl0ZW0uY291bnQpIH0pO1xuICB9XG5cbiAgb25DaG9vc2VJdGVtKGl0ZW0pIHtcbiAgICB0aGlzLnJlc29sdmUoaXRlbS5ub25lID8gXCJcIiA6IGl0ZW0udHlwKTtcbiAgfVxufVxuXG4vLyBUWVAtUGlja2VyIHdpdGggZWFjaCBTdWJ0eXAgaW5kZW50ZWQgYmVsb3cgaXRzIFRZUCAodGhlIGRlZmF1bHQgd2hpbGVcbi8vIFwiU2VwYXJhdGUgU3VidHlwLVBpY2tlclwiIGlzIG9mZiwgc2VlIHBpY2tUeXBBbmRTdWJ0eXApLiBUaGUgVFlQIHJvdyBpdHNlbGZcbi8vIG1lYW5zIFwibm8gU3VidHlwXCIuIFNlYXJjaCB3b3JrcyBwZXIgZ3JvdXAgc28gYSBTdWJ0eXAgbmV2ZXIgYXBwZWFycyB3aXRob3V0XG4vLyBpdHMgVFlQOiBhIFRZUCBtYXRjaCBrZWVwcyBhbGwgaXRzIFN1YnR5cHMsIGEgU3VidHlwIG1hdGNoIGtlZXBzIHRoYXQgU3VidHlwXG4vLyB3aXRoIGl0cyBUWVAuIEdyb3VwcyBzb3J0IGJ5IHRoZWlyIGJlc3QgbWF0Y2g7IHdpdGhpbiBhIGdyb3VwIGJsb2NrIG9yZGVyXG4vLyBzdGF5cy5cbmNsYXNzIFR5cFN1YnR5cFBpY2tlck1vZGFsIGV4dGVuZHMgVHlwUGlja2VyTW9kYWwge1xuICBjb25zdHJ1Y3RvcihhcHAsIHBsdWdpbiwgZ3JvdXBzLCByZXNvbHZlKSB7XG4gICAgc3VwZXIoYXBwLCBwbHVnaW4sIGdyb3Vwcy5tYXAoKGdyb3VwKSA9PiBncm91cC5pdGVtKSwgcmVzb2x2ZSk7XG4gICAgdGhpcy5ncm91cHMgPSBncm91cHM7XG4gICAgdGhpcy5zZXRQbGFjZWhvbGRlcihcIkNob29zZSBUWVAgb3IgU3VidHlwXHUyMDI2XCIpO1xuICB9XG5cbiAgZ2V0U3VnZ2VzdGlvbnMocXVlcnkpIHtcbiAgICBjb25zdCBzZWFyY2ggPSBxdWVyeS50cmltKCkgPyBwcmVwYXJlRnV6enlTZWFyY2gocXVlcnkudHJpbSgpKSA6IG51bGw7XG4gICAgY29uc3Qgbm9NYXRjaCA9IHsgc2NvcmU6IDAsIG1hdGNoZXM6IFtdIH07XG4gICAgY29uc3QgcmVzdWx0cyA9IFtdO1xuICAgIGZvciAoY29uc3QgeyBpdGVtLCBzdWJ0eXBzIH0gb2YgdGhpcy5ncm91cHMpIHtcbiAgICAgIGNvbnN0IHR5cE1hdGNoID0gc2VhcmNoID8gc2VhcmNoKHRoaXMuZ2V0SXRlbVRleHQoaXRlbSkpIDogbm9NYXRjaDtcbiAgICAgIGxldCBzdWJ0eXBNYXRjaGVzID0gc3VidHlwcy5tYXAoKHN1YnR5cCkgPT4gKHsgaXRlbTogc3VidHlwLCBtYXRjaDogc2VhcmNoID8gc2VhcmNoKHN1YnR5cC5zdWJ0eXApIDogbm9NYXRjaCB9KSk7XG4gICAgICBpZiAoIXR5cE1hdGNoKSBzdWJ0eXBNYXRjaGVzID0gc3VidHlwTWF0Y2hlcy5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeS5tYXRjaCk7XG4gICAgICBpZiAoIXR5cE1hdGNoICYmIHN1YnR5cE1hdGNoZXMubGVuZ3RoID09PSAwKSBjb250aW51ZTtcblxuICAgICAgY29uc3Qgc2NvcmVzID0gW3R5cE1hdGNoLCAuLi5zdWJ0eXBNYXRjaGVzLm1hcCgoZW50cnkpID0+IGVudHJ5Lm1hdGNoKV0uZmlsdGVyKEJvb2xlYW4pLm1hcCgobWF0Y2gpID0+IG1hdGNoLnNjb3JlKTtcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHNjb3JlOiBNYXRoLm1heCguLi5zY29yZXMpLFxuICAgICAgICByb3dzOiBbeyBpdGVtLCBtYXRjaDogdHlwTWF0Y2ggPz8gbm9NYXRjaCB9LCAuLi5zdWJ0eXBNYXRjaGVzLm1hcCgoZW50cnkpID0+ICh7IGl0ZW06IGVudHJ5Lml0ZW0sIG1hdGNoOiBlbnRyeS5tYXRjaCA/PyBub01hdGNoIH0pKV0sXG4gICAgICB9KTtcbiAgICB9XG4gICAgaWYgKHNlYXJjaCkgcmVzdWx0cy5zb3J0KChhLCBiKSA9PiBiLnNjb3JlIC0gYS5zY29yZSk7XG4gICAgcmV0dXJuIHJlc3VsdHMuZmxhdE1hcCgoZ3JvdXApID0+IGdyb3VwLnJvd3MpO1xuICB9XG5cbiAgcmVuZGVyU3VnZ2VzdGlvbihtYXRjaCwgZWwpIHtcbiAgICBjb25zdCBpdGVtID0gbWF0Y2guaXRlbTtcbiAgICBpZiAoIWl0ZW0uc3VidHlwKSB7XG4gICAgICBzdXBlci5yZW5kZXJTdWdnZXN0aW9uKG1hdGNoLCBlbCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGVsLmFkZENsYXNzKFwidHlwLXBpY2tlci1zdWdnZXN0aW9uXCIsIFwidHlwLXBpY2tlci1zdWJ0eXBcIik7XG4gICAgLy8gTWF0Y2hlZCBhZ2FpbnN0IHRoZSBTdWJ0eXAgbmFtZSBhbG9uZSAoc2VlIGdldFN1Z2dlc3Rpb25zKS5cbiAgICB0aGlzLnJlbmRlckNvbG9yZWROYW1lKGVsLCBpdGVtLnN1YnR5cCwgaXRlbS50eXAsIGl0ZW0uc3VidHlwLCBtYXRjaC5tYXRjaD8ubWF0Y2hlcyA/PyBbXSk7XG4gICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtcGlja2VyLWNvdW50XCIsIHRleHQ6IFN0cmluZyhpdGVtLmNvdW50KSB9KTtcbiAgfVxuXG4gIG9uQ2hvb3NlSXRlbShpdGVtKSB7XG4gICAgdGhpcy5yZXNvbHZlKHsgdHlwOiBpdGVtLnR5cCwgc3VidHlwOiBpdGVtLnN1YnR5cCA/PyBudWxsIH0pO1xuICB9XG59XG5cbi8vIEluaXRpYWwgb3JkZXIgb2YgYSBwaWNrZXIgbGlzdCBnaXZlbiBhbiBhbHJlYWR5IHR5cGVkIHF1ZXJ5IChmcm9tIHRoZVxuLy8gVFlQLVBpY2tlciwgc2VlIHBpY2tUeXBFbnRyeSk6IG1hdGNoZXMgZmlyc3QgYnkgc2NvcmUsIHRoZSByZXN0IGFmdGVyIGluXG4vLyB1bmNoYW5nZWQgb3JkZXIuIElmIG5vdGhpbmcgbWF0Y2hlcyAoYSBkZXNjcmlwdGlvbiB3YXMgdHlwZWQsIHNheSkgdGhlXG4vLyBsaXN0IHN0YXlzIGFzIGl0IHdhcy4gVHlwaW5nIGluIHRoZSBwaWNrZXIgaXRzZWxmIHVzZXMgT2JzaWRpYW4ncyBzZWFyY2guXG5mdW5jdGlvbiBzb3J0QnlRdWVyeShpdGVtcywgcXVlcnksIGl0ZW1UZXh0KSB7XG4gIGNvbnN0IHNlYXJjaCA9IHF1ZXJ5Py50cmltKCkgPyBwcmVwYXJlRnV6enlTZWFyY2gocXVlcnkudHJpbSgpKSA6IG51bGw7XG4gIGlmICghc2VhcmNoKSByZXR1cm4gaXRlbXM7XG4gIGNvbnN0IHNjb3JlZCA9IGl0ZW1zLm1hcCgoaXRlbSwgaW5kZXgpID0+ICh7IGl0ZW0sIGluZGV4LCBzY29yZTogc2VhcmNoKGl0ZW1UZXh0KGl0ZW0pKT8uc2NvcmUgPz8gbnVsbCB9KSk7XG4gIGlmIChzY29yZWQuZXZlcnkoKGVudHJ5KSA9PiBlbnRyeS5zY29yZSA9PT0gbnVsbCkpIHJldHVybiBpdGVtcztcbiAgc2NvcmVkLnNvcnQoKGEsIGIpID0+IHtcbiAgICBpZiAoYS5zY29yZSA9PT0gbnVsbCB8fCBiLnNjb3JlID09PSBudWxsKSByZXR1cm4gYS5zY29yZSA9PT0gYi5zY29yZSA/IGEuaW5kZXggLSBiLmluZGV4IDogYS5zY29yZSA9PT0gbnVsbCA/IDEgOiAtMTtcbiAgICByZXR1cm4gYi5zY29yZSAtIGEuc2NvcmUgfHwgYS5pbmRleCAtIGIuaW5kZXg7XG4gIH0pO1xuICByZXR1cm4gc2NvcmVkLm1hcCgoZW50cnkpID0+IGVudHJ5Lml0ZW0pO1xufVxuXG4vLyBGb3IgVFlQLmpzOiBvcGVucyB0aGUgU3VidHlwLVBpY2tlciBpZiB0aGUgVFlQIGhhcyBhdCBsZWFzdCBvbmUgcmVnaXN0ZXJlZFxuLy8gU3VidHlwIChpbiBibG9jayBvcmRlcikuIHF1ZXJ5IHByZS1zb3J0cyB0aGUgbGlzdDogdHlwaW5nIFwiTGVocnZlcmFuc3RhbHR1bmdcIlxuLy8gdG8gcmVhY2ggT1JHQSBtZWFudCB0aGF0IFN1YnR5cCwgd2hpY2ggdGhlbiBzaXRzIG9uIHRvcCAtIEVudGVyIHN1ZmZpY2VzLlxuLy8gb3B0aW9ucyBhcyBpbiBnZXRTdWJ0eXBzOiBTdWJ0eXBzIHRoYXQgYXJlbid0IG1hbnVhbGx5IGNyZWF0YWJsZSBhcmUgbGVmdFxuLy8gb3V0IGJ5IGRlZmF1bHQsIGxpa2Ugc3VjaCBUWVAgZW50cmllcyBiZWZvcmUuIFJlc29sdmVzIHdpdGhcbi8vICAtIHRoZSBjaG9zZW4gU3VidHlwLFxuLy8gIC0gXCJcIiBmb3IgXCJubyBTdWJ0eXBcIiAodGhlIGZpcnN0IHJvdyB3aXRob3V0IGEgcXVlcnkpIC0gb3IgcmlnaHQgYXdheSxcbi8vICAgIHdpdGhvdXQgYSBwaWNrZXIsIGlmIHRoZSBUWVAgaGFzIG5vIHNlbGVjdGFibGUgU3VidHlwLFxuLy8gIC0gbnVsbCBvbiBFU0MgKFRZUC5qcyBnb2VzIGJhY2sgdG8gdGhlIFRZUCBjaG9pY2UpLlxuZnVuY3Rpb24gcGlja1N1YnR5cChhcHAsIHBsdWdpbiwgdHlwLCBxdWVyeSA9IFwiXCIsIG9wdGlvbnMgPSB7fSkge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICBjb25zdCBpdGVtcyA9IHBsdWdpbi5nZXRTdWJ0eXBzKHR5cCwgb3B0aW9ucykubWFwKCh7IHN1YnR5cCwgY291bnQgfSkgPT4gKHsgdHlwOiBzdWJ0eXAsIGRlc2NyaXB0aW9uOiBcIlwiLCBjb3VudCB9KSk7XG4gICAgaWYgKGl0ZW1zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmVzb2x2ZShcIlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgLy8gXCJubyBTdWJ0eXBcIiBmaXJzdDogRW50ZXIgcGlja3MgaXQgd2l0aG91dCB0eXBpbmcsIGFuZCBpdCBpcyBtb3JlIGNvbW1vblxuICAgIC8vIHRoYW4gYW55IHNpbmdsZSBTdWJ0eXAuXG4gICAgY29uc3Qgbm9uZUNvdW50ID0gcGx1Z2luLnR5cEluZGV4LnN1YnR5cEJ1Y2tldCh0eXApLm5vU3VidHlwO1xuICAgIGl0ZW1zLnVuc2hpZnQoeyB0eXA6IFwibm8gU3VidHlwXCIsIGRlc2NyaXB0aW9uOiBcIlwiLCBjb3VudDogbm9uZUNvdW50LCBub25lOiB0cnVlIH0pO1xuICAgIG5ldyBTdWJ0eXBQaWNrZXJNb2RhbChhcHAsIHBsdWdpbiwgdHlwLCBpdGVtcywgcmVzb2x2ZSwgcXVlcnkpLm9wZW4oKTtcbiAgfSk7XG59XG5cbi8vIFRZUCB2YWx1ZXMgdGhhdCBvY2N1ciBpbiBub3RlcyBidXQgYXJlbid0IGluIHNldHRpbmdzLnR5cHMsIGxpa2UgdGhlXG4vLyB1bnJlZ2lzdGVyZWQgcm93cyBvZiB0aGUgVFlQLUxpc3QuIExpc3RzIGFuZCBwYWRkZWQgdmFsdWVzIChzZWUgaXNDbGVhbktleSlcbi8vIGFyZSBsZWZ0IG91dDogdGhlIGNob3NlbiB2YWx1ZSBpcyB3cml0dGVuIGludG8gYSBuZXcgbm90ZSBhbmQgc2hvdWxkbid0IGJlIGFcbi8vIGNsZWFudXAgY2FzZSB0aGVyZS5cbmZ1bmN0aW9uIHVucmVnaXN0ZXJlZEl0ZW1zKGFwcCwgcGx1Z2luKSB7XG4gIGNvbnN0IHJlZ2lzdGVyZWQgPSBuZXcgU2V0KHBsdWdpbi5zZXR0aW5ncy50eXBzKTtcbiAgY29uc3QgeyBjb3VudHMgfSA9IHBsdWdpbi50eXBJbmRleC50eXBDb3VudHMoKTtcbiAgY29uc3Qgc29ydE9yZGVyID0gcGx1Z2luLnNldHRpbmdzLnR5cFNvcnRPcmRlciA/PyBERUZBVUxUX1NPUlRfT1JERVI7XG4gIHJldHVybiBbLi4uY291bnRzLmtleXMoKV1cbiAgICAuZmlsdGVyKCh0eXApID0+ICFyZWdpc3RlcmVkLmhhcyh0eXApICYmIHBsdWdpbi50eXBJbmRleC5pc0NsZWFuS2V5KHR5cCkpXG4gICAgLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVUeXBzKHNvcnRPcmRlciwgYSwgYiwgY291bnRzLCBwbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzKSlcbiAgICAubWFwKCh0eXApID0+ICh7IHR5cCwgZGVzY3JpcHRpb246IFwiXCIsIGNvdW50OiBjb3VudHMuZ2V0KHR5cCkgPz8gMCwgdW5yZWdpc3RlcmVkOiB0cnVlIH0pKTtcbn1cblxuLy8gUGlja3MgYSBzaW5nbGUgVFlQLCBmb3IgVFlQLmpzIGFuZCBldmVyeXdoZXJlIGluIHRoZSBwbHVnaW4uIGluY2x1ZGVNYW51YWxPZmZcbi8vIGFzIGluIGdldFR5cHMoKTsgaW5jbHVkZVVucmVnaXN0ZXJlZCBhZGRzIHZhbHVlcyB0aGF0IG9jY3VyIGluIG5vdGVzIGJ1dFxuLy8gYXJlbid0IHJlZ2lzdGVyZWQgKG11dGVkKS4gc2hvd1N1YnR5cHMgcHV0cyB0aGUgU3VidHlwIG5hbWVzIGFmdGVyIHRoZSBUWVBcbi8vIG5hbWUsIGZvciB0aGUgc2VwYXJhdGUgZmxvdyB3aGVyZSB0aGUgU3VidHlwLVBpY2tlciBjb21lcyBhZnRlcndhcmRzLlxuLy8gUmVzb2x2ZXMgd2l0aCB0aGUgVFlQLCBvciBudWxsIG9uIGNhbmNlbCBvciBpZiB0aGVyZSBpcyBub3RoaW5nIHRvIHNob3cuXG5mdW5jdGlvbiBwaWNrVHlwKGFwcCwgcGx1Z2luLCBvcHRpb25zID0ge30pIHtcbiAgcmV0dXJuIHBpY2tUeXBFbnRyeShhcHAsIHBsdWdpbiwgb3B0aW9ucykudGhlbigoZW50cnkpID0+IGVudHJ5Py50eXAgPz8gbnVsbCk7XG59XG5cbi8vIExpa2UgcGlja1R5cCwgYnV0IHJlc29sdmVzIHdpdGggeyB0eXAsIHF1ZXJ5IH0sIHF1ZXJ5IGJlaW5nIHdoYXQgd2FzIHR5cGVkLlxuLy8gT25seSBmb3IgcGlja1R5cEFuZFN1YnR5cCwgd2hpY2ggcGFzc2VzIGl0IG9uIHRvIHRoZSBTdWJ0eXAtUGlja2VyLlxuZnVuY3Rpb24gcGlja1R5cEVudHJ5KGFwcCwgcGx1Z2luLCBvcHRpb25zID0ge30pIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgY29uc3QgaXRlbXMgPSB0eXBJdGVtcyhhcHAsIHBsdWdpbiwgb3B0aW9ucyk7XG4gICAgaWYgKCFpdGVtcykge1xuICAgICAgcmVzb2x2ZShudWxsKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgbW9kYWwgPSBuZXcgVHlwUGlja2VyTW9kYWwoYXBwLCBwbHVnaW4sIGl0ZW1zLCAodHlwKSA9PiByZXNvbHZlKHR5cCA9PT0gbnVsbCA/IG51bGwgOiB7IHR5cCwgcXVlcnk6IG1vZGFsLnF1ZXJ5IH0pKTtcbiAgICBtb2RhbC5vcGVuKCk7XG4gIH0pO1xufVxuXG4vLyBTaGFyZWQgVFlQIGxpc3QgZm9yIHBpY2tUeXAvcGlja1R5cEFuZFN1YnR5cDsgbnVsbCBwbHVzIGEgbm90aWNlIGlmIHRoZXJlIGlzXG4vLyBub3RoaW5nIHRvIHNob3cgd2l0aCB0aGVzZSBvcHRpb25zLlxuZnVuY3Rpb24gdHlwSXRlbXMoYXBwLCBwbHVnaW4sIHsgaW5jbHVkZU1hbnVhbE9mZiA9IGZhbHNlLCBpbmNsdWRlVW5yZWdpc3RlcmVkID0gZmFsc2UsIHNob3dTdWJ0eXBzID0gZmFsc2UgfSA9IHt9KSB7XG4gIGNvbnN0IGl0ZW1zID0gcGx1Z2luLmdldFR5cHMoeyBpbmNsdWRlTWFudWFsT2ZmIH0pLm1hcCgoaXRlbSkgPT4gKHsgLi4uaXRlbSwgdW5yZWdpc3RlcmVkOiBmYWxzZSB9KSk7XG4gIGlmIChpbmNsdWRlVW5yZWdpc3RlcmVkKSBpdGVtcy5wdXNoKC4uLnVucmVnaXN0ZXJlZEl0ZW1zKGFwcCwgcGx1Z2luKSk7XG4gIC8vIE9ubHkgcmVnaXN0ZXJlZCBUWVAgZW50cmllcyBoYXZlIFN1YnR5cHM7IHRoZSBvdGhlcnMgc3RheSB1bmNoYW5nZWQuXG4gIGlmIChzaG93U3VidHlwcykge1xuICAgIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcykgaXRlbS5zdWJ0eXBzID0gcGx1Z2luLmdldFN1YnR5cHMoaXRlbS50eXAsIHsgaW5jbHVkZU1hbnVhbE9mZiB9KS5tYXAoKHsgc3VidHlwIH0pID0+IHN1YnR5cCk7XG4gIH1cbiAgaWYgKGl0ZW1zLmxlbmd0aCA+IDApIHJldHVybiBpdGVtcztcbiAgbmV3IE5vdGljZShcIk5vIFRZUCBhdmFpbGFibGUuXCIpO1xuICByZXR1cm4gbnVsbDtcbn1cblxuLy8gRm9yIFRZUC5qczogVFlQIGFuZCBTdWJ0eXAgaW4gb25lIGdvLiBXaXRoIHNlcGFyYXRlU3VidHlwUGlja2VyIG9mZiwgb25lXG4vLyBwaWNrZXIgd2l0aCBlYWNoIFN1YnR5cCBpbmRlbnRlZCBiZWxvdyBpdHMgVFlQOyB3aXRoIGl0IG9uLCBmaXJzdCB0aGVcbi8vIFRZUC1QaWNrZXIgKFN1YnR5cCBuYW1lcyBhZnRlciB0aGUgVFlQIG5hbWUpIGFuZCB0aGVuLCBpZiB0aGVyZSBpcyBhXG4vLyBzZWxlY3RhYmxlIFN1YnR5cCwgdGhlIFN1YnR5cC1QaWNrZXIgcHJlLXNvcnRlZCBieSB0aGUgcXVlcnkgKEVTQyBnb2VzIGJhY2tcbi8vIHRvIHRoZSBUWVAgY2hvaWNlKS4gaW5jbHVkZU1hbnVhbE9mZiBhbHNvIGFwcGxpZXMgdG8gdGhlIFN1YnR5cHMuXG4vLyBSZXNvbHZlcyB3aXRoIHsgdHlwLCBzdWJ0eXAgfSAoc3VidHlwIG51bGwgZm9yIFwibm8gU3VidHlwXCIpLCBvciBudWxsIG9uXG4vLyBjYW5jZWwuXG5hc3luYyBmdW5jdGlvbiBwaWNrVHlwQW5kU3VidHlwKGFwcCwgcGx1Z2luLCBvcHRpb25zID0ge30pIHtcbiAgaWYgKHBsdWdpbi5zZXR0aW5ncy5zZXBhcmF0ZVN1YnR5cFBpY2tlcikge1xuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBjb25zdCBlbnRyeSA9IGF3YWl0IHBpY2tUeXBFbnRyeShhcHAsIHBsdWdpbiwgeyAuLi5vcHRpb25zLCBzaG93U3VidHlwczogdHJ1ZSB9KTtcbiAgICAgIGlmICghZW50cnkpIHJldHVybiBudWxsO1xuICAgICAgY29uc3Qgc3VidHlwID0gYXdhaXQgcGlja1N1YnR5cChhcHAsIHBsdWdpbiwgZW50cnkudHlwLCBlbnRyeS5xdWVyeSwgb3B0aW9ucyk7XG4gICAgICBpZiAoc3VidHlwICE9PSBudWxsKSByZXR1cm4geyB0eXA6IGVudHJ5LnR5cCwgc3VidHlwOiBzdWJ0eXAgfHwgbnVsbCB9O1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGl0ZW1zID0gdHlwSXRlbXMoYXBwLCBwbHVnaW4sIG9wdGlvbnMpO1xuICBpZiAoIWl0ZW1zKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgZ3JvdXBzID0gaXRlbXMubWFwKChpdGVtKSA9PiAoe1xuICAgIGl0ZW0sXG4gICAgc3VidHlwczogcGx1Z2luLmdldFN1YnR5cHMoaXRlbS50eXAsIG9wdGlvbnMpLm1hcCgoeyBzdWJ0eXAsIGNvdW50IH0pID0+ICh7IHR5cDogaXRlbS50eXAsIHN1YnR5cCwgY291bnQgfSkpLFxuICB9KSk7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gbmV3IFR5cFN1YnR5cFBpY2tlck1vZGFsKGFwcCwgcGx1Z2luLCBncm91cHMsIHJlc29sdmUpLm9wZW4oKSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBwaWNrVHlwLCBwaWNrU3VidHlwLCBwaWNrVHlwQW5kU3VidHlwIH07XG4iLCAiY29uc3QgeyBURmlsZSwgVmF1bHQsIGRlYm91bmNlLCBub3JtYWxpemVQYXRoIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5cbi8vIE9ubHkgVGVtcGxhdGVyIHNjcmlwdHMgd2l0aCB0aGlzIG1hcmtlciBpbiBhIGNvbW1lbnQgYXJlIG9mZmVyZWQgaW4gdGhlXG4vLyBzaG9ydGN1dCBwaWNrZXI7IGhlbHBlciBzY3JpcHRzIG1ha2Ugbm8gc2Vuc2UgYXMgc2hvcnRjdXRzLiBUaGUgdGV4dCBhZnRlclxuLy8gdGhlIG1hcmtlciB1cCB0byB0aGUgbGluZSBlbmQgaXMgdGhlIGRlc2NyaXB0aW9uIChhIGNsb3NpbmcgXCIqL1wiIGlzIG5vdFxuLy8gcGFydCBvZiBpdCkuXG4vL1xuLy8gQW4gb3B0aW9uYWwgcGFyYW1ldGVyIGxpc3QgaW4gcGFyZW50aGVzZXMgcmlnaHQgYWZ0ZXIgdGhlIG1hcmtlciBkZXNjcmliZXNcbi8vIHRoZSBDT01QTEVURSBhcmd1bWVudCBsaXN0IGFmdGVyIFwidHBcIiwgaW5jbHVkaW5nIHdoZXJlIHRoZSBzY3JpcHQgd2FudHMgdGhlXG4vLyBmaWxlIG9yIGNvbnRleHQgKHNlZSBSRVNFUlZFRF9QQVJBTVMgaW4gc2hvcnRjdXRzLmpzKTpcbi8vICAgLy8gQHR5cC1zaG9ydGN1dChmb2xkZXIsIHllYXIpICAgICAgLT4gZih0cCwgXCJMaXRlcmF0dXJcIiwgMjAyNClcbi8vICAgLy8gQHR5cC1zaG9ydGN1dChuZXdGaWxlLCB5ZWFyKSAgICAgLT4gZih0cCwgbmV3RmlsZSwgMjAyNClcbi8vICAgLy8gQHR5cC1zaG9ydGN1dChwcm9wZXJ0eSkgICAgICAgICAgLT4gZih0cCwgXCJGYW1pbGllXCIpXG4vLyAgIC8vIEB0eXAtc2hvcnRjdXQgICAgICAgICAgICAgICAgICAgIC0+IGYodHAsIG5ld0ZpbGUsIGN0eClcbi8vIE5vIHBhcmVudGhlc2VzIChwYXJhbXMgPT09IG51bGwpIGlzIHRoZSBjbGFzc2ljIGNhbGwgZih0cCwgbmV3RmlsZSwgY3R4KTtcbi8vIGVtcHR5IHBhcmVudGhlc2VzIChwYXJhbXMgPT09IFtdKSBwYXNzIG9ubHkgdHAuXG4vL1xuLy8gVGhlIG1hcmtlciBtdXN0IHN0YXJ0IHRoZSBjb21tZW50LiBBbGxvd2luZyB0ZXh0IGJlZm9yZSBpdCBvbmNlIHR1cm5lZFxuLy8gVFlQLmpzIGludG8gYSBzaG9ydGN1dCwganVzdCBiZWNhdXNlIGl0cyBoZWFkZXIgY29tbWVudCBtZW50aW9ucyB0aGUgbWFya2VyLlxuLy8gXCJcXGJcIiBhZnRlciB0aGUgbmFtZSByZWplY3RzIFwiQHR5cC1zaG9ydGN1dFhZWlwiIGJ1dCBhbGxvd3MgdGhlIFwiKFwiLlxuY29uc3QgU0hPUlRDVVRfTUFSS0VSID0gL15bIFxcdF0qKD86XFwvXFwvK3xcXC9cXCorfFxcKilbIFxcdF0qQHR5cC1zaG9ydGN1dFxcYig/OlxcKChbXildKilcXCkpP1sgXFx0XSooLio/KVsgXFx0XSooPzpcXCpcXC8pP1sgXFx0XSokL207XG5cbi8vIFBhcmFtZXRlciBuYW1lcyBmcm9tIHRoZSBtYXJrZXIsIGluIGRlY2xhcmVkIG9yZGVyLiBFbXB0eSBlbnRyaWVzIChcIigpXCIsIGFcbi8vIHN0cmF5IGNvbW1hKSBhcmUgZHJvcHBlZCwgZHVwbGljYXRlcyBrZXB0IG9uY2UgLSB0d28gZmllbGRzIHdyaXRpbmcgdGhlIHNhbWVcbi8vIGVudHJ5IHdvdWxkIG9ubHkgY29uZnVzZS5cbmZ1bmN0aW9uIHBhcnNlUGFyYW1zKHJhdykge1xuICBjb25zdCBuYW1lcyA9IChyYXcgPz8gXCJcIilcbiAgICAuc3BsaXQoXCIsXCIpXG4gICAgLm1hcCgobmFtZSkgPT4gbmFtZS50cmltKCkpXG4gICAgLmZpbHRlcigobmFtZSkgPT4gbmFtZSAhPT0gXCJcIik7XG4gIHJldHVybiBbLi4ubmV3IFNldChuYW1lcyldO1xufVxuXG4vLyBLZWVwcyB0aGUgbGlzdCBvZiBtYXJrZWQgVGVtcGxhdGVyIHNjcmlwdHMgY3VycmVudC4gSXQgaXMgcmVhZCBhaGVhZCBvZiB0aW1lXG4vLyBhbmQgdXBkYXRlZCBvbiBjaGFuZ2VzLCBzbyB0aGUgcGlja2VyIG9wZW5zIHdpdGhvdXQgd2FpdGluZyBhbmQgd2l0aG91dCBmaWxlXG4vLyBhY2Nlc3MuIFJldHVybnMgYW4gYWNjZXNzb3IgZm9yIHRoZSBsaXN0IChbeyBuYW1lLCBwYXJhbXMsIGRlc2NyaXB0aW9uIH1dLFxuLy8gc29ydGVkIGJ5IG5hbWUpLCB3aXRoIHR3byBhZGRpdGlvbnMgZm9yIHRoZSBcInNjcmlwdCBub3QgZm91bmRcIiB3YXJuaW5nIG9mXG4vLyB0aGUgcHJvcGVydHkgcm93cyAoc2VlIHJlbmRlclNob3J0Y3V0Q29udHJvbHMgaW4gdHlwLWZyb250bWF0dGVyLWVkaXRvci5qcyk6XG4vLyAgIGFjY2Vzc29yLmlzTG9hZGVkKCkgICBmYWxzZSB1bnRpbCB0aGUgZm9sZGVyIHdhcyByZWFkIG9uY2UgLSBiZWZvcmUgdGhhdFxuLy8gICAgICAgICAgICAgICAgICAgICAgICAgYW4gZW1wdHkgbGlzdCBtZWFucyBcIm5vdCBrbm93biB5ZXRcIiwgbm90IFwibWlzc2luZ1wiLFxuLy8gICAgICAgICAgICAgICAgICAgICAgICAgYW5kIG5vIHJvdyBtYXkgd2FyblxuLy8gICBhY2Nlc3Nvci5vbkNoYW5nZShmbikgZm4gcnVucyBhZnRlciB0aGUgZmlyc3QgcmVhZCBhbmQgd2hlbmV2ZXIgdGhlIGxpc3Rcbi8vICAgICAgICAgICAgICAgICAgICAgICAgIGNoYW5nZWQ7IHJldHVybnMgYSBmdW5jdGlvbiB0aGF0IHVuc3Vic2NyaWJlc1xuZnVuY3Rpb24gcmVnaXN0ZXJTaG9ydGN1dFNjcmlwdHMocGx1Z2luKSB7XG4gIGNvbnN0IHsgYXBwIH0gPSBwbHVnaW47XG5cbiAgbGV0IHNjcmlwdEZvbGRlciA9IG51bGw7XG4gIGxldCBzY3JpcHRzID0gW107XG4gIGxldCBsb2FkZWQgPSBmYWxzZTtcbiAgY29uc3QgbGlzdGVuZXJzID0gbmV3IFNldCgpO1xuXG4gIGNvbnN0IGN1cnJlbnRTY3JpcHRGb2xkZXIgPSAoKSA9PiB7XG4gICAgY29uc3QgZm9sZGVyID0gYXBwLnBsdWdpbnMucGx1Z2luc1tcInRlbXBsYXRlci1vYnNpZGlhblwiXT8uc2V0dGluZ3M/LnVzZXJfc2NyaXB0c19mb2xkZXI7XG4gICAgcmV0dXJuIGZvbGRlciA/IG5vcm1hbGl6ZVBhdGgoZm9sZGVyKSA6IG51bGw7XG4gIH07XG5cbiAgY29uc3QgaXNJblNjcmlwdEZvbGRlciA9IChwYXRoKSA9PiAhIXNjcmlwdEZvbGRlciAmJiAhIXBhdGggJiYgcGF0aC5zdGFydHNXaXRoKHNjcmlwdEZvbGRlciArIFwiL1wiKTtcblxuICAvLyBMaWtlIFRlbXBsYXRlcjogZXZlcnkgLmpzIGluIHRoZSBzY3JpcHQgZm9sZGVyIGluY2x1ZGluZyBzdWJmb2xkZXJzLFxuICAvLyBzY3JpcHQgbmFtZSA9IGZpbGUgbmFtZSB3aXRob3V0IGV4dGVuc2lvbi5cbiAgYXN5bmMgZnVuY3Rpb24gcmVmcmVzaFNjcmlwdHMoKSB7XG4gICAgY29uc3QgZm9sZGVyUGF0aCA9IGN1cnJlbnRTY3JpcHRGb2xkZXIoKTtcbiAgICBzY3JpcHRGb2xkZXIgPSBmb2xkZXJQYXRoO1xuICAgIGNvbnN0IGZvbGRlciA9IGZvbGRlclBhdGggPyBhcHAudmF1bHQuZ2V0Rm9sZGVyQnlQYXRoKGZvbGRlclBhdGgpIDogbnVsbDtcbiAgICBjb25zdCBmaWxlcyA9IFtdO1xuICAgIGlmIChmb2xkZXIpIHtcbiAgICAgIFZhdWx0LnJlY3Vyc2VDaGlsZHJlbihmb2xkZXIsIChjaGlsZCkgPT4ge1xuICAgICAgICBpZiAoY2hpbGQgaW5zdGFuY2VvZiBURmlsZSAmJiBjaGlsZC5leHRlbnNpb24gPT09IFwianNcIikgZmlsZXMucHVzaChjaGlsZCk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgY29uc3QgZm91bmQgPSBbXTtcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG1hdGNoID0gKGF3YWl0IGFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpKS5tYXRjaChTSE9SVENVVF9NQVJLRVIpO1xuICAgICAgICAvLyBtYXRjaFsxXSBpcyB1bmRlZmluZWQgd2l0aG91dCBwYXJlbnRoZXNlcyBhbmQgXCJcIiB3aXRoIGVtcHR5IG9uZXM7XG4gICAgICAgIC8vIHRoYXQgZGlmZmVyZW5jZSBkZWNpZGVzIHRoZSBjYWxsIGZvcm0uXG4gICAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICAgIGZvdW5kLnB1c2goe1xuICAgICAgICAgICAgbmFtZTogZmlsZS5iYXNlbmFtZSxcbiAgICAgICAgICAgIHBhcmFtczogbWF0Y2hbMV0gPT09IHVuZGVmaW5lZCA/IG51bGwgOiBwYXJzZVBhcmFtcyhtYXRjaFsxXSksXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogbWF0Y2hbMl0gPz8gXCJcIixcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLmVycm9yKGBUWVAtU3lzdGVtOiBjYW4ndCByZWFkIFRlbXBsYXRlciBzY3JpcHQgJHtmaWxlLnBhdGh9YCwgZSk7XG4gICAgICB9XG4gICAgfVxuICAgIC8vIEZvbGRlciBjaGFuZ2VkIGluIFRlbXBsYXRlciBtZWFud2hpbGU6IGRyb3AgdGhpcyByZXN1bHQsIHRoZSBydW4gZm9yIHRoZVxuICAgIC8vIG5ldyBmb2xkZXIgaXMgYWxyZWFkeSBzY2hlZHVsZWQuXG4gICAgaWYgKGZvbGRlclBhdGggIT09IHNjcmlwdEZvbGRlcikgcmV0dXJuO1xuICAgIGZvdW5kLnNvcnQoKGEsIGIpID0+IGEubmFtZS5sb2NhbGVDb21wYXJlKGIubmFtZSkpO1xuICAgIC8vIEVkaXRpbmcgYSBzY3JpcHQgdHJpZ2dlcnMgYSByZXNjYW4gdG9vOyBvbmx5IGEgcmVhbCBjaGFuZ2UgKGEgc2NyaXB0XG4gICAgLy8gYWRkZWQsIHJlbW92ZWQsIHJlbmFtZWQgb3IgaXRzIG1hcmtlciBjaGFuZ2VkKSBpcyBwYXNzZWQgb24uXG4gICAgY29uc3QgY2hhbmdlZCA9ICFsb2FkZWQgfHwgSlNPTi5zdHJpbmdpZnkoZm91bmQpICE9PSBKU09OLnN0cmluZ2lmeShzY3JpcHRzKTtcbiAgICBzY3JpcHRzID0gZm91bmQ7XG4gICAgbG9hZGVkID0gdHJ1ZTtcbiAgICBpZiAoIWNoYW5nZWQpIHJldHVybjtcbiAgICBmb3IgKGNvbnN0IGxpc3RlbmVyIG9mIGxpc3RlbmVycykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgbGlzdGVuZXIoKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoXCJUWVAtU3lzdGVtOiBzaG9ydGN1dCBzY3JpcHQgbGlzdGVuZXIgZmFpbGVkXCIsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBjb25zdCBzY2hlZHVsZVJlZnJlc2ggPSBkZWJvdW5jZShyZWZyZXNoU2NyaXB0cywgMzAwLCB0cnVlKTtcbiAgY29uc3Qgb25GaWxlQ2hhbmdlID0gKGZpbGUsIG9sZFBhdGgpID0+IHtcbiAgICBpZiAoaXNJblNjcmlwdEZvbGRlcihmaWxlPy5wYXRoKSB8fCBpc0luU2NyaXB0Rm9sZGVyKG9sZFBhdGgpKSBzY2hlZHVsZVJlZnJlc2goKTtcbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoYXBwLnZhdWx0Lm9uKFwiY3JlYXRlXCIsIG9uRmlsZUNoYW5nZSkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJtb2RpZnlcIiwgb25GaWxlQ2hhbmdlKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC52YXVsdC5vbihcImRlbGV0ZVwiLCBvbkZpbGVDaGFuZ2UpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoYXBwLnZhdWx0Lm9uKFwicmVuYW1lXCIsIG9uRmlsZUNoYW5nZSkpO1xuICBhcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkocmVmcmVzaFNjcmlwdHMpO1xuXG4gIGNvbnN0IGFjY2Vzc29yID0gKCkgPT4ge1xuICAgIC8vIFRlbXBsYXRlciBmb2xkZXIgY2hhbmdlZDogcmVsb2FkIGZvciB0aGUgbmV4dCBjYWxsLCBhbnN3ZXIgd2l0aCB0aGVcbiAgICAvLyBjdXJyZW50IGxpc3QgZm9yIG5vdy5cbiAgICBpZiAoY3VycmVudFNjcmlwdEZvbGRlcigpICE9PSBzY3JpcHRGb2xkZXIpIHNjaGVkdWxlUmVmcmVzaCgpO1xuICAgIHJldHVybiBzY3JpcHRzO1xuICB9O1xuICBhY2Nlc3Nvci5pc0xvYWRlZCA9ICgpID0+IGxvYWRlZDtcbiAgYWNjZXNzb3Iub25DaGFuZ2UgPSAobGlzdGVuZXIpID0+IHtcbiAgICBsaXN0ZW5lcnMuYWRkKGxpc3RlbmVyKTtcbiAgICByZXR1cm4gKCkgPT4gbGlzdGVuZXJzLmRlbGV0ZShsaXN0ZW5lcik7XG4gIH07XG4gIHJldHVybiBhY2Nlc3Nvcjtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyU2hvcnRjdXRTY3JpcHRzLCBTSE9SVENVVF9NQVJLRVIsIHBhcnNlUGFyYW1zIH07XG4iLCAiY29uc3QgeyBQbHVnaW4gfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgREVGQVVMVF9TRVRUSU5HUywgVHlwU3lzdGVtU2V0dGluZ1RhYiB9ID0gcmVxdWlyZShcIi4vc2V0dGluZ3NcIik7XG5jb25zdCB7IHJlZ2lzdGVyQ29tbWFuZHMgfSA9IHJlcXVpcmUoXCIuL2NvbW1hbmRzXCIpO1xuY29uc3QgeyByZWdpc3RlclR5cFBhbmUsIHNvcnRUeXBzQnlNb2RlLCBERUZBVUxUX1NPUlRfT1JERVIgfSA9IHJlcXVpcmUoXCIuL3R5cC1wYW5lXCIpO1xuY29uc3QgeyBUeXBJbmRleCwgc2V0Q2Fub25pY2FsUHJvcGVydHksIGRlbGV0ZVByb3BlcnR5LCBUWVBfUFJPUEVSVFksIFNVQlRZUF9QUk9QRVJUWSB9ID0gcmVxdWlyZShcIi4vdHlwLWluZGV4XCIpO1xuY29uc3QgeyBnZXRTdWJ0eXAsIGdldFN1YnR5cE5hbWVzLCBpc1N1YnR5cE1hbnVhbCB9ID0gcmVxdWlyZShcIi4vc3VidHlwc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJGaWxlRXhwbG9yZXJDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL2ZpbGUtZXhwbG9yZXItY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlckdyYXBoQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9ncmFwaC1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyU2VhcmNoQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9zZWFyY2gtY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlclJlY2VudEZpbGVzQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9yZWNlbnQtZmlsZXMtY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlckJhY2tsaW5rQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9iYWNrbGluay1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyQm9va21hcmtzQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9ib29rbWFyay1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL2FjdGl2ZS10aXRsZS1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyTGlua0NvbG9ycyB9ID0gcmVxdWlyZShcIi4vbGluay1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyRnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0IH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1kZWZhdWx0LWhpZ2hsaWdodFwiKTtcbmNvbnN0IHsgcmVnaXN0ZXJQcm9wZXJ0eVJlbmFtZVN5bmMgfSA9IHJlcXVpcmUoXCIuL3Byb3BlcnR5LXJlbmFtZS1zeW5jXCIpO1xuY29uc3QgeyByZW1vdmVQcm9wZXJ0eU1lbnVQYXRjaCB9ID0gcmVxdWlyZShcIi4vdHlwLWZyb250bWF0dGVyLWVkaXRvclwiKTtcbmNvbnN0IHsgbm9ybWFsaXplR2xvYmFsT3JkZXIsIHNvcnRGcm9udG1hdHRlckZvciwgcGxhY2VQcm9wZXJ0eUZvciB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItc29ydFwiKTtcbmNvbnN0IHsgcmVzb2x2ZVNob3J0Y3V0cywgc2NyaXB0TmFtZU9mLCByZXNvbHZlQ2FsbEFyZ3MgfSA9IHJlcXVpcmUoXCIuL3Nob3J0Y3V0c1wiKTtcbmNvbnN0IHtcbiAgcGlja1R5cDogcGlja1R5cE1vZGFsLFxuICBwaWNrU3VidHlwOiBwaWNrU3VidHlwTW9kYWwsXG4gIHBpY2tUeXBBbmRTdWJ0eXA6IHBpY2tUeXBBbmRTdWJ0eXBNb2RhbCxcbn0gPSByZXF1aXJlKFwiLi90eXAtcGlja2VyXCIpO1xuY29uc3QgeyByZWdpc3RlclNob3J0Y3V0U2NyaXB0cyB9ID0gcmVxdWlyZShcIi4vc2hvcnRjdXQtc2NyaXB0c1wiKTtcbmNvbnN0IHsgY2xlYXJJbmxpbmVDb2xvcnMsIGFsbERvY3VtZW50cyB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxubW9kdWxlLmV4cG9ydHMgPSBjbGFzcyBUeXBTeXN0ZW1QbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBhc3luYyBvbmxvYWQoKSB7XG4gICAgLy8gUmVhZCBvbmNlIGhlcmU6IG5vIGRhdGEuanNvbiAobG9hZERhdGEoKSByZXNvbHZlcyBudWxsKSBtZWFucyB0aGUgcGx1Z2luXG4gICAgLy8gaXMgbG9hZGVkIGZvciB0aGUgdmVyeSBmaXJzdCB0aW1lIGluIHRoaXMgdmF1bHQsIGFuZCB0aGUgVFlQLVBhbmUgb3BlbnNcbiAgICAvLyBvbiBpdHMgb3duIG9uY2UgKHNlZSByZWdpc3RlclR5cFBhbmUpLlxuICAgIGNvbnN0IGRhdGEgPSBhd2FpdCB0aGlzLmxvYWREYXRhKCk7XG4gICAgdGhpcy5pc0ZpcnN0UnVuID0gZGF0YSA9PSBudWxsO1xuICAgIGF3YWl0IHRoaXMubG9hZFNldHRpbmdzKGRhdGEpO1xuXG4gICAgLy8gRGlzYWJsaW5nIHRoZSBwbHVnaW4gdGFrZXMgaXRzIGlubGluZSBjb2xvcnMgb3V0IG9mIHRoZSBleHBsb3JlcixcbiAgICAvLyBzZWFyY2gsIFJlY2VudCBGaWxlcywgYmFja2xpbmtzLCBib29rbWFya3MsIG5vdGUgdGl0bGVzIGFuZCBcIkFsbFxuICAgIC8vIHByb3BlcnRpZXNcIiAoc2VlIHNldElubGluZUNvbG9yIGluIHR5cC1jb2xvcnMuanMpOyB0aG9zZSB2aWV3cyB3b3VsZFxuICAgIC8vIGtlZXAgdGhlbSB1bnRpbCB0aGV5IGhhcHBlbiB0byByZS1yZW5kZXIuIFJlZ2lzdGVyZWQgZmlyc3Qgc28gaXQgcnVuc1xuICAgIC8vIGxhc3Qgb24gdW5sb2FkLCBhZnRlciB0aGUgbW9kdWxlcyBoYXZlIHN0b3BwZWQgb2JzZXJ2aW5nIGFuZCBsaXN0ZW5pbmcuXG4gICAgdGhpcy5yZWdpc3RlcigoKSA9PiB7XG4gICAgICBmb3IgKGNvbnN0IGRvYyBvZiBhbGxEb2N1bWVudHModGhpcy5hcHApKSBjbGVhcklubGluZUNvbG9ycyhkb2MpO1xuICAgIH0pO1xuXG4gICAgLy8gQmVmb3JlIGFsbCBvdGhlciBtb2R1bGVzOiB0aGV5IGxpc3RlbiB0byBpdHMgXCJjaGFuZ2VcIiBldmVudCBhbmQgcmVhZFxuICAgIC8vIFRZUC9TVUJUWVAgb25seSB0aHJvdWdoIGl0IChzZWUgdHlwLWluZGV4LmpzKS5cbiAgICB0aGlzLnR5cEluZGV4ID0gbmV3IFR5cEluZGV4KHRoaXMpO1xuICAgIHRoaXMudHlwSW5kZXgucmVnaXN0ZXIoKTtcblxuICAgIHJlZ2lzdGVyQ29tbWFuZHModGhpcyk7XG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBUeXBTeXN0ZW1TZXR0aW5nVGFiKHRoaXMuYXBwLCB0aGlzKSk7XG4gICAgLy8gQ2FycmllcyByZW5hbWVzIGZyb20gXCJBbGwgcHJvcGVydGllc1wiL0Jhc2VzIGludG8gdGhlIFRZUC1Gcm9udG1hdHRlci5cbiAgICByZWdpc3RlclByb3BlcnR5UmVuYW1lU3luYyh0aGlzKTtcbiAgICAvLyBUaGUgVFlQLVBhbmUgcGF0Y2hlcyB0aGUgcHJvcGVydHkgbWVudSBsYXppbHkgKGVuc3VyZVByb3BlcnR5TWVudVBhdGNoKS5cbiAgICB0aGlzLnJlZ2lzdGVyKHJlbW92ZVByb3BlcnR5TWVudVBhdGNoKTtcbiAgICAvLyBBY2Nlc3NvciBmb3IgdGhlIFRlbXBsYXRlciBzY3JpcHRzIG1hcmtlZCBcIkB0eXAtc2hvcnRjdXRcIiwgdXNlZCBieSB0aGVcbiAgICAvLyBzaG9ydGN1dCBwaWNrZXIgb2YgdGhlIHByb3BlcnR5IHJvd3MuXG4gICAgdGhpcy5nZXRTaG9ydGN1dFNjcmlwdHMgPSByZWdpc3RlclNob3J0Y3V0U2NyaXB0cyh0aGlzKTtcblxuICAgIC8vIEtlcHQgc2VwYXJhdGUgZnJvbSByZWZyZXNoRm5zOiBhZnRlciBtb3VudGluZyBpdHMgZWRpdG9ycyB0aGUgVFlQLVBhbmVcbiAgICAvLyBuZWVkcyBvbmx5IHRoaXMgcmVmcmVzaCAoYm9sZCBwcm9wZXJ0eSBuYW1lcykuIFRoZSB3aG9sZVxuICAgIC8vIHJlZnJlc2hUeXBDb2xvcnMoKSBidW5kbGUgd291bGQgYWxzbyB0cmlnZ2VyIHRoZSB2aWV3J3Mgb3duIHJlLXJlbmRlciBhbmRcbiAgICAvLyByZWN1cnNlIGludG8gYSBzdGFjayBvdmVyZmxvdyBvbiBldmVyeSBUWVAgb3BlbmVkLlxuICAgIHRoaXMucmVmcmVzaEZyb250bWF0dGVySGlnaGxpZ2h0ID0gcmVnaXN0ZXJGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQodGhpcyk7XG5cbiAgICAvLyBUd28gdmFyaWFudHMsIGxpa2UgcmVmcmVzaEZyb250bWF0dGVySGlnaGxpZ2h0IGFib3ZlOlxuICAgIC8vICAtIHJlZnJlc2hUeXBDb2xvcnMoKSByZWZyZXNoZXMgZXZlcnkgdmlldywgdGhlIFRZUC1QYW5lIGluY2x1ZGVkXG4gICAgLy8gICAgKHJlLXJlbmRlcmVkIGZyb20gdGhlIHNldHRpbmdzKSAtIGZvciBjaGFuZ2VzIG1hZGUgZWxzZXdoZXJlIChzZXR0aW5nc1xuICAgIC8vICAgIHRhYiwgcHJvcGVydHkgcmVuYW1lIHN5bmMsIFN5bmMsIFVuZG8pLlxuICAgIC8vICAtIHJlZnJlc2hUeXBDb2xvcnNFeGNlcHQodmlldykgbGVhdmVzIHRoYXQgb25lIFRZUC1QYW5lIG91dCAtIGZvciBpdHNcbiAgICAvLyAgICBvd24gYWN0aW9ucy4gQSBmdWxsIHJlLXJlbmRlciB0aGVyZSB3b3VsZCB0aHJvdyBhd2F5IGZvY3VzLCBhbiBvcGVuXG4gICAgLy8gICAgaW5saW5lIGlucHV0IG9yIHRoZSBlZGl0b3IgYmVpbmcgdHlwZWQgaW4sIHNvIHRoZSBwYW5lIHVwZGF0ZXMgaXRzZWxmXG4gICAgLy8gICAgYW5kIGNhbGxzIHJlbmRlcigpIG9ubHkgd2hlcmUgaXQgcmVhbGx5IGhhcyB0byByZWJ1aWxkLiBPdGhlclxuICAgIC8vICAgIFRZUC1QYW5lIGxlYXZlcyAocmFyZSAtIHNlZSBhY3RpdmF0ZVR5cFBhbmUpIGFyZSBzdGlsbCByZS1yZW5kZXJlZC5cbiAgICBjb25zdCByZWZyZXNoVHlwUGFuZSA9IHJlZ2lzdGVyVHlwUGFuZSh0aGlzKTtcbiAgICBjb25zdCByZWZyZXNoRm5zID0gW1xuICAgICAgcmVnaXN0ZXJGaWxlRXhwbG9yZXJDb2xvcnModGhpcyksXG4gICAgICByZWdpc3RlckdyYXBoQ29sb3JzKHRoaXMpLFxuICAgICAgcmVnaXN0ZXJTZWFyY2hDb2xvcnModGhpcyksXG4gICAgICByZWdpc3RlclJlY2VudEZpbGVzQ29sb3JzKHRoaXMpLFxuICAgICAgcmVnaXN0ZXJCYWNrbGlua0NvbG9ycyh0aGlzKSxcbiAgICAgIHJlZ2lzdGVyQm9va21hcmtzQ29sb3JzKHRoaXMpLFxuICAgICAgcmVnaXN0ZXJBY3RpdmVUaXRsZUNvbG9ycyh0aGlzKSxcbiAgICAgIHJlZ2lzdGVyTGlua0NvbG9ycyh0aGlzKSxcbiAgICAgIHRoaXMucmVmcmVzaEZyb250bWF0dGVySGlnaGxpZ2h0LFxuICAgIF07XG4gICAgdGhpcy5yZWZyZXNoVHlwQ29sb3JzRXhjZXB0ID0gKGV4Y2VwdFZpZXcpID0+IHtcbiAgICAgIHJlZnJlc2hUeXBQYW5lKGV4Y2VwdFZpZXcpO1xuICAgICAgcmVmcmVzaEZucy5mb3JFYWNoKChmbikgPT4gZm4oKSk7XG4gICAgfTtcbiAgICB0aGlzLnJlZnJlc2hUeXBDb2xvcnMgPSAoKSA9PiB0aGlzLnJlZnJlc2hUeXBDb2xvcnNFeGNlcHQobnVsbCk7XG5cbiAgICAvLyBTdHlsZSBTZXR0aW5ncyByZWFkcyBzdHlsZXNoZWV0cyB3aGVuIGl0IGxvYWRzIGFuZCBhZnRlcndhcmRzIG9ubHkgb25cbiAgICAvLyBcImNzcy1jaGFuZ2VcIiwgd2hpY2ggZmlyZXMgZm9yIHRoZW1lcyBhbmQgc25pcHBldHMgYnV0IG5vdCBmb3IgYSBwbHVnaW4nc1xuICAgIC8vIHN0eWxlcy5jc3MuIEEgcGx1Z2luIGxvYWRlZCBsYXRlciAob3IgaG90LXJlbG9hZGVkKSB3b3VsZCBiZSBtaXNzaW5nXG4gICAgLy8gdGhlcmU7IFwicGFyc2Utc3R5bGUtc2V0dGluZ3NcIiBpcyB0aGUgaW50ZW5kZWQgaG9vay4gV2l0aG91dCBTdHlsZVxuICAgIC8vIFNldHRpbmdzIG5vYm9keSBsaXN0ZW5zIGFuZCBub3RoaW5nIGhhcHBlbnMuXG4gICAgLy9cbiAgICAvLyBOZXh0IHRpY2ssIGJlY2F1c2UgT2JzaWRpYW4gYWRkcyBhIHBsdWdpbidzIHN0eWxlcy5jc3Mgb25seSBBRlRFUlxuICAgIC8vIG9ubG9hZCgpLiBvbkxheW91dFJlYWR5IGRvZXNuJ3QgaGVscDogb24gaG90IHJlbG9hZCB0aGUgbGF5b3V0IGlzIGxvbmdcbiAgICAvLyByZWFkeSBhbmQgdGhlIGNhbGxiYWNrIHdvdWxkIHJ1biBhdCBvbmNlLCBqdXN0IGFzIGVhcmx5LlxuICAgIGNvbnN0IHBhcnNlU3R5bGVTZXR0aW5ncyA9IHdpbmRvdy5zZXRUaW1lb3V0KCgpID0+IHRoaXMuYXBwLndvcmtzcGFjZS50cmlnZ2VyKFwicGFyc2Utc3R5bGUtc2V0dGluZ3NcIiksIDApO1xuICAgIHRoaXMucmVnaXN0ZXIoKCkgPT4gd2luZG93LmNsZWFyVGltZW91dChwYXJzZVN0eWxlU2V0dGluZ3MpKTtcbiAgfVxuXG4gIG9udW5sb2FkKCkge31cblxuICAvLyBGb3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qczogdGhlIFRZUC1Gcm9udG1hdHRlciBvZiBhIFRZUCwgc29cbiAgLy8gVGVtcGxhdGVyIGNhbiBhcHBseSBpdCB0byBhIG5ldyBub3RlIGluc3RlYWQgb2Yga2VlcGluZyBhIHNlY29uZCBjb3B5LiBBXG4gIC8vIGNvcHksIHNvIGNhbGxlcnMgbWF5IGNoYW5nZSBpdCBmcmVlbHkuXG4gIC8vXG4gIC8vIFByb3BlcnRpZXMgd2l0aCBhIGZpeGVkIHNob3J0Y3V0ICh0b2RheS9ub3cvY3JlYXRlZCwgc2VlIHNob3J0Y3V0cy5qcylcbiAgLy8gY2FycnkgaXRzIHZhbHVlLCBjb21wdXRlZCBmcmVzaCBvbiBlYWNoIGNhbGwuIFByb3BlcnRpZXMgd2l0aCBhIHNjcmlwdFxuICAvLyBzaG9ydGN1dCBjYXJyeSBudWxsOiBvbmx5IFRlbXBsYXRlciBjYW4gcmVzb2x2ZSB0aGVtLCBUWVAuanMgZ2V0cyB0aGVtIHZpYVxuICAvLyBnZXRUeXBTaG9ydGN1dHMoKSBhbmQgZmlsbHMgdGhlbSBpbi4gS2V5IGFuZCBwb3NpdGlvbiBzdGF5IGVpdGhlciB3YXkuXG4gIC8vXG4gIC8vIGluY2x1ZGVGbG9hdGluZyAoZGVmYXVsdCBmYWxzZSkga2VlcHMgZmxvYXRpbmcga2V5cyBpbiB0aGUgcmVzdWx0OyB0aGV5XG4gIC8vIGFyZSBub3QgY3JlYXRlZCBmb3IgZXZlcnkgbmV3IG5vdGUsIG9ubHkgd2hlbiBhIHNjcmlwdCBhc2tzIGZvciB0aGVtLlxuICAvL1xuICAvLyBmaWxlIChvcHRpb25hbCkgZ29lcyB0byByZXNvbHZlU2hvcnRjdXRzKCkgZm9yIFwiY3JlYXRlZFwiLCB3aGljaCByZXR1cm5zXG4gIC8vIHRoZSBmaWxlJ3MgY3JlYXRpb24gZGF0ZSBpbnN0ZWFkIG9mIHRoZSBjYWxsIHRpbWUuXG4gIC8vXG4gIC8vIHN1YnR5cCAob3B0aW9uYWwpIGFwcGVuZHMgdGhhdCBTdWJ0eXAncyBibG9jay4gQSBrZXkgaW4gQk9USCBibG9ja3Mga2VlcHNcbiAgLy8gdGhlIFRZUC1Gcm9udG1hdHRlciBwb3NpdGlvbiwgYnV0IHZhbHVlLCBmbG9hdGluZyBmbGFnIGFuZCBzaG9ydGN1dCBjb21lXG4gIC8vIGZyb20gdGhlIFN1YnR5cC4gRnJvbnRtYXR0ZXIgc29ydGluZyBtdXN0IHVzZSB0aGUgc2FtZSBydWxlIChzZWVcbiAgLy8gb3JkZXJlZERlZmF1bHRLZXlzIGluIGZyb250bWF0dGVyLXNvcnQuanMpLCBvciBpdCB3b3VsZCByZS1zb3J0IGEgbmV3IG5vdGVcbiAgLy8gcmlnaHQgYXdheS5cbiAgZ2V0VHlwRGVmYXVsdHModHlwLCB7IGluY2x1ZGVGbG9hdGluZyA9IGZhbHNlLCBmaWxlLCBzdWJ0eXAgPSBudWxsIH0gPSB7fSkge1xuICAgIGNvbnN0IHsgZGVmYXVsdHMsIHNob3J0Y3V0cyB9ID0gdGhpcy5jb2xsZWN0QmxvY2tzKHR5cCwgc3VidHlwLCBpbmNsdWRlRmxvYXRpbmcpO1xuICAgIHJldHVybiByZXNvbHZlU2hvcnRjdXRzKGRlZmF1bHRzLCBzaG9ydGN1dHMsIHsgZmlsZSwgYXBwOiB0aGlzLmFwcCB9KTtcbiAgfVxuXG4gIC8vIFNoYXJlZCBiYXNlIG9mIGdldFR5cERlZmF1bHRzKCkgYW5kIGdldFR5cFNob3J0Y3V0cygpOiB0aGUgVFlQLUZyb250bWF0dGVyXG4gIC8vIHBsdXMgdGhlIFN1YnR5cCdzIGJsb2NrLiBBIGtleSBpbiBCT1RIIGtlZXBzIHRoZSBUWVAtRnJvbnRtYXR0ZXIgcG9zaXRpb247XG4gIC8vIHZhbHVlLCBmbG9hdGluZyBmbGFnIEFORCBzaG9ydGN1dCBjb21lIGZyb20gdGhlIFN1YnR5cCAtIFwibm8gc2hvcnRjdXRcIlxuICAvLyBjb3VudHMgYXMgdGhlIFN1YnR5cCdzIGNob2ljZSB0b28gYW5kIGNhbmNlbHMgdGhlIFRZUCdzLlxuICBjb2xsZWN0QmxvY2tzKHR5cCwgc3VidHlwLCBpbmNsdWRlRmxvYXRpbmcpIHtcbiAgICBjb25zdCBkZWZhdWx0cyA9IHt9O1xuICAgIGNvbnN0IHNob3J0Y3V0cyA9IHt9O1xuICAgIGNvbnN0IGlzRmxvYXRpbmcgPSBuZXcgTWFwKCk7XG4gICAgY29uc3QgYWRkQmxvY2sgPSAoZnJvbnRtYXR0ZXIsIGZsb2F0aW5nS2V5cywgYmxvY2tTaG9ydGN1dHMpID0+IHtcbiAgICAgIGNvbnN0IGFjdHVhbEtleXMgPSBuZXcgTWFwKE9iamVjdC5rZXlzKGRlZmF1bHRzKS5tYXAoKGtleSkgPT4gW2tleS50b0xvd2VyQ2FzZSgpLCBrZXldKSk7XG4gICAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhmcm9udG1hdHRlciA/PyB7fSkpIHtcbiAgICAgICAgaWYgKGtleSA9PT0gXCJcIikgY29udGludWU7XG4gICAgICAgIGNvbnN0IHRhcmdldCA9IGFjdHVhbEtleXMuZ2V0KGtleS50b0xvd2VyQ2FzZSgpKSA/PyBrZXk7XG4gICAgICAgIGRlZmF1bHRzW3RhcmdldF0gPSB2YWx1ZTtcbiAgICAgICAgaXNGbG9hdGluZy5zZXQodGFyZ2V0LCAoZmxvYXRpbmdLZXlzID8/IFtdKS5pbmNsdWRlcyhrZXkpKTtcbiAgICAgICAgY29uc3QgcmVjb3JkID0gKGJsb2NrU2hvcnRjdXRzID8/IHt9KVtrZXldO1xuICAgICAgICBpZiAocmVjb3JkKSBzaG9ydGN1dHNbdGFyZ2V0XSA9IHJlY29yZDtcbiAgICAgICAgZWxzZSBkZWxldGUgc2hvcnRjdXRzW3RhcmdldF07XG4gICAgICB9XG4gICAgfTtcbiAgICBjb25zdCBzdWJ0eXBEYXRhID0gc3VidHlwID8gZ2V0U3VidHlwKHRoaXMuc2V0dGluZ3MsIHR5cCwgc3VidHlwKSA6IG51bGw7XG4gICAgYWRkQmxvY2soXG4gICAgICB0aGlzLnNldHRpbmdzLnR5cERlZmF1bHRGcm9udG1hdHRlclt0eXBdLFxuICAgICAgdGhpcy5zZXR0aW5ncy50eXBGbG9hdGluZ0tleXNbdHlwXSxcbiAgICAgIHRoaXMuc2V0dGluZ3MudHlwU2hvcnRjdXRzW3R5cF1cbiAgICApO1xuICAgIGlmIChzdWJ0eXBEYXRhKSBhZGRCbG9jayhzdWJ0eXBEYXRhLmZyb250bWF0dGVyLCBzdWJ0eXBEYXRhLmZsb2F0aW5nS2V5cywgc3VidHlwRGF0YS5zaG9ydGN1dHMpO1xuXG4gICAgaWYgKCFpbmNsdWRlRmxvYXRpbmcpIHtcbiAgICAgIGZvciAoY29uc3QgW2tleSwgZmxvYXRpbmddIG9mIGlzRmxvYXRpbmcpIHtcbiAgICAgICAgaWYgKCFmbG9hdGluZykgY29udGludWU7XG4gICAgICAgIGRlbGV0ZSBkZWZhdWx0c1trZXldO1xuICAgICAgICBkZWxldGUgc2hvcnRjdXRzW2tleV07XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB7IGRlZmF1bHRzLCBzaG9ydGN1dHMgfTtcbiAgfVxuXG4gIC8vIEZvciBUWVAuanM6IHRoZSBwcm9wZXJ0aWVzIG9mIHRoaXMgVFlQIHdob3NlIHZhbHVlIGNvbWVzIGZyb20gYSBUZW1wbGF0ZXJcbiAgLy8gc2NyaXB0LCBhcyB7IFtwcm9wZXJ0eV06IHsgbmFtZSwgcGFyYW1zLCBhcmdzLCBmYWxsYmFjayB9IH0gaW5cbiAgLy8gVFlQLUZyb250bWF0dGVyIG9yZGVyICh0aGUgc2NyaXB0cyBydW4gaW4gdHVybiBhbmQgc2VlIGVhcmxpZXIgcmVzdWx0cykuXG4gIC8vXG4gIC8vICAgbmFtZSAgICAgIHNjcmlwdCBuYW1lIHdpdGhvdXQgXCJ0cC5cIiwgaS5lLiB0cC51c2VyLjxuYW1lPlxuICAvLyAgIHBhcmFtcyAgICB0aGUgcGFyYW1ldGVyIGxpc3QgZGVjbGFyZWQgaW4gdGhlIEB0eXAtc2hvcnRjdXQgbWFya2VyLCBvclxuICAvLyAgICAgICAgICAgICBudWxsIHdpdGhvdXQgcGFyZW50aGVzZXMuIFRha2VuIGZyb20gdGhlIGN1cnJlbnQgc2Nhbiwgc28gYVxuICAvLyAgICAgICAgICAgICBjaGFuZ2VkIGRlY2xhcmF0aW9uIGFwcGxpZXMgYXQgb25jZS4gVFlQLmpzIHR1cm5zIGl0IGludG8gdGhlXG4gIC8vICAgICAgICAgICAgIGNhbGwncyBhcmd1bWVudHMgd2l0aCByZXNvbHZlU2hvcnRjdXRBcmdzKClcbiAgLy8gICBhcmdzICAgICAgdGhlIHR5cGVkIGFyZ3VtZW50cywgbmFtZWQgYWZ0ZXIgdGhlIG5vbi1yZXNlcnZlZCBwYXJhbWV0ZXJzO1xuICAvLyAgICAgICAgICAgICBhbiBlbXB0eSBmaWVsZCBpcyBtaXNzaW5nIHNvIFwiYXJncy54ID8/IGZhbGxiYWNrXCIgd29ya3NcbiAgLy8gICBmYWxsYmFjayAgdGhlIGZpeGVkIHZhbHVlIHN0b3JlZCBmb3IgdGhlIHByb3BlcnR5LiBPbmx5IGEgRkFMTEJBQ0s6XG4gIC8vICAgICAgICAgICAgIFRZUC5qcyB3cml0ZXMgaXQgaWYgdGhlIHNjcmlwdCBpcyBtaXNzaW5nIG9yIHRocm93cy4gQSBzY3JpcHRcbiAgLy8gICAgICAgICAgICAgdGhhdCBkZWxpYmVyYXRlbHkgcmV0dXJucyBudWxsL1wiXCIgKEVTQyBpbiBhIHBpY2tlcikgaGFzIG5vdFxuICAvLyAgICAgICAgICAgICBmYWlsZWQgLSB0aGUgcHJvcGVydHkgc3RheXMgZW1wdHkgdGhlbi5cbiAgLy9cbiAgLy8gRml4ZWQgc2hvcnRjdXRzICh0b2RheS9ub3cvY3JlYXRlZCkgZG9uJ3QgYXBwZWFyIGhlcmU7IGdldFR5cERlZmF1bHRzKClcbiAgLy8gYWxyZWFkeSByZXNvbHZlcyB0aGVtIGFuZCByZXR1cm5zIHRoZSBzY3JpcHQga2V5cyBhcyBudWxsLlxuICAvL1xuICAvLyBPcHRpb25zIGFzIGluIGdldFR5cERlZmF1bHRzKCk7IGluY2x1ZGVGbG9hdGluZyBkZWZhdWx0cyB0byBmYWxzZSBzbyBub1xuICAvLyBzY3JpcHQgcnVucyB1bmFza2VkIGZvciBhIGZsb2F0aW5nIHByb3BlcnR5LlxuICBnZXRUeXBTaG9ydGN1dHModHlwLCB7IGluY2x1ZGVGbG9hdGluZyA9IGZhbHNlLCBzdWJ0eXAgPSBudWxsIH0gPSB7fSkge1xuICAgIGNvbnN0IHsgZGVmYXVsdHMsIHNob3J0Y3V0cyB9ID0gdGhpcy5jb2xsZWN0QmxvY2tzKHR5cCwgc3VidHlwLCBpbmNsdWRlRmxvYXRpbmcpO1xuICAgIGNvbnN0IHNjcmlwdHMgPSB0aGlzLmdldFNob3J0Y3V0U2NyaXB0cz8uKCkgPz8gW107XG4gICAgY29uc3QgcmVzdWx0ID0ge307XG4gICAgZm9yIChjb25zdCBba2V5LCByZWNvcmRdIG9mIE9iamVjdC5lbnRyaWVzKHNob3J0Y3V0cykpIHtcbiAgICAgIGNvbnN0IG5hbWUgPSBzY3JpcHROYW1lT2YocmVjb3JkLm5hbWUpO1xuICAgICAgaWYgKG5hbWUgPT09IG51bGwpIGNvbnRpbnVlO1xuICAgICAgY29uc3Qgc2NyaXB0ID0gc2NyaXB0cy5maW5kKChzKSA9PiBzLm5hbWUgPT09IG5hbWUpO1xuICAgICAgcmVzdWx0W2tleV0gPSB7XG4gICAgICAgIG5hbWUsXG4gICAgICAgIHBhcmFtczogc2NyaXB0Py5wYXJhbXMgPz8gbnVsbCxcbiAgICAgICAgYXJnczogeyAuLi4ocmVjb3JkLmFyZ3MgPz8ge30pIH0sXG4gICAgICAgIGZhbGxiYWNrOiBkZWZhdWx0c1trZXldID8/IG51bGwsXG4gICAgICB9O1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgLy8gRm9yIFRZUC5qczogdHVybnMgYSBzaG9ydGN1dCdzIHBhcmFtZXRlciBsaXN0IGludG8gdGhlIGFyZ3VtZW50cyBvZlxuICAvLyB0cC51c2VyLjxuYW1lPih0cCwgLi4uKSAtIHNlZSByZXNvbHZlQ2FsbEFyZ3MgaW4gc2hvcnRjdXRzLmpzLiBMaXZlcyBoZXJlXG4gIC8vIHNvIHRoZSBydWxlcyAocmVzZXJ2ZWQgbmFtZXMsIGRvdHRlZCBuYW1lcykgZXhpc3QgaW4gb25lIHBsYWNlOyBvbmx5XG4gIC8vIFRZUC5qcyBrbm93cyBuZXdGaWxlIGFuZCBjdHgsIHNvIGl0IHBhc3NlcyB0aGVtIGluLlxuICByZXNvbHZlU2hvcnRjdXRBcmdzKHBhcmFtcywgYXJncywgeyBuZXdGaWxlID0gbnVsbCwgY3R4ID0gbnVsbCwga2V5ID0gbnVsbCB9ID0ge30pIHtcbiAgICByZXR1cm4gcmVzb2x2ZUNhbGxBcmdzKHBhcmFtcywgYXJncywgeyBuZXdGaWxlLCBjdHgsIGtleSB9KTtcbiAgfVxuXG4gIC8vIEZvciBUWVAuanM6IHJlZ2lzdGVyZWQgU3VidHlwcyBvZiBhIFRZUCBpbiBibG9jayBvcmRlciwgd2l0aCBub3RlIGNvdW50cy5cbiAgLy8gU3VidHlwcyB0aGF0IGFyZW4ndCBtYW51YWxseSBjcmVhdGFibGUgYXJlIGxlZnQgb3V0IHVubGVzc1xuICAvLyBpbmNsdWRlTWFudWFsT2ZmIGlzIHNldCwgbGlrZSBzdWNoIFRZUCBlbnRyaWVzIGluIGdldFR5cHMoKS5cbiAgZ2V0U3VidHlwcyh0eXAsIHsgaW5jbHVkZU1hbnVhbE9mZiA9IGZhbHNlIH0gPSB7fSkge1xuICAgIGNvbnN0IHsgY291bnRzIH0gPSB0aGlzLnR5cEluZGV4LnN1YnR5cEJ1Y2tldCh0eXApO1xuICAgIHJldHVybiBnZXRTdWJ0eXBOYW1lcyh0aGlzLnNldHRpbmdzLCB0eXApXG4gICAgICAuZmlsdGVyKChzdWJ0eXApID0+IGluY2x1ZGVNYW51YWxPZmYgfHwgaXNTdWJ0eXBNYW51YWwodGhpcy5zZXR0aW5ncywgdHlwLCBzdWJ0eXApKVxuICAgICAgLm1hcCgoc3VidHlwKSA9PiAoeyBzdWJ0eXAsIGNvdW50OiBjb3VudHMuZ2V0KHN1YnR5cCkgPz8gMCB9KSk7XG4gIH1cblxuICAvLyBGb3IgVFlQLmpzOiB0aGUgU3VidHlwLVBpY2tlciAoc2VlIHR5cC1waWNrZXIuanMpLiBSZXNvbHZlcyB3aXRoIHRoZVxuICAvLyBTdWJ0eXAsIFwiXCIgZm9yIFwibm8gU3VidHlwXCIgKG9yIHdpdGhvdXQgYSBwaWNrZXIgaWYgdGhlIFRZUCBoYXMgbm9uZSksIG9yXG4gIC8vIG51bGwgb24gRVNDIChUWVAuanMgdGhlbiBnb2VzIGJhY2sgdG8gdGhlIFRZUCBjaG9pY2UpLiBxdWVyeSAob3B0aW9uYWwpOlxuICAvLyBhbiBhbHJlYWR5IHR5cGVkIHNlYXJjaCB0aGF0IHByZS1zb3J0cyB0aGUgbGlzdC4gb3B0aW9ucyBhcyBpbiBnZXRTdWJ0eXBzLlxuICBwaWNrU3VidHlwKHR5cCwgcXVlcnkgPSBcIlwiLCBvcHRpb25zID0ge30pIHtcbiAgICByZXR1cm4gcGlja1N1YnR5cE1vZGFsKHRoaXMuYXBwLCB0aGlzLCB0eXAsIHF1ZXJ5LCBvcHRpb25zKTtcbiAgfVxuXG4gIC8vIEZvciBUWVAuanMsIGluc2lkZSBwcm9jZXNzRnJvbnRNYXR0ZXI6IHNldHMgVFlQIGFuZCBTVUJUWVAgaW4gY2Fub25pY2FsXG4gIC8vIHNwZWxsaW5nIC0gYSB2YXJpYW50IGxpa2UgXCJ0eXBcIiBvciBcIlN1YnR5cFwiIGlzIHJlbmFtZWQgaW4gcGxhY2UgcmF0aGVyIHRoYW5cbiAgLy8gZHVwbGljYXRlZC4gc3VidHlwIG51bGwgcmVtb3ZlcyBhbiBleGlzdGluZyBTVUJUWVAuXG4gIGFwcGx5VHlwUHJvcGVydGllcyhmcm9udG1hdHRlciwgdHlwLCBzdWJ0eXApIHtcbiAgICBzZXRDYW5vbmljYWxQcm9wZXJ0eShmcm9udG1hdHRlciwgVFlQX1BST1BFUlRZLCB0eXApO1xuICAgIGlmIChzdWJ0eXApIHNldENhbm9uaWNhbFByb3BlcnR5KGZyb250bWF0dGVyLCBTVUJUWVBfUFJPUEVSVFksIHN1YnR5cCk7XG4gICAgZWxzZSBkZWxldGVQcm9wZXJ0eShmcm9udG1hdHRlciwgU1VCVFlQX1BST1BFUlRZKTtcbiAgfVxuXG4gIC8vIEZvciBUWVAuanMsIGluc2lkZSBwcm9jZXNzRnJvbnRNYXR0ZXIgYW5kIGFmdGVyIGFsbCBvdGhlciBjaGFuZ2VzOiBwdXRzIHRoZVxuICAvLyBmcm9udG1hdHRlciBpbnRvIHNvcnRpbmcgb3JkZXIsIG9yIG5ld2x5IGFkZGVkIHByb3BlcnRpZXMgKFNVQlRZUCBpbiBhblxuICAvLyBleGlzdGluZyBub3RlLCBzYXkpIHdvdWxkIGVuZCB1cCBsYXN0LlxuICBzb3J0RnJvbnRtYXR0ZXIoZnJvbnRtYXR0ZXIsIHR5cCwgc3VidHlwID0gbnVsbCkge1xuICAgIHJldHVybiBzb3J0RnJvbnRtYXR0ZXJGb3IodGhpcywgZnJvbnRtYXR0ZXIsIHR5cCwgc3VidHlwKTtcbiAgfVxuXG4gIC8vIEluc2lkZSBwcm9jZXNzRnJvbnRNYXR0ZXI6IG1vdmVzIG9ubHkgcHJvcGVydHkgYGtleWAgdG8gaXRzIHNvcnRlZCBwbGFjZVxuICAvLyAoVFlQL1NVQlRZUCByZWFkIGZyb20gdGhlIG9iamVjdCksIGV2ZXJ5dGhpbmcgZWxzZSBzdGF5cyAtIGZvciBGcmVkJ3NcbiAgLy8gcHJvcGVydHkgYmFja2xpbmtpbmcsIHNvIGEgbmV3IHByb3BlcnR5IGRvZXNuJ3QgZW5kIHVwIGxhc3QuXG4gIHBsYWNlUHJvcGVydHkoZnJvbnRtYXR0ZXIsIGtleSkge1xuICAgIHJldHVybiBwbGFjZVByb3BlcnR5Rm9yKHRoaXMsIGZyb250bWF0dGVyLCBrZXkpO1xuICB9XG5cbiAgLy8gRm9yIFRZUC5qczogdGhlIHJlZ2lzdGVyZWQgVFlQIGVudHJpZXMgd2l0aCB0aGVpciBkZXNjcmlwdGlvbnMsIGluIHRoZVxuICAvLyBvcmRlciBvZiB0aGUgVFlQLUxpc3QgKGl0cyBjdXJyZW50IHNvcnQgc2V0dGluZykuIFRZUCBlbnRyaWVzIHRoYXQgYXJlbid0XG4gIC8vIG1hbnVhbGx5IGNyZWF0YWJsZSBhcmUgbGVmdCBvdXQgdW5sZXNzIGluY2x1ZGVNYW51YWxPZmYgaXMgdHJ1ZS5cbiAgZ2V0VHlwcyh7IGluY2x1ZGVNYW51YWxPZmYgPSBmYWxzZSB9ID0ge30pIHtcbiAgICBjb25zdCB7IGNvdW50cyB9ID0gdGhpcy50eXBJbmRleC50eXBDb3VudHMoKTtcbiAgICBjb25zdCBzb3J0T3JkZXIgPSB0aGlzLnNldHRpbmdzLnR5cFNvcnRPcmRlciA/PyBERUZBVUxUX1NPUlRfT1JERVI7XG4gICAgcmV0dXJuIHNvcnRUeXBzQnlNb2RlKHRoaXMuc2V0dGluZ3MudHlwcywgc29ydE9yZGVyLCBjb3VudHMsIHRoaXMuc2V0dGluZ3MudHlwQ29sb3JzKVxuICAgICAgLmZpbHRlcigodHlwKSA9PiBpbmNsdWRlTWFudWFsT2ZmIHx8ICh0aGlzLnNldHRpbmdzLnR5cE1hbnVhbCA/PyB7fSlbdHlwXSAhPT0gZmFsc2UpXG4gICAgICAubWFwKCh0eXApID0+ICh7XG4gICAgICAgIHR5cCxcbiAgICAgICAgZGVzY3JpcHRpb246IHRoaXMuc2V0dGluZ3MudHlwRGVzY3JpcHRpb25zW3R5cF0gPz8gXCJcIixcbiAgICAgICAgY291bnQ6IGNvdW50cy5nZXQodHlwKSA/PyAwLFxuICAgICAgfSkpO1xuICB9XG5cbiAgLy8gRm9yIFRZUC5qczogdGhlIG5hdGl2ZSBUWVAtUGlja2VyIChzZWUgdHlwLXBpY2tlci5qcykgd2l0aCBjb2xvcixcbiAgLy8gZGVzY3JpcHRpb24gYW5kIG5vdGUgY291bnQuIGluY2x1ZGVNYW51YWxPZmYgYXMgaW4gZ2V0VHlwcygpLiBSZXNvbHZlc1xuICAvLyB3aXRoIHRoZSBUWVAsIG9yIG51bGwgb24gRVNDLlxuICBwaWNrVHlwKG9wdGlvbnMpIHtcbiAgICByZXR1cm4gcGlja1R5cE1vZGFsKHRoaXMuYXBwLCB0aGlzLCBvcHRpb25zKTtcbiAgfVxuXG4gIC8vIEZvciBUWVAuanM6IFRZUCBhbmQgU3VidHlwIGluIG9uZSBnbyAoc2VlIHR5cC1waWNrZXIuanMpIC0gb25lIHBpY2tlciB3aXRoXG4gIC8vIGluZGVudGVkIFN1YnR5cHMgb3IgYm90aCBwaWNrZXJzIGluIHR1cm4sIHBlciBcIlNlcGFyYXRlIFN1YnR5cC1QaWNrZXJcIi5cbiAgLy8gUmVzb2x2ZXMgd2l0aCB7IHR5cCwgc3VidHlwIH0gKHN1YnR5cCBudWxsIGZvciBcIm5vIFN1YnR5cFwiKSwgb3IgbnVsbCBvblxuICAvLyBFU0MuXG4gIHBpY2tUeXBBbmRTdWJ0eXAob3B0aW9ucykge1xuICAgIHJldHVybiBwaWNrVHlwQW5kU3VidHlwTW9kYWwodGhpcy5hcHAsIHRoaXMsIG9wdGlvbnMpO1xuICB9XG5cbiAgLy8gZGF0YTogd2hhdCBsb2FkRGF0YSgpIHJldHVybmVkLCBpZiB0aGUgY2FsbGVyIGFscmVhZHkgaGFzIGl0IChvbmxvYWQpO1xuICAvLyB3aXRob3V0IGl0IChvbkV4dGVybmFsU2V0dGluZ3NDaGFuZ2UpIGRhdGEuanNvbiBpcyByZWFkIGhlcmUuXG4gIGFzeW5jIGxvYWRTZXR0aW5ncyhkYXRhKSB7XG4gICAgaWYgKGRhdGEgPT09IHVuZGVmaW5lZCkgZGF0YSA9IGF3YWl0IHRoaXMubG9hZERhdGEoKTtcbiAgICAvLyBBIGRlZXAgY29weSBhcyB0aGUgYmFzZTogd2l0aG91dCBkYXRhLmpzb24gKGEgZnJlc2ggaW5zdGFsbCkgb3Igd2l0aCBrZXlzXG4gICAgLy8gbWlzc2luZyBmcm9tIGl0LCBzZXR0aW5ncy50eXBzLCB0eXBDb2xvcnMgYW5kIHNvIG9uIHdvdWxkIG90aGVyd2lzZSBCRVxuICAgIC8vIHRoZSBvYmplY3RzIGluIERFRkFVTFRfU0VUVElOR1MsIGFuZCBldmVyeSBjaGFuZ2Ugd291bGQgYWx0ZXIgdGhlXG4gICAgLy8gZGVmYXVsdHMgYWxvbmcgd2l0aCB0aGVtLlxuICAgIHRoaXMuc2V0dGluZ3MgPSBPYmplY3QuYXNzaWduKHN0cnVjdHVyZWRDbG9uZShERUZBVUxUX1NFVFRJTkdTKSwgZGF0YSk7XG4gICAgLy8gT2JqZWN0LmFzc2lnbiByZXBsYWNlcyBuZXN0ZWQgb2JqZWN0cyB3aG9sZTsgdmlld3MgYWRkZWQgbGF0ZXIgKGUuZy5cbiAgICAvLyBjb2xvclZpZXdzLmxpbmtzKSB3b3VsZCBvdGhlcndpc2UgYmUgc2lsZW50bHkgb2ZmIGluIG9sZGVyIHNldHRpbmdzLlxuICAgIHRoaXMuc2V0dGluZ3MuY29sb3JWaWV3cyA9IHsgLi4uREVGQVVMVF9TRVRUSU5HUy5jb2xvclZpZXdzLCAuLi50aGlzLnNldHRpbmdzLmNvbG9yVmlld3MgfTtcbiAgICB0aGlzLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIgPSBub3JtYWxpemVHbG9iYWxPcmRlcih0aGlzLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIpO1xuICB9XG5cbiAgLy8gc2V0dGluZ3NSZXZpc2lvbiBjb3VudHMgZXZlcnkgY2hhbmdlIG9mIHRoZSBzZXR0aW5ncyAoaGVyZSBhbmQgaW5cbiAgLy8gb25FeHRlcm5hbFNldHRpbmdzQ2hhbmdlKS4gVW5kbyAodW5kby5qcykgY29tcGFyZXMgaXQgdG8gdGVsbCB3aGV0aGVyXG4gIC8vIGFueXRoaW5nIGhhcHBlbmVkIGFmdGVyIHRoZSBhY3Rpb24gaXQgd291bGQgcmV2ZXJ0LiBCdW1wZWQgc3luY2hyb25vdXNseSxcbiAgLy8gYmVmb3JlIHRoZSBhd2FpdCwgc28gYSBjYWxsZXIgdGhhdCBkb2Vzbid0IGF3YWl0IHN0aWxsIGNvdW50cyBhdCBvbmNlLlxuICBhc3luYyBzYXZlU2V0dGluZ3MoKSB7XG4gICAgdGhpcy5zZXR0aW5nc1JldmlzaW9uID0gKHRoaXMuc2V0dGluZ3NSZXZpc2lvbiA/PyAwKSArIDE7XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcbiAgfVxuXG4gIC8vIENhbGxlZCB3aGVuIGRhdGEuanNvbiBjaGFuZ2VzIGZyb20gb3V0c2lkZSwgaW4gcHJhY3RpY2UgdGhyb3VnaCBPYnNpZGlhblxuICAvLyBTeW5jLiBXaXRob3V0IGl0IHRoaXMgZGV2aWNlIHdvdWxkIGtlZXAgaXRzIG9sZCBzZXR0aW5ncyBpbiBtZW1vcnkgYW5kXG4gIC8vIG92ZXJ3cml0ZSB0aGUgbmV3IG9uZXMgb24gdGhlIG5leHQgc2F2ZS4gT2JzaWRpYW4gcmVidWlsZHMgYW4gb3BlblxuICAvLyBzZXR0aW5ncyB0YWIgaXRzZWxmOyBjb2xvcnMgYW5kIHRoZSBUWVAtUGFuZSBhcmUgcmVmcmVzaGVkIGhlcmUuXG4gIGFzeW5jIG9uRXh0ZXJuYWxTZXR0aW5nc0NoYW5nZSgpIHtcbiAgICAvLyBJbnZhbGlkYXRlcyBhIHBlbmRpbmcgdW5kbzogaXRzIHNuYXBzaG90IHByZWRhdGVzIHRoZSBzeW5jZWQgc2V0dGluZ3MuXG4gICAgdGhpcy5zZXR0aW5nc1JldmlzaW9uID0gKHRoaXMuc2V0dGluZ3NSZXZpc2lvbiA/PyAwKSArIDE7XG4gICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcbiAg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QWEsS0FBSyxLQUFLLE1BQU0sT0FBTztBQUFBLEVBQzdDO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQU1BLGlCQUFpQixTQUFTO0FBQ3hCLFdBQU8sc0JBQXNCLEtBQUssS0FBSyxNQUFNLE9BQU87QUFBQSxFQUN0RDtBQUFBO0FBQUE7QUFBQSxFQUlBLE1BQU0sYUFBYSxNQUFNO0FBQ3ZCLFFBQUksU0FBUyxPQUFXLFFBQU8sTUFBTSxLQUFLLFNBQVM7QUFLbkQsU0FBSyxXQUFXLE9BQU8sT0FBTyxnQkFBZ0IsZ0JBQWdCLEdBQUcsSUFBSTtBQUdyRSxTQUFLLFNBQVMsYUFBYSxFQUFFLEdBQUcsaUJBQWlCLFlBQVksR0FBRyxLQUFLLFNBQVMsV0FBVztBQUN6RixTQUFLLFNBQVMsc0JBQXNCLHFCQUFxQixLQUFLLFNBQVMsbUJBQW1CO0FBQUEsRUFDNUY7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBTUEsTUFBTSxlQUFlO0FBQ25CLFNBQUssb0JBQW9CLEtBQUssb0JBQW9CLEtBQUs7QUFDdkQsVUFBTSxLQUFLLFNBQVMsS0FBSyxRQUFRO0FBQUEsRUFDbkM7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBTUEsTUFBTSwyQkFBMkI7QUFFL0IsU0FBSyxvQkFBb0IsS0FBSyxvQkFBb0IsS0FBSztBQUN2RCxVQUFNLEtBQUssYUFBYTtBQUN4QixTQUFLLGlCQUFpQjtBQUFBLEVBQ3hCO0FBQ0Y7IiwKICAibmFtZXMiOiBbImV4cG9ydHMiLCAibW9kdWxlIiwgIlRZUF9QUk9QRVJUWSIsICJTVUJUWVBfUFJPUEVSVFkiLCAic2V0Q2Fub25pY2FsUHJvcGVydHkiLCAiZGVsZXRlUHJvcGVydHkiLCAiVHlwSW5kZXgiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAic2V0Q2Fub25pY2FsUHJvcGVydHkiLCAiU1VCVFlQX1BST1BFUlRZIiwgImdldFN1YnR5cE5hbWVzIiwgImdldFN1YnR5cCIsICJpc1N1YnR5cE1hbnVhbCIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJzb3J0VHlwc0J5TW9kZSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXAiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJub3JtYWxpemVHbG9iYWxPcmRlciIsICJzb3J0RnJvbnRtYXR0ZXJGb3IiLCAicGxhY2VQcm9wZXJ0eUZvciIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJUWVBfUFJPUEVSVFkiLCAiU1VCVFlQX1BST1BFUlRZIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImdldFN1YnR5cCIsICJjbGVhcklubGluZUNvbG9ycyIsICJhbGxEb2N1bWVudHMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiREVGQVVMVF9TRVRUSU5HUyIsICJUeXBTeXN0ZW1TZXR0aW5nVGFiIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImdldFN1YnR5cE5hbWVzIiwgIm5vcm1hbGl6ZUdsb2JhbE9yZGVyIiwgIlRZUF9QUk9QRVJUWSIsICJTVUJUWVBfUFJPUEVSVFkiLCAibGVhZiIsICJjdXJyZW50IiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyQ29tbWFuZHMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAic2NyaXB0TmFtZU9mIiwgInJlc29sdmVDYWxsQXJncyIsICJyZXNvbHZlU2hvcnRjdXRzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInNjcmlwdE5hbWVPZiIsICJnZXRTdWJ0eXAiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJyZW1vdmVQcm9wZXJ0eU1lbnVQYXRjaCIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXBOYW1lcyIsICJnZXRTdWJ0eXAiLCAiaXNTdWJ0eXBNYW51YWwiLCAic29ydFR5cHNCeU1vZGUiLCAic2V0Q2Fub25pY2FsUHJvcGVydHkiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJERUZBVUxUX1NPUlRfT1JERVIiLCAicmVnaXN0ZXJUeXBQYW5lIiwgImxlYWYiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJGaWxlRXhwbG9yZXJDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJHcmFwaENvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlclNlYXJjaENvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlclJlY2VudEZpbGVzQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyQmFja2xpbmtDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJCb29rbWFya3NDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZ2V0U3VidHlwIiwgInJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiYWxsRG9jdW1lbnRzIiwgInJlZ2lzdGVyTGlua0NvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXBOYW1lcyIsICJnZXRTdWJ0eXAiLCAiYWxsRG9jdW1lbnRzIiwgImZsb2F0aW5nIiwgInJlZ2lzdGVyRnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0IiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImdldFN1YnR5cE5hbWVzIiwgIlRZUF9QUk9QRVJUWSIsICJTVUJUWVBfUFJPUEVSVFkiLCAicmVnaXN0ZXJQcm9wZXJ0eVJlbmFtZVN5bmMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiREVGQVVMVF9TT1JUX09SREVSIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyU2hvcnRjdXRTY3JpcHRzIl0KfQo=
