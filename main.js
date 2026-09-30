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
    var EMPTY_ENTRY = Object.freeze({ typeKey: null, rawType: null, subtypeKey: null, rawSubtype: null });
    var FLUSH_DELAY_MS = 100;
    function rawItem(value) {
      if (value == null) return "";
      return typeof value === "object" ? JSON.stringify(value) : String(value);
    }
    function typeKeyOf(value) {
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
      return !!a && !!b && a.typeKey === b.typeKey && a.subtypeKey === b.subtypeKey;
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
        const rawType = propertyValue(frontmatter, TYP_PROPERTY2) ?? null;
        const rawSubtype = propertyValue(frontmatter, SUBTYP_PROPERTY2) ?? null;
        return { typeKey: typeKeyOf(rawType), rawType, subtypeKey: typeKeyOf(rawSubtype), rawSubtype };
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
      // TYP-Schlüssel (siehe typeKeyOf) oder null. Für einen sauberen Wert ist das
      // schlicht der TYP-Name selbst.
      typeOf(file) {
        return this.entryFor(file).typeKey;
      }
      // SUBTYP-Schlüssel (siehe typeKeyOf) oder null.
      subtypeOf(file) {
        return this.entryFor(file).subtypeKey;
      }
      // Ein tatsächlicher Frontmatter-Wert zu einem Schlüssel - für Anzeige, Suche
      // und Normalisierung unregistrierter Einträge (alle Notizen eines Schlüssels
      // haben per Definition dieselbe Rohform).
      rawValueOf(typeKey) {
        return this.aggregate().rawByKey.get(typeKey);
      }
      // Sauberer Wert = Einzelwert ohne Leerzeichen am Rand. Klein geschriebene
      // Werte zählen hier als sauber (sie sind ein gültiger, nur noch nicht
      // registrierter TYP-Name), Listen und Randleerzeichen nicht.
      isCleanKey(typeKey) {
        const raw = this.rawValueOf(typeKey);
        return raw !== void 0 && !Array.isArray(raw) && typeKey === typeKey.trim();
      }
      // Dateien mit genau diesem TYP-Schlüssel, unter Beachtung der
      // "Ignorierte Notizen berücksichtigen"-Einstellung.
      filesWithType(typeKey) {
        return this.filesMatching((entry) => entry.typeKey === typeKey);
      }
      // Dateien mit genau diesem TYP- und SUBTYP-Schlüssel.
      filesWithSubtype(typeKey, subtypeKey) {
        return this.filesMatching((entry) => entry.typeKey === typeKey && entry.subtypeKey === subtypeKey);
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
      // Respektiert standardmäßig Obsidians eigene "Excluded files"-Liste - dort
      // tragen auch Plugins wie Hide Folders ausgeblendete Ordner ein. Über die
      // Einstellung "Ignorierte Notizen berücksichtigen" abschaltbar.
      //
      // Eine Notiz ohne TYP hat keinen SUBTYP-Kontext.
      aggregate() {
        this.ensureBuilt();
        const includeIgnored = !!this.plugin.settings.includeIgnoredFiles;
        if (this.aggregates?.includeIgnored === includeIgnored) return this.aggregates;
        const counts = /* @__PURE__ */ new Map();
        const rawByKey = /* @__PURE__ */ new Map();
        const subtypesByType = /* @__PURE__ */ new Map();
        let noType = 0;
        for (const [path, { typeKey, rawType, subtypeKey, rawSubtype }] of this.entries) {
          if (!includeIgnored && this.app.metadataCache.isUserIgnored(path)) continue;
          if (typeKey === null) {
            noType++;
            continue;
          }
          counts.set(typeKey, (counts.get(typeKey) ?? 0) + 1);
          if (!rawByKey.has(typeKey)) rawByKey.set(typeKey, rawType);
          let bucket = subtypesByType.get(typeKey);
          if (!bucket) {
            bucket = { counts: /* @__PURE__ */ new Map(), noSubtype: 0, rawByKey: /* @__PURE__ */ new Map() };
            subtypesByType.set(typeKey, bucket);
          }
          if (subtypeKey === null) {
            bucket.noSubtype++;
          } else {
            bucket.counts.set(subtypeKey, (bucket.counts.get(subtypeKey) ?? 0) + 1);
            if (!bucket.rawByKey.has(subtypeKey)) bucket.rawByKey.set(subtypeKey, rawSubtype);
          }
        }
        this.aggregates = { includeIgnored, counts, noType, rawByKey, subtypesByType };
        return this.aggregates;
      }
      // Zwischengespeichert - die gelieferten Maps nicht verändern.
      typeCounts() {
        const { counts, noType } = this.aggregate();
        return { counts, noType };
      }
      // TYP -> { counts: Map(SUBTYP-Schlüssel -> Anzahl), noSubtype, rawByKey }.
      // Zwischengespeichert - nicht verändern.
      subtypeCounts() {
        return this.aggregate().subtypesByType;
      }
      subtypeBucket(typeKey) {
        return this.subtypeCounts().get(typeKey) ?? EMPTY_BUCKET;
      }
    };
    var EMPTY_BUCKET = Object.freeze({ counts: /* @__PURE__ */ new Map(), noSubtype: 0, rawByKey: /* @__PURE__ */ new Map() });
    module2.exports = { TypIndex: TypIndex2, typeKeyOf, propertyValue, setCanonicalProperty: setCanonicalProperty2, deleteProperty: deleteProperty2, TYP_PROPERTY: TYP_PROPERTY2, SUBTYP_PROPERTY: SUBTYP_PROPERTY2 };
  }
});

// src/subtypes.js
var require_subtypes = __commonJS({
  "src/subtypes.js"(exports2, module2) {
    var { typeKeyOf, propertyValue, setCanonicalProperty: setCanonicalProperty2, SUBTYP_PROPERTY: SUBTYP_PROPERTY2 } = require_typ_index();
    function normalizeSubtypeName(raw) {
      return raw.trim().replace(/\S+/g, (word) => word.charAt(0).toLocaleUpperCase("de") + word.slice(1).toLocaleLowerCase("de"));
    }
    function isEmptyValue(value) {
      return value === null || value === void 0 || value === "";
    }
    function getSubtypeNames2(settings, type) {
      return Object.keys(settings.typeSubtypes?.[type] ?? {});
    }
    function getSubtype2(settings, type, subtype) {
      return settings.typeSubtypes?.[type]?.[subtype] ?? null;
    }
    function ensureSubtype(settings, type, subtype) {
      if (!settings.typeSubtypes) settings.typeSubtypes = {};
      if (!settings.typeSubtypes[type]) settings.typeSubtypes[type] = {};
      const byName = settings.typeSubtypes[type];
      if (!byName[subtype]) byName[subtype] = { frontmatter: {}, floatingKeys: [], shortcuts: {} };
      return byName[subtype];
    }
    function moveTypeSubtypes(settings, oldType, newType) {
      if (!settings.typeSubtypes?.[oldType]) return;
      settings.typeSubtypes[newType] = settings.typeSubtypes[oldType];
      delete settings.typeSubtypes[oldType];
    }
    function deleteTypeSubtypes(settings, type) {
      if (settings.typeSubtypes) delete settings.typeSubtypes[type];
    }
    function migrateAboveStandard2(settings) {
      let changed = false;
      for (const byName of Object.values(settings.typeSubtypes ?? {})) {
        for (const data of Object.values(byName)) {
          if (data.aboveStandard === void 0) continue;
          delete data.aboveStandard;
          changed = true;
        }
      }
      return changed;
    }
    var SUBTYPE_COLOR_SCALE = 3;
    var PREVIOUS_SUBTYPE_COLOR_RANGES = {
      2: { h: 25, s: 30, l: 20 },
      3: { h: 35, s: 20, l: 40 }
    };
    function migrateSubtypeColorScale2(settings, defaultRanges) {
      const from = Number(settings.subtypeColorScale) || 1;
      if (from >= SUBTYPE_COLOR_SCALE) return false;
      const allColors = function* () {
        for (const byName of Object.values(settings.typeSubtypes ?? {})) {
          for (const data of Object.values(byName)) if (data.color) yield data.color;
        }
      };
      const adoptDefaults = (step) => {
        const previous = PREVIOUS_SUBTYPE_COLOR_RANGES[step];
        if (Object.entries(previous).every(([key, value]) => Number(settings.subtypeColorRanges?.[key]) === value)) {
          settings.subtypeColorRanges = { ...defaultRanges };
        }
      };
      if (from < 2) {
        const oldRange = Number(settings.subtypeColorRanges?.l);
        adoptDefaults(2);
        const newRange = Number(settings.subtypeColorRanges?.l);
        const factor = oldRange > 0 && Number.isFinite(newRange) ? newRange / oldRange : 1;
        for (const color of allColors()) if (color.l) color.l = Math.round(color.l * factor);
      }
      if (from < 3) {
        adoptDefaults(3);
        for (const color of allColors()) if (color.s > 0) color.s = 0;
      }
      settings.subtypeColorScale = SUBTYPE_COLOR_SCALE;
      return true;
    }
    function mergeTypeSubtypes(settings, source, target) {
      const sourceSubtypes = settings.typeSubtypes?.[source];
      if (!sourceSubtypes) return;
      for (const [name, sourceData] of Object.entries(sourceSubtypes)) {
        const targetData = getSubtype2(settings, target, name);
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
          const shortcut = sourceData.shortcuts?.[key];
          if (shortcut) (targetData.shortcuts ?? (targetData.shortcuts = {}))[key] = shortcut;
        }
      }
      delete settings.typeSubtypes[source];
    }
    function renameSubtype(settings, type, oldName, newName) {
      const byName = settings.typeSubtypes?.[type];
      if (!byName?.[oldName] || oldName === newName) return;
      settings.typeSubtypes[type] = Object.fromEntries(
        Object.entries(byName).map(([name, data]) => [name === oldName ? newName : name, data])
      );
    }
    function getSectionOrder(settings, type) {
      return [null, ...getSubtypeNames2(settings, type)];
    }
    function reorderSubtypes(settings, type, order) {
      const byName = settings.typeSubtypes?.[type];
      if (!byName) return;
      const names = order.filter((name) => name !== null && byName[name]);
      const ordered = [...names, ...Object.keys(byName).filter((name) => !names.includes(name))];
      settings.typeSubtypes[type] = Object.fromEntries(ordered.map((name) => [name, byName[name]]));
    }
    function deleteSubtype(settings, type, name) {
      const byName = settings.typeSubtypes?.[type];
      if (!byName) return;
      delete byName[name];
      if (Object.keys(byName).length === 0) delete settings.typeSubtypes[type];
    }
    function mergeSubtypes(settings, type, source, target) {
      const sourceData = getSubtype2(settings, type, source);
      const targetData = getSubtype2(settings, type, target);
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
      deleteSubtype(settings, type, source);
    }
    async function renameSubtypeInNotes(plugin, type, oldKey, newValue) {
      let changed = 0;
      for (const file of plugin.typIndex.filesWithSubtype(type, oldKey)) {
        let matched = false;
        await plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
          if (typeKeyOf(propertyValue(frontmatter, SUBTYP_PROPERTY2)) !== oldKey) return;
          setCanonicalProperty2(frontmatter, SUBTYP_PROPERTY2, newValue);
          matched = true;
        });
        if (matched) changed++;
      }
      return changed;
    }
    module2.exports = {
      normalizeSubtypeName,
      isEmptyValue,
      getSubtypeNames: getSubtypeNames2,
      getSubtype: getSubtype2,
      ensureSubtype,
      migrateAboveStandard: migrateAboveStandard2,
      migrateSubtypeColorScale: migrateSubtypeColorScale2,
      moveTypeSubtypes,
      deleteTypeSubtypes,
      mergeTypeSubtypes,
      renameSubtype,
      getSectionOrder,
      reorderSubtypes,
      deleteSubtype,
      mergeSubtypes,
      renameSubtypeInNotes
    };
  }
});

// src/frontmatter-sort.js
var require_frontmatter_sort = __commonJS({
  "src/frontmatter-sort.js"(exports2, module2) {
    var { getSubtype: getSubtype2 } = require_subtypes();
    var { typeKeyOf, propertyValue } = require_typ_index();
    var TYP_PROPERTY2 = "TYP";
    var SUBTYP_PROPERTY2 = "SUBTYP";
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
    function orderedDefaultKeys(plugin, type, subtype = null) {
      if (!type) return null;
      const isSystemKey = (key) => key === "" || [TYP_PROPERTY2, SUBTYP_PROPERTY2].some((p) => key.toLowerCase() === p.toLowerCase());
      const subtypeData = subtype ? getSubtype2(plugin.settings, type, subtype) : null;
      const blocks = [plugin.settings.typeDefaultFrontmatter[type], subtypeData?.frontmatter];
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
    function computeSortedKeys(existingKeys, globalOrder, typeDefaultKeys) {
      const lowerToActual = new Map(existingKeys.map((key) => [key.toLowerCase(), key]));
      const resolve = (name) => lowerToActual.get(name.toLowerCase());
      const pinned = new Set(
        globalOrder.filter((entry) => entry.kind === "property").map((entry) => resolve(entry.name)).filter(Boolean)
      );
      const typKey = resolve(TYP_PROPERTY2);
      const subtypKey = resolve(SUBTYP_PROPERTY2);
      const typBlockKeys = new Set(
        (typeDefaultKeys ?? []).map(resolve).filter((key) => key && key !== typKey && !pinned.has(key))
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
      for (const key of existingKeys) push(key);
      return sortedKeys;
    }
    function cachedFrontmatterKeys(app, file) {
      const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter) return null;
      return Object.keys(frontmatter).filter((key) => key !== "position");
    }
    async function sortFileFrontmatter(app, file, globalOrder, typeDefaultKeys) {
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
    function sortFrontmatterFor2(plugin, frontmatter, type, subtype) {
      const globalOrder = normalizeGlobalOrder2(plugin.settings.globalPropertyOrder);
      return sortFrontmatterObject(frontmatter, globalOrder, orderedDefaultKeys(plugin, type, subtype));
    }
    function placePropertyFor2(plugin, frontmatter, key) {
      const existingKeys = Object.keys(frontmatter);
      const actualKey = existingKeys.find((k) => k.toLowerCase() === key.toLowerCase());
      if (!actualKey || existingKeys.length <= 1) return false;
      const globalOrder = normalizeGlobalOrder2(plugin.settings.globalPropertyOrder);
      const type = typeKeyOf(propertyValue(frontmatter, TYP_PROPERTY2));
      const subtype = typeKeyOf(propertyValue(frontmatter, SUBTYP_PROPERTY2));
      const sortedKeys = computeSortedKeys(existingKeys, globalOrder, orderedDefaultKeys(plugin, type, subtype));
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
      const type = plugin.typIndex.typeOf(file);
      const typeDefaultKeys = orderedDefaultKeys(plugin, type, plugin.typIndex.subtypeOf(file));
      return sortFileFrontmatter(app, file, globalOrder, typeDefaultKeys);
    }
    async function sortAllFrontmatter(app, plugin, onlyType) {
      let checked = 0;
      let changed = 0;
      const globalOrder = normalizeGlobalOrder2(plugin.settings.globalPropertyOrder);
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
    module2.exports = {
      sortAllFrontmatter,
      sortSingleFileFrontmatter,
      sortFrontmatterFor: sortFrontmatterFor2,
      placePropertyFor: placePropertyFor2,
      normalizeGlobalOrder: normalizeGlobalOrder2,
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
    var { TYP_PROPERTY: TYP_PROPERTY2, SUBTYP_PROPERTY: SUBTYP_PROPERTY2, sortAllFrontmatter } = require_frontmatter_sort();
    var PLACEHOLDER_LABELS = {
      typValue: "TYP",
      subtypValue: "SUBTYP",
      typ: "TYP-Frontmatter",
      other: "Sonstige Properties"
    };
    function mountGlobalOrderEditor(containerEl, plugin) {
      const header = containerEl.createDiv({ cls: "fred-typ-frontmatter-header" });
      const titleGroup = header.createDiv({ cls: "fred-typ-frontmatter-title-group" });
      const applyBtn = titleGroup.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Auf alle Notizen anwenden" } });
      setIcon(applyBtn, "play");
      applyBtn.addEventListener("click", async () => {
        try {
          const { checked, changed } = await sortAllFrontmatter(plugin.app, plugin, null);
          new Notice(
            changed > 0 ? `Frontmatter Sortierung: ${checked} Notizen gepr\xFCft, ${changed} sortiert.` : `Frontmatter Sortierung: ${checked} Notizen gepr\xFCft, bereits alle sortiert.`
          );
        } catch (error) {
          console.error("[Frontmatter Sortierung]", error);
          new Notice(`Frontmatter Sortierung fehlgeschlagen: ${error.message}`);
        }
      });
      titleGroup.createDiv({ cls: "fred-typ-detail-section-title", text: "Globale Property-Reihenfolge" });
      const addBtn = header.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Property hinzuf\xFCgen" } });
      setIcon(addBtn, "plus");
      const listEl = containerEl.createDiv({ cls: "fred-order-list" });
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
          const rowCls = "fred-order-row" + (isPlaceholder ? " is-placeholder" : "") + (entry.kind === "typ" ? " is-typ-defaults" : "");
          const row = listEl.createDiv({ cls: rowCls });
          const dragHandle = row.createDiv({ cls: "fred-order-drag", attr: { "aria-label": "Verschieben" } });
          setIcon(dragHandle, "grip-vertical");
          if (isPlaceholder) {
            row.createDiv({ cls: "fred-order-label", text: PLACEHOLDER_LABELS[entry.kind] });
          } else {
            const input = row.createEl("input", {
              type: "text",
              cls: "fred-order-name-input",
              attr: { placeholder: "Property-Name" }
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
                new Notice(`"${value}" ist bereits in der Liste.`);
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
            const removeBtn = row.createDiv({ cls: "fred-order-remove clickable-icon", attr: { "aria-label": "Entfernen" } });
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
        const inputs = listEl.querySelectorAll(".fred-order-name-input");
        inputs[inputs.length - 1]?.focus();
      });
      render();
    }
    module2.exports = { mountGlobalOrderEditor };
  }
});

// src/type-colors.js
var require_type_colors = __commonJS({
  "src/type-colors.js"(exports2, module2) {
    var { getSubtype: getSubtype2 } = require_subtypes();
    var DEFAULT_TYPE_COLOR = "#888888";
    var SUBTYPE_COLOR_CHANNELS = [
      { key: "h", label: "Farbton", unit: "\xB0" },
      // { key: "s", label: "Sättigung", unit: "%", downOnly: true },
      { key: "l", label: "Helligkeit", unit: "%" }
    ];
    var DEFAULT_SUBTYPE_COLOR_RANGES2 = {
      h: 35,
      /* s: 40, */
      l: 40
    };
    function colorRange(settings, key) {
      const value = Number(settings.subtypeColorRanges?.[key]);
      return Number.isFinite(value) && value >= 0 ? value : DEFAULT_SUBTYPE_COLOR_RANGES2[key];
    }
    function channelBounds(settings, key) {
      const range = colorRange(settings, key);
      return SUBTYPE_COLOR_CHANNELS.find((channel) => channel.key === key)?.downOnly ? [-range, 0] : [-range, range];
    }
    function clampedOffset(settings, offset) {
      if (!offset) return null;
      const result = {};
      for (const { key } of SUBTYPE_COLOR_CHANNELS) {
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
      return !!offset && SUBTYPE_COLOR_CHANNELS.some(({ key }) => (offset[key] ?? 0) !== 0);
    }
    function subtypeColor(settings, type, subtype) {
      const typeColor = settings.typeColors[type] ?? null;
      if (!typeColor || !subtype) return typeColor;
      const offset = clampedOffset(settings, getSubtype2(settings, type, subtype)?.color);
      return hasColorOffset(offset) ? applyColorOffset(typeColor, offset) : typeColor;
    }
    function subtypeHasOwnColor(settings, type, subtype) {
      return hasColorOffset(clampedOffset(settings, getSubtype2(settings, type, subtype)?.color));
    }
    function nameColor(settings, type, subtype = null) {
      const useSubtype = !!subtype && settings.colorViews.typListSubtyp;
      const typeColor = settings.typeColors[type] ?? null;
      return {
        color: (useSubtype ? subtypeColor(settings, type, subtype) : typeColor) ?? DEFAULT_TYPE_COLOR,
        isDefault: !typeColor || useSubtype && !subtypeHasOwnColor(settings, type, subtype)
      };
    }
    function paintColorDot(el, color, isDefault) {
      el.style.backgroundColor = isDefault ? "transparent" : color;
      el.style.boxShadow = isDefault ? `inset 0 0 0 max(1.5px, 0.15em) ${color}` : "";
    }
    function colorForFile(plugin, file, viewKey = null) {
      const type = plugin.typIndex.typeOf(file);
      if (!type) return null;
      const { settings } = plugin;
      if (!viewKey || !settings.colorViews[`${viewKey}Subtyp`]) return settings.typeColors[type] ?? null;
      return subtypeColor(settings, type, plugin.typIndex.subtypeOf(file));
    }
    module2.exports = {
      colorForFile,
      nameColor,
      DEFAULT_TYPE_COLOR,
      subtypeColor,
      applyColorOffset,
      hasColorOffset,
      subtypeHasOwnColor,
      paintColorDot,
      colorRange,
      channelBounds,
      clampedOffset,
      SUBTYPE_COLOR_CHANNELS,
      DEFAULT_SUBTYPE_COLOR_RANGES: DEFAULT_SUBTYPE_COLOR_RANGES2
    };
  }
});

// src/settings.js
var require_settings = __commonJS({
  "src/settings.js"(exports2, module2) {
    var { PluginSettingTab, SettingGroup, ToggleComponent, DropdownComponent, debounce } = require("obsidian");
    var { mountGlobalOrderEditor } = require_frontmatter_order_editor();
    var { DEFAULT_GLOBAL_ORDER } = require_frontmatter_sort();
    var { SUBTYPE_COLOR_CHANNELS, DEFAULT_SUBTYPE_COLOR_RANGES: DEFAULT_SUBTYPE_COLOR_RANGES2, colorRange } = require_type_colors();
    var DEFAULT_SETTINGS2 = {
      types: [],
      typeColors: {},
      typeDescriptions: {},
      typeDefaultFrontmatter: {},
      // Keys aus typeDefaultFrontmatter[type], die als "Floating Property" markiert
      // sind (siehe type-frontmatter-editor.js/typ-view.js) - Teil derselben Liste
      // und Reihenfolge wie die übrigen Standard-Properties des Typs (wichtig für
      // die Frontmatter-Sortierung, siehe orderedDefaultKeys in frontmatter-sort.js),
      // aber NICHT Teil des von getTypeDefaults() (main.js) standardmäßig
      // gelieferten Frontmatters - Templater legt sie beim Anlegen einer Notiz also
      // nicht automatisch an (nur über den expliziten includeFloating-Parameter).
      typeFloatingKeys: {},
      // Shortcuts je Key aus typeDefaultFrontmatter[type]:
      //   { [TYP]: { [Property]: { name: "today" | "tp.<Skriptname>" } } }
      // Bewusst NEBEN dem Frontmatter statt als dessen Wert - siehe die Begründung
      // in shortcuts.js. Der Wert der Property bleibt dadurch typrein (Obsidians
      // natives Widget bleibt unangetastet) und dient bei gesetztem Shortcut als
      // Rückfallwert, falls dessen Templater-Skript fehlschlägt.
      typeShortcuts: {},
      typeManual: {},
      // Registrierte Subtypen je TYP samt eigenem Frontmatter-Block, siehe subtypes.js.
      typeSubtypes: {},
      // Siehe frontmatter-order-editor.js / frontmatter-sort.js: Reihenfolge aus
      // fest positionierten Einzel-Properties (kind: "property") sowie den vier
      // nicht entfernbaren Platzhaltern "typValue" (TYP-Property selbst),
      // "subtypValue" (SUBTYP-Property selbst), "typ" (Standardliste des Typs)
      // und "other" (alles Übrige).
      globalPropertyOrder: DEFAULT_GLOBAL_ORDER,
      // Siehe active-title-colors.js: wie der TYP in der geöffneten Notiz markiert
      // wird - "none" (nichts), "dot" (Farbpunkt am Titel) oder "badge" (Box mit
      // TYP-Namen, weiter konfiguriert über die drei folgenden Einstellungen, die
      // nur bei "badge" überhaupt eine Rolle spielen bzw. in den Einstellungen
      // angezeigt werden). Unabhängig davon und beliebig kombinierbar:
      // colorViews.noteTitleColor färbt den Titeltext selbst ein.
      noteTitleStyle: "dot",
      // Nur relevant bei noteTitleStyle: "badge" - ob die Box farbig (TYP-Farbe)
      // oder neutral (text-muted) dargestellt wird.
      noteTitleBadgeColored: true,
      // Nur relevant bei noteTitleStyle: "badge" - Beschriftung der Box: "type"
      // ([TYP]), "type-subtype" ([TYP/Subtyp]) oder "subtype" ([Subtyp], bei
      // Notizen ohne Subtyp keine Box). Farbe (mit noteTitleBadgeColored)
      // entsprechend die des TYPs bzw. des Subtyps - bei "type-subtype" wählbar
      // über colorViews.noteTitleMarkerSubtyp ("Subtyp-Farbe").
      noteTitleBadgeLabel: "type",
      // Nur relevant bei noteTitleStyle: "badge" - "title" (neben dem Inline-Titel,
      // normale Ausrichtung) oder "block" (links am Property-Block, um 90° gedreht).
      noteTitleBadgePosition: "title",
      // Nur relevant bei noteTitleBadgePosition: "block" - ob die gedrehte Box am
      // oberen oder unteren Rand des Property-Blocks sitzt.
      noteTitleVerticalAlign: "top",
      typSortOrder: "count-desc",
      // Was in der TYP-Liste rechts neben dem Namen steht - "description",
      // "subtypes" oder "none". Umgeschaltet wird das nicht hier, sondern über den
      // Knopf im Listen-Header neben der Sortierung (siehe SECONDARY_MODES in
      // typ-view.js), wie schon die Sortierreihenfolge: beides betrifft nur das
      // Aussehen dieser einen Liste und gehört daher an sie selbst, nicht in eine
      // Einstellungsseite, die man dafür jedes Mal öffnen müsste.
      typListSecondary: "subtypes",
      // Siehe pickTypeAndSubtype in type-picker.js: false = Subtypen eingerückt
      // direkt im TYP-Picker, true = eigener Subtyp-Picker nach der TYP-Auswahl.
      separateSubtypePicker: false,
      includeIgnoredFiles: false,
      // Eigene Tag-/Anhänge-Farbe im Graph deaktiviert (30.09.2026): beides ist in
      // den Style Settings des Minimal Theme einstellbar, siehe graph-colors.js.
      // graphTagColorEnabled: false,
      // graphTagColor: "",
      // graphAttachmentColorEnabled: false,
      // graphAttachmentColor: "",
      // Wie weit die Farbe eines Subtyps höchstens von der seines TYPs abweichen
      // darf (±), siehe type-colors.js: Farbton in Grad, Helligkeit in % des Wegs
      // zu Weiß bzw. Schwarz.
      subtypeColorRanges: { ...DEFAULT_SUBTYPE_COLOR_RANGES2 },
      colorViews: {
        fileExplorer: true,
        graph: true,
        search: true,
        recentFiles: true,
        backlinks: true,
        bookmarks: true,
        // Unter-Schalter "<Ansicht>Subtyp" der Einfärbungen: Farbe des Subtyps
        // einer Notiz statt der ihres TYPs (siehe colorForFile in type-colors.js).
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
        // Unter-Schalter zu frontmatterDefaults bzw. allProperties: bezieht die
        // Frontmatter-Blöcke der Subtypen mit ein (siehe
        // frontmatter-default-highlight.js) - bei allProperties zugleich in der
        // Farbe des jeweiligen Subtyps.
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
      // Jeder Abschnitt ist eine SettingGroup - Obsidians eigene Gruppierung
      // (Überschrift + eine Box, Einträge darin durch Trennlinien getrennt), wie
      // in den Core-Einstellungen. Einzeln per new Setting(containerEl) angelegte
      // Einträge würden stattdessen je als eigene kleine Box gerendert.
      display() {
        const { containerEl } = this;
        const { scrollTop } = containerEl;
        containerEl.empty();
        new SettingGroup(containerEl).setHeading("TYP-Liste").addSetting(
          (setting) => setting.setName("Ignorierte Notizen IMMER ber\xFCcksichtigen").setDesc(
            'Bezieht Notizen aus Obsidians "Excluded files"-Liste (dort tragen auch Plugins wie Hide Folders ausgeblendete Ordner ein) wieder in TYP-Z\xE4hler, TYP-Picker und die Frontmatter-Sortierung mit ein, statt sie zu \xFCberspringen.'
          ).addToggle(
            (toggle) => toggle.setValue(this.plugin.settings.includeIgnoredFiles).onChange(async (value) => {
              this.plugin.settings.includeIgnoredFiles = value;
              await this.plugin.saveSettings();
              this.plugin.refreshTypColors?.();
            })
          )
        );
        new SettingGroup(containerEl).setHeading("TYP-Picker").addSetting(
          (setting) => setting.setName("Subtyp-Picker separat").setDesc(
            "Beim Anlegen einer Notiz folgt auf den TYP-Picker ein eigener Subtyp-Picker (ESC dort f\xFChrt zur\xFCck zur TYP-Auswahl), statt die Subtypen direkt einger\xFCckt unter ihrem TYP im TYP-Picker anzuzeigen. Der TYP-Picker nennt die Subtypen dann hinter dem TYP-Namen."
          ).addToggle(
            (toggle) => toggle.setValue(this.plugin.settings.separateSubtypePicker).onChange(async (value) => {
              this.plugin.settings.separateSubtypePicker = value;
              await this.plugin.saveSettings();
            })
          )
        );
        const colorViewToggle = (group, key, name, desc, subtypKey = null, { typTooltip = "Nach TYP-Farbe einf\xE4rben", subtypTooltip = "Farbe des Subtyps statt der des TYPs verwenden" } = {}) => group.addSetting((setting) => {
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
          setting.settingEl.addClass("fred-note-title-setting");
          const addRow = (label, tooltip, settingKey, onChanged) => {
            const row = setting.controlEl.createDiv({ cls: "fred-note-title-toggle-row" });
            row.createSpan({ cls: "fred-note-title-toggle-label", text: label });
            new ToggleComponent(row).setTooltip(tooltip).setValue(this.plugin.settings.colorViews[settingKey]).onChange(async (value) => {
              await save(settingKey, value);
              onChanged?.();
            });
          };
          addRow("TYP", typTooltip, key, () => this.display());
          if (this.plugin.settings.colorViews[key]) addRow("Subtyp", subtypTooltip, subtypKey);
        });
        const coloringGroup = new SettingGroup(containerEl).setHeading("Einf\xE4rbung");
        colorViewToggle(coloringGroup, "fileExplorer", "Datei-Explorer", "Notiznamen im Datei-Explorer nach TYP einf\xE4rben.", "fileExplorerSubtyp");
        colorViewToggle(coloringGroup, "graph", "Graph", "Knoten im Graph (global und lokal) nach TYP einf\xE4rben.", "graphSubtyp");
        colorViewToggle(coloringGroup, "search", "Suche", "Treffer-Titel in der Suche nach TYP einf\xE4rben.", "searchSubtyp");
        colorViewToggle(coloringGroup, "recentFiles", "Recent Files", "Eintr\xE4ge im Recent-Files-Plugin nach TYP einf\xE4rben.", "recentFilesSubtyp");
        colorViewToggle(
          coloringGroup,
          "links",
          "Links in Notizen",
          "Interne Links im Notiztext (Lese-Modus, Live Preview, Hover-Vorschau) in der Farbe des TYPs ihres Ziels darstellen. Nicht aufgel\xF6ste Links bleiben unver\xE4ndert.",
          "linksSubtyp"
        );
        colorViewToggle(
          coloringGroup,
          "typList",
          "TYP View",
          'Typ-Namen in der TYP-View selbst (Liste und Detailansicht) und im TYP-Picker in ihrer jeweiligen Farbe darstellen. Mit "Subtyp" auch die Subtypen in ihrer eigenen Farbe.',
          "typListSubtyp"
        );
        colorViewToggle(
          coloringGroup,
          "noteTitleColor",
          "Titel-Text einf\xE4rben",
          "F\xE4rbt den Inline-Titel der ge\xF6ffneten Notiz selbst in der Farbe ihres TYPs ein - unabh\xE4ngig von der TYP-Markierung daneben (s. u.), beides l\xE4sst sich kombinieren.",
          "noteTitleColorSubtyp"
        );
        const isBadge = this.plugin.settings.noteTitleStyle === "badge";
        const isBlockPosition = this.plugin.settings.noteTitleBadgePosition === "block";
        coloringGroup.addSetting((noteTitleSetting) => {
          noteTitleSetting.setName("TYP-Markierung in der Notiz").setDesc(
            isBadge ? '"Box mit TYP-Namen" - Beschriftung, Schalter: farbig/neutral, am Titel/am Property-Block (gedreht)' + (isBlockPosition ? ", oben/unten am Property-Block" : "") + "." : "Wie der TYP in der ge\xF6ffneten Notiz markiert wird."
          ).addDropdown(
            (dropdown) => dropdown.addOption("none", "Nichts").addOption("dot", "Farbpunkt am Titel").addOption("badge", "Box mit TYP-Namen").setValue(this.plugin.settings.noteTitleStyle).onChange(async (value) => {
              this.plugin.settings.noteTitleStyle = value;
              await this.plugin.saveSettings();
              this.plugin.refreshTypColors?.();
              this.display();
            })
          );
          const badgeLabel = this.plugin.settings.noteTitleBadgeLabel ?? "type";
          const showSubtyp = this.plugin.settings.noteTitleStyle === "dot" || isBadge && this.plugin.settings.noteTitleBadgeColored && badgeLabel === "type-subtype";
          if (!isBadge && !showSubtyp) return;
          noteTitleSetting.settingEl.addClass("fred-note-title-setting");
          const addLabeledToggle = (label, tooltip, value, onChange) => {
            const row = noteTitleSetting.controlEl.createDiv({ cls: "fred-note-title-toggle-row" });
            row.createSpan({ cls: "fred-note-title-toggle-label", text: label });
            new ToggleComponent(row).setTooltip(tooltip).setValue(value).onChange(onChange);
          };
          const addSubtypToggle = (label) => addLabeledToggle(
            label,
            "Farbe des Subtyps statt der des TYPs verwenden",
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
          const labelRow = noteTitleSetting.controlEl.createDiv({ cls: "fred-note-title-toggle-row" });
          labelRow.createSpan({ cls: "fred-note-title-toggle-label", text: "Beschriftung" });
          new DropdownComponent(labelRow).addOption("type", "[TYP]").addOption("type-subtype", "[TYP/Subtyp]").addOption("subtype", "[Subtyp]").setValue(badgeLabel).onChange(async (value) => {
            this.plugin.settings.noteTitleBadgeLabel = value;
            await this.plugin.saveSettings();
            this.plugin.refreshTypColors?.();
            this.display();
          });
          addLabeledToggle("Farbig", "Farbig (TYP-Farbe) statt neutral", this.plugin.settings.noteTitleBadgeColored, async (value) => {
            this.plugin.settings.noteTitleBadgeColored = value;
            await this.plugin.saveSettings();
            this.plugin.refreshTypColors?.();
            this.display();
          });
          if (showSubtyp) addSubtypToggle("Subtyp-Farbe");
          addLabeledToggle("Am Property-Block", "Am Property-Block (gedreht) statt am Titel", isBlockPosition, async (value) => {
            this.plugin.settings.noteTitleBadgePosition = value ? "block" : "title";
            await this.plugin.saveSettings();
            this.plugin.refreshTypColors?.();
            this.display();
          });
          if (isBlockPosition) {
            addLabeledToggle(
              "Oben statt unten",
              "Oben statt unten am Property-Block",
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
          "Trefferzeilen im Backlinks-Pane sowie in den im Dokument eingebetteten Backlinks (inkl. nicht verlinkter Erw\xE4hnungen) nach TYP einf\xE4rben.",
          "backlinksSubtyp"
        );
        colorViewToggle(
          coloringGroup,
          "bookmarks",
          "Bookmarks",
          "Eintr\xE4ge im Bookmarks-Pane, die direkt auf eine Notiz zeigen, nach TYP einf\xE4rben.",
          "bookmarksSubtyp"
        );
        colorViewToggle(
          coloringGroup,
          "allProperties",
          "All Properties",
          'In Obsidians vault-weiter "All Properties"-Ansicht Property-Namen einf\xE4rben, die im TYP-Frontmatter genau eines TYPs vorkommen (in dessen Farbe) - kommen sie bei mehreren TYPs vor, stattdessen fett statt eingef\xE4rbt. Mit "Subtyp" z\xE4hlen auch die Frontmatter-Bl\xF6cke der Subtypen f\xFCr ihren jeweiligen TYP, eingef\xE4rbt in der Farbe des Subtyps.',
          "allPropertiesSubtyp",
          { typTooltip: "TYP-Frontmatter der TYPen", subtypTooltip: "Frontmatter-Bl\xF6cke der Subtypen mit einbeziehen, in Subtyp-Farbe" }
        );
        const subtypeColorGroup = new SettingGroup(containerEl).setHeading("Subtyp-Farben");
        const rangeMax = {
          h: 180,
          /* s: 100, */
          l: 100
        };
        const rangeDesc = {
          h: "Wie weit der Farbton eines Subtyps h\xF6chstens von dem seines TYPs abweichen darf (\xB1 Grad).",
          // s: "Wie blass ein Subtyp gegenüber seinem TYP höchstens werden darf (Prozent der TYP-Sättigung). Der Regler geht nur nach unten - kräftiger als die Hauptfarbe soll ein Subtyp nicht werden.",
          l: "Wie weit die Helligkeit eines Subtyps h\xF6chstens von der seines TYPs abweichen darf (\xB1 Prozent des Wegs zu Wei\xDF bzw. Schwarz - 100 % w\xE4re reines Wei\xDF bzw. Schwarz)."
        };
        const refreshColorsSoon = debounce(() => this.plugin.refreshTypColors?.(), 300, true);
        for (const { key, label, unit, downOnly } of SUBTYPE_COLOR_CHANNELS) {
          subtypeColorGroup.addSetting(
            (setting) => setting.setName(`${label} (${downOnly ? "\u2212" : "\xB1"} ${unit})`).setDesc(rangeDesc[key]).addSlider(
              (slider) => slider.setLimits(0, rangeMax[key], 1).setValue(colorRange(this.plugin.settings, key)).setDynamicTooltip().onChange(async (value) => {
                this.plugin.settings.subtypeColorRanges = { ...DEFAULT_SUBTYPE_COLOR_RANGES2, ...this.plugin.settings.subtypeColorRanges, [key]: value };
                await this.plugin.saveSettings();
                refreshColorsSoon();
              })
            ).addExtraButton(
              (button) => button.setIcon("rotate-ccw").setTooltip(`Zur\xFCcksetzen auf ${DEFAULT_SUBTYPE_COLOR_RANGES2[key]}`).onClick(async () => {
                this.plugin.settings.subtypeColorRanges = { ...DEFAULT_SUBTYPE_COLOR_RANGES2, ...this.plugin.settings.subtypeColorRanges, [key]: DEFAULT_SUBTYPE_COLOR_RANGES2[key] };
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
          "Property-Namen fett markieren",
          'In Notizen (Frontmatter im Dokument sowie Properties-Seitenleiste) die Namen der Properties fett darstellen, die im TYP-Frontmatter des jeweiligen TYPs hinterlegt sind. Mit "Subtyp" zus\xE4tzlich die aus dem Frontmatter-Block ihres SUBTYPs.',
          "frontmatterDefaultsSubtyp",
          { typTooltip: "TYP-Frontmatter der TYPen", subtypTooltip: "Frontmatter-Bl\xF6cke der Subtypen mit einbeziehen" }
        );
        frontmatterGroup.addSetting((setting) => {
          setting.settingEl.addClass("fred-order-setting");
          mountGlobalOrderEditor(setting.infoEl, this.plugin);
          setting.infoEl.createDiv({
            cls: "setting-item-description",
            text: 'Bestimmt die Reihenfolge, in der die Befehle "Frontmatter Sortierung aktualisieren" die in einer Notiz vorhandenen Properties anordnen (erg\xE4nzt oder \xE4ndert keine Werte). Einzelne Properties (z. B. cssclasses, aliases) lassen sich fest platzieren - "TYP" ist die TYP-Property selbst, "SUBTYP" analog die SUBTYP-Property, "TYP-Frontmatter" steht f\xFCr die TYP-Frontmatter-Liste des jeweiligen Typs samt dahinter dem Block seines SUBTYPs, "Sonstige Properties" f\xFCr alles \xDCbrige. Reihenfolge per Drag & Drop \xE4nderbar, die vier Platzhalter-Zeilen lassen sich nicht entfernen.'
          });
        });
        containerEl.scrollTop = scrollTop;
      }
    };
    module2.exports = { DEFAULT_SETTINGS: DEFAULT_SETTINGS2, TypSystemSettingTab: TypSystemSettingTab2 };
  }
});

// src/commands.js
var require_commands = __commonJS({
  "src/commands.js"(exports2, module2) {
    var { Notice } = require("obsidian");
    var { sortAllFrontmatter, sortSingleFileFrontmatter } = require_frontmatter_sort();
    function registerCommands2(plugin) {
      const runOrReportError = (label, fn) => async () => {
        try {
          await fn();
        } catch (error) {
          console.error(`[${label}]`, error);
          new Notice(`${label} fehlgeschlagen: ${error.message}`);
        }
      };
      plugin.addCommand({
        id: "frontmatter-sortierung-alle",
        name: "Frontmatter Sortierung GLOBAL aktualisieren",
        callback: runOrReportError("Frontmatter Sortierung", async () => {
          const { checked, changed } = await sortAllFrontmatter(plugin.app, plugin, null);
          new Notice(
            changed > 0 ? `Frontmatter Sortierung: ${checked} Notizen gepr\xFCft, ${changed} sortiert.` : `Frontmatter Sortierung: ${checked} Notizen gepr\xFCft, bereits alle sortiert.`
          );
        })
      });
      plugin.addCommand({
        id: "frontmatter-sortierung-typ",
        name: "Frontmatter Sortierung f\xFCr TYP aktualisieren",
        callback: runOrReportError("Frontmatter Sortierung", async () => {
          const type = await plugin.pickType({ includeManualOff: true, includeUnregistered: true });
          if (!type) return;
          const { checked, changed, hasTypeDefaults } = await sortAllFrontmatter(plugin.app, plugin, type);
          let message = changed > 0 ? `Frontmatter Sortierung ${type}: ${checked} Notizen gepr\xFCft, ${changed} sortiert.` : `Frontmatter Sortierung ${type}: ${checked} Notizen gepr\xFCft, bereits alle sortiert.`;
          if (hasTypeDefaults === false) {
            message += ` Hinweis: F\xFCr ${type} ist kein TYP-Frontmatter hinterlegt - nur die globale Reihenfolge wurde angewendet.`;
          }
          new Notice(message);
        })
      });
      plugin.addCommand({
        id: "frontmatter-sortierung-aktive-notiz",
        name: "Frontmatter Sortierung der aktiven Notiz aktualisieren",
        checkCallback: (checking) => {
          const file = plugin.app.workspace.getActiveFile();
          if (!file || file.extension !== "md") return false;
          if (checking) return true;
          runOrReportError("Frontmatter Sortierung", async () => {
            const changed = await sortSingleFileFrontmatter(plugin.app, plugin, file);
            new Notice(changed ? `Frontmatter von "${file.basename}" sortiert.` : `Frontmatter von "${file.basename}" war bereits sortiert.`);
          })();
          return true;
        }
      });
    }
    module2.exports = { registerCommands: registerCommands2 };
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
        // Anders als today/now nicht der Aufrufzeitpunkt, sondern das
        // Erstellungsdatum der jeweiligen Datei (file.stat.ctime) - braucht daher
        // die Ziel-Datei als Kontext (file-Parameter, von getTypeDefaults
        // durchgereicht). Ohne Datei Fallback auf den aktuellen Zeitpunkt.
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
      const werte = Object.values(record.args ?? {}).filter((value) => value !== void 0);
      return werte.length > 0 ? `${record.name}: ${werte.join(", ")}` : record.name;
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
    function buildArgs(params, eingaben) {
      const args = {};
      for (const name of inputParams(params)) {
        const value = parseArgValue(eingaben[name]);
        if (value !== void 0) args[name] = value;
      }
      return args;
    }
    function resolveCallArgs2(params, args, reserved = {}) {
      if (params === null || params === void 0) return [reserved.newFile, reserved.ctx];
      const werte = [];
      const objektPosition = /* @__PURE__ */ new Map();
      for (const name of params) {
        if (name === "tp") continue;
        if (RESERVED_PARAMS.includes(name)) {
          werte.push(reserved[name]);
          continue;
        }
        const punkt = name.indexOf(".");
        if (punkt === -1) {
          werte.push(args?.[name]);
          continue;
        }
        const basis = name.slice(0, punkt);
        if (!objektPosition.has(basis)) {
          objektPosition.set(basis, werte.length);
          werte.push({});
        }
        const wert = args?.[name];
        if (wert !== void 0) werte[objektPosition.get(basis)][name.slice(punkt + 1)] = wert;
      }
      return werte;
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
      // Fuzzy-Suche greift auch auf die Beschreibung, nicht nur auf den Namen -
      // "Erstellungsdatum" findet so auch "created".
      getItemText(item) {
        const label = itemLabel(item);
        return item.description ? `${label} ${item.description}` : label;
      }
      renderSuggestion(match, el) {
        const item = match.item;
        el.addClass("fred-typ-shortcut-suggestion");
        el.createEl("code", { cls: "fred-typ-shortcut-suggestion-name", text: itemLabel(item) });
        if (item.description) el.createSpan({ cls: "fred-typ-shortcut-suggestion-desc", text: item.description });
      }
      // Siehe TypPickerModal in type-picker.js: Obsidians selectSuggestion() ruft
      // erst close() und danach erst onChooseItem() - "chosen" muss deshalb schon
      // hier gesetzt werden, sonst löst das von close() ausgelöste onClose() das
      // Promise vorzeitig mit null auf und die eigentliche Auswahl geht verloren.
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
      constructor(app, item, vorhandene, resolve) {
        super(app);
        this.item = item;
        this.resolve = resolve;
        this.felder = inputParams(item.params);
        this.eingaben = {};
        for (const name of this.felder) {
          const wert = vorhandene?.[name];
          this.eingaben[name] = wert === void 0 || wert === null ? "" : String(wert);
        }
        this.bestaetigt = false;
      }
      onOpen() {
        this.titleEl.setText(`Argumente f\xFCr ${this.item.name}`);
        if (this.item.description) {
          this.contentEl.createDiv({ cls: "fred-typ-shortcut-args-desc", text: this.item.description });
        }
        for (const name of this.felder) {
          new Setting(this.contentEl).setName(name).addText(
            (text) => text.setValue(this.eingaben[name]).onChange((value) => {
              this.eingaben[name] = value;
            }).inputEl.addEventListener("keydown", (event) => {
              if (event.key === "Enter" && !event.isComposing) {
                event.preventDefault();
                this.uebernehmen();
              }
            })
          );
        }
        new Setting(this.contentEl).addButton(
          (button) => button.setButtonText("\xDCbernehmen").setCta().onClick(() => this.uebernehmen())
        );
      }
      uebernehmen() {
        this.bestaetigt = true;
        this.close();
      }
      onClose() {
        this.contentEl.empty();
        this.resolve(this.bestaetigt ? buildArgs(this.felder, this.eingaben) : null);
      }
    };
    async function pickShortcut(app, key, getScripts, vorhanden = null) {
      const items = [
        ...FIXED_SHORTCUTS.map(({ name, description }) => ({ name, description, params: null })),
        ...getScripts().map(({ name, params, description }) => ({ name: SCRIPT_PREFIX + name, params, description }))
      ];
      const item = await new Promise((resolve) => new ShortcutPickerModal(app, key, items, resolve).open());
      if (!item) return null;
      if (inputParams(item.params).length === 0) return { name: item.name };
      const vorbelegung = vorhanden?.name === item.name ? vorhanden.args : null;
      const args = await new Promise((resolve) => new ShortcutArgsModal(app, item, vorbelegung, resolve).open());
      if (args === null) return null;
      return Object.keys(args).length > 0 ? { name: item.name, args } : { name: item.name };
    }
    module2.exports = { pickShortcut };
  }
});

// src/type-frontmatter-editor.js
var require_type_frontmatter_editor = __commonJS({
  "src/type-frontmatter-editor.js"(exports2, module2) {
    var { MarkdownView, Menu, setIcon } = require("obsidian");
    var { shortcutLabel } = require_shortcuts();
    var { pickShortcut } = require_shortcut_picker();
    var { getSubtype: getSubtype2, ensureSubtype } = require_subtypes();
    var EDITOR_CLASS = "fred-typ-frontmatter-editor";
    var TYP_PROPERTY2 = "TYP";
    var SUBTYP_PROPERTY2 = "SUBTYP";
    var SYSTEM_PROPERTIES = [TYP_PROPERTY2.toLowerCase(), SUBTYP_PROPERTY2.toLowerCase()];
    function stripTypProperty(frontmatter) {
      for (const key of Object.keys(frontmatter)) {
        if (SYSTEM_PROPERTIES.includes(key.trim().toLowerCase())) delete frontmatter[key];
      }
      return frontmatter;
    }
    function typeStore(plugin, type) {
      return {
        type,
        subtype: null,
        getFrontmatter: () => plugin.settings.typeDefaultFrontmatter[type] ?? {},
        setFrontmatter: (frontmatter) => {
          plugin.settings.typeDefaultFrontmatter[type] = frontmatter;
        },
        getFloating: () => plugin.settings.typeFloatingKeys[type] ?? [],
        setFloating: (keys) => {
          if (keys.length > 0) plugin.settings.typeFloatingKeys[type] = keys;
          else delete plugin.settings.typeFloatingKeys[type];
        },
        getShortcuts: () => plugin.settings.typeShortcuts[type] ?? {},
        setShortcuts: (shortcuts) => {
          if (Object.keys(shortcuts).length > 0) plugin.settings.typeShortcuts[type] = shortcuts;
          else delete plugin.settings.typeShortcuts[type];
        }
      };
    }
    function subtypeStore(plugin, type, subtype) {
      return {
        type,
        subtype,
        getFrontmatter: () => getSubtype2(plugin.settings, type, subtype)?.frontmatter ?? {},
        setFrontmatter: (frontmatter) => {
          ensureSubtype(plugin.settings, type, subtype).frontmatter = frontmatter;
        },
        getFloating: () => getSubtype2(plugin.settings, type, subtype)?.floatingKeys ?? [],
        setFloating: (keys) => {
          ensureSubtype(plugin.settings, type, subtype).floatingKeys = keys;
        },
        getShortcuts: () => getSubtype2(plugin.settings, type, subtype)?.shortcuts ?? {},
        setShortcuts: (shortcuts) => {
          ensureSubtype(plugin.settings, type, subtype).shortcuts = shortcuts;
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
      return null;
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
    function ensurePropertyMenuPatch(app, editor) {
      const RowClass = getPropertyRowClass(app, editor);
      if (!RowClass || RowClass._fredMenuPatched) return;
      RowClass._fredMenuPatched = true;
      const originalShowPropertyMenu = RowClass.prototype.showPropertyMenu;
      RowClass.prototype.showPropertyMenu = function(event) {
        const owner = this.metadataEditor?.owner;
        if (!owner?.fredStore) return originalShowPropertyMenu.call(this, event);
        const row = this;
        const originalShowAtMouseEvent = Menu.prototype.showAtMouseEvent;
        Menu.prototype.showAtMouseEvent = function(mouseEvent) {
          Menu.prototype.showAtMouseEvent = originalShowAtMouseEvent;
          const isFloating = owner.fredStore.getFloating().includes(row.entry.key);
          this.addItem(
            (item) => item.setTitle("Floating").setIcon("pin-off").setChecked(isFloating).setSection("title").onClick(() => toggleFloatingProperty(owner.fredView, owner.fredStore, row.entry.key))
          );
          return originalShowAtMouseEvent.call(this, mouseEvent);
        };
        return originalShowPropertyMenu.call(this, event);
      };
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
          cls: "fred-typ-frontmatter-unavailable",
          text: "Zum Initialisieren des Editors bitte zuerst einmal eine Notiz \xF6ffnen."
        });
        return null;
      }
      const owner = {
        app,
        // Marker für ensurePropertyMenuPatch() oben: identifiziert Property-
        // Zeilen dieses Plugin-eigenen Editors (nie einer echten Notiz) und
        // liefert Speicherort/View, die der globale Menü-Patch pro Zeile
        // dynamisch braucht (die Patch-Installation selbst passiert nur einmal,
        // unabhängig davon, welcher Block dabei gerade offen war).
        fredStore: store,
        fredView: view,
        getFile() {
          return null;
        },
        // Nur für Obsidians Hover-Preview bei internen Links innerhalb eines
        // Property-Werts (Event "hover-link") - beliebiger String reicht.
        getHoverSource() {
          return "fred-typ-frontmatter";
        },
        shiftFocusBefore() {
        },
        shiftFocusAfter() {
        },
        // Obsidians Editor ruft dies genau einmal pro abgeschlossener Änderung auf
        // (Rename erst beim Blur des Key-Inputs, siehe handleUpdateKey im
        // gebauten app.js) - jeder Aufruf trägt hier also maximal eine
        // hinzugefügte und/oder entfernte (nicht-leere) Property, nie mehrere
        // gleichzeitig außer bei einem Mehrfach-Löschen. Das macht die
        // Floating-Markierung unten robust nachführbar, ohne Zwischenzustände
        // während des Tippens verfolgen zu müssen.
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
            if (editor.fredPendingFloatingAdd && addedKeys.length === 1) {
              floating = [...floating, addedKeys[0]];
              editor.fredPendingFloatingAdd = false;
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
      editor.fredPendingFloatingAdd = false;
      if (onShiftFocus) registerFocusChain(editor, onShiftFocus);
      editor.containerEl.addClass(EDITOR_CLASS);
      containerEl.appendChild(editor.containerEl);
      view.addChild(editor);
      const defaults = store.getFrontmatter();
      const hadTyp = Object.keys(defaults).some((key) => SYSTEM_PROPERTIES.includes(key.trim().toLowerCase()));
      stripTypProperty(defaults);
      if (hadTyp) view.plugin.saveSettings();
      editor.synchronize(defaults);
      renderShortcutControls(view, editor, store);
      ensurePropertyMenuPatch(app, editor);
      return editor;
    }
    var CHIP_CLASS = "fred-typ-shortcut-chip";
    var CHIP_TEXT_CLASS = "fred-typ-shortcut-chip-text";
    var BUTTON_CLASS = "fred-typ-shortcut-button";
    var ROW_CLASS = "fred-typ-has-shortcut";
    var WARNING_CLASS = "fred-typ-shortcut-blocked";
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
        renderShortcutControls(editor.owner.fredView, editor, editor.owner.fredStore);
      }
      editor.focusKey("");
      ensurePropertyMenuPatch(editor.owner.app, editor);
    }
    module2.exports = { mountFrontmatterEditor, addBlankProperty, ensurePropertyMenuPatch, typeStore, subtypeStore };
  }
});

// src/frontmatter-blocks.js
var require_frontmatter_blocks = __commonJS({
  "src/frontmatter-blocks.js"(exports2, module2) {
    var { mountFrontmatterEditor, addBlankProperty, typeStore, subtypeStore } = require_type_frontmatter_editor();
    var { getSectionOrder, isEmptyValue } = require_subtypes();
    function isGrabTarget(target) {
      if (target.closest(".clickable-icon, .fred-typ-subtype-color-dot, [contenteditable='true'], input, textarea")) return false;
      return !target.closest(".metadata-property");
    }
    function mountFrontmatterBlocks(view, containerEl, type, { renderHeader, renderFooter, onMoveSection, onSectionContextMenu }) {
      const wrapper = containerEl.createDiv({ cls: "fred-typ-blocks" });
      const sections = getSectionOrder(view.plugin.settings, type);
      const editors = /* @__PURE__ */ new Map();
      const blockEls = /* @__PURE__ */ new Map();
      const stores = /* @__PURE__ */ new Map();
      const api = {
        // Alle Editor-Instanzen in Block-Reihenfolge - typ-view.js hängt sie als
        // Component-Children ein und baut sie vor jedem Neuaufbau wieder ab.
        editors: [],
        // Leerzeile am Ende des gewünschten Blocks anlegen, mit dem Fokus im
        // Key-Feld (siehe addBlankProperty in type-frontmatter-editor.js).
        // floating markiert die als nächstes benannte Property als Floating.
        addBlank(section, floating = false) {
          const editor = editors.get(section);
          if (!editor) return;
          editor.fredPendingFloatingAdd = floating;
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
          cls: "fred-typ-block" + (isSub ? " fred-typ-frontmatter-block fred-typ-subtype-block" : "")
        });
        blockEls.set(section, blockEl);
        blockEl.fredSection = section;
        const header = blockEl.createDiv({ cls: "fred-typ-frontmatter-header fred-typ-section-header" });
        header.toggleClass("fred-typ-section-sub", isSub);
        const store = section === null ? typeStore(view.plugin, type) : subtypeStore(view.plugin, type, section);
        stores.set(section, store);
        const editor = mountFrontmatterEditor(view, blockEl, store, {
          onShiftFocus: (step) => focusNeighbor(section, step)
        });
        if (editor) {
          editors.set(section, editor);
          api.editors.push(editor);
        }
        const footer = blockEl.createDiv({ cls: "fred-typ-section-footer" });
        footer.toggleClass("fred-typ-section-sub", isSub);
        renderHeader(section, header, api);
        renderFooter?.(section, footer, api);
        if (!isSub) continue;
        blockEl.addEventListener("contextmenu", (event) => {
          if (event.defaultPrevented || event.target.closest("input, textarea, [contenteditable='true']")) return;
          event.preventDefault();
          onSectionContextMenu?.(section, event);
        });
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
            wrapper.doc.body.addClass("fred-typ-block-dragging");
            win.getSelection()?.removeAllRanges();
            blockEls.get(section).addClass("is-dragging");
            measure();
            indicator = wrapper.createDiv({ cls: "fred-typ-block-drop-indicator" });
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
          wrapper.doc.body.removeClass("fred-typ-block-dragging");
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
            const section = rowEl?.closest(".fred-typ-block")?.fredSection;
            const editor = section === void 0 ? null : editors.get(section);
            const key = editor?.rendered.find((row) => row.containerEl === rowEl)?.entry.key;
            if (!key) return;
            drag = {
              section,
              key,
              rowEl,
              // Jetzt schon gemessen: sobald die Zeile für den Platzhalter
              // ausgeblendet ist, liefert offsetHeight 0.
              height: rowEl.offsetHeight,
              spacer: editor.propertyListEl.createDiv({ cls: "fred-typ-drag-spacer" }),
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
            drag.placeholder = createDiv({ cls: "metadata-property drag-ghost-hidden fred-typ-drag-placeholder" });
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

// src/type-utils.js
var require_type_utils = __commonJS({
  "src/type-utils.js"(exports2, module2) {
    function normalizeTypeName(raw) {
      return raw.trim().toUpperCase();
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
    function compareTypes(mode, a, b, counts, typeColors) {
      const [key, dir] = mode.split("-");
      let cmp;
      if (key === "count") {
        cmp = (counts.get(a) ?? 0) - (counts.get(b) ?? 0);
        if (dir === "desc") cmp = -cmp;
      } else if (key === "color") {
        const hueA = hexToHue(typeColors[a] ?? null);
        const hueB = hexToHue(typeColors[b] ?? null);
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
    function sortTypesByMode2(types, mode, counts, typeColors) {
      if (mode === "manual") return [...types];
      return [...types].sort((a, b) => compareTypes(mode, a, b, counts, typeColors));
    }
    module2.exports = { normalizeTypeName, hexToHue, compareTypes, sortTypesByMode: sortTypesByMode2 };
  }
});

// src/typ-view.js
var require_typ_view = __commonJS({
  "src/typ-view.js"(exports2, module2) {
    var { ItemView, Menu, Modal, Notice, setIcon, debounce } = require("obsidian");
    var { mountFrontmatterBlocks } = require_frontmatter_blocks();
    var {
      normalizeSubtypeName,
      getSubtypeNames: getSubtypeNames2,
      ensureSubtype,
      moveTypeSubtypes,
      deleteTypeSubtypes,
      mergeTypeSubtypes,
      getSubtype: getSubtype2,
      renameSubtype,
      reorderSubtypes,
      deleteSubtype,
      mergeSubtypes,
      renameSubtypeInNotes
    } = require_subtypes();
    var { normalizeTypeName, compareTypes, sortTypesByMode: sortTypesByMode2 } = require_type_utils();
    var { typeKeyOf, propertyValue, setCanonicalProperty: setCanonicalProperty2, TYP_PROPERTY: TYP_PROPERTY2, SUBTYP_PROPERTY: SUBTYP_PROPERTY2 } = require_typ_index();
    var {
      subtypeColor,
      applyColorOffset,
      hasColorOffset,
      subtypeHasOwnColor,
      paintColorDot,
      nameColor,
      channelBounds,
      clampedOffset,
      SUBTYPE_COLOR_CHANNELS,
      DEFAULT_TYPE_COLOR
    } = require_type_colors();
    var VIEW_TYPE_TYP = "fred-typ-view";
    var DEFAULT_SORT_ORDER2 = "count-desc";
    var DEFAULT_SECONDARY = "subtypes";
    var SECONDARY_MODES = [
      { mode: "subtypes", title: "Subtypen", icon: "list-tree" },
      { mode: "description", title: "Beschreibung", icon: "text-cursor-input" },
      { mode: "none", title: "Nichts", icon: "minus" }
    ];
    var SORT_OPTIONS = [
      // Nutzt (anders als die übrigen Modi) keinen eigenen Vergleich, sondern die
      // Reihenfolge von plugin.settings.types selbst als Speicherort - siehe
      // render() und renderRegisteredItem() für das per Drag & Drop verschiebbare
      // Rendern, das genau darauf aufbaut. Bewusst als erste Option (siehe
      // showSortMenu) - eigene, oberste Gruppe im Menü statt einsortiert zwischen
      // die eigentlichen Sortierkriterien.
      { mode: "manual", title: "Manuell (Drag & Drop)" },
      { mode: "count-desc", title: "H\xE4ufigkeit (absteigend)" },
      { mode: "count-asc", title: "H\xE4ufigkeit (aufsteigend)" },
      { mode: "name-asc", title: "Name (A bis Z)" },
      { mode: "name-desc", title: "Name (Z bis A)" },
      { mode: "color-asc", title: "Farbe (Rot \u2192 Violett)" },
      { mode: "color-desc", title: "Farbe (Violett \u2192 Rot)" }
    ];
    async function renameTypeInNotes(plugin, oldKey, newValue) {
      let changed = 0;
      for (const file of plugin.typIndex.filesWithType(oldKey)) {
        let matched = false;
        await plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
          if (typeKeyOf(propertyValue(frontmatter, TYP_PROPERTY2)) !== oldKey) return;
          setCanonicalProperty2(frontmatter, TYP_PROPERTY2, newValue);
          matched = true;
        });
        if (matched) changed++;
      }
      return changed;
    }
    function normalizeRawType(raw, normalize = normalizeTypeName) {
      if (Array.isArray(raw)) {
        return raw.map((v) => normalize(String(v ?? ""))).filter(Boolean).join(", ");
      }
      return normalize(String(raw));
    }
    function displayTypeKey(typeKey) {
      return typeKey !== typeKey.trim() ? `"${typeKey}"` : typeKey;
    }
    function appendTypeName(parentEl, plugin, type, color) {
      if (plugin.settings.colorViews.typList) {
        const nameEl = parentEl.createSpan({ cls: "fred-typ-inline-name", text: type });
        if (color) nameEl.style.color = color;
      } else {
        paintColorDot(parentEl.createSpan({ cls: "fred-typ-inline-dot" }), color ?? DEFAULT_TYPE_COLOR, !color);
        parentEl.createSpan({ cls: "fred-typ-inline-name", text: type });
      }
    }
    var ConfirmDeleteTypeModal = class extends Modal {
      constructor(plugin, type, onConfirm) {
        super(plugin.app);
        this.plugin = plugin;
        this.type = type;
        this.onConfirm = onConfirm;
      }
      onOpen() {
        const { contentEl } = this;
        this.modalEl.addClass("fred-confirm-delete-modal");
        const p = contentEl.createEl("p");
        p.appendText("Typ ");
        appendTypeName(p, this.plugin, this.type, this.plugin.settings.typeColors[this.type] ?? null);
        p.appendText(" wirklich l\xF6schen?");
        const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
        buttonRow.createEl("button", { text: "Abbrechen" }).addEventListener("click", () => this.close());
        const confirmBtn = buttonRow.createEl("button", { cls: "mod-warning", text: "L\xF6schen" });
        confirmBtn.addEventListener("click", () => {
          this.close();
          this.onConfirm();
        });
      }
      onClose() {
        this.contentEl.empty();
      }
    };
    var ConfirmRenameTypeModal = class extends Modal {
      constructor(plugin, oldType, newType, affectedCount, onConfirm, onCancel) {
        super(plugin.app);
        this.plugin = plugin;
        this.oldType = oldType;
        this.newType = newType;
        this.affectedCount = affectedCount;
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;
        this.confirmed = false;
      }
      onOpen() {
        const { contentEl } = this;
        this.modalEl.addClass("fred-confirm-delete-modal");
        const color = this.plugin.settings.typeColors[this.oldType] ?? null;
        const p = contentEl.createEl("p");
        p.appendText("TYP ");
        appendTypeName(p, this.plugin, this.oldType, color);
        p.appendText(" in ");
        appendTypeName(p, this.plugin, this.newType, color);
        p.appendText(` umbenennen und ${this.affectedCount} Notiz(en) entsprechend anpassen?`);
        const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
        buttonRow.createEl("button", { text: "Abbrechen" }).addEventListener("click", () => this.close());
        const confirmBtn = buttonRow.createEl("button", { cls: "mod-cta", text: "Umbenennen" });
        confirmBtn.addEventListener("click", () => {
          this.confirmed = true;
          this.close();
          this.onConfirm();
        });
      }
      // Deckt sowohl "Abbrechen"-Klick als auch Escape/Klick daneben ab - analog
      // zum Cancel-Handling in TypPickerModal.
      onClose() {
        this.contentEl.empty();
        if (!this.confirmed) this.onCancel?.();
      }
    };
    var ConfirmMergeTypeModal = class extends ConfirmRenameTypeModal {
      onOpen() {
        const { contentEl } = this;
        this.modalEl.addClass("fred-confirm-delete-modal");
        const settings = this.plugin.settings;
        const p = contentEl.createEl("p");
        p.appendText("TYP ");
        appendTypeName(p, this.plugin, this.newType, settings.typeColors[this.newType] ?? null);
        p.appendText(" existiert bereits. ");
        appendTypeName(p, this.plugin, this.oldType, settings.typeColors[this.oldType] ?? null);
        p.appendText(" damit zusammenlegen?");
        contentEl.createEl("p", {
          text: `${this.affectedCount} Notiz(en) werden auf ${this.newType} umgestellt. Farbe, Beschreibung und TYP-Frontmatter von ${this.oldType} entfallen, seine Subtypen werden \xFCbernommen (gleichnamige Subtyp-Bl\xF6cke zusammengef\xFChrt).`
        });
        const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
        buttonRow.createEl("button", { text: "Abbrechen" }).addEventListener("click", () => this.close());
        const confirmBtn = buttonRow.createEl("button", { cls: "mod-warning", text: "Zusammenlegen" });
        confirmBtn.addEventListener("click", () => {
          this.confirmed = true;
          this.close();
          this.onConfirm();
        });
      }
    };
    var ConfirmSubtypeModal = class extends Modal {
      constructor(app, { paragraphs, confirmText, confirmCls, onConfirm, onCancel }) {
        super(app);
        this.paragraphs = paragraphs;
        this.confirmText = confirmText;
        this.confirmCls = confirmCls;
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;
        this.confirmed = false;
      }
      onOpen() {
        const { contentEl } = this;
        this.modalEl.addClass("fred-confirm-delete-modal");
        for (const text of this.paragraphs) contentEl.createEl("p", { text });
        const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
        buttonRow.createEl("button", { text: "Abbrechen" }).addEventListener("click", () => this.close());
        const confirmBtn = buttonRow.createEl("button", { cls: this.confirmCls, text: this.confirmText });
        confirmBtn.addEventListener("click", () => {
          this.confirmed = true;
          this.close();
          this.onConfirm();
        });
      }
      onClose() {
        this.contentEl.empty();
        if (!this.confirmed) this.onCancel?.();
      }
    };
    var TypView = class extends ItemView {
      constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
      }
      getViewType() {
        return VIEW_TYPE_TYP;
      }
      getDisplayText() {
        return "TYP";
      }
      getIcon() {
        return "shapes";
      }
      async onOpen() {
        this.isEditing = false;
        this.selectedType = null;
        this.frontmatterBlocks = null;
        this.frontmatterEditors = [];
        this.contentEl.empty();
        this.contentEl.addClass("fred-typ-view");
        this.registerDomEvent(this.contentEl, "keydown", (event) => {
          if (event.key === "Escape" && this.selectedType !== null) this.closeTypeSettings();
        });
        this.render();
      }
      async onClose() {
        this.closeSubtypeColorPopover?.();
      }
      openSearch(type) {
        const globalSearch = this.plugin.app.internalPlugins.getPluginById("global-search");
        if (!globalSearch) return;
        const raw = type === null ? void 0 : this.plugin.typIndex.rawValueOf(type);
        const query = type === null ? `-["${TYP_PROPERTY2}"] file:.md` : Array.isArray(raw) ? raw.map((v) => `["${TYP_PROPERTY2}":"${String(v ?? "").trim()}"]`).join(" ") : `["${TYP_PROPERTY2}":"${type}"]`;
        globalSearch.instance.openGlobalSearch(query);
      }
      // typeKey kommt 1:1 aus den tatsächlichen Frontmatter-Werten (siehe
      // unregisteredRows in render() und typeKeyOf in typ-index.js) - kann also
      // klein geschrieben sein, Randleerzeichen tragen oder eine Liste sein. TYPen
      // werden aber immer als sauberer Einzelwert in Großbuchstaben geführt -
      // registriert wird deshalb die bereinigte Form (siehe normalizeRawType), und
      // die betroffenen Notizen werden gleich mit umgeschrieben, damit sie nicht
      // weiterhin als "nicht registriert" auftauchen.
      async registerType(typeKey) {
        const raw = this.plugin.typIndex.rawValueOf(typeKey);
        const normalized = normalizeRawType(raw === void 0 ? typeKey : raw);
        if (!normalized) return;
        if (!this.plugin.settings.types.includes(normalized)) {
          this.plugin.settings.types.push(normalized);
        }
        let renamed = 0;
        if (normalized !== typeKey) {
          renamed = await renameTypeInNotes(this.plugin, typeKey, normalized);
        }
        await this.plugin.saveSettings();
        this.render();
        this.plugin.refreshTypColors?.();
        if (renamed > 0) {
          new Notice(`TYP ${normalized} registriert, ${renamed} Notiz(en) angepasst.`);
        }
      }
      // Neues, leeres Tree-Item anlegen und sofort in den Editier-Modus versetzen -
      // wie bei Obsidians eigenen Views (z. B. neue Bookmark-Gruppe).
      startAdd() {
        if (this.isEditing) return;
        const treeItem = this.listEl.createDiv({ cls: "tree-item" });
        if (this.separatorEl) this.listEl.insertBefore(treeItem, this.separatorEl);
        const self = treeItem.createDiv({ cls: "tree-item-self is-clickable" });
        const inner = self.createDiv({ cls: "tree-item-inner" });
        this.startEditing(null, self, inner);
      }
      // Wie Obsidians eigene Tree-Items: kein zusätzliches Input-Element, sondern
      // das bestehende Text-Element wird selbst editierbar (contenteditable).
      // type === null → neuer Eintrag, sonst Umbenennen des übergebenen Typs.
      startEditing(type, self, inner) {
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
          const value = normalizeTypeName(inner.textContent);
          if (commit && value && value !== type) {
            const exists = this.plugin.settings.types.some(
              (t) => t.toLowerCase() === value.toLowerCase() && t !== type
            );
            if (!exists) {
              if (type === null) {
                this.plugin.settings.types.push(value);
              } else {
                const idx = this.plugin.settings.types.indexOf(type);
                if (idx !== -1) this.plugin.settings.types[idx] = value;
                if (this.plugin.settings.typeColors[type] !== void 0) {
                  this.plugin.settings.typeColors[value] = this.plugin.settings.typeColors[type];
                  delete this.plugin.settings.typeColors[type];
                }
                if (this.plugin.settings.typeDescriptions[type] !== void 0) {
                  this.plugin.settings.typeDescriptions[value] = this.plugin.settings.typeDescriptions[type];
                  delete this.plugin.settings.typeDescriptions[type];
                }
                if (this.plugin.settings.typeDefaultFrontmatter[type] !== void 0) {
                  this.plugin.settings.typeDefaultFrontmatter[value] = this.plugin.settings.typeDefaultFrontmatter[type];
                  delete this.plugin.settings.typeDefaultFrontmatter[type];
                }
                if (this.plugin.settings.typeFloatingKeys[type] !== void 0) {
                  this.plugin.settings.typeFloatingKeys[value] = this.plugin.settings.typeFloatingKeys[type];
                  delete this.plugin.settings.typeFloatingKeys[type];
                }
                if (this.plugin.settings.typeShortcuts[type] !== void 0) {
                  this.plugin.settings.typeShortcuts[value] = this.plugin.settings.typeShortcuts[type];
                  delete this.plugin.settings.typeShortcuts[type];
                }
                if (this.ensureTypeManual()[type] !== void 0) {
                  this.plugin.settings.typeManual[value] = this.plugin.settings.typeManual[type];
                  delete this.plugin.settings.typeManual[type];
                }
                moveTypeSubtypes(this.plugin.settings, type, value);
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
      openTypeSettings(type) {
        this.selectedType = type;
        this.render();
      }
      closeTypeSettings() {
        this.selectedType = null;
        this.render();
      }
      // Wird als Component-Child geladen (siehe mountFrontmatterEditor) und muss
      // deshalb vor jedem Neuaufbau der Detail-Ansicht explizit entladen werden -
      // contentEl.empty() allein würde nur die DOM-Elemente entfernen, nicht aber
      // den darauf registrierten metadataTypeManager-Listener der Editor-Instanz.
      // frontmatterBlocks ist die Steuerung über alle Blöcke (u. a. für den
      // Befehl "Standard-Property hinzufügen"), frontmatterEditors alle Editoren
      // der Detailansicht inkl. der Subtyp-Blöcke.
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
          if (this.selectedType !== null) {
            this.renderTypeSettings(this.selectedType);
            return;
          }
          const { contentEl } = this;
          contentEl.empty();
          const { counts, noType } = this.plugin.typIndex.typeCounts();
          const registered = this.plugin.settings.types;
          const typeColors = this.plugin.settings.typeColors;
          const sortOrder = this.plugin.settings.typSortOrder ?? DEFAULT_SORT_ORDER2;
          const isManualSort = sortOrder === "manual";
          const byCurrentOrder = (a, b) => compareTypes(sortOrder, a, b, counts, typeColors);
          this.renderListHeader(contentEl);
          const unregisteredRows = [...counts.keys()].filter((type) => !registered.includes(type)).sort(byCurrentOrder).map((type) => ({ type, count: counts.get(type) ?? 0 }));
          if (noType > 0) {
            unregisteredRows.push({ type: null, count: noType });
          }
          const listCls = "fred-typ-list nav-files-container" + (this.secondaryMode() === "none" ? " fred-typ-list-no-secondary" : "");
          this.listEl = contentEl.createDiv({ cls: listCls });
          this.separatorEl = null;
          const registeredOrder = sortTypesByMode2(registered, sortOrder, counts, typeColors);
          registeredOrder.forEach((type, index) => {
            this.renderRegisteredItem(type, counts.get(type) ?? 0, { draggable: isManualSort, index });
          });
          if (unregisteredRows.length > 0) {
            this.separatorEl = this.listEl.createDiv({ cls: "fred-typ-separator" });
            for (const row of unregisteredRows) {
              if (row.type === null) this.renderNoTypeItem(row.count);
              else this.renderUnregisteredItem(row.type, row.count);
            }
          }
        } finally {
          this._rendering = false;
        }
      }
      // Wie der "Change sort order"-Button in Obsidians Tags- bzw. All-Properties-View.
      renderListHeader(contentEl) {
        const header = contentEl.createDiv({ cls: "nav-header" });
        const buttonsContainer = header.createDiv({ cls: "nav-buttons-container" });
        const addBtn = buttonsContainer.createDiv({
          cls: "clickable-icon nav-action-button",
          attr: { "aria-label": "Neuen Typ hinzuf\xFCgen" }
        });
        setIcon(addBtn, "plus");
        addBtn.addEventListener("click", () => this.startAdd());
        const sortBtn = buttonsContainer.createDiv({
          cls: "clickable-icon nav-action-button",
          attr: { "aria-label": "Sortierreihenfolge \xE4ndern" }
        });
        setIcon(sortBtn, "lucide-sort-asc");
        sortBtn.addEventListener("click", (event) => this.showSortMenu(event));
        const current = SECONDARY_MODES[this.secondaryIndex()];
        const secondaryBtn = buttonsContainer.createDiv({
          cls: "clickable-icon nav-action-button",
          attr: { "aria-label": `Neben dem Namen: ${current.title}` }
        });
        setIcon(secondaryBtn, current.icon);
        secondaryBtn.addEventListener("click", () => this.cycleSecondary());
      }
      // settings.typListSecondary, aber immer ein gueltiger Modus - Bestandsdaten
      // kennen den Schluessel noch nicht (siehe migrateTypListSecondary in main.js),
      // und ein spaeter entfernter Modus soll die Liste nicht leer lassen.
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
      renderNoTypeItem(count) {
        const treeItem = this.listEl.createDiv({ cls: "tree-item" });
        const self = treeItem.createDiv({ cls: "tree-item-self is-clickable fred-typ-unregistered" });
        self.createDiv({ cls: "tree-item-inner", text: "[KEIN TYP]" });
        this.renderCountFlair(self, count);
        self.addEventListener("click", () => this.openSearch(null));
        self.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.openSearch(null);
        });
      }
      // Chromiums input[type=color] hat einen eigenen Mindest-Swatch, der sich nicht
      // unter Textgröße skalieren lässt - daher nur als unsichtbaren Picker-Trigger
      // über dem frei skalierbaren Punkt platzieren. Ohne eigene Farbe steht der
      // Punkt als hohler grauer Ring da (siehe paintColorDot); mit showReset
      // (Detailansicht) nennt ein Tooltip den Zustand, und der Zurücksetzen-Button
      // ist dann ausgegraut.
      renderColorPicker(parent, type, onChange, { showReset = false } = {}) {
        const currentColor = this.plugin.settings.typeColors[type] ?? DEFAULT_TYPE_COLOR;
        const colorWrap = parent.createDiv({ cls: "fred-typ-color-wrap" });
        const colorDot = colorWrap.createDiv({ cls: "fred-typ-color-dot" });
        let resetBtn = null;
        const showState = (color, isDefault) => {
          paintColorDot(colorDot, color, isDefault);
          if (!showReset) return;
          colorWrap.setAttribute("aria-label", isDefault ? "Standard (keine Farbe)" : "Farbe \xE4ndern");
          resetBtn?.toggleClass("is-disabled", isDefault);
        };
        const colorInput = colorWrap.createEl("input", { type: "color", cls: "fred-typ-color-input" });
        colorInput.value = currentColor;
        colorInput.addEventListener("click", (event) => event.stopPropagation());
        colorInput.addEventListener("input", async () => {
          showState(colorInput.value, false);
          this.plugin.settings.typeColors[type] = colorInput.value;
          await this.plugin.saveSettings();
          onChange?.(colorInput.value);
        });
        colorInput.addEventListener("change", () => this.plugin.refreshTypColors?.());
        if (showReset) {
          resetBtn = parent.createDiv({
            cls: "clickable-icon fred-typ-color-reset",
            attr: { "aria-label": "Farbe zur\xFCcksetzen" }
          });
          setIcon(resetBtn, "rotate-ccw");
          resetBtn.addEventListener("click", async () => {
            delete this.plugin.settings.typeColors[type];
            colorInput.value = DEFAULT_TYPE_COLOR;
            showState(DEFAULT_TYPE_COLOR, true);
            await this.plugin.saveSettings();
            this.plugin.refreshTypColors?.();
            onChange?.(DEFAULT_TYPE_COLOR);
          });
        }
        showState(currentColor, this.plugin.settings.typeColors[type] === void 0);
        return colorWrap;
      }
      // Fängt Bestandsinstallationen ab, deren settings-Objekt schon vor Einführung
      // von typeManual geladen wurde (z. B. laufende Session vor einem vollständigen
      // Plugin-Reload nach Hot-Reload) - ohne das würde jeder Zugriff unten mit
      // "Cannot read properties of undefined" abbrechen und dabei den gesamten
      // restlichen renderTypeSettings()-Aufruf (Farbe, Beschreibung, Frontmatter)
      // mit sich reißen, da der Fehler synchron mitten in der Funktion auftritt.
      ensureTypeManual() {
        if (!this.plugin.settings.typeManual) this.plugin.settings.typeManual = {};
        return this.plugin.settings.typeManual;
      }
      // Nachgebaut wie Obsidians eigener ToggleComponent (checkbox-container +
      // verstecktes input[type=checkbox]), da wir hier direkt im DOM statt über
      // die Setting-API bauen. Standardmäßig an - daher wird (wie bei den anderen
      // typeXxx-Dicts) nur die Abweichung vom Default gespeichert, hier also nur
      // "aus" (false); fehlender Eintrag bzw. true bedeuten "an". Steuert, ob ein
      // TYP in getTypes() (siehe main.js) exportiert wird, siehe dortiger Kommentar.
      renderManualToggle(parent, type) {
        const current = this.ensureTypeManual()[type] !== false;
        const toggleEl = parent.createDiv({
          cls: "checkbox-container" + (current ? " is-enabled" : ""),
          attr: { tabindex: "0", role: "checkbox", "aria-checked": String(current) }
        });
        toggleEl.createEl("input", { type: "checkbox" });
        const toggle = async () => {
          const next = !toggleEl.hasClass("is-enabled");
          toggleEl.toggleClass("is-enabled", next);
          toggleEl.setAttribute("aria-checked", String(next));
          if (next) delete this.ensureTypeManual()[type];
          else this.ensureTypeManual()[type] = false;
          await this.plugin.saveSettings();
        };
        toggleEl.addEventListener("click", toggle);
        toggleEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle();
          }
        });
        return toggleEl;
      }
      renderRegisteredItem(type, count, { draggable = false, index = -1 } = {}) {
        const treeItem = this.listEl.createDiv({ cls: "tree-item" });
        const self = treeItem.createDiv({ cls: "tree-item-self is-clickable" });
        let nameEl;
        this.renderColorPicker(self, type, (newColor) => {
          if (nameEl && this.plugin.settings.colorViews.typList) nameEl.style.color = newColor;
        });
        nameEl = self.createDiv({ cls: "tree-item-inner", text: type });
        const color = this.plugin.settings.colorViews.typList ? this.plugin.settings.typeColors[type] : null;
        if (color) nameEl.style.color = color;
        const secondary = this.secondaryMode();
        if (secondary === "description") this.renderDescriptionInput(self, type);
        else if (secondary === "subtypes") this.renderSubtypePreview(self, type);
        this.renderCountFlair(self, count);
        self.addEventListener("click", () => {
          if (this.isEditing) return;
          this.openTypeSettings(type);
        });
        self.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.openSearch(type);
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
            const types = this.plugin.settings.types;
            const [moved] = types.splice(fromIndex, 1);
            types.splice(insertBefore, 0, moved);
            await this.plugin.saveSettings();
            this.render();
          });
        }
      }
      // Echtes Text-Input statt nur Anzeige: die Beschreibung ist direkt in der
      // Liste bearbeitbar, ohne dafür erst die Detailansicht öffnen zu müssen.
      // click hier muss die Zeile selbst gezielt NICHT auslösen
      // (self.addEventListener("click", ...) in renderRegisteredItem öffnet sonst
      // die Detailansicht), daher stopPropagation.
      renderDescriptionInput(self, type) {
        const descInput = self.createEl("input", {
          type: "text",
          cls: "fred-typ-list-description-input"
        });
        descInput.value = this.plugin.settings.typeDescriptions[type] ?? "";
        descInput.addEventListener("click", (event) => event.stopPropagation());
        descInput.addEventListener("change", async () => {
          const value = descInput.value.trim();
          if (value) this.plugin.settings.typeDescriptions[type] = value;
          else delete this.plugin.settings.typeDescriptions[type];
          await this.plugin.saveSettings();
        });
      }
      // "(Subtyp 1, Subtyp 2)" statt der Beschreibung - dieselbe Darstellung wie
      // die Subtyp-Vorschau im separaten TYP-Picker (renderSubtypePreview in
      // type-picker.js, gemeinsame Farbgrundlage nameColor in type-colors.js):
      // Klammern und Kommas muted, jeder Name in seiner eigenen Subtyp-Farbe; ohne
      // "TYP View einfärben" bleibt die Vorschau wie der TYP-Name selbst ungefärbt,
      // und ohne dessen Unter-Schalter "Subtyp" stehen alle in der TYP-Farbe.
      // Bewusst nur die erfassten Subtypen und ohne Notiz-Anzahl: nicht erfasste
      // Werte haben weder Farbe noch Definition, und Zahlen je Name würden die
      // Zeile so verlängern, dass bei mehreren Subtypen nichts mehr davon zu lesen
      // wäre. Reine Anzeige - Klick und Rechtsklick gehören weiter der ganzen
      // Zeile (Detailansicht bzw. Suche). Ob die Liste links hinter dem Namen
      // beginnt oder rechtsbündig vor der Anzahl endet, ist hier bewusst nicht
      // abgefragt: das schaltet Style Settings über eine body-Klasse (siehe den
      // @settings-Block und .fred-typ-list-subtypes in styles.css), das Markup
      // bleibt in beiden Fällen dasselbe.
      renderSubtypePreview(self, type) {
        const subtypes = getSubtypeNames2(this.plugin.settings, type);
        if (subtypes.length === 0) return;
        const colorize = this.plugin.settings.colorViews.typList;
        const wrap = self.createSpan({ cls: "fred-typ-list-subtypes" });
        wrap.appendText("(");
        subtypes.forEach((subtype, index) => {
          if (index > 0) wrap.appendText(", ");
          const span = wrap.createSpan({ text: subtype });
          if (colorize) span.style.color = nameColor(this.plugin.settings, type, subtype).color;
        });
        wrap.appendText(")");
      }
      renderUnregisteredItem(type, count) {
        const treeItem = this.listEl.createDiv({ cls: "tree-item" });
        const self = treeItem.createDiv({ cls: "tree-item-self is-clickable fred-typ-unregistered" });
        self.createDiv({ cls: "tree-item-inner", text: displayTypeKey(type) });
        this.renderCountFlair(self, count);
        self.addEventListener("click", () => this.registerType(type));
        self.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.openSearch(type);
        });
      }
      renderTypeSettings(type) {
        const { contentEl } = this;
        contentEl.empty();
        const header = contentEl.createDiv({ cls: "fred-typ-detail-header" });
        const backBtn = header.createDiv({ cls: "clickable-icon fred-typ-back", attr: { "aria-label": "Zur\xFCck" } });
        setIcon(backBtn, "arrow-left");
        backBtn.addEventListener("click", () => this.closeTypeSettings());
        const titleEl = header.createDiv({ cls: "fred-typ-detail-title", text: type });
        const titleColor = this.plugin.settings.colorViews.typList ? this.plugin.settings.typeColors[type] : null;
        if (titleColor) titleEl.style.color = titleColor;
        const { counts } = this.plugin.typIndex.typeCounts();
        header.createSpan({ cls: "fred-typ-detail-count", text: String(counts.get(type) ?? 0) });
        const renameWithNotesBtn = header.createDiv({
          cls: "clickable-icon fred-typ-detail-rename-notes",
          attr: { "aria-label": "Umbenennen (inkl. Notizen anpassen)" }
        });
        setIcon(renameWithNotesBtn, "pencil");
        renameWithNotesBtn.addEventListener("click", () => this.startDetailRename(type, titleEl, { updateNotes: true }));
        const renameBtn = header.createDiv({ cls: "clickable-icon fred-typ-detail-rename", attr: { "aria-label": "Umbenennen" } });
        setIcon(renameBtn, "pencil");
        renameBtn.addEventListener("click", () => this.startDetailRename(type, titleEl));
        const deleteBtn = header.createDiv({ cls: "clickable-icon fred-typ-detail-delete", attr: { "aria-label": "L\xF6schen" } });
        setIcon(deleteBtn, "trash");
        deleteBtn.addEventListener("click", () => this.showDeleteConfirm(type));
        const body = contentEl.createDiv({ cls: "fred-typ-detail-body" });
        const descSection = body.createDiv({ cls: "fred-typ-description-section" });
        const optionsHeader = descSection.createDiv({ cls: "fred-typ-frontmatter-header fred-typ-options-header" });
        const manualToggleWrap = optionsHeader.createDiv({ cls: "fred-typ-manual-toggle" });
        manualToggleWrap.createSpan({ cls: "fred-typ-detail-section-title", text: "Manueller TYP" });
        this.renderManualToggle(manualToggleWrap, type);
        const colorRow = optionsHeader.createDiv({ cls: "fred-typ-detail-color-row" });
        this.renderColorPicker(
          colorRow,
          type,
          (newColor) => {
            if (!this.plugin.settings.colorViews.typList) return;
            titleEl.style.color = newColor;
          },
          { showReset: true }
        );
        const descHeader = descSection.createDiv({ cls: "fred-typ-frontmatter-header" });
        descHeader.createDiv({ cls: "fred-typ-detail-section-title", text: "Beschreibung" });
        const descInput = descSection.createEl("textarea", {
          cls: "fred-typ-description-input",
          attr: { rows: "2" }
        });
        descInput.value = this.plugin.settings.typeDescriptions[type] ?? "";
        descInput.addEventListener("change", async () => {
          const value = descInput.value.trim();
          if (value) this.plugin.settings.typeDescriptions[type] = value;
          else delete this.plugin.settings.typeDescriptions[type];
          await this.plugin.saveSettings();
        });
        const bucket = this.plugin.typIndex.subtypeBucket(type);
        this.frontmatterBlocks = mountFrontmatterBlocks(this, body, type, {
          renderHeader: (section, el, blocks) => this.renderSectionHeader(el, type, section, bucket, blocks),
          renderFooter: (section, el) => {
            if (section !== null) this.renderSectionFooter(el, type, section);
          },
          onMoveSection: async (order) => {
            reorderSubtypes(this.plugin.settings, type, order);
            await this.plugin.saveSettings();
            this.render();
          },
          onSectionContextMenu: (section) => this.openSubtypeSearch(type, section)
        });
        this.frontmatterEditors.push(...this.frontmatterBlocks.editors);
        this.subtypeAddBtnEl = body.createEl("button", { cls: "mod-cta fred-typ-subtype-add" });
        setIcon(this.subtypeAddBtnEl.createSpan({ cls: "fred-typ-subtype-add-icon" }), "plus");
        this.subtypeAddBtnEl.createSpan({ text: "Subtyp hinzuf\xFCgen" });
        this.subtypeAddBtnEl.addEventListener("click", () => this.startAddSubtype(type));
        this.renderUnregisteredSubtypes(body, type, bucket);
        body.createDiv({ cls: "fred-typ-detail-separator" });
        this.renderFloatingHint(body);
        this.plugin.refreshFrontmatterHighlight?.();
      }
      // Überschrift eines Blocks (siehe frontmatter-blocks.js): Titel mit
      // Notiz-Anzahl (beim TYP-Frontmatter die Notizen ohne SUBTYP - für die gilt
      // nur dieser Block), Suche per Rechtsklick (beim TYP-Frontmatter auf den
      // Titel), und die beiden "Property hinzufügen"-Buttons, die eine Leerzeile
      // in genau diesem Block anlegen.
      renderSectionHeader(el, type, section, bucket, blocks) {
        const titleGroup = el.createDiv({ cls: "fred-typ-frontmatter-title-group" });
        const titleEl = titleGroup.createDiv({ cls: "fred-typ-detail-section-title", text: section ?? `${type}-Frontmatter` });
        const count = section === null ? bucket.noSubtype : bucket.counts.get(section) ?? 0;
        titleGroup.createSpan({ cls: "fred-typ-subtype-count", text: String(count) });
        if (section === null) {
          titleEl.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            this.openSubtypeSearch(type, null);
          });
        }
        const addButtons = el.createDiv({ cls: "fred-typ-frontmatter-add-group" });
        const addFloatingPropertyBtn = addButtons.createDiv({
          cls: "clickable-icon fred-typ-frontmatter-add-floating",
          attr: { "aria-label": "Floating Property hinzuf\xFCgen" }
        });
        setIcon(addFloatingPropertyBtn, "plus");
        addFloatingPropertyBtn.addEventListener("click", () => blocks.addBlank(section, true));
        const addPropertyBtn = addButtons.createDiv({
          cls: "clickable-icon fred-typ-frontmatter-add",
          attr: { "aria-label": "Property hinzuf\xFCgen" }
        });
        setIcon(addPropertyBtn, "plus");
        addPropertyBtn.addEventListener("click", () => blocks.addBlank(section, false));
      }
      // Abschluss eines Subtyp-Blocks: links die Farbe des Subtyps (Farbpunkt, der
      // die Regler öffnet, daneben Zurücksetzen), rechts die Aktionen wie im Kopf
      // der TYP-Detailansicht (Umbenennen inkl. Notizen, Umbenennen, Löschen). Das
      // TYP-Frontmatter hat keinen. Der Titel wird erst beim Klick gesucht -
      // Überschrift und Abschluss entstehen bei jedem synchronize() neu.
      renderSectionFooter(el, type, subtype) {
        el.addClass("fred-typ-subtype-actions");
        const colorGroup = el.createDiv({ cls: "fred-typ-subtype-color-group" });
        const ownColor = subtypeHasOwnColor(this.plugin.settings, type, subtype);
        const typeHasColor = !!this.plugin.settings.typeColors[type];
        const colorDot = colorGroup.createDiv({
          cls: "fred-typ-subtype-color-dot",
          attr: { "aria-label": !typeHasColor ? "TYP hat keine Farbe" : ownColor ? "Farbe anpassen" : "\xDCbernimmt TYP-Farbe" }
        });
        colorDot.fredSubtype = subtype;
        paintColorDot(colorDot, subtypeColor(this.plugin.settings, type, subtype) ?? DEFAULT_TYPE_COLOR, !ownColor || !typeHasColor);
        colorDot.addEventListener("click", () => this.openSubtypeColorPopover(colorDot, type, subtype));
        const resetBtn = colorGroup.createDiv({ cls: "clickable-icon fred-typ-color-reset", attr: { "aria-label": "Farbe zur\xFCcksetzen" } });
        resetBtn.toggleClass("is-disabled", !ownColor);
        setIcon(resetBtn, "rotate-ccw");
        resetBtn.addEventListener("click", async () => {
          const data = getSubtype2(this.plugin.settings, type, subtype);
          if (!data?.color) return;
          delete data.color;
          await this.plugin.saveSettings();
          this.plugin.refreshTypColors?.();
          this.render();
        });
        const actions = el.createDiv({ cls: "fred-typ-subtype-action-group" });
        const titleEl = () => {
          let sibling = el.previousElementSibling;
          while (sibling && !sibling.hasClass("fred-typ-section-header")) sibling = sibling.previousElementSibling;
          return sibling?.querySelector(".fred-typ-detail-section-title") ?? null;
        };
        const rename = (updateNotes) => {
          const target = titleEl();
          if (target) this.startSubtypeRename(type, subtype, target, { updateNotes });
        };
        const renameWithNotesBtn = actions.createDiv({
          cls: "clickable-icon fred-typ-detail-rename-notes",
          attr: { "aria-label": "Umbenennen (inkl. Notizen anpassen)" }
        });
        setIcon(renameWithNotesBtn, "pencil");
        renameWithNotesBtn.addEventListener("click", () => rename(true));
        const renameBtn = actions.createDiv({ cls: "clickable-icon fred-typ-detail-rename", attr: { "aria-label": "Umbenennen" } });
        setIcon(renameBtn, "pencil");
        renameBtn.addEventListener("click", () => rename(false));
        const deleteBtn = actions.createDiv({ cls: "clickable-icon fred-typ-detail-delete", attr: { "aria-label": "L\xF6schen" } });
        setIcon(deleteBtn, "trash");
        deleteBtn.addEventListener("click", () => this.deleteSubtypeWithConfirm(type, subtype));
      }
      // Popover unter dem Farbpunkt eines Subtyp-Blocks: je ein Regler für
      // Farbton, Sättigung und Helligkeit, begrenzt auf die in den Einstellungen
      // festgelegte Abweichung (siehe type-colors.js). Die Leiste jedes Reglers
      // zeigt als Verlauf die Farben, die er erreichen kann. Beim Ziehen ändert
      // sich nur der Farbpunkt hier; gespeichert und in die übrigen Ansichten
      // übernommen wird beim Schließen (Klick daneben oder Escape) - ein
      // refreshTypColors() rendert u. a. diese Ansicht neu.
      openSubtypeColorPopover(anchorEl, type, subtype) {
        this.closeSubtypeColorPopover?.();
        const { settings } = this.plugin;
        const data = getSubtype2(settings, type, subtype);
        if (!data) return;
        const typeColor = settings.typeColors[type] ?? DEFAULT_TYPE_COLOR;
        const offset = clampedOffset(settings, data.color) ?? Object.fromEntries(SUBTYPE_COLOR_CHANNELS.map(({ key }) => [key, 0]));
        const doc = anchorEl.doc;
        const popover = doc.body.createDiv({ cls: "menu fred-typ-subtype-color-popover" });
        const rows = [];
        const update = () => {
          const color = applyColorOffset(typeColor, offset);
          for (const el of this.contentEl.querySelectorAll(".fred-typ-subtype-color-dot")) {
            if (el.fredSubtype === subtype) paintColorDot(el, color, !hasColorOffset(offset) || !settings.typeColors[type]);
          }
          for (const row of rows) row();
        };
        for (const { key, label, unit } of SUBTYPE_COLOR_CHANNELS) {
          const [min, max] = channelBounds(settings, key);
          const row = popover.createDiv({ cls: "fred-typ-subtype-color-row" });
          row.createSpan({ cls: "fred-typ-subtype-color-label", text: label });
          const input = row.createEl("input", { type: "range", cls: "slider fred-typ-subtype-color-slider" });
          input.min = String(min);
          input.max = String(max);
          input.step = "1";
          input.value = String(offset[key]);
          input.disabled = min === max;
          const valueEl = row.createSpan({ cls: "fred-typ-subtype-color-value" });
          input.addEventListener("input", () => {
            offset[key] = Number(input.value);
            update();
          });
          rows.push(() => {
            const steps = 8;
            const stops = [];
            for (let i = 0; i <= steps; i++) {
              stops.push(applyColorOffset(typeColor, { ...offset, [key]: min + (max - min) * i / steps }));
            }
            input.style.setProperty("--fred-track", `linear-gradient(to right, ${stops.join(", ")})`);
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
          this.closeSubtypeColorPopover = null;
          doc.removeEventListener("mousedown", onPointerDown, true);
          doc.removeEventListener("keydown", onKeyDown, true);
          popover.remove();
          const current = getSubtype2(settings, type, subtype);
          if (!current) return;
          if (hasColorOffset(offset)) current.color = { ...offset };
          else delete current.color;
          await this.plugin.saveSettings();
          this.plugin.refreshTypColors?.();
          this.render();
        };
        this.closeSubtypeColorPopover = close;
        doc.addEventListener("mousedown", onPointerDown, true);
        doc.addEventListener("keydown", onKeyDown, true);
      }
      // Löscht den Subtyp-Block samt seiner Properties. Die Notizen behalten ihren
      // SUBTYP-Wert (er erscheint danach unten als nicht erfasster Subtyp) - eine
      // Bestätigung braucht es daher nur, wenn dabei Properties verloren gehen.
      deleteSubtypeWithConfirm(type, subtype) {
        const apply = async () => {
          deleteSubtype(this.plugin.settings, type, subtype);
          await this.plugin.saveSettings();
          this.plugin.refreshTypColors?.();
          this.render();
        };
        const keys = Object.keys(getSubtype2(this.plugin.settings, type, subtype)?.frontmatter ?? {}).filter((key) => key !== "");
        if (keys.length === 0) {
          apply();
          return;
        }
        new ConfirmSubtypeModal(this.app, {
          paragraphs: [
            `Subtyp ${subtype} von ${type} wirklich l\xF6schen?`,
            `${keys.length === 1 ? "Die Property" : `Die ${keys.length} Properties`} ${keys.join(", ")} ${keys.length === 1 ? "geht" : "gehen"} dabei verloren.`
          ],
          confirmText: "L\xF6schen",
          confirmCls: "mod-warning",
          onConfirm: apply
        }).open();
      }
      // Wie startDetailRename(), aber auf dem Titel eines Subtyp-Blocks. Der Block
      // behält seine Position; updateNotes: true schreibt nach Bestätigung auch den
      // SUBTYP der betroffenen Notizen um. Ein bereits vorhandener Name bietet
      // stattdessen das Zusammenlegen an (schreibt die Notizen immer mit um).
      startSubtypeRename(type, subtype, titleEl, { updateNotes = false } = {}) {
        if (this.isEditing) return;
        this.isEditing = true;
        titleEl.addClass("fred-typ-subtype-name-input", "is-being-renamed");
        titleEl.setAttribute("contenteditable", "true");
        titleEl.setAttribute("spellcheck", "false");
        titleEl.focus();
        const range = titleEl.doc.createRange();
        range.selectNodeContents(titleEl);
        const selection = titleEl.win.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        const countOf = (name) => this.plugin.typIndex.subtypeBucket(type).counts.get(name) ?? 0;
        const applyRename = async (value, { withNotes }) => {
          renameSubtype(this.plugin.settings, type, subtype, value);
          await this.plugin.saveSettings();
          const renamed = withNotes ? await renameSubtypeInNotes(this.plugin, type, subtype, value) : 0;
          this.plugin.refreshTypColors?.();
          if (withNotes) new Notice(`SUBTYP ${value}: ${renamed} Notiz(en) angepasst.`);
          this.render();
        };
        let done = false;
        const finish = async (commit) => {
          if (done) return;
          done = true;
          this.isEditing = false;
          const value = normalizeSubtypeName(titleEl.textContent);
          if (!commit || !value || value === subtype) {
            this.render();
            return;
          }
          const existing = getSubtypeNames2(this.plugin.settings, type).find(
            (name) => name.toLowerCase() === value.toLowerCase() && name !== subtype
          );
          if (existing) {
            new ConfirmSubtypeModal(this.app, {
              paragraphs: [
                `Subtyp ${existing} existiert bei ${type} bereits. ${subtype} damit zusammenlegen?`,
                `${countOf(subtype)} Notiz(en) werden auf ${existing} umgestellt, die Properties von ${subtype} wandern in den Block ${existing}.`
              ],
              confirmText: "Zusammenlegen",
              confirmCls: "mod-warning",
              onConfirm: async () => {
                mergeSubtypes(this.plugin.settings, type, subtype, existing);
                await this.plugin.saveSettings();
                const renamed = await renameSubtypeInNotes(this.plugin, type, subtype, existing);
                this.plugin.refreshTypColors?.();
                new Notice(`Subtyp ${subtype} mit ${existing} zusammengelegt, ${renamed} Notiz(en) angepasst.`);
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
          new ConfirmSubtypeModal(this.app, {
            paragraphs: [`Subtyp ${subtype} in ${value} umbenennen und ${countOf(subtype)} Notiz(en) entsprechend anpassen?`],
            confirmText: "Umbenennen",
            confirmCls: "mod-cta",
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
      // Wie die unregistrierten Einträge der TYP-Liste: SUBTYP-Werte von Notizen
      // dieses TYPs, die (noch) keinen eigenen Block haben (Notizen ganz ohne
      // SUBTYP zählt stattdessen das TYP-Frontmatter). Dargestellt wie die
      // Subtyp-Blöcke, aber nur mit (ausgegrauter) Überschrift samt Anzahl.
      // Linksklick übernimmt einen Wert als Subtyp, Rechtsklick öffnet die Suche.
      renderUnregisteredSubtypes(parent, type, bucket) {
        const registered = getSubtypeNames2(this.plugin.settings, type);
        const unregistered = [...bucket.counts.keys()].filter((key) => !registered.includes(key)).sort((a, b) => bucket.counts.get(b) - bucket.counts.get(a) || a.localeCompare(b));
        if (unregistered.length === 0) return;
        const listEl = parent.createDiv({ cls: "fred-typ-subtype-unregistered-list" });
        for (const key of unregistered) {
          const block = listEl.createDiv({ cls: "fred-typ-frontmatter-block fred-typ-subtype-block fred-typ-subtype-unregistered" });
          const header = block.createDiv({ cls: "fred-typ-frontmatter-header" });
          const titleGroup = header.createDiv({ cls: "fred-typ-frontmatter-title-group" });
          titleGroup.createDiv({ cls: "fred-typ-detail-section-title", text: displayTypeKey(key) });
          titleGroup.createSpan({ cls: "fred-typ-subtype-count", text: String(bucket.counts.get(key)) });
          block.addEventListener("click", () => this.registerSubtype(type, key, bucket));
          block.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.openSubtypeSearch(type, key);
          });
        }
      }
      // subtypeKey === null → Notizen dieses TYPs ohne SUBTYP. Für eine Liste
      // gibt es wie bei openSearch() keine exakte Suchsyntax - dann nach Notizen
      // suchen, die alle ihre Einträge tragen.
      openSubtypeSearch(type, subtypeKey) {
        const globalSearch = this.plugin.app.internalPlugins.getPluginById("global-search");
        if (!globalSearch) return;
        const typClause = `["${TYP_PROPERTY2}":"${type}"]`;
        let subtypClause;
        if (subtypeKey === null) {
          subtypClause = `-["${SUBTYP_PROPERTY2}"]`;
        } else {
          const raw = this.plugin.typIndex.subtypeBucket(type).rawByKey.get(subtypeKey);
          subtypClause = Array.isArray(raw) ? raw.map((v) => `["${SUBTYP_PROPERTY2}":"${String(v ?? "").trim()}"]`).join(" ") : `["${SUBTYP_PROPERTY2}":"${subtypeKey}"]`;
        }
        globalSearch.instance.openGlobalSearch(`${typClause} ${subtypClause}`);
      }
      // Wie registerType(): übernimmt die bereinigte Form (Großbuchstaben, Liste
      // als Einzelwert "A, B") als Subtyp dieses TYPs und schreibt den SUBTYP der
      // betroffenen Notizen gleich mit um. Gibt es den Subtyp in anderer Schreib-
      // weise schon, landen die Notizen dort.
      async registerSubtype(type, subtypeKey, bucket) {
        const raw = bucket.rawByKey.get(subtypeKey);
        const normalized = normalizeRawType(raw === void 0 ? subtypeKey : raw, normalizeSubtypeName);
        if (!normalized) return;
        const existing = getSubtypeNames2(this.plugin.settings, type).find((name) => name.toLowerCase() === normalized.toLowerCase());
        const subtype = existing ?? normalized;
        ensureSubtype(this.plugin.settings, type, subtype);
        let renamed = 0;
        if (subtype !== subtypeKey) renamed = await renameSubtypeInNotes(this.plugin, type, subtypeKey, subtype);
        await this.plugin.saveSettings();
        this.plugin.refreshTypColors?.();
        if (renamed > 0) new Notice(`SUBTYP ${subtype} registriert, ${renamed} Notiz(en) angepasst.`);
      }
      // Neuer, leerer Subtyp-Block direkt über dem "Subtyp hinzufügen"-Button,
      // dessen Name sofort inline eingegeben wird (wie startAdd() in der Liste).
      startAddSubtype(type) {
        if (this.isEditing || !this.subtypeAddBtnEl) return;
        this.isEditing = true;
        const block = createDiv({ cls: "fred-typ-frontmatter-block fred-typ-subtype-block fred-typ-subtype-pending" });
        this.subtypeAddBtnEl.parentElement.insertBefore(block, this.subtypeAddBtnEl);
        const header = block.createDiv({ cls: "fred-typ-frontmatter-header" });
        const titleGroup = header.createDiv({ cls: "fred-typ-frontmatter-title-group" });
        const nameEl = titleGroup.createDiv({ cls: "fred-typ-detail-section-title fred-typ-subtype-name-input is-being-renamed" });
        const addButtons = header.createDiv({ cls: "fred-typ-frontmatter-add-group" });
        setIcon(addButtons.createDiv({ cls: "clickable-icon fred-typ-frontmatter-add-floating" }), "plus");
        setIcon(addButtons.createDiv({ cls: "clickable-icon fred-typ-frontmatter-add" }), "plus");
        const footer = block.createDiv({ cls: "fred-typ-section-footer fred-typ-subtype-actions" });
        const colorGroup = footer.createDiv({ cls: "fred-typ-subtype-color-group" });
        paintColorDot(colorGroup.createDiv({ cls: "fred-typ-subtype-color-dot" }), this.plugin.settings.typeColors[type] ?? DEFAULT_TYPE_COLOR, true);
        setIcon(colorGroup.createDiv({ cls: "clickable-icon fred-typ-color-reset is-disabled" }), "rotate-ccw");
        const actions = footer.createDiv({ cls: "fred-typ-subtype-action-group" });
        setIcon(actions.createDiv({ cls: "clickable-icon fred-typ-detail-rename-notes" }), "pencil");
        setIcon(actions.createDiv({ cls: "clickable-icon fred-typ-detail-rename" }), "pencil");
        setIcon(actions.createDiv({ cls: "clickable-icon fred-typ-detail-delete" }), "trash");
        nameEl.setAttribute("contenteditable", "true");
        nameEl.setAttribute("spellcheck", "false");
        nameEl.focus();
        let done = false;
        const finish = async (commit) => {
          if (done) return;
          done = true;
          this.isEditing = false;
          const value = normalizeSubtypeName(nameEl.textContent);
          if (commit && value) {
            const existing = getSubtypeNames2(this.plugin.settings, type).find((name) => name.toLowerCase() === value.toLowerCase());
            if (existing) {
              new Notice(`Subtyp ${existing} gibt es bei ${type} bereits.`);
            } else {
              ensureSubtype(this.plugin.settings, type, value);
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
      showDeleteConfirm(type) {
        new ConfirmDeleteTypeModal(this.plugin, type, async () => {
          this.plugin.settings.types = this.plugin.settings.types.filter((t) => t !== type);
          delete this.plugin.settings.typeColors[type];
          delete this.plugin.settings.typeDescriptions[type];
          delete this.plugin.settings.typeDefaultFrontmatter[type];
          delete this.plugin.settings.typeFloatingKeys[type];
          delete this.plugin.settings.typeShortcuts[type];
          delete this.ensureTypeManual()[type];
          deleteTypeSubtypes(this.plugin.settings, type);
          this.closeTypeSettings();
          await this.plugin.saveSettings();
          this.plugin.refreshTypColors?.();
        }).open();
      }
      // Wie startEditing(), aber auf dem freistehenden Titel-Element der Detail-Ansicht
      // statt auf einem Tree-Item - und mit resultierendem selectedType-Wechsel statt
      // eines schlichten Re-Renders der Liste. updateNotes: true (zweiter, hervor-
      // gehobener Button) schreibt nach Bestätigung zusätzlich den TYP-Wert aller
      // betroffenen Notizen um (siehe renameTypeInNotes), statt nur die Plugin-
      // Einstellungen zu migrieren.
      startDetailRename(type, titleEl, { updateNotes = false } = {}) {
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
          const idx = this.plugin.settings.types.indexOf(type);
          if (idx !== -1) this.plugin.settings.types[idx] = value;
          if (this.plugin.settings.typeColors[type] !== void 0) {
            this.plugin.settings.typeColors[value] = this.plugin.settings.typeColors[type];
            delete this.plugin.settings.typeColors[type];
          }
          if (this.plugin.settings.typeDescriptions[type] !== void 0) {
            this.plugin.settings.typeDescriptions[value] = this.plugin.settings.typeDescriptions[type];
            delete this.plugin.settings.typeDescriptions[type];
          }
          if (this.plugin.settings.typeDefaultFrontmatter[type] !== void 0) {
            this.plugin.settings.typeDefaultFrontmatter[value] = this.plugin.settings.typeDefaultFrontmatter[type];
            delete this.plugin.settings.typeDefaultFrontmatter[type];
          }
          if (this.plugin.settings.typeFloatingKeys[type] !== void 0) {
            this.plugin.settings.typeFloatingKeys[value] = this.plugin.settings.typeFloatingKeys[type];
            delete this.plugin.settings.typeFloatingKeys[type];
          }
          if (this.plugin.settings.typeShortcuts[type] !== void 0) {
            this.plugin.settings.typeShortcuts[value] = this.plugin.settings.typeShortcuts[type];
            delete this.plugin.settings.typeShortcuts[type];
          }
          if (this.ensureTypeManual()[type] !== void 0) {
            this.plugin.settings.typeManual[value] = this.plugin.settings.typeManual[type];
            delete this.plugin.settings.typeManual[type];
          }
          moveTypeSubtypes(this.plugin.settings, type, value);
          this.selectedType = value;
          await this.plugin.saveSettings();
          this.plugin.refreshTypColors?.();
        };
        let done = false;
        const finish = async (commit) => {
          if (done) return;
          done = true;
          this.isEditing = false;
          const value = normalizeTypeName(titleEl.textContent);
          if (!commit || !value || value === type) {
            this.render();
            return;
          }
          const existing = this.plugin.settings.types.find(
            (t) => t.toLowerCase() === value.toLowerCase() && t !== type
          );
          if (existing) {
            this.showMergeConfirm(type, existing);
            return;
          }
          if (!updateNotes) {
            await applyRename(value);
            this.render();
            return;
          }
          const { counts } = this.plugin.typIndex.typeCounts();
          new ConfirmRenameTypeModal(
            this.plugin,
            type,
            value,
            counts.get(type) ?? 0,
            async () => {
              await applyRename(value);
              const renamed = await renameTypeInNotes(this.plugin, type, value);
              new Notice(`TYP ${value}: ${renamed} Notiz(en) angepasst.`);
              this.render();
            },
            () => this.render()
          ).open();
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
      showMergeConfirm(source, target) {
        const { counts } = this.plugin.typIndex.typeCounts();
        new ConfirmMergeTypeModal(
          this.plugin,
          source,
          target,
          counts.get(source) ?? 0,
          () => this.mergeType(source, target),
          () => this.render()
        ).open();
      }
      // Legt source in target auf: Notizen werden auf target umgeschrieben,
      // source verschwindet aus der TYP-Liste samt eigener Einstellungen (target
      // behält seine). Die Subtypen von source werden übernommen, gleichnamige
      // Blöcke zusammengeführt (siehe mergeTypeSubtypes in subtypes.js).
      async mergeType(source, target) {
        const settings = this.plugin.settings;
        const renamed = await renameTypeInNotes(this.plugin, source, target);
        settings.types = settings.types.filter((t) => t !== source);
        delete settings.typeColors[source];
        delete settings.typeDescriptions[source];
        delete settings.typeDefaultFrontmatter[source];
        delete settings.typeFloatingKeys[source];
        delete settings.typeShortcuts[source];
        delete this.ensureTypeManual()[source];
        mergeTypeSubtypes(settings, source, target);
        this.selectedType = target;
        await this.plugin.saveSettings();
        this.plugin.refreshTypColors?.();
        new Notice(`TYP ${source} mit ${target} zusammengelegt, ${renamed} Notiz(en) angepasst.`);
        this.render();
      }
      renderCountFlair(self, count) {
        const flairOuter = self.createDiv({ cls: "tree-item-flair-outer" });
        flairOuter.createSpan({ cls: "tree-item-flair", text: String(count) });
      }
      // Rein informativ, unter dem TYP-Frontmatter-Editor: erklärt den
      // Floating-Property-Toggle (Rechtsklick auf eine Property oben, siehe
      // ensurePropertyMenuPatch in type-frontmatter-editor.js). Bewusst ohne eigene
      // Überschrift, da direkt unter der Property-Liste ohnehin klar ist, worauf
      // sich der Hinweis bezieht.
      //
      // Hier stand früher zusätzlich eine feste Liste der Platzhalter-Token. Die
      // ist mit dem Shortcut-Knopf je Property-Zeile entfallen: dessen Auswahl
      // (shortcut-picker.js) führt dieselben Token, aber am Ort der Verwendung,
      // durchsuchbar und bei Skripten samt deren eigener Beschreibung.
      renderFloatingHint(parent) {
        const section = parent.createDiv({ cls: "fred-typ-floating-hint-section" });
        section.createDiv({
          cls: "fred-typ-floating-hint",
          text: "You can change a property to floating in the right-click menu."
        });
      }
    };
    function registerTypView2(plugin) {
      plugin.registerView(VIEW_TYPE_TYP, (leaf) => new TypView(leaf, plugin));
      plugin.addCommand({
        id: "typ-view-oeffnen",
        name: "TYP-View \xF6ffnen",
        callback: () => activateTypView(plugin)
      });
      plugin.addCommand({
        id: "typ-property-hinzufuegen",
        name: "TYP-Property hinzuf\xFCgen",
        callback: () => addTypPropertyCommand(plugin)
      });
      plugin.addCommand({
        id: "typ-hinzufuegen",
        name: "Neuen TYP hinzuf\xFCgen",
        callback: () => addTypCommand(plugin)
      });
      plugin.app.workspace.onLayoutReady(() => activateTypView(plugin, false, false));
      const refresh = () => {
        for (const leaf of plugin.app.workspace.getLeavesOfType(VIEW_TYPE_TYP)) {
          leaf.view?.render?.();
        }
      };
      const debouncedRefresh = debounce(refresh, 500, true);
      plugin.registerEvent(plugin.typIndex.on("change", debouncedRefresh));
      plugin.registerEvent(plugin.app.vault.on("config-changed", debouncedRefresh));
      return refresh;
    }
    async function activateTypView(plugin, reveal = true, createIfMissing = true) {
      const app = plugin.app;
      const { workspace } = app;
      const candidates = [];
      workspace.iterateAllLeaves((leaf2) => {
        if (leaf2 === app.__fredTypLeaf || leaf2.view && leaf2.view.getViewType() === VIEW_TYPE_TYP) {
          candidates.push(leaf2);
        }
      });
      let leaf = candidates.shift() ?? null;
      for (const extra of candidates) extra.detach();
      if (!leaf) {
        if (!createIfMissing) return;
        leaf = workspace.getLeftLeaf(false);
        await leaf.setViewState({ type: VIEW_TYPE_TYP, active: true });
      } else if (!(leaf.view instanceof TypView)) {
        await leaf.setViewState({ type: VIEW_TYPE_TYP, active: false });
      }
      app.__fredTypLeaf = leaf;
      if (reveal) workspace.revealLeaf(leaf);
    }
    async function addTypPropertyCommand(plugin) {
      const app = plugin.app;
      const activeTypView = app.workspace.getActiveViewOfType(TypView);
      if (activeTypView && activeTypView.selectedType !== null) {
        activeTypView.frontmatterBlocks?.addBlank(null);
        return;
      }
      const file = app.workspace.getActiveFile();
      const type = plugin.typIndex.typeOf(file);
      if (!type) {
        const openLeaf = app.workspace.getLeavesOfType(VIEW_TYPE_TYP).find((leaf) => leaf.view instanceof TypView && leaf.view.selectedType !== null);
        if (openLeaf) {
          await app.workspace.revealLeaf(openLeaf);
          openLeaf.view.frontmatterBlocks?.addBlank(null);
          return;
        }
        new Notice(file ? "Aktive Notiz hat keinen TYP und in der TYP-View ist kein TYP ge\xF6ffnet." : "Keine Notiz offen und in der TYP-View ist kein TYP ge\xF6ffnet.");
        return;
      }
      await activateTypView(plugin);
      const view = app.__fredTypLeaf?.view;
      if (!(view instanceof TypView)) return;
      view.openTypeSettings(type);
      view.frontmatterBlocks?.addBlank(null);
    }
    async function addTypCommand(plugin) {
      await activateTypView(plugin);
      const view = plugin.app.__fredTypLeaf?.view;
      if (!(view instanceof TypView)) return;
      if (view.selectedType !== null) view.closeTypeSettings();
      view.startAdd();
    }
    module2.exports = { registerTypView: registerTypView2, VIEW_TYPE_TYP, compareTypes, sortTypesByMode: sortTypesByMode2, DEFAULT_SORT_ORDER: DEFAULT_SORT_ORDER2, DEFAULT_TYPE_COLOR };
  }
});

// src/file-explorer-colors.js
var require_file_explorer_colors = __commonJS({
  "src/file-explorer-colors.js"(exports2, module2) {
    var { TFile, TFolder } = require("obsidian");
    var { colorForFile } = require_type_colors();
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
    var { colorForFile } = require_type_colors();
    var GRAPH_VIEW_TYPES = ["graph", "localgraph"];
    function hexToInt(hex) {
      return parseInt(hex.replace("#", ""), 16);
    }
    function patchRenderer(plugin, renderer) {
      if (renderer.__fredTypColorPatched) return;
      renderer.__fredTypColorPatched = true;
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
        delete renderer.__fredTypColorPatched;
      });
    }
    function getGraphLeaves(app) {
      const leaves = [];
      for (const type of GRAPH_VIEW_TYPES) leaves.push(...app.workspace.getLeavesOfType(type));
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
    var { colorForFile } = require_type_colors();
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
    var { colorForFile } = require_type_colors();
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
    var { colorForFile } = require_type_colors();
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
    var { colorForFile } = require_type_colors();
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
    var { colorForFile, subtypeColor, subtypeHasOwnColor } = require_type_colors();
    var { getSubtype: getSubtype2 } = require_subtypes();
    var DOT_CLASS = "fred-typ-title-dot";
    var DOT_HOLLOW_CLASS = "fred-typ-title-dot-hollow";
    var DEFAULT_DOT_COLOR = "#888888";
    var BADGE_CLASS = "fred-typ-title-badge";
    var BADGE_PLAIN_CLASS = "fred-typ-title-badge-plain";
    var COLOR_VAR = "--fred-typ-title-color";
    var BLOCK_BADGE_CLASS = "fred-typ-block-badge";
    var BLOCK_BADGE_PLAIN_CLASS = "fred-typ-block-badge-plain";
    var BLOCK_ALIGN_TOP_CLASS = "fred-typ-block-badge-top";
    var BLOCK_ALIGN_BOTTOM_CLASS = "fred-typ-block-badge-bottom";
    var BLOCK_COLOR_VAR = "--fred-typ-block-color";
    function resolveMarker(plugin, file) {
      const style = plugin.settings.noteTitleStyle;
      if (style === "none") return { kind: "none" };
      if (style === "dot") return { kind: "dot", ...resolveDot(plugin, file) };
      const { settings } = plugin;
      const type = plugin.typIndex.typeOf(file);
      if (!type) return { kind: "none" };
      const colored = settings.noteTitleBadgeColored;
      if (colored && !settings.typeColors[type] && !settings.types.includes(type)) return { kind: "none" };
      const typeColor = settings.typeColors[type] ?? DEFAULT_DOT_COLOR;
      const label = badgeLabel(plugin, file, type);
      if (!label) return { kind: "none" };
      const { text, useSubtypeColor, subtype } = label;
      const color = colored ? useSubtypeColor ? subtypeColor(settings, type, subtype) ?? typeColor : typeColor : null;
      const position = settings.noteTitleBadgePosition;
      return { kind: position === "block" ? "block-badge" : "title-badge", colored, color, typeName: text };
    }
    function badgeLabel(plugin, file, type) {
      const { settings } = plugin;
      const subtype = plugin.typIndex.subtypeOf(file);
      const mode = settings.noteTitleBadgeLabel ?? "type";
      if (mode === "subtype") return subtype ? { text: subtype, useSubtypeColor: true, subtype } : null;
      if (!subtype || mode === "type") return { text: type, useSubtypeColor: false, subtype };
      return { text: `${type}/${subtype}`, useSubtypeColor: !!settings.colorViews.noteTitleMarkerSubtyp, subtype };
    }
    function resolveDot(plugin, file) {
      const type = plugin.typIndex.typeOf(file);
      if (!type) return { color: null, hollow: false };
      const { settings } = plugin;
      const typeColor = settings.typeColors[type];
      if (!typeColor) {
        return settings.types.includes(type) ? { color: DEFAULT_DOT_COLOR, hollow: true } : { color: null, hollow: false };
      }
      const subtype = plugin.typIndex.subtypeOf(file);
      if (settings.colorViews.noteTitleMarkerSubtyp && subtype && getSubtype2(settings, type, subtype)) {
        return { color: subtypeColor(settings, type, subtype), hollow: !subtypeHasOwnColor(settings, type, subtype) };
      }
      return { color: typeColor, hollow: false };
    }
    function applyStyleToTitle(titleEl, marker) {
      const isDot = marker.kind === "dot" && !!marker.color;
      const isBadge = marker.kind === "title-badge";
      titleEl.classList.toggle(DOT_CLASS, isDot);
      titleEl.classList.toggle(DOT_HOLLOW_CLASS, isDot && !!marker.hollow);
      titleEl.classList.toggle(BADGE_CLASS, isBadge && marker.colored);
      titleEl.classList.toggle(BADGE_PLAIN_CLASS, isBadge && !marker.colored);
      if (isBadge) titleEl.dataset.fredTyp = marker.typeName;
      else delete titleEl.dataset.fredTyp;
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
      if (isBlockBadge) blockEl.dataset.fredTyp = marker.typeName;
      else delete blockEl.dataset.fredTyp;
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
    var { colorForFile } = require_type_colors();
    var COLOR_VAR = "--link-color";
    var SOURCE_ATTR = "data-fred-typ-src";
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
            class: "fred-typ-link",
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
          // Der Parser arbeitet den sichtbaren Bereich ggf. erst nach und nach ab -
          // ein neuer Syntaxbaum zählt daher ebenfalls als Anlass zum Neuaufbau.
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
    var { getSubtypeNames: getSubtypeNames2, getSubtype: getSubtype2 } = require_subtypes();
    var { subtypeColor } = require_type_colors();
    var TYP_PROPERTY2 = "TYP";
    var TYP_VIEW_TYPE = "fred-typ-view";
    var ALL_PROPERTIES_VIEW_TYPE = "all-properties";
    var HIGHLIGHT_CLASS = "fred-typ-default-property";
    var FLOATING_CLASS = "fred-typ-floating-property";
    function rawKeysForType(type, defaults) {
      if (!type || !defaults) return null;
      const keys = Object.keys(defaults).filter((key) => key !== "" && key.toLowerCase() !== TYP_PROPERTY2.toLowerCase());
      return keys.length > 0 ? keys.map((key) => key.toLowerCase()) : null;
    }
    var ALL_SUBTYPES = Symbol("all-subtypes");
    function blockOf(defaults, floatingKeys, section = null) {
      const keys = rawKeysForType(true, defaults) ?? [];
      return { section, keys, floating: new Set((floatingKeys ?? []).map((key) => key.toLowerCase())) };
    }
    function blocksForType(plugin, type, subtype) {
      const { settings } = plugin;
      const blocks = [blockOf(settings.typeDefaultFrontmatter[type], settings.typeFloatingKeys[type], null)];
      const subtypeNames = subtype === ALL_SUBTYPES ? getSubtypeNames2(settings, type) : subtype ? [subtype] : [];
      for (const name of subtypeNames) {
        const data = getSubtype2(settings, type, name);
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
      const type = plugin.typIndex.typeOf(file);
      if (!type) return NO_KEYS;
      const subtype = colorViews.frontmatterDefaultsSubtyp ? plugin.typIndex.subtypeOf(file) : null;
      return splitKeys(blocksForType(plugin, type, subtype));
    }
    function keysForStore(plugin, store) {
      const { colorViews } = plugin.settings;
      if (!colorViews.frontmatterDefaults || !store) return NO_KEYS;
      if (store.subtype && !colorViews.frontmatterDefaultsSubtyp) return NO_KEYS;
      return splitKeys([blockOf(store.getFrontmatter(), store.getFloating())]);
    }
    function typesUsingKeyMap(plugin) {
      const map = /* @__PURE__ */ new Map();
      const { colorViews } = plugin.settings;
      if (!colorViews.allProperties) return map;
      const types = /* @__PURE__ */ new Set([
        ...Object.keys(plugin.settings.typeDefaultFrontmatter),
        ...colorViews.allPropertiesSubtyp ? Object.keys(plugin.settings.typeSubtypes ?? {}) : []
      ]);
      for (const type of types) {
        const blocks = blocksForType(plugin, type, colorViews.allPropertiesSubtyp ? ALL_SUBTYPES : null);
        for (const { section, keys, floating } of blocks) {
          for (const key of keys) {
            if (!map.has(key)) map.set(key, { types: /* @__PURE__ */ new Map(), allFloating: true });
            const entry = map.get(key);
            if (!entry.types.has(type)) entry.types.set(type, []);
            entry.types.get(type).push(section);
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
      const usageMap = typesUsingKeyMap(plugin);
      for (const leaf of plugin.app.workspace.getLeavesOfType(ALL_PROPERTIES_VIEW_TYPE)) {
        const doms = leaf.view?.doms;
        if (!doms) continue;
        for (const [key, dom] of Object.entries(doms)) {
          const titleEl = dom?.titleEl;
          if (!titleEl) continue;
          const entry = usageMap.get(key.toLowerCase());
          const types = entry?.types;
          const count = types ? types.size : 0;
          titleEl.classList.toggle(HIGHLIGHT_CLASS, count > 1);
          titleEl.classList.toggle(FLOATING_CLASS, count > 0 && entry.allFloating);
          if (count === 1) {
            const [[onlyType, sections]] = types;
            const color = plugin.settings.colorViews.allPropertiesSubtyp ? subtypeColor(plugin.settings, onlyType, sections.length === 1 ? sections[0] : null) : plugin.settings.typeColors[onlyType];
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
      for (const leaf of plugin.app.workspace.getLeavesOfType(TYP_VIEW_TYPE)) {
        for (const editor of leaf.view?.frontmatterEditors ?? []) {
          const { standard, floating } = keysForStore(plugin, editor.owner?.fredStore);
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
    var { typeStore, subtypeStore } = require_type_frontmatter_editor();
    var { getSubtypeNames: getSubtypeNames2, isEmptyValue } = require_subtypes();
    var TYP_PROPERTY2 = "TYP";
    var SUBTYP_PROPERTY2 = "SUBTYP";
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
      let typeCount = 0;
      let subtypeCount = 0;
      const count = (store) => store.subtype ? subtypeCount++ : typeCount++;
      const types = /* @__PURE__ */ new Set([...Object.keys(settings.typeDefaultFrontmatter), ...Object.keys(settings.typeSubtypes ?? {})]);
      for (const type of types) {
        const stores = [typeStore(plugin, type), ...getSubtypeNames2(settings, type).map((subtype) => subtypeStore(plugin, type, subtype))];
        for (const store of stores) {
          if (renameInStore(store, oldKey, newKey)) count(store);
        }
      }
      const orderChanged = renameInGlobalOrder(settings, oldKey, newKey);
      if (typeCount === 0 && subtypeCount === 0 && !orderChanged) return;
      await plugin.saveSettings();
      plugin.refreshTypColors?.();
      const parts = [];
      if (typeCount > 0) parts.push(`${typeCount} TYP${typeCount === 1 ? "" : "en"}`);
      if (subtypeCount > 0) parts.push(`${subtypeCount} Subtyp${subtypeCount === 1 ? "" : "en"}`);
      if (orderChanged) parts.push("globaler Reihenfolge");
      new Notice(`TYP-System: \u201E${oldKey}\u201C \u2192 \u201E${newKey}\u201C in ${parts.join(" und ")} umbenannt.`);
    }
    function registerPropertyRenameSync2(plugin) {
      const fileManager = plugin.app.fileManager;
      if (fileManager.__fredTypRenameSyncPatched) return;
      fileManager.__fredTypRenameSyncPatched = true;
      const original = fileManager.renameProperty;
      fileManager.renameProperty = async function(oldKey, newKey, ...rest) {
        const result = await original.call(this, oldKey, newKey, ...rest);
        try {
          await syncRename(plugin, oldKey, newKey);
        } catch (error) {
          console.error("TYP-System: Property-Umbenennung nicht \xFCbernommen", error);
          new Notice(`TYP-System: Umbenennung von \u201E${oldKey}\u201C nicht \xFCbernommen \u2013 ${error.message}`);
        }
        return result;
      };
      plugin.register(() => {
        fileManager.renameProperty = original;
        delete fileManager.__fredTypRenameSyncPatched;
      });
    }
    module2.exports = { registerPropertyRenameSync: registerPropertyRenameSync2 };
  }
});

// src/type-picker.js
var require_type_picker = __commonJS({
  "src/type-picker.js"(exports2, module2) {
    var { FuzzySuggestModal, Notice, prepareFuzzySearch } = require("obsidian");
    var { compareTypes, DEFAULT_SORT_ORDER: DEFAULT_SORT_ORDER2 } = require_typ_view();
    var { nameColor, paintColorDot } = require_type_colors();
    var TypPickerModal = class extends FuzzySuggestModal {
      constructor(app, plugin, items, resolve) {
        super(app);
        this.plugin = plugin;
        this.items = items;
        this.resolve = resolve;
        this.chosen = false;
        this.setPlaceholder("ESC f\xFCr Abbruch");
      }
      getItems() {
        return this.items;
      }
      // Fuzzy-Suche greift auch auf die Beschreibung, nicht nur auf den TYP-Namen -
      // und auf die Subtypen, wo sie in der Zeile stehen (showSubtypes, siehe
      // typeItems): sie sind dann sichtbar, also erwartet man auch, sie tippen zu
      // können, und im separaten Ablauf ist der TYP darüber der Weg zu ihnen.
      getItemText(item) {
        return [item.type, item.subtypes?.join(" "), item.description].filter(Boolean).join(" ");
      }
      renderSuggestion(match, el) {
        const item = match.item;
        el.addClass("fred-typ-picker-suggestion");
        if (item.unregistered) el.addClass("fred-typ-picker-unregistered");
        if (item.unregistered) {
          el.createSpan({ cls: "fred-typ-picker-name", text: item.type });
        } else {
          this.renderColoredName(el, item.type, item.type);
        }
        if (item.subtypes?.length) this.renderSubtypePreview(el, item);
        if (item.description) {
          el.createSpan({ cls: "fred-typ-picker-desc", text: item.description });
        }
        el.createSpan({ cls: "fred-typ-picker-count", text: String(item.count) });
      }
      // Name in der Farbe von colorType (bzw. des Subtyps, siehe nameColor in
      // type-colors.js - dieselbe Grundlage nutzt die Subtyp-Vorschau der TYP-Liste)
      // - je nach Einstellung "TYP View einfärben" als eingefärbter Text oder mit
      // vorangestelltem Farbpunkt.
      renderColoredName(el, text, colorType, subtype = null) {
        const { color, isDefault } = nameColor(this.plugin.settings, colorType, subtype);
        if (this.plugin.settings.colorViews.typList) {
          el.createSpan({ cls: "fred-typ-picker-name", text }).style.color = color;
        } else {
          paintColorDot(el.createSpan({ cls: "fred-typ-picker-dot" }), color, isDefault);
          el.createSpan({ cls: "fred-typ-picker-name", text });
        }
      }
      // "TYP (Subtyp 1, Subtyp 2)" - welche Subtypen unter dem TYP liegen, schon
      // in der TYP-Auswahl des separaten Ablaufs (siehe pickTypeAndSubtype), wo
      // der Subtyp-Picker erst danach kommt. Jeder Subtyp in seiner eigenen Farbe,
      // Klammern und Kommas muted; ohne "TYP View einfärben" bleibt die Vorschau
      // wie der Name selbst ungefärbt.
      renderSubtypePreview(el, item) {
        const colorize = this.plugin.settings.colorViews.typList;
        const wrap = el.createSpan({ cls: "fred-typ-picker-subtypes" });
        wrap.appendText("(");
        item.subtypes.forEach((subtype, index) => {
          if (index > 0) wrap.appendText(", ");
          const span = wrap.createSpan({ text: subtype });
          if (colorize) span.style.color = nameColor(this.plugin.settings, item.type, subtype).color;
        });
        wrap.appendText(")");
      }
      // Obsidians SuggestModal.selectSuggestion() ruft intern erst this.close()
      // auf und danach erst onChooseSuggestion()/onChooseItem() - "chosen" hier zu
      // setzen (statt in onChooseItem) ist daher nicht bloß Geschmackssache: würde
      // es erst in onChooseItem gesetzt, hätte das close()-ausgelöste onClose()
      // unten "chosen" noch als false gesehen und das Promise fälschlich schon mit
      // null aufgelöst, bevor der eigentliche onChooseItem-Aufruf überhaupt lief -
      // das zweite resolve() greift dann nicht mehr (ein Promise löst nur einmal
      // auf), das Ergebnis war unabhängig von der Auswahl immer null.
      selectSuggestion(item, evt) {
        this.chosen = true;
        this.query = this.inputEl.value.trim();
        super.selectSuggestion(item, evt);
      }
      onChooseItem(item) {
        this.resolve(item.type);
      }
      // ESC (oder Klick daneben) schließt das Modal ohne selectSuggestion - dann
      // statt eines hängenden Promise mit null auflösen, analog zu
      // tp.system.suggester.
      onClose() {
        super.onClose();
        if (!this.chosen) this.resolve(null);
      }
    };
    var SubtypPickerModal = class extends TypPickerModal {
      constructor(app, plugin, type, items, resolve, query = "") {
        super(app, plugin, items, resolve);
        this.type = type;
        this.setPlaceholder(`Subtyp f\xFCr ${type} \u2013 ESC f\xFCr zur\xFCck`);
        this.items = sortByQuery(items, query, (item) => this.getItemText(item));
      }
      // Die "ohne Subtyp"-Zeile ist auch über den TYP-Namen zu finden, den sie
      // zeigt - ein im TYP-Picker getipptes "ORGA" holt sie damit von allein
      // wieder an den Anfang, obwohl dort der TYP und nicht ein Subtyp gemeint war.
      getItemText(item) {
        return item.none ? `${this.type} ${item.type}` : super.getItemText(item);
      }
      renderSuggestion(match, el) {
        const item = match.item;
        el.addClass("fred-typ-picker-suggestion");
        if (item.none) {
          this.renderColoredName(el, this.type, this.type);
          el.createSpan({ cls: "fred-typ-picker-none", text: `(${item.type})` });
        } else {
          this.renderColoredName(el, item.type, this.type, item.type);
        }
        el.createSpan({ cls: "fred-typ-picker-count", text: String(item.count) });
      }
      onChooseItem(item) {
        this.resolve(item.none ? "" : item.type);
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
        for (const { item, subtypes } of this.groups) {
          const typeMatch = search ? search(this.getItemText(item)) : noMatch;
          let subtypeMatches = subtypes.map((subtype) => ({ item: subtype, match: search ? search(subtype.subtype) : noMatch }));
          if (!typeMatch) subtypeMatches = subtypeMatches.filter((entry) => entry.match);
          if (!typeMatch && subtypeMatches.length === 0) continue;
          const scores = [typeMatch, ...subtypeMatches.map((entry) => entry.match)].filter(Boolean).map((match) => match.score);
          results.push({
            score: Math.max(...scores),
            rows: [{ item, match: typeMatch ?? noMatch }, ...subtypeMatches.map((entry) => ({ item: entry.item, match: entry.match ?? noMatch }))]
          });
        }
        if (search) results.sort((a, b) => b.score - a.score);
        return results.flatMap((group) => group.rows);
      }
      renderSuggestion(match, el) {
        const item = match.item;
        if (!item.subtype) {
          super.renderSuggestion(match, el);
          return;
        }
        el.addClass("fred-typ-picker-suggestion", "fred-typ-picker-subtype");
        this.renderColoredName(el, item.subtype, item.type, item.subtype);
        el.createSpan({ cls: "fred-typ-picker-count", text: String(item.count) });
      }
      onChooseItem(item) {
        this.resolve({ type: item.type, subtype: item.subtype ?? null });
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
    function pickSubtype(app, plugin, type, query = "") {
      return new Promise((resolve) => {
        const items = plugin.getSubtypes(type).map(({ subtype, count }) => ({ type: subtype, description: "", count }));
        if (items.length === 0) {
          resolve("");
          return;
        }
        const noneCount = plugin.typIndex.subtypeBucket(type).noSubtype;
        items.unshift({ type: "ohne Subtyp", description: "", count: noneCount, none: true });
        new SubtypPickerModal(app, plugin, type, items, resolve, query).open();
      });
    }
    function unregisteredItems(app, plugin) {
      const registered = new Set(plugin.settings.types);
      const { counts } = plugin.typIndex.typeCounts();
      const sortOrder = plugin.settings.typSortOrder ?? DEFAULT_SORT_ORDER2;
      return [...counts.keys()].filter((type) => !registered.has(type) && plugin.typIndex.isCleanKey(type)).sort((a, b) => compareTypes(sortOrder, a, b, counts, plugin.settings.typeColors)).map((type) => ({ type, description: "", count: counts.get(type) ?? 0, unregistered: true }));
    }
    function pickType(app, plugin, options = {}) {
      return pickTypeEntry(app, plugin, options).then((entry) => entry?.type ?? null);
    }
    function pickTypeEntry(app, plugin, options = {}) {
      return new Promise((resolve) => {
        const items = typeItems(app, plugin, options);
        if (!items) {
          resolve(null);
          return;
        }
        const modal = new TypPickerModal(app, plugin, items, (type) => resolve(type === null ? null : { type, query: modal.query }));
        modal.open();
      });
    }
    function typeItems(app, plugin, { includeManualOff = false, includeUnregistered = false, showSubtypes = false } = {}) {
      const items = plugin.getTypes({ includeManualOff }).map((item) => ({ ...item, unregistered: false }));
      if (includeUnregistered) items.push(...unregisteredItems(app, plugin));
      if (showSubtypes) {
        for (const item of items) item.subtypes = plugin.getSubtypes(item.type).map(({ subtype }) => subtype);
      }
      if (items.length > 0) return items;
      new Notice("Keine TYPen vorhanden.");
      return null;
    }
    async function pickTypeAndSubtype(app, plugin, options = {}) {
      if (plugin.settings.separateSubtypePicker) {
        while (true) {
          const entry = await pickTypeEntry(app, plugin, { ...options, showSubtypes: true });
          if (!entry) return null;
          const subtype = await pickSubtype(app, plugin, entry.type, entry.query);
          if (subtype !== null) return { type: entry.type, subtype: subtype || null };
        }
      }
      const items = typeItems(app, plugin, options);
      if (!items) return null;
      const groups = items.map((item) => ({
        item,
        subtypes: plugin.getSubtypes(item.type).map(({ subtype, count }) => ({ type: item.type, subtype, count }))
      }));
      return new Promise((resolve) => new TypSubtypPickerModal(app, plugin, groups, resolve).open());
    }
    module2.exports = { pickType, pickSubtype, pickTypeAndSubtype };
  }
});

// src/shortcut-scripts.js
var require_shortcut_scripts = __commonJS({
  "src/shortcut-scripts.js"(exports2, module2) {
    var { TFile, Vault, debounce, normalizePath } = require("obsidian");
    var SHORTCUT_MARKER = /^[ \t]*(?:\/\/+|\/\*+|\*)[ \t]*@typ-shortcut\b(?:\(([^)]*)\))?[ \t]*(.*?)[ \t]*(?:\*\/)?[ \t]*$/m;
    function parseParams(raw) {
      const namen = (raw ?? "").split(",").map((name) => name.trim()).filter((name) => name !== "");
      return [...new Set(namen)];
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
            console.error(`TYP-System: Templater-Skript ${file.path} nicht lesbar`, e);
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
var { registerTypView, sortTypesByMode, DEFAULT_SORT_ORDER } = require_typ_view();
var { TypIndex, setCanonicalProperty, deleteProperty, TYP_PROPERTY, SUBTYP_PROPERTY } = require_typ_index();
var { getSubtype, getSubtypeNames, migrateAboveStandard, migrateSubtypeColorScale } = require_subtypes();
var { DEFAULT_SUBTYPE_COLOR_RANGES } = require_type_colors();
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
var { normalizeGlobalOrder, sortFrontmatterFor, placePropertyFor } = require_frontmatter_sort();
var { resolveShortcuts, scriptNameOf, resolveCallArgs } = require_shortcuts();
var {
  pickType: pickTypeModal,
  pickSubtype: pickSubtypeModal,
  pickTypeAndSubtype: pickTypeAndSubtypeModal
} = require_type_picker();
var { registerShortcutScripts } = require_shortcut_scripts();
function migrateFloatingFrontmatter(settings) {
  if (!settings.typeFloatingFrontmatter) return;
  for (const [type, floating] of Object.entries(settings.typeFloatingFrontmatter)) {
    const keys = Object.keys(floating).filter((key) => key !== "");
    if (keys.length === 0) continue;
    settings.typeDefaultFrontmatter[type] = { ...settings.typeDefaultFrontmatter[type] ?? {}, ...floating };
    settings.typeFloatingKeys[type] = [.../* @__PURE__ */ new Set([...settings.typeFloatingKeys[type] ?? [], ...keys])];
  }
  delete settings.typeFloatingFrontmatter;
}
function migrateTypListSecondary(settings, stored) {
  if (stored?.typListDescriptionEnabled === void 0) return false;
  if (stored.typListSecondary === void 0) {
    settings.typListSecondary = stored.typListDescriptionEnabled ? "description" : "none";
  }
  delete settings.typListDescriptionEnabled;
  return true;
}
function dropTypListSubtypesAlign(settings) {
  if (settings.typListSubtypesRightAligned === void 0) return false;
  delete settings.typListSubtypesRightAligned;
  return true;
}
module.exports = class TypSystemPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.typIndex = new TypIndex(this);
    this.typIndex.register();
    registerCommands(this);
    this.addSettingTab(new TypSystemSettingTab(this.app, this));
    registerPropertyRenameSync(this);
    this.getShortcutScripts = registerShortcutScripts(this);
    this.refreshFrontmatterHighlight = registerFrontmatterDefaultHighlight(this);
    const refreshFns = [
      registerTypView(this),
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
  // Für _obsidian/templater-scripts/TYP.js: liefert die im TYP-View unter
  // "TYP-Frontmatter" hinterlegten Properties für den gegebenen TYP, damit
  // Templater sie beim Anlegen einer neuen Notiz übernehmen kann, statt sie dort
  // ein zweites Mal zu pflegen. Kopie statt direkter Referenz, damit ein
  // Aufrufer die zurückgegebenen Werte gefahrlos mutieren kann, ohne die
  // Plugin-Settings zu verändern.
  //
  // Properties mit einem festen Shortcut (today/now/created, siehe
  // shortcuts.js) tragen dessen erst hier aufgelösten Wert - nicht den beim
  // Setzen gültigen, es kommt also bei jedem Aufruf frisch Berechnetes heraus.
  // Properties mit einem Skript-Shortcut tragen null: die kann nur Templater
  // auflösen, TYP.js holt sie sich über getTypeShortcuts() (unten) und setzt
  // sie selbst ein. Key und Position bleiben in beiden Fällen erhalten.
  //
  // includeFloating (Standard: false) lässt die als "Floating Property"
  // markierten Keys (typeFloatingKeys) in der Liste - anders als die übrigen
  // Standard-Properties werden diese NICHT automatisch bei jeder neuen Notiz
  // angelegt (sie zählen zwar für die Frontmatter-Sortierung mit, siehe
  // orderedDefaultKeys in frontmatter-sort.js, sollen aber nur bei Bedarf
  // explizit von einem Templater-Skript abgegriffen werden).
  //
  // file (optional) wird an resolveShortcuts() durchgereicht - nur für den
  // "created"-Shortcut relevant, der das Erstellungsdatum der Ziel-Datei statt
  // des Aufrufzeitpunkts liefert.
  //
  // subtype (optional): ergänzt das TYP-Frontmatter um den Block dieses
  // Subtyps (siehe subtypes.js), dessen Keys folgen dahinter (wichtig für die
  // Reihenfolge der Skript-Shortcuts). Steht ein Key in BEIDEN Blöcken, behält
  // er die Position des TYP-Frontmatters, Wert, Floating-Markierung und
  // Shortcut kommen aber vom Subtyp - eine Zuweisung auf einen bereits vorhandenen
  // Objektschlüssel überschreibt ihn, ohne ihn zu verschieben. Die
  // Frontmatter-Sortierung muss dieselbe Regel verwenden, sonst würde sie
  // eine gerade angelegte Notiz sofort wieder umsortieren (siehe
  // orderedDefaultKeys in frontmatter-sort.js).
  getTypeDefaults(type, { includeFloating = false, file, subtype = null } = {}) {
    const { defaults, shortcuts } = this.collectBlocks(type, subtype, includeFloating);
    return resolveShortcuts(defaults, shortcuts, { file, app: this.app });
  }
  // Gemeinsame Grundlage von getTypeDefaults() und getTypeShortcuts(): das
  // TYP-Frontmatter des Typs, ergänzt um den Block des Subtyps. Ein Key, der in
  // BEIDEN Blöcken steht, behält die Position des TYP-Frontmatters; Wert,
  // Floating-Markierung UND Shortcut kommen dann vom Subtyp - auch "kein
  // Shortcut" gilt dabei als Angabe des Subtyps und hebt den des TYPs auf.
  collectBlocks(type, subtype, includeFloating) {
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
    const subtypeData = subtype ? getSubtype(this.settings, type, subtype) : null;
    addBlock(
      this.settings.typeDefaultFrontmatter[type],
      this.settings.typeFloatingKeys[type],
      this.settings.typeShortcuts[type]
    );
    if (subtypeData) addBlock(subtypeData.frontmatter, subtypeData.floatingKeys, subtypeData.shortcuts);
    if (!includeFloating) {
      for (const [key, floating] of isFloating) {
        if (!floating) continue;
        delete defaults[key];
        delete shortcuts[key];
      }
    }
    return { defaults, shortcuts };
  }
  // Für _obsidian/templater-scripts/TYP.js: die Properties dieses TYPs, deren
  // Wert beim Anlegen einer Notiz von einem Templater-Skript kommt -
  // { [Property]: { name, args, fallback } }, in der Reihenfolge des
  // TYP-Frontmatters (die Skripte laufen nacheinander und sehen die Ergebnisse
  // der jeweils früheren).
  //
  //   name     Skriptname, also tp.user.<name> - ohne "tp."-Präfix
  //   params   die im @typ-shortcut-Marker deklarierte Parameterliste des
  //            Skripts (siehe shortcut-scripts.js), oder null bei einem Marker
  //            ohne Klammern. Sie stammt aus dem aktuellen Scan, nicht aus dem
  //            gespeicherten Record - eine geänderte Deklaration wirkt also
  //            sofort. TYP.js macht daraus mit resolveShortcutArgs() unten die
  //            Argumentliste des Aufrufs
  //   args     die eingetippten Argumente, benannt nach den nicht reservierten
  //            Parametern. Leeres Objekt, wenn keine gesetzt sind; ein leer
  //            gelassenes Feld fehlt darin ganz, damit "args.x ?? fallback"
  //            im Skript trägt
  //   fallback der in der TYP-Ansicht hinterlegte feste Wert der Property. Nur
  //            als RÜCKFALL gedacht: schlägt das Skript fehl (fehlt oder
  //            wirft), schreibt TYP.js ihn statt eines leeren Werts. Ein
  //            Skript, das bewusst null/"" liefert (z. B. ESC im Picker), ist
  //            kein Fehlschlag - dort bleibt die Property leer.
  //
  // Die festen Shortcuts (today/now/created) tauchen hier NICHT auf: die löst
  // das Plugin selbst auf und liefert sie fertig über getTypeDefaults(). Dessen
  // Rückgabe führt die Skript-Keys mit dem Wert null - Key und Position bleiben
  // also erhalten, nur der Wert kommt von hier.
  //
  // Optionen wie bei getTypeDefaults(); includeFloating standardmäßig false,
  // damit für eine Floating Property nicht ungefragt ein Skript läuft.
  getTypeShortcuts(type, { includeFloating = false, subtype = null } = {}) {
    const { defaults, shortcuts } = this.collectBlocks(type, subtype, includeFloating);
    const skripte = this.getShortcutScripts?.() ?? [];
    const result = {};
    for (const [key, record] of Object.entries(shortcuts)) {
      const name = scriptNameOf(record.name);
      if (name === null) continue;
      const skript = skripte.find((s) => s.name === name);
      result[key] = {
        name,
        params: skript?.params ?? null,
        args: { ...record.args ?? {} },
        fallback: defaults[key] ?? null
      };
    }
    return result;
  }
  // Für _obsidian/templater-scripts/TYP.js: macht aus der Parameterliste eines
  // Shortcuts die Argumente für den Aufruf tp.user.<name>(tp, ...) - siehe
  // resolveCallArgs in shortcuts.js. Die Auflösung lebt hier statt in TYP.js,
  // damit die Regeln (reservierte Namen, Punkt-Namen für Objekt-Argumente) nur
  // an einer Stelle stehen; newFile und ctx kennt allerdings nur TYP.js und
  // reicht sie deshalb herein.
  resolveShortcutArgs(params, args, { newFile = null, ctx = null, key = null } = {}) {
    return resolveCallArgs(params, args, { newFile, ctx, key });
  }
  // Für _obsidian/templater-scripts/TYP.js: registrierte Subtypen eines TYPs in
  // der Reihenfolge ihrer Blöcke, samt Notiz-Anzahl.
  getSubtypes(type) {
    const { counts } = this.typIndex.subtypeBucket(type);
    return getSubtypeNames(this.settings, type).map((subtype) => ({ subtype, count: counts.get(subtype) ?? 0 }));
  }
  // Für _obsidian/templater-scripts/TYP.js: Subtyp-Picker (siehe
  // type-picker.js). Löst mit dem gewählten Subtyp auf, mit "" für "Kein
  // Subtyp" (bzw. ohne Picker, wenn der TYP keine Subtypen hat), oder mit
  // null bei ESC (TYP.js kehrt dann zur TYP-Auswahl zurück). query (optional):
  // eine schon getippte Suchanfrage, nach der die Liste vorsortiert steht.
  pickSubtype(type, query = "") {
    return pickSubtypeModal(this.app, this, type, query);
  }
  // Für _obsidian/templater-scripts/TYP.js, innerhalb von processFrontMatter:
  // setzt TYP und SUBTYP in einheitlicher Schreibweise - eine abweichend
  // geschriebene Property ("typ", "Subtyp") wird an ihrer Stelle umbenannt
  // statt verdoppelt. subtype null entfernt einen vorhandenen SUBTYP.
  applyTypeProperties(frontmatter, type, subtype) {
    setCanonicalProperty(frontmatter, TYP_PROPERTY, type);
    if (subtype) setCanonicalProperty(frontmatter, SUBTYP_PROPERTY, subtype);
    else deleteProperty(frontmatter, SUBTYP_PROPERTY);
  }
  // Für _obsidian/templater-scripts/TYP.js, innerhalb von processFrontMatter
  // und nach allen übrigen Änderungen: bringt das Frontmatter in die
  // Reihenfolge der Frontmatter-Sortierung (globale Reihenfolge, TYP-
  // Frontmatter samt Subtyp-Block) - sonst landen neu ergänzte Properties
  // (z. B. SUBTYP in einer bestehenden Notiz) am Ende.
  sortFrontmatter(frontmatter, type, subtype = null) {
    return sortFrontmatterFor(this, frontmatter, type, subtype);
  }
  // Innerhalb von processFrontMatter: setzt nur die Property key an ihren
  // Platz laut Frontmatter-Sortierung (TYP/SUBTYP aus dem Objekt selbst),
  // alles Übrige bleibt, wie es ist - z. B. für Freds Property-Backlinking,
  // damit eine neu angelegte Property nicht am Ende landet.
  placeProperty(frontmatter, key) {
    return placePropertyFor(this, frontmatter, key);
  }
  // Für _obsidian/templater-scripts/TYP.js: die im TYP-View registrierten TYPen
  // samt ihrer dort gepflegten Beschreibung, statt sie aus _obsidian/Typen.md zu parsen -
  // in derselben Reihenfolge, in der sie auch in der TYP-Liste selbst erscheinen
  // (aktuelle Sortiereinstellung dort, z. B. Häufigkeit oder Name).
  //
  // TYPen mit deaktiviertem "Manueller TYP"-Schalter (siehe TYP-Detailansicht)
  // sind nicht für die manuelle Auswahl gedacht (z. B. beim Anlegen einer neuen
  // Notiz) und werden deshalb standardmäßig ausgeklammert - Aufrufer, die
  // trotzdem alle TYPen brauchen, übergeben includeManualOff: true.
  getTypes({ includeManualOff = false } = {}) {
    const { counts } = this.typIndex.typeCounts();
    const sortOrder = this.settings.typSortOrder ?? DEFAULT_SORT_ORDER;
    return sortTypesByMode(this.settings.types, sortOrder, counts, this.settings.typeColors).filter((type) => includeManualOff || (this.settings.typeManual ?? {})[type] !== false).map((type) => ({
      type,
      description: this.settings.typeDescriptions[type] ?? "",
      count: counts.get(type) ?? 0
    }));
  }
  // Für _obsidian/templater-scripts/TYP.js: nativer TYP-Picker (siehe
  // type-picker.js) statt der reinen Text-Liste aus getTypes() +
  // tp.system.suggester - mit TYP-Farbe/-Punkt, Beschreibung und Notiz-Anzahl
  // je Zeile. includeManualOff wie bei getTypes(). Löst mit dem gewählten TYP
  // auf, oder mit null bei Abbruch (ESC).
  pickType(options) {
    return pickTypeModal(this.app, this, options);
  }
  // Für _obsidian/templater-scripts/TYP.js: TYP und Subtyp in einem Zug (siehe
  // type-picker.js) - je nach Einstellung "Subtyp-Picker separat" ein einziger
  // Picker mit eingerückten Subtypen oder beide Picker nacheinander. Optionen
  // wie bei pickType(). Löst mit { type, subtype } auf (subtype null für "ohne
  // Subtyp"), oder mit null bei Abbruch (ESC).
  pickTypeAndSubtype(options) {
    return pickTypeAndSubtypeModal(this.app, this, options);
  }
  async loadSettings() {
    const stored = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
    this.settings.colorViews = { ...DEFAULT_SETTINGS.colorViews, ...this.settings.colorViews };
    this.settings.globalPropertyOrder = normalizeGlobalOrder(this.settings.globalPropertyOrder);
    migrateFloatingFrontmatter(this.settings);
    migrateAboveStandard(this.settings);
    const migrated = [migrateSubtypeColorScale(this.settings, DEFAULT_SUBTYPE_COLOR_RANGES), migrateTypListSecondary(this.settings, stored), dropTypListSubtypesAlign(this.settings)];
    if (migrated.some(Boolean)) await this.saveSettings();
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL3R5cC1pbmRleC5qcyIsICJzcmMvc3VidHlwZXMuanMiLCAic3JjL2Zyb250bWF0dGVyLXNvcnQuanMiLCAic3JjL2Zyb250bWF0dGVyLW9yZGVyLWVkaXRvci5qcyIsICJzcmMvdHlwZS1jb2xvcnMuanMiLCAic3JjL3NldHRpbmdzLmpzIiwgInNyYy9jb21tYW5kcy5qcyIsICJzcmMvc2hvcnRjdXRzLmpzIiwgInNyYy9zaG9ydGN1dC1waWNrZXIuanMiLCAic3JjL3R5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzIiwgInNyYy9mcm9udG1hdHRlci1ibG9ja3MuanMiLCAic3JjL3R5cGUtdXRpbHMuanMiLCAic3JjL3R5cC12aWV3LmpzIiwgInNyYy9maWxlLWV4cGxvcmVyLWNvbG9ycy5qcyIsICJzcmMvZ3JhcGgtY29sb3JzLmpzIiwgInNyYy9zZWFyY2gtY29sb3JzLmpzIiwgInNyYy9yZWNlbnQtZmlsZXMtY29sb3JzLmpzIiwgInNyYy9iYWNrbGluay1jb2xvcnMuanMiLCAic3JjL2Jvb2ttYXJrLWNvbG9ycy5qcyIsICJzcmMvYWN0aXZlLXRpdGxlLWNvbG9ycy5qcyIsICJzcmMvbGluay1jb2xvcnMuanMiLCAic3JjL2Zyb250bWF0dGVyLWRlZmF1bHQtaGlnaGxpZ2h0LmpzIiwgInNyYy9wcm9wZXJ0eS1yZW5hbWUtc3luYy5qcyIsICJzcmMvdHlwZS1waWNrZXIuanMiLCAic3JjL3Nob3J0Y3V0LXNjcmlwdHMuanMiLCAic3JjL21haW4uanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IHsgRXZlbnRzLCBURmlsZSwgZGVib3VuY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcblxuY29uc3QgVFlQX1BST1BFUlRZID0gXCJUWVBcIjtcbmNvbnN0IFNVQlRZUF9QUk9QRVJUWSA9IFwiU1VCVFlQXCI7XG5jb25zdCBFTVBUWV9FTlRSWSA9IE9iamVjdC5mcmVlemUoeyB0eXBlS2V5OiBudWxsLCByYXdUeXBlOiBudWxsLCBzdWJ0eXBlS2V5OiBudWxsLCByYXdTdWJ0eXBlOiBudWxsIH0pO1xuXG4vLyBTYW1tZWx0IFx1MDBDNG5kZXJ1bmdlbiBtZWhyZXJlciBEYXRlaWVuICh6LiBCLiBVbWJlbmVubmVuIGVpbmVzIFRZUHMgaW4gdmllbGVuXG4vLyBOb3RpemVuLCBWYXVsdC1TeW5jKSB6dSBlaW5lbSBlaW56aWdlbiBcImNoYW5nZVwiLUV2ZW50LiBPaG5lIHJlc2V0VGltZXIsIGRhbWl0XG4vLyBlaW4gRGF1ZXJzdHJvbSBhbiBcdTAwQzRuZGVydW5nZW4gdHJvdHpkZW0gcmVnZWxtXHUwMEU0XHUwMERGaWcgZHVyY2hnZXJlaWNodCB3aXJkLlxuY29uc3QgRkxVU0hfREVMQVlfTVMgPSAxMDA7XG5cbmZ1bmN0aW9uIHJhd0l0ZW0odmFsdWUpIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBcIlwiO1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiID8gSlNPTi5zdHJpbmdpZnkodmFsdWUpIDogU3RyaW5nKHZhbHVlKTtcbn1cblxuLy8gRWluaGVpdGxpY2hlIEF1c2xlZ3VuZyBlaW5lcyBUWVAtV2VydHMgZlx1MDBGQ3IgZGFzIGdhbnplIFBsdWdpbjogZGVyIFdlcnQgd2lyZFxuLy8gYmV3dXNzdCBOSUNIVCBnZWdsXHUwMEU0dHRldCwgc29uZGVybiBpbiBzZWluZXIgUm9oZm9ybSB6dW0gU2NobFx1MDBGQ3NzZWwgLSBlaW4gVFlQIGlzdFxuLy8gZ2VuYXUgZWluIGVpbnplbG5lciwgc2F1YmVyZXIgV2VydC4gQWxsZXMgYW5kZXJlIChMZWVyemVpY2hlbiBhbSBSYW5kLCBrbGVpblxuLy8gZ2VzY2hyaWViZW4sIExpc3RlIC0gYXVjaCBlaW5lIGVpbmVsZW1lbnRpZ2UpIGVyZ2lidCBlaW5lbiBlaWdlbmVuIFNjaGxcdTAwRkNzc2VsLFxuLy8gZGVyIGluIGtlaW5lbSByZWdpc3RyaWVydGVuIFRZUCBhdWZnZWh0OiBlciBiZWtvbW10IGtlaW5lIEZhcmJlLCB6XHUwMEU0aGx0IG5pY2h0XG4vLyBiZWltIFwicmljaHRpZ2VuXCIgVFlQIG1pdCB1bmQgc3RlaHQgaW4gZGVyIFRZUC1WaWV3IGFscyBlaWdlbmVyLFxuLy8gdW5yZWdpc3RyaWVydGVyIEVpbnRyYWcsIHZvbiB3byBhdXMgZXIgc2ljaCBwZXIgS2xpY2sgYmVyZWluaWdlbiBsXHUwMEU0c3N0XG4vLyAoc2llaGUgcmVnaXN0ZXJUeXBlIGluIHR5cC12aWV3LmpzKS4gTGlzdGVuIGVyc2NoZWluZW4gZGFiZWkgYWxzXG4vLyBcIltBLCBCXVwiIHVuZCBrXHUwMEY2bm5lbiBzbyBuaWUgbWl0IGVpbmVtIEVpbnplbHdlcnQgXCJBLCBCXCIgenVzYW1tZW5mYWxsZW4uXG4vLyBudWxsID0ga2VpbiBUWVAgKGZlaGxlbmQsIGxlZXIsIG51ciBMZWVyemVpY2hlbiwgbGVlcmUgTGlzdGUpLlxuZnVuY3Rpb24gdHlwZUtleU9mKHZhbHVlKSB7XG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgIGNvbnN0IGl0ZW1zID0gdmFsdWUubWFwKHJhd0l0ZW0pO1xuICAgIGlmIChpdGVtcy5ldmVyeSgoaXRlbSkgPT4gaXRlbS50cmltKCkgPT09IFwiXCIpKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gYFske2l0ZW1zLmpvaW4oXCIsIFwiKX1dYDtcbiAgfVxuICBjb25zdCB0ZXh0ID0gcmF3SXRlbSh2YWx1ZSk7XG4gIHJldHVybiB0ZXh0LnRyaW0oKSA9PT0gXCJcIiA/IG51bGwgOiB0ZXh0O1xufVxuXG4vLyBPYnNpZGlhbiBiZWhhbmRlbHQgUHJvcGVydHktTmFtZW4gb2huZSBCZWFjaHR1bmcgZGVyIEdyb1x1MDBERi0vS2xlaW5zY2hyZWlidW5nXG4vLyAoXCJTdWJ0eXBcIiB1bmQgXCJTVUJUWVBcIiBzaW5kIGluIFwiQWxsIHByb3BlcnRpZXNcIiBkaWVzZWxiZSBQcm9wZXJ0eSkgLSBUWVBcbi8vIHVuZCBTVUJUWVAgd2VyZGVuIGRlc2hhbGIgZ2VuYXVzbyBnZWxlc2VuLiBEaWUgZXhha3RlIFNjaHJlaWJ3ZWlzZSBoYXRcbi8vIFZvcnJhbmcsIGZhbGxzIGVpbmUgTm90aXogKGZlaGxlcmhhZnQpIG1laHJlcmUgVmFyaWFudGVuIHRyXHUwMEU0Z3QuXG5mdW5jdGlvbiBwcm9wZXJ0eUtleU9mKGZyb250bWF0dGVyLCBuYW1lKSB7XG4gIGlmICghZnJvbnRtYXR0ZXIpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoZnJvbnRtYXR0ZXIsIG5hbWUpKSByZXR1cm4gbmFtZTtcbiAgY29uc3QgbG93ZXIgPSBuYW1lLnRvTG93ZXJDYXNlKCk7XG4gIHJldHVybiBPYmplY3Qua2V5cyhmcm9udG1hdHRlcikuZmluZCgoa2V5KSA9PiBrZXkudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXIpO1xufVxuXG5mdW5jdGlvbiBwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBuYW1lKSB7XG4gIGNvbnN0IGtleSA9IHByb3BlcnR5S2V5T2YoZnJvbnRtYXR0ZXIsIG5hbWUpO1xuICByZXR1cm4ga2V5ID09PSB1bmRlZmluZWQgPyB1bmRlZmluZWQgOiBmcm9udG1hdHRlcltrZXldO1xufVxuXG4vLyBTY2hyZWlidCB2YWx1ZSB1bnRlciBkZXIgZWluaGVpdGxpY2hlbiBTY2hyZWlid2Vpc2UgbmFtZSAoei4gQi4gXCJTVUJUWVBcIilcbi8vIGluIGRhcyB2b24gcHJvY2Vzc0Zyb250TWF0dGVyIGdlbGllZmVydGUgT2JqZWt0LiBFaW5lIGFid2VpY2hlbmRcbi8vIGdlc2NocmllYmVuZSBWYXJpYW50ZSAoXCJTdWJ0eXBcIikgd2lyZCBkYWJlaSBhbiBPcnQgdW5kIFN0ZWxsZSB1bWJlbmFubnQgLVxuLy8gT2JqZWt0LUluc2VydGlvbi1PcmRlciBiZXN0aW1tdCBkaWUgWUFNTC1SZWloZW5mb2xnZSwgZGFoZXIgYmVpIEJlZGFyZiBhbGxlXG4vLyBLZXlzIGluIGJpc2hlcmlnZXIgUmVpaGVuZm9sZ2UgbmV1IGVpbmZcdTAwRkNnZW4gKHdpZSBpbiBmcm9udG1hdHRlci1zb3J0LmpzKS5cbmZ1bmN0aW9uIHNldENhbm9uaWNhbFByb3BlcnR5KGZyb250bWF0dGVyLCBuYW1lLCB2YWx1ZSkge1xuICBjb25zdCBsb3dlciA9IG5hbWUudG9Mb3dlckNhc2UoKTtcbiAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKGZyb250bWF0dGVyKTtcbiAgaWYgKCFrZXlzLnNvbWUoKGtleSkgPT4ga2V5ICE9PSBuYW1lICYmIGtleS50b0xvd2VyQ2FzZSgpID09PSBsb3dlcikpIHtcbiAgICBmcm9udG1hdHRlcltuYW1lXSA9IHZhbHVlO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBzbmFwc2hvdCA9IHsgLi4uZnJvbnRtYXR0ZXIgfTtcbiAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykgZGVsZXRlIGZyb250bWF0dGVyW2tleV07XG4gIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICBpZiAoa2V5LnRvTG93ZXJDYXNlKCkgIT09IGxvd2VyKSBmcm9udG1hdHRlcltrZXldID0gc25hcHNob3Rba2V5XTtcbiAgICBlbHNlIGlmICghKG5hbWUgaW4gZnJvbnRtYXR0ZXIpKSBmcm9udG1hdHRlcltuYW1lXSA9IHZhbHVlO1xuICB9XG59XG5cbi8vIEVudGZlcm50IG5hbWUgaW4gamVkZXIgU2NocmVpYndlaXNlIGF1cyBkZW0gdm9uIHByb2Nlc3NGcm9udE1hdHRlclxuLy8gZ2VsaWVmZXJ0ZW4gT2JqZWt0LlxuZnVuY3Rpb24gZGVsZXRlUHJvcGVydHkoZnJvbnRtYXR0ZXIsIG5hbWUpIHtcbiAgY29uc3QgbG93ZXIgPSBuYW1lLnRvTG93ZXJDYXNlKCk7XG4gIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGZyb250bWF0dGVyKSkge1xuICAgIGlmIChrZXkudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXIpIGRlbGV0ZSBmcm9udG1hdHRlcltrZXldO1xuICB9XG59XG5cbi8vIFNVQlRZUCB3aXJkIGdlbmF1c28gYXVzZ2VsZWd0ICh0eXBlS2V5T2YpOiBlaW5lIE5vdGl6IGhhdCBoXHUwMEY2Y2hzdGVucyBlaW5lblxuLy8gU1VCVFlQIGFscyBzYXViZXJlbiBFaW56ZWx3ZXJ0LCBhbGxlcyBhbmRlcmUgaXN0IGVpbiBlaWdlbmVyLCBuaWNodFxuLy8gZXJmYXNzdGVyIFNjaGxcdTAwRkNzc2VsIChzaWVoZSBTdWJ0eXAtQmxcdTAwRjZja2UgaW4gZGVyIFRZUC1EZXRhaWxhbnNpY2h0KS5cbmZ1bmN0aW9uIHNhbWVFbnRyeShhLCBiKSB7XG4gIHJldHVybiAhIWEgJiYgISFiICYmIGEudHlwZUtleSA9PT0gYi50eXBlS2V5ICYmIGEuc3VidHlwZUtleSA9PT0gYi5zdWJ0eXBlS2V5O1xufVxuXG4vLyBaZW50cmFsZXIgVFlQLS9TVUJUWVAtSW5kZXggXHUwMEZDYmVyIGFsbGUgTWFya2Rvd24tRGF0ZWllbiAoUGZhZCAtPiBXZXJ0ZSkuXG4vL1xuLy8gWndlY2s6IGRpZSBGYXJiLU1vZHVsZSBoaW5nZW4gYmlzaGVyIGFsbGUgZGlyZWt0IGFuIG1ldGFkYXRhQ2FjaGUgXCJjaGFuZ2VkXCJcbi8vIHVuZCBcInJlc29sdmVkXCIgLSBiZWlkZSBmZXVlcm4gYmVpIEpFREVSIFx1MDBDNG5kZXJ1bmcgYW4gaXJnZW5kZWluZXIgTm90aXogKGJlaW1cbi8vIFRpcHBlbiBldHdhIGFsbGUgendlaSBTZWt1bmRlbiksIHVuZCBqZWRlcyBNb2R1bCBmXHUwMEU0cmJ0ZSBkYXJhdWZoaW4gc2VpbmVcbi8vIGtvbXBsZXR0ZSBBbnNpY2h0IG5ldSwgZG9wcGVsdC4gRGVyIEluZGV4IHZlcmdsZWljaHQgc3RhdHRkZXNzZW4gamUgRGF0ZWksIG9iXG4vLyBzaWNoIFRZUCBvZGVyIFNVQlRZUCB0YXRzXHUwMEU0Y2hsaWNoIGdlXHUwMEU0bmRlcnQgaGF0IChiencuIGVpbmUgTm90aXogaGluenVrYW0vXG4vLyB3ZWdmaWVsKSwgdW5kIGZldWVydCBudXIgZGFubiBzZWluIGVpZ2VuZXMgXCJjaGFuZ2VcIi1FdmVudCAoQXJndW1lbnQ6IFNldCBkZXJcbi8vIGJldHJvZmZlbmVuIFBmYWRlKS4gTm9ybWFsZXMgU2NocmVpYmVuIGxcdTAwRjZzdCBkYW1pdCBnYXIga2VpbiBOZXUtRWluZlx1MDBFNHJiZW4gbWVociBhdXMuXG4vL1xuLy8gWnVzXHUwMEU0dHpsaWNoIGhcdTAwRTRsdCBlciBkaWUgdmF1bHQtd2VpdGVuIFpcdTAwRTRobHVuZ2VuIChUWVAtTGlzdGUsIFNVQlRZUC1MaXN0ZSxcbi8vIFBpY2tlciwgZ2V0VHlwZXMoKSBmXHUwMEZDciBUZW1wbGF0ZXIpIHp3aXNjaGVuZ2VzcGVpY2hlcnQsIHN0YXR0IHNpZSBiZWkgamVkZW1cbi8vIEF1ZnJ1ZiBwZXIgU2NhbiBcdTAwRkNiZXIgYWxsZSBOb3RpemVuIG5ldSB6dSBiZXJlY2huZW4uXG5jbGFzcyBUeXBJbmRleCBleHRlbmRzIEV2ZW50cyB7XG4gIGNvbnN0cnVjdG9yKHBsdWdpbikge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gICAgdGhpcy5hcHAgPSBwbHVnaW4uYXBwO1xuICAgIHRoaXMuZW50cmllcyA9IG5ldyBNYXAoKTtcbiAgICB0aGlzLmJ1aWx0ID0gZmFsc2U7XG4gICAgdGhpcy5hZ2dyZWdhdGVzID0gbnVsbDtcbiAgICB0aGlzLnBlbmRpbmdQYXRocyA9IG5ldyBTZXQoKTtcbiAgICB0aGlzLmZsdXNoID0gZGVib3VuY2UoKCkgPT4ge1xuICAgICAgY29uc3QgcGF0aHMgPSB0aGlzLnBlbmRpbmdQYXRocztcbiAgICAgIHRoaXMucGVuZGluZ1BhdGhzID0gbmV3IFNldCgpO1xuICAgICAgdGhpcy50cmlnZ2VyKFwiY2hhbmdlXCIsIHBhdGhzKTtcbiAgICB9LCBGTFVTSF9ERUxBWV9NUyk7XG4gIH1cblxuICByZWdpc3RlcigpIHtcbiAgICBjb25zdCB7IHBsdWdpbiwgYXBwIH0gPSB0aGlzO1xuICAgIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC5tZXRhZGF0YUNhY2hlLm9uKFwiY2hhbmdlZFwiLCAoZmlsZSkgPT4gdGhpcy51cGRhdGUoZmlsZSkpKTtcbiAgICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAubWV0YWRhdGFDYWNoZS5vbihcImRlbGV0ZWRcIiwgKGZpbGUpID0+IHRoaXMucmVtb3ZlKGZpbGUucGF0aCkpKTtcbiAgICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJyZW5hbWVcIiwgKGZpbGUsIG9sZFBhdGgpID0+IHRoaXMucmVuYW1lKGZpbGUsIG9sZFBhdGgpKSk7XG4gICAgLy8gXCJFeGNsdWRlZCBmaWxlc1wiLUxpc3RlIGdlXHUwMEU0bmRlcnQgKHNpZWhlIHJlZ2lzdGVyVHlwVmlldykgLSBkaWUgRWludHJcdTAwRTRnZVxuICAgIC8vIHNlbGJzdCBibGVpYmVuIGdcdTAwRkNsdGlnLCBudXIgZGllIGRhcmF1cyBnZWZpbHRlcnRlbiBaXHUwMEU0aGx1bmdlbiBuaWNodC5cbiAgICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJjb25maWctY2hhbmdlZFwiLCAoKSA9PiAodGhpcy5hZ2dyZWdhdGVzID0gbnVsbCkpKTtcblxuICAgIC8vIEJlaW0gQXBwLVN0YXJ0IGthbm4gZGVyIGVyc3RlIFp1Z3JpZmYgKGxhenksIHNpZWhlIGVuc3VyZUJ1aWx0KSBub2NoIHZvclxuICAgIC8vIGRlbSB2b2xsc3RcdTAwRTRuZGlnIGdlbGFkZW5lbiBNZXRhZGF0YUNhY2hlIGxpZWdlbi4gRWlubWFsaWcgbmFjaCBkZXNzZW5cbiAgICAvLyBlcnN0ZW0ga29tcGxldHRlbiBBdWZsXHUwMEY2c3VuZ3NkdXJjaGxhdWYgbmV1IGF1ZmJhdWVuOyBBYndlaWNodW5nZW4gbGFuZGVuXG4gICAgLy8gZGFiZWkgd2llIGplZGUgYW5kZXJlIFx1MDBDNG5kZXJ1bmcgaW0gXCJjaGFuZ2VcIi1FdmVudC5cbiAgICBjb25zdCByZXNvbHZlZFJlZiA9IGFwcC5tZXRhZGF0YUNhY2hlLm9uKFwicmVzb2x2ZWRcIiwgKCkgPT4ge1xuICAgICAgYXBwLm1ldGFkYXRhQ2FjaGUub2ZmcmVmKHJlc29sdmVkUmVmKTtcbiAgICAgIHRoaXMucmVidWlsZCgpO1xuICAgIH0pO1xuICAgIHBsdWdpbi5yZWdpc3RlckV2ZW50KHJlc29sdmVkUmVmKTtcblxuICAgIHBsdWdpbi5yZWdpc3RlcigoKSA9PiB0aGlzLmZsdXNoLmNhbmNlbCgpKTtcbiAgfVxuXG4gIHJlYWQoZmlsZSkge1xuICAgIGNvbnN0IGZyb250bWF0dGVyID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyO1xuICAgIGNvbnN0IHJhd1R5cGUgPSBwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBUWVBfUFJPUEVSVFkpID8/IG51bGw7XG4gICAgY29uc3QgcmF3U3VidHlwZSA9IHByb3BlcnR5VmFsdWUoZnJvbnRtYXR0ZXIsIFNVQlRZUF9QUk9QRVJUWSkgPz8gbnVsbDtcbiAgICByZXR1cm4geyB0eXBlS2V5OiB0eXBlS2V5T2YocmF3VHlwZSksIHJhd1R5cGUsIHN1YnR5cGVLZXk6IHR5cGVLZXlPZihyYXdTdWJ0eXBlKSwgcmF3U3VidHlwZSB9O1xuICB9XG5cbiAgZW5zdXJlQnVpbHQoKSB7XG4gICAgaWYgKCF0aGlzLmJ1aWx0KSB0aGlzLnJlYnVpbGQoKTtcbiAgfVxuXG4gIHJlYnVpbGQoKSB7XG4gICAgY29uc3QgcHJldmlvdXMgPSB0aGlzLmVudHJpZXM7XG4gICAgY29uc3Qgd2FzQnVpbHQgPSB0aGlzLmJ1aWx0O1xuICAgIHRoaXMuZW50cmllcyA9IG5ldyBNYXAoKTtcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpKSB0aGlzLmVudHJpZXMuc2V0KGZpbGUucGF0aCwgdGhpcy5yZWFkKGZpbGUpKTtcbiAgICB0aGlzLmJ1aWx0ID0gdHJ1ZTtcbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsO1xuICAgIGlmICghd2FzQnVpbHQpIHJldHVybjtcblxuICAgIGZvciAoY29uc3QgW3BhdGgsIGVudHJ5XSBvZiB0aGlzLmVudHJpZXMpIHtcbiAgICAgIGlmICghc2FtZUVudHJ5KHByZXZpb3VzLmdldChwYXRoKSwgZW50cnkpKSB0aGlzLnBlbmRpbmdQYXRocy5hZGQocGF0aCk7XG4gICAgfVxuICAgIGZvciAoY29uc3QgcGF0aCBvZiBwcmV2aW91cy5rZXlzKCkpIHtcbiAgICAgIGlmICghdGhpcy5lbnRyaWVzLmhhcyhwYXRoKSkgdGhpcy5wZW5kaW5nUGF0aHMuYWRkKHBhdGgpO1xuICAgIH1cbiAgICBpZiAodGhpcy5wZW5kaW5nUGF0aHMuc2l6ZSA+IDApIHRoaXMuZmx1c2goKTtcbiAgfVxuXG4gIG1hcmtDaGFuZ2VkKHBhdGgpIHtcbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsO1xuICAgIHRoaXMucGVuZGluZ1BhdGhzLmFkZChwYXRoKTtcbiAgICB0aGlzLmZsdXNoKCk7XG4gIH1cblxuICB1cGRhdGUoZmlsZSkge1xuICAgIC8vIFZvciBkZW0gZXJzdGVuIFp1Z3JpZmYgZ2lidCBlcyBub2NoIGtlaW5lbiB2ZXJhbHRldGVuIFN0YW5kIC0gZGVyXG4gICAgLy8gc3BcdTAwRTR0ZXJlIGxhenkgQXVmYmF1IGxpZXN0IG9obmVoaW4gZnJpc2NoIGF1cyBkZW0gTWV0YWRhdGFDYWNoZS5cbiAgICBpZiAoIXRoaXMuYnVpbHQgfHwgIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpIHx8IGZpbGUuZXh0ZW5zaW9uICE9PSBcIm1kXCIpIHJldHVybjtcbiAgICBjb25zdCBuZXh0ID0gdGhpcy5yZWFkKGZpbGUpO1xuICAgIGlmIChzYW1lRW50cnkodGhpcy5lbnRyaWVzLmdldChmaWxlLnBhdGgpLCBuZXh0KSkgcmV0dXJuO1xuICAgIHRoaXMuZW50cmllcy5zZXQoZmlsZS5wYXRoLCBuZXh0KTtcbiAgICB0aGlzLm1hcmtDaGFuZ2VkKGZpbGUucGF0aCk7XG4gIH1cblxuICByZW1vdmUocGF0aCkge1xuICAgIGlmICghdGhpcy5idWlsdCB8fCAhdGhpcy5lbnRyaWVzLmRlbGV0ZShwYXRoKSkgcmV0dXJuO1xuICAgIHRoaXMubWFya0NoYW5nZWQocGF0aCk7XG4gIH1cblxuICByZW5hbWUoZmlsZSwgb2xkUGF0aCkge1xuICAgIGlmICghdGhpcy5idWlsdCkgcmV0dXJuO1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5lbnRyaWVzLmdldChvbGRQYXRoKTtcbiAgICBpZiAoZW50cnkpIHtcbiAgICAgIHRoaXMuZW50cmllcy5kZWxldGUob2xkUGF0aCk7XG4gICAgICB0aGlzLm1hcmtDaGFuZ2VkKG9sZFBhdGgpO1xuICAgIH1cbiAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlICYmIGZpbGUuZXh0ZW5zaW9uID09PSBcIm1kXCIpIHtcbiAgICAgIHRoaXMuZW50cmllcy5zZXQoZmlsZS5wYXRoLCBlbnRyeSA/PyB0aGlzLnJlYWQoZmlsZSkpO1xuICAgICAgdGhpcy5tYXJrQ2hhbmdlZChmaWxlLnBhdGgpO1xuICAgIH1cbiAgfVxuXG4gIGVudHJ5Rm9yKGZpbGUpIHtcbiAgICBpZiAoIWZpbGUpIHJldHVybiBFTVBUWV9FTlRSWTtcbiAgICB0aGlzLmVuc3VyZUJ1aWx0KCk7XG4gICAgcmV0dXJuIHRoaXMuZW50cmllcy5nZXQoZmlsZS5wYXRoKSA/PyBFTVBUWV9FTlRSWTtcbiAgfVxuXG4gIC8vIFRZUC1TY2hsXHUwMEZDc3NlbCAoc2llaGUgdHlwZUtleU9mKSBvZGVyIG51bGwuIEZcdTAwRkNyIGVpbmVuIHNhdWJlcmVuIFdlcnQgaXN0IGRhc1xuICAvLyBzY2hsaWNodCBkZXIgVFlQLU5hbWUgc2VsYnN0LlxuICB0eXBlT2YoZmlsZSkge1xuICAgIHJldHVybiB0aGlzLmVudHJ5Rm9yKGZpbGUpLnR5cGVLZXk7XG4gIH1cblxuICAvLyBTVUJUWVAtU2NobFx1MDBGQ3NzZWwgKHNpZWhlIHR5cGVLZXlPZikgb2RlciBudWxsLlxuICBzdWJ0eXBlT2YoZmlsZSkge1xuICAgIHJldHVybiB0aGlzLmVudHJ5Rm9yKGZpbGUpLnN1YnR5cGVLZXk7XG4gIH1cblxuICAvLyBFaW4gdGF0c1x1MDBFNGNobGljaGVyIEZyb250bWF0dGVyLVdlcnQgenUgZWluZW0gU2NobFx1MDBGQ3NzZWwgLSBmXHUwMEZDciBBbnplaWdlLCBTdWNoZVxuICAvLyB1bmQgTm9ybWFsaXNpZXJ1bmcgdW5yZWdpc3RyaWVydGVyIEVpbnRyXHUwMEU0Z2UgKGFsbGUgTm90aXplbiBlaW5lcyBTY2hsXHUwMEZDc3NlbHNcbiAgLy8gaGFiZW4gcGVyIERlZmluaXRpb24gZGllc2VsYmUgUm9oZm9ybSkuXG4gIHJhd1ZhbHVlT2YodHlwZUtleSkge1xuICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZSgpLnJhd0J5S2V5LmdldCh0eXBlS2V5KTtcbiAgfVxuXG4gIC8vIFNhdWJlcmVyIFdlcnQgPSBFaW56ZWx3ZXJ0IG9obmUgTGVlcnplaWNoZW4gYW0gUmFuZC4gS2xlaW4gZ2VzY2hyaWViZW5lXG4gIC8vIFdlcnRlIHpcdTAwRTRobGVuIGhpZXIgYWxzIHNhdWJlciAoc2llIHNpbmQgZWluIGdcdTAwRkNsdGlnZXIsIG51ciBub2NoIG5pY2h0XG4gIC8vIHJlZ2lzdHJpZXJ0ZXIgVFlQLU5hbWUpLCBMaXN0ZW4gdW5kIFJhbmRsZWVyemVpY2hlbiBuaWNodC5cbiAgaXNDbGVhbktleSh0eXBlS2V5KSB7XG4gICAgY29uc3QgcmF3ID0gdGhpcy5yYXdWYWx1ZU9mKHR5cGVLZXkpO1xuICAgIHJldHVybiByYXcgIT09IHVuZGVmaW5lZCAmJiAhQXJyYXkuaXNBcnJheShyYXcpICYmIHR5cGVLZXkgPT09IHR5cGVLZXkudHJpbSgpO1xuICB9XG5cbiAgLy8gRGF0ZWllbiBtaXQgZ2VuYXUgZGllc2VtIFRZUC1TY2hsXHUwMEZDc3NlbCwgdW50ZXIgQmVhY2h0dW5nIGRlclxuICAvLyBcIklnbm9yaWVydGUgTm90aXplbiBiZXJcdTAwRkNja3NpY2h0aWdlblwiLUVpbnN0ZWxsdW5nLlxuICBmaWxlc1dpdGhUeXBlKHR5cGVLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5maWxlc01hdGNoaW5nKChlbnRyeSkgPT4gZW50cnkudHlwZUtleSA9PT0gdHlwZUtleSk7XG4gIH1cblxuICAvLyBEYXRlaWVuIG1pdCBnZW5hdSBkaWVzZW0gVFlQLSB1bmQgU1VCVFlQLVNjaGxcdTAwRkNzc2VsLlxuICBmaWxlc1dpdGhTdWJ0eXBlKHR5cGVLZXksIHN1YnR5cGVLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5maWxlc01hdGNoaW5nKChlbnRyeSkgPT4gZW50cnkudHlwZUtleSA9PT0gdHlwZUtleSAmJiBlbnRyeS5zdWJ0eXBlS2V5ID09PSBzdWJ0eXBlS2V5KTtcbiAgfVxuXG4gIGZpbGVzTWF0Y2hpbmcocHJlZGljYXRlKSB7XG4gICAgdGhpcy5lbnN1cmVCdWlsdCgpO1xuICAgIGNvbnN0IGluY2x1ZGVJZ25vcmVkID0gISF0aGlzLnBsdWdpbi5zZXR0aW5ncy5pbmNsdWRlSWdub3JlZEZpbGVzO1xuICAgIGNvbnN0IGZpbGVzID0gW107XG4gICAgZm9yIChjb25zdCBbcGF0aCwgZW50cnldIG9mIHRoaXMuZW50cmllcykge1xuICAgICAgaWYgKCFwcmVkaWNhdGUoZW50cnkpKSBjb250aW51ZTtcbiAgICAgIGlmICghaW5jbHVkZUlnbm9yZWQgJiYgdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5pc1VzZXJJZ25vcmVkKHBhdGgpKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgocGF0aCk7XG4gICAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSBmaWxlcy5wdXNoKGZpbGUpO1xuICAgIH1cbiAgICByZXR1cm4gZmlsZXM7XG4gIH1cblxuICAvLyBSZXNwZWt0aWVydCBzdGFuZGFyZG1cdTAwRTRcdTAwREZpZyBPYnNpZGlhbnMgZWlnZW5lIFwiRXhjbHVkZWQgZmlsZXNcIi1MaXN0ZSAtIGRvcnRcbiAgLy8gdHJhZ2VuIGF1Y2ggUGx1Z2lucyB3aWUgSGlkZSBGb2xkZXJzIGF1c2dlYmxlbmRldGUgT3JkbmVyIGVpbi4gXHUwMERDYmVyIGRpZVxuICAvLyBFaW5zdGVsbHVuZyBcIklnbm9yaWVydGUgTm90aXplbiBiZXJcdTAwRkNja3NpY2h0aWdlblwiIGFic2NoYWx0YmFyLlxuICAvL1xuICAvLyBFaW5lIE5vdGl6IG9obmUgVFlQIGhhdCBrZWluZW4gU1VCVFlQLUtvbnRleHQuXG4gIGFnZ3JlZ2F0ZSgpIHtcbiAgICB0aGlzLmVuc3VyZUJ1aWx0KCk7XG4gICAgY29uc3QgaW5jbHVkZUlnbm9yZWQgPSAhIXRoaXMucGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXM7XG4gICAgaWYgKHRoaXMuYWdncmVnYXRlcz8uaW5jbHVkZUlnbm9yZWQgPT09IGluY2x1ZGVJZ25vcmVkKSByZXR1cm4gdGhpcy5hZ2dyZWdhdGVzO1xuXG4gICAgY29uc3QgY291bnRzID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IHJhd0J5S2V5ID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IHN1YnR5cGVzQnlUeXBlID0gbmV3IE1hcCgpO1xuICAgIGxldCBub1R5cGUgPSAwO1xuICAgIGZvciAoY29uc3QgW3BhdGgsIHsgdHlwZUtleSwgcmF3VHlwZSwgc3VidHlwZUtleSwgcmF3U3VidHlwZSB9XSBvZiB0aGlzLmVudHJpZXMpIHtcbiAgICAgIGlmICghaW5jbHVkZUlnbm9yZWQgJiYgdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5pc1VzZXJJZ25vcmVkKHBhdGgpKSBjb250aW51ZTtcbiAgICAgIGlmICh0eXBlS2V5ID09PSBudWxsKSB7XG4gICAgICAgIG5vVHlwZSsrO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvdW50cy5zZXQodHlwZUtleSwgKGNvdW50cy5nZXQodHlwZUtleSkgPz8gMCkgKyAxKTtcbiAgICAgIGlmICghcmF3QnlLZXkuaGFzKHR5cGVLZXkpKSByYXdCeUtleS5zZXQodHlwZUtleSwgcmF3VHlwZSk7XG4gICAgICBsZXQgYnVja2V0ID0gc3VidHlwZXNCeVR5cGUuZ2V0KHR5cGVLZXkpO1xuICAgICAgaWYgKCFidWNrZXQpIHtcbiAgICAgICAgYnVja2V0ID0geyBjb3VudHM6IG5ldyBNYXAoKSwgbm9TdWJ0eXBlOiAwLCByYXdCeUtleTogbmV3IE1hcCgpIH07XG4gICAgICAgIHN1YnR5cGVzQnlUeXBlLnNldCh0eXBlS2V5LCBidWNrZXQpO1xuICAgICAgfVxuICAgICAgaWYgKHN1YnR5cGVLZXkgPT09IG51bGwpIHtcbiAgICAgICAgYnVja2V0Lm5vU3VidHlwZSsrO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYnVja2V0LmNvdW50cy5zZXQoc3VidHlwZUtleSwgKGJ1Y2tldC5jb3VudHMuZ2V0KHN1YnR5cGVLZXkpID8/IDApICsgMSk7XG4gICAgICAgIGlmICghYnVja2V0LnJhd0J5S2V5LmhhcyhzdWJ0eXBlS2V5KSkgYnVja2V0LnJhd0J5S2V5LnNldChzdWJ0eXBlS2V5LCByYXdTdWJ0eXBlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5hZ2dyZWdhdGVzID0geyBpbmNsdWRlSWdub3JlZCwgY291bnRzLCBub1R5cGUsIHJhd0J5S2V5LCBzdWJ0eXBlc0J5VHlwZSB9O1xuICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZXM7XG4gIH1cblxuICAvLyBad2lzY2hlbmdlc3BlaWNoZXJ0IC0gZGllIGdlbGllZmVydGVuIE1hcHMgbmljaHQgdmVyXHUwMEU0bmRlcm4uXG4gIHR5cGVDb3VudHMoKSB7XG4gICAgY29uc3QgeyBjb3VudHMsIG5vVHlwZSB9ID0gdGhpcy5hZ2dyZWdhdGUoKTtcbiAgICByZXR1cm4geyBjb3VudHMsIG5vVHlwZSB9O1xuICB9XG5cbiAgLy8gVFlQIC0+IHsgY291bnRzOiBNYXAoU1VCVFlQLVNjaGxcdTAwRkNzc2VsIC0+IEFuemFobCksIG5vU3VidHlwZSwgcmF3QnlLZXkgfS5cbiAgLy8gWndpc2NoZW5nZXNwZWljaGVydCAtIG5pY2h0IHZlclx1MDBFNG5kZXJuLlxuICBzdWJ0eXBlQ291bnRzKCkge1xuICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZSgpLnN1YnR5cGVzQnlUeXBlO1xuICB9XG5cbiAgc3VidHlwZUJ1Y2tldCh0eXBlS2V5KSB7XG4gICAgcmV0dXJuIHRoaXMuc3VidHlwZUNvdW50cygpLmdldCh0eXBlS2V5KSA/PyBFTVBUWV9CVUNLRVQ7XG4gIH1cbn1cblxuY29uc3QgRU1QVFlfQlVDS0VUID0gT2JqZWN0LmZyZWV6ZSh7IGNvdW50czogbmV3IE1hcCgpLCBub1N1YnR5cGU6IDAsIHJhd0J5S2V5OiBuZXcgTWFwKCkgfSk7XG5cbm1vZHVsZS5leHBvcnRzID0geyBUeXBJbmRleCwgdHlwZUtleU9mLCBwcm9wZXJ0eVZhbHVlLCBzZXRDYW5vbmljYWxQcm9wZXJ0eSwgZGVsZXRlUHJvcGVydHksIFRZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZIH07XG4iLCAiY29uc3QgeyB0eXBlS2V5T2YsIHByb3BlcnR5VmFsdWUsIHNldENhbm9uaWNhbFByb3BlcnR5LCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcclxuXHJcbi8vIFN1YnR5cC1OYW1lbiB3ZXJkZW4gKGFuZGVycyBhbHMgVFlQZW4sIHNpZWhlIG5vcm1hbGl6ZVR5cGVOYW1lKSBtaXQgZ3JvXHUwMERGZW1cclxuLy8gQW5mYW5nc2J1Y2hzdGFiZW4gamUgV29ydCBnZXNjaHJpZWJlbiwgZGVyIFJlc3Qga2xlaW46IFwia3VyeiBHRVNDSElDSFRFXCIgXHUyMTkyXHJcbi8vIFwiS3VyeiBHZXNjaGljaHRlXCIuIERpZSBQcm9wZXJ0eSBTVUJUWVAgc2VsYnN0IGJsZWlidCBpbiBHcm9cdTAwREZidWNoc3RhYmVuLlxyXG5mdW5jdGlvbiBub3JtYWxpemVTdWJ0eXBlTmFtZShyYXcpIHtcclxuICByZXR1cm4gcmF3LnRyaW0oKS5yZXBsYWNlKC9cXFMrL2csICh3b3JkKSA9PiB3b3JkLmNoYXJBdCgwKS50b0xvY2FsZVVwcGVyQ2FzZShcImRlXCIpICsgd29yZC5zbGljZSgxKS50b0xvY2FsZUxvd2VyQ2FzZShcImRlXCIpKTtcclxufVxyXG5cclxuLy8gUmVnaXN0cmllcnRlIFNVQlRZUGVuIGplIFRZUCAoc2V0dGluZ3MudHlwZVN1YnR5cGVzKTpcclxuLy8gICB7IFtUWVBdOiB7IFtTVUJUWVBdOiB7IGZyb250bWF0dGVyOiB7Li4ufSwgZmxvYXRpbmdLZXlzOiBbLi4uXSwgc2hvcnRjdXRzOiB7Li4ufSB9IH0gfVxyXG4vLyBFaW4gU3VidHlwIGdlaFx1MDBGNnJ0IGltbWVyIHp1IGdlbmF1IGVpbmVtIFRZUDsgZGVyc2VsYmUgTmFtZSBkYXJmIGFiZXIgKGFsc1xyXG4vLyBlaWdlbnN0XHUwMEU0bmRpZ2VyIFN1YnR5cCkgYXVjaCB1bnRlciBlaW5lbSBhbmRlcmVuIFRZUCB2b3Jrb21tZW4uIERpZVxyXG4vLyBSZWloZW5mb2xnZSBkZXIgU2NobFx1MDBGQ3NzZWwgaXN0IGRpZSBBbnplaWdlcmVpaGVuZm9sZ2UgZGVyIEJsXHUwMEY2Y2tlIGluIGRlclxyXG4vLyBUWVAtRGV0YWlsYW5zaWNodCwgc3RldHMgdW50ZXJoYWxiIGRlcyBUWVAtRnJvbnRtYXR0ZXJzLiBmcm9udG1hdHRlclxyXG4vLyBlcmdcdTAwRTRuenQgYnp3LiBcdTAwRkNiZXJzY2hyZWlidCBkYXMgVFlQLUZyb250bWF0dGVyIGRlcyBUWVBzLCBmbG9hdGluZ0tleXMgd2llXHJcbi8vIHR5cGVGbG9hdGluZ0tleXMsIHNob3J0Y3V0cyB3aWUgdHlwZVNob3J0Y3V0cyAoc2llaGUgc2hvcnRjdXRzLmpzKSAtIGplIEtleVxyXG4vLyBkZXMgQmxvY2tzIGVpbiBTaG9ydGN1dC1SZWNvcmQsIGRlciBXZXJ0IGRlcyBLZXlzIGJsZWlidCBkYWJlaSBhbHNcclxuLy8gUlx1MDBGQ2NrZmFsbHdlcnQgc3RlaGVuLiBCZXN0YW5kc2RhdGVuIGZcdTAwRkNocmVuIHNob3J0Y3V0cyBub2NoIG5pY2h0LCBMZXNlciBtXHUwMEZDc3NlblxyXG4vLyBlcyBkYWhlciBhbHMgb3B0aW9uYWwgYmVoYW5kZWxuLlxyXG4vL1xyXG4vLyBEZXJzZWxiZSBLZXkgZGFyZiBpbiBtZWhyZXJlbiBCbFx1MDBGNmNrZW4gZWluZXMgVFlQcyBzdGVoZW4gKG51ciBpbm5lcmhhbGJcclxuLy8gRUlORVMgQmxvY2tzIGlzdCBlciB6d2FuZ3NsXHUwMEU0dWZpZyBlaW5kZXV0aWcpOlxyXG4vLyAgIC0gaW4gendlaSBTdWJ0eXAtQmxcdTAwRjZja2VuOiBrb25mbGlrdGZyZWksIGRhIGVpbmUgTm90aXogaFx1MDBGNmNoc3RlbnMgZWluZW5cclxuLy8gICAgIFNVQlRZUCBoYXQgdW5kIGRpZSBCbFx1MDBGNmNrZSBkYW1pdCBuaWUgZ2xlaWNoemVpdGlnIGdlbHRlbjtcclxuLy8gICAtIGltIFRZUC1Gcm9udG1hdHRlciBVTkQgZWluZW0gU3VidHlwLUJsb2NrOiBkZXIgU3VidHlwIFx1MDBGQ2JlcnNjaHJlaWJ0XHJcbi8vICAgICBXZXJ0IHVuZCBGbG9hdGluZy1NYXJraWVydW5nLCBkaWUgWmVpbGUgYmVoXHUwMEU0bHQgYWJlciBkaWUgUG9zaXRpb24gZGVzXHJcbi8vICAgICBUWVAtRnJvbnRtYXR0ZXJzIChzaWVoZSBnZXRUeXBlRGVmYXVsdHMgaW4gbWFpbi5qcyB1bmRcclxuLy8gICAgIG9yZGVyZWREZWZhdWx0S2V5cyBpbiBmcm9udG1hdHRlci1zb3J0LmpzIC0gYmVpZGUgbVx1MDBGQ3NzZW4gZGllc2VsYmVcclxuLy8gICAgIFJlZ2VsIHZlcndlbmRlbiwgc29uc3Qgc29ydGllcnQgZGllIEZyb250bWF0dGVyLVNvcnRpZXJ1bmcgZWluZSBnZXJhZGVcclxuLy8gICAgIGFuZ2VsZWd0ZSBOb3RpeiBzb2ZvcnQgd2llZGVyIHVtKS5cclxuXHJcbi8vIFwiTm9jaCBhdXN6dWZcdTAwRkNsbGVuXCIgLSBlaW4gc29sY2hlciBXZXJ0IHdpcmQgYmVpbSBadXNhbW1lbmxlZ2VuIHp3ZWllclxyXG4vLyBCbFx1MDBGNmNrZSBiencuIHp3ZWllciBQcm9wZXJ0aWVzIHZvbSBqZXdlaWxzIGFuZGVyZW4gZ2VmXHUwMEZDbGx0LCBzdGF0dCBkZW5cclxuLy8gYmVzdGVoZW5kZW4gRWludHJhZyB6dSBcdTAwRkNiZXJzY2hyZWliZW4gKHNpZWhlIG1lcmdlU3VidHlwZXMgaGllciB1bmRcclxuLy8gcmVuYW1lSW5TdG9yZSBpbiBwcm9wZXJ0eS1yZW5hbWUtc3luYy5qcykuXHJcbmZ1bmN0aW9uIGlzRW1wdHlWYWx1ZSh2YWx1ZSkge1xyXG4gIHJldHVybiB2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSBcIlwiO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRTdWJ0eXBlTmFtZXMoc2V0dGluZ3MsIHR5cGUpIHtcclxuICByZXR1cm4gT2JqZWN0LmtleXMoc2V0dGluZ3MudHlwZVN1YnR5cGVzPy5bdHlwZV0gPz8ge30pO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKSB7XHJcbiAgcmV0dXJuIHNldHRpbmdzLnR5cGVTdWJ0eXBlcz8uW3R5cGVdPy5bc3VidHlwZV0gPz8gbnVsbDtcclxufVxyXG5cclxuZnVuY3Rpb24gZW5zdXJlU3VidHlwZShzZXR0aW5ncywgdHlwZSwgc3VidHlwZSkge1xyXG4gIGlmICghc2V0dGluZ3MudHlwZVN1YnR5cGVzKSBzZXR0aW5ncy50eXBlU3VidHlwZXMgPSB7fTtcclxuICBpZiAoIXNldHRpbmdzLnR5cGVTdWJ0eXBlc1t0eXBlXSkgc2V0dGluZ3MudHlwZVN1YnR5cGVzW3R5cGVdID0ge307XHJcbiAgY29uc3QgYnlOYW1lID0gc2V0dGluZ3MudHlwZVN1YnR5cGVzW3R5cGVdO1xyXG4gIGlmICghYnlOYW1lW3N1YnR5cGVdKSBieU5hbWVbc3VidHlwZV0gPSB7IGZyb250bWF0dGVyOiB7fSwgZmxvYXRpbmdLZXlzOiBbXSwgc2hvcnRjdXRzOiB7fSB9O1xyXG4gIHJldHVybiBieU5hbWVbc3VidHlwZV07XHJcbn1cclxuXHJcbi8vIEJlaW0gVW1iZW5lbm5lbiBlaW5lcyBUWVBzOiBTdWJ0eXBlbiB3YW5kZXJuIHVudGVyIGRlbiBuZXVlbiBOYW1lbiBtaXQuXHJcbmZ1bmN0aW9uIG1vdmVUeXBlU3VidHlwZXMoc2V0dGluZ3MsIG9sZFR5cGUsIG5ld1R5cGUpIHtcclxuICBpZiAoIXNldHRpbmdzLnR5cGVTdWJ0eXBlcz8uW29sZFR5cGVdKSByZXR1cm47XHJcbiAgc2V0dGluZ3MudHlwZVN1YnR5cGVzW25ld1R5cGVdID0gc2V0dGluZ3MudHlwZVN1YnR5cGVzW29sZFR5cGVdO1xyXG4gIGRlbGV0ZSBzZXR0aW5ncy50eXBlU3VidHlwZXNbb2xkVHlwZV07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGRlbGV0ZVR5cGVTdWJ0eXBlcyhzZXR0aW5ncywgdHlwZSkge1xyXG4gIGlmIChzZXR0aW5ncy50eXBlU3VidHlwZXMpIGRlbGV0ZSBzZXR0aW5ncy50eXBlU3VidHlwZXNbdHlwZV07XHJcbn1cclxuXHJcbi8vIEVudGZlcm50IGRpZSBNYXJraWVydW5nIGFib3ZlU3RhbmRhcmQgYXVzIEJlc3RhbmRzZGF0ZW46IFN1YnR5cC1CbFx1MDBGNmNrZVxyXG4vLyBkdXJmdGVuIGZyXHUwMEZDaGVyIFx1MDBGQ2JlciBkZW0gVFlQLUZyb250bWF0dGVyIGxpZWdlbiwgZGFzIHN0ZWh0IGpldHp0IGZlc3QgZ2FuelxyXG4vLyBvYmVuIChzaWVoZSBnZXRTZWN0aW9uT3JkZXIpLiBMaWVmZXJ0IHRydWUgYmVpIGVpbmVyIFx1MDBDNG5kZXJ1bmcuXHJcbmZ1bmN0aW9uIG1pZ3JhdGVBYm92ZVN0YW5kYXJkKHNldHRpbmdzKSB7XHJcbiAgbGV0IGNoYW5nZWQgPSBmYWxzZTtcclxuICBmb3IgKGNvbnN0IGJ5TmFtZSBvZiBPYmplY3QudmFsdWVzKHNldHRpbmdzLnR5cGVTdWJ0eXBlcyA/PyB7fSkpIHtcclxuICAgIGZvciAoY29uc3QgZGF0YSBvZiBPYmplY3QudmFsdWVzKGJ5TmFtZSkpIHtcclxuICAgICAgaWYgKGRhdGEuYWJvdmVTdGFuZGFyZCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcclxuICAgICAgZGVsZXRlIGRhdGEuYWJvdmVTdGFuZGFyZDtcclxuICAgICAgY2hhbmdlZCA9IHRydWU7XHJcbiAgICB9XHJcbiAgfVxyXG4gIHJldHVybiBjaGFuZ2VkO1xyXG59XHJcblxyXG4vLyBEaWUgUmVnbGVyIGRlciBTdWJ0eXAtRmFyYmVuIGhhYmVuIHp3ZWltYWwgaWhyZSBCZWRldXR1bmcgZ2VcdTAwRTRuZGVydCwgb2huZVxyXG4vLyBkYXNzIHNpY2ggZGllIGdlc3BlaWNoZXJ0ZW4gWmFobGVuIHZvbiBzZWxic3QgbWl0YmV3ZWd0IGhcdTAwRTR0dGVuIChzaWVoZVxyXG4vLyBhcHBseUNvbG9yT2Zmc2V0IHVuZCBjaGFubmVsQm91bmRzIGluIHR5cGUtY29sb3JzLmpzKS4gc2V0dGluZ3MuXHJcbi8vIHN1YnR5cGVDb2xvclNjYWxlIGhcdTAwRTRsdCBmZXN0LCB3ZWxjaGVuIFN0YW5kIGRpZSBnZXNwZWljaGVydGVuIFdlcnRlIGhhYmVuO1xyXG4vLyBqZWRlciBTY2hyaXR0IGxcdTAwRTR1ZnQgZ2VuYXUgZWlubWFsLiBMaWVmZXJ0IHRydWUgYmVpIGVpbmVyIFx1MDBDNG5kZXJ1bmcgLSBkaWVcclxuLy8gZ2VoXHUwMEY2cnQgc29mb3J0IGdlc3BlaWNoZXJ0LCBzb25zdCBsaWVmZSBkaWUgVW1yZWNobnVuZyBiZWltIG5cdTAwRTRjaHN0ZW4gU3RhcnRcclxuLy8gZXJuZXV0LiBXYXJlbiBkaWUgR3JlbnplbiBub2NoIGRpZSBTdGFuZGFyZHdlcnRlIGRlcyBqZXdlaWxpZ2VuIFN0YW5kcyxcclxuLy8gZ2VsdGVuIGRhbmFjaCBkaWUgbmV1ZW4uXHJcbi8vICAgMSAtPiAyOiBIZWxsaWdrZWl0IHpcdTAwRTRobHRlIGFic29sdXRlIE9LTENILVB1bmt0ZSwgamV0enQgZGVuIEFudGVpbCBkZXMgV2Vnc1xyXG4vLyAgICAgICAgICAgenUgV2VpXHUwMERGIGJ6dy4gU2Nod2Fyei4gRGllIGFsdGUgWmFobCBsXHUwMEU0c3N0IHNpY2ggbmljaHQgdW1yZWNobmVuXHJcbi8vICAgICAgICAgICAoc2llIGhpbmcgdm9uIGRlciBUWVAtRmFyYmUgYWIpLCB3b2hsIGFiZXIgZGllIEFic2ljaHQgZGFoaW50ZXI6XHJcbi8vICAgICAgICAgICB3YXMgZGVuIFJlZ2xlciBoYWxiIGF1c3JlaXp0ZSwgcmVpenQgaWhuIGF1Y2ggZGFuYWNoIGhhbGIgYXVzLlxyXG4vLyAgIDIgLT4gMzogZGllIFNcdTAwRTR0dGlndW5nIGdlaHQgbnVyIG5vY2ggbmFjaCB1bnRlbjsgZ2VzcGVpY2hlcnRlIHBvc2l0aXZlXHJcbi8vICAgICAgICAgICBXZXJ0ZSBzaW5kIHNvbnN0IHN0dW1tIGdla2FwcHQgdW5kIHdcdTAwRTRyZW4gYmVpbSBuXHUwMEU0Y2hzdGVuIFx1MDBENmZmbmVuIGRlc1xyXG4vLyAgICAgICAgICAgUG9wb3ZlcnMgdW5hbmdla1x1MDBGQ25kaWd0IHZlcnNjaHd1bmRlbi5cclxuY29uc3QgU1VCVFlQRV9DT0xPUl9TQ0FMRSA9IDM7XHJcbmNvbnN0IFBSRVZJT1VTX1NVQlRZUEVfQ09MT1JfUkFOR0VTID0ge1xyXG4gIDI6IHsgaDogMjUsIHM6IDMwLCBsOiAyMCB9LFxyXG4gIDM6IHsgaDogMzUsIHM6IDIwLCBsOiA0MCB9LFxyXG59O1xyXG5cclxuZnVuY3Rpb24gbWlncmF0ZVN1YnR5cGVDb2xvclNjYWxlKHNldHRpbmdzLCBkZWZhdWx0UmFuZ2VzKSB7XHJcbiAgY29uc3QgZnJvbSA9IE51bWJlcihzZXR0aW5ncy5zdWJ0eXBlQ29sb3JTY2FsZSkgfHwgMTtcclxuICBpZiAoZnJvbSA+PSBTVUJUWVBFX0NPTE9SX1NDQUxFKSByZXR1cm4gZmFsc2U7XHJcbiAgY29uc3QgYWxsQ29sb3JzID0gZnVuY3Rpb24qICgpIHtcclxuICAgIGZvciAoY29uc3QgYnlOYW1lIG9mIE9iamVjdC52YWx1ZXMoc2V0dGluZ3MudHlwZVN1YnR5cGVzID8/IHt9KSkge1xyXG4gICAgICBmb3IgKGNvbnN0IGRhdGEgb2YgT2JqZWN0LnZhbHVlcyhieU5hbWUpKSBpZiAoZGF0YS5jb2xvcikgeWllbGQgZGF0YS5jb2xvcjtcclxuICAgIH1cclxuICB9O1xyXG4gIGNvbnN0IGFkb3B0RGVmYXVsdHMgPSAoc3RlcCkgPT4ge1xyXG4gICAgY29uc3QgcHJldmlvdXMgPSBQUkVWSU9VU19TVUJUWVBFX0NPTE9SX1JBTkdFU1tzdGVwXTtcclxuICAgIGlmIChPYmplY3QuZW50cmllcyhwcmV2aW91cykuZXZlcnkoKFtrZXksIHZhbHVlXSkgPT4gTnVtYmVyKHNldHRpbmdzLnN1YnR5cGVDb2xvclJhbmdlcz8uW2tleV0pID09PSB2YWx1ZSkpIHtcclxuICAgICAgc2V0dGluZ3Muc3VidHlwZUNvbG9yUmFuZ2VzID0geyAuLi5kZWZhdWx0UmFuZ2VzIH07XHJcbiAgICB9XHJcbiAgfTtcclxuICBpZiAoZnJvbSA8IDIpIHtcclxuICAgIGNvbnN0IG9sZFJhbmdlID0gTnVtYmVyKHNldHRpbmdzLnN1YnR5cGVDb2xvclJhbmdlcz8ubCk7XHJcbiAgICBhZG9wdERlZmF1bHRzKDIpO1xyXG4gICAgY29uc3QgbmV3UmFuZ2UgPSBOdW1iZXIoc2V0dGluZ3Muc3VidHlwZUNvbG9yUmFuZ2VzPy5sKTtcclxuICAgIGNvbnN0IGZhY3RvciA9IG9sZFJhbmdlID4gMCAmJiBOdW1iZXIuaXNGaW5pdGUobmV3UmFuZ2UpID8gbmV3UmFuZ2UgLyBvbGRSYW5nZSA6IDE7XHJcbiAgICBmb3IgKGNvbnN0IGNvbG9yIG9mIGFsbENvbG9ycygpKSBpZiAoY29sb3IubCkgY29sb3IubCA9IE1hdGgucm91bmQoY29sb3IubCAqIGZhY3Rvcik7XHJcbiAgfVxyXG4gIGlmIChmcm9tIDwgMykge1xyXG4gICAgYWRvcHREZWZhdWx0cygzKTtcclxuICAgIGZvciAoY29uc3QgY29sb3Igb2YgYWxsQ29sb3JzKCkpIGlmIChjb2xvci5zID4gMCkgY29sb3IucyA9IDA7XHJcbiAgfVxyXG4gIHNldHRpbmdzLnN1YnR5cGVDb2xvclNjYWxlID0gU1VCVFlQRV9DT0xPUl9TQ0FMRTtcclxuICByZXR1cm4gdHJ1ZTtcclxufVxyXG5cclxuLy8gWnVzYW1tZW5sZWdlbiB6d2VpZXIgVFlQZW46IFN1YnR5cGVuLCBkaWUgZXMgbnVyIGJlaSBzb3VyY2UgZ2lidCwgd2VyZGVuXHJcbi8vIFx1MDBGQ2Jlcm5vbW1lbi4gR2xlaWNobmFtaWdlIEJsXHUwMEY2Y2tlIHdlcmRlbiB2ZXJlaW5pZ3QgLSBiZWkgZ2xlaWNoZW0gS2V5XHJcbi8vIGdld2lubmVuIFdlcnQgdW5kIEZsb2F0aW5nLU1hcmtpZXJ1bmcgZGVzIFppZWxzLCBLZXlzIG51ciBhdXMgc291cmNlXHJcbi8vIHdlcmRlbiBoaW50ZW4gYW5nZWhcdTAwRTRuZ3QuIFN0ZWh0IGVpbiBcdTAwRkNiZXJub21tZW5lciBLZXkgenVnbGVpY2ggaW1cclxuLy8gVFlQLUZyb250bWF0dGVyIGRlcyBaaWVscywgYmxlaWJlbiBiZWlkZSBzdGVoZW4gLSBkYXJhdXMgd2lyZCBkaWUgZ2FuelxyXG4vLyBub3JtYWxlIFx1MDBEQ2JlcnNjaHJlaWJ1bmcgKHNpZWhlIEtvbW1lbnRhciBhbiB0eXBlU3VidHlwZXMgb2JlbikuXHJcbmZ1bmN0aW9uIG1lcmdlVHlwZVN1YnR5cGVzKHNldHRpbmdzLCBzb3VyY2UsIHRhcmdldCkge1xyXG4gIGNvbnN0IHNvdXJjZVN1YnR5cGVzID0gc2V0dGluZ3MudHlwZVN1YnR5cGVzPy5bc291cmNlXTtcclxuICBpZiAoIXNvdXJjZVN1YnR5cGVzKSByZXR1cm47XHJcbiAgZm9yIChjb25zdCBbbmFtZSwgc291cmNlRGF0YV0gb2YgT2JqZWN0LmVudHJpZXMoc291cmNlU3VidHlwZXMpKSB7XHJcbiAgICBjb25zdCB0YXJnZXREYXRhID0gZ2V0U3VidHlwZShzZXR0aW5ncywgdGFyZ2V0LCBuYW1lKTtcclxuICAgIGlmICghdGFyZ2V0RGF0YSkge1xyXG4gICAgICBlbnN1cmVTdWJ0eXBlKHNldHRpbmdzLCB0YXJnZXQsIG5hbWUpO1xyXG4gICAgICBzZXR0aW5ncy50eXBlU3VidHlwZXNbdGFyZ2V0XVtuYW1lXSA9IHNvdXJjZURhdGE7XHJcbiAgICAgIGNvbnRpbnVlO1xyXG4gICAgfVxyXG4gICAgY29uc3QgdGFyZ2V0TG93ZXIgPSBuZXcgU2V0KE9iamVjdC5rZXlzKHRhcmdldERhdGEuZnJvbnRtYXR0ZXIpLm1hcCgoa2V5KSA9PiBrZXkudG9Mb3dlckNhc2UoKSkpO1xyXG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoc291cmNlRGF0YS5mcm9udG1hdHRlcikpIHtcclxuICAgICAgaWYgKGtleSA9PT0gXCJcIiB8fCB0YXJnZXRMb3dlci5oYXMoa2V5LnRvTG93ZXJDYXNlKCkpKSBjb250aW51ZTtcclxuICAgICAgdGFyZ2V0RGF0YS5mcm9udG1hdHRlcltrZXldID0gdmFsdWU7XHJcbiAgICAgIGlmIChzb3VyY2VEYXRhLmZsb2F0aW5nS2V5cy5pbmNsdWRlcyhrZXkpKSB0YXJnZXREYXRhLmZsb2F0aW5nS2V5cy5wdXNoKGtleSk7XHJcbiAgICAgIC8vIERlciBTaG9ydGN1dCBoXHUwMEU0bmd0IGFtIEtleSB1bmQgd2FuZGVydCBkZXNoYWxiIG1pdCBpaG0gbWl0LlxyXG4gICAgICBjb25zdCBzaG9ydGN1dCA9IHNvdXJjZURhdGEuc2hvcnRjdXRzPy5ba2V5XTtcclxuICAgICAgaWYgKHNob3J0Y3V0KSAodGFyZ2V0RGF0YS5zaG9ydGN1dHMgPz89IHt9KVtrZXldID0gc2hvcnRjdXQ7XHJcbiAgICB9XHJcbiAgfVxyXG4gIGRlbGV0ZSBzZXR0aW5ncy50eXBlU3VidHlwZXNbc291cmNlXTtcclxufVxyXG5cclxuLy8gVW1iZW5lbm5lbiBlaW5lcyBTdWJ0eXBzIGlubmVyaGFsYiBzZWluZXMgVFlQcyAtIGRlciBCbG9jayBiZWhcdTAwRTRsdCBkYWJlaVxyXG4vLyBzZWluZSBQb3NpdGlvbiAoQW56ZWlnZXJlaWhlbmZvbGdlID0gU2NobFx1MDBGQ3NzZWxyZWloZW5mb2xnZSkuXHJcbmZ1bmN0aW9uIHJlbmFtZVN1YnR5cGUoc2V0dGluZ3MsIHR5cGUsIG9sZE5hbWUsIG5ld05hbWUpIHtcclxuICBjb25zdCBieU5hbWUgPSBzZXR0aW5ncy50eXBlU3VidHlwZXM/Llt0eXBlXTtcclxuICBpZiAoIWJ5TmFtZT8uW29sZE5hbWVdIHx8IG9sZE5hbWUgPT09IG5ld05hbWUpIHJldHVybjtcclxuICBzZXR0aW5ncy50eXBlU3VidHlwZXNbdHlwZV0gPSBPYmplY3QuZnJvbUVudHJpZXMoXHJcbiAgICBPYmplY3QuZW50cmllcyhieU5hbWUpLm1hcCgoW25hbWUsIGRhdGFdKSA9PiBbbmFtZSA9PT0gb2xkTmFtZSA/IG5ld05hbWUgOiBuYW1lLCBkYXRhXSlcclxuICApO1xyXG59XHJcblxyXG4vLyBSZWloZW5mb2xnZSBhbGxlciBCbFx1MDBGNmNrZSBlaW5lcyBUWVBzLCBudWxsID0gVFlQLUZyb250bWF0dGVyLiBEYXNcclxuLy8gVFlQLUZyb250bWF0dGVyIHN0ZWh0IGltbWVyIGdhbnogb2JlbiwgZGllIFN1YnR5cGVuIGZvbGdlbiBpbiBpaHJlclxyXG4vLyBTY2hsXHUwMEZDc3NlbHJlaWhlbmZvbGdlLiBCZXN0aW1tdCBkaWUgQW56ZWlnZSBpbiBkZXIgVFlQLURldGFpbGFuc2ljaHQgZWJlbnNvXHJcbi8vIHdpZSBkaWUgRnJvbnRtYXR0ZXItU29ydGllcnVuZyBkZXIgTm90aXplbiAoc2llaGUgb3JkZXJlZERlZmF1bHRLZXlzKS5cclxuZnVuY3Rpb24gZ2V0U2VjdGlvbk9yZGVyKHNldHRpbmdzLCB0eXBlKSB7XHJcbiAgcmV0dXJuIFtudWxsLCAuLi5nZXRTdWJ0eXBlTmFtZXMoc2V0dGluZ3MsIHR5cGUpXTtcclxufVxyXG5cclxuLy8gTmV1ZSBCbG9jay1SZWloZW5mb2xnZSAoRHJhZyAmIERyb3AgaW4gZGVyIFRZUC1EZXRhaWxhbnNpY2h0KTogb3JkZXIgd2llXHJcbi8vIGdldFNlY3Rpb25PcmRlciwgZGFzIGZcdTAwRkNocmVuZGUgbnVsbCBmXHUwMEZDciBkYXMgVFlQLUZyb250bWF0dGVyIHdpcmQgZGFiZWlcclxuLy8gaWdub3JpZXJ0IChlcyBpc3QgbmljaHQgdmVyc2NoaWViYmFyKS4gTmljaHQgZ2VuYW5udGUgU3VidHlwZW4gYmxlaWJlblxyXG4vLyBkYWhpbnRlciBlcmhhbHRlbi5cclxuZnVuY3Rpb24gcmVvcmRlclN1YnR5cGVzKHNldHRpbmdzLCB0eXBlLCBvcmRlcikge1xyXG4gIGNvbnN0IGJ5TmFtZSA9IHNldHRpbmdzLnR5cGVTdWJ0eXBlcz8uW3R5cGVdO1xyXG4gIGlmICghYnlOYW1lKSByZXR1cm47XHJcbiAgY29uc3QgbmFtZXMgPSBvcmRlci5maWx0ZXIoKG5hbWUpID0+IG5hbWUgIT09IG51bGwgJiYgYnlOYW1lW25hbWVdKTtcclxuICBjb25zdCBvcmRlcmVkID0gWy4uLm5hbWVzLCAuLi5PYmplY3Qua2V5cyhieU5hbWUpLmZpbHRlcigobmFtZSkgPT4gIW5hbWVzLmluY2x1ZGVzKG5hbWUpKV07XHJcbiAgc2V0dGluZ3MudHlwZVN1YnR5cGVzW3R5cGVdID0gT2JqZWN0LmZyb21FbnRyaWVzKG9yZGVyZWQubWFwKChuYW1lKSA9PiBbbmFtZSwgYnlOYW1lW25hbWVdXSkpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBkZWxldGVTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBuYW1lKSB7XHJcbiAgY29uc3QgYnlOYW1lID0gc2V0dGluZ3MudHlwZVN1YnR5cGVzPy5bdHlwZV07XHJcbiAgaWYgKCFieU5hbWUpIHJldHVybjtcclxuICBkZWxldGUgYnlOYW1lW25hbWVdO1xyXG4gIGlmIChPYmplY3Qua2V5cyhieU5hbWUpLmxlbmd0aCA9PT0gMCkgZGVsZXRlIHNldHRpbmdzLnR5cGVTdWJ0eXBlc1t0eXBlXTtcclxufVxyXG5cclxuLy8gWnVzYW1tZW5sZWdlbiB6d2VpZXIgU3VidHlwZW4gZGVzc2VsYmVuIFRZUHM6IGRpZSBQcm9wZXJ0aWVzIHZvbiBzb3VyY2VcclxuLy8gd2FuZGVybiBhbnMgRW5kZSBkZXMgWmllbC1CbG9ja3MsIHNvdXJjZSB2ZXJzY2h3aW5kZXQuIEZcdTAwRkNocnQgZGFzIFppZWwgZWluZW5cclxuLy8gS2V5IGJlcmVpdHMsIGJlaFx1MDBFNGx0IGVzIFBvc2l0aW9uLCBXZXJ0IHVuZCBGbG9hdGluZy1NYXJraWVydW5nIC0gbnVyIGVpblxyXG4vLyBsZWVyZXIgWmllbHdlcnQgd2lyZCBhdXMgc291cmNlIGdlZlx1MDBGQ2xsdCAoZGFzc2VsYmUgTXVzdGVyIHdpZSByZW5hbWVJblN0b3JlXHJcbi8vIGluIHByb3BlcnR5LXJlbmFtZS1zeW5jLmpzIGJlaW0gWnVzYW1tZW5sZWdlbiB6d2VpZXIgUHJvcGVydGllcykuIElubmVyaGFsYlxyXG4vLyBlaW5lcyBCbG9ja3MgYmxlaWJ0IGplZGVyIEtleSB6d2FuZ3NsXHUwMEU0dWZpZyBlaW5kZXV0aWcsIGJsb2NrXHUwMEZDYmVyZ3JlaWZlbmRlXHJcbi8vIERvcHBsdW5nZW4gc2luZCBkYXZvbiBuaWNodCBiZXRyb2ZmZW4uXHJcbmZ1bmN0aW9uIG1lcmdlU3VidHlwZXMoc2V0dGluZ3MsIHR5cGUsIHNvdXJjZSwgdGFyZ2V0KSB7XHJcbiAgY29uc3Qgc291cmNlRGF0YSA9IGdldFN1YnR5cGUoc2V0dGluZ3MsIHR5cGUsIHNvdXJjZSk7XHJcbiAgY29uc3QgdGFyZ2V0RGF0YSA9IGdldFN1YnR5cGUoc2V0dGluZ3MsIHR5cGUsIHRhcmdldCk7XHJcbiAgaWYgKCFzb3VyY2VEYXRhIHx8ICF0YXJnZXREYXRhIHx8IHNvdXJjZSA9PT0gdGFyZ2V0KSByZXR1cm47XHJcblxyXG4gIGNvbnN0IHRhcmdldEtleXMgPSBuZXcgTWFwKE9iamVjdC5rZXlzKHRhcmdldERhdGEuZnJvbnRtYXR0ZXIpLm1hcCgoa2V5KSA9PiBba2V5LnRvTG93ZXJDYXNlKCksIGtleV0pKTtcclxuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzb3VyY2VEYXRhLmZyb250bWF0dGVyKSkge1xyXG4gICAgaWYgKGtleSA9PT0gXCJcIikgY29udGludWU7XHJcbiAgICBjb25zdCBleGlzdGluZyA9IHRhcmdldEtleXMuZ2V0KGtleS50b0xvd2VyQ2FzZSgpKTtcclxuICAgIGlmIChleGlzdGluZyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIHRhcmdldERhdGEuZnJvbnRtYXR0ZXJba2V5XSA9IHZhbHVlO1xyXG4gICAgICB0YXJnZXRLZXlzLnNldChrZXkudG9Mb3dlckNhc2UoKSwga2V5KTtcclxuICAgICAgaWYgKHNvdXJjZURhdGEuZmxvYXRpbmdLZXlzLmluY2x1ZGVzKGtleSkgJiYgIXRhcmdldERhdGEuZmxvYXRpbmdLZXlzLmluY2x1ZGVzKGtleSkpIHRhcmdldERhdGEuZmxvYXRpbmdLZXlzLnB1c2goa2V5KTtcclxuICAgICAgLy8gRGVyIFNob3J0Y3V0IGhcdTAwRTRuZ3QgYW0gS2V5IHVuZCB3YW5kZXJ0IGRlc2hhbGIgbWl0IGlobSBtaXQuXHJcbiAgICAgIGNvbnN0IHNob3J0Y3V0ID0gc291cmNlRGF0YS5zaG9ydGN1dHM/LltrZXldO1xyXG4gICAgICBpZiAoc2hvcnRjdXQpICh0YXJnZXREYXRhLnNob3J0Y3V0cyA/Pz0ge30pW2tleV0gPSBzaG9ydGN1dDtcclxuICAgIH0gZWxzZSBpZiAoaXNFbXB0eVZhbHVlKHRhcmdldERhdGEuZnJvbnRtYXR0ZXJbZXhpc3RpbmddKSkge1xyXG4gICAgICB0YXJnZXREYXRhLmZyb250bWF0dGVyW2V4aXN0aW5nXSA9IHZhbHVlO1xyXG4gICAgfVxyXG4gIH1cclxuICBkZWxldGVTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBzb3VyY2UpO1xyXG59XHJcblxyXG4vLyBTY2hyZWlidCBkZW4gU1VCVFlQLVdlcnQgYWxsZXIgTm90aXplbiBtaXQgVFlQLVNjaGxcdTAwRkNzc2VsIHR5cGUgdW5kXHJcbi8vIFNVQlRZUC1TY2hsXHUwMEZDc3NlbCBvbGRLZXkgYXVmIGRlbiBFaW56ZWx3ZXJ0IG5ld1ZhbHVlIHVtIC0gYW5hbG9nIHp1XHJcbi8vIHJlbmFtZVR5cGVJbk5vdGVzKCkgaW4gdHlwLXZpZXcuanMuXHJcbmFzeW5jIGZ1bmN0aW9uIHJlbmFtZVN1YnR5cGVJbk5vdGVzKHBsdWdpbiwgdHlwZSwgb2xkS2V5LCBuZXdWYWx1ZSkge1xyXG4gIGxldCBjaGFuZ2VkID0gMDtcclxuICBmb3IgKGNvbnN0IGZpbGUgb2YgcGx1Z2luLnR5cEluZGV4LmZpbGVzV2l0aFN1YnR5cGUodHlwZSwgb2xkS2V5KSkge1xyXG4gICAgbGV0IG1hdGNoZWQgPSBmYWxzZTtcclxuICAgIGF3YWl0IHBsdWdpbi5hcHAuZmlsZU1hbmFnZXIucHJvY2Vzc0Zyb250TWF0dGVyKGZpbGUsIChmcm9udG1hdHRlcikgPT4ge1xyXG4gICAgICBpZiAodHlwZUtleU9mKHByb3BlcnR5VmFsdWUoZnJvbnRtYXR0ZXIsIFNVQlRZUF9QUk9QRVJUWSkpICE9PSBvbGRLZXkpIHJldHVybjtcclxuICAgICAgc2V0Q2Fub25pY2FsUHJvcGVydHkoZnJvbnRtYXR0ZXIsIFNVQlRZUF9QUk9QRVJUWSwgbmV3VmFsdWUpO1xyXG4gICAgICBtYXRjaGVkID0gdHJ1ZTtcclxuICAgIH0pO1xyXG4gICAgaWYgKG1hdGNoZWQpIGNoYW5nZWQrKztcclxuICB9XHJcbiAgcmV0dXJuIGNoYW5nZWQ7XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0ge1xyXG4gIG5vcm1hbGl6ZVN1YnR5cGVOYW1lLFxyXG4gIGlzRW1wdHlWYWx1ZSxcclxuICBnZXRTdWJ0eXBlTmFtZXMsXHJcbiAgZ2V0U3VidHlwZSxcclxuICBlbnN1cmVTdWJ0eXBlLFxyXG4gIG1pZ3JhdGVBYm92ZVN0YW5kYXJkLFxyXG4gIG1pZ3JhdGVTdWJ0eXBlQ29sb3JTY2FsZSxcclxuICBtb3ZlVHlwZVN1YnR5cGVzLFxyXG4gIGRlbGV0ZVR5cGVTdWJ0eXBlcyxcclxuICBtZXJnZVR5cGVTdWJ0eXBlcyxcclxuICByZW5hbWVTdWJ0eXBlLFxyXG4gIGdldFNlY3Rpb25PcmRlcixcclxuICByZW9yZGVyU3VidHlwZXMsXHJcbiAgZGVsZXRlU3VidHlwZSxcclxuICBtZXJnZVN1YnR5cGVzLFxyXG4gIHJlbmFtZVN1YnR5cGVJbk5vdGVzLFxyXG59O1xyXG4iLCAiY29uc3QgeyBnZXRTdWJ0eXBlIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBlc1wiKTtcclxuY29uc3QgeyB0eXBlS2V5T2YsIHByb3BlcnR5VmFsdWUgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcclxuXHJcbmNvbnN0IFRZUF9QUk9QRVJUWSA9IFwiVFlQXCI7XHJcbmNvbnN0IFNVQlRZUF9QUk9QRVJUWSA9IFwiU1VCVFlQXCI7XHJcblxyXG4vLyBXaXJkIGF1Y2ggdm9uIHNldHRpbmdzLmpzIChEZWZhdWx0IGZcdTAwRkNyIGdsb2JhbFByb3BlcnR5T3JkZXIpIHNvd2llIHZvbVxyXG4vLyBPcmRlci1FZGl0b3IgYmVudXR6dCAtIGFsbGUgdmllciBQbGF0emhhbHRlci1CbFx1MDBGNmNrZSBzaW5kIGRvcnQgcGVyIFVJIG5pY2h0XHJcbi8vIGVudGZlcm5iYXIsIG51ciB2ZXJzY2hpZWJiYXIgKHNpZWhlIGZyb250bWF0dGVyLW9yZGVyLWVkaXRvci5qcykuXHJcbi8vIFwidHlwVmFsdWVcIiBpc3QgZGllIFRZUC1Qcm9wZXJ0eSBzZWxic3QsIFwic3VidHlwVmFsdWVcIiBhbmFsb2cgZGllIFNVQlRZUC1cclxuLy8gUHJvcGVydHksIFwidHlwXCIgZGllIFRZUC1Gcm9udG1hdHRlci1MaXN0ZSBkZXMgVFlQcyAoc2llaGVcclxuLy8gdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpLCBcIm90aGVyXCIgYWxsZXMgXHUwMERDYnJpZ2UuXHJcbmNvbnN0IERFRkFVTFRfR0xPQkFMX09SREVSID0gW3sga2luZDogXCJ0eXBWYWx1ZVwiIH0sIHsga2luZDogXCJzdWJ0eXBWYWx1ZVwiIH0sIHsga2luZDogXCJ0eXBcIiB9LCB7IGtpbmQ6IFwib3RoZXJcIiB9XTtcclxuXHJcbi8vIFN0ZWxsdCBzaWNoZXIsIGRhc3MgZ2VuYXUgamUgZWluIEVpbnRyYWcgcHJvIFBsYXR6aGFsdGVyLUFydCB2b3JoYW5kZW4gaXN0IC1cclxuLy8gblx1MDBGNnRpZyBmXHUwMEZDciBCZXN0YW5kc2luc3RhbGxhdGlvbmVuLCBkZXJlbiBnZXNwZWljaGVydGUgZ2xvYmFsUHJvcGVydHlPcmRlclxyXG4vLyBub2NoIGF1cyBkZXIgWmVpdCB2b3IgXCJUWVAgYWxzIExpc3RlbmVpbnRyYWdcIiBiencuIHZvciBTVUJUWVAgc3RhbW10IChUWVBcclxuLy8gd2FyIGRhdm9yIGhhcnQtY29kaWVydCBpbW1lciBhbiBlcnN0ZXIgU3RlbGxlLCBrYW0gaW4gZGVyIExpc3RlIHNlbGJzdFxyXG4vLyBuaWNodCB2b3IpLiBGZWhsZW5kZSBFaW50clx1MDBFNGdlIHdlcmRlbiBhbiBzaW5udm9sbGVyIERlZmF1bHQtUG9zaXRpb24gZXJnXHUwMEU0bnp0LFxyXG4vLyBzdGF0dCBkaWUgYmVzdGVoZW5kZSwgdm9tIE51dHplciBwZXIgRHJhZyAmIERyb3AgZWluc29ydGllcnRlIFJlaWhlbmZvbGdlXHJcbi8vIGFuenV0YXN0ZW4uIFwic3VidHlwVmFsdWVcIiBsYW5kZXQgZGFiZWkgZGlyZWt0IGhpbnRlciBcInR5cFZhbHVlXCIgKGdhcmFudGllcnRcclxuLy8genUgZGllc2VtIFplaXRwdW5rdCBzY2hvbiB2b3JoYW5kZW4pLCBzdGF0dCB3aWUgZGllIFx1MDBGQ2JyaWdlbiBQbGF0emhhbHRlclxyXG4vLyBwYXVzY2hhbCBhbiBkZW4gUmFuZC5cclxuZnVuY3Rpb24gbm9ybWFsaXplR2xvYmFsT3JkZXIob3JkZXIpIHtcclxuICBjb25zdCByZXN1bHQgPSBBcnJheS5pc0FycmF5KG9yZGVyKSA/IG9yZGVyLmZpbHRlcigoZW50cnkpID0+IGVudHJ5ICYmIHR5cGVvZiBlbnRyeSA9PT0gXCJvYmplY3RcIikgOiBbXTtcclxuICBjb25zdCBoYXNLaW5kID0gKGtpbmQpID0+IHJlc3VsdC5zb21lKChlbnRyeSkgPT4gZW50cnkua2luZCA9PT0ga2luZCk7XHJcbiAgaWYgKCFoYXNLaW5kKFwidHlwVmFsdWVcIikpIHJlc3VsdC51bnNoaWZ0KHsga2luZDogXCJ0eXBWYWx1ZVwiIH0pO1xyXG4gIGlmICghaGFzS2luZChcInN1YnR5cFZhbHVlXCIpKSB7XHJcbiAgICBjb25zdCB0eXBWYWx1ZUluZGV4ID0gcmVzdWx0LmZpbmRJbmRleCgoZW50cnkpID0+IGVudHJ5LmtpbmQgPT09IFwidHlwVmFsdWVcIik7XHJcbiAgICByZXN1bHQuc3BsaWNlKHR5cFZhbHVlSW5kZXggKyAxLCAwLCB7IGtpbmQ6IFwic3VidHlwVmFsdWVcIiB9KTtcclxuICB9XHJcbiAgaWYgKCFoYXNLaW5kKFwidHlwXCIpKSByZXN1bHQucHVzaCh7IGtpbmQ6IFwidHlwXCIgfSk7XHJcbiAgaWYgKCFoYXNLaW5kKFwib3RoZXJcIikpIHJlc3VsdC5wdXNoKHsga2luZDogXCJvdGhlclwiIH0pO1xyXG4gIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4gKiBGcm9udG1hdHRlci1Tb3J0aWVydW5nXHJcbiAqIEJyaW5ndCBkaWUgaW4gZWluZXIgTm90aXogVk9SSEFOREVORU4gUHJvcGVydGllcyBpbiBlaW5lIGZlc3RlXHJcbiAqIFJlaWhlbmZvbGdlIC0genVzYW1tZW5nZXNldHp0IGF1cyAoc2llaGUgZ2xvYmFsUHJvcGVydHlPcmRlcik6XHJcbiAqICAtIGdsb2JhbCBmZXN0IHBvc2l0aW9uaWVydGVuIEVpbnplbC1Qcm9wZXJ0aWVzICh6LiBCLiBjc3NjbGFzc2VzLFxyXG4gKiAgICBhbGlhc2VzOyBFaW5zdGVsbHVuZ2VuIC0+IFRZUCAtPiBHbG9iYWxlIFByb3BlcnR5LVJlaWhlbmZvbGdlKSxcclxuICogIC0gZGVyIFRZUC1Qcm9wZXJ0eSBzZWxic3QsXHJcbiAqICAtIGRlciBTVUJUWVAtUHJvcGVydHkgc2VsYnN0LFxyXG4gKiAgLSBkZW0gQmxvY2sgXCJUWVAtRnJvbnRtYXR0ZXJcIiAoVFlQLUZyb250bWF0dGVyLUxpc3RlIGRlc1xyXG4gKiAgICBqZXdlaWxpZ2VuIFR5cHMsIHNpZWhlIHR5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzLCBnZWZvbGd0IHZvbVxyXG4gKiAgICBGcm9udG1hdHRlci1CbG9jayBzZWluZXMgU1VCVFlQcyksIHVuZFxyXG4gKiAgLSBkZW0gQmxvY2sgXCJTb25zdGlnZSBQcm9wZXJ0aWVzXCIgKGFsbGVzIFx1MDBEQ2JyaWdlLCBpbiBiaXNoZXJpZ2VyXHJcbiAqICAgIFJlaWhlbmZvbGdlKS5cclxuICogRXJnXHUwMEU0bnp0IGRhYmVpIGtlaW5lIGZlaGxlbmRlbiBTdGFuZGFyZC1Qcm9wZXJ0aWVzIHVuZCBcdTAwRTRuZGVydCBrZWluZVxyXG4gKiBXZXJ0ZSAtIHJlaW5lIFVtc29ydGllcnVuZyBkZXIgYmVyZWl0cyB2b3JoYW5kZW5lbiBaZWlsZW4uXHJcbiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqL1xyXG5cclxuLy8gU3RhbmRhcmQtUHJvcGVydHktUmVpaGVuZm9sZ2UgZWluZXMgVHlwcywgaW5rbC4gZGVyIGRhcmluIGFscyBcIkZsb2F0aW5nXHJcbi8vIFByb3BlcnR5XCIgbWFya2llcnRlbiBLZXlzIChzaWVoZSB0eXBlRmxvYXRpbmdLZXlzIGluIHNldHRpbmdzLmpzKSBhbiBnZW5hdVxyXG4vLyBkZXIgU3RlbGxlLCBhbiBkZXIgc2llIGluIGRlciBMaXN0ZSBzdGVoZW4gLSBvaG5lIFRZUCBzZWxic3QgKGRhcyBpc3QgZG9ydFxyXG4vLyBudXIgYXVzIGhpc3RvcmlzY2hlbiBHclx1MDBGQ25kZW4gZXZ0bC4gbm9jaCBlbnRoYWx0ZW4sIHNpZWhlIHN0cmlwVHlwUHJvcGVydHkpXHJcbi8vIHVuZCBvaG5lIGRpZSBsZWVyZSBQbGF0emhhbHRlci1aZWlsZSBkZXMgRWRpdG9ycyAoXCJQcm9wZXJ0eSBoaW56dWZcdTAwRkNnZW5cIikuXHJcbi8vIEZsb2F0aW5nIFByb3BlcnRpZXMgd2VyZGVuIG51ciBuaWNodCBhdXRvbWF0aXNjaCB2b24gZ2V0VHlwZURlZmF1bHRzKClcclxuLy8gKG1haW4uanMpIGFuIFRlbXBsYXRlciBhdXNnZWxpZWZlcnQsIHNvbGxlbiBhYmVyIHRyb3R6ZGVtIGFuIGlocmVyXHJcbi8vIExpc3RlbnBvc2l0aW9uIGxhbmRlbiwgc29iYWxkIGVpbmUgTm90aXogc2llIGRvY2ggdHJcdTAwRTRndC4gbnVsbCwgd2VubiBrZWluXHJcbi8vIFR5cCBcdTAwRkNiZXJnZWJlbiB3dXJkZSBvZGVyIGZcdTAwRkNyIGRlbiBUeXAga2VpbmUgU3RhbmRhcmRsaXN0ZSBnZXBmbGVndCBpc3QuXHJcbi8vXHJcbi8vIE1pdCBzdWJ0eXBlIHp1c1x1MDBFNHR6bGljaCBkaWUgS2V5cyBhdXMgZGVzc2VuIEZyb250bWF0dGVyLUJsb2NrIChzaWVoZVxyXG4vLyBzdWJ0eXBlcy5qcykgLSBkYWhpbnRlciwgZGEgZGFzIFRZUC1Gcm9udG1hdHRlciBpbW1lciBvYmVuIHN0ZWh0LiBFaW4gS2V5LFxyXG4vLyBkZXIgaW4gQkVJREVOIEJsXHUwMEY2Y2tlbiB2b3Jrb21tdCwgYmVoXHUwMEU0bHQgZGllIFBvc2l0aW9uIGRlcyBUWVAtRnJvbnRtYXR0ZXJzXHJcbi8vIChkZXIgU3VidHlwIHN0ZXVlcnQgZG9ydCBudXIgV2VydCB1bmQgRmxvYXRpbmctTWFya2llcnVuZyBiZWksIHNpZWhlXHJcbi8vIGdldFR5cGVEZWZhdWx0cyBpbiBtYWluLmpzKSAtIGRlc2hhbGIgaGllciBiZXd1c3N0IFwiZXJzdGUgUG9zaXRpb24gelx1MDBFNGhsdFwiLlxyXG5mdW5jdGlvbiBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCB0eXBlLCBzdWJ0eXBlID0gbnVsbCkge1xyXG4gIGlmICghdHlwZSkgcmV0dXJuIG51bGw7XHJcbiAgY29uc3QgaXNTeXN0ZW1LZXkgPSAoa2V5KSA9PiBrZXkgPT09IFwiXCIgfHwgW1RZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZXS5zb21lKChwKSA9PiBrZXkudG9Mb3dlckNhc2UoKSA9PT0gcC50b0xvd2VyQ2FzZSgpKTtcclxuICBjb25zdCBzdWJ0eXBlRGF0YSA9IHN1YnR5cGUgPyBnZXRTdWJ0eXBlKHBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSkgOiBudWxsO1xyXG4gIGNvbnN0IGJsb2NrcyA9IFtwbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXSwgc3VidHlwZURhdGE/LmZyb250bWF0dGVyXTtcclxuICBjb25zdCBrZXlzID0gW107XHJcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQoKTtcclxuICBmb3IgKGNvbnN0IGJsb2NrIG9mIGJsb2Nrcykge1xyXG4gICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoYmxvY2sgPz8ge30pKSB7XHJcbiAgICAgIGlmIChpc1N5c3RlbUtleShrZXkpIHx8IHNlZW4uaGFzKGtleS50b0xvd2VyQ2FzZSgpKSkgY29udGludWU7XHJcbiAgICAgIGtleXMucHVzaChrZXkpO1xyXG4gICAgICBzZWVuLmFkZChrZXkudG9Mb3dlckNhc2UoKSk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIHJldHVybiBrZXlzLmxlbmd0aCA+IDAgPyBrZXlzIDogbnVsbDtcclxufVxyXG5cclxuLy8gUmVpaGVuZm9sZ2UsIGluIGRlciBkaWUgdm9yaGFuZGVuZW4gUHJvcGVydGllcyBlaW5lciBOb3RpeiBzdGVoZW4gc29sbGVuIC1cclxuLy8gYmVzdGltbXQga29tcGxldHQgZHVyY2ggZ2xvYmFsT3JkZXI6IGVpbnplbG5lIFByb3BlcnRpZXMgYW4gZmVzdGVyXHJcbi8vIFBvc2l0aW9uLCBzb3dpZSBkaWUgUGxhdHpoYWx0ZXIgXCJ0eXBWYWx1ZVwiIChkaWUgVFlQLVByb3BlcnR5IHNlbGJzdCksXHJcbi8vIFwic3VidHlwVmFsdWVcIiAoZGllIFNVQlRZUC1Qcm9wZXJ0eSBzZWxic3QpLCBcInR5cFwiIChTdGFuZGFyZGxpc3RlIGRlcyBUeXBzKVxyXG4vLyB1bmQgXCJvdGhlclwiIChhbGxlcyBcdTAwRENicmlnZSkuXHJcbi8vXHJcbi8vIFdlbGNoZXIgQmxvY2sgZWluZSBQcm9wZXJ0eSBiZWFuc3BydWNodCwgd2lyZCBWT1IgZGVtIGVpZ2VudGxpY2hlbiBBdWZiYXVcclxuLy8gZGVyIFJlaWhlbmZvbGdlIGZlc3RzdGVoZW5kIGJlc3RpbW10IChwaW5uZWQvdHlwQmxvY2svUmVzdCBzaW5kIGRpc2p1bmt0KSAtXHJcbi8vIG5pY2h0IGVyc3QgYmVpbSBsaW5lYXJlbiBEdXJjaGxhdWYgdm9uIGdsb2JhbE9yZGVyLiBEYXMgbWFjaHQgZGllXHJcbi8vIEJsb2NrLVp1b3JkbnVuZyB1bmFiaFx1MDBFNG5naWcgZGF2b24sIGluIHdlbGNoZXIgUmVpaGVuZm9sZ2UgZGllIEJsXHUwMEY2Y2tlIGluXHJcbi8vIGdsb2JhbE9yZGVyIHN0ZWhlbjogZWluZSBnbG9iYWwgZmVzdCBwb3NpdGlvbmllcnRlIFByb3BlcnR5IGdlaFx1MDBGNnJ0IGltbWVyIHp1XHJcbi8vIGlocmVtIGVpZ2VuZW4gRWludHJhZyAobmllIHp1c1x1MDBFNHR6bGljaCB6dW0gVHlwLUJsb2NrLCBzZWxic3Qgd2VubiBcIlRZUFxyXG4vLyBQcm9wZXJ0aWVzXCIgdm9yaGVyIGluIGRlciBMaXN0ZSBzdGVodCksIHVuZCBcIlNvbnN0aWdlIFByb3BlcnRpZXNcIiBlbnRoXHUwMEU0bHRcclxuLy8gaW1tZXIgbnVyIGVjaHRlIFJlc3RiZXN0XHUwMEU0bmRlIChuaWUgdmVyc2VoZW50bGljaCBQcm9wZXJ0aWVzLCBkaWUgZWlnZW50bGljaFxyXG4vLyBlaW5lbSBzcFx1MDBFNHRlciBpbiBkZXIgTGlzdGUgc3RlaGVuZGVuIEJsb2NrIGdlaFx1MDBGNnJlbikuXHJcbmZ1bmN0aW9uIGNvbXB1dGVTb3J0ZWRLZXlzKGV4aXN0aW5nS2V5cywgZ2xvYmFsT3JkZXIsIHR5cGVEZWZhdWx0S2V5cykge1xyXG4gIGNvbnN0IGxvd2VyVG9BY3R1YWwgPSBuZXcgTWFwKGV4aXN0aW5nS2V5cy5tYXAoKGtleSkgPT4gW2tleS50b0xvd2VyQ2FzZSgpLCBrZXldKSk7XHJcbiAgY29uc3QgcmVzb2x2ZSA9IChuYW1lKSA9PiBsb3dlclRvQWN0dWFsLmdldChuYW1lLnRvTG93ZXJDYXNlKCkpO1xyXG5cclxuICBjb25zdCBwaW5uZWQgPSBuZXcgU2V0KFxyXG4gICAgZ2xvYmFsT3JkZXJcclxuICAgICAgLmZpbHRlcigoZW50cnkpID0+IGVudHJ5LmtpbmQgPT09IFwicHJvcGVydHlcIilcclxuICAgICAgLm1hcCgoZW50cnkpID0+IHJlc29sdmUoZW50cnkubmFtZSkpXHJcbiAgICAgIC5maWx0ZXIoQm9vbGVhbilcclxuICApO1xyXG4gIGNvbnN0IHR5cEtleSA9IHJlc29sdmUoVFlQX1BST1BFUlRZKTtcclxuICBjb25zdCBzdWJ0eXBLZXkgPSByZXNvbHZlKFNVQlRZUF9QUk9QRVJUWSk7XHJcbiAgY29uc3QgdHlwQmxvY2tLZXlzID0gbmV3IFNldChcclxuICAgICh0eXBlRGVmYXVsdEtleXMgPz8gW10pLm1hcChyZXNvbHZlKS5maWx0ZXIoKGtleSkgPT4ga2V5ICYmIGtleSAhPT0gdHlwS2V5ICYmICFwaW5uZWQuaGFzKGtleSkpXHJcbiAgKTtcclxuICBjb25zdCBjbGFpbWVkID0gbmV3IFNldChwaW5uZWQpO1xyXG4gIGZvciAoY29uc3Qga2V5IG9mIHR5cEJsb2NrS2V5cykgY2xhaW1lZC5hZGQoa2V5KTtcclxuICBpZiAodHlwS2V5KSBjbGFpbWVkLmFkZCh0eXBLZXkpO1xyXG4gIGlmIChzdWJ0eXBLZXkpIGNsYWltZWQuYWRkKHN1YnR5cEtleSk7XHJcblxyXG4gIGNvbnN0IHNvcnRlZEtleXMgPSBbXTtcclxuICBjb25zdCBzZWVuID0gbmV3IFNldCgpO1xyXG4gIGNvbnN0IHB1c2ggPSAoa2V5KSA9PiB7XHJcbiAgICBpZiAoa2V5ICYmICFzZWVuLmhhcyhrZXkpKSB7XHJcbiAgICAgIHNvcnRlZEtleXMucHVzaChrZXkpO1xyXG4gICAgICBzZWVuLmFkZChrZXkpO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIGZvciAoY29uc3QgZW50cnkgb2YgZ2xvYmFsT3JkZXIpIHtcclxuICAgIGlmIChlbnRyeS5raW5kID09PSBcInByb3BlcnR5XCIpIHB1c2gocmVzb2x2ZShlbnRyeS5uYW1lKSk7XHJcbiAgICBlbHNlIGlmIChlbnRyeS5raW5kID09PSBcInR5cFZhbHVlXCIpIHB1c2godHlwS2V5KTtcclxuICAgIGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwic3VidHlwVmFsdWVcIikgcHVzaChzdWJ0eXBLZXkpO1xyXG4gICAgZWxzZSBpZiAoZW50cnkua2luZCA9PT0gXCJ0eXBcIikge1xyXG4gICAgICBmb3IgKGNvbnN0IG5hbWUgb2YgdHlwZURlZmF1bHRLZXlzID8/IFtdKSB7XHJcbiAgICAgICAgY29uc3Qga2V5ID0gcmVzb2x2ZShuYW1lKTtcclxuICAgICAgICBpZiAoa2V5ICYmIHR5cEJsb2NrS2V5cy5oYXMoa2V5KSkgcHVzaChrZXkpO1xyXG4gICAgICB9XHJcbiAgICB9IGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwib3RoZXJcIikge1xyXG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBleGlzdGluZ0tleXMpIHtcclxuICAgICAgICBpZiAoIWNsYWltZWQuaGFzKGtleSkpIHB1c2goa2V5KTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLy8gU2ljaGVyaGVpdHNuZXR6LCBmYWxscyBnbG9iYWxPcmRlciB1bnZvbGxzdFx1MDBFNG5kaWcgaXN0ICh6LiBCLiBrb3JydXB0ZVxyXG4gIC8vIEVpbnN0ZWxsdW5nZW4pIC0gZGllIFVJIHZlcmhpbmRlcnQgZGFzIGVpZ2VudGxpY2ggKHNpZWhlIG5vcm1hbGl6ZUdsb2JhbE9yZGVyKS5cclxuICBmb3IgKGNvbnN0IGtleSBvZiBleGlzdGluZ0tleXMpIHB1c2goa2V5KTtcclxuICByZXR1cm4gc29ydGVkS2V5cztcclxufVxyXG5cclxuLy8gXCJwb3NpdGlvblwiIGlzdCBrZWluIGVjaHRlcyBQcm9wZXJ0eSwgc29uZGVybiBPYnNpZGlhbnMgZWlnZW5lIEFuZ2FiZSB6dXJcclxuLy8gTGFnZSBkZXMgRnJvbnRtYXR0ZXItQmxvY2tzIGlubmVyaGFsYiBkZXIgRGF0ZWkgKG51ciBpbSBDYWNoZS1PYmpla3RcclxuLy8gdm9yaGFuZGVuLCBuaWNodCBpbSB2b24gcHJvY2Vzc0Zyb250TWF0dGVyIGdlbGllZmVydGVuIE9iamVrdCkuXHJcbmZ1bmN0aW9uIGNhY2hlZEZyb250bWF0dGVyS2V5cyhhcHAsIGZpbGUpIHtcclxuICBjb25zdCBmcm9udG1hdHRlciA9IGFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXI7XHJcbiAgaWYgKCFmcm9udG1hdHRlcikgcmV0dXJuIG51bGw7XHJcbiAgcmV0dXJuIE9iamVjdC5rZXlzKGZyb250bWF0dGVyKS5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBcInBvc2l0aW9uXCIpO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBzb3J0RmlsZUZyb250bWF0dGVyKGFwcCwgZmlsZSwgZ2xvYmFsT3JkZXIsIHR5cGVEZWZhdWx0S2V5cykge1xyXG4gIC8vIEdcdTAwRkNuc3RpZ2VyIFZvcmFiLUNoZWNrIFx1MDBGQ2JlciBkZW4gYmVyZWl0cyBpbSBTcGVpY2hlciB2b3JoYW5kZW5lbiBNZXRhZGF0YS1cclxuICAvLyBDYWNoZSAoa2VpbiBEYXRlaS1adWdyaWZmKTogZGVyIE5vcm1hbGZhbGwgLSBlaW5lIE5vdGl6IGlzdCBzY2hvbiBrb3JyZWt0XHJcbiAgLy8gc29ydGllcnQgLSBsXHUwMEU0c3N0IHNpY2ggc28gZXJrZW5uZW4sIG9obmUgZGllIERhdGVpIFx1MDBGQ2JlciBwcm9jZXNzRnJvbnRNYXR0ZXJcclxuICAvLyBcdTAwRkNiZXJoYXVwdCB6dSBcdTAwRjZmZm5lbi4gRGFzIGlzdCBiZWkgd2llZGVyaG9sdGVuIExcdTAwRTR1ZmVuIFx1MDBGQ2JlciBkZW4gZ2FuemVuXHJcbiAgLy8gVmF1bHQgZGVyIExcdTAwRjZ3ZW5hbnRlaWwgZGVyIE5vdGl6ZW4gdW5kIGRhbWl0IGRlciBlaWdlbnRsaWNoZSBHZXNjaHdpbmRpZy1cclxuICAvLyBrZWl0c2dld2lubi4gcHJvY2Vzc0Zyb250TWF0dGVyIGJsZWlidCB0cm90emRlbSBkaWUgYWxsZWluaWdlIFF1ZWxsZSBkZXJcclxuICAvLyBXYWhyaGVpdCBmXHUwMEZDciBkZW4gdGF0c1x1MDBFNGNobGljaGVuIFNjaHJlaWJ2b3JnYW5nIChDYWNoZSBrYW5uIGt1cnp6ZWl0aWdcclxuICAvLyB2ZXJhbHRldCBzZWluKSAtIGRlciBWb3JhYi1DaGVjayBcdTAwRkNiZXJzcHJpbmd0IG51ciBzaWNoZXIgdW52ZXJcdTAwRTRuZGVydGUgRlx1MDBFNGxsZS5cclxuICBjb25zdCBjYWNoZWRLZXlzID0gY2FjaGVkRnJvbnRtYXR0ZXJLZXlzKGFwcCwgZmlsZSk7XHJcbiAgaWYgKCFjYWNoZWRLZXlzIHx8IGNhY2hlZEtleXMubGVuZ3RoIDw9IDEpIHJldHVybiBmYWxzZTtcclxuICBjb25zdCBjYWNoZWRTb3J0ZWQgPSBjb21wdXRlU29ydGVkS2V5cyhjYWNoZWRLZXlzLCBnbG9iYWxPcmRlciwgdHlwZURlZmF1bHRLZXlzKTtcclxuICBpZiAoY2FjaGVkU29ydGVkLmV2ZXJ5KChrZXksIGkpID0+IGtleSA9PT0gY2FjaGVkS2V5c1tpXSkpIHJldHVybiBmYWxzZTtcclxuXHJcbiAgbGV0IGNoYW5nZWQgPSBmYWxzZTtcclxuICBhd2FpdCBhcHAuZmlsZU1hbmFnZXIucHJvY2Vzc0Zyb250TWF0dGVyKGZpbGUsIChmcm9udG1hdHRlcikgPT4ge1xyXG4gICAgY2hhbmdlZCA9IHNvcnRGcm9udG1hdHRlck9iamVjdChmcm9udG1hdHRlciwgZ2xvYmFsT3JkZXIsIHR5cGVEZWZhdWx0S2V5cyk7XHJcbiAgfSk7XHJcbiAgcmV0dXJuIGNoYW5nZWQ7XHJcbn1cclxuXHJcbi8vIFNvcnRpZXJ0IGRhcyB2b24gcHJvY2Vzc0Zyb250TWF0dGVyIGdlbGllZmVydGUgT2JqZWt0IGluLXBsYWNlIChzaWVoZVxyXG4vLyBLb21tZW50YXIgaW4gdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMgenUgc2F2ZUZyb250bWF0dGVyL3N0cmlwVHlwUHJvcGVydHkpOlxyXG4vLyBPYmpla3QtSW5zZXJ0aW9uLU9yZGVyIGJlc3RpbW10IGRpZSBzcFx1MDBFNHRlcmUgWUFNTC1SZWloZW5mb2xnZSwgZGFoZXIgYWxsZVxyXG4vLyBLZXlzIGxcdTAwRjZzY2hlbiB1bmQgaW4gbmV1ZXIgUmVpaGVuZm9sZ2Ugd2llZGVyIGVpbmZcdTAwRkNnZW4sIHN0YXR0IGVpbiBuZXVlc1xyXG4vLyBPYmpla3QgenVyXHUwMEZDY2t6dWdlYmVuLiBMaWVmZXJ0IHRydWUgYmVpIGVpbmVyIFx1MDBDNG5kZXJ1bmcuXHJcbmZ1bmN0aW9uIHNvcnRGcm9udG1hdHRlck9iamVjdChmcm9udG1hdHRlciwgZ2xvYmFsT3JkZXIsIHR5cGVEZWZhdWx0S2V5cykge1xyXG4gIGNvbnN0IGV4aXN0aW5nS2V5cyA9IE9iamVjdC5rZXlzKGZyb250bWF0dGVyKTtcclxuICBpZiAoZXhpc3RpbmdLZXlzLmxlbmd0aCA8PSAxKSByZXR1cm4gZmFsc2U7XHJcblxyXG4gIGNvbnN0IHNvcnRlZEtleXMgPSBjb21wdXRlU29ydGVkS2V5cyhleGlzdGluZ0tleXMsIGdsb2JhbE9yZGVyLCB0eXBlRGVmYXVsdEtleXMpO1xyXG4gIGlmIChzb3J0ZWRLZXlzLmV2ZXJ5KChrZXksIGkpID0+IGtleSA9PT0gZXhpc3RpbmdLZXlzW2ldKSkgcmV0dXJuIGZhbHNlO1xyXG5cclxuICBjb25zdCBzbmFwc2hvdCA9IHsgLi4uZnJvbnRtYXR0ZXIgfTtcclxuICBmb3IgKGNvbnN0IGtleSBvZiBleGlzdGluZ0tleXMpIGRlbGV0ZSBmcm9udG1hdHRlcltrZXldO1xyXG4gIGZvciAoY29uc3Qga2V5IG9mIHNvcnRlZEtleXMpIGZyb250bWF0dGVyW2tleV0gPSBzbmFwc2hvdFtrZXldO1xyXG4gIHJldHVybiB0cnVlO1xyXG59XHJcblxyXG4vLyBGXHUwMEZDciBBdWZydWZlciwgZGllIG9obmVoaW4gZ2VyYWRlIGluIHByb2Nlc3NGcm9udE1hdHRlciBzY2hyZWliZW4gKHouIEIuXHJcbi8vIGFwcGx5VHlwZVByb3BlcnRpZXMvX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qcyk6IHNvcnRpZXJ0IGRhc1xyXG4vLyBPYmpla3QgZGlyZWt0IG1pdCBhdXNkclx1MDBGQ2NrbGljaCBcdTAwRkNiZXJnZWJlbmVtIFRZUC9TdWJ0eXAgLSBkZXIgSW5kZXggYnp3LlxyXG4vLyBNZXRhZGF0YS1DYWNoZSBrZW5udCBkaWUgZ2VyYWRlIGdlc2NocmllYmVuZW4gV2VydGUgenUgZGllc2VtIFplaXRwdW5rdFxyXG4vLyBub2NoIG5pY2h0LlxyXG5mdW5jdGlvbiBzb3J0RnJvbnRtYXR0ZXJGb3IocGx1Z2luLCBmcm9udG1hdHRlciwgdHlwZSwgc3VidHlwZSkge1xyXG4gIGNvbnN0IGdsb2JhbE9yZGVyID0gbm9ybWFsaXplR2xvYmFsT3JkZXIocGx1Z2luLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIpO1xyXG4gIHJldHVybiBzb3J0RnJvbnRtYXR0ZXJPYmplY3QoZnJvbnRtYXR0ZXIsIGdsb2JhbE9yZGVyLCBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCB0eXBlLCBzdWJ0eXBlKSk7XHJcbn1cclxuXHJcbi8vIFNldHp0IG51ciBkaWUgZWluZSBQcm9wZXJ0eSBrZXkgYW4gaWhyZW4gUGxhdHogbGF1dCBGcm9udG1hdHRlci1Tb3J0aWVydW5nLFxyXG4vLyBhbGxlIFx1MDBGQ2JyaWdlbiBibGVpYmVuIGluIGlocmVyIGJpc2hlcmlnZW4gUmVpaGVuZm9sZ2UgLSBmXHUwMEZDciBBdWZydWZlciwgZGllXHJcbi8vIGdlcmFkZSBlaW5lIFByb3BlcnR5IG5ldSBhbmdlbGVndCBoYWJlbiAoei4gQi4gRnJlZHMgUHJvcGVydHktQmFja2xpbmtpbmcpLFxyXG4vLyBkaWUgc29uc3QgYW0gRW5kZSBsYW5kZW4gd1x1MDBGQ3JkZSwgb2huZSBkYWZcdTAwRkNyIGdsZWljaCBkYXMgZ2FuemUsIGV2dGwuIGJld3Vzc3RcclxuLy8gYW5kZXJzIHNvcnRpZXJ0ZSBGcm9udG1hdHRlciB1bXp1c3RlbGxlbi4gVFlQL1NVQlRZUCB3ZXJkZW4gYXVzIGRlbVxyXG4vLyBcdTAwRkNiZXJnZWJlbmVuIE9iamVrdCBnZWxlc2VuLCBuaWNodCBhdXMgSW5kZXgvQ2FjaGUgKGRpZSBrZW5uZW4gaW5uZXJoYWxiIHZvblxyXG4vLyBwcm9jZXNzRnJvbnRNYXR0ZXIgZXZ0bC4gbm9jaCBlaW5lbiBcdTAwRTRsdGVyZW4gU3RhbmQpLlxyXG4vL1xyXG4vLyBQbGF0eiA9IGRpcmVrdCBoaW50ZXIgZGVtIG5cdTAwRTRjaHN0ZW4gVm9yZ1x1MDBFNG5nZXIsIGRlbiBrZXkgaW4gZGVyIHZvbGxzdFx1MDBFNG5kaWdcclxuLy8gc29ydGllcnRlbiBSZWloZW5mb2xnZSBoXHUwMEU0dHRlIChnYW56IG5hY2ggdm9ybiwgd2VubiBlcyBrZWluZW4gZ2lidCkuIExpZWZlcnRcclxuLy8gdHJ1ZSBiZWkgZWluZXIgXHUwMEM0bmRlcnVuZy5cclxuZnVuY3Rpb24gcGxhY2VQcm9wZXJ0eUZvcihwbHVnaW4sIGZyb250bWF0dGVyLCBrZXkpIHtcclxuICBjb25zdCBleGlzdGluZ0tleXMgPSBPYmplY3Qua2V5cyhmcm9udG1hdHRlcik7XHJcbiAgY29uc3QgYWN0dWFsS2V5ID0gZXhpc3RpbmdLZXlzLmZpbmQoKGspID0+IGsudG9Mb3dlckNhc2UoKSA9PT0ga2V5LnRvTG93ZXJDYXNlKCkpO1xyXG4gIGlmICghYWN0dWFsS2V5IHx8IGV4aXN0aW5nS2V5cy5sZW5ndGggPD0gMSkgcmV0dXJuIGZhbHNlO1xyXG5cclxuICBjb25zdCBnbG9iYWxPcmRlciA9IG5vcm1hbGl6ZUdsb2JhbE9yZGVyKHBsdWdpbi5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyKTtcclxuICBjb25zdCB0eXBlID0gdHlwZUtleU9mKHByb3BlcnR5VmFsdWUoZnJvbnRtYXR0ZXIsIFRZUF9QUk9QRVJUWSkpO1xyXG4gIGNvbnN0IHN1YnR5cGUgPSB0eXBlS2V5T2YocHJvcGVydHlWYWx1ZShmcm9udG1hdHRlciwgU1VCVFlQX1BST1BFUlRZKSk7XHJcbiAgY29uc3Qgc29ydGVkS2V5cyA9IGNvbXB1dGVTb3J0ZWRLZXlzKGV4aXN0aW5nS2V5cywgZ2xvYmFsT3JkZXIsIG9yZGVyZWREZWZhdWx0S2V5cyhwbHVnaW4sIHR5cGUsIHN1YnR5cGUpKTtcclxuXHJcbiAgY29uc3QgcmVzdCA9IGV4aXN0aW5nS2V5cy5maWx0ZXIoKGspID0+IGsgIT09IGFjdHVhbEtleSk7XHJcbiAgY29uc3QgcHJlZGVjZXNzb3IgPSBzb3J0ZWRLZXlzLnNsaWNlKDAsIHNvcnRlZEtleXMuaW5kZXhPZihhY3R1YWxLZXkpKS5wb3AoKTtcclxuICBjb25zdCBuZXdLZXlzID0gWy4uLnJlc3RdO1xyXG4gIG5ld0tleXMuc3BsaWNlKHByZWRlY2Vzc29yID09PSB1bmRlZmluZWQgPyAwIDogcmVzdC5pbmRleE9mKHByZWRlY2Vzc29yKSArIDEsIDAsIGFjdHVhbEtleSk7XHJcbiAgaWYgKG5ld0tleXMuZXZlcnkoKGssIGkpID0+IGsgPT09IGV4aXN0aW5nS2V5c1tpXSkpIHJldHVybiBmYWxzZTtcclxuXHJcbiAgY29uc3Qgc25hcHNob3QgPSB7IC4uLmZyb250bWF0dGVyIH07XHJcbiAgZm9yIChjb25zdCBrIG9mIGV4aXN0aW5nS2V5cykgZGVsZXRlIGZyb250bWF0dGVyW2tdO1xyXG4gIGZvciAoY29uc3QgayBvZiBuZXdLZXlzKSBmcm9udG1hdHRlcltrXSA9IHNuYXBzaG90W2tdO1xyXG4gIHJldHVybiB0cnVlO1xyXG59XHJcblxyXG4vLyBTb3J0aWVydCBlaW5lIGVpbnplbG5lLCBiZXJlaXRzIGJla2FubnRlIE5vdGl6ICh6LiBCLiBkaWUgYWt0aXZlIERhdGVpKS5cclxuYXN5bmMgZnVuY3Rpb24gc29ydFNpbmdsZUZpbGVGcm9udG1hdHRlcihhcHAsIHBsdWdpbiwgZmlsZSkge1xyXG4gIGNvbnN0IGdsb2JhbE9yZGVyID0gbm9ybWFsaXplR2xvYmFsT3JkZXIocGx1Z2luLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIpO1xyXG4gIC8vIFVuc2F1YmVyZSBUWVAtV2VydGUgKExpc3RlLCBSYW5kbGVlcnplaWNoZW4pIGhhYmVuIGtlaW5lIFN0YW5kYXJkbGlzdGUgLVxyXG4gIC8vIGRhbm4gZ3JlaWZ0IG51ciBkaWUgZ2xvYmFsZSBSZWloZW5mb2xnZSAoc2llaGUgdHlwZUtleU9mIGluIHR5cC1pbmRleC5qcykuXHJcbiAgY29uc3QgdHlwZSA9IHBsdWdpbi50eXBJbmRleC50eXBlT2YoZmlsZSk7XHJcbiAgY29uc3QgdHlwZURlZmF1bHRLZXlzID0gb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgdHlwZSwgcGx1Z2luLnR5cEluZGV4LnN1YnR5cGVPZihmaWxlKSk7XHJcbiAgcmV0dXJuIHNvcnRGaWxlRnJvbnRtYXR0ZXIoYXBwLCBmaWxlLCBnbG9iYWxPcmRlciwgdHlwZURlZmF1bHRLZXlzKTtcclxufVxyXG5cclxuLy8gb25seVR5cGU6IG9wdGlvbmFsIC0gYmVzY2hyXHUwMEU0bmt0IGRlbiBMYXVmIGF1ZiBOb3RpemVuIGdlbmF1IGRpZXNlcyBUeXBzLlxyXG4vLyBPaG5lIG9ubHlUeXBlIHdlcmRlbiBhbGxlIE5vdGl6ZW4gZ2Vwclx1MDBGQ2Z0LCBhdWNoIG9obmUgVFlQIG9kZXIgbWl0IGVpbmVtIFR5cFxyXG4vLyBvaG5lIGdlcGZsZWd0ZSBTdGFuZGFyZGxpc3RlIC0gZGllIGdsb2JhbCBmZXN0IHBvc2l0aW9uaWVydGVuIFByb3BlcnRpZXNcclxuLy8gKHouIEIuIGNzc2NsYXNzZXMpIHNvbGxlbiB1bmFiaFx1MDBFNG5naWcgdm9tIFR5cCB3aXJrZW4ga1x1MDBGNm5uZW4uIEZcdTAwRkNyIE5vdGl6ZW4sIGJlaVxyXG4vLyBkZW5lbiB3ZWRlciBlaW4gcGFzc2VuZGVyIFR5cC1CbG9jayBub2NoIGVpbmUgZGVyIGtvbmZpZ3VyaWVydGVuXHJcbi8vIEVpbnplbC1Qcm9wZXJ0aWVzIGdyZWlmdCwgYmxlaWJ0IGRpZSBiaXNoZXJpZ2UgUmVpaGVuZm9sZ2UgdW52ZXJcdTAwRTRuZGVydC5cclxuYXN5bmMgZnVuY3Rpb24gc29ydEFsbEZyb250bWF0dGVyKGFwcCwgcGx1Z2luLCBvbmx5VHlwZSkge1xyXG4gIGxldCBjaGVja2VkID0gMDtcclxuICBsZXQgY2hhbmdlZCA9IDA7XHJcbiAgY29uc3QgZ2xvYmFsT3JkZXIgPSBub3JtYWxpemVHbG9iYWxPcmRlcihwbHVnaW4uc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcik7XHJcbiAgLy8gTnVyIGF1c3NhZ2Vrclx1MDBFNGZ0aWcsIHdlbm4gZWluIGVpbnplbG5lciBUeXAgZWluZ2VncmVuenQgd3VyZGUgKHNvbnN0XHJcbiAgLy8gd2VjaHNlbHQgZGVyIFR5cCB2b24gRGF0ZWkgenUgRGF0ZWkpIC0gZlx1MDBGQ3IgZGllIFJcdTAwRkNja21lbGR1bmcgZGVzIEJlZmVobHNcclxuICAvLyBcIlRZUCBGcm9udG1hdHRlciBTb3J0aWVydW5nIGFrdHVhbGlzaWVyZW5cIiwgZmFsbHMgZlx1MDBGQ3IgZGVuIGdld1x1MDBFNGhsdGVuIFR5cFxyXG4gIC8vIGdhciBrZWluZSBUWVAtRnJvbnRtYXR0ZXItTGlzdGUgZ2VwZmxlZ3QgaXN0LlxyXG4gIGNvbnN0IGhhc1R5cGVEZWZhdWx0cyA9IG9ubHlUeXBlID8gb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgb25seVR5cGUpICE9PSBudWxsIDogbnVsbDtcclxuXHJcbiAgZm9yIChjb25zdCBmaWxlIG9mIGFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCkpIHtcclxuICAgIGlmICghcGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXMgJiYgYXBwLm1ldGFkYXRhQ2FjaGUuaXNVc2VySWdub3JlZChmaWxlLnBhdGgpKSBjb250aW51ZTtcclxuXHJcbiAgICBjb25zdCB0eXBlID0gcGx1Z2luLnR5cEluZGV4LnR5cGVPZihmaWxlKTtcclxuICAgIGlmIChvbmx5VHlwZSAmJiB0eXBlICE9PSBvbmx5VHlwZSkgY29udGludWU7XHJcblxyXG4gICAgY29uc3QgdHlwZURlZmF1bHRLZXlzID0gb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgdHlwZSwgcGx1Z2luLnR5cEluZGV4LnN1YnR5cGVPZihmaWxlKSk7XHJcbiAgICBjaGVja2VkKys7XHJcbiAgICBpZiAoYXdhaXQgc29ydEZpbGVGcm9udG1hdHRlcihhcHAsIGZpbGUsIGdsb2JhbE9yZGVyLCB0eXBlRGVmYXVsdEtleXMpKSBjaGFuZ2VkKys7XHJcbiAgfVxyXG5cclxuICByZXR1cm4geyBjaGVja2VkLCBjaGFuZ2VkLCBoYXNUeXBlRGVmYXVsdHMgfTtcclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSB7XHJcbiAgc29ydEFsbEZyb250bWF0dGVyLFxyXG4gIHNvcnRTaW5nbGVGaWxlRnJvbnRtYXR0ZXIsXHJcbiAgc29ydEZyb250bWF0dGVyRm9yLFxyXG4gIHBsYWNlUHJvcGVydHlGb3IsXHJcbiAgbm9ybWFsaXplR2xvYmFsT3JkZXIsXHJcbiAgREVGQVVMVF9HTE9CQUxfT1JERVIsXHJcbiAgVFlQX1BST1BFUlRZLFxyXG4gIFNVQlRZUF9QUk9QRVJUWSxcclxufTtcclxuIiwgImNvbnN0IHsgc2V0SWNvbiwgTm90aWNlIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IFRZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZLCBzb3J0QWxsRnJvbnRtYXR0ZXIgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLXNvcnRcIik7XG5cbi8vIEFuemVpZ2V0ZXh0IGRlciB2aWVyIG5pY2h0IGVudGZlcm5iYXJlbiBQbGF0emhhbHRlci1aZWlsZW4gLSBcInR5cFZhbHVlXCIgaXN0XG4vLyBkaWUgVFlQLVByb3BlcnR5IHNlbGJzdCwgXCJzdWJ0eXBWYWx1ZVwiIGFuYWxvZyBkaWUgU1VCVFlQLVByb3BlcnR5LCBcInR5cFwiXG4vLyBkaWUgVFlQLUZyb250bWF0dGVyLUxpc3RlIGRlcyBUWVBzIChzaWVoZVxuLy8gdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpLCBcIm90aGVyXCIgYWxsZSBQcm9wZXJ0aWVzLCBkaWUgd2VkZXIgZG9ydCBub2NoXG4vLyBpbiBkaWVzZXIgTGlzdGUgbmFtZW50bGljaCBnZWZcdTAwRkNocnQgd2VyZGVuLiBTaWVoZSBjb21wdXRlU29ydGVkS2V5cyBpblxuLy8gZnJvbnRtYXR0ZXItc29ydC5qcyBmXHUwMEZDciBkaWUgdGF0c1x1MDBFNGNobGljaGUgQXVmbFx1MDBGNnN1bmcgZGllc2VyIEJsXHUwMEY2Y2tlLlxuY29uc3QgUExBQ0VIT0xERVJfTEFCRUxTID0ge1xuICB0eXBWYWx1ZTogXCJUWVBcIixcbiAgc3VidHlwVmFsdWU6IFwiU1VCVFlQXCIsXG4gIHR5cDogXCJUWVAtRnJvbnRtYXR0ZXJcIixcbiAgb3RoZXI6IFwiU29uc3RpZ2UgUHJvcGVydGllc1wiLFxufTtcblxuLy8gRWRpdG9yIGZcdTAwRkNyIHBsdWdpbi5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyOiBlaW5lIHJlaW5lIE5hbWVuc2xpc3RlXG4vLyAoa2VpbmUgV2VydGUsIGRhaGVyIGtlaW4gZWlnZW5lciBwcml2YXRlLUFQSS1VbXdlZyBcdTAwRkNiZXIgT2JzaWRpYW5zXG4vLyBNZXRhZGF0YS1FZGl0b3ItV2lkZ2V0IHdpZSBpbiB0eXBlLWZyb250bWF0dGVyLWVkaXRvci5qcyBuXHUwMEY2dGlnKSBtaXRcbi8vIERyYWctYW5kLWRyb3AtU29ydGllcnVuZy4gRGllIGRyZWkgUGxhdHpoYWx0ZXItWmVpbGVuIHNpbmQgVGVpbCBkZXJzZWxiZW5cbi8vIExpc3RlLCBsYXNzZW4gc2ljaCB2ZXJzY2hpZWJlbiwgYWJlciBuaWNodCBwZXIgVUkgZW50ZmVybmVuLlxuZnVuY3Rpb24gbW91bnRHbG9iYWxPcmRlckVkaXRvcihjb250YWluZXJFbCwgcGx1Z2luKSB7XG4gIGNvbnN0IGhlYWRlciA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1mcm9udG1hdHRlci1oZWFkZXJcIiB9KTtcblxuICAvLyBFaWdlbmUgR3J1cHBlIGZcdTAwRkNyIEJ1dHRvbiArIFx1MDBEQ2JlcnNjaHJpZnQsIHN0YXR0IGJlaWRlIGFscyBnZXRyZW5udGUgS2luZGVyXG4gIC8vIHZvbiBoZWFkZXIgZGlyZWt0OiBiZWkganVzdGlmeS1jb250ZW50OiBzcGFjZS1iZXR3ZWVuIChzaWVoZSBDU1MpIHdcdTAwRkNyZGVcbiAgLy8gZWluIGRyaXR0ZXMgS2luZCB6d2lzY2hlbiBcdTAwRENiZXJzY2hyaWZ0IHVuZCBcIitcIi1CdXR0b24gc29uc3QgbWl0dGlnIGltXG4gIC8vIHZlcmJsZWliZW5kZW4gUGxhdHogbGFuZGVuLCBzdGF0dCBkaXJla3QgbmViZW4gZGVyIFx1MDBEQ2JlcnNjaHJpZnQgenUgc2l0emVuLlxuICBjb25zdCB0aXRsZUdyb3VwID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1mcm9udG1hdHRlci10aXRsZS1ncm91cFwiIH0pO1xuXG4gIC8vIFdlbmRldCBkaWUgYWt0dWVsbGUgUmVpaGVuZm9sZ2Ugc29mb3J0IGF1ZiBkZW4gZ2VzYW10ZW4gVmF1bHQgYW4gLSBkZXJzZWxiZVxuICAvLyBMYXVmIHdpZSBkZXIgQmVmZWhsIFwiRnJvbnRtYXR0ZXIgU29ydGllcnVuZyBHTE9CQUwgYWt0dWFsaXNpZXJlblwiXG4gIC8vIChzb3J0QWxsRnJvbnRtYXR0ZXIgbWl0IG9ubHlUeXBlIG51bGwpLCBudXIgZGlyZWt0IG5lYmVuIGRlciBMaXN0ZVxuICAvLyBlcnJlaWNoYmFyIHN0YXR0IFx1MDBGQ2JlciBkaWUgQmVmZWhsc3BhbGV0dGUuXG4gIGNvbnN0IGFwcGx5QnRuID0gdGl0bGVHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb25cIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJBdWYgYWxsZSBOb3RpemVuIGFud2VuZGVuXCIgfSB9KTtcbiAgc2V0SWNvbihhcHBseUJ0biwgXCJwbGF5XCIpO1xuICBhcHBseUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCB7IGNoZWNrZWQsIGNoYW5nZWQgfSA9IGF3YWl0IHNvcnRBbGxGcm9udG1hdHRlcihwbHVnaW4uYXBwLCBwbHVnaW4sIG51bGwpO1xuICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgY2hhbmdlZCA+IDBcbiAgICAgICAgICA/IGBGcm9udG1hdHRlciBTb3J0aWVydW5nOiAke2NoZWNrZWR9IE5vdGl6ZW4gZ2Vwclx1MDBGQ2Z0LCAke2NoYW5nZWR9IHNvcnRpZXJ0LmBcbiAgICAgICAgICA6IGBGcm9udG1hdHRlciBTb3J0aWVydW5nOiAke2NoZWNrZWR9IE5vdGl6ZW4gZ2Vwclx1MDBGQ2Z0LCBiZXJlaXRzIGFsbGUgc29ydGllcnQuYFxuICAgICAgKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihcIltGcm9udG1hdHRlciBTb3J0aWVydW5nXVwiLCBlcnJvcik7XG4gICAgICBuZXcgTm90aWNlKGBGcm9udG1hdHRlciBTb3J0aWVydW5nIGZlaGxnZXNjaGxhZ2VuOiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgfVxuICB9KTtcblxuICB0aXRsZUdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtc2VjdGlvbi10aXRsZVwiLCB0ZXh0OiBcIkdsb2JhbGUgUHJvcGVydHktUmVpaGVuZm9sZ2VcIiB9KTtcblxuICBjb25zdCBhZGRCdG4gPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiUHJvcGVydHkgaGluenVmXHUwMEZDZ2VuXCIgfSB9KTtcbiAgc2V0SWNvbihhZGRCdG4sIFwicGx1c1wiKTtcblxuICBjb25zdCBsaXN0RWwgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC1vcmRlci1saXN0XCIgfSk7XG5cbiAgY29uc3Qgb3JkZXIgPSAoKSA9PiBwbHVnaW4uc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcjtcblxuICAvLyBOZXVlIFplaWxlIHdpcmQgZXJzdCBiZWkgZWluZW0gZ1x1MDBGQ2x0aWdlbiwgbmljaHQtbGVlcmVuIE5hbWVuIHRhdHNcdTAwRTRjaGxpY2ggaW5cbiAgLy8gcGx1Z2luLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIgYXVmZ2Vub21tZW4gKHVuZCBkYW1pdCBwb3RlbnppZWxsXG4gIC8vIGdlc3BlaWNoZXJ0KSAtIGJpcyBkYWhpbiBleGlzdGllcnQgc2llIG51ciBhbHMgbG9rYWxlciBFbnR3dXJmLCBkZXIgYmVpbVxuICAvLyBSZS1SZW5kZXIgenVzXHUwMEU0dHpsaWNoIGFucyBFbmRlIGRlciBlY2h0ZW4gTGlzdGUgZ2VoXHUwMEU0bmd0IHdpcmQuIFNvIGxhbmRlblxuICAvLyBsZWVyZSBQcm9wZXJ0eS1GZWxkZXIgbmllIGluIGRlbiBFaW5zdGVsbHVuZ2VuLCBzZWxic3Qgd2VubiB6d2lzY2hlbmR1cmNoXG4gIC8vIGF1cyBhbmRlcmVtIEFubGFzcyAoei4gQi4gVmVyc2NoaWViZW4gZWluZXIgYW5kZXJlbiBaZWlsZSkgZ2VzcGVpY2hlcnQgd2lyZC5cbiAgbGV0IGRyYWZ0RW50cnkgPSBudWxsO1xuXG4gIGNvbnN0IGlzRHVwbGljYXRlTmFtZSA9ICh2YWx1ZSwgb3duRW50cnkpID0+IHtcbiAgICBjb25zdCBsb3dlciA9IHZhbHVlLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKGxvd2VyID09PSBUWVBfUFJPUEVSVFkudG9Mb3dlckNhc2UoKSB8fCBsb3dlciA9PT0gU1VCVFlQX1BST1BFUlRZLnRvTG93ZXJDYXNlKCkpIHJldHVybiB0cnVlO1xuICAgIHJldHVybiBvcmRlcigpLnNvbWUoKG90aGVyKSA9PiBvdGhlciAhPT0gb3duRW50cnkgJiYgb3RoZXIua2luZCA9PT0gXCJwcm9wZXJ0eVwiICYmIG90aGVyLm5hbWUudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXIpO1xuICB9O1xuXG4gIGNvbnN0IHJlbmRlciA9ICgpID0+IHtcbiAgICBsaXN0RWwuZW1wdHkoKTtcbiAgICBjb25zdCBlbnRyaWVzID0gZHJhZnRFbnRyeSA/IFsuLi5vcmRlcigpLCBkcmFmdEVudHJ5XSA6IG9yZGVyKCk7XG5cbiAgICBlbnRyaWVzLmZvckVhY2goKGVudHJ5LCBpbmRleCkgPT4ge1xuICAgICAgY29uc3QgaXNEcmFmdCA9IGVudHJ5ID09PSBkcmFmdEVudHJ5O1xuICAgICAgY29uc3QgaXNQbGFjZWhvbGRlciA9IGVudHJ5LmtpbmQgIT09IFwicHJvcGVydHlcIjtcbiAgICAgIGNvbnN0IHJvd0NscyA9XG4gICAgICAgIFwiZnJlZC1vcmRlci1yb3dcIiArIChpc1BsYWNlaG9sZGVyID8gXCIgaXMtcGxhY2Vob2xkZXJcIiA6IFwiXCIpICsgKGVudHJ5LmtpbmQgPT09IFwidHlwXCIgPyBcIiBpcy10eXAtZGVmYXVsdHNcIiA6IFwiXCIpO1xuICAgICAgY29uc3Qgcm93ID0gbGlzdEVsLmNyZWF0ZURpdih7IGNsczogcm93Q2xzIH0pO1xuXG4gICAgICBjb25zdCBkcmFnSGFuZGxlID0gcm93LmNyZWF0ZURpdih7IGNsczogXCJmcmVkLW9yZGVyLWRyYWdcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJWZXJzY2hpZWJlblwiIH0gfSk7XG4gICAgICBzZXRJY29uKGRyYWdIYW5kbGUsIFwiZ3JpcC12ZXJ0aWNhbFwiKTtcblxuICAgICAgaWYgKGlzUGxhY2Vob2xkZXIpIHtcbiAgICAgICAgcm93LmNyZWF0ZURpdih7IGNsczogXCJmcmVkLW9yZGVyLWxhYmVsXCIsIHRleHQ6IFBMQUNFSE9MREVSX0xBQkVMU1tlbnRyeS5raW5kXSB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IGlucHV0ID0gcm93LmNyZWF0ZUVsKFwiaW5wdXRcIiwge1xuICAgICAgICAgIHR5cGU6IFwidGV4dFwiLFxuICAgICAgICAgIGNsczogXCJmcmVkLW9yZGVyLW5hbWUtaW5wdXRcIixcbiAgICAgICAgICBhdHRyOiB7IHBsYWNlaG9sZGVyOiBcIlByb3BlcnR5LU5hbWVcIiB9LFxuICAgICAgICB9KTtcbiAgICAgICAgaW5wdXQudmFsdWUgPSBlbnRyeS5uYW1lO1xuXG4gICAgICAgIC8vIFwiYmx1clwiIHN0YXR0IFwiY2hhbmdlXCI6IExldHp0ZXJlcyBmZXVlcnQgYmVpIGVpbmVtIGxlZXIgZ2VibGllYmVuZW5cbiAgICAgICAgLy8gRmVsZCBnYXIgbmljaHQgZXJzdCAoQnJvd3NlciBzZWhlbiBkYXJpbiBrZWluZSBXZXJ0XHUwMEU0bmRlcnVuZykgLSBkZXJcbiAgICAgICAgLy8gRW50d3VyZiB3XHUwMEZDcmRlIGRhbm4gbmllIGF1Zmdlclx1MDBFNHVtdC4gXCJibHVyXCIgZ3JlaWZ0IHp1dmVybFx1MDBFNHNzaWcgaW5cbiAgICAgICAgLy8gYmVpZGVuIEZcdTAwRTRsbGVuICh1bWJlbmVubmVuIHdpZSBsZWVyIGxhc3NlbikuXG4gICAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJibHVyXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBjb25zdCB2YWx1ZSA9IGlucHV0LnZhbHVlLnRyaW0oKTtcblxuICAgICAgICAgIGlmICghdmFsdWUpIHtcbiAgICAgICAgICAgIGlmIChpc0RyYWZ0KSB7XG4gICAgICAgICAgICAgIGRyYWZ0RW50cnkgPSBudWxsO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgb3JkZXIoKS5zcGxpY2Uob3JkZXIoKS5pbmRleE9mKGVudHJ5KSwgMSk7XG4gICAgICAgICAgICAgIGF3YWl0IHBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlbmRlcigpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChpc0R1cGxpY2F0ZU5hbWUodmFsdWUsIGlzRHJhZnQgPyBudWxsIDogZW50cnkpKSB7XG4gICAgICAgICAgICBuZXcgTm90aWNlKGBcIiR7dmFsdWV9XCIgaXN0IGJlcmVpdHMgaW4gZGVyIExpc3RlLmApO1xuICAgICAgICAgICAgaW5wdXQudmFsdWUgPSBlbnRyeS5uYW1lO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGVudHJ5Lm5hbWUgPSB2YWx1ZTtcbiAgICAgICAgICBpZiAoaXNEcmFmdCkge1xuICAgICAgICAgICAgb3JkZXIoKS5wdXNoKGVudHJ5KTtcbiAgICAgICAgICAgIGRyYWZ0RW50cnkgPSBudWxsO1xuICAgICAgICAgIH1cbiAgICAgICAgICBhd2FpdCBwbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgcmVuZGVyKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHJlbW92ZUJ0biA9IHJvdy5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC1vcmRlci1yZW1vdmUgY2xpY2thYmxlLWljb25cIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJFbnRmZXJuZW5cIiB9IH0pO1xuICAgICAgICBzZXRJY29uKHJlbW92ZUJ0biwgXCJ4XCIpO1xuICAgICAgICByZW1vdmVCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBpZiAoaXNEcmFmdCkge1xuICAgICAgICAgICAgZHJhZnRFbnRyeSA9IG51bGw7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIG9yZGVyKCkuc3BsaWNlKG9yZGVyKCkuaW5kZXhPZihlbnRyeSksIDEpO1xuICAgICAgICAgICAgYXdhaXQgcGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZW5kZXIoKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIC8vIERlciBFbnR3dXJmIGhhdCBub2NoIGtlaW5lbiBQbGF0eiBpbiBkZXIgZWNodGVuIExpc3RlIC0gVmVyc2NoaWViZW5cbiAgICAgIC8vIGVyZ2lidCBmXHUwMEZDciBpaG4ga2VpbmVuIFNpbm4sIGJldm9yIGVyIFx1MDBGQ2JlcmhhdXB0IGVpbmVuIE5hbWVuIGhhdC5cbiAgICAgIGlmIChpc0RyYWZ0KSByZXR1cm47XG5cbiAgICAgIHJvdy5kcmFnZ2FibGUgPSB0cnVlO1xuICAgICAgcm93LmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnc3RhcnRcIiwgKGV2ZW50KSA9PiB7XG4gICAgICAgIGV2ZW50LmRhdGFUcmFuc2Zlci5lZmZlY3RBbGxvd2VkID0gXCJtb3ZlXCI7XG4gICAgICAgIGV2ZW50LmRhdGFUcmFuc2Zlci5zZXREYXRhKFwidGV4dC9wbGFpblwiLCBTdHJpbmcoaW5kZXgpKTtcbiAgICAgICAgcm93LmNsYXNzTGlzdC5hZGQoXCJpcy1kcmFnZ2luZ1wiKTtcbiAgICAgIH0pO1xuICAgICAgcm93LmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnZW5kXCIsICgpID0+IHJvdy5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJhZ2dpbmdcIikpO1xuICAgICAgcm93LmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnb3ZlclwiLCAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgLy8gT2JlcmUgb2RlciB1bnRlcmUgSFx1MDBFNGxmdGUgZGVyIFplaWxlIGVudHNjaGVpZGV0LCBvYiBkaWUgZ2V6b2dlbmVcbiAgICAgICAgLy8gWmVpbGUgZGF2b3Igb2RlciBkYWhpbnRlciBsYW5kZXQgLSBzb25zdCBsaWVcdTAwREZlIHNpY2ggbmllIFwibmFjaCBnYW56XG4gICAgICAgIC8vIHVudGVuXCIgYWJsZWdlbiAoQWJsZWdlbiBhdWYgZGVyIGxldHp0ZW4gWmVpbGUgaFx1MDBFNHR0ZSBpbW1lciBudXIgdm9yXG4gICAgICAgIC8vIGlociBlaW5nZWZcdTAwRkNndCkuXG4gICAgICAgIGNvbnN0IHJlY3QgPSByb3cuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICAgIGNvbnN0IGlzQWZ0ZXIgPSBldmVudC5jbGllbnRZIC0gcmVjdC50b3AgPiByZWN0LmhlaWdodCAvIDI7XG4gICAgICAgIHJvdy5jbGFzc0xpc3QudG9nZ2xlKFwiaXMtZHJvcC1iZWZvcmVcIiwgIWlzQWZ0ZXIpO1xuICAgICAgICByb3cuY2xhc3NMaXN0LnRvZ2dsZShcImlzLWRyb3AtYWZ0ZXJcIiwgaXNBZnRlcik7XG4gICAgICB9KTtcbiAgICAgIHJvdy5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ2xlYXZlXCIsICgpID0+IHJvdy5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJvcC1iZWZvcmVcIiwgXCJpcy1kcm9wLWFmdGVyXCIpKTtcbiAgICAgIHJvdy5hZGRFdmVudExpc3RlbmVyKFwiZHJvcFwiLCBhc3luYyAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgY29uc3QgaXNBZnRlciA9IHJvdy5jbGFzc0xpc3QuY29udGFpbnMoXCJpcy1kcm9wLWFmdGVyXCIpO1xuICAgICAgICByb3cuY2xhc3NMaXN0LnJlbW92ZShcImlzLWRyb3AtYmVmb3JlXCIsIFwiaXMtZHJvcC1hZnRlclwiKTtcblxuICAgICAgICBjb25zdCBmcm9tSW5kZXggPSBOdW1iZXIoZXZlbnQuZGF0YVRyYW5zZmVyLmdldERhdGEoXCJ0ZXh0L3BsYWluXCIpKTtcbiAgICAgICAgaWYgKE51bWJlci5pc05hTihmcm9tSW5kZXgpKSByZXR1cm47XG5cbiAgICAgICAgLy8gWmllbHBvc2l0aW9uIGltIEFycmF5IFZPUiBkZW0gRW50ZmVybmVuIHZvbiBmcm9tSW5kZXggZ2VkYWNodCAtXG4gICAgICAgIC8vIFwibmFjaCBkaWVzZXIgWmVpbGVcIiBoZWlcdTAwREZ0OiBkaXJla3Qgdm9yIGRlciBqZXdlaWxzIG5cdTAwRTRjaHN0ZW4uXG4gICAgICAgIGxldCBpbnNlcnRCZWZvcmUgPSBpc0FmdGVyID8gaW5kZXggKyAxIDogaW5kZXg7XG4gICAgICAgIGlmIChmcm9tSW5kZXggPCBpbnNlcnRCZWZvcmUpIGluc2VydEJlZm9yZSAtPSAxO1xuXG4gICAgICAgIGNvbnN0IFttb3ZlZF0gPSBvcmRlcigpLnNwbGljZShmcm9tSW5kZXgsIDEpO1xuICAgICAgICBvcmRlcigpLnNwbGljZShpbnNlcnRCZWZvcmUsIDAsIG1vdmVkKTtcbiAgICAgICAgYXdhaXQgcGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICByZW5kZXIoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9O1xuXG4gIGFkZEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgIGlmICghZHJhZnRFbnRyeSkge1xuICAgICAgZHJhZnRFbnRyeSA9IHsga2luZDogXCJwcm9wZXJ0eVwiLCBuYW1lOiBcIlwiIH07XG4gICAgICByZW5kZXIoKTtcbiAgICB9XG4gICAgY29uc3QgaW5wdXRzID0gbGlzdEVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIuZnJlZC1vcmRlci1uYW1lLWlucHV0XCIpO1xuICAgIGlucHV0c1tpbnB1dHMubGVuZ3RoIC0gMV0/LmZvY3VzKCk7XG4gIH0pO1xuXG4gIHJlbmRlcigpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgbW91bnRHbG9iYWxPcmRlckVkaXRvciB9O1xuIiwgImNvbnN0IHsgZ2V0U3VidHlwZSB9ID0gcmVxdWlyZShcIi4vc3VidHlwZXNcIik7XHJcblxyXG4vLyBGYXJiZSBlaW5lcyBUWVBzIG9obmUgZWlnZW5lIEZhcmJlIC0gaGllciBzdGF0dCBpbiB0eXAtdmlldy5qcywgd2VpbCBzaWVcclxuLy8gdW50ZXJoYWxiIGRlciBWaWV3IGdlYnJhdWNodCB3aXJkIChzaWVoZSBuYW1lQ29sb3IpOyB0eXAtdmlldy5qcyByZWljaHQgc2llXHJcbi8vIHVudmVyXHUwMEU0bmRlcnQgd2VpdGVyLCBkYW1pdCBiZXN0ZWhlbmRlIEltcG9ydGUgZG9ydCBnXHUwMEZDbHRpZyBibGVpYmVuLlxyXG5jb25zdCBERUZBVUxUX1RZUEVfQ09MT1IgPSBcIiM4ODg4ODhcIjtcclxuXHJcbi8vIC0tLSBTdWJ0eXAtRmFyYmVuIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuLy8gRWluIFN1YnR5cCBzcGVpY2hlcnQga2VpbmUgZWlnZW5lIEZhcmJlLCBzb25kZXJuIG51ciBlaW5lIEFid2VpY2h1bmcgdm9uIGRlclxyXG4vLyBGYXJiZSBzZWluZXMgVFlQcyAoc2V0dGluZ3MudHlwZVN1YnR5cGVzW1RZUF1bU1VCVFlQXS5jb2xvciA9IHsgaCwgbCB9OyBpblxyXG4vLyBCZXN0YW5kc2RhdGVuIHN0ZWh0IGRvcnQgbm9jaCBlaW4gd2lya3VuZ3Nsb3NlcyBzLCBzaWVoZVxyXG4vLyBTVUJUWVBFX0NPTE9SX0NIQU5ORUxTKS5cclxuLy8gRGllIHRhdHNcdTAwRTRjaGxpY2hlIEZhcmJlIHdpcmQgamVkZXMgTWFsIGF1cyBkZXIgYWt0dWVsbGVuIFRZUC1GYXJiZSBiZXJlY2huZXRcclxuLy8gLSBcdTAwRTRuZGVydCBzaWNoIGRpZSwgemllaGVuIGFsbGUgU3VidHlwZW4gbWl0IHVuZCBibGVpYmVuIGluIGRlciBGYXJiZmFtaWxpZS5cclxuLy8gR2VyZWNobmV0IHdpcmQgaW4gT0tMQ0ggc3RhdHQgSFNMOiBkb3J0IHdpcmt0IGVpbmUgSGVsbGlna2VpdHNcdTAwRTRuZGVydW5nIFx1MDBGQ2JlclxyXG4vLyBhbGxlIEZhcmJ0XHUwMEY2bmUgXHUwMEU0aG5saWNoIHN0YXJrIChpbiBIU0wgd1x1MDBFNHJlIHouIEIuIEdlbGIgYmVpIGdsZWljaGVtIFdlcnQgdmllbFxyXG4vLyBoZWxsZXIgYWxzIEJsYXUpLiBPaG5lIGVpZ2VuZSBFaW5zdGVsbHVuZyBoYXQgZWluIFN1YnR5cCBkaWUgVFlQLUZhcmJlLlxyXG4vLyAgIGg6IEZhcmJ0b24sIHZlcnNjaG9iZW4gdW0gR3JhZDtcclxuLy8gICBsOiBIZWxsaWdrZWl0IGluICUgZGVzIFdlZ3MgenUgV2VpXHUwMERGICgrKSBiencuIFNjaHdhcnogKC0pLlxyXG4vLyBXYXJ1bSBiZWlkZSByZWxhdGl2IHJlY2huZW4gdW5kIGRpZSBTXHUwMEU0dHRpZ3VuZyBkYWJlaSB2b24gYWxsZWluIG1pdHppZWh0LFxyXG4vLyBzdGVodCBhdXNmXHUwMEZDaHJsaWNoIGFuIGFwcGx5Q29sb3JPZmZzZXQuXHJcbi8vIFdpZSB3ZWl0IGVpbiBTdWJ0eXAgamV3ZWlscyBhYndlaWNoZW4gZGFyZiAoXHUwMEIxKSwgaXN0IGVpbnN0ZWxsYmFyXHJcbi8vIChzZXR0aW5ncy5zdWJ0eXBlQ29sb3JSYW5nZXMsIHNpZWhlIHNldHRpbmdzLmpzKSAtIGVpbmUgc2Nob24gZWluZ2VzdGVsbHRlXHJcbi8vIEFid2VpY2h1bmcgd2lyZCBiZWltIFZlcmtsZWluZXJuIGRlciBHcmVuemUgZGFyYXVmIGdla2FwcHQuXHJcbi8vIERpZXNlIExpc3RlIGlzdCBkaWUgZWluemlnZSBRdWVsbGU6IGF1cyBpaHIgYmF1ZW4gc2ljaCBkaWUgUmVnbGVyIGltXHJcbi8vIFBvcG92ZXIsIGRpZSBHcmVuemVuIGluIGRlbiBFaW5zdGVsbHVuZ2VuIHVuZCBkaWUgS2FwcHVuZy4gRWluIGhpZXJcclxuLy8gYXVza29tbWVudGllcnRlciBLYW5hbCB2ZXJzY2h3aW5kZXQgXHUwMEZDYmVyYWxsIHVuZCB3aXJkIG5pY2h0IG1laHIgZ2VzcGVpY2hlcnQuXHJcbi8vXHJcbi8vIERpZSBTXHUwMEU0dHRpZ3VuZyBpc3Qgc3RpbGxnZWxlZ3QuIFNpZSB3YXIgdXJzcHJcdTAwRkNuZ2xpY2ggblx1MDBGNnRpZywgdW0gYXVzenVnbGVpY2hlbixcclxuLy8gd2FzIEhlbGxpZ2tlaXQgdW5kIEZhcmJ0b24gZGVyIEZhcmJlIGFuIFNcdTAwRTR0dGlndW5nIHdlZ25haG1lbiAtIHNlaXQgYmVpZGVcclxuLy8gUmVnbGVyIGRpZSBTXHUwMEU0dHRpZ3VuZyB2b24gYWxsZWluIG1pdGZcdTAwRkNocmVuIChzaWVoZSBjb21wdXRlQ29sb3JPZmZzZXQpIGJsaWViXHJcbi8vIGlociBudXIgbm9jaCBkaWUgQXVzc2FnZSBcImRpZXNlciBTdWJ0eXAgbmltbXQgc2ljaCB6dXJcdTAwRkNja1wiLCB1bmQgZGFmXHUwMEZDciBsb2hudFxyXG4vLyBlaW4gZHJpdHRlciBSZWdsZXIgbmljaHQuIFp1bSBXaWVkZXJiZWxlYmVuOiBoaWVyLCBpblxyXG4vLyBERUZBVUxUX1NVQlRZUEVfQ09MT1JfUkFOR0VTLCBpbSBSZWNoZW53ZWcgdm9uIGNvbXB1dGVDb2xvck9mZnNldCB1bmQgYmVpXHJcbi8vIHJhbmdlTWF4L3JhbmdlRGVzYyBpbiBzZXR0aW5ncy5qcyBqZXdlaWxzIGRpZSBBdXNrb21tZW50aWVydW5nIGF1ZmhlYmVuLlxyXG4vLyBkb3duT25seTogZGVyIFJlZ2xlciByZWljaHQgbnVyIHZvbiAtR3JlbnplIGJpcyAwLiBFaW4gU3VidHlwIHNvbGwgc2ljaFxyXG4vLyB6dXJcdTAwRkNja25laG1lbiBkXHUwMEZDcmZlbiwgYWJlciBuaWNodCBrclx1MDBFNGZ0aWdlciBhdWZ0cmV0ZW4gYWxzIHNlaW4gVFlQIC0gYnVudGVyXHJcbi8vIGFscyBkaWUgSGF1cHRmYXJiZSB6aWVodCBkaWUgQXVmbWVya3NhbWtlaXQgZ2VuYXUgZmFsc2NoIGhlcnVtLlxyXG5jb25zdCBTVUJUWVBFX0NPTE9SX0NIQU5ORUxTID0gW1xyXG4gIHsga2V5OiBcImhcIiwgbGFiZWw6IFwiRmFyYnRvblwiLCB1bml0OiBcIlx1MDBCMFwiIH0sXHJcbiAgLy8geyBrZXk6IFwic1wiLCBsYWJlbDogXCJTXHUwMEU0dHRpZ3VuZ1wiLCB1bml0OiBcIiVcIiwgZG93bk9ubHk6IHRydWUgfSxcclxuICB7IGtleTogXCJsXCIsIGxhYmVsOiBcIkhlbGxpZ2tlaXRcIiwgdW5pdDogXCIlXCIgfSxcclxuXTtcclxuLy8gU3VidHlwZW4gc29sbGVuIHZvciBhbGxlbSB1bnRlcnNjaGVpZGJhciBzZWluOiBGYXJidG9uIHRyXHUwMEU0Z3QgZGF6dSBhbVxyXG4vLyBtZWlzdGVuIGJlaSB1bmQgYmVrb21tdCBkZW4gZ3JcdTAwRjZcdTAwREZ0ZW4gU3BpZWxyYXVtLCBIZWxsaWdrZWl0IGFscyB6d2VpdGUga2xhclxyXG4vLyBlcmtlbm5iYXJlIEFjaHNlIGViZW5mYWxscyByZWljaGxpY2guXHJcbmNvbnN0IERFRkFVTFRfU1VCVFlQRV9DT0xPUl9SQU5HRVMgPSB7IGg6IDM1LCAvKiBzOiA0MCwgKi8gbDogNDAgfTtcclxuXHJcbmZ1bmN0aW9uIGNvbG9yUmFuZ2Uoc2V0dGluZ3MsIGtleSkge1xyXG4gIGNvbnN0IHZhbHVlID0gTnVtYmVyKHNldHRpbmdzLnN1YnR5cGVDb2xvclJhbmdlcz8uW2tleV0pO1xyXG4gIHJldHVybiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpICYmIHZhbHVlID49IDAgPyB2YWx1ZSA6IERFRkFVTFRfU1VCVFlQRV9DT0xPUl9SQU5HRVNba2V5XTtcclxufVxyXG5cclxuLy8gVm9uIHdvIGJpcyB3byBlaW4gUmVnbGVyIHJlaWNodCAtIGVpbmUgU3RlbGxlIGZcdTAwRkNyIFBvcG92ZXIsIEthcHB1bmcgdW5kXHJcbi8vIFZlcmxhdWZzdm9yc2NoYXUsIGRhbWl0IGRpZSBkcmVpIG5pY2h0IGF1c2VpbmFuZGVybGF1ZmVuLlxyXG5mdW5jdGlvbiBjaGFubmVsQm91bmRzKHNldHRpbmdzLCBrZXkpIHtcclxuICBjb25zdCByYW5nZSA9IGNvbG9yUmFuZ2Uoc2V0dGluZ3MsIGtleSk7XHJcbiAgcmV0dXJuIFNVQlRZUEVfQ09MT1JfQ0hBTk5FTFMuZmluZCgoY2hhbm5lbCkgPT4gY2hhbm5lbC5rZXkgPT09IGtleSk/LmRvd25Pbmx5ID8gWy1yYW5nZSwgMF0gOiBbLXJhbmdlLCByYW5nZV07XHJcbn1cclxuXHJcbi8vIEFid2VpY2h1bmcgZWluZXMgU3VidHlwcywgYXVmIGRpZSBlaW5nZXN0ZWxsdGVuIEdyZW56ZW4gZ2VrYXBwdC5cclxuZnVuY3Rpb24gY2xhbXBlZE9mZnNldChzZXR0aW5ncywgb2Zmc2V0KSB7XHJcbiAgaWYgKCFvZmZzZXQpIHJldHVybiBudWxsO1xyXG4gIGNvbnN0IHJlc3VsdCA9IHt9O1xyXG4gIGZvciAoY29uc3QgeyBrZXkgfSBvZiBTVUJUWVBFX0NPTE9SX0NIQU5ORUxTKSB7XHJcbiAgICBjb25zdCBbbWluLCBtYXhdID0gY2hhbm5lbEJvdW5kcyhzZXR0aW5ncywga2V5KTtcclxuICAgIHJlc3VsdFtrZXldID0gTWF0aC5taW4obWF4LCBNYXRoLm1heChtaW4sIE51bWJlcihvZmZzZXRba2V5XSkgfHwgMCkpO1xyXG4gIH1cclxuICByZXR1cm4gcmVzdWx0O1xyXG59XHJcblxyXG5jb25zdCB0b0xpbmVhciA9IChjKSA9PiAoYyA8PSAwLjA0MDQ1ID8gYyAvIDEyLjkyIDogKChjICsgMC4wNTUpIC8gMS4wNTUpICoqIDIuNCk7XHJcbmNvbnN0IHRvR2FtbWEgPSAoYykgPT4gKGMgPD0gMC4wMDMxMzA4ID8gMTIuOTIgKiBjIDogMS4wNTUgKiBjICoqICgxIC8gMi40KSAtIDAuMDU1KTtcclxuXHJcbmZ1bmN0aW9uIGhleFRvT2tsY2goaGV4KSB7XHJcbiAgY29uc3QgbWF0Y2ggPSAvXiM/KFswLTlhLWZdezZ9KSQvaS5leGVjKGhleCA/PyBcIlwiKTtcclxuICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbDtcclxuICBjb25zdCBpbnQgPSBwYXJzZUludChtYXRjaFsxXSwgMTYpO1xyXG4gIGNvbnN0IFtyLCBnLCBiXSA9IFsoaW50ID4+IDE2KSAmIDI1NSwgKGludCA+PiA4KSAmIDI1NSwgaW50ICYgMjU1XS5tYXAoKGMpID0+IHRvTGluZWFyKGMgLyAyNTUpKTtcclxuICBjb25zdCBsID0gTWF0aC5jYnJ0KDAuNDEyMjIxNDcwOCAqIHIgKyAwLjUzNjMzMjUzNjMgKiBnICsgMC4wNTE0NDU5OTI5ICogYik7XHJcbiAgY29uc3QgbSA9IE1hdGguY2JydCgwLjIxMTkwMzQ5ODIgKiByICsgMC42ODA2OTk1NDUxICogZyArIDAuMTA3Mzk2OTU2NiAqIGIpO1xyXG4gIGNvbnN0IHMgPSBNYXRoLmNicnQoMC4wODgzMDI0NjE5ICogciArIDAuMjgxNzE4ODM3NiAqIGcgKyAwLjYyOTk3ODcwMDUgKiBiKTtcclxuICBjb25zdCBMID0gMC4yMTA0NTQyNTUzICogbCArIDAuNzkzNjE3Nzg1ICogbSAtIDAuMDA0MDcyMDQ2OCAqIHM7XHJcbiAgY29uc3QgQSA9IDEuOTc3OTk4NDk1MSAqIGwgLSAyLjQyODU5MjIwNSAqIG0gKyAwLjQ1MDU5MzcwOTkgKiBzO1xyXG4gIGNvbnN0IEIgPSAwLjAyNTkwNDAzNzEgKiBsICsgMC43ODI3NzE3NjYyICogbSAtIDAuODA4Njc1NzY2ICogcztcclxuICByZXR1cm4geyBMLCBDOiBNYXRoLmh5cG90KEEsIEIpLCBIOiAoKE1hdGguYXRhbjIoQiwgQSkgKiAxODApIC8gTWF0aC5QSSArIDM2MCkgJSAzNjAgfTtcclxufVxyXG5cclxuLy8gTGluZWFyZXMgc1JHQiwgS2FuXHUwMEU0bGUgZ2dmLiBhdVx1MDBERmVyaGFsYiB2b24gMC4uMSAoYXVcdTAwREZlcmhhbGIgZGVzIEZhcmJyYXVtcykuXHJcbmZ1bmN0aW9uIG9rbGNoVG9MaW5lYXIoeyBMLCBDLCBIIH0pIHtcclxuICBjb25zdCBBID0gQyAqIE1hdGguY29zKChIICogTWF0aC5QSSkgLyAxODApO1xyXG4gIGNvbnN0IEIgPSBDICogTWF0aC5zaW4oKEggKiBNYXRoLlBJKSAvIDE4MCk7XHJcbiAgY29uc3QgbCA9IChMICsgMC4zOTYzMzc3Nzc0ICogQSArIDAuMjE1ODAzNzU3MyAqIEIpICoqIDM7XHJcbiAgY29uc3QgbSA9IChMIC0gMC4xMDU1NjEzNDU4ICogQSAtIDAuMDYzODU0MTcyOCAqIEIpICoqIDM7XHJcbiAgY29uc3QgcyA9IChMIC0gMC4wODk0ODQxNzc1ICogQSAtIDEuMjkxNDg1NTQ4ICogQikgKiogMztcclxuICByZXR1cm4gW1xyXG4gICAgNC4wNzY3NDE2NjIxICogbCAtIDMuMzA3NzExNTkxMyAqIG0gKyAwLjIzMDk2OTkyOTIgKiBzLFxyXG4gICAgLTEuMjY4NDM4MDA0NiAqIGwgKyAyLjYwOTc1NzQwMTEgKiBtIC0gMC4zNDEzMTkzOTY1ICogcyxcclxuICAgIC0wLjAwNDE5NjA4NjMgKiBsIC0gMC43MDM0MTg2MTQ3ICogbSArIDEuNzA3NjE0NzAxICogcyxcclxuICBdO1xyXG59XHJcblxyXG5jb25zdCBpbkdhbXV0ID0gKHJnYikgPT4gcmdiLmV2ZXJ5KChjKSA9PiBjID49IC0wLjAwMDEgJiYgYyA8PSAxLjAwMDEpO1xyXG5cclxuLy8gR3JcdTAwRjZcdTAwREZ0ZXMgYmVpIGRpZXNlciBIZWxsaWdrZWl0IHVuZCBkaWVzZW0gRmFyYnRvbiBpbiBzUkdCIG5vY2ggZGFyc3RlbGxiYXJlc1xyXG4vLyBDaHJvbWEuIERpZXNlIEdyZW56ZSBzY2h3YW5rdCBzdGFyayAtIHJlaW5lcyBHZWxiIHZlcnRyXHUwMEU0Z3QgbnVyIGtuYXBwIHVudGVyXHJcbi8vIFdlaVx1MDBERiB2aWVsIENocm9tYSwgQmxhdSBhbSBtZWlzdGVuIGluIGRlciBNaXR0ZSAtLCB1bmQgZ2VuYXUgYW4gaWhyIHNjaGVpdGVydFxyXG4vLyBqZWRlIFJlY2hudW5nLCBkaWUgQ2hyb21hIGFic29sdXQgZmVzdGhcdTAwRTRsdCAoc2llaGUgYXBwbHlDb2xvck9mZnNldCkuXHJcbmZ1bmN0aW9uIG1heENocm9tYShMLCBIKSB7XHJcbiAgbGV0IGxvdyA9IDA7XHJcbiAgbGV0IGhpZ2ggPSAwLjQ7IC8vIFx1MDBGQ2JlciBkZW0gc1JHQi1NYXhpbXVtICh+MCwzMilcclxuICBmb3IgKGxldCBpID0gMDsgaSA8IDIwOyBpKyspIHtcclxuICAgIGNvbnN0IG1pZCA9IChsb3cgKyBoaWdoKSAvIDI7XHJcbiAgICBpZiAoaW5HYW11dChva2xjaFRvTGluZWFyKHsgTCwgQzogbWlkLCBIIH0pKSkgbG93ID0gbWlkO1xyXG4gICAgZWxzZSBoaWdoID0gbWlkO1xyXG4gIH1cclxuICByZXR1cm4gbG93O1xyXG59XHJcblxyXG4vLyBMaWVndCBkaWUgRmFyYmUgYXVcdTAwREZlcmhhbGIgdm9uIHNSR0IsIHdpcmQgZGllIFNcdTAwRTR0dGlndW5nIChDaHJvbWEpIHNvIHdlaXRcclxuLy8gdmVycmluZ2VydCwgYmlzIHNpZSBkYXJzdGVsbGJhciBpc3QgLSBGYXJidG9uIHVuZCBIZWxsaWdrZWl0IGJsZWliZW4uIEZcdTAwRkNyXHJcbi8vIGFwcGx5Q29sb3JPZmZzZXQgaXN0IGRhcyBudXIgbm9jaCBlaW4gU2ljaGVyaGVpdHNuZXR6OiBkb3J0IHN0ZWh0IGRhc1xyXG4vLyBDaHJvbWEgb2huZWhpbiBzY2hvbiBhbHMgQW50ZWlsIGRlcyBkYXJzdGVsbGJhcmVuIE1heGltdW1zIGZlc3QuXHJcbmZ1bmN0aW9uIG9rbGNoVG9IZXgoY29sb3IpIHtcclxuICBsZXQgcmdiID0gb2tsY2hUb0xpbmVhcihjb2xvcik7XHJcbiAgaWYgKCFpbkdhbXV0KHJnYikpIHJnYiA9IG9rbGNoVG9MaW5lYXIoeyAuLi5jb2xvciwgQzogbWF4Q2hyb21hKGNvbG9yLkwsIGNvbG9yLkgpIH0pO1xyXG4gIHJldHVybiAoXHJcbiAgICBcIiNcIiArXHJcbiAgICByZ2JcclxuICAgICAgLm1hcCgoYykgPT4gTWF0aC5yb3VuZChNYXRoLm1pbigxLCBNYXRoLm1heCgwLCB0b0dhbW1hKE1hdGgubWluKDEsIE1hdGgubWF4KDAsIGMpKSkpKSAqIDI1NSkpXHJcbiAgICAgIC5tYXAoKGMpID0+IGMudG9TdHJpbmcoMTYpLnBhZFN0YXJ0KDIsIFwiMFwiKSlcclxuICAgICAgLmpvaW4oXCJcIilcclxuICApO1xyXG59XHJcblxyXG4vLyBIZWxsaWdrZWl0IGRlcyBTY2hlaXRlbHMgZWluZXMgRmFyYnRvbnM6IGRvcnQgdHJcdTAwRTRndCBlciBkYXMgbWVpc3RlIENocm9tYS5cclxuLy8gbWF4Q2hyb21hIHN0ZWlndCBcdTAwRkNiZXIgZGllIEhlbGxpZ2tlaXQgYmlzIGRvcnRoaW4gdW5kIGZcdTAwRTRsbHQgZGFuYWNoIHdpZWRlciwgc29cclxuLy8gZGFzcyBkaWUgU3BpdHplIHNpY2ggZWlua3JlaXNlbiBsXHUwMEU0c3N0LiBKZSBGYXJidG9uIGVpbiBmZXN0ZXIgV2VydCwgdW5kIGRpZVxyXG4vLyBTdWNoZSBpc3QgdGV1ZXIgLSBkYXJ1bSBuYWNoIGdhbnplbiBHcmFkIGdlbWVya3QuXHJcbmNvbnN0IGN1c3BDYWNoZSA9IG5ldyBNYXAoKTtcclxuXHJcbi8vIEFiIGhpZXIgZ2lsdCBlaW5lIEZhcmJlIGFscyBidW50LiBFaW4gcmVpbmVzIEdyYXUga29tbXQgYXVzIGhleFRvT2tsY2ggbmljaHRcclxuLy8gbWl0IENocm9tYSAwIHp1clx1MDBGQ2NrLCBzb25kZXJuIG1pdCBydW5kIDJlLTggdW5kIGVpbmVtIGJlbGllYmlnZW4gRmFyYnRvbiAtXHJcbi8vIGRpZSBNYXRyaXhrb25zdGFudGVuIHNpbmQgZ2VydW5kZXQuIEF1ZiBcImdyXHUwMEY2XHUwMERGZXIgYWxzIDBcIiB6dSBwclx1MDBGQ2ZlbiBmXHUwMEZDaHJ0ZSBkaWVcclxuLy8gSGVsbGlna2VpdCBlaW5lcyBHcmF1cyBhbHNvIGRlbSBTY2hlaXRlbCBlaW5lcyBGYXJidG9ucyBuYWNoLCBkZW4gZXMgZ2FyXHJcbi8vIG5pY2h0IGhhdC4gRGllIFNjaHdlbGxlIGxpZWd0IHdlaXQgdW50ZXIgYWxsZW0sIHdhcyBpbiA4IEJpdCBzaWNodGJhciB3XHUwMEU0cmVcclxuLy8gKGVpbiBTY2hyaXR0IHZvbiAxLzI1NSBpbiBlaW5lbSBLYW5hbCBlcmdpYnQgcnVuZCAwLDAwMikuXHJcbmNvbnN0IE5FVVRSQUxfQ0hST01BID0gMWUtNDtcclxuXHJcbmZ1bmN0aW9uIGN1c3BMaWdodG5lc3MoSCkge1xyXG4gIGNvbnN0IGtleSA9IE1hdGgucm91bmQoSCkgJSAzNjA7XHJcbiAgY29uc3QgY2FjaGVkID0gY3VzcENhY2hlLmdldChrZXkpO1xyXG4gIGlmIChjYWNoZWQgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGNhY2hlZDtcclxuICBsZXQgbG93ID0gMDtcclxuICBsZXQgaGlnaCA9IDE7XHJcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCAyNDsgaSsrKSB7XHJcbiAgICBjb25zdCB0aGlyZCA9IChoaWdoIC0gbG93KSAvIDM7XHJcbiAgICBpZiAobWF4Q2hyb21hKGxvdyArIHRoaXJkLCBrZXkpIDwgbWF4Q2hyb21hKGhpZ2ggLSB0aGlyZCwga2V5KSkgbG93ICs9IHRoaXJkO1xyXG4gICAgZWxzZSBoaWdoIC09IHRoaXJkO1xyXG4gIH1cclxuICBjb25zdCByZXN1bHQgPSAobG93ICsgaGlnaCkgLyAyO1xyXG4gIGN1c3BDYWNoZS5zZXQoa2V5LCByZXN1bHQpO1xyXG4gIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbi8vIERpZXNlbGJlIEhlbGxpZ2tlaXQsIGFiZXIgZ2VtZXNzZW4gYW0gU2NoZWl0ZWwgZGVzIFppZWxmYXJidG9ucyBzdGF0dCBhbVxyXG4vLyBlaWdlbmVuOiBkZXIgU2NoZWl0ZWwgZ2VodCBhdWYgZGVuIFNjaGVpdGVsLCBTY2h3YXJ6IGF1ZiBTY2h3YXJ6IHVuZCBXZWlcdTAwREZcclxuLy8gYXVmIFdlaVx1MDBERiwgZGF6d2lzY2hlbiBsaW5lYXIuIE9obmUgRmFyYnRvbmRyZWh1bmcga29tbXQgZGllIEhlbGxpZ2tlaXRcclxuLy8gdW52ZXJcdTAwRTRuZGVydCB6dXJcdTAwRkNjay5cclxuZnVuY3Rpb24gcmVtYXBUb0N1c3AoTCwgZnJvbUgsIHRvSCkge1xyXG4gIGNvbnN0IGZyb20gPSBjdXNwTGlnaHRuZXNzKGZyb21IKTtcclxuICBjb25zdCB0byA9IGN1c3BMaWdodG5lc3ModG9IKTtcclxuICBpZiAoTCA8PSBmcm9tKSByZXR1cm4gZnJvbSA+IDAgPyAoTCAvIGZyb20pICogdG8gOiB0bztcclxuICByZXR1cm4gZnJvbSA8IDEgPyB0byArICgoTCAtIGZyb20pIC8gKDEgLSBmcm9tKSkgKiAoMSAtIHRvKSA6IHRvO1xyXG59XHJcblxyXG4vLyBEaWUgYmVpZGVuIFN1Y2hlbiBuYWNoIGRlciBHYW11dC1HcmVuemUga29zdGVuIGplIEZhcmJlIHJ1bmQgMTAgXHUwMEI1cyAtIHp1XHJcbi8vIHZpZWwsIHdlbm4gZGVyIERhdGVpYmF1bSBvZGVyIGRlciBHcmFwaCBzaWUgZlx1MDBGQ3IgamVkZSBEYXRlaSBlcm5ldXQgYW5zdFx1MDBGNlx1MDBERnRcclxuLy8gKHNpZWhlIGNvbG9yRm9yRmlsZSkuIFZlcnNjaGllZGVuZSBGYXJiZW4gZ2lidCBlcyBkYWJlaSBudXIgZWluZSBIYW5kdm9sbCxcclxuLy8gZWluZSBqZSBUWVAvU1VCVFlQLCBhbHNvIGdlblx1MDBGQ2d0IGVpbiBad2lzY2hlbnNwZWljaGVyOyBiZWltIFppZWhlbiBlaW5lc1xyXG4vLyBSZWdsZXJzIHdcdTAwRTRjaHN0IGVyIHVtIGplZGUgWndpc2NoZW5zdGVsbHVuZyB1bmQgd2lyZCBkYXJ1bSBhYiB1bmQgenUgZ2VsZWVydC5cclxuY29uc3Qgb2Zmc2V0Q2FjaGUgPSBuZXcgTWFwKCk7XHJcblxyXG5mdW5jdGlvbiBhcHBseUNvbG9yT2Zmc2V0KGhleCwgb2Zmc2V0KSB7XHJcbiAgaWYgKCFvZmZzZXQpIHJldHVybiBoZXg7XHJcbiAgY29uc3QgY2FjaGVLZXkgPSBoZXggKyBcInxcIiArIChvZmZzZXQuaCA/PyAwKSArIFwifFwiICsgKG9mZnNldC5sID8/IDApO1xyXG4gIGNvbnN0IGNhY2hlZCA9IG9mZnNldENhY2hlLmdldChjYWNoZUtleSk7XHJcbiAgaWYgKGNhY2hlZCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gY2FjaGVkO1xyXG4gIGNvbnN0IHJlc3VsdCA9IGNvbXB1dGVDb2xvck9mZnNldChoZXgsIG9mZnNldCk7XHJcbiAgaWYgKG9mZnNldENhY2hlLnNpemUgPiA1MDApIG9mZnNldENhY2hlLmNsZWFyKCk7XHJcbiAgb2Zmc2V0Q2FjaGUuc2V0KGNhY2hlS2V5LCByZXN1bHQpO1xyXG4gIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbi8vIEJlaWRlIFJlZ2xlciB3aXJrZW4gcmVsYXRpdiB6dXIgVFlQLUZhcmJlLCBkYW1pdCBkZXIgU3VidHlwIGluIGRlclxyXG4vLyBGYW1pbGllIGJsZWlidC4gQWJzb2x1dGUgV2VydGUgaGFsdGVuIG5pY2h0LCB3YXMgc2llIHZlcnNwcmVjaGVuLCBkZW5uIHdpZVxyXG4vLyB2aWVsIEZhcmJlIHNSR0IgXHUwMEZDYmVyaGF1cHQgaGVyZ2lidCwgaFx1MDBFNG5ndCB2b24gSGVsbGlna2VpdCBVTkQgRmFyYnRvbiBhYjpcclxuLy8gICBsOiBBbnRlaWwgZGVzIFdlZ3MgenUgV2VpXHUwMERGICgrKSBiencuIFNjaHdhcnogKC0pLiBBYnNvbHV0ZSBPS0xDSC1QdW5rdGVcclxuLy8gICAgICBsaWVmZW4gYmVpIGVpbmVyIG9obmVoaW4gaGVsbGVuIFRZUC1GYXJiZSBzY2hvbiBpbiBkZXIgZXJzdGVuXHJcbi8vICAgICAgUmVnbGVyaFx1MDBFNGxmdGUgYXVmIHJlaW5lcyBXZWlcdTAwREYsIHVuZCBkZXIgUmVzdCBkZXMgUmVnbGVycyB0YXQgbmljaHRzIG1laHIuXHJcbi8vICAgaDogR3JhZCAtIGFscyBlaW56aWdlciBhYnNvbHV0LCBBQkVSIGVyIGZcdTAwRkNocnQgZGllIEhlbGxpZ2tlaXQgbWl0IChzaWVoZVxyXG4vLyAgICAgIHJlbWFwVG9DdXNwKS4gSmVkZXIgRmFyYnRvbiB0clx1MDBFNGd0IHNlaW4gbWVpc3RlcyBDaHJvbWEgYXVmIGVpbmVyIGFuZGVyZW5cclxuLy8gICAgICBIZWxsaWdrZWl0OiBHZWxiIGVyc3QgYmVpIEwgMCw5MiwgT3JhbmdlIHNjaG9uIGJlaSAwLDc4LCBCbGF1IGJlaSAwLDQ5LlxyXG4vLyAgICAgIEVpbmUgaGVsbGUgZ2VsYmUgVFlQLUZhcmJlIGF1ZiBPcmFuZ2UgenUgZHJlaGVuIHVuZCBkYWJlaSBkaWVcclxuLy8gICAgICBIZWxsaWdrZWl0IGZlc3R6dWhhbHRlbiwgc2V0enQgc2llIHdlaXQgXHUwMEZDYmVyIGRlbiBTY2hlaXRlbCB2b24gT3JhbmdlIC1cclxuLy8gICAgICBkb3J0IHRyXHUwMEU0Z3QgZGVyIEZhcmJyYXVtIGZhc3Qga2VpbiBDaHJvbWEgbWVociwgdW5kIGhlcmF1cyBrb21tdCBlaW5cclxuLy8gICAgICBibGFzc2VzIFBhc3RlbGwsIGRhcyBuZWJlbiBzZWluZW0gVFlQIHdpZSBhdXNnZXdhc2NoZW4gdW5kIHZpZWwgenUgaGVsbFxyXG4vLyAgICAgIHdpcmt0IChyZWNobmVyaXNjaCBpc3QgZXMgZ2VuYXVzbyBoZWxsLCBhYmVyIGJsYXNzIGxpZXN0IHNpY2ggYWxzIGhlbGwpLlxyXG4vLyAgICAgIEZcdTAwRkNocnQgZGllIEhlbGxpZ2tlaXQgZGFnZWdlbiBkZW4gU2NoZWl0ZWwgbmFjaCwgYmxlaWJ0IGRpZSBGYXJia3JhZnRcclxuLy8gICAgICBcdTAwRkNiZXIgZGllIGdhbnplIERyZWh1bmcgcHJha3Rpc2NoIGdsZWljaC5cclxuLy8gRWluZW4gZWlnZW5lbiBSZWdsZXIgZlx1MDBGQ3IgZGllIFNcdTAwRTR0dGlndW5nIGdpYnQgZXMgbmFjaCBhbGwgZGVtIG5pY2h0IG1laHIgLSBzaWVcclxuLy8gemllaHQgYmVpIGJlaWRlbiBhbmRlcmVuIHZvbiBhbGxlaW4gbWl0IChzdGlsbGdlbGVndCwgc2llaGVcclxuLy8gU1VCVFlQRV9DT0xPUl9DSEFOTkVMUykuXHJcbi8vXHJcbi8vIFNpbmQgZGllIEhlbGxpZ2tlaXRlbiBzbyBhdWZlaW5hbmRlciBiZXpvZ2VuLCBpc3QgYXVjaCBkYXMgQ2hyb21hIHdpZWRlclxyXG4vLyBzY2hsaWNodCBlaW4gQW50ZWlsIGFuIGRlciBEZWNrZSAoYmFzZS5DIC8gbWF4Q2hyb21hIGFtIEF1c2dhbmdzcHVua3QsIGRhbm5cclxuLy8gbWFsIG1heENocm9tYSBhbSBaaWVsKTogZGllIERlY2tlbiB6d2VpZXIgRmFyYnRcdTAwRjZuZSBzaW5kIGVyc3QgZGFkdXJjaFxyXG4vLyBcdTAwRkNiZXJoYXVwdCB2ZXJnbGVpY2hiYXIuXHJcbi8vXHJcbi8vIFdBUyBESUVTRVIgQU5URUlMIElTVCBVTkQgV0FTIE5JQ0hULiBcIkFudGVpbCBhbiBkZXIgRGVja2VcIiBpc3QgZWluZVxyXG4vLyBFbnRzY2hlaWR1bmcgXHUwMEZDYmVyIHNSR0IsIGtlaW5lIFx1MDBGQ2JlciBXYWhybmVobXVuZyAtIGRhcyBzaWVodCBtYW4gZGVtIENvZGVcclxuLy8gbmljaHQgYW4sIHdlaWwgZXIgc29uc3QgZHVyY2h3ZWcgaW4gZWluZW0gd2Focm5laG11bmdzbmFoZW4gUmF1bSByZWNobmV0LlxyXG4vLyBtYXhDaHJvbWEgYmVzY2hyZWlidCBkaWUgSFx1MDBGQ2xsZSBlaW5lcyBBdXNnYWJlZ2VyXHUwMEU0dHMuIEtvbnN0YW50IGdlaGFsdGVuIHdpcmRcclxuLy8gaGllciBhbHNvIFwiZ2xlaWNoIHdlaXQgYXVzZ2VyZWl6dFwiLCBuaWNodCBcImdsZWljaCBidW50XCIgKGRhcyB3XHUwMEU0cmUga29uc3RhbnRlc1xyXG4vLyBDKSB1bmQgbmljaHQgXCJnbGVpY2ggZ2VzXHUwMEU0dHRpZ3RcIiAoZGFzIHdcdTAwRTRyZSBrb25zdGFudGVzIEMvTCkuIERhcmF1cyBmb2xndDpcclxuLy8gICAtIERhcyBNb2RlbGwgaXN0IGFuIHNSR0IgZ2VidW5kZW4uIEluIGVpbmVtIHdlaXRlcmVuIEZhcmJyYXVtIGVyZ1x1MDBFNGJlblxyXG4vLyAgICAgZGllc2VsYmVuIEVpbmdhYmVuIGFuZGVyZSBGYXJiZW4sIHdlaWwgZGllIERlY2tlIHdvYW5kZXJzIGxpZWd0LlxyXG4vLyAgIC0gcmVtYXBUb0N1c3AgZ2lidCBnbGVpY2hlIHdhaHJnZW5vbW1lbmUgSGVsbGlna2VpdCBiZXd1c3N0IGF1ZjogbmFjaFxyXG4vLyAgICAgZWluZXIgRmFyYnRvbmRyZWh1bmcgaXN0IGRlciBTdWJ0eXAgbmljaHQgbWVociBnbGVpY2ggaGVsbCB3aWUgc2VpbiBUWVAsXHJcbi8vICAgICBzb25kZXJuIGdsZWljaCBuYWNoZHJcdTAwRkNja2xpY2guIERhcyBpc3QgaGllciBlcndcdTAwRkNuc2NodCwgYWJlciBlcyBpc3QgZWluZVxyXG4vLyAgICAgR2VzdGFsdHVuZ3NlbnRzY2hlaWR1bmcgdW5kIGtlaW4gcGVyemVwdHVlbGxlcyBHZXNldHouXHJcbi8vICAgLSBcdTAwRENiZXIgZGllIEhlbGxpZ2tlaXQgaXN0IGRhcyBDaHJvbWEgbmljaHQgbW9ub3Rvbi4gTGllZ3QgZWluZSBUWVAtRmFyYmVcclxuLy8gICAgIFx1MDBGQ2JlciBpaHJlbSBTY2hlaXRlbCwgc3RlaWd0IGVzIGF1ZiBkZW0gV2VnIG5hY2ggdW50ZW4gZXJzdCBhbiB1bmQgZlx1MDBFNGxsdFxyXG4vLyAgICAgZGFubiB3aWVkZXIgKGVpbiBibGF1ZXMgIzc4NzhkYyBoYXQgYmVpIC0yMCAlIG1laHIgQ2hyb21hIGFscyBiZWkgMCAlXHJcbi8vICAgICB1bmQgYmVpIC00MCAlKS4gRGVyIFJlZ2xlciBmXHUwMEU0aHJ0IGRvcnQgXHUwMEZDYmVyIGVpbmVuIEJ1Y2tlbC5cclxuLy8gRlx1MDBGQ3IgZmFyYmlnZSBEYXRlaW5hbWVuIGlzdCBhbGwgZGFzIHRyYWdiYXIgLSB3ZXIgZGFzIE1vZGVsbCBzdHJlbmdlciBoYWJlblxyXG4vLyB3aWxsLCBtXHUwMEZDc3N0ZSBkaWUgQmV6dWdzZ3JcdTAwRjZcdTAwREZlIHdlY2hzZWxuLCBuaWNodCBkaWUgRm9ybWVsbiBuYWNoYmVzc2Vybi5cclxuLy9cclxuLy8gQXVjaCBPS0xhYiBzZWxic3QgaXN0IG5pY2h0IHNwYW5udW5nc2ZyZWk6IHNlaW5lIEZhcmJ0b25saW5pZW4gbGF1ZmVuIGltXHJcbi8vIEJsYXViZXJlaWNoIChIIDI2MC0yOTApIG1lcmtsaWNoIGFuIGRlciBXYWhybmVobXVuZyB2b3JiZWksIEJsYXUgemllaHQgYmVpbVxyXG4vLyBBdWZoZWxsZW4gaW5zIFZpb2xldHRlLiBSZWNobmVyaXNjaCBibGVpYnQgZGVyIEZhcmJ0b24gZG9ydCBrb25zdGFudCwgd2FzXHJcbi8vIGRhcyBQcm9ibGVtIGVoZXIgdmVyZGVja3QgYWxzIGJlaGVidC4gRWluZSBUWVAtRmFyYmUgaW4gZGllc2VtIEJlcmVpY2ggYWxzb1xyXG4vLyBsaWViZXIgbmFjaHNlaGVuIGFscyBkZW4gWmFobGVuIGdsYXViZW4uXHJcbmZ1bmN0aW9uIGNvbXB1dGVDb2xvck9mZnNldChoZXgsIG9mZnNldCkge1xyXG4gIGNvbnN0IGJhc2UgPSBoZXhUb09rbGNoKGhleCk7XHJcbiAgaWYgKCFiYXNlKSByZXR1cm4gaGV4O1xyXG4gIGNvbnN0IEggPSAoYmFzZS5IICsgKG9mZnNldC5oID8/IDApICsgMzYwKSAlIDM2MDtcclxuICBjb25zdCBiYXNlQ2VpbGluZyA9IG1heENocm9tYShiYXNlLkwsIGJhc2UuSCk7XHJcbiAgLy8gRWluZSBncmF1ZSBUWVAtRmFyYmUgYmxlaWJ0IGdyYXUsIHVuZCBpaHIgRmFyYnRvbiBpc3QgYmVkZXV0dW5nc2xvcyAtIGRhbm5cclxuICAvLyBnaWJ0IGVzIGF1Y2gga2VpbmVuIFNjaGVpdGVsLCBkZW0gZGllIEhlbGxpZ2tlaXQgZm9sZ2VuIGtcdTAwRjZubnRlLlxyXG4gIGNvbnN0IG5ldXRyYWwgPSBiYXNlLkMgPCBORVVUUkFMX0NIUk9NQSB8fCBiYXNlQ2VpbGluZyA8PSAwO1xyXG4gIGNvbnN0IHJlbGF0aXZlID0gbmV1dHJhbCA/IDAgOiBiYXNlLkMgLyBiYXNlQ2VpbGluZztcclxuICBjb25zdCBzaGlmdGVkID0gbmV1dHJhbCA/IGJhc2UuTCA6IHJlbWFwVG9DdXNwKGJhc2UuTCwgYmFzZS5ILCBIKTtcclxuICBjb25zdCBzaGFyZSA9IChvZmZzZXQubCA/PyAwKSAvIDEwMDtcclxuICBjb25zdCBMID0gTWF0aC5taW4oMSwgTWF0aC5tYXgoMCwgc2hpZnRlZCArIHNoYXJlICogKHNoYXJlID49IDAgPyAxIC0gc2hpZnRlZCA6IHNoaWZ0ZWQpKSk7XHJcbiAgY29uc3QgQyA9IHJlbGF0aXZlICogbWF4Q2hyb21hKEwsIEgpOyAvKiAqICgxICsgKG9mZnNldC5zID8/IDApIC8gMTAwKSAtIFNcdTAwRTR0dGlndW5nIHN0aWxsZ2VsZWd0ICovXHJcbiAgcmV0dXJuIG9rbGNoVG9IZXgoeyBMLCBDOiBNYXRoLm1heCgwLCBDKSwgSCB9KTtcclxufVxyXG5cclxuZnVuY3Rpb24gaGFzQ29sb3JPZmZzZXQob2Zmc2V0KSB7XHJcbiAgcmV0dXJuICEhb2Zmc2V0ICYmIFNVQlRZUEVfQ09MT1JfQ0hBTk5FTFMuc29tZSgoeyBrZXkgfSkgPT4gKG9mZnNldFtrZXldID8/IDApICE9PSAwKTtcclxufVxyXG5cclxuLy8gRmFyYmUgZWluZXMgU3VidHlwcyAoYnp3LiBkaWUgZGVzIFRZUHMsIHNvbGFuZ2UgZGVyIFN1YnR5cCBrZWluZSBlaWdlbmVcclxuLy8gRWluc3RlbGx1bmcgaGF0KTsgbnVsbCwgd2VubiBkZXIgVFlQIHNlbGJzdCBrZWluZSBGYXJiZSBoYXQuXHJcbmZ1bmN0aW9uIHN1YnR5cGVDb2xvcihzZXR0aW5ncywgdHlwZSwgc3VidHlwZSkge1xyXG4gIGNvbnN0IHR5cGVDb2xvciA9IHNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV0gPz8gbnVsbDtcclxuICBpZiAoIXR5cGVDb2xvciB8fCAhc3VidHlwZSkgcmV0dXJuIHR5cGVDb2xvcjtcclxuICBjb25zdCBvZmZzZXQgPSBjbGFtcGVkT2Zmc2V0KHNldHRpbmdzLCBnZXRTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKT8uY29sb3IpO1xyXG4gIHJldHVybiBoYXNDb2xvck9mZnNldChvZmZzZXQpID8gYXBwbHlDb2xvck9mZnNldCh0eXBlQ29sb3IsIG9mZnNldCkgOiB0eXBlQ29sb3I7XHJcbn1cclxuXHJcbi8vIEhhdCBkZXIgU3VidHlwIGVpbmUgZWlnZW5lIChpbm5lcmhhbGIgZGVyIEdyZW56ZW4gd2lya3NhbWUpIEFid2VpY2h1bmc/XHJcbmZ1bmN0aW9uIHN1YnR5cGVIYXNPd25Db2xvcihzZXR0aW5ncywgdHlwZSwgc3VidHlwZSkge1xyXG4gIHJldHVybiBoYXNDb2xvck9mZnNldChjbGFtcGVkT2Zmc2V0KHNldHRpbmdzLCBnZXRTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKT8uY29sb3IpKTtcclxufVxyXG5cclxuLy8gRmFyYmUsIGluIGRlciBlaW4gVFlQLSBiencuIFN1YnR5cC1OYW1lIGRhcmdlc3RlbGx0IHdpcmQgLSBnZW1laW5zYW1lXHJcbi8vIEdydW5kbGFnZSBmXHUwMEZDciBkZW4gUGlja2VyIChyZW5kZXJDb2xvcmVkTmFtZS9uYW1lQ29sb3IgaW4gdHlwZS1waWNrZXIuanMpIHVuZFxyXG4vLyBkaWUgU3VidHlwLVZvcnNjaGF1IGRlciBUWVAtTGlzdGUgKHJlbmRlclN1YnR5cGVQcmV2aWV3IGluIHR5cC12aWV3LmpzKSxcclxuLy8gZGFtaXQgYmVpZGUgbmljaHQgYXVzZWluYW5kZXJsYXVmZW4uIE1pdCBzdWJ0eXBlIGRpZSBGYXJiZSBkZXMgU3VidHlwcyxcclxuLy8gYWJlciBudXIgd2VubiBkZXIgVW50ZXItU2NoYWx0ZXIgXCJTdWJ0eXBcIiB2b24gXCJUWVAgVmlld1wiIGRhcyB6dWxcdTAwRTRzc3QgLSBzb25zdFxyXG4vLyBkaWUgZGVzIFRZUHMuIGlzRGVmYXVsdCA9IFN0YW5kYXJkd2VydCwgYWxzbyBob2hsZXIgUmluZyBzdGF0dCBnZWZcdTAwRkNsbHRlbVxyXG4vLyBQdW5rdCAoc2llaGUgcGFpbnRDb2xvckRvdCk6IGVpbiBUWVAgb2huZSBGYXJiZSBncmF1LCBlaW4gU3VidHlwIG9obmUgZWlnZW5lXHJcbi8vIEFid2VpY2h1bmcgaW4gZGVyIFRZUC1GYXJiZSwgZGllIGVyIFx1MDBGQ2Jlcm5pbW10LlxyXG5mdW5jdGlvbiBuYW1lQ29sb3Ioc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUgPSBudWxsKSB7XHJcbiAgY29uc3QgdXNlU3VidHlwZSA9ICEhc3VidHlwZSAmJiBzZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3RTdWJ0eXA7XHJcbiAgY29uc3QgdHlwZUNvbG9yID0gc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXSA/PyBudWxsO1xyXG4gIHJldHVybiB7XHJcbiAgICBjb2xvcjogKHVzZVN1YnR5cGUgPyBzdWJ0eXBlQ29sb3Ioc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpIDogdHlwZUNvbG9yKSA/PyBERUZBVUxUX1RZUEVfQ09MT1IsXHJcbiAgICBpc0RlZmF1bHQ6ICF0eXBlQ29sb3IgfHwgKHVzZVN1YnR5cGUgJiYgIXN1YnR5cGVIYXNPd25Db2xvcihzZXR0aW5ncywgdHlwZSwgc3VidHlwZSkpLFxyXG4gIH07XHJcbn1cclxuXHJcbi8vIEZhcmJwdW5rdCAoVFlQLUxpc3RlLCBEZXRhaWxhbnNpY2h0LCBQaWNrZXIsIEJlc3RcdTAwRTR0aWd1bmdlbik6IGdlZlx1MDBGQ2xsdCBiZWlcclxuLy8gZWluZXIgZWlnZW5lbiBGYXJiZSwgYWxzIGhvaGxlciBSaW5nIGJlaW0gU3RhbmRhcmR3ZXJ0IC0gZWluIFRZUCBvaG5lIEZhcmJlXHJcbi8vIGFscyBncmF1ZXIgUmluZywgZWluIFN1YnR5cCBvaG5lIGVpZ2VuZSBFaW5zdGVsbHVuZyBhbHMgUmluZyBpbiBkZXJcclxuLy8gVFlQLUZhcmJlLCBkaWUgZXIgXHUwMEZDYmVybmltbXQuXHJcbmZ1bmN0aW9uIHBhaW50Q29sb3JEb3QoZWwsIGNvbG9yLCBpc0RlZmF1bHQpIHtcclxuICBlbC5zdHlsZS5iYWNrZ3JvdW5kQ29sb3IgPSBpc0RlZmF1bHQgPyBcInRyYW5zcGFyZW50XCIgOiBjb2xvcjtcclxuICBlbC5zdHlsZS5ib3hTaGFkb3cgPSBpc0RlZmF1bHQgPyBgaW5zZXQgMCAwIDAgbWF4KDEuNXB4LCAwLjE1ZW0pICR7Y29sb3J9YCA6IFwiXCI7XHJcbn1cclxuXHJcbi8vIHZpZXdLZXkgKG9wdGlvbmFsKTogU2NobFx1MDBGQ3NzZWwgZGVyIEFuc2ljaHQgaW4gY29sb3JWaWV3cyAtIGlzdCBkb3J0IGRlclxyXG4vLyBVbnRlci1TY2hhbHRlciBcIjx2aWV3S2V5PlN1YnR5cFwiIGFuLCBnaWx0IGRpZSBGYXJiZSBkZXMgU3VidHlwcyBkZXIgTm90aXpcclxuLy8gc3RhdHQgZGVyIGlocmVzIFRZUHMuXHJcbmZ1bmN0aW9uIGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIHZpZXdLZXkgPSBudWxsKSB7XHJcbiAgY29uc3QgdHlwZSA9IHBsdWdpbi50eXBJbmRleC50eXBlT2YoZmlsZSk7XHJcbiAgaWYgKCF0eXBlKSByZXR1cm4gbnVsbDtcclxuICBjb25zdCB7IHNldHRpbmdzIH0gPSBwbHVnaW47XHJcbiAgaWYgKCF2aWV3S2V5IHx8ICFzZXR0aW5ncy5jb2xvclZpZXdzW2Ake3ZpZXdLZXl9U3VidHlwYF0pIHJldHVybiBzZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdID8/IG51bGw7XHJcbiAgcmV0dXJuIHN1YnR5cGVDb2xvcihzZXR0aW5ncywgdHlwZSwgcGx1Z2luLnR5cEluZGV4LnN1YnR5cGVPZihmaWxlKSk7XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0ge1xyXG4gIGNvbG9yRm9yRmlsZSxcclxuICBuYW1lQ29sb3IsXHJcbiAgREVGQVVMVF9UWVBFX0NPTE9SLFxyXG4gIHN1YnR5cGVDb2xvcixcclxuICBhcHBseUNvbG9yT2Zmc2V0LFxyXG4gIGhhc0NvbG9yT2Zmc2V0LFxyXG4gIHN1YnR5cGVIYXNPd25Db2xvcixcclxuICBwYWludENvbG9yRG90LFxyXG4gIGNvbG9yUmFuZ2UsXHJcbiAgY2hhbm5lbEJvdW5kcyxcclxuICBjbGFtcGVkT2Zmc2V0LFxyXG4gIFNVQlRZUEVfQ09MT1JfQ0hBTk5FTFMsXHJcbiAgREVGQVVMVF9TVUJUWVBFX0NPTE9SX1JBTkdFUyxcclxufTtcclxuIiwgImNvbnN0IHsgUGx1Z2luU2V0dGluZ1RhYiwgU2V0dGluZ0dyb3VwLCBUb2dnbGVDb21wb25lbnQsIERyb3Bkb3duQ29tcG9uZW50LCBkZWJvdW5jZSB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xyXG5jb25zdCB7IG1vdW50R2xvYmFsT3JkZXJFZGl0b3IgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLW9yZGVyLWVkaXRvclwiKTtcclxuY29uc3QgeyBERUZBVUxUX0dMT0JBTF9PUkRFUiB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItc29ydFwiKTtcclxuY29uc3QgeyBTVUJUWVBFX0NPTE9SX0NIQU5ORUxTLCBERUZBVUxUX1NVQlRZUEVfQ09MT1JfUkFOR0VTLCBjb2xvclJhbmdlIH0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcclxuXHJcbmNvbnN0IERFRkFVTFRfU0VUVElOR1MgPSB7XHJcbiAgdHlwZXM6IFtdLFxyXG4gIHR5cGVDb2xvcnM6IHt9LFxyXG4gIHR5cGVEZXNjcmlwdGlvbnM6IHt9LFxyXG4gIHR5cGVEZWZhdWx0RnJvbnRtYXR0ZXI6IHt9LFxyXG4gIC8vIEtleXMgYXVzIHR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV0sIGRpZSBhbHMgXCJGbG9hdGluZyBQcm9wZXJ0eVwiIG1hcmtpZXJ0XHJcbiAgLy8gc2luZCAoc2llaGUgdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMvdHlwLXZpZXcuanMpIC0gVGVpbCBkZXJzZWxiZW4gTGlzdGVcclxuICAvLyB1bmQgUmVpaGVuZm9sZ2Ugd2llIGRpZSBcdTAwRkNicmlnZW4gU3RhbmRhcmQtUHJvcGVydGllcyBkZXMgVHlwcyAod2ljaHRpZyBmXHUwMEZDclxyXG4gIC8vIGRpZSBGcm9udG1hdHRlci1Tb3J0aWVydW5nLCBzaWVoZSBvcmRlcmVkRGVmYXVsdEtleXMgaW4gZnJvbnRtYXR0ZXItc29ydC5qcyksXHJcbiAgLy8gYWJlciBOSUNIVCBUZWlsIGRlcyB2b24gZ2V0VHlwZURlZmF1bHRzKCkgKG1haW4uanMpIHN0YW5kYXJkbVx1MDBFNFx1MDBERmlnXHJcbiAgLy8gZ2VsaWVmZXJ0ZW4gRnJvbnRtYXR0ZXJzIC0gVGVtcGxhdGVyIGxlZ3Qgc2llIGJlaW0gQW5sZWdlbiBlaW5lciBOb3RpeiBhbHNvXHJcbiAgLy8gbmljaHQgYXV0b21hdGlzY2ggYW4gKG51ciBcdTAwRkNiZXIgZGVuIGV4cGxpeml0ZW4gaW5jbHVkZUZsb2F0aW5nLVBhcmFtZXRlcikuXHJcbiAgdHlwZUZsb2F0aW5nS2V5czoge30sXHJcbiAgLy8gU2hvcnRjdXRzIGplIEtleSBhdXMgdHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXTpcclxuICAvLyAgIHsgW1RZUF06IHsgW1Byb3BlcnR5XTogeyBuYW1lOiBcInRvZGF5XCIgfCBcInRwLjxTa3JpcHRuYW1lPlwiIH0gfSB9XHJcbiAgLy8gQmV3dXNzdCBORUJFTiBkZW0gRnJvbnRtYXR0ZXIgc3RhdHQgYWxzIGRlc3NlbiBXZXJ0IC0gc2llaGUgZGllIEJlZ3JcdTAwRkNuZHVuZ1xyXG4gIC8vIGluIHNob3J0Y3V0cy5qcy4gRGVyIFdlcnQgZGVyIFByb3BlcnR5IGJsZWlidCBkYWR1cmNoIHR5cHJlaW4gKE9ic2lkaWFuc1xyXG4gIC8vIG5hdGl2ZXMgV2lkZ2V0IGJsZWlidCB1bmFuZ2V0YXN0ZXQpIHVuZCBkaWVudCBiZWkgZ2VzZXR6dGVtIFNob3J0Y3V0IGFsc1xyXG4gIC8vIFJcdTAwRkNja2ZhbGx3ZXJ0LCBmYWxscyBkZXNzZW4gVGVtcGxhdGVyLVNrcmlwdCBmZWhsc2NobFx1MDBFNGd0LlxyXG4gIHR5cGVTaG9ydGN1dHM6IHt9LFxyXG4gIHR5cGVNYW51YWw6IHt9LFxyXG4gIC8vIFJlZ2lzdHJpZXJ0ZSBTdWJ0eXBlbiBqZSBUWVAgc2FtdCBlaWdlbmVtIEZyb250bWF0dGVyLUJsb2NrLCBzaWVoZSBzdWJ0eXBlcy5qcy5cclxuICB0eXBlU3VidHlwZXM6IHt9LFxyXG4gIC8vIFNpZWhlIGZyb250bWF0dGVyLW9yZGVyLWVkaXRvci5qcyAvIGZyb250bWF0dGVyLXNvcnQuanM6IFJlaWhlbmZvbGdlIGF1c1xyXG4gIC8vIGZlc3QgcG9zaXRpb25pZXJ0ZW4gRWluemVsLVByb3BlcnRpZXMgKGtpbmQ6IFwicHJvcGVydHlcIikgc293aWUgZGVuIHZpZXJcclxuICAvLyBuaWNodCBlbnRmZXJuYmFyZW4gUGxhdHpoYWx0ZXJuIFwidHlwVmFsdWVcIiAoVFlQLVByb3BlcnR5IHNlbGJzdCksXHJcbiAgLy8gXCJzdWJ0eXBWYWx1ZVwiIChTVUJUWVAtUHJvcGVydHkgc2VsYnN0KSwgXCJ0eXBcIiAoU3RhbmRhcmRsaXN0ZSBkZXMgVHlwcylcclxuICAvLyB1bmQgXCJvdGhlclwiIChhbGxlcyBcdTAwRENicmlnZSkuXHJcbiAgZ2xvYmFsUHJvcGVydHlPcmRlcjogREVGQVVMVF9HTE9CQUxfT1JERVIsXHJcbiAgLy8gU2llaGUgYWN0aXZlLXRpdGxlLWNvbG9ycy5qczogd2llIGRlciBUWVAgaW4gZGVyIGdlXHUwMEY2ZmZuZXRlbiBOb3RpeiBtYXJraWVydFxyXG4gIC8vIHdpcmQgLSBcIm5vbmVcIiAobmljaHRzKSwgXCJkb3RcIiAoRmFyYnB1bmt0IGFtIFRpdGVsKSBvZGVyIFwiYmFkZ2VcIiAoQm94IG1pdFxyXG4gIC8vIFRZUC1OYW1lbiwgd2VpdGVyIGtvbmZpZ3VyaWVydCBcdTAwRkNiZXIgZGllIGRyZWkgZm9sZ2VuZGVuIEVpbnN0ZWxsdW5nZW4sIGRpZVxyXG4gIC8vIG51ciBiZWkgXCJiYWRnZVwiIFx1MDBGQ2JlcmhhdXB0IGVpbmUgUm9sbGUgc3BpZWxlbiBiencuIGluIGRlbiBFaW5zdGVsbHVuZ2VuXHJcbiAgLy8gYW5nZXplaWd0IHdlcmRlbikuIFVuYWJoXHUwMEU0bmdpZyBkYXZvbiB1bmQgYmVsaWViaWcga29tYmluaWVyYmFyOlxyXG4gIC8vIGNvbG9yVmlld3Mubm90ZVRpdGxlQ29sb3IgZlx1MDBFNHJidCBkZW4gVGl0ZWx0ZXh0IHNlbGJzdCBlaW4uXHJcbiAgbm90ZVRpdGxlU3R5bGU6IFwiZG90XCIsXHJcbiAgLy8gTnVyIHJlbGV2YW50IGJlaSBub3RlVGl0bGVTdHlsZTogXCJiYWRnZVwiIC0gb2IgZGllIEJveCBmYXJiaWcgKFRZUC1GYXJiZSlcclxuICAvLyBvZGVyIG5ldXRyYWwgKHRleHQtbXV0ZWQpIGRhcmdlc3RlbGx0IHdpcmQuXHJcbiAgbm90ZVRpdGxlQmFkZ2VDb2xvcmVkOiB0cnVlLFxyXG4gIC8vIE51ciByZWxldmFudCBiZWkgbm90ZVRpdGxlU3R5bGU6IFwiYmFkZ2VcIiAtIEJlc2NocmlmdHVuZyBkZXIgQm94OiBcInR5cGVcIlxyXG4gIC8vIChbVFlQXSksIFwidHlwZS1zdWJ0eXBlXCIgKFtUWVAvU3VidHlwXSkgb2RlciBcInN1YnR5cGVcIiAoW1N1YnR5cF0sIGJlaVxyXG4gIC8vIE5vdGl6ZW4gb2huZSBTdWJ0eXAga2VpbmUgQm94KS4gRmFyYmUgKG1pdCBub3RlVGl0bGVCYWRnZUNvbG9yZWQpXHJcbiAgLy8gZW50c3ByZWNoZW5kIGRpZSBkZXMgVFlQcyBiencuIGRlcyBTdWJ0eXBzIC0gYmVpIFwidHlwZS1zdWJ0eXBlXCIgd1x1MDBFNGhsYmFyXHJcbiAgLy8gXHUwMEZDYmVyIGNvbG9yVmlld3Mubm90ZVRpdGxlTWFya2VyU3VidHlwIChcIlN1YnR5cC1GYXJiZVwiKS5cclxuICBub3RlVGl0bGVCYWRnZUxhYmVsOiBcInR5cGVcIixcclxuICAvLyBOdXIgcmVsZXZhbnQgYmVpIG5vdGVUaXRsZVN0eWxlOiBcImJhZGdlXCIgLSBcInRpdGxlXCIgKG5lYmVuIGRlbSBJbmxpbmUtVGl0ZWwsXHJcbiAgLy8gbm9ybWFsZSBBdXNyaWNodHVuZykgb2RlciBcImJsb2NrXCIgKGxpbmtzIGFtIFByb3BlcnR5LUJsb2NrLCB1bSA5MFx1MDBCMCBnZWRyZWh0KS5cclxuICBub3RlVGl0bGVCYWRnZVBvc2l0aW9uOiBcInRpdGxlXCIsXHJcbiAgLy8gTnVyIHJlbGV2YW50IGJlaSBub3RlVGl0bGVCYWRnZVBvc2l0aW9uOiBcImJsb2NrXCIgLSBvYiBkaWUgZ2VkcmVodGUgQm94IGFtXHJcbiAgLy8gb2JlcmVuIG9kZXIgdW50ZXJlbiBSYW5kIGRlcyBQcm9wZXJ0eS1CbG9ja3Mgc2l0enQuXHJcbiAgbm90ZVRpdGxlVmVydGljYWxBbGlnbjogXCJ0b3BcIixcclxuICB0eXBTb3J0T3JkZXI6IFwiY291bnQtZGVzY1wiLFxyXG4gIC8vIFdhcyBpbiBkZXIgVFlQLUxpc3RlIHJlY2h0cyBuZWJlbiBkZW0gTmFtZW4gc3RlaHQgLSBcImRlc2NyaXB0aW9uXCIsXHJcbiAgLy8gXCJzdWJ0eXBlc1wiIG9kZXIgXCJub25lXCIuIFVtZ2VzY2hhbHRldCB3aXJkIGRhcyBuaWNodCBoaWVyLCBzb25kZXJuIFx1MDBGQ2JlciBkZW5cclxuICAvLyBLbm9wZiBpbSBMaXN0ZW4tSGVhZGVyIG5lYmVuIGRlciBTb3J0aWVydW5nIChzaWVoZSBTRUNPTkRBUllfTU9ERVMgaW5cclxuICAvLyB0eXAtdmlldy5qcyksIHdpZSBzY2hvbiBkaWUgU29ydGllcnJlaWhlbmZvbGdlOiBiZWlkZXMgYmV0cmlmZnQgbnVyIGRhc1xyXG4gIC8vIEF1c3NlaGVuIGRpZXNlciBlaW5lbiBMaXN0ZSB1bmQgZ2VoXHUwMEY2cnQgZGFoZXIgYW4gc2llIHNlbGJzdCwgbmljaHQgaW4gZWluZVxyXG4gIC8vIEVpbnN0ZWxsdW5nc3NlaXRlLCBkaWUgbWFuIGRhZlx1MDBGQ3IgamVkZXMgTWFsIFx1MDBGNmZmbmVuIG1cdTAwRkNzc3RlLlxyXG4gIHR5cExpc3RTZWNvbmRhcnk6IFwic3VidHlwZXNcIixcclxuICAvLyBTaWVoZSBwaWNrVHlwZUFuZFN1YnR5cGUgaW4gdHlwZS1waWNrZXIuanM6IGZhbHNlID0gU3VidHlwZW4gZWluZ2VyXHUwMEZDY2t0XHJcbiAgLy8gZGlyZWt0IGltIFRZUC1QaWNrZXIsIHRydWUgPSBlaWdlbmVyIFN1YnR5cC1QaWNrZXIgbmFjaCBkZXIgVFlQLUF1c3dhaGwuXHJcbiAgc2VwYXJhdGVTdWJ0eXBlUGlja2VyOiBmYWxzZSxcclxuICBpbmNsdWRlSWdub3JlZEZpbGVzOiBmYWxzZSxcclxuICAvLyBFaWdlbmUgVGFnLS9BbmhcdTAwRTRuZ2UtRmFyYmUgaW0gR3JhcGggZGVha3RpdmllcnQgKDMwLjA5LjIwMjYpOiBiZWlkZXMgaXN0IGluXHJcbiAgLy8gZGVuIFN0eWxlIFNldHRpbmdzIGRlcyBNaW5pbWFsIFRoZW1lIGVpbnN0ZWxsYmFyLCBzaWVoZSBncmFwaC1jb2xvcnMuanMuXHJcbiAgLy8gZ3JhcGhUYWdDb2xvckVuYWJsZWQ6IGZhbHNlLFxyXG4gIC8vIGdyYXBoVGFnQ29sb3I6IFwiXCIsXHJcbiAgLy8gZ3JhcGhBdHRhY2htZW50Q29sb3JFbmFibGVkOiBmYWxzZSxcclxuICAvLyBncmFwaEF0dGFjaG1lbnRDb2xvcjogXCJcIixcclxuICAvLyBXaWUgd2VpdCBkaWUgRmFyYmUgZWluZXMgU3VidHlwcyBoXHUwMEY2Y2hzdGVucyB2b24gZGVyIHNlaW5lcyBUWVBzIGFid2VpY2hlblxyXG4gIC8vIGRhcmYgKFx1MDBCMSksIHNpZWhlIHR5cGUtY29sb3JzLmpzOiBGYXJidG9uIGluIEdyYWQsIEhlbGxpZ2tlaXQgaW4gJSBkZXMgV2Vnc1xyXG4gIC8vIHp1IFdlaVx1MDBERiBiencuIFNjaHdhcnouXHJcbiAgc3VidHlwZUNvbG9yUmFuZ2VzOiB7IC4uLkRFRkFVTFRfU1VCVFlQRV9DT0xPUl9SQU5HRVMgfSxcclxuICBjb2xvclZpZXdzOiB7XHJcbiAgICBmaWxlRXhwbG9yZXI6IHRydWUsXHJcbiAgICBncmFwaDogdHJ1ZSxcclxuICAgIHNlYXJjaDogdHJ1ZSxcclxuICAgIHJlY2VudEZpbGVzOiB0cnVlLFxyXG4gICAgYmFja2xpbmtzOiB0cnVlLFxyXG4gICAgYm9va21hcmtzOiB0cnVlLFxyXG4gICAgLy8gVW50ZXItU2NoYWx0ZXIgXCI8QW5zaWNodD5TdWJ0eXBcIiBkZXIgRWluZlx1MDBFNHJidW5nZW46IEZhcmJlIGRlcyBTdWJ0eXBzXHJcbiAgICAvLyBlaW5lciBOb3RpeiBzdGF0dCBkZXIgaWhyZXMgVFlQcyAoc2llaGUgY29sb3JGb3JGaWxlIGluIHR5cGUtY29sb3JzLmpzKS5cclxuICAgIGZpbGVFeHBsb3JlclN1YnR5cDogdHJ1ZSxcclxuICAgIGdyYXBoU3VidHlwOiB0cnVlLFxyXG4gICAgc2VhcmNoU3VidHlwOiB0cnVlLFxyXG4gICAgcmVjZW50RmlsZXNTdWJ0eXA6IHRydWUsXHJcbiAgICBiYWNrbGlua3NTdWJ0eXA6IHRydWUsXHJcbiAgICBib29rbWFya3NTdWJ0eXA6IHRydWUsXHJcbiAgICBsaW5rc1N1YnR5cDogdHJ1ZSxcclxuICAgIHR5cExpc3RTdWJ0eXA6IHRydWUsXHJcbiAgICBub3RlVGl0bGVDb2xvclN1YnR5cDogdHJ1ZSxcclxuICAgIG5vdGVUaXRsZU1hcmtlclN1YnR5cDogdHJ1ZSxcclxuICAgIGZyb250bWF0dGVyRGVmYXVsdHM6IHRydWUsXHJcbiAgICAvLyBVbnRlci1TY2hhbHRlciB6dSBmcm9udG1hdHRlckRlZmF1bHRzIGJ6dy4gYWxsUHJvcGVydGllczogYmV6aWVodCBkaWVcclxuICAgIC8vIEZyb250bWF0dGVyLUJsXHUwMEY2Y2tlIGRlciBTdWJ0eXBlbiBtaXQgZWluIChzaWVoZVxyXG4gICAgLy8gZnJvbnRtYXR0ZXItZGVmYXVsdC1oaWdobGlnaHQuanMpIC0gYmVpIGFsbFByb3BlcnRpZXMgenVnbGVpY2ggaW4gZGVyXHJcbiAgICAvLyBGYXJiZSBkZXMgamV3ZWlsaWdlbiBTdWJ0eXBzLlxyXG4gICAgZnJvbnRtYXR0ZXJEZWZhdWx0c1N1YnR5cDogdHJ1ZSxcclxuICAgIHR5cExpc3Q6IHRydWUsXHJcbiAgICBhbGxQcm9wZXJ0aWVzOiB0cnVlLFxyXG4gICAgYWxsUHJvcGVydGllc1N1YnR5cDogdHJ1ZSxcclxuICAgIG5vdGVUaXRsZUNvbG9yOiB0cnVlLFxyXG4gICAgbGlua3M6IHRydWUsXHJcbiAgfSxcclxufTtcclxuXHJcbmNsYXNzIFR5cFN5c3RlbVNldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcclxuICBjb25zdHJ1Y3RvcihhcHAsIHBsdWdpbikge1xyXG4gICAgc3VwZXIoYXBwLCBwbHVnaW4pO1xyXG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XHJcbiAgfVxyXG5cclxuICAvLyBKZWRlciBBYnNjaG5pdHQgaXN0IGVpbmUgU2V0dGluZ0dyb3VwIC0gT2JzaWRpYW5zIGVpZ2VuZSBHcnVwcGllcnVuZ1xyXG4gIC8vIChcdTAwRENiZXJzY2hyaWZ0ICsgZWluZSBCb3gsIEVpbnRyXHUwMEU0Z2UgZGFyaW4gZHVyY2ggVHJlbm5saW5pZW4gZ2V0cmVubnQpLCB3aWVcclxuICAvLyBpbiBkZW4gQ29yZS1FaW5zdGVsbHVuZ2VuLiBFaW56ZWxuIHBlciBuZXcgU2V0dGluZyhjb250YWluZXJFbCkgYW5nZWxlZ3RlXHJcbiAgLy8gRWludHJcdTAwRTRnZSB3XHUwMEZDcmRlbiBzdGF0dGRlc3NlbiBqZSBhbHMgZWlnZW5lIGtsZWluZSBCb3ggZ2VyZW5kZXJ0LlxyXG4gIGRpc3BsYXkoKSB7XHJcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xyXG4gICAgLy8gU2Nyb2xsLVBvc2l0aW9uIFx1MDBGQ2JlciBkZW4gTmV1YXVmYmF1IHJldHRlbiAoZGlzcGxheSgpIHdpcmQgYXVjaCB2b25cclxuICAgIC8vIFNjaGFsdGVybiBtaXQgVW50ZXItT3B0aW9uZW4gYXVmZ2VydWZlbik6IGRhcyBEcm9wZG93biBkZXJcclxuICAgIC8vIFRZUC1NYXJraWVydW5nIG1pc3N0IHNpY2ggYmVpbSBzZXRWYWx1ZSgpIChyZXNpemVUb0ZpdCBsaWVzdFxyXG4gICAgLy8gb2Zmc2V0V2lkdGgpIHVuZCBlcnp3aW5ndCBzbyBlaW4gTGF5b3V0LCBzb2xhbmdlIGRpZSBTZWl0ZSBlcnN0IGJpc1xyXG4gICAgLy8gZG9ydGhpbiBhdWZnZWJhdXQgaXN0IC0gZGVyIEJyb3dzZXIga2FwcHQgc2Nyb2xsVG9wIGRhbm4gYXVmIGRpZXNlXHJcbiAgICAvLyBUZWlsaFx1MDBGNmhlLCBkaWUgQW5zaWNodCBzcHJcdTAwRTRuZ2UgbmFjaCBvYmVuLlxyXG4gICAgY29uc3QgeyBzY3JvbGxUb3AgfSA9IGNvbnRhaW5lckVsO1xyXG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcclxuXHJcbiAgICBuZXcgU2V0dGluZ0dyb3VwKGNvbnRhaW5lckVsKVxyXG4gICAgICAuc2V0SGVhZGluZyhcIlRZUC1MaXN0ZVwiKVxyXG4gICAgICAuYWRkU2V0dGluZygoc2V0dGluZykgPT5cclxuICAgICAgICBzZXR0aW5nXHJcbiAgICAgICAgICAuc2V0TmFtZShcIklnbm9yaWVydGUgTm90aXplbiBJTU1FUiBiZXJcdTAwRkNja3NpY2h0aWdlblwiKVxyXG4gICAgICAgICAgLnNldERlc2MoXHJcbiAgICAgICAgICAgIFwiQmV6aWVodCBOb3RpemVuIGF1cyBPYnNpZGlhbnMgXFxcIkV4Y2x1ZGVkIGZpbGVzXFxcIi1MaXN0ZSAoZG9ydCB0cmFnZW4gYXVjaCBQbHVnaW5zIHdpZSBIaWRlIEZvbGRlcnMgYXVzZ2VibGVuZGV0ZSBPcmRuZXIgZWluKSB3aWVkZXIgaW4gVFlQLVpcdTAwRTRobGVyLCBUWVAtUGlja2VyIHVuZCBkaWUgRnJvbnRtYXR0ZXItU29ydGllcnVuZyBtaXQgZWluLCBzdGF0dCBzaWUgenUgXHUwMEZDYmVyc3ByaW5nZW4uXCJcclxuICAgICAgICAgIClcclxuICAgICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cclxuICAgICAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXMpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXMgPSB2YWx1ZTtcclxuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgICAgICAgICAgfSlcclxuICAgICAgICAgIClcclxuICAgICAgKTtcclxuXHJcbiAgICBuZXcgU2V0dGluZ0dyb3VwKGNvbnRhaW5lckVsKS5zZXRIZWFkaW5nKFwiVFlQLVBpY2tlclwiKS5hZGRTZXR0aW5nKChzZXR0aW5nKSA9PlxyXG4gICAgICBzZXR0aW5nXHJcbiAgICAgICAgLnNldE5hbWUoXCJTdWJ0eXAtUGlja2VyIHNlcGFyYXRcIilcclxuICAgICAgICAuc2V0RGVzYyhcclxuICAgICAgICAgIFwiQmVpbSBBbmxlZ2VuIGVpbmVyIE5vdGl6IGZvbGd0IGF1ZiBkZW4gVFlQLVBpY2tlciBlaW4gZWlnZW5lciBTdWJ0eXAtUGlja2VyIChFU0MgZG9ydCBmXHUwMEZDaHJ0IHp1clx1MDBGQ2NrIHp1ciBUWVAtQXVzd2FobCksIHN0YXR0IGRpZSBTdWJ0eXBlbiBkaXJla3QgZWluZ2VyXHUwMEZDY2t0IHVudGVyIGlocmVtIFRZUCBpbSBUWVAtUGlja2VyIGFuenV6ZWlnZW4uIERlciBUWVAtUGlja2VyIG5lbm50IGRpZSBTdWJ0eXBlbiBkYW5uIGhpbnRlciBkZW0gVFlQLU5hbWVuLlwiXHJcbiAgICAgICAgKVxyXG4gICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cclxuICAgICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5zZXBhcmF0ZVN1YnR5cGVQaWNrZXIpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5zZXBhcmF0ZVN1YnR5cGVQaWNrZXIgPSB2YWx1ZTtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgICB9KVxyXG4gICAgICAgIClcclxuICAgICk7XHJcblxyXG4gICAgLy8gc3VidHlwS2V5IChvcHRpb25hbCk6IHN0YXR0IGVpbmVzIGVpbnplbG5lbiBTY2hhbHRlcnMgendlaSBiZXNjaHJpZnRldGVcclxuICAgIC8vIHVudGVyZWluYW5kZXIgKHdpZSBkaWUgVW50ZXItU2NoYWx0ZXIgYmVpIFwiQm94IG1pdCBUWVAtTmFtZW5cIiwgc2llaGVcclxuICAgIC8vIHVudGVuKSAtIFwiVFlQXCIgZlx1MDBGQ3IgZGVuIGVpZ2VudGxpY2hlbiBTY2hhbHRlciwgZGFydW50ZXIgXCJTdWJ0eXBcIiwgbnVyXHJcbiAgICAvLyBzaWNodGJhciwgc29sYW5nZSBcIlRZUFwiIGFuIGlzdC4gRGllIFRvb2x0aXBzIHBhc3NlbiBzdGFuZGFyZG1cdTAwRTRcdTAwREZpZyB6dSBkZW5cclxuICAgIC8vIEVpbmZcdTAwRTRyYnVuZ2VuIChTdWJ0eXAgPSBGYXJiZSBkZXMgU3VidHlwcyBzdGF0dCBkZXIgZGVzIFRZUHMpLlxyXG4gICAgY29uc3QgY29sb3JWaWV3VG9nZ2xlID0gKFxyXG4gICAgICBncm91cCxcclxuICAgICAga2V5LFxyXG4gICAgICBuYW1lLFxyXG4gICAgICBkZXNjLFxyXG4gICAgICBzdWJ0eXBLZXkgPSBudWxsLFxyXG4gICAgICB7IHR5cFRvb2x0aXAgPSBcIk5hY2ggVFlQLUZhcmJlIGVpbmZcdTAwRTRyYmVuXCIsIHN1YnR5cFRvb2x0aXAgPSBcIkZhcmJlIGRlcyBTdWJ0eXBzIHN0YXR0IGRlciBkZXMgVFlQcyB2ZXJ3ZW5kZW5cIiB9ID0ge31cclxuICAgICkgPT5cclxuICAgICAgZ3JvdXAuYWRkU2V0dGluZygoc2V0dGluZykgPT4ge1xyXG4gICAgICAgIHNldHRpbmcuc2V0TmFtZShuYW1lKS5zZXREZXNjKGRlc2MpO1xyXG4gICAgICAgIGNvbnN0IHNhdmUgPSBhc3luYyAoc2V0dGluZ0tleSwgdmFsdWUpID0+IHtcclxuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Nbc2V0dGluZ0tleV0gPSB2YWx1ZTtcclxuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgaWYgKCFzdWJ0eXBLZXkpIHtcclxuICAgICAgICAgIHNldHRpbmcuYWRkVG9nZ2xlKCh0b2dnbGUpID0+IHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzW2tleV0pLm9uQ2hhbmdlKCh2YWx1ZSkgPT4gc2F2ZShrZXksIHZhbHVlKSkpO1xyXG4gICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgc2V0dGluZy5zZXR0aW5nRWwuYWRkQ2xhc3MoXCJmcmVkLW5vdGUtdGl0bGUtc2V0dGluZ1wiKTtcclxuICAgICAgICBjb25zdCBhZGRSb3cgPSAobGFiZWwsIHRvb2x0aXAsIHNldHRpbmdLZXksIG9uQ2hhbmdlZCkgPT4ge1xyXG4gICAgICAgICAgY29uc3Qgcm93ID0gc2V0dGluZy5jb250cm9sRWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtbm90ZS10aXRsZS10b2dnbGUtcm93XCIgfSk7XHJcbiAgICAgICAgICByb3cuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLW5vdGUtdGl0bGUtdG9nZ2xlLWxhYmVsXCIsIHRleHQ6IGxhYmVsIH0pO1xyXG4gICAgICAgICAgbmV3IFRvZ2dsZUNvbXBvbmVudChyb3cpXHJcbiAgICAgICAgICAgIC5zZXRUb29sdGlwKHRvb2x0aXApXHJcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzW3NldHRpbmdLZXldKVxyXG4gICAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgICAgICAgYXdhaXQgc2F2ZShzZXR0aW5nS2V5LCB2YWx1ZSk7XHJcbiAgICAgICAgICAgICAgb25DaGFuZ2VkPy4oKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfTtcclxuICAgICAgICBhZGRSb3coXCJUWVBcIiwgdHlwVG9vbHRpcCwga2V5LCAoKSA9PiB0aGlzLmRpc3BsYXkoKSk7XHJcbiAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Nba2V5XSkgYWRkUm93KFwiU3VidHlwXCIsIHN1YnR5cFRvb2x0aXAsIHN1YnR5cEtleSk7XHJcbiAgICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGNvbG9yaW5nR3JvdXAgPSBuZXcgU2V0dGluZ0dyb3VwKGNvbnRhaW5lckVsKS5zZXRIZWFkaW5nKFwiRWluZlx1MDBFNHJidW5nXCIpO1xyXG5cclxuICAgIGNvbG9yVmlld1RvZ2dsZShjb2xvcmluZ0dyb3VwLCBcImZpbGVFeHBsb3JlclwiLCBcIkRhdGVpLUV4cGxvcmVyXCIsIFwiTm90aXpuYW1lbiBpbSBEYXRlaS1FeHBsb3JlciBuYWNoIFRZUCBlaW5mXHUwMEU0cmJlbi5cIiwgXCJmaWxlRXhwbG9yZXJTdWJ0eXBcIik7XHJcbiAgICBjb2xvclZpZXdUb2dnbGUoY29sb3JpbmdHcm91cCwgXCJncmFwaFwiLCBcIkdyYXBoXCIsIFwiS25vdGVuIGltIEdyYXBoIChnbG9iYWwgdW5kIGxva2FsKSBuYWNoIFRZUCBlaW5mXHUwMEU0cmJlbi5cIiwgXCJncmFwaFN1YnR5cFwiKTtcclxuICAgIGNvbG9yVmlld1RvZ2dsZShjb2xvcmluZ0dyb3VwLCBcInNlYXJjaFwiLCBcIlN1Y2hlXCIsIFwiVHJlZmZlci1UaXRlbCBpbiBkZXIgU3VjaGUgbmFjaCBUWVAgZWluZlx1MDBFNHJiZW4uXCIsIFwic2VhcmNoU3VidHlwXCIpO1xyXG4gICAgY29sb3JWaWV3VG9nZ2xlKGNvbG9yaW5nR3JvdXAsIFwicmVjZW50RmlsZXNcIiwgXCJSZWNlbnQgRmlsZXNcIiwgXCJFaW50clx1MDBFNGdlIGltIFJlY2VudC1GaWxlcy1QbHVnaW4gbmFjaCBUWVAgZWluZlx1MDBFNHJiZW4uXCIsIFwicmVjZW50RmlsZXNTdWJ0eXBcIik7XHJcbiAgICBjb2xvclZpZXdUb2dnbGUoXHJcbiAgICAgIGNvbG9yaW5nR3JvdXAsXHJcbiAgICAgIFwibGlua3NcIixcclxuICAgICAgXCJMaW5rcyBpbiBOb3RpemVuXCIsXHJcbiAgICAgIFwiSW50ZXJuZSBMaW5rcyBpbSBOb3RpenRleHQgKExlc2UtTW9kdXMsIExpdmUgUHJldmlldywgSG92ZXItVm9yc2NoYXUpIGluIGRlciBGYXJiZSBkZXMgVFlQcyBpaHJlcyBaaWVscyBkYXJzdGVsbGVuLiBOaWNodCBhdWZnZWxcdTAwRjZzdGUgTGlua3MgYmxlaWJlbiB1bnZlclx1MDBFNG5kZXJ0LlwiLFxyXG4gICAgICBcImxpbmtzU3VidHlwXCJcclxuICAgICk7XHJcbiAgICBjb2xvclZpZXdUb2dnbGUoXHJcbiAgICAgIGNvbG9yaW5nR3JvdXAsXHJcbiAgICAgIFwidHlwTGlzdFwiLFxyXG4gICAgICBcIlRZUCBWaWV3XCIsXHJcbiAgICAgIFwiVHlwLU5hbWVuIGluIGRlciBUWVAtVmlldyBzZWxic3QgKExpc3RlIHVuZCBEZXRhaWxhbnNpY2h0KSB1bmQgaW0gVFlQLVBpY2tlciBpbiBpaHJlciBqZXdlaWxpZ2VuIEZhcmJlIGRhcnN0ZWxsZW4uIE1pdCBcXFwiU3VidHlwXFxcIiBhdWNoIGRpZSBTdWJ0eXBlbiBpbiBpaHJlciBlaWdlbmVuIEZhcmJlLlwiLFxyXG4gICAgICBcInR5cExpc3RTdWJ0eXBcIlxyXG4gICAgKTtcclxuICAgIGNvbG9yVmlld1RvZ2dsZShcclxuICAgICAgY29sb3JpbmdHcm91cCxcclxuICAgICAgXCJub3RlVGl0bGVDb2xvclwiLFxyXG4gICAgICBcIlRpdGVsLVRleHQgZWluZlx1MDBFNHJiZW5cIixcclxuICAgICAgXCJGXHUwMEU0cmJ0IGRlbiBJbmxpbmUtVGl0ZWwgZGVyIGdlXHUwMEY2ZmZuZXRlbiBOb3RpeiBzZWxic3QgaW4gZGVyIEZhcmJlIGlocmVzIFRZUHMgZWluIC0gdW5hYmhcdTAwRTRuZ2lnIHZvbiBkZXIgVFlQLU1hcmtpZXJ1bmcgZGFuZWJlbiAocy4gdS4pLCBiZWlkZXMgbFx1MDBFNHNzdCBzaWNoIGtvbWJpbmllcmVuLlwiLFxyXG4gICAgICBcIm5vdGVUaXRsZUNvbG9yU3VidHlwXCJcclxuICAgICk7XHJcblxyXG4gICAgLy8gUHJvZ3Jlc3NpdmUgT2ZmZW5sZWd1bmc6IGJlaSBub3RlVGl0bGVTdHlsZSBcImJhZGdlXCIga29tbWVuIHdlaXRlcmVcclxuICAgIC8vIFNjaGFsdGVyIGRpcmVrdCBpbiBkaWVzZXIgZWluZW4gU2V0dGluZy1aZWlsZSBkYXp1IChGYXJiZSwgUG9zaXRpb24pLFxyXG4gICAgLy8gYmVpIFBvc2l0aW9uIFwiYmxvY2tcIiBub2NoIGVpbiBkcml0dGVyIChBdXNyaWNodHVuZykgLSBqZXdlaWxzIHBlclxyXG4gICAgLy8gdGhpcy5kaXNwbGF5KCkgbmV1IGdlcmVuZGVydCwgZGFtaXQgbnVyIGRpZSBnZXJhZGUgcmVsZXZhbnRlbiBTY2hhbHRlclxyXG4gICAgLy8gZXJzY2hlaW5lbiwgc3RhdHQgcGVybWFuZW50IGFsbGUgYW56dXplaWdlbiBiencuIGVpZ2VuZSBaZWlsZW4genUgYmVsZWdlbi5cclxuICAgIGNvbnN0IGlzQmFkZ2UgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVTdHlsZSA9PT0gXCJiYWRnZVwiO1xyXG4gICAgY29uc3QgaXNCbG9ja1Bvc2l0aW9uID0gdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VQb3NpdGlvbiA9PT0gXCJibG9ja1wiO1xyXG5cclxuICAgIGNvbG9yaW5nR3JvdXAuYWRkU2V0dGluZygobm90ZVRpdGxlU2V0dGluZykgPT4ge1xyXG4gICAgICBub3RlVGl0bGVTZXR0aW5nXHJcbiAgICAgICAgLnNldE5hbWUoXCJUWVAtTWFya2llcnVuZyBpbiBkZXIgTm90aXpcIilcclxuICAgICAgICAuc2V0RGVzYyhcclxuICAgICAgICAgIGlzQmFkZ2VcclxuICAgICAgICAgICAgPyAnXCJCb3ggbWl0IFRZUC1OYW1lblwiIC0gQmVzY2hyaWZ0dW5nLCBTY2hhbHRlcjogZmFyYmlnL25ldXRyYWwsIGFtIFRpdGVsL2FtIFByb3BlcnR5LUJsb2NrIChnZWRyZWh0KScgK1xyXG4gICAgICAgICAgICAgICAgKGlzQmxvY2tQb3NpdGlvbiA/IFwiLCBvYmVuL3VudGVuIGFtIFByb3BlcnR5LUJsb2NrXCIgOiBcIlwiKSArXHJcbiAgICAgICAgICAgICAgICBcIi5cIlxyXG4gICAgICAgICAgICA6IFwiV2llIGRlciBUWVAgaW4gZGVyIGdlXHUwMEY2ZmZuZXRlbiBOb3RpeiBtYXJraWVydCB3aXJkLlwiXHJcbiAgICAgICAgKVxyXG4gICAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XHJcbiAgICAgICAgICBkcm9wZG93blxyXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwibm9uZVwiLCBcIk5pY2h0c1wiKVxyXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwiZG90XCIsIFwiRmFyYnB1bmt0IGFtIFRpdGVsXCIpXHJcbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJiYWRnZVwiLCBcIkJveCBtaXQgVFlQLU5hbWVuXCIpXHJcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVTdHlsZSlcclxuICAgICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVN0eWxlID0gdmFsdWU7XHJcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbiAgICAgICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XHJcbiAgICAgICAgICAgIH0pXHJcbiAgICAgICAgKTtcclxuXHJcbiAgICAgIC8vIFwiU3VidHlwXCIgKEZhcmJlIGRlcyBTdWJ0eXBzIHN0YXR0IGRlciBkZXMgVFlQcykgbnVyLCBzb2xhbmdlIGRpZVxyXG4gICAgICAvLyBNYXJraWVydW5nIFx1MDBGQ2JlcmhhdXB0IGZhcmJpZyBpc3Q6IGJlaW0gUHVua3QgaW1tZXIsIGJlaSBkZXIgQm94IG51clxyXG4gICAgICAvLyBtaXQgXCJGYXJiaWdcIiB1bmQgQmVzY2hyaWZ0dW5nIFtUWVAvU3VidHlwXSAtIGJlaSBbVFlQXSBiencuIFtTdWJ0eXBdXHJcbiAgICAgIC8vIGZvbGd0IGRpZSBGYXJiZSBkZXIgQmVzY2hyaWZ0dW5nLlxyXG4gICAgICBjb25zdCBiYWRnZUxhYmVsID0gdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VMYWJlbCA/PyBcInR5cGVcIjtcclxuICAgICAgY29uc3Qgc2hvd1N1YnR5cCA9XHJcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlU3R5bGUgPT09IFwiZG90XCIgfHxcclxuICAgICAgICAoaXNCYWRnZSAmJiB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUNvbG9yZWQgJiYgYmFkZ2VMYWJlbCA9PT0gXCJ0eXBlLXN1YnR5cGVcIik7XHJcbiAgICAgIGlmICghaXNCYWRnZSAmJiAhc2hvd1N1YnR5cCkgcmV0dXJuO1xyXG5cclxuICAgICAgLy8gRWlnZW5lIEtsYXNzZSwgZGFtaXQgZGllIGJlaSBcImJhZGdlXCIgenVzXHUwMEU0dHpsaWNoIGFuZ2VoXHUwMEU0bmd0ZW4gU2NoYWx0ZXJcclxuICAgICAgLy8gc3RhdHQgbmViZW5laW5hbmRlciAoT2JzaWRpYW5zIFN0YW5kYXJkLUxheW91dCBmXHUwMEZDciBtZWhyZXJlIENvbnRyb2xzIGluXHJcbiAgICAgIC8vIGVpbmVyIFNldHRpbmctWmVpbGUpIHVudGVyZWluYW5kZXIgc3RlaGVuIC0gc2llaGVcclxuICAgICAgLy8gLmZyZWQtbm90ZS10aXRsZS1zZXR0aW5nIGluIHN0eWxlcy5jc3MuXHJcbiAgICAgIG5vdGVUaXRsZVNldHRpbmcuc2V0dGluZ0VsLmFkZENsYXNzKFwiZnJlZC1ub3RlLXRpdGxlLXNldHRpbmdcIik7XHJcblxyXG4gICAgICAvLyBFaWdlbmVzIGtsZWluZXMgTGFiZWwgamUgU2NoYWx0ZXIgc3RhdHQgbnVyIFRvb2x0aXAgLSBhZGRUb2dnbGUoKSBhbGxlaW5cclxuICAgICAgLy8gaFx1MDBFNG5ndCBudXIgZGVuIG5hY2t0ZW4gU2NoYWx0ZXIgb2huZSBCZXNjaHJpZnR1bmcgYW4sIGRhaGVyIGhpZXIgZWluZVxyXG4gICAgICAvLyBlaWdlbmUgWmVpbGUgKExhYmVsICsgVG9nZ2xlQ29tcG9uZW50KSBkaXJla3QgaW4gY29udHJvbEVsIGdlYmF1dC5cclxuICAgICAgY29uc3QgYWRkTGFiZWxlZFRvZ2dsZSA9IChsYWJlbCwgdG9vbHRpcCwgdmFsdWUsIG9uQ2hhbmdlKSA9PiB7XHJcbiAgICAgICAgY29uc3Qgcm93ID0gbm90ZVRpdGxlU2V0dGluZy5jb250cm9sRWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtbm90ZS10aXRsZS10b2dnbGUtcm93XCIgfSk7XHJcbiAgICAgICAgcm93LmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC1ub3RlLXRpdGxlLXRvZ2dsZS1sYWJlbFwiLCB0ZXh0OiBsYWJlbCB9KTtcclxuICAgICAgICBuZXcgVG9nZ2xlQ29tcG9uZW50KHJvdykuc2V0VG9vbHRpcCh0b29sdGlwKS5zZXRWYWx1ZSh2YWx1ZSkub25DaGFuZ2Uob25DaGFuZ2UpO1xyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgYWRkU3VidHlwVG9nZ2xlID0gKGxhYmVsKSA9PlxyXG4gICAgICAgIGFkZExhYmVsZWRUb2dnbGUoXHJcbiAgICAgICAgICBsYWJlbCxcclxuICAgICAgICAgIFwiRmFyYmUgZGVzIFN1YnR5cHMgc3RhdHQgZGVyIGRlcyBUWVBzIHZlcndlbmRlblwiLFxyXG4gICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5ub3RlVGl0bGVNYXJrZXJTdWJ0eXAsXHJcbiAgICAgICAgICBhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5ub3RlVGl0bGVNYXJrZXJTdWJ0eXAgPSB2YWx1ZTtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICk7XHJcblxyXG4gICAgICBpZiAoIWlzQmFkZ2UpIHtcclxuICAgICAgICBhZGRTdWJ0eXBUb2dnbGUoXCJTdWJ0eXBcIik7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCBsYWJlbFJvdyA9IG5vdGVUaXRsZVNldHRpbmcuY29udHJvbEVsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLW5vdGUtdGl0bGUtdG9nZ2xlLXJvd1wiIH0pO1xyXG4gICAgICBsYWJlbFJvdy5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtbm90ZS10aXRsZS10b2dnbGUtbGFiZWxcIiwgdGV4dDogXCJCZXNjaHJpZnR1bmdcIiB9KTtcclxuICAgICAgbmV3IERyb3Bkb3duQ29tcG9uZW50KGxhYmVsUm93KVxyXG4gICAgICAgIC5hZGRPcHRpb24oXCJ0eXBlXCIsIFwiW1RZUF1cIilcclxuICAgICAgICAuYWRkT3B0aW9uKFwidHlwZS1zdWJ0eXBlXCIsIFwiW1RZUC9TdWJ0eXBdXCIpXHJcbiAgICAgICAgLmFkZE9wdGlvbihcInN1YnR5cGVcIiwgXCJbU3VidHlwXVwiKVxyXG4gICAgICAgIC5zZXRWYWx1ZShiYWRnZUxhYmVsKVxyXG4gICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlTGFiZWwgPSB2YWx1ZTtcclxuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbiAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgIGFkZExhYmVsZWRUb2dnbGUoXCJGYXJiaWdcIiwgXCJGYXJiaWcgKFRZUC1GYXJiZSkgc3RhdHQgbmV1dHJhbFwiLCB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUNvbG9yZWQsIGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlQ29sb3JlZCA9IHZhbHVlO1xyXG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgICAgIHRoaXMuZGlzcGxheSgpO1xyXG4gICAgICB9KTtcclxuICAgICAgaWYgKHNob3dTdWJ0eXApIGFkZFN1YnR5cFRvZ2dsZShcIlN1YnR5cC1GYXJiZVwiKTtcclxuXHJcbiAgICAgIGFkZExhYmVsZWRUb2dnbGUoXCJBbSBQcm9wZXJ0eS1CbG9ja1wiLCBcIkFtIFByb3BlcnR5LUJsb2NrIChnZWRyZWh0KSBzdGF0dCBhbSBUaXRlbFwiLCBpc0Jsb2NrUG9zaXRpb24sIGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlUG9zaXRpb24gPSB2YWx1ZSA/IFwiYmxvY2tcIiA6IFwidGl0bGVcIjtcclxuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgICAgICB0aGlzLmRpc3BsYXkoKTtcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBpZiAoaXNCbG9ja1Bvc2l0aW9uKSB7XHJcbiAgICAgICAgYWRkTGFiZWxlZFRvZ2dsZShcclxuICAgICAgICAgIFwiT2JlbiBzdGF0dCB1bnRlblwiLFxyXG4gICAgICAgICAgXCJPYmVuIHN0YXR0IHVudGVuIGFtIFByb3BlcnR5LUJsb2NrXCIsXHJcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVWZXJ0aWNhbEFsaWduID09PSBcInRvcFwiLFxyXG4gICAgICAgICAgYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVZlcnRpY2FsQWxpZ24gPSB2YWx1ZSA/IFwidG9wXCIgOiBcImJvdHRvbVwiO1xyXG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgY29sb3JWaWV3VG9nZ2xlKFxyXG4gICAgICBjb2xvcmluZ0dyb3VwLFxyXG4gICAgICBcImJhY2tsaW5rc1wiLFxyXG4gICAgICBcIkJhY2tsaW5rc1wiLFxyXG4gICAgICBcIlRyZWZmZXJ6ZWlsZW4gaW0gQmFja2xpbmtzLVBhbmUgc293aWUgaW4gZGVuIGltIERva3VtZW50IGVpbmdlYmV0dGV0ZW4gQmFja2xpbmtzIChpbmtsLiBuaWNodCB2ZXJsaW5rdGVyIEVyd1x1MDBFNGhudW5nZW4pIG5hY2ggVFlQIGVpbmZcdTAwRTRyYmVuLlwiLFxyXG4gICAgICBcImJhY2tsaW5rc1N1YnR5cFwiXHJcbiAgICApO1xyXG4gICAgY29sb3JWaWV3VG9nZ2xlKFxyXG4gICAgICBjb2xvcmluZ0dyb3VwLFxyXG4gICAgICBcImJvb2ttYXJrc1wiLFxyXG4gICAgICBcIkJvb2ttYXJrc1wiLFxyXG4gICAgICBcIkVpbnRyXHUwMEU0Z2UgaW0gQm9va21hcmtzLVBhbmUsIGRpZSBkaXJla3QgYXVmIGVpbmUgTm90aXogemVpZ2VuLCBuYWNoIFRZUCBlaW5mXHUwMEU0cmJlbi5cIixcclxuICAgICAgXCJib29rbWFya3NTdWJ0eXBcIlxyXG4gICAgKTtcclxuICAgIGNvbG9yVmlld1RvZ2dsZShcclxuICAgICAgY29sb3JpbmdHcm91cCxcclxuICAgICAgXCJhbGxQcm9wZXJ0aWVzXCIsXHJcbiAgICAgIFwiQWxsIFByb3BlcnRpZXNcIixcclxuICAgICAgXCJJbiBPYnNpZGlhbnMgdmF1bHQtd2VpdGVyIFxcXCJBbGwgUHJvcGVydGllc1xcXCItQW5zaWNodCBQcm9wZXJ0eS1OYW1lbiBlaW5mXHUwMEU0cmJlbiwgZGllIGltIFRZUC1Gcm9udG1hdHRlciBnZW5hdSBlaW5lcyBUWVBzIHZvcmtvbW1lbiAoaW4gZGVzc2VuIEZhcmJlKSAtIGtvbW1lbiBzaWUgYmVpIG1laHJlcmVuIFRZUHMgdm9yLCBzdGF0dGRlc3NlbiBmZXR0IHN0YXR0IGVpbmdlZlx1MDBFNHJidC4gTWl0IFxcXCJTdWJ0eXBcXFwiIHpcdTAwRTRobGVuIGF1Y2ggZGllIEZyb250bWF0dGVyLUJsXHUwMEY2Y2tlIGRlciBTdWJ0eXBlbiBmXHUwMEZDciBpaHJlbiBqZXdlaWxpZ2VuIFRZUCwgZWluZ2VmXHUwMEU0cmJ0IGluIGRlciBGYXJiZSBkZXMgU3VidHlwcy5cIixcclxuICAgICAgXCJhbGxQcm9wZXJ0aWVzU3VidHlwXCIsXHJcbiAgICAgIHsgdHlwVG9vbHRpcDogXCJUWVAtRnJvbnRtYXR0ZXIgZGVyIFRZUGVuXCIsIHN1YnR5cFRvb2x0aXA6IFwiRnJvbnRtYXR0ZXItQmxcdTAwRjZja2UgZGVyIFN1YnR5cGVuIG1pdCBlaW5iZXppZWhlbiwgaW4gU3VidHlwLUZhcmJlXCIgfVxyXG4gICAgKTtcclxuXHJcbiAgICAvLyBHcmVuemVuIGRlciBkcmVpIFJlZ2xlciwgbWl0IGRlbmVuIGVpbiBTdWJ0eXAgc2VpbmUgRmFyYmUgdm9uIGRlciBzZWluZXNcclxuICAgIC8vIFRZUHMgYWJsZWl0ZXQgKEZhcmJwdW5rdCB1bnRlbiBpbSBTdWJ0eXAtQmxvY2sgZGVyIFRZUC1EZXRhaWxhbnNpY2h0LFxyXG4gICAgLy8gc2llaGUgdHlwZS1jb2xvcnMuanMpLiBFaW5lIHNjaG9uIGVpbmdlc3RlbGx0ZSwgZ3JcdTAwRjZcdTAwREZlcmUgQWJ3ZWljaHVuZyB3aXJkXHJcbiAgICAvLyBhdWYgZGllIG5ldWUgR3JlbnplIGdla2FwcHQuXHJcbiAgICBjb25zdCBzdWJ0eXBlQ29sb3JHcm91cCA9IG5ldyBTZXR0aW5nR3JvdXAoY29udGFpbmVyRWwpLnNldEhlYWRpbmcoXCJTdWJ0eXAtRmFyYmVuXCIpO1xyXG4gICAgY29uc3QgcmFuZ2VNYXggPSB7IGg6IDE4MCwgLyogczogMTAwLCAqLyBsOiAxMDAgfTtcclxuICAgIGNvbnN0IHJhbmdlRGVzYyA9IHtcclxuICAgICAgaDogXCJXaWUgd2VpdCBkZXIgRmFyYnRvbiBlaW5lcyBTdWJ0eXBzIGhcdTAwRjZjaHN0ZW5zIHZvbiBkZW0gc2VpbmVzIFRZUHMgYWJ3ZWljaGVuIGRhcmYgKFx1MDBCMSBHcmFkKS5cIixcclxuICAgICAgLy8gczogXCJXaWUgYmxhc3MgZWluIFN1YnR5cCBnZWdlblx1MDBGQ2JlciBzZWluZW0gVFlQIGhcdTAwRjZjaHN0ZW5zIHdlcmRlbiBkYXJmIChQcm96ZW50IGRlciBUWVAtU1x1MDBFNHR0aWd1bmcpLiBEZXIgUmVnbGVyIGdlaHQgbnVyIG5hY2ggdW50ZW4gLSBrclx1MDBFNGZ0aWdlciBhbHMgZGllIEhhdXB0ZmFyYmUgc29sbCBlaW4gU3VidHlwIG5pY2h0IHdlcmRlbi5cIixcclxuICAgICAgbDogXCJXaWUgd2VpdCBkaWUgSGVsbGlna2VpdCBlaW5lcyBTdWJ0eXBzIGhcdTAwRjZjaHN0ZW5zIHZvbiBkZXIgc2VpbmVzIFRZUHMgYWJ3ZWljaGVuIGRhcmYgKFx1MDBCMSBQcm96ZW50IGRlcyBXZWdzIHp1IFdlaVx1MDBERiBiencuIFNjaHdhcnogLSAxMDAgJSB3XHUwMEU0cmUgcmVpbmVzIFdlaVx1MDBERiBiencuIFNjaHdhcnopLlwiLFxyXG4gICAgfTtcclxuICAgIC8vIERlciBSZWdsZXIgbWVsZGV0IGplZGUgWndpc2NoZW5zdGVsbHVuZyAtIGRpZSBcdTAwRkNicmlnZW4gQW5zaWNodGVuIGVyc3RcclxuICAgIC8vIG5hY2h6aWVoZW4sIHdlbm4gZXIga3VyeiBydWh0LlxyXG4gICAgY29uc3QgcmVmcmVzaENvbG9yc1Nvb24gPSBkZWJvdW5jZSgoKSA9PiB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKSwgMzAwLCB0cnVlKTtcclxuICAgIGZvciAoY29uc3QgeyBrZXksIGxhYmVsLCB1bml0LCBkb3duT25seSB9IG9mIFNVQlRZUEVfQ09MT1JfQ0hBTk5FTFMpIHtcclxuICAgICAgc3VidHlwZUNvbG9yR3JvdXAuYWRkU2V0dGluZygoc2V0dGluZykgPT5cclxuICAgICAgICBzZXR0aW5nXHJcbiAgICAgICAgICAuc2V0TmFtZShgJHtsYWJlbH0gKCR7ZG93bk9ubHkgPyBcIlx1MjIxMlwiIDogXCJcdTAwQjFcIn0gJHt1bml0fSlgKVxyXG4gICAgICAgICAgLnNldERlc2MocmFuZ2VEZXNjW2tleV0pXHJcbiAgICAgICAgICAuYWRkU2xpZGVyKChzbGlkZXIpID0+XHJcbiAgICAgICAgICAgIHNsaWRlclxyXG4gICAgICAgICAgICAgIC5zZXRMaW1pdHMoMCwgcmFuZ2VNYXhba2V5XSwgMSlcclxuICAgICAgICAgICAgICAuc2V0VmFsdWUoY29sb3JSYW5nZSh0aGlzLnBsdWdpbi5zZXR0aW5ncywga2V5KSlcclxuICAgICAgICAgICAgICAuc2V0RHluYW1pY1Rvb2x0aXAoKVxyXG4gICAgICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnN1YnR5cGVDb2xvclJhbmdlcyA9IHsgLi4uREVGQVVMVF9TVUJUWVBFX0NPTE9SX1JBTkdFUywgLi4udGhpcy5wbHVnaW4uc2V0dGluZ3Muc3VidHlwZUNvbG9yUmFuZ2VzLCBba2V5XTogdmFsdWUgfTtcclxuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgICAgICAgICAgcmVmcmVzaENvbG9yc1Nvb24oKTtcclxuICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgKVxyXG4gICAgICAgICAgLmFkZEV4dHJhQnV0dG9uKChidXR0b24pID0+XHJcbiAgICAgICAgICAgIGJ1dHRvblxyXG4gICAgICAgICAgICAgIC5zZXRJY29uKFwicm90YXRlLWNjd1wiKVxyXG4gICAgICAgICAgICAgIC5zZXRUb29sdGlwKGBadXJcdTAwRkNja3NldHplbiBhdWYgJHtERUZBVUxUX1NVQlRZUEVfQ09MT1JfUkFOR0VTW2tleV19YClcclxuICAgICAgICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5zdWJ0eXBlQ29sb3JSYW5nZXMgPSB7IC4uLkRFRkFVTFRfU1VCVFlQRV9DT0xPUl9SQU5HRVMsIC4uLnRoaXMucGx1Z2luLnNldHRpbmdzLnN1YnR5cGVDb2xvclJhbmdlcywgW2tleV06IERFRkFVTFRfU1VCVFlQRV9DT0xPUl9SQU5HRVNba2V5XSB9O1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xyXG4gICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICApXHJcbiAgICAgICk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gR3J1cHBlIFwiR3JhcGhcIiAoVGFnLS9BbmhcdTAwRTRuZ2UtRmFyYmUpIGRlYWt0aXZpZXJ0ICgzMC4wOS4yMDI2KTogYmVpZGVzIGlzdCBpbVxyXG4gICAgLy8gTWluaW1hbCBUaGVtZSBcdTAwRkNiZXIgZGllIFN0eWxlIFNldHRpbmdzIGVpbnN0ZWxsYmFyLCBzaWVoZSBncmFwaC1jb2xvcnMuanMuXHJcbiAgICAvLyBEaWUgVFlQLUVpbmZcdTAwRTRyYnVuZyBkZXIgTm90aXotS25vdGVuIGJsZWlidCBha3RpdiwgU2NoYWx0ZXIgb2JlbiB1bnRlclxyXG4gICAgLy8gXCJFaW5mXHUwMEU0cmJ1bmdcIiBcdTIxOTIgXCJHcmFwaFwiLlxyXG4gICAgLy8gICAgIGNvbnN0IGdyYXBoR3JvdXAgPSBuZXcgU2V0dGluZ0dyb3VwKGNvbnRhaW5lckVsKS5zZXRIZWFkaW5nKFwiR3JhcGhcIik7XHJcbiAgICAvL1xyXG4gICAgLy8gICAgIC8vIEVpbiBTZXR0aW5nIHBybyBOb2RlLVR5cCwgZGVuIE9ic2lkaWFucyBHcmFwaC1FbmdpbmUga2VubnQgLSBnbGVpY2hlclxyXG4gICAgLy8gICAgIC8vIEF1ZmJhdSAoVG9nZ2xlICsgRmFyYndhaGwgKyBadXJcdTAwRkNja3NldHplbikgZlx1MDBGQ3IgamVkZW4sIGRhaGVyIGFscyBIZWxwZXJcclxuICAgIC8vICAgICAvLyBzdGF0dCBkdXBsaXppZXJ0LlxyXG4gICAgLy8gICAgIGNvbnN0IGdyYXBoQ29sb3JTZXR0aW5nID0gKGVuYWJsZWRLZXksIGNvbG9yS2V5LCBkZWZhdWx0Q29sb3IsIG5hbWUsIGRlc2MpID0+XHJcbiAgICAvLyAgICAgICBncmFwaEdyb3VwLmFkZFNldHRpbmcoKHNldHRpbmcpID0+XHJcbiAgICAvLyAgICAgICAgIHNldHRpbmdcclxuICAgIC8vICAgICAgICAgICAuc2V0TmFtZShuYW1lKVxyXG4gICAgLy8gICAgICAgICAgIC5zZXREZXNjKGRlc2MpXHJcbiAgICAvLyAgICAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxyXG4gICAgLy8gICAgICAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzW2VuYWJsZWRLZXldKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgIC8vICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3NbZW5hYmxlZEtleV0gPSB2YWx1ZTtcclxuICAgIC8vICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAvLyAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgLy8gICAgICAgICAgICAgfSlcclxuICAgIC8vICAgICAgICAgICApXHJcbiAgICAvLyAgICAgICAgICAgLmFkZENvbG9yUGlja2VyKChwaWNrZXIpID0+XHJcbiAgICAvLyAgICAgICAgICAgICBwaWNrZXIuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3NbY29sb3JLZXldIHx8IGRlZmF1bHRDb2xvcikub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAvLyAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzW2NvbG9yS2V5XSA9IHZhbHVlO1xyXG4gICAgLy8gICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgIC8vICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbiAgICAvLyAgICAgICAgICAgICB9KVxyXG4gICAgLy8gICAgICAgICAgIClcclxuICAgIC8vICAgICAgICAgICAuYWRkRXh0cmFCdXR0b24oKGJ1dHRvbikgPT5cclxuICAgIC8vICAgICAgICAgICAgIGJ1dHRvblxyXG4gICAgLy8gICAgICAgICAgICAgICAuc2V0SWNvbihcInJvdGF0ZS1jY3dcIilcclxuICAgIC8vICAgICAgICAgICAgICAgLnNldFRvb2x0aXAoXCJadXJcdTAwRkNja3NldHplbiBhdWYgU3RhbmRhcmRmYXJiZVwiKVxyXG4gICAgLy8gICAgICAgICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XHJcbiAgICAvLyAgICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3NbY29sb3JLZXldID0gXCJcIjtcclxuICAgIC8vICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgIC8vICAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgIC8vICAgICAgICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcclxuICAgIC8vICAgICAgICAgICAgICAgfSlcclxuICAgIC8vICAgICAgICAgICApXHJcbiAgICAvLyAgICAgICApO1xyXG4gICAgLy9cclxuICAgIC8vICAgICBncmFwaENvbG9yU2V0dGluZyhcclxuICAgIC8vICAgICAgIFwiZ3JhcGhUYWdDb2xvckVuYWJsZWRcIixcclxuICAgIC8vICAgICAgIFwiZ3JhcGhUYWdDb2xvclwiLFxyXG4gICAgLy8gICAgICAgXCIjODg4ODg4XCIsXHJcbiAgICAvLyAgICAgICBcIlRhZy1GYXJiZVwiLFxyXG4gICAgLy8gICAgICAgXCJFaWdlbmUgRmFyYmUgZlx1MDBGQ3IgVGFnLUtub3RlbiBpbSBHcmFwaCAoZ2xvYmFsIHVuZCBsb2thbCkgdmVyd2VuZGVuIHN0YXR0IGRlciBTdGFuZGFyZGZhcmJlLiBFaWdlbmUgRmFyYmdydXBwZW4gaW0gR3JhcGggaGFiZW4gd2VpdGVyaGluIFZvcnJhbmcuXCJcclxuICAgIC8vICAgICApO1xyXG4gICAgLy8gICAgIGdyYXBoQ29sb3JTZXR0aW5nKFxyXG4gICAgLy8gICAgICAgXCJncmFwaEF0dGFjaG1lbnRDb2xvckVuYWJsZWRcIixcclxuICAgIC8vICAgICAgIFwiZ3JhcGhBdHRhY2htZW50Q29sb3JcIixcclxuICAgIC8vICAgICAgIFwiI2UwYWMwMFwiLFxyXG4gICAgLy8gICAgICAgXCJBbmhcdTAwRTRuZ2UtRmFyYmVcIixcclxuICAgIC8vICAgICAgIFwiRWlnZW5lIEZhcmJlIGZcdTAwRkNyIEFuaGFuZy1Lbm90ZW4gKE5pY2h0LU1hcmtkb3duLURhdGVpZW4gd2llIEJpbGRlciBvZGVyIFBERnMpIGltIEdyYXBoIHZlcndlbmRlbiBzdGF0dCBkZXIgU3RhbmRhcmRmYXJiZS5cIlxyXG4gICAgLy8gICAgICk7XHJcblxyXG4gICAgY29uc3QgZnJvbnRtYXR0ZXJHcm91cCA9IG5ldyBTZXR0aW5nR3JvdXAoY29udGFpbmVyRWwpLnNldEhlYWRpbmcoXCJUWVAtRnJvbnRtYXR0ZXJcIik7XHJcblxyXG4gICAgY29sb3JWaWV3VG9nZ2xlKFxyXG4gICAgICBmcm9udG1hdHRlckdyb3VwLFxyXG4gICAgICBcImZyb250bWF0dGVyRGVmYXVsdHNcIixcclxuICAgICAgXCJQcm9wZXJ0eS1OYW1lbiBmZXR0IG1hcmtpZXJlblwiLFxyXG4gICAgICBcIkluIE5vdGl6ZW4gKEZyb250bWF0dGVyIGltIERva3VtZW50IHNvd2llIFByb3BlcnRpZXMtU2VpdGVubGVpc3RlKSBkaWUgTmFtZW4gZGVyIFByb3BlcnRpZXMgZmV0dCBkYXJzdGVsbGVuLCBkaWUgaW0gVFlQLUZyb250bWF0dGVyIGRlcyBqZXdlaWxpZ2VuIFRZUHMgaGludGVybGVndCBzaW5kLiBNaXQgXFxcIlN1YnR5cFxcXCIgenVzXHUwMEU0dHpsaWNoIGRpZSBhdXMgZGVtIEZyb250bWF0dGVyLUJsb2NrIGlocmVzIFNVQlRZUHMuXCIsXHJcbiAgICAgIFwiZnJvbnRtYXR0ZXJEZWZhdWx0c1N1YnR5cFwiLFxyXG4gICAgICB7IHR5cFRvb2x0aXA6IFwiVFlQLUZyb250bWF0dGVyIGRlciBUWVBlblwiLCBzdWJ0eXBUb29sdGlwOiBcIkZyb250bWF0dGVyLUJsXHUwMEY2Y2tlIGRlciBTdWJ0eXBlbiBtaXQgZWluYmV6aWVoZW5cIiB9XHJcbiAgICApO1xyXG5cclxuICAgIC8vIE9yZGVyLUVkaXRvciBzYW10IEJlc2NocmVpYnVuZyBhbHMgZWlnZW5lciBFaW50cmFnIGRlcnNlbGJlbiBHcnVwcGUgLVxyXG4gICAgLy8gYnJpbmd0IFx1MDBEQ2JlcnNjaHJpZnQgdW5kIEJ1dHRvbnMgc2VsYnN0IG1pdCwgZGFoZXIgZGlyZWt0IGluIGluZm9FbCBzdGF0dFxyXG4gICAgLy8gXHUwMEZDYmVyIHNldE5hbWUvc2V0RGVzYyAoc2llaGUgLmZyZWQtb3JkZXItc2V0dGluZyBpbiBzdHlsZXMuY3NzKS5cclxuICAgIGZyb250bWF0dGVyR3JvdXAuYWRkU2V0dGluZygoc2V0dGluZykgPT4ge1xyXG4gICAgICBzZXR0aW5nLnNldHRpbmdFbC5hZGRDbGFzcyhcImZyZWQtb3JkZXItc2V0dGluZ1wiKTtcclxuICAgICAgbW91bnRHbG9iYWxPcmRlckVkaXRvcihzZXR0aW5nLmluZm9FbCwgdGhpcy5wbHVnaW4pO1xyXG4gICAgICBzZXR0aW5nLmluZm9FbC5jcmVhdGVEaXYoe1xyXG4gICAgICAgIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIixcclxuICAgICAgICB0ZXh0OlxyXG4gICAgICAgICAgJ0Jlc3RpbW10IGRpZSBSZWloZW5mb2xnZSwgaW4gZGVyIGRpZSBCZWZlaGxlIFwiRnJvbnRtYXR0ZXIgU29ydGllcnVuZyBha3R1YWxpc2llcmVuXCIgZGllIGluIGVpbmVyIE5vdGl6IHZvcmhhbmRlbmVuIFByb3BlcnRpZXMgYW5vcmRuZW4gKGVyZ1x1MDBFNG56dCBvZGVyIFx1MDBFNG5kZXJ0IGtlaW5lIFdlcnRlKS4gRWluemVsbmUgUHJvcGVydGllcyAoei4gQi4gY3NzY2xhc3NlcywgYWxpYXNlcykgbGFzc2VuIHNpY2ggZmVzdCBwbGF0emllcmVuIC0gXCJUWVBcIiBpc3QgZGllIFRZUC1Qcm9wZXJ0eSBzZWxic3QsIFwiU1VCVFlQXCIgYW5hbG9nIGRpZSBTVUJUWVAtUHJvcGVydHksIFwiVFlQLUZyb250bWF0dGVyXCIgc3RlaHQgZlx1MDBGQ3IgZGllIFRZUC1Gcm9udG1hdHRlci1MaXN0ZSBkZXMgamV3ZWlsaWdlbiBUeXBzIHNhbXQgZGFoaW50ZXIgZGVtIEJsb2NrIHNlaW5lcyBTVUJUWVBzLCBcIlNvbnN0aWdlIFByb3BlcnRpZXNcIiBmXHUwMEZDciBhbGxlcyBcdTAwRENicmlnZS4gUmVpaGVuZm9sZ2UgcGVyIERyYWcgJiBEcm9wIFx1MDBFNG5kZXJiYXIsIGRpZSB2aWVyIFBsYXR6aGFsdGVyLVplaWxlbiBsYXNzZW4gc2ljaCBuaWNodCBlbnRmZXJuZW4uJyxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBjb250YWluZXJFbC5zY3JvbGxUb3AgPSBzY3JvbGxUb3A7XHJcbiAgfVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IHsgREVGQVVMVF9TRVRUSU5HUywgVHlwU3lzdGVtU2V0dGluZ1RhYiB9O1xyXG4iLCAiY29uc3QgeyBOb3RpY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgc29ydEFsbEZyb250bWF0dGVyLCBzb3J0U2luZ2xlRmlsZUZyb250bWF0dGVyIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1zb3J0XCIpO1xuXG5mdW5jdGlvbiByZWdpc3RlckNvbW1hbmRzKHBsdWdpbikge1xuXG4gIC8vIE9ic2lkaWFuIGF3YWl0ZWQgZGVuIGNhbGxiYWNrIGVpbmVyIEJlZmVobHNkZWZpbml0aW9uIG5pY2h0IHVuZCBmXHUwMEU0bmd0IGF1Y2hcbiAgLy8ga2VpbmUgRmVobGVyIGFiIC0gZWluZSBFeGNlcHRpb24gZGFyaW4gd1x1MDBGQ3JkZSBzb25zdCBsYXV0bG9zIHZlcnNjaHdpbmRlblxuICAvLyAobnVyIGVpbiBFaW50cmFnIGluIGRlciBFbnR3aWNrbGVya29uc29sZSwga2VpbmUgc2ljaHRiYXJlIFJcdTAwRkNja21lbGR1bmcpLlxuICAvLyBEaWVzZSBkcmVpIFNvcnRpZXJiZWZlaGxlIGxhdWZlbiBkZXNoYWxiIFx1MDBGQ2JlciBydW5PclJlcG9ydEVycm9yKCksIGRhbWl0XG4gIC8vIGltIEZlaGxlcmZhbGwgdHJvdHpkZW0gaW1tZXIgZWluZSBOb3RpY2UgZXJzY2hlaW50IHN0YXR0IGdhciBrZWluZS5cbiAgY29uc3QgcnVuT3JSZXBvcnRFcnJvciA9IChsYWJlbCwgZm4pID0+IGFzeW5jICgpID0+IHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgZm4oKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihgWyR7bGFiZWx9XWAsIGVycm9yKTtcbiAgICAgIG5ldyBOb3RpY2UoYCR7bGFiZWx9IGZlaGxnZXNjaGxhZ2VuOiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgfVxuICB9O1xuXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJmcm9udG1hdHRlci1zb3J0aWVydW5nLWFsbGVcIixcbiAgICBuYW1lOiBcIkZyb250bWF0dGVyIFNvcnRpZXJ1bmcgR0xPQkFMIGFrdHVhbGlzaWVyZW5cIixcbiAgICBjYWxsYmFjazogcnVuT3JSZXBvcnRFcnJvcihcIkZyb250bWF0dGVyIFNvcnRpZXJ1bmdcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgeyBjaGVja2VkLCBjaGFuZ2VkIH0gPSBhd2FpdCBzb3J0QWxsRnJvbnRtYXR0ZXIocGx1Z2luLmFwcCwgcGx1Z2luLCBudWxsKTtcbiAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgIGNoYW5nZWQgPiAwXG4gICAgICAgICAgPyBgRnJvbnRtYXR0ZXIgU29ydGllcnVuZzogJHtjaGVja2VkfSBOb3RpemVuIGdlcHJcdTAwRkNmdCwgJHtjaGFuZ2VkfSBzb3J0aWVydC5gXG4gICAgICAgICAgOiBgRnJvbnRtYXR0ZXIgU29ydGllcnVuZzogJHtjaGVja2VkfSBOb3RpemVuIGdlcHJcdTAwRkNmdCwgYmVyZWl0cyBhbGxlIHNvcnRpZXJ0LmBcbiAgICAgICk7XG4gICAgfSksXG4gIH0pO1xuXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJmcm9udG1hdHRlci1zb3J0aWVydW5nLXR5cFwiLFxuICAgIG5hbWU6IFwiRnJvbnRtYXR0ZXIgU29ydGllcnVuZyBmXHUwMEZDciBUWVAgYWt0dWFsaXNpZXJlblwiLFxuICAgIGNhbGxiYWNrOiBydW5PclJlcG9ydEVycm9yKFwiRnJvbnRtYXR0ZXIgU29ydGllcnVuZ1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBEZXJzZWxiZSBUWVAtUGlja2VyIHdpZSBcdTAwRkNiZXJhbGwgc29uc3QgaW0gUGx1Z2luIChzaWVoZSB0eXBlLXBpY2tlci5qcykgLVxuICAgICAgLy8gemVpZ3QgRmFyYmUsIEJlc2NocmVpYnVuZyB1bmQgTm90aXotQW56YWhsIHN0YXR0IGVpbmVyIHJlaW5lbiBOYW1lbnNsaXN0ZVxuICAgICAgLy8gKHVuZCBtZWxkZXQgc2VsYnN0LCBmYWxscyBlcyBnYXIga2VpbmUgVFlQZW4gZ2lidCkuIGluY2x1ZGVNYW51YWxPZmYgdW5kXG4gICAgICAvLyBpbmNsdWRlVW5yZWdpc3RlcmVkOiB0cnVlLCBkYSBkaWUgU29ydGllcnVuZyB1bmFiaFx1MDBFNG5naWcgZGF2b24gc2lubnZvbGxcbiAgICAgIC8vIGlzdCwgb2IgZWluIFRZUCBtYW51ZWxsIHZlcmdlYmVuIHdlcmRlbiBkYXJmICh6LiBCLiBLT05UQUtULCBFWFRFUk4pXG4gICAgICAvLyBvZGVyIFx1MDBGQ2JlcmhhdXB0IGluIGRlciBUWVAtTGlzdGUgcmVnaXN0cmllcnQgaXN0LlxuICAgICAgY29uc3QgdHlwZSA9IGF3YWl0IHBsdWdpbi5waWNrVHlwZSh7IGluY2x1ZGVNYW51YWxPZmY6IHRydWUsIGluY2x1ZGVVbnJlZ2lzdGVyZWQ6IHRydWUgfSk7XG4gICAgICBpZiAoIXR5cGUpIHJldHVybjtcbiAgICAgIGNvbnN0IHsgY2hlY2tlZCwgY2hhbmdlZCwgaGFzVHlwZURlZmF1bHRzIH0gPSBhd2FpdCBzb3J0QWxsRnJvbnRtYXR0ZXIocGx1Z2luLmFwcCwgcGx1Z2luLCB0eXBlKTtcbiAgICAgIGxldCBtZXNzYWdlID1cbiAgICAgICAgY2hhbmdlZCA+IDBcbiAgICAgICAgICA/IGBGcm9udG1hdHRlciBTb3J0aWVydW5nICR7dHlwZX06ICR7Y2hlY2tlZH0gTm90aXplbiBnZXByXHUwMEZDZnQsICR7Y2hhbmdlZH0gc29ydGllcnQuYFxuICAgICAgICAgIDogYEZyb250bWF0dGVyIFNvcnRpZXJ1bmcgJHt0eXBlfTogJHtjaGVja2VkfSBOb3RpemVuIGdlcHJcdTAwRkNmdCwgYmVyZWl0cyBhbGxlIHNvcnRpZXJ0LmA7XG4gICAgICAvLyBLZWluIEZlaGxlciwgYWJlciBvaG5lIFRZUC1Gcm9udG1hdHRlciBncmVpZnQgZlx1MDBGQ3IgZGllc2VuIFR5cCBudXJcbiAgICAgIC8vIGRpZSBnbG9iYWxlIFJlaWhlbmZvbGdlIChUWVAgc2VsYnN0LCBmZXN0IHBvc2l0aW9uaWVydGUgUHJvcGVydGllcykgLVxuICAgICAgLy8gb2huZSBkaWVzZW4gSGlud2VpcyB3XHUwMEU0cmUgdW5rbGFyLCB3YXJ1bSBzaWNoIGdnZi4gbmljaHRzIGdlXHUwMEU0bmRlcnQgaGF0LlxuICAgICAgaWYgKGhhc1R5cGVEZWZhdWx0cyA9PT0gZmFsc2UpIHtcbiAgICAgICAgbWVzc2FnZSArPSBgIEhpbndlaXM6IEZcdTAwRkNyICR7dHlwZX0gaXN0IGtlaW4gVFlQLUZyb250bWF0dGVyIGhpbnRlcmxlZ3QgLSBudXIgZGllIGdsb2JhbGUgUmVpaGVuZm9sZ2Ugd3VyZGUgYW5nZXdlbmRldC5gO1xuICAgICAgfVxuICAgICAgbmV3IE5vdGljZShtZXNzYWdlKTtcbiAgICB9KSxcbiAgfSk7XG5cbiAgcGx1Z2luLmFkZENvbW1hbmQoe1xuICAgIGlkOiBcImZyb250bWF0dGVyLXNvcnRpZXJ1bmctYWt0aXZlLW5vdGl6XCIsXG4gICAgbmFtZTogXCJGcm9udG1hdHRlciBTb3J0aWVydW5nIGRlciBha3RpdmVuIE5vdGl6IGFrdHVhbGlzaWVyZW5cIixcbiAgICBjaGVja0NhbGxiYWNrOiAoY2hlY2tpbmcpID0+IHtcbiAgICAgIGNvbnN0IGZpbGUgPSBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gICAgICBpZiAoIWZpbGUgfHwgZmlsZS5leHRlbnNpb24gIT09IFwibWRcIikgcmV0dXJuIGZhbHNlO1xuICAgICAgaWYgKGNoZWNraW5nKSByZXR1cm4gdHJ1ZTtcblxuICAgICAgcnVuT3JSZXBvcnRFcnJvcihcIkZyb250bWF0dGVyIFNvcnRpZXJ1bmdcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBjaGFuZ2VkID0gYXdhaXQgc29ydFNpbmdsZUZpbGVGcm9udG1hdHRlcihwbHVnaW4uYXBwLCBwbHVnaW4sIGZpbGUpO1xuICAgICAgICBuZXcgTm90aWNlKGNoYW5nZWQgPyBgRnJvbnRtYXR0ZXIgdm9uIFwiJHtmaWxlLmJhc2VuYW1lfVwiIHNvcnRpZXJ0LmAgOiBgRnJvbnRtYXR0ZXIgdm9uIFwiJHtmaWxlLmJhc2VuYW1lfVwiIHdhciBiZXJlaXRzIHNvcnRpZXJ0LmApO1xuICAgICAgfSkoKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0sXG4gIH0pO1xuXG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckNvbW1hbmRzIH07XG4iLCAiY29uc3QgeyBtb21lbnQgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcblxuLy8gRWluIFNob3J0Y3V0IGlzdCBlaW4gVmVyd2VpcyBhdWYgZWluZW4gZXJzdCBiZWltIEFubGVnZW4gZWluZXIgTm90aXpcbi8vIGJlcmVjaG5ldGVuIFdlcnQuIEVyIHN0ZWh0IGJld3Vzc3QgTklDSFQgaW0gRnJvbnRtYXR0ZXItV2VydCBkZXIgUHJvcGVydHksXG4vLyBzb25kZXJuIGRhbmViZW4gLSBpbiBzZXR0aW5ncy50eXBlU2hvcnRjdXRzW1RZUF1ba2V5XSBmXHUwMEZDciBkYXMgVFlQLUZyb250bWF0dGVyXG4vLyBiencuIGltIHNob3J0Y3V0cy1PYmpla3QgZGVzIGpld2VpbGlnZW4gU3VidHlwLUJsb2NrcyAoc2llaGUgc3VidHlwZXMuanMpOlxuLy8gICB7IG5hbWU6IFwidG9kYXlcIiB9ICAgICAgICAgICAgLSBmZXN0ZXIgVG9rZW4sIGhpZXIgaW0gUGx1Z2luIGF1ZmdlbFx1MDBGNnN0XG4vLyAgIHsgbmFtZTogXCJ0cC48U2tyaXB0bmFtZT5cIiB9ICAtIFRlbXBsYXRlci1Ta3JpcHQsIG51ciB2b24gVFlQLmpzIGF1ZmxcdTAwRjZzYmFyXG4vLyAgIHsgbmFtZTogXCJ0cC48U2tyaXB0bmFtZT5cIiwgYXJnczogeyBvcmRuZXI6IFwiTGl0ZXJhdHVyXCIsIGphaHI6IDIwMjQgfSB9XG4vLyAgICAgLSBkYXNzZWxiZSBtaXQgQXJndW1lbnRlbi4gRGllIFBhcmFtZXRlcm5hbWVuIGRla2xhcmllcnQgZGFzIFNrcmlwdFxuLy8gICAgICAgc2VsYnN0IGltIEB0eXAtc2hvcnRjdXQtTWFya2VyIChzaWVoZSBzaG9ydGN1dC1zY3JpcHRzLmpzKTsgVFlQLmpzXG4vLyAgICAgICByZWljaHQgZGFzIE9iamVrdCBhbHMgY3R4LmFyZ3MgZHVyY2guIEZlc3RlIFRva2VuIGhhYmVuIG5pZSBBcmd1bWVudGUuXG4vL1xuLy8gV2FydW0gZGFuZWJlbiBzdGF0dCBpbSBXZXJ0OiBPYnNpZGlhbnMgUHJvcGVydHktV2lkZ2V0IGJlc3RpbW10IGRhc1xuLy8gRWluZ2FiZWZlbGQgZWluZXIgWmVpbGUgYXVzIGRlbSBpbiB0eXBlcy5qc29uIGRla2xhcmllcnRlbiBUeXAgZGVyIFByb3BlcnR5XG4vLyAoZ2V0VHlwZUluZm8gaW0gZ2ViYXV0ZW4gYXBwLmpzKS4gQmVpIGVpbmVyIGFscyBcImRhdGVcIi9cIm51bWJlclwiL1wiY2hlY2tib3hcIlxuLy8gZGVrbGFyaWVydGVuIFByb3BlcnR5IGlzdCBkYXMgZWluIDxpbnB1dCB0eXBlPVwiZGF0ZVwiPiwgZWluXG4vLyA8aW5wdXQgdHlwZT1cIm51bWJlclwiPiBiencuIGVpbiBUb2dnbGUgLSBkb3J0IGxpZVx1MDBERiBzaWNoIGVpbiBUb2tlbiB3aWVcbi8vIFwie3t0b2RheX19XCIgZ2FyIG5pY2h0IGVyc3QgZWludGlwcGVuLCBlaW4gdHJvdHpkZW0gZ2VzcGVpY2hlcnRlciBXZXJ0IGxcdTAwRjZzdGVcbi8vIE9ic2lkaWFucyBcIlR5cGUgbWlzbWF0Y2hcIi1XYXJudW5nIGF1cywgdW5kIGRhcyBMaXN0ZW4tV2lkZ2V0IG1hY2h0ZSBhdXMgZWluZW1cbi8vIFN0cmluZyBiZWltIGVyc3RlbiBCZWFyYmVpdGVuIHN0aWxsc2Nod2VpZ2VuZCBlaW4gQXJyYXkgKG9uQ2hhbmdlKGUuc2xpY2UoKSkpLlxuLy8gQWxsZSBkaWVzZSBQcm9ibGVtZSBoYWJlbiBkaWVzZWxiZSBVcnNhY2hlOiBlaW4gRnJlbWRrXHUwMEY2cnBlciBpbiBlaW5lbSBTbG90LFxuLy8gZGVzc2VuIERhdGVudHlwIE9ic2lkaWFuIGtvbnRyb2xsaWVydC4gTGllZ3QgZGVyIFNob3J0Y3V0IGRhbmViZW4sIGJsZWlidCBkZXJcbi8vIFdlcnQgdHlwcmVpbiB1bmQgZGFzIG5hdGl2ZSBXaWRnZXQgdW5hbmdldGFzdGV0IC0gZXMgYnJhdWNodCBkYWZcdTAwRkNyIGtlaW5lcmxlaVxuLy8gRWluZ3JpZmYgaW4gT2JzaWRpYW5zIFplaWxlbi1SZW5kZXJpbmcuXG4vL1xuLy8gRGVyIEZyb250bWF0dGVyLVdlcnQgZGVyIFByb3BlcnR5IGJsZWlidCBkYWJlaSBlcmhhbHRlbiB1bmQgZGllbnQgYWxzXG4vLyBSXHUwMERDQ0tGQUxMV0VSVDogU2NobFx1MDBFNGd0IGRhcyBUZW1wbGF0ZXItU2tyaXB0IGZlaGwgKGZlaGx0IG9kZXIgd2lyZnQpLCBzY2hyZWlidFxuLy8gVFlQLmpzIGlobiBzdGF0dCBlaW5lcyBsZWVyZW4gV2VydHMgKHNpZWhlIGdldFR5cGVTaG9ydGN1dHMgaW4gbWFpbi5qcyB1bmRcbi8vIGRpZSBBdXN3ZXJ0dW5nIGluIFRZUC5qcykuIEVpbiBTa3JpcHQsIGRhcyBiZXd1c3N0IG51bGwvXCJcIiBsaWVmZXJ0IC0gZXR3YSBiZWlcbi8vIEVTQyBpbSBQaWNrZXIgLSwgZ2lsdCBkYWdlZ2VuIG5pY2h0IGFscyBGZWhsc2NobGFnIHVuZCBsXHUwMEU0c3N0IGRpZSBQcm9wZXJ0eSBsZWVyLlxuXG4vLyBEaWUgZmVzdGVuIFRva2VuLCBkaWUgZGFzIFBsdWdpbiBzZWxic3QgYXVmbFx1MDBGNnNlbiBrYW5uIC0gb2huZSBUZW1wbGF0ZXIgdW5kXG4vLyBvaG5lIHRwLVp1Z3JpZmYsIGRhaGVyIHNjaG9uIGluIGdldFR5cGVEZWZhdWx0cygpIChtYWluLmpzKSBlaW5nZXNldHp0LiBFcnN0XG4vLyBiZWltIEFicnVmIGF1ZmdlbFx1MDBGNnN0LCBuaWNodCBiZWltIFNwZWljaGVybiwgZGFtaXQgei4gQi4gXCJ0b2RheVwiIGJlaSBqZWRlciBuZXVcbi8vIGFuZ2VsZWd0ZW4gTm90aXogZGFzIGRhbm4gYWt0dWVsbGUgRGF0dW0gbGllZmVydCBzdGF0dCBkZXMgVGFnZXMsIGFuIGRlbSBkZXJcbi8vIFNob3J0Y3V0IGdlc2V0enQgd3VyZGUuXG5jb25zdCBGSVhFRF9TSE9SVENVVFMgPSBbXG4gIHtcbiAgICBuYW1lOiBcInRvZGF5XCIsXG4gICAgZGVzY3JpcHRpb246IFwiSGV1dGlnZXMgRGF0dW0gKEpKSkotTU0tVFQpXCIsXG4gICAgcmVzb2x2ZTogKCkgPT4gbW9tZW50KCkuZm9ybWF0KFwiWVlZWS1NTS1ERFwiKSxcbiAgfSxcbiAge1xuICAgIG5hbWU6IFwibm93XCIsXG4gICAgZGVzY3JpcHRpb246IFwiQWt0dWVsbGVzIERhdHVtIG1pdCBVaHJ6ZWl0IChKSkpKLU1NLVRUIEhIOm1tKVwiLFxuICAgIHJlc29sdmU6ICgpID0+IG1vbWVudCgpLmZvcm1hdChcIllZWVktTU0tREQgSEg6bW1cIiksXG4gIH0sXG4gIHtcbiAgICAvLyBBbmRlcnMgYWxzIHRvZGF5L25vdyBuaWNodCBkZXIgQXVmcnVmemVpdHB1bmt0LCBzb25kZXJuIGRhc1xuICAgIC8vIEVyc3RlbGx1bmdzZGF0dW0gZGVyIGpld2VpbGlnZW4gRGF0ZWkgKGZpbGUuc3RhdC5jdGltZSkgLSBicmF1Y2h0IGRhaGVyXG4gICAgLy8gZGllIFppZWwtRGF0ZWkgYWxzIEtvbnRleHQgKGZpbGUtUGFyYW1ldGVyLCB2b24gZ2V0VHlwZURlZmF1bHRzXG4gICAgLy8gZHVyY2hnZXJlaWNodCkuIE9obmUgRGF0ZWkgRmFsbGJhY2sgYXVmIGRlbiBha3R1ZWxsZW4gWmVpdHB1bmt0LlxuICAgIG5hbWU6IFwiY3JlYXRlZFwiLFxuICAgIGRlc2NyaXB0aW9uOiBcIkVyc3RlbGx1bmdzZGF0dW0gZGVyIERhdGVpIChKSkpKLU1NLVRUKVwiLFxuICAgIHJlc29sdmU6IChmaWxlKSA9PiBtb21lbnQoZmlsZT8uc3RhdD8uY3RpbWUgPz8gRGF0ZS5ub3coKSkuZm9ybWF0KFwiWVlZWS1NTS1ERFwiKSxcbiAgfSxcbl07XG5cbi8vIFNrcmlwdC1TaG9ydGN1dHMgdHJhZ2VuIGRpZXNlbiBQclx1MDBFNGZpeCBpbSBuYW1lLCBkYW1pdCBlaW4gU2tyaXB0IG5pZSBtaXQgZWluZW1cbi8vIGZlc3RlbiBUb2tlbiBrb2xsaWRpZXJlbiBrYW5uIC0gYXVjaCBkYW5uIG5pY2h0LCB3ZW5uIGplbWFuZCBlaW5lIERhdGVpXG4vLyBcInRvZGF5LmpzXCIgaW4gZGVuIFRlbXBsYXRlci1Ta3JpcHQtT3JkbmVyIGxlZ3QuXG5jb25zdCBTQ1JJUFRfUFJFRklYID0gXCJ0cC5cIjtcblxuZnVuY3Rpb24gZmluZEZpeGVkU2hvcnRjdXQobmFtZSkge1xuICByZXR1cm4gRklYRURfU0hPUlRDVVRTLmZpbmQoKHNob3J0Y3V0KSA9PiBzaG9ydGN1dC5uYW1lID09PSBuYW1lKSA/PyBudWxsO1xufVxuXG4vLyBTa3JpcHRuYW1lIGVpbmVzIFwidHAuPFNrcmlwdG5hbWU+XCItU2hvcnRjdXRzLCBzb25zdCBudWxsLiBTa3JpcHRuYW1lID1cbi8vIERhdGVpbmFtZSBpbiB0ZW1wbGF0ZXItc2NyaXB0cy8gb2huZSBcIi5qc1wiLCBkYWhlciBhdWNoIG1pdCBVbWxhdXRlbiwgXCItXCJcbi8vIG9kZXIgTGVlcnplaWNoZW4gZXJsYXVidC5cbmZ1bmN0aW9uIHNjcmlwdE5hbWVPZihuYW1lKSB7XG4gIHJldHVybiB0eXBlb2YgbmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBuYW1lLnN0YXJ0c1dpdGgoU0NSSVBUX1BSRUZJWCkgPyBuYW1lLnNsaWNlKFNDUklQVF9QUkVGSVgubGVuZ3RoKSA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIGlzU2NyaXB0U2hvcnRjdXQocmVjb3JkKSB7XG4gIHJldHVybiBzY3JpcHROYW1lT2YocmVjb3JkPy5uYW1lKSAhPT0gbnVsbDtcbn1cblxuLy8gQW56ZWlnZWZvcm0gZWluZXMgU2hvcnRjdXRzIC0gaW4gZGVyIFByb3BlcnR5LVplaWxlIChDaGlwKSB1bmQgaW0gQXVzd2FobC1cbi8vIE1vZGFsLiBCZXd1c3N0IGRlciBuYWNrdGUgbmFtZSBvaG5lIFppZXJyYXQ6IEZyXHUwMEZDaGVyIHN0YW5kIGRlciBTaG9ydGN1dCBhbHNcbi8vIFwie3t0b2RheX19XCIgaW0gV2VydCBkZXIgUHJvcGVydHksIGRpZSBnZXNjaHdlaWZ0ZW4gS2xhbW1lcm4gd2FyZW4gZG9ydCBkaWVcbi8vIGVpbnppZ2UgTVx1MDBGNmdsaWNoa2VpdCwgaWhuIHZvbiBlaW5lbSBmZXN0ZW4gV2VydCB6dSB1bnRlcnNjaGVpZGVuLiBCZWlkZXMgaXN0XG4vLyB3ZWcgLSBnZXNwZWljaGVydCB3aXJkIHsgbmFtZSB9LCBUWVAuanMgYmVrb21tdCBTdHJ1a3R1ciBzdGF0dCBUZXh0IChzaWVoZVxuLy8gZ2V0VHlwZVNob3J0Y3V0cyBpbiBtYWluLmpzKSwgdW5kIGRlbiBVbnRlcnNjaGllZCB6dW0gZmVzdGVuIFdlcnQgbWFjaHQgamV0enRcbi8vIGRlciBDaGlwIHNlbGJzdCBzYW10IEFremVudGZhcmJlLiBEaWUgS2xhbW1lcm4gYmlsZGV0ZW4gYWxzbyBuaWNodHMgbWVociBhYi5cbmZ1bmN0aW9uIHNob3J0Y3V0TGFiZWwocmVjb3JkKSB7XG4gIGlmICghcmVjb3JkPy5uYW1lKSByZXR1cm4gXCJcIjtcbiAgY29uc3Qgd2VydGUgPSBPYmplY3QudmFsdWVzKHJlY29yZC5hcmdzID8/IHt9KS5maWx0ZXIoKHZhbHVlKSA9PiB2YWx1ZSAhPT0gdW5kZWZpbmVkKTtcbiAgcmV0dXJuIHdlcnRlLmxlbmd0aCA+IDAgPyBgJHtyZWNvcmQubmFtZX06ICR7d2VydGUuam9pbihcIiwgXCIpfWAgOiByZWNvcmQubmFtZTtcbn1cblxuLy8gRWluIGVpbmdldGlwcHRlcyBBcmd1bWVudCBpbiBkZW4gVHlwIFx1MDBGQ2JlcmZcdTAwRkNocmVuLCBkZW4gZXMgb2ZmZW5zaWNodGxpY2ggbWVpbnQgLVxuLy8gZGFtaXQgZWluIFNrcmlwdCBcIjVcIiBhbHMgWmFobCB1bmQgXCJ0cnVlXCIgYWxzIEJvb2xlYW4gYmVrb21tdCwgc3RhdHQgamVkZXNcbi8vIFNrcmlwdCBzZWxic3QgY2FzdGVuIHp1IGxhc3NlbiAod2ljaHRpZyB6LiBCLiwgd2VubiBkZXIgV2VydCBhbnNjaGxpZVx1MDBERmVuZCBpblxuLy8gZWluZXIgYWxzIFphaGwgZGVrbGFyaWVydGVuIFByb3BlcnR5IGxhbmRldCkuIEJld3Vzc3QgZGllc2Ugd2VuaWdlbiwga2xhclxuLy8gYmVuYW5udGVuIEZcdTAwRTRsbGUgc3RhdHQgSlNPTi5wYXJzZTogZGFzIHdcdTAwRkNyZGUgYmVpIFwiTGl0ZXJhdHVyXCIgb2huZWhpblxuLy8gc2NoZWl0ZXJuIHVuZCBiZWkgJ1wiYVwiJyBldHdhcyBhbmRlcmVzIGxpZWZlcm4sIGFscyBkb3J0IHN0ZWh0LiBFaW4gbGVlcmVzXG4vLyBGZWxkIGhlaVx1MDBERnQgXCJuaWNodCBnZXNldHp0XCIgKHVuZGVmaW5lZCkgdW5kIGZcdTAwRTRsbHQgYXVzIGRlbSBBcmd1bWVudC1PYmpla3Rcbi8vIGhlcmF1cywgZGFtaXQgZWluIFNrcmlwdCBzYXViZXIgbWl0IFwiYXJncy5qYWhyID8/IGZhbGxiYWNrXCIgYXJiZWl0ZW4ga2Fubi5cbmZ1bmN0aW9uIHBhcnNlQXJnVmFsdWUocmF3KSB7XG4gIGNvbnN0IHRleHQgPSBTdHJpbmcocmF3ID8/IFwiXCIpLnRyaW0oKTtcbiAgaWYgKHRleHQgPT09IFwiXCIpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmICh0ZXh0ID09PSBcInRydWVcIikgcmV0dXJuIHRydWU7XG4gIGlmICh0ZXh0ID09PSBcImZhbHNlXCIpIHJldHVybiBmYWxzZTtcbiAgaWYgKHRleHQgPT09IFwibnVsbFwiKSByZXR1cm4gbnVsbDtcbiAgaWYgKC9eLT9cXGQrKD86XFwuXFxkKyk/JC8udGVzdCh0ZXh0KSkgcmV0dXJuIE51bWJlcih0ZXh0KTtcbiAgcmV0dXJuIHRleHQ7XG59XG5cbi8vIE5hbWVuLCBkaWUgaW4gZGVyIFBhcmFtZXRlcmxpc3RlIGVpbmVzIE1hcmtlcnMgZlx1MDBGQ3IgV2VydGUgc3RlaGVuLCBkaWUgZGFzXG4vLyBQbHVnaW4gYnp3LiBUWVAuanMgc2VsYnN0IGtlbm50IC0gc2llIHdlcmRlbiBuaWNodCBhYmdlZnJhZ3QsIHNvbmRlcm4gYmVpbVxuLy8gQXVmcnVmIGVpbmdlc2V0enQ6XG4vLyAgIG5ld0ZpbGUgIGRpZSBuZXUgYW5nZWxlZ3RlIE5vdGl6XG4vLyAgIGN0eCAgICAgIGRlciBLb250ZXh0IHsgdHlwLCBzdWJ0eXAsIGtleSwgd2VydGUsIGRhbmFjaCwgYXJncyB9XG4vLyAgIGtleSAgICAgIGRpZSBQcm9wZXJ0eSwgYW4gZGVyIGRlciBTaG9ydGN1dCBoXHUwMEU0bmd0LiBFcnNwYXJ0IGVzLCBpaHJlbiBOYW1lblxuLy8gICAgICAgICAgICBhbHMgQXJndW1lbnQgenUgd2llZGVyaG9sZW4gLSBlaW4gU2tyaXB0IHdpZSByZWxhdGlvbi5qcywgZGFzXG4vLyAgICAgICAgICAgIHNpY2ggc2VpbmUgUHJvcGVydHkgc2FnZW4gbFx1MDBFNHNzdCwgYmVrb21tdCBkYW1pdCBhdXRvbWF0aXNjaCBkaWVcbi8vICAgICAgICAgICAgcmljaHRpZ2UsIGF1Y2ggd2VubiBkZXJzZWxiZSBTaG9ydGN1dCBhbiBlaW5lciBhbmRlcmVuIFplaWxlXG4vLyAgICAgICAgICAgIHNpdHp0LlxuLy8gXCJ0cFwiIHN0ZWh0IGltbWVyIGFscyBlcnN0ZXMgQXJndW1lbnQgdW5kIG11c3MgbmljaHQgZGVrbGFyaWVydCB3ZXJkZW47IHdpcmRcbi8vIGVzIHRyb3R6ZGVtIGdlbmFubnQsIHdpcmQgZXMgXHUwMEZDYmVyZ2FuZ2VuLCBzdGF0dCBlcyBlaW4gendlaXRlcyBNYWwgenVcbi8vIFx1MDBGQ2JlcmdlYmVuLlxuY29uc3QgUkVTRVJWRURfUEFSQU1TID0gW1wibmV3RmlsZVwiLCBcImN0eFwiLCBcImtleVwiXTtcblxuLy8gRGllIFBhcmFtZXRlciwgZlx1MDBGQ3IgZGllIGRhcyBNb2RhbCBlaW4gRWluZ2FiZWZlbGQgemVpZ3Q6IGFsbGVzLCB3YXMgbmljaHRcbi8vIHJlc2VydmllcnQgaXN0LiBwYXJhbXMgPT09IG51bGwgKGtlaW4gS2xhbW1lcnBhYXIgYW0gTWFya2VyKSBoZWlcdTAwREZ0XG4vLyBcImhlcmtcdTAwRjZtbWxpY2hlciBBdWZydWZcIiwgYWxzbyBlYmVuZmFsbHMga2VpbmUgRmVsZGVyLlxuZnVuY3Rpb24gaW5wdXRQYXJhbXMocGFyYW1zKSB7XG4gIHJldHVybiAocGFyYW1zID8/IFtdKS5maWx0ZXIoKG5hbWUpID0+IG5hbWUgIT09IFwidHBcIiAmJiAhUkVTRVJWRURfUEFSQU1TLmluY2x1ZGVzKG5hbWUpKTtcbn1cblxuLy8gRWluZ2FiZW4gKGplIFBhcmFtZXRlcm5hbWUgZWluIFRleHQpIGluIGRhcyBnZXNwZWljaGVydGUgQXJndW1lbnQtT2JqZWt0LlxuLy8gcGFyYW1zIGdpYnQgZGllIFJlaWhlbmZvbGdlIHZvciwgZGFtaXQgc2hvcnRjdXRMYWJlbCgpIHNpZSBpbiBkZXIgdm9tIFNrcmlwdFxuLy8gZGVrbGFyaWVydGVuIEZvbGdlIGFuemVpZ3Q7IGxlZXJlIEZlbGRlciBmZWhsZW4gaW0gRXJnZWJuaXMgZ2Fuei5cbmZ1bmN0aW9uIGJ1aWxkQXJncyhwYXJhbXMsIGVpbmdhYmVuKSB7XG4gIGNvbnN0IGFyZ3MgPSB7fTtcbiAgZm9yIChjb25zdCBuYW1lIG9mIGlucHV0UGFyYW1zKHBhcmFtcykpIHtcbiAgICBjb25zdCB2YWx1ZSA9IHBhcnNlQXJnVmFsdWUoZWluZ2FiZW5bbmFtZV0pO1xuICAgIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkKSBhcmdzW25hbWVdID0gdmFsdWU7XG4gIH1cbiAgcmV0dXJuIGFyZ3M7XG59XG5cbi8vIEF1cyBkZXIgZGVrbGFyaWVydGVuIFBhcmFtZXRlcmxpc3RlIGRpZSBBcmd1bWVudGUgZlx1MDBGQ3IgZGVuIEF1ZnJ1ZlxuLy8gZih0cCwgLi4uaGllcikgYmF1ZW4gLSBhdWZnZXJ1ZmVuIHZvbiBUWVAuanMsIGRhcyBhbHMgZWluemlnZXMgbmV3RmlsZSB1bmRcbi8vIGN0eCBrZW5udC5cbi8vXG4vLyBPaG5lIEtsYW1tZXJuIGFtIE1hcmtlciAocGFyYW1zID09PSBudWxsKSBibGVpYnQgZXMgYmVpbSBoZXJrXHUwMEY2bW1saWNoZW5cbi8vIEF1ZnJ1ZiBmKHRwLCBuZXdGaWxlLCBjdHgpLiBTb25zdCB3aXJkIGRpZSBMaXN0ZSBFaW50cmFnIGZcdTAwRkNyIEVpbnRyYWdcbi8vIGF1ZmdlbFx1MDBGNnN0OiByZXNlcnZpZXJ0ZSBOYW1lbiB6dSBkZW4gXHUwMEZDYmVyZ2ViZW5lbiBXZXJ0ZW4sIGFsbGUgYW5kZXJlbiB6dW1cbi8vIGVpbmdldGlwcHRlbiBBcmd1bWVudC5cbi8vXG4vLyBFaW4gUHVua3QtTmFtZSAoXCJvcHRpb25zLnR5cFwiKSBiZXNjaHJlaWJ0IGtlaW4gZWlnZW5lcyBBcmd1bWVudCwgc29uZGVybiBlaW5cbi8vIEZFTEQgZWluZXMgT2JqZWt0LUFyZ3VtZW50czogYWxsZSBcIm9wdGlvbnMuKlwiIHNhbW1lbG4gc2ljaCB6dSBlaW5lbSBlaW56aWdlblxuLy8gT2JqZWt0IGFuIGRlciBQb3NpdGlvbiBpaHJlcyBlcnN0ZW4gVm9ya29tbWVucy4gRGFtaXQgbGFzc2VuIHNpY2ggYXVjaFxuLy8gU2tyaXB0ZSBiZWRpZW5lbiwgZGVyZW4gU2lnbmF0dXIgZWluIE9wdGlvbnMtT2JqZWt0IGVyd2FydGV0LCBvaG5lIGRhc3MgbWFuXG4vLyBKU09OIGluIGVpbiBFaW5nYWJlZmVsZCB0aXBwZW4gbVx1MDBGQ3NzdGUuIE51ciBlaW5lIEViZW5lIHRpZWYgLSBiZWkgXCJhLmIuY1wiXG4vLyBlbnRzdFx1MDBGQ25kZSBlaW4gRmVsZCwgZGFzIHdcdTAwRjZydGxpY2ggXCJiLmNcIiBoZWlcdTAwREZ0LlxuZnVuY3Rpb24gcmVzb2x2ZUNhbGxBcmdzKHBhcmFtcywgYXJncywgcmVzZXJ2ZWQgPSB7fSkge1xuICBpZiAocGFyYW1zID09PSBudWxsIHx8IHBhcmFtcyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gW3Jlc2VydmVkLm5ld0ZpbGUsIHJlc2VydmVkLmN0eF07XG5cbiAgY29uc3Qgd2VydGUgPSBbXTtcbiAgY29uc3Qgb2JqZWt0UG9zaXRpb24gPSBuZXcgTWFwKCk7XG4gIGZvciAoY29uc3QgbmFtZSBvZiBwYXJhbXMpIHtcbiAgICBpZiAobmFtZSA9PT0gXCJ0cFwiKSBjb250aW51ZTtcbiAgICBpZiAoUkVTRVJWRURfUEFSQU1TLmluY2x1ZGVzKG5hbWUpKSB7XG4gICAgICB3ZXJ0ZS5wdXNoKHJlc2VydmVkW25hbWVdKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBwdW5rdCA9IG5hbWUuaW5kZXhPZihcIi5cIik7XG4gICAgaWYgKHB1bmt0ID09PSAtMSkge1xuICAgICAgd2VydGUucHVzaChhcmdzPy5bbmFtZV0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGJhc2lzID0gbmFtZS5zbGljZSgwLCBwdW5rdCk7XG4gICAgaWYgKCFvYmpla3RQb3NpdGlvbi5oYXMoYmFzaXMpKSB7XG4gICAgICBvYmpla3RQb3NpdGlvbi5zZXQoYmFzaXMsIHdlcnRlLmxlbmd0aCk7XG4gICAgICB3ZXJ0ZS5wdXNoKHt9KTtcbiAgICB9XG4gICAgY29uc3Qgd2VydCA9IGFyZ3M/LltuYW1lXTtcbiAgICBpZiAod2VydCAhPT0gdW5kZWZpbmVkKSB3ZXJ0ZVtvYmpla3RQb3NpdGlvbi5nZXQoYmFzaXMpXVtuYW1lLnNsaWNlKHB1bmt0ICsgMSldID0gd2VydDtcbiAgfVxuICByZXR1cm4gd2VydGU7XG59XG5cbi8vIE9iIGRpZSBQcm9wZXJ0eSBsYXV0IHR5cGVzLmpzb24gKGJ6dy4sIGZhbGxzIGRvcnQgbmljaHQgZ2VzZXR6dCwgbGF1dCBpaHJlclxuLy8gYmlzaGVyaWdlbiBWZXJ3ZW5kdW5nIGltIFZhdWx0KSBlaW5lIExpc3RlIGlzdCAtIGRhbm4gd2lyZCBlaW4gYXVmZ2VsXHUwMEY2c3RlclxuLy8gU2hvcnRjdXQtV2VydCBlaW5lbGVtZW50aWcgZWluZ2VwYWNrdCwgZGFtaXQgZGVyIGdlbGllZmVydGUgV2VydCB6dW1cbi8vIGRla2xhcmllcnRlbiBUeXAgZGVyIFByb3BlcnR5IHBhc3N0LiBPaG5lIGFwcCAoei4gQi4gaW4gVGVzdHMpIHdpZSBiaXNoZXJcbi8vIG9obmUgRWlucGFja2VuLlxuZnVuY3Rpb24gaXNMaXN0UHJvcGVydHkoYXBwLCBrZXkpIHtcbiAgcmV0dXJuIGFwcD8ubWV0YWRhdGFUeXBlTWFuYWdlcj8uZ2V0VHlwZUluZm8/LihrZXkpPy5leHBlY3RlZD8udHlwZSA9PT0gXCJtdWx0aXRleHRcIjtcbn1cblxuLy8gS29waWUgdm9uIGZyb250bWF0dGVyLCBpbiBkZXIgamVkZXIgS2V5IG1pdCBTaG9ydGN1dCBzZWluZW4gYmVyZWNobmV0ZW4gV2VydFxuLy8gdHJcdTAwRTRndDpcbi8vICAgLSBmZXN0ZXIgVG9rZW4gLT4gYXVmZ2VsXHUwMEY2c3QgKGJlaSBlaW5lciBMaXN0ZW4tUHJvcGVydHkgZWluZWxlbWVudGlnXG4vLyAgICAgZWluZ2VwYWNrdCksXG4vLyAgIC0gXCJ0cC48U2tyaXB0PlwiIC0+IG51bGw7IG51ciBUZW1wbGF0ZXIga2FubiBkYXMgYXVmbFx1MDBGNnNlbiwgVFlQLmpzIGhvbHQgc2ljaFxuLy8gICAgIGRpZXNlIEtleXMgXHUwMEZDYmVyIGdldFR5cGVTaG9ydGN1dHMoKSB1bmQgc2V0enQgc2llIHNlbGJzdCBlaW4uXG4vLyBLZXlzIG9obmUgU2hvcnRjdXQgYmxlaWJlbiB1bnZlclx1MDBFNG5kZXJ0IC0gZWJlbnNvIGRlciBXZXJ0IGVpbmVzIEtleXMgTUlUXG4vLyBTaG9ydGN1dCBpbiBkZW4gU2V0dGluZ3Mgc2VsYnN0OiBlciBibGVpYnQgZG9ydCBhbHMgUlx1MDBGQ2NrZmFsbHdlcnQgc3RlaGVuIChzaWVoZVxuLy8gS29tbWVudGFyIG9iZW4pIHVuZCB3aXJkIGhpZXIgbnVyIFx1MDBGQ2JlcnNjaHJpZWJlbiwgbmljaHQgZ2VsXHUwMEY2c2NodC5cbmZ1bmN0aW9uIHJlc29sdmVTaG9ydGN1dHMoZnJvbnRtYXR0ZXIsIHNob3J0Y3V0cywgeyBmaWxlLCBhcHAgfSA9IHt9KSB7XG4gIGNvbnN0IHJlc29sdmVkID0ge307XG4gIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGZyb250bWF0dGVyKSkge1xuICAgIGNvbnN0IHJlY29yZCA9IHNob3J0Y3V0cz8uW2tleV07XG4gICAgY29uc3QgZml4ZWQgPSByZWNvcmQgPyBmaW5kRml4ZWRTaG9ydGN1dChyZWNvcmQubmFtZSkgOiBudWxsO1xuICAgIGlmIChmaXhlZCkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gZml4ZWQucmVzb2x2ZShmaWxlKTtcbiAgICAgIHJlc29sdmVkW2tleV0gPSBpc0xpc3RQcm9wZXJ0eShhcHAsIGtleSkgPyBbcmVzdWx0XSA6IHJlc3VsdDtcbiAgICB9IGVsc2UgaWYgKGlzU2NyaXB0U2hvcnRjdXQocmVjb3JkKSkge1xuICAgICAgcmVzb2x2ZWRba2V5XSA9IG51bGw7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc29sdmVkW2tleV0gPSB2YWx1ZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlc29sdmVkO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgRklYRURfU0hPUlRDVVRTLFxuICBTQ1JJUFRfUFJFRklYLFxuICBmaW5kRml4ZWRTaG9ydGN1dCxcbiAgc2NyaXB0TmFtZU9mLFxuICBpc1NjcmlwdFNob3J0Y3V0LFxuICBzaG9ydGN1dExhYmVsLFxuICBwYXJzZUFyZ1ZhbHVlLFxuICBidWlsZEFyZ3MsXG4gIGlucHV0UGFyYW1zLFxuICByZXNvbHZlQ2FsbEFyZ3MsXG4gIFJFU0VSVkVEX1BBUkFNUyxcbiAgcmVzb2x2ZVNob3J0Y3V0cyxcbn07XG4iLCAiY29uc3QgeyBGdXp6eVN1Z2dlc3RNb2RhbCwgTW9kYWwsIFNldHRpbmcgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgRklYRURfU0hPUlRDVVRTLCBTQ1JJUFRfUFJFRklYLCBidWlsZEFyZ3MsIGlucHV0UGFyYW1zIH0gPSByZXF1aXJlKFwiLi9zaG9ydGN1dHNcIik7XG5cbi8vIEFuemVpZ2Vmb3JtIGVpbmVzIExpc3RlbmVpbnRyYWdzOiBkZXIgTmFtZSwgYmVpIGVpbmVtIFNrcmlwdCBtaXQgZGVrbGFyaWVydGVuXG4vLyBQYXJhbWV0ZXJuIHp1c1x1MDBFNHR6bGljaCBkZXJlbiBOYW1lbiBpbiBLbGFtbWVybiAtIHNvIGlzdCBzY2hvbiBpbiBkZXIgQXVzd2FobFxuLy8genUgc2VoZW4sIGRhc3MgKHVuZCB3b21pdCkgZWluIFNrcmlwdCBwYXJhbWV0cmlzaWVydCB3aXJkLlxuZnVuY3Rpb24gaXRlbUxhYmVsKGl0ZW0pIHtcbiAgcmV0dXJuIGl0ZW0ucGFyYW1zID8gYCR7aXRlbS5uYW1lfSgke2l0ZW0ucGFyYW1zLmpvaW4oXCIsIFwiKX0pYCA6IGl0ZW0ubmFtZTtcbn1cblxuLy8gQXVzd2FobCBlaW5lcyBTaG9ydGN1dHMgZlx1MDBGQ3IgZWluZSBQcm9wZXJ0eSBkZXMgVFlQLUZyb250bWF0dGVycyAoS25vcGYgYnp3LlxuLy8gQ2hpcCBpbiBkZXIgUHJvcGVydHktWmVpbGUsIHNpZWhlIHR5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKS4gRXJzZXR6dCBkaWVcbi8vIGZyXHUwMEZDaGVyZSBMZWdlbmRlIHVudGVyaGFsYiBkZXIgRnJvbnRtYXR0ZXItQmxcdTAwRjZja2U6IGRpZXNlbGJlbiBUb2tlbiwgYWJlciBhbVxuLy8gT3J0IGRlciBWZXJ3ZW5kdW5nLCBkdXJjaHN1Y2hiYXIgLSB1bmQgYmVpIFNrcmlwdGVuIHp1c1x1MDBFNHR6bGljaCBtaXQgZGVyXG4vLyBCZXNjaHJlaWJ1bmcgYXVzIGRlcmVuIEB0eXAtc2hvcnRjdXQtTWFya2VyLCBkaWUgZWluZSBmZXN0ZSBMZWdlbmRlIGdhciBuaWNodFxuLy8ga2VubmVuIGtvbm50ZS5cbi8vXG4vLyBHZXdcdTAwRTRobHQgd2lyZCBuaWUgZnJlaWVyIFRleHQ6IGRpZSBMaXN0ZSBpc3QgZGllIG1hXHUwMERGZ2VibGljaGUgUXVlbGxlLCBlaW5cbi8vIFRpcHBmZWhsZXIgaW0gU2tyaXB0bmFtZW4gaXN0IGRhbWl0IGF1c2dlc2NobG9zc2VuLlxuY2xhc3MgU2hvcnRjdXRQaWNrZXJNb2RhbCBleHRlbmRzIEZ1enp5U3VnZ2VzdE1vZGFsIHtcbiAgY29uc3RydWN0b3IoYXBwLCBrZXksIGl0ZW1zLCByZXNvbHZlKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLml0ZW1zID0gaXRlbXM7XG4gICAgdGhpcy5yZXNvbHZlID0gcmVzb2x2ZTtcbiAgICB0aGlzLmNob3NlbiA9IGZhbHNlO1xuICAgIHRoaXMuc2V0UGxhY2Vob2xkZXIoYFNob3J0Y3V0IGZcdTAwRkNyIFx1MjAxRSR7a2V5fVx1MjAxQyBcdTIwMTMgRVNDIGZcdTAwRkNyIEFiYnJ1Y2hgKTtcbiAgfVxuXG4gIGdldEl0ZW1zKCkge1xuICAgIHJldHVybiB0aGlzLml0ZW1zO1xuICB9XG5cbiAgLy8gRnV6enktU3VjaGUgZ3JlaWZ0IGF1Y2ggYXVmIGRpZSBCZXNjaHJlaWJ1bmcsIG5pY2h0IG51ciBhdWYgZGVuIE5hbWVuIC1cbiAgLy8gXCJFcnN0ZWxsdW5nc2RhdHVtXCIgZmluZGV0IHNvIGF1Y2ggXCJjcmVhdGVkXCIuXG4gIGdldEl0ZW1UZXh0KGl0ZW0pIHtcbiAgICBjb25zdCBsYWJlbCA9IGl0ZW1MYWJlbChpdGVtKTtcbiAgICByZXR1cm4gaXRlbS5kZXNjcmlwdGlvbiA/IGAke2xhYmVsfSAke2l0ZW0uZGVzY3JpcHRpb259YCA6IGxhYmVsO1xuICB9XG5cbiAgcmVuZGVyU3VnZ2VzdGlvbihtYXRjaCwgZWwpIHtcbiAgICBjb25zdCBpdGVtID0gbWF0Y2guaXRlbTtcbiAgICBlbC5hZGRDbGFzcyhcImZyZWQtdHlwLXNob3J0Y3V0LXN1Z2dlc3Rpb25cIik7XG4gICAgZWwuY3JlYXRlRWwoXCJjb2RlXCIsIHsgY2xzOiBcImZyZWQtdHlwLXNob3J0Y3V0LXN1Z2dlc3Rpb24tbmFtZVwiLCB0ZXh0OiBpdGVtTGFiZWwoaXRlbSkgfSk7XG4gICAgaWYgKGl0ZW0uZGVzY3JpcHRpb24pIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtc2hvcnRjdXQtc3VnZ2VzdGlvbi1kZXNjXCIsIHRleHQ6IGl0ZW0uZGVzY3JpcHRpb24gfSk7XG4gIH1cblxuICAvLyBTaWVoZSBUeXBQaWNrZXJNb2RhbCBpbiB0eXBlLXBpY2tlci5qczogT2JzaWRpYW5zIHNlbGVjdFN1Z2dlc3Rpb24oKSBydWZ0XG4gIC8vIGVyc3QgY2xvc2UoKSB1bmQgZGFuYWNoIGVyc3Qgb25DaG9vc2VJdGVtKCkgLSBcImNob3NlblwiIG11c3MgZGVzaGFsYiBzY2hvblxuICAvLyBoaWVyIGdlc2V0enQgd2VyZGVuLCBzb25zdCBsXHUwMEY2c3QgZGFzIHZvbiBjbG9zZSgpIGF1c2dlbFx1MDBGNnN0ZSBvbkNsb3NlKCkgZGFzXG4gIC8vIFByb21pc2Ugdm9yemVpdGlnIG1pdCBudWxsIGF1ZiB1bmQgZGllIGVpZ2VudGxpY2hlIEF1c3dhaGwgZ2VodCB2ZXJsb3Jlbi5cbiAgc2VsZWN0U3VnZ2VzdGlvbihpdGVtLCBldnQpIHtcbiAgICB0aGlzLmNob3NlbiA9IHRydWU7XG4gICAgc3VwZXIuc2VsZWN0U3VnZ2VzdGlvbihpdGVtLCBldnQpO1xuICB9XG5cbiAgb25DaG9vc2VJdGVtKGl0ZW0pIHtcbiAgICB0aGlzLnJlc29sdmUoaXRlbSk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHN1cGVyLm9uQ2xvc2UoKTtcbiAgICBpZiAoIXRoaXMuY2hvc2VuKSB0aGlzLnJlc29sdmUobnVsbCk7XG4gIH1cbn1cblxuLy8gQWJmcmFnZSBkZXIgQXJndW1lbnRlIGVpbmVzIFNrcmlwdHMsIGRhcyB3ZWxjaGUgZGVrbGFyaWVydCBoYXQgLSBlaW4gRGlhbG9nXG4vLyBtaXQgYWxsZW4gRmVsZGVybiB1bnRlcmVpbmFuZGVyIHN0YXR0IGVpbmVyIEtldHRlIHZvbiBFaW56ZWxhYmZyYWdlbiwgZGFtaXRcbi8vIG1hbiBzaWUgZ2VtZWluc2FtIHNpZWh0IHVuZCBrb3JyaWdpZXJlbiBrYW5uLiBEaWUgRmVsZGVyIHNpbmQgbmFjaCBkZW5cbi8vIFBhcmFtZXRlcm5hbWVuIGRlcyBTa3JpcHRzIGJlbmFubnQ7IHZvcmJlbGVndCB3ZXJkZW4gc2llIG1pdCBkZW4gYmVyZWl0c1xuLy8gZ2VzcGVpY2hlcnRlbiBXZXJ0ZW4gKHZvcmhhbmRlbmUgQXJndW1lbnRlKSwgc29kYXNzIGVpbiBlcm5ldXRlcyBXXHUwMEU0aGxlblxuLy8gZGVzc2VsYmVuIFNrcmlwdHMgenVtIEtvcnJpZ2llcmVuIGVpbnplbG5lciBXZXJ0ZSB0YXVndC5cbi8vXG4vLyBFaW4gbGVlciBnZWxhc3NlbmVzIEZlbGQgZ2lsdCBhbHMgXCJuaWNodCBnZXNldHp0XCIgdW5kIGZcdTAwRTRsbHQgYXVzIGRlbSBFcmdlYm5pc1xuLy8gaGVyYXVzIChzaWVoZSBidWlsZEFyZ3MgaW4gc2hvcnRjdXRzLmpzKSAtIGRlc2hhbGIgZ2lidCBlcyBoaWVyIGtlaW5lXG4vLyBQZmxpY2h0ZmVsZGVyIHVuZCBrZWluZSBWYWxpZGllcnVuZzogd2FzIGRhcyBTa3JpcHQgYnJhdWNodCwgd2VpXHUwMERGIG51ciBkYXNcbi8vIFNrcmlwdCBzZWxic3QuXG5jbGFzcyBTaG9ydGN1dEFyZ3NNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgY29uc3RydWN0b3IoYXBwLCBpdGVtLCB2b3JoYW5kZW5lLCByZXNvbHZlKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLml0ZW0gPSBpdGVtO1xuICAgIHRoaXMucmVzb2x2ZSA9IHJlc29sdmU7XG4gICAgdGhpcy5mZWxkZXIgPSBpbnB1dFBhcmFtcyhpdGVtLnBhcmFtcyk7XG4gICAgdGhpcy5laW5nYWJlbiA9IHt9O1xuICAgIGZvciAoY29uc3QgbmFtZSBvZiB0aGlzLmZlbGRlcikge1xuICAgICAgY29uc3Qgd2VydCA9IHZvcmhhbmRlbmU/LltuYW1lXTtcbiAgICAgIHRoaXMuZWluZ2FiZW5bbmFtZV0gPSB3ZXJ0ID09PSB1bmRlZmluZWQgfHwgd2VydCA9PT0gbnVsbCA/IFwiXCIgOiBTdHJpbmcod2VydCk7XG4gICAgfVxuICAgIHRoaXMuYmVzdGFldGlndCA9IGZhbHNlO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIHRoaXMudGl0bGVFbC5zZXRUZXh0KGBBcmd1bWVudGUgZlx1MDBGQ3IgJHt0aGlzLml0ZW0ubmFtZX1gKTtcbiAgICBpZiAodGhpcy5pdGVtLmRlc2NyaXB0aW9uKSB7XG4gICAgICB0aGlzLmNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtc2hvcnRjdXQtYXJncy1kZXNjXCIsIHRleHQ6IHRoaXMuaXRlbS5kZXNjcmlwdGlvbiB9KTtcbiAgICB9XG4gICAgZm9yIChjb25zdCBuYW1lIG9mIHRoaXMuZmVsZGVyKSB7XG4gICAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRlbnRFbCkuc2V0TmFtZShuYW1lKS5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0XG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMuZWluZ2FiZW5bbmFtZV0pXG4gICAgICAgICAgLm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5laW5nYWJlbltuYW1lXSA9IHZhbHVlO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLy8gRW50ZXIgaW4gZWluZW0gRmVsZCBzY2hsaWVcdTAwREZ0IGRlbiBEaWFsb2cgYWIsIHdpZSBpbiBPYnNpZGlhbnNcbiAgICAgICAgICAvLyBlaWdlbmVuIFVtYmVuZW5uZW4tRGlhbG9nZW4uXG4gICAgICAgICAgLmlucHV0RWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XG4gICAgICAgICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVudGVyXCIgJiYgIWV2ZW50LmlzQ29tcG9zaW5nKSB7XG4gICAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICAgIHRoaXMudWViZXJuZWhtZW4oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9XG4gICAgbmV3IFNldHRpbmcodGhpcy5jb250ZW50RWwpLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgYnV0dG9uXG4gICAgICAgIC5zZXRCdXR0b25UZXh0KFwiXHUwMERDYmVybmVobWVuXCIpXG4gICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAub25DbGljaygoKSA9PiB0aGlzLnVlYmVybmVobWVuKCkpXG4gICAgKTtcbiAgfVxuXG4gIHVlYmVybmVobWVuKCkge1xuICAgIHRoaXMuYmVzdGFldGlndCA9IHRydWU7XG4gICAgdGhpcy5jbG9zZSgpO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIC8vIEVTQyBiencuIEtsaWNrIGRhbmViZW46IGtlaW4gU2hvcnRjdXQgZ2VzZXR6dCwgZGVyIGJpc2hlcmlnZSBibGVpYnRcbiAgICAvLyB1bmFuZ2V0YXN0ZXQgLSBzb25zdCB3XHUwMEU0cmUgZWluIHZlcnNlaGVudGxpY2hlcyBTY2hsaWVcdTAwREZlbiBlaW4gc3RpbGxlclxuICAgIC8vIERhdGVudmVybHVzdC5cbiAgICB0aGlzLnJlc29sdmUodGhpcy5iZXN0YWV0aWd0ID8gYnVpbGRBcmdzKHRoaXMuZmVsZGVyLCB0aGlzLmVpbmdhYmVuKSA6IG51bGwpO1xuICB9XG59XG5cbi8vIFx1MDBENmZmbmV0IGRpZSBBdXN3YWhsIGZcdTAwRkNyIGRpZSBQcm9wZXJ0eSBrZXkuIGdldFNjcmlwdHMgaXN0IGRlciBBY2Nlc3NvciBhdXNcbi8vIHJlZ2lzdGVyU2hvcnRjdXRTY3JpcHRzKCkgKHNob3J0Y3V0LXNjcmlwdHMuanMpLCB2b3JoYW5kZW4gZGVyIGFrdHVlbGxcbi8vIGdlc2V0enRlIFNob3J0Y3V0LVJlY29yZCAoZlx1MDBGQ3IgZGllIFZvcmJlbGVndW5nIGRlciBBcmd1bWVudGUpLiBMXHUwMEY2c3QgbWl0IGRlbVxuLy8gbmV1ZW4gUmVjb3JkICh7IG5hbWUgfSBiencuIHsgbmFtZSwgYXJncyB9KSBhdWYsIG9kZXIgbWl0IG51bGwgYmVpIEFiYnJ1Y2ggLVxuLy8gYXVjaCBkYW5uLCB3ZW5uIHp3YXIgZWluIFNrcmlwdCBnZXdcdTAwRTRobHQsIGRlciBBcmd1bWVudC1EaWFsb2cgZGFuYWNoIGFiZXJcbi8vIGFiZ2Vicm9jaGVuIHd1cmRlLlxuYXN5bmMgZnVuY3Rpb24gcGlja1Nob3J0Y3V0KGFwcCwga2V5LCBnZXRTY3JpcHRzLCB2b3JoYW5kZW4gPSBudWxsKSB7XG4gIGNvbnN0IGl0ZW1zID0gW1xuICAgIC4uLkZJWEVEX1NIT1JUQ1VUUy5tYXAoKHsgbmFtZSwgZGVzY3JpcHRpb24gfSkgPT4gKHsgbmFtZSwgZGVzY3JpcHRpb24sIHBhcmFtczogbnVsbCB9KSksXG4gICAgLi4uZ2V0U2NyaXB0cygpLm1hcCgoeyBuYW1lLCBwYXJhbXMsIGRlc2NyaXB0aW9uIH0pID0+ICh7IG5hbWU6IFNDUklQVF9QUkVGSVggKyBuYW1lLCBwYXJhbXMsIGRlc2NyaXB0aW9uIH0pKSxcbiAgXTtcblxuICBjb25zdCBpdGVtID0gYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IG5ldyBTaG9ydGN1dFBpY2tlck1vZGFsKGFwcCwga2V5LCBpdGVtcywgcmVzb2x2ZSkub3BlbigpKTtcbiAgaWYgKCFpdGVtKSByZXR1cm4gbnVsbDtcbiAgLy8gT2huZSBhYnp1ZnJhZ2VuZGUgRmVsZGVyIGVudGZcdTAwRTRsbHQgZGVyIHp3ZWl0ZSBTY2hyaXR0IGdhbnogLSBkYXMgZ2lsdCBmXHUwMEZDclxuICAvLyBkaWUgZmVzdGVuIFNob3J0Y3V0cyBlYmVuc28gd2llIGZcdTAwRkNyIGVpbiBTa3JpcHQsIGRlc3NlbiBQYXJhbWV0ZXJsaXN0ZSBudXJcbiAgLy8gcmVzZXJ2aWVydGUgTmFtZW4gZW50aFx1MDBFNGx0IChldHdhIFwiKG5ld0ZpbGUpXCIpLlxuICBpZiAoaW5wdXRQYXJhbXMoaXRlbS5wYXJhbXMpLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHsgbmFtZTogaXRlbS5uYW1lIH07XG5cbiAgLy8gVm9yYmVsZWd1bmcgbnVyLCB3ZW5uIGRhc3NlbGJlIFNrcmlwdCBzY2hvbiBnZXNldHp0IHdhciAtIGJlaSBlaW5lbVxuICAvLyBXZWNoc2VsIHdcdTAwRTRyZW4gZGllIGFsdGVuIFdlcnRlIGZcdTAwRkNyIGFuZGVyZSBQYXJhbWV0ZXJuYW1lbiBiZWRldXR1bmdzbG9zLlxuICBjb25zdCB2b3JiZWxlZ3VuZyA9IHZvcmhhbmRlbj8ubmFtZSA9PT0gaXRlbS5uYW1lID8gdm9yaGFuZGVuLmFyZ3MgOiBudWxsO1xuICBjb25zdCBhcmdzID0gYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IG5ldyBTaG9ydGN1dEFyZ3NNb2RhbChhcHAsIGl0ZW0sIHZvcmJlbGVndW5nLCByZXNvbHZlKS5vcGVuKCkpO1xuICBpZiAoYXJncyA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiBPYmplY3Qua2V5cyhhcmdzKS5sZW5ndGggPiAwID8geyBuYW1lOiBpdGVtLm5hbWUsIGFyZ3MgfSA6IHsgbmFtZTogaXRlbS5uYW1lIH07XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBwaWNrU2hvcnRjdXQgfTtcbiIsICJjb25zdCB7IE1hcmtkb3duVmlldywgTWVudSwgc2V0SWNvbiB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xyXG5jb25zdCB7IHNob3J0Y3V0TGFiZWwgfSA9IHJlcXVpcmUoXCIuL3Nob3J0Y3V0c1wiKTtcclxuY29uc3QgeyBwaWNrU2hvcnRjdXQgfSA9IHJlcXVpcmUoXCIuL3Nob3J0Y3V0LXBpY2tlclwiKTtcclxuY29uc3QgeyBnZXRTdWJ0eXBlLCBlbnN1cmVTdWJ0eXBlIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBlc1wiKTtcclxuXHJcbi8vIE1hcmtlci1LbGFzc2UgYW0gQ29udGFpbmVyIGRlcyBUWVAtRnJvbnRtYXR0ZXItRWRpdG9ycyAtIGdyZW56dCBkaWVcclxuLy8gU2hvcnRjdXQtUmVnZWxuIGluIHN0eWxlcy5jc3MgYXVmIGRpZXNlbiBFZGl0b3IgZWluLCBlY2h0ZSBOb3RpemVuIGJsZWliZW5cclxuLy8gdW5iZXJcdTAwRkNocnQuXHJcbmNvbnN0IEVESVRPUl9DTEFTUyA9IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItZWRpdG9yXCI7XHJcblxyXG5jb25zdCBUWVBfUFJPUEVSVFkgPSBcIlRZUFwiO1xyXG5jb25zdCBTVUJUWVBfUFJPUEVSVFkgPSBcIlNVQlRZUFwiO1xyXG5jb25zdCBTWVNURU1fUFJPUEVSVElFUyA9IFtUWVBfUFJPUEVSVFkudG9Mb3dlckNhc2UoKSwgU1VCVFlQX1BST1BFUlRZLnRvTG93ZXJDYXNlKCldO1xyXG5cclxuLy8gRGVyIFdlcnQgZGVyIFRZUC0gYnp3LiBTVUJUWVAtUHJvcGVydHkgaXN0IHBlciBEZWZpbml0aW9uIGltbWVyIGRlciBOYW1lIGRlc1xyXG4vLyBUWVBzL1N1YnR5cHMgc2VsYnN0IC0gYWxzIFwiU3RhbmRhcmRcIi1Qcm9wZXJ0eSB3XHUwMEU0cmUgc2llIGFsc28gcmVkdW5kYW50IHVuZFxyXG4vLyBrXHUwMEY2bm50ZSBiZWkgZWluZXIgVW1iZW5lbm51bmcgKHVuYmVtZXJrdCkgdm9tIHRhdHNcdTAwRTRjaGxpY2hlbiBOYW1lbiBhYndlaWNoZW4uXHJcbi8vIFNpZSBkYXJmIGRlc2hhbGIgaW4gZGllc2VtIEVkaXRvciBnYXIgbmljaHQgZXJzdCBhbHMgZWlnZW5lIFplaWxlIGF1ZnRhdWNoZW4uXHJcbi8vIE11dGllcnQgXCJmcm9udG1hdHRlclwiIGluLXBsYWNlIChzdGF0dCBlaW5lIEtvcGllIHp1clx1MDBGQ2NrenVnZWJlbikgLSBPYnNpZGlhbnNcclxuLy8gUHJvcGVydHktRWRpdG9yIHNjaGVpbnQgYmVpbSBzeW5jaHJvbml6ZSgpIGF1ZiBlaW5lIHN0YWJpbGUgT2JqZWt0cmVmZXJlbnpcclxuLy8gYW5nZXdpZXNlbiB6dSBzZWluOyBlaW5lIG5ldSBlcnpldWd0ZSBLb3BpZSBoYXQgYmVpbSBhbGxlcmVyc3RlbiBSZW5kZXJuIHp1XHJcbi8vIGVpbmVtIFN0YWNrIE92ZXJmbG93IGluIE9ic2lkaWFucyBlaWdlbmVyIHJlbmRlclByb3BlcnR5KCktUGlwZWxpbmUgZ2VmXHUwMEZDaHJ0LlxyXG5mdW5jdGlvbiBzdHJpcFR5cFByb3BlcnR5KGZyb250bWF0dGVyKSB7XHJcbiAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoZnJvbnRtYXR0ZXIpKSB7XHJcbiAgICBpZiAoU1lTVEVNX1BST1BFUlRJRVMuaW5jbHVkZXMoa2V5LnRyaW0oKS50b0xvd2VyQ2FzZSgpKSkgZGVsZXRlIGZyb250bWF0dGVyW2tleV07XHJcbiAgfVxyXG4gIHJldHVybiBmcm9udG1hdHRlcjtcclxufVxyXG5cclxuLy8gU3BlaWNoZXJvcnQgZWluZXMgRnJvbnRtYXR0ZXItQmxvY2tzIGluIGRlbiBQbHVnaW4tU2V0dGluZ3MgLSBlbnR3ZWRlciBkYXNcclxuLy8gVFlQLUZyb250bWF0dGVyIGVpbmVzIFRZUHMgKHR5cGVEZWZhdWx0RnJvbnRtYXR0ZXIvdHlwZUZsb2F0aW5nS2V5cy9cclxuLy8gdHlwZVNob3J0Y3V0cykgb2RlciBkZXIgQmxvY2sgZWluZXMgc2VpbmVyIFN1YnR5cGVuICh0eXBlU3VidHlwZXMsIHNpZWhlXHJcbi8vIHN1YnR5cGVzLmpzKS4gRWRpdG9yLCBGbG9hdGluZy1NZW5cdTAwRkMsIFNob3J0Y3V0LUtub3BmIHVuZCBQcm9wZXJ0eS1VbWJlbmVubnVuZ1xyXG4vLyBhcmJlaXRlbiBhdXNzY2hsaWVcdTAwREZsaWNoIFx1MDBGQ2JlciBkaWVzZSBTY2huaXR0c3RlbGxlIHVuZCBtXHUwMEZDc3NlbiBkZW4gVW50ZXJzY2hpZWRcclxuLy8gbmljaHQga2VubmVuLlxyXG4vL1xyXG4vLyBnZXRTaG9ydGN1dHMvc2V0U2hvcnRjdXRzIGhhbHRlbiBkaWUgU2hvcnRjdXQtUmVjb3JkcyBqZSBLZXkgKHsgbmFtZSB9LFxyXG4vLyBzaWVoZSBzaG9ydGN1dHMuanMpIC0gYmV3dXNzdCBuZWJlbiBkZW0gRnJvbnRtYXR0ZXIgc3RhdHQgZGFyaW4sIGRhbWl0IGRlclxyXG4vLyBXZXJ0IGRlciBQcm9wZXJ0eSB0eXByZWluIGJsZWlidCB1bmQgT2JzaWRpYW5zIG5hdGl2ZXMgV2lkZ2V0IHVuYW5nZXRhc3RldFxyXG4vLyB3ZWl0ZXJsXHUwMEU0dWZ0LiBEZXIgV2VydCBpbSBGcm9udG1hdHRlciBibGVpYnQgYmVpIGdlc2V0enRlbSBTaG9ydGN1dCBhbHNcclxuLy8gUlx1MDBGQ2NrZmFsbHdlcnQgc3RlaGVuLlxyXG5mdW5jdGlvbiB0eXBlU3RvcmUocGx1Z2luLCB0eXBlKSB7XHJcbiAgcmV0dXJuIHtcclxuICAgIHR5cGUsXHJcbiAgICBzdWJ0eXBlOiBudWxsLFxyXG4gICAgZ2V0RnJvbnRtYXR0ZXI6ICgpID0+IHBsdWdpbi5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdID8/IHt9LFxyXG4gICAgc2V0RnJvbnRtYXR0ZXI6IChmcm9udG1hdHRlcikgPT4ge1xyXG4gICAgICBwbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXSA9IGZyb250bWF0dGVyO1xyXG4gICAgfSxcclxuICAgIGdldEZsb2F0aW5nOiAoKSA9PiBwbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXSA/PyBbXSxcclxuICAgIHNldEZsb2F0aW5nOiAoa2V5cykgPT4ge1xyXG4gICAgICBpZiAoa2V5cy5sZW5ndGggPiAwKSBwbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXSA9IGtleXM7XHJcbiAgICAgIGVsc2UgZGVsZXRlIHBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdO1xyXG4gICAgfSxcclxuICAgIGdldFNob3J0Y3V0czogKCkgPT4gcGx1Z2luLnNldHRpbmdzLnR5cGVTaG9ydGN1dHNbdHlwZV0gPz8ge30sXHJcbiAgICBzZXRTaG9ydGN1dHM6IChzaG9ydGN1dHMpID0+IHtcclxuICAgICAgaWYgKE9iamVjdC5rZXlzKHNob3J0Y3V0cykubGVuZ3RoID4gMCkgcGx1Z2luLnNldHRpbmdzLnR5cGVTaG9ydGN1dHNbdHlwZV0gPSBzaG9ydGN1dHM7XHJcbiAgICAgIGVsc2UgZGVsZXRlIHBsdWdpbi5zZXR0aW5ncy50eXBlU2hvcnRjdXRzW3R5cGVdO1xyXG4gICAgfSxcclxuICB9O1xyXG59XHJcblxyXG5mdW5jdGlvbiBzdWJ0eXBlU3RvcmUocGx1Z2luLCB0eXBlLCBzdWJ0eXBlKSB7XHJcbiAgcmV0dXJuIHtcclxuICAgIHR5cGUsXHJcbiAgICBzdWJ0eXBlLFxyXG4gICAgZ2V0RnJvbnRtYXR0ZXI6ICgpID0+IGdldFN1YnR5cGUocGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKT8uZnJvbnRtYXR0ZXIgPz8ge30sXHJcbiAgICBzZXRGcm9udG1hdHRlcjogKGZyb250bWF0dGVyKSA9PiB7XHJcbiAgICAgIGVuc3VyZVN1YnR5cGUocGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKS5mcm9udG1hdHRlciA9IGZyb250bWF0dGVyO1xyXG4gICAgfSxcclxuICAgIGdldEZsb2F0aW5nOiAoKSA9PiBnZXRTdWJ0eXBlKHBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSk/LmZsb2F0aW5nS2V5cyA/PyBbXSxcclxuICAgIHNldEZsb2F0aW5nOiAoa2V5cykgPT4ge1xyXG4gICAgICBlbnN1cmVTdWJ0eXBlKHBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSkuZmxvYXRpbmdLZXlzID0ga2V5cztcclxuICAgIH0sXHJcbiAgICBnZXRTaG9ydGN1dHM6ICgpID0+IGdldFN1YnR5cGUocGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKT8uc2hvcnRjdXRzID8/IHt9LFxyXG4gICAgc2V0U2hvcnRjdXRzOiAoc2hvcnRjdXRzKSA9PiB7XHJcbiAgICAgIGVuc3VyZVN1YnR5cGUocGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKS5zaG9ydGN1dHMgPSBzaG9ydGN1dHM7XHJcbiAgICB9LFxyXG4gIH07XHJcbn1cclxuXHJcbi8vIE9ic2lkaWFucyBlaWdlbmVzIEZyb250bWF0dGVyLVdpZGdldCAoXCJQcm9wZXJ0aWVzXCIpIGlzdCBrZWluZSBvZmZpemllbGxlXHJcbi8vIFBsdWdpbi1BUEkuIEludGVybiBpc3QgZXMgZWluZSBDb21wb25lbnQtS2xhc3NlIChpbSBnZWJhdXRlbiBhcHAuanMgenVcclxuLy8gXCJNZXRhZGF0YUVkaXRvclwiIG1pbmlmaXppZXJ0KSwgZGllIHNvd29obCB2b24gamVkZXIgTWFya2Rvd25WaWV3IGFscyBhdWNoIHZvblxyXG4vLyBkZXIgZWluZ2ViYXV0ZW4gXCJGaWxlIFByb3BlcnRpZXNcIi1QYW5lIHZlcndlbmRldCB3aXJkIC0gYmVpZGUgbGVnZW4gc2ljaCBiZWltXHJcbi8vIEVyemV1Z2VuIHVuY29uZGl0aW9uYWwgZWluZSBJbnN0YW56IHVudGVyIHZpZXcubWV0YWRhdGFFZGl0b3IgYW4uIERpZSBLbGFzc2VcclxuLy8gc2VsYnN0IHdpcmQgbmlyZ2VuZHMgdW50ZXIgZWluZW0gTmFtZW4gZXhwb3J0aWVydCwgaXN0IGFiZXIgXHUwMEZDYmVyIGVpbmVcclxuLy8gYmVsaWViaWdlIGJlcmVpdHMgdm9yaGFuZGVuZSBJbnN0YW56IGVycmVpY2hiYXIgKGluc3RhbmNlLmNvbnN0cnVjdG9yKSB1bmRcclxuLy8gYmxlaWJ0IGZcdTAwRkNyIGRpZSBEYXVlciBkZXIgT2JzaWRpYW4tU2Vzc2lvbiBzdGFiaWwgLSBlaW5tYWxpZ2VzIEFiZ3JlaWZlbiB1bmRcclxuLy8gWndpc2NoZW5zcGVpY2hlcm4gcmVpY2h0IGRlc2hhbGIgYXVzLlxyXG5sZXQgY2FjaGVkRWRpdG9yQ2xhc3MgPSBudWxsO1xyXG5cclxuZnVuY3Rpb24gZ2V0TWV0YWRhdGFFZGl0b3JDbGFzcyhhcHApIHtcclxuICBpZiAoY2FjaGVkRWRpdG9yQ2xhc3MpIHJldHVybiBjYWNoZWRFZGl0b3JDbGFzcztcclxuXHJcbiAgY29uc3QgYWN0aXZlID0gYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XHJcbiAgaWYgKGFjdGl2ZT8ubWV0YWRhdGFFZGl0b3IpIHtcclxuICAgIGNhY2hlZEVkaXRvckNsYXNzID0gYWN0aXZlLm1ldGFkYXRhRWRpdG9yLmNvbnN0cnVjdG9yO1xyXG4gICAgcmV0dXJuIGNhY2hlZEVkaXRvckNsYXNzO1xyXG4gIH1cclxuICBmb3IgKGNvbnN0IGxlYWYgb2YgYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xyXG4gICAgaWYgKGxlYWYudmlldz8ubWV0YWRhdGFFZGl0b3IpIHtcclxuICAgICAgY2FjaGVkRWRpdG9yQ2xhc3MgPSBsZWFmLnZpZXcubWV0YWRhdGFFZGl0b3IuY29uc3RydWN0b3I7XHJcbiAgICAgIHJldHVybiBjYWNoZWRFZGl0b3JDbGFzcztcclxuICAgIH1cclxuICB9XHJcbiAgcmV0dXJuIG51bGw7XHJcbn1cclxuXHJcbi8vIEFuYWxvZyB6dSBnZXRNZXRhZGF0YUVkaXRvckNsYXNzIG9iZW46IFJlZmVyZW56IGF1ZiBkaWUgcHJpdmF0ZSBQcm9wZXJ0eS1cclxuLy8gWmVpbGVuLUtsYXNzZSAoaW0gZ2ViYXV0ZW4gYXBwLmpzIG1pbmlmaXppZXJ0KSwgXHUwMEZDYmVyIGVpbmUgYmVyZWl0c1xyXG4vLyBnZXJlbmRlcnRlIFplaWxlIGFiZ2VncmlmZmVuIChkZXJlbiAuY29uc3RydWN0b3IpIC0gc3RhYmlsIGZcdTAwRkNyIGRpZSBEYXVlclxyXG4vLyBkZXIgU2Vzc2lvbi4gXCJlZGl0b3JcIiAoZmFsbHMgc2Nob24gdm9yaGFuZGVuKSB3aXJkIHp1ZXJzdCBwcm9iaWVydCwgZGFcclxuLy8gZGllc2UgS2xhc3NlIGF1c3NjaGxpZVx1MDBERmxpY2ggZlx1MDBGQ3IgZW5zdXJlUHJvcGVydHlNZW51UGF0Y2goKSBnZWJyYXVjaHQgd2lyZFxyXG4vLyB1bmQgaW4gYWxsZXIgUmVnZWwgc2Nob24gZG9ydCB2ZXJmXHUwMEZDZ2JhciBpc3QsIHNvYmFsZCBkZXIgVHlwIG1pbmRlc3RlbnNcclxuLy8gZWluZSBQcm9wZXJ0eSBoYXQuXHJcbmxldCBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzID0gbnVsbDtcclxuXHJcbmZ1bmN0aW9uIGdldFByb3BlcnR5Um93Q2xhc3MoYXBwLCBlZGl0b3IpIHtcclxuICBpZiAoY2FjaGVkUHJvcGVydHlSb3dDbGFzcykgcmV0dXJuIGNhY2hlZFByb3BlcnR5Um93Q2xhc3M7XHJcbiAgaWYgKGVkaXRvcj8ucmVuZGVyZWQ/LlswXSkge1xyXG4gICAgY2FjaGVkUHJvcGVydHlSb3dDbGFzcyA9IGVkaXRvci5yZW5kZXJlZFswXS5jb25zdHJ1Y3RvcjtcclxuICAgIHJldHVybiBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzO1xyXG4gIH1cclxuICBjb25zdCBhY3RpdmUgPSBhcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcclxuICBpZiAoYWN0aXZlPy5tZXRhZGF0YUVkaXRvcj8ucmVuZGVyZWQ/LlswXSkge1xyXG4gICAgY2FjaGVkUHJvcGVydHlSb3dDbGFzcyA9IGFjdGl2ZS5tZXRhZGF0YUVkaXRvci5yZW5kZXJlZFswXS5jb25zdHJ1Y3RvcjtcclxuICAgIHJldHVybiBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzO1xyXG4gIH1cclxuICBmb3IgKGNvbnN0IGxlYWYgb2YgYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xyXG4gICAgaWYgKGxlYWYudmlldz8ubWV0YWRhdGFFZGl0b3I/LnJlbmRlcmVkPy5bMF0pIHtcclxuICAgICAgY2FjaGVkUHJvcGVydHlSb3dDbGFzcyA9IGxlYWYudmlldy5tZXRhZGF0YUVkaXRvci5yZW5kZXJlZFswXS5jb25zdHJ1Y3RvcjtcclxuICAgICAgcmV0dXJuIGNhY2hlZFByb3BlcnR5Um93Q2xhc3M7XHJcbiAgICB9XHJcbiAgfVxyXG4gIHJldHVybiBudWxsO1xyXG59XHJcblxyXG4vLyBFcmdcdTAwRTRuenQgZGFzIFJlY2h0c2tsaWNrLUtvbnRleHRtZW5cdTAwRkMgZWluZXIgUHJvcGVydHktWmVpbGUgdW0gZWluZW4gVG9nZ2xlXHJcbi8vIFwiRmxvYXRpbmdcIiBHQU5aIE9CRU4gLSBhYmVyIGV4a2x1c2l2IGZcdTAwRkNyIFplaWxlbiBkaWVzZXMgUGx1Z2luc1xyXG4vLyBlaWdlbmVyIFRZUC1EZXRhaWxhbnNpY2h0IChlcmthbm50IGFuIG93bmVyLmZyZWRTdG9yZSwgc2llaGUgdW50ZW4pLCBuaWUgaW5cclxuLy8gZWNodGVuIE5vdGl6ZW4uIFVuYWJoXHUwMEU0bmdpZyB2b20gXCIrXCItQnV0dG9uIGxpbmtzIG5lYmVuIGRlbSBub3JtYWxlblxyXG4vLyAoZnJlZFBlbmRpbmdGbG9hdGluZ0FkZCksIGRlciBudXIgYmVpbSBORVVFTiBBbmxlZ2VuIGdyZWlmdCAtIGRpZXNlciBUb2dnbGVcclxuLy8gd2lya3QgYXVmIEpFREUgYmVyZWl0cyB2b3JoYW5kZW5lIFByb3BlcnR5LCBpbiBiZWlkZSBSaWNodHVuZ2VuLlxyXG4vL1xyXG4vLyBPYnNpZGlhbnMgUHJvcGVydHktS29udGV4dG1lblx1MDBGQyBpc3Qga2VpbmUgb2ZmaXppZWxsZSBFcndlaXRlcnVuZ3NzdGVsbGU6IEVzXHJcbi8vIGJhdXQgYXVmIGRlbSBEZXNrdG9wIGVpbmVuIE5BVElWRU4gRWxlY3Ryb24tTWVuXHUwMEZDIGF1cyBlaW5lciBpbnRlcm5cclxuLy8gZXJ6ZXVndGVuIE1lbnUtSW5zdGFueiB1bmQgemVpZ3Qgc2llIGlubmVyaGFsYiB2b24gc2hvd1Byb3BlcnR5TWVudSgpIGluXHJcbi8vIGVpbmVtIGVpbnppZ2VuIHN5bmNocm9uZW4gQXVmcnVmIGFuIChrZWluIFdvcmtzcGFjZS1FdmVudCwga2VpbiBET00tUG9wdXAsXHJcbi8vIGRhcyBzaWNoIG5hY2h0clx1MDBFNGdsaWNoIHBlciBET00tTWFuaXB1bGF0aW9uIGVyd2VpdGVybiBsaWVcdTAwREZlIC0gYW5kZXJzIGFsc1xyXG4vLyB6LiBCLiBiZWkgXCJmaWxlLW1lbnVcIikuIERlc2hhbGIgaGllciBlaW4gTW9ua2V5LVBhdGNoIGF1ZiBkaWUgcHJpdmF0ZVxyXG4vLyBaZWlsZW4tS2xhc3NlIHNlbGJzdCAod2llIHNjaG9uIGJlaW0gR3JhcGgtUmVuZGVyZXIsIHNpZWhlXHJcbi8vIGdyYXBoLWNvbG9ycy5qcyksIGFiZXIgc28gZW5nIHdpZSBtXHUwMEY2Z2xpY2ggZ2VoYWx0ZW46IGZcdTAwRkNyIFplaWxlbiBkaWVzZXNcclxuLy8gUGx1Z2lucyB3aXJkIGxlZGlnbGljaCwgdW5taXR0ZWxiYXIgYmV2b3IgT2JzaWRpYW4gc2VpbmUgYmVyZWl0cyBmZXJ0aWdcclxuLy8gYXVmZ2ViYXV0ZSBNZW51LUluc3RhbnogYW56ZWlndCwgZWluIGVpbnppZ2VyIHp1c1x1MDBFNHR6bGljaGVyIGFkZEl0ZW0oKS1BdWZydWZcclxuLy8gZGF6d2lzY2hlbmdlc2Nob2JlbiAoXHUwMEZDYmVyIGVpbmVuIG51ciBmXHUwMEZDciBkaWVzZW4gZWluZW4gc3luY2hyb25lbiBBdWZydWZcclxuLy8gYWt0aXZlbiwgc2ljaCBkYW5hY2ggc2VsYnN0IHdpZWRlciB6dXJcdTAwRkNja3NldHplbmRlbiBQYXRjaCBhdWZcclxuLy8gTWVudS5wcm90b3R5cGUuc2hvd0F0TW91c2VFdmVudCAtIHNpY2hlciwgZGEgSlMgc2luZ2xlLXRocmVhZGVkIGlzdCB1bmRcclxuLy8gd1x1MDBFNGhyZW5kZGVzc2VuIGtlaW4gendlaXRlcyBNZW5cdTAwRkMgYXVmZ2ViYXV0IHdlcmRlbiBrYW5uKS4gRGllIGdlc2FtdGUgXHUwMEZDYnJpZ2VcclxuLy8gbmF0aXZlIE1lblx1MDBGQy1Mb2dpayAoVHlwIFx1MDBFNG5kZXJuLCBBdXNzY2huZWlkZW4vS29waWVyZW4vRWluZlx1MDBGQ2dlbiwgRW50ZmVybmVuKVxyXG4vLyBibGVpYnQgZGFiZWkga29tcGxldHQgdW5hbmdldGFzdGV0LlxyXG5mdW5jdGlvbiBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaChhcHAsIGVkaXRvcikge1xyXG4gIGNvbnN0IFJvd0NsYXNzID0gZ2V0UHJvcGVydHlSb3dDbGFzcyhhcHAsIGVkaXRvcik7XHJcbiAgaWYgKCFSb3dDbGFzcyB8fCBSb3dDbGFzcy5fZnJlZE1lbnVQYXRjaGVkKSByZXR1cm47XHJcbiAgUm93Q2xhc3MuX2ZyZWRNZW51UGF0Y2hlZCA9IHRydWU7XHJcblxyXG4gIGNvbnN0IG9yaWdpbmFsU2hvd1Byb3BlcnR5TWVudSA9IFJvd0NsYXNzLnByb3RvdHlwZS5zaG93UHJvcGVydHlNZW51O1xyXG4gIFJvd0NsYXNzLnByb3RvdHlwZS5zaG93UHJvcGVydHlNZW51ID0gZnVuY3Rpb24gKGV2ZW50KSB7XHJcbiAgICBjb25zdCBvd25lciA9IHRoaXMubWV0YWRhdGFFZGl0b3I/Lm93bmVyO1xyXG4gICAgaWYgKCFvd25lcj8uZnJlZFN0b3JlKSByZXR1cm4gb3JpZ2luYWxTaG93UHJvcGVydHlNZW51LmNhbGwodGhpcywgZXZlbnQpO1xyXG5cclxuICAgIGNvbnN0IHJvdyA9IHRoaXM7XHJcbiAgICBjb25zdCBvcmlnaW5hbFNob3dBdE1vdXNlRXZlbnQgPSBNZW51LnByb3RvdHlwZS5zaG93QXRNb3VzZUV2ZW50O1xyXG4gICAgTWVudS5wcm90b3R5cGUuc2hvd0F0TW91c2VFdmVudCA9IGZ1bmN0aW9uIChtb3VzZUV2ZW50KSB7XHJcbiAgICAgIE1lbnUucHJvdG90eXBlLnNob3dBdE1vdXNlRXZlbnQgPSBvcmlnaW5hbFNob3dBdE1vdXNlRXZlbnQ7XHJcbiAgICAgIGNvbnN0IGlzRmxvYXRpbmcgPSBvd25lci5mcmVkU3RvcmUuZ2V0RmxvYXRpbmcoKS5pbmNsdWRlcyhyb3cuZW50cnkua2V5KTtcclxuICAgICAgLy8gXCJ0aXRsZVwiIGlzdCBkaWUgZXJzdGUgZGVyIHZvbiBzaG93UHJvcGVydHlNZW51IHJlZ2lzdHJpZXJ0ZW5cclxuICAgICAgLy8gU2VjdGlvbnMgKGFkZFNlY3Rpb25zKFsuLi5dKSkgdW5kIGF1ZiBkZW0gRGVza3RvcCBzb25zdCBsZWVyIChudXJcclxuICAgICAgLy8gYXVmIE1vYmlsZSBtaXQgZWluZW0gcmVpbmVuIExhYmVsLUVpbnRyYWcgYmVsZWd0KSAtIGxhbmRldCBhbHNvXHJcbiAgICAgIC8vIHp1dmVybFx1MDBFNHNzaWcgZ2FueiBvYmVuLiBcInBpbi1vZmZcIiAoZHVyY2hnZXN0cmljaGVuZXIgUGluKSBwYXNzdFxyXG4gICAgICAvLyBpbmhhbHRsaWNoIHp1IFwibmljaHQgZmVzdCB2ZXJhbmtlcnRcIiA9IGZsb2F0aW5nLCBpbiBBbmFsb2dpZSB6dVxyXG4gICAgICAvLyBcInBpblwiIGZcdTAwRkNyIFwiZml4aWVydFwiIGluIGFuZGVyZW4gQXBwcy5cclxuICAgICAgdGhpcy5hZGRJdGVtKChpdGVtKSA9PlxyXG4gICAgICAgIGl0ZW1cclxuICAgICAgICAgIC5zZXRUaXRsZShcIkZsb2F0aW5nXCIpXHJcbiAgICAgICAgICAuc2V0SWNvbihcInBpbi1vZmZcIilcclxuICAgICAgICAgIC5zZXRDaGVja2VkKGlzRmxvYXRpbmcpXHJcbiAgICAgICAgICAuc2V0U2VjdGlvbihcInRpdGxlXCIpXHJcbiAgICAgICAgICAub25DbGljaygoKSA9PiB0b2dnbGVGbG9hdGluZ1Byb3BlcnR5KG93bmVyLmZyZWRWaWV3LCBvd25lci5mcmVkU3RvcmUsIHJvdy5lbnRyeS5rZXkpKVxyXG4gICAgICApO1xyXG4gICAgICByZXR1cm4gb3JpZ2luYWxTaG93QXRNb3VzZUV2ZW50LmNhbGwodGhpcywgbW91c2VFdmVudCk7XHJcbiAgICB9O1xyXG5cclxuICAgIHJldHVybiBvcmlnaW5hbFNob3dQcm9wZXJ0eU1lbnUuY2FsbCh0aGlzLCBldmVudCk7XHJcbiAgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gdG9nZ2xlRmxvYXRpbmdQcm9wZXJ0eSh2aWV3LCBzdG9yZSwga2V5KSB7XHJcbiAgY29uc3QgZmxvYXRpbmcgPSBzdG9yZS5nZXRGbG9hdGluZygpO1xyXG4gIHN0b3JlLnNldEZsb2F0aW5nKGZsb2F0aW5nLmluY2x1ZGVzKGtleSkgPyBmbG9hdGluZy5maWx0ZXIoKGspID0+IGsgIT09IGtleSkgOiBbLi4uZmxvYXRpbmcsIGtleV0pO1xyXG4gIHZpZXcucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gIC8vIEFrdHVhbGlzaWVydCBkaWUgRmV0dC0vS3Vyc2l2LU1hcmtpZXJ1bmcgc29mb3J0IC0gc293b2hsIGluIGRpZXNlclxyXG4gIC8vIERldGFpbGFuc2ljaHQgYWxzIGF1Y2ggaW4gYmVyZWl0cyBvZmZlbmVuIE5vdGl6ZW4gZGllc2VzIFR5cHMuXHJcbiAgdmlldy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbn1cclxuXHJcbi8vIERhcyBXaWRnZXQgZXJ3YXJ0ZXQgYWxzIHp3ZWl0ZW4gS29uc3RydWt0b3ItUGFyYW1ldGVyIGVpbiBcIm93bmVyXCItT2JqZWt0IC1cclxuLy8gZGFzIGlzdCBkaWUgZWluemlnZSBTY2huaXR0c3RlbGxlLCBcdTAwRkNiZXIgZGllIGVzIGFuIGVpbmUgRGF0ZWkgZ2VidW5kZW4gd2lyZC5cclxuLy8gU3RhdHQgZWluZXIgZWNodGVuIE5vdGl6IGhcdTAwRTRuZ2VuIHdpciBlcyBoaWVyIGFuIGVpbiBQbGFpbi1PYmplY3QgaW4gZGVuXHJcbi8vIFBsdWdpbi1TZXR0aW5nczogc2F2ZUZyb250bWF0dGVyKG9iaikgYmVrb21tdCBiZWkgamVkZXIgXHUwMEM0bmRlcnVuZyAoUHJvcGVydHlcclxuLy8gaGluenVnZWZcdTAwRkNndC91bWJlbmFubnQvZ2VsXHUwMEY2c2NodCwgV2VydCBnZVx1MDBFNG5kZXJ0LCBSZWloZW5mb2xnZSBnZVx1MDBFNG5kZXJ0KSBkYXNcclxuLy8gdm9sbHN0XHUwMEU0bmRpZ2UsIGFrdHVlbGxlIFByb3BlcnR5LVNldCBcdTAwRkNiZXJnZWJlbi4gc2hpZnRGb2N1c0JlZm9yZS9BZnRlciBzdGV1ZXJuXHJcbi8vIG51ciwgd29oaW4gZGVyIEZva3VzIGJlaW0gVmVybGFzc2VuIGRlcyBXaWRnZXRzIHBlciBQZmVpbHRhc3RlL1RhYiBzcHJpbmd0LFxyXG4vLyB1bmQgZFx1MDBGQ3JmZW4gTm8tT3BzIHNlaW4uIGdldEZpbGUoKSB3aXJkIHZvbiBqZWRlciBlaW56ZWxuZW4gUHJvcGVydHktWmVpbGVcclxuLy8gYmVpbSBSZW5kZXJuIGF1ZmdlcnVmZW4gKGZcdTAwRkNyIHNvdXJjZVBhdGgsIHouIEIuIGJlaSBMaW5rLVdlcnRlbikgLSBvaG5lXHJcbi8vIGVjaHRlIERhdGVpIGdpYnQgZXMgaGllciBuaWNodHMgU2lubnZvbGxlcyB6dXJcdTAwRkNja3p1Z2ViZW4sIGFiZXIgZGllIE1ldGhvZGVcclxuLy8gbXVzcyBleGlzdGllcmVuLCBzb25zdCBjcmFzaHQgZGFzIFdpZGdldCBiZWltIFJlbmRlcm4gamVkZXIgUHJvcGVydHkuXHJcbi8vXHJcbi8vIEVpbmUgRWRpdG9yLUluc3RhbnogamUgQmxvY2sgKFRZUCBiencuIFN1YnR5cCksIGdlYnVuZGVuIGFuIGRlbiBTcGVpY2hlcm9ydFxyXG4vLyBhdXMgc3RvcmUgKHNpZWhlIHR5cGVTdG9yZS9zdWJ0eXBlU3RvcmUpIC0gU3RhbmRhcmQtIHVuZCBGbG9hdGluZyBQcm9wZXJ0aWVzXHJcbi8vIChzaWVoZSB0eXBlRmxvYXRpbmdLZXlzIGluIHNldHRpbmdzLmpzKSB0ZWlsZW4gc2ljaCBkaWVzZWxiZSBMaXN0ZSB1bmRcclxuLy8gUmVpaGVuZm9sZ2UsIG51ciBGbG9hdGluZy1tYXJraWVydGUgS2V5cyB3ZXJkZW4gdm9uIGdldFR5cGVEZWZhdWx0cygpXHJcbi8vIChtYWluLmpzKSBuaWNodCBhdXRvbWF0aXNjaCBhdXNnZWxpZWZlcnQuIGVkaXRvci5mcmVkUGVuZGluZ0Zsb2F0aW5nQWRkIHdpcmRcclxuLy8gdm9uIHR5cC12aWV3LmpzIHZvciBhZGRCbGFua1Byb3BlcnR5KCkgZ2VzZXR6dCwgdW0gZGllIGFscyBuXHUwMEU0Y2hzdGVzXHJcbi8vIGhpbnp1Z2VmXHUwMEZDZ3RlIChiencuIHVtYmVuYW5udGUpIFByb3BlcnR5IGFscyBGbG9hdGluZyB6dSBtYXJraWVyZW4gLSBzaWVoZVxyXG4vLyBzYXZlRnJvbnRtYXR0ZXIgdW50ZW4uXHJcbi8vIFRhc3RhdHVyLU5hdmlnYXRpb24gXHUwMEZDYmVyIGRpZSBHcmVuemVuIGVpbmVyIEVkaXRvci1JbnN0YW56IGhpbmF1cyAoc2llaGVcclxuLy8gZnJvbnRtYXR0ZXItYmxvY2tzLmpzKTogT2JzaWRpYW4gYmV3ZWd0IGRlbiBGb2t1cyBudXIgaW5uZXJoYWxiIHNlaW5lclxyXG4vLyBlaWdlbmVuIFplaWxlbmxpc3RlIC0gYW0gb2JlcmVuIEVuZGUgc3ByaW5ndCBlciBhdWYgZGllIFx1MDBEQ2JlcnNjaHJpZnQgZGVzXHJcbi8vIEVkaXRvcnMsIGFtIHVudGVyZW4gYXVmIGRlc3NlbiBcIkFkZCBwcm9wZXJ0eVwiLUJ1dHRvbi4gQmVpZGUgc2luZCBoaWVyIHBlclxyXG4vLyBDU1MgYXVzZ2VibGVuZGV0LCBkaWUgS2V0dGUgZW5kZXRlIGFsc28gYW0gQmxvY2tyYW5kLlxyXG4vL1xyXG4vLyBTdGF0dCBvd25lci5zaGlmdEZvY3VzQmVmb3JlL3NoaWZ0Rm9jdXNBZnRlciAoZGllIE9ic2lkaWFuIG51ciBcdTAwRkNiZXIgZ2VuYXVcclxuLy8gZGllc2UgYmVpZGVuIGF1c2dlYmxlbmRldGVuIEVsZW1lbnRlIGVycmVpY2h0KSBkYWhlciBlaW4gZWlnZW5lciBIYW5kbGVyIGluXHJcbi8vIGRlciBDYXB0dXJlLVBoYXNlLCBkZXIgVk9SIGRlbSBIYW5kbGVyIGRlciBaZWlsZSBsXHUwMEU0dWZ0LiBFciBncmVpZnQgbnVyLCB3ZW5uXHJcbi8vIGRpZSBaZWlsZSBTRUxCU1QgZGVuIEZva3VzIGhhdCAoZXZlbnQudGFyZ2V0ID09PSBjb250YWluZXJFbCBkZXIgWmVpbGUpIC1cclxuLy8gZ2VuYXUgZGllIEJlZGluZ3VuZywgdW50ZXIgZGVyIGF1Y2ggT2JzaWRpYW4gc2VpbmUgai9rLU5hdmlnYXRpb24genVsXHUwMEU0c3N0LFxyXG4vLyBiZWltIFRpcHBlbiBpbiBlaW5lbSBLZXktL1dlcnQtRmVsZCBhbHNvIG5pZS5cclxuZnVuY3Rpb24gcmVnaXN0ZXJGb2N1c0NoYWluKGVkaXRvciwgb25TaGlmdEZvY3VzKSB7XHJcbiAgZWRpdG9yLmNvbnRhaW5lckVsLmFkZEV2ZW50TGlzdGVuZXIoXHJcbiAgICBcImtleWRvd25cIixcclxuICAgIChldmVudCkgPT4ge1xyXG4gICAgICBpZiAoZXZlbnQuaXNDb21wb3NpbmcgfHwgZXZlbnQuZGVmYXVsdFByZXZlbnRlZCkgcmV0dXJuO1xyXG4gICAgICAvLyBNZWhyZmFjaC1BdXN3YWhsOiBPYnNpZGlhbiBlcndlaXRlcnQgZGFtaXQgZGllIEF1c3dhaGwsIHN0YXR0IGRlblxyXG4gICAgICAvLyBGb2t1cyB6dSBiZXdlZ2VuLlxyXG4gICAgICBpZiAoZWRpdG9yLnNlbGVjdGVkTGluZXM/LnNpemUgPiAxKSByZXR1cm47XHJcbiAgICAgIGlmIChldmVudC5zaGlmdEtleSAmJiAoZXZlbnQua2V5ID09PSBcIkFycm93VXBcIiB8fCBldmVudC5rZXkgPT09IFwiQXJyb3dEb3duXCIpKSByZXR1cm47XHJcblxyXG4gICAgICBjb25zdCBpbmRleCA9IGVkaXRvci5yZW5kZXJlZC5maW5kSW5kZXgoKHJvdykgPT4gcm93LmNvbnRhaW5lckVsID09PSBldmVudC50YXJnZXQpO1xyXG4gICAgICBpZiAoaW5kZXggPT09IC0xKSByZXR1cm47XHJcblxyXG4gICAgICBjb25zdCB1cCA9IGV2ZW50LmtleSA9PT0gXCJBcnJvd1VwXCIgfHwgZXZlbnQua2V5ID09PSBcImtcIiB8fCAoZXZlbnQua2V5ID09PSBcIlRhYlwiICYmIGV2ZW50LnNoaWZ0S2V5KTtcclxuICAgICAgY29uc3QgZG93biA9IGV2ZW50LmtleSA9PT0gXCJBcnJvd0Rvd25cIiB8fCBldmVudC5rZXkgPT09IFwialwiIHx8IChldmVudC5rZXkgPT09IFwiVGFiXCIgJiYgIWV2ZW50LnNoaWZ0S2V5KTtcclxuICAgICAgbGV0IHN0ZXAgPSAwO1xyXG4gICAgICBpZiAodXAgJiYgaW5kZXggPT09IDApIHN0ZXAgPSAtMTtcclxuICAgICAgZWxzZSBpZiAoZG93biAmJiBpbmRleCA9PT0gZWRpdG9yLnJlbmRlcmVkLmxlbmd0aCAtIDEpIHN0ZXAgPSAxO1xyXG4gICAgICBpZiAoc3RlcCA9PT0gMCB8fCAhb25TaGlmdEZvY3VzKHN0ZXApKSByZXR1cm47XHJcblxyXG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgIH0sXHJcbiAgICB0cnVlXHJcbiAgKTtcclxufVxyXG5cclxuZnVuY3Rpb24gbW91bnRGcm9udG1hdHRlckVkaXRvcih2aWV3LCBjb250YWluZXJFbCwgc3RvcmUsIHsgb25TaGlmdEZvY3VzIH0gPSB7fSkge1xyXG4gIGNvbnN0IGFwcCA9IHZpZXcuYXBwO1xyXG4gIGNvbnN0IEVkaXRvckNsYXNzID0gZ2V0TWV0YWRhdGFFZGl0b3JDbGFzcyhhcHApO1xyXG4gIGlmICghRWRpdG9yQ2xhc3MpIHtcclxuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwicFwiLCB7XHJcbiAgICAgIGNsczogXCJmcmVkLXR5cC1mcm9udG1hdHRlci11bmF2YWlsYWJsZVwiLFxyXG4gICAgICB0ZXh0OiBcIlp1bSBJbml0aWFsaXNpZXJlbiBkZXMgRWRpdG9ycyBiaXR0ZSB6dWVyc3QgZWlubWFsIGVpbmUgTm90aXogXHUwMEY2ZmZuZW4uXCIsXHJcbiAgICB9KTtcclxuICAgIHJldHVybiBudWxsO1xyXG4gIH1cclxuXHJcbiAgY29uc3Qgb3duZXIgPSB7XHJcbiAgICBhcHAsXHJcbiAgICAvLyBNYXJrZXIgZlx1MDBGQ3IgZW5zdXJlUHJvcGVydHlNZW51UGF0Y2goKSBvYmVuOiBpZGVudGlmaXppZXJ0IFByb3BlcnR5LVxyXG4gICAgLy8gWmVpbGVuIGRpZXNlcyBQbHVnaW4tZWlnZW5lbiBFZGl0b3JzIChuaWUgZWluZXIgZWNodGVuIE5vdGl6KSB1bmRcclxuICAgIC8vIGxpZWZlcnQgU3BlaWNoZXJvcnQvVmlldywgZGllIGRlciBnbG9iYWxlIE1lblx1MDBGQy1QYXRjaCBwcm8gWmVpbGVcclxuICAgIC8vIGR5bmFtaXNjaCBicmF1Y2h0IChkaWUgUGF0Y2gtSW5zdGFsbGF0aW9uIHNlbGJzdCBwYXNzaWVydCBudXIgZWlubWFsLFxyXG4gICAgLy8gdW5hYmhcdTAwRTRuZ2lnIGRhdm9uLCB3ZWxjaGVyIEJsb2NrIGRhYmVpIGdlcmFkZSBvZmZlbiB3YXIpLlxyXG4gICAgZnJlZFN0b3JlOiBzdG9yZSxcclxuICAgIGZyZWRWaWV3OiB2aWV3LFxyXG4gICAgZ2V0RmlsZSgpIHtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9LFxyXG4gICAgLy8gTnVyIGZcdTAwRkNyIE9ic2lkaWFucyBIb3Zlci1QcmV2aWV3IGJlaSBpbnRlcm5lbiBMaW5rcyBpbm5lcmhhbGIgZWluZXNcclxuICAgIC8vIFByb3BlcnR5LVdlcnRzIChFdmVudCBcImhvdmVyLWxpbmtcIikgLSBiZWxpZWJpZ2VyIFN0cmluZyByZWljaHQuXHJcbiAgICBnZXRIb3ZlclNvdXJjZSgpIHtcclxuICAgICAgcmV0dXJuIFwiZnJlZC10eXAtZnJvbnRtYXR0ZXJcIjtcclxuICAgIH0sXHJcbiAgICBzaGlmdEZvY3VzQmVmb3JlKCkge30sXHJcbiAgICBzaGlmdEZvY3VzQWZ0ZXIoKSB7fSxcclxuICAgIC8vIE9ic2lkaWFucyBFZGl0b3IgcnVmdCBkaWVzIGdlbmF1IGVpbm1hbCBwcm8gYWJnZXNjaGxvc3NlbmVyIFx1MDBDNG5kZXJ1bmcgYXVmXHJcbiAgICAvLyAoUmVuYW1lIGVyc3QgYmVpbSBCbHVyIGRlcyBLZXktSW5wdXRzLCBzaWVoZSBoYW5kbGVVcGRhdGVLZXkgaW1cclxuICAgIC8vIGdlYmF1dGVuIGFwcC5qcykgLSBqZWRlciBBdWZydWYgdHJcdTAwRTRndCBoaWVyIGFsc28gbWF4aW1hbCBlaW5lXHJcbiAgICAvLyBoaW56dWdlZlx1MDBGQ2d0ZSB1bmQvb2RlciBlbnRmZXJudGUgKG5pY2h0LWxlZXJlKSBQcm9wZXJ0eSwgbmllIG1laHJlcmVcclxuICAgIC8vIGdsZWljaHplaXRpZyBhdVx1MDBERmVyIGJlaSBlaW5lbSBNZWhyZmFjaC1MXHUwMEY2c2NoZW4uIERhcyBtYWNodCBkaWVcclxuICAgIC8vIEZsb2F0aW5nLU1hcmtpZXJ1bmcgdW50ZW4gcm9idXN0IG5hY2hmXHUwMEZDaHJiYXIsIG9obmUgWndpc2NoZW56dXN0XHUwMEU0bmRlXHJcbiAgICAvLyB3XHUwMEU0aHJlbmQgZGVzIFRpcHBlbnMgdmVyZm9sZ2VuIHp1IG1cdTAwRkNzc2VuLlxyXG4gICAgc2F2ZUZyb250bWF0dGVyKGZyb250bWF0dGVyKSB7XHJcbiAgICAgIC8vIEZhbGxzIGhpZXIgZ2VyYWRlIGVpbmUgWmVpbGUgXCJUWVBcIi9cIlNVQlRZUFwiIGVpbmdlZ2ViZW4gd3VyZGU6IG5pY2h0IFx1MDBGQ2Jlcm5laG1lbi5cclxuICAgICAgLy8gU2llIGJsZWlidCBiaXMgenVtIG5cdTAwRTRjaHN0ZW4gTmV1LU1vdW50ZW4gc2ljaHRiYXIgKGtlaW4gZXJuZXV0ZXJcclxuICAgICAgLy8gc3luY2hyb25pemUoKS1BdWZydWYgaGllciwgc2llaGUgS29tbWVudGFyIGFuIHN0cmlwVHlwUHJvcGVydHkpLlxyXG4gICAgICBzdHJpcFR5cFByb3BlcnR5KGZyb250bWF0dGVyKTtcclxuXHJcbiAgICAgIGNvbnN0IHByZXZpb3VzID0gc3RvcmUuZ2V0RnJvbnRtYXR0ZXIoKTtcclxuICAgICAgY29uc3QgcHJldmlvdXNLZXlzID0gT2JqZWN0LmtleXMocHJldmlvdXMpLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwiXCIpO1xyXG4gICAgICBjb25zdCBjdXJyZW50S2V5cyA9IE9iamVjdC5rZXlzKGZyb250bWF0dGVyKS5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBcIlwiKTtcclxuICAgICAgY29uc3QgcmVtb3ZlZEtleXMgPSBwcmV2aW91c0tleXMuZmlsdGVyKChrZXkpID0+ICFjdXJyZW50S2V5cy5pbmNsdWRlcyhrZXkpKTtcclxuICAgICAgY29uc3QgYWRkZWRLZXlzID0gY3VycmVudEtleXMuZmlsdGVyKChrZXkpID0+ICFwcmV2aW91c0tleXMuaW5jbHVkZXMoa2V5KSk7XHJcblxyXG4gICAgICBsZXQgZmxvYXRpbmcgPSBzdG9yZS5nZXRGbG9hdGluZygpO1xyXG4gICAgICBpZiAocmVtb3ZlZEtleXMubGVuZ3RoID09PSAxICYmIGFkZGVkS2V5cy5sZW5ndGggPT09IDEpIHtcclxuICAgICAgICAvLyBVbWJlbmVubnVuZyBlaW5lciBiZXN0ZWhlbmRlbiBQcm9wZXJ0eSAtIEZsb2F0aW5nLU1hcmtpZXJ1bmcgd2FuZGVydCBtaXQgdW0uXHJcbiAgICAgICAgZmxvYXRpbmcgPSBmbG9hdGluZy5tYXAoKGtleSkgPT4gKGtleSA9PT0gcmVtb3ZlZEtleXNbMF0gPyBhZGRlZEtleXNbMF0gOiBrZXkpKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBpZiAocmVtb3ZlZEtleXMubGVuZ3RoID4gMCkgZmxvYXRpbmcgPSBmbG9hdGluZy5maWx0ZXIoKGtleSkgPT4gIXJlbW92ZWRLZXlzLmluY2x1ZGVzKGtleSkpO1xyXG4gICAgICAgIGlmIChlZGl0b3IuZnJlZFBlbmRpbmdGbG9hdGluZ0FkZCAmJiBhZGRlZEtleXMubGVuZ3RoID09PSAxKSB7XHJcbiAgICAgICAgICBmbG9hdGluZyA9IFsuLi5mbG9hdGluZywgYWRkZWRLZXlzWzBdXTtcclxuICAgICAgICAgIGVkaXRvci5mcmVkUGVuZGluZ0Zsb2F0aW5nQWRkID0gZmFsc2U7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIC8vIFNob3J0Y3V0cyBoXHUwMEU0bmdlbiBhbSBLZXksIG5pY2h0IGFtIFdlcnQgKHNpZWhlIHNob3J0Y3V0cy5qcykgdW5kIG1cdTAwRkNzc2VuXHJcbiAgICAgIC8vIGRlc2hhbGIgZ2VuYXUgd2llIGRpZSBGbG9hdGluZy1NYXJraWVydW5nIG5hY2hnZWZcdTAwRkNocnQgd2VyZGVuOiBiZWkgZWluZXJcclxuICAgICAgLy8gVW1iZW5lbm51bmcgbWl0d2FuZGVybiwgYmVpIGVpbmVtIExcdTAwRjZzY2hlbiBtaXQgdmVyc2Nod2luZGVuLlxyXG4gICAgICBjb25zdCBzaG9ydGN1dHMgPSB7IC4uLnN0b3JlLmdldFNob3J0Y3V0cygpIH07XHJcbiAgICAgIGlmIChyZW1vdmVkS2V5cy5sZW5ndGggPT09IDEgJiYgYWRkZWRLZXlzLmxlbmd0aCA9PT0gMSkge1xyXG4gICAgICAgIGlmIChzaG9ydGN1dHNbcmVtb3ZlZEtleXNbMF1dKSB7XHJcbiAgICAgICAgICBzaG9ydGN1dHNbYWRkZWRLZXlzWzBdXSA9IHNob3J0Y3V0c1tyZW1vdmVkS2V5c1swXV07XHJcbiAgICAgICAgICBkZWxldGUgc2hvcnRjdXRzW3JlbW92ZWRLZXlzWzBdXTtcclxuICAgICAgICB9XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgZm9yIChjb25zdCBrZXkgb2YgcmVtb3ZlZEtleXMpIGRlbGV0ZSBzaG9ydGN1dHNba2V5XTtcclxuICAgICAgfVxyXG5cclxuICAgICAgc3RvcmUuc2V0RnJvbnRtYXR0ZXIoZnJvbnRtYXR0ZXIpO1xyXG4gICAgICBzdG9yZS5zZXRGbG9hdGluZyhmbG9hdGluZyk7XHJcbiAgICAgIHN0b3JlLnNldFNob3J0Y3V0cyhzaG9ydGN1dHMpO1xyXG4gICAgICB2aWV3LnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgLy8gS25vcGYvQ2hpcCBhbiBkaWUgbmV1ZSBaZWlsZW4tIHVuZCBLZXktTGFnZSBhbnBhc3NlbiAtIGVpbmUgZ2VyYWRlXHJcbiAgICAgIC8vIGJlbmFubnRlIFplaWxlIGJla29tbXQgc28gaWhyZW4gS25vcGYsIGVpbmUgZ2VsXHUwMEY2c2NodGUgbmltbXQgaWhyZW4gbWl0LlxyXG4gICAgICByZW5kZXJTaG9ydGN1dENvbnRyb2xzKHZpZXcsIGVkaXRvciwgc3RvcmUpO1xyXG4gICAgICAvLyBEYW1pdCBkaWUgRmV0dC0vS3Vyc2l2LU1hcmtpZXJ1bmcgaW4gYmVyZWl0cyBvZmZlbmVuIE5vdGl6ZW4gZGllc2VzXHJcbiAgICAgIC8vIFR5cHMgc29mb3J0IG1pdHppZWh0LCB3ZW5uIHNpY2ggaGllciBkaWUgUHJvcGVydHktTGlzdGUgXHUwMEU0bmRlcnQuXHJcbiAgICAgIHZpZXcucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgfSxcclxuICB9O1xyXG5cclxuICBjb25zdCBlZGl0b3IgPSBuZXcgRWRpdG9yQ2xhc3MoYXBwLCBvd25lcik7XHJcbiAgZWRpdG9yLmZyZWRQZW5kaW5nRmxvYXRpbmdBZGQgPSBmYWxzZTtcclxuICBpZiAob25TaGlmdEZvY3VzKSByZWdpc3RlckZvY3VzQ2hhaW4oZWRpdG9yLCBvblNoaWZ0Rm9jdXMpO1xyXG4gIC8vIEdyZW56dCBkaWUgU2hvcnRjdXQtUmVnZWxuIGluIHN0eWxlcy5jc3MgYXVmIGRpZXNlbiBFZGl0b3IgZWluLlxyXG4gIGVkaXRvci5jb250YWluZXJFbC5hZGRDbGFzcyhFRElUT1JfQ0xBU1MpO1xyXG4gIGNvbnRhaW5lckVsLmFwcGVuZENoaWxkKGVkaXRvci5jb250YWluZXJFbCk7XHJcbiAgdmlldy5hZGRDaGlsZChlZGl0b3IpO1xyXG5cclxuICBjb25zdCBkZWZhdWx0cyA9IHN0b3JlLmdldEZyb250bWF0dGVyKCk7XHJcbiAgY29uc3QgaGFkVHlwID0gT2JqZWN0LmtleXMoZGVmYXVsdHMpLnNvbWUoKGtleSkgPT4gU1lTVEVNX1BST1BFUlRJRVMuaW5jbHVkZXMoa2V5LnRyaW0oKS50b0xvd2VyQ2FzZSgpKSk7XHJcbiAgc3RyaXBUeXBQcm9wZXJ0eShkZWZhdWx0cyk7XHJcbiAgLy8gRWluIGJlaW0gTGFkZW4gbm9jaCB2b3JoYW5kZW5lcyBUWVAgKHouIEIuIGF1cyBlaW5lciBcdTAwRTRsdGVyZW4gUGx1Z2luLVZlcnNpb24pXHJcbiAgLy8gZGF1ZXJoYWZ0IGVudGZlcm5lbiwgc3RhdHQgZXMgbnVyIGZcdTAwRkNyIGRpZXNlIFNlc3Npb24genUgdmVyc3RlY2tlbi5cclxuICBpZiAoaGFkVHlwKSB2aWV3LnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICBlZGl0b3Iuc3luY2hyb25pemUoZGVmYXVsdHMpO1xyXG4gIHJlbmRlclNob3J0Y3V0Q29udHJvbHModmlldywgZWRpdG9yLCBzdG9yZSk7XHJcbiAgLy8gRXJzdCBuYWNoIGRlbSBlcnN0ZW4gc3luY2hyb25pemUoKSB2ZXJzdWNodCAoc2llaGUgZ2V0UHJvcGVydHlSb3dDbGFzcykgLVxyXG4gIC8vIGJlaSBlaW5lbSBub2NoIGdhbnogbGVlcmVuIFR5cCBoaWVyIGVpbiBOby1PcCwgaG9sdCBzaWNoIGFiZXIgc3BcdTAwRTR0ZXN0ZW5zXHJcbiAgLy8gYmVpbSBuXHUwMEU0Y2hzdGVuIE1vdW50ZW4gZWluZXMgbmljaHQtbGVlcmVuIFR5cHMgKG9kZXIgYXVzIGVpbmVyIG9mZmVuZW5cclxuICAvLyBOb3RpeikgZGllIGJlblx1MDBGNnRpZ3RlIEtsYXNzZW5yZWZlcmVueiBhdXRvbWF0aXNjaCBuYWNoLlxyXG4gIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoKGFwcCwgZWRpdG9yKTtcclxuICByZXR1cm4gZWRpdG9yO1xyXG59XHJcblxyXG5jb25zdCBDSElQX0NMQVNTID0gXCJmcmVkLXR5cC1zaG9ydGN1dC1jaGlwXCI7XHJcbmNvbnN0IENISVBfVEVYVF9DTEFTUyA9IFwiZnJlZC10eXAtc2hvcnRjdXQtY2hpcC10ZXh0XCI7XHJcbmNvbnN0IEJVVFRPTl9DTEFTUyA9IFwiZnJlZC10eXAtc2hvcnRjdXQtYnV0dG9uXCI7XHJcbmNvbnN0IFJPV19DTEFTUyA9IFwiZnJlZC10eXAtaGFzLXNob3J0Y3V0XCI7XHJcbmNvbnN0IFdBUk5JTkdfQ0xBU1MgPSBcImZyZWQtdHlwLXNob3J0Y3V0LWJsb2NrZWRcIjtcclxuXHJcbi8vIEtub3BmIHVuZCBDaGlwIGplIFByb3BlcnR5LVplaWxlLiBCZWlkZSBoXHUwMEU0bmdlbiBhbSBjb250YWluZXJFbCBkZXIgWmVpbGUsIE5JQ0hUXHJcbi8vIGFuIGRlcmVuIHZhbHVlRWw6IE9ic2lkaWFucyByZW5kZXJQcm9wZXJ0eSgpIGxlZXJ0IGJlaSBqZWRlbSBOZXUtUmVuZGVybiBudXJcclxuLy8gZGFzIHZhbHVlRWwsIGRhcyBjb250YWluZXJFbCBkYWdlZ2VuIG5pZSAtIHdhcyBoaWVyIGVpbm1hbCBhbmdlaFx1MDBFNG5ndCB3dXJkZSxcclxuLy8gXHUwMEZDYmVybGVidCBhbHNvIGplZGVuIFR5cC0vV2VydHdlY2hzZWwgdm9uIHNlbGJzdCwgb2huZSBFaW5ncmlmZiBpbiBPYnNpZGlhbnNcclxuLy8gUmVuZGVyLVBpcGVsaW5lLlxyXG4vL1xyXG4vLyBEZXIgS25vcGYgaXN0IGVpbiBVbXNjaGFsdGVyOiBiZWkgZWluZXIgWmVpbGUgb2huZSBTaG9ydGN1dCBcdTAwRjZmZm5ldCBlciBkaWVcclxuLy8gQXVzd2FobCwgYmVpIGVpbmVyIFplaWxlIG1pdCBTaG9ydGN1dCBlbnRmZXJudCBlciBpaG4gd2llZGVyLiBadW0gV0VDSFNFTE5cclxuLy8gZGllbnQgZGVyIENoaXAgc2VsYnN0LiBTaWNodGJhciB3aXJkIGRlciBLbm9wZiBwZXIgQ1NTIG51ciBiZWkgSG92ZXIvRm9rdXNcclxuLy8gZGVyIFplaWxlICh1bmQgZGF1ZXJoYWZ0LCBzb2xhbmdlIGVpbiBTaG9ydGN1dCBnZXNldHp0IGlzdCkgLSBzb25zdCBzdFx1MDBGQ25kZSBpblxyXG4vLyBqZWRlciBaZWlsZSBkYXVlcmhhZnQgZWluIEJlZGllbmVsZW1lbnQsIGRhcyBkaWUgbWVpc3RlbiBuaWUgYnJhdWNoZW4uXHJcbi8vXHJcbi8vIERhcyBBdXNibGVuZGVuIGRlcyBXZXJ0ZmVsZHMgYmVpIGdlc2V0enRlbSBTaG9ydGN1dCBtYWNodCBhbGxlaW4gQ1NTIChzaWVoZVxyXG4vLyBST1dfQ0xBU1MgaW4gc3R5bGVzLmNzcykuIERhcyBuYXRpdmUgV2lkZ2V0IHJlbmRlcnQgZGFydW50ZXIgdW52ZXJcdTAwRTRuZGVydFxyXG4vLyB3ZWl0ZXIgLSBTZXR6ZW4gdW5kIEVudGZlcm5lbiBzaW5kIGRlc2hhbGIgZWluIHJlaW5lciBLbGFzc2VuLVVtc2NoYWx0ZXIgdW5kXHJcbi8vIGJyYXVjaGVuIGtlaW4gcmVuZGVyUHJvcGVydHkoKS9zeW5jaHJvbml6ZSgpLCB3YXMgaGllciBvaG5laGluIGhlaWtlbCB3XHUwMEU0cmVcclxuLy8gKHNpZWhlIEtvbW1lbnRhciBhbiBzdHJpcFR5cFByb3BlcnR5KS5cclxuZnVuY3Rpb24gcmVuZGVyU2hvcnRjdXRDb250cm9scyh2aWV3LCBlZGl0b3IsIHN0b3JlKSB7XHJcbiAgY29uc3Qgc2hvcnRjdXRzID0gc3RvcmUuZ2V0U2hvcnRjdXRzKCk7XHJcbiAgZm9yIChjb25zdCByb3cgb2YgZWRpdG9yLnJlbmRlcmVkID8/IFtdKSB7XHJcbiAgICBjb25zdCBjb250YWluZXJFbCA9IHJvdy5jb250YWluZXJFbDtcclxuICAgIGNvbnN0IGtleSA9IHJvdy5lbnRyeT8ua2V5ID8/IFwiXCI7XHJcbiAgICAvLyBFaW5lIG5vY2ggbmFtZW5sb3NlIFplaWxlIGthbm4ga2VpbmVuIFNob3J0Y3V0IHRyYWdlbiAtIGVzIGdcdTAwRTRiZSBrZWluZW5cclxuICAgIC8vIFNjaGxcdTAwRkNzc2VsLCB1bnRlciBkZW0gZXIgc3RcdTAwRkNuZGUuIERlciBLbm9wZiBlcnNjaGVpbnQsIHNvYmFsZCBlaW4gTmFtZVxyXG4gICAgLy8gZWluZ2V0cmFnZW4gaXN0IChqZWRlIFx1MDBDNG5kZXJ1bmcgbFx1MDBFNHVmdCBkdXJjaCBzYXZlRnJvbnRtYXR0ZXIgdW5kIGRhbWl0XHJcbiAgICAvLyBlcm5ldXQgaGllciBkdXJjaCkuXHJcbiAgICBjb25zdCByZWNvcmQgPSBrZXkgPT09IFwiXCIgPyBudWxsIDogc2hvcnRjdXRzW2tleV0gPz8gbnVsbDtcclxuICAgIGNvbnRhaW5lckVsLnRvZ2dsZUNsYXNzKFJPV19DTEFTUywgISFyZWNvcmQpO1xyXG5cclxuICAgIC8vIE9ic2lkaWFucyBXYXJuZHJlaWVjayBzaXR6dCBuaWNodCBpbSBGbGV4LUZsdXNzIGRlciBaZWlsZSwgc29uZGVybiBpc3RcclxuICAgIC8vIGFic29sdXQgYW4gZGVyZW4gcmVjaHRlbSBSYW5kIHZlcmFua2VydCAocG9zaXRpb246IGFic29sdXRlLFxyXG4gICAgLy8gaW5zZXQtaW5saW5lLWVuZC90b3AvYm90dG9tOiB2YXIoLS1zaXplLTItMSkpIC0gYWxzbyBnZW5hdSBkb3J0LCB3byBhdWNoXHJcbiAgICAvLyBkZXIgU2hvcnRjdXQtS25vcGYgc2l0enQuIEJlaWRlIGdsZWljaHplaXRpZyBoaWVcdTAwREZlOiBcdTAwRkNiZXJlaW5hbmRlci4gWmVpZ3RcclxuICAgIC8vIGRpZSBaZWlsZSBlaW5lIFR5cC1XYXJudW5nIHVuZCBpc3QgS0VJTiBTaG9ydGN1dCBnZXNldHp0LCB3ZWljaHQgZGVyXHJcbiAgICAvLyBLbm9wZi4gQmVpIGdlc2V0enRlbSBTaG9ydGN1dCBibGVpYnQgZXIgZGFnZWdlbiBzdGVoZW4gLSBlciBpc3QgZGVyXHJcbiAgICAvLyBlaW56aWdlIFdlZywgZGVuIFNob3J0Y3V0IHdpZWRlciBsb3N6dXdlcmRlbiAtLCB1bmQgc3RhdHRkZXNzZW4gd2VpY2h0XHJcbiAgICAvLyBkYXMgV2FybmRyZWllY2sgKHNpZWhlIHN0eWxlcy5jc3MpOiBlcyBiZXppZWh0IHNpY2ggZGFubiBhdWYgZGVuXHJcbiAgICAvLyBhdXNnZWJsZW5kZXRlbiBSXHUwMEZDY2tmYWxsd2VydCwgaXN0IGRvcnQgYWxzbyBnYXIgbmljaHQgenUgYmVoZWJlbi5cclxuICAgIGNvbnN0IG1pc21hdGNoID0gISFyb3cudHlwZUluZm8gJiYgcm93LnR5cGVJbmZvLmV4cGVjdGVkICE9PSByb3cudHlwZUluZm8uaW5mZXJyZWQ7XHJcbiAgICBjb250YWluZXJFbC50b2dnbGVDbGFzcyhXQVJOSU5HX0NMQVNTLCBtaXNtYXRjaCAmJiAhcmVjb3JkKTtcclxuXHJcbiAgICBsZXQgYnV0dG9uRWwgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKGA6c2NvcGUgPiAuJHtCVVRUT05fQ0xBU1N9YCk7XHJcbiAgICBpZiAoa2V5ID09PSBcIlwiKSB7XHJcbiAgICAgIGJ1dHRvbkVsPy5yZW1vdmUoKTtcclxuICAgICAgY29udGFpbmVyRWwucXVlcnlTZWxlY3RvcihgOnNjb3BlID4gLiR7Q0hJUF9DTEFTU31gKT8ucmVtb3ZlKCk7XHJcbiAgICAgIGNvbnRpbnVlO1xyXG4gICAgfVxyXG4gICAgaWYgKCFidXR0b25FbCkge1xyXG4gICAgICBidXR0b25FbCA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogYGNsaWNrYWJsZS1pY29uICR7QlVUVE9OX0NMQVNTfWAgfSk7XHJcbiAgICAgIHNldEljb24oYnV0dG9uRWwsIFwic3F1YXJlLWZ1bmN0aW9uXCIpO1xyXG4gICAgICAvLyBEZW4gS2V5IGVyc3QgYmVpbSBLbGljayBhdXMgZGVyIFplaWxlIGxlc2VuLCBuaWNodCBoaWVyIGVpbmZhbmdlbiAtXHJcbiAgICAgIC8vIGVpbmUgVW1iZW5lbm51bmcgXHUwMEU0bmRlcnQgcm93LmVudHJ5LmtleSwgb2huZSBkaWUgWmVpbGUgbmV1IGFuenVsZWdlbi5cclxuICAgICAgYnV0dG9uRWwuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgICBpZiAoc3RvcmUuZ2V0U2hvcnRjdXRzKClbcm93LmVudHJ5Py5rZXkgPz8gXCJcIl0pIHJlbW92ZVNob3J0Y3V0KHZpZXcsIGVkaXRvciwgc3RvcmUsIHJvdyk7XHJcbiAgICAgICAgZWxzZSBvcGVuU2hvcnRjdXRQaWNrZXIodmlldywgZWRpdG9yLCBzdG9yZSwgcm93KTtcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICBidXR0b25FbC5zZXRBdHRyKFwiYXJpYS1sYWJlbFwiLCByZWNvcmQgPyBcIlNob3J0Y3V0IGVudGZlcm5lblwiIDogXCJTaG9ydGN1dCBzZXR6ZW5cIik7XHJcblxyXG4gICAgbGV0IGNoaXBFbCA9IGNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3IoYDpzY29wZSA+IC4ke0NISVBfQ0xBU1N9YCk7XHJcbiAgICBpZiAoIXJlY29yZCkge1xyXG4gICAgICBjaGlwRWw/LnJlbW92ZSgpO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuICAgIGlmICghY2hpcEVsKSB7XHJcbiAgICAgIGNoaXBFbCA9IGNyZWF0ZUVsKFwiY29kZVwiLCB7IGNsczogQ0hJUF9DTEFTUyB9KTtcclxuICAgICAgLy8gRGVyIFRleHQgc3RlY2t0IGluIGVpbmVtIGVpZ2VuZW4gU3Bhbiwgd2VpbCBkZXIgQ2hpcCBzZWxic3QgZWluXHJcbiAgICAgIC8vIEZsZXgtQ29udGFpbmVyIGlzdCAodmVydGlrYWxlIFplbnRyaWVydW5nIHdpZSBiZWltIGVjaHRlbiBXZXJ0ZmVsZCkgLVxyXG4gICAgICAvLyB0ZXh0LW92ZXJmbG93OiBlbGxpcHNpcyBncmVpZnQgYWJlciBudXIgYXVmIGVpbmVtIEJsb2NrLUVsZW1lbnQsIG5pY2h0XHJcbiAgICAgIC8vIGF1ZiBkZW0gRmxleC1Db250YWluZXIgZGFyXHUwMEZDYmVyLlxyXG4gICAgICBjaGlwRWwuY3JlYXRlU3Bhbih7IGNsczogQ0hJUF9URVhUX0NMQVNTIH0pO1xyXG4gICAgICBjaGlwRWwuc2V0QXR0cihcImFyaWEtbGFiZWxcIiwgXCJTaG9ydGN1dCBcdTAwRTRuZGVyblwiKTtcclxuICAgICAgY2hpcEVsLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiBvcGVuU2hvcnRjdXRQaWNrZXIodmlldywgZWRpdG9yLCBzdG9yZSwgcm93KSk7XHJcbiAgICAgIC8vIFZvciBkZW0gS25vcGYgZWluaFx1MDBFNG5nZW4sIGRhbWl0IGRpZSBaZWlsZSB1bmFiaFx1MDBFNG5naWcgdm9uIGRlclxyXG4gICAgICAvLyBFbnRzdGVodW5nc3JlaWhlbmZvbGdlIGltbWVyIFwiTmFtZSB8IENoaXAgfCBLbm9wZlwiIGxpZXN0LlxyXG4gICAgICBjb250YWluZXJFbC5pbnNlcnRCZWZvcmUoY2hpcEVsLCBidXR0b25FbCk7XHJcbiAgICB9XHJcbiAgICBjaGlwRWwuZmlyc3RFbGVtZW50Q2hpbGQuc2V0VGV4dChzaG9ydGN1dExhYmVsKHJlY29yZCkpO1xyXG4gIH1cclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gb3BlblNob3J0Y3V0UGlja2VyKHZpZXcsIGVkaXRvciwgc3RvcmUsIHJvdykge1xyXG4gIGNvbnN0IGtleSA9IHJvdy5lbnRyeT8ua2V5ID8/IFwiXCI7XHJcbiAgaWYgKGtleSA9PT0gXCJcIikgcmV0dXJuO1xyXG4gIC8vIERlbiBiaXNoZXJpZ2VuIFJlY29yZCBtaXRnZWJlbjogd2lyZCBkYXNzZWxiZSBTa3JpcHQgZXJuZXV0IGdld1x1MDBFNGhsdCwga29tbXRcclxuICAvLyBkZXIgQXJndW1lbnQtRGlhbG9nIG1pdCBkZW4gYWt0dWVsbGVuIFdlcnRlbiB2b3JiZWxlZ3QgLSBzbyBpc3QgZGVyIEtsaWNrXHJcbiAgLy8gYXVmIGRlbiBDaGlwIGF1Y2ggZGVyIFdlZywgZWluemVsbmUgQXJndW1lbnRlIHp1IGtvcnJpZ2llcmVuLlxyXG4gIGNvbnN0IHJlY29yZCA9IGF3YWl0IHBpY2tTaG9ydGN1dCh2aWV3LmFwcCwga2V5LCB2aWV3LnBsdWdpbi5nZXRTaG9ydGN1dFNjcmlwdHMsIHN0b3JlLmdldFNob3J0Y3V0cygpW2tleV0gPz8gbnVsbCk7XHJcbiAgaWYgKCFyZWNvcmQpIHJldHVybjtcclxuICAvLyBXXHUwMEU0aHJlbmQgZGVyIERpYWxvZyBvZmZlbiB3YXIsIGthbm4gZGllIFByb3BlcnR5IHZlcnNjaHd1bmRlbiBzZWluIChldHdhXHJcbiAgLy8gd2VpbCBkaWUgQW5zaWNodCB6d2lzY2hlbnplaXRsaWNoIG5ldSBhdWZnZWJhdXQgd3VyZGUpLiBPaG5lIGRpZXNlIFByXHUwMEZDZnVuZ1xyXG4gIC8vIGJsaWViZSBkZXIgU2hvcnRjdXQgYWxzIFdhaXNlIGluIGRlbiBFaW5zdGVsbHVuZ2VuIHN0ZWhlbjogc2F2ZUZyb250bWF0dGVyXHJcbiAgLy8gemllaHQgbnVyIEtleXMgbmFjaCwgZGllIGluIGRlcnNlbGJlbiBCZWFyYmVpdHVuZyBlbnRmZXJudCB3dXJkZW4sIHVuZFxyXG4gIC8vIGNvbGxlY3RCbG9ja3MgbFx1MDBFNHVmdCBvaG5laGluIG51ciBcdTAwRkNiZXIgdm9yaGFuZGVuZSBGcm9udG1hdHRlci1LZXlzIC0gZGVyXHJcbiAgLy8gRWludHJhZyB3XHUwMEU0cmUgYWxzbyB1bnNpY2h0YmFyIHVuZCB3XHUwMEZDcmRlIG5pZSB3aWVkZXIgYXVmZ2VyXHUwMEU0dW10LlxyXG4gIGlmICghT2JqZWN0Lmhhc093bihzdG9yZS5nZXRGcm9udG1hdHRlcigpLCBrZXkpKSByZXR1cm47XHJcbiAgc3RvcmUuc2V0U2hvcnRjdXRzKHsgLi4uc3RvcmUuZ2V0U2hvcnRjdXRzKCksIFtrZXldOiByZWNvcmQgfSk7XHJcbiAgc2F2ZVNob3J0Y3V0cyh2aWV3LCBlZGl0b3IsIHN0b3JlKTtcclxufVxyXG5cclxuZnVuY3Rpb24gcmVtb3ZlU2hvcnRjdXQodmlldywgZWRpdG9yLCBzdG9yZSwgcm93KSB7XHJcbiAgY29uc3Qga2V5ID0gcm93LmVudHJ5Py5rZXkgPz8gXCJcIjtcclxuICBjb25zdCBzaG9ydGN1dHMgPSB7IC4uLnN0b3JlLmdldFNob3J0Y3V0cygpIH07XHJcbiAgaWYgKCEoa2V5IGluIHNob3J0Y3V0cykpIHJldHVybjtcclxuICBkZWxldGUgc2hvcnRjdXRzW2tleV07XHJcbiAgc3RvcmUuc2V0U2hvcnRjdXRzKHNob3J0Y3V0cyk7XHJcbiAgc2F2ZVNob3J0Y3V0cyh2aWV3LCBlZGl0b3IsIHN0b3JlKTtcclxufVxyXG5cclxuZnVuY3Rpb24gc2F2ZVNob3J0Y3V0cyh2aWV3LCBlZGl0b3IsIHN0b3JlKSB7XHJcbiAgdmlldy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgcmVuZGVyU2hvcnRjdXRDb250cm9scyh2aWV3LCBlZGl0b3IsIHN0b3JlKTtcclxufVxyXG5cclxuLy8gRWlnZW5lLCBlaW5mYWNoZSBcIlByb3BlcnR5IGhpbnp1Zlx1MDBGQ2dlblwiLUZ1bmt0aW9uIHN0YXR0IGRlcyBpbnRlcm5lblxyXG4vLyBlZGl0b3IuYWRkUHJvcGVydHkoKTogZlx1MDBGQ2d0IGVpbmVuIGxlZXJlbiBLZXkgbWl0IFdlcnQgbnVsbCBhbiB1bmQgbFx1MDBFNHNzdCBkYXNcclxuLy8gV2lkZ2V0IGRpZSBaZWlsZSBnYW56IG5vcm1hbCByZW5kZXJuIChkaWVzZWxiZSBPcHRpayB3aWUgaW4gZWluZXIgZWNodGVuXHJcbi8vIE5vdGl6LCBkYSBzeW5jaHJvbml6ZSgpIHVudmVyXHUwMEU0bmRlcnQgT2JzaWRpYW5zIGVpZ2VuZSBSZW5kZXItUGlwZWxpbmVcclxuLy8gZHVyY2hsXHUwMEU0dWZ0KSAtIGRlciBGb2t1cyBzcHJpbmd0IGFuc2NobGllXHUwMERGZW5kIGlucyBLZXktRmVsZCBkZXIgbmV1ZW4gWmVpbGUuXHJcbmZ1bmN0aW9uIGFkZEJsYW5rUHJvcGVydHkoZWRpdG9yKSB7XHJcbiAgaWYgKCFlZGl0b3IpIHJldHVybjtcclxuICBjb25zdCBjdXJyZW50ID0gZWRpdG9yLnNlcmlhbGl6ZSgpO1xyXG4gIGlmICghY3VycmVudC5oYXNPd25Qcm9wZXJ0eShcIlwiKSkge1xyXG4gICAgY3VycmVudFtcIlwiXSA9IG51bGw7XHJcbiAgICBlZGl0b3Iuc3luY2hyb25pemUoY3VycmVudCk7XHJcbiAgICAvLyBzeW5jaHJvbml6ZSgpIGxlZ3QgZGllIG5ldWUgWmVpbGUgYW4gLSBkaWUgYmVzdGVoZW5kZW4gWmVpbGVuIGJlaGFsdGVuXHJcbiAgICAvLyBkYWJlaSB6d2FyIGlocmVuIEtub3BmIChlciBoXHUwMEU0bmd0IGFtIGNvbnRhaW5lckVsLCBzaWVoZVxyXG4gICAgLy8gcmVuZGVyU2hvcnRjdXRDb250cm9scyksIGRpZSBuZXVlIGhhdCBhYmVyIG5vY2gga2VpbmVuLlxyXG4gICAgcmVuZGVyU2hvcnRjdXRDb250cm9scyhlZGl0b3Iub3duZXIuZnJlZFZpZXcsIGVkaXRvciwgZWRpdG9yLm93bmVyLmZyZWRTdG9yZSk7XHJcbiAgfVxyXG4gIGVkaXRvci5mb2N1c0tleShcIlwiKTtcclxuICAvLyBEZWNrdCBkZW4gRmFsbCBhYiwgZGFzcyBtb3VudEZyb250bWF0dGVyRWRpdG9yKCkgYmVpIGVpbmVtIHp1IGRpZXNlbVxyXG4gIC8vIFplaXRwdW5rdCBub2NoIGdhbnogbGVlcmVuIFR5cCAodW5kIG9obmUgb2ZmZW5lIE5vdGl6KSBrZWluZSBaZWlsZW4tS2xhc3NlXHJcbiAgLy8genVtIFBhdGNoZW4gZmluZGVuIGtvbm50ZSAtIGpldHp0IGV4aXN0aWVydCBtaXQgZGVyIGdlcmFkZSBhbmdlbGVndGVuXHJcbiAgLy8gWmVpbGUgZ2FyYW50aWVydCBtaW5kZXN0ZW5zIGVpbmUuXHJcbiAgZW5zdXJlUHJvcGVydHlNZW51UGF0Y2goZWRpdG9yLm93bmVyLmFwcCwgZWRpdG9yKTtcclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSB7IG1vdW50RnJvbnRtYXR0ZXJFZGl0b3IsIGFkZEJsYW5rUHJvcGVydHksIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoLCB0eXBlU3RvcmUsIHN1YnR5cGVTdG9yZSB9O1xyXG4iLCAiY29uc3QgeyBtb3VudEZyb250bWF0dGVyRWRpdG9yLCBhZGRCbGFua1Byb3BlcnR5LCB0eXBlU3RvcmUsIHN1YnR5cGVTdG9yZSB9ID0gcmVxdWlyZShcIi4vdHlwZS1mcm9udG1hdHRlci1lZGl0b3JcIik7XHJcbmNvbnN0IHsgZ2V0U2VjdGlvbk9yZGVyLCBpc0VtcHR5VmFsdWUgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cGVzXCIpO1xyXG5cclxuLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbiAqIERpZSBGcm9udG1hdHRlci1CbFx1MDBGNmNrZSBlaW5lcyBUWVBzIGluIGRlciBUWVAtRGV0YWlsYW5zaWNodCAoc2llaGVcclxuICogcmVuZGVyVHlwZVNldHRpbmdzIGluIHR5cC12aWV3LmpzKTogenVvYmVyc3QgZGFzIFRZUC1Gcm9udG1hdHRlciwgZGFydW50ZXJcclxuICogamUgcmVnaXN0cmllcnRlbSBTdWJ0eXAgZWluIGVpZ2VuZXIgQmxvY2suXHJcbiAqXHJcbiAqIEplIEJsb2NrIGVpbmUgZWlnZW5lIEluc3Rhbnogdm9uIE9ic2lkaWFucyBQcm9wZXJ0eS1FZGl0b3IsIGdlYnVuZGVuIGFuXHJcbiAqIHR5cGVTdG9yZSBiencuIHN1YnR5cGVTdG9yZSAoc2llaGUgdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpLiBEYWR1cmNoXHJcbiAqIGRhcmYgZGVyc2VsYmUgS2V5IGluIG1laHJlcmVuIEJsXHUwMEY2Y2tlbiBzdGVoZW4gLSBpbm5lcmhhbGIgZWluZXMgQmxvY2tzIGlzdFxyXG4gKiBlciBkdXJjaCBkYXMgRnJvbnRtYXR0ZXItT2JqZWt0IHNlbGJzdCB6d2FuZ3NsXHUwMEU0dWZpZyBlaW5kZXV0aWcsIGRhclx1MDBGQ2JlclxyXG4gKiBoaW5hdXMgbmljaHQgKHNpZWhlIEtvbW1lbnRhciBhbiB0eXBlU3VidHlwZXMgaW4gc3VidHlwZXMuanMpLlxyXG4gKlxyXG4gKiBPYnNpZGlhbnMgZWlnZW5lcyBaZWlsZW4tRHJhZyByZWljaHQgbnVyIGlubmVyaGFsYiBlaW5lciBJbnN0YW56LiBEYW1pdFxyXG4gKiBlaW5lIFByb3BlcnR5IHRyb3R6ZGVtIHZvbiBCbG9jayB6dSBCbG9jayB3YW5kZXJuIGthbm4sIHNldHp0XHJcbiAqIHJlZ2lzdGVyUHJvcGVydHlEcmFnKCkgdW50ZW4gYXVmIGdlbmF1IGRpZXNlbSBEcmFnIGF1Ziwgc3RhdHQgZWluIGVpZ2VuZXNcclxuICogenUgYmF1ZW4uIERpZSBUYXN0YXR1ci1OYXZpZ2F0aW9uIFx1MDBGQ2JlciBhbGxlIEJsXHUwMEY2Y2tlIHN0ZWNrdCBpblxyXG4gKiByZWdpc3RlckZvY3VzQ2hhaW4oKSAodHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpLlxyXG4gKlxyXG4gKiBTZWN0aW9uOiBudWxsID0gVFlQLUZyb250bWF0dGVyLCBzb25zdCBkZXIgU3VidHlwLU5hbWUuXHJcbiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqL1xyXG5cclxuLy8gQW5mYXNzYmFyIGZcdTAwRkNyIGRhcyBWZXJzY2hpZWJlbiBlaW5lcyBnYW56ZW4gQmxvY2tzIGlzdCBhbGxlcyBhdVx1MDBERmVyaGFsYiBkZXJcclxuLy8gUHJvcGVydHktWmVpbGVuIC0gXHUwMERDYmVyc2NocmlmdCwgQWJzY2hsdXNzIHVuZCBkaWUgc2VpdGxpY2hlbiBSXHUwMEU0bmRlci5cclxuLy8gQmVkaWVuZWxlbWVudGUgdW5kIGVpbiBnZXJhZGUgYmVhcmJlaXRldGVyIFRpdGVsIGJsZWliZW4gYXVzZ2Vub21tZW4uXHJcbmZ1bmN0aW9uIGlzR3JhYlRhcmdldCh0YXJnZXQpIHtcclxuICBpZiAodGFyZ2V0LmNsb3Nlc3QoXCIuY2xpY2thYmxlLWljb24sIC5mcmVkLXR5cC1zdWJ0eXBlLWNvbG9yLWRvdCwgW2NvbnRlbnRlZGl0YWJsZT0ndHJ1ZSddLCBpbnB1dCwgdGV4dGFyZWFcIikpIHJldHVybiBmYWxzZTtcclxuICByZXR1cm4gIXRhcmdldC5jbG9zZXN0KFwiLm1ldGFkYXRhLXByb3BlcnR5XCIpO1xyXG59XHJcblxyXG4vLyByZW5kZXJIZWFkZXIoc2VjdGlvbiwgZWwsIGJsb2NrcykgLyByZW5kZXJGb290ZXIoc2VjdGlvbiwgZWwsIGJsb2NrcykgZlx1MDBGQ2xsZW5cclxuLy8gXHUwMERDYmVyc2NocmlmdCBiencuIEFic2NobHVzcyBlaW5lcyBCbG9ja3MuIG9uTW92ZVNlY3Rpb24ob3JkZXIpIG1lbGRldCBkaWVcclxuLy8gbmV1ZSBCbG9jay1SZWloZW5mb2xnZSBuYWNoIGVpbmVtIEJsb2NrLURyYWcgKHdpZSBnZXRTZWN0aW9uT3JkZXIsIHNhbXRcclxuLy8gZlx1MDBGQ2hyZW5kZW0gbnVsbCBmXHUwMEZDciBkYXMgVFlQLUZyb250bWF0dGVyKSwgb25TZWN0aW9uQ29udGV4dE1lbnUoc2VjdGlvbixcclxuLy8gZXZlbnQpIGVpbmVuIFJlY2h0c2tsaWNrIGluIGVpbmVtIFN1YnR5cC1CbG9jay5cclxuZnVuY3Rpb24gbW91bnRGcm9udG1hdHRlckJsb2Nrcyh2aWV3LCBjb250YWluZXJFbCwgdHlwZSwgeyByZW5kZXJIZWFkZXIsIHJlbmRlckZvb3Rlciwgb25Nb3ZlU2VjdGlvbiwgb25TZWN0aW9uQ29udGV4dE1lbnUgfSkge1xyXG4gIGNvbnN0IHdyYXBwZXIgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtYmxvY2tzXCIgfSk7XHJcbiAgY29uc3Qgc2VjdGlvbnMgPSBnZXRTZWN0aW9uT3JkZXIodmlldy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUpO1xyXG4gIGNvbnN0IGVkaXRvcnMgPSBuZXcgTWFwKCk7XHJcbiAgY29uc3QgYmxvY2tFbHMgPSBuZXcgTWFwKCk7XHJcbiAgY29uc3Qgc3RvcmVzID0gbmV3IE1hcCgpO1xyXG5cclxuICBjb25zdCBhcGkgPSB7XHJcbiAgICAvLyBBbGxlIEVkaXRvci1JbnN0YW56ZW4gaW4gQmxvY2stUmVpaGVuZm9sZ2UgLSB0eXAtdmlldy5qcyBoXHUwMEU0bmd0IHNpZSBhbHNcclxuICAgIC8vIENvbXBvbmVudC1DaGlsZHJlbiBlaW4gdW5kIGJhdXQgc2llIHZvciBqZWRlbSBOZXVhdWZiYXUgd2llZGVyIGFiLlxyXG4gICAgZWRpdG9yczogW10sXHJcbiAgICAvLyBMZWVyemVpbGUgYW0gRW5kZSBkZXMgZ2V3XHUwMEZDbnNjaHRlbiBCbG9ja3MgYW5sZWdlbiwgbWl0IGRlbSBGb2t1cyBpbVxyXG4gICAgLy8gS2V5LUZlbGQgKHNpZWhlIGFkZEJsYW5rUHJvcGVydHkgaW4gdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpLlxyXG4gICAgLy8gZmxvYXRpbmcgbWFya2llcnQgZGllIGFscyBuXHUwMEU0Y2hzdGVzIGJlbmFubnRlIFByb3BlcnR5IGFscyBGbG9hdGluZy5cclxuICAgIGFkZEJsYW5rKHNlY3Rpb24sIGZsb2F0aW5nID0gZmFsc2UpIHtcclxuICAgICAgY29uc3QgZWRpdG9yID0gZWRpdG9ycy5nZXQoc2VjdGlvbik7XHJcbiAgICAgIGlmICghZWRpdG9yKSByZXR1cm47XHJcbiAgICAgIGVkaXRvci5mcmVkUGVuZGluZ0Zsb2F0aW5nQWRkID0gZmxvYXRpbmc7XHJcbiAgICAgIGFkZEJsYW5rUHJvcGVydHkoZWRpdG9yKTtcclxuICAgIH0sXHJcbiAgfTtcclxuXHJcbiAgLy8gTmFjaGJhcmJsb2NrIGluIFJpY2h0dW5nIHN0ZXAsIGRlciBcdTAwRkNiZXJoYXVwdCBlaW5lIFplaWxlIHp1bSBBbnNwcmluZ2VuXHJcbiAgLy8gaGF0IC0gbGVlcmUgQmxcdTAwRjZja2Ugd2VyZGVuIFx1MDBGQ2JlcnNwcnVuZ2VuLlxyXG4gIGNvbnN0IGZvY3VzTmVpZ2hib3IgPSAoc2VjdGlvbiwgc3RlcCkgPT4ge1xyXG4gICAgZm9yIChsZXQgaSA9IHNlY3Rpb25zLmluZGV4T2Yoc2VjdGlvbikgKyBzdGVwOyBpID49IDAgJiYgaSA8IHNlY3Rpb25zLmxlbmd0aDsgaSArPSBzdGVwKSB7XHJcbiAgICAgIGNvbnN0IGVkaXRvciA9IGVkaXRvcnMuZ2V0KHNlY3Rpb25zW2ldKTtcclxuICAgICAgaWYgKCFlZGl0b3IgfHwgZWRpdG9yLnJlbmRlcmVkLmxlbmd0aCA9PT0gMCkgY29udGludWU7XHJcbiAgICAgIGVkaXRvci5mb2N1c1Byb3BlcnR5QXRJbmRleChzdGVwID4gMCA/IDAgOiAtMSk7XHJcbiAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG4gIH07XHJcblxyXG4gIGZvciAoY29uc3Qgc2VjdGlvbiBvZiBzZWN0aW9ucykge1xyXG4gICAgY29uc3QgaXNTdWIgPSBzZWN0aW9uICE9PSBudWxsO1xyXG4gICAgY29uc3QgYmxvY2tFbCA9IHdyYXBwZXIuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcImZyZWQtdHlwLWJsb2NrXCIgKyAoaXNTdWIgPyBcIiBmcmVkLXR5cC1mcm9udG1hdHRlci1ibG9jayBmcmVkLXR5cC1zdWJ0eXBlLWJsb2NrXCIgOiBcIlwiKSxcclxuICAgIH0pO1xyXG4gICAgYmxvY2tFbHMuc2V0KHNlY3Rpb24sIGJsb2NrRWwpO1xyXG4gICAgYmxvY2tFbC5mcmVkU2VjdGlvbiA9IHNlY3Rpb247XHJcblxyXG4gICAgY29uc3QgaGVhZGVyID0gYmxvY2tFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItaGVhZGVyIGZyZWQtdHlwLXNlY3Rpb24taGVhZGVyXCIgfSk7XHJcbiAgICBoZWFkZXIudG9nZ2xlQ2xhc3MoXCJmcmVkLXR5cC1zZWN0aW9uLXN1YlwiLCBpc1N1Yik7XHJcblxyXG4gICAgY29uc3Qgc3RvcmUgPSBzZWN0aW9uID09PSBudWxsID8gdHlwZVN0b3JlKHZpZXcucGx1Z2luLCB0eXBlKSA6IHN1YnR5cGVTdG9yZSh2aWV3LnBsdWdpbiwgdHlwZSwgc2VjdGlvbik7XHJcbiAgICBzdG9yZXMuc2V0KHNlY3Rpb24sIHN0b3JlKTtcclxuICAgIGNvbnN0IGVkaXRvciA9IG1vdW50RnJvbnRtYXR0ZXJFZGl0b3IodmlldywgYmxvY2tFbCwgc3RvcmUsIHtcclxuICAgICAgb25TaGlmdEZvY3VzOiAoc3RlcCkgPT4gZm9jdXNOZWlnaGJvcihzZWN0aW9uLCBzdGVwKSxcclxuICAgIH0pO1xyXG4gICAgaWYgKGVkaXRvcikge1xyXG4gICAgICBlZGl0b3JzLnNldChzZWN0aW9uLCBlZGl0b3IpO1xyXG4gICAgICBhcGkuZWRpdG9ycy5wdXNoKGVkaXRvcik7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgZm9vdGVyID0gYmxvY2tFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtc2VjdGlvbi1mb290ZXJcIiB9KTtcclxuICAgIGZvb3Rlci50b2dnbGVDbGFzcyhcImZyZWQtdHlwLXNlY3Rpb24tc3ViXCIsIGlzU3ViKTtcclxuICAgIHJlbmRlckhlYWRlcihzZWN0aW9uLCBoZWFkZXIsIGFwaSk7XHJcbiAgICByZW5kZXJGb290ZXI/LihzZWN0aW9uLCBmb290ZXIsIGFwaSk7XHJcblxyXG4gICAgaWYgKCFpc1N1YikgY29udGludWU7XHJcbiAgICAvLyBTdWJ0eXAtQmxcdTAwRjZja2UgcmVhZ2llcmVuIGF1ZiBpaHJlciBnYW56ZW4gRmxcdTAwRTRjaGU7IE9ic2lkaWFucyBlaWdlbmUgTWVuXHUwMEZDc1xyXG4gICAgLy8gKHouIEIuIGRhcyBlaW5lciBQcm9wZXJ0eSkgdW5kIFRleHRmZWxkZXIgaGFiZW4gVm9ycmFuZyAtIHNpZSByZWFnaWVyZW5cclxuICAgIC8vIHZvcmhlciB1bmQgc2V0emVuIGRlZmF1bHRQcmV2ZW50ZWQuXHJcbiAgICBibG9ja0VsLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcclxuICAgICAgaWYgKGV2ZW50LmRlZmF1bHRQcmV2ZW50ZWQgfHwgZXZlbnQudGFyZ2V0LmNsb3Nlc3QoXCJpbnB1dCwgdGV4dGFyZWEsIFtjb250ZW50ZWRpdGFibGU9J3RydWUnXVwiKSkgcmV0dXJuO1xyXG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICBvblNlY3Rpb25Db250ZXh0TWVudT8uKHNlY3Rpb24sIGV2ZW50KTtcclxuICAgIH0pO1xyXG4gICAgYmxvY2tFbC5hZGRFdmVudExpc3RlbmVyKFwibW91c2Vkb3duXCIsIChldmVudCkgPT4gc3RhcnRCbG9ja0RyYWcoZXZlbnQsIHNlY3Rpb24pKTtcclxuICB9XHJcblxyXG4gIC8vIEVpZ2VuZXMgTWF1cy1EcmFnIHN0YXR0IEhUTUw1LWRyYWdnYWJsZTogZWluIGRyYWdnYWJsZS1Wb3JmYWhyZSBzdFx1MDBGNnJ0ZSBkaWVcclxuICAvLyBUZXh0YXVzd2FobCBpbiBkZW4gRWluZ2FiZWZlbGRlcm4gZGVyIFplaWxlbi4gRGVyIERyYWcgYmVnaW5udCBlcnN0IG5hY2hcclxuICAvLyBlaW4gcGFhciBQaXhlbG4gQmV3ZWd1bmcsIGVpbiBTdHJpY2ggaW4gQWt6ZW50ZmFyYmUgemVpZ3QgZGllXHJcbiAgLy8gWmllbHBvc2l0aW9uIHp3aXNjaGVuIGRlbiBCbFx1MDBGNmNrZW4sIEVzY2FwZSBicmljaHQgYWIuIERhcyBUWVAtRnJvbnRtYXR0ZXJcclxuICAvLyBzdGVodCBmZXN0IGdhbnogb2JlbiAoc2llaGUgZ2V0U2VjdGlvbk9yZGVyIGluIHN1YnR5cGVzLmpzKSAtIFppZWxwb3NpdGlvblxyXG4gIC8vIDAgZ2lidCBlcyBkZXNoYWxiIG5pY2h0LCBkZXIgb2JlcnN0ZSBtXHUwMEY2Z2xpY2hlIFBsYXR6IGlzdCBkaXJla3QgZGFydW50ZXIuXHJcbiAgZnVuY3Rpb24gc3RhcnRCbG9ja0RyYWcoZXZlbnQsIHNlY3Rpb24pIHtcclxuICAgIGlmIChldmVudC5idXR0b24gIT09IDAgfHwgIWlzR3JhYlRhcmdldChldmVudC50YXJnZXQpKSByZXR1cm47XHJcbiAgICBjb25zdCB3aW4gPSB3cmFwcGVyLndpbjtcclxuICAgIGNvbnN0IHN0YXJ0WSA9IGV2ZW50LmNsaWVudFk7XHJcbiAgICBsZXQgZHJhZ2dpbmcgPSBmYWxzZTtcclxuICAgIGxldCBpbmRpY2F0b3IgPSBudWxsO1xyXG4gICAgbGV0IGJveGVzID0gW107XHJcbiAgICBsZXQgdGFyZ2V0SW5kZXggPSBudWxsO1xyXG5cclxuICAgIGNvbnN0IG1lYXN1cmUgPSAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGJhc2UgPSB3cmFwcGVyLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xyXG4gICAgICBib3hlcyA9IHNlY3Rpb25zLm1hcCgobmFtZSkgPT4ge1xyXG4gICAgICAgIGNvbnN0IHJlY3QgPSBibG9ja0Vscy5nZXQobmFtZSkuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XHJcbiAgICAgICAgcmV0dXJuIHsgc2VjdGlvbjogbmFtZSwgdG9wOiByZWN0LnRvcCAtIGJhc2UudG9wLCBib3R0b206IHJlY3QuYm90dG9tIC0gYmFzZS50b3AgfTtcclxuICAgICAgfSk7XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IG9uTW92ZSA9IChtb3ZlRXZlbnQpID0+IHtcclxuICAgICAgaWYgKCFkcmFnZ2luZykge1xyXG4gICAgICAgIGlmIChNYXRoLmFicyhtb3ZlRXZlbnQuY2xpZW50WSAtIHN0YXJ0WSkgPCA0KSByZXR1cm47XHJcbiAgICAgICAgZHJhZ2dpbmcgPSB0cnVlO1xyXG4gICAgICAgIHdyYXBwZXIuZG9jLmJvZHkuYWRkQ2xhc3MoXCJmcmVkLXR5cC1ibG9jay1kcmFnZ2luZ1wiKTtcclxuICAgICAgICB3aW4uZ2V0U2VsZWN0aW9uKCk/LnJlbW92ZUFsbFJhbmdlcygpO1xyXG4gICAgICAgIGJsb2NrRWxzLmdldChzZWN0aW9uKS5hZGRDbGFzcyhcImlzLWRyYWdnaW5nXCIpO1xyXG4gICAgICAgIG1lYXN1cmUoKTtcclxuICAgICAgICBpbmRpY2F0b3IgPSB3cmFwcGVyLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1ibG9jay1kcm9wLWluZGljYXRvclwiIH0pO1xyXG4gICAgICB9XHJcbiAgICAgIG1vdmVFdmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICBjb25zdCB5ID0gbW92ZUV2ZW50LmNsaWVudFkgLSB3cmFwcGVyLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpLnRvcDtcclxuICAgICAgdGFyZ2V0SW5kZXggPSBNYXRoLm1heCgxLCBib3hlcy5maWx0ZXIoKGJveCkgPT4gKGJveC50b3AgKyBib3guYm90dG9tKSAvIDIgPCB5KS5sZW5ndGgpO1xyXG4gICAgICBjb25zdCBmcm9tID0gYm94ZXMuZmluZEluZGV4KChib3gpID0+IGJveC5zZWN0aW9uID09PSBzZWN0aW9uKTtcclxuICAgICAgaW5kaWNhdG9yLnRvZ2dsZSh0YXJnZXRJbmRleCAhPT0gZnJvbSAmJiB0YXJnZXRJbmRleCAhPT0gZnJvbSArIDEpO1xyXG4gICAgICAvLyBNaXR0ZSBkZXIgTFx1MDBGQ2NrZSB6d2lzY2hlbiB6d2VpIEJsXHUwMEY2Y2tlbiAoQWJzdGFuZCBzaWVoZVxyXG4gICAgICAvLyAuZnJlZC10eXAtYmxvY2sgKyAuZnJlZC10eXAtYmxvY2sgaW4gc3R5bGVzLmNzcykuXHJcbiAgICAgIGNvbnN0IGhhbGZHYXAgPSA2O1xyXG4gICAgICBjb25zdCBnYXBZID1cclxuICAgICAgICB0YXJnZXRJbmRleCA9PT0gYm94ZXMubGVuZ3RoXHJcbiAgICAgICAgICA/IGJveGVzW2JveGVzLmxlbmd0aCAtIDFdLmJvdHRvbSArIGhhbGZHYXBcclxuICAgICAgICAgIDogKGJveGVzW3RhcmdldEluZGV4IC0gMV0uYm90dG9tICsgYm94ZXNbdGFyZ2V0SW5kZXhdLnRvcCkgLyAyO1xyXG4gICAgICBpbmRpY2F0b3Iuc3R5bGUudG9wID0gYCR7Z2FwWSAtIDF9cHhgO1xyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBlbmQgPSAoY29tbWl0KSA9PiB7XHJcbiAgICAgIHdpbi5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIG9uTW92ZSk7XHJcbiAgICAgIHdpbi5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2V1cFwiLCBvblVwKTtcclxuICAgICAgd2luLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIG9uS2V5LCB0cnVlKTtcclxuICAgICAgaWYgKCFkcmFnZ2luZykgcmV0dXJuO1xyXG4gICAgICB3cmFwcGVyLmRvYy5ib2R5LnJlbW92ZUNsYXNzKFwiZnJlZC10eXAtYmxvY2stZHJhZ2dpbmdcIik7XHJcbiAgICAgIGJsb2NrRWxzLmdldChzZWN0aW9uKS5yZW1vdmVDbGFzcyhcImlzLWRyYWdnaW5nXCIpO1xyXG4gICAgICBpbmRpY2F0b3I/LnJlbW92ZSgpO1xyXG5cclxuICAgICAgY29uc3Qgb3JkZXIgPSBib3hlcy5tYXAoKGJveCkgPT4gYm94LnNlY3Rpb24pO1xyXG4gICAgICBjb25zdCBmcm9tID0gb3JkZXIuaW5kZXhPZihzZWN0aW9uKTtcclxuICAgICAgaWYgKCFjb21taXQgfHwgdGFyZ2V0SW5kZXggPT09IG51bGwgfHwgdGFyZ2V0SW5kZXggPT09IGZyb20gfHwgdGFyZ2V0SW5kZXggPT09IGZyb20gKyAxKSByZXR1cm47XHJcbiAgICAgIG9yZGVyLnNwbGljZShmcm9tLCAxKTtcclxuICAgICAgb3JkZXIuc3BsaWNlKGZyb20gPCB0YXJnZXRJbmRleCA/IHRhcmdldEluZGV4IC0gMSA6IHRhcmdldEluZGV4LCAwLCBzZWN0aW9uKTtcclxuICAgICAgb25Nb3ZlU2VjdGlvbj8uKG9yZGVyKTtcclxuICAgIH07XHJcbiAgICBjb25zdCBvblVwID0gKCkgPT4gZW5kKHRydWUpO1xyXG4gICAgY29uc3Qgb25LZXkgPSAoa2V5RXZlbnQpID0+IHtcclxuICAgICAgaWYgKGtleUV2ZW50LmtleSAhPT0gXCJFc2NhcGVcIikgcmV0dXJuO1xyXG4gICAgICBrZXlFdmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICBrZXlFdmVudC5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgZW5kKGZhbHNlKTtcclxuICAgIH07XHJcbiAgICB3aW4uYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlbW92ZVwiLCBvbk1vdmUpO1xyXG4gICAgd2luLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZXVwXCIsIG9uVXApO1xyXG4gICAgd2luLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIG9uS2V5LCB0cnVlKTtcclxuICB9XHJcblxyXG4gIHJlZ2lzdGVyUHJvcGVydHlEcmFnKCk7XHJcbiAgcmV0dXJuIGFwaTtcclxuXHJcbiAgLyogLS0tIEVpbmUgUHJvcGVydHkgaW4gZWluZW4gYW5kZXJlbiBCbG9jayB6aWVoZW4gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICogQXVmZ2VzZXR6dCBhdWYgT2JzaWRpYW5zIGVpZ2VuZXMgWmVpbGVuLURyYWcgKEd2IGltIGdlYmF1dGVuIGFwcC5qcyksXHJcbiAgICogc3RhdHQgZWluIHp3ZWl0ZXMgZGFuZWJlbnp1c3RlbGxlbjogZGFzIGhcdTAwRTRuZ3QgYW0gVHlwLUljb24gZGVyIFplaWxlXHJcbiAgICogKC5tZXRhZGF0YS1wcm9wZXJ0eS1pY29uKSwgbGVndCBlaW5lbiAuZHJhZy1yZW9yZGVyLWdob3N0IGFuIGRlbiBCb2R5IC1cclxuICAgKiBkZXIgZm9sZ3QgZGVtIEN1cnNvciBhbHNvIG9obmVoaW4gXHUwMEZDYmVyIEJsb2NrZ3JlbnplbiBoaW53ZWcgLSB1bmRcclxuICAgKiBtYXJraWVydCBkaWUgVXJzcHJ1bmdzemVpbGUgbWl0IC5kcmFnLWdob3N0LWhpZGRlbiwgT2JzaWRpYW5zIGVpZ2VuZW1cclxuICAgKiBBa3plbnQtUmVjaHRlY2ssIGRhcyBkaWUgRWluZlx1MDBGQ2dlc3RlbGxlIHplaWd0LiBJbm5lcmhhbGIgZWluZXMgQmxvY2tzXHJcbiAgICogbWFjaHQgT2JzaWRpYW4gZGFtaXQgdW52ZXJcdTAwRTRuZGVydCBhbGxlcyBzZWxic3QuIERhenUga29tbXQgaGllciBudXI6XHJcbiAgICpcclxuICAgKiAgLSBlaW4gbGVlcmVzIFp1c2F0emtpbmQgaW4gZGVyIExpc3RlLCBzb2xhbmdlIGdlem9nZW4gd2lyZDogT2JzaWRpYW5cclxuICAgKiAgICBzdGFydGV0IGRlbiBEcmFnIHNvbnN0IGdhciBuaWNodCwgd2VubiBlaW4gQmxvY2sgbnVyIGVpbmUgZWluemlnZVxyXG4gICAqICAgIFplaWxlIGhhdCAoUHJcdTAwRkNmdW5nIG4uZmlyc3RDaGlsZCAhPT0gbi5sYXN0Q2hpbGQgYmVpbSBtb3VzZWRvd24pO1xyXG4gICAqICAtIGVpbiBQbGF0emhhbHRlciBtaXQgZGVyc2VsYmVuIEtsYXNzZSAuZHJhZy1naG9zdC1oaWRkZW4gaW0gWmllbGJsb2NrLFxyXG4gICAqICAgIHNvYmFsZCBkZXIgQ3Vyc29yIGVpbmVuIGZyZW1kZW4gQmxvY2sgZXJyZWljaHQgLSBkaWUgVXJzcHJ1bmdzemVpbGVcclxuICAgKiAgICB3aXJkIHNvbGFuZ2UgYXVzZ2VibGVuZGV0LCBkYW1pdCBuaWNodCB6d2VpIFJlY2h0ZWNrZSBzdGVoZW47XHJcbiAgICogIC0gcmVvcmRlcktleSBqZSBJbnN0YW56LCBkYXMgYmVpbSBMb3NsYXNzZW4gXHUwMEZDYmVyIGVpbmVtIGZyZW1kZW4gQmxvY2tcclxuICAgKiAgICBkaWUgUHJvcGVydHkgZG9ydGhpbiB1bWhcdTAwRTRuZ3QsIHN0YXR0IGlubmVyaGFsYiBkZXMgZWlnZW5lbiB6dSBzb3J0aWVyZW4uXHJcbiAgICpcclxuICAgKiBEaWUgZWlnZW5lbiBIYW5kbGVyIGxhdWZlbiBpbiBkZXIgQ2FwdHVyZS1QaGFzZSBhbSBGZW5zdGVyIHVuZCBkYW1pdCB2b3JcclxuICAgKiBPYnNpZGlhbnMgZWlnZW5lbiAoZGllIGVzIGluIHNlaW5lbSBtb3VzZWRvd24tSGFuZGxlciBhdWYgd2luZG93IGxlZ3QpLlxyXG4gICAqIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXHJcbiAgZnVuY3Rpb24gcmVnaXN0ZXJQcm9wZXJ0eURyYWcoKSB7XHJcbiAgICAvLyBPaG5lIGVpbmVuIHp3ZWl0ZW4gQmxvY2sgZ2lidCBlcyBrZWluIFppZWwgLSBkYW5uIGJsZWlidCBPYnNpZGlhbnNcclxuICAgIC8vIGVpZ2VuZXMgRHJhZyB2XHUwMEY2bGxpZyB1bmFuZ2V0YXN0ZXQuXHJcbiAgICBjb25zdCBhbmNob3IgPSBhcGkuZWRpdG9yc1swXTtcclxuICAgIGlmICghYW5jaG9yIHx8IHNlY3Rpb25zLmxlbmd0aCA8IDIpIHJldHVybjtcclxuXHJcbiAgICAvLyBMXHUwMEU0dWZ0IGVpbiBEcmFnLCBoXHUwMEU0bHQgZGllcyBkZXNzZW4gWnVzdGFuZDsgZHJvcCBtZXJrdCBzaWNoIGJlaW1cclxuICAgIC8vIExvc2xhc3NlbiBkYXMgWmllbCBmXHUwMEZDciBkYXMgYW5zY2hsaWVcdTAwREZlbmRlIHJlb3JkZXJLZXkuXHJcbiAgICBsZXQgZHJhZyA9IG51bGw7XHJcbiAgICBsZXQgZHJvcCA9IG51bGw7XHJcblxyXG4gICAgY29uc3Qgc2VjdGlvbkF0ID0gKGNsaWVudFkpID0+XHJcbiAgICAgIHNlY3Rpb25zLmZpbmQoKHNlY3Rpb24pID0+IHtcclxuICAgICAgICBjb25zdCByZWN0ID0gYmxvY2tFbHMuZ2V0KHNlY3Rpb24pLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xyXG4gICAgICAgIHJldHVybiBjbGllbnRZID49IHJlY3QudG9wICYmIGNsaWVudFkgPD0gcmVjdC5ib3R0b207XHJcbiAgICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGNsZWFyUGxhY2Vob2xkZXIgPSAoKSA9PiB7XHJcbiAgICAgIGRyYWcucGxhY2Vob2xkZXI/LnJlbW92ZSgpO1xyXG4gICAgICBkcmFnLnBsYWNlaG9sZGVyID0gbnVsbDtcclxuICAgICAgZHJhZy5yb3dFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImRpc3BsYXlcIik7XHJcbiAgICAgIGRyYWcudGFyZ2V0ID0gbnVsbDtcclxuICAgIH07XHJcblxyXG4gICAgd3JhcHBlci5hZGRFdmVudExpc3RlbmVyKFxyXG4gICAgICBcIm1vdXNlZG93blwiLFxyXG4gICAgICAoZXZlbnQpID0+IHtcclxuICAgICAgICBpZiAoZXZlbnQuYnV0dG9uICE9PSAwKSByZXR1cm47XHJcbiAgICAgICAgY29uc3Qgcm93RWwgPSBldmVudC50YXJnZXQuY2xvc2VzdChcIi5tZXRhZGF0YS1wcm9wZXJ0eS1pY29uXCIpPy5jbG9zZXN0KFwiLm1ldGFkYXRhLXByb3BlcnR5XCIpO1xyXG4gICAgICAgIGNvbnN0IHNlY3Rpb24gPSByb3dFbD8uY2xvc2VzdChcIi5mcmVkLXR5cC1ibG9ja1wiKT8uZnJlZFNlY3Rpb247XHJcbiAgICAgICAgY29uc3QgZWRpdG9yID0gc2VjdGlvbiA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IGVkaXRvcnMuZ2V0KHNlY3Rpb24pO1xyXG4gICAgICAgIGNvbnN0IGtleSA9IGVkaXRvcj8ucmVuZGVyZWQuZmluZCgocm93KSA9PiByb3cuY29udGFpbmVyRWwgPT09IHJvd0VsKT8uZW50cnkua2V5O1xyXG4gICAgICAgIC8vIEVpbmUgbm9jaCB1bmJlbmFubnRlIFplaWxlIGhhdCBpbiBlaW5lbSBhbmRlcmVuIEJsb2NrIG5pY2h0cyB6dVxyXG4gICAgICAgIC8vIHN1Y2hlbiAtIHNpZSBibGVpYnQgT2JzaWRpYW5zIGVpZ2VuZXIgU29ydGllcnVuZyBcdTAwRkNiZXJsYXNzZW4uXHJcbiAgICAgICAgaWYgKCFrZXkpIHJldHVybjtcclxuICAgICAgICBkcmFnID0ge1xyXG4gICAgICAgICAgc2VjdGlvbixcclxuICAgICAgICAgIGtleSxcclxuICAgICAgICAgIHJvd0VsLFxyXG4gICAgICAgICAgLy8gSmV0enQgc2Nob24gZ2VtZXNzZW46IHNvYmFsZCBkaWUgWmVpbGUgZlx1MDBGQ3IgZGVuIFBsYXR6aGFsdGVyXHJcbiAgICAgICAgICAvLyBhdXNnZWJsZW5kZXQgaXN0LCBsaWVmZXJ0IG9mZnNldEhlaWdodCAwLlxyXG4gICAgICAgICAgaGVpZ2h0OiByb3dFbC5vZmZzZXRIZWlnaHQsXHJcbiAgICAgICAgICBzcGFjZXI6IGVkaXRvci5wcm9wZXJ0eUxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZHJhZy1zcGFjZXJcIiB9KSxcclxuICAgICAgICAgIHBsYWNlaG9sZGVyOiBudWxsLFxyXG4gICAgICAgICAgdGFyZ2V0OiBudWxsLFxyXG4gICAgICAgIH07XHJcbiAgICAgICAgZHJvcCA9IG51bGw7XHJcbiAgICAgIH0sXHJcbiAgICAgIHRydWVcclxuICAgICk7XHJcblxyXG4gICAgLy8gQW0gRmVuc3RlciByZWdpc3RyaWVydCwgZGFtaXQgZWluIERyYWcgYXVjaCBhdVx1MDBERmVyaGFsYiBkZXIgQmxcdTAwRjZja2VcclxuICAgIC8vIHdlaXRlcnZlcmZvbGd0IHdpcmQgLSBhYmdlclx1MDBFNHVtdCBtaXQgZGVtIGVyc3RlbiBFZGl0b3IsIGRlciBiZWltXHJcbiAgICAvLyBuXHUwMEU0Y2hzdGVuIE5ldWF1ZmJhdSBkZXIgRGV0YWlsYW5zaWNodCBlbnRsYWRlbiB3aXJkIChzaWVoZVxyXG4gICAgLy8gZGVzdHJveUZyb250bWF0dGVyRWRpdG9yIGluIHR5cC12aWV3LmpzKS5cclxuICAgIGNvbnN0IG9uV2luTW92ZSA9IChldmVudCkgPT4ge1xyXG4gICAgICBpZiAoIWRyYWcpIHJldHVybjtcclxuICAgICAgY29uc3QgdGFyZ2V0ID0gc2VjdGlvbkF0KGV2ZW50LmNsaWVudFkpO1xyXG4gICAgICBpZiAodGFyZ2V0ID09PSB1bmRlZmluZWQgfHwgdGFyZ2V0ID09PSBkcmFnLnNlY3Rpb24pIHtcclxuICAgICAgICBpZiAoZHJhZy5wbGFjZWhvbGRlcikgY2xlYXJQbGFjZWhvbGRlcigpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgbGlzdCA9IGVkaXRvcnMuZ2V0KHRhcmdldCkucHJvcGVydHlMaXN0RWw7XHJcbiAgICAgIGlmICghZHJhZy5wbGFjZWhvbGRlcikge1xyXG4gICAgICAgIGRyYWcucm93RWwuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xyXG4gICAgICAgIGRyYWcucGxhY2Vob2xkZXIgPSBjcmVhdGVEaXYoeyBjbHM6IFwibWV0YWRhdGEtcHJvcGVydHkgZHJhZy1naG9zdC1oaWRkZW4gZnJlZC10eXAtZHJhZy1wbGFjZWhvbGRlclwiIH0pO1xyXG4gICAgICAgIGRyYWcucGxhY2Vob2xkZXIuc3R5bGUuaGVpZ2h0ID0gYCR7ZHJhZy5oZWlnaHR9cHhgO1xyXG4gICAgICB9XHJcbiAgICAgIC8vIEVpbmZcdTAwRkNnZXN0ZWxsZSB3aWUgYmVpIE9ic2lkaWFuIHNlbGJzdDogdm9yIGRlciBlcnN0ZW4gWmVpbGUsIGRlcmVuXHJcbiAgICAgIC8vIE1pdHRlIHVudGVyaGFsYiBkZXMgQ3Vyc29ycyBsaWVndC5cclxuICAgICAgY29uc3Qgcm93cyA9IFsuLi5saXN0LmNoaWxkcmVuXS5maWx0ZXIoKGVsKSA9PiBlbCAhPT0gZHJhZy5wbGFjZWhvbGRlciAmJiBlbCAhPT0gZHJhZy5zcGFjZXIpO1xyXG4gICAgICBjb25zdCBiZWZvcmUgPSByb3dzLmZpbmQoKGVsKSA9PiB7XHJcbiAgICAgICAgY29uc3QgcmVjdCA9IGVsLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xyXG4gICAgICAgIHJldHVybiBldmVudC5jbGllbnRZIDwgcmVjdC50b3AgKyByZWN0LmhlaWdodCAvIDI7XHJcbiAgICAgIH0pO1xyXG4gICAgICBkcmFnLnRhcmdldCA9IHsgc2VjdGlvbjogdGFyZ2V0LCBpbmRleDogYmVmb3JlID8gcm93cy5pbmRleE9mKGJlZm9yZSkgOiByb3dzLmxlbmd0aCB9O1xyXG4gICAgICBsaXN0Lmluc2VydEJlZm9yZShkcmFnLnBsYWNlaG9sZGVyLCBiZWZvcmUgPz8gbnVsbCk7XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IG9uV2luVXAgPSAoKSA9PiB7XHJcbiAgICAgIGlmICghZHJhZykgcmV0dXJuO1xyXG4gICAgICBjb25zdCB7IHNwYWNlciwgcGxhY2Vob2xkZXIsIHJvd0VsLCB0YXJnZXQgfSA9IGRyYWc7XHJcbiAgICAgIGRyYWcgPSBudWxsO1xyXG4gICAgICBkcm9wID0gdGFyZ2V0O1xyXG4gICAgICBwbGFjZWhvbGRlcj8ucmVtb3ZlKCk7XHJcbiAgICAgIHJvd0VsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiZGlzcGxheVwiKTtcclxuICAgICAgLy8gRXJzdCBuYWNoIE9ic2lkaWFucyBlaWdlbmVtIERyYWctQWJzY2hsdXNzOiBkZXIgYmVzdGltbXQgZGllXHJcbiAgICAgIC8vIEVpbmZcdTAwRkNnZXN0ZWxsZSBpbm5lcmhhbGIgZGVzIEF1c2dhbmdzYmxvY2tzIG5vY2ggXHUwMEZDYmVyIGRpZSBLaW5kZXJsaXN0ZSxcclxuICAgICAgLy8gaW4gZGVyIGRhcyBadXNhdHpraW5kIGRpZSBsZXR6dGUgUG9zaXRpb24gbWFya2llcnQuXHJcbiAgICAgIHdyYXBwZXIud2luLnNldFRpbWVvdXQoKCkgPT4gc3BhY2VyLnJlbW92ZSgpLCAwKTtcclxuICAgIH07XHJcblxyXG4gICAgd3JhcHBlci53aW4uYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlbW92ZVwiLCBvbldpbk1vdmUsIHRydWUpO1xyXG4gICAgd3JhcHBlci53aW4uYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNldXBcIiwgb25XaW5VcCwgdHJ1ZSk7XHJcbiAgICBhbmNob3IucmVnaXN0ZXIoKCkgPT4ge1xyXG4gICAgICB3cmFwcGVyLndpbi5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIG9uV2luTW92ZSwgdHJ1ZSk7XHJcbiAgICAgIHdyYXBwZXIud2luLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtb3VzZXVwXCIsIG9uV2luVXAsIHRydWUpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgZm9yIChjb25zdCBbc2VjdGlvbiwgZWRpdG9yXSBvZiBlZGl0b3JzKSB7XHJcbiAgICAgIGNvbnN0IG9yaWdpbmFsUmVvcmRlcktleSA9IGVkaXRvci5yZW9yZGVyS2V5O1xyXG4gICAgICBlZGl0b3IucmVvcmRlcktleSA9IGZ1bmN0aW9uIChlbnRyeSwgaW5kZXgpIHtcclxuICAgICAgICBjb25zdCB0YXJnZXQgPSBkcm9wO1xyXG4gICAgICAgIGRyb3AgPSBudWxsO1xyXG4gICAgICAgIGlmICghdGFyZ2V0KSByZXR1cm4gb3JpZ2luYWxSZW9yZGVyS2V5LmNhbGwodGhpcywgZW50cnksIGluZGV4KTtcclxuICAgICAgICBtb3ZlUHJvcGVydHkoc2VjdGlvbiwgdGFyZ2V0LnNlY3Rpb24sIGVudHJ5LmtleSwgdGFyZ2V0LmluZGV4KTtcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8vIEhcdTAwRTRuZ3Qga2V5IGF1cyBkZW0gQmxvY2sgZnJvbSBpbiBkZW4gQmxvY2sgdG8gdW0sIGRvcnQgYW4gUG9zaXRpb24gaW5kZXguXHJcbiAgLy8gRlx1MDBGQ2hydCBkYXMgWmllbCBkZW4gTmFtZW4gYmVyZWl0cyAoaW5uZXJoYWxiIGVpbmVzIEJsb2NrcyBtdXNzIGVyIGVpbmRldXRpZ1xyXG4gIC8vIGJsZWliZW4pLCB3ZXJkZW4gYmVpZGUgenVzYW1tZW5nZWxlZ3Q6IGRlciBiZXN0ZWhlbmRlIEVpbnRyYWcgYmVoXHUwMEU0bHRcclxuICAvLyBQb3NpdGlvbiwgV2VydCwgRmxvYXRpbmctTWFya2llcnVuZyB1bmQgU2hvcnRjdXQsIG51ciBlaW4gbGVlcmVyIFdlcnQgd2lyZFxyXG4gIC8vIGF1cyBkZXIgZ2V6b2dlbmVuIFByb3BlcnR5IGdlZlx1MDBGQ2xsdCAtIGRpZXNlbGJlIFJlZ2VsIHdpZSBiZWkgbWVyZ2VTdWJ0eXBlc1xyXG4gIC8vIChzdWJ0eXBlcy5qcykgdW5kIHJlbmFtZUluU3RvcmUgKHByb3BlcnR5LXJlbmFtZS1zeW5jLmpzKS5cclxuICBhc3luYyBmdW5jdGlvbiBtb3ZlUHJvcGVydHkoZnJvbSwgdG8sIGtleSwgaW5kZXgpIHtcclxuICAgIGNvbnN0IHNvdXJjZSA9IHN0b3Jlcy5nZXQoZnJvbSk7XHJcbiAgICBjb25zdCB0YXJnZXQgPSBzdG9yZXMuZ2V0KHRvKTtcclxuICAgIGlmICghc291cmNlIHx8ICF0YXJnZXQgfHwgZnJvbSA9PT0gdG8pIHJldHVybjtcclxuXHJcbiAgICBjb25zdCBzb3VyY2VGcm9udG1hdHRlciA9IHsgLi4uc291cmNlLmdldEZyb250bWF0dGVyKCkgfTtcclxuICAgIGNvbnN0IHZhbHVlID0gc291cmNlRnJvbnRtYXR0ZXJba2V5XTtcclxuICAgIGNvbnN0IHdhc0Zsb2F0aW5nID0gc291cmNlLmdldEZsb2F0aW5nKCkuaW5jbHVkZXMoa2V5KTtcclxuICAgIC8vIERlciBTaG9ydGN1dCBoXHUwMEU0bmd0IGFtIEtleSAoc2llaGUgc2hvcnRjdXRzLmpzKSB1bmQgemllaHQgZGVzaGFsYiBtaXQgZGVyXHJcbiAgICAvLyBQcm9wZXJ0eSBpbiBkZW4gYW5kZXJlbiBCbG9jayB1bS5cclxuICAgIGNvbnN0IHNvdXJjZVNob3J0Y3V0cyA9IHsgLi4uc291cmNlLmdldFNob3J0Y3V0cygpIH07XHJcbiAgICBjb25zdCBzaG9ydGN1dCA9IHNvdXJjZVNob3J0Y3V0c1trZXldID8/IG51bGw7XHJcbiAgICBkZWxldGUgc291cmNlU2hvcnRjdXRzW2tleV07XHJcbiAgICBkZWxldGUgc291cmNlRnJvbnRtYXR0ZXJba2V5XTtcclxuICAgIHNvdXJjZS5zZXRGcm9udG1hdHRlcihzb3VyY2VGcm9udG1hdHRlcik7XHJcbiAgICBzb3VyY2Uuc2V0RmxvYXRpbmcoc291cmNlLmdldEZsb2F0aW5nKCkuZmlsdGVyKChrKSA9PiBrICE9PSBrZXkpKTtcclxuICAgIHNvdXJjZS5zZXRTaG9ydGN1dHMoc291cmNlU2hvcnRjdXRzKTtcclxuXHJcbiAgICBjb25zdCB0YXJnZXRGcm9udG1hdHRlciA9IHRhcmdldC5nZXRGcm9udG1hdHRlcigpO1xyXG4gICAgY29uc3QgZXhpc3RpbmcgPSBPYmplY3Qua2V5cyh0YXJnZXRGcm9udG1hdHRlcikuZmluZCgoaykgPT4gay50b0xvd2VyQ2FzZSgpID09PSBrZXkudG9Mb3dlckNhc2UoKSk7XHJcbiAgICBpZiAoZXhpc3RpbmcgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICBpZiAoaXNFbXB0eVZhbHVlKHRhcmdldEZyb250bWF0dGVyW2V4aXN0aW5nXSkpIHRhcmdldC5zZXRGcm9udG1hdHRlcih7IC4uLnRhcmdldEZyb250bWF0dGVyLCBbZXhpc3RpbmddOiB2YWx1ZSB9KTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyh0YXJnZXRGcm9udG1hdHRlcik7XHJcbiAgICAgIGNvbnN0IGF0ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oaW5kZXgsIGtleXMubGVuZ3RoKSk7XHJcbiAgICAgIGNvbnN0IG5leHQgPSB7fTtcclxuICAgICAgZm9yIChjb25zdCBrIG9mIGtleXMuc2xpY2UoMCwgYXQpKSBuZXh0W2tdID0gdGFyZ2V0RnJvbnRtYXR0ZXJba107XHJcbiAgICAgIG5leHRba2V5XSA9IHZhbHVlO1xyXG4gICAgICBmb3IgKGNvbnN0IGsgb2Yga2V5cy5zbGljZShhdCkpIG5leHRba10gPSB0YXJnZXRGcm9udG1hdHRlcltrXTtcclxuICAgICAgdGFyZ2V0LnNldEZyb250bWF0dGVyKG5leHQpO1xyXG4gICAgICBpZiAod2FzRmxvYXRpbmcpIHRhcmdldC5zZXRGbG9hdGluZyhbLi4udGFyZ2V0LmdldEZsb2F0aW5nKCksIGtleV0pO1xyXG4gICAgICBpZiAoc2hvcnRjdXQpIHRhcmdldC5zZXRTaG9ydGN1dHMoeyAuLi50YXJnZXQuZ2V0U2hvcnRjdXRzKCksIFtrZXldOiBzaG9ydGN1dCB9KTtcclxuICAgIH1cclxuXHJcbiAgICBhd2FpdCB2aWV3LnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgIC8vIFJlbmRlcnQgdS4gYS4gZGllc2UgRGV0YWlsYW5zaWNodCBuZXUgKHNpZWhlIHJlZ2lzdGVyVHlwVmlldykgLSBkaWVcclxuICAgIC8vIEJsXHUwMEY2Y2tlIGVudHN0ZWhlbiBkYWJlaSBzYW10IEVkaXRvcmVuIGZyaXNjaCBhdXMgZGVuIEVpbnN0ZWxsdW5nZW4uXHJcbiAgICB2aWV3LnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0geyBtb3VudEZyb250bWF0dGVyQmxvY2tzIH07XHJcbiIsICIvLyBSZWluZSBIaWxmc2Z1bmt0aW9uZW4gb2huZSBlaWdlbmVuIFN0YXRlIHJ1bmQgdW0gVFlQLU5hbWVuIHVuZCBkZXJlblxuLy8gU29ydGllcnVuZy5cblxuLy8gVFlQZW4gd2VyZGVuIGF1c3NjaGxpZVx1MDBERmxpY2ggaW4gR3JvXHUwMERGYnVjaHN0YWJlbiBhbmdlbGVndC91bWJlbmFubnQgLSBiZWltXG4vLyBBbmxlZ2VuIHdpZSBiZWltIFVtYmVuZW5uZW4uIEJldHJpZmZ0IG51ciBcdTAwRkNiZXIgZGllIExpc3RlIGdldGlwcHRlIE5hbWVuLFxuLy8gbmljaHQgV2VydGUsIGRpZSB6LiBCLiBkaXJla3QgaW0gRnJvbnRtYXR0ZXIgZWluZXIgTm90aXogaW4gS2xlaW5zY2hyZWlidW5nXG4vLyBzdGVoZW4gKHNpZWhlIFwidW5yZWdpc3RyaWVydGVcIiBaZWlsZW4gaW4gdHlwLXZpZXcuanMpLlxuZnVuY3Rpb24gbm9ybWFsaXplVHlwZU5hbWUocmF3KSB7XG4gIHJldHVybiByYXcudHJpbSgpLnRvVXBwZXJDYXNlKCk7XG59XG5cbi8vIEZhcmJ0b24gKDAtMzYwXHUwMEIwKSBhdXMgZWluZW0gSGV4LUNvZGUsIGZcdTAwRkNyIGRpZSBTb3J0aWVydW5nIG5hY2ggRmFyYnNwZWt0cnVtXG4vLyBzdGF0dCBuYWNoIEhleC1TdHJpbmcuIFJvdCBsaWVndCBiZWkgMFx1MDBCMC8zNjBcdTAwQjAgKEtyZWlzKSAtIGF1ZnN0ZWlnZW5kIGJlZ2lubnRcbi8vIGRpZSBTb3J0aWVydW5nIGRhbWl0IGJlaSBSb3QsIGxcdTAwRTR1ZnQgXHUwMEZDYmVyIE9yYW5nZS9HZWxiL0dyXHUwMEZDbi9DeWFuL0JsYXUvTWFnZW50YVxuLy8gdW5kIGxhbmRldCB3aWVkZXIgYmVpIFJvdC4gQWNocm9tYXRpc2NoZSBGYXJiZW4gKEdyYXUvU2Nod2Fyei9XZWlcdTAwREYsIGRlbHRhPTApXG4vLyBoYWJlbiBrZWluZW4gZGVmaW5pZXJ0ZW4gRmFyYnRvbiAtIGRhZlx1MDBGQ3IgbGllZmVydCBkaWVzZSBGdW5rdGlvbiBudWxsLCBkYW1pdFxuLy8gY29tcGFyZVR5cGVzIHNpZSB1bmFiaFx1MDBFNG5naWcgdm9uIGRlciBTb3J0aWVycmljaHR1bmcgYW5zIEVuZGUgc3RlbGxlbiBrYW5uLlxuZnVuY3Rpb24gaGV4VG9IdWUoaGV4KSB7XG4gIGNvbnN0IG1hdGNoID0gL14jPyhbMC05YS1mXXs2fSkkL2kuZXhlYyhoZXggPz8gXCJcIik7XG4gIGlmICghbWF0Y2gpIHJldHVybiBudWxsO1xuICBjb25zdCBpbnQgPSBwYXJzZUludChtYXRjaFsxXSwgMTYpO1xuICBjb25zdCByID0gKChpbnQgPj4gMTYpICYgMjU1KSAvIDI1NTtcbiAgY29uc3QgZyA9ICgoaW50ID4+IDgpICYgMjU1KSAvIDI1NTtcbiAgY29uc3QgYiA9IChpbnQgJiAyNTUpIC8gMjU1O1xuICBjb25zdCBtYXggPSBNYXRoLm1heChyLCBnLCBiKTtcbiAgY29uc3QgbWluID0gTWF0aC5taW4ociwgZywgYik7XG4gIGNvbnN0IGRlbHRhID0gbWF4IC0gbWluO1xuICBpZiAoZGVsdGEgPT09IDApIHJldHVybiBudWxsO1xuXG4gIGxldCBodWU7XG4gIGlmIChtYXggPT09IHIpIGh1ZSA9ICgoZyAtIGIpIC8gZGVsdGEpICUgNjtcbiAgZWxzZSBpZiAobWF4ID09PSBnKSBodWUgPSAoYiAtIHIpIC8gZGVsdGEgKyAyO1xuICBlbHNlIGh1ZSA9IChyIC0gZykgLyBkZWx0YSArIDQ7XG4gIGh1ZSAqPSA2MDtcbiAgcmV0dXJuIGh1ZSA8IDAgPyBodWUgKyAzNjAgOiBodWU7XG59XG5cbi8vIEdlbWVpbnNhbWUgU29ydGllcmxvZ2lrIGZcdTAwRkNyIFRZUC0gdW5kIFNVQlRZUC1MaXN0ZW4uIHR5cGVDb2xvcnMgZGFyZiBlaW5cbi8vIGxlZXJlcyBPYmpla3Qgc2VpbiAoU1VCVFlQIGhhdCBrZWluZSBlaWdlbmUgRmFyYmUpIC0gZGVyIFwiY29sb3JcIi1Nb2R1cyB3aXJkXG4vLyBkb3J0IHNjaGxpY2h0IG5pZSBhdXNnZXdcdTAwRTRobHQuXG5mdW5jdGlvbiBjb21wYXJlVHlwZXMobW9kZSwgYSwgYiwgY291bnRzLCB0eXBlQ29sb3JzKSB7XG4gIGNvbnN0IFtrZXksIGRpcl0gPSBtb2RlLnNwbGl0KFwiLVwiKTtcbiAgbGV0IGNtcDtcbiAgaWYgKGtleSA9PT0gXCJjb3VudFwiKSB7XG4gICAgY21wID0gKGNvdW50cy5nZXQoYSkgPz8gMCkgLSAoY291bnRzLmdldChiKSA/PyAwKTtcbiAgICBpZiAoZGlyID09PSBcImRlc2NcIikgY21wID0gLWNtcDtcbiAgfSBlbHNlIGlmIChrZXkgPT09IFwiY29sb3JcIikge1xuICAgIGNvbnN0IGh1ZUEgPSBoZXhUb0h1ZSh0eXBlQ29sb3JzW2FdID8/IG51bGwpO1xuICAgIGNvbnN0IGh1ZUIgPSBoZXhUb0h1ZSh0eXBlQ29sb3JzW2JdID8/IG51bGwpO1xuICAgIC8vIEFjaHJvbWF0aXNjaGUgRmFyYmVuIGJsZWliZW4gaW1tZXIgYW0gRW5kZSwgZWdhbCBvYiBhdWYtIG9kZXIgYWJzdGVpZ2VuZFxuICAgIC8vIHNvcnRpZXJ0IHdpcmQgLSBudXIgZGllIFJlaWhlbmZvbGdlIGlubmVyaGFsYiBkZXIgZWNodGVuIEZhcmJ0XHUwMEY2bmUgZHJlaHQgc2ljaCB1bS5cbiAgICBpZiAoaHVlQSA9PT0gbnVsbCAmJiBodWVCID09PSBudWxsKSBjbXAgPSAwO1xuICAgIGVsc2UgaWYgKGh1ZUEgPT09IG51bGwpIGNtcCA9IDE7XG4gICAgZWxzZSBpZiAoaHVlQiA9PT0gbnVsbCkgY21wID0gLTE7XG4gICAgZWxzZSB7XG4gICAgICBjbXAgPSBodWVBIC0gaHVlQjtcbiAgICAgIGlmIChkaXIgPT09IFwiZGVzY1wiKSBjbXAgPSAtY21wO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBjbXAgPSBhLmxvY2FsZUNvbXBhcmUoYik7XG4gICAgaWYgKGRpciA9PT0gXCJkZXNjXCIpIGNtcCA9IC1jbXA7XG4gIH1cbiAgcmV0dXJuIGNtcCB8fCBhLmxvY2FsZUNvbXBhcmUoYik7XG59XG5cbi8vIFdlbmRldCBkZW4gYWt0dWVsbGVuIFNvcnRpZXJtb2R1cyBhdWYgZWluZSBMaXN0ZSB2b24gVFlQZW4gYW4uIFNvbmRlcmZhbGxcbi8vIFwibWFudWFsXCIgKHNpZWhlIFNPUlRfT1BUSU9OUyBpbiB0eXAtdmlldy5qcyk6IGRvcnQgYmxlaWJ0IGJld3Vzc3QgZGllXG4vLyBcdTAwRkNiZXJnZWJlbmUgUmVpaGVuZm9sZ2Ugc2VsYnN0IGVyaGFsdGVuLCBzdGF0dCBzaWUgenUgc29ydGllcmVuIC0gc2llIElTVCBpblxuLy8gZGllc2VtIE1vZHVzIGRpZSBnZXNwZWljaGVydGUgU29ydGllcnVuZyAocGx1Z2luLnNldHRpbmdzLnR5cGVzLCBwZXIgRHJhZyAmXG4vLyBEcm9wIGluIHR5cC12aWV3LmpzIHZlcnNjaG9iZW4pLiBFaW4gVmVyZ2xlaWNoIHp3ZWllciBUWVBlbiBrXHUwMEY2bm50ZSBkaWVzZVxuLy8gUmVpaGVuZm9sZ2UgbmljaHQgaGVybGVpdGVuLCBjb21wYXJlVHlwZXMgYmxlaWJ0IGRhaGVyIHVuYW5nZXRhc3RldC4gVm9uXG4vLyBtYWluLmpzIChnZXRUeXBlcygpLCBmXHUwMEZDciBUZW1wbGF0ZXIvUGlja2VyKSBVTkQgdHlwLXZpZXcuanMgZ2VudXR6dCwgZGFtaXRcbi8vIGJlaWRlIGRpZXNlbGJlIFJlaWhlbmZvbGdlIHplaWdlbi5cbmZ1bmN0aW9uIHNvcnRUeXBlc0J5TW9kZSh0eXBlcywgbW9kZSwgY291bnRzLCB0eXBlQ29sb3JzKSB7XG4gIGlmIChtb2RlID09PSBcIm1hbnVhbFwiKSByZXR1cm4gWy4uLnR5cGVzXTtcbiAgcmV0dXJuIFsuLi50eXBlc10uc29ydCgoYSwgYikgPT4gY29tcGFyZVR5cGVzKG1vZGUsIGEsIGIsIGNvdW50cywgdHlwZUNvbG9ycykpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgbm9ybWFsaXplVHlwZU5hbWUsIGhleFRvSHVlLCBjb21wYXJlVHlwZXMsIHNvcnRUeXBlc0J5TW9kZSB9O1xuIiwgImNvbnN0IHsgSXRlbVZpZXcsIE1lbnUsIE1vZGFsLCBOb3RpY2UsIHNldEljb24sIGRlYm91bmNlIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XHJcbmNvbnN0IHsgbW91bnRGcm9udG1hdHRlckJsb2NrcyB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItYmxvY2tzXCIpO1xyXG5jb25zdCB7XHJcbiAgbm9ybWFsaXplU3VidHlwZU5hbWUsXHJcbiAgZ2V0U3VidHlwZU5hbWVzLFxyXG4gIGVuc3VyZVN1YnR5cGUsXHJcbiAgbW92ZVR5cGVTdWJ0eXBlcyxcclxuICBkZWxldGVUeXBlU3VidHlwZXMsXHJcbiAgbWVyZ2VUeXBlU3VidHlwZXMsXHJcbiAgZ2V0U3VidHlwZSxcclxuICByZW5hbWVTdWJ0eXBlLFxyXG4gIHJlb3JkZXJTdWJ0eXBlcyxcclxuICBkZWxldGVTdWJ0eXBlLFxyXG4gIG1lcmdlU3VidHlwZXMsXHJcbiAgcmVuYW1lU3VidHlwZUluTm90ZXMsXHJcbn0gPSByZXF1aXJlKFwiLi9zdWJ0eXBlc1wiKTtcclxuY29uc3QgeyBub3JtYWxpemVUeXBlTmFtZSwgY29tcGFyZVR5cGVzLCBzb3J0VHlwZXNCeU1vZGUgfSA9IHJlcXVpcmUoXCIuL3R5cGUtdXRpbHNcIik7XHJcbmNvbnN0IHsgdHlwZUtleU9mLCBwcm9wZXJ0eVZhbHVlLCBzZXRDYW5vbmljYWxQcm9wZXJ0eSwgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcclxuY29uc3Qge1xyXG4gIHN1YnR5cGVDb2xvcixcclxuICBhcHBseUNvbG9yT2Zmc2V0LFxyXG4gIGhhc0NvbG9yT2Zmc2V0LFxyXG4gIHN1YnR5cGVIYXNPd25Db2xvcixcclxuICBwYWludENvbG9yRG90LFxyXG4gIG5hbWVDb2xvcixcclxuICBjaGFubmVsQm91bmRzLFxyXG4gIGNsYW1wZWRPZmZzZXQsXHJcbiAgU1VCVFlQRV9DT0xPUl9DSEFOTkVMUyxcclxuICBERUZBVUxUX1RZUEVfQ09MT1IsXHJcbn0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcclxuXHJcbmNvbnN0IFZJRVdfVFlQRV9UWVAgPSBcImZyZWQtdHlwLXZpZXdcIjtcclxuY29uc3QgREVGQVVMVF9TT1JUX09SREVSID0gXCJjb3VudC1kZXNjXCI7XHJcbmNvbnN0IERFRkFVTFRfU0VDT05EQVJZID0gXCJzdWJ0eXBlc1wiO1xyXG5cclxuLy8gV2FzIGluIGRlciBUWVAtTGlzdGUgcmVjaHRzIG5lYmVuIGRlbSBOYW1lbiBzdGVodCAoc2V0dGluZ3MudHlwTGlzdFNlY29uZGFyeSkuXHJcbi8vIFVtZ2VzY2hhbHRldCB3aXJkIG5pY2h0IFx1MDBGQ2JlciBkaWUgRWluc3RlbGx1bmdlbiwgc29uZGVybiBcdTAwRkNiZXIgZWluZW4gS25vcGYgaW1cclxuLy8gTGlzdGVuLUhlYWRlciBuZWJlbiBkZXIgU29ydGllcnVuZywgZGVyIGRpZSBNb2RpIGRlciBSZWloZSBuYWNoIGR1cmNoc2NoYWx0ZXRcclxuLy8gKHNpZWhlIGN5Y2xlU2Vjb25kYXJ5KSAtIGVzIHNpbmQgenUgd2VuaWdlIHVuZCB6dSB1bm1pdHRlbGJhciBzaWNodGJhcmVcclxuLy8gWnVzdGFlbmRlIGZ1ZXIgZWluIE1lbnVlLlxyXG4vLyAgIHN1YnR5cGVzICAgIC0gZGllIFN1YnR5cGVuIGRlcyBUWVBzIGluIEtsYW1tZXJuLCBqZSBpbiBzZWluZXIgRmFyYmVcclxuLy8gICAgICAgICAgICAgICAgICh3aWUgZGllIFZvcnNjaGF1IGltIHNlcGFyYXRlbiBUWVAtUGlja2VyLCBzaWVoZVxyXG4vLyAgICAgICAgICAgICAgICAgcmVuZGVyU3VidHlwZVByZXZpZXcgaW4gdHlwZS1waWNrZXIuanMpXHJcbi8vICAgZGVzY3JpcHRpb24gLSBUZXh0ZmVsZCB6dXIgQmVhcmJlaXR1bmcgZGVyIFRZUC1CZXNjaHJlaWJ1bmdcclxuLy8gICBub25lICAgICAgICAtIG5pY2h0cywgZGVyIE5hbWUgYmVrb21tdCBkaWUgZ2FuemUgWmVpbGVcclxuLy8gRGllIFJlaWhlbmZvbGdlIGlzdCB6dWdsZWljaCBkaWUgZGVzIER1cmNoc2NoYWx0ZW5zLCBkZXIgZXJzdGUgRWludHJhZyBkZXJcclxuLy8gU3RhbmRhcmQgKERFRkFVTFRfU0VDT05EQVJZKTogZGllIFN1YnR5cGVuIHN0ZWhlbiBzb25zdCBuaXJnZW5kcyBpbiBkZXJcclxuLy8gTGlzdGUsIGRpZSBCZXNjaHJlaWJ1bmcgZGFnZWdlbiBhdWNoIGluIGRlciBEZXRhaWxhbnNpY2h0IGRlcyBUWVBzLlxyXG5jb25zdCBTRUNPTkRBUllfTU9ERVMgPSBbXHJcbiAgeyBtb2RlOiBcInN1YnR5cGVzXCIsIHRpdGxlOiBcIlN1YnR5cGVuXCIsIGljb246IFwibGlzdC10cmVlXCIgfSxcclxuICB7IG1vZGU6IFwiZGVzY3JpcHRpb25cIiwgdGl0bGU6IFwiQmVzY2hyZWlidW5nXCIsIGljb246IFwidGV4dC1jdXJzb3ItaW5wdXRcIiB9LFxyXG4gIHsgbW9kZTogXCJub25lXCIsIHRpdGxlOiBcIk5pY2h0c1wiLCBpY29uOiBcIm1pbnVzXCIgfSxcclxuXTtcclxuXHJcbmNvbnN0IFNPUlRfT1BUSU9OUyA9IFtcclxuICAvLyBOdXR6dCAoYW5kZXJzIGFscyBkaWUgXHUwMEZDYnJpZ2VuIE1vZGkpIGtlaW5lbiBlaWdlbmVuIFZlcmdsZWljaCwgc29uZGVybiBkaWVcclxuICAvLyBSZWloZW5mb2xnZSB2b24gcGx1Z2luLnNldHRpbmdzLnR5cGVzIHNlbGJzdCBhbHMgU3BlaWNoZXJvcnQgLSBzaWVoZVxyXG4gIC8vIHJlbmRlcigpIHVuZCByZW5kZXJSZWdpc3RlcmVkSXRlbSgpIGZcdTAwRkNyIGRhcyBwZXIgRHJhZyAmIERyb3AgdmVyc2NoaWViYmFyZVxyXG4gIC8vIFJlbmRlcm4sIGRhcyBnZW5hdSBkYXJhdWYgYXVmYmF1dC4gQmV3dXNzdCBhbHMgZXJzdGUgT3B0aW9uIChzaWVoZVxyXG4gIC8vIHNob3dTb3J0TWVudSkgLSBlaWdlbmUsIG9iZXJzdGUgR3J1cHBlIGltIE1lblx1MDBGQyBzdGF0dCBlaW5zb3J0aWVydCB6d2lzY2hlblxyXG4gIC8vIGRpZSBlaWdlbnRsaWNoZW4gU29ydGllcmtyaXRlcmllbi5cclxuICB7IG1vZGU6IFwibWFudWFsXCIsIHRpdGxlOiBcIk1hbnVlbGwgKERyYWcgJiBEcm9wKVwiIH0sXHJcbiAgeyBtb2RlOiBcImNvdW50LWRlc2NcIiwgdGl0bGU6IFwiSFx1MDBFNHVmaWdrZWl0IChhYnN0ZWlnZW5kKVwiIH0sXHJcbiAgeyBtb2RlOiBcImNvdW50LWFzY1wiLCB0aXRsZTogXCJIXHUwMEU0dWZpZ2tlaXQgKGF1ZnN0ZWlnZW5kKVwiIH0sXHJcbiAgeyBtb2RlOiBcIm5hbWUtYXNjXCIsIHRpdGxlOiBcIk5hbWUgKEEgYmlzIFopXCIgfSxcclxuICB7IG1vZGU6IFwibmFtZS1kZXNjXCIsIHRpdGxlOiBcIk5hbWUgKFogYmlzIEEpXCIgfSxcclxuICB7IG1vZGU6IFwiY29sb3ItYXNjXCIsIHRpdGxlOiBcIkZhcmJlIChSb3QgXHUyMTkyIFZpb2xldHQpXCIgfSxcclxuICB7IG1vZGU6IFwiY29sb3ItZGVzY1wiLCB0aXRsZTogXCJGYXJiZSAoVmlvbGV0dCBcdTIxOTIgUm90KVwiIH0sXHJcbl07XHJcblxyXG4vLyBTY2hyZWlidCBkZW4gVFlQLVdlcnQgYWxsZXIgTm90aXplbiBtaXQgZGVtIFNjaGxcdTAwRkNzc2VsIG9sZEtleSAoc2llaGVcclxuLy8gdHlwZUtleU9mIGluIHR5cC1pbmRleC5qcyAtIGZcdTAwRkNyIGVpbmVuIHNhdWJlcmVuIFdlcnQgZGVyIFRZUC1OYW1lIHNlbGJzdCxcclxuLy8gc29uc3QgZGllIFJvaGZvcm0sIHouIEIuIFwiIGJ1Y2hcIiBvZGVyIFwiW1BFUlNPTiwgQlVDSF1cIikgYXVmIGRlbiBFaW56ZWx3ZXJ0XHJcbi8vIG5ld1ZhbHVlIHVtLiBHZW51dHp0IGZcdTAwRkNyIHJlZ2lzdGVyVHlwZSgpIChCZXJlaW5pZ2VuKSwgVW1iZW5lbm5lbiB1bmRcclxuLy8gWnVzYW1tZW5sZWdlbi4gRGVyIEFiZ2xlaWNoIGVyZm9sZ3QgZXhha3QgXHUwMEZDYmVyIGRlbiBTY2hsXHUwMEZDc3NlbCwgZWluZSBMaXN0ZVxyXG4vLyB3aXJkIGRhYmVpIGFsc28gYWxzIEdhbnplcyBlcnNldHp0IHN0YXR0IG51ciBlaW5lciBpaHJlciBFaW50clx1MDBFNGdlLiBFaW5cclxuLy8gYWJ3ZWljaGVuZCBnZXNjaHJpZWJlbmVyIFByb3BlcnR5LU5hbWUgKFwidHlwXCIpIHdpcmQgZGFiZWkgenUgXCJUWVBcIi5cclxuYXN5bmMgZnVuY3Rpb24gcmVuYW1lVHlwZUluTm90ZXMocGx1Z2luLCBvbGRLZXksIG5ld1ZhbHVlKSB7XHJcbiAgbGV0IGNoYW5nZWQgPSAwO1xyXG4gIGZvciAoY29uc3QgZmlsZSBvZiBwbHVnaW4udHlwSW5kZXguZmlsZXNXaXRoVHlwZShvbGRLZXkpKSB7XHJcbiAgICBsZXQgbWF0Y2hlZCA9IGZhbHNlO1xyXG4gICAgYXdhaXQgcGx1Z2luLmFwcC5maWxlTWFuYWdlci5wcm9jZXNzRnJvbnRNYXR0ZXIoZmlsZSwgKGZyb250bWF0dGVyKSA9PiB7XHJcbiAgICAgIGlmICh0eXBlS2V5T2YocHJvcGVydHlWYWx1ZShmcm9udG1hdHRlciwgVFlQX1BST1BFUlRZKSkgIT09IG9sZEtleSkgcmV0dXJuO1xyXG4gICAgICBzZXRDYW5vbmljYWxQcm9wZXJ0eShmcm9udG1hdHRlciwgVFlQX1BST1BFUlRZLCBuZXdWYWx1ZSk7XHJcbiAgICAgIG1hdGNoZWQgPSB0cnVlO1xyXG4gICAgfSk7XHJcbiAgICBpZiAobWF0Y2hlZCkgY2hhbmdlZCsrO1xyXG4gIH1cclxuICByZXR1cm4gY2hhbmdlZDtcclxufVxyXG5cclxuLy8gQmVyZWluaWd0ZSBGb3JtIGVpbmVzIFJvaHdlcnRzIGZcdTAwRkNyIHJlZ2lzdGVyVHlwZSgpOiBFaW56ZWx3ZXJ0IGdldHJpbW10IHVuZFxyXG4vLyBncm9cdTAwREYgZ2VzY2hyaWViZW47IGVpbmUgTGlzdGUgd2lyZCBiZXd1c3N0IE5JQ0hUIGF1ZiBlaW5lbiBpaHJlciBFaW50clx1MDBFNGdlXHJcbi8vIHJlZHV6aWVydCwgc29uZGVybiBhbHMgR2FuemVzIHp1IGVpbmVtIEVpbnplbHdlcnQgXCJBLCBCXCIgKFJvaGZvcm0pIC0gZGFyYXVzXHJcbi8vIGxcdTAwRTRzc3Qgc2ljaCBkZXIgVFlQIGRhbmFjaCBwZXIgVW1iZW5lbm5lbiBnZXppZWx0IGluIGVpbmVuIGFuZGVyZW4gXHUwMEZDYmVyZlx1MDBGQ2hyZW5cclxuLy8gKHNpZWhlIHN0YXJ0RGV0YWlsUmVuYW1lL3Nob3dNZXJnZUNvbmZpcm0pLiBub3JtYWxpemU6IFNjaHJlaWJ3ZWlzZSBkZXJcclxuLy8gZWluemVsbmVuIE5hbWVuIC0gZlx1MDBGQ3IgU3VidHlwZW4gbm9ybWFsaXplU3VidHlwZU5hbWUgKHNpZWhlIHN1YnR5cGVzLmpzKS5cclxuZnVuY3Rpb24gbm9ybWFsaXplUmF3VHlwZShyYXcsIG5vcm1hbGl6ZSA9IG5vcm1hbGl6ZVR5cGVOYW1lKSB7XHJcbiAgaWYgKEFycmF5LmlzQXJyYXkocmF3KSkge1xyXG4gICAgcmV0dXJuIHJhd1xyXG4gICAgICAubWFwKCh2KSA9PiBub3JtYWxpemUoU3RyaW5nKHYgPz8gXCJcIikpKVxyXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pXHJcbiAgICAgIC5qb2luKFwiLCBcIik7XHJcbiAgfVxyXG4gIHJldHVybiBub3JtYWxpemUoU3RyaW5nKHJhdykpO1xyXG59XHJcblxyXG4vLyBBbnplaWdlIGVpbmVzIHVucmVnaXN0cmllcnRlbiBTY2hsXHUwMEZDc3NlbHM6IFJhbmRsZWVyemVpY2hlbiB3XHUwMEU0cmVuIGFscyByZWluZXJcclxuLy8gVGV4dCB1bnNpY2h0YmFyLCBkYWhlciBkYW5uIGluIEFuZlx1MDBGQ2hydW5nc3plaWNoZW4uIExpc3RlbiB0cmFnZW4gaWhyZVxyXG4vLyBlY2tpZ2VuIEtsYW1tZXJuIHNjaG9uIGltIFNjaGxcdTAwRkNzc2VsLlxyXG5mdW5jdGlvbiBkaXNwbGF5VHlwZUtleSh0eXBlS2V5KSB7XHJcbiAgcmV0dXJuIHR5cGVLZXkgIT09IHR5cGVLZXkudHJpbSgpID8gYFwiJHt0eXBlS2V5fVwiYCA6IHR5cGVLZXk7XHJcbn1cclxuXHJcbi8vIFRZUC1OYW1lIGluIEZsaWVcdTAwREZ0ZXh0IChCZXN0XHUwMEU0dGlndW5ncy1Nb2RhbGUpOiBlaW5nZWZcdTAwRTRyYnRlciBOYW1lLCB3ZW5uIFwiVFlQXHJcbi8vIFZpZXcgZWluZlx1MDBFNHJiZW5cIiBha3RpdiBpc3QgKGNvbG9yVmlld3MudHlwTGlzdCksIHNvbnN0IGVpbiBGYXJicHVua3QgZGF2b3JcclxuLy8gcGx1cyBub3JtYWxlciBUZXh0IC0gZGllc2VsYmUgVW1zY2hhbHR1bmcgd2llIGltIFRZUC1QaWNrZXIgKHNpZWhlXHJcbi8vIHJlbmRlclN1Z2dlc3Rpb24gaW4gdHlwZS1waWNrZXIuanMpIHVuZCBpbiBkZXIgVFlQLUxpc3RlIHNlbGJzdC4gY29sb3Igd2lyZFxyXG4vLyB2b20gQXVmcnVmZXIgXHUwMEZDYmVyZ2ViZW4gc3RhdHQgaGllciBuYWNoZ2VzY2hsYWdlbiwgZGFtaXQgei4gQi4gYmVpIGVpbmVyXHJcbi8vIFVtYmVuZW5udW5nIGJld3Vzc3QgZlx1MDBGQ3IgYWx0IFVORCBuZXUgZGllc2VsYmUgKGRpZSBkZXMgYWx0ZW4gTmFtZW5zLCBkaWUgbmFjaFxyXG4vLyBkZW0gVW1iZW5lbm5lbiBlcmhhbHRlbiBibGVpYnQpIEZhcmJlIHZlcndlbmRldCB3ZXJkZW4ga2Fubi4gY29sb3IgbnVsbCA9XHJcbi8vIFRZUCBvaG5lIGVpZ2VuZSBGYXJiZSAoTmFtZSB1bmdlZlx1MDBFNHJidCBiencuIFB1bmt0IGFscyBob2hsZXIgZ3JhdWVyIFJpbmcpLlxyXG5mdW5jdGlvbiBhcHBlbmRUeXBlTmFtZShwYXJlbnRFbCwgcGx1Z2luLCB0eXBlLCBjb2xvcikge1xyXG4gIGlmIChwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0KSB7XHJcbiAgICBjb25zdCBuYW1lRWwgPSBwYXJlbnRFbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLWlubGluZS1uYW1lXCIsIHRleHQ6IHR5cGUgfSk7XHJcbiAgICBpZiAoY29sb3IpIG5hbWVFbC5zdHlsZS5jb2xvciA9IGNvbG9yO1xyXG4gIH0gZWxzZSB7XHJcbiAgICBwYWludENvbG9yRG90KHBhcmVudEVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtaW5saW5lLWRvdFwiIH0pLCBjb2xvciA/PyBERUZBVUxUX1RZUEVfQ09MT1IsICFjb2xvcik7XHJcbiAgICBwYXJlbnRFbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLWlubGluZS1uYW1lXCIsIHRleHQ6IHR5cGUgfSk7XHJcbiAgfVxyXG59XHJcblxyXG5jbGFzcyBDb25maXJtRGVsZXRlVHlwZU1vZGFsIGV4dGVuZHMgTW9kYWwge1xyXG4gIGNvbnN0cnVjdG9yKHBsdWdpbiwgdHlwZSwgb25Db25maXJtKSB7XHJcbiAgICBzdXBlcihwbHVnaW4uYXBwKTtcclxuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xyXG4gICAgdGhpcy50eXBlID0gdHlwZTtcclxuICAgIHRoaXMub25Db25maXJtID0gb25Db25maXJtO1xyXG4gIH1cclxuXHJcbiAgb25PcGVuKCkge1xyXG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XHJcbiAgICB0aGlzLm1vZGFsRWwuYWRkQ2xhc3MoXCJmcmVkLWNvbmZpcm0tZGVsZXRlLW1vZGFsXCIpO1xyXG4gICAgY29uc3QgcCA9IGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIik7XHJcbiAgICBwLmFwcGVuZFRleHQoXCJUeXAgXCIpO1xyXG4gICAgYXBwZW5kVHlwZU5hbWUocCwgdGhpcy5wbHVnaW4sIHRoaXMudHlwZSwgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0aGlzLnR5cGVdID8/IG51bGwpO1xyXG4gICAgcC5hcHBlbmRUZXh0KFwiIHdpcmtsaWNoIGxcdTAwRjZzY2hlbj9cIik7XHJcblxyXG4gICAgY29uc3QgYnV0dG9uUm93ID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJtb2RhbC1idXR0b24tY29udGFpbmVyXCIgfSk7XHJcbiAgICBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkFiYnJlY2hlblwiIH0pLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xyXG5cclxuICAgIGNvbnN0IGNvbmZpcm1CdG4gPSBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IFwibW9kLXdhcm5pbmdcIiwgdGV4dDogXCJMXHUwMEY2c2NoZW5cIiB9KTtcclxuICAgIGNvbmZpcm1CdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgdGhpcy5jbG9zZSgpO1xyXG4gICAgICB0aGlzLm9uQ29uZmlybSgpO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBvbkNsb3NlKCkge1xyXG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcclxuICB9XHJcbn1cclxuXHJcbi8vIFZvciBkZW0gXCJVbWJlbmVubmVuIChpbmtsLiBOb3RpemVuIGFucGFzc2VuKVwiLUJ1dHRvbiAoc2llaGUgcmVuZGVyVHlwZVNldHRpbmdzXHJcbi8vIHVuZCBzdGFydERldGFpbFJlbmFtZSkgLSBpbSBHZWdlbnNhdHogenVyIG5vcm1hbGVuIFVtYmVuZW5udW5nLCBkaWUgbnVyIGRpZVxyXG4vLyBQbHVnaW4tRWluc3RlbGx1bmdlbiBcdTAwRTRuZGVydCwgc2NocmVpYnQgZGllc2UgVmFyaWFudGUgenVzXHUwMEU0dHpsaWNoIGRlbiBUWVAtV2VydFxyXG4vLyBhbGxlciBiZXRyb2ZmZW5lbiBOb3RpemVuIHVtLiBEYXMgaXN0IGVpbiBCdWxrLVNjaHJlaWJ2b3JnYW5nIFx1MDBGQ2JlclxyXG4vLyBwb3RlbnppZWxsIHZpZWxlIERhdGVpZW4sIGRhaGVyIGhpZXIgZWluZSBleHBsaXppdGUgQmVzdFx1MDBFNHRpZ3VuZyBkYXZvci5cclxuY2xhc3MgQ29uZmlybVJlbmFtZVR5cGVNb2RhbCBleHRlbmRzIE1vZGFsIHtcclxuICBjb25zdHJ1Y3RvcihwbHVnaW4sIG9sZFR5cGUsIG5ld1R5cGUsIGFmZmVjdGVkQ291bnQsIG9uQ29uZmlybSwgb25DYW5jZWwpIHtcclxuICAgIHN1cGVyKHBsdWdpbi5hcHApO1xyXG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XHJcbiAgICB0aGlzLm9sZFR5cGUgPSBvbGRUeXBlO1xyXG4gICAgdGhpcy5uZXdUeXBlID0gbmV3VHlwZTtcclxuICAgIHRoaXMuYWZmZWN0ZWRDb3VudCA9IGFmZmVjdGVkQ291bnQ7XHJcbiAgICB0aGlzLm9uQ29uZmlybSA9IG9uQ29uZmlybTtcclxuICAgIHRoaXMub25DYW5jZWwgPSBvbkNhbmNlbDtcclxuICAgIHRoaXMuY29uZmlybWVkID0gZmFsc2U7XHJcbiAgfVxyXG5cclxuICBvbk9wZW4oKSB7XHJcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcclxuICAgIHRoaXMubW9kYWxFbC5hZGRDbGFzcyhcImZyZWQtY29uZmlybS1kZWxldGUtbW9kYWxcIik7XHJcbiAgICAvLyBEaWVzZWxiZSBGYXJiZSBmXHUwMEZDciBhbHQgdW5kIG5ldSAoZGllIGRlcyBhbHRlbiBOYW1lbnMpIC0gZGVyIG5ldWUgTmFtZVxyXG4gICAgLy8gaGF0IHZvciBkZW0gZWlnZW50bGljaGVuIFVtYmVuZW5uZW4gbm9jaCBrZWluZW4gZWlnZW5lbiBFaW50cmFnIGluXHJcbiAgICAvLyB0eXBlQ29sb3JzLCBcdTAwRkNiZXJuaW1tdCBhYmVyIGRpZSBGYXJiZSBkZXMgYWx0ZW4gKHNpZWhlIGFwcGx5UmVuYW1lKS5cclxuICAgIGNvbnN0IGNvbG9yID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0aGlzLm9sZFR5cGVdID8/IG51bGw7XHJcbiAgICBjb25zdCBwID0gY29udGVudEVsLmNyZWF0ZUVsKFwicFwiKTtcclxuICAgIHAuYXBwZW5kVGV4dChcIlRZUCBcIik7XHJcbiAgICBhcHBlbmRUeXBlTmFtZShwLCB0aGlzLnBsdWdpbiwgdGhpcy5vbGRUeXBlLCBjb2xvcik7XHJcbiAgICBwLmFwcGVuZFRleHQoXCIgaW4gXCIpO1xyXG4gICAgYXBwZW5kVHlwZU5hbWUocCwgdGhpcy5wbHVnaW4sIHRoaXMubmV3VHlwZSwgY29sb3IpO1xyXG4gICAgcC5hcHBlbmRUZXh0KGAgdW1iZW5lbm5lbiB1bmQgJHt0aGlzLmFmZmVjdGVkQ291bnR9IE5vdGl6KGVuKSBlbnRzcHJlY2hlbmQgYW5wYXNzZW4/YCk7XHJcblxyXG4gICAgY29uc3QgYnV0dG9uUm93ID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJtb2RhbC1idXR0b24tY29udGFpbmVyXCIgfSk7XHJcbiAgICBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkFiYnJlY2hlblwiIH0pLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xyXG5cclxuICAgIGNvbnN0IGNvbmZpcm1CdG4gPSBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IFwibW9kLWN0YVwiLCB0ZXh0OiBcIlVtYmVuZW5uZW5cIiB9KTtcclxuICAgIGNvbmZpcm1CdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgdGhpcy5jb25maXJtZWQgPSB0cnVlO1xyXG4gICAgICB0aGlzLmNsb3NlKCk7XHJcbiAgICAgIHRoaXMub25Db25maXJtKCk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIC8vIERlY2t0IHNvd29obCBcIkFiYnJlY2hlblwiLUtsaWNrIGFscyBhdWNoIEVzY2FwZS9LbGljayBkYW5lYmVuIGFiIC0gYW5hbG9nXHJcbiAgLy8genVtIENhbmNlbC1IYW5kbGluZyBpbiBUeXBQaWNrZXJNb2RhbC5cclxuICBvbkNsb3NlKCkge1xyXG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcclxuICAgIGlmICghdGhpcy5jb25maXJtZWQpIHRoaXMub25DYW5jZWw/LigpO1xyXG4gIH1cclxufVxyXG5cclxuLy8gVW1iZW5lbm5lbiBhdWYgZGVuIE5hbWVuIGVpbmVzIGJlcmVpdHMgcmVnaXN0cmllcnRlbiBUWVBzIChzaWVoZVxyXG4vLyBzdGFydERldGFpbFJlbmFtZSkgLSBzdGF0dCBkaWUgVW1iZW5lbm51bmcgc3RpbGxzY2h3ZWlnZW5kIHp1IHZlcndlcmZlbixcclxuLy8gYW5iaWV0ZW4sIGJlaWRlIHp1c2FtbWVuenVsZWdlbiAoc2llaGUgbWVyZ2VUeXBlKS4gU2NocmVpYnQgaW1tZXIgYXVjaCBkaWVcclxuLy8gTm90aXplbiB1bSwgdW5hYmhcdTAwRTRuZ2lnIGRhdm9uLCBcdTAwRkNiZXIgd2VsY2hlbiBkZXIgYmVpZGVuIFVtYmVuZW5uZW4tQnV0dG9ucyBlc1xyXG4vLyBhdXNnZWxcdTAwRjZzdCB3dXJkZTogZWluIFp1c2FtbWVubGVnZW4gbnVyIGluIGRlbiBFaW5zdGVsbHVuZ2VuIGxpZVx1MDBERmUgZGllXHJcbi8vIE5vdGl6ZW4gZGVzIFF1ZWxsLVRZUHMgYWxzIHVucmVnaXN0cmllcnRlbiBFaW50cmFnIHp1clx1MDBGQ2NrLlxyXG5jbGFzcyBDb25maXJtTWVyZ2VUeXBlTW9kYWwgZXh0ZW5kcyBDb25maXJtUmVuYW1lVHlwZU1vZGFsIHtcclxuICBvbk9wZW4oKSB7XHJcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcclxuICAgIHRoaXMubW9kYWxFbC5hZGRDbGFzcyhcImZyZWQtY29uZmlybS1kZWxldGUtbW9kYWxcIik7XHJcbiAgICBjb25zdCBzZXR0aW5ncyA9IHRoaXMucGx1Z2luLnNldHRpbmdzO1xyXG4gICAgY29uc3QgcCA9IGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIik7XHJcbiAgICBwLmFwcGVuZFRleHQoXCJUWVAgXCIpO1xyXG4gICAgYXBwZW5kVHlwZU5hbWUocCwgdGhpcy5wbHVnaW4sIHRoaXMubmV3VHlwZSwgc2V0dGluZ3MudHlwZUNvbG9yc1t0aGlzLm5ld1R5cGVdID8/IG51bGwpO1xyXG4gICAgcC5hcHBlbmRUZXh0KFwiIGV4aXN0aWVydCBiZXJlaXRzLiBcIik7XHJcbiAgICBhcHBlbmRUeXBlTmFtZShwLCB0aGlzLnBsdWdpbiwgdGhpcy5vbGRUeXBlLCBzZXR0aW5ncy50eXBlQ29sb3JzW3RoaXMub2xkVHlwZV0gPz8gbnVsbCk7XHJcbiAgICBwLmFwcGVuZFRleHQoXCIgZGFtaXQgenVzYW1tZW5sZWdlbj9cIik7XHJcblxyXG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwicFwiLCB7XHJcbiAgICAgIHRleHQ6XHJcbiAgICAgICAgYCR7dGhpcy5hZmZlY3RlZENvdW50fSBOb3Rpeihlbikgd2VyZGVuIGF1ZiAke3RoaXMubmV3VHlwZX0gdW1nZXN0ZWxsdC4gYCArXHJcbiAgICAgICAgYEZhcmJlLCBCZXNjaHJlaWJ1bmcgdW5kIFRZUC1Gcm9udG1hdHRlciB2b24gJHt0aGlzLm9sZFR5cGV9IGVudGZhbGxlbiwgYCArXHJcbiAgICAgICAgYHNlaW5lIFN1YnR5cGVuIHdlcmRlbiBcdTAwRkNiZXJub21tZW4gKGdsZWljaG5hbWlnZSBTdWJ0eXAtQmxcdTAwRjZja2UgenVzYW1tZW5nZWZcdTAwRkNocnQpLmAsXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBidXR0b25Sb3cgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcIm1vZGFsLWJ1dHRvbi1jb250YWluZXJcIiB9KTtcclxuICAgIGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiQWJicmVjaGVuXCIgfSkuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY2xvc2UoKSk7XHJcblxyXG4gICAgY29uc3QgY29uZmlybUJ0biA9IGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IGNsczogXCJtb2Qtd2FybmluZ1wiLCB0ZXh0OiBcIlp1c2FtbWVubGVnZW5cIiB9KTtcclxuICAgIGNvbmZpcm1CdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgdGhpcy5jb25maXJtZWQgPSB0cnVlO1xyXG4gICAgICB0aGlzLmNsb3NlKCk7XHJcbiAgICAgIHRoaXMub25Db25maXJtKCk7XHJcbiAgICB9KTtcclxuICB9XHJcbn1cclxuXHJcbi8vIEJlc3RcdTAwRTR0aWd1bmdlbiBydW5kIHVtIFN1YnR5cGVuIChzaWVoZSByZW5kZXJTZWN0aW9uRm9vdGVyKTogc2NobGljaHRlciBUZXh0XHJcbi8vIHN0YXR0IGVpbmdlZlx1MDBFNHJidGVyIFRZUC1OYW1lbiwgc29uc3Qgd2llIGRpZSBUWVAtTW9kYWxlIG9iZW4uIG9uQ2FuY2VsIGdyZWlmdFxyXG4vLyB3aWUgZG9ydCBhdWNoIGJlaSBFc2NhcGUvS2xpY2sgZGFuZWJlbi5cclxuY2xhc3MgQ29uZmlybVN1YnR5cGVNb2RhbCBleHRlbmRzIE1vZGFsIHtcclxuICBjb25zdHJ1Y3RvcihhcHAsIHsgcGFyYWdyYXBocywgY29uZmlybVRleHQsIGNvbmZpcm1DbHMsIG9uQ29uZmlybSwgb25DYW5jZWwgfSkge1xyXG4gICAgc3VwZXIoYXBwKTtcclxuICAgIHRoaXMucGFyYWdyYXBocyA9IHBhcmFncmFwaHM7XHJcbiAgICB0aGlzLmNvbmZpcm1UZXh0ID0gY29uZmlybVRleHQ7XHJcbiAgICB0aGlzLmNvbmZpcm1DbHMgPSBjb25maXJtQ2xzO1xyXG4gICAgdGhpcy5vbkNvbmZpcm0gPSBvbkNvbmZpcm07XHJcbiAgICB0aGlzLm9uQ2FuY2VsID0gb25DYW5jZWw7XHJcbiAgICB0aGlzLmNvbmZpcm1lZCA9IGZhbHNlO1xyXG4gIH1cclxuXHJcbiAgb25PcGVuKCkge1xyXG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XHJcbiAgICB0aGlzLm1vZGFsRWwuYWRkQ2xhc3MoXCJmcmVkLWNvbmZpcm0tZGVsZXRlLW1vZGFsXCIpO1xyXG4gICAgZm9yIChjb25zdCB0ZXh0IG9mIHRoaXMucGFyYWdyYXBocykgY29udGVudEVsLmNyZWF0ZUVsKFwicFwiLCB7IHRleHQgfSk7XHJcblxyXG4gICAgY29uc3QgYnV0dG9uUm93ID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJtb2RhbC1idXR0b24tY29udGFpbmVyXCIgfSk7XHJcbiAgICBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkFiYnJlY2hlblwiIH0pLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xyXG5cclxuICAgIGNvbnN0IGNvbmZpcm1CdG4gPSBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IHRoaXMuY29uZmlybUNscywgdGV4dDogdGhpcy5jb25maXJtVGV4dCB9KTtcclxuICAgIGNvbmZpcm1CdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgdGhpcy5jb25maXJtZWQgPSB0cnVlO1xyXG4gICAgICB0aGlzLmNsb3NlKCk7XHJcbiAgICAgIHRoaXMub25Db25maXJtKCk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIG9uQ2xvc2UoKSB7XHJcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xyXG4gICAgaWYgKCF0aGlzLmNvbmZpcm1lZCkgdGhpcy5vbkNhbmNlbD8uKCk7XHJcbiAgfVxyXG59XHJcblxyXG5jbGFzcyBUeXBWaWV3IGV4dGVuZHMgSXRlbVZpZXcge1xyXG4gIGNvbnN0cnVjdG9yKGxlYWYsIHBsdWdpbikge1xyXG4gICAgc3VwZXIobGVhZik7XHJcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcclxuICB9XHJcblxyXG4gIGdldFZpZXdUeXBlKCkge1xyXG4gICAgcmV0dXJuIFZJRVdfVFlQRV9UWVA7XHJcbiAgfVxyXG5cclxuICBnZXREaXNwbGF5VGV4dCgpIHtcclxuICAgIHJldHVybiBcIlRZUFwiO1xyXG4gIH1cclxuXHJcbiAgZ2V0SWNvbigpIHtcclxuICAgIHJldHVybiBcInNoYXBlc1wiO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgb25PcGVuKCkge1xyXG4gICAgdGhpcy5pc0VkaXRpbmcgPSBmYWxzZTtcclxuICAgIHRoaXMuc2VsZWN0ZWRUeXBlID0gbnVsbDtcclxuICAgIHRoaXMuZnJvbnRtYXR0ZXJCbG9ja3MgPSBudWxsO1xyXG4gICAgdGhpcy5mcm9udG1hdHRlckVkaXRvcnMgPSBbXTtcclxuXHJcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xyXG4gICAgdGhpcy5jb250ZW50RWwuYWRkQ2xhc3MoXCJmcmVkLXR5cC12aWV3XCIpO1xyXG5cclxuICAgIHRoaXMucmVnaXN0ZXJEb21FdmVudCh0aGlzLmNvbnRlbnRFbCwgXCJrZXlkb3duXCIsIChldmVudCkgPT4ge1xyXG4gICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVzY2FwZVwiICYmIHRoaXMuc2VsZWN0ZWRUeXBlICE9PSBudWxsKSB0aGlzLmNsb3NlVHlwZVNldHRpbmdzKCk7XHJcbiAgICB9KTtcclxuICAgIHRoaXMucmVuZGVyKCk7XHJcbiAgfVxyXG5cclxuICBhc3luYyBvbkNsb3NlKCkge1xyXG4gICAgdGhpcy5jbG9zZVN1YnR5cGVDb2xvclBvcG92ZXI/LigpO1xyXG4gIH1cclxuXHJcbiAgb3BlblNlYXJjaCh0eXBlKSB7XHJcbiAgICBjb25zdCBnbG9iYWxTZWFyY2ggPSB0aGlzLnBsdWdpbi5hcHAuaW50ZXJuYWxQbHVnaW5zLmdldFBsdWdpbkJ5SWQoXCJnbG9iYWwtc2VhcmNoXCIpO1xyXG4gICAgaWYgKCFnbG9iYWxTZWFyY2gpIHJldHVybjtcclxuICAgIC8vIFwia2VpbiBUeXBcIiB0clx1MDBFNGZlIG9obmUgRmlsdGVyIGF1Y2ggYWxsZSBOaWNodC1NYXJrZG93bi1EYXRlaWVuIChkaWUgbmF0dXJnZW1cdTAwRTRcdTAwREZcclxuICAgIC8vIG5pZSBlaW5lIEZyb250bWF0dGVyLVByb3BlcnR5IGhhYmVuIGtcdTAwRjZubmVuKSAtIGRhaGVyIGV4cGxpeml0IGF1ZiAubWQgZWluZ3Jlbnplbi5cclxuICAgIC8vIEZcdTAwRkNyIGVpbmUgTGlzdGUgKHVucmVnaXN0cmllcnRlciBTY2hsXHUwMEZDc3NlbCBcIltBLCBCXVwiKSBnaWJ0IGVzIGtlaW5lIGV4YWt0ZVxyXG4gICAgLy8gU3VjaHN5bnRheCAtIGRhbm4gbmFjaCBOb3RpemVuIHN1Y2hlbiwgZGllIGFsbGUgaWhyZSBFaW50clx1MDBFNGdlIHRyYWdlbi5cclxuICAgIGNvbnN0IHJhdyA9IHR5cGUgPT09IG51bGwgPyB1bmRlZmluZWQgOiB0aGlzLnBsdWdpbi50eXBJbmRleC5yYXdWYWx1ZU9mKHR5cGUpO1xyXG4gICAgY29uc3QgcXVlcnkgPVxyXG4gICAgICB0eXBlID09PSBudWxsXHJcbiAgICAgICAgPyBgLVtcIiR7VFlQX1BST1BFUlRZfVwiXSBmaWxlOi5tZGBcclxuICAgICAgICA6IEFycmF5LmlzQXJyYXkocmF3KVxyXG4gICAgICAgICAgPyByYXcubWFwKCh2KSA9PiBgW1wiJHtUWVBfUFJPUEVSVFl9XCI6XCIke1N0cmluZyh2ID8/IFwiXCIpLnRyaW0oKX1cIl1gKS5qb2luKFwiIFwiKVxyXG4gICAgICAgICAgOiBgW1wiJHtUWVBfUFJPUEVSVFl9XCI6XCIke3R5cGV9XCJdYDtcclxuICAgIGdsb2JhbFNlYXJjaC5pbnN0YW5jZS5vcGVuR2xvYmFsU2VhcmNoKHF1ZXJ5KTtcclxuICB9XHJcblxyXG4gIC8vIHR5cGVLZXkga29tbXQgMToxIGF1cyBkZW4gdGF0c1x1MDBFNGNobGljaGVuIEZyb250bWF0dGVyLVdlcnRlbiAoc2llaGVcclxuICAvLyB1bnJlZ2lzdGVyZWRSb3dzIGluIHJlbmRlcigpIHVuZCB0eXBlS2V5T2YgaW4gdHlwLWluZGV4LmpzKSAtIGthbm4gYWxzb1xyXG4gIC8vIGtsZWluIGdlc2NocmllYmVuIHNlaW4sIFJhbmRsZWVyemVpY2hlbiB0cmFnZW4gb2RlciBlaW5lIExpc3RlIHNlaW4uIFRZUGVuXHJcbiAgLy8gd2VyZGVuIGFiZXIgaW1tZXIgYWxzIHNhdWJlcmVyIEVpbnplbHdlcnQgaW4gR3JvXHUwMERGYnVjaHN0YWJlbiBnZWZcdTAwRkNocnQgLVxyXG4gIC8vIHJlZ2lzdHJpZXJ0IHdpcmQgZGVzaGFsYiBkaWUgYmVyZWluaWd0ZSBGb3JtIChzaWVoZSBub3JtYWxpemVSYXdUeXBlKSwgdW5kXHJcbiAgLy8gZGllIGJldHJvZmZlbmVuIE5vdGl6ZW4gd2VyZGVuIGdsZWljaCBtaXQgdW1nZXNjaHJpZWJlbiwgZGFtaXQgc2llIG5pY2h0XHJcbiAgLy8gd2VpdGVyaGluIGFscyBcIm5pY2h0IHJlZ2lzdHJpZXJ0XCIgYXVmdGF1Y2hlbi5cclxuICBhc3luYyByZWdpc3RlclR5cGUodHlwZUtleSkge1xyXG4gICAgY29uc3QgcmF3ID0gdGhpcy5wbHVnaW4udHlwSW5kZXgucmF3VmFsdWVPZih0eXBlS2V5KTtcclxuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVSYXdUeXBlKHJhdyA9PT0gdW5kZWZpbmVkID8gdHlwZUtleSA6IHJhdyk7XHJcbiAgICBpZiAoIW5vcm1hbGl6ZWQpIHJldHVybjtcclxuICAgIGlmICghdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXMuaW5jbHVkZXMobm9ybWFsaXplZCkpIHtcclxuICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXMucHVzaChub3JtYWxpemVkKTtcclxuICAgIH1cclxuXHJcbiAgICBsZXQgcmVuYW1lZCA9IDA7XHJcbiAgICBpZiAobm9ybWFsaXplZCAhPT0gdHlwZUtleSkge1xyXG4gICAgICByZW5hbWVkID0gYXdhaXQgcmVuYW1lVHlwZUluTm90ZXModGhpcy5wbHVnaW4sIHR5cGVLZXksIG5vcm1hbGl6ZWQpO1xyXG4gICAgfVxyXG5cclxuICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgdGhpcy5yZW5kZXIoKTtcclxuICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG5cclxuICAgIGlmIChyZW5hbWVkID4gMCkge1xyXG4gICAgICBuZXcgTm90aWNlKGBUWVAgJHtub3JtYWxpemVkfSByZWdpc3RyaWVydCwgJHtyZW5hbWVkfSBOb3RpeihlbikgYW5nZXBhc3N0LmApO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLy8gTmV1ZXMsIGxlZXJlcyBUcmVlLUl0ZW0gYW5sZWdlbiB1bmQgc29mb3J0IGluIGRlbiBFZGl0aWVyLU1vZHVzIHZlcnNldHplbiAtXHJcbiAgLy8gd2llIGJlaSBPYnNpZGlhbnMgZWlnZW5lbiBWaWV3cyAoei4gQi4gbmV1ZSBCb29rbWFyay1HcnVwcGUpLlxyXG4gIHN0YXJ0QWRkKCkge1xyXG4gICAgaWYgKHRoaXMuaXNFZGl0aW5nKSByZXR1cm47XHJcblxyXG4gICAgY29uc3QgdHJlZUl0ZW0gPSB0aGlzLmxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtXCIgfSk7XHJcbiAgICBpZiAodGhpcy5zZXBhcmF0b3JFbCkgdGhpcy5saXN0RWwuaW5zZXJ0QmVmb3JlKHRyZWVJdGVtLCB0aGlzLnNlcGFyYXRvckVsKTtcclxuICAgIGNvbnN0IHNlbGYgPSB0cmVlSXRlbS5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLXNlbGYgaXMtY2xpY2thYmxlXCIgfSk7XHJcbiAgICBjb25zdCBpbm5lciA9IHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1pbm5lclwiIH0pO1xyXG5cclxuICAgIHRoaXMuc3RhcnRFZGl0aW5nKG51bGwsIHNlbGYsIGlubmVyKTtcclxuICB9XHJcblxyXG4gIC8vIFdpZSBPYnNpZGlhbnMgZWlnZW5lIFRyZWUtSXRlbXM6IGtlaW4genVzXHUwMEU0dHpsaWNoZXMgSW5wdXQtRWxlbWVudCwgc29uZGVyblxyXG4gIC8vIGRhcyBiZXN0ZWhlbmRlIFRleHQtRWxlbWVudCB3aXJkIHNlbGJzdCBlZGl0aWVyYmFyIChjb250ZW50ZWRpdGFibGUpLlxyXG4gIC8vIHR5cGUgPT09IG51bGwgXHUyMTkyIG5ldWVyIEVpbnRyYWcsIHNvbnN0IFVtYmVuZW5uZW4gZGVzIFx1MDBGQ2JlcmdlYmVuZW4gVHlwcy5cclxuICBzdGFydEVkaXRpbmcodHlwZSwgc2VsZiwgaW5uZXIpIHtcclxuICAgIGlmICh0aGlzLmlzRWRpdGluZykgcmV0dXJuO1xyXG4gICAgdGhpcy5pc0VkaXRpbmcgPSB0cnVlO1xyXG5cclxuICAgIHNlbGYuYWRkQ2xhc3MoXCJpcy1iZWluZy1yZW5hbWVkXCIpO1xyXG4gICAgaW5uZXIuc2V0QXR0cmlidXRlKFwiY29udGVudGVkaXRhYmxlXCIsIFwidHJ1ZVwiKTtcclxuICAgIGlubmVyLnNldEF0dHJpYnV0ZShcInNwZWxsY2hlY2tcIiwgXCJmYWxzZVwiKTtcclxuICAgIGlubmVyLmZvY3VzKCk7XHJcblxyXG4gICAgY29uc3QgcmFuZ2UgPSBpbm5lci5kb2MuY3JlYXRlUmFuZ2UoKTtcclxuICAgIHJhbmdlLnNlbGVjdE5vZGVDb250ZW50cyhpbm5lcik7XHJcbiAgICBjb25zdCBzZWxlY3Rpb24gPSBpbm5lci53aW4uZ2V0U2VsZWN0aW9uKCk7XHJcbiAgICBzZWxlY3Rpb24ucmVtb3ZlQWxsUmFuZ2VzKCk7XHJcbiAgICBzZWxlY3Rpb24uYWRkUmFuZ2UocmFuZ2UpO1xyXG5cclxuICAgIGxldCBkb25lID0gZmFsc2U7XHJcbiAgICBjb25zdCBmaW5pc2ggPSBhc3luYyAoY29tbWl0KSA9PiB7XHJcbiAgICAgIGlmIChkb25lKSByZXR1cm47XHJcbiAgICAgIGRvbmUgPSB0cnVlO1xyXG4gICAgICB0aGlzLmlzRWRpdGluZyA9IGZhbHNlO1xyXG5cclxuICAgICAgY29uc3QgdmFsdWUgPSBub3JtYWxpemVUeXBlTmFtZShpbm5lci50ZXh0Q29udGVudCk7XHJcbiAgICAgIGlmIChjb21taXQgJiYgdmFsdWUgJiYgdmFsdWUgIT09IHR5cGUpIHtcclxuICAgICAgICBjb25zdCBleGlzdHMgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlcy5zb21lKFxyXG4gICAgICAgICAgKHQpID0+IHQudG9Mb3dlckNhc2UoKSA9PT0gdmFsdWUudG9Mb3dlckNhc2UoKSAmJiB0ICE9PSB0eXBlXHJcbiAgICAgICAgKTtcclxuICAgICAgICBpZiAoIWV4aXN0cykge1xyXG4gICAgICAgICAgaWYgKHR5cGUgPT09IG51bGwpIHtcclxuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXMucHVzaCh2YWx1ZSk7XHJcbiAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBjb25zdCBpZHggPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlcy5pbmRleE9mKHR5cGUpO1xyXG4gICAgICAgICAgICBpZiAoaWR4ICE9PSAtMSkgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXNbaWR4XSA9IHZhbHVlO1xyXG4gICAgICAgICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdO1xyXG4gICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3R5cGVdICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV07XHJcbiAgICAgICAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXTtcclxuICAgICAgICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdO1xyXG4gICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlU2hvcnRjdXRzW3R5cGVdICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlU2hvcnRjdXRzW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVTaG9ydGN1dHNbdHlwZV07XHJcbiAgICAgICAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVTaG9ydGN1dHNbdHlwZV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHRoaXMuZW5zdXJlVHlwZU1hbnVhbCgpW3R5cGVdICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlTWFudWFsW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVNYW51YWxbdHlwZV07XHJcbiAgICAgICAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVNYW51YWxbdHlwZV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgbW92ZVR5cGVTdWJ0eXBlcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgdmFsdWUpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgdGhpcy5yZW5kZXIoKTtcclxuICAgIH07XHJcblxyXG4gICAgaW5uZXIuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XHJcbiAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRW50ZXJcIikge1xyXG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgZmluaXNoKHRydWUpO1xyXG4gICAgICB9IGVsc2UgaWYgKGV2ZW50LmtleSA9PT0gXCJFc2NhcGVcIikge1xyXG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgZmluaXNoKGZhbHNlKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgaW5uZXIuYWRkRXZlbnRMaXN0ZW5lcihcImJsdXJcIiwgKCkgPT4gZmluaXNoKHRydWUpKTtcclxuICB9XHJcblxyXG4gIG9wZW5UeXBlU2V0dGluZ3ModHlwZSkge1xyXG4gICAgdGhpcy5zZWxlY3RlZFR5cGUgPSB0eXBlO1xyXG4gICAgdGhpcy5yZW5kZXIoKTtcclxuICB9XHJcblxyXG4gIGNsb3NlVHlwZVNldHRpbmdzKCkge1xyXG4gICAgdGhpcy5zZWxlY3RlZFR5cGUgPSBudWxsO1xyXG4gICAgdGhpcy5yZW5kZXIoKTtcclxuICB9XHJcblxyXG4gIC8vIFdpcmQgYWxzIENvbXBvbmVudC1DaGlsZCBnZWxhZGVuIChzaWVoZSBtb3VudEZyb250bWF0dGVyRWRpdG9yKSB1bmQgbXVzc1xyXG4gIC8vIGRlc2hhbGIgdm9yIGplZGVtIE5ldWF1ZmJhdSBkZXIgRGV0YWlsLUFuc2ljaHQgZXhwbGl6aXQgZW50bGFkZW4gd2VyZGVuIC1cclxuICAvLyBjb250ZW50RWwuZW1wdHkoKSBhbGxlaW4gd1x1MDBGQ3JkZSBudXIgZGllIERPTS1FbGVtZW50ZSBlbnRmZXJuZW4sIG5pY2h0IGFiZXJcclxuICAvLyBkZW4gZGFyYXVmIHJlZ2lzdHJpZXJ0ZW4gbWV0YWRhdGFUeXBlTWFuYWdlci1MaXN0ZW5lciBkZXIgRWRpdG9yLUluc3RhbnouXHJcbiAgLy8gZnJvbnRtYXR0ZXJCbG9ja3MgaXN0IGRpZSBTdGV1ZXJ1bmcgXHUwMEZDYmVyIGFsbGUgQmxcdTAwRjZja2UgKHUuIGEuIGZcdTAwRkNyIGRlblxyXG4gIC8vIEJlZmVobCBcIlN0YW5kYXJkLVByb3BlcnR5IGhpbnp1Zlx1MDBGQ2dlblwiKSwgZnJvbnRtYXR0ZXJFZGl0b3JzIGFsbGUgRWRpdG9yZW5cclxuICAvLyBkZXIgRGV0YWlsYW5zaWNodCBpbmtsLiBkZXIgU3VidHlwLUJsXHUwMEY2Y2tlLlxyXG4gIGRlc3Ryb3lGcm9udG1hdHRlckVkaXRvcigpIHtcclxuICAgIGZvciAoY29uc3QgZWRpdG9yIG9mIHRoaXMuZnJvbnRtYXR0ZXJFZGl0b3JzID8/IFtdKSB0aGlzLnJlbW92ZUNoaWxkKGVkaXRvcik7XHJcbiAgICB0aGlzLmZyb250bWF0dGVyRWRpdG9ycyA9IFtdO1xyXG4gICAgdGhpcy5mcm9udG1hdHRlckJsb2NrcyA9IG51bGw7XHJcbiAgfVxyXG5cclxuICByZW5kZXIoKSB7XHJcbiAgICAvLyBSZWVudHJhbmN5LUd1YXJkOiByZW5kZXJUeXBlU2V0dGluZ3MoKSBsXHUwMEY2c3QgYW0gRW5kZSBzZWxic3RcclxuICAgIC8vIHBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzKCkgYXVzIChzaWVoZSBkb3J0aWdlciBLb21tZW50YXIpLCB3YXMgdS4gYS5cclxuICAgIC8vIFx1MDBGQ2JlciByZWdpc3RlclR5cFZpZXcgd2llZGVydW0gcmVuZGVyKCkgYXVmIGFsbGVuIFRZUC1WaWV3LUxlYXZlc1xyXG4gICAgLy8gYXVmcnVmdCAtIGlua2x1c2l2ZSBkaWVzZW0sIHdcdTAwRTRocmVuZCBlcyBub2NoIG1pdHRlbiBpbiBnZW5hdSBkaWVzZW1cclxuICAgIC8vIEF1ZnJ1ZiBzdGVja3QuIE9obmUgR3VhcmQgcmVrdXJzaWVydCBkYXMgc3luY2hyb24gb2huZSBBYmJydWNoIGJpc1xyXG4gICAgLy8genVtIFN0YWNrIE92ZXJmbG93LCBiZWkgamVkZW0gXHUwMEQ2ZmZuZW4vVW1iZW5lbm5lbiBlaW5lcyBUWVBzLlxyXG4gICAgaWYgKHRoaXMuX3JlbmRlcmluZykgcmV0dXJuO1xyXG4gICAgdGhpcy5fcmVuZGVyaW5nID0gdHJ1ZTtcclxuICAgIHRyeSB7XHJcbiAgICAgIHRoaXMuZGVzdHJveUZyb250bWF0dGVyRWRpdG9yKCk7XHJcbiAgICAgIGlmICh0aGlzLnNlbGVjdGVkVHlwZSAhPT0gbnVsbCkge1xyXG4gICAgICAgIHRoaXMucmVuZGVyVHlwZVNldHRpbmdzKHRoaXMuc2VsZWN0ZWRUeXBlKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xyXG4gICAgICBjb250ZW50RWwuZW1wdHkoKTtcclxuXHJcbiAgICAgIGNvbnN0IHsgY291bnRzLCBub1R5cGUgfSA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnR5cGVDb3VudHMoKTtcclxuICAgICAgY29uc3QgcmVnaXN0ZXJlZCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVzO1xyXG4gICAgICBjb25zdCB0eXBlQ29sb3JzID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9ycztcclxuICAgICAgY29uc3Qgc29ydE9yZGVyID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwU29ydE9yZGVyID8/IERFRkFVTFRfU09SVF9PUkRFUjtcclxuICAgICAgY29uc3QgaXNNYW51YWxTb3J0ID0gc29ydE9yZGVyID09PSBcIm1hbnVhbFwiO1xyXG4gICAgICBjb25zdCBieUN1cnJlbnRPcmRlciA9IChhLCBiKSA9PiBjb21wYXJlVHlwZXMoc29ydE9yZGVyLCBhLCBiLCBjb3VudHMsIHR5cGVDb2xvcnMpO1xyXG5cclxuICAgICAgdGhpcy5yZW5kZXJMaXN0SGVhZGVyKGNvbnRlbnRFbCk7XHJcblxyXG4gICAgICAvLyBcIltLRUlOIFRZUF1cIiBpc3Qga2VpbiBlY2h0ZXIgVHlwIHVuZCBuaW1tdCBhbiBkZXIgU29ydGllcnVuZyBuaWNodCB0ZWlsIC1cclxuICAgICAgLy8gc3RlaHQgdW5hYmhcdTAwRTRuZ2lnIHZvbiBzZWluZXIgQW56YWhsIGltbWVyIHp1bGV0enQuXHJcbiAgICAgIGNvbnN0IHVucmVnaXN0ZXJlZFJvd3MgPSBbLi4uY291bnRzLmtleXMoKV1cclxuICAgICAgICAuZmlsdGVyKCh0eXBlKSA9PiAhcmVnaXN0ZXJlZC5pbmNsdWRlcyh0eXBlKSlcclxuICAgICAgICAuc29ydChieUN1cnJlbnRPcmRlcilcclxuICAgICAgICAubWFwKCh0eXBlKSA9PiAoeyB0eXBlLCBjb3VudDogY291bnRzLmdldCh0eXBlKSA/PyAwIH0pKTtcclxuICAgICAgaWYgKG5vVHlwZSA+IDApIHtcclxuICAgICAgICB1bnJlZ2lzdGVyZWRSb3dzLnB1c2goeyB0eXBlOiBudWxsLCBjb3VudDogbm9UeXBlIH0pO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBPaG5lIHp3ZWl0ZSBTcGFsdGUgZGFyZiBkZXIgTmFtZSBkaWUgZ2FuemUgWmVpbGUgbmVobWVuIChzaWVoZVxyXG4gICAgICAvLyAuZnJlZC10eXAtbGlzdC1uby1zZWNvbmRhcnkgaW4gc3R5bGVzLmNzcykuXHJcbiAgICAgIGNvbnN0IGxpc3RDbHMgPSBcImZyZWQtdHlwLWxpc3QgbmF2LWZpbGVzLWNvbnRhaW5lclwiICsgKHRoaXMuc2Vjb25kYXJ5TW9kZSgpID09PSBcIm5vbmVcIiA/IFwiIGZyZWQtdHlwLWxpc3Qtbm8tc2Vjb25kYXJ5XCIgOiBcIlwiKTtcclxuICAgICAgdGhpcy5saXN0RWwgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBsaXN0Q2xzIH0pO1xyXG4gICAgICB0aGlzLnNlcGFyYXRvckVsID0gbnVsbDtcclxuXHJcbiAgICAgIC8vIHNvcnRUeXBlc0J5TW9kZSgpIGxcdTAwRTRzc3QgaW0gTWFudWVsbC1Nb2R1cyBiZXd1c3N0IGRpZSBSZWloZW5mb2xnZSB2b25cclxuICAgICAgLy8gcGx1Z2luLnNldHRpbmdzLnR5cGVzIHVuYW5nZXRhc3RldCAtIHBlciBEcmFnICYgRHJvcCBpblxyXG4gICAgICAvLyByZW5kZXJSZWdpc3RlcmVkSXRlbSgpIHVtc29ydGllcnQuIERlciBpbmRleCB3aXJkIGRhZlx1MDBGQ3IgMToxIGFsc1xyXG4gICAgICAvLyBQb3NpdGlvbiBpbiBkaWVzZXIgKGluIGRpZXNlbSBNb2R1cyB1bnZlclx1MDBFNG5kZXJ0ZW4pIFJlaWhlbmZvbGdlXHJcbiAgICAgIC8vIHdlaXRlcmdlZ2ViZW4uXHJcbiAgICAgIGNvbnN0IHJlZ2lzdGVyZWRPcmRlciA9IHNvcnRUeXBlc0J5TW9kZShyZWdpc3RlcmVkLCBzb3J0T3JkZXIsIGNvdW50cywgdHlwZUNvbG9ycyk7XHJcbiAgICAgIHJlZ2lzdGVyZWRPcmRlci5mb3JFYWNoKCh0eXBlLCBpbmRleCkgPT4ge1xyXG4gICAgICAgIHRoaXMucmVuZGVyUmVnaXN0ZXJlZEl0ZW0odHlwZSwgY291bnRzLmdldCh0eXBlKSA/PyAwLCB7IGRyYWdnYWJsZTogaXNNYW51YWxTb3J0LCBpbmRleCB9KTtcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBpZiAodW5yZWdpc3RlcmVkUm93cy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgdGhpcy5zZXBhcmF0b3JFbCA9IHRoaXMubGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1zZXBhcmF0b3JcIiB9KTtcclxuICAgICAgICBmb3IgKGNvbnN0IHJvdyBvZiB1bnJlZ2lzdGVyZWRSb3dzKSB7XHJcbiAgICAgICAgICBpZiAocm93LnR5cGUgPT09IG51bGwpIHRoaXMucmVuZGVyTm9UeXBlSXRlbShyb3cuY291bnQpO1xyXG4gICAgICAgICAgZWxzZSB0aGlzLnJlbmRlclVucmVnaXN0ZXJlZEl0ZW0ocm93LnR5cGUsIHJvdy5jb3VudCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICB9IGZpbmFsbHkge1xyXG4gICAgICB0aGlzLl9yZW5kZXJpbmcgPSBmYWxzZTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8vIFdpZSBkZXIgXCJDaGFuZ2Ugc29ydCBvcmRlclwiLUJ1dHRvbiBpbiBPYnNpZGlhbnMgVGFncy0gYnp3LiBBbGwtUHJvcGVydGllcy1WaWV3LlxyXG4gIHJlbmRlckxpc3RIZWFkZXIoY29udGVudEVsKSB7XHJcbiAgICBjb25zdCBoZWFkZXIgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcIm5hdi1oZWFkZXJcIiB9KTtcclxuICAgIGNvbnN0IGJ1dHRvbnNDb250YWluZXIgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcIm5hdi1idXR0b25zLWNvbnRhaW5lclwiIH0pO1xyXG5cclxuICAgIGNvbnN0IGFkZEJ0biA9IGJ1dHRvbnNDb250YWluZXIuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIG5hdi1hY3Rpb24tYnV0dG9uXCIsXHJcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiTmV1ZW4gVHlwIGhpbnp1Zlx1MDBGQ2dlblwiIH0sXHJcbiAgICB9KTtcclxuICAgIHNldEljb24oYWRkQnRuLCBcInBsdXNcIik7XHJcbiAgICBhZGRCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuc3RhcnRBZGQoKSk7XHJcblxyXG4gICAgY29uc3Qgc29ydEJ0biA9IGJ1dHRvbnNDb250YWluZXIuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIG5hdi1hY3Rpb24tYnV0dG9uXCIsXHJcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiU29ydGllcnJlaWhlbmZvbGdlIFx1MDBFNG5kZXJuXCIgfSxcclxuICAgIH0pO1xyXG4gICAgc2V0SWNvbihzb3J0QnRuLCBcImx1Y2lkZS1zb3J0LWFzY1wiKTtcclxuICAgIHNvcnRCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChldmVudCkgPT4gdGhpcy5zaG93U29ydE1lbnUoZXZlbnQpKTtcclxuXHJcbiAgICAvLyBad2VpdGUgU3BhbHRlOiBiZXd1c3N0IGtlaW4gTWVudWUsIHNvbmRlcm4gZWluIEtub3BmLCBkZXIgZGllIGRyZWkgTW9kaVxyXG4gICAgLy8gZGVyIFJlaWhlIG5hY2ggZHVyY2hzY2hhbHRldCAtIGJlaSBzbyB3ZW5pZ2VuIFp1c3RhZW5kZW4sIGRlcmVuIFdpcmt1bmdcclxuICAgIC8vIGRpcmVrdCBkYXJ1bnRlciBzaWNodGJhciB3aXJkLCBpc3QgRHVyY2hrbGlja2VuIHNjaG5lbGxlciBhbHMgQXVma2xhcHBlblxyXG4gICAgLy8gdW5kIEF1c3dhZWhsZW4uIEljb24gdW5kIFRvb2x0aXAgemVpZ2VuIGRlbiBha3R1ZWxsZW4gTW9kdXMuXHJcbiAgICBjb25zdCBjdXJyZW50ID0gU0VDT05EQVJZX01PREVTW3RoaXMuc2Vjb25kYXJ5SW5kZXgoKV07XHJcbiAgICBjb25zdCBzZWNvbmRhcnlCdG4gPSBidXR0b25zQ29udGFpbmVyLmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiBuYXYtYWN0aW9uLWJ1dHRvblwiLFxyXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBgTmViZW4gZGVtIE5hbWVuOiAke2N1cnJlbnQudGl0bGV9YCB9LFxyXG4gICAgfSk7XHJcbiAgICBzZXRJY29uKHNlY29uZGFyeUJ0biwgY3VycmVudC5pY29uKTtcclxuICAgIHNlY29uZGFyeUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5jeWNsZVNlY29uZGFyeSgpKTtcclxuICB9XHJcblxyXG4gIC8vIHNldHRpbmdzLnR5cExpc3RTZWNvbmRhcnksIGFiZXIgaW1tZXIgZWluIGd1ZWx0aWdlciBNb2R1cyAtIEJlc3RhbmRzZGF0ZW5cclxuICAvLyBrZW5uZW4gZGVuIFNjaGx1ZXNzZWwgbm9jaCBuaWNodCAoc2llaGUgbWlncmF0ZVR5cExpc3RTZWNvbmRhcnkgaW4gbWFpbi5qcyksXHJcbiAgLy8gdW5kIGVpbiBzcGFldGVyIGVudGZlcm50ZXIgTW9kdXMgc29sbCBkaWUgTGlzdGUgbmljaHQgbGVlciBsYXNzZW4uXHJcbiAgc2Vjb25kYXJ5TW9kZSgpIHtcclxuICAgIGNvbnN0IG1vZGUgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBMaXN0U2Vjb25kYXJ5O1xyXG4gICAgcmV0dXJuIFNFQ09OREFSWV9NT0RFUy5zb21lKChlbnRyeSkgPT4gZW50cnkubW9kZSA9PT0gbW9kZSkgPyBtb2RlIDogREVGQVVMVF9TRUNPTkRBUlk7XHJcbiAgfVxyXG5cclxuICBzZWNvbmRhcnlJbmRleCgpIHtcclxuICAgIHJldHVybiBTRUNPTkRBUllfTU9ERVMuZmluZEluZGV4KChlbnRyeSkgPT4gZW50cnkubW9kZSA9PT0gdGhpcy5zZWNvbmRhcnlNb2RlKCkpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgY3ljbGVTZWNvbmRhcnkoKSB7XHJcbiAgICBjb25zdCBuZXh0ID0gU0VDT05EQVJZX01PREVTWyh0aGlzLnNlY29uZGFyeUluZGV4KCkgKyAxKSAlIFNFQ09OREFSWV9NT0RFUy5sZW5ndGhdO1xyXG4gICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwTGlzdFNlY29uZGFyeSA9IG5leHQubW9kZTtcclxuICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgLy8gV2llIGltIFNvcnRpZXItTWVudWU6IG51ciBuZXUgemVpY2huZW4uIERlciBNb2R1cyBiZXRyaWZmdCBhdXNzY2hsaWVzc2xpY2hcclxuICAgIC8vIGRpZXNlIExpc3RlLCBuaWNodCBkaWUgRWluZmFlcmJ1bmcgYW5kZXJzd28gLSByZWZyZXNoVHlwQ29sb3JzIHdhZXJlIGhpZXJcclxuICAgIC8vIGFsc28gbnVyIGVpbiB1bm5vZXRpZ2VzIFJ1bmR1bS1OZXV6ZWljaG5lbiBhbGxlciBBbnNpY2h0ZW4uXHJcbiAgICB0aGlzLnJlbmRlcigpO1xyXG4gIH1cclxuXHJcbiAgc2hvd1NvcnRNZW51KGV2ZW50KSB7XHJcbiAgICBjb25zdCBjdXJyZW50ID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwU29ydE9yZGVyID8/IERFRkFVTFRfU09SVF9PUkRFUjtcclxuICAgIGNvbnN0IG1lbnUgPSBuZXcgTWVudSgpO1xyXG5cclxuICAgIGNvbnN0IGFkZEdyb3VwID0gKHN0YXJ0LCBlbmQpID0+IHtcclxuICAgICAgZm9yIChsZXQgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcclxuICAgICAgICBjb25zdCB7IG1vZGUsIHRpdGxlIH0gPSBTT1JUX09QVElPTlNbaV07XHJcbiAgICAgICAgbWVudS5hZGRJdGVtKChpdGVtKSA9PlxyXG4gICAgICAgICAgaXRlbVxyXG4gICAgICAgICAgICAuc2V0VGl0bGUodGl0bGUpXHJcbiAgICAgICAgICAgIC5zZXRDaGVja2VkKGN1cnJlbnQgPT09IG1vZGUpXHJcbiAgICAgICAgICAgIC5vbkNsaWNrKGFzeW5jICgpID0+IHtcclxuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBTb3J0T3JkZXIgPSBtb2RlO1xyXG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgICAgICAgIHRoaXMucmVuZGVyKCk7XHJcbiAgICAgICAgICAgIH0pXHJcbiAgICAgICAgKTtcclxuICAgICAgfVxyXG4gICAgfTtcclxuXHJcbiAgICBhZGRHcm91cCgwLCAxKTtcclxuICAgIG1lbnUuYWRkU2VwYXJhdG9yKCk7XHJcbiAgICBhZGRHcm91cCgxLCAzKTtcclxuICAgIG1lbnUuYWRkU2VwYXJhdG9yKCk7XHJcbiAgICBhZGRHcm91cCgzLCA1KTtcclxuICAgIG1lbnUuYWRkU2VwYXJhdG9yKCk7XHJcbiAgICBhZGRHcm91cCg1LCA3KTtcclxuXHJcbiAgICBtZW51LnNob3dBdE1vdXNlRXZlbnQoZXZlbnQpO1xyXG4gIH1cclxuXHJcbiAgcmVuZGVyTm9UeXBlSXRlbShjb3VudCkge1xyXG4gICAgY29uc3QgdHJlZUl0ZW0gPSB0aGlzLmxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtXCIgfSk7XHJcbiAgICBjb25zdCBzZWxmID0gdHJlZUl0ZW0uY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1zZWxmIGlzLWNsaWNrYWJsZSBmcmVkLXR5cC11bnJlZ2lzdGVyZWRcIiB9KTtcclxuICAgIHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1pbm5lclwiLCB0ZXh0OiBcIltLRUlOIFRZUF1cIiB9KTtcclxuICAgIHRoaXMucmVuZGVyQ291bnRGbGFpcihzZWxmLCBjb3VudCk7XHJcblxyXG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5vcGVuU2VhcmNoKG51bGwpKTtcclxuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNvbnRleHRtZW51XCIsIChldmVudCkgPT4ge1xyXG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgdGhpcy5vcGVuU2VhcmNoKG51bGwpO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICAvLyBDaHJvbWl1bXMgaW5wdXRbdHlwZT1jb2xvcl0gaGF0IGVpbmVuIGVpZ2VuZW4gTWluZGVzdC1Td2F0Y2gsIGRlciBzaWNoIG5pY2h0XHJcbiAgLy8gdW50ZXIgVGV4dGdyXHUwMEY2XHUwMERGZSBza2FsaWVyZW4gbFx1MDBFNHNzdCAtIGRhaGVyIG51ciBhbHMgdW5zaWNodGJhcmVuIFBpY2tlci1UcmlnZ2VyXHJcbiAgLy8gXHUwMEZDYmVyIGRlbSBmcmVpIHNrYWxpZXJiYXJlbiBQdW5rdCBwbGF0emllcmVuLiBPaG5lIGVpZ2VuZSBGYXJiZSBzdGVodCBkZXJcclxuICAvLyBQdW5rdCBhbHMgaG9obGVyIGdyYXVlciBSaW5nIGRhIChzaWVoZSBwYWludENvbG9yRG90KTsgbWl0IHNob3dSZXNldFxyXG4gIC8vIChEZXRhaWxhbnNpY2h0KSBuZW5udCBlaW4gVG9vbHRpcCBkZW4gWnVzdGFuZCwgdW5kIGRlciBadXJcdTAwRkNja3NldHplbi1CdXR0b25cclxuICAvLyBpc3QgZGFubiBhdXNnZWdyYXV0LlxyXG4gIHJlbmRlckNvbG9yUGlja2VyKHBhcmVudCwgdHlwZSwgb25DaGFuZ2UsIHsgc2hvd1Jlc2V0ID0gZmFsc2UgfSA9IHt9KSB7XHJcbiAgICBjb25zdCBjdXJyZW50Q29sb3IgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdID8/IERFRkFVTFRfVFlQRV9DT0xPUjtcclxuICAgIGNvbnN0IGNvbG9yV3JhcCA9IHBhcmVudC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtY29sb3Itd3JhcFwiIH0pO1xyXG4gICAgY29uc3QgY29sb3JEb3QgPSBjb2xvcldyYXAuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWNvbG9yLWRvdFwiIH0pO1xyXG4gICAgbGV0IHJlc2V0QnRuID0gbnVsbDtcclxuICAgIGNvbnN0IHNob3dTdGF0ZSA9IChjb2xvciwgaXNEZWZhdWx0KSA9PiB7XHJcbiAgICAgIHBhaW50Q29sb3JEb3QoY29sb3JEb3QsIGNvbG9yLCBpc0RlZmF1bHQpO1xyXG4gICAgICBpZiAoIXNob3dSZXNldCkgcmV0dXJuO1xyXG4gICAgICBjb2xvcldyYXAuc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCBpc0RlZmF1bHQgPyBcIlN0YW5kYXJkIChrZWluZSBGYXJiZSlcIiA6IFwiRmFyYmUgXHUwMEU0bmRlcm5cIik7XHJcbiAgICAgIHJlc2V0QnRuPy50b2dnbGVDbGFzcyhcImlzLWRpc2FibGVkXCIsIGlzRGVmYXVsdCk7XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IGNvbG9ySW5wdXQgPSBjb2xvcldyYXAuY3JlYXRlRWwoXCJpbnB1dFwiLCB7IHR5cGU6IFwiY29sb3JcIiwgY2xzOiBcImZyZWQtdHlwLWNvbG9yLWlucHV0XCIgfSk7XHJcbiAgICBjb2xvcklucHV0LnZhbHVlID0gY3VycmVudENvbG9yO1xyXG4gICAgY29sb3JJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiBldmVudC5zdG9wUHJvcGFnYXRpb24oKSk7XHJcblxyXG4gICAgLy8gXCJpbnB1dFwiIGZldWVydCBiZWkgamVkZXIgWndpc2NoZW5mYXJiZSwgd1x1MDBFNGhyZW5kIGRlciBuYXRpdmUgUGlja2VyIG5vY2hcclxuICAgIC8vIG9mZmVuIGlzdCAtIGhpZXIgbnVyIGxva2FsZSBWb3JzY2hhdSAoUHVua3QsIGdnZi4gTmFtZSB2aWEgb25DaGFuZ2UpLCBvaG5lXHJcbiAgICAvLyBkaWUgXHUwMEZDYnJpZ2VuIFZpZXdzIChEYXRlaS1FeHBsb3JlciwgR3JhcGgsIC4uLikgbmV1IHp1IHJlbmRlcm46XHJcbiAgICAvLyByZWZyZXNoVHlwQ29sb3JzKCkgbFx1MDBGNnN0IGRhZlx1MDBGQ3IgdS4gYS4gcmVuZGVyKCkgYXVmIGRpZXNlciBUWVAtVmlldyBzZWxic3RcclxuICAgIC8vIGF1cywgd2FzIGRpZXNlcyA8aW5wdXQgdHlwZT1jb2xvcj4gYXVzIGRlbSBET00gZW50ZmVybmVuIHVuZCBkZW4gbmF0aXZlblxyXG4gICAgLy8gUGlja2VyIGRhbWl0IHNvZm9ydCBzY2hsaWVcdTAwREZlbiB3XHUwMEZDcmRlIC0gbm9jaCBiZXZvciBtYW4gXHUwMEZDYmVyaGF1cHQgZWluZSBGYXJiZVxyXG4gICAgLy8gYXVzd1x1MDBFNGhsZW4ga2FubiAoc2Nob24gYmVpbSBlcnN0ZW4gS2xpY2ssIHZvciBkZW0gTG9zbGFzc2VuIGRlciBUYXN0ZSkuXHJcbiAgICBjb2xvcklucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJpbnB1dFwiLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIHNob3dTdGF0ZShjb2xvcklucHV0LnZhbHVlLCBmYWxzZSk7XHJcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV0gPSBjb2xvcklucHV0LnZhbHVlO1xyXG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgb25DaGFuZ2U/Lihjb2xvcklucHV0LnZhbHVlKTtcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEVyc3Qgd2VubiBkaWUgQXVzd2FobCBiZXN0XHUwMEU0dGlndCB1bmQgZGVyIG5hdGl2ZSBQaWNrZXIgZGFkdXJjaCBnZXNjaGxvc3NlblxyXG4gICAgLy8gd2lyZCwgZGllIFx1MDBGQ2JyaWdlbiBWaWV3cyBuYWNoemllaGVuIC0gYW4gZGVtIFB1bmt0IGthbm4gZWluIE5ldS1SZW5kZXJuXHJcbiAgICAvLyBkaWVzZXIgVFlQLVZpZXcgc2VsYnN0IG5pY2h0cyBtZWhyIGthcHV0dCBtYWNoZW4uXHJcbiAgICBjb2xvcklucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgKCkgPT4gdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCkpO1xyXG5cclxuICAgIGlmIChzaG93UmVzZXQpIHtcclxuICAgICAgcmVzZXRCdG4gPSBwYXJlbnQuY3JlYXRlRGl2KHtcclxuICAgICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gZnJlZC10eXAtY29sb3ItcmVzZXRcIixcclxuICAgICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkZhcmJlIHp1clx1MDBGQ2Nrc2V0emVuXCIgfSxcclxuICAgICAgfSk7XHJcbiAgICAgIHNldEljb24ocmVzZXRCdG4sIFwicm90YXRlLWNjd1wiKTtcclxuICAgICAgcmVzZXRCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGFzeW5jICgpID0+IHtcclxuICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXTtcclxuICAgICAgICBjb2xvcklucHV0LnZhbHVlID0gREVGQVVMVF9UWVBFX0NPTE9SO1xyXG4gICAgICAgIHNob3dTdGF0ZShERUZBVUxUX1RZUEVfQ09MT1IsIHRydWUpO1xyXG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgICAgIG9uQ2hhbmdlPy4oREVGQVVMVF9UWVBFX0NPTE9SKTtcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICBzaG93U3RhdGUoY3VycmVudENvbG9yLCB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdID09PSB1bmRlZmluZWQpO1xyXG5cclxuICAgIHJldHVybiBjb2xvcldyYXA7XHJcbiAgfVxyXG5cclxuICAvLyBGXHUwMEU0bmd0IEJlc3RhbmRzaW5zdGFsbGF0aW9uZW4gYWIsIGRlcmVuIHNldHRpbmdzLU9iamVrdCBzY2hvbiB2b3IgRWluZlx1MDBGQ2hydW5nXHJcbiAgLy8gdm9uIHR5cGVNYW51YWwgZ2VsYWRlbiB3dXJkZSAoei4gQi4gbGF1ZmVuZGUgU2Vzc2lvbiB2b3IgZWluZW0gdm9sbHN0XHUwMEU0bmRpZ2VuXHJcbiAgLy8gUGx1Z2luLVJlbG9hZCBuYWNoIEhvdC1SZWxvYWQpIC0gb2huZSBkYXMgd1x1MDBGQ3JkZSBqZWRlciBadWdyaWZmIHVudGVuIG1pdFxyXG4gIC8vIFwiQ2Fubm90IHJlYWQgcHJvcGVydGllcyBvZiB1bmRlZmluZWRcIiBhYmJyZWNoZW4gdW5kIGRhYmVpIGRlbiBnZXNhbXRlblxyXG4gIC8vIHJlc3RsaWNoZW4gcmVuZGVyVHlwZVNldHRpbmdzKCktQXVmcnVmIChGYXJiZSwgQmVzY2hyZWlidW5nLCBGcm9udG1hdHRlcilcclxuICAvLyBtaXQgc2ljaCByZWlcdTAwREZlbiwgZGEgZGVyIEZlaGxlciBzeW5jaHJvbiBtaXR0ZW4gaW4gZGVyIEZ1bmt0aW9uIGF1ZnRyaXR0LlxyXG4gIGVuc3VyZVR5cGVNYW51YWwoKSB7XHJcbiAgICBpZiAoIXRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVNYW51YWwpIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVNYW51YWwgPSB7fTtcclxuICAgIHJldHVybiB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlTWFudWFsO1xyXG4gIH1cclxuXHJcbiAgLy8gTmFjaGdlYmF1dCB3aWUgT2JzaWRpYW5zIGVpZ2VuZXIgVG9nZ2xlQ29tcG9uZW50IChjaGVja2JveC1jb250YWluZXIgK1xyXG4gIC8vIHZlcnN0ZWNrdGVzIGlucHV0W3R5cGU9Y2hlY2tib3hdKSwgZGEgd2lyIGhpZXIgZGlyZWt0IGltIERPTSBzdGF0dCBcdTAwRkNiZXJcclxuICAvLyBkaWUgU2V0dGluZy1BUEkgYmF1ZW4uIFN0YW5kYXJkbVx1MDBFNFx1MDBERmlnIGFuIC0gZGFoZXIgd2lyZCAod2llIGJlaSBkZW4gYW5kZXJlblxyXG4gIC8vIHR5cGVYeHgtRGljdHMpIG51ciBkaWUgQWJ3ZWljaHVuZyB2b20gRGVmYXVsdCBnZXNwZWljaGVydCwgaGllciBhbHNvIG51clxyXG4gIC8vIFwiYXVzXCIgKGZhbHNlKTsgZmVobGVuZGVyIEVpbnRyYWcgYnp3LiB0cnVlIGJlZGV1dGVuIFwiYW5cIi4gU3RldWVydCwgb2IgZWluXHJcbiAgLy8gVFlQIGluIGdldFR5cGVzKCkgKHNpZWhlIG1haW4uanMpIGV4cG9ydGllcnQgd2lyZCwgc2llaGUgZG9ydGlnZXIgS29tbWVudGFyLlxyXG4gIHJlbmRlck1hbnVhbFRvZ2dsZShwYXJlbnQsIHR5cGUpIHtcclxuICAgIGNvbnN0IGN1cnJlbnQgPSB0aGlzLmVuc3VyZVR5cGVNYW51YWwoKVt0eXBlXSAhPT0gZmFsc2U7XHJcbiAgICBjb25zdCB0b2dnbGVFbCA9IHBhcmVudC5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwiY2hlY2tib3gtY29udGFpbmVyXCIgKyAoY3VycmVudCA/IFwiIGlzLWVuYWJsZWRcIiA6IFwiXCIpLFxyXG4gICAgICBhdHRyOiB7IHRhYmluZGV4OiBcIjBcIiwgcm9sZTogXCJjaGVja2JveFwiLCBcImFyaWEtY2hlY2tlZFwiOiBTdHJpbmcoY3VycmVudCkgfSxcclxuICAgIH0pO1xyXG4gICAgdG9nZ2xlRWwuY3JlYXRlRWwoXCJpbnB1dFwiLCB7IHR5cGU6IFwiY2hlY2tib3hcIiB9KTtcclxuXHJcbiAgICBjb25zdCB0b2dnbGUgPSBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IG5leHQgPSAhdG9nZ2xlRWwuaGFzQ2xhc3MoXCJpcy1lbmFibGVkXCIpO1xyXG4gICAgICB0b2dnbGVFbC50b2dnbGVDbGFzcyhcImlzLWVuYWJsZWRcIiwgbmV4dCk7XHJcbiAgICAgIHRvZ2dsZUVsLnNldEF0dHJpYnV0ZShcImFyaWEtY2hlY2tlZFwiLCBTdHJpbmcobmV4dCkpO1xyXG4gICAgICBpZiAobmV4dCkgZGVsZXRlIHRoaXMuZW5zdXJlVHlwZU1hbnVhbCgpW3R5cGVdO1xyXG4gICAgICBlbHNlIHRoaXMuZW5zdXJlVHlwZU1hbnVhbCgpW3R5cGVdID0gZmFsc2U7XHJcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgfTtcclxuXHJcbiAgICB0b2dnbGVFbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgdG9nZ2xlKTtcclxuICAgIHRvZ2dsZUVsLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIChldmVudCkgPT4ge1xyXG4gICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVudGVyXCIgfHwgZXZlbnQua2V5ID09PSBcIiBcIikge1xyXG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgdG9nZ2xlKCk7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIHJldHVybiB0b2dnbGVFbDtcclxuICB9XHJcblxyXG4gIHJlbmRlclJlZ2lzdGVyZWRJdGVtKHR5cGUsIGNvdW50LCB7IGRyYWdnYWJsZSA9IGZhbHNlLCBpbmRleCA9IC0xIH0gPSB7fSkge1xyXG4gICAgY29uc3QgdHJlZUl0ZW0gPSB0aGlzLmxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtXCIgfSk7XHJcbiAgICBjb25zdCBzZWxmID0gdHJlZUl0ZW0uY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1zZWxmIGlzLWNsaWNrYWJsZVwiIH0pO1xyXG5cclxuICAgIGxldCBuYW1lRWw7XHJcbiAgICB0aGlzLnJlbmRlckNvbG9yUGlja2VyKHNlbGYsIHR5cGUsIChuZXdDb2xvcikgPT4ge1xyXG4gICAgICBpZiAobmFtZUVsICYmIHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdCkgbmFtZUVsLnN0eWxlLmNvbG9yID0gbmV3Q29sb3I7XHJcbiAgICB9KTtcclxuXHJcbiAgICBuYW1lRWwgPSBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0taW5uZXJcIiwgdGV4dDogdHlwZSB9KTtcclxuICAgIGNvbnN0IGNvbG9yID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0ID8gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXSA6IG51bGw7XHJcbiAgICBpZiAoY29sb3IpIG5hbWVFbC5zdHlsZS5jb2xvciA9IGNvbG9yO1xyXG5cclxuICAgIC8vIFp3ZWl0ZSBTcGFsdGUsIHVtZ2VzY2hhbHRldCB1ZWJlciBkZW4gS25vcGYgaW0gTGlzdGVuLUhlYWRlciAoc2llaGVcclxuICAgIC8vIFNFQ09OREFSWV9NT0RFUyB1bmQgY3ljbGVTZWNvbmRhcnkpLlxyXG4gICAgY29uc3Qgc2Vjb25kYXJ5ID0gdGhpcy5zZWNvbmRhcnlNb2RlKCk7XHJcbiAgICBpZiAoc2Vjb25kYXJ5ID09PSBcImRlc2NyaXB0aW9uXCIpIHRoaXMucmVuZGVyRGVzY3JpcHRpb25JbnB1dChzZWxmLCB0eXBlKTtcclxuICAgIGVsc2UgaWYgKHNlY29uZGFyeSA9PT0gXCJzdWJ0eXBlc1wiKSB0aGlzLnJlbmRlclN1YnR5cGVQcmV2aWV3KHNlbGYsIHR5cGUpO1xyXG5cclxuICAgIHRoaXMucmVuZGVyQ291bnRGbGFpcihzZWxmLCBjb3VudCk7XHJcblxyXG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICBpZiAodGhpcy5pc0VkaXRpbmcpIHJldHVybjtcclxuICAgICAgdGhpcy5vcGVuVHlwZVNldHRpbmdzKHR5cGUpO1xyXG4gICAgfSk7XHJcbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcclxuICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgIHRoaXMub3BlblNlYXJjaCh0eXBlKTtcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIE51ciBpbSBNYW51ZWxsLVNvcnRpZXJtb2R1cyBha3RpdiAoc2llaGUgcmVuZGVyKCkpIC0gZGllIGdhbnplIFplaWxlIGlzdFxyXG4gICAgLy8gZGFubiBwZXIgRHJhZyAmIERyb3AgdmVyc2NoaWViYmFyIChlaW4gRHJhZywgZGVyIGF1ZiBkZW0gRmFyYnB1bmt0IG9kZXJcclxuICAgIC8vIGltIEJlc2NocmVpYnVuZ3NmZWxkIGJlZ2lubnQsIGdyZWlmdCB0cm90emRlbSBuaWNodCAtIGRpZXNlIEVsZW1lbnRlXHJcbiAgICAvLyBuZWhtZW4gZGVuIE1vdXNlZG93biBzZWxic3QgZlx1MDBGQ3IgRmFyYi0vVGV4dGF1c3dhaGwpLiBWZXJzY2hvYmVuIHdpcmRcclxuICAgIC8vIGRpcmVrdCBpbiBwbHVnaW4uc2V0dGluZ3MudHlwZXMgLSBkaWVzZWxiZSBMaXN0ZSwgZGllIGltIE1hbnVlbGwtTW9kdXNcclxuICAgIC8vIHVuc29ydGllcnQgYWxzIEFuemVpZ2VyZWloZW5mb2xnZSBkaWVudCAoc2llaGUgcmVuZGVyKCkpLlxyXG4gICAgaWYgKGRyYWdnYWJsZSkge1xyXG4gICAgICBzZWxmLmRyYWdnYWJsZSA9IHRydWU7XHJcbiAgICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdzdGFydFwiLCAoZXZlbnQpID0+IHtcclxuICAgICAgICBldmVudC5kYXRhVHJhbnNmZXIuZWZmZWN0QWxsb3dlZCA9IFwibW92ZVwiO1xyXG4gICAgICAgIGV2ZW50LmRhdGFUcmFuc2Zlci5zZXREYXRhKFwidGV4dC9wbGFpblwiLCBTdHJpbmcoaW5kZXgpKTtcclxuICAgICAgICBzZWxmLmNsYXNzTGlzdC5hZGQoXCJpcy1kcmFnZ2luZ1wiKTtcclxuICAgICAgfSk7XHJcbiAgICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdlbmRcIiwgKCkgPT4gc2VsZi5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJhZ2dpbmdcIikpO1xyXG4gICAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnb3ZlclwiLCAoZXZlbnQpID0+IHtcclxuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgIGNvbnN0IHJlY3QgPSBzZWxmLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xyXG4gICAgICAgIGNvbnN0IGlzQWZ0ZXIgPSBldmVudC5jbGllbnRZIC0gcmVjdC50b3AgPiByZWN0LmhlaWdodCAvIDI7XHJcbiAgICAgICAgc2VsZi5jbGFzc0xpc3QudG9nZ2xlKFwiaXMtZHJvcC1iZWZvcmVcIiwgIWlzQWZ0ZXIpO1xyXG4gICAgICAgIHNlbGYuY2xhc3NMaXN0LnRvZ2dsZShcImlzLWRyb3AtYWZ0ZXJcIiwgaXNBZnRlcik7XHJcbiAgICAgIH0pO1xyXG4gICAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnbGVhdmVcIiwgKCkgPT4gc2VsZi5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJvcC1iZWZvcmVcIiwgXCJpcy1kcm9wLWFmdGVyXCIpKTtcclxuICAgICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiZHJvcFwiLCBhc3luYyAoZXZlbnQpID0+IHtcclxuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgIGNvbnN0IGlzQWZ0ZXIgPSBzZWxmLmNsYXNzTGlzdC5jb250YWlucyhcImlzLWRyb3AtYWZ0ZXJcIik7XHJcbiAgICAgICAgc2VsZi5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJvcC1iZWZvcmVcIiwgXCJpcy1kcm9wLWFmdGVyXCIpO1xyXG5cclxuICAgICAgICBjb25zdCBmcm9tSW5kZXggPSBOdW1iZXIoZXZlbnQuZGF0YVRyYW5zZmVyLmdldERhdGEoXCJ0ZXh0L3BsYWluXCIpKTtcclxuICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKGZyb21JbmRleCkgfHwgZnJvbUluZGV4ID09PSBpbmRleCkgcmV0dXJuO1xyXG5cclxuICAgICAgICBsZXQgaW5zZXJ0QmVmb3JlID0gaXNBZnRlciA/IGluZGV4ICsgMSA6IGluZGV4O1xyXG4gICAgICAgIGlmIChmcm9tSW5kZXggPCBpbnNlcnRCZWZvcmUpIGluc2VydEJlZm9yZSAtPSAxO1xyXG5cclxuICAgICAgICBjb25zdCB0eXBlcyA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVzO1xyXG4gICAgICAgIGNvbnN0IFttb3ZlZF0gPSB0eXBlcy5zcGxpY2UoZnJvbUluZGV4LCAxKTtcclxuICAgICAgICB0eXBlcy5zcGxpY2UoaW5zZXJ0QmVmb3JlLCAwLCBtb3ZlZCk7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgdGhpcy5yZW5kZXIoKTtcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvLyBFY2h0ZXMgVGV4dC1JbnB1dCBzdGF0dCBudXIgQW56ZWlnZTogZGllIEJlc2NocmVpYnVuZyBpc3QgZGlyZWt0IGluIGRlclxyXG4gIC8vIExpc3RlIGJlYXJiZWl0YmFyLCBvaG5lIGRhZlx1MDBGQ3IgZXJzdCBkaWUgRGV0YWlsYW5zaWNodCBcdTAwRjZmZm5lbiB6dSBtXHUwMEZDc3Nlbi5cclxuICAvLyBjbGljayBoaWVyIG11c3MgZGllIFplaWxlIHNlbGJzdCBnZXppZWx0IE5JQ0hUIGF1c2xcdTAwRjZzZW5cclxuICAvLyAoc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgLi4uKSBpbiByZW5kZXJSZWdpc3RlcmVkSXRlbSBcdTAwRjZmZm5ldCBzb25zdFxyXG4gIC8vIGRpZSBEZXRhaWxhbnNpY2h0KSwgZGFoZXIgc3RvcFByb3BhZ2F0aW9uLlxyXG4gIHJlbmRlckRlc2NyaXB0aW9uSW5wdXQoc2VsZiwgdHlwZSkge1xyXG4gICAgY29uc3QgZGVzY0lucHV0ID0gc2VsZi5jcmVhdGVFbChcImlucHV0XCIsIHtcclxuICAgICAgdHlwZTogXCJ0ZXh0XCIsXHJcbiAgICAgIGNsczogXCJmcmVkLXR5cC1saXN0LWRlc2NyaXB0aW9uLWlucHV0XCIsXHJcbiAgICB9KTtcclxuICAgIGRlc2NJbnB1dC52YWx1ZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV0gPz8gXCJcIjtcclxuICAgIGRlc2NJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiBldmVudC5zdG9wUHJvcGFnYXRpb24oKSk7XHJcbiAgICBkZXNjSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IHZhbHVlID0gZGVzY0lucHV0LnZhbHVlLnRyaW0oKTtcclxuICAgICAgaWYgKHZhbHVlKSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3R5cGVdID0gdmFsdWU7XHJcbiAgICAgIGVsc2UgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV07XHJcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICAvLyBcIihTdWJ0eXAgMSwgU3VidHlwIDIpXCIgc3RhdHQgZGVyIEJlc2NocmVpYnVuZyAtIGRpZXNlbGJlIERhcnN0ZWxsdW5nIHdpZVxyXG4gIC8vIGRpZSBTdWJ0eXAtVm9yc2NoYXUgaW0gc2VwYXJhdGVuIFRZUC1QaWNrZXIgKHJlbmRlclN1YnR5cGVQcmV2aWV3IGluXHJcbiAgLy8gdHlwZS1waWNrZXIuanMsIGdlbWVpbnNhbWUgRmFyYmdydW5kbGFnZSBuYW1lQ29sb3IgaW4gdHlwZS1jb2xvcnMuanMpOlxyXG4gIC8vIEtsYW1tZXJuIHVuZCBLb21tYXMgbXV0ZWQsIGplZGVyIE5hbWUgaW4gc2VpbmVyIGVpZ2VuZW4gU3VidHlwLUZhcmJlOyBvaG5lXHJcbiAgLy8gXCJUWVAgVmlldyBlaW5mXHUwMEU0cmJlblwiIGJsZWlidCBkaWUgVm9yc2NoYXUgd2llIGRlciBUWVAtTmFtZSBzZWxic3QgdW5nZWZcdTAwRTRyYnQsXHJcbiAgLy8gdW5kIG9obmUgZGVzc2VuIFVudGVyLVNjaGFsdGVyIFwiU3VidHlwXCIgc3RlaGVuIGFsbGUgaW4gZGVyIFRZUC1GYXJiZS5cclxuICAvLyBCZXd1c3N0IG51ciBkaWUgZXJmYXNzdGVuIFN1YnR5cGVuIHVuZCBvaG5lIE5vdGl6LUFuemFobDogbmljaHQgZXJmYXNzdGVcclxuICAvLyBXZXJ0ZSBoYWJlbiB3ZWRlciBGYXJiZSBub2NoIERlZmluaXRpb24sIHVuZCBaYWhsZW4gamUgTmFtZSB3XHUwMEZDcmRlbiBkaWVcclxuICAvLyBaZWlsZSBzbyB2ZXJsXHUwMEU0bmdlcm4sIGRhc3MgYmVpIG1laHJlcmVuIFN1YnR5cGVuIG5pY2h0cyBtZWhyIGRhdm9uIHp1IGxlc2VuXHJcbiAgLy8gd1x1MDBFNHJlLiBSZWluZSBBbnplaWdlIC0gS2xpY2sgdW5kIFJlY2h0c2tsaWNrIGdlaFx1MDBGNnJlbiB3ZWl0ZXIgZGVyIGdhbnplblxyXG4gIC8vIFplaWxlIChEZXRhaWxhbnNpY2h0IGJ6dy4gU3VjaGUpLiBPYiBkaWUgTGlzdGUgbGlua3MgaGludGVyIGRlbSBOYW1lblxyXG4gIC8vIGJlZ2lubnQgb2RlciByZWNodHNiXHUwMEZDbmRpZyB2b3IgZGVyIEFuemFobCBlbmRldCwgaXN0IGhpZXIgYmV3dXNzdCBuaWNodFxyXG4gIC8vIGFiZ2VmcmFndDogZGFzIHNjaGFsdGV0IFN0eWxlIFNldHRpbmdzIFx1MDBGQ2JlciBlaW5lIGJvZHktS2xhc3NlIChzaWVoZSBkZW5cclxuICAvLyBAc2V0dGluZ3MtQmxvY2sgdW5kIC5mcmVkLXR5cC1saXN0LXN1YnR5cGVzIGluIHN0eWxlcy5jc3MpLCBkYXMgTWFya3VwXHJcbiAgLy8gYmxlaWJ0IGluIGJlaWRlbiBGXHUwMEU0bGxlbiBkYXNzZWxiZS5cclxuICByZW5kZXJTdWJ0eXBlUHJldmlldyhzZWxmLCB0eXBlKSB7XHJcbiAgICBjb25zdCBzdWJ0eXBlcyA9IGdldFN1YnR5cGVOYW1lcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSk7XHJcbiAgICBpZiAoc3VidHlwZXMubGVuZ3RoID09PSAwKSByZXR1cm47XHJcblxyXG4gICAgY29uc3QgY29sb3JpemUgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3Q7XHJcbiAgICBjb25zdCB3cmFwID0gc2VsZi5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLWxpc3Qtc3VidHlwZXNcIiB9KTtcclxuICAgIHdyYXAuYXBwZW5kVGV4dChcIihcIik7XHJcbiAgICBzdWJ0eXBlcy5mb3JFYWNoKChzdWJ0eXBlLCBpbmRleCkgPT4ge1xyXG4gICAgICBpZiAoaW5kZXggPiAwKSB3cmFwLmFwcGVuZFRleHQoXCIsIFwiKTtcclxuICAgICAgY29uc3Qgc3BhbiA9IHdyYXAuY3JlYXRlU3Bhbih7IHRleHQ6IHN1YnR5cGUgfSk7XHJcbiAgICAgIGlmIChjb2xvcml6ZSkgc3Bhbi5zdHlsZS5jb2xvciA9IG5hbWVDb2xvcih0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSkuY29sb3I7XHJcbiAgICB9KTtcclxuICAgIHdyYXAuYXBwZW5kVGV4dChcIilcIik7XHJcbiAgfVxyXG5cclxuICByZW5kZXJVbnJlZ2lzdGVyZWRJdGVtKHR5cGUsIGNvdW50KSB7XHJcbiAgICBjb25zdCB0cmVlSXRlbSA9IHRoaXMubGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW1cIiB9KTtcclxuICAgIGNvbnN0IHNlbGYgPSB0cmVlSXRlbS5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLXNlbGYgaXMtY2xpY2thYmxlIGZyZWQtdHlwLXVucmVnaXN0ZXJlZFwiIH0pO1xyXG4gICAgc2VsZi5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLWlubmVyXCIsIHRleHQ6IGRpc3BsYXlUeXBlS2V5KHR5cGUpIH0pO1xyXG4gICAgdGhpcy5yZW5kZXJDb3VudEZsYWlyKHNlbGYsIGNvdW50KTtcclxuXHJcbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnJlZ2lzdGVyVHlwZSh0eXBlKSk7XHJcbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcclxuICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgIHRoaXMub3BlblNlYXJjaCh0eXBlKTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcmVuZGVyVHlwZVNldHRpbmdzKHR5cGUpIHtcclxuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xyXG4gICAgY29udGVudEVsLmVtcHR5KCk7XHJcblxyXG4gICAgY29uc3QgaGVhZGVyID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtaGVhZGVyXCIgfSk7XHJcbiAgICBjb25zdCBiYWNrQnRuID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1iYWNrXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiWnVyXHUwMEZDY2tcIiB9IH0pO1xyXG4gICAgc2V0SWNvbihiYWNrQnRuLCBcImFycm93LWxlZnRcIik7XHJcbiAgICBiYWNrQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlVHlwZVNldHRpbmdzKCkpO1xyXG5cclxuICAgIGNvbnN0IHRpdGxlRWwgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC10aXRsZVwiLCB0ZXh0OiB0eXBlIH0pO1xyXG4gICAgY29uc3QgdGl0bGVDb2xvciA9IHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdCA/IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV0gOiBudWxsO1xyXG4gICAgaWYgKHRpdGxlQ29sb3IpIHRpdGxlRWwuc3R5bGUuY29sb3IgPSB0aXRsZUNvbG9yO1xyXG5cclxuICAgIGNvbnN0IHsgY291bnRzIH0gPSB0aGlzLnBsdWdpbi50eXBJbmRleC50eXBlQ291bnRzKCk7XHJcbiAgICBoZWFkZXIuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtY291bnRcIiwgdGV4dDogU3RyaW5nKGNvdW50cy5nZXQodHlwZSkgPz8gMCkgfSk7XHJcblxyXG4gICAgLy8gTGlua3MgbmViZW4gZGVtIG5vcm1hbGVuIFVtYmVuZW5uZW4tQnV0dG9uLCBoZXJ2b3JnZWhvYmVuIChBa3plbnRmYXJiZSxcclxuICAgIC8vIHNpZWhlIHN0eWxlcy5jc3MpIC0gaW0gR2VnZW5zYXR6IHp1IGRpZXNlbSBzY2hyZWlidCBkaWVzZSBWYXJpYW50ZSBiZWltXHJcbiAgICAvLyBVbWJlbmVubmVuIHp1c1x1MDBFNHR6bGljaCBkZW4gVFlQLVdlcnQgYWxsZXIgYmV0cm9mZmVuZW4gTm90aXplbiB1bSAobmFjaFxyXG4gICAgLy8gQmVzdFx1MDBFNHRpZ3VuZywgc2llaGUgc3RhcnREZXRhaWxSZW5hbWUvQ29uZmlybVJlbmFtZVR5cGVNb2RhbCkuXHJcbiAgICBjb25zdCByZW5hbWVXaXRoTm90ZXNCdG4gPSBoZWFkZXIuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWRldGFpbC1yZW5hbWUtbm90ZXNcIixcclxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJVbWJlbmVubmVuIChpbmtsLiBOb3RpemVuIGFucGFzc2VuKVwiIH0sXHJcbiAgICB9KTtcclxuICAgIHNldEljb24ocmVuYW1lV2l0aE5vdGVzQnRuLCBcInBlbmNpbFwiKTtcclxuICAgIHJlbmFtZVdpdGhOb3Rlc0J0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5zdGFydERldGFpbFJlbmFtZSh0eXBlLCB0aXRsZUVsLCB7IHVwZGF0ZU5vdGVzOiB0cnVlIH0pKTtcclxuXHJcbiAgICBjb25zdCByZW5hbWVCdG4gPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWRldGFpbC1yZW5hbWVcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJVbWJlbmVubmVuXCIgfSB9KTtcclxuICAgIHNldEljb24ocmVuYW1lQnRuLCBcInBlbmNpbFwiKTtcclxuICAgIHJlbmFtZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5zdGFydERldGFpbFJlbmFtZSh0eXBlLCB0aXRsZUVsKSk7XHJcblxyXG4gICAgY29uc3QgZGVsZXRlQnRuID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1kZXRhaWwtZGVsZXRlXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiTFx1MDBGNnNjaGVuXCIgfSB9KTtcclxuICAgIHNldEljb24oZGVsZXRlQnRuLCBcInRyYXNoXCIpO1xyXG4gICAgZGVsZXRlQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnNob3dEZWxldGVDb25maXJtKHR5cGUpKTtcclxuXHJcbiAgICBjb25zdCBib2R5ID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtYm9keVwiIH0pO1xyXG5cclxuICAgIGNvbnN0IGRlc2NTZWN0aW9uID0gYm9keS5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZGVzY3JpcHRpb24tc2VjdGlvblwiIH0pO1xyXG5cclxuICAgIGNvbnN0IG9wdGlvbnNIZWFkZXIgPSBkZXNjU2VjdGlvbi5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItaGVhZGVyIGZyZWQtdHlwLW9wdGlvbnMtaGVhZGVyXCIgfSk7XHJcbiAgICBjb25zdCBtYW51YWxUb2dnbGVXcmFwID0gb3B0aW9uc0hlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtbWFudWFsLXRvZ2dsZVwiIH0pO1xyXG4gICAgbWFudWFsVG9nZ2xlV3JhcC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIsIHRleHQ6IFwiTWFudWVsbGVyIFRZUFwiIH0pO1xyXG4gICAgdGhpcy5yZW5kZXJNYW51YWxUb2dnbGUobWFudWFsVG9nZ2xlV3JhcCwgdHlwZSk7XHJcblxyXG4gICAgY29uc3QgY29sb3JSb3cgPSBvcHRpb25zSGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtY29sb3Itcm93XCIgfSk7XHJcbiAgICB0aGlzLnJlbmRlckNvbG9yUGlja2VyKFxyXG4gICAgICBjb2xvclJvdyxcclxuICAgICAgdHlwZSxcclxuICAgICAgKG5ld0NvbG9yKSA9PiB7XHJcbiAgICAgICAgaWYgKCF0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3QpIHJldHVybjtcclxuICAgICAgICB0aXRsZUVsLnN0eWxlLmNvbG9yID0gbmV3Q29sb3I7XHJcbiAgICAgIH0sXHJcbiAgICAgIHsgc2hvd1Jlc2V0OiB0cnVlIH1cclxuICAgICk7XHJcblxyXG4gICAgY29uc3QgZGVzY0hlYWRlciA9IGRlc2NTZWN0aW9uLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1mcm9udG1hdHRlci1oZWFkZXJcIiB9KTtcclxuICAgIGRlc2NIZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIsIHRleHQ6IFwiQmVzY2hyZWlidW5nXCIgfSk7XHJcblxyXG4gICAgY29uc3QgZGVzY0lucHV0ID0gZGVzY1NlY3Rpb24uY3JlYXRlRWwoXCJ0ZXh0YXJlYVwiLCB7XHJcbiAgICAgIGNsczogXCJmcmVkLXR5cC1kZXNjcmlwdGlvbi1pbnB1dFwiLFxyXG4gICAgICBhdHRyOiB7IHJvd3M6IFwiMlwiIH0sXHJcbiAgICB9KTtcclxuICAgIGRlc2NJbnB1dC52YWx1ZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV0gPz8gXCJcIjtcclxuICAgIGRlc2NJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgdmFsdWUgPSBkZXNjSW5wdXQudmFsdWUudHJpbSgpO1xyXG4gICAgICBpZiAodmFsdWUpIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV0gPSB2YWx1ZTtcclxuICAgICAgZWxzZSBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXTtcclxuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBUcmVubnQgZGllIEZyb250bWF0dGVyLUJsXHUwMEY2Y2tlIHZvbiBkZW4gXHUwMEZDYnJpZ2VuIEVpbnN0ZWxsdW5nZW4gZGVzIFRZUHMuXHJcbiAgICAvLyBib2R5LmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtc2VwYXJhdG9yXCIgfSk7XHJcblxyXG4gICAgLy8gVFlQLUZyb250bWF0dGVyIHVuZCBqZSByZWdpc3RyaWVydGVtIFN1YnR5cCBlaW4gQmxvY2sgZGFydW50ZXIsIGplZGVyXHJcbiAgICAvLyBtaXQgZWlnZW5lciBFZGl0b3ItSW5zdGFueiAoc2llaGUgZnJvbnRtYXR0ZXItYmxvY2tzLmpzKSAtIGRlcnNlbGJlIEtleVxyXG4gICAgLy8gZGFyZiBkZXNoYWxiIGluIG1laHJlcmVuIEJsXHUwMEY2Y2tlbiBzdGVoZW4uIEVpbiBTdWJ0eXAtQmxvY2sgZXJnXHUwMEU0bnp0IGRhc1xyXG4gICAgLy8gVFlQLUZyb250bWF0dGVyIGZcdTAwRkNyIE5vdGl6ZW4gbWl0IGRpZXNlbSBTVUJUWVAgdW5kIFx1MDBGQ2JlcnNjaHJlaWJ0IGRvcnRcclxuICAgIC8vIGdsZWljaG5hbWlnZSBQcm9wZXJ0aWVzIChzaWVoZSBzdWJ0eXBlcy5qcykuXHJcbiAgICBjb25zdCBidWNrZXQgPSB0aGlzLnBsdWdpbi50eXBJbmRleC5zdWJ0eXBlQnVja2V0KHR5cGUpO1xyXG4gICAgdGhpcy5mcm9udG1hdHRlckJsb2NrcyA9IG1vdW50RnJvbnRtYXR0ZXJCbG9ja3ModGhpcywgYm9keSwgdHlwZSwge1xyXG4gICAgICByZW5kZXJIZWFkZXI6IChzZWN0aW9uLCBlbCwgYmxvY2tzKSA9PiB0aGlzLnJlbmRlclNlY3Rpb25IZWFkZXIoZWwsIHR5cGUsIHNlY3Rpb24sIGJ1Y2tldCwgYmxvY2tzKSxcclxuICAgICAgcmVuZGVyRm9vdGVyOiAoc2VjdGlvbiwgZWwpID0+IHtcclxuICAgICAgICBpZiAoc2VjdGlvbiAhPT0gbnVsbCkgdGhpcy5yZW5kZXJTZWN0aW9uRm9vdGVyKGVsLCB0eXBlLCBzZWN0aW9uKTtcclxuICAgICAgfSxcclxuICAgICAgb25Nb3ZlU2VjdGlvbjogYXN5bmMgKG9yZGVyKSA9PiB7XHJcbiAgICAgICAgcmVvcmRlclN1YnR5cGVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlLCBvcmRlcik7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgdGhpcy5yZW5kZXIoKTtcclxuICAgICAgfSxcclxuICAgICAgb25TZWN0aW9uQ29udGV4dE1lbnU6IChzZWN0aW9uKSA9PiB0aGlzLm9wZW5TdWJ0eXBlU2VhcmNoKHR5cGUsIHNlY3Rpb24pLFxyXG4gICAgfSk7XHJcbiAgICB0aGlzLmZyb250bWF0dGVyRWRpdG9ycy5wdXNoKC4uLnRoaXMuZnJvbnRtYXR0ZXJCbG9ja3MuZWRpdG9ycyk7XHJcblxyXG4gICAgLy8gQmV3dXNzdCBcdTAwRkNiZXIgZGllIHZvbGxlIEJyZWl0ZSB1bmQgaW4gQWt6ZW50ZmFyYmUsIGRhbWl0IGVyIHNpY2ggdm9uIGRlblxyXG4gICAgLy8ga2xlaW5lbiBJY29uLUJ1dHRvbnMgZGVyIEJsXHUwMEY2Y2tlIGFiaGVidC5cclxuICAgIHRoaXMuc3VidHlwZUFkZEJ0bkVsID0gYm9keS5jcmVhdGVFbChcImJ1dHRvblwiLCB7IGNsczogXCJtb2QtY3RhIGZyZWQtdHlwLXN1YnR5cGUtYWRkXCIgfSk7XHJcbiAgICBzZXRJY29uKHRoaXMuc3VidHlwZUFkZEJ0bkVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtc3VidHlwZS1hZGQtaWNvblwiIH0pLCBcInBsdXNcIik7XHJcbiAgICB0aGlzLnN1YnR5cGVBZGRCdG5FbC5jcmVhdGVTcGFuKHsgdGV4dDogXCJTdWJ0eXAgaGluenVmXHUwMEZDZ2VuXCIgfSk7XHJcbiAgICB0aGlzLnN1YnR5cGVBZGRCdG5FbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5zdGFydEFkZFN1YnR5cGUodHlwZSkpO1xyXG5cclxuICAgIHRoaXMucmVuZGVyVW5yZWdpc3RlcmVkU3VidHlwZXMoYm9keSwgdHlwZSwgYnVja2V0KTtcclxuXHJcbiAgICBib2R5LmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtc2VwYXJhdG9yXCIgfSk7XHJcbiAgICB0aGlzLnJlbmRlckZsb2F0aW5nSGludChib2R5KTtcclxuICAgIC8vIEZldHQtTWFya2llcnVuZyAoc2llaGUgZnJvbnRtYXR0ZXItZGVmYXVsdC1oaWdobGlnaHQuanMpIHJlYWdpZXJ0IG51ciBhdWZcclxuICAgIC8vIE1ldGFkYXRlbi0vTGF5b3V0LUV2ZW50cyAtIGRhcyBcdTAwRDZmZm5lbiBkaWVzZXIgRGV0YWlsYW5zaWNodCBzZWxic3QgbFx1MDBGNnN0XHJcbiAgICAvLyBrZWlucyBkYXZvbiBhdXMsIGRhaGVyIGhpZXIgZGlyZWt0IG5hY2ggZGVtIE1vdW50ZW4gYW5zdG9cdTAwREZlbi4gQmV3dXNzdFxyXG4gICAgLy8gbnVyIGRpZXNlciBlaW5lLCBnZXppZWx0ZSBSZWZyZXNoIHN0YXR0IGRlcyB2b2xsZW4gcmVmcmVzaFR5cENvbG9ycygpLVxyXG4gICAgLy8gQlx1MDBGQ25kZWxzOiBkYXMgd1x1MDBGQ3JkZSB1LiBhLiBhdWNoIHJlbmRlcigpIGF1ZiBkaWVzZW0gKGdlcmFkZSBlcnN0IG1pdHRlblxyXG4gICAgLy8gaW0gZWlnZW5lbiByZW5kZXIoKS1EdXJjaGxhdWYgYmVmaW5kbGljaGVuKSBWaWV3IGVybmV1dCBhdXNsXHUwMEY2c2VuLlxyXG4gICAgdGhpcy5wbHVnaW4ucmVmcmVzaEZyb250bWF0dGVySGlnaGxpZ2h0Py4oKTtcclxuICB9XHJcblxyXG4gIC8vIFx1MDBEQ2JlcnNjaHJpZnQgZWluZXMgQmxvY2tzIChzaWVoZSBmcm9udG1hdHRlci1ibG9ja3MuanMpOiBUaXRlbCBtaXRcclxuICAvLyBOb3Rpei1BbnphaGwgKGJlaW0gVFlQLUZyb250bWF0dGVyIGRpZSBOb3RpemVuIG9obmUgU1VCVFlQIC0gZlx1MDBGQ3IgZGllIGdpbHRcclxuICAvLyBudXIgZGllc2VyIEJsb2NrKSwgU3VjaGUgcGVyIFJlY2h0c2tsaWNrIChiZWltIFRZUC1Gcm9udG1hdHRlciBhdWYgZGVuXHJcbiAgLy8gVGl0ZWwpLCB1bmQgZGllIGJlaWRlbiBcIlByb3BlcnR5IGhpbnp1Zlx1MDBGQ2dlblwiLUJ1dHRvbnMsIGRpZSBlaW5lIExlZXJ6ZWlsZVxyXG4gIC8vIGluIGdlbmF1IGRpZXNlbSBCbG9jayBhbmxlZ2VuLlxyXG4gIHJlbmRlclNlY3Rpb25IZWFkZXIoZWwsIHR5cGUsIHNlY3Rpb24sIGJ1Y2tldCwgYmxvY2tzKSB7XHJcbiAgICBjb25zdCB0aXRsZUdyb3VwID0gZWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLXRpdGxlLWdyb3VwXCIgfSk7XHJcbiAgICAvLyBCZXd1c3N0IG5pZSBlaW5nZWZcdTAwRTRyYnQgKHdlZGVyIGluIGRlciBUWVAtIG5vY2ggaW4gZGVyIFN1YnR5cC1GYXJiZSksXHJcbiAgICAvLyBhbmRlcnMgYWxzIGRlciBUaXRlbCBkZXIgRGV0YWlsYW5zaWNodCBkYXJcdTAwRkNiZXI6IGRpZSBGYXJiZSBlaW5lcyBCbG9ja3NcclxuICAgIC8vIHN0ZWh0IGltIEZhcmJwdW5rdCBzZWluZXMgQWJzY2hsdXNzZXMgKHNpZWhlIHJlbmRlclNlY3Rpb25Gb290ZXIpLlxyXG4gICAgY29uc3QgdGl0bGVFbCA9IHRpdGxlR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIsIHRleHQ6IHNlY3Rpb24gPz8gYCR7dHlwZX0tRnJvbnRtYXR0ZXJgIH0pO1xyXG4gICAgY29uc3QgY291bnQgPSBzZWN0aW9uID09PSBudWxsID8gYnVja2V0Lm5vU3VidHlwZSA6IGJ1Y2tldC5jb3VudHMuZ2V0KHNlY3Rpb24pID8/IDA7XHJcbiAgICB0aXRsZUdyb3VwLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtc3VidHlwZS1jb3VudFwiLCB0ZXh0OiBTdHJpbmcoY291bnQpIH0pO1xyXG4gICAgLy8gU3VidHlwLUJsXHUwMEY2Y2tlIHJlYWdpZXJlbiBhdWYgaWhyZXIgZ2FuemVuIEZsXHUwMEU0Y2hlIChzaWVoZVxyXG4gICAgLy8gb25TZWN0aW9uQ29udGV4dE1lbnUgaW4gcmVuZGVyVHlwZVNldHRpbmdzKSwgZGFzIFRZUC1Gcm9udG1hdHRlclxyXG4gICAgLy8gbnVyIGF1ZiBkZW0gVGl0ZWwuXHJcbiAgICBpZiAoc2VjdGlvbiA9PT0gbnVsbCkge1xyXG4gICAgICB0aXRsZUVsLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcclxuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgIHRoaXMub3BlblN1YnR5cGVTZWFyY2godHlwZSwgbnVsbCk7XHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEZsb2F0aW5nIFByb3BlcnRpZXMgKHNpZWhlIHR5cGVGbG9hdGluZ0tleXMgaW4gc2V0dGluZ3MuanMpIHNpbmQgVGVpbFxyXG4gICAgLy8gZGVyc2VsYmVuIExpc3RlIHVuZCBSZWloZW5mb2xnZSB3aWUgZGllIFx1MDBGQ2JyaWdlbiBQcm9wZXJ0aWVzICh3aWNodGlnIGZcdTAwRkNyXHJcbiAgICAvLyBkaWUgRnJvbnRtYXR0ZXItU29ydGllcnVuZyksIGxhbmRlbiBhbHNvIGFuIGdlbmF1IGRlciBTdGVsbGUsIGFuIGRpZSBzaWVcclxuICAgIC8vIHBlciBEcmFnICYgRHJvcCBlaW5zb3J0aWVydCB3ZXJkZW4sIHN0YXR0IGZlc3QgYW5zIEVuZGUgZWluZXIgendlaXRlbiBMaXN0ZS5cclxuICAgIGNvbnN0IGFkZEJ1dHRvbnMgPSBlbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItYWRkLWdyb3VwXCIgfSk7XHJcblxyXG4gICAgLy8gTGlua3MgbmViZW4gZGVtIG5vcm1hbGVuIEJ1dHRvbiwgaGVydm9yZ2Vob2JlbiAoQWt6ZW50ZmFyYmUsIHdpZVxyXG4gICAgLy8gcmVuYW1lV2l0aE5vdGVzQnRuIG9iZW4pIC0gbWFya2llcnQgZGllIGFscyBuXHUwMEU0Y2hzdGVzIGhpbnp1Z2VmXHUwMEZDZ3RlIChiencuXHJcbiAgICAvLyBiaXMgenVtIG5cdTAwRTRjaHN0ZW4gU3BlaWNoZXJuIHVtYmVuYW5udGUpIFByb3BlcnR5IGFscyBGbG9hdGluZywgc3RhdHQgc2llXHJcbiAgICAvLyBhbHMgbm9ybWFsZSBTdGFuZGFyZC1Qcm9wZXJ0eSBhbnp1bGVnZW4gKHNpZWhlIGVkaXRvci5mcmVkUGVuZGluZ0Zsb2F0aW5nQWRkXHJcbiAgICAvLyBpbiB0eXBlLWZyb250bWF0dGVyLWVkaXRvci5qcykuIEZsb2F0aW5nIFByb3BlcnRpZXMgd2VyZGVuIE5JQ0hUXHJcbiAgICAvLyBhdXRvbWF0aXNjaCBiZWkgbmV1ZW4gTm90aXplbiBhbmdlbGVndCAoc2llaGUgZ2V0VHlwZURlZmF1bHRzKCkgaW5cclxuICAgIC8vIG1haW4uanMpIHVuZCBkb3J0LCBzb2JhbGQgZG9jaCB2b3JoYW5kZW4sIGt1cnNpdiBzdGF0dCBmZXR0IGRhcmdlc3RlbGx0XHJcbiAgICAvLyAoc2llaGUgZnJvbnRtYXR0ZXItZGVmYXVsdC1oaWdobGlnaHQuanMpLlxyXG4gICAgY29uc3QgYWRkRmxvYXRpbmdQcm9wZXJ0eUJ0biA9IGFkZEJ1dHRvbnMuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWZyb250bWF0dGVyLWFkZC1mbG9hdGluZ1wiLFxyXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkZsb2F0aW5nIFByb3BlcnR5IGhpbnp1Zlx1MDBGQ2dlblwiIH0sXHJcbiAgICB9KTtcclxuICAgIHNldEljb24oYWRkRmxvYXRpbmdQcm9wZXJ0eUJ0biwgXCJwbHVzXCIpO1xyXG4gICAgYWRkRmxvYXRpbmdQcm9wZXJ0eUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gYmxvY2tzLmFkZEJsYW5rKHNlY3Rpb24sIHRydWUpKTtcclxuXHJcbiAgICBjb25zdCBhZGRQcm9wZXJ0eUJ0biA9IGFkZEJ1dHRvbnMuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWZyb250bWF0dGVyLWFkZFwiLFxyXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlByb3BlcnR5IGhpbnp1Zlx1MDBGQ2dlblwiIH0sXHJcbiAgICB9KTtcclxuICAgIHNldEljb24oYWRkUHJvcGVydHlCdG4sIFwicGx1c1wiKTtcclxuICAgIGFkZFByb3BlcnR5QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiBibG9ja3MuYWRkQmxhbmsoc2VjdGlvbiwgZmFsc2UpKTtcclxuICB9XHJcblxyXG4gIC8vIEFic2NobHVzcyBlaW5lcyBTdWJ0eXAtQmxvY2tzOiBsaW5rcyBkaWUgRmFyYmUgZGVzIFN1YnR5cHMgKEZhcmJwdW5rdCwgZGVyXHJcbiAgLy8gZGllIFJlZ2xlciBcdTAwRjZmZm5ldCwgZGFuZWJlbiBadXJcdTAwRkNja3NldHplbiksIHJlY2h0cyBkaWUgQWt0aW9uZW4gd2llIGltIEtvcGZcclxuICAvLyBkZXIgVFlQLURldGFpbGFuc2ljaHQgKFVtYmVuZW5uZW4gaW5rbC4gTm90aXplbiwgVW1iZW5lbm5lbiwgTFx1MDBGNnNjaGVuKS4gRGFzXHJcbiAgLy8gVFlQLUZyb250bWF0dGVyIGhhdCBrZWluZW4uIERlciBUaXRlbCB3aXJkIGVyc3QgYmVpbSBLbGljayBnZXN1Y2h0IC1cclxuICAvLyBcdTAwRENiZXJzY2hyaWZ0IHVuZCBBYnNjaGx1c3MgZW50c3RlaGVuIGJlaSBqZWRlbSBzeW5jaHJvbml6ZSgpIG5ldS5cclxuICByZW5kZXJTZWN0aW9uRm9vdGVyKGVsLCB0eXBlLCBzdWJ0eXBlKSB7XHJcbiAgICBlbC5hZGRDbGFzcyhcImZyZWQtdHlwLXN1YnR5cGUtYWN0aW9uc1wiKTtcclxuICAgIGNvbnN0IGNvbG9yR3JvdXAgPSBlbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtc3VidHlwZS1jb2xvci1ncm91cFwiIH0pO1xyXG4gICAgLy8gUmluZyBhdWNoLCBzb2xhbmdlIGRlciBUWVAgc2VsYnN0IGtlaW5lIEZhcmJlIGhhdCAtIGRhbm4gZlx1MDBFNHJidCBhdWNoXHJcbiAgICAvLyBlaW5lIGVpbmdlc3RlbGx0ZSBBYndlaWNodW5nIG5pcmdlbmRzIGVpbi5cclxuICAgIGNvbnN0IG93bkNvbG9yID0gc3VidHlwZUhhc093bkNvbG9yKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKTtcclxuICAgIGNvbnN0IHR5cGVIYXNDb2xvciA9ICEhdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXTtcclxuICAgIGNvbnN0IGNvbG9yRG90ID0gY29sb3JHcm91cC5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwiZnJlZC10eXAtc3VidHlwZS1jb2xvci1kb3RcIixcclxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogIXR5cGVIYXNDb2xvciA/IFwiVFlQIGhhdCBrZWluZSBGYXJiZVwiIDogb3duQ29sb3IgPyBcIkZhcmJlIGFucGFzc2VuXCIgOiBcIlx1MDBEQ2Jlcm5pbW10IFRZUC1GYXJiZVwiIH0sXHJcbiAgICB9KTtcclxuICAgIGNvbG9yRG90LmZyZWRTdWJ0eXBlID0gc3VidHlwZTtcclxuICAgIHBhaW50Q29sb3JEb3QoY29sb3JEb3QsIHN1YnR5cGVDb2xvcih0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSkgPz8gREVGQVVMVF9UWVBFX0NPTE9SLCAhb3duQ29sb3IgfHwgIXR5cGVIYXNDb2xvcik7XHJcbiAgICBjb2xvckRvdC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5vcGVuU3VidHlwZUNvbG9yUG9wb3Zlcihjb2xvckRvdCwgdHlwZSwgc3VidHlwZSkpO1xyXG4gICAgY29uc3QgcmVzZXRCdG4gPSBjb2xvckdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1jb2xvci1yZXNldFwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkZhcmJlIHp1clx1MDBGQ2Nrc2V0emVuXCIgfSB9KTtcclxuICAgIHJlc2V0QnRuLnRvZ2dsZUNsYXNzKFwiaXMtZGlzYWJsZWRcIiwgIW93bkNvbG9yKTtcclxuICAgIHNldEljb24ocmVzZXRCdG4sIFwicm90YXRlLWNjd1wiKTtcclxuICAgIHJlc2V0QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGRhdGEgPSBnZXRTdWJ0eXBlKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKTtcclxuICAgICAgaWYgKCFkYXRhPy5jb2xvcikgcmV0dXJuO1xyXG4gICAgICBkZWxldGUgZGF0YS5jb2xvcjtcclxuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgICB0aGlzLnJlbmRlcigpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgYWN0aW9ucyA9IGVsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1zdWJ0eXBlLWFjdGlvbi1ncm91cFwiIH0pO1xyXG4gICAgY29uc3QgdGl0bGVFbCA9ICgpID0+IHtcclxuICAgICAgbGV0IHNpYmxpbmcgPSBlbC5wcmV2aW91c0VsZW1lbnRTaWJsaW5nO1xyXG4gICAgICB3aGlsZSAoc2libGluZyAmJiAhc2libGluZy5oYXNDbGFzcyhcImZyZWQtdHlwLXNlY3Rpb24taGVhZGVyXCIpKSBzaWJsaW5nID0gc2libGluZy5wcmV2aW91c0VsZW1lbnRTaWJsaW5nO1xyXG4gICAgICByZXR1cm4gc2libGluZz8ucXVlcnlTZWxlY3RvcihcIi5mcmVkLXR5cC1kZXRhaWwtc2VjdGlvbi10aXRsZVwiKSA/PyBudWxsO1xyXG4gICAgfTtcclxuICAgIGNvbnN0IHJlbmFtZSA9ICh1cGRhdGVOb3RlcykgPT4ge1xyXG4gICAgICBjb25zdCB0YXJnZXQgPSB0aXRsZUVsKCk7XHJcbiAgICAgIGlmICh0YXJnZXQpIHRoaXMuc3RhcnRTdWJ0eXBlUmVuYW1lKHR5cGUsIHN1YnR5cGUsIHRhcmdldCwgeyB1cGRhdGVOb3RlcyB9KTtcclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgcmVuYW1lV2l0aE5vdGVzQnRuID0gYWN0aW9ucy5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gZnJlZC10eXAtZGV0YWlsLXJlbmFtZS1ub3Rlc1wiLFxyXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlVtYmVuZW5uZW4gKGlua2wuIE5vdGl6ZW4gYW5wYXNzZW4pXCIgfSxcclxuICAgIH0pO1xyXG4gICAgc2V0SWNvbihyZW5hbWVXaXRoTm90ZXNCdG4sIFwicGVuY2lsXCIpO1xyXG4gICAgcmVuYW1lV2l0aE5vdGVzQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiByZW5hbWUodHJ1ZSkpO1xyXG5cclxuICAgIGNvbnN0IHJlbmFtZUJ0biA9IGFjdGlvbnMuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWRldGFpbC1yZW5hbWVcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJVbWJlbmVubmVuXCIgfSB9KTtcclxuICAgIHNldEljb24ocmVuYW1lQnRuLCBcInBlbmNpbFwiKTtcclxuICAgIHJlbmFtZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gcmVuYW1lKGZhbHNlKSk7XHJcblxyXG4gICAgY29uc3QgZGVsZXRlQnRuID0gYWN0aW9ucy5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gZnJlZC10eXAtZGV0YWlsLWRlbGV0ZVwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkxcdTAwRjZzY2hlblwiIH0gfSk7XHJcbiAgICBzZXRJY29uKGRlbGV0ZUJ0biwgXCJ0cmFzaFwiKTtcclxuICAgIGRlbGV0ZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5kZWxldGVTdWJ0eXBlV2l0aENvbmZpcm0odHlwZSwgc3VidHlwZSkpO1xyXG4gIH1cclxuXHJcbiAgLy8gUG9wb3ZlciB1bnRlciBkZW0gRmFyYnB1bmt0IGVpbmVzIFN1YnR5cC1CbG9ja3M6IGplIGVpbiBSZWdsZXIgZlx1MDBGQ3JcclxuICAvLyBGYXJidG9uLCBTXHUwMEU0dHRpZ3VuZyB1bmQgSGVsbGlna2VpdCwgYmVncmVuenQgYXVmIGRpZSBpbiBkZW4gRWluc3RlbGx1bmdlblxyXG4gIC8vIGZlc3RnZWxlZ3RlIEFid2VpY2h1bmcgKHNpZWhlIHR5cGUtY29sb3JzLmpzKS4gRGllIExlaXN0ZSBqZWRlcyBSZWdsZXJzXHJcbiAgLy8gemVpZ3QgYWxzIFZlcmxhdWYgZGllIEZhcmJlbiwgZGllIGVyIGVycmVpY2hlbiBrYW5uLiBCZWltIFppZWhlbiBcdTAwRTRuZGVydFxyXG4gIC8vIHNpY2ggbnVyIGRlciBGYXJicHVua3QgaGllcjsgZ2VzcGVpY2hlcnQgdW5kIGluIGRpZSBcdTAwRkNicmlnZW4gQW5zaWNodGVuXHJcbiAgLy8gXHUwMEZDYmVybm9tbWVuIHdpcmQgYmVpbSBTY2hsaWVcdTAwREZlbiAoS2xpY2sgZGFuZWJlbiBvZGVyIEVzY2FwZSkgLSBlaW5cclxuICAvLyByZWZyZXNoVHlwQ29sb3JzKCkgcmVuZGVydCB1LiBhLiBkaWVzZSBBbnNpY2h0IG5ldS5cclxuICBvcGVuU3VidHlwZUNvbG9yUG9wb3ZlcihhbmNob3JFbCwgdHlwZSwgc3VidHlwZSkge1xyXG4gICAgdGhpcy5jbG9zZVN1YnR5cGVDb2xvclBvcG92ZXI/LigpO1xyXG4gICAgY29uc3QgeyBzZXR0aW5ncyB9ID0gdGhpcy5wbHVnaW47XHJcbiAgICBjb25zdCBkYXRhID0gZ2V0U3VidHlwZShzZXR0aW5ncywgdHlwZSwgc3VidHlwZSk7XHJcbiAgICBpZiAoIWRhdGEpIHJldHVybjtcclxuICAgIGNvbnN0IHR5cGVDb2xvciA9IHNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV0gPz8gREVGQVVMVF9UWVBFX0NPTE9SO1xyXG4gICAgLy8gT2huZSBlaWdlbmUgQWJ3ZWljaHVuZyBzdGVodCBqZWRlciBSZWdsZXIgYXVmIDAgLSB3ZWxjaGUgZXMgZ2lidCwgc2FndFxyXG4gICAgLy8gYWxsZWluIFNVQlRZUEVfQ09MT1JfQ0hBTk5FTFMgKHNpZWhlIHR5cGUtY29sb3JzLmpzKS5cclxuICAgIGNvbnN0IG9mZnNldCA9IGNsYW1wZWRPZmZzZXQoc2V0dGluZ3MsIGRhdGEuY29sb3IpID8/IE9iamVjdC5mcm9tRW50cmllcyhTVUJUWVBFX0NPTE9SX0NIQU5ORUxTLm1hcCgoeyBrZXkgfSkgPT4gW2tleSwgMF0pKTtcclxuICAgIGNvbnN0IGRvYyA9IGFuY2hvckVsLmRvYztcclxuICAgIGNvbnN0IHBvcG92ZXIgPSBkb2MuYm9keS5jcmVhdGVEaXYoeyBjbHM6IFwibWVudSBmcmVkLXR5cC1zdWJ0eXBlLWNvbG9yLXBvcG92ZXJcIiB9KTtcclxuXHJcbiAgICBjb25zdCByb3dzID0gW107XHJcbiAgICBjb25zdCB1cGRhdGUgPSAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGNvbG9yID0gYXBwbHlDb2xvck9mZnNldCh0eXBlQ29sb3IsIG9mZnNldCk7XHJcbiAgICAgIGZvciAoY29uc3QgZWwgb2YgdGhpcy5jb250ZW50RWwucXVlcnlTZWxlY3RvckFsbChcIi5mcmVkLXR5cC1zdWJ0eXBlLWNvbG9yLWRvdFwiKSkge1xyXG4gICAgICAgIGlmIChlbC5mcmVkU3VidHlwZSA9PT0gc3VidHlwZSkgcGFpbnRDb2xvckRvdChlbCwgY29sb3IsICFoYXNDb2xvck9mZnNldChvZmZzZXQpIHx8ICFzZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdKTtcclxuICAgICAgfVxyXG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSByb3coKTtcclxuICAgIH07XHJcblxyXG4gICAgZm9yIChjb25zdCB7IGtleSwgbGFiZWwsIHVuaXQgfSBvZiBTVUJUWVBFX0NPTE9SX0NIQU5ORUxTKSB7XHJcbiAgICAgIGNvbnN0IFttaW4sIG1heF0gPSBjaGFubmVsQm91bmRzKHNldHRpbmdzLCBrZXkpO1xyXG4gICAgICBjb25zdCByb3cgPSBwb3BvdmVyLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1zdWJ0eXBlLWNvbG9yLXJvd1wiIH0pO1xyXG4gICAgICByb3cuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1zdWJ0eXBlLWNvbG9yLWxhYmVsXCIsIHRleHQ6IGxhYmVsIH0pO1xyXG4gICAgICBjb25zdCBpbnB1dCA9IHJvdy5jcmVhdGVFbChcImlucHV0XCIsIHsgdHlwZTogXCJyYW5nZVwiLCBjbHM6IFwic2xpZGVyIGZyZWQtdHlwLXN1YnR5cGUtY29sb3Itc2xpZGVyXCIgfSk7XHJcbiAgICAgIGlucHV0Lm1pbiA9IFN0cmluZyhtaW4pO1xyXG4gICAgICBpbnB1dC5tYXggPSBTdHJpbmcobWF4KTtcclxuICAgICAgaW5wdXQuc3RlcCA9IFwiMVwiO1xyXG4gICAgICBpbnB1dC52YWx1ZSA9IFN0cmluZyhvZmZzZXRba2V5XSk7XHJcbiAgICAgIGlucHV0LmRpc2FibGVkID0gbWluID09PSBtYXg7XHJcbiAgICAgIGNvbnN0IHZhbHVlRWwgPSByb3cuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1zdWJ0eXBlLWNvbG9yLXZhbHVlXCIgfSk7XHJcbiAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJpbnB1dFwiLCAoKSA9PiB7XHJcbiAgICAgICAgb2Zmc2V0W2tleV0gPSBOdW1iZXIoaW5wdXQudmFsdWUpO1xyXG4gICAgICAgIHVwZGF0ZSgpO1xyXG4gICAgICB9KTtcclxuICAgICAgcm93cy5wdXNoKCgpID0+IHtcclxuICAgICAgICBjb25zdCBzdGVwcyA9IDg7XHJcbiAgICAgICAgY29uc3Qgc3RvcHMgPSBbXTtcclxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8PSBzdGVwczsgaSsrKSB7XHJcbiAgICAgICAgICBzdG9wcy5wdXNoKGFwcGx5Q29sb3JPZmZzZXQodHlwZUNvbG9yLCB7IC4uLm9mZnNldCwgW2tleV06IG1pbiArICgobWF4IC0gbWluKSAqIGkpIC8gc3RlcHMgfSkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpbnB1dC5zdHlsZS5zZXRQcm9wZXJ0eShcIi0tZnJlZC10cmFja1wiLCBgbGluZWFyLWdyYWRpZW50KHRvIHJpZ2h0LCAke3N0b3BzLmpvaW4oXCIsIFwiKX0pYCk7XHJcbiAgICAgICAgdmFsdWVFbC5zZXRUZXh0KGAke29mZnNldFtrZXldID4gMCA/IFwiK1wiIDogXCJcIn0ke29mZnNldFtrZXldfSR7dW5pdH1gKTtcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICB1cGRhdGUoKTtcclxuXHJcbiAgICAvLyBVbnRlciBkZW0gUHVua3QsIGFiZXIgaW5uZXJoYWxiIGRlcyBGZW5zdGVycy5cclxuICAgIGNvbnN0IHJlY3QgPSBhbmNob3JFbC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcclxuICAgIGNvbnN0IHdpbiA9IGRvYy5kZWZhdWx0VmlldztcclxuICAgIGNvbnN0IHdpZHRoID0gcG9wb3Zlci5vZmZzZXRXaWR0aDtcclxuICAgIGNvbnN0IGhlaWdodCA9IHBvcG92ZXIub2Zmc2V0SGVpZ2h0O1xyXG4gICAgcG9wb3Zlci5zdHlsZS5sZWZ0ID0gYCR7TWF0aC5tYXgoOCwgTWF0aC5taW4ocmVjdC5sZWZ0LCB3aW4uaW5uZXJXaWR0aCAtIHdpZHRoIC0gOCkpfXB4YDtcclxuICAgIHBvcG92ZXIuc3R5bGUudG9wID0gYCR7cmVjdC5ib3R0b20gKyA2ICsgaGVpZ2h0ID4gd2luLmlubmVySGVpZ2h0IC0gOCA/IHJlY3QudG9wIC0gNiAtIGhlaWdodCA6IHJlY3QuYm90dG9tICsgNn1weGA7XHJcblxyXG4gICAgY29uc3Qgb25Qb2ludGVyRG93biA9IChldmVudCkgPT4ge1xyXG4gICAgICBpZiAoIXBvcG92ZXIuY29udGFpbnMoZXZlbnQudGFyZ2V0KSkgY2xvc2UoKTtcclxuICAgIH07XHJcbiAgICBjb25zdCBvbktleURvd24gPSAoZXZlbnQpID0+IHtcclxuICAgICAgaWYgKGV2ZW50LmtleSAhPT0gXCJFc2NhcGVcIikgcmV0dXJuO1xyXG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgY2xvc2UoKTtcclxuICAgIH07XHJcbiAgICBjb25zdCBjbG9zZSA9IGFzeW5jICgpID0+IHtcclxuICAgICAgdGhpcy5jbG9zZVN1YnR5cGVDb2xvclBvcG92ZXIgPSBudWxsO1xyXG4gICAgICBkb2MucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNlZG93blwiLCBvblBvaW50ZXJEb3duLCB0cnVlKTtcclxuICAgICAgZG9jLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIG9uS2V5RG93biwgdHJ1ZSk7XHJcbiAgICAgIHBvcG92ZXIucmVtb3ZlKCk7XHJcbiAgICAgIGNvbnN0IGN1cnJlbnQgPSBnZXRTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKTtcclxuICAgICAgaWYgKCFjdXJyZW50KSByZXR1cm47XHJcbiAgICAgIGlmIChoYXNDb2xvck9mZnNldChvZmZzZXQpKSBjdXJyZW50LmNvbG9yID0geyAuLi5vZmZzZXQgfTtcclxuICAgICAgZWxzZSBkZWxldGUgY3VycmVudC5jb2xvcjtcclxuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgICB0aGlzLnJlbmRlcigpO1xyXG4gICAgfTtcclxuICAgIHRoaXMuY2xvc2VTdWJ0eXBlQ29sb3JQb3BvdmVyID0gY2xvc2U7XHJcbiAgICBkb2MuYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlZG93blwiLCBvblBvaW50ZXJEb3duLCB0cnVlKTtcclxuICAgIGRvYy5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCBvbktleURvd24sIHRydWUpO1xyXG4gIH1cclxuXHJcbiAgLy8gTFx1MDBGNnNjaHQgZGVuIFN1YnR5cC1CbG9jayBzYW10IHNlaW5lciBQcm9wZXJ0aWVzLiBEaWUgTm90aXplbiBiZWhhbHRlbiBpaHJlblxyXG4gIC8vIFNVQlRZUC1XZXJ0IChlciBlcnNjaGVpbnQgZGFuYWNoIHVudGVuIGFscyBuaWNodCBlcmZhc3N0ZXIgU3VidHlwKSAtIGVpbmVcclxuICAvLyBCZXN0XHUwMEU0dGlndW5nIGJyYXVjaHQgZXMgZGFoZXIgbnVyLCB3ZW5uIGRhYmVpIFByb3BlcnRpZXMgdmVybG9yZW4gZ2VoZW4uXHJcbiAgZGVsZXRlU3VidHlwZVdpdGhDb25maXJtKHR5cGUsIHN1YnR5cGUpIHtcclxuICAgIGNvbnN0IGFwcGx5ID0gYXN5bmMgKCkgPT4ge1xyXG4gICAgICBkZWxldGVTdWJ0eXBlKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKTtcclxuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgICB0aGlzLnJlbmRlcigpO1xyXG4gICAgfTtcclxuICAgIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyhnZXRTdWJ0eXBlKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKT8uZnJvbnRtYXR0ZXIgPz8ge30pLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwiXCIpO1xyXG4gICAgaWYgKGtleXMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgIGFwcGx5KCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIG5ldyBDb25maXJtU3VidHlwZU1vZGFsKHRoaXMuYXBwLCB7XHJcbiAgICAgIHBhcmFncmFwaHM6IFtcclxuICAgICAgICBgU3VidHlwICR7c3VidHlwZX0gdm9uICR7dHlwZX0gd2lya2xpY2ggbFx1MDBGNnNjaGVuP2AsXHJcbiAgICAgICAgYCR7a2V5cy5sZW5ndGggPT09IDEgPyBcIkRpZSBQcm9wZXJ0eVwiIDogYERpZSAke2tleXMubGVuZ3RofSBQcm9wZXJ0aWVzYH0gJHtrZXlzLmpvaW4oXCIsIFwiKX0gJHtrZXlzLmxlbmd0aCA9PT0gMSA/IFwiZ2VodFwiIDogXCJnZWhlblwifSBkYWJlaSB2ZXJsb3Jlbi5gLFxyXG4gICAgICBdLFxyXG4gICAgICBjb25maXJtVGV4dDogXCJMXHUwMEY2c2NoZW5cIixcclxuICAgICAgY29uZmlybUNsczogXCJtb2Qtd2FybmluZ1wiLFxyXG4gICAgICBvbkNvbmZpcm06IGFwcGx5LFxyXG4gICAgfSkub3BlbigpO1xyXG4gIH1cclxuXHJcbiAgLy8gV2llIHN0YXJ0RGV0YWlsUmVuYW1lKCksIGFiZXIgYXVmIGRlbSBUaXRlbCBlaW5lcyBTdWJ0eXAtQmxvY2tzLiBEZXIgQmxvY2tcclxuICAvLyBiZWhcdTAwRTRsdCBzZWluZSBQb3NpdGlvbjsgdXBkYXRlTm90ZXM6IHRydWUgc2NocmVpYnQgbmFjaCBCZXN0XHUwMEU0dGlndW5nIGF1Y2ggZGVuXHJcbiAgLy8gU1VCVFlQIGRlciBiZXRyb2ZmZW5lbiBOb3RpemVuIHVtLiBFaW4gYmVyZWl0cyB2b3JoYW5kZW5lciBOYW1lIGJpZXRldFxyXG4gIC8vIHN0YXR0ZGVzc2VuIGRhcyBadXNhbW1lbmxlZ2VuIGFuIChzY2hyZWlidCBkaWUgTm90aXplbiBpbW1lciBtaXQgdW0pLlxyXG4gIHN0YXJ0U3VidHlwZVJlbmFtZSh0eXBlLCBzdWJ0eXBlLCB0aXRsZUVsLCB7IHVwZGF0ZU5vdGVzID0gZmFsc2UgfSA9IHt9KSB7XHJcbiAgICBpZiAodGhpcy5pc0VkaXRpbmcpIHJldHVybjtcclxuICAgIHRoaXMuaXNFZGl0aW5nID0gdHJ1ZTtcclxuXHJcbiAgICB0aXRsZUVsLmFkZENsYXNzKFwiZnJlZC10eXAtc3VidHlwZS1uYW1lLWlucHV0XCIsIFwiaXMtYmVpbmctcmVuYW1lZFwiKTtcclxuICAgIHRpdGxlRWwuc2V0QXR0cmlidXRlKFwiY29udGVudGVkaXRhYmxlXCIsIFwidHJ1ZVwiKTtcclxuICAgIHRpdGxlRWwuc2V0QXR0cmlidXRlKFwic3BlbGxjaGVja1wiLCBcImZhbHNlXCIpO1xyXG4gICAgdGl0bGVFbC5mb2N1cygpO1xyXG5cclxuICAgIGNvbnN0IHJhbmdlID0gdGl0bGVFbC5kb2MuY3JlYXRlUmFuZ2UoKTtcclxuICAgIHJhbmdlLnNlbGVjdE5vZGVDb250ZW50cyh0aXRsZUVsKTtcclxuICAgIGNvbnN0IHNlbGVjdGlvbiA9IHRpdGxlRWwud2luLmdldFNlbGVjdGlvbigpO1xyXG4gICAgc2VsZWN0aW9uLnJlbW92ZUFsbFJhbmdlcygpO1xyXG4gICAgc2VsZWN0aW9uLmFkZFJhbmdlKHJhbmdlKTtcclxuXHJcbiAgICBjb25zdCBjb3VudE9mID0gKG5hbWUpID0+IHRoaXMucGx1Z2luLnR5cEluZGV4LnN1YnR5cGVCdWNrZXQodHlwZSkuY291bnRzLmdldChuYW1lKSA/PyAwO1xyXG4gICAgY29uc3QgYXBwbHlSZW5hbWUgPSBhc3luYyAodmFsdWUsIHsgd2l0aE5vdGVzIH0pID0+IHtcclxuICAgICAgcmVuYW1lU3VidHlwZSh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSwgdmFsdWUpO1xyXG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgY29uc3QgcmVuYW1lZCA9IHdpdGhOb3RlcyA/IGF3YWl0IHJlbmFtZVN1YnR5cGVJbk5vdGVzKHRoaXMucGx1Z2luLCB0eXBlLCBzdWJ0eXBlLCB2YWx1ZSkgOiAwO1xyXG4gICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgICAgaWYgKHdpdGhOb3RlcykgbmV3IE5vdGljZShgU1VCVFlQICR7dmFsdWV9OiAke3JlbmFtZWR9IE5vdGl6KGVuKSBhbmdlcGFzc3QuYCk7XHJcbiAgICAgIHRoaXMucmVuZGVyKCk7XHJcbiAgICB9O1xyXG5cclxuICAgIGxldCBkb25lID0gZmFsc2U7XHJcbiAgICBjb25zdCBmaW5pc2ggPSBhc3luYyAoY29tbWl0KSA9PiB7XHJcbiAgICAgIGlmIChkb25lKSByZXR1cm47XHJcbiAgICAgIGRvbmUgPSB0cnVlO1xyXG4gICAgICB0aGlzLmlzRWRpdGluZyA9IGZhbHNlO1xyXG5cclxuICAgICAgY29uc3QgdmFsdWUgPSBub3JtYWxpemVTdWJ0eXBlTmFtZSh0aXRsZUVsLnRleHRDb250ZW50KTtcclxuICAgICAgaWYgKCFjb21taXQgfHwgIXZhbHVlIHx8IHZhbHVlID09PSBzdWJ0eXBlKSB7XHJcbiAgICAgICAgdGhpcy5yZW5kZXIoKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gZ2V0U3VidHlwZU5hbWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlKS5maW5kKFxyXG4gICAgICAgIChuYW1lKSA9PiBuYW1lLnRvTG93ZXJDYXNlKCkgPT09IHZhbHVlLnRvTG93ZXJDYXNlKCkgJiYgbmFtZSAhPT0gc3VidHlwZVxyXG4gICAgICApO1xyXG4gICAgICBpZiAoZXhpc3RpbmcpIHtcclxuICAgICAgICBuZXcgQ29uZmlybVN1YnR5cGVNb2RhbCh0aGlzLmFwcCwge1xyXG4gICAgICAgICAgcGFyYWdyYXBoczogW1xyXG4gICAgICAgICAgICBgU3VidHlwICR7ZXhpc3Rpbmd9IGV4aXN0aWVydCBiZWkgJHt0eXBlfSBiZXJlaXRzLiAke3N1YnR5cGV9IGRhbWl0IHp1c2FtbWVubGVnZW4/YCxcclxuICAgICAgICAgICAgYCR7Y291bnRPZihzdWJ0eXBlKX0gTm90aXooZW4pIHdlcmRlbiBhdWYgJHtleGlzdGluZ30gdW1nZXN0ZWxsdCwgZGllIFByb3BlcnRpZXMgdm9uICR7c3VidHlwZX0gd2FuZGVybiBpbiBkZW4gQmxvY2sgJHtleGlzdGluZ30uYCxcclxuICAgICAgICAgIF0sXHJcbiAgICAgICAgICBjb25maXJtVGV4dDogXCJadXNhbW1lbmxlZ2VuXCIsXHJcbiAgICAgICAgICBjb25maXJtQ2xzOiBcIm1vZC13YXJuaW5nXCIsXHJcbiAgICAgICAgICBvbkNvbmZpcm06IGFzeW5jICgpID0+IHtcclxuICAgICAgICAgICAgbWVyZ2VTdWJ0eXBlcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSwgZXhpc3RpbmcpO1xyXG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgICAgY29uc3QgcmVuYW1lZCA9IGF3YWl0IHJlbmFtZVN1YnR5cGVJbk5vdGVzKHRoaXMucGx1Z2luLCB0eXBlLCBzdWJ0eXBlLCBleGlzdGluZyk7XHJcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgICAgICAgICBuZXcgTm90aWNlKGBTdWJ0eXAgJHtzdWJ0eXBlfSBtaXQgJHtleGlzdGluZ30genVzYW1tZW5nZWxlZ3QsICR7cmVuYW1lZH0gTm90aXooZW4pIGFuZ2VwYXNzdC5gKTtcclxuICAgICAgICAgICAgdGhpcy5yZW5kZXIoKTtcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICBvbkNhbmNlbDogKCkgPT4gdGhpcy5yZW5kZXIoKSxcclxuICAgICAgICB9KS5vcGVuKCk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAoIXVwZGF0ZU5vdGVzKSB7XHJcbiAgICAgICAgYXdhaXQgYXBwbHlSZW5hbWUodmFsdWUsIHsgd2l0aE5vdGVzOiBmYWxzZSB9KTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgICAgbmV3IENvbmZpcm1TdWJ0eXBlTW9kYWwodGhpcy5hcHAsIHtcclxuICAgICAgICBwYXJhZ3JhcGhzOiBbYFN1YnR5cCAke3N1YnR5cGV9IGluICR7dmFsdWV9IHVtYmVuZW5uZW4gdW5kICR7Y291bnRPZihzdWJ0eXBlKX0gTm90aXooZW4pIGVudHNwcmVjaGVuZCBhbnBhc3Nlbj9gXSxcclxuICAgICAgICBjb25maXJtVGV4dDogXCJVbWJlbmVubmVuXCIsXHJcbiAgICAgICAgY29uZmlybUNsczogXCJtb2QtY3RhXCIsXHJcbiAgICAgICAgb25Db25maXJtOiAoKSA9PiBhcHBseVJlbmFtZSh2YWx1ZSwgeyB3aXRoTm90ZXM6IHRydWUgfSksXHJcbiAgICAgICAgb25DYW5jZWw6ICgpID0+IHRoaXMucmVuZGVyKCksXHJcbiAgICAgIH0pLm9wZW4oKTtcclxuICAgIH07XHJcblxyXG4gICAgLy8gQWxsZSBUYXN0ZW4gaGllciBiZWhhbHRlbjogZGVyIFRpdGVsIHN0ZWh0IGluIGRlciBMaXN0ZSB2b24gT2JzaWRpYW5zXHJcbiAgICAvLyBQcm9wZXJ0eS1FZGl0b3IsIGRlc3NlbiBlaWdlbmUgVGFzdGF0dXItTmF2aWdhdGlvbiBzb25zdCBtaXRyZWFnaWVydGVcclxuICAgIC8vIChFc2NhcGUgenVzXHUwMEU0dHpsaWNoIHdlZ2VuIGRlciBEZXRhaWxhbnNpY2h0LCBzaWVoZSBvbk9wZW4pLlxyXG4gICAgdGl0bGVFbC5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCAoZXZlbnQpID0+IHtcclxuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRW50ZXJcIikge1xyXG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgZmluaXNoKHRydWUpO1xyXG4gICAgICB9IGVsc2UgaWYgKGV2ZW50LmtleSA9PT0gXCJFc2NhcGVcIikge1xyXG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgZmluaXNoKGZhbHNlKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICB0aXRsZUVsLmFkZEV2ZW50TGlzdGVuZXIoXCJibHVyXCIsICgpID0+IGZpbmlzaCh0cnVlKSk7XHJcbiAgfVxyXG5cclxuICAvLyBXaWUgZGllIHVucmVnaXN0cmllcnRlbiBFaW50clx1MDBFNGdlIGRlciBUWVAtTGlzdGU6IFNVQlRZUC1XZXJ0ZSB2b24gTm90aXplblxyXG4gIC8vIGRpZXNlcyBUWVBzLCBkaWUgKG5vY2gpIGtlaW5lbiBlaWdlbmVuIEJsb2NrIGhhYmVuIChOb3RpemVuIGdhbnogb2huZVxyXG4gIC8vIFNVQlRZUCB6XHUwMEU0aGx0IHN0YXR0ZGVzc2VuIGRhcyBUWVAtRnJvbnRtYXR0ZXIpLiBEYXJnZXN0ZWxsdCB3aWUgZGllXHJcbiAgLy8gU3VidHlwLUJsXHUwMEY2Y2tlLCBhYmVyIG51ciBtaXQgKGF1c2dlZ3JhdXRlcikgXHUwMERDYmVyc2NocmlmdCBzYW10IEFuemFobC5cclxuICAvLyBMaW5rc2tsaWNrIFx1MDBGQ2Jlcm5pbW10IGVpbmVuIFdlcnQgYWxzIFN1YnR5cCwgUmVjaHRza2xpY2sgXHUwMEY2ZmZuZXQgZGllIFN1Y2hlLlxyXG4gIHJlbmRlclVucmVnaXN0ZXJlZFN1YnR5cGVzKHBhcmVudCwgdHlwZSwgYnVja2V0KSB7XHJcbiAgICBjb25zdCByZWdpc3RlcmVkID0gZ2V0U3VidHlwZU5hbWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlKTtcclxuICAgIGNvbnN0IHVucmVnaXN0ZXJlZCA9IFsuLi5idWNrZXQuY291bnRzLmtleXMoKV1cclxuICAgICAgLmZpbHRlcigoa2V5KSA9PiAhcmVnaXN0ZXJlZC5pbmNsdWRlcyhrZXkpKVxyXG4gICAgICAuc29ydCgoYSwgYikgPT4gYnVja2V0LmNvdW50cy5nZXQoYikgLSBidWNrZXQuY291bnRzLmdldChhKSB8fCBhLmxvY2FsZUNvbXBhcmUoYikpO1xyXG4gICAgaWYgKHVucmVnaXN0ZXJlZC5sZW5ndGggPT09IDApIHJldHVybjtcclxuXHJcbiAgICBjb25zdCBsaXN0RWwgPSBwYXJlbnQuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLXN1YnR5cGUtdW5yZWdpc3RlcmVkLWxpc3RcIiB9KTtcclxuICAgIGZvciAoY29uc3Qga2V5IG9mIHVucmVnaXN0ZXJlZCkge1xyXG4gICAgICBjb25zdCBibG9jayA9IGxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItYmxvY2sgZnJlZC10eXAtc3VidHlwZS1ibG9jayBmcmVkLXR5cC1zdWJ0eXBlLXVucmVnaXN0ZXJlZFwiIH0pO1xyXG4gICAgICBjb25zdCBoZWFkZXIgPSBibG9jay5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItaGVhZGVyXCIgfSk7XHJcbiAgICAgIGNvbnN0IHRpdGxlR3JvdXAgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLXRpdGxlLWdyb3VwXCIgfSk7XHJcbiAgICAgIHRpdGxlR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIsIHRleHQ6IGRpc3BsYXlUeXBlS2V5KGtleSkgfSk7XHJcbiAgICAgIHRpdGxlR3JvdXAuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1zdWJ0eXBlLWNvdW50XCIsIHRleHQ6IFN0cmluZyhidWNrZXQuY291bnRzLmdldChrZXkpKSB9KTtcclxuICAgICAgYmxvY2suYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMucmVnaXN0ZXJTdWJ0eXBlKHR5cGUsIGtleSwgYnVja2V0KSk7XHJcbiAgICAgIGJsb2NrLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcclxuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgICAgIHRoaXMub3BlblN1YnR5cGVTZWFyY2godHlwZSwga2V5KTtcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvLyBzdWJ0eXBlS2V5ID09PSBudWxsIFx1MjE5MiBOb3RpemVuIGRpZXNlcyBUWVBzIG9obmUgU1VCVFlQLiBGXHUwMEZDciBlaW5lIExpc3RlXHJcbiAgLy8gZ2lidCBlcyB3aWUgYmVpIG9wZW5TZWFyY2goKSBrZWluZSBleGFrdGUgU3VjaHN5bnRheCAtIGRhbm4gbmFjaCBOb3RpemVuXHJcbiAgLy8gc3VjaGVuLCBkaWUgYWxsZSBpaHJlIEVpbnRyXHUwMEU0Z2UgdHJhZ2VuLlxyXG4gIG9wZW5TdWJ0eXBlU2VhcmNoKHR5cGUsIHN1YnR5cGVLZXkpIHtcclxuICAgIGNvbnN0IGdsb2JhbFNlYXJjaCA9IHRoaXMucGx1Z2luLmFwcC5pbnRlcm5hbFBsdWdpbnMuZ2V0UGx1Z2luQnlJZChcImdsb2JhbC1zZWFyY2hcIik7XHJcbiAgICBpZiAoIWdsb2JhbFNlYXJjaCkgcmV0dXJuO1xyXG4gICAgY29uc3QgdHlwQ2xhdXNlID0gYFtcIiR7VFlQX1BST1BFUlRZfVwiOlwiJHt0eXBlfVwiXWA7XHJcbiAgICBsZXQgc3VidHlwQ2xhdXNlO1xyXG4gICAgaWYgKHN1YnR5cGVLZXkgPT09IG51bGwpIHtcclxuICAgICAgc3VidHlwQ2xhdXNlID0gYC1bXCIke1NVQlRZUF9QUk9QRVJUWX1cIl1gO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgY29uc3QgcmF3ID0gdGhpcy5wbHVnaW4udHlwSW5kZXguc3VidHlwZUJ1Y2tldCh0eXBlKS5yYXdCeUtleS5nZXQoc3VidHlwZUtleSk7XHJcbiAgICAgIHN1YnR5cENsYXVzZSA9IEFycmF5LmlzQXJyYXkocmF3KVxyXG4gICAgICAgID8gcmF3Lm1hcCgodikgPT4gYFtcIiR7U1VCVFlQX1BST1BFUlRZfVwiOlwiJHtTdHJpbmcodiA/PyBcIlwiKS50cmltKCl9XCJdYCkuam9pbihcIiBcIilcclxuICAgICAgICA6IGBbXCIke1NVQlRZUF9QUk9QRVJUWX1cIjpcIiR7c3VidHlwZUtleX1cIl1gO1xyXG4gICAgfVxyXG4gICAgZ2xvYmFsU2VhcmNoLmluc3RhbmNlLm9wZW5HbG9iYWxTZWFyY2goYCR7dHlwQ2xhdXNlfSAke3N1YnR5cENsYXVzZX1gKTtcclxuICB9XHJcblxyXG4gIC8vIFdpZSByZWdpc3RlclR5cGUoKTogXHUwMEZDYmVybmltbXQgZGllIGJlcmVpbmlndGUgRm9ybSAoR3JvXHUwMERGYnVjaHN0YWJlbiwgTGlzdGVcclxuICAvLyBhbHMgRWluemVsd2VydCBcIkEsIEJcIikgYWxzIFN1YnR5cCBkaWVzZXMgVFlQcyB1bmQgc2NocmVpYnQgZGVuIFNVQlRZUCBkZXJcclxuICAvLyBiZXRyb2ZmZW5lbiBOb3RpemVuIGdsZWljaCBtaXQgdW0uIEdpYnQgZXMgZGVuIFN1YnR5cCBpbiBhbmRlcmVyIFNjaHJlaWItXHJcbiAgLy8gd2Vpc2Ugc2Nob24sIGxhbmRlbiBkaWUgTm90aXplbiBkb3J0LlxyXG4gIGFzeW5jIHJlZ2lzdGVyU3VidHlwZSh0eXBlLCBzdWJ0eXBlS2V5LCBidWNrZXQpIHtcclxuICAgIGNvbnN0IHJhdyA9IGJ1Y2tldC5yYXdCeUtleS5nZXQoc3VidHlwZUtleSk7XHJcbiAgICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplUmF3VHlwZShyYXcgPT09IHVuZGVmaW5lZCA/IHN1YnR5cGVLZXkgOiByYXcsIG5vcm1hbGl6ZVN1YnR5cGVOYW1lKTtcclxuICAgIGlmICghbm9ybWFsaXplZCkgcmV0dXJuO1xyXG4gICAgY29uc3QgZXhpc3RpbmcgPSBnZXRTdWJ0eXBlTmFtZXModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUpLmZpbmQoKG5hbWUpID0+IG5hbWUudG9Mb3dlckNhc2UoKSA9PT0gbm9ybWFsaXplZC50b0xvd2VyQ2FzZSgpKTtcclxuICAgIGNvbnN0IHN1YnR5cGUgPSBleGlzdGluZyA/PyBub3JtYWxpemVkO1xyXG4gICAgZW5zdXJlU3VidHlwZSh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSk7XHJcblxyXG4gICAgbGV0IHJlbmFtZWQgPSAwO1xyXG4gICAgaWYgKHN1YnR5cGUgIT09IHN1YnR5cGVLZXkpIHJlbmFtZWQgPSBhd2FpdCByZW5hbWVTdWJ0eXBlSW5Ob3Rlcyh0aGlzLnBsdWdpbiwgdHlwZSwgc3VidHlwZUtleSwgc3VidHlwZSk7XHJcblxyXG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgIGlmIChyZW5hbWVkID4gMCkgbmV3IE5vdGljZShgU1VCVFlQICR7c3VidHlwZX0gcmVnaXN0cmllcnQsICR7cmVuYW1lZH0gTm90aXooZW4pIGFuZ2VwYXNzdC5gKTtcclxuICB9XHJcblxyXG4gIC8vIE5ldWVyLCBsZWVyZXIgU3VidHlwLUJsb2NrIGRpcmVrdCBcdTAwRkNiZXIgZGVtIFwiU3VidHlwIGhpbnp1Zlx1MDBGQ2dlblwiLUJ1dHRvbixcclxuICAvLyBkZXNzZW4gTmFtZSBzb2ZvcnQgaW5saW5lIGVpbmdlZ2ViZW4gd2lyZCAod2llIHN0YXJ0QWRkKCkgaW4gZGVyIExpc3RlKS5cclxuICBzdGFydEFkZFN1YnR5cGUodHlwZSkge1xyXG4gICAgaWYgKHRoaXMuaXNFZGl0aW5nIHx8ICF0aGlzLnN1YnR5cGVBZGRCdG5FbCkgcmV0dXJuO1xyXG4gICAgdGhpcy5pc0VkaXRpbmcgPSB0cnVlO1xyXG5cclxuICAgIC8vIEF1ZmdlYmF1dCB3aWUgZGVyIGZlcnRpZ2UgKGxlZXJlKSBCbG9jayBpbSBnZW1laW5zYW1lbiBFZGl0b3IgLSBzYW10IGRlblxyXG4gICAgLy8gXCIrXCItQnV0dG9ucyB1bmQgZGVuIEFrdGlvbmVuIGltIEFic2NobHVzcywgZGllIGhpZXIgbm9jaCBuaWNodHMgdHVuLCBudXJcclxuICAgIC8vIG5vY2ggb2huZSBBbnphaGwgLSwgZGFtaXQgYmVpbSBBYnNjaGxpZVx1MDBERmVuIGRlciBFaW5nYWJlIG5pY2h0cyBzcHJpbmd0XHJcbiAgICAvLyAoc2llaGUgLmZyZWQtdHlwLXN1YnR5cGUtcGVuZGluZykuXHJcbiAgICBjb25zdCBibG9jayA9IGNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1mcm9udG1hdHRlci1ibG9jayBmcmVkLXR5cC1zdWJ0eXBlLWJsb2NrIGZyZWQtdHlwLXN1YnR5cGUtcGVuZGluZ1wiIH0pO1xyXG4gICAgdGhpcy5zdWJ0eXBlQWRkQnRuRWwucGFyZW50RWxlbWVudC5pbnNlcnRCZWZvcmUoYmxvY2ssIHRoaXMuc3VidHlwZUFkZEJ0bkVsKTtcclxuICAgIGNvbnN0IGhlYWRlciA9IGJsb2NrLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1mcm9udG1hdHRlci1oZWFkZXJcIiB9KTtcclxuICAgIGNvbnN0IHRpdGxlR3JvdXAgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLXRpdGxlLWdyb3VwXCIgfSk7XHJcbiAgICBjb25zdCBuYW1lRWwgPSB0aXRsZUdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtc2VjdGlvbi10aXRsZSBmcmVkLXR5cC1zdWJ0eXBlLW5hbWUtaW5wdXQgaXMtYmVpbmctcmVuYW1lZFwiIH0pO1xyXG4gICAgY29uc3QgYWRkQnV0dG9ucyA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItYWRkLWdyb3VwXCIgfSk7XHJcbiAgICBzZXRJY29uKGFkZEJ1dHRvbnMuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWZyb250bWF0dGVyLWFkZC1mbG9hdGluZ1wiIH0pLCBcInBsdXNcIik7XHJcbiAgICBzZXRJY29uKGFkZEJ1dHRvbnMuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWZyb250bWF0dGVyLWFkZFwiIH0pLCBcInBsdXNcIik7XHJcbiAgICBjb25zdCBmb290ZXIgPSBibG9jay5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtc2VjdGlvbi1mb290ZXIgZnJlZC10eXAtc3VidHlwZS1hY3Rpb25zXCIgfSk7XHJcbiAgICBjb25zdCBjb2xvckdyb3VwID0gZm9vdGVyLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1zdWJ0eXBlLWNvbG9yLWdyb3VwXCIgfSk7XHJcbiAgICBwYWludENvbG9yRG90KGNvbG9yR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLXN1YnR5cGUtY29sb3ItZG90XCIgfSksIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV0gPz8gREVGQVVMVF9UWVBFX0NPTE9SLCB0cnVlKTtcclxuICAgIHNldEljb24oY29sb3JHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gZnJlZC10eXAtY29sb3ItcmVzZXQgaXMtZGlzYWJsZWRcIiB9KSwgXCJyb3RhdGUtY2N3XCIpO1xyXG4gICAgY29uc3QgYWN0aW9ucyA9IGZvb3Rlci5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtc3VidHlwZS1hY3Rpb24tZ3JvdXBcIiB9KTtcclxuICAgIHNldEljb24oYWN0aW9ucy5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gZnJlZC10eXAtZGV0YWlsLXJlbmFtZS1ub3Rlc1wiIH0pLCBcInBlbmNpbFwiKTtcclxuICAgIHNldEljb24oYWN0aW9ucy5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gZnJlZC10eXAtZGV0YWlsLXJlbmFtZVwiIH0pLCBcInBlbmNpbFwiKTtcclxuICAgIHNldEljb24oYWN0aW9ucy5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gZnJlZC10eXAtZGV0YWlsLWRlbGV0ZVwiIH0pLCBcInRyYXNoXCIpO1xyXG4gICAgbmFtZUVsLnNldEF0dHJpYnV0ZShcImNvbnRlbnRlZGl0YWJsZVwiLCBcInRydWVcIik7XHJcbiAgICBuYW1lRWwuc2V0QXR0cmlidXRlKFwic3BlbGxjaGVja1wiLCBcImZhbHNlXCIpO1xyXG4gICAgbmFtZUVsLmZvY3VzKCk7XHJcblxyXG4gICAgbGV0IGRvbmUgPSBmYWxzZTtcclxuICAgIGNvbnN0IGZpbmlzaCA9IGFzeW5jIChjb21taXQpID0+IHtcclxuICAgICAgaWYgKGRvbmUpIHJldHVybjtcclxuICAgICAgZG9uZSA9IHRydWU7XHJcbiAgICAgIHRoaXMuaXNFZGl0aW5nID0gZmFsc2U7XHJcblxyXG4gICAgICBjb25zdCB2YWx1ZSA9IG5vcm1hbGl6ZVN1YnR5cGVOYW1lKG5hbWVFbC50ZXh0Q29udGVudCk7XHJcbiAgICAgIGlmIChjb21taXQgJiYgdmFsdWUpIHtcclxuICAgICAgICBjb25zdCBleGlzdGluZyA9IGdldFN1YnR5cGVOYW1lcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSkuZmluZCgobmFtZSkgPT4gbmFtZS50b0xvd2VyQ2FzZSgpID09PSB2YWx1ZS50b0xvd2VyQ2FzZSgpKTtcclxuICAgICAgICBpZiAoZXhpc3RpbmcpIHtcclxuICAgICAgICAgIG5ldyBOb3RpY2UoYFN1YnR5cCAke2V4aXN0aW5nfSBnaWJ0IGVzIGJlaSAke3R5cGV9IGJlcmVpdHMuYCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIGVuc3VyZVN1YnR5cGUodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUsIHZhbHVlKTtcclxuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICB0aGlzLnJlbmRlcigpO1xyXG4gICAgfTtcclxuXHJcbiAgICBuYW1lRWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XHJcbiAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRW50ZXJcIikge1xyXG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgZmluaXNoKHRydWUpO1xyXG4gICAgICB9IGVsc2UgaWYgKGV2ZW50LmtleSA9PT0gXCJFc2NhcGVcIikge1xyXG4gICAgICAgIC8vIHN0b3BQcm9wYWdhdGlvbiwgc29uc3QgdmVybFx1MDBFNHNzdCBkZXIgRXNjYXBlLUhhbmRsZXIgZGVyIGdlc2FtdGVuXHJcbiAgICAgICAgLy8gRGV0YWlsYW5zaWNodCBzaWUgZ2xlaWNoIG1pdC5cclxuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgICAgIGZpbmlzaChmYWxzZSk7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG4gICAgbmFtZUVsLmFkZEV2ZW50TGlzdGVuZXIoXCJibHVyXCIsICgpID0+IGZpbmlzaCh0cnVlKSk7XHJcbiAgfVxyXG5cclxuICBzaG93RGVsZXRlQ29uZmlybSh0eXBlKSB7XHJcbiAgICBuZXcgQ29uZmlybURlbGV0ZVR5cGVNb2RhbCh0aGlzLnBsdWdpbiwgdHlwZSwgYXN5bmMgKCkgPT4ge1xyXG4gICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlcyA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVzLmZpbHRlcigodCkgPT4gdCAhPT0gdHlwZSk7XHJcbiAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdO1xyXG4gICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXTtcclxuICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV07XHJcbiAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdO1xyXG4gICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZVNob3J0Y3V0c1t0eXBlXTtcclxuICAgICAgZGVsZXRlIHRoaXMuZW5zdXJlVHlwZU1hbnVhbCgpW3R5cGVdO1xyXG4gICAgICBkZWxldGVUeXBlU3VidHlwZXModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUpO1xyXG4gICAgICAvLyBWb3IgcmVmcmVzaFR5cENvbG9ycygpIHp1clx1MDBGQ2NrIHp1ciBMaXN0ZSwgYXVzIGRlbXNlbGJlbiBHcnVuZCB3aWUgYmVpbVxyXG4gICAgICAvLyBVbWJlbmVubmVuOiByZWZyZXNoVHlwQ29sb3JzKCkgcmVuZGVydCAodS4gYS4gXHUwMEZDYmVyIHJlZ2lzdGVyVHlwVmlldylcclxuICAgICAgLy8gc3luY2hyb24gbmV1IC0gc3RcdTAwRkNuZGUgc2VsZWN0ZWRUeXBlIG5vY2ggYXVmIGRlbSBnZXJhZGUgZ2VsXHUwMEY2c2NodGVuXHJcbiAgICAgIC8vIFR5cCwgd1x1MDBGQ3JkZSBkZXNzZW4gamV0enQgZGF0ZW5sb3NlIERldGFpbGFuc2ljaHQga3VyeiBlcm5ldXQgZ2VyZW5kZXJ0LlxyXG4gICAgICB0aGlzLmNsb3NlVHlwZVNldHRpbmdzKCk7XHJcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgIH0pLm9wZW4oKTtcclxuICB9XHJcblxyXG4gIC8vIFdpZSBzdGFydEVkaXRpbmcoKSwgYWJlciBhdWYgZGVtIGZyZWlzdGVoZW5kZW4gVGl0ZWwtRWxlbWVudCBkZXIgRGV0YWlsLUFuc2ljaHRcclxuICAvLyBzdGF0dCBhdWYgZWluZW0gVHJlZS1JdGVtIC0gdW5kIG1pdCByZXN1bHRpZXJlbmRlbSBzZWxlY3RlZFR5cGUtV2VjaHNlbCBzdGF0dFxyXG4gIC8vIGVpbmVzIHNjaGxpY2h0ZW4gUmUtUmVuZGVycyBkZXIgTGlzdGUuIHVwZGF0ZU5vdGVzOiB0cnVlICh6d2VpdGVyLCBoZXJ2b3ItXHJcbiAgLy8gZ2Vob2JlbmVyIEJ1dHRvbikgc2NocmVpYnQgbmFjaCBCZXN0XHUwMEU0dGlndW5nIHp1c1x1MDBFNHR6bGljaCBkZW4gVFlQLVdlcnQgYWxsZXJcclxuICAvLyBiZXRyb2ZmZW5lbiBOb3RpemVuIHVtIChzaWVoZSByZW5hbWVUeXBlSW5Ob3RlcyksIHN0YXR0IG51ciBkaWUgUGx1Z2luLVxyXG4gIC8vIEVpbnN0ZWxsdW5nZW4genUgbWlncmllcmVuLlxyXG4gIHN0YXJ0RGV0YWlsUmVuYW1lKHR5cGUsIHRpdGxlRWwsIHsgdXBkYXRlTm90ZXMgPSBmYWxzZSB9ID0ge30pIHtcclxuICAgIGlmICh0aGlzLmlzRWRpdGluZykgcmV0dXJuO1xyXG4gICAgdGhpcy5pc0VkaXRpbmcgPSB0cnVlO1xyXG5cclxuICAgIHRpdGxlRWwuYWRkQ2xhc3MoXCJpcy1iZWluZy1yZW5hbWVkXCIpO1xyXG4gICAgdGl0bGVFbC5zZXRBdHRyaWJ1dGUoXCJjb250ZW50ZWRpdGFibGVcIiwgXCJ0cnVlXCIpO1xyXG4gICAgdGl0bGVFbC5zZXRBdHRyaWJ1dGUoXCJzcGVsbGNoZWNrXCIsIFwiZmFsc2VcIik7XHJcbiAgICB0aXRsZUVsLmZvY3VzKCk7XHJcblxyXG4gICAgY29uc3QgcmFuZ2UgPSB0aXRsZUVsLmRvYy5jcmVhdGVSYW5nZSgpO1xyXG4gICAgcmFuZ2Uuc2VsZWN0Tm9kZUNvbnRlbnRzKHRpdGxlRWwpO1xyXG4gICAgY29uc3Qgc2VsZWN0aW9uID0gdGl0bGVFbC53aW4uZ2V0U2VsZWN0aW9uKCk7XHJcbiAgICBzZWxlY3Rpb24ucmVtb3ZlQWxsUmFuZ2VzKCk7XHJcbiAgICBzZWxlY3Rpb24uYWRkUmFuZ2UocmFuZ2UpO1xyXG5cclxuICAgIC8vIE1pZ3JpZXJ0IG51ciBkaWUgUGx1Z2luLUVpbnN0ZWxsdW5nZW4gKExpc3RlLCBGYXJiZSwgQmVzY2hyZWlidW5nLFxyXG4gICAgLy8gVFlQLUZyb250bWF0dGVyLCBNYW51ZWxsZXItVFlQLVNjaGFsdGVyKSBhdWYgZGVuIG5ldWVuIE5hbWVuIC1cclxuICAgIC8vIHJcdTAwRkNocnQga2VpbmUgTm90aXplbiBhbi4gR2VtZWluc2FtIGdlbnV0enQgdm9uIGJlaWRlbiBVbWJlbmVubmVuLVBmYWRlbi5cclxuICAgIGNvbnN0IGFwcGx5UmVuYW1lID0gYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgIGNvbnN0IGlkeCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVzLmluZGV4T2YodHlwZSk7XHJcbiAgICAgIGlmIChpZHggIT09IC0xKSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlc1tpZHhdID0gdmFsdWU7XHJcbiAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV07XHJcbiAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV07XHJcbiAgICAgIH1cclxuICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXTtcclxuICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXTtcclxuICAgICAgfVxyXG4gICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdO1xyXG4gICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdO1xyXG4gICAgICB9XHJcbiAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV07XHJcbiAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV07XHJcbiAgICAgIH1cclxuICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVTaG9ydGN1dHNbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVTaG9ydGN1dHNbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZVNob3J0Y3V0c1t0eXBlXTtcclxuICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZVNob3J0Y3V0c1t0eXBlXTtcclxuICAgICAgfVxyXG4gICAgICBpZiAodGhpcy5lbnN1cmVUeXBlTWFudWFsKClbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVNYW51YWxbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZU1hbnVhbFt0eXBlXTtcclxuICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZU1hbnVhbFt0eXBlXTtcclxuICAgICAgfVxyXG4gICAgICBtb3ZlVHlwZVN1YnR5cGVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlLCB2YWx1ZSk7XHJcbiAgICAgIC8vIFZvciByZWZyZXNoVHlwQ29sb3JzKCkgc2V0emVuOiBkYXMgcnVmdCAodS4gYS4gXHUwMEZDYmVyIGRlbiBpblxyXG4gICAgICAvLyByZWdpc3RlclR5cFZpZXcgenVyXHUwMEZDY2tnZWdlYmVuZW4gUmVmcmVzaCkgc3luY2hyb24gcmVuZGVyKCkgYXVmIC1cclxuICAgICAgLy8gc3RcdTAwRkNuZGUgc2VsZWN0ZWRUeXBlIG5vY2ggYXVmIGRlbSBhbHRlbiAoYmVyZWl0cyBtaWdyaWVydGVuLFxyXG4gICAgICAvLyBkYWhlciBqZXR6dCBkYXRlbi1sb3NlbikgTmFtZW4sIHdcdTAwRkNyZGUga3VyenplaXRpZyBnZW5hdSBkZXIgQWx0LVxyXG4gICAgICAvLyBOYW1lIG1pdCBsZWVyZW4gRGF0ZW4gZ2VyZW5kZXJ0LlxyXG4gICAgICB0aGlzLnNlbGVjdGVkVHlwZSA9IHZhbHVlO1xyXG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbiAgICB9O1xyXG5cclxuICAgIGxldCBkb25lID0gZmFsc2U7XHJcbiAgICBjb25zdCBmaW5pc2ggPSBhc3luYyAoY29tbWl0KSA9PiB7XHJcbiAgICAgIGlmIChkb25lKSByZXR1cm47XHJcbiAgICAgIGRvbmUgPSB0cnVlO1xyXG4gICAgICB0aGlzLmlzRWRpdGluZyA9IGZhbHNlO1xyXG5cclxuICAgICAgY29uc3QgdmFsdWUgPSBub3JtYWxpemVUeXBlTmFtZSh0aXRsZUVsLnRleHRDb250ZW50KTtcclxuICAgICAgaWYgKCFjb21taXQgfHwgIXZhbHVlIHx8IHZhbHVlID09PSB0eXBlKSB7XHJcbiAgICAgICAgdGhpcy5yZW5kZXIoKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXMuZmluZChcclxuICAgICAgICAodCkgPT4gdC50b0xvd2VyQ2FzZSgpID09PSB2YWx1ZS50b0xvd2VyQ2FzZSgpICYmIHQgIT09IHR5cGVcclxuICAgICAgKTtcclxuICAgICAgaWYgKGV4aXN0aW5nKSB7XHJcbiAgICAgICAgdGhpcy5zaG93TWVyZ2VDb25maXJtKHR5cGUsIGV4aXN0aW5nKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmICghdXBkYXRlTm90ZXMpIHtcclxuICAgICAgICBhd2FpdCBhcHBseVJlbmFtZSh2YWx1ZSk7XHJcbiAgICAgICAgdGhpcy5yZW5kZXIoKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIEJ1bGstU2NocmVpYnZvcmdhbmcgXHUwMEZDYmVyIHBvdGVuemllbGwgdmllbGUgRGF0ZWllbiAtIHZvcmhlciBiZXN0XHUwMEU0dGlnZW5cclxuICAgICAgLy8gbGFzc2VuLCBzdGF0dCBzb2ZvcnQgenUgc3BlaWNoZXJuLlxyXG4gICAgICBjb25zdCB7IGNvdW50cyB9ID0gdGhpcy5wbHVnaW4udHlwSW5kZXgudHlwZUNvdW50cygpO1xyXG4gICAgICBuZXcgQ29uZmlybVJlbmFtZVR5cGVNb2RhbChcclxuICAgICAgICB0aGlzLnBsdWdpbixcclxuICAgICAgICB0eXBlLFxyXG4gICAgICAgIHZhbHVlLFxyXG4gICAgICAgIGNvdW50cy5nZXQodHlwZSkgPz8gMCxcclxuICAgICAgICBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgICBhd2FpdCBhcHBseVJlbmFtZSh2YWx1ZSk7XHJcbiAgICAgICAgICBjb25zdCByZW5hbWVkID0gYXdhaXQgcmVuYW1lVHlwZUluTm90ZXModGhpcy5wbHVnaW4sIHR5cGUsIHZhbHVlKTtcclxuICAgICAgICAgIG5ldyBOb3RpY2UoYFRZUCAke3ZhbHVlfTogJHtyZW5hbWVkfSBOb3RpeihlbikgYW5nZXBhc3N0LmApO1xyXG4gICAgICAgICAgdGhpcy5yZW5kZXIoKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgICgpID0+IHRoaXMucmVuZGVyKClcclxuICAgICAgKS5vcGVuKCk7XHJcbiAgICB9O1xyXG5cclxuICAgIHRpdGxlRWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XHJcbiAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRW50ZXJcIikge1xyXG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgZmluaXNoKHRydWUpO1xyXG4gICAgICB9IGVsc2UgaWYgKGV2ZW50LmtleSA9PT0gXCJFc2NhcGVcIikge1xyXG4gICAgICAgIC8vIHN0b3BQcm9wYWdhdGlvbiwgc29uc3QgZ3JlaWZ0IHp1c1x1MDBFNHR6bGljaCBkZXIgRXNjYXBlLUhhbmRsZXIgZGVyXHJcbiAgICAgICAgLy8gZ2VzYW10ZW4gRGV0YWlsLUFuc2ljaHQgdW5kIHZlcmxcdTAwRTRzc3Qgc2llIGdsZWljaCBtaXQuXHJcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgICBmaW5pc2goZmFsc2UpO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgICB0aXRsZUVsLmFkZEV2ZW50TGlzdGVuZXIoXCJibHVyXCIsICgpID0+IGZpbmlzaCh0cnVlKSk7XHJcbiAgfVxyXG5cclxuICBzaG93TWVyZ2VDb25maXJtKHNvdXJjZSwgdGFyZ2V0KSB7XHJcbiAgICBjb25zdCB7IGNvdW50cyB9ID0gdGhpcy5wbHVnaW4udHlwSW5kZXgudHlwZUNvdW50cygpO1xyXG4gICAgbmV3IENvbmZpcm1NZXJnZVR5cGVNb2RhbChcclxuICAgICAgdGhpcy5wbHVnaW4sXHJcbiAgICAgIHNvdXJjZSxcclxuICAgICAgdGFyZ2V0LFxyXG4gICAgICBjb3VudHMuZ2V0KHNvdXJjZSkgPz8gMCxcclxuICAgICAgKCkgPT4gdGhpcy5tZXJnZVR5cGUoc291cmNlLCB0YXJnZXQpLFxyXG4gICAgICAoKSA9PiB0aGlzLnJlbmRlcigpXHJcbiAgICApLm9wZW4oKTtcclxuICB9XHJcblxyXG4gIC8vIExlZ3Qgc291cmNlIGluIHRhcmdldCBhdWY6IE5vdGl6ZW4gd2VyZGVuIGF1ZiB0YXJnZXQgdW1nZXNjaHJpZWJlbixcclxuICAvLyBzb3VyY2UgdmVyc2Nod2luZGV0IGF1cyBkZXIgVFlQLUxpc3RlIHNhbXQgZWlnZW5lciBFaW5zdGVsbHVuZ2VuICh0YXJnZXRcclxuICAvLyBiZWhcdTAwRTRsdCBzZWluZSkuIERpZSBTdWJ0eXBlbiB2b24gc291cmNlIHdlcmRlbiBcdTAwRkNiZXJub21tZW4sIGdsZWljaG5hbWlnZVxyXG4gIC8vIEJsXHUwMEY2Y2tlIHp1c2FtbWVuZ2VmXHUwMEZDaHJ0IChzaWVoZSBtZXJnZVR5cGVTdWJ0eXBlcyBpbiBzdWJ0eXBlcy5qcykuXHJcbiAgYXN5bmMgbWVyZ2VUeXBlKHNvdXJjZSwgdGFyZ2V0KSB7XHJcbiAgICBjb25zdCBzZXR0aW5ncyA9IHRoaXMucGx1Z2luLnNldHRpbmdzO1xyXG4gICAgY29uc3QgcmVuYW1lZCA9IGF3YWl0IHJlbmFtZVR5cGVJbk5vdGVzKHRoaXMucGx1Z2luLCBzb3VyY2UsIHRhcmdldCk7XHJcblxyXG4gICAgc2V0dGluZ3MudHlwZXMgPSBzZXR0aW5ncy50eXBlcy5maWx0ZXIoKHQpID0+IHQgIT09IHNvdXJjZSk7XHJcbiAgICBkZWxldGUgc2V0dGluZ3MudHlwZUNvbG9yc1tzb3VyY2VdO1xyXG4gICAgZGVsZXRlIHNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbc291cmNlXTtcclxuICAgIGRlbGV0ZSBzZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3NvdXJjZV07XHJcbiAgICBkZWxldGUgc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1tzb3VyY2VdO1xyXG4gICAgZGVsZXRlIHNldHRpbmdzLnR5cGVTaG9ydGN1dHNbc291cmNlXTtcclxuICAgIGRlbGV0ZSB0aGlzLmVuc3VyZVR5cGVNYW51YWwoKVtzb3VyY2VdO1xyXG4gICAgbWVyZ2VUeXBlU3VidHlwZXMoc2V0dGluZ3MsIHNvdXJjZSwgdGFyZ2V0KTtcclxuXHJcbiAgICAvLyBWb3IgcmVmcmVzaFR5cENvbG9ycygpIHNldHplbiwgYXVzIGRlbXNlbGJlbiBHcnVuZCB3aWUgaW4gYXBwbHlSZW5hbWUuXHJcbiAgICB0aGlzLnNlbGVjdGVkVHlwZSA9IHRhcmdldDtcclxuICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbiAgICBuZXcgTm90aWNlKGBUWVAgJHtzb3VyY2V9IG1pdCAke3RhcmdldH0genVzYW1tZW5nZWxlZ3QsICR7cmVuYW1lZH0gTm90aXooZW4pIGFuZ2VwYXNzdC5gKTtcclxuICAgIHRoaXMucmVuZGVyKCk7XHJcbiAgfVxyXG5cclxuICByZW5kZXJDb3VudEZsYWlyKHNlbGYsIGNvdW50KSB7XHJcbiAgICBjb25zdCBmbGFpck91dGVyID0gc2VsZi5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLWZsYWlyLW91dGVyXCIgfSk7XHJcbiAgICBmbGFpck91dGVyLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHJlZS1pdGVtLWZsYWlyXCIsIHRleHQ6IFN0cmluZyhjb3VudCkgfSk7XHJcbiAgfVxyXG5cclxuICAvLyBSZWluIGluZm9ybWF0aXYsIHVudGVyIGRlbSBUWVAtRnJvbnRtYXR0ZXItRWRpdG9yOiBlcmtsXHUwMEU0cnQgZGVuXHJcbiAgLy8gRmxvYXRpbmctUHJvcGVydHktVG9nZ2xlIChSZWNodHNrbGljayBhdWYgZWluZSBQcm9wZXJ0eSBvYmVuLCBzaWVoZVxyXG4gIC8vIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoIGluIHR5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKS4gQmV3dXNzdCBvaG5lIGVpZ2VuZVxyXG4gIC8vIFx1MDBEQ2JlcnNjaHJpZnQsIGRhIGRpcmVrdCB1bnRlciBkZXIgUHJvcGVydHktTGlzdGUgb2huZWhpbiBrbGFyIGlzdCwgd29yYXVmXHJcbiAgLy8gc2ljaCBkZXIgSGlud2VpcyBiZXppZWh0LlxyXG4gIC8vXHJcbiAgLy8gSGllciBzdGFuZCBmclx1MDBGQ2hlciB6dXNcdTAwRTR0emxpY2ggZWluZSBmZXN0ZSBMaXN0ZSBkZXIgUGxhdHpoYWx0ZXItVG9rZW4uIERpZVxyXG4gIC8vIGlzdCBtaXQgZGVtIFNob3J0Y3V0LUtub3BmIGplIFByb3BlcnR5LVplaWxlIGVudGZhbGxlbjogZGVzc2VuIEF1c3dhaGxcclxuICAvLyAoc2hvcnRjdXQtcGlja2VyLmpzKSBmXHUwMEZDaHJ0IGRpZXNlbGJlbiBUb2tlbiwgYWJlciBhbSBPcnQgZGVyIFZlcndlbmR1bmcsXHJcbiAgLy8gZHVyY2hzdWNoYmFyIHVuZCBiZWkgU2tyaXB0ZW4gc2FtdCBkZXJlbiBlaWdlbmVyIEJlc2NocmVpYnVuZy5cclxuICByZW5kZXJGbG9hdGluZ0hpbnQocGFyZW50KSB7XHJcbiAgICBjb25zdCBzZWN0aW9uID0gcGFyZW50LmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1mbG9hdGluZy1oaW50LXNlY3Rpb25cIiB9KTtcclxuICAgIHNlY3Rpb24uY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcImZyZWQtdHlwLWZsb2F0aW5nLWhpbnRcIixcclxuICAgICAgdGV4dDogXCJZb3UgY2FuIGNoYW5nZSBhIHByb3BlcnR5IHRvIGZsb2F0aW5nIGluIHRoZSByaWdodC1jbGljayBtZW51LlwiLFxyXG4gICAgfSk7XHJcbiAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiByZWdpc3RlclR5cFZpZXcocGx1Z2luKSB7XHJcbiAgcGx1Z2luLnJlZ2lzdGVyVmlldyhWSUVXX1RZUEVfVFlQLCAobGVhZikgPT4gbmV3IFR5cFZpZXcobGVhZiwgcGx1Z2luKSk7XHJcblxyXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcclxuICAgIGlkOiBcInR5cC12aWV3LW9lZmZuZW5cIixcclxuICAgIG5hbWU6IFwiVFlQLVZpZXcgXHUwMEY2ZmZuZW5cIixcclxuICAgIGNhbGxiYWNrOiAoKSA9PiBhY3RpdmF0ZVR5cFZpZXcocGx1Z2luKSxcclxuICB9KTtcclxuXHJcbiAgcGx1Z2luLmFkZENvbW1hbmQoe1xyXG4gICAgaWQ6IFwidHlwLXByb3BlcnR5LWhpbnp1ZnVlZ2VuXCIsXHJcbiAgICBuYW1lOiBcIlRZUC1Qcm9wZXJ0eSBoaW56dWZcdTAwRkNnZW5cIixcclxuICAgIGNhbGxiYWNrOiAoKSA9PiBhZGRUeXBQcm9wZXJ0eUNvbW1hbmQocGx1Z2luKSxcclxuICB9KTtcclxuXHJcbiAgcGx1Z2luLmFkZENvbW1hbmQoe1xyXG4gICAgaWQ6IFwidHlwLWhpbnp1ZnVlZ2VuXCIsXHJcbiAgICBuYW1lOiBcIk5ldWVuIFRZUCBoaW56dWZcdTAwRkNnZW5cIixcclxuICAgIGNhbGxiYWNrOiAoKSA9PiBhZGRUeXBDb21tYW5kKHBsdWdpbiksXHJcbiAgfSk7XHJcblxyXG4gIC8vIEJlaW0gSG90LVJlbG9hZCBibGVpYnQgZGVyIGFsdGUgTGVhZiBhbHMgT2JqZWt0IHVuYW5nZXRhc3RldCBiZXN0ZWhlbiAobnVyXHJcbiAgLy8gdW5zZXIgUGx1Z2luLU1vZHVsIHdpcmQgbmV1IGdlbGFkZW4pLCBhYmVyIFwiaW5zdGFuY2VvZiBUeXBWaWV3XCIgc2NobFx1MDBFNGd0IGdlZ2VuXHJcbiAgLy8gZGllIG5ldSBnZWxhZGVuZSBLbGFzc2UgZmVobC4gYXBwLmpzIHNlbGJzdCBiZXN0aW1tdCBnZXRWaWV3VHlwZSgpIHJlaW4gYXVzXHJcbiAgLy8gbGVhZi52aWV3IC0gZGFzIHJlaWNodCB6dXIgRXJrZW5udW5nIGFsc28gbmljaHQuIGFwcCBzZWxic3QgXHUwMEZDYmVybGVidCBkZW5cclxuICAvLyBIb3QtUmVsb2FkIGRhZ2VnZW4gdW52ZXJcdTAwRTRuZGVydCwgZGFoZXIgZGllIExlYWYtUmVmZXJlbnogZGlyZWt0IGRvcnQgYWJsZWdlbi5cclxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IGFjdGl2YXRlVHlwVmlldyhwbHVnaW4sIGZhbHNlLCBmYWxzZSkpO1xyXG5cclxuICBjb25zdCByZWZyZXNoID0gKCkgPT4ge1xyXG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShWSUVXX1RZUEVfVFlQKSkge1xyXG4gICAgICBsZWFmLnZpZXc/LnJlbmRlcj8uKCk7XHJcbiAgICB9XHJcbiAgfTtcclxuXHJcbiAgLy8gWlx1MDBFNGhsZXIgKExpc3RlIHVuZCBQaWNrZXIsIHNpZWhlIHR5cEluZGV4LnR5cGVDb3VudHMoKSkgc29uc3QgbnVyIHNvIGFrdHVlbGxcclxuICAvLyB3aWUgYmVpbSBsZXR6dGVuIFJlbmRlciBkaWVzZXIgVmlldyAtIGplZGUgVFlQLXJlbGV2YW50ZSBcdTAwQzRuZGVydW5nIGFuZGVyc3dvXHJcbiAgLy8gKG5ldWUvZ2VsXHUwMEY2c2NodGUgTm90aXosIFRZUCBvZGVyIFNVQlRZUCB1bWdldHJhZ2VuKSBsaWVcdTAwREZlIHNpZSBzb25zdCB2ZXJhbHRlbixcclxuICAvLyBiaXMgaXJnZW5kZWluIGFuZGVyZXIgR3J1bmQgKHouIEIuIGVpbmUgRWluc3RlbGx1bmcpIHp1Zlx1MDBFNGxsaWcgZWluZW4gUmVmcmVzaFxyXG4gIC8vIGF1c2xcdTAwRjZzdC4gRGFzIFwiY2hhbmdlXCItRXZlbnQgZGVzIEluZGV4IGZldWVydCBudXIgYmVpIGdlbmF1IHNvbGNoZW5cclxuICAvLyBcdTAwQzRuZGVydW5nZW4sIG5pY2h0IGJlaSBqZWRlbSBBdXRvc2F2ZS1UaWNrLiBUcm90emRlbSBkZWJvdW5jZWQsIGRhIGRhc1xyXG4gIC8vIFJlbmRlcm4gZGVyIExpc3RlIHZlcmdsZWljaHN3ZWlzZSB0ZXVlciBpc3QgLSByZXNldFRpbWVyOnRydWUgc2FtbWVsdCBlaW5lXHJcbiAgLy8gXHUwMEM0bmRlcnVuZ3NzZXJpZSAoei4gQi4gQnVsay1JbXBvcnQpIHp1IGVpbmVtIGVpbnppZ2VuIFJlZnJlc2guXHJcbiAgY29uc3QgZGVib3VuY2VkUmVmcmVzaCA9IGRlYm91bmNlKHJlZnJlc2gsIDUwMCwgdHJ1ZSk7XHJcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIGRlYm91bmNlZFJlZnJlc2gpKTtcclxuICAvLyBcdTAwQzRuZGVydCBkaWUgXCJFeGNsdWRlZCBmaWxlc1wiLUxpc3RlIHNlbGJzdCAoei4gQi4gSGlkZSBGb2xkZXJzIGJlaW0gQXVzLS9cclxuICAvLyBFaW5ibGVuZGVuIGVpbmVzIE9yZG5lcnMpIC0gT2JzaWRpYW5zIGVpZ2VuZXIgTWV0YWRhdGFDYWNoZSBsYXVzY2h0IGludGVyblxyXG4gIC8vIGViZW5mYWxscyBnZW5hdSBhdWYgZGllc2VzIEV2ZW50LCB1bSBzZWluZSBJZ25vcmUtRmlsdGVyIG5ldSB6dSBsYWRlbi5cclxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLnZhdWx0Lm9uKFwiY29uZmlnLWNoYW5nZWRcIiwgZGVib3VuY2VkUmVmcmVzaCkpO1xyXG5cclxuICAvLyBGXHUwMEZDciBwbHVnaW4ucmVmcmVzaFR5cENvbG9ycyAoei4gQi4gbmFjaCBVbXNjaGFsdGVuIGRlciBcIlRZUC1MaXN0ZVxyXG4gIC8vIGVpbmZcdTAwRTRyYmVuXCItRWluc3RlbGx1bmcpIC0gcmVuZGVydCBkaWUgTGlzdGUgKGJ6dy4gYmxlaWJ0IGluIGRlclxyXG4gIC8vIERldGFpbGFuc2ljaHQsIHJlbmRlcigpIGJyYW5jaCd0IHNlbGJzdCkgbmV1LlxyXG4gIHJldHVybiByZWZyZXNoO1xyXG59XHJcblxyXG4vLyBjcmVhdGVJZk1pc3Npbmc6IGZhbHNlIGJlaW0gYXV0b21hdGlzY2hlbiBvbkxheW91dFJlYWR5LUF1ZnJ1ZiAoc2llaGVcclxuLy8gcmVnaXN0ZXJUeXBWaWV3KSAtIGRlciBzb2xsIGF1c3NjaGxpZVx1MDBERmxpY2ggZWluZW4gYmVpbSBIb3QtUmVsb2FkIHZlcndhaXN0ZW4sXHJcbi8vIGFiZXIgYmVyZWl0cyB2b3JoYW5kZW5lbiBMZWFmIHdpZWRlcnZlcmJpbmRlbiAoc2llaGUgS29tbWVudGFyIGRvcnQpLCBuaWNodFxyXG4vLyBiZWkgamVkZW0gcmVndWxcdTAwRTRyZW4gT2JzaWRpYW4tU3RhcnQgdW5jb25kaXRpb25hbCBlaW5lbiBuZXVlbiBMZWFmIGVyemV1Z2VuXHJcbi8vIHVuZCBha3RpdmllcmVuLiBXYXIgZGllIFRZUC1QYW5lIGJlaW0gbGV0enRlbiBCZWVuZGVuIGdlc2NobG9zc2VuIChvZGVyXHJcbi8vIGVpbmVtIGZyaXNjaGVuIFZhdWx0KSwgYmxlaWJ0IHNpZSBvaG5lIGRpZXNlIFVudGVyc2NoZWlkdW5nIHNvbnN0IGF1Y2ggenUuXHJcbmFzeW5jIGZ1bmN0aW9uIGFjdGl2YXRlVHlwVmlldyhwbHVnaW4sIHJldmVhbCA9IHRydWUsIGNyZWF0ZUlmTWlzc2luZyA9IHRydWUpIHtcclxuICBjb25zdCBhcHAgPSBwbHVnaW4uYXBwO1xyXG4gIGNvbnN0IHsgd29ya3NwYWNlIH0gPSBhcHA7XHJcblxyXG4gIGNvbnN0IGNhbmRpZGF0ZXMgPSBbXTtcclxuICB3b3Jrc3BhY2UuaXRlcmF0ZUFsbExlYXZlcygobGVhZikgPT4ge1xyXG4gICAgaWYgKGxlYWYgPT09IGFwcC5fX2ZyZWRUeXBMZWFmIHx8IChsZWFmLnZpZXcgJiYgbGVhZi52aWV3LmdldFZpZXdUeXBlKCkgPT09IFZJRVdfVFlQRV9UWVApKSB7XHJcbiAgICAgIGNhbmRpZGF0ZXMucHVzaChsZWFmKTtcclxuICAgIH1cclxuICB9KTtcclxuXHJcbiAgbGV0IGxlYWYgPSBjYW5kaWRhdGVzLnNoaWZ0KCkgPz8gbnVsbDtcclxuICBmb3IgKGNvbnN0IGV4dHJhIG9mIGNhbmRpZGF0ZXMpIGV4dHJhLmRldGFjaCgpO1xyXG5cclxuICBpZiAoIWxlYWYpIHtcclxuICAgIGlmICghY3JlYXRlSWZNaXNzaW5nKSByZXR1cm47XHJcbiAgICBsZWFmID0gd29ya3NwYWNlLmdldExlZnRMZWFmKGZhbHNlKTtcclxuICAgIGF3YWl0IGxlYWYuc2V0Vmlld1N0YXRlKHsgdHlwZTogVklFV19UWVBFX1RZUCwgYWN0aXZlOiB0cnVlIH0pO1xyXG4gIH0gZWxzZSBpZiAoIShsZWFmLnZpZXcgaW5zdGFuY2VvZiBUeXBWaWV3KSkge1xyXG4gICAgLy8gYWN0aXZlOiBmYWxzZSAtIHJlaW5lcyBXaWVkZXJ2ZXJiaW5kZW4gbmFjaCBIb3QtUmVsb2FkIChzaWVoZSBLb21tZW50YXJcclxuICAgIC8vIG9iZW4gYW4gYWN0aXZhdGVUeXBWaWV3KSwgZGVyIExlYWYgaXN0IGphIGJlcmVpdHMgdm9yaGFuZGVuL3NpY2h0YmFyLlxyXG4gICAgLy8gTWl0IGFjdGl2ZTogdHJ1ZSB3XHUwMEZDcmRlIGplZGVyIFBsdWdpbi1SZWxvYWQgKG5pY2h0IG51ciBlaW4gQXBwLU5ldXN0YXJ0KVxyXG4gICAgLy8gZGVuIGdsb2JhbGVuIEZva3VzIGF1ZiBkaWUgVFlQLVBhbmUgcmVpXHUwMERGZW4gLSBvbkxheW91dFJlYWR5KCkgZmV1ZXJ0XHJcbiAgICAvLyBzZWluZW4gQ2FsbGJhY2sgc29mb3J0LCBzb2JhbGQgd29ya3NwYWNlLmxheW91dFJlYWR5IGVpbm1hbCB0cnVlIGlzdCxcclxuICAgIC8vIGFsc28gYmVpIGplZGVtIGVpbnplbG5lbiBIb3QtUmVsb2FkIHdcdTAwRTRocmVuZCBkZXIgRW50d2lja2x1bmcgZXJuZXV0LlxyXG4gICAgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoeyB0eXBlOiBWSUVXX1RZUEVfVFlQLCBhY3RpdmU6IGZhbHNlIH0pO1xyXG4gIH1cclxuXHJcbiAgYXBwLl9fZnJlZFR5cExlYWYgPSBsZWFmO1xyXG4gIGlmIChyZXZlYWwpIHdvcmtzcGFjZS5yZXZlYWxMZWFmKGxlYWYpO1xyXG59XHJcblxyXG4vLyBWb3JyYW5naWcgaW4gZGVyIGJlcmVpdHMgb2ZmZW5lbiBUWVAtRGV0YWlsYW5zaWNodCAoZGFubiBleGFrdCB3aWUgZGVyXHJcbi8vIGRvcnRpZ2UgKy1CdXR0b24pLCBzb25zdCB3aXJkIGRpZSBEZXRhaWxhbnNpY2h0IGZcdTAwRkNyIGRlbiBUWVAgZGVyIGFrdGl2ZW5cclxuLy8gTm90aXogZ2VcdTAwRjZmZm5ldCB1bmQgZGllIFByb3BlcnR5IGRvcnQgZXJnXHUwMEU0bnp0LiBJc3Qga2VpbmUgTm90aXogb2ZmZW4gb2RlclxyXG4vLyBoYXQgc2llIGtlaW5lbiBUWVAsIGRpZW50IGVpbmUgendhciBuaWNodCBmb2t1c3NpZXJ0ZSwgYWJlciBpbiBkZXJcclxuLy8gRGV0YWlsYW5zaWNodCBvZmZlbmUgVFlQLVZpZXcgYWxzIFJcdTAwRkNja2ZhbGxlYmVuZS4gSXN0IG51ciBkaWUgVFlQZW4tTGlzdGVcclxuLy8gb2ZmZW4gKGtlaW4gc2VsZWN0ZWRUeXBlKSwgelx1MDBFNGhsdCBkYXMgbmljaHQgYWxzIFwib2ZmZW5lIERldGFpbGFuc2ljaHRcIiAtXHJcbi8vIGRhZlx1MDBGQ3IgZmVobHQgZG9ydCBlaW4gRnJvbnRtYXR0ZXItRWRpdG9yLCBhbiBkZW0gc2ljaCBldHdhcyBoaW56dWZcdTAwRkNnZW4gbGllXHUwMERGZS5cclxuYXN5bmMgZnVuY3Rpb24gYWRkVHlwUHJvcGVydHlDb21tYW5kKHBsdWdpbikge1xyXG4gIGNvbnN0IGFwcCA9IHBsdWdpbi5hcHA7XHJcblxyXG4gIGNvbnN0IGFjdGl2ZVR5cFZpZXcgPSBhcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoVHlwVmlldyk7XHJcbiAgaWYgKGFjdGl2ZVR5cFZpZXcgJiYgYWN0aXZlVHlwVmlldy5zZWxlY3RlZFR5cGUgIT09IG51bGwpIHtcclxuICAgIGFjdGl2ZVR5cFZpZXcuZnJvbnRtYXR0ZXJCbG9ja3M/LmFkZEJsYW5rKG51bGwpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgZmlsZSA9IGFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xyXG4gIGNvbnN0IHR5cGUgPSBwbHVnaW4udHlwSW5kZXgudHlwZU9mKGZpbGUpO1xyXG4gIGlmICghdHlwZSkge1xyXG4gICAgY29uc3Qgb3BlbkxlYWYgPSBhcHAud29ya3NwYWNlXHJcbiAgICAgIC5nZXRMZWF2ZXNPZlR5cGUoVklFV19UWVBFX1RZUClcclxuICAgICAgLmZpbmQoKGxlYWYpID0+IGxlYWYudmlldyBpbnN0YW5jZW9mIFR5cFZpZXcgJiYgbGVhZi52aWV3LnNlbGVjdGVkVHlwZSAhPT0gbnVsbCk7XHJcbiAgICBpZiAob3BlbkxlYWYpIHtcclxuICAgICAgYXdhaXQgYXBwLndvcmtzcGFjZS5yZXZlYWxMZWFmKG9wZW5MZWFmKTtcclxuICAgICAgb3BlbkxlYWYudmlldy5mcm9udG1hdHRlckJsb2Nrcz8uYWRkQmxhbmsobnVsbCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIG5ldyBOb3RpY2UoZmlsZSA/IFwiQWt0aXZlIE5vdGl6IGhhdCBrZWluZW4gVFlQIHVuZCBpbiBkZXIgVFlQLVZpZXcgaXN0IGtlaW4gVFlQIGdlXHUwMEY2ZmZuZXQuXCIgOiBcIktlaW5lIE5vdGl6IG9mZmVuIHVuZCBpbiBkZXIgVFlQLVZpZXcgaXN0IGtlaW4gVFlQIGdlXHUwMEY2ZmZuZXQuXCIpO1xyXG4gICAgcmV0dXJuO1xyXG4gIH1cclxuXHJcbiAgYXdhaXQgYWN0aXZhdGVUeXBWaWV3KHBsdWdpbik7XHJcbiAgY29uc3QgdmlldyA9IGFwcC5fX2ZyZWRUeXBMZWFmPy52aWV3O1xyXG4gIGlmICghKHZpZXcgaW5zdGFuY2VvZiBUeXBWaWV3KSkgcmV0dXJuO1xyXG4gIHZpZXcub3BlblR5cGVTZXR0aW5ncyh0eXBlKTtcclxuICB2aWV3LmZyb250bWF0dGVyQmxvY2tzPy5hZGRCbGFuayhudWxsKTtcclxufVxyXG5cclxuLy8gXHUwMEQ2ZmZuZXQgYmVpIEJlZGFyZiBlcnN0IGRpZSBUWVAtVmlldyAoYnp3LiB2ZXJsXHUwMEU0c3N0IGVpbmUgb2ZmZW5lIERldGFpbGFuc2ljaHRcclxuLy8genVyXHUwMEZDY2sgenVyIExpc3RlIC0gc3RhcnRBZGQoKSBsZWd0IGRhcyBuZXVlIFRyZWUtSXRlbSBpbiB0aGlzLmxpc3RFbCBhbiwgZGFzXHJcbi8vIGVzIG51ciBpbiBkZXIgTGlzdGVuYW5zaWNodCBnaWJ0KSwgdW5kIHN0XHUwMEY2XHUwMERGdCBkb3J0IGRlbnNlbGJlbiBBYmxhdWYgd2llIGRlclxyXG4vLyArLUJ1dHRvbiBpbSBMaXN0ZW4tSGVhZGVyIGFuLlxyXG5hc3luYyBmdW5jdGlvbiBhZGRUeXBDb21tYW5kKHBsdWdpbikge1xyXG4gIGF3YWl0IGFjdGl2YXRlVHlwVmlldyhwbHVnaW4pO1xyXG4gIGNvbnN0IHZpZXcgPSBwbHVnaW4uYXBwLl9fZnJlZFR5cExlYWY/LnZpZXc7XHJcbiAgaWYgKCEodmlldyBpbnN0YW5jZW9mIFR5cFZpZXcpKSByZXR1cm47XHJcbiAgaWYgKHZpZXcuc2VsZWN0ZWRUeXBlICE9PSBudWxsKSB2aWV3LmNsb3NlVHlwZVNldHRpbmdzKCk7XHJcbiAgdmlldy5zdGFydEFkZCgpO1xyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJUeXBWaWV3LCBWSUVXX1RZUEVfVFlQLCBjb21wYXJlVHlwZXMsIHNvcnRUeXBlc0J5TW9kZSwgREVGQVVMVF9TT1JUX09SREVSLCBERUZBVUxUX1RZUEVfQ09MT1IgfTtcclxuIiwgImNvbnN0IHsgVEZpbGUsIFRGb2xkZXIgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgY29sb3JGb3JGaWxlIH0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcblxuY29uc3QgRklMRV9FWFBMT1JFUl9WSUVXX1RZUEUgPSBcImZpbGUtZXhwbG9yZXJcIjtcbmNvbnN0IEZPTERFUl9OT1RFU19QTFVHSU5fSUQgPSBcImZvbGRlci1ub3Rlc1wiO1xuXG4vLyBEYXMgXCJGb2xkZXIgTm90ZXNcIi1QbHVnaW4gemVpZ3QgZWluZSBOb3RpeiBzdGF0dCBhbHMgZWlnZW5lIFplaWxlIGFscyBPcmRuZXIgYW4uXG4vLyBFcyBoYXQga2VpbmUgXHUwMEY2ZmZlbnRsaWNoZSBBUEkgZGFmXHUwMEZDciwgZGFoZXIgZGVuIERhdGVpbmFtZW4gYXVzIHNlaW5lbiBlaWdlbmVuXG4vLyAoTGl2ZS0pRWluc3RlbGx1bmdlbiBuYWNoYmF1ZW4sIHN0YXR0IHNlaW5lIGludGVybmVuIEZ1bmt0aW9uZW4gYW56dXphcGZlbi5cbmZ1bmN0aW9uIGdldEZvbGRlck5vdGVGaWxlKHBsdWdpbiwgZm9sZGVyKSB7XG4gIGNvbnN0IGZvbGRlck5vdGVzID0gcGx1Z2luLmFwcC5wbHVnaW5zLnBsdWdpbnNbRk9MREVSX05PVEVTX1BMVUdJTl9JRF07XG4gIGNvbnN0IHNldHRpbmdzID0gZm9sZGVyTm90ZXM/LnNldHRpbmdzO1xuICBpZiAoIXNldHRpbmdzKSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBmaWxlTmFtZSA9XG4gICAgKHNldHRpbmdzLmZvbGRlck5vdGVOYW1lIHx8IFwie3tmb2xkZXJfbmFtZX19XCIpLnJlcGxhY2UoXCJ7e2ZvbGRlcl9uYW1lfX1cIiwgZm9sZGVyLm5hbWUpICtcbiAgICAoc2V0dGluZ3MuZm9sZGVyTm90ZVR5cGUgfHwgXCIubWRcIik7XG4gIGNvbnN0IGRpclBhdGggPSBzZXR0aW5ncy5zdG9yYWdlTG9jYXRpb24gPT09IFwicGFyZW50Rm9sZGVyXCIgPyBmb2xkZXIucGFyZW50Py5wYXRoID8/IFwiXCIgOiBmb2xkZXIucGF0aDtcbiAgY29uc3QgcGF0aCA9IGRpclBhdGggPyBgJHtkaXJQYXRofS8ke2ZpbGVOYW1lfWAgOiBmaWxlTmFtZTtcblxuICBjb25zdCBmaWxlID0gcGx1Z2luLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgocGF0aCk7XG4gIHJldHVybiBmaWxlIGluc3RhbmNlb2YgVEZpbGUgPyBmaWxlIDogbnVsbDtcbn1cblxuZnVuY3Rpb24gYXBwbHlDb2xvclRvVGl0bGUocGx1Z2luLCB0aXRsZUVsLCBmaWxlKSB7XG4gIGNvbnN0IGNvbnRlbnRFbCA9IHRpdGxlRWwucXVlcnlTZWxlY3RvcihcIi5uYXYtZmlsZS10aXRsZS1jb250ZW50LCAubmF2LWZvbGRlci10aXRsZS1jb250ZW50XCIpO1xuICBpZiAoIWNvbnRlbnRFbCkgcmV0dXJuO1xuXG4gIGNvbnN0IGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MuZmlsZUV4cGxvcmVyID8gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSwgXCJmaWxlRXhwbG9yZXJcIikgOiBudWxsO1xuICBpZiAoY29sb3IpIGNvbnRlbnRFbC5zdHlsZS5jb2xvciA9IGNvbG9yO1xuICBlbHNlIGNvbnRlbnRFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImNvbG9yXCIpO1xufVxuXG5mdW5jdGlvbiBhcHBseUZpbGVFeHBsb3JlckNvbG9ycyhwbHVnaW4pIHtcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShGSUxFX0VYUExPUkVSX1ZJRVdfVFlQRSkpIHtcbiAgICBjb25zdCBmaWxlVGl0bGVFbHMgPSBsZWFmLnZpZXcuY29udGFpbmVyRWwucXVlcnlTZWxlY3RvckFsbChcIi5uYXYtZmlsZS10aXRsZVtkYXRhLXBhdGhdXCIpO1xuICAgIGZvciAoY29uc3QgdGl0bGVFbCBvZiBmaWxlVGl0bGVFbHMpIHtcbiAgICAgIGNvbnN0IGZpbGUgPSBwbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aCh0aXRsZUVsLmdldEF0dHJpYnV0ZShcImRhdGEtcGF0aFwiKSk7XG4gICAgICBhcHBseUNvbG9yVG9UaXRsZShwbHVnaW4sIHRpdGxlRWwsIGZpbGUgaW5zdGFuY2VvZiBURmlsZSA/IGZpbGUgOiBudWxsKTtcbiAgICB9XG5cbiAgICBjb25zdCBmb2xkZXJUaXRsZUVscyA9IGxlYWYudmlldy5jb250YWluZXJFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLm5hdi1mb2xkZXItdGl0bGVbZGF0YS1wYXRoXVwiKTtcbiAgICBmb3IgKGNvbnN0IHRpdGxlRWwgb2YgZm9sZGVyVGl0bGVFbHMpIHtcbiAgICAgIGNvbnN0IGZvbGRlciA9IHBsdWdpbi5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHRpdGxlRWwuZ2V0QXR0cmlidXRlKFwiZGF0YS1wYXRoXCIpKTtcbiAgICAgIGNvbnN0IG5vdGVGaWxlID0gZm9sZGVyIGluc3RhbmNlb2YgVEZvbGRlciA/IGdldEZvbGRlck5vdGVGaWxlKHBsdWdpbiwgZm9sZGVyKSA6IG51bGw7XG4gICAgICBhcHBseUNvbG9yVG9UaXRsZShwbHVnaW4sIHRpdGxlRWwsIG5vdGVGaWxlKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJGaWxlRXhwbG9yZXJDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseUZpbGVFeHBsb3JlckNvbG9ycyhwbHVnaW4pO1xuXG4gIC8vIERlciBGaWxlLUV4cGxvcmVyIHJlbmRlcnQgRWludHJcdTAwRTRnZSBiZWltIEF1Zi0vWnVrbGFwcGVuIHZvbiBPcmRuZXJuIGR5bmFtaXNjaFxuICAvLyBuZXUgLSBwZXIgTXV0YXRpb25PYnNlcnZlciBhdWYgbmV1IGVpbmdlZlx1MDBGQ2d0ZSBFbGVtZW50ZSByZWFnaWVyZW4sIHN0YXR0IG51clxuICAvLyBlaW5tYWxpZyBiZWltIFN0YXJ0IGVpbnp1Zlx1MDBFNHJiZW4uXG4gIGNvbnN0IG9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIocmVmcmVzaCk7XG4gIGNvbnN0IG9ic2VydmVFeHBsb3JlckxlYXZlcyA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEZJTEVfRVhQTE9SRVJfVklFV19UWVBFKSkge1xuICAgICAgb2JzZXJ2ZXIub2JzZXJ2ZShsZWFmLnZpZXcuY29udGFpbmVyRWwsIHsgY2hpbGRMaXN0OiB0cnVlLCBzdWJ0cmVlOiB0cnVlIH0pO1xuICAgIH1cbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IG9ic2VydmVyLmRpc2Nvbm5lY3QoKSk7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC52YXVsdC5vbihcInJlbmFtZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KFxuICAgIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICBvYnNlcnZlRXhwbG9yZXJMZWF2ZXMoKTtcbiAgICAgIHJlZnJlc2goKTtcbiAgICB9KVxuICApO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgIG9ic2VydmVFeHBsb3JlckxlYXZlcygpO1xuICAgIHJlZnJlc2goKTtcbiAgfSk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckZpbGVFeHBsb3JlckNvbG9ycyB9O1xuIiwgImNvbnN0IHsgY29sb3JGb3JGaWxlIH0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcblxuY29uc3QgR1JBUEhfVklFV19UWVBFUyA9IFtcImdyYXBoXCIsIFwibG9jYWxncmFwaFwiXTtcblxuZnVuY3Rpb24gaGV4VG9JbnQoaGV4KSB7XG4gIHJldHVybiBwYXJzZUludChoZXgucmVwbGFjZShcIiNcIiwgXCJcIiksIDE2KTtcbn1cblxuLy8gZW5naW5lLnJlbmRlcigpIGxpZXN0IHNlaW4gaW50ZXJuZXMgZmlsZUZpbHRlci1PYmpla3QgbnVyIGF1cywgd2VubiBiZXJlaXRzXG4vLyBtaW5kZXN0ZW5zIGVpbmUgZWlnZW5lIEZhcmJncnVwcGUvRmlsdGVyLVF1ZXJ5IGFrdGl2IGlzdCAtIG9obmUgZWlnZW5lIEdydXBwZW5cbi8vIGJla29tbXQgamVkZSBEYXRlaSBwYXVzY2hhbCBjb2xvcjp0cnVlIChrZWluIEZhcmJ3ZXJ0KSwgZmlsZUZpbHRlciB3aXJkIGdhclxuLy8gbmljaHQgZXJzdCBrb25zdWx0aWVydC4gUm9idXN0ZXIgaXN0IGRlciBFaW5ncmlmZiBkaXJla3QgYW4gcmVuZGVyZXIuc2V0RGF0YSxcbi8vIHVubWl0dGVsYmFyIGJldm9yIGRpZSBmZXJ0aWdlbiBOb2RlLURhdGVuIGFuIGRlbiBXZWJHTC1SZW5kZXJlciBnZWhlbiAtIGFuXG4vLyBleGFrdCBkaWVzZXIgU3RlbGxlIHBhdGNodCBhdWNoIGRhcyBDb21tdW5pdHktUGx1Z2luIFwiZ3JhcGgtbmVzdGVkLXRhZ3NcIi5cbi8vIEVpZ2VuZSBGYXJiZ3J1cHBlbiBoYWJlbiBkb3J0IG5vZGUuY29sb3IgYmVyZWl0cyBnZXNldHp0IHVuZCBibGVpYmVuIHVuYW5nZXRhc3RldC5cbmZ1bmN0aW9uIHBhdGNoUmVuZGVyZXIocGx1Z2luLCByZW5kZXJlcikge1xuICBpZiAocmVuZGVyZXIuX19mcmVkVHlwQ29sb3JQYXRjaGVkKSByZXR1cm47XG4gIHJlbmRlcmVyLl9fZnJlZFR5cENvbG9yUGF0Y2hlZCA9IHRydWU7XG5cbiAgY29uc3Qgb3JpZ2luYWwgPSByZW5kZXJlci5zZXREYXRhO1xuICByZW5kZXJlci5zZXREYXRhID0gZnVuY3Rpb24gKGRhdGEpIHtcbiAgICBmb3IgKGNvbnN0IHBhdGggaW4gZGF0YS5ub2Rlcykge1xuICAgICAgY29uc3Qgbm9kZSA9IGRhdGEubm9kZXNbcGF0aF07XG4gICAgICBpZiAobm9kZS5jb2xvcikgY29udGludWU7XG5cbiAgICAgIGlmIChub2RlLnR5cGUgPT09IFwidGFnXCIpIHtcbiAgICAgICAgLy8gRWlnZW5lIFRhZy1GYXJiZSBkZWFrdGl2aWVydCAoMzAuMDkuMjAyNik6IFRhZy1Lbm90ZW4gbGFzc2VuIHNpY2ggaW1cbiAgICAgICAgLy8gTWluaW1hbCBUaGVtZSBiZXJlaXRzIFx1MDBGQ2JlciBkaWUgU3R5bGUgU2V0dGluZ3MgZWluZlx1MDBFNHJiZW4gKEdyYXBocyBcdTIxOTJcbiAgICAgICAgLy8gXCJUYWcgbm9kZSBjb2xvclwiKSwgZGFzIGhpZXIgd2FyIGVpbmUgRG9wcGx1bmcuIERpZSBUWVAtRWluZlx1MDBFNHJidW5nIGRlclxuICAgICAgICAvLyBOb3Rpei1Lbm90ZW4gdW50ZW4gYmxlaWJ0LCBkaWUga2FubiBTdHlsZSBTZXR0aW5ncyBuaWNodC5cbiAgICAgICAgLy8gaWYgKHBsdWdpbi5zZXR0aW5ncy5ncmFwaFRhZ0NvbG9yRW5hYmxlZCAmJiBwbHVnaW4uc2V0dGluZ3MuZ3JhcGhUYWdDb2xvcikge1xuICAgICAgICAvLyAgIG5vZGUuY29sb3IgPSB7IGE6IDEsIHJnYjogaGV4VG9JbnQocGx1Z2luLnNldHRpbmdzLmdyYXBoVGFnQ29sb3IpIH07XG4gICAgICAgIC8vIH1cbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGZpbGUgPSBwbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChwYXRoKTtcbiAgICAgIGxldCBjb2xvciA9IG51bGw7XG5cbiAgICAgIGlmIChmaWxlICYmIGZpbGUuZXh0ZW5zaW9uICE9PSBcIm1kXCIpIHtcbiAgICAgICAgLy8gRWlnZW5lIEFuaFx1MDBFNG5nZS1GYXJiZSBkZWFrdGl2aWVydCAoMzAuMDkuMjAyNiksIHdpZSBkaWUgVGFnLUZhcmJlIG9iZW46XG4gICAgICAgIC8vIFN0eWxlIFNldHRpbmdzIGRlcyBNaW5pbWFsIFRoZW1lLCBHcmFwaHMgXHUyMTkyIFwiQXR0YWNobWVudCBub2RlIGNvbG9yXCIuXG4gICAgICAgIC8vIGlmIChwbHVnaW4uc2V0dGluZ3MuZ3JhcGhBdHRhY2htZW50Q29sb3JFbmFibGVkICYmIHBsdWdpbi5zZXR0aW5ncy5ncmFwaEF0dGFjaG1lbnRDb2xvcikge1xuICAgICAgICAvLyAgIGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmdyYXBoQXR0YWNobWVudENvbG9yO1xuICAgICAgICAvLyB9XG4gICAgICB9IGVsc2UgaWYgKHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmdyYXBoKSB7XG4gICAgICAgIGNvbG9yID0gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSwgXCJncmFwaFwiKTtcbiAgICAgIH1cblxuICAgICAgaWYgKGNvbG9yKSBub2RlLmNvbG9yID0geyBhOiAxLCByZ2I6IGhleFRvSW50KGNvbG9yKSB9O1xuICAgIH1cbiAgICByZXR1cm4gb3JpZ2luYWwuY2FsbCh0aGlzLCBkYXRhKTtcbiAgfTtcblxuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4ge1xuICAgIHJlbmRlcmVyLnNldERhdGEgPSBvcmlnaW5hbDtcbiAgICBkZWxldGUgcmVuZGVyZXIuX19mcmVkVHlwQ29sb3JQYXRjaGVkO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gZ2V0R3JhcGhMZWF2ZXMoYXBwKSB7XG4gIGNvbnN0IGxlYXZlcyA9IFtdO1xuICBmb3IgKGNvbnN0IHR5cGUgb2YgR1JBUEhfVklFV19UWVBFUykgbGVhdmVzLnB1c2goLi4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUodHlwZSkpO1xuICByZXR1cm4gbGVhdmVzO1xufVxuXG5mdW5jdGlvbiByZWdpc3RlckdyYXBoQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBnZXRHcmFwaExlYXZlcyhwbHVnaW4uYXBwKSkge1xuICAgICAgaWYgKGxlYWYudmlldz8ucmVuZGVyZXIpIHBhdGNoUmVuZGVyZXIocGx1Z2luLCBsZWFmLnZpZXcucmVuZGVyZXIpO1xuICAgICAgLy8gRGVyIGdsb2JhbGUgR3JhcGggaFx1MDBFNGx0IHNlaW5lIEVuZ2luZSBpbiB2aWV3LmRhdGFFbmdpbmUsIGRlciBsb2thbGUgaW5cbiAgICAgIC8vIHZpZXcuZW5naW5lIC0gb2huZSBkZW4gendlaXRlbiBGYWxsIGJla2FtIGVpbiBsb2thbGVyIEdyYXBoIGVpbmVcbiAgICAgIC8vIGdlXHUwMEU0bmRlcnRlIFRZUC1GYXJiZSBlcnN0IGJlaW0gblx1MDBFNGNoc3RlbiBlaWdlbmVuIE5ldWF1ZmJhdSB6dSBzZWhlbi5cbiAgICAgIChsZWFmLnZpZXc/LmRhdGFFbmdpbmUgPz8gbGVhZi52aWV3Py5lbmdpbmUpPy5yZW5kZXIoKTtcbiAgICB9XG4gIH07XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgLy8gTnVyIGJlaSB0YXRzXHUwMEU0Y2hsaWNoIGdlXHUwMEU0bmRlcnRlbSBUWVAgKHNpZWhlIHR5cC1pbmRleC5qcykgLSBzb25zdCB6ZWlndGUgZGVyXG4gIC8vIEdyYXBoIGVpbmUgdW1nZXRyYWdlbmUgRmFyYmUgZXJzdCBuYWNoIGRlbSBuXHUwMEU0Y2hzdGVuIGVpZ2VuZW4gTmV1YXVmYmF1LlxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KHJlZnJlc2gpO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJHcmFwaENvbG9ycyB9O1xuIiwgImNvbnN0IHsgY29sb3JGb3JGaWxlIH0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcblxuY29uc3QgU0VBUkNIX1ZJRVdfVFlQRSA9IFwic2VhcmNoXCI7XG5cbi8vIEVyZ2VibmlzemVpbGVuIGltIFNlYXJjaCBWaWV3IHRyYWdlbiBrZWluIGRhdGEtcGF0aC1BdHRyaWJ1dCwgYWJlciBkaWVcbi8vIFNlYXJjaFZpZXcgcGZsZWd0IGludGVybiBlaW5lIE1hcCB2b24gVEZpbGUgLT4gRXJnZWJuaXMtRE9NLU9iamVrdFxuLy8gKGRvbS5yZXN1bHREb21Mb29rdXApIC0gZGFyXHUwMEZDYmVyIGxcdTAwRTRzc3Qgc2ljaCBEYXRlaSB1bmQgWmVpbGUgZGlyZWt0IHZlcmJpbmRlbi5cbmZ1bmN0aW9uIGFwcGx5U2VhcmNoQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFNFQVJDSF9WSUVXX1RZUEUpKSB7XG4gICAgY29uc3QgcmVzdWx0RG9tTG9va3VwID0gbGVhZi52aWV3Py5kb20/LnJlc3VsdERvbUxvb2t1cDtcbiAgICBpZiAoIXJlc3VsdERvbUxvb2t1cCkgY29udGludWU7XG5cbiAgICBmb3IgKGNvbnN0IFtmaWxlLCByZXN1bHREb21dIG9mIHJlc3VsdERvbUxvb2t1cCkge1xuICAgICAgY29uc3QgdGl0bGVFbCA9IHJlc3VsdERvbS5lbD8ucXVlcnlTZWxlY3RvcihcIi5zZWFyY2gtcmVzdWx0LWZpbGUtdGl0bGUgLnRyZWUtaXRlbS1pbm5lclwiKTtcbiAgICAgIGlmICghdGl0bGVFbCkgY29udGludWU7XG5cbiAgICAgIGNvbnN0IGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Muc2VhcmNoID8gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSwgXCJzZWFyY2hcIikgOiBudWxsO1xuICAgICAgaWYgKGNvbG9yKSB0aXRsZUVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gICAgICBlbHNlIHRpdGxlRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJTZWFyY2hDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseVNlYXJjaENvbG9ycyhwbHVnaW4pO1xuXG4gIC8vIEVyZ2Vibmlzc2Ugd2VyZGVuIGJlaSBqZWRlciBTdWNoZWluZ2FiZSBrb21wbGV0dCBuZXUgYXVmZ2ViYXV0LlxuICBjb25zdCBvYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKHJlZnJlc2gpO1xuICBjb25zdCBvYnNlcnZlTGVhdmVzID0gKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoU0VBUkNIX1ZJRVdfVFlQRSkpIHtcbiAgICAgIG9ic2VydmVyLm9ic2VydmUobGVhZi52aWV3LmNvbnRhaW5lckVsLCB7IGNoaWxkTGlzdDogdHJ1ZSwgc3VidHJlZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiBvYnNlcnZlci5kaXNjb25uZWN0KCkpO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KFxuICAgIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgICByZWZyZXNoKCk7XG4gICAgfSlcbiAgKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgcmVmcmVzaCgpO1xuICB9KTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyU2VhcmNoQ29sb3JzIH07XG4iLCAiY29uc3QgeyBjb2xvckZvckZpbGUgfSA9IHJlcXVpcmUoXCIuL3R5cGUtY29sb3JzXCIpO1xuXG5jb25zdCBSRUNFTlRfRklMRVNfVklFV19UWVBFID0gXCJyZWNlbnQtZmlsZXNcIjtcblxuLy8gUmVjZW50IEZpbGVzIHNldHp0IGtlaW4gZGF0YS1wYXRoLUF0dHJpYnV0IGF1ZiBzZWluZSBaZWlsZW4uIEVzIHJlbmRlcnQgc2VpbmVcbi8vIExpc3RlIGFiZXIgb2huZSBcdTAwRkNiZXJzcHJ1bmdlbmUgRWludHJcdTAwRTRnZSBkaXJla3QgYXVzIGRhdGEucmVjZW50RmlsZXMsIGRhaGVyXG4vLyBsXHUwMEU0c3N0IHNpY2ggZGllIFplaWxlIFx1MDBGQ2JlciBkZW4gSW5kZXggZWluZGV1dGlnIGRlbSBQZmFkIHp1b3JkbmVuLlxuZnVuY3Rpb24gYXBwbHlSZWNlbnRGaWxlc0NvbG9ycyhwbHVnaW4pIHtcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShSRUNFTlRfRklMRVNfVklFV19UWVBFKSkge1xuICAgIGNvbnN0IHJlY2VudEZpbGVzID0gbGVhZi52aWV3Py5kYXRhPy5yZWNlbnRGaWxlcztcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocmVjZW50RmlsZXMpKSBjb250aW51ZTtcblxuICAgIGNvbnN0IHRpdGxlRWxzID0gbGVhZi52aWV3LmNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIucmVjZW50LWZpbGVzLXRpdGxlIC5uYXYtZmlsZS10aXRsZS1jb250ZW50XCIpO1xuICAgIHRpdGxlRWxzLmZvckVhY2goKHRpdGxlRWwsIGluZGV4KSA9PiB7XG4gICAgICBjb25zdCBlbnRyeSA9IHJlY2VudEZpbGVzW2luZGV4XTtcbiAgICAgIGNvbnN0IGZpbGUgPSBlbnRyeSA/IHBsdWdpbi5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGVudHJ5LnBhdGgpIDogbnVsbDtcbiAgICAgIGNvbnN0IGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MucmVjZW50RmlsZXMgPyBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCBcInJlY2VudEZpbGVzXCIpIDogbnVsbDtcbiAgICAgIGlmIChjb2xvcikgdGl0bGVFbC5zdHlsZS5jb2xvciA9IGNvbG9yO1xuICAgICAgZWxzZSB0aXRsZUVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiY29sb3JcIik7XG4gICAgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJSZWNlbnRGaWxlc0NvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5UmVjZW50RmlsZXNDb2xvcnMocGx1Z2luKTtcblxuICBjb25zdCBvYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKHJlZnJlc2gpO1xuICBjb25zdCBvYnNlcnZlTGVhdmVzID0gKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoUkVDRU5UX0ZJTEVTX1ZJRVdfVFlQRSkpIHtcbiAgICAgIG9ic2VydmVyLm9ic2VydmUobGVhZi52aWV3LmNvbnRhaW5lckVsLCB7IGNoaWxkTGlzdDogdHJ1ZSwgc3VidHJlZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiBvYnNlcnZlci5kaXNjb25uZWN0KCkpO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KFxuICAgIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgICByZWZyZXNoKCk7XG4gICAgfSlcbiAgKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgcmVmcmVzaCgpO1xuICB9KTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyUmVjZW50RmlsZXNDb2xvcnMgfTtcbiIsICJjb25zdCB7IGNvbG9yRm9yRmlsZSB9ID0gcmVxdWlyZShcIi4vdHlwZS1jb2xvcnNcIik7XG5cbmNvbnN0IEJBQ0tMSU5LX1ZJRVdfVFlQRSA9IFwiYmFja2xpbmtcIjtcblxuLy8gRGFzIEJhY2tsaW5rcy1QYW5lIChTZWl0ZW5sZWlzdGUpIHJlbmRlcnQgVHJlZmZlciBpbnRlcm4gXHUwMEZDYmVyIGRpZXNlbGJlXG4vLyBTZWFyY2hSZXN1bHREb20tS2xhc3NlIHdpZSBkaWUgU3VjaGUuIFZlcmxpbmt0ZSB1bmQgbmljaHQgdmVybGlua3RlXG4vLyBFcndcdTAwRTRobnVuZ2VuIGxpZWdlbiBhbHMgendlaSByZXN1bHREb21Mb29rdXAtTWFwcyBpbSBCYWNrbGlua1JlbmRlcmVyXG4vLyAodmlldy5iYWNrbGluaykgLSBGZWxkbmFtZW4gc2luZCBuaWNodCBvZmZpemllbGwgZG9rdW1lbnRpZXJ0LCBkYWhlclxuLy8gbWVocmVyZSBiZWthbm50ZSBQZmFkZSBwcm9iaWVyZW4gc3RhdHQgZWluZW4gZmVzdCBhbnp1bmVobWVuLlxuZnVuY3Rpb24gZ2V0UmVzdWx0RG9tTG9va3Vwcyh2aWV3KSB7XG4gIGNvbnN0IHJlbmRlcmVyID0gdmlldz8uYmFja2xpbms7XG4gIGNvbnN0IGNhbmRpZGF0ZXMgPSBbcmVuZGVyZXI/LmJhY2tsaW5rRG9tLCByZW5kZXJlcj8udW5saW5rZWREb20sIHZpZXc/LmJhY2tsaW5rRG9tLCB2aWV3Py51bmxpbmtlZERvbSwgdmlldz8uZG9tXTtcblxuICBjb25zdCBsb29rdXBzID0gW107XG4gIGZvciAoY29uc3QgZG9tIG9mIGNhbmRpZGF0ZXMpIHtcbiAgICBpZiAoZG9tPy5yZXN1bHREb21Mb29rdXAgaW5zdGFuY2VvZiBNYXApIGxvb2t1cHMucHVzaChkb20ucmVzdWx0RG9tTG9va3VwKTtcbiAgfVxuICByZXR1cm4gbG9va3Vwcztcbn1cblxuZnVuY3Rpb24gY29sb3JUaXRsZUVsKHBsdWdpbiwgZWwsIGZpbGUpIHtcbiAgY29uc3QgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5iYWNrbGlua3MgPyBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCBcImJhY2tsaW5rc1wiKSA6IG51bGw7XG4gIGlmIChjb2xvcikgZWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcbiAgZWxzZSBlbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImNvbG9yXCIpO1xufVxuXG5mdW5jdGlvbiBhcHBseUJhY2tsaW5rUGFuZUNvbG9ycyhwbHVnaW4pIHtcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShCQUNLTElOS19WSUVXX1RZUEUpKSB7XG4gICAgZm9yIChjb25zdCBsb29rdXAgb2YgZ2V0UmVzdWx0RG9tTG9va3VwcyhsZWFmLnZpZXcpKSB7XG4gICAgICBmb3IgKGNvbnN0IFtmaWxlLCByZXN1bHREb21dIG9mIGxvb2t1cCkge1xuICAgICAgICBjb25zdCB0aXRsZUVsID0gcmVzdWx0RG9tLmVsPy5xdWVyeVNlbGVjdG9yKFwiLnNlYXJjaC1yZXN1bHQtZmlsZS10aXRsZSAudHJlZS1pdGVtLWlubmVyXCIpO1xuICAgICAgICBpZiAodGl0bGVFbCkgY29sb3JUaXRsZUVsKHBsdWdpbiwgdGl0bGVFbCwgZmlsZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG59XG5cbi8vIFwiQmFja2xpbmtzIGltIERva3VtZW50XCIgaXN0IGtlaW5lIGVpZ2VuZSBBbnNpY2h0L2tlaW4gZWlnZW5lciBMZWFmLCBzb25kZXJuXG4vLyB1bnRlbiBpbiBkaWUgTWFya2Rvd25WaWV3IGVpbmdlYmV0dGV0ICguZW1iZWRkZWQtYmFja2xpbmtzKSAtIGhpZXIgcmVpY2h0XG4vLyBrZWluIExlYWYtVHlwLCBzdGF0dGRlc3NlbiBcdTAwRkNiZXIgb2ZmZW5lIE1hcmtkb3duLUxlYXZlcyBuYWNoIGRlciBET00tS2xhc3NlXG4vLyBzdWNoZW4uIE9obmUgZGF0YS1wYXRoIGplIFplaWxlIHdpcmQgZGllIERhdGVpIFx1MDBGQ2JlciBkZW4gYW5nZXplaWd0ZW5cbi8vIERhdGVpbmFtZW4gKExpbmt0ZXh0KSBhdWZnZWxcdTAwRjZzdCwgd2llIE9ic2lkaWFuIGludGVybiBMaW5rcyBhdWZsXHUwMEY2c3QuXG5mdW5jdGlvbiBhcHBseUVtYmVkZGVkQmFja2xpbmtDb2xvcnMocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xuICAgIGNvbnN0IHBhbmVFbCA9IGxlYWYudmlldy5jb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKFwiLmVtYmVkZGVkLWJhY2tsaW5rcyAuYmFja2xpbmstcGFuZVwiKTtcbiAgICBpZiAoIXBhbmVFbCkgY29udGludWU7XG5cbiAgICBjb25zdCBzb3VyY2VQYXRoID0gbGVhZi52aWV3LmZpbGU/LnBhdGggPz8gXCJcIjtcbiAgICBjb25zdCB0aXRsZUVscyA9IHBhbmVFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLnNlYXJjaC1yZXN1bHQtZmlsZS10aXRsZSAudHJlZS1pdGVtLWlubmVyXCIpO1xuICAgIGZvciAoY29uc3QgdGl0bGVFbCBvZiB0aXRsZUVscykge1xuICAgICAgY29uc3QgYmFzZW5hbWUgPSB0aXRsZUVsLnRleHRDb250ZW50O1xuICAgICAgY29uc3QgZmlsZSA9IGJhc2VuYW1lID8gcGx1Z2luLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpcnN0TGlua3BhdGhEZXN0KGJhc2VuYW1lLCBzb3VyY2VQYXRoKSA6IG51bGw7XG4gICAgICBjb2xvclRpdGxlRWwocGx1Z2luLCB0aXRsZUVsLCBmaWxlKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gYXBwbHlCYWNrbGlua0NvbG9ycyhwbHVnaW4pIHtcbiAgYXBwbHlCYWNrbGlua1BhbmVDb2xvcnMocGx1Z2luKTtcbiAgYXBwbHlFbWJlZGRlZEJhY2tsaW5rQ29sb3JzKHBsdWdpbik7XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyQmFja2xpbmtDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseUJhY2tsaW5rQ29sb3JzKHBsdWdpbik7XG5cbiAgLy8gTnVyIGRhcyAoa2xlaW5lKSBCYWNrbGlua3MtUGFuZSBpbiBkZXIgU2VpdGVubGVpc3RlIHBlciBNdXRhdGlvbk9ic2VydmVyXG4gIC8vIGJlb2JhY2h0ZW4gLSBOSUNIVCBkaWUgTWFya2Rvd25WaWV3LUNvbnRhaW5lciwgZGEgZGVyZW4gRWRpdG9yLVN1YnRyZWUgYmVpXG4gIC8vIGplZGVtIFRhc3RlbmRydWNrIHZpZWxlIE11dGF0aW9uZW4gZXJ6ZXVndCAoc2llaGUgV2FybnVuZyBpblxuICAvLyBkYXRhYmFzZS1mb2xkZXJzLmpzOiBlaW4gc3VidHJlZS1PYnNlcnZlciBcdTAwRkNiZXIgZWluZW4gRWRpdG9yLW5haGVuIENvbnRhaW5lclxuICAvLyBoYXQgZGllc2VzIFZhdWx0IHNjaG9uIGVpbm1hbCBrb21wbGV0dCBlaW5nZWZyb3JlbikuIERpZSBlaW5nZWJldHRldGVuXG4gIC8vIEJhY2tsaW5rcyBpbSBEb2t1bWVudCBicmF1Y2hlbiBkYWZcdTAwRkNyIGtlaW5lbiBlaWdlbmVuIE9ic2VydmVyOiBzaWUgXHUwMEU0bmRlcm5cbiAgLy8gc2ljaCBudXIsIHdlbm4gaXJnZW5kd28gaW0gVmF1bHQgTGlua3MgaGluenVrb21tZW4vd2VnZmFsbGVuIG9kZXIgYmVpbVxuICAvLyBcdTAwRDZmZm5lbi9XZWNoc2VsbiBlaW5lciBOb3RpeiAtIGJlaWRlcyBpc3QgXHUwMEZDYmVyIGRpZSBFdmVudHMgdW50ZW4gYmVyZWl0c1xuICAvLyBhYmdlZGVja3QgKFwicmVzb2x2ZWRcIiBuYWNoIGplZGVyIExpbmstQXVmbFx1MDBGNnN1bmcsIGxheW91dC1jaGFuZ2UvXG4gIC8vIGFjdGl2ZS1sZWFmLWNoYW5nZSBsXHUwMEY2c2VuIG9obmVoaW4gYXBwbHlCYWNrbGlua0NvbG9ycygpIHVuZCBkYW1pdCBhdWNoXG4gIC8vIGFwcGx5RW1iZWRkZWRCYWNrbGlua0NvbG9ycygpIGF1cykuXG4gIGNvbnN0IG9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIocmVmcmVzaCk7XG4gIGNvbnN0IG9ic2VydmVMZWF2ZXMgPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShCQUNLTElOS19WSUVXX1RZUEUpKSB7XG4gICAgICBvYnNlcnZlci5vYnNlcnZlKGxlYWYudmlldy5jb250YWluZXJFbCwgeyBjaGlsZExpc3Q6IHRydWUsIHN1YnRyZWU6IHRydWUgfSk7XG4gICAgfVxuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4gb2JzZXJ2ZXIuZGlzY29ubmVjdCgpKTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICAvLyBOdXIgZGVyIGVpbmdlYmV0dGV0ZSBUZWlsIGhcdTAwRTRuZ3QgKG1hbmdlbHMgZWlnZW5lbSBPYnNlcnZlciwgc2llaGUgb2JlbilcbiAgLy8gd2VpdGVyaGluIGFuIGRlciBMaW5rLUF1ZmxcdTAwRjZzdW5nIC0gZGllIFNlaXRlbmxlaXN0ZSBkZWNrdCBpaHIgT2JzZXJ2ZXIgYWIuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAubWV0YWRhdGFDYWNoZS5vbihcInJlc29sdmVkXCIsICgpID0+IGFwcGx5RW1iZWRkZWRCYWNrbGlua0NvbG9ycyhwbHVnaW4pKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KFxuICAgIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgICByZWZyZXNoKCk7XG4gICAgfSlcbiAgKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJhY3RpdmUtbGVhZi1jaGFuZ2VcIiwgcmVmcmVzaCkpO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICByZWZyZXNoKCk7XG4gIH0pO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJCYWNrbGlua0NvbG9ycyB9O1xuIiwgImNvbnN0IHsgY29sb3JGb3JGaWxlIH0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcblxuY29uc3QgQk9PS01BUktTX1ZJRVdfVFlQRSA9IFwiYm9va21hcmtzXCI7XG5jb25zdCBCT09LTUFSS1NfUExVR0lOX0lEID0gXCJib29rbWFya3NcIjtcblxuLy8gQm9va21hcmstWmVpbGVuIHRyYWdlbiBrZWluIGRhdGEtcGF0aC1BdHRyaWJ1dC4gRGVyIFZpZXcgaFx1MDBFNGx0IGFiZXIgaW50ZXJuXG4vLyBlaW5lIFdlYWtNYXAgKHZpZXcuaXRlbURvbXM6IEJvb2ttYXJrLUl0ZW0gLT4gVHJlZS1JdGVtLURvbSBtaXQgLnRpdGxlRWwpIC1cbi8vIGRhclx1MDBGQ2JlciBsXHUwMEU0c3N0IHNpY2ggamVkZXMgSXRlbSBnZXppZWx0IHNlaW5lciBaZWlsZSB6dW9yZG5lbiwgb2huZSBkaWUgKG5pY2h0XG4vLyBpdGVyaWVyYmFyZSkgV2Vha01hcCBzZWxic3QgZHVyY2hsYXVmZW4genUgbVx1MDBGQ3NzZW46IHN0YXR0ZGVzc2VuIHJla3Vyc2l2IFx1MDBGQ2JlclxuLy8gZGVuIEl0ZW0tQmF1bSBkZXMgQm9va21hcmtzLVBsdWdpbnMgc2VsYnN0IGxhdWZlbiAobGllZ3QgdW5hYmhcdTAwRTRuZ2lnIHZvbVxuLy8gUmVuZGVyLS9Db2xsYXBzZS1adXN0YW5kIGltbWVyIHZvbGxzdFx1MDBFNG5kaWcgdm9yKSB1bmQgamUgSXRlbSBwZXIgLmdldCgpXG4vLyBuYWNoc2NobGFnZW4sIG9iICh1bmQgd28pIGVzIGFrdHVlbGwgZ2VyZW5kZXJ0IGlzdC5cbmZ1bmN0aW9uIGZvckVhY2hGaWxlQm9va21hcmsoaXRlbXMsIGNhbGxiYWNrKSB7XG4gIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcyA/PyBbXSkge1xuICAgIGlmIChpdGVtLnR5cGUgPT09IFwiZmlsZVwiKSBjYWxsYmFjayhpdGVtKTtcbiAgICBlbHNlIGlmIChpdGVtLnR5cGUgPT09IFwiZ3JvdXBcIikgZm9yRWFjaEZpbGVCb29rbWFyayhpdGVtLml0ZW1zLCBjYWxsYmFjayk7XG4gIH1cbn1cblxuZnVuY3Rpb24gYXBwbHlCb29rbWFya3NDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IGJvb2ttYXJrc1BsdWdpbiA9IHBsdWdpbi5hcHAuaW50ZXJuYWxQbHVnaW5zLmdldEVuYWJsZWRQbHVnaW5CeUlkKEJPT0tNQVJLU19QTFVHSU5fSUQpO1xuICBpZiAoIWJvb2ttYXJrc1BsdWdpbikgcmV0dXJuO1xuXG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoQk9PS01BUktTX1ZJRVdfVFlQRSkpIHtcbiAgICBjb25zdCBpdGVtRG9tcyA9IGxlYWYudmlldz8uaXRlbURvbXM7XG4gICAgaWYgKCFpdGVtRG9tcykgY29udGludWU7XG5cbiAgICBmb3JFYWNoRmlsZUJvb2ttYXJrKGJvb2ttYXJrc1BsdWdpbi5pdGVtcywgKGl0ZW0pID0+IHtcbiAgICAgIGNvbnN0IHRpdGxlRWwgPSBpdGVtRG9tcy5nZXQoaXRlbSk/LnRpdGxlRWw7XG4gICAgICBpZiAoIXRpdGxlRWwpIHJldHVybjtcblxuICAgICAgY29uc3QgZmlsZSA9IHBsdWdpbi5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGl0ZW0ucGF0aCk7XG4gICAgICBjb25zdCBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmJvb2ttYXJrcyA/IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIFwiYm9va21hcmtzXCIpIDogbnVsbDtcbiAgICAgIGlmIChjb2xvcikgdGl0bGVFbC5zdHlsZS5jb2xvciA9IGNvbG9yO1xuICAgICAgZWxzZSB0aXRsZUVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiY29sb3JcIik7XG4gICAgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJCb29rbWFya3NDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseUJvb2ttYXJrc0NvbG9ycyhwbHVnaW4pO1xuXG4gIC8vIEFuYWxvZyB6dSBmaWxlLWV4cGxvcmVyLWNvbG9ycy5qczogQm9va21hcmtzIHJlbmRlcnQgWmVpbGVuIGJlaW1cbiAgLy8gQXVmLS9adWtsYXBwZW4gdm9uIEdydXBwZW4gc293aWUgYmVpbSBIaW56dWZcdTAwRkNnZW4vRW50ZmVybmVuL1Vtc29ydGllcmVuXG4gIC8vIGR5bmFtaXNjaCBuZXUuXG4gIGNvbnN0IG9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIocmVmcmVzaCk7XG4gIGNvbnN0IG9ic2VydmVMZWF2ZXMgPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShCT09LTUFSS1NfVklFV19UWVBFKSkge1xuICAgICAgb2JzZXJ2ZXIub2JzZXJ2ZShsZWFmLnZpZXcuY29udGFpbmVyRWwsIHsgY2hpbGRMaXN0OiB0cnVlLCBzdWJ0cmVlOiB0cnVlIH0pO1xuICAgIH1cbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IG9ic2VydmVyLmRpc2Nvbm5lY3QoKSk7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoXG4gICAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICAgIHJlZnJlc2goKTtcbiAgICB9KVxuICApO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICByZWZyZXNoKCk7XG4gIH0pO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJCb29rbWFya3NDb2xvcnMgfTtcbiIsICJjb25zdCB7IFRGaWxlIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IGNvbG9yRm9yRmlsZSwgc3VidHlwZUNvbG9yLCBzdWJ0eXBlSGFzT3duQ29sb3IgfSA9IHJlcXVpcmUoXCIuL3R5cGUtY29sb3JzXCIpO1xuY29uc3QgeyBnZXRTdWJ0eXBlIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBlc1wiKTtcblxuY29uc3QgRE9UX0NMQVNTID0gXCJmcmVkLXR5cC10aXRsZS1kb3RcIjtcbmNvbnN0IERPVF9IT0xMT1dfQ0xBU1MgPSBcImZyZWQtdHlwLXRpdGxlLWRvdC1ob2xsb3dcIjtcbi8vIFdpZSBERUZBVUxUX1RZUEVfQ09MT1IgaW4gdHlwLXZpZXcuanMgKEZhcmJlIGVpbmVzIFRZUHMgb2huZSBlaWdlbmUgRmFyYmUpLlxuY29uc3QgREVGQVVMVF9ET1RfQ09MT1IgPSBcIiM4ODg4ODhcIjtcbmNvbnN0IEJBREdFX0NMQVNTID0gXCJmcmVkLXR5cC10aXRsZS1iYWRnZVwiO1xuY29uc3QgQkFER0VfUExBSU5fQ0xBU1MgPSBcImZyZWQtdHlwLXRpdGxlLWJhZGdlLXBsYWluXCI7XG5jb25zdCBDT0xPUl9WQVIgPSBcIi0tZnJlZC10eXAtdGl0bGUtY29sb3JcIjtcblxuY29uc3QgQkxPQ0tfQkFER0VfQ0xBU1MgPSBcImZyZWQtdHlwLWJsb2NrLWJhZGdlXCI7XG5jb25zdCBCTE9DS19CQURHRV9QTEFJTl9DTEFTUyA9IFwiZnJlZC10eXAtYmxvY2stYmFkZ2UtcGxhaW5cIjtcbmNvbnN0IEJMT0NLX0FMSUdOX1RPUF9DTEFTUyA9IFwiZnJlZC10eXAtYmxvY2stYmFkZ2UtdG9wXCI7XG5jb25zdCBCTE9DS19BTElHTl9CT1RUT01fQ0xBU1MgPSBcImZyZWQtdHlwLWJsb2NrLWJhZGdlLWJvdHRvbVwiO1xuY29uc3QgQkxPQ0tfQ09MT1JfVkFSID0gXCItLWZyZWQtdHlwLWJsb2NrLWNvbG9yXCI7XG5cbi8vIG5vdGVUaXRsZVN0eWxlOiBcIm5vbmVcIiB8IFwiZG90XCIgfCBcImJhZGdlXCIuIEJlaSBcImJhZGdlXCIgYmVzdGltbWVuIHp3ZWlcbi8vIHdlaXRlcmUgRWluc3RlbGx1bmdlbiBGYXJiZSAobm90ZVRpdGxlQmFkZ2VDb2xvcmVkKSB1bmQgUG9zaXRpb25cbi8vIChub3RlVGl0bGVCYWRnZVBvc2l0aW9uOiBcInRpdGxlXCIgfCBcImJsb2NrXCIpIC0gc2llaGUgc2V0dGluZ3MuanMsIGRvcnQgbnVyXG4vLyBiZWkgXCJiYWRnZVwiIFx1MDBGQ2JlcmhhdXB0IGFuZ2V6ZWlndCAocHJvZ3Jlc3NpdmUgT2ZmZW5sZWd1bmcpLiBcImRvdFwiIHNpdHp0XG4vLyBpbW1lciBhbSBUaXRlbCwgXCJiYWRnZVwiIGplIG5hY2ggUG9zaXRpb24gZW50d2VkZXIgYW0gVGl0ZWwgb2RlciBhbVxuLy8gUHJvcGVydHktQmxvY2sgKGRvcnQgenVzXHUwMEU0dHpsaWNoIHBlciBub3RlVGl0bGVWZXJ0aWNhbEFsaWduIG9iZW4vdW50ZW4pLlxuLy8gY29sb3JWaWV3cy5ub3RlVGl0bGVDb2xvciAoVGl0ZWx0ZXh0IHNlbGJzdCBlaW5mXHUwMEU0cmJlbikgaXN0IGRhdm9uIHVuYWJoXHUwMEU0bmdpZ1xuLy8gdW5kIGJlbGllYmlnIGtvbWJpbmllcmJhci5cbmZ1bmN0aW9uIHJlc29sdmVNYXJrZXIocGx1Z2luLCBmaWxlKSB7XG4gIGNvbnN0IHN0eWxlID0gcGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVN0eWxlO1xuICBpZiAoc3R5bGUgPT09IFwibm9uZVwiKSByZXR1cm4geyBraW5kOiBcIm5vbmVcIiB9O1xuICBpZiAoc3R5bGUgPT09IFwiZG90XCIpIHJldHVybiB7IGtpbmQ6IFwiZG90XCIsIC4uLnJlc29sdmVEb3QocGx1Z2luLCBmaWxlKSB9O1xuXG4gIC8vIHN0eWxlID09PSBcImJhZGdlXCIgLSBmYXJiaWcgYmVpIGVpbmVtIHJlZ2lzdHJpZXJ0ZW4gVFlQIG9obmUgZWlnZW5lIEZhcmJlXG4gIC8vIGluIGRlciBncmF1ZW4gU3RhbmRhcmRmYXJiZSAod2llIGRlciBSaW5nIHZvbiByZXNvbHZlRG90KTsgZWluIG5pY2h0XG4gIC8vIHJlZ2lzdHJpZXJ0ZXIgVFlQIGJla29tbXQgZmFyYmlnIGtlaW5lIEJveCwgd2llIGF1Y2gga2VpbmVuIFB1bmt0LlxuICBjb25zdCB7IHNldHRpbmdzIH0gPSBwbHVnaW47XG4gIGNvbnN0IHR5cGUgPSBwbHVnaW4udHlwSW5kZXgudHlwZU9mKGZpbGUpO1xuICBpZiAoIXR5cGUpIHJldHVybiB7IGtpbmQ6IFwibm9uZVwiIH07XG4gIGNvbnN0IGNvbG9yZWQgPSBzZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUNvbG9yZWQ7XG4gIGlmIChjb2xvcmVkICYmICFzZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdICYmICFzZXR0aW5ncy50eXBlcy5pbmNsdWRlcyh0eXBlKSkgcmV0dXJuIHsga2luZDogXCJub25lXCIgfTtcbiAgY29uc3QgdHlwZUNvbG9yID0gc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXSA/PyBERUZBVUxUX0RPVF9DT0xPUjtcblxuICBjb25zdCBsYWJlbCA9IGJhZGdlTGFiZWwocGx1Z2luLCBmaWxlLCB0eXBlKTtcbiAgaWYgKCFsYWJlbCkgcmV0dXJuIHsga2luZDogXCJub25lXCIgfTtcbiAgY29uc3QgeyB0ZXh0LCB1c2VTdWJ0eXBlQ29sb3IsIHN1YnR5cGUgfSA9IGxhYmVsO1xuICBjb25zdCBjb2xvciA9IGNvbG9yZWQgPyAodXNlU3VidHlwZUNvbG9yID8gc3VidHlwZUNvbG9yKHNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKSA/PyB0eXBlQ29sb3IgOiB0eXBlQ29sb3IpIDogbnVsbDtcbiAgY29uc3QgcG9zaXRpb24gPSBzZXR0aW5ncy5ub3RlVGl0bGVCYWRnZVBvc2l0aW9uO1xuICByZXR1cm4geyBraW5kOiBwb3NpdGlvbiA9PT0gXCJibG9ja1wiID8gXCJibG9jay1iYWRnZVwiIDogXCJ0aXRsZS1iYWRnZVwiLCBjb2xvcmVkLCBjb2xvciwgdHlwZU5hbWU6IHRleHQgfTtcbn1cblxuLy8gQmVzY2hyaWZ0dW5nIGRlciBCb3ggKG5vdGVUaXRsZUJhZGdlTGFiZWwpIHNhbXQgZGVyIGRhenUgcGFzc2VuZGVuIEZhcmJlOlxuLy8gW1RZUF0gaW4gVFlQLUZhcmJlLCBbU3VidHlwXSBpbiBTdWJ0eXAtRmFyYmUgKG9obmUgU3VidHlwIGtlaW5lIEJveCAtXG4vLyBkYW5uIG51bGwpLCBbVFlQL1N1YnR5cF0gamUgbmFjaCBTY2hhbHRlciBcIlN1YnR5cC1GYXJiZVwiXG4vLyAoY29sb3JWaWV3cy5ub3RlVGl0bGVNYXJrZXJTdWJ0eXApLiBFaW4gbmljaHQgcmVnaXN0cmllcnRlciBTVUJUWVAtV2VydFxuLy8gc3RlaHQgYWxzIFRleHQgZGEsIGhhdCBhYmVyIGtlaW5lIGVpZ2VuZSBGYXJiZSAoc3VidHlwZUNvbG9yIGxpZWZlcnQgZGFublxuLy8gZGllIGRlcyBUWVBzKS5cbmZ1bmN0aW9uIGJhZGdlTGFiZWwocGx1Z2luLCBmaWxlLCB0eXBlKSB7XG4gIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHBsdWdpbjtcbiAgY29uc3Qgc3VidHlwZSA9IHBsdWdpbi50eXBJbmRleC5zdWJ0eXBlT2YoZmlsZSk7XG4gIGNvbnN0IG1vZGUgPSBzZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUxhYmVsID8/IFwidHlwZVwiO1xuICBpZiAobW9kZSA9PT0gXCJzdWJ0eXBlXCIpIHJldHVybiBzdWJ0eXBlID8geyB0ZXh0OiBzdWJ0eXBlLCB1c2VTdWJ0eXBlQ29sb3I6IHRydWUsIHN1YnR5cGUgfSA6IG51bGw7XG4gIGlmICghc3VidHlwZSB8fCBtb2RlID09PSBcInR5cGVcIikgcmV0dXJuIHsgdGV4dDogdHlwZSwgdXNlU3VidHlwZUNvbG9yOiBmYWxzZSwgc3VidHlwZSB9O1xuICByZXR1cm4geyB0ZXh0OiBgJHt0eXBlfS8ke3N1YnR5cGV9YCwgdXNlU3VidHlwZUNvbG9yOiAhIXNldHRpbmdzLmNvbG9yVmlld3Mubm90ZVRpdGxlTWFya2VyU3VidHlwLCBzdWJ0eXBlIH07XG59XG5cbi8vIEZhcmJwdW5rdCBhbSBUaXRlbCAtIHdpZSBkaWUgRmFyYnB1bmt0ZSBkZXIgVFlQLVZpZXcgKHNpZWhlIHBhaW50Q29sb3JEb3Rcbi8vIGluIHR5cGUtY29sb3JzLmpzKSBiZWltIFN0YW5kYXJkd2VydCBhbHMgaG9obGVyIFJpbmc6IGVpbiByZWdpc3RyaWVydGVyIFRZUFxuLy8gb2huZSBGYXJiZSBncmF1LCBlaW4gU3VidHlwIG9obmUgZWlnZW5lIEVpbnN0ZWxsdW5nIChtaXQgZGVtIFVudGVyLVNjaGFsdGVyXG4vLyBcIlN1YnR5cFwiKSBpbiBkZXIgVFlQLUZhcmJlLCBkaWUgZXIgXHUwMEZDYmVybmltbXQuIE5pY2h0IHJlZ2lzdHJpZXJ0ZSBUWVBlblxuLy8gYmxlaWJlbiB3aWUgaW4gZGVyIFRZUC1MaXN0ZSBvaG5lIFB1bmt0LlxuZnVuY3Rpb24gcmVzb2x2ZURvdChwbHVnaW4sIGZpbGUpIHtcbiAgY29uc3QgdHlwZSA9IHBsdWdpbi50eXBJbmRleC50eXBlT2YoZmlsZSk7XG4gIGlmICghdHlwZSkgcmV0dXJuIHsgY29sb3I6IG51bGwsIGhvbGxvdzogZmFsc2UgfTtcbiAgY29uc3QgeyBzZXR0aW5ncyB9ID0gcGx1Z2luO1xuICBjb25zdCB0eXBlQ29sb3IgPSBzZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdO1xuICBpZiAoIXR5cGVDb2xvcikge1xuICAgIHJldHVybiBzZXR0aW5ncy50eXBlcy5pbmNsdWRlcyh0eXBlKSA/IHsgY29sb3I6IERFRkFVTFRfRE9UX0NPTE9SLCBob2xsb3c6IHRydWUgfSA6IHsgY29sb3I6IG51bGwsIGhvbGxvdzogZmFsc2UgfTtcbiAgfVxuICBjb25zdCBzdWJ0eXBlID0gcGx1Z2luLnR5cEluZGV4LnN1YnR5cGVPZihmaWxlKTtcbiAgaWYgKHNldHRpbmdzLmNvbG9yVmlld3Mubm90ZVRpdGxlTWFya2VyU3VidHlwICYmIHN1YnR5cGUgJiYgZ2V0U3VidHlwZShzZXR0aW5ncywgdHlwZSwgc3VidHlwZSkpIHtcbiAgICByZXR1cm4geyBjb2xvcjogc3VidHlwZUNvbG9yKHNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKSwgaG9sbG93OiAhc3VidHlwZUhhc093bkNvbG9yKHNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKSB9O1xuICB9XG4gIHJldHVybiB7IGNvbG9yOiB0eXBlQ29sb3IsIGhvbGxvdzogZmFsc2UgfTtcbn1cblxuLy8gVGl0ZWwgZGVyIE5vdGl6IHNlbGJzdCAoLmlubGluZS10aXRsZSwgc2ljaHRiYXIgc29mZXJuIE9ic2lkaWFucyBlaWdlbmVcbi8vIEVpbnN0ZWxsdW5nIFwiSW5saW5lLVRpdGVsIGFuemVpZ2VuXCIgYWt0aXYgaXN0KS4gQmV3dXNzdCBhbHMgOjpiZWZvcmVcbi8vIHJlYWxpc2llcnQgKHNpZWhlIHN0eWxlcy5jc3MpIHN0YXR0IGFscyBlaWdlbmVzIERPTS1FbGVtZW50IG9kZXIgV3JhcHBlcjpcbi8vIC5pbmxpbmUtdGl0bGUgaFx1MDBFNG5ndCBpbiBtZWhyZXJlbiBUaGVtZXMgKHUuIGEuIE1pbmltYWwpIHBlciBLaW5kLVNlbGVrdG9yXG4vLyAoXCI+XCIpIGRpcmVrdCBhbiBzZWluZW0gRWx0ZXJuLUNvbnRhaW5lciAoei4gQi4gZlx1MDBGQ3IgbWF4LXdpZHRoL21hcmdpbikgLSBlaW5cbi8vIHp1c1x1MDBFNHR6bGljaGVzIEVsZW1lbnQgZGF2b3Igb2RlciBlaW4gV3JhcHBlciBkYXJ1bSB3XHUwMEZDcmRlIGRpZXNlIFJlZ2VsblxuLy8gdW50ZXJ3YW5kZXJuLiBGYXJiZSB1bmQgVFlQLU5hbWUgbGFzc2VuIHNpY2ggZWluZW0gOjpiZWZvcmUgbmljaHQgZGlyZWt0XG4vLyB6dXdlaXNlbiwgZGFoZXIgZGVyIFVtd2VnIFx1MDBGQ2JlciBlaW5lIENTUy1WYXJpYWJsZSBiencuIGVpbiBkYXRhLUF0dHJpYnV0LFxuLy8gZGllIGRpZSA6OmJlZm9yZS1SZWdlbG4gYXVzbGVzZW4gKHZhcigpL2F0dHIoKSkuXG5mdW5jdGlvbiBhcHBseVN0eWxlVG9UaXRsZSh0aXRsZUVsLCBtYXJrZXIpIHtcbiAgY29uc3QgaXNEb3QgPSBtYXJrZXIua2luZCA9PT0gXCJkb3RcIiAmJiAhIW1hcmtlci5jb2xvcjtcbiAgY29uc3QgaXNCYWRnZSA9IG1hcmtlci5raW5kID09PSBcInRpdGxlLWJhZGdlXCI7XG5cbiAgdGl0bGVFbC5jbGFzc0xpc3QudG9nZ2xlKERPVF9DTEFTUywgaXNEb3QpO1xuICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoRE9UX0hPTExPV19DTEFTUywgaXNEb3QgJiYgISFtYXJrZXIuaG9sbG93KTtcbiAgdGl0bGVFbC5jbGFzc0xpc3QudG9nZ2xlKEJBREdFX0NMQVNTLCBpc0JhZGdlICYmIG1hcmtlci5jb2xvcmVkKTtcbiAgdGl0bGVFbC5jbGFzc0xpc3QudG9nZ2xlKEJBREdFX1BMQUlOX0NMQVNTLCBpc0JhZGdlICYmICFtYXJrZXIuY29sb3JlZCk7XG5cbiAgaWYgKGlzQmFkZ2UpIHRpdGxlRWwuZGF0YXNldC5mcmVkVHlwID0gbWFya2VyLnR5cGVOYW1lO1xuICBlbHNlIGRlbGV0ZSB0aXRsZUVsLmRhdGFzZXQuZnJlZFR5cDtcblxuICBjb25zdCBtYXJrZXJDb2xvciA9IChpc0RvdCAmJiBtYXJrZXIuY29sb3IpIHx8IChpc0JhZGdlICYmIG1hcmtlci5jb2xvcmVkICYmIG1hcmtlci5jb2xvcikgPyBtYXJrZXIuY29sb3IgOiBudWxsO1xuICBpZiAobWFya2VyQ29sb3IpIHRpdGxlRWwuc3R5bGUuc2V0UHJvcGVydHkoQ09MT1JfVkFSLCBtYXJrZXJDb2xvcik7XG4gIGVsc2UgdGl0bGVFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShDT0xPUl9WQVIpO1xufVxuXG4vLyBQcm9wZXJ0eS1CbG9jayBkZXIgTm90aXogKC5tZXRhZGF0YS1jb250YWluZXIpLiBEaWUgXCJibG9ja1wiLVBvc2l0aW9uIHZvblxuLy8gbm90ZVRpdGxlQmFkZ2VQb3NpdGlvbjogZGllc2VsYmUgQm94IHdpZSBhbSBUaXRlbCwgYWJlciB1bSA5MFx1MDBCMCBnZWRyZWh0XG4vLyAod3JpdGluZy1tb2RlIHN0YXR0IHRyYW5zZm9ybTpyb3RhdGUoKSAtIGRhZHVyY2ggd1x1MDBFNGNoc3QgZGllIEJveCBtaXQgZGVyXG4vLyBUZXh0bFx1MDBFNG5nZSBpbiBkZXIgcmljaHRpZ2VuIFJpY2h0dW5nLCBvaG5lIGRpZSBQb3NpdGlvbmllcnVuZyBwZXJcbi8vIHRyYW5zZm9ybS1vcmlnaW4gdm9uIEhhbmQgbmFjaHJlY2huZW4genUgbVx1MDBGQ3NzZW4pIHVuZCBsaW5rcyBhbSBQcm9wZXJ0eS1CbG9ja1xuLy8gc3RhdHQgYW0gVGl0ZWwgdmVyYW5rZXJ0LCBvYmVuIG9kZXIgdW50ZW4gKG5vdGVUaXRsZVZlcnRpY2FsQWxpZ24pLiBCbGVpYnRcbi8vIGJlaW0gKEVpbi0vQXVzLSlCbGVuZGVuIGRlcyBCbG9ja3MgKHNpZWhlIFByb3BlcnR5LUJsb2NrLmNzcykgYXV0b21hdGlzY2hcbi8vIG1pdCB2ZXJzY2h3aW5kZW4vZXJzY2hlaW5lbiwgZGEgc2llIGFscyA6OmJlZm9yZSBkYXJhdWYgc2l0enQuXG5mdW5jdGlvbiBhcHBseVN0eWxlVG9CbG9jayhwbHVnaW4sIGJsb2NrRWwsIG1hcmtlcikge1xuICBjb25zdCBpc0Jsb2NrQmFkZ2UgPSBtYXJrZXIua2luZCA9PT0gXCJibG9jay1iYWRnZVwiO1xuXG4gIGJsb2NrRWwuY2xhc3NMaXN0LnRvZ2dsZShCTE9DS19CQURHRV9DTEFTUywgaXNCbG9ja0JhZGdlICYmIG1hcmtlci5jb2xvcmVkKTtcbiAgYmxvY2tFbC5jbGFzc0xpc3QudG9nZ2xlKEJMT0NLX0JBREdFX1BMQUlOX0NMQVNTLCBpc0Jsb2NrQmFkZ2UgJiYgIW1hcmtlci5jb2xvcmVkKTtcblxuICBjb25zdCBhbGlnbiA9IHBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVWZXJ0aWNhbEFsaWduO1xuICBibG9ja0VsLmNsYXNzTGlzdC50b2dnbGUoQkxPQ0tfQUxJR05fVE9QX0NMQVNTLCBpc0Jsb2NrQmFkZ2UgJiYgYWxpZ24gIT09IFwiYm90dG9tXCIpO1xuICBibG9ja0VsLmNsYXNzTGlzdC50b2dnbGUoQkxPQ0tfQUxJR05fQk9UVE9NX0NMQVNTLCBpc0Jsb2NrQmFkZ2UgJiYgYWxpZ24gPT09IFwiYm90dG9tXCIpO1xuXG4gIGlmIChpc0Jsb2NrQmFkZ2UpIGJsb2NrRWwuZGF0YXNldC5mcmVkVHlwID0gbWFya2VyLnR5cGVOYW1lO1xuICBlbHNlIGRlbGV0ZSBibG9ja0VsLmRhdGFzZXQuZnJlZFR5cDtcblxuICBjb25zdCBibG9ja0NvbG9yID0gaXNCbG9ja0JhZGdlICYmIG1hcmtlci5jb2xvcmVkICYmIG1hcmtlci5jb2xvciA/IG1hcmtlci5jb2xvciA6IG51bGw7XG4gIGlmIChibG9ja0NvbG9yKSBibG9ja0VsLnN0eWxlLnNldFByb3BlcnR5KEJMT0NLX0NPTE9SX1ZBUiwgYmxvY2tDb2xvcik7XG4gIGVsc2UgYmxvY2tFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShCTE9DS19DT0xPUl9WQVIpO1xufVxuXG5mdW5jdGlvbiBhcHBseUFjdGl2ZVRpdGxlQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikpIHtcbiAgICBjb25zdCBjb250YWluZXJFbCA9IGxlYWYudmlldy5jb250YWluZXJFbDtcbiAgICBjb25zdCBmaWxlID0gbGVhZi52aWV3LmZpbGU7XG4gICAgY29uc3QgdHlwZWRGaWxlID0gZmlsZSBpbnN0YW5jZW9mIFRGaWxlID8gZmlsZSA6IG51bGw7XG4gICAgY29uc3QgbWFya2VyID0gcmVzb2x2ZU1hcmtlcihwbHVnaW4sIHR5cGVkRmlsZSk7XG5cbiAgICBjb25zdCB0aXRsZUVsID0gY29udGFpbmVyRWwucXVlcnlTZWxlY3RvcihcIi5pbmxpbmUtdGl0bGVcIik7XG4gICAgaWYgKHRpdGxlRWwpIHtcbiAgICAgIGFwcGx5U3R5bGVUb1RpdGxlKHRpdGxlRWwsIG1hcmtlcik7XG5cbiAgICAgIGNvbnN0IHRleHRDb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLm5vdGVUaXRsZUNvbG9yID8gY29sb3JGb3JGaWxlKHBsdWdpbiwgdHlwZWRGaWxlLCBcIm5vdGVUaXRsZUNvbG9yXCIpIDogbnVsbDtcbiAgICAgIGlmICh0ZXh0Q29sb3IpIHRpdGxlRWwuc3R5bGUuY29sb3IgPSB0ZXh0Q29sb3I7XG4gICAgICBlbHNlIHRpdGxlRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBibG9ja0VsID0gY29udGFpbmVyRWwucXVlcnlTZWxlY3RvcihcIi5tZXRhZGF0YS1jb250YWluZXJcIik7XG4gICAgaWYgKGJsb2NrRWwpIGFwcGx5U3R5bGVUb0Jsb2NrKHBsdWdpbiwgYmxvY2tFbCwgbWFya2VyKTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlckFjdGl2ZVRpdGxlQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlBY3RpdmVUaXRsZUNvbG9ycyhwbHVnaW4pO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwiZmlsZS1vcGVuXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJhY3RpdmUtbGVhZi1jaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgcmVmcmVzaCkpO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkocmVmcmVzaCk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckFjdGl2ZVRpdGxlQ29sb3JzIH07XG4iLCAiY29uc3QgeyBlZGl0b3JJbmZvRmllbGQsIGdldExpbmtwYXRoIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IFZpZXdQbHVnaW4sIERlY29yYXRpb24gfSA9IHJlcXVpcmUoXCJAY29kZW1pcnJvci92aWV3XCIpO1xuY29uc3QgeyBQcmVjLCBSYW5nZVNldEJ1aWxkZXIsIFN0YXRlRWZmZWN0IH0gPSByZXF1aXJlKFwiQGNvZGVtaXJyb3Ivc3RhdGVcIik7XG5jb25zdCB7IHN5bnRheFRyZWUgfSA9IHJlcXVpcmUoXCJAY29kZW1pcnJvci9sYW5ndWFnZVwiKTtcbmNvbnN0IHsgY29sb3JGb3JGaWxlIH0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcblxuLy8gTGlua3MgaW0gTm90aXp0ZXh0IG5hY2ggZGVtIFRZUCBpaHJlcyBaaWVscyBlaW5mXHUwMEU0cmJlbi4gT2JzaWRpYW4gZlx1MDBFNHJidFxuLy8gaW50ZXJuZSBMaW5rcyBpbiBiZWlkZW4gRGFyc3RlbGx1bmdlbiBcdTAwRkNiZXIgdmFyKC0tbGluay1jb2xvcikgYnp3LlxuLy8gdmFyKC0tbGluay1jb2xvci1ob3ZlcikgKHNpZWhlIGFwcC5jc3M6IFwiLm1hcmtkb3duLXJlbmRlcmVkIC5pbnRlcm5hbC1saW5rXCJcbi8vIHVuZCBcIi5jbS1zLW9ic2lkaWFuIHNwYW4uY20taG1kLWludGVybmFsLWxpbmtcIikgLSBzdGF0dCBlaWdlbmVyIEZhcmJyZWdlbG5cbi8vIHdpcmQgZGFoZXIgbnVyIC0tbGluay1jb2xvciBqZSBMaW5rIFx1MDBGQ2JlcnNjaHJpZWJlbi4gLS1saW5rLWNvbG9yLWhvdmVyIGJsZWlidFxuLy8gYmV3dXNzdCB1bmFuZ2V0YXN0ZXQ6IGJlaW0gXHUwMERDYmVyZmFocmVuIGVyc2NoZWludCB3aWVkZXIgZGllIG5vcm1hbGVcbi8vIExpbmstRmFyYmUuIFVudGVyc3RyZWljaHVuZyB1bmQgVGhlbWUtQW5wYXNzdW5nZW4gYmxlaWJlbiBlYmVuc28gZXJoYWx0ZW4uXG4vL1xuLy8gWndlaSBnZXRyZW5udGUgV2VnZSwgZGEgc2ljaCBkaWUgRGFyc3RlbGx1bmdlbiBncnVuZGxlZ2VuZCB1bnRlcnNjaGVpZGVuOlxuLy8gIC0gTGVzZS1Nb2R1cywgSG92ZXItVm9yc2NoYXUsIGdlcmVuZGVydGUgQmxcdTAwRjZja2UgaW4gTGl2ZSBQcmV2aWV3IChUYWJlbGxlbixcbi8vICAgIENhbGxvdXRzKTogZWNodGUgPGEgY2xhc3M9XCJpbnRlcm5hbC1saW5rXCIgZGF0YS1ocmVmPVwiXHUyMDI2XCI+LUVsZW1lbnRlIGF1c1xuLy8gICAgT2JzaWRpYW5zIE1hcmtkb3duLVJlbmRlcmVyIC0+IE1hcmtkb3duUG9zdFByb2Nlc3NvciwgamUgTGluayBlaW5tYWxpZ1xuLy8gICAgYmVpbSBSZW5kZXJuLlxuLy8gIC0gTGl2ZSBQcmV2aWV3L1F1ZWxsdGV4dC1Nb2R1czogZG9ydCBnaWJ0IGVzIGtlaW5lIExpbmstRWxlbWVudGUgbWl0XG4vLyAgICBaaWVsYXR0cmlidXQsIG51ciBDb2RlTWlycm9yLVNwYW5zIChcIi5jbS1obWQtaW50ZXJuYWwtbGlua1wiKSBcdTAwRkNiZXIgZGVtXG4vLyAgICBSb2h0ZXh0IC0+IGVpZ2VuZXIgVmlld1BsdWdpbiwgZGVyIG51ciBkZW4gc2ljaHRiYXJlbiBCZXJlaWNoIGJldHJhY2h0ZXQuXG4vL1xuLy8gTmV1IGVpbmdlZlx1MDBFNHJidCB3aXJkIGRhclx1MDBGQ2JlciBoaW5hdXMgbnVyIGJlaSB0YXRzXHUwMEU0Y2hsaWNoIGdlXHUwMEU0bmRlcnRlbSBUWVBcbi8vICh0eXBJbmRleCBcImNoYW5nZVwiKSBvZGVyIGdlXHUwMEU0bmRlcnRlciBFaW5zdGVsbHVuZyAtIG5pY2h0IGJlaSBqZWRlbSBTcGVpY2hlcm4uXG5cbmNvbnN0IENPTE9SX1ZBUiA9IFwiLS1saW5rLWNvbG9yXCI7XG5jb25zdCBTT1VSQ0VfQVRUUiA9IFwiZGF0YS1mcmVkLXR5cC1zcmNcIjtcblxuLy8gW1taaWVsXV0sIFtbWmllbHxBbGlhc11dLCBbW1ppZWwjXHUwMERDYmVyc2NocmlmdF1dIC0gRWluYmV0dHVuZ2VuICghW1tcdTIwMjZdXSlcbi8vIGJsZWliZW4gYXVcdTAwREZlbiB2b3IsIGRpZSBzaW5kIGtlaW5lIExpbmtzIGltIGVpZ2VudGxpY2hlbiBTaW5uLiBJbiBUYWJlbGxlblxuLy8gc3RlaHQgZGllIEFsaWFzLVBpcGUgZXNjYXBlZCAoXCJcXHxcIikuXG5jb25zdCBXSUtJTElOS19QQVRURVJOID0gLyg/PCEhKVxcW1xcWyhbXltcXF1dKz8pXFxdXFxdL2c7XG5cbmZ1bmN0aW9uIGNvbG9yRm9yTGlua3RleHQocGx1Z2luLCBsaW5rdGV4dCwgc291cmNlUGF0aCkge1xuICBjb25zdCB0YXJnZXQgPSBsaW5rdGV4dC5zcGxpdCgvXFxcXD9cXHwvKVswXS50cmltKCk7XG4gIGNvbnN0IGxpbmtwYXRoID0gZ2V0TGlua3BhdGgodGFyZ2V0KTtcbiAgaWYgKCFsaW5rcGF0aCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGZpbGUgPSBwbHVnaW4uYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0Rmlyc3RMaW5rcGF0aERlc3QobGlua3BhdGgsIHNvdXJjZVBhdGgpO1xuICByZXR1cm4gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSwgXCJsaW5rc1wiKTtcbn1cblxuLy8gLS0tIExlc2UtTW9kdXMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmZ1bmN0aW9uIGFwcGx5VG9BbmNob3IocGx1Z2luLCBhbmNob3JFbCkge1xuICBjb25zdCBocmVmID0gYW5jaG9yRWwuZ2V0QXR0cmlidXRlKFwiZGF0YS1ocmVmXCIpO1xuICBjb25zdCBjb2xvciA9XG4gICAgcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MubGlua3MgJiYgaHJlZiAmJiAhYW5jaG9yRWwuY2xhc3NMaXN0LmNvbnRhaW5zKFwiaXMtdW5yZXNvbHZlZFwiKVxuICAgICAgPyBjb2xvckZvckxpbmt0ZXh0KHBsdWdpbiwgaHJlZiwgYW5jaG9yRWwuZ2V0QXR0cmlidXRlKFNPVVJDRV9BVFRSKSA/PyBcIlwiKVxuICAgICAgOiBudWxsO1xuICBpZiAoY29sb3IpIGFuY2hvckVsLnN0eWxlLnNldFByb3BlcnR5KENPTE9SX1ZBUiwgY29sb3IpO1xuICBlbHNlIGFuY2hvckVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KENPTE9SX1ZBUik7XG59XG5cbi8vIEJlcmVpdHMgZ2VyZW5kZXJ0ZSBMaW5rcyBuZXUgZWluZlx1MDBFNHJiZW4gKFRZUC0gb2RlciBFaW5zdGVsbHVuZ3NcdTAwRTRuZGVydW5nKS4gRGVyXG4vLyBQb3N0LVByb2Nlc3NvciBtZXJrdCBzaWNoIGRhZlx1MDBGQ3IgYW4gamVkZW0gTGluayBkZXNzZW4gUXVlbGxub3RpeiwgZGEgZGllIHp1clxuLy8gQXVmbFx1MDBGNnN1bmcgbWVocmRldXRpZ2VyIExpbmt0ZXh0ZSBnZWJyYXVjaHQgd2lyZC4gQWxsZSBGZW5zdGVyIChQb3Atb3V0cylcbi8vIFx1MDBGQ2JlciBpaHJlIExlYXZlcyBlaW5nZXNhbW1lbHQuXG5mdW5jdGlvbiByZWZyZXNoUmVuZGVyZWRMaW5rcyhwbHVnaW4pIHtcbiAgY29uc3QgZG9jcyA9IG5ldyBTZXQoKTtcbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2UuaXRlcmF0ZUFsbExlYXZlcygobGVhZikgPT4gZG9jcy5hZGQobGVhZi52aWV3LmNvbnRhaW5lckVsLm93bmVyRG9jdW1lbnQpKTtcbiAgZm9yIChjb25zdCBkb2Mgb2YgZG9jcykge1xuICAgIGZvciAoY29uc3QgYW5jaG9yRWwgb2YgZG9jLnF1ZXJ5U2VsZWN0b3JBbGwoYGEuaW50ZXJuYWwtbGlua1ske1NPVVJDRV9BVFRSfV1gKSkgYXBwbHlUb0FuY2hvcihwbHVnaW4sIGFuY2hvckVsKTtcbiAgfVxufVxuXG4vLyAtLS0gTGl2ZSBQcmV2aWV3IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgcmVmcmVzaEVmZmVjdCA9IFN0YXRlRWZmZWN0LmRlZmluZSgpO1xuXG5mdW5jdGlvbiBidWlsZExpbmtWaWV3UGx1Z2luKHBsdWdpbikge1xuICBjb25zdCBkZWNvcmF0aW9uc0J5Q29sb3IgPSBuZXcgTWFwKCk7XG4gIGNvbnN0IGRlY29yYXRpb25Gb3IgPSAoY29sb3IpID0+IHtcbiAgICBsZXQgZGVjb3JhdGlvbiA9IGRlY29yYXRpb25zQnlDb2xvci5nZXQoY29sb3IpO1xuICAgIGlmICghZGVjb3JhdGlvbikge1xuICAgICAgZGVjb3JhdGlvbiA9IERlY29yYXRpb24ubWFyayh7XG4gICAgICAgIGNsYXNzOiBcImZyZWQtdHlwLWxpbmtcIixcbiAgICAgICAgYXR0cmlidXRlczogeyBzdHlsZTogYCR7Q09MT1JfVkFSfTogJHtjb2xvcn07YCB9LFxuICAgICAgfSk7XG4gICAgICBkZWNvcmF0aW9uc0J5Q29sb3Iuc2V0KGNvbG9yLCBkZWNvcmF0aW9uKTtcbiAgICB9XG4gICAgcmV0dXJuIGRlY29yYXRpb247XG4gIH07XG5cbiAgY29uc3QgYnVpbGQgPSAodmlldykgPT4ge1xuICAgIGlmICghcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MubGlua3MpIHJldHVybiBEZWNvcmF0aW9uLm5vbmU7XG4gICAgY29uc3Qgc291cmNlUGF0aCA9IHZpZXcuc3RhdGUuZmllbGQoZWRpdG9ySW5mb0ZpZWxkLCBmYWxzZSk/LmZpbGU/LnBhdGggPz8gXCJcIjtcbiAgICBjb25zdCB0cmVlID0gc3ludGF4VHJlZSh2aWV3LnN0YXRlKTtcbiAgICBjb25zdCBidWlsZGVyID0gbmV3IFJhbmdlU2V0QnVpbGRlcigpO1xuXG4gICAgZm9yIChjb25zdCB7IGZyb20sIHRvIH0gb2Ygdmlldy52aXNpYmxlUmFuZ2VzKSB7XG4gICAgICBjb25zdCB0ZXh0ID0gdmlldy5zdGF0ZS5zbGljZURvYyhmcm9tLCB0byk7XG4gICAgICBXSUtJTElOS19QQVRURVJOLmxhc3RJbmRleCA9IDA7XG4gICAgICBmb3IgKGxldCBtYXRjaDsgKG1hdGNoID0gV0lLSUxJTktfUEFUVEVSTi5leGVjKHRleHQpKTsgKSB7XG4gICAgICAgIGNvbnN0IHN0YXJ0ID0gZnJvbSArIG1hdGNoLmluZGV4O1xuICAgICAgICAvLyBOdXIsIHdhcyBPYnNpZGlhbnMgTWFya2Rvd24tUGFyc2VyIHNlbGJzdCBhbHMgaW50ZXJuZW4gTGluayBlcmtlbm50IC1cbiAgICAgICAgLy8gc2NobGllXHUwMERGdCB6LiBCLiBbW1x1MjAyNl1dIGluIENvZGUtQmxcdTAwRjZja2VuIG9kZXIgSW5saW5lLUNvZGUgYXVzLlxuICAgICAgICBpZiAoIXRyZWUucmVzb2x2ZUlubmVyKHN0YXJ0ICsgMiwgMSkubmFtZS5pbmNsdWRlcyhcImhtZC1pbnRlcm5hbC1saW5rXCIpKSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgY29sb3IgPSBjb2xvckZvckxpbmt0ZXh0KHBsdWdpbiwgbWF0Y2hbMV0sIHNvdXJjZVBhdGgpO1xuICAgICAgICBpZiAoY29sb3IpIGJ1aWxkZXIuYWRkKHN0YXJ0LCBzdGFydCArIG1hdGNoWzBdLmxlbmd0aCwgZGVjb3JhdGlvbkZvcihjb2xvcikpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gYnVpbGRlci5maW5pc2goKTtcbiAgfTtcblxuICByZXR1cm4gVmlld1BsdWdpbi5mcm9tQ2xhc3MoXG4gICAgY2xhc3Mge1xuICAgICAgY29uc3RydWN0b3Iodmlldykge1xuICAgICAgICB0aGlzLmRlY29yYXRpb25zID0gYnVpbGQodmlldyk7XG4gICAgICB9XG5cbiAgICAgIC8vIERlciBQYXJzZXIgYXJiZWl0ZXQgZGVuIHNpY2h0YmFyZW4gQmVyZWljaCBnZ2YuIGVyc3QgbmFjaCB1bmQgbmFjaCBhYiAtXG4gICAgICAvLyBlaW4gbmV1ZXIgU3ludGF4YmF1bSB6XHUwMEU0aGx0IGRhaGVyIGViZW5mYWxscyBhbHMgQW5sYXNzIHp1bSBOZXVhdWZiYXUuXG4gICAgICB1cGRhdGUodXBkYXRlKSB7XG4gICAgICAgIGlmIChcbiAgICAgICAgICB1cGRhdGUuZG9jQ2hhbmdlZCB8fFxuICAgICAgICAgIHVwZGF0ZS52aWV3cG9ydENoYW5nZWQgfHxcbiAgICAgICAgICBzeW50YXhUcmVlKHVwZGF0ZS5zdGFydFN0YXRlKSAhPT0gc3ludGF4VHJlZSh1cGRhdGUuc3RhdGUpIHx8XG4gICAgICAgICAgdXBkYXRlLnRyYW5zYWN0aW9ucy5zb21lKCh0cikgPT4gdHIuZWZmZWN0cy5zb21lKChlZmZlY3QpID0+IGVmZmVjdC5pcyhyZWZyZXNoRWZmZWN0KSkpXG4gICAgICAgICkge1xuICAgICAgICAgIHRoaXMuZGVjb3JhdGlvbnMgPSBidWlsZCh1cGRhdGUudmlldyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LFxuICAgIHsgZGVjb3JhdGlvbnM6ICh2YWx1ZSkgPT4gdmFsdWUuZGVjb3JhdGlvbnMgfVxuICApO1xufVxuXG5mdW5jdGlvbiByZWZyZXNoRWRpdG9ycyhwbHVnaW4pIHtcbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2UuaXRlcmF0ZUFsbExlYXZlcygobGVhZikgPT4ge1xuICAgIGxlYWYudmlldz8uZWRpdG9yPy5jbT8uZGlzcGF0Y2goeyBlZmZlY3RzOiByZWZyZXNoRWZmZWN0Lm9mKG51bGwpIH0pO1xuICB9KTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmZ1bmN0aW9uIHJlZ2lzdGVyTGlua0NvbG9ycyhwbHVnaW4pIHtcbiAgcGx1Z2luLnJlZ2lzdGVyTWFya2Rvd25Qb3N0UHJvY2Vzc29yKChlbCwgY3R4KSA9PiB7XG4gICAgLy8gUXVlbGxlIGltbWVyIHZlcm1lcmtlbiwgYXVjaCBiZWkgYXVzZ2VzY2hhbHRldGVyIEVpbmZcdTAwRTRyYnVuZyAtIHNvIGdyZWlmdFxuICAgIC8vIGVpbiBzcFx1MDBFNHRlcmVzIEVpbnNjaGFsdGVuIGF1Y2ggZlx1MDBGQ3IgYmVyZWl0cyBnZXJlbmRlcnRlIExpbmtzLlxuICAgIGZvciAoY29uc3QgYW5jaG9yRWwgb2YgZWwucXVlcnlTZWxlY3RvckFsbChcImEuaW50ZXJuYWwtbGlua1wiKSkge1xuICAgICAgYW5jaG9yRWwuc2V0QXR0cmlidXRlKFNPVVJDRV9BVFRSLCBjdHguc291cmNlUGF0aCk7XG4gICAgICBhcHBseVRvQW5jaG9yKHBsdWdpbiwgYW5jaG9yRWwpO1xuICAgIH1cbiAgfSk7XG4gIC8vIE9ic2lkaWFucyBTeW50YXgtU3BhbiBcIi5jbS1obWQtaW50ZXJuYWwtbGlua1wiIGxpZWd0IHVuYWJoXHUwMEU0bmdpZyB2b24gZGVyXG4gIC8vIFByaW9yaXRcdTAwRTR0IGltbWVyIGF1XHUwMERGZW4sIGRpZSBNYXJraWVydW5nIGFsc28gZGFyaW4gLSBkaWUgRmFyYmUgc2V0enQgZGFoZXJcbiAgLy8gZWluZSBlaWdlbmUgUmVnZWwgaW4gc3R5bGVzLmNzcyAoLmZyZWQtdHlwLWxpbmspLiBOaWVkcmlnc3RlIFByaW9yaXRcdTAwRTR0IGxlZ3RcbiAgLy8gc2llIGltbWVyaGluIHVtIFwiLmNtLXVuZGVybGluZVwiIGhlcnVtLCBkYW1pdCBkZXIgZ2FuemUgTGlua3RleHQgZXJmYXNzdCBpc3QuXG4gIHBsdWdpbi5yZWdpc3RlckVkaXRvckV4dGVuc2lvbihQcmVjLmxvd2VzdChidWlsZExpbmtWaWV3UGx1Z2luKHBsdWdpbikpKTtcblxuICBjb25zdCByZWZyZXNoID0gKCkgPT4ge1xuICAgIHJlZnJlc2hSZW5kZXJlZExpbmtzKHBsdWdpbik7XG4gICAgcmVmcmVzaEVkaXRvcnMocGx1Z2luKTtcbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgLy8gRGllIEVkaXRvci1EZWtvcmF0aW9uZW4gdmVyc2Nod2luZGVuIGJlaW0gRW50bGFkZW4gbWl0IGRlciBFcndlaXRlcnVuZyB2b25cbiAgLy8gc2VsYnN0LCBkaWUgSW5saW5lLVZhcmlhYmxlbiBhbiBnZXJlbmRlcnRlbiBMaW5rcyBuaWNodC5cbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IHtcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5pdGVyYXRlQWxsTGVhdmVzKChsZWFmKSA9PiB7XG4gICAgICBmb3IgKGNvbnN0IGFuY2hvckVsIG9mIGxlYWYudmlldy5jb250YWluZXJFbC5xdWVyeVNlbGVjdG9yQWxsKGBhLmludGVybmFsLWxpbmtbJHtTT1VSQ0VfQVRUUn1dYCkpIHtcbiAgICAgICAgYW5jaG9yRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoQ09MT1JfVkFSKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSk7XG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJMaW5rQ29sb3JzIH07XG4iLCAiY29uc3QgeyBnZXRTdWJ0eXBlTmFtZXMsIGdldFN1YnR5cGUgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cGVzXCIpO1xyXG5jb25zdCB7IHN1YnR5cGVDb2xvciB9ID0gcmVxdWlyZShcIi4vdHlwZS1jb2xvcnNcIik7XHJcblxyXG5jb25zdCBUWVBfUFJPUEVSVFkgPSBcIlRZUFwiO1xyXG5jb25zdCBUWVBfVklFV19UWVBFID0gXCJmcmVkLXR5cC12aWV3XCI7XHJcbmNvbnN0IEFMTF9QUk9QRVJUSUVTX1ZJRVdfVFlQRSA9IFwiYWxsLXByb3BlcnRpZXNcIjtcclxuY29uc3QgSElHSExJR0hUX0NMQVNTID0gXCJmcmVkLXR5cC1kZWZhdWx0LXByb3BlcnR5XCI7XHJcbi8vIEZsb2F0aW5nIFByb3BlcnRpZXMgKHNpZWhlIHR5cGVGbG9hdGluZ0tleXMgaW4gc2V0dGluZ3MuanMpIC0gZGllc2VsYmVcclxuLy8gTGlzdGUgd2llIGRpZSBcdTAwRkNicmlnZW4gU3RhbmRhcmQtUHJvcGVydGllcyBkZXMgVHlwcywgYWJlciBrdXJzaXYgc3RhdHQgZmV0dFxyXG4vLyBtYXJraWVydCwgYW5hbG9nIHp1IEhJR0hMSUdIVF9DTEFTUy5cclxuY29uc3QgRkxPQVRJTkdfQ0xBU1MgPSBcImZyZWQtdHlwLWZsb2F0aW5nLXByb3BlcnR5XCI7XHJcblxyXG4vLyBPYnNpZGlhbiBzY2hyZWlidCBkYXRhLXByb3BlcnR5LWtleSBpbnRlcm4gaW1tZXIga2xlaW4gKHVuYWJoXHUwMEU0bmdpZyB2b24gZGVyXHJcbi8vIFNjaHJlaWJ3ZWlzZSBpbSBZQU1MKSAtIFZlcmdsZWljaCBkZXNoYWxiIGViZW5mYWxscyBjYXNlLWluc2Vuc2l0aXZlLiBUWVBcclxuLy8gaXN0IGtlaW5lIGVjaHRlIFwiU3RhbmRhcmRcIi1Qcm9wZXJ0eSAoaWhyIFdlcnQgaXN0IGltbWVyIGRlciBUWVAtTmFtZVxyXG4vLyBzZWxic3QpIC0gZmFsbHMgZG9jaCBub2NoIGlyZ2VuZHdvIGVpbiBhbHRlciBFaW50cmFnIGhlcnVtbGllZ3QsIGhpZXJcclxuLy8gZWJlbmZhbGxzIGlnbm9yaWVyZW4gc3RhdHQgZGllIFRZUC1aZWlsZSBmZXR0IHp1IG1hcmtpZXJlbi5cclxuZnVuY3Rpb24gcmF3S2V5c0ZvclR5cGUodHlwZSwgZGVmYXVsdHMpIHtcclxuICBpZiAoIXR5cGUgfHwgIWRlZmF1bHRzKSByZXR1cm4gbnVsbDtcclxuICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXMoZGVmYXVsdHMpLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwiXCIgJiYga2V5LnRvTG93ZXJDYXNlKCkgIT09IFRZUF9QUk9QRVJUWS50b0xvd2VyQ2FzZSgpKTtcclxuICByZXR1cm4ga2V5cy5sZW5ndGggPiAwID8ga2V5cy5tYXAoKGtleSkgPT4ga2V5LnRvTG93ZXJDYXNlKCkpIDogbnVsbDtcclxufVxyXG5cclxuLy8gRnJvbnRtYXR0ZXItQmxcdTAwRjZja2UgZWluZXMgVFlQcyBhbHMgTGlzdGUgdm9uIHsga2V5cywgZmxvYXRpbmcgfSAoamV3ZWlsc1xyXG4vLyBsb3dlcmNhc2UpOiB6dWVyc3QgZGFzIFRZUC1Gcm9udG1hdHRlciBkZXMgVFlQcywgZGFuYWNoIC0gZmFsbHNcclxuLy8gZ2V3XHUwMEZDbnNjaHQgLSBkZXIgQmxvY2sgZWluZXMgYmVzdGltbXRlbiBTdWJ0eXBzIChzdWJ0eXBlKSBiencuIGFsbGVyIHNlaW5lclxyXG4vLyBTdWJ0eXBlbiAoc3VidHlwZSA9PT0gQUxMX1NVQlRZUEVTKSwgc2llaGUgc3VidHlwZXMuanMuXHJcbmNvbnN0IEFMTF9TVUJUWVBFUyA9IFN5bWJvbChcImFsbC1zdWJ0eXBlc1wiKTtcclxuXHJcbmZ1bmN0aW9uIGJsb2NrT2YoZGVmYXVsdHMsIGZsb2F0aW5nS2V5cywgc2VjdGlvbiA9IG51bGwpIHtcclxuICBjb25zdCBrZXlzID0gcmF3S2V5c0ZvclR5cGUodHJ1ZSwgZGVmYXVsdHMpID8/IFtdO1xyXG4gIHJldHVybiB7IHNlY3Rpb24sIGtleXMsIGZsb2F0aW5nOiBuZXcgU2V0KChmbG9hdGluZ0tleXMgPz8gW10pLm1hcCgoa2V5KSA9PiBrZXkudG9Mb3dlckNhc2UoKSkpIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGJsb2Nrc0ZvclR5cGUocGx1Z2luLCB0eXBlLCBzdWJ0eXBlKSB7XHJcbiAgY29uc3QgeyBzZXR0aW5ncyB9ID0gcGx1Z2luO1xyXG4gIGNvbnN0IGJsb2NrcyA9IFtibG9ja09mKHNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV0sIHNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV0sIG51bGwpXTtcclxuICBjb25zdCBzdWJ0eXBlTmFtZXMgPSBzdWJ0eXBlID09PSBBTExfU1VCVFlQRVMgPyBnZXRTdWJ0eXBlTmFtZXMoc2V0dGluZ3MsIHR5cGUpIDogc3VidHlwZSA/IFtzdWJ0eXBlXSA6IFtdO1xyXG4gIGZvciAoY29uc3QgbmFtZSBvZiBzdWJ0eXBlTmFtZXMpIHtcclxuICAgIGNvbnN0IGRhdGEgPSBnZXRTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBuYW1lKTtcclxuICAgIGlmIChkYXRhKSBibG9ja3MucHVzaChibG9ja09mKGRhdGEuZnJvbnRtYXR0ZXIsIGRhdGEuZmxvYXRpbmdLZXlzLCBuYW1lKSk7XHJcbiAgfVxyXG4gIHJldHVybiBibG9ja3M7XHJcbn1cclxuXHJcbi8vIExpZWZlcnQgZ2V0cmVubnRlIFNldHMgZlx1MDBGQ3IgZmV0dCBkYXJ6dXN0ZWxsZW5kZSAoXCJzdGFuZGFyZFwiKSB1bmQga3Vyc2l2XHJcbi8vIGRhcnp1c3RlbGxlbmRlIChcImZsb2F0aW5nXCIpIFByb3BlcnR5LU5hbWVuIChqZXdlaWxzIGxvd2VyY2FzZSkgYXVzIGRlblxyXG4vLyBcdTAwRkNiZXJnZWJlbmVuIEJsXHUwMEY2Y2tlbiAtIEZsb2F0aW5nLW1hcmtpZXJ0ZSBLZXlzIHpcdTAwRTRobGVuIGRhYmVpIG51ciB6dVxyXG4vLyBcImZsb2F0aW5nXCIsIG5pZSB6dXNcdTAwRTR0emxpY2ggenUgXCJzdGFuZGFyZFwiLiBLb21tdCBlaW4gS2V5IGluIG1laHJlcmVuIEJsXHUwMEY2Y2tlblxyXG4vLyB2b3IsIGdpbHQgZGllIE1hcmtpZXJ1bmcgZGVzIHNwXHUwMEU0dGVyZW4gQmxvY2tzOiBmXHUwMEZDciBlaW5lIE5vdGl6IHNpbmQgZGFzXHJcbi8vIFRZUC1Gcm9udG1hdHRlciB1bmQgZGFuYWNoIGRlciBCbG9jayBpaHJlcyBTVUJUWVBzLCBkZXIgU3VidHlwIGdld2lubnQgYWxzb1xyXG4vLyAtIGRpZXNlbGJlIFJlZ2VsIHdpZSBiZWltIFdlcnQgaW4gZ2V0VHlwZURlZmF1bHRzIChtYWluLmpzKS5cclxuZnVuY3Rpb24gc3BsaXRLZXlzKGJsb2Nrcykge1xyXG4gIGNvbnN0IGlzRmxvYXRpbmcgPSBuZXcgTWFwKCk7XHJcbiAgZm9yIChjb25zdCB7IGtleXMsIGZsb2F0aW5nIH0gb2YgYmxvY2tzKSB7XHJcbiAgICBmb3IgKGNvbnN0IGtleSBvZiBrZXlzKSBpc0Zsb2F0aW5nLnNldChrZXksIGZsb2F0aW5nLmhhcyhrZXkpKTtcclxuICB9XHJcbiAgY29uc3Qgc3RhbmRhcmQgPSBuZXcgU2V0KCk7XHJcbiAgY29uc3QgZmxvYXRpbmcgPSBuZXcgU2V0KCk7XHJcbiAgZm9yIChjb25zdCBba2V5LCBmbGFnXSBvZiBpc0Zsb2F0aW5nKSAoZmxhZyA/IGZsb2F0aW5nIDogc3RhbmRhcmQpLmFkZChrZXkpO1xyXG4gIHJldHVybiB7IHN0YW5kYXJkOiBzdGFuZGFyZC5zaXplID4gMCA/IHN0YW5kYXJkIDogbnVsbCwgZmxvYXRpbmc6IGZsb2F0aW5nLnNpemUgPiAwID8gZmxvYXRpbmcgOiBudWxsIH07XHJcbn1cclxuXHJcbmNvbnN0IE5PX0tFWVMgPSB7IHN0YW5kYXJkOiBudWxsLCBmbG9hdGluZzogbnVsbCB9O1xyXG5cclxuZnVuY3Rpb24ga2V5c0ZvckZpbGUocGx1Z2luLCBmaWxlKSB7XHJcbiAgY29uc3QgeyBjb2xvclZpZXdzIH0gPSBwbHVnaW4uc2V0dGluZ3M7XHJcbiAgaWYgKCFjb2xvclZpZXdzLmZyb250bWF0dGVyRGVmYXVsdHMpIHJldHVybiBOT19LRVlTO1xyXG4gIGNvbnN0IHR5cGUgPSBwbHVnaW4udHlwSW5kZXgudHlwZU9mKGZpbGUpO1xyXG4gIGlmICghdHlwZSkgcmV0dXJuIE5PX0tFWVM7XHJcbiAgY29uc3Qgc3VidHlwZSA9IGNvbG9yVmlld3MuZnJvbnRtYXR0ZXJEZWZhdWx0c1N1YnR5cCA/IHBsdWdpbi50eXBJbmRleC5zdWJ0eXBlT2YoZmlsZSkgOiBudWxsO1xyXG4gIHJldHVybiBzcGxpdEtleXMoYmxvY2tzRm9yVHlwZShwbHVnaW4sIHR5cGUsIHN1YnR5cGUpKTtcclxufVxyXG5cclxuLy8gRWRpdG9yIGRlciBUWVAtRGV0YWlsYW5zaWNodDogamUgQmxvY2sgZWluZSBlaWdlbmUgRWRpdG9yLUluc3RhbnogKHNpZWhlXHJcbi8vIHR5cGVTdG9yZS9zdWJ0eXBlU3RvcmUgaW4gdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpLCBkaWUgTWFya2llcnVuZyB6ZWlndFxyXG4vLyBhbHNvIGdlbmF1IGRpZSBTdGFuZGFyZC0vRmxvYXRpbmctUHJvcGVydGllcyBkaWVzZXMgZWluZW4gQmxvY2tzIC1cclxuLy8gU3VidHlwLUJsXHUwMEY2Y2tlIG51ciBtaXQgZGVtIFVudGVyLVNjaGFsdGVyIFwiU3VidHlwXCIuXHJcbmZ1bmN0aW9uIGtleXNGb3JTdG9yZShwbHVnaW4sIHN0b3JlKSB7XHJcbiAgY29uc3QgeyBjb2xvclZpZXdzIH0gPSBwbHVnaW4uc2V0dGluZ3M7XHJcbiAgaWYgKCFjb2xvclZpZXdzLmZyb250bWF0dGVyRGVmYXVsdHMgfHwgIXN0b3JlKSByZXR1cm4gTk9fS0VZUztcclxuICBpZiAoc3RvcmUuc3VidHlwZSAmJiAhY29sb3JWaWV3cy5mcm9udG1hdHRlckRlZmF1bHRzU3VidHlwKSByZXR1cm4gTk9fS0VZUztcclxuICByZXR1cm4gc3BsaXRLZXlzKFtibG9ja09mKHN0b3JlLmdldEZyb250bWF0dGVyKCksIHN0b3JlLmdldEZsb2F0aW5nKCkpXSk7XHJcbn1cclxuXHJcbi8vIFByb3BlcnR5LU5hbWUgKGxvd2VyY2FzZSkgLT4geyB0eXBlcywgYWxsRmxvYXRpbmcgfSBcdTAwRkNiZXIgYWxsZSBUeXBlbiwgaW5cclxuLy8gZGVyZW4gRnJvbnRtYXR0ZXIgKGdnZi4gaW5rbC4gaWhyZXIgU3VidHlwLUJsXHUwMEY2Y2tlKSBlciB2b3Jrb21tdC4gRGllIFwiQWxsXHJcbi8vIFByb3BlcnRpZXNcIi1BbnNpY2h0IGlzdCB2YXVsdC13ZWl0IHVuZCBrZW5udCBrZWluZW4gZWluemVsbmVuIFRZUC1Lb250ZXh0IC1cclxuLy8gZGFoZXIgaGllciBnbGVpY2ggZGllIHZvbGxzdFx1MDBFNG5kaWdlIFp1b3JkbnVuZyBzYW1tZWxuLCBkYW1pdFxyXG4vLyBhcHBseVRvQWxsUHJvcGVydGllc1ZpZXcgendpc2NoZW4gXCJnZW5hdSBlaW4gVHlwXCIgKGVpbmZcdTAwRTRyYmVuKSB1bmQgXCJtZWhyZXJlXHJcbi8vIFR5cGVuXCIgKGZldHQpIHVudGVyc2NoZWlkZW4ga2Fubi4gdHlwZXMgaXN0IE1hcChUWVAgLT4gTGlzdGUgZGVyIEJsXHUwMEY2Y2tlLFxyXG4vLyBkaWUgZGVuIEtleSBmXHUwMEZDaHJlbjsgbnVsbCBzdGVodCBmXHUwMEZDciBkYXMgVFlQLUZyb250bWF0dGVyKSAtIGVpbiBLZXkgZGFyZiBpblxyXG4vLyBtZWhyZXJlbiBCbFx1MDBGNmNrZW4gZWluZXMgVFlQcyBzdGVoZW4sIGVpbmdlZlx1MDBFNHJidCB3aXJkIG51ciBkZXIgZWluZGV1dGlnZVxyXG4vLyBGYWxsLiBhbGxGbG9hdGluZyBpc3QgdHJ1ZSwgd2VubiBkZXIgS2V5IGluIEpFREVNIEJsb2NrIEpFREVTIFR5cHMgYWxzXHJcbi8vIEZsb2F0aW5nIG1hcmtpZXJ0IGlzdCAoc29uc3Qgd1x1MDBFNHJlIGRpZSBLdXJzaXYtTWFya2llcnVuZyBpcnJlZlx1MDBGQ2hyZW5kKS5cclxuLy9cclxuLy8gRWlnZW5lciBTY2hhbHRlciAoY29sb3JWaWV3cy5hbGxQcm9wZXJ0aWVzKSwgdW5hYmhcdTAwRTRuZ2lnIHZvblxyXG4vLyBjb2xvclZpZXdzLmZyb250bWF0dGVyRGVmYXVsdHMuIEVpbmUgU3VidHlwLVByb3BlcnR5IHpcdTAwRTRobHQgZlx1MDBGQ3IgaWhyZW4gVFlQLlxyXG5mdW5jdGlvbiB0eXBlc1VzaW5nS2V5TWFwKHBsdWdpbikge1xyXG4gIGNvbnN0IG1hcCA9IG5ldyBNYXAoKTtcclxuICBjb25zdCB7IGNvbG9yVmlld3MgfSA9IHBsdWdpbi5zZXR0aW5ncztcclxuICBpZiAoIWNvbG9yVmlld3MuYWxsUHJvcGVydGllcykgcmV0dXJuIG1hcDtcclxuICBjb25zdCB0eXBlcyA9IG5ldyBTZXQoW1xyXG4gICAgLi4uT2JqZWN0LmtleXMocGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXIpLFxyXG4gICAgLi4uKGNvbG9yVmlld3MuYWxsUHJvcGVydGllc1N1YnR5cCA/IE9iamVjdC5rZXlzKHBsdWdpbi5zZXR0aW5ncy50eXBlU3VidHlwZXMgPz8ge30pIDogW10pLFxyXG4gIF0pO1xyXG4gIGZvciAoY29uc3QgdHlwZSBvZiB0eXBlcykge1xyXG4gICAgY29uc3QgYmxvY2tzID0gYmxvY2tzRm9yVHlwZShwbHVnaW4sIHR5cGUsIGNvbG9yVmlld3MuYWxsUHJvcGVydGllc1N1YnR5cCA/IEFMTF9TVUJUWVBFUyA6IG51bGwpO1xyXG4gICAgZm9yIChjb25zdCB7IHNlY3Rpb24sIGtleXMsIGZsb2F0aW5nIH0gb2YgYmxvY2tzKSB7XHJcbiAgICAgIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcclxuICAgICAgICBpZiAoIW1hcC5oYXMoa2V5KSkgbWFwLnNldChrZXksIHsgdHlwZXM6IG5ldyBNYXAoKSwgYWxsRmxvYXRpbmc6IHRydWUgfSk7XHJcbiAgICAgICAgY29uc3QgZW50cnkgPSBtYXAuZ2V0KGtleSk7XHJcbiAgICAgICAgaWYgKCFlbnRyeS50eXBlcy5oYXModHlwZSkpIGVudHJ5LnR5cGVzLnNldCh0eXBlLCBbXSk7XHJcbiAgICAgICAgZW50cnkudHlwZXMuZ2V0KHR5cGUpLnB1c2goc2VjdGlvbik7XHJcbiAgICAgICAgZW50cnkuYWxsRmxvYXRpbmcgPSBlbnRyeS5hbGxGbG9hdGluZyAmJiBmbG9hdGluZy5oYXMoa2V5KTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuICByZXR1cm4gbWFwO1xyXG59XHJcblxyXG4vLyBOdXIgZGFzIExhYmVsIChQcm9wZXJ0eS1LZXktSW5wdXQpIGZldHQva3Vyc2l2IG1hcmtpZXJlbiwgbmljaHQgZGllIFdlcnRlIC1cclxuLy8gYmV0cmlmZnQgc293b2hsIE5vdGl6ZW4gKEZyb250bWF0dGVyIGltIERva3VtZW50ICsgXCJQcm9wZXJ0aWVzXCItXHJcbi8vIFNlaXRlbmxlaXN0ZSkgYWxzIGF1Y2ggZGllIGVpZ2VuZSBUWVAtRGV0YWlsYW5zaWNodCBkZXMgUGx1Z2lucyBzZWxic3QuXHJcbmZ1bmN0aW9uIGFwcGx5VG9Db250YWluZXIoY29udGFpbmVyRWwsIHN0YW5kYXJkS2V5cywgZmxvYXRpbmdLZXlzKSB7XHJcbiAgaWYgKCFjb250YWluZXJFbCkgcmV0dXJuO1xyXG4gIGNvbnN0IHJvd3MgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLm1ldGFkYXRhLXByb3BlcnR5W2RhdGEtcHJvcGVydHkta2V5XVwiKTtcclxuICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSB7XHJcbiAgICBjb25zdCBrZXlFbCA9IHJvdy5xdWVyeVNlbGVjdG9yKFwiLm1ldGFkYXRhLXByb3BlcnR5LWtleS1pbnB1dFwiKTtcclxuICAgIGlmICgha2V5RWwpIGNvbnRpbnVlO1xyXG4gICAgY29uc3QgcHJvcGVydHlLZXkgPSByb3cuZ2V0QXR0cmlidXRlKFwiZGF0YS1wcm9wZXJ0eS1rZXlcIik7XHJcbiAgICBrZXlFbC5jbGFzc0xpc3QudG9nZ2xlKEhJR0hMSUdIVF9DTEFTUywgISFzdGFuZGFyZEtleXMgJiYgc3RhbmRhcmRLZXlzLmhhcyhwcm9wZXJ0eUtleSkpO1xyXG4gICAga2V5RWwuY2xhc3NMaXN0LnRvZ2dsZShGTE9BVElOR19DTEFTUywgISFmbG9hdGluZ0tleXMgJiYgZmxvYXRpbmdLZXlzLmhhcyhwcm9wZXJ0eUtleSkpO1xyXG4gIH1cclxufVxyXG5cclxuLy8gRGllIFwiQWxsIFByb3BlcnRpZXNcIi1BbnNpY2h0IHJlbmRlcnQgaWhyZSBaZWlsZW4gbmljaHQgXHUwMEZDYmVyIGRhc1xyXG4vLyBNZXRhZGF0YS1XaWRnZXQsIHNvbmRlcm4gXHUwMEZDYmVyIGVpZ2VuZSBUcmVlLUl0ZW0tS29tcG9uZW50ZW4gKEtsYXNzZSBcImFIXCIgaW1cclxuLy8gZ2ViYXV0ZW4gYXBwLmpzKSwgZXJyZWljaGJhciBcdTAwRkNiZXIgdmlldy5kb21zIChQcm9wZXJ0eS1OYW1lIC0+IEtvbXBvbmVudGUpLlxyXG4vLyBEZXJlbiBUaXRlbC1FbGVtZW50IHRyXHUwMEU0Z3QgZGllIEtsYXNzZSBcInRyZWUtaXRlbS1pbm5lci10ZXh0XCIsIG5pY2h0XHJcbi8vIFwiLm1ldGFkYXRhLXByb3BlcnR5LWtleS1pbnB1dFwiIHdpZSBpbSBGcm9udG1hdHRlci1XaWRnZXQuXHJcbi8vXHJcbi8vIE51dHp0IGdlbmF1IGVpbiBUeXAgZGllc2UgUHJvcGVydHkgYWxzIFN0YW5kYXJkLCB3aXJkIGRlciBOYW1lIGluIGRlc3NlblxyXG4vLyBGYXJiZSBlaW5nZWZcdTAwRTRyYnQgKHdpZSBkZXIgRmFyYnB1bmt0L2RpZSBMaXN0ZSBkZXMgVHlwcykgLSBlaW5kZXV0aWcgZ2VudWcsXHJcbi8vIHVtIHNpZSB6dXp1b3JkbmVuLiBOdXR6ZW4gbWVocmVyZSBUeXBlbiBzaWUsIHdcdTAwRTRyZSBlaW5lIGVpbnplbG5lIEZhcmJlXHJcbi8vIGlycmVmXHUwMEZDaHJlbmQsIGRhaGVyIHN0YXR0ZGVzc2VuIGZldHQgKGRpZXNlbGJlIE1hcmtpZXJ1bmcgd2llIGltXHJcbi8vIEZyb250bWF0dGVyLVdpZGdldCBlaW5lciBOb3RpeikuXHJcbmZ1bmN0aW9uIGFwcGx5VG9BbGxQcm9wZXJ0aWVzVmlldyhwbHVnaW4pIHtcclxuICBjb25zdCB1c2FnZU1hcCA9IHR5cGVzVXNpbmdLZXlNYXAocGx1Z2luKTtcclxuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEFMTF9QUk9QRVJUSUVTX1ZJRVdfVFlQRSkpIHtcclxuICAgIGNvbnN0IGRvbXMgPSBsZWFmLnZpZXc/LmRvbXM7XHJcbiAgICBpZiAoIWRvbXMpIGNvbnRpbnVlO1xyXG4gICAgZm9yIChjb25zdCBba2V5LCBkb21dIG9mIE9iamVjdC5lbnRyaWVzKGRvbXMpKSB7XHJcbiAgICAgIGNvbnN0IHRpdGxlRWwgPSBkb20/LnRpdGxlRWw7XHJcbiAgICAgIGlmICghdGl0bGVFbCkgY29udGludWU7XHJcblxyXG4gICAgICBjb25zdCBlbnRyeSA9IHVzYWdlTWFwLmdldChrZXkudG9Mb3dlckNhc2UoKSk7XHJcbiAgICAgIGNvbnN0IHR5cGVzID0gZW50cnk/LnR5cGVzO1xyXG4gICAgICBjb25zdCBjb3VudCA9IHR5cGVzID8gdHlwZXMuc2l6ZSA6IDA7XHJcbiAgICAgIHRpdGxlRWwuY2xhc3NMaXN0LnRvZ2dsZShISUdITElHSFRfQ0xBU1MsIGNvdW50ID4gMSk7XHJcblxyXG4gICAgICAvLyBLdXJzaXYsIHNvYmFsZCBkaWUgUHJvcGVydHkgXHUwMERDQkVSQUxMIGFscyBGbG9hdGluZyBtYXJraWVydCBpc3QgLSBpblxyXG4gICAgICAvLyBqZWRlbSBCbG9jayBqZWRlcyBUWVBzLCBkZXIgc2llIGZcdTAwRkNocnQuIEFuZGVycyBhbHMgZGllIEZldHQtTWFya2llcnVuZ1xyXG4gICAgICAvLyBpc3QgZGFzIG5pY2h0IGF1ZiBcImdlbmF1IGVpbiBUWVBcIiBiZXNjaHJcdTAwRTRua3Q6IGJlaWRlcyBrYW5uIGFsc29cclxuICAgICAgLy8genVzYW1tZW50cmVmZmVuIChtZWhyZXJlIFRZUGVuLCBkb3J0IGR1cmNod2VnIGZsb2F0aW5nKS5cclxuICAgICAgdGl0bGVFbC5jbGFzc0xpc3QudG9nZ2xlKEZMT0FUSU5HX0NMQVNTLCBjb3VudCA+IDAgJiYgZW50cnkuYWxsRmxvYXRpbmcpO1xyXG5cclxuICAgICAgLy8gTWl0IFwiU3VidHlwXCIgaW4gZGVyIEZhcmJlIGRlcyBTdWJ0eXAtQmxvY2tzLCBhdXMgZGVtIGRpZSBQcm9wZXJ0eVxyXG4gICAgICAvLyBzdGFtbXQgLSBhYmVyIG51ciwgd2VubiBzaWUgaW4gZ2VuYXUgZWluZW0gQmxvY2sgZGllc2VzIFRZUHMgc3RlaHQuXHJcbiAgICAgIC8vIEJlaSBlaW5lciBEb3BwbHVuZyBcdTAwRkNiZXIgbWVocmVyZSBCbFx1MDBGNmNrZSB3XHUwMEU0cmUgZGllIFdhaGwgd2lsbGtcdTAwRkNybGljaCB1bmRcclxuICAgICAgLy8gd1x1MDBGQ3JkZSBzaWNoIGJlaW0gVW1zb3J0aWVyZW4gZGVyIEJsXHUwMEY2Y2tlIFx1MDBFNG5kZXJuLCBkYWhlciBkYW5uIGRpZVxyXG4gICAgICAvLyBUWVAtRmFyYmUgKHN1YnR5cGVDb2xvciBtaXQgbnVsbCBsaWVmZXJ0IGdlbmF1IGRpZSkuXHJcbiAgICAgIGlmIChjb3VudCA9PT0gMSkge1xyXG4gICAgICAgIGNvbnN0IFtbb25seVR5cGUsIHNlY3Rpb25zXV0gPSB0eXBlcztcclxuICAgICAgICBjb25zdCBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmFsbFByb3BlcnRpZXNTdWJ0eXBcclxuICAgICAgICAgID8gc3VidHlwZUNvbG9yKHBsdWdpbi5zZXR0aW5ncywgb25seVR5cGUsIHNlY3Rpb25zLmxlbmd0aCA9PT0gMSA/IHNlY3Rpb25zWzBdIDogbnVsbClcclxuICAgICAgICAgIDogcGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbb25seVR5cGVdO1xyXG4gICAgICAgIC8vICFpbXBvcnRhbnQgdmlhIHNldFByb3BlcnR5LCBkYSBkaWUgRmV0dC1SZWdlbCBmXHUwMEZDciAuZnJlZC10eXAtZGVmYXVsdC1cclxuICAgICAgICAvLyBwcm9wZXJ0eSBpbiBzdHlsZXMuY3NzIGViZW5mYWxscyAhaW1wb3J0YW50IGNvbG9yIHNldHp0IHVuZCBlaW5cclxuICAgICAgICAvLyBJbmxpbmUtU3R5bGUgb2huZSAhaW1wb3J0YW50IGRhZ2VnZW4gdmVybGllcmVuIHdcdTAwRkNyZGUsIGZhbGxzIGRpZVxyXG4gICAgICAgIC8vIEtsYXNzZSAoYXVzIGVpbmVtIHZvcmhlcmlnZW4gWnVzdGFuZCBtaXQgbWVocmVyZW4gVHlwZW4pIG5vY2ggZHJhbmhcdTAwRTRuZ3QuXHJcbiAgICAgICAgaWYgKGNvbG9yKSB0aXRsZUVsLnN0eWxlLnNldFByb3BlcnR5KFwiY29sb3JcIiwgY29sb3IsIFwiaW1wb3J0YW50XCIpO1xyXG4gICAgICAgIGVsc2UgdGl0bGVFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImNvbG9yXCIpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRpdGxlRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gYXBwbHlGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQocGx1Z2luKSB7XHJcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpKSB7XHJcbiAgICBjb25zdCB2aWV3ID0gbGVhZi52aWV3O1xyXG4gICAgY29uc3QgeyBzdGFuZGFyZCwgZmxvYXRpbmcgfSA9IGtleXNGb3JGaWxlKHBsdWdpbiwgdmlldz8uZmlsZSk7XHJcbiAgICBhcHBseVRvQ29udGFpbmVyKHZpZXc/Lm1ldGFkYXRhRWRpdG9yPy5jb250YWluZXJFbCwgc3RhbmRhcmQsIGZsb2F0aW5nKTtcclxuICB9XHJcblxyXG4gIC8vIERpZSBcIlByb3BlcnRpZXNcIi1TZWl0ZW5sZWlzdGUgemVpZ3QgaW1tZXIgZGllIGFrdGl2ZSBEYXRlaSwgaFx1MDBFNGx0IGFiZXJcclxuICAvLyBrZWluZSBlaWdlbmUsIHZlcmxcdTAwRTRzc2xpY2hlIFJlZmVyZW56IGRhcmF1ZiBncmlmZmJlcmVpdCB3aWUgTWFya2Rvd25WaWV3IC1cclxuICAvLyBkYWhlciBhdWYgZGllIHZvbSBXb3Jrc3BhY2UgYWt0dWVsbCBha3RpdmUgRGF0ZWkgenVyXHUwMEZDY2tmYWxsZW4uXHJcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcImZpbGUtcHJvcGVydGllc1wiKSkge1xyXG4gICAgY29uc3QgdmlldyA9IGxlYWYudmlldztcclxuICAgIGNvbnN0IGZpbGUgPSB2aWV3Py5maWxlID8/IHBsdWdpbi5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcclxuICAgIGNvbnN0IHsgc3RhbmRhcmQsIGZsb2F0aW5nIH0gPSBrZXlzRm9yRmlsZShwbHVnaW4sIGZpbGUpO1xyXG4gICAgYXBwbHlUb0NvbnRhaW5lcih2aWV3Py5tZXRhZGF0YUVkaXRvcj8uY29udGFpbmVyRWwsIHN0YW5kYXJkLCBmbG9hdGluZyk7XHJcbiAgfVxyXG5cclxuICAvLyBUWVAtRGV0YWlsYW5zaWNodCBkZXMgUGx1Z2lucyBzZWxic3Q6IGRvcnQgemVpZ3QgamVkZXIgRWRpdG9yIGRpcmVrdCBlaW5lblxyXG4gIC8vIEZyb250bWF0dGVyLUJsb2NrIChUWVAgYnp3LiBTdWJ0eXApLCBlbnRzcHJpY2h0IGFsc28gMToxIGRlc3NlblxyXG4gIC8vIFwiU3RhbmRhcmRcIi0gYnp3LiBcIkZsb2F0aW5nXCItUHJvcGVydGllcyAodmlldy5mcm9udG1hdHRlckVkaXRvcnMga29tbXQgYXVzXHJcbiAgLy8gdHlwLXZpZXcuanMsIGVkaXRvci5vd25lci5mcmVkU3RvcmUgYXVzIHR5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKS5cclxuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFRZUF9WSUVXX1RZUEUpKSB7XHJcbiAgICBmb3IgKGNvbnN0IGVkaXRvciBvZiBsZWFmLnZpZXc/LmZyb250bWF0dGVyRWRpdG9ycyA/PyBbXSkge1xyXG4gICAgICBjb25zdCB7IHN0YW5kYXJkLCBmbG9hdGluZyB9ID0ga2V5c0ZvclN0b3JlKHBsdWdpbiwgZWRpdG9yLm93bmVyPy5mcmVkU3RvcmUpO1xyXG4gICAgICBhcHBseVRvQ29udGFpbmVyKGVkaXRvci5jb250YWluZXJFbCwgc3RhbmRhcmQsIGZsb2F0aW5nKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFwcGx5VG9BbGxQcm9wZXJ0aWVzVmlldyhwbHVnaW4pO1xyXG59XHJcblxyXG5mdW5jdGlvbiByZWdpc3RlckZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodChwbHVnaW4pIHtcclxuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQocGx1Z2luKTtcclxuXHJcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC5tZXRhZGF0YUNhY2hlLm9uKFwiY2hhbmdlZFwiLCByZWZyZXNoKSk7XHJcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC5tZXRhZGF0YUNhY2hlLm9uKFwicmVzb2x2ZWRcIiwgcmVmcmVzaCkpO1xyXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCByZWZyZXNoKSk7XHJcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJhY3RpdmUtbGVhZi1jaGFuZ2VcIiwgcmVmcmVzaCkpO1xyXG5cclxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KHJlZnJlc2gpO1xyXG5cclxuICByZXR1cm4gcmVmcmVzaDtcclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyRnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0IH07XHJcbiIsICJjb25zdCB7IE5vdGljZSB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xyXG5jb25zdCB7IHR5cGVTdG9yZSwgc3VidHlwZVN0b3JlIH0gPSByZXF1aXJlKFwiLi90eXBlLWZyb250bWF0dGVyLWVkaXRvclwiKTtcclxuY29uc3QgeyBnZXRTdWJ0eXBlTmFtZXMsIGlzRW1wdHlWYWx1ZSB9ID0gcmVxdWlyZShcIi4vc3VidHlwZXNcIik7XHJcblxyXG5jb25zdCBUWVBfUFJPUEVSVFkgPSBcIlRZUFwiO1xyXG5jb25zdCBTVUJUWVBfUFJPUEVSVFkgPSBcIlNVQlRZUFwiO1xyXG5cclxuLy8gT2JzaWRpYW4gc2NocmVpYnQgUHJvcGVydHktTmFtZW4gaW50ZXJuIGtsZWluIChzaWVoZSBmcm9udG1hdHRlci1kZWZhdWx0LVxyXG4vLyBoaWdobGlnaHQuanMpIC0gWnVvcmRudW5nIGRhaGVyIGNhc2UtaW5zZW5zaXRpdiwgZGVyIG5ldWUgTmFtZSB3aXJkIGFiZXJcclxuLy8gZXhha3Qgc28gXHUwMEZDYmVybm9tbWVuLCB3aWUgZXIgZWluZ2VnZWJlbiB3dXJkZS5cclxuZnVuY3Rpb24gc2FtZUtleShhLCBiKSB7XHJcbiAgcmV0dXJuIGEudG9Mb3dlckNhc2UoKSA9PT0gYi50b0xvd2VyQ2FzZSgpO1xyXG59XHJcblxyXG4vLyBCZW5lbm50IG9sZEtleSBpbiBlaW5lbSBGcm9udG1hdHRlci1CbG9jayAoVFlQIG9kZXIgU3VidHlwLCBzaWVoZVxyXG4vLyB0eXBlU3RvcmUvc3VidHlwZVN0b3JlIGluIHR5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKSB1bSAoUmVpaGVuZm9sZ2UgYmxlaWJ0XHJcbi8vIGVyaGFsdGVuKSB1bmQgemllaHQgZGllIEZsb2F0aW5nLU1hcmtpZXJ1bmcgbWl0LiBHaWJ0IGVzIG5ld0tleSBkb3J0IGJlcmVpdHNcclxuLy8gKFp1c2FtbWVubGVnZW4sIGFuYWxvZyB6dSBPYnNpZGlhbnMgZWlnZW5lbSBNZXJnZSBpbiBkZW4gTm90aXplbiksIGJsZWlidCBkZXJcclxuLy8gYmVzdGVoZW5kZSBFaW50cmFnIGFuIHNlaW5lciBQb3NpdGlvbiAtIGRlciBXZXJ0IGRlcyBhbHRlbiBFaW50cmFncyB3aXJkIG51clxyXG4vLyBcdTAwRkNiZXJub21tZW4sIHdlbm4gZGVyIGJlc3RlaGVuZGUgbGVlciBpc3QuIExpZWZlcnQgdHJ1ZSBiZWkgZWluZXIgXHUwMEM0bmRlcnVuZy5cclxuZnVuY3Rpb24gcmVuYW1lSW5TdG9yZShzdG9yZSwgb2xkS2V5LCBuZXdLZXkpIHtcclxuICBjb25zdCBkZWZhdWx0cyA9IHN0b3JlLmdldEZyb250bWF0dGVyKCk7XHJcbiAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKGRlZmF1bHRzKTtcclxuICBjb25zdCBzb3VyY2VLZXkgPSBrZXlzLmZpbmQoKGtleSkgPT4gc2FtZUtleShrZXksIG9sZEtleSkpO1xyXG4gIGlmIChzb3VyY2VLZXkgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZhbHNlO1xyXG4gIC8vIEJlaSBlaW5lciByZWluZW4gXHUwMEM0bmRlcnVuZyBkZXIgR3JvXHUwMERGLS9LbGVpbnNjaHJlaWJ1bmcgaXN0IHNvdXJjZUtleSBzZWxic3RcclxuICAvLyBkZXIgZWluemlnZSBUcmVmZmVyIGZcdTAwRkNyIG5ld0tleSAtIGRhcyBpc3QgZGFubiBrZWluIFp1c2FtbWVubGVnZW4uXHJcbiAgY29uc3QgdGFyZ2V0S2V5ID0ga2V5cy5maW5kKChrZXkpID0+IGtleSAhPT0gc291cmNlS2V5ICYmIHNhbWVLZXkoa2V5LCBuZXdLZXkpKTtcclxuICBpZiAodGFyZ2V0S2V5ID09PSB1bmRlZmluZWQgJiYgc291cmNlS2V5ID09PSBuZXdLZXkpIHJldHVybiBmYWxzZTtcclxuXHJcbiAgY29uc3QgbmV4dCA9IHt9O1xyXG4gIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcclxuICAgIGlmIChrZXkgIT09IHNvdXJjZUtleSkge1xyXG4gICAgICBuZXh0W2tleV0gPSBkZWZhdWx0c1trZXldO1xyXG4gICAgfSBlbHNlIGlmICh0YXJnZXRLZXkgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICBuZXh0W25ld0tleV0gPSBkZWZhdWx0c1tzb3VyY2VLZXldO1xyXG4gICAgfVxyXG4gIH1cclxuICBpZiAodGFyZ2V0S2V5ICE9PSB1bmRlZmluZWQgJiYgaXNFbXB0eVZhbHVlKG5leHRbdGFyZ2V0S2V5XSkpIG5leHRbdGFyZ2V0S2V5XSA9IGRlZmF1bHRzW3NvdXJjZUtleV07XHJcbiAgc3RvcmUuc2V0RnJvbnRtYXR0ZXIobmV4dCk7XHJcblxyXG4gIGNvbnN0IGZsb2F0aW5nID0gc3RvcmUuZ2V0RmxvYXRpbmcoKTtcclxuICBpZiAoZmxvYXRpbmcubGVuZ3RoID4gMCkge1xyXG4gICAgLy8gQmVpbSBadXNhbW1lbmxlZ2VuIGJsZWlidCBkaWUgRmxvYXRpbmctTWFya2llcnVuZyBkZXMgWmllbHMgbWFcdTAwREZnZWJsaWNoLlxyXG4gICAgc3RvcmUuc2V0RmxvYXRpbmcoXHJcbiAgICAgIHRhcmdldEtleSAhPT0gdW5kZWZpbmVkXHJcbiAgICAgICAgPyBmbG9hdGluZy5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBzb3VyY2VLZXkpXHJcbiAgICAgICAgOiBmbG9hdGluZy5tYXAoKGtleSkgPT4gKGtleSA9PT0gc291cmNlS2V5ID8gbmV3S2V5IDoga2V5KSlcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICAvLyBEZXIgU2hvcnRjdXQgaFx1MDBFNG5ndCBhbSBLZXkgKHNpZWhlIHNob3J0Y3V0cy5qcykgdW5kIHdhbmRlcnQgZGVzaGFsYiBtaXQgZGVyXHJcbiAgLy8gVW1iZW5lbm51bmcgbWl0IC0gYmVpbSBadXNhbW1lbmxlZ2VuIGJsZWlidCwgd2llIGJlaSBGbG9hdGluZywgZGVyIGRlc1xyXG4gIC8vIFppZWxzIG1hXHUwMERGZ2VibGljaC5cclxuICBjb25zdCBzaG9ydGN1dHMgPSB7IC4uLnN0b3JlLmdldFNob3J0Y3V0cygpIH07XHJcbiAgaWYgKHNob3J0Y3V0c1tzb3VyY2VLZXldKSB7XHJcbiAgICBpZiAodGFyZ2V0S2V5ID09PSB1bmRlZmluZWQpIHNob3J0Y3V0c1tuZXdLZXldID0gc2hvcnRjdXRzW3NvdXJjZUtleV07XHJcbiAgICBkZWxldGUgc2hvcnRjdXRzW3NvdXJjZUtleV07XHJcbiAgICBzdG9yZS5zZXRTaG9ydGN1dHMoc2hvcnRjdXRzKTtcclxuICB9XHJcbiAgcmV0dXJuIHRydWU7XHJcbn1cclxuXHJcbi8vIEVpbnplbC1Qcm9wZXJ0eS1FaW50clx1MDBFNGdlIGRlciBnbG9iYWxlbiBSZWloZW5mb2xnZSAtIGRvcnQgc2luZCBrZWluZVxyXG4vLyBEb3BwbHVuZ2VuIGVybGF1YnQsIGVpbiBiZXJlaXRzIHZvcmhhbmRlbmVyIFppZWxlaW50cmFnIGJlaFx1MDBFNGx0IGRhaGVyIHNlaW5lXHJcbi8vIFBvc2l0aW9uIHVuZCBkZXIgYWx0ZSBlbnRmXHUwMEU0bGx0LlxyXG5mdW5jdGlvbiByZW5hbWVJbkdsb2JhbE9yZGVyKHNldHRpbmdzLCBvbGRLZXksIG5ld0tleSkge1xyXG4gIGNvbnN0IG9yZGVyID0gc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcjtcclxuICBjb25zdCBzb3VyY2UgPSBvcmRlci5maW5kKChlbnRyeSkgPT4gZW50cnkua2luZCA9PT0gXCJwcm9wZXJ0eVwiICYmIHNhbWVLZXkoZW50cnkubmFtZSwgb2xkS2V5KSk7XHJcbiAgaWYgKCFzb3VyY2UpIHJldHVybiBmYWxzZTtcclxuICBjb25zdCB0YXJnZXQgPSBvcmRlci5maW5kKChlbnRyeSkgPT4gZW50cnkgIT09IHNvdXJjZSAmJiBlbnRyeS5raW5kID09PSBcInByb3BlcnR5XCIgJiYgc2FtZUtleShlbnRyeS5uYW1lLCBuZXdLZXkpKTtcclxuICBpZiAodGFyZ2V0KSBzZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyID0gb3JkZXIuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkgIT09IHNvdXJjZSk7XHJcbiAgZWxzZSBpZiAoc291cmNlLm5hbWUgPT09IG5ld0tleSkgcmV0dXJuIGZhbHNlO1xyXG4gIGVsc2Ugc291cmNlLm5hbWUgPSBuZXdLZXk7XHJcbiAgcmV0dXJuIHRydWU7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHN5bmNSZW5hbWUocGx1Z2luLCBvbGRLZXksIG5ld0tleSkge1xyXG4gIGlmICh0eXBlb2Ygb2xkS2V5ICE9PSBcInN0cmluZ1wiIHx8IHR5cGVvZiBuZXdLZXkgIT09IFwic3RyaW5nXCIpIHJldHVybjtcclxuICBuZXdLZXkgPSBuZXdLZXkudHJpbSgpO1xyXG4gIGlmIChvbGRLZXkgPT09IFwiXCIgfHwgbmV3S2V5ID09PSBcIlwiIHx8IG9sZEtleSA9PT0gbmV3S2V5KSByZXR1cm47XHJcbiAgLy8gVFlQL1NVQlRZUCBzaW5kIG5pZSBUZWlsIGVpbmVzIEZyb250bWF0dGVyLUJsb2NrcyAoc2llaGUgc3RyaXBUeXBQcm9wZXJ0eVxyXG4gIC8vIGluIHR5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKSAtIGVpbiBVbWJlbmVubmVuIHZvbi9uYWNoIFRZUC9TVUJUWVAgZGFoZXJcclxuICAvLyBpZ25vcmllcmVuLlxyXG4gIGlmIChbb2xkS2V5LCBuZXdLZXldLnNvbWUoKGtleSkgPT4gc2FtZUtleShrZXksIFRZUF9QUk9QRVJUWSkgfHwgc2FtZUtleShrZXksIFNVQlRZUF9QUk9QRVJUWSkpKSByZXR1cm47XHJcblxyXG4gIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHBsdWdpbjtcclxuICBsZXQgdHlwZUNvdW50ID0gMDtcclxuICBsZXQgc3VidHlwZUNvdW50ID0gMDtcclxuICBjb25zdCBjb3VudCA9IChzdG9yZSkgPT4gKHN0b3JlLnN1YnR5cGUgPyBzdWJ0eXBlQ291bnQrKyA6IHR5cGVDb3VudCsrKTtcclxuICBjb25zdCB0eXBlcyA9IG5ldyBTZXQoWy4uLk9iamVjdC5rZXlzKHNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXIpLCAuLi5PYmplY3Qua2V5cyhzZXR0aW5ncy50eXBlU3VidHlwZXMgPz8ge30pXSk7XHJcbiAgZm9yIChjb25zdCB0eXBlIG9mIHR5cGVzKSB7XHJcbiAgICBjb25zdCBzdG9yZXMgPSBbdHlwZVN0b3JlKHBsdWdpbiwgdHlwZSksIC4uLmdldFN1YnR5cGVOYW1lcyhzZXR0aW5ncywgdHlwZSkubWFwKChzdWJ0eXBlKSA9PiBzdWJ0eXBlU3RvcmUocGx1Z2luLCB0eXBlLCBzdWJ0eXBlKSldO1xyXG5cclxuICAgIC8vIEVpbmUgdmF1bHQtd2VpdGUgVW1iZW5lbm51bmcgc2NobFx1MDBFNGd0IGF1ZiBKRURFTiBCbG9jayBkdXJjaCwgaW4gZGVtIGRlclxyXG4gICAgLy8gS2V5IHN0ZWh0IC0gZGVyc2VsYmUgS2V5IGRhcmYgYmxvY2tcdTAwRkNiZXJncmVpZmVuZCBtZWhyZmFjaCB2b3Jrb21tZW5cclxuICAgIC8vIChzaWVoZSBLb21tZW50YXIgYW4gdHlwZVN1YnR5cGVzIGluIHN1YnR5cGVzLmpzKS4gTnVyIElOTkVSSEFMQiBlaW5lc1xyXG4gICAgLy8gQmxvY2tzIGthbm4gZGVyIG5ldWUgTmFtZSBrb2xsaWRpZXJlbjsgZG9ydCBsZWd0IHJlbmFtZUluU3RvcmUgZGllXHJcbiAgICAvLyBiZWlkZW4gd2llIGJpc2hlciB6dXNhbW1lbi5cclxuICAgIGZvciAoY29uc3Qgc3RvcmUgb2Ygc3RvcmVzKSB7XHJcbiAgICAgIGlmIChyZW5hbWVJblN0b3JlKHN0b3JlLCBvbGRLZXksIG5ld0tleSkpIGNvdW50KHN0b3JlKTtcclxuICAgIH1cclxuICB9XHJcbiAgY29uc3Qgb3JkZXJDaGFuZ2VkID0gcmVuYW1lSW5HbG9iYWxPcmRlcihzZXR0aW5ncywgb2xkS2V5LCBuZXdLZXkpO1xyXG4gIGlmICh0eXBlQ291bnQgPT09IDAgJiYgc3VidHlwZUNvdW50ID09PSAwICYmICFvcmRlckNoYW5nZWQpIHJldHVybjtcclxuXHJcbiAgYXdhaXQgcGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gIHBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuXHJcbiAgY29uc3QgcGFydHMgPSBbXTtcclxuICBpZiAodHlwZUNvdW50ID4gMCkgcGFydHMucHVzaChgJHt0eXBlQ291bnR9IFRZUCR7dHlwZUNvdW50ID09PSAxID8gXCJcIiA6IFwiZW5cIn1gKTtcclxuICBpZiAoc3VidHlwZUNvdW50ID4gMCkgcGFydHMucHVzaChgJHtzdWJ0eXBlQ291bnR9IFN1YnR5cCR7c3VidHlwZUNvdW50ID09PSAxID8gXCJcIiA6IFwiZW5cIn1gKTtcclxuICBpZiAob3JkZXJDaGFuZ2VkKSBwYXJ0cy5wdXNoKFwiZ2xvYmFsZXIgUmVpaGVuZm9sZ2VcIik7XHJcbiAgbmV3IE5vdGljZShgVFlQLVN5c3RlbTogXHUyMDFFJHtvbGRLZXl9XHUyMDFDIFx1MjE5MiBcdTIwMUUke25ld0tleX1cdTIwMUMgaW4gJHtwYXJ0cy5qb2luKFwiIHVuZCBcIil9IHVtYmVuYW5udC5gKTtcclxufVxyXG5cclxuLy8gT2JzaWRpYW5zIFwiQWxsIHByb3BlcnRpZXNcIi1BbnNpY2h0IChhY2NlcHRSZW5hbWUpIHVuZCBCYXNlcyAoTmFtZW5zZmVsZCBlaW5lclxyXG4vLyBuZXUgYW5nZWxlZ3RlbiBOb3Rpei1Qcm9wZXJ0eSkgYmVuZW5uZW4gUHJvcGVydGllcyB2YXVsdC13ZWl0IGF1c3NjaGxpZVx1MDBERmxpY2hcclxuLy8gXHUwMEZDYmVyIGFwcC5maWxlTWFuYWdlci5yZW5hbWVQcm9wZXJ0eShhbHQsIG5ldSkgdW0gKHNpZWhlIGdlYmF1dGVzIGFwcC5qcykgLVxyXG4vLyBlaW4gV3JhcHBlciBnZW5hdSBkb3J0IGVyZmFzc3QgYWxzbyBqZWRlIGVjaHRlIFVtYmVuZW5udW5nLCBvaG5lIGRpZVxyXG4vLyBqZXdlaWxpZ2VuIFZpZXdzIHNlbGJzdCBhbmZhc3NlbiB6dSBtXHUwMEZDc3Nlbi4gQmFzZXMnIFwiRGlzcGxheSBuYW1lXCIgZlx1MDBGQ3JcclxuLy8gYmVzdGVoZW5kZSBQcm9wZXJ0aWVzIFx1MDBFNG5kZXJ0IG51ciBkaWUgLmJhc2UtRGF0ZWksIG5pY2h0IGRpZSBOb3RpemVuLCB1bmRcclxuLy8gbFx1MDBFNHVmdCBkZXNoYWxiIChyaWNodGlnZXJ3ZWlzZSkgbmljaHQgaGllciBkdXJjaC5cclxuZnVuY3Rpb24gcmVnaXN0ZXJQcm9wZXJ0eVJlbmFtZVN5bmMocGx1Z2luKSB7XHJcbiAgY29uc3QgZmlsZU1hbmFnZXIgPSBwbHVnaW4uYXBwLmZpbGVNYW5hZ2VyO1xyXG4gIGlmIChmaWxlTWFuYWdlci5fX2ZyZWRUeXBSZW5hbWVTeW5jUGF0Y2hlZCkgcmV0dXJuO1xyXG4gIGZpbGVNYW5hZ2VyLl9fZnJlZFR5cFJlbmFtZVN5bmNQYXRjaGVkID0gdHJ1ZTtcclxuXHJcbiAgY29uc3Qgb3JpZ2luYWwgPSBmaWxlTWFuYWdlci5yZW5hbWVQcm9wZXJ0eTtcclxuICBmaWxlTWFuYWdlci5yZW5hbWVQcm9wZXJ0eSA9IGFzeW5jIGZ1bmN0aW9uIChvbGRLZXksIG5ld0tleSwgLi4ucmVzdCkge1xyXG4gICAgLy8gV2lyZnQgZGFzIE9yaWdpbmFsIChhY2NlcHRSZW5hbWUgZlx1MDBFNG5ndCBkYXMgc2VsYnN0IGFiKSwgYmxlaWJlbiBkaWVcclxuICAgIC8vIFBsdWdpbi1FaW5zdGVsbHVuZ2VuIHVudmVyXHUwMEU0bmRlcnQuXHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBvcmlnaW5hbC5jYWxsKHRoaXMsIG9sZEtleSwgbmV3S2V5LCAuLi5yZXN0KTtcclxuICAgIHRyeSB7XHJcbiAgICAgIGF3YWl0IHN5bmNSZW5hbWUocGx1Z2luLCBvbGRLZXksIG5ld0tleSk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKFwiVFlQLVN5c3RlbTogUHJvcGVydHktVW1iZW5lbm51bmcgbmljaHQgXHUwMEZDYmVybm9tbWVuXCIsIGVycm9yKTtcclxuICAgICAgbmV3IE5vdGljZShgVFlQLVN5c3RlbTogVW1iZW5lbm51bmcgdm9uIFx1MjAxRSR7b2xkS2V5fVx1MjAxQyBuaWNodCBcdTAwRkNiZXJub21tZW4gXHUyMDEzICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgIH1cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbiAgfTtcclxuXHJcbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IHtcclxuICAgIGZpbGVNYW5hZ2VyLnJlbmFtZVByb3BlcnR5ID0gb3JpZ2luYWw7XHJcbiAgICBkZWxldGUgZmlsZU1hbmFnZXIuX19mcmVkVHlwUmVuYW1lU3luY1BhdGNoZWQ7XHJcbiAgfSk7XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlclByb3BlcnR5UmVuYW1lU3luYyB9O1xyXG4iLCAiY29uc3QgeyBGdXp6eVN1Z2dlc3RNb2RhbCwgTm90aWNlLCBwcmVwYXJlRnV6enlTZWFyY2ggfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcclxuY29uc3QgeyBjb21wYXJlVHlwZXMsIERFRkFVTFRfU09SVF9PUkRFUiB9ID0gcmVxdWlyZShcIi4vdHlwLXZpZXdcIik7XHJcbmNvbnN0IHsgbmFtZUNvbG9yLCBwYWludENvbG9yRG90IH0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcclxuXHJcbi8vIE5hdGl2ZXIgRXJzYXR6IGZcdTAwRkNyIFRlbXBsYXRlcnMgdHAuc3lzdGVtLnN1Z2dlc3RlciBiZWkgZGVyIFRZUC1BdXN3YWhsIChzaWVoZVxyXG4vLyBfb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzKTogYmF1dCBhdWYgT2JzaWRpYW5zIGVpZ2VuZW1cclxuLy8gRnV6enlTdWdnZXN0TW9kYWwgYXVmIChkaWVzZWxiZSBCYXNpcywgYXVmIGRlciBhdWNoIFRlbXBsYXRlcnMgU3VnZ2VzdGVyXHJcbi8vIHNlbGJzdCBiZXJ1aHQpLCB6ZWlndCB6dXNcdTAwRTR0emxpY2ggYWJlciBUWVAtRmFyYmUvLVB1bmt0LCBCZXNjaHJlaWJ1bmcgdW5kXHJcbi8vIE5vdGl6LUFuemFobCBqZSBaZWlsZS4gTmljaHQgZXJmYXNzdGUgKGl0ZW0udW5yZWdpc3RlcmVkKSBUWVBlbiB3ZXJkZW4gc3RhdHRcclxuLy8gaW4gaWhyZXIgKG5pY2h0IGV4aXN0aWVyZW5kZW4pIEZhcmJlIG11dGVkIGRhcmdlc3RlbGx0LCBhbmFsb2cgenVyXHJcbi8vIFRZUC1MaXN0ZSBzZWxic3QgKHNpZWhlIC5mcmVkLXR5cC11bnJlZ2lzdGVyZWQgaW4gdHlwLXZpZXcuanMpLlxyXG5jbGFzcyBUeXBQaWNrZXJNb2RhbCBleHRlbmRzIEZ1enp5U3VnZ2VzdE1vZGFsIHtcclxuICBjb25zdHJ1Y3RvcihhcHAsIHBsdWdpbiwgaXRlbXMsIHJlc29sdmUpIHtcclxuICAgIHN1cGVyKGFwcCk7XHJcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcclxuICAgIHRoaXMuaXRlbXMgPSBpdGVtcztcclxuICAgIHRoaXMucmVzb2x2ZSA9IHJlc29sdmU7XHJcbiAgICB0aGlzLmNob3NlbiA9IGZhbHNlO1xyXG4gICAgdGhpcy5zZXRQbGFjZWhvbGRlcihcIkVTQyBmXHUwMEZDciBBYmJydWNoXCIpO1xyXG4gIH1cclxuXHJcbiAgZ2V0SXRlbXMoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5pdGVtcztcclxuICB9XHJcblxyXG4gIC8vIEZ1enp5LVN1Y2hlIGdyZWlmdCBhdWNoIGF1ZiBkaWUgQmVzY2hyZWlidW5nLCBuaWNodCBudXIgYXVmIGRlbiBUWVAtTmFtZW4gLVxyXG4gIC8vIHVuZCBhdWYgZGllIFN1YnR5cGVuLCB3byBzaWUgaW4gZGVyIFplaWxlIHN0ZWhlbiAoc2hvd1N1YnR5cGVzLCBzaWVoZVxyXG4gIC8vIHR5cGVJdGVtcyk6IHNpZSBzaW5kIGRhbm4gc2ljaHRiYXIsIGFsc28gZXJ3YXJ0ZXQgbWFuIGF1Y2gsIHNpZSB0aXBwZW4genVcclxuICAvLyBrXHUwMEY2bm5lbiwgdW5kIGltIHNlcGFyYXRlbiBBYmxhdWYgaXN0IGRlciBUWVAgZGFyXHUwMEZDYmVyIGRlciBXZWcgenUgaWhuZW4uXHJcbiAgZ2V0SXRlbVRleHQoaXRlbSkge1xyXG4gICAgcmV0dXJuIFtpdGVtLnR5cGUsIGl0ZW0uc3VidHlwZXM/LmpvaW4oXCIgXCIpLCBpdGVtLmRlc2NyaXB0aW9uXS5maWx0ZXIoQm9vbGVhbikuam9pbihcIiBcIik7XHJcbiAgfVxyXG5cclxuICByZW5kZXJTdWdnZXN0aW9uKG1hdGNoLCBlbCkge1xyXG4gICAgY29uc3QgaXRlbSA9IG1hdGNoLml0ZW07XHJcbiAgICBlbC5hZGRDbGFzcyhcImZyZWQtdHlwLXBpY2tlci1zdWdnZXN0aW9uXCIpO1xyXG4gICAgaWYgKGl0ZW0udW5yZWdpc3RlcmVkKSBlbC5hZGRDbGFzcyhcImZyZWQtdHlwLXBpY2tlci11bnJlZ2lzdGVyZWRcIik7XHJcblxyXG4gICAgaWYgKGl0ZW0udW5yZWdpc3RlcmVkKSB7XHJcbiAgICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtcGlja2VyLW5hbWVcIiwgdGV4dDogaXRlbS50eXBlIH0pO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgdGhpcy5yZW5kZXJDb2xvcmVkTmFtZShlbCwgaXRlbS50eXBlLCBpdGVtLnR5cGUpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChpdGVtLnN1YnR5cGVzPy5sZW5ndGgpIHRoaXMucmVuZGVyU3VidHlwZVByZXZpZXcoZWwsIGl0ZW0pO1xyXG5cclxuICAgIGlmIChpdGVtLmRlc2NyaXB0aW9uKSB7XHJcbiAgICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtcGlja2VyLWRlc2NcIiwgdGV4dDogaXRlbS5kZXNjcmlwdGlvbiB9KTtcclxuICAgIH1cclxuXHJcbiAgICBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLXBpY2tlci1jb3VudFwiLCB0ZXh0OiBTdHJpbmcoaXRlbS5jb3VudCkgfSk7XHJcbiAgfVxyXG5cclxuICAvLyBOYW1lIGluIGRlciBGYXJiZSB2b24gY29sb3JUeXBlIChiencuIGRlcyBTdWJ0eXBzLCBzaWVoZSBuYW1lQ29sb3IgaW5cclxuICAvLyB0eXBlLWNvbG9ycy5qcyAtIGRpZXNlbGJlIEdydW5kbGFnZSBudXR6dCBkaWUgU3VidHlwLVZvcnNjaGF1IGRlciBUWVAtTGlzdGUpXHJcbiAgLy8gLSBqZSBuYWNoIEVpbnN0ZWxsdW5nIFwiVFlQIFZpZXcgZWluZlx1MDBFNHJiZW5cIiBhbHMgZWluZ2VmXHUwMEU0cmJ0ZXIgVGV4dCBvZGVyIG1pdFxyXG4gIC8vIHZvcmFuZ2VzdGVsbHRlbSBGYXJicHVua3QuXHJcbiAgcmVuZGVyQ29sb3JlZE5hbWUoZWwsIHRleHQsIGNvbG9yVHlwZSwgc3VidHlwZSA9IG51bGwpIHtcclxuICAgIGNvbnN0IHsgY29sb3IsIGlzRGVmYXVsdCB9ID0gbmFtZUNvbG9yKHRoaXMucGx1Z2luLnNldHRpbmdzLCBjb2xvclR5cGUsIHN1YnR5cGUpO1xyXG4gICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdCkge1xyXG4gICAgICBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLXBpY2tlci1uYW1lXCIsIHRleHQgfSkuc3R5bGUuY29sb3IgPSBjb2xvcjtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHBhaW50Q29sb3JEb3QoZWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1waWNrZXItZG90XCIgfSksIGNvbG9yLCBpc0RlZmF1bHQpO1xyXG4gICAgICBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLXBpY2tlci1uYW1lXCIsIHRleHQgfSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvLyBcIlRZUCAoU3VidHlwIDEsIFN1YnR5cCAyKVwiIC0gd2VsY2hlIFN1YnR5cGVuIHVudGVyIGRlbSBUWVAgbGllZ2VuLCBzY2hvblxyXG4gIC8vIGluIGRlciBUWVAtQXVzd2FobCBkZXMgc2VwYXJhdGVuIEFibGF1ZnMgKHNpZWhlIHBpY2tUeXBlQW5kU3VidHlwZSksIHdvXHJcbiAgLy8gZGVyIFN1YnR5cC1QaWNrZXIgZXJzdCBkYW5hY2gga29tbXQuIEplZGVyIFN1YnR5cCBpbiBzZWluZXIgZWlnZW5lbiBGYXJiZSxcclxuICAvLyBLbGFtbWVybiB1bmQgS29tbWFzIG11dGVkOyBvaG5lIFwiVFlQIFZpZXcgZWluZlx1MDBFNHJiZW5cIiBibGVpYnQgZGllIFZvcnNjaGF1XHJcbiAgLy8gd2llIGRlciBOYW1lIHNlbGJzdCB1bmdlZlx1MDBFNHJidC5cclxuICByZW5kZXJTdWJ0eXBlUHJldmlldyhlbCwgaXRlbSkge1xyXG4gICAgY29uc3QgY29sb3JpemUgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3Q7XHJcbiAgICBjb25zdCB3cmFwID0gZWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1waWNrZXItc3VidHlwZXNcIiB9KTtcclxuICAgIHdyYXAuYXBwZW5kVGV4dChcIihcIik7XHJcbiAgICBpdGVtLnN1YnR5cGVzLmZvckVhY2goKHN1YnR5cGUsIGluZGV4KSA9PiB7XHJcbiAgICAgIGlmIChpbmRleCA+IDApIHdyYXAuYXBwZW5kVGV4dChcIiwgXCIpO1xyXG4gICAgICBjb25zdCBzcGFuID0gd3JhcC5jcmVhdGVTcGFuKHsgdGV4dDogc3VidHlwZSB9KTtcclxuICAgICAgaWYgKGNvbG9yaXplKSBzcGFuLnN0eWxlLmNvbG9yID0gbmFtZUNvbG9yKHRoaXMucGx1Z2luLnNldHRpbmdzLCBpdGVtLnR5cGUsIHN1YnR5cGUpLmNvbG9yO1xyXG4gICAgfSk7XHJcbiAgICB3cmFwLmFwcGVuZFRleHQoXCIpXCIpO1xyXG4gIH1cclxuXHJcbiAgLy8gT2JzaWRpYW5zIFN1Z2dlc3RNb2RhbC5zZWxlY3RTdWdnZXN0aW9uKCkgcnVmdCBpbnRlcm4gZXJzdCB0aGlzLmNsb3NlKClcclxuICAvLyBhdWYgdW5kIGRhbmFjaCBlcnN0IG9uQ2hvb3NlU3VnZ2VzdGlvbigpL29uQ2hvb3NlSXRlbSgpIC0gXCJjaG9zZW5cIiBoaWVyIHp1XHJcbiAgLy8gc2V0emVuIChzdGF0dCBpbiBvbkNob29zZUl0ZW0pIGlzdCBkYWhlciBuaWNodCBibG9cdTAwREYgR2VzY2htYWNrc3NhY2hlOiB3XHUwMEZDcmRlXHJcbiAgLy8gZXMgZXJzdCBpbiBvbkNob29zZUl0ZW0gZ2VzZXR6dCwgaFx1MDBFNHR0ZSBkYXMgY2xvc2UoKS1hdXNnZWxcdTAwRjZzdGUgb25DbG9zZSgpXHJcbiAgLy8gdW50ZW4gXCJjaG9zZW5cIiBub2NoIGFscyBmYWxzZSBnZXNlaGVuIHVuZCBkYXMgUHJvbWlzZSBmXHUwMEU0bHNjaGxpY2ggc2Nob24gbWl0XHJcbiAgLy8gbnVsbCBhdWZnZWxcdTAwRjZzdCwgYmV2b3IgZGVyIGVpZ2VudGxpY2hlIG9uQ2hvb3NlSXRlbS1BdWZydWYgXHUwMEZDYmVyaGF1cHQgbGllZiAtXHJcbiAgLy8gZGFzIHp3ZWl0ZSByZXNvbHZlKCkgZ3JlaWZ0IGRhbm4gbmljaHQgbWVociAoZWluIFByb21pc2UgbFx1MDBGNnN0IG51ciBlaW5tYWxcclxuICAvLyBhdWYpLCBkYXMgRXJnZWJuaXMgd2FyIHVuYWJoXHUwMEU0bmdpZyB2b24gZGVyIEF1c3dhaGwgaW1tZXIgbnVsbC5cclxuICBzZWxlY3RTdWdnZXN0aW9uKGl0ZW0sIGV2dCkge1xyXG4gICAgdGhpcy5jaG9zZW4gPSB0cnVlO1xyXG4gICAgLy8gV2FzIGJlaSBkZXIgQXVzd2FobCBpbSBTdWNoZmVsZCBzdGFuZCAtIGRlciBTdWJ0eXAtUGlja2VyIHNvcnRpZXJ0IGRhbmFjaFxyXG4gICAgLy8gdm9yIChzaWVoZSBwaWNrVHlwZUVudHJ5L3NvcnRCeVF1ZXJ5KS5cclxuICAgIHRoaXMucXVlcnkgPSB0aGlzLmlucHV0RWwudmFsdWUudHJpbSgpO1xyXG4gICAgc3VwZXIuc2VsZWN0U3VnZ2VzdGlvbihpdGVtLCBldnQpO1xyXG4gIH1cclxuXHJcbiAgb25DaG9vc2VJdGVtKGl0ZW0pIHtcclxuICAgIHRoaXMucmVzb2x2ZShpdGVtLnR5cGUpO1xyXG4gIH1cclxuXHJcbiAgLy8gRVNDIChvZGVyIEtsaWNrIGRhbmViZW4pIHNjaGxpZVx1MDBERnQgZGFzIE1vZGFsIG9obmUgc2VsZWN0U3VnZ2VzdGlvbiAtIGRhbm5cclxuICAvLyBzdGF0dCBlaW5lcyBoXHUwMEU0bmdlbmRlbiBQcm9taXNlIG1pdCBudWxsIGF1ZmxcdTAwRjZzZW4sIGFuYWxvZyB6dVxyXG4gIC8vIHRwLnN5c3RlbS5zdWdnZXN0ZXIuXHJcbiAgb25DbG9zZSgpIHtcclxuICAgIHN1cGVyLm9uQ2xvc2UoKTtcclxuICAgIGlmICghdGhpcy5jaG9zZW4pIHRoaXMucmVzb2x2ZShudWxsKTtcclxuICB9XHJcbn1cclxuXHJcbi8vIEF1c3dhaGwgZWluZXMgU3VidHlwcyBmXHUwMEZDciBlaW5lbiBiZXJlaXRzIGdld1x1MDBFNGhsdGVuIFRZUCAoc2llaGUgcGlja1N1YnR5cGUpLlxyXG4vLyBXaWUgVHlwUGlja2VyTW9kYWwsIHp1c1x1MDBFNHR6bGljaCBtaXQgZGVtIEVpbnRyYWcgXCJUWVAgKG9obmUgU3VidHlwKVwiIGFuXHJcbi8vIGVyc3RlciBTdGVsbGUgKGl0ZW0ubm9uZSkuIEVTQyBsXHUwMEY2c3QgbWl0IG51bGwgYXVmIC0gVFlQLmpzIGtlaHJ0IGRhbm4genVyXHJcbi8vIFRZUC1BdXN3YWhsIHp1clx1MDBGQ2NrLiBTdWJ0eXBlbiBoYWJlbiBrZWluZSBCZXNjaHJlaWJ1bmcsIGRlciBOYW1lIHN0ZWh0IGluXHJcbi8vIGRlciBGYXJiZSBkZXMgU3VidHlwcyAoYnp3LiBkZXMgVFlQcykgbWl0IE5vdGl6LUFuemFobC4gcXVlcnkgaXN0IGRpZVxyXG4vLyBTdWNoYW5mcmFnZSBhdXMgZGVtIFRZUC1QaWNrZXIsIG5hY2ggZGVyIGRpZSBMaXN0ZSB2b3Jzb3J0aWVydCBzdGVodC5cclxuY2xhc3MgU3VidHlwUGlja2VyTW9kYWwgZXh0ZW5kcyBUeXBQaWNrZXJNb2RhbCB7XHJcbiAgY29uc3RydWN0b3IoYXBwLCBwbHVnaW4sIHR5cGUsIGl0ZW1zLCByZXNvbHZlLCBxdWVyeSA9IFwiXCIpIHtcclxuICAgIHN1cGVyKGFwcCwgcGx1Z2luLCBpdGVtcywgcmVzb2x2ZSk7XHJcbiAgICB0aGlzLnR5cGUgPSB0eXBlO1xyXG4gICAgdGhpcy5zZXRQbGFjZWhvbGRlcihgU3VidHlwIGZcdTAwRkNyICR7dHlwZX0gXHUyMDEzIEVTQyBmXHUwMEZDciB6dXJcdTAwRkNja2ApO1xyXG4gICAgdGhpcy5pdGVtcyA9IHNvcnRCeVF1ZXJ5KGl0ZW1zLCBxdWVyeSwgKGl0ZW0pID0+IHRoaXMuZ2V0SXRlbVRleHQoaXRlbSkpO1xyXG4gIH1cclxuXHJcbiAgLy8gRGllIFwib2huZSBTdWJ0eXBcIi1aZWlsZSBpc3QgYXVjaCBcdTAwRkNiZXIgZGVuIFRZUC1OYW1lbiB6dSBmaW5kZW4sIGRlbiBzaWVcclxuICAvLyB6ZWlndCAtIGVpbiBpbSBUWVAtUGlja2VyIGdldGlwcHRlcyBcIk9SR0FcIiBob2x0IHNpZSBkYW1pdCB2b24gYWxsZWluXHJcbiAgLy8gd2llZGVyIGFuIGRlbiBBbmZhbmcsIG9id29obCBkb3J0IGRlciBUWVAgdW5kIG5pY2h0IGVpbiBTdWJ0eXAgZ2VtZWludCB3YXIuXHJcbiAgZ2V0SXRlbVRleHQoaXRlbSkge1xyXG4gICAgcmV0dXJuIGl0ZW0ubm9uZSA/IGAke3RoaXMudHlwZX0gJHtpdGVtLnR5cGV9YCA6IHN1cGVyLmdldEl0ZW1UZXh0KGl0ZW0pO1xyXG4gIH1cclxuXHJcbiAgcmVuZGVyU3VnZ2VzdGlvbihtYXRjaCwgZWwpIHtcclxuICAgIGNvbnN0IGl0ZW0gPSBtYXRjaC5pdGVtO1xyXG4gICAgZWwuYWRkQ2xhc3MoXCJmcmVkLXR5cC1waWNrZXItc3VnZ2VzdGlvblwiKTtcclxuICAgIGlmIChpdGVtLm5vbmUpIHtcclxuICAgICAgLy8gXCJPUkdBIChvaG5lIFN1YnR5cClcIjogZGVyIFRZUCBzZWxic3QgaW4gc2VpbmVyIEZhcmJlIChiencuIG1pdFxyXG4gICAgICAvLyBGYXJicHVua3QpLCBkZXIgWnVzYXR6IGluIG5vcm1hbGVyIFRleHRmYXJiZSBzdGF0dCBtdXRlZCAtIGRpZSBaZWlsZVxyXG4gICAgICAvLyBpc3QgZGllIFdhaGwgXCJkaWVzZXIgVFlQLCBvaG5lIFN1YnR5cFwiIHVuZCBrZWluZSBhdXNnZWdyYXV0ZVxyXG4gICAgICAvLyBOaWNodC1XYWhsLCB1bmQgZGVyIGhlbGxlIFp1c2F0eiBoZWJ0IHNpZSB6dWdsZWljaCB2b24gZGVuXHJcbiAgICAgIC8vIFN1YnR5cC1aZWlsZW4gZGFydW50ZXIgYWIsIGRpZSBudXIgYXVzIGlocmVtIE5hbWVuIGJlc3RlaGVuLlxyXG4gICAgICB0aGlzLnJlbmRlckNvbG9yZWROYW1lKGVsLCB0aGlzLnR5cGUsIHRoaXMudHlwZSk7XHJcbiAgICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtcGlja2VyLW5vbmVcIiwgdGV4dDogYCgke2l0ZW0udHlwZX0pYCB9KTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHRoaXMucmVuZGVyQ29sb3JlZE5hbWUoZWwsIGl0ZW0udHlwZSwgdGhpcy50eXBlLCBpdGVtLnR5cGUpO1xyXG4gICAgfVxyXG4gICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1waWNrZXItY291bnRcIiwgdGV4dDogU3RyaW5nKGl0ZW0uY291bnQpIH0pO1xyXG4gIH1cclxuXHJcbiAgb25DaG9vc2VJdGVtKGl0ZW0pIHtcclxuICAgIHRoaXMucmVzb2x2ZShpdGVtLm5vbmUgPyBcIlwiIDogaXRlbS50eXBlKTtcclxuICB9XHJcbn1cclxuXHJcbi8vIFRZUC1QaWNrZXIgbWl0IGRlbiBTdWJ0eXBlbiBkaXJla3QgZWluZ2VyXHUwMEZDY2t0IHVudGVyIGlocmVtIFRZUCAoU3RhbmRhcmQsXHJcbi8vIHNvbGFuZ2UgXCJTdWJ0eXAtUGlja2VyIHNlcGFyYXRcIiBpbiBkZW4gRWluc3RlbGx1bmdlbiBhdXMgaXN0LCBzaWVoZVxyXG4vLyBwaWNrVHlwZUFuZFN1YnR5cGUpLiBEaWUgVFlQLVplaWxlIHNlbGJzdCBzdGVodCBmXHUwMEZDciBcIlRZUCBvaG5lIFN1YnR5cFwiLlxyXG4vLyBHZXN1Y2h0IHdpcmQgZ3J1cHBlbndlaXNlIHN0YXR0IGplIFplaWxlLCBkYW1pdCBlaW4gU3VidHlwIG5pZSBvaG5lIHNlaW5lblxyXG4vLyBUWVAgZGFyXHUwMEZDYmVyIGVyc2NoZWludDogcGFzc3QgZGllIFN1Y2hlIGF1ZiBkZW4gVFlQLCBibGVpYmVuIGFsbGUgc2VpbmVcclxuLy8gU3VidHlwZW4gc3RlaGVuOyBwYXNzdCBzaWUgbnVyIGF1ZiBlaW56ZWxuZSBTdWJ0eXBlbiwgYmxlaWJlbiBkaWVzZSBzYW10XHJcbi8vIGlocmVtIFRZUCBzdGVoZW4uIERpZSBHcnVwcGVuIHNvcnRpZXJlbiBzaWNoIG5hY2ggaWhyZW0gYmVzdGVuIFRyZWZmZXIsXHJcbi8vIGlubmVyaGFsYiBlaW5lciBHcnVwcGUgYmxlaWJ0IGRpZSBCbG9jay1SZWloZW5mb2xnZS5cclxuY2xhc3MgVHlwU3VidHlwUGlja2VyTW9kYWwgZXh0ZW5kcyBUeXBQaWNrZXJNb2RhbCB7XHJcbiAgY29uc3RydWN0b3IoYXBwLCBwbHVnaW4sIGdyb3VwcywgcmVzb2x2ZSkge1xyXG4gICAgc3VwZXIoYXBwLCBwbHVnaW4sIGdyb3Vwcy5tYXAoKGdyb3VwKSA9PiBncm91cC5pdGVtKSwgcmVzb2x2ZSk7XHJcbiAgICB0aGlzLmdyb3VwcyA9IGdyb3VwcztcclxuICB9XHJcblxyXG4gIGdldFN1Z2dlc3Rpb25zKHF1ZXJ5KSB7XHJcbiAgICBjb25zdCBzZWFyY2ggPSBxdWVyeS50cmltKCkgPyBwcmVwYXJlRnV6enlTZWFyY2gocXVlcnkudHJpbSgpKSA6IG51bGw7XHJcbiAgICBjb25zdCBub01hdGNoID0geyBzY29yZTogMCwgbWF0Y2hlczogW10gfTtcclxuICAgIGNvbnN0IHJlc3VsdHMgPSBbXTtcclxuICAgIGZvciAoY29uc3QgeyBpdGVtLCBzdWJ0eXBlcyB9IG9mIHRoaXMuZ3JvdXBzKSB7XHJcbiAgICAgIGNvbnN0IHR5cGVNYXRjaCA9IHNlYXJjaCA/IHNlYXJjaCh0aGlzLmdldEl0ZW1UZXh0KGl0ZW0pKSA6IG5vTWF0Y2g7XHJcbiAgICAgIGxldCBzdWJ0eXBlTWF0Y2hlcyA9IHN1YnR5cGVzLm1hcCgoc3VidHlwZSkgPT4gKHsgaXRlbTogc3VidHlwZSwgbWF0Y2g6IHNlYXJjaCA/IHNlYXJjaChzdWJ0eXBlLnN1YnR5cGUpIDogbm9NYXRjaCB9KSk7XHJcbiAgICAgIGlmICghdHlwZU1hdGNoKSBzdWJ0eXBlTWF0Y2hlcyA9IHN1YnR5cGVNYXRjaGVzLmZpbHRlcigoZW50cnkpID0+IGVudHJ5Lm1hdGNoKTtcclxuICAgICAgaWYgKCF0eXBlTWF0Y2ggJiYgc3VidHlwZU1hdGNoZXMubGVuZ3RoID09PSAwKSBjb250aW51ZTtcclxuXHJcbiAgICAgIGNvbnN0IHNjb3JlcyA9IFt0eXBlTWF0Y2gsIC4uLnN1YnR5cGVNYXRjaGVzLm1hcCgoZW50cnkpID0+IGVudHJ5Lm1hdGNoKV0uZmlsdGVyKEJvb2xlYW4pLm1hcCgobWF0Y2gpID0+IG1hdGNoLnNjb3JlKTtcclxuICAgICAgcmVzdWx0cy5wdXNoKHtcclxuICAgICAgICBzY29yZTogTWF0aC5tYXgoLi4uc2NvcmVzKSxcclxuICAgICAgICByb3dzOiBbeyBpdGVtLCBtYXRjaDogdHlwZU1hdGNoID8/IG5vTWF0Y2ggfSwgLi4uc3VidHlwZU1hdGNoZXMubWFwKChlbnRyeSkgPT4gKHsgaXRlbTogZW50cnkuaXRlbSwgbWF0Y2g6IGVudHJ5Lm1hdGNoID8/IG5vTWF0Y2ggfSkpXSxcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICBpZiAoc2VhcmNoKSByZXN1bHRzLnNvcnQoKGEsIGIpID0+IGIuc2NvcmUgLSBhLnNjb3JlKTtcclxuICAgIHJldHVybiByZXN1bHRzLmZsYXRNYXAoKGdyb3VwKSA9PiBncm91cC5yb3dzKTtcclxuICB9XHJcblxyXG4gIHJlbmRlclN1Z2dlc3Rpb24obWF0Y2gsIGVsKSB7XHJcbiAgICBjb25zdCBpdGVtID0gbWF0Y2guaXRlbTtcclxuICAgIGlmICghaXRlbS5zdWJ0eXBlKSB7XHJcbiAgICAgIHN1cGVyLnJlbmRlclN1Z2dlc3Rpb24obWF0Y2gsIGVsKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgZWwuYWRkQ2xhc3MoXCJmcmVkLXR5cC1waWNrZXItc3VnZ2VzdGlvblwiLCBcImZyZWQtdHlwLXBpY2tlci1zdWJ0eXBlXCIpO1xyXG4gICAgdGhpcy5yZW5kZXJDb2xvcmVkTmFtZShlbCwgaXRlbS5zdWJ0eXBlLCBpdGVtLnR5cGUsIGl0ZW0uc3VidHlwZSk7XHJcbiAgICBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLXBpY2tlci1jb3VudFwiLCB0ZXh0OiBTdHJpbmcoaXRlbS5jb3VudCkgfSk7XHJcbiAgfVxyXG5cclxuICBvbkNob29zZUl0ZW0oaXRlbSkge1xyXG4gICAgdGhpcy5yZXNvbHZlKHsgdHlwZTogaXRlbS50eXBlLCBzdWJ0eXBlOiBpdGVtLnN1YnR5cGUgPz8gbnVsbCB9KTtcclxuICB9XHJcbn1cclxuXHJcbi8vIEF1c2dhbmdzLVJlaWhlbmZvbGdlIGVpbmVyIFBpY2tlci1MaXN0ZSBuYWNoIGVpbmVyIHNjaG9uIGdldGlwcHRlbiBTdWNoYW5mcmFnZVxyXG4vLyAoZGVyIGF1cyBkZW0gVFlQLVBpY2tlciwgc2llaGUgcGlja1R5cGVFbnRyeSk6IHdvcmF1ZiBzaWUgcGFzc3QsIHN0ZWh0IG9iZW4sXHJcbi8vIG5hY2ggVHJlZmZlcmdcdTAwRkN0ZSwgYWxsZXMgYW5kZXJlIGRhaGludGVyIGluIHVudmVyXHUwMEU0bmRlcnRlciBSZWloZW5mb2xnZS4gXCJQYXNzdFxyXG4vLyBhdWYgbmljaHRzXCIgbFx1MDBFNHNzdCBkaWUgTGlzdGUsIHdpZSBzaWUgd2FyIC0gZ2V0aXBwdCB3YXIgZGFubiB6LiBCLiBlaW5lXHJcbi8vIEJlc2NocmVpYnVuZywgXHUwMEZDYmVyIGRpZSBoaWVyIG5pY2h0cyB6dSBzY2hsaWVcdTAwREZlbiBpc3QuIERhbmFjaCBncmVpZnQgd2llZGVyXHJcbi8vIE9ic2lkaWFucyBlaWdlbmUgU3VjaGUsIHNvYmFsZCBpbSBQaWNrZXIgc2VsYnN0IGdldGlwcHQgd2lyZC5cclxuZnVuY3Rpb24gc29ydEJ5UXVlcnkoaXRlbXMsIHF1ZXJ5LCBpdGVtVGV4dCkge1xyXG4gIGNvbnN0IHNlYXJjaCA9IHF1ZXJ5Py50cmltKCkgPyBwcmVwYXJlRnV6enlTZWFyY2gocXVlcnkudHJpbSgpKSA6IG51bGw7XHJcbiAgaWYgKCFzZWFyY2gpIHJldHVybiBpdGVtcztcclxuICBjb25zdCBzY29yZWQgPSBpdGVtcy5tYXAoKGl0ZW0sIGluZGV4KSA9PiAoeyBpdGVtLCBpbmRleCwgc2NvcmU6IHNlYXJjaChpdGVtVGV4dChpdGVtKSk/LnNjb3JlID8/IG51bGwgfSkpO1xyXG4gIGlmIChzY29yZWQuZXZlcnkoKGVudHJ5KSA9PiBlbnRyeS5zY29yZSA9PT0gbnVsbCkpIHJldHVybiBpdGVtcztcclxuICBzY29yZWQuc29ydCgoYSwgYikgPT4ge1xyXG4gICAgaWYgKGEuc2NvcmUgPT09IG51bGwgfHwgYi5zY29yZSA9PT0gbnVsbCkgcmV0dXJuIGEuc2NvcmUgPT09IGIuc2NvcmUgPyBhLmluZGV4IC0gYi5pbmRleCA6IGEuc2NvcmUgPT09IG51bGwgPyAxIDogLTE7XHJcbiAgICByZXR1cm4gYi5zY29yZSAtIGEuc2NvcmUgfHwgYS5pbmRleCAtIGIuaW5kZXg7XHJcbiAgfSk7XHJcbiAgcmV0dXJuIHNjb3JlZC5tYXAoKGVudHJ5KSA9PiBlbnRyeS5pdGVtKTtcclxufVxyXG5cclxuLy8gRlx1MDBGQ3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qczogXHUwMEY2ZmZuZXQgZGVuIFN1YnR5cC1QaWNrZXIsIHNvYmFsZFxyXG4vLyBkZXIgVFlQIG1pbmRlc3RlbnMgZWluZW4gcmVnaXN0cmllcnRlbiBTdWJ0eXAgaGF0IChpbiBkZXIgUmVpaGVuZm9sZ2UgZGVyXHJcbi8vIEJsXHUwMEY2Y2tlIGluIGRlciBUWVAtRGV0YWlsYW5zaWNodCkuIHF1ZXJ5IGlzdCBkaWUgU3VjaGFuZnJhZ2UgYXVzIGRlbVxyXG4vLyBUWVAtUGlja2VyLCBuYWNoIGRlciBkaWUgTGlzdGUgdm9yc29ydGllcnQgd2lyZCAoc2llaGUgc29ydEJ5UXVlcnkpOiB3ZXJcclxuLy8gZG9ydCBcIkxlaHJ2ZXJhbnN0YWx0dW5nXCIgdGlwcHRlIHVuZCBzbyB6dSBPUkdBIGthbSwgbWVpbnRlIGRpZXNlbiBTdWJ0eXAgdW5kXHJcbi8vIGZpbmRldCBpaG4gaGllciBvYmVuIC0gRW50ZXIgZ2VuXHUwMEZDZ3QuIExcdTAwRjZzdCBhdWYgbWl0XHJcbi8vICAtIGRlbSBnZXdcdTAwRTRobHRlbiBTdWJ0eXAsXHJcbi8vICAtIFwiXCIgZlx1MDBGQ3IgXCJvaG5lIFN1YnR5cFwiIChvaG5lIEFuZnJhZ2UgZGVyIGVyc3RlIEVpbnRyYWcgZGVyIExpc3RlKSAtIGJ6dy5cclxuLy8gICAgc29mb3J0LCBvaG5lIFBpY2tlciwgd2VubiBkZXIgVFlQIGdhciBrZWluZSBTdWJ0eXBlbiBoYXQsXHJcbi8vICAtIG51bGwgYmVpIEVTQyAoVFlQLmpzIGtlaHJ0IGRhbm4genVyIFRZUC1BdXN3YWhsIHp1clx1MDBGQ2NrKS5cclxuZnVuY3Rpb24gcGlja1N1YnR5cGUoYXBwLCBwbHVnaW4sIHR5cGUsIHF1ZXJ5ID0gXCJcIikge1xyXG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xyXG4gICAgY29uc3QgaXRlbXMgPSBwbHVnaW4uZ2V0U3VidHlwZXModHlwZSkubWFwKCh7IHN1YnR5cGUsIGNvdW50IH0pID0+ICh7IHR5cGU6IHN1YnR5cGUsIGRlc2NyaXB0aW9uOiBcIlwiLCBjb3VudCB9KSk7XHJcbiAgICBpZiAoaXRlbXMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgIHJlc29sdmUoXCJcIik7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIC8vIFwib2huZSBTdWJ0eXBcIiBhbiBlcnN0ZXIgU3RlbGxlOiBkaWUgQXVzd2FobCBpc3Qgb2huZSBUaXBwZW4gbWl0IEVudGVyXHJcbiAgICAvLyBlcmxlZGlndCwgdW5kIGRlciBGYWxsIGlzdCBoXHUwMEU0dWZpZ2VyIGFscyBqZWRlciBlaW56ZWxuZSBTdWJ0eXAuXHJcbiAgICBjb25zdCBub25lQ291bnQgPSBwbHVnaW4udHlwSW5kZXguc3VidHlwZUJ1Y2tldCh0eXBlKS5ub1N1YnR5cGU7XHJcbiAgICBpdGVtcy51bnNoaWZ0KHsgdHlwZTogXCJvaG5lIFN1YnR5cFwiLCBkZXNjcmlwdGlvbjogXCJcIiwgY291bnQ6IG5vbmVDb3VudCwgbm9uZTogdHJ1ZSB9KTtcclxuICAgIG5ldyBTdWJ0eXBQaWNrZXJNb2RhbChhcHAsIHBsdWdpbiwgdHlwZSwgaXRlbXMsIHJlc29sdmUsIHF1ZXJ5KS5vcGVuKCk7XHJcbiAgfSk7XHJcbn1cclxuXHJcbi8vIE5pY2h0IGluIHBsdWdpbi5zZXR0aW5ncy50eXBlcyByZWdpc3RyaWVydGUgVFlQZW4sIGRpZSBhYmVyIHRhdHNcdTAwRTRjaGxpY2ggaW5cclxuLy8gTm90aXplbiB2b3Jrb21tZW4gLSBhbmFsb2cgenUgZGVuIFwidW5yZWdpc3RyaWVydGVuXCIgWmVpbGVuIGRlciBUWVAtTGlzdGVcclxuLy8gKHNpZWhlIHVucmVnaXN0ZXJlZFJvd3MgaW4gdHlwLXZpZXcuanMpLiBLZWluZSBCZXNjaHJlaWJ1bmcvRmFyYmUsIGRhIGZcdTAwRkNyXHJcbi8vIHNpZSBuaWNodHMgZGVyZ2xlaWNoZW4gZ2VwZmxlZ3QgaXN0LiBMaXN0ZW4gdW5kIFdlcnRlIG1pdCBSYW5kbGVlcnplaWNoZW5cclxuLy8gKHNpZWhlIGlzQ2xlYW5LZXkgaW4gdHlwLWluZGV4LmpzKSBibGVpYmVuIGF1XHUwMERGZW4gdm9yIC0gZGVyIGdld1x1MDBFNGhsdGUgV2VydFxyXG4vLyB3aXJkIGluIGVpbmUgbmV1ZSBOb3RpeiBnZXNjaHJpZWJlbiB1bmQgc29sbCBkb3J0IGtlaW4gQXVmclx1MDBFNHVtZmFsbCBzZWluLlxyXG5mdW5jdGlvbiB1bnJlZ2lzdGVyZWRJdGVtcyhhcHAsIHBsdWdpbikge1xyXG4gIGNvbnN0IHJlZ2lzdGVyZWQgPSBuZXcgU2V0KHBsdWdpbi5zZXR0aW5ncy50eXBlcyk7XHJcbiAgY29uc3QgeyBjb3VudHMgfSA9IHBsdWdpbi50eXBJbmRleC50eXBlQ291bnRzKCk7XHJcbiAgY29uc3Qgc29ydE9yZGVyID0gcGx1Z2luLnNldHRpbmdzLnR5cFNvcnRPcmRlciA/PyBERUZBVUxUX1NPUlRfT1JERVI7XHJcbiAgcmV0dXJuIFsuLi5jb3VudHMua2V5cygpXVxyXG4gICAgLmZpbHRlcigodHlwZSkgPT4gIXJlZ2lzdGVyZWQuaGFzKHR5cGUpICYmIHBsdWdpbi50eXBJbmRleC5pc0NsZWFuS2V5KHR5cGUpKVxyXG4gICAgLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVUeXBlcyhzb3J0T3JkZXIsIGEsIGIsIGNvdW50cywgcGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnMpKVxyXG4gICAgLm1hcCgodHlwZSkgPT4gKHsgdHlwZSwgZGVzY3JpcHRpb246IFwiXCIsIGNvdW50OiBjb3VudHMuZ2V0KHR5cGUpID8/IDAsIHVucmVnaXN0ZXJlZDogdHJ1ZSB9KSk7XHJcbn1cclxuXHJcbi8vIEZcdTAwRkNyIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanMgc293aWUgXHUwMEZDYmVyYWxsIHNvbnN0IGltIFBsdWdpbiwgd29cclxuLy8gZWluIGVpbnplbG5lciBUWVAgYXVzZ2V3XHUwMEU0aGx0IHdlcmRlbiBtdXNzLiBpbmNsdWRlTWFudWFsT2ZmIHdpZSBiZWlcclxuLy8gcGx1Z2luLmdldFR5cGVzKCk6IFRZUGVuIG1pdCBkZWFrdGl2aWVydGVtIFwiTWFudWVsbGVyIFRZUFwiLVNjaGFsdGVyIHNpbmRcclxuLy8gc3RhbmRhcmRtXHUwMEU0XHUwMERGaWcgYXVzZ2VrbGFtbWVydC4gaW5jbHVkZVVucmVnaXN0ZXJlZCBlcmdcdTAwRTRuenQgenVzXHUwMEU0dHpsaWNoIFRZUGVuLFxyXG4vLyBkaWUgaW4gTm90aXplbiB2b3Jrb21tZW4sIGFiZXIgbmljaHQgaW4gZGVyIFRZUC1MaXN0ZSByZWdpc3RyaWVydCBzaW5kIC1cclxuLy8gbXV0ZWQgZGFyZ2VzdGVsbHQsIGRhIGZcdTAwRkNyIHNpZSBrZWluZSBGYXJiZS9CZXNjaHJlaWJ1bmcgZXhpc3RpZXJ0LiBMXHUwMEY2c3QgbWl0XHJcbi8vIGRlbSBnZXdcdTAwRTRobHRlbiBUWVAgYXVmLCBvZGVyIG1pdCBudWxsIGJlaSBBYmJydWNoIGJ6dy4gZmFsbHMgZXMgKGF1Y2ggbWl0XHJcbi8vIGRlbiBnZXdcdTAwRTRobHRlbiBPcHRpb25lbikga2VpbmUgYW56dXplaWdlbmRlbiBUWVBlbiBnaWJ0LiBzaG93U3VidHlwZXMgc3RlbGx0XHJcbi8vIGRpZSBTdWJ0eXBlbiBkZXMgVFlQcyBoaW50ZXIgZGVzc2VuIE5hbWVuIChzaWVoZSByZW5kZXJTdWJ0eXBlUHJldmlldykgLVxyXG4vLyBnZWRhY2h0IGZcdTAwRkNyIGRpZSBUWVAtQXVzd2FobCBkZXMgc2VwYXJhdGVuIEFibGF1ZnMsIHdvIGRlciBTdWJ0eXAtUGlja2VyXHJcbi8vIGVyc3QgZGFuYWNoIGtvbW10LlxyXG5mdW5jdGlvbiBwaWNrVHlwZShhcHAsIHBsdWdpbiwgb3B0aW9ucyA9IHt9KSB7XHJcbiAgcmV0dXJuIHBpY2tUeXBlRW50cnkoYXBwLCBwbHVnaW4sIG9wdGlvbnMpLnRoZW4oKGVudHJ5KSA9PiBlbnRyeT8udHlwZSA/PyBudWxsKTtcclxufVxyXG5cclxuLy8gV2llIHBpY2tUeXBlLCBsXHUwMEY2c3QgYWJlciBtaXQgeyB0eXBlLCBxdWVyeSB9IGF1ZiAtIHF1ZXJ5IGlzdCwgd2FzIGJlaSBkZXJcclxuLy8gQXVzd2FobCBpbSBTdWNoZmVsZCBzdGFuZC4gTnVyIGZcdTAwRkNyIHBpY2tUeXBlQW5kU3VidHlwZTogZG9ydCB0clx1MDBFNGd0IGRpZVxyXG4vLyBBbmZyYWdlIGluIGRlbiBTdWJ0eXAtUGlja2VyIHdlaXRlciAoc2llaGUgc29ydEJ5UXVlcnkpLCBkZW5uIHdlclxyXG4vLyBcIkxlaHJ2ZXJhbnN0YWx0dW5nXCIgdGlwcHQsIGxhbmRldCBcdTAwRkNiZXIgZGllIFN1YnR5cC1Wb3JzY2hhdSBiZWkgT1JHQSB1bmRcclxuLy8gbWVpbnQgZGFtaXQgZGVuIFN1YnR5cCwgbmljaHQgYmxvXHUwMERGIGRlbiBUWVAuXHJcbmZ1bmN0aW9uIHBpY2tUeXBlRW50cnkoYXBwLCBwbHVnaW4sIG9wdGlvbnMgPSB7fSkge1xyXG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xyXG4gICAgY29uc3QgaXRlbXMgPSB0eXBlSXRlbXMoYXBwLCBwbHVnaW4sIG9wdGlvbnMpO1xyXG4gICAgaWYgKCFpdGVtcykge1xyXG4gICAgICByZXNvbHZlKG51bGwpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBjb25zdCBtb2RhbCA9IG5ldyBUeXBQaWNrZXJNb2RhbChhcHAsIHBsdWdpbiwgaXRlbXMsICh0eXBlKSA9PiByZXNvbHZlKHR5cGUgPT09IG51bGwgPyBudWxsIDogeyB0eXBlLCBxdWVyeTogbW9kYWwucXVlcnkgfSkpO1xyXG4gICAgbW9kYWwub3BlbigpO1xyXG4gIH0pO1xyXG59XHJcblxyXG4vLyBHZW1laW5zYW1lIFRZUC1MaXN0ZSBmXHUwMEZDciBwaWNrVHlwZS9waWNrVHlwZUFuZFN1YnR5cGUgLSBudWxsIHNhbXQgTm90aWNlLFxyXG4vLyBmYWxscyBlcyAoYXVjaCBtaXQgZGVuIGdld1x1MDBFNGhsdGVuIE9wdGlvbmVuKSBrZWluZSBUWVBlbiBnaWJ0LlxyXG5mdW5jdGlvbiB0eXBlSXRlbXMoYXBwLCBwbHVnaW4sIHsgaW5jbHVkZU1hbnVhbE9mZiA9IGZhbHNlLCBpbmNsdWRlVW5yZWdpc3RlcmVkID0gZmFsc2UsIHNob3dTdWJ0eXBlcyA9IGZhbHNlIH0gPSB7fSkge1xyXG4gIGNvbnN0IGl0ZW1zID0gcGx1Z2luLmdldFR5cGVzKHsgaW5jbHVkZU1hbnVhbE9mZiB9KS5tYXAoKGl0ZW0pID0+ICh7IC4uLml0ZW0sIHVucmVnaXN0ZXJlZDogZmFsc2UgfSkpO1xyXG4gIGlmIChpbmNsdWRlVW5yZWdpc3RlcmVkKSBpdGVtcy5wdXNoKC4uLnVucmVnaXN0ZXJlZEl0ZW1zKGFwcCwgcGx1Z2luKSk7XHJcbiAgLy8gTnVyIHJlZ2lzdHJpZXJ0ZSBUWVBlbiBoYWJlbiBnZXBmbGVndGUgU3VidHlwZW4gLSBmXHUwMEZDciBkaWUgXHUwMEZDYnJpZ2VuIGJsZWlidFxyXG4gIC8vIGRpZSBMaXN0ZSBsZWVyIHVuZCBkaWUgWmVpbGUgZGFtaXQgdW52ZXJcdTAwRTRuZGVydC5cclxuICBpZiAoc2hvd1N1YnR5cGVzKSB7XHJcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMpIGl0ZW0uc3VidHlwZXMgPSBwbHVnaW4uZ2V0U3VidHlwZXMoaXRlbS50eXBlKS5tYXAoKHsgc3VidHlwZSB9KSA9PiBzdWJ0eXBlKTtcclxuICB9XHJcbiAgaWYgKGl0ZW1zLmxlbmd0aCA+IDApIHJldHVybiBpdGVtcztcclxuICBuZXcgTm90aWNlKFwiS2VpbmUgVFlQZW4gdm9yaGFuZGVuLlwiKTtcclxuICByZXR1cm4gbnVsbDtcclxufVxyXG5cclxuLy8gRlx1MDBGQ3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qczogVFlQIHVuZCBTdWJ0eXAgaW4gZWluZW0gWnVnLiBKZVxyXG4vLyBuYWNoIEVpbnN0ZWxsdW5nIHNlcGFyYXRlU3VidHlwZVBpY2tlciBlbnR3ZWRlciBlaW4gZWluemlnZXIgUGlja2VyIG1pdCBkZW5cclxuLy8gU3VidHlwZW4gZWluZ2VyXHUwMEZDY2t0IHVudGVyIGlocmVtIFRZUCAoU3RhbmRhcmQpLCBvZGVyIHdpZSBmclx1MDBGQ2hlciBlcnN0IGRlclxyXG4vLyBUWVAtUGlja2VyIC0gZG9ydCBtaXQgZGVuIFN1YnR5cGVuIGRlcyBUWVBzIGhpbnRlciBkZXNzZW4gTmFtZW4sIGRhbWl0IG1hblxyXG4vLyBzaWUgc2Nob24gdm9yIGRlciBXYWhsIHNpZWh0IC0gdW5kIGRhbmFjaCwgZmFsbHMgZGVyIFRZUCBTdWJ0eXBlbiBoYXQsIGRlclxyXG4vLyBTdWJ0eXAtUGlja2VyLCB2b3Jzb3J0aWVydCBuYWNoIGRlciBTdWNoYW5mcmFnZSB2b24gZG9ydCAoRVNDIGZcdTAwRkNocnQgenVyXHUwMEZDY2tcclxuLy8genVyIFRZUC1BdXN3YWhsKS4gT3B0aW9uZW4gd2llIGJlaSBwaWNrVHlwZS4gTFx1MDBGNnN0IGF1ZiBtaXRcclxuLy8geyB0eXBlLCBzdWJ0eXBlIH0gKHN1YnR5cGUgbnVsbCBmXHUwMEZDciBcIm9obmUgU3VidHlwXCIpLCBvZGVyIG1pdCBudWxsIGJlaVxyXG4vLyBBYmJydWNoLlxyXG5hc3luYyBmdW5jdGlvbiBwaWNrVHlwZUFuZFN1YnR5cGUoYXBwLCBwbHVnaW4sIG9wdGlvbnMgPSB7fSkge1xyXG4gIGlmIChwbHVnaW4uc2V0dGluZ3Muc2VwYXJhdGVTdWJ0eXBlUGlja2VyKSB7XHJcbiAgICB3aGlsZSAodHJ1ZSkge1xyXG4gICAgICBjb25zdCBlbnRyeSA9IGF3YWl0IHBpY2tUeXBlRW50cnkoYXBwLCBwbHVnaW4sIHsgLi4ub3B0aW9ucywgc2hvd1N1YnR5cGVzOiB0cnVlIH0pO1xyXG4gICAgICBpZiAoIWVudHJ5KSByZXR1cm4gbnVsbDtcclxuICAgICAgY29uc3Qgc3VidHlwZSA9IGF3YWl0IHBpY2tTdWJ0eXBlKGFwcCwgcGx1Z2luLCBlbnRyeS50eXBlLCBlbnRyeS5xdWVyeSk7XHJcbiAgICAgIGlmIChzdWJ0eXBlICE9PSBudWxsKSByZXR1cm4geyB0eXBlOiBlbnRyeS50eXBlLCBzdWJ0eXBlOiBzdWJ0eXBlIHx8IG51bGwgfTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGNvbnN0IGl0ZW1zID0gdHlwZUl0ZW1zKGFwcCwgcGx1Z2luLCBvcHRpb25zKTtcclxuICBpZiAoIWl0ZW1zKSByZXR1cm4gbnVsbDtcclxuICBjb25zdCBncm91cHMgPSBpdGVtcy5tYXAoKGl0ZW0pID0+ICh7XHJcbiAgICBpdGVtLFxyXG4gICAgc3VidHlwZXM6IHBsdWdpbi5nZXRTdWJ0eXBlcyhpdGVtLnR5cGUpLm1hcCgoeyBzdWJ0eXBlLCBjb3VudCB9KSA9PiAoeyB0eXBlOiBpdGVtLnR5cGUsIHN1YnR5cGUsIGNvdW50IH0pKSxcclxuICB9KSk7XHJcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBuZXcgVHlwU3VidHlwUGlja2VyTW9kYWwoYXBwLCBwbHVnaW4sIGdyb3VwcywgcmVzb2x2ZSkub3BlbigpKTtcclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSB7IHBpY2tUeXBlLCBwaWNrU3VidHlwZSwgcGlja1R5cGVBbmRTdWJ0eXBlIH07XHJcbiIsICJjb25zdCB7IFRGaWxlLCBWYXVsdCwgZGVib3VuY2UsIG5vcm1hbGl6ZVBhdGggfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcblxuLy8gTnVyIFRlbXBsYXRlci1Ta3JpcHRlIG1pdCBkaWVzZW0gTWFya2VyIGluIGVpbmVtIEtvbW1lbnRhciB3ZXJkZW4gaW1cbi8vIFNob3J0Y3V0LU1vZGFsIChzaG9ydGN1dC1waWNrZXIuanMpIGFuZ2Vib3RlbiAtIHJlaW5lIEhpbGZzc2tyaXB0ZSAoei4gQi5cbi8vIHRvTGlzdElmTXVsdGlwbGUsIFRZUCBzZWxic3QpIGVyZ2ViZW4gYWxzIFNob3J0Y3V0IGtlaW5lbiBTaW5uLiBEZXIgVGV4dFxuLy8gaGludGVyIGRlbSBNYXJrZXIgYmlzIHp1bSBaZWlsZW5lbmRlIGRpZW50IGFscyBCZXNjaHJlaWJ1bmcgaW4gZGVyIExpc3RlO1xuLy8gZmVobHQgZXIsIHN0ZWh0IGRvcnQgbnVyIGRlciBTa3JpcHRuYW1lLiBFaW4gYWJzY2hsaWVcdTAwREZlbmRlcyBcIiovXCIgZWluZXNcbi8vIEJsb2Nra29tbWVudGFycyBnZWhcdTAwRjZydCBuaWNodCB6dXIgQmVzY2hyZWlidW5nLlxuLy9cbi8vIE9wdGlvbmFsIGZvbGd0IGRpcmVrdCBhdWYgZGVuIE1hcmtlciBlaW5lIFBhcmFtZXRlcmxpc3RlIGluIEtsYW1tZXJuLiBTaWVcbi8vIGJlc2NocmVpYnQgZGllIFZPTExTVFx1MDBDNE5ESUdFIEFyZ3VtZW50bGlzdGUgZGVzIEF1ZnJ1ZnMgbmFjaCBcInRwXCIgLSBhbHNvIG5pY2h0XG4vLyBudXIgZGllIGFiZ2VmcmFndGVuIFdlcnRlLCBzb25kZXJuIGF1Y2gsIGFuIHdlbGNoZXIgU3RlbGxlIGRhcyBTa3JpcHQgZGllXG4vLyBEYXRlaSBiencuIGRlbiBLb250ZXh0IGhhYmVuIHdpbGwgKHNpZWhlIFJFU0VSVkVEX1BBUkFNUyBpbiBzaG9ydGN1dHMuanMpOlxuLy8gICAvLyBAdHlwLXNob3J0Y3V0KG9yZG5lciwgamFocikgICAgICAgLT4gZih0cCwgXCJMaXRlcmF0dXJcIiwgMjAyNClcbi8vICAgLy8gQHR5cC1zaG9ydGN1dChuZXdGaWxlLCBqYWhyKSAgICAgIC0+IGYodHAsIG5ld0ZpbGUsIDIwMjQpXG4vLyAgIC8vIEB0eXAtc2hvcnRjdXQocHJvcGVydHkpICAgICAgICAgICAtPiBmKHRwLCBcIkZhbWlsaWVcIilcbi8vICAgLy8gQHR5cC1zaG9ydGN1dCAgICAgICAgICAgICAgICAgICAgIC0+IGYodHAsIG5ld0ZpbGUsIGN0eClcbi8vIERhZHVyY2ggYmVrb21tdCBqZWRlcyBTa3JpcHQgc2VpbmUgZWlnZW5lbiBQYXJhbWV0ZXIgaW4gc2VpbmVyIGVpZ2VuZW5cbi8vIFJlaWhlbmZvbGdlLCBzdGF0dCBzaWNoIGVpbmVyIGZlc3RlbiBLb252ZW50aW9uIGJldWdlbiB6dSBtXHUwMEZDc3Nlbi5cbi8vXG4vLyBVbnRlcnNjaGllZGVuIHdpcmQgendpc2NoZW4gXCJnYXIga2VpbmUgS2xhbW1lcm5cIiAocGFyYW1zID09PSBudWxsLCBkZXJcbi8vIGhlcmtcdTAwRjZtbWxpY2hlIEF1ZnJ1ZiBmKHRwLCBuZXdGaWxlLCBjdHgpIC0gc28gdmVyaGFsdGVuIHNpY2ggYWxsZSBiaXNoZXJcbi8vIG1hcmtpZXJ0ZW4gU2tyaXB0ZSB1bnZlclx1MDBFNG5kZXJ0KSB1bmQgXCJsZWVyZSBLbGFtbWVyblwiIChwYXJhbXMgPT09IFtdLCBlaW5cbi8vIEF1ZnJ1ZiBnYW56IG9obmUgQXJndW1lbnRlIGF1XHUwMERGZXIgdHApLlxuLy9cbi8vIERlciBNYXJrZXIgbXVzcyB1bm1pdHRlbGJhciBhdWYgZGVuIEtvbW1lbnRhcmJlZ2lubiBmb2xnZW4uIEVpbmUgZnJcdTAwRkNoZXJlXG4vLyBGYXNzdW5nIGVybGF1YnRlIGJlbGllYmlnZW4gVGV4dCBkYXZvciAtIGRhbWl0IGdlblx1MDBGQ2d0ZSBhYmVyIHNjaG9uIGVpbmVcbi8vIEVyd1x1MDBFNGhudW5nIGluIEZsaWVcdTAwREZ0ZXh0IChcIi4uLiBpbiBzZWluZW0gQHR5cC1zaG9ydGN1dC1NYXJrZXIgZGVrbGFyaWVydFwiKSxcbi8vIHVtIGVpbiBTa3JpcHQgdW5nZXdvbGx0IGFscyBTaG9ydGN1dCBhbnp1YmlldGVuLiBHZW5hdSBkYXMgaXN0IFRZUC5qc1xuLy8gcGFzc2llcnQsIGRlc3NlbiBLb3Bma29tbWVudGFyIGRpZSBLb252ZW50aW9uIGJlc2NocmVpYnQuIEFsbGUgdGF0c1x1MDBFNGNobGljaFxuLy8gbWFya2llcnRlbiBTa3JpcHRlIHNjaHJlaWJlbiBkZW4gTWFya2VyIG9obmVoaW4gYW4gZGVuIFplaWxlbmFuZmFuZy5cbi8vXG4vLyBcIlxcYlwiIGhpbnRlciBkZW0gTWFya2VybmFtZW4gdmVyaGluZGVydCwgZGFzcyBcIkB0eXAtc2hvcnRjdXRYWVpcIiBhbnNjaGxcdTAwRTRndCxcbi8vIHVuZCBzdFx1MDBGNnJ0IGRpZSBkaXJla3QgZm9sZ2VuZGUgS2xhbW1lciBuaWNodCAodCAtPiAoIGlzdCBlaW5lIFdvcnRncmVuemUpLlxuY29uc3QgU0hPUlRDVVRfTUFSS0VSID0gL15bIFxcdF0qKD86XFwvXFwvK3xcXC9cXCorfFxcKilbIFxcdF0qQHR5cC1zaG9ydGN1dFxcYig/OlxcKChbXildKilcXCkpP1sgXFx0XSooLio/KVsgXFx0XSooPzpcXCpcXC8pP1sgXFx0XSokL207XG5cbi8vIFBhcmFtZXRlcm5hbWVuIGF1cyBkZXIgS2xhbW1lciBkZXMgTWFya2VycywgaW4gRGVrbGFyYXRpb25zcmVpaGVuZm9sZ2UuXG4vLyBMZWVyZSBFaW50clx1MDBFNGdlICh6LiBCLiBiZWkgXCIoKVwiIG9kZXIgZWluZW0gXHUwMEZDYmVyelx1MDBFNGhsaWdlbiBLb21tYSkgZmFsbGVuIHdlZztcbi8vIGVpbiB2ZXJzZWhlbnRsaWNoIGRvcHBlbHQgZ2VuYW5udGVyIE5hbWUgZXJnXHUwMEU0YmUgendlaSBFaW5nYWJlZmVsZGVyLCBkaWVcbi8vIGJlaWRlIGRlbnNlbGJlbiBFaW50cmFnIHNjaHJlaWJlbiwgdW5kIGJsZWlidCBkZXNoYWxiIG51ciBlaW5tYWwgc3RlaGVuLlxuZnVuY3Rpb24gcGFyc2VQYXJhbXMocmF3KSB7XG4gIGNvbnN0IG5hbWVuID0gKHJhdyA/PyBcIlwiKVxuICAgIC5zcGxpdChcIixcIilcbiAgICAubWFwKChuYW1lKSA9PiBuYW1lLnRyaW0oKSlcbiAgICAuZmlsdGVyKChuYW1lKSA9PiBuYW1lICE9PSBcIlwiKTtcbiAgcmV0dXJuIFsuLi5uZXcgU2V0KG5hbWVuKV07XG59XG5cbi8vIEhcdTAwRTRsdCBkaWUgTGlzdGUgZGVyIGFscyBTaG9ydGN1dCBtYXJraWVydGVuIFRlbXBsYXRlci1Ta3JpcHRlIGFrdHVlbGwuXG4vL1xuLy8gRGllIExpc3RlIHdpcmQgdm9yYWIgKGFzeW5jaHJvbikgYXVzIFRlbXBsYXRlcnMgU2tyaXB0LU9yZG5lciBnZWxlc2VuIHVuZCBiZWlcbi8vIFx1MDBDNG5kZXJ1bmdlbiBkYXJpbiBuYWNoZ2VmXHUwMEZDaHJ0LCBzdGF0dCBzaWUgZXJzdCBiZWltIFx1MDBENmZmbmVuIGRlcyBNb2RhbHMgenVcbi8vIGVybWl0dGVsbiAtIHNvIGlzdCBzaWUgZG9ydCBvaG5lIFdhcnRlemVpdCBkYSwgdW5kIGRhcyBNb2RhbCBibGVpYnQgZnJlaSB2b25cbi8vIERhdGVpenVncmlmZmVuLiBMaWVmZXJ0IGVpbmVuIEFjY2Vzc29yIGF1ZiBkaWUgamV3ZWlscyBha3R1ZWxsZSBMaXN0ZVxuLy8gKFt7IG5hbWUsIHBhcmFtcywgZGVzY3JpcHRpb24gfV0sIG5hY2ggTmFtZW4gc29ydGllcnQpLlxuZnVuY3Rpb24gcmVnaXN0ZXJTaG9ydGN1dFNjcmlwdHMocGx1Z2luKSB7XG4gIGNvbnN0IHsgYXBwIH0gPSBwbHVnaW47XG5cbiAgbGV0IHNjcmlwdEZvbGRlciA9IG51bGw7XG4gIGxldCBzY3JpcHRzID0gW107XG5cbiAgY29uc3QgY3VycmVudFNjcmlwdEZvbGRlciA9ICgpID0+IHtcbiAgICBjb25zdCBmb2xkZXIgPSBhcHAucGx1Z2lucy5wbHVnaW5zW1widGVtcGxhdGVyLW9ic2lkaWFuXCJdPy5zZXR0aW5ncz8udXNlcl9zY3JpcHRzX2ZvbGRlcjtcbiAgICByZXR1cm4gZm9sZGVyID8gbm9ybWFsaXplUGF0aChmb2xkZXIpIDogbnVsbDtcbiAgfTtcblxuICBjb25zdCBpc0luU2NyaXB0Rm9sZGVyID0gKHBhdGgpID0+ICEhc2NyaXB0Rm9sZGVyICYmICEhcGF0aCAmJiBwYXRoLnN0YXJ0c1dpdGgoc2NyaXB0Rm9sZGVyICsgXCIvXCIpO1xuXG4gIC8vIFdpZSBUZW1wbGF0ZXIgc2VsYnN0OiBhbGxlIC5qcy1EYXRlaWVuIGltIFNrcmlwdC1PcmRuZXIgaW5rbC5cbiAgLy8gVW50ZXJvcmRuZXJuLCBTa3JpcHRuYW1lID0gRGF0ZWluYW1lIG9obmUgRW5kdW5nLlxuICBhc3luYyBmdW5jdGlvbiByZWZyZXNoU2NyaXB0cygpIHtcbiAgICBjb25zdCBmb2xkZXJQYXRoID0gY3VycmVudFNjcmlwdEZvbGRlcigpO1xuICAgIHNjcmlwdEZvbGRlciA9IGZvbGRlclBhdGg7XG4gICAgY29uc3QgZm9sZGVyID0gZm9sZGVyUGF0aCA/IGFwcC52YXVsdC5nZXRGb2xkZXJCeVBhdGgoZm9sZGVyUGF0aCkgOiBudWxsO1xuICAgIGNvbnN0IGZpbGVzID0gW107XG4gICAgaWYgKGZvbGRlcikge1xuICAgICAgVmF1bHQucmVjdXJzZUNoaWxkcmVuKGZvbGRlciwgKGNoaWxkKSA9PiB7XG4gICAgICAgIGlmIChjaGlsZCBpbnN0YW5jZW9mIFRGaWxlICYmIGNoaWxkLmV4dGVuc2lvbiA9PT0gXCJqc1wiKSBmaWxlcy5wdXNoKGNoaWxkKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICBjb25zdCBmb3VuZCA9IFtdO1xuICAgIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgbWF0Y2ggPSAoYXdhaXQgYXBwLnZhdWx0LmNhY2hlZFJlYWQoZmlsZSkpLm1hdGNoKFNIT1JUQ1VUX01BUktFUik7XG4gICAgICAgIC8vIG1hdGNoWzFdIGlzdCB1bmRlZmluZWQsIHdlbm4gZ2FyIGtlaW5lIEtsYW1tZXJuIGRhc3RlaGVuLCB1bmQgXCJcIiBiZWlcbiAgICAgICAgLy8gbGVlcmVuIEtsYW1tZXJuIC0gZGVyIFVudGVyc2NoaWVkIGVudHNjaGVpZGV0IFx1MDBGQ2JlciBkaWUgQXVmcnVmZm9ybS5cbiAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgZm91bmQucHVzaCh7XG4gICAgICAgICAgICBuYW1lOiBmaWxlLmJhc2VuYW1lLFxuICAgICAgICAgICAgcGFyYW1zOiBtYXRjaFsxXSA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IHBhcnNlUGFyYW1zKG1hdGNoWzFdKSxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBtYXRjaFsyXSA/PyBcIlwiLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYFRZUC1TeXN0ZW06IFRlbXBsYXRlci1Ta3JpcHQgJHtmaWxlLnBhdGh9IG5pY2h0IGxlc2JhcmAsIGUpO1xuICAgICAgfVxuICAgIH1cbiAgICAvLyBPcmRuZXIgendpc2NoZW56ZWl0bGljaCBpbiBUZW1wbGF0ZXIgdW1nZXN0ZWxsdDogRXJnZWJuaXMgdmVyd2VyZmVuLFxuICAgIC8vIGRlciBMYXVmIGZcdTAwRkNyIGRlbiBuZXVlbiBPcmRuZXIgaXN0IGJlcmVpdHMgYW5nZXN0b1x1MDBERmVuLlxuICAgIGlmIChmb2xkZXJQYXRoICE9PSBzY3JpcHRGb2xkZXIpIHJldHVybjtcbiAgICBzY3JpcHRzID0gZm91bmQuc29ydCgoYSwgYikgPT4gYS5uYW1lLmxvY2FsZUNvbXBhcmUoYi5uYW1lKSk7XG4gIH1cblxuICBjb25zdCBzY2hlZHVsZVJlZnJlc2ggPSBkZWJvdW5jZShyZWZyZXNoU2NyaXB0cywgMzAwLCB0cnVlKTtcbiAgY29uc3Qgb25GaWxlQ2hhbmdlID0gKGZpbGUsIG9sZFBhdGgpID0+IHtcbiAgICBpZiAoaXNJblNjcmlwdEZvbGRlcihmaWxlPy5wYXRoKSB8fCBpc0luU2NyaXB0Rm9sZGVyKG9sZFBhdGgpKSBzY2hlZHVsZVJlZnJlc2goKTtcbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoYXBwLnZhdWx0Lm9uKFwiY3JlYXRlXCIsIG9uRmlsZUNoYW5nZSkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJtb2RpZnlcIiwgb25GaWxlQ2hhbmdlKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC52YXVsdC5vbihcImRlbGV0ZVwiLCBvbkZpbGVDaGFuZ2UpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoYXBwLnZhdWx0Lm9uKFwicmVuYW1lXCIsIG9uRmlsZUNoYW5nZSkpO1xuICBhcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkocmVmcmVzaFNjcmlwdHMpO1xuXG4gIHJldHVybiAoKSA9PiB7XG4gICAgLy8gVGVtcGxhdGVyLU9yZG5lciBpbnp3aXNjaGVuIHVtZ2VzdGVsbHQ6IGZcdTAwRkNyIGRlbiBuXHUwMEU0Y2hzdGVuIEF1ZnJ1ZlxuICAgIC8vIG5hY2hsYWRlbiwgamV0enQgbm9jaCBtaXQgZGVyIGJpc2hlcmlnZW4gTGlzdGUgYW50d29ydGVuLlxuICAgIGlmIChjdXJyZW50U2NyaXB0Rm9sZGVyKCkgIT09IHNjcmlwdEZvbGRlcikgc2NoZWR1bGVSZWZyZXNoKCk7XG4gICAgcmV0dXJuIHNjcmlwdHM7XG4gIH07XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlclNob3J0Y3V0U2NyaXB0cywgU0hPUlRDVVRfTUFSS0VSLCBwYXJzZVBhcmFtcyB9O1xuIiwgImNvbnN0IHsgUGx1Z2luIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XHJcbmNvbnN0IHsgREVGQVVMVF9TRVRUSU5HUywgVHlwU3lzdGVtU2V0dGluZ1RhYiB9ID0gcmVxdWlyZShcIi4vc2V0dGluZ3NcIik7XHJcbmNvbnN0IHsgcmVnaXN0ZXJDb21tYW5kcyB9ID0gcmVxdWlyZShcIi4vY29tbWFuZHNcIik7XHJcbmNvbnN0IHsgcmVnaXN0ZXJUeXBWaWV3LCBzb3J0VHlwZXNCeU1vZGUsIERFRkFVTFRfU09SVF9PUkRFUiB9ID0gcmVxdWlyZShcIi4vdHlwLXZpZXdcIik7XHJcbmNvbnN0IHsgVHlwSW5kZXgsIHNldENhbm9uaWNhbFByb3BlcnR5LCBkZWxldGVQcm9wZXJ0eSwgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcclxuY29uc3QgeyBnZXRTdWJ0eXBlLCBnZXRTdWJ0eXBlTmFtZXMsIG1pZ3JhdGVBYm92ZVN0YW5kYXJkLCBtaWdyYXRlU3VidHlwZUNvbG9yU2NhbGUgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cGVzXCIpO1xyXG5jb25zdCB7IERFRkFVTFRfU1VCVFlQRV9DT0xPUl9SQU5HRVMgfSA9IHJlcXVpcmUoXCIuL3R5cGUtY29sb3JzXCIpO1xyXG5jb25zdCB7IHJlZ2lzdGVyRmlsZUV4cGxvcmVyQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9maWxlLWV4cGxvcmVyLWNvbG9yc1wiKTtcclxuY29uc3QgeyByZWdpc3RlckdyYXBoQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9ncmFwaC1jb2xvcnNcIik7XHJcbmNvbnN0IHsgcmVnaXN0ZXJTZWFyY2hDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL3NlYXJjaC1jb2xvcnNcIik7XHJcbmNvbnN0IHsgcmVnaXN0ZXJSZWNlbnRGaWxlc0NvbG9ycyB9ID0gcmVxdWlyZShcIi4vcmVjZW50LWZpbGVzLWNvbG9yc1wiKTtcclxuY29uc3QgeyByZWdpc3RlckJhY2tsaW5rQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9iYWNrbGluay1jb2xvcnNcIik7XHJcbmNvbnN0IHsgcmVnaXN0ZXJCb29rbWFya3NDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL2Jvb2ttYXJrLWNvbG9yc1wiKTtcclxuY29uc3QgeyByZWdpc3RlckFjdGl2ZVRpdGxlQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9hY3RpdmUtdGl0bGUtY29sb3JzXCIpO1xyXG5jb25zdCB7IHJlZ2lzdGVyTGlua0NvbG9ycyB9ID0gcmVxdWlyZShcIi4vbGluay1jb2xvcnNcIik7XHJcbmNvbnN0IHsgcmVnaXN0ZXJGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLWRlZmF1bHQtaGlnaGxpZ2h0XCIpO1xyXG5jb25zdCB7IHJlZ2lzdGVyUHJvcGVydHlSZW5hbWVTeW5jIH0gPSByZXF1aXJlKFwiLi9wcm9wZXJ0eS1yZW5hbWUtc3luY1wiKTtcclxuY29uc3QgeyBub3JtYWxpemVHbG9iYWxPcmRlciwgc29ydEZyb250bWF0dGVyRm9yLCBwbGFjZVByb3BlcnR5Rm9yIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1zb3J0XCIpO1xyXG5jb25zdCB7IHJlc29sdmVTaG9ydGN1dHMsIHNjcmlwdE5hbWVPZiwgcmVzb2x2ZUNhbGxBcmdzIH0gPSByZXF1aXJlKFwiLi9zaG9ydGN1dHNcIik7XHJcbmNvbnN0IHtcclxuICBwaWNrVHlwZTogcGlja1R5cGVNb2RhbCxcclxuICBwaWNrU3VidHlwZTogcGlja1N1YnR5cGVNb2RhbCxcclxuICBwaWNrVHlwZUFuZFN1YnR5cGU6IHBpY2tUeXBlQW5kU3VidHlwZU1vZGFsLFxyXG59ID0gcmVxdWlyZShcIi4vdHlwZS1waWNrZXJcIik7XHJcbmNvbnN0IHsgcmVnaXN0ZXJTaG9ydGN1dFNjcmlwdHMgfSA9IHJlcXVpcmUoXCIuL3Nob3J0Y3V0LXNjcmlwdHNcIik7XHJcblxyXG4vLyBNaWdyaWVydCBCZXN0YW5kc2luc3RhbGxhdGlvbmVuIHZvbiBkZXIgYWx0ZW4sIHNlcGFyYXRlblxyXG4vLyB0eXBlRmxvYXRpbmdGcm9udG1hdHRlci1MaXN0ZSAoZWlnZW5lcyBEaWN0IGplIFR5cCwgaW1tZXIgaGludGVyIGRlclxyXG4vLyBTdGFuZGFyZGxpc3RlIHNvcnRpZXJ0KSBhdWYgZGllIG5ldWUgdHlwZUZsb2F0aW5nS2V5cy1NYXJraWVydW5nIGlubmVyaGFsYlxyXG4vLyBkZXJzZWxiZW4gdHlwZURlZmF1bHRGcm9udG1hdHRlci1MaXN0ZSAoc2llaGUgS29tbWVudGFyIGFuIHR5cGVGbG9hdGluZ0tleXNcclxuLy8gaW4gc2V0dGluZ3MuanMpIC0gZGllIEZsb2F0aW5nIFByb3BlcnRpZXMgbGFuZGVuIGRhYmVpIHVudmVyXHUwMEU0bmRlcnQgZGlyZWt0XHJcbi8vIGltIEFuc2NobHVzcyBhbiBkaWUgYmlzaGVyaWdlIFN0YW5kYXJkbGlzdGUsIGdlbmF1IHdpZSB6dXZvci5cclxuZnVuY3Rpb24gbWlncmF0ZUZsb2F0aW5nRnJvbnRtYXR0ZXIoc2V0dGluZ3MpIHtcclxuICBpZiAoIXNldHRpbmdzLnR5cGVGbG9hdGluZ0Zyb250bWF0dGVyKSByZXR1cm47XHJcbiAgZm9yIChjb25zdCBbdHlwZSwgZmxvYXRpbmddIG9mIE9iamVjdC5lbnRyaWVzKHNldHRpbmdzLnR5cGVGbG9hdGluZ0Zyb250bWF0dGVyKSkge1xyXG4gICAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKGZsb2F0aW5nKS5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBcIlwiKTtcclxuICAgIGlmIChrZXlzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XHJcbiAgICBzZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdID0geyAuLi4oc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXSA/PyB7fSksIC4uLmZsb2F0aW5nIH07XHJcbiAgICBzZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdID0gWy4uLm5ldyBTZXQoWy4uLihzZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdID8/IFtdKSwgLi4ua2V5c10pXTtcclxuICB9XHJcbiAgZGVsZXRlIHNldHRpbmdzLnR5cGVGbG9hdGluZ0Zyb250bWF0dGVyO1xyXG59XHJcblxyXG4vLyBBdXMgZGVtIGZydWVoZXJlbiBTY2hhbHRlciBcIkJlc2NocmVpYnVuZ3MtVGV4dGZlbGQgYW56ZWlnZW5cIiAoQm9vbGVhbikgaXN0XHJcbi8vIGRlciBkcmVpc3R1ZmlnZSBNb2R1cyBkZXIgendlaXRlbiBTcGFsdGUgZ2V3b3JkZW4sIHVtZ2VzY2hhbHRldCB1ZWJlciBkZW5cclxuLy8gS25vcGYgaW0gTGlzdGVuLUhlYWRlciAoc2llaGUgU0VDT05EQVJZX01PREVTIGluIHR5cC12aWV3LmpzKS4gRGVyIGFsdGUgV2VydFxyXG4vLyBrZW5udCBudXIgendlaSBkZXIgZHJlaSBadXN0YWVuZGUgLSB0cnVlIHdpcmQgenVyIEJlc2NocmVpYnVuZywgZmFsc2UgenVcclxuLy8gXCJuaWNodHNcIjsgXCJzdWJ0eXBlc1wiIGdhYiBlcyBkYW1hbHMgbm9jaCBuaWNodC4gTGllZmVydCB0cnVlIGJlaSBlaW5lclxyXG4vLyBBZW5kZXJ1bmcsIGRhbWl0IGRlciBBdWZydWZlciBzaWUgZ2xlaWNoIHNjaHJlaWJ0IHVuZCBkZXIgYWx0ZSBTY2hsdWVzc2VsXHJcbi8vIG5pY2h0IGluIGRhdGEuanNvbiBsaWVnZW4gYmxlaWJ0LlxyXG4vL1xyXG4vLyBHZXBydWVmdCB3aXJkIGdlZ2VuIHN0b3JlZCAoZGllIHJvaGVuIGdlbGFkZW5lbiBEYXRlbiksIE5JQ0hUIGdlZ2VuIHNldHRpbmdzOlxyXG4vLyBkb3J0IGhhdCBPYmplY3QuYXNzaWduIGRlbiBuZXVlbiBTY2hsdWVzc2VsIGxhZW5nc3QgYXVzIERFRkFVTFRfU0VUVElOR1NcclxuLy8gZ2VmdWVsbHQsIFwibm9jaCBuaWNodCBnZXNldHp0XCIgd2FlcmUgZGFyYW4gYWxzbyBuaWUgenUgZXJrZW5uZW4gdW5kIGRlciBhbHRlXHJcbi8vIFdlcnQgYmxpZWJlIHN0aWxsc2Nod2VpZ2VuZCBsaWVnZW4uXHJcbmZ1bmN0aW9uIG1pZ3JhdGVUeXBMaXN0U2Vjb25kYXJ5KHNldHRpbmdzLCBzdG9yZWQpIHtcclxuICBpZiAoc3RvcmVkPy50eXBMaXN0RGVzY3JpcHRpb25FbmFibGVkID09PSB1bmRlZmluZWQpIHJldHVybiBmYWxzZTtcclxuICBpZiAoc3RvcmVkLnR5cExpc3RTZWNvbmRhcnkgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgc2V0dGluZ3MudHlwTGlzdFNlY29uZGFyeSA9IHN0b3JlZC50eXBMaXN0RGVzY3JpcHRpb25FbmFibGVkID8gXCJkZXNjcmlwdGlvblwiIDogXCJub25lXCI7XHJcbiAgfVxyXG4gIGRlbGV0ZSBzZXR0aW5ncy50eXBMaXN0RGVzY3JpcHRpb25FbmFibGVkO1xyXG4gIHJldHVybiB0cnVlO1xyXG59XHJcblxyXG4vLyBEaWUgQXVzcmljaHR1bmcgZGVyIFN1YnR5cC1Wb3JzY2hhdSB3YXIga3VyenplaXRpZyBlaW5lIGVpZ2VuZSBFaW5zdGVsbHVuZ1xyXG4vLyB1bmQgaXN0IGpldHp0IGVpbiBTdHlsZSBTZXR0aW5nIChib2R5LUtsYXNzZSwgc2llaGUgZGVuIEBzZXR0aW5ncy1CbG9jayBpblxyXG4vLyBzdHlsZXMuY3NzKSAtIGRhcyBQbHVnaW4gbGllc3QgZGVuIFNjaGx1ZXNzZWwgbmljaHQgbWVoci4gT2huZSBkaWVzZXNcclxuLy8gQXVmcmFldW1lbiBibGllYmUgZXIgdWViZXIgT2JqZWN0LmFzc2lnbiBpbiBsb2FkU2V0dGluZ3MgZGF1ZXJoYWZ0IGluXHJcbi8vIGRhdGEuanNvbiBzdGVoZW4uXHJcbmZ1bmN0aW9uIGRyb3BUeXBMaXN0U3VidHlwZXNBbGlnbihzZXR0aW5ncykge1xyXG4gIGlmIChzZXR0aW5ncy50eXBMaXN0U3VidHlwZXNSaWdodEFsaWduZWQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZhbHNlO1xyXG4gIGRlbGV0ZSBzZXR0aW5ncy50eXBMaXN0U3VidHlwZXNSaWdodEFsaWduZWQ7XHJcbiAgcmV0dXJuIHRydWU7XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gY2xhc3MgVHlwU3lzdGVtUGx1Z2luIGV4dGVuZHMgUGx1Z2luIHtcclxuICBhc3luYyBvbmxvYWQoKSB7XHJcbiAgICBhd2FpdCB0aGlzLmxvYWRTZXR0aW5ncygpO1xyXG5cclxuICAgIC8vIFZvciBhbGxlbiBcdTAwRkNicmlnZW4gTW9kdWxlbjogZGllIHJlZ2lzdHJpZXJlbiBzaWNoIGF1ZiBkZXNzZW4gXCJjaGFuZ2VcIi1cclxuICAgIC8vIEV2ZW50IHVuZCBsZXNlbiBUWVAvU1VCVFlQIGF1c3NjaGxpZVx1MDBERmxpY2ggZGFyXHUwMEZDYmVyIChzaWVoZSB0eXAtaW5kZXguanMpLlxyXG4gICAgdGhpcy50eXBJbmRleCA9IG5ldyBUeXBJbmRleCh0aGlzKTtcclxuICAgIHRoaXMudHlwSW5kZXgucmVnaXN0ZXIoKTtcclxuXHJcbiAgICByZWdpc3RlckNvbW1hbmRzKHRoaXMpO1xyXG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBUeXBTeXN0ZW1TZXR0aW5nVGFiKHRoaXMuYXBwLCB0aGlzKSk7XHJcbiAgICAvLyBVbWJlbmVubnVuZ2VuIFx1MDBGQ2JlciBcIkFsbCBwcm9wZXJ0aWVzXCIvQmFzZXMgYXVjaCBpbnMgVFlQLUZyb250bWF0dGVyXHJcbiAgICAvLyBkZXIgVHlwZW4gXHUwMEZDYmVybmVobWVuIChzaWVoZSBwcm9wZXJ0eS1yZW5hbWUtc3luYy5qcykuXHJcbiAgICByZWdpc3RlclByb3BlcnR5UmVuYW1lU3luYyh0aGlzKTtcclxuICAgIC8vIEFjY2Vzc29yIGF1ZiBkaWUgYWxzIFwiQHR5cC1zaG9ydGN1dFwiIG1hcmtpZXJ0ZW4gVGVtcGxhdGVyLVNrcmlwdGUsIGZcdTAwRkNyXHJcbiAgICAvLyBkYXMgQXVzd2FobC1Nb2RhbCBkZXIgUHJvcGVydHktWmVpbGVuIChzaWVoZSBzaG9ydGN1dC1waWNrZXIuanMpLlxyXG4gICAgdGhpcy5nZXRTaG9ydGN1dFNjcmlwdHMgPSByZWdpc3RlclNob3J0Y3V0U2NyaXB0cyh0aGlzKTtcclxuXHJcbiAgICAvLyBTZXBhcmF0IGdlaGFsdGVuIChuaWNodCBudXIgVGVpbCB2b24gcmVmcmVzaEZucyk6IGRpZSBUWVAtRGV0YWlsYW5zaWNodFxyXG4gICAgLy8gYnJhdWNodCBuYWNoIGRlbSBNb3VudGVuIGlocmVzIFRZUC1Gcm9udG1hdHRlci1FZGl0b3JzIGdlemllbHQgbnVyXHJcbiAgICAvLyBkaWVzZW4gZWluZW4gUmVmcmVzaCAoRmV0dC1NYXJraWVydW5nIGRlciBQcm9wZXJ0eS1aZWlsZW4pIC0gZGFzIGdhbnplXHJcbiAgICAvLyByZWZyZXNoVHlwQ29sb3JzKCktQlx1MDBGQ25kZWwgd1x1MDBGQ3JkZSBkb3J0IGF1Y2ggdW5uXHUwMEY2dGlnIHJlZ2lzdGVyVHlwVmlldydzXHJcbiAgICAvLyBlaWdlbmVuIFJlbmRlci1SZWZyZXNoIG1pdGFuc3RvXHUwMERGZW4gdW5kIHNpY2ggZGFtaXQgc2VsYnN0IHJla3Vyc2l2XHJcbiAgICAvLyBlcm5ldXQgcmVuZGVybiAoZlx1MDBGQ2hydGUgenUgZWluZW0gU3RhY2sgT3ZlcmZsb3cgYmVpIGplZGVtIFRZUC1cdTAwRDZmZm5lbikuXHJcbiAgICB0aGlzLnJlZnJlc2hGcm9udG1hdHRlckhpZ2hsaWdodCA9IHJlZ2lzdGVyRnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0KHRoaXMpO1xyXG5cclxuICAgIGNvbnN0IHJlZnJlc2hGbnMgPSBbXHJcbiAgICAgIHJlZ2lzdGVyVHlwVmlldyh0aGlzKSxcclxuICAgICAgcmVnaXN0ZXJGaWxlRXhwbG9yZXJDb2xvcnModGhpcyksXHJcbiAgICAgIHJlZ2lzdGVyR3JhcGhDb2xvcnModGhpcyksXHJcbiAgICAgIHJlZ2lzdGVyU2VhcmNoQ29sb3JzKHRoaXMpLFxyXG4gICAgICByZWdpc3RlclJlY2VudEZpbGVzQ29sb3JzKHRoaXMpLFxyXG4gICAgICByZWdpc3RlckJhY2tsaW5rQ29sb3JzKHRoaXMpLFxyXG4gICAgICByZWdpc3RlckJvb2ttYXJrc0NvbG9ycyh0aGlzKSxcclxuICAgICAgcmVnaXN0ZXJBY3RpdmVUaXRsZUNvbG9ycyh0aGlzKSxcclxuICAgICAgcmVnaXN0ZXJMaW5rQ29sb3JzKHRoaXMpLFxyXG4gICAgICB0aGlzLnJlZnJlc2hGcm9udG1hdHRlckhpZ2hsaWdodCxcclxuICAgIF07XHJcbiAgICB0aGlzLnJlZnJlc2hUeXBDb2xvcnMgPSAoKSA9PiByZWZyZXNoRm5zLmZvckVhY2goKGZuKSA9PiBmbigpKTtcclxuXHJcbiAgICAvLyBEZXIgQHNldHRpbmdzLUJsb2NrIGluIHN0eWxlcy5jc3MgKFN0eWxlIFNldHRpbmdzLCBzaWVoZSBkb3J0KSB3aXJkIHNvbnN0XHJcbiAgICAvLyBqZSBuYWNoIExhZGVyZWloZW5mb2xnZSB1ZWJlcnNlaGVuOiBTdHlsZSBTZXR0aW5ncyBsaWVzdCBkaWUgU3R5bGVzaGVldHNcclxuICAgIC8vIGJlaW0gZWlnZW5lbiBMYWRlbiB1bmQgZGFuYWNoIG51ciBub2NoIGJlaSBcImNzcy1jaGFuZ2VcIiAtIGRhcyBmZXVlcnQgYWJlclxyXG4gICAgLy8gYXVzc2NobGllc3NsaWNoIGZ1ZXIgVGhlbWVzIHVuZCBTbmlwcGV0cywgbmljaHQgZnVlciBkYXMgc3R5bGVzLmNzcyBlaW5lc1xyXG4gICAgLy8gUGx1Z2lucy4gV2VyIHNwYWV0ZXIgZ2VsYWRlbiB3aXJkIGFscyBTdHlsZSBTZXR0aW5ncyAob2RlciBwZXIgSG90LVJlbG9hZFxyXG4gICAgLy8gbmV1IGdlbGFkZW4gd2lyZCksIHRhdWNodCBkb3J0IGFsc28gZ2FyIG5pY2h0IGF1Zi4gXCJwYXJzZS1zdHlsZS1zZXR0aW5nc1wiXHJcbiAgICAvLyBpc3QgZGVyIGRhZnVlciB2b3JnZXNlaGVuZSBIb29rOyBvaG5lIGluc3RhbGxpZXJ0ZXMgU3R5bGUgU2V0dGluZ3MgaG9lcnRcclxuICAgIC8vIG5pZW1hbmQgenUgdW5kIGRlciBBdWZydWYgdmVycHVmZnQgZm9sZ2VubG9zLlxyXG4gICAgLy9cclxuICAgIC8vIEVyc3QgaW0gbmFlY2hzdGVuIFRpY2s6IE9ic2lkaWFuIGhhZW5ndCBkYXMgc3R5bGVzLmNzcyBlaW5lcyBQbHVnaW5zIGVyc3RcclxuICAgIC8vIE5BQ0ggZGVzc2VuIG9ubG9hZCgpIGluIGRlbiBET00gLSBzeW5jaHJvbiBoaWVyIGdlcnVmZW4gZnVlbmRlIFN0eWxlXHJcbiAgICAvLyBTZXR0aW5ncyBkYXMgU3R5bGVzaGVldCBub2NoIGdhciBuaWNodCB1bmQgbGllc3NlIGRlbiBBYnNjaG5pdHQgYXVzLlxyXG4gICAgLy8gb25MYXlvdXRSZWFkeSB0YXVndCBkYWZ1ZXIgbmljaHQ6IGJlaW0gSG90LVJlbG9hZCBpc3QgZGFzIExheW91dCBsYWVuZ3N0XHJcbiAgICAvLyBmZXJ0aWcsIGRlciBSdWVja3J1ZiBsaWVmZSBhbHNvIHNvZm9ydCB1bmQgZGFtaXQgZ2VuYXVzbyB6dSBmcnVlaC5cclxuICAgIGNvbnN0IHBhcnNlU3R5bGVTZXR0aW5ncyA9IHdpbmRvdy5zZXRUaW1lb3V0KCgpID0+IHRoaXMuYXBwLndvcmtzcGFjZS50cmlnZ2VyKFwicGFyc2Utc3R5bGUtc2V0dGluZ3NcIiksIDApO1xyXG4gICAgdGhpcy5yZWdpc3RlcigoKSA9PiB3aW5kb3cuY2xlYXJUaW1lb3V0KHBhcnNlU3R5bGVTZXR0aW5ncykpO1xyXG4gIH1cclxuXHJcbiAgb251bmxvYWQoKSB7fVxyXG5cclxuICAvLyBGXHUwMEZDciBfb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzOiBsaWVmZXJ0IGRpZSBpbSBUWVAtVmlldyB1bnRlclxyXG4gIC8vIFwiVFlQLUZyb250bWF0dGVyXCIgaGludGVybGVndGVuIFByb3BlcnRpZXMgZlx1MDBGQ3IgZGVuIGdlZ2ViZW5lbiBUWVAsIGRhbWl0XHJcbiAgLy8gVGVtcGxhdGVyIHNpZSBiZWltIEFubGVnZW4gZWluZXIgbmV1ZW4gTm90aXogXHUwMEZDYmVybmVobWVuIGthbm4sIHN0YXR0IHNpZSBkb3J0XHJcbiAgLy8gZWluIHp3ZWl0ZXMgTWFsIHp1IHBmbGVnZW4uIEtvcGllIHN0YXR0IGRpcmVrdGVyIFJlZmVyZW56LCBkYW1pdCBlaW5cclxuICAvLyBBdWZydWZlciBkaWUgenVyXHUwMEZDY2tnZWdlYmVuZW4gV2VydGUgZ2VmYWhybG9zIG11dGllcmVuIGthbm4sIG9obmUgZGllXHJcbiAgLy8gUGx1Z2luLVNldHRpbmdzIHp1IHZlclx1MDBFNG5kZXJuLlxyXG4gIC8vXHJcbiAgLy8gUHJvcGVydGllcyBtaXQgZWluZW0gZmVzdGVuIFNob3J0Y3V0ICh0b2RheS9ub3cvY3JlYXRlZCwgc2llaGVcclxuICAvLyBzaG9ydGN1dHMuanMpIHRyYWdlbiBkZXNzZW4gZXJzdCBoaWVyIGF1ZmdlbFx1MDBGNnN0ZW4gV2VydCAtIG5pY2h0IGRlbiBiZWltXHJcbiAgLy8gU2V0emVuIGdcdTAwRkNsdGlnZW4sIGVzIGtvbW10IGFsc28gYmVpIGplZGVtIEF1ZnJ1ZiBmcmlzY2ggQmVyZWNobmV0ZXMgaGVyYXVzLlxyXG4gIC8vIFByb3BlcnRpZXMgbWl0IGVpbmVtIFNrcmlwdC1TaG9ydGN1dCB0cmFnZW4gbnVsbDogZGllIGthbm4gbnVyIFRlbXBsYXRlclxyXG4gIC8vIGF1ZmxcdTAwRjZzZW4sIFRZUC5qcyBob2x0IHNpZSBzaWNoIFx1MDBGQ2JlciBnZXRUeXBlU2hvcnRjdXRzKCkgKHVudGVuKSB1bmQgc2V0enRcclxuICAvLyBzaWUgc2VsYnN0IGVpbi4gS2V5IHVuZCBQb3NpdGlvbiBibGVpYmVuIGluIGJlaWRlbiBGXHUwMEU0bGxlbiBlcmhhbHRlbi5cclxuICAvL1xyXG4gIC8vIGluY2x1ZGVGbG9hdGluZyAoU3RhbmRhcmQ6IGZhbHNlKSBsXHUwMEU0c3N0IGRpZSBhbHMgXCJGbG9hdGluZyBQcm9wZXJ0eVwiXHJcbiAgLy8gbWFya2llcnRlbiBLZXlzICh0eXBlRmxvYXRpbmdLZXlzKSBpbiBkZXIgTGlzdGUgLSBhbmRlcnMgYWxzIGRpZSBcdTAwRkNicmlnZW5cclxuICAvLyBTdGFuZGFyZC1Qcm9wZXJ0aWVzIHdlcmRlbiBkaWVzZSBOSUNIVCBhdXRvbWF0aXNjaCBiZWkgamVkZXIgbmV1ZW4gTm90aXpcclxuICAvLyBhbmdlbGVndCAoc2llIHpcdTAwRTRobGVuIHp3YXIgZlx1MDBGQ3IgZGllIEZyb250bWF0dGVyLVNvcnRpZXJ1bmcgbWl0LCBzaWVoZVxyXG4gIC8vIG9yZGVyZWREZWZhdWx0S2V5cyBpbiBmcm9udG1hdHRlci1zb3J0LmpzLCBzb2xsZW4gYWJlciBudXIgYmVpIEJlZGFyZlxyXG4gIC8vIGV4cGxpeml0IHZvbiBlaW5lbSBUZW1wbGF0ZXItU2tyaXB0IGFiZ2VncmlmZmVuIHdlcmRlbikuXHJcbiAgLy9cclxuICAvLyBmaWxlIChvcHRpb25hbCkgd2lyZCBhbiByZXNvbHZlU2hvcnRjdXRzKCkgZHVyY2hnZXJlaWNodCAtIG51ciBmXHUwMEZDciBkZW5cclxuICAvLyBcImNyZWF0ZWRcIi1TaG9ydGN1dCByZWxldmFudCwgZGVyIGRhcyBFcnN0ZWxsdW5nc2RhdHVtIGRlciBaaWVsLURhdGVpIHN0YXR0XHJcbiAgLy8gZGVzIEF1ZnJ1ZnplaXRwdW5rdHMgbGllZmVydC5cclxuICAvL1xyXG4gIC8vIHN1YnR5cGUgKG9wdGlvbmFsKTogZXJnXHUwMEU0bnp0IGRhcyBUWVAtRnJvbnRtYXR0ZXIgdW0gZGVuIEJsb2NrIGRpZXNlc1xyXG4gIC8vIFN1YnR5cHMgKHNpZWhlIHN1YnR5cGVzLmpzKSwgZGVzc2VuIEtleXMgZm9sZ2VuIGRhaGludGVyICh3aWNodGlnIGZcdTAwRkNyIGRpZVxyXG4gIC8vIFJlaWhlbmZvbGdlIGRlciBTa3JpcHQtU2hvcnRjdXRzKS4gU3RlaHQgZWluIEtleSBpbiBCRUlERU4gQmxcdTAwRjZja2VuLCBiZWhcdTAwRTRsdFxyXG4gIC8vIGVyIGRpZSBQb3NpdGlvbiBkZXMgVFlQLUZyb250bWF0dGVycywgV2VydCwgRmxvYXRpbmctTWFya2llcnVuZyB1bmRcclxuICAvLyBTaG9ydGN1dCBrb21tZW4gYWJlciB2b20gU3VidHlwIC0gZWluZSBadXdlaXN1bmcgYXVmIGVpbmVuIGJlcmVpdHMgdm9yaGFuZGVuZW5cclxuICAvLyBPYmpla3RzY2hsXHUwMEZDc3NlbCBcdTAwRkNiZXJzY2hyZWlidCBpaG4sIG9obmUgaWhuIHp1IHZlcnNjaGllYmVuLiBEaWVcclxuICAvLyBGcm9udG1hdHRlci1Tb3J0aWVydW5nIG11c3MgZGllc2VsYmUgUmVnZWwgdmVyd2VuZGVuLCBzb25zdCB3XHUwMEZDcmRlIHNpZVxyXG4gIC8vIGVpbmUgZ2VyYWRlIGFuZ2VsZWd0ZSBOb3RpeiBzb2ZvcnQgd2llZGVyIHVtc29ydGllcmVuIChzaWVoZVxyXG4gIC8vIG9yZGVyZWREZWZhdWx0S2V5cyBpbiBmcm9udG1hdHRlci1zb3J0LmpzKS5cclxuICBnZXRUeXBlRGVmYXVsdHModHlwZSwgeyBpbmNsdWRlRmxvYXRpbmcgPSBmYWxzZSwgZmlsZSwgc3VidHlwZSA9IG51bGwgfSA9IHt9KSB7XHJcbiAgICBjb25zdCB7IGRlZmF1bHRzLCBzaG9ydGN1dHMgfSA9IHRoaXMuY29sbGVjdEJsb2Nrcyh0eXBlLCBzdWJ0eXBlLCBpbmNsdWRlRmxvYXRpbmcpO1xyXG4gICAgcmV0dXJuIHJlc29sdmVTaG9ydGN1dHMoZGVmYXVsdHMsIHNob3J0Y3V0cywgeyBmaWxlLCBhcHA6IHRoaXMuYXBwIH0pO1xyXG4gIH1cclxuXHJcbiAgLy8gR2VtZWluc2FtZSBHcnVuZGxhZ2Ugdm9uIGdldFR5cGVEZWZhdWx0cygpIHVuZCBnZXRUeXBlU2hvcnRjdXRzKCk6IGRhc1xyXG4gIC8vIFRZUC1Gcm9udG1hdHRlciBkZXMgVHlwcywgZXJnXHUwMEU0bnp0IHVtIGRlbiBCbG9jayBkZXMgU3VidHlwcy4gRWluIEtleSwgZGVyIGluXHJcbiAgLy8gQkVJREVOIEJsXHUwMEY2Y2tlbiBzdGVodCwgYmVoXHUwMEU0bHQgZGllIFBvc2l0aW9uIGRlcyBUWVAtRnJvbnRtYXR0ZXJzOyBXZXJ0LFxyXG4gIC8vIEZsb2F0aW5nLU1hcmtpZXJ1bmcgVU5EIFNob3J0Y3V0IGtvbW1lbiBkYW5uIHZvbSBTdWJ0eXAgLSBhdWNoIFwia2VpblxyXG4gIC8vIFNob3J0Y3V0XCIgZ2lsdCBkYWJlaSBhbHMgQW5nYWJlIGRlcyBTdWJ0eXBzIHVuZCBoZWJ0IGRlbiBkZXMgVFlQcyBhdWYuXHJcbiAgY29sbGVjdEJsb2Nrcyh0eXBlLCBzdWJ0eXBlLCBpbmNsdWRlRmxvYXRpbmcpIHtcclxuICAgIGNvbnN0IGRlZmF1bHRzID0ge307XHJcbiAgICBjb25zdCBzaG9ydGN1dHMgPSB7fTtcclxuICAgIGNvbnN0IGlzRmxvYXRpbmcgPSBuZXcgTWFwKCk7XHJcbiAgICBjb25zdCBhZGRCbG9jayA9IChmcm9udG1hdHRlciwgZmxvYXRpbmdLZXlzLCBibG9ja1Nob3J0Y3V0cykgPT4ge1xyXG4gICAgICBjb25zdCBhY3R1YWxLZXlzID0gbmV3IE1hcChPYmplY3Qua2V5cyhkZWZhdWx0cykubWFwKChrZXkpID0+IFtrZXkudG9Mb3dlckNhc2UoKSwga2V5XSkpO1xyXG4gICAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhmcm9udG1hdHRlciA/PyB7fSkpIHtcclxuICAgICAgICBpZiAoa2V5ID09PSBcIlwiKSBjb250aW51ZTtcclxuICAgICAgICBjb25zdCB0YXJnZXQgPSBhY3R1YWxLZXlzLmdldChrZXkudG9Mb3dlckNhc2UoKSkgPz8ga2V5O1xyXG4gICAgICAgIGRlZmF1bHRzW3RhcmdldF0gPSB2YWx1ZTtcclxuICAgICAgICBpc0Zsb2F0aW5nLnNldCh0YXJnZXQsIChmbG9hdGluZ0tleXMgPz8gW10pLmluY2x1ZGVzKGtleSkpO1xyXG4gICAgICAgIGNvbnN0IHJlY29yZCA9IChibG9ja1Nob3J0Y3V0cyA/PyB7fSlba2V5XTtcclxuICAgICAgICBpZiAocmVjb3JkKSBzaG9ydGN1dHNbdGFyZ2V0XSA9IHJlY29yZDtcclxuICAgICAgICBlbHNlIGRlbGV0ZSBzaG9ydGN1dHNbdGFyZ2V0XTtcclxuICAgICAgfVxyXG4gICAgfTtcclxuICAgIGNvbnN0IHN1YnR5cGVEYXRhID0gc3VidHlwZSA/IGdldFN1YnR5cGUodGhpcy5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSkgOiBudWxsO1xyXG4gICAgYWRkQmxvY2soXHJcbiAgICAgIHRoaXMuc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXSxcclxuICAgICAgdGhpcy5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdLFxyXG4gICAgICB0aGlzLnNldHRpbmdzLnR5cGVTaG9ydGN1dHNbdHlwZV1cclxuICAgICk7XHJcbiAgICBpZiAoc3VidHlwZURhdGEpIGFkZEJsb2NrKHN1YnR5cGVEYXRhLmZyb250bWF0dGVyLCBzdWJ0eXBlRGF0YS5mbG9hdGluZ0tleXMsIHN1YnR5cGVEYXRhLnNob3J0Y3V0cyk7XHJcblxyXG4gICAgaWYgKCFpbmNsdWRlRmxvYXRpbmcpIHtcclxuICAgICAgZm9yIChjb25zdCBba2V5LCBmbG9hdGluZ10gb2YgaXNGbG9hdGluZykge1xyXG4gICAgICAgIGlmICghZmxvYXRpbmcpIGNvbnRpbnVlO1xyXG4gICAgICAgIGRlbGV0ZSBkZWZhdWx0c1trZXldO1xyXG4gICAgICAgIGRlbGV0ZSBzaG9ydGN1dHNba2V5XTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIHsgZGVmYXVsdHMsIHNob3J0Y3V0cyB9O1xyXG4gIH1cclxuXHJcbiAgLy8gRlx1MDBGQ3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qczogZGllIFByb3BlcnRpZXMgZGllc2VzIFRZUHMsIGRlcmVuXHJcbiAgLy8gV2VydCBiZWltIEFubGVnZW4gZWluZXIgTm90aXogdm9uIGVpbmVtIFRlbXBsYXRlci1Ta3JpcHQga29tbXQgLVxyXG4gIC8vIHsgW1Byb3BlcnR5XTogeyBuYW1lLCBhcmdzLCBmYWxsYmFjayB9IH0sIGluIGRlciBSZWloZW5mb2xnZSBkZXNcclxuICAvLyBUWVAtRnJvbnRtYXR0ZXJzIChkaWUgU2tyaXB0ZSBsYXVmZW4gbmFjaGVpbmFuZGVyIHVuZCBzZWhlbiBkaWUgRXJnZWJuaXNzZVxyXG4gIC8vIGRlciBqZXdlaWxzIGZyXHUwMEZDaGVyZW4pLlxyXG4gIC8vXHJcbiAgLy8gICBuYW1lICAgICBTa3JpcHRuYW1lLCBhbHNvIHRwLnVzZXIuPG5hbWU+IC0gb2huZSBcInRwLlwiLVByXHUwMEU0Zml4XHJcbiAgLy8gICBwYXJhbXMgICBkaWUgaW0gQHR5cC1zaG9ydGN1dC1NYXJrZXIgZGVrbGFyaWVydGUgUGFyYW1ldGVybGlzdGUgZGVzXHJcbiAgLy8gICAgICAgICAgICBTa3JpcHRzIChzaWVoZSBzaG9ydGN1dC1zY3JpcHRzLmpzKSwgb2RlciBudWxsIGJlaSBlaW5lbSBNYXJrZXJcclxuICAvLyAgICAgICAgICAgIG9obmUgS2xhbW1lcm4uIFNpZSBzdGFtbXQgYXVzIGRlbSBha3R1ZWxsZW4gU2NhbiwgbmljaHQgYXVzIGRlbVxyXG4gIC8vICAgICAgICAgICAgZ2VzcGVpY2hlcnRlbiBSZWNvcmQgLSBlaW5lIGdlXHUwMEU0bmRlcnRlIERla2xhcmF0aW9uIHdpcmt0IGFsc29cclxuICAvLyAgICAgICAgICAgIHNvZm9ydC4gVFlQLmpzIG1hY2h0IGRhcmF1cyBtaXQgcmVzb2x2ZVNob3J0Y3V0QXJncygpIHVudGVuIGRpZVxyXG4gIC8vICAgICAgICAgICAgQXJndW1lbnRsaXN0ZSBkZXMgQXVmcnVmc1xyXG4gIC8vICAgYXJncyAgICAgZGllIGVpbmdldGlwcHRlbiBBcmd1bWVudGUsIGJlbmFubnQgbmFjaCBkZW4gbmljaHQgcmVzZXJ2aWVydGVuXHJcbiAgLy8gICAgICAgICAgICBQYXJhbWV0ZXJuLiBMZWVyZXMgT2JqZWt0LCB3ZW5uIGtlaW5lIGdlc2V0enQgc2luZDsgZWluIGxlZXJcclxuICAvLyAgICAgICAgICAgIGdlbGFzc2VuZXMgRmVsZCBmZWhsdCBkYXJpbiBnYW56LCBkYW1pdCBcImFyZ3MueCA/PyBmYWxsYmFja1wiXHJcbiAgLy8gICAgICAgICAgICBpbSBTa3JpcHQgdHJcdTAwRTRndFxyXG4gIC8vICAgZmFsbGJhY2sgZGVyIGluIGRlciBUWVAtQW5zaWNodCBoaW50ZXJsZWd0ZSBmZXN0ZSBXZXJ0IGRlciBQcm9wZXJ0eS4gTnVyXHJcbiAgLy8gICAgICAgICAgICBhbHMgUlx1MDBEQ0NLRkFMTCBnZWRhY2h0OiBzY2hsXHUwMEU0Z3QgZGFzIFNrcmlwdCBmZWhsIChmZWhsdCBvZGVyXHJcbiAgLy8gICAgICAgICAgICB3aXJmdCksIHNjaHJlaWJ0IFRZUC5qcyBpaG4gc3RhdHQgZWluZXMgbGVlcmVuIFdlcnRzLiBFaW5cclxuICAvLyAgICAgICAgICAgIFNrcmlwdCwgZGFzIGJld3Vzc3QgbnVsbC9cIlwiIGxpZWZlcnQgKHouIEIuIEVTQyBpbSBQaWNrZXIpLCBpc3RcclxuICAvLyAgICAgICAgICAgIGtlaW4gRmVobHNjaGxhZyAtIGRvcnQgYmxlaWJ0IGRpZSBQcm9wZXJ0eSBsZWVyLlxyXG4gIC8vXHJcbiAgLy8gRGllIGZlc3RlbiBTaG9ydGN1dHMgKHRvZGF5L25vdy9jcmVhdGVkKSB0YXVjaGVuIGhpZXIgTklDSFQgYXVmOiBkaWUgbFx1MDBGNnN0XHJcbiAgLy8gZGFzIFBsdWdpbiBzZWxic3QgYXVmIHVuZCBsaWVmZXJ0IHNpZSBmZXJ0aWcgXHUwMEZDYmVyIGdldFR5cGVEZWZhdWx0cygpLiBEZXNzZW5cclxuICAvLyBSXHUwMEZDY2tnYWJlIGZcdTAwRkNocnQgZGllIFNrcmlwdC1LZXlzIG1pdCBkZW0gV2VydCBudWxsIC0gS2V5IHVuZCBQb3NpdGlvbiBibGVpYmVuXHJcbiAgLy8gYWxzbyBlcmhhbHRlbiwgbnVyIGRlciBXZXJ0IGtvbW10IHZvbiBoaWVyLlxyXG4gIC8vXHJcbiAgLy8gT3B0aW9uZW4gd2llIGJlaSBnZXRUeXBlRGVmYXVsdHMoKTsgaW5jbHVkZUZsb2F0aW5nIHN0YW5kYXJkbVx1MDBFNFx1MDBERmlnIGZhbHNlLFxyXG4gIC8vIGRhbWl0IGZcdTAwRkNyIGVpbmUgRmxvYXRpbmcgUHJvcGVydHkgbmljaHQgdW5nZWZyYWd0IGVpbiBTa3JpcHQgbFx1MDBFNHVmdC5cclxuICBnZXRUeXBlU2hvcnRjdXRzKHR5cGUsIHsgaW5jbHVkZUZsb2F0aW5nID0gZmFsc2UsIHN1YnR5cGUgPSBudWxsIH0gPSB7fSkge1xyXG4gICAgY29uc3QgeyBkZWZhdWx0cywgc2hvcnRjdXRzIH0gPSB0aGlzLmNvbGxlY3RCbG9ja3ModHlwZSwgc3VidHlwZSwgaW5jbHVkZUZsb2F0aW5nKTtcclxuICAgIGNvbnN0IHNrcmlwdGUgPSB0aGlzLmdldFNob3J0Y3V0U2NyaXB0cz8uKCkgPz8gW107XHJcbiAgICBjb25zdCByZXN1bHQgPSB7fTtcclxuICAgIGZvciAoY29uc3QgW2tleSwgcmVjb3JkXSBvZiBPYmplY3QuZW50cmllcyhzaG9ydGN1dHMpKSB7XHJcbiAgICAgIGNvbnN0IG5hbWUgPSBzY3JpcHROYW1lT2YocmVjb3JkLm5hbWUpO1xyXG4gICAgICBpZiAobmFtZSA9PT0gbnVsbCkgY29udGludWU7XHJcbiAgICAgIGNvbnN0IHNrcmlwdCA9IHNrcmlwdGUuZmluZCgocykgPT4gcy5uYW1lID09PSBuYW1lKTtcclxuICAgICAgcmVzdWx0W2tleV0gPSB7XHJcbiAgICAgICAgbmFtZSxcclxuICAgICAgICBwYXJhbXM6IHNrcmlwdD8ucGFyYW1zID8/IG51bGwsXHJcbiAgICAgICAgYXJnczogeyAuLi4ocmVjb3JkLmFyZ3MgPz8ge30pIH0sXHJcbiAgICAgICAgZmFsbGJhY2s6IGRlZmF1bHRzW2tleV0gPz8gbnVsbCxcclxuICAgICAgfTtcclxuICAgIH1cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbiAgfVxyXG5cclxuICAvLyBGXHUwMEZDciBfb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzOiBtYWNodCBhdXMgZGVyIFBhcmFtZXRlcmxpc3RlIGVpbmVzXHJcbiAgLy8gU2hvcnRjdXRzIGRpZSBBcmd1bWVudGUgZlx1MDBGQ3IgZGVuIEF1ZnJ1ZiB0cC51c2VyLjxuYW1lPih0cCwgLi4uKSAtIHNpZWhlXHJcbiAgLy8gcmVzb2x2ZUNhbGxBcmdzIGluIHNob3J0Y3V0cy5qcy4gRGllIEF1ZmxcdTAwRjZzdW5nIGxlYnQgaGllciBzdGF0dCBpbiBUWVAuanMsXHJcbiAgLy8gZGFtaXQgZGllIFJlZ2VsbiAocmVzZXJ2aWVydGUgTmFtZW4sIFB1bmt0LU5hbWVuIGZcdTAwRkNyIE9iamVrdC1Bcmd1bWVudGUpIG51clxyXG4gIC8vIGFuIGVpbmVyIFN0ZWxsZSBzdGVoZW47IG5ld0ZpbGUgdW5kIGN0eCBrZW5udCBhbGxlcmRpbmdzIG51ciBUWVAuanMgdW5kXHJcbiAgLy8gcmVpY2h0IHNpZSBkZXNoYWxiIGhlcmVpbi5cclxuICByZXNvbHZlU2hvcnRjdXRBcmdzKHBhcmFtcywgYXJncywgeyBuZXdGaWxlID0gbnVsbCwgY3R4ID0gbnVsbCwga2V5ID0gbnVsbCB9ID0ge30pIHtcclxuICAgIHJldHVybiByZXNvbHZlQ2FsbEFyZ3MocGFyYW1zLCBhcmdzLCB7IG5ld0ZpbGUsIGN0eCwga2V5IH0pO1xyXG4gIH1cclxuXHJcbiAgLy8gRlx1MDBGQ3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qczogcmVnaXN0cmllcnRlIFN1YnR5cGVuIGVpbmVzIFRZUHMgaW5cclxuICAvLyBkZXIgUmVpaGVuZm9sZ2UgaWhyZXIgQmxcdTAwRjZja2UsIHNhbXQgTm90aXotQW56YWhsLlxyXG4gIGdldFN1YnR5cGVzKHR5cGUpIHtcclxuICAgIGNvbnN0IHsgY291bnRzIH0gPSB0aGlzLnR5cEluZGV4LnN1YnR5cGVCdWNrZXQodHlwZSk7XHJcbiAgICByZXR1cm4gZ2V0U3VidHlwZU5hbWVzKHRoaXMuc2V0dGluZ3MsIHR5cGUpLm1hcCgoc3VidHlwZSkgPT4gKHsgc3VidHlwZSwgY291bnQ6IGNvdW50cy5nZXQoc3VidHlwZSkgPz8gMCB9KSk7XHJcbiAgfVxyXG5cclxuICAvLyBGXHUwMEZDciBfb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzOiBTdWJ0eXAtUGlja2VyIChzaWVoZVxyXG4gIC8vIHR5cGUtcGlja2VyLmpzKS4gTFx1MDBGNnN0IG1pdCBkZW0gZ2V3XHUwMEU0aGx0ZW4gU3VidHlwIGF1ZiwgbWl0IFwiXCIgZlx1MDBGQ3IgXCJLZWluXHJcbiAgLy8gU3VidHlwXCIgKGJ6dy4gb2huZSBQaWNrZXIsIHdlbm4gZGVyIFRZUCBrZWluZSBTdWJ0eXBlbiBoYXQpLCBvZGVyIG1pdFxyXG4gIC8vIG51bGwgYmVpIEVTQyAoVFlQLmpzIGtlaHJ0IGRhbm4genVyIFRZUC1BdXN3YWhsIHp1clx1MDBGQ2NrKS4gcXVlcnkgKG9wdGlvbmFsKTpcclxuICAvLyBlaW5lIHNjaG9uIGdldGlwcHRlIFN1Y2hhbmZyYWdlLCBuYWNoIGRlciBkaWUgTGlzdGUgdm9yc29ydGllcnQgc3RlaHQuXHJcbiAgcGlja1N1YnR5cGUodHlwZSwgcXVlcnkgPSBcIlwiKSB7XHJcbiAgICByZXR1cm4gcGlja1N1YnR5cGVNb2RhbCh0aGlzLmFwcCwgdGhpcywgdHlwZSwgcXVlcnkpO1xyXG4gIH1cclxuXHJcbiAgLy8gRlx1MDBGQ3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qcywgaW5uZXJoYWxiIHZvbiBwcm9jZXNzRnJvbnRNYXR0ZXI6XHJcbiAgLy8gc2V0enQgVFlQIHVuZCBTVUJUWVAgaW4gZWluaGVpdGxpY2hlciBTY2hyZWlid2Vpc2UgLSBlaW5lIGFid2VpY2hlbmRcclxuICAvLyBnZXNjaHJpZWJlbmUgUHJvcGVydHkgKFwidHlwXCIsIFwiU3VidHlwXCIpIHdpcmQgYW4gaWhyZXIgU3RlbGxlIHVtYmVuYW5udFxyXG4gIC8vIHN0YXR0IHZlcmRvcHBlbHQuIHN1YnR5cGUgbnVsbCBlbnRmZXJudCBlaW5lbiB2b3JoYW5kZW5lbiBTVUJUWVAuXHJcbiAgYXBwbHlUeXBlUHJvcGVydGllcyhmcm9udG1hdHRlciwgdHlwZSwgc3VidHlwZSkge1xyXG4gICAgc2V0Q2Fub25pY2FsUHJvcGVydHkoZnJvbnRtYXR0ZXIsIFRZUF9QUk9QRVJUWSwgdHlwZSk7XHJcbiAgICBpZiAoc3VidHlwZSkgc2V0Q2Fub25pY2FsUHJvcGVydHkoZnJvbnRtYXR0ZXIsIFNVQlRZUF9QUk9QRVJUWSwgc3VidHlwZSk7XHJcbiAgICBlbHNlIGRlbGV0ZVByb3BlcnR5KGZyb250bWF0dGVyLCBTVUJUWVBfUFJPUEVSVFkpO1xyXG4gIH1cclxuXHJcbiAgLy8gRlx1MDBGQ3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qcywgaW5uZXJoYWxiIHZvbiBwcm9jZXNzRnJvbnRNYXR0ZXJcclxuICAvLyB1bmQgbmFjaCBhbGxlbiBcdTAwRkNicmlnZW4gXHUwMEM0bmRlcnVuZ2VuOiBicmluZ3QgZGFzIEZyb250bWF0dGVyIGluIGRpZVxyXG4gIC8vIFJlaWhlbmZvbGdlIGRlciBGcm9udG1hdHRlci1Tb3J0aWVydW5nIChnbG9iYWxlIFJlaWhlbmZvbGdlLCBUWVAtXHJcbiAgLy8gRnJvbnRtYXR0ZXIgc2FtdCBTdWJ0eXAtQmxvY2spIC0gc29uc3QgbGFuZGVuIG5ldSBlcmdcdTAwRTRuenRlIFByb3BlcnRpZXNcclxuICAvLyAoei4gQi4gU1VCVFlQIGluIGVpbmVyIGJlc3RlaGVuZGVuIE5vdGl6KSBhbSBFbmRlLlxyXG4gIHNvcnRGcm9udG1hdHRlcihmcm9udG1hdHRlciwgdHlwZSwgc3VidHlwZSA9IG51bGwpIHtcclxuICAgIHJldHVybiBzb3J0RnJvbnRtYXR0ZXJGb3IodGhpcywgZnJvbnRtYXR0ZXIsIHR5cGUsIHN1YnR5cGUpO1xyXG4gIH1cclxuXHJcbiAgLy8gSW5uZXJoYWxiIHZvbiBwcm9jZXNzRnJvbnRNYXR0ZXI6IHNldHp0IG51ciBkaWUgUHJvcGVydHkga2V5IGFuIGlocmVuXHJcbiAgLy8gUGxhdHogbGF1dCBGcm9udG1hdHRlci1Tb3J0aWVydW5nIChUWVAvU1VCVFlQIGF1cyBkZW0gT2JqZWt0IHNlbGJzdCksXHJcbiAgLy8gYWxsZXMgXHUwMERDYnJpZ2UgYmxlaWJ0LCB3aWUgZXMgaXN0IC0gei4gQi4gZlx1MDBGQ3IgRnJlZHMgUHJvcGVydHktQmFja2xpbmtpbmcsXHJcbiAgLy8gZGFtaXQgZWluZSBuZXUgYW5nZWxlZ3RlIFByb3BlcnR5IG5pY2h0IGFtIEVuZGUgbGFuZGV0LlxyXG4gIHBsYWNlUHJvcGVydHkoZnJvbnRtYXR0ZXIsIGtleSkge1xyXG4gICAgcmV0dXJuIHBsYWNlUHJvcGVydHlGb3IodGhpcywgZnJvbnRtYXR0ZXIsIGtleSk7XHJcbiAgfVxyXG5cclxuICAvLyBGXHUwMEZDciBfb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzOiBkaWUgaW0gVFlQLVZpZXcgcmVnaXN0cmllcnRlbiBUWVBlblxyXG4gIC8vIHNhbXQgaWhyZXIgZG9ydCBnZXBmbGVndGVuIEJlc2NocmVpYnVuZywgc3RhdHQgc2llIGF1cyBfb2JzaWRpYW4vVHlwZW4ubWQgenUgcGFyc2VuIC1cclxuICAvLyBpbiBkZXJzZWxiZW4gUmVpaGVuZm9sZ2UsIGluIGRlciBzaWUgYXVjaCBpbiBkZXIgVFlQLUxpc3RlIHNlbGJzdCBlcnNjaGVpbmVuXHJcbiAgLy8gKGFrdHVlbGxlIFNvcnRpZXJlaW5zdGVsbHVuZyBkb3J0LCB6LiBCLiBIXHUwMEU0dWZpZ2tlaXQgb2RlciBOYW1lKS5cclxuICAvL1xyXG4gIC8vIFRZUGVuIG1pdCBkZWFrdGl2aWVydGVtIFwiTWFudWVsbGVyIFRZUFwiLVNjaGFsdGVyIChzaWVoZSBUWVAtRGV0YWlsYW5zaWNodClcclxuICAvLyBzaW5kIG5pY2h0IGZcdTAwRkNyIGRpZSBtYW51ZWxsZSBBdXN3YWhsIGdlZGFjaHQgKHouIEIuIGJlaW0gQW5sZWdlbiBlaW5lciBuZXVlblxyXG4gIC8vIE5vdGl6KSB1bmQgd2VyZGVuIGRlc2hhbGIgc3RhbmRhcmRtXHUwMEU0XHUwMERGaWcgYXVzZ2VrbGFtbWVydCAtIEF1ZnJ1ZmVyLCBkaWVcclxuICAvLyB0cm90emRlbSBhbGxlIFRZUGVuIGJyYXVjaGVuLCBcdTAwRkNiZXJnZWJlbiBpbmNsdWRlTWFudWFsT2ZmOiB0cnVlLlxyXG4gIGdldFR5cGVzKHsgaW5jbHVkZU1hbnVhbE9mZiA9IGZhbHNlIH0gPSB7fSkge1xyXG4gICAgY29uc3QgeyBjb3VudHMgfSA9IHRoaXMudHlwSW5kZXgudHlwZUNvdW50cygpO1xyXG4gICAgY29uc3Qgc29ydE9yZGVyID0gdGhpcy5zZXR0aW5ncy50eXBTb3J0T3JkZXIgPz8gREVGQVVMVF9TT1JUX09SREVSO1xyXG4gICAgcmV0dXJuIHNvcnRUeXBlc0J5TW9kZSh0aGlzLnNldHRpbmdzLnR5cGVzLCBzb3J0T3JkZXIsIGNvdW50cywgdGhpcy5zZXR0aW5ncy50eXBlQ29sb3JzKVxyXG4gICAgICAuZmlsdGVyKCh0eXBlKSA9PiBpbmNsdWRlTWFudWFsT2ZmIHx8ICh0aGlzLnNldHRpbmdzLnR5cGVNYW51YWwgPz8ge30pW3R5cGVdICE9PSBmYWxzZSlcclxuICAgICAgLm1hcCgodHlwZSkgPT4gKHtcclxuICAgICAgICB0eXBlLFxyXG4gICAgICAgIGRlc2NyaXB0aW9uOiB0aGlzLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV0gPz8gXCJcIixcclxuICAgICAgICBjb3VudDogY291bnRzLmdldCh0eXBlKSA/PyAwLFxyXG4gICAgICB9KSk7XHJcbiAgfVxyXG5cclxuICAvLyBGXHUwMEZDciBfb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzOiBuYXRpdmVyIFRZUC1QaWNrZXIgKHNpZWhlXHJcbiAgLy8gdHlwZS1waWNrZXIuanMpIHN0YXR0IGRlciByZWluZW4gVGV4dC1MaXN0ZSBhdXMgZ2V0VHlwZXMoKSArXHJcbiAgLy8gdHAuc3lzdGVtLnN1Z2dlc3RlciAtIG1pdCBUWVAtRmFyYmUvLVB1bmt0LCBCZXNjaHJlaWJ1bmcgdW5kIE5vdGl6LUFuemFobFxyXG4gIC8vIGplIFplaWxlLiBpbmNsdWRlTWFudWFsT2ZmIHdpZSBiZWkgZ2V0VHlwZXMoKS4gTFx1MDBGNnN0IG1pdCBkZW0gZ2V3XHUwMEU0aGx0ZW4gVFlQXHJcbiAgLy8gYXVmLCBvZGVyIG1pdCBudWxsIGJlaSBBYmJydWNoIChFU0MpLlxyXG4gIHBpY2tUeXBlKG9wdGlvbnMpIHtcclxuICAgIHJldHVybiBwaWNrVHlwZU1vZGFsKHRoaXMuYXBwLCB0aGlzLCBvcHRpb25zKTtcclxuICB9XHJcblxyXG4gIC8vIEZcdTAwRkNyIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanM6IFRZUCB1bmQgU3VidHlwIGluIGVpbmVtIFp1ZyAoc2llaGVcclxuICAvLyB0eXBlLXBpY2tlci5qcykgLSBqZSBuYWNoIEVpbnN0ZWxsdW5nIFwiU3VidHlwLVBpY2tlciBzZXBhcmF0XCIgZWluIGVpbnppZ2VyXHJcbiAgLy8gUGlja2VyIG1pdCBlaW5nZXJcdTAwRkNja3RlbiBTdWJ0eXBlbiBvZGVyIGJlaWRlIFBpY2tlciBuYWNoZWluYW5kZXIuIE9wdGlvbmVuXHJcbiAgLy8gd2llIGJlaSBwaWNrVHlwZSgpLiBMXHUwMEY2c3QgbWl0IHsgdHlwZSwgc3VidHlwZSB9IGF1ZiAoc3VidHlwZSBudWxsIGZcdTAwRkNyIFwib2huZVxyXG4gIC8vIFN1YnR5cFwiKSwgb2RlciBtaXQgbnVsbCBiZWkgQWJicnVjaCAoRVNDKS5cclxuICBwaWNrVHlwZUFuZFN1YnR5cGUob3B0aW9ucykge1xyXG4gICAgcmV0dXJuIHBpY2tUeXBlQW5kU3VidHlwZU1vZGFsKHRoaXMuYXBwLCB0aGlzLCBvcHRpb25zKTtcclxuICB9XHJcblxyXG4gIGFzeW5jIGxvYWRTZXR0aW5ncygpIHtcclxuICAgIGNvbnN0IHN0b3JlZCA9IGF3YWl0IHRoaXMubG9hZERhdGEoKTtcclxuICAgIHRoaXMuc2V0dGluZ3MgPSBPYmplY3QuYXNzaWduKHt9LCBERUZBVUxUX1NFVFRJTkdTLCBzdG9yZWQpO1xyXG4gICAgLy8gT2JqZWN0LmFzc2lnbiBlcnNldHp0IHZlcnNjaGFjaHRlbHRlIE9iamVrdGUgYWxzIEdhbnplcyAtIHNwXHUwMEU0dGVyXHJcbiAgICAvLyBoaW56dWdla29tbWVuZSBBbnNpY2h0ZW4gKHouIEIuIGNvbG9yVmlld3MubGlua3MpIGZlaGx0ZW4gaW4gYmVyZWl0c1xyXG4gICAgLy8gZ2VzcGVpY2hlcnRlbiBFaW5zdGVsbHVuZ2VuIHNvbnN0IHVuZCB3XHUwMEU0cmVuIHN0aWxsc2Nod2VpZ2VuZCBhdXMuXHJcbiAgICB0aGlzLnNldHRpbmdzLmNvbG9yVmlld3MgPSB7IC4uLkRFRkFVTFRfU0VUVElOR1MuY29sb3JWaWV3cywgLi4udGhpcy5zZXR0aW5ncy5jb2xvclZpZXdzIH07XHJcbiAgICAvLyBNaWdyaWVydCBCZXN0YW5kc2luc3RhbGxhdGlvbmVuLCBkZXJlbiBnbG9iYWxQcm9wZXJ0eU9yZGVyIG5vY2ggYXVzIGRlclxyXG4gICAgLy8gWmVpdCB2b3IgXCJUWVAgYWxzIExpc3RlbmVpbnRyYWdcIiBzdGFtbXQgKHNpZWhlIGZyb250bWF0dGVyLXNvcnQuanMpLlxyXG4gICAgdGhpcy5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyID0gbm9ybWFsaXplR2xvYmFsT3JkZXIodGhpcy5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyKTtcclxuICAgIG1pZ3JhdGVGbG9hdGluZ0Zyb250bWF0dGVyKHRoaXMuc2V0dGluZ3MpO1xyXG4gICAgLy8gU3VidHlwLUJsXHUwMEY2Y2tlIGxhZ2VuIGZyXHUwMEZDaGVyIHdhaGx3ZWlzZSBcdTAwRkNiZXIgZGVtIFRZUC1Gcm9udG1hdHRlcjsgZGFzIHN0ZWh0XHJcbiAgICAvLyBqZXR6dCBmZXN0IGdhbnogb2JlbiAoc2llaGUgZ2V0U2VjdGlvbk9yZGVyIGluIHN1YnR5cGVzLmpzKS5cclxuICAgIG1pZ3JhdGVBYm92ZVN0YW5kYXJkKHRoaXMuc2V0dGluZ3MpO1xyXG4gICAgLy8gQW5kZXJzIGFscyBkaWUgXHUwMEZDYnJpZ2VuIE1pZ3JhdGlvbmVuIGdsZWljaCBzY2hyZWliZW46IGRpZSBlaW5lIHJlY2huZXRcclxuICAgIC8vIGdlc3BlaWNoZXJ0ZSBaYWhsZW4gdW0gdW5kIGRhcmYgZGFzIGJlaW0gblx1MDBFNGNoc3RlbiBTdGFydCBuaWNodCBlcm5ldXQgdHVuLFxyXG4gICAgLy8gZGllIGFuZGVyZSBlbnRmZXJudCBlaW5lbiBTY2hsXHUwMEZDc3NlbCwgZGVyIHNvbnN0IGJlaSBqZWRlbSBTdGFydCB3aWVkZXJcclxuICAgIC8vIGdlbGVzZW4gd1x1MDBGQ3JkZS5cclxuICAgIGNvbnN0IG1pZ3JhdGVkID0gW21pZ3JhdGVTdWJ0eXBlQ29sb3JTY2FsZSh0aGlzLnNldHRpbmdzLCBERUZBVUxUX1NVQlRZUEVfQ09MT1JfUkFOR0VTKSwgbWlncmF0ZVR5cExpc3RTZWNvbmRhcnkodGhpcy5zZXR0aW5ncywgc3RvcmVkKSwgZHJvcFR5cExpc3RTdWJ0eXBlc0FsaWduKHRoaXMuc2V0dGluZ3MpXTtcclxuICAgIGlmIChtaWdyYXRlZC5zb21lKEJvb2xlYW4pKSBhd2FpdCB0aGlzLnNhdmVTZXR0aW5ncygpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgc2F2ZVNldHRpbmdzKCkge1xyXG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcclxuICB9XHJcbn07XHJcbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7OztBQUFBO0FBQUEscUJBQUFBLFVBQUFDLFNBQUE7QUFBQSxRQUFNLEVBQUUsUUFBUSxPQUFPLFNBQVMsSUFBSSxRQUFRLFVBQVU7QUFFdEQsUUFBTUMsZ0JBQWU7QUFDckIsUUFBTUMsbUJBQWtCO0FBQ3hCLFFBQU0sY0FBYyxPQUFPLE9BQU8sRUFBRSxTQUFTLE1BQU0sU0FBUyxNQUFNLFlBQVksTUFBTSxZQUFZLEtBQUssQ0FBQztBQUt0RyxRQUFNLGlCQUFpQjtBQUV2QixhQUFTLFFBQVEsT0FBTztBQUN0QixVQUFJLFNBQVMsS0FBTSxRQUFPO0FBQzFCLGFBQU8sT0FBTyxVQUFVLFdBQVcsS0FBSyxVQUFVLEtBQUssSUFBSSxPQUFPLEtBQUs7QUFBQSxJQUN6RTtBQVlBLGFBQVMsVUFBVSxPQUFPO0FBQ3hCLFVBQUksTUFBTSxRQUFRLEtBQUssR0FBRztBQUN4QixjQUFNLFFBQVEsTUFBTSxJQUFJLE9BQU87QUFDL0IsWUFBSSxNQUFNLE1BQU0sQ0FBQyxTQUFTLEtBQUssS0FBSyxNQUFNLEVBQUUsRUFBRyxRQUFPO0FBQ3RELGVBQU8sSUFBSSxNQUFNLEtBQUssSUFBSSxDQUFDO0FBQUEsTUFDN0I7QUFDQSxZQUFNLE9BQU8sUUFBUSxLQUFLO0FBQzFCLGFBQU8sS0FBSyxLQUFLLE1BQU0sS0FBSyxPQUFP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QkFBeUIsS0FBSyxVQUFVLDRCQUE0QixHQUFHLHdCQUF3QixLQUFLLFVBQVUsTUFBTSxHQUFHLHlCQUF5QixLQUFLLFFBQVEsQ0FBQztBQUNoTCxRQUFJLFNBQVMsS0FBSyxPQUFPLEVBQUcsT0FBTSxLQUFLLGFBQWE7QUFBQSxFQUN0RDtBQUFBLEVBRUEsTUFBTSxlQUFlO0FBQ25CLFVBQU0sS0FBSyxTQUFTLEtBQUssUUFBUTtBQUFBLEVBQ25DO0FBQ0Y7IiwKICAibmFtZXMiOiBbImV4cG9ydHMiLCAibW9kdWxlIiwgIlRZUF9QUk9QRVJUWSIsICJTVUJUWVBfUFJPUEVSVFkiLCAic2V0Q2Fub25pY2FsUHJvcGVydHkiLCAiZGVsZXRlUHJvcGVydHkiLCAiVHlwSW5kZXgiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAic2V0Q2Fub25pY2FsUHJvcGVydHkiLCAiU1VCVFlQX1BST1BFUlRZIiwgImdldFN1YnR5cGVOYW1lcyIsICJnZXRTdWJ0eXBlIiwgIm1pZ3JhdGVBYm92ZVN0YW5kYXJkIiwgIm1pZ3JhdGVTdWJ0eXBlQ29sb3JTY2FsZSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXBlIiwgIlRZUF9QUk9QRVJUWSIsICJTVUJUWVBfUFJPUEVSVFkiLCAibm9ybWFsaXplR2xvYmFsT3JkZXIiLCAic29ydEZyb250bWF0dGVyRm9yIiwgInBsYWNlUHJvcGVydHlGb3IiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXBlIiwgIkRFRkFVTFRfU1VCVFlQRV9DT0xPUl9SQU5HRVMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiREVGQVVMVF9TVUJUWVBFX0NPTE9SX1JBTkdFUyIsICJERUZBVUxUX1NFVFRJTkdTIiwgIlR5cFN5c3RlbVNldHRpbmdUYWIiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJDb21tYW5kcyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJzY3JpcHROYW1lT2YiLCAicmVzb2x2ZUNhbGxBcmdzIiwgInJlc29sdmVTaG9ydGN1dHMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZ2V0U3VidHlwZSIsICJUWVBfUFJPUEVSVFkiLCAiU1VCVFlQX1BST1BFUlRZIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInNvcnRUeXBlc0J5TW9kZSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXBlTmFtZXMiLCAiZ2V0U3VidHlwZSIsICJzb3J0VHlwZXNCeU1vZGUiLCAic2V0Q2Fub25pY2FsUHJvcGVydHkiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJERUZBVUxUX1NPUlRfT1JERVIiLCAicmVnaXN0ZXJUeXBWaWV3IiwgImxlYWYiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJGaWxlRXhwbG9yZXJDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJHcmFwaENvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlclNlYXJjaENvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlclJlY2VudEZpbGVzQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyQmFja2xpbmtDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJCb29rbWFya3NDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZ2V0U3VidHlwZSIsICJyZWdpc3RlckFjdGl2ZVRpdGxlQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyTGlua0NvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXBlTmFtZXMiLCAiZ2V0U3VidHlwZSIsICJUWVBfUFJPUEVSVFkiLCAiZmxvYXRpbmciLCAicmVnaXN0ZXJGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZ2V0U3VidHlwZU5hbWVzIiwgIlRZUF9QUk9QRVJUWSIsICJTVUJUWVBfUFJPUEVSVFkiLCAicmVnaXN0ZXJQcm9wZXJ0eVJlbmFtZVN5bmMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiREVGQVVMVF9TT1JUX09SREVSIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyU2hvcnRjdXRTY3JpcHRzIl0KfQo=
