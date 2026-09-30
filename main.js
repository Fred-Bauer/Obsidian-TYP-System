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
        const query = type === null ? `-["${TYP_PROPERTY2}"] file:.md` : this.typeClause(type);
        globalSearch.instance.openGlobalSearch(query);
      }
      // Suchklausel für einen TYP-Schlüssel. Für eine Liste (unregistrierter
      // Schlüssel "[A, B]") gibt es keine exakte Suchsyntax - dann nach Notizen
      // suchen, die alle ihre Einträge tragen. Auch von openSubtypeSearch()
      // genutzt: seit die nicht erfassten Subtypen in der Liste stehen, kann dort
      // auch ein nicht erfasster (und damit unsauberer) TYP-Schlüssel ankommen.
      typeClause(type) {
        const raw = this.plugin.typIndex.rawValueOf(type);
        return Array.isArray(raw) ? raw.map((v) => `["${TYP_PROPERTY2}":"${String(v ?? "").trim()}"]`).join(" ") : `["${TYP_PROPERTY2}":"${type}"]`;
      }
      // typeKey kommt 1:1 aus den tatsächlichen Frontmatter-Werten (siehe
      // unregisteredRows in render() und typeKeyOf in typ-index.js) - kann also
      // klein geschrieben sein, Randleerzeichen tragen oder eine Liste sein. TYPen
      // werden aber immer als sauberer Einzelwert in Großbuchstaben geführt -
      // registriert wird deshalb die bereinigte Form (siehe normalizeRawType), und
      // die betroffenen Notizen werden gleich mit umgeschrieben, damit sie nicht
      // weiterhin als "nicht registriert" auftauchen.
      async registerType(typeKey) {
        const result = await this.applyTypeRegistration(typeKey);
        if (!result) return;
        await this.plugin.saveSettings();
        this.render();
        this.plugin.refreshTypColors?.();
        if (result.renamed > 0) {
          new Notice(`TYP ${result.type} registriert, ${result.renamed} Notiz(en) angepasst.`);
        }
      }
      // Der eigentliche Vorgang aus registerType(), ohne Speichern, Neuzeichnen
      // und Notice: so kann registerTypeWithSubtype() TYP und Subtyp nacheinander
      // eintragen und danach EINMAL speichern und EINE Notice zeigen, statt zweimal.
      // Liefert { type, renamed } oder null, wenn nichts Brauchbares übrig bleibt.
      async applyTypeRegistration(typeKey) {
        const raw = this.plugin.typIndex.rawValueOf(typeKey);
        const normalized = normalizeRawType(raw === void 0 ? typeKey : raw);
        if (!normalized) return null;
        if (!this.plugin.settings.types.includes(normalized)) {
          this.plugin.settings.types.push(normalized);
        }
        const renamed = normalized !== typeKey ? await renameTypeInNotes(this.plugin, typeKey, normalized) : 0;
        return { type: normalized, renamed };
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
          const unregisteredSubtypeRows = this.unregisteredSubtypeRows();
          const listCls = "fred-typ-list nav-files-container" + (this.secondaryMode() === "none" ? " fred-typ-list-no-secondary" : "");
          this.listEl = contentEl.createDiv({ cls: listCls });
          this.separatorEl = null;
          const registeredOrder = sortTypesByMode2(registered, sortOrder, counts, typeColors);
          registeredOrder.forEach((type, index) => {
            this.renderRegisteredItem(type, counts.get(type) ?? 0, { draggable: isManualSort, index });
          });
          const separator = () => {
            const el = this.listEl.createDiv({ cls: "fred-typ-separator" });
            this.separatorEl = this.separatorEl ?? el;
          };
          if (unregisteredRows.length > 0 || unregisteredSubtypeRows.length > 0 || noType > 0) separator();
          for (const row of unregisteredRows) this.renderUnregisteredItem(row.type, row.count);
          if (unregisteredSubtypeRows.length > 0) {
            if (unregisteredRows.length > 0) separator();
            for (const row of unregisteredSubtypeRows) this.renderUnregisteredSubtypeItem(row);
          }
          if (noType > 0) this.renderNoTypeItem(noType);
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
      // Alle SUBTYP-Werte, die in Notizen vorkommen, aber unter ihrem TYP nicht
      // erfasst sind - über den ganzen Vault, nicht nur für einen TYP wie
      // renderUnregisteredSubtypes() in der Detailansicht. Der Index führt seine
      // Buckets über ALLE TYP-Schlüssel, also auch über nicht erfasste; deren
      // Subtypen kommen daher mit (Klick erfasst dann beides, siehe
      // registerTypeWithSubtype).
      //
      // Sortiert nach Anzahl, dann nach dem Zeilentext von links nach rechts (erst
      // TYP, dann Subtyp) - dieselbe Regel wie in der Detailansicht, wo das
      // Häufigste oben steht. Bewusst NICHT nach dem Sortier-Button der Liste:
      // "Farbe" und "Manuell" haben für nicht erfasste Werte keine Bedeutung.
      //
      // Eine Notiz ohne TYP bleibt außen vor - der Index verwirft ihren SUBTYP
      // schon beim Zählen (siehe aggregate() in typ-index.js), ein SUBTYP ohne TYP
      // hat keinen Kontext.
      unregisteredSubtypeRows() {
        const registered = this.plugin.settings.types;
        const rows = [];
        for (const [type, bucket] of this.plugin.typIndex.subtypeCounts()) {
          const known = getSubtypeNames2(this.plugin.settings, type);
          for (const [subtype, count] of bucket.counts) {
            if (known.includes(subtype)) continue;
            rows.push({ type, subtype, count, typeRegistered: registered.includes(type) });
          }
        }
        return rows.sort((a, b) => b.count - a.count || a.type.localeCompare(b.type) || a.subtype.localeCompare(b.subtype));
      }
      // "NOTIZ / Kurz Geschichte" - der Subtyp allein wäre mehrdeutig, denselben
      // Namen kann es unter mehreren TYPen geben. Ist der TYP bereits erfasst,
      // trägt sein Teil der Zeile seine Farbe (bzw. einen Farbpunkt davor, je nach
      // Einstellung "TYP View einfärben") - abgeschwächt über das Style Setting
      // "Farbe erfasster TYPen in dieser Liste", damit die Zeilen trotz Farbe
      // hinter den erfassten TYPen oben zurückbleiben. Ist auch der TYP nicht
      // erfasst, bleibt die ganze Zeile muted wie die Einträge darüber.
      renderUnregisteredSubtypeItem({ type, subtype, count, typeRegistered }) {
        const treeItem = this.listEl.createDiv({ cls: "tree-item" });
        const self = treeItem.createDiv({ cls: "tree-item-self is-clickable fred-typ-unregistered" });
        const colorize = this.plugin.settings.colorViews.typList;
        const { color, isDefault } = nameColor(this.plugin.settings, type);
        if (typeRegistered && !colorize) {
          const wrap = self.createDiv({ cls: "fred-typ-color-wrap fred-typ-unregistered-subtype-color" });
          paintColorDot(wrap.createDiv({ cls: "fred-typ-color-dot" }), color, isDefault);
        }
        const inner = self.createDiv({ cls: "tree-item-inner" });
        const typeEl = inner.createSpan({ cls: "fred-typ-unregistered-subtype-type", text: displayTypeKey(type) });
        if (typeRegistered && colorize && !isDefault) {
          typeEl.style.color = color;
          typeEl.addClass("fred-typ-unregistered-subtype-color");
        }
        inner.createSpan({ cls: "fred-typ-unregistered-subtype-slash", text: " / " });
        inner.createSpan({ text: displayTypeKey(subtype) });
        this.renderCountFlair(self, count);
        self.addEventListener("click", () => this.registerTypeWithSubtype(type, subtype));
        self.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.openSubtypeSearch(type, subtype);
        });
      }
      // Klick auf eine solche Zeile: erfasst den Subtyp - und, falls nötig, seinen
      // TYP gleich mit. Reihenfolge zwingend erst TYP, dann Subtyp: das Erfassen
      // eines TYPs kann dessen Wert in den Notizen bereinigen (" buch" → "BUCH"),
      // danach muss der Subtyp-Abgleich schon den NEUEN TYP-Namen verwenden, sonst
      // findet renameSubtypeInNotes() keine Datei mehr.
      //
      // Beides zusammen wird direkt ausgeführt, ohne Bestätigung: es ist eine
      // reine Erfassung. Notizen ändern sich nur, wenn der Rohwert unsauber war und
      // dabei bereinigt wird - ein sauberer Wert fasst keine einzige Datei an.
      async registerTypeWithSubtype(typeKey, subtypeKey) {
        const bucket = this.plugin.typIndex.subtypeBucket(typeKey);
        const typeResult = this.plugin.settings.types.includes(typeKey) ? { type: typeKey, renamed: 0 } : await this.applyTypeRegistration(typeKey);
        if (!typeResult) return;
        const subtypeResult = await this.applySubtypeRegistration(typeResult.type, subtypeKey, bucket);
        await this.plugin.saveSettings();
        this.render();
        this.plugin.refreshTypColors?.();
        if (!subtypeResult) return;
        const parts = [];
        if (typeResult.type !== typeKey) parts.push(`TYP ${typeResult.type}`);
        parts.push(`SUBTYP ${subtypeResult.subtype}`);
        const changed = typeResult.renamed + subtypeResult.renamed;
        new Notice(`${parts.join(" und ")} registriert${changed > 0 ? `, ${changed} Notiz(en) angepasst` : ""}.`);
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
        const typClause = this.typeClause(type);
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
        const result = await this.applySubtypeRegistration(type, subtypeKey, bucket);
        if (!result) return;
        await this.plugin.saveSettings();
        this.plugin.refreshTypColors?.();
        if (result.renamed > 0) new Notice(`SUBTYP ${result.subtype} registriert, ${result.renamed} Notiz(en) angepasst.`);
      }
      // Wie applyTypeRegistration für den TYP: der Vorgang ohne Speichern und
      // Notice, damit registerTypeWithSubtype() ihn mit der TYP-Erfassung bündeln
      // kann. Liefert { subtype, renamed } oder null.
      async applySubtypeRegistration(type, subtypeKey, bucket) {
        const raw = bucket.rawByKey.get(subtypeKey);
        const normalized = normalizeRawType(raw === void 0 ? subtypeKey : raw, normalizeSubtypeName);
        if (!normalized) return null;
        const existing = getSubtypeNames2(this.plugin.settings, type).find((name) => name.toLowerCase() === normalized.toLowerCase());
        const subtype = existing ?? normalized;
        ensureSubtype(this.plugin.settings, type, subtype);
        const renamed = subtype !== subtypeKey ? await renameSubtypeInNotes(this.plugin, type, subtypeKey, subtype) : 0;
        return { subtype, renamed };
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL3R5cC1pbmRleC5qcyIsICJzcmMvc3VidHlwZXMuanMiLCAic3JjL2Zyb250bWF0dGVyLXNvcnQuanMiLCAic3JjL2Zyb250bWF0dGVyLW9yZGVyLWVkaXRvci5qcyIsICJzcmMvdHlwZS1jb2xvcnMuanMiLCAic3JjL3NldHRpbmdzLmpzIiwgInNyYy9jb21tYW5kcy5qcyIsICJzcmMvc2hvcnRjdXRzLmpzIiwgInNyYy9zaG9ydGN1dC1waWNrZXIuanMiLCAic3JjL3R5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzIiwgInNyYy9mcm9udG1hdHRlci1ibG9ja3MuanMiLCAic3JjL3R5cGUtdXRpbHMuanMiLCAic3JjL3R5cC12aWV3LmpzIiwgInNyYy9maWxlLWV4cGxvcmVyLWNvbG9ycy5qcyIsICJzcmMvZ3JhcGgtY29sb3JzLmpzIiwgInNyYy9zZWFyY2gtY29sb3JzLmpzIiwgInNyYy9yZWNlbnQtZmlsZXMtY29sb3JzLmpzIiwgInNyYy9iYWNrbGluay1jb2xvcnMuanMiLCAic3JjL2Jvb2ttYXJrLWNvbG9ycy5qcyIsICJzcmMvYWN0aXZlLXRpdGxlLWNvbG9ycy5qcyIsICJzcmMvbGluay1jb2xvcnMuanMiLCAic3JjL2Zyb250bWF0dGVyLWRlZmF1bHQtaGlnaGxpZ2h0LmpzIiwgInNyYy9wcm9wZXJ0eS1yZW5hbWUtc3luYy5qcyIsICJzcmMvdHlwZS1waWNrZXIuanMiLCAic3JjL3Nob3J0Y3V0LXNjcmlwdHMuanMiLCAic3JjL21haW4uanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IHsgRXZlbnRzLCBURmlsZSwgZGVib3VuY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcblxuY29uc3QgVFlQX1BST1BFUlRZID0gXCJUWVBcIjtcbmNvbnN0IFNVQlRZUF9QUk9QRVJUWSA9IFwiU1VCVFlQXCI7XG5jb25zdCBFTVBUWV9FTlRSWSA9IE9iamVjdC5mcmVlemUoeyB0eXBlS2V5OiBudWxsLCByYXdUeXBlOiBudWxsLCBzdWJ0eXBlS2V5OiBudWxsLCByYXdTdWJ0eXBlOiBudWxsIH0pO1xuXG4vLyBTYW1tZWx0IFx1MDBDNG5kZXJ1bmdlbiBtZWhyZXJlciBEYXRlaWVuICh6LiBCLiBVbWJlbmVubmVuIGVpbmVzIFRZUHMgaW4gdmllbGVuXG4vLyBOb3RpemVuLCBWYXVsdC1TeW5jKSB6dSBlaW5lbSBlaW56aWdlbiBcImNoYW5nZVwiLUV2ZW50LiBPaG5lIHJlc2V0VGltZXIsIGRhbWl0XG4vLyBlaW4gRGF1ZXJzdHJvbSBhbiBcdTAwQzRuZGVydW5nZW4gdHJvdHpkZW0gcmVnZWxtXHUwMEU0XHUwMERGaWcgZHVyY2hnZXJlaWNodCB3aXJkLlxuY29uc3QgRkxVU0hfREVMQVlfTVMgPSAxMDA7XG5cbmZ1bmN0aW9uIHJhd0l0ZW0odmFsdWUpIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBcIlwiO1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiID8gSlNPTi5zdHJpbmdpZnkodmFsdWUpIDogU3RyaW5nKHZhbHVlKTtcbn1cblxuLy8gRWluaGVpdGxpY2hlIEF1c2xlZ3VuZyBlaW5lcyBUWVAtV2VydHMgZlx1MDBGQ3IgZGFzIGdhbnplIFBsdWdpbjogZGVyIFdlcnQgd2lyZFxuLy8gYmV3dXNzdCBOSUNIVCBnZWdsXHUwMEU0dHRldCwgc29uZGVybiBpbiBzZWluZXIgUm9oZm9ybSB6dW0gU2NobFx1MDBGQ3NzZWwgLSBlaW4gVFlQIGlzdFxuLy8gZ2VuYXUgZWluIGVpbnplbG5lciwgc2F1YmVyZXIgV2VydC4gQWxsZXMgYW5kZXJlIChMZWVyemVpY2hlbiBhbSBSYW5kLCBrbGVpblxuLy8gZ2VzY2hyaWViZW4sIExpc3RlIC0gYXVjaCBlaW5lIGVpbmVsZW1lbnRpZ2UpIGVyZ2lidCBlaW5lbiBlaWdlbmVuIFNjaGxcdTAwRkNzc2VsLFxuLy8gZGVyIGluIGtlaW5lbSByZWdpc3RyaWVydGVuIFRZUCBhdWZnZWh0OiBlciBiZWtvbW10IGtlaW5lIEZhcmJlLCB6XHUwMEU0aGx0IG5pY2h0XG4vLyBiZWltIFwicmljaHRpZ2VuXCIgVFlQIG1pdCB1bmQgc3RlaHQgaW4gZGVyIFRZUC1WaWV3IGFscyBlaWdlbmVyLFxuLy8gdW5yZWdpc3RyaWVydGVyIEVpbnRyYWcsIHZvbiB3byBhdXMgZXIgc2ljaCBwZXIgS2xpY2sgYmVyZWluaWdlbiBsXHUwMEU0c3N0XG4vLyAoc2llaGUgcmVnaXN0ZXJUeXBlIGluIHR5cC12aWV3LmpzKS4gTGlzdGVuIGVyc2NoZWluZW4gZGFiZWkgYWxzXG4vLyBcIltBLCBCXVwiIHVuZCBrXHUwMEY2bm5lbiBzbyBuaWUgbWl0IGVpbmVtIEVpbnplbHdlcnQgXCJBLCBCXCIgenVzYW1tZW5mYWxsZW4uXG4vLyBudWxsID0ga2VpbiBUWVAgKGZlaGxlbmQsIGxlZXIsIG51ciBMZWVyemVpY2hlbiwgbGVlcmUgTGlzdGUpLlxuZnVuY3Rpb24gdHlwZUtleU9mKHZhbHVlKSB7XG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgIGNvbnN0IGl0ZW1zID0gdmFsdWUubWFwKHJhd0l0ZW0pO1xuICAgIGlmIChpdGVtcy5ldmVyeSgoaXRlbSkgPT4gaXRlbS50cmltKCkgPT09IFwiXCIpKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gYFske2l0ZW1zLmpvaW4oXCIsIFwiKX1dYDtcbiAgfVxuICBjb25zdCB0ZXh0ID0gcmF3SXRlbSh2YWx1ZSk7XG4gIHJldHVybiB0ZXh0LnRyaW0oKSA9PT0gXCJcIiA/IG51bGwgOiB0ZXh0O1xufVxuXG4vLyBPYnNpZGlhbiBiZWhhbmRlbHQgUHJvcGVydHktTmFtZW4gb2huZSBCZWFjaHR1bmcgZGVyIEdyb1x1MDBERi0vS2xlaW5zY2hyZWlidW5nXG4vLyAoXCJTdWJ0eXBcIiB1bmQgXCJTVUJUWVBcIiBzaW5kIGluIFwiQWxsIHByb3BlcnRpZXNcIiBkaWVzZWxiZSBQcm9wZXJ0eSkgLSBUWVBcbi8vIHVuZCBTVUJUWVAgd2VyZGVuIGRlc2hhbGIgZ2VuYXVzbyBnZWxlc2VuLiBEaWUgZXhha3RlIFNjaHJlaWJ3ZWlzZSBoYXRcbi8vIFZvcnJhbmcsIGZhbGxzIGVpbmUgTm90aXogKGZlaGxlcmhhZnQpIG1laHJlcmUgVmFyaWFudGVuIHRyXHUwMEU0Z3QuXG5mdW5jdGlvbiBwcm9wZXJ0eUtleU9mKGZyb250bWF0dGVyLCBuYW1lKSB7XG4gIGlmICghZnJvbnRtYXR0ZXIpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoZnJvbnRtYXR0ZXIsIG5hbWUpKSByZXR1cm4gbmFtZTtcbiAgY29uc3QgbG93ZXIgPSBuYW1lLnRvTG93ZXJDYXNlKCk7XG4gIHJldHVybiBPYmplY3Qua2V5cyhmcm9udG1hdHRlcikuZmluZCgoa2V5KSA9PiBrZXkudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXIpO1xufVxuXG5mdW5jdGlvbiBwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBuYW1lKSB7XG4gIGNvbnN0IGtleSA9IHByb3BlcnR5S2V5T2YoZnJvbnRtYXR0ZXIsIG5hbWUpO1xuICByZXR1cm4ga2V5ID09PSB1bmRlZmluZWQgPyB1bmRlZmluZWQgOiBmcm9udG1hdHRlcltrZXldO1xufVxuXG4vLyBTY2hyZWlidCB2YWx1ZSB1bnRlciBkZXIgZWluaGVpdGxpY2hlbiBTY2hyZWlid2Vpc2UgbmFtZSAoei4gQi4gXCJTVUJUWVBcIilcbi8vIGluIGRhcyB2b24gcHJvY2Vzc0Zyb250TWF0dGVyIGdlbGllZmVydGUgT2JqZWt0LiBFaW5lIGFid2VpY2hlbmRcbi8vIGdlc2NocmllYmVuZSBWYXJpYW50ZSAoXCJTdWJ0eXBcIikgd2lyZCBkYWJlaSBhbiBPcnQgdW5kIFN0ZWxsZSB1bWJlbmFubnQgLVxuLy8gT2JqZWt0LUluc2VydGlvbi1PcmRlciBiZXN0aW1tdCBkaWUgWUFNTC1SZWloZW5mb2xnZSwgZGFoZXIgYmVpIEJlZGFyZiBhbGxlXG4vLyBLZXlzIGluIGJpc2hlcmlnZXIgUmVpaGVuZm9sZ2UgbmV1IGVpbmZcdTAwRkNnZW4gKHdpZSBpbiBmcm9udG1hdHRlci1zb3J0LmpzKS5cbmZ1bmN0aW9uIHNldENhbm9uaWNhbFByb3BlcnR5KGZyb250bWF0dGVyLCBuYW1lLCB2YWx1ZSkge1xuICBjb25zdCBsb3dlciA9IG5hbWUudG9Mb3dlckNhc2UoKTtcbiAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKGZyb250bWF0dGVyKTtcbiAgaWYgKCFrZXlzLnNvbWUoKGtleSkgPT4ga2V5ICE9PSBuYW1lICYmIGtleS50b0xvd2VyQ2FzZSgpID09PSBsb3dlcikpIHtcbiAgICBmcm9udG1hdHRlcltuYW1lXSA9IHZhbHVlO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBzbmFwc2hvdCA9IHsgLi4uZnJvbnRtYXR0ZXIgfTtcbiAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykgZGVsZXRlIGZyb250bWF0dGVyW2tleV07XG4gIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICBpZiAoa2V5LnRvTG93ZXJDYXNlKCkgIT09IGxvd2VyKSBmcm9udG1hdHRlcltrZXldID0gc25hcHNob3Rba2V5XTtcbiAgICBlbHNlIGlmICghKG5hbWUgaW4gZnJvbnRtYXR0ZXIpKSBmcm9udG1hdHRlcltuYW1lXSA9IHZhbHVlO1xuICB9XG59XG5cbi8vIEVudGZlcm50IG5hbWUgaW4gamVkZXIgU2NocmVpYndlaXNlIGF1cyBkZW0gdm9uIHByb2Nlc3NGcm9udE1hdHRlclxuLy8gZ2VsaWVmZXJ0ZW4gT2JqZWt0LlxuZnVuY3Rpb24gZGVsZXRlUHJvcGVydHkoZnJvbnRtYXR0ZXIsIG5hbWUpIHtcbiAgY29uc3QgbG93ZXIgPSBuYW1lLnRvTG93ZXJDYXNlKCk7XG4gIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGZyb250bWF0dGVyKSkge1xuICAgIGlmIChrZXkudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXIpIGRlbGV0ZSBmcm9udG1hdHRlcltrZXldO1xuICB9XG59XG5cbi8vIFNVQlRZUCB3aXJkIGdlbmF1c28gYXVzZ2VsZWd0ICh0eXBlS2V5T2YpOiBlaW5lIE5vdGl6IGhhdCBoXHUwMEY2Y2hzdGVucyBlaW5lblxuLy8gU1VCVFlQIGFscyBzYXViZXJlbiBFaW56ZWx3ZXJ0LCBhbGxlcyBhbmRlcmUgaXN0IGVpbiBlaWdlbmVyLCBuaWNodFxuLy8gZXJmYXNzdGVyIFNjaGxcdTAwRkNzc2VsIChzaWVoZSBTdWJ0eXAtQmxcdTAwRjZja2UgaW4gZGVyIFRZUC1EZXRhaWxhbnNpY2h0KS5cbmZ1bmN0aW9uIHNhbWVFbnRyeShhLCBiKSB7XG4gIHJldHVybiAhIWEgJiYgISFiICYmIGEudHlwZUtleSA9PT0gYi50eXBlS2V5ICYmIGEuc3VidHlwZUtleSA9PT0gYi5zdWJ0eXBlS2V5O1xufVxuXG4vLyBaZW50cmFsZXIgVFlQLS9TVUJUWVAtSW5kZXggXHUwMEZDYmVyIGFsbGUgTWFya2Rvd24tRGF0ZWllbiAoUGZhZCAtPiBXZXJ0ZSkuXG4vL1xuLy8gWndlY2s6IGRpZSBGYXJiLU1vZHVsZSBoaW5nZW4gYmlzaGVyIGFsbGUgZGlyZWt0IGFuIG1ldGFkYXRhQ2FjaGUgXCJjaGFuZ2VkXCJcbi8vIHVuZCBcInJlc29sdmVkXCIgLSBiZWlkZSBmZXVlcm4gYmVpIEpFREVSIFx1MDBDNG5kZXJ1bmcgYW4gaXJnZW5kZWluZXIgTm90aXogKGJlaW1cbi8vIFRpcHBlbiBldHdhIGFsbGUgendlaSBTZWt1bmRlbiksIHVuZCBqZWRlcyBNb2R1bCBmXHUwMEU0cmJ0ZSBkYXJhdWZoaW4gc2VpbmVcbi8vIGtvbXBsZXR0ZSBBbnNpY2h0IG5ldSwgZG9wcGVsdC4gRGVyIEluZGV4IHZlcmdsZWljaHQgc3RhdHRkZXNzZW4gamUgRGF0ZWksIG9iXG4vLyBzaWNoIFRZUCBvZGVyIFNVQlRZUCB0YXRzXHUwMEU0Y2hsaWNoIGdlXHUwMEU0bmRlcnQgaGF0IChiencuIGVpbmUgTm90aXogaGluenVrYW0vXG4vLyB3ZWdmaWVsKSwgdW5kIGZldWVydCBudXIgZGFubiBzZWluIGVpZ2VuZXMgXCJjaGFuZ2VcIi1FdmVudCAoQXJndW1lbnQ6IFNldCBkZXJcbi8vIGJldHJvZmZlbmVuIFBmYWRlKS4gTm9ybWFsZXMgU2NocmVpYmVuIGxcdTAwRjZzdCBkYW1pdCBnYXIga2VpbiBOZXUtRWluZlx1MDBFNHJiZW4gbWVociBhdXMuXG4vL1xuLy8gWnVzXHUwMEU0dHpsaWNoIGhcdTAwRTRsdCBlciBkaWUgdmF1bHQtd2VpdGVuIFpcdTAwRTRobHVuZ2VuIChUWVAtTGlzdGUsIFNVQlRZUC1MaXN0ZSxcbi8vIFBpY2tlciwgZ2V0VHlwZXMoKSBmXHUwMEZDciBUZW1wbGF0ZXIpIHp3aXNjaGVuZ2VzcGVpY2hlcnQsIHN0YXR0IHNpZSBiZWkgamVkZW1cbi8vIEF1ZnJ1ZiBwZXIgU2NhbiBcdTAwRkNiZXIgYWxsZSBOb3RpemVuIG5ldSB6dSBiZXJlY2huZW4uXG5jbGFzcyBUeXBJbmRleCBleHRlbmRzIEV2ZW50cyB7XG4gIGNvbnN0cnVjdG9yKHBsdWdpbikge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gICAgdGhpcy5hcHAgPSBwbHVnaW4uYXBwO1xuICAgIHRoaXMuZW50cmllcyA9IG5ldyBNYXAoKTtcbiAgICB0aGlzLmJ1aWx0ID0gZmFsc2U7XG4gICAgdGhpcy5hZ2dyZWdhdGVzID0gbnVsbDtcbiAgICB0aGlzLnBlbmRpbmdQYXRocyA9IG5ldyBTZXQoKTtcbiAgICB0aGlzLmZsdXNoID0gZGVib3VuY2UoKCkgPT4ge1xuICAgICAgY29uc3QgcGF0aHMgPSB0aGlzLnBlbmRpbmdQYXRocztcbiAgICAgIHRoaXMucGVuZGluZ1BhdGhzID0gbmV3IFNldCgpO1xuICAgICAgdGhpcy50cmlnZ2VyKFwiY2hhbmdlXCIsIHBhdGhzKTtcbiAgICB9LCBGTFVTSF9ERUxBWV9NUyk7XG4gIH1cblxuICByZWdpc3RlcigpIHtcbiAgICBjb25zdCB7IHBsdWdpbiwgYXBwIH0gPSB0aGlzO1xuICAgIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC5tZXRhZGF0YUNhY2hlLm9uKFwiY2hhbmdlZFwiLCAoZmlsZSkgPT4gdGhpcy51cGRhdGUoZmlsZSkpKTtcbiAgICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAubWV0YWRhdGFDYWNoZS5vbihcImRlbGV0ZWRcIiwgKGZpbGUpID0+IHRoaXMucmVtb3ZlKGZpbGUucGF0aCkpKTtcbiAgICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJyZW5hbWVcIiwgKGZpbGUsIG9sZFBhdGgpID0+IHRoaXMucmVuYW1lKGZpbGUsIG9sZFBhdGgpKSk7XG4gICAgLy8gXCJFeGNsdWRlZCBmaWxlc1wiLUxpc3RlIGdlXHUwMEU0bmRlcnQgKHNpZWhlIHJlZ2lzdGVyVHlwVmlldykgLSBkaWUgRWludHJcdTAwRTRnZVxuICAgIC8vIHNlbGJzdCBibGVpYmVuIGdcdTAwRkNsdGlnLCBudXIgZGllIGRhcmF1cyBnZWZpbHRlcnRlbiBaXHUwMEU0aGx1bmdlbiBuaWNodC5cbiAgICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJjb25maWctY2hhbmdlZFwiLCAoKSA9PiAodGhpcy5hZ2dyZWdhdGVzID0gbnVsbCkpKTtcblxuICAgIC8vIEJlaW0gQXBwLVN0YXJ0IGthbm4gZGVyIGVyc3RlIFp1Z3JpZmYgKGxhenksIHNpZWhlIGVuc3VyZUJ1aWx0KSBub2NoIHZvclxuICAgIC8vIGRlbSB2b2xsc3RcdTAwRTRuZGlnIGdlbGFkZW5lbiBNZXRhZGF0YUNhY2hlIGxpZWdlbi4gRWlubWFsaWcgbmFjaCBkZXNzZW5cbiAgICAvLyBlcnN0ZW0ga29tcGxldHRlbiBBdWZsXHUwMEY2c3VuZ3NkdXJjaGxhdWYgbmV1IGF1ZmJhdWVuOyBBYndlaWNodW5nZW4gbGFuZGVuXG4gICAgLy8gZGFiZWkgd2llIGplZGUgYW5kZXJlIFx1MDBDNG5kZXJ1bmcgaW0gXCJjaGFuZ2VcIi1FdmVudC5cbiAgICBjb25zdCByZXNvbHZlZFJlZiA9IGFwcC5tZXRhZGF0YUNhY2hlLm9uKFwicmVzb2x2ZWRcIiwgKCkgPT4ge1xuICAgICAgYXBwLm1ldGFkYXRhQ2FjaGUub2ZmcmVmKHJlc29sdmVkUmVmKTtcbiAgICAgIHRoaXMucmVidWlsZCgpO1xuICAgIH0pO1xuICAgIHBsdWdpbi5yZWdpc3RlckV2ZW50KHJlc29sdmVkUmVmKTtcblxuICAgIHBsdWdpbi5yZWdpc3RlcigoKSA9PiB0aGlzLmZsdXNoLmNhbmNlbCgpKTtcbiAgfVxuXG4gIHJlYWQoZmlsZSkge1xuICAgIGNvbnN0IGZyb250bWF0dGVyID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyO1xuICAgIGNvbnN0IHJhd1R5cGUgPSBwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBUWVBfUFJPUEVSVFkpID8/IG51bGw7XG4gICAgY29uc3QgcmF3U3VidHlwZSA9IHByb3BlcnR5VmFsdWUoZnJvbnRtYXR0ZXIsIFNVQlRZUF9QUk9QRVJUWSkgPz8gbnVsbDtcbiAgICByZXR1cm4geyB0eXBlS2V5OiB0eXBlS2V5T2YocmF3VHlwZSksIHJhd1R5cGUsIHN1YnR5cGVLZXk6IHR5cGVLZXlPZihyYXdTdWJ0eXBlKSwgcmF3U3VidHlwZSB9O1xuICB9XG5cbiAgZW5zdXJlQnVpbHQoKSB7XG4gICAgaWYgKCF0aGlzLmJ1aWx0KSB0aGlzLnJlYnVpbGQoKTtcbiAgfVxuXG4gIHJlYnVpbGQoKSB7XG4gICAgY29uc3QgcHJldmlvdXMgPSB0aGlzLmVudHJpZXM7XG4gICAgY29uc3Qgd2FzQnVpbHQgPSB0aGlzLmJ1aWx0O1xuICAgIHRoaXMuZW50cmllcyA9IG5ldyBNYXAoKTtcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpKSB0aGlzLmVudHJpZXMuc2V0KGZpbGUucGF0aCwgdGhpcy5yZWFkKGZpbGUpKTtcbiAgICB0aGlzLmJ1aWx0ID0gdHJ1ZTtcbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsO1xuICAgIGlmICghd2FzQnVpbHQpIHJldHVybjtcblxuICAgIGZvciAoY29uc3QgW3BhdGgsIGVudHJ5XSBvZiB0aGlzLmVudHJpZXMpIHtcbiAgICAgIGlmICghc2FtZUVudHJ5KHByZXZpb3VzLmdldChwYXRoKSwgZW50cnkpKSB0aGlzLnBlbmRpbmdQYXRocy5hZGQocGF0aCk7XG4gICAgfVxuICAgIGZvciAoY29uc3QgcGF0aCBvZiBwcmV2aW91cy5rZXlzKCkpIHtcbiAgICAgIGlmICghdGhpcy5lbnRyaWVzLmhhcyhwYXRoKSkgdGhpcy5wZW5kaW5nUGF0aHMuYWRkKHBhdGgpO1xuICAgIH1cbiAgICBpZiAodGhpcy5wZW5kaW5nUGF0aHMuc2l6ZSA+IDApIHRoaXMuZmx1c2goKTtcbiAgfVxuXG4gIG1hcmtDaGFuZ2VkKHBhdGgpIHtcbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsO1xuICAgIHRoaXMucGVuZGluZ1BhdGhzLmFkZChwYXRoKTtcbiAgICB0aGlzLmZsdXNoKCk7XG4gIH1cblxuICB1cGRhdGUoZmlsZSkge1xuICAgIC8vIFZvciBkZW0gZXJzdGVuIFp1Z3JpZmYgZ2lidCBlcyBub2NoIGtlaW5lbiB2ZXJhbHRldGVuIFN0YW5kIC0gZGVyXG4gICAgLy8gc3BcdTAwRTR0ZXJlIGxhenkgQXVmYmF1IGxpZXN0IG9obmVoaW4gZnJpc2NoIGF1cyBkZW0gTWV0YWRhdGFDYWNoZS5cbiAgICBpZiAoIXRoaXMuYnVpbHQgfHwgIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpIHx8IGZpbGUuZXh0ZW5zaW9uICE9PSBcIm1kXCIpIHJldHVybjtcbiAgICBjb25zdCBuZXh0ID0gdGhpcy5yZWFkKGZpbGUpO1xuICAgIGlmIChzYW1lRW50cnkodGhpcy5lbnRyaWVzLmdldChmaWxlLnBhdGgpLCBuZXh0KSkgcmV0dXJuO1xuICAgIHRoaXMuZW50cmllcy5zZXQoZmlsZS5wYXRoLCBuZXh0KTtcbiAgICB0aGlzLm1hcmtDaGFuZ2VkKGZpbGUucGF0aCk7XG4gIH1cblxuICByZW1vdmUocGF0aCkge1xuICAgIGlmICghdGhpcy5idWlsdCB8fCAhdGhpcy5lbnRyaWVzLmRlbGV0ZShwYXRoKSkgcmV0dXJuO1xuICAgIHRoaXMubWFya0NoYW5nZWQocGF0aCk7XG4gIH1cblxuICByZW5hbWUoZmlsZSwgb2xkUGF0aCkge1xuICAgIGlmICghdGhpcy5idWlsdCkgcmV0dXJuO1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5lbnRyaWVzLmdldChvbGRQYXRoKTtcbiAgICBpZiAoZW50cnkpIHtcbiAgICAgIHRoaXMuZW50cmllcy5kZWxldGUob2xkUGF0aCk7XG4gICAgICB0aGlzLm1hcmtDaGFuZ2VkKG9sZFBhdGgpO1xuICAgIH1cbiAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlICYmIGZpbGUuZXh0ZW5zaW9uID09PSBcIm1kXCIpIHtcbiAgICAgIHRoaXMuZW50cmllcy5zZXQoZmlsZS5wYXRoLCBlbnRyeSA/PyB0aGlzLnJlYWQoZmlsZSkpO1xuICAgICAgdGhpcy5tYXJrQ2hhbmdlZChmaWxlLnBhdGgpO1xuICAgIH1cbiAgfVxuXG4gIGVudHJ5Rm9yKGZpbGUpIHtcbiAgICBpZiAoIWZpbGUpIHJldHVybiBFTVBUWV9FTlRSWTtcbiAgICB0aGlzLmVuc3VyZUJ1aWx0KCk7XG4gICAgcmV0dXJuIHRoaXMuZW50cmllcy5nZXQoZmlsZS5wYXRoKSA/PyBFTVBUWV9FTlRSWTtcbiAgfVxuXG4gIC8vIFRZUC1TY2hsXHUwMEZDc3NlbCAoc2llaGUgdHlwZUtleU9mKSBvZGVyIG51bGwuIEZcdTAwRkNyIGVpbmVuIHNhdWJlcmVuIFdlcnQgaXN0IGRhc1xuICAvLyBzY2hsaWNodCBkZXIgVFlQLU5hbWUgc2VsYnN0LlxuICB0eXBlT2YoZmlsZSkge1xuICAgIHJldHVybiB0aGlzLmVudHJ5Rm9yKGZpbGUpLnR5cGVLZXk7XG4gIH1cblxuICAvLyBTVUJUWVAtU2NobFx1MDBGQ3NzZWwgKHNpZWhlIHR5cGVLZXlPZikgb2RlciBudWxsLlxuICBzdWJ0eXBlT2YoZmlsZSkge1xuICAgIHJldHVybiB0aGlzLmVudHJ5Rm9yKGZpbGUpLnN1YnR5cGVLZXk7XG4gIH1cblxuICAvLyBFaW4gdGF0c1x1MDBFNGNobGljaGVyIEZyb250bWF0dGVyLVdlcnQgenUgZWluZW0gU2NobFx1MDBGQ3NzZWwgLSBmXHUwMEZDciBBbnplaWdlLCBTdWNoZVxuICAvLyB1bmQgTm9ybWFsaXNpZXJ1bmcgdW5yZWdpc3RyaWVydGVyIEVpbnRyXHUwMEU0Z2UgKGFsbGUgTm90aXplbiBlaW5lcyBTY2hsXHUwMEZDc3NlbHNcbiAgLy8gaGFiZW4gcGVyIERlZmluaXRpb24gZGllc2VsYmUgUm9oZm9ybSkuXG4gIHJhd1ZhbHVlT2YodHlwZUtleSkge1xuICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZSgpLnJhd0J5S2V5LmdldCh0eXBlS2V5KTtcbiAgfVxuXG4gIC8vIFNhdWJlcmVyIFdlcnQgPSBFaW56ZWx3ZXJ0IG9obmUgTGVlcnplaWNoZW4gYW0gUmFuZC4gS2xlaW4gZ2VzY2hyaWViZW5lXG4gIC8vIFdlcnRlIHpcdTAwRTRobGVuIGhpZXIgYWxzIHNhdWJlciAoc2llIHNpbmQgZWluIGdcdTAwRkNsdGlnZXIsIG51ciBub2NoIG5pY2h0XG4gIC8vIHJlZ2lzdHJpZXJ0ZXIgVFlQLU5hbWUpLCBMaXN0ZW4gdW5kIFJhbmRsZWVyemVpY2hlbiBuaWNodC5cbiAgaXNDbGVhbktleSh0eXBlS2V5KSB7XG4gICAgY29uc3QgcmF3ID0gdGhpcy5yYXdWYWx1ZU9mKHR5cGVLZXkpO1xuICAgIHJldHVybiByYXcgIT09IHVuZGVmaW5lZCAmJiAhQXJyYXkuaXNBcnJheShyYXcpICYmIHR5cGVLZXkgPT09IHR5cGVLZXkudHJpbSgpO1xuICB9XG5cbiAgLy8gRGF0ZWllbiBtaXQgZ2VuYXUgZGllc2VtIFRZUC1TY2hsXHUwMEZDc3NlbCwgdW50ZXIgQmVhY2h0dW5nIGRlclxuICAvLyBcIklnbm9yaWVydGUgTm90aXplbiBiZXJcdTAwRkNja3NpY2h0aWdlblwiLUVpbnN0ZWxsdW5nLlxuICBmaWxlc1dpdGhUeXBlKHR5cGVLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5maWxlc01hdGNoaW5nKChlbnRyeSkgPT4gZW50cnkudHlwZUtleSA9PT0gdHlwZUtleSk7XG4gIH1cblxuICAvLyBEYXRlaWVuIG1pdCBnZW5hdSBkaWVzZW0gVFlQLSB1bmQgU1VCVFlQLVNjaGxcdTAwRkNzc2VsLlxuICBmaWxlc1dpdGhTdWJ0eXBlKHR5cGVLZXksIHN1YnR5cGVLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5maWxlc01hdGNoaW5nKChlbnRyeSkgPT4gZW50cnkudHlwZUtleSA9PT0gdHlwZUtleSAmJiBlbnRyeS5zdWJ0eXBlS2V5ID09PSBzdWJ0eXBlS2V5KTtcbiAgfVxuXG4gIGZpbGVzTWF0Y2hpbmcocHJlZGljYXRlKSB7XG4gICAgdGhpcy5lbnN1cmVCdWlsdCgpO1xuICAgIGNvbnN0IGluY2x1ZGVJZ25vcmVkID0gISF0aGlzLnBsdWdpbi5zZXR0aW5ncy5pbmNsdWRlSWdub3JlZEZpbGVzO1xuICAgIGNvbnN0IGZpbGVzID0gW107XG4gICAgZm9yIChjb25zdCBbcGF0aCwgZW50cnldIG9mIHRoaXMuZW50cmllcykge1xuICAgICAgaWYgKCFwcmVkaWNhdGUoZW50cnkpKSBjb250aW51ZTtcbiAgICAgIGlmICghaW5jbHVkZUlnbm9yZWQgJiYgdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5pc1VzZXJJZ25vcmVkKHBhdGgpKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgocGF0aCk7XG4gICAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSBmaWxlcy5wdXNoKGZpbGUpO1xuICAgIH1cbiAgICByZXR1cm4gZmlsZXM7XG4gIH1cblxuICAvLyBSZXNwZWt0aWVydCBzdGFuZGFyZG1cdTAwRTRcdTAwREZpZyBPYnNpZGlhbnMgZWlnZW5lIFwiRXhjbHVkZWQgZmlsZXNcIi1MaXN0ZSAtIGRvcnRcbiAgLy8gdHJhZ2VuIGF1Y2ggUGx1Z2lucyB3aWUgSGlkZSBGb2xkZXJzIGF1c2dlYmxlbmRldGUgT3JkbmVyIGVpbi4gXHUwMERDYmVyIGRpZVxuICAvLyBFaW5zdGVsbHVuZyBcIklnbm9yaWVydGUgTm90aXplbiBiZXJcdTAwRkNja3NpY2h0aWdlblwiIGFic2NoYWx0YmFyLlxuICAvL1xuICAvLyBFaW5lIE5vdGl6IG9obmUgVFlQIGhhdCBrZWluZW4gU1VCVFlQLUtvbnRleHQuXG4gIGFnZ3JlZ2F0ZSgpIHtcbiAgICB0aGlzLmVuc3VyZUJ1aWx0KCk7XG4gICAgY29uc3QgaW5jbHVkZUlnbm9yZWQgPSAhIXRoaXMucGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXM7XG4gICAgaWYgKHRoaXMuYWdncmVnYXRlcz8uaW5jbHVkZUlnbm9yZWQgPT09IGluY2x1ZGVJZ25vcmVkKSByZXR1cm4gdGhpcy5hZ2dyZWdhdGVzO1xuXG4gICAgY29uc3QgY291bnRzID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IHJhd0J5S2V5ID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IHN1YnR5cGVzQnlUeXBlID0gbmV3IE1hcCgpO1xuICAgIGxldCBub1R5cGUgPSAwO1xuICAgIGZvciAoY29uc3QgW3BhdGgsIHsgdHlwZUtleSwgcmF3VHlwZSwgc3VidHlwZUtleSwgcmF3U3VidHlwZSB9XSBvZiB0aGlzLmVudHJpZXMpIHtcbiAgICAgIGlmICghaW5jbHVkZUlnbm9yZWQgJiYgdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5pc1VzZXJJZ25vcmVkKHBhdGgpKSBjb250aW51ZTtcbiAgICAgIGlmICh0eXBlS2V5ID09PSBudWxsKSB7XG4gICAgICAgIG5vVHlwZSsrO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvdW50cy5zZXQodHlwZUtleSwgKGNvdW50cy5nZXQodHlwZUtleSkgPz8gMCkgKyAxKTtcbiAgICAgIGlmICghcmF3QnlLZXkuaGFzKHR5cGVLZXkpKSByYXdCeUtleS5zZXQodHlwZUtleSwgcmF3VHlwZSk7XG4gICAgICBsZXQgYnVja2V0ID0gc3VidHlwZXNCeVR5cGUuZ2V0KHR5cGVLZXkpO1xuICAgICAgaWYgKCFidWNrZXQpIHtcbiAgICAgICAgYnVja2V0ID0geyBjb3VudHM6IG5ldyBNYXAoKSwgbm9TdWJ0eXBlOiAwLCByYXdCeUtleTogbmV3IE1hcCgpIH07XG4gICAgICAgIHN1YnR5cGVzQnlUeXBlLnNldCh0eXBlS2V5LCBidWNrZXQpO1xuICAgICAgfVxuICAgICAgaWYgKHN1YnR5cGVLZXkgPT09IG51bGwpIHtcbiAgICAgICAgYnVja2V0Lm5vU3VidHlwZSsrO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYnVja2V0LmNvdW50cy5zZXQoc3VidHlwZUtleSwgKGJ1Y2tldC5jb3VudHMuZ2V0KHN1YnR5cGVLZXkpID8/IDApICsgMSk7XG4gICAgICAgIGlmICghYnVja2V0LnJhd0J5S2V5LmhhcyhzdWJ0eXBlS2V5KSkgYnVja2V0LnJhd0J5S2V5LnNldChzdWJ0eXBlS2V5LCByYXdTdWJ0eXBlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5hZ2dyZWdhdGVzID0geyBpbmNsdWRlSWdub3JlZCwgY291bnRzLCBub1R5cGUsIHJhd0J5S2V5LCBzdWJ0eXBlc0J5VHlwZSB9O1xuICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZXM7XG4gIH1cblxuICAvLyBad2lzY2hlbmdlc3BlaWNoZXJ0IC0gZGllIGdlbGllZmVydGVuIE1hcHMgbmljaHQgdmVyXHUwMEU0bmRlcm4uXG4gIHR5cGVDb3VudHMoKSB7XG4gICAgY29uc3QgeyBjb3VudHMsIG5vVHlwZSB9ID0gdGhpcy5hZ2dyZWdhdGUoKTtcbiAgICByZXR1cm4geyBjb3VudHMsIG5vVHlwZSB9O1xuICB9XG5cbiAgLy8gVFlQIC0+IHsgY291bnRzOiBNYXAoU1VCVFlQLVNjaGxcdTAwRkNzc2VsIC0+IEFuemFobCksIG5vU3VidHlwZSwgcmF3QnlLZXkgfS5cbiAgLy8gWndpc2NoZW5nZXNwZWljaGVydCAtIG5pY2h0IHZlclx1MDBFNG5kZXJuLlxuICBzdWJ0eXBlQ291bnRzKCkge1xuICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZSgpLnN1YnR5cGVzQnlUeXBlO1xuICB9XG5cbiAgc3VidHlwZUJ1Y2tldCh0eXBlS2V5KSB7XG4gICAgcmV0dXJuIHRoaXMuc3VidHlwZUNvdW50cygpLmdldCh0eXBlS2V5KSA/PyBFTVBUWV9CVUNLRVQ7XG4gIH1cbn1cblxuY29uc3QgRU1QVFlfQlVDS0VUID0gT2JqZWN0LmZyZWV6ZSh7IGNvdW50czogbmV3IE1hcCgpLCBub1N1YnR5cGU6IDAsIHJhd0J5S2V5OiBuZXcgTWFwKCkgfSk7XG5cbm1vZHVsZS5leHBvcnRzID0geyBUeXBJbmRleCwgdHlwZUtleU9mLCBwcm9wZXJ0eVZhbHVlLCBzZXRDYW5vbmljYWxQcm9wZXJ0eSwgZGVsZXRlUHJvcGVydHksIFRZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZIH07XG4iLCAiY29uc3QgeyB0eXBlS2V5T2YsIHByb3BlcnR5VmFsdWUsIHNldENhbm9uaWNhbFByb3BlcnR5LCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcclxuXHJcbi8vIFN1YnR5cC1OYW1lbiB3ZXJkZW4gKGFuZGVycyBhbHMgVFlQZW4sIHNpZWhlIG5vcm1hbGl6ZVR5cGVOYW1lKSBtaXQgZ3JvXHUwMERGZW1cclxuLy8gQW5mYW5nc2J1Y2hzdGFiZW4gamUgV29ydCBnZXNjaHJpZWJlbiwgZGVyIFJlc3Qga2xlaW46IFwia3VyeiBHRVNDSElDSFRFXCIgXHUyMTkyXHJcbi8vIFwiS3VyeiBHZXNjaGljaHRlXCIuIERpZSBQcm9wZXJ0eSBTVUJUWVAgc2VsYnN0IGJsZWlidCBpbiBHcm9cdTAwREZidWNoc3RhYmVuLlxyXG5mdW5jdGlvbiBub3JtYWxpemVTdWJ0eXBlTmFtZShyYXcpIHtcclxuICByZXR1cm4gcmF3LnRyaW0oKS5yZXBsYWNlKC9cXFMrL2csICh3b3JkKSA9PiB3b3JkLmNoYXJBdCgwKS50b0xvY2FsZVVwcGVyQ2FzZShcImRlXCIpICsgd29yZC5zbGljZSgxKS50b0xvY2FsZUxvd2VyQ2FzZShcImRlXCIpKTtcclxufVxyXG5cclxuLy8gUmVnaXN0cmllcnRlIFNVQlRZUGVuIGplIFRZUCAoc2V0dGluZ3MudHlwZVN1YnR5cGVzKTpcclxuLy8gICB7IFtUWVBdOiB7IFtTVUJUWVBdOiB7IGZyb250bWF0dGVyOiB7Li4ufSwgZmxvYXRpbmdLZXlzOiBbLi4uXSwgc2hvcnRjdXRzOiB7Li4ufSB9IH0gfVxyXG4vLyBFaW4gU3VidHlwIGdlaFx1MDBGNnJ0IGltbWVyIHp1IGdlbmF1IGVpbmVtIFRZUDsgZGVyc2VsYmUgTmFtZSBkYXJmIGFiZXIgKGFsc1xyXG4vLyBlaWdlbnN0XHUwMEU0bmRpZ2VyIFN1YnR5cCkgYXVjaCB1bnRlciBlaW5lbSBhbmRlcmVuIFRZUCB2b3Jrb21tZW4uIERpZVxyXG4vLyBSZWloZW5mb2xnZSBkZXIgU2NobFx1MDBGQ3NzZWwgaXN0IGRpZSBBbnplaWdlcmVpaGVuZm9sZ2UgZGVyIEJsXHUwMEY2Y2tlIGluIGRlclxyXG4vLyBUWVAtRGV0YWlsYW5zaWNodCwgc3RldHMgdW50ZXJoYWxiIGRlcyBUWVAtRnJvbnRtYXR0ZXJzLiBmcm9udG1hdHRlclxyXG4vLyBlcmdcdTAwRTRuenQgYnp3LiBcdTAwRkNiZXJzY2hyZWlidCBkYXMgVFlQLUZyb250bWF0dGVyIGRlcyBUWVBzLCBmbG9hdGluZ0tleXMgd2llXHJcbi8vIHR5cGVGbG9hdGluZ0tleXMsIHNob3J0Y3V0cyB3aWUgdHlwZVNob3J0Y3V0cyAoc2llaGUgc2hvcnRjdXRzLmpzKSAtIGplIEtleVxyXG4vLyBkZXMgQmxvY2tzIGVpbiBTaG9ydGN1dC1SZWNvcmQsIGRlciBXZXJ0IGRlcyBLZXlzIGJsZWlidCBkYWJlaSBhbHNcclxuLy8gUlx1MDBGQ2NrZmFsbHdlcnQgc3RlaGVuLiBCZXN0YW5kc2RhdGVuIGZcdTAwRkNocmVuIHNob3J0Y3V0cyBub2NoIG5pY2h0LCBMZXNlciBtXHUwMEZDc3NlblxyXG4vLyBlcyBkYWhlciBhbHMgb3B0aW9uYWwgYmVoYW5kZWxuLlxyXG4vL1xyXG4vLyBEZXJzZWxiZSBLZXkgZGFyZiBpbiBtZWhyZXJlbiBCbFx1MDBGNmNrZW4gZWluZXMgVFlQcyBzdGVoZW4gKG51ciBpbm5lcmhhbGJcclxuLy8gRUlORVMgQmxvY2tzIGlzdCBlciB6d2FuZ3NsXHUwMEU0dWZpZyBlaW5kZXV0aWcpOlxyXG4vLyAgIC0gaW4gendlaSBTdWJ0eXAtQmxcdTAwRjZja2VuOiBrb25mbGlrdGZyZWksIGRhIGVpbmUgTm90aXogaFx1MDBGNmNoc3RlbnMgZWluZW5cclxuLy8gICAgIFNVQlRZUCBoYXQgdW5kIGRpZSBCbFx1MDBGNmNrZSBkYW1pdCBuaWUgZ2xlaWNoemVpdGlnIGdlbHRlbjtcclxuLy8gICAtIGltIFRZUC1Gcm9udG1hdHRlciBVTkQgZWluZW0gU3VidHlwLUJsb2NrOiBkZXIgU3VidHlwIFx1MDBGQ2JlcnNjaHJlaWJ0XHJcbi8vICAgICBXZXJ0IHVuZCBGbG9hdGluZy1NYXJraWVydW5nLCBkaWUgWmVpbGUgYmVoXHUwMEU0bHQgYWJlciBkaWUgUG9zaXRpb24gZGVzXHJcbi8vICAgICBUWVAtRnJvbnRtYXR0ZXJzIChzaWVoZSBnZXRUeXBlRGVmYXVsdHMgaW4gbWFpbi5qcyB1bmRcclxuLy8gICAgIG9yZGVyZWREZWZhdWx0S2V5cyBpbiBmcm9udG1hdHRlci1zb3J0LmpzIC0gYmVpZGUgbVx1MDBGQ3NzZW4gZGllc2VsYmVcclxuLy8gICAgIFJlZ2VsIHZlcndlbmRlbiwgc29uc3Qgc29ydGllcnQgZGllIEZyb250bWF0dGVyLVNvcnRpZXJ1bmcgZWluZSBnZXJhZGVcclxuLy8gICAgIGFuZ2VsZWd0ZSBOb3RpeiBzb2ZvcnQgd2llZGVyIHVtKS5cclxuXHJcbi8vIFwiTm9jaCBhdXN6dWZcdTAwRkNsbGVuXCIgLSBlaW4gc29sY2hlciBXZXJ0IHdpcmQgYmVpbSBadXNhbW1lbmxlZ2VuIHp3ZWllclxyXG4vLyBCbFx1MDBGNmNrZSBiencuIHp3ZWllciBQcm9wZXJ0aWVzIHZvbSBqZXdlaWxzIGFuZGVyZW4gZ2VmXHUwMEZDbGx0LCBzdGF0dCBkZW5cclxuLy8gYmVzdGVoZW5kZW4gRWludHJhZyB6dSBcdTAwRkNiZXJzY2hyZWliZW4gKHNpZWhlIG1lcmdlU3VidHlwZXMgaGllciB1bmRcclxuLy8gcmVuYW1lSW5TdG9yZSBpbiBwcm9wZXJ0eS1yZW5hbWUtc3luYy5qcykuXHJcbmZ1bmN0aW9uIGlzRW1wdHlWYWx1ZSh2YWx1ZSkge1xyXG4gIHJldHVybiB2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSBcIlwiO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRTdWJ0eXBlTmFtZXMoc2V0dGluZ3MsIHR5cGUpIHtcclxuICByZXR1cm4gT2JqZWN0LmtleXMoc2V0dGluZ3MudHlwZVN1YnR5cGVzPy5bdHlwZV0gPz8ge30pO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKSB7XHJcbiAgcmV0dXJuIHNldHRpbmdzLnR5cGVTdWJ0eXBlcz8uW3R5cGVdPy5bc3VidHlwZV0gPz8gbnVsbDtcclxufVxyXG5cclxuZnVuY3Rpb24gZW5zdXJlU3VidHlwZShzZXR0aW5ncywgdHlwZSwgc3VidHlwZSkge1xyXG4gIGlmICghc2V0dGluZ3MudHlwZVN1YnR5cGVzKSBzZXR0aW5ncy50eXBlU3VidHlwZXMgPSB7fTtcclxuICBpZiAoIXNldHRpbmdzLnR5cGVTdWJ0eXBlc1t0eXBlXSkgc2V0dGluZ3MudHlwZVN1YnR5cGVzW3R5cGVdID0ge307XHJcbiAgY29uc3QgYnlOYW1lID0gc2V0dGluZ3MudHlwZVN1YnR5cGVzW3R5cGVdO1xyXG4gIGlmICghYnlOYW1lW3N1YnR5cGVdKSBieU5hbWVbc3VidHlwZV0gPSB7IGZyb250bWF0dGVyOiB7fSwgZmxvYXRpbmdLZXlzOiBbXSwgc2hvcnRjdXRzOiB7fSB9O1xyXG4gIHJldHVybiBieU5hbWVbc3VidHlwZV07XHJcbn1cclxuXHJcbi8vIEJlaW0gVW1iZW5lbm5lbiBlaW5lcyBUWVBzOiBTdWJ0eXBlbiB3YW5kZXJuIHVudGVyIGRlbiBuZXVlbiBOYW1lbiBtaXQuXHJcbmZ1bmN0aW9uIG1vdmVUeXBlU3VidHlwZXMoc2V0dGluZ3MsIG9sZFR5cGUsIG5ld1R5cGUpIHtcclxuICBpZiAoIXNldHRpbmdzLnR5cGVTdWJ0eXBlcz8uW29sZFR5cGVdKSByZXR1cm47XHJcbiAgc2V0dGluZ3MudHlwZVN1YnR5cGVzW25ld1R5cGVdID0gc2V0dGluZ3MudHlwZVN1YnR5cGVzW29sZFR5cGVdO1xyXG4gIGRlbGV0ZSBzZXR0aW5ncy50eXBlU3VidHlwZXNbb2xkVHlwZV07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGRlbGV0ZVR5cGVTdWJ0eXBlcyhzZXR0aW5ncywgdHlwZSkge1xyXG4gIGlmIChzZXR0aW5ncy50eXBlU3VidHlwZXMpIGRlbGV0ZSBzZXR0aW5ncy50eXBlU3VidHlwZXNbdHlwZV07XHJcbn1cclxuXHJcbi8vIEVudGZlcm50IGRpZSBNYXJraWVydW5nIGFib3ZlU3RhbmRhcmQgYXVzIEJlc3RhbmRzZGF0ZW46IFN1YnR5cC1CbFx1MDBGNmNrZVxyXG4vLyBkdXJmdGVuIGZyXHUwMEZDaGVyIFx1MDBGQ2JlciBkZW0gVFlQLUZyb250bWF0dGVyIGxpZWdlbiwgZGFzIHN0ZWh0IGpldHp0IGZlc3QgZ2FuelxyXG4vLyBvYmVuIChzaWVoZSBnZXRTZWN0aW9uT3JkZXIpLiBMaWVmZXJ0IHRydWUgYmVpIGVpbmVyIFx1MDBDNG5kZXJ1bmcuXHJcbmZ1bmN0aW9uIG1pZ3JhdGVBYm92ZVN0YW5kYXJkKHNldHRpbmdzKSB7XHJcbiAgbGV0IGNoYW5nZWQgPSBmYWxzZTtcclxuICBmb3IgKGNvbnN0IGJ5TmFtZSBvZiBPYmplY3QudmFsdWVzKHNldHRpbmdzLnR5cGVTdWJ0eXBlcyA/PyB7fSkpIHtcclxuICAgIGZvciAoY29uc3QgZGF0YSBvZiBPYmplY3QudmFsdWVzKGJ5TmFtZSkpIHtcclxuICAgICAgaWYgKGRhdGEuYWJvdmVTdGFuZGFyZCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcclxuICAgICAgZGVsZXRlIGRhdGEuYWJvdmVTdGFuZGFyZDtcclxuICAgICAgY2hhbmdlZCA9IHRydWU7XHJcbiAgICB9XHJcbiAgfVxyXG4gIHJldHVybiBjaGFuZ2VkO1xyXG59XHJcblxyXG4vLyBEaWUgUmVnbGVyIGRlciBTdWJ0eXAtRmFyYmVuIGhhYmVuIHp3ZWltYWwgaWhyZSBCZWRldXR1bmcgZ2VcdTAwRTRuZGVydCwgb2huZVxyXG4vLyBkYXNzIHNpY2ggZGllIGdlc3BlaWNoZXJ0ZW4gWmFobGVuIHZvbiBzZWxic3QgbWl0YmV3ZWd0IGhcdTAwRTR0dGVuIChzaWVoZVxyXG4vLyBhcHBseUNvbG9yT2Zmc2V0IHVuZCBjaGFubmVsQm91bmRzIGluIHR5cGUtY29sb3JzLmpzKS4gc2V0dGluZ3MuXHJcbi8vIHN1YnR5cGVDb2xvclNjYWxlIGhcdTAwRTRsdCBmZXN0LCB3ZWxjaGVuIFN0YW5kIGRpZSBnZXNwZWljaGVydGVuIFdlcnRlIGhhYmVuO1xyXG4vLyBqZWRlciBTY2hyaXR0IGxcdTAwRTR1ZnQgZ2VuYXUgZWlubWFsLiBMaWVmZXJ0IHRydWUgYmVpIGVpbmVyIFx1MDBDNG5kZXJ1bmcgLSBkaWVcclxuLy8gZ2VoXHUwMEY2cnQgc29mb3J0IGdlc3BlaWNoZXJ0LCBzb25zdCBsaWVmZSBkaWUgVW1yZWNobnVuZyBiZWltIG5cdTAwRTRjaHN0ZW4gU3RhcnRcclxuLy8gZXJuZXV0LiBXYXJlbiBkaWUgR3JlbnplbiBub2NoIGRpZSBTdGFuZGFyZHdlcnRlIGRlcyBqZXdlaWxpZ2VuIFN0YW5kcyxcclxuLy8gZ2VsdGVuIGRhbmFjaCBkaWUgbmV1ZW4uXHJcbi8vICAgMSAtPiAyOiBIZWxsaWdrZWl0IHpcdTAwRTRobHRlIGFic29sdXRlIE9LTENILVB1bmt0ZSwgamV0enQgZGVuIEFudGVpbCBkZXMgV2Vnc1xyXG4vLyAgICAgICAgICAgenUgV2VpXHUwMERGIGJ6dy4gU2Nod2Fyei4gRGllIGFsdGUgWmFobCBsXHUwMEU0c3N0IHNpY2ggbmljaHQgdW1yZWNobmVuXHJcbi8vICAgICAgICAgICAoc2llIGhpbmcgdm9uIGRlciBUWVAtRmFyYmUgYWIpLCB3b2hsIGFiZXIgZGllIEFic2ljaHQgZGFoaW50ZXI6XHJcbi8vICAgICAgICAgICB3YXMgZGVuIFJlZ2xlciBoYWxiIGF1c3JlaXp0ZSwgcmVpenQgaWhuIGF1Y2ggZGFuYWNoIGhhbGIgYXVzLlxyXG4vLyAgIDIgLT4gMzogZGllIFNcdTAwRTR0dGlndW5nIGdlaHQgbnVyIG5vY2ggbmFjaCB1bnRlbjsgZ2VzcGVpY2hlcnRlIHBvc2l0aXZlXHJcbi8vICAgICAgICAgICBXZXJ0ZSBzaW5kIHNvbnN0IHN0dW1tIGdla2FwcHQgdW5kIHdcdTAwRTRyZW4gYmVpbSBuXHUwMEU0Y2hzdGVuIFx1MDBENmZmbmVuIGRlc1xyXG4vLyAgICAgICAgICAgUG9wb3ZlcnMgdW5hbmdla1x1MDBGQ25kaWd0IHZlcnNjaHd1bmRlbi5cclxuY29uc3QgU1VCVFlQRV9DT0xPUl9TQ0FMRSA9IDM7XHJcbmNvbnN0IFBSRVZJT1VTX1NVQlRZUEVfQ09MT1JfUkFOR0VTID0ge1xyXG4gIDI6IHsgaDogMjUsIHM6IDMwLCBsOiAyMCB9LFxyXG4gIDM6IHsgaDogMzUsIHM6IDIwLCBsOiA0MCB9LFxyXG59O1xyXG5cclxuZnVuY3Rpb24gbWlncmF0ZVN1YnR5cGVDb2xvclNjYWxlKHNldHRpbmdzLCBkZWZhdWx0UmFuZ2VzKSB7XHJcbiAgY29uc3QgZnJvbSA9IE51bWJlcihzZXR0aW5ncy5zdWJ0eXBlQ29sb3JTY2FsZSkgfHwgMTtcclxuICBpZiAoZnJvbSA+PSBTVUJUWVBFX0NPTE9SX1NDQUxFKSByZXR1cm4gZmFsc2U7XHJcbiAgY29uc3QgYWxsQ29sb3JzID0gZnVuY3Rpb24qICgpIHtcclxuICAgIGZvciAoY29uc3QgYnlOYW1lIG9mIE9iamVjdC52YWx1ZXMoc2V0dGluZ3MudHlwZVN1YnR5cGVzID8/IHt9KSkge1xyXG4gICAgICBmb3IgKGNvbnN0IGRhdGEgb2YgT2JqZWN0LnZhbHVlcyhieU5hbWUpKSBpZiAoZGF0YS5jb2xvcikgeWllbGQgZGF0YS5jb2xvcjtcclxuICAgIH1cclxuICB9O1xyXG4gIGNvbnN0IGFkb3B0RGVmYXVsdHMgPSAoc3RlcCkgPT4ge1xyXG4gICAgY29uc3QgcHJldmlvdXMgPSBQUkVWSU9VU19TVUJUWVBFX0NPTE9SX1JBTkdFU1tzdGVwXTtcclxuICAgIGlmIChPYmplY3QuZW50cmllcyhwcmV2aW91cykuZXZlcnkoKFtrZXksIHZhbHVlXSkgPT4gTnVtYmVyKHNldHRpbmdzLnN1YnR5cGVDb2xvclJhbmdlcz8uW2tleV0pID09PSB2YWx1ZSkpIHtcclxuICAgICAgc2V0dGluZ3Muc3VidHlwZUNvbG9yUmFuZ2VzID0geyAuLi5kZWZhdWx0UmFuZ2VzIH07XHJcbiAgICB9XHJcbiAgfTtcclxuICBpZiAoZnJvbSA8IDIpIHtcclxuICAgIGNvbnN0IG9sZFJhbmdlID0gTnVtYmVyKHNldHRpbmdzLnN1YnR5cGVDb2xvclJhbmdlcz8ubCk7XHJcbiAgICBhZG9wdERlZmF1bHRzKDIpO1xyXG4gICAgY29uc3QgbmV3UmFuZ2UgPSBOdW1iZXIoc2V0dGluZ3Muc3VidHlwZUNvbG9yUmFuZ2VzPy5sKTtcclxuICAgIGNvbnN0IGZhY3RvciA9IG9sZFJhbmdlID4gMCAmJiBOdW1iZXIuaXNGaW5pdGUobmV3UmFuZ2UpID8gbmV3UmFuZ2UgLyBvbGRSYW5nZSA6IDE7XHJcbiAgICBmb3IgKGNvbnN0IGNvbG9yIG9mIGFsbENvbG9ycygpKSBpZiAoY29sb3IubCkgY29sb3IubCA9IE1hdGgucm91bmQoY29sb3IubCAqIGZhY3Rvcik7XHJcbiAgfVxyXG4gIGlmIChmcm9tIDwgMykge1xyXG4gICAgYWRvcHREZWZhdWx0cygzKTtcclxuICAgIGZvciAoY29uc3QgY29sb3Igb2YgYWxsQ29sb3JzKCkpIGlmIChjb2xvci5zID4gMCkgY29sb3IucyA9IDA7XHJcbiAgfVxyXG4gIHNldHRpbmdzLnN1YnR5cGVDb2xvclNjYWxlID0gU1VCVFlQRV9DT0xPUl9TQ0FMRTtcclxuICByZXR1cm4gdHJ1ZTtcclxufVxyXG5cclxuLy8gWnVzYW1tZW5sZWdlbiB6d2VpZXIgVFlQZW46IFN1YnR5cGVuLCBkaWUgZXMgbnVyIGJlaSBzb3VyY2UgZ2lidCwgd2VyZGVuXHJcbi8vIFx1MDBGQ2Jlcm5vbW1lbi4gR2xlaWNobmFtaWdlIEJsXHUwMEY2Y2tlIHdlcmRlbiB2ZXJlaW5pZ3QgLSBiZWkgZ2xlaWNoZW0gS2V5XHJcbi8vIGdld2lubmVuIFdlcnQgdW5kIEZsb2F0aW5nLU1hcmtpZXJ1bmcgZGVzIFppZWxzLCBLZXlzIG51ciBhdXMgc291cmNlXHJcbi8vIHdlcmRlbiBoaW50ZW4gYW5nZWhcdTAwRTRuZ3QuIFN0ZWh0IGVpbiBcdTAwRkNiZXJub21tZW5lciBLZXkgenVnbGVpY2ggaW1cclxuLy8gVFlQLUZyb250bWF0dGVyIGRlcyBaaWVscywgYmxlaWJlbiBiZWlkZSBzdGVoZW4gLSBkYXJhdXMgd2lyZCBkaWUgZ2FuelxyXG4vLyBub3JtYWxlIFx1MDBEQ2JlcnNjaHJlaWJ1bmcgKHNpZWhlIEtvbW1lbnRhciBhbiB0eXBlU3VidHlwZXMgb2JlbikuXHJcbmZ1bmN0aW9uIG1lcmdlVHlwZVN1YnR5cGVzKHNldHRpbmdzLCBzb3VyY2UsIHRhcmdldCkge1xyXG4gIGNvbnN0IHNvdXJjZVN1YnR5cGVzID0gc2V0dGluZ3MudHlwZVN1YnR5cGVzPy5bc291cmNlXTtcclxuICBpZiAoIXNvdXJjZVN1YnR5cGVzKSByZXR1cm47XHJcbiAgZm9yIChjb25zdCBbbmFtZSwgc291cmNlRGF0YV0gb2YgT2JqZWN0LmVudHJpZXMoc291cmNlU3VidHlwZXMpKSB7XHJcbiAgICBjb25zdCB0YXJnZXREYXRhID0gZ2V0U3VidHlwZShzZXR0aW5ncywgdGFyZ2V0LCBuYW1lKTtcclxuICAgIGlmICghdGFyZ2V0RGF0YSkge1xyXG4gICAgICBlbnN1cmVTdWJ0eXBlKHNldHRpbmdzLCB0YXJnZXQsIG5hbWUpO1xyXG4gICAgICBzZXR0aW5ncy50eXBlU3VidHlwZXNbdGFyZ2V0XVtuYW1lXSA9IHNvdXJjZURhdGE7XHJcbiAgICAgIGNvbnRpbnVlO1xyXG4gICAgfVxyXG4gICAgY29uc3QgdGFyZ2V0TG93ZXIgPSBuZXcgU2V0KE9iamVjdC5rZXlzKHRhcmdldERhdGEuZnJvbnRtYXR0ZXIpLm1hcCgoa2V5KSA9PiBrZXkudG9Mb3dlckNhc2UoKSkpO1xyXG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoc291cmNlRGF0YS5mcm9udG1hdHRlcikpIHtcclxuICAgICAgaWYgKGtleSA9PT0gXCJcIiB8fCB0YXJnZXRMb3dlci5oYXMoa2V5LnRvTG93ZXJDYXNlKCkpKSBjb250aW51ZTtcclxuICAgICAgdGFyZ2V0RGF0YS5mcm9udG1hdHRlcltrZXldID0gdmFsdWU7XHJcbiAgICAgIGlmIChzb3VyY2VEYXRhLmZsb2F0aW5nS2V5cy5pbmNsdWRlcyhrZXkpKSB0YXJnZXREYXRhLmZsb2F0aW5nS2V5cy5wdXNoKGtleSk7XHJcbiAgICAgIC8vIERlciBTaG9ydGN1dCBoXHUwMEU0bmd0IGFtIEtleSB1bmQgd2FuZGVydCBkZXNoYWxiIG1pdCBpaG0gbWl0LlxyXG4gICAgICBjb25zdCBzaG9ydGN1dCA9IHNvdXJjZURhdGEuc2hvcnRjdXRzPy5ba2V5XTtcclxuICAgICAgaWYgKHNob3J0Y3V0KSAodGFyZ2V0RGF0YS5zaG9ydGN1dHMgPz89IHt9KVtrZXldID0gc2hvcnRjdXQ7XHJcbiAgICB9XHJcbiAgfVxyXG4gIGRlbGV0ZSBzZXR0aW5ncy50eXBlU3VidHlwZXNbc291cmNlXTtcclxufVxyXG5cclxuLy8gVW1iZW5lbm5lbiBlaW5lcyBTdWJ0eXBzIGlubmVyaGFsYiBzZWluZXMgVFlQcyAtIGRlciBCbG9jayBiZWhcdTAwRTRsdCBkYWJlaVxyXG4vLyBzZWluZSBQb3NpdGlvbiAoQW56ZWlnZXJlaWhlbmZvbGdlID0gU2NobFx1MDBGQ3NzZWxyZWloZW5mb2xnZSkuXHJcbmZ1bmN0aW9uIHJlbmFtZVN1YnR5cGUoc2V0dGluZ3MsIHR5cGUsIG9sZE5hbWUsIG5ld05hbWUpIHtcclxuICBjb25zdCBieU5hbWUgPSBzZXR0aW5ncy50eXBlU3VidHlwZXM/Llt0eXBlXTtcclxuICBpZiAoIWJ5TmFtZT8uW29sZE5hbWVdIHx8IG9sZE5hbWUgPT09IG5ld05hbWUpIHJldHVybjtcclxuICBzZXR0aW5ncy50eXBlU3VidHlwZXNbdHlwZV0gPSBPYmplY3QuZnJvbUVudHJpZXMoXHJcbiAgICBPYmplY3QuZW50cmllcyhieU5hbWUpLm1hcCgoW25hbWUsIGRhdGFdKSA9PiBbbmFtZSA9PT0gb2xkTmFtZSA/IG5ld05hbWUgOiBuYW1lLCBkYXRhXSlcclxuICApO1xyXG59XHJcblxyXG4vLyBSZWloZW5mb2xnZSBhbGxlciBCbFx1MDBGNmNrZSBlaW5lcyBUWVBzLCBudWxsID0gVFlQLUZyb250bWF0dGVyLiBEYXNcclxuLy8gVFlQLUZyb250bWF0dGVyIHN0ZWh0IGltbWVyIGdhbnogb2JlbiwgZGllIFN1YnR5cGVuIGZvbGdlbiBpbiBpaHJlclxyXG4vLyBTY2hsXHUwMEZDc3NlbHJlaWhlbmZvbGdlLiBCZXN0aW1tdCBkaWUgQW56ZWlnZSBpbiBkZXIgVFlQLURldGFpbGFuc2ljaHQgZWJlbnNvXHJcbi8vIHdpZSBkaWUgRnJvbnRtYXR0ZXItU29ydGllcnVuZyBkZXIgTm90aXplbiAoc2llaGUgb3JkZXJlZERlZmF1bHRLZXlzKS5cclxuZnVuY3Rpb24gZ2V0U2VjdGlvbk9yZGVyKHNldHRpbmdzLCB0eXBlKSB7XHJcbiAgcmV0dXJuIFtudWxsLCAuLi5nZXRTdWJ0eXBlTmFtZXMoc2V0dGluZ3MsIHR5cGUpXTtcclxufVxyXG5cclxuLy8gTmV1ZSBCbG9jay1SZWloZW5mb2xnZSAoRHJhZyAmIERyb3AgaW4gZGVyIFRZUC1EZXRhaWxhbnNpY2h0KTogb3JkZXIgd2llXHJcbi8vIGdldFNlY3Rpb25PcmRlciwgZGFzIGZcdTAwRkNocmVuZGUgbnVsbCBmXHUwMEZDciBkYXMgVFlQLUZyb250bWF0dGVyIHdpcmQgZGFiZWlcclxuLy8gaWdub3JpZXJ0IChlcyBpc3QgbmljaHQgdmVyc2NoaWViYmFyKS4gTmljaHQgZ2VuYW5udGUgU3VidHlwZW4gYmxlaWJlblxyXG4vLyBkYWhpbnRlciBlcmhhbHRlbi5cclxuZnVuY3Rpb24gcmVvcmRlclN1YnR5cGVzKHNldHRpbmdzLCB0eXBlLCBvcmRlcikge1xyXG4gIGNvbnN0IGJ5TmFtZSA9IHNldHRpbmdzLnR5cGVTdWJ0eXBlcz8uW3R5cGVdO1xyXG4gIGlmICghYnlOYW1lKSByZXR1cm47XHJcbiAgY29uc3QgbmFtZXMgPSBvcmRlci5maWx0ZXIoKG5hbWUpID0+IG5hbWUgIT09IG51bGwgJiYgYnlOYW1lW25hbWVdKTtcclxuICBjb25zdCBvcmRlcmVkID0gWy4uLm5hbWVzLCAuLi5PYmplY3Qua2V5cyhieU5hbWUpLmZpbHRlcigobmFtZSkgPT4gIW5hbWVzLmluY2x1ZGVzKG5hbWUpKV07XHJcbiAgc2V0dGluZ3MudHlwZVN1YnR5cGVzW3R5cGVdID0gT2JqZWN0LmZyb21FbnRyaWVzKG9yZGVyZWQubWFwKChuYW1lKSA9PiBbbmFtZSwgYnlOYW1lW25hbWVdXSkpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBkZWxldGVTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBuYW1lKSB7XHJcbiAgY29uc3QgYnlOYW1lID0gc2V0dGluZ3MudHlwZVN1YnR5cGVzPy5bdHlwZV07XHJcbiAgaWYgKCFieU5hbWUpIHJldHVybjtcclxuICBkZWxldGUgYnlOYW1lW25hbWVdO1xyXG4gIGlmIChPYmplY3Qua2V5cyhieU5hbWUpLmxlbmd0aCA9PT0gMCkgZGVsZXRlIHNldHRpbmdzLnR5cGVTdWJ0eXBlc1t0eXBlXTtcclxufVxyXG5cclxuLy8gWnVzYW1tZW5sZWdlbiB6d2VpZXIgU3VidHlwZW4gZGVzc2VsYmVuIFRZUHM6IGRpZSBQcm9wZXJ0aWVzIHZvbiBzb3VyY2VcclxuLy8gd2FuZGVybiBhbnMgRW5kZSBkZXMgWmllbC1CbG9ja3MsIHNvdXJjZSB2ZXJzY2h3aW5kZXQuIEZcdTAwRkNocnQgZGFzIFppZWwgZWluZW5cclxuLy8gS2V5IGJlcmVpdHMsIGJlaFx1MDBFNGx0IGVzIFBvc2l0aW9uLCBXZXJ0IHVuZCBGbG9hdGluZy1NYXJraWVydW5nIC0gbnVyIGVpblxyXG4vLyBsZWVyZXIgWmllbHdlcnQgd2lyZCBhdXMgc291cmNlIGdlZlx1MDBGQ2xsdCAoZGFzc2VsYmUgTXVzdGVyIHdpZSByZW5hbWVJblN0b3JlXHJcbi8vIGluIHByb3BlcnR5LXJlbmFtZS1zeW5jLmpzIGJlaW0gWnVzYW1tZW5sZWdlbiB6d2VpZXIgUHJvcGVydGllcykuIElubmVyaGFsYlxyXG4vLyBlaW5lcyBCbG9ja3MgYmxlaWJ0IGplZGVyIEtleSB6d2FuZ3NsXHUwMEU0dWZpZyBlaW5kZXV0aWcsIGJsb2NrXHUwMEZDYmVyZ3JlaWZlbmRlXHJcbi8vIERvcHBsdW5nZW4gc2luZCBkYXZvbiBuaWNodCBiZXRyb2ZmZW4uXHJcbmZ1bmN0aW9uIG1lcmdlU3VidHlwZXMoc2V0dGluZ3MsIHR5cGUsIHNvdXJjZSwgdGFyZ2V0KSB7XHJcbiAgY29uc3Qgc291cmNlRGF0YSA9IGdldFN1YnR5cGUoc2V0dGluZ3MsIHR5cGUsIHNvdXJjZSk7XHJcbiAgY29uc3QgdGFyZ2V0RGF0YSA9IGdldFN1YnR5cGUoc2V0dGluZ3MsIHR5cGUsIHRhcmdldCk7XHJcbiAgaWYgKCFzb3VyY2VEYXRhIHx8ICF0YXJnZXREYXRhIHx8IHNvdXJjZSA9PT0gdGFyZ2V0KSByZXR1cm47XHJcblxyXG4gIGNvbnN0IHRhcmdldEtleXMgPSBuZXcgTWFwKE9iamVjdC5rZXlzKHRhcmdldERhdGEuZnJvbnRtYXR0ZXIpLm1hcCgoa2V5KSA9PiBba2V5LnRvTG93ZXJDYXNlKCksIGtleV0pKTtcclxuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzb3VyY2VEYXRhLmZyb250bWF0dGVyKSkge1xyXG4gICAgaWYgKGtleSA9PT0gXCJcIikgY29udGludWU7XHJcbiAgICBjb25zdCBleGlzdGluZyA9IHRhcmdldEtleXMuZ2V0KGtleS50b0xvd2VyQ2FzZSgpKTtcclxuICAgIGlmIChleGlzdGluZyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIHRhcmdldERhdGEuZnJvbnRtYXR0ZXJba2V5XSA9IHZhbHVlO1xyXG4gICAgICB0YXJnZXRLZXlzLnNldChrZXkudG9Mb3dlckNhc2UoKSwga2V5KTtcclxuICAgICAgaWYgKHNvdXJjZURhdGEuZmxvYXRpbmdLZXlzLmluY2x1ZGVzKGtleSkgJiYgIXRhcmdldERhdGEuZmxvYXRpbmdLZXlzLmluY2x1ZGVzKGtleSkpIHRhcmdldERhdGEuZmxvYXRpbmdLZXlzLnB1c2goa2V5KTtcclxuICAgICAgLy8gRGVyIFNob3J0Y3V0IGhcdTAwRTRuZ3QgYW0gS2V5IHVuZCB3YW5kZXJ0IGRlc2hhbGIgbWl0IGlobSBtaXQuXHJcbiAgICAgIGNvbnN0IHNob3J0Y3V0ID0gc291cmNlRGF0YS5zaG9ydGN1dHM/LltrZXldO1xyXG4gICAgICBpZiAoc2hvcnRjdXQpICh0YXJnZXREYXRhLnNob3J0Y3V0cyA/Pz0ge30pW2tleV0gPSBzaG9ydGN1dDtcclxuICAgIH0gZWxzZSBpZiAoaXNFbXB0eVZhbHVlKHRhcmdldERhdGEuZnJvbnRtYXR0ZXJbZXhpc3RpbmddKSkge1xyXG4gICAgICB0YXJnZXREYXRhLmZyb250bWF0dGVyW2V4aXN0aW5nXSA9IHZhbHVlO1xyXG4gICAgfVxyXG4gIH1cclxuICBkZWxldGVTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBzb3VyY2UpO1xyXG59XHJcblxyXG4vLyBTY2hyZWlidCBkZW4gU1VCVFlQLVdlcnQgYWxsZXIgTm90aXplbiBtaXQgVFlQLVNjaGxcdTAwRkNzc2VsIHR5cGUgdW5kXHJcbi8vIFNVQlRZUC1TY2hsXHUwMEZDc3NlbCBvbGRLZXkgYXVmIGRlbiBFaW56ZWx3ZXJ0IG5ld1ZhbHVlIHVtIC0gYW5hbG9nIHp1XHJcbi8vIHJlbmFtZVR5cGVJbk5vdGVzKCkgaW4gdHlwLXZpZXcuanMuXHJcbmFzeW5jIGZ1bmN0aW9uIHJlbmFtZVN1YnR5cGVJbk5vdGVzKHBsdWdpbiwgdHlwZSwgb2xkS2V5LCBuZXdWYWx1ZSkge1xyXG4gIGxldCBjaGFuZ2VkID0gMDtcclxuICBmb3IgKGNvbnN0IGZpbGUgb2YgcGx1Z2luLnR5cEluZGV4LmZpbGVzV2l0aFN1YnR5cGUodHlwZSwgb2xkS2V5KSkge1xyXG4gICAgbGV0IG1hdGNoZWQgPSBmYWxzZTtcclxuICAgIGF3YWl0IHBsdWdpbi5hcHAuZmlsZU1hbmFnZXIucHJvY2Vzc0Zyb250TWF0dGVyKGZpbGUsIChmcm9udG1hdHRlcikgPT4ge1xyXG4gICAgICBpZiAodHlwZUtleU9mKHByb3BlcnR5VmFsdWUoZnJvbnRtYXR0ZXIsIFNVQlRZUF9QUk9QRVJUWSkpICE9PSBvbGRLZXkpIHJldHVybjtcclxuICAgICAgc2V0Q2Fub25pY2FsUHJvcGVydHkoZnJvbnRtYXR0ZXIsIFNVQlRZUF9QUk9QRVJUWSwgbmV3VmFsdWUpO1xyXG4gICAgICBtYXRjaGVkID0gdHJ1ZTtcclxuICAgIH0pO1xyXG4gICAgaWYgKG1hdGNoZWQpIGNoYW5nZWQrKztcclxuICB9XHJcbiAgcmV0dXJuIGNoYW5nZWQ7XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0ge1xyXG4gIG5vcm1hbGl6ZVN1YnR5cGVOYW1lLFxyXG4gIGlzRW1wdHlWYWx1ZSxcclxuICBnZXRTdWJ0eXBlTmFtZXMsXHJcbiAgZ2V0U3VidHlwZSxcclxuICBlbnN1cmVTdWJ0eXBlLFxyXG4gIG1pZ3JhdGVBYm92ZVN0YW5kYXJkLFxyXG4gIG1pZ3JhdGVTdWJ0eXBlQ29sb3JTY2FsZSxcclxuICBtb3ZlVHlwZVN1YnR5cGVzLFxyXG4gIGRlbGV0ZVR5cGVTdWJ0eXBlcyxcclxuICBtZXJnZVR5cGVTdWJ0eXBlcyxcclxuICByZW5hbWVTdWJ0eXBlLFxyXG4gIGdldFNlY3Rpb25PcmRlcixcclxuICByZW9yZGVyU3VidHlwZXMsXHJcbiAgZGVsZXRlU3VidHlwZSxcclxuICBtZXJnZVN1YnR5cGVzLFxyXG4gIHJlbmFtZVN1YnR5cGVJbk5vdGVzLFxyXG59O1xyXG4iLCAiY29uc3QgeyBnZXRTdWJ0eXBlIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBlc1wiKTtcclxuY29uc3QgeyB0eXBlS2V5T2YsIHByb3BlcnR5VmFsdWUgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcclxuXHJcbmNvbnN0IFRZUF9QUk9QRVJUWSA9IFwiVFlQXCI7XHJcbmNvbnN0IFNVQlRZUF9QUk9QRVJUWSA9IFwiU1VCVFlQXCI7XHJcblxyXG4vLyBXaXJkIGF1Y2ggdm9uIHNldHRpbmdzLmpzIChEZWZhdWx0IGZcdTAwRkNyIGdsb2JhbFByb3BlcnR5T3JkZXIpIHNvd2llIHZvbVxyXG4vLyBPcmRlci1FZGl0b3IgYmVudXR6dCAtIGFsbGUgdmllciBQbGF0emhhbHRlci1CbFx1MDBGNmNrZSBzaW5kIGRvcnQgcGVyIFVJIG5pY2h0XHJcbi8vIGVudGZlcm5iYXIsIG51ciB2ZXJzY2hpZWJiYXIgKHNpZWhlIGZyb250bWF0dGVyLW9yZGVyLWVkaXRvci5qcykuXHJcbi8vIFwidHlwVmFsdWVcIiBpc3QgZGllIFRZUC1Qcm9wZXJ0eSBzZWxic3QsIFwic3VidHlwVmFsdWVcIiBhbmFsb2cgZGllIFNVQlRZUC1cclxuLy8gUHJvcGVydHksIFwidHlwXCIgZGllIFRZUC1Gcm9udG1hdHRlci1MaXN0ZSBkZXMgVFlQcyAoc2llaGVcclxuLy8gdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpLCBcIm90aGVyXCIgYWxsZXMgXHUwMERDYnJpZ2UuXHJcbmNvbnN0IERFRkFVTFRfR0xPQkFMX09SREVSID0gW3sga2luZDogXCJ0eXBWYWx1ZVwiIH0sIHsga2luZDogXCJzdWJ0eXBWYWx1ZVwiIH0sIHsga2luZDogXCJ0eXBcIiB9LCB7IGtpbmQ6IFwib3RoZXJcIiB9XTtcclxuXHJcbi8vIFN0ZWxsdCBzaWNoZXIsIGRhc3MgZ2VuYXUgamUgZWluIEVpbnRyYWcgcHJvIFBsYXR6aGFsdGVyLUFydCB2b3JoYW5kZW4gaXN0IC1cclxuLy8gblx1MDBGNnRpZyBmXHUwMEZDciBCZXN0YW5kc2luc3RhbGxhdGlvbmVuLCBkZXJlbiBnZXNwZWljaGVydGUgZ2xvYmFsUHJvcGVydHlPcmRlclxyXG4vLyBub2NoIGF1cyBkZXIgWmVpdCB2b3IgXCJUWVAgYWxzIExpc3RlbmVpbnRyYWdcIiBiencuIHZvciBTVUJUWVAgc3RhbW10IChUWVBcclxuLy8gd2FyIGRhdm9yIGhhcnQtY29kaWVydCBpbW1lciBhbiBlcnN0ZXIgU3RlbGxlLCBrYW0gaW4gZGVyIExpc3RlIHNlbGJzdFxyXG4vLyBuaWNodCB2b3IpLiBGZWhsZW5kZSBFaW50clx1MDBFNGdlIHdlcmRlbiBhbiBzaW5udm9sbGVyIERlZmF1bHQtUG9zaXRpb24gZXJnXHUwMEU0bnp0LFxyXG4vLyBzdGF0dCBkaWUgYmVzdGVoZW5kZSwgdm9tIE51dHplciBwZXIgRHJhZyAmIERyb3AgZWluc29ydGllcnRlIFJlaWhlbmZvbGdlXHJcbi8vIGFuenV0YXN0ZW4uIFwic3VidHlwVmFsdWVcIiBsYW5kZXQgZGFiZWkgZGlyZWt0IGhpbnRlciBcInR5cFZhbHVlXCIgKGdhcmFudGllcnRcclxuLy8genUgZGllc2VtIFplaXRwdW5rdCBzY2hvbiB2b3JoYW5kZW4pLCBzdGF0dCB3aWUgZGllIFx1MDBGQ2JyaWdlbiBQbGF0emhhbHRlclxyXG4vLyBwYXVzY2hhbCBhbiBkZW4gUmFuZC5cclxuZnVuY3Rpb24gbm9ybWFsaXplR2xvYmFsT3JkZXIob3JkZXIpIHtcclxuICBjb25zdCByZXN1bHQgPSBBcnJheS5pc0FycmF5KG9yZGVyKSA/IG9yZGVyLmZpbHRlcigoZW50cnkpID0+IGVudHJ5ICYmIHR5cGVvZiBlbnRyeSA9PT0gXCJvYmplY3RcIikgOiBbXTtcclxuICBjb25zdCBoYXNLaW5kID0gKGtpbmQpID0+IHJlc3VsdC5zb21lKChlbnRyeSkgPT4gZW50cnkua2luZCA9PT0ga2luZCk7XHJcbiAgaWYgKCFoYXNLaW5kKFwidHlwVmFsdWVcIikpIHJlc3VsdC51bnNoaWZ0KHsga2luZDogXCJ0eXBWYWx1ZVwiIH0pO1xyXG4gIGlmICghaGFzS2luZChcInN1YnR5cFZhbHVlXCIpKSB7XHJcbiAgICBjb25zdCB0eXBWYWx1ZUluZGV4ID0gcmVzdWx0LmZpbmRJbmRleCgoZW50cnkpID0+IGVudHJ5LmtpbmQgPT09IFwidHlwVmFsdWVcIik7XHJcbiAgICByZXN1bHQuc3BsaWNlKHR5cFZhbHVlSW5kZXggKyAxLCAwLCB7IGtpbmQ6IFwic3VidHlwVmFsdWVcIiB9KTtcclxuICB9XHJcbiAgaWYgKCFoYXNLaW5kKFwidHlwXCIpKSByZXN1bHQucHVzaCh7IGtpbmQ6IFwidHlwXCIgfSk7XHJcbiAgaWYgKCFoYXNLaW5kKFwib3RoZXJcIikpIHJlc3VsdC5wdXNoKHsga2luZDogXCJvdGhlclwiIH0pO1xyXG4gIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4gKiBGcm9udG1hdHRlci1Tb3J0aWVydW5nXHJcbiAqIEJyaW5ndCBkaWUgaW4gZWluZXIgTm90aXogVk9SSEFOREVORU4gUHJvcGVydGllcyBpbiBlaW5lIGZlc3RlXHJcbiAqIFJlaWhlbmZvbGdlIC0genVzYW1tZW5nZXNldHp0IGF1cyAoc2llaGUgZ2xvYmFsUHJvcGVydHlPcmRlcik6XHJcbiAqICAtIGdsb2JhbCBmZXN0IHBvc2l0aW9uaWVydGVuIEVpbnplbC1Qcm9wZXJ0aWVzICh6LiBCLiBjc3NjbGFzc2VzLFxyXG4gKiAgICBhbGlhc2VzOyBFaW5zdGVsbHVuZ2VuIC0+IFRZUCAtPiBHbG9iYWxlIFByb3BlcnR5LVJlaWhlbmZvbGdlKSxcclxuICogIC0gZGVyIFRZUC1Qcm9wZXJ0eSBzZWxic3QsXHJcbiAqICAtIGRlciBTVUJUWVAtUHJvcGVydHkgc2VsYnN0LFxyXG4gKiAgLSBkZW0gQmxvY2sgXCJUWVAtRnJvbnRtYXR0ZXJcIiAoVFlQLUZyb250bWF0dGVyLUxpc3RlIGRlc1xyXG4gKiAgICBqZXdlaWxpZ2VuIFR5cHMsIHNpZWhlIHR5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzLCBnZWZvbGd0IHZvbVxyXG4gKiAgICBGcm9udG1hdHRlci1CbG9jayBzZWluZXMgU1VCVFlQcyksIHVuZFxyXG4gKiAgLSBkZW0gQmxvY2sgXCJTb25zdGlnZSBQcm9wZXJ0aWVzXCIgKGFsbGVzIFx1MDBEQ2JyaWdlLCBpbiBiaXNoZXJpZ2VyXHJcbiAqICAgIFJlaWhlbmZvbGdlKS5cclxuICogRXJnXHUwMEU0bnp0IGRhYmVpIGtlaW5lIGZlaGxlbmRlbiBTdGFuZGFyZC1Qcm9wZXJ0aWVzIHVuZCBcdTAwRTRuZGVydCBrZWluZVxyXG4gKiBXZXJ0ZSAtIHJlaW5lIFVtc29ydGllcnVuZyBkZXIgYmVyZWl0cyB2b3JoYW5kZW5lbiBaZWlsZW4uXHJcbiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqL1xyXG5cclxuLy8gU3RhbmRhcmQtUHJvcGVydHktUmVpaGVuZm9sZ2UgZWluZXMgVHlwcywgaW5rbC4gZGVyIGRhcmluIGFscyBcIkZsb2F0aW5nXHJcbi8vIFByb3BlcnR5XCIgbWFya2llcnRlbiBLZXlzIChzaWVoZSB0eXBlRmxvYXRpbmdLZXlzIGluIHNldHRpbmdzLmpzKSBhbiBnZW5hdVxyXG4vLyBkZXIgU3RlbGxlLCBhbiBkZXIgc2llIGluIGRlciBMaXN0ZSBzdGVoZW4gLSBvaG5lIFRZUCBzZWxic3QgKGRhcyBpc3QgZG9ydFxyXG4vLyBudXIgYXVzIGhpc3RvcmlzY2hlbiBHclx1MDBGQ25kZW4gZXZ0bC4gbm9jaCBlbnRoYWx0ZW4sIHNpZWhlIHN0cmlwVHlwUHJvcGVydHkpXHJcbi8vIHVuZCBvaG5lIGRpZSBsZWVyZSBQbGF0emhhbHRlci1aZWlsZSBkZXMgRWRpdG9ycyAoXCJQcm9wZXJ0eSBoaW56dWZcdTAwRkNnZW5cIikuXHJcbi8vIEZsb2F0aW5nIFByb3BlcnRpZXMgd2VyZGVuIG51ciBuaWNodCBhdXRvbWF0aXNjaCB2b24gZ2V0VHlwZURlZmF1bHRzKClcclxuLy8gKG1haW4uanMpIGFuIFRlbXBsYXRlciBhdXNnZWxpZWZlcnQsIHNvbGxlbiBhYmVyIHRyb3R6ZGVtIGFuIGlocmVyXHJcbi8vIExpc3RlbnBvc2l0aW9uIGxhbmRlbiwgc29iYWxkIGVpbmUgTm90aXogc2llIGRvY2ggdHJcdTAwRTRndC4gbnVsbCwgd2VubiBrZWluXHJcbi8vIFR5cCBcdTAwRkNiZXJnZWJlbiB3dXJkZSBvZGVyIGZcdTAwRkNyIGRlbiBUeXAga2VpbmUgU3RhbmRhcmRsaXN0ZSBnZXBmbGVndCBpc3QuXHJcbi8vXHJcbi8vIE1pdCBzdWJ0eXBlIHp1c1x1MDBFNHR6bGljaCBkaWUgS2V5cyBhdXMgZGVzc2VuIEZyb250bWF0dGVyLUJsb2NrIChzaWVoZVxyXG4vLyBzdWJ0eXBlcy5qcykgLSBkYWhpbnRlciwgZGEgZGFzIFRZUC1Gcm9udG1hdHRlciBpbW1lciBvYmVuIHN0ZWh0LiBFaW4gS2V5LFxyXG4vLyBkZXIgaW4gQkVJREVOIEJsXHUwMEY2Y2tlbiB2b3Jrb21tdCwgYmVoXHUwMEU0bHQgZGllIFBvc2l0aW9uIGRlcyBUWVAtRnJvbnRtYXR0ZXJzXHJcbi8vIChkZXIgU3VidHlwIHN0ZXVlcnQgZG9ydCBudXIgV2VydCB1bmQgRmxvYXRpbmctTWFya2llcnVuZyBiZWksIHNpZWhlXHJcbi8vIGdldFR5cGVEZWZhdWx0cyBpbiBtYWluLmpzKSAtIGRlc2hhbGIgaGllciBiZXd1c3N0IFwiZXJzdGUgUG9zaXRpb24gelx1MDBFNGhsdFwiLlxyXG5mdW5jdGlvbiBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCB0eXBlLCBzdWJ0eXBlID0gbnVsbCkge1xyXG4gIGlmICghdHlwZSkgcmV0dXJuIG51bGw7XHJcbiAgY29uc3QgaXNTeXN0ZW1LZXkgPSAoa2V5KSA9PiBrZXkgPT09IFwiXCIgfHwgW1RZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZXS5zb21lKChwKSA9PiBrZXkudG9Mb3dlckNhc2UoKSA9PT0gcC50b0xvd2VyQ2FzZSgpKTtcclxuICBjb25zdCBzdWJ0eXBlRGF0YSA9IHN1YnR5cGUgPyBnZXRTdWJ0eXBlKHBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSkgOiBudWxsO1xyXG4gIGNvbnN0IGJsb2NrcyA9IFtwbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXSwgc3VidHlwZURhdGE/LmZyb250bWF0dGVyXTtcclxuICBjb25zdCBrZXlzID0gW107XHJcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQoKTtcclxuICBmb3IgKGNvbnN0IGJsb2NrIG9mIGJsb2Nrcykge1xyXG4gICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoYmxvY2sgPz8ge30pKSB7XHJcbiAgICAgIGlmIChpc1N5c3RlbUtleShrZXkpIHx8IHNlZW4uaGFzKGtleS50b0xvd2VyQ2FzZSgpKSkgY29udGludWU7XHJcbiAgICAgIGtleXMucHVzaChrZXkpO1xyXG4gICAgICBzZWVuLmFkZChrZXkudG9Mb3dlckNhc2UoKSk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIHJldHVybiBrZXlzLmxlbmd0aCA+IDAgPyBrZXlzIDogbnVsbDtcclxufVxyXG5cclxuLy8gUmVpaGVuZm9sZ2UsIGluIGRlciBkaWUgdm9yaGFuZGVuZW4gUHJvcGVydGllcyBlaW5lciBOb3RpeiBzdGVoZW4gc29sbGVuIC1cclxuLy8gYmVzdGltbXQga29tcGxldHQgZHVyY2ggZ2xvYmFsT3JkZXI6IGVpbnplbG5lIFByb3BlcnRpZXMgYW4gZmVzdGVyXHJcbi8vIFBvc2l0aW9uLCBzb3dpZSBkaWUgUGxhdHpoYWx0ZXIgXCJ0eXBWYWx1ZVwiIChkaWUgVFlQLVByb3BlcnR5IHNlbGJzdCksXHJcbi8vIFwic3VidHlwVmFsdWVcIiAoZGllIFNVQlRZUC1Qcm9wZXJ0eSBzZWxic3QpLCBcInR5cFwiIChTdGFuZGFyZGxpc3RlIGRlcyBUeXBzKVxyXG4vLyB1bmQgXCJvdGhlclwiIChhbGxlcyBcdTAwRENicmlnZSkuXHJcbi8vXHJcbi8vIFdlbGNoZXIgQmxvY2sgZWluZSBQcm9wZXJ0eSBiZWFuc3BydWNodCwgd2lyZCBWT1IgZGVtIGVpZ2VudGxpY2hlbiBBdWZiYXVcclxuLy8gZGVyIFJlaWhlbmZvbGdlIGZlc3RzdGVoZW5kIGJlc3RpbW10IChwaW5uZWQvdHlwQmxvY2svUmVzdCBzaW5kIGRpc2p1bmt0KSAtXHJcbi8vIG5pY2h0IGVyc3QgYmVpbSBsaW5lYXJlbiBEdXJjaGxhdWYgdm9uIGdsb2JhbE9yZGVyLiBEYXMgbWFjaHQgZGllXHJcbi8vIEJsb2NrLVp1b3JkbnVuZyB1bmFiaFx1MDBFNG5naWcgZGF2b24sIGluIHdlbGNoZXIgUmVpaGVuZm9sZ2UgZGllIEJsXHUwMEY2Y2tlIGluXHJcbi8vIGdsb2JhbE9yZGVyIHN0ZWhlbjogZWluZSBnbG9iYWwgZmVzdCBwb3NpdGlvbmllcnRlIFByb3BlcnR5IGdlaFx1MDBGNnJ0IGltbWVyIHp1XHJcbi8vIGlocmVtIGVpZ2VuZW4gRWludHJhZyAobmllIHp1c1x1MDBFNHR6bGljaCB6dW0gVHlwLUJsb2NrLCBzZWxic3Qgd2VubiBcIlRZUFxyXG4vLyBQcm9wZXJ0aWVzXCIgdm9yaGVyIGluIGRlciBMaXN0ZSBzdGVodCksIHVuZCBcIlNvbnN0aWdlIFByb3BlcnRpZXNcIiBlbnRoXHUwMEU0bHRcclxuLy8gaW1tZXIgbnVyIGVjaHRlIFJlc3RiZXN0XHUwMEU0bmRlIChuaWUgdmVyc2VoZW50bGljaCBQcm9wZXJ0aWVzLCBkaWUgZWlnZW50bGljaFxyXG4vLyBlaW5lbSBzcFx1MDBFNHRlciBpbiBkZXIgTGlzdGUgc3RlaGVuZGVuIEJsb2NrIGdlaFx1MDBGNnJlbikuXHJcbmZ1bmN0aW9uIGNvbXB1dGVTb3J0ZWRLZXlzKGV4aXN0aW5nS2V5cywgZ2xvYmFsT3JkZXIsIHR5cGVEZWZhdWx0S2V5cykge1xyXG4gIGNvbnN0IGxvd2VyVG9BY3R1YWwgPSBuZXcgTWFwKGV4aXN0aW5nS2V5cy5tYXAoKGtleSkgPT4gW2tleS50b0xvd2VyQ2FzZSgpLCBrZXldKSk7XHJcbiAgY29uc3QgcmVzb2x2ZSA9IChuYW1lKSA9PiBsb3dlclRvQWN0dWFsLmdldChuYW1lLnRvTG93ZXJDYXNlKCkpO1xyXG5cclxuICBjb25zdCBwaW5uZWQgPSBuZXcgU2V0KFxyXG4gICAgZ2xvYmFsT3JkZXJcclxuICAgICAgLmZpbHRlcigoZW50cnkpID0+IGVudHJ5LmtpbmQgPT09IFwicHJvcGVydHlcIilcclxuICAgICAgLm1hcCgoZW50cnkpID0+IHJlc29sdmUoZW50cnkubmFtZSkpXHJcbiAgICAgIC5maWx0ZXIoQm9vbGVhbilcclxuICApO1xyXG4gIGNvbnN0IHR5cEtleSA9IHJlc29sdmUoVFlQX1BST1BFUlRZKTtcclxuICBjb25zdCBzdWJ0eXBLZXkgPSByZXNvbHZlKFNVQlRZUF9QUk9QRVJUWSk7XHJcbiAgY29uc3QgdHlwQmxvY2tLZXlzID0gbmV3IFNldChcclxuICAgICh0eXBlRGVmYXVsdEtleXMgPz8gW10pLm1hcChyZXNvbHZlKS5maWx0ZXIoKGtleSkgPT4ga2V5ICYmIGtleSAhPT0gdHlwS2V5ICYmICFwaW5uZWQuaGFzKGtleSkpXHJcbiAgKTtcclxuICBjb25zdCBjbGFpbWVkID0gbmV3IFNldChwaW5uZWQpO1xyXG4gIGZvciAoY29uc3Qga2V5IG9mIHR5cEJsb2NrS2V5cykgY2xhaW1lZC5hZGQoa2V5KTtcclxuICBpZiAodHlwS2V5KSBjbGFpbWVkLmFkZCh0eXBLZXkpO1xyXG4gIGlmIChzdWJ0eXBLZXkpIGNsYWltZWQuYWRkKHN1YnR5cEtleSk7XHJcblxyXG4gIGNvbnN0IHNvcnRlZEtleXMgPSBbXTtcclxuICBjb25zdCBzZWVuID0gbmV3IFNldCgpO1xyXG4gIGNvbnN0IHB1c2ggPSAoa2V5KSA9PiB7XHJcbiAgICBpZiAoa2V5ICYmICFzZWVuLmhhcyhrZXkpKSB7XHJcbiAgICAgIHNvcnRlZEtleXMucHVzaChrZXkpO1xyXG4gICAgICBzZWVuLmFkZChrZXkpO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIGZvciAoY29uc3QgZW50cnkgb2YgZ2xvYmFsT3JkZXIpIHtcclxuICAgIGlmIChlbnRyeS5raW5kID09PSBcInByb3BlcnR5XCIpIHB1c2gocmVzb2x2ZShlbnRyeS5uYW1lKSk7XHJcbiAgICBlbHNlIGlmIChlbnRyeS5raW5kID09PSBcInR5cFZhbHVlXCIpIHB1c2godHlwS2V5KTtcclxuICAgIGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwic3VidHlwVmFsdWVcIikgcHVzaChzdWJ0eXBLZXkpO1xyXG4gICAgZWxzZSBpZiAoZW50cnkua2luZCA9PT0gXCJ0eXBcIikge1xyXG4gICAgICBmb3IgKGNvbnN0IG5hbWUgb2YgdHlwZURlZmF1bHRLZXlzID8/IFtdKSB7XHJcbiAgICAgICAgY29uc3Qga2V5ID0gcmVzb2x2ZShuYW1lKTtcclxuICAgICAgICBpZiAoa2V5ICYmIHR5cEJsb2NrS2V5cy5oYXMoa2V5KSkgcHVzaChrZXkpO1xyXG4gICAgICB9XHJcbiAgICB9IGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwib3RoZXJcIikge1xyXG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBleGlzdGluZ0tleXMpIHtcclxuICAgICAgICBpZiAoIWNsYWltZWQuaGFzKGtleSkpIHB1c2goa2V5KTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLy8gU2ljaGVyaGVpdHNuZXR6LCBmYWxscyBnbG9iYWxPcmRlciB1bnZvbGxzdFx1MDBFNG5kaWcgaXN0ICh6LiBCLiBrb3JydXB0ZVxyXG4gIC8vIEVpbnN0ZWxsdW5nZW4pIC0gZGllIFVJIHZlcmhpbmRlcnQgZGFzIGVpZ2VudGxpY2ggKHNpZWhlIG5vcm1hbGl6ZUdsb2JhbE9yZGVyKS5cclxuICBmb3IgKGNvbnN0IGtleSBvZiBleGlzdGluZ0tleXMpIHB1c2goa2V5KTtcclxuICByZXR1cm4gc29ydGVkS2V5cztcclxufVxyXG5cclxuLy8gXCJwb3NpdGlvblwiIGlzdCBrZWluIGVjaHRlcyBQcm9wZXJ0eSwgc29uZGVybiBPYnNpZGlhbnMgZWlnZW5lIEFuZ2FiZSB6dXJcclxuLy8gTGFnZSBkZXMgRnJvbnRtYXR0ZXItQmxvY2tzIGlubmVyaGFsYiBkZXIgRGF0ZWkgKG51ciBpbSBDYWNoZS1PYmpla3RcclxuLy8gdm9yaGFuZGVuLCBuaWNodCBpbSB2b24gcHJvY2Vzc0Zyb250TWF0dGVyIGdlbGllZmVydGVuIE9iamVrdCkuXHJcbmZ1bmN0aW9uIGNhY2hlZEZyb250bWF0dGVyS2V5cyhhcHAsIGZpbGUpIHtcclxuICBjb25zdCBmcm9udG1hdHRlciA9IGFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXI7XHJcbiAgaWYgKCFmcm9udG1hdHRlcikgcmV0dXJuIG51bGw7XHJcbiAgcmV0dXJuIE9iamVjdC5rZXlzKGZyb250bWF0dGVyKS5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBcInBvc2l0aW9uXCIpO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBzb3J0RmlsZUZyb250bWF0dGVyKGFwcCwgZmlsZSwgZ2xvYmFsT3JkZXIsIHR5cGVEZWZhdWx0S2V5cykge1xyXG4gIC8vIEdcdTAwRkNuc3RpZ2VyIFZvcmFiLUNoZWNrIFx1MDBGQ2JlciBkZW4gYmVyZWl0cyBpbSBTcGVpY2hlciB2b3JoYW5kZW5lbiBNZXRhZGF0YS1cclxuICAvLyBDYWNoZSAoa2VpbiBEYXRlaS1adWdyaWZmKTogZGVyIE5vcm1hbGZhbGwgLSBlaW5lIE5vdGl6IGlzdCBzY2hvbiBrb3JyZWt0XHJcbiAgLy8gc29ydGllcnQgLSBsXHUwMEU0c3N0IHNpY2ggc28gZXJrZW5uZW4sIG9obmUgZGllIERhdGVpIFx1MDBGQ2JlciBwcm9jZXNzRnJvbnRNYXR0ZXJcclxuICAvLyBcdTAwRkNiZXJoYXVwdCB6dSBcdTAwRjZmZm5lbi4gRGFzIGlzdCBiZWkgd2llZGVyaG9sdGVuIExcdTAwRTR1ZmVuIFx1MDBGQ2JlciBkZW4gZ2FuemVuXHJcbiAgLy8gVmF1bHQgZGVyIExcdTAwRjZ3ZW5hbnRlaWwgZGVyIE5vdGl6ZW4gdW5kIGRhbWl0IGRlciBlaWdlbnRsaWNoZSBHZXNjaHdpbmRpZy1cclxuICAvLyBrZWl0c2dld2lubi4gcHJvY2Vzc0Zyb250TWF0dGVyIGJsZWlidCB0cm90emRlbSBkaWUgYWxsZWluaWdlIFF1ZWxsZSBkZXJcclxuICAvLyBXYWhyaGVpdCBmXHUwMEZDciBkZW4gdGF0c1x1MDBFNGNobGljaGVuIFNjaHJlaWJ2b3JnYW5nIChDYWNoZSBrYW5uIGt1cnp6ZWl0aWdcclxuICAvLyB2ZXJhbHRldCBzZWluKSAtIGRlciBWb3JhYi1DaGVjayBcdTAwRkNiZXJzcHJpbmd0IG51ciBzaWNoZXIgdW52ZXJcdTAwRTRuZGVydGUgRlx1MDBFNGxsZS5cclxuICBjb25zdCBjYWNoZWRLZXlzID0gY2FjaGVkRnJvbnRtYXR0ZXJLZXlzKGFwcCwgZmlsZSk7XHJcbiAgaWYgKCFjYWNoZWRLZXlzIHx8IGNhY2hlZEtleXMubGVuZ3RoIDw9IDEpIHJldHVybiBmYWxzZTtcclxuICBjb25zdCBjYWNoZWRTb3J0ZWQgPSBjb21wdXRlU29ydGVkS2V5cyhjYWNoZWRLZXlzLCBnbG9iYWxPcmRlciwgdHlwZURlZmF1bHRLZXlzKTtcclxuICBpZiAoY2FjaGVkU29ydGVkLmV2ZXJ5KChrZXksIGkpID0+IGtleSA9PT0gY2FjaGVkS2V5c1tpXSkpIHJldHVybiBmYWxzZTtcclxuXHJcbiAgbGV0IGNoYW5nZWQgPSBmYWxzZTtcclxuICBhd2FpdCBhcHAuZmlsZU1hbmFnZXIucHJvY2Vzc0Zyb250TWF0dGVyKGZpbGUsIChmcm9udG1hdHRlcikgPT4ge1xyXG4gICAgY2hhbmdlZCA9IHNvcnRGcm9udG1hdHRlck9iamVjdChmcm9udG1hdHRlciwgZ2xvYmFsT3JkZXIsIHR5cGVEZWZhdWx0S2V5cyk7XHJcbiAgfSk7XHJcbiAgcmV0dXJuIGNoYW5nZWQ7XHJcbn1cclxuXHJcbi8vIFNvcnRpZXJ0IGRhcyB2b24gcHJvY2Vzc0Zyb250TWF0dGVyIGdlbGllZmVydGUgT2JqZWt0IGluLXBsYWNlIChzaWVoZVxyXG4vLyBLb21tZW50YXIgaW4gdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMgenUgc2F2ZUZyb250bWF0dGVyL3N0cmlwVHlwUHJvcGVydHkpOlxyXG4vLyBPYmpla3QtSW5zZXJ0aW9uLU9yZGVyIGJlc3RpbW10IGRpZSBzcFx1MDBFNHRlcmUgWUFNTC1SZWloZW5mb2xnZSwgZGFoZXIgYWxsZVxyXG4vLyBLZXlzIGxcdTAwRjZzY2hlbiB1bmQgaW4gbmV1ZXIgUmVpaGVuZm9sZ2Ugd2llZGVyIGVpbmZcdTAwRkNnZW4sIHN0YXR0IGVpbiBuZXVlc1xyXG4vLyBPYmpla3QgenVyXHUwMEZDY2t6dWdlYmVuLiBMaWVmZXJ0IHRydWUgYmVpIGVpbmVyIFx1MDBDNG5kZXJ1bmcuXHJcbmZ1bmN0aW9uIHNvcnRGcm9udG1hdHRlck9iamVjdChmcm9udG1hdHRlciwgZ2xvYmFsT3JkZXIsIHR5cGVEZWZhdWx0S2V5cykge1xyXG4gIGNvbnN0IGV4aXN0aW5nS2V5cyA9IE9iamVjdC5rZXlzKGZyb250bWF0dGVyKTtcclxuICBpZiAoZXhpc3RpbmdLZXlzLmxlbmd0aCA8PSAxKSByZXR1cm4gZmFsc2U7XHJcblxyXG4gIGNvbnN0IHNvcnRlZEtleXMgPSBjb21wdXRlU29ydGVkS2V5cyhleGlzdGluZ0tleXMsIGdsb2JhbE9yZGVyLCB0eXBlRGVmYXVsdEtleXMpO1xyXG4gIGlmIChzb3J0ZWRLZXlzLmV2ZXJ5KChrZXksIGkpID0+IGtleSA9PT0gZXhpc3RpbmdLZXlzW2ldKSkgcmV0dXJuIGZhbHNlO1xyXG5cclxuICBjb25zdCBzbmFwc2hvdCA9IHsgLi4uZnJvbnRtYXR0ZXIgfTtcclxuICBmb3IgKGNvbnN0IGtleSBvZiBleGlzdGluZ0tleXMpIGRlbGV0ZSBmcm9udG1hdHRlcltrZXldO1xyXG4gIGZvciAoY29uc3Qga2V5IG9mIHNvcnRlZEtleXMpIGZyb250bWF0dGVyW2tleV0gPSBzbmFwc2hvdFtrZXldO1xyXG4gIHJldHVybiB0cnVlO1xyXG59XHJcblxyXG4vLyBGXHUwMEZDciBBdWZydWZlciwgZGllIG9obmVoaW4gZ2VyYWRlIGluIHByb2Nlc3NGcm9udE1hdHRlciBzY2hyZWliZW4gKHouIEIuXHJcbi8vIGFwcGx5VHlwZVByb3BlcnRpZXMvX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qcyk6IHNvcnRpZXJ0IGRhc1xyXG4vLyBPYmpla3QgZGlyZWt0IG1pdCBhdXNkclx1MDBGQ2NrbGljaCBcdTAwRkNiZXJnZWJlbmVtIFRZUC9TdWJ0eXAgLSBkZXIgSW5kZXggYnp3LlxyXG4vLyBNZXRhZGF0YS1DYWNoZSBrZW5udCBkaWUgZ2VyYWRlIGdlc2NocmllYmVuZW4gV2VydGUgenUgZGllc2VtIFplaXRwdW5rdFxyXG4vLyBub2NoIG5pY2h0LlxyXG5mdW5jdGlvbiBzb3J0RnJvbnRtYXR0ZXJGb3IocGx1Z2luLCBmcm9udG1hdHRlciwgdHlwZSwgc3VidHlwZSkge1xyXG4gIGNvbnN0IGdsb2JhbE9yZGVyID0gbm9ybWFsaXplR2xvYmFsT3JkZXIocGx1Z2luLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIpO1xyXG4gIHJldHVybiBzb3J0RnJvbnRtYXR0ZXJPYmplY3QoZnJvbnRtYXR0ZXIsIGdsb2JhbE9yZGVyLCBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCB0eXBlLCBzdWJ0eXBlKSk7XHJcbn1cclxuXHJcbi8vIFNldHp0IG51ciBkaWUgZWluZSBQcm9wZXJ0eSBrZXkgYW4gaWhyZW4gUGxhdHogbGF1dCBGcm9udG1hdHRlci1Tb3J0aWVydW5nLFxyXG4vLyBhbGxlIFx1MDBGQ2JyaWdlbiBibGVpYmVuIGluIGlocmVyIGJpc2hlcmlnZW4gUmVpaGVuZm9sZ2UgLSBmXHUwMEZDciBBdWZydWZlciwgZGllXHJcbi8vIGdlcmFkZSBlaW5lIFByb3BlcnR5IG5ldSBhbmdlbGVndCBoYWJlbiAoei4gQi4gRnJlZHMgUHJvcGVydHktQmFja2xpbmtpbmcpLFxyXG4vLyBkaWUgc29uc3QgYW0gRW5kZSBsYW5kZW4gd1x1MDBGQ3JkZSwgb2huZSBkYWZcdTAwRkNyIGdsZWljaCBkYXMgZ2FuemUsIGV2dGwuIGJld3Vzc3RcclxuLy8gYW5kZXJzIHNvcnRpZXJ0ZSBGcm9udG1hdHRlciB1bXp1c3RlbGxlbi4gVFlQL1NVQlRZUCB3ZXJkZW4gYXVzIGRlbVxyXG4vLyBcdTAwRkNiZXJnZWJlbmVuIE9iamVrdCBnZWxlc2VuLCBuaWNodCBhdXMgSW5kZXgvQ2FjaGUgKGRpZSBrZW5uZW4gaW5uZXJoYWxiIHZvblxyXG4vLyBwcm9jZXNzRnJvbnRNYXR0ZXIgZXZ0bC4gbm9jaCBlaW5lbiBcdTAwRTRsdGVyZW4gU3RhbmQpLlxyXG4vL1xyXG4vLyBQbGF0eiA9IGRpcmVrdCBoaW50ZXIgZGVtIG5cdTAwRTRjaHN0ZW4gVm9yZ1x1MDBFNG5nZXIsIGRlbiBrZXkgaW4gZGVyIHZvbGxzdFx1MDBFNG5kaWdcclxuLy8gc29ydGllcnRlbiBSZWloZW5mb2xnZSBoXHUwMEU0dHRlIChnYW56IG5hY2ggdm9ybiwgd2VubiBlcyBrZWluZW4gZ2lidCkuIExpZWZlcnRcclxuLy8gdHJ1ZSBiZWkgZWluZXIgXHUwMEM0bmRlcnVuZy5cclxuZnVuY3Rpb24gcGxhY2VQcm9wZXJ0eUZvcihwbHVnaW4sIGZyb250bWF0dGVyLCBrZXkpIHtcclxuICBjb25zdCBleGlzdGluZ0tleXMgPSBPYmplY3Qua2V5cyhmcm9udG1hdHRlcik7XHJcbiAgY29uc3QgYWN0dWFsS2V5ID0gZXhpc3RpbmdLZXlzLmZpbmQoKGspID0+IGsudG9Mb3dlckNhc2UoKSA9PT0ga2V5LnRvTG93ZXJDYXNlKCkpO1xyXG4gIGlmICghYWN0dWFsS2V5IHx8IGV4aXN0aW5nS2V5cy5sZW5ndGggPD0gMSkgcmV0dXJuIGZhbHNlO1xyXG5cclxuICBjb25zdCBnbG9iYWxPcmRlciA9IG5vcm1hbGl6ZUdsb2JhbE9yZGVyKHBsdWdpbi5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyKTtcclxuICBjb25zdCB0eXBlID0gdHlwZUtleU9mKHByb3BlcnR5VmFsdWUoZnJvbnRtYXR0ZXIsIFRZUF9QUk9QRVJUWSkpO1xyXG4gIGNvbnN0IHN1YnR5cGUgPSB0eXBlS2V5T2YocHJvcGVydHlWYWx1ZShmcm9udG1hdHRlciwgU1VCVFlQX1BST1BFUlRZKSk7XHJcbiAgY29uc3Qgc29ydGVkS2V5cyA9IGNvbXB1dGVTb3J0ZWRLZXlzKGV4aXN0aW5nS2V5cywgZ2xvYmFsT3JkZXIsIG9yZGVyZWREZWZhdWx0S2V5cyhwbHVnaW4sIHR5cGUsIHN1YnR5cGUpKTtcclxuXHJcbiAgY29uc3QgcmVzdCA9IGV4aXN0aW5nS2V5cy5maWx0ZXIoKGspID0+IGsgIT09IGFjdHVhbEtleSk7XHJcbiAgY29uc3QgcHJlZGVjZXNzb3IgPSBzb3J0ZWRLZXlzLnNsaWNlKDAsIHNvcnRlZEtleXMuaW5kZXhPZihhY3R1YWxLZXkpKS5wb3AoKTtcclxuICBjb25zdCBuZXdLZXlzID0gWy4uLnJlc3RdO1xyXG4gIG5ld0tleXMuc3BsaWNlKHByZWRlY2Vzc29yID09PSB1bmRlZmluZWQgPyAwIDogcmVzdC5pbmRleE9mKHByZWRlY2Vzc29yKSArIDEsIDAsIGFjdHVhbEtleSk7XHJcbiAgaWYgKG5ld0tleXMuZXZlcnkoKGssIGkpID0+IGsgPT09IGV4aXN0aW5nS2V5c1tpXSkpIHJldHVybiBmYWxzZTtcclxuXHJcbiAgY29uc3Qgc25hcHNob3QgPSB7IC4uLmZyb250bWF0dGVyIH07XHJcbiAgZm9yIChjb25zdCBrIG9mIGV4aXN0aW5nS2V5cykgZGVsZXRlIGZyb250bWF0dGVyW2tdO1xyXG4gIGZvciAoY29uc3QgayBvZiBuZXdLZXlzKSBmcm9udG1hdHRlcltrXSA9IHNuYXBzaG90W2tdO1xyXG4gIHJldHVybiB0cnVlO1xyXG59XHJcblxyXG4vLyBTb3J0aWVydCBlaW5lIGVpbnplbG5lLCBiZXJlaXRzIGJla2FubnRlIE5vdGl6ICh6LiBCLiBkaWUgYWt0aXZlIERhdGVpKS5cclxuYXN5bmMgZnVuY3Rpb24gc29ydFNpbmdsZUZpbGVGcm9udG1hdHRlcihhcHAsIHBsdWdpbiwgZmlsZSkge1xyXG4gIGNvbnN0IGdsb2JhbE9yZGVyID0gbm9ybWFsaXplR2xvYmFsT3JkZXIocGx1Z2luLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIpO1xyXG4gIC8vIFVuc2F1YmVyZSBUWVAtV2VydGUgKExpc3RlLCBSYW5kbGVlcnplaWNoZW4pIGhhYmVuIGtlaW5lIFN0YW5kYXJkbGlzdGUgLVxyXG4gIC8vIGRhbm4gZ3JlaWZ0IG51ciBkaWUgZ2xvYmFsZSBSZWloZW5mb2xnZSAoc2llaGUgdHlwZUtleU9mIGluIHR5cC1pbmRleC5qcykuXHJcbiAgY29uc3QgdHlwZSA9IHBsdWdpbi50eXBJbmRleC50eXBlT2YoZmlsZSk7XHJcbiAgY29uc3QgdHlwZURlZmF1bHRLZXlzID0gb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgdHlwZSwgcGx1Z2luLnR5cEluZGV4LnN1YnR5cGVPZihmaWxlKSk7XHJcbiAgcmV0dXJuIHNvcnRGaWxlRnJvbnRtYXR0ZXIoYXBwLCBmaWxlLCBnbG9iYWxPcmRlciwgdHlwZURlZmF1bHRLZXlzKTtcclxufVxyXG5cclxuLy8gb25seVR5cGU6IG9wdGlvbmFsIC0gYmVzY2hyXHUwMEU0bmt0IGRlbiBMYXVmIGF1ZiBOb3RpemVuIGdlbmF1IGRpZXNlcyBUeXBzLlxyXG4vLyBPaG5lIG9ubHlUeXBlIHdlcmRlbiBhbGxlIE5vdGl6ZW4gZ2Vwclx1MDBGQ2Z0LCBhdWNoIG9obmUgVFlQIG9kZXIgbWl0IGVpbmVtIFR5cFxyXG4vLyBvaG5lIGdlcGZsZWd0ZSBTdGFuZGFyZGxpc3RlIC0gZGllIGdsb2JhbCBmZXN0IHBvc2l0aW9uaWVydGVuIFByb3BlcnRpZXNcclxuLy8gKHouIEIuIGNzc2NsYXNzZXMpIHNvbGxlbiB1bmFiaFx1MDBFNG5naWcgdm9tIFR5cCB3aXJrZW4ga1x1MDBGNm5uZW4uIEZcdTAwRkNyIE5vdGl6ZW4sIGJlaVxyXG4vLyBkZW5lbiB3ZWRlciBlaW4gcGFzc2VuZGVyIFR5cC1CbG9jayBub2NoIGVpbmUgZGVyIGtvbmZpZ3VyaWVydGVuXHJcbi8vIEVpbnplbC1Qcm9wZXJ0aWVzIGdyZWlmdCwgYmxlaWJ0IGRpZSBiaXNoZXJpZ2UgUmVpaGVuZm9sZ2UgdW52ZXJcdTAwRTRuZGVydC5cclxuYXN5bmMgZnVuY3Rpb24gc29ydEFsbEZyb250bWF0dGVyKGFwcCwgcGx1Z2luLCBvbmx5VHlwZSkge1xyXG4gIGxldCBjaGVja2VkID0gMDtcclxuICBsZXQgY2hhbmdlZCA9IDA7XHJcbiAgY29uc3QgZ2xvYmFsT3JkZXIgPSBub3JtYWxpemVHbG9iYWxPcmRlcihwbHVnaW4uc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcik7XHJcbiAgLy8gTnVyIGF1c3NhZ2Vrclx1MDBFNGZ0aWcsIHdlbm4gZWluIGVpbnplbG5lciBUeXAgZWluZ2VncmVuenQgd3VyZGUgKHNvbnN0XHJcbiAgLy8gd2VjaHNlbHQgZGVyIFR5cCB2b24gRGF0ZWkgenUgRGF0ZWkpIC0gZlx1MDBGQ3IgZGllIFJcdTAwRkNja21lbGR1bmcgZGVzIEJlZmVobHNcclxuICAvLyBcIlRZUCBGcm9udG1hdHRlciBTb3J0aWVydW5nIGFrdHVhbGlzaWVyZW5cIiwgZmFsbHMgZlx1MDBGQ3IgZGVuIGdld1x1MDBFNGhsdGVuIFR5cFxyXG4gIC8vIGdhciBrZWluZSBUWVAtRnJvbnRtYXR0ZXItTGlzdGUgZ2VwZmxlZ3QgaXN0LlxyXG4gIGNvbnN0IGhhc1R5cGVEZWZhdWx0cyA9IG9ubHlUeXBlID8gb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgb25seVR5cGUpICE9PSBudWxsIDogbnVsbDtcclxuXHJcbiAgZm9yIChjb25zdCBmaWxlIG9mIGFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCkpIHtcclxuICAgIGlmICghcGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXMgJiYgYXBwLm1ldGFkYXRhQ2FjaGUuaXNVc2VySWdub3JlZChmaWxlLnBhdGgpKSBjb250aW51ZTtcclxuXHJcbiAgICBjb25zdCB0eXBlID0gcGx1Z2luLnR5cEluZGV4LnR5cGVPZihmaWxlKTtcclxuICAgIGlmIChvbmx5VHlwZSAmJiB0eXBlICE9PSBvbmx5VHlwZSkgY29udGludWU7XHJcblxyXG4gICAgY29uc3QgdHlwZURlZmF1bHRLZXlzID0gb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgdHlwZSwgcGx1Z2luLnR5cEluZGV4LnN1YnR5cGVPZihmaWxlKSk7XHJcbiAgICBjaGVja2VkKys7XHJcbiAgICBpZiAoYXdhaXQgc29ydEZpbGVGcm9udG1hdHRlcihhcHAsIGZpbGUsIGdsb2JhbE9yZGVyLCB0eXBlRGVmYXVsdEtleXMpKSBjaGFuZ2VkKys7XHJcbiAgfVxyXG5cclxuICByZXR1cm4geyBjaGVja2VkLCBjaGFuZ2VkLCBoYXNUeXBlRGVmYXVsdHMgfTtcclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSB7XHJcbiAgc29ydEFsbEZyb250bWF0dGVyLFxyXG4gIHNvcnRTaW5nbGVGaWxlRnJvbnRtYXR0ZXIsXHJcbiAgc29ydEZyb250bWF0dGVyRm9yLFxyXG4gIHBsYWNlUHJvcGVydHlGb3IsXHJcbiAgbm9ybWFsaXplR2xvYmFsT3JkZXIsXHJcbiAgREVGQVVMVF9HTE9CQUxfT1JERVIsXHJcbiAgVFlQX1BST1BFUlRZLFxyXG4gIFNVQlRZUF9QUk9QRVJUWSxcclxufTtcclxuIiwgImNvbnN0IHsgc2V0SWNvbiwgTm90aWNlIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IFRZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZLCBzb3J0QWxsRnJvbnRtYXR0ZXIgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLXNvcnRcIik7XG5cbi8vIEFuemVpZ2V0ZXh0IGRlciB2aWVyIG5pY2h0IGVudGZlcm5iYXJlbiBQbGF0emhhbHRlci1aZWlsZW4gLSBcInR5cFZhbHVlXCIgaXN0XG4vLyBkaWUgVFlQLVByb3BlcnR5IHNlbGJzdCwgXCJzdWJ0eXBWYWx1ZVwiIGFuYWxvZyBkaWUgU1VCVFlQLVByb3BlcnR5LCBcInR5cFwiXG4vLyBkaWUgVFlQLUZyb250bWF0dGVyLUxpc3RlIGRlcyBUWVBzIChzaWVoZVxuLy8gdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpLCBcIm90aGVyXCIgYWxsZSBQcm9wZXJ0aWVzLCBkaWUgd2VkZXIgZG9ydCBub2NoXG4vLyBpbiBkaWVzZXIgTGlzdGUgbmFtZW50bGljaCBnZWZcdTAwRkNocnQgd2VyZGVuLiBTaWVoZSBjb21wdXRlU29ydGVkS2V5cyBpblxuLy8gZnJvbnRtYXR0ZXItc29ydC5qcyBmXHUwMEZDciBkaWUgdGF0c1x1MDBFNGNobGljaGUgQXVmbFx1MDBGNnN1bmcgZGllc2VyIEJsXHUwMEY2Y2tlLlxuY29uc3QgUExBQ0VIT0xERVJfTEFCRUxTID0ge1xuICB0eXBWYWx1ZTogXCJUWVBcIixcbiAgc3VidHlwVmFsdWU6IFwiU1VCVFlQXCIsXG4gIHR5cDogXCJUWVAtRnJvbnRtYXR0ZXJcIixcbiAgb3RoZXI6IFwiU29uc3RpZ2UgUHJvcGVydGllc1wiLFxufTtcblxuLy8gRWRpdG9yIGZcdTAwRkNyIHBsdWdpbi5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyOiBlaW5lIHJlaW5lIE5hbWVuc2xpc3RlXG4vLyAoa2VpbmUgV2VydGUsIGRhaGVyIGtlaW4gZWlnZW5lciBwcml2YXRlLUFQSS1VbXdlZyBcdTAwRkNiZXIgT2JzaWRpYW5zXG4vLyBNZXRhZGF0YS1FZGl0b3ItV2lkZ2V0IHdpZSBpbiB0eXBlLWZyb250bWF0dGVyLWVkaXRvci5qcyBuXHUwMEY2dGlnKSBtaXRcbi8vIERyYWctYW5kLWRyb3AtU29ydGllcnVuZy4gRGllIGRyZWkgUGxhdHpoYWx0ZXItWmVpbGVuIHNpbmQgVGVpbCBkZXJzZWxiZW5cbi8vIExpc3RlLCBsYXNzZW4gc2ljaCB2ZXJzY2hpZWJlbiwgYWJlciBuaWNodCBwZXIgVUkgZW50ZmVybmVuLlxuZnVuY3Rpb24gbW91bnRHbG9iYWxPcmRlckVkaXRvcihjb250YWluZXJFbCwgcGx1Z2luKSB7XG4gIGNvbnN0IGhlYWRlciA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1mcm9udG1hdHRlci1oZWFkZXJcIiB9KTtcblxuICAvLyBFaWdlbmUgR3J1cHBlIGZcdTAwRkNyIEJ1dHRvbiArIFx1MDBEQ2JlcnNjaHJpZnQsIHN0YXR0IGJlaWRlIGFscyBnZXRyZW5udGUgS2luZGVyXG4gIC8vIHZvbiBoZWFkZXIgZGlyZWt0OiBiZWkganVzdGlmeS1jb250ZW50OiBzcGFjZS1iZXR3ZWVuIChzaWVoZSBDU1MpIHdcdTAwRkNyZGVcbiAgLy8gZWluIGRyaXR0ZXMgS2luZCB6d2lzY2hlbiBcdTAwRENiZXJzY2hyaWZ0IHVuZCBcIitcIi1CdXR0b24gc29uc3QgbWl0dGlnIGltXG4gIC8vIHZlcmJsZWliZW5kZW4gUGxhdHogbGFuZGVuLCBzdGF0dCBkaXJla3QgbmViZW4gZGVyIFx1MDBEQ2JlcnNjaHJpZnQgenUgc2l0emVuLlxuICBjb25zdCB0aXRsZUdyb3VwID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1mcm9udG1hdHRlci10aXRsZS1ncm91cFwiIH0pO1xuXG4gIC8vIFdlbmRldCBkaWUgYWt0dWVsbGUgUmVpaGVuZm9sZ2Ugc29mb3J0IGF1ZiBkZW4gZ2VzYW10ZW4gVmF1bHQgYW4gLSBkZXJzZWxiZVxuICAvLyBMYXVmIHdpZSBkZXIgQmVmZWhsIFwiRnJvbnRtYXR0ZXIgU29ydGllcnVuZyBHTE9CQUwgYWt0dWFsaXNpZXJlblwiXG4gIC8vIChzb3J0QWxsRnJvbnRtYXR0ZXIgbWl0IG9ubHlUeXBlIG51bGwpLCBudXIgZGlyZWt0IG5lYmVuIGRlciBMaXN0ZVxuICAvLyBlcnJlaWNoYmFyIHN0YXR0IFx1MDBGQ2JlciBkaWUgQmVmZWhsc3BhbGV0dGUuXG4gIGNvbnN0IGFwcGx5QnRuID0gdGl0bGVHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb25cIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJBdWYgYWxsZSBOb3RpemVuIGFud2VuZGVuXCIgfSB9KTtcbiAgc2V0SWNvbihhcHBseUJ0biwgXCJwbGF5XCIpO1xuICBhcHBseUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCB7IGNoZWNrZWQsIGNoYW5nZWQgfSA9IGF3YWl0IHNvcnRBbGxGcm9udG1hdHRlcihwbHVnaW4uYXBwLCBwbHVnaW4sIG51bGwpO1xuICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgY2hhbmdlZCA+IDBcbiAgICAgICAgICA/IGBGcm9udG1hdHRlciBTb3J0aWVydW5nOiAke2NoZWNrZWR9IE5vdGl6ZW4gZ2Vwclx1MDBGQ2Z0LCAke2NoYW5nZWR9IHNvcnRpZXJ0LmBcbiAgICAgICAgICA6IGBGcm9udG1hdHRlciBTb3J0aWVydW5nOiAke2NoZWNrZWR9IE5vdGl6ZW4gZ2Vwclx1MDBGQ2Z0LCBiZXJlaXRzIGFsbGUgc29ydGllcnQuYFxuICAgICAgKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihcIltGcm9udG1hdHRlciBTb3J0aWVydW5nXVwiLCBlcnJvcik7XG4gICAgICBuZXcgTm90aWNlKGBGcm9udG1hdHRlciBTb3J0aWVydW5nIGZlaGxnZXNjaGxhZ2VuOiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgfVxuICB9KTtcblxuICB0aXRsZUdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtc2VjdGlvbi10aXRsZVwiLCB0ZXh0OiBcIkdsb2JhbGUgUHJvcGVydHktUmVpaGVuZm9sZ2VcIiB9KTtcblxuICBjb25zdCBhZGRCdG4gPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiUHJvcGVydHkgaGluenVmXHUwMEZDZ2VuXCIgfSB9KTtcbiAgc2V0SWNvbihhZGRCdG4sIFwicGx1c1wiKTtcblxuICBjb25zdCBsaXN0RWwgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC1vcmRlci1saXN0XCIgfSk7XG5cbiAgY29uc3Qgb3JkZXIgPSAoKSA9PiBwbHVnaW4uc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcjtcblxuICAvLyBOZXVlIFplaWxlIHdpcmQgZXJzdCBiZWkgZWluZW0gZ1x1MDBGQ2x0aWdlbiwgbmljaHQtbGVlcmVuIE5hbWVuIHRhdHNcdTAwRTRjaGxpY2ggaW5cbiAgLy8gcGx1Z2luLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIgYXVmZ2Vub21tZW4gKHVuZCBkYW1pdCBwb3RlbnppZWxsXG4gIC8vIGdlc3BlaWNoZXJ0KSAtIGJpcyBkYWhpbiBleGlzdGllcnQgc2llIG51ciBhbHMgbG9rYWxlciBFbnR3dXJmLCBkZXIgYmVpbVxuICAvLyBSZS1SZW5kZXIgenVzXHUwMEU0dHpsaWNoIGFucyBFbmRlIGRlciBlY2h0ZW4gTGlzdGUgZ2VoXHUwMEU0bmd0IHdpcmQuIFNvIGxhbmRlblxuICAvLyBsZWVyZSBQcm9wZXJ0eS1GZWxkZXIgbmllIGluIGRlbiBFaW5zdGVsbHVuZ2VuLCBzZWxic3Qgd2VubiB6d2lzY2hlbmR1cmNoXG4gIC8vIGF1cyBhbmRlcmVtIEFubGFzcyAoei4gQi4gVmVyc2NoaWViZW4gZWluZXIgYW5kZXJlbiBaZWlsZSkgZ2VzcGVpY2hlcnQgd2lyZC5cbiAgbGV0IGRyYWZ0RW50cnkgPSBudWxsO1xuXG4gIGNvbnN0IGlzRHVwbGljYXRlTmFtZSA9ICh2YWx1ZSwgb3duRW50cnkpID0+IHtcbiAgICBjb25zdCBsb3dlciA9IHZhbHVlLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKGxvd2VyID09PSBUWVBfUFJPUEVSVFkudG9Mb3dlckNhc2UoKSB8fCBsb3dlciA9PT0gU1VCVFlQX1BST1BFUlRZLnRvTG93ZXJDYXNlKCkpIHJldHVybiB0cnVlO1xuICAgIHJldHVybiBvcmRlcigpLnNvbWUoKG90aGVyKSA9PiBvdGhlciAhPT0gb3duRW50cnkgJiYgb3RoZXIua2luZCA9PT0gXCJwcm9wZXJ0eVwiICYmIG90aGVyLm5hbWUudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXIpO1xuICB9O1xuXG4gIGNvbnN0IHJlbmRlciA9ICgpID0+IHtcbiAgICBsaXN0RWwuZW1wdHkoKTtcbiAgICBjb25zdCBlbnRyaWVzID0gZHJhZnRFbnRyeSA/IFsuLi5vcmRlcigpLCBkcmFmdEVudHJ5XSA6IG9yZGVyKCk7XG5cbiAgICBlbnRyaWVzLmZvckVhY2goKGVudHJ5LCBpbmRleCkgPT4ge1xuICAgICAgY29uc3QgaXNEcmFmdCA9IGVudHJ5ID09PSBkcmFmdEVudHJ5O1xuICAgICAgY29uc3QgaXNQbGFjZWhvbGRlciA9IGVudHJ5LmtpbmQgIT09IFwicHJvcGVydHlcIjtcbiAgICAgIGNvbnN0IHJvd0NscyA9XG4gICAgICAgIFwiZnJlZC1vcmRlci1yb3dcIiArIChpc1BsYWNlaG9sZGVyID8gXCIgaXMtcGxhY2Vob2xkZXJcIiA6IFwiXCIpICsgKGVudHJ5LmtpbmQgPT09IFwidHlwXCIgPyBcIiBpcy10eXAtZGVmYXVsdHNcIiA6IFwiXCIpO1xuICAgICAgY29uc3Qgcm93ID0gbGlzdEVsLmNyZWF0ZURpdih7IGNsczogcm93Q2xzIH0pO1xuXG4gICAgICBjb25zdCBkcmFnSGFuZGxlID0gcm93LmNyZWF0ZURpdih7IGNsczogXCJmcmVkLW9yZGVyLWRyYWdcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJWZXJzY2hpZWJlblwiIH0gfSk7XG4gICAgICBzZXRJY29uKGRyYWdIYW5kbGUsIFwiZ3JpcC12ZXJ0aWNhbFwiKTtcblxuICAgICAgaWYgKGlzUGxhY2Vob2xkZXIpIHtcbiAgICAgICAgcm93LmNyZWF0ZURpdih7IGNsczogXCJmcmVkLW9yZGVyLWxhYmVsXCIsIHRleHQ6IFBMQUNFSE9MREVSX0xBQkVMU1tlbnRyeS5raW5kXSB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IGlucHV0ID0gcm93LmNyZWF0ZUVsKFwiaW5wdXRcIiwge1xuICAgICAgICAgIHR5cGU6IFwidGV4dFwiLFxuICAgICAgICAgIGNsczogXCJmcmVkLW9yZGVyLW5hbWUtaW5wdXRcIixcbiAgICAgICAgICBhdHRyOiB7IHBsYWNlaG9sZGVyOiBcIlByb3BlcnR5LU5hbWVcIiB9LFxuICAgICAgICB9KTtcbiAgICAgICAgaW5wdXQudmFsdWUgPSBlbnRyeS5uYW1lO1xuXG4gICAgICAgIC8vIFwiYmx1clwiIHN0YXR0IFwiY2hhbmdlXCI6IExldHp0ZXJlcyBmZXVlcnQgYmVpIGVpbmVtIGxlZXIgZ2VibGllYmVuZW5cbiAgICAgICAgLy8gRmVsZCBnYXIgbmljaHQgZXJzdCAoQnJvd3NlciBzZWhlbiBkYXJpbiBrZWluZSBXZXJ0XHUwMEU0bmRlcnVuZykgLSBkZXJcbiAgICAgICAgLy8gRW50d3VyZiB3XHUwMEZDcmRlIGRhbm4gbmllIGF1Zmdlclx1MDBFNHVtdC4gXCJibHVyXCIgZ3JlaWZ0IHp1dmVybFx1MDBFNHNzaWcgaW5cbiAgICAgICAgLy8gYmVpZGVuIEZcdTAwRTRsbGVuICh1bWJlbmVubmVuIHdpZSBsZWVyIGxhc3NlbikuXG4gICAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJibHVyXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBjb25zdCB2YWx1ZSA9IGlucHV0LnZhbHVlLnRyaW0oKTtcblxuICAgICAgICAgIGlmICghdmFsdWUpIHtcbiAgICAgICAgICAgIGlmIChpc0RyYWZ0KSB7XG4gICAgICAgICAgICAgIGRyYWZ0RW50cnkgPSBudWxsO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgb3JkZXIoKS5zcGxpY2Uob3JkZXIoKS5pbmRleE9mKGVudHJ5KSwgMSk7XG4gICAgICAgICAgICAgIGF3YWl0IHBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlbmRlcigpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChpc0R1cGxpY2F0ZU5hbWUodmFsdWUsIGlzRHJhZnQgPyBudWxsIDogZW50cnkpKSB7XG4gICAgICAgICAgICBuZXcgTm90aWNlKGBcIiR7dmFsdWV9XCIgaXN0IGJlcmVpdHMgaW4gZGVyIExpc3RlLmApO1xuICAgICAgICAgICAgaW5wdXQudmFsdWUgPSBlbnRyeS5uYW1lO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGVudHJ5Lm5hbWUgPSB2YWx1ZTtcbiAgICAgICAgICBpZiAoaXNEcmFmdCkge1xuICAgICAgICAgICAgb3JkZXIoKS5wdXNoKGVudHJ5KTtcbiAgICAgICAgICAgIGRyYWZ0RW50cnkgPSBudWxsO1xuICAgICAgICAgIH1cbiAgICAgICAgICBhd2FpdCBwbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgcmVuZGVyKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHJlbW92ZUJ0biA9IHJvdy5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC1vcmRlci1yZW1vdmUgY2xpY2thYmxlLWljb25cIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJFbnRmZXJuZW5cIiB9IH0pO1xuICAgICAgICBzZXRJY29uKHJlbW92ZUJ0biwgXCJ4XCIpO1xuICAgICAgICByZW1vdmVCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBpZiAoaXNEcmFmdCkge1xuICAgICAgICAgICAgZHJhZnRFbnRyeSA9IG51bGw7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIG9yZGVyKCkuc3BsaWNlKG9yZGVyKCkuaW5kZXhPZihlbnRyeSksIDEpO1xuICAgICAgICAgICAgYXdhaXQgcGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZW5kZXIoKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIC8vIERlciBFbnR3dXJmIGhhdCBub2NoIGtlaW5lbiBQbGF0eiBpbiBkZXIgZWNodGVuIExpc3RlIC0gVmVyc2NoaWViZW5cbiAgICAgIC8vIGVyZ2lidCBmXHUwMEZDciBpaG4ga2VpbmVuIFNpbm4sIGJldm9yIGVyIFx1MDBGQ2JlcmhhdXB0IGVpbmVuIE5hbWVuIGhhdC5cbiAgICAgIGlmIChpc0RyYWZ0KSByZXR1cm47XG5cbiAgICAgIHJvdy5kcmFnZ2FibGUgPSB0cnVlO1xuICAgICAgcm93LmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnc3RhcnRcIiwgKGV2ZW50KSA9PiB7XG4gICAgICAgIGV2ZW50LmRhdGFUcmFuc2Zlci5lZmZlY3RBbGxvd2VkID0gXCJtb3ZlXCI7XG4gICAgICAgIGV2ZW50LmRhdGFUcmFuc2Zlci5zZXREYXRhKFwidGV4dC9wbGFpblwiLCBTdHJpbmcoaW5kZXgpKTtcbiAgICAgICAgcm93LmNsYXNzTGlzdC5hZGQoXCJpcy1kcmFnZ2luZ1wiKTtcbiAgICAgIH0pO1xuICAgICAgcm93LmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnZW5kXCIsICgpID0+IHJvdy5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJhZ2dpbmdcIikpO1xuICAgICAgcm93LmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnb3ZlclwiLCAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgLy8gT2JlcmUgb2RlciB1bnRlcmUgSFx1MDBFNGxmdGUgZGVyIFplaWxlIGVudHNjaGVpZGV0LCBvYiBkaWUgZ2V6b2dlbmVcbiAgICAgICAgLy8gWmVpbGUgZGF2b3Igb2RlciBkYWhpbnRlciBsYW5kZXQgLSBzb25zdCBsaWVcdTAwREZlIHNpY2ggbmllIFwibmFjaCBnYW56XG4gICAgICAgIC8vIHVudGVuXCIgYWJsZWdlbiAoQWJsZWdlbiBhdWYgZGVyIGxldHp0ZW4gWmVpbGUgaFx1MDBFNHR0ZSBpbW1lciBudXIgdm9yXG4gICAgICAgIC8vIGlociBlaW5nZWZcdTAwRkNndCkuXG4gICAgICAgIGNvbnN0IHJlY3QgPSByb3cuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICAgIGNvbnN0IGlzQWZ0ZXIgPSBldmVudC5jbGllbnRZIC0gcmVjdC50b3AgPiByZWN0LmhlaWdodCAvIDI7XG4gICAgICAgIHJvdy5jbGFzc0xpc3QudG9nZ2xlKFwiaXMtZHJvcC1iZWZvcmVcIiwgIWlzQWZ0ZXIpO1xuICAgICAgICByb3cuY2xhc3NMaXN0LnRvZ2dsZShcImlzLWRyb3AtYWZ0ZXJcIiwgaXNBZnRlcik7XG4gICAgICB9KTtcbiAgICAgIHJvdy5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ2xlYXZlXCIsICgpID0+IHJvdy5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJvcC1iZWZvcmVcIiwgXCJpcy1kcm9wLWFmdGVyXCIpKTtcbiAgICAgIHJvdy5hZGRFdmVudExpc3RlbmVyKFwiZHJvcFwiLCBhc3luYyAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgY29uc3QgaXNBZnRlciA9IHJvdy5jbGFzc0xpc3QuY29udGFpbnMoXCJpcy1kcm9wLWFmdGVyXCIpO1xuICAgICAgICByb3cuY2xhc3NMaXN0LnJlbW92ZShcImlzLWRyb3AtYmVmb3JlXCIsIFwiaXMtZHJvcC1hZnRlclwiKTtcblxuICAgICAgICBjb25zdCBmcm9tSW5kZXggPSBOdW1iZXIoZXZlbnQuZGF0YVRyYW5zZmVyLmdldERhdGEoXCJ0ZXh0L3BsYWluXCIpKTtcbiAgICAgICAgaWYgKE51bWJlci5pc05hTihmcm9tSW5kZXgpKSByZXR1cm47XG5cbiAgICAgICAgLy8gWmllbHBvc2l0aW9uIGltIEFycmF5IFZPUiBkZW0gRW50ZmVybmVuIHZvbiBmcm9tSW5kZXggZ2VkYWNodCAtXG4gICAgICAgIC8vIFwibmFjaCBkaWVzZXIgWmVpbGVcIiBoZWlcdTAwREZ0OiBkaXJla3Qgdm9yIGRlciBqZXdlaWxzIG5cdTAwRTRjaHN0ZW4uXG4gICAgICAgIGxldCBpbnNlcnRCZWZvcmUgPSBpc0FmdGVyID8gaW5kZXggKyAxIDogaW5kZXg7XG4gICAgICAgIGlmIChmcm9tSW5kZXggPCBpbnNlcnRCZWZvcmUpIGluc2VydEJlZm9yZSAtPSAxO1xuXG4gICAgICAgIGNvbnN0IFttb3ZlZF0gPSBvcmRlcigpLnNwbGljZShmcm9tSW5kZXgsIDEpO1xuICAgICAgICBvcmRlcigpLnNwbGljZShpbnNlcnRCZWZvcmUsIDAsIG1vdmVkKTtcbiAgICAgICAgYXdhaXQgcGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICByZW5kZXIoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9O1xuXG4gIGFkZEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgIGlmICghZHJhZnRFbnRyeSkge1xuICAgICAgZHJhZnRFbnRyeSA9IHsga2luZDogXCJwcm9wZXJ0eVwiLCBuYW1lOiBcIlwiIH07XG4gICAgICByZW5kZXIoKTtcbiAgICB9XG4gICAgY29uc3QgaW5wdXRzID0gbGlzdEVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIuZnJlZC1vcmRlci1uYW1lLWlucHV0XCIpO1xuICAgIGlucHV0c1tpbnB1dHMubGVuZ3RoIC0gMV0/LmZvY3VzKCk7XG4gIH0pO1xuXG4gIHJlbmRlcigpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgbW91bnRHbG9iYWxPcmRlckVkaXRvciB9O1xuIiwgImNvbnN0IHsgZ2V0U3VidHlwZSB9ID0gcmVxdWlyZShcIi4vc3VidHlwZXNcIik7XHJcblxyXG4vLyBGYXJiZSBlaW5lcyBUWVBzIG9obmUgZWlnZW5lIEZhcmJlIC0gaGllciBzdGF0dCBpbiB0eXAtdmlldy5qcywgd2VpbCBzaWVcclxuLy8gdW50ZXJoYWxiIGRlciBWaWV3IGdlYnJhdWNodCB3aXJkIChzaWVoZSBuYW1lQ29sb3IpOyB0eXAtdmlldy5qcyByZWljaHQgc2llXHJcbi8vIHVudmVyXHUwMEU0bmRlcnQgd2VpdGVyLCBkYW1pdCBiZXN0ZWhlbmRlIEltcG9ydGUgZG9ydCBnXHUwMEZDbHRpZyBibGVpYmVuLlxyXG5jb25zdCBERUZBVUxUX1RZUEVfQ09MT1IgPSBcIiM4ODg4ODhcIjtcclxuXHJcbi8vIC0tLSBTdWJ0eXAtRmFyYmVuIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuLy8gRWluIFN1YnR5cCBzcGVpY2hlcnQga2VpbmUgZWlnZW5lIEZhcmJlLCBzb25kZXJuIG51ciBlaW5lIEFid2VpY2h1bmcgdm9uIGRlclxyXG4vLyBGYXJiZSBzZWluZXMgVFlQcyAoc2V0dGluZ3MudHlwZVN1YnR5cGVzW1RZUF1bU1VCVFlQXS5jb2xvciA9IHsgaCwgbCB9OyBpblxyXG4vLyBCZXN0YW5kc2RhdGVuIHN0ZWh0IGRvcnQgbm9jaCBlaW4gd2lya3VuZ3Nsb3NlcyBzLCBzaWVoZVxyXG4vLyBTVUJUWVBFX0NPTE9SX0NIQU5ORUxTKS5cclxuLy8gRGllIHRhdHNcdTAwRTRjaGxpY2hlIEZhcmJlIHdpcmQgamVkZXMgTWFsIGF1cyBkZXIgYWt0dWVsbGVuIFRZUC1GYXJiZSBiZXJlY2huZXRcclxuLy8gLSBcdTAwRTRuZGVydCBzaWNoIGRpZSwgemllaGVuIGFsbGUgU3VidHlwZW4gbWl0IHVuZCBibGVpYmVuIGluIGRlciBGYXJiZmFtaWxpZS5cclxuLy8gR2VyZWNobmV0IHdpcmQgaW4gT0tMQ0ggc3RhdHQgSFNMOiBkb3J0IHdpcmt0IGVpbmUgSGVsbGlna2VpdHNcdTAwRTRuZGVydW5nIFx1MDBGQ2JlclxyXG4vLyBhbGxlIEZhcmJ0XHUwMEY2bmUgXHUwMEU0aG5saWNoIHN0YXJrIChpbiBIU0wgd1x1MDBFNHJlIHouIEIuIEdlbGIgYmVpIGdsZWljaGVtIFdlcnQgdmllbFxyXG4vLyBoZWxsZXIgYWxzIEJsYXUpLiBPaG5lIGVpZ2VuZSBFaW5zdGVsbHVuZyBoYXQgZWluIFN1YnR5cCBkaWUgVFlQLUZhcmJlLlxyXG4vLyAgIGg6IEZhcmJ0b24sIHZlcnNjaG9iZW4gdW0gR3JhZDtcclxuLy8gICBsOiBIZWxsaWdrZWl0IGluICUgZGVzIFdlZ3MgenUgV2VpXHUwMERGICgrKSBiencuIFNjaHdhcnogKC0pLlxyXG4vLyBXYXJ1bSBiZWlkZSByZWxhdGl2IHJlY2huZW4gdW5kIGRpZSBTXHUwMEU0dHRpZ3VuZyBkYWJlaSB2b24gYWxsZWluIG1pdHppZWh0LFxyXG4vLyBzdGVodCBhdXNmXHUwMEZDaHJsaWNoIGFuIGFwcGx5Q29sb3JPZmZzZXQuXHJcbi8vIFdpZSB3ZWl0IGVpbiBTdWJ0eXAgamV3ZWlscyBhYndlaWNoZW4gZGFyZiAoXHUwMEIxKSwgaXN0IGVpbnN0ZWxsYmFyXHJcbi8vIChzZXR0aW5ncy5zdWJ0eXBlQ29sb3JSYW5nZXMsIHNpZWhlIHNldHRpbmdzLmpzKSAtIGVpbmUgc2Nob24gZWluZ2VzdGVsbHRlXHJcbi8vIEFid2VpY2h1bmcgd2lyZCBiZWltIFZlcmtsZWluZXJuIGRlciBHcmVuemUgZGFyYXVmIGdla2FwcHQuXHJcbi8vIERpZXNlIExpc3RlIGlzdCBkaWUgZWluemlnZSBRdWVsbGU6IGF1cyBpaHIgYmF1ZW4gc2ljaCBkaWUgUmVnbGVyIGltXHJcbi8vIFBvcG92ZXIsIGRpZSBHcmVuemVuIGluIGRlbiBFaW5zdGVsbHVuZ2VuIHVuZCBkaWUgS2FwcHVuZy4gRWluIGhpZXJcclxuLy8gYXVza29tbWVudGllcnRlciBLYW5hbCB2ZXJzY2h3aW5kZXQgXHUwMEZDYmVyYWxsIHVuZCB3aXJkIG5pY2h0IG1laHIgZ2VzcGVpY2hlcnQuXHJcbi8vXHJcbi8vIERpZSBTXHUwMEU0dHRpZ3VuZyBpc3Qgc3RpbGxnZWxlZ3QuIFNpZSB3YXIgdXJzcHJcdTAwRkNuZ2xpY2ggblx1MDBGNnRpZywgdW0gYXVzenVnbGVpY2hlbixcclxuLy8gd2FzIEhlbGxpZ2tlaXQgdW5kIEZhcmJ0b24gZGVyIEZhcmJlIGFuIFNcdTAwRTR0dGlndW5nIHdlZ25haG1lbiAtIHNlaXQgYmVpZGVcclxuLy8gUmVnbGVyIGRpZSBTXHUwMEU0dHRpZ3VuZyB2b24gYWxsZWluIG1pdGZcdTAwRkNocmVuIChzaWVoZSBjb21wdXRlQ29sb3JPZmZzZXQpIGJsaWViXHJcbi8vIGlociBudXIgbm9jaCBkaWUgQXVzc2FnZSBcImRpZXNlciBTdWJ0eXAgbmltbXQgc2ljaCB6dXJcdTAwRkNja1wiLCB1bmQgZGFmXHUwMEZDciBsb2hudFxyXG4vLyBlaW4gZHJpdHRlciBSZWdsZXIgbmljaHQuIFp1bSBXaWVkZXJiZWxlYmVuOiBoaWVyLCBpblxyXG4vLyBERUZBVUxUX1NVQlRZUEVfQ09MT1JfUkFOR0VTLCBpbSBSZWNoZW53ZWcgdm9uIGNvbXB1dGVDb2xvck9mZnNldCB1bmQgYmVpXHJcbi8vIHJhbmdlTWF4L3JhbmdlRGVzYyBpbiBzZXR0aW5ncy5qcyBqZXdlaWxzIGRpZSBBdXNrb21tZW50aWVydW5nIGF1ZmhlYmVuLlxyXG4vLyBkb3duT25seTogZGVyIFJlZ2xlciByZWljaHQgbnVyIHZvbiAtR3JlbnplIGJpcyAwLiBFaW4gU3VidHlwIHNvbGwgc2ljaFxyXG4vLyB6dXJcdTAwRkNja25laG1lbiBkXHUwMEZDcmZlbiwgYWJlciBuaWNodCBrclx1MDBFNGZ0aWdlciBhdWZ0cmV0ZW4gYWxzIHNlaW4gVFlQIC0gYnVudGVyXHJcbi8vIGFscyBkaWUgSGF1cHRmYXJiZSB6aWVodCBkaWUgQXVmbWVya3NhbWtlaXQgZ2VuYXUgZmFsc2NoIGhlcnVtLlxyXG5jb25zdCBTVUJUWVBFX0NPTE9SX0NIQU5ORUxTID0gW1xyXG4gIHsga2V5OiBcImhcIiwgbGFiZWw6IFwiRmFyYnRvblwiLCB1bml0OiBcIlx1MDBCMFwiIH0sXHJcbiAgLy8geyBrZXk6IFwic1wiLCBsYWJlbDogXCJTXHUwMEU0dHRpZ3VuZ1wiLCB1bml0OiBcIiVcIiwgZG93bk9ubHk6IHRydWUgfSxcclxuICB7IGtleTogXCJsXCIsIGxhYmVsOiBcIkhlbGxpZ2tlaXRcIiwgdW5pdDogXCIlXCIgfSxcclxuXTtcclxuLy8gU3VidHlwZW4gc29sbGVuIHZvciBhbGxlbSB1bnRlcnNjaGVpZGJhciBzZWluOiBGYXJidG9uIHRyXHUwMEU0Z3QgZGF6dSBhbVxyXG4vLyBtZWlzdGVuIGJlaSB1bmQgYmVrb21tdCBkZW4gZ3JcdTAwRjZcdTAwREZ0ZW4gU3BpZWxyYXVtLCBIZWxsaWdrZWl0IGFscyB6d2VpdGUga2xhclxyXG4vLyBlcmtlbm5iYXJlIEFjaHNlIGViZW5mYWxscyByZWljaGxpY2guXHJcbmNvbnN0IERFRkFVTFRfU1VCVFlQRV9DT0xPUl9SQU5HRVMgPSB7IGg6IDM1LCAvKiBzOiA0MCwgKi8gbDogNDAgfTtcclxuXHJcbmZ1bmN0aW9uIGNvbG9yUmFuZ2Uoc2V0dGluZ3MsIGtleSkge1xyXG4gIGNvbnN0IHZhbHVlID0gTnVtYmVyKHNldHRpbmdzLnN1YnR5cGVDb2xvclJhbmdlcz8uW2tleV0pO1xyXG4gIHJldHVybiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpICYmIHZhbHVlID49IDAgPyB2YWx1ZSA6IERFRkFVTFRfU1VCVFlQRV9DT0xPUl9SQU5HRVNba2V5XTtcclxufVxyXG5cclxuLy8gVm9uIHdvIGJpcyB3byBlaW4gUmVnbGVyIHJlaWNodCAtIGVpbmUgU3RlbGxlIGZcdTAwRkNyIFBvcG92ZXIsIEthcHB1bmcgdW5kXHJcbi8vIFZlcmxhdWZzdm9yc2NoYXUsIGRhbWl0IGRpZSBkcmVpIG5pY2h0IGF1c2VpbmFuZGVybGF1ZmVuLlxyXG5mdW5jdGlvbiBjaGFubmVsQm91bmRzKHNldHRpbmdzLCBrZXkpIHtcclxuICBjb25zdCByYW5nZSA9IGNvbG9yUmFuZ2Uoc2V0dGluZ3MsIGtleSk7XHJcbiAgcmV0dXJuIFNVQlRZUEVfQ09MT1JfQ0hBTk5FTFMuZmluZCgoY2hhbm5lbCkgPT4gY2hhbm5lbC5rZXkgPT09IGtleSk/LmRvd25Pbmx5ID8gWy1yYW5nZSwgMF0gOiBbLXJhbmdlLCByYW5nZV07XHJcbn1cclxuXHJcbi8vIEFid2VpY2h1bmcgZWluZXMgU3VidHlwcywgYXVmIGRpZSBlaW5nZXN0ZWxsdGVuIEdyZW56ZW4gZ2VrYXBwdC5cclxuZnVuY3Rpb24gY2xhbXBlZE9mZnNldChzZXR0aW5ncywgb2Zmc2V0KSB7XHJcbiAgaWYgKCFvZmZzZXQpIHJldHVybiBudWxsO1xyXG4gIGNvbnN0IHJlc3VsdCA9IHt9O1xyXG4gIGZvciAoY29uc3QgeyBrZXkgfSBvZiBTVUJUWVBFX0NPTE9SX0NIQU5ORUxTKSB7XHJcbiAgICBjb25zdCBbbWluLCBtYXhdID0gY2hhbm5lbEJvdW5kcyhzZXR0aW5ncywga2V5KTtcclxuICAgIHJlc3VsdFtrZXldID0gTWF0aC5taW4obWF4LCBNYXRoLm1heChtaW4sIE51bWJlcihvZmZzZXRba2V5XSkgfHwgMCkpO1xyXG4gIH1cclxuICByZXR1cm4gcmVzdWx0O1xyXG59XHJcblxyXG5jb25zdCB0b0xpbmVhciA9IChjKSA9PiAoYyA8PSAwLjA0MDQ1ID8gYyAvIDEyLjkyIDogKChjICsgMC4wNTUpIC8gMS4wNTUpICoqIDIuNCk7XHJcbmNvbnN0IHRvR2FtbWEgPSAoYykgPT4gKGMgPD0gMC4wMDMxMzA4ID8gMTIuOTIgKiBjIDogMS4wNTUgKiBjICoqICgxIC8gMi40KSAtIDAuMDU1KTtcclxuXHJcbmZ1bmN0aW9uIGhleFRvT2tsY2goaGV4KSB7XHJcbiAgY29uc3QgbWF0Y2ggPSAvXiM/KFswLTlhLWZdezZ9KSQvaS5leGVjKGhleCA/PyBcIlwiKTtcclxuICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbDtcclxuICBjb25zdCBpbnQgPSBwYXJzZUludChtYXRjaFsxXSwgMTYpO1xyXG4gIGNvbnN0IFtyLCBnLCBiXSA9IFsoaW50ID4+IDE2KSAmIDI1NSwgKGludCA+PiA4KSAmIDI1NSwgaW50ICYgMjU1XS5tYXAoKGMpID0+IHRvTGluZWFyKGMgLyAyNTUpKTtcclxuICBjb25zdCBsID0gTWF0aC5jYnJ0KDAuNDEyMjIxNDcwOCAqIHIgKyAwLjUzNjMzMjUzNjMgKiBnICsgMC4wNTE0NDU5OTI5ICogYik7XHJcbiAgY29uc3QgbSA9IE1hdGguY2JydCgwLjIxMTkwMzQ5ODIgKiByICsgMC42ODA2OTk1NDUxICogZyArIDAuMTA3Mzk2OTU2NiAqIGIpO1xyXG4gIGNvbnN0IHMgPSBNYXRoLmNicnQoMC4wODgzMDI0NjE5ICogciArIDAuMjgxNzE4ODM3NiAqIGcgKyAwLjYyOTk3ODcwMDUgKiBiKTtcclxuICBjb25zdCBMID0gMC4yMTA0NTQyNTUzICogbCArIDAuNzkzNjE3Nzg1ICogbSAtIDAuMDA0MDcyMDQ2OCAqIHM7XHJcbiAgY29uc3QgQSA9IDEuOTc3OTk4NDk1MSAqIGwgLSAyLjQyODU5MjIwNSAqIG0gKyAwLjQ1MDU5MzcwOTkgKiBzO1xyXG4gIGNvbnN0IEIgPSAwLjAyNTkwNDAzNzEgKiBsICsgMC43ODI3NzE3NjYyICogbSAtIDAuODA4Njc1NzY2ICogcztcclxuICByZXR1cm4geyBMLCBDOiBNYXRoLmh5cG90KEEsIEIpLCBIOiAoKE1hdGguYXRhbjIoQiwgQSkgKiAxODApIC8gTWF0aC5QSSArIDM2MCkgJSAzNjAgfTtcclxufVxyXG5cclxuLy8gTGluZWFyZXMgc1JHQiwgS2FuXHUwMEU0bGUgZ2dmLiBhdVx1MDBERmVyaGFsYiB2b24gMC4uMSAoYXVcdTAwREZlcmhhbGIgZGVzIEZhcmJyYXVtcykuXHJcbmZ1bmN0aW9uIG9rbGNoVG9MaW5lYXIoeyBMLCBDLCBIIH0pIHtcclxuICBjb25zdCBBID0gQyAqIE1hdGguY29zKChIICogTWF0aC5QSSkgLyAxODApO1xyXG4gIGNvbnN0IEIgPSBDICogTWF0aC5zaW4oKEggKiBNYXRoLlBJKSAvIDE4MCk7XHJcbiAgY29uc3QgbCA9IChMICsgMC4zOTYzMzc3Nzc0ICogQSArIDAuMjE1ODAzNzU3MyAqIEIpICoqIDM7XHJcbiAgY29uc3QgbSA9IChMIC0gMC4xMDU1NjEzNDU4ICogQSAtIDAuMDYzODU0MTcyOCAqIEIpICoqIDM7XHJcbiAgY29uc3QgcyA9IChMIC0gMC4wODk0ODQxNzc1ICogQSAtIDEuMjkxNDg1NTQ4ICogQikgKiogMztcclxuICByZXR1cm4gW1xyXG4gICAgNC4wNzY3NDE2NjIxICogbCAtIDMuMzA3NzExNTkxMyAqIG0gKyAwLjIzMDk2OTkyOTIgKiBzLFxyXG4gICAgLTEuMjY4NDM4MDA0NiAqIGwgKyAyLjYwOTc1NzQwMTEgKiBtIC0gMC4zNDEzMTkzOTY1ICogcyxcclxuICAgIC0wLjAwNDE5NjA4NjMgKiBsIC0gMC43MDM0MTg2MTQ3ICogbSArIDEuNzA3NjE0NzAxICogcyxcclxuICBdO1xyXG59XHJcblxyXG5jb25zdCBpbkdhbXV0ID0gKHJnYikgPT4gcmdiLmV2ZXJ5KChjKSA9PiBjID49IC0wLjAwMDEgJiYgYyA8PSAxLjAwMDEpO1xyXG5cclxuLy8gR3JcdTAwRjZcdTAwREZ0ZXMgYmVpIGRpZXNlciBIZWxsaWdrZWl0IHVuZCBkaWVzZW0gRmFyYnRvbiBpbiBzUkdCIG5vY2ggZGFyc3RlbGxiYXJlc1xyXG4vLyBDaHJvbWEuIERpZXNlIEdyZW56ZSBzY2h3YW5rdCBzdGFyayAtIHJlaW5lcyBHZWxiIHZlcnRyXHUwMEU0Z3QgbnVyIGtuYXBwIHVudGVyXHJcbi8vIFdlaVx1MDBERiB2aWVsIENocm9tYSwgQmxhdSBhbSBtZWlzdGVuIGluIGRlciBNaXR0ZSAtLCB1bmQgZ2VuYXUgYW4gaWhyIHNjaGVpdGVydFxyXG4vLyBqZWRlIFJlY2hudW5nLCBkaWUgQ2hyb21hIGFic29sdXQgZmVzdGhcdTAwRTRsdCAoc2llaGUgYXBwbHlDb2xvck9mZnNldCkuXHJcbmZ1bmN0aW9uIG1heENocm9tYShMLCBIKSB7XHJcbiAgbGV0IGxvdyA9IDA7XHJcbiAgbGV0IGhpZ2ggPSAwLjQ7IC8vIFx1MDBGQ2JlciBkZW0gc1JHQi1NYXhpbXVtICh+MCwzMilcclxuICBmb3IgKGxldCBpID0gMDsgaSA8IDIwOyBpKyspIHtcclxuICAgIGNvbnN0IG1pZCA9IChsb3cgKyBoaWdoKSAvIDI7XHJcbiAgICBpZiAoaW5HYW11dChva2xjaFRvTGluZWFyKHsgTCwgQzogbWlkLCBIIH0pKSkgbG93ID0gbWlkO1xyXG4gICAgZWxzZSBoaWdoID0gbWlkO1xyXG4gIH1cclxuICByZXR1cm4gbG93O1xyXG59XHJcblxyXG4vLyBMaWVndCBkaWUgRmFyYmUgYXVcdTAwREZlcmhhbGIgdm9uIHNSR0IsIHdpcmQgZGllIFNcdTAwRTR0dGlndW5nIChDaHJvbWEpIHNvIHdlaXRcclxuLy8gdmVycmluZ2VydCwgYmlzIHNpZSBkYXJzdGVsbGJhciBpc3QgLSBGYXJidG9uIHVuZCBIZWxsaWdrZWl0IGJsZWliZW4uIEZcdTAwRkNyXHJcbi8vIGFwcGx5Q29sb3JPZmZzZXQgaXN0IGRhcyBudXIgbm9jaCBlaW4gU2ljaGVyaGVpdHNuZXR6OiBkb3J0IHN0ZWh0IGRhc1xyXG4vLyBDaHJvbWEgb2huZWhpbiBzY2hvbiBhbHMgQW50ZWlsIGRlcyBkYXJzdGVsbGJhcmVuIE1heGltdW1zIGZlc3QuXHJcbmZ1bmN0aW9uIG9rbGNoVG9IZXgoY29sb3IpIHtcclxuICBsZXQgcmdiID0gb2tsY2hUb0xpbmVhcihjb2xvcik7XHJcbiAgaWYgKCFpbkdhbXV0KHJnYikpIHJnYiA9IG9rbGNoVG9MaW5lYXIoeyAuLi5jb2xvciwgQzogbWF4Q2hyb21hKGNvbG9yLkwsIGNvbG9yLkgpIH0pO1xyXG4gIHJldHVybiAoXHJcbiAgICBcIiNcIiArXHJcbiAgICByZ2JcclxuICAgICAgLm1hcCgoYykgPT4gTWF0aC5yb3VuZChNYXRoLm1pbigxLCBNYXRoLm1heCgwLCB0b0dhbW1hKE1hdGgubWluKDEsIE1hdGgubWF4KDAsIGMpKSkpKSAqIDI1NSkpXHJcbiAgICAgIC5tYXAoKGMpID0+IGMudG9TdHJpbmcoMTYpLnBhZFN0YXJ0KDIsIFwiMFwiKSlcclxuICAgICAgLmpvaW4oXCJcIilcclxuICApO1xyXG59XHJcblxyXG4vLyBIZWxsaWdrZWl0IGRlcyBTY2hlaXRlbHMgZWluZXMgRmFyYnRvbnM6IGRvcnQgdHJcdTAwRTRndCBlciBkYXMgbWVpc3RlIENocm9tYS5cclxuLy8gbWF4Q2hyb21hIHN0ZWlndCBcdTAwRkNiZXIgZGllIEhlbGxpZ2tlaXQgYmlzIGRvcnRoaW4gdW5kIGZcdTAwRTRsbHQgZGFuYWNoIHdpZWRlciwgc29cclxuLy8gZGFzcyBkaWUgU3BpdHplIHNpY2ggZWlua3JlaXNlbiBsXHUwMEU0c3N0LiBKZSBGYXJidG9uIGVpbiBmZXN0ZXIgV2VydCwgdW5kIGRpZVxyXG4vLyBTdWNoZSBpc3QgdGV1ZXIgLSBkYXJ1bSBuYWNoIGdhbnplbiBHcmFkIGdlbWVya3QuXHJcbmNvbnN0IGN1c3BDYWNoZSA9IG5ldyBNYXAoKTtcclxuXHJcbi8vIEFiIGhpZXIgZ2lsdCBlaW5lIEZhcmJlIGFscyBidW50LiBFaW4gcmVpbmVzIEdyYXUga29tbXQgYXVzIGhleFRvT2tsY2ggbmljaHRcclxuLy8gbWl0IENocm9tYSAwIHp1clx1MDBGQ2NrLCBzb25kZXJuIG1pdCBydW5kIDJlLTggdW5kIGVpbmVtIGJlbGllYmlnZW4gRmFyYnRvbiAtXHJcbi8vIGRpZSBNYXRyaXhrb25zdGFudGVuIHNpbmQgZ2VydW5kZXQuIEF1ZiBcImdyXHUwMEY2XHUwMERGZXIgYWxzIDBcIiB6dSBwclx1MDBGQ2ZlbiBmXHUwMEZDaHJ0ZSBkaWVcclxuLy8gSGVsbGlna2VpdCBlaW5lcyBHcmF1cyBhbHNvIGRlbSBTY2hlaXRlbCBlaW5lcyBGYXJidG9ucyBuYWNoLCBkZW4gZXMgZ2FyXHJcbi8vIG5pY2h0IGhhdC4gRGllIFNjaHdlbGxlIGxpZWd0IHdlaXQgdW50ZXIgYWxsZW0sIHdhcyBpbiA4IEJpdCBzaWNodGJhciB3XHUwMEU0cmVcclxuLy8gKGVpbiBTY2hyaXR0IHZvbiAxLzI1NSBpbiBlaW5lbSBLYW5hbCBlcmdpYnQgcnVuZCAwLDAwMikuXHJcbmNvbnN0IE5FVVRSQUxfQ0hST01BID0gMWUtNDtcclxuXHJcbmZ1bmN0aW9uIGN1c3BMaWdodG5lc3MoSCkge1xyXG4gIGNvbnN0IGtleSA9IE1hdGgucm91bmQoSCkgJSAzNjA7XHJcbiAgY29uc3QgY2FjaGVkID0gY3VzcENhY2hlLmdldChrZXkpO1xyXG4gIGlmIChjYWNoZWQgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGNhY2hlZDtcclxuICBsZXQgbG93ID0gMDtcclxuICBsZXQgaGlnaCA9IDE7XHJcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCAyNDsgaSsrKSB7XHJcbiAgICBjb25zdCB0aGlyZCA9IChoaWdoIC0gbG93KSAvIDM7XHJcbiAgICBpZiAobWF4Q2hyb21hKGxvdyArIHRoaXJkLCBrZXkpIDwgbWF4Q2hyb21hKGhpZ2ggLSB0aGlyZCwga2V5KSkgbG93ICs9IHRoaXJkO1xyXG4gICAgZWxzZSBoaWdoIC09IHRoaXJkO1xyXG4gIH1cclxuICBjb25zdCByZXN1bHQgPSAobG93ICsgaGlnaCkgLyAyO1xyXG4gIGN1c3BDYWNoZS5zZXQoa2V5LCByZXN1bHQpO1xyXG4gIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbi8vIERpZXNlbGJlIEhlbGxpZ2tlaXQsIGFiZXIgZ2VtZXNzZW4gYW0gU2NoZWl0ZWwgZGVzIFppZWxmYXJidG9ucyBzdGF0dCBhbVxyXG4vLyBlaWdlbmVuOiBkZXIgU2NoZWl0ZWwgZ2VodCBhdWYgZGVuIFNjaGVpdGVsLCBTY2h3YXJ6IGF1ZiBTY2h3YXJ6IHVuZCBXZWlcdTAwREZcclxuLy8gYXVmIFdlaVx1MDBERiwgZGF6d2lzY2hlbiBsaW5lYXIuIE9obmUgRmFyYnRvbmRyZWh1bmcga29tbXQgZGllIEhlbGxpZ2tlaXRcclxuLy8gdW52ZXJcdTAwRTRuZGVydCB6dXJcdTAwRkNjay5cclxuZnVuY3Rpb24gcmVtYXBUb0N1c3AoTCwgZnJvbUgsIHRvSCkge1xyXG4gIGNvbnN0IGZyb20gPSBjdXNwTGlnaHRuZXNzKGZyb21IKTtcclxuICBjb25zdCB0byA9IGN1c3BMaWdodG5lc3ModG9IKTtcclxuICBpZiAoTCA8PSBmcm9tKSByZXR1cm4gZnJvbSA+IDAgPyAoTCAvIGZyb20pICogdG8gOiB0bztcclxuICByZXR1cm4gZnJvbSA8IDEgPyB0byArICgoTCAtIGZyb20pIC8gKDEgLSBmcm9tKSkgKiAoMSAtIHRvKSA6IHRvO1xyXG59XHJcblxyXG4vLyBEaWUgYmVpZGVuIFN1Y2hlbiBuYWNoIGRlciBHYW11dC1HcmVuemUga29zdGVuIGplIEZhcmJlIHJ1bmQgMTAgXHUwMEI1cyAtIHp1XHJcbi8vIHZpZWwsIHdlbm4gZGVyIERhdGVpYmF1bSBvZGVyIGRlciBHcmFwaCBzaWUgZlx1MDBGQ3IgamVkZSBEYXRlaSBlcm5ldXQgYW5zdFx1MDBGNlx1MDBERnRcclxuLy8gKHNpZWhlIGNvbG9yRm9yRmlsZSkuIFZlcnNjaGllZGVuZSBGYXJiZW4gZ2lidCBlcyBkYWJlaSBudXIgZWluZSBIYW5kdm9sbCxcclxuLy8gZWluZSBqZSBUWVAvU1VCVFlQLCBhbHNvIGdlblx1MDBGQ2d0IGVpbiBad2lzY2hlbnNwZWljaGVyOyBiZWltIFppZWhlbiBlaW5lc1xyXG4vLyBSZWdsZXJzIHdcdTAwRTRjaHN0IGVyIHVtIGplZGUgWndpc2NoZW5zdGVsbHVuZyB1bmQgd2lyZCBkYXJ1bSBhYiB1bmQgenUgZ2VsZWVydC5cclxuY29uc3Qgb2Zmc2V0Q2FjaGUgPSBuZXcgTWFwKCk7XHJcblxyXG5mdW5jdGlvbiBhcHBseUNvbG9yT2Zmc2V0KGhleCwgb2Zmc2V0KSB7XHJcbiAgaWYgKCFvZmZzZXQpIHJldHVybiBoZXg7XHJcbiAgY29uc3QgY2FjaGVLZXkgPSBoZXggKyBcInxcIiArIChvZmZzZXQuaCA/PyAwKSArIFwifFwiICsgKG9mZnNldC5sID8/IDApO1xyXG4gIGNvbnN0IGNhY2hlZCA9IG9mZnNldENhY2hlLmdldChjYWNoZUtleSk7XHJcbiAgaWYgKGNhY2hlZCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gY2FjaGVkO1xyXG4gIGNvbnN0IHJlc3VsdCA9IGNvbXB1dGVDb2xvck9mZnNldChoZXgsIG9mZnNldCk7XHJcbiAgaWYgKG9mZnNldENhY2hlLnNpemUgPiA1MDApIG9mZnNldENhY2hlLmNsZWFyKCk7XHJcbiAgb2Zmc2V0Q2FjaGUuc2V0KGNhY2hlS2V5LCByZXN1bHQpO1xyXG4gIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbi8vIEJlaWRlIFJlZ2xlciB3aXJrZW4gcmVsYXRpdiB6dXIgVFlQLUZhcmJlLCBkYW1pdCBkZXIgU3VidHlwIGluIGRlclxyXG4vLyBGYW1pbGllIGJsZWlidC4gQWJzb2x1dGUgV2VydGUgaGFsdGVuIG5pY2h0LCB3YXMgc2llIHZlcnNwcmVjaGVuLCBkZW5uIHdpZVxyXG4vLyB2aWVsIEZhcmJlIHNSR0IgXHUwMEZDYmVyaGF1cHQgaGVyZ2lidCwgaFx1MDBFNG5ndCB2b24gSGVsbGlna2VpdCBVTkQgRmFyYnRvbiBhYjpcclxuLy8gICBsOiBBbnRlaWwgZGVzIFdlZ3MgenUgV2VpXHUwMERGICgrKSBiencuIFNjaHdhcnogKC0pLiBBYnNvbHV0ZSBPS0xDSC1QdW5rdGVcclxuLy8gICAgICBsaWVmZW4gYmVpIGVpbmVyIG9obmVoaW4gaGVsbGVuIFRZUC1GYXJiZSBzY2hvbiBpbiBkZXIgZXJzdGVuXHJcbi8vICAgICAgUmVnbGVyaFx1MDBFNGxmdGUgYXVmIHJlaW5lcyBXZWlcdTAwREYsIHVuZCBkZXIgUmVzdCBkZXMgUmVnbGVycyB0YXQgbmljaHRzIG1laHIuXHJcbi8vICAgaDogR3JhZCAtIGFscyBlaW56aWdlciBhYnNvbHV0LCBBQkVSIGVyIGZcdTAwRkNocnQgZGllIEhlbGxpZ2tlaXQgbWl0IChzaWVoZVxyXG4vLyAgICAgIHJlbWFwVG9DdXNwKS4gSmVkZXIgRmFyYnRvbiB0clx1MDBFNGd0IHNlaW4gbWVpc3RlcyBDaHJvbWEgYXVmIGVpbmVyIGFuZGVyZW5cclxuLy8gICAgICBIZWxsaWdrZWl0OiBHZWxiIGVyc3QgYmVpIEwgMCw5MiwgT3JhbmdlIHNjaG9uIGJlaSAwLDc4LCBCbGF1IGJlaSAwLDQ5LlxyXG4vLyAgICAgIEVpbmUgaGVsbGUgZ2VsYmUgVFlQLUZhcmJlIGF1ZiBPcmFuZ2UgenUgZHJlaGVuIHVuZCBkYWJlaSBkaWVcclxuLy8gICAgICBIZWxsaWdrZWl0IGZlc3R6dWhhbHRlbiwgc2V0enQgc2llIHdlaXQgXHUwMEZDYmVyIGRlbiBTY2hlaXRlbCB2b24gT3JhbmdlIC1cclxuLy8gICAgICBkb3J0IHRyXHUwMEU0Z3QgZGVyIEZhcmJyYXVtIGZhc3Qga2VpbiBDaHJvbWEgbWVociwgdW5kIGhlcmF1cyBrb21tdCBlaW5cclxuLy8gICAgICBibGFzc2VzIFBhc3RlbGwsIGRhcyBuZWJlbiBzZWluZW0gVFlQIHdpZSBhdXNnZXdhc2NoZW4gdW5kIHZpZWwgenUgaGVsbFxyXG4vLyAgICAgIHdpcmt0IChyZWNobmVyaXNjaCBpc3QgZXMgZ2VuYXVzbyBoZWxsLCBhYmVyIGJsYXNzIGxpZXN0IHNpY2ggYWxzIGhlbGwpLlxyXG4vLyAgICAgIEZcdTAwRkNocnQgZGllIEhlbGxpZ2tlaXQgZGFnZWdlbiBkZW4gU2NoZWl0ZWwgbmFjaCwgYmxlaWJ0IGRpZSBGYXJia3JhZnRcclxuLy8gICAgICBcdTAwRkNiZXIgZGllIGdhbnplIERyZWh1bmcgcHJha3Rpc2NoIGdsZWljaC5cclxuLy8gRWluZW4gZWlnZW5lbiBSZWdsZXIgZlx1MDBGQ3IgZGllIFNcdTAwRTR0dGlndW5nIGdpYnQgZXMgbmFjaCBhbGwgZGVtIG5pY2h0IG1laHIgLSBzaWVcclxuLy8gemllaHQgYmVpIGJlaWRlbiBhbmRlcmVuIHZvbiBhbGxlaW4gbWl0IChzdGlsbGdlbGVndCwgc2llaGVcclxuLy8gU1VCVFlQRV9DT0xPUl9DSEFOTkVMUykuXHJcbi8vXHJcbi8vIFNpbmQgZGllIEhlbGxpZ2tlaXRlbiBzbyBhdWZlaW5hbmRlciBiZXpvZ2VuLCBpc3QgYXVjaCBkYXMgQ2hyb21hIHdpZWRlclxyXG4vLyBzY2hsaWNodCBlaW4gQW50ZWlsIGFuIGRlciBEZWNrZSAoYmFzZS5DIC8gbWF4Q2hyb21hIGFtIEF1c2dhbmdzcHVua3QsIGRhbm5cclxuLy8gbWFsIG1heENocm9tYSBhbSBaaWVsKTogZGllIERlY2tlbiB6d2VpZXIgRmFyYnRcdTAwRjZuZSBzaW5kIGVyc3QgZGFkdXJjaFxyXG4vLyBcdTAwRkNiZXJoYXVwdCB2ZXJnbGVpY2hiYXIuXHJcbi8vXHJcbi8vIFdBUyBESUVTRVIgQU5URUlMIElTVCBVTkQgV0FTIE5JQ0hULiBcIkFudGVpbCBhbiBkZXIgRGVja2VcIiBpc3QgZWluZVxyXG4vLyBFbnRzY2hlaWR1bmcgXHUwMEZDYmVyIHNSR0IsIGtlaW5lIFx1MDBGQ2JlciBXYWhybmVobXVuZyAtIGRhcyBzaWVodCBtYW4gZGVtIENvZGVcclxuLy8gbmljaHQgYW4sIHdlaWwgZXIgc29uc3QgZHVyY2h3ZWcgaW4gZWluZW0gd2Focm5laG11bmdzbmFoZW4gUmF1bSByZWNobmV0LlxyXG4vLyBtYXhDaHJvbWEgYmVzY2hyZWlidCBkaWUgSFx1MDBGQ2xsZSBlaW5lcyBBdXNnYWJlZ2VyXHUwMEU0dHMuIEtvbnN0YW50IGdlaGFsdGVuIHdpcmRcclxuLy8gaGllciBhbHNvIFwiZ2xlaWNoIHdlaXQgYXVzZ2VyZWl6dFwiLCBuaWNodCBcImdsZWljaCBidW50XCIgKGRhcyB3XHUwMEU0cmUga29uc3RhbnRlc1xyXG4vLyBDKSB1bmQgbmljaHQgXCJnbGVpY2ggZ2VzXHUwMEU0dHRpZ3RcIiAoZGFzIHdcdTAwRTRyZSBrb25zdGFudGVzIEMvTCkuIERhcmF1cyBmb2xndDpcclxuLy8gICAtIERhcyBNb2RlbGwgaXN0IGFuIHNSR0IgZ2VidW5kZW4uIEluIGVpbmVtIHdlaXRlcmVuIEZhcmJyYXVtIGVyZ1x1MDBFNGJlblxyXG4vLyAgICAgZGllc2VsYmVuIEVpbmdhYmVuIGFuZGVyZSBGYXJiZW4sIHdlaWwgZGllIERlY2tlIHdvYW5kZXJzIGxpZWd0LlxyXG4vLyAgIC0gcmVtYXBUb0N1c3AgZ2lidCBnbGVpY2hlIHdhaHJnZW5vbW1lbmUgSGVsbGlna2VpdCBiZXd1c3N0IGF1ZjogbmFjaFxyXG4vLyAgICAgZWluZXIgRmFyYnRvbmRyZWh1bmcgaXN0IGRlciBTdWJ0eXAgbmljaHQgbWVociBnbGVpY2ggaGVsbCB3aWUgc2VpbiBUWVAsXHJcbi8vICAgICBzb25kZXJuIGdsZWljaCBuYWNoZHJcdTAwRkNja2xpY2guIERhcyBpc3QgaGllciBlcndcdTAwRkNuc2NodCwgYWJlciBlcyBpc3QgZWluZVxyXG4vLyAgICAgR2VzdGFsdHVuZ3NlbnRzY2hlaWR1bmcgdW5kIGtlaW4gcGVyemVwdHVlbGxlcyBHZXNldHouXHJcbi8vICAgLSBcdTAwRENiZXIgZGllIEhlbGxpZ2tlaXQgaXN0IGRhcyBDaHJvbWEgbmljaHQgbW9ub3Rvbi4gTGllZ3QgZWluZSBUWVAtRmFyYmVcclxuLy8gICAgIFx1MDBGQ2JlciBpaHJlbSBTY2hlaXRlbCwgc3RlaWd0IGVzIGF1ZiBkZW0gV2VnIG5hY2ggdW50ZW4gZXJzdCBhbiB1bmQgZlx1MDBFNGxsdFxyXG4vLyAgICAgZGFubiB3aWVkZXIgKGVpbiBibGF1ZXMgIzc4NzhkYyBoYXQgYmVpIC0yMCAlIG1laHIgQ2hyb21hIGFscyBiZWkgMCAlXHJcbi8vICAgICB1bmQgYmVpIC00MCAlKS4gRGVyIFJlZ2xlciBmXHUwMEU0aHJ0IGRvcnQgXHUwMEZDYmVyIGVpbmVuIEJ1Y2tlbC5cclxuLy8gRlx1MDBGQ3IgZmFyYmlnZSBEYXRlaW5hbWVuIGlzdCBhbGwgZGFzIHRyYWdiYXIgLSB3ZXIgZGFzIE1vZGVsbCBzdHJlbmdlciBoYWJlblxyXG4vLyB3aWxsLCBtXHUwMEZDc3N0ZSBkaWUgQmV6dWdzZ3JcdTAwRjZcdTAwREZlIHdlY2hzZWxuLCBuaWNodCBkaWUgRm9ybWVsbiBuYWNoYmVzc2Vybi5cclxuLy9cclxuLy8gQXVjaCBPS0xhYiBzZWxic3QgaXN0IG5pY2h0IHNwYW5udW5nc2ZyZWk6IHNlaW5lIEZhcmJ0b25saW5pZW4gbGF1ZmVuIGltXHJcbi8vIEJsYXViZXJlaWNoIChIIDI2MC0yOTApIG1lcmtsaWNoIGFuIGRlciBXYWhybmVobXVuZyB2b3JiZWksIEJsYXUgemllaHQgYmVpbVxyXG4vLyBBdWZoZWxsZW4gaW5zIFZpb2xldHRlLiBSZWNobmVyaXNjaCBibGVpYnQgZGVyIEZhcmJ0b24gZG9ydCBrb25zdGFudCwgd2FzXHJcbi8vIGRhcyBQcm9ibGVtIGVoZXIgdmVyZGVja3QgYWxzIGJlaGVidC4gRWluZSBUWVAtRmFyYmUgaW4gZGllc2VtIEJlcmVpY2ggYWxzb1xyXG4vLyBsaWViZXIgbmFjaHNlaGVuIGFscyBkZW4gWmFobGVuIGdsYXViZW4uXHJcbmZ1bmN0aW9uIGNvbXB1dGVDb2xvck9mZnNldChoZXgsIG9mZnNldCkge1xyXG4gIGNvbnN0IGJhc2UgPSBoZXhUb09rbGNoKGhleCk7XHJcbiAgaWYgKCFiYXNlKSByZXR1cm4gaGV4O1xyXG4gIGNvbnN0IEggPSAoYmFzZS5IICsgKG9mZnNldC5oID8/IDApICsgMzYwKSAlIDM2MDtcclxuICBjb25zdCBiYXNlQ2VpbGluZyA9IG1heENocm9tYShiYXNlLkwsIGJhc2UuSCk7XHJcbiAgLy8gRWluZSBncmF1ZSBUWVAtRmFyYmUgYmxlaWJ0IGdyYXUsIHVuZCBpaHIgRmFyYnRvbiBpc3QgYmVkZXV0dW5nc2xvcyAtIGRhbm5cclxuICAvLyBnaWJ0IGVzIGF1Y2gga2VpbmVuIFNjaGVpdGVsLCBkZW0gZGllIEhlbGxpZ2tlaXQgZm9sZ2VuIGtcdTAwRjZubnRlLlxyXG4gIGNvbnN0IG5ldXRyYWwgPSBiYXNlLkMgPCBORVVUUkFMX0NIUk9NQSB8fCBiYXNlQ2VpbGluZyA8PSAwO1xyXG4gIGNvbnN0IHJlbGF0aXZlID0gbmV1dHJhbCA/IDAgOiBiYXNlLkMgLyBiYXNlQ2VpbGluZztcclxuICBjb25zdCBzaGlmdGVkID0gbmV1dHJhbCA/IGJhc2UuTCA6IHJlbWFwVG9DdXNwKGJhc2UuTCwgYmFzZS5ILCBIKTtcclxuICBjb25zdCBzaGFyZSA9IChvZmZzZXQubCA/PyAwKSAvIDEwMDtcclxuICBjb25zdCBMID0gTWF0aC5taW4oMSwgTWF0aC5tYXgoMCwgc2hpZnRlZCArIHNoYXJlICogKHNoYXJlID49IDAgPyAxIC0gc2hpZnRlZCA6IHNoaWZ0ZWQpKSk7XHJcbiAgY29uc3QgQyA9IHJlbGF0aXZlICogbWF4Q2hyb21hKEwsIEgpOyAvKiAqICgxICsgKG9mZnNldC5zID8/IDApIC8gMTAwKSAtIFNcdTAwRTR0dGlndW5nIHN0aWxsZ2VsZWd0ICovXHJcbiAgcmV0dXJuIG9rbGNoVG9IZXgoeyBMLCBDOiBNYXRoLm1heCgwLCBDKSwgSCB9KTtcclxufVxyXG5cclxuZnVuY3Rpb24gaGFzQ29sb3JPZmZzZXQob2Zmc2V0KSB7XHJcbiAgcmV0dXJuICEhb2Zmc2V0ICYmIFNVQlRZUEVfQ09MT1JfQ0hBTk5FTFMuc29tZSgoeyBrZXkgfSkgPT4gKG9mZnNldFtrZXldID8/IDApICE9PSAwKTtcclxufVxyXG5cclxuLy8gRmFyYmUgZWluZXMgU3VidHlwcyAoYnp3LiBkaWUgZGVzIFRZUHMsIHNvbGFuZ2UgZGVyIFN1YnR5cCBrZWluZSBlaWdlbmVcclxuLy8gRWluc3RlbGx1bmcgaGF0KTsgbnVsbCwgd2VubiBkZXIgVFlQIHNlbGJzdCBrZWluZSBGYXJiZSBoYXQuXHJcbmZ1bmN0aW9uIHN1YnR5cGVDb2xvcihzZXR0aW5ncywgdHlwZSwgc3VidHlwZSkge1xyXG4gIGNvbnN0IHR5cGVDb2xvciA9IHNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV0gPz8gbnVsbDtcclxuICBpZiAoIXR5cGVDb2xvciB8fCAhc3VidHlwZSkgcmV0dXJuIHR5cGVDb2xvcjtcclxuICBjb25zdCBvZmZzZXQgPSBjbGFtcGVkT2Zmc2V0KHNldHRpbmdzLCBnZXRTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKT8uY29sb3IpO1xyXG4gIHJldHVybiBoYXNDb2xvck9mZnNldChvZmZzZXQpID8gYXBwbHlDb2xvck9mZnNldCh0eXBlQ29sb3IsIG9mZnNldCkgOiB0eXBlQ29sb3I7XHJcbn1cclxuXHJcbi8vIEhhdCBkZXIgU3VidHlwIGVpbmUgZWlnZW5lIChpbm5lcmhhbGIgZGVyIEdyZW56ZW4gd2lya3NhbWUpIEFid2VpY2h1bmc/XHJcbmZ1bmN0aW9uIHN1YnR5cGVIYXNPd25Db2xvcihzZXR0aW5ncywgdHlwZSwgc3VidHlwZSkge1xyXG4gIHJldHVybiBoYXNDb2xvck9mZnNldChjbGFtcGVkT2Zmc2V0KHNldHRpbmdzLCBnZXRTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKT8uY29sb3IpKTtcclxufVxyXG5cclxuLy8gRmFyYmUsIGluIGRlciBlaW4gVFlQLSBiencuIFN1YnR5cC1OYW1lIGRhcmdlc3RlbGx0IHdpcmQgLSBnZW1laW5zYW1lXHJcbi8vIEdydW5kbGFnZSBmXHUwMEZDciBkZW4gUGlja2VyIChyZW5kZXJDb2xvcmVkTmFtZS9uYW1lQ29sb3IgaW4gdHlwZS1waWNrZXIuanMpIHVuZFxyXG4vLyBkaWUgU3VidHlwLVZvcnNjaGF1IGRlciBUWVAtTGlzdGUgKHJlbmRlclN1YnR5cGVQcmV2aWV3IGluIHR5cC12aWV3LmpzKSxcclxuLy8gZGFtaXQgYmVpZGUgbmljaHQgYXVzZWluYW5kZXJsYXVmZW4uIE1pdCBzdWJ0eXBlIGRpZSBGYXJiZSBkZXMgU3VidHlwcyxcclxuLy8gYWJlciBudXIgd2VubiBkZXIgVW50ZXItU2NoYWx0ZXIgXCJTdWJ0eXBcIiB2b24gXCJUWVAgVmlld1wiIGRhcyB6dWxcdTAwRTRzc3QgLSBzb25zdFxyXG4vLyBkaWUgZGVzIFRZUHMuIGlzRGVmYXVsdCA9IFN0YW5kYXJkd2VydCwgYWxzbyBob2hsZXIgUmluZyBzdGF0dCBnZWZcdTAwRkNsbHRlbVxyXG4vLyBQdW5rdCAoc2llaGUgcGFpbnRDb2xvckRvdCk6IGVpbiBUWVAgb2huZSBGYXJiZSBncmF1LCBlaW4gU3VidHlwIG9obmUgZWlnZW5lXHJcbi8vIEFid2VpY2h1bmcgaW4gZGVyIFRZUC1GYXJiZSwgZGllIGVyIFx1MDBGQ2Jlcm5pbW10LlxyXG5mdW5jdGlvbiBuYW1lQ29sb3Ioc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUgPSBudWxsKSB7XHJcbiAgY29uc3QgdXNlU3VidHlwZSA9ICEhc3VidHlwZSAmJiBzZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3RTdWJ0eXA7XHJcbiAgY29uc3QgdHlwZUNvbG9yID0gc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXSA/PyBudWxsO1xyXG4gIHJldHVybiB7XHJcbiAgICBjb2xvcjogKHVzZVN1YnR5cGUgPyBzdWJ0eXBlQ29sb3Ioc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpIDogdHlwZUNvbG9yKSA/PyBERUZBVUxUX1RZUEVfQ09MT1IsXHJcbiAgICBpc0RlZmF1bHQ6ICF0eXBlQ29sb3IgfHwgKHVzZVN1YnR5cGUgJiYgIXN1YnR5cGVIYXNPd25Db2xvcihzZXR0aW5ncywgdHlwZSwgc3VidHlwZSkpLFxyXG4gIH07XHJcbn1cclxuXHJcbi8vIEZhcmJwdW5rdCAoVFlQLUxpc3RlLCBEZXRhaWxhbnNpY2h0LCBQaWNrZXIsIEJlc3RcdTAwRTR0aWd1bmdlbik6IGdlZlx1MDBGQ2xsdCBiZWlcclxuLy8gZWluZXIgZWlnZW5lbiBGYXJiZSwgYWxzIGhvaGxlciBSaW5nIGJlaW0gU3RhbmRhcmR3ZXJ0IC0gZWluIFRZUCBvaG5lIEZhcmJlXHJcbi8vIGFscyBncmF1ZXIgUmluZywgZWluIFN1YnR5cCBvaG5lIGVpZ2VuZSBFaW5zdGVsbHVuZyBhbHMgUmluZyBpbiBkZXJcclxuLy8gVFlQLUZhcmJlLCBkaWUgZXIgXHUwMEZDYmVybmltbXQuXHJcbmZ1bmN0aW9uIHBhaW50Q29sb3JEb3QoZWwsIGNvbG9yLCBpc0RlZmF1bHQpIHtcclxuICBlbC5zdHlsZS5iYWNrZ3JvdW5kQ29sb3IgPSBpc0RlZmF1bHQgPyBcInRyYW5zcGFyZW50XCIgOiBjb2xvcjtcclxuICBlbC5zdHlsZS5ib3hTaGFkb3cgPSBpc0RlZmF1bHQgPyBgaW5zZXQgMCAwIDAgbWF4KDEuNXB4LCAwLjE1ZW0pICR7Y29sb3J9YCA6IFwiXCI7XHJcbn1cclxuXHJcbi8vIHZpZXdLZXkgKG9wdGlvbmFsKTogU2NobFx1MDBGQ3NzZWwgZGVyIEFuc2ljaHQgaW4gY29sb3JWaWV3cyAtIGlzdCBkb3J0IGRlclxyXG4vLyBVbnRlci1TY2hhbHRlciBcIjx2aWV3S2V5PlN1YnR5cFwiIGFuLCBnaWx0IGRpZSBGYXJiZSBkZXMgU3VidHlwcyBkZXIgTm90aXpcclxuLy8gc3RhdHQgZGVyIGlocmVzIFRZUHMuXHJcbmZ1bmN0aW9uIGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIHZpZXdLZXkgPSBudWxsKSB7XHJcbiAgY29uc3QgdHlwZSA9IHBsdWdpbi50eXBJbmRleC50eXBlT2YoZmlsZSk7XHJcbiAgaWYgKCF0eXBlKSByZXR1cm4gbnVsbDtcclxuICBjb25zdCB7IHNldHRpbmdzIH0gPSBwbHVnaW47XHJcbiAgaWYgKCF2aWV3S2V5IHx8ICFzZXR0aW5ncy5jb2xvclZpZXdzW2Ake3ZpZXdLZXl9U3VidHlwYF0pIHJldHVybiBzZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdID8/IG51bGw7XHJcbiAgcmV0dXJuIHN1YnR5cGVDb2xvcihzZXR0aW5ncywgdHlwZSwgcGx1Z2luLnR5cEluZGV4LnN1YnR5cGVPZihmaWxlKSk7XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0ge1xyXG4gIGNvbG9yRm9yRmlsZSxcclxuICBuYW1lQ29sb3IsXHJcbiAgREVGQVVMVF9UWVBFX0NPTE9SLFxyXG4gIHN1YnR5cGVDb2xvcixcclxuICBhcHBseUNvbG9yT2Zmc2V0LFxyXG4gIGhhc0NvbG9yT2Zmc2V0LFxyXG4gIHN1YnR5cGVIYXNPd25Db2xvcixcclxuICBwYWludENvbG9yRG90LFxyXG4gIGNvbG9yUmFuZ2UsXHJcbiAgY2hhbm5lbEJvdW5kcyxcclxuICBjbGFtcGVkT2Zmc2V0LFxyXG4gIFNVQlRZUEVfQ09MT1JfQ0hBTk5FTFMsXHJcbiAgREVGQVVMVF9TVUJUWVBFX0NPTE9SX1JBTkdFUyxcclxufTtcclxuIiwgImNvbnN0IHsgUGx1Z2luU2V0dGluZ1RhYiwgU2V0dGluZ0dyb3VwLCBUb2dnbGVDb21wb25lbnQsIERyb3Bkb3duQ29tcG9uZW50LCBkZWJvdW5jZSB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xyXG5jb25zdCB7IG1vdW50R2xvYmFsT3JkZXJFZGl0b3IgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLW9yZGVyLWVkaXRvclwiKTtcclxuY29uc3QgeyBERUZBVUxUX0dMT0JBTF9PUkRFUiB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItc29ydFwiKTtcclxuY29uc3QgeyBTVUJUWVBFX0NPTE9SX0NIQU5ORUxTLCBERUZBVUxUX1NVQlRZUEVfQ09MT1JfUkFOR0VTLCBjb2xvclJhbmdlIH0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcclxuXHJcbmNvbnN0IERFRkFVTFRfU0VUVElOR1MgPSB7XHJcbiAgdHlwZXM6IFtdLFxyXG4gIHR5cGVDb2xvcnM6IHt9LFxyXG4gIHR5cGVEZXNjcmlwdGlvbnM6IHt9LFxyXG4gIHR5cGVEZWZhdWx0RnJvbnRtYXR0ZXI6IHt9LFxyXG4gIC8vIEtleXMgYXVzIHR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV0sIGRpZSBhbHMgXCJGbG9hdGluZyBQcm9wZXJ0eVwiIG1hcmtpZXJ0XHJcbiAgLy8gc2luZCAoc2llaGUgdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMvdHlwLXZpZXcuanMpIC0gVGVpbCBkZXJzZWxiZW4gTGlzdGVcclxuICAvLyB1bmQgUmVpaGVuZm9sZ2Ugd2llIGRpZSBcdTAwRkNicmlnZW4gU3RhbmRhcmQtUHJvcGVydGllcyBkZXMgVHlwcyAod2ljaHRpZyBmXHUwMEZDclxyXG4gIC8vIGRpZSBGcm9udG1hdHRlci1Tb3J0aWVydW5nLCBzaWVoZSBvcmRlcmVkRGVmYXVsdEtleXMgaW4gZnJvbnRtYXR0ZXItc29ydC5qcyksXHJcbiAgLy8gYWJlciBOSUNIVCBUZWlsIGRlcyB2b24gZ2V0VHlwZURlZmF1bHRzKCkgKG1haW4uanMpIHN0YW5kYXJkbVx1MDBFNFx1MDBERmlnXHJcbiAgLy8gZ2VsaWVmZXJ0ZW4gRnJvbnRtYXR0ZXJzIC0gVGVtcGxhdGVyIGxlZ3Qgc2llIGJlaW0gQW5sZWdlbiBlaW5lciBOb3RpeiBhbHNvXHJcbiAgLy8gbmljaHQgYXV0b21hdGlzY2ggYW4gKG51ciBcdTAwRkNiZXIgZGVuIGV4cGxpeml0ZW4gaW5jbHVkZUZsb2F0aW5nLVBhcmFtZXRlcikuXHJcbiAgdHlwZUZsb2F0aW5nS2V5czoge30sXHJcbiAgLy8gU2hvcnRjdXRzIGplIEtleSBhdXMgdHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXTpcclxuICAvLyAgIHsgW1RZUF06IHsgW1Byb3BlcnR5XTogeyBuYW1lOiBcInRvZGF5XCIgfCBcInRwLjxTa3JpcHRuYW1lPlwiIH0gfSB9XHJcbiAgLy8gQmV3dXNzdCBORUJFTiBkZW0gRnJvbnRtYXR0ZXIgc3RhdHQgYWxzIGRlc3NlbiBXZXJ0IC0gc2llaGUgZGllIEJlZ3JcdTAwRkNuZHVuZ1xyXG4gIC8vIGluIHNob3J0Y3V0cy5qcy4gRGVyIFdlcnQgZGVyIFByb3BlcnR5IGJsZWlidCBkYWR1cmNoIHR5cHJlaW4gKE9ic2lkaWFuc1xyXG4gIC8vIG5hdGl2ZXMgV2lkZ2V0IGJsZWlidCB1bmFuZ2V0YXN0ZXQpIHVuZCBkaWVudCBiZWkgZ2VzZXR6dGVtIFNob3J0Y3V0IGFsc1xyXG4gIC8vIFJcdTAwRkNja2ZhbGx3ZXJ0LCBmYWxscyBkZXNzZW4gVGVtcGxhdGVyLVNrcmlwdCBmZWhsc2NobFx1MDBFNGd0LlxyXG4gIHR5cGVTaG9ydGN1dHM6IHt9LFxyXG4gIHR5cGVNYW51YWw6IHt9LFxyXG4gIC8vIFJlZ2lzdHJpZXJ0ZSBTdWJ0eXBlbiBqZSBUWVAgc2FtdCBlaWdlbmVtIEZyb250bWF0dGVyLUJsb2NrLCBzaWVoZSBzdWJ0eXBlcy5qcy5cclxuICB0eXBlU3VidHlwZXM6IHt9LFxyXG4gIC8vIFNpZWhlIGZyb250bWF0dGVyLW9yZGVyLWVkaXRvci5qcyAvIGZyb250bWF0dGVyLXNvcnQuanM6IFJlaWhlbmZvbGdlIGF1c1xyXG4gIC8vIGZlc3QgcG9zaXRpb25pZXJ0ZW4gRWluemVsLVByb3BlcnRpZXMgKGtpbmQ6IFwicHJvcGVydHlcIikgc293aWUgZGVuIHZpZXJcclxuICAvLyBuaWNodCBlbnRmZXJuYmFyZW4gUGxhdHpoYWx0ZXJuIFwidHlwVmFsdWVcIiAoVFlQLVByb3BlcnR5IHNlbGJzdCksXHJcbiAgLy8gXCJzdWJ0eXBWYWx1ZVwiIChTVUJUWVAtUHJvcGVydHkgc2VsYnN0KSwgXCJ0eXBcIiAoU3RhbmRhcmRsaXN0ZSBkZXMgVHlwcylcclxuICAvLyB1bmQgXCJvdGhlclwiIChhbGxlcyBcdTAwRENicmlnZSkuXHJcbiAgZ2xvYmFsUHJvcGVydHlPcmRlcjogREVGQVVMVF9HTE9CQUxfT1JERVIsXHJcbiAgLy8gU2llaGUgYWN0aXZlLXRpdGxlLWNvbG9ycy5qczogd2llIGRlciBUWVAgaW4gZGVyIGdlXHUwMEY2ZmZuZXRlbiBOb3RpeiBtYXJraWVydFxyXG4gIC8vIHdpcmQgLSBcIm5vbmVcIiAobmljaHRzKSwgXCJkb3RcIiAoRmFyYnB1bmt0IGFtIFRpdGVsKSBvZGVyIFwiYmFkZ2VcIiAoQm94IG1pdFxyXG4gIC8vIFRZUC1OYW1lbiwgd2VpdGVyIGtvbmZpZ3VyaWVydCBcdTAwRkNiZXIgZGllIGRyZWkgZm9sZ2VuZGVuIEVpbnN0ZWxsdW5nZW4sIGRpZVxyXG4gIC8vIG51ciBiZWkgXCJiYWRnZVwiIFx1MDBGQ2JlcmhhdXB0IGVpbmUgUm9sbGUgc3BpZWxlbiBiencuIGluIGRlbiBFaW5zdGVsbHVuZ2VuXHJcbiAgLy8gYW5nZXplaWd0IHdlcmRlbikuIFVuYWJoXHUwMEU0bmdpZyBkYXZvbiB1bmQgYmVsaWViaWcga29tYmluaWVyYmFyOlxyXG4gIC8vIGNvbG9yVmlld3Mubm90ZVRpdGxlQ29sb3IgZlx1MDBFNHJidCBkZW4gVGl0ZWx0ZXh0IHNlbGJzdCBlaW4uXHJcbiAgbm90ZVRpdGxlU3R5bGU6IFwiZG90XCIsXHJcbiAgLy8gTnVyIHJlbGV2YW50IGJlaSBub3RlVGl0bGVTdHlsZTogXCJiYWRnZVwiIC0gb2IgZGllIEJveCBmYXJiaWcgKFRZUC1GYXJiZSlcclxuICAvLyBvZGVyIG5ldXRyYWwgKHRleHQtbXV0ZWQpIGRhcmdlc3RlbGx0IHdpcmQuXHJcbiAgbm90ZVRpdGxlQmFkZ2VDb2xvcmVkOiB0cnVlLFxyXG4gIC8vIE51ciByZWxldmFudCBiZWkgbm90ZVRpdGxlU3R5bGU6IFwiYmFkZ2VcIiAtIEJlc2NocmlmdHVuZyBkZXIgQm94OiBcInR5cGVcIlxyXG4gIC8vIChbVFlQXSksIFwidHlwZS1zdWJ0eXBlXCIgKFtUWVAvU3VidHlwXSkgb2RlciBcInN1YnR5cGVcIiAoW1N1YnR5cF0sIGJlaVxyXG4gIC8vIE5vdGl6ZW4gb2huZSBTdWJ0eXAga2VpbmUgQm94KS4gRmFyYmUgKG1pdCBub3RlVGl0bGVCYWRnZUNvbG9yZWQpXHJcbiAgLy8gZW50c3ByZWNoZW5kIGRpZSBkZXMgVFlQcyBiencuIGRlcyBTdWJ0eXBzIC0gYmVpIFwidHlwZS1zdWJ0eXBlXCIgd1x1MDBFNGhsYmFyXHJcbiAgLy8gXHUwMEZDYmVyIGNvbG9yVmlld3Mubm90ZVRpdGxlTWFya2VyU3VidHlwIChcIlN1YnR5cC1GYXJiZVwiKS5cclxuICBub3RlVGl0bGVCYWRnZUxhYmVsOiBcInR5cGVcIixcclxuICAvLyBOdXIgcmVsZXZhbnQgYmVpIG5vdGVUaXRsZVN0eWxlOiBcImJhZGdlXCIgLSBcInRpdGxlXCIgKG5lYmVuIGRlbSBJbmxpbmUtVGl0ZWwsXHJcbiAgLy8gbm9ybWFsZSBBdXNyaWNodHVuZykgb2RlciBcImJsb2NrXCIgKGxpbmtzIGFtIFByb3BlcnR5LUJsb2NrLCB1bSA5MFx1MDBCMCBnZWRyZWh0KS5cclxuICBub3RlVGl0bGVCYWRnZVBvc2l0aW9uOiBcInRpdGxlXCIsXHJcbiAgLy8gTnVyIHJlbGV2YW50IGJlaSBub3RlVGl0bGVCYWRnZVBvc2l0aW9uOiBcImJsb2NrXCIgLSBvYiBkaWUgZ2VkcmVodGUgQm94IGFtXHJcbiAgLy8gb2JlcmVuIG9kZXIgdW50ZXJlbiBSYW5kIGRlcyBQcm9wZXJ0eS1CbG9ja3Mgc2l0enQuXHJcbiAgbm90ZVRpdGxlVmVydGljYWxBbGlnbjogXCJ0b3BcIixcclxuICB0eXBTb3J0T3JkZXI6IFwiY291bnQtZGVzY1wiLFxyXG4gIC8vIFdhcyBpbiBkZXIgVFlQLUxpc3RlIHJlY2h0cyBuZWJlbiBkZW0gTmFtZW4gc3RlaHQgLSBcImRlc2NyaXB0aW9uXCIsXHJcbiAgLy8gXCJzdWJ0eXBlc1wiIG9kZXIgXCJub25lXCIuIFVtZ2VzY2hhbHRldCB3aXJkIGRhcyBuaWNodCBoaWVyLCBzb25kZXJuIFx1MDBGQ2JlciBkZW5cclxuICAvLyBLbm9wZiBpbSBMaXN0ZW4tSGVhZGVyIG5lYmVuIGRlciBTb3J0aWVydW5nIChzaWVoZSBTRUNPTkRBUllfTU9ERVMgaW5cclxuICAvLyB0eXAtdmlldy5qcyksIHdpZSBzY2hvbiBkaWUgU29ydGllcnJlaWhlbmZvbGdlOiBiZWlkZXMgYmV0cmlmZnQgbnVyIGRhc1xyXG4gIC8vIEF1c3NlaGVuIGRpZXNlciBlaW5lbiBMaXN0ZSB1bmQgZ2VoXHUwMEY2cnQgZGFoZXIgYW4gc2llIHNlbGJzdCwgbmljaHQgaW4gZWluZVxyXG4gIC8vIEVpbnN0ZWxsdW5nc3NlaXRlLCBkaWUgbWFuIGRhZlx1MDBGQ3IgamVkZXMgTWFsIFx1MDBGNmZmbmVuIG1cdTAwRkNzc3RlLlxyXG4gIHR5cExpc3RTZWNvbmRhcnk6IFwic3VidHlwZXNcIixcclxuICAvLyBTaWVoZSBwaWNrVHlwZUFuZFN1YnR5cGUgaW4gdHlwZS1waWNrZXIuanM6IGZhbHNlID0gU3VidHlwZW4gZWluZ2VyXHUwMEZDY2t0XHJcbiAgLy8gZGlyZWt0IGltIFRZUC1QaWNrZXIsIHRydWUgPSBlaWdlbmVyIFN1YnR5cC1QaWNrZXIgbmFjaCBkZXIgVFlQLUF1c3dhaGwuXHJcbiAgc2VwYXJhdGVTdWJ0eXBlUGlja2VyOiBmYWxzZSxcclxuICBpbmNsdWRlSWdub3JlZEZpbGVzOiBmYWxzZSxcclxuICAvLyBFaWdlbmUgVGFnLS9BbmhcdTAwRTRuZ2UtRmFyYmUgaW0gR3JhcGggZGVha3RpdmllcnQgKDMwLjA5LjIwMjYpOiBiZWlkZXMgaXN0IGluXHJcbiAgLy8gZGVuIFN0eWxlIFNldHRpbmdzIGRlcyBNaW5pbWFsIFRoZW1lIGVpbnN0ZWxsYmFyLCBzaWVoZSBncmFwaC1jb2xvcnMuanMuXHJcbiAgLy8gZ3JhcGhUYWdDb2xvckVuYWJsZWQ6IGZhbHNlLFxyXG4gIC8vIGdyYXBoVGFnQ29sb3I6IFwiXCIsXHJcbiAgLy8gZ3JhcGhBdHRhY2htZW50Q29sb3JFbmFibGVkOiBmYWxzZSxcclxuICAvLyBncmFwaEF0dGFjaG1lbnRDb2xvcjogXCJcIixcclxuICAvLyBXaWUgd2VpdCBkaWUgRmFyYmUgZWluZXMgU3VidHlwcyBoXHUwMEY2Y2hzdGVucyB2b24gZGVyIHNlaW5lcyBUWVBzIGFid2VpY2hlblxyXG4gIC8vIGRhcmYgKFx1MDBCMSksIHNpZWhlIHR5cGUtY29sb3JzLmpzOiBGYXJidG9uIGluIEdyYWQsIEhlbGxpZ2tlaXQgaW4gJSBkZXMgV2Vnc1xyXG4gIC8vIHp1IFdlaVx1MDBERiBiencuIFNjaHdhcnouXHJcbiAgc3VidHlwZUNvbG9yUmFuZ2VzOiB7IC4uLkRFRkFVTFRfU1VCVFlQRV9DT0xPUl9SQU5HRVMgfSxcclxuICBjb2xvclZpZXdzOiB7XHJcbiAgICBmaWxlRXhwbG9yZXI6IHRydWUsXHJcbiAgICBncmFwaDogdHJ1ZSxcclxuICAgIHNlYXJjaDogdHJ1ZSxcclxuICAgIHJlY2VudEZpbGVzOiB0cnVlLFxyXG4gICAgYmFja2xpbmtzOiB0cnVlLFxyXG4gICAgYm9va21hcmtzOiB0cnVlLFxyXG4gICAgLy8gVW50ZXItU2NoYWx0ZXIgXCI8QW5zaWNodD5TdWJ0eXBcIiBkZXIgRWluZlx1MDBFNHJidW5nZW46IEZhcmJlIGRlcyBTdWJ0eXBzXHJcbiAgICAvLyBlaW5lciBOb3RpeiBzdGF0dCBkZXIgaWhyZXMgVFlQcyAoc2llaGUgY29sb3JGb3JGaWxlIGluIHR5cGUtY29sb3JzLmpzKS5cclxuICAgIGZpbGVFeHBsb3JlclN1YnR5cDogdHJ1ZSxcclxuICAgIGdyYXBoU3VidHlwOiB0cnVlLFxyXG4gICAgc2VhcmNoU3VidHlwOiB0cnVlLFxyXG4gICAgcmVjZW50RmlsZXNTdWJ0eXA6IHRydWUsXHJcbiAgICBiYWNrbGlua3NTdWJ0eXA6IHRydWUsXHJcbiAgICBib29rbWFya3NTdWJ0eXA6IHRydWUsXHJcbiAgICBsaW5rc1N1YnR5cDogdHJ1ZSxcclxuICAgIHR5cExpc3RTdWJ0eXA6IHRydWUsXHJcbiAgICBub3RlVGl0bGVDb2xvclN1YnR5cDogdHJ1ZSxcclxuICAgIG5vdGVUaXRsZU1hcmtlclN1YnR5cDogdHJ1ZSxcclxuICAgIGZyb250bWF0dGVyRGVmYXVsdHM6IHRydWUsXHJcbiAgICAvLyBVbnRlci1TY2hhbHRlciB6dSBmcm9udG1hdHRlckRlZmF1bHRzIGJ6dy4gYWxsUHJvcGVydGllczogYmV6aWVodCBkaWVcclxuICAgIC8vIEZyb250bWF0dGVyLUJsXHUwMEY2Y2tlIGRlciBTdWJ0eXBlbiBtaXQgZWluIChzaWVoZVxyXG4gICAgLy8gZnJvbnRtYXR0ZXItZGVmYXVsdC1oaWdobGlnaHQuanMpIC0gYmVpIGFsbFByb3BlcnRpZXMgenVnbGVpY2ggaW4gZGVyXHJcbiAgICAvLyBGYXJiZSBkZXMgamV3ZWlsaWdlbiBTdWJ0eXBzLlxyXG4gICAgZnJvbnRtYXR0ZXJEZWZhdWx0c1N1YnR5cDogdHJ1ZSxcclxuICAgIHR5cExpc3Q6IHRydWUsXHJcbiAgICBhbGxQcm9wZXJ0aWVzOiB0cnVlLFxyXG4gICAgYWxsUHJvcGVydGllc1N1YnR5cDogdHJ1ZSxcclxuICAgIG5vdGVUaXRsZUNvbG9yOiB0cnVlLFxyXG4gICAgbGlua3M6IHRydWUsXHJcbiAgfSxcclxufTtcclxuXHJcbmNsYXNzIFR5cFN5c3RlbVNldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcclxuICBjb25zdHJ1Y3RvcihhcHAsIHBsdWdpbikge1xyXG4gICAgc3VwZXIoYXBwLCBwbHVnaW4pO1xyXG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XHJcbiAgfVxyXG5cclxuICAvLyBKZWRlciBBYnNjaG5pdHQgaXN0IGVpbmUgU2V0dGluZ0dyb3VwIC0gT2JzaWRpYW5zIGVpZ2VuZSBHcnVwcGllcnVuZ1xyXG4gIC8vIChcdTAwRENiZXJzY2hyaWZ0ICsgZWluZSBCb3gsIEVpbnRyXHUwMEU0Z2UgZGFyaW4gZHVyY2ggVHJlbm5saW5pZW4gZ2V0cmVubnQpLCB3aWVcclxuICAvLyBpbiBkZW4gQ29yZS1FaW5zdGVsbHVuZ2VuLiBFaW56ZWxuIHBlciBuZXcgU2V0dGluZyhjb250YWluZXJFbCkgYW5nZWxlZ3RlXHJcbiAgLy8gRWludHJcdTAwRTRnZSB3XHUwMEZDcmRlbiBzdGF0dGRlc3NlbiBqZSBhbHMgZWlnZW5lIGtsZWluZSBCb3ggZ2VyZW5kZXJ0LlxyXG4gIGRpc3BsYXkoKSB7XHJcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xyXG4gICAgLy8gU2Nyb2xsLVBvc2l0aW9uIFx1MDBGQ2JlciBkZW4gTmV1YXVmYmF1IHJldHRlbiAoZGlzcGxheSgpIHdpcmQgYXVjaCB2b25cclxuICAgIC8vIFNjaGFsdGVybiBtaXQgVW50ZXItT3B0aW9uZW4gYXVmZ2VydWZlbik6IGRhcyBEcm9wZG93biBkZXJcclxuICAgIC8vIFRZUC1NYXJraWVydW5nIG1pc3N0IHNpY2ggYmVpbSBzZXRWYWx1ZSgpIChyZXNpemVUb0ZpdCBsaWVzdFxyXG4gICAgLy8gb2Zmc2V0V2lkdGgpIHVuZCBlcnp3aW5ndCBzbyBlaW4gTGF5b3V0LCBzb2xhbmdlIGRpZSBTZWl0ZSBlcnN0IGJpc1xyXG4gICAgLy8gZG9ydGhpbiBhdWZnZWJhdXQgaXN0IC0gZGVyIEJyb3dzZXIga2FwcHQgc2Nyb2xsVG9wIGRhbm4gYXVmIGRpZXNlXHJcbiAgICAvLyBUZWlsaFx1MDBGNmhlLCBkaWUgQW5zaWNodCBzcHJcdTAwRTRuZ2UgbmFjaCBvYmVuLlxyXG4gICAgY29uc3QgeyBzY3JvbGxUb3AgfSA9IGNvbnRhaW5lckVsO1xyXG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcclxuXHJcbiAgICBuZXcgU2V0dGluZ0dyb3VwKGNvbnRhaW5lckVsKVxyXG4gICAgICAuc2V0SGVhZGluZyhcIlRZUC1MaXN0ZVwiKVxyXG4gICAgICAuYWRkU2V0dGluZygoc2V0dGluZykgPT5cclxuICAgICAgICBzZXR0aW5nXHJcbiAgICAgICAgICAuc2V0TmFtZShcIklnbm9yaWVydGUgTm90aXplbiBJTU1FUiBiZXJcdTAwRkNja3NpY2h0aWdlblwiKVxyXG4gICAgICAgICAgLnNldERlc2MoXHJcbiAgICAgICAgICAgIFwiQmV6aWVodCBOb3RpemVuIGF1cyBPYnNpZGlhbnMgXFxcIkV4Y2x1ZGVkIGZpbGVzXFxcIi1MaXN0ZSAoZG9ydCB0cmFnZW4gYXVjaCBQbHVnaW5zIHdpZSBIaWRlIEZvbGRlcnMgYXVzZ2VibGVuZGV0ZSBPcmRuZXIgZWluKSB3aWVkZXIgaW4gVFlQLVpcdTAwRTRobGVyLCBUWVAtUGlja2VyIHVuZCBkaWUgRnJvbnRtYXR0ZXItU29ydGllcnVuZyBtaXQgZWluLCBzdGF0dCBzaWUgenUgXHUwMEZDYmVyc3ByaW5nZW4uXCJcclxuICAgICAgICAgIClcclxuICAgICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cclxuICAgICAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXMpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXMgPSB2YWx1ZTtcclxuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgICAgICAgICAgfSlcclxuICAgICAgICAgIClcclxuICAgICAgKTtcclxuXHJcbiAgICBuZXcgU2V0dGluZ0dyb3VwKGNvbnRhaW5lckVsKS5zZXRIZWFkaW5nKFwiVFlQLVBpY2tlclwiKS5hZGRTZXR0aW5nKChzZXR0aW5nKSA9PlxyXG4gICAgICBzZXR0aW5nXHJcbiAgICAgICAgLnNldE5hbWUoXCJTdWJ0eXAtUGlja2VyIHNlcGFyYXRcIilcclxuICAgICAgICAuc2V0RGVzYyhcclxuICAgICAgICAgIFwiQmVpbSBBbmxlZ2VuIGVpbmVyIE5vdGl6IGZvbGd0IGF1ZiBkZW4gVFlQLVBpY2tlciBlaW4gZWlnZW5lciBTdWJ0eXAtUGlja2VyIChFU0MgZG9ydCBmXHUwMEZDaHJ0IHp1clx1MDBGQ2NrIHp1ciBUWVAtQXVzd2FobCksIHN0YXR0IGRpZSBTdWJ0eXBlbiBkaXJla3QgZWluZ2VyXHUwMEZDY2t0IHVudGVyIGlocmVtIFRZUCBpbSBUWVAtUGlja2VyIGFuenV6ZWlnZW4uIERlciBUWVAtUGlja2VyIG5lbm50IGRpZSBTdWJ0eXBlbiBkYW5uIGhpbnRlciBkZW0gVFlQLU5hbWVuLlwiXHJcbiAgICAgICAgKVxyXG4gICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cclxuICAgICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5zZXBhcmF0ZVN1YnR5cGVQaWNrZXIpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5zZXBhcmF0ZVN1YnR5cGVQaWNrZXIgPSB2YWx1ZTtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgICB9KVxyXG4gICAgICAgIClcclxuICAgICk7XHJcblxyXG4gICAgLy8gc3VidHlwS2V5IChvcHRpb25hbCk6IHN0YXR0IGVpbmVzIGVpbnplbG5lbiBTY2hhbHRlcnMgendlaSBiZXNjaHJpZnRldGVcclxuICAgIC8vIHVudGVyZWluYW5kZXIgKHdpZSBkaWUgVW50ZXItU2NoYWx0ZXIgYmVpIFwiQm94IG1pdCBUWVAtTmFtZW5cIiwgc2llaGVcclxuICAgIC8vIHVudGVuKSAtIFwiVFlQXCIgZlx1MDBGQ3IgZGVuIGVpZ2VudGxpY2hlbiBTY2hhbHRlciwgZGFydW50ZXIgXCJTdWJ0eXBcIiwgbnVyXHJcbiAgICAvLyBzaWNodGJhciwgc29sYW5nZSBcIlRZUFwiIGFuIGlzdC4gRGllIFRvb2x0aXBzIHBhc3NlbiBzdGFuZGFyZG1cdTAwRTRcdTAwREZpZyB6dSBkZW5cclxuICAgIC8vIEVpbmZcdTAwRTRyYnVuZ2VuIChTdWJ0eXAgPSBGYXJiZSBkZXMgU3VidHlwcyBzdGF0dCBkZXIgZGVzIFRZUHMpLlxyXG4gICAgY29uc3QgY29sb3JWaWV3VG9nZ2xlID0gKFxyXG4gICAgICBncm91cCxcclxuICAgICAga2V5LFxyXG4gICAgICBuYW1lLFxyXG4gICAgICBkZXNjLFxyXG4gICAgICBzdWJ0eXBLZXkgPSBudWxsLFxyXG4gICAgICB7IHR5cFRvb2x0aXAgPSBcIk5hY2ggVFlQLUZhcmJlIGVpbmZcdTAwRTRyYmVuXCIsIHN1YnR5cFRvb2x0aXAgPSBcIkZhcmJlIGRlcyBTdWJ0eXBzIHN0YXR0IGRlciBkZXMgVFlQcyB2ZXJ3ZW5kZW5cIiB9ID0ge31cclxuICAgICkgPT5cclxuICAgICAgZ3JvdXAuYWRkU2V0dGluZygoc2V0dGluZykgPT4ge1xyXG4gICAgICAgIHNldHRpbmcuc2V0TmFtZShuYW1lKS5zZXREZXNjKGRlc2MpO1xyXG4gICAgICAgIGNvbnN0IHNhdmUgPSBhc3luYyAoc2V0dGluZ0tleSwgdmFsdWUpID0+IHtcclxuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Nbc2V0dGluZ0tleV0gPSB2YWx1ZTtcclxuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgaWYgKCFzdWJ0eXBLZXkpIHtcclxuICAgICAgICAgIHNldHRpbmcuYWRkVG9nZ2xlKCh0b2dnbGUpID0+IHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzW2tleV0pLm9uQ2hhbmdlKCh2YWx1ZSkgPT4gc2F2ZShrZXksIHZhbHVlKSkpO1xyXG4gICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgc2V0dGluZy5zZXR0aW5nRWwuYWRkQ2xhc3MoXCJmcmVkLW5vdGUtdGl0bGUtc2V0dGluZ1wiKTtcclxuICAgICAgICBjb25zdCBhZGRSb3cgPSAobGFiZWwsIHRvb2x0aXAsIHNldHRpbmdLZXksIG9uQ2hhbmdlZCkgPT4ge1xyXG4gICAgICAgICAgY29uc3Qgcm93ID0gc2V0dGluZy5jb250cm9sRWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtbm90ZS10aXRsZS10b2dnbGUtcm93XCIgfSk7XHJcbiAgICAgICAgICByb3cuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLW5vdGUtdGl0bGUtdG9nZ2xlLWxhYmVsXCIsIHRleHQ6IGxhYmVsIH0pO1xyXG4gICAgICAgICAgbmV3IFRvZ2dsZUNvbXBvbmVudChyb3cpXHJcbiAgICAgICAgICAgIC5zZXRUb29sdGlwKHRvb2x0aXApXHJcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzW3NldHRpbmdLZXldKVxyXG4gICAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgICAgICAgYXdhaXQgc2F2ZShzZXR0aW5nS2V5LCB2YWx1ZSk7XHJcbiAgICAgICAgICAgICAgb25DaGFuZ2VkPy4oKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfTtcclxuICAgICAgICBhZGRSb3coXCJUWVBcIiwgdHlwVG9vbHRpcCwga2V5LCAoKSA9PiB0aGlzLmRpc3BsYXkoKSk7XHJcbiAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Nba2V5XSkgYWRkUm93KFwiU3VidHlwXCIsIHN1YnR5cFRvb2x0aXAsIHN1YnR5cEtleSk7XHJcbiAgICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGNvbG9yaW5nR3JvdXAgPSBuZXcgU2V0dGluZ0dyb3VwKGNvbnRhaW5lckVsKS5zZXRIZWFkaW5nKFwiRWluZlx1MDBFNHJidW5nXCIpO1xyXG5cclxuICAgIGNvbG9yVmlld1RvZ2dsZShjb2xvcmluZ0dyb3VwLCBcImZpbGVFeHBsb3JlclwiLCBcIkRhdGVpLUV4cGxvcmVyXCIsIFwiTm90aXpuYW1lbiBpbSBEYXRlaS1FeHBsb3JlciBuYWNoIFRZUCBlaW5mXHUwMEU0cmJlbi5cIiwgXCJmaWxlRXhwbG9yZXJTdWJ0eXBcIik7XHJcbiAgICBjb2xvclZpZXdUb2dnbGUoY29sb3JpbmdHcm91cCwgXCJncmFwaFwiLCBcIkdyYXBoXCIsIFwiS25vdGVuIGltIEdyYXBoIChnbG9iYWwgdW5kIGxva2FsKSBuYWNoIFRZUCBlaW5mXHUwMEU0cmJlbi5cIiwgXCJncmFwaFN1YnR5cFwiKTtcclxuICAgIGNvbG9yVmlld1RvZ2dsZShjb2xvcmluZ0dyb3VwLCBcInNlYXJjaFwiLCBcIlN1Y2hlXCIsIFwiVHJlZmZlci1UaXRlbCBpbiBkZXIgU3VjaGUgbmFjaCBUWVAgZWluZlx1MDBFNHJiZW4uXCIsIFwic2VhcmNoU3VidHlwXCIpO1xyXG4gICAgY29sb3JWaWV3VG9nZ2xlKGNvbG9yaW5nR3JvdXAsIFwicmVjZW50RmlsZXNcIiwgXCJSZWNlbnQgRmlsZXNcIiwgXCJFaW50clx1MDBFNGdlIGltIFJlY2VudC1GaWxlcy1QbHVnaW4gbmFjaCBUWVAgZWluZlx1MDBFNHJiZW4uXCIsIFwicmVjZW50RmlsZXNTdWJ0eXBcIik7XHJcbiAgICBjb2xvclZpZXdUb2dnbGUoXHJcbiAgICAgIGNvbG9yaW5nR3JvdXAsXHJcbiAgICAgIFwibGlua3NcIixcclxuICAgICAgXCJMaW5rcyBpbiBOb3RpemVuXCIsXHJcbiAgICAgIFwiSW50ZXJuZSBMaW5rcyBpbSBOb3RpenRleHQgKExlc2UtTW9kdXMsIExpdmUgUHJldmlldywgSG92ZXItVm9yc2NoYXUpIGluIGRlciBGYXJiZSBkZXMgVFlQcyBpaHJlcyBaaWVscyBkYXJzdGVsbGVuLiBOaWNodCBhdWZnZWxcdTAwRjZzdGUgTGlua3MgYmxlaWJlbiB1bnZlclx1MDBFNG5kZXJ0LlwiLFxyXG4gICAgICBcImxpbmtzU3VidHlwXCJcclxuICAgICk7XHJcbiAgICBjb2xvclZpZXdUb2dnbGUoXHJcbiAgICAgIGNvbG9yaW5nR3JvdXAsXHJcbiAgICAgIFwidHlwTGlzdFwiLFxyXG4gICAgICBcIlRZUCBWaWV3XCIsXHJcbiAgICAgIFwiVHlwLU5hbWVuIGluIGRlciBUWVAtVmlldyBzZWxic3QgKExpc3RlIHVuZCBEZXRhaWxhbnNpY2h0KSB1bmQgaW0gVFlQLVBpY2tlciBpbiBpaHJlciBqZXdlaWxpZ2VuIEZhcmJlIGRhcnN0ZWxsZW4uIE1pdCBcXFwiU3VidHlwXFxcIiBhdWNoIGRpZSBTdWJ0eXBlbiBpbiBpaHJlciBlaWdlbmVuIEZhcmJlLlwiLFxyXG4gICAgICBcInR5cExpc3RTdWJ0eXBcIlxyXG4gICAgKTtcclxuICAgIGNvbG9yVmlld1RvZ2dsZShcclxuICAgICAgY29sb3JpbmdHcm91cCxcclxuICAgICAgXCJub3RlVGl0bGVDb2xvclwiLFxyXG4gICAgICBcIlRpdGVsLVRleHQgZWluZlx1MDBFNHJiZW5cIixcclxuICAgICAgXCJGXHUwMEU0cmJ0IGRlbiBJbmxpbmUtVGl0ZWwgZGVyIGdlXHUwMEY2ZmZuZXRlbiBOb3RpeiBzZWxic3QgaW4gZGVyIEZhcmJlIGlocmVzIFRZUHMgZWluIC0gdW5hYmhcdTAwRTRuZ2lnIHZvbiBkZXIgVFlQLU1hcmtpZXJ1bmcgZGFuZWJlbiAocy4gdS4pLCBiZWlkZXMgbFx1MDBFNHNzdCBzaWNoIGtvbWJpbmllcmVuLlwiLFxyXG4gICAgICBcIm5vdGVUaXRsZUNvbG9yU3VidHlwXCJcclxuICAgICk7XHJcblxyXG4gICAgLy8gUHJvZ3Jlc3NpdmUgT2ZmZW5sZWd1bmc6IGJlaSBub3RlVGl0bGVTdHlsZSBcImJhZGdlXCIga29tbWVuIHdlaXRlcmVcclxuICAgIC8vIFNjaGFsdGVyIGRpcmVrdCBpbiBkaWVzZXIgZWluZW4gU2V0dGluZy1aZWlsZSBkYXp1IChGYXJiZSwgUG9zaXRpb24pLFxyXG4gICAgLy8gYmVpIFBvc2l0aW9uIFwiYmxvY2tcIiBub2NoIGVpbiBkcml0dGVyIChBdXNyaWNodHVuZykgLSBqZXdlaWxzIHBlclxyXG4gICAgLy8gdGhpcy5kaXNwbGF5KCkgbmV1IGdlcmVuZGVydCwgZGFtaXQgbnVyIGRpZSBnZXJhZGUgcmVsZXZhbnRlbiBTY2hhbHRlclxyXG4gICAgLy8gZXJzY2hlaW5lbiwgc3RhdHQgcGVybWFuZW50IGFsbGUgYW56dXplaWdlbiBiencuIGVpZ2VuZSBaZWlsZW4genUgYmVsZWdlbi5cclxuICAgIGNvbnN0IGlzQmFkZ2UgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVTdHlsZSA9PT0gXCJiYWRnZVwiO1xyXG4gICAgY29uc3QgaXNCbG9ja1Bvc2l0aW9uID0gdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VQb3NpdGlvbiA9PT0gXCJibG9ja1wiO1xyXG5cclxuICAgIGNvbG9yaW5nR3JvdXAuYWRkU2V0dGluZygobm90ZVRpdGxlU2V0dGluZykgPT4ge1xyXG4gICAgICBub3RlVGl0bGVTZXR0aW5nXHJcbiAgICAgICAgLnNldE5hbWUoXCJUWVAtTWFya2llcnVuZyBpbiBkZXIgTm90aXpcIilcclxuICAgICAgICAuc2V0RGVzYyhcclxuICAgICAgICAgIGlzQmFkZ2VcclxuICAgICAgICAgICAgPyAnXCJCb3ggbWl0IFRZUC1OYW1lblwiIC0gQmVzY2hyaWZ0dW5nLCBTY2hhbHRlcjogZmFyYmlnL25ldXRyYWwsIGFtIFRpdGVsL2FtIFByb3BlcnR5LUJsb2NrIChnZWRyZWh0KScgK1xyXG4gICAgICAgICAgICAgICAgKGlzQmxvY2tQb3NpdGlvbiA/IFwiLCBvYmVuL3VudGVuIGFtIFByb3BlcnR5LUJsb2NrXCIgOiBcIlwiKSArXHJcbiAgICAgICAgICAgICAgICBcIi5cIlxyXG4gICAgICAgICAgICA6IFwiV2llIGRlciBUWVAgaW4gZGVyIGdlXHUwMEY2ZmZuZXRlbiBOb3RpeiBtYXJraWVydCB3aXJkLlwiXHJcbiAgICAgICAgKVxyXG4gICAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XHJcbiAgICAgICAgICBkcm9wZG93blxyXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwibm9uZVwiLCBcIk5pY2h0c1wiKVxyXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwiZG90XCIsIFwiRmFyYnB1bmt0IGFtIFRpdGVsXCIpXHJcbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJiYWRnZVwiLCBcIkJveCBtaXQgVFlQLU5hbWVuXCIpXHJcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVTdHlsZSlcclxuICAgICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVN0eWxlID0gdmFsdWU7XHJcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbiAgICAgICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XHJcbiAgICAgICAgICAgIH0pXHJcbiAgICAgICAgKTtcclxuXHJcbiAgICAgIC8vIFwiU3VidHlwXCIgKEZhcmJlIGRlcyBTdWJ0eXBzIHN0YXR0IGRlciBkZXMgVFlQcykgbnVyLCBzb2xhbmdlIGRpZVxyXG4gICAgICAvLyBNYXJraWVydW5nIFx1MDBGQ2JlcmhhdXB0IGZhcmJpZyBpc3Q6IGJlaW0gUHVua3QgaW1tZXIsIGJlaSBkZXIgQm94IG51clxyXG4gICAgICAvLyBtaXQgXCJGYXJiaWdcIiB1bmQgQmVzY2hyaWZ0dW5nIFtUWVAvU3VidHlwXSAtIGJlaSBbVFlQXSBiencuIFtTdWJ0eXBdXHJcbiAgICAgIC8vIGZvbGd0IGRpZSBGYXJiZSBkZXIgQmVzY2hyaWZ0dW5nLlxyXG4gICAgICBjb25zdCBiYWRnZUxhYmVsID0gdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VMYWJlbCA/PyBcInR5cGVcIjtcclxuICAgICAgY29uc3Qgc2hvd1N1YnR5cCA9XHJcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlU3R5bGUgPT09IFwiZG90XCIgfHxcclxuICAgICAgICAoaXNCYWRnZSAmJiB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUNvbG9yZWQgJiYgYmFkZ2VMYWJlbCA9PT0gXCJ0eXBlLXN1YnR5cGVcIik7XHJcbiAgICAgIGlmICghaXNCYWRnZSAmJiAhc2hvd1N1YnR5cCkgcmV0dXJuO1xyXG5cclxuICAgICAgLy8gRWlnZW5lIEtsYXNzZSwgZGFtaXQgZGllIGJlaSBcImJhZGdlXCIgenVzXHUwMEU0dHpsaWNoIGFuZ2VoXHUwMEU0bmd0ZW4gU2NoYWx0ZXJcclxuICAgICAgLy8gc3RhdHQgbmViZW5laW5hbmRlciAoT2JzaWRpYW5zIFN0YW5kYXJkLUxheW91dCBmXHUwMEZDciBtZWhyZXJlIENvbnRyb2xzIGluXHJcbiAgICAgIC8vIGVpbmVyIFNldHRpbmctWmVpbGUpIHVudGVyZWluYW5kZXIgc3RlaGVuIC0gc2llaGVcclxuICAgICAgLy8gLmZyZWQtbm90ZS10aXRsZS1zZXR0aW5nIGluIHN0eWxlcy5jc3MuXHJcbiAgICAgIG5vdGVUaXRsZVNldHRpbmcuc2V0dGluZ0VsLmFkZENsYXNzKFwiZnJlZC1ub3RlLXRpdGxlLXNldHRpbmdcIik7XHJcblxyXG4gICAgICAvLyBFaWdlbmVzIGtsZWluZXMgTGFiZWwgamUgU2NoYWx0ZXIgc3RhdHQgbnVyIFRvb2x0aXAgLSBhZGRUb2dnbGUoKSBhbGxlaW5cclxuICAgICAgLy8gaFx1MDBFNG5ndCBudXIgZGVuIG5hY2t0ZW4gU2NoYWx0ZXIgb2huZSBCZXNjaHJpZnR1bmcgYW4sIGRhaGVyIGhpZXIgZWluZVxyXG4gICAgICAvLyBlaWdlbmUgWmVpbGUgKExhYmVsICsgVG9nZ2xlQ29tcG9uZW50KSBkaXJla3QgaW4gY29udHJvbEVsIGdlYmF1dC5cclxuICAgICAgY29uc3QgYWRkTGFiZWxlZFRvZ2dsZSA9IChsYWJlbCwgdG9vbHRpcCwgdmFsdWUsIG9uQ2hhbmdlKSA9PiB7XHJcbiAgICAgICAgY29uc3Qgcm93ID0gbm90ZVRpdGxlU2V0dGluZy5jb250cm9sRWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtbm90ZS10aXRsZS10b2dnbGUtcm93XCIgfSk7XHJcbiAgICAgICAgcm93LmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC1ub3RlLXRpdGxlLXRvZ2dsZS1sYWJlbFwiLCB0ZXh0OiBsYWJlbCB9KTtcclxuICAgICAgICBuZXcgVG9nZ2xlQ29tcG9uZW50KHJvdykuc2V0VG9vbHRpcCh0b29sdGlwKS5zZXRWYWx1ZSh2YWx1ZSkub25DaGFuZ2Uob25DaGFuZ2UpO1xyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgYWRkU3VidHlwVG9nZ2xlID0gKGxhYmVsKSA9PlxyXG4gICAgICAgIGFkZExhYmVsZWRUb2dnbGUoXHJcbiAgICAgICAgICBsYWJlbCxcclxuICAgICAgICAgIFwiRmFyYmUgZGVzIFN1YnR5cHMgc3RhdHQgZGVyIGRlcyBUWVBzIHZlcndlbmRlblwiLFxyXG4gICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5ub3RlVGl0bGVNYXJrZXJTdWJ0eXAsXHJcbiAgICAgICAgICBhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5ub3RlVGl0bGVNYXJrZXJTdWJ0eXAgPSB2YWx1ZTtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICk7XHJcblxyXG4gICAgICBpZiAoIWlzQmFkZ2UpIHtcclxuICAgICAgICBhZGRTdWJ0eXBUb2dnbGUoXCJTdWJ0eXBcIik7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCBsYWJlbFJvdyA9IG5vdGVUaXRsZVNldHRpbmcuY29udHJvbEVsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLW5vdGUtdGl0bGUtdG9nZ2xlLXJvd1wiIH0pO1xyXG4gICAgICBsYWJlbFJvdy5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtbm90ZS10aXRsZS10b2dnbGUtbGFiZWxcIiwgdGV4dDogXCJCZXNjaHJpZnR1bmdcIiB9KTtcclxuICAgICAgbmV3IERyb3Bkb3duQ29tcG9uZW50KGxhYmVsUm93KVxyXG4gICAgICAgIC5hZGRPcHRpb24oXCJ0eXBlXCIsIFwiW1RZUF1cIilcclxuICAgICAgICAuYWRkT3B0aW9uKFwidHlwZS1zdWJ0eXBlXCIsIFwiW1RZUC9TdWJ0eXBdXCIpXHJcbiAgICAgICAgLmFkZE9wdGlvbihcInN1YnR5cGVcIiwgXCJbU3VidHlwXVwiKVxyXG4gICAgICAgIC5zZXRWYWx1ZShiYWRnZUxhYmVsKVxyXG4gICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlTGFiZWwgPSB2YWx1ZTtcclxuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbiAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgIGFkZExhYmVsZWRUb2dnbGUoXCJGYXJiaWdcIiwgXCJGYXJiaWcgKFRZUC1GYXJiZSkgc3RhdHQgbmV1dHJhbFwiLCB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUNvbG9yZWQsIGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlQ29sb3JlZCA9IHZhbHVlO1xyXG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgICAgIHRoaXMuZGlzcGxheSgpO1xyXG4gICAgICB9KTtcclxuICAgICAgaWYgKHNob3dTdWJ0eXApIGFkZFN1YnR5cFRvZ2dsZShcIlN1YnR5cC1GYXJiZVwiKTtcclxuXHJcbiAgICAgIGFkZExhYmVsZWRUb2dnbGUoXCJBbSBQcm9wZXJ0eS1CbG9ja1wiLCBcIkFtIFByb3BlcnR5LUJsb2NrIChnZWRyZWh0KSBzdGF0dCBhbSBUaXRlbFwiLCBpc0Jsb2NrUG9zaXRpb24sIGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlUG9zaXRpb24gPSB2YWx1ZSA/IFwiYmxvY2tcIiA6IFwidGl0bGVcIjtcclxuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgICAgICB0aGlzLmRpc3BsYXkoKTtcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBpZiAoaXNCbG9ja1Bvc2l0aW9uKSB7XHJcbiAgICAgICAgYWRkTGFiZWxlZFRvZ2dsZShcclxuICAgICAgICAgIFwiT2JlbiBzdGF0dCB1bnRlblwiLFxyXG4gICAgICAgICAgXCJPYmVuIHN0YXR0IHVudGVuIGFtIFByb3BlcnR5LUJsb2NrXCIsXHJcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVWZXJ0aWNhbEFsaWduID09PSBcInRvcFwiLFxyXG4gICAgICAgICAgYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVZlcnRpY2FsQWxpZ24gPSB2YWx1ZSA/IFwidG9wXCIgOiBcImJvdHRvbVwiO1xyXG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgY29sb3JWaWV3VG9nZ2xlKFxyXG4gICAgICBjb2xvcmluZ0dyb3VwLFxyXG4gICAgICBcImJhY2tsaW5rc1wiLFxyXG4gICAgICBcIkJhY2tsaW5rc1wiLFxyXG4gICAgICBcIlRyZWZmZXJ6ZWlsZW4gaW0gQmFja2xpbmtzLVBhbmUgc293aWUgaW4gZGVuIGltIERva3VtZW50IGVpbmdlYmV0dGV0ZW4gQmFja2xpbmtzIChpbmtsLiBuaWNodCB2ZXJsaW5rdGVyIEVyd1x1MDBFNGhudW5nZW4pIG5hY2ggVFlQIGVpbmZcdTAwRTRyYmVuLlwiLFxyXG4gICAgICBcImJhY2tsaW5rc1N1YnR5cFwiXHJcbiAgICApO1xyXG4gICAgY29sb3JWaWV3VG9nZ2xlKFxyXG4gICAgICBjb2xvcmluZ0dyb3VwLFxyXG4gICAgICBcImJvb2ttYXJrc1wiLFxyXG4gICAgICBcIkJvb2ttYXJrc1wiLFxyXG4gICAgICBcIkVpbnRyXHUwMEU0Z2UgaW0gQm9va21hcmtzLVBhbmUsIGRpZSBkaXJla3QgYXVmIGVpbmUgTm90aXogemVpZ2VuLCBuYWNoIFRZUCBlaW5mXHUwMEU0cmJlbi5cIixcclxuICAgICAgXCJib29rbWFya3NTdWJ0eXBcIlxyXG4gICAgKTtcclxuICAgIGNvbG9yVmlld1RvZ2dsZShcclxuICAgICAgY29sb3JpbmdHcm91cCxcclxuICAgICAgXCJhbGxQcm9wZXJ0aWVzXCIsXHJcbiAgICAgIFwiQWxsIFByb3BlcnRpZXNcIixcclxuICAgICAgXCJJbiBPYnNpZGlhbnMgdmF1bHQtd2VpdGVyIFxcXCJBbGwgUHJvcGVydGllc1xcXCItQW5zaWNodCBQcm9wZXJ0eS1OYW1lbiBlaW5mXHUwMEU0cmJlbiwgZGllIGltIFRZUC1Gcm9udG1hdHRlciBnZW5hdSBlaW5lcyBUWVBzIHZvcmtvbW1lbiAoaW4gZGVzc2VuIEZhcmJlKSAtIGtvbW1lbiBzaWUgYmVpIG1laHJlcmVuIFRZUHMgdm9yLCBzdGF0dGRlc3NlbiBmZXR0IHN0YXR0IGVpbmdlZlx1MDBFNHJidC4gTWl0IFxcXCJTdWJ0eXBcXFwiIHpcdTAwRTRobGVuIGF1Y2ggZGllIEZyb250bWF0dGVyLUJsXHUwMEY2Y2tlIGRlciBTdWJ0eXBlbiBmXHUwMEZDciBpaHJlbiBqZXdlaWxpZ2VuIFRZUCwgZWluZ2VmXHUwMEU0cmJ0IGluIGRlciBGYXJiZSBkZXMgU3VidHlwcy5cIixcclxuICAgICAgXCJhbGxQcm9wZXJ0aWVzU3VidHlwXCIsXHJcbiAgICAgIHsgdHlwVG9vbHRpcDogXCJUWVAtRnJvbnRtYXR0ZXIgZGVyIFRZUGVuXCIsIHN1YnR5cFRvb2x0aXA6IFwiRnJvbnRtYXR0ZXItQmxcdTAwRjZja2UgZGVyIFN1YnR5cGVuIG1pdCBlaW5iZXppZWhlbiwgaW4gU3VidHlwLUZhcmJlXCIgfVxyXG4gICAgKTtcclxuXHJcbiAgICAvLyBHcmVuemVuIGRlciBkcmVpIFJlZ2xlciwgbWl0IGRlbmVuIGVpbiBTdWJ0eXAgc2VpbmUgRmFyYmUgdm9uIGRlciBzZWluZXNcclxuICAgIC8vIFRZUHMgYWJsZWl0ZXQgKEZhcmJwdW5rdCB1bnRlbiBpbSBTdWJ0eXAtQmxvY2sgZGVyIFRZUC1EZXRhaWxhbnNpY2h0LFxyXG4gICAgLy8gc2llaGUgdHlwZS1jb2xvcnMuanMpLiBFaW5lIHNjaG9uIGVpbmdlc3RlbGx0ZSwgZ3JcdTAwRjZcdTAwREZlcmUgQWJ3ZWljaHVuZyB3aXJkXHJcbiAgICAvLyBhdWYgZGllIG5ldWUgR3JlbnplIGdla2FwcHQuXHJcbiAgICBjb25zdCBzdWJ0eXBlQ29sb3JHcm91cCA9IG5ldyBTZXR0aW5nR3JvdXAoY29udGFpbmVyRWwpLnNldEhlYWRpbmcoXCJTdWJ0eXAtRmFyYmVuXCIpO1xyXG4gICAgY29uc3QgcmFuZ2VNYXggPSB7IGg6IDE4MCwgLyogczogMTAwLCAqLyBsOiAxMDAgfTtcclxuICAgIGNvbnN0IHJhbmdlRGVzYyA9IHtcclxuICAgICAgaDogXCJXaWUgd2VpdCBkZXIgRmFyYnRvbiBlaW5lcyBTdWJ0eXBzIGhcdTAwRjZjaHN0ZW5zIHZvbiBkZW0gc2VpbmVzIFRZUHMgYWJ3ZWljaGVuIGRhcmYgKFx1MDBCMSBHcmFkKS5cIixcclxuICAgICAgLy8gczogXCJXaWUgYmxhc3MgZWluIFN1YnR5cCBnZWdlblx1MDBGQ2JlciBzZWluZW0gVFlQIGhcdTAwRjZjaHN0ZW5zIHdlcmRlbiBkYXJmIChQcm96ZW50IGRlciBUWVAtU1x1MDBFNHR0aWd1bmcpLiBEZXIgUmVnbGVyIGdlaHQgbnVyIG5hY2ggdW50ZW4gLSBrclx1MDBFNGZ0aWdlciBhbHMgZGllIEhhdXB0ZmFyYmUgc29sbCBlaW4gU3VidHlwIG5pY2h0IHdlcmRlbi5cIixcclxuICAgICAgbDogXCJXaWUgd2VpdCBkaWUgSGVsbGlna2VpdCBlaW5lcyBTdWJ0eXBzIGhcdTAwRjZjaHN0ZW5zIHZvbiBkZXIgc2VpbmVzIFRZUHMgYWJ3ZWljaGVuIGRhcmYgKFx1MDBCMSBQcm96ZW50IGRlcyBXZWdzIHp1IFdlaVx1MDBERiBiencuIFNjaHdhcnogLSAxMDAgJSB3XHUwMEU0cmUgcmVpbmVzIFdlaVx1MDBERiBiencuIFNjaHdhcnopLlwiLFxyXG4gICAgfTtcclxuICAgIC8vIERlciBSZWdsZXIgbWVsZGV0IGplZGUgWndpc2NoZW5zdGVsbHVuZyAtIGRpZSBcdTAwRkNicmlnZW4gQW5zaWNodGVuIGVyc3RcclxuICAgIC8vIG5hY2h6aWVoZW4sIHdlbm4gZXIga3VyeiBydWh0LlxyXG4gICAgY29uc3QgcmVmcmVzaENvbG9yc1Nvb24gPSBkZWJvdW5jZSgoKSA9PiB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKSwgMzAwLCB0cnVlKTtcclxuICAgIGZvciAoY29uc3QgeyBrZXksIGxhYmVsLCB1bml0LCBkb3duT25seSB9IG9mIFNVQlRZUEVfQ09MT1JfQ0hBTk5FTFMpIHtcclxuICAgICAgc3VidHlwZUNvbG9yR3JvdXAuYWRkU2V0dGluZygoc2V0dGluZykgPT5cclxuICAgICAgICBzZXR0aW5nXHJcbiAgICAgICAgICAuc2V0TmFtZShgJHtsYWJlbH0gKCR7ZG93bk9ubHkgPyBcIlx1MjIxMlwiIDogXCJcdTAwQjFcIn0gJHt1bml0fSlgKVxyXG4gICAgICAgICAgLnNldERlc2MocmFuZ2VEZXNjW2tleV0pXHJcbiAgICAgICAgICAuYWRkU2xpZGVyKChzbGlkZXIpID0+XHJcbiAgICAgICAgICAgIHNsaWRlclxyXG4gICAgICAgICAgICAgIC5zZXRMaW1pdHMoMCwgcmFuZ2VNYXhba2V5XSwgMSlcclxuICAgICAgICAgICAgICAuc2V0VmFsdWUoY29sb3JSYW5nZSh0aGlzLnBsdWdpbi5zZXR0aW5ncywga2V5KSlcclxuICAgICAgICAgICAgICAuc2V0RHluYW1pY1Rvb2x0aXAoKVxyXG4gICAgICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnN1YnR5cGVDb2xvclJhbmdlcyA9IHsgLi4uREVGQVVMVF9TVUJUWVBFX0NPTE9SX1JBTkdFUywgLi4udGhpcy5wbHVnaW4uc2V0dGluZ3Muc3VidHlwZUNvbG9yUmFuZ2VzLCBba2V5XTogdmFsdWUgfTtcclxuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgICAgICAgICAgcmVmcmVzaENvbG9yc1Nvb24oKTtcclxuICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgKVxyXG4gICAgICAgICAgLmFkZEV4dHJhQnV0dG9uKChidXR0b24pID0+XHJcbiAgICAgICAgICAgIGJ1dHRvblxyXG4gICAgICAgICAgICAgIC5zZXRJY29uKFwicm90YXRlLWNjd1wiKVxyXG4gICAgICAgICAgICAgIC5zZXRUb29sdGlwKGBadXJcdTAwRkNja3NldHplbiBhdWYgJHtERUZBVUxUX1NVQlRZUEVfQ09MT1JfUkFOR0VTW2tleV19YClcclxuICAgICAgICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5zdWJ0eXBlQ29sb3JSYW5nZXMgPSB7IC4uLkRFRkFVTFRfU1VCVFlQRV9DT0xPUl9SQU5HRVMsIC4uLnRoaXMucGx1Z2luLnNldHRpbmdzLnN1YnR5cGVDb2xvclJhbmdlcywgW2tleV06IERFRkFVTFRfU1VCVFlQRV9DT0xPUl9SQU5HRVNba2V5XSB9O1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xyXG4gICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICApXHJcbiAgICAgICk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gR3J1cHBlIFwiR3JhcGhcIiAoVGFnLS9BbmhcdTAwRTRuZ2UtRmFyYmUpIGRlYWt0aXZpZXJ0ICgzMC4wOS4yMDI2KTogYmVpZGVzIGlzdCBpbVxyXG4gICAgLy8gTWluaW1hbCBUaGVtZSBcdTAwRkNiZXIgZGllIFN0eWxlIFNldHRpbmdzIGVpbnN0ZWxsYmFyLCBzaWVoZSBncmFwaC1jb2xvcnMuanMuXHJcbiAgICAvLyBEaWUgVFlQLUVpbmZcdTAwRTRyYnVuZyBkZXIgTm90aXotS25vdGVuIGJsZWlidCBha3RpdiwgU2NoYWx0ZXIgb2JlbiB1bnRlclxyXG4gICAgLy8gXCJFaW5mXHUwMEU0cmJ1bmdcIiBcdTIxOTIgXCJHcmFwaFwiLlxyXG4gICAgLy8gICAgIGNvbnN0IGdyYXBoR3JvdXAgPSBuZXcgU2V0dGluZ0dyb3VwKGNvbnRhaW5lckVsKS5zZXRIZWFkaW5nKFwiR3JhcGhcIik7XHJcbiAgICAvL1xyXG4gICAgLy8gICAgIC8vIEVpbiBTZXR0aW5nIHBybyBOb2RlLVR5cCwgZGVuIE9ic2lkaWFucyBHcmFwaC1FbmdpbmUga2VubnQgLSBnbGVpY2hlclxyXG4gICAgLy8gICAgIC8vIEF1ZmJhdSAoVG9nZ2xlICsgRmFyYndhaGwgKyBadXJcdTAwRkNja3NldHplbikgZlx1MDBGQ3IgamVkZW4sIGRhaGVyIGFscyBIZWxwZXJcclxuICAgIC8vICAgICAvLyBzdGF0dCBkdXBsaXppZXJ0LlxyXG4gICAgLy8gICAgIGNvbnN0IGdyYXBoQ29sb3JTZXR0aW5nID0gKGVuYWJsZWRLZXksIGNvbG9yS2V5LCBkZWZhdWx0Q29sb3IsIG5hbWUsIGRlc2MpID0+XHJcbiAgICAvLyAgICAgICBncmFwaEdyb3VwLmFkZFNldHRpbmcoKHNldHRpbmcpID0+XHJcbiAgICAvLyAgICAgICAgIHNldHRpbmdcclxuICAgIC8vICAgICAgICAgICAuc2V0TmFtZShuYW1lKVxyXG4gICAgLy8gICAgICAgICAgIC5zZXREZXNjKGRlc2MpXHJcbiAgICAvLyAgICAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxyXG4gICAgLy8gICAgICAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzW2VuYWJsZWRLZXldKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgIC8vICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3NbZW5hYmxlZEtleV0gPSB2YWx1ZTtcclxuICAgIC8vICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAvLyAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgLy8gICAgICAgICAgICAgfSlcclxuICAgIC8vICAgICAgICAgICApXHJcbiAgICAvLyAgICAgICAgICAgLmFkZENvbG9yUGlja2VyKChwaWNrZXIpID0+XHJcbiAgICAvLyAgICAgICAgICAgICBwaWNrZXIuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3NbY29sb3JLZXldIHx8IGRlZmF1bHRDb2xvcikub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAvLyAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzW2NvbG9yS2V5XSA9IHZhbHVlO1xyXG4gICAgLy8gICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgIC8vICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbiAgICAvLyAgICAgICAgICAgICB9KVxyXG4gICAgLy8gICAgICAgICAgIClcclxuICAgIC8vICAgICAgICAgICAuYWRkRXh0cmFCdXR0b24oKGJ1dHRvbikgPT5cclxuICAgIC8vICAgICAgICAgICAgIGJ1dHRvblxyXG4gICAgLy8gICAgICAgICAgICAgICAuc2V0SWNvbihcInJvdGF0ZS1jY3dcIilcclxuICAgIC8vICAgICAgICAgICAgICAgLnNldFRvb2x0aXAoXCJadXJcdTAwRkNja3NldHplbiBhdWYgU3RhbmRhcmRmYXJiZVwiKVxyXG4gICAgLy8gICAgICAgICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XHJcbiAgICAvLyAgICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3NbY29sb3JLZXldID0gXCJcIjtcclxuICAgIC8vICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgIC8vICAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgIC8vICAgICAgICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcclxuICAgIC8vICAgICAgICAgICAgICAgfSlcclxuICAgIC8vICAgICAgICAgICApXHJcbiAgICAvLyAgICAgICApO1xyXG4gICAgLy9cclxuICAgIC8vICAgICBncmFwaENvbG9yU2V0dGluZyhcclxuICAgIC8vICAgICAgIFwiZ3JhcGhUYWdDb2xvckVuYWJsZWRcIixcclxuICAgIC8vICAgICAgIFwiZ3JhcGhUYWdDb2xvclwiLFxyXG4gICAgLy8gICAgICAgXCIjODg4ODg4XCIsXHJcbiAgICAvLyAgICAgICBcIlRhZy1GYXJiZVwiLFxyXG4gICAgLy8gICAgICAgXCJFaWdlbmUgRmFyYmUgZlx1MDBGQ3IgVGFnLUtub3RlbiBpbSBHcmFwaCAoZ2xvYmFsIHVuZCBsb2thbCkgdmVyd2VuZGVuIHN0YXR0IGRlciBTdGFuZGFyZGZhcmJlLiBFaWdlbmUgRmFyYmdydXBwZW4gaW0gR3JhcGggaGFiZW4gd2VpdGVyaGluIFZvcnJhbmcuXCJcclxuICAgIC8vICAgICApO1xyXG4gICAgLy8gICAgIGdyYXBoQ29sb3JTZXR0aW5nKFxyXG4gICAgLy8gICAgICAgXCJncmFwaEF0dGFjaG1lbnRDb2xvckVuYWJsZWRcIixcclxuICAgIC8vICAgICAgIFwiZ3JhcGhBdHRhY2htZW50Q29sb3JcIixcclxuICAgIC8vICAgICAgIFwiI2UwYWMwMFwiLFxyXG4gICAgLy8gICAgICAgXCJBbmhcdTAwRTRuZ2UtRmFyYmVcIixcclxuICAgIC8vICAgICAgIFwiRWlnZW5lIEZhcmJlIGZcdTAwRkNyIEFuaGFuZy1Lbm90ZW4gKE5pY2h0LU1hcmtkb3duLURhdGVpZW4gd2llIEJpbGRlciBvZGVyIFBERnMpIGltIEdyYXBoIHZlcndlbmRlbiBzdGF0dCBkZXIgU3RhbmRhcmRmYXJiZS5cIlxyXG4gICAgLy8gICAgICk7XHJcblxyXG4gICAgY29uc3QgZnJvbnRtYXR0ZXJHcm91cCA9IG5ldyBTZXR0aW5nR3JvdXAoY29udGFpbmVyRWwpLnNldEhlYWRpbmcoXCJUWVAtRnJvbnRtYXR0ZXJcIik7XHJcblxyXG4gICAgY29sb3JWaWV3VG9nZ2xlKFxyXG4gICAgICBmcm9udG1hdHRlckdyb3VwLFxyXG4gICAgICBcImZyb250bWF0dGVyRGVmYXVsdHNcIixcclxuICAgICAgXCJQcm9wZXJ0eS1OYW1lbiBmZXR0IG1hcmtpZXJlblwiLFxyXG4gICAgICBcIkluIE5vdGl6ZW4gKEZyb250bWF0dGVyIGltIERva3VtZW50IHNvd2llIFByb3BlcnRpZXMtU2VpdGVubGVpc3RlKSBkaWUgTmFtZW4gZGVyIFByb3BlcnRpZXMgZmV0dCBkYXJzdGVsbGVuLCBkaWUgaW0gVFlQLUZyb250bWF0dGVyIGRlcyBqZXdlaWxpZ2VuIFRZUHMgaGludGVybGVndCBzaW5kLiBNaXQgXFxcIlN1YnR5cFxcXCIgenVzXHUwMEU0dHpsaWNoIGRpZSBhdXMgZGVtIEZyb250bWF0dGVyLUJsb2NrIGlocmVzIFNVQlRZUHMuXCIsXHJcbiAgICAgIFwiZnJvbnRtYXR0ZXJEZWZhdWx0c1N1YnR5cFwiLFxyXG4gICAgICB7IHR5cFRvb2x0aXA6IFwiVFlQLUZyb250bWF0dGVyIGRlciBUWVBlblwiLCBzdWJ0eXBUb29sdGlwOiBcIkZyb250bWF0dGVyLUJsXHUwMEY2Y2tlIGRlciBTdWJ0eXBlbiBtaXQgZWluYmV6aWVoZW5cIiB9XHJcbiAgICApO1xyXG5cclxuICAgIC8vIE9yZGVyLUVkaXRvciBzYW10IEJlc2NocmVpYnVuZyBhbHMgZWlnZW5lciBFaW50cmFnIGRlcnNlbGJlbiBHcnVwcGUgLVxyXG4gICAgLy8gYnJpbmd0IFx1MDBEQ2JlcnNjaHJpZnQgdW5kIEJ1dHRvbnMgc2VsYnN0IG1pdCwgZGFoZXIgZGlyZWt0IGluIGluZm9FbCBzdGF0dFxyXG4gICAgLy8gXHUwMEZDYmVyIHNldE5hbWUvc2V0RGVzYyAoc2llaGUgLmZyZWQtb3JkZXItc2V0dGluZyBpbiBzdHlsZXMuY3NzKS5cclxuICAgIGZyb250bWF0dGVyR3JvdXAuYWRkU2V0dGluZygoc2V0dGluZykgPT4ge1xyXG4gICAgICBzZXR0aW5nLnNldHRpbmdFbC5hZGRDbGFzcyhcImZyZWQtb3JkZXItc2V0dGluZ1wiKTtcclxuICAgICAgbW91bnRHbG9iYWxPcmRlckVkaXRvcihzZXR0aW5nLmluZm9FbCwgdGhpcy5wbHVnaW4pO1xyXG4gICAgICBzZXR0aW5nLmluZm9FbC5jcmVhdGVEaXYoe1xyXG4gICAgICAgIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIixcclxuICAgICAgICB0ZXh0OlxyXG4gICAgICAgICAgJ0Jlc3RpbW10IGRpZSBSZWloZW5mb2xnZSwgaW4gZGVyIGRpZSBCZWZlaGxlIFwiRnJvbnRtYXR0ZXIgU29ydGllcnVuZyBha3R1YWxpc2llcmVuXCIgZGllIGluIGVpbmVyIE5vdGl6IHZvcmhhbmRlbmVuIFByb3BlcnRpZXMgYW5vcmRuZW4gKGVyZ1x1MDBFNG56dCBvZGVyIFx1MDBFNG5kZXJ0IGtlaW5lIFdlcnRlKS4gRWluemVsbmUgUHJvcGVydGllcyAoei4gQi4gY3NzY2xhc3NlcywgYWxpYXNlcykgbGFzc2VuIHNpY2ggZmVzdCBwbGF0emllcmVuIC0gXCJUWVBcIiBpc3QgZGllIFRZUC1Qcm9wZXJ0eSBzZWxic3QsIFwiU1VCVFlQXCIgYW5hbG9nIGRpZSBTVUJUWVAtUHJvcGVydHksIFwiVFlQLUZyb250bWF0dGVyXCIgc3RlaHQgZlx1MDBGQ3IgZGllIFRZUC1Gcm9udG1hdHRlci1MaXN0ZSBkZXMgamV3ZWlsaWdlbiBUeXBzIHNhbXQgZGFoaW50ZXIgZGVtIEJsb2NrIHNlaW5lcyBTVUJUWVBzLCBcIlNvbnN0aWdlIFByb3BlcnRpZXNcIiBmXHUwMEZDciBhbGxlcyBcdTAwRENicmlnZS4gUmVpaGVuZm9sZ2UgcGVyIERyYWcgJiBEcm9wIFx1MDBFNG5kZXJiYXIsIGRpZSB2aWVyIFBsYXR6aGFsdGVyLVplaWxlbiBsYXNzZW4gc2ljaCBuaWNodCBlbnRmZXJuZW4uJyxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBjb250YWluZXJFbC5zY3JvbGxUb3AgPSBzY3JvbGxUb3A7XHJcbiAgfVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IHsgREVGQVVMVF9TRVRUSU5HUywgVHlwU3lzdGVtU2V0dGluZ1RhYiB9O1xyXG4iLCAiY29uc3QgeyBOb3RpY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgc29ydEFsbEZyb250bWF0dGVyLCBzb3J0U2luZ2xlRmlsZUZyb250bWF0dGVyIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1zb3J0XCIpO1xuXG5mdW5jdGlvbiByZWdpc3RlckNvbW1hbmRzKHBsdWdpbikge1xuXG4gIC8vIE9ic2lkaWFuIGF3YWl0ZWQgZGVuIGNhbGxiYWNrIGVpbmVyIEJlZmVobHNkZWZpbml0aW9uIG5pY2h0IHVuZCBmXHUwMEU0bmd0IGF1Y2hcbiAgLy8ga2VpbmUgRmVobGVyIGFiIC0gZWluZSBFeGNlcHRpb24gZGFyaW4gd1x1MDBGQ3JkZSBzb25zdCBsYXV0bG9zIHZlcnNjaHdpbmRlblxuICAvLyAobnVyIGVpbiBFaW50cmFnIGluIGRlciBFbnR3aWNrbGVya29uc29sZSwga2VpbmUgc2ljaHRiYXJlIFJcdTAwRkNja21lbGR1bmcpLlxuICAvLyBEaWVzZSBkcmVpIFNvcnRpZXJiZWZlaGxlIGxhdWZlbiBkZXNoYWxiIFx1MDBGQ2JlciBydW5PclJlcG9ydEVycm9yKCksIGRhbWl0XG4gIC8vIGltIEZlaGxlcmZhbGwgdHJvdHpkZW0gaW1tZXIgZWluZSBOb3RpY2UgZXJzY2hlaW50IHN0YXR0IGdhciBrZWluZS5cbiAgY29uc3QgcnVuT3JSZXBvcnRFcnJvciA9IChsYWJlbCwgZm4pID0+IGFzeW5jICgpID0+IHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgZm4oKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihgWyR7bGFiZWx9XWAsIGVycm9yKTtcbiAgICAgIG5ldyBOb3RpY2UoYCR7bGFiZWx9IGZlaGxnZXNjaGxhZ2VuOiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgfVxuICB9O1xuXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJmcm9udG1hdHRlci1zb3J0aWVydW5nLWFsbGVcIixcbiAgICBuYW1lOiBcIkZyb250bWF0dGVyIFNvcnRpZXJ1bmcgR0xPQkFMIGFrdHVhbGlzaWVyZW5cIixcbiAgICBjYWxsYmFjazogcnVuT3JSZXBvcnRFcnJvcihcIkZyb250bWF0dGVyIFNvcnRpZXJ1bmdcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgeyBjaGVja2VkLCBjaGFuZ2VkIH0gPSBhd2FpdCBzb3J0QWxsRnJvbnRtYXR0ZXIocGx1Z2luLmFwcCwgcGx1Z2luLCBudWxsKTtcbiAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgIGNoYW5nZWQgPiAwXG4gICAgICAgICAgPyBgRnJvbnRtYXR0ZXIgU29ydGllcnVuZzogJHtjaGVja2VkfSBOb3RpemVuIGdlcHJcdTAwRkNmdCwgJHtjaGFuZ2VkfSBzb3J0aWVydC5gXG4gICAgICAgICAgOiBgRnJvbnRtYXR0ZXIgU29ydGllcnVuZzogJHtjaGVja2VkfSBOb3RpemVuIGdlcHJcdTAwRkNmdCwgYmVyZWl0cyBhbGxlIHNvcnRpZXJ0LmBcbiAgICAgICk7XG4gICAgfSksXG4gIH0pO1xuXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJmcm9udG1hdHRlci1zb3J0aWVydW5nLXR5cFwiLFxuICAgIG5hbWU6IFwiRnJvbnRtYXR0ZXIgU29ydGllcnVuZyBmXHUwMEZDciBUWVAgYWt0dWFsaXNpZXJlblwiLFxuICAgIGNhbGxiYWNrOiBydW5PclJlcG9ydEVycm9yKFwiRnJvbnRtYXR0ZXIgU29ydGllcnVuZ1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBEZXJzZWxiZSBUWVAtUGlja2VyIHdpZSBcdTAwRkNiZXJhbGwgc29uc3QgaW0gUGx1Z2luIChzaWVoZSB0eXBlLXBpY2tlci5qcykgLVxuICAgICAgLy8gemVpZ3QgRmFyYmUsIEJlc2NocmVpYnVuZyB1bmQgTm90aXotQW56YWhsIHN0YXR0IGVpbmVyIHJlaW5lbiBOYW1lbnNsaXN0ZVxuICAgICAgLy8gKHVuZCBtZWxkZXQgc2VsYnN0LCBmYWxscyBlcyBnYXIga2VpbmUgVFlQZW4gZ2lidCkuIGluY2x1ZGVNYW51YWxPZmYgdW5kXG4gICAgICAvLyBpbmNsdWRlVW5yZWdpc3RlcmVkOiB0cnVlLCBkYSBkaWUgU29ydGllcnVuZyB1bmFiaFx1MDBFNG5naWcgZGF2b24gc2lubnZvbGxcbiAgICAgIC8vIGlzdCwgb2IgZWluIFRZUCBtYW51ZWxsIHZlcmdlYmVuIHdlcmRlbiBkYXJmICh6LiBCLiBLT05UQUtULCBFWFRFUk4pXG4gICAgICAvLyBvZGVyIFx1MDBGQ2JlcmhhdXB0IGluIGRlciBUWVAtTGlzdGUgcmVnaXN0cmllcnQgaXN0LlxuICAgICAgY29uc3QgdHlwZSA9IGF3YWl0IHBsdWdpbi5waWNrVHlwZSh7IGluY2x1ZGVNYW51YWxPZmY6IHRydWUsIGluY2x1ZGVVbnJlZ2lzdGVyZWQ6IHRydWUgfSk7XG4gICAgICBpZiAoIXR5cGUpIHJldHVybjtcbiAgICAgIGNvbnN0IHsgY2hlY2tlZCwgY2hhbmdlZCwgaGFzVHlwZURlZmF1bHRzIH0gPSBhd2FpdCBzb3J0QWxsRnJvbnRtYXR0ZXIocGx1Z2luLmFwcCwgcGx1Z2luLCB0eXBlKTtcbiAgICAgIGxldCBtZXNzYWdlID1cbiAgICAgICAgY2hhbmdlZCA+IDBcbiAgICAgICAgICA/IGBGcm9udG1hdHRlciBTb3J0aWVydW5nICR7dHlwZX06ICR7Y2hlY2tlZH0gTm90aXplbiBnZXByXHUwMEZDZnQsICR7Y2hhbmdlZH0gc29ydGllcnQuYFxuICAgICAgICAgIDogYEZyb250bWF0dGVyIFNvcnRpZXJ1bmcgJHt0eXBlfTogJHtjaGVja2VkfSBOb3RpemVuIGdlcHJcdTAwRkNmdCwgYmVyZWl0cyBhbGxlIHNvcnRpZXJ0LmA7XG4gICAgICAvLyBLZWluIEZlaGxlciwgYWJlciBvaG5lIFRZUC1Gcm9udG1hdHRlciBncmVpZnQgZlx1MDBGQ3IgZGllc2VuIFR5cCBudXJcbiAgICAgIC8vIGRpZSBnbG9iYWxlIFJlaWhlbmZvbGdlIChUWVAgc2VsYnN0LCBmZXN0IHBvc2l0aW9uaWVydGUgUHJvcGVydGllcykgLVxuICAgICAgLy8gb2huZSBkaWVzZW4gSGlud2VpcyB3XHUwMEU0cmUgdW5rbGFyLCB3YXJ1bSBzaWNoIGdnZi4gbmljaHRzIGdlXHUwMEU0bmRlcnQgaGF0LlxuICAgICAgaWYgKGhhc1R5cGVEZWZhdWx0cyA9PT0gZmFsc2UpIHtcbiAgICAgICAgbWVzc2FnZSArPSBgIEhpbndlaXM6IEZcdTAwRkNyICR7dHlwZX0gaXN0IGtlaW4gVFlQLUZyb250bWF0dGVyIGhpbnRlcmxlZ3QgLSBudXIgZGllIGdsb2JhbGUgUmVpaGVuZm9sZ2Ugd3VyZGUgYW5nZXdlbmRldC5gO1xuICAgICAgfVxuICAgICAgbmV3IE5vdGljZShtZXNzYWdlKTtcbiAgICB9KSxcbiAgfSk7XG5cbiAgcGx1Z2luLmFkZENvbW1hbmQoe1xuICAgIGlkOiBcImZyb250bWF0dGVyLXNvcnRpZXJ1bmctYWt0aXZlLW5vdGl6XCIsXG4gICAgbmFtZTogXCJGcm9udG1hdHRlciBTb3J0aWVydW5nIGRlciBha3RpdmVuIE5vdGl6IGFrdHVhbGlzaWVyZW5cIixcbiAgICBjaGVja0NhbGxiYWNrOiAoY2hlY2tpbmcpID0+IHtcbiAgICAgIGNvbnN0IGZpbGUgPSBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gICAgICBpZiAoIWZpbGUgfHwgZmlsZS5leHRlbnNpb24gIT09IFwibWRcIikgcmV0dXJuIGZhbHNlO1xuICAgICAgaWYgKGNoZWNraW5nKSByZXR1cm4gdHJ1ZTtcblxuICAgICAgcnVuT3JSZXBvcnRFcnJvcihcIkZyb250bWF0dGVyIFNvcnRpZXJ1bmdcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBjaGFuZ2VkID0gYXdhaXQgc29ydFNpbmdsZUZpbGVGcm9udG1hdHRlcihwbHVnaW4uYXBwLCBwbHVnaW4sIGZpbGUpO1xuICAgICAgICBuZXcgTm90aWNlKGNoYW5nZWQgPyBgRnJvbnRtYXR0ZXIgdm9uIFwiJHtmaWxlLmJhc2VuYW1lfVwiIHNvcnRpZXJ0LmAgOiBgRnJvbnRtYXR0ZXIgdm9uIFwiJHtmaWxlLmJhc2VuYW1lfVwiIHdhciBiZXJlaXRzIHNvcnRpZXJ0LmApO1xuICAgICAgfSkoKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0sXG4gIH0pO1xuXG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckNvbW1hbmRzIH07XG4iLCAiY29uc3QgeyBtb21lbnQgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcblxuLy8gRWluIFNob3J0Y3V0IGlzdCBlaW4gVmVyd2VpcyBhdWYgZWluZW4gZXJzdCBiZWltIEFubGVnZW4gZWluZXIgTm90aXpcbi8vIGJlcmVjaG5ldGVuIFdlcnQuIEVyIHN0ZWh0IGJld3Vzc3QgTklDSFQgaW0gRnJvbnRtYXR0ZXItV2VydCBkZXIgUHJvcGVydHksXG4vLyBzb25kZXJuIGRhbmViZW4gLSBpbiBzZXR0aW5ncy50eXBlU2hvcnRjdXRzW1RZUF1ba2V5XSBmXHUwMEZDciBkYXMgVFlQLUZyb250bWF0dGVyXG4vLyBiencuIGltIHNob3J0Y3V0cy1PYmpla3QgZGVzIGpld2VpbGlnZW4gU3VidHlwLUJsb2NrcyAoc2llaGUgc3VidHlwZXMuanMpOlxuLy8gICB7IG5hbWU6IFwidG9kYXlcIiB9ICAgICAgICAgICAgLSBmZXN0ZXIgVG9rZW4sIGhpZXIgaW0gUGx1Z2luIGF1ZmdlbFx1MDBGNnN0XG4vLyAgIHsgbmFtZTogXCJ0cC48U2tyaXB0bmFtZT5cIiB9ICAtIFRlbXBsYXRlci1Ta3JpcHQsIG51ciB2b24gVFlQLmpzIGF1ZmxcdTAwRjZzYmFyXG4vLyAgIHsgbmFtZTogXCJ0cC48U2tyaXB0bmFtZT5cIiwgYXJnczogeyBvcmRuZXI6IFwiTGl0ZXJhdHVyXCIsIGphaHI6IDIwMjQgfSB9XG4vLyAgICAgLSBkYXNzZWxiZSBtaXQgQXJndW1lbnRlbi4gRGllIFBhcmFtZXRlcm5hbWVuIGRla2xhcmllcnQgZGFzIFNrcmlwdFxuLy8gICAgICAgc2VsYnN0IGltIEB0eXAtc2hvcnRjdXQtTWFya2VyIChzaWVoZSBzaG9ydGN1dC1zY3JpcHRzLmpzKTsgVFlQLmpzXG4vLyAgICAgICByZWljaHQgZGFzIE9iamVrdCBhbHMgY3R4LmFyZ3MgZHVyY2guIEZlc3RlIFRva2VuIGhhYmVuIG5pZSBBcmd1bWVudGUuXG4vL1xuLy8gV2FydW0gZGFuZWJlbiBzdGF0dCBpbSBXZXJ0OiBPYnNpZGlhbnMgUHJvcGVydHktV2lkZ2V0IGJlc3RpbW10IGRhc1xuLy8gRWluZ2FiZWZlbGQgZWluZXIgWmVpbGUgYXVzIGRlbSBpbiB0eXBlcy5qc29uIGRla2xhcmllcnRlbiBUeXAgZGVyIFByb3BlcnR5XG4vLyAoZ2V0VHlwZUluZm8gaW0gZ2ViYXV0ZW4gYXBwLmpzKS4gQmVpIGVpbmVyIGFscyBcImRhdGVcIi9cIm51bWJlclwiL1wiY2hlY2tib3hcIlxuLy8gZGVrbGFyaWVydGVuIFByb3BlcnR5IGlzdCBkYXMgZWluIDxpbnB1dCB0eXBlPVwiZGF0ZVwiPiwgZWluXG4vLyA8aW5wdXQgdHlwZT1cIm51bWJlclwiPiBiencuIGVpbiBUb2dnbGUgLSBkb3J0IGxpZVx1MDBERiBzaWNoIGVpbiBUb2tlbiB3aWVcbi8vIFwie3t0b2RheX19XCIgZ2FyIG5pY2h0IGVyc3QgZWludGlwcGVuLCBlaW4gdHJvdHpkZW0gZ2VzcGVpY2hlcnRlciBXZXJ0IGxcdTAwRjZzdGVcbi8vIE9ic2lkaWFucyBcIlR5cGUgbWlzbWF0Y2hcIi1XYXJudW5nIGF1cywgdW5kIGRhcyBMaXN0ZW4tV2lkZ2V0IG1hY2h0ZSBhdXMgZWluZW1cbi8vIFN0cmluZyBiZWltIGVyc3RlbiBCZWFyYmVpdGVuIHN0aWxsc2Nod2VpZ2VuZCBlaW4gQXJyYXkgKG9uQ2hhbmdlKGUuc2xpY2UoKSkpLlxuLy8gQWxsZSBkaWVzZSBQcm9ibGVtZSBoYWJlbiBkaWVzZWxiZSBVcnNhY2hlOiBlaW4gRnJlbWRrXHUwMEY2cnBlciBpbiBlaW5lbSBTbG90LFxuLy8gZGVzc2VuIERhdGVudHlwIE9ic2lkaWFuIGtvbnRyb2xsaWVydC4gTGllZ3QgZGVyIFNob3J0Y3V0IGRhbmViZW4sIGJsZWlidCBkZXJcbi8vIFdlcnQgdHlwcmVpbiB1bmQgZGFzIG5hdGl2ZSBXaWRnZXQgdW5hbmdldGFzdGV0IC0gZXMgYnJhdWNodCBkYWZcdTAwRkNyIGtlaW5lcmxlaVxuLy8gRWluZ3JpZmYgaW4gT2JzaWRpYW5zIFplaWxlbi1SZW5kZXJpbmcuXG4vL1xuLy8gRGVyIEZyb250bWF0dGVyLVdlcnQgZGVyIFByb3BlcnR5IGJsZWlidCBkYWJlaSBlcmhhbHRlbiB1bmQgZGllbnQgYWxzXG4vLyBSXHUwMERDQ0tGQUxMV0VSVDogU2NobFx1MDBFNGd0IGRhcyBUZW1wbGF0ZXItU2tyaXB0IGZlaGwgKGZlaGx0IG9kZXIgd2lyZnQpLCBzY2hyZWlidFxuLy8gVFlQLmpzIGlobiBzdGF0dCBlaW5lcyBsZWVyZW4gV2VydHMgKHNpZWhlIGdldFR5cGVTaG9ydGN1dHMgaW4gbWFpbi5qcyB1bmRcbi8vIGRpZSBBdXN3ZXJ0dW5nIGluIFRZUC5qcykuIEVpbiBTa3JpcHQsIGRhcyBiZXd1c3N0IG51bGwvXCJcIiBsaWVmZXJ0IC0gZXR3YSBiZWlcbi8vIEVTQyBpbSBQaWNrZXIgLSwgZ2lsdCBkYWdlZ2VuIG5pY2h0IGFscyBGZWhsc2NobGFnIHVuZCBsXHUwMEU0c3N0IGRpZSBQcm9wZXJ0eSBsZWVyLlxuXG4vLyBEaWUgZmVzdGVuIFRva2VuLCBkaWUgZGFzIFBsdWdpbiBzZWxic3QgYXVmbFx1MDBGNnNlbiBrYW5uIC0gb2huZSBUZW1wbGF0ZXIgdW5kXG4vLyBvaG5lIHRwLVp1Z3JpZmYsIGRhaGVyIHNjaG9uIGluIGdldFR5cGVEZWZhdWx0cygpIChtYWluLmpzKSBlaW5nZXNldHp0LiBFcnN0XG4vLyBiZWltIEFicnVmIGF1ZmdlbFx1MDBGNnN0LCBuaWNodCBiZWltIFNwZWljaGVybiwgZGFtaXQgei4gQi4gXCJ0b2RheVwiIGJlaSBqZWRlciBuZXVcbi8vIGFuZ2VsZWd0ZW4gTm90aXogZGFzIGRhbm4gYWt0dWVsbGUgRGF0dW0gbGllZmVydCBzdGF0dCBkZXMgVGFnZXMsIGFuIGRlbSBkZXJcbi8vIFNob3J0Y3V0IGdlc2V0enQgd3VyZGUuXG5jb25zdCBGSVhFRF9TSE9SVENVVFMgPSBbXG4gIHtcbiAgICBuYW1lOiBcInRvZGF5XCIsXG4gICAgZGVzY3JpcHRpb246IFwiSGV1dGlnZXMgRGF0dW0gKEpKSkotTU0tVFQpXCIsXG4gICAgcmVzb2x2ZTogKCkgPT4gbW9tZW50KCkuZm9ybWF0KFwiWVlZWS1NTS1ERFwiKSxcbiAgfSxcbiAge1xuICAgIG5hbWU6IFwibm93XCIsXG4gICAgZGVzY3JpcHRpb246IFwiQWt0dWVsbGVzIERhdHVtIG1pdCBVaHJ6ZWl0IChKSkpKLU1NLVRUIEhIOm1tKVwiLFxuICAgIHJlc29sdmU6ICgpID0+IG1vbWVudCgpLmZvcm1hdChcIllZWVktTU0tREQgSEg6bW1cIiksXG4gIH0sXG4gIHtcbiAgICAvLyBBbmRlcnMgYWxzIHRvZGF5L25vdyBuaWNodCBkZXIgQXVmcnVmemVpdHB1bmt0LCBzb25kZXJuIGRhc1xuICAgIC8vIEVyc3RlbGx1bmdzZGF0dW0gZGVyIGpld2VpbGlnZW4gRGF0ZWkgKGZpbGUuc3RhdC5jdGltZSkgLSBicmF1Y2h0IGRhaGVyXG4gICAgLy8gZGllIFppZWwtRGF0ZWkgYWxzIEtvbnRleHQgKGZpbGUtUGFyYW1ldGVyLCB2b24gZ2V0VHlwZURlZmF1bHRzXG4gICAgLy8gZHVyY2hnZXJlaWNodCkuIE9obmUgRGF0ZWkgRmFsbGJhY2sgYXVmIGRlbiBha3R1ZWxsZW4gWmVpdHB1bmt0LlxuICAgIG5hbWU6IFwiY3JlYXRlZFwiLFxuICAgIGRlc2NyaXB0aW9uOiBcIkVyc3RlbGx1bmdzZGF0dW0gZGVyIERhdGVpIChKSkpKLU1NLVRUKVwiLFxuICAgIHJlc29sdmU6IChmaWxlKSA9PiBtb21lbnQoZmlsZT8uc3RhdD8uY3RpbWUgPz8gRGF0ZS5ub3coKSkuZm9ybWF0KFwiWVlZWS1NTS1ERFwiKSxcbiAgfSxcbl07XG5cbi8vIFNrcmlwdC1TaG9ydGN1dHMgdHJhZ2VuIGRpZXNlbiBQclx1MDBFNGZpeCBpbSBuYW1lLCBkYW1pdCBlaW4gU2tyaXB0IG5pZSBtaXQgZWluZW1cbi8vIGZlc3RlbiBUb2tlbiBrb2xsaWRpZXJlbiBrYW5uIC0gYXVjaCBkYW5uIG5pY2h0LCB3ZW5uIGplbWFuZCBlaW5lIERhdGVpXG4vLyBcInRvZGF5LmpzXCIgaW4gZGVuIFRlbXBsYXRlci1Ta3JpcHQtT3JkbmVyIGxlZ3QuXG5jb25zdCBTQ1JJUFRfUFJFRklYID0gXCJ0cC5cIjtcblxuZnVuY3Rpb24gZmluZEZpeGVkU2hvcnRjdXQobmFtZSkge1xuICByZXR1cm4gRklYRURfU0hPUlRDVVRTLmZpbmQoKHNob3J0Y3V0KSA9PiBzaG9ydGN1dC5uYW1lID09PSBuYW1lKSA/PyBudWxsO1xufVxuXG4vLyBTa3JpcHRuYW1lIGVpbmVzIFwidHAuPFNrcmlwdG5hbWU+XCItU2hvcnRjdXRzLCBzb25zdCBudWxsLiBTa3JpcHRuYW1lID1cbi8vIERhdGVpbmFtZSBpbiB0ZW1wbGF0ZXItc2NyaXB0cy8gb2huZSBcIi5qc1wiLCBkYWhlciBhdWNoIG1pdCBVbWxhdXRlbiwgXCItXCJcbi8vIG9kZXIgTGVlcnplaWNoZW4gZXJsYXVidC5cbmZ1bmN0aW9uIHNjcmlwdE5hbWVPZihuYW1lKSB7XG4gIHJldHVybiB0eXBlb2YgbmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBuYW1lLnN0YXJ0c1dpdGgoU0NSSVBUX1BSRUZJWCkgPyBuYW1lLnNsaWNlKFNDUklQVF9QUkVGSVgubGVuZ3RoKSA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIGlzU2NyaXB0U2hvcnRjdXQocmVjb3JkKSB7XG4gIHJldHVybiBzY3JpcHROYW1lT2YocmVjb3JkPy5uYW1lKSAhPT0gbnVsbDtcbn1cblxuLy8gQW56ZWlnZWZvcm0gZWluZXMgU2hvcnRjdXRzIC0gaW4gZGVyIFByb3BlcnR5LVplaWxlIChDaGlwKSB1bmQgaW0gQXVzd2FobC1cbi8vIE1vZGFsLiBCZXd1c3N0IGRlciBuYWNrdGUgbmFtZSBvaG5lIFppZXJyYXQ6IEZyXHUwMEZDaGVyIHN0YW5kIGRlciBTaG9ydGN1dCBhbHNcbi8vIFwie3t0b2RheX19XCIgaW0gV2VydCBkZXIgUHJvcGVydHksIGRpZSBnZXNjaHdlaWZ0ZW4gS2xhbW1lcm4gd2FyZW4gZG9ydCBkaWVcbi8vIGVpbnppZ2UgTVx1MDBGNmdsaWNoa2VpdCwgaWhuIHZvbiBlaW5lbSBmZXN0ZW4gV2VydCB6dSB1bnRlcnNjaGVpZGVuLiBCZWlkZXMgaXN0XG4vLyB3ZWcgLSBnZXNwZWljaGVydCB3aXJkIHsgbmFtZSB9LCBUWVAuanMgYmVrb21tdCBTdHJ1a3R1ciBzdGF0dCBUZXh0IChzaWVoZVxuLy8gZ2V0VHlwZVNob3J0Y3V0cyBpbiBtYWluLmpzKSwgdW5kIGRlbiBVbnRlcnNjaGllZCB6dW0gZmVzdGVuIFdlcnQgbWFjaHQgamV0enRcbi8vIGRlciBDaGlwIHNlbGJzdCBzYW10IEFremVudGZhcmJlLiBEaWUgS2xhbW1lcm4gYmlsZGV0ZW4gYWxzbyBuaWNodHMgbWVociBhYi5cbmZ1bmN0aW9uIHNob3J0Y3V0TGFiZWwocmVjb3JkKSB7XG4gIGlmICghcmVjb3JkPy5uYW1lKSByZXR1cm4gXCJcIjtcbiAgY29uc3Qgd2VydGUgPSBPYmplY3QudmFsdWVzKHJlY29yZC5hcmdzID8/IHt9KS5maWx0ZXIoKHZhbHVlKSA9PiB2YWx1ZSAhPT0gdW5kZWZpbmVkKTtcbiAgcmV0dXJuIHdlcnRlLmxlbmd0aCA+IDAgPyBgJHtyZWNvcmQubmFtZX06ICR7d2VydGUuam9pbihcIiwgXCIpfWAgOiByZWNvcmQubmFtZTtcbn1cblxuLy8gRWluIGVpbmdldGlwcHRlcyBBcmd1bWVudCBpbiBkZW4gVHlwIFx1MDBGQ2JlcmZcdTAwRkNocmVuLCBkZW4gZXMgb2ZmZW5zaWNodGxpY2ggbWVpbnQgLVxuLy8gZGFtaXQgZWluIFNrcmlwdCBcIjVcIiBhbHMgWmFobCB1bmQgXCJ0cnVlXCIgYWxzIEJvb2xlYW4gYmVrb21tdCwgc3RhdHQgamVkZXNcbi8vIFNrcmlwdCBzZWxic3QgY2FzdGVuIHp1IGxhc3NlbiAod2ljaHRpZyB6LiBCLiwgd2VubiBkZXIgV2VydCBhbnNjaGxpZVx1MDBERmVuZCBpblxuLy8gZWluZXIgYWxzIFphaGwgZGVrbGFyaWVydGVuIFByb3BlcnR5IGxhbmRldCkuIEJld3Vzc3QgZGllc2Ugd2VuaWdlbiwga2xhclxuLy8gYmVuYW5udGVuIEZcdTAwRTRsbGUgc3RhdHQgSlNPTi5wYXJzZTogZGFzIHdcdTAwRkNyZGUgYmVpIFwiTGl0ZXJhdHVyXCIgb2huZWhpblxuLy8gc2NoZWl0ZXJuIHVuZCBiZWkgJ1wiYVwiJyBldHdhcyBhbmRlcmVzIGxpZWZlcm4sIGFscyBkb3J0IHN0ZWh0LiBFaW4gbGVlcmVzXG4vLyBGZWxkIGhlaVx1MDBERnQgXCJuaWNodCBnZXNldHp0XCIgKHVuZGVmaW5lZCkgdW5kIGZcdTAwRTRsbHQgYXVzIGRlbSBBcmd1bWVudC1PYmpla3Rcbi8vIGhlcmF1cywgZGFtaXQgZWluIFNrcmlwdCBzYXViZXIgbWl0IFwiYXJncy5qYWhyID8/IGZhbGxiYWNrXCIgYXJiZWl0ZW4ga2Fubi5cbmZ1bmN0aW9uIHBhcnNlQXJnVmFsdWUocmF3KSB7XG4gIGNvbnN0IHRleHQgPSBTdHJpbmcocmF3ID8/IFwiXCIpLnRyaW0oKTtcbiAgaWYgKHRleHQgPT09IFwiXCIpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmICh0ZXh0ID09PSBcInRydWVcIikgcmV0dXJuIHRydWU7XG4gIGlmICh0ZXh0ID09PSBcImZhbHNlXCIpIHJldHVybiBmYWxzZTtcbiAgaWYgKHRleHQgPT09IFwibnVsbFwiKSByZXR1cm4gbnVsbDtcbiAgaWYgKC9eLT9cXGQrKD86XFwuXFxkKyk/JC8udGVzdCh0ZXh0KSkgcmV0dXJuIE51bWJlcih0ZXh0KTtcbiAgcmV0dXJuIHRleHQ7XG59XG5cbi8vIE5hbWVuLCBkaWUgaW4gZGVyIFBhcmFtZXRlcmxpc3RlIGVpbmVzIE1hcmtlcnMgZlx1MDBGQ3IgV2VydGUgc3RlaGVuLCBkaWUgZGFzXG4vLyBQbHVnaW4gYnp3LiBUWVAuanMgc2VsYnN0IGtlbm50IC0gc2llIHdlcmRlbiBuaWNodCBhYmdlZnJhZ3QsIHNvbmRlcm4gYmVpbVxuLy8gQXVmcnVmIGVpbmdlc2V0enQ6XG4vLyAgIG5ld0ZpbGUgIGRpZSBuZXUgYW5nZWxlZ3RlIE5vdGl6XG4vLyAgIGN0eCAgICAgIGRlciBLb250ZXh0IHsgdHlwLCBzdWJ0eXAsIGtleSwgd2VydGUsIGRhbmFjaCwgYXJncyB9XG4vLyAgIGtleSAgICAgIGRpZSBQcm9wZXJ0eSwgYW4gZGVyIGRlciBTaG9ydGN1dCBoXHUwMEU0bmd0LiBFcnNwYXJ0IGVzLCBpaHJlbiBOYW1lblxuLy8gICAgICAgICAgICBhbHMgQXJndW1lbnQgenUgd2llZGVyaG9sZW4gLSBlaW4gU2tyaXB0IHdpZSByZWxhdGlvbi5qcywgZGFzXG4vLyAgICAgICAgICAgIHNpY2ggc2VpbmUgUHJvcGVydHkgc2FnZW4gbFx1MDBFNHNzdCwgYmVrb21tdCBkYW1pdCBhdXRvbWF0aXNjaCBkaWVcbi8vICAgICAgICAgICAgcmljaHRpZ2UsIGF1Y2ggd2VubiBkZXJzZWxiZSBTaG9ydGN1dCBhbiBlaW5lciBhbmRlcmVuIFplaWxlXG4vLyAgICAgICAgICAgIHNpdHp0LlxuLy8gXCJ0cFwiIHN0ZWh0IGltbWVyIGFscyBlcnN0ZXMgQXJndW1lbnQgdW5kIG11c3MgbmljaHQgZGVrbGFyaWVydCB3ZXJkZW47IHdpcmRcbi8vIGVzIHRyb3R6ZGVtIGdlbmFubnQsIHdpcmQgZXMgXHUwMEZDYmVyZ2FuZ2VuLCBzdGF0dCBlcyBlaW4gendlaXRlcyBNYWwgenVcbi8vIFx1MDBGQ2JlcmdlYmVuLlxuY29uc3QgUkVTRVJWRURfUEFSQU1TID0gW1wibmV3RmlsZVwiLCBcImN0eFwiLCBcImtleVwiXTtcblxuLy8gRGllIFBhcmFtZXRlciwgZlx1MDBGQ3IgZGllIGRhcyBNb2RhbCBlaW4gRWluZ2FiZWZlbGQgemVpZ3Q6IGFsbGVzLCB3YXMgbmljaHRcbi8vIHJlc2VydmllcnQgaXN0LiBwYXJhbXMgPT09IG51bGwgKGtlaW4gS2xhbW1lcnBhYXIgYW0gTWFya2VyKSBoZWlcdTAwREZ0XG4vLyBcImhlcmtcdTAwRjZtbWxpY2hlciBBdWZydWZcIiwgYWxzbyBlYmVuZmFsbHMga2VpbmUgRmVsZGVyLlxuZnVuY3Rpb24gaW5wdXRQYXJhbXMocGFyYW1zKSB7XG4gIHJldHVybiAocGFyYW1zID8/IFtdKS5maWx0ZXIoKG5hbWUpID0+IG5hbWUgIT09IFwidHBcIiAmJiAhUkVTRVJWRURfUEFSQU1TLmluY2x1ZGVzKG5hbWUpKTtcbn1cblxuLy8gRWluZ2FiZW4gKGplIFBhcmFtZXRlcm5hbWUgZWluIFRleHQpIGluIGRhcyBnZXNwZWljaGVydGUgQXJndW1lbnQtT2JqZWt0LlxuLy8gcGFyYW1zIGdpYnQgZGllIFJlaWhlbmZvbGdlIHZvciwgZGFtaXQgc2hvcnRjdXRMYWJlbCgpIHNpZSBpbiBkZXIgdm9tIFNrcmlwdFxuLy8gZGVrbGFyaWVydGVuIEZvbGdlIGFuemVpZ3Q7IGxlZXJlIEZlbGRlciBmZWhsZW4gaW0gRXJnZWJuaXMgZ2Fuei5cbmZ1bmN0aW9uIGJ1aWxkQXJncyhwYXJhbXMsIGVpbmdhYmVuKSB7XG4gIGNvbnN0IGFyZ3MgPSB7fTtcbiAgZm9yIChjb25zdCBuYW1lIG9mIGlucHV0UGFyYW1zKHBhcmFtcykpIHtcbiAgICBjb25zdCB2YWx1ZSA9IHBhcnNlQXJnVmFsdWUoZWluZ2FiZW5bbmFtZV0pO1xuICAgIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkKSBhcmdzW25hbWVdID0gdmFsdWU7XG4gIH1cbiAgcmV0dXJuIGFyZ3M7XG59XG5cbi8vIEF1cyBkZXIgZGVrbGFyaWVydGVuIFBhcmFtZXRlcmxpc3RlIGRpZSBBcmd1bWVudGUgZlx1MDBGQ3IgZGVuIEF1ZnJ1ZlxuLy8gZih0cCwgLi4uaGllcikgYmF1ZW4gLSBhdWZnZXJ1ZmVuIHZvbiBUWVAuanMsIGRhcyBhbHMgZWluemlnZXMgbmV3RmlsZSB1bmRcbi8vIGN0eCBrZW5udC5cbi8vXG4vLyBPaG5lIEtsYW1tZXJuIGFtIE1hcmtlciAocGFyYW1zID09PSBudWxsKSBibGVpYnQgZXMgYmVpbSBoZXJrXHUwMEY2bW1saWNoZW5cbi8vIEF1ZnJ1ZiBmKHRwLCBuZXdGaWxlLCBjdHgpLiBTb25zdCB3aXJkIGRpZSBMaXN0ZSBFaW50cmFnIGZcdTAwRkNyIEVpbnRyYWdcbi8vIGF1ZmdlbFx1MDBGNnN0OiByZXNlcnZpZXJ0ZSBOYW1lbiB6dSBkZW4gXHUwMEZDYmVyZ2ViZW5lbiBXZXJ0ZW4sIGFsbGUgYW5kZXJlbiB6dW1cbi8vIGVpbmdldGlwcHRlbiBBcmd1bWVudC5cbi8vXG4vLyBFaW4gUHVua3QtTmFtZSAoXCJvcHRpb25zLnR5cFwiKSBiZXNjaHJlaWJ0IGtlaW4gZWlnZW5lcyBBcmd1bWVudCwgc29uZGVybiBlaW5cbi8vIEZFTEQgZWluZXMgT2JqZWt0LUFyZ3VtZW50czogYWxsZSBcIm9wdGlvbnMuKlwiIHNhbW1lbG4gc2ljaCB6dSBlaW5lbSBlaW56aWdlblxuLy8gT2JqZWt0IGFuIGRlciBQb3NpdGlvbiBpaHJlcyBlcnN0ZW4gVm9ya29tbWVucy4gRGFtaXQgbGFzc2VuIHNpY2ggYXVjaFxuLy8gU2tyaXB0ZSBiZWRpZW5lbiwgZGVyZW4gU2lnbmF0dXIgZWluIE9wdGlvbnMtT2JqZWt0IGVyd2FydGV0LCBvaG5lIGRhc3MgbWFuXG4vLyBKU09OIGluIGVpbiBFaW5nYWJlZmVsZCB0aXBwZW4gbVx1MDBGQ3NzdGUuIE51ciBlaW5lIEViZW5lIHRpZWYgLSBiZWkgXCJhLmIuY1wiXG4vLyBlbnRzdFx1MDBGQ25kZSBlaW4gRmVsZCwgZGFzIHdcdTAwRjZydGxpY2ggXCJiLmNcIiBoZWlcdTAwREZ0LlxuZnVuY3Rpb24gcmVzb2x2ZUNhbGxBcmdzKHBhcmFtcywgYXJncywgcmVzZXJ2ZWQgPSB7fSkge1xuICBpZiAocGFyYW1zID09PSBudWxsIHx8IHBhcmFtcyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gW3Jlc2VydmVkLm5ld0ZpbGUsIHJlc2VydmVkLmN0eF07XG5cbiAgY29uc3Qgd2VydGUgPSBbXTtcbiAgY29uc3Qgb2JqZWt0UG9zaXRpb24gPSBuZXcgTWFwKCk7XG4gIGZvciAoY29uc3QgbmFtZSBvZiBwYXJhbXMpIHtcbiAgICBpZiAobmFtZSA9PT0gXCJ0cFwiKSBjb250aW51ZTtcbiAgICBpZiAoUkVTRVJWRURfUEFSQU1TLmluY2x1ZGVzKG5hbWUpKSB7XG4gICAgICB3ZXJ0ZS5wdXNoKHJlc2VydmVkW25hbWVdKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBwdW5rdCA9IG5hbWUuaW5kZXhPZihcIi5cIik7XG4gICAgaWYgKHB1bmt0ID09PSAtMSkge1xuICAgICAgd2VydGUucHVzaChhcmdzPy5bbmFtZV0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGJhc2lzID0gbmFtZS5zbGljZSgwLCBwdW5rdCk7XG4gICAgaWYgKCFvYmpla3RQb3NpdGlvbi5oYXMoYmFzaXMpKSB7XG4gICAgICBvYmpla3RQb3NpdGlvbi5zZXQoYmFzaXMsIHdlcnRlLmxlbmd0aCk7XG4gICAgICB3ZXJ0ZS5wdXNoKHt9KTtcbiAgICB9XG4gICAgY29uc3Qgd2VydCA9IGFyZ3M/LltuYW1lXTtcbiAgICBpZiAod2VydCAhPT0gdW5kZWZpbmVkKSB3ZXJ0ZVtvYmpla3RQb3NpdGlvbi5nZXQoYmFzaXMpXVtuYW1lLnNsaWNlKHB1bmt0ICsgMSldID0gd2VydDtcbiAgfVxuICByZXR1cm4gd2VydGU7XG59XG5cbi8vIE9iIGRpZSBQcm9wZXJ0eSBsYXV0IHR5cGVzLmpzb24gKGJ6dy4sIGZhbGxzIGRvcnQgbmljaHQgZ2VzZXR6dCwgbGF1dCBpaHJlclxuLy8gYmlzaGVyaWdlbiBWZXJ3ZW5kdW5nIGltIFZhdWx0KSBlaW5lIExpc3RlIGlzdCAtIGRhbm4gd2lyZCBlaW4gYXVmZ2VsXHUwMEY2c3RlclxuLy8gU2hvcnRjdXQtV2VydCBlaW5lbGVtZW50aWcgZWluZ2VwYWNrdCwgZGFtaXQgZGVyIGdlbGllZmVydGUgV2VydCB6dW1cbi8vIGRla2xhcmllcnRlbiBUeXAgZGVyIFByb3BlcnR5IHBhc3N0LiBPaG5lIGFwcCAoei4gQi4gaW4gVGVzdHMpIHdpZSBiaXNoZXJcbi8vIG9obmUgRWlucGFja2VuLlxuZnVuY3Rpb24gaXNMaXN0UHJvcGVydHkoYXBwLCBrZXkpIHtcbiAgcmV0dXJuIGFwcD8ubWV0YWRhdGFUeXBlTWFuYWdlcj8uZ2V0VHlwZUluZm8/LihrZXkpPy5leHBlY3RlZD8udHlwZSA9PT0gXCJtdWx0aXRleHRcIjtcbn1cblxuLy8gS29waWUgdm9uIGZyb250bWF0dGVyLCBpbiBkZXIgamVkZXIgS2V5IG1pdCBTaG9ydGN1dCBzZWluZW4gYmVyZWNobmV0ZW4gV2VydFxuLy8gdHJcdTAwRTRndDpcbi8vICAgLSBmZXN0ZXIgVG9rZW4gLT4gYXVmZ2VsXHUwMEY2c3QgKGJlaSBlaW5lciBMaXN0ZW4tUHJvcGVydHkgZWluZWxlbWVudGlnXG4vLyAgICAgZWluZ2VwYWNrdCksXG4vLyAgIC0gXCJ0cC48U2tyaXB0PlwiIC0+IG51bGw7IG51ciBUZW1wbGF0ZXIga2FubiBkYXMgYXVmbFx1MDBGNnNlbiwgVFlQLmpzIGhvbHQgc2ljaFxuLy8gICAgIGRpZXNlIEtleXMgXHUwMEZDYmVyIGdldFR5cGVTaG9ydGN1dHMoKSB1bmQgc2V0enQgc2llIHNlbGJzdCBlaW4uXG4vLyBLZXlzIG9obmUgU2hvcnRjdXQgYmxlaWJlbiB1bnZlclx1MDBFNG5kZXJ0IC0gZWJlbnNvIGRlciBXZXJ0IGVpbmVzIEtleXMgTUlUXG4vLyBTaG9ydGN1dCBpbiBkZW4gU2V0dGluZ3Mgc2VsYnN0OiBlciBibGVpYnQgZG9ydCBhbHMgUlx1MDBGQ2NrZmFsbHdlcnQgc3RlaGVuIChzaWVoZVxuLy8gS29tbWVudGFyIG9iZW4pIHVuZCB3aXJkIGhpZXIgbnVyIFx1MDBGQ2JlcnNjaHJpZWJlbiwgbmljaHQgZ2VsXHUwMEY2c2NodC5cbmZ1bmN0aW9uIHJlc29sdmVTaG9ydGN1dHMoZnJvbnRtYXR0ZXIsIHNob3J0Y3V0cywgeyBmaWxlLCBhcHAgfSA9IHt9KSB7XG4gIGNvbnN0IHJlc29sdmVkID0ge307XG4gIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGZyb250bWF0dGVyKSkge1xuICAgIGNvbnN0IHJlY29yZCA9IHNob3J0Y3V0cz8uW2tleV07XG4gICAgY29uc3QgZml4ZWQgPSByZWNvcmQgPyBmaW5kRml4ZWRTaG9ydGN1dChyZWNvcmQubmFtZSkgOiBudWxsO1xuICAgIGlmIChmaXhlZCkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gZml4ZWQucmVzb2x2ZShmaWxlKTtcbiAgICAgIHJlc29sdmVkW2tleV0gPSBpc0xpc3RQcm9wZXJ0eShhcHAsIGtleSkgPyBbcmVzdWx0XSA6IHJlc3VsdDtcbiAgICB9IGVsc2UgaWYgKGlzU2NyaXB0U2hvcnRjdXQocmVjb3JkKSkge1xuICAgICAgcmVzb2x2ZWRba2V5XSA9IG51bGw7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc29sdmVkW2tleV0gPSB2YWx1ZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlc29sdmVkO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgRklYRURfU0hPUlRDVVRTLFxuICBTQ1JJUFRfUFJFRklYLFxuICBmaW5kRml4ZWRTaG9ydGN1dCxcbiAgc2NyaXB0TmFtZU9mLFxuICBpc1NjcmlwdFNob3J0Y3V0LFxuICBzaG9ydGN1dExhYmVsLFxuICBwYXJzZUFyZ1ZhbHVlLFxuICBidWlsZEFyZ3MsXG4gIGlucHV0UGFyYW1zLFxuICByZXNvbHZlQ2FsbEFyZ3MsXG4gIFJFU0VSVkVEX1BBUkFNUyxcbiAgcmVzb2x2ZVNob3J0Y3V0cyxcbn07XG4iLCAiY29uc3QgeyBGdXp6eVN1Z2dlc3RNb2RhbCwgTW9kYWwsIFNldHRpbmcgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgRklYRURfU0hPUlRDVVRTLCBTQ1JJUFRfUFJFRklYLCBidWlsZEFyZ3MsIGlucHV0UGFyYW1zIH0gPSByZXF1aXJlKFwiLi9zaG9ydGN1dHNcIik7XG5cbi8vIEFuemVpZ2Vmb3JtIGVpbmVzIExpc3RlbmVpbnRyYWdzOiBkZXIgTmFtZSwgYmVpIGVpbmVtIFNrcmlwdCBtaXQgZGVrbGFyaWVydGVuXG4vLyBQYXJhbWV0ZXJuIHp1c1x1MDBFNHR6bGljaCBkZXJlbiBOYW1lbiBpbiBLbGFtbWVybiAtIHNvIGlzdCBzY2hvbiBpbiBkZXIgQXVzd2FobFxuLy8genUgc2VoZW4sIGRhc3MgKHVuZCB3b21pdCkgZWluIFNrcmlwdCBwYXJhbWV0cmlzaWVydCB3aXJkLlxuZnVuY3Rpb24gaXRlbUxhYmVsKGl0ZW0pIHtcbiAgcmV0dXJuIGl0ZW0ucGFyYW1zID8gYCR7aXRlbS5uYW1lfSgke2l0ZW0ucGFyYW1zLmpvaW4oXCIsIFwiKX0pYCA6IGl0ZW0ubmFtZTtcbn1cblxuLy8gQXVzd2FobCBlaW5lcyBTaG9ydGN1dHMgZlx1MDBGQ3IgZWluZSBQcm9wZXJ0eSBkZXMgVFlQLUZyb250bWF0dGVycyAoS25vcGYgYnp3LlxuLy8gQ2hpcCBpbiBkZXIgUHJvcGVydHktWmVpbGUsIHNpZWhlIHR5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKS4gRXJzZXR6dCBkaWVcbi8vIGZyXHUwMEZDaGVyZSBMZWdlbmRlIHVudGVyaGFsYiBkZXIgRnJvbnRtYXR0ZXItQmxcdTAwRjZja2U6IGRpZXNlbGJlbiBUb2tlbiwgYWJlciBhbVxuLy8gT3J0IGRlciBWZXJ3ZW5kdW5nLCBkdXJjaHN1Y2hiYXIgLSB1bmQgYmVpIFNrcmlwdGVuIHp1c1x1MDBFNHR6bGljaCBtaXQgZGVyXG4vLyBCZXNjaHJlaWJ1bmcgYXVzIGRlcmVuIEB0eXAtc2hvcnRjdXQtTWFya2VyLCBkaWUgZWluZSBmZXN0ZSBMZWdlbmRlIGdhciBuaWNodFxuLy8ga2VubmVuIGtvbm50ZS5cbi8vXG4vLyBHZXdcdTAwRTRobHQgd2lyZCBuaWUgZnJlaWVyIFRleHQ6IGRpZSBMaXN0ZSBpc3QgZGllIG1hXHUwMERGZ2VibGljaGUgUXVlbGxlLCBlaW5cbi8vIFRpcHBmZWhsZXIgaW0gU2tyaXB0bmFtZW4gaXN0IGRhbWl0IGF1c2dlc2NobG9zc2VuLlxuY2xhc3MgU2hvcnRjdXRQaWNrZXJNb2RhbCBleHRlbmRzIEZ1enp5U3VnZ2VzdE1vZGFsIHtcbiAgY29uc3RydWN0b3IoYXBwLCBrZXksIGl0ZW1zLCByZXNvbHZlKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLml0ZW1zID0gaXRlbXM7XG4gICAgdGhpcy5yZXNvbHZlID0gcmVzb2x2ZTtcbiAgICB0aGlzLmNob3NlbiA9IGZhbHNlO1xuICAgIHRoaXMuc2V0UGxhY2Vob2xkZXIoYFNob3J0Y3V0IGZcdTAwRkNyIFx1MjAxRSR7a2V5fVx1MjAxQyBcdTIwMTMgRVNDIGZcdTAwRkNyIEFiYnJ1Y2hgKTtcbiAgfVxuXG4gIGdldEl0ZW1zKCkge1xuICAgIHJldHVybiB0aGlzLml0ZW1zO1xuICB9XG5cbiAgLy8gRnV6enktU3VjaGUgZ3JlaWZ0IGF1Y2ggYXVmIGRpZSBCZXNjaHJlaWJ1bmcsIG5pY2h0IG51ciBhdWYgZGVuIE5hbWVuIC1cbiAgLy8gXCJFcnN0ZWxsdW5nc2RhdHVtXCIgZmluZGV0IHNvIGF1Y2ggXCJjcmVhdGVkXCIuXG4gIGdldEl0ZW1UZXh0KGl0ZW0pIHtcbiAgICBjb25zdCBsYWJlbCA9IGl0ZW1MYWJlbChpdGVtKTtcbiAgICByZXR1cm4gaXRlbS5kZXNjcmlwdGlvbiA/IGAke2xhYmVsfSAke2l0ZW0uZGVzY3JpcHRpb259YCA6IGxhYmVsO1xuICB9XG5cbiAgcmVuZGVyU3VnZ2VzdGlvbihtYXRjaCwgZWwpIHtcbiAgICBjb25zdCBpdGVtID0gbWF0Y2guaXRlbTtcbiAgICBlbC5hZGRDbGFzcyhcImZyZWQtdHlwLXNob3J0Y3V0LXN1Z2dlc3Rpb25cIik7XG4gICAgZWwuY3JlYXRlRWwoXCJjb2RlXCIsIHsgY2xzOiBcImZyZWQtdHlwLXNob3J0Y3V0LXN1Z2dlc3Rpb24tbmFtZVwiLCB0ZXh0OiBpdGVtTGFiZWwoaXRlbSkgfSk7XG4gICAgaWYgKGl0ZW0uZGVzY3JpcHRpb24pIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtc2hvcnRjdXQtc3VnZ2VzdGlvbi1kZXNjXCIsIHRleHQ6IGl0ZW0uZGVzY3JpcHRpb24gfSk7XG4gIH1cblxuICAvLyBTaWVoZSBUeXBQaWNrZXJNb2RhbCBpbiB0eXBlLXBpY2tlci5qczogT2JzaWRpYW5zIHNlbGVjdFN1Z2dlc3Rpb24oKSBydWZ0XG4gIC8vIGVyc3QgY2xvc2UoKSB1bmQgZGFuYWNoIGVyc3Qgb25DaG9vc2VJdGVtKCkgLSBcImNob3NlblwiIG11c3MgZGVzaGFsYiBzY2hvblxuICAvLyBoaWVyIGdlc2V0enQgd2VyZGVuLCBzb25zdCBsXHUwMEY2c3QgZGFzIHZvbiBjbG9zZSgpIGF1c2dlbFx1MDBGNnN0ZSBvbkNsb3NlKCkgZGFzXG4gIC8vIFByb21pc2Ugdm9yemVpdGlnIG1pdCBudWxsIGF1ZiB1bmQgZGllIGVpZ2VudGxpY2hlIEF1c3dhaGwgZ2VodCB2ZXJsb3Jlbi5cbiAgc2VsZWN0U3VnZ2VzdGlvbihpdGVtLCBldnQpIHtcbiAgICB0aGlzLmNob3NlbiA9IHRydWU7XG4gICAgc3VwZXIuc2VsZWN0U3VnZ2VzdGlvbihpdGVtLCBldnQpO1xuICB9XG5cbiAgb25DaG9vc2VJdGVtKGl0ZW0pIHtcbiAgICB0aGlzLnJlc29sdmUoaXRlbSk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHN1cGVyLm9uQ2xvc2UoKTtcbiAgICBpZiAoIXRoaXMuY2hvc2VuKSB0aGlzLnJlc29sdmUobnVsbCk7XG4gIH1cbn1cblxuLy8gQWJmcmFnZSBkZXIgQXJndW1lbnRlIGVpbmVzIFNrcmlwdHMsIGRhcyB3ZWxjaGUgZGVrbGFyaWVydCBoYXQgLSBlaW4gRGlhbG9nXG4vLyBtaXQgYWxsZW4gRmVsZGVybiB1bnRlcmVpbmFuZGVyIHN0YXR0IGVpbmVyIEtldHRlIHZvbiBFaW56ZWxhYmZyYWdlbiwgZGFtaXRcbi8vIG1hbiBzaWUgZ2VtZWluc2FtIHNpZWh0IHVuZCBrb3JyaWdpZXJlbiBrYW5uLiBEaWUgRmVsZGVyIHNpbmQgbmFjaCBkZW5cbi8vIFBhcmFtZXRlcm5hbWVuIGRlcyBTa3JpcHRzIGJlbmFubnQ7IHZvcmJlbGVndCB3ZXJkZW4gc2llIG1pdCBkZW4gYmVyZWl0c1xuLy8gZ2VzcGVpY2hlcnRlbiBXZXJ0ZW4gKHZvcmhhbmRlbmUgQXJndW1lbnRlKSwgc29kYXNzIGVpbiBlcm5ldXRlcyBXXHUwMEU0aGxlblxuLy8gZGVzc2VsYmVuIFNrcmlwdHMgenVtIEtvcnJpZ2llcmVuIGVpbnplbG5lciBXZXJ0ZSB0YXVndC5cbi8vXG4vLyBFaW4gbGVlciBnZWxhc3NlbmVzIEZlbGQgZ2lsdCBhbHMgXCJuaWNodCBnZXNldHp0XCIgdW5kIGZcdTAwRTRsbHQgYXVzIGRlbSBFcmdlYm5pc1xuLy8gaGVyYXVzIChzaWVoZSBidWlsZEFyZ3MgaW4gc2hvcnRjdXRzLmpzKSAtIGRlc2hhbGIgZ2lidCBlcyBoaWVyIGtlaW5lXG4vLyBQZmxpY2h0ZmVsZGVyIHVuZCBrZWluZSBWYWxpZGllcnVuZzogd2FzIGRhcyBTa3JpcHQgYnJhdWNodCwgd2VpXHUwMERGIG51ciBkYXNcbi8vIFNrcmlwdCBzZWxic3QuXG5jbGFzcyBTaG9ydGN1dEFyZ3NNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgY29uc3RydWN0b3IoYXBwLCBpdGVtLCB2b3JoYW5kZW5lLCByZXNvbHZlKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLml0ZW0gPSBpdGVtO1xuICAgIHRoaXMucmVzb2x2ZSA9IHJlc29sdmU7XG4gICAgdGhpcy5mZWxkZXIgPSBpbnB1dFBhcmFtcyhpdGVtLnBhcmFtcyk7XG4gICAgdGhpcy5laW5nYWJlbiA9IHt9O1xuICAgIGZvciAoY29uc3QgbmFtZSBvZiB0aGlzLmZlbGRlcikge1xuICAgICAgY29uc3Qgd2VydCA9IHZvcmhhbmRlbmU/LltuYW1lXTtcbiAgICAgIHRoaXMuZWluZ2FiZW5bbmFtZV0gPSB3ZXJ0ID09PSB1bmRlZmluZWQgfHwgd2VydCA9PT0gbnVsbCA/IFwiXCIgOiBTdHJpbmcod2VydCk7XG4gICAgfVxuICAgIHRoaXMuYmVzdGFldGlndCA9IGZhbHNlO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIHRoaXMudGl0bGVFbC5zZXRUZXh0KGBBcmd1bWVudGUgZlx1MDBGQ3IgJHt0aGlzLml0ZW0ubmFtZX1gKTtcbiAgICBpZiAodGhpcy5pdGVtLmRlc2NyaXB0aW9uKSB7XG4gICAgICB0aGlzLmNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtc2hvcnRjdXQtYXJncy1kZXNjXCIsIHRleHQ6IHRoaXMuaXRlbS5kZXNjcmlwdGlvbiB9KTtcbiAgICB9XG4gICAgZm9yIChjb25zdCBuYW1lIG9mIHRoaXMuZmVsZGVyKSB7XG4gICAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRlbnRFbCkuc2V0TmFtZShuYW1lKS5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0XG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMuZWluZ2FiZW5bbmFtZV0pXG4gICAgICAgICAgLm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5laW5nYWJlbltuYW1lXSA9IHZhbHVlO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLy8gRW50ZXIgaW4gZWluZW0gRmVsZCBzY2hsaWVcdTAwREZ0IGRlbiBEaWFsb2cgYWIsIHdpZSBpbiBPYnNpZGlhbnNcbiAgICAgICAgICAvLyBlaWdlbmVuIFVtYmVuZW5uZW4tRGlhbG9nZW4uXG4gICAgICAgICAgLmlucHV0RWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XG4gICAgICAgICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVudGVyXCIgJiYgIWV2ZW50LmlzQ29tcG9zaW5nKSB7XG4gICAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICAgIHRoaXMudWViZXJuZWhtZW4oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9XG4gICAgbmV3IFNldHRpbmcodGhpcy5jb250ZW50RWwpLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgYnV0dG9uXG4gICAgICAgIC5zZXRCdXR0b25UZXh0KFwiXHUwMERDYmVybmVobWVuXCIpXG4gICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAub25DbGljaygoKSA9PiB0aGlzLnVlYmVybmVobWVuKCkpXG4gICAgKTtcbiAgfVxuXG4gIHVlYmVybmVobWVuKCkge1xuICAgIHRoaXMuYmVzdGFldGlndCA9IHRydWU7XG4gICAgdGhpcy5jbG9zZSgpO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIC8vIEVTQyBiencuIEtsaWNrIGRhbmViZW46IGtlaW4gU2hvcnRjdXQgZ2VzZXR6dCwgZGVyIGJpc2hlcmlnZSBibGVpYnRcbiAgICAvLyB1bmFuZ2V0YXN0ZXQgLSBzb25zdCB3XHUwMEU0cmUgZWluIHZlcnNlaGVudGxpY2hlcyBTY2hsaWVcdTAwREZlbiBlaW4gc3RpbGxlclxuICAgIC8vIERhdGVudmVybHVzdC5cbiAgICB0aGlzLnJlc29sdmUodGhpcy5iZXN0YWV0aWd0ID8gYnVpbGRBcmdzKHRoaXMuZmVsZGVyLCB0aGlzLmVpbmdhYmVuKSA6IG51bGwpO1xuICB9XG59XG5cbi8vIFx1MDBENmZmbmV0IGRpZSBBdXN3YWhsIGZcdTAwRkNyIGRpZSBQcm9wZXJ0eSBrZXkuIGdldFNjcmlwdHMgaXN0IGRlciBBY2Nlc3NvciBhdXNcbi8vIHJlZ2lzdGVyU2hvcnRjdXRTY3JpcHRzKCkgKHNob3J0Y3V0LXNjcmlwdHMuanMpLCB2b3JoYW5kZW4gZGVyIGFrdHVlbGxcbi8vIGdlc2V0enRlIFNob3J0Y3V0LVJlY29yZCAoZlx1MDBGQ3IgZGllIFZvcmJlbGVndW5nIGRlciBBcmd1bWVudGUpLiBMXHUwMEY2c3QgbWl0IGRlbVxuLy8gbmV1ZW4gUmVjb3JkICh7IG5hbWUgfSBiencuIHsgbmFtZSwgYXJncyB9KSBhdWYsIG9kZXIgbWl0IG51bGwgYmVpIEFiYnJ1Y2ggLVxuLy8gYXVjaCBkYW5uLCB3ZW5uIHp3YXIgZWluIFNrcmlwdCBnZXdcdTAwRTRobHQsIGRlciBBcmd1bWVudC1EaWFsb2cgZGFuYWNoIGFiZXJcbi8vIGFiZ2Vicm9jaGVuIHd1cmRlLlxuYXN5bmMgZnVuY3Rpb24gcGlja1Nob3J0Y3V0KGFwcCwga2V5LCBnZXRTY3JpcHRzLCB2b3JoYW5kZW4gPSBudWxsKSB7XG4gIGNvbnN0IGl0ZW1zID0gW1xuICAgIC4uLkZJWEVEX1NIT1JUQ1VUUy5tYXAoKHsgbmFtZSwgZGVzY3JpcHRpb24gfSkgPT4gKHsgbmFtZSwgZGVzY3JpcHRpb24sIHBhcmFtczogbnVsbCB9KSksXG4gICAgLi4uZ2V0U2NyaXB0cygpLm1hcCgoeyBuYW1lLCBwYXJhbXMsIGRlc2NyaXB0aW9uIH0pID0+ICh7IG5hbWU6IFNDUklQVF9QUkVGSVggKyBuYW1lLCBwYXJhbXMsIGRlc2NyaXB0aW9uIH0pKSxcbiAgXTtcblxuICBjb25zdCBpdGVtID0gYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IG5ldyBTaG9ydGN1dFBpY2tlck1vZGFsKGFwcCwga2V5LCBpdGVtcywgcmVzb2x2ZSkub3BlbigpKTtcbiAgaWYgKCFpdGVtKSByZXR1cm4gbnVsbDtcbiAgLy8gT2huZSBhYnp1ZnJhZ2VuZGUgRmVsZGVyIGVudGZcdTAwRTRsbHQgZGVyIHp3ZWl0ZSBTY2hyaXR0IGdhbnogLSBkYXMgZ2lsdCBmXHUwMEZDclxuICAvLyBkaWUgZmVzdGVuIFNob3J0Y3V0cyBlYmVuc28gd2llIGZcdTAwRkNyIGVpbiBTa3JpcHQsIGRlc3NlbiBQYXJhbWV0ZXJsaXN0ZSBudXJcbiAgLy8gcmVzZXJ2aWVydGUgTmFtZW4gZW50aFx1MDBFNGx0IChldHdhIFwiKG5ld0ZpbGUpXCIpLlxuICBpZiAoaW5wdXRQYXJhbXMoaXRlbS5wYXJhbXMpLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHsgbmFtZTogaXRlbS5uYW1lIH07XG5cbiAgLy8gVm9yYmVsZWd1bmcgbnVyLCB3ZW5uIGRhc3NlbGJlIFNrcmlwdCBzY2hvbiBnZXNldHp0IHdhciAtIGJlaSBlaW5lbVxuICAvLyBXZWNoc2VsIHdcdTAwRTRyZW4gZGllIGFsdGVuIFdlcnRlIGZcdTAwRkNyIGFuZGVyZSBQYXJhbWV0ZXJuYW1lbiBiZWRldXR1bmdzbG9zLlxuICBjb25zdCB2b3JiZWxlZ3VuZyA9IHZvcmhhbmRlbj8ubmFtZSA9PT0gaXRlbS5uYW1lID8gdm9yaGFuZGVuLmFyZ3MgOiBudWxsO1xuICBjb25zdCBhcmdzID0gYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IG5ldyBTaG9ydGN1dEFyZ3NNb2RhbChhcHAsIGl0ZW0sIHZvcmJlbGVndW5nLCByZXNvbHZlKS5vcGVuKCkpO1xuICBpZiAoYXJncyA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiBPYmplY3Qua2V5cyhhcmdzKS5sZW5ndGggPiAwID8geyBuYW1lOiBpdGVtLm5hbWUsIGFyZ3MgfSA6IHsgbmFtZTogaXRlbS5uYW1lIH07XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBwaWNrU2hvcnRjdXQgfTtcbiIsICJjb25zdCB7IE1hcmtkb3duVmlldywgTWVudSwgc2V0SWNvbiB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xyXG5jb25zdCB7IHNob3J0Y3V0TGFiZWwgfSA9IHJlcXVpcmUoXCIuL3Nob3J0Y3V0c1wiKTtcclxuY29uc3QgeyBwaWNrU2hvcnRjdXQgfSA9IHJlcXVpcmUoXCIuL3Nob3J0Y3V0LXBpY2tlclwiKTtcclxuY29uc3QgeyBnZXRTdWJ0eXBlLCBlbnN1cmVTdWJ0eXBlIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBlc1wiKTtcclxuXHJcbi8vIE1hcmtlci1LbGFzc2UgYW0gQ29udGFpbmVyIGRlcyBUWVAtRnJvbnRtYXR0ZXItRWRpdG9ycyAtIGdyZW56dCBkaWVcclxuLy8gU2hvcnRjdXQtUmVnZWxuIGluIHN0eWxlcy5jc3MgYXVmIGRpZXNlbiBFZGl0b3IgZWluLCBlY2h0ZSBOb3RpemVuIGJsZWliZW5cclxuLy8gdW5iZXJcdTAwRkNocnQuXHJcbmNvbnN0IEVESVRPUl9DTEFTUyA9IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItZWRpdG9yXCI7XHJcblxyXG5jb25zdCBUWVBfUFJPUEVSVFkgPSBcIlRZUFwiO1xyXG5jb25zdCBTVUJUWVBfUFJPUEVSVFkgPSBcIlNVQlRZUFwiO1xyXG5jb25zdCBTWVNURU1fUFJPUEVSVElFUyA9IFtUWVBfUFJPUEVSVFkudG9Mb3dlckNhc2UoKSwgU1VCVFlQX1BST1BFUlRZLnRvTG93ZXJDYXNlKCldO1xyXG5cclxuLy8gRGVyIFdlcnQgZGVyIFRZUC0gYnp3LiBTVUJUWVAtUHJvcGVydHkgaXN0IHBlciBEZWZpbml0aW9uIGltbWVyIGRlciBOYW1lIGRlc1xyXG4vLyBUWVBzL1N1YnR5cHMgc2VsYnN0IC0gYWxzIFwiU3RhbmRhcmRcIi1Qcm9wZXJ0eSB3XHUwMEU0cmUgc2llIGFsc28gcmVkdW5kYW50IHVuZFxyXG4vLyBrXHUwMEY2bm50ZSBiZWkgZWluZXIgVW1iZW5lbm51bmcgKHVuYmVtZXJrdCkgdm9tIHRhdHNcdTAwRTRjaGxpY2hlbiBOYW1lbiBhYndlaWNoZW4uXHJcbi8vIFNpZSBkYXJmIGRlc2hhbGIgaW4gZGllc2VtIEVkaXRvciBnYXIgbmljaHQgZXJzdCBhbHMgZWlnZW5lIFplaWxlIGF1ZnRhdWNoZW4uXHJcbi8vIE11dGllcnQgXCJmcm9udG1hdHRlclwiIGluLXBsYWNlIChzdGF0dCBlaW5lIEtvcGllIHp1clx1MDBGQ2NrenVnZWJlbikgLSBPYnNpZGlhbnNcclxuLy8gUHJvcGVydHktRWRpdG9yIHNjaGVpbnQgYmVpbSBzeW5jaHJvbml6ZSgpIGF1ZiBlaW5lIHN0YWJpbGUgT2JqZWt0cmVmZXJlbnpcclxuLy8gYW5nZXdpZXNlbiB6dSBzZWluOyBlaW5lIG5ldSBlcnpldWd0ZSBLb3BpZSBoYXQgYmVpbSBhbGxlcmVyc3RlbiBSZW5kZXJuIHp1XHJcbi8vIGVpbmVtIFN0YWNrIE92ZXJmbG93IGluIE9ic2lkaWFucyBlaWdlbmVyIHJlbmRlclByb3BlcnR5KCktUGlwZWxpbmUgZ2VmXHUwMEZDaHJ0LlxyXG5mdW5jdGlvbiBzdHJpcFR5cFByb3BlcnR5KGZyb250bWF0dGVyKSB7XHJcbiAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoZnJvbnRtYXR0ZXIpKSB7XHJcbiAgICBpZiAoU1lTVEVNX1BST1BFUlRJRVMuaW5jbHVkZXMoa2V5LnRyaW0oKS50b0xvd2VyQ2FzZSgpKSkgZGVsZXRlIGZyb250bWF0dGVyW2tleV07XHJcbiAgfVxyXG4gIHJldHVybiBmcm9udG1hdHRlcjtcclxufVxyXG5cclxuLy8gU3BlaWNoZXJvcnQgZWluZXMgRnJvbnRtYXR0ZXItQmxvY2tzIGluIGRlbiBQbHVnaW4tU2V0dGluZ3MgLSBlbnR3ZWRlciBkYXNcclxuLy8gVFlQLUZyb250bWF0dGVyIGVpbmVzIFRZUHMgKHR5cGVEZWZhdWx0RnJvbnRtYXR0ZXIvdHlwZUZsb2F0aW5nS2V5cy9cclxuLy8gdHlwZVNob3J0Y3V0cykgb2RlciBkZXIgQmxvY2sgZWluZXMgc2VpbmVyIFN1YnR5cGVuICh0eXBlU3VidHlwZXMsIHNpZWhlXHJcbi8vIHN1YnR5cGVzLmpzKS4gRWRpdG9yLCBGbG9hdGluZy1NZW5cdTAwRkMsIFNob3J0Y3V0LUtub3BmIHVuZCBQcm9wZXJ0eS1VbWJlbmVubnVuZ1xyXG4vLyBhcmJlaXRlbiBhdXNzY2hsaWVcdTAwREZsaWNoIFx1MDBGQ2JlciBkaWVzZSBTY2huaXR0c3RlbGxlIHVuZCBtXHUwMEZDc3NlbiBkZW4gVW50ZXJzY2hpZWRcclxuLy8gbmljaHQga2VubmVuLlxyXG4vL1xyXG4vLyBnZXRTaG9ydGN1dHMvc2V0U2hvcnRjdXRzIGhhbHRlbiBkaWUgU2hvcnRjdXQtUmVjb3JkcyBqZSBLZXkgKHsgbmFtZSB9LFxyXG4vLyBzaWVoZSBzaG9ydGN1dHMuanMpIC0gYmV3dXNzdCBuZWJlbiBkZW0gRnJvbnRtYXR0ZXIgc3RhdHQgZGFyaW4sIGRhbWl0IGRlclxyXG4vLyBXZXJ0IGRlciBQcm9wZXJ0eSB0eXByZWluIGJsZWlidCB1bmQgT2JzaWRpYW5zIG5hdGl2ZXMgV2lkZ2V0IHVuYW5nZXRhc3RldFxyXG4vLyB3ZWl0ZXJsXHUwMEU0dWZ0LiBEZXIgV2VydCBpbSBGcm9udG1hdHRlciBibGVpYnQgYmVpIGdlc2V0enRlbSBTaG9ydGN1dCBhbHNcclxuLy8gUlx1MDBGQ2NrZmFsbHdlcnQgc3RlaGVuLlxyXG5mdW5jdGlvbiB0eXBlU3RvcmUocGx1Z2luLCB0eXBlKSB7XHJcbiAgcmV0dXJuIHtcclxuICAgIHR5cGUsXHJcbiAgICBzdWJ0eXBlOiBudWxsLFxyXG4gICAgZ2V0RnJvbnRtYXR0ZXI6ICgpID0+IHBsdWdpbi5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdID8/IHt9LFxyXG4gICAgc2V0RnJvbnRtYXR0ZXI6IChmcm9udG1hdHRlcikgPT4ge1xyXG4gICAgICBwbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXSA9IGZyb250bWF0dGVyO1xyXG4gICAgfSxcclxuICAgIGdldEZsb2F0aW5nOiAoKSA9PiBwbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXSA/PyBbXSxcclxuICAgIHNldEZsb2F0aW5nOiAoa2V5cykgPT4ge1xyXG4gICAgICBpZiAoa2V5cy5sZW5ndGggPiAwKSBwbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXSA9IGtleXM7XHJcbiAgICAgIGVsc2UgZGVsZXRlIHBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdO1xyXG4gICAgfSxcclxuICAgIGdldFNob3J0Y3V0czogKCkgPT4gcGx1Z2luLnNldHRpbmdzLnR5cGVTaG9ydGN1dHNbdHlwZV0gPz8ge30sXHJcbiAgICBzZXRTaG9ydGN1dHM6IChzaG9ydGN1dHMpID0+IHtcclxuICAgICAgaWYgKE9iamVjdC5rZXlzKHNob3J0Y3V0cykubGVuZ3RoID4gMCkgcGx1Z2luLnNldHRpbmdzLnR5cGVTaG9ydGN1dHNbdHlwZV0gPSBzaG9ydGN1dHM7XHJcbiAgICAgIGVsc2UgZGVsZXRlIHBsdWdpbi5zZXR0aW5ncy50eXBlU2hvcnRjdXRzW3R5cGVdO1xyXG4gICAgfSxcclxuICB9O1xyXG59XHJcblxyXG5mdW5jdGlvbiBzdWJ0eXBlU3RvcmUocGx1Z2luLCB0eXBlLCBzdWJ0eXBlKSB7XHJcbiAgcmV0dXJuIHtcclxuICAgIHR5cGUsXHJcbiAgICBzdWJ0eXBlLFxyXG4gICAgZ2V0RnJvbnRtYXR0ZXI6ICgpID0+IGdldFN1YnR5cGUocGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKT8uZnJvbnRtYXR0ZXIgPz8ge30sXHJcbiAgICBzZXRGcm9udG1hdHRlcjogKGZyb250bWF0dGVyKSA9PiB7XHJcbiAgICAgIGVuc3VyZVN1YnR5cGUocGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKS5mcm9udG1hdHRlciA9IGZyb250bWF0dGVyO1xyXG4gICAgfSxcclxuICAgIGdldEZsb2F0aW5nOiAoKSA9PiBnZXRTdWJ0eXBlKHBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSk/LmZsb2F0aW5nS2V5cyA/PyBbXSxcclxuICAgIHNldEZsb2F0aW5nOiAoa2V5cykgPT4ge1xyXG4gICAgICBlbnN1cmVTdWJ0eXBlKHBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSkuZmxvYXRpbmdLZXlzID0ga2V5cztcclxuICAgIH0sXHJcbiAgICBnZXRTaG9ydGN1dHM6ICgpID0+IGdldFN1YnR5cGUocGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKT8uc2hvcnRjdXRzID8/IHt9LFxyXG4gICAgc2V0U2hvcnRjdXRzOiAoc2hvcnRjdXRzKSA9PiB7XHJcbiAgICAgIGVuc3VyZVN1YnR5cGUocGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKS5zaG9ydGN1dHMgPSBzaG9ydGN1dHM7XHJcbiAgICB9LFxyXG4gIH07XHJcbn1cclxuXHJcbi8vIE9ic2lkaWFucyBlaWdlbmVzIEZyb250bWF0dGVyLVdpZGdldCAoXCJQcm9wZXJ0aWVzXCIpIGlzdCBrZWluZSBvZmZpemllbGxlXHJcbi8vIFBsdWdpbi1BUEkuIEludGVybiBpc3QgZXMgZWluZSBDb21wb25lbnQtS2xhc3NlIChpbSBnZWJhdXRlbiBhcHAuanMgenVcclxuLy8gXCJNZXRhZGF0YUVkaXRvclwiIG1pbmlmaXppZXJ0KSwgZGllIHNvd29obCB2b24gamVkZXIgTWFya2Rvd25WaWV3IGFscyBhdWNoIHZvblxyXG4vLyBkZXIgZWluZ2ViYXV0ZW4gXCJGaWxlIFByb3BlcnRpZXNcIi1QYW5lIHZlcndlbmRldCB3aXJkIC0gYmVpZGUgbGVnZW4gc2ljaCBiZWltXHJcbi8vIEVyemV1Z2VuIHVuY29uZGl0aW9uYWwgZWluZSBJbnN0YW56IHVudGVyIHZpZXcubWV0YWRhdGFFZGl0b3IgYW4uIERpZSBLbGFzc2VcclxuLy8gc2VsYnN0IHdpcmQgbmlyZ2VuZHMgdW50ZXIgZWluZW0gTmFtZW4gZXhwb3J0aWVydCwgaXN0IGFiZXIgXHUwMEZDYmVyIGVpbmVcclxuLy8gYmVsaWViaWdlIGJlcmVpdHMgdm9yaGFuZGVuZSBJbnN0YW56IGVycmVpY2hiYXIgKGluc3RhbmNlLmNvbnN0cnVjdG9yKSB1bmRcclxuLy8gYmxlaWJ0IGZcdTAwRkNyIGRpZSBEYXVlciBkZXIgT2JzaWRpYW4tU2Vzc2lvbiBzdGFiaWwgLSBlaW5tYWxpZ2VzIEFiZ3JlaWZlbiB1bmRcclxuLy8gWndpc2NoZW5zcGVpY2hlcm4gcmVpY2h0IGRlc2hhbGIgYXVzLlxyXG5sZXQgY2FjaGVkRWRpdG9yQ2xhc3MgPSBudWxsO1xyXG5cclxuZnVuY3Rpb24gZ2V0TWV0YWRhdGFFZGl0b3JDbGFzcyhhcHApIHtcclxuICBpZiAoY2FjaGVkRWRpdG9yQ2xhc3MpIHJldHVybiBjYWNoZWRFZGl0b3JDbGFzcztcclxuXHJcbiAgY29uc3QgYWN0aXZlID0gYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XHJcbiAgaWYgKGFjdGl2ZT8ubWV0YWRhdGFFZGl0b3IpIHtcclxuICAgIGNhY2hlZEVkaXRvckNsYXNzID0gYWN0aXZlLm1ldGFkYXRhRWRpdG9yLmNvbnN0cnVjdG9yO1xyXG4gICAgcmV0dXJuIGNhY2hlZEVkaXRvckNsYXNzO1xyXG4gIH1cclxuICBmb3IgKGNvbnN0IGxlYWYgb2YgYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xyXG4gICAgaWYgKGxlYWYudmlldz8ubWV0YWRhdGFFZGl0b3IpIHtcclxuICAgICAgY2FjaGVkRWRpdG9yQ2xhc3MgPSBsZWFmLnZpZXcubWV0YWRhdGFFZGl0b3IuY29uc3RydWN0b3I7XHJcbiAgICAgIHJldHVybiBjYWNoZWRFZGl0b3JDbGFzcztcclxuICAgIH1cclxuICB9XHJcbiAgcmV0dXJuIG51bGw7XHJcbn1cclxuXHJcbi8vIEFuYWxvZyB6dSBnZXRNZXRhZGF0YUVkaXRvckNsYXNzIG9iZW46IFJlZmVyZW56IGF1ZiBkaWUgcHJpdmF0ZSBQcm9wZXJ0eS1cclxuLy8gWmVpbGVuLUtsYXNzZSAoaW0gZ2ViYXV0ZW4gYXBwLmpzIG1pbmlmaXppZXJ0KSwgXHUwMEZDYmVyIGVpbmUgYmVyZWl0c1xyXG4vLyBnZXJlbmRlcnRlIFplaWxlIGFiZ2VncmlmZmVuIChkZXJlbiAuY29uc3RydWN0b3IpIC0gc3RhYmlsIGZcdTAwRkNyIGRpZSBEYXVlclxyXG4vLyBkZXIgU2Vzc2lvbi4gXCJlZGl0b3JcIiAoZmFsbHMgc2Nob24gdm9yaGFuZGVuKSB3aXJkIHp1ZXJzdCBwcm9iaWVydCwgZGFcclxuLy8gZGllc2UgS2xhc3NlIGF1c3NjaGxpZVx1MDBERmxpY2ggZlx1MDBGQ3IgZW5zdXJlUHJvcGVydHlNZW51UGF0Y2goKSBnZWJyYXVjaHQgd2lyZFxyXG4vLyB1bmQgaW4gYWxsZXIgUmVnZWwgc2Nob24gZG9ydCB2ZXJmXHUwMEZDZ2JhciBpc3QsIHNvYmFsZCBkZXIgVHlwIG1pbmRlc3RlbnNcclxuLy8gZWluZSBQcm9wZXJ0eSBoYXQuXHJcbmxldCBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzID0gbnVsbDtcclxuXHJcbmZ1bmN0aW9uIGdldFByb3BlcnR5Um93Q2xhc3MoYXBwLCBlZGl0b3IpIHtcclxuICBpZiAoY2FjaGVkUHJvcGVydHlSb3dDbGFzcykgcmV0dXJuIGNhY2hlZFByb3BlcnR5Um93Q2xhc3M7XHJcbiAgaWYgKGVkaXRvcj8ucmVuZGVyZWQ/LlswXSkge1xyXG4gICAgY2FjaGVkUHJvcGVydHlSb3dDbGFzcyA9IGVkaXRvci5yZW5kZXJlZFswXS5jb25zdHJ1Y3RvcjtcclxuICAgIHJldHVybiBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzO1xyXG4gIH1cclxuICBjb25zdCBhY3RpdmUgPSBhcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcclxuICBpZiAoYWN0aXZlPy5tZXRhZGF0YUVkaXRvcj8ucmVuZGVyZWQ/LlswXSkge1xyXG4gICAgY2FjaGVkUHJvcGVydHlSb3dDbGFzcyA9IGFjdGl2ZS5tZXRhZGF0YUVkaXRvci5yZW5kZXJlZFswXS5jb25zdHJ1Y3RvcjtcclxuICAgIHJldHVybiBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzO1xyXG4gIH1cclxuICBmb3IgKGNvbnN0IGxlYWYgb2YgYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xyXG4gICAgaWYgKGxlYWYudmlldz8ubWV0YWRhdGFFZGl0b3I/LnJlbmRlcmVkPy5bMF0pIHtcclxuICAgICAgY2FjaGVkUHJvcGVydHlSb3dDbGFzcyA9IGxlYWYudmlldy5tZXRhZGF0YUVkaXRvci5yZW5kZXJlZFswXS5jb25zdHJ1Y3RvcjtcclxuICAgICAgcmV0dXJuIGNhY2hlZFByb3BlcnR5Um93Q2xhc3M7XHJcbiAgICB9XHJcbiAgfVxyXG4gIHJldHVybiBudWxsO1xyXG59XHJcblxyXG4vLyBFcmdcdTAwRTRuenQgZGFzIFJlY2h0c2tsaWNrLUtvbnRleHRtZW5cdTAwRkMgZWluZXIgUHJvcGVydHktWmVpbGUgdW0gZWluZW4gVG9nZ2xlXHJcbi8vIFwiRmxvYXRpbmdcIiBHQU5aIE9CRU4gLSBhYmVyIGV4a2x1c2l2IGZcdTAwRkNyIFplaWxlbiBkaWVzZXMgUGx1Z2luc1xyXG4vLyBlaWdlbmVyIFRZUC1EZXRhaWxhbnNpY2h0IChlcmthbm50IGFuIG93bmVyLmZyZWRTdG9yZSwgc2llaGUgdW50ZW4pLCBuaWUgaW5cclxuLy8gZWNodGVuIE5vdGl6ZW4uIFVuYWJoXHUwMEU0bmdpZyB2b20gXCIrXCItQnV0dG9uIGxpbmtzIG5lYmVuIGRlbSBub3JtYWxlblxyXG4vLyAoZnJlZFBlbmRpbmdGbG9hdGluZ0FkZCksIGRlciBudXIgYmVpbSBORVVFTiBBbmxlZ2VuIGdyZWlmdCAtIGRpZXNlciBUb2dnbGVcclxuLy8gd2lya3QgYXVmIEpFREUgYmVyZWl0cyB2b3JoYW5kZW5lIFByb3BlcnR5LCBpbiBiZWlkZSBSaWNodHVuZ2VuLlxyXG4vL1xyXG4vLyBPYnNpZGlhbnMgUHJvcGVydHktS29udGV4dG1lblx1MDBGQyBpc3Qga2VpbmUgb2ZmaXppZWxsZSBFcndlaXRlcnVuZ3NzdGVsbGU6IEVzXHJcbi8vIGJhdXQgYXVmIGRlbSBEZXNrdG9wIGVpbmVuIE5BVElWRU4gRWxlY3Ryb24tTWVuXHUwMEZDIGF1cyBlaW5lciBpbnRlcm5cclxuLy8gZXJ6ZXVndGVuIE1lbnUtSW5zdGFueiB1bmQgemVpZ3Qgc2llIGlubmVyaGFsYiB2b24gc2hvd1Byb3BlcnR5TWVudSgpIGluXHJcbi8vIGVpbmVtIGVpbnppZ2VuIHN5bmNocm9uZW4gQXVmcnVmIGFuIChrZWluIFdvcmtzcGFjZS1FdmVudCwga2VpbiBET00tUG9wdXAsXHJcbi8vIGRhcyBzaWNoIG5hY2h0clx1MDBFNGdsaWNoIHBlciBET00tTWFuaXB1bGF0aW9uIGVyd2VpdGVybiBsaWVcdTAwREZlIC0gYW5kZXJzIGFsc1xyXG4vLyB6LiBCLiBiZWkgXCJmaWxlLW1lbnVcIikuIERlc2hhbGIgaGllciBlaW4gTW9ua2V5LVBhdGNoIGF1ZiBkaWUgcHJpdmF0ZVxyXG4vLyBaZWlsZW4tS2xhc3NlIHNlbGJzdCAod2llIHNjaG9uIGJlaW0gR3JhcGgtUmVuZGVyZXIsIHNpZWhlXHJcbi8vIGdyYXBoLWNvbG9ycy5qcyksIGFiZXIgc28gZW5nIHdpZSBtXHUwMEY2Z2xpY2ggZ2VoYWx0ZW46IGZcdTAwRkNyIFplaWxlbiBkaWVzZXNcclxuLy8gUGx1Z2lucyB3aXJkIGxlZGlnbGljaCwgdW5taXR0ZWxiYXIgYmV2b3IgT2JzaWRpYW4gc2VpbmUgYmVyZWl0cyBmZXJ0aWdcclxuLy8gYXVmZ2ViYXV0ZSBNZW51LUluc3RhbnogYW56ZWlndCwgZWluIGVpbnppZ2VyIHp1c1x1MDBFNHR6bGljaGVyIGFkZEl0ZW0oKS1BdWZydWZcclxuLy8gZGF6d2lzY2hlbmdlc2Nob2JlbiAoXHUwMEZDYmVyIGVpbmVuIG51ciBmXHUwMEZDciBkaWVzZW4gZWluZW4gc3luY2hyb25lbiBBdWZydWZcclxuLy8gYWt0aXZlbiwgc2ljaCBkYW5hY2ggc2VsYnN0IHdpZWRlciB6dXJcdTAwRkNja3NldHplbmRlbiBQYXRjaCBhdWZcclxuLy8gTWVudS5wcm90b3R5cGUuc2hvd0F0TW91c2VFdmVudCAtIHNpY2hlciwgZGEgSlMgc2luZ2xlLXRocmVhZGVkIGlzdCB1bmRcclxuLy8gd1x1MDBFNGhyZW5kZGVzc2VuIGtlaW4gendlaXRlcyBNZW5cdTAwRkMgYXVmZ2ViYXV0IHdlcmRlbiBrYW5uKS4gRGllIGdlc2FtdGUgXHUwMEZDYnJpZ2VcclxuLy8gbmF0aXZlIE1lblx1MDBGQy1Mb2dpayAoVHlwIFx1MDBFNG5kZXJuLCBBdXNzY2huZWlkZW4vS29waWVyZW4vRWluZlx1MDBGQ2dlbiwgRW50ZmVybmVuKVxyXG4vLyBibGVpYnQgZGFiZWkga29tcGxldHQgdW5hbmdldGFzdGV0LlxyXG5mdW5jdGlvbiBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaChhcHAsIGVkaXRvcikge1xyXG4gIGNvbnN0IFJvd0NsYXNzID0gZ2V0UHJvcGVydHlSb3dDbGFzcyhhcHAsIGVkaXRvcik7XHJcbiAgaWYgKCFSb3dDbGFzcyB8fCBSb3dDbGFzcy5fZnJlZE1lbnVQYXRjaGVkKSByZXR1cm47XHJcbiAgUm93Q2xhc3MuX2ZyZWRNZW51UGF0Y2hlZCA9IHRydWU7XHJcblxyXG4gIGNvbnN0IG9yaWdpbmFsU2hvd1Byb3BlcnR5TWVudSA9IFJvd0NsYXNzLnByb3RvdHlwZS5zaG93UHJvcGVydHlNZW51O1xyXG4gIFJvd0NsYXNzLnByb3RvdHlwZS5zaG93UHJvcGVydHlNZW51ID0gZnVuY3Rpb24gKGV2ZW50KSB7XHJcbiAgICBjb25zdCBvd25lciA9IHRoaXMubWV0YWRhdGFFZGl0b3I/Lm93bmVyO1xyXG4gICAgaWYgKCFvd25lcj8uZnJlZFN0b3JlKSByZXR1cm4gb3JpZ2luYWxTaG93UHJvcGVydHlNZW51LmNhbGwodGhpcywgZXZlbnQpO1xyXG5cclxuICAgIGNvbnN0IHJvdyA9IHRoaXM7XHJcbiAgICBjb25zdCBvcmlnaW5hbFNob3dBdE1vdXNlRXZlbnQgPSBNZW51LnByb3RvdHlwZS5zaG93QXRNb3VzZUV2ZW50O1xyXG4gICAgTWVudS5wcm90b3R5cGUuc2hvd0F0TW91c2VFdmVudCA9IGZ1bmN0aW9uIChtb3VzZUV2ZW50KSB7XHJcbiAgICAgIE1lbnUucHJvdG90eXBlLnNob3dBdE1vdXNlRXZlbnQgPSBvcmlnaW5hbFNob3dBdE1vdXNlRXZlbnQ7XHJcbiAgICAgIGNvbnN0IGlzRmxvYXRpbmcgPSBvd25lci5mcmVkU3RvcmUuZ2V0RmxvYXRpbmcoKS5pbmNsdWRlcyhyb3cuZW50cnkua2V5KTtcclxuICAgICAgLy8gXCJ0aXRsZVwiIGlzdCBkaWUgZXJzdGUgZGVyIHZvbiBzaG93UHJvcGVydHlNZW51IHJlZ2lzdHJpZXJ0ZW5cclxuICAgICAgLy8gU2VjdGlvbnMgKGFkZFNlY3Rpb25zKFsuLi5dKSkgdW5kIGF1ZiBkZW0gRGVza3RvcCBzb25zdCBsZWVyIChudXJcclxuICAgICAgLy8gYXVmIE1vYmlsZSBtaXQgZWluZW0gcmVpbmVuIExhYmVsLUVpbnRyYWcgYmVsZWd0KSAtIGxhbmRldCBhbHNvXHJcbiAgICAgIC8vIHp1dmVybFx1MDBFNHNzaWcgZ2FueiBvYmVuLiBcInBpbi1vZmZcIiAoZHVyY2hnZXN0cmljaGVuZXIgUGluKSBwYXNzdFxyXG4gICAgICAvLyBpbmhhbHRsaWNoIHp1IFwibmljaHQgZmVzdCB2ZXJhbmtlcnRcIiA9IGZsb2F0aW5nLCBpbiBBbmFsb2dpZSB6dVxyXG4gICAgICAvLyBcInBpblwiIGZcdTAwRkNyIFwiZml4aWVydFwiIGluIGFuZGVyZW4gQXBwcy5cclxuICAgICAgdGhpcy5hZGRJdGVtKChpdGVtKSA9PlxyXG4gICAgICAgIGl0ZW1cclxuICAgICAgICAgIC5zZXRUaXRsZShcIkZsb2F0aW5nXCIpXHJcbiAgICAgICAgICAuc2V0SWNvbihcInBpbi1vZmZcIilcclxuICAgICAgICAgIC5zZXRDaGVja2VkKGlzRmxvYXRpbmcpXHJcbiAgICAgICAgICAuc2V0U2VjdGlvbihcInRpdGxlXCIpXHJcbiAgICAgICAgICAub25DbGljaygoKSA9PiB0b2dnbGVGbG9hdGluZ1Byb3BlcnR5KG93bmVyLmZyZWRWaWV3LCBvd25lci5mcmVkU3RvcmUsIHJvdy5lbnRyeS5rZXkpKVxyXG4gICAgICApO1xyXG4gICAgICByZXR1cm4gb3JpZ2luYWxTaG93QXRNb3VzZUV2ZW50LmNhbGwodGhpcywgbW91c2VFdmVudCk7XHJcbiAgICB9O1xyXG5cclxuICAgIHJldHVybiBvcmlnaW5hbFNob3dQcm9wZXJ0eU1lbnUuY2FsbCh0aGlzLCBldmVudCk7XHJcbiAgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gdG9nZ2xlRmxvYXRpbmdQcm9wZXJ0eSh2aWV3LCBzdG9yZSwga2V5KSB7XHJcbiAgY29uc3QgZmxvYXRpbmcgPSBzdG9yZS5nZXRGbG9hdGluZygpO1xyXG4gIHN0b3JlLnNldEZsb2F0aW5nKGZsb2F0aW5nLmluY2x1ZGVzKGtleSkgPyBmbG9hdGluZy5maWx0ZXIoKGspID0+IGsgIT09IGtleSkgOiBbLi4uZmxvYXRpbmcsIGtleV0pO1xyXG4gIHZpZXcucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gIC8vIEFrdHVhbGlzaWVydCBkaWUgRmV0dC0vS3Vyc2l2LU1hcmtpZXJ1bmcgc29mb3J0IC0gc293b2hsIGluIGRpZXNlclxyXG4gIC8vIERldGFpbGFuc2ljaHQgYWxzIGF1Y2ggaW4gYmVyZWl0cyBvZmZlbmVuIE5vdGl6ZW4gZGllc2VzIFR5cHMuXHJcbiAgdmlldy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbn1cclxuXHJcbi8vIERhcyBXaWRnZXQgZXJ3YXJ0ZXQgYWxzIHp3ZWl0ZW4gS29uc3RydWt0b3ItUGFyYW1ldGVyIGVpbiBcIm93bmVyXCItT2JqZWt0IC1cclxuLy8gZGFzIGlzdCBkaWUgZWluemlnZSBTY2huaXR0c3RlbGxlLCBcdTAwRkNiZXIgZGllIGVzIGFuIGVpbmUgRGF0ZWkgZ2VidW5kZW4gd2lyZC5cclxuLy8gU3RhdHQgZWluZXIgZWNodGVuIE5vdGl6IGhcdTAwRTRuZ2VuIHdpciBlcyBoaWVyIGFuIGVpbiBQbGFpbi1PYmplY3QgaW4gZGVuXHJcbi8vIFBsdWdpbi1TZXR0aW5nczogc2F2ZUZyb250bWF0dGVyKG9iaikgYmVrb21tdCBiZWkgamVkZXIgXHUwMEM0bmRlcnVuZyAoUHJvcGVydHlcclxuLy8gaGluenVnZWZcdTAwRkNndC91bWJlbmFubnQvZ2VsXHUwMEY2c2NodCwgV2VydCBnZVx1MDBFNG5kZXJ0LCBSZWloZW5mb2xnZSBnZVx1MDBFNG5kZXJ0KSBkYXNcclxuLy8gdm9sbHN0XHUwMEU0bmRpZ2UsIGFrdHVlbGxlIFByb3BlcnR5LVNldCBcdTAwRkNiZXJnZWJlbi4gc2hpZnRGb2N1c0JlZm9yZS9BZnRlciBzdGV1ZXJuXHJcbi8vIG51ciwgd29oaW4gZGVyIEZva3VzIGJlaW0gVmVybGFzc2VuIGRlcyBXaWRnZXRzIHBlciBQZmVpbHRhc3RlL1RhYiBzcHJpbmd0LFxyXG4vLyB1bmQgZFx1MDBGQ3JmZW4gTm8tT3BzIHNlaW4uIGdldEZpbGUoKSB3aXJkIHZvbiBqZWRlciBlaW56ZWxuZW4gUHJvcGVydHktWmVpbGVcclxuLy8gYmVpbSBSZW5kZXJuIGF1ZmdlcnVmZW4gKGZcdTAwRkNyIHNvdXJjZVBhdGgsIHouIEIuIGJlaSBMaW5rLVdlcnRlbikgLSBvaG5lXHJcbi8vIGVjaHRlIERhdGVpIGdpYnQgZXMgaGllciBuaWNodHMgU2lubnZvbGxlcyB6dXJcdTAwRkNja3p1Z2ViZW4sIGFiZXIgZGllIE1ldGhvZGVcclxuLy8gbXVzcyBleGlzdGllcmVuLCBzb25zdCBjcmFzaHQgZGFzIFdpZGdldCBiZWltIFJlbmRlcm4gamVkZXIgUHJvcGVydHkuXHJcbi8vXHJcbi8vIEVpbmUgRWRpdG9yLUluc3RhbnogamUgQmxvY2sgKFRZUCBiencuIFN1YnR5cCksIGdlYnVuZGVuIGFuIGRlbiBTcGVpY2hlcm9ydFxyXG4vLyBhdXMgc3RvcmUgKHNpZWhlIHR5cGVTdG9yZS9zdWJ0eXBlU3RvcmUpIC0gU3RhbmRhcmQtIHVuZCBGbG9hdGluZyBQcm9wZXJ0aWVzXHJcbi8vIChzaWVoZSB0eXBlRmxvYXRpbmdLZXlzIGluIHNldHRpbmdzLmpzKSB0ZWlsZW4gc2ljaCBkaWVzZWxiZSBMaXN0ZSB1bmRcclxuLy8gUmVpaGVuZm9sZ2UsIG51ciBGbG9hdGluZy1tYXJraWVydGUgS2V5cyB3ZXJkZW4gdm9uIGdldFR5cGVEZWZhdWx0cygpXHJcbi8vIChtYWluLmpzKSBuaWNodCBhdXRvbWF0aXNjaCBhdXNnZWxpZWZlcnQuIGVkaXRvci5mcmVkUGVuZGluZ0Zsb2F0aW5nQWRkIHdpcmRcclxuLy8gdm9uIHR5cC12aWV3LmpzIHZvciBhZGRCbGFua1Byb3BlcnR5KCkgZ2VzZXR6dCwgdW0gZGllIGFscyBuXHUwMEU0Y2hzdGVzXHJcbi8vIGhpbnp1Z2VmXHUwMEZDZ3RlIChiencuIHVtYmVuYW5udGUpIFByb3BlcnR5IGFscyBGbG9hdGluZyB6dSBtYXJraWVyZW4gLSBzaWVoZVxyXG4vLyBzYXZlRnJvbnRtYXR0ZXIgdW50ZW4uXHJcbi8vIFRhc3RhdHVyLU5hdmlnYXRpb24gXHUwMEZDYmVyIGRpZSBHcmVuemVuIGVpbmVyIEVkaXRvci1JbnN0YW56IGhpbmF1cyAoc2llaGVcclxuLy8gZnJvbnRtYXR0ZXItYmxvY2tzLmpzKTogT2JzaWRpYW4gYmV3ZWd0IGRlbiBGb2t1cyBudXIgaW5uZXJoYWxiIHNlaW5lclxyXG4vLyBlaWdlbmVuIFplaWxlbmxpc3RlIC0gYW0gb2JlcmVuIEVuZGUgc3ByaW5ndCBlciBhdWYgZGllIFx1MDBEQ2JlcnNjaHJpZnQgZGVzXHJcbi8vIEVkaXRvcnMsIGFtIHVudGVyZW4gYXVmIGRlc3NlbiBcIkFkZCBwcm9wZXJ0eVwiLUJ1dHRvbi4gQmVpZGUgc2luZCBoaWVyIHBlclxyXG4vLyBDU1MgYXVzZ2VibGVuZGV0LCBkaWUgS2V0dGUgZW5kZXRlIGFsc28gYW0gQmxvY2tyYW5kLlxyXG4vL1xyXG4vLyBTdGF0dCBvd25lci5zaGlmdEZvY3VzQmVmb3JlL3NoaWZ0Rm9jdXNBZnRlciAoZGllIE9ic2lkaWFuIG51ciBcdTAwRkNiZXIgZ2VuYXVcclxuLy8gZGllc2UgYmVpZGVuIGF1c2dlYmxlbmRldGVuIEVsZW1lbnRlIGVycmVpY2h0KSBkYWhlciBlaW4gZWlnZW5lciBIYW5kbGVyIGluXHJcbi8vIGRlciBDYXB0dXJlLVBoYXNlLCBkZXIgVk9SIGRlbSBIYW5kbGVyIGRlciBaZWlsZSBsXHUwMEU0dWZ0LiBFciBncmVpZnQgbnVyLCB3ZW5uXHJcbi8vIGRpZSBaZWlsZSBTRUxCU1QgZGVuIEZva3VzIGhhdCAoZXZlbnQudGFyZ2V0ID09PSBjb250YWluZXJFbCBkZXIgWmVpbGUpIC1cclxuLy8gZ2VuYXUgZGllIEJlZGluZ3VuZywgdW50ZXIgZGVyIGF1Y2ggT2JzaWRpYW4gc2VpbmUgai9rLU5hdmlnYXRpb24genVsXHUwMEU0c3N0LFxyXG4vLyBiZWltIFRpcHBlbiBpbiBlaW5lbSBLZXktL1dlcnQtRmVsZCBhbHNvIG5pZS5cclxuZnVuY3Rpb24gcmVnaXN0ZXJGb2N1c0NoYWluKGVkaXRvciwgb25TaGlmdEZvY3VzKSB7XHJcbiAgZWRpdG9yLmNvbnRhaW5lckVsLmFkZEV2ZW50TGlzdGVuZXIoXHJcbiAgICBcImtleWRvd25cIixcclxuICAgIChldmVudCkgPT4ge1xyXG4gICAgICBpZiAoZXZlbnQuaXNDb21wb3NpbmcgfHwgZXZlbnQuZGVmYXVsdFByZXZlbnRlZCkgcmV0dXJuO1xyXG4gICAgICAvLyBNZWhyZmFjaC1BdXN3YWhsOiBPYnNpZGlhbiBlcndlaXRlcnQgZGFtaXQgZGllIEF1c3dhaGwsIHN0YXR0IGRlblxyXG4gICAgICAvLyBGb2t1cyB6dSBiZXdlZ2VuLlxyXG4gICAgICBpZiAoZWRpdG9yLnNlbGVjdGVkTGluZXM/LnNpemUgPiAxKSByZXR1cm47XHJcbiAgICAgIGlmIChldmVudC5zaGlmdEtleSAmJiAoZXZlbnQua2V5ID09PSBcIkFycm93VXBcIiB8fCBldmVudC5rZXkgPT09IFwiQXJyb3dEb3duXCIpKSByZXR1cm47XHJcblxyXG4gICAgICBjb25zdCBpbmRleCA9IGVkaXRvci5yZW5kZXJlZC5maW5kSW5kZXgoKHJvdykgPT4gcm93LmNvbnRhaW5lckVsID09PSBldmVudC50YXJnZXQpO1xyXG4gICAgICBpZiAoaW5kZXggPT09IC0xKSByZXR1cm47XHJcblxyXG4gICAgICBjb25zdCB1cCA9IGV2ZW50LmtleSA9PT0gXCJBcnJvd1VwXCIgfHwgZXZlbnQua2V5ID09PSBcImtcIiB8fCAoZXZlbnQua2V5ID09PSBcIlRhYlwiICYmIGV2ZW50LnNoaWZ0S2V5KTtcclxuICAgICAgY29uc3QgZG93biA9IGV2ZW50LmtleSA9PT0gXCJBcnJvd0Rvd25cIiB8fCBldmVudC5rZXkgPT09IFwialwiIHx8IChldmVudC5rZXkgPT09IFwiVGFiXCIgJiYgIWV2ZW50LnNoaWZ0S2V5KTtcclxuICAgICAgbGV0IHN0ZXAgPSAwO1xyXG4gICAgICBpZiAodXAgJiYgaW5kZXggPT09IDApIHN0ZXAgPSAtMTtcclxuICAgICAgZWxzZSBpZiAoZG93biAmJiBpbmRleCA9PT0gZWRpdG9yLnJlbmRlcmVkLmxlbmd0aCAtIDEpIHN0ZXAgPSAxO1xyXG4gICAgICBpZiAoc3RlcCA9PT0gMCB8fCAhb25TaGlmdEZvY3VzKHN0ZXApKSByZXR1cm47XHJcblxyXG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgIH0sXHJcbiAgICB0cnVlXHJcbiAgKTtcclxufVxyXG5cclxuZnVuY3Rpb24gbW91bnRGcm9udG1hdHRlckVkaXRvcih2aWV3LCBjb250YWluZXJFbCwgc3RvcmUsIHsgb25TaGlmdEZvY3VzIH0gPSB7fSkge1xyXG4gIGNvbnN0IGFwcCA9IHZpZXcuYXBwO1xyXG4gIGNvbnN0IEVkaXRvckNsYXNzID0gZ2V0TWV0YWRhdGFFZGl0b3JDbGFzcyhhcHApO1xyXG4gIGlmICghRWRpdG9yQ2xhc3MpIHtcclxuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwicFwiLCB7XHJcbiAgICAgIGNsczogXCJmcmVkLXR5cC1mcm9udG1hdHRlci11bmF2YWlsYWJsZVwiLFxyXG4gICAgICB0ZXh0OiBcIlp1bSBJbml0aWFsaXNpZXJlbiBkZXMgRWRpdG9ycyBiaXR0ZSB6dWVyc3QgZWlubWFsIGVpbmUgTm90aXogXHUwMEY2ZmZuZW4uXCIsXHJcbiAgICB9KTtcclxuICAgIHJldHVybiBudWxsO1xyXG4gIH1cclxuXHJcbiAgY29uc3Qgb3duZXIgPSB7XHJcbiAgICBhcHAsXHJcbiAgICAvLyBNYXJrZXIgZlx1MDBGQ3IgZW5zdXJlUHJvcGVydHlNZW51UGF0Y2goKSBvYmVuOiBpZGVudGlmaXppZXJ0IFByb3BlcnR5LVxyXG4gICAgLy8gWmVpbGVuIGRpZXNlcyBQbHVnaW4tZWlnZW5lbiBFZGl0b3JzIChuaWUgZWluZXIgZWNodGVuIE5vdGl6KSB1bmRcclxuICAgIC8vIGxpZWZlcnQgU3BlaWNoZXJvcnQvVmlldywgZGllIGRlciBnbG9iYWxlIE1lblx1MDBGQy1QYXRjaCBwcm8gWmVpbGVcclxuICAgIC8vIGR5bmFtaXNjaCBicmF1Y2h0IChkaWUgUGF0Y2gtSW5zdGFsbGF0aW9uIHNlbGJzdCBwYXNzaWVydCBudXIgZWlubWFsLFxyXG4gICAgLy8gdW5hYmhcdTAwRTRuZ2lnIGRhdm9uLCB3ZWxjaGVyIEJsb2NrIGRhYmVpIGdlcmFkZSBvZmZlbiB3YXIpLlxyXG4gICAgZnJlZFN0b3JlOiBzdG9yZSxcclxuICAgIGZyZWRWaWV3OiB2aWV3LFxyXG4gICAgZ2V0RmlsZSgpIHtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9LFxyXG4gICAgLy8gTnVyIGZcdTAwRkNyIE9ic2lkaWFucyBIb3Zlci1QcmV2aWV3IGJlaSBpbnRlcm5lbiBMaW5rcyBpbm5lcmhhbGIgZWluZXNcclxuICAgIC8vIFByb3BlcnR5LVdlcnRzIChFdmVudCBcImhvdmVyLWxpbmtcIikgLSBiZWxpZWJpZ2VyIFN0cmluZyByZWljaHQuXHJcbiAgICBnZXRIb3ZlclNvdXJjZSgpIHtcclxuICAgICAgcmV0dXJuIFwiZnJlZC10eXAtZnJvbnRtYXR0ZXJcIjtcclxuICAgIH0sXHJcbiAgICBzaGlmdEZvY3VzQmVmb3JlKCkge30sXHJcbiAgICBzaGlmdEZvY3VzQWZ0ZXIoKSB7fSxcclxuICAgIC8vIE9ic2lkaWFucyBFZGl0b3IgcnVmdCBkaWVzIGdlbmF1IGVpbm1hbCBwcm8gYWJnZXNjaGxvc3NlbmVyIFx1MDBDNG5kZXJ1bmcgYXVmXHJcbiAgICAvLyAoUmVuYW1lIGVyc3QgYmVpbSBCbHVyIGRlcyBLZXktSW5wdXRzLCBzaWVoZSBoYW5kbGVVcGRhdGVLZXkgaW1cclxuICAgIC8vIGdlYmF1dGVuIGFwcC5qcykgLSBqZWRlciBBdWZydWYgdHJcdTAwRTRndCBoaWVyIGFsc28gbWF4aW1hbCBlaW5lXHJcbiAgICAvLyBoaW56dWdlZlx1MDBGQ2d0ZSB1bmQvb2RlciBlbnRmZXJudGUgKG5pY2h0LWxlZXJlKSBQcm9wZXJ0eSwgbmllIG1laHJlcmVcclxuICAgIC8vIGdsZWljaHplaXRpZyBhdVx1MDBERmVyIGJlaSBlaW5lbSBNZWhyZmFjaC1MXHUwMEY2c2NoZW4uIERhcyBtYWNodCBkaWVcclxuICAgIC8vIEZsb2F0aW5nLU1hcmtpZXJ1bmcgdW50ZW4gcm9idXN0IG5hY2hmXHUwMEZDaHJiYXIsIG9obmUgWndpc2NoZW56dXN0XHUwMEU0bmRlXHJcbiAgICAvLyB3XHUwMEU0aHJlbmQgZGVzIFRpcHBlbnMgdmVyZm9sZ2VuIHp1IG1cdTAwRkNzc2VuLlxyXG4gICAgc2F2ZUZyb250bWF0dGVyKGZyb250bWF0dGVyKSB7XHJcbiAgICAgIC8vIEZhbGxzIGhpZXIgZ2VyYWRlIGVpbmUgWmVpbGUgXCJUWVBcIi9cIlNVQlRZUFwiIGVpbmdlZ2ViZW4gd3VyZGU6IG5pY2h0IFx1MDBGQ2Jlcm5laG1lbi5cclxuICAgICAgLy8gU2llIGJsZWlidCBiaXMgenVtIG5cdTAwRTRjaHN0ZW4gTmV1LU1vdW50ZW4gc2ljaHRiYXIgKGtlaW4gZXJuZXV0ZXJcclxuICAgICAgLy8gc3luY2hyb25pemUoKS1BdWZydWYgaGllciwgc2llaGUgS29tbWVudGFyIGFuIHN0cmlwVHlwUHJvcGVydHkpLlxyXG4gICAgICBzdHJpcFR5cFByb3BlcnR5KGZyb250bWF0dGVyKTtcclxuXHJcbiAgICAgIGNvbnN0IHByZXZpb3VzID0gc3RvcmUuZ2V0RnJvbnRtYXR0ZXIoKTtcclxuICAgICAgY29uc3QgcHJldmlvdXNLZXlzID0gT2JqZWN0LmtleXMocHJldmlvdXMpLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwiXCIpO1xyXG4gICAgICBjb25zdCBjdXJyZW50S2V5cyA9IE9iamVjdC5rZXlzKGZyb250bWF0dGVyKS5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBcIlwiKTtcclxuICAgICAgY29uc3QgcmVtb3ZlZEtleXMgPSBwcmV2aW91c0tleXMuZmlsdGVyKChrZXkpID0+ICFjdXJyZW50S2V5cy5pbmNsdWRlcyhrZXkpKTtcclxuICAgICAgY29uc3QgYWRkZWRLZXlzID0gY3VycmVudEtleXMuZmlsdGVyKChrZXkpID0+ICFwcmV2aW91c0tleXMuaW5jbHVkZXMoa2V5KSk7XHJcblxyXG4gICAgICBsZXQgZmxvYXRpbmcgPSBzdG9yZS5nZXRGbG9hdGluZygpO1xyXG4gICAgICBpZiAocmVtb3ZlZEtleXMubGVuZ3RoID09PSAxICYmIGFkZGVkS2V5cy5sZW5ndGggPT09IDEpIHtcclxuICAgICAgICAvLyBVbWJlbmVubnVuZyBlaW5lciBiZXN0ZWhlbmRlbiBQcm9wZXJ0eSAtIEZsb2F0aW5nLU1hcmtpZXJ1bmcgd2FuZGVydCBtaXQgdW0uXHJcbiAgICAgICAgZmxvYXRpbmcgPSBmbG9hdGluZy5tYXAoKGtleSkgPT4gKGtleSA9PT0gcmVtb3ZlZEtleXNbMF0gPyBhZGRlZEtleXNbMF0gOiBrZXkpKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBpZiAocmVtb3ZlZEtleXMubGVuZ3RoID4gMCkgZmxvYXRpbmcgPSBmbG9hdGluZy5maWx0ZXIoKGtleSkgPT4gIXJlbW92ZWRLZXlzLmluY2x1ZGVzKGtleSkpO1xyXG4gICAgICAgIGlmIChlZGl0b3IuZnJlZFBlbmRpbmdGbG9hdGluZ0FkZCAmJiBhZGRlZEtleXMubGVuZ3RoID09PSAxKSB7XHJcbiAgICAgICAgICBmbG9hdGluZyA9IFsuLi5mbG9hdGluZywgYWRkZWRLZXlzWzBdXTtcclxuICAgICAgICAgIGVkaXRvci5mcmVkUGVuZGluZ0Zsb2F0aW5nQWRkID0gZmFsc2U7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIC8vIFNob3J0Y3V0cyBoXHUwMEU0bmdlbiBhbSBLZXksIG5pY2h0IGFtIFdlcnQgKHNpZWhlIHNob3J0Y3V0cy5qcykgdW5kIG1cdTAwRkNzc2VuXHJcbiAgICAgIC8vIGRlc2hhbGIgZ2VuYXUgd2llIGRpZSBGbG9hdGluZy1NYXJraWVydW5nIG5hY2hnZWZcdTAwRkNocnQgd2VyZGVuOiBiZWkgZWluZXJcclxuICAgICAgLy8gVW1iZW5lbm51bmcgbWl0d2FuZGVybiwgYmVpIGVpbmVtIExcdTAwRjZzY2hlbiBtaXQgdmVyc2Nod2luZGVuLlxyXG4gICAgICBjb25zdCBzaG9ydGN1dHMgPSB7IC4uLnN0b3JlLmdldFNob3J0Y3V0cygpIH07XHJcbiAgICAgIGlmIChyZW1vdmVkS2V5cy5sZW5ndGggPT09IDEgJiYgYWRkZWRLZXlzLmxlbmd0aCA9PT0gMSkge1xyXG4gICAgICAgIGlmIChzaG9ydGN1dHNbcmVtb3ZlZEtleXNbMF1dKSB7XHJcbiAgICAgICAgICBzaG9ydGN1dHNbYWRkZWRLZXlzWzBdXSA9IHNob3J0Y3V0c1tyZW1vdmVkS2V5c1swXV07XHJcbiAgICAgICAgICBkZWxldGUgc2hvcnRjdXRzW3JlbW92ZWRLZXlzWzBdXTtcclxuICAgICAgICB9XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgZm9yIChjb25zdCBrZXkgb2YgcmVtb3ZlZEtleXMpIGRlbGV0ZSBzaG9ydGN1dHNba2V5XTtcclxuICAgICAgfVxyXG5cclxuICAgICAgc3RvcmUuc2V0RnJvbnRtYXR0ZXIoZnJvbnRtYXR0ZXIpO1xyXG4gICAgICBzdG9yZS5zZXRGbG9hdGluZyhmbG9hdGluZyk7XHJcbiAgICAgIHN0b3JlLnNldFNob3J0Y3V0cyhzaG9ydGN1dHMpO1xyXG4gICAgICB2aWV3LnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgLy8gS25vcGYvQ2hpcCBhbiBkaWUgbmV1ZSBaZWlsZW4tIHVuZCBLZXktTGFnZSBhbnBhc3NlbiAtIGVpbmUgZ2VyYWRlXHJcbiAgICAgIC8vIGJlbmFubnRlIFplaWxlIGJla29tbXQgc28gaWhyZW4gS25vcGYsIGVpbmUgZ2VsXHUwMEY2c2NodGUgbmltbXQgaWhyZW4gbWl0LlxyXG4gICAgICByZW5kZXJTaG9ydGN1dENvbnRyb2xzKHZpZXcsIGVkaXRvciwgc3RvcmUpO1xyXG4gICAgICAvLyBEYW1pdCBkaWUgRmV0dC0vS3Vyc2l2LU1hcmtpZXJ1bmcgaW4gYmVyZWl0cyBvZmZlbmVuIE5vdGl6ZW4gZGllc2VzXHJcbiAgICAgIC8vIFR5cHMgc29mb3J0IG1pdHppZWh0LCB3ZW5uIHNpY2ggaGllciBkaWUgUHJvcGVydHktTGlzdGUgXHUwMEU0bmRlcnQuXHJcbiAgICAgIHZpZXcucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgfSxcclxuICB9O1xyXG5cclxuICBjb25zdCBlZGl0b3IgPSBuZXcgRWRpdG9yQ2xhc3MoYXBwLCBvd25lcik7XHJcbiAgZWRpdG9yLmZyZWRQZW5kaW5nRmxvYXRpbmdBZGQgPSBmYWxzZTtcclxuICBpZiAob25TaGlmdEZvY3VzKSByZWdpc3RlckZvY3VzQ2hhaW4oZWRpdG9yLCBvblNoaWZ0Rm9jdXMpO1xyXG4gIC8vIEdyZW56dCBkaWUgU2hvcnRjdXQtUmVnZWxuIGluIHN0eWxlcy5jc3MgYXVmIGRpZXNlbiBFZGl0b3IgZWluLlxyXG4gIGVkaXRvci5jb250YWluZXJFbC5hZGRDbGFzcyhFRElUT1JfQ0xBU1MpO1xyXG4gIGNvbnRhaW5lckVsLmFwcGVuZENoaWxkKGVkaXRvci5jb250YWluZXJFbCk7XHJcbiAgdmlldy5hZGRDaGlsZChlZGl0b3IpO1xyXG5cclxuICBjb25zdCBkZWZhdWx0cyA9IHN0b3JlLmdldEZyb250bWF0dGVyKCk7XHJcbiAgY29uc3QgaGFkVHlwID0gT2JqZWN0LmtleXMoZGVmYXVsdHMpLnNvbWUoKGtleSkgPT4gU1lTVEVNX1BST1BFUlRJRVMuaW5jbHVkZXMoa2V5LnRyaW0oKS50b0xvd2VyQ2FzZSgpKSk7XHJcbiAgc3RyaXBUeXBQcm9wZXJ0eShkZWZhdWx0cyk7XHJcbiAgLy8gRWluIGJlaW0gTGFkZW4gbm9jaCB2b3JoYW5kZW5lcyBUWVAgKHouIEIuIGF1cyBlaW5lciBcdTAwRTRsdGVyZW4gUGx1Z2luLVZlcnNpb24pXHJcbiAgLy8gZGF1ZXJoYWZ0IGVudGZlcm5lbiwgc3RhdHQgZXMgbnVyIGZcdTAwRkNyIGRpZXNlIFNlc3Npb24genUgdmVyc3RlY2tlbi5cclxuICBpZiAoaGFkVHlwKSB2aWV3LnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICBlZGl0b3Iuc3luY2hyb25pemUoZGVmYXVsdHMpO1xyXG4gIHJlbmRlclNob3J0Y3V0Q29udHJvbHModmlldywgZWRpdG9yLCBzdG9yZSk7XHJcbiAgLy8gRXJzdCBuYWNoIGRlbSBlcnN0ZW4gc3luY2hyb25pemUoKSB2ZXJzdWNodCAoc2llaGUgZ2V0UHJvcGVydHlSb3dDbGFzcykgLVxyXG4gIC8vIGJlaSBlaW5lbSBub2NoIGdhbnogbGVlcmVuIFR5cCBoaWVyIGVpbiBOby1PcCwgaG9sdCBzaWNoIGFiZXIgc3BcdTAwRTR0ZXN0ZW5zXHJcbiAgLy8gYmVpbSBuXHUwMEU0Y2hzdGVuIE1vdW50ZW4gZWluZXMgbmljaHQtbGVlcmVuIFR5cHMgKG9kZXIgYXVzIGVpbmVyIG9mZmVuZW5cclxuICAvLyBOb3RpeikgZGllIGJlblx1MDBGNnRpZ3RlIEtsYXNzZW5yZWZlcmVueiBhdXRvbWF0aXNjaCBuYWNoLlxyXG4gIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoKGFwcCwgZWRpdG9yKTtcclxuICByZXR1cm4gZWRpdG9yO1xyXG59XHJcblxyXG5jb25zdCBDSElQX0NMQVNTID0gXCJmcmVkLXR5cC1zaG9ydGN1dC1jaGlwXCI7XHJcbmNvbnN0IENISVBfVEVYVF9DTEFTUyA9IFwiZnJlZC10eXAtc2hvcnRjdXQtY2hpcC10ZXh0XCI7XHJcbmNvbnN0IEJVVFRPTl9DTEFTUyA9IFwiZnJlZC10eXAtc2hvcnRjdXQtYnV0dG9uXCI7XHJcbmNvbnN0IFJPV19DTEFTUyA9IFwiZnJlZC10eXAtaGFzLXNob3J0Y3V0XCI7XHJcbmNvbnN0IFdBUk5JTkdfQ0xBU1MgPSBcImZyZWQtdHlwLXNob3J0Y3V0LWJsb2NrZWRcIjtcclxuXHJcbi8vIEtub3BmIHVuZCBDaGlwIGplIFByb3BlcnR5LVplaWxlLiBCZWlkZSBoXHUwMEU0bmdlbiBhbSBjb250YWluZXJFbCBkZXIgWmVpbGUsIE5JQ0hUXHJcbi8vIGFuIGRlcmVuIHZhbHVlRWw6IE9ic2lkaWFucyByZW5kZXJQcm9wZXJ0eSgpIGxlZXJ0IGJlaSBqZWRlbSBOZXUtUmVuZGVybiBudXJcclxuLy8gZGFzIHZhbHVlRWwsIGRhcyBjb250YWluZXJFbCBkYWdlZ2VuIG5pZSAtIHdhcyBoaWVyIGVpbm1hbCBhbmdlaFx1MDBFNG5ndCB3dXJkZSxcclxuLy8gXHUwMEZDYmVybGVidCBhbHNvIGplZGVuIFR5cC0vV2VydHdlY2hzZWwgdm9uIHNlbGJzdCwgb2huZSBFaW5ncmlmZiBpbiBPYnNpZGlhbnNcclxuLy8gUmVuZGVyLVBpcGVsaW5lLlxyXG4vL1xyXG4vLyBEZXIgS25vcGYgaXN0IGVpbiBVbXNjaGFsdGVyOiBiZWkgZWluZXIgWmVpbGUgb2huZSBTaG9ydGN1dCBcdTAwRjZmZm5ldCBlciBkaWVcclxuLy8gQXVzd2FobCwgYmVpIGVpbmVyIFplaWxlIG1pdCBTaG9ydGN1dCBlbnRmZXJudCBlciBpaG4gd2llZGVyLiBadW0gV0VDSFNFTE5cclxuLy8gZGllbnQgZGVyIENoaXAgc2VsYnN0LiBTaWNodGJhciB3aXJkIGRlciBLbm9wZiBwZXIgQ1NTIG51ciBiZWkgSG92ZXIvRm9rdXNcclxuLy8gZGVyIFplaWxlICh1bmQgZGF1ZXJoYWZ0LCBzb2xhbmdlIGVpbiBTaG9ydGN1dCBnZXNldHp0IGlzdCkgLSBzb25zdCBzdFx1MDBGQ25kZSBpblxyXG4vLyBqZWRlciBaZWlsZSBkYXVlcmhhZnQgZWluIEJlZGllbmVsZW1lbnQsIGRhcyBkaWUgbWVpc3RlbiBuaWUgYnJhdWNoZW4uXHJcbi8vXHJcbi8vIERhcyBBdXNibGVuZGVuIGRlcyBXZXJ0ZmVsZHMgYmVpIGdlc2V0enRlbSBTaG9ydGN1dCBtYWNodCBhbGxlaW4gQ1NTIChzaWVoZVxyXG4vLyBST1dfQ0xBU1MgaW4gc3R5bGVzLmNzcykuIERhcyBuYXRpdmUgV2lkZ2V0IHJlbmRlcnQgZGFydW50ZXIgdW52ZXJcdTAwRTRuZGVydFxyXG4vLyB3ZWl0ZXIgLSBTZXR6ZW4gdW5kIEVudGZlcm5lbiBzaW5kIGRlc2hhbGIgZWluIHJlaW5lciBLbGFzc2VuLVVtc2NoYWx0ZXIgdW5kXHJcbi8vIGJyYXVjaGVuIGtlaW4gcmVuZGVyUHJvcGVydHkoKS9zeW5jaHJvbml6ZSgpLCB3YXMgaGllciBvaG5laGluIGhlaWtlbCB3XHUwMEU0cmVcclxuLy8gKHNpZWhlIEtvbW1lbnRhciBhbiBzdHJpcFR5cFByb3BlcnR5KS5cclxuZnVuY3Rpb24gcmVuZGVyU2hvcnRjdXRDb250cm9scyh2aWV3LCBlZGl0b3IsIHN0b3JlKSB7XHJcbiAgY29uc3Qgc2hvcnRjdXRzID0gc3RvcmUuZ2V0U2hvcnRjdXRzKCk7XHJcbiAgZm9yIChjb25zdCByb3cgb2YgZWRpdG9yLnJlbmRlcmVkID8/IFtdKSB7XHJcbiAgICBjb25zdCBjb250YWluZXJFbCA9IHJvdy5jb250YWluZXJFbDtcclxuICAgIGNvbnN0IGtleSA9IHJvdy5lbnRyeT8ua2V5ID8/IFwiXCI7XHJcbiAgICAvLyBFaW5lIG5vY2ggbmFtZW5sb3NlIFplaWxlIGthbm4ga2VpbmVuIFNob3J0Y3V0IHRyYWdlbiAtIGVzIGdcdTAwRTRiZSBrZWluZW5cclxuICAgIC8vIFNjaGxcdTAwRkNzc2VsLCB1bnRlciBkZW0gZXIgc3RcdTAwRkNuZGUuIERlciBLbm9wZiBlcnNjaGVpbnQsIHNvYmFsZCBlaW4gTmFtZVxyXG4gICAgLy8gZWluZ2V0cmFnZW4gaXN0IChqZWRlIFx1MDBDNG5kZXJ1bmcgbFx1MDBFNHVmdCBkdXJjaCBzYXZlRnJvbnRtYXR0ZXIgdW5kIGRhbWl0XHJcbiAgICAvLyBlcm5ldXQgaGllciBkdXJjaCkuXHJcbiAgICBjb25zdCByZWNvcmQgPSBrZXkgPT09IFwiXCIgPyBudWxsIDogc2hvcnRjdXRzW2tleV0gPz8gbnVsbDtcclxuICAgIGNvbnRhaW5lckVsLnRvZ2dsZUNsYXNzKFJPV19DTEFTUywgISFyZWNvcmQpO1xyXG5cclxuICAgIC8vIE9ic2lkaWFucyBXYXJuZHJlaWVjayBzaXR6dCBuaWNodCBpbSBGbGV4LUZsdXNzIGRlciBaZWlsZSwgc29uZGVybiBpc3RcclxuICAgIC8vIGFic29sdXQgYW4gZGVyZW4gcmVjaHRlbSBSYW5kIHZlcmFua2VydCAocG9zaXRpb246IGFic29sdXRlLFxyXG4gICAgLy8gaW5zZXQtaW5saW5lLWVuZC90b3AvYm90dG9tOiB2YXIoLS1zaXplLTItMSkpIC0gYWxzbyBnZW5hdSBkb3J0LCB3byBhdWNoXHJcbiAgICAvLyBkZXIgU2hvcnRjdXQtS25vcGYgc2l0enQuIEJlaWRlIGdsZWljaHplaXRpZyBoaWVcdTAwREZlOiBcdTAwRkNiZXJlaW5hbmRlci4gWmVpZ3RcclxuICAgIC8vIGRpZSBaZWlsZSBlaW5lIFR5cC1XYXJudW5nIHVuZCBpc3QgS0VJTiBTaG9ydGN1dCBnZXNldHp0LCB3ZWljaHQgZGVyXHJcbiAgICAvLyBLbm9wZi4gQmVpIGdlc2V0enRlbSBTaG9ydGN1dCBibGVpYnQgZXIgZGFnZWdlbiBzdGVoZW4gLSBlciBpc3QgZGVyXHJcbiAgICAvLyBlaW56aWdlIFdlZywgZGVuIFNob3J0Y3V0IHdpZWRlciBsb3N6dXdlcmRlbiAtLCB1bmQgc3RhdHRkZXNzZW4gd2VpY2h0XHJcbiAgICAvLyBkYXMgV2FybmRyZWllY2sgKHNpZWhlIHN0eWxlcy5jc3MpOiBlcyBiZXppZWh0IHNpY2ggZGFubiBhdWYgZGVuXHJcbiAgICAvLyBhdXNnZWJsZW5kZXRlbiBSXHUwMEZDY2tmYWxsd2VydCwgaXN0IGRvcnQgYWxzbyBnYXIgbmljaHQgenUgYmVoZWJlbi5cclxuICAgIGNvbnN0IG1pc21hdGNoID0gISFyb3cudHlwZUluZm8gJiYgcm93LnR5cGVJbmZvLmV4cGVjdGVkICE9PSByb3cudHlwZUluZm8uaW5mZXJyZWQ7XHJcbiAgICBjb250YWluZXJFbC50b2dnbGVDbGFzcyhXQVJOSU5HX0NMQVNTLCBtaXNtYXRjaCAmJiAhcmVjb3JkKTtcclxuXHJcbiAgICBsZXQgYnV0dG9uRWwgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKGA6c2NvcGUgPiAuJHtCVVRUT05fQ0xBU1N9YCk7XHJcbiAgICBpZiAoa2V5ID09PSBcIlwiKSB7XHJcbiAgICAgIGJ1dHRvbkVsPy5yZW1vdmUoKTtcclxuICAgICAgY29udGFpbmVyRWwucXVlcnlTZWxlY3RvcihgOnNjb3BlID4gLiR7Q0hJUF9DTEFTU31gKT8ucmVtb3ZlKCk7XHJcbiAgICAgIGNvbnRpbnVlO1xyXG4gICAgfVxyXG4gICAgaWYgKCFidXR0b25FbCkge1xyXG4gICAgICBidXR0b25FbCA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogYGNsaWNrYWJsZS1pY29uICR7QlVUVE9OX0NMQVNTfWAgfSk7XHJcbiAgICAgIHNldEljb24oYnV0dG9uRWwsIFwic3F1YXJlLWZ1bmN0aW9uXCIpO1xyXG4gICAgICAvLyBEZW4gS2V5IGVyc3QgYmVpbSBLbGljayBhdXMgZGVyIFplaWxlIGxlc2VuLCBuaWNodCBoaWVyIGVpbmZhbmdlbiAtXHJcbiAgICAgIC8vIGVpbmUgVW1iZW5lbm51bmcgXHUwMEU0bmRlcnQgcm93LmVudHJ5LmtleSwgb2huZSBkaWUgWmVpbGUgbmV1IGFuenVsZWdlbi5cclxuICAgICAgYnV0dG9uRWwuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgICBpZiAoc3RvcmUuZ2V0U2hvcnRjdXRzKClbcm93LmVudHJ5Py5rZXkgPz8gXCJcIl0pIHJlbW92ZVNob3J0Y3V0KHZpZXcsIGVkaXRvciwgc3RvcmUsIHJvdyk7XHJcbiAgICAgICAgZWxzZSBvcGVuU2hvcnRjdXRQaWNrZXIodmlldywgZWRpdG9yLCBzdG9yZSwgcm93KTtcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICBidXR0b25FbC5zZXRBdHRyKFwiYXJpYS1sYWJlbFwiLCByZWNvcmQgPyBcIlNob3J0Y3V0IGVudGZlcm5lblwiIDogXCJTaG9ydGN1dCBzZXR6ZW5cIik7XHJcblxyXG4gICAgbGV0IGNoaXBFbCA9IGNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3IoYDpzY29wZSA+IC4ke0NISVBfQ0xBU1N9YCk7XHJcbiAgICBpZiAoIXJlY29yZCkge1xyXG4gICAgICBjaGlwRWw/LnJlbW92ZSgpO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuICAgIGlmICghY2hpcEVsKSB7XHJcbiAgICAgIGNoaXBFbCA9IGNyZWF0ZUVsKFwiY29kZVwiLCB7IGNsczogQ0hJUF9DTEFTUyB9KTtcclxuICAgICAgLy8gRGVyIFRleHQgc3RlY2t0IGluIGVpbmVtIGVpZ2VuZW4gU3Bhbiwgd2VpbCBkZXIgQ2hpcCBzZWxic3QgZWluXHJcbiAgICAgIC8vIEZsZXgtQ29udGFpbmVyIGlzdCAodmVydGlrYWxlIFplbnRyaWVydW5nIHdpZSBiZWltIGVjaHRlbiBXZXJ0ZmVsZCkgLVxyXG4gICAgICAvLyB0ZXh0LW92ZXJmbG93OiBlbGxpcHNpcyBncmVpZnQgYWJlciBudXIgYXVmIGVpbmVtIEJsb2NrLUVsZW1lbnQsIG5pY2h0XHJcbiAgICAgIC8vIGF1ZiBkZW0gRmxleC1Db250YWluZXIgZGFyXHUwMEZDYmVyLlxyXG4gICAgICBjaGlwRWwuY3JlYXRlU3Bhbih7IGNsczogQ0hJUF9URVhUX0NMQVNTIH0pO1xyXG4gICAgICBjaGlwRWwuc2V0QXR0cihcImFyaWEtbGFiZWxcIiwgXCJTaG9ydGN1dCBcdTAwRTRuZGVyblwiKTtcclxuICAgICAgY2hpcEVsLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiBvcGVuU2hvcnRjdXRQaWNrZXIodmlldywgZWRpdG9yLCBzdG9yZSwgcm93KSk7XHJcbiAgICAgIC8vIFZvciBkZW0gS25vcGYgZWluaFx1MDBFNG5nZW4sIGRhbWl0IGRpZSBaZWlsZSB1bmFiaFx1MDBFNG5naWcgdm9uIGRlclxyXG4gICAgICAvLyBFbnRzdGVodW5nc3JlaWhlbmZvbGdlIGltbWVyIFwiTmFtZSB8IENoaXAgfCBLbm9wZlwiIGxpZXN0LlxyXG4gICAgICBjb250YWluZXJFbC5pbnNlcnRCZWZvcmUoY2hpcEVsLCBidXR0b25FbCk7XHJcbiAgICB9XHJcbiAgICBjaGlwRWwuZmlyc3RFbGVtZW50Q2hpbGQuc2V0VGV4dChzaG9ydGN1dExhYmVsKHJlY29yZCkpO1xyXG4gIH1cclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gb3BlblNob3J0Y3V0UGlja2VyKHZpZXcsIGVkaXRvciwgc3RvcmUsIHJvdykge1xyXG4gIGNvbnN0IGtleSA9IHJvdy5lbnRyeT8ua2V5ID8/IFwiXCI7XHJcbiAgaWYgKGtleSA9PT0gXCJcIikgcmV0dXJuO1xyXG4gIC8vIERlbiBiaXNoZXJpZ2VuIFJlY29yZCBtaXRnZWJlbjogd2lyZCBkYXNzZWxiZSBTa3JpcHQgZXJuZXV0IGdld1x1MDBFNGhsdCwga29tbXRcclxuICAvLyBkZXIgQXJndW1lbnQtRGlhbG9nIG1pdCBkZW4gYWt0dWVsbGVuIFdlcnRlbiB2b3JiZWxlZ3QgLSBzbyBpc3QgZGVyIEtsaWNrXHJcbiAgLy8gYXVmIGRlbiBDaGlwIGF1Y2ggZGVyIFdlZywgZWluemVsbmUgQXJndW1lbnRlIHp1IGtvcnJpZ2llcmVuLlxyXG4gIGNvbnN0IHJlY29yZCA9IGF3YWl0IHBpY2tTaG9ydGN1dCh2aWV3LmFwcCwga2V5LCB2aWV3LnBsdWdpbi5nZXRTaG9ydGN1dFNjcmlwdHMsIHN0b3JlLmdldFNob3J0Y3V0cygpW2tleV0gPz8gbnVsbCk7XHJcbiAgaWYgKCFyZWNvcmQpIHJldHVybjtcclxuICAvLyBXXHUwMEU0aHJlbmQgZGVyIERpYWxvZyBvZmZlbiB3YXIsIGthbm4gZGllIFByb3BlcnR5IHZlcnNjaHd1bmRlbiBzZWluIChldHdhXHJcbiAgLy8gd2VpbCBkaWUgQW5zaWNodCB6d2lzY2hlbnplaXRsaWNoIG5ldSBhdWZnZWJhdXQgd3VyZGUpLiBPaG5lIGRpZXNlIFByXHUwMEZDZnVuZ1xyXG4gIC8vIGJsaWViZSBkZXIgU2hvcnRjdXQgYWxzIFdhaXNlIGluIGRlbiBFaW5zdGVsbHVuZ2VuIHN0ZWhlbjogc2F2ZUZyb250bWF0dGVyXHJcbiAgLy8gemllaHQgbnVyIEtleXMgbmFjaCwgZGllIGluIGRlcnNlbGJlbiBCZWFyYmVpdHVuZyBlbnRmZXJudCB3dXJkZW4sIHVuZFxyXG4gIC8vIGNvbGxlY3RCbG9ja3MgbFx1MDBFNHVmdCBvaG5laGluIG51ciBcdTAwRkNiZXIgdm9yaGFuZGVuZSBGcm9udG1hdHRlci1LZXlzIC0gZGVyXHJcbiAgLy8gRWludHJhZyB3XHUwMEU0cmUgYWxzbyB1bnNpY2h0YmFyIHVuZCB3XHUwMEZDcmRlIG5pZSB3aWVkZXIgYXVmZ2VyXHUwMEU0dW10LlxyXG4gIGlmICghT2JqZWN0Lmhhc093bihzdG9yZS5nZXRGcm9udG1hdHRlcigpLCBrZXkpKSByZXR1cm47XHJcbiAgc3RvcmUuc2V0U2hvcnRjdXRzKHsgLi4uc3RvcmUuZ2V0U2hvcnRjdXRzKCksIFtrZXldOiByZWNvcmQgfSk7XHJcbiAgc2F2ZVNob3J0Y3V0cyh2aWV3LCBlZGl0b3IsIHN0b3JlKTtcclxufVxyXG5cclxuZnVuY3Rpb24gcmVtb3ZlU2hvcnRjdXQodmlldywgZWRpdG9yLCBzdG9yZSwgcm93KSB7XHJcbiAgY29uc3Qga2V5ID0gcm93LmVudHJ5Py5rZXkgPz8gXCJcIjtcclxuICBjb25zdCBzaG9ydGN1dHMgPSB7IC4uLnN0b3JlLmdldFNob3J0Y3V0cygpIH07XHJcbiAgaWYgKCEoa2V5IGluIHNob3J0Y3V0cykpIHJldHVybjtcclxuICBkZWxldGUgc2hvcnRjdXRzW2tleV07XHJcbiAgc3RvcmUuc2V0U2hvcnRjdXRzKHNob3J0Y3V0cyk7XHJcbiAgc2F2ZVNob3J0Y3V0cyh2aWV3LCBlZGl0b3IsIHN0b3JlKTtcclxufVxyXG5cclxuZnVuY3Rpb24gc2F2ZVNob3J0Y3V0cyh2aWV3LCBlZGl0b3IsIHN0b3JlKSB7XHJcbiAgdmlldy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgcmVuZGVyU2hvcnRjdXRDb250cm9scyh2aWV3LCBlZGl0b3IsIHN0b3JlKTtcclxufVxyXG5cclxuLy8gRWlnZW5lLCBlaW5mYWNoZSBcIlByb3BlcnR5IGhpbnp1Zlx1MDBGQ2dlblwiLUZ1bmt0aW9uIHN0YXR0IGRlcyBpbnRlcm5lblxyXG4vLyBlZGl0b3IuYWRkUHJvcGVydHkoKTogZlx1MDBGQ2d0IGVpbmVuIGxlZXJlbiBLZXkgbWl0IFdlcnQgbnVsbCBhbiB1bmQgbFx1MDBFNHNzdCBkYXNcclxuLy8gV2lkZ2V0IGRpZSBaZWlsZSBnYW56IG5vcm1hbCByZW5kZXJuIChkaWVzZWxiZSBPcHRpayB3aWUgaW4gZWluZXIgZWNodGVuXHJcbi8vIE5vdGl6LCBkYSBzeW5jaHJvbml6ZSgpIHVudmVyXHUwMEU0bmRlcnQgT2JzaWRpYW5zIGVpZ2VuZSBSZW5kZXItUGlwZWxpbmVcclxuLy8gZHVyY2hsXHUwMEU0dWZ0KSAtIGRlciBGb2t1cyBzcHJpbmd0IGFuc2NobGllXHUwMERGZW5kIGlucyBLZXktRmVsZCBkZXIgbmV1ZW4gWmVpbGUuXHJcbmZ1bmN0aW9uIGFkZEJsYW5rUHJvcGVydHkoZWRpdG9yKSB7XHJcbiAgaWYgKCFlZGl0b3IpIHJldHVybjtcclxuICBjb25zdCBjdXJyZW50ID0gZWRpdG9yLnNlcmlhbGl6ZSgpO1xyXG4gIGlmICghY3VycmVudC5oYXNPd25Qcm9wZXJ0eShcIlwiKSkge1xyXG4gICAgY3VycmVudFtcIlwiXSA9IG51bGw7XHJcbiAgICBlZGl0b3Iuc3luY2hyb25pemUoY3VycmVudCk7XHJcbiAgICAvLyBzeW5jaHJvbml6ZSgpIGxlZ3QgZGllIG5ldWUgWmVpbGUgYW4gLSBkaWUgYmVzdGVoZW5kZW4gWmVpbGVuIGJlaGFsdGVuXHJcbiAgICAvLyBkYWJlaSB6d2FyIGlocmVuIEtub3BmIChlciBoXHUwMEU0bmd0IGFtIGNvbnRhaW5lckVsLCBzaWVoZVxyXG4gICAgLy8gcmVuZGVyU2hvcnRjdXRDb250cm9scyksIGRpZSBuZXVlIGhhdCBhYmVyIG5vY2gga2VpbmVuLlxyXG4gICAgcmVuZGVyU2hvcnRjdXRDb250cm9scyhlZGl0b3Iub3duZXIuZnJlZFZpZXcsIGVkaXRvciwgZWRpdG9yLm93bmVyLmZyZWRTdG9yZSk7XHJcbiAgfVxyXG4gIGVkaXRvci5mb2N1c0tleShcIlwiKTtcclxuICAvLyBEZWNrdCBkZW4gRmFsbCBhYiwgZGFzcyBtb3VudEZyb250bWF0dGVyRWRpdG9yKCkgYmVpIGVpbmVtIHp1IGRpZXNlbVxyXG4gIC8vIFplaXRwdW5rdCBub2NoIGdhbnogbGVlcmVuIFR5cCAodW5kIG9obmUgb2ZmZW5lIE5vdGl6KSBrZWluZSBaZWlsZW4tS2xhc3NlXHJcbiAgLy8genVtIFBhdGNoZW4gZmluZGVuIGtvbm50ZSAtIGpldHp0IGV4aXN0aWVydCBtaXQgZGVyIGdlcmFkZSBhbmdlbGVndGVuXHJcbiAgLy8gWmVpbGUgZ2FyYW50aWVydCBtaW5kZXN0ZW5zIGVpbmUuXHJcbiAgZW5zdXJlUHJvcGVydHlNZW51UGF0Y2goZWRpdG9yLm93bmVyLmFwcCwgZWRpdG9yKTtcclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSB7IG1vdW50RnJvbnRtYXR0ZXJFZGl0b3IsIGFkZEJsYW5rUHJvcGVydHksIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoLCB0eXBlU3RvcmUsIHN1YnR5cGVTdG9yZSB9O1xyXG4iLCAiY29uc3QgeyBtb3VudEZyb250bWF0dGVyRWRpdG9yLCBhZGRCbGFua1Byb3BlcnR5LCB0eXBlU3RvcmUsIHN1YnR5cGVTdG9yZSB9ID0gcmVxdWlyZShcIi4vdHlwZS1mcm9udG1hdHRlci1lZGl0b3JcIik7XHJcbmNvbnN0IHsgZ2V0U2VjdGlvbk9yZGVyLCBpc0VtcHR5VmFsdWUgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cGVzXCIpO1xyXG5cclxuLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbiAqIERpZSBGcm9udG1hdHRlci1CbFx1MDBGNmNrZSBlaW5lcyBUWVBzIGluIGRlciBUWVAtRGV0YWlsYW5zaWNodCAoc2llaGVcclxuICogcmVuZGVyVHlwZVNldHRpbmdzIGluIHR5cC12aWV3LmpzKTogenVvYmVyc3QgZGFzIFRZUC1Gcm9udG1hdHRlciwgZGFydW50ZXJcclxuICogamUgcmVnaXN0cmllcnRlbSBTdWJ0eXAgZWluIGVpZ2VuZXIgQmxvY2suXHJcbiAqXHJcbiAqIEplIEJsb2NrIGVpbmUgZWlnZW5lIEluc3Rhbnogdm9uIE9ic2lkaWFucyBQcm9wZXJ0eS1FZGl0b3IsIGdlYnVuZGVuIGFuXHJcbiAqIHR5cGVTdG9yZSBiencuIHN1YnR5cGVTdG9yZSAoc2llaGUgdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpLiBEYWR1cmNoXHJcbiAqIGRhcmYgZGVyc2VsYmUgS2V5IGluIG1laHJlcmVuIEJsXHUwMEY2Y2tlbiBzdGVoZW4gLSBpbm5lcmhhbGIgZWluZXMgQmxvY2tzIGlzdFxyXG4gKiBlciBkdXJjaCBkYXMgRnJvbnRtYXR0ZXItT2JqZWt0IHNlbGJzdCB6d2FuZ3NsXHUwMEU0dWZpZyBlaW5kZXV0aWcsIGRhclx1MDBGQ2JlclxyXG4gKiBoaW5hdXMgbmljaHQgKHNpZWhlIEtvbW1lbnRhciBhbiB0eXBlU3VidHlwZXMgaW4gc3VidHlwZXMuanMpLlxyXG4gKlxyXG4gKiBPYnNpZGlhbnMgZWlnZW5lcyBaZWlsZW4tRHJhZyByZWljaHQgbnVyIGlubmVyaGFsYiBlaW5lciBJbnN0YW56LiBEYW1pdFxyXG4gKiBlaW5lIFByb3BlcnR5IHRyb3R6ZGVtIHZvbiBCbG9jayB6dSBCbG9jayB3YW5kZXJuIGthbm4sIHNldHp0XHJcbiAqIHJlZ2lzdGVyUHJvcGVydHlEcmFnKCkgdW50ZW4gYXVmIGdlbmF1IGRpZXNlbSBEcmFnIGF1Ziwgc3RhdHQgZWluIGVpZ2VuZXNcclxuICogenUgYmF1ZW4uIERpZSBUYXN0YXR1ci1OYXZpZ2F0aW9uIFx1MDBGQ2JlciBhbGxlIEJsXHUwMEY2Y2tlIHN0ZWNrdCBpblxyXG4gKiByZWdpc3RlckZvY3VzQ2hhaW4oKSAodHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpLlxyXG4gKlxyXG4gKiBTZWN0aW9uOiBudWxsID0gVFlQLUZyb250bWF0dGVyLCBzb25zdCBkZXIgU3VidHlwLU5hbWUuXHJcbiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqL1xyXG5cclxuLy8gQW5mYXNzYmFyIGZcdTAwRkNyIGRhcyBWZXJzY2hpZWJlbiBlaW5lcyBnYW56ZW4gQmxvY2tzIGlzdCBhbGxlcyBhdVx1MDBERmVyaGFsYiBkZXJcclxuLy8gUHJvcGVydHktWmVpbGVuIC0gXHUwMERDYmVyc2NocmlmdCwgQWJzY2hsdXNzIHVuZCBkaWUgc2VpdGxpY2hlbiBSXHUwMEU0bmRlci5cclxuLy8gQmVkaWVuZWxlbWVudGUgdW5kIGVpbiBnZXJhZGUgYmVhcmJlaXRldGVyIFRpdGVsIGJsZWliZW4gYXVzZ2Vub21tZW4uXHJcbmZ1bmN0aW9uIGlzR3JhYlRhcmdldCh0YXJnZXQpIHtcclxuICBpZiAodGFyZ2V0LmNsb3Nlc3QoXCIuY2xpY2thYmxlLWljb24sIC5mcmVkLXR5cC1zdWJ0eXBlLWNvbG9yLWRvdCwgW2NvbnRlbnRlZGl0YWJsZT0ndHJ1ZSddLCBpbnB1dCwgdGV4dGFyZWFcIikpIHJldHVybiBmYWxzZTtcclxuICByZXR1cm4gIXRhcmdldC5jbG9zZXN0KFwiLm1ldGFkYXRhLXByb3BlcnR5XCIpO1xyXG59XHJcblxyXG4vLyByZW5kZXJIZWFkZXIoc2VjdGlvbiwgZWwsIGJsb2NrcykgLyByZW5kZXJGb290ZXIoc2VjdGlvbiwgZWwsIGJsb2NrcykgZlx1MDBGQ2xsZW5cclxuLy8gXHUwMERDYmVyc2NocmlmdCBiencuIEFic2NobHVzcyBlaW5lcyBCbG9ja3MuIG9uTW92ZVNlY3Rpb24ob3JkZXIpIG1lbGRldCBkaWVcclxuLy8gbmV1ZSBCbG9jay1SZWloZW5mb2xnZSBuYWNoIGVpbmVtIEJsb2NrLURyYWcgKHdpZSBnZXRTZWN0aW9uT3JkZXIsIHNhbXRcclxuLy8gZlx1MDBGQ2hyZW5kZW0gbnVsbCBmXHUwMEZDciBkYXMgVFlQLUZyb250bWF0dGVyKSwgb25TZWN0aW9uQ29udGV4dE1lbnUoc2VjdGlvbixcclxuLy8gZXZlbnQpIGVpbmVuIFJlY2h0c2tsaWNrIGluIGVpbmVtIFN1YnR5cC1CbG9jay5cclxuZnVuY3Rpb24gbW91bnRGcm9udG1hdHRlckJsb2Nrcyh2aWV3LCBjb250YWluZXJFbCwgdHlwZSwgeyByZW5kZXJIZWFkZXIsIHJlbmRlckZvb3Rlciwgb25Nb3ZlU2VjdGlvbiwgb25TZWN0aW9uQ29udGV4dE1lbnUgfSkge1xyXG4gIGNvbnN0IHdyYXBwZXIgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtYmxvY2tzXCIgfSk7XHJcbiAgY29uc3Qgc2VjdGlvbnMgPSBnZXRTZWN0aW9uT3JkZXIodmlldy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUpO1xyXG4gIGNvbnN0IGVkaXRvcnMgPSBuZXcgTWFwKCk7XHJcbiAgY29uc3QgYmxvY2tFbHMgPSBuZXcgTWFwKCk7XHJcbiAgY29uc3Qgc3RvcmVzID0gbmV3IE1hcCgpO1xyXG5cclxuICBjb25zdCBhcGkgPSB7XHJcbiAgICAvLyBBbGxlIEVkaXRvci1JbnN0YW56ZW4gaW4gQmxvY2stUmVpaGVuZm9sZ2UgLSB0eXAtdmlldy5qcyBoXHUwMEU0bmd0IHNpZSBhbHNcclxuICAgIC8vIENvbXBvbmVudC1DaGlsZHJlbiBlaW4gdW5kIGJhdXQgc2llIHZvciBqZWRlbSBOZXVhdWZiYXUgd2llZGVyIGFiLlxyXG4gICAgZWRpdG9yczogW10sXHJcbiAgICAvLyBMZWVyemVpbGUgYW0gRW5kZSBkZXMgZ2V3XHUwMEZDbnNjaHRlbiBCbG9ja3MgYW5sZWdlbiwgbWl0IGRlbSBGb2t1cyBpbVxyXG4gICAgLy8gS2V5LUZlbGQgKHNpZWhlIGFkZEJsYW5rUHJvcGVydHkgaW4gdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpLlxyXG4gICAgLy8gZmxvYXRpbmcgbWFya2llcnQgZGllIGFscyBuXHUwMEU0Y2hzdGVzIGJlbmFubnRlIFByb3BlcnR5IGFscyBGbG9hdGluZy5cclxuICAgIGFkZEJsYW5rKHNlY3Rpb24sIGZsb2F0aW5nID0gZmFsc2UpIHtcclxuICAgICAgY29uc3QgZWRpdG9yID0gZWRpdG9ycy5nZXQoc2VjdGlvbik7XHJcbiAgICAgIGlmICghZWRpdG9yKSByZXR1cm47XHJcbiAgICAgIGVkaXRvci5mcmVkUGVuZGluZ0Zsb2F0aW5nQWRkID0gZmxvYXRpbmc7XHJcbiAgICAgIGFkZEJsYW5rUHJvcGVydHkoZWRpdG9yKTtcclxuICAgIH0sXHJcbiAgfTtcclxuXHJcbiAgLy8gTmFjaGJhcmJsb2NrIGluIFJpY2h0dW5nIHN0ZXAsIGRlciBcdTAwRkNiZXJoYXVwdCBlaW5lIFplaWxlIHp1bSBBbnNwcmluZ2VuXHJcbiAgLy8gaGF0IC0gbGVlcmUgQmxcdTAwRjZja2Ugd2VyZGVuIFx1MDBGQ2JlcnNwcnVuZ2VuLlxyXG4gIGNvbnN0IGZvY3VzTmVpZ2hib3IgPSAoc2VjdGlvbiwgc3RlcCkgPT4ge1xyXG4gICAgZm9yIChsZXQgaSA9IHNlY3Rpb25zLmluZGV4T2Yoc2VjdGlvbikgKyBzdGVwOyBpID49IDAgJiYgaSA8IHNlY3Rpb25zLmxlbmd0aDsgaSArPSBzdGVwKSB7XHJcbiAgICAgIGNvbnN0IGVkaXRvciA9IGVkaXRvcnMuZ2V0KHNlY3Rpb25zW2ldKTtcclxuICAgICAgaWYgKCFlZGl0b3IgfHwgZWRpdG9yLnJlbmRlcmVkLmxlbmd0aCA9PT0gMCkgY29udGludWU7XHJcbiAgICAgIGVkaXRvci5mb2N1c1Byb3BlcnR5QXRJbmRleChzdGVwID4gMCA/IDAgOiAtMSk7XHJcbiAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG4gIH07XHJcblxyXG4gIGZvciAoY29uc3Qgc2VjdGlvbiBvZiBzZWN0aW9ucykge1xyXG4gICAgY29uc3QgaXNTdWIgPSBzZWN0aW9uICE9PSBudWxsO1xyXG4gICAgY29uc3QgYmxvY2tFbCA9IHdyYXBwZXIuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcImZyZWQtdHlwLWJsb2NrXCIgKyAoaXNTdWIgPyBcIiBmcmVkLXR5cC1mcm9udG1hdHRlci1ibG9jayBmcmVkLXR5cC1zdWJ0eXBlLWJsb2NrXCIgOiBcIlwiKSxcclxuICAgIH0pO1xyXG4gICAgYmxvY2tFbHMuc2V0KHNlY3Rpb24sIGJsb2NrRWwpO1xyXG4gICAgYmxvY2tFbC5mcmVkU2VjdGlvbiA9IHNlY3Rpb247XHJcblxyXG4gICAgY29uc3QgaGVhZGVyID0gYmxvY2tFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItaGVhZGVyIGZyZWQtdHlwLXNlY3Rpb24taGVhZGVyXCIgfSk7XHJcbiAgICBoZWFkZXIudG9nZ2xlQ2xhc3MoXCJmcmVkLXR5cC1zZWN0aW9uLXN1YlwiLCBpc1N1Yik7XHJcblxyXG4gICAgY29uc3Qgc3RvcmUgPSBzZWN0aW9uID09PSBudWxsID8gdHlwZVN0b3JlKHZpZXcucGx1Z2luLCB0eXBlKSA6IHN1YnR5cGVTdG9yZSh2aWV3LnBsdWdpbiwgdHlwZSwgc2VjdGlvbik7XHJcbiAgICBzdG9yZXMuc2V0KHNlY3Rpb24sIHN0b3JlKTtcclxuICAgIGNvbnN0IGVkaXRvciA9IG1vdW50RnJvbnRtYXR0ZXJFZGl0b3IodmlldywgYmxvY2tFbCwgc3RvcmUsIHtcclxuICAgICAgb25TaGlmdEZvY3VzOiAoc3RlcCkgPT4gZm9jdXNOZWlnaGJvcihzZWN0aW9uLCBzdGVwKSxcclxuICAgIH0pO1xyXG4gICAgaWYgKGVkaXRvcikge1xyXG4gICAgICBlZGl0b3JzLnNldChzZWN0aW9uLCBlZGl0b3IpO1xyXG4gICAgICBhcGkuZWRpdG9ycy5wdXNoKGVkaXRvcik7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgZm9vdGVyID0gYmxvY2tFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtc2VjdGlvbi1mb290ZXJcIiB9KTtcclxuICAgIGZvb3Rlci50b2dnbGVDbGFzcyhcImZyZWQtdHlwLXNlY3Rpb24tc3ViXCIsIGlzU3ViKTtcclxuICAgIHJlbmRlckhlYWRlcihzZWN0aW9uLCBoZWFkZXIsIGFwaSk7XHJcbiAgICByZW5kZXJGb290ZXI/LihzZWN0aW9uLCBmb290ZXIsIGFwaSk7XHJcblxyXG4gICAgaWYgKCFpc1N1YikgY29udGludWU7XHJcbiAgICAvLyBTdWJ0eXAtQmxcdTAwRjZja2UgcmVhZ2llcmVuIGF1ZiBpaHJlciBnYW56ZW4gRmxcdTAwRTRjaGU7IE9ic2lkaWFucyBlaWdlbmUgTWVuXHUwMEZDc1xyXG4gICAgLy8gKHouIEIuIGRhcyBlaW5lciBQcm9wZXJ0eSkgdW5kIFRleHRmZWxkZXIgaGFiZW4gVm9ycmFuZyAtIHNpZSByZWFnaWVyZW5cclxuICAgIC8vIHZvcmhlciB1bmQgc2V0emVuIGRlZmF1bHRQcmV2ZW50ZWQuXHJcbiAgICBibG9ja0VsLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcclxuICAgICAgaWYgKGV2ZW50LmRlZmF1bHRQcmV2ZW50ZWQgfHwgZXZlbnQudGFyZ2V0LmNsb3Nlc3QoXCJpbnB1dCwgdGV4dGFyZWEsIFtjb250ZW50ZWRpdGFibGU9J3RydWUnXVwiKSkgcmV0dXJuO1xyXG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICBvblNlY3Rpb25Db250ZXh0TWVudT8uKHNlY3Rpb24sIGV2ZW50KTtcclxuICAgIH0pO1xyXG4gICAgYmxvY2tFbC5hZGRFdmVudExpc3RlbmVyKFwibW91c2Vkb3duXCIsIChldmVudCkgPT4gc3RhcnRCbG9ja0RyYWcoZXZlbnQsIHNlY3Rpb24pKTtcclxuICB9XHJcblxyXG4gIC8vIEVpZ2VuZXMgTWF1cy1EcmFnIHN0YXR0IEhUTUw1LWRyYWdnYWJsZTogZWluIGRyYWdnYWJsZS1Wb3JmYWhyZSBzdFx1MDBGNnJ0ZSBkaWVcclxuICAvLyBUZXh0YXVzd2FobCBpbiBkZW4gRWluZ2FiZWZlbGRlcm4gZGVyIFplaWxlbi4gRGVyIERyYWcgYmVnaW5udCBlcnN0IG5hY2hcclxuICAvLyBlaW4gcGFhciBQaXhlbG4gQmV3ZWd1bmcsIGVpbiBTdHJpY2ggaW4gQWt6ZW50ZmFyYmUgemVpZ3QgZGllXHJcbiAgLy8gWmllbHBvc2l0aW9uIHp3aXNjaGVuIGRlbiBCbFx1MDBGNmNrZW4sIEVzY2FwZSBicmljaHQgYWIuIERhcyBUWVAtRnJvbnRtYXR0ZXJcclxuICAvLyBzdGVodCBmZXN0IGdhbnogb2JlbiAoc2llaGUgZ2V0U2VjdGlvbk9yZGVyIGluIHN1YnR5cGVzLmpzKSAtIFppZWxwb3NpdGlvblxyXG4gIC8vIDAgZ2lidCBlcyBkZXNoYWxiIG5pY2h0LCBkZXIgb2JlcnN0ZSBtXHUwMEY2Z2xpY2hlIFBsYXR6IGlzdCBkaXJla3QgZGFydW50ZXIuXHJcbiAgZnVuY3Rpb24gc3RhcnRCbG9ja0RyYWcoZXZlbnQsIHNlY3Rpb24pIHtcclxuICAgIGlmIChldmVudC5idXR0b24gIT09IDAgfHwgIWlzR3JhYlRhcmdldChldmVudC50YXJnZXQpKSByZXR1cm47XHJcbiAgICBjb25zdCB3aW4gPSB3cmFwcGVyLndpbjtcclxuICAgIGNvbnN0IHN0YXJ0WSA9IGV2ZW50LmNsaWVudFk7XHJcbiAgICBsZXQgZHJhZ2dpbmcgPSBmYWxzZTtcclxuICAgIGxldCBpbmRpY2F0b3IgPSBudWxsO1xyXG4gICAgbGV0IGJveGVzID0gW107XHJcbiAgICBsZXQgdGFyZ2V0SW5kZXggPSBudWxsO1xyXG5cclxuICAgIGNvbnN0IG1lYXN1cmUgPSAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGJhc2UgPSB3cmFwcGVyLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xyXG4gICAgICBib3hlcyA9IHNlY3Rpb25zLm1hcCgobmFtZSkgPT4ge1xyXG4gICAgICAgIGNvbnN0IHJlY3QgPSBibG9ja0Vscy5nZXQobmFtZSkuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XHJcbiAgICAgICAgcmV0dXJuIHsgc2VjdGlvbjogbmFtZSwgdG9wOiByZWN0LnRvcCAtIGJhc2UudG9wLCBib3R0b206IHJlY3QuYm90dG9tIC0gYmFzZS50b3AgfTtcclxuICAgICAgfSk7XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IG9uTW92ZSA9IChtb3ZlRXZlbnQpID0+IHtcclxuICAgICAgaWYgKCFkcmFnZ2luZykge1xyXG4gICAgICAgIGlmIChNYXRoLmFicyhtb3ZlRXZlbnQuY2xpZW50WSAtIHN0YXJ0WSkgPCA0KSByZXR1cm47XHJcbiAgICAgICAgZHJhZ2dpbmcgPSB0cnVlO1xyXG4gICAgICAgIHdyYXBwZXIuZG9jLmJvZHkuYWRkQ2xhc3MoXCJmcmVkLXR5cC1ibG9jay1kcmFnZ2luZ1wiKTtcclxuICAgICAgICB3aW4uZ2V0U2VsZWN0aW9uKCk/LnJlbW92ZUFsbFJhbmdlcygpO1xyXG4gICAgICAgIGJsb2NrRWxzLmdldChzZWN0aW9uKS5hZGRDbGFzcyhcImlzLWRyYWdnaW5nXCIpO1xyXG4gICAgICAgIG1lYXN1cmUoKTtcclxuICAgICAgICBpbmRpY2F0b3IgPSB3cmFwcGVyLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1ibG9jay1kcm9wLWluZGljYXRvclwiIH0pO1xyXG4gICAgICB9XHJcbiAgICAgIG1vdmVFdmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICBjb25zdCB5ID0gbW92ZUV2ZW50LmNsaWVudFkgLSB3cmFwcGVyLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpLnRvcDtcclxuICAgICAgdGFyZ2V0SW5kZXggPSBNYXRoLm1heCgxLCBib3hlcy5maWx0ZXIoKGJveCkgPT4gKGJveC50b3AgKyBib3guYm90dG9tKSAvIDIgPCB5KS5sZW5ndGgpO1xyXG4gICAgICBjb25zdCBmcm9tID0gYm94ZXMuZmluZEluZGV4KChib3gpID0+IGJveC5zZWN0aW9uID09PSBzZWN0aW9uKTtcclxuICAgICAgaW5kaWNhdG9yLnRvZ2dsZSh0YXJnZXRJbmRleCAhPT0gZnJvbSAmJiB0YXJnZXRJbmRleCAhPT0gZnJvbSArIDEpO1xyXG4gICAgICAvLyBNaXR0ZSBkZXIgTFx1MDBGQ2NrZSB6d2lzY2hlbiB6d2VpIEJsXHUwMEY2Y2tlbiAoQWJzdGFuZCBzaWVoZVxyXG4gICAgICAvLyAuZnJlZC10eXAtYmxvY2sgKyAuZnJlZC10eXAtYmxvY2sgaW4gc3R5bGVzLmNzcykuXHJcbiAgICAgIGNvbnN0IGhhbGZHYXAgPSA2O1xyXG4gICAgICBjb25zdCBnYXBZID1cclxuICAgICAgICB0YXJnZXRJbmRleCA9PT0gYm94ZXMubGVuZ3RoXHJcbiAgICAgICAgICA/IGJveGVzW2JveGVzLmxlbmd0aCAtIDFdLmJvdHRvbSArIGhhbGZHYXBcclxuICAgICAgICAgIDogKGJveGVzW3RhcmdldEluZGV4IC0gMV0uYm90dG9tICsgYm94ZXNbdGFyZ2V0SW5kZXhdLnRvcCkgLyAyO1xyXG4gICAgICBpbmRpY2F0b3Iuc3R5bGUudG9wID0gYCR7Z2FwWSAtIDF9cHhgO1xyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBlbmQgPSAoY29tbWl0KSA9PiB7XHJcbiAgICAgIHdpbi5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIG9uTW92ZSk7XHJcbiAgICAgIHdpbi5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2V1cFwiLCBvblVwKTtcclxuICAgICAgd2luLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIG9uS2V5LCB0cnVlKTtcclxuICAgICAgaWYgKCFkcmFnZ2luZykgcmV0dXJuO1xyXG4gICAgICB3cmFwcGVyLmRvYy5ib2R5LnJlbW92ZUNsYXNzKFwiZnJlZC10eXAtYmxvY2stZHJhZ2dpbmdcIik7XHJcbiAgICAgIGJsb2NrRWxzLmdldChzZWN0aW9uKS5yZW1vdmVDbGFzcyhcImlzLWRyYWdnaW5nXCIpO1xyXG4gICAgICBpbmRpY2F0b3I/LnJlbW92ZSgpO1xyXG5cclxuICAgICAgY29uc3Qgb3JkZXIgPSBib3hlcy5tYXAoKGJveCkgPT4gYm94LnNlY3Rpb24pO1xyXG4gICAgICBjb25zdCBmcm9tID0gb3JkZXIuaW5kZXhPZihzZWN0aW9uKTtcclxuICAgICAgaWYgKCFjb21taXQgfHwgdGFyZ2V0SW5kZXggPT09IG51bGwgfHwgdGFyZ2V0SW5kZXggPT09IGZyb20gfHwgdGFyZ2V0SW5kZXggPT09IGZyb20gKyAxKSByZXR1cm47XHJcbiAgICAgIG9yZGVyLnNwbGljZShmcm9tLCAxKTtcclxuICAgICAgb3JkZXIuc3BsaWNlKGZyb20gPCB0YXJnZXRJbmRleCA/IHRhcmdldEluZGV4IC0gMSA6IHRhcmdldEluZGV4LCAwLCBzZWN0aW9uKTtcclxuICAgICAgb25Nb3ZlU2VjdGlvbj8uKG9yZGVyKTtcclxuICAgIH07XHJcbiAgICBjb25zdCBvblVwID0gKCkgPT4gZW5kKHRydWUpO1xyXG4gICAgY29uc3Qgb25LZXkgPSAoa2V5RXZlbnQpID0+IHtcclxuICAgICAgaWYgKGtleUV2ZW50LmtleSAhPT0gXCJFc2NhcGVcIikgcmV0dXJuO1xyXG4gICAgICBrZXlFdmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICBrZXlFdmVudC5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgZW5kKGZhbHNlKTtcclxuICAgIH07XHJcbiAgICB3aW4uYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlbW92ZVwiLCBvbk1vdmUpO1xyXG4gICAgd2luLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZXVwXCIsIG9uVXApO1xyXG4gICAgd2luLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIG9uS2V5LCB0cnVlKTtcclxuICB9XHJcblxyXG4gIHJlZ2lzdGVyUHJvcGVydHlEcmFnKCk7XHJcbiAgcmV0dXJuIGFwaTtcclxuXHJcbiAgLyogLS0tIEVpbmUgUHJvcGVydHkgaW4gZWluZW4gYW5kZXJlbiBCbG9jayB6aWVoZW4gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgICogQXVmZ2VzZXR6dCBhdWYgT2JzaWRpYW5zIGVpZ2VuZXMgWmVpbGVuLURyYWcgKEd2IGltIGdlYmF1dGVuIGFwcC5qcyksXHJcbiAgICogc3RhdHQgZWluIHp3ZWl0ZXMgZGFuZWJlbnp1c3RlbGxlbjogZGFzIGhcdTAwRTRuZ3QgYW0gVHlwLUljb24gZGVyIFplaWxlXHJcbiAgICogKC5tZXRhZGF0YS1wcm9wZXJ0eS1pY29uKSwgbGVndCBlaW5lbiAuZHJhZy1yZW9yZGVyLWdob3N0IGFuIGRlbiBCb2R5IC1cclxuICAgKiBkZXIgZm9sZ3QgZGVtIEN1cnNvciBhbHNvIG9obmVoaW4gXHUwMEZDYmVyIEJsb2NrZ3JlbnplbiBoaW53ZWcgLSB1bmRcclxuICAgKiBtYXJraWVydCBkaWUgVXJzcHJ1bmdzemVpbGUgbWl0IC5kcmFnLWdob3N0LWhpZGRlbiwgT2JzaWRpYW5zIGVpZ2VuZW1cclxuICAgKiBBa3plbnQtUmVjaHRlY2ssIGRhcyBkaWUgRWluZlx1MDBGQ2dlc3RlbGxlIHplaWd0LiBJbm5lcmhhbGIgZWluZXMgQmxvY2tzXHJcbiAgICogbWFjaHQgT2JzaWRpYW4gZGFtaXQgdW52ZXJcdTAwRTRuZGVydCBhbGxlcyBzZWxic3QuIERhenUga29tbXQgaGllciBudXI6XHJcbiAgICpcclxuICAgKiAgLSBlaW4gbGVlcmVzIFp1c2F0emtpbmQgaW4gZGVyIExpc3RlLCBzb2xhbmdlIGdlem9nZW4gd2lyZDogT2JzaWRpYW5cclxuICAgKiAgICBzdGFydGV0IGRlbiBEcmFnIHNvbnN0IGdhciBuaWNodCwgd2VubiBlaW4gQmxvY2sgbnVyIGVpbmUgZWluemlnZVxyXG4gICAqICAgIFplaWxlIGhhdCAoUHJcdTAwRkNmdW5nIG4uZmlyc3RDaGlsZCAhPT0gbi5sYXN0Q2hpbGQgYmVpbSBtb3VzZWRvd24pO1xyXG4gICAqICAtIGVpbiBQbGF0emhhbHRlciBtaXQgZGVyc2VsYmVuIEtsYXNzZSAuZHJhZy1naG9zdC1oaWRkZW4gaW0gWmllbGJsb2NrLFxyXG4gICAqICAgIHNvYmFsZCBkZXIgQ3Vyc29yIGVpbmVuIGZyZW1kZW4gQmxvY2sgZXJyZWljaHQgLSBkaWUgVXJzcHJ1bmdzemVpbGVcclxuICAgKiAgICB3aXJkIHNvbGFuZ2UgYXVzZ2VibGVuZGV0LCBkYW1pdCBuaWNodCB6d2VpIFJlY2h0ZWNrZSBzdGVoZW47XHJcbiAgICogIC0gcmVvcmRlcktleSBqZSBJbnN0YW56LCBkYXMgYmVpbSBMb3NsYXNzZW4gXHUwMEZDYmVyIGVpbmVtIGZyZW1kZW4gQmxvY2tcclxuICAgKiAgICBkaWUgUHJvcGVydHkgZG9ydGhpbiB1bWhcdTAwRTRuZ3QsIHN0YXR0IGlubmVyaGFsYiBkZXMgZWlnZW5lbiB6dSBzb3J0aWVyZW4uXHJcbiAgICpcclxuICAgKiBEaWUgZWlnZW5lbiBIYW5kbGVyIGxhdWZlbiBpbiBkZXIgQ2FwdHVyZS1QaGFzZSBhbSBGZW5zdGVyIHVuZCBkYW1pdCB2b3JcclxuICAgKiBPYnNpZGlhbnMgZWlnZW5lbiAoZGllIGVzIGluIHNlaW5lbSBtb3VzZWRvd24tSGFuZGxlciBhdWYgd2luZG93IGxlZ3QpLlxyXG4gICAqIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXHJcbiAgZnVuY3Rpb24gcmVnaXN0ZXJQcm9wZXJ0eURyYWcoKSB7XHJcbiAgICAvLyBPaG5lIGVpbmVuIHp3ZWl0ZW4gQmxvY2sgZ2lidCBlcyBrZWluIFppZWwgLSBkYW5uIGJsZWlidCBPYnNpZGlhbnNcclxuICAgIC8vIGVpZ2VuZXMgRHJhZyB2XHUwMEY2bGxpZyB1bmFuZ2V0YXN0ZXQuXHJcbiAgICBjb25zdCBhbmNob3IgPSBhcGkuZWRpdG9yc1swXTtcclxuICAgIGlmICghYW5jaG9yIHx8IHNlY3Rpb25zLmxlbmd0aCA8IDIpIHJldHVybjtcclxuXHJcbiAgICAvLyBMXHUwMEU0dWZ0IGVpbiBEcmFnLCBoXHUwMEU0bHQgZGllcyBkZXNzZW4gWnVzdGFuZDsgZHJvcCBtZXJrdCBzaWNoIGJlaW1cclxuICAgIC8vIExvc2xhc3NlbiBkYXMgWmllbCBmXHUwMEZDciBkYXMgYW5zY2hsaWVcdTAwREZlbmRlIHJlb3JkZXJLZXkuXHJcbiAgICBsZXQgZHJhZyA9IG51bGw7XHJcbiAgICBsZXQgZHJvcCA9IG51bGw7XHJcblxyXG4gICAgY29uc3Qgc2VjdGlvbkF0ID0gKGNsaWVudFkpID0+XHJcbiAgICAgIHNlY3Rpb25zLmZpbmQoKHNlY3Rpb24pID0+IHtcclxuICAgICAgICBjb25zdCByZWN0ID0gYmxvY2tFbHMuZ2V0KHNlY3Rpb24pLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xyXG4gICAgICAgIHJldHVybiBjbGllbnRZID49IHJlY3QudG9wICYmIGNsaWVudFkgPD0gcmVjdC5ib3R0b207XHJcbiAgICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGNsZWFyUGxhY2Vob2xkZXIgPSAoKSA9PiB7XHJcbiAgICAgIGRyYWcucGxhY2Vob2xkZXI/LnJlbW92ZSgpO1xyXG4gICAgICBkcmFnLnBsYWNlaG9sZGVyID0gbnVsbDtcclxuICAgICAgZHJhZy5yb3dFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImRpc3BsYXlcIik7XHJcbiAgICAgIGRyYWcudGFyZ2V0ID0gbnVsbDtcclxuICAgIH07XHJcblxyXG4gICAgd3JhcHBlci5hZGRFdmVudExpc3RlbmVyKFxyXG4gICAgICBcIm1vdXNlZG93blwiLFxyXG4gICAgICAoZXZlbnQpID0+IHtcclxuICAgICAgICBpZiAoZXZlbnQuYnV0dG9uICE9PSAwKSByZXR1cm47XHJcbiAgICAgICAgY29uc3Qgcm93RWwgPSBldmVudC50YXJnZXQuY2xvc2VzdChcIi5tZXRhZGF0YS1wcm9wZXJ0eS1pY29uXCIpPy5jbG9zZXN0KFwiLm1ldGFkYXRhLXByb3BlcnR5XCIpO1xyXG4gICAgICAgIGNvbnN0IHNlY3Rpb24gPSByb3dFbD8uY2xvc2VzdChcIi5mcmVkLXR5cC1ibG9ja1wiKT8uZnJlZFNlY3Rpb247XHJcbiAgICAgICAgY29uc3QgZWRpdG9yID0gc2VjdGlvbiA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IGVkaXRvcnMuZ2V0KHNlY3Rpb24pO1xyXG4gICAgICAgIGNvbnN0IGtleSA9IGVkaXRvcj8ucmVuZGVyZWQuZmluZCgocm93KSA9PiByb3cuY29udGFpbmVyRWwgPT09IHJvd0VsKT8uZW50cnkua2V5O1xyXG4gICAgICAgIC8vIEVpbmUgbm9jaCB1bmJlbmFubnRlIFplaWxlIGhhdCBpbiBlaW5lbSBhbmRlcmVuIEJsb2NrIG5pY2h0cyB6dVxyXG4gICAgICAgIC8vIHN1Y2hlbiAtIHNpZSBibGVpYnQgT2JzaWRpYW5zIGVpZ2VuZXIgU29ydGllcnVuZyBcdTAwRkNiZXJsYXNzZW4uXHJcbiAgICAgICAgaWYgKCFrZXkpIHJldHVybjtcclxuICAgICAgICBkcmFnID0ge1xyXG4gICAgICAgICAgc2VjdGlvbixcclxuICAgICAgICAgIGtleSxcclxuICAgICAgICAgIHJvd0VsLFxyXG4gICAgICAgICAgLy8gSmV0enQgc2Nob24gZ2VtZXNzZW46IHNvYmFsZCBkaWUgWmVpbGUgZlx1MDBGQ3IgZGVuIFBsYXR6aGFsdGVyXHJcbiAgICAgICAgICAvLyBhdXNnZWJsZW5kZXQgaXN0LCBsaWVmZXJ0IG9mZnNldEhlaWdodCAwLlxyXG4gICAgICAgICAgaGVpZ2h0OiByb3dFbC5vZmZzZXRIZWlnaHQsXHJcbiAgICAgICAgICBzcGFjZXI6IGVkaXRvci5wcm9wZXJ0eUxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZHJhZy1zcGFjZXJcIiB9KSxcclxuICAgICAgICAgIHBsYWNlaG9sZGVyOiBudWxsLFxyXG4gICAgICAgICAgdGFyZ2V0OiBudWxsLFxyXG4gICAgICAgIH07XHJcbiAgICAgICAgZHJvcCA9IG51bGw7XHJcbiAgICAgIH0sXHJcbiAgICAgIHRydWVcclxuICAgICk7XHJcblxyXG4gICAgLy8gQW0gRmVuc3RlciByZWdpc3RyaWVydCwgZGFtaXQgZWluIERyYWcgYXVjaCBhdVx1MDBERmVyaGFsYiBkZXIgQmxcdTAwRjZja2VcclxuICAgIC8vIHdlaXRlcnZlcmZvbGd0IHdpcmQgLSBhYmdlclx1MDBFNHVtdCBtaXQgZGVtIGVyc3RlbiBFZGl0b3IsIGRlciBiZWltXHJcbiAgICAvLyBuXHUwMEU0Y2hzdGVuIE5ldWF1ZmJhdSBkZXIgRGV0YWlsYW5zaWNodCBlbnRsYWRlbiB3aXJkIChzaWVoZVxyXG4gICAgLy8gZGVzdHJveUZyb250bWF0dGVyRWRpdG9yIGluIHR5cC12aWV3LmpzKS5cclxuICAgIGNvbnN0IG9uV2luTW92ZSA9IChldmVudCkgPT4ge1xyXG4gICAgICBpZiAoIWRyYWcpIHJldHVybjtcclxuICAgICAgY29uc3QgdGFyZ2V0ID0gc2VjdGlvbkF0KGV2ZW50LmNsaWVudFkpO1xyXG4gICAgICBpZiAodGFyZ2V0ID09PSB1bmRlZmluZWQgfHwgdGFyZ2V0ID09PSBkcmFnLnNlY3Rpb24pIHtcclxuICAgICAgICBpZiAoZHJhZy5wbGFjZWhvbGRlcikgY2xlYXJQbGFjZWhvbGRlcigpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgbGlzdCA9IGVkaXRvcnMuZ2V0KHRhcmdldCkucHJvcGVydHlMaXN0RWw7XHJcbiAgICAgIGlmICghZHJhZy5wbGFjZWhvbGRlcikge1xyXG4gICAgICAgIGRyYWcucm93RWwuc3R5bGUuZGlzcGxheSA9IFwibm9uZVwiO1xyXG4gICAgICAgIGRyYWcucGxhY2Vob2xkZXIgPSBjcmVhdGVEaXYoeyBjbHM6IFwibWV0YWRhdGEtcHJvcGVydHkgZHJhZy1naG9zdC1oaWRkZW4gZnJlZC10eXAtZHJhZy1wbGFjZWhvbGRlclwiIH0pO1xyXG4gICAgICAgIGRyYWcucGxhY2Vob2xkZXIuc3R5bGUuaGVpZ2h0ID0gYCR7ZHJhZy5oZWlnaHR9cHhgO1xyXG4gICAgICB9XHJcbiAgICAgIC8vIEVpbmZcdTAwRkNnZXN0ZWxsZSB3aWUgYmVpIE9ic2lkaWFuIHNlbGJzdDogdm9yIGRlciBlcnN0ZW4gWmVpbGUsIGRlcmVuXHJcbiAgICAgIC8vIE1pdHRlIHVudGVyaGFsYiBkZXMgQ3Vyc29ycyBsaWVndC5cclxuICAgICAgY29uc3Qgcm93cyA9IFsuLi5saXN0LmNoaWxkcmVuXS5maWx0ZXIoKGVsKSA9PiBlbCAhPT0gZHJhZy5wbGFjZWhvbGRlciAmJiBlbCAhPT0gZHJhZy5zcGFjZXIpO1xyXG4gICAgICBjb25zdCBiZWZvcmUgPSByb3dzLmZpbmQoKGVsKSA9PiB7XHJcbiAgICAgICAgY29uc3QgcmVjdCA9IGVsLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xyXG4gICAgICAgIHJldHVybiBldmVudC5jbGllbnRZIDwgcmVjdC50b3AgKyByZWN0LmhlaWdodCAvIDI7XHJcbiAgICAgIH0pO1xyXG4gICAgICBkcmFnLnRhcmdldCA9IHsgc2VjdGlvbjogdGFyZ2V0LCBpbmRleDogYmVmb3JlID8gcm93cy5pbmRleE9mKGJlZm9yZSkgOiByb3dzLmxlbmd0aCB9O1xyXG4gICAgICBsaXN0Lmluc2VydEJlZm9yZShkcmFnLnBsYWNlaG9sZGVyLCBiZWZvcmUgPz8gbnVsbCk7XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IG9uV2luVXAgPSAoKSA9PiB7XHJcbiAgICAgIGlmICghZHJhZykgcmV0dXJuO1xyXG4gICAgICBjb25zdCB7IHNwYWNlciwgcGxhY2Vob2xkZXIsIHJvd0VsLCB0YXJnZXQgfSA9IGRyYWc7XHJcbiAgICAgIGRyYWcgPSBudWxsO1xyXG4gICAgICBkcm9wID0gdGFyZ2V0O1xyXG4gICAgICBwbGFjZWhvbGRlcj8ucmVtb3ZlKCk7XHJcbiAgICAgIHJvd0VsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiZGlzcGxheVwiKTtcclxuICAgICAgLy8gRXJzdCBuYWNoIE9ic2lkaWFucyBlaWdlbmVtIERyYWctQWJzY2hsdXNzOiBkZXIgYmVzdGltbXQgZGllXHJcbiAgICAgIC8vIEVpbmZcdTAwRkNnZXN0ZWxsZSBpbm5lcmhhbGIgZGVzIEF1c2dhbmdzYmxvY2tzIG5vY2ggXHUwMEZDYmVyIGRpZSBLaW5kZXJsaXN0ZSxcclxuICAgICAgLy8gaW4gZGVyIGRhcyBadXNhdHpraW5kIGRpZSBsZXR6dGUgUG9zaXRpb24gbWFya2llcnQuXHJcbiAgICAgIHdyYXBwZXIud2luLnNldFRpbWVvdXQoKCkgPT4gc3BhY2VyLnJlbW92ZSgpLCAwKTtcclxuICAgIH07XHJcblxyXG4gICAgd3JhcHBlci53aW4uYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlbW92ZVwiLCBvbldpbk1vdmUsIHRydWUpO1xyXG4gICAgd3JhcHBlci53aW4uYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNldXBcIiwgb25XaW5VcCwgdHJ1ZSk7XHJcbiAgICBhbmNob3IucmVnaXN0ZXIoKCkgPT4ge1xyXG4gICAgICB3cmFwcGVyLndpbi5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIG9uV2luTW92ZSwgdHJ1ZSk7XHJcbiAgICAgIHdyYXBwZXIud2luLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtb3VzZXVwXCIsIG9uV2luVXAsIHRydWUpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgZm9yIChjb25zdCBbc2VjdGlvbiwgZWRpdG9yXSBvZiBlZGl0b3JzKSB7XHJcbiAgICAgIGNvbnN0IG9yaWdpbmFsUmVvcmRlcktleSA9IGVkaXRvci5yZW9yZGVyS2V5O1xyXG4gICAgICBlZGl0b3IucmVvcmRlcktleSA9IGZ1bmN0aW9uIChlbnRyeSwgaW5kZXgpIHtcclxuICAgICAgICBjb25zdCB0YXJnZXQgPSBkcm9wO1xyXG4gICAgICAgIGRyb3AgPSBudWxsO1xyXG4gICAgICAgIGlmICghdGFyZ2V0KSByZXR1cm4gb3JpZ2luYWxSZW9yZGVyS2V5LmNhbGwodGhpcywgZW50cnksIGluZGV4KTtcclxuICAgICAgICBtb3ZlUHJvcGVydHkoc2VjdGlvbiwgdGFyZ2V0LnNlY3Rpb24sIGVudHJ5LmtleSwgdGFyZ2V0LmluZGV4KTtcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8vIEhcdTAwRTRuZ3Qga2V5IGF1cyBkZW0gQmxvY2sgZnJvbSBpbiBkZW4gQmxvY2sgdG8gdW0sIGRvcnQgYW4gUG9zaXRpb24gaW5kZXguXHJcbiAgLy8gRlx1MDBGQ2hydCBkYXMgWmllbCBkZW4gTmFtZW4gYmVyZWl0cyAoaW5uZXJoYWxiIGVpbmVzIEJsb2NrcyBtdXNzIGVyIGVpbmRldXRpZ1xyXG4gIC8vIGJsZWliZW4pLCB3ZXJkZW4gYmVpZGUgenVzYW1tZW5nZWxlZ3Q6IGRlciBiZXN0ZWhlbmRlIEVpbnRyYWcgYmVoXHUwMEU0bHRcclxuICAvLyBQb3NpdGlvbiwgV2VydCwgRmxvYXRpbmctTWFya2llcnVuZyB1bmQgU2hvcnRjdXQsIG51ciBlaW4gbGVlcmVyIFdlcnQgd2lyZFxyXG4gIC8vIGF1cyBkZXIgZ2V6b2dlbmVuIFByb3BlcnR5IGdlZlx1MDBGQ2xsdCAtIGRpZXNlbGJlIFJlZ2VsIHdpZSBiZWkgbWVyZ2VTdWJ0eXBlc1xyXG4gIC8vIChzdWJ0eXBlcy5qcykgdW5kIHJlbmFtZUluU3RvcmUgKHByb3BlcnR5LXJlbmFtZS1zeW5jLmpzKS5cclxuICBhc3luYyBmdW5jdGlvbiBtb3ZlUHJvcGVydHkoZnJvbSwgdG8sIGtleSwgaW5kZXgpIHtcclxuICAgIGNvbnN0IHNvdXJjZSA9IHN0b3Jlcy5nZXQoZnJvbSk7XHJcbiAgICBjb25zdCB0YXJnZXQgPSBzdG9yZXMuZ2V0KHRvKTtcclxuICAgIGlmICghc291cmNlIHx8ICF0YXJnZXQgfHwgZnJvbSA9PT0gdG8pIHJldHVybjtcclxuXHJcbiAgICBjb25zdCBzb3VyY2VGcm9udG1hdHRlciA9IHsgLi4uc291cmNlLmdldEZyb250bWF0dGVyKCkgfTtcclxuICAgIGNvbnN0IHZhbHVlID0gc291cmNlRnJvbnRtYXR0ZXJba2V5XTtcclxuICAgIGNvbnN0IHdhc0Zsb2F0aW5nID0gc291cmNlLmdldEZsb2F0aW5nKCkuaW5jbHVkZXMoa2V5KTtcclxuICAgIC8vIERlciBTaG9ydGN1dCBoXHUwMEU0bmd0IGFtIEtleSAoc2llaGUgc2hvcnRjdXRzLmpzKSB1bmQgemllaHQgZGVzaGFsYiBtaXQgZGVyXHJcbiAgICAvLyBQcm9wZXJ0eSBpbiBkZW4gYW5kZXJlbiBCbG9jayB1bS5cclxuICAgIGNvbnN0IHNvdXJjZVNob3J0Y3V0cyA9IHsgLi4uc291cmNlLmdldFNob3J0Y3V0cygpIH07XHJcbiAgICBjb25zdCBzaG9ydGN1dCA9IHNvdXJjZVNob3J0Y3V0c1trZXldID8/IG51bGw7XHJcbiAgICBkZWxldGUgc291cmNlU2hvcnRjdXRzW2tleV07XHJcbiAgICBkZWxldGUgc291cmNlRnJvbnRtYXR0ZXJba2V5XTtcclxuICAgIHNvdXJjZS5zZXRGcm9udG1hdHRlcihzb3VyY2VGcm9udG1hdHRlcik7XHJcbiAgICBzb3VyY2Uuc2V0RmxvYXRpbmcoc291cmNlLmdldEZsb2F0aW5nKCkuZmlsdGVyKChrKSA9PiBrICE9PSBrZXkpKTtcclxuICAgIHNvdXJjZS5zZXRTaG9ydGN1dHMoc291cmNlU2hvcnRjdXRzKTtcclxuXHJcbiAgICBjb25zdCB0YXJnZXRGcm9udG1hdHRlciA9IHRhcmdldC5nZXRGcm9udG1hdHRlcigpO1xyXG4gICAgY29uc3QgZXhpc3RpbmcgPSBPYmplY3Qua2V5cyh0YXJnZXRGcm9udG1hdHRlcikuZmluZCgoaykgPT4gay50b0xvd2VyQ2FzZSgpID09PSBrZXkudG9Mb3dlckNhc2UoKSk7XHJcbiAgICBpZiAoZXhpc3RpbmcgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICBpZiAoaXNFbXB0eVZhbHVlKHRhcmdldEZyb250bWF0dGVyW2V4aXN0aW5nXSkpIHRhcmdldC5zZXRGcm9udG1hdHRlcih7IC4uLnRhcmdldEZyb250bWF0dGVyLCBbZXhpc3RpbmddOiB2YWx1ZSB9KTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyh0YXJnZXRGcm9udG1hdHRlcik7XHJcbiAgICAgIGNvbnN0IGF0ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oaW5kZXgsIGtleXMubGVuZ3RoKSk7XHJcbiAgICAgIGNvbnN0IG5leHQgPSB7fTtcclxuICAgICAgZm9yIChjb25zdCBrIG9mIGtleXMuc2xpY2UoMCwgYXQpKSBuZXh0W2tdID0gdGFyZ2V0RnJvbnRtYXR0ZXJba107XHJcbiAgICAgIG5leHRba2V5XSA9IHZhbHVlO1xyXG4gICAgICBmb3IgKGNvbnN0IGsgb2Yga2V5cy5zbGljZShhdCkpIG5leHRba10gPSB0YXJnZXRGcm9udG1hdHRlcltrXTtcclxuICAgICAgdGFyZ2V0LnNldEZyb250bWF0dGVyKG5leHQpO1xyXG4gICAgICBpZiAod2FzRmxvYXRpbmcpIHRhcmdldC5zZXRGbG9hdGluZyhbLi4udGFyZ2V0LmdldEZsb2F0aW5nKCksIGtleV0pO1xyXG4gICAgICBpZiAoc2hvcnRjdXQpIHRhcmdldC5zZXRTaG9ydGN1dHMoeyAuLi50YXJnZXQuZ2V0U2hvcnRjdXRzKCksIFtrZXldOiBzaG9ydGN1dCB9KTtcclxuICAgIH1cclxuXHJcbiAgICBhd2FpdCB2aWV3LnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgIC8vIFJlbmRlcnQgdS4gYS4gZGllc2UgRGV0YWlsYW5zaWNodCBuZXUgKHNpZWhlIHJlZ2lzdGVyVHlwVmlldykgLSBkaWVcclxuICAgIC8vIEJsXHUwMEY2Y2tlIGVudHN0ZWhlbiBkYWJlaSBzYW10IEVkaXRvcmVuIGZyaXNjaCBhdXMgZGVuIEVpbnN0ZWxsdW5nZW4uXHJcbiAgICB2aWV3LnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0geyBtb3VudEZyb250bWF0dGVyQmxvY2tzIH07XHJcbiIsICIvLyBSZWluZSBIaWxmc2Z1bmt0aW9uZW4gb2huZSBlaWdlbmVuIFN0YXRlIHJ1bmQgdW0gVFlQLU5hbWVuIHVuZCBkZXJlblxuLy8gU29ydGllcnVuZy5cblxuLy8gVFlQZW4gd2VyZGVuIGF1c3NjaGxpZVx1MDBERmxpY2ggaW4gR3JvXHUwMERGYnVjaHN0YWJlbiBhbmdlbGVndC91bWJlbmFubnQgLSBiZWltXG4vLyBBbmxlZ2VuIHdpZSBiZWltIFVtYmVuZW5uZW4uIEJldHJpZmZ0IG51ciBcdTAwRkNiZXIgZGllIExpc3RlIGdldGlwcHRlIE5hbWVuLFxuLy8gbmljaHQgV2VydGUsIGRpZSB6LiBCLiBkaXJla3QgaW0gRnJvbnRtYXR0ZXIgZWluZXIgTm90aXogaW4gS2xlaW5zY2hyZWlidW5nXG4vLyBzdGVoZW4gKHNpZWhlIFwidW5yZWdpc3RyaWVydGVcIiBaZWlsZW4gaW4gdHlwLXZpZXcuanMpLlxuZnVuY3Rpb24gbm9ybWFsaXplVHlwZU5hbWUocmF3KSB7XG4gIHJldHVybiByYXcudHJpbSgpLnRvVXBwZXJDYXNlKCk7XG59XG5cbi8vIEZhcmJ0b24gKDAtMzYwXHUwMEIwKSBhdXMgZWluZW0gSGV4LUNvZGUsIGZcdTAwRkNyIGRpZSBTb3J0aWVydW5nIG5hY2ggRmFyYnNwZWt0cnVtXG4vLyBzdGF0dCBuYWNoIEhleC1TdHJpbmcuIFJvdCBsaWVndCBiZWkgMFx1MDBCMC8zNjBcdTAwQjAgKEtyZWlzKSAtIGF1ZnN0ZWlnZW5kIGJlZ2lubnRcbi8vIGRpZSBTb3J0aWVydW5nIGRhbWl0IGJlaSBSb3QsIGxcdTAwRTR1ZnQgXHUwMEZDYmVyIE9yYW5nZS9HZWxiL0dyXHUwMEZDbi9DeWFuL0JsYXUvTWFnZW50YVxuLy8gdW5kIGxhbmRldCB3aWVkZXIgYmVpIFJvdC4gQWNocm9tYXRpc2NoZSBGYXJiZW4gKEdyYXUvU2Nod2Fyei9XZWlcdTAwREYsIGRlbHRhPTApXG4vLyBoYWJlbiBrZWluZW4gZGVmaW5pZXJ0ZW4gRmFyYnRvbiAtIGRhZlx1MDBGQ3IgbGllZmVydCBkaWVzZSBGdW5rdGlvbiBudWxsLCBkYW1pdFxuLy8gY29tcGFyZVR5cGVzIHNpZSB1bmFiaFx1MDBFNG5naWcgdm9uIGRlciBTb3J0aWVycmljaHR1bmcgYW5zIEVuZGUgc3RlbGxlbiBrYW5uLlxuZnVuY3Rpb24gaGV4VG9IdWUoaGV4KSB7XG4gIGNvbnN0IG1hdGNoID0gL14jPyhbMC05YS1mXXs2fSkkL2kuZXhlYyhoZXggPz8gXCJcIik7XG4gIGlmICghbWF0Y2gpIHJldHVybiBudWxsO1xuICBjb25zdCBpbnQgPSBwYXJzZUludChtYXRjaFsxXSwgMTYpO1xuICBjb25zdCByID0gKChpbnQgPj4gMTYpICYgMjU1KSAvIDI1NTtcbiAgY29uc3QgZyA9ICgoaW50ID4+IDgpICYgMjU1KSAvIDI1NTtcbiAgY29uc3QgYiA9IChpbnQgJiAyNTUpIC8gMjU1O1xuICBjb25zdCBtYXggPSBNYXRoLm1heChyLCBnLCBiKTtcbiAgY29uc3QgbWluID0gTWF0aC5taW4ociwgZywgYik7XG4gIGNvbnN0IGRlbHRhID0gbWF4IC0gbWluO1xuICBpZiAoZGVsdGEgPT09IDApIHJldHVybiBudWxsO1xuXG4gIGxldCBodWU7XG4gIGlmIChtYXggPT09IHIpIGh1ZSA9ICgoZyAtIGIpIC8gZGVsdGEpICUgNjtcbiAgZWxzZSBpZiAobWF4ID09PSBnKSBodWUgPSAoYiAtIHIpIC8gZGVsdGEgKyAyO1xuICBlbHNlIGh1ZSA9IChyIC0gZykgLyBkZWx0YSArIDQ7XG4gIGh1ZSAqPSA2MDtcbiAgcmV0dXJuIGh1ZSA8IDAgPyBodWUgKyAzNjAgOiBodWU7XG59XG5cbi8vIEdlbWVpbnNhbWUgU29ydGllcmxvZ2lrIGZcdTAwRkNyIFRZUC0gdW5kIFNVQlRZUC1MaXN0ZW4uIHR5cGVDb2xvcnMgZGFyZiBlaW5cbi8vIGxlZXJlcyBPYmpla3Qgc2VpbiAoU1VCVFlQIGhhdCBrZWluZSBlaWdlbmUgRmFyYmUpIC0gZGVyIFwiY29sb3JcIi1Nb2R1cyB3aXJkXG4vLyBkb3J0IHNjaGxpY2h0IG5pZSBhdXNnZXdcdTAwRTRobHQuXG5mdW5jdGlvbiBjb21wYXJlVHlwZXMobW9kZSwgYSwgYiwgY291bnRzLCB0eXBlQ29sb3JzKSB7XG4gIGNvbnN0IFtrZXksIGRpcl0gPSBtb2RlLnNwbGl0KFwiLVwiKTtcbiAgbGV0IGNtcDtcbiAgaWYgKGtleSA9PT0gXCJjb3VudFwiKSB7XG4gICAgY21wID0gKGNvdW50cy5nZXQoYSkgPz8gMCkgLSAoY291bnRzLmdldChiKSA/PyAwKTtcbiAgICBpZiAoZGlyID09PSBcImRlc2NcIikgY21wID0gLWNtcDtcbiAgfSBlbHNlIGlmIChrZXkgPT09IFwiY29sb3JcIikge1xuICAgIGNvbnN0IGh1ZUEgPSBoZXhUb0h1ZSh0eXBlQ29sb3JzW2FdID8/IG51bGwpO1xuICAgIGNvbnN0IGh1ZUIgPSBoZXhUb0h1ZSh0eXBlQ29sb3JzW2JdID8/IG51bGwpO1xuICAgIC8vIEFjaHJvbWF0aXNjaGUgRmFyYmVuIGJsZWliZW4gaW1tZXIgYW0gRW5kZSwgZWdhbCBvYiBhdWYtIG9kZXIgYWJzdGVpZ2VuZFxuICAgIC8vIHNvcnRpZXJ0IHdpcmQgLSBudXIgZGllIFJlaWhlbmZvbGdlIGlubmVyaGFsYiBkZXIgZWNodGVuIEZhcmJ0XHUwMEY2bmUgZHJlaHQgc2ljaCB1bS5cbiAgICBpZiAoaHVlQSA9PT0gbnVsbCAmJiBodWVCID09PSBudWxsKSBjbXAgPSAwO1xuICAgIGVsc2UgaWYgKGh1ZUEgPT09IG51bGwpIGNtcCA9IDE7XG4gICAgZWxzZSBpZiAoaHVlQiA9PT0gbnVsbCkgY21wID0gLTE7XG4gICAgZWxzZSB7XG4gICAgICBjbXAgPSBodWVBIC0gaHVlQjtcbiAgICAgIGlmIChkaXIgPT09IFwiZGVzY1wiKSBjbXAgPSAtY21wO1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBjbXAgPSBhLmxvY2FsZUNvbXBhcmUoYik7XG4gICAgaWYgKGRpciA9PT0gXCJkZXNjXCIpIGNtcCA9IC1jbXA7XG4gIH1cbiAgcmV0dXJuIGNtcCB8fCBhLmxvY2FsZUNvbXBhcmUoYik7XG59XG5cbi8vIFdlbmRldCBkZW4gYWt0dWVsbGVuIFNvcnRpZXJtb2R1cyBhdWYgZWluZSBMaXN0ZSB2b24gVFlQZW4gYW4uIFNvbmRlcmZhbGxcbi8vIFwibWFudWFsXCIgKHNpZWhlIFNPUlRfT1BUSU9OUyBpbiB0eXAtdmlldy5qcyk6IGRvcnQgYmxlaWJ0IGJld3Vzc3QgZGllXG4vLyBcdTAwRkNiZXJnZWJlbmUgUmVpaGVuZm9sZ2Ugc2VsYnN0IGVyaGFsdGVuLCBzdGF0dCBzaWUgenUgc29ydGllcmVuIC0gc2llIElTVCBpblxuLy8gZGllc2VtIE1vZHVzIGRpZSBnZXNwZWljaGVydGUgU29ydGllcnVuZyAocGx1Z2luLnNldHRpbmdzLnR5cGVzLCBwZXIgRHJhZyAmXG4vLyBEcm9wIGluIHR5cC12aWV3LmpzIHZlcnNjaG9iZW4pLiBFaW4gVmVyZ2xlaWNoIHp3ZWllciBUWVBlbiBrXHUwMEY2bm50ZSBkaWVzZVxuLy8gUmVpaGVuZm9sZ2UgbmljaHQgaGVybGVpdGVuLCBjb21wYXJlVHlwZXMgYmxlaWJ0IGRhaGVyIHVuYW5nZXRhc3RldC4gVm9uXG4vLyBtYWluLmpzIChnZXRUeXBlcygpLCBmXHUwMEZDciBUZW1wbGF0ZXIvUGlja2VyKSBVTkQgdHlwLXZpZXcuanMgZ2VudXR6dCwgZGFtaXRcbi8vIGJlaWRlIGRpZXNlbGJlIFJlaWhlbmZvbGdlIHplaWdlbi5cbmZ1bmN0aW9uIHNvcnRUeXBlc0J5TW9kZSh0eXBlcywgbW9kZSwgY291bnRzLCB0eXBlQ29sb3JzKSB7XG4gIGlmIChtb2RlID09PSBcIm1hbnVhbFwiKSByZXR1cm4gWy4uLnR5cGVzXTtcbiAgcmV0dXJuIFsuLi50eXBlc10uc29ydCgoYSwgYikgPT4gY29tcGFyZVR5cGVzKG1vZGUsIGEsIGIsIGNvdW50cywgdHlwZUNvbG9ycykpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgbm9ybWFsaXplVHlwZU5hbWUsIGhleFRvSHVlLCBjb21wYXJlVHlwZXMsIHNvcnRUeXBlc0J5TW9kZSB9O1xuIiwgImNvbnN0IHsgSXRlbVZpZXcsIE1lbnUsIE1vZGFsLCBOb3RpY2UsIHNldEljb24sIGRlYm91bmNlIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XHJcbmNvbnN0IHsgbW91bnRGcm9udG1hdHRlckJsb2NrcyB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItYmxvY2tzXCIpO1xyXG5jb25zdCB7XHJcbiAgbm9ybWFsaXplU3VidHlwZU5hbWUsXHJcbiAgZ2V0U3VidHlwZU5hbWVzLFxyXG4gIGVuc3VyZVN1YnR5cGUsXHJcbiAgbW92ZVR5cGVTdWJ0eXBlcyxcclxuICBkZWxldGVUeXBlU3VidHlwZXMsXHJcbiAgbWVyZ2VUeXBlU3VidHlwZXMsXHJcbiAgZ2V0U3VidHlwZSxcclxuICByZW5hbWVTdWJ0eXBlLFxyXG4gIHJlb3JkZXJTdWJ0eXBlcyxcclxuICBkZWxldGVTdWJ0eXBlLFxyXG4gIG1lcmdlU3VidHlwZXMsXHJcbiAgcmVuYW1lU3VidHlwZUluTm90ZXMsXHJcbn0gPSByZXF1aXJlKFwiLi9zdWJ0eXBlc1wiKTtcclxuY29uc3QgeyBub3JtYWxpemVUeXBlTmFtZSwgY29tcGFyZVR5cGVzLCBzb3J0VHlwZXNCeU1vZGUgfSA9IHJlcXVpcmUoXCIuL3R5cGUtdXRpbHNcIik7XHJcbmNvbnN0IHsgdHlwZUtleU9mLCBwcm9wZXJ0eVZhbHVlLCBzZXRDYW5vbmljYWxQcm9wZXJ0eSwgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcclxuY29uc3Qge1xyXG4gIHN1YnR5cGVDb2xvcixcclxuICBhcHBseUNvbG9yT2Zmc2V0LFxyXG4gIGhhc0NvbG9yT2Zmc2V0LFxyXG4gIHN1YnR5cGVIYXNPd25Db2xvcixcclxuICBwYWludENvbG9yRG90LFxyXG4gIG5hbWVDb2xvcixcclxuICBjaGFubmVsQm91bmRzLFxyXG4gIGNsYW1wZWRPZmZzZXQsXHJcbiAgU1VCVFlQRV9DT0xPUl9DSEFOTkVMUyxcclxuICBERUZBVUxUX1RZUEVfQ09MT1IsXHJcbn0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcclxuXHJcbmNvbnN0IFZJRVdfVFlQRV9UWVAgPSBcImZyZWQtdHlwLXZpZXdcIjtcclxuY29uc3QgREVGQVVMVF9TT1JUX09SREVSID0gXCJjb3VudC1kZXNjXCI7XHJcbmNvbnN0IERFRkFVTFRfU0VDT05EQVJZID0gXCJzdWJ0eXBlc1wiO1xyXG5cclxuLy8gV2FzIGluIGRlciBUWVAtTGlzdGUgcmVjaHRzIG5lYmVuIGRlbSBOYW1lbiBzdGVodCAoc2V0dGluZ3MudHlwTGlzdFNlY29uZGFyeSkuXHJcbi8vIFVtZ2VzY2hhbHRldCB3aXJkIG5pY2h0IFx1MDBGQ2JlciBkaWUgRWluc3RlbGx1bmdlbiwgc29uZGVybiBcdTAwRkNiZXIgZWluZW4gS25vcGYgaW1cclxuLy8gTGlzdGVuLUhlYWRlciBuZWJlbiBkZXIgU29ydGllcnVuZywgZGVyIGRpZSBNb2RpIGRlciBSZWloZSBuYWNoIGR1cmNoc2NoYWx0ZXRcclxuLy8gKHNpZWhlIGN5Y2xlU2Vjb25kYXJ5KSAtIGVzIHNpbmQgenUgd2VuaWdlIHVuZCB6dSB1bm1pdHRlbGJhciBzaWNodGJhcmVcclxuLy8gWnVzdGFlbmRlIGZ1ZXIgZWluIE1lbnVlLlxyXG4vLyAgIHN1YnR5cGVzICAgIC0gZGllIFN1YnR5cGVuIGRlcyBUWVBzIGluIEtsYW1tZXJuLCBqZSBpbiBzZWluZXIgRmFyYmVcclxuLy8gICAgICAgICAgICAgICAgICh3aWUgZGllIFZvcnNjaGF1IGltIHNlcGFyYXRlbiBUWVAtUGlja2VyLCBzaWVoZVxyXG4vLyAgICAgICAgICAgICAgICAgcmVuZGVyU3VidHlwZVByZXZpZXcgaW4gdHlwZS1waWNrZXIuanMpXHJcbi8vICAgZGVzY3JpcHRpb24gLSBUZXh0ZmVsZCB6dXIgQmVhcmJlaXR1bmcgZGVyIFRZUC1CZXNjaHJlaWJ1bmdcclxuLy8gICBub25lICAgICAgICAtIG5pY2h0cywgZGVyIE5hbWUgYmVrb21tdCBkaWUgZ2FuemUgWmVpbGVcclxuLy8gRGllIFJlaWhlbmZvbGdlIGlzdCB6dWdsZWljaCBkaWUgZGVzIER1cmNoc2NoYWx0ZW5zLCBkZXIgZXJzdGUgRWludHJhZyBkZXJcclxuLy8gU3RhbmRhcmQgKERFRkFVTFRfU0VDT05EQVJZKTogZGllIFN1YnR5cGVuIHN0ZWhlbiBzb25zdCBuaXJnZW5kcyBpbiBkZXJcclxuLy8gTGlzdGUsIGRpZSBCZXNjaHJlaWJ1bmcgZGFnZWdlbiBhdWNoIGluIGRlciBEZXRhaWxhbnNpY2h0IGRlcyBUWVBzLlxyXG5jb25zdCBTRUNPTkRBUllfTU9ERVMgPSBbXHJcbiAgeyBtb2RlOiBcInN1YnR5cGVzXCIsIHRpdGxlOiBcIlN1YnR5cGVuXCIsIGljb246IFwibGlzdC10cmVlXCIgfSxcclxuICB7IG1vZGU6IFwiZGVzY3JpcHRpb25cIiwgdGl0bGU6IFwiQmVzY2hyZWlidW5nXCIsIGljb246IFwidGV4dC1jdXJzb3ItaW5wdXRcIiB9LFxyXG4gIHsgbW9kZTogXCJub25lXCIsIHRpdGxlOiBcIk5pY2h0c1wiLCBpY29uOiBcIm1pbnVzXCIgfSxcclxuXTtcclxuXHJcbmNvbnN0IFNPUlRfT1BUSU9OUyA9IFtcclxuICAvLyBOdXR6dCAoYW5kZXJzIGFscyBkaWUgXHUwMEZDYnJpZ2VuIE1vZGkpIGtlaW5lbiBlaWdlbmVuIFZlcmdsZWljaCwgc29uZGVybiBkaWVcclxuICAvLyBSZWloZW5mb2xnZSB2b24gcGx1Z2luLnNldHRpbmdzLnR5cGVzIHNlbGJzdCBhbHMgU3BlaWNoZXJvcnQgLSBzaWVoZVxyXG4gIC8vIHJlbmRlcigpIHVuZCByZW5kZXJSZWdpc3RlcmVkSXRlbSgpIGZcdTAwRkNyIGRhcyBwZXIgRHJhZyAmIERyb3AgdmVyc2NoaWViYmFyZVxyXG4gIC8vIFJlbmRlcm4sIGRhcyBnZW5hdSBkYXJhdWYgYXVmYmF1dC4gQmV3dXNzdCBhbHMgZXJzdGUgT3B0aW9uIChzaWVoZVxyXG4gIC8vIHNob3dTb3J0TWVudSkgLSBlaWdlbmUsIG9iZXJzdGUgR3J1cHBlIGltIE1lblx1MDBGQyBzdGF0dCBlaW5zb3J0aWVydCB6d2lzY2hlblxyXG4gIC8vIGRpZSBlaWdlbnRsaWNoZW4gU29ydGllcmtyaXRlcmllbi5cclxuICB7IG1vZGU6IFwibWFudWFsXCIsIHRpdGxlOiBcIk1hbnVlbGwgKERyYWcgJiBEcm9wKVwiIH0sXHJcbiAgeyBtb2RlOiBcImNvdW50LWRlc2NcIiwgdGl0bGU6IFwiSFx1MDBFNHVmaWdrZWl0IChhYnN0ZWlnZW5kKVwiIH0sXHJcbiAgeyBtb2RlOiBcImNvdW50LWFzY1wiLCB0aXRsZTogXCJIXHUwMEU0dWZpZ2tlaXQgKGF1ZnN0ZWlnZW5kKVwiIH0sXHJcbiAgeyBtb2RlOiBcIm5hbWUtYXNjXCIsIHRpdGxlOiBcIk5hbWUgKEEgYmlzIFopXCIgfSxcclxuICB7IG1vZGU6IFwibmFtZS1kZXNjXCIsIHRpdGxlOiBcIk5hbWUgKFogYmlzIEEpXCIgfSxcclxuICB7IG1vZGU6IFwiY29sb3ItYXNjXCIsIHRpdGxlOiBcIkZhcmJlIChSb3QgXHUyMTkyIFZpb2xldHQpXCIgfSxcclxuICB7IG1vZGU6IFwiY29sb3ItZGVzY1wiLCB0aXRsZTogXCJGYXJiZSAoVmlvbGV0dCBcdTIxOTIgUm90KVwiIH0sXHJcbl07XHJcblxyXG4vLyBTY2hyZWlidCBkZW4gVFlQLVdlcnQgYWxsZXIgTm90aXplbiBtaXQgZGVtIFNjaGxcdTAwRkNzc2VsIG9sZEtleSAoc2llaGVcclxuLy8gdHlwZUtleU9mIGluIHR5cC1pbmRleC5qcyAtIGZcdTAwRkNyIGVpbmVuIHNhdWJlcmVuIFdlcnQgZGVyIFRZUC1OYW1lIHNlbGJzdCxcclxuLy8gc29uc3QgZGllIFJvaGZvcm0sIHouIEIuIFwiIGJ1Y2hcIiBvZGVyIFwiW1BFUlNPTiwgQlVDSF1cIikgYXVmIGRlbiBFaW56ZWx3ZXJ0XHJcbi8vIG5ld1ZhbHVlIHVtLiBHZW51dHp0IGZcdTAwRkNyIHJlZ2lzdGVyVHlwZSgpIChCZXJlaW5pZ2VuKSwgVW1iZW5lbm5lbiB1bmRcclxuLy8gWnVzYW1tZW5sZWdlbi4gRGVyIEFiZ2xlaWNoIGVyZm9sZ3QgZXhha3QgXHUwMEZDYmVyIGRlbiBTY2hsXHUwMEZDc3NlbCwgZWluZSBMaXN0ZVxyXG4vLyB3aXJkIGRhYmVpIGFsc28gYWxzIEdhbnplcyBlcnNldHp0IHN0YXR0IG51ciBlaW5lciBpaHJlciBFaW50clx1MDBFNGdlLiBFaW5cclxuLy8gYWJ3ZWljaGVuZCBnZXNjaHJpZWJlbmVyIFByb3BlcnR5LU5hbWUgKFwidHlwXCIpIHdpcmQgZGFiZWkgenUgXCJUWVBcIi5cclxuYXN5bmMgZnVuY3Rpb24gcmVuYW1lVHlwZUluTm90ZXMocGx1Z2luLCBvbGRLZXksIG5ld1ZhbHVlKSB7XHJcbiAgbGV0IGNoYW5nZWQgPSAwO1xyXG4gIGZvciAoY29uc3QgZmlsZSBvZiBwbHVnaW4udHlwSW5kZXguZmlsZXNXaXRoVHlwZShvbGRLZXkpKSB7XHJcbiAgICBsZXQgbWF0Y2hlZCA9IGZhbHNlO1xyXG4gICAgYXdhaXQgcGx1Z2luLmFwcC5maWxlTWFuYWdlci5wcm9jZXNzRnJvbnRNYXR0ZXIoZmlsZSwgKGZyb250bWF0dGVyKSA9PiB7XHJcbiAgICAgIGlmICh0eXBlS2V5T2YocHJvcGVydHlWYWx1ZShmcm9udG1hdHRlciwgVFlQX1BST1BFUlRZKSkgIT09IG9sZEtleSkgcmV0dXJuO1xyXG4gICAgICBzZXRDYW5vbmljYWxQcm9wZXJ0eShmcm9udG1hdHRlciwgVFlQX1BST1BFUlRZLCBuZXdWYWx1ZSk7XHJcbiAgICAgIG1hdGNoZWQgPSB0cnVlO1xyXG4gICAgfSk7XHJcbiAgICBpZiAobWF0Y2hlZCkgY2hhbmdlZCsrO1xyXG4gIH1cclxuICByZXR1cm4gY2hhbmdlZDtcclxufVxyXG5cclxuLy8gQmVyZWluaWd0ZSBGb3JtIGVpbmVzIFJvaHdlcnRzIGZcdTAwRkNyIHJlZ2lzdGVyVHlwZSgpOiBFaW56ZWx3ZXJ0IGdldHJpbW10IHVuZFxyXG4vLyBncm9cdTAwREYgZ2VzY2hyaWViZW47IGVpbmUgTGlzdGUgd2lyZCBiZXd1c3N0IE5JQ0hUIGF1ZiBlaW5lbiBpaHJlciBFaW50clx1MDBFNGdlXHJcbi8vIHJlZHV6aWVydCwgc29uZGVybiBhbHMgR2FuemVzIHp1IGVpbmVtIEVpbnplbHdlcnQgXCJBLCBCXCIgKFJvaGZvcm0pIC0gZGFyYXVzXHJcbi8vIGxcdTAwRTRzc3Qgc2ljaCBkZXIgVFlQIGRhbmFjaCBwZXIgVW1iZW5lbm5lbiBnZXppZWx0IGluIGVpbmVuIGFuZGVyZW4gXHUwMEZDYmVyZlx1MDBGQ2hyZW5cclxuLy8gKHNpZWhlIHN0YXJ0RGV0YWlsUmVuYW1lL3Nob3dNZXJnZUNvbmZpcm0pLiBub3JtYWxpemU6IFNjaHJlaWJ3ZWlzZSBkZXJcclxuLy8gZWluemVsbmVuIE5hbWVuIC0gZlx1MDBGQ3IgU3VidHlwZW4gbm9ybWFsaXplU3VidHlwZU5hbWUgKHNpZWhlIHN1YnR5cGVzLmpzKS5cclxuZnVuY3Rpb24gbm9ybWFsaXplUmF3VHlwZShyYXcsIG5vcm1hbGl6ZSA9IG5vcm1hbGl6ZVR5cGVOYW1lKSB7XHJcbiAgaWYgKEFycmF5LmlzQXJyYXkocmF3KSkge1xyXG4gICAgcmV0dXJuIHJhd1xyXG4gICAgICAubWFwKCh2KSA9PiBub3JtYWxpemUoU3RyaW5nKHYgPz8gXCJcIikpKVxyXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pXHJcbiAgICAgIC5qb2luKFwiLCBcIik7XHJcbiAgfVxyXG4gIHJldHVybiBub3JtYWxpemUoU3RyaW5nKHJhdykpO1xyXG59XHJcblxyXG4vLyBBbnplaWdlIGVpbmVzIHVucmVnaXN0cmllcnRlbiBTY2hsXHUwMEZDc3NlbHM6IFJhbmRsZWVyemVpY2hlbiB3XHUwMEU0cmVuIGFscyByZWluZXJcclxuLy8gVGV4dCB1bnNpY2h0YmFyLCBkYWhlciBkYW5uIGluIEFuZlx1MDBGQ2hydW5nc3plaWNoZW4uIExpc3RlbiB0cmFnZW4gaWhyZVxyXG4vLyBlY2tpZ2VuIEtsYW1tZXJuIHNjaG9uIGltIFNjaGxcdTAwRkNzc2VsLlxyXG5mdW5jdGlvbiBkaXNwbGF5VHlwZUtleSh0eXBlS2V5KSB7XHJcbiAgcmV0dXJuIHR5cGVLZXkgIT09IHR5cGVLZXkudHJpbSgpID8gYFwiJHt0eXBlS2V5fVwiYCA6IHR5cGVLZXk7XHJcbn1cclxuXHJcbi8vIFRZUC1OYW1lIGluIEZsaWVcdTAwREZ0ZXh0IChCZXN0XHUwMEU0dGlndW5ncy1Nb2RhbGUpOiBlaW5nZWZcdTAwRTRyYnRlciBOYW1lLCB3ZW5uIFwiVFlQXHJcbi8vIFZpZXcgZWluZlx1MDBFNHJiZW5cIiBha3RpdiBpc3QgKGNvbG9yVmlld3MudHlwTGlzdCksIHNvbnN0IGVpbiBGYXJicHVua3QgZGF2b3JcclxuLy8gcGx1cyBub3JtYWxlciBUZXh0IC0gZGllc2VsYmUgVW1zY2hhbHR1bmcgd2llIGltIFRZUC1QaWNrZXIgKHNpZWhlXHJcbi8vIHJlbmRlclN1Z2dlc3Rpb24gaW4gdHlwZS1waWNrZXIuanMpIHVuZCBpbiBkZXIgVFlQLUxpc3RlIHNlbGJzdC4gY29sb3Igd2lyZFxyXG4vLyB2b20gQXVmcnVmZXIgXHUwMEZDYmVyZ2ViZW4gc3RhdHQgaGllciBuYWNoZ2VzY2hsYWdlbiwgZGFtaXQgei4gQi4gYmVpIGVpbmVyXHJcbi8vIFVtYmVuZW5udW5nIGJld3Vzc3QgZlx1MDBGQ3IgYWx0IFVORCBuZXUgZGllc2VsYmUgKGRpZSBkZXMgYWx0ZW4gTmFtZW5zLCBkaWUgbmFjaFxyXG4vLyBkZW0gVW1iZW5lbm5lbiBlcmhhbHRlbiBibGVpYnQpIEZhcmJlIHZlcndlbmRldCB3ZXJkZW4ga2Fubi4gY29sb3IgbnVsbCA9XHJcbi8vIFRZUCBvaG5lIGVpZ2VuZSBGYXJiZSAoTmFtZSB1bmdlZlx1MDBFNHJidCBiencuIFB1bmt0IGFscyBob2hsZXIgZ3JhdWVyIFJpbmcpLlxyXG5mdW5jdGlvbiBhcHBlbmRUeXBlTmFtZShwYXJlbnRFbCwgcGx1Z2luLCB0eXBlLCBjb2xvcikge1xyXG4gIGlmIChwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0KSB7XHJcbiAgICBjb25zdCBuYW1lRWwgPSBwYXJlbnRFbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLWlubGluZS1uYW1lXCIsIHRleHQ6IHR5cGUgfSk7XHJcbiAgICBpZiAoY29sb3IpIG5hbWVFbC5zdHlsZS5jb2xvciA9IGNvbG9yO1xyXG4gIH0gZWxzZSB7XHJcbiAgICBwYWludENvbG9yRG90KHBhcmVudEVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtaW5saW5lLWRvdFwiIH0pLCBjb2xvciA/PyBERUZBVUxUX1RZUEVfQ09MT1IsICFjb2xvcik7XHJcbiAgICBwYXJlbnRFbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLWlubGluZS1uYW1lXCIsIHRleHQ6IHR5cGUgfSk7XHJcbiAgfVxyXG59XHJcblxyXG5jbGFzcyBDb25maXJtRGVsZXRlVHlwZU1vZGFsIGV4dGVuZHMgTW9kYWwge1xyXG4gIGNvbnN0cnVjdG9yKHBsdWdpbiwgdHlwZSwgb25Db25maXJtKSB7XHJcbiAgICBzdXBlcihwbHVnaW4uYXBwKTtcclxuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xyXG4gICAgdGhpcy50eXBlID0gdHlwZTtcclxuICAgIHRoaXMub25Db25maXJtID0gb25Db25maXJtO1xyXG4gIH1cclxuXHJcbiAgb25PcGVuKCkge1xyXG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XHJcbiAgICB0aGlzLm1vZGFsRWwuYWRkQ2xhc3MoXCJmcmVkLWNvbmZpcm0tZGVsZXRlLW1vZGFsXCIpO1xyXG4gICAgY29uc3QgcCA9IGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIik7XHJcbiAgICBwLmFwcGVuZFRleHQoXCJUeXAgXCIpO1xyXG4gICAgYXBwZW5kVHlwZU5hbWUocCwgdGhpcy5wbHVnaW4sIHRoaXMudHlwZSwgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0aGlzLnR5cGVdID8/IG51bGwpO1xyXG4gICAgcC5hcHBlbmRUZXh0KFwiIHdpcmtsaWNoIGxcdTAwRjZzY2hlbj9cIik7XHJcblxyXG4gICAgY29uc3QgYnV0dG9uUm93ID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJtb2RhbC1idXR0b24tY29udGFpbmVyXCIgfSk7XHJcbiAgICBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkFiYnJlY2hlblwiIH0pLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xyXG5cclxuICAgIGNvbnN0IGNvbmZpcm1CdG4gPSBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IFwibW9kLXdhcm5pbmdcIiwgdGV4dDogXCJMXHUwMEY2c2NoZW5cIiB9KTtcclxuICAgIGNvbmZpcm1CdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgdGhpcy5jbG9zZSgpO1xyXG4gICAgICB0aGlzLm9uQ29uZmlybSgpO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBvbkNsb3NlKCkge1xyXG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcclxuICB9XHJcbn1cclxuXHJcbi8vIFZvciBkZW0gXCJVbWJlbmVubmVuIChpbmtsLiBOb3RpemVuIGFucGFzc2VuKVwiLUJ1dHRvbiAoc2llaGUgcmVuZGVyVHlwZVNldHRpbmdzXHJcbi8vIHVuZCBzdGFydERldGFpbFJlbmFtZSkgLSBpbSBHZWdlbnNhdHogenVyIG5vcm1hbGVuIFVtYmVuZW5udW5nLCBkaWUgbnVyIGRpZVxyXG4vLyBQbHVnaW4tRWluc3RlbGx1bmdlbiBcdTAwRTRuZGVydCwgc2NocmVpYnQgZGllc2UgVmFyaWFudGUgenVzXHUwMEU0dHpsaWNoIGRlbiBUWVAtV2VydFxyXG4vLyBhbGxlciBiZXRyb2ZmZW5lbiBOb3RpemVuIHVtLiBEYXMgaXN0IGVpbiBCdWxrLVNjaHJlaWJ2b3JnYW5nIFx1MDBGQ2JlclxyXG4vLyBwb3RlbnppZWxsIHZpZWxlIERhdGVpZW4sIGRhaGVyIGhpZXIgZWluZSBleHBsaXppdGUgQmVzdFx1MDBFNHRpZ3VuZyBkYXZvci5cclxuY2xhc3MgQ29uZmlybVJlbmFtZVR5cGVNb2RhbCBleHRlbmRzIE1vZGFsIHtcclxuICBjb25zdHJ1Y3RvcihwbHVnaW4sIG9sZFR5cGUsIG5ld1R5cGUsIGFmZmVjdGVkQ291bnQsIG9uQ29uZmlybSwgb25DYW5jZWwpIHtcclxuICAgIHN1cGVyKHBsdWdpbi5hcHApO1xyXG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XHJcbiAgICB0aGlzLm9sZFR5cGUgPSBvbGRUeXBlO1xyXG4gICAgdGhpcy5uZXdUeXBlID0gbmV3VHlwZTtcclxuICAgIHRoaXMuYWZmZWN0ZWRDb3VudCA9IGFmZmVjdGVkQ291bnQ7XHJcbiAgICB0aGlzLm9uQ29uZmlybSA9IG9uQ29uZmlybTtcclxuICAgIHRoaXMub25DYW5jZWwgPSBvbkNhbmNlbDtcclxuICAgIHRoaXMuY29uZmlybWVkID0gZmFsc2U7XHJcbiAgfVxyXG5cclxuICBvbk9wZW4oKSB7XHJcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcclxuICAgIHRoaXMubW9kYWxFbC5hZGRDbGFzcyhcImZyZWQtY29uZmlybS1kZWxldGUtbW9kYWxcIik7XHJcbiAgICAvLyBEaWVzZWxiZSBGYXJiZSBmXHUwMEZDciBhbHQgdW5kIG5ldSAoZGllIGRlcyBhbHRlbiBOYW1lbnMpIC0gZGVyIG5ldWUgTmFtZVxyXG4gICAgLy8gaGF0IHZvciBkZW0gZWlnZW50bGljaGVuIFVtYmVuZW5uZW4gbm9jaCBrZWluZW4gZWlnZW5lbiBFaW50cmFnIGluXHJcbiAgICAvLyB0eXBlQ29sb3JzLCBcdTAwRkNiZXJuaW1tdCBhYmVyIGRpZSBGYXJiZSBkZXMgYWx0ZW4gKHNpZWhlIGFwcGx5UmVuYW1lKS5cclxuICAgIGNvbnN0IGNvbG9yID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0aGlzLm9sZFR5cGVdID8/IG51bGw7XHJcbiAgICBjb25zdCBwID0gY29udGVudEVsLmNyZWF0ZUVsKFwicFwiKTtcclxuICAgIHAuYXBwZW5kVGV4dChcIlRZUCBcIik7XHJcbiAgICBhcHBlbmRUeXBlTmFtZShwLCB0aGlzLnBsdWdpbiwgdGhpcy5vbGRUeXBlLCBjb2xvcik7XHJcbiAgICBwLmFwcGVuZFRleHQoXCIgaW4gXCIpO1xyXG4gICAgYXBwZW5kVHlwZU5hbWUocCwgdGhpcy5wbHVnaW4sIHRoaXMubmV3VHlwZSwgY29sb3IpO1xyXG4gICAgcC5hcHBlbmRUZXh0KGAgdW1iZW5lbm5lbiB1bmQgJHt0aGlzLmFmZmVjdGVkQ291bnR9IE5vdGl6KGVuKSBlbnRzcHJlY2hlbmQgYW5wYXNzZW4/YCk7XHJcblxyXG4gICAgY29uc3QgYnV0dG9uUm93ID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJtb2RhbC1idXR0b24tY29udGFpbmVyXCIgfSk7XHJcbiAgICBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkFiYnJlY2hlblwiIH0pLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xyXG5cclxuICAgIGNvbnN0IGNvbmZpcm1CdG4gPSBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IFwibW9kLWN0YVwiLCB0ZXh0OiBcIlVtYmVuZW5uZW5cIiB9KTtcclxuICAgIGNvbmZpcm1CdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgdGhpcy5jb25maXJtZWQgPSB0cnVlO1xyXG4gICAgICB0aGlzLmNsb3NlKCk7XHJcbiAgICAgIHRoaXMub25Db25maXJtKCk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIC8vIERlY2t0IHNvd29obCBcIkFiYnJlY2hlblwiLUtsaWNrIGFscyBhdWNoIEVzY2FwZS9LbGljayBkYW5lYmVuIGFiIC0gYW5hbG9nXHJcbiAgLy8genVtIENhbmNlbC1IYW5kbGluZyBpbiBUeXBQaWNrZXJNb2RhbC5cclxuICBvbkNsb3NlKCkge1xyXG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcclxuICAgIGlmICghdGhpcy5jb25maXJtZWQpIHRoaXMub25DYW5jZWw/LigpO1xyXG4gIH1cclxufVxyXG5cclxuLy8gVW1iZW5lbm5lbiBhdWYgZGVuIE5hbWVuIGVpbmVzIGJlcmVpdHMgcmVnaXN0cmllcnRlbiBUWVBzIChzaWVoZVxyXG4vLyBzdGFydERldGFpbFJlbmFtZSkgLSBzdGF0dCBkaWUgVW1iZW5lbm51bmcgc3RpbGxzY2h3ZWlnZW5kIHp1IHZlcndlcmZlbixcclxuLy8gYW5iaWV0ZW4sIGJlaWRlIHp1c2FtbWVuenVsZWdlbiAoc2llaGUgbWVyZ2VUeXBlKS4gU2NocmVpYnQgaW1tZXIgYXVjaCBkaWVcclxuLy8gTm90aXplbiB1bSwgdW5hYmhcdTAwRTRuZ2lnIGRhdm9uLCBcdTAwRkNiZXIgd2VsY2hlbiBkZXIgYmVpZGVuIFVtYmVuZW5uZW4tQnV0dG9ucyBlc1xyXG4vLyBhdXNnZWxcdTAwRjZzdCB3dXJkZTogZWluIFp1c2FtbWVubGVnZW4gbnVyIGluIGRlbiBFaW5zdGVsbHVuZ2VuIGxpZVx1MDBERmUgZGllXHJcbi8vIE5vdGl6ZW4gZGVzIFF1ZWxsLVRZUHMgYWxzIHVucmVnaXN0cmllcnRlbiBFaW50cmFnIHp1clx1MDBGQ2NrLlxyXG5jbGFzcyBDb25maXJtTWVyZ2VUeXBlTW9kYWwgZXh0ZW5kcyBDb25maXJtUmVuYW1lVHlwZU1vZGFsIHtcclxuICBvbk9wZW4oKSB7XHJcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcclxuICAgIHRoaXMubW9kYWxFbC5hZGRDbGFzcyhcImZyZWQtY29uZmlybS1kZWxldGUtbW9kYWxcIik7XHJcbiAgICBjb25zdCBzZXR0aW5ncyA9IHRoaXMucGx1Z2luLnNldHRpbmdzO1xyXG4gICAgY29uc3QgcCA9IGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIik7XHJcbiAgICBwLmFwcGVuZFRleHQoXCJUWVAgXCIpO1xyXG4gICAgYXBwZW5kVHlwZU5hbWUocCwgdGhpcy5wbHVnaW4sIHRoaXMubmV3VHlwZSwgc2V0dGluZ3MudHlwZUNvbG9yc1t0aGlzLm5ld1R5cGVdID8/IG51bGwpO1xyXG4gICAgcC5hcHBlbmRUZXh0KFwiIGV4aXN0aWVydCBiZXJlaXRzLiBcIik7XHJcbiAgICBhcHBlbmRUeXBlTmFtZShwLCB0aGlzLnBsdWdpbiwgdGhpcy5vbGRUeXBlLCBzZXR0aW5ncy50eXBlQ29sb3JzW3RoaXMub2xkVHlwZV0gPz8gbnVsbCk7XHJcbiAgICBwLmFwcGVuZFRleHQoXCIgZGFtaXQgenVzYW1tZW5sZWdlbj9cIik7XHJcblxyXG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwicFwiLCB7XHJcbiAgICAgIHRleHQ6XHJcbiAgICAgICAgYCR7dGhpcy5hZmZlY3RlZENvdW50fSBOb3Rpeihlbikgd2VyZGVuIGF1ZiAke3RoaXMubmV3VHlwZX0gdW1nZXN0ZWxsdC4gYCArXHJcbiAgICAgICAgYEZhcmJlLCBCZXNjaHJlaWJ1bmcgdW5kIFRZUC1Gcm9udG1hdHRlciB2b24gJHt0aGlzLm9sZFR5cGV9IGVudGZhbGxlbiwgYCArXHJcbiAgICAgICAgYHNlaW5lIFN1YnR5cGVuIHdlcmRlbiBcdTAwRkNiZXJub21tZW4gKGdsZWljaG5hbWlnZSBTdWJ0eXAtQmxcdTAwRjZja2UgenVzYW1tZW5nZWZcdTAwRkNocnQpLmAsXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBidXR0b25Sb3cgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcIm1vZGFsLWJ1dHRvbi1jb250YWluZXJcIiB9KTtcclxuICAgIGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiQWJicmVjaGVuXCIgfSkuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY2xvc2UoKSk7XHJcblxyXG4gICAgY29uc3QgY29uZmlybUJ0biA9IGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IGNsczogXCJtb2Qtd2FybmluZ1wiLCB0ZXh0OiBcIlp1c2FtbWVubGVnZW5cIiB9KTtcclxuICAgIGNvbmZpcm1CdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgdGhpcy5jb25maXJtZWQgPSB0cnVlO1xyXG4gICAgICB0aGlzLmNsb3NlKCk7XHJcbiAgICAgIHRoaXMub25Db25maXJtKCk7XHJcbiAgICB9KTtcclxuICB9XHJcbn1cclxuXHJcbi8vIEJlc3RcdTAwRTR0aWd1bmdlbiBydW5kIHVtIFN1YnR5cGVuIChzaWVoZSByZW5kZXJTZWN0aW9uRm9vdGVyKTogc2NobGljaHRlciBUZXh0XHJcbi8vIHN0YXR0IGVpbmdlZlx1MDBFNHJidGVyIFRZUC1OYW1lbiwgc29uc3Qgd2llIGRpZSBUWVAtTW9kYWxlIG9iZW4uIG9uQ2FuY2VsIGdyZWlmdFxyXG4vLyB3aWUgZG9ydCBhdWNoIGJlaSBFc2NhcGUvS2xpY2sgZGFuZWJlbi5cclxuY2xhc3MgQ29uZmlybVN1YnR5cGVNb2RhbCBleHRlbmRzIE1vZGFsIHtcclxuICBjb25zdHJ1Y3RvcihhcHAsIHsgcGFyYWdyYXBocywgY29uZmlybVRleHQsIGNvbmZpcm1DbHMsIG9uQ29uZmlybSwgb25DYW5jZWwgfSkge1xyXG4gICAgc3VwZXIoYXBwKTtcclxuICAgIHRoaXMucGFyYWdyYXBocyA9IHBhcmFncmFwaHM7XHJcbiAgICB0aGlzLmNvbmZpcm1UZXh0ID0gY29uZmlybVRleHQ7XHJcbiAgICB0aGlzLmNvbmZpcm1DbHMgPSBjb25maXJtQ2xzO1xyXG4gICAgdGhpcy5vbkNvbmZpcm0gPSBvbkNvbmZpcm07XHJcbiAgICB0aGlzLm9uQ2FuY2VsID0gb25DYW5jZWw7XHJcbiAgICB0aGlzLmNvbmZpcm1lZCA9IGZhbHNlO1xyXG4gIH1cclxuXHJcbiAgb25PcGVuKCkge1xyXG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XHJcbiAgICB0aGlzLm1vZGFsRWwuYWRkQ2xhc3MoXCJmcmVkLWNvbmZpcm0tZGVsZXRlLW1vZGFsXCIpO1xyXG4gICAgZm9yIChjb25zdCB0ZXh0IG9mIHRoaXMucGFyYWdyYXBocykgY29udGVudEVsLmNyZWF0ZUVsKFwicFwiLCB7IHRleHQgfSk7XHJcblxyXG4gICAgY29uc3QgYnV0dG9uUm93ID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJtb2RhbC1idXR0b24tY29udGFpbmVyXCIgfSk7XHJcbiAgICBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkFiYnJlY2hlblwiIH0pLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xyXG5cclxuICAgIGNvbnN0IGNvbmZpcm1CdG4gPSBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IHRoaXMuY29uZmlybUNscywgdGV4dDogdGhpcy5jb25maXJtVGV4dCB9KTtcclxuICAgIGNvbmZpcm1CdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgdGhpcy5jb25maXJtZWQgPSB0cnVlO1xyXG4gICAgICB0aGlzLmNsb3NlKCk7XHJcbiAgICAgIHRoaXMub25Db25maXJtKCk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIG9uQ2xvc2UoKSB7XHJcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xyXG4gICAgaWYgKCF0aGlzLmNvbmZpcm1lZCkgdGhpcy5vbkNhbmNlbD8uKCk7XHJcbiAgfVxyXG59XHJcblxyXG5jbGFzcyBUeXBWaWV3IGV4dGVuZHMgSXRlbVZpZXcge1xyXG4gIGNvbnN0cnVjdG9yKGxlYWYsIHBsdWdpbikge1xyXG4gICAgc3VwZXIobGVhZik7XHJcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcclxuICB9XHJcblxyXG4gIGdldFZpZXdUeXBlKCkge1xyXG4gICAgcmV0dXJuIFZJRVdfVFlQRV9UWVA7XHJcbiAgfVxyXG5cclxuICBnZXREaXNwbGF5VGV4dCgpIHtcclxuICAgIHJldHVybiBcIlRZUFwiO1xyXG4gIH1cclxuXHJcbiAgZ2V0SWNvbigpIHtcclxuICAgIHJldHVybiBcInNoYXBlc1wiO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgb25PcGVuKCkge1xyXG4gICAgdGhpcy5pc0VkaXRpbmcgPSBmYWxzZTtcclxuICAgIHRoaXMuc2VsZWN0ZWRUeXBlID0gbnVsbDtcclxuICAgIHRoaXMuZnJvbnRtYXR0ZXJCbG9ja3MgPSBudWxsO1xyXG4gICAgdGhpcy5mcm9udG1hdHRlckVkaXRvcnMgPSBbXTtcclxuXHJcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xyXG4gICAgdGhpcy5jb250ZW50RWwuYWRkQ2xhc3MoXCJmcmVkLXR5cC12aWV3XCIpO1xyXG5cclxuICAgIHRoaXMucmVnaXN0ZXJEb21FdmVudCh0aGlzLmNvbnRlbnRFbCwgXCJrZXlkb3duXCIsIChldmVudCkgPT4ge1xyXG4gICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVzY2FwZVwiICYmIHRoaXMuc2VsZWN0ZWRUeXBlICE9PSBudWxsKSB0aGlzLmNsb3NlVHlwZVNldHRpbmdzKCk7XHJcbiAgICB9KTtcclxuICAgIHRoaXMucmVuZGVyKCk7XHJcbiAgfVxyXG5cclxuICBhc3luYyBvbkNsb3NlKCkge1xyXG4gICAgdGhpcy5jbG9zZVN1YnR5cGVDb2xvclBvcG92ZXI/LigpO1xyXG4gIH1cclxuXHJcbiAgb3BlblNlYXJjaCh0eXBlKSB7XHJcbiAgICBjb25zdCBnbG9iYWxTZWFyY2ggPSB0aGlzLnBsdWdpbi5hcHAuaW50ZXJuYWxQbHVnaW5zLmdldFBsdWdpbkJ5SWQoXCJnbG9iYWwtc2VhcmNoXCIpO1xyXG4gICAgaWYgKCFnbG9iYWxTZWFyY2gpIHJldHVybjtcclxuICAgIC8vIFwia2VpbiBUeXBcIiB0clx1MDBFNGZlIG9obmUgRmlsdGVyIGF1Y2ggYWxsZSBOaWNodC1NYXJrZG93bi1EYXRlaWVuIChkaWUgbmF0dXJnZW1cdTAwRTRcdTAwREZcclxuICAgIC8vIG5pZSBlaW5lIEZyb250bWF0dGVyLVByb3BlcnR5IGhhYmVuIGtcdTAwRjZubmVuKSAtIGRhaGVyIGV4cGxpeml0IGF1ZiAubWQgZWluZ3Jlbnplbi5cclxuICAgIC8vIEZcdTAwRkNyIGVpbmUgTGlzdGUgKHVucmVnaXN0cmllcnRlciBTY2hsXHUwMEZDc3NlbCBcIltBLCBCXVwiKSBnaWJ0IGVzIGtlaW5lIGV4YWt0ZVxyXG4gICAgLy8gU3VjaHN5bnRheCAtIGRhbm4gbmFjaCBOb3RpemVuIHN1Y2hlbiwgZGllIGFsbGUgaWhyZSBFaW50clx1MDBFNGdlIHRyYWdlbi5cclxuICAgIGNvbnN0IHF1ZXJ5ID0gdHlwZSA9PT0gbnVsbCA/IGAtW1wiJHtUWVBfUFJPUEVSVFl9XCJdIGZpbGU6Lm1kYCA6IHRoaXMudHlwZUNsYXVzZSh0eXBlKTtcclxuICAgIGdsb2JhbFNlYXJjaC5pbnN0YW5jZS5vcGVuR2xvYmFsU2VhcmNoKHF1ZXJ5KTtcclxuICB9XHJcblxyXG4gIC8vIFN1Y2hrbGF1c2VsIGZcdTAwRkNyIGVpbmVuIFRZUC1TY2hsXHUwMEZDc3NlbC4gRlx1MDBGQ3IgZWluZSBMaXN0ZSAodW5yZWdpc3RyaWVydGVyXHJcbiAgLy8gU2NobFx1MDBGQ3NzZWwgXCJbQSwgQl1cIikgZ2lidCBlcyBrZWluZSBleGFrdGUgU3VjaHN5bnRheCAtIGRhbm4gbmFjaCBOb3RpemVuXHJcbiAgLy8gc3VjaGVuLCBkaWUgYWxsZSBpaHJlIEVpbnRyXHUwMEU0Z2UgdHJhZ2VuLiBBdWNoIHZvbiBvcGVuU3VidHlwZVNlYXJjaCgpXHJcbiAgLy8gZ2VudXR6dDogc2VpdCBkaWUgbmljaHQgZXJmYXNzdGVuIFN1YnR5cGVuIGluIGRlciBMaXN0ZSBzdGVoZW4sIGthbm4gZG9ydFxyXG4gIC8vIGF1Y2ggZWluIG5pY2h0IGVyZmFzc3RlciAodW5kIGRhbWl0IHVuc2F1YmVyZXIpIFRZUC1TY2hsXHUwMEZDc3NlbCBhbmtvbW1lbi5cclxuICB0eXBlQ2xhdXNlKHR5cGUpIHtcclxuICAgIGNvbnN0IHJhdyA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnJhd1ZhbHVlT2YodHlwZSk7XHJcbiAgICByZXR1cm4gQXJyYXkuaXNBcnJheShyYXcpXHJcbiAgICAgID8gcmF3Lm1hcCgodikgPT4gYFtcIiR7VFlQX1BST1BFUlRZfVwiOlwiJHtTdHJpbmcodiA/PyBcIlwiKS50cmltKCl9XCJdYCkuam9pbihcIiBcIilcclxuICAgICAgOiBgW1wiJHtUWVBfUFJPUEVSVFl9XCI6XCIke3R5cGV9XCJdYDtcclxuICB9XHJcblxyXG4gIC8vIHR5cGVLZXkga29tbXQgMToxIGF1cyBkZW4gdGF0c1x1MDBFNGNobGljaGVuIEZyb250bWF0dGVyLVdlcnRlbiAoc2llaGVcclxuICAvLyB1bnJlZ2lzdGVyZWRSb3dzIGluIHJlbmRlcigpIHVuZCB0eXBlS2V5T2YgaW4gdHlwLWluZGV4LmpzKSAtIGthbm4gYWxzb1xyXG4gIC8vIGtsZWluIGdlc2NocmllYmVuIHNlaW4sIFJhbmRsZWVyemVpY2hlbiB0cmFnZW4gb2RlciBlaW5lIExpc3RlIHNlaW4uIFRZUGVuXHJcbiAgLy8gd2VyZGVuIGFiZXIgaW1tZXIgYWxzIHNhdWJlcmVyIEVpbnplbHdlcnQgaW4gR3JvXHUwMERGYnVjaHN0YWJlbiBnZWZcdTAwRkNocnQgLVxyXG4gIC8vIHJlZ2lzdHJpZXJ0IHdpcmQgZGVzaGFsYiBkaWUgYmVyZWluaWd0ZSBGb3JtIChzaWVoZSBub3JtYWxpemVSYXdUeXBlKSwgdW5kXHJcbiAgLy8gZGllIGJldHJvZmZlbmVuIE5vdGl6ZW4gd2VyZGVuIGdsZWljaCBtaXQgdW1nZXNjaHJpZWJlbiwgZGFtaXQgc2llIG5pY2h0XHJcbiAgLy8gd2VpdGVyaGluIGFscyBcIm5pY2h0IHJlZ2lzdHJpZXJ0XCIgYXVmdGF1Y2hlbi5cclxuICBhc3luYyByZWdpc3RlclR5cGUodHlwZUtleSkge1xyXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5hcHBseVR5cGVSZWdpc3RyYXRpb24odHlwZUtleSk7XHJcbiAgICBpZiAoIXJlc3VsdCkgcmV0dXJuO1xyXG5cclxuICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgdGhpcy5yZW5kZXIoKTtcclxuICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG5cclxuICAgIGlmIChyZXN1bHQucmVuYW1lZCA+IDApIHtcclxuICAgICAgbmV3IE5vdGljZShgVFlQICR7cmVzdWx0LnR5cGV9IHJlZ2lzdHJpZXJ0LCAke3Jlc3VsdC5yZW5hbWVkfSBOb3RpeihlbikgYW5nZXBhc3N0LmApO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLy8gRGVyIGVpZ2VudGxpY2hlIFZvcmdhbmcgYXVzIHJlZ2lzdGVyVHlwZSgpLCBvaG5lIFNwZWljaGVybiwgTmV1emVpY2huZW5cclxuICAvLyB1bmQgTm90aWNlOiBzbyBrYW5uIHJlZ2lzdGVyVHlwZVdpdGhTdWJ0eXBlKCkgVFlQIHVuZCBTdWJ0eXAgbmFjaGVpbmFuZGVyXHJcbiAgLy8gZWludHJhZ2VuIHVuZCBkYW5hY2ggRUlOTUFMIHNwZWljaGVybiB1bmQgRUlORSBOb3RpY2UgemVpZ2VuLCBzdGF0dCB6d2VpbWFsLlxyXG4gIC8vIExpZWZlcnQgeyB0eXBlLCByZW5hbWVkIH0gb2RlciBudWxsLCB3ZW5uIG5pY2h0cyBCcmF1Y2hiYXJlcyBcdTAwRkNicmlnIGJsZWlidC5cclxuICBhc3luYyBhcHBseVR5cGVSZWdpc3RyYXRpb24odHlwZUtleSkge1xyXG4gICAgY29uc3QgcmF3ID0gdGhpcy5wbHVnaW4udHlwSW5kZXgucmF3VmFsdWVPZih0eXBlS2V5KTtcclxuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVSYXdUeXBlKHJhdyA9PT0gdW5kZWZpbmVkID8gdHlwZUtleSA6IHJhdyk7XHJcbiAgICBpZiAoIW5vcm1hbGl6ZWQpIHJldHVybiBudWxsO1xyXG4gICAgaWYgKCF0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlcy5pbmNsdWRlcyhub3JtYWxpemVkKSkge1xyXG4gICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlcy5wdXNoKG5vcm1hbGl6ZWQpO1xyXG4gICAgfVxyXG4gICAgY29uc3QgcmVuYW1lZCA9IG5vcm1hbGl6ZWQgIT09IHR5cGVLZXkgPyBhd2FpdCByZW5hbWVUeXBlSW5Ob3Rlcyh0aGlzLnBsdWdpbiwgdHlwZUtleSwgbm9ybWFsaXplZCkgOiAwO1xyXG4gICAgcmV0dXJuIHsgdHlwZTogbm9ybWFsaXplZCwgcmVuYW1lZCB9O1xyXG4gIH1cclxuXHJcbiAgLy8gTmV1ZXMsIGxlZXJlcyBUcmVlLUl0ZW0gYW5sZWdlbiB1bmQgc29mb3J0IGluIGRlbiBFZGl0aWVyLU1vZHVzIHZlcnNldHplbiAtXHJcbiAgLy8gd2llIGJlaSBPYnNpZGlhbnMgZWlnZW5lbiBWaWV3cyAoei4gQi4gbmV1ZSBCb29rbWFyay1HcnVwcGUpLlxyXG4gIHN0YXJ0QWRkKCkge1xyXG4gICAgaWYgKHRoaXMuaXNFZGl0aW5nKSByZXR1cm47XHJcblxyXG4gICAgY29uc3QgdHJlZUl0ZW0gPSB0aGlzLmxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtXCIgfSk7XHJcbiAgICBpZiAodGhpcy5zZXBhcmF0b3JFbCkgdGhpcy5saXN0RWwuaW5zZXJ0QmVmb3JlKHRyZWVJdGVtLCB0aGlzLnNlcGFyYXRvckVsKTtcclxuICAgIGNvbnN0IHNlbGYgPSB0cmVlSXRlbS5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLXNlbGYgaXMtY2xpY2thYmxlXCIgfSk7XHJcbiAgICBjb25zdCBpbm5lciA9IHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1pbm5lclwiIH0pO1xyXG5cclxuICAgIHRoaXMuc3RhcnRFZGl0aW5nKG51bGwsIHNlbGYsIGlubmVyKTtcclxuICB9XHJcblxyXG4gIC8vIFdpZSBPYnNpZGlhbnMgZWlnZW5lIFRyZWUtSXRlbXM6IGtlaW4genVzXHUwMEU0dHpsaWNoZXMgSW5wdXQtRWxlbWVudCwgc29uZGVyblxyXG4gIC8vIGRhcyBiZXN0ZWhlbmRlIFRleHQtRWxlbWVudCB3aXJkIHNlbGJzdCBlZGl0aWVyYmFyIChjb250ZW50ZWRpdGFibGUpLlxyXG4gIC8vIHR5cGUgPT09IG51bGwgXHUyMTkyIG5ldWVyIEVpbnRyYWcsIHNvbnN0IFVtYmVuZW5uZW4gZGVzIFx1MDBGQ2JlcmdlYmVuZW4gVHlwcy5cclxuICBzdGFydEVkaXRpbmcodHlwZSwgc2VsZiwgaW5uZXIpIHtcclxuICAgIGlmICh0aGlzLmlzRWRpdGluZykgcmV0dXJuO1xyXG4gICAgdGhpcy5pc0VkaXRpbmcgPSB0cnVlO1xyXG5cclxuICAgIHNlbGYuYWRkQ2xhc3MoXCJpcy1iZWluZy1yZW5hbWVkXCIpO1xyXG4gICAgaW5uZXIuc2V0QXR0cmlidXRlKFwiY29udGVudGVkaXRhYmxlXCIsIFwidHJ1ZVwiKTtcclxuICAgIGlubmVyLnNldEF0dHJpYnV0ZShcInNwZWxsY2hlY2tcIiwgXCJmYWxzZVwiKTtcclxuICAgIGlubmVyLmZvY3VzKCk7XHJcblxyXG4gICAgY29uc3QgcmFuZ2UgPSBpbm5lci5kb2MuY3JlYXRlUmFuZ2UoKTtcclxuICAgIHJhbmdlLnNlbGVjdE5vZGVDb250ZW50cyhpbm5lcik7XHJcbiAgICBjb25zdCBzZWxlY3Rpb24gPSBpbm5lci53aW4uZ2V0U2VsZWN0aW9uKCk7XHJcbiAgICBzZWxlY3Rpb24ucmVtb3ZlQWxsUmFuZ2VzKCk7XHJcbiAgICBzZWxlY3Rpb24uYWRkUmFuZ2UocmFuZ2UpO1xyXG5cclxuICAgIGxldCBkb25lID0gZmFsc2U7XHJcbiAgICBjb25zdCBmaW5pc2ggPSBhc3luYyAoY29tbWl0KSA9PiB7XHJcbiAgICAgIGlmIChkb25lKSByZXR1cm47XHJcbiAgICAgIGRvbmUgPSB0cnVlO1xyXG4gICAgICB0aGlzLmlzRWRpdGluZyA9IGZhbHNlO1xyXG5cclxuICAgICAgY29uc3QgdmFsdWUgPSBub3JtYWxpemVUeXBlTmFtZShpbm5lci50ZXh0Q29udGVudCk7XHJcbiAgICAgIGlmIChjb21taXQgJiYgdmFsdWUgJiYgdmFsdWUgIT09IHR5cGUpIHtcclxuICAgICAgICBjb25zdCBleGlzdHMgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlcy5zb21lKFxyXG4gICAgICAgICAgKHQpID0+IHQudG9Mb3dlckNhc2UoKSA9PT0gdmFsdWUudG9Mb3dlckNhc2UoKSAmJiB0ICE9PSB0eXBlXHJcbiAgICAgICAgKTtcclxuICAgICAgICBpZiAoIWV4aXN0cykge1xyXG4gICAgICAgICAgaWYgKHR5cGUgPT09IG51bGwpIHtcclxuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXMucHVzaCh2YWx1ZSk7XHJcbiAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBjb25zdCBpZHggPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlcy5pbmRleE9mKHR5cGUpO1xyXG4gICAgICAgICAgICBpZiAoaWR4ICE9PSAtMSkgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXNbaWR4XSA9IHZhbHVlO1xyXG4gICAgICAgICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdO1xyXG4gICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3R5cGVdICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV07XHJcbiAgICAgICAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXTtcclxuICAgICAgICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdO1xyXG4gICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlU2hvcnRjdXRzW3R5cGVdICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlU2hvcnRjdXRzW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVTaG9ydGN1dHNbdHlwZV07XHJcbiAgICAgICAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVTaG9ydGN1dHNbdHlwZV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHRoaXMuZW5zdXJlVHlwZU1hbnVhbCgpW3R5cGVdICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlTWFudWFsW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVNYW51YWxbdHlwZV07XHJcbiAgICAgICAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVNYW51YWxbdHlwZV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgbW92ZVR5cGVTdWJ0eXBlcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgdmFsdWUpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgdGhpcy5yZW5kZXIoKTtcclxuICAgIH07XHJcblxyXG4gICAgaW5uZXIuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XHJcbiAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRW50ZXJcIikge1xyXG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgZmluaXNoKHRydWUpO1xyXG4gICAgICB9IGVsc2UgaWYgKGV2ZW50LmtleSA9PT0gXCJFc2NhcGVcIikge1xyXG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgZmluaXNoKGZhbHNlKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgaW5uZXIuYWRkRXZlbnRMaXN0ZW5lcihcImJsdXJcIiwgKCkgPT4gZmluaXNoKHRydWUpKTtcclxuICB9XHJcblxyXG4gIG9wZW5UeXBlU2V0dGluZ3ModHlwZSkge1xyXG4gICAgdGhpcy5zZWxlY3RlZFR5cGUgPSB0eXBlO1xyXG4gICAgdGhpcy5yZW5kZXIoKTtcclxuICB9XHJcblxyXG4gIGNsb3NlVHlwZVNldHRpbmdzKCkge1xyXG4gICAgdGhpcy5zZWxlY3RlZFR5cGUgPSBudWxsO1xyXG4gICAgdGhpcy5yZW5kZXIoKTtcclxuICB9XHJcblxyXG4gIC8vIFdpcmQgYWxzIENvbXBvbmVudC1DaGlsZCBnZWxhZGVuIChzaWVoZSBtb3VudEZyb250bWF0dGVyRWRpdG9yKSB1bmQgbXVzc1xyXG4gIC8vIGRlc2hhbGIgdm9yIGplZGVtIE5ldWF1ZmJhdSBkZXIgRGV0YWlsLUFuc2ljaHQgZXhwbGl6aXQgZW50bGFkZW4gd2VyZGVuIC1cclxuICAvLyBjb250ZW50RWwuZW1wdHkoKSBhbGxlaW4gd1x1MDBGQ3JkZSBudXIgZGllIERPTS1FbGVtZW50ZSBlbnRmZXJuZW4sIG5pY2h0IGFiZXJcclxuICAvLyBkZW4gZGFyYXVmIHJlZ2lzdHJpZXJ0ZW4gbWV0YWRhdGFUeXBlTWFuYWdlci1MaXN0ZW5lciBkZXIgRWRpdG9yLUluc3RhbnouXHJcbiAgLy8gZnJvbnRtYXR0ZXJCbG9ja3MgaXN0IGRpZSBTdGV1ZXJ1bmcgXHUwMEZDYmVyIGFsbGUgQmxcdTAwRjZja2UgKHUuIGEuIGZcdTAwRkNyIGRlblxyXG4gIC8vIEJlZmVobCBcIlN0YW5kYXJkLVByb3BlcnR5IGhpbnp1Zlx1MDBGQ2dlblwiKSwgZnJvbnRtYXR0ZXJFZGl0b3JzIGFsbGUgRWRpdG9yZW5cclxuICAvLyBkZXIgRGV0YWlsYW5zaWNodCBpbmtsLiBkZXIgU3VidHlwLUJsXHUwMEY2Y2tlLlxyXG4gIGRlc3Ryb3lGcm9udG1hdHRlckVkaXRvcigpIHtcclxuICAgIGZvciAoY29uc3QgZWRpdG9yIG9mIHRoaXMuZnJvbnRtYXR0ZXJFZGl0b3JzID8/IFtdKSB0aGlzLnJlbW92ZUNoaWxkKGVkaXRvcik7XHJcbiAgICB0aGlzLmZyb250bWF0dGVyRWRpdG9ycyA9IFtdO1xyXG4gICAgdGhpcy5mcm9udG1hdHRlckJsb2NrcyA9IG51bGw7XHJcbiAgfVxyXG5cclxuICByZW5kZXIoKSB7XHJcbiAgICAvLyBSZWVudHJhbmN5LUd1YXJkOiByZW5kZXJUeXBlU2V0dGluZ3MoKSBsXHUwMEY2c3QgYW0gRW5kZSBzZWxic3RcclxuICAgIC8vIHBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzKCkgYXVzIChzaWVoZSBkb3J0aWdlciBLb21tZW50YXIpLCB3YXMgdS4gYS5cclxuICAgIC8vIFx1MDBGQ2JlciByZWdpc3RlclR5cFZpZXcgd2llZGVydW0gcmVuZGVyKCkgYXVmIGFsbGVuIFRZUC1WaWV3LUxlYXZlc1xyXG4gICAgLy8gYXVmcnVmdCAtIGlua2x1c2l2ZSBkaWVzZW0sIHdcdTAwRTRocmVuZCBlcyBub2NoIG1pdHRlbiBpbiBnZW5hdSBkaWVzZW1cclxuICAgIC8vIEF1ZnJ1ZiBzdGVja3QuIE9obmUgR3VhcmQgcmVrdXJzaWVydCBkYXMgc3luY2hyb24gb2huZSBBYmJydWNoIGJpc1xyXG4gICAgLy8genVtIFN0YWNrIE92ZXJmbG93LCBiZWkgamVkZW0gXHUwMEQ2ZmZuZW4vVW1iZW5lbm5lbiBlaW5lcyBUWVBzLlxyXG4gICAgaWYgKHRoaXMuX3JlbmRlcmluZykgcmV0dXJuO1xyXG4gICAgdGhpcy5fcmVuZGVyaW5nID0gdHJ1ZTtcclxuICAgIHRyeSB7XHJcbiAgICAgIHRoaXMuZGVzdHJveUZyb250bWF0dGVyRWRpdG9yKCk7XHJcbiAgICAgIGlmICh0aGlzLnNlbGVjdGVkVHlwZSAhPT0gbnVsbCkge1xyXG4gICAgICAgIHRoaXMucmVuZGVyVHlwZVNldHRpbmdzKHRoaXMuc2VsZWN0ZWRUeXBlKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xyXG4gICAgICBjb250ZW50RWwuZW1wdHkoKTtcclxuXHJcbiAgICAgIGNvbnN0IHsgY291bnRzLCBub1R5cGUgfSA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnR5cGVDb3VudHMoKTtcclxuICAgICAgY29uc3QgcmVnaXN0ZXJlZCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVzO1xyXG4gICAgICBjb25zdCB0eXBlQ29sb3JzID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9ycztcclxuICAgICAgY29uc3Qgc29ydE9yZGVyID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwU29ydE9yZGVyID8/IERFRkFVTFRfU09SVF9PUkRFUjtcclxuICAgICAgY29uc3QgaXNNYW51YWxTb3J0ID0gc29ydE9yZGVyID09PSBcIm1hbnVhbFwiO1xyXG4gICAgICBjb25zdCBieUN1cnJlbnRPcmRlciA9IChhLCBiKSA9PiBjb21wYXJlVHlwZXMoc29ydE9yZGVyLCBhLCBiLCBjb3VudHMsIHR5cGVDb2xvcnMpO1xyXG5cclxuICAgICAgdGhpcy5yZW5kZXJMaXN0SGVhZGVyKGNvbnRlbnRFbCk7XHJcblxyXG4gICAgICBjb25zdCB1bnJlZ2lzdGVyZWRSb3dzID0gWy4uLmNvdW50cy5rZXlzKCldXHJcbiAgICAgICAgLmZpbHRlcigodHlwZSkgPT4gIXJlZ2lzdGVyZWQuaW5jbHVkZXModHlwZSkpXHJcbiAgICAgICAgLnNvcnQoYnlDdXJyZW50T3JkZXIpXHJcbiAgICAgICAgLm1hcCgodHlwZSkgPT4gKHsgdHlwZSwgY291bnQ6IGNvdW50cy5nZXQodHlwZSkgPz8gMCB9KSk7XHJcbiAgICAgIGNvbnN0IHVucmVnaXN0ZXJlZFN1YnR5cGVSb3dzID0gdGhpcy51bnJlZ2lzdGVyZWRTdWJ0eXBlUm93cygpO1xyXG5cclxuICAgICAgLy8gT2huZSB6d2VpdGUgU3BhbHRlIGRhcmYgZGVyIE5hbWUgZGllIGdhbnplIFplaWxlIG5laG1lbiAoc2llaGVcclxuICAgICAgLy8gLmZyZWQtdHlwLWxpc3Qtbm8tc2Vjb25kYXJ5IGluIHN0eWxlcy5jc3MpLlxyXG4gICAgICBjb25zdCBsaXN0Q2xzID0gXCJmcmVkLXR5cC1saXN0IG5hdi1maWxlcy1jb250YWluZXJcIiArICh0aGlzLnNlY29uZGFyeU1vZGUoKSA9PT0gXCJub25lXCIgPyBcIiBmcmVkLXR5cC1saXN0LW5vLXNlY29uZGFyeVwiIDogXCJcIik7XHJcbiAgICAgIHRoaXMubGlzdEVsID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogbGlzdENscyB9KTtcclxuICAgICAgdGhpcy5zZXBhcmF0b3JFbCA9IG51bGw7XHJcblxyXG4gICAgICAvLyBzb3J0VHlwZXNCeU1vZGUoKSBsXHUwMEU0c3N0IGltIE1hbnVlbGwtTW9kdXMgYmV3dXNzdCBkaWUgUmVpaGVuZm9sZ2Ugdm9uXHJcbiAgICAgIC8vIHBsdWdpbi5zZXR0aW5ncy50eXBlcyB1bmFuZ2V0YXN0ZXQgLSBwZXIgRHJhZyAmIERyb3AgaW5cclxuICAgICAgLy8gcmVuZGVyUmVnaXN0ZXJlZEl0ZW0oKSB1bXNvcnRpZXJ0LiBEZXIgaW5kZXggd2lyZCBkYWZcdTAwRkNyIDE6MSBhbHNcclxuICAgICAgLy8gUG9zaXRpb24gaW4gZGllc2VyIChpbiBkaWVzZW0gTW9kdXMgdW52ZXJcdTAwRTRuZGVydGVuKSBSZWloZW5mb2xnZVxyXG4gICAgICAvLyB3ZWl0ZXJnZWdlYmVuLlxyXG4gICAgICBjb25zdCByZWdpc3RlcmVkT3JkZXIgPSBzb3J0VHlwZXNCeU1vZGUocmVnaXN0ZXJlZCwgc29ydE9yZGVyLCBjb3VudHMsIHR5cGVDb2xvcnMpO1xyXG4gICAgICByZWdpc3RlcmVkT3JkZXIuZm9yRWFjaCgodHlwZSwgaW5kZXgpID0+IHtcclxuICAgICAgICB0aGlzLnJlbmRlclJlZ2lzdGVyZWRJdGVtKHR5cGUsIGNvdW50cy5nZXQodHlwZSkgPz8gMCwgeyBkcmFnZ2FibGU6IGlzTWFudWFsU29ydCwgaW5kZXggfSk7XHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gVW50ZXJoYWxiIGRlciBUcmVubmxpbmllIGRyZWkgQWJzY2huaXR0ZSwgamVkZXIgZlx1MDBGQ3Igc2ljaCBvcHRpb25hbDpcclxuICAgICAgLy8gbmljaHQgZXJmYXNzdGUgVFlQZW4sIG5pY2h0IGVyZmFzc3RlIFN1YnR5cGVuLCBcIltLRUlOIFRZUF1cIi4gRGllXHJcbiAgICAgIC8vIFN1YnR5cGVuIGJla29tbWVuIGVpbmUgZWlnZW5lIFRyZW5ubGluaWUsIHdlaWwgc2llIG5hY2ggZWluZXIgYW5kZXJlblxyXG4gICAgICAvLyBSZWdlbCBzb3J0aWVydCBzaW5kIGFscyBkaWUgVFlQZW4gZGFyXHUwMEZDYmVyIChBbnphaGwgc3RhdHQgU29ydGllci1CdXR0b24sXHJcbiAgICAgIC8vIHNpZWhlIHVucmVnaXN0ZXJlZFN1YnR5cGVSb3dzKSAtIG9obmUgc2ljaHRiYXJlbiBTY2huaXR0IHNcdTAwRTRoZSBkYXMgbmFjaFxyXG4gICAgICAvLyBrYXB1dHRlciBTb3J0aWVydW5nIGF1cy4gXCJbS0VJTiBUWVBdXCIgaXN0IGtlaW4gZWNodGVyIFR5cCwgbmltbXQgYW5cclxuICAgICAgLy8ga2VpbmVyIFNvcnRpZXJ1bmcgdGVpbCB1bmQgc3RlaHQgdW5hYmhcdTAwRTRuZ2lnIHZvbiBzZWluZXIgQW56YWhsIHp1bGV0enQ7XHJcbiAgICAgIC8vIGVzIHNjaGxpZVx1MDBERnQgZGlyZWt0IGFuLCBzdGF0dCBlaW5lIGRyaXR0ZSBMaW5pZSB6dSBiZWtvbW1lbi5cclxuICAgICAgLy9cclxuICAgICAgLy8gdGhpcy5zZXBhcmF0b3JFbCBibGVpYnQgYmV3dXNzdCBkaWUgRVJTVEUgTGluaWU6IHN0YXJ0QWRkKCkgaFx1MDBFNG5ndCBkYXNcclxuICAgICAgLy8gbmV1ZSBUcmVlLUl0ZW0gZGF2b3IsIHVuZCBlaW4gbmV1ZXIgVFlQIGdlaFx1MDBGNnJ0IGFucyBFbmRlIGRlciBlcmZhc3N0ZW4sXHJcbiAgICAgIC8vIG5pY2h0IHp3aXNjaGVuIGRpZSBuaWNodCBlcmZhc3N0ZW4gQWJzY2huaXR0ZS5cclxuICAgICAgY29uc3Qgc2VwYXJhdG9yID0gKCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IGVsID0gdGhpcy5saXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLXNlcGFyYXRvclwiIH0pO1xyXG4gICAgICAgIHRoaXMuc2VwYXJhdG9yRWwgPSB0aGlzLnNlcGFyYXRvckVsID8/IGVsO1xyXG4gICAgICB9O1xyXG5cclxuICAgICAgaWYgKHVucmVnaXN0ZXJlZFJvd3MubGVuZ3RoID4gMCB8fCB1bnJlZ2lzdGVyZWRTdWJ0eXBlUm93cy5sZW5ndGggPiAwIHx8IG5vVHlwZSA+IDApIHNlcGFyYXRvcigpO1xyXG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiB1bnJlZ2lzdGVyZWRSb3dzKSB0aGlzLnJlbmRlclVucmVnaXN0ZXJlZEl0ZW0ocm93LnR5cGUsIHJvdy5jb3VudCk7XHJcblxyXG4gICAgICBpZiAodW5yZWdpc3RlcmVkU3VidHlwZVJvd3MubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIGlmICh1bnJlZ2lzdGVyZWRSb3dzLmxlbmd0aCA+IDApIHNlcGFyYXRvcigpO1xyXG4gICAgICAgIGZvciAoY29uc3Qgcm93IG9mIHVucmVnaXN0ZXJlZFN1YnR5cGVSb3dzKSB0aGlzLnJlbmRlclVucmVnaXN0ZXJlZFN1YnR5cGVJdGVtKHJvdyk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmIChub1R5cGUgPiAwKSB0aGlzLnJlbmRlck5vVHlwZUl0ZW0obm9UeXBlKTtcclxuICAgIH0gZmluYWxseSB7XHJcbiAgICAgIHRoaXMuX3JlbmRlcmluZyA9IGZhbHNlO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLy8gV2llIGRlciBcIkNoYW5nZSBzb3J0IG9yZGVyXCItQnV0dG9uIGluIE9ic2lkaWFucyBUYWdzLSBiencuIEFsbC1Qcm9wZXJ0aWVzLVZpZXcuXHJcbiAgcmVuZGVyTGlzdEhlYWRlcihjb250ZW50RWwpIHtcclxuICAgIGNvbnN0IGhlYWRlciA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibmF2LWhlYWRlclwiIH0pO1xyXG4gICAgY29uc3QgYnV0dG9uc0NvbnRhaW5lciA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwibmF2LWJ1dHRvbnMtY29udGFpbmVyXCIgfSk7XHJcblxyXG4gICAgY29uc3QgYWRkQnRuID0gYnV0dG9uc0NvbnRhaW5lci5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gbmF2LWFjdGlvbi1idXR0b25cIixcclxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJOZXVlbiBUeXAgaGluenVmXHUwMEZDZ2VuXCIgfSxcclxuICAgIH0pO1xyXG4gICAgc2V0SWNvbihhZGRCdG4sIFwicGx1c1wiKTtcclxuICAgIGFkZEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5zdGFydEFkZCgpKTtcclxuXHJcbiAgICBjb25zdCBzb3J0QnRuID0gYnV0dG9uc0NvbnRhaW5lci5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gbmF2LWFjdGlvbi1idXR0b25cIixcclxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJTb3J0aWVycmVpaGVuZm9sZ2UgXHUwMEU0bmRlcm5cIiB9LFxyXG4gICAgfSk7XHJcbiAgICBzZXRJY29uKHNvcnRCdG4sIFwibHVjaWRlLXNvcnQtYXNjXCIpO1xyXG4gICAgc29ydEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB0aGlzLnNob3dTb3J0TWVudShldmVudCkpO1xyXG5cclxuICAgIC8vIFp3ZWl0ZSBTcGFsdGU6IGJld3Vzc3Qga2VpbiBNZW51ZSwgc29uZGVybiBlaW4gS25vcGYsIGRlciBkaWUgZHJlaSBNb2RpXHJcbiAgICAvLyBkZXIgUmVpaGUgbmFjaCBkdXJjaHNjaGFsdGV0IC0gYmVpIHNvIHdlbmlnZW4gWnVzdGFlbmRlbiwgZGVyZW4gV2lya3VuZ1xyXG4gICAgLy8gZGlyZWt0IGRhcnVudGVyIHNpY2h0YmFyIHdpcmQsIGlzdCBEdXJjaGtsaWNrZW4gc2NobmVsbGVyIGFscyBBdWZrbGFwcGVuXHJcbiAgICAvLyB1bmQgQXVzd2FlaGxlbi4gSWNvbiB1bmQgVG9vbHRpcCB6ZWlnZW4gZGVuIGFrdHVlbGxlbiBNb2R1cy5cclxuICAgIGNvbnN0IGN1cnJlbnQgPSBTRUNPTkRBUllfTU9ERVNbdGhpcy5zZWNvbmRhcnlJbmRleCgpXTtcclxuICAgIGNvbnN0IHNlY29uZGFyeUJ0biA9IGJ1dHRvbnNDb250YWluZXIuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIG5hdi1hY3Rpb24tYnV0dG9uXCIsXHJcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IGBOZWJlbiBkZW0gTmFtZW46ICR7Y3VycmVudC50aXRsZX1gIH0sXHJcbiAgICB9KTtcclxuICAgIHNldEljb24oc2Vjb25kYXJ5QnRuLCBjdXJyZW50Lmljb24pO1xyXG4gICAgc2Vjb25kYXJ5QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmN5Y2xlU2Vjb25kYXJ5KCkpO1xyXG4gIH1cclxuXHJcbiAgLy8gc2V0dGluZ3MudHlwTGlzdFNlY29uZGFyeSwgYWJlciBpbW1lciBlaW4gZ3VlbHRpZ2VyIE1vZHVzIC0gQmVzdGFuZHNkYXRlblxyXG4gIC8vIGtlbm5lbiBkZW4gU2NobHVlc3NlbCBub2NoIG5pY2h0IChzaWVoZSBtaWdyYXRlVHlwTGlzdFNlY29uZGFyeSBpbiBtYWluLmpzKSxcclxuICAvLyB1bmQgZWluIHNwYWV0ZXIgZW50ZmVybnRlciBNb2R1cyBzb2xsIGRpZSBMaXN0ZSBuaWNodCBsZWVyIGxhc3Nlbi5cclxuICBzZWNvbmRhcnlNb2RlKCkge1xyXG4gICAgY29uc3QgbW9kZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cExpc3RTZWNvbmRhcnk7XHJcbiAgICByZXR1cm4gU0VDT05EQVJZX01PREVTLnNvbWUoKGVudHJ5KSA9PiBlbnRyeS5tb2RlID09PSBtb2RlKSA/IG1vZGUgOiBERUZBVUxUX1NFQ09OREFSWTtcclxuICB9XHJcblxyXG4gIHNlY29uZGFyeUluZGV4KCkge1xyXG4gICAgcmV0dXJuIFNFQ09OREFSWV9NT0RFUy5maW5kSW5kZXgoKGVudHJ5KSA9PiBlbnRyeS5tb2RlID09PSB0aGlzLnNlY29uZGFyeU1vZGUoKSk7XHJcbiAgfVxyXG5cclxuICBhc3luYyBjeWNsZVNlY29uZGFyeSgpIHtcclxuICAgIGNvbnN0IG5leHQgPSBTRUNPTkRBUllfTU9ERVNbKHRoaXMuc2Vjb25kYXJ5SW5kZXgoKSArIDEpICUgU0VDT05EQVJZX01PREVTLmxlbmd0aF07XHJcbiAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBMaXN0U2Vjb25kYXJ5ID0gbmV4dC5tb2RlO1xyXG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAvLyBXaWUgaW0gU29ydGllci1NZW51ZTogbnVyIG5ldSB6ZWljaG5lbi4gRGVyIE1vZHVzIGJldHJpZmZ0IGF1c3NjaGxpZXNzbGljaFxyXG4gICAgLy8gZGllc2UgTGlzdGUsIG5pY2h0IGRpZSBFaW5mYWVyYnVuZyBhbmRlcnN3byAtIHJlZnJlc2hUeXBDb2xvcnMgd2FlcmUgaGllclxyXG4gICAgLy8gYWxzbyBudXIgZWluIHVubm9ldGlnZXMgUnVuZHVtLU5ldXplaWNobmVuIGFsbGVyIEFuc2ljaHRlbi5cclxuICAgIHRoaXMucmVuZGVyKCk7XHJcbiAgfVxyXG5cclxuICBzaG93U29ydE1lbnUoZXZlbnQpIHtcclxuICAgIGNvbnN0IGN1cnJlbnQgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBTb3J0T3JkZXIgPz8gREVGQVVMVF9TT1JUX09SREVSO1xyXG4gICAgY29uc3QgbWVudSA9IG5ldyBNZW51KCk7XHJcblxyXG4gICAgY29uc3QgYWRkR3JvdXAgPSAoc3RhcnQsIGVuZCkgPT4ge1xyXG4gICAgICBmb3IgKGxldCBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xyXG4gICAgICAgIGNvbnN0IHsgbW9kZSwgdGl0bGUgfSA9IFNPUlRfT1BUSU9OU1tpXTtcclxuICAgICAgICBtZW51LmFkZEl0ZW0oKGl0ZW0pID0+XHJcbiAgICAgICAgICBpdGVtXHJcbiAgICAgICAgICAgIC5zZXRUaXRsZSh0aXRsZSlcclxuICAgICAgICAgICAgLnNldENoZWNrZWQoY3VycmVudCA9PT0gbW9kZSlcclxuICAgICAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cFNvcnRPcmRlciA9IG1vZGU7XHJcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgICAgICAgdGhpcy5yZW5kZXIoKTtcclxuICAgICAgICAgICAgfSlcclxuICAgICAgICApO1xyXG4gICAgICB9XHJcbiAgICB9O1xyXG5cclxuICAgIGFkZEdyb3VwKDAsIDEpO1xyXG4gICAgbWVudS5hZGRTZXBhcmF0b3IoKTtcclxuICAgIGFkZEdyb3VwKDEsIDMpO1xyXG4gICAgbWVudS5hZGRTZXBhcmF0b3IoKTtcclxuICAgIGFkZEdyb3VwKDMsIDUpO1xyXG4gICAgbWVudS5hZGRTZXBhcmF0b3IoKTtcclxuICAgIGFkZEdyb3VwKDUsIDcpO1xyXG5cclxuICAgIG1lbnUuc2hvd0F0TW91c2VFdmVudChldmVudCk7XHJcbiAgfVxyXG5cclxuICByZW5kZXJOb1R5cGVJdGVtKGNvdW50KSB7XHJcbiAgICBjb25zdCB0cmVlSXRlbSA9IHRoaXMubGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW1cIiB9KTtcclxuICAgIGNvbnN0IHNlbGYgPSB0cmVlSXRlbS5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLXNlbGYgaXMtY2xpY2thYmxlIGZyZWQtdHlwLXVucmVnaXN0ZXJlZFwiIH0pO1xyXG4gICAgc2VsZi5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLWlubmVyXCIsIHRleHQ6IFwiW0tFSU4gVFlQXVwiIH0pO1xyXG4gICAgdGhpcy5yZW5kZXJDb3VudEZsYWlyKHNlbGYsIGNvdW50KTtcclxuXHJcbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLm9wZW5TZWFyY2gobnVsbCkpO1xyXG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY29udGV4dG1lbnVcIiwgKGV2ZW50KSA9PiB7XHJcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgICB0aGlzLm9wZW5TZWFyY2gobnVsbCk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIC8vIENocm9taXVtcyBpbnB1dFt0eXBlPWNvbG9yXSBoYXQgZWluZW4gZWlnZW5lbiBNaW5kZXN0LVN3YXRjaCwgZGVyIHNpY2ggbmljaHRcclxuICAvLyB1bnRlciBUZXh0Z3JcdTAwRjZcdTAwREZlIHNrYWxpZXJlbiBsXHUwMEU0c3N0IC0gZGFoZXIgbnVyIGFscyB1bnNpY2h0YmFyZW4gUGlja2VyLVRyaWdnZXJcclxuICAvLyBcdTAwRkNiZXIgZGVtIGZyZWkgc2thbGllcmJhcmVuIFB1bmt0IHBsYXR6aWVyZW4uIE9obmUgZWlnZW5lIEZhcmJlIHN0ZWh0IGRlclxyXG4gIC8vIFB1bmt0IGFscyBob2hsZXIgZ3JhdWVyIFJpbmcgZGEgKHNpZWhlIHBhaW50Q29sb3JEb3QpOyBtaXQgc2hvd1Jlc2V0XHJcbiAgLy8gKERldGFpbGFuc2ljaHQpIG5lbm50IGVpbiBUb29sdGlwIGRlbiBadXN0YW5kLCB1bmQgZGVyIFp1clx1MDBGQ2Nrc2V0emVuLUJ1dHRvblxyXG4gIC8vIGlzdCBkYW5uIGF1c2dlZ3JhdXQuXHJcbiAgcmVuZGVyQ29sb3JQaWNrZXIocGFyZW50LCB0eXBlLCBvbkNoYW5nZSwgeyBzaG93UmVzZXQgPSBmYWxzZSB9ID0ge30pIHtcclxuICAgIGNvbnN0IGN1cnJlbnRDb2xvciA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV0gPz8gREVGQVVMVF9UWVBFX0NPTE9SO1xyXG4gICAgY29uc3QgY29sb3JXcmFwID0gcGFyZW50LmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1jb2xvci13cmFwXCIgfSk7XHJcbiAgICBjb25zdCBjb2xvckRvdCA9IGNvbG9yV3JhcC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtY29sb3ItZG90XCIgfSk7XHJcbiAgICBsZXQgcmVzZXRCdG4gPSBudWxsO1xyXG4gICAgY29uc3Qgc2hvd1N0YXRlID0gKGNvbG9yLCBpc0RlZmF1bHQpID0+IHtcclxuICAgICAgcGFpbnRDb2xvckRvdChjb2xvckRvdCwgY29sb3IsIGlzRGVmYXVsdCk7XHJcbiAgICAgIGlmICghc2hvd1Jlc2V0KSByZXR1cm47XHJcbiAgICAgIGNvbG9yV3JhcC5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIGlzRGVmYXVsdCA/IFwiU3RhbmRhcmQgKGtlaW5lIEZhcmJlKVwiIDogXCJGYXJiZSBcdTAwRTRuZGVyblwiKTtcclxuICAgICAgcmVzZXRCdG4/LnRvZ2dsZUNsYXNzKFwiaXMtZGlzYWJsZWRcIiwgaXNEZWZhdWx0KTtcclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgY29sb3JJbnB1dCA9IGNvbG9yV3JhcC5jcmVhdGVFbChcImlucHV0XCIsIHsgdHlwZTogXCJjb2xvclwiLCBjbHM6IFwiZnJlZC10eXAtY29sb3ItaW5wdXRcIiB9KTtcclxuICAgIGNvbG9ySW5wdXQudmFsdWUgPSBjdXJyZW50Q29sb3I7XHJcbiAgICBjb2xvcklucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpKTtcclxuXHJcbiAgICAvLyBcImlucHV0XCIgZmV1ZXJ0IGJlaSBqZWRlciBad2lzY2hlbmZhcmJlLCB3XHUwMEU0aHJlbmQgZGVyIG5hdGl2ZSBQaWNrZXIgbm9jaFxyXG4gICAgLy8gb2ZmZW4gaXN0IC0gaGllciBudXIgbG9rYWxlIFZvcnNjaGF1IChQdW5rdCwgZ2dmLiBOYW1lIHZpYSBvbkNoYW5nZSksIG9obmVcclxuICAgIC8vIGRpZSBcdTAwRkNicmlnZW4gVmlld3MgKERhdGVpLUV4cGxvcmVyLCBHcmFwaCwgLi4uKSBuZXUgenUgcmVuZGVybjpcclxuICAgIC8vIHJlZnJlc2hUeXBDb2xvcnMoKSBsXHUwMEY2c3QgZGFmXHUwMEZDciB1LiBhLiByZW5kZXIoKSBhdWYgZGllc2VyIFRZUC1WaWV3IHNlbGJzdFxyXG4gICAgLy8gYXVzLCB3YXMgZGllc2VzIDxpbnB1dCB0eXBlPWNvbG9yPiBhdXMgZGVtIERPTSBlbnRmZXJuZW4gdW5kIGRlbiBuYXRpdmVuXHJcbiAgICAvLyBQaWNrZXIgZGFtaXQgc29mb3J0IHNjaGxpZVx1MDBERmVuIHdcdTAwRkNyZGUgLSBub2NoIGJldm9yIG1hbiBcdTAwRkNiZXJoYXVwdCBlaW5lIEZhcmJlXHJcbiAgICAvLyBhdXN3XHUwMEU0aGxlbiBrYW5uIChzY2hvbiBiZWltIGVyc3RlbiBLbGljaywgdm9yIGRlbSBMb3NsYXNzZW4gZGVyIFRhc3RlKS5cclxuICAgIGNvbG9ySW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImlucHV0XCIsIGFzeW5jICgpID0+IHtcclxuICAgICAgc2hvd1N0YXRlKGNvbG9ySW5wdXQudmFsdWUsIGZhbHNlKTtcclxuICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXSA9IGNvbG9ySW5wdXQudmFsdWU7XHJcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICBvbkNoYW5nZT8uKGNvbG9ySW5wdXQudmFsdWUpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gRXJzdCB3ZW5uIGRpZSBBdXN3YWhsIGJlc3RcdTAwRTR0aWd0IHVuZCBkZXIgbmF0aXZlIFBpY2tlciBkYWR1cmNoIGdlc2NobG9zc2VuXHJcbiAgICAvLyB3aXJkLCBkaWUgXHUwMEZDYnJpZ2VuIFZpZXdzIG5hY2h6aWVoZW4gLSBhbiBkZW0gUHVua3Qga2FubiBlaW4gTmV1LVJlbmRlcm5cclxuICAgIC8vIGRpZXNlciBUWVAtVmlldyBzZWxic3QgbmljaHRzIG1laHIga2FwdXR0IG1hY2hlbi5cclxuICAgIGNvbG9ySW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCAoKSA9PiB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKSk7XHJcblxyXG4gICAgaWYgKHNob3dSZXNldCkge1xyXG4gICAgICByZXNldEJ0biA9IHBhcmVudC5jcmVhdGVEaXYoe1xyXG4gICAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1jb2xvci1yZXNldFwiLFxyXG4gICAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiRmFyYmUgenVyXHUwMEZDY2tzZXR6ZW5cIiB9LFxyXG4gICAgICB9KTtcclxuICAgICAgc2V0SWNvbihyZXNldEJ0biwgXCJyb3RhdGUtY2N3XCIpO1xyXG4gICAgICByZXNldEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdO1xyXG4gICAgICAgIGNvbG9ySW5wdXQudmFsdWUgPSBERUZBVUxUX1RZUEVfQ09MT1I7XHJcbiAgICAgICAgc2hvd1N0YXRlKERFRkFVTFRfVFlQRV9DT0xPUiwgdHJ1ZSk7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbiAgICAgICAgb25DaGFuZ2U/LihERUZBVUxUX1RZUEVfQ09MT1IpO1xyXG4gICAgICB9KTtcclxuICAgIH1cclxuICAgIHNob3dTdGF0ZShjdXJyZW50Q29sb3IsIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV0gPT09IHVuZGVmaW5lZCk7XHJcblxyXG4gICAgcmV0dXJuIGNvbG9yV3JhcDtcclxuICB9XHJcblxyXG4gIC8vIEZcdTAwRTRuZ3QgQmVzdGFuZHNpbnN0YWxsYXRpb25lbiBhYiwgZGVyZW4gc2V0dGluZ3MtT2JqZWt0IHNjaG9uIHZvciBFaW5mXHUwMEZDaHJ1bmdcclxuICAvLyB2b24gdHlwZU1hbnVhbCBnZWxhZGVuIHd1cmRlICh6LiBCLiBsYXVmZW5kZSBTZXNzaW9uIHZvciBlaW5lbSB2b2xsc3RcdTAwRTRuZGlnZW5cclxuICAvLyBQbHVnaW4tUmVsb2FkIG5hY2ggSG90LVJlbG9hZCkgLSBvaG5lIGRhcyB3XHUwMEZDcmRlIGplZGVyIFp1Z3JpZmYgdW50ZW4gbWl0XHJcbiAgLy8gXCJDYW5ub3QgcmVhZCBwcm9wZXJ0aWVzIG9mIHVuZGVmaW5lZFwiIGFiYnJlY2hlbiB1bmQgZGFiZWkgZGVuIGdlc2FtdGVuXHJcbiAgLy8gcmVzdGxpY2hlbiByZW5kZXJUeXBlU2V0dGluZ3MoKS1BdWZydWYgKEZhcmJlLCBCZXNjaHJlaWJ1bmcsIEZyb250bWF0dGVyKVxyXG4gIC8vIG1pdCBzaWNoIHJlaVx1MDBERmVuLCBkYSBkZXIgRmVobGVyIHN5bmNocm9uIG1pdHRlbiBpbiBkZXIgRnVua3Rpb24gYXVmdHJpdHQuXHJcbiAgZW5zdXJlVHlwZU1hbnVhbCgpIHtcclxuICAgIGlmICghdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZU1hbnVhbCkgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZU1hbnVhbCA9IHt9O1xyXG4gICAgcmV0dXJuIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVNYW51YWw7XHJcbiAgfVxyXG5cclxuICAvLyBOYWNoZ2ViYXV0IHdpZSBPYnNpZGlhbnMgZWlnZW5lciBUb2dnbGVDb21wb25lbnQgKGNoZWNrYm94LWNvbnRhaW5lciArXHJcbiAgLy8gdmVyc3RlY2t0ZXMgaW5wdXRbdHlwZT1jaGVja2JveF0pLCBkYSB3aXIgaGllciBkaXJla3QgaW0gRE9NIHN0YXR0IFx1MDBGQ2JlclxyXG4gIC8vIGRpZSBTZXR0aW5nLUFQSSBiYXVlbi4gU3RhbmRhcmRtXHUwMEU0XHUwMERGaWcgYW4gLSBkYWhlciB3aXJkICh3aWUgYmVpIGRlbiBhbmRlcmVuXHJcbiAgLy8gdHlwZVh4eC1EaWN0cykgbnVyIGRpZSBBYndlaWNodW5nIHZvbSBEZWZhdWx0IGdlc3BlaWNoZXJ0LCBoaWVyIGFsc28gbnVyXHJcbiAgLy8gXCJhdXNcIiAoZmFsc2UpOyBmZWhsZW5kZXIgRWludHJhZyBiencuIHRydWUgYmVkZXV0ZW4gXCJhblwiLiBTdGV1ZXJ0LCBvYiBlaW5cclxuICAvLyBUWVAgaW4gZ2V0VHlwZXMoKSAoc2llaGUgbWFpbi5qcykgZXhwb3J0aWVydCB3aXJkLCBzaWVoZSBkb3J0aWdlciBLb21tZW50YXIuXHJcbiAgcmVuZGVyTWFudWFsVG9nZ2xlKHBhcmVudCwgdHlwZSkge1xyXG4gICAgY29uc3QgY3VycmVudCA9IHRoaXMuZW5zdXJlVHlwZU1hbnVhbCgpW3R5cGVdICE9PSBmYWxzZTtcclxuICAgIGNvbnN0IHRvZ2dsZUVsID0gcGFyZW50LmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJjaGVja2JveC1jb250YWluZXJcIiArIChjdXJyZW50ID8gXCIgaXMtZW5hYmxlZFwiIDogXCJcIiksXHJcbiAgICAgIGF0dHI6IHsgdGFiaW5kZXg6IFwiMFwiLCByb2xlOiBcImNoZWNrYm94XCIsIFwiYXJpYS1jaGVja2VkXCI6IFN0cmluZyhjdXJyZW50KSB9LFxyXG4gICAgfSk7XHJcbiAgICB0b2dnbGVFbC5jcmVhdGVFbChcImlucHV0XCIsIHsgdHlwZTogXCJjaGVja2JveFwiIH0pO1xyXG5cclxuICAgIGNvbnN0IHRvZ2dsZSA9IGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgbmV4dCA9ICF0b2dnbGVFbC5oYXNDbGFzcyhcImlzLWVuYWJsZWRcIik7XHJcbiAgICAgIHRvZ2dsZUVsLnRvZ2dsZUNsYXNzKFwiaXMtZW5hYmxlZFwiLCBuZXh0KTtcclxuICAgICAgdG9nZ2xlRWwuc2V0QXR0cmlidXRlKFwiYXJpYS1jaGVja2VkXCIsIFN0cmluZyhuZXh0KSk7XHJcbiAgICAgIGlmIChuZXh0KSBkZWxldGUgdGhpcy5lbnN1cmVUeXBlTWFudWFsKClbdHlwZV07XHJcbiAgICAgIGVsc2UgdGhpcy5lbnN1cmVUeXBlTWFudWFsKClbdHlwZV0gPSBmYWxzZTtcclxuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICB9O1xyXG5cclxuICAgIHRvZ2dsZUVsLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCB0b2dnbGUpO1xyXG4gICAgdG9nZ2xlRWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XHJcbiAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRW50ZXJcIiB8fCBldmVudC5rZXkgPT09IFwiIFwiKSB7XHJcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgICB0b2dnbGUoKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgcmV0dXJuIHRvZ2dsZUVsO1xyXG4gIH1cclxuXHJcbiAgcmVuZGVyUmVnaXN0ZXJlZEl0ZW0odHlwZSwgY291bnQsIHsgZHJhZ2dhYmxlID0gZmFsc2UsIGluZGV4ID0gLTEgfSA9IHt9KSB7XHJcbiAgICBjb25zdCB0cmVlSXRlbSA9IHRoaXMubGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW1cIiB9KTtcclxuICAgIGNvbnN0IHNlbGYgPSB0cmVlSXRlbS5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLXNlbGYgaXMtY2xpY2thYmxlXCIgfSk7XHJcblxyXG4gICAgbGV0IG5hbWVFbDtcclxuICAgIHRoaXMucmVuZGVyQ29sb3JQaWNrZXIoc2VsZiwgdHlwZSwgKG5ld0NvbG9yKSA9PiB7XHJcbiAgICAgIGlmIChuYW1lRWwgJiYgdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0KSBuYW1lRWwuc3R5bGUuY29sb3IgPSBuZXdDb2xvcjtcclxuICAgIH0pO1xyXG5cclxuICAgIG5hbWVFbCA9IHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1pbm5lclwiLCB0ZXh0OiB0eXBlIH0pO1xyXG4gICAgY29uc3QgY29sb3IgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3QgPyB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdIDogbnVsbDtcclxuICAgIGlmIChjb2xvcikgbmFtZUVsLnN0eWxlLmNvbG9yID0gY29sb3I7XHJcblxyXG4gICAgLy8gWndlaXRlIFNwYWx0ZSwgdW1nZXNjaGFsdGV0IHVlYmVyIGRlbiBLbm9wZiBpbSBMaXN0ZW4tSGVhZGVyIChzaWVoZVxyXG4gICAgLy8gU0VDT05EQVJZX01PREVTIHVuZCBjeWNsZVNlY29uZGFyeSkuXHJcbiAgICBjb25zdCBzZWNvbmRhcnkgPSB0aGlzLnNlY29uZGFyeU1vZGUoKTtcclxuICAgIGlmIChzZWNvbmRhcnkgPT09IFwiZGVzY3JpcHRpb25cIikgdGhpcy5yZW5kZXJEZXNjcmlwdGlvbklucHV0KHNlbGYsIHR5cGUpO1xyXG4gICAgZWxzZSBpZiAoc2Vjb25kYXJ5ID09PSBcInN1YnR5cGVzXCIpIHRoaXMucmVuZGVyU3VidHlwZVByZXZpZXcoc2VsZiwgdHlwZSk7XHJcblxyXG4gICAgdGhpcy5yZW5kZXJDb3VudEZsYWlyKHNlbGYsIGNvdW50KTtcclxuXHJcbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XHJcbiAgICAgIGlmICh0aGlzLmlzRWRpdGluZykgcmV0dXJuO1xyXG4gICAgICB0aGlzLm9wZW5UeXBlU2V0dGluZ3ModHlwZSk7XHJcbiAgICB9KTtcclxuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNvbnRleHRtZW51XCIsIChldmVudCkgPT4ge1xyXG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgdGhpcy5vcGVuU2VhcmNoKHR5cGUpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gTnVyIGltIE1hbnVlbGwtU29ydGllcm1vZHVzIGFrdGl2IChzaWVoZSByZW5kZXIoKSkgLSBkaWUgZ2FuemUgWmVpbGUgaXN0XHJcbiAgICAvLyBkYW5uIHBlciBEcmFnICYgRHJvcCB2ZXJzY2hpZWJiYXIgKGVpbiBEcmFnLCBkZXIgYXVmIGRlbSBGYXJicHVua3Qgb2RlclxyXG4gICAgLy8gaW0gQmVzY2hyZWlidW5nc2ZlbGQgYmVnaW5udCwgZ3JlaWZ0IHRyb3R6ZGVtIG5pY2h0IC0gZGllc2UgRWxlbWVudGVcclxuICAgIC8vIG5laG1lbiBkZW4gTW91c2Vkb3duIHNlbGJzdCBmXHUwMEZDciBGYXJiLS9UZXh0YXVzd2FobCkuIFZlcnNjaG9iZW4gd2lyZFxyXG4gICAgLy8gZGlyZWt0IGluIHBsdWdpbi5zZXR0aW5ncy50eXBlcyAtIGRpZXNlbGJlIExpc3RlLCBkaWUgaW0gTWFudWVsbC1Nb2R1c1xyXG4gICAgLy8gdW5zb3J0aWVydCBhbHMgQW56ZWlnZXJlaWhlbmZvbGdlIGRpZW50IChzaWVoZSByZW5kZXIoKSkuXHJcbiAgICBpZiAoZHJhZ2dhYmxlKSB7XHJcbiAgICAgIHNlbGYuZHJhZ2dhYmxlID0gdHJ1ZTtcclxuICAgICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ3N0YXJ0XCIsIChldmVudCkgPT4ge1xyXG4gICAgICAgIGV2ZW50LmRhdGFUcmFuc2Zlci5lZmZlY3RBbGxvd2VkID0gXCJtb3ZlXCI7XHJcbiAgICAgICAgZXZlbnQuZGF0YVRyYW5zZmVyLnNldERhdGEoXCJ0ZXh0L3BsYWluXCIsIFN0cmluZyhpbmRleCkpO1xyXG4gICAgICAgIHNlbGYuY2xhc3NMaXN0LmFkZChcImlzLWRyYWdnaW5nXCIpO1xyXG4gICAgICB9KTtcclxuICAgICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ2VuZFwiLCAoKSA9PiBzZWxmLmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcmFnZ2luZ1wiKSk7XHJcbiAgICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdvdmVyXCIsIChldmVudCkgPT4ge1xyXG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgY29uc3QgcmVjdCA9IHNlbGYuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XHJcbiAgICAgICAgY29uc3QgaXNBZnRlciA9IGV2ZW50LmNsaWVudFkgLSByZWN0LnRvcCA+IHJlY3QuaGVpZ2h0IC8gMjtcclxuICAgICAgICBzZWxmLmNsYXNzTGlzdC50b2dnbGUoXCJpcy1kcm9wLWJlZm9yZVwiLCAhaXNBZnRlcik7XHJcbiAgICAgICAgc2VsZi5jbGFzc0xpc3QudG9nZ2xlKFwiaXMtZHJvcC1hZnRlclwiLCBpc0FmdGVyKTtcclxuICAgICAgfSk7XHJcbiAgICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdsZWF2ZVwiLCAoKSA9PiBzZWxmLmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcm9wLWJlZm9yZVwiLCBcImlzLWRyb3AtYWZ0ZXJcIikpO1xyXG4gICAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJkcm9wXCIsIGFzeW5jIChldmVudCkgPT4ge1xyXG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgY29uc3QgaXNBZnRlciA9IHNlbGYuY2xhc3NMaXN0LmNvbnRhaW5zKFwiaXMtZHJvcC1hZnRlclwiKTtcclxuICAgICAgICBzZWxmLmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcm9wLWJlZm9yZVwiLCBcImlzLWRyb3AtYWZ0ZXJcIik7XHJcblxyXG4gICAgICAgIGNvbnN0IGZyb21JbmRleCA9IE51bWJlcihldmVudC5kYXRhVHJhbnNmZXIuZ2V0RGF0YShcInRleHQvcGxhaW5cIikpO1xyXG4gICAgICAgIGlmIChOdW1iZXIuaXNOYU4oZnJvbUluZGV4KSB8fCBmcm9tSW5kZXggPT09IGluZGV4KSByZXR1cm47XHJcblxyXG4gICAgICAgIGxldCBpbnNlcnRCZWZvcmUgPSBpc0FmdGVyID8gaW5kZXggKyAxIDogaW5kZXg7XHJcbiAgICAgICAgaWYgKGZyb21JbmRleCA8IGluc2VydEJlZm9yZSkgaW5zZXJ0QmVmb3JlIC09IDE7XHJcblxyXG4gICAgICAgIGNvbnN0IHR5cGVzID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXM7XHJcbiAgICAgICAgY29uc3QgW21vdmVkXSA9IHR5cGVzLnNwbGljZShmcm9tSW5kZXgsIDEpO1xyXG4gICAgICAgIHR5cGVzLnNwbGljZShpbnNlcnRCZWZvcmUsIDAsIG1vdmVkKTtcclxuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICB0aGlzLnJlbmRlcigpO1xyXG4gICAgICB9KTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8vIEVjaHRlcyBUZXh0LUlucHV0IHN0YXR0IG51ciBBbnplaWdlOiBkaWUgQmVzY2hyZWlidW5nIGlzdCBkaXJla3QgaW4gZGVyXHJcbiAgLy8gTGlzdGUgYmVhcmJlaXRiYXIsIG9obmUgZGFmXHUwMEZDciBlcnN0IGRpZSBEZXRhaWxhbnNpY2h0IFx1MDBGNmZmbmVuIHp1IG1cdTAwRkNzc2VuLlxyXG4gIC8vIGNsaWNrIGhpZXIgbXVzcyBkaWUgWmVpbGUgc2VsYnN0IGdlemllbHQgTklDSFQgYXVzbFx1MDBGNnNlblxyXG4gIC8vIChzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAuLi4pIGluIHJlbmRlclJlZ2lzdGVyZWRJdGVtIFx1MDBGNmZmbmV0IHNvbnN0XHJcbiAgLy8gZGllIERldGFpbGFuc2ljaHQpLCBkYWhlciBzdG9wUHJvcGFnYXRpb24uXHJcbiAgcmVuZGVyRGVzY3JpcHRpb25JbnB1dChzZWxmLCB0eXBlKSB7XHJcbiAgICBjb25zdCBkZXNjSW5wdXQgPSBzZWxmLmNyZWF0ZUVsKFwiaW5wdXRcIiwge1xyXG4gICAgICB0eXBlOiBcInRleHRcIixcclxuICAgICAgY2xzOiBcImZyZWQtdHlwLWxpc3QtZGVzY3JpcHRpb24taW5wdXRcIixcclxuICAgIH0pO1xyXG4gICAgZGVzY0lucHV0LnZhbHVlID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXSA/PyBcIlwiO1xyXG4gICAgZGVzY0lucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpKTtcclxuICAgIGRlc2NJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgdmFsdWUgPSBkZXNjSW5wdXQudmFsdWUudHJpbSgpO1xyXG4gICAgICBpZiAodmFsdWUpIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV0gPSB2YWx1ZTtcclxuICAgICAgZWxzZSBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXTtcclxuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIC8vIFwiKFN1YnR5cCAxLCBTdWJ0eXAgMilcIiBzdGF0dCBkZXIgQmVzY2hyZWlidW5nIC0gZGllc2VsYmUgRGFyc3RlbGx1bmcgd2llXHJcbiAgLy8gZGllIFN1YnR5cC1Wb3JzY2hhdSBpbSBzZXBhcmF0ZW4gVFlQLVBpY2tlciAocmVuZGVyU3VidHlwZVByZXZpZXcgaW5cclxuICAvLyB0eXBlLXBpY2tlci5qcywgZ2VtZWluc2FtZSBGYXJiZ3J1bmRsYWdlIG5hbWVDb2xvciBpbiB0eXBlLWNvbG9ycy5qcyk6XHJcbiAgLy8gS2xhbW1lcm4gdW5kIEtvbW1hcyBtdXRlZCwgamVkZXIgTmFtZSBpbiBzZWluZXIgZWlnZW5lbiBTdWJ0eXAtRmFyYmU7IG9obmVcclxuICAvLyBcIlRZUCBWaWV3IGVpbmZcdTAwRTRyYmVuXCIgYmxlaWJ0IGRpZSBWb3JzY2hhdSB3aWUgZGVyIFRZUC1OYW1lIHNlbGJzdCB1bmdlZlx1MDBFNHJidCxcclxuICAvLyB1bmQgb2huZSBkZXNzZW4gVW50ZXItU2NoYWx0ZXIgXCJTdWJ0eXBcIiBzdGVoZW4gYWxsZSBpbiBkZXIgVFlQLUZhcmJlLlxyXG4gIC8vIEJld3Vzc3QgbnVyIGRpZSBlcmZhc3N0ZW4gU3VidHlwZW4gdW5kIG9obmUgTm90aXotQW56YWhsOiBuaWNodCBlcmZhc3N0ZVxyXG4gIC8vIFdlcnRlIGhhYmVuIHdlZGVyIEZhcmJlIG5vY2ggRGVmaW5pdGlvbiwgdW5kIFphaGxlbiBqZSBOYW1lIHdcdTAwRkNyZGVuIGRpZVxyXG4gIC8vIFplaWxlIHNvIHZlcmxcdTAwRTRuZ2VybiwgZGFzcyBiZWkgbWVocmVyZW4gU3VidHlwZW4gbmljaHRzIG1laHIgZGF2b24genUgbGVzZW5cclxuICAvLyB3XHUwMEU0cmUuIFJlaW5lIEFuemVpZ2UgLSBLbGljayB1bmQgUmVjaHRza2xpY2sgZ2VoXHUwMEY2cmVuIHdlaXRlciBkZXIgZ2FuemVuXHJcbiAgLy8gWmVpbGUgKERldGFpbGFuc2ljaHQgYnp3LiBTdWNoZSkuIE9iIGRpZSBMaXN0ZSBsaW5rcyBoaW50ZXIgZGVtIE5hbWVuXHJcbiAgLy8gYmVnaW5udCBvZGVyIHJlY2h0c2JcdTAwRkNuZGlnIHZvciBkZXIgQW56YWhsIGVuZGV0LCBpc3QgaGllciBiZXd1c3N0IG5pY2h0XHJcbiAgLy8gYWJnZWZyYWd0OiBkYXMgc2NoYWx0ZXQgU3R5bGUgU2V0dGluZ3MgXHUwMEZDYmVyIGVpbmUgYm9keS1LbGFzc2UgKHNpZWhlIGRlblxyXG4gIC8vIEBzZXR0aW5ncy1CbG9jayB1bmQgLmZyZWQtdHlwLWxpc3Qtc3VidHlwZXMgaW4gc3R5bGVzLmNzcyksIGRhcyBNYXJrdXBcclxuICAvLyBibGVpYnQgaW4gYmVpZGVuIEZcdTAwRTRsbGVuIGRhc3NlbGJlLlxyXG4gIHJlbmRlclN1YnR5cGVQcmV2aWV3KHNlbGYsIHR5cGUpIHtcclxuICAgIGNvbnN0IHN1YnR5cGVzID0gZ2V0U3VidHlwZU5hbWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlKTtcclxuICAgIGlmIChzdWJ0eXBlcy5sZW5ndGggPT09IDApIHJldHVybjtcclxuXHJcbiAgICBjb25zdCBjb2xvcml6ZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdDtcclxuICAgIGNvbnN0IHdyYXAgPSBzZWxmLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtbGlzdC1zdWJ0eXBlc1wiIH0pO1xyXG4gICAgd3JhcC5hcHBlbmRUZXh0KFwiKFwiKTtcclxuICAgIHN1YnR5cGVzLmZvckVhY2goKHN1YnR5cGUsIGluZGV4KSA9PiB7XHJcbiAgICAgIGlmIChpbmRleCA+IDApIHdyYXAuYXBwZW5kVGV4dChcIiwgXCIpO1xyXG4gICAgICBjb25zdCBzcGFuID0gd3JhcC5jcmVhdGVTcGFuKHsgdGV4dDogc3VidHlwZSB9KTtcclxuICAgICAgaWYgKGNvbG9yaXplKSBzcGFuLnN0eWxlLmNvbG9yID0gbmFtZUNvbG9yKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKS5jb2xvcjtcclxuICAgIH0pO1xyXG4gICAgd3JhcC5hcHBlbmRUZXh0KFwiKVwiKTtcclxuICB9XHJcblxyXG4gIHJlbmRlclVucmVnaXN0ZXJlZEl0ZW0odHlwZSwgY291bnQpIHtcclxuICAgIGNvbnN0IHRyZWVJdGVtID0gdGhpcy5saXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbVwiIH0pO1xyXG4gICAgY29uc3Qgc2VsZiA9IHRyZWVJdGVtLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0tc2VsZiBpcy1jbGlja2FibGUgZnJlZC10eXAtdW5yZWdpc3RlcmVkXCIgfSk7XHJcbiAgICBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0taW5uZXJcIiwgdGV4dDogZGlzcGxheVR5cGVLZXkodHlwZSkgfSk7XHJcbiAgICB0aGlzLnJlbmRlckNvdW50RmxhaXIoc2VsZiwgY291bnQpO1xyXG5cclxuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMucmVnaXN0ZXJUeXBlKHR5cGUpKTtcclxuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNvbnRleHRtZW51XCIsIChldmVudCkgPT4ge1xyXG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgdGhpcy5vcGVuU2VhcmNoKHR5cGUpO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICAvLyBBbGxlIFNVQlRZUC1XZXJ0ZSwgZGllIGluIE5vdGl6ZW4gdm9ya29tbWVuLCBhYmVyIHVudGVyIGlocmVtIFRZUCBuaWNodFxyXG4gIC8vIGVyZmFzc3Qgc2luZCAtIFx1MDBGQ2JlciBkZW4gZ2FuemVuIFZhdWx0LCBuaWNodCBudXIgZlx1MDBGQ3IgZWluZW4gVFlQIHdpZVxyXG4gIC8vIHJlbmRlclVucmVnaXN0ZXJlZFN1YnR5cGVzKCkgaW4gZGVyIERldGFpbGFuc2ljaHQuIERlciBJbmRleCBmXHUwMEZDaHJ0IHNlaW5lXHJcbiAgLy8gQnVja2V0cyBcdTAwRkNiZXIgQUxMRSBUWVAtU2NobFx1MDBGQ3NzZWwsIGFsc28gYXVjaCBcdTAwRkNiZXIgbmljaHQgZXJmYXNzdGU7IGRlcmVuXHJcbiAgLy8gU3VidHlwZW4ga29tbWVuIGRhaGVyIG1pdCAoS2xpY2sgZXJmYXNzdCBkYW5uIGJlaWRlcywgc2llaGVcclxuICAvLyByZWdpc3RlclR5cGVXaXRoU3VidHlwZSkuXHJcbiAgLy9cclxuICAvLyBTb3J0aWVydCBuYWNoIEFuemFobCwgZGFubiBuYWNoIGRlbSBaZWlsZW50ZXh0IHZvbiBsaW5rcyBuYWNoIHJlY2h0cyAoZXJzdFxyXG4gIC8vIFRZUCwgZGFubiBTdWJ0eXApIC0gZGllc2VsYmUgUmVnZWwgd2llIGluIGRlciBEZXRhaWxhbnNpY2h0LCB3byBkYXNcclxuICAvLyBIXHUwMEU0dWZpZ3N0ZSBvYmVuIHN0ZWh0LiBCZXd1c3N0IE5JQ0hUIG5hY2ggZGVtIFNvcnRpZXItQnV0dG9uIGRlciBMaXN0ZTpcclxuICAvLyBcIkZhcmJlXCIgdW5kIFwiTWFudWVsbFwiIGhhYmVuIGZcdTAwRkNyIG5pY2h0IGVyZmFzc3RlIFdlcnRlIGtlaW5lIEJlZGV1dHVuZy5cclxuICAvL1xyXG4gIC8vIEVpbmUgTm90aXogb2huZSBUWVAgYmxlaWJ0IGF1XHUwMERGZW4gdm9yIC0gZGVyIEluZGV4IHZlcndpcmZ0IGlocmVuIFNVQlRZUFxyXG4gIC8vIHNjaG9uIGJlaW0gWlx1MDBFNGhsZW4gKHNpZWhlIGFnZ3JlZ2F0ZSgpIGluIHR5cC1pbmRleC5qcyksIGVpbiBTVUJUWVAgb2huZSBUWVBcclxuICAvLyBoYXQga2VpbmVuIEtvbnRleHQuXHJcbiAgdW5yZWdpc3RlcmVkU3VidHlwZVJvd3MoKSB7XHJcbiAgICBjb25zdCByZWdpc3RlcmVkID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXM7XHJcbiAgICBjb25zdCByb3dzID0gW107XHJcbiAgICBmb3IgKGNvbnN0IFt0eXBlLCBidWNrZXRdIG9mIHRoaXMucGx1Z2luLnR5cEluZGV4LnN1YnR5cGVDb3VudHMoKSkge1xyXG4gICAgICBjb25zdCBrbm93biA9IGdldFN1YnR5cGVOYW1lcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSk7XHJcbiAgICAgIGZvciAoY29uc3QgW3N1YnR5cGUsIGNvdW50XSBvZiBidWNrZXQuY291bnRzKSB7XHJcbiAgICAgICAgaWYgKGtub3duLmluY2x1ZGVzKHN1YnR5cGUpKSBjb250aW51ZTtcclxuICAgICAgICByb3dzLnB1c2goeyB0eXBlLCBzdWJ0eXBlLCBjb3VudCwgdHlwZVJlZ2lzdGVyZWQ6IHJlZ2lzdGVyZWQuaW5jbHVkZXModHlwZSkgfSk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiByb3dzLnNvcnQoKGEsIGIpID0+IGIuY291bnQgLSBhLmNvdW50IHx8IGEudHlwZS5sb2NhbGVDb21wYXJlKGIudHlwZSkgfHwgYS5zdWJ0eXBlLmxvY2FsZUNvbXBhcmUoYi5zdWJ0eXBlKSk7XHJcbiAgfVxyXG5cclxuICAvLyBcIk5PVElaIC8gS3VyeiBHZXNjaGljaHRlXCIgLSBkZXIgU3VidHlwIGFsbGVpbiB3XHUwMEU0cmUgbWVocmRldXRpZywgZGVuc2VsYmVuXHJcbiAgLy8gTmFtZW4ga2FubiBlcyB1bnRlciBtZWhyZXJlbiBUWVBlbiBnZWJlbi4gSXN0IGRlciBUWVAgYmVyZWl0cyBlcmZhc3N0LFxyXG4gIC8vIHRyXHUwMEU0Z3Qgc2VpbiBUZWlsIGRlciBaZWlsZSBzZWluZSBGYXJiZSAoYnp3LiBlaW5lbiBGYXJicHVua3QgZGF2b3IsIGplIG5hY2hcclxuICAvLyBFaW5zdGVsbHVuZyBcIlRZUCBWaWV3IGVpbmZcdTAwRTRyYmVuXCIpIC0gYWJnZXNjaHdcdTAwRTRjaHQgXHUwMEZDYmVyIGRhcyBTdHlsZSBTZXR0aW5nXHJcbiAgLy8gXCJGYXJiZSBlcmZhc3N0ZXIgVFlQZW4gaW4gZGllc2VyIExpc3RlXCIsIGRhbWl0IGRpZSBaZWlsZW4gdHJvdHogRmFyYmVcclxuICAvLyBoaW50ZXIgZGVuIGVyZmFzc3RlbiBUWVBlbiBvYmVuIHp1clx1MDBGQ2NrYmxlaWJlbi4gSXN0IGF1Y2ggZGVyIFRZUCBuaWNodFxyXG4gIC8vIGVyZmFzc3QsIGJsZWlidCBkaWUgZ2FuemUgWmVpbGUgbXV0ZWQgd2llIGRpZSBFaW50clx1MDBFNGdlIGRhclx1MDBGQ2Jlci5cclxuICByZW5kZXJVbnJlZ2lzdGVyZWRTdWJ0eXBlSXRlbSh7IHR5cGUsIHN1YnR5cGUsIGNvdW50LCB0eXBlUmVnaXN0ZXJlZCB9KSB7XHJcbiAgICBjb25zdCB0cmVlSXRlbSA9IHRoaXMubGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW1cIiB9KTtcclxuICAgIGNvbnN0IHNlbGYgPSB0cmVlSXRlbS5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLXNlbGYgaXMtY2xpY2thYmxlIGZyZWQtdHlwLXVucmVnaXN0ZXJlZFwiIH0pO1xyXG5cclxuICAgIGNvbnN0IGNvbG9yaXplID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0O1xyXG4gICAgY29uc3QgeyBjb2xvciwgaXNEZWZhdWx0IH0gPSBuYW1lQ29sb3IodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUpO1xyXG4gICAgaWYgKHR5cGVSZWdpc3RlcmVkICYmICFjb2xvcml6ZSkge1xyXG4gICAgICBjb25zdCB3cmFwID0gc2VsZi5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtY29sb3Itd3JhcCBmcmVkLXR5cC11bnJlZ2lzdGVyZWQtc3VidHlwZS1jb2xvclwiIH0pO1xyXG4gICAgICBwYWludENvbG9yRG90KHdyYXAuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWNvbG9yLWRvdFwiIH0pLCBjb2xvciwgaXNEZWZhdWx0KTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBpbm5lciA9IHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1pbm5lclwiIH0pO1xyXG4gICAgY29uc3QgdHlwZUVsID0gaW5uZXIuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC11bnJlZ2lzdGVyZWQtc3VidHlwZS10eXBlXCIsIHRleHQ6IGRpc3BsYXlUeXBlS2V5KHR5cGUpIH0pO1xyXG4gICAgaWYgKHR5cGVSZWdpc3RlcmVkICYmIGNvbG9yaXplICYmICFpc0RlZmF1bHQpIHtcclxuICAgICAgdHlwZUVsLnN0eWxlLmNvbG9yID0gY29sb3I7XHJcbiAgICAgIHR5cGVFbC5hZGRDbGFzcyhcImZyZWQtdHlwLXVucmVnaXN0ZXJlZC1zdWJ0eXBlLWNvbG9yXCIpO1xyXG4gICAgfVxyXG4gICAgaW5uZXIuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC11bnJlZ2lzdGVyZWQtc3VidHlwZS1zbGFzaFwiLCB0ZXh0OiBcIiAvIFwiIH0pO1xyXG4gICAgaW5uZXIuY3JlYXRlU3Bhbih7IHRleHQ6IGRpc3BsYXlUeXBlS2V5KHN1YnR5cGUpIH0pO1xyXG5cclxuICAgIHRoaXMucmVuZGVyQ291bnRGbGFpcihzZWxmLCBjb3VudCk7XHJcblxyXG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5yZWdpc3RlclR5cGVXaXRoU3VidHlwZSh0eXBlLCBzdWJ0eXBlKSk7XHJcbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcclxuICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgIHRoaXMub3BlblN1YnR5cGVTZWFyY2godHlwZSwgc3VidHlwZSk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIC8vIEtsaWNrIGF1ZiBlaW5lIHNvbGNoZSBaZWlsZTogZXJmYXNzdCBkZW4gU3VidHlwIC0gdW5kLCBmYWxscyBuXHUwMEY2dGlnLCBzZWluZW5cclxuICAvLyBUWVAgZ2xlaWNoIG1pdC4gUmVpaGVuZm9sZ2UgendpbmdlbmQgZXJzdCBUWVAsIGRhbm4gU3VidHlwOiBkYXMgRXJmYXNzZW5cclxuICAvLyBlaW5lcyBUWVBzIGthbm4gZGVzc2VuIFdlcnQgaW4gZGVuIE5vdGl6ZW4gYmVyZWluaWdlbiAoXCIgYnVjaFwiIFx1MjE5MiBcIkJVQ0hcIiksXHJcbiAgLy8gZGFuYWNoIG11c3MgZGVyIFN1YnR5cC1BYmdsZWljaCBzY2hvbiBkZW4gTkVVRU4gVFlQLU5hbWVuIHZlcndlbmRlbiwgc29uc3RcclxuICAvLyBmaW5kZXQgcmVuYW1lU3VidHlwZUluTm90ZXMoKSBrZWluZSBEYXRlaSBtZWhyLlxyXG4gIC8vXHJcbiAgLy8gQmVpZGVzIHp1c2FtbWVuIHdpcmQgZGlyZWt0IGF1c2dlZlx1MDBGQ2hydCwgb2huZSBCZXN0XHUwMEU0dGlndW5nOiBlcyBpc3QgZWluZVxyXG4gIC8vIHJlaW5lIEVyZmFzc3VuZy4gTm90aXplbiBcdTAwRTRuZGVybiBzaWNoIG51ciwgd2VubiBkZXIgUm9od2VydCB1bnNhdWJlciB3YXIgdW5kXHJcbiAgLy8gZGFiZWkgYmVyZWluaWd0IHdpcmQgLSBlaW4gc2F1YmVyZXIgV2VydCBmYXNzdCBrZWluZSBlaW56aWdlIERhdGVpIGFuLlxyXG4gIGFzeW5jIHJlZ2lzdGVyVHlwZVdpdGhTdWJ0eXBlKHR5cGVLZXksIHN1YnR5cGVLZXkpIHtcclxuICAgIGNvbnN0IGJ1Y2tldCA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnN1YnR5cGVCdWNrZXQodHlwZUtleSk7XHJcbiAgICBjb25zdCB0eXBlUmVzdWx0ID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXMuaW5jbHVkZXModHlwZUtleSlcclxuICAgICAgPyB7IHR5cGU6IHR5cGVLZXksIHJlbmFtZWQ6IDAgfVxyXG4gICAgICA6IGF3YWl0IHRoaXMuYXBwbHlUeXBlUmVnaXN0cmF0aW9uKHR5cGVLZXkpO1xyXG4gICAgaWYgKCF0eXBlUmVzdWx0KSByZXR1cm47XHJcblxyXG4gICAgY29uc3Qgc3VidHlwZVJlc3VsdCA9IGF3YWl0IHRoaXMuYXBwbHlTdWJ0eXBlUmVnaXN0cmF0aW9uKHR5cGVSZXN1bHQudHlwZSwgc3VidHlwZUtleSwgYnVja2V0KTtcclxuICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgdGhpcy5yZW5kZXIoKTtcclxuICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG5cclxuICAgIGlmICghc3VidHlwZVJlc3VsdCkgcmV0dXJuO1xyXG4gICAgY29uc3QgcGFydHMgPSBbXTtcclxuICAgIGlmICh0eXBlUmVzdWx0LnR5cGUgIT09IHR5cGVLZXkpIHBhcnRzLnB1c2goYFRZUCAke3R5cGVSZXN1bHQudHlwZX1gKTtcclxuICAgIHBhcnRzLnB1c2goYFNVQlRZUCAke3N1YnR5cGVSZXN1bHQuc3VidHlwZX1gKTtcclxuICAgIGNvbnN0IGNoYW5nZWQgPSB0eXBlUmVzdWx0LnJlbmFtZWQgKyBzdWJ0eXBlUmVzdWx0LnJlbmFtZWQ7XHJcbiAgICBuZXcgTm90aWNlKGAke3BhcnRzLmpvaW4oXCIgdW5kIFwiKX0gcmVnaXN0cmllcnQke2NoYW5nZWQgPiAwID8gYCwgJHtjaGFuZ2VkfSBOb3RpeihlbikgYW5nZXBhc3N0YCA6IFwiXCJ9LmApO1xyXG4gIH1cclxuXHJcbiAgcmVuZGVyVHlwZVNldHRpbmdzKHR5cGUpIHtcclxuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xyXG4gICAgY29udGVudEVsLmVtcHR5KCk7XHJcblxyXG4gICAgY29uc3QgaGVhZGVyID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtaGVhZGVyXCIgfSk7XHJcbiAgICBjb25zdCBiYWNrQnRuID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1iYWNrXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiWnVyXHUwMEZDY2tcIiB9IH0pO1xyXG4gICAgc2V0SWNvbihiYWNrQnRuLCBcImFycm93LWxlZnRcIik7XHJcbiAgICBiYWNrQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlVHlwZVNldHRpbmdzKCkpO1xyXG5cclxuICAgIGNvbnN0IHRpdGxlRWwgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC10aXRsZVwiLCB0ZXh0OiB0eXBlIH0pO1xyXG4gICAgY29uc3QgdGl0bGVDb2xvciA9IHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdCA/IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV0gOiBudWxsO1xyXG4gICAgaWYgKHRpdGxlQ29sb3IpIHRpdGxlRWwuc3R5bGUuY29sb3IgPSB0aXRsZUNvbG9yO1xyXG5cclxuICAgIGNvbnN0IHsgY291bnRzIH0gPSB0aGlzLnBsdWdpbi50eXBJbmRleC50eXBlQ291bnRzKCk7XHJcbiAgICBoZWFkZXIuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtY291bnRcIiwgdGV4dDogU3RyaW5nKGNvdW50cy5nZXQodHlwZSkgPz8gMCkgfSk7XHJcblxyXG4gICAgLy8gTGlua3MgbmViZW4gZGVtIG5vcm1hbGVuIFVtYmVuZW5uZW4tQnV0dG9uLCBoZXJ2b3JnZWhvYmVuIChBa3plbnRmYXJiZSxcclxuICAgIC8vIHNpZWhlIHN0eWxlcy5jc3MpIC0gaW0gR2VnZW5zYXR6IHp1IGRpZXNlbSBzY2hyZWlidCBkaWVzZSBWYXJpYW50ZSBiZWltXHJcbiAgICAvLyBVbWJlbmVubmVuIHp1c1x1MDBFNHR6bGljaCBkZW4gVFlQLVdlcnQgYWxsZXIgYmV0cm9mZmVuZW4gTm90aXplbiB1bSAobmFjaFxyXG4gICAgLy8gQmVzdFx1MDBFNHRpZ3VuZywgc2llaGUgc3RhcnREZXRhaWxSZW5hbWUvQ29uZmlybVJlbmFtZVR5cGVNb2RhbCkuXHJcbiAgICBjb25zdCByZW5hbWVXaXRoTm90ZXNCdG4gPSBoZWFkZXIuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWRldGFpbC1yZW5hbWUtbm90ZXNcIixcclxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJVbWJlbmVubmVuIChpbmtsLiBOb3RpemVuIGFucGFzc2VuKVwiIH0sXHJcbiAgICB9KTtcclxuICAgIHNldEljb24ocmVuYW1lV2l0aE5vdGVzQnRuLCBcInBlbmNpbFwiKTtcclxuICAgIHJlbmFtZVdpdGhOb3Rlc0J0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5zdGFydERldGFpbFJlbmFtZSh0eXBlLCB0aXRsZUVsLCB7IHVwZGF0ZU5vdGVzOiB0cnVlIH0pKTtcclxuXHJcbiAgICBjb25zdCByZW5hbWVCdG4gPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWRldGFpbC1yZW5hbWVcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJVbWJlbmVubmVuXCIgfSB9KTtcclxuICAgIHNldEljb24ocmVuYW1lQnRuLCBcInBlbmNpbFwiKTtcclxuICAgIHJlbmFtZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5zdGFydERldGFpbFJlbmFtZSh0eXBlLCB0aXRsZUVsKSk7XHJcblxyXG4gICAgY29uc3QgZGVsZXRlQnRuID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1kZXRhaWwtZGVsZXRlXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiTFx1MDBGNnNjaGVuXCIgfSB9KTtcclxuICAgIHNldEljb24oZGVsZXRlQnRuLCBcInRyYXNoXCIpO1xyXG4gICAgZGVsZXRlQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnNob3dEZWxldGVDb25maXJtKHR5cGUpKTtcclxuXHJcbiAgICBjb25zdCBib2R5ID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtYm9keVwiIH0pO1xyXG5cclxuICAgIGNvbnN0IGRlc2NTZWN0aW9uID0gYm9keS5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZGVzY3JpcHRpb24tc2VjdGlvblwiIH0pO1xyXG5cclxuICAgIGNvbnN0IG9wdGlvbnNIZWFkZXIgPSBkZXNjU2VjdGlvbi5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItaGVhZGVyIGZyZWQtdHlwLW9wdGlvbnMtaGVhZGVyXCIgfSk7XHJcbiAgICBjb25zdCBtYW51YWxUb2dnbGVXcmFwID0gb3B0aW9uc0hlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtbWFudWFsLXRvZ2dsZVwiIH0pO1xyXG4gICAgbWFudWFsVG9nZ2xlV3JhcC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIsIHRleHQ6IFwiTWFudWVsbGVyIFRZUFwiIH0pO1xyXG4gICAgdGhpcy5yZW5kZXJNYW51YWxUb2dnbGUobWFudWFsVG9nZ2xlV3JhcCwgdHlwZSk7XHJcblxyXG4gICAgY29uc3QgY29sb3JSb3cgPSBvcHRpb25zSGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtY29sb3Itcm93XCIgfSk7XHJcbiAgICB0aGlzLnJlbmRlckNvbG9yUGlja2VyKFxyXG4gICAgICBjb2xvclJvdyxcclxuICAgICAgdHlwZSxcclxuICAgICAgKG5ld0NvbG9yKSA9PiB7XHJcbiAgICAgICAgaWYgKCF0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3QpIHJldHVybjtcclxuICAgICAgICB0aXRsZUVsLnN0eWxlLmNvbG9yID0gbmV3Q29sb3I7XHJcbiAgICAgIH0sXHJcbiAgICAgIHsgc2hvd1Jlc2V0OiB0cnVlIH1cclxuICAgICk7XHJcblxyXG4gICAgY29uc3QgZGVzY0hlYWRlciA9IGRlc2NTZWN0aW9uLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1mcm9udG1hdHRlci1oZWFkZXJcIiB9KTtcclxuICAgIGRlc2NIZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIsIHRleHQ6IFwiQmVzY2hyZWlidW5nXCIgfSk7XHJcblxyXG4gICAgY29uc3QgZGVzY0lucHV0ID0gZGVzY1NlY3Rpb24uY3JlYXRlRWwoXCJ0ZXh0YXJlYVwiLCB7XHJcbiAgICAgIGNsczogXCJmcmVkLXR5cC1kZXNjcmlwdGlvbi1pbnB1dFwiLFxyXG4gICAgICBhdHRyOiB7IHJvd3M6IFwiMlwiIH0sXHJcbiAgICB9KTtcclxuICAgIGRlc2NJbnB1dC52YWx1ZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV0gPz8gXCJcIjtcclxuICAgIGRlc2NJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsIGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgdmFsdWUgPSBkZXNjSW5wdXQudmFsdWUudHJpbSgpO1xyXG4gICAgICBpZiAodmFsdWUpIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV0gPSB2YWx1ZTtcclxuICAgICAgZWxzZSBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXTtcclxuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBUcmVubnQgZGllIEZyb250bWF0dGVyLUJsXHUwMEY2Y2tlIHZvbiBkZW4gXHUwMEZDYnJpZ2VuIEVpbnN0ZWxsdW5nZW4gZGVzIFRZUHMuXHJcbiAgICAvLyBib2R5LmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtc2VwYXJhdG9yXCIgfSk7XHJcblxyXG4gICAgLy8gVFlQLUZyb250bWF0dGVyIHVuZCBqZSByZWdpc3RyaWVydGVtIFN1YnR5cCBlaW4gQmxvY2sgZGFydW50ZXIsIGplZGVyXHJcbiAgICAvLyBtaXQgZWlnZW5lciBFZGl0b3ItSW5zdGFueiAoc2llaGUgZnJvbnRtYXR0ZXItYmxvY2tzLmpzKSAtIGRlcnNlbGJlIEtleVxyXG4gICAgLy8gZGFyZiBkZXNoYWxiIGluIG1laHJlcmVuIEJsXHUwMEY2Y2tlbiBzdGVoZW4uIEVpbiBTdWJ0eXAtQmxvY2sgZXJnXHUwMEU0bnp0IGRhc1xyXG4gICAgLy8gVFlQLUZyb250bWF0dGVyIGZcdTAwRkNyIE5vdGl6ZW4gbWl0IGRpZXNlbSBTVUJUWVAgdW5kIFx1MDBGQ2JlcnNjaHJlaWJ0IGRvcnRcclxuICAgIC8vIGdsZWljaG5hbWlnZSBQcm9wZXJ0aWVzIChzaWVoZSBzdWJ0eXBlcy5qcykuXHJcbiAgICBjb25zdCBidWNrZXQgPSB0aGlzLnBsdWdpbi50eXBJbmRleC5zdWJ0eXBlQnVja2V0KHR5cGUpO1xyXG4gICAgdGhpcy5mcm9udG1hdHRlckJsb2NrcyA9IG1vdW50RnJvbnRtYXR0ZXJCbG9ja3ModGhpcywgYm9keSwgdHlwZSwge1xyXG4gICAgICByZW5kZXJIZWFkZXI6IChzZWN0aW9uLCBlbCwgYmxvY2tzKSA9PiB0aGlzLnJlbmRlclNlY3Rpb25IZWFkZXIoZWwsIHR5cGUsIHNlY3Rpb24sIGJ1Y2tldCwgYmxvY2tzKSxcclxuICAgICAgcmVuZGVyRm9vdGVyOiAoc2VjdGlvbiwgZWwpID0+IHtcclxuICAgICAgICBpZiAoc2VjdGlvbiAhPT0gbnVsbCkgdGhpcy5yZW5kZXJTZWN0aW9uRm9vdGVyKGVsLCB0eXBlLCBzZWN0aW9uKTtcclxuICAgICAgfSxcclxuICAgICAgb25Nb3ZlU2VjdGlvbjogYXN5bmMgKG9yZGVyKSA9PiB7XHJcbiAgICAgICAgcmVvcmRlclN1YnR5cGVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlLCBvcmRlcik7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgdGhpcy5yZW5kZXIoKTtcclxuICAgICAgfSxcclxuICAgICAgb25TZWN0aW9uQ29udGV4dE1lbnU6IChzZWN0aW9uKSA9PiB0aGlzLm9wZW5TdWJ0eXBlU2VhcmNoKHR5cGUsIHNlY3Rpb24pLFxyXG4gICAgfSk7XHJcbiAgICB0aGlzLmZyb250bWF0dGVyRWRpdG9ycy5wdXNoKC4uLnRoaXMuZnJvbnRtYXR0ZXJCbG9ja3MuZWRpdG9ycyk7XHJcblxyXG4gICAgLy8gQmV3dXNzdCBcdTAwRkNiZXIgZGllIHZvbGxlIEJyZWl0ZSB1bmQgaW4gQWt6ZW50ZmFyYmUsIGRhbWl0IGVyIHNpY2ggdm9uIGRlblxyXG4gICAgLy8ga2xlaW5lbiBJY29uLUJ1dHRvbnMgZGVyIEJsXHUwMEY2Y2tlIGFiaGVidC5cclxuICAgIHRoaXMuc3VidHlwZUFkZEJ0bkVsID0gYm9keS5jcmVhdGVFbChcImJ1dHRvblwiLCB7IGNsczogXCJtb2QtY3RhIGZyZWQtdHlwLXN1YnR5cGUtYWRkXCIgfSk7XHJcbiAgICBzZXRJY29uKHRoaXMuc3VidHlwZUFkZEJ0bkVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtc3VidHlwZS1hZGQtaWNvblwiIH0pLCBcInBsdXNcIik7XHJcbiAgICB0aGlzLnN1YnR5cGVBZGRCdG5FbC5jcmVhdGVTcGFuKHsgdGV4dDogXCJTdWJ0eXAgaGluenVmXHUwMEZDZ2VuXCIgfSk7XHJcbiAgICB0aGlzLnN1YnR5cGVBZGRCdG5FbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5zdGFydEFkZFN1YnR5cGUodHlwZSkpO1xyXG5cclxuICAgIHRoaXMucmVuZGVyVW5yZWdpc3RlcmVkU3VidHlwZXMoYm9keSwgdHlwZSwgYnVja2V0KTtcclxuXHJcbiAgICBib2R5LmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtc2VwYXJhdG9yXCIgfSk7XHJcbiAgICB0aGlzLnJlbmRlckZsb2F0aW5nSGludChib2R5KTtcclxuICAgIC8vIEZldHQtTWFya2llcnVuZyAoc2llaGUgZnJvbnRtYXR0ZXItZGVmYXVsdC1oaWdobGlnaHQuanMpIHJlYWdpZXJ0IG51ciBhdWZcclxuICAgIC8vIE1ldGFkYXRlbi0vTGF5b3V0LUV2ZW50cyAtIGRhcyBcdTAwRDZmZm5lbiBkaWVzZXIgRGV0YWlsYW5zaWNodCBzZWxic3QgbFx1MDBGNnN0XHJcbiAgICAvLyBrZWlucyBkYXZvbiBhdXMsIGRhaGVyIGhpZXIgZGlyZWt0IG5hY2ggZGVtIE1vdW50ZW4gYW5zdG9cdTAwREZlbi4gQmV3dXNzdFxyXG4gICAgLy8gbnVyIGRpZXNlciBlaW5lLCBnZXppZWx0ZSBSZWZyZXNoIHN0YXR0IGRlcyB2b2xsZW4gcmVmcmVzaFR5cENvbG9ycygpLVxyXG4gICAgLy8gQlx1MDBGQ25kZWxzOiBkYXMgd1x1MDBGQ3JkZSB1LiBhLiBhdWNoIHJlbmRlcigpIGF1ZiBkaWVzZW0gKGdlcmFkZSBlcnN0IG1pdHRlblxyXG4gICAgLy8gaW0gZWlnZW5lbiByZW5kZXIoKS1EdXJjaGxhdWYgYmVmaW5kbGljaGVuKSBWaWV3IGVybmV1dCBhdXNsXHUwMEY2c2VuLlxyXG4gICAgdGhpcy5wbHVnaW4ucmVmcmVzaEZyb250bWF0dGVySGlnaGxpZ2h0Py4oKTtcclxuICB9XHJcblxyXG4gIC8vIFx1MDBEQ2JlcnNjaHJpZnQgZWluZXMgQmxvY2tzIChzaWVoZSBmcm9udG1hdHRlci1ibG9ja3MuanMpOiBUaXRlbCBtaXRcclxuICAvLyBOb3Rpei1BbnphaGwgKGJlaW0gVFlQLUZyb250bWF0dGVyIGRpZSBOb3RpemVuIG9obmUgU1VCVFlQIC0gZlx1MDBGQ3IgZGllIGdpbHRcclxuICAvLyBudXIgZGllc2VyIEJsb2NrKSwgU3VjaGUgcGVyIFJlY2h0c2tsaWNrIChiZWltIFRZUC1Gcm9udG1hdHRlciBhdWYgZGVuXHJcbiAgLy8gVGl0ZWwpLCB1bmQgZGllIGJlaWRlbiBcIlByb3BlcnR5IGhpbnp1Zlx1MDBGQ2dlblwiLUJ1dHRvbnMsIGRpZSBlaW5lIExlZXJ6ZWlsZVxyXG4gIC8vIGluIGdlbmF1IGRpZXNlbSBCbG9jayBhbmxlZ2VuLlxyXG4gIHJlbmRlclNlY3Rpb25IZWFkZXIoZWwsIHR5cGUsIHNlY3Rpb24sIGJ1Y2tldCwgYmxvY2tzKSB7XHJcbiAgICBjb25zdCB0aXRsZUdyb3VwID0gZWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLXRpdGxlLWdyb3VwXCIgfSk7XHJcbiAgICAvLyBCZXd1c3N0IG5pZSBlaW5nZWZcdTAwRTRyYnQgKHdlZGVyIGluIGRlciBUWVAtIG5vY2ggaW4gZGVyIFN1YnR5cC1GYXJiZSksXHJcbiAgICAvLyBhbmRlcnMgYWxzIGRlciBUaXRlbCBkZXIgRGV0YWlsYW5zaWNodCBkYXJcdTAwRkNiZXI6IGRpZSBGYXJiZSBlaW5lcyBCbG9ja3NcclxuICAgIC8vIHN0ZWh0IGltIEZhcmJwdW5rdCBzZWluZXMgQWJzY2hsdXNzZXMgKHNpZWhlIHJlbmRlclNlY3Rpb25Gb290ZXIpLlxyXG4gICAgY29uc3QgdGl0bGVFbCA9IHRpdGxlR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIsIHRleHQ6IHNlY3Rpb24gPz8gYCR7dHlwZX0tRnJvbnRtYXR0ZXJgIH0pO1xyXG4gICAgY29uc3QgY291bnQgPSBzZWN0aW9uID09PSBudWxsID8gYnVja2V0Lm5vU3VidHlwZSA6IGJ1Y2tldC5jb3VudHMuZ2V0KHNlY3Rpb24pID8/IDA7XHJcbiAgICB0aXRsZUdyb3VwLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtc3VidHlwZS1jb3VudFwiLCB0ZXh0OiBTdHJpbmcoY291bnQpIH0pO1xyXG4gICAgLy8gU3VidHlwLUJsXHUwMEY2Y2tlIHJlYWdpZXJlbiBhdWYgaWhyZXIgZ2FuemVuIEZsXHUwMEU0Y2hlIChzaWVoZVxyXG4gICAgLy8gb25TZWN0aW9uQ29udGV4dE1lbnUgaW4gcmVuZGVyVHlwZVNldHRpbmdzKSwgZGFzIFRZUC1Gcm9udG1hdHRlclxyXG4gICAgLy8gbnVyIGF1ZiBkZW0gVGl0ZWwuXHJcbiAgICBpZiAoc2VjdGlvbiA9PT0gbnVsbCkge1xyXG4gICAgICB0aXRsZUVsLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcclxuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgIHRoaXMub3BlblN1YnR5cGVTZWFyY2godHlwZSwgbnVsbCk7XHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEZsb2F0aW5nIFByb3BlcnRpZXMgKHNpZWhlIHR5cGVGbG9hdGluZ0tleXMgaW4gc2V0dGluZ3MuanMpIHNpbmQgVGVpbFxyXG4gICAgLy8gZGVyc2VsYmVuIExpc3RlIHVuZCBSZWloZW5mb2xnZSB3aWUgZGllIFx1MDBGQ2JyaWdlbiBQcm9wZXJ0aWVzICh3aWNodGlnIGZcdTAwRkNyXHJcbiAgICAvLyBkaWUgRnJvbnRtYXR0ZXItU29ydGllcnVuZyksIGxhbmRlbiBhbHNvIGFuIGdlbmF1IGRlciBTdGVsbGUsIGFuIGRpZSBzaWVcclxuICAgIC8vIHBlciBEcmFnICYgRHJvcCBlaW5zb3J0aWVydCB3ZXJkZW4sIHN0YXR0IGZlc3QgYW5zIEVuZGUgZWluZXIgendlaXRlbiBMaXN0ZS5cclxuICAgIGNvbnN0IGFkZEJ1dHRvbnMgPSBlbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItYWRkLWdyb3VwXCIgfSk7XHJcblxyXG4gICAgLy8gTGlua3MgbmViZW4gZGVtIG5vcm1hbGVuIEJ1dHRvbiwgaGVydm9yZ2Vob2JlbiAoQWt6ZW50ZmFyYmUsIHdpZVxyXG4gICAgLy8gcmVuYW1lV2l0aE5vdGVzQnRuIG9iZW4pIC0gbWFya2llcnQgZGllIGFscyBuXHUwMEU0Y2hzdGVzIGhpbnp1Z2VmXHUwMEZDZ3RlIChiencuXHJcbiAgICAvLyBiaXMgenVtIG5cdTAwRTRjaHN0ZW4gU3BlaWNoZXJuIHVtYmVuYW5udGUpIFByb3BlcnR5IGFscyBGbG9hdGluZywgc3RhdHQgc2llXHJcbiAgICAvLyBhbHMgbm9ybWFsZSBTdGFuZGFyZC1Qcm9wZXJ0eSBhbnp1bGVnZW4gKHNpZWhlIGVkaXRvci5mcmVkUGVuZGluZ0Zsb2F0aW5nQWRkXHJcbiAgICAvLyBpbiB0eXBlLWZyb250bWF0dGVyLWVkaXRvci5qcykuIEZsb2F0aW5nIFByb3BlcnRpZXMgd2VyZGVuIE5JQ0hUXHJcbiAgICAvLyBhdXRvbWF0aXNjaCBiZWkgbmV1ZW4gTm90aXplbiBhbmdlbGVndCAoc2llaGUgZ2V0VHlwZURlZmF1bHRzKCkgaW5cclxuICAgIC8vIG1haW4uanMpIHVuZCBkb3J0LCBzb2JhbGQgZG9jaCB2b3JoYW5kZW4sIGt1cnNpdiBzdGF0dCBmZXR0IGRhcmdlc3RlbGx0XHJcbiAgICAvLyAoc2llaGUgZnJvbnRtYXR0ZXItZGVmYXVsdC1oaWdobGlnaHQuanMpLlxyXG4gICAgY29uc3QgYWRkRmxvYXRpbmdQcm9wZXJ0eUJ0biA9IGFkZEJ1dHRvbnMuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWZyb250bWF0dGVyLWFkZC1mbG9hdGluZ1wiLFxyXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkZsb2F0aW5nIFByb3BlcnR5IGhpbnp1Zlx1MDBGQ2dlblwiIH0sXHJcbiAgICB9KTtcclxuICAgIHNldEljb24oYWRkRmxvYXRpbmdQcm9wZXJ0eUJ0biwgXCJwbHVzXCIpO1xyXG4gICAgYWRkRmxvYXRpbmdQcm9wZXJ0eUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gYmxvY2tzLmFkZEJsYW5rKHNlY3Rpb24sIHRydWUpKTtcclxuXHJcbiAgICBjb25zdCBhZGRQcm9wZXJ0eUJ0biA9IGFkZEJ1dHRvbnMuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWZyb250bWF0dGVyLWFkZFwiLFxyXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlByb3BlcnR5IGhpbnp1Zlx1MDBGQ2dlblwiIH0sXHJcbiAgICB9KTtcclxuICAgIHNldEljb24oYWRkUHJvcGVydHlCdG4sIFwicGx1c1wiKTtcclxuICAgIGFkZFByb3BlcnR5QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiBibG9ja3MuYWRkQmxhbmsoc2VjdGlvbiwgZmFsc2UpKTtcclxuICB9XHJcblxyXG4gIC8vIEFic2NobHVzcyBlaW5lcyBTdWJ0eXAtQmxvY2tzOiBsaW5rcyBkaWUgRmFyYmUgZGVzIFN1YnR5cHMgKEZhcmJwdW5rdCwgZGVyXHJcbiAgLy8gZGllIFJlZ2xlciBcdTAwRjZmZm5ldCwgZGFuZWJlbiBadXJcdTAwRkNja3NldHplbiksIHJlY2h0cyBkaWUgQWt0aW9uZW4gd2llIGltIEtvcGZcclxuICAvLyBkZXIgVFlQLURldGFpbGFuc2ljaHQgKFVtYmVuZW5uZW4gaW5rbC4gTm90aXplbiwgVW1iZW5lbm5lbiwgTFx1MDBGNnNjaGVuKS4gRGFzXHJcbiAgLy8gVFlQLUZyb250bWF0dGVyIGhhdCBrZWluZW4uIERlciBUaXRlbCB3aXJkIGVyc3QgYmVpbSBLbGljayBnZXN1Y2h0IC1cclxuICAvLyBcdTAwRENiZXJzY2hyaWZ0IHVuZCBBYnNjaGx1c3MgZW50c3RlaGVuIGJlaSBqZWRlbSBzeW5jaHJvbml6ZSgpIG5ldS5cclxuICByZW5kZXJTZWN0aW9uRm9vdGVyKGVsLCB0eXBlLCBzdWJ0eXBlKSB7XHJcbiAgICBlbC5hZGRDbGFzcyhcImZyZWQtdHlwLXN1YnR5cGUtYWN0aW9uc1wiKTtcclxuICAgIGNvbnN0IGNvbG9yR3JvdXAgPSBlbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtc3VidHlwZS1jb2xvci1ncm91cFwiIH0pO1xyXG4gICAgLy8gUmluZyBhdWNoLCBzb2xhbmdlIGRlciBUWVAgc2VsYnN0IGtlaW5lIEZhcmJlIGhhdCAtIGRhbm4gZlx1MDBFNHJidCBhdWNoXHJcbiAgICAvLyBlaW5lIGVpbmdlc3RlbGx0ZSBBYndlaWNodW5nIG5pcmdlbmRzIGVpbi5cclxuICAgIGNvbnN0IG93bkNvbG9yID0gc3VidHlwZUhhc093bkNvbG9yKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKTtcclxuICAgIGNvbnN0IHR5cGVIYXNDb2xvciA9ICEhdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXTtcclxuICAgIGNvbnN0IGNvbG9yRG90ID0gY29sb3JHcm91cC5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwiZnJlZC10eXAtc3VidHlwZS1jb2xvci1kb3RcIixcclxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogIXR5cGVIYXNDb2xvciA/IFwiVFlQIGhhdCBrZWluZSBGYXJiZVwiIDogb3duQ29sb3IgPyBcIkZhcmJlIGFucGFzc2VuXCIgOiBcIlx1MDBEQ2Jlcm5pbW10IFRZUC1GYXJiZVwiIH0sXHJcbiAgICB9KTtcclxuICAgIGNvbG9yRG90LmZyZWRTdWJ0eXBlID0gc3VidHlwZTtcclxuICAgIHBhaW50Q29sb3JEb3QoY29sb3JEb3QsIHN1YnR5cGVDb2xvcih0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSkgPz8gREVGQVVMVF9UWVBFX0NPTE9SLCAhb3duQ29sb3IgfHwgIXR5cGVIYXNDb2xvcik7XHJcbiAgICBjb2xvckRvdC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5vcGVuU3VidHlwZUNvbG9yUG9wb3Zlcihjb2xvckRvdCwgdHlwZSwgc3VidHlwZSkpO1xyXG4gICAgY29uc3QgcmVzZXRCdG4gPSBjb2xvckdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1jb2xvci1yZXNldFwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkZhcmJlIHp1clx1MDBGQ2Nrc2V0emVuXCIgfSB9KTtcclxuICAgIHJlc2V0QnRuLnRvZ2dsZUNsYXNzKFwiaXMtZGlzYWJsZWRcIiwgIW93bkNvbG9yKTtcclxuICAgIHNldEljb24ocmVzZXRCdG4sIFwicm90YXRlLWNjd1wiKTtcclxuICAgIHJlc2V0QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGRhdGEgPSBnZXRTdWJ0eXBlKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKTtcclxuICAgICAgaWYgKCFkYXRhPy5jb2xvcikgcmV0dXJuO1xyXG4gICAgICBkZWxldGUgZGF0YS5jb2xvcjtcclxuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgICB0aGlzLnJlbmRlcigpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgYWN0aW9ucyA9IGVsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1zdWJ0eXBlLWFjdGlvbi1ncm91cFwiIH0pO1xyXG4gICAgY29uc3QgdGl0bGVFbCA9ICgpID0+IHtcclxuICAgICAgbGV0IHNpYmxpbmcgPSBlbC5wcmV2aW91c0VsZW1lbnRTaWJsaW5nO1xyXG4gICAgICB3aGlsZSAoc2libGluZyAmJiAhc2libGluZy5oYXNDbGFzcyhcImZyZWQtdHlwLXNlY3Rpb24taGVhZGVyXCIpKSBzaWJsaW5nID0gc2libGluZy5wcmV2aW91c0VsZW1lbnRTaWJsaW5nO1xyXG4gICAgICByZXR1cm4gc2libGluZz8ucXVlcnlTZWxlY3RvcihcIi5mcmVkLXR5cC1kZXRhaWwtc2VjdGlvbi10aXRsZVwiKSA/PyBudWxsO1xyXG4gICAgfTtcclxuICAgIGNvbnN0IHJlbmFtZSA9ICh1cGRhdGVOb3RlcykgPT4ge1xyXG4gICAgICBjb25zdCB0YXJnZXQgPSB0aXRsZUVsKCk7XHJcbiAgICAgIGlmICh0YXJnZXQpIHRoaXMuc3RhcnRTdWJ0eXBlUmVuYW1lKHR5cGUsIHN1YnR5cGUsIHRhcmdldCwgeyB1cGRhdGVOb3RlcyB9KTtcclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgcmVuYW1lV2l0aE5vdGVzQnRuID0gYWN0aW9ucy5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gZnJlZC10eXAtZGV0YWlsLXJlbmFtZS1ub3Rlc1wiLFxyXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlVtYmVuZW5uZW4gKGlua2wuIE5vdGl6ZW4gYW5wYXNzZW4pXCIgfSxcclxuICAgIH0pO1xyXG4gICAgc2V0SWNvbihyZW5hbWVXaXRoTm90ZXNCdG4sIFwicGVuY2lsXCIpO1xyXG4gICAgcmVuYW1lV2l0aE5vdGVzQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiByZW5hbWUodHJ1ZSkpO1xyXG5cclxuICAgIGNvbnN0IHJlbmFtZUJ0biA9IGFjdGlvbnMuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWRldGFpbC1yZW5hbWVcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJVbWJlbmVubmVuXCIgfSB9KTtcclxuICAgIHNldEljb24ocmVuYW1lQnRuLCBcInBlbmNpbFwiKTtcclxuICAgIHJlbmFtZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gcmVuYW1lKGZhbHNlKSk7XHJcblxyXG4gICAgY29uc3QgZGVsZXRlQnRuID0gYWN0aW9ucy5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gZnJlZC10eXAtZGV0YWlsLWRlbGV0ZVwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkxcdTAwRjZzY2hlblwiIH0gfSk7XHJcbiAgICBzZXRJY29uKGRlbGV0ZUJ0biwgXCJ0cmFzaFwiKTtcclxuICAgIGRlbGV0ZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5kZWxldGVTdWJ0eXBlV2l0aENvbmZpcm0odHlwZSwgc3VidHlwZSkpO1xyXG4gIH1cclxuXHJcbiAgLy8gUG9wb3ZlciB1bnRlciBkZW0gRmFyYnB1bmt0IGVpbmVzIFN1YnR5cC1CbG9ja3M6IGplIGVpbiBSZWdsZXIgZlx1MDBGQ3JcclxuICAvLyBGYXJidG9uLCBTXHUwMEU0dHRpZ3VuZyB1bmQgSGVsbGlna2VpdCwgYmVncmVuenQgYXVmIGRpZSBpbiBkZW4gRWluc3RlbGx1bmdlblxyXG4gIC8vIGZlc3RnZWxlZ3RlIEFid2VpY2h1bmcgKHNpZWhlIHR5cGUtY29sb3JzLmpzKS4gRGllIExlaXN0ZSBqZWRlcyBSZWdsZXJzXHJcbiAgLy8gemVpZ3QgYWxzIFZlcmxhdWYgZGllIEZhcmJlbiwgZGllIGVyIGVycmVpY2hlbiBrYW5uLiBCZWltIFppZWhlbiBcdTAwRTRuZGVydFxyXG4gIC8vIHNpY2ggbnVyIGRlciBGYXJicHVua3QgaGllcjsgZ2VzcGVpY2hlcnQgdW5kIGluIGRpZSBcdTAwRkNicmlnZW4gQW5zaWNodGVuXHJcbiAgLy8gXHUwMEZDYmVybm9tbWVuIHdpcmQgYmVpbSBTY2hsaWVcdTAwREZlbiAoS2xpY2sgZGFuZWJlbiBvZGVyIEVzY2FwZSkgLSBlaW5cclxuICAvLyByZWZyZXNoVHlwQ29sb3JzKCkgcmVuZGVydCB1LiBhLiBkaWVzZSBBbnNpY2h0IG5ldS5cclxuICBvcGVuU3VidHlwZUNvbG9yUG9wb3ZlcihhbmNob3JFbCwgdHlwZSwgc3VidHlwZSkge1xyXG4gICAgdGhpcy5jbG9zZVN1YnR5cGVDb2xvclBvcG92ZXI/LigpO1xyXG4gICAgY29uc3QgeyBzZXR0aW5ncyB9ID0gdGhpcy5wbHVnaW47XHJcbiAgICBjb25zdCBkYXRhID0gZ2V0U3VidHlwZShzZXR0aW5ncywgdHlwZSwgc3VidHlwZSk7XHJcbiAgICBpZiAoIWRhdGEpIHJldHVybjtcclxuICAgIGNvbnN0IHR5cGVDb2xvciA9IHNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV0gPz8gREVGQVVMVF9UWVBFX0NPTE9SO1xyXG4gICAgLy8gT2huZSBlaWdlbmUgQWJ3ZWljaHVuZyBzdGVodCBqZWRlciBSZWdsZXIgYXVmIDAgLSB3ZWxjaGUgZXMgZ2lidCwgc2FndFxyXG4gICAgLy8gYWxsZWluIFNVQlRZUEVfQ09MT1JfQ0hBTk5FTFMgKHNpZWhlIHR5cGUtY29sb3JzLmpzKS5cclxuICAgIGNvbnN0IG9mZnNldCA9IGNsYW1wZWRPZmZzZXQoc2V0dGluZ3MsIGRhdGEuY29sb3IpID8/IE9iamVjdC5mcm9tRW50cmllcyhTVUJUWVBFX0NPTE9SX0NIQU5ORUxTLm1hcCgoeyBrZXkgfSkgPT4gW2tleSwgMF0pKTtcclxuICAgIGNvbnN0IGRvYyA9IGFuY2hvckVsLmRvYztcclxuICAgIGNvbnN0IHBvcG92ZXIgPSBkb2MuYm9keS5jcmVhdGVEaXYoeyBjbHM6IFwibWVudSBmcmVkLXR5cC1zdWJ0eXBlLWNvbG9yLXBvcG92ZXJcIiB9KTtcclxuXHJcbiAgICBjb25zdCByb3dzID0gW107XHJcbiAgICBjb25zdCB1cGRhdGUgPSAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGNvbG9yID0gYXBwbHlDb2xvck9mZnNldCh0eXBlQ29sb3IsIG9mZnNldCk7XHJcbiAgICAgIGZvciAoY29uc3QgZWwgb2YgdGhpcy5jb250ZW50RWwucXVlcnlTZWxlY3RvckFsbChcIi5mcmVkLXR5cC1zdWJ0eXBlLWNvbG9yLWRvdFwiKSkge1xyXG4gICAgICAgIGlmIChlbC5mcmVkU3VidHlwZSA9PT0gc3VidHlwZSkgcGFpbnRDb2xvckRvdChlbCwgY29sb3IsICFoYXNDb2xvck9mZnNldChvZmZzZXQpIHx8ICFzZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdKTtcclxuICAgICAgfVxyXG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiByb3dzKSByb3coKTtcclxuICAgIH07XHJcblxyXG4gICAgZm9yIChjb25zdCB7IGtleSwgbGFiZWwsIHVuaXQgfSBvZiBTVUJUWVBFX0NPTE9SX0NIQU5ORUxTKSB7XHJcbiAgICAgIGNvbnN0IFttaW4sIG1heF0gPSBjaGFubmVsQm91bmRzKHNldHRpbmdzLCBrZXkpO1xyXG4gICAgICBjb25zdCByb3cgPSBwb3BvdmVyLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1zdWJ0eXBlLWNvbG9yLXJvd1wiIH0pO1xyXG4gICAgICByb3cuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1zdWJ0eXBlLWNvbG9yLWxhYmVsXCIsIHRleHQ6IGxhYmVsIH0pO1xyXG4gICAgICBjb25zdCBpbnB1dCA9IHJvdy5jcmVhdGVFbChcImlucHV0XCIsIHsgdHlwZTogXCJyYW5nZVwiLCBjbHM6IFwic2xpZGVyIGZyZWQtdHlwLXN1YnR5cGUtY29sb3Itc2xpZGVyXCIgfSk7XHJcbiAgICAgIGlucHV0Lm1pbiA9IFN0cmluZyhtaW4pO1xyXG4gICAgICBpbnB1dC5tYXggPSBTdHJpbmcobWF4KTtcclxuICAgICAgaW5wdXQuc3RlcCA9IFwiMVwiO1xyXG4gICAgICBpbnB1dC52YWx1ZSA9IFN0cmluZyhvZmZzZXRba2V5XSk7XHJcbiAgICAgIGlucHV0LmRpc2FibGVkID0gbWluID09PSBtYXg7XHJcbiAgICAgIGNvbnN0IHZhbHVlRWwgPSByb3cuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1zdWJ0eXBlLWNvbG9yLXZhbHVlXCIgfSk7XHJcbiAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJpbnB1dFwiLCAoKSA9PiB7XHJcbiAgICAgICAgb2Zmc2V0W2tleV0gPSBOdW1iZXIoaW5wdXQudmFsdWUpO1xyXG4gICAgICAgIHVwZGF0ZSgpO1xyXG4gICAgICB9KTtcclxuICAgICAgcm93cy5wdXNoKCgpID0+IHtcclxuICAgICAgICBjb25zdCBzdGVwcyA9IDg7XHJcbiAgICAgICAgY29uc3Qgc3RvcHMgPSBbXTtcclxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8PSBzdGVwczsgaSsrKSB7XHJcbiAgICAgICAgICBzdG9wcy5wdXNoKGFwcGx5Q29sb3JPZmZzZXQodHlwZUNvbG9yLCB7IC4uLm9mZnNldCwgW2tleV06IG1pbiArICgobWF4IC0gbWluKSAqIGkpIC8gc3RlcHMgfSkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpbnB1dC5zdHlsZS5zZXRQcm9wZXJ0eShcIi0tZnJlZC10cmFja1wiLCBgbGluZWFyLWdyYWRpZW50KHRvIHJpZ2h0LCAke3N0b3BzLmpvaW4oXCIsIFwiKX0pYCk7XHJcbiAgICAgICAgdmFsdWVFbC5zZXRUZXh0KGAke29mZnNldFtrZXldID4gMCA/IFwiK1wiIDogXCJcIn0ke29mZnNldFtrZXldfSR7dW5pdH1gKTtcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICB1cGRhdGUoKTtcclxuXHJcbiAgICAvLyBVbnRlciBkZW0gUHVua3QsIGFiZXIgaW5uZXJoYWxiIGRlcyBGZW5zdGVycy5cclxuICAgIGNvbnN0IHJlY3QgPSBhbmNob3JFbC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcclxuICAgIGNvbnN0IHdpbiA9IGRvYy5kZWZhdWx0VmlldztcclxuICAgIGNvbnN0IHdpZHRoID0gcG9wb3Zlci5vZmZzZXRXaWR0aDtcclxuICAgIGNvbnN0IGhlaWdodCA9IHBvcG92ZXIub2Zmc2V0SGVpZ2h0O1xyXG4gICAgcG9wb3Zlci5zdHlsZS5sZWZ0ID0gYCR7TWF0aC5tYXgoOCwgTWF0aC5taW4ocmVjdC5sZWZ0LCB3aW4uaW5uZXJXaWR0aCAtIHdpZHRoIC0gOCkpfXB4YDtcclxuICAgIHBvcG92ZXIuc3R5bGUudG9wID0gYCR7cmVjdC5ib3R0b20gKyA2ICsgaGVpZ2h0ID4gd2luLmlubmVySGVpZ2h0IC0gOCA/IHJlY3QudG9wIC0gNiAtIGhlaWdodCA6IHJlY3QuYm90dG9tICsgNn1weGA7XHJcblxyXG4gICAgY29uc3Qgb25Qb2ludGVyRG93biA9IChldmVudCkgPT4ge1xyXG4gICAgICBpZiAoIXBvcG92ZXIuY29udGFpbnMoZXZlbnQudGFyZ2V0KSkgY2xvc2UoKTtcclxuICAgIH07XHJcbiAgICBjb25zdCBvbktleURvd24gPSAoZXZlbnQpID0+IHtcclxuICAgICAgaWYgKGV2ZW50LmtleSAhPT0gXCJFc2NhcGVcIikgcmV0dXJuO1xyXG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgY2xvc2UoKTtcclxuICAgIH07XHJcbiAgICBjb25zdCBjbG9zZSA9IGFzeW5jICgpID0+IHtcclxuICAgICAgdGhpcy5jbG9zZVN1YnR5cGVDb2xvclBvcG92ZXIgPSBudWxsO1xyXG4gICAgICBkb2MucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNlZG93blwiLCBvblBvaW50ZXJEb3duLCB0cnVlKTtcclxuICAgICAgZG9jLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIG9uS2V5RG93biwgdHJ1ZSk7XHJcbiAgICAgIHBvcG92ZXIucmVtb3ZlKCk7XHJcbiAgICAgIGNvbnN0IGN1cnJlbnQgPSBnZXRTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKTtcclxuICAgICAgaWYgKCFjdXJyZW50KSByZXR1cm47XHJcbiAgICAgIGlmIChoYXNDb2xvck9mZnNldChvZmZzZXQpKSBjdXJyZW50LmNvbG9yID0geyAuLi5vZmZzZXQgfTtcclxuICAgICAgZWxzZSBkZWxldGUgY3VycmVudC5jb2xvcjtcclxuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgICB0aGlzLnJlbmRlcigpO1xyXG4gICAgfTtcclxuICAgIHRoaXMuY2xvc2VTdWJ0eXBlQ29sb3JQb3BvdmVyID0gY2xvc2U7XHJcbiAgICBkb2MuYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlZG93blwiLCBvblBvaW50ZXJEb3duLCB0cnVlKTtcclxuICAgIGRvYy5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCBvbktleURvd24sIHRydWUpO1xyXG4gIH1cclxuXHJcbiAgLy8gTFx1MDBGNnNjaHQgZGVuIFN1YnR5cC1CbG9jayBzYW10IHNlaW5lciBQcm9wZXJ0aWVzLiBEaWUgTm90aXplbiBiZWhhbHRlbiBpaHJlblxyXG4gIC8vIFNVQlRZUC1XZXJ0IChlciBlcnNjaGVpbnQgZGFuYWNoIHVudGVuIGFscyBuaWNodCBlcmZhc3N0ZXIgU3VidHlwKSAtIGVpbmVcclxuICAvLyBCZXN0XHUwMEU0dGlndW5nIGJyYXVjaHQgZXMgZGFoZXIgbnVyLCB3ZW5uIGRhYmVpIFByb3BlcnRpZXMgdmVybG9yZW4gZ2VoZW4uXHJcbiAgZGVsZXRlU3VidHlwZVdpdGhDb25maXJtKHR5cGUsIHN1YnR5cGUpIHtcclxuICAgIGNvbnN0IGFwcGx5ID0gYXN5bmMgKCkgPT4ge1xyXG4gICAgICBkZWxldGVTdWJ0eXBlKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKTtcclxuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgICB0aGlzLnJlbmRlcigpO1xyXG4gICAgfTtcclxuICAgIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyhnZXRTdWJ0eXBlKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKT8uZnJvbnRtYXR0ZXIgPz8ge30pLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwiXCIpO1xyXG4gICAgaWYgKGtleXMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgIGFwcGx5KCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIG5ldyBDb25maXJtU3VidHlwZU1vZGFsKHRoaXMuYXBwLCB7XHJcbiAgICAgIHBhcmFncmFwaHM6IFtcclxuICAgICAgICBgU3VidHlwICR7c3VidHlwZX0gdm9uICR7dHlwZX0gd2lya2xpY2ggbFx1MDBGNnNjaGVuP2AsXHJcbiAgICAgICAgYCR7a2V5cy5sZW5ndGggPT09IDEgPyBcIkRpZSBQcm9wZXJ0eVwiIDogYERpZSAke2tleXMubGVuZ3RofSBQcm9wZXJ0aWVzYH0gJHtrZXlzLmpvaW4oXCIsIFwiKX0gJHtrZXlzLmxlbmd0aCA9PT0gMSA/IFwiZ2VodFwiIDogXCJnZWhlblwifSBkYWJlaSB2ZXJsb3Jlbi5gLFxyXG4gICAgICBdLFxyXG4gICAgICBjb25maXJtVGV4dDogXCJMXHUwMEY2c2NoZW5cIixcclxuICAgICAgY29uZmlybUNsczogXCJtb2Qtd2FybmluZ1wiLFxyXG4gICAgICBvbkNvbmZpcm06IGFwcGx5LFxyXG4gICAgfSkub3BlbigpO1xyXG4gIH1cclxuXHJcbiAgLy8gV2llIHN0YXJ0RGV0YWlsUmVuYW1lKCksIGFiZXIgYXVmIGRlbSBUaXRlbCBlaW5lcyBTdWJ0eXAtQmxvY2tzLiBEZXIgQmxvY2tcclxuICAvLyBiZWhcdTAwRTRsdCBzZWluZSBQb3NpdGlvbjsgdXBkYXRlTm90ZXM6IHRydWUgc2NocmVpYnQgbmFjaCBCZXN0XHUwMEU0dGlndW5nIGF1Y2ggZGVuXHJcbiAgLy8gU1VCVFlQIGRlciBiZXRyb2ZmZW5lbiBOb3RpemVuIHVtLiBFaW4gYmVyZWl0cyB2b3JoYW5kZW5lciBOYW1lIGJpZXRldFxyXG4gIC8vIHN0YXR0ZGVzc2VuIGRhcyBadXNhbW1lbmxlZ2VuIGFuIChzY2hyZWlidCBkaWUgTm90aXplbiBpbW1lciBtaXQgdW0pLlxyXG4gIHN0YXJ0U3VidHlwZVJlbmFtZSh0eXBlLCBzdWJ0eXBlLCB0aXRsZUVsLCB7IHVwZGF0ZU5vdGVzID0gZmFsc2UgfSA9IHt9KSB7XHJcbiAgICBpZiAodGhpcy5pc0VkaXRpbmcpIHJldHVybjtcclxuICAgIHRoaXMuaXNFZGl0aW5nID0gdHJ1ZTtcclxuXHJcbiAgICB0aXRsZUVsLmFkZENsYXNzKFwiZnJlZC10eXAtc3VidHlwZS1uYW1lLWlucHV0XCIsIFwiaXMtYmVpbmctcmVuYW1lZFwiKTtcclxuICAgIHRpdGxlRWwuc2V0QXR0cmlidXRlKFwiY29udGVudGVkaXRhYmxlXCIsIFwidHJ1ZVwiKTtcclxuICAgIHRpdGxlRWwuc2V0QXR0cmlidXRlKFwic3BlbGxjaGVja1wiLCBcImZhbHNlXCIpO1xyXG4gICAgdGl0bGVFbC5mb2N1cygpO1xyXG5cclxuICAgIGNvbnN0IHJhbmdlID0gdGl0bGVFbC5kb2MuY3JlYXRlUmFuZ2UoKTtcclxuICAgIHJhbmdlLnNlbGVjdE5vZGVDb250ZW50cyh0aXRsZUVsKTtcclxuICAgIGNvbnN0IHNlbGVjdGlvbiA9IHRpdGxlRWwud2luLmdldFNlbGVjdGlvbigpO1xyXG4gICAgc2VsZWN0aW9uLnJlbW92ZUFsbFJhbmdlcygpO1xyXG4gICAgc2VsZWN0aW9uLmFkZFJhbmdlKHJhbmdlKTtcclxuXHJcbiAgICBjb25zdCBjb3VudE9mID0gKG5hbWUpID0+IHRoaXMucGx1Z2luLnR5cEluZGV4LnN1YnR5cGVCdWNrZXQodHlwZSkuY291bnRzLmdldChuYW1lKSA/PyAwO1xyXG4gICAgY29uc3QgYXBwbHlSZW5hbWUgPSBhc3luYyAodmFsdWUsIHsgd2l0aE5vdGVzIH0pID0+IHtcclxuICAgICAgcmVuYW1lU3VidHlwZSh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSwgdmFsdWUpO1xyXG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgY29uc3QgcmVuYW1lZCA9IHdpdGhOb3RlcyA/IGF3YWl0IHJlbmFtZVN1YnR5cGVJbk5vdGVzKHRoaXMucGx1Z2luLCB0eXBlLCBzdWJ0eXBlLCB2YWx1ZSkgOiAwO1xyXG4gICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgICAgaWYgKHdpdGhOb3RlcykgbmV3IE5vdGljZShgU1VCVFlQICR7dmFsdWV9OiAke3JlbmFtZWR9IE5vdGl6KGVuKSBhbmdlcGFzc3QuYCk7XHJcbiAgICAgIHRoaXMucmVuZGVyKCk7XHJcbiAgICB9O1xyXG5cclxuICAgIGxldCBkb25lID0gZmFsc2U7XHJcbiAgICBjb25zdCBmaW5pc2ggPSBhc3luYyAoY29tbWl0KSA9PiB7XHJcbiAgICAgIGlmIChkb25lKSByZXR1cm47XHJcbiAgICAgIGRvbmUgPSB0cnVlO1xyXG4gICAgICB0aGlzLmlzRWRpdGluZyA9IGZhbHNlO1xyXG5cclxuICAgICAgY29uc3QgdmFsdWUgPSBub3JtYWxpemVTdWJ0eXBlTmFtZSh0aXRsZUVsLnRleHRDb250ZW50KTtcclxuICAgICAgaWYgKCFjb21taXQgfHwgIXZhbHVlIHx8IHZhbHVlID09PSBzdWJ0eXBlKSB7XHJcbiAgICAgICAgdGhpcy5yZW5kZXIoKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gZ2V0U3VidHlwZU5hbWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlKS5maW5kKFxyXG4gICAgICAgIChuYW1lKSA9PiBuYW1lLnRvTG93ZXJDYXNlKCkgPT09IHZhbHVlLnRvTG93ZXJDYXNlKCkgJiYgbmFtZSAhPT0gc3VidHlwZVxyXG4gICAgICApO1xyXG4gICAgICBpZiAoZXhpc3RpbmcpIHtcclxuICAgICAgICBuZXcgQ29uZmlybVN1YnR5cGVNb2RhbCh0aGlzLmFwcCwge1xyXG4gICAgICAgICAgcGFyYWdyYXBoczogW1xyXG4gICAgICAgICAgICBgU3VidHlwICR7ZXhpc3Rpbmd9IGV4aXN0aWVydCBiZWkgJHt0eXBlfSBiZXJlaXRzLiAke3N1YnR5cGV9IGRhbWl0IHp1c2FtbWVubGVnZW4/YCxcclxuICAgICAgICAgICAgYCR7Y291bnRPZihzdWJ0eXBlKX0gTm90aXooZW4pIHdlcmRlbiBhdWYgJHtleGlzdGluZ30gdW1nZXN0ZWxsdCwgZGllIFByb3BlcnRpZXMgdm9uICR7c3VidHlwZX0gd2FuZGVybiBpbiBkZW4gQmxvY2sgJHtleGlzdGluZ30uYCxcclxuICAgICAgICAgIF0sXHJcbiAgICAgICAgICBjb25maXJtVGV4dDogXCJadXNhbW1lbmxlZ2VuXCIsXHJcbiAgICAgICAgICBjb25maXJtQ2xzOiBcIm1vZC13YXJuaW5nXCIsXHJcbiAgICAgICAgICBvbkNvbmZpcm06IGFzeW5jICgpID0+IHtcclxuICAgICAgICAgICAgbWVyZ2VTdWJ0eXBlcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSwgZXhpc3RpbmcpO1xyXG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgICAgY29uc3QgcmVuYW1lZCA9IGF3YWl0IHJlbmFtZVN1YnR5cGVJbk5vdGVzKHRoaXMucGx1Z2luLCB0eXBlLCBzdWJ0eXBlLCBleGlzdGluZyk7XHJcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgICAgICAgICBuZXcgTm90aWNlKGBTdWJ0eXAgJHtzdWJ0eXBlfSBtaXQgJHtleGlzdGluZ30genVzYW1tZW5nZWxlZ3QsICR7cmVuYW1lZH0gTm90aXooZW4pIGFuZ2VwYXNzdC5gKTtcclxuICAgICAgICAgICAgdGhpcy5yZW5kZXIoKTtcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICBvbkNhbmNlbDogKCkgPT4gdGhpcy5yZW5kZXIoKSxcclxuICAgICAgICB9KS5vcGVuKCk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAoIXVwZGF0ZU5vdGVzKSB7XHJcbiAgICAgICAgYXdhaXQgYXBwbHlSZW5hbWUodmFsdWUsIHsgd2l0aE5vdGVzOiBmYWxzZSB9KTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgICAgbmV3IENvbmZpcm1TdWJ0eXBlTW9kYWwodGhpcy5hcHAsIHtcclxuICAgICAgICBwYXJhZ3JhcGhzOiBbYFN1YnR5cCAke3N1YnR5cGV9IGluICR7dmFsdWV9IHVtYmVuZW5uZW4gdW5kICR7Y291bnRPZihzdWJ0eXBlKX0gTm90aXooZW4pIGVudHNwcmVjaGVuZCBhbnBhc3Nlbj9gXSxcclxuICAgICAgICBjb25maXJtVGV4dDogXCJVbWJlbmVubmVuXCIsXHJcbiAgICAgICAgY29uZmlybUNsczogXCJtb2QtY3RhXCIsXHJcbiAgICAgICAgb25Db25maXJtOiAoKSA9PiBhcHBseVJlbmFtZSh2YWx1ZSwgeyB3aXRoTm90ZXM6IHRydWUgfSksXHJcbiAgICAgICAgb25DYW5jZWw6ICgpID0+IHRoaXMucmVuZGVyKCksXHJcbiAgICAgIH0pLm9wZW4oKTtcclxuICAgIH07XHJcblxyXG4gICAgLy8gQWxsZSBUYXN0ZW4gaGllciBiZWhhbHRlbjogZGVyIFRpdGVsIHN0ZWh0IGluIGRlciBMaXN0ZSB2b24gT2JzaWRpYW5zXHJcbiAgICAvLyBQcm9wZXJ0eS1FZGl0b3IsIGRlc3NlbiBlaWdlbmUgVGFzdGF0dXItTmF2aWdhdGlvbiBzb25zdCBtaXRyZWFnaWVydGVcclxuICAgIC8vIChFc2NhcGUgenVzXHUwMEU0dHpsaWNoIHdlZ2VuIGRlciBEZXRhaWxhbnNpY2h0LCBzaWVoZSBvbk9wZW4pLlxyXG4gICAgdGl0bGVFbC5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCAoZXZlbnQpID0+IHtcclxuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRW50ZXJcIikge1xyXG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgZmluaXNoKHRydWUpO1xyXG4gICAgICB9IGVsc2UgaWYgKGV2ZW50LmtleSA9PT0gXCJFc2NhcGVcIikge1xyXG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgZmluaXNoKGZhbHNlKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICB0aXRsZUVsLmFkZEV2ZW50TGlzdGVuZXIoXCJibHVyXCIsICgpID0+IGZpbmlzaCh0cnVlKSk7XHJcbiAgfVxyXG5cclxuICAvLyBXaWUgZGllIHVucmVnaXN0cmllcnRlbiBFaW50clx1MDBFNGdlIGRlciBUWVAtTGlzdGU6IFNVQlRZUC1XZXJ0ZSB2b24gTm90aXplblxyXG4gIC8vIGRpZXNlcyBUWVBzLCBkaWUgKG5vY2gpIGtlaW5lbiBlaWdlbmVuIEJsb2NrIGhhYmVuIChOb3RpemVuIGdhbnogb2huZVxyXG4gIC8vIFNVQlRZUCB6XHUwMEU0aGx0IHN0YXR0ZGVzc2VuIGRhcyBUWVAtRnJvbnRtYXR0ZXIpLiBEYXJnZXN0ZWxsdCB3aWUgZGllXHJcbiAgLy8gU3VidHlwLUJsXHUwMEY2Y2tlLCBhYmVyIG51ciBtaXQgKGF1c2dlZ3JhdXRlcikgXHUwMERDYmVyc2NocmlmdCBzYW10IEFuemFobC5cclxuICAvLyBMaW5rc2tsaWNrIFx1MDBGQ2Jlcm5pbW10IGVpbmVuIFdlcnQgYWxzIFN1YnR5cCwgUmVjaHRza2xpY2sgXHUwMEY2ZmZuZXQgZGllIFN1Y2hlLlxyXG4gIHJlbmRlclVucmVnaXN0ZXJlZFN1YnR5cGVzKHBhcmVudCwgdHlwZSwgYnVja2V0KSB7XHJcbiAgICBjb25zdCByZWdpc3RlcmVkID0gZ2V0U3VidHlwZU5hbWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlKTtcclxuICAgIGNvbnN0IHVucmVnaXN0ZXJlZCA9IFsuLi5idWNrZXQuY291bnRzLmtleXMoKV1cclxuICAgICAgLmZpbHRlcigoa2V5KSA9PiAhcmVnaXN0ZXJlZC5pbmNsdWRlcyhrZXkpKVxyXG4gICAgICAuc29ydCgoYSwgYikgPT4gYnVja2V0LmNvdW50cy5nZXQoYikgLSBidWNrZXQuY291bnRzLmdldChhKSB8fCBhLmxvY2FsZUNvbXBhcmUoYikpO1xyXG4gICAgaWYgKHVucmVnaXN0ZXJlZC5sZW5ndGggPT09IDApIHJldHVybjtcclxuXHJcbiAgICBjb25zdCBsaXN0RWwgPSBwYXJlbnQuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLXN1YnR5cGUtdW5yZWdpc3RlcmVkLWxpc3RcIiB9KTtcclxuICAgIGZvciAoY29uc3Qga2V5IG9mIHVucmVnaXN0ZXJlZCkge1xyXG4gICAgICBjb25zdCBibG9jayA9IGxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItYmxvY2sgZnJlZC10eXAtc3VidHlwZS1ibG9jayBmcmVkLXR5cC1zdWJ0eXBlLXVucmVnaXN0ZXJlZFwiIH0pO1xyXG4gICAgICBjb25zdCBoZWFkZXIgPSBibG9jay5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItaGVhZGVyXCIgfSk7XHJcbiAgICAgIGNvbnN0IHRpdGxlR3JvdXAgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLXRpdGxlLWdyb3VwXCIgfSk7XHJcbiAgICAgIHRpdGxlR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIsIHRleHQ6IGRpc3BsYXlUeXBlS2V5KGtleSkgfSk7XHJcbiAgICAgIHRpdGxlR3JvdXAuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1zdWJ0eXBlLWNvdW50XCIsIHRleHQ6IFN0cmluZyhidWNrZXQuY291bnRzLmdldChrZXkpKSB9KTtcclxuICAgICAgYmxvY2suYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMucmVnaXN0ZXJTdWJ0eXBlKHR5cGUsIGtleSwgYnVja2V0KSk7XHJcbiAgICAgIGJsb2NrLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcclxuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgICAgIHRoaXMub3BlblN1YnR5cGVTZWFyY2godHlwZSwga2V5KTtcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvLyBzdWJ0eXBlS2V5ID09PSBudWxsIFx1MjE5MiBOb3RpemVuIGRpZXNlcyBUWVBzIG9obmUgU1VCVFlQLiBGXHUwMEZDciBlaW5lIExpc3RlXHJcbiAgLy8gZ2lidCBlcyB3aWUgYmVpIG9wZW5TZWFyY2goKSBrZWluZSBleGFrdGUgU3VjaHN5bnRheCAtIGRhbm4gbmFjaCBOb3RpemVuXHJcbiAgLy8gc3VjaGVuLCBkaWUgYWxsZSBpaHJlIEVpbnRyXHUwMEU0Z2UgdHJhZ2VuLlxyXG4gIG9wZW5TdWJ0eXBlU2VhcmNoKHR5cGUsIHN1YnR5cGVLZXkpIHtcclxuICAgIGNvbnN0IGdsb2JhbFNlYXJjaCA9IHRoaXMucGx1Z2luLmFwcC5pbnRlcm5hbFBsdWdpbnMuZ2V0UGx1Z2luQnlJZChcImdsb2JhbC1zZWFyY2hcIik7XHJcbiAgICBpZiAoIWdsb2JhbFNlYXJjaCkgcmV0dXJuO1xyXG4gICAgY29uc3QgdHlwQ2xhdXNlID0gdGhpcy50eXBlQ2xhdXNlKHR5cGUpO1xyXG4gICAgbGV0IHN1YnR5cENsYXVzZTtcclxuICAgIGlmIChzdWJ0eXBlS2V5ID09PSBudWxsKSB7XHJcbiAgICAgIHN1YnR5cENsYXVzZSA9IGAtW1wiJHtTVUJUWVBfUFJPUEVSVFl9XCJdYDtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGNvbnN0IHJhdyA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnN1YnR5cGVCdWNrZXQodHlwZSkucmF3QnlLZXkuZ2V0KHN1YnR5cGVLZXkpO1xyXG4gICAgICBzdWJ0eXBDbGF1c2UgPSBBcnJheS5pc0FycmF5KHJhdylcclxuICAgICAgICA/IHJhdy5tYXAoKHYpID0+IGBbXCIke1NVQlRZUF9QUk9QRVJUWX1cIjpcIiR7U3RyaW5nKHYgPz8gXCJcIikudHJpbSgpfVwiXWApLmpvaW4oXCIgXCIpXHJcbiAgICAgICAgOiBgW1wiJHtTVUJUWVBfUFJPUEVSVFl9XCI6XCIke3N1YnR5cGVLZXl9XCJdYDtcclxuICAgIH1cclxuICAgIGdsb2JhbFNlYXJjaC5pbnN0YW5jZS5vcGVuR2xvYmFsU2VhcmNoKGAke3R5cENsYXVzZX0gJHtzdWJ0eXBDbGF1c2V9YCk7XHJcbiAgfVxyXG5cclxuICAvLyBXaWUgcmVnaXN0ZXJUeXBlKCk6IFx1MDBGQ2Jlcm5pbW10IGRpZSBiZXJlaW5pZ3RlIEZvcm0gKEdyb1x1MDBERmJ1Y2hzdGFiZW4sIExpc3RlXHJcbiAgLy8gYWxzIEVpbnplbHdlcnQgXCJBLCBCXCIpIGFscyBTdWJ0eXAgZGllc2VzIFRZUHMgdW5kIHNjaHJlaWJ0IGRlbiBTVUJUWVAgZGVyXHJcbiAgLy8gYmV0cm9mZmVuZW4gTm90aXplbiBnbGVpY2ggbWl0IHVtLiBHaWJ0IGVzIGRlbiBTdWJ0eXAgaW4gYW5kZXJlciBTY2hyZWliLVxyXG4gIC8vIHdlaXNlIHNjaG9uLCBsYW5kZW4gZGllIE5vdGl6ZW4gZG9ydC5cclxuICBhc3luYyByZWdpc3RlclN1YnR5cGUodHlwZSwgc3VidHlwZUtleSwgYnVja2V0KSB7XHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmFwcGx5U3VidHlwZVJlZ2lzdHJhdGlvbih0eXBlLCBzdWJ0eXBlS2V5LCBidWNrZXQpO1xyXG4gICAgaWYgKCFyZXN1bHQpIHJldHVybjtcclxuXHJcbiAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgaWYgKHJlc3VsdC5yZW5hbWVkID4gMCkgbmV3IE5vdGljZShgU1VCVFlQICR7cmVzdWx0LnN1YnR5cGV9IHJlZ2lzdHJpZXJ0LCAke3Jlc3VsdC5yZW5hbWVkfSBOb3RpeihlbikgYW5nZXBhc3N0LmApO1xyXG4gIH1cclxuXHJcbiAgLy8gV2llIGFwcGx5VHlwZVJlZ2lzdHJhdGlvbiBmXHUwMEZDciBkZW4gVFlQOiBkZXIgVm9yZ2FuZyBvaG5lIFNwZWljaGVybiB1bmRcclxuICAvLyBOb3RpY2UsIGRhbWl0IHJlZ2lzdGVyVHlwZVdpdGhTdWJ0eXBlKCkgaWhuIG1pdCBkZXIgVFlQLUVyZmFzc3VuZyBiXHUwMEZDbmRlbG5cclxuICAvLyBrYW5uLiBMaWVmZXJ0IHsgc3VidHlwZSwgcmVuYW1lZCB9IG9kZXIgbnVsbC5cclxuICBhc3luYyBhcHBseVN1YnR5cGVSZWdpc3RyYXRpb24odHlwZSwgc3VidHlwZUtleSwgYnVja2V0KSB7XHJcbiAgICBjb25zdCByYXcgPSBidWNrZXQucmF3QnlLZXkuZ2V0KHN1YnR5cGVLZXkpO1xyXG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVJhd1R5cGUocmF3ID09PSB1bmRlZmluZWQgPyBzdWJ0eXBlS2V5IDogcmF3LCBub3JtYWxpemVTdWJ0eXBlTmFtZSk7XHJcbiAgICBpZiAoIW5vcm1hbGl6ZWQpIHJldHVybiBudWxsO1xyXG4gICAgY29uc3QgZXhpc3RpbmcgPSBnZXRTdWJ0eXBlTmFtZXModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUpLmZpbmQoKG5hbWUpID0+IG5hbWUudG9Mb3dlckNhc2UoKSA9PT0gbm9ybWFsaXplZC50b0xvd2VyQ2FzZSgpKTtcclxuICAgIGNvbnN0IHN1YnR5cGUgPSBleGlzdGluZyA/PyBub3JtYWxpemVkO1xyXG4gICAgZW5zdXJlU3VidHlwZSh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSk7XHJcblxyXG4gICAgY29uc3QgcmVuYW1lZCA9IHN1YnR5cGUgIT09IHN1YnR5cGVLZXkgPyBhd2FpdCByZW5hbWVTdWJ0eXBlSW5Ob3Rlcyh0aGlzLnBsdWdpbiwgdHlwZSwgc3VidHlwZUtleSwgc3VidHlwZSkgOiAwO1xyXG4gICAgcmV0dXJuIHsgc3VidHlwZSwgcmVuYW1lZCB9O1xyXG4gIH1cclxuXHJcbiAgLy8gTmV1ZXIsIGxlZXJlciBTdWJ0eXAtQmxvY2sgZGlyZWt0IFx1MDBGQ2JlciBkZW0gXCJTdWJ0eXAgaGluenVmXHUwMEZDZ2VuXCItQnV0dG9uLFxyXG4gIC8vIGRlc3NlbiBOYW1lIHNvZm9ydCBpbmxpbmUgZWluZ2VnZWJlbiB3aXJkICh3aWUgc3RhcnRBZGQoKSBpbiBkZXIgTGlzdGUpLlxyXG4gIHN0YXJ0QWRkU3VidHlwZSh0eXBlKSB7XHJcbiAgICBpZiAodGhpcy5pc0VkaXRpbmcgfHwgIXRoaXMuc3VidHlwZUFkZEJ0bkVsKSByZXR1cm47XHJcbiAgICB0aGlzLmlzRWRpdGluZyA9IHRydWU7XHJcblxyXG4gICAgLy8gQXVmZ2ViYXV0IHdpZSBkZXIgZmVydGlnZSAobGVlcmUpIEJsb2NrIGltIGdlbWVpbnNhbWVuIEVkaXRvciAtIHNhbXQgZGVuXHJcbiAgICAvLyBcIitcIi1CdXR0b25zIHVuZCBkZW4gQWt0aW9uZW4gaW0gQWJzY2hsdXNzLCBkaWUgaGllciBub2NoIG5pY2h0cyB0dW4sIG51clxyXG4gICAgLy8gbm9jaCBvaG5lIEFuemFobCAtLCBkYW1pdCBiZWltIEFic2NobGllXHUwMERGZW4gZGVyIEVpbmdhYmUgbmljaHRzIHNwcmluZ3RcclxuICAgIC8vIChzaWVoZSAuZnJlZC10eXAtc3VidHlwZS1wZW5kaW5nKS5cclxuICAgIGNvbnN0IGJsb2NrID0gY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLWJsb2NrIGZyZWQtdHlwLXN1YnR5cGUtYmxvY2sgZnJlZC10eXAtc3VidHlwZS1wZW5kaW5nXCIgfSk7XHJcbiAgICB0aGlzLnN1YnR5cGVBZGRCdG5FbC5wYXJlbnRFbGVtZW50Lmluc2VydEJlZm9yZShibG9jaywgdGhpcy5zdWJ0eXBlQWRkQnRuRWwpO1xyXG4gICAgY29uc3QgaGVhZGVyID0gYmxvY2suY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLWhlYWRlclwiIH0pO1xyXG4gICAgY29uc3QgdGl0bGVHcm91cCA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItdGl0bGUtZ3JvdXBcIiB9KTtcclxuICAgIGNvbnN0IG5hbWVFbCA9IHRpdGxlR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlIGZyZWQtdHlwLXN1YnR5cGUtbmFtZS1pbnB1dCBpcy1iZWluZy1yZW5hbWVkXCIgfSk7XHJcbiAgICBjb25zdCBhZGRCdXR0b25zID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1mcm9udG1hdHRlci1hZGQtZ3JvdXBcIiB9KTtcclxuICAgIHNldEljb24oYWRkQnV0dG9ucy5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gZnJlZC10eXAtZnJvbnRtYXR0ZXItYWRkLWZsb2F0aW5nXCIgfSksIFwicGx1c1wiKTtcclxuICAgIHNldEljb24oYWRkQnV0dG9ucy5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gZnJlZC10eXAtZnJvbnRtYXR0ZXItYWRkXCIgfSksIFwicGx1c1wiKTtcclxuICAgIGNvbnN0IGZvb3RlciA9IGJsb2NrLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1zZWN0aW9uLWZvb3RlciBmcmVkLXR5cC1zdWJ0eXBlLWFjdGlvbnNcIiB9KTtcclxuICAgIGNvbnN0IGNvbG9yR3JvdXAgPSBmb290ZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLXN1YnR5cGUtY29sb3ItZ3JvdXBcIiB9KTtcclxuICAgIHBhaW50Q29sb3JEb3QoY29sb3JHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtc3VidHlwZS1jb2xvci1kb3RcIiB9KSwgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXSA/PyBERUZBVUxUX1RZUEVfQ09MT1IsIHRydWUpO1xyXG4gICAgc2V0SWNvbihjb2xvckdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1jb2xvci1yZXNldCBpcy1kaXNhYmxlZFwiIH0pLCBcInJvdGF0ZS1jY3dcIik7XHJcbiAgICBjb25zdCBhY3Rpb25zID0gZm9vdGVyLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1zdWJ0eXBlLWFjdGlvbi1ncm91cFwiIH0pO1xyXG4gICAgc2V0SWNvbihhY3Rpb25zLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1kZXRhaWwtcmVuYW1lLW5vdGVzXCIgfSksIFwicGVuY2lsXCIpO1xyXG4gICAgc2V0SWNvbihhY3Rpb25zLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1kZXRhaWwtcmVuYW1lXCIgfSksIFwicGVuY2lsXCIpO1xyXG4gICAgc2V0SWNvbihhY3Rpb25zLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1kZXRhaWwtZGVsZXRlXCIgfSksIFwidHJhc2hcIik7XHJcbiAgICBuYW1lRWwuc2V0QXR0cmlidXRlKFwiY29udGVudGVkaXRhYmxlXCIsIFwidHJ1ZVwiKTtcclxuICAgIG5hbWVFbC5zZXRBdHRyaWJ1dGUoXCJzcGVsbGNoZWNrXCIsIFwiZmFsc2VcIik7XHJcbiAgICBuYW1lRWwuZm9jdXMoKTtcclxuXHJcbiAgICBsZXQgZG9uZSA9IGZhbHNlO1xyXG4gICAgY29uc3QgZmluaXNoID0gYXN5bmMgKGNvbW1pdCkgPT4ge1xyXG4gICAgICBpZiAoZG9uZSkgcmV0dXJuO1xyXG4gICAgICBkb25lID0gdHJ1ZTtcclxuICAgICAgdGhpcy5pc0VkaXRpbmcgPSBmYWxzZTtcclxuXHJcbiAgICAgIGNvbnN0IHZhbHVlID0gbm9ybWFsaXplU3VidHlwZU5hbWUobmFtZUVsLnRleHRDb250ZW50KTtcclxuICAgICAgaWYgKGNvbW1pdCAmJiB2YWx1ZSkge1xyXG4gICAgICAgIGNvbnN0IGV4aXN0aW5nID0gZ2V0U3VidHlwZU5hbWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlKS5maW5kKChuYW1lKSA9PiBuYW1lLnRvTG93ZXJDYXNlKCkgPT09IHZhbHVlLnRvTG93ZXJDYXNlKCkpO1xyXG4gICAgICAgIGlmIChleGlzdGluZykge1xyXG4gICAgICAgICAgbmV3IE5vdGljZShgU3VidHlwICR7ZXhpc3Rpbmd9IGdpYnQgZXMgYmVpICR7dHlwZX0gYmVyZWl0cy5gKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgZW5zdXJlU3VidHlwZSh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgdmFsdWUpO1xyXG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIHRoaXMucmVuZGVyKCk7XHJcbiAgICB9O1xyXG5cclxuICAgIG5hbWVFbC5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCAoZXZlbnQpID0+IHtcclxuICAgICAgaWYgKGV2ZW50LmtleSA9PT0gXCJFbnRlclwiKSB7XHJcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgICBmaW5pc2godHJ1ZSk7XHJcbiAgICAgIH0gZWxzZSBpZiAoZXZlbnQua2V5ID09PSBcIkVzY2FwZVwiKSB7XHJcbiAgICAgICAgLy8gc3RvcFByb3BhZ2F0aW9uLCBzb25zdCB2ZXJsXHUwMEU0c3N0IGRlciBFc2NhcGUtSGFuZGxlciBkZXIgZ2VzYW10ZW5cclxuICAgICAgICAvLyBEZXRhaWxhbnNpY2h0IHNpZSBnbGVpY2ggbWl0LlxyXG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgZmluaXNoKGZhbHNlKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICBuYW1lRWwuYWRkRXZlbnRMaXN0ZW5lcihcImJsdXJcIiwgKCkgPT4gZmluaXNoKHRydWUpKTtcclxuICB9XHJcblxyXG4gIHNob3dEZWxldGVDb25maXJtKHR5cGUpIHtcclxuICAgIG5ldyBDb25maXJtRGVsZXRlVHlwZU1vZGFsKHRoaXMucGx1Z2luLCB0eXBlLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVzID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXMuZmlsdGVyKCh0KSA9PiB0ICE9PSB0eXBlKTtcclxuICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV07XHJcbiAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3R5cGVdO1xyXG4gICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXTtcclxuICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV07XHJcbiAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlU2hvcnRjdXRzW3R5cGVdO1xyXG4gICAgICBkZWxldGUgdGhpcy5lbnN1cmVUeXBlTWFudWFsKClbdHlwZV07XHJcbiAgICAgIGRlbGV0ZVR5cGVTdWJ0eXBlcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSk7XHJcbiAgICAgIC8vIFZvciByZWZyZXNoVHlwQ29sb3JzKCkgenVyXHUwMEZDY2sgenVyIExpc3RlLCBhdXMgZGVtc2VsYmVuIEdydW5kIHdpZSBiZWltXHJcbiAgICAgIC8vIFVtYmVuZW5uZW46IHJlZnJlc2hUeXBDb2xvcnMoKSByZW5kZXJ0ICh1LiBhLiBcdTAwRkNiZXIgcmVnaXN0ZXJUeXBWaWV3KVxyXG4gICAgICAvLyBzeW5jaHJvbiBuZXUgLSBzdFx1MDBGQ25kZSBzZWxlY3RlZFR5cGUgbm9jaCBhdWYgZGVtIGdlcmFkZSBnZWxcdTAwRjZzY2h0ZW5cclxuICAgICAgLy8gVHlwLCB3XHUwMEZDcmRlIGRlc3NlbiBqZXR6dCBkYXRlbmxvc2UgRGV0YWlsYW5zaWNodCBrdXJ6IGVybmV1dCBnZXJlbmRlcnQuXHJcbiAgICAgIHRoaXMuY2xvc2VUeXBlU2V0dGluZ3MoKTtcclxuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgfSkub3BlbigpO1xyXG4gIH1cclxuXHJcbiAgLy8gV2llIHN0YXJ0RWRpdGluZygpLCBhYmVyIGF1ZiBkZW0gZnJlaXN0ZWhlbmRlbiBUaXRlbC1FbGVtZW50IGRlciBEZXRhaWwtQW5zaWNodFxyXG4gIC8vIHN0YXR0IGF1ZiBlaW5lbSBUcmVlLUl0ZW0gLSB1bmQgbWl0IHJlc3VsdGllcmVuZGVtIHNlbGVjdGVkVHlwZS1XZWNoc2VsIHN0YXR0XHJcbiAgLy8gZWluZXMgc2NobGljaHRlbiBSZS1SZW5kZXJzIGRlciBMaXN0ZS4gdXBkYXRlTm90ZXM6IHRydWUgKHp3ZWl0ZXIsIGhlcnZvci1cclxuICAvLyBnZWhvYmVuZXIgQnV0dG9uKSBzY2hyZWlidCBuYWNoIEJlc3RcdTAwRTR0aWd1bmcgenVzXHUwMEU0dHpsaWNoIGRlbiBUWVAtV2VydCBhbGxlclxyXG4gIC8vIGJldHJvZmZlbmVuIE5vdGl6ZW4gdW0gKHNpZWhlIHJlbmFtZVR5cGVJbk5vdGVzKSwgc3RhdHQgbnVyIGRpZSBQbHVnaW4tXHJcbiAgLy8gRWluc3RlbGx1bmdlbiB6dSBtaWdyaWVyZW4uXHJcbiAgc3RhcnREZXRhaWxSZW5hbWUodHlwZSwgdGl0bGVFbCwgeyB1cGRhdGVOb3RlcyA9IGZhbHNlIH0gPSB7fSkge1xyXG4gICAgaWYgKHRoaXMuaXNFZGl0aW5nKSByZXR1cm47XHJcbiAgICB0aGlzLmlzRWRpdGluZyA9IHRydWU7XHJcblxyXG4gICAgdGl0bGVFbC5hZGRDbGFzcyhcImlzLWJlaW5nLXJlbmFtZWRcIik7XHJcbiAgICB0aXRsZUVsLnNldEF0dHJpYnV0ZShcImNvbnRlbnRlZGl0YWJsZVwiLCBcInRydWVcIik7XHJcbiAgICB0aXRsZUVsLnNldEF0dHJpYnV0ZShcInNwZWxsY2hlY2tcIiwgXCJmYWxzZVwiKTtcclxuICAgIHRpdGxlRWwuZm9jdXMoKTtcclxuXHJcbiAgICBjb25zdCByYW5nZSA9IHRpdGxlRWwuZG9jLmNyZWF0ZVJhbmdlKCk7XHJcbiAgICByYW5nZS5zZWxlY3ROb2RlQ29udGVudHModGl0bGVFbCk7XHJcbiAgICBjb25zdCBzZWxlY3Rpb24gPSB0aXRsZUVsLndpbi5nZXRTZWxlY3Rpb24oKTtcclxuICAgIHNlbGVjdGlvbi5yZW1vdmVBbGxSYW5nZXMoKTtcclxuICAgIHNlbGVjdGlvbi5hZGRSYW5nZShyYW5nZSk7XHJcblxyXG4gICAgLy8gTWlncmllcnQgbnVyIGRpZSBQbHVnaW4tRWluc3RlbGx1bmdlbiAoTGlzdGUsIEZhcmJlLCBCZXNjaHJlaWJ1bmcsXHJcbiAgICAvLyBUWVAtRnJvbnRtYXR0ZXIsIE1hbnVlbGxlci1UWVAtU2NoYWx0ZXIpIGF1ZiBkZW4gbmV1ZW4gTmFtZW4gLVxyXG4gICAgLy8gclx1MDBGQ2hydCBrZWluZSBOb3RpemVuIGFuLiBHZW1laW5zYW0gZ2VudXR6dCB2b24gYmVpZGVuIFVtYmVuZW5uZW4tUGZhZGVuLlxyXG4gICAgY29uc3QgYXBwbHlSZW5hbWUgPSBhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgY29uc3QgaWR4ID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXMuaW5kZXhPZih0eXBlKTtcclxuICAgICAgaWYgKGlkeCAhPT0gLTEpIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVzW2lkeF0gPSB2YWx1ZTtcclxuICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXTtcclxuICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXTtcclxuICAgICAgfVxyXG4gICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3R5cGVdO1xyXG4gICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3R5cGVdO1xyXG4gICAgICB9XHJcbiAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV07XHJcbiAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV07XHJcbiAgICAgIH1cclxuICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXTtcclxuICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXTtcclxuICAgICAgfVxyXG4gICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZVNob3J0Y3V0c1t0eXBlXSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZVNob3J0Y3V0c1t2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlU2hvcnRjdXRzW3R5cGVdO1xyXG4gICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlU2hvcnRjdXRzW3R5cGVdO1xyXG4gICAgICB9XHJcbiAgICAgIGlmICh0aGlzLmVuc3VyZVR5cGVNYW51YWwoKVt0eXBlXSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZU1hbnVhbFt2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlTWFudWFsW3R5cGVdO1xyXG4gICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlTWFudWFsW3R5cGVdO1xyXG4gICAgICB9XHJcbiAgICAgIG1vdmVUeXBlU3VidHlwZXModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUsIHZhbHVlKTtcclxuICAgICAgLy8gVm9yIHJlZnJlc2hUeXBDb2xvcnMoKSBzZXR6ZW46IGRhcyBydWZ0ICh1LiBhLiBcdTAwRkNiZXIgZGVuIGluXHJcbiAgICAgIC8vIHJlZ2lzdGVyVHlwVmlldyB6dXJcdTAwRkNja2dlZ2ViZW5lbiBSZWZyZXNoKSBzeW5jaHJvbiByZW5kZXIoKSBhdWYgLVxyXG4gICAgICAvLyBzdFx1MDBGQ25kZSBzZWxlY3RlZFR5cGUgbm9jaCBhdWYgZGVtIGFsdGVuIChiZXJlaXRzIG1pZ3JpZXJ0ZW4sXHJcbiAgICAgIC8vIGRhaGVyIGpldHp0IGRhdGVuLWxvc2VuKSBOYW1lbiwgd1x1MDBGQ3JkZSBrdXJ6emVpdGlnIGdlbmF1IGRlciBBbHQtXHJcbiAgICAgIC8vIE5hbWUgbWl0IGxlZXJlbiBEYXRlbiBnZXJlbmRlcnQuXHJcbiAgICAgIHRoaXMuc2VsZWN0ZWRUeXBlID0gdmFsdWU7XHJcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgIH07XHJcblxyXG4gICAgbGV0IGRvbmUgPSBmYWxzZTtcclxuICAgIGNvbnN0IGZpbmlzaCA9IGFzeW5jIChjb21taXQpID0+IHtcclxuICAgICAgaWYgKGRvbmUpIHJldHVybjtcclxuICAgICAgZG9uZSA9IHRydWU7XHJcbiAgICAgIHRoaXMuaXNFZGl0aW5nID0gZmFsc2U7XHJcblxyXG4gICAgICBjb25zdCB2YWx1ZSA9IG5vcm1hbGl6ZVR5cGVOYW1lKHRpdGxlRWwudGV4dENvbnRlbnQpO1xyXG4gICAgICBpZiAoIWNvbW1pdCB8fCAhdmFsdWUgfHwgdmFsdWUgPT09IHR5cGUpIHtcclxuICAgICAgICB0aGlzLnJlbmRlcigpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlcy5maW5kKFxyXG4gICAgICAgICh0KSA9PiB0LnRvTG93ZXJDYXNlKCkgPT09IHZhbHVlLnRvTG93ZXJDYXNlKCkgJiYgdCAhPT0gdHlwZVxyXG4gICAgICApO1xyXG4gICAgICBpZiAoZXhpc3RpbmcpIHtcclxuICAgICAgICB0aGlzLnNob3dNZXJnZUNvbmZpcm0odHlwZSwgZXhpc3RpbmcpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKCF1cGRhdGVOb3Rlcykge1xyXG4gICAgICAgIGF3YWl0IGFwcGx5UmVuYW1lKHZhbHVlKTtcclxuICAgICAgICB0aGlzLnJlbmRlcigpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gQnVsay1TY2hyZWlidm9yZ2FuZyBcdTAwRkNiZXIgcG90ZW56aWVsbCB2aWVsZSBEYXRlaWVuIC0gdm9yaGVyIGJlc3RcdTAwRTR0aWdlblxyXG4gICAgICAvLyBsYXNzZW4sIHN0YXR0IHNvZm9ydCB6dSBzcGVpY2hlcm4uXHJcbiAgICAgIGNvbnN0IHsgY291bnRzIH0gPSB0aGlzLnBsdWdpbi50eXBJbmRleC50eXBlQ291bnRzKCk7XHJcbiAgICAgIG5ldyBDb25maXJtUmVuYW1lVHlwZU1vZGFsKFxyXG4gICAgICAgIHRoaXMucGx1Z2luLFxyXG4gICAgICAgIHR5cGUsXHJcbiAgICAgICAgdmFsdWUsXHJcbiAgICAgICAgY291bnRzLmdldCh0eXBlKSA/PyAwLFxyXG4gICAgICAgIGFzeW5jICgpID0+IHtcclxuICAgICAgICAgIGF3YWl0IGFwcGx5UmVuYW1lKHZhbHVlKTtcclxuICAgICAgICAgIGNvbnN0IHJlbmFtZWQgPSBhd2FpdCByZW5hbWVUeXBlSW5Ob3Rlcyh0aGlzLnBsdWdpbiwgdHlwZSwgdmFsdWUpO1xyXG4gICAgICAgICAgbmV3IE5vdGljZShgVFlQICR7dmFsdWV9OiAke3JlbmFtZWR9IE5vdGl6KGVuKSBhbmdlcGFzc3QuYCk7XHJcbiAgICAgICAgICB0aGlzLnJlbmRlcigpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgKCkgPT4gdGhpcy5yZW5kZXIoKVxyXG4gICAgICApLm9wZW4oKTtcclxuICAgIH07XHJcblxyXG4gICAgdGl0bGVFbC5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCAoZXZlbnQpID0+IHtcclxuICAgICAgaWYgKGV2ZW50LmtleSA9PT0gXCJFbnRlclwiKSB7XHJcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgICBmaW5pc2godHJ1ZSk7XHJcbiAgICAgIH0gZWxzZSBpZiAoZXZlbnQua2V5ID09PSBcIkVzY2FwZVwiKSB7XHJcbiAgICAgICAgLy8gc3RvcFByb3BhZ2F0aW9uLCBzb25zdCBncmVpZnQgenVzXHUwMEU0dHpsaWNoIGRlciBFc2NhcGUtSGFuZGxlciBkZXJcclxuICAgICAgICAvLyBnZXNhbXRlbiBEZXRhaWwtQW5zaWNodCB1bmQgdmVybFx1MDBFNHNzdCBzaWUgZ2xlaWNoIG1pdC5cclxuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgICAgIGZpbmlzaChmYWxzZSk7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIHRpdGxlRWwuYWRkRXZlbnRMaXN0ZW5lcihcImJsdXJcIiwgKCkgPT4gZmluaXNoKHRydWUpKTtcclxuICB9XHJcblxyXG4gIHNob3dNZXJnZUNvbmZpcm0oc291cmNlLCB0YXJnZXQpIHtcclxuICAgIGNvbnN0IHsgY291bnRzIH0gPSB0aGlzLnBsdWdpbi50eXBJbmRleC50eXBlQ291bnRzKCk7XHJcbiAgICBuZXcgQ29uZmlybU1lcmdlVHlwZU1vZGFsKFxyXG4gICAgICB0aGlzLnBsdWdpbixcclxuICAgICAgc291cmNlLFxyXG4gICAgICB0YXJnZXQsXHJcbiAgICAgIGNvdW50cy5nZXQoc291cmNlKSA/PyAwLFxyXG4gICAgICAoKSA9PiB0aGlzLm1lcmdlVHlwZShzb3VyY2UsIHRhcmdldCksXHJcbiAgICAgICgpID0+IHRoaXMucmVuZGVyKClcclxuICAgICkub3BlbigpO1xyXG4gIH1cclxuXHJcbiAgLy8gTGVndCBzb3VyY2UgaW4gdGFyZ2V0IGF1ZjogTm90aXplbiB3ZXJkZW4gYXVmIHRhcmdldCB1bWdlc2NocmllYmVuLFxyXG4gIC8vIHNvdXJjZSB2ZXJzY2h3aW5kZXQgYXVzIGRlciBUWVAtTGlzdGUgc2FtdCBlaWdlbmVyIEVpbnN0ZWxsdW5nZW4gKHRhcmdldFxyXG4gIC8vIGJlaFx1MDBFNGx0IHNlaW5lKS4gRGllIFN1YnR5cGVuIHZvbiBzb3VyY2Ugd2VyZGVuIFx1MDBGQ2Jlcm5vbW1lbiwgZ2xlaWNobmFtaWdlXHJcbiAgLy8gQmxcdTAwRjZja2UgenVzYW1tZW5nZWZcdTAwRkNocnQgKHNpZWhlIG1lcmdlVHlwZVN1YnR5cGVzIGluIHN1YnR5cGVzLmpzKS5cclxuICBhc3luYyBtZXJnZVR5cGUoc291cmNlLCB0YXJnZXQpIHtcclxuICAgIGNvbnN0IHNldHRpbmdzID0gdGhpcy5wbHVnaW4uc2V0dGluZ3M7XHJcbiAgICBjb25zdCByZW5hbWVkID0gYXdhaXQgcmVuYW1lVHlwZUluTm90ZXModGhpcy5wbHVnaW4sIHNvdXJjZSwgdGFyZ2V0KTtcclxuXHJcbiAgICBzZXR0aW5ncy50eXBlcyA9IHNldHRpbmdzLnR5cGVzLmZpbHRlcigodCkgPT4gdCAhPT0gc291cmNlKTtcclxuICAgIGRlbGV0ZSBzZXR0aW5ncy50eXBlQ29sb3JzW3NvdXJjZV07XHJcbiAgICBkZWxldGUgc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1tzb3VyY2VdO1xyXG4gICAgZGVsZXRlIHNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbc291cmNlXTtcclxuICAgIGRlbGV0ZSBzZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3NvdXJjZV07XHJcbiAgICBkZWxldGUgc2V0dGluZ3MudHlwZVNob3J0Y3V0c1tzb3VyY2VdO1xyXG4gICAgZGVsZXRlIHRoaXMuZW5zdXJlVHlwZU1hbnVhbCgpW3NvdXJjZV07XHJcbiAgICBtZXJnZVR5cGVTdWJ0eXBlcyhzZXR0aW5ncywgc291cmNlLCB0YXJnZXQpO1xyXG5cclxuICAgIC8vIFZvciByZWZyZXNoVHlwQ29sb3JzKCkgc2V0emVuLCBhdXMgZGVtc2VsYmVuIEdydW5kIHdpZSBpbiBhcHBseVJlbmFtZS5cclxuICAgIHRoaXMuc2VsZWN0ZWRUeXBlID0gdGFyZ2V0O1xyXG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgIG5ldyBOb3RpY2UoYFRZUCAke3NvdXJjZX0gbWl0ICR7dGFyZ2V0fSB6dXNhbW1lbmdlbGVndCwgJHtyZW5hbWVkfSBOb3RpeihlbikgYW5nZXBhc3N0LmApO1xyXG4gICAgdGhpcy5yZW5kZXIoKTtcclxuICB9XHJcblxyXG4gIHJlbmRlckNvdW50RmxhaXIoc2VsZiwgY291bnQpIHtcclxuICAgIGNvbnN0IGZsYWlyT3V0ZXIgPSBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0tZmxhaXItb3V0ZXJcIiB9KTtcclxuICAgIGZsYWlyT3V0ZXIuY3JlYXRlU3Bhbih7IGNsczogXCJ0cmVlLWl0ZW0tZmxhaXJcIiwgdGV4dDogU3RyaW5nKGNvdW50KSB9KTtcclxuICB9XHJcblxyXG4gIC8vIFJlaW4gaW5mb3JtYXRpdiwgdW50ZXIgZGVtIFRZUC1Gcm9udG1hdHRlci1FZGl0b3I6IGVya2xcdTAwRTRydCBkZW5cclxuICAvLyBGbG9hdGluZy1Qcm9wZXJ0eS1Ub2dnbGUgKFJlY2h0c2tsaWNrIGF1ZiBlaW5lIFByb3BlcnR5IG9iZW4sIHNpZWhlXHJcbiAgLy8gZW5zdXJlUHJvcGVydHlNZW51UGF0Y2ggaW4gdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpLiBCZXd1c3N0IG9obmUgZWlnZW5lXHJcbiAgLy8gXHUwMERDYmVyc2NocmlmdCwgZGEgZGlyZWt0IHVudGVyIGRlciBQcm9wZXJ0eS1MaXN0ZSBvaG5laGluIGtsYXIgaXN0LCB3b3JhdWZcclxuICAvLyBzaWNoIGRlciBIaW53ZWlzIGJlemllaHQuXHJcbiAgLy9cclxuICAvLyBIaWVyIHN0YW5kIGZyXHUwMEZDaGVyIHp1c1x1MDBFNHR6bGljaCBlaW5lIGZlc3RlIExpc3RlIGRlciBQbGF0emhhbHRlci1Ub2tlbi4gRGllXHJcbiAgLy8gaXN0IG1pdCBkZW0gU2hvcnRjdXQtS25vcGYgamUgUHJvcGVydHktWmVpbGUgZW50ZmFsbGVuOiBkZXNzZW4gQXVzd2FobFxyXG4gIC8vIChzaG9ydGN1dC1waWNrZXIuanMpIGZcdTAwRkNocnQgZGllc2VsYmVuIFRva2VuLCBhYmVyIGFtIE9ydCBkZXIgVmVyd2VuZHVuZyxcclxuICAvLyBkdXJjaHN1Y2hiYXIgdW5kIGJlaSBTa3JpcHRlbiBzYW10IGRlcmVuIGVpZ2VuZXIgQmVzY2hyZWlidW5nLlxyXG4gIHJlbmRlckZsb2F0aW5nSGludChwYXJlbnQpIHtcclxuICAgIGNvbnN0IHNlY3Rpb24gPSBwYXJlbnQuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZsb2F0aW5nLWhpbnQtc2VjdGlvblwiIH0pO1xyXG4gICAgc2VjdGlvbi5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwiZnJlZC10eXAtZmxvYXRpbmctaGludFwiLFxyXG4gICAgICB0ZXh0OiBcIllvdSBjYW4gY2hhbmdlIGEgcHJvcGVydHkgdG8gZmxvYXRpbmcgaW4gdGhlIHJpZ2h0LWNsaWNrIG1lbnUuXCIsXHJcbiAgICB9KTtcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlZ2lzdGVyVHlwVmlldyhwbHVnaW4pIHtcclxuICBwbHVnaW4ucmVnaXN0ZXJWaWV3KFZJRVdfVFlQRV9UWVAsIChsZWFmKSA9PiBuZXcgVHlwVmlldyhsZWFmLCBwbHVnaW4pKTtcclxuXHJcbiAgcGx1Z2luLmFkZENvbW1hbmQoe1xyXG4gICAgaWQ6IFwidHlwLXZpZXctb2VmZm5lblwiLFxyXG4gICAgbmFtZTogXCJUWVAtVmlldyBcdTAwRjZmZm5lblwiLFxyXG4gICAgY2FsbGJhY2s6ICgpID0+IGFjdGl2YXRlVHlwVmlldyhwbHVnaW4pLFxyXG4gIH0pO1xyXG5cclxuICBwbHVnaW4uYWRkQ29tbWFuZCh7XHJcbiAgICBpZDogXCJ0eXAtcHJvcGVydHktaGluenVmdWVnZW5cIixcclxuICAgIG5hbWU6IFwiVFlQLVByb3BlcnR5IGhpbnp1Zlx1MDBGQ2dlblwiLFxyXG4gICAgY2FsbGJhY2s6ICgpID0+IGFkZFR5cFByb3BlcnR5Q29tbWFuZChwbHVnaW4pLFxyXG4gIH0pO1xyXG5cclxuICBwbHVnaW4uYWRkQ29tbWFuZCh7XHJcbiAgICBpZDogXCJ0eXAtaGluenVmdWVnZW5cIixcclxuICAgIG5hbWU6IFwiTmV1ZW4gVFlQIGhpbnp1Zlx1MDBGQ2dlblwiLFxyXG4gICAgY2FsbGJhY2s6ICgpID0+IGFkZFR5cENvbW1hbmQocGx1Z2luKSxcclxuICB9KTtcclxuXHJcbiAgLy8gQmVpbSBIb3QtUmVsb2FkIGJsZWlidCBkZXIgYWx0ZSBMZWFmIGFscyBPYmpla3QgdW5hbmdldGFzdGV0IGJlc3RlaGVuIChudXJcclxuICAvLyB1bnNlciBQbHVnaW4tTW9kdWwgd2lyZCBuZXUgZ2VsYWRlbiksIGFiZXIgXCJpbnN0YW5jZW9mIFR5cFZpZXdcIiBzY2hsXHUwMEU0Z3QgZ2VnZW5cclxuICAvLyBkaWUgbmV1IGdlbGFkZW5lIEtsYXNzZSBmZWhsLiBhcHAuanMgc2VsYnN0IGJlc3RpbW10IGdldFZpZXdUeXBlKCkgcmVpbiBhdXNcclxuICAvLyBsZWFmLnZpZXcgLSBkYXMgcmVpY2h0IHp1ciBFcmtlbm51bmcgYWxzbyBuaWNodC4gYXBwIHNlbGJzdCBcdTAwRkNiZXJsZWJ0IGRlblxyXG4gIC8vIEhvdC1SZWxvYWQgZGFnZWdlbiB1bnZlclx1MDBFNG5kZXJ0LCBkYWhlciBkaWUgTGVhZi1SZWZlcmVueiBkaXJla3QgZG9ydCBhYmxlZ2VuLlxyXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4gYWN0aXZhdGVUeXBWaWV3KHBsdWdpbiwgZmFsc2UsIGZhbHNlKSk7XHJcblxyXG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiB7XHJcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFZJRVdfVFlQRV9UWVApKSB7XHJcbiAgICAgIGxlYWYudmlldz8ucmVuZGVyPy4oKTtcclxuICAgIH1cclxuICB9O1xyXG5cclxuICAvLyBaXHUwMEU0aGxlciAoTGlzdGUgdW5kIFBpY2tlciwgc2llaGUgdHlwSW5kZXgudHlwZUNvdW50cygpKSBzb25zdCBudXIgc28gYWt0dWVsbFxyXG4gIC8vIHdpZSBiZWltIGxldHp0ZW4gUmVuZGVyIGRpZXNlciBWaWV3IC0gamVkZSBUWVAtcmVsZXZhbnRlIFx1MDBDNG5kZXJ1bmcgYW5kZXJzd29cclxuICAvLyAobmV1ZS9nZWxcdTAwRjZzY2h0ZSBOb3RpeiwgVFlQIG9kZXIgU1VCVFlQIHVtZ2V0cmFnZW4pIGxpZVx1MDBERmUgc2llIHNvbnN0IHZlcmFsdGVuLFxyXG4gIC8vIGJpcyBpcmdlbmRlaW4gYW5kZXJlciBHcnVuZCAoei4gQi4gZWluZSBFaW5zdGVsbHVuZykgenVmXHUwMEU0bGxpZyBlaW5lbiBSZWZyZXNoXHJcbiAgLy8gYXVzbFx1MDBGNnN0LiBEYXMgXCJjaGFuZ2VcIi1FdmVudCBkZXMgSW5kZXggZmV1ZXJ0IG51ciBiZWkgZ2VuYXUgc29sY2hlblxyXG4gIC8vIFx1MDBDNG5kZXJ1bmdlbiwgbmljaHQgYmVpIGplZGVtIEF1dG9zYXZlLVRpY2suIFRyb3R6ZGVtIGRlYm91bmNlZCwgZGEgZGFzXHJcbiAgLy8gUmVuZGVybiBkZXIgTGlzdGUgdmVyZ2xlaWNoc3dlaXNlIHRldWVyIGlzdCAtIHJlc2V0VGltZXI6dHJ1ZSBzYW1tZWx0IGVpbmVcclxuICAvLyBcdTAwQzRuZGVydW5nc3NlcmllICh6LiBCLiBCdWxrLUltcG9ydCkgenUgZWluZW0gZWluemlnZW4gUmVmcmVzaC5cclxuICBjb25zdCBkZWJvdW5jZWRSZWZyZXNoID0gZGVib3VuY2UocmVmcmVzaCwgNTAwLCB0cnVlKTtcclxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgZGVib3VuY2VkUmVmcmVzaCkpO1xyXG4gIC8vIFx1MDBDNG5kZXJ0IGRpZSBcIkV4Y2x1ZGVkIGZpbGVzXCItTGlzdGUgc2VsYnN0ICh6LiBCLiBIaWRlIEZvbGRlcnMgYmVpbSBBdXMtL1xyXG4gIC8vIEVpbmJsZW5kZW4gZWluZXMgT3JkbmVycykgLSBPYnNpZGlhbnMgZWlnZW5lciBNZXRhZGF0YUNhY2hlIGxhdXNjaHQgaW50ZXJuXHJcbiAgLy8gZWJlbmZhbGxzIGdlbmF1IGF1ZiBkaWVzZXMgRXZlbnQsIHVtIHNlaW5lIElnbm9yZS1GaWx0ZXIgbmV1IHp1IGxhZGVuLlxyXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAudmF1bHQub24oXCJjb25maWctY2hhbmdlZFwiLCBkZWJvdW5jZWRSZWZyZXNoKSk7XHJcblxyXG4gIC8vIEZcdTAwRkNyIHBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzICh6LiBCLiBuYWNoIFVtc2NoYWx0ZW4gZGVyIFwiVFlQLUxpc3RlXHJcbiAgLy8gZWluZlx1MDBFNHJiZW5cIi1FaW5zdGVsbHVuZykgLSByZW5kZXJ0IGRpZSBMaXN0ZSAoYnp3LiBibGVpYnQgaW4gZGVyXHJcbiAgLy8gRGV0YWlsYW5zaWNodCwgcmVuZGVyKCkgYnJhbmNoJ3Qgc2VsYnN0KSBuZXUuXHJcbiAgcmV0dXJuIHJlZnJlc2g7XHJcbn1cclxuXHJcbi8vIGNyZWF0ZUlmTWlzc2luZzogZmFsc2UgYmVpbSBhdXRvbWF0aXNjaGVuIG9uTGF5b3V0UmVhZHktQXVmcnVmIChzaWVoZVxyXG4vLyByZWdpc3RlclR5cFZpZXcpIC0gZGVyIHNvbGwgYXVzc2NobGllXHUwMERGbGljaCBlaW5lbiBiZWltIEhvdC1SZWxvYWQgdmVyd2Fpc3RlbixcclxuLy8gYWJlciBiZXJlaXRzIHZvcmhhbmRlbmVuIExlYWYgd2llZGVydmVyYmluZGVuIChzaWVoZSBLb21tZW50YXIgZG9ydCksIG5pY2h0XHJcbi8vIGJlaSBqZWRlbSByZWd1bFx1MDBFNHJlbiBPYnNpZGlhbi1TdGFydCB1bmNvbmRpdGlvbmFsIGVpbmVuIG5ldWVuIExlYWYgZXJ6ZXVnZW5cclxuLy8gdW5kIGFrdGl2aWVyZW4uIFdhciBkaWUgVFlQLVBhbmUgYmVpbSBsZXR6dGVuIEJlZW5kZW4gZ2VzY2hsb3NzZW4gKG9kZXJcclxuLy8gZWluZW0gZnJpc2NoZW4gVmF1bHQpLCBibGVpYnQgc2llIG9obmUgZGllc2UgVW50ZXJzY2hlaWR1bmcgc29uc3QgYXVjaCB6dS5cclxuYXN5bmMgZnVuY3Rpb24gYWN0aXZhdGVUeXBWaWV3KHBsdWdpbiwgcmV2ZWFsID0gdHJ1ZSwgY3JlYXRlSWZNaXNzaW5nID0gdHJ1ZSkge1xyXG4gIGNvbnN0IGFwcCA9IHBsdWdpbi5hcHA7XHJcbiAgY29uc3QgeyB3b3Jrc3BhY2UgfSA9IGFwcDtcclxuXHJcbiAgY29uc3QgY2FuZGlkYXRlcyA9IFtdO1xyXG4gIHdvcmtzcGFjZS5pdGVyYXRlQWxsTGVhdmVzKChsZWFmKSA9PiB7XHJcbiAgICBpZiAobGVhZiA9PT0gYXBwLl9fZnJlZFR5cExlYWYgfHwgKGxlYWYudmlldyAmJiBsZWFmLnZpZXcuZ2V0Vmlld1R5cGUoKSA9PT0gVklFV19UWVBFX1RZUCkpIHtcclxuICAgICAgY2FuZGlkYXRlcy5wdXNoKGxlYWYpO1xyXG4gICAgfVxyXG4gIH0pO1xyXG5cclxuICBsZXQgbGVhZiA9IGNhbmRpZGF0ZXMuc2hpZnQoKSA/PyBudWxsO1xyXG4gIGZvciAoY29uc3QgZXh0cmEgb2YgY2FuZGlkYXRlcykgZXh0cmEuZGV0YWNoKCk7XHJcblxyXG4gIGlmICghbGVhZikge1xyXG4gICAgaWYgKCFjcmVhdGVJZk1pc3NpbmcpIHJldHVybjtcclxuICAgIGxlYWYgPSB3b3Jrc3BhY2UuZ2V0TGVmdExlYWYoZmFsc2UpO1xyXG4gICAgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoeyB0eXBlOiBWSUVXX1RZUEVfVFlQLCBhY3RpdmU6IHRydWUgfSk7XHJcbiAgfSBlbHNlIGlmICghKGxlYWYudmlldyBpbnN0YW5jZW9mIFR5cFZpZXcpKSB7XHJcbiAgICAvLyBhY3RpdmU6IGZhbHNlIC0gcmVpbmVzIFdpZWRlcnZlcmJpbmRlbiBuYWNoIEhvdC1SZWxvYWQgKHNpZWhlIEtvbW1lbnRhclxyXG4gICAgLy8gb2JlbiBhbiBhY3RpdmF0ZVR5cFZpZXcpLCBkZXIgTGVhZiBpc3QgamEgYmVyZWl0cyB2b3JoYW5kZW4vc2ljaHRiYXIuXHJcbiAgICAvLyBNaXQgYWN0aXZlOiB0cnVlIHdcdTAwRkNyZGUgamVkZXIgUGx1Z2luLVJlbG9hZCAobmljaHQgbnVyIGVpbiBBcHAtTmV1c3RhcnQpXHJcbiAgICAvLyBkZW4gZ2xvYmFsZW4gRm9rdXMgYXVmIGRpZSBUWVAtUGFuZSByZWlcdTAwREZlbiAtIG9uTGF5b3V0UmVhZHkoKSBmZXVlcnRcclxuICAgIC8vIHNlaW5lbiBDYWxsYmFjayBzb2ZvcnQsIHNvYmFsZCB3b3Jrc3BhY2UubGF5b3V0UmVhZHkgZWlubWFsIHRydWUgaXN0LFxyXG4gICAgLy8gYWxzbyBiZWkgamVkZW0gZWluemVsbmVuIEhvdC1SZWxvYWQgd1x1MDBFNGhyZW5kIGRlciBFbnR3aWNrbHVuZyBlcm5ldXQuXHJcbiAgICBhd2FpdCBsZWFmLnNldFZpZXdTdGF0ZSh7IHR5cGU6IFZJRVdfVFlQRV9UWVAsIGFjdGl2ZTogZmFsc2UgfSk7XHJcbiAgfVxyXG5cclxuICBhcHAuX19mcmVkVHlwTGVhZiA9IGxlYWY7XHJcbiAgaWYgKHJldmVhbCkgd29ya3NwYWNlLnJldmVhbExlYWYobGVhZik7XHJcbn1cclxuXHJcbi8vIFZvcnJhbmdpZyBpbiBkZXIgYmVyZWl0cyBvZmZlbmVuIFRZUC1EZXRhaWxhbnNpY2h0IChkYW5uIGV4YWt0IHdpZSBkZXJcclxuLy8gZG9ydGlnZSArLUJ1dHRvbiksIHNvbnN0IHdpcmQgZGllIERldGFpbGFuc2ljaHQgZlx1MDBGQ3IgZGVuIFRZUCBkZXIgYWt0aXZlblxyXG4vLyBOb3RpeiBnZVx1MDBGNmZmbmV0IHVuZCBkaWUgUHJvcGVydHkgZG9ydCBlcmdcdTAwRTRuenQuIElzdCBrZWluZSBOb3RpeiBvZmZlbiBvZGVyXHJcbi8vIGhhdCBzaWUga2VpbmVuIFRZUCwgZGllbnQgZWluZSB6d2FyIG5pY2h0IGZva3Vzc2llcnRlLCBhYmVyIGluIGRlclxyXG4vLyBEZXRhaWxhbnNpY2h0IG9mZmVuZSBUWVAtVmlldyBhbHMgUlx1MDBGQ2NrZmFsbGViZW5lLiBJc3QgbnVyIGRpZSBUWVBlbi1MaXN0ZVxyXG4vLyBvZmZlbiAoa2VpbiBzZWxlY3RlZFR5cGUpLCB6XHUwMEU0aGx0IGRhcyBuaWNodCBhbHMgXCJvZmZlbmUgRGV0YWlsYW5zaWNodFwiIC1cclxuLy8gZGFmXHUwMEZDciBmZWhsdCBkb3J0IGVpbiBGcm9udG1hdHRlci1FZGl0b3IsIGFuIGRlbSBzaWNoIGV0d2FzIGhpbnp1Zlx1MDBGQ2dlbiBsaWVcdTAwREZlLlxyXG5hc3luYyBmdW5jdGlvbiBhZGRUeXBQcm9wZXJ0eUNvbW1hbmQocGx1Z2luKSB7XHJcbiAgY29uc3QgYXBwID0gcGx1Z2luLmFwcDtcclxuXHJcbiAgY29uc3QgYWN0aXZlVHlwVmlldyA9IGFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShUeXBWaWV3KTtcclxuICBpZiAoYWN0aXZlVHlwVmlldyAmJiBhY3RpdmVUeXBWaWV3LnNlbGVjdGVkVHlwZSAhPT0gbnVsbCkge1xyXG4gICAgYWN0aXZlVHlwVmlldy5mcm9udG1hdHRlckJsb2Nrcz8uYWRkQmxhbmsobnVsbCk7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG5cclxuICBjb25zdCBmaWxlID0gYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XHJcbiAgY29uc3QgdHlwZSA9IHBsdWdpbi50eXBJbmRleC50eXBlT2YoZmlsZSk7XHJcbiAgaWYgKCF0eXBlKSB7XHJcbiAgICBjb25zdCBvcGVuTGVhZiA9IGFwcC53b3Jrc3BhY2VcclxuICAgICAgLmdldExlYXZlc09mVHlwZShWSUVXX1RZUEVfVFlQKVxyXG4gICAgICAuZmluZCgobGVhZikgPT4gbGVhZi52aWV3IGluc3RhbmNlb2YgVHlwVmlldyAmJiBsZWFmLnZpZXcuc2VsZWN0ZWRUeXBlICE9PSBudWxsKTtcclxuICAgIGlmIChvcGVuTGVhZikge1xyXG4gICAgICBhd2FpdCBhcHAud29ya3NwYWNlLnJldmVhbExlYWYob3BlbkxlYWYpO1xyXG4gICAgICBvcGVuTGVhZi52aWV3LmZyb250bWF0dGVyQmxvY2tzPy5hZGRCbGFuayhudWxsKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgbmV3IE5vdGljZShmaWxlID8gXCJBa3RpdmUgTm90aXogaGF0IGtlaW5lbiBUWVAgdW5kIGluIGRlciBUWVAtVmlldyBpc3Qga2VpbiBUWVAgZ2VcdTAwRjZmZm5ldC5cIiA6IFwiS2VpbmUgTm90aXogb2ZmZW4gdW5kIGluIGRlciBUWVAtVmlldyBpc3Qga2VpbiBUWVAgZ2VcdTAwRjZmZm5ldC5cIik7XHJcbiAgICByZXR1cm47XHJcbiAgfVxyXG5cclxuICBhd2FpdCBhY3RpdmF0ZVR5cFZpZXcocGx1Z2luKTtcclxuICBjb25zdCB2aWV3ID0gYXBwLl9fZnJlZFR5cExlYWY/LnZpZXc7XHJcbiAgaWYgKCEodmlldyBpbnN0YW5jZW9mIFR5cFZpZXcpKSByZXR1cm47XHJcbiAgdmlldy5vcGVuVHlwZVNldHRpbmdzKHR5cGUpO1xyXG4gIHZpZXcuZnJvbnRtYXR0ZXJCbG9ja3M/LmFkZEJsYW5rKG51bGwpO1xyXG59XHJcblxyXG4vLyBcdTAwRDZmZm5ldCBiZWkgQmVkYXJmIGVyc3QgZGllIFRZUC1WaWV3IChiencuIHZlcmxcdTAwRTRzc3QgZWluZSBvZmZlbmUgRGV0YWlsYW5zaWNodFxyXG4vLyB6dXJcdTAwRkNjayB6dXIgTGlzdGUgLSBzdGFydEFkZCgpIGxlZ3QgZGFzIG5ldWUgVHJlZS1JdGVtIGluIHRoaXMubGlzdEVsIGFuLCBkYXNcclxuLy8gZXMgbnVyIGluIGRlciBMaXN0ZW5hbnNpY2h0IGdpYnQpLCB1bmQgc3RcdTAwRjZcdTAwREZ0IGRvcnQgZGVuc2VsYmVuIEFibGF1ZiB3aWUgZGVyXHJcbi8vICstQnV0dG9uIGltIExpc3Rlbi1IZWFkZXIgYW4uXHJcbmFzeW5jIGZ1bmN0aW9uIGFkZFR5cENvbW1hbmQocGx1Z2luKSB7XHJcbiAgYXdhaXQgYWN0aXZhdGVUeXBWaWV3KHBsdWdpbik7XHJcbiAgY29uc3QgdmlldyA9IHBsdWdpbi5hcHAuX19mcmVkVHlwTGVhZj8udmlldztcclxuICBpZiAoISh2aWV3IGluc3RhbmNlb2YgVHlwVmlldykpIHJldHVybjtcclxuICBpZiAodmlldy5zZWxlY3RlZFR5cGUgIT09IG51bGwpIHZpZXcuY2xvc2VUeXBlU2V0dGluZ3MoKTtcclxuICB2aWV3LnN0YXJ0QWRkKCk7XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlclR5cFZpZXcsIFZJRVdfVFlQRV9UWVAsIGNvbXBhcmVUeXBlcywgc29ydFR5cGVzQnlNb2RlLCBERUZBVUxUX1NPUlRfT1JERVIsIERFRkFVTFRfVFlQRV9DT0xPUiB9O1xyXG4iLCAiY29uc3QgeyBURmlsZSwgVEZvbGRlciB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBjb2xvckZvckZpbGUgfSA9IHJlcXVpcmUoXCIuL3R5cGUtY29sb3JzXCIpO1xuXG5jb25zdCBGSUxFX0VYUExPUkVSX1ZJRVdfVFlQRSA9IFwiZmlsZS1leHBsb3JlclwiO1xuY29uc3QgRk9MREVSX05PVEVTX1BMVUdJTl9JRCA9IFwiZm9sZGVyLW5vdGVzXCI7XG5cbi8vIERhcyBcIkZvbGRlciBOb3Rlc1wiLVBsdWdpbiB6ZWlndCBlaW5lIE5vdGl6IHN0YXR0IGFscyBlaWdlbmUgWmVpbGUgYWxzIE9yZG5lciBhbi5cbi8vIEVzIGhhdCBrZWluZSBcdTAwRjZmZmVudGxpY2hlIEFQSSBkYWZcdTAwRkNyLCBkYWhlciBkZW4gRGF0ZWluYW1lbiBhdXMgc2VpbmVuIGVpZ2VuZW5cbi8vIChMaXZlLSlFaW5zdGVsbHVuZ2VuIG5hY2hiYXVlbiwgc3RhdHQgc2VpbmUgaW50ZXJuZW4gRnVua3Rpb25lbiBhbnp1emFwZmVuLlxuZnVuY3Rpb24gZ2V0Rm9sZGVyTm90ZUZpbGUocGx1Z2luLCBmb2xkZXIpIHtcbiAgY29uc3QgZm9sZGVyTm90ZXMgPSBwbHVnaW4uYXBwLnBsdWdpbnMucGx1Z2luc1tGT0xERVJfTk9URVNfUExVR0lOX0lEXTtcbiAgY29uc3Qgc2V0dGluZ3MgPSBmb2xkZXJOb3Rlcz8uc2V0dGluZ3M7XG4gIGlmICghc2V0dGluZ3MpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGZpbGVOYW1lID1cbiAgICAoc2V0dGluZ3MuZm9sZGVyTm90ZU5hbWUgfHwgXCJ7e2ZvbGRlcl9uYW1lfX1cIikucmVwbGFjZShcInt7Zm9sZGVyX25hbWV9fVwiLCBmb2xkZXIubmFtZSkgK1xuICAgIChzZXR0aW5ncy5mb2xkZXJOb3RlVHlwZSB8fCBcIi5tZFwiKTtcbiAgY29uc3QgZGlyUGF0aCA9IHNldHRpbmdzLnN0b3JhZ2VMb2NhdGlvbiA9PT0gXCJwYXJlbnRGb2xkZXJcIiA/IGZvbGRlci5wYXJlbnQ/LnBhdGggPz8gXCJcIiA6IGZvbGRlci5wYXRoO1xuICBjb25zdCBwYXRoID0gZGlyUGF0aCA/IGAke2RpclBhdGh9LyR7ZmlsZU5hbWV9YCA6IGZpbGVOYW1lO1xuXG4gIGNvbnN0IGZpbGUgPSBwbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChwYXRoKTtcbiAgcmV0dXJuIGZpbGUgaW5zdGFuY2VvZiBURmlsZSA/IGZpbGUgOiBudWxsO1xufVxuXG5mdW5jdGlvbiBhcHBseUNvbG9yVG9UaXRsZShwbHVnaW4sIHRpdGxlRWwsIGZpbGUpIHtcbiAgY29uc3QgY29udGVudEVsID0gdGl0bGVFbC5xdWVyeVNlbGVjdG9yKFwiLm5hdi1maWxlLXRpdGxlLWNvbnRlbnQsIC5uYXYtZm9sZGVyLXRpdGxlLWNvbnRlbnRcIik7XG4gIGlmICghY29udGVudEVsKSByZXR1cm47XG5cbiAgY29uc3QgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5maWxlRXhwbG9yZXIgPyBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCBcImZpbGVFeHBsb3JlclwiKSA6IG51bGw7XG4gIGlmIChjb2xvcikgY29udGVudEVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gIGVsc2UgY29udGVudEVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiY29sb3JcIik7XG59XG5cbmZ1bmN0aW9uIGFwcGx5RmlsZUV4cGxvcmVyQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEZJTEVfRVhQTE9SRVJfVklFV19UWVBFKSkge1xuICAgIGNvbnN0IGZpbGVUaXRsZUVscyA9IGxlYWYudmlldy5jb250YWluZXJFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLm5hdi1maWxlLXRpdGxlW2RhdGEtcGF0aF1cIik7XG4gICAgZm9yIChjb25zdCB0aXRsZUVsIG9mIGZpbGVUaXRsZUVscykge1xuICAgICAgY29uc3QgZmlsZSA9IHBsdWdpbi5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHRpdGxlRWwuZ2V0QXR0cmlidXRlKFwiZGF0YS1wYXRoXCIpKTtcbiAgICAgIGFwcGx5Q29sb3JUb1RpdGxlKHBsdWdpbiwgdGl0bGVFbCwgZmlsZSBpbnN0YW5jZW9mIFRGaWxlID8gZmlsZSA6IG51bGwpO1xuICAgIH1cblxuICAgIGNvbnN0IGZvbGRlclRpdGxlRWxzID0gbGVhZi52aWV3LmNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIubmF2LWZvbGRlci10aXRsZVtkYXRhLXBhdGhdXCIpO1xuICAgIGZvciAoY29uc3QgdGl0bGVFbCBvZiBmb2xkZXJUaXRsZUVscykge1xuICAgICAgY29uc3QgZm9sZGVyID0gcGx1Z2luLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgodGl0bGVFbC5nZXRBdHRyaWJ1dGUoXCJkYXRhLXBhdGhcIikpO1xuICAgICAgY29uc3Qgbm90ZUZpbGUgPSBmb2xkZXIgaW5zdGFuY2VvZiBURm9sZGVyID8gZ2V0Rm9sZGVyTm90ZUZpbGUocGx1Z2luLCBmb2xkZXIpIDogbnVsbDtcbiAgICAgIGFwcGx5Q29sb3JUb1RpdGxlKHBsdWdpbiwgdGl0bGVFbCwgbm90ZUZpbGUpO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlckZpbGVFeHBsb3JlckNvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5RmlsZUV4cGxvcmVyQ29sb3JzKHBsdWdpbik7XG5cbiAgLy8gRGVyIEZpbGUtRXhwbG9yZXIgcmVuZGVydCBFaW50clx1MDBFNGdlIGJlaW0gQXVmLS9adWtsYXBwZW4gdm9uIE9yZG5lcm4gZHluYW1pc2NoXG4gIC8vIG5ldSAtIHBlciBNdXRhdGlvbk9ic2VydmVyIGF1ZiBuZXUgZWluZ2VmXHUwMEZDZ3RlIEVsZW1lbnRlIHJlYWdpZXJlbiwgc3RhdHQgbnVyXG4gIC8vIGVpbm1hbGlnIGJlaW0gU3RhcnQgZWluenVmXHUwMEU0cmJlbi5cbiAgY29uc3Qgb2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcihyZWZyZXNoKTtcbiAgY29uc3Qgb2JzZXJ2ZUV4cGxvcmVyTGVhdmVzID0gKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoRklMRV9FWFBMT1JFUl9WSUVXX1RZUEUpKSB7XG4gICAgICBvYnNlcnZlci5vYnNlcnZlKGxlYWYudmlldy5jb250YWluZXJFbCwgeyBjaGlsZExpc3Q6IHRydWUsIHN1YnRyZWU6IHRydWUgfSk7XG4gICAgfVxuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4gb2JzZXJ2ZXIuZGlzY29ubmVjdCgpKTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLnZhdWx0Lm9uKFwicmVuYW1lXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoXG4gICAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgIG9ic2VydmVFeHBsb3JlckxlYXZlcygpO1xuICAgICAgcmVmcmVzaCgpO1xuICAgIH0pXG4gICk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgb2JzZXJ2ZUV4cGxvcmVyTGVhdmVzKCk7XG4gICAgcmVmcmVzaCgpO1xuICB9KTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyRmlsZUV4cGxvcmVyQ29sb3JzIH07XG4iLCAiY29uc3QgeyBjb2xvckZvckZpbGUgfSA9IHJlcXVpcmUoXCIuL3R5cGUtY29sb3JzXCIpO1xuXG5jb25zdCBHUkFQSF9WSUVXX1RZUEVTID0gW1wiZ3JhcGhcIiwgXCJsb2NhbGdyYXBoXCJdO1xuXG5mdW5jdGlvbiBoZXhUb0ludChoZXgpIHtcbiAgcmV0dXJuIHBhcnNlSW50KGhleC5yZXBsYWNlKFwiI1wiLCBcIlwiKSwgMTYpO1xufVxuXG4vLyBlbmdpbmUucmVuZGVyKCkgbGllc3Qgc2VpbiBpbnRlcm5lcyBmaWxlRmlsdGVyLU9iamVrdCBudXIgYXVzLCB3ZW5uIGJlcmVpdHNcbi8vIG1pbmRlc3RlbnMgZWluZSBlaWdlbmUgRmFyYmdydXBwZS9GaWx0ZXItUXVlcnkgYWt0aXYgaXN0IC0gb2huZSBlaWdlbmUgR3J1cHBlblxuLy8gYmVrb21tdCBqZWRlIERhdGVpIHBhdXNjaGFsIGNvbG9yOnRydWUgKGtlaW4gRmFyYndlcnQpLCBmaWxlRmlsdGVyIHdpcmQgZ2FyXG4vLyBuaWNodCBlcnN0IGtvbnN1bHRpZXJ0LiBSb2J1c3RlciBpc3QgZGVyIEVpbmdyaWZmIGRpcmVrdCBhbiByZW5kZXJlci5zZXREYXRhLFxuLy8gdW5taXR0ZWxiYXIgYmV2b3IgZGllIGZlcnRpZ2VuIE5vZGUtRGF0ZW4gYW4gZGVuIFdlYkdMLVJlbmRlcmVyIGdlaGVuIC0gYW5cbi8vIGV4YWt0IGRpZXNlciBTdGVsbGUgcGF0Y2h0IGF1Y2ggZGFzIENvbW11bml0eS1QbHVnaW4gXCJncmFwaC1uZXN0ZWQtdGFnc1wiLlxuLy8gRWlnZW5lIEZhcmJncnVwcGVuIGhhYmVuIGRvcnQgbm9kZS5jb2xvciBiZXJlaXRzIGdlc2V0enQgdW5kIGJsZWliZW4gdW5hbmdldGFzdGV0LlxuZnVuY3Rpb24gcGF0Y2hSZW5kZXJlcihwbHVnaW4sIHJlbmRlcmVyKSB7XG4gIGlmIChyZW5kZXJlci5fX2ZyZWRUeXBDb2xvclBhdGNoZWQpIHJldHVybjtcbiAgcmVuZGVyZXIuX19mcmVkVHlwQ29sb3JQYXRjaGVkID0gdHJ1ZTtcblxuICBjb25zdCBvcmlnaW5hbCA9IHJlbmRlcmVyLnNldERhdGE7XG4gIHJlbmRlcmVyLnNldERhdGEgPSBmdW5jdGlvbiAoZGF0YSkge1xuICAgIGZvciAoY29uc3QgcGF0aCBpbiBkYXRhLm5vZGVzKSB7XG4gICAgICBjb25zdCBub2RlID0gZGF0YS5ub2Rlc1twYXRoXTtcbiAgICAgIGlmIChub2RlLmNvbG9yKSBjb250aW51ZTtcblxuICAgICAgaWYgKG5vZGUudHlwZSA9PT0gXCJ0YWdcIikge1xuICAgICAgICAvLyBFaWdlbmUgVGFnLUZhcmJlIGRlYWt0aXZpZXJ0ICgzMC4wOS4yMDI2KTogVGFnLUtub3RlbiBsYXNzZW4gc2ljaCBpbVxuICAgICAgICAvLyBNaW5pbWFsIFRoZW1lIGJlcmVpdHMgXHUwMEZDYmVyIGRpZSBTdHlsZSBTZXR0aW5ncyBlaW5mXHUwMEU0cmJlbiAoR3JhcGhzIFx1MjE5MlxuICAgICAgICAvLyBcIlRhZyBub2RlIGNvbG9yXCIpLCBkYXMgaGllciB3YXIgZWluZSBEb3BwbHVuZy4gRGllIFRZUC1FaW5mXHUwMEU0cmJ1bmcgZGVyXG4gICAgICAgIC8vIE5vdGl6LUtub3RlbiB1bnRlbiBibGVpYnQsIGRpZSBrYW5uIFN0eWxlIFNldHRpbmdzIG5pY2h0LlxuICAgICAgICAvLyBpZiAocGx1Z2luLnNldHRpbmdzLmdyYXBoVGFnQ29sb3JFbmFibGVkICYmIHBsdWdpbi5zZXR0aW5ncy5ncmFwaFRhZ0NvbG9yKSB7XG4gICAgICAgIC8vICAgbm9kZS5jb2xvciA9IHsgYTogMSwgcmdiOiBoZXhUb0ludChwbHVnaW4uc2V0dGluZ3MuZ3JhcGhUYWdDb2xvcikgfTtcbiAgICAgICAgLy8gfVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgZmlsZSA9IHBsdWdpbi5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHBhdGgpO1xuICAgICAgbGV0IGNvbG9yID0gbnVsbDtcblxuICAgICAgaWYgKGZpbGUgJiYgZmlsZS5leHRlbnNpb24gIT09IFwibWRcIikge1xuICAgICAgICAvLyBFaWdlbmUgQW5oXHUwMEU0bmdlLUZhcmJlIGRlYWt0aXZpZXJ0ICgzMC4wOS4yMDI2KSwgd2llIGRpZSBUYWctRmFyYmUgb2JlbjpcbiAgICAgICAgLy8gU3R5bGUgU2V0dGluZ3MgZGVzIE1pbmltYWwgVGhlbWUsIEdyYXBocyBcdTIxOTIgXCJBdHRhY2htZW50IG5vZGUgY29sb3JcIi5cbiAgICAgICAgLy8gaWYgKHBsdWdpbi5zZXR0aW5ncy5ncmFwaEF0dGFjaG1lbnRDb2xvckVuYWJsZWQgJiYgcGx1Z2luLnNldHRpbmdzLmdyYXBoQXR0YWNobWVudENvbG9yKSB7XG4gICAgICAgIC8vICAgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuZ3JhcGhBdHRhY2htZW50Q29sb3I7XG4gICAgICAgIC8vIH1cbiAgICAgIH0gZWxzZSBpZiAocGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MuZ3JhcGgpIHtcbiAgICAgICAgY29sb3IgPSBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCBcImdyYXBoXCIpO1xuICAgICAgfVxuXG4gICAgICBpZiAoY29sb3IpIG5vZGUuY29sb3IgPSB7IGE6IDEsIHJnYjogaGV4VG9JbnQoY29sb3IpIH07XG4gICAgfVxuICAgIHJldHVybiBvcmlnaW5hbC5jYWxsKHRoaXMsIGRhdGEpO1xuICB9O1xuXG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiB7XG4gICAgcmVuZGVyZXIuc2V0RGF0YSA9IG9yaWdpbmFsO1xuICAgIGRlbGV0ZSByZW5kZXJlci5fX2ZyZWRUeXBDb2xvclBhdGNoZWQ7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBnZXRHcmFwaExlYXZlcyhhcHApIHtcbiAgY29uc3QgbGVhdmVzID0gW107XG4gIGZvciAoY29uc3QgdHlwZSBvZiBHUkFQSF9WSUVXX1RZUEVTKSBsZWF2ZXMucHVzaCguLi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZSh0eXBlKSk7XG4gIHJldHVybiBsZWF2ZXM7XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyR3JhcGhDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIGdldEdyYXBoTGVhdmVzKHBsdWdpbi5hcHApKSB7XG4gICAgICBpZiAobGVhZi52aWV3Py5yZW5kZXJlcikgcGF0Y2hSZW5kZXJlcihwbHVnaW4sIGxlYWYudmlldy5yZW5kZXJlcik7XG4gICAgICAvLyBEZXIgZ2xvYmFsZSBHcmFwaCBoXHUwMEU0bHQgc2VpbmUgRW5naW5lIGluIHZpZXcuZGF0YUVuZ2luZSwgZGVyIGxva2FsZSBpblxuICAgICAgLy8gdmlldy5lbmdpbmUgLSBvaG5lIGRlbiB6d2VpdGVuIEZhbGwgYmVrYW0gZWluIGxva2FsZXIgR3JhcGggZWluZVxuICAgICAgLy8gZ2VcdTAwRTRuZGVydGUgVFlQLUZhcmJlIGVyc3QgYmVpbSBuXHUwMEU0Y2hzdGVuIGVpZ2VuZW4gTmV1YXVmYmF1IHp1IHNlaGVuLlxuICAgICAgKGxlYWYudmlldz8uZGF0YUVuZ2luZSA/PyBsZWFmLnZpZXc/LmVuZ2luZSk/LnJlbmRlcigpO1xuICAgIH1cbiAgfTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICAvLyBOdXIgYmVpIHRhdHNcdTAwRTRjaGxpY2ggZ2VcdTAwRTRuZGVydGVtIFRZUCAoc2llaGUgdHlwLWluZGV4LmpzKSAtIHNvbnN0IHplaWd0ZSBkZXJcbiAgLy8gR3JhcGggZWluZSB1bWdldHJhZ2VuZSBGYXJiZSBlcnN0IG5hY2ggZGVtIG5cdTAwRTRjaHN0ZW4gZWlnZW5lbiBOZXVhdWZiYXUuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkocmVmcmVzaCk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckdyYXBoQ29sb3JzIH07XG4iLCAiY29uc3QgeyBjb2xvckZvckZpbGUgfSA9IHJlcXVpcmUoXCIuL3R5cGUtY29sb3JzXCIpO1xuXG5jb25zdCBTRUFSQ0hfVklFV19UWVBFID0gXCJzZWFyY2hcIjtcblxuLy8gRXJnZWJuaXN6ZWlsZW4gaW0gU2VhcmNoIFZpZXcgdHJhZ2VuIGtlaW4gZGF0YS1wYXRoLUF0dHJpYnV0LCBhYmVyIGRpZVxuLy8gU2VhcmNoVmlldyBwZmxlZ3QgaW50ZXJuIGVpbmUgTWFwIHZvbiBURmlsZSAtPiBFcmdlYm5pcy1ET00tT2JqZWt0XG4vLyAoZG9tLnJlc3VsdERvbUxvb2t1cCkgLSBkYXJcdTAwRkNiZXIgbFx1MDBFNHNzdCBzaWNoIERhdGVpIHVuZCBaZWlsZSBkaXJla3QgdmVyYmluZGVuLlxuZnVuY3Rpb24gYXBwbHlTZWFyY2hDb2xvcnMocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoU0VBUkNIX1ZJRVdfVFlQRSkpIHtcbiAgICBjb25zdCByZXN1bHREb21Mb29rdXAgPSBsZWFmLnZpZXc/LmRvbT8ucmVzdWx0RG9tTG9va3VwO1xuICAgIGlmICghcmVzdWx0RG9tTG9va3VwKSBjb250aW51ZTtcblxuICAgIGZvciAoY29uc3QgW2ZpbGUsIHJlc3VsdERvbV0gb2YgcmVzdWx0RG9tTG9va3VwKSB7XG4gICAgICBjb25zdCB0aXRsZUVsID0gcmVzdWx0RG9tLmVsPy5xdWVyeVNlbGVjdG9yKFwiLnNlYXJjaC1yZXN1bHQtZmlsZS10aXRsZSAudHJlZS1pdGVtLWlubmVyXCIpO1xuICAgICAgaWYgKCF0aXRsZUVsKSBjb250aW51ZTtcblxuICAgICAgY29uc3QgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5zZWFyY2ggPyBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCBcInNlYXJjaFwiKSA6IG51bGw7XG4gICAgICBpZiAoY29sb3IpIHRpdGxlRWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcbiAgICAgIGVsc2UgdGl0bGVFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImNvbG9yXCIpO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlclNlYXJjaENvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5U2VhcmNoQ29sb3JzKHBsdWdpbik7XG5cbiAgLy8gRXJnZWJuaXNzZSB3ZXJkZW4gYmVpIGplZGVyIFN1Y2hlaW5nYWJlIGtvbXBsZXR0IG5ldSBhdWZnZWJhdXQuXG4gIGNvbnN0IG9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIocmVmcmVzaCk7XG4gIGNvbnN0IG9ic2VydmVMZWF2ZXMgPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShTRUFSQ0hfVklFV19UWVBFKSkge1xuICAgICAgb2JzZXJ2ZXIub2JzZXJ2ZShsZWFmLnZpZXcuY29udGFpbmVyRWwsIHsgY2hpbGRMaXN0OiB0cnVlLCBzdWJ0cmVlOiB0cnVlIH0pO1xuICAgIH1cbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IG9ic2VydmVyLmRpc2Nvbm5lY3QoKSk7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoXG4gICAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICAgIHJlZnJlc2goKTtcbiAgICB9KVxuICApO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICByZWZyZXNoKCk7XG4gIH0pO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJTZWFyY2hDb2xvcnMgfTtcbiIsICJjb25zdCB7IGNvbG9yRm9yRmlsZSB9ID0gcmVxdWlyZShcIi4vdHlwZS1jb2xvcnNcIik7XG5cbmNvbnN0IFJFQ0VOVF9GSUxFU19WSUVXX1RZUEUgPSBcInJlY2VudC1maWxlc1wiO1xuXG4vLyBSZWNlbnQgRmlsZXMgc2V0enQga2VpbiBkYXRhLXBhdGgtQXR0cmlidXQgYXVmIHNlaW5lIFplaWxlbi4gRXMgcmVuZGVydCBzZWluZVxuLy8gTGlzdGUgYWJlciBvaG5lIFx1MDBGQ2JlcnNwcnVuZ2VuZSBFaW50clx1MDBFNGdlIGRpcmVrdCBhdXMgZGF0YS5yZWNlbnRGaWxlcywgZGFoZXJcbi8vIGxcdTAwRTRzc3Qgc2ljaCBkaWUgWmVpbGUgXHUwMEZDYmVyIGRlbiBJbmRleCBlaW5kZXV0aWcgZGVtIFBmYWQgenVvcmRuZW4uXG5mdW5jdGlvbiBhcHBseVJlY2VudEZpbGVzQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFJFQ0VOVF9GSUxFU19WSUVXX1RZUEUpKSB7XG4gICAgY29uc3QgcmVjZW50RmlsZXMgPSBsZWFmLnZpZXc/LmRhdGE/LnJlY2VudEZpbGVzO1xuICAgIGlmICghQXJyYXkuaXNBcnJheShyZWNlbnRGaWxlcykpIGNvbnRpbnVlO1xuXG4gICAgY29uc3QgdGl0bGVFbHMgPSBsZWFmLnZpZXcuY29udGFpbmVyRWwucXVlcnlTZWxlY3RvckFsbChcIi5yZWNlbnQtZmlsZXMtdGl0bGUgLm5hdi1maWxlLXRpdGxlLWNvbnRlbnRcIik7XG4gICAgdGl0bGVFbHMuZm9yRWFjaCgodGl0bGVFbCwgaW5kZXgpID0+IHtcbiAgICAgIGNvbnN0IGVudHJ5ID0gcmVjZW50RmlsZXNbaW5kZXhdO1xuICAgICAgY29uc3QgZmlsZSA9IGVudHJ5ID8gcGx1Z2luLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoZW50cnkucGF0aCkgOiBudWxsO1xuICAgICAgY29uc3QgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5yZWNlbnRGaWxlcyA/IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIFwicmVjZW50RmlsZXNcIikgOiBudWxsO1xuICAgICAgaWYgKGNvbG9yKSB0aXRsZUVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gICAgICBlbHNlIHRpdGxlRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlclJlY2VudEZpbGVzQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlSZWNlbnRGaWxlc0NvbG9ycyhwbHVnaW4pO1xuXG4gIGNvbnN0IG9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIocmVmcmVzaCk7XG4gIGNvbnN0IG9ic2VydmVMZWF2ZXMgPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShSRUNFTlRfRklMRVNfVklFV19UWVBFKSkge1xuICAgICAgb2JzZXJ2ZXIub2JzZXJ2ZShsZWFmLnZpZXcuY29udGFpbmVyRWwsIHsgY2hpbGRMaXN0OiB0cnVlLCBzdWJ0cmVlOiB0cnVlIH0pO1xuICAgIH1cbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IG9ic2VydmVyLmRpc2Nvbm5lY3QoKSk7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoXG4gICAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICAgIHJlZnJlc2goKTtcbiAgICB9KVxuICApO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICByZWZyZXNoKCk7XG4gIH0pO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJSZWNlbnRGaWxlc0NvbG9ycyB9O1xuIiwgImNvbnN0IHsgY29sb3JGb3JGaWxlIH0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcblxuY29uc3QgQkFDS0xJTktfVklFV19UWVBFID0gXCJiYWNrbGlua1wiO1xuXG4vLyBEYXMgQmFja2xpbmtzLVBhbmUgKFNlaXRlbmxlaXN0ZSkgcmVuZGVydCBUcmVmZmVyIGludGVybiBcdTAwRkNiZXIgZGllc2VsYmVcbi8vIFNlYXJjaFJlc3VsdERvbS1LbGFzc2Ugd2llIGRpZSBTdWNoZS4gVmVybGlua3RlIHVuZCBuaWNodCB2ZXJsaW5rdGVcbi8vIEVyd1x1MDBFNGhudW5nZW4gbGllZ2VuIGFscyB6d2VpIHJlc3VsdERvbUxvb2t1cC1NYXBzIGltIEJhY2tsaW5rUmVuZGVyZXJcbi8vICh2aWV3LmJhY2tsaW5rKSAtIEZlbGRuYW1lbiBzaW5kIG5pY2h0IG9mZml6aWVsbCBkb2t1bWVudGllcnQsIGRhaGVyXG4vLyBtZWhyZXJlIGJla2FubnRlIFBmYWRlIHByb2JpZXJlbiBzdGF0dCBlaW5lbiBmZXN0IGFuenVuZWhtZW4uXG5mdW5jdGlvbiBnZXRSZXN1bHREb21Mb29rdXBzKHZpZXcpIHtcbiAgY29uc3QgcmVuZGVyZXIgPSB2aWV3Py5iYWNrbGluaztcbiAgY29uc3QgY2FuZGlkYXRlcyA9IFtyZW5kZXJlcj8uYmFja2xpbmtEb20sIHJlbmRlcmVyPy51bmxpbmtlZERvbSwgdmlldz8uYmFja2xpbmtEb20sIHZpZXc/LnVubGlua2VkRG9tLCB2aWV3Py5kb21dO1xuXG4gIGNvbnN0IGxvb2t1cHMgPSBbXTtcbiAgZm9yIChjb25zdCBkb20gb2YgY2FuZGlkYXRlcykge1xuICAgIGlmIChkb20/LnJlc3VsdERvbUxvb2t1cCBpbnN0YW5jZW9mIE1hcCkgbG9va3Vwcy5wdXNoKGRvbS5yZXN1bHREb21Mb29rdXApO1xuICB9XG4gIHJldHVybiBsb29rdXBzO1xufVxuXG5mdW5jdGlvbiBjb2xvclRpdGxlRWwocGx1Z2luLCBlbCwgZmlsZSkge1xuICBjb25zdCBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmJhY2tsaW5rcyA/IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIFwiYmFja2xpbmtzXCIpIDogbnVsbDtcbiAgaWYgKGNvbG9yKSBlbC5zdHlsZS5jb2xvciA9IGNvbG9yO1xuICBlbHNlIGVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiY29sb3JcIik7XG59XG5cbmZ1bmN0aW9uIGFwcGx5QmFja2xpbmtQYW5lQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEJBQ0tMSU5LX1ZJRVdfVFlQRSkpIHtcbiAgICBmb3IgKGNvbnN0IGxvb2t1cCBvZiBnZXRSZXN1bHREb21Mb29rdXBzKGxlYWYudmlldykpIHtcbiAgICAgIGZvciAoY29uc3QgW2ZpbGUsIHJlc3VsdERvbV0gb2YgbG9va3VwKSB7XG4gICAgICAgIGNvbnN0IHRpdGxlRWwgPSByZXN1bHREb20uZWw/LnF1ZXJ5U2VsZWN0b3IoXCIuc2VhcmNoLXJlc3VsdC1maWxlLXRpdGxlIC50cmVlLWl0ZW0taW5uZXJcIik7XG4gICAgICAgIGlmICh0aXRsZUVsKSBjb2xvclRpdGxlRWwocGx1Z2luLCB0aXRsZUVsLCBmaWxlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuLy8gXCJCYWNrbGlua3MgaW0gRG9rdW1lbnRcIiBpc3Qga2VpbmUgZWlnZW5lIEFuc2ljaHQva2VpbiBlaWdlbmVyIExlYWYsIHNvbmRlcm5cbi8vIHVudGVuIGluIGRpZSBNYXJrZG93blZpZXcgZWluZ2ViZXR0ZXQgKC5lbWJlZGRlZC1iYWNrbGlua3MpIC0gaGllciByZWljaHRcbi8vIGtlaW4gTGVhZi1UeXAsIHN0YXR0ZGVzc2VuIFx1MDBGQ2JlciBvZmZlbmUgTWFya2Rvd24tTGVhdmVzIG5hY2ggZGVyIERPTS1LbGFzc2Vcbi8vIHN1Y2hlbi4gT2huZSBkYXRhLXBhdGggamUgWmVpbGUgd2lyZCBkaWUgRGF0ZWkgXHUwMEZDYmVyIGRlbiBhbmdlemVpZ3RlblxuLy8gRGF0ZWluYW1lbiAoTGlua3RleHQpIGF1ZmdlbFx1MDBGNnN0LCB3aWUgT2JzaWRpYW4gaW50ZXJuIExpbmtzIGF1ZmxcdTAwRjZzdC5cbmZ1bmN0aW9uIGFwcGx5RW1iZWRkZWRCYWNrbGlua0NvbG9ycyhwbHVnaW4pIHtcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpKSB7XG4gICAgY29uc3QgcGFuZUVsID0gbGVhZi52aWV3LmNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3IoXCIuZW1iZWRkZWQtYmFja2xpbmtzIC5iYWNrbGluay1wYW5lXCIpO1xuICAgIGlmICghcGFuZUVsKSBjb250aW51ZTtcblxuICAgIGNvbnN0IHNvdXJjZVBhdGggPSBsZWFmLnZpZXcuZmlsZT8ucGF0aCA/PyBcIlwiO1xuICAgIGNvbnN0IHRpdGxlRWxzID0gcGFuZUVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIuc2VhcmNoLXJlc3VsdC1maWxlLXRpdGxlIC50cmVlLWl0ZW0taW5uZXJcIik7XG4gICAgZm9yIChjb25zdCB0aXRsZUVsIG9mIHRpdGxlRWxzKSB7XG4gICAgICBjb25zdCBiYXNlbmFtZSA9IHRpdGxlRWwudGV4dENvbnRlbnQ7XG4gICAgICBjb25zdCBmaWxlID0gYmFzZW5hbWUgPyBwbHVnaW4uYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0Rmlyc3RMaW5rcGF0aERlc3QoYmFzZW5hbWUsIHNvdXJjZVBhdGgpIDogbnVsbDtcbiAgICAgIGNvbG9yVGl0bGVFbChwbHVnaW4sIHRpdGxlRWwsIGZpbGUpO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBhcHBseUJhY2tsaW5rQ29sb3JzKHBsdWdpbikge1xuICBhcHBseUJhY2tsaW5rUGFuZUNvbG9ycyhwbHVnaW4pO1xuICBhcHBseUVtYmVkZGVkQmFja2xpbmtDb2xvcnMocGx1Z2luKTtcbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJCYWNrbGlua0NvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5QmFja2xpbmtDb2xvcnMocGx1Z2luKTtcblxuICAvLyBOdXIgZGFzIChrbGVpbmUpIEJhY2tsaW5rcy1QYW5lIGluIGRlciBTZWl0ZW5sZWlzdGUgcGVyIE11dGF0aW9uT2JzZXJ2ZXJcbiAgLy8gYmVvYmFjaHRlbiAtIE5JQ0hUIGRpZSBNYXJrZG93blZpZXctQ29udGFpbmVyLCBkYSBkZXJlbiBFZGl0b3ItU3VidHJlZSBiZWlcbiAgLy8gamVkZW0gVGFzdGVuZHJ1Y2sgdmllbGUgTXV0YXRpb25lbiBlcnpldWd0IChzaWVoZSBXYXJudW5nIGluXG4gIC8vIGRhdGFiYXNlLWZvbGRlcnMuanM6IGVpbiBzdWJ0cmVlLU9ic2VydmVyIFx1MDBGQ2JlciBlaW5lbiBFZGl0b3ItbmFoZW4gQ29udGFpbmVyXG4gIC8vIGhhdCBkaWVzZXMgVmF1bHQgc2Nob24gZWlubWFsIGtvbXBsZXR0IGVpbmdlZnJvcmVuKS4gRGllIGVpbmdlYmV0dGV0ZW5cbiAgLy8gQmFja2xpbmtzIGltIERva3VtZW50IGJyYXVjaGVuIGRhZlx1MDBGQ3Iga2VpbmVuIGVpZ2VuZW4gT2JzZXJ2ZXI6IHNpZSBcdTAwRTRuZGVyblxuICAvLyBzaWNoIG51ciwgd2VubiBpcmdlbmR3byBpbSBWYXVsdCBMaW5rcyBoaW56dWtvbW1lbi93ZWdmYWxsZW4gb2RlciBiZWltXG4gIC8vIFx1MDBENmZmbmVuL1dlY2hzZWxuIGVpbmVyIE5vdGl6IC0gYmVpZGVzIGlzdCBcdTAwRkNiZXIgZGllIEV2ZW50cyB1bnRlbiBiZXJlaXRzXG4gIC8vIGFiZ2VkZWNrdCAoXCJyZXNvbHZlZFwiIG5hY2ggamVkZXIgTGluay1BdWZsXHUwMEY2c3VuZywgbGF5b3V0LWNoYW5nZS9cbiAgLy8gYWN0aXZlLWxlYWYtY2hhbmdlIGxcdTAwRjZzZW4gb2huZWhpbiBhcHBseUJhY2tsaW5rQ29sb3JzKCkgdW5kIGRhbWl0IGF1Y2hcbiAgLy8gYXBwbHlFbWJlZGRlZEJhY2tsaW5rQ29sb3JzKCkgYXVzKS5cbiAgY29uc3Qgb2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcihyZWZyZXNoKTtcbiAgY29uc3Qgb2JzZXJ2ZUxlYXZlcyA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEJBQ0tMSU5LX1ZJRVdfVFlQRSkpIHtcbiAgICAgIG9ic2VydmVyLm9ic2VydmUobGVhZi52aWV3LmNvbnRhaW5lckVsLCB7IGNoaWxkTGlzdDogdHJ1ZSwgc3VidHJlZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiBvYnNlcnZlci5kaXNjb25uZWN0KCkpO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIC8vIE51ciBkZXIgZWluZ2ViZXR0ZXRlIFRlaWwgaFx1MDBFNG5ndCAobWFuZ2VscyBlaWdlbmVtIE9ic2VydmVyLCBzaWVoZSBvYmVuKVxuICAvLyB3ZWl0ZXJoaW4gYW4gZGVyIExpbmstQXVmbFx1MDBGNnN1bmcgLSBkaWUgU2VpdGVubGVpc3RlIGRlY2t0IGlociBPYnNlcnZlciBhYi5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC5tZXRhZGF0YUNhY2hlLm9uKFwicmVzb2x2ZWRcIiwgKCkgPT4gYXBwbHlFbWJlZGRlZEJhY2tsaW5rQ29sb3JzKHBsdWdpbikpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoXG4gICAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICAgIHJlZnJlc2goKTtcbiAgICB9KVxuICApO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImFjdGl2ZS1sZWFmLWNoYW5nZVwiLCByZWZyZXNoKSk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgIHJlZnJlc2goKTtcbiAgfSk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckJhY2tsaW5rQ29sb3JzIH07XG4iLCAiY29uc3QgeyBjb2xvckZvckZpbGUgfSA9IHJlcXVpcmUoXCIuL3R5cGUtY29sb3JzXCIpO1xuXG5jb25zdCBCT09LTUFSS1NfVklFV19UWVBFID0gXCJib29rbWFya3NcIjtcbmNvbnN0IEJPT0tNQVJLU19QTFVHSU5fSUQgPSBcImJvb2ttYXJrc1wiO1xuXG4vLyBCb29rbWFyay1aZWlsZW4gdHJhZ2VuIGtlaW4gZGF0YS1wYXRoLUF0dHJpYnV0LiBEZXIgVmlldyBoXHUwMEU0bHQgYWJlciBpbnRlcm5cbi8vIGVpbmUgV2Vha01hcCAodmlldy5pdGVtRG9tczogQm9va21hcmstSXRlbSAtPiBUcmVlLUl0ZW0tRG9tIG1pdCAudGl0bGVFbCkgLVxuLy8gZGFyXHUwMEZDYmVyIGxcdTAwRTRzc3Qgc2ljaCBqZWRlcyBJdGVtIGdlemllbHQgc2VpbmVyIFplaWxlIHp1b3JkbmVuLCBvaG5lIGRpZSAobmljaHRcbi8vIGl0ZXJpZXJiYXJlKSBXZWFrTWFwIHNlbGJzdCBkdXJjaGxhdWZlbiB6dSBtXHUwMEZDc3Nlbjogc3RhdHRkZXNzZW4gcmVrdXJzaXYgXHUwMEZDYmVyXG4vLyBkZW4gSXRlbS1CYXVtIGRlcyBCb29rbWFya3MtUGx1Z2lucyBzZWxic3QgbGF1ZmVuIChsaWVndCB1bmFiaFx1MDBFNG5naWcgdm9tXG4vLyBSZW5kZXItL0NvbGxhcHNlLVp1c3RhbmQgaW1tZXIgdm9sbHN0XHUwMEU0bmRpZyB2b3IpIHVuZCBqZSBJdGVtIHBlciAuZ2V0KClcbi8vIG5hY2hzY2hsYWdlbiwgb2IgKHVuZCB3bykgZXMgYWt0dWVsbCBnZXJlbmRlcnQgaXN0LlxuZnVuY3Rpb24gZm9yRWFjaEZpbGVCb29rbWFyayhpdGVtcywgY2FsbGJhY2spIHtcbiAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zID8/IFtdKSB7XG4gICAgaWYgKGl0ZW0udHlwZSA9PT0gXCJmaWxlXCIpIGNhbGxiYWNrKGl0ZW0pO1xuICAgIGVsc2UgaWYgKGl0ZW0udHlwZSA9PT0gXCJncm91cFwiKSBmb3JFYWNoRmlsZUJvb2ttYXJrKGl0ZW0uaXRlbXMsIGNhbGxiYWNrKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBhcHBseUJvb2ttYXJrc0NvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgYm9va21hcmtzUGx1Z2luID0gcGx1Z2luLmFwcC5pbnRlcm5hbFBsdWdpbnMuZ2V0RW5hYmxlZFBsdWdpbkJ5SWQoQk9PS01BUktTX1BMVUdJTl9JRCk7XG4gIGlmICghYm9va21hcmtzUGx1Z2luKSByZXR1cm47XG5cbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShCT09LTUFSS1NfVklFV19UWVBFKSkge1xuICAgIGNvbnN0IGl0ZW1Eb21zID0gbGVhZi52aWV3Py5pdGVtRG9tcztcbiAgICBpZiAoIWl0ZW1Eb21zKSBjb250aW51ZTtcblxuICAgIGZvckVhY2hGaWxlQm9va21hcmsoYm9va21hcmtzUGx1Z2luLml0ZW1zLCAoaXRlbSkgPT4ge1xuICAgICAgY29uc3QgdGl0bGVFbCA9IGl0ZW1Eb21zLmdldChpdGVtKT8udGl0bGVFbDtcbiAgICAgIGlmICghdGl0bGVFbCkgcmV0dXJuO1xuXG4gICAgICBjb25zdCBmaWxlID0gcGx1Z2luLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoaXRlbS5wYXRoKTtcbiAgICAgIGNvbnN0IGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MuYm9va21hcmtzID8gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSwgXCJib29rbWFya3NcIikgOiBudWxsO1xuICAgICAgaWYgKGNvbG9yKSB0aXRsZUVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gICAgICBlbHNlIHRpdGxlRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlckJvb2ttYXJrc0NvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5Qm9va21hcmtzQ29sb3JzKHBsdWdpbik7XG5cbiAgLy8gQW5hbG9nIHp1IGZpbGUtZXhwbG9yZXItY29sb3JzLmpzOiBCb29rbWFya3MgcmVuZGVydCBaZWlsZW4gYmVpbVxuICAvLyBBdWYtL1p1a2xhcHBlbiB2b24gR3J1cHBlbiBzb3dpZSBiZWltIEhpbnp1Zlx1MDBGQ2dlbi9FbnRmZXJuZW4vVW1zb3J0aWVyZW5cbiAgLy8gZHluYW1pc2NoIG5ldS5cbiAgY29uc3Qgb2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcihyZWZyZXNoKTtcbiAgY29uc3Qgb2JzZXJ2ZUxlYXZlcyA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEJPT0tNQVJLU19WSUVXX1RZUEUpKSB7XG4gICAgICBvYnNlcnZlci5vYnNlcnZlKGxlYWYudmlldy5jb250YWluZXJFbCwgeyBjaGlsZExpc3Q6IHRydWUsIHN1YnRyZWU6IHRydWUgfSk7XG4gICAgfVxuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4gb2JzZXJ2ZXIuZGlzY29ubmVjdCgpKTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgICAgcmVmcmVzaCgpO1xuICAgIH0pXG4gICk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgIHJlZnJlc2goKTtcbiAgfSk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckJvb2ttYXJrc0NvbG9ycyB9O1xuIiwgImNvbnN0IHsgVEZpbGUgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgY29sb3JGb3JGaWxlLCBzdWJ0eXBlQ29sb3IsIHN1YnR5cGVIYXNPd25Db2xvciB9ID0gcmVxdWlyZShcIi4vdHlwZS1jb2xvcnNcIik7XG5jb25zdCB7IGdldFN1YnR5cGUgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cGVzXCIpO1xuXG5jb25zdCBET1RfQ0xBU1MgPSBcImZyZWQtdHlwLXRpdGxlLWRvdFwiO1xuY29uc3QgRE9UX0hPTExPV19DTEFTUyA9IFwiZnJlZC10eXAtdGl0bGUtZG90LWhvbGxvd1wiO1xuLy8gV2llIERFRkFVTFRfVFlQRV9DT0xPUiBpbiB0eXAtdmlldy5qcyAoRmFyYmUgZWluZXMgVFlQcyBvaG5lIGVpZ2VuZSBGYXJiZSkuXG5jb25zdCBERUZBVUxUX0RPVF9DT0xPUiA9IFwiIzg4ODg4OFwiO1xuY29uc3QgQkFER0VfQ0xBU1MgPSBcImZyZWQtdHlwLXRpdGxlLWJhZGdlXCI7XG5jb25zdCBCQURHRV9QTEFJTl9DTEFTUyA9IFwiZnJlZC10eXAtdGl0bGUtYmFkZ2UtcGxhaW5cIjtcbmNvbnN0IENPTE9SX1ZBUiA9IFwiLS1mcmVkLXR5cC10aXRsZS1jb2xvclwiO1xuXG5jb25zdCBCTE9DS19CQURHRV9DTEFTUyA9IFwiZnJlZC10eXAtYmxvY2stYmFkZ2VcIjtcbmNvbnN0IEJMT0NLX0JBREdFX1BMQUlOX0NMQVNTID0gXCJmcmVkLXR5cC1ibG9jay1iYWRnZS1wbGFpblwiO1xuY29uc3QgQkxPQ0tfQUxJR05fVE9QX0NMQVNTID0gXCJmcmVkLXR5cC1ibG9jay1iYWRnZS10b3BcIjtcbmNvbnN0IEJMT0NLX0FMSUdOX0JPVFRPTV9DTEFTUyA9IFwiZnJlZC10eXAtYmxvY2stYmFkZ2UtYm90dG9tXCI7XG5jb25zdCBCTE9DS19DT0xPUl9WQVIgPSBcIi0tZnJlZC10eXAtYmxvY2stY29sb3JcIjtcblxuLy8gbm90ZVRpdGxlU3R5bGU6IFwibm9uZVwiIHwgXCJkb3RcIiB8IFwiYmFkZ2VcIi4gQmVpIFwiYmFkZ2VcIiBiZXN0aW1tZW4gendlaVxuLy8gd2VpdGVyZSBFaW5zdGVsbHVuZ2VuIEZhcmJlIChub3RlVGl0bGVCYWRnZUNvbG9yZWQpIHVuZCBQb3NpdGlvblxuLy8gKG5vdGVUaXRsZUJhZGdlUG9zaXRpb246IFwidGl0bGVcIiB8IFwiYmxvY2tcIikgLSBzaWVoZSBzZXR0aW5ncy5qcywgZG9ydCBudXJcbi8vIGJlaSBcImJhZGdlXCIgXHUwMEZDYmVyaGF1cHQgYW5nZXplaWd0IChwcm9ncmVzc2l2ZSBPZmZlbmxlZ3VuZykuIFwiZG90XCIgc2l0enRcbi8vIGltbWVyIGFtIFRpdGVsLCBcImJhZGdlXCIgamUgbmFjaCBQb3NpdGlvbiBlbnR3ZWRlciBhbSBUaXRlbCBvZGVyIGFtXG4vLyBQcm9wZXJ0eS1CbG9jayAoZG9ydCB6dXNcdTAwRTR0emxpY2ggcGVyIG5vdGVUaXRsZVZlcnRpY2FsQWxpZ24gb2Jlbi91bnRlbikuXG4vLyBjb2xvclZpZXdzLm5vdGVUaXRsZUNvbG9yIChUaXRlbHRleHQgc2VsYnN0IGVpbmZcdTAwRTRyYmVuKSBpc3QgZGF2b24gdW5hYmhcdTAwRTRuZ2lnXG4vLyB1bmQgYmVsaWViaWcga29tYmluaWVyYmFyLlxuZnVuY3Rpb24gcmVzb2x2ZU1hcmtlcihwbHVnaW4sIGZpbGUpIHtcbiAgY29uc3Qgc3R5bGUgPSBwbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlU3R5bGU7XG4gIGlmIChzdHlsZSA9PT0gXCJub25lXCIpIHJldHVybiB7IGtpbmQ6IFwibm9uZVwiIH07XG4gIGlmIChzdHlsZSA9PT0gXCJkb3RcIikgcmV0dXJuIHsga2luZDogXCJkb3RcIiwgLi4ucmVzb2x2ZURvdChwbHVnaW4sIGZpbGUpIH07XG5cbiAgLy8gc3R5bGUgPT09IFwiYmFkZ2VcIiAtIGZhcmJpZyBiZWkgZWluZW0gcmVnaXN0cmllcnRlbiBUWVAgb2huZSBlaWdlbmUgRmFyYmVcbiAgLy8gaW4gZGVyIGdyYXVlbiBTdGFuZGFyZGZhcmJlICh3aWUgZGVyIFJpbmcgdm9uIHJlc29sdmVEb3QpOyBlaW4gbmljaHRcbiAgLy8gcmVnaXN0cmllcnRlciBUWVAgYmVrb21tdCBmYXJiaWcga2VpbmUgQm94LCB3aWUgYXVjaCBrZWluZW4gUHVua3QuXG4gIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHBsdWdpbjtcbiAgY29uc3QgdHlwZSA9IHBsdWdpbi50eXBJbmRleC50eXBlT2YoZmlsZSk7XG4gIGlmICghdHlwZSkgcmV0dXJuIHsga2luZDogXCJub25lXCIgfTtcbiAgY29uc3QgY29sb3JlZCA9IHNldHRpbmdzLm5vdGVUaXRsZUJhZGdlQ29sb3JlZDtcbiAgaWYgKGNvbG9yZWQgJiYgIXNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV0gJiYgIXNldHRpbmdzLnR5cGVzLmluY2x1ZGVzKHR5cGUpKSByZXR1cm4geyBraW5kOiBcIm5vbmVcIiB9O1xuICBjb25zdCB0eXBlQ29sb3IgPSBzZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdID8/IERFRkFVTFRfRE9UX0NPTE9SO1xuXG4gIGNvbnN0IGxhYmVsID0gYmFkZ2VMYWJlbChwbHVnaW4sIGZpbGUsIHR5cGUpO1xuICBpZiAoIWxhYmVsKSByZXR1cm4geyBraW5kOiBcIm5vbmVcIiB9O1xuICBjb25zdCB7IHRleHQsIHVzZVN1YnR5cGVDb2xvciwgc3VidHlwZSB9ID0gbGFiZWw7XG4gIGNvbnN0IGNvbG9yID0gY29sb3JlZCA/ICh1c2VTdWJ0eXBlQ29sb3IgPyBzdWJ0eXBlQ29sb3Ioc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpID8/IHR5cGVDb2xvciA6IHR5cGVDb2xvcikgOiBudWxsO1xuICBjb25zdCBwb3NpdGlvbiA9IHNldHRpbmdzLm5vdGVUaXRsZUJhZGdlUG9zaXRpb247XG4gIHJldHVybiB7IGtpbmQ6IHBvc2l0aW9uID09PSBcImJsb2NrXCIgPyBcImJsb2NrLWJhZGdlXCIgOiBcInRpdGxlLWJhZGdlXCIsIGNvbG9yZWQsIGNvbG9yLCB0eXBlTmFtZTogdGV4dCB9O1xufVxuXG4vLyBCZXNjaHJpZnR1bmcgZGVyIEJveCAobm90ZVRpdGxlQmFkZ2VMYWJlbCkgc2FtdCBkZXIgZGF6dSBwYXNzZW5kZW4gRmFyYmU6XG4vLyBbVFlQXSBpbiBUWVAtRmFyYmUsIFtTdWJ0eXBdIGluIFN1YnR5cC1GYXJiZSAob2huZSBTdWJ0eXAga2VpbmUgQm94IC1cbi8vIGRhbm4gbnVsbCksIFtUWVAvU3VidHlwXSBqZSBuYWNoIFNjaGFsdGVyIFwiU3VidHlwLUZhcmJlXCJcbi8vIChjb2xvclZpZXdzLm5vdGVUaXRsZU1hcmtlclN1YnR5cCkuIEVpbiBuaWNodCByZWdpc3RyaWVydGVyIFNVQlRZUC1XZXJ0XG4vLyBzdGVodCBhbHMgVGV4dCBkYSwgaGF0IGFiZXIga2VpbmUgZWlnZW5lIEZhcmJlIChzdWJ0eXBlQ29sb3IgbGllZmVydCBkYW5uXG4vLyBkaWUgZGVzIFRZUHMpLlxuZnVuY3Rpb24gYmFkZ2VMYWJlbChwbHVnaW4sIGZpbGUsIHR5cGUpIHtcbiAgY29uc3QgeyBzZXR0aW5ncyB9ID0gcGx1Z2luO1xuICBjb25zdCBzdWJ0eXBlID0gcGx1Z2luLnR5cEluZGV4LnN1YnR5cGVPZihmaWxlKTtcbiAgY29uc3QgbW9kZSA9IHNldHRpbmdzLm5vdGVUaXRsZUJhZGdlTGFiZWwgPz8gXCJ0eXBlXCI7XG4gIGlmIChtb2RlID09PSBcInN1YnR5cGVcIikgcmV0dXJuIHN1YnR5cGUgPyB7IHRleHQ6IHN1YnR5cGUsIHVzZVN1YnR5cGVDb2xvcjogdHJ1ZSwgc3VidHlwZSB9IDogbnVsbDtcbiAgaWYgKCFzdWJ0eXBlIHx8IG1vZGUgPT09IFwidHlwZVwiKSByZXR1cm4geyB0ZXh0OiB0eXBlLCB1c2VTdWJ0eXBlQ29sb3I6IGZhbHNlLCBzdWJ0eXBlIH07XG4gIHJldHVybiB7IHRleHQ6IGAke3R5cGV9LyR7c3VidHlwZX1gLCB1c2VTdWJ0eXBlQ29sb3I6ICEhc2V0dGluZ3MuY29sb3JWaWV3cy5ub3RlVGl0bGVNYXJrZXJTdWJ0eXAsIHN1YnR5cGUgfTtcbn1cblxuLy8gRmFyYnB1bmt0IGFtIFRpdGVsIC0gd2llIGRpZSBGYXJicHVua3RlIGRlciBUWVAtVmlldyAoc2llaGUgcGFpbnRDb2xvckRvdFxuLy8gaW4gdHlwZS1jb2xvcnMuanMpIGJlaW0gU3RhbmRhcmR3ZXJ0IGFscyBob2hsZXIgUmluZzogZWluIHJlZ2lzdHJpZXJ0ZXIgVFlQXG4vLyBvaG5lIEZhcmJlIGdyYXUsIGVpbiBTdWJ0eXAgb2huZSBlaWdlbmUgRWluc3RlbGx1bmcgKG1pdCBkZW0gVW50ZXItU2NoYWx0ZXJcbi8vIFwiU3VidHlwXCIpIGluIGRlciBUWVAtRmFyYmUsIGRpZSBlciBcdTAwRkNiZXJuaW1tdC4gTmljaHQgcmVnaXN0cmllcnRlIFRZUGVuXG4vLyBibGVpYmVuIHdpZSBpbiBkZXIgVFlQLUxpc3RlIG9obmUgUHVua3QuXG5mdW5jdGlvbiByZXNvbHZlRG90KHBsdWdpbiwgZmlsZSkge1xuICBjb25zdCB0eXBlID0gcGx1Z2luLnR5cEluZGV4LnR5cGVPZihmaWxlKTtcbiAgaWYgKCF0eXBlKSByZXR1cm4geyBjb2xvcjogbnVsbCwgaG9sbG93OiBmYWxzZSB9O1xuICBjb25zdCB7IHNldHRpbmdzIH0gPSBwbHVnaW47XG4gIGNvbnN0IHR5cGVDb2xvciA9IHNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV07XG4gIGlmICghdHlwZUNvbG9yKSB7XG4gICAgcmV0dXJuIHNldHRpbmdzLnR5cGVzLmluY2x1ZGVzKHR5cGUpID8geyBjb2xvcjogREVGQVVMVF9ET1RfQ09MT1IsIGhvbGxvdzogdHJ1ZSB9IDogeyBjb2xvcjogbnVsbCwgaG9sbG93OiBmYWxzZSB9O1xuICB9XG4gIGNvbnN0IHN1YnR5cGUgPSBwbHVnaW4udHlwSW5kZXguc3VidHlwZU9mKGZpbGUpO1xuICBpZiAoc2V0dGluZ3MuY29sb3JWaWV3cy5ub3RlVGl0bGVNYXJrZXJTdWJ0eXAgJiYgc3VidHlwZSAmJiBnZXRTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKSkge1xuICAgIHJldHVybiB7IGNvbG9yOiBzdWJ0eXBlQ29sb3Ioc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpLCBob2xsb3c6ICFzdWJ0eXBlSGFzT3duQ29sb3Ioc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpIH07XG4gIH1cbiAgcmV0dXJuIHsgY29sb3I6IHR5cGVDb2xvciwgaG9sbG93OiBmYWxzZSB9O1xufVxuXG4vLyBUaXRlbCBkZXIgTm90aXogc2VsYnN0ICguaW5saW5lLXRpdGxlLCBzaWNodGJhciBzb2Zlcm4gT2JzaWRpYW5zIGVpZ2VuZVxuLy8gRWluc3RlbGx1bmcgXCJJbmxpbmUtVGl0ZWwgYW56ZWlnZW5cIiBha3RpdiBpc3QpLiBCZXd1c3N0IGFscyA6OmJlZm9yZVxuLy8gcmVhbGlzaWVydCAoc2llaGUgc3R5bGVzLmNzcykgc3RhdHQgYWxzIGVpZ2VuZXMgRE9NLUVsZW1lbnQgb2RlciBXcmFwcGVyOlxuLy8gLmlubGluZS10aXRsZSBoXHUwMEU0bmd0IGluIG1laHJlcmVuIFRoZW1lcyAodS4gYS4gTWluaW1hbCkgcGVyIEtpbmQtU2VsZWt0b3Jcbi8vIChcIj5cIikgZGlyZWt0IGFuIHNlaW5lbSBFbHRlcm4tQ29udGFpbmVyICh6LiBCLiBmXHUwMEZDciBtYXgtd2lkdGgvbWFyZ2luKSAtIGVpblxuLy8genVzXHUwMEU0dHpsaWNoZXMgRWxlbWVudCBkYXZvciBvZGVyIGVpbiBXcmFwcGVyIGRhcnVtIHdcdTAwRkNyZGUgZGllc2UgUmVnZWxuXG4vLyB1bnRlcndhbmRlcm4uIEZhcmJlIHVuZCBUWVAtTmFtZSBsYXNzZW4gc2ljaCBlaW5lbSA6OmJlZm9yZSBuaWNodCBkaXJla3Rcbi8vIHp1d2Vpc2VuLCBkYWhlciBkZXIgVW13ZWcgXHUwMEZDYmVyIGVpbmUgQ1NTLVZhcmlhYmxlIGJ6dy4gZWluIGRhdGEtQXR0cmlidXQsXG4vLyBkaWUgZGllIDo6YmVmb3JlLVJlZ2VsbiBhdXNsZXNlbiAodmFyKCkvYXR0cigpKS5cbmZ1bmN0aW9uIGFwcGx5U3R5bGVUb1RpdGxlKHRpdGxlRWwsIG1hcmtlcikge1xuICBjb25zdCBpc0RvdCA9IG1hcmtlci5raW5kID09PSBcImRvdFwiICYmICEhbWFya2VyLmNvbG9yO1xuICBjb25zdCBpc0JhZGdlID0gbWFya2VyLmtpbmQgPT09IFwidGl0bGUtYmFkZ2VcIjtcblxuICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoRE9UX0NMQVNTLCBpc0RvdCk7XG4gIHRpdGxlRWwuY2xhc3NMaXN0LnRvZ2dsZShET1RfSE9MTE9XX0NMQVNTLCBpc0RvdCAmJiAhIW1hcmtlci5ob2xsb3cpO1xuICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoQkFER0VfQ0xBU1MsIGlzQmFkZ2UgJiYgbWFya2VyLmNvbG9yZWQpO1xuICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoQkFER0VfUExBSU5fQ0xBU1MsIGlzQmFkZ2UgJiYgIW1hcmtlci5jb2xvcmVkKTtcblxuICBpZiAoaXNCYWRnZSkgdGl0bGVFbC5kYXRhc2V0LmZyZWRUeXAgPSBtYXJrZXIudHlwZU5hbWU7XG4gIGVsc2UgZGVsZXRlIHRpdGxlRWwuZGF0YXNldC5mcmVkVHlwO1xuXG4gIGNvbnN0IG1hcmtlckNvbG9yID0gKGlzRG90ICYmIG1hcmtlci5jb2xvcikgfHwgKGlzQmFkZ2UgJiYgbWFya2VyLmNvbG9yZWQgJiYgbWFya2VyLmNvbG9yKSA/IG1hcmtlci5jb2xvciA6IG51bGw7XG4gIGlmIChtYXJrZXJDb2xvcikgdGl0bGVFbC5zdHlsZS5zZXRQcm9wZXJ0eShDT0xPUl9WQVIsIG1hcmtlckNvbG9yKTtcbiAgZWxzZSB0aXRsZUVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KENPTE9SX1ZBUik7XG59XG5cbi8vIFByb3BlcnR5LUJsb2NrIGRlciBOb3RpeiAoLm1ldGFkYXRhLWNvbnRhaW5lcikuIERpZSBcImJsb2NrXCItUG9zaXRpb24gdm9uXG4vLyBub3RlVGl0bGVCYWRnZVBvc2l0aW9uOiBkaWVzZWxiZSBCb3ggd2llIGFtIFRpdGVsLCBhYmVyIHVtIDkwXHUwMEIwIGdlZHJlaHRcbi8vICh3cml0aW5nLW1vZGUgc3RhdHQgdHJhbnNmb3JtOnJvdGF0ZSgpIC0gZGFkdXJjaCB3XHUwMEU0Y2hzdCBkaWUgQm94IG1pdCBkZXJcbi8vIFRleHRsXHUwMEU0bmdlIGluIGRlciByaWNodGlnZW4gUmljaHR1bmcsIG9obmUgZGllIFBvc2l0aW9uaWVydW5nIHBlclxuLy8gdHJhbnNmb3JtLW9yaWdpbiB2b24gSGFuZCBuYWNocmVjaG5lbiB6dSBtXHUwMEZDc3NlbikgdW5kIGxpbmtzIGFtIFByb3BlcnR5LUJsb2NrXG4vLyBzdGF0dCBhbSBUaXRlbCB2ZXJhbmtlcnQsIG9iZW4gb2RlciB1bnRlbiAobm90ZVRpdGxlVmVydGljYWxBbGlnbikuIEJsZWlidFxuLy8gYmVpbSAoRWluLS9BdXMtKUJsZW5kZW4gZGVzIEJsb2NrcyAoc2llaGUgUHJvcGVydHktQmxvY2suY3NzKSBhdXRvbWF0aXNjaFxuLy8gbWl0IHZlcnNjaHdpbmRlbi9lcnNjaGVpbmVuLCBkYSBzaWUgYWxzIDo6YmVmb3JlIGRhcmF1ZiBzaXR6dC5cbmZ1bmN0aW9uIGFwcGx5U3R5bGVUb0Jsb2NrKHBsdWdpbiwgYmxvY2tFbCwgbWFya2VyKSB7XG4gIGNvbnN0IGlzQmxvY2tCYWRnZSA9IG1hcmtlci5raW5kID09PSBcImJsb2NrLWJhZGdlXCI7XG5cbiAgYmxvY2tFbC5jbGFzc0xpc3QudG9nZ2xlKEJMT0NLX0JBREdFX0NMQVNTLCBpc0Jsb2NrQmFkZ2UgJiYgbWFya2VyLmNvbG9yZWQpO1xuICBibG9ja0VsLmNsYXNzTGlzdC50b2dnbGUoQkxPQ0tfQkFER0VfUExBSU5fQ0xBU1MsIGlzQmxvY2tCYWRnZSAmJiAhbWFya2VyLmNvbG9yZWQpO1xuXG4gIGNvbnN0IGFsaWduID0gcGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVZlcnRpY2FsQWxpZ247XG4gIGJsb2NrRWwuY2xhc3NMaXN0LnRvZ2dsZShCTE9DS19BTElHTl9UT1BfQ0xBU1MsIGlzQmxvY2tCYWRnZSAmJiBhbGlnbiAhPT0gXCJib3R0b21cIik7XG4gIGJsb2NrRWwuY2xhc3NMaXN0LnRvZ2dsZShCTE9DS19BTElHTl9CT1RUT01fQ0xBU1MsIGlzQmxvY2tCYWRnZSAmJiBhbGlnbiA9PT0gXCJib3R0b21cIik7XG5cbiAgaWYgKGlzQmxvY2tCYWRnZSkgYmxvY2tFbC5kYXRhc2V0LmZyZWRUeXAgPSBtYXJrZXIudHlwZU5hbWU7XG4gIGVsc2UgZGVsZXRlIGJsb2NrRWwuZGF0YXNldC5mcmVkVHlwO1xuXG4gIGNvbnN0IGJsb2NrQ29sb3IgPSBpc0Jsb2NrQmFkZ2UgJiYgbWFya2VyLmNvbG9yZWQgJiYgbWFya2VyLmNvbG9yID8gbWFya2VyLmNvbG9yIDogbnVsbDtcbiAgaWYgKGJsb2NrQ29sb3IpIGJsb2NrRWwuc3R5bGUuc2V0UHJvcGVydHkoQkxPQ0tfQ09MT1JfVkFSLCBibG9ja0NvbG9yKTtcbiAgZWxzZSBibG9ja0VsLnN0eWxlLnJlbW92ZVByb3BlcnR5KEJMT0NLX0NPTE9SX1ZBUik7XG59XG5cbmZ1bmN0aW9uIGFwcGx5QWN0aXZlVGl0bGVDb2xvcnMocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xuICAgIGNvbnN0IGNvbnRhaW5lckVsID0gbGVhZi52aWV3LmNvbnRhaW5lckVsO1xuICAgIGNvbnN0IGZpbGUgPSBsZWFmLnZpZXcuZmlsZTtcbiAgICBjb25zdCB0eXBlZEZpbGUgPSBmaWxlIGluc3RhbmNlb2YgVEZpbGUgPyBmaWxlIDogbnVsbDtcbiAgICBjb25zdCBtYXJrZXIgPSByZXNvbHZlTWFya2VyKHBsdWdpbiwgdHlwZWRGaWxlKTtcblxuICAgIGNvbnN0IHRpdGxlRWwgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKFwiLmlubGluZS10aXRsZVwiKTtcbiAgICBpZiAodGl0bGVFbCkge1xuICAgICAgYXBwbHlTdHlsZVRvVGl0bGUodGl0bGVFbCwgbWFya2VyKTtcblxuICAgICAgY29uc3QgdGV4dENvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Mubm90ZVRpdGxlQ29sb3IgPyBjb2xvckZvckZpbGUocGx1Z2luLCB0eXBlZEZpbGUsIFwibm90ZVRpdGxlQ29sb3JcIikgOiBudWxsO1xuICAgICAgaWYgKHRleHRDb2xvcikgdGl0bGVFbC5zdHlsZS5jb2xvciA9IHRleHRDb2xvcjtcbiAgICAgIGVsc2UgdGl0bGVFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImNvbG9yXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IGJsb2NrRWwgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKFwiLm1ldGFkYXRhLWNvbnRhaW5lclwiKTtcbiAgICBpZiAoYmxvY2tFbCkgYXBwbHlTdHlsZVRvQmxvY2socGx1Z2luLCBibG9ja0VsLCBtYXJrZXIpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseUFjdGl2ZVRpdGxlQ29sb3JzKHBsdWdpbik7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJmaWxlLW9wZW5cIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImFjdGl2ZS1sZWFmLWNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCByZWZyZXNoKSk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeShyZWZyZXNoKTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnMgfTtcbiIsICJjb25zdCB7IGVkaXRvckluZm9GaWVsZCwgZ2V0TGlua3BhdGggfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgVmlld1BsdWdpbiwgRGVjb3JhdGlvbiB9ID0gcmVxdWlyZShcIkBjb2RlbWlycm9yL3ZpZXdcIik7XG5jb25zdCB7IFByZWMsIFJhbmdlU2V0QnVpbGRlciwgU3RhdGVFZmZlY3QgfSA9IHJlcXVpcmUoXCJAY29kZW1pcnJvci9zdGF0ZVwiKTtcbmNvbnN0IHsgc3ludGF4VHJlZSB9ID0gcmVxdWlyZShcIkBjb2RlbWlycm9yL2xhbmd1YWdlXCIpO1xuY29uc3QgeyBjb2xvckZvckZpbGUgfSA9IHJlcXVpcmUoXCIuL3R5cGUtY29sb3JzXCIpO1xuXG4vLyBMaW5rcyBpbSBOb3RpenRleHQgbmFjaCBkZW0gVFlQIGlocmVzIFppZWxzIGVpbmZcdTAwRTRyYmVuLiBPYnNpZGlhbiBmXHUwMEU0cmJ0XG4vLyBpbnRlcm5lIExpbmtzIGluIGJlaWRlbiBEYXJzdGVsbHVuZ2VuIFx1MDBGQ2JlciB2YXIoLS1saW5rLWNvbG9yKSBiencuXG4vLyB2YXIoLS1saW5rLWNvbG9yLWhvdmVyKSAoc2llaGUgYXBwLmNzczogXCIubWFya2Rvd24tcmVuZGVyZWQgLmludGVybmFsLWxpbmtcIlxuLy8gdW5kIFwiLmNtLXMtb2JzaWRpYW4gc3Bhbi5jbS1obWQtaW50ZXJuYWwtbGlua1wiKSAtIHN0YXR0IGVpZ2VuZXIgRmFyYnJlZ2VsblxuLy8gd2lyZCBkYWhlciBudXIgLS1saW5rLWNvbG9yIGplIExpbmsgXHUwMEZDYmVyc2NocmllYmVuLiAtLWxpbmstY29sb3ItaG92ZXIgYmxlaWJ0XG4vLyBiZXd1c3N0IHVuYW5nZXRhc3RldDogYmVpbSBcdTAwRENiZXJmYWhyZW4gZXJzY2hlaW50IHdpZWRlciBkaWUgbm9ybWFsZVxuLy8gTGluay1GYXJiZS4gVW50ZXJzdHJlaWNodW5nIHVuZCBUaGVtZS1BbnBhc3N1bmdlbiBibGVpYmVuIGViZW5zbyBlcmhhbHRlbi5cbi8vXG4vLyBad2VpIGdldHJlbm50ZSBXZWdlLCBkYSBzaWNoIGRpZSBEYXJzdGVsbHVuZ2VuIGdydW5kbGVnZW5kIHVudGVyc2NoZWlkZW46XG4vLyAgLSBMZXNlLU1vZHVzLCBIb3Zlci1Wb3JzY2hhdSwgZ2VyZW5kZXJ0ZSBCbFx1MDBGNmNrZSBpbiBMaXZlIFByZXZpZXcgKFRhYmVsbGVuLFxuLy8gICAgQ2FsbG91dHMpOiBlY2h0ZSA8YSBjbGFzcz1cImludGVybmFsLWxpbmtcIiBkYXRhLWhyZWY9XCJcdTIwMjZcIj4tRWxlbWVudGUgYXVzXG4vLyAgICBPYnNpZGlhbnMgTWFya2Rvd24tUmVuZGVyZXIgLT4gTWFya2Rvd25Qb3N0UHJvY2Vzc29yLCBqZSBMaW5rIGVpbm1hbGlnXG4vLyAgICBiZWltIFJlbmRlcm4uXG4vLyAgLSBMaXZlIFByZXZpZXcvUXVlbGx0ZXh0LU1vZHVzOiBkb3J0IGdpYnQgZXMga2VpbmUgTGluay1FbGVtZW50ZSBtaXRcbi8vICAgIFppZWxhdHRyaWJ1dCwgbnVyIENvZGVNaXJyb3ItU3BhbnMgKFwiLmNtLWhtZC1pbnRlcm5hbC1saW5rXCIpIFx1MDBGQ2JlciBkZW1cbi8vICAgIFJvaHRleHQgLT4gZWlnZW5lciBWaWV3UGx1Z2luLCBkZXIgbnVyIGRlbiBzaWNodGJhcmVuIEJlcmVpY2ggYmV0cmFjaHRldC5cbi8vXG4vLyBOZXUgZWluZ2VmXHUwMEU0cmJ0IHdpcmQgZGFyXHUwMEZDYmVyIGhpbmF1cyBudXIgYmVpIHRhdHNcdTAwRTRjaGxpY2ggZ2VcdTAwRTRuZGVydGVtIFRZUFxuLy8gKHR5cEluZGV4IFwiY2hhbmdlXCIpIG9kZXIgZ2VcdTAwRTRuZGVydGVyIEVpbnN0ZWxsdW5nIC0gbmljaHQgYmVpIGplZGVtIFNwZWljaGVybi5cblxuY29uc3QgQ09MT1JfVkFSID0gXCItLWxpbmstY29sb3JcIjtcbmNvbnN0IFNPVVJDRV9BVFRSID0gXCJkYXRhLWZyZWQtdHlwLXNyY1wiO1xuXG4vLyBbW1ppZWxdXSwgW1taaWVsfEFsaWFzXV0sIFtbWmllbCNcdTAwRENiZXJzY2hyaWZ0XV0gLSBFaW5iZXR0dW5nZW4gKCFbW1x1MjAyNl1dKVxuLy8gYmxlaWJlbiBhdVx1MDBERmVuIHZvciwgZGllIHNpbmQga2VpbmUgTGlua3MgaW0gZWlnZW50bGljaGVuIFNpbm4uIEluIFRhYmVsbGVuXG4vLyBzdGVodCBkaWUgQWxpYXMtUGlwZSBlc2NhcGVkIChcIlxcfFwiKS5cbmNvbnN0IFdJS0lMSU5LX1BBVFRFUk4gPSAvKD88ISEpXFxbXFxbKFteW1xcXV0rPylcXF1cXF0vZztcblxuZnVuY3Rpb24gY29sb3JGb3JMaW5rdGV4dChwbHVnaW4sIGxpbmt0ZXh0LCBzb3VyY2VQYXRoKSB7XG4gIGNvbnN0IHRhcmdldCA9IGxpbmt0ZXh0LnNwbGl0KC9cXFxcP1xcfC8pWzBdLnRyaW0oKTtcbiAgY29uc3QgbGlua3BhdGggPSBnZXRMaW5rcGF0aCh0YXJnZXQpO1xuICBpZiAoIWxpbmtwYXRoKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgZmlsZSA9IHBsdWdpbi5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaXJzdExpbmtwYXRoRGVzdChsaW5rcGF0aCwgc291cmNlUGF0aCk7XG4gIHJldHVybiBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCBcImxpbmtzXCIpO1xufVxuXG4vLyAtLS0gTGVzZS1Nb2R1cyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZnVuY3Rpb24gYXBwbHlUb0FuY2hvcihwbHVnaW4sIGFuY2hvckVsKSB7XG4gIGNvbnN0IGhyZWYgPSBhbmNob3JFbC5nZXRBdHRyaWJ1dGUoXCJkYXRhLWhyZWZcIik7XG4gIGNvbnN0IGNvbG9yID1cbiAgICBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5saW5rcyAmJiBocmVmICYmICFhbmNob3JFbC5jbGFzc0xpc3QuY29udGFpbnMoXCJpcy11bnJlc29sdmVkXCIpXG4gICAgICA/IGNvbG9yRm9yTGlua3RleHQocGx1Z2luLCBocmVmLCBhbmNob3JFbC5nZXRBdHRyaWJ1dGUoU09VUkNFX0FUVFIpID8/IFwiXCIpXG4gICAgICA6IG51bGw7XG4gIGlmIChjb2xvcikgYW5jaG9yRWwuc3R5bGUuc2V0UHJvcGVydHkoQ09MT1JfVkFSLCBjb2xvcik7XG4gIGVsc2UgYW5jaG9yRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoQ09MT1JfVkFSKTtcbn1cblxuLy8gQmVyZWl0cyBnZXJlbmRlcnRlIExpbmtzIG5ldSBlaW5mXHUwMEU0cmJlbiAoVFlQLSBvZGVyIEVpbnN0ZWxsdW5nc1x1MDBFNG5kZXJ1bmcpLiBEZXJcbi8vIFBvc3QtUHJvY2Vzc29yIG1lcmt0IHNpY2ggZGFmXHUwMEZDciBhbiBqZWRlbSBMaW5rIGRlc3NlbiBRdWVsbG5vdGl6LCBkYSBkaWUgenVyXG4vLyBBdWZsXHUwMEY2c3VuZyBtZWhyZGV1dGlnZXIgTGlua3RleHRlIGdlYnJhdWNodCB3aXJkLiBBbGxlIEZlbnN0ZXIgKFBvcC1vdXRzKVxuLy8gXHUwMEZDYmVyIGlocmUgTGVhdmVzIGVpbmdlc2FtbWVsdC5cbmZ1bmN0aW9uIHJlZnJlc2hSZW5kZXJlZExpbmtzKHBsdWdpbikge1xuICBjb25zdCBkb2NzID0gbmV3IFNldCgpO1xuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5pdGVyYXRlQWxsTGVhdmVzKChsZWFmKSA9PiBkb2NzLmFkZChsZWFmLnZpZXcuY29udGFpbmVyRWwub3duZXJEb2N1bWVudCkpO1xuICBmb3IgKGNvbnN0IGRvYyBvZiBkb2NzKSB7XG4gICAgZm9yIChjb25zdCBhbmNob3JFbCBvZiBkb2MucXVlcnlTZWxlY3RvckFsbChgYS5pbnRlcm5hbC1saW5rWyR7U09VUkNFX0FUVFJ9XWApKSBhcHBseVRvQW5jaG9yKHBsdWdpbiwgYW5jaG9yRWwpO1xuICB9XG59XG5cbi8vIC0tLSBMaXZlIFByZXZpZXcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCByZWZyZXNoRWZmZWN0ID0gU3RhdGVFZmZlY3QuZGVmaW5lKCk7XG5cbmZ1bmN0aW9uIGJ1aWxkTGlua1ZpZXdQbHVnaW4ocGx1Z2luKSB7XG4gIGNvbnN0IGRlY29yYXRpb25zQnlDb2xvciA9IG5ldyBNYXAoKTtcbiAgY29uc3QgZGVjb3JhdGlvbkZvciA9IChjb2xvcikgPT4ge1xuICAgIGxldCBkZWNvcmF0aW9uID0gZGVjb3JhdGlvbnNCeUNvbG9yLmdldChjb2xvcik7XG4gICAgaWYgKCFkZWNvcmF0aW9uKSB7XG4gICAgICBkZWNvcmF0aW9uID0gRGVjb3JhdGlvbi5tYXJrKHtcbiAgICAgICAgY2xhc3M6IFwiZnJlZC10eXAtbGlua1wiLFxuICAgICAgICBhdHRyaWJ1dGVzOiB7IHN0eWxlOiBgJHtDT0xPUl9WQVJ9OiAke2NvbG9yfTtgIH0sXG4gICAgICB9KTtcbiAgICAgIGRlY29yYXRpb25zQnlDb2xvci5zZXQoY29sb3IsIGRlY29yYXRpb24pO1xuICAgIH1cbiAgICByZXR1cm4gZGVjb3JhdGlvbjtcbiAgfTtcblxuICBjb25zdCBidWlsZCA9ICh2aWV3KSA9PiB7XG4gICAgaWYgKCFwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5saW5rcykgcmV0dXJuIERlY29yYXRpb24ubm9uZTtcbiAgICBjb25zdCBzb3VyY2VQYXRoID0gdmlldy5zdGF0ZS5maWVsZChlZGl0b3JJbmZvRmllbGQsIGZhbHNlKT8uZmlsZT8ucGF0aCA/PyBcIlwiO1xuICAgIGNvbnN0IHRyZWUgPSBzeW50YXhUcmVlKHZpZXcuc3RhdGUpO1xuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgUmFuZ2VTZXRCdWlsZGVyKCk7XG5cbiAgICBmb3IgKGNvbnN0IHsgZnJvbSwgdG8gfSBvZiB2aWV3LnZpc2libGVSYW5nZXMpIHtcbiAgICAgIGNvbnN0IHRleHQgPSB2aWV3LnN0YXRlLnNsaWNlRG9jKGZyb20sIHRvKTtcbiAgICAgIFdJS0lMSU5LX1BBVFRFUk4ubGFzdEluZGV4ID0gMDtcbiAgICAgIGZvciAobGV0IG1hdGNoOyAobWF0Y2ggPSBXSUtJTElOS19QQVRURVJOLmV4ZWModGV4dCkpOyApIHtcbiAgICAgICAgY29uc3Qgc3RhcnQgPSBmcm9tICsgbWF0Y2guaW5kZXg7XG4gICAgICAgIC8vIE51ciwgd2FzIE9ic2lkaWFucyBNYXJrZG93bi1QYXJzZXIgc2VsYnN0IGFscyBpbnRlcm5lbiBMaW5rIGVya2VubnQgLVxuICAgICAgICAvLyBzY2hsaWVcdTAwREZ0IHouIEIuIFtbXHUyMDI2XV0gaW4gQ29kZS1CbFx1MDBGNmNrZW4gb2RlciBJbmxpbmUtQ29kZSBhdXMuXG4gICAgICAgIGlmICghdHJlZS5yZXNvbHZlSW5uZXIoc3RhcnQgKyAyLCAxKS5uYW1lLmluY2x1ZGVzKFwiaG1kLWludGVybmFsLWxpbmtcIikpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBjb2xvciA9IGNvbG9yRm9yTGlua3RleHQocGx1Z2luLCBtYXRjaFsxXSwgc291cmNlUGF0aCk7XG4gICAgICAgIGlmIChjb2xvcikgYnVpbGRlci5hZGQoc3RhcnQsIHN0YXJ0ICsgbWF0Y2hbMF0ubGVuZ3RoLCBkZWNvcmF0aW9uRm9yKGNvbG9yKSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBidWlsZGVyLmZpbmlzaCgpO1xuICB9O1xuXG4gIHJldHVybiBWaWV3UGx1Z2luLmZyb21DbGFzcyhcbiAgICBjbGFzcyB7XG4gICAgICBjb25zdHJ1Y3Rvcih2aWV3KSB7XG4gICAgICAgIHRoaXMuZGVjb3JhdGlvbnMgPSBidWlsZCh2aWV3KTtcbiAgICAgIH1cblxuICAgICAgLy8gRGVyIFBhcnNlciBhcmJlaXRldCBkZW4gc2ljaHRiYXJlbiBCZXJlaWNoIGdnZi4gZXJzdCBuYWNoIHVuZCBuYWNoIGFiIC1cbiAgICAgIC8vIGVpbiBuZXVlciBTeW50YXhiYXVtIHpcdTAwRTRobHQgZGFoZXIgZWJlbmZhbGxzIGFscyBBbmxhc3MgenVtIE5ldWF1ZmJhdS5cbiAgICAgIHVwZGF0ZSh1cGRhdGUpIHtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIHVwZGF0ZS5kb2NDaGFuZ2VkIHx8XG4gICAgICAgICAgdXBkYXRlLnZpZXdwb3J0Q2hhbmdlZCB8fFxuICAgICAgICAgIHN5bnRheFRyZWUodXBkYXRlLnN0YXJ0U3RhdGUpICE9PSBzeW50YXhUcmVlKHVwZGF0ZS5zdGF0ZSkgfHxcbiAgICAgICAgICB1cGRhdGUudHJhbnNhY3Rpb25zLnNvbWUoKHRyKSA9PiB0ci5lZmZlY3RzLnNvbWUoKGVmZmVjdCkgPT4gZWZmZWN0LmlzKHJlZnJlc2hFZmZlY3QpKSlcbiAgICAgICAgKSB7XG4gICAgICAgICAgdGhpcy5kZWNvcmF0aW9ucyA9IGJ1aWxkKHVwZGF0ZS52aWV3KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0sXG4gICAgeyBkZWNvcmF0aW9uczogKHZhbHVlKSA9PiB2YWx1ZS5kZWNvcmF0aW9ucyB9XG4gICk7XG59XG5cbmZ1bmN0aW9uIHJlZnJlc2hFZGl0b3JzKHBsdWdpbikge1xuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5pdGVyYXRlQWxsTGVhdmVzKChsZWFmKSA9PiB7XG4gICAgbGVhZi52aWV3Py5lZGl0b3I/LmNtPy5kaXNwYXRjaCh7IGVmZmVjdHM6IHJlZnJlc2hFZmZlY3Qub2YobnVsbCkgfSk7XG4gIH0pO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZnVuY3Rpb24gcmVnaXN0ZXJMaW5rQ29sb3JzKHBsdWdpbikge1xuICBwbHVnaW4ucmVnaXN0ZXJNYXJrZG93blBvc3RQcm9jZXNzb3IoKGVsLCBjdHgpID0+IHtcbiAgICAvLyBRdWVsbGUgaW1tZXIgdmVybWVya2VuLCBhdWNoIGJlaSBhdXNnZXNjaGFsdGV0ZXIgRWluZlx1MDBFNHJidW5nIC0gc28gZ3JlaWZ0XG4gICAgLy8gZWluIHNwXHUwMEU0dGVyZXMgRWluc2NoYWx0ZW4gYXVjaCBmXHUwMEZDciBiZXJlaXRzIGdlcmVuZGVydGUgTGlua3MuXG4gICAgZm9yIChjb25zdCBhbmNob3JFbCBvZiBlbC5xdWVyeVNlbGVjdG9yQWxsKFwiYS5pbnRlcm5hbC1saW5rXCIpKSB7XG4gICAgICBhbmNob3JFbC5zZXRBdHRyaWJ1dGUoU09VUkNFX0FUVFIsIGN0eC5zb3VyY2VQYXRoKTtcbiAgICAgIGFwcGx5VG9BbmNob3IocGx1Z2luLCBhbmNob3JFbCk7XG4gICAgfVxuICB9KTtcbiAgLy8gT2JzaWRpYW5zIFN5bnRheC1TcGFuIFwiLmNtLWhtZC1pbnRlcm5hbC1saW5rXCIgbGllZ3QgdW5hYmhcdTAwRTRuZ2lnIHZvbiBkZXJcbiAgLy8gUHJpb3JpdFx1MDBFNHQgaW1tZXIgYXVcdTAwREZlbiwgZGllIE1hcmtpZXJ1bmcgYWxzbyBkYXJpbiAtIGRpZSBGYXJiZSBzZXR6dCBkYWhlclxuICAvLyBlaW5lIGVpZ2VuZSBSZWdlbCBpbiBzdHlsZXMuY3NzICguZnJlZC10eXAtbGluaykuIE5pZWRyaWdzdGUgUHJpb3JpdFx1MDBFNHQgbGVndFxuICAvLyBzaWUgaW1tZXJoaW4gdW0gXCIuY20tdW5kZXJsaW5lXCIgaGVydW0sIGRhbWl0IGRlciBnYW56ZSBMaW5rdGV4dCBlcmZhc3N0IGlzdC5cbiAgcGx1Z2luLnJlZ2lzdGVyRWRpdG9yRXh0ZW5zaW9uKFByZWMubG93ZXN0KGJ1aWxkTGlua1ZpZXdQbHVnaW4ocGx1Z2luKSkpO1xuXG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiB7XG4gICAgcmVmcmVzaFJlbmRlcmVkTGlua3MocGx1Z2luKTtcbiAgICByZWZyZXNoRWRpdG9ycyhwbHVnaW4pO1xuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICAvLyBEaWUgRWRpdG9yLURla29yYXRpb25lbiB2ZXJzY2h3aW5kZW4gYmVpbSBFbnRsYWRlbiBtaXQgZGVyIEVyd2VpdGVydW5nIHZvblxuICAvLyBzZWxic3QsIGRpZSBJbmxpbmUtVmFyaWFibGVuIGFuIGdlcmVuZGVydGVuIExpbmtzIG5pY2h0LlxuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4ge1xuICAgIHBsdWdpbi5hcHAud29ya3NwYWNlLml0ZXJhdGVBbGxMZWF2ZXMoKGxlYWYpID0+IHtcbiAgICAgIGZvciAoY29uc3QgYW5jaG9yRWwgb2YgbGVhZi52aWV3LmNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3JBbGwoYGEuaW50ZXJuYWwtbGlua1ske1NPVVJDRV9BVFRSfV1gKSkge1xuICAgICAgICBhbmNob3JFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShDT0xPUl9WQVIpO1xuICAgICAgfVxuICAgIH0pO1xuICB9KTtcbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckxpbmtDb2xvcnMgfTtcbiIsICJjb25zdCB7IGdldFN1YnR5cGVOYW1lcywgZ2V0U3VidHlwZSB9ID0gcmVxdWlyZShcIi4vc3VidHlwZXNcIik7XHJcbmNvbnN0IHsgc3VidHlwZUNvbG9yIH0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcclxuXHJcbmNvbnN0IFRZUF9QUk9QRVJUWSA9IFwiVFlQXCI7XHJcbmNvbnN0IFRZUF9WSUVXX1RZUEUgPSBcImZyZWQtdHlwLXZpZXdcIjtcclxuY29uc3QgQUxMX1BST1BFUlRJRVNfVklFV19UWVBFID0gXCJhbGwtcHJvcGVydGllc1wiO1xyXG5jb25zdCBISUdITElHSFRfQ0xBU1MgPSBcImZyZWQtdHlwLWRlZmF1bHQtcHJvcGVydHlcIjtcclxuLy8gRmxvYXRpbmcgUHJvcGVydGllcyAoc2llaGUgdHlwZUZsb2F0aW5nS2V5cyBpbiBzZXR0aW5ncy5qcykgLSBkaWVzZWxiZVxyXG4vLyBMaXN0ZSB3aWUgZGllIFx1MDBGQ2JyaWdlbiBTdGFuZGFyZC1Qcm9wZXJ0aWVzIGRlcyBUeXBzLCBhYmVyIGt1cnNpdiBzdGF0dCBmZXR0XHJcbi8vIG1hcmtpZXJ0LCBhbmFsb2cgenUgSElHSExJR0hUX0NMQVNTLlxyXG5jb25zdCBGTE9BVElOR19DTEFTUyA9IFwiZnJlZC10eXAtZmxvYXRpbmctcHJvcGVydHlcIjtcclxuXHJcbi8vIE9ic2lkaWFuIHNjaHJlaWJ0IGRhdGEtcHJvcGVydHkta2V5IGludGVybiBpbW1lciBrbGVpbiAodW5hYmhcdTAwRTRuZ2lnIHZvbiBkZXJcclxuLy8gU2NocmVpYndlaXNlIGltIFlBTUwpIC0gVmVyZ2xlaWNoIGRlc2hhbGIgZWJlbmZhbGxzIGNhc2UtaW5zZW5zaXRpdmUuIFRZUFxyXG4vLyBpc3Qga2VpbmUgZWNodGUgXCJTdGFuZGFyZFwiLVByb3BlcnR5IChpaHIgV2VydCBpc3QgaW1tZXIgZGVyIFRZUC1OYW1lXHJcbi8vIHNlbGJzdCkgLSBmYWxscyBkb2NoIG5vY2ggaXJnZW5kd28gZWluIGFsdGVyIEVpbnRyYWcgaGVydW1saWVndCwgaGllclxyXG4vLyBlYmVuZmFsbHMgaWdub3JpZXJlbiBzdGF0dCBkaWUgVFlQLVplaWxlIGZldHQgenUgbWFya2llcmVuLlxyXG5mdW5jdGlvbiByYXdLZXlzRm9yVHlwZSh0eXBlLCBkZWZhdWx0cykge1xyXG4gIGlmICghdHlwZSB8fCAhZGVmYXVsdHMpIHJldHVybiBudWxsO1xyXG4gIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyhkZWZhdWx0cykuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gXCJcIiAmJiBrZXkudG9Mb3dlckNhc2UoKSAhPT0gVFlQX1BST1BFUlRZLnRvTG93ZXJDYXNlKCkpO1xyXG4gIHJldHVybiBrZXlzLmxlbmd0aCA+IDAgPyBrZXlzLm1hcCgoa2V5KSA9PiBrZXkudG9Mb3dlckNhc2UoKSkgOiBudWxsO1xyXG59XHJcblxyXG4vLyBGcm9udG1hdHRlci1CbFx1MDBGNmNrZSBlaW5lcyBUWVBzIGFscyBMaXN0ZSB2b24geyBrZXlzLCBmbG9hdGluZyB9IChqZXdlaWxzXHJcbi8vIGxvd2VyY2FzZSk6IHp1ZXJzdCBkYXMgVFlQLUZyb250bWF0dGVyIGRlcyBUWVBzLCBkYW5hY2ggLSBmYWxsc1xyXG4vLyBnZXdcdTAwRkNuc2NodCAtIGRlciBCbG9jayBlaW5lcyBiZXN0aW1tdGVuIFN1YnR5cHMgKHN1YnR5cGUpIGJ6dy4gYWxsZXIgc2VpbmVyXHJcbi8vIFN1YnR5cGVuIChzdWJ0eXBlID09PSBBTExfU1VCVFlQRVMpLCBzaWVoZSBzdWJ0eXBlcy5qcy5cclxuY29uc3QgQUxMX1NVQlRZUEVTID0gU3ltYm9sKFwiYWxsLXN1YnR5cGVzXCIpO1xyXG5cclxuZnVuY3Rpb24gYmxvY2tPZihkZWZhdWx0cywgZmxvYXRpbmdLZXlzLCBzZWN0aW9uID0gbnVsbCkge1xyXG4gIGNvbnN0IGtleXMgPSByYXdLZXlzRm9yVHlwZSh0cnVlLCBkZWZhdWx0cykgPz8gW107XHJcbiAgcmV0dXJuIHsgc2VjdGlvbiwga2V5cywgZmxvYXRpbmc6IG5ldyBTZXQoKGZsb2F0aW5nS2V5cyA/PyBbXSkubWFwKChrZXkpID0+IGtleS50b0xvd2VyQ2FzZSgpKSkgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gYmxvY2tzRm9yVHlwZShwbHVnaW4sIHR5cGUsIHN1YnR5cGUpIHtcclxuICBjb25zdCB7IHNldHRpbmdzIH0gPSBwbHVnaW47XHJcbiAgY29uc3QgYmxvY2tzID0gW2Jsb2NrT2Yoc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXSwgc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXSwgbnVsbCldO1xyXG4gIGNvbnN0IHN1YnR5cGVOYW1lcyA9IHN1YnR5cGUgPT09IEFMTF9TVUJUWVBFUyA/IGdldFN1YnR5cGVOYW1lcyhzZXR0aW5ncywgdHlwZSkgOiBzdWJ0eXBlID8gW3N1YnR5cGVdIDogW107XHJcbiAgZm9yIChjb25zdCBuYW1lIG9mIHN1YnR5cGVOYW1lcykge1xyXG4gICAgY29uc3QgZGF0YSA9IGdldFN1YnR5cGUoc2V0dGluZ3MsIHR5cGUsIG5hbWUpO1xyXG4gICAgaWYgKGRhdGEpIGJsb2Nrcy5wdXNoKGJsb2NrT2YoZGF0YS5mcm9udG1hdHRlciwgZGF0YS5mbG9hdGluZ0tleXMsIG5hbWUpKTtcclxuICB9XHJcbiAgcmV0dXJuIGJsb2NrcztcclxufVxyXG5cclxuLy8gTGllZmVydCBnZXRyZW5udGUgU2V0cyBmXHUwMEZDciBmZXR0IGRhcnp1c3RlbGxlbmRlIChcInN0YW5kYXJkXCIpIHVuZCBrdXJzaXZcclxuLy8gZGFyenVzdGVsbGVuZGUgKFwiZmxvYXRpbmdcIikgUHJvcGVydHktTmFtZW4gKGpld2VpbHMgbG93ZXJjYXNlKSBhdXMgZGVuXHJcbi8vIFx1MDBGQ2JlcmdlYmVuZW4gQmxcdTAwRjZja2VuIC0gRmxvYXRpbmctbWFya2llcnRlIEtleXMgelx1MDBFNGhsZW4gZGFiZWkgbnVyIHp1XHJcbi8vIFwiZmxvYXRpbmdcIiwgbmllIHp1c1x1MDBFNHR6bGljaCB6dSBcInN0YW5kYXJkXCIuIEtvbW10IGVpbiBLZXkgaW4gbWVocmVyZW4gQmxcdTAwRjZja2VuXHJcbi8vIHZvciwgZ2lsdCBkaWUgTWFya2llcnVuZyBkZXMgc3BcdTAwRTR0ZXJlbiBCbG9ja3M6IGZcdTAwRkNyIGVpbmUgTm90aXogc2luZCBkYXNcclxuLy8gVFlQLUZyb250bWF0dGVyIHVuZCBkYW5hY2ggZGVyIEJsb2NrIGlocmVzIFNVQlRZUHMsIGRlciBTdWJ0eXAgZ2V3aW5udCBhbHNvXHJcbi8vIC0gZGllc2VsYmUgUmVnZWwgd2llIGJlaW0gV2VydCBpbiBnZXRUeXBlRGVmYXVsdHMgKG1haW4uanMpLlxyXG5mdW5jdGlvbiBzcGxpdEtleXMoYmxvY2tzKSB7XHJcbiAgY29uc3QgaXNGbG9hdGluZyA9IG5ldyBNYXAoKTtcclxuICBmb3IgKGNvbnN0IHsga2V5cywgZmxvYXRpbmcgfSBvZiBibG9ja3MpIHtcclxuICAgIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIGlzRmxvYXRpbmcuc2V0KGtleSwgZmxvYXRpbmcuaGFzKGtleSkpO1xyXG4gIH1cclxuICBjb25zdCBzdGFuZGFyZCA9IG5ldyBTZXQoKTtcclxuICBjb25zdCBmbG9hdGluZyA9IG5ldyBTZXQoKTtcclxuICBmb3IgKGNvbnN0IFtrZXksIGZsYWddIG9mIGlzRmxvYXRpbmcpIChmbGFnID8gZmxvYXRpbmcgOiBzdGFuZGFyZCkuYWRkKGtleSk7XHJcbiAgcmV0dXJuIHsgc3RhbmRhcmQ6IHN0YW5kYXJkLnNpemUgPiAwID8gc3RhbmRhcmQgOiBudWxsLCBmbG9hdGluZzogZmxvYXRpbmcuc2l6ZSA+IDAgPyBmbG9hdGluZyA6IG51bGwgfTtcclxufVxyXG5cclxuY29uc3QgTk9fS0VZUyA9IHsgc3RhbmRhcmQ6IG51bGwsIGZsb2F0aW5nOiBudWxsIH07XHJcblxyXG5mdW5jdGlvbiBrZXlzRm9yRmlsZShwbHVnaW4sIGZpbGUpIHtcclxuICBjb25zdCB7IGNvbG9yVmlld3MgfSA9IHBsdWdpbi5zZXR0aW5ncztcclxuICBpZiAoIWNvbG9yVmlld3MuZnJvbnRtYXR0ZXJEZWZhdWx0cykgcmV0dXJuIE5PX0tFWVM7XHJcbiAgY29uc3QgdHlwZSA9IHBsdWdpbi50eXBJbmRleC50eXBlT2YoZmlsZSk7XHJcbiAgaWYgKCF0eXBlKSByZXR1cm4gTk9fS0VZUztcclxuICBjb25zdCBzdWJ0eXBlID0gY29sb3JWaWV3cy5mcm9udG1hdHRlckRlZmF1bHRzU3VidHlwID8gcGx1Z2luLnR5cEluZGV4LnN1YnR5cGVPZihmaWxlKSA6IG51bGw7XHJcbiAgcmV0dXJuIHNwbGl0S2V5cyhibG9ja3NGb3JUeXBlKHBsdWdpbiwgdHlwZSwgc3VidHlwZSkpO1xyXG59XHJcblxyXG4vLyBFZGl0b3IgZGVyIFRZUC1EZXRhaWxhbnNpY2h0OiBqZSBCbG9jayBlaW5lIGVpZ2VuZSBFZGl0b3ItSW5zdGFueiAoc2llaGVcclxuLy8gdHlwZVN0b3JlL3N1YnR5cGVTdG9yZSBpbiB0eXBlLWZyb250bWF0dGVyLWVkaXRvci5qcyksIGRpZSBNYXJraWVydW5nIHplaWd0XHJcbi8vIGFsc28gZ2VuYXUgZGllIFN0YW5kYXJkLS9GbG9hdGluZy1Qcm9wZXJ0aWVzIGRpZXNlcyBlaW5lbiBCbG9ja3MgLVxyXG4vLyBTdWJ0eXAtQmxcdTAwRjZja2UgbnVyIG1pdCBkZW0gVW50ZXItU2NoYWx0ZXIgXCJTdWJ0eXBcIi5cclxuZnVuY3Rpb24ga2V5c0ZvclN0b3JlKHBsdWdpbiwgc3RvcmUpIHtcclxuICBjb25zdCB7IGNvbG9yVmlld3MgfSA9IHBsdWdpbi5zZXR0aW5ncztcclxuICBpZiAoIWNvbG9yVmlld3MuZnJvbnRtYXR0ZXJEZWZhdWx0cyB8fCAhc3RvcmUpIHJldHVybiBOT19LRVlTO1xyXG4gIGlmIChzdG9yZS5zdWJ0eXBlICYmICFjb2xvclZpZXdzLmZyb250bWF0dGVyRGVmYXVsdHNTdWJ0eXApIHJldHVybiBOT19LRVlTO1xyXG4gIHJldHVybiBzcGxpdEtleXMoW2Jsb2NrT2Yoc3RvcmUuZ2V0RnJvbnRtYXR0ZXIoKSwgc3RvcmUuZ2V0RmxvYXRpbmcoKSldKTtcclxufVxyXG5cclxuLy8gUHJvcGVydHktTmFtZSAobG93ZXJjYXNlKSAtPiB7IHR5cGVzLCBhbGxGbG9hdGluZyB9IFx1MDBGQ2JlciBhbGxlIFR5cGVuLCBpblxyXG4vLyBkZXJlbiBGcm9udG1hdHRlciAoZ2dmLiBpbmtsLiBpaHJlciBTdWJ0eXAtQmxcdTAwRjZja2UpIGVyIHZvcmtvbW10LiBEaWUgXCJBbGxcclxuLy8gUHJvcGVydGllc1wiLUFuc2ljaHQgaXN0IHZhdWx0LXdlaXQgdW5kIGtlbm50IGtlaW5lbiBlaW56ZWxuZW4gVFlQLUtvbnRleHQgLVxyXG4vLyBkYWhlciBoaWVyIGdsZWljaCBkaWUgdm9sbHN0XHUwMEU0bmRpZ2UgWnVvcmRudW5nIHNhbW1lbG4sIGRhbWl0XHJcbi8vIGFwcGx5VG9BbGxQcm9wZXJ0aWVzVmlldyB6d2lzY2hlbiBcImdlbmF1IGVpbiBUeXBcIiAoZWluZlx1MDBFNHJiZW4pIHVuZCBcIm1laHJlcmVcclxuLy8gVHlwZW5cIiAoZmV0dCkgdW50ZXJzY2hlaWRlbiBrYW5uLiB0eXBlcyBpc3QgTWFwKFRZUCAtPiBMaXN0ZSBkZXIgQmxcdTAwRjZja2UsXHJcbi8vIGRpZSBkZW4gS2V5IGZcdTAwRkNocmVuOyBudWxsIHN0ZWh0IGZcdTAwRkNyIGRhcyBUWVAtRnJvbnRtYXR0ZXIpIC0gZWluIEtleSBkYXJmIGluXHJcbi8vIG1laHJlcmVuIEJsXHUwMEY2Y2tlbiBlaW5lcyBUWVBzIHN0ZWhlbiwgZWluZ2VmXHUwMEU0cmJ0IHdpcmQgbnVyIGRlciBlaW5kZXV0aWdlXHJcbi8vIEZhbGwuIGFsbEZsb2F0aW5nIGlzdCB0cnVlLCB3ZW5uIGRlciBLZXkgaW4gSkVERU0gQmxvY2sgSkVERVMgVHlwcyBhbHNcclxuLy8gRmxvYXRpbmcgbWFya2llcnQgaXN0IChzb25zdCB3XHUwMEU0cmUgZGllIEt1cnNpdi1NYXJraWVydW5nIGlycmVmXHUwMEZDaHJlbmQpLlxyXG4vL1xyXG4vLyBFaWdlbmVyIFNjaGFsdGVyIChjb2xvclZpZXdzLmFsbFByb3BlcnRpZXMpLCB1bmFiaFx1MDBFNG5naWcgdm9uXHJcbi8vIGNvbG9yVmlld3MuZnJvbnRtYXR0ZXJEZWZhdWx0cy4gRWluZSBTdWJ0eXAtUHJvcGVydHkgelx1MDBFNGhsdCBmXHUwMEZDciBpaHJlbiBUWVAuXHJcbmZ1bmN0aW9uIHR5cGVzVXNpbmdLZXlNYXAocGx1Z2luKSB7XHJcbiAgY29uc3QgbWFwID0gbmV3IE1hcCgpO1xyXG4gIGNvbnN0IHsgY29sb3JWaWV3cyB9ID0gcGx1Z2luLnNldHRpbmdzO1xyXG4gIGlmICghY29sb3JWaWV3cy5hbGxQcm9wZXJ0aWVzKSByZXR1cm4gbWFwO1xyXG4gIGNvbnN0IHR5cGVzID0gbmV3IFNldChbXHJcbiAgICAuLi5PYmplY3Qua2V5cyhwbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlciksXHJcbiAgICAuLi4oY29sb3JWaWV3cy5hbGxQcm9wZXJ0aWVzU3VidHlwID8gT2JqZWN0LmtleXMocGx1Z2luLnNldHRpbmdzLnR5cGVTdWJ0eXBlcyA/PyB7fSkgOiBbXSksXHJcbiAgXSk7XHJcbiAgZm9yIChjb25zdCB0eXBlIG9mIHR5cGVzKSB7XHJcbiAgICBjb25zdCBibG9ja3MgPSBibG9ja3NGb3JUeXBlKHBsdWdpbiwgdHlwZSwgY29sb3JWaWV3cy5hbGxQcm9wZXJ0aWVzU3VidHlwID8gQUxMX1NVQlRZUEVTIDogbnVsbCk7XHJcbiAgICBmb3IgKGNvbnN0IHsgc2VjdGlvbiwga2V5cywgZmxvYXRpbmcgfSBvZiBibG9ja3MpIHtcclxuICAgICAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykge1xyXG4gICAgICAgIGlmICghbWFwLmhhcyhrZXkpKSBtYXAuc2V0KGtleSwgeyB0eXBlczogbmV3IE1hcCgpLCBhbGxGbG9hdGluZzogdHJ1ZSB9KTtcclxuICAgICAgICBjb25zdCBlbnRyeSA9IG1hcC5nZXQoa2V5KTtcclxuICAgICAgICBpZiAoIWVudHJ5LnR5cGVzLmhhcyh0eXBlKSkgZW50cnkudHlwZXMuc2V0KHR5cGUsIFtdKTtcclxuICAgICAgICBlbnRyeS50eXBlcy5nZXQodHlwZSkucHVzaChzZWN0aW9uKTtcclxuICAgICAgICBlbnRyeS5hbGxGbG9hdGluZyA9IGVudHJ5LmFsbEZsb2F0aW5nICYmIGZsb2F0aW5nLmhhcyhrZXkpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG4gIHJldHVybiBtYXA7XHJcbn1cclxuXHJcbi8vIE51ciBkYXMgTGFiZWwgKFByb3BlcnR5LUtleS1JbnB1dCkgZmV0dC9rdXJzaXYgbWFya2llcmVuLCBuaWNodCBkaWUgV2VydGUgLVxyXG4vLyBiZXRyaWZmdCBzb3dvaGwgTm90aXplbiAoRnJvbnRtYXR0ZXIgaW0gRG9rdW1lbnQgKyBcIlByb3BlcnRpZXNcIi1cclxuLy8gU2VpdGVubGVpc3RlKSBhbHMgYXVjaCBkaWUgZWlnZW5lIFRZUC1EZXRhaWxhbnNpY2h0IGRlcyBQbHVnaW5zIHNlbGJzdC5cclxuZnVuY3Rpb24gYXBwbHlUb0NvbnRhaW5lcihjb250YWluZXJFbCwgc3RhbmRhcmRLZXlzLCBmbG9hdGluZ0tleXMpIHtcclxuICBpZiAoIWNvbnRhaW5lckVsKSByZXR1cm47XHJcbiAgY29uc3Qgcm93cyA9IGNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIubWV0YWRhdGEtcHJvcGVydHlbZGF0YS1wcm9wZXJ0eS1rZXldXCIpO1xyXG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcclxuICAgIGNvbnN0IGtleUVsID0gcm93LnF1ZXJ5U2VsZWN0b3IoXCIubWV0YWRhdGEtcHJvcGVydHkta2V5LWlucHV0XCIpO1xyXG4gICAgaWYgKCFrZXlFbCkgY29udGludWU7XHJcbiAgICBjb25zdCBwcm9wZXJ0eUtleSA9IHJvdy5nZXRBdHRyaWJ1dGUoXCJkYXRhLXByb3BlcnR5LWtleVwiKTtcclxuICAgIGtleUVsLmNsYXNzTGlzdC50b2dnbGUoSElHSExJR0hUX0NMQVNTLCAhIXN0YW5kYXJkS2V5cyAmJiBzdGFuZGFyZEtleXMuaGFzKHByb3BlcnR5S2V5KSk7XHJcbiAgICBrZXlFbC5jbGFzc0xpc3QudG9nZ2xlKEZMT0FUSU5HX0NMQVNTLCAhIWZsb2F0aW5nS2V5cyAmJiBmbG9hdGluZ0tleXMuaGFzKHByb3BlcnR5S2V5KSk7XHJcbiAgfVxyXG59XHJcblxyXG4vLyBEaWUgXCJBbGwgUHJvcGVydGllc1wiLUFuc2ljaHQgcmVuZGVydCBpaHJlIFplaWxlbiBuaWNodCBcdTAwRkNiZXIgZGFzXHJcbi8vIE1ldGFkYXRhLVdpZGdldCwgc29uZGVybiBcdTAwRkNiZXIgZWlnZW5lIFRyZWUtSXRlbS1Lb21wb25lbnRlbiAoS2xhc3NlIFwiYUhcIiBpbVxyXG4vLyBnZWJhdXRlbiBhcHAuanMpLCBlcnJlaWNoYmFyIFx1MDBGQ2JlciB2aWV3LmRvbXMgKFByb3BlcnR5LU5hbWUgLT4gS29tcG9uZW50ZSkuXHJcbi8vIERlcmVuIFRpdGVsLUVsZW1lbnQgdHJcdTAwRTRndCBkaWUgS2xhc3NlIFwidHJlZS1pdGVtLWlubmVyLXRleHRcIiwgbmljaHRcclxuLy8gXCIubWV0YWRhdGEtcHJvcGVydHkta2V5LWlucHV0XCIgd2llIGltIEZyb250bWF0dGVyLVdpZGdldC5cclxuLy9cclxuLy8gTnV0enQgZ2VuYXUgZWluIFR5cCBkaWVzZSBQcm9wZXJ0eSBhbHMgU3RhbmRhcmQsIHdpcmQgZGVyIE5hbWUgaW4gZGVzc2VuXHJcbi8vIEZhcmJlIGVpbmdlZlx1MDBFNHJidCAod2llIGRlciBGYXJicHVua3QvZGllIExpc3RlIGRlcyBUeXBzKSAtIGVpbmRldXRpZyBnZW51ZyxcclxuLy8gdW0gc2llIHp1enVvcmRuZW4uIE51dHplbiBtZWhyZXJlIFR5cGVuIHNpZSwgd1x1MDBFNHJlIGVpbmUgZWluemVsbmUgRmFyYmVcclxuLy8gaXJyZWZcdTAwRkNocmVuZCwgZGFoZXIgc3RhdHRkZXNzZW4gZmV0dCAoZGllc2VsYmUgTWFya2llcnVuZyB3aWUgaW1cclxuLy8gRnJvbnRtYXR0ZXItV2lkZ2V0IGVpbmVyIE5vdGl6KS5cclxuZnVuY3Rpb24gYXBwbHlUb0FsbFByb3BlcnRpZXNWaWV3KHBsdWdpbikge1xyXG4gIGNvbnN0IHVzYWdlTWFwID0gdHlwZXNVc2luZ0tleU1hcChwbHVnaW4pO1xyXG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoQUxMX1BST1BFUlRJRVNfVklFV19UWVBFKSkge1xyXG4gICAgY29uc3QgZG9tcyA9IGxlYWYudmlldz8uZG9tcztcclxuICAgIGlmICghZG9tcykgY29udGludWU7XHJcbiAgICBmb3IgKGNvbnN0IFtrZXksIGRvbV0gb2YgT2JqZWN0LmVudHJpZXMoZG9tcykpIHtcclxuICAgICAgY29uc3QgdGl0bGVFbCA9IGRvbT8udGl0bGVFbDtcclxuICAgICAgaWYgKCF0aXRsZUVsKSBjb250aW51ZTtcclxuXHJcbiAgICAgIGNvbnN0IGVudHJ5ID0gdXNhZ2VNYXAuZ2V0KGtleS50b0xvd2VyQ2FzZSgpKTtcclxuICAgICAgY29uc3QgdHlwZXMgPSBlbnRyeT8udHlwZXM7XHJcbiAgICAgIGNvbnN0IGNvdW50ID0gdHlwZXMgPyB0eXBlcy5zaXplIDogMDtcclxuICAgICAgdGl0bGVFbC5jbGFzc0xpc3QudG9nZ2xlKEhJR0hMSUdIVF9DTEFTUywgY291bnQgPiAxKTtcclxuXHJcbiAgICAgIC8vIEt1cnNpdiwgc29iYWxkIGRpZSBQcm9wZXJ0eSBcdTAwRENCRVJBTEwgYWxzIEZsb2F0aW5nIG1hcmtpZXJ0IGlzdCAtIGluXHJcbiAgICAgIC8vIGplZGVtIEJsb2NrIGplZGVzIFRZUHMsIGRlciBzaWUgZlx1MDBGQ2hydC4gQW5kZXJzIGFscyBkaWUgRmV0dC1NYXJraWVydW5nXHJcbiAgICAgIC8vIGlzdCBkYXMgbmljaHQgYXVmIFwiZ2VuYXUgZWluIFRZUFwiIGJlc2Noclx1MDBFNG5rdDogYmVpZGVzIGthbm4gYWxzb1xyXG4gICAgICAvLyB6dXNhbW1lbnRyZWZmZW4gKG1laHJlcmUgVFlQZW4sIGRvcnQgZHVyY2h3ZWcgZmxvYXRpbmcpLlxyXG4gICAgICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoRkxPQVRJTkdfQ0xBU1MsIGNvdW50ID4gMCAmJiBlbnRyeS5hbGxGbG9hdGluZyk7XHJcblxyXG4gICAgICAvLyBNaXQgXCJTdWJ0eXBcIiBpbiBkZXIgRmFyYmUgZGVzIFN1YnR5cC1CbG9ja3MsIGF1cyBkZW0gZGllIFByb3BlcnR5XHJcbiAgICAgIC8vIHN0YW1tdCAtIGFiZXIgbnVyLCB3ZW5uIHNpZSBpbiBnZW5hdSBlaW5lbSBCbG9jayBkaWVzZXMgVFlQcyBzdGVodC5cclxuICAgICAgLy8gQmVpIGVpbmVyIERvcHBsdW5nIFx1MDBGQ2JlciBtZWhyZXJlIEJsXHUwMEY2Y2tlIHdcdTAwRTRyZSBkaWUgV2FobCB3aWxsa1x1MDBGQ3JsaWNoIHVuZFxyXG4gICAgICAvLyB3XHUwMEZDcmRlIHNpY2ggYmVpbSBVbXNvcnRpZXJlbiBkZXIgQmxcdTAwRjZja2UgXHUwMEU0bmRlcm4sIGRhaGVyIGRhbm4gZGllXHJcbiAgICAgIC8vIFRZUC1GYXJiZSAoc3VidHlwZUNvbG9yIG1pdCBudWxsIGxpZWZlcnQgZ2VuYXUgZGllKS5cclxuICAgICAgaWYgKGNvdW50ID09PSAxKSB7XHJcbiAgICAgICAgY29uc3QgW1tvbmx5VHlwZSwgc2VjdGlvbnNdXSA9IHR5cGVzO1xyXG4gICAgICAgIGNvbnN0IGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MuYWxsUHJvcGVydGllc1N1YnR5cFxyXG4gICAgICAgICAgPyBzdWJ0eXBlQ29sb3IocGx1Z2luLnNldHRpbmdzLCBvbmx5VHlwZSwgc2VjdGlvbnMubGVuZ3RoID09PSAxID8gc2VjdGlvbnNbMF0gOiBudWxsKVxyXG4gICAgICAgICAgOiBwbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1tvbmx5VHlwZV07XHJcbiAgICAgICAgLy8gIWltcG9ydGFudCB2aWEgc2V0UHJvcGVydHksIGRhIGRpZSBGZXR0LVJlZ2VsIGZcdTAwRkNyIC5mcmVkLXR5cC1kZWZhdWx0LVxyXG4gICAgICAgIC8vIHByb3BlcnR5IGluIHN0eWxlcy5jc3MgZWJlbmZhbGxzICFpbXBvcnRhbnQgY29sb3Igc2V0enQgdW5kIGVpblxyXG4gICAgICAgIC8vIElubGluZS1TdHlsZSBvaG5lICFpbXBvcnRhbnQgZGFnZWdlbiB2ZXJsaWVyZW4gd1x1MDBGQ3JkZSwgZmFsbHMgZGllXHJcbiAgICAgICAgLy8gS2xhc3NlIChhdXMgZWluZW0gdm9yaGVyaWdlbiBadXN0YW5kIG1pdCBtZWhyZXJlbiBUeXBlbikgbm9jaCBkcmFuaFx1MDBFNG5ndC5cclxuICAgICAgICBpZiAoY29sb3IpIHRpdGxlRWwuc3R5bGUuc2V0UHJvcGVydHkoXCJjb2xvclwiLCBjb2xvciwgXCJpbXBvcnRhbnRcIik7XHJcbiAgICAgICAgZWxzZSB0aXRsZUVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiY29sb3JcIik7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdGl0bGVFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImNvbG9yXCIpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBhcHBseUZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodChwbHVnaW4pIHtcclxuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikpIHtcclxuICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXc7XHJcbiAgICBjb25zdCB7IHN0YW5kYXJkLCBmbG9hdGluZyB9ID0ga2V5c0ZvckZpbGUocGx1Z2luLCB2aWV3Py5maWxlKTtcclxuICAgIGFwcGx5VG9Db250YWluZXIodmlldz8ubWV0YWRhdGFFZGl0b3I/LmNvbnRhaW5lckVsLCBzdGFuZGFyZCwgZmxvYXRpbmcpO1xyXG4gIH1cclxuXHJcbiAgLy8gRGllIFwiUHJvcGVydGllc1wiLVNlaXRlbmxlaXN0ZSB6ZWlndCBpbW1lciBkaWUgYWt0aXZlIERhdGVpLCBoXHUwMEU0bHQgYWJlclxyXG4gIC8vIGtlaW5lIGVpZ2VuZSwgdmVybFx1MDBFNHNzbGljaGUgUmVmZXJlbnogZGFyYXVmIGdyaWZmYmVyZWl0IHdpZSBNYXJrZG93blZpZXcgLVxyXG4gIC8vIGRhaGVyIGF1ZiBkaWUgdm9tIFdvcmtzcGFjZSBha3R1ZWxsIGFrdGl2ZSBEYXRlaSB6dXJcdTAwRkNja2ZhbGxlbi5cclxuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwiZmlsZS1wcm9wZXJ0aWVzXCIpKSB7XHJcbiAgICBjb25zdCB2aWV3ID0gbGVhZi52aWV3O1xyXG4gICAgY29uc3QgZmlsZSA9IHZpZXc/LmZpbGUgPz8gcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xyXG4gICAgY29uc3QgeyBzdGFuZGFyZCwgZmxvYXRpbmcgfSA9IGtleXNGb3JGaWxlKHBsdWdpbiwgZmlsZSk7XHJcbiAgICBhcHBseVRvQ29udGFpbmVyKHZpZXc/Lm1ldGFkYXRhRWRpdG9yPy5jb250YWluZXJFbCwgc3RhbmRhcmQsIGZsb2F0aW5nKTtcclxuICB9XHJcblxyXG4gIC8vIFRZUC1EZXRhaWxhbnNpY2h0IGRlcyBQbHVnaW5zIHNlbGJzdDogZG9ydCB6ZWlndCBqZWRlciBFZGl0b3IgZGlyZWt0IGVpbmVuXHJcbiAgLy8gRnJvbnRtYXR0ZXItQmxvY2sgKFRZUCBiencuIFN1YnR5cCksIGVudHNwcmljaHQgYWxzbyAxOjEgZGVzc2VuXHJcbiAgLy8gXCJTdGFuZGFyZFwiLSBiencuIFwiRmxvYXRpbmdcIi1Qcm9wZXJ0aWVzICh2aWV3LmZyb250bWF0dGVyRWRpdG9ycyBrb21tdCBhdXNcclxuICAvLyB0eXAtdmlldy5qcywgZWRpdG9yLm93bmVyLmZyZWRTdG9yZSBhdXMgdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpLlxyXG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoVFlQX1ZJRVdfVFlQRSkpIHtcclxuICAgIGZvciAoY29uc3QgZWRpdG9yIG9mIGxlYWYudmlldz8uZnJvbnRtYXR0ZXJFZGl0b3JzID8/IFtdKSB7XHJcbiAgICAgIGNvbnN0IHsgc3RhbmRhcmQsIGZsb2F0aW5nIH0gPSBrZXlzRm9yU3RvcmUocGx1Z2luLCBlZGl0b3Iub3duZXI/LmZyZWRTdG9yZSk7XHJcbiAgICAgIGFwcGx5VG9Db250YWluZXIoZWRpdG9yLmNvbnRhaW5lckVsLCBzdGFuZGFyZCwgZmxvYXRpbmcpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXBwbHlUb0FsbFByb3BlcnRpZXNWaWV3KHBsdWdpbik7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlZ2lzdGVyRnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0KHBsdWdpbikge1xyXG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseUZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodChwbHVnaW4pO1xyXG5cclxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLm1ldGFkYXRhQ2FjaGUub24oXCJjaGFuZ2VkXCIsIHJlZnJlc2gpKTtcclxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLm1ldGFkYXRhQ2FjaGUub24oXCJyZXNvbHZlZFwiLCByZWZyZXNoKSk7XHJcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsIHJlZnJlc2gpKTtcclxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImFjdGl2ZS1sZWFmLWNoYW5nZVwiLCByZWZyZXNoKSk7XHJcblxyXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkocmVmcmVzaCk7XHJcblxyXG4gIHJldHVybiByZWZyZXNoO1xyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQgfTtcclxuIiwgImNvbnN0IHsgTm90aWNlIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XHJcbmNvbnN0IHsgdHlwZVN0b3JlLCBzdWJ0eXBlU3RvcmUgfSA9IHJlcXVpcmUoXCIuL3R5cGUtZnJvbnRtYXR0ZXItZWRpdG9yXCIpO1xyXG5jb25zdCB7IGdldFN1YnR5cGVOYW1lcywgaXNFbXB0eVZhbHVlIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBlc1wiKTtcclxuXHJcbmNvbnN0IFRZUF9QUk9QRVJUWSA9IFwiVFlQXCI7XHJcbmNvbnN0IFNVQlRZUF9QUk9QRVJUWSA9IFwiU1VCVFlQXCI7XHJcblxyXG4vLyBPYnNpZGlhbiBzY2hyZWlidCBQcm9wZXJ0eS1OYW1lbiBpbnRlcm4ga2xlaW4gKHNpZWhlIGZyb250bWF0dGVyLWRlZmF1bHQtXHJcbi8vIGhpZ2hsaWdodC5qcykgLSBadW9yZG51bmcgZGFoZXIgY2FzZS1pbnNlbnNpdGl2LCBkZXIgbmV1ZSBOYW1lIHdpcmQgYWJlclxyXG4vLyBleGFrdCBzbyBcdTAwRkNiZXJub21tZW4sIHdpZSBlciBlaW5nZWdlYmVuIHd1cmRlLlxyXG5mdW5jdGlvbiBzYW1lS2V5KGEsIGIpIHtcclxuICByZXR1cm4gYS50b0xvd2VyQ2FzZSgpID09PSBiLnRvTG93ZXJDYXNlKCk7XHJcbn1cclxuXHJcbi8vIEJlbmVubnQgb2xkS2V5IGluIGVpbmVtIEZyb250bWF0dGVyLUJsb2NrIChUWVAgb2RlciBTdWJ0eXAsIHNpZWhlXHJcbi8vIHR5cGVTdG9yZS9zdWJ0eXBlU3RvcmUgaW4gdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpIHVtIChSZWloZW5mb2xnZSBibGVpYnRcclxuLy8gZXJoYWx0ZW4pIHVuZCB6aWVodCBkaWUgRmxvYXRpbmctTWFya2llcnVuZyBtaXQuIEdpYnQgZXMgbmV3S2V5IGRvcnQgYmVyZWl0c1xyXG4vLyAoWnVzYW1tZW5sZWdlbiwgYW5hbG9nIHp1IE9ic2lkaWFucyBlaWdlbmVtIE1lcmdlIGluIGRlbiBOb3RpemVuKSwgYmxlaWJ0IGRlclxyXG4vLyBiZXN0ZWhlbmRlIEVpbnRyYWcgYW4gc2VpbmVyIFBvc2l0aW9uIC0gZGVyIFdlcnQgZGVzIGFsdGVuIEVpbnRyYWdzIHdpcmQgbnVyXHJcbi8vIFx1MDBGQ2Jlcm5vbW1lbiwgd2VubiBkZXIgYmVzdGVoZW5kZSBsZWVyIGlzdC4gTGllZmVydCB0cnVlIGJlaSBlaW5lciBcdTAwQzRuZGVydW5nLlxyXG5mdW5jdGlvbiByZW5hbWVJblN0b3JlKHN0b3JlLCBvbGRLZXksIG5ld0tleSkge1xyXG4gIGNvbnN0IGRlZmF1bHRzID0gc3RvcmUuZ2V0RnJvbnRtYXR0ZXIoKTtcclxuICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXMoZGVmYXVsdHMpO1xyXG4gIGNvbnN0IHNvdXJjZUtleSA9IGtleXMuZmluZCgoa2V5KSA9PiBzYW1lS2V5KGtleSwgb2xkS2V5KSk7XHJcbiAgaWYgKHNvdXJjZUtleSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7XHJcbiAgLy8gQmVpIGVpbmVyIHJlaW5lbiBcdTAwQzRuZGVydW5nIGRlciBHcm9cdTAwREYtL0tsZWluc2NocmVpYnVuZyBpc3Qgc291cmNlS2V5IHNlbGJzdFxyXG4gIC8vIGRlciBlaW56aWdlIFRyZWZmZXIgZlx1MDBGQ3IgbmV3S2V5IC0gZGFzIGlzdCBkYW5uIGtlaW4gWnVzYW1tZW5sZWdlbi5cclxuICBjb25zdCB0YXJnZXRLZXkgPSBrZXlzLmZpbmQoKGtleSkgPT4ga2V5ICE9PSBzb3VyY2VLZXkgJiYgc2FtZUtleShrZXksIG5ld0tleSkpO1xyXG4gIGlmICh0YXJnZXRLZXkgPT09IHVuZGVmaW5lZCAmJiBzb3VyY2VLZXkgPT09IG5ld0tleSkgcmV0dXJuIGZhbHNlO1xyXG5cclxuICBjb25zdCBuZXh0ID0ge307XHJcbiAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykge1xyXG4gICAgaWYgKGtleSAhPT0gc291cmNlS2V5KSB7XHJcbiAgICAgIG5leHRba2V5XSA9IGRlZmF1bHRzW2tleV07XHJcbiAgICB9IGVsc2UgaWYgKHRhcmdldEtleSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIG5leHRbbmV3S2V5XSA9IGRlZmF1bHRzW3NvdXJjZUtleV07XHJcbiAgICB9XHJcbiAgfVxyXG4gIGlmICh0YXJnZXRLZXkgIT09IHVuZGVmaW5lZCAmJiBpc0VtcHR5VmFsdWUobmV4dFt0YXJnZXRLZXldKSkgbmV4dFt0YXJnZXRLZXldID0gZGVmYXVsdHNbc291cmNlS2V5XTtcclxuICBzdG9yZS5zZXRGcm9udG1hdHRlcihuZXh0KTtcclxuXHJcbiAgY29uc3QgZmxvYXRpbmcgPSBzdG9yZS5nZXRGbG9hdGluZygpO1xyXG4gIGlmIChmbG9hdGluZy5sZW5ndGggPiAwKSB7XHJcbiAgICAvLyBCZWltIFp1c2FtbWVubGVnZW4gYmxlaWJ0IGRpZSBGbG9hdGluZy1NYXJraWVydW5nIGRlcyBaaWVscyBtYVx1MDBERmdlYmxpY2guXHJcbiAgICBzdG9yZS5zZXRGbG9hdGluZyhcclxuICAgICAgdGFyZ2V0S2V5ICE9PSB1bmRlZmluZWRcclxuICAgICAgICA/IGZsb2F0aW5nLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IHNvdXJjZUtleSlcclxuICAgICAgICA6IGZsb2F0aW5nLm1hcCgoa2V5KSA9PiAoa2V5ID09PSBzb3VyY2VLZXkgPyBuZXdLZXkgOiBrZXkpKVxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIC8vIERlciBTaG9ydGN1dCBoXHUwMEU0bmd0IGFtIEtleSAoc2llaGUgc2hvcnRjdXRzLmpzKSB1bmQgd2FuZGVydCBkZXNoYWxiIG1pdCBkZXJcclxuICAvLyBVbWJlbmVubnVuZyBtaXQgLSBiZWltIFp1c2FtbWVubGVnZW4gYmxlaWJ0LCB3aWUgYmVpIEZsb2F0aW5nLCBkZXIgZGVzXHJcbiAgLy8gWmllbHMgbWFcdTAwREZnZWJsaWNoLlxyXG4gIGNvbnN0IHNob3J0Y3V0cyA9IHsgLi4uc3RvcmUuZ2V0U2hvcnRjdXRzKCkgfTtcclxuICBpZiAoc2hvcnRjdXRzW3NvdXJjZUtleV0pIHtcclxuICAgIGlmICh0YXJnZXRLZXkgPT09IHVuZGVmaW5lZCkgc2hvcnRjdXRzW25ld0tleV0gPSBzaG9ydGN1dHNbc291cmNlS2V5XTtcclxuICAgIGRlbGV0ZSBzaG9ydGN1dHNbc291cmNlS2V5XTtcclxuICAgIHN0b3JlLnNldFNob3J0Y3V0cyhzaG9ydGN1dHMpO1xyXG4gIH1cclxuICByZXR1cm4gdHJ1ZTtcclxufVxyXG5cclxuLy8gRWluemVsLVByb3BlcnR5LUVpbnRyXHUwMEU0Z2UgZGVyIGdsb2JhbGVuIFJlaWhlbmZvbGdlIC0gZG9ydCBzaW5kIGtlaW5lXHJcbi8vIERvcHBsdW5nZW4gZXJsYXVidCwgZWluIGJlcmVpdHMgdm9yaGFuZGVuZXIgWmllbGVpbnRyYWcgYmVoXHUwMEU0bHQgZGFoZXIgc2VpbmVcclxuLy8gUG9zaXRpb24gdW5kIGRlciBhbHRlIGVudGZcdTAwRTRsbHQuXHJcbmZ1bmN0aW9uIHJlbmFtZUluR2xvYmFsT3JkZXIoc2V0dGluZ3MsIG9sZEtleSwgbmV3S2V5KSB7XHJcbiAgY29uc3Qgb3JkZXIgPSBzZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyO1xyXG4gIGNvbnN0IHNvdXJjZSA9IG9yZGVyLmZpbmQoKGVudHJ5KSA9PiBlbnRyeS5raW5kID09PSBcInByb3BlcnR5XCIgJiYgc2FtZUtleShlbnRyeS5uYW1lLCBvbGRLZXkpKTtcclxuICBpZiAoIXNvdXJjZSkgcmV0dXJuIGZhbHNlO1xyXG4gIGNvbnN0IHRhcmdldCA9IG9yZGVyLmZpbmQoKGVudHJ5KSA9PiBlbnRyeSAhPT0gc291cmNlICYmIGVudHJ5LmtpbmQgPT09IFwicHJvcGVydHlcIiAmJiBzYW1lS2V5KGVudHJ5Lm5hbWUsIG5ld0tleSkpO1xyXG4gIGlmICh0YXJnZXQpIHNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIgPSBvcmRlci5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeSAhPT0gc291cmNlKTtcclxuICBlbHNlIGlmIChzb3VyY2UubmFtZSA9PT0gbmV3S2V5KSByZXR1cm4gZmFsc2U7XHJcbiAgZWxzZSBzb3VyY2UubmFtZSA9IG5ld0tleTtcclxuICByZXR1cm4gdHJ1ZTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gc3luY1JlbmFtZShwbHVnaW4sIG9sZEtleSwgbmV3S2V5KSB7XHJcbiAgaWYgKHR5cGVvZiBvbGRLZXkgIT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIG5ld0tleSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuO1xyXG4gIG5ld0tleSA9IG5ld0tleS50cmltKCk7XHJcbiAgaWYgKG9sZEtleSA9PT0gXCJcIiB8fCBuZXdLZXkgPT09IFwiXCIgfHwgb2xkS2V5ID09PSBuZXdLZXkpIHJldHVybjtcclxuICAvLyBUWVAvU1VCVFlQIHNpbmQgbmllIFRlaWwgZWluZXMgRnJvbnRtYXR0ZXItQmxvY2tzIChzaWVoZSBzdHJpcFR5cFByb3BlcnR5XHJcbiAgLy8gaW4gdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpIC0gZWluIFVtYmVuZW5uZW4gdm9uL25hY2ggVFlQL1NVQlRZUCBkYWhlclxyXG4gIC8vIGlnbm9yaWVyZW4uXHJcbiAgaWYgKFtvbGRLZXksIG5ld0tleV0uc29tZSgoa2V5KSA9PiBzYW1lS2V5KGtleSwgVFlQX1BST1BFUlRZKSB8fCBzYW1lS2V5KGtleSwgU1VCVFlQX1BST1BFUlRZKSkpIHJldHVybjtcclxuXHJcbiAgY29uc3QgeyBzZXR0aW5ncyB9ID0gcGx1Z2luO1xyXG4gIGxldCB0eXBlQ291bnQgPSAwO1xyXG4gIGxldCBzdWJ0eXBlQ291bnQgPSAwO1xyXG4gIGNvbnN0IGNvdW50ID0gKHN0b3JlKSA9PiAoc3RvcmUuc3VidHlwZSA/IHN1YnR5cGVDb3VudCsrIDogdHlwZUNvdW50KyspO1xyXG4gIGNvbnN0IHR5cGVzID0gbmV3IFNldChbLi4uT2JqZWN0LmtleXMoc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlciksIC4uLk9iamVjdC5rZXlzKHNldHRpbmdzLnR5cGVTdWJ0eXBlcyA/PyB7fSldKTtcclxuICBmb3IgKGNvbnN0IHR5cGUgb2YgdHlwZXMpIHtcclxuICAgIGNvbnN0IHN0b3JlcyA9IFt0eXBlU3RvcmUocGx1Z2luLCB0eXBlKSwgLi4uZ2V0U3VidHlwZU5hbWVzKHNldHRpbmdzLCB0eXBlKS5tYXAoKHN1YnR5cGUpID0+IHN1YnR5cGVTdG9yZShwbHVnaW4sIHR5cGUsIHN1YnR5cGUpKV07XHJcblxyXG4gICAgLy8gRWluZSB2YXVsdC13ZWl0ZSBVbWJlbmVubnVuZyBzY2hsXHUwMEU0Z3QgYXVmIEpFREVOIEJsb2NrIGR1cmNoLCBpbiBkZW0gZGVyXHJcbiAgICAvLyBLZXkgc3RlaHQgLSBkZXJzZWxiZSBLZXkgZGFyZiBibG9ja1x1MDBGQ2JlcmdyZWlmZW5kIG1laHJmYWNoIHZvcmtvbW1lblxyXG4gICAgLy8gKHNpZWhlIEtvbW1lbnRhciBhbiB0eXBlU3VidHlwZXMgaW4gc3VidHlwZXMuanMpLiBOdXIgSU5ORVJIQUxCIGVpbmVzXHJcbiAgICAvLyBCbG9ja3Mga2FubiBkZXIgbmV1ZSBOYW1lIGtvbGxpZGllcmVuOyBkb3J0IGxlZ3QgcmVuYW1lSW5TdG9yZSBkaWVcclxuICAgIC8vIGJlaWRlbiB3aWUgYmlzaGVyIHp1c2FtbWVuLlxyXG4gICAgZm9yIChjb25zdCBzdG9yZSBvZiBzdG9yZXMpIHtcclxuICAgICAgaWYgKHJlbmFtZUluU3RvcmUoc3RvcmUsIG9sZEtleSwgbmV3S2V5KSkgY291bnQoc3RvcmUpO1xyXG4gICAgfVxyXG4gIH1cclxuICBjb25zdCBvcmRlckNoYW5nZWQgPSByZW5hbWVJbkdsb2JhbE9yZGVyKHNldHRpbmdzLCBvbGRLZXksIG5ld0tleSk7XHJcbiAgaWYgKHR5cGVDb3VudCA9PT0gMCAmJiBzdWJ0eXBlQ291bnQgPT09IDAgJiYgIW9yZGVyQ2hhbmdlZCkgcmV0dXJuO1xyXG5cclxuICBhd2FpdCBwbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgcGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG5cclxuICBjb25zdCBwYXJ0cyA9IFtdO1xyXG4gIGlmICh0eXBlQ291bnQgPiAwKSBwYXJ0cy5wdXNoKGAke3R5cGVDb3VudH0gVFlQJHt0eXBlQ291bnQgPT09IDEgPyBcIlwiIDogXCJlblwifWApO1xyXG4gIGlmIChzdWJ0eXBlQ291bnQgPiAwKSBwYXJ0cy5wdXNoKGAke3N1YnR5cGVDb3VudH0gU3VidHlwJHtzdWJ0eXBlQ291bnQgPT09IDEgPyBcIlwiIDogXCJlblwifWApO1xyXG4gIGlmIChvcmRlckNoYW5nZWQpIHBhcnRzLnB1c2goXCJnbG9iYWxlciBSZWloZW5mb2xnZVwiKTtcclxuICBuZXcgTm90aWNlKGBUWVAtU3lzdGVtOiBcdTIwMUUke29sZEtleX1cdTIwMUMgXHUyMTkyIFx1MjAxRSR7bmV3S2V5fVx1MjAxQyBpbiAke3BhcnRzLmpvaW4oXCIgdW5kIFwiKX0gdW1iZW5hbm50LmApO1xyXG59XHJcblxyXG4vLyBPYnNpZGlhbnMgXCJBbGwgcHJvcGVydGllc1wiLUFuc2ljaHQgKGFjY2VwdFJlbmFtZSkgdW5kIEJhc2VzIChOYW1lbnNmZWxkIGVpbmVyXHJcbi8vIG5ldSBhbmdlbGVndGVuIE5vdGl6LVByb3BlcnR5KSBiZW5lbm5lbiBQcm9wZXJ0aWVzIHZhdWx0LXdlaXQgYXVzc2NobGllXHUwMERGbGljaFxyXG4vLyBcdTAwRkNiZXIgYXBwLmZpbGVNYW5hZ2VyLnJlbmFtZVByb3BlcnR5KGFsdCwgbmV1KSB1bSAoc2llaGUgZ2ViYXV0ZXMgYXBwLmpzKSAtXHJcbi8vIGVpbiBXcmFwcGVyIGdlbmF1IGRvcnQgZXJmYXNzdCBhbHNvIGplZGUgZWNodGUgVW1iZW5lbm51bmcsIG9obmUgZGllXHJcbi8vIGpld2VpbGlnZW4gVmlld3Mgc2VsYnN0IGFuZmFzc2VuIHp1IG1cdTAwRkNzc2VuLiBCYXNlcycgXCJEaXNwbGF5IG5hbWVcIiBmXHUwMEZDclxyXG4vLyBiZXN0ZWhlbmRlIFByb3BlcnRpZXMgXHUwMEU0bmRlcnQgbnVyIGRpZSAuYmFzZS1EYXRlaSwgbmljaHQgZGllIE5vdGl6ZW4sIHVuZFxyXG4vLyBsXHUwMEU0dWZ0IGRlc2hhbGIgKHJpY2h0aWdlcndlaXNlKSBuaWNodCBoaWVyIGR1cmNoLlxyXG5mdW5jdGlvbiByZWdpc3RlclByb3BlcnR5UmVuYW1lU3luYyhwbHVnaW4pIHtcclxuICBjb25zdCBmaWxlTWFuYWdlciA9IHBsdWdpbi5hcHAuZmlsZU1hbmFnZXI7XHJcbiAgaWYgKGZpbGVNYW5hZ2VyLl9fZnJlZFR5cFJlbmFtZVN5bmNQYXRjaGVkKSByZXR1cm47XHJcbiAgZmlsZU1hbmFnZXIuX19mcmVkVHlwUmVuYW1lU3luY1BhdGNoZWQgPSB0cnVlO1xyXG5cclxuICBjb25zdCBvcmlnaW5hbCA9IGZpbGVNYW5hZ2VyLnJlbmFtZVByb3BlcnR5O1xyXG4gIGZpbGVNYW5hZ2VyLnJlbmFtZVByb3BlcnR5ID0gYXN5bmMgZnVuY3Rpb24gKG9sZEtleSwgbmV3S2V5LCAuLi5yZXN0KSB7XHJcbiAgICAvLyBXaXJmdCBkYXMgT3JpZ2luYWwgKGFjY2VwdFJlbmFtZSBmXHUwMEU0bmd0IGRhcyBzZWxic3QgYWIpLCBibGVpYmVuIGRpZVxyXG4gICAgLy8gUGx1Z2luLUVpbnN0ZWxsdW5nZW4gdW52ZXJcdTAwRTRuZGVydC5cclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IG9yaWdpbmFsLmNhbGwodGhpcywgb2xkS2V5LCBuZXdLZXksIC4uLnJlc3QpO1xyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgc3luY1JlbmFtZShwbHVnaW4sIG9sZEtleSwgbmV3S2V5KTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJUWVAtU3lzdGVtOiBQcm9wZXJ0eS1VbWJlbmVubnVuZyBuaWNodCBcdTAwRkNiZXJub21tZW5cIiwgZXJyb3IpO1xyXG4gICAgICBuZXcgTm90aWNlKGBUWVAtU3lzdGVtOiBVbWJlbmVubnVuZyB2b24gXHUyMDFFJHtvbGRLZXl9XHUyMDFDIG5pY2h0IFx1MDBGQ2Jlcm5vbW1lbiBcdTIwMTMgJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9O1xyXG5cclxuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4ge1xyXG4gICAgZmlsZU1hbmFnZXIucmVuYW1lUHJvcGVydHkgPSBvcmlnaW5hbDtcclxuICAgIGRlbGV0ZSBmaWxlTWFuYWdlci5fX2ZyZWRUeXBSZW5hbWVTeW5jUGF0Y2hlZDtcclxuICB9KTtcclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyUHJvcGVydHlSZW5hbWVTeW5jIH07XHJcbiIsICJjb25zdCB7IEZ1enp5U3VnZ2VzdE1vZGFsLCBOb3RpY2UsIHByZXBhcmVGdXp6eVNlYXJjaCB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xyXG5jb25zdCB7IGNvbXBhcmVUeXBlcywgREVGQVVMVF9TT1JUX09SREVSIH0gPSByZXF1aXJlKFwiLi90eXAtdmlld1wiKTtcclxuY29uc3QgeyBuYW1lQ29sb3IsIHBhaW50Q29sb3JEb3QgfSA9IHJlcXVpcmUoXCIuL3R5cGUtY29sb3JzXCIpO1xyXG5cclxuLy8gTmF0aXZlciBFcnNhdHogZlx1MDBGQ3IgVGVtcGxhdGVycyB0cC5zeXN0ZW0uc3VnZ2VzdGVyIGJlaSBkZXIgVFlQLUF1c3dhaGwgKHNpZWhlXHJcbi8vIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanMpOiBiYXV0IGF1ZiBPYnNpZGlhbnMgZWlnZW5lbVxyXG4vLyBGdXp6eVN1Z2dlc3RNb2RhbCBhdWYgKGRpZXNlbGJlIEJhc2lzLCBhdWYgZGVyIGF1Y2ggVGVtcGxhdGVycyBTdWdnZXN0ZXJcclxuLy8gc2VsYnN0IGJlcnVodCksIHplaWd0IHp1c1x1MDBFNHR6bGljaCBhYmVyIFRZUC1GYXJiZS8tUHVua3QsIEJlc2NocmVpYnVuZyB1bmRcclxuLy8gTm90aXotQW56YWhsIGplIFplaWxlLiBOaWNodCBlcmZhc3N0ZSAoaXRlbS51bnJlZ2lzdGVyZWQpIFRZUGVuIHdlcmRlbiBzdGF0dFxyXG4vLyBpbiBpaHJlciAobmljaHQgZXhpc3RpZXJlbmRlbikgRmFyYmUgbXV0ZWQgZGFyZ2VzdGVsbHQsIGFuYWxvZyB6dXJcclxuLy8gVFlQLUxpc3RlIHNlbGJzdCAoc2llaGUgLmZyZWQtdHlwLXVucmVnaXN0ZXJlZCBpbiB0eXAtdmlldy5qcykuXHJcbmNsYXNzIFR5cFBpY2tlck1vZGFsIGV4dGVuZHMgRnV6enlTdWdnZXN0TW9kYWwge1xyXG4gIGNvbnN0cnVjdG9yKGFwcCwgcGx1Z2luLCBpdGVtcywgcmVzb2x2ZSkge1xyXG4gICAgc3VwZXIoYXBwKTtcclxuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xyXG4gICAgdGhpcy5pdGVtcyA9IGl0ZW1zO1xyXG4gICAgdGhpcy5yZXNvbHZlID0gcmVzb2x2ZTtcclxuICAgIHRoaXMuY2hvc2VuID0gZmFsc2U7XHJcbiAgICB0aGlzLnNldFBsYWNlaG9sZGVyKFwiRVNDIGZcdTAwRkNyIEFiYnJ1Y2hcIik7XHJcbiAgfVxyXG5cclxuICBnZXRJdGVtcygpIHtcclxuICAgIHJldHVybiB0aGlzLml0ZW1zO1xyXG4gIH1cclxuXHJcbiAgLy8gRnV6enktU3VjaGUgZ3JlaWZ0IGF1Y2ggYXVmIGRpZSBCZXNjaHJlaWJ1bmcsIG5pY2h0IG51ciBhdWYgZGVuIFRZUC1OYW1lbiAtXHJcbiAgLy8gdW5kIGF1ZiBkaWUgU3VidHlwZW4sIHdvIHNpZSBpbiBkZXIgWmVpbGUgc3RlaGVuIChzaG93U3VidHlwZXMsIHNpZWhlXHJcbiAgLy8gdHlwZUl0ZW1zKTogc2llIHNpbmQgZGFubiBzaWNodGJhciwgYWxzbyBlcndhcnRldCBtYW4gYXVjaCwgc2llIHRpcHBlbiB6dVxyXG4gIC8vIGtcdTAwRjZubmVuLCB1bmQgaW0gc2VwYXJhdGVuIEFibGF1ZiBpc3QgZGVyIFRZUCBkYXJcdTAwRkNiZXIgZGVyIFdlZyB6dSBpaG5lbi5cclxuICBnZXRJdGVtVGV4dChpdGVtKSB7XHJcbiAgICByZXR1cm4gW2l0ZW0udHlwZSwgaXRlbS5zdWJ0eXBlcz8uam9pbihcIiBcIiksIGl0ZW0uZGVzY3JpcHRpb25dLmZpbHRlcihCb29sZWFuKS5qb2luKFwiIFwiKTtcclxuICB9XHJcblxyXG4gIHJlbmRlclN1Z2dlc3Rpb24obWF0Y2gsIGVsKSB7XHJcbiAgICBjb25zdCBpdGVtID0gbWF0Y2guaXRlbTtcclxuICAgIGVsLmFkZENsYXNzKFwiZnJlZC10eXAtcGlja2VyLXN1Z2dlc3Rpb25cIik7XHJcbiAgICBpZiAoaXRlbS51bnJlZ2lzdGVyZWQpIGVsLmFkZENsYXNzKFwiZnJlZC10eXAtcGlja2VyLXVucmVnaXN0ZXJlZFwiKTtcclxuXHJcbiAgICBpZiAoaXRlbS51bnJlZ2lzdGVyZWQpIHtcclxuICAgICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1waWNrZXItbmFtZVwiLCB0ZXh0OiBpdGVtLnR5cGUgfSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICB0aGlzLnJlbmRlckNvbG9yZWROYW1lKGVsLCBpdGVtLnR5cGUsIGl0ZW0udHlwZSk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGl0ZW0uc3VidHlwZXM/Lmxlbmd0aCkgdGhpcy5yZW5kZXJTdWJ0eXBlUHJldmlldyhlbCwgaXRlbSk7XHJcblxyXG4gICAgaWYgKGl0ZW0uZGVzY3JpcHRpb24pIHtcclxuICAgICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1waWNrZXItZGVzY1wiLCB0ZXh0OiBpdGVtLmRlc2NyaXB0aW9uIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtcGlja2VyLWNvdW50XCIsIHRleHQ6IFN0cmluZyhpdGVtLmNvdW50KSB9KTtcclxuICB9XHJcblxyXG4gIC8vIE5hbWUgaW4gZGVyIEZhcmJlIHZvbiBjb2xvclR5cGUgKGJ6dy4gZGVzIFN1YnR5cHMsIHNpZWhlIG5hbWVDb2xvciBpblxyXG4gIC8vIHR5cGUtY29sb3JzLmpzIC0gZGllc2VsYmUgR3J1bmRsYWdlIG51dHp0IGRpZSBTdWJ0eXAtVm9yc2NoYXUgZGVyIFRZUC1MaXN0ZSlcclxuICAvLyAtIGplIG5hY2ggRWluc3RlbGx1bmcgXCJUWVAgVmlldyBlaW5mXHUwMEU0cmJlblwiIGFscyBlaW5nZWZcdTAwRTRyYnRlciBUZXh0IG9kZXIgbWl0XHJcbiAgLy8gdm9yYW5nZXN0ZWxsdGVtIEZhcmJwdW5rdC5cclxuICByZW5kZXJDb2xvcmVkTmFtZShlbCwgdGV4dCwgY29sb3JUeXBlLCBzdWJ0eXBlID0gbnVsbCkge1xyXG4gICAgY29uc3QgeyBjb2xvciwgaXNEZWZhdWx0IH0gPSBuYW1lQ29sb3IodGhpcy5wbHVnaW4uc2V0dGluZ3MsIGNvbG9yVHlwZSwgc3VidHlwZSk7XHJcbiAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0KSB7XHJcbiAgICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtcGlja2VyLW5hbWVcIiwgdGV4dCB9KS5zdHlsZS5jb2xvciA9IGNvbG9yO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgcGFpbnRDb2xvckRvdChlbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLXBpY2tlci1kb3RcIiB9KSwgY29sb3IsIGlzRGVmYXVsdCk7XHJcbiAgICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtcGlja2VyLW5hbWVcIiwgdGV4dCB9KTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8vIFwiVFlQIChTdWJ0eXAgMSwgU3VidHlwIDIpXCIgLSB3ZWxjaGUgU3VidHlwZW4gdW50ZXIgZGVtIFRZUCBsaWVnZW4sIHNjaG9uXHJcbiAgLy8gaW4gZGVyIFRZUC1BdXN3YWhsIGRlcyBzZXBhcmF0ZW4gQWJsYXVmcyAoc2llaGUgcGlja1R5cGVBbmRTdWJ0eXBlKSwgd29cclxuICAvLyBkZXIgU3VidHlwLVBpY2tlciBlcnN0IGRhbmFjaCBrb21tdC4gSmVkZXIgU3VidHlwIGluIHNlaW5lciBlaWdlbmVuIEZhcmJlLFxyXG4gIC8vIEtsYW1tZXJuIHVuZCBLb21tYXMgbXV0ZWQ7IG9obmUgXCJUWVAgVmlldyBlaW5mXHUwMEU0cmJlblwiIGJsZWlidCBkaWUgVm9yc2NoYXVcclxuICAvLyB3aWUgZGVyIE5hbWUgc2VsYnN0IHVuZ2VmXHUwMEU0cmJ0LlxyXG4gIHJlbmRlclN1YnR5cGVQcmV2aWV3KGVsLCBpdGVtKSB7XHJcbiAgICBjb25zdCBjb2xvcml6ZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdDtcclxuICAgIGNvbnN0IHdyYXAgPSBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLXBpY2tlci1zdWJ0eXBlc1wiIH0pO1xyXG4gICAgd3JhcC5hcHBlbmRUZXh0KFwiKFwiKTtcclxuICAgIGl0ZW0uc3VidHlwZXMuZm9yRWFjaCgoc3VidHlwZSwgaW5kZXgpID0+IHtcclxuICAgICAgaWYgKGluZGV4ID4gMCkgd3JhcC5hcHBlbmRUZXh0KFwiLCBcIik7XHJcbiAgICAgIGNvbnN0IHNwYW4gPSB3cmFwLmNyZWF0ZVNwYW4oeyB0ZXh0OiBzdWJ0eXBlIH0pO1xyXG4gICAgICBpZiAoY29sb3JpemUpIHNwYW4uc3R5bGUuY29sb3IgPSBuYW1lQ29sb3IodGhpcy5wbHVnaW4uc2V0dGluZ3MsIGl0ZW0udHlwZSwgc3VidHlwZSkuY29sb3I7XHJcbiAgICB9KTtcclxuICAgIHdyYXAuYXBwZW5kVGV4dChcIilcIik7XHJcbiAgfVxyXG5cclxuICAvLyBPYnNpZGlhbnMgU3VnZ2VzdE1vZGFsLnNlbGVjdFN1Z2dlc3Rpb24oKSBydWZ0IGludGVybiBlcnN0IHRoaXMuY2xvc2UoKVxyXG4gIC8vIGF1ZiB1bmQgZGFuYWNoIGVyc3Qgb25DaG9vc2VTdWdnZXN0aW9uKCkvb25DaG9vc2VJdGVtKCkgLSBcImNob3NlblwiIGhpZXIgenVcclxuICAvLyBzZXR6ZW4gKHN0YXR0IGluIG9uQ2hvb3NlSXRlbSkgaXN0IGRhaGVyIG5pY2h0IGJsb1x1MDBERiBHZXNjaG1hY2tzc2FjaGU6IHdcdTAwRkNyZGVcclxuICAvLyBlcyBlcnN0IGluIG9uQ2hvb3NlSXRlbSBnZXNldHp0LCBoXHUwMEU0dHRlIGRhcyBjbG9zZSgpLWF1c2dlbFx1MDBGNnN0ZSBvbkNsb3NlKClcclxuICAvLyB1bnRlbiBcImNob3NlblwiIG5vY2ggYWxzIGZhbHNlIGdlc2VoZW4gdW5kIGRhcyBQcm9taXNlIGZcdTAwRTRsc2NobGljaCBzY2hvbiBtaXRcclxuICAvLyBudWxsIGF1ZmdlbFx1MDBGNnN0LCBiZXZvciBkZXIgZWlnZW50bGljaGUgb25DaG9vc2VJdGVtLUF1ZnJ1ZiBcdTAwRkNiZXJoYXVwdCBsaWVmIC1cclxuICAvLyBkYXMgendlaXRlIHJlc29sdmUoKSBncmVpZnQgZGFubiBuaWNodCBtZWhyIChlaW4gUHJvbWlzZSBsXHUwMEY2c3QgbnVyIGVpbm1hbFxyXG4gIC8vIGF1ZiksIGRhcyBFcmdlYm5pcyB3YXIgdW5hYmhcdTAwRTRuZ2lnIHZvbiBkZXIgQXVzd2FobCBpbW1lciBudWxsLlxyXG4gIHNlbGVjdFN1Z2dlc3Rpb24oaXRlbSwgZXZ0KSB7XHJcbiAgICB0aGlzLmNob3NlbiA9IHRydWU7XHJcbiAgICAvLyBXYXMgYmVpIGRlciBBdXN3YWhsIGltIFN1Y2hmZWxkIHN0YW5kIC0gZGVyIFN1YnR5cC1QaWNrZXIgc29ydGllcnQgZGFuYWNoXHJcbiAgICAvLyB2b3IgKHNpZWhlIHBpY2tUeXBlRW50cnkvc29ydEJ5UXVlcnkpLlxyXG4gICAgdGhpcy5xdWVyeSA9IHRoaXMuaW5wdXRFbC52YWx1ZS50cmltKCk7XHJcbiAgICBzdXBlci5zZWxlY3RTdWdnZXN0aW9uKGl0ZW0sIGV2dCk7XHJcbiAgfVxyXG5cclxuICBvbkNob29zZUl0ZW0oaXRlbSkge1xyXG4gICAgdGhpcy5yZXNvbHZlKGl0ZW0udHlwZSk7XHJcbiAgfVxyXG5cclxuICAvLyBFU0MgKG9kZXIgS2xpY2sgZGFuZWJlbikgc2NobGllXHUwMERGdCBkYXMgTW9kYWwgb2huZSBzZWxlY3RTdWdnZXN0aW9uIC0gZGFublxyXG4gIC8vIHN0YXR0IGVpbmVzIGhcdTAwRTRuZ2VuZGVuIFByb21pc2UgbWl0IG51bGwgYXVmbFx1MDBGNnNlbiwgYW5hbG9nIHp1XHJcbiAgLy8gdHAuc3lzdGVtLnN1Z2dlc3Rlci5cclxuICBvbkNsb3NlKCkge1xyXG4gICAgc3VwZXIub25DbG9zZSgpO1xyXG4gICAgaWYgKCF0aGlzLmNob3NlbikgdGhpcy5yZXNvbHZlKG51bGwpO1xyXG4gIH1cclxufVxyXG5cclxuLy8gQXVzd2FobCBlaW5lcyBTdWJ0eXBzIGZcdTAwRkNyIGVpbmVuIGJlcmVpdHMgZ2V3XHUwMEU0aGx0ZW4gVFlQIChzaWVoZSBwaWNrU3VidHlwZSkuXHJcbi8vIFdpZSBUeXBQaWNrZXJNb2RhbCwgenVzXHUwMEU0dHpsaWNoIG1pdCBkZW0gRWludHJhZyBcIlRZUCAob2huZSBTdWJ0eXApXCIgYW5cclxuLy8gZXJzdGVyIFN0ZWxsZSAoaXRlbS5ub25lKS4gRVNDIGxcdTAwRjZzdCBtaXQgbnVsbCBhdWYgLSBUWVAuanMga2VocnQgZGFubiB6dXJcclxuLy8gVFlQLUF1c3dhaGwgenVyXHUwMEZDY2suIFN1YnR5cGVuIGhhYmVuIGtlaW5lIEJlc2NocmVpYnVuZywgZGVyIE5hbWUgc3RlaHQgaW5cclxuLy8gZGVyIEZhcmJlIGRlcyBTdWJ0eXBzIChiencuIGRlcyBUWVBzKSBtaXQgTm90aXotQW56YWhsLiBxdWVyeSBpc3QgZGllXHJcbi8vIFN1Y2hhbmZyYWdlIGF1cyBkZW0gVFlQLVBpY2tlciwgbmFjaCBkZXIgZGllIExpc3RlIHZvcnNvcnRpZXJ0IHN0ZWh0LlxyXG5jbGFzcyBTdWJ0eXBQaWNrZXJNb2RhbCBleHRlbmRzIFR5cFBpY2tlck1vZGFsIHtcclxuICBjb25zdHJ1Y3RvcihhcHAsIHBsdWdpbiwgdHlwZSwgaXRlbXMsIHJlc29sdmUsIHF1ZXJ5ID0gXCJcIikge1xyXG4gICAgc3VwZXIoYXBwLCBwbHVnaW4sIGl0ZW1zLCByZXNvbHZlKTtcclxuICAgIHRoaXMudHlwZSA9IHR5cGU7XHJcbiAgICB0aGlzLnNldFBsYWNlaG9sZGVyKGBTdWJ0eXAgZlx1MDBGQ3IgJHt0eXBlfSBcdTIwMTMgRVNDIGZcdTAwRkNyIHp1clx1MDBGQ2NrYCk7XHJcbiAgICB0aGlzLml0ZW1zID0gc29ydEJ5UXVlcnkoaXRlbXMsIHF1ZXJ5LCAoaXRlbSkgPT4gdGhpcy5nZXRJdGVtVGV4dChpdGVtKSk7XHJcbiAgfVxyXG5cclxuICAvLyBEaWUgXCJvaG5lIFN1YnR5cFwiLVplaWxlIGlzdCBhdWNoIFx1MDBGQ2JlciBkZW4gVFlQLU5hbWVuIHp1IGZpbmRlbiwgZGVuIHNpZVxyXG4gIC8vIHplaWd0IC0gZWluIGltIFRZUC1QaWNrZXIgZ2V0aXBwdGVzIFwiT1JHQVwiIGhvbHQgc2llIGRhbWl0IHZvbiBhbGxlaW5cclxuICAvLyB3aWVkZXIgYW4gZGVuIEFuZmFuZywgb2J3b2hsIGRvcnQgZGVyIFRZUCB1bmQgbmljaHQgZWluIFN1YnR5cCBnZW1laW50IHdhci5cclxuICBnZXRJdGVtVGV4dChpdGVtKSB7XHJcbiAgICByZXR1cm4gaXRlbS5ub25lID8gYCR7dGhpcy50eXBlfSAke2l0ZW0udHlwZX1gIDogc3VwZXIuZ2V0SXRlbVRleHQoaXRlbSk7XHJcbiAgfVxyXG5cclxuICByZW5kZXJTdWdnZXN0aW9uKG1hdGNoLCBlbCkge1xyXG4gICAgY29uc3QgaXRlbSA9IG1hdGNoLml0ZW07XHJcbiAgICBlbC5hZGRDbGFzcyhcImZyZWQtdHlwLXBpY2tlci1zdWdnZXN0aW9uXCIpO1xyXG4gICAgaWYgKGl0ZW0ubm9uZSkge1xyXG4gICAgICAvLyBcIk9SR0EgKG9obmUgU3VidHlwKVwiOiBkZXIgVFlQIHNlbGJzdCBpbiBzZWluZXIgRmFyYmUgKGJ6dy4gbWl0XHJcbiAgICAgIC8vIEZhcmJwdW5rdCksIGRlciBadXNhdHogaW4gbm9ybWFsZXIgVGV4dGZhcmJlIHN0YXR0IG11dGVkIC0gZGllIFplaWxlXHJcbiAgICAgIC8vIGlzdCBkaWUgV2FobCBcImRpZXNlciBUWVAsIG9obmUgU3VidHlwXCIgdW5kIGtlaW5lIGF1c2dlZ3JhdXRlXHJcbiAgICAgIC8vIE5pY2h0LVdhaGwsIHVuZCBkZXIgaGVsbGUgWnVzYXR6IGhlYnQgc2llIHp1Z2xlaWNoIHZvbiBkZW5cclxuICAgICAgLy8gU3VidHlwLVplaWxlbiBkYXJ1bnRlciBhYiwgZGllIG51ciBhdXMgaWhyZW0gTmFtZW4gYmVzdGVoZW4uXHJcbiAgICAgIHRoaXMucmVuZGVyQ29sb3JlZE5hbWUoZWwsIHRoaXMudHlwZSwgdGhpcy50eXBlKTtcclxuICAgICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1waWNrZXItbm9uZVwiLCB0ZXh0OiBgKCR7aXRlbS50eXBlfSlgIH0pO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgdGhpcy5yZW5kZXJDb2xvcmVkTmFtZShlbCwgaXRlbS50eXBlLCB0aGlzLnR5cGUsIGl0ZW0udHlwZSk7XHJcbiAgICB9XHJcbiAgICBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLXBpY2tlci1jb3VudFwiLCB0ZXh0OiBTdHJpbmcoaXRlbS5jb3VudCkgfSk7XHJcbiAgfVxyXG5cclxuICBvbkNob29zZUl0ZW0oaXRlbSkge1xyXG4gICAgdGhpcy5yZXNvbHZlKGl0ZW0ubm9uZSA/IFwiXCIgOiBpdGVtLnR5cGUpO1xyXG4gIH1cclxufVxyXG5cclxuLy8gVFlQLVBpY2tlciBtaXQgZGVuIFN1YnR5cGVuIGRpcmVrdCBlaW5nZXJcdTAwRkNja3QgdW50ZXIgaWhyZW0gVFlQIChTdGFuZGFyZCxcclxuLy8gc29sYW5nZSBcIlN1YnR5cC1QaWNrZXIgc2VwYXJhdFwiIGluIGRlbiBFaW5zdGVsbHVuZ2VuIGF1cyBpc3QsIHNpZWhlXHJcbi8vIHBpY2tUeXBlQW5kU3VidHlwZSkuIERpZSBUWVAtWmVpbGUgc2VsYnN0IHN0ZWh0IGZcdTAwRkNyIFwiVFlQIG9obmUgU3VidHlwXCIuXHJcbi8vIEdlc3VjaHQgd2lyZCBncnVwcGVud2Vpc2Ugc3RhdHQgamUgWmVpbGUsIGRhbWl0IGVpbiBTdWJ0eXAgbmllIG9obmUgc2VpbmVuXHJcbi8vIFRZUCBkYXJcdTAwRkNiZXIgZXJzY2hlaW50OiBwYXNzdCBkaWUgU3VjaGUgYXVmIGRlbiBUWVAsIGJsZWliZW4gYWxsZSBzZWluZVxyXG4vLyBTdWJ0eXBlbiBzdGVoZW47IHBhc3N0IHNpZSBudXIgYXVmIGVpbnplbG5lIFN1YnR5cGVuLCBibGVpYmVuIGRpZXNlIHNhbXRcclxuLy8gaWhyZW0gVFlQIHN0ZWhlbi4gRGllIEdydXBwZW4gc29ydGllcmVuIHNpY2ggbmFjaCBpaHJlbSBiZXN0ZW4gVHJlZmZlcixcclxuLy8gaW5uZXJoYWxiIGVpbmVyIEdydXBwZSBibGVpYnQgZGllIEJsb2NrLVJlaWhlbmZvbGdlLlxyXG5jbGFzcyBUeXBTdWJ0eXBQaWNrZXJNb2RhbCBleHRlbmRzIFR5cFBpY2tlck1vZGFsIHtcclxuICBjb25zdHJ1Y3RvcihhcHAsIHBsdWdpbiwgZ3JvdXBzLCByZXNvbHZlKSB7XHJcbiAgICBzdXBlcihhcHAsIHBsdWdpbiwgZ3JvdXBzLm1hcCgoZ3JvdXApID0+IGdyb3VwLml0ZW0pLCByZXNvbHZlKTtcclxuICAgIHRoaXMuZ3JvdXBzID0gZ3JvdXBzO1xyXG4gIH1cclxuXHJcbiAgZ2V0U3VnZ2VzdGlvbnMocXVlcnkpIHtcclxuICAgIGNvbnN0IHNlYXJjaCA9IHF1ZXJ5LnRyaW0oKSA/IHByZXBhcmVGdXp6eVNlYXJjaChxdWVyeS50cmltKCkpIDogbnVsbDtcclxuICAgIGNvbnN0IG5vTWF0Y2ggPSB7IHNjb3JlOiAwLCBtYXRjaGVzOiBbXSB9O1xyXG4gICAgY29uc3QgcmVzdWx0cyA9IFtdO1xyXG4gICAgZm9yIChjb25zdCB7IGl0ZW0sIHN1YnR5cGVzIH0gb2YgdGhpcy5ncm91cHMpIHtcclxuICAgICAgY29uc3QgdHlwZU1hdGNoID0gc2VhcmNoID8gc2VhcmNoKHRoaXMuZ2V0SXRlbVRleHQoaXRlbSkpIDogbm9NYXRjaDtcclxuICAgICAgbGV0IHN1YnR5cGVNYXRjaGVzID0gc3VidHlwZXMubWFwKChzdWJ0eXBlKSA9PiAoeyBpdGVtOiBzdWJ0eXBlLCBtYXRjaDogc2VhcmNoID8gc2VhcmNoKHN1YnR5cGUuc3VidHlwZSkgOiBub01hdGNoIH0pKTtcclxuICAgICAgaWYgKCF0eXBlTWF0Y2gpIHN1YnR5cGVNYXRjaGVzID0gc3VidHlwZU1hdGNoZXMuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkubWF0Y2gpO1xyXG4gICAgICBpZiAoIXR5cGVNYXRjaCAmJiBzdWJ0eXBlTWF0Y2hlcy5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xyXG5cclxuICAgICAgY29uc3Qgc2NvcmVzID0gW3R5cGVNYXRjaCwgLi4uc3VidHlwZU1hdGNoZXMubWFwKChlbnRyeSkgPT4gZW50cnkubWF0Y2gpXS5maWx0ZXIoQm9vbGVhbikubWFwKChtYXRjaCkgPT4gbWF0Y2guc2NvcmUpO1xyXG4gICAgICByZXN1bHRzLnB1c2goe1xyXG4gICAgICAgIHNjb3JlOiBNYXRoLm1heCguLi5zY29yZXMpLFxyXG4gICAgICAgIHJvd3M6IFt7IGl0ZW0sIG1hdGNoOiB0eXBlTWF0Y2ggPz8gbm9NYXRjaCB9LCAuLi5zdWJ0eXBlTWF0Y2hlcy5tYXAoKGVudHJ5KSA9PiAoeyBpdGVtOiBlbnRyeS5pdGVtLCBtYXRjaDogZW50cnkubWF0Y2ggPz8gbm9NYXRjaCB9KSldLFxyXG4gICAgICB9KTtcclxuICAgIH1cclxuICAgIGlmIChzZWFyY2gpIHJlc3VsdHMuc29ydCgoYSwgYikgPT4gYi5zY29yZSAtIGEuc2NvcmUpO1xyXG4gICAgcmV0dXJuIHJlc3VsdHMuZmxhdE1hcCgoZ3JvdXApID0+IGdyb3VwLnJvd3MpO1xyXG4gIH1cclxuXHJcbiAgcmVuZGVyU3VnZ2VzdGlvbihtYXRjaCwgZWwpIHtcclxuICAgIGNvbnN0IGl0ZW0gPSBtYXRjaC5pdGVtO1xyXG4gICAgaWYgKCFpdGVtLnN1YnR5cGUpIHtcclxuICAgICAgc3VwZXIucmVuZGVyU3VnZ2VzdGlvbihtYXRjaCwgZWwpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBlbC5hZGRDbGFzcyhcImZyZWQtdHlwLXBpY2tlci1zdWdnZXN0aW9uXCIsIFwiZnJlZC10eXAtcGlja2VyLXN1YnR5cGVcIik7XHJcbiAgICB0aGlzLnJlbmRlckNvbG9yZWROYW1lKGVsLCBpdGVtLnN1YnR5cGUsIGl0ZW0udHlwZSwgaXRlbS5zdWJ0eXBlKTtcclxuICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtcGlja2VyLWNvdW50XCIsIHRleHQ6IFN0cmluZyhpdGVtLmNvdW50KSB9KTtcclxuICB9XHJcblxyXG4gIG9uQ2hvb3NlSXRlbShpdGVtKSB7XHJcbiAgICB0aGlzLnJlc29sdmUoeyB0eXBlOiBpdGVtLnR5cGUsIHN1YnR5cGU6IGl0ZW0uc3VidHlwZSA/PyBudWxsIH0pO1xyXG4gIH1cclxufVxyXG5cclxuLy8gQXVzZ2FuZ3MtUmVpaGVuZm9sZ2UgZWluZXIgUGlja2VyLUxpc3RlIG5hY2ggZWluZXIgc2Nob24gZ2V0aXBwdGVuIFN1Y2hhbmZyYWdlXHJcbi8vIChkZXIgYXVzIGRlbSBUWVAtUGlja2VyLCBzaWVoZSBwaWNrVHlwZUVudHJ5KTogd29yYXVmIHNpZSBwYXNzdCwgc3RlaHQgb2JlbixcclxuLy8gbmFjaCBUcmVmZmVyZ1x1MDBGQ3RlLCBhbGxlcyBhbmRlcmUgZGFoaW50ZXIgaW4gdW52ZXJcdTAwRTRuZGVydGVyIFJlaWhlbmZvbGdlLiBcIlBhc3N0XHJcbi8vIGF1ZiBuaWNodHNcIiBsXHUwMEU0c3N0IGRpZSBMaXN0ZSwgd2llIHNpZSB3YXIgLSBnZXRpcHB0IHdhciBkYW5uIHouIEIuIGVpbmVcclxuLy8gQmVzY2hyZWlidW5nLCBcdTAwRkNiZXIgZGllIGhpZXIgbmljaHRzIHp1IHNjaGxpZVx1MDBERmVuIGlzdC4gRGFuYWNoIGdyZWlmdCB3aWVkZXJcclxuLy8gT2JzaWRpYW5zIGVpZ2VuZSBTdWNoZSwgc29iYWxkIGltIFBpY2tlciBzZWxic3QgZ2V0aXBwdCB3aXJkLlxyXG5mdW5jdGlvbiBzb3J0QnlRdWVyeShpdGVtcywgcXVlcnksIGl0ZW1UZXh0KSB7XHJcbiAgY29uc3Qgc2VhcmNoID0gcXVlcnk/LnRyaW0oKSA/IHByZXBhcmVGdXp6eVNlYXJjaChxdWVyeS50cmltKCkpIDogbnVsbDtcclxuICBpZiAoIXNlYXJjaCkgcmV0dXJuIGl0ZW1zO1xyXG4gIGNvbnN0IHNjb3JlZCA9IGl0ZW1zLm1hcCgoaXRlbSwgaW5kZXgpID0+ICh7IGl0ZW0sIGluZGV4LCBzY29yZTogc2VhcmNoKGl0ZW1UZXh0KGl0ZW0pKT8uc2NvcmUgPz8gbnVsbCB9KSk7XHJcbiAgaWYgKHNjb3JlZC5ldmVyeSgoZW50cnkpID0+IGVudHJ5LnNjb3JlID09PSBudWxsKSkgcmV0dXJuIGl0ZW1zO1xyXG4gIHNjb3JlZC5zb3J0KChhLCBiKSA9PiB7XHJcbiAgICBpZiAoYS5zY29yZSA9PT0gbnVsbCB8fCBiLnNjb3JlID09PSBudWxsKSByZXR1cm4gYS5zY29yZSA9PT0gYi5zY29yZSA/IGEuaW5kZXggLSBiLmluZGV4IDogYS5zY29yZSA9PT0gbnVsbCA/IDEgOiAtMTtcclxuICAgIHJldHVybiBiLnNjb3JlIC0gYS5zY29yZSB8fCBhLmluZGV4IC0gYi5pbmRleDtcclxuICB9KTtcclxuICByZXR1cm4gc2NvcmVkLm1hcCgoZW50cnkpID0+IGVudHJ5Lml0ZW0pO1xyXG59XHJcblxyXG4vLyBGXHUwMEZDciBfb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzOiBcdTAwRjZmZm5ldCBkZW4gU3VidHlwLVBpY2tlciwgc29iYWxkXHJcbi8vIGRlciBUWVAgbWluZGVzdGVucyBlaW5lbiByZWdpc3RyaWVydGVuIFN1YnR5cCBoYXQgKGluIGRlciBSZWloZW5mb2xnZSBkZXJcclxuLy8gQmxcdTAwRjZja2UgaW4gZGVyIFRZUC1EZXRhaWxhbnNpY2h0KS4gcXVlcnkgaXN0IGRpZSBTdWNoYW5mcmFnZSBhdXMgZGVtXHJcbi8vIFRZUC1QaWNrZXIsIG5hY2ggZGVyIGRpZSBMaXN0ZSB2b3Jzb3J0aWVydCB3aXJkIChzaWVoZSBzb3J0QnlRdWVyeSk6IHdlclxyXG4vLyBkb3J0IFwiTGVocnZlcmFuc3RhbHR1bmdcIiB0aXBwdGUgdW5kIHNvIHp1IE9SR0Ega2FtLCBtZWludGUgZGllc2VuIFN1YnR5cCB1bmRcclxuLy8gZmluZGV0IGlobiBoaWVyIG9iZW4gLSBFbnRlciBnZW5cdTAwRkNndC4gTFx1MDBGNnN0IGF1ZiBtaXRcclxuLy8gIC0gZGVtIGdld1x1MDBFNGhsdGVuIFN1YnR5cCxcclxuLy8gIC0gXCJcIiBmXHUwMEZDciBcIm9obmUgU3VidHlwXCIgKG9obmUgQW5mcmFnZSBkZXIgZXJzdGUgRWludHJhZyBkZXIgTGlzdGUpIC0gYnp3LlxyXG4vLyAgICBzb2ZvcnQsIG9obmUgUGlja2VyLCB3ZW5uIGRlciBUWVAgZ2FyIGtlaW5lIFN1YnR5cGVuIGhhdCxcclxuLy8gIC0gbnVsbCBiZWkgRVNDIChUWVAuanMga2VocnQgZGFubiB6dXIgVFlQLUF1c3dhaGwgenVyXHUwMEZDY2spLlxyXG5mdW5jdGlvbiBwaWNrU3VidHlwZShhcHAsIHBsdWdpbiwgdHlwZSwgcXVlcnkgPSBcIlwiKSB7XHJcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XHJcbiAgICBjb25zdCBpdGVtcyA9IHBsdWdpbi5nZXRTdWJ0eXBlcyh0eXBlKS5tYXAoKHsgc3VidHlwZSwgY291bnQgfSkgPT4gKHsgdHlwZTogc3VidHlwZSwgZGVzY3JpcHRpb246IFwiXCIsIGNvdW50IH0pKTtcclxuICAgIGlmIChpdGVtcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgcmVzb2x2ZShcIlwiKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgLy8gXCJvaG5lIFN1YnR5cFwiIGFuIGVyc3RlciBTdGVsbGU6IGRpZSBBdXN3YWhsIGlzdCBvaG5lIFRpcHBlbiBtaXQgRW50ZXJcclxuICAgIC8vIGVybGVkaWd0LCB1bmQgZGVyIEZhbGwgaXN0IGhcdTAwRTR1ZmlnZXIgYWxzIGplZGVyIGVpbnplbG5lIFN1YnR5cC5cclxuICAgIGNvbnN0IG5vbmVDb3VudCA9IHBsdWdpbi50eXBJbmRleC5zdWJ0eXBlQnVja2V0KHR5cGUpLm5vU3VidHlwZTtcclxuICAgIGl0ZW1zLnVuc2hpZnQoeyB0eXBlOiBcIm9obmUgU3VidHlwXCIsIGRlc2NyaXB0aW9uOiBcIlwiLCBjb3VudDogbm9uZUNvdW50LCBub25lOiB0cnVlIH0pO1xyXG4gICAgbmV3IFN1YnR5cFBpY2tlck1vZGFsKGFwcCwgcGx1Z2luLCB0eXBlLCBpdGVtcywgcmVzb2x2ZSwgcXVlcnkpLm9wZW4oKTtcclxuICB9KTtcclxufVxyXG5cclxuLy8gTmljaHQgaW4gcGx1Z2luLnNldHRpbmdzLnR5cGVzIHJlZ2lzdHJpZXJ0ZSBUWVBlbiwgZGllIGFiZXIgdGF0c1x1MDBFNGNobGljaCBpblxyXG4vLyBOb3RpemVuIHZvcmtvbW1lbiAtIGFuYWxvZyB6dSBkZW4gXCJ1bnJlZ2lzdHJpZXJ0ZW5cIiBaZWlsZW4gZGVyIFRZUC1MaXN0ZVxyXG4vLyAoc2llaGUgdW5yZWdpc3RlcmVkUm93cyBpbiB0eXAtdmlldy5qcykuIEtlaW5lIEJlc2NocmVpYnVuZy9GYXJiZSwgZGEgZlx1MDBGQ3JcclxuLy8gc2llIG5pY2h0cyBkZXJnbGVpY2hlbiBnZXBmbGVndCBpc3QuIExpc3RlbiB1bmQgV2VydGUgbWl0IFJhbmRsZWVyemVpY2hlblxyXG4vLyAoc2llaGUgaXNDbGVhbktleSBpbiB0eXAtaW5kZXguanMpIGJsZWliZW4gYXVcdTAwREZlbiB2b3IgLSBkZXIgZ2V3XHUwMEU0aGx0ZSBXZXJ0XHJcbi8vIHdpcmQgaW4gZWluZSBuZXVlIE5vdGl6IGdlc2NocmllYmVuIHVuZCBzb2xsIGRvcnQga2VpbiBBdWZyXHUwMEU0dW1mYWxsIHNlaW4uXHJcbmZ1bmN0aW9uIHVucmVnaXN0ZXJlZEl0ZW1zKGFwcCwgcGx1Z2luKSB7XHJcbiAgY29uc3QgcmVnaXN0ZXJlZCA9IG5ldyBTZXQocGx1Z2luLnNldHRpbmdzLnR5cGVzKTtcclxuICBjb25zdCB7IGNvdW50cyB9ID0gcGx1Z2luLnR5cEluZGV4LnR5cGVDb3VudHMoKTtcclxuICBjb25zdCBzb3J0T3JkZXIgPSBwbHVnaW4uc2V0dGluZ3MudHlwU29ydE9yZGVyID8/IERFRkFVTFRfU09SVF9PUkRFUjtcclxuICByZXR1cm4gWy4uLmNvdW50cy5rZXlzKCldXHJcbiAgICAuZmlsdGVyKCh0eXBlKSA9PiAhcmVnaXN0ZXJlZC5oYXModHlwZSkgJiYgcGx1Z2luLnR5cEluZGV4LmlzQ2xlYW5LZXkodHlwZSkpXHJcbiAgICAuc29ydCgoYSwgYikgPT4gY29tcGFyZVR5cGVzKHNvcnRPcmRlciwgYSwgYiwgY291bnRzLCBwbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9ycykpXHJcbiAgICAubWFwKCh0eXBlKSA9PiAoeyB0eXBlLCBkZXNjcmlwdGlvbjogXCJcIiwgY291bnQ6IGNvdW50cy5nZXQodHlwZSkgPz8gMCwgdW5yZWdpc3RlcmVkOiB0cnVlIH0pKTtcclxufVxyXG5cclxuLy8gRlx1MDBGQ3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qcyBzb3dpZSBcdTAwRkNiZXJhbGwgc29uc3QgaW0gUGx1Z2luLCB3b1xyXG4vLyBlaW4gZWluemVsbmVyIFRZUCBhdXNnZXdcdTAwRTRobHQgd2VyZGVuIG11c3MuIGluY2x1ZGVNYW51YWxPZmYgd2llIGJlaVxyXG4vLyBwbHVnaW4uZ2V0VHlwZXMoKTogVFlQZW4gbWl0IGRlYWt0aXZpZXJ0ZW0gXCJNYW51ZWxsZXIgVFlQXCItU2NoYWx0ZXIgc2luZFxyXG4vLyBzdGFuZGFyZG1cdTAwRTRcdTAwREZpZyBhdXNnZWtsYW1tZXJ0LiBpbmNsdWRlVW5yZWdpc3RlcmVkIGVyZ1x1MDBFNG56dCB6dXNcdTAwRTR0emxpY2ggVFlQZW4sXHJcbi8vIGRpZSBpbiBOb3RpemVuIHZvcmtvbW1lbiwgYWJlciBuaWNodCBpbiBkZXIgVFlQLUxpc3RlIHJlZ2lzdHJpZXJ0IHNpbmQgLVxyXG4vLyBtdXRlZCBkYXJnZXN0ZWxsdCwgZGEgZlx1MDBGQ3Igc2llIGtlaW5lIEZhcmJlL0Jlc2NocmVpYnVuZyBleGlzdGllcnQuIExcdTAwRjZzdCBtaXRcclxuLy8gZGVtIGdld1x1MDBFNGhsdGVuIFRZUCBhdWYsIG9kZXIgbWl0IG51bGwgYmVpIEFiYnJ1Y2ggYnp3LiBmYWxscyBlcyAoYXVjaCBtaXRcclxuLy8gZGVuIGdld1x1MDBFNGhsdGVuIE9wdGlvbmVuKSBrZWluZSBhbnp1emVpZ2VuZGVuIFRZUGVuIGdpYnQuIHNob3dTdWJ0eXBlcyBzdGVsbHRcclxuLy8gZGllIFN1YnR5cGVuIGRlcyBUWVBzIGhpbnRlciBkZXNzZW4gTmFtZW4gKHNpZWhlIHJlbmRlclN1YnR5cGVQcmV2aWV3KSAtXHJcbi8vIGdlZGFjaHQgZlx1MDBGQ3IgZGllIFRZUC1BdXN3YWhsIGRlcyBzZXBhcmF0ZW4gQWJsYXVmcywgd28gZGVyIFN1YnR5cC1QaWNrZXJcclxuLy8gZXJzdCBkYW5hY2gga29tbXQuXHJcbmZ1bmN0aW9uIHBpY2tUeXBlKGFwcCwgcGx1Z2luLCBvcHRpb25zID0ge30pIHtcclxuICByZXR1cm4gcGlja1R5cGVFbnRyeShhcHAsIHBsdWdpbiwgb3B0aW9ucykudGhlbigoZW50cnkpID0+IGVudHJ5Py50eXBlID8/IG51bGwpO1xyXG59XHJcblxyXG4vLyBXaWUgcGlja1R5cGUsIGxcdTAwRjZzdCBhYmVyIG1pdCB7IHR5cGUsIHF1ZXJ5IH0gYXVmIC0gcXVlcnkgaXN0LCB3YXMgYmVpIGRlclxyXG4vLyBBdXN3YWhsIGltIFN1Y2hmZWxkIHN0YW5kLiBOdXIgZlx1MDBGQ3IgcGlja1R5cGVBbmRTdWJ0eXBlOiBkb3J0IHRyXHUwMEU0Z3QgZGllXHJcbi8vIEFuZnJhZ2UgaW4gZGVuIFN1YnR5cC1QaWNrZXIgd2VpdGVyIChzaWVoZSBzb3J0QnlRdWVyeSksIGRlbm4gd2VyXHJcbi8vIFwiTGVocnZlcmFuc3RhbHR1bmdcIiB0aXBwdCwgbGFuZGV0IFx1MDBGQ2JlciBkaWUgU3VidHlwLVZvcnNjaGF1IGJlaSBPUkdBIHVuZFxyXG4vLyBtZWludCBkYW1pdCBkZW4gU3VidHlwLCBuaWNodCBibG9cdTAwREYgZGVuIFRZUC5cclxuZnVuY3Rpb24gcGlja1R5cGVFbnRyeShhcHAsIHBsdWdpbiwgb3B0aW9ucyA9IHt9KSB7XHJcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XHJcbiAgICBjb25zdCBpdGVtcyA9IHR5cGVJdGVtcyhhcHAsIHBsdWdpbiwgb3B0aW9ucyk7XHJcbiAgICBpZiAoIWl0ZW1zKSB7XHJcbiAgICAgIHJlc29sdmUobnVsbCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGNvbnN0IG1vZGFsID0gbmV3IFR5cFBpY2tlck1vZGFsKGFwcCwgcGx1Z2luLCBpdGVtcywgKHR5cGUpID0+IHJlc29sdmUodHlwZSA9PT0gbnVsbCA/IG51bGwgOiB7IHR5cGUsIHF1ZXJ5OiBtb2RhbC5xdWVyeSB9KSk7XHJcbiAgICBtb2RhbC5vcGVuKCk7XHJcbiAgfSk7XHJcbn1cclxuXHJcbi8vIEdlbWVpbnNhbWUgVFlQLUxpc3RlIGZcdTAwRkNyIHBpY2tUeXBlL3BpY2tUeXBlQW5kU3VidHlwZSAtIG51bGwgc2FtdCBOb3RpY2UsXHJcbi8vIGZhbGxzIGVzIChhdWNoIG1pdCBkZW4gZ2V3XHUwMEU0aGx0ZW4gT3B0aW9uZW4pIGtlaW5lIFRZUGVuIGdpYnQuXHJcbmZ1bmN0aW9uIHR5cGVJdGVtcyhhcHAsIHBsdWdpbiwgeyBpbmNsdWRlTWFudWFsT2ZmID0gZmFsc2UsIGluY2x1ZGVVbnJlZ2lzdGVyZWQgPSBmYWxzZSwgc2hvd1N1YnR5cGVzID0gZmFsc2UgfSA9IHt9KSB7XHJcbiAgY29uc3QgaXRlbXMgPSBwbHVnaW4uZ2V0VHlwZXMoeyBpbmNsdWRlTWFudWFsT2ZmIH0pLm1hcCgoaXRlbSkgPT4gKHsgLi4uaXRlbSwgdW5yZWdpc3RlcmVkOiBmYWxzZSB9KSk7XHJcbiAgaWYgKGluY2x1ZGVVbnJlZ2lzdGVyZWQpIGl0ZW1zLnB1c2goLi4udW5yZWdpc3RlcmVkSXRlbXMoYXBwLCBwbHVnaW4pKTtcclxuICAvLyBOdXIgcmVnaXN0cmllcnRlIFRZUGVuIGhhYmVuIGdlcGZsZWd0ZSBTdWJ0eXBlbiAtIGZcdTAwRkNyIGRpZSBcdTAwRkNicmlnZW4gYmxlaWJ0XHJcbiAgLy8gZGllIExpc3RlIGxlZXIgdW5kIGRpZSBaZWlsZSBkYW1pdCB1bnZlclx1MDBFNG5kZXJ0LlxyXG4gIGlmIChzaG93U3VidHlwZXMpIHtcclxuICAgIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcykgaXRlbS5zdWJ0eXBlcyA9IHBsdWdpbi5nZXRTdWJ0eXBlcyhpdGVtLnR5cGUpLm1hcCgoeyBzdWJ0eXBlIH0pID0+IHN1YnR5cGUpO1xyXG4gIH1cclxuICBpZiAoaXRlbXMubGVuZ3RoID4gMCkgcmV0dXJuIGl0ZW1zO1xyXG4gIG5ldyBOb3RpY2UoXCJLZWluZSBUWVBlbiB2b3JoYW5kZW4uXCIpO1xyXG4gIHJldHVybiBudWxsO1xyXG59XHJcblxyXG4vLyBGXHUwMEZDciBfb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzOiBUWVAgdW5kIFN1YnR5cCBpbiBlaW5lbSBadWcuIEplXHJcbi8vIG5hY2ggRWluc3RlbGx1bmcgc2VwYXJhdGVTdWJ0eXBlUGlja2VyIGVudHdlZGVyIGVpbiBlaW56aWdlciBQaWNrZXIgbWl0IGRlblxyXG4vLyBTdWJ0eXBlbiBlaW5nZXJcdTAwRkNja3QgdW50ZXIgaWhyZW0gVFlQIChTdGFuZGFyZCksIG9kZXIgd2llIGZyXHUwMEZDaGVyIGVyc3QgZGVyXHJcbi8vIFRZUC1QaWNrZXIgLSBkb3J0IG1pdCBkZW4gU3VidHlwZW4gZGVzIFRZUHMgaGludGVyIGRlc3NlbiBOYW1lbiwgZGFtaXQgbWFuXHJcbi8vIHNpZSBzY2hvbiB2b3IgZGVyIFdhaGwgc2llaHQgLSB1bmQgZGFuYWNoLCBmYWxscyBkZXIgVFlQIFN1YnR5cGVuIGhhdCwgZGVyXHJcbi8vIFN1YnR5cC1QaWNrZXIsIHZvcnNvcnRpZXJ0IG5hY2ggZGVyIFN1Y2hhbmZyYWdlIHZvbiBkb3J0IChFU0MgZlx1MDBGQ2hydCB6dXJcdTAwRkNja1xyXG4vLyB6dXIgVFlQLUF1c3dhaGwpLiBPcHRpb25lbiB3aWUgYmVpIHBpY2tUeXBlLiBMXHUwMEY2c3QgYXVmIG1pdFxyXG4vLyB7IHR5cGUsIHN1YnR5cGUgfSAoc3VidHlwZSBudWxsIGZcdTAwRkNyIFwib2huZSBTdWJ0eXBcIiksIG9kZXIgbWl0IG51bGwgYmVpXHJcbi8vIEFiYnJ1Y2guXHJcbmFzeW5jIGZ1bmN0aW9uIHBpY2tUeXBlQW5kU3VidHlwZShhcHAsIHBsdWdpbiwgb3B0aW9ucyA9IHt9KSB7XHJcbiAgaWYgKHBsdWdpbi5zZXR0aW5ncy5zZXBhcmF0ZVN1YnR5cGVQaWNrZXIpIHtcclxuICAgIHdoaWxlICh0cnVlKSB7XHJcbiAgICAgIGNvbnN0IGVudHJ5ID0gYXdhaXQgcGlja1R5cGVFbnRyeShhcHAsIHBsdWdpbiwgeyAuLi5vcHRpb25zLCBzaG93U3VidHlwZXM6IHRydWUgfSk7XHJcbiAgICAgIGlmICghZW50cnkpIHJldHVybiBudWxsO1xyXG4gICAgICBjb25zdCBzdWJ0eXBlID0gYXdhaXQgcGlja1N1YnR5cGUoYXBwLCBwbHVnaW4sIGVudHJ5LnR5cGUsIGVudHJ5LnF1ZXJ5KTtcclxuICAgICAgaWYgKHN1YnR5cGUgIT09IG51bGwpIHJldHVybiB7IHR5cGU6IGVudHJ5LnR5cGUsIHN1YnR5cGU6IHN1YnR5cGUgfHwgbnVsbCB9O1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgY29uc3QgaXRlbXMgPSB0eXBlSXRlbXMoYXBwLCBwbHVnaW4sIG9wdGlvbnMpO1xyXG4gIGlmICghaXRlbXMpIHJldHVybiBudWxsO1xyXG4gIGNvbnN0IGdyb3VwcyA9IGl0ZW1zLm1hcCgoaXRlbSkgPT4gKHtcclxuICAgIGl0ZW0sXHJcbiAgICBzdWJ0eXBlczogcGx1Z2luLmdldFN1YnR5cGVzKGl0ZW0udHlwZSkubWFwKCh7IHN1YnR5cGUsIGNvdW50IH0pID0+ICh7IHR5cGU6IGl0ZW0udHlwZSwgc3VidHlwZSwgY291bnQgfSkpLFxyXG4gIH0pKTtcclxuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IG5ldyBUeXBTdWJ0eXBQaWNrZXJNb2RhbChhcHAsIHBsdWdpbiwgZ3JvdXBzLCByZXNvbHZlKS5vcGVuKCkpO1xyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IHsgcGlja1R5cGUsIHBpY2tTdWJ0eXBlLCBwaWNrVHlwZUFuZFN1YnR5cGUgfTtcclxuIiwgImNvbnN0IHsgVEZpbGUsIFZhdWx0LCBkZWJvdW5jZSwgbm9ybWFsaXplUGF0aCB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuXG4vLyBOdXIgVGVtcGxhdGVyLVNrcmlwdGUgbWl0IGRpZXNlbSBNYXJrZXIgaW4gZWluZW0gS29tbWVudGFyIHdlcmRlbiBpbVxuLy8gU2hvcnRjdXQtTW9kYWwgKHNob3J0Y3V0LXBpY2tlci5qcykgYW5nZWJvdGVuIC0gcmVpbmUgSGlsZnNza3JpcHRlICh6LiBCLlxuLy8gdG9MaXN0SWZNdWx0aXBsZSwgVFlQIHNlbGJzdCkgZXJnZWJlbiBhbHMgU2hvcnRjdXQga2VpbmVuIFNpbm4uIERlciBUZXh0XG4vLyBoaW50ZXIgZGVtIE1hcmtlciBiaXMgenVtIFplaWxlbmVuZGUgZGllbnQgYWxzIEJlc2NocmVpYnVuZyBpbiBkZXIgTGlzdGU7XG4vLyBmZWhsdCBlciwgc3RlaHQgZG9ydCBudXIgZGVyIFNrcmlwdG5hbWUuIEVpbiBhYnNjaGxpZVx1MDBERmVuZGVzIFwiKi9cIiBlaW5lc1xuLy8gQmxvY2trb21tZW50YXJzIGdlaFx1MDBGNnJ0IG5pY2h0IHp1ciBCZXNjaHJlaWJ1bmcuXG4vL1xuLy8gT3B0aW9uYWwgZm9sZ3QgZGlyZWt0IGF1ZiBkZW4gTWFya2VyIGVpbmUgUGFyYW1ldGVybGlzdGUgaW4gS2xhbW1lcm4uIFNpZVxuLy8gYmVzY2hyZWlidCBkaWUgVk9MTFNUXHUwMEM0TkRJR0UgQXJndW1lbnRsaXN0ZSBkZXMgQXVmcnVmcyBuYWNoIFwidHBcIiAtIGFsc28gbmljaHRcbi8vIG51ciBkaWUgYWJnZWZyYWd0ZW4gV2VydGUsIHNvbmRlcm4gYXVjaCwgYW4gd2VsY2hlciBTdGVsbGUgZGFzIFNrcmlwdCBkaWVcbi8vIERhdGVpIGJ6dy4gZGVuIEtvbnRleHQgaGFiZW4gd2lsbCAoc2llaGUgUkVTRVJWRURfUEFSQU1TIGluIHNob3J0Y3V0cy5qcyk6XG4vLyAgIC8vIEB0eXAtc2hvcnRjdXQob3JkbmVyLCBqYWhyKSAgICAgICAtPiBmKHRwLCBcIkxpdGVyYXR1clwiLCAyMDI0KVxuLy8gICAvLyBAdHlwLXNob3J0Y3V0KG5ld0ZpbGUsIGphaHIpICAgICAgLT4gZih0cCwgbmV3RmlsZSwgMjAyNClcbi8vICAgLy8gQHR5cC1zaG9ydGN1dChwcm9wZXJ0eSkgICAgICAgICAgIC0+IGYodHAsIFwiRmFtaWxpZVwiKVxuLy8gICAvLyBAdHlwLXNob3J0Y3V0ICAgICAgICAgICAgICAgICAgICAgLT4gZih0cCwgbmV3RmlsZSwgY3R4KVxuLy8gRGFkdXJjaCBiZWtvbW10IGplZGVzIFNrcmlwdCBzZWluZSBlaWdlbmVuIFBhcmFtZXRlciBpbiBzZWluZXIgZWlnZW5lblxuLy8gUmVpaGVuZm9sZ2UsIHN0YXR0IHNpY2ggZWluZXIgZmVzdGVuIEtvbnZlbnRpb24gYmV1Z2VuIHp1IG1cdTAwRkNzc2VuLlxuLy9cbi8vIFVudGVyc2NoaWVkZW4gd2lyZCB6d2lzY2hlbiBcImdhciBrZWluZSBLbGFtbWVyblwiIChwYXJhbXMgPT09IG51bGwsIGRlclxuLy8gaGVya1x1MDBGNm1tbGljaGUgQXVmcnVmIGYodHAsIG5ld0ZpbGUsIGN0eCkgLSBzbyB2ZXJoYWx0ZW4gc2ljaCBhbGxlIGJpc2hlclxuLy8gbWFya2llcnRlbiBTa3JpcHRlIHVudmVyXHUwMEU0bmRlcnQpIHVuZCBcImxlZXJlIEtsYW1tZXJuXCIgKHBhcmFtcyA9PT0gW10sIGVpblxuLy8gQXVmcnVmIGdhbnogb2huZSBBcmd1bWVudGUgYXVcdTAwREZlciB0cCkuXG4vL1xuLy8gRGVyIE1hcmtlciBtdXNzIHVubWl0dGVsYmFyIGF1ZiBkZW4gS29tbWVudGFyYmVnaW5uIGZvbGdlbi4gRWluZSBmclx1MDBGQ2hlcmVcbi8vIEZhc3N1bmcgZXJsYXVidGUgYmVsaWViaWdlbiBUZXh0IGRhdm9yIC0gZGFtaXQgZ2VuXHUwMEZDZ3RlIGFiZXIgc2Nob24gZWluZVxuLy8gRXJ3XHUwMEU0aG51bmcgaW4gRmxpZVx1MDBERnRleHQgKFwiLi4uIGluIHNlaW5lbSBAdHlwLXNob3J0Y3V0LU1hcmtlciBkZWtsYXJpZXJ0XCIpLFxuLy8gdW0gZWluIFNrcmlwdCB1bmdld29sbHQgYWxzIFNob3J0Y3V0IGFuenViaWV0ZW4uIEdlbmF1IGRhcyBpc3QgVFlQLmpzXG4vLyBwYXNzaWVydCwgZGVzc2VuIEtvcGZrb21tZW50YXIgZGllIEtvbnZlbnRpb24gYmVzY2hyZWlidC4gQWxsZSB0YXRzXHUwMEU0Y2hsaWNoXG4vLyBtYXJraWVydGVuIFNrcmlwdGUgc2NocmVpYmVuIGRlbiBNYXJrZXIgb2huZWhpbiBhbiBkZW4gWmVpbGVuYW5mYW5nLlxuLy9cbi8vIFwiXFxiXCIgaGludGVyIGRlbSBNYXJrZXJuYW1lbiB2ZXJoaW5kZXJ0LCBkYXNzIFwiQHR5cC1zaG9ydGN1dFhZWlwiIGFuc2NobFx1MDBFNGd0LFxuLy8gdW5kIHN0XHUwMEY2cnQgZGllIGRpcmVrdCBmb2xnZW5kZSBLbGFtbWVyIG5pY2h0ICh0IC0+ICggaXN0IGVpbmUgV29ydGdyZW56ZSkuXG5jb25zdCBTSE9SVENVVF9NQVJLRVIgPSAvXlsgXFx0XSooPzpcXC9cXC8rfFxcL1xcKit8XFwqKVsgXFx0XSpAdHlwLXNob3J0Y3V0XFxiKD86XFwoKFteKV0qKVxcKSk/WyBcXHRdKiguKj8pWyBcXHRdKig/OlxcKlxcLyk/WyBcXHRdKiQvbTtcblxuLy8gUGFyYW1ldGVybmFtZW4gYXVzIGRlciBLbGFtbWVyIGRlcyBNYXJrZXJzLCBpbiBEZWtsYXJhdGlvbnNyZWloZW5mb2xnZS5cbi8vIExlZXJlIEVpbnRyXHUwMEU0Z2UgKHouIEIuIGJlaSBcIigpXCIgb2RlciBlaW5lbSBcdTAwRkNiZXJ6XHUwMEU0aGxpZ2VuIEtvbW1hKSBmYWxsZW4gd2VnO1xuLy8gZWluIHZlcnNlaGVudGxpY2ggZG9wcGVsdCBnZW5hbm50ZXIgTmFtZSBlcmdcdTAwRTRiZSB6d2VpIEVpbmdhYmVmZWxkZXIsIGRpZVxuLy8gYmVpZGUgZGVuc2VsYmVuIEVpbnRyYWcgc2NocmVpYmVuLCB1bmQgYmxlaWJ0IGRlc2hhbGIgbnVyIGVpbm1hbCBzdGVoZW4uXG5mdW5jdGlvbiBwYXJzZVBhcmFtcyhyYXcpIHtcbiAgY29uc3QgbmFtZW4gPSAocmF3ID8/IFwiXCIpXG4gICAgLnNwbGl0KFwiLFwiKVxuICAgIC5tYXAoKG5hbWUpID0+IG5hbWUudHJpbSgpKVxuICAgIC5maWx0ZXIoKG5hbWUpID0+IG5hbWUgIT09IFwiXCIpO1xuICByZXR1cm4gWy4uLm5ldyBTZXQobmFtZW4pXTtcbn1cblxuLy8gSFx1MDBFNGx0IGRpZSBMaXN0ZSBkZXIgYWxzIFNob3J0Y3V0IG1hcmtpZXJ0ZW4gVGVtcGxhdGVyLVNrcmlwdGUgYWt0dWVsbC5cbi8vXG4vLyBEaWUgTGlzdGUgd2lyZCB2b3JhYiAoYXN5bmNocm9uKSBhdXMgVGVtcGxhdGVycyBTa3JpcHQtT3JkbmVyIGdlbGVzZW4gdW5kIGJlaVxuLy8gXHUwMEM0bmRlcnVuZ2VuIGRhcmluIG5hY2hnZWZcdTAwRkNocnQsIHN0YXR0IHNpZSBlcnN0IGJlaW0gXHUwMEQ2ZmZuZW4gZGVzIE1vZGFscyB6dVxuLy8gZXJtaXR0ZWxuIC0gc28gaXN0IHNpZSBkb3J0IG9obmUgV2FydGV6ZWl0IGRhLCB1bmQgZGFzIE1vZGFsIGJsZWlidCBmcmVpIHZvblxuLy8gRGF0ZWl6dWdyaWZmZW4uIExpZWZlcnQgZWluZW4gQWNjZXNzb3IgYXVmIGRpZSBqZXdlaWxzIGFrdHVlbGxlIExpc3RlXG4vLyAoW3sgbmFtZSwgcGFyYW1zLCBkZXNjcmlwdGlvbiB9XSwgbmFjaCBOYW1lbiBzb3J0aWVydCkuXG5mdW5jdGlvbiByZWdpc3RlclNob3J0Y3V0U2NyaXB0cyhwbHVnaW4pIHtcbiAgY29uc3QgeyBhcHAgfSA9IHBsdWdpbjtcblxuICBsZXQgc2NyaXB0Rm9sZGVyID0gbnVsbDtcbiAgbGV0IHNjcmlwdHMgPSBbXTtcblxuICBjb25zdCBjdXJyZW50U2NyaXB0Rm9sZGVyID0gKCkgPT4ge1xuICAgIGNvbnN0IGZvbGRlciA9IGFwcC5wbHVnaW5zLnBsdWdpbnNbXCJ0ZW1wbGF0ZXItb2JzaWRpYW5cIl0/LnNldHRpbmdzPy51c2VyX3NjcmlwdHNfZm9sZGVyO1xuICAgIHJldHVybiBmb2xkZXIgPyBub3JtYWxpemVQYXRoKGZvbGRlcikgOiBudWxsO1xuICB9O1xuXG4gIGNvbnN0IGlzSW5TY3JpcHRGb2xkZXIgPSAocGF0aCkgPT4gISFzY3JpcHRGb2xkZXIgJiYgISFwYXRoICYmIHBhdGguc3RhcnRzV2l0aChzY3JpcHRGb2xkZXIgKyBcIi9cIik7XG5cbiAgLy8gV2llIFRlbXBsYXRlciBzZWxic3Q6IGFsbGUgLmpzLURhdGVpZW4gaW0gU2tyaXB0LU9yZG5lciBpbmtsLlxuICAvLyBVbnRlcm9yZG5lcm4sIFNrcmlwdG5hbWUgPSBEYXRlaW5hbWUgb2huZSBFbmR1bmcuXG4gIGFzeW5jIGZ1bmN0aW9uIHJlZnJlc2hTY3JpcHRzKCkge1xuICAgIGNvbnN0IGZvbGRlclBhdGggPSBjdXJyZW50U2NyaXB0Rm9sZGVyKCk7XG4gICAgc2NyaXB0Rm9sZGVyID0gZm9sZGVyUGF0aDtcbiAgICBjb25zdCBmb2xkZXIgPSBmb2xkZXJQYXRoID8gYXBwLnZhdWx0LmdldEZvbGRlckJ5UGF0aChmb2xkZXJQYXRoKSA6IG51bGw7XG4gICAgY29uc3QgZmlsZXMgPSBbXTtcbiAgICBpZiAoZm9sZGVyKSB7XG4gICAgICBWYXVsdC5yZWN1cnNlQ2hpbGRyZW4oZm9sZGVyLCAoY2hpbGQpID0+IHtcbiAgICAgICAgaWYgKGNoaWxkIGluc3RhbmNlb2YgVEZpbGUgJiYgY2hpbGQuZXh0ZW5zaW9uID09PSBcImpzXCIpIGZpbGVzLnB1c2goY2hpbGQpO1xuICAgICAgfSk7XG4gICAgfVxuICAgIGNvbnN0IGZvdW5kID0gW107XG4gICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBtYXRjaCA9IChhd2FpdCBhcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKSkubWF0Y2goU0hPUlRDVVRfTUFSS0VSKTtcbiAgICAgICAgLy8gbWF0Y2hbMV0gaXN0IHVuZGVmaW5lZCwgd2VubiBnYXIga2VpbmUgS2xhbW1lcm4gZGFzdGVoZW4sIHVuZCBcIlwiIGJlaVxuICAgICAgICAvLyBsZWVyZW4gS2xhbW1lcm4gLSBkZXIgVW50ZXJzY2hpZWQgZW50c2NoZWlkZXQgXHUwMEZDYmVyIGRpZSBBdWZydWZmb3JtLlxuICAgICAgICBpZiAobWF0Y2gpIHtcbiAgICAgICAgICBmb3VuZC5wdXNoKHtcbiAgICAgICAgICAgIG5hbWU6IGZpbGUuYmFzZW5hbWUsXG4gICAgICAgICAgICBwYXJhbXM6IG1hdGNoWzFdID09PSB1bmRlZmluZWQgPyBudWxsIDogcGFyc2VQYXJhbXMobWF0Y2hbMV0pLFxuICAgICAgICAgICAgZGVzY3JpcHRpb246IG1hdGNoWzJdID8/IFwiXCIsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihgVFlQLVN5c3RlbTogVGVtcGxhdGVyLVNrcmlwdCAke2ZpbGUucGF0aH0gbmljaHQgbGVzYmFyYCwgZSk7XG4gICAgICB9XG4gICAgfVxuICAgIC8vIE9yZG5lciB6d2lzY2hlbnplaXRsaWNoIGluIFRlbXBsYXRlciB1bWdlc3RlbGx0OiBFcmdlYm5pcyB2ZXJ3ZXJmZW4sXG4gICAgLy8gZGVyIExhdWYgZlx1MDBGQ3IgZGVuIG5ldWVuIE9yZG5lciBpc3QgYmVyZWl0cyBhbmdlc3RvXHUwMERGZW4uXG4gICAgaWYgKGZvbGRlclBhdGggIT09IHNjcmlwdEZvbGRlcikgcmV0dXJuO1xuICAgIHNjcmlwdHMgPSBmb3VuZC5zb3J0KChhLCBiKSA9PiBhLm5hbWUubG9jYWxlQ29tcGFyZShiLm5hbWUpKTtcbiAgfVxuXG4gIGNvbnN0IHNjaGVkdWxlUmVmcmVzaCA9IGRlYm91bmNlKHJlZnJlc2hTY3JpcHRzLCAzMDAsIHRydWUpO1xuICBjb25zdCBvbkZpbGVDaGFuZ2UgPSAoZmlsZSwgb2xkUGF0aCkgPT4ge1xuICAgIGlmIChpc0luU2NyaXB0Rm9sZGVyKGZpbGU/LnBhdGgpIHx8IGlzSW5TY3JpcHRGb2xkZXIob2xkUGF0aCkpIHNjaGVkdWxlUmVmcmVzaCgpO1xuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJjcmVhdGVcIiwgb25GaWxlQ2hhbmdlKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC52YXVsdC5vbihcIm1vZGlmeVwiLCBvbkZpbGVDaGFuZ2UpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoYXBwLnZhdWx0Lm9uKFwiZGVsZXRlXCIsIG9uRmlsZUNoYW5nZSkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJyZW5hbWVcIiwgb25GaWxlQ2hhbmdlKSk7XG4gIGFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeShyZWZyZXNoU2NyaXB0cyk7XG5cbiAgcmV0dXJuICgpID0+IHtcbiAgICAvLyBUZW1wbGF0ZXItT3JkbmVyIGluendpc2NoZW4gdW1nZXN0ZWxsdDogZlx1MDBGQ3IgZGVuIG5cdTAwRTRjaHN0ZW4gQXVmcnVmXG4gICAgLy8gbmFjaGxhZGVuLCBqZXR6dCBub2NoIG1pdCBkZXIgYmlzaGVyaWdlbiBMaXN0ZSBhbnR3b3J0ZW4uXG4gICAgaWYgKGN1cnJlbnRTY3JpcHRGb2xkZXIoKSAhPT0gc2NyaXB0Rm9sZGVyKSBzY2hlZHVsZVJlZnJlc2goKTtcbiAgICByZXR1cm4gc2NyaXB0cztcbiAgfTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyU2hvcnRjdXRTY3JpcHRzLCBTSE9SVENVVF9NQVJLRVIsIHBhcnNlUGFyYW1zIH07XG4iLCAiY29uc3QgeyBQbHVnaW4gfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcclxuY29uc3QgeyBERUZBVUxUX1NFVFRJTkdTLCBUeXBTeXN0ZW1TZXR0aW5nVGFiIH0gPSByZXF1aXJlKFwiLi9zZXR0aW5nc1wiKTtcclxuY29uc3QgeyByZWdpc3RlckNvbW1hbmRzIH0gPSByZXF1aXJlKFwiLi9jb21tYW5kc1wiKTtcclxuY29uc3QgeyByZWdpc3RlclR5cFZpZXcsIHNvcnRUeXBlc0J5TW9kZSwgREVGQVVMVF9TT1JUX09SREVSIH0gPSByZXF1aXJlKFwiLi90eXAtdmlld1wiKTtcclxuY29uc3QgeyBUeXBJbmRleCwgc2V0Q2Fub25pY2FsUHJvcGVydHksIGRlbGV0ZVByb3BlcnR5LCBUWVBfUFJPUEVSVFksIFNVQlRZUF9QUk9QRVJUWSB9ID0gcmVxdWlyZShcIi4vdHlwLWluZGV4XCIpO1xyXG5jb25zdCB7IGdldFN1YnR5cGUsIGdldFN1YnR5cGVOYW1lcywgbWlncmF0ZUFib3ZlU3RhbmRhcmQsIG1pZ3JhdGVTdWJ0eXBlQ29sb3JTY2FsZSB9ID0gcmVxdWlyZShcIi4vc3VidHlwZXNcIik7XHJcbmNvbnN0IHsgREVGQVVMVF9TVUJUWVBFX0NPTE9SX1JBTkdFUyB9ID0gcmVxdWlyZShcIi4vdHlwZS1jb2xvcnNcIik7XHJcbmNvbnN0IHsgcmVnaXN0ZXJGaWxlRXhwbG9yZXJDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL2ZpbGUtZXhwbG9yZXItY29sb3JzXCIpO1xyXG5jb25zdCB7IHJlZ2lzdGVyR3JhcGhDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL2dyYXBoLWNvbG9yc1wiKTtcclxuY29uc3QgeyByZWdpc3RlclNlYXJjaENvbG9ycyB9ID0gcmVxdWlyZShcIi4vc2VhcmNoLWNvbG9yc1wiKTtcclxuY29uc3QgeyByZWdpc3RlclJlY2VudEZpbGVzQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9yZWNlbnQtZmlsZXMtY29sb3JzXCIpO1xyXG5jb25zdCB7IHJlZ2lzdGVyQmFja2xpbmtDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL2JhY2tsaW5rLWNvbG9yc1wiKTtcclxuY29uc3QgeyByZWdpc3RlckJvb2ttYXJrc0NvbG9ycyB9ID0gcmVxdWlyZShcIi4vYm9va21hcmstY29sb3JzXCIpO1xyXG5jb25zdCB7IHJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL2FjdGl2ZS10aXRsZS1jb2xvcnNcIik7XHJcbmNvbnN0IHsgcmVnaXN0ZXJMaW5rQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9saW5rLWNvbG9yc1wiKTtcclxuY29uc3QgeyByZWdpc3RlckZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodCB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItZGVmYXVsdC1oaWdobGlnaHRcIik7XHJcbmNvbnN0IHsgcmVnaXN0ZXJQcm9wZXJ0eVJlbmFtZVN5bmMgfSA9IHJlcXVpcmUoXCIuL3Byb3BlcnR5LXJlbmFtZS1zeW5jXCIpO1xyXG5jb25zdCB7IG5vcm1hbGl6ZUdsb2JhbE9yZGVyLCBzb3J0RnJvbnRtYXR0ZXJGb3IsIHBsYWNlUHJvcGVydHlGb3IgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLXNvcnRcIik7XHJcbmNvbnN0IHsgcmVzb2x2ZVNob3J0Y3V0cywgc2NyaXB0TmFtZU9mLCByZXNvbHZlQ2FsbEFyZ3MgfSA9IHJlcXVpcmUoXCIuL3Nob3J0Y3V0c1wiKTtcclxuY29uc3Qge1xyXG4gIHBpY2tUeXBlOiBwaWNrVHlwZU1vZGFsLFxyXG4gIHBpY2tTdWJ0eXBlOiBwaWNrU3VidHlwZU1vZGFsLFxyXG4gIHBpY2tUeXBlQW5kU3VidHlwZTogcGlja1R5cGVBbmRTdWJ0eXBlTW9kYWwsXHJcbn0gPSByZXF1aXJlKFwiLi90eXBlLXBpY2tlclwiKTtcclxuY29uc3QgeyByZWdpc3RlclNob3J0Y3V0U2NyaXB0cyB9ID0gcmVxdWlyZShcIi4vc2hvcnRjdXQtc2NyaXB0c1wiKTtcclxuXHJcbi8vIE1pZ3JpZXJ0IEJlc3RhbmRzaW5zdGFsbGF0aW9uZW4gdm9uIGRlciBhbHRlbiwgc2VwYXJhdGVuXHJcbi8vIHR5cGVGbG9hdGluZ0Zyb250bWF0dGVyLUxpc3RlIChlaWdlbmVzIERpY3QgamUgVHlwLCBpbW1lciBoaW50ZXIgZGVyXHJcbi8vIFN0YW5kYXJkbGlzdGUgc29ydGllcnQpIGF1ZiBkaWUgbmV1ZSB0eXBlRmxvYXRpbmdLZXlzLU1hcmtpZXJ1bmcgaW5uZXJoYWxiXHJcbi8vIGRlcnNlbGJlbiB0eXBlRGVmYXVsdEZyb250bWF0dGVyLUxpc3RlIChzaWVoZSBLb21tZW50YXIgYW4gdHlwZUZsb2F0aW5nS2V5c1xyXG4vLyBpbiBzZXR0aW5ncy5qcykgLSBkaWUgRmxvYXRpbmcgUHJvcGVydGllcyBsYW5kZW4gZGFiZWkgdW52ZXJcdTAwRTRuZGVydCBkaXJla3RcclxuLy8gaW0gQW5zY2hsdXNzIGFuIGRpZSBiaXNoZXJpZ2UgU3RhbmRhcmRsaXN0ZSwgZ2VuYXUgd2llIHp1dm9yLlxyXG5mdW5jdGlvbiBtaWdyYXRlRmxvYXRpbmdGcm9udG1hdHRlcihzZXR0aW5ncykge1xyXG4gIGlmICghc2V0dGluZ3MudHlwZUZsb2F0aW5nRnJvbnRtYXR0ZXIpIHJldHVybjtcclxuICBmb3IgKGNvbnN0IFt0eXBlLCBmbG9hdGluZ10gb2YgT2JqZWN0LmVudHJpZXMoc2V0dGluZ3MudHlwZUZsb2F0aW5nRnJvbnRtYXR0ZXIpKSB7XHJcbiAgICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXMoZmxvYXRpbmcpLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwiXCIpO1xyXG4gICAgaWYgKGtleXMubGVuZ3RoID09PSAwKSBjb250aW51ZTtcclxuICAgIHNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV0gPSB7IC4uLihzZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdID8/IHt9KSwgLi4uZmxvYXRpbmcgfTtcclxuICAgIHNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV0gPSBbLi4ubmV3IFNldChbLi4uKHNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV0gPz8gW10pLCAuLi5rZXlzXSldO1xyXG4gIH1cclxuICBkZWxldGUgc2V0dGluZ3MudHlwZUZsb2F0aW5nRnJvbnRtYXR0ZXI7XHJcbn1cclxuXHJcbi8vIEF1cyBkZW0gZnJ1ZWhlcmVuIFNjaGFsdGVyIFwiQmVzY2hyZWlidW5ncy1UZXh0ZmVsZCBhbnplaWdlblwiIChCb29sZWFuKSBpc3RcclxuLy8gZGVyIGRyZWlzdHVmaWdlIE1vZHVzIGRlciB6d2VpdGVuIFNwYWx0ZSBnZXdvcmRlbiwgdW1nZXNjaGFsdGV0IHVlYmVyIGRlblxyXG4vLyBLbm9wZiBpbSBMaXN0ZW4tSGVhZGVyIChzaWVoZSBTRUNPTkRBUllfTU9ERVMgaW4gdHlwLXZpZXcuanMpLiBEZXIgYWx0ZSBXZXJ0XHJcbi8vIGtlbm50IG51ciB6d2VpIGRlciBkcmVpIFp1c3RhZW5kZSAtIHRydWUgd2lyZCB6dXIgQmVzY2hyZWlidW5nLCBmYWxzZSB6dVxyXG4vLyBcIm5pY2h0c1wiOyBcInN1YnR5cGVzXCIgZ2FiIGVzIGRhbWFscyBub2NoIG5pY2h0LiBMaWVmZXJ0IHRydWUgYmVpIGVpbmVyXHJcbi8vIEFlbmRlcnVuZywgZGFtaXQgZGVyIEF1ZnJ1ZmVyIHNpZSBnbGVpY2ggc2NocmVpYnQgdW5kIGRlciBhbHRlIFNjaGx1ZXNzZWxcclxuLy8gbmljaHQgaW4gZGF0YS5qc29uIGxpZWdlbiBibGVpYnQuXHJcbi8vXHJcbi8vIEdlcHJ1ZWZ0IHdpcmQgZ2VnZW4gc3RvcmVkIChkaWUgcm9oZW4gZ2VsYWRlbmVuIERhdGVuKSwgTklDSFQgZ2VnZW4gc2V0dGluZ3M6XHJcbi8vIGRvcnQgaGF0IE9iamVjdC5hc3NpZ24gZGVuIG5ldWVuIFNjaGx1ZXNzZWwgbGFlbmdzdCBhdXMgREVGQVVMVF9TRVRUSU5HU1xyXG4vLyBnZWZ1ZWxsdCwgXCJub2NoIG5pY2h0IGdlc2V0enRcIiB3YWVyZSBkYXJhbiBhbHNvIG5pZSB6dSBlcmtlbm5lbiB1bmQgZGVyIGFsdGVcclxuLy8gV2VydCBibGllYmUgc3RpbGxzY2h3ZWlnZW5kIGxpZWdlbi5cclxuZnVuY3Rpb24gbWlncmF0ZVR5cExpc3RTZWNvbmRhcnkoc2V0dGluZ3MsIHN0b3JlZCkge1xyXG4gIGlmIChzdG9yZWQ/LnR5cExpc3REZXNjcmlwdGlvbkVuYWJsZWQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZhbHNlO1xyXG4gIGlmIChzdG9yZWQudHlwTGlzdFNlY29uZGFyeSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICBzZXR0aW5ncy50eXBMaXN0U2Vjb25kYXJ5ID0gc3RvcmVkLnR5cExpc3REZXNjcmlwdGlvbkVuYWJsZWQgPyBcImRlc2NyaXB0aW9uXCIgOiBcIm5vbmVcIjtcclxuICB9XHJcbiAgZGVsZXRlIHNldHRpbmdzLnR5cExpc3REZXNjcmlwdGlvbkVuYWJsZWQ7XHJcbiAgcmV0dXJuIHRydWU7XHJcbn1cclxuXHJcbi8vIERpZSBBdXNyaWNodHVuZyBkZXIgU3VidHlwLVZvcnNjaGF1IHdhciBrdXJ6emVpdGlnIGVpbmUgZWlnZW5lIEVpbnN0ZWxsdW5nXHJcbi8vIHVuZCBpc3QgamV0enQgZWluIFN0eWxlIFNldHRpbmcgKGJvZHktS2xhc3NlLCBzaWVoZSBkZW4gQHNldHRpbmdzLUJsb2NrIGluXHJcbi8vIHN0eWxlcy5jc3MpIC0gZGFzIFBsdWdpbiBsaWVzdCBkZW4gU2NobHVlc3NlbCBuaWNodCBtZWhyLiBPaG5lIGRpZXNlc1xyXG4vLyBBdWZyYWV1bWVuIGJsaWViZSBlciB1ZWJlciBPYmplY3QuYXNzaWduIGluIGxvYWRTZXR0aW5ncyBkYXVlcmhhZnQgaW5cclxuLy8gZGF0YS5qc29uIHN0ZWhlbi5cclxuZnVuY3Rpb24gZHJvcFR5cExpc3RTdWJ0eXBlc0FsaWduKHNldHRpbmdzKSB7XHJcbiAgaWYgKHNldHRpbmdzLnR5cExpc3RTdWJ0eXBlc1JpZ2h0QWxpZ25lZCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7XHJcbiAgZGVsZXRlIHNldHRpbmdzLnR5cExpc3RTdWJ0eXBlc1JpZ2h0QWxpZ25lZDtcclxuICByZXR1cm4gdHJ1ZTtcclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBjbGFzcyBUeXBTeXN0ZW1QbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xyXG4gIGFzeW5jIG9ubG9hZCgpIHtcclxuICAgIGF3YWl0IHRoaXMubG9hZFNldHRpbmdzKCk7XHJcblxyXG4gICAgLy8gVm9yIGFsbGVuIFx1MDBGQ2JyaWdlbiBNb2R1bGVuOiBkaWUgcmVnaXN0cmllcmVuIHNpY2ggYXVmIGRlc3NlbiBcImNoYW5nZVwiLVxyXG4gICAgLy8gRXZlbnQgdW5kIGxlc2VuIFRZUC9TVUJUWVAgYXVzc2NobGllXHUwMERGbGljaCBkYXJcdTAwRkNiZXIgKHNpZWhlIHR5cC1pbmRleC5qcykuXHJcbiAgICB0aGlzLnR5cEluZGV4ID0gbmV3IFR5cEluZGV4KHRoaXMpO1xyXG4gICAgdGhpcy50eXBJbmRleC5yZWdpc3RlcigpO1xyXG5cclxuICAgIHJlZ2lzdGVyQ29tbWFuZHModGhpcyk7XHJcbiAgICB0aGlzLmFkZFNldHRpbmdUYWIobmV3IFR5cFN5c3RlbVNldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcclxuICAgIC8vIFVtYmVuZW5udW5nZW4gXHUwMEZDYmVyIFwiQWxsIHByb3BlcnRpZXNcIi9CYXNlcyBhdWNoIGlucyBUWVAtRnJvbnRtYXR0ZXJcclxuICAgIC8vIGRlciBUeXBlbiBcdTAwRkNiZXJuZWhtZW4gKHNpZWhlIHByb3BlcnR5LXJlbmFtZS1zeW5jLmpzKS5cclxuICAgIHJlZ2lzdGVyUHJvcGVydHlSZW5hbWVTeW5jKHRoaXMpO1xyXG4gICAgLy8gQWNjZXNzb3IgYXVmIGRpZSBhbHMgXCJAdHlwLXNob3J0Y3V0XCIgbWFya2llcnRlbiBUZW1wbGF0ZXItU2tyaXB0ZSwgZlx1MDBGQ3JcclxuICAgIC8vIGRhcyBBdXN3YWhsLU1vZGFsIGRlciBQcm9wZXJ0eS1aZWlsZW4gKHNpZWhlIHNob3J0Y3V0LXBpY2tlci5qcykuXHJcbiAgICB0aGlzLmdldFNob3J0Y3V0U2NyaXB0cyA9IHJlZ2lzdGVyU2hvcnRjdXRTY3JpcHRzKHRoaXMpO1xyXG5cclxuICAgIC8vIFNlcGFyYXQgZ2VoYWx0ZW4gKG5pY2h0IG51ciBUZWlsIHZvbiByZWZyZXNoRm5zKTogZGllIFRZUC1EZXRhaWxhbnNpY2h0XHJcbiAgICAvLyBicmF1Y2h0IG5hY2ggZGVtIE1vdW50ZW4gaWhyZXMgVFlQLUZyb250bWF0dGVyLUVkaXRvcnMgZ2V6aWVsdCBudXJcclxuICAgIC8vIGRpZXNlbiBlaW5lbiBSZWZyZXNoIChGZXR0LU1hcmtpZXJ1bmcgZGVyIFByb3BlcnR5LVplaWxlbikgLSBkYXMgZ2FuemVcclxuICAgIC8vIHJlZnJlc2hUeXBDb2xvcnMoKS1CXHUwMEZDbmRlbCB3XHUwMEZDcmRlIGRvcnQgYXVjaCB1bm5cdTAwRjZ0aWcgcmVnaXN0ZXJUeXBWaWV3J3NcclxuICAgIC8vIGVpZ2VuZW4gUmVuZGVyLVJlZnJlc2ggbWl0YW5zdG9cdTAwREZlbiB1bmQgc2ljaCBkYW1pdCBzZWxic3QgcmVrdXJzaXZcclxuICAgIC8vIGVybmV1dCByZW5kZXJuIChmXHUwMEZDaHJ0ZSB6dSBlaW5lbSBTdGFjayBPdmVyZmxvdyBiZWkgamVkZW0gVFlQLVx1MDBENmZmbmVuKS5cclxuICAgIHRoaXMucmVmcmVzaEZyb250bWF0dGVySGlnaGxpZ2h0ID0gcmVnaXN0ZXJGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQodGhpcyk7XHJcblxyXG4gICAgY29uc3QgcmVmcmVzaEZucyA9IFtcclxuICAgICAgcmVnaXN0ZXJUeXBWaWV3KHRoaXMpLFxyXG4gICAgICByZWdpc3RlckZpbGVFeHBsb3JlckNvbG9ycyh0aGlzKSxcclxuICAgICAgcmVnaXN0ZXJHcmFwaENvbG9ycyh0aGlzKSxcclxuICAgICAgcmVnaXN0ZXJTZWFyY2hDb2xvcnModGhpcyksXHJcbiAgICAgIHJlZ2lzdGVyUmVjZW50RmlsZXNDb2xvcnModGhpcyksXHJcbiAgICAgIHJlZ2lzdGVyQmFja2xpbmtDb2xvcnModGhpcyksXHJcbiAgICAgIHJlZ2lzdGVyQm9va21hcmtzQ29sb3JzKHRoaXMpLFxyXG4gICAgICByZWdpc3RlckFjdGl2ZVRpdGxlQ29sb3JzKHRoaXMpLFxyXG4gICAgICByZWdpc3RlckxpbmtDb2xvcnModGhpcyksXHJcbiAgICAgIHRoaXMucmVmcmVzaEZyb250bWF0dGVySGlnaGxpZ2h0LFxyXG4gICAgXTtcclxuICAgIHRoaXMucmVmcmVzaFR5cENvbG9ycyA9ICgpID0+IHJlZnJlc2hGbnMuZm9yRWFjaCgoZm4pID0+IGZuKCkpO1xyXG5cclxuICAgIC8vIERlciBAc2V0dGluZ3MtQmxvY2sgaW4gc3R5bGVzLmNzcyAoU3R5bGUgU2V0dGluZ3MsIHNpZWhlIGRvcnQpIHdpcmQgc29uc3RcclxuICAgIC8vIGplIG5hY2ggTGFkZXJlaWhlbmZvbGdlIHVlYmVyc2VoZW46IFN0eWxlIFNldHRpbmdzIGxpZXN0IGRpZSBTdHlsZXNoZWV0c1xyXG4gICAgLy8gYmVpbSBlaWdlbmVuIExhZGVuIHVuZCBkYW5hY2ggbnVyIG5vY2ggYmVpIFwiY3NzLWNoYW5nZVwiIC0gZGFzIGZldWVydCBhYmVyXHJcbiAgICAvLyBhdXNzY2hsaWVzc2xpY2ggZnVlciBUaGVtZXMgdW5kIFNuaXBwZXRzLCBuaWNodCBmdWVyIGRhcyBzdHlsZXMuY3NzIGVpbmVzXHJcbiAgICAvLyBQbHVnaW5zLiBXZXIgc3BhZXRlciBnZWxhZGVuIHdpcmQgYWxzIFN0eWxlIFNldHRpbmdzIChvZGVyIHBlciBIb3QtUmVsb2FkXHJcbiAgICAvLyBuZXUgZ2VsYWRlbiB3aXJkKSwgdGF1Y2h0IGRvcnQgYWxzbyBnYXIgbmljaHQgYXVmLiBcInBhcnNlLXN0eWxlLXNldHRpbmdzXCJcclxuICAgIC8vIGlzdCBkZXIgZGFmdWVyIHZvcmdlc2VoZW5lIEhvb2s7IG9obmUgaW5zdGFsbGllcnRlcyBTdHlsZSBTZXR0aW5ncyBob2VydFxyXG4gICAgLy8gbmllbWFuZCB6dSB1bmQgZGVyIEF1ZnJ1ZiB2ZXJwdWZmdCBmb2xnZW5sb3MuXHJcbiAgICAvL1xyXG4gICAgLy8gRXJzdCBpbSBuYWVjaHN0ZW4gVGljazogT2JzaWRpYW4gaGFlbmd0IGRhcyBzdHlsZXMuY3NzIGVpbmVzIFBsdWdpbnMgZXJzdFxyXG4gICAgLy8gTkFDSCBkZXNzZW4gb25sb2FkKCkgaW4gZGVuIERPTSAtIHN5bmNocm9uIGhpZXIgZ2VydWZlbiBmdWVuZGUgU3R5bGVcclxuICAgIC8vIFNldHRpbmdzIGRhcyBTdHlsZXNoZWV0IG5vY2ggZ2FyIG5pY2h0IHVuZCBsaWVzc2UgZGVuIEFic2Nobml0dCBhdXMuXHJcbiAgICAvLyBvbkxheW91dFJlYWR5IHRhdWd0IGRhZnVlciBuaWNodDogYmVpbSBIb3QtUmVsb2FkIGlzdCBkYXMgTGF5b3V0IGxhZW5nc3RcclxuICAgIC8vIGZlcnRpZywgZGVyIFJ1ZWNrcnVmIGxpZWZlIGFsc28gc29mb3J0IHVuZCBkYW1pdCBnZW5hdXNvIHp1IGZydWVoLlxyXG4gICAgY29uc3QgcGFyc2VTdHlsZVNldHRpbmdzID0gd2luZG93LnNldFRpbWVvdXQoKCkgPT4gdGhpcy5hcHAud29ya3NwYWNlLnRyaWdnZXIoXCJwYXJzZS1zdHlsZS1zZXR0aW5nc1wiKSwgMCk7XHJcbiAgICB0aGlzLnJlZ2lzdGVyKCgpID0+IHdpbmRvdy5jbGVhclRpbWVvdXQocGFyc2VTdHlsZVNldHRpbmdzKSk7XHJcbiAgfVxyXG5cclxuICBvbnVubG9hZCgpIHt9XHJcblxyXG4gIC8vIEZcdTAwRkNyIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanM6IGxpZWZlcnQgZGllIGltIFRZUC1WaWV3IHVudGVyXHJcbiAgLy8gXCJUWVAtRnJvbnRtYXR0ZXJcIiBoaW50ZXJsZWd0ZW4gUHJvcGVydGllcyBmXHUwMEZDciBkZW4gZ2VnZWJlbmVuIFRZUCwgZGFtaXRcclxuICAvLyBUZW1wbGF0ZXIgc2llIGJlaW0gQW5sZWdlbiBlaW5lciBuZXVlbiBOb3RpeiBcdTAwRkNiZXJuZWhtZW4ga2Fubiwgc3RhdHQgc2llIGRvcnRcclxuICAvLyBlaW4gendlaXRlcyBNYWwgenUgcGZsZWdlbi4gS29waWUgc3RhdHQgZGlyZWt0ZXIgUmVmZXJlbnosIGRhbWl0IGVpblxyXG4gIC8vIEF1ZnJ1ZmVyIGRpZSB6dXJcdTAwRkNja2dlZ2ViZW5lbiBXZXJ0ZSBnZWZhaHJsb3MgbXV0aWVyZW4ga2Fubiwgb2huZSBkaWVcclxuICAvLyBQbHVnaW4tU2V0dGluZ3MgenUgdmVyXHUwMEU0bmRlcm4uXHJcbiAgLy9cclxuICAvLyBQcm9wZXJ0aWVzIG1pdCBlaW5lbSBmZXN0ZW4gU2hvcnRjdXQgKHRvZGF5L25vdy9jcmVhdGVkLCBzaWVoZVxyXG4gIC8vIHNob3J0Y3V0cy5qcykgdHJhZ2VuIGRlc3NlbiBlcnN0IGhpZXIgYXVmZ2VsXHUwMEY2c3RlbiBXZXJ0IC0gbmljaHQgZGVuIGJlaW1cclxuICAvLyBTZXR6ZW4gZ1x1MDBGQ2x0aWdlbiwgZXMga29tbXQgYWxzbyBiZWkgamVkZW0gQXVmcnVmIGZyaXNjaCBCZXJlY2huZXRlcyBoZXJhdXMuXHJcbiAgLy8gUHJvcGVydGllcyBtaXQgZWluZW0gU2tyaXB0LVNob3J0Y3V0IHRyYWdlbiBudWxsOiBkaWUga2FubiBudXIgVGVtcGxhdGVyXHJcbiAgLy8gYXVmbFx1MDBGNnNlbiwgVFlQLmpzIGhvbHQgc2llIHNpY2ggXHUwMEZDYmVyIGdldFR5cGVTaG9ydGN1dHMoKSAodW50ZW4pIHVuZCBzZXR6dFxyXG4gIC8vIHNpZSBzZWxic3QgZWluLiBLZXkgdW5kIFBvc2l0aW9uIGJsZWliZW4gaW4gYmVpZGVuIEZcdTAwRTRsbGVuIGVyaGFsdGVuLlxyXG4gIC8vXHJcbiAgLy8gaW5jbHVkZUZsb2F0aW5nIChTdGFuZGFyZDogZmFsc2UpIGxcdTAwRTRzc3QgZGllIGFscyBcIkZsb2F0aW5nIFByb3BlcnR5XCJcclxuICAvLyBtYXJraWVydGVuIEtleXMgKHR5cGVGbG9hdGluZ0tleXMpIGluIGRlciBMaXN0ZSAtIGFuZGVycyBhbHMgZGllIFx1MDBGQ2JyaWdlblxyXG4gIC8vIFN0YW5kYXJkLVByb3BlcnRpZXMgd2VyZGVuIGRpZXNlIE5JQ0hUIGF1dG9tYXRpc2NoIGJlaSBqZWRlciBuZXVlbiBOb3RpelxyXG4gIC8vIGFuZ2VsZWd0IChzaWUgelx1MDBFNGhsZW4gendhciBmXHUwMEZDciBkaWUgRnJvbnRtYXR0ZXItU29ydGllcnVuZyBtaXQsIHNpZWhlXHJcbiAgLy8gb3JkZXJlZERlZmF1bHRLZXlzIGluIGZyb250bWF0dGVyLXNvcnQuanMsIHNvbGxlbiBhYmVyIG51ciBiZWkgQmVkYXJmXHJcbiAgLy8gZXhwbGl6aXQgdm9uIGVpbmVtIFRlbXBsYXRlci1Ta3JpcHQgYWJnZWdyaWZmZW4gd2VyZGVuKS5cclxuICAvL1xyXG4gIC8vIGZpbGUgKG9wdGlvbmFsKSB3aXJkIGFuIHJlc29sdmVTaG9ydGN1dHMoKSBkdXJjaGdlcmVpY2h0IC0gbnVyIGZcdTAwRkNyIGRlblxyXG4gIC8vIFwiY3JlYXRlZFwiLVNob3J0Y3V0IHJlbGV2YW50LCBkZXIgZGFzIEVyc3RlbGx1bmdzZGF0dW0gZGVyIFppZWwtRGF0ZWkgc3RhdHRcclxuICAvLyBkZXMgQXVmcnVmemVpdHB1bmt0cyBsaWVmZXJ0LlxyXG4gIC8vXHJcbiAgLy8gc3VidHlwZSAob3B0aW9uYWwpOiBlcmdcdTAwRTRuenQgZGFzIFRZUC1Gcm9udG1hdHRlciB1bSBkZW4gQmxvY2sgZGllc2VzXHJcbiAgLy8gU3VidHlwcyAoc2llaGUgc3VidHlwZXMuanMpLCBkZXNzZW4gS2V5cyBmb2xnZW4gZGFoaW50ZXIgKHdpY2h0aWcgZlx1MDBGQ3IgZGllXHJcbiAgLy8gUmVpaGVuZm9sZ2UgZGVyIFNrcmlwdC1TaG9ydGN1dHMpLiBTdGVodCBlaW4gS2V5IGluIEJFSURFTiBCbFx1MDBGNmNrZW4sIGJlaFx1MDBFNGx0XHJcbiAgLy8gZXIgZGllIFBvc2l0aW9uIGRlcyBUWVAtRnJvbnRtYXR0ZXJzLCBXZXJ0LCBGbG9hdGluZy1NYXJraWVydW5nIHVuZFxyXG4gIC8vIFNob3J0Y3V0IGtvbW1lbiBhYmVyIHZvbSBTdWJ0eXAgLSBlaW5lIFp1d2Vpc3VuZyBhdWYgZWluZW4gYmVyZWl0cyB2b3JoYW5kZW5lblxyXG4gIC8vIE9iamVrdHNjaGxcdTAwRkNzc2VsIFx1MDBGQ2JlcnNjaHJlaWJ0IGlobiwgb2huZSBpaG4genUgdmVyc2NoaWViZW4uIERpZVxyXG4gIC8vIEZyb250bWF0dGVyLVNvcnRpZXJ1bmcgbXVzcyBkaWVzZWxiZSBSZWdlbCB2ZXJ3ZW5kZW4sIHNvbnN0IHdcdTAwRkNyZGUgc2llXHJcbiAgLy8gZWluZSBnZXJhZGUgYW5nZWxlZ3RlIE5vdGl6IHNvZm9ydCB3aWVkZXIgdW1zb3J0aWVyZW4gKHNpZWhlXHJcbiAgLy8gb3JkZXJlZERlZmF1bHRLZXlzIGluIGZyb250bWF0dGVyLXNvcnQuanMpLlxyXG4gIGdldFR5cGVEZWZhdWx0cyh0eXBlLCB7IGluY2x1ZGVGbG9hdGluZyA9IGZhbHNlLCBmaWxlLCBzdWJ0eXBlID0gbnVsbCB9ID0ge30pIHtcclxuICAgIGNvbnN0IHsgZGVmYXVsdHMsIHNob3J0Y3V0cyB9ID0gdGhpcy5jb2xsZWN0QmxvY2tzKHR5cGUsIHN1YnR5cGUsIGluY2x1ZGVGbG9hdGluZyk7XHJcbiAgICByZXR1cm4gcmVzb2x2ZVNob3J0Y3V0cyhkZWZhdWx0cywgc2hvcnRjdXRzLCB7IGZpbGUsIGFwcDogdGhpcy5hcHAgfSk7XHJcbiAgfVxyXG5cclxuICAvLyBHZW1laW5zYW1lIEdydW5kbGFnZSB2b24gZ2V0VHlwZURlZmF1bHRzKCkgdW5kIGdldFR5cGVTaG9ydGN1dHMoKTogZGFzXHJcbiAgLy8gVFlQLUZyb250bWF0dGVyIGRlcyBUeXBzLCBlcmdcdTAwRTRuenQgdW0gZGVuIEJsb2NrIGRlcyBTdWJ0eXBzLiBFaW4gS2V5LCBkZXIgaW5cclxuICAvLyBCRUlERU4gQmxcdTAwRjZja2VuIHN0ZWh0LCBiZWhcdTAwRTRsdCBkaWUgUG9zaXRpb24gZGVzIFRZUC1Gcm9udG1hdHRlcnM7IFdlcnQsXHJcbiAgLy8gRmxvYXRpbmctTWFya2llcnVuZyBVTkQgU2hvcnRjdXQga29tbWVuIGRhbm4gdm9tIFN1YnR5cCAtIGF1Y2ggXCJrZWluXHJcbiAgLy8gU2hvcnRjdXRcIiBnaWx0IGRhYmVpIGFscyBBbmdhYmUgZGVzIFN1YnR5cHMgdW5kIGhlYnQgZGVuIGRlcyBUWVBzIGF1Zi5cclxuICBjb2xsZWN0QmxvY2tzKHR5cGUsIHN1YnR5cGUsIGluY2x1ZGVGbG9hdGluZykge1xyXG4gICAgY29uc3QgZGVmYXVsdHMgPSB7fTtcclxuICAgIGNvbnN0IHNob3J0Y3V0cyA9IHt9O1xyXG4gICAgY29uc3QgaXNGbG9hdGluZyA9IG5ldyBNYXAoKTtcclxuICAgIGNvbnN0IGFkZEJsb2NrID0gKGZyb250bWF0dGVyLCBmbG9hdGluZ0tleXMsIGJsb2NrU2hvcnRjdXRzKSA9PiB7XHJcbiAgICAgIGNvbnN0IGFjdHVhbEtleXMgPSBuZXcgTWFwKE9iamVjdC5rZXlzKGRlZmF1bHRzKS5tYXAoKGtleSkgPT4gW2tleS50b0xvd2VyQ2FzZSgpLCBrZXldKSk7XHJcbiAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGZyb250bWF0dGVyID8/IHt9KSkge1xyXG4gICAgICAgIGlmIChrZXkgPT09IFwiXCIpIGNvbnRpbnVlO1xyXG4gICAgICAgIGNvbnN0IHRhcmdldCA9IGFjdHVhbEtleXMuZ2V0KGtleS50b0xvd2VyQ2FzZSgpKSA/PyBrZXk7XHJcbiAgICAgICAgZGVmYXVsdHNbdGFyZ2V0XSA9IHZhbHVlO1xyXG4gICAgICAgIGlzRmxvYXRpbmcuc2V0KHRhcmdldCwgKGZsb2F0aW5nS2V5cyA/PyBbXSkuaW5jbHVkZXMoa2V5KSk7XHJcbiAgICAgICAgY29uc3QgcmVjb3JkID0gKGJsb2NrU2hvcnRjdXRzID8/IHt9KVtrZXldO1xyXG4gICAgICAgIGlmIChyZWNvcmQpIHNob3J0Y3V0c1t0YXJnZXRdID0gcmVjb3JkO1xyXG4gICAgICAgIGVsc2UgZGVsZXRlIHNob3J0Y3V0c1t0YXJnZXRdO1xyXG4gICAgICB9XHJcbiAgICB9O1xyXG4gICAgY29uc3Qgc3VidHlwZURhdGEgPSBzdWJ0eXBlID8gZ2V0U3VidHlwZSh0aGlzLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKSA6IG51bGw7XHJcbiAgICBhZGRCbG9jayhcclxuICAgICAgdGhpcy5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdLFxyXG4gICAgICB0aGlzLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV0sXHJcbiAgICAgIHRoaXMuc2V0dGluZ3MudHlwZVNob3J0Y3V0c1t0eXBlXVxyXG4gICAgKTtcclxuICAgIGlmIChzdWJ0eXBlRGF0YSkgYWRkQmxvY2soc3VidHlwZURhdGEuZnJvbnRtYXR0ZXIsIHN1YnR5cGVEYXRhLmZsb2F0aW5nS2V5cywgc3VidHlwZURhdGEuc2hvcnRjdXRzKTtcclxuXHJcbiAgICBpZiAoIWluY2x1ZGVGbG9hdGluZykge1xyXG4gICAgICBmb3IgKGNvbnN0IFtrZXksIGZsb2F0aW5nXSBvZiBpc0Zsb2F0aW5nKSB7XHJcbiAgICAgICAgaWYgKCFmbG9hdGluZykgY29udGludWU7XHJcbiAgICAgICAgZGVsZXRlIGRlZmF1bHRzW2tleV07XHJcbiAgICAgICAgZGVsZXRlIHNob3J0Y3V0c1trZXldO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4geyBkZWZhdWx0cywgc2hvcnRjdXRzIH07XHJcbiAgfVxyXG5cclxuICAvLyBGXHUwMEZDciBfb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzOiBkaWUgUHJvcGVydGllcyBkaWVzZXMgVFlQcywgZGVyZW5cclxuICAvLyBXZXJ0IGJlaW0gQW5sZWdlbiBlaW5lciBOb3RpeiB2b24gZWluZW0gVGVtcGxhdGVyLVNrcmlwdCBrb21tdCAtXHJcbiAgLy8geyBbUHJvcGVydHldOiB7IG5hbWUsIGFyZ3MsIGZhbGxiYWNrIH0gfSwgaW4gZGVyIFJlaWhlbmZvbGdlIGRlc1xyXG4gIC8vIFRZUC1Gcm9udG1hdHRlcnMgKGRpZSBTa3JpcHRlIGxhdWZlbiBuYWNoZWluYW5kZXIgdW5kIHNlaGVuIGRpZSBFcmdlYm5pc3NlXHJcbiAgLy8gZGVyIGpld2VpbHMgZnJcdTAwRkNoZXJlbikuXHJcbiAgLy9cclxuICAvLyAgIG5hbWUgICAgIFNrcmlwdG5hbWUsIGFsc28gdHAudXNlci48bmFtZT4gLSBvaG5lIFwidHAuXCItUHJcdTAwRTRmaXhcclxuICAvLyAgIHBhcmFtcyAgIGRpZSBpbSBAdHlwLXNob3J0Y3V0LU1hcmtlciBkZWtsYXJpZXJ0ZSBQYXJhbWV0ZXJsaXN0ZSBkZXNcclxuICAvLyAgICAgICAgICAgIFNrcmlwdHMgKHNpZWhlIHNob3J0Y3V0LXNjcmlwdHMuanMpLCBvZGVyIG51bGwgYmVpIGVpbmVtIE1hcmtlclxyXG4gIC8vICAgICAgICAgICAgb2huZSBLbGFtbWVybi4gU2llIHN0YW1tdCBhdXMgZGVtIGFrdHVlbGxlbiBTY2FuLCBuaWNodCBhdXMgZGVtXHJcbiAgLy8gICAgICAgICAgICBnZXNwZWljaGVydGVuIFJlY29yZCAtIGVpbmUgZ2VcdTAwRTRuZGVydGUgRGVrbGFyYXRpb24gd2lya3QgYWxzb1xyXG4gIC8vICAgICAgICAgICAgc29mb3J0LiBUWVAuanMgbWFjaHQgZGFyYXVzIG1pdCByZXNvbHZlU2hvcnRjdXRBcmdzKCkgdW50ZW4gZGllXHJcbiAgLy8gICAgICAgICAgICBBcmd1bWVudGxpc3RlIGRlcyBBdWZydWZzXHJcbiAgLy8gICBhcmdzICAgICBkaWUgZWluZ2V0aXBwdGVuIEFyZ3VtZW50ZSwgYmVuYW5udCBuYWNoIGRlbiBuaWNodCByZXNlcnZpZXJ0ZW5cclxuICAvLyAgICAgICAgICAgIFBhcmFtZXRlcm4uIExlZXJlcyBPYmpla3QsIHdlbm4ga2VpbmUgZ2VzZXR6dCBzaW5kOyBlaW4gbGVlclxyXG4gIC8vICAgICAgICAgICAgZ2VsYXNzZW5lcyBGZWxkIGZlaGx0IGRhcmluIGdhbnosIGRhbWl0IFwiYXJncy54ID8/IGZhbGxiYWNrXCJcclxuICAvLyAgICAgICAgICAgIGltIFNrcmlwdCB0clx1MDBFNGd0XHJcbiAgLy8gICBmYWxsYmFjayBkZXIgaW4gZGVyIFRZUC1BbnNpY2h0IGhpbnRlcmxlZ3RlIGZlc3RlIFdlcnQgZGVyIFByb3BlcnR5LiBOdXJcclxuICAvLyAgICAgICAgICAgIGFscyBSXHUwMERDQ0tGQUxMIGdlZGFjaHQ6IHNjaGxcdTAwRTRndCBkYXMgU2tyaXB0IGZlaGwgKGZlaGx0IG9kZXJcclxuICAvLyAgICAgICAgICAgIHdpcmZ0KSwgc2NocmVpYnQgVFlQLmpzIGlobiBzdGF0dCBlaW5lcyBsZWVyZW4gV2VydHMuIEVpblxyXG4gIC8vICAgICAgICAgICAgU2tyaXB0LCBkYXMgYmV3dXNzdCBudWxsL1wiXCIgbGllZmVydCAoei4gQi4gRVNDIGltIFBpY2tlciksIGlzdFxyXG4gIC8vICAgICAgICAgICAga2VpbiBGZWhsc2NobGFnIC0gZG9ydCBibGVpYnQgZGllIFByb3BlcnR5IGxlZXIuXHJcbiAgLy9cclxuICAvLyBEaWUgZmVzdGVuIFNob3J0Y3V0cyAodG9kYXkvbm93L2NyZWF0ZWQpIHRhdWNoZW4gaGllciBOSUNIVCBhdWY6IGRpZSBsXHUwMEY2c3RcclxuICAvLyBkYXMgUGx1Z2luIHNlbGJzdCBhdWYgdW5kIGxpZWZlcnQgc2llIGZlcnRpZyBcdTAwRkNiZXIgZ2V0VHlwZURlZmF1bHRzKCkuIERlc3NlblxyXG4gIC8vIFJcdTAwRkNja2dhYmUgZlx1MDBGQ2hydCBkaWUgU2tyaXB0LUtleXMgbWl0IGRlbSBXZXJ0IG51bGwgLSBLZXkgdW5kIFBvc2l0aW9uIGJsZWliZW5cclxuICAvLyBhbHNvIGVyaGFsdGVuLCBudXIgZGVyIFdlcnQga29tbXQgdm9uIGhpZXIuXHJcbiAgLy9cclxuICAvLyBPcHRpb25lbiB3aWUgYmVpIGdldFR5cGVEZWZhdWx0cygpOyBpbmNsdWRlRmxvYXRpbmcgc3RhbmRhcmRtXHUwMEU0XHUwMERGaWcgZmFsc2UsXHJcbiAgLy8gZGFtaXQgZlx1MDBGQ3IgZWluZSBGbG9hdGluZyBQcm9wZXJ0eSBuaWNodCB1bmdlZnJhZ3QgZWluIFNrcmlwdCBsXHUwMEU0dWZ0LlxyXG4gIGdldFR5cGVTaG9ydGN1dHModHlwZSwgeyBpbmNsdWRlRmxvYXRpbmcgPSBmYWxzZSwgc3VidHlwZSA9IG51bGwgfSA9IHt9KSB7XHJcbiAgICBjb25zdCB7IGRlZmF1bHRzLCBzaG9ydGN1dHMgfSA9IHRoaXMuY29sbGVjdEJsb2Nrcyh0eXBlLCBzdWJ0eXBlLCBpbmNsdWRlRmxvYXRpbmcpO1xyXG4gICAgY29uc3Qgc2tyaXB0ZSA9IHRoaXMuZ2V0U2hvcnRjdXRTY3JpcHRzPy4oKSA/PyBbXTtcclxuICAgIGNvbnN0IHJlc3VsdCA9IHt9O1xyXG4gICAgZm9yIChjb25zdCBba2V5LCByZWNvcmRdIG9mIE9iamVjdC5lbnRyaWVzKHNob3J0Y3V0cykpIHtcclxuICAgICAgY29uc3QgbmFtZSA9IHNjcmlwdE5hbWVPZihyZWNvcmQubmFtZSk7XHJcbiAgICAgIGlmIChuYW1lID09PSBudWxsKSBjb250aW51ZTtcclxuICAgICAgY29uc3Qgc2tyaXB0ID0gc2tyaXB0ZS5maW5kKChzKSA9PiBzLm5hbWUgPT09IG5hbWUpO1xyXG4gICAgICByZXN1bHRba2V5XSA9IHtcclxuICAgICAgICBuYW1lLFxyXG4gICAgICAgIHBhcmFtczogc2tyaXB0Py5wYXJhbXMgPz8gbnVsbCxcclxuICAgICAgICBhcmdzOiB7IC4uLihyZWNvcmQuYXJncyA/PyB7fSkgfSxcclxuICAgICAgICBmYWxsYmFjazogZGVmYXVsdHNba2V5XSA/PyBudWxsLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcblxyXG4gIC8vIEZcdTAwRkNyIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanM6IG1hY2h0IGF1cyBkZXIgUGFyYW1ldGVybGlzdGUgZWluZXNcclxuICAvLyBTaG9ydGN1dHMgZGllIEFyZ3VtZW50ZSBmXHUwMEZDciBkZW4gQXVmcnVmIHRwLnVzZXIuPG5hbWU+KHRwLCAuLi4pIC0gc2llaGVcclxuICAvLyByZXNvbHZlQ2FsbEFyZ3MgaW4gc2hvcnRjdXRzLmpzLiBEaWUgQXVmbFx1MDBGNnN1bmcgbGVidCBoaWVyIHN0YXR0IGluIFRZUC5qcyxcclxuICAvLyBkYW1pdCBkaWUgUmVnZWxuIChyZXNlcnZpZXJ0ZSBOYW1lbiwgUHVua3QtTmFtZW4gZlx1MDBGQ3IgT2JqZWt0LUFyZ3VtZW50ZSkgbnVyXHJcbiAgLy8gYW4gZWluZXIgU3RlbGxlIHN0ZWhlbjsgbmV3RmlsZSB1bmQgY3R4IGtlbm50IGFsbGVyZGluZ3MgbnVyIFRZUC5qcyB1bmRcclxuICAvLyByZWljaHQgc2llIGRlc2hhbGIgaGVyZWluLlxyXG4gIHJlc29sdmVTaG9ydGN1dEFyZ3MocGFyYW1zLCBhcmdzLCB7IG5ld0ZpbGUgPSBudWxsLCBjdHggPSBudWxsLCBrZXkgPSBudWxsIH0gPSB7fSkge1xyXG4gICAgcmV0dXJuIHJlc29sdmVDYWxsQXJncyhwYXJhbXMsIGFyZ3MsIHsgbmV3RmlsZSwgY3R4LCBrZXkgfSk7XHJcbiAgfVxyXG5cclxuICAvLyBGXHUwMEZDciBfb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzOiByZWdpc3RyaWVydGUgU3VidHlwZW4gZWluZXMgVFlQcyBpblxyXG4gIC8vIGRlciBSZWloZW5mb2xnZSBpaHJlciBCbFx1MDBGNmNrZSwgc2FtdCBOb3Rpei1BbnphaGwuXHJcbiAgZ2V0U3VidHlwZXModHlwZSkge1xyXG4gICAgY29uc3QgeyBjb3VudHMgfSA9IHRoaXMudHlwSW5kZXguc3VidHlwZUJ1Y2tldCh0eXBlKTtcclxuICAgIHJldHVybiBnZXRTdWJ0eXBlTmFtZXModGhpcy5zZXR0aW5ncywgdHlwZSkubWFwKChzdWJ0eXBlKSA9PiAoeyBzdWJ0eXBlLCBjb3VudDogY291bnRzLmdldChzdWJ0eXBlKSA/PyAwIH0pKTtcclxuICB9XHJcblxyXG4gIC8vIEZcdTAwRkNyIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanM6IFN1YnR5cC1QaWNrZXIgKHNpZWhlXHJcbiAgLy8gdHlwZS1waWNrZXIuanMpLiBMXHUwMEY2c3QgbWl0IGRlbSBnZXdcdTAwRTRobHRlbiBTdWJ0eXAgYXVmLCBtaXQgXCJcIiBmXHUwMEZDciBcIktlaW5cclxuICAvLyBTdWJ0eXBcIiAoYnp3LiBvaG5lIFBpY2tlciwgd2VubiBkZXIgVFlQIGtlaW5lIFN1YnR5cGVuIGhhdCksIG9kZXIgbWl0XHJcbiAgLy8gbnVsbCBiZWkgRVNDIChUWVAuanMga2VocnQgZGFubiB6dXIgVFlQLUF1c3dhaGwgenVyXHUwMEZDY2spLiBxdWVyeSAob3B0aW9uYWwpOlxyXG4gIC8vIGVpbmUgc2Nob24gZ2V0aXBwdGUgU3VjaGFuZnJhZ2UsIG5hY2ggZGVyIGRpZSBMaXN0ZSB2b3Jzb3J0aWVydCBzdGVodC5cclxuICBwaWNrU3VidHlwZSh0eXBlLCBxdWVyeSA9IFwiXCIpIHtcclxuICAgIHJldHVybiBwaWNrU3VidHlwZU1vZGFsKHRoaXMuYXBwLCB0aGlzLCB0eXBlLCBxdWVyeSk7XHJcbiAgfVxyXG5cclxuICAvLyBGXHUwMEZDciBfb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzLCBpbm5lcmhhbGIgdm9uIHByb2Nlc3NGcm9udE1hdHRlcjpcclxuICAvLyBzZXR6dCBUWVAgdW5kIFNVQlRZUCBpbiBlaW5oZWl0bGljaGVyIFNjaHJlaWJ3ZWlzZSAtIGVpbmUgYWJ3ZWljaGVuZFxyXG4gIC8vIGdlc2NocmllYmVuZSBQcm9wZXJ0eSAoXCJ0eXBcIiwgXCJTdWJ0eXBcIikgd2lyZCBhbiBpaHJlciBTdGVsbGUgdW1iZW5hbm50XHJcbiAgLy8gc3RhdHQgdmVyZG9wcGVsdC4gc3VidHlwZSBudWxsIGVudGZlcm50IGVpbmVuIHZvcmhhbmRlbmVuIFNVQlRZUC5cclxuICBhcHBseVR5cGVQcm9wZXJ0aWVzKGZyb250bWF0dGVyLCB0eXBlLCBzdWJ0eXBlKSB7XHJcbiAgICBzZXRDYW5vbmljYWxQcm9wZXJ0eShmcm9udG1hdHRlciwgVFlQX1BST1BFUlRZLCB0eXBlKTtcclxuICAgIGlmIChzdWJ0eXBlKSBzZXRDYW5vbmljYWxQcm9wZXJ0eShmcm9udG1hdHRlciwgU1VCVFlQX1BST1BFUlRZLCBzdWJ0eXBlKTtcclxuICAgIGVsc2UgZGVsZXRlUHJvcGVydHkoZnJvbnRtYXR0ZXIsIFNVQlRZUF9QUk9QRVJUWSk7XHJcbiAgfVxyXG5cclxuICAvLyBGXHUwMEZDciBfb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzLCBpbm5lcmhhbGIgdm9uIHByb2Nlc3NGcm9udE1hdHRlclxyXG4gIC8vIHVuZCBuYWNoIGFsbGVuIFx1MDBGQ2JyaWdlbiBcdTAwQzRuZGVydW5nZW46IGJyaW5ndCBkYXMgRnJvbnRtYXR0ZXIgaW4gZGllXHJcbiAgLy8gUmVpaGVuZm9sZ2UgZGVyIEZyb250bWF0dGVyLVNvcnRpZXJ1bmcgKGdsb2JhbGUgUmVpaGVuZm9sZ2UsIFRZUC1cclxuICAvLyBGcm9udG1hdHRlciBzYW10IFN1YnR5cC1CbG9jaykgLSBzb25zdCBsYW5kZW4gbmV1IGVyZ1x1MDBFNG56dGUgUHJvcGVydGllc1xyXG4gIC8vICh6LiBCLiBTVUJUWVAgaW4gZWluZXIgYmVzdGVoZW5kZW4gTm90aXopIGFtIEVuZGUuXHJcbiAgc29ydEZyb250bWF0dGVyKGZyb250bWF0dGVyLCB0eXBlLCBzdWJ0eXBlID0gbnVsbCkge1xyXG4gICAgcmV0dXJuIHNvcnRGcm9udG1hdHRlckZvcih0aGlzLCBmcm9udG1hdHRlciwgdHlwZSwgc3VidHlwZSk7XHJcbiAgfVxyXG5cclxuICAvLyBJbm5lcmhhbGIgdm9uIHByb2Nlc3NGcm9udE1hdHRlcjogc2V0enQgbnVyIGRpZSBQcm9wZXJ0eSBrZXkgYW4gaWhyZW5cclxuICAvLyBQbGF0eiBsYXV0IEZyb250bWF0dGVyLVNvcnRpZXJ1bmcgKFRZUC9TVUJUWVAgYXVzIGRlbSBPYmpla3Qgc2VsYnN0KSxcclxuICAvLyBhbGxlcyBcdTAwRENicmlnZSBibGVpYnQsIHdpZSBlcyBpc3QgLSB6LiBCLiBmXHUwMEZDciBGcmVkcyBQcm9wZXJ0eS1CYWNrbGlua2luZyxcclxuICAvLyBkYW1pdCBlaW5lIG5ldSBhbmdlbGVndGUgUHJvcGVydHkgbmljaHQgYW0gRW5kZSBsYW5kZXQuXHJcbiAgcGxhY2VQcm9wZXJ0eShmcm9udG1hdHRlciwga2V5KSB7XHJcbiAgICByZXR1cm4gcGxhY2VQcm9wZXJ0eUZvcih0aGlzLCBmcm9udG1hdHRlciwga2V5KTtcclxuICB9XHJcblxyXG4gIC8vIEZcdTAwRkNyIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanM6IGRpZSBpbSBUWVAtVmlldyByZWdpc3RyaWVydGVuIFRZUGVuXHJcbiAgLy8gc2FtdCBpaHJlciBkb3J0IGdlcGZsZWd0ZW4gQmVzY2hyZWlidW5nLCBzdGF0dCBzaWUgYXVzIF9vYnNpZGlhbi9UeXBlbi5tZCB6dSBwYXJzZW4gLVxyXG4gIC8vIGluIGRlcnNlbGJlbiBSZWloZW5mb2xnZSwgaW4gZGVyIHNpZSBhdWNoIGluIGRlciBUWVAtTGlzdGUgc2VsYnN0IGVyc2NoZWluZW5cclxuICAvLyAoYWt0dWVsbGUgU29ydGllcmVpbnN0ZWxsdW5nIGRvcnQsIHouIEIuIEhcdTAwRTR1Zmlna2VpdCBvZGVyIE5hbWUpLlxyXG4gIC8vXHJcbiAgLy8gVFlQZW4gbWl0IGRlYWt0aXZpZXJ0ZW0gXCJNYW51ZWxsZXIgVFlQXCItU2NoYWx0ZXIgKHNpZWhlIFRZUC1EZXRhaWxhbnNpY2h0KVxyXG4gIC8vIHNpbmQgbmljaHQgZlx1MDBGQ3IgZGllIG1hbnVlbGxlIEF1c3dhaGwgZ2VkYWNodCAoei4gQi4gYmVpbSBBbmxlZ2VuIGVpbmVyIG5ldWVuXHJcbiAgLy8gTm90aXopIHVuZCB3ZXJkZW4gZGVzaGFsYiBzdGFuZGFyZG1cdTAwRTRcdTAwREZpZyBhdXNnZWtsYW1tZXJ0IC0gQXVmcnVmZXIsIGRpZVxyXG4gIC8vIHRyb3R6ZGVtIGFsbGUgVFlQZW4gYnJhdWNoZW4sIFx1MDBGQ2JlcmdlYmVuIGluY2x1ZGVNYW51YWxPZmY6IHRydWUuXHJcbiAgZ2V0VHlwZXMoeyBpbmNsdWRlTWFudWFsT2ZmID0gZmFsc2UgfSA9IHt9KSB7XHJcbiAgICBjb25zdCB7IGNvdW50cyB9ID0gdGhpcy50eXBJbmRleC50eXBlQ291bnRzKCk7XHJcbiAgICBjb25zdCBzb3J0T3JkZXIgPSB0aGlzLnNldHRpbmdzLnR5cFNvcnRPcmRlciA/PyBERUZBVUxUX1NPUlRfT1JERVI7XHJcbiAgICByZXR1cm4gc29ydFR5cGVzQnlNb2RlKHRoaXMuc2V0dGluZ3MudHlwZXMsIHNvcnRPcmRlciwgY291bnRzLCB0aGlzLnNldHRpbmdzLnR5cGVDb2xvcnMpXHJcbiAgICAgIC5maWx0ZXIoKHR5cGUpID0+IGluY2x1ZGVNYW51YWxPZmYgfHwgKHRoaXMuc2V0dGluZ3MudHlwZU1hbnVhbCA/PyB7fSlbdHlwZV0gIT09IGZhbHNlKVxyXG4gICAgICAubWFwKCh0eXBlKSA9PiAoe1xyXG4gICAgICAgIHR5cGUsXHJcbiAgICAgICAgZGVzY3JpcHRpb246IHRoaXMuc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXSA/PyBcIlwiLFxyXG4gICAgICAgIGNvdW50OiBjb3VudHMuZ2V0KHR5cGUpID8/IDAsXHJcbiAgICAgIH0pKTtcclxuICB9XHJcblxyXG4gIC8vIEZcdTAwRkNyIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanM6IG5hdGl2ZXIgVFlQLVBpY2tlciAoc2llaGVcclxuICAvLyB0eXBlLXBpY2tlci5qcykgc3RhdHQgZGVyIHJlaW5lbiBUZXh0LUxpc3RlIGF1cyBnZXRUeXBlcygpICtcclxuICAvLyB0cC5zeXN0ZW0uc3VnZ2VzdGVyIC0gbWl0IFRZUC1GYXJiZS8tUHVua3QsIEJlc2NocmVpYnVuZyB1bmQgTm90aXotQW56YWhsXHJcbiAgLy8gamUgWmVpbGUuIGluY2x1ZGVNYW51YWxPZmYgd2llIGJlaSBnZXRUeXBlcygpLiBMXHUwMEY2c3QgbWl0IGRlbSBnZXdcdTAwRTRobHRlbiBUWVBcclxuICAvLyBhdWYsIG9kZXIgbWl0IG51bGwgYmVpIEFiYnJ1Y2ggKEVTQykuXHJcbiAgcGlja1R5cGUob3B0aW9ucykge1xyXG4gICAgcmV0dXJuIHBpY2tUeXBlTW9kYWwodGhpcy5hcHAsIHRoaXMsIG9wdGlvbnMpO1xyXG4gIH1cclxuXHJcbiAgLy8gRlx1MDBGQ3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qczogVFlQIHVuZCBTdWJ0eXAgaW4gZWluZW0gWnVnIChzaWVoZVxyXG4gIC8vIHR5cGUtcGlja2VyLmpzKSAtIGplIG5hY2ggRWluc3RlbGx1bmcgXCJTdWJ0eXAtUGlja2VyIHNlcGFyYXRcIiBlaW4gZWluemlnZXJcclxuICAvLyBQaWNrZXIgbWl0IGVpbmdlclx1MDBGQ2NrdGVuIFN1YnR5cGVuIG9kZXIgYmVpZGUgUGlja2VyIG5hY2hlaW5hbmRlci4gT3B0aW9uZW5cclxuICAvLyB3aWUgYmVpIHBpY2tUeXBlKCkuIExcdTAwRjZzdCBtaXQgeyB0eXBlLCBzdWJ0eXBlIH0gYXVmIChzdWJ0eXBlIG51bGwgZlx1MDBGQ3IgXCJvaG5lXHJcbiAgLy8gU3VidHlwXCIpLCBvZGVyIG1pdCBudWxsIGJlaSBBYmJydWNoIChFU0MpLlxyXG4gIHBpY2tUeXBlQW5kU3VidHlwZShvcHRpb25zKSB7XHJcbiAgICByZXR1cm4gcGlja1R5cGVBbmRTdWJ0eXBlTW9kYWwodGhpcy5hcHAsIHRoaXMsIG9wdGlvbnMpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgbG9hZFNldHRpbmdzKCkge1xyXG4gICAgY29uc3Qgc3RvcmVkID0gYXdhaXQgdGhpcy5sb2FkRGF0YSgpO1xyXG4gICAgdGhpcy5zZXR0aW5ncyA9IE9iamVjdC5hc3NpZ24oe30sIERFRkFVTFRfU0VUVElOR1MsIHN0b3JlZCk7XHJcbiAgICAvLyBPYmplY3QuYXNzaWduIGVyc2V0enQgdmVyc2NoYWNodGVsdGUgT2JqZWt0ZSBhbHMgR2FuemVzIC0gc3BcdTAwRTR0ZXJcclxuICAgIC8vIGhpbnp1Z2Vrb21tZW5lIEFuc2ljaHRlbiAoei4gQi4gY29sb3JWaWV3cy5saW5rcykgZmVobHRlbiBpbiBiZXJlaXRzXHJcbiAgICAvLyBnZXNwZWljaGVydGVuIEVpbnN0ZWxsdW5nZW4gc29uc3QgdW5kIHdcdTAwRTRyZW4gc3RpbGxzY2h3ZWlnZW5kIGF1cy5cclxuICAgIHRoaXMuc2V0dGluZ3MuY29sb3JWaWV3cyA9IHsgLi4uREVGQVVMVF9TRVRUSU5HUy5jb2xvclZpZXdzLCAuLi50aGlzLnNldHRpbmdzLmNvbG9yVmlld3MgfTtcclxuICAgIC8vIE1pZ3JpZXJ0IEJlc3RhbmRzaW5zdGFsbGF0aW9uZW4sIGRlcmVuIGdsb2JhbFByb3BlcnR5T3JkZXIgbm9jaCBhdXMgZGVyXHJcbiAgICAvLyBaZWl0IHZvciBcIlRZUCBhbHMgTGlzdGVuZWludHJhZ1wiIHN0YW1tdCAoc2llaGUgZnJvbnRtYXR0ZXItc29ydC5qcykuXHJcbiAgICB0aGlzLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIgPSBub3JtYWxpemVHbG9iYWxPcmRlcih0aGlzLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIpO1xyXG4gICAgbWlncmF0ZUZsb2F0aW5nRnJvbnRtYXR0ZXIodGhpcy5zZXR0aW5ncyk7XHJcbiAgICAvLyBTdWJ0eXAtQmxcdTAwRjZja2UgbGFnZW4gZnJcdTAwRkNoZXIgd2FobHdlaXNlIFx1MDBGQ2JlciBkZW0gVFlQLUZyb250bWF0dGVyOyBkYXMgc3RlaHRcclxuICAgIC8vIGpldHp0IGZlc3QgZ2FueiBvYmVuIChzaWVoZSBnZXRTZWN0aW9uT3JkZXIgaW4gc3VidHlwZXMuanMpLlxyXG4gICAgbWlncmF0ZUFib3ZlU3RhbmRhcmQodGhpcy5zZXR0aW5ncyk7XHJcbiAgICAvLyBBbmRlcnMgYWxzIGRpZSBcdTAwRkNicmlnZW4gTWlncmF0aW9uZW4gZ2xlaWNoIHNjaHJlaWJlbjogZGllIGVpbmUgcmVjaG5ldFxyXG4gICAgLy8gZ2VzcGVpY2hlcnRlIFphaGxlbiB1bSB1bmQgZGFyZiBkYXMgYmVpbSBuXHUwMEU0Y2hzdGVuIFN0YXJ0IG5pY2h0IGVybmV1dCB0dW4sXHJcbiAgICAvLyBkaWUgYW5kZXJlIGVudGZlcm50IGVpbmVuIFNjaGxcdTAwRkNzc2VsLCBkZXIgc29uc3QgYmVpIGplZGVtIFN0YXJ0IHdpZWRlclxyXG4gICAgLy8gZ2VsZXNlbiB3XHUwMEZDcmRlLlxyXG4gICAgY29uc3QgbWlncmF0ZWQgPSBbbWlncmF0ZVN1YnR5cGVDb2xvclNjYWxlKHRoaXMuc2V0dGluZ3MsIERFRkFVTFRfU1VCVFlQRV9DT0xPUl9SQU5HRVMpLCBtaWdyYXRlVHlwTGlzdFNlY29uZGFyeSh0aGlzLnNldHRpbmdzLCBzdG9yZWQpLCBkcm9wVHlwTGlzdFN1YnR5cGVzQWxpZ24odGhpcy5zZXR0aW5ncyldO1xyXG4gICAgaWYgKG1pZ3JhdGVkLnNvbWUoQm9vbGVhbikpIGF3YWl0IHRoaXMuc2F2ZVNldHRpbmdzKCk7XHJcbiAgfVxyXG5cclxuICBhc3luYyBzYXZlU2V0dGluZ3MoKSB7XHJcbiAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKHRoaXMuc2V0dGluZ3MpO1xyXG4gIH1cclxufTtcclxuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7O0FBQUE7QUFBQSxxQkFBQUEsVUFBQUMsU0FBQTtBQUFBLFFBQU0sRUFBRSxRQUFRLE9BQU8sU0FBUyxJQUFJLFFBQVEsVUFBVTtBQUV0RCxRQUFNQyxnQkFBZTtBQUNyQixRQUFNQyxtQkFBa0I7QUFDeEIsUUFBTSxjQUFjLE9BQU8sT0FBTyxFQUFFLFNBQVMsTUFBTSxTQUFTLE1BQU0sWUFBWSxNQUFNLFlBQVksS0FBSyxDQUFDO0FBS3RHLFFBQU0saUJBQWlCO0FBRXZCLGFBQVMsUUFBUSxPQUFPO0FBQ3RCLFVBQUksU0FBUyxLQUFNLFFBQU87QUFDMUIsYUFBTyxPQUFPLFVBQVUsV0FBVyxLQUFLLFVBQVUsS0FBSyxJQUFJLE9BQU8sS0FBSztBQUFBLElBQ3pFO0FBWUEsYUFBUyxVQUFVLE9BQU87QUFDeEIsVUFBSSxNQUFNLFFBQVEsS0FBSyxHQUFHO0FBQ3hCLGNBQU0sUUFBUSxNQUFNLElBQUksT0FBTztBQUMvQixZQUFJLE1BQU0sTUFBTSxDQUFDLFNBQVMsS0FBSyxLQUFLLE1BQU0sRUFBRSxFQUFHLFFBQU87QUFDdEQsZUFBTyxJQUFJLE1BQU0sS0FBSyxJQUFJLENBQUM7QUFBQSxNQUM3QjtBQUNBLFlBQU0sT0FBTyxRQUFRLEtBQUs7QUFDMUIsYUFBTyxLQUFLLEtBQUssTUFBTSxLQUFLLE9BQU87QUFBQSxJQUNyQztBQU1BLGFBQVMsY0FBYyxhQUFhLE1BQU07QUFDeEMsVUFBSSxDQUFDLFlBQWEsUUFBTztBQUN6QixVQUFJLE9BQU8sVUFBVSxlQUFlLEtBQUssYUFBYSxJQUFJLEVBQUcsUUFBTztBQUNwRSxZQUFNLFFBQVEsS0FBSyxZQUFZO0FBQy9CLGFBQU8sT0FBTyxLQUFLLFdBQVcsRUFBRSxLQUFLLENBQUMsUUFBUSxJQUFJLFlBQVksTUFBTSxLQUFLO0FBQUEsSUFDM0U7QUFFQSxhQUFTLGNBQWMsYUFBYSxNQUFNO0FBQ3hDLFlBQU0sTUFBTSxjQUFjLGFBQWEsSUFBSTtBQUMzQyxhQUFPLFFBQVEsU0FBWSxTQUFZLFlBQVksR0FBRztBQUFBLElBQ3hEO0FBT0EsYUFBU0Msc0JBQXFCLGFBQWEsTUFBTSxPQUFPO0FBQ3RELFlBQU0sUUFBUSxLQUFLLFlBQVk7QUFDL0IsWUFBTSxPQUFPLE9BQU8sS0FBSyxXQUFXO0FBQ3BDLFVBQUksQ0FBQyxLQUFLLEtBQUssQ0FBQyxRQUFRLFFBQVEsUUFBUSxJQUFJLFlBQVksTUFBTSxLQUFLLEdBQUc7QUFDcEUsb0JBQVksSUFBSSxJQUFJO0FBQ3BCO0FBQUEsTUFDRjtBQUNBLFlBQU0sV0FBVyxFQUFFLEdBQUcsWUFBWTtBQUNsQyxpQkFBVyxPQUFPLEtBQU0sUUFBTyxZQUFZLEdBQUc7QUFDOUMsaUJBQVcsT0FBTyxNQUFNO0FBQ3RCLFlBQUksSUFBSSxZQUFZLE1BQU0sTUFBTyxhQUFZLEdBQUcsSUFBSSxTQUFTLEdBQUc7QUFBQSxpQkFDdkQsRUFBRSxRQUFRLGFBQWMsYUFBWSxJQUFJLElBQUk7QUFBQSxNQUN2RDtBQUFBLElBQ0Y7QUFJQSxhQUFTQyxnQkFBZSxhQUFhLE1BQU07QUFDekMsWUFBTSxRQUFRLEtBQUssWUFBWTtBQUMvQixpQkFBVyxPQUFPLE9BQU8sS0FBSyxXQUFXLEdBQUc7QUFDMUMsWUFBSSxJQUFJLFlBQVksTUFBTSxNQUFPLFFBQU8sWUFBWSxHQUFHO0FBQUEsTUFDekQ7QUFBQSxJQUNGO0FBS0EsYUFBUyxVQUFVLEdBQUcsR0FBRztBQUN2QixhQUFPLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxLQUFLLEVBQUUsWUFBWSxFQUFFLFdBQVcsRUFBRSxlQUFlLEVBQUU7QUFBQSxJQUNyRTtBQWVBLFFBQU1DLFlBQU4sY0FBdUIsT0FBTztBQUFBLE1BQzVCLFlBQVksUUFBUTtBQUNsQixjQUFNO0FBQ04sYUFBSyxTQUFTO0FBQ2QsYUFBSyxNQUFNLE9BQU87QUFDbEIsYUFBSyxVQUFVLG9CQUFJLElBQUk7QUFDdkIsYUFBSyxRQUFRO0FBQ2IsYUFBSyxhQUFhO0FBQ2xCLGFBQUssZUFBZSxvQkFBSSxJQUFJO0FBQzVCLGFBQUssUUFBUSxTQUFTLE1BQU07QUFDMUIsZ0JBQU0sUUFBUSxLQUFLO0FBQ25CLGVBQUssZUFBZSxvQkFBSSxJQUFJO0FBQzVCLGVBQUssUUFBUSxVQUFVLEtBQUs7QUFBQSxRQUM5QixHQUFHLGNBQWM7QUFBQSxNQUNuQjtBQUFBLE1BRUEsV0FBVztBQUNULGNBQU0sRUFBRSxRQUFRLElBQUksSUFBSTtBQUN4QixlQUFPLGNBQWMsSUFBSSxjQUFjLEdBQUcsV0FBVyxDQUFDLFNBQVMsS0FBSyxPQUFPLElBQUksQ0FBQyxDQUFDO0FBQ2pGLGVBQU8sY0FBYyxJQUFJLGNBQWMsR0FBRyxXQUFXLENBQUMsU0FBUyxLQUFLLE9BQU8sS0FBSyxJQUFJLENBQUMsQ0FBQztBQUN0RixlQUFPLGNBQWMsSUFBSSxNQUFNLEdBQUcsVUFBVSxDQUFDLE1BQU0sWUFBWSxLQUFLLE9BQU8sTUFBTSxPQUFPLENBQUMsQ0FBQztBQUcxRixlQUFPLGNBQWMsSUFBSSxNQUFNLEdBQUcsa0JBQWtCLE1BQU8sS0FBSyxhQUFhLElBQUssQ0FBQztBQU1uRixjQUFNLGNBQWMsSUFBSSxjQUFjLEdBQUcsWUFBWSxNQUFNO0FBQ3pELGNBQUksY0FBYyxPQUFPLFdBQVc7QUFDcEMsZUFBSyxRQUFRO0FBQUEsUUFDZixDQUFDO0FBQ0QsZUFBTyxjQUFjLFdBQVc7QUFFaEMsZUFBTyxTQUFTLE1BQU0sS0FBSyxNQUFNLE9BQU8sQ0FBQztBQUFBLE1BQzNDO0FBQUEsTUFFQSxLQUFLLE1BQU07QUFDVCxjQUFNLGNBQWMsS0FBSyxJQUFJLGNBQWMsYUFBYSxJQUFJLEdBQUc7QUFDL0QsY0FBTSxVQUFVLGNBQWMsYUFBYUosYUFBWSxLQUFLO0FBQzVELGNBQU0sYUFBYSxjQUFjLGFBQWFDLGdCQUFlLEtBQUs7QUFDbEUsZUFBTyxFQUFFLFNBQVMsVUFBVSxPQUFPLEdBQUcsU0FBUyxZQUFZLFVBQVUsVUFBVSxHQUFHLFdBQVc7QUFBQSxNQUMvRjtBQUFBLE1BRUEsY0FBYztBQUNaLFlBQUksQ0FBQyxLQUFLLE1BQU8sTUFBSyxRQUFRO0FBQUEsTUFDaEM7QUFBQSxNQUVBLFVBQVU7QUFDUixjQUFNLFdBQVcsS0FBSztBQUN0QixjQUFNLFdBQVcsS0FBSztBQUN0QixhQUFLLFVBQVUsb0JBQUksSUFBSTtBQUN2QixtQkFBVyxRQUFRLEtBQUssSUFBSSxNQUFNLGlCQUFpQixFQUFHLE1BQUssUUFBUSxJQUFJLEtBQUssTUFBTSxLQUFLLEtBQUssSUFBSSxDQUFDO0FBQ2pHLGFBQUssUUFBUTtBQUNiLGFBQUssYUFBYTtBQUNsQixZQUFJLENBQUMsU0FBVTtBQUVmLG1CQUFXLENBQUMsTUFBTSxLQUFLLEtBQUssS0FBSyxTQUFTO0FBQ3hDLGNBQUksQ0FBQyxVQUFVLFNBQVMsSUFBSSxJQUFJLEdBQUcsS0FBSyxFQUFHLE1BQUssYUFBYSxJQUFJLElBQUk7QUFBQSxRQUN2RTtBQUNBLG1CQUFXLFFBQVEsU0FBUyxLQUFLLEdBQUc7QUFDbEMsY0FBSSxDQUFDLEtBQUssUUFBUSxJQUFJLElBQUksRUFBRyxNQUFLLGFBQWEsSUFBSSxJQUFJO0FBQUEsUUFDekQ7QUFDQSxZQUFJLEtBQUssYUFBYSxPQUFPLEVBQUcsTUFBSyxNQUFNO0FBQUEsTUFDN0M7QUFBQSxNQUVBLFlBQVksTUFBTTtBQUNoQixhQUFLLGFBQWE7QUFDbEIsYUFBSyxhQUFhLElBQUksSUFBSTtBQUMxQixhQUFLLE1BQU07QUFBQSxNQUNiO0FBQUEsTUFFQSxPQUFPLE1BQU07QUFHWCxZQUFJLENBQUMsS0FBSyxTQUFTLEVBQUUsZ0JBQWdCLFVBQVUsS0FBSyxjQUFjLEtBQU07QUFDeEUsY0FBTSxPQUFPLEtBQUssS0FBSyxJQUFJO0FBQzNCLFlBQUksVUFBVSxLQUFLLFFBQVEsSUFBSSxLQUFLLElBQUksR0FBRyxJQUFJLEVBQUc7QUFDbEQsYUFBSyxRQUFRLElBQUksS0FBSyxNQUFNLElBQUk7QUFDaEMsYUFBSyxZQUFZLEtBQUssSUFBSTtBQUFBLE1BQzVCO0FBQUEsTUFFQSxPQUFPLE1BQU07QUFDWCxZQUFJLENBQUMsS0FBSyxTQUFTLENBQUMsS0FBSyxRQUFRLE9BQU8sSUFBSSxFQUFHO0FBQy9DLGFBQUssWUFBWSxJQUFJO0FBQUEsTUFDdkI7QUFBQSxNQUVBLE9BQU8sTUFBTSxTQUFTO0FBQ3BCLFlBQUksQ0FBQyxLQUFLLE1BQU87QUFDakIsY0FBTSxRQUFRLEtBQUssUUFBUSxJQUFJLE9BQU87QUFDdEMsWUFBSSxPQUFPO0FBQ1QsZUFBSyxRQUFRLE9BQU8sT0FBTztBQUMzQixlQUFLLFlBQVksT0FBTztBQUFBLFFBQzFCO0FBQ0EsWUFBSSxnQkFBZ0IsU0FBUyxLQUFLLGNBQWMsTUFBTTtBQUNwRCxlQUFLLFFBQVEsSUFBSSxLQUFLLE1BQU0sU0FBUyxLQUFLLEtBQUssSUFBSSxDQUFDO0FBQ3BELGVBQUssWUFBWSxLQUFLLElBQUk7QUFBQSxRQUM1QjtBQUFBLE1BQ0Y7QUFBQSxNQUVBLFNBQVMsTUFBTTtBQUNiLFlBQUksQ0FBQyxLQUFNLFFBQU87QUFDbEIsYUFBSyxZQUFZO0FBQ2pCLGVBQU8sS0FBSyxRQUFRLElBQUksS0FBSyxJQUFJLEtBQUs7QUFBQSxNQUN4QztBQUFBO0FBQUE7QUFBQSxNQUlBLE9BQU8sTUFBTTtBQUNYLGVBQU8sS0FBSyxTQUFTLElBQUksRUFBRTtBQUFBLE1BQzdCO0FBQUE7QUFBQSxNQUdBLFVBQVUsTUFBTTtBQUNkLGVBQU8sS0FBSyxTQUFTLElBQUksRUFBRTtBQUFBLE1BQzdCO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFLQSxXQUFXLFNBQVM7QUFDbEIsZUFBTyxLQUFLLFVBQVUsRUFBRSxTQUFTLElBQUksT0FBTztBQUFBLE1BQzlDO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFLQSxXQUFXLFNBQVM7QUFDbEIsY0FBTSxNQUFNLEtBQUssV0FBVyxPQUFPO0FBQ25DLGVBQU8sUUFBUSxVQUFhLENBQUMsTUFBTSxRQUFRLEdBQUcsS0FBSyxZQUFZLFFBQVEsS0FBSztBQUFBLE1BQzlFO0FBQUE7QUFBQTtBQUFBLE1BSUEsY0FBYyxTQUFTO0FBQ3JCLGVBQU8sS0FBSyxjQUFjLENBQUMsVUFBVSxNQUFNLFlBQVksT0FBTztBQUFBLE1BQ2hFO0FBQUE7QUFBQSxNQUdBLGlCQUFpQixTQUFTLFlBQVk7QUFDcEMsZUFBTyxLQUFLLGNBQWMsQ0FBQyxVQUFVLE1BQU0sWUFBWSxXQUFXLE1BQU0sZUFBZSxVQUFVO0FBQUEsTUFDbkc7QUFBQSxNQUVBLGNBQWMsV0FBVztBQUN2QixhQUFLLFlBQVk7QUFDakIsY0FBTSxpQkFBaUIsQ0FBQyxDQUFDLEtBQUssT0FBTyxTQUFTO0FBQzlDLGNBQU0sUUFBUSxDQUFDO0FBQ2YsbUJBQVcsQ0FBQyxNQUFNLEtBQUssS0FBSyxLQUFLLFNBQVM7QUFDeEMsY0FBSSxDQUFDLFVBQVUsS0FBSyxFQUFHO0FBQ3ZCLGNBQUksQ0FBQyxrQkFBa0IsS0FBSyxJQUFJLGNBQWMsY0FBYyxJQUFJLEVBQUc7QUFDbkUsZ0JBQU0sT0FBTyxLQUFLLElBQUksTUFBTSxzQkFBc0IsSUFBSTtBQUN0RCxjQUFJLGdCQUFnQixNQUFPLE9BQU0sS0FBSyxJQUFJO0FBQUEsUUFDNUM7QUFDQSxlQUFPO0FBQUEsTUFDVDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQU9BLFlBQVk7QUFDVixhQUFLLFlBQVk7QUFDakIsY0FBTSxpQkFBaUIsQ0FBQyxDQUFDLEtBQUssT0FBTyxTQUFTO0FBQzlDLFlBQUksS0FBSyxZQUFZLG1CQUFtQixlQUFnQixRQUFPLEtBQUs7QUFFcEUsY0FBTSxTQUFTLG9CQUFJLElBQUk7QUFDdkIsY0FBTSxXQUFXLG9CQUFJLElBQUk7QUFDekIsY0FBTSxpQkFBaUIsb0JBQUksSUFBSTtBQUMvQixZQUFJLFNBQVM7QUFDYixtQkFBVyxDQUFDLE1BQU0sRUFBRSxTQUFTLFNBQVMsWUFBWSxXQUFXLENBQUMsS0FBSyxLQUFLLFNBQVM7QUFDL0UsY0FBSSxDQUFDLGtCQUFrQixLQUFLLElBQUksY0FBYyxjQUFjLElBQUksRUFBRztBQUNuRSxjQUFJLFlBQVksTUFBTTtBQUNwQjtBQUNBO0FBQUEsVUFDRjtBQUNBLGlCQUFPLElBQUksVUFBVSxPQUFPLElBQUksT0FBTyxLQUFLLEtBQUssQ0FBQztBQUNsRCxjQUFJLENBQUMsU0FBUyxJQUFJLE9BQU8sRUFBRyxVQUFTLElBQUksU0FBUyxPQUFPO0FBQ3pELGNBQUksU0FBUyxlQUFlLElBQUksT0FBTztBQUN2QyxjQUFJLENBQUMsUUFBUTtBQUNYLHFCQUFTLEVBQUUsUUFBUSxvQkFBSSxJQUFJLEdBQUcsV0FBVyxHQUFHLFVBQVUsb0JBQUksSUFBSSxFQUFFO0FBQ2hFLDJCQUFlLElBQUksU0FBUyxNQUFNO0FBQUEsVUFDcEM7QUFDQSxjQUFJLGVBQWUsTUFBTTtBQUN2QixtQkFBTztBQUFBLFVBQ1QsT0FBTztBQUNMLG1CQUFPLE9BQU8sSUFBSSxhQUFhLE9BQU8sT0FBTyxJQUFJLFVBQVUsS0FBSyxLQUFLLENBQUM7QUFDdEUsZ0JBQUksQ0FBQyxPQUFPLFNBQVMsSUFBSSxVQUFVLEVBQUcsUUFBTyxTQUFTLElBQUksWUFBWSxVQUFVO0FBQUEsVUFDbEY7QUFBQSxRQUNGO0FBQ0EsYUFBSyxhQUFhLEVBQUUsZ0JBQWdCLFFBQVEsUUFBUSxVQUFVLGVBQWU7QUFDN0UsZUFBTyxLQUFLO0FBQUEsTUFDZDtBQUFBO0FBQUEsTUFHQSxhQUFhO0FBQ1gsY0FBTSxFQUFFLFFBQVEsT0FBTyxJQUFJLEtBQUssVUFBVTtBQUMxQyxlQUFPLEVBQUUsUUFBUSxPQUFPO0FBQUEsTUFDMUI7QUFBQTtBQUFBO0FBQUEsTUFJQSxnQkFBZ0I7QUFDZCxlQUFPLEtBQUssVUFBVSxFQUFFO0FBQUEsTUFDMUI7QUFBQSxNQUVBLGNBQWMsU0FBUztBQUNyQixlQUFPLEtBQUssY0FBYyxFQUFFLElBQUksT0FBTyxLQUFLO0FBQUEsTUFDOUM7QUFBQSxJQUNGO0FBRUEsUUFBTSxlQUFlLE9BQU8sT0FBTyxFQUFFLFFBQVEsb0JBQUksSUFBSSxHQUFHLFdBQVcsR0FBRyxVQUFVLG9CQUFJLElBQUksRUFBRSxDQUFDO0FBRTNGLElBQUFGLFFBQU8sVUFBVSxFQUFFLFVBQUFLLFdBQVUsV0FBVyxlQUFlLHNCQUFBRix1QkFBc0IsZ0JBQUFDLGlCQUFnQixjQUFBSCxlQUFjLGlCQUFBQyxpQkFBZ0I7QUFBQTtBQUFBOzs7QUMzVDNIO0FBQUEsb0JBQUFJLFVBQUFDLFNBQUE7QUFBQSxRQUFNLEVBQUUsV0FBVyxlQUFlLHNCQUFBQyx1QkFBc0IsaUJBQUFDLGlCQUFnQixJQUFJO0FBSzVFLGFBQVMscUJBQXFCLEtBQUs7QUFDakMsYUFBTyxJQUFJLEtBQUssRUFBRSxRQUFRLFFBQVEsQ0FBQyxTQUFTLEtBQUssT0FBTyxDQUFDLEVBQUUsa0JBQWtCLElBQUksSUFBSSxLQUFLLE1BQU0sQ0FBQyxFQUFFLGtCQUFrQixJQUFJLENBQUM7QUFBQSxJQUM1SDtBQTZCQSxhQUFTLGFBQWEsT0FBTztBQUMzQixhQUFPLFVBQVUsUUFBUSxVQUFVLFVBQWEsVUFBVTtBQUFBLElBQzVEO0FBRUEsYUFBU0MsaUJBQWdCLFVBQVUsTUFBTTtBQUN2QyxhQUFPLE9BQU8sS0FBSyxTQUFTLGVBQWUsSUFBSSxLQUFLLENBQUMsQ0FBQztBQUFBLElBQ3hEO0FBRUEsYUFBU0MsWUFBVyxVQUFVLE1BQU0sU0FBUztBQUMzQyxhQUFPLFNBQVMsZUFBZSxJQUFJLElBQUksT0FBTyxLQUFLO0FBQUEsSUFDckQ7QUFFQSxhQUFTLGNBQWMsVUFBVSxNQUFNLFNBQVM7QUFDOUMsVUFBSSxDQUFDLFNBQVMsYUFBYyxVQUFTLGVBQWUsQ0FBQztBQUNyRCxVQUFJLENBQUMsU0FBUyxhQUFhLElBQUksRUFBRyxVQUFTLGFBQWEsSUFBSSxJQUFJLENBQUM7QUFDakUsWUFBTSxTQUFTLFNBQVMsYUFBYSxJQUFJO0FBQ3pDLFVBQUksQ0FBQyxPQUFPLE9BQU8sRUFBRyxRQUFPLE9BQU8sSUFBSSxFQUFFLGFBQWEsQ0FBQyxHQUFHLGNBQWMsQ0FBQyxHQUFHLFdBQVcsQ0FBQyxFQUFFO0FBQzNGLGFBQU8sT0FBTyxPQUFPO0FBQUEsSUFDdkI7QUFHQSxhQUFTLGlCQUFpQixVQUFVLFNBQVMsU0FBUztBQUNwRCxVQUFJLENBQUMsU0FBUyxlQUFlLE9BQU8sRUFBRztBQUN2QyxlQUFTLGFBQWEsT0FBTyxJQUFJLFNBQVMsYUFBYSxPQUFPO0FBQzlELGFBQU8sU0FBUyxhQUFhLE9BQU87QUFBQSxJQUN0QztBQUVBLGFBQVMsbUJBQW1CLFVBQVUsTUFBTTtBQUMxQyxVQUFJLFNBQVMsYUFBYyxRQUFPLFNBQVMsYUFBYSxJQUFJO0FBQUEsSUFDOUQ7QUFLQSxhQUFTQyxzQkFBcUIsVUFBVTtBQUN0QyxVQUFJLFVBQVU7QUFDZCxpQkFBVyxVQUFVLE9BQU8sT0FBTyxTQUFTLGdCQUFnQixDQUFDLENBQUMsR0FBRztBQUMvRCxtQkFBVyxRQUFRLE9BQU8sT0FBTyxNQUFNLEdBQUc7QUFDeEMsY0FBSSxLQUFLLGtCQUFrQixPQUFXO0FBQ3RDLGlCQUFPLEtBQUs7QUFDWixvQkFBVTtBQUFBLFFBQ1o7QUFBQSxNQUNGO0FBQ0EsYUFBTztBQUFBLElBQ1Q7QUFpQkEsUUFBTSxzQkFBc0I7QUFDNUIsUUFBTSxnQ0FBZ0M7QUFBQSxNQUNwQyxHQUFHLEVBQUUsR0FBRyxJQUFJLEdBQUcsSUFBSSxHQUFHLEdBQUc7QUFBQSxNQUN6QixHQUFHLEVBQUUsR0FBRyxJQUFJLEdBQUcsSUFBSSxHQUFHLEdBQUc7QUFBQSxJQUMzQjtBQUVBLGFBQVNDLDBCQUF5QixVQUFVLGVBQWU7QUFDekQsWUFBTSxPQUFPLE9BQU8sU0FBUyxpQkFBaUIsS0FBSztBQUNuRCxVQUFJLFFBQVEsb0JBQXFCLFFBQU87QUFDeEMsWUFBTSxZQUFZLGFBQWE7QUFDN0IsbUJBQVcsVUFBVSxPQUFPLE9BQU8sU0FBUyxnQkFBZ0IsQ0FBQyxDQUFDLEdBQUc7QUFDL0QscUJBQVcsUUFBUSxPQUFPLE9BQU8sTUFBTSxFQUFHLEtBQUksS0FBSyxNQUFPLE9BQU0sS0FBSztBQUFBLFFBQ3ZFO0FBQUEsTUFDRjtBQUNBLFlBQU0sZ0JBQWdCLENBQUMsU0FBUztBQUM5QixjQUFNLFdBQVcsOEJBQThCLElBQUk7QUFDbkQsWUFBSSxPQUFPLFFBQVEsUUFBUSxFQUFFLE1BQU0sQ0FBQyxDQUFDLEtBQUssS0FBSyxNQUFNLE9BQU8sU0FBUyxxQkFBcUIsR0FBRyxDQUFDLE1BQU0sS0FBSyxHQUFHO0FBQzFHLG1CQUFTLHFCQUFxQixFQUFFLEdBQUcsY0FBYztBQUFBLFFBQ25EO0FBQUEsTUFDRjtBQUNBLFVBQUksT0FBTyxHQUFHO0FBQ1osY0FBTSxXQUFXLE9BQU8sU0FBUyxvQkFBb0IsQ0FBQztBQUN0RCxzQkFBYyxDQUFDO0FBQ2YsY0FBTSxXQUFXLE9BQU8sU0FBUyxvQkFBb0IsQ0FBQztBQUN0RCxjQUFNLFNBQVMsV0FBVyxLQUFLLE9BQU8sU0FBUyxRQUFRLElBQUksV0FBVyxXQUFXO0FBQ2pGLG1CQUFXLFNBQVMsVUFBVSxFQUFHLEtBQUksTUFBTSxFQUFHLE9BQU0sSUFBSSxLQUFLLE1BQU0sTUFBTSxJQUFJLE1BQU07QUFBQSxNQUNyRjtBQUNBLFVBQUksT0FBTyxHQUFHO0FBQ1osc0JBQWMsQ0FBQztBQUNmLG1CQUFXLFNBQVMsVUFBVSxFQUFHLEtBQUksTUFBTSxJQUFJLEVBQUcsT0FBTSxJQUFJO0FBQUEsTUFDOUQ7QUFDQSxlQUFTLG9CQUFvQjtBQUM3QixhQUFPO0FBQUEsSUFDVDtBQVFBLGFBQVMsa0JBQWtCLFVBQVUsUUFBUSxRQUFRO0FBQ25ELFlBQU0saUJBQWlCLFNBQVMsZUFBZSxNQUFNO0FBQ3JELFVBQUksQ0FBQyxlQUFnQjtBQUNyQixpQkFBVyxDQUFDLE1BQU0sVUFBVSxLQUFLLE9BQU8sUUFBUSxjQUFjLEdBQUc7QUFDL0QsY0FBTSxhQUFhRixZQUFXLFVBQVUsUUFBUSxJQUFJO0FBQ3BELFlBQUksQ0FBQyxZQUFZO0FBQ2Ysd0JBQWMsVUFBVSxRQUFRLElBQUk7QUFDcEMsbUJBQVMsYUFBYSxNQUFNLEVBQUUsSUFBSSxJQUFJO0FBQ3RDO0FBQUEsUUFDRjtBQUNBLGNBQU0sY0FBYyxJQUFJLElBQUksT0FBTyxLQUFLLFdBQVcsV0FBVyxFQUFFLElBQUksQ0FBQyxRQUFRLElBQUksWUFBWSxDQUFDLENBQUM7QUFDL0YsbUJBQVcsQ0FBQyxLQUFLLEtBQUssS0FBSyxPQUFPLFFBQVEsV0FBVyxXQUFXLEdBQUc7QUFDakUsY0FBSSxRQUFRLE1BQU0sWUFBWSxJQUFJLElBQUksWUFBWSxDQUFDLEVBQUc7QUFDdEQscUJBQVcsWUFBWSxHQUFHLElBQUk7QUFDOUIsY0FBSSxXQUFXLGFBQWEsU0FBUyxHQUFHLEVBQUcsWUFBVyxhQUFhLEtBQUssR0FBRztBQUUzRSxnQkFBTSxXQUFXLFdBQVcsWUFBWSxHQUFHO0FBQzNDLGNBQUksU0FBVSxFQUFDLFdBQVcsY0FBWCxXQUFXLFlBQWMsQ0FBQyxJQUFHLEdBQUcsSUFBSTtBQUFBLFFBQ3JEO0FBQUEsTUFDRjtBQUNBLGFBQU8sU0FBUyxhQUFhLE1BQU07QUFBQSxJQUNyQztBQUlBLGFBQVMsY0FBYyxVQUFVLE1BQU0sU0FBUyxTQUFTO0FBQ3ZELFlBQU0sU0FBUyxTQUFTLGVBQWUsSUFBSTtBQUMzQyxVQUFJLENBQUMsU0FBUyxPQUFPLEtBQUssWUFBWSxRQUFTO0FBQy9DLGVBQVMsYUFBYSxJQUFJLElBQUksT0FBTztBQUFBLFFBQ25DLE9BQU8sUUFBUSxNQUFNLEVBQUUsSUFBSSxDQUFDLENBQUMsTUFBTSxJQUFJLE1BQU0sQ0FBQyxTQUFTLFVBQVUsVUFBVSxNQUFNLElBQUksQ0FBQztBQUFBLE1BQ3hGO0FBQUEsSUFDRjtBQU1BLGFBQVMsZ0JBQWdCLFVBQVUsTUFBTTtBQUN2QyxhQUFPLENBQUMsTUFBTSxHQUFHRCxpQkFBZ0IsVUFBVSxJQUFJLENBQUM7QUFBQSxJQUNsRDtBQU1BLGFBQVMsZ0JBQWdCLFVBQVUsTUFBTSxPQUFPO0FBQzlDLFlBQU0sU0FBUyxTQUFTLGVBQWUsSUFBSTtBQUMzQyxVQUFJLENBQUMsT0FBUTtBQUNiLFlBQU0sUUFBUSxNQUFNLE9BQU8sQ0FBQyxTQUFTLFNBQVMsUUFBUSxPQUFPLElBQUksQ0FBQztBQUNsRSxZQUFNLFVBQVUsQ0FBQyxHQUFHLE9BQU8sR0FBRyxPQUFPLEtBQUssTUFBTSxFQUFFLE9BQU8sQ0FBQyxTQUFTLENBQUMsTUFBTSxTQUFTLElBQUksQ0FBQyxDQUFDO0FBQ3pGLGVBQVMsYUFBYSxJQUFJLElBQUksT0FBTyxZQUFZLFFBQVEsSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLE9BQU8sSUFBSSxDQUFDLENBQUMsQ0FBQztBQUFBLElBQzlGO0FBRUEsYUFBUyxjQUFjLFVBQVUsTUFBTSxNQUFNO0FBQzNDLFlBQU0sU0FBUyxTQUFTLGVBQWUsSUFBSTtBQUMzQyxVQUFJLENBQUMsT0FBUTtBQUNiLGFBQU8sT0FBTyxJQUFJO0FBQ2xCLFVBQUksT0FBTyxLQUFLLE1BQU0sRUFBRSxXQUFXLEVBQUcsUUFBTyxTQUFTLGFBQWEsSUFBSTtBQUFBLElBQ3pFO0FBU0EsYUFBUyxjQUFjLFVBQVUsTUFBTSxRQUFRLFFBQVE7QUFDckQsWUFBTSxhQUFhQyxZQUFXLFVBQVUsTUFBTSxNQUFNO0FBQ3BELFlBQU0sYUFBYUEsWUFBVyxVQUFVLE1BQU0sTUFBTTtBQUNwRCxVQUFJLENBQUMsY0FBYyxDQUFDLGNBQWMsV0FBVyxPQUFRO0FBRXJELFlBQU0sYUFBYSxJQUFJLElBQUksT0FBTyxLQUFLLFdBQVcsV0FBVyxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxZQUFZLEdBQUcsR0FBRyxDQUFDLENBQUM7QUFDckcsaUJBQVcsQ0FBQyxLQUFLLEtBQUssS0FBSyxPQUFPLFFBQVEsV0FBVyxXQUFXLEdBQUc7QUFDakUsWUFBSSxRQUFRLEdBQUk7QUFDaEIsY0FBTSxXQUFXLFdBQVcsSUFBSSxJQUFJLFlBQVksQ0FBQztBQUNqRCxZQUFJLGFBQWEsUUFBVztBQUMxQixxQkFBVyxZQUFZLEdBQUcsSUFBSTtBQUM5QixxQkFBVyxJQUFJLElBQUksWUFBWSxHQUFHLEdBQUc7QUFDckMsY0FBSSxXQUFXLGFBQWEsU0FBUyxHQUFHLEtBQUssQ0FBQyxXQUFXLGFBQWEsU0FBUyxHQUFHLEVBQUcsWUFBVyxhQUFhLEtBQUssR0FBRztBQUVySCxnQkFBTSxXQUFXLFdBQVcsWUFBWSxHQUFHO0FBQzNDLGNBQUksU0FBVSxFQUFDLFdBQVcsY0FBWCxXQUFXLFlBQWMsQ0FBQyxJQUFHLEdBQUcsSUFBSTtBQUFBLFFBQ3JELFdBQVcsYUFBYSxXQUFXLFlBQVksUUFBUSxDQUFDLEdBQUc7QUFDekQscUJBQVcsWUFBWSxRQUFRLElBQUk7QUFBQSxRQUNyQztBQUFBLE1BQ0Y7QUFDQSxvQkFBYyxVQUFVLE1BQU0sTUFBTTtBQUFBLElBQ3RDO0FBS0EsbUJBQWUscUJBQXFCLFFBQVEsTUFBTSxRQUFRLFVBQVU7QUFDbEUsVUFBSSxVQUFVO0FBQ2QsaUJBQVcsUUFBUSxPQUFPLFNBQVMsaUJBQWlCLE1BQU0sTUFBTSxHQUFHO0FBQ2pFLFlBQUksVUFBVTtBQUNkLGNBQU0sT0FBTyxJQUFJLFlBQVksbUJBQW1CLE1BQU0sQ0FBQyxnQkFBZ0I7QUFDckUsY0FBSSxVQUFVLGNBQWMsYUFBYUYsZ0JBQWUsQ0FBQyxNQUFNLE9BQVE7QUFDdkUsVUFBQUQsc0JBQXFCLGFBQWFDLGtCQUFpQixRQUFRO0FBQzNELG9CQUFVO0FBQUEsUUFDWixDQUFDO0FBQ0QsWUFBSSxRQUFTO0FBQUEsTUFDZjtBQUNBLGFBQU87QUFBQSxJQUNUO0FBRUEsSUFBQUYsUUFBTyxVQUFVO0FBQUEsTUFDZjtBQUFBLE1BQ0E7QUFBQSxNQUNBLGlCQUFBRztBQUFBLE1BQ0EsWUFBQUM7QUFBQSxNQUNBO0FBQUEsTUFDQSxzQkFBQUM7QUFBQSxNQUNBLDBCQUFBQztBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLElBQ0Y7QUFBQTtBQUFBOzs7QUN0UUE7QUFBQSw0QkFBQUMsVUFBQUMsU0FBQTtBQUFBLFFBQU0sRUFBRSxZQUFBQyxZQUFXLElBQUk7QUFDdkIsUUFBTSxFQUFFLFdBQVcsY0FBYyxJQUFJO0FBRXJDLFFBQU1DLGdCQUFlO0FBQ3JCLFFBQU1DLG1CQUFrQjtBQVF4QixRQUFNLHVCQUF1QixDQUFDLEVBQUUsTUFBTSxXQUFXLEdBQUcsRUFBRSxNQUFNLGNBQWMsR0FBRyxFQUFFLE1BQU0sTUFBTSxHQUFHLEVBQUUsTUFBTSxRQUFRLENBQUM7QUFXL0csYUFBU0Msc0JBQXFCLE9BQU87QUFDbkMsWUFBTSxTQUFTLE1BQU0sUUFBUSxLQUFLLElBQUksTUFBTSxPQUFPLENBQUMsVUFBVSxTQUFTLE9BQU8sVUFBVSxRQUFRLElBQUksQ0FBQztBQUNyRyxZQUFNLFVBQVUsQ0FBQyxTQUFTLE9BQU8sS0FBSyxDQUFDLFVBQVUsTUFBTSxTQUFTLElBQUk7QUFDcEUsVUFBSSxDQUFDLFFBQVEsVUFBVSxFQUFHLFFBQU8sUUFBUSxFQUFFLE1BQU0sV0FBVyxDQUFDO0FBQzdELFVBQUksQ0FBQyxRQUFRLGFBQWEsR0FBRztBQUMzQixjQUFNLGdCQUFnQixPQUFPLFVBQVUsQ0FBQyxVQUFVLE1BQU0sU0FBUyxVQUFVO0FBQzNFLGVBQU8sT0FBTyxnQkFBZ0IsR0FBRyxHQUFHLEVBQUUsTUFBTSxjQUFjLENBQUM7QUFBQSxNQUM3RDtBQUNBLFVBQUksQ0FBQyxRQUFRLEtBQUssRUFBRyxRQUFPLEtBQUssRUFBRSxNQUFNLE1BQU0sQ0FBQztBQUNoRCxVQUFJLENBQUMsUUFBUSxPQUFPLEVBQUcsUUFBTyxLQUFLLEVBQUUsTUFBTSxRQUFRLENBQUM7QUFDcEQsYUFBTztBQUFBLElBQ1Q7QUFrQ0EsYUFBUyxtQkFBbUIsUUFBUSxNQUFNLFVBQVUsTUFBTTtBQUN4RCxVQUFJLENBQUMsS0FBTSxRQUFPO0FBQ2xCLFlBQU0sY0FBYyxDQUFDLFFBQVEsUUFBUSxNQUFNLENBQUNGLGVBQWNDLGdCQUFlLEVBQUUsS0FBSyxDQUFDLE1BQU0sSUFBSSxZQUFZLE1BQU0sRUFBRSxZQUFZLENBQUM7QUFDNUgsWUFBTSxjQUFjLFVBQVVGLFlBQVcsT0FBTyxVQUFVLE1BQU0sT0FBTyxJQUFJO0FBQzNFLFlBQU0sU0FBUyxDQUFDLE9BQU8sU0FBUyx1QkFBdUIsSUFBSSxHQUFHLGFBQWEsV0FBVztBQUN0RixZQUFNLE9BQU8sQ0FBQztBQUNkLFlBQU0sT0FBTyxvQkFBSSxJQUFJO0FBQ3JCLGlCQUFXLFNBQVMsUUFBUTtBQUMxQixtQkFBVyxPQUFPLE9BQU8sS0FBSyxTQUFTLENBQUMsQ0FBQyxHQUFHO0FBQzFDLGNBQUksWUFBWSxHQUFHLEtBQUssS0FBSyxJQUFJLElBQUksWUFBWSxDQUFDLEVBQUc7QUFDckQsZUFBSyxLQUFLLEdBQUc7QUFDYixlQUFLLElBQUksSUFBSSxZQUFZLENBQUM7QUFBQSxRQUM1QjtBQUFBLE1BQ0Y7QUFDQSxhQUFPLEtBQUssU0FBUyxJQUFJLE9BQU87QUFBQSxJQUNsQztBQWlCQSxhQUFTLGtCQUFrQixjQUFjLGFBQWEsaUJBQWlCO0FBQ3JFLFlBQU0sZ0JBQWdCLElBQUksSUFBSSxhQUFhLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxZQUFZLEdBQUcsR0FBRyxDQUFDLENBQUM7QUFDakYsWUFBTSxVQUFVLENBQUMsU0FBUyxjQUFjLElBQUksS0FBSyxZQUFZLENBQUM7QUFFOUQsWUFBTSxTQUFTLElBQUk7QUFBQSxRQUNqQixZQUNHLE9BQU8sQ0FBQyxVQUFVLE1BQU0sU0FBUyxVQUFVLEVBQzNDLElBQUksQ0FBQyxVQUFVLFFBQVEsTUFBTSxJQUFJLENBQUMsRUFDbEMsT0FBTyxPQUFPO0FBQUEsTUFDbkI7QUFDQSxZQUFNLFNBQVMsUUFBUUMsYUFBWTtBQUNuQyxZQUFNLFlBQVksUUFBUUMsZ0JBQWU7QUFDekMsWUFBTSxlQUFlLElBQUk7QUFBQSxTQUN0QixtQkFBbUIsQ0FBQyxHQUFHLElBQUksT0FBTyxFQUFFLE9BQU8sQ0FBQyxRQUFRLE9BQU8sUUFBUSxVQUFVLENBQUMsT0FBTyxJQUFJLEdBQUcsQ0FBQztBQUFBLE1BQ2hHO0FBQ0EsWUFBTSxVQUFVLElBQUksSUFBSSxNQUFNO0FBQzlCLGlCQUFXLE9BQU8sYUFBYyxTQUFRLElBQUksR0FBRztBQUMvQyxVQUFJLE9BQVEsU0FBUSxJQUFJLE1BQU07QUFDOUIsVUFBSSxVQUFXLFNBQVEsSUFBSSxTQUFTO0FBRXBDLFlBQU0sYUFBYSxDQUFDO0FBQ3BCLFlBQU0sT0FBTyxvQkFBSSxJQUFJO0FBQ3JCLFlBQU0sT0FBTyxDQUFDLFFBQVE7QUFDcEIsWUFBSSxPQUFPLENBQUMsS0FBSyxJQUFJLEdBQUcsR0FBRztBQUN6QixxQkFBVyxLQUFLLEdBQUc7QUFDbkIsZUFBSyxJQUFJLEdBQUc7QUFBQSxRQUNkO0FBQUEsTUFDRjtBQUVBLGlCQUFXLFNBQVMsYUFBYTtBQUMvQixZQUFJLE1BQU0sU0FBUyxXQUFZLE1BQUssUUFBUSxNQUFNLElBQUksQ0FBQztBQUFBLGlCQUM5QyxNQUFNLFNBQVMsV0FBWSxNQUFLLE1BQU07QUFBQSxpQkFDdEMsTUFBTSxTQUFTLGNBQWUsTUFBSyxTQUFTO0FBQUEsaUJBQzVDLE1BQU0sU0FBUyxPQUFPO0FBQzdCLHFCQUFXLFFBQVEsbUJBQW1CLENBQUMsR0FBRztBQUN4QyxrQkFBTSxNQUFNLFFBQVEsSUFBSTtBQUN4QixnQkFBSSxPQUFPLGFBQWEsSUFBSSxHQUFHLEVBQUcsTUFBSyxHQUFHO0FBQUEsVUFDNUM7QUFBQSxRQUNGLFdBQVcsTUFBTSxTQUFTLFNBQVM7QUFDakMscUJBQVcsT0FBTyxjQUFjO0FBQzlCLGdCQUFJLENBQUMsUUFBUSxJQUFJLEdBQUcsRUFBRyxNQUFLLEdBQUc7QUFBQSxVQUNqQztBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBSUEsaUJBQVcsT0FBTyxhQUFjLE1BQUssR0FBRztBQUN4QyxhQUFPO0FBQUEsSUFDVDtBQUtBLGFBQVMsc0JBQXNCLEtBQUssTUFBTTtBQUN4QyxZQUFNLGNBQWMsSUFBSSxjQUFjLGFBQWEsSUFBSSxHQUFHO0FBQzFELFVBQUksQ0FBQyxZQUFhLFFBQU87QUFDekIsYUFBTyxPQUFPLEtBQUssV0FBVyxFQUFFLE9BQU8sQ0FBQyxRQUFRLFFBQVEsVUFBVTtBQUFBLElBQ3BFO0FBRUEsbUJBQWUsb0JBQW9CLEtBQUssTUFBTSxhQUFhLGlCQUFpQjtBQVMxRSxZQUFNLGFBQWEsc0JBQXNCLEtBQUssSUFBSTtBQUNsRCxVQUFJLENBQUMsY0FBYyxXQUFXLFVBQVUsRUFBRyxRQUFPO0FBQ2xELFlBQU0sZUFBZSxrQkFBa0IsWUFBWSxhQUFhLGVBQWU7QUFDL0UsVUFBSSxhQUFhLE1BQU0sQ0FBQyxLQUFLLE1BQU0sUUFBUSxXQUFXLENBQUMsQ0FBQyxFQUFHLFFBQU87QUFFbEUsVUFBSSxVQUFVO0FBQ2QsWUFBTSxJQUFJLFlBQVksbUJBQW1CLE1BQU0sQ0FBQyxnQkFBZ0I7QUFDOUQsa0JBQVUsc0JBQXNCLGFBQWEsYUFBYSxlQUFlO0FBQUEsTUFDM0UsQ0FBQztBQUNELGFBQU87QUFBQSxJQUNUO0FBT0EsYUFBUyxzQkFBc0IsYUFBYSxhQUFhLGlCQUFpQjtBQUN4RSxZQUFNLGVBQWUsT0FBTyxLQUFLLFdBQVc7QUFDNUMsVUFBSSxhQUFhLFVBQVUsRUFBRyxRQUFPO0FBRXJDLFlBQU0sYUFBYSxrQkFBa0IsY0FBYyxhQUFhLGVBQWU7QUFDL0UsVUFBSSxXQUFXLE1BQU0sQ0FBQyxLQUFLLE1BQU0sUUFBUSxhQUFhLENBQUMsQ0FBQyxFQUFHLFFBQU87QUFFbEUsWUFBTSxXQUFXLEVBQUUsR0FBRyxZQUFZO0FBQ2xDLGlCQUFXLE9BQU8sYUFBYyxRQUFPLFlBQVksR0FBRztBQUN0RCxpQkFBVyxPQUFPLFdBQVksYUFBWSxHQUFHLElBQUksU0FBUyxHQUFHO0FBQzdELGFBQU87QUFBQSxJQUNUO0FBT0EsYUFBU0Usb0JBQW1CLFFBQVEsYUFBYSxNQUFNLFNBQVM7QUFDOUQsWUFBTSxjQUFjRCxzQkFBcUIsT0FBTyxTQUFTLG1CQUFtQjtBQUM1RSxhQUFPLHNCQUFzQixhQUFhLGFBQWEsbUJBQW1CLFFBQVEsTUFBTSxPQUFPLENBQUM7QUFBQSxJQUNsRztBQWFBLGFBQVNFLGtCQUFpQixRQUFRLGFBQWEsS0FBSztBQUNsRCxZQUFNLGVBQWUsT0FBTyxLQUFLLFdBQVc7QUFDNUMsWUFBTSxZQUFZLGFBQWEsS0FBSyxDQUFDLE1BQU0sRUFBRSxZQUFZLE1BQU0sSUFBSSxZQUFZLENBQUM7QUFDaEYsVUFBSSxDQUFDLGFBQWEsYUFBYSxVQUFVLEVBQUcsUUFBTztBQUVuRCxZQUFNLGNBQWNGLHNCQUFxQixPQUFPLFNBQVMsbUJBQW1CO0FBQzVFLFlBQU0sT0FBTyxVQUFVLGNBQWMsYUFBYUYsYUFBWSxDQUFDO0FBQy9ELFlBQU0sVUFBVSxVQUFVLGNBQWMsYUFBYUMsZ0JBQWUsQ0FBQztBQUNyRSxZQUFNLGFBQWEsa0JBQWtCLGNBQWMsYUFBYSxtQkFBbUIsUUFBUSxNQUFNLE9BQU8sQ0FBQztBQUV6RyxZQUFNLE9BQU8sYUFBYSxPQUFPLENBQUMsTUFBTSxNQUFNLFNBQVM7QUFDdkQsWUFBTSxjQUFjLFdBQVcsTUFBTSxHQUFHLFdBQVcsUUFBUSxTQUFTLENBQUMsRUFBRSxJQUFJO0FBQzNFLFlBQU0sVUFBVSxDQUFDLEdBQUcsSUFBSTtBQUN4QixjQUFRLE9BQU8sZ0JBQWdCLFNBQVksSUFBSSxLQUFLLFFBQVEsV0FBVyxJQUFJLEdBQUcsR0FBRyxTQUFTO0FBQzFGLFVBQUksUUFBUSxNQUFNLENBQUMsR0FBRyxNQUFNLE1BQU0sYUFBYSxDQUFDLENBQUMsRUFBRyxRQUFPO0FBRTNELFlBQU0sV0FBVyxFQUFFLEdBQUcsWUFBWTtBQUNsQyxpQkFBVyxLQUFLLGFBQWMsUUFBTyxZQUFZLENBQUM7QUFDbEQsaUJBQVcsS0FBSyxRQUFTLGFBQVksQ0FBQyxJQUFJLFNBQVMsQ0FBQztBQUNwRCxhQUFPO0FBQUEsSUFDVDtBQUdBLG1CQUFlLDBCQUEwQixLQUFLLFFBQVEsTUFBTTtBQUMxRCxZQUFNLGNBQWNDLHNCQUFxQixPQUFPLFNBQVMsbUJBQW1CO0FBRzVFLFlBQU0sT0FBTyxPQUFPLFNBQVMsT0FBTyxJQUFJO0FBQ3hDLFlBQU0sa0JBQWtCLG1CQUFtQixRQUFRLE1BQU0sT0FBTyxTQUFTLFVBQVUsSUFBSSxDQUFDO0FBQ3hGLGFBQU8sb0JBQW9CLEtBQUssTUFBTSxhQUFhLGVBQWU7QUFBQSxJQUNwRTtBQVFBLG1CQUFlLG1CQUFtQixLQUFLLFFBQVEsVUFBVTtBQUN2RCxVQUFJLFVBQVU7QUFDZCxVQUFJLFVBQVU7QUFDZCxZQUFNLGNBQWNBLHNCQUFxQixPQUFPLFNBQVMsbUJBQW1CO0FBSzVFLFlBQU0sa0JBQWtCLFdBQVcsbUJBQW1CLFFBQVEsUUFBUSxNQUFNLE9BQU87QUFFbkYsaUJBQVcsUUFBUSxJQUFJLE1BQU0saUJBQWlCLEdBQUc7QUFDL0MsWUFBSSxDQUFDLE9BQU8sU0FBUyx1QkFBdUIsSUFBSSxjQUFjLGNBQWMsS0FBSyxJQUFJLEVBQUc7QUFFeEYsY0FBTSxPQUFPLE9BQU8sU0FBUyxPQUFPLElBQUk7QUFDeEMsWUFBSSxZQUFZLFNBQVMsU0FBVTtBQUVuQyxjQUFNLGtCQUFrQixtQkFBbUIsUUFBUSxNQUFNLE9BQU8sU0FBUyxVQUFVLElBQUksQ0FBQztBQUN4RjtBQUNBLFlBQUksTUFBTSxvQkFBb0IsS0FBSyxNQUFNLGFBQWEsZUFBZSxFQUFHO0FBQUEsTUFDMUU7QUFFQSxhQUFPLEVBQUUsU0FBUyxTQUFTLGdCQUFnQjtBQUFBLElBQzdDO0FBRUEsSUFBQUosUUFBTyxVQUFVO0FBQUEsTUFDZjtBQUFBLE1BQ0E7QUFBQSxNQUNBLG9CQUFBSztBQUFBLE1BQ0Esa0JBQUFDO0FBQUEsTUFDQSxzQkFBQUY7QUFBQSxNQUNBO0FBQUEsTUFDQSxjQUFBRjtBQUFBLE1BQ0EsaUJBQUFDO0FBQUEsSUFDRjtBQUFBO0FBQUE7OztBQ25TQTtBQUFBLG9DQUFBSSxVQUFBQyxTQUFBO0FBQUEsUUFBTSxFQUFFLFNBQVMsT0FBTyxJQUFJLFFBQVEsVUFBVTtBQUM5QyxRQUFNLEVBQUUsY0FBQUMsZUFBYyxpQkFBQUMsa0JBQWlCLG1CQUFtQixJQUFJO0FBUTlELFFBQU0scUJBQXFCO0FBQUEsTUFDekIsVUFBVTtBQUFBLE1BQ1YsYUFBYTtBQUFBLE1BQ2IsS0FBSztBQUFBLE1BQ0wsT0FBTztBQUFBLElBQ1Q7QUFPQSxhQUFTLHVCQUF1QixhQUFhLFFBQVE7QUFDbkQsWUFBTSxTQUFTLFlBQVksVUFBVSxFQUFFLEtBQUssOEJBQThCLENBQUM7QUFNM0UsWUFBTSxhQUFhLE9BQU8sVUFBVSxFQUFFLEtBQUssbUNBQW1DLENBQUM7QUFNL0UsWUFBTSxXQUFXLFdBQVcsVUFBVSxFQUFFLEtBQUssa0JBQWtCLE1BQU0sRUFBRSxjQUFjLDRCQUE0QixFQUFFLENBQUM7QUFDcEgsY0FBUSxVQUFVLE1BQU07QUFDeEIsZUFBUyxpQkFBaUIsU0FBUyxZQUFZO0FBQzdDLFlBQUk7QUFDRixnQkFBTSxFQUFFLFNBQVMsUUFBUSxJQUFJLE1BQU0sbUJBQW1CLE9BQU8sS0FBSyxRQUFRLElBQUk7QUFDOUUsY0FBSTtBQUFBLFlBQ0YsVUFBVSxJQUNOLDJCQUEyQixPQUFPLHdCQUFxQixPQUFPLGVBQzlELDJCQUEyQixPQUFPO0FBQUEsVUFDeEM7QUFBQSxRQUNGLFNBQVMsT0FBTztBQUNkLGtCQUFRLE1BQU0sNEJBQTRCLEtBQUs7QUFDL0MsY0FBSSxPQUFPLDBDQUEwQyxNQUFNLE9BQU8sRUFBRTtBQUFBLFFBQ3RFO0FBQUEsTUFDRixDQUFDO0FBRUQsaUJBQVcsVUFBVSxFQUFFLEtBQUssaUNBQWlDLE1BQU0sK0JBQStCLENBQUM7QUFFbkcsWUFBTSxTQUFTLE9BQU8sVUFBVSxFQUFFLEtBQUssa0JBQWtCLE1BQU0sRUFBRSxjQUFjLHlCQUFzQixFQUFFLENBQUM7QUFDeEcsY0FBUSxRQUFRLE1BQU07QUFFdEIsWUFBTSxTQUFTLFlBQVksVUFBVSxFQUFFLEtBQUssa0JBQWtCLENBQUM7QUFFL0QsWUFBTSxRQUFRLE1BQU0sT0FBTyxTQUFTO0FBUXBDLFVBQUksYUFBYTtBQUVqQixZQUFNLGtCQUFrQixDQUFDLE9BQU8sYUFBYTtBQUMzQyxjQUFNLFFBQVEsTUFBTSxZQUFZO0FBQ2hDLFlBQUksVUFBVUQsY0FBYSxZQUFZLEtBQUssVUFBVUMsaUJBQWdCLFlBQVksRUFBRyxRQUFPO0FBQzVGLGVBQU8sTUFBTSxFQUFFLEtBQUssQ0FBQyxVQUFVLFVBQVUsWUFBWSxNQUFNLFNBQVMsY0FBYyxNQUFNLEtBQUssWUFBWSxNQUFNLEtBQUs7QUFBQSxNQUN0SDtBQUVBLFlBQU0sU0FBUyxNQUFNO0FBQ25CLGVBQU8sTUFBTTtBQUNiLGNBQU0sVUFBVSxhQUFhLENBQUMsR0FBRyxNQUFNLEdBQUcsVUFBVSxJQUFJLE1BQU07QUFFOUQsZ0JBQVEsUUFBUSxDQUFDLE9BQU8sVUFBVTtBQUNoQyxnQkFBTSxVQUFVLFVBQVU7QUFDMUIsZ0JBQU0sZ0JBQWdCLE1BQU0sU0FBUztBQUNyQyxnQkFBTSxTQUNKLG9CQUFvQixnQkFBZ0Isb0JBQW9CLE9BQU8sTUFBTSxTQUFTLFFBQVEscUJBQXFCO0FBQzdHLGdCQUFNLE1BQU0sT0FBTyxVQUFVLEVBQUUsS0FBSyxPQUFPLENBQUM7QUFFNUMsZ0JBQU0sYUFBYSxJQUFJLFVBQVUsRUFBRSxLQUFLLG1CQUFtQixNQUFNLEVBQUUsY0FBYyxjQUFjLEVBQUUsQ0FBQztBQUNsRyxrQkFBUSxZQUFZLGVBQWU7QUFFbkMsY0FBSSxlQUFlO0FBQ2pCLGdCQUFJLFVBQVUsRUFBRSxLQUFLLG9CQUFvQixNQUFNLG1CQUFtQixNQUFNLElBQUksRUFBRSxDQUFDO0FBQUEsVUFDakYsT0FBTztBQUNMLGtCQUFNLFFBQVEsSUFBSSxTQUFTLFNBQVM7QUFBQSxjQUNsQyxNQUFNO0FBQUEsY0FDTixLQUFLO0FBQUEsY0FDTCxNQUFNLEVBQUUsYUFBYSxnQkFBZ0I7QUFBQSxZQUN2QyxDQUFDO0FBQ0Qsa0JBQU0sUUFBUSxNQUFNO0FBTXBCLGtCQUFNLGlCQUFpQixRQUFRLFlBQVk7QUFDekMsb0JBQU0sUUFBUSxNQUFNLE1BQU0sS0FBSztBQUUvQixrQkFBSSxDQUFDLE9BQU87QUFDVixvQkFBSSxTQUFTO0FBQ1gsK0JBQWE7QUFBQSxnQkFDZixPQUFPO0FBQ0wsd0JBQU0sRUFBRSxPQUFPLE1BQU0sRUFBRSxRQUFRLEtBQUssR0FBRyxDQUFDO0FBQ3hDLHdCQUFNLE9BQU8sYUFBYTtBQUFBLGdCQUM1QjtBQUNBLHVCQUFPO0FBQ1A7QUFBQSxjQUNGO0FBRUEsa0JBQUksZ0JBQWdCLE9BQU8sVUFBVSxPQUFPLEtBQUssR0FBRztBQUNsRCxvQkFBSSxPQUFPLElBQUksS0FBSyw2QkFBNkI7QUFDakQsc0JBQU0sUUFBUSxNQUFNO0FBQ3BCO0FBQUEsY0FDRjtBQUVBLG9CQUFNLE9BQU87QUFDYixrQkFBSSxTQUFTO0FBQ1gsc0JBQU0sRUFBRSxLQUFLLEtBQUs7QUFDbEIsNkJBQWE7QUFBQSxjQUNmO0FBQ0Esb0JBQU0sT0FBTyxhQUFhO0FBQzFCLHFCQUFPO0FBQUEsWUFDVCxDQUFDO0FBRUQsa0JBQU0sWUFBWSxJQUFJLFVBQVUsRUFBRSxLQUFLLG9DQUFvQyxNQUFNLEVBQUUsY0FBYyxZQUFZLEVBQUUsQ0FBQztBQUNoSCxvQkFBUSxXQUFXLEdBQUc7QUFDdEIsc0JBQVUsaUJBQWlCLFNBQVMsWUFBWTtBQUM5QyxrQkFBSSxTQUFTO0FBQ1gsNkJBQWE7QUFBQSxjQUNmLE9BQU87QUFDTCxzQkFBTSxFQUFFLE9BQU8sTUFBTSxFQUFFLFFBQVEsS0FBSyxHQUFHLENBQUM7QUFDeEMsc0JBQU0sT0FBTyxhQUFhO0FBQUEsY0FDNUI7QUFDQSxxQkFBTztBQUFBLFlBQ1QsQ0FBQztBQUFBLFVBQ0g7QUFJQSxjQUFJLFFBQVM7QUFFYixjQUFJLFlBQVk7QUFDaEIsY0FBSSxpQkFBaUIsYUFBYSxDQUFDLFVBQVU7QUFDM0Msa0JBQU0sYUFBYSxnQkFBZ0I7QUFDbkMsa0JBQU0sYUFBYSxRQUFRLGNBQWMsT0FBTyxLQUFLLENBQUM7QUFDdEQsZ0JBQUksVUFBVSxJQUFJLGFBQWE7QUFBQSxVQUNqQyxDQUFDO0FBQ0QsY0FBSSxpQkFBaUIsV0FBVyxNQUFNLElBQUksVUFBVSxPQUFPLGFBQWEsQ0FBQztBQUN6RSxjQUFJLGlCQUFpQixZQUFZLENBQUMsVUFBVTtBQUMxQyxrQkFBTSxlQUFlO0FBS3JCLGtCQUFNLE9BQU8sSUFBSSxzQkFBc0I7QUFDdkMsa0JBQU0sVUFBVSxNQUFNLFVBQVUsS0FBSyxNQUFNLEtBQUssU0FBUztBQUN6RCxnQkFBSSxVQUFVLE9BQU8sa0JBQWtCLENBQUMsT0FBTztBQUMvQyxnQkFBSSxVQUFVLE9BQU8saUJBQWlCLE9BQU87QUFBQSxVQUMvQyxDQUFDO0FBQ0QsY0FBSSxpQkFBaUIsYUFBYSxNQUFNLElBQUksVUFBVSxPQUFPLGtCQUFrQixlQUFlLENBQUM7QUFDL0YsY0FBSSxpQkFBaUIsUUFBUSxPQUFPLFVBQVU7QUFDNUMsa0JBQU0sZUFBZTtBQUNyQixrQkFBTSxVQUFVLElBQUksVUFBVSxTQUFTLGVBQWU7QUFDdEQsZ0JBQUksVUFBVSxPQUFPLGtCQUFrQixlQUFlO0FBRXRELGtCQUFNLFlBQVksT0FBTyxNQUFNLGFBQWEsUUFBUSxZQUFZLENBQUM7QUFDakUsZ0JBQUksT0FBTyxNQUFNLFNBQVMsRUFBRztBQUk3QixnQkFBSSxlQUFlLFVBQVUsUUFBUSxJQUFJO0FBQ3pDLGdCQUFJLFlBQVksYUFBYyxpQkFBZ0I7QUFFOUMsa0JBQU0sQ0FBQyxLQUFLLElBQUksTUFBTSxFQUFFLE9BQU8sV0FBVyxDQUFDO0FBQzNDLGtCQUFNLEVBQUUsT0FBTyxjQUFjLEdBQUcsS0FBSztBQUNyQyxrQkFBTSxPQUFPLGFBQWE7QUFDMUIsbUJBQU87QUFBQSxVQUNULENBQUM7QUFBQSxRQUNILENBQUM7QUFBQSxNQUNIO0FBRUEsYUFBTyxpQkFBaUIsU0FBUyxNQUFNO0FBQ3JDLFlBQUksQ0FBQyxZQUFZO0FBQ2YsdUJBQWEsRUFBRSxNQUFNLFlBQVksTUFBTSxHQUFHO0FBQzFDLGlCQUFPO0FBQUEsUUFDVDtBQUNBLGNBQU0sU0FBUyxPQUFPLGlCQUFpQix3QkFBd0I7QUFDL0QsZUFBTyxPQUFPLFNBQVMsQ0FBQyxHQUFHLE1BQU07QUFBQSxNQUNuQyxDQUFDO0FBRUQsYUFBTztBQUFBLElBQ1Q7QUFFQSxJQUFBRixRQUFPLFVBQVUsRUFBRSx1QkFBdUI7QUFBQTtBQUFBOzs7QUN2TTFDO0FBQUEsdUJBQUFHLFVBQUFDLFNBQUE7QUFBQSxRQUFNLEVBQUUsWUFBQUMsWUFBVyxJQUFJO0FBS3ZCLFFBQU0scUJBQXFCO0FBaUMzQixRQUFNLHlCQUF5QjtBQUFBLE1BQzdCLEVBQUUsS0FBSyxLQUFLLE9BQU8sV0FBVyxNQUFNLE9BQUk7QUFBQTtBQUFBLE1BRXhDLEVBQUUsS0FBSyxLQUFLLE9BQU8sY0FBYyxNQUFNLElBQUk7QUFBQSxJQUM3QztBQUlBLFFBQU1DLGdDQUErQjtBQUFBLE1BQUUsR0FBRztBQUFBO0FBQUEsTUFBaUIsR0FBRztBQUFBLElBQUc7QUFFakUsYUFBUyxXQUFXLFVBQVUsS0FBSztBQUNqQyxZQUFNLFFBQVEsT0FBTyxTQUFTLHFCQUFxQixHQUFHLENBQUM7QUFDdkQsYUFBTyxPQUFPLFNBQVMsS0FBSyxLQUFLLFNBQVMsSUFBSSxRQUFRQSw4QkFBNkIsR0FBRztBQUFBLElBQ3hGO0FBSUEsYUFBUyxjQUFjLFVBQVUsS0FBSztBQUNwQyxZQUFNLFFBQVEsV0FBVyxVQUFVLEdBQUc7QUFDdEMsYUFBTyx1QkFBdUIsS0FBSyxDQUFDLFlBQVksUUFBUSxRQUFRLEdBQUcsR0FBRyxXQUFXLENBQUMsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxLQUFLO0FBQUEsSUFDL0c7QUFHQSxhQUFTLGNBQWMsVUFBVSxRQUFRO0FBQ3ZDLFVBQUksQ0FBQyxPQUFRLFFBQU87QUFDcEIsWUFBTSxTQUFTLENBQUM7QUFDaEIsaUJBQVcsRUFBRSxJQUFJLEtBQUssd0JBQXdCO0FBQzVDLGNBQU0sQ0FBQyxLQUFLLEdBQUcsSUFBSSxjQUFjLFVBQVUsR0FBRztBQUM5QyxlQUFPLEdBQUcsSUFBSSxLQUFLLElBQUksS0FBSyxLQUFLLElBQUksS0FBSyxPQUFPLE9BQU8sR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQUEsTUFDckU7QUFDQSxhQUFPO0FBQUEsSUFDVDtBQUVBLFFBQU0sV0FBVyxDQUFDLE1BQU8sS0FBSyxVQUFVLElBQUksVUFBVSxJQUFJLFNBQVMsVUFBVTtBQUM3RSxRQUFNLFVBQVUsQ0FBQyxNQUFPLEtBQUssV0FBWSxRQUFRLElBQUksUUFBUSxNQUFNLElBQUksT0FBTztBQUU5RSxhQUFTLFdBQVcsS0FBSztBQUN2QixZQUFNLFFBQVEscUJBQXFCLEtBQUssT0FBTyxFQUFFO0FBQ2pELFVBQUksQ0FBQyxNQUFPLFFBQU87QUFDbkIsWUFBTSxNQUFNLFNBQVMsTUFBTSxDQUFDLEdBQUcsRUFBRTtBQUNqQyxZQUFNLENBQUMsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFFLE9BQU8sS0FBTSxLQUFNLE9BQU8sSUFBSyxLQUFLLE1BQU0sR0FBRyxFQUFFLElBQUksQ0FBQyxNQUFNLFNBQVMsSUFBSSxHQUFHLENBQUM7QUFDL0YsWUFBTSxJQUFJLEtBQUssS0FBSyxlQUFlLElBQUksZUFBZSxJQUFJLGVBQWUsQ0FBQztBQUMxRSxZQUFNLElBQUksS0FBSyxLQUFLLGVBQWUsSUFBSSxlQUFlLElBQUksZUFBZSxDQUFDO0FBQzFFLFlBQU0sSUFBSSxLQUFLLEtBQUssZUFBZSxJQUFJLGVBQWUsSUFBSSxlQUFlLENBQUM7QUFDMUUsWUFBTSxJQUFJLGVBQWUsSUFBSSxjQUFjLElBQUksZUFBZTtBQUM5RCxZQUFNLElBQUksZUFBZSxJQUFJLGNBQWMsSUFBSSxlQUFlO0FBQzlELFlBQU0sSUFBSSxlQUFlLElBQUksZUFBZSxJQUFJLGNBQWM7QUFDOUQsYUFBTyxFQUFFLEdBQUcsR0FBRyxLQUFLLE1BQU0sR0FBRyxDQUFDLEdBQUcsSUFBSyxLQUFLLE1BQU0sR0FBRyxDQUFDLElBQUksTUFBTyxLQUFLLEtBQUssT0FBTyxJQUFJO0FBQUEsSUFDdkY7QUFHQSxhQUFTLGNBQWMsRUFBRSxHQUFHLEdBQUcsRUFBRSxHQUFHO0FBQ2xDLFlBQU0sSUFBSSxJQUFJLEtBQUssSUFBSyxJQUFJLEtBQUssS0FBTSxHQUFHO0FBQzFDLFlBQU0sSUFBSSxJQUFJLEtBQUssSUFBSyxJQUFJLEtBQUssS0FBTSxHQUFHO0FBQzFDLFlBQU0sS0FBSyxJQUFJLGVBQWUsSUFBSSxlQUFlLE1BQU07QUFDdkQsWUFBTSxLQUFLLElBQUksZUFBZSxJQUFJLGVBQWUsTUFBTTtBQUN2RCxZQUFNLEtBQUssSUFBSSxlQUFlLElBQUksY0FBYyxNQUFNO0FBQ3RELGFBQU87QUFBQSxRQUNMLGVBQWUsSUFBSSxlQUFlLElBQUksZUFBZTtBQUFBLFFBQ3JELGdCQUFnQixJQUFJLGVBQWUsSUFBSSxlQUFlO0FBQUEsUUFDdEQsZ0JBQWdCLElBQUksZUFBZSxJQUFJLGNBQWM7QUFBQSxNQUN2RDtBQUFBLElBQ0Y7QUFFQSxRQUFNLFVBQVUsQ0FBQyxRQUFRLElBQUksTUFBTSxDQUFDLE1BQU0sS0FBSyxTQUFXLEtBQUssTUFBTTtBQU1yRSxhQUFTLFVBQVUsR0FBRyxHQUFHO0FBQ3ZCLFVBQUksTUFBTTtBQUNWLFVBQUksT0FBTztBQUNYLGVBQVMsSUFBSSxHQUFHLElBQUksSUFBSSxLQUFLO0FBQzNCLGNBQU0sT0FBTyxNQUFNLFFBQVE7QUFDM0IsWUFBSSxRQUFRLGNBQWMsRUFBRSxHQUFHLEdBQUcsS0FBSyxFQUFFLENBQUMsQ0FBQyxFQUFHLE9BQU07QUFBQSxZQUMvQyxRQUFPO0FBQUEsTUFDZDtBQUNBLGFBQU87QUFBQSxJQUNUO0FBTUEsYUFBUyxXQUFXLE9BQU87QUFDekIsVUFBSSxNQUFNLGNBQWMsS0FBSztBQUM3QixVQUFJLENBQUMsUUFBUSxHQUFHLEVBQUcsT0FBTSxjQUFjLEVBQUUsR0FBRyxPQUFPLEdBQUcsVUFBVSxNQUFNLEdBQUcsTUFBTSxDQUFDLEVBQUUsQ0FBQztBQUNuRixhQUNFLE1BQ0EsSUFDRyxJQUFJLENBQUMsTUFBTSxLQUFLLE1BQU0sS0FBSyxJQUFJLEdBQUcsS0FBSyxJQUFJLEdBQUcsUUFBUSxLQUFLLElBQUksR0FBRyxLQUFLLElBQUksR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxHQUFHLENBQUMsRUFDM0YsSUFBSSxDQUFDLE1BQU0sRUFBRSxTQUFTLEVBQUUsRUFBRSxTQUFTLEdBQUcsR0FBRyxDQUFDLEVBQzFDLEtBQUssRUFBRTtBQUFBLElBRWQ7QUFNQSxRQUFNLFlBQVksb0JBQUksSUFBSTtBQVExQixRQUFNLGlCQUFpQjtBQUV2QixhQUFTLGNBQWMsR0FBRztBQUN4QixZQUFNLE1BQU0sS0FBSyxNQUFNLENBQUMsSUFBSTtBQUM1QixZQUFNLFNBQVMsVUFBVSxJQUFJLEdBQUc7QUFDaEMsVUFBSSxXQUFXLE9BQVcsUUFBTztBQUNqQyxVQUFJLE1BQU07QUFDVixVQUFJLE9BQU87QUFDWCxlQUFTLElBQUksR0FBRyxJQUFJLElBQUksS0FBSztBQUMzQixjQUFNLFNBQVMsT0FBTyxPQUFPO0FBQzdCLFlBQUksVUFBVSxNQUFNLE9BQU8sR0FBRyxJQUFJLFVBQVUsT0FBTyxPQUFPLEdBQUcsRUFBRyxRQUFPO0FBQUEsWUFDbEUsU0FBUTtBQUFBLE1BQ2Y7QUFDQSxZQUFNLFVBQVUsTUFBTSxRQUFRO0FBQzlCLGdCQUFVLElBQUksS0FBSyxNQUFNO0FBQ3pCLGFBQU87QUFBQSxJQUNUO0FBTUEsYUFBUyxZQUFZLEdBQUcsT0FBTyxLQUFLO0FBQ2xDLFlBQU0sT0FBTyxjQUFjLEtBQUs7QUFDaEMsWUFBTSxLQUFLLGNBQWMsR0FBRztBQUM1QixVQUFJLEtBQUssS0FBTSxRQUFPLE9BQU8sSUFBSyxJQUFJLE9BQVEsS0FBSztBQUNuRCxhQUFPLE9BQU8sSUFBSSxNQUFPLElBQUksU0FBUyxJQUFJLFNBQVUsSUFBSSxNQUFNO0FBQUEsSUFDaEU7QUFPQSxRQUFNLGNBQWMsb0JBQUksSUFBSTtBQUU1QixhQUFTLGlCQUFpQixLQUFLLFFBQVE7QUFDckMsVUFBSSxDQUFDLE9BQVEsUUFBTztBQUNwQixZQUFNLFdBQVcsTUFBTSxPQUFPLE9BQU8sS0FBSyxLQUFLLE9BQU8sT0FBTyxLQUFLO0FBQ2xFLFlBQU0sU0FBUyxZQUFZLElBQUksUUFBUTtBQUN2QyxVQUFJLFdBQVcsT0FBVyxRQUFPO0FBQ2pDLFlBQU0sU0FBUyxtQkFBbUIsS0FBSyxNQUFNO0FBQzdDLFVBQUksWUFBWSxPQUFPLElBQUssYUFBWSxNQUFNO0FBQzlDLGtCQUFZLElBQUksVUFBVSxNQUFNO0FBQ2hDLGFBQU87QUFBQSxJQUNUO0FBbURBLGFBQVMsbUJBQW1CLEtBQUssUUFBUTtBQUN2QyxZQUFNLE9BQU8sV0FBVyxHQUFHO0FBQzNCLFVBQUksQ0FBQyxLQUFNLFFBQU87QUFDbEIsWUFBTSxLQUFLLEtBQUssS0FBSyxPQUFPLEtBQUssS0FBSyxPQUFPO0FBQzdDLFlBQU0sY0FBYyxVQUFVLEtBQUssR0FBRyxLQUFLLENBQUM7QUFHNUMsWUFBTSxVQUFVLEtBQUssSUFBSSxrQkFBa0IsZUFBZTtBQUMxRCxZQUFNLFdBQVcsVUFBVSxJQUFJLEtBQUssSUFBSTtBQUN4QyxZQUFNLFVBQVUsVUFBVSxLQUFLLElBQUksWUFBWSxLQUFLLEdBQUcsS0FBSyxHQUFHLENBQUM7QUFDaEUsWUFBTSxTQUFTLE9BQU8sS0FBSyxLQUFLO0FBQ2hDLFlBQU0sSUFBSSxLQUFLLElBQUksR0FBRyxLQUFLLElBQUksR0FBRyxVQUFVLFNBQVMsU0FBUyxJQUFJLElBQUksVUFBVSxRQUFRLENBQUM7QUFDekYsWUFBTSxJQUFJLFdBQVcsVUFBVSxHQUFHLENBQUM7QUFDbkMsYUFBTyxXQUFXLEVBQUUsR0FBRyxHQUFHLEtBQUssSUFBSSxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUM7QUFBQSxJQUMvQztBQUVBLGFBQVMsZUFBZSxRQUFRO0FBQzlCLGFBQU8sQ0FBQyxDQUFDLFVBQVUsdUJBQXVCLEtBQUssQ0FBQyxFQUFFLElBQUksT0FBTyxPQUFPLEdBQUcsS0FBSyxPQUFPLENBQUM7QUFBQSxJQUN0RjtBQUlBLGFBQVMsYUFBYSxVQUFVLE1BQU0sU0FBUztBQUM3QyxZQUFNLFlBQVksU0FBUyxXQUFXLElBQUksS0FBSztBQUMvQyxVQUFJLENBQUMsYUFBYSxDQUFDLFFBQVMsUUFBTztBQUNuQyxZQUFNLFNBQVMsY0FBYyxVQUFVRCxZQUFXLFVBQVUsTUFBTSxPQUFPLEdBQUcsS0FBSztBQUNqRixhQUFPLGVBQWUsTUFBTSxJQUFJLGlCQUFpQixXQUFXLE1BQU0sSUFBSTtBQUFBLElBQ3hFO0FBR0EsYUFBUyxtQkFBbUIsVUFBVSxNQUFNLFNBQVM7QUFDbkQsYUFBTyxlQUFlLGNBQWMsVUFBVUEsWUFBVyxVQUFVLE1BQU0sT0FBTyxHQUFHLEtBQUssQ0FBQztBQUFBLElBQzNGO0FBVUEsYUFBUyxVQUFVLFVBQVUsTUFBTSxVQUFVLE1BQU07QUFDakQsWUFBTSxhQUFhLENBQUMsQ0FBQyxXQUFXLFNBQVMsV0FBVztBQUNwRCxZQUFNLFlBQVksU0FBUyxXQUFXLElBQUksS0FBSztBQUMvQyxhQUFPO0FBQUEsUUFDTCxRQUFRLGFBQWEsYUFBYSxVQUFVLE1BQU0sT0FBTyxJQUFJLGNBQWM7QUFBQSxRQUMzRSxXQUFXLENBQUMsYUFBYyxjQUFjLENBQUMsbUJBQW1CLFVBQVUsTUFBTSxPQUFPO0FBQUEsTUFDckY7QUFBQSxJQUNGO0FBTUEsYUFBUyxjQUFjLElBQUksT0FBTyxXQUFXO0FBQzNDLFNBQUcsTUFBTSxrQkFBa0IsWUFBWSxnQkFBZ0I7QUFDdkQsU0FBRyxNQUFNLFlBQVksWUFBWSxrQ0FBa0MsS0FBSyxLQUFLO0FBQUEsSUFDL0U7QUFLQSxhQUFTLGFBQWEsUUFBUSxNQUFNLFVBQVUsTUFBTTtBQUNsRCxZQUFNLE9BQU8sT0FBTyxTQUFTLE9BQU8sSUFBSTtBQUN4QyxVQUFJLENBQUMsS0FBTSxRQUFPO0FBQ2xCLFlBQU0sRUFBRSxTQUFTLElBQUk7QUFDckIsVUFBSSxDQUFDLFdBQVcsQ0FBQyxTQUFTLFdBQVcsR0FBRyxPQUFPLFFBQVEsRUFBRyxRQUFPLFNBQVMsV0FBVyxJQUFJLEtBQUs7QUFDOUYsYUFBTyxhQUFhLFVBQVUsTUFBTSxPQUFPLFNBQVMsVUFBVSxJQUFJLENBQUM7QUFBQSxJQUNyRTtBQUVBLElBQUFELFFBQU8sVUFBVTtBQUFBLE1BQ2Y7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0EsOEJBQUFFO0FBQUEsSUFDRjtBQUFBO0FBQUE7OztBQ3hVQTtBQUFBLG9CQUFBQyxVQUFBQyxTQUFBO0FBQUEsUUFBTSxFQUFFLGtCQUFrQixjQUFjLGlCQUFpQixtQkFBbUIsU0FBUyxJQUFJLFFBQVEsVUFBVTtBQUMzRyxRQUFNLEVBQUUsdUJBQXVCLElBQUk7QUFDbkMsUUFBTSxFQUFFLHFCQUFxQixJQUFJO0FBQ2pDLFFBQU0sRUFBRSx3QkFBd0IsOEJBQUFDLCtCQUE4QixXQUFXLElBQUk7QUFFN0UsUUFBTUMsb0JBQW1CO0FBQUEsTUFDdkIsT0FBTyxDQUFDO0FBQUEsTUFDUixZQUFZLENBQUM7QUFBQSxNQUNiLGtCQUFrQixDQUFDO0FBQUEsTUFDbkIsd0JBQXdCLENBQUM7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BUXpCLGtCQUFrQixDQUFDO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFPbkIsZUFBZSxDQUFDO0FBQUEsTUFDaEIsWUFBWSxDQUFDO0FBQUE7QUFBQSxNQUViLGNBQWMsQ0FBQztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQU1mLHFCQUFxQjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BT3JCLGdCQUFnQjtBQUFBO0FBQUE7QUFBQSxNQUdoQix1QkFBdUI7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFNdkIscUJBQXFCO0FBQUE7QUFBQTtBQUFBLE1BR3JCLHdCQUF3QjtBQUFBO0FBQUE7QUFBQSxNQUd4Qix3QkFBd0I7QUFBQSxNQUN4QixjQUFjO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFPZCxrQkFBa0I7QUFBQTtBQUFBO0FBQUEsTUFHbEIsdUJBQXVCO0FBQUEsTUFDdkIscUJBQXFCO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFVckIsb0JBQW9CLEVBQUUsR0FBR0QsOEJBQTZCO0FBQUEsTUFDdEQsWUFBWTtBQUFBLFFBQ1YsY0FBYztBQUFBLFFBQ2QsT0FBTztBQUFBLFFBQ1AsUUFBUTtBQUFBLFFBQ1IsYUFBYTtBQUFBLFFBQ2IsV0FBVztBQUFBLFFBQ1gsV0FBVztBQUFBO0FBQUE7QUFBQSxRQUdYLG9CQUFvQjtBQUFBLFFBQ3BCLGFBQWE7QUFBQSxRQUNiLGNBQWM7QUFBQSxRQUNkLG1CQUFtQjtBQUFBLFFBQ25CLGlCQUFpQjtBQUFBLFFBQ2pCLGlCQUFpQjtBQUFBLFFBQ2pCLGFBQWE7QUFBQSxRQUNiLGVBQWU7QUFBQSxRQUNmLHNCQUFzQjtBQUFBLFFBQ3RCLHVCQUF1QjtBQUFBLFFBQ3ZCLHFCQUFxQjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsUUFLckIsMkJBQTJCO0FBQUEsUUFDM0IsU0FBUztBQUFBLFFBQ1QsZUFBZTtBQUFBLFFBQ2YscUJBQXFCO0FBQUEsUUFDckIsZ0JBQWdCO0FBQUEsUUFDaEIsT0FBTztBQUFBLE1BQ1Q7QUFBQSxJQUNGO0FBRUEsUUFBTUUsdUJBQU4sY0FBa0MsaUJBQWlCO0FBQUEsTUFDakQsWUFBWSxLQUFLLFFBQVE7QUFDdkIsY0FBTSxLQUFLLE1BQU07QUFDakIsYUFBSyxTQUFTO0FBQUEsTUFDaEI7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BTUEsVUFBVTtBQUNSLGNBQU0sRUFBRSxZQUFZLElBQUk7QUFPeEIsY0FBTSxFQUFFLFVBQVUsSUFBSTtBQUN0QixvQkFBWSxNQUFNO0FBRWxCLFlBQUksYUFBYSxXQUFXLEVBQ3pCLFdBQVcsV0FBVyxFQUN0QjtBQUFBLFVBQVcsQ0FBQyxZQUNYLFFBQ0csUUFBUSw2Q0FBMEMsRUFDbEQ7QUFBQSxZQUNDO0FBQUEsVUFDRixFQUNDO0FBQUEsWUFBVSxDQUFDLFdBQ1YsT0FBTyxTQUFTLEtBQUssT0FBTyxTQUFTLG1CQUFtQixFQUFFLFNBQVMsT0FBTyxVQUFVO0FBQ2xGLG1CQUFLLE9BQU8sU0FBUyxzQkFBc0I7QUFDM0Msb0JBQU0sS0FBSyxPQUFPLGFBQWE7QUFDL0IsbUJBQUssT0FBTyxtQkFBbUI7QUFBQSxZQUNqQyxDQUFDO0FBQUEsVUFDSDtBQUFBLFFBQ0o7QUFFRixZQUFJLGFBQWEsV0FBVyxFQUFFLFdBQVcsWUFBWSxFQUFFO0FBQUEsVUFBVyxDQUFDLFlBQ2pFLFFBQ0csUUFBUSx1QkFBdUIsRUFDL0I7QUFBQSxZQUNDO0FBQUEsVUFDRixFQUNDO0FBQUEsWUFBVSxDQUFDLFdBQ1YsT0FBTyxTQUFTLEtBQUssT0FBTyxTQUFTLHFCQUFxQixFQUFFLFNBQVMsT0FBTyxVQUFVO0FBQ3BGLG1CQUFLLE9BQU8sU0FBUyx3QkFBd0I7QUFDN0Msb0JBQU0sS0FBSyxPQUFPLGFBQWE7QUFBQSxZQUNqQyxDQUFDO0FBQUEsVUFDSDtBQUFBLFFBQ0o7QUFPQSxjQUFNLGtCQUFrQixDQUN0QixPQUNBLEtBQ0EsTUFDQSxNQUNBLFlBQVksTUFDWixFQUFFLGFBQWEsK0JBQTRCLGdCQUFnQixpREFBaUQsSUFBSSxDQUFDLE1BRWpILE1BQU0sV0FBVyxDQUFDLFlBQVk7QUFDNUIsa0JBQVEsUUFBUSxJQUFJLEVBQUUsUUFBUSxJQUFJO0FBQ2xDLGdCQUFNLE9BQU8sT0FBTyxZQUFZLFVBQVU7QUFDeEMsaUJBQUssT0FBTyxTQUFTLFdBQVcsVUFBVSxJQUFJO0FBQzlDLGtCQUFNLEtBQUssT0FBTyxhQUFhO0FBQy9CLGlCQUFLLE9BQU8sbUJBQW1CO0FBQUEsVUFDakM7QUFFQSxjQUFJLENBQUMsV0FBVztBQUNkLG9CQUFRLFVBQVUsQ0FBQyxXQUFXLE9BQU8sU0FBUyxLQUFLLE9BQU8sU0FBUyxXQUFXLEdBQUcsQ0FBQyxFQUFFLFNBQVMsQ0FBQyxVQUFVLEtBQUssS0FBSyxLQUFLLENBQUMsQ0FBQztBQUN6SDtBQUFBLFVBQ0Y7QUFFQSxrQkFBUSxVQUFVLFNBQVMseUJBQXlCO0FBQ3BELGdCQUFNLFNBQVMsQ0FBQyxPQUFPLFNBQVMsWUFBWSxjQUFjO0FBQ3hELGtCQUFNLE1BQU0sUUFBUSxVQUFVLFVBQVUsRUFBRSxLQUFLLDZCQUE2QixDQUFDO0FBQzdFLGdCQUFJLFdBQVcsRUFBRSxLQUFLLGdDQUFnQyxNQUFNLE1BQU0sQ0FBQztBQUNuRSxnQkFBSSxnQkFBZ0IsR0FBRyxFQUNwQixXQUFXLE9BQU8sRUFDbEIsU0FBUyxLQUFLLE9BQU8sU0FBUyxXQUFXLFVBQVUsQ0FBQyxFQUNwRCxTQUFTLE9BQU8sVUFBVTtBQUN6QixvQkFBTSxLQUFLLFlBQVksS0FBSztBQUM1QiwwQkFBWTtBQUFBLFlBQ2QsQ0FBQztBQUFBLFVBQ0w7QUFDQSxpQkFBTyxPQUFPLFlBQVksS0FBSyxNQUFNLEtBQUssUUFBUSxDQUFDO0FBQ25ELGNBQUksS0FBSyxPQUFPLFNBQVMsV0FBVyxHQUFHLEVBQUcsUUFBTyxVQUFVLGVBQWUsU0FBUztBQUFBLFFBQ3JGLENBQUM7QUFFSCxjQUFNLGdCQUFnQixJQUFJLGFBQWEsV0FBVyxFQUFFLFdBQVcsZUFBWTtBQUUzRSx3QkFBZ0IsZUFBZSxnQkFBZ0Isa0JBQWtCLHVEQUFvRCxvQkFBb0I7QUFDekksd0JBQWdCLGVBQWUsU0FBUyxTQUFTLDZEQUEwRCxhQUFhO0FBQ3hILHdCQUFnQixlQUFlLFVBQVUsU0FBUyxxREFBa0QsY0FBYztBQUNsSCx3QkFBZ0IsZUFBZSxlQUFlLGdCQUFnQiw2REFBdUQsbUJBQW1CO0FBQ3hJO0FBQUEsVUFDRTtBQUFBLFVBQ0E7QUFBQSxVQUNBO0FBQUEsVUFDQTtBQUFBLFVBQ0E7QUFBQSxRQUNGO0FBQ0E7QUFBQSxVQUNFO0FBQUEsVUFDQTtBQUFBLFVBQ0E7QUFBQSxVQUNBO0FBQUEsVUFDQTtBQUFBLFFBQ0Y7QUFDQTtBQUFBLFVBQ0U7QUFBQSxVQUNBO0FBQUEsVUFDQTtBQUFBLFVBQ0E7QUFBQSxVQUNBO0FBQUEsUUFDRjtBQU9BLGNBQU0sVUFBVSxLQUFLLE9BQU8sU0FBUyxtQkFBbUI7QUFDeEQsY0FBTSxrQkFBa0IsS0FBSyxPQUFPLFNBQVMsMkJBQTJCO0FBRXhFLHNCQUFjLFdBQVcsQ0FBQyxxQkFBcUI7QUFDN0MsMkJBQ0csUUFBUSw2QkFBNkIsRUFDckM7QUFBQSxZQUNDLFVBQ0ksd0dBQ0csa0JBQWtCLG1DQUFtQyxNQUN0RCxNQUNGO0FBQUEsVUFDTixFQUNDO0FBQUEsWUFBWSxDQUFDLGFBQ1osU0FDRyxVQUFVLFFBQVEsUUFBUSxFQUMxQixVQUFVLE9BQU8sb0JBQW9CLEVBQ3JDLFVBQVUsU0FBUyxtQkFBbUIsRUFDdEMsU0FBUyxLQUFLLE9BQU8sU0FBUyxjQUFjLEVBQzVDLFNBQVMsT0FBTyxVQUFVO0FBQ3pCLG1CQUFLLE9BQU8sU0FBUyxpQkFBaUI7QUFDdEMsb0JBQU0sS0FBSyxPQUFPLGFBQWE7QUFDL0IsbUJBQUssT0FBTyxtQkFBbUI7QUFDL0IsbUJBQUssUUFBUTtBQUFBLFlBQ2YsQ0FBQztBQUFBLFVBQ0w7QUFNRixnQkFBTSxhQUFhLEtBQUssT0FBTyxTQUFTLHVCQUF1QjtBQUMvRCxnQkFBTSxhQUNKLEtBQUssT0FBTyxTQUFTLG1CQUFtQixTQUN2QyxXQUFXLEtBQUssT0FBTyxTQUFTLHlCQUF5QixlQUFlO0FBQzNFLGNBQUksQ0FBQyxXQUFXLENBQUMsV0FBWTtBQU03QiwyQkFBaUIsVUFBVSxTQUFTLHlCQUF5QjtBQUs3RCxnQkFBTSxtQkFBbUIsQ0FBQyxPQUFPLFNBQVMsT0FBTyxhQUFhO0FBQzVELGtCQUFNLE1BQU0saUJBQWlCLFVBQVUsVUFBVSxFQUFFLEtBQUssNkJBQTZCLENBQUM7QUFDdEYsZ0JBQUksV0FBVyxFQUFFLEtBQUssZ0NBQWdDLE1BQU0sTUFBTSxDQUFDO0FBQ25FLGdCQUFJLGdCQUFnQixHQUFHLEVBQUUsV0FBVyxPQUFPLEVBQUUsU0FBUyxLQUFLLEVBQUUsU0FBUyxRQUFRO0FBQUEsVUFDaEY7QUFFQSxnQkFBTSxrQkFBa0IsQ0FBQyxVQUN2QjtBQUFBLFlBQ0U7QUFBQSxZQUNBO0FBQUEsWUFDQSxLQUFLLE9BQU8sU0FBUyxXQUFXO0FBQUEsWUFDaEMsT0FBTyxVQUFVO0FBQ2YsbUJBQUssT0FBTyxTQUFTLFdBQVcsd0JBQXdCO0FBQ3hELG9CQUFNLEtBQUssT0FBTyxhQUFhO0FBQy9CLG1CQUFLLE9BQU8sbUJBQW1CO0FBQUEsWUFDakM7QUFBQSxVQUNGO0FBRUYsY0FBSSxDQUFDLFNBQVM7QUFDWiw0QkFBZ0IsUUFBUTtBQUN4QjtBQUFBLFVBQ0Y7QUFFQSxnQkFBTSxXQUFXLGlCQUFpQixVQUFVLFVBQVUsRUFBRSxLQUFLLDZCQUE2QixDQUFDO0FBQzNGLG1CQUFTLFdBQVcsRUFBRSxLQUFLLGdDQUFnQyxNQUFNLGVBQWUsQ0FBQztBQUNqRixjQUFJLGtCQUFrQixRQUFRLEVBQzNCLFVBQVUsUUFBUSxPQUFPLEVBQ3pCLFVBQVUsZ0JBQWdCLGNBQWMsRUFDeEMsVUFBVSxXQUFXLFVBQVUsRUFDL0IsU0FBUyxVQUFVLEVBQ25CLFNBQVMsT0FBTyxVQUFVO0FBQ3pCLGlCQUFLLE9BQU8sU0FBUyxzQkFBc0I7QUFDM0Msa0JBQU0sS0FBSyxPQUFPLGFBQWE7QUFDL0IsaUJBQUssT0FBTyxtQkFBbUI7QUFDL0IsaUJBQUssUUFBUTtBQUFBLFVBQ2YsQ0FBQztBQUVILDJCQUFpQixVQUFVLG9DQUFvQyxLQUFLLE9BQU8sU0FBUyx1QkFBdUIsT0FBTyxVQUFVO0FBQzFILGlCQUFLLE9BQU8sU0FBUyx3QkFBd0I7QUFDN0Msa0JBQU0sS0FBSyxPQUFPLGFBQWE7QUFDL0IsaUJBQUssT0FBTyxtQkFBbUI7QUFDL0IsaUJBQUssUUFBUTtBQUFBLFVBQ2YsQ0FBQztBQUNELGNBQUksV0FBWSxpQkFBZ0IsY0FBYztBQUU5QywyQkFBaUIscUJBQXFCLDhDQUE4QyxpQkFBaUIsT0FBTyxVQUFVO0FBQ3BILGlCQUFLLE9BQU8sU0FBUyx5QkFBeUIsUUFBUSxVQUFVO0FBQ2hFLGtCQUFNLEtBQUssT0FBTyxhQUFhO0FBQy9CLGlCQUFLLE9BQU8sbUJBQW1CO0FBQy9CLGlCQUFLLFFBQVE7QUFBQSxVQUNmLENBQUM7QUFFRCxjQUFJLGlCQUFpQjtBQUNuQjtBQUFBLGNBQ0U7QUFBQSxjQUNBO0FBQUEsY0FDQSxLQUFLLE9BQU8sU0FBUywyQkFBMkI7QUFBQSxjQUNoRCxPQUFPLFVBQVU7QUFDZixxQkFBSyxPQUFPLFNBQVMseUJBQXlCLFFBQVEsUUFBUTtBQUM5RCxzQkFBTSxLQUFLLE9BQU8sYUFBYTtBQUMvQixxQkFBSyxPQUFPLG1CQUFtQjtBQUFBLGNBQ2pDO0FBQUEsWUFDRjtBQUFBLFVBQ0Y7QUFBQSxRQUNGLENBQUM7QUFFRDtBQUFBLFVBQ0U7QUFBQSxVQUNBO0FBQUEsVUFDQTtBQUFBLFVBQ0E7QUFBQSxVQUNBO0FBQUEsUUFDRjtBQUNBO0FBQUEsVUFDRTtBQUFBLFVBQ0E7QUFBQSxVQUNBO0FBQUEsVUFDQTtBQUFBLFVBQ0E7QUFBQSxRQUNGO0FBQ0E7QUFBQSxVQUNFO0FBQUEsVUFDQTtBQUFBLFVBQ0E7QUFBQSxVQUNBO0FBQUEsVUFDQTtBQUFBLFVBQ0EsRUFBRSxZQUFZLDZCQUE2QixlQUFlLHNFQUFtRTtBQUFBLFFBQy9IO0FBTUEsY0FBTSxvQkFBb0IsSUFBSSxhQUFhLFdBQVcsRUFBRSxXQUFXLGVBQWU7QUFDbEYsY0FBTSxXQUFXO0FBQUEsVUFBRSxHQUFHO0FBQUE7QUFBQSxVQUFtQixHQUFHO0FBQUEsUUFBSTtBQUNoRCxjQUFNLFlBQVk7QUFBQSxVQUNoQixHQUFHO0FBQUE7QUFBQSxVQUVILEdBQUc7QUFBQSxRQUNMO0FBR0EsY0FBTSxvQkFBb0IsU0FBUyxNQUFNLEtBQUssT0FBTyxtQkFBbUIsR0FBRyxLQUFLLElBQUk7QUFDcEYsbUJBQVcsRUFBRSxLQUFLLE9BQU8sTUFBTSxTQUFTLEtBQUssd0JBQXdCO0FBQ25FLDRCQUFrQjtBQUFBLFlBQVcsQ0FBQyxZQUM1QixRQUNHLFFBQVEsR0FBRyxLQUFLLEtBQUssV0FBVyxXQUFNLE1BQUcsSUFBSSxJQUFJLEdBQUcsRUFDcEQsUUFBUSxVQUFVLEdBQUcsQ0FBQyxFQUN0QjtBQUFBLGNBQVUsQ0FBQyxXQUNWLE9BQ0csVUFBVSxHQUFHLFNBQVMsR0FBRyxHQUFHLENBQUMsRUFDN0IsU0FBUyxXQUFXLEtBQUssT0FBTyxVQUFVLEdBQUcsQ0FBQyxFQUM5QyxrQkFBa0IsRUFDbEIsU0FBUyxPQUFPLFVBQVU7QUFDekIscUJBQUssT0FBTyxTQUFTLHFCQUFxQixFQUFFLEdBQUdGLCtCQUE4QixHQUFHLEtBQUssT0FBTyxTQUFTLG9CQUFvQixDQUFDLEdBQUcsR0FBRyxNQUFNO0FBQ3RJLHNCQUFNLEtBQUssT0FBTyxhQUFhO0FBQy9CLGtDQUFrQjtBQUFBLGNBQ3BCLENBQUM7QUFBQSxZQUNMLEVBQ0M7QUFBQSxjQUFlLENBQUMsV0FDZixPQUNHLFFBQVEsWUFBWSxFQUNwQixXQUFXLHVCQUFvQkEsOEJBQTZCLEdBQUcsQ0FBQyxFQUFFLEVBQ2xFLFFBQVEsWUFBWTtBQUNuQixxQkFBSyxPQUFPLFNBQVMscUJBQXFCLEVBQUUsR0FBR0EsK0JBQThCLEdBQUcsS0FBSyxPQUFPLFNBQVMsb0JBQW9CLENBQUMsR0FBRyxHQUFHQSw4QkFBNkIsR0FBRyxFQUFFO0FBQ2xLLHNCQUFNLEtBQUssT0FBTyxhQUFhO0FBQy9CLHFCQUFLLE9BQU8sbUJBQW1CO0FBQy9CLHFCQUFLLFFBQVE7QUFBQSxjQUNmLENBQUM7QUFBQSxZQUNMO0FBQUEsVUFDSjtBQUFBLFFBQ0Y7QUEwREEsY0FBTSxtQkFBbUIsSUFBSSxhQUFhLFdBQVcsRUFBRSxXQUFXLGlCQUFpQjtBQUVuRjtBQUFBLFVBQ0U7QUFBQSxVQUNBO0FBQUEsVUFDQTtBQUFBLFVBQ0E7QUFBQSxVQUNBO0FBQUEsVUFDQSxFQUFFLFlBQVksNkJBQTZCLGVBQWUscURBQWtEO0FBQUEsUUFDOUc7QUFLQSx5QkFBaUIsV0FBVyxDQUFDLFlBQVk7QUFDdkMsa0JBQVEsVUFBVSxTQUFTLG9CQUFvQjtBQUMvQyxpQ0FBdUIsUUFBUSxRQUFRLEtBQUssTUFBTTtBQUNsRCxrQkFBUSxPQUFPLFVBQVU7QUFBQSxZQUN2QixLQUFLO0FBQUEsWUFDTCxNQUNFO0FBQUEsVUFDSixDQUFDO0FBQUEsUUFDSCxDQUFDO0FBRUQsb0JBQVksWUFBWTtBQUFBLE1BQzFCO0FBQUEsSUFDRjtBQUVBLElBQUFELFFBQU8sVUFBVSxFQUFFLGtCQUFBRSxtQkFBa0IscUJBQUFDLHFCQUFvQjtBQUFBO0FBQUE7OztBQ3JmekQ7QUFBQSxvQkFBQUMsVUFBQUMsU0FBQTtBQUFBLFFBQU0sRUFBRSxPQUFPLElBQUksUUFBUSxVQUFVO0FBQ3JDLFFBQU0sRUFBRSxvQkFBb0IsMEJBQTBCLElBQUk7QUFFMUQsYUFBU0Msa0JBQWlCLFFBQVE7QUFPaEMsWUFBTSxtQkFBbUIsQ0FBQyxPQUFPLE9BQU8sWUFBWTtBQUNsRCxZQUFJO0FBQ0YsZ0JBQU0sR0FBRztBQUFBLFFBQ1gsU0FBUyxPQUFPO0FBQ2Qsa0JBQVEsTUFBTSxJQUFJLEtBQUssS0FBSyxLQUFLO0FBQ2pDLGNBQUksT0FBTyxHQUFHLEtBQUssb0JBQW9CLE1BQU0sT0FBTyxFQUFFO0FBQUEsUUFDeEQ7QUFBQSxNQUNGO0FBRUEsYUFBTyxXQUFXO0FBQUEsUUFDaEIsSUFBSTtBQUFBLFFBQ0osTUFBTTtBQUFBLFFBQ04sVUFBVSxpQkFBaUIsMEJBQTBCLFlBQVk7QUFDL0QsZ0JBQU0sRUFBRSxTQUFTLFFBQVEsSUFBSSxNQUFNLG1CQUFtQixPQUFPLEtBQUssUUFBUSxJQUFJO0FBQzlFLGNBQUk7QUFBQSxZQUNGLFVBQVUsSUFDTiwyQkFBMkIsT0FBTyx3QkFBcUIsT0FBTyxlQUM5RCwyQkFBMkIsT0FBTztBQUFBLFVBQ3hDO0FBQUEsUUFDRixDQUFDO0FBQUEsTUFDSCxDQUFDO0FBRUQsYUFBTyxXQUFXO0FBQUEsUUFDaEIsSUFBSTtBQUFBLFFBQ0osTUFBTTtBQUFBLFFBQ04sVUFBVSxpQkFBaUIsMEJBQTBCLFlBQVk7QUFPL0QsZ0JBQU0sT0FBTyxNQUFNLE9BQU8sU0FBUyxFQUFFLGtCQUFrQixNQUFNLHFCQUFxQixLQUFLLENBQUM7QUFDeEYsY0FBSSxDQUFDLEtBQU07QUFDWCxnQkFBTSxFQUFFLFNBQVMsU0FBUyxnQkFBZ0IsSUFBSSxNQUFNLG1CQUFtQixPQUFPLEtBQUssUUFBUSxJQUFJO0FBQy9GLGNBQUksVUFDRixVQUFVLElBQ04sMEJBQTBCLElBQUksS0FBSyxPQUFPLHdCQUFxQixPQUFPLGVBQ3RFLDBCQUEwQixJQUFJLEtBQUssT0FBTztBQUloRCxjQUFJLG9CQUFvQixPQUFPO0FBQzdCLHVCQUFXLG9CQUFpQixJQUFJO0FBQUEsVUFDbEM7QUFDQSxjQUFJLE9BQU8sT0FBTztBQUFBLFFBQ3BCLENBQUM7QUFBQSxNQUNILENBQUM7QUFFRCxhQUFPLFdBQVc7QUFBQSxRQUNoQixJQUFJO0FBQUEsUUFDSixNQUFNO0FBQUEsUUFDTixlQUFlLENBQUMsYUFBYTtBQUMzQixnQkFBTSxPQUFPLE9BQU8sSUFBSSxVQUFVLGNBQWM7QUFDaEQsY0FBSSxDQUFDLFFBQVEsS0FBSyxjQUFjLEtBQU0sUUFBTztBQUM3QyxjQUFJLFNBQVUsUUFBTztBQUVyQiwyQkFBaUIsMEJBQTBCLFlBQVk7QUFDckQsa0JBQU0sVUFBVSxNQUFNLDBCQUEwQixPQUFPLEtBQUssUUFBUSxJQUFJO0FBQ3hFLGdCQUFJLE9BQU8sVUFBVSxvQkFBb0IsS0FBSyxRQUFRLGdCQUFnQixvQkFBb0IsS0FBSyxRQUFRLHlCQUF5QjtBQUFBLFVBQ2xJLENBQUMsRUFBRTtBQUNILGlCQUFPO0FBQUEsUUFDVDtBQUFBLE1BQ0YsQ0FBQztBQUFBLElBRUg7QUFFQSxJQUFBRCxRQUFPLFVBQVUsRUFBRSxrQkFBQUMsa0JBQWlCO0FBQUE7QUFBQTs7O0FDN0VwQztBQUFBLHFCQUFBQyxVQUFBQyxTQUFBO0FBQUEsUUFBTSxFQUFFLE9BQU8sSUFBSSxRQUFRLFVBQVU7QUFxQ3JDLFFBQU0sa0JBQWtCO0FBQUEsTUFDdEI7QUFBQSxRQUNFLE1BQU07QUFBQSxRQUNOLGFBQWE7QUFBQSxRQUNiLFNBQVMsTUFBTSxPQUFPLEVBQUUsT0FBTyxZQUFZO0FBQUEsTUFDN0M7QUFBQSxNQUNBO0FBQUEsUUFDRSxNQUFNO0FBQUEsUUFDTixhQUFhO0FBQUEsUUFDYixTQUFTLE1BQU0sT0FBTyxFQUFFLE9BQU8sa0JBQWtCO0FBQUEsTUFDbkQ7QUFBQSxNQUNBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxRQUtFLE1BQU07QUFBQSxRQUNOLGFBQWE7QUFBQSxRQUNiLFNBQVMsQ0FBQyxTQUFTLE9BQU8sTUFBTSxNQUFNLFNBQVMsS0FBSyxJQUFJLENBQUMsRUFBRSxPQUFPLFlBQVk7QUFBQSxNQUNoRjtBQUFBLElBQ0Y7QUFLQSxRQUFNLGdCQUFnQjtBQUV0QixhQUFTLGtCQUFrQixNQUFNO0FBQy9CLGFBQU8sZ0JBQWdCLEtBQUssQ0FBQyxhQUFhLFNBQVMsU0FBUyxJQUFJLEtBQUs7QUFBQSxJQUN2RTtBQUtBLGFBQVNDLGNBQWEsTUFBTTtBQUMxQixhQUFPLE9BQU8sU0FBUyxZQUFZLEtBQUssV0FBVyxhQUFhLElBQUksS0FBSyxNQUFNLGNBQWMsTUFBTSxJQUFJO0FBQUEsSUFDekc7QUFFQSxhQUFTLGlCQUFpQixRQUFRO0FBQ2hDLGFBQU9BLGNBQWEsUUFBUSxJQUFJLE1BQU07QUFBQSxJQUN4QztBQVNBLGFBQVMsY0FBYyxRQUFRO0FBQzdCLFVBQUksQ0FBQyxRQUFRLEtBQU0sUUFBTztBQUMxQixZQUFNLFFBQVEsT0FBTyxPQUFPLE9BQU8sUUFBUSxDQUFDLENBQUMsRUFBRSxPQUFPLENBQUMsVUFBVSxVQUFVLE1BQVM7QUFDcEYsYUFBTyxNQUFNLFNBQVMsSUFBSSxHQUFHLE9BQU8sSUFBSSxLQUFLLE1BQU0sS0FBSyxJQUFJLENBQUMsS0FBSyxPQUFPO0FBQUEsSUFDM0U7QUFVQSxhQUFTLGNBQWMsS0FBSztBQUMxQixZQUFNLE9BQU8sT0FBTyxPQUFPLEVBQUUsRUFBRSxLQUFLO0FBQ3BDLFVBQUksU0FBUyxHQUFJLFFBQU87QUFDeEIsVUFBSSxTQUFTLE9BQVEsUUFBTztBQUM1QixVQUFJLFNBQVMsUUFBUyxRQUFPO0FBQzdCLFVBQUksU0FBUyxPQUFRLFFBQU87QUFDNUIsVUFBSSxvQkFBb0IsS0FBSyxJQUFJLEVBQUcsUUFBTyxPQUFPLElBQUk7QUFDdEQsYUFBTztBQUFBLElBQ1Q7QUFlQSxRQUFNLGtCQUFrQixDQUFDLFdBQVcsT0FBTyxLQUFLO0FBS2hELGFBQVMsWUFBWSxRQUFRO0FBQzNCLGNBQVEsVUFBVSxDQUFDLEdBQUcsT0FBTyxDQUFDLFNBQVMsU0FBUyxRQUFRLENBQUMsZ0JBQWdCLFNBQVMsSUFBSSxDQUFDO0FBQUEsSUFDekY7QUFLQSxhQUFTLFVBQVUsUUFBUSxVQUFVO0FBQ25DLFlBQU0sT0FBTyxDQUFDO0FBQ2QsaUJBQVcsUUFBUSxZQUFZLE1BQU0sR0FBRztBQUN0QyxjQUFNLFFBQVEsY0FBYyxTQUFTLElBQUksQ0FBQztBQUMxQyxZQUFJLFVBQVUsT0FBVyxNQUFLLElBQUksSUFBSTtBQUFBLE1BQ3hDO0FBQ0EsYUFBTztBQUFBLElBQ1Q7QUFpQkEsYUFBU0MsaUJBQWdCLFFBQVEsTUFBTSxXQUFXLENBQUMsR0FBRztBQUNwRCxVQUFJLFdBQVcsUUFBUSxXQUFXLE9BQVcsUUFBTyxDQUFDLFNBQVMsU0FBUyxTQUFTLEdBQUc7QUFFbkYsWUFBTSxRQUFRLENBQUM7QUFDZixZQUFNLGlCQUFpQixvQkFBSSxJQUFJO0FBQy9CLGlCQUFXLFFBQVEsUUFBUTtBQUN6QixZQUFJLFNBQVMsS0FBTTtBQUNuQixZQUFJLGdCQUFnQixTQUFTLElBQUksR0FBRztBQUNsQyxnQkFBTSxLQUFLLFNBQVMsSUFBSSxDQUFDO0FBQ3pCO0FBQUEsUUFDRjtBQUNBLGNBQU0sUUFBUSxLQUFLLFFBQVEsR0FBRztBQUM5QixZQUFJLFVBQVUsSUFBSTtBQUNoQixnQkFBTSxLQUFLLE9BQU8sSUFBSSxDQUFDO0FBQ3ZCO0FBQUEsUUFDRjtBQUNBLGNBQU0sUUFBUSxLQUFLLE1BQU0sR0FBRyxLQUFLO0FBQ2pDLFlBQUksQ0FBQyxlQUFlLElBQUksS0FBSyxHQUFHO0FBQzlCLHlCQUFlLElBQUksT0FBTyxNQUFNLE1BQU07QUFDdEMsZ0JBQU0sS0FBSyxDQUFDLENBQUM7QUFBQSxRQUNmO0FBQ0EsY0FBTSxPQUFPLE9BQU8sSUFBSTtBQUN4QixZQUFJLFNBQVMsT0FBVyxPQUFNLGVBQWUsSUFBSSxLQUFLLENBQUMsRUFBRSxLQUFLLE1BQU0sUUFBUSxDQUFDLENBQUMsSUFBSTtBQUFBLE1BQ3BGO0FBQ0EsYUFBTztBQUFBLElBQ1Q7QUFPQSxhQUFTLGVBQWUsS0FBSyxLQUFLO0FBQ2hDLGFBQU8sS0FBSyxxQkFBcUIsY0FBYyxHQUFHLEdBQUcsVUFBVSxTQUFTO0FBQUEsSUFDMUU7QUFXQSxhQUFTQyxrQkFBaUIsYUFBYSxXQUFXLEVBQUUsTUFBTSxJQUFJLElBQUksQ0FBQyxHQUFHO0FBQ3BFLFlBQU0sV0FBVyxDQUFDO0FBQ2xCLGlCQUFXLENBQUMsS0FBSyxLQUFLLEtBQUssT0FBTyxRQUFRLFdBQVcsR0FBRztBQUN0RCxjQUFNLFNBQVMsWUFBWSxHQUFHO0FBQzlCLGNBQU0sUUFBUSxTQUFTLGtCQUFrQixPQUFPLElBQUksSUFBSTtBQUN4RCxZQUFJLE9BQU87QUFDVCxnQkFBTSxTQUFTLE1BQU0sUUFBUSxJQUFJO0FBQ2pDLG1CQUFTLEdBQUcsSUFBSSxlQUFlLEtBQUssR0FBRyxJQUFJLENBQUMsTUFBTSxJQUFJO0FBQUEsUUFDeEQsV0FBVyxpQkFBaUIsTUFBTSxHQUFHO0FBQ25DLG1CQUFTLEdBQUcsSUFBSTtBQUFBLFFBQ2xCLE9BQU87QUFDTCxtQkFBUyxHQUFHLElBQUk7QUFBQSxRQUNsQjtBQUFBLE1BQ0Y7QUFDQSxhQUFPO0FBQUEsSUFDVDtBQUVBLElBQUFILFFBQU8sVUFBVTtBQUFBLE1BQ2Y7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0EsY0FBQUM7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0EsaUJBQUFDO0FBQUEsTUFDQTtBQUFBLE1BQ0Esa0JBQUFDO0FBQUEsSUFDRjtBQUFBO0FBQUE7OztBQzFPQTtBQUFBLDJCQUFBQyxVQUFBQyxTQUFBO0FBQUEsUUFBTSxFQUFFLG1CQUFtQixPQUFPLFFBQVEsSUFBSSxRQUFRLFVBQVU7QUFDaEUsUUFBTSxFQUFFLGlCQUFpQixlQUFlLFdBQVcsWUFBWSxJQUFJO0FBS25FLGFBQVMsVUFBVSxNQUFNO0FBQ3ZCLGFBQU8sS0FBSyxTQUFTLEdBQUcsS0FBSyxJQUFJLElBQUksS0FBSyxPQUFPLEtBQUssSUFBSSxDQUFDLE1BQU0sS0FBSztBQUFBLElBQ3hFO0FBV0EsUUFBTSxzQkFBTixjQUFrQyxrQkFBa0I7QUFBQSxNQUNsRCxZQUFZLEtBQUssS0FBSyxPQUFPLFNBQVM7QUFDcEMsY0FBTSxHQUFHO0FBQ1QsYUFBSyxRQUFRO0FBQ2IsYUFBSyxVQUFVO0FBQ2YsYUFBSyxTQUFTO0FBQ2QsYUFBSyxlQUFlLHlCQUFpQixHQUFHLGtDQUFxQjtBQUFBLE1BQy9EO0FBQUEsTUFFQSxXQUFXO0FBQ1QsZUFBTyxLQUFLO0FBQUEsTUFDZDtBQUFBO0FBQUE7QUFBQSxNQUlBLFlBQVksTUFBTTtBQUNoQixjQUFNLFFBQVEsVUFBVSxJQUFJO0FBQzVCLGVBQU8sS0FBSyxjQUFjLEdBQUcsS0FBSyxJQUFJLEtBQUssV0FBVyxLQUFLO0FBQUEsTUFDN0Q7QUFBQSxNQUVBLGlCQUFpQixPQUFPLElBQUk7QUFDMUIsY0FBTSxPQUFPLE1BQU07QUFDbkIsV0FBRyxTQUFTLDhCQUE4QjtBQUMxQyxXQUFHLFNBQVMsUUFBUSxFQUFFLEtBQUsscUNBQXFDLE1BQU0sVUFBVSxJQUFJLEVBQUUsQ0FBQztBQUN2RixZQUFJLEtBQUssWUFBYSxJQUFHLFdBQVcsRUFBRSxLQUFLLHFDQUFxQyxNQUFNLEtBQUssWUFBWSxDQUFDO0FBQUEsTUFDMUc7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BTUEsaUJBQWlCLE1BQU0sS0FBSztBQUMxQixhQUFLLFNBQVM7QUFDZCxjQUFNLGlCQUFpQixNQUFNLEdBQUc7QUFBQSxNQUNsQztBQUFBLE1BRUEsYUFBYSxNQUFNO0FBQ2pCLGFBQUssUUFBUSxJQUFJO0FBQUEsTUFDbkI7QUFBQSxNQUVBLFVBQVU7QUFDUixjQUFNLFFBQVE7QUFDZCxZQUFJLENBQUMsS0FBSyxPQUFRLE1BQUssUUFBUSxJQUFJO0FBQUEsTUFDckM7QUFBQSxJQUNGO0FBYUEsUUFBTSxvQkFBTixjQUFnQyxNQUFNO0FBQUEsTUFDcEMsWUFBWSxLQUFLLE1BQU0sWUFBWSxTQUFTO0FBQzFDLGNBQU0sR0FBRztBQUNULGFBQUssT0FBTztBQUNaLGFBQUssVUFBVTtBQUNmLGFBQUssU0FBUyxZQUFZLEtBQUssTUFBTTtBQUNyQyxhQUFLLFdBQVcsQ0FBQztBQUNqQixtQkFBVyxRQUFRLEtBQUssUUFBUTtBQUM5QixnQkFBTSxPQUFPLGFBQWEsSUFBSTtBQUM5QixlQUFLLFNBQVMsSUFBSSxJQUFJLFNBQVMsVUFBYSxTQUFTLE9BQU8sS0FBSyxPQUFPLElBQUk7QUFBQSxRQUM5RTtBQUNBLGFBQUssYUFBYTtBQUFBLE1BQ3BCO0FBQUEsTUFFQSxTQUFTO0FBQ1AsYUFBSyxRQUFRLFFBQVEsb0JBQWlCLEtBQUssS0FBSyxJQUFJLEVBQUU7QUFDdEQsWUFBSSxLQUFLLEtBQUssYUFBYTtBQUN6QixlQUFLLFVBQVUsVUFBVSxFQUFFLEtBQUssK0JBQStCLE1BQU0sS0FBSyxLQUFLLFlBQVksQ0FBQztBQUFBLFFBQzlGO0FBQ0EsbUJBQVcsUUFBUSxLQUFLLFFBQVE7QUFDOUIsY0FBSSxRQUFRLEtBQUssU0FBUyxFQUFFLFFBQVEsSUFBSSxFQUFFO0FBQUEsWUFBUSxDQUFDLFNBQ2pELEtBQ0csU0FBUyxLQUFLLFNBQVMsSUFBSSxDQUFDLEVBQzVCLFNBQVMsQ0FBQyxVQUFVO0FBQ25CLG1CQUFLLFNBQVMsSUFBSSxJQUFJO0FBQUEsWUFDeEIsQ0FBQyxFQUdBLFFBQVEsaUJBQWlCLFdBQVcsQ0FBQyxVQUFVO0FBQzlDLGtCQUFJLE1BQU0sUUFBUSxXQUFXLENBQUMsTUFBTSxhQUFhO0FBQy9DLHNCQUFNLGVBQWU7QUFDckIscUJBQUssWUFBWTtBQUFBLGNBQ25CO0FBQUEsWUFDRixDQUFDO0FBQUEsVUFDTDtBQUFBLFFBQ0Y7QUFDQSxZQUFJLFFBQVEsS0FBSyxTQUFTLEVBQUU7QUFBQSxVQUFVLENBQUMsV0FDckMsT0FDRyxjQUFjLGVBQVksRUFDMUIsT0FBTyxFQUNQLFFBQVEsTUFBTSxLQUFLLFlBQVksQ0FBQztBQUFBLFFBQ3JDO0FBQUEsTUFDRjtBQUFBLE1BRUEsY0FBYztBQUNaLGFBQUssYUFBYTtBQUNsQixhQUFLLE1BQU07QUFBQSxNQUNiO0FBQUEsTUFFQSxVQUFVO0FBQ1IsYUFBSyxVQUFVLE1BQU07QUFJckIsYUFBSyxRQUFRLEtBQUssYUFBYSxVQUFVLEtBQUssUUFBUSxLQUFLLFFBQVEsSUFBSSxJQUFJO0FBQUEsTUFDN0U7QUFBQSxJQUNGO0FBUUEsbUJBQWUsYUFBYSxLQUFLLEtBQUssWUFBWSxZQUFZLE1BQU07QUFDbEUsWUFBTSxRQUFRO0FBQUEsUUFDWixHQUFHLGdCQUFnQixJQUFJLENBQUMsRUFBRSxNQUFNLFlBQVksT0FBTyxFQUFFLE1BQU0sYUFBYSxRQUFRLEtBQUssRUFBRTtBQUFBLFFBQ3ZGLEdBQUcsV0FBVyxFQUFFLElBQUksQ0FBQyxFQUFFLE1BQU0sUUFBUSxZQUFZLE9BQU8sRUFBRSxNQUFNLGdCQUFnQixNQUFNLFFBQVEsWUFBWSxFQUFFO0FBQUEsTUFDOUc7QUFFQSxZQUFNLE9BQU8sTUFBTSxJQUFJLFFBQVEsQ0FBQyxZQUFZLElBQUksb0JBQW9CLEtBQUssS0FBSyxPQUFPLE9BQU8sRUFBRSxLQUFLLENBQUM7QUFDcEcsVUFBSSxDQUFDLEtBQU0sUUFBTztBQUlsQixVQUFJLFlBQVksS0FBSyxNQUFNLEVBQUUsV0FBVyxFQUFHLFFBQU8sRUFBRSxNQUFNLEtBQUssS0FBSztBQUlwRSxZQUFNLGNBQWMsV0FBVyxTQUFTLEtBQUssT0FBTyxVQUFVLE9BQU87QUFDckUsWUFBTSxPQUFPLE1BQU0sSUFBSSxRQUFRLENBQUMsWUFBWSxJQUFJLGtCQUFrQixLQUFLLE1BQU0sYUFBYSxPQUFPLEVBQUUsS0FBSyxDQUFDO0FBQ3pHLFVBQUksU0FBUyxLQUFNLFFBQU87QUFDMUIsYUFBTyxPQUFPLEtBQUssSUFBSSxFQUFFLFNBQVMsSUFBSSxFQUFFLE1BQU0sS0FBSyxNQUFNLEtBQUssSUFBSSxFQUFFLE1BQU0sS0FBSyxLQUFLO0FBQUEsSUFDdEY7QUFFQSxJQUFBQSxRQUFPLFVBQVUsRUFBRSxhQUFhO0FBQUE7QUFBQTs7O0FDaktoQztBQUFBLG1DQUFBQyxVQUFBQyxTQUFBO0FBQUEsUUFBTSxFQUFFLGNBQWMsTUFBTSxRQUFRLElBQUksUUFBUSxVQUFVO0FBQzFELFFBQU0sRUFBRSxjQUFjLElBQUk7QUFDMUIsUUFBTSxFQUFFLGFBQWEsSUFBSTtBQUN6QixRQUFNLEVBQUUsWUFBQUMsYUFBWSxjQUFjLElBQUk7QUFLdEMsUUFBTSxlQUFlO0FBRXJCLFFBQU1DLGdCQUFlO0FBQ3JCLFFBQU1DLG1CQUFrQjtBQUN4QixRQUFNLG9CQUFvQixDQUFDRCxjQUFhLFlBQVksR0FBR0MsaUJBQWdCLFlBQVksQ0FBQztBQVVwRixhQUFTLGlCQUFpQixhQUFhO0FBQ3JDLGlCQUFXLE9BQU8sT0FBTyxLQUFLLFdBQVcsR0FBRztBQUMxQyxZQUFJLGtCQUFrQixTQUFTLElBQUksS0FBSyxFQUFFLFlBQVksQ0FBQyxFQUFHLFFBQU8sWUFBWSxHQUFHO0FBQUEsTUFDbEY7QUFDQSxhQUFPO0FBQUEsSUFDVDtBQWNBLGFBQVMsVUFBVSxRQUFRLE1BQU07QUFDL0IsYUFBTztBQUFBLFFBQ0w7QUFBQSxRQUNBLFNBQVM7QUFBQSxRQUNULGdCQUFnQixNQUFNLE9BQU8sU0FBUyx1QkFBdUIsSUFBSSxLQUFLLENBQUM7QUFBQSxRQUN2RSxnQkFBZ0IsQ0FBQyxnQkFBZ0I7QUFDL0IsaUJBQU8sU0FBUyx1QkFBdUIsSUFBSSxJQUFJO0FBQUEsUUFDakQ7QUFBQSxRQUNBLGFBQWEsTUFBTSxPQUFPLFNBQVMsaUJBQWlCLElBQUksS0FBSyxDQUFDO0FBQUEsUUFDOUQsYUFBYSxDQUFDLFNBQVM7QUFDckIsY0FBSSxLQUFLLFNBQVMsRUFBRyxRQUFPLFNBQVMsaUJBQWlCLElBQUksSUFBSTtBQUFBLGNBQ3pELFFBQU8sT0FBTyxTQUFTLGlCQUFpQixJQUFJO0FBQUEsUUFDbkQ7QUFBQSxRQUNBLGNBQWMsTUFBTSxPQUFPLFNBQVMsY0FBYyxJQUFJLEtBQUssQ0FBQztBQUFBLFFBQzVELGNBQWMsQ0FBQyxjQUFjO0FBQzNCLGNBQUksT0FBTyxLQUFLLFNBQVMsRUFBRSxTQUFTLEVBQUcsUUFBTyxTQUFTLGNBQWMsSUFBSSxJQUFJO0FBQUEsY0FDeEUsUUFBTyxPQUFPLFNBQVMsY0FBYyxJQUFJO0FBQUEsUUFDaEQ7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUVBLGFBQVMsYUFBYSxRQUFRLE1BQU0sU0FBUztBQUMzQyxhQUFPO0FBQUEsUUFDTDtBQUFBLFFBQ0E7QUFBQSxRQUNBLGdCQUFnQixNQUFNRixZQUFXLE9BQU8sVUFBVSxNQUFNLE9BQU8sR0FBRyxlQUFlLENBQUM7QUFBQSxRQUNsRixnQkFBZ0IsQ0FBQyxnQkFBZ0I7QUFDL0Isd0JBQWMsT0FBTyxVQUFVLE1BQU0sT0FBTyxFQUFFLGNBQWM7QUFBQSxRQUM5RDtBQUFBLFFBQ0EsYUFBYSxNQUFNQSxZQUFXLE9BQU8sVUFBVSxNQUFNLE9BQU8sR0FBRyxnQkFBZ0IsQ0FBQztBQUFBLFFBQ2hGLGFBQWEsQ0FBQyxTQUFTO0FBQ3JCLHdCQUFjLE9BQU8sVUFBVSxNQUFNLE9BQU8sRUFBRSxlQUFlO0FBQUEsUUFDL0Q7QUFBQSxRQUNBLGNBQWMsTUFBTUEsWUFBVyxPQUFPLFVBQVUsTUFBTSxPQUFPLEdBQUcsYUFBYSxDQUFDO0FBQUEsUUFDOUUsY0FBYyxDQUFDLGNBQWM7QUFDM0Isd0JBQWMsT0FBTyxVQUFVLE1BQU0sT0FBTyxFQUFFLFlBQVk7QUFBQSxRQUM1RDtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBV0EsUUFBSSxvQkFBb0I7QUFFeEIsYUFBUyx1QkFBdUIsS0FBSztBQUNuQyxVQUFJLGtCQUFtQixRQUFPO0FBRTlCLFlBQU0sU0FBUyxJQUFJLFVBQVUsb0JBQW9CLFlBQVk7QUFDN0QsVUFBSSxRQUFRLGdCQUFnQjtBQUMxQiw0QkFBb0IsT0FBTyxlQUFlO0FBQzFDLGVBQU87QUFBQSxNQUNUO0FBQ0EsaUJBQVcsUUFBUSxJQUFJLFVBQVUsZ0JBQWdCLFVBQVUsR0FBRztBQUM1RCxZQUFJLEtBQUssTUFBTSxnQkFBZ0I7QUFDN0IsOEJBQW9CLEtBQUssS0FBSyxlQUFlO0FBQzdDLGlCQUFPO0FBQUEsUUFDVDtBQUFBLE1BQ0Y7QUFDQSxhQUFPO0FBQUEsSUFDVDtBQVNBLFFBQUkseUJBQXlCO0FBRTdCLGFBQVMsb0JBQW9CLEtBQUssUUFBUTtBQUN4QyxVQUFJLHVCQUF3QixRQUFPO0FBQ25DLFVBQUksUUFBUSxXQUFXLENBQUMsR0FBRztBQUN6QixpQ0FBeUIsT0FBTyxTQUFTLENBQUMsRUFBRTtBQUM1QyxlQUFPO0FBQUEsTUFDVDtBQUNBLFlBQU0sU0FBUyxJQUFJLFVBQVUsb0JBQW9CLFlBQVk7QUFDN0QsVUFBSSxRQUFRLGdCQUFnQixXQUFXLENBQUMsR0FBRztBQUN6QyxpQ0FBeUIsT0FBTyxlQUFlLFNBQVMsQ0FBQyxFQUFFO0FBQzNELGVBQU87QUFBQSxNQUNUO0FBQ0EsaUJBQVcsUUFBUSxJQUFJLFVBQVUsZ0JBQWdCLFVBQVUsR0FBRztBQUM1RCxZQUFJLEtBQUssTUFBTSxnQkFBZ0IsV0FBVyxDQUFDLEdBQUc7QUFDNUMsbUNBQXlCLEtBQUssS0FBSyxlQUFlLFNBQVMsQ0FBQyxFQUFFO0FBQzlELGlCQUFPO0FBQUEsUUFDVDtBQUFBLE1BQ0Y7QUFDQSxhQUFPO0FBQUEsSUFDVDtBQXlCQSxhQUFTLHdCQUF3QixLQUFLLFFBQVE7QUFDNUMsWUFBTSxXQUFXLG9CQUFvQixLQUFLLE1BQU07QUFDaEQsVUFBSSxDQUFDLFlBQVksU0FBUyxpQkFBa0I7QUFDNUMsZUFBUyxtQkFBbUI7QUFFNUIsWUFBTSwyQkFBMkIsU0FBUyxVQUFVO0FBQ3BELGVBQVMsVUFBVSxtQkFBbUIsU0FBVSxPQUFPO0FBQ3JELGNBQU0sUUFBUSxLQUFLLGdCQUFnQjtBQUNuQyxZQUFJLENBQUMsT0FBTyxVQUFXLFFBQU8seUJBQXlCLEtBQUssTUFBTSxLQUFLO0FBRXZFLGNBQU0sTUFBTTtBQUNaLGNBQU0sMkJBQTJCLEtBQUssVUFBVTtBQUNoRCxhQUFLLFVBQVUsbUJBQW1CLFNBQVUsWUFBWTtBQUN0RCxlQUFLLFVBQVUsbUJBQW1CO0FBQ2xDLGdCQUFNLGFBQWEsTUFBTSxVQUFVLFlBQVksRUFBRSxTQUFTLElBQUksTUFBTSxHQUFHO0FBT3ZFLGVBQUs7QUFBQSxZQUFRLENBQUMsU0FDWixLQUNHLFNBQVMsVUFBVSxFQUNuQixRQUFRLFNBQVMsRUFDakIsV0FBVyxVQUFVLEVBQ3JCLFdBQVcsT0FBTyxFQUNsQixRQUFRLE1BQU0sdUJBQXVCLE1BQU0sVUFBVSxNQUFNLFdBQVcsSUFBSSxNQUFNLEdBQUcsQ0FBQztBQUFBLFVBQ3pGO0FBQ0EsaUJBQU8seUJBQXlCLEtBQUssTUFBTSxVQUFVO0FBQUEsUUFDdkQ7QUFFQSxlQUFPLHlCQUF5QixLQUFLLE1BQU0sS0FBSztBQUFBLE1BQ2xEO0FBQUEsSUFDRjtBQUVBLGFBQVMsdUJBQXVCLE1BQU0sT0FBTyxLQUFLO0FBQ2hELFlBQU0sV0FBVyxNQUFNLFlBQVk7QUFDbkMsWUFBTSxZQUFZLFNBQVMsU0FBUyxHQUFHLElBQUksU0FBUyxPQUFPLENBQUMsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLEdBQUcsVUFBVSxHQUFHLENBQUM7QUFDakcsV0FBSyxPQUFPLGFBQWE7QUFHekIsV0FBSyxPQUFPLG1CQUFtQjtBQUFBLElBQ2pDO0FBa0NBLGFBQVMsbUJBQW1CLFFBQVEsY0FBYztBQUNoRCxhQUFPLFlBQVk7QUFBQSxRQUNqQjtBQUFBLFFBQ0EsQ0FBQyxVQUFVO0FBQ1QsY0FBSSxNQUFNLGVBQWUsTUFBTSxpQkFBa0I7QUFHakQsY0FBSSxPQUFPLGVBQWUsT0FBTyxFQUFHO0FBQ3BDLGNBQUksTUFBTSxhQUFhLE1BQU0sUUFBUSxhQUFhLE1BQU0sUUFBUSxhQUFjO0FBRTlFLGdCQUFNLFFBQVEsT0FBTyxTQUFTLFVBQVUsQ0FBQyxRQUFRLElBQUksZ0JBQWdCLE1BQU0sTUFBTTtBQUNqRixjQUFJLFVBQVUsR0FBSTtBQUVsQixnQkFBTSxLQUFLLE1BQU0sUUFBUSxhQUFhLE1BQU0sUUFBUSxPQUFRLE1BQU0sUUFBUSxTQUFTLE1BQU07QUFDekYsZ0JBQU0sT0FBTyxNQUFNLFFBQVEsZUFBZSxNQUFNLFFBQVEsT0FBUSxNQUFNLFFBQVEsU0FBUyxDQUFDLE1BQU07QUFDOUYsY0FBSSxPQUFPO0FBQ1gsY0FBSSxNQUFNLFVBQVUsRUFBRyxRQUFPO0FBQUEsbUJBQ3JCLFFBQVEsVUFBVSxPQUFPLFNBQVMsU0FBUyxFQUFHLFFBQU87QUFDOUQsY0FBSSxTQUFTLEtBQUssQ0FBQyxhQUFhLElBQUksRUFBRztBQUV2QyxnQkFBTSxlQUFlO0FBQ3JCLGdCQUFNLGdCQUFnQjtBQUFBLFFBQ3hCO0FBQUEsUUFDQTtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBRUEsYUFBUyx1QkFBdUIsTUFBTSxhQUFhLE9BQU8sRUFBRSxhQUFhLElBQUksQ0FBQyxHQUFHO0FBQy9FLFlBQU0sTUFBTSxLQUFLO0FBQ2pCLFlBQU0sY0FBYyx1QkFBdUIsR0FBRztBQUM5QyxVQUFJLENBQUMsYUFBYTtBQUNoQixvQkFBWSxTQUFTLEtBQUs7QUFBQSxVQUN4QixLQUFLO0FBQUEsVUFDTCxNQUFNO0FBQUEsUUFDUixDQUFDO0FBQ0QsZUFBTztBQUFBLE1BQ1Q7QUFFQSxZQUFNLFFBQVE7QUFBQSxRQUNaO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLFFBTUEsV0FBVztBQUFBLFFBQ1gsVUFBVTtBQUFBLFFBQ1YsVUFBVTtBQUNSLGlCQUFPO0FBQUEsUUFDVDtBQUFBO0FBQUE7QUFBQSxRQUdBLGlCQUFpQjtBQUNmLGlCQUFPO0FBQUEsUUFDVDtBQUFBLFFBQ0EsbUJBQW1CO0FBQUEsUUFBQztBQUFBLFFBQ3BCLGtCQUFrQjtBQUFBLFFBQUM7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLFFBUW5CLGdCQUFnQixhQUFhO0FBSTNCLDJCQUFpQixXQUFXO0FBRTVCLGdCQUFNLFdBQVcsTUFBTSxlQUFlO0FBQ3RDLGdCQUFNLGVBQWUsT0FBTyxLQUFLLFFBQVEsRUFBRSxPQUFPLENBQUMsUUFBUSxRQUFRLEVBQUU7QUFDckUsZ0JBQU0sY0FBYyxPQUFPLEtBQUssV0FBVyxFQUFFLE9BQU8sQ0FBQyxRQUFRLFFBQVEsRUFBRTtBQUN2RSxnQkFBTSxjQUFjLGFBQWEsT0FBTyxDQUFDLFFBQVEsQ0FBQyxZQUFZLFNBQVMsR0FBRyxDQUFDO0FBQzNFLGdCQUFNLFlBQVksWUFBWSxPQUFPLENBQUMsUUFBUSxDQUFDLGFBQWEsU0FBUyxHQUFHLENBQUM7QUFFekUsY0FBSSxXQUFXLE1BQU0sWUFBWTtBQUNqQyxjQUFJLFlBQVksV0FBVyxLQUFLLFVBQVUsV0FBVyxHQUFHO0FBRXRELHVCQUFXLFNBQVMsSUFBSSxDQUFDLFFBQVMsUUFBUSxZQUFZLENBQUMsSUFBSSxVQUFVLENBQUMsSUFBSSxHQUFJO0FBQUEsVUFDaEYsT0FBTztBQUNMLGdCQUFJLFlBQVksU0FBUyxFQUFHLFlBQVcsU0FBUyxPQUFPLENBQUMsUUFBUSxDQUFDLFlBQVksU0FBUyxHQUFHLENBQUM7QUFDMUYsZ0JBQUksT0FBTywwQkFBMEIsVUFBVSxXQUFXLEdBQUc7QUFDM0QseUJBQVcsQ0FBQyxHQUFHLFVBQVUsVUFBVSxDQUFDLENBQUM7QUFDckMscUJBQU8seUJBQXlCO0FBQUEsWUFDbEM7QUFBQSxVQUNGO0FBSUEsZ0JBQU0sWUFBWSxFQUFFLEdBQUcsTUFBTSxhQUFhLEVBQUU7QUFDNUMsY0FBSSxZQUFZLFdBQVcsS0FBSyxVQUFVLFdBQVcsR0FBRztBQUN0RCxnQkFBSSxVQUFVLFlBQVksQ0FBQyxDQUFDLEdBQUc7QUFDN0Isd0JBQVUsVUFBVSxDQUFDLENBQUMsSUFBSSxVQUFVLFlBQVksQ0FBQyxDQUFDO0FBQ2xELHFCQUFPLFVBQVUsWUFBWSxDQUFDLENBQUM7QUFBQSxZQUNqQztBQUFBLFVBQ0YsT0FBTztBQUNMLHVCQUFXLE9BQU8sWUFBYSxRQUFPLFVBQVUsR0FBRztBQUFBLFVBQ3JEO0FBRUEsZ0JBQU0sZUFBZSxXQUFXO0FBQ2hDLGdCQUFNLFlBQVksUUFBUTtBQUMxQixnQkFBTSxhQUFhLFNBQVM7QUFDNUIsZUFBSyxPQUFPLGFBQWE7QUFHekIsaUNBQXVCLE1BQU0sUUFBUSxLQUFLO0FBRzFDLGVBQUssT0FBTyxtQkFBbUI7QUFBQSxRQUNqQztBQUFBLE1BQ0Y7QUFFQSxZQUFNLFNBQVMsSUFBSSxZQUFZLEtBQUssS0FBSztBQUN6QyxhQUFPLHlCQUF5QjtBQUNoQyxVQUFJLGFBQWMsb0JBQW1CLFFBQVEsWUFBWTtBQUV6RCxhQUFPLFlBQVksU0FBUyxZQUFZO0FBQ3hDLGtCQUFZLFlBQVksT0FBTyxXQUFXO0FBQzFDLFdBQUssU0FBUyxNQUFNO0FBRXBCLFlBQU0sV0FBVyxNQUFNLGVBQWU7QUFDdEMsWUFBTSxTQUFTLE9BQU8sS0FBSyxRQUFRLEVBQUUsS0FBSyxDQUFDLFFBQVEsa0JBQWtCLFNBQVMsSUFBSSxLQUFLLEVBQUUsWUFBWSxDQUFDLENBQUM7QUFDdkcsdUJBQWlCLFFBQVE7QUFHekIsVUFBSSxPQUFRLE1BQUssT0FBTyxhQUFhO0FBQ3JDLGFBQU8sWUFBWSxRQUFRO0FBQzNCLDZCQUF1QixNQUFNLFFBQVEsS0FBSztBQUsxQyw4QkFBd0IsS0FBSyxNQUFNO0FBQ25DLGFBQU87QUFBQSxJQUNUO0FBRUEsUUFBTSxhQUFhO0FBQ25CLFFBQU0sa0JBQWtCO0FBQ3hCLFFBQU0sZUFBZTtBQUNyQixRQUFNLFlBQVk7QUFDbEIsUUFBTSxnQkFBZ0I7QUFtQnRCLGFBQVMsdUJBQXVCLE1BQU0sUUFBUSxPQUFPO0FBQ25ELFlBQU0sWUFBWSxNQUFNLGFBQWE7QUFDckMsaUJBQVcsT0FBTyxPQUFPLFlBQVksQ0FBQyxHQUFHO0FBQ3ZDLGNBQU0sY0FBYyxJQUFJO0FBQ3hCLGNBQU0sTUFBTSxJQUFJLE9BQU8sT0FBTztBQUs5QixjQUFNLFNBQVMsUUFBUSxLQUFLLE9BQU8sVUFBVSxHQUFHLEtBQUs7QUFDckQsb0JBQVksWUFBWSxXQUFXLENBQUMsQ0FBQyxNQUFNO0FBVzNDLGNBQU0sV0FBVyxDQUFDLENBQUMsSUFBSSxZQUFZLElBQUksU0FBUyxhQUFhLElBQUksU0FBUztBQUMxRSxvQkFBWSxZQUFZLGVBQWUsWUFBWSxDQUFDLE1BQU07QUFFMUQsWUFBSSxXQUFXLFlBQVksY0FBYyxhQUFhLFlBQVksRUFBRTtBQUNwRSxZQUFJLFFBQVEsSUFBSTtBQUNkLG9CQUFVLE9BQU87QUFDakIsc0JBQVksY0FBYyxhQUFhLFVBQVUsRUFBRSxHQUFHLE9BQU87QUFDN0Q7QUFBQSxRQUNGO0FBQ0EsWUFBSSxDQUFDLFVBQVU7QUFDYixxQkFBVyxZQUFZLFVBQVUsRUFBRSxLQUFLLGtCQUFrQixZQUFZLEdBQUcsQ0FBQztBQUMxRSxrQkFBUSxVQUFVLGlCQUFpQjtBQUduQyxtQkFBUyxpQkFBaUIsU0FBUyxNQUFNO0FBQ3ZDLGdCQUFJLE1BQU0sYUFBYSxFQUFFLElBQUksT0FBTyxPQUFPLEVBQUUsRUFBRyxnQkFBZSxNQUFNLFFBQVEsT0FBTyxHQUFHO0FBQUEsZ0JBQ2xGLG9CQUFtQixNQUFNLFFBQVEsT0FBTyxHQUFHO0FBQUEsVUFDbEQsQ0FBQztBQUFBLFFBQ0g7QUFDQSxpQkFBUyxRQUFRLGNBQWMsU0FBUyx1QkFBdUIsaUJBQWlCO0FBRWhGLFlBQUksU0FBUyxZQUFZLGNBQWMsYUFBYSxVQUFVLEVBQUU7QUFDaEUsWUFBSSxDQUFDLFFBQVE7QUFDWCxrQkFBUSxPQUFPO0FBQ2Y7QUFBQSxRQUNGO0FBQ0EsWUFBSSxDQUFDLFFBQVE7QUFDWCxtQkFBUyxTQUFTLFFBQVEsRUFBRSxLQUFLLFdBQVcsQ0FBQztBQUs3QyxpQkFBTyxXQUFXLEVBQUUsS0FBSyxnQkFBZ0IsQ0FBQztBQUMxQyxpQkFBTyxRQUFRLGNBQWMsb0JBQWlCO0FBQzlDLGlCQUFPLGlCQUFpQixTQUFTLE1BQU0sbUJBQW1CLE1BQU0sUUFBUSxPQUFPLEdBQUcsQ0FBQztBQUduRixzQkFBWSxhQUFhLFFBQVEsUUFBUTtBQUFBLFFBQzNDO0FBQ0EsZUFBTyxrQkFBa0IsUUFBUSxjQUFjLE1BQU0sQ0FBQztBQUFBLE1BQ3hEO0FBQUEsSUFDRjtBQUVBLG1CQUFlLG1CQUFtQixNQUFNLFFBQVEsT0FBTyxLQUFLO0FBQzFELFlBQU0sTUFBTSxJQUFJLE9BQU8sT0FBTztBQUM5QixVQUFJLFFBQVEsR0FBSTtBQUloQixZQUFNLFNBQVMsTUFBTSxhQUFhLEtBQUssS0FBSyxLQUFLLEtBQUssT0FBTyxvQkFBb0IsTUFBTSxhQUFhLEVBQUUsR0FBRyxLQUFLLElBQUk7QUFDbEgsVUFBSSxDQUFDLE9BQVE7QUFPYixVQUFJLENBQUMsT0FBTyxPQUFPLE1BQU0sZUFBZSxHQUFHLEdBQUcsRUFBRztBQUNqRCxZQUFNLGFBQWEsRUFBRSxHQUFHLE1BQU0sYUFBYSxHQUFHLENBQUMsR0FBRyxHQUFHLE9BQU8sQ0FBQztBQUM3RCxvQkFBYyxNQUFNLFFBQVEsS0FBSztBQUFBLElBQ25DO0FBRUEsYUFBUyxlQUFlLE1BQU0sUUFBUSxPQUFPLEtBQUs7QUFDaEQsWUFBTSxNQUFNLElBQUksT0FBTyxPQUFPO0FBQzlCLFlBQU0sWUFBWSxFQUFFLEdBQUcsTUFBTSxhQUFhLEVBQUU7QUFDNUMsVUFBSSxFQUFFLE9BQU8sV0FBWTtBQUN6QixhQUFPLFVBQVUsR0FBRztBQUNwQixZQUFNLGFBQWEsU0FBUztBQUM1QixvQkFBYyxNQUFNLFFBQVEsS0FBSztBQUFBLElBQ25DO0FBRUEsYUFBUyxjQUFjLE1BQU0sUUFBUSxPQUFPO0FBQzFDLFdBQUssT0FBTyxhQUFhO0FBQ3pCLDZCQUF1QixNQUFNLFFBQVEsS0FBSztBQUFBLElBQzVDO0FBT0EsYUFBUyxpQkFBaUIsUUFBUTtBQUNoQyxVQUFJLENBQUMsT0FBUTtBQUNiLFlBQU0sVUFBVSxPQUFPLFVBQVU7QUFDakMsVUFBSSxDQUFDLFFBQVEsZUFBZSxFQUFFLEdBQUc7QUFDL0IsZ0JBQVEsRUFBRSxJQUFJO0FBQ2QsZUFBTyxZQUFZLE9BQU87QUFJMUIsK0JBQXVCLE9BQU8sTUFBTSxVQUFVLFFBQVEsT0FBTyxNQUFNLFNBQVM7QUFBQSxNQUM5RTtBQUNBLGFBQU8sU0FBUyxFQUFFO0FBS2xCLDhCQUF3QixPQUFPLE1BQU0sS0FBSyxNQUFNO0FBQUEsSUFDbEQ7QUFFQSxJQUFBRCxRQUFPLFVBQVUsRUFBRSx3QkFBd0Isa0JBQWtCLHlCQUF5QixXQUFXLGFBQWE7QUFBQTtBQUFBOzs7QUN2Z0I5RztBQUFBLDhCQUFBSSxVQUFBQyxTQUFBO0FBQUEsUUFBTSxFQUFFLHdCQUF3QixrQkFBa0IsV0FBVyxhQUFhLElBQUk7QUFDOUUsUUFBTSxFQUFFLGlCQUFpQixhQUFhLElBQUk7QUF5QjFDLGFBQVMsYUFBYSxRQUFRO0FBQzVCLFVBQUksT0FBTyxRQUFRLHlGQUF5RixFQUFHLFFBQU87QUFDdEgsYUFBTyxDQUFDLE9BQU8sUUFBUSxvQkFBb0I7QUFBQSxJQUM3QztBQU9BLGFBQVMsdUJBQXVCLE1BQU0sYUFBYSxNQUFNLEVBQUUsY0FBYyxjQUFjLGVBQWUscUJBQXFCLEdBQUc7QUFDNUgsWUFBTSxVQUFVLFlBQVksVUFBVSxFQUFFLEtBQUssa0JBQWtCLENBQUM7QUFDaEUsWUFBTSxXQUFXLGdCQUFnQixLQUFLLE9BQU8sVUFBVSxJQUFJO0FBQzNELFlBQU0sVUFBVSxvQkFBSSxJQUFJO0FBQ3hCLFlBQU0sV0FBVyxvQkFBSSxJQUFJO0FBQ3pCLFlBQU0sU0FBUyxvQkFBSSxJQUFJO0FBRXZCLFlBQU0sTUFBTTtBQUFBO0FBQUE7QUFBQSxRQUdWLFNBQVMsQ0FBQztBQUFBO0FBQUE7QUFBQTtBQUFBLFFBSVYsU0FBUyxTQUFTLFdBQVcsT0FBTztBQUNsQyxnQkFBTSxTQUFTLFFBQVEsSUFBSSxPQUFPO0FBQ2xDLGNBQUksQ0FBQyxPQUFRO0FBQ2IsaUJBQU8seUJBQXlCO0FBQ2hDLDJCQUFpQixNQUFNO0FBQUEsUUFDekI7QUFBQSxNQUNGO0FBSUEsWUFBTSxnQkFBZ0IsQ0FBQyxTQUFTLFNBQVM7QUFDdkMsaUJBQVMsSUFBSSxTQUFTLFFBQVEsT0FBTyxJQUFJLE1BQU0sS0FBSyxLQUFLLElBQUksU0FBUyxRQUFRLEtBQUssTUFBTTtBQUN2RixnQkFBTSxTQUFTLFFBQVEsSUFBSSxTQUFTLENBQUMsQ0FBQztBQUN0QyxjQUFJLENBQUMsVUFBVSxPQUFPLFNBQVMsV0FBVyxFQUFHO0FBQzdDLGlCQUFPLHFCQUFxQixPQUFPLElBQUksSUFBSSxFQUFFO0FBQzdDLGlCQUFPO0FBQUEsUUFDVDtBQUNBLGVBQU87QUFBQSxNQUNUO0FBRUEsaUJBQVcsV0FBVyxVQUFVO0FBQzlCLGNBQU0sUUFBUSxZQUFZO0FBQzFCLGNBQU0sVUFBVSxRQUFRLFVBQVU7QUFBQSxVQUNoQyxLQUFLLG9CQUFvQixRQUFRLHVEQUF1RDtBQUFBLFFBQzFGLENBQUM7QUFDRCxpQkFBUyxJQUFJLFNBQVMsT0FBTztBQUM3QixnQkFBUSxjQUFjO0FBRXRCLGNBQU0sU0FBUyxRQUFRLFVBQVUsRUFBRSxLQUFLLHNEQUFzRCxDQUFDO0FBQy9GLGVBQU8sWUFBWSx3QkFBd0IsS0FBSztBQUVoRCxjQUFNLFFBQVEsWUFBWSxPQUFPLFVBQVUsS0FBSyxRQUFRLElBQUksSUFBSSxhQUFhLEtBQUssUUFBUSxNQUFNLE9BQU87QUFDdkcsZUFBTyxJQUFJLFNBQVMsS0FBSztBQUN6QixjQUFNLFNBQVMsdUJBQXVCLE1BQU0sU0FBUyxPQUFPO0FBQUEsVUFDMUQsY0FBYyxDQUFDLFNBQVMsY0FBYyxTQUFTLElBQUk7QUFBQSxRQUNyRCxDQUFDO0FBQ0QsWUFBSSxRQUFRO0FBQ1Ysa0JBQVEsSUFBSSxTQUFTLE1BQU07QUFDM0IsY0FBSSxRQUFRLEtBQUssTUFBTTtBQUFBLFFBQ3pCO0FBRUEsY0FBTSxTQUFTLFFBQVEsVUFBVSxFQUFFLEtBQUssMEJBQTBCLENBQUM7QUFDbkUsZUFBTyxZQUFZLHdCQUF3QixLQUFLO0FBQ2hELHFCQUFhLFNBQVMsUUFBUSxHQUFHO0FBQ2pDLHVCQUFlLFNBQVMsUUFBUSxHQUFHO0FBRW5DLFlBQUksQ0FBQyxNQUFPO0FBSVosZ0JBQVEsaUJBQWlCLGVBQWUsQ0FBQyxVQUFVO0FBQ2pELGNBQUksTUFBTSxvQkFBb0IsTUFBTSxPQUFPLFFBQVEsMkNBQTJDLEVBQUc7QUFDakcsZ0JBQU0sZUFBZTtBQUNyQixpQ0FBdUIsU0FBUyxLQUFLO0FBQUEsUUFDdkMsQ0FBQztBQUNELGdCQUFRLGlCQUFpQixhQUFhLENBQUMsVUFBVSxlQUFlLE9BQU8sT0FBTyxDQUFDO0FBQUEsTUFDakY7QUFRQSxlQUFTLGVBQWUsT0FBTyxTQUFTO0FBQ3RDLFlBQUksTUFBTSxXQUFXLEtBQUssQ0FBQyxhQUFhLE1BQU0sTUFBTSxFQUFHO0FBQ3ZELGNBQU0sTUFBTSxRQUFRO0FBQ3BCLGNBQU0sU0FBUyxNQUFNO0FBQ3JCLFlBQUksV0FBVztBQUNmLFlBQUksWUFBWTtBQUNoQixZQUFJLFFBQVEsQ0FBQztBQUNiLFlBQUksY0FBYztBQUVsQixjQUFNLFVBQVUsTUFBTTtBQUNwQixnQkFBTSxPQUFPLFFBQVEsc0JBQXNCO0FBQzNDLGtCQUFRLFNBQVMsSUFBSSxDQUFDLFNBQVM7QUFDN0Isa0JBQU0sT0FBTyxTQUFTLElBQUksSUFBSSxFQUFFLHNCQUFzQjtBQUN0RCxtQkFBTyxFQUFFLFNBQVMsTUFBTSxLQUFLLEtBQUssTUFBTSxLQUFLLEtBQUssUUFBUSxLQUFLLFNBQVMsS0FBSyxJQUFJO0FBQUEsVUFDbkYsQ0FBQztBQUFBLFFBQ0g7QUFFQSxjQUFNLFNBQVMsQ0FBQyxjQUFjO0FBQzVCLGNBQUksQ0FBQyxVQUFVO0FBQ2IsZ0JBQUksS0FBSyxJQUFJLFVBQVUsVUFBVSxNQUFNLElBQUksRUFBRztBQUM5Qyx1QkFBVztBQUNYLG9CQUFRLElBQUksS0FBSyxTQUFTLHlCQUF5QjtBQUNuRCxnQkFBSSxhQUFhLEdBQUcsZ0JBQWdCO0FBQ3BDLHFCQUFTLElBQUksT0FBTyxFQUFFLFNBQVMsYUFBYTtBQUM1QyxvQkFBUTtBQUNSLHdCQUFZLFFBQVEsVUFBVSxFQUFFLEtBQUssZ0NBQWdDLENBQUM7QUFBQSxVQUN4RTtBQUNBLG9CQUFVLGVBQWU7QUFDekIsZ0JBQU0sSUFBSSxVQUFVLFVBQVUsUUFBUSxzQkFBc0IsRUFBRTtBQUM5RCx3QkFBYyxLQUFLLElBQUksR0FBRyxNQUFNLE9BQU8sQ0FBQyxTQUFTLElBQUksTUFBTSxJQUFJLFVBQVUsSUFBSSxDQUFDLEVBQUUsTUFBTTtBQUN0RixnQkFBTSxPQUFPLE1BQU0sVUFBVSxDQUFDLFFBQVEsSUFBSSxZQUFZLE9BQU87QUFDN0Qsb0JBQVUsT0FBTyxnQkFBZ0IsUUFBUSxnQkFBZ0IsT0FBTyxDQUFDO0FBR2pFLGdCQUFNLFVBQVU7QUFDaEIsZ0JBQU0sT0FDSixnQkFBZ0IsTUFBTSxTQUNsQixNQUFNLE1BQU0sU0FBUyxDQUFDLEVBQUUsU0FBUyxXQUNoQyxNQUFNLGNBQWMsQ0FBQyxFQUFFLFNBQVMsTUFBTSxXQUFXLEVBQUUsT0FBTztBQUNqRSxvQkFBVSxNQUFNLE1BQU0sR0FBRyxPQUFPLENBQUM7QUFBQSxRQUNuQztBQUVBLGNBQU0sTUFBTSxDQUFDLFdBQVc7QUFDdEIsY0FBSSxvQkFBb0IsYUFBYSxNQUFNO0FBQzNDLGNBQUksb0JBQW9CLFdBQVcsSUFBSTtBQUN2QyxjQUFJLG9CQUFvQixXQUFXLE9BQU8sSUFBSTtBQUM5QyxjQUFJLENBQUMsU0FBVTtBQUNmLGtCQUFRLElBQUksS0FBSyxZQUFZLHlCQUF5QjtBQUN0RCxtQkFBUyxJQUFJLE9BQU8sRUFBRSxZQUFZLGFBQWE7QUFDL0MscUJBQVcsT0FBTztBQUVsQixnQkFBTSxRQUFRLE1BQU0sSUFBSSxDQUFDLFFBQVEsSUFBSSxPQUFPO0FBQzVDLGdCQUFNLE9BQU8sTUFBTSxRQUFRLE9BQU87QUFDbEMsY0FBSSxDQUFDLFVBQVUsZ0JBQWdCLFFBQVEsZ0JBQWdCLFFBQVEsZ0JBQWdCLE9BQU8sRUFBRztBQUN6RixnQkFBTSxPQUFPLE1BQU0sQ0FBQztBQUNwQixnQkFBTSxPQUFPLE9BQU8sY0FBYyxjQUFjLElBQUksYUFBYSxHQUFHLE9BQU87QUFDM0UsMEJBQWdCLEtBQUs7QUFBQSxRQUN2QjtBQUNBLGNBQU0sT0FBTyxNQUFNLElBQUksSUFBSTtBQUMzQixjQUFNLFFBQVEsQ0FBQyxhQUFhO0FBQzFCLGNBQUksU0FBUyxRQUFRLFNBQVU7QUFDL0IsbUJBQVMsZUFBZTtBQUN4QixtQkFBUyxnQkFBZ0I7QUFDekIsY0FBSSxLQUFLO0FBQUEsUUFDWDtBQUNBLFlBQUksaUJBQWlCLGFBQWEsTUFBTTtBQUN4QyxZQUFJLGlCQUFpQixXQUFXLElBQUk7QUFDcEMsWUFBSSxpQkFBaUIsV0FBVyxPQUFPLElBQUk7QUFBQSxNQUM3QztBQUVBLDJCQUFxQjtBQUNyQixhQUFPO0FBdUJQLGVBQVMsdUJBQXVCO0FBRzlCLGNBQU0sU0FBUyxJQUFJLFFBQVEsQ0FBQztBQUM1QixZQUFJLENBQUMsVUFBVSxTQUFTLFNBQVMsRUFBRztBQUlwQyxZQUFJLE9BQU87QUFDWCxZQUFJLE9BQU87QUFFWCxjQUFNLFlBQVksQ0FBQyxZQUNqQixTQUFTLEtBQUssQ0FBQyxZQUFZO0FBQ3pCLGdCQUFNLE9BQU8sU0FBUyxJQUFJLE9BQU8sRUFBRSxzQkFBc0I7QUFDekQsaUJBQU8sV0FBVyxLQUFLLE9BQU8sV0FBVyxLQUFLO0FBQUEsUUFDaEQsQ0FBQztBQUVILGNBQU0sbUJBQW1CLE1BQU07QUFDN0IsZUFBSyxhQUFhLE9BQU87QUFDekIsZUFBSyxjQUFjO0FBQ25CLGVBQUssTUFBTSxNQUFNLGVBQWUsU0FBUztBQUN6QyxlQUFLLFNBQVM7QUFBQSxRQUNoQjtBQUVBLGdCQUFRO0FBQUEsVUFDTjtBQUFBLFVBQ0EsQ0FBQyxVQUFVO0FBQ1QsZ0JBQUksTUFBTSxXQUFXLEVBQUc7QUFDeEIsa0JBQU0sUUFBUSxNQUFNLE9BQU8sUUFBUSx5QkFBeUIsR0FBRyxRQUFRLG9CQUFvQjtBQUMzRixrQkFBTSxVQUFVLE9BQU8sUUFBUSxpQkFBaUIsR0FBRztBQUNuRCxrQkFBTSxTQUFTLFlBQVksU0FBWSxPQUFPLFFBQVEsSUFBSSxPQUFPO0FBQ2pFLGtCQUFNLE1BQU0sUUFBUSxTQUFTLEtBQUssQ0FBQyxRQUFRLElBQUksZ0JBQWdCLEtBQUssR0FBRyxNQUFNO0FBRzdFLGdCQUFJLENBQUMsSUFBSztBQUNWLG1CQUFPO0FBQUEsY0FDTDtBQUFBLGNBQ0E7QUFBQSxjQUNBO0FBQUE7QUFBQTtBQUFBLGNBR0EsUUFBUSxNQUFNO0FBQUEsY0FDZCxRQUFRLE9BQU8sZUFBZSxVQUFVLEVBQUUsS0FBSyx1QkFBdUIsQ0FBQztBQUFBLGNBQ3ZFLGFBQWE7QUFBQSxjQUNiLFFBQVE7QUFBQSxZQUNWO0FBQ0EsbUJBQU87QUFBQSxVQUNUO0FBQUEsVUFDQTtBQUFBLFFBQ0Y7QUFNQSxjQUFNLFlBQVksQ0FBQyxVQUFVO0FBQzNCLGNBQUksQ0FBQyxLQUFNO0FBQ1gsZ0JBQU0sU0FBUyxVQUFVLE1BQU0sT0FBTztBQUN0QyxjQUFJLFdBQVcsVUFBYSxXQUFXLEtBQUssU0FBUztBQUNuRCxnQkFBSSxLQUFLLFlBQWEsa0JBQWlCO0FBQ3ZDO0FBQUEsVUFDRjtBQUVBLGdCQUFNLE9BQU8sUUFBUSxJQUFJLE1BQU0sRUFBRTtBQUNqQyxjQUFJLENBQUMsS0FBSyxhQUFhO0FBQ3JCLGlCQUFLLE1BQU0sTUFBTSxVQUFVO0FBQzNCLGlCQUFLLGNBQWMsVUFBVSxFQUFFLEtBQUssZ0VBQWdFLENBQUM7QUFDckcsaUJBQUssWUFBWSxNQUFNLFNBQVMsR0FBRyxLQUFLLE1BQU07QUFBQSxVQUNoRDtBQUdBLGdCQUFNLE9BQU8sQ0FBQyxHQUFHLEtBQUssUUFBUSxFQUFFLE9BQU8sQ0FBQyxPQUFPLE9BQU8sS0FBSyxlQUFlLE9BQU8sS0FBSyxNQUFNO0FBQzVGLGdCQUFNLFNBQVMsS0FBSyxLQUFLLENBQUMsT0FBTztBQUMvQixrQkFBTSxPQUFPLEdBQUcsc0JBQXNCO0FBQ3RDLG1CQUFPLE1BQU0sVUFBVSxLQUFLLE1BQU0sS0FBSyxTQUFTO0FBQUEsVUFDbEQsQ0FBQztBQUNELGVBQUssU0FBUyxFQUFFLFNBQVMsUUFBUSxPQUFPLFNBQVMsS0FBSyxRQUFRLE1BQU0sSUFBSSxLQUFLLE9BQU87QUFDcEYsZUFBSyxhQUFhLEtBQUssYUFBYSxVQUFVLElBQUk7QUFBQSxRQUNwRDtBQUVBLGNBQU0sVUFBVSxNQUFNO0FBQ3BCLGNBQUksQ0FBQyxLQUFNO0FBQ1gsZ0JBQU0sRUFBRSxRQUFRLGFBQWEsT0FBTyxPQUFPLElBQUk7QUFDL0MsaUJBQU87QUFDUCxpQkFBTztBQUNQLHVCQUFhLE9BQU87QUFDcEIsZ0JBQU0sTUFBTSxlQUFlLFNBQVM7QUFJcEMsa0JBQVEsSUFBSSxXQUFXLE1BQU0sT0FBTyxPQUFPLEdBQUcsQ0FBQztBQUFBLFFBQ2pEO0FBRUEsZ0JBQVEsSUFBSSxpQkFBaUIsYUFBYSxXQUFXLElBQUk7QUFDekQsZ0JBQVEsSUFBSSxpQkFBaUIsV0FBVyxTQUFTLElBQUk7QUFDckQsZUFBTyxTQUFTLE1BQU07QUFDcEIsa0JBQVEsSUFBSSxvQkFBb0IsYUFBYSxXQUFXLElBQUk7QUFDNUQsa0JBQVEsSUFBSSxvQkFBb0IsV0FBVyxTQUFTLElBQUk7QUFBQSxRQUMxRCxDQUFDO0FBRUQsbUJBQVcsQ0FBQyxTQUFTLE1BQU0sS0FBSyxTQUFTO0FBQ3ZDLGdCQUFNLHFCQUFxQixPQUFPO0FBQ2xDLGlCQUFPLGFBQWEsU0FBVSxPQUFPLE9BQU87QUFDMUMsa0JBQU0sU0FBUztBQUNmLG1CQUFPO0FBQ1AsZ0JBQUksQ0FBQyxPQUFRLFFBQU8sbUJBQW1CLEtBQUssTUFBTSxPQUFPLEtBQUs7QUFDOUQseUJBQWEsU0FBUyxPQUFPLFNBQVMsTUFBTSxLQUFLLE9BQU8sS0FBSztBQUFBLFVBQy9EO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFRQSxxQkFBZSxhQUFhLE1BQU0sSUFBSSxLQUFLLE9BQU87QUFDaEQsY0FBTSxTQUFTLE9BQU8sSUFBSSxJQUFJO0FBQzlCLGNBQU0sU0FBUyxPQUFPLElBQUksRUFBRTtBQUM1QixZQUFJLENBQUMsVUFBVSxDQUFDLFVBQVUsU0FBUyxHQUFJO0FBRXZDLGNBQU0sb0JBQW9CLEVBQUUsR0FBRyxPQUFPLGVBQWUsRUFBRTtBQUN2RCxjQUFNLFFBQVEsa0JBQWtCLEdBQUc7QUFDbkMsY0FBTSxjQUFjLE9BQU8sWUFBWSxFQUFFLFNBQVMsR0FBRztBQUdyRCxjQUFNLGtCQUFrQixFQUFFLEdBQUcsT0FBTyxhQUFhLEVBQUU7QUFDbkQsY0FBTSxXQUFXLGdCQUFnQixHQUFHLEtBQUs7QUFDekMsZUFBTyxnQkFBZ0IsR0FBRztBQUMxQixlQUFPLGtCQUFrQixHQUFHO0FBQzVCLGVBQU8sZUFBZSxpQkFBaUI7QUFDdkMsZUFBTyxZQUFZLE9BQU8sWUFBWSxFQUFFLE9BQU8sQ0FBQyxNQUFNLE1BQU0sR0FBRyxDQUFDO0FBQ2hFLGVBQU8sYUFBYSxlQUFlO0FBRW5DLGNBQU0sb0JBQW9CLE9BQU8sZUFBZTtBQUNoRCxjQUFNLFdBQVcsT0FBTyxLQUFLLGlCQUFpQixFQUFFLEtBQUssQ0FBQyxNQUFNLEVBQUUsWUFBWSxNQUFNLElBQUksWUFBWSxDQUFDO0FBQ2pHLFlBQUksYUFBYSxRQUFXO0FBQzFCLGNBQUksYUFBYSxrQkFBa0IsUUFBUSxDQUFDLEVBQUcsUUFBTyxlQUFlLEVBQUUsR0FBRyxtQkFBbUIsQ0FBQyxRQUFRLEdBQUcsTUFBTSxDQUFDO0FBQUEsUUFDbEgsT0FBTztBQUNMLGdCQUFNLE9BQU8sT0FBTyxLQUFLLGlCQUFpQjtBQUMxQyxnQkFBTSxLQUFLLEtBQUssSUFBSSxHQUFHLEtBQUssSUFBSSxPQUFPLEtBQUssTUFBTSxDQUFDO0FBQ25ELGdCQUFNLE9BQU8sQ0FBQztBQUNkLHFCQUFXLEtBQUssS0FBSyxNQUFNLEdBQUcsRUFBRSxFQUFHLE1BQUssQ0FBQyxJQUFJLGtCQUFrQixDQUFDO0FBQ2hFLGVBQUssR0FBRyxJQUFJO0FBQ1oscUJBQVcsS0FBSyxLQUFLLE1BQU0sRUFBRSxFQUFHLE1BQUssQ0FBQyxJQUFJLGtCQUFrQixDQUFDO0FBQzdELGlCQUFPLGVBQWUsSUFBSTtBQUMxQixjQUFJLFlBQWEsUUFBTyxZQUFZLENBQUMsR0FBRyxPQUFPLFlBQVksR0FBRyxHQUFHLENBQUM7QUFDbEUsY0FBSSxTQUFVLFFBQU8sYUFBYSxFQUFFLEdBQUcsT0FBTyxhQUFhLEdBQUcsQ0FBQyxHQUFHLEdBQUcsU0FBUyxDQUFDO0FBQUEsUUFDakY7QUFFQSxjQUFNLEtBQUssT0FBTyxhQUFhO0FBRy9CLGFBQUssT0FBTyxtQkFBbUI7QUFBQSxNQUNqQztBQUFBLElBQ0Y7QUFFQSxJQUFBQSxRQUFPLFVBQVUsRUFBRSx1QkFBdUI7QUFBQTtBQUFBOzs7QUM5VzFDO0FBQUEsc0JBQUFDLFVBQUFDLFNBQUE7QUFPQSxhQUFTLGtCQUFrQixLQUFLO0FBQzlCLGFBQU8sSUFBSSxLQUFLLEVBQUUsWUFBWTtBQUFBLElBQ2hDO0FBUUEsYUFBUyxTQUFTLEtBQUs7QUFDckIsWUFBTSxRQUFRLHFCQUFxQixLQUFLLE9BQU8sRUFBRTtBQUNqRCxVQUFJLENBQUMsTUFBTyxRQUFPO0FBQ25CLFlBQU0sTUFBTSxTQUFTLE1BQU0sQ0FBQyxHQUFHLEVBQUU7QUFDakMsWUFBTSxLQUFNLE9BQU8sS0FBTSxPQUFPO0FBQ2hDLFlBQU0sS0FBTSxPQUFPLElBQUssT0FBTztBQUMvQixZQUFNLEtBQUssTUFBTSxPQUFPO0FBQ3hCLFlBQU0sTUFBTSxLQUFLLElBQUksR0FBRyxHQUFHLENBQUM7QUFDNUIsWUFBTSxNQUFNLEtBQUssSUFBSSxHQUFHLEdBQUcsQ0FBQztBQUM1QixZQUFNLFFBQVEsTUFBTTtBQUNwQixVQUFJLFVBQVUsRUFBRyxRQUFPO0FBRXhCLFVBQUk7QUFDSixVQUFJLFFBQVEsRUFBRyxRQUFRLElBQUksS0FBSyxRQUFTO0FBQUEsZUFDaEMsUUFBUSxFQUFHLFFBQU8sSUFBSSxLQUFLLFFBQVE7QUFBQSxVQUN2QyxRQUFPLElBQUksS0FBSyxRQUFRO0FBQzdCLGFBQU87QUFDUCxhQUFPLE1BQU0sSUFBSSxNQUFNLE1BQU07QUFBQSxJQUMvQjtBQUtBLGFBQVMsYUFBYSxNQUFNLEdBQUcsR0FBRyxRQUFRLFlBQVk7QUFDcEQsWUFBTSxDQUFDLEtBQUssR0FBRyxJQUFJLEtBQUssTUFBTSxHQUFHO0FBQ2pDLFVBQUk7QUFDSixVQUFJLFFBQVEsU0FBUztBQUNuQixlQUFPLE9BQU8sSUFBSSxDQUFDLEtBQUssTUFBTSxPQUFPLElBQUksQ0FBQyxLQUFLO0FBQy9DLFlBQUksUUFBUSxPQUFRLE9BQU0sQ0FBQztBQUFBLE1BQzdCLFdBQVcsUUFBUSxTQUFTO0FBQzFCLGNBQU0sT0FBTyxTQUFTLFdBQVcsQ0FBQyxLQUFLLElBQUk7QUFDM0MsY0FBTSxPQUFPLFNBQVMsV0FBVyxDQUFDLEtBQUssSUFBSTtBQUczQyxZQUFJLFNBQVMsUUFBUSxTQUFTLEtBQU0sT0FBTTtBQUFBLGlCQUNqQyxTQUFTLEtBQU0sT0FBTTtBQUFBLGlCQUNyQixTQUFTLEtBQU0sT0FBTTtBQUFBLGFBQ3pCO0FBQ0gsZ0JBQU0sT0FBTztBQUNiLGNBQUksUUFBUSxPQUFRLE9BQU0sQ0FBQztBQUFBLFFBQzdCO0FBQUEsTUFDRixPQUFPO0FBQ0wsY0FBTSxFQUFFLGNBQWMsQ0FBQztBQUN2QixZQUFJLFFBQVEsT0FBUSxPQUFNLENBQUM7QUFBQSxNQUM3QjtBQUNBLGFBQU8sT0FBTyxFQUFFLGNBQWMsQ0FBQztBQUFBLElBQ2pDO0FBVUEsYUFBU0MsaUJBQWdCLE9BQU8sTUFBTSxRQUFRLFlBQVk7QUFDeEQsVUFBSSxTQUFTLFNBQVUsUUFBTyxDQUFDLEdBQUcsS0FBSztBQUN2QyxhQUFPLENBQUMsR0FBRyxLQUFLLEVBQUUsS0FBSyxDQUFDLEdBQUcsTUFBTSxhQUFhLE1BQU0sR0FBRyxHQUFHLFFBQVEsVUFBVSxDQUFDO0FBQUEsSUFDL0U7QUFFQSxJQUFBRCxRQUFPLFVBQVUsRUFBRSxtQkFBbUIsVUFBVSxjQUFjLGlCQUFBQyxpQkFBZ0I7QUFBQTtBQUFBOzs7QUM5RTlFO0FBQUEsb0JBQUFDLFVBQUFDLFNBQUE7QUFBQSxRQUFNLEVBQUUsVUFBVSxNQUFNLE9BQU8sUUFBUSxTQUFTLFNBQVMsSUFBSSxRQUFRLFVBQVU7QUFDL0UsUUFBTSxFQUFFLHVCQUF1QixJQUFJO0FBQ25DLFFBQU07QUFBQSxNQUNKO0FBQUEsTUFDQSxpQkFBQUM7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQSxZQUFBQztBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsSUFDRixJQUFJO0FBQ0osUUFBTSxFQUFFLG1CQUFtQixjQUFjLGlCQUFBQyxpQkFBZ0IsSUFBSTtBQUM3RCxRQUFNLEVBQUUsV0FBVyxlQUFlLHNCQUFBQyx1QkFBc0IsY0FBQUMsZUFBYyxpQkFBQUMsaUJBQWdCLElBQUk7QUFDMUYsUUFBTTtBQUFBLE1BQ0o7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxJQUNGLElBQUk7QUFFSixRQUFNLGdCQUFnQjtBQUN0QixRQUFNQyxzQkFBcUI7QUFDM0IsUUFBTSxvQkFBb0I7QUFlMUIsUUFBTSxrQkFBa0I7QUFBQSxNQUN0QixFQUFFLE1BQU0sWUFBWSxPQUFPLFlBQVksTUFBTSxZQUFZO0FBQUEsTUFDekQsRUFBRSxNQUFNLGVBQWUsT0FBTyxnQkFBZ0IsTUFBTSxvQkFBb0I7QUFBQSxNQUN4RSxFQUFFLE1BQU0sUUFBUSxPQUFPLFVBQVUsTUFBTSxRQUFRO0FBQUEsSUFDakQ7QUFFQSxRQUFNLGVBQWU7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQU9uQixFQUFFLE1BQU0sVUFBVSxPQUFPLHdCQUF3QjtBQUFBLE1BQ2pELEVBQUUsTUFBTSxjQUFjLE9BQU8sNkJBQTBCO0FBQUEsTUFDdkQsRUFBRSxNQUFNLGFBQWEsT0FBTyw4QkFBMkI7QUFBQSxNQUN2RCxFQUFFLE1BQU0sWUFBWSxPQUFPLGlCQUFpQjtBQUFBLE1BQzVDLEVBQUUsTUFBTSxhQUFhLE9BQU8saUJBQWlCO0FBQUEsTUFDN0MsRUFBRSxNQUFNLGFBQWEsT0FBTyw2QkFBd0I7QUFBQSxNQUNwRCxFQUFFLE1BQU0sY0FBYyxPQUFPLDZCQUF3QjtBQUFBLElBQ3ZEO0FBU0EsbUJBQWUsa0JBQWtCLFFBQVEsUUFBUSxVQUFVO0FBQ3pELFVBQUksVUFBVTtBQUNkLGlCQUFXLFFBQVEsT0FBTyxTQUFTLGNBQWMsTUFBTSxHQUFHO0FBQ3hELFlBQUksVUFBVTtBQUNkLGNBQU0sT0FBTyxJQUFJLFlBQVksbUJBQW1CLE1BQU0sQ0FBQyxnQkFBZ0I7QUFDckUsY0FBSSxVQUFVLGNBQWMsYUFBYUYsYUFBWSxDQUFDLE1BQU0sT0FBUTtBQUNwRSxVQUFBRCxzQkFBcUIsYUFBYUMsZUFBYyxRQUFRO0FBQ3hELG9CQUFVO0FBQUEsUUFDWixDQUFDO0FBQ0QsWUFBSSxRQUFTO0FBQUEsTUFDZjtBQUNBLGFBQU87QUFBQSxJQUNUO0FBUUEsYUFBUyxpQkFBaUIsS0FBSyxZQUFZLG1CQUFtQjtBQUM1RCxVQUFJLE1BQU0sUUFBUSxHQUFHLEdBQUc7QUFDdEIsZUFBTyxJQUNKLElBQUksQ0FBQyxNQUFNLFVBQVUsT0FBTyxLQUFLLEVBQUUsQ0FBQyxDQUFDLEVBQ3JDLE9BQU8sT0FBTyxFQUNkLEtBQUssSUFBSTtBQUFBLE1BQ2Q7QUFDQSxhQUFPLFVBQVUsT0FBTyxHQUFHLENBQUM7QUFBQSxJQUM5QjtBQUtBLGFBQVMsZUFBZSxTQUFTO0FBQy9CLGFBQU8sWUFBWSxRQUFRLEtBQUssSUFBSSxJQUFJLE9BQU8sTUFBTTtBQUFBLElBQ3ZEO0FBVUEsYUFBUyxlQUFlLFVBQVUsUUFBUSxNQUFNLE9BQU87QUFDckQsVUFBSSxPQUFPLFNBQVMsV0FBVyxTQUFTO0FBQ3RDLGNBQU0sU0FBUyxTQUFTLFdBQVcsRUFBRSxLQUFLLHdCQUF3QixNQUFNLEtBQUssQ0FBQztBQUM5RSxZQUFJLE1BQU8sUUFBTyxNQUFNLFFBQVE7QUFBQSxNQUNsQyxPQUFPO0FBQ0wsc0JBQWMsU0FBUyxXQUFXLEVBQUUsS0FBSyxzQkFBc0IsQ0FBQyxHQUFHLFNBQVMsb0JBQW9CLENBQUMsS0FBSztBQUN0RyxpQkFBUyxXQUFXLEVBQUUsS0FBSyx3QkFBd0IsTUFBTSxLQUFLLENBQUM7QUFBQSxNQUNqRTtBQUFBLElBQ0Y7QUFFQSxRQUFNLHlCQUFOLGNBQXFDLE1BQU07QUFBQSxNQUN6QyxZQUFZLFFBQVEsTUFBTSxXQUFXO0FBQ25DLGNBQU0sT0FBTyxHQUFHO0FBQ2hCLGFBQUssU0FBUztBQUNkLGFBQUssT0FBTztBQUNaLGFBQUssWUFBWTtBQUFBLE1BQ25CO0FBQUEsTUFFQSxTQUFTO0FBQ1AsY0FBTSxFQUFFLFVBQVUsSUFBSTtBQUN0QixhQUFLLFFBQVEsU0FBUywyQkFBMkI7QUFDakQsY0FBTSxJQUFJLFVBQVUsU0FBUyxHQUFHO0FBQ2hDLFVBQUUsV0FBVyxNQUFNO0FBQ25CLHVCQUFlLEdBQUcsS0FBSyxRQUFRLEtBQUssTUFBTSxLQUFLLE9BQU8sU0FBUyxXQUFXLEtBQUssSUFBSSxLQUFLLElBQUk7QUFDNUYsVUFBRSxXQUFXLHVCQUFvQjtBQUVqQyxjQUFNLFlBQVksVUFBVSxVQUFVLEVBQUUsS0FBSyx5QkFBeUIsQ0FBQztBQUN2RSxrQkFBVSxTQUFTLFVBQVUsRUFBRSxNQUFNLFlBQVksQ0FBQyxFQUFFLGlCQUFpQixTQUFTLE1BQU0sS0FBSyxNQUFNLENBQUM7QUFFaEcsY0FBTSxhQUFhLFVBQVUsU0FBUyxVQUFVLEVBQUUsS0FBSyxlQUFlLE1BQU0sYUFBVSxDQUFDO0FBQ3ZGLG1CQUFXLGlCQUFpQixTQUFTLE1BQU07QUFDekMsZUFBSyxNQUFNO0FBQ1gsZUFBSyxVQUFVO0FBQUEsUUFDakIsQ0FBQztBQUFBLE1BQ0g7QUFBQSxNQUVBLFVBQVU7QUFDUixhQUFLLFVBQVUsTUFBTTtBQUFBLE1BQ3ZCO0FBQUEsSUFDRjtBQU9BLFFBQU0seUJBQU4sY0FBcUMsTUFBTTtBQUFBLE1BQ3pDLFlBQVksUUFBUSxTQUFTLFNBQVMsZUFBZSxXQUFXLFVBQVU7QUFDeEUsY0FBTSxPQUFPLEdBQUc7QUFDaEIsYUFBSyxTQUFTO0FBQ2QsYUFBSyxVQUFVO0FBQ2YsYUFBSyxVQUFVO0FBQ2YsYUFBSyxnQkFBZ0I7QUFDckIsYUFBSyxZQUFZO0FBQ2pCLGFBQUssV0FBVztBQUNoQixhQUFLLFlBQVk7QUFBQSxNQUNuQjtBQUFBLE1BRUEsU0FBUztBQUNQLGNBQU0sRUFBRSxVQUFVLElBQUk7QUFDdEIsYUFBSyxRQUFRLFNBQVMsMkJBQTJCO0FBSWpELGNBQU0sUUFBUSxLQUFLLE9BQU8sU0FBUyxXQUFXLEtBQUssT0FBTyxLQUFLO0FBQy9ELGNBQU0sSUFBSSxVQUFVLFNBQVMsR0FBRztBQUNoQyxVQUFFLFdBQVcsTUFBTTtBQUNuQix1QkFBZSxHQUFHLEtBQUssUUFBUSxLQUFLLFNBQVMsS0FBSztBQUNsRCxVQUFFLFdBQVcsTUFBTTtBQUNuQix1QkFBZSxHQUFHLEtBQUssUUFBUSxLQUFLLFNBQVMsS0FBSztBQUNsRCxVQUFFLFdBQVcsbUJBQW1CLEtBQUssYUFBYSxtQ0FBbUM7QUFFckYsY0FBTSxZQUFZLFVBQVUsVUFBVSxFQUFFLEtBQUsseUJBQXlCLENBQUM7QUFDdkUsa0JBQVUsU0FBUyxVQUFVLEVBQUUsTUFBTSxZQUFZLENBQUMsRUFBRSxpQkFBaUIsU0FBUyxNQUFNLEtBQUssTUFBTSxDQUFDO0FBRWhHLGNBQU0sYUFBYSxVQUFVLFNBQVMsVUFBVSxFQUFFLEtBQUssV0FBVyxNQUFNLGFBQWEsQ0FBQztBQUN0RixtQkFBVyxpQkFBaUIsU0FBUyxNQUFNO0FBQ3pDLGVBQUssWUFBWTtBQUNqQixlQUFLLE1BQU07QUFDWCxlQUFLLFVBQVU7QUFBQSxRQUNqQixDQUFDO0FBQUEsTUFDSDtBQUFBO0FBQUE7QUFBQSxNQUlBLFVBQVU7QUFDUixhQUFLLFVBQVUsTUFBTTtBQUNyQixZQUFJLENBQUMsS0FBSyxVQUFXLE1BQUssV0FBVztBQUFBLE1BQ3ZDO0FBQUEsSUFDRjtBQVFBLFFBQU0sd0JBQU4sY0FBb0MsdUJBQXVCO0FBQUEsTUFDekQsU0FBUztBQUNQLGNBQU0sRUFBRSxVQUFVLElBQUk7QUFDdEIsYUFBSyxRQUFRLFNBQVMsMkJBQTJCO0FBQ2pELGNBQU0sV0FBVyxLQUFLLE9BQU87QUFDN0IsY0FBTSxJQUFJLFVBQVUsU0FBUyxHQUFHO0FBQ2hDLFVBQUUsV0FBVyxNQUFNO0FBQ25CLHVCQUFlLEdBQUcsS0FBSyxRQUFRLEtBQUssU0FBUyxTQUFTLFdBQVcsS0FBSyxPQUFPLEtBQUssSUFBSTtBQUN0RixVQUFFLFdBQVcsc0JBQXNCO0FBQ25DLHVCQUFlLEdBQUcsS0FBSyxRQUFRLEtBQUssU0FBUyxTQUFTLFdBQVcsS0FBSyxPQUFPLEtBQUssSUFBSTtBQUN0RixVQUFFLFdBQVcsdUJBQXVCO0FBRXBDLGtCQUFVLFNBQVMsS0FBSztBQUFBLFVBQ3RCLE1BQ0UsR0FBRyxLQUFLLGFBQWEseUJBQXlCLEtBQUssT0FBTyw0REFDWCxLQUFLLE9BQU87QUFBQSxRQUUvRCxDQUFDO0FBRUQsY0FBTSxZQUFZLFVBQVUsVUFBVSxFQUFFLEtBQUsseUJBQXlCLENBQUM7QUFDdkUsa0JBQVUsU0FBUyxVQUFVLEVBQUUsTUFBTSxZQUFZLENBQUMsRUFBRSxpQkFBaUIsU0FBUyxNQUFNLEtBQUssTUFBTSxDQUFDO0FBRWhHLGNBQU0sYUFBYSxVQUFVLFNBQVMsVUFBVSxFQUFFLEtBQUssZUFBZSxNQUFNLGdCQUFnQixDQUFDO0FBQzdGLG1CQUFXLGlCQUFpQixTQUFTLE1BQU07QUFDekMsZUFBSyxZQUFZO0FBQ2pCLGVBQUssTUFBTTtBQUNYLGVBQUssVUFBVTtBQUFBLFFBQ2pCLENBQUM7QUFBQSxNQUNIO0FBQUEsSUFDRjtBQUtBLFFBQU0sc0JBQU4sY0FBa0MsTUFBTTtBQUFBLE1BQ3RDLFlBQVksS0FBSyxFQUFFLFlBQVksYUFBYSxZQUFZLFdBQVcsU0FBUyxHQUFHO0FBQzdFLGNBQU0sR0FBRztBQUNULGFBQUssYUFBYTtBQUNsQixhQUFLLGNBQWM7QUFDbkIsYUFBSyxhQUFhO0FBQ2xCLGFBQUssWUFBWTtBQUNqQixhQUFLLFdBQVc7QUFDaEIsYUFBSyxZQUFZO0FBQUEsTUFDbkI7QUFBQSxNQUVBLFNBQVM7QUFDUCxjQUFNLEVBQUUsVUFBVSxJQUFJO0FBQ3RCLGFBQUssUUFBUSxTQUFTLDJCQUEyQjtBQUNqRCxtQkFBVyxRQUFRLEtBQUssV0FBWSxXQUFVLFNBQVMsS0FBSyxFQUFFLEtBQUssQ0FBQztBQUVwRSxjQUFNLFlBQVksVUFBVSxVQUFVLEVBQUUsS0FBSyx5QkFBeUIsQ0FBQztBQUN2RSxrQkFBVSxTQUFTLFVBQVUsRUFBRSxNQUFNLFlBQVksQ0FBQyxFQUFFLGlCQUFpQixTQUFTLE1BQU0sS0FBSyxNQUFNLENBQUM7QUFFaEcsY0FBTSxhQUFhLFVBQVUsU0FBUyxVQUFVLEVBQUUsS0FBSyxLQUFLLFlBQVksTUFBTSxLQUFLLFlBQVksQ0FBQztBQUNoRyxtQkFBVyxpQkFBaUIsU0FBUyxNQUFNO0FBQ3pDLGVBQUssWUFBWTtBQUNqQixlQUFLLE1BQU07QUFDWCxlQUFLLFVBQVU7QUFBQSxRQUNqQixDQUFDO0FBQUEsTUFDSDtBQUFBLE1BRUEsVUFBVTtBQUNSLGFBQUssVUFBVSxNQUFNO0FBQ3JCLFlBQUksQ0FBQyxLQUFLLFVBQVcsTUFBSyxXQUFXO0FBQUEsTUFDdkM7QUFBQSxJQUNGO0FBRUEsUUFBTSxVQUFOLGNBQXNCLFNBQVM7QUFBQSxNQUM3QixZQUFZLE1BQU0sUUFBUTtBQUN4QixjQUFNLElBQUk7QUFDVixhQUFLLFNBQVM7QUFBQSxNQUNoQjtBQUFBLE1BRUEsY0FBYztBQUNaLGVBQU87QUFBQSxNQUNUO0FBQUEsTUFFQSxpQkFBaUI7QUFDZixlQUFPO0FBQUEsTUFDVDtBQUFBLE1BRUEsVUFBVTtBQUNSLGVBQU87QUFBQSxNQUNUO0FBQUEsTUFFQSxNQUFNLFNBQVM7QUFDYixhQUFLLFlBQVk7QUFDakIsYUFBSyxlQUFlO0FBQ3BCLGFBQUssb0JBQW9CO0FBQ3pCLGFBQUsscUJBQXFCLENBQUM7QUFFM0IsYUFBSyxVQUFVLE1BQU07QUFDckIsYUFBSyxVQUFVLFNBQVMsZUFBZTtBQUV2QyxhQUFLLGlCQUFpQixLQUFLLFdBQVcsV0FBVyxDQUFDLFVBQVU7QUFDMUQsY0FBSSxNQUFNLFFBQVEsWUFBWSxLQUFLLGlCQUFpQixLQUFNLE1BQUssa0JBQWtCO0FBQUEsUUFDbkYsQ0FBQztBQUNELGFBQUssT0FBTztBQUFBLE1BQ2Q7QUFBQSxNQUVBLE1BQU0sVUFBVTtBQUNkLGFBQUssMkJBQTJCO0FBQUEsTUFDbEM7QUFBQSxNQUVBLFdBQVcsTUFBTTtBQUNmLGNBQU0sZUFBZSxLQUFLLE9BQU8sSUFBSSxnQkFBZ0IsY0FBYyxlQUFlO0FBQ2xGLFlBQUksQ0FBQyxhQUFjO0FBS25CLGNBQU0sUUFBUSxTQUFTLE9BQU8sTUFBTUEsYUFBWSxnQkFBZ0IsS0FBSyxXQUFXLElBQUk7QUFDcEYscUJBQWEsU0FBUyxpQkFBaUIsS0FBSztBQUFBLE1BQzlDO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BT0EsV0FBVyxNQUFNO0FBQ2YsY0FBTSxNQUFNLEtBQUssT0FBTyxTQUFTLFdBQVcsSUFBSTtBQUNoRCxlQUFPLE1BQU0sUUFBUSxHQUFHLElBQ3BCLElBQUksSUFBSSxDQUFDLE1BQU0sS0FBS0EsYUFBWSxNQUFNLE9BQU8sS0FBSyxFQUFFLEVBQUUsS0FBSyxDQUFDLElBQUksRUFBRSxLQUFLLEdBQUcsSUFDMUUsS0FBS0EsYUFBWSxNQUFNLElBQUk7QUFBQSxNQUNqQztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFTQSxNQUFNLGFBQWEsU0FBUztBQUMxQixjQUFNLFNBQVMsTUFBTSxLQUFLLHNCQUFzQixPQUFPO0FBQ3ZELFlBQUksQ0FBQyxPQUFRO0FBRWIsY0FBTSxLQUFLLE9BQU8sYUFBYTtBQUMvQixhQUFLLE9BQU87QUFDWixhQUFLLE9BQU8sbUJBQW1CO0FBRS9CLFlBQUksT0FBTyxVQUFVLEdBQUc7QUFDdEIsY0FBSSxPQUFPLE9BQU8sT0FBTyxJQUFJLGlCQUFpQixPQUFPLE9BQU8sdUJBQXVCO0FBQUEsUUFDckY7QUFBQSxNQUNGO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQU1BLE1BQU0sc0JBQXNCLFNBQVM7QUFDbkMsY0FBTSxNQUFNLEtBQUssT0FBTyxTQUFTLFdBQVcsT0FBTztBQUNuRCxjQUFNLGFBQWEsaUJBQWlCLFFBQVEsU0FBWSxVQUFVLEdBQUc7QUFDckUsWUFBSSxDQUFDLFdBQVksUUFBTztBQUN4QixZQUFJLENBQUMsS0FBSyxPQUFPLFNBQVMsTUFBTSxTQUFTLFVBQVUsR0FBRztBQUNwRCxlQUFLLE9BQU8sU0FBUyxNQUFNLEtBQUssVUFBVTtBQUFBLFFBQzVDO0FBQ0EsY0FBTSxVQUFVLGVBQWUsVUFBVSxNQUFNLGtCQUFrQixLQUFLLFFBQVEsU0FBUyxVQUFVLElBQUk7QUFDckcsZUFBTyxFQUFFLE1BQU0sWUFBWSxRQUFRO0FBQUEsTUFDckM7QUFBQTtBQUFBO0FBQUEsTUFJQSxXQUFXO0FBQ1QsWUFBSSxLQUFLLFVBQVc7QUFFcEIsY0FBTSxXQUFXLEtBQUssT0FBTyxVQUFVLEVBQUUsS0FBSyxZQUFZLENBQUM7QUFDM0QsWUFBSSxLQUFLLFlBQWEsTUFBSyxPQUFPLGFBQWEsVUFBVSxLQUFLLFdBQVc7QUFDekUsY0FBTSxPQUFPLFNBQVMsVUFBVSxFQUFFLEtBQUssOEJBQThCLENBQUM7QUFDdEUsY0FBTSxRQUFRLEtBQUssVUFBVSxFQUFFLEtBQUssa0JBQWtCLENBQUM7QUFFdkQsYUFBSyxhQUFhLE1BQU0sTUFBTSxLQUFLO0FBQUEsTUFDckM7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQUtBLGFBQWEsTUFBTSxNQUFNLE9BQU87QUFDOUIsWUFBSSxLQUFLLFVBQVc7QUFDcEIsYUFBSyxZQUFZO0FBRWpCLGFBQUssU0FBUyxrQkFBa0I7QUFDaEMsY0FBTSxhQUFhLG1CQUFtQixNQUFNO0FBQzVDLGNBQU0sYUFBYSxjQUFjLE9BQU87QUFDeEMsY0FBTSxNQUFNO0FBRVosY0FBTSxRQUFRLE1BQU0sSUFBSSxZQUFZO0FBQ3BDLGNBQU0sbUJBQW1CLEtBQUs7QUFDOUIsY0FBTSxZQUFZLE1BQU0sSUFBSSxhQUFhO0FBQ3pDLGtCQUFVLGdCQUFnQjtBQUMxQixrQkFBVSxTQUFTLEtBQUs7QUFFeEIsWUFBSSxPQUFPO0FBQ1gsY0FBTSxTQUFTLE9BQU8sV0FBVztBQUMvQixjQUFJLEtBQU07QUFDVixpQkFBTztBQUNQLGVBQUssWUFBWTtBQUVqQixnQkFBTSxRQUFRLGtCQUFrQixNQUFNLFdBQVc7QUFDakQsY0FBSSxVQUFVLFNBQVMsVUFBVSxNQUFNO0FBQ3JDLGtCQUFNLFNBQVMsS0FBSyxPQUFPLFNBQVMsTUFBTTtBQUFBLGNBQ3hDLENBQUMsTUFBTSxFQUFFLFlBQVksTUFBTSxNQUFNLFlBQVksS0FBSyxNQUFNO0FBQUEsWUFDMUQ7QUFDQSxnQkFBSSxDQUFDLFFBQVE7QUFDWCxrQkFBSSxTQUFTLE1BQU07QUFDakIscUJBQUssT0FBTyxTQUFTLE1BQU0sS0FBSyxLQUFLO0FBQUEsY0FDdkMsT0FBTztBQUNMLHNCQUFNLE1BQU0sS0FBSyxPQUFPLFNBQVMsTUFBTSxRQUFRLElBQUk7QUFDbkQsb0JBQUksUUFBUSxHQUFJLE1BQUssT0FBTyxTQUFTLE1BQU0sR0FBRyxJQUFJO0FBQ2xELG9CQUFJLEtBQUssT0FBTyxTQUFTLFdBQVcsSUFBSSxNQUFNLFFBQVc7QUFDdkQsdUJBQUssT0FBTyxTQUFTLFdBQVcsS0FBSyxJQUFJLEtBQUssT0FBTyxTQUFTLFdBQVcsSUFBSTtBQUM3RSx5QkFBTyxLQUFLLE9BQU8sU0FBUyxXQUFXLElBQUk7QUFBQSxnQkFDN0M7QUFDQSxvQkFBSSxLQUFLLE9BQU8sU0FBUyxpQkFBaUIsSUFBSSxNQUFNLFFBQVc7QUFDN0QsdUJBQUssT0FBTyxTQUFTLGlCQUFpQixLQUFLLElBQUksS0FBSyxPQUFPLFNBQVMsaUJBQWlCLElBQUk7QUFDekYseUJBQU8sS0FBSyxPQUFPLFNBQVMsaUJBQWlCLElBQUk7QUFBQSxnQkFDbkQ7QUFDQSxvQkFBSSxLQUFLLE9BQU8sU0FBUyx1QkFBdUIsSUFBSSxNQUFNLFFBQVc7QUFDbkUsdUJBQUssT0FBTyxTQUFTLHVCQUF1QixLQUFLLElBQUksS0FBSyxPQUFPLFNBQVMsdUJBQXVCLElBQUk7QUFDckcseUJBQU8sS0FBSyxPQUFPLFNBQVMsdUJBQXVCLElBQUk7QUFBQSxnQkFDekQ7QUFDQSxvQkFBSSxLQUFLLE9BQU8sU0FBUyxpQkFBaUIsSUFBSSxNQUFNLFFBQVc7QUFDN0QsdUJBQUssT0FBTyxTQUFTLGlCQUFpQixLQUFLLElBQUksS0FBSyxPQUFPLFNBQVMsaUJBQWlCLElBQUk7QUFDekYseUJBQU8sS0FBSyxPQUFPLFNBQVMsaUJBQWlCLElBQUk7QUFBQSxnQkFDbkQ7QUFDQSxvQkFBSSxLQUFLLE9BQU8sU0FBUyxjQUFjLElBQUksTUFBTSxRQUFXO0FBQzFELHVCQUFLLE9BQU8sU0FBUyxjQUFjLEtBQUssSUFBSSxLQUFLLE9BQU8sU0FBUyxjQUFjLElBQUk7QUFDbkYseUJBQU8sS0FBSyxPQUFPLFNBQVMsY0FBYyxJQUFJO0FBQUEsZ0JBQ2hEO0FBQ0Esb0JBQUksS0FBSyxpQkFBaUIsRUFBRSxJQUFJLE1BQU0sUUFBVztBQUMvQyx1QkFBSyxPQUFPLFNBQVMsV0FBVyxLQUFLLElBQUksS0FBSyxPQUFPLFNBQVMsV0FBVyxJQUFJO0FBQzdFLHlCQUFPLEtBQUssT0FBTyxTQUFTLFdBQVcsSUFBSTtBQUFBLGdCQUM3QztBQUNBLGlDQUFpQixLQUFLLE9BQU8sVUFBVSxNQUFNLEtBQUs7QUFBQSxjQUNwRDtBQUNBLG9CQUFNLEtBQUssT0FBTyxhQUFhO0FBQy9CLG1CQUFLLE9BQU8sbUJBQW1CO0FBQUEsWUFDakM7QUFBQSxVQUNGO0FBQ0EsZUFBSyxPQUFPO0FBQUEsUUFDZDtBQUVBLGNBQU0saUJBQWlCLFdBQVcsQ0FBQyxVQUFVO0FBQzNDLGNBQUksTUFBTSxRQUFRLFNBQVM7QUFDekIsa0JBQU0sZUFBZTtBQUNyQixtQkFBTyxJQUFJO0FBQUEsVUFDYixXQUFXLE1BQU0sUUFBUSxVQUFVO0FBQ2pDLGtCQUFNLGVBQWU7QUFDckIsbUJBQU8sS0FBSztBQUFBLFVBQ2Q7QUFBQSxRQUNGLENBQUM7QUFFRCxjQUFNLGlCQUFpQixRQUFRLE1BQU0sT0FBTyxJQUFJLENBQUM7QUFBQSxNQUNuRDtBQUFBLE1BRUEsaUJBQWlCLE1BQU07QUFDckIsYUFBSyxlQUFlO0FBQ3BCLGFBQUssT0FBTztBQUFBLE1BQ2Q7QUFBQSxNQUVBLG9CQUFvQjtBQUNsQixhQUFLLGVBQWU7QUFDcEIsYUFBSyxPQUFPO0FBQUEsTUFDZDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFTQSwyQkFBMkI7QUFDekIsbUJBQVcsVUFBVSxLQUFLLHNCQUFzQixDQUFDLEVBQUcsTUFBSyxZQUFZLE1BQU07QUFDM0UsYUFBSyxxQkFBcUIsQ0FBQztBQUMzQixhQUFLLG9CQUFvQjtBQUFBLE1BQzNCO0FBQUEsTUFFQSxTQUFTO0FBT1AsWUFBSSxLQUFLLFdBQVk7QUFDckIsYUFBSyxhQUFhO0FBQ2xCLFlBQUk7QUFDRixlQUFLLHlCQUF5QjtBQUM5QixjQUFJLEtBQUssaUJBQWlCLE1BQU07QUFDOUIsaUJBQUssbUJBQW1CLEtBQUssWUFBWTtBQUN6QztBQUFBLFVBQ0Y7QUFFQSxnQkFBTSxFQUFFLFVBQVUsSUFBSTtBQUN0QixvQkFBVSxNQUFNO0FBRWhCLGdCQUFNLEVBQUUsUUFBUSxPQUFPLElBQUksS0FBSyxPQUFPLFNBQVMsV0FBVztBQUMzRCxnQkFBTSxhQUFhLEtBQUssT0FBTyxTQUFTO0FBQ3hDLGdCQUFNLGFBQWEsS0FBSyxPQUFPLFNBQVM7QUFDeEMsZ0JBQU0sWUFBWSxLQUFLLE9BQU8sU0FBUyxnQkFBZ0JFO0FBQ3ZELGdCQUFNLGVBQWUsY0FBYztBQUNuQyxnQkFBTSxpQkFBaUIsQ0FBQyxHQUFHLE1BQU0sYUFBYSxXQUFXLEdBQUcsR0FBRyxRQUFRLFVBQVU7QUFFakYsZUFBSyxpQkFBaUIsU0FBUztBQUUvQixnQkFBTSxtQkFBbUIsQ0FBQyxHQUFHLE9BQU8sS0FBSyxDQUFDLEVBQ3ZDLE9BQU8sQ0FBQyxTQUFTLENBQUMsV0FBVyxTQUFTLElBQUksQ0FBQyxFQUMzQyxLQUFLLGNBQWMsRUFDbkIsSUFBSSxDQUFDLFVBQVUsRUFBRSxNQUFNLE9BQU8sT0FBTyxJQUFJLElBQUksS0FBSyxFQUFFLEVBQUU7QUFDekQsZ0JBQU0sMEJBQTBCLEtBQUssd0JBQXdCO0FBSTdELGdCQUFNLFVBQVUsdUNBQXVDLEtBQUssY0FBYyxNQUFNLFNBQVMsZ0NBQWdDO0FBQ3pILGVBQUssU0FBUyxVQUFVLFVBQVUsRUFBRSxLQUFLLFFBQVEsQ0FBQztBQUNsRCxlQUFLLGNBQWM7QUFPbkIsZ0JBQU0sa0JBQWtCSixpQkFBZ0IsWUFBWSxXQUFXLFFBQVEsVUFBVTtBQUNqRiwwQkFBZ0IsUUFBUSxDQUFDLE1BQU0sVUFBVTtBQUN2QyxpQkFBSyxxQkFBcUIsTUFBTSxPQUFPLElBQUksSUFBSSxLQUFLLEdBQUcsRUFBRSxXQUFXLGNBQWMsTUFBTSxDQUFDO0FBQUEsVUFDM0YsQ0FBQztBQWNELGdCQUFNLFlBQVksTUFBTTtBQUN0QixrQkFBTSxLQUFLLEtBQUssT0FBTyxVQUFVLEVBQUUsS0FBSyxxQkFBcUIsQ0FBQztBQUM5RCxpQkFBSyxjQUFjLEtBQUssZUFBZTtBQUFBLFVBQ3pDO0FBRUEsY0FBSSxpQkFBaUIsU0FBUyxLQUFLLHdCQUF3QixTQUFTLEtBQUssU0FBUyxFQUFHLFdBQVU7QUFDL0YscUJBQVcsT0FBTyxpQkFBa0IsTUFBSyx1QkFBdUIsSUFBSSxNQUFNLElBQUksS0FBSztBQUVuRixjQUFJLHdCQUF3QixTQUFTLEdBQUc7QUFDdEMsZ0JBQUksaUJBQWlCLFNBQVMsRUFBRyxXQUFVO0FBQzNDLHVCQUFXLE9BQU8sd0JBQXlCLE1BQUssOEJBQThCLEdBQUc7QUFBQSxVQUNuRjtBQUVBLGNBQUksU0FBUyxFQUFHLE1BQUssaUJBQWlCLE1BQU07QUFBQSxRQUM5QyxVQUFFO0FBQ0EsZUFBSyxhQUFhO0FBQUEsUUFDcEI7QUFBQSxNQUNGO0FBQUE7QUFBQSxNQUdBLGlCQUFpQixXQUFXO0FBQzFCLGNBQU0sU0FBUyxVQUFVLFVBQVUsRUFBRSxLQUFLLGFBQWEsQ0FBQztBQUN4RCxjQUFNLG1CQUFtQixPQUFPLFVBQVUsRUFBRSxLQUFLLHdCQUF3QixDQUFDO0FBRTFFLGNBQU0sU0FBUyxpQkFBaUIsVUFBVTtBQUFBLFVBQ3hDLEtBQUs7QUFBQSxVQUNMLE1BQU0sRUFBRSxjQUFjLDBCQUF1QjtBQUFBLFFBQy9DLENBQUM7QUFDRCxnQkFBUSxRQUFRLE1BQU07QUFDdEIsZUFBTyxpQkFBaUIsU0FBUyxNQUFNLEtBQUssU0FBUyxDQUFDO0FBRXRELGNBQU0sVUFBVSxpQkFBaUIsVUFBVTtBQUFBLFVBQ3pDLEtBQUs7QUFBQSxVQUNMLE1BQU0sRUFBRSxjQUFjLCtCQUE0QjtBQUFBLFFBQ3BELENBQUM7QUFDRCxnQkFBUSxTQUFTLGlCQUFpQjtBQUNsQyxnQkFBUSxpQkFBaUIsU0FBUyxDQUFDLFVBQVUsS0FBSyxhQUFhLEtBQUssQ0FBQztBQU1yRSxjQUFNLFVBQVUsZ0JBQWdCLEtBQUssZUFBZSxDQUFDO0FBQ3JELGNBQU0sZUFBZSxpQkFBaUIsVUFBVTtBQUFBLFVBQzlDLEtBQUs7QUFBQSxVQUNMLE1BQU0sRUFBRSxjQUFjLG9CQUFvQixRQUFRLEtBQUssR0FBRztBQUFBLFFBQzVELENBQUM7QUFDRCxnQkFBUSxjQUFjLFFBQVEsSUFBSTtBQUNsQyxxQkFBYSxpQkFBaUIsU0FBUyxNQUFNLEtBQUssZUFBZSxDQUFDO0FBQUEsTUFDcEU7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQUtBLGdCQUFnQjtBQUNkLGNBQU0sT0FBTyxLQUFLLE9BQU8sU0FBUztBQUNsQyxlQUFPLGdCQUFnQixLQUFLLENBQUMsVUFBVSxNQUFNLFNBQVMsSUFBSSxJQUFJLE9BQU87QUFBQSxNQUN2RTtBQUFBLE1BRUEsaUJBQWlCO0FBQ2YsZUFBTyxnQkFBZ0IsVUFBVSxDQUFDLFVBQVUsTUFBTSxTQUFTLEtBQUssY0FBYyxDQUFDO0FBQUEsTUFDakY7QUFBQSxNQUVBLE1BQU0saUJBQWlCO0FBQ3JCLGNBQU0sT0FBTyxpQkFBaUIsS0FBSyxlQUFlLElBQUksS0FBSyxnQkFBZ0IsTUFBTTtBQUNqRixhQUFLLE9BQU8sU0FBUyxtQkFBbUIsS0FBSztBQUM3QyxjQUFNLEtBQUssT0FBTyxhQUFhO0FBSS9CLGFBQUssT0FBTztBQUFBLE1BQ2Q7QUFBQSxNQUVBLGFBQWEsT0FBTztBQUNsQixjQUFNLFVBQVUsS0FBSyxPQUFPLFNBQVMsZ0JBQWdCSTtBQUNyRCxjQUFNLE9BQU8sSUFBSSxLQUFLO0FBRXRCLGNBQU0sV0FBVyxDQUFDLE9BQU8sUUFBUTtBQUMvQixtQkFBUyxJQUFJLE9BQU8sSUFBSSxLQUFLLEtBQUs7QUFDaEMsa0JBQU0sRUFBRSxNQUFNLE1BQU0sSUFBSSxhQUFhLENBQUM7QUFDdEMsaUJBQUs7QUFBQSxjQUFRLENBQUMsU0FDWixLQUNHLFNBQVMsS0FBSyxFQUNkLFdBQVcsWUFBWSxJQUFJLEVBQzNCLFFBQVEsWUFBWTtBQUNuQixxQkFBSyxPQUFPLFNBQVMsZUFBZTtBQUNwQyxzQkFBTSxLQUFLLE9BQU8sYUFBYTtBQUMvQixxQkFBSyxPQUFPO0FBQUEsY0FDZCxDQUFDO0FBQUEsWUFDTDtBQUFBLFVBQ0Y7QUFBQSxRQUNGO0FBRUEsaUJBQVMsR0FBRyxDQUFDO0FBQ2IsYUFBSyxhQUFhO0FBQ2xCLGlCQUFTLEdBQUcsQ0FBQztBQUNiLGFBQUssYUFBYTtBQUNsQixpQkFBUyxHQUFHLENBQUM7QUFDYixhQUFLLGFBQWE7QUFDbEIsaUJBQVMsR0FBRyxDQUFDO0FBRWIsYUFBSyxpQkFBaUIsS0FBSztBQUFBLE1BQzdCO0FBQUEsTUFFQSxpQkFBaUIsT0FBTztBQUN0QixjQUFNLFdBQVcsS0FBSyxPQUFPLFVBQVUsRUFBRSxLQUFLLFlBQVksQ0FBQztBQUMzRCxjQUFNLE9BQU8sU0FBUyxVQUFVLEVBQUUsS0FBSyxvREFBb0QsQ0FBQztBQUM1RixhQUFLLFVBQVUsRUFBRSxLQUFLLG1CQUFtQixNQUFNLGFBQWEsQ0FBQztBQUM3RCxhQUFLLGlCQUFpQixNQUFNLEtBQUs7QUFFakMsYUFBSyxpQkFBaUIsU0FBUyxNQUFNLEtBQUssV0FBVyxJQUFJLENBQUM7QUFDMUQsYUFBSyxpQkFBaUIsZUFBZSxDQUFDLFVBQVU7QUFDOUMsZ0JBQU0sZUFBZTtBQUNyQixnQkFBTSxnQkFBZ0I7QUFDdEIsZUFBSyxXQUFXLElBQUk7QUFBQSxRQUN0QixDQUFDO0FBQUEsTUFDSDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BUUEsa0JBQWtCLFFBQVEsTUFBTSxVQUFVLEVBQUUsWUFBWSxNQUFNLElBQUksQ0FBQyxHQUFHO0FBQ3BFLGNBQU0sZUFBZSxLQUFLLE9BQU8sU0FBUyxXQUFXLElBQUksS0FBSztBQUM5RCxjQUFNLFlBQVksT0FBTyxVQUFVLEVBQUUsS0FBSyxzQkFBc0IsQ0FBQztBQUNqRSxjQUFNLFdBQVcsVUFBVSxVQUFVLEVBQUUsS0FBSyxxQkFBcUIsQ0FBQztBQUNsRSxZQUFJLFdBQVc7QUFDZixjQUFNLFlBQVksQ0FBQyxPQUFPLGNBQWM7QUFDdEMsd0JBQWMsVUFBVSxPQUFPLFNBQVM7QUFDeEMsY0FBSSxDQUFDLFVBQVc7QUFDaEIsb0JBQVUsYUFBYSxjQUFjLFlBQVksMkJBQTJCLGlCQUFjO0FBQzFGLG9CQUFVLFlBQVksZUFBZSxTQUFTO0FBQUEsUUFDaEQ7QUFFQSxjQUFNLGFBQWEsVUFBVSxTQUFTLFNBQVMsRUFBRSxNQUFNLFNBQVMsS0FBSyx1QkFBdUIsQ0FBQztBQUM3RixtQkFBVyxRQUFRO0FBQ25CLG1CQUFXLGlCQUFpQixTQUFTLENBQUMsVUFBVSxNQUFNLGdCQUFnQixDQUFDO0FBU3ZFLG1CQUFXLGlCQUFpQixTQUFTLFlBQVk7QUFDL0Msb0JBQVUsV0FBVyxPQUFPLEtBQUs7QUFDakMsZUFBSyxPQUFPLFNBQVMsV0FBVyxJQUFJLElBQUksV0FBVztBQUNuRCxnQkFBTSxLQUFLLE9BQU8sYUFBYTtBQUMvQixxQkFBVyxXQUFXLEtBQUs7QUFBQSxRQUM3QixDQUFDO0FBS0QsbUJBQVcsaUJBQWlCLFVBQVUsTUFBTSxLQUFLLE9BQU8sbUJBQW1CLENBQUM7QUFFNUUsWUFBSSxXQUFXO0FBQ2IscUJBQVcsT0FBTyxVQUFVO0FBQUEsWUFDMUIsS0FBSztBQUFBLFlBQ0wsTUFBTSxFQUFFLGNBQWMsd0JBQXFCO0FBQUEsVUFDN0MsQ0FBQztBQUNELGtCQUFRLFVBQVUsWUFBWTtBQUM5QixtQkFBUyxpQkFBaUIsU0FBUyxZQUFZO0FBQzdDLG1CQUFPLEtBQUssT0FBTyxTQUFTLFdBQVcsSUFBSTtBQUMzQyx1QkFBVyxRQUFRO0FBQ25CLHNCQUFVLG9CQUFvQixJQUFJO0FBQ2xDLGtCQUFNLEtBQUssT0FBTyxhQUFhO0FBQy9CLGlCQUFLLE9BQU8sbUJBQW1CO0FBQy9CLHVCQUFXLGtCQUFrQjtBQUFBLFVBQy9CLENBQUM7QUFBQSxRQUNIO0FBQ0Esa0JBQVUsY0FBYyxLQUFLLE9BQU8sU0FBUyxXQUFXLElBQUksTUFBTSxNQUFTO0FBRTNFLGVBQU87QUFBQSxNQUNUO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFRQSxtQkFBbUI7QUFDakIsWUFBSSxDQUFDLEtBQUssT0FBTyxTQUFTLFdBQVksTUFBSyxPQUFPLFNBQVMsYUFBYSxDQUFDO0FBQ3pFLGVBQU8sS0FBSyxPQUFPLFNBQVM7QUFBQSxNQUM5QjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BUUEsbUJBQW1CLFFBQVEsTUFBTTtBQUMvQixjQUFNLFVBQVUsS0FBSyxpQkFBaUIsRUFBRSxJQUFJLE1BQU07QUFDbEQsY0FBTSxXQUFXLE9BQU8sVUFBVTtBQUFBLFVBQ2hDLEtBQUssd0JBQXdCLFVBQVUsZ0JBQWdCO0FBQUEsVUFDdkQsTUFBTSxFQUFFLFVBQVUsS0FBSyxNQUFNLFlBQVksZ0JBQWdCLE9BQU8sT0FBTyxFQUFFO0FBQUEsUUFDM0UsQ0FBQztBQUNELGlCQUFTLFNBQVMsU0FBUyxFQUFFLE1BQU0sV0FBVyxDQUFDO0FBRS9DLGNBQU0sU0FBUyxZQUFZO0FBQ3pCLGdCQUFNLE9BQU8sQ0FBQyxTQUFTLFNBQVMsWUFBWTtBQUM1QyxtQkFBUyxZQUFZLGNBQWMsSUFBSTtBQUN2QyxtQkFBUyxhQUFhLGdCQUFnQixPQUFPLElBQUksQ0FBQztBQUNsRCxjQUFJLEtBQU0sUUFBTyxLQUFLLGlCQUFpQixFQUFFLElBQUk7QUFBQSxjQUN4QyxNQUFLLGlCQUFpQixFQUFFLElBQUksSUFBSTtBQUNyQyxnQkFBTSxLQUFLLE9BQU8sYUFBYTtBQUFBLFFBQ2pDO0FBRUEsaUJBQVMsaUJBQWlCLFNBQVMsTUFBTTtBQUN6QyxpQkFBUyxpQkFBaUIsV0FBVyxDQUFDLFVBQVU7QUFDOUMsY0FBSSxNQUFNLFFBQVEsV0FBVyxNQUFNLFFBQVEsS0FBSztBQUM5QyxrQkFBTSxlQUFlO0FBQ3JCLG1CQUFPO0FBQUEsVUFDVDtBQUFBLFFBQ0YsQ0FBQztBQUVELGVBQU87QUFBQSxNQUNUO0FBQUEsTUFFQSxxQkFBcUIsTUFBTSxPQUFPLEVBQUUsWUFBWSxPQUFPLFFBQVEsR0FBRyxJQUFJLENBQUMsR0FBRztBQUN4RSxjQUFNLFdBQVcsS0FBSyxPQUFPLFVBQVUsRUFBRSxLQUFLLFlBQVksQ0FBQztBQUMzRCxjQUFNLE9BQU8sU0FBUyxVQUFVLEVBQUUsS0FBSyw4QkFBOEIsQ0FBQztBQUV0RSxZQUFJO0FBQ0osYUFBSyxrQkFBa0IsTUFBTSxNQUFNLENBQUMsYUFBYTtBQUMvQyxjQUFJLFVBQVUsS0FBSyxPQUFPLFNBQVMsV0FBVyxRQUFTLFFBQU8sTUFBTSxRQUFRO0FBQUEsUUFDOUUsQ0FBQztBQUVELGlCQUFTLEtBQUssVUFBVSxFQUFFLEtBQUssbUJBQW1CLE1BQU0sS0FBSyxDQUFDO0FBQzlELGNBQU0sUUFBUSxLQUFLLE9BQU8sU0FBUyxXQUFXLFVBQVUsS0FBSyxPQUFPLFNBQVMsV0FBVyxJQUFJLElBQUk7QUFDaEcsWUFBSSxNQUFPLFFBQU8sTUFBTSxRQUFRO0FBSWhDLGNBQU0sWUFBWSxLQUFLLGNBQWM7QUFDckMsWUFBSSxjQUFjLGNBQWUsTUFBSyx1QkFBdUIsTUFBTSxJQUFJO0FBQUEsaUJBQzlELGNBQWMsV0FBWSxNQUFLLHFCQUFxQixNQUFNLElBQUk7QUFFdkUsYUFBSyxpQkFBaUIsTUFBTSxLQUFLO0FBRWpDLGFBQUssaUJBQWlCLFNBQVMsTUFBTTtBQUNuQyxjQUFJLEtBQUssVUFBVztBQUNwQixlQUFLLGlCQUFpQixJQUFJO0FBQUEsUUFDNUIsQ0FBQztBQUNELGFBQUssaUJBQWlCLGVBQWUsQ0FBQyxVQUFVO0FBQzlDLGdCQUFNLGVBQWU7QUFDckIsZ0JBQU0sZ0JBQWdCO0FBQ3RCLGVBQUssV0FBVyxJQUFJO0FBQUEsUUFDdEIsQ0FBQztBQVFELFlBQUksV0FBVztBQUNiLGVBQUssWUFBWTtBQUNqQixlQUFLLGlCQUFpQixhQUFhLENBQUMsVUFBVTtBQUM1QyxrQkFBTSxhQUFhLGdCQUFnQjtBQUNuQyxrQkFBTSxhQUFhLFFBQVEsY0FBYyxPQUFPLEtBQUssQ0FBQztBQUN0RCxpQkFBSyxVQUFVLElBQUksYUFBYTtBQUFBLFVBQ2xDLENBQUM7QUFDRCxlQUFLLGlCQUFpQixXQUFXLE1BQU0sS0FBSyxVQUFVLE9BQU8sYUFBYSxDQUFDO0FBQzNFLGVBQUssaUJBQWlCLFlBQVksQ0FBQyxVQUFVO0FBQzNDLGtCQUFNLGVBQWU7QUFDckIsa0JBQU0sT0FBTyxLQUFLLHNCQUFzQjtBQUN4QyxrQkFBTSxVQUFVLE1BQU0sVUFBVSxLQUFLLE1BQU0sS0FBSyxTQUFTO0FBQ3pELGlCQUFLLFVBQVUsT0FBTyxrQkFBa0IsQ0FBQyxPQUFPO0FBQ2hELGlCQUFLLFVBQVUsT0FBTyxpQkFBaUIsT0FBTztBQUFBLFVBQ2hELENBQUM7QUFDRCxlQUFLLGlCQUFpQixhQUFhLE1BQU0sS0FBSyxVQUFVLE9BQU8sa0JBQWtCLGVBQWUsQ0FBQztBQUNqRyxlQUFLLGlCQUFpQixRQUFRLE9BQU8sVUFBVTtBQUM3QyxrQkFBTSxlQUFlO0FBQ3JCLGtCQUFNLFVBQVUsS0FBSyxVQUFVLFNBQVMsZUFBZTtBQUN2RCxpQkFBSyxVQUFVLE9BQU8sa0JBQWtCLGVBQWU7QUFFdkQsa0JBQU0sWUFBWSxPQUFPLE1BQU0sYUFBYSxRQUFRLFlBQVksQ0FBQztBQUNqRSxnQkFBSSxPQUFPLE1BQU0sU0FBUyxLQUFLLGNBQWMsTUFBTztBQUVwRCxnQkFBSSxlQUFlLFVBQVUsUUFBUSxJQUFJO0FBQ3pDLGdCQUFJLFlBQVksYUFBYyxpQkFBZ0I7QUFFOUMsa0JBQU0sUUFBUSxLQUFLLE9BQU8sU0FBUztBQUNuQyxrQkFBTSxDQUFDLEtBQUssSUFBSSxNQUFNLE9BQU8sV0FBVyxDQUFDO0FBQ3pDLGtCQUFNLE9BQU8sY0FBYyxHQUFHLEtBQUs7QUFDbkMsa0JBQU0sS0FBSyxPQUFPLGFBQWE7QUFDL0IsaUJBQUssT0FBTztBQUFBLFVBQ2QsQ0FBQztBQUFBLFFBQ0g7QUFBQSxNQUNGO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BT0EsdUJBQXVCLE1BQU0sTUFBTTtBQUNqQyxjQUFNLFlBQVksS0FBSyxTQUFTLFNBQVM7QUFBQSxVQUN2QyxNQUFNO0FBQUEsVUFDTixLQUFLO0FBQUEsUUFDUCxDQUFDO0FBQ0Qsa0JBQVUsUUFBUSxLQUFLLE9BQU8sU0FBUyxpQkFBaUIsSUFBSSxLQUFLO0FBQ2pFLGtCQUFVLGlCQUFpQixTQUFTLENBQUMsVUFBVSxNQUFNLGdCQUFnQixDQUFDO0FBQ3RFLGtCQUFVLGlCQUFpQixVQUFVLFlBQVk7QUFDL0MsZ0JBQU0sUUFBUSxVQUFVLE1BQU0sS0FBSztBQUNuQyxjQUFJLE1BQU8sTUFBSyxPQUFPLFNBQVMsaUJBQWlCLElBQUksSUFBSTtBQUFBLGNBQ3BELFFBQU8sS0FBSyxPQUFPLFNBQVMsaUJBQWlCLElBQUk7QUFDdEQsZ0JBQU0sS0FBSyxPQUFPLGFBQWE7QUFBQSxRQUNqQyxDQUFDO0FBQUEsTUFDSDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BaUJBLHFCQUFxQixNQUFNLE1BQU07QUFDL0IsY0FBTSxXQUFXTixpQkFBZ0IsS0FBSyxPQUFPLFVBQVUsSUFBSTtBQUMzRCxZQUFJLFNBQVMsV0FBVyxFQUFHO0FBRTNCLGNBQU0sV0FBVyxLQUFLLE9BQU8sU0FBUyxXQUFXO0FBQ2pELGNBQU0sT0FBTyxLQUFLLFdBQVcsRUFBRSxLQUFLLHlCQUF5QixDQUFDO0FBQzlELGFBQUssV0FBVyxHQUFHO0FBQ25CLGlCQUFTLFFBQVEsQ0FBQyxTQUFTLFVBQVU7QUFDbkMsY0FBSSxRQUFRLEVBQUcsTUFBSyxXQUFXLElBQUk7QUFDbkMsZ0JBQU0sT0FBTyxLQUFLLFdBQVcsRUFBRSxNQUFNLFFBQVEsQ0FBQztBQUM5QyxjQUFJLFNBQVUsTUFBSyxNQUFNLFFBQVEsVUFBVSxLQUFLLE9BQU8sVUFBVSxNQUFNLE9BQU8sRUFBRTtBQUFBLFFBQ2xGLENBQUM7QUFDRCxhQUFLLFdBQVcsR0FBRztBQUFBLE1BQ3JCO0FBQUEsTUFFQSx1QkFBdUIsTUFBTSxPQUFPO0FBQ2xDLGNBQU0sV0FBVyxLQUFLLE9BQU8sVUFBVSxFQUFFLEtBQUssWUFBWSxDQUFDO0FBQzNELGNBQU0sT0FBTyxTQUFTLFVBQVUsRUFBRSxLQUFLLG9EQUFvRCxDQUFDO0FBQzVGLGFBQUssVUFBVSxFQUFFLEtBQUssbUJBQW1CLE1BQU0sZUFBZSxJQUFJLEVBQUUsQ0FBQztBQUNyRSxhQUFLLGlCQUFpQixNQUFNLEtBQUs7QUFFakMsYUFBSyxpQkFBaUIsU0FBUyxNQUFNLEtBQUssYUFBYSxJQUFJLENBQUM7QUFDNUQsYUFBSyxpQkFBaUIsZUFBZSxDQUFDLFVBQVU7QUFDOUMsZ0JBQU0sZUFBZTtBQUNyQixnQkFBTSxnQkFBZ0I7QUFDdEIsZUFBSyxXQUFXLElBQUk7QUFBQSxRQUN0QixDQUFDO0FBQUEsTUFDSDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BaUJBLDBCQUEwQjtBQUN4QixjQUFNLGFBQWEsS0FBSyxPQUFPLFNBQVM7QUFDeEMsY0FBTSxPQUFPLENBQUM7QUFDZCxtQkFBVyxDQUFDLE1BQU0sTUFBTSxLQUFLLEtBQUssT0FBTyxTQUFTLGNBQWMsR0FBRztBQUNqRSxnQkFBTSxRQUFRQSxpQkFBZ0IsS0FBSyxPQUFPLFVBQVUsSUFBSTtBQUN4RCxxQkFBVyxDQUFDLFNBQVMsS0FBSyxLQUFLLE9BQU8sUUFBUTtBQUM1QyxnQkFBSSxNQUFNLFNBQVMsT0FBTyxFQUFHO0FBQzdCLGlCQUFLLEtBQUssRUFBRSxNQUFNLFNBQVMsT0FBTyxnQkFBZ0IsV0FBVyxTQUFTLElBQUksRUFBRSxDQUFDO0FBQUEsVUFDL0U7QUFBQSxRQUNGO0FBQ0EsZUFBTyxLQUFLLEtBQUssQ0FBQyxHQUFHLE1BQU0sRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLEtBQUssY0FBYyxFQUFFLElBQUksS0FBSyxFQUFFLFFBQVEsY0FBYyxFQUFFLE9BQU8sQ0FBQztBQUFBLE1BQ3BIO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQVNBLDhCQUE4QixFQUFFLE1BQU0sU0FBUyxPQUFPLGVBQWUsR0FBRztBQUN0RSxjQUFNLFdBQVcsS0FBSyxPQUFPLFVBQVUsRUFBRSxLQUFLLFlBQVksQ0FBQztBQUMzRCxjQUFNLE9BQU8sU0FBUyxVQUFVLEVBQUUsS0FBSyxvREFBb0QsQ0FBQztBQUU1RixjQUFNLFdBQVcsS0FBSyxPQUFPLFNBQVMsV0FBVztBQUNqRCxjQUFNLEVBQUUsT0FBTyxVQUFVLElBQUksVUFBVSxLQUFLLE9BQU8sVUFBVSxJQUFJO0FBQ2pFLFlBQUksa0JBQWtCLENBQUMsVUFBVTtBQUMvQixnQkFBTSxPQUFPLEtBQUssVUFBVSxFQUFFLEtBQUssMERBQTBELENBQUM7QUFDOUYsd0JBQWMsS0FBSyxVQUFVLEVBQUUsS0FBSyxxQkFBcUIsQ0FBQyxHQUFHLE9BQU8sU0FBUztBQUFBLFFBQy9FO0FBRUEsY0FBTSxRQUFRLEtBQUssVUFBVSxFQUFFLEtBQUssa0JBQWtCLENBQUM7QUFDdkQsY0FBTSxTQUFTLE1BQU0sV0FBVyxFQUFFLEtBQUssc0NBQXNDLE1BQU0sZUFBZSxJQUFJLEVBQUUsQ0FBQztBQUN6RyxZQUFJLGtCQUFrQixZQUFZLENBQUMsV0FBVztBQUM1QyxpQkFBTyxNQUFNLFFBQVE7QUFDckIsaUJBQU8sU0FBUyxxQ0FBcUM7QUFBQSxRQUN2RDtBQUNBLGNBQU0sV0FBVyxFQUFFLEtBQUssdUNBQXVDLE1BQU0sTUFBTSxDQUFDO0FBQzVFLGNBQU0sV0FBVyxFQUFFLE1BQU0sZUFBZSxPQUFPLEVBQUUsQ0FBQztBQUVsRCxhQUFLLGlCQUFpQixNQUFNLEtBQUs7QUFFakMsYUFBSyxpQkFBaUIsU0FBUyxNQUFNLEtBQUssd0JBQXdCLE1BQU0sT0FBTyxDQUFDO0FBQ2hGLGFBQUssaUJBQWlCLGVBQWUsQ0FBQyxVQUFVO0FBQzlDLGdCQUFNLGVBQWU7QUFDckIsZ0JBQU0sZ0JBQWdCO0FBQ3RCLGVBQUssa0JBQWtCLE1BQU0sT0FBTztBQUFBLFFBQ3RDLENBQUM7QUFBQSxNQUNIO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFXQSxNQUFNLHdCQUF3QixTQUFTLFlBQVk7QUFDakQsY0FBTSxTQUFTLEtBQUssT0FBTyxTQUFTLGNBQWMsT0FBTztBQUN6RCxjQUFNLGFBQWEsS0FBSyxPQUFPLFNBQVMsTUFBTSxTQUFTLE9BQU8sSUFDMUQsRUFBRSxNQUFNLFNBQVMsU0FBUyxFQUFFLElBQzVCLE1BQU0sS0FBSyxzQkFBc0IsT0FBTztBQUM1QyxZQUFJLENBQUMsV0FBWTtBQUVqQixjQUFNLGdCQUFnQixNQUFNLEtBQUsseUJBQXlCLFdBQVcsTUFBTSxZQUFZLE1BQU07QUFDN0YsY0FBTSxLQUFLLE9BQU8sYUFBYTtBQUMvQixhQUFLLE9BQU87QUFDWixhQUFLLE9BQU8sbUJBQW1CO0FBRS9CLFlBQUksQ0FBQyxjQUFlO0FBQ3BCLGNBQU0sUUFBUSxDQUFDO0FBQ2YsWUFBSSxXQUFXLFNBQVMsUUFBUyxPQUFNLEtBQUssT0FBTyxXQUFXLElBQUksRUFBRTtBQUNwRSxjQUFNLEtBQUssVUFBVSxjQUFjLE9BQU8sRUFBRTtBQUM1QyxjQUFNLFVBQVUsV0FBVyxVQUFVLGNBQWM7QUFDbkQsWUFBSSxPQUFPLEdBQUcsTUFBTSxLQUFLLE9BQU8sQ0FBQyxlQUFlLFVBQVUsSUFBSSxLQUFLLE9BQU8seUJBQXlCLEVBQUUsR0FBRztBQUFBLE1BQzFHO0FBQUEsTUFFQSxtQkFBbUIsTUFBTTtBQUN2QixjQUFNLEVBQUUsVUFBVSxJQUFJO0FBQ3RCLGtCQUFVLE1BQU07QUFFaEIsY0FBTSxTQUFTLFVBQVUsVUFBVSxFQUFFLEtBQUsseUJBQXlCLENBQUM7QUFDcEUsY0FBTSxVQUFVLE9BQU8sVUFBVSxFQUFFLEtBQUssZ0NBQWdDLE1BQU0sRUFBRSxjQUFjLFlBQVMsRUFBRSxDQUFDO0FBQzFHLGdCQUFRLFNBQVMsWUFBWTtBQUM3QixnQkFBUSxpQkFBaUIsU0FBUyxNQUFNLEtBQUssa0JBQWtCLENBQUM7QUFFaEUsY0FBTSxVQUFVLE9BQU8sVUFBVSxFQUFFLEtBQUsseUJBQXlCLE1BQU0sS0FBSyxDQUFDO0FBQzdFLGNBQU0sYUFBYSxLQUFLLE9BQU8sU0FBUyxXQUFXLFVBQVUsS0FBSyxPQUFPLFNBQVMsV0FBVyxJQUFJLElBQUk7QUFDckcsWUFBSSxXQUFZLFNBQVEsTUFBTSxRQUFRO0FBRXRDLGNBQU0sRUFBRSxPQUFPLElBQUksS0FBSyxPQUFPLFNBQVMsV0FBVztBQUNuRCxlQUFPLFdBQVcsRUFBRSxLQUFLLHlCQUF5QixNQUFNLE9BQU8sT0FBTyxJQUFJLElBQUksS0FBSyxDQUFDLEVBQUUsQ0FBQztBQU12RixjQUFNLHFCQUFxQixPQUFPLFVBQVU7QUFBQSxVQUMxQyxLQUFLO0FBQUEsVUFDTCxNQUFNLEVBQUUsY0FBYyxzQ0FBc0M7QUFBQSxRQUM5RCxDQUFDO0FBQ0QsZ0JBQVEsb0JBQW9CLFFBQVE7QUFDcEMsMkJBQW1CLGlCQUFpQixTQUFTLE1BQU0sS0FBSyxrQkFBa0IsTUFBTSxTQUFTLEVBQUUsYUFBYSxLQUFLLENBQUMsQ0FBQztBQUUvRyxjQUFNLFlBQVksT0FBTyxVQUFVLEVBQUUsS0FBSyx5Q0FBeUMsTUFBTSxFQUFFLGNBQWMsYUFBYSxFQUFFLENBQUM7QUFDekgsZ0JBQVEsV0FBVyxRQUFRO0FBQzNCLGtCQUFVLGlCQUFpQixTQUFTLE1BQU0sS0FBSyxrQkFBa0IsTUFBTSxPQUFPLENBQUM7QUFFL0UsY0FBTSxZQUFZLE9BQU8sVUFBVSxFQUFFLEtBQUsseUNBQXlDLE1BQU0sRUFBRSxjQUFjLGFBQVUsRUFBRSxDQUFDO0FBQ3RILGdCQUFRLFdBQVcsT0FBTztBQUMxQixrQkFBVSxpQkFBaUIsU0FBUyxNQUFNLEtBQUssa0JBQWtCLElBQUksQ0FBQztBQUV0RSxjQUFNLE9BQU8sVUFBVSxVQUFVLEVBQUUsS0FBSyx1QkFBdUIsQ0FBQztBQUVoRSxjQUFNLGNBQWMsS0FBSyxVQUFVLEVBQUUsS0FBSywrQkFBK0IsQ0FBQztBQUUxRSxjQUFNLGdCQUFnQixZQUFZLFVBQVUsRUFBRSxLQUFLLHNEQUFzRCxDQUFDO0FBQzFHLGNBQU0sbUJBQW1CLGNBQWMsVUFBVSxFQUFFLEtBQUsseUJBQXlCLENBQUM7QUFDbEYseUJBQWlCLFdBQVcsRUFBRSxLQUFLLGlDQUFpQyxNQUFNLGdCQUFnQixDQUFDO0FBQzNGLGFBQUssbUJBQW1CLGtCQUFrQixJQUFJO0FBRTlDLGNBQU0sV0FBVyxjQUFjLFVBQVUsRUFBRSxLQUFLLDRCQUE0QixDQUFDO0FBQzdFLGFBQUs7QUFBQSxVQUNIO0FBQUEsVUFDQTtBQUFBLFVBQ0EsQ0FBQyxhQUFhO0FBQ1osZ0JBQUksQ0FBQyxLQUFLLE9BQU8sU0FBUyxXQUFXLFFBQVM7QUFDOUMsb0JBQVEsTUFBTSxRQUFRO0FBQUEsVUFDeEI7QUFBQSxVQUNBLEVBQUUsV0FBVyxLQUFLO0FBQUEsUUFDcEI7QUFFQSxjQUFNLGFBQWEsWUFBWSxVQUFVLEVBQUUsS0FBSyw4QkFBOEIsQ0FBQztBQUMvRSxtQkFBVyxVQUFVLEVBQUUsS0FBSyxpQ0FBaUMsTUFBTSxlQUFlLENBQUM7QUFFbkYsY0FBTSxZQUFZLFlBQVksU0FBUyxZQUFZO0FBQUEsVUFDakQsS0FBSztBQUFBLFVBQ0wsTUFBTSxFQUFFLE1BQU0sSUFBSTtBQUFBLFFBQ3BCLENBQUM7QUFDRCxrQkFBVSxRQUFRLEtBQUssT0FBTyxTQUFTLGlCQUFpQixJQUFJLEtBQUs7QUFDakUsa0JBQVUsaUJBQWlCLFVBQVUsWUFBWTtBQUMvQyxnQkFBTSxRQUFRLFVBQVUsTUFBTSxLQUFLO0FBQ25DLGNBQUksTUFBTyxNQUFLLE9BQU8sU0FBUyxpQkFBaUIsSUFBSSxJQUFJO0FBQUEsY0FDcEQsUUFBTyxLQUFLLE9BQU8sU0FBUyxpQkFBaUIsSUFBSTtBQUN0RCxnQkFBTSxLQUFLLE9BQU8sYUFBYTtBQUFBLFFBQ2pDLENBQUM7QUFVRCxjQUFNLFNBQVMsS0FBSyxPQUFPLFNBQVMsY0FBYyxJQUFJO0FBQ3RELGFBQUssb0JBQW9CLHVCQUF1QixNQUFNLE1BQU0sTUFBTTtBQUFBLFVBQ2hFLGNBQWMsQ0FBQyxTQUFTLElBQUksV0FBVyxLQUFLLG9CQUFvQixJQUFJLE1BQU0sU0FBUyxRQUFRLE1BQU07QUFBQSxVQUNqRyxjQUFjLENBQUMsU0FBUyxPQUFPO0FBQzdCLGdCQUFJLFlBQVksS0FBTSxNQUFLLG9CQUFvQixJQUFJLE1BQU0sT0FBTztBQUFBLFVBQ2xFO0FBQUEsVUFDQSxlQUFlLE9BQU8sVUFBVTtBQUM5Qiw0QkFBZ0IsS0FBSyxPQUFPLFVBQVUsTUFBTSxLQUFLO0FBQ2pELGtCQUFNLEtBQUssT0FBTyxhQUFhO0FBQy9CLGlCQUFLLE9BQU87QUFBQSxVQUNkO0FBQUEsVUFDQSxzQkFBc0IsQ0FBQyxZQUFZLEtBQUssa0JBQWtCLE1BQU0sT0FBTztBQUFBLFFBQ3pFLENBQUM7QUFDRCxhQUFLLG1CQUFtQixLQUFLLEdBQUcsS0FBSyxrQkFBa0IsT0FBTztBQUk5RCxhQUFLLGtCQUFrQixLQUFLLFNBQVMsVUFBVSxFQUFFLEtBQUssK0JBQStCLENBQUM7QUFDdEYsZ0JBQVEsS0FBSyxnQkFBZ0IsV0FBVyxFQUFFLEtBQUssNEJBQTRCLENBQUMsR0FBRyxNQUFNO0FBQ3JGLGFBQUssZ0JBQWdCLFdBQVcsRUFBRSxNQUFNLHVCQUFvQixDQUFDO0FBQzdELGFBQUssZ0JBQWdCLGlCQUFpQixTQUFTLE1BQU0sS0FBSyxnQkFBZ0IsSUFBSSxDQUFDO0FBRS9FLGFBQUssMkJBQTJCLE1BQU0sTUFBTSxNQUFNO0FBRWxELGFBQUssVUFBVSxFQUFFLEtBQUssNEJBQTRCLENBQUM7QUFDbkQsYUFBSyxtQkFBbUIsSUFBSTtBQU81QixhQUFLLE9BQU8sOEJBQThCO0FBQUEsTUFDNUM7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFPQSxvQkFBb0IsSUFBSSxNQUFNLFNBQVMsUUFBUSxRQUFRO0FBQ3JELGNBQU0sYUFBYSxHQUFHLFVBQVUsRUFBRSxLQUFLLG1DQUFtQyxDQUFDO0FBSTNFLGNBQU0sVUFBVSxXQUFXLFVBQVUsRUFBRSxLQUFLLGlDQUFpQyxNQUFNLFdBQVcsR0FBRyxJQUFJLGVBQWUsQ0FBQztBQUNySCxjQUFNLFFBQVEsWUFBWSxPQUFPLE9BQU8sWUFBWSxPQUFPLE9BQU8sSUFBSSxPQUFPLEtBQUs7QUFDbEYsbUJBQVcsV0FBVyxFQUFFLEtBQUssMEJBQTBCLE1BQU0sT0FBTyxLQUFLLEVBQUUsQ0FBQztBQUk1RSxZQUFJLFlBQVksTUFBTTtBQUNwQixrQkFBUSxpQkFBaUIsZUFBZSxDQUFDLFVBQVU7QUFDakQsa0JBQU0sZUFBZTtBQUNyQixpQkFBSyxrQkFBa0IsTUFBTSxJQUFJO0FBQUEsVUFDbkMsQ0FBQztBQUFBLFFBQ0g7QUFNQSxjQUFNLGFBQWEsR0FBRyxVQUFVLEVBQUUsS0FBSyxpQ0FBaUMsQ0FBQztBQVV6RSxjQUFNLHlCQUF5QixXQUFXLFVBQVU7QUFBQSxVQUNsRCxLQUFLO0FBQUEsVUFDTCxNQUFNLEVBQUUsY0FBYyxrQ0FBK0I7QUFBQSxRQUN2RCxDQUFDO0FBQ0QsZ0JBQVEsd0JBQXdCLE1BQU07QUFDdEMsK0JBQXVCLGlCQUFpQixTQUFTLE1BQU0sT0FBTyxTQUFTLFNBQVMsSUFBSSxDQUFDO0FBRXJGLGNBQU0saUJBQWlCLFdBQVcsVUFBVTtBQUFBLFVBQzFDLEtBQUs7QUFBQSxVQUNMLE1BQU0sRUFBRSxjQUFjLHlCQUFzQjtBQUFBLFFBQzlDLENBQUM7QUFDRCxnQkFBUSxnQkFBZ0IsTUFBTTtBQUM5Qix1QkFBZSxpQkFBaUIsU0FBUyxNQUFNLE9BQU8sU0FBUyxTQUFTLEtBQUssQ0FBQztBQUFBLE1BQ2hGO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BT0Esb0JBQW9CLElBQUksTUFBTSxTQUFTO0FBQ3JDLFdBQUcsU0FBUywwQkFBMEI7QUFDdEMsY0FBTSxhQUFhLEdBQUcsVUFBVSxFQUFFLEtBQUssK0JBQStCLENBQUM7QUFHdkUsY0FBTSxXQUFXLG1CQUFtQixLQUFLLE9BQU8sVUFBVSxNQUFNLE9BQU87QUFDdkUsY0FBTSxlQUFlLENBQUMsQ0FBQyxLQUFLLE9BQU8sU0FBUyxXQUFXLElBQUk7QUFDM0QsY0FBTSxXQUFXLFdBQVcsVUFBVTtBQUFBLFVBQ3BDLEtBQUs7QUFBQSxVQUNMLE1BQU0sRUFBRSxjQUFjLENBQUMsZUFBZSx3QkFBd0IsV0FBVyxtQkFBbUIseUJBQXNCO0FBQUEsUUFDcEgsQ0FBQztBQUNELGlCQUFTLGNBQWM7QUFDdkIsc0JBQWMsVUFBVSxhQUFhLEtBQUssT0FBTyxVQUFVLE1BQU0sT0FBTyxLQUFLLG9CQUFvQixDQUFDLFlBQVksQ0FBQyxZQUFZO0FBQzNILGlCQUFTLGlCQUFpQixTQUFTLE1BQU0sS0FBSyx3QkFBd0IsVUFBVSxNQUFNLE9BQU8sQ0FBQztBQUM5RixjQUFNLFdBQVcsV0FBVyxVQUFVLEVBQUUsS0FBSyx1Q0FBdUMsTUFBTSxFQUFFLGNBQWMsd0JBQXFCLEVBQUUsQ0FBQztBQUNsSSxpQkFBUyxZQUFZLGVBQWUsQ0FBQyxRQUFRO0FBQzdDLGdCQUFRLFVBQVUsWUFBWTtBQUM5QixpQkFBUyxpQkFBaUIsU0FBUyxZQUFZO0FBQzdDLGdCQUFNLE9BQU9DLFlBQVcsS0FBSyxPQUFPLFVBQVUsTUFBTSxPQUFPO0FBQzNELGNBQUksQ0FBQyxNQUFNLE1BQU87QUFDbEIsaUJBQU8sS0FBSztBQUNaLGdCQUFNLEtBQUssT0FBTyxhQUFhO0FBQy9CLGVBQUssT0FBTyxtQkFBbUI7QUFDL0IsZUFBSyxPQUFPO0FBQUEsUUFDZCxDQUFDO0FBRUQsY0FBTSxVQUFVLEdBQUcsVUFBVSxFQUFFLEtBQUssZ0NBQWdDLENBQUM7QUFDckUsY0FBTSxVQUFVLE1BQU07QUFDcEIsY0FBSSxVQUFVLEdBQUc7QUFDakIsaUJBQU8sV0FBVyxDQUFDLFFBQVEsU0FBUyx5QkFBeUIsRUFBRyxXQUFVLFFBQVE7QUFDbEYsaUJBQU8sU0FBUyxjQUFjLGdDQUFnQyxLQUFLO0FBQUEsUUFDckU7QUFDQSxjQUFNLFNBQVMsQ0FBQyxnQkFBZ0I7QUFDOUIsZ0JBQU0sU0FBUyxRQUFRO0FBQ3ZCLGNBQUksT0FBUSxNQUFLLG1CQUFtQixNQUFNLFNBQVMsUUFBUSxFQUFFLFlBQVksQ0FBQztBQUFBLFFBQzVFO0FBRUEsY0FBTSxxQkFBcUIsUUFBUSxVQUFVO0FBQUEsVUFDM0MsS0FBSztBQUFBLFVBQ0wsTUFBTSxFQUFFLGNBQWMsc0NBQXNDO0FBQUEsUUFDOUQsQ0FBQztBQUNELGdCQUFRLG9CQUFvQixRQUFRO0FBQ3BDLDJCQUFtQixpQkFBaUIsU0FBUyxNQUFNLE9BQU8sSUFBSSxDQUFDO0FBRS9ELGNBQU0sWUFBWSxRQUFRLFVBQVUsRUFBRSxLQUFLLHlDQUF5QyxNQUFNLEVBQUUsY0FBYyxhQUFhLEVBQUUsQ0FBQztBQUMxSCxnQkFBUSxXQUFXLFFBQVE7QUFDM0Isa0JBQVUsaUJBQWlCLFNBQVMsTUFBTSxPQUFPLEtBQUssQ0FBQztBQUV2RCxjQUFNLFlBQVksUUFBUSxVQUFVLEVBQUUsS0FBSyx5Q0FBeUMsTUFBTSxFQUFFLGNBQWMsYUFBVSxFQUFFLENBQUM7QUFDdkgsZ0JBQVEsV0FBVyxPQUFPO0FBQzFCLGtCQUFVLGlCQUFpQixTQUFTLE1BQU0sS0FBSyx5QkFBeUIsTUFBTSxPQUFPLENBQUM7QUFBQSxNQUN4RjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFTQSx3QkFBd0IsVUFBVSxNQUFNLFNBQVM7QUFDL0MsYUFBSywyQkFBMkI7QUFDaEMsY0FBTSxFQUFFLFNBQVMsSUFBSSxLQUFLO0FBQzFCLGNBQU0sT0FBT0EsWUFBVyxVQUFVLE1BQU0sT0FBTztBQUMvQyxZQUFJLENBQUMsS0FBTTtBQUNYLGNBQU0sWUFBWSxTQUFTLFdBQVcsSUFBSSxLQUFLO0FBRy9DLGNBQU0sU0FBUyxjQUFjLFVBQVUsS0FBSyxLQUFLLEtBQUssT0FBTyxZQUFZLHVCQUF1QixJQUFJLENBQUMsRUFBRSxJQUFJLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO0FBQzFILGNBQU0sTUFBTSxTQUFTO0FBQ3JCLGNBQU0sVUFBVSxJQUFJLEtBQUssVUFBVSxFQUFFLEtBQUssc0NBQXNDLENBQUM7QUFFakYsY0FBTSxPQUFPLENBQUM7QUFDZCxjQUFNLFNBQVMsTUFBTTtBQUNuQixnQkFBTSxRQUFRLGlCQUFpQixXQUFXLE1BQU07QUFDaEQscUJBQVcsTUFBTSxLQUFLLFVBQVUsaUJBQWlCLDZCQUE2QixHQUFHO0FBQy9FLGdCQUFJLEdBQUcsZ0JBQWdCLFFBQVMsZUFBYyxJQUFJLE9BQU8sQ0FBQyxlQUFlLE1BQU0sS0FBSyxDQUFDLFNBQVMsV0FBVyxJQUFJLENBQUM7QUFBQSxVQUNoSDtBQUNBLHFCQUFXLE9BQU8sS0FBTSxLQUFJO0FBQUEsUUFDOUI7QUFFQSxtQkFBVyxFQUFFLEtBQUssT0FBTyxLQUFLLEtBQUssd0JBQXdCO0FBQ3pELGdCQUFNLENBQUMsS0FBSyxHQUFHLElBQUksY0FBYyxVQUFVLEdBQUc7QUFDOUMsZ0JBQU0sTUFBTSxRQUFRLFVBQVUsRUFBRSxLQUFLLDZCQUE2QixDQUFDO0FBQ25FLGNBQUksV0FBVyxFQUFFLEtBQUssZ0NBQWdDLE1BQU0sTUFBTSxDQUFDO0FBQ25FLGdCQUFNLFFBQVEsSUFBSSxTQUFTLFNBQVMsRUFBRSxNQUFNLFNBQVMsS0FBSyx1Q0FBdUMsQ0FBQztBQUNsRyxnQkFBTSxNQUFNLE9BQU8sR0FBRztBQUN0QixnQkFBTSxNQUFNLE9BQU8sR0FBRztBQUN0QixnQkFBTSxPQUFPO0FBQ2IsZ0JBQU0sUUFBUSxPQUFPLE9BQU8sR0FBRyxDQUFDO0FBQ2hDLGdCQUFNLFdBQVcsUUFBUTtBQUN6QixnQkFBTSxVQUFVLElBQUksV0FBVyxFQUFFLEtBQUssK0JBQStCLENBQUM7QUFDdEUsZ0JBQU0saUJBQWlCLFNBQVMsTUFBTTtBQUNwQyxtQkFBTyxHQUFHLElBQUksT0FBTyxNQUFNLEtBQUs7QUFDaEMsbUJBQU87QUFBQSxVQUNULENBQUM7QUFDRCxlQUFLLEtBQUssTUFBTTtBQUNkLGtCQUFNLFFBQVE7QUFDZCxrQkFBTSxRQUFRLENBQUM7QUFDZixxQkFBUyxJQUFJLEdBQUcsS0FBSyxPQUFPLEtBQUs7QUFDL0Isb0JBQU0sS0FBSyxpQkFBaUIsV0FBVyxFQUFFLEdBQUcsUUFBUSxDQUFDLEdBQUcsR0FBRyxPQUFRLE1BQU0sT0FBTyxJQUFLLE1BQU0sQ0FBQyxDQUFDO0FBQUEsWUFDL0Y7QUFDQSxrQkFBTSxNQUFNLFlBQVksZ0JBQWdCLDZCQUE2QixNQUFNLEtBQUssSUFBSSxDQUFDLEdBQUc7QUFDeEYsb0JBQVEsUUFBUSxHQUFHLE9BQU8sR0FBRyxJQUFJLElBQUksTUFBTSxFQUFFLEdBQUcsT0FBTyxHQUFHLENBQUMsR0FBRyxJQUFJLEVBQUU7QUFBQSxVQUN0RSxDQUFDO0FBQUEsUUFDSDtBQUNBLGVBQU87QUFHUCxjQUFNLE9BQU8sU0FBUyxzQkFBc0I7QUFDNUMsY0FBTSxNQUFNLElBQUk7QUFDaEIsY0FBTSxRQUFRLFFBQVE7QUFDdEIsY0FBTSxTQUFTLFFBQVE7QUFDdkIsZ0JBQVEsTUFBTSxPQUFPLEdBQUcsS0FBSyxJQUFJLEdBQUcsS0FBSyxJQUFJLEtBQUssTUFBTSxJQUFJLGFBQWEsUUFBUSxDQUFDLENBQUMsQ0FBQztBQUNwRixnQkFBUSxNQUFNLE1BQU0sR0FBRyxLQUFLLFNBQVMsSUFBSSxTQUFTLElBQUksY0FBYyxJQUFJLEtBQUssTUFBTSxJQUFJLFNBQVMsS0FBSyxTQUFTLENBQUM7QUFFL0csY0FBTSxnQkFBZ0IsQ0FBQyxVQUFVO0FBQy9CLGNBQUksQ0FBQyxRQUFRLFNBQVMsTUFBTSxNQUFNLEVBQUcsT0FBTTtBQUFBLFFBQzdDO0FBQ0EsY0FBTSxZQUFZLENBQUMsVUFBVTtBQUMzQixjQUFJLE1BQU0sUUFBUSxTQUFVO0FBQzVCLGdCQUFNLGVBQWU7QUFDckIsZ0JBQU0sZ0JBQWdCO0FBQ3RCLGdCQUFNO0FBQUEsUUFDUjtBQUNBLGNBQU0sUUFBUSxZQUFZO0FBQ3hCLGVBQUssMkJBQTJCO0FBQ2hDLGNBQUksb0JBQW9CLGFBQWEsZUFBZSxJQUFJO0FBQ3hELGNBQUksb0JBQW9CLFdBQVcsV0FBVyxJQUFJO0FBQ2xELGtCQUFRLE9BQU87QUFDZixnQkFBTSxVQUFVQSxZQUFXLFVBQVUsTUFBTSxPQUFPO0FBQ2xELGNBQUksQ0FBQyxRQUFTO0FBQ2QsY0FBSSxlQUFlLE1BQU0sRUFBRyxTQUFRLFFBQVEsRUFBRSxHQUFHLE9BQU87QUFBQSxjQUNuRCxRQUFPLFFBQVE7QUFDcEIsZ0JBQU0sS0FBSyxPQUFPLGFBQWE7QUFDL0IsZUFBSyxPQUFPLG1CQUFtQjtBQUMvQixlQUFLLE9BQU87QUFBQSxRQUNkO0FBQ0EsYUFBSywyQkFBMkI7QUFDaEMsWUFBSSxpQkFBaUIsYUFBYSxlQUFlLElBQUk7QUFDckQsWUFBSSxpQkFBaUIsV0FBVyxXQUFXLElBQUk7QUFBQSxNQUNqRDtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BS0EseUJBQXlCLE1BQU0sU0FBUztBQUN0QyxjQUFNLFFBQVEsWUFBWTtBQUN4Qix3QkFBYyxLQUFLLE9BQU8sVUFBVSxNQUFNLE9BQU87QUFDakQsZ0JBQU0sS0FBSyxPQUFPLGFBQWE7QUFDL0IsZUFBSyxPQUFPLG1CQUFtQjtBQUMvQixlQUFLLE9BQU87QUFBQSxRQUNkO0FBQ0EsY0FBTSxPQUFPLE9BQU8sS0FBS0EsWUFBVyxLQUFLLE9BQU8sVUFBVSxNQUFNLE9BQU8sR0FBRyxlQUFlLENBQUMsQ0FBQyxFQUFFLE9BQU8sQ0FBQyxRQUFRLFFBQVEsRUFBRTtBQUN2SCxZQUFJLEtBQUssV0FBVyxHQUFHO0FBQ3JCLGdCQUFNO0FBQ047QUFBQSxRQUNGO0FBQ0EsWUFBSSxvQkFBb0IsS0FBSyxLQUFLO0FBQUEsVUFDaEMsWUFBWTtBQUFBLFlBQ1YsVUFBVSxPQUFPLFFBQVEsSUFBSTtBQUFBLFlBQzdCLEdBQUcsS0FBSyxXQUFXLElBQUksaUJBQWlCLE9BQU8sS0FBSyxNQUFNLGFBQWEsSUFBSSxLQUFLLEtBQUssSUFBSSxDQUFDLElBQUksS0FBSyxXQUFXLElBQUksU0FBUyxPQUFPO0FBQUEsVUFDcEk7QUFBQSxVQUNBLGFBQWE7QUFBQSxVQUNiLFlBQVk7QUFBQSxVQUNaLFdBQVc7QUFBQSxRQUNiLENBQUMsRUFBRSxLQUFLO0FBQUEsTUFDVjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFNQSxtQkFBbUIsTUFBTSxTQUFTLFNBQVMsRUFBRSxjQUFjLE1BQU0sSUFBSSxDQUFDLEdBQUc7QUFDdkUsWUFBSSxLQUFLLFVBQVc7QUFDcEIsYUFBSyxZQUFZO0FBRWpCLGdCQUFRLFNBQVMsK0JBQStCLGtCQUFrQjtBQUNsRSxnQkFBUSxhQUFhLG1CQUFtQixNQUFNO0FBQzlDLGdCQUFRLGFBQWEsY0FBYyxPQUFPO0FBQzFDLGdCQUFRLE1BQU07QUFFZCxjQUFNLFFBQVEsUUFBUSxJQUFJLFlBQVk7QUFDdEMsY0FBTSxtQkFBbUIsT0FBTztBQUNoQyxjQUFNLFlBQVksUUFBUSxJQUFJLGFBQWE7QUFDM0Msa0JBQVUsZ0JBQWdCO0FBQzFCLGtCQUFVLFNBQVMsS0FBSztBQUV4QixjQUFNLFVBQVUsQ0FBQyxTQUFTLEtBQUssT0FBTyxTQUFTLGNBQWMsSUFBSSxFQUFFLE9BQU8sSUFBSSxJQUFJLEtBQUs7QUFDdkYsY0FBTSxjQUFjLE9BQU8sT0FBTyxFQUFFLFVBQVUsTUFBTTtBQUNsRCx3QkFBYyxLQUFLLE9BQU8sVUFBVSxNQUFNLFNBQVMsS0FBSztBQUN4RCxnQkFBTSxLQUFLLE9BQU8sYUFBYTtBQUMvQixnQkFBTSxVQUFVLFlBQVksTUFBTSxxQkFBcUIsS0FBSyxRQUFRLE1BQU0sU0FBUyxLQUFLLElBQUk7QUFDNUYsZUFBSyxPQUFPLG1CQUFtQjtBQUMvQixjQUFJLFVBQVcsS0FBSSxPQUFPLFVBQVUsS0FBSyxLQUFLLE9BQU8sdUJBQXVCO0FBQzVFLGVBQUssT0FBTztBQUFBLFFBQ2Q7QUFFQSxZQUFJLE9BQU87QUFDWCxjQUFNLFNBQVMsT0FBTyxXQUFXO0FBQy9CLGNBQUksS0FBTTtBQUNWLGlCQUFPO0FBQ1AsZUFBSyxZQUFZO0FBRWpCLGdCQUFNLFFBQVEscUJBQXFCLFFBQVEsV0FBVztBQUN0RCxjQUFJLENBQUMsVUFBVSxDQUFDLFNBQVMsVUFBVSxTQUFTO0FBQzFDLGlCQUFLLE9BQU87QUFDWjtBQUFBLFVBQ0Y7QUFFQSxnQkFBTSxXQUFXRCxpQkFBZ0IsS0FBSyxPQUFPLFVBQVUsSUFBSSxFQUFFO0FBQUEsWUFDM0QsQ0FBQyxTQUFTLEtBQUssWUFBWSxNQUFNLE1BQU0sWUFBWSxLQUFLLFNBQVM7QUFBQSxVQUNuRTtBQUNBLGNBQUksVUFBVTtBQUNaLGdCQUFJLG9CQUFvQixLQUFLLEtBQUs7QUFBQSxjQUNoQyxZQUFZO0FBQUEsZ0JBQ1YsVUFBVSxRQUFRLGtCQUFrQixJQUFJLGFBQWEsT0FBTztBQUFBLGdCQUM1RCxHQUFHLFFBQVEsT0FBTyxDQUFDLHlCQUF5QixRQUFRLG1DQUFtQyxPQUFPLHlCQUF5QixRQUFRO0FBQUEsY0FDakk7QUFBQSxjQUNBLGFBQWE7QUFBQSxjQUNiLFlBQVk7QUFBQSxjQUNaLFdBQVcsWUFBWTtBQUNyQiw4QkFBYyxLQUFLLE9BQU8sVUFBVSxNQUFNLFNBQVMsUUFBUTtBQUMzRCxzQkFBTSxLQUFLLE9BQU8sYUFBYTtBQUMvQixzQkFBTSxVQUFVLE1BQU0scUJBQXFCLEtBQUssUUFBUSxNQUFNLFNBQVMsUUFBUTtBQUMvRSxxQkFBSyxPQUFPLG1CQUFtQjtBQUMvQixvQkFBSSxPQUFPLFVBQVUsT0FBTyxRQUFRLFFBQVEsb0JBQW9CLE9BQU8sdUJBQXVCO0FBQzlGLHFCQUFLLE9BQU87QUFBQSxjQUNkO0FBQUEsY0FDQSxVQUFVLE1BQU0sS0FBSyxPQUFPO0FBQUEsWUFDOUIsQ0FBQyxFQUFFLEtBQUs7QUFDUjtBQUFBLFVBQ0Y7QUFFQSxjQUFJLENBQUMsYUFBYTtBQUNoQixrQkFBTSxZQUFZLE9BQU8sRUFBRSxXQUFXLE1BQU0sQ0FBQztBQUM3QztBQUFBLFVBQ0Y7QUFDQSxjQUFJLG9CQUFvQixLQUFLLEtBQUs7QUFBQSxZQUNoQyxZQUFZLENBQUMsVUFBVSxPQUFPLE9BQU8sS0FBSyxtQkFBbUIsUUFBUSxPQUFPLENBQUMsbUNBQW1DO0FBQUEsWUFDaEgsYUFBYTtBQUFBLFlBQ2IsWUFBWTtBQUFBLFlBQ1osV0FBVyxNQUFNLFlBQVksT0FBTyxFQUFFLFdBQVcsS0FBSyxDQUFDO0FBQUEsWUFDdkQsVUFBVSxNQUFNLEtBQUssT0FBTztBQUFBLFVBQzlCLENBQUMsRUFBRSxLQUFLO0FBQUEsUUFDVjtBQUtBLGdCQUFRLGlCQUFpQixXQUFXLENBQUMsVUFBVTtBQUM3QyxnQkFBTSxnQkFBZ0I7QUFDdEIsY0FBSSxNQUFNLFFBQVEsU0FBUztBQUN6QixrQkFBTSxlQUFlO0FBQ3JCLG1CQUFPLElBQUk7QUFBQSxVQUNiLFdBQVcsTUFBTSxRQUFRLFVBQVU7QUFDakMsa0JBQU0sZUFBZTtBQUNyQixtQkFBTyxLQUFLO0FBQUEsVUFDZDtBQUFBLFFBQ0YsQ0FBQztBQUNELGdCQUFRLGlCQUFpQixRQUFRLE1BQU0sT0FBTyxJQUFJLENBQUM7QUFBQSxNQUNyRDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQU9BLDJCQUEyQixRQUFRLE1BQU0sUUFBUTtBQUMvQyxjQUFNLGFBQWFBLGlCQUFnQixLQUFLLE9BQU8sVUFBVSxJQUFJO0FBQzdELGNBQU0sZUFBZSxDQUFDLEdBQUcsT0FBTyxPQUFPLEtBQUssQ0FBQyxFQUMxQyxPQUFPLENBQUMsUUFBUSxDQUFDLFdBQVcsU0FBUyxHQUFHLENBQUMsRUFDekMsS0FBSyxDQUFDLEdBQUcsTUFBTSxPQUFPLE9BQU8sSUFBSSxDQUFDLElBQUksT0FBTyxPQUFPLElBQUksQ0FBQyxLQUFLLEVBQUUsY0FBYyxDQUFDLENBQUM7QUFDbkYsWUFBSSxhQUFhLFdBQVcsRUFBRztBQUUvQixjQUFNLFNBQVMsT0FBTyxVQUFVLEVBQUUsS0FBSyxxQ0FBcUMsQ0FBQztBQUM3RSxtQkFBVyxPQUFPLGNBQWM7QUFDOUIsZ0JBQU0sUUFBUSxPQUFPLFVBQVUsRUFBRSxLQUFLLGtGQUFrRixDQUFDO0FBQ3pILGdCQUFNLFNBQVMsTUFBTSxVQUFVLEVBQUUsS0FBSyw4QkFBOEIsQ0FBQztBQUNyRSxnQkFBTSxhQUFhLE9BQU8sVUFBVSxFQUFFLEtBQUssbUNBQW1DLENBQUM7QUFDL0UscUJBQVcsVUFBVSxFQUFFLEtBQUssaUNBQWlDLE1BQU0sZUFBZSxHQUFHLEVBQUUsQ0FBQztBQUN4RixxQkFBVyxXQUFXLEVBQUUsS0FBSywwQkFBMEIsTUFBTSxPQUFPLE9BQU8sT0FBTyxJQUFJLEdBQUcsQ0FBQyxFQUFFLENBQUM7QUFDN0YsZ0JBQU0saUJBQWlCLFNBQVMsTUFBTSxLQUFLLGdCQUFnQixNQUFNLEtBQUssTUFBTSxDQUFDO0FBQzdFLGdCQUFNLGlCQUFpQixlQUFlLENBQUMsVUFBVTtBQUMvQyxrQkFBTSxlQUFlO0FBQ3JCLGtCQUFNLGdCQUFnQjtBQUN0QixpQkFBSyxrQkFBa0IsTUFBTSxHQUFHO0FBQUEsVUFDbEMsQ0FBQztBQUFBLFFBQ0g7QUFBQSxNQUNGO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFLQSxrQkFBa0IsTUFBTSxZQUFZO0FBQ2xDLGNBQU0sZUFBZSxLQUFLLE9BQU8sSUFBSSxnQkFBZ0IsY0FBYyxlQUFlO0FBQ2xGLFlBQUksQ0FBQyxhQUFjO0FBQ25CLGNBQU0sWUFBWSxLQUFLLFdBQVcsSUFBSTtBQUN0QyxZQUFJO0FBQ0osWUFBSSxlQUFlLE1BQU07QUFDdkIseUJBQWUsTUFBTUssZ0JBQWU7QUFBQSxRQUN0QyxPQUFPO0FBQ0wsZ0JBQU0sTUFBTSxLQUFLLE9BQU8sU0FBUyxjQUFjLElBQUksRUFBRSxTQUFTLElBQUksVUFBVTtBQUM1RSx5QkFBZSxNQUFNLFFBQVEsR0FBRyxJQUM1QixJQUFJLElBQUksQ0FBQyxNQUFNLEtBQUtBLGdCQUFlLE1BQU0sT0FBTyxLQUFLLEVBQUUsRUFBRSxLQUFLLENBQUMsSUFBSSxFQUFFLEtBQUssR0FBRyxJQUM3RSxLQUFLQSxnQkFBZSxNQUFNLFVBQVU7QUFBQSxRQUMxQztBQUNBLHFCQUFhLFNBQVMsaUJBQWlCLEdBQUcsU0FBUyxJQUFJLFlBQVksRUFBRTtBQUFBLE1BQ3ZFO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQU1BLE1BQU0sZ0JBQWdCLE1BQU0sWUFBWSxRQUFRO0FBQzlDLGNBQU0sU0FBUyxNQUFNLEtBQUsseUJBQXlCLE1BQU0sWUFBWSxNQUFNO0FBQzNFLFlBQUksQ0FBQyxPQUFRO0FBRWIsY0FBTSxLQUFLLE9BQU8sYUFBYTtBQUMvQixhQUFLLE9BQU8sbUJBQW1CO0FBQy9CLFlBQUksT0FBTyxVQUFVLEVBQUcsS0FBSSxPQUFPLFVBQVUsT0FBTyxPQUFPLGlCQUFpQixPQUFPLE9BQU8sdUJBQXVCO0FBQUEsTUFDbkg7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQUtBLE1BQU0seUJBQXlCLE1BQU0sWUFBWSxRQUFRO0FBQ3ZELGNBQU0sTUFBTSxPQUFPLFNBQVMsSUFBSSxVQUFVO0FBQzFDLGNBQU0sYUFBYSxpQkFBaUIsUUFBUSxTQUFZLGFBQWEsS0FBSyxvQkFBb0I7QUFDOUYsWUFBSSxDQUFDLFdBQVksUUFBTztBQUN4QixjQUFNLFdBQVdMLGlCQUFnQixLQUFLLE9BQU8sVUFBVSxJQUFJLEVBQUUsS0FBSyxDQUFDLFNBQVMsS0FBSyxZQUFZLE1BQU0sV0FBVyxZQUFZLENBQUM7QUFDM0gsY0FBTSxVQUFVLFlBQVk7QUFDNUIsc0JBQWMsS0FBSyxPQUFPLFVBQVUsTUFBTSxPQUFPO0FBRWpELGNBQU0sVUFBVSxZQUFZLGFBQWEsTUFBTSxxQkFBcUIsS0FBSyxRQUFRLE1BQU0sWUFBWSxPQUFPLElBQUk7QUFDOUcsZUFBTyxFQUFFLFNBQVMsUUFBUTtBQUFBLE1BQzVCO0FBQUE7QUFBQTtBQUFBLE1BSUEsZ0JBQWdCLE1BQU07QUFDcEIsWUFBSSxLQUFLLGFBQWEsQ0FBQyxLQUFLLGdCQUFpQjtBQUM3QyxhQUFLLFlBQVk7QUFNakIsY0FBTSxRQUFRLFVBQVUsRUFBRSxLQUFLLDZFQUE2RSxDQUFDO0FBQzdHLGFBQUssZ0JBQWdCLGNBQWMsYUFBYSxPQUFPLEtBQUssZUFBZTtBQUMzRSxjQUFNLFNBQVMsTUFBTSxVQUFVLEVBQUUsS0FBSyw4QkFBOEIsQ0FBQztBQUNyRSxjQUFNLGFBQWEsT0FBTyxVQUFVLEVBQUUsS0FBSyxtQ0FBbUMsQ0FBQztBQUMvRSxjQUFNLFNBQVMsV0FBVyxVQUFVLEVBQUUsS0FBSyw2RUFBNkUsQ0FBQztBQUN6SCxjQUFNLGFBQWEsT0FBTyxVQUFVLEVBQUUsS0FBSyxpQ0FBaUMsQ0FBQztBQUM3RSxnQkFBUSxXQUFXLFVBQVUsRUFBRSxLQUFLLG1EQUFtRCxDQUFDLEdBQUcsTUFBTTtBQUNqRyxnQkFBUSxXQUFXLFVBQVUsRUFBRSxLQUFLLDBDQUEwQyxDQUFDLEdBQUcsTUFBTTtBQUN4RixjQUFNLFNBQVMsTUFBTSxVQUFVLEVBQUUsS0FBSyxtREFBbUQsQ0FBQztBQUMxRixjQUFNLGFBQWEsT0FBTyxVQUFVLEVBQUUsS0FBSywrQkFBK0IsQ0FBQztBQUMzRSxzQkFBYyxXQUFXLFVBQVUsRUFBRSxLQUFLLDZCQUE2QixDQUFDLEdBQUcsS0FBSyxPQUFPLFNBQVMsV0FBVyxJQUFJLEtBQUssb0JBQW9CLElBQUk7QUFDNUksZ0JBQVEsV0FBVyxVQUFVLEVBQUUsS0FBSyxrREFBa0QsQ0FBQyxHQUFHLFlBQVk7QUFDdEcsY0FBTSxVQUFVLE9BQU8sVUFBVSxFQUFFLEtBQUssZ0NBQWdDLENBQUM7QUFDekUsZ0JBQVEsUUFBUSxVQUFVLEVBQUUsS0FBSyw4Q0FBOEMsQ0FBQyxHQUFHLFFBQVE7QUFDM0YsZ0JBQVEsUUFBUSxVQUFVLEVBQUUsS0FBSyx3Q0FBd0MsQ0FBQyxHQUFHLFFBQVE7QUFDckYsZ0JBQVEsUUFBUSxVQUFVLEVBQUUsS0FBSyx3Q0FBd0MsQ0FBQyxHQUFHLE9BQU87QUFDcEYsZUFBTyxhQUFhLG1CQUFtQixNQUFNO0FBQzdDLGVBQU8sYUFBYSxjQUFjLE9BQU87QUFDekMsZUFBTyxNQUFNO0FBRWIsWUFBSSxPQUFPO0FBQ1gsY0FBTSxTQUFTLE9BQU8sV0FBVztBQUMvQixjQUFJLEtBQU07QUFDVixpQkFBTztBQUNQLGVBQUssWUFBWTtBQUVqQixnQkFBTSxRQUFRLHFCQUFxQixPQUFPLFdBQVc7QUFDckQsY0FBSSxVQUFVLE9BQU87QUFDbkIsa0JBQU0sV0FBV0EsaUJBQWdCLEtBQUssT0FBTyxVQUFVLElBQUksRUFBRSxLQUFLLENBQUMsU0FBUyxLQUFLLFlBQVksTUFBTSxNQUFNLFlBQVksQ0FBQztBQUN0SCxnQkFBSSxVQUFVO0FBQ1osa0JBQUksT0FBTyxVQUFVLFFBQVEsZ0JBQWdCLElBQUksV0FBVztBQUFBLFlBQzlELE9BQU87QUFDTCw0QkFBYyxLQUFLLE9BQU8sVUFBVSxNQUFNLEtBQUs7QUFDL0Msb0JBQU0sS0FBSyxPQUFPLGFBQWE7QUFBQSxZQUNqQztBQUFBLFVBQ0Y7QUFDQSxlQUFLLE9BQU87QUFBQSxRQUNkO0FBRUEsZUFBTyxpQkFBaUIsV0FBVyxDQUFDLFVBQVU7QUFDNUMsY0FBSSxNQUFNLFFBQVEsU0FBUztBQUN6QixrQkFBTSxlQUFlO0FBQ3JCLGtCQUFNLGdCQUFnQjtBQUN0QixtQkFBTyxJQUFJO0FBQUEsVUFDYixXQUFXLE1BQU0sUUFBUSxVQUFVO0FBR2pDLGtCQUFNLGVBQWU7QUFDckIsa0JBQU0sZ0JBQWdCO0FBQ3RCLG1CQUFPLEtBQUs7QUFBQSxVQUNkO0FBQUEsUUFDRixDQUFDO0FBQ0QsZUFBTyxpQkFBaUIsUUFBUSxNQUFNLE9BQU8sSUFBSSxDQUFDO0FBQUEsTUFDcEQ7QUFBQSxNQUVBLGtCQUFrQixNQUFNO0FBQ3RCLFlBQUksdUJBQXVCLEtBQUssUUFBUSxNQUFNLFlBQVk7QUFDeEQsZUFBSyxPQUFPLFNBQVMsUUFBUSxLQUFLLE9BQU8sU0FBUyxNQUFNLE9BQU8sQ0FBQyxNQUFNLE1BQU0sSUFBSTtBQUNoRixpQkFBTyxLQUFLLE9BQU8sU0FBUyxXQUFXLElBQUk7QUFDM0MsaUJBQU8sS0FBSyxPQUFPLFNBQVMsaUJBQWlCLElBQUk7QUFDakQsaUJBQU8sS0FBSyxPQUFPLFNBQVMsdUJBQXVCLElBQUk7QUFDdkQsaUJBQU8sS0FBSyxPQUFPLFNBQVMsaUJBQWlCLElBQUk7QUFDakQsaUJBQU8sS0FBSyxPQUFPLFNBQVMsY0FBYyxJQUFJO0FBQzlDLGlCQUFPLEtBQUssaUJBQWlCLEVBQUUsSUFBSTtBQUNuQyw2QkFBbUIsS0FBSyxPQUFPLFVBQVUsSUFBSTtBQUs3QyxlQUFLLGtCQUFrQjtBQUN2QixnQkFBTSxLQUFLLE9BQU8sYUFBYTtBQUMvQixlQUFLLE9BQU8sbUJBQW1CO0FBQUEsUUFDakMsQ0FBQyxFQUFFLEtBQUs7QUFBQSxNQUNWO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFRQSxrQkFBa0IsTUFBTSxTQUFTLEVBQUUsY0FBYyxNQUFNLElBQUksQ0FBQyxHQUFHO0FBQzdELFlBQUksS0FBSyxVQUFXO0FBQ3BCLGFBQUssWUFBWTtBQUVqQixnQkFBUSxTQUFTLGtCQUFrQjtBQUNuQyxnQkFBUSxhQUFhLG1CQUFtQixNQUFNO0FBQzlDLGdCQUFRLGFBQWEsY0FBYyxPQUFPO0FBQzFDLGdCQUFRLE1BQU07QUFFZCxjQUFNLFFBQVEsUUFBUSxJQUFJLFlBQVk7QUFDdEMsY0FBTSxtQkFBbUIsT0FBTztBQUNoQyxjQUFNLFlBQVksUUFBUSxJQUFJLGFBQWE7QUFDM0Msa0JBQVUsZ0JBQWdCO0FBQzFCLGtCQUFVLFNBQVMsS0FBSztBQUt4QixjQUFNLGNBQWMsT0FBTyxVQUFVO0FBQ25DLGdCQUFNLE1BQU0sS0FBSyxPQUFPLFNBQVMsTUFBTSxRQUFRLElBQUk7QUFDbkQsY0FBSSxRQUFRLEdBQUksTUFBSyxPQUFPLFNBQVMsTUFBTSxHQUFHLElBQUk7QUFDbEQsY0FBSSxLQUFLLE9BQU8sU0FBUyxXQUFXLElBQUksTUFBTSxRQUFXO0FBQ3ZELGlCQUFLLE9BQU8sU0FBUyxXQUFXLEtBQUssSUFBSSxLQUFLLE9BQU8sU0FBUyxXQUFXLElBQUk7QUFDN0UsbUJBQU8sS0FBSyxPQUFPLFNBQVMsV0FBVyxJQUFJO0FBQUEsVUFDN0M7QUFDQSxjQUFJLEtBQUssT0FBTyxTQUFTLGlCQUFpQixJQUFJLE1BQU0sUUFBVztBQUM3RCxpQkFBSyxPQUFPLFNBQVMsaUJBQWlCLEtBQUssSUFBSSxLQUFLLE9BQU8sU0FBUyxpQkFBaUIsSUFBSTtBQUN6RixtQkFBTyxLQUFLLE9BQU8sU0FBUyxpQkFBaUIsSUFBSTtBQUFBLFVBQ25EO0FBQ0EsY0FBSSxLQUFLLE9BQU8sU0FBUyx1QkFBdUIsSUFBSSxNQUFNLFFBQVc7QUFDbkUsaUJBQUssT0FBTyxTQUFTLHVCQUF1QixLQUFLLElBQUksS0FBSyxPQUFPLFNBQVMsdUJBQXVCLElBQUk7QUFDckcsbUJBQU8sS0FBSyxPQUFPLFNBQVMsdUJBQXVCLElBQUk7QUFBQSxVQUN6RDtBQUNBLGNBQUksS0FBSyxPQUFPLFNBQVMsaUJBQWlCLElBQUksTUFBTSxRQUFXO0FBQzdELGlCQUFLLE9BQU8sU0FBUyxpQkFBaUIsS0FBSyxJQUFJLEtBQUssT0FBTyxTQUFTLGlCQUFpQixJQUFJO0FBQ3pGLG1CQUFPLEtBQUssT0FBTyxTQUFTLGlCQUFpQixJQUFJO0FBQUEsVUFDbkQ7QUFDQSxjQUFJLEtBQUssT0FBTyxTQUFTLGNBQWMsSUFBSSxNQUFNLFFBQVc7QUFDMUQsaUJBQUssT0FBTyxTQUFTLGNBQWMsS0FBSyxJQUFJLEtBQUssT0FBTyxTQUFTLGNBQWMsSUFBSTtBQUNuRixtQkFBTyxLQUFLLE9BQU8sU0FBUyxjQUFjLElBQUk7QUFBQSxVQUNoRDtBQUNBLGNBQUksS0FBSyxpQkFBaUIsRUFBRSxJQUFJLE1BQU0sUUFBVztBQUMvQyxpQkFBSyxPQUFPLFNBQVMsV0FBVyxLQUFLLElBQUksS0FBSyxPQUFPLFNBQVMsV0FBVyxJQUFJO0FBQzdFLG1CQUFPLEtBQUssT0FBTyxTQUFTLFdBQVcsSUFBSTtBQUFBLFVBQzdDO0FBQ0EsMkJBQWlCLEtBQUssT0FBTyxVQUFVLE1BQU0sS0FBSztBQU1sRCxlQUFLLGVBQWU7QUFDcEIsZ0JBQU0sS0FBSyxPQUFPLGFBQWE7QUFDL0IsZUFBSyxPQUFPLG1CQUFtQjtBQUFBLFFBQ2pDO0FBRUEsWUFBSSxPQUFPO0FBQ1gsY0FBTSxTQUFTLE9BQU8sV0FBVztBQUMvQixjQUFJLEtBQU07QUFDVixpQkFBTztBQUNQLGVBQUssWUFBWTtBQUVqQixnQkFBTSxRQUFRLGtCQUFrQixRQUFRLFdBQVc7QUFDbkQsY0FBSSxDQUFDLFVBQVUsQ0FBQyxTQUFTLFVBQVUsTUFBTTtBQUN2QyxpQkFBSyxPQUFPO0FBQ1o7QUFBQSxVQUNGO0FBRUEsZ0JBQU0sV0FBVyxLQUFLLE9BQU8sU0FBUyxNQUFNO0FBQUEsWUFDMUMsQ0FBQyxNQUFNLEVBQUUsWUFBWSxNQUFNLE1BQU0sWUFBWSxLQUFLLE1BQU07QUFBQSxVQUMxRDtBQUNBLGNBQUksVUFBVTtBQUNaLGlCQUFLLGlCQUFpQixNQUFNLFFBQVE7QUFDcEM7QUFBQSxVQUNGO0FBRUEsY0FBSSxDQUFDLGFBQWE7QUFDaEIsa0JBQU0sWUFBWSxLQUFLO0FBQ3ZCLGlCQUFLLE9BQU87QUFDWjtBQUFBLFVBQ0Y7QUFJQSxnQkFBTSxFQUFFLE9BQU8sSUFBSSxLQUFLLE9BQU8sU0FBUyxXQUFXO0FBQ25ELGNBQUk7QUFBQSxZQUNGLEtBQUs7QUFBQSxZQUNMO0FBQUEsWUFDQTtBQUFBLFlBQ0EsT0FBTyxJQUFJLElBQUksS0FBSztBQUFBLFlBQ3BCLFlBQVk7QUFDVixvQkFBTSxZQUFZLEtBQUs7QUFDdkIsb0JBQU0sVUFBVSxNQUFNLGtCQUFrQixLQUFLLFFBQVEsTUFBTSxLQUFLO0FBQ2hFLGtCQUFJLE9BQU8sT0FBTyxLQUFLLEtBQUssT0FBTyx1QkFBdUI7QUFDMUQsbUJBQUssT0FBTztBQUFBLFlBQ2Q7QUFBQSxZQUNBLE1BQU0sS0FBSyxPQUFPO0FBQUEsVUFDcEIsRUFBRSxLQUFLO0FBQUEsUUFDVDtBQUVBLGdCQUFRLGlCQUFpQixXQUFXLENBQUMsVUFBVTtBQUM3QyxjQUFJLE1BQU0sUUFBUSxTQUFTO0FBQ3pCLGtCQUFNLGVBQWU7QUFDckIsa0JBQU0sZ0JBQWdCO0FBQ3RCLG1CQUFPLElBQUk7QUFBQSxVQUNiLFdBQVcsTUFBTSxRQUFRLFVBQVU7QUFHakMsa0JBQU0sZUFBZTtBQUNyQixrQkFBTSxnQkFBZ0I7QUFDdEIsbUJBQU8sS0FBSztBQUFBLFVBQ2Q7QUFBQSxRQUNGLENBQUM7QUFFRCxnQkFBUSxpQkFBaUIsUUFBUSxNQUFNLE9BQU8sSUFBSSxDQUFDO0FBQUEsTUFDckQ7QUFBQSxNQUVBLGlCQUFpQixRQUFRLFFBQVE7QUFDL0IsY0FBTSxFQUFFLE9BQU8sSUFBSSxLQUFLLE9BQU8sU0FBUyxXQUFXO0FBQ25ELFlBQUk7QUFBQSxVQUNGLEtBQUs7QUFBQSxVQUNMO0FBQUEsVUFDQTtBQUFBLFVBQ0EsT0FBTyxJQUFJLE1BQU0sS0FBSztBQUFBLFVBQ3RCLE1BQU0sS0FBSyxVQUFVLFFBQVEsTUFBTTtBQUFBLFVBQ25DLE1BQU0sS0FBSyxPQUFPO0FBQUEsUUFDcEIsRUFBRSxLQUFLO0FBQUEsTUFDVDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsTUFNQSxNQUFNLFVBQVUsUUFBUSxRQUFRO0FBQzlCLGNBQU0sV0FBVyxLQUFLLE9BQU87QUFDN0IsY0FBTSxVQUFVLE1BQU0sa0JBQWtCLEtBQUssUUFBUSxRQUFRLE1BQU07QUFFbkUsaUJBQVMsUUFBUSxTQUFTLE1BQU0sT0FBTyxDQUFDLE1BQU0sTUFBTSxNQUFNO0FBQzFELGVBQU8sU0FBUyxXQUFXLE1BQU07QUFDakMsZUFBTyxTQUFTLGlCQUFpQixNQUFNO0FBQ3ZDLGVBQU8sU0FBUyx1QkFBdUIsTUFBTTtBQUM3QyxlQUFPLFNBQVMsaUJBQWlCLE1BQU07QUFDdkMsZUFBTyxTQUFTLGNBQWMsTUFBTTtBQUNwQyxlQUFPLEtBQUssaUJBQWlCLEVBQUUsTUFBTTtBQUNyQywwQkFBa0IsVUFBVSxRQUFRLE1BQU07QUFHMUMsYUFBSyxlQUFlO0FBQ3BCLGNBQU0sS0FBSyxPQUFPLGFBQWE7QUFDL0IsYUFBSyxPQUFPLG1CQUFtQjtBQUMvQixZQUFJLE9BQU8sT0FBTyxNQUFNLFFBQVEsTUFBTSxvQkFBb0IsT0FBTyx1QkFBdUI7QUFDeEYsYUFBSyxPQUFPO0FBQUEsTUFDZDtBQUFBLE1BRUEsaUJBQWlCLE1BQU0sT0FBTztBQUM1QixjQUFNLGFBQWEsS0FBSyxVQUFVLEVBQUUsS0FBSyx3QkFBd0IsQ0FBQztBQUNsRSxtQkFBVyxXQUFXLEVBQUUsS0FBSyxtQkFBbUIsTUFBTSxPQUFPLEtBQUssRUFBRSxDQUFDO0FBQUEsTUFDdkU7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BWUEsbUJBQW1CLFFBQVE7QUFDekIsY0FBTSxVQUFVLE9BQU8sVUFBVSxFQUFFLEtBQUssaUNBQWlDLENBQUM7QUFDMUUsZ0JBQVEsVUFBVTtBQUFBLFVBQ2hCLEtBQUs7QUFBQSxVQUNMLE1BQU07QUFBQSxRQUNSLENBQUM7QUFBQSxNQUNIO0FBQUEsSUFDRjtBQUVBLGFBQVNPLGlCQUFnQixRQUFRO0FBQy9CLGFBQU8sYUFBYSxlQUFlLENBQUMsU0FBUyxJQUFJLFFBQVEsTUFBTSxNQUFNLENBQUM7QUFFdEUsYUFBTyxXQUFXO0FBQUEsUUFDaEIsSUFBSTtBQUFBLFFBQ0osTUFBTTtBQUFBLFFBQ04sVUFBVSxNQUFNLGdCQUFnQixNQUFNO0FBQUEsTUFDeEMsQ0FBQztBQUVELGFBQU8sV0FBVztBQUFBLFFBQ2hCLElBQUk7QUFBQSxRQUNKLE1BQU07QUFBQSxRQUNOLFVBQVUsTUFBTSxzQkFBc0IsTUFBTTtBQUFBLE1BQzlDLENBQUM7QUFFRCxhQUFPLFdBQVc7QUFBQSxRQUNoQixJQUFJO0FBQUEsUUFDSixNQUFNO0FBQUEsUUFDTixVQUFVLE1BQU0sY0FBYyxNQUFNO0FBQUEsTUFDdEMsQ0FBQztBQU9ELGFBQU8sSUFBSSxVQUFVLGNBQWMsTUFBTSxnQkFBZ0IsUUFBUSxPQUFPLEtBQUssQ0FBQztBQUU5RSxZQUFNLFVBQVUsTUFBTTtBQUNwQixtQkFBVyxRQUFRLE9BQU8sSUFBSSxVQUFVLGdCQUFnQixhQUFhLEdBQUc7QUFDdEUsZUFBSyxNQUFNLFNBQVM7QUFBQSxRQUN0QjtBQUFBLE1BQ0Y7QUFVQSxZQUFNLG1CQUFtQixTQUFTLFNBQVMsS0FBSyxJQUFJO0FBQ3BELGFBQU8sY0FBYyxPQUFPLFNBQVMsR0FBRyxVQUFVLGdCQUFnQixDQUFDO0FBSW5FLGFBQU8sY0FBYyxPQUFPLElBQUksTUFBTSxHQUFHLGtCQUFrQixnQkFBZ0IsQ0FBQztBQUs1RSxhQUFPO0FBQUEsSUFDVDtBQVFBLG1CQUFlLGdCQUFnQixRQUFRLFNBQVMsTUFBTSxrQkFBa0IsTUFBTTtBQUM1RSxZQUFNLE1BQU0sT0FBTztBQUNuQixZQUFNLEVBQUUsVUFBVSxJQUFJO0FBRXRCLFlBQU0sYUFBYSxDQUFDO0FBQ3BCLGdCQUFVLGlCQUFpQixDQUFDQyxVQUFTO0FBQ25DLFlBQUlBLFVBQVMsSUFBSSxpQkFBa0JBLE1BQUssUUFBUUEsTUFBSyxLQUFLLFlBQVksTUFBTSxlQUFnQjtBQUMxRixxQkFBVyxLQUFLQSxLQUFJO0FBQUEsUUFDdEI7QUFBQSxNQUNGLENBQUM7QUFFRCxVQUFJLE9BQU8sV0FBVyxNQUFNLEtBQUs7QUFDakMsaUJBQVcsU0FBUyxXQUFZLE9BQU0sT0FBTztBQUU3QyxVQUFJLENBQUMsTUFBTTtBQUNULFlBQUksQ0FBQyxnQkFBaUI7QUFDdEIsZUFBTyxVQUFVLFlBQVksS0FBSztBQUNsQyxjQUFNLEtBQUssYUFBYSxFQUFFLE1BQU0sZUFBZSxRQUFRLEtBQUssQ0FBQztBQUFBLE1BQy9ELFdBQVcsRUFBRSxLQUFLLGdCQUFnQixVQUFVO0FBTzFDLGNBQU0sS0FBSyxhQUFhLEVBQUUsTUFBTSxlQUFlLFFBQVEsTUFBTSxDQUFDO0FBQUEsTUFDaEU7QUFFQSxVQUFJLGdCQUFnQjtBQUNwQixVQUFJLE9BQVEsV0FBVSxXQUFXLElBQUk7QUFBQSxJQUN2QztBQVNBLG1CQUFlLHNCQUFzQixRQUFRO0FBQzNDLFlBQU0sTUFBTSxPQUFPO0FBRW5CLFlBQU0sZ0JBQWdCLElBQUksVUFBVSxvQkFBb0IsT0FBTztBQUMvRCxVQUFJLGlCQUFpQixjQUFjLGlCQUFpQixNQUFNO0FBQ3hELHNCQUFjLG1CQUFtQixTQUFTLElBQUk7QUFDOUM7QUFBQSxNQUNGO0FBRUEsWUFBTSxPQUFPLElBQUksVUFBVSxjQUFjO0FBQ3pDLFlBQU0sT0FBTyxPQUFPLFNBQVMsT0FBTyxJQUFJO0FBQ3hDLFVBQUksQ0FBQyxNQUFNO0FBQ1QsY0FBTSxXQUFXLElBQUksVUFDbEIsZ0JBQWdCLGFBQWEsRUFDN0IsS0FBSyxDQUFDLFNBQVMsS0FBSyxnQkFBZ0IsV0FBVyxLQUFLLEtBQUssaUJBQWlCLElBQUk7QUFDakYsWUFBSSxVQUFVO0FBQ1osZ0JBQU0sSUFBSSxVQUFVLFdBQVcsUUFBUTtBQUN2QyxtQkFBUyxLQUFLLG1CQUFtQixTQUFTLElBQUk7QUFDOUM7QUFBQSxRQUNGO0FBQ0EsWUFBSSxPQUFPLE9BQU8sOEVBQTJFLGlFQUE4RDtBQUMzSjtBQUFBLE1BQ0Y7QUFFQSxZQUFNLGdCQUFnQixNQUFNO0FBQzVCLFlBQU0sT0FBTyxJQUFJLGVBQWU7QUFDaEMsVUFBSSxFQUFFLGdCQUFnQixTQUFVO0FBQ2hDLFdBQUssaUJBQWlCLElBQUk7QUFDMUIsV0FBSyxtQkFBbUIsU0FBUyxJQUFJO0FBQUEsSUFDdkM7QUFNQSxtQkFBZSxjQUFjLFFBQVE7QUFDbkMsWUFBTSxnQkFBZ0IsTUFBTTtBQUM1QixZQUFNLE9BQU8sT0FBTyxJQUFJLGVBQWU7QUFDdkMsVUFBSSxFQUFFLGdCQUFnQixTQUFVO0FBQ2hDLFVBQUksS0FBSyxpQkFBaUIsS0FBTSxNQUFLLGtCQUFrQjtBQUN2RCxXQUFLLFNBQVM7QUFBQSxJQUNoQjtBQUVBLElBQUFULFFBQU8sVUFBVSxFQUFFLGlCQUFBUSxrQkFBaUIsZUFBZSxjQUFjLGlCQUFBTCxrQkFBaUIsb0JBQUFJLHFCQUFvQixtQkFBbUI7QUFBQTtBQUFBOzs7QUMvNER6SDtBQUFBLGdDQUFBRyxVQUFBQyxTQUFBO0FBQUEsUUFBTSxFQUFFLE9BQU8sUUFBUSxJQUFJLFFBQVEsVUFBVTtBQUM3QyxRQUFNLEVBQUUsYUFBYSxJQUFJO0FBRXpCLFFBQU0sMEJBQTBCO0FBQ2hDLFFBQU0seUJBQXlCO0FBSy9CLGFBQVMsa0JBQWtCLFFBQVEsUUFBUTtBQUN6QyxZQUFNLGNBQWMsT0FBTyxJQUFJLFFBQVEsUUFBUSxzQkFBc0I7QUFDckUsWUFBTSxXQUFXLGFBQWE7QUFDOUIsVUFBSSxDQUFDLFNBQVUsUUFBTztBQUV0QixZQUFNLFlBQ0gsU0FBUyxrQkFBa0IsbUJBQW1CLFFBQVEsbUJBQW1CLE9BQU8sSUFBSSxLQUNwRixTQUFTLGtCQUFrQjtBQUM5QixZQUFNLFVBQVUsU0FBUyxvQkFBb0IsaUJBQWlCLE9BQU8sUUFBUSxRQUFRLEtBQUssT0FBTztBQUNqRyxZQUFNLE9BQU8sVUFBVSxHQUFHLE9BQU8sSUFBSSxRQUFRLEtBQUs7QUFFbEQsWUFBTSxPQUFPLE9BQU8sSUFBSSxNQUFNLHNCQUFzQixJQUFJO0FBQ3hELGFBQU8sZ0JBQWdCLFFBQVEsT0FBTztBQUFBLElBQ3hDO0FBRUEsYUFBUyxrQkFBa0IsUUFBUSxTQUFTLE1BQU07QUFDaEQsWUFBTSxZQUFZLFFBQVEsY0FBYyxvREFBb0Q7QUFDNUYsVUFBSSxDQUFDLFVBQVc7QUFFaEIsWUFBTSxRQUFRLE9BQU8sU0FBUyxXQUFXLGVBQWUsYUFBYSxRQUFRLE1BQU0sY0FBYyxJQUFJO0FBQ3JHLFVBQUksTUFBTyxXQUFVLE1BQU0sUUFBUTtBQUFBLFVBQzlCLFdBQVUsTUFBTSxlQUFlLE9BQU87QUFBQSxJQUM3QztBQUVBLGFBQVMsd0JBQXdCLFFBQVE7QUFDdkMsaUJBQVcsUUFBUSxPQUFPLElBQUksVUFBVSxnQkFBZ0IsdUJBQXVCLEdBQUc7QUFDaEYsY0FBTSxlQUFlLEtBQUssS0FBSyxZQUFZLGlCQUFpQiw0QkFBNEI7QUFDeEYsbUJBQVcsV0FBVyxjQUFjO0FBQ2xDLGdCQUFNLE9BQU8sT0FBTyxJQUFJLE1BQU0sc0JBQXNCLFFBQVEsYUFBYSxXQUFXLENBQUM7QUFDckYsNEJBQWtCLFFBQVEsU0FBUyxnQkFBZ0IsUUFBUSxPQUFPLElBQUk7QUFBQSxRQUN4RTtBQUVBLGNBQU0saUJBQWlCLEtBQUssS0FBSyxZQUFZLGlCQUFpQiw4QkFBOEI7QUFDNUYsbUJBQVcsV0FBVyxnQkFBZ0I7QUFDcEMsZ0JBQU0sU0FBUyxPQUFPLElBQUksTUFBTSxzQkFBc0IsUUFBUSxhQUFhLFdBQVcsQ0FBQztBQUN2RixnQkFBTSxXQUFXLGtCQUFrQixVQUFVLGtCQUFrQixRQUFRLE1BQU0sSUFBSTtBQUNqRiw0QkFBa0IsUUFBUSxTQUFTLFFBQVE7QUFBQSxRQUM3QztBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBRUEsYUFBU0MsNEJBQTJCLFFBQVE7QUFDMUMsWUFBTSxVQUFVLE1BQU0sd0JBQXdCLE1BQU07QUFLcEQsWUFBTSxXQUFXLElBQUksaUJBQWlCLE9BQU87QUFDN0MsWUFBTSx3QkFBd0IsTUFBTTtBQUNsQyxtQkFBVyxRQUFRLE9BQU8sSUFBSSxVQUFVLGdCQUFnQix1QkFBdUIsR0FBRztBQUNoRixtQkFBUyxRQUFRLEtBQUssS0FBSyxhQUFhLEVBQUUsV0FBVyxNQUFNLFNBQVMsS0FBSyxDQUFDO0FBQUEsUUFDNUU7QUFBQSxNQUNGO0FBQ0EsYUFBTyxTQUFTLE1BQU0sU0FBUyxXQUFXLENBQUM7QUFFM0MsYUFBTyxjQUFjLE9BQU8sU0FBUyxHQUFHLFVBQVUsT0FBTyxDQUFDO0FBQzFELGFBQU8sY0FBYyxPQUFPLElBQUksTUFBTSxHQUFHLFVBQVUsT0FBTyxDQUFDO0FBQzNELGFBQU87QUFBQSxRQUNMLE9BQU8sSUFBSSxVQUFVLEdBQUcsaUJBQWlCLE1BQU07QUFDN0MsZ0NBQXNCO0FBQ3RCLGtCQUFRO0FBQUEsUUFDVixDQUFDO0FBQUEsTUFDSDtBQUVBLGFBQU8sSUFBSSxVQUFVLGNBQWMsTUFBTTtBQUN2Qyw4QkFBc0I7QUFDdEIsZ0JBQVE7QUFBQSxNQUNWLENBQUM7QUFFRCxhQUFPO0FBQUEsSUFDVDtBQUVBLElBQUFELFFBQU8sVUFBVSxFQUFFLDRCQUFBQyw0QkFBMkI7QUFBQTtBQUFBOzs7QUNqRjlDO0FBQUEsd0JBQUFDLFVBQUFDLFNBQUE7QUFBQSxRQUFNLEVBQUUsYUFBYSxJQUFJO0FBRXpCLFFBQU0sbUJBQW1CLENBQUMsU0FBUyxZQUFZO0FBRS9DLGFBQVMsU0FBUyxLQUFLO0FBQ3JCLGFBQU8sU0FBUyxJQUFJLFFBQVEsS0FBSyxFQUFFLEdBQUcsRUFBRTtBQUFBLElBQzFDO0FBU0EsYUFBUyxjQUFjLFFBQVEsVUFBVTtBQUN2QyxVQUFJLFNBQVMsc0JBQXVCO0FBQ3BDLGVBQVMsd0JBQXdCO0FBRWpDLFlBQU0sV0FBVyxTQUFTO0FBQzFCLGVBQVMsVUFBVSxTQUFVLE1BQU07QUFDakMsbUJBQVcsUUFBUSxLQUFLLE9BQU87QUFDN0IsZ0JBQU0sT0FBTyxLQUFLLE1BQU0sSUFBSTtBQUM1QixjQUFJLEtBQUssTUFBTztBQUVoQixjQUFJLEtBQUssU0FBUyxPQUFPO0FBUXZCO0FBQUEsVUFDRjtBQUVBLGdCQUFNLE9BQU8sT0FBTyxJQUFJLE1BQU0sc0JBQXNCLElBQUk7QUFDeEQsY0FBSSxRQUFRO0FBRVosY0FBSSxRQUFRLEtBQUssY0FBYyxNQUFNO0FBQUEsVUFNckMsV0FBVyxPQUFPLFNBQVMsV0FBVyxPQUFPO0FBQzNDLG9CQUFRLGFBQWEsUUFBUSxNQUFNLE9BQU87QUFBQSxVQUM1QztBQUVBLGNBQUksTUFBTyxNQUFLLFFBQVEsRUFBRSxHQUFHLEdBQUcsS0FBSyxTQUFTLEtBQUssRUFBRTtBQUFBLFFBQ3ZEO0FBQ0EsZUFBTyxTQUFTLEtBQUssTUFBTSxJQUFJO0FBQUEsTUFDakM7QUFFQSxhQUFPLFNBQVMsTUFBTTtBQUNwQixpQkFBUyxVQUFVO0FBQ25CLGVBQU8sU0FBUztBQUFBLE1BQ2xCLENBQUM7QUFBQSxJQUNIO0FBRUEsYUFBUyxlQUFlLEtBQUs7QUFDM0IsWUFBTSxTQUFTLENBQUM7QUFDaEIsaUJBQVcsUUFBUSxpQkFBa0IsUUFBTyxLQUFLLEdBQUcsSUFBSSxVQUFVLGdCQUFnQixJQUFJLENBQUM7QUFDdkYsYUFBTztBQUFBLElBQ1Q7QUFFQSxhQUFTQyxxQkFBb0IsUUFBUTtBQUNuQyxZQUFNLFVBQVUsTUFBTTtBQUNwQixtQkFBVyxRQUFRLGVBQWUsT0FBTyxHQUFHLEdBQUc7QUFDN0MsY0FBSSxLQUFLLE1BQU0sU0FBVSxlQUFjLFFBQVEsS0FBSyxLQUFLLFFBQVE7QUFJakUsV0FBQyxLQUFLLE1BQU0sY0FBYyxLQUFLLE1BQU0sU0FBUyxPQUFPO0FBQUEsUUFDdkQ7QUFBQSxNQUNGO0FBRUEsYUFBTyxjQUFjLE9BQU8sSUFBSSxVQUFVLEdBQUcsaUJBQWlCLE9BQU8sQ0FBQztBQUd0RSxhQUFPLGNBQWMsT0FBTyxTQUFTLEdBQUcsVUFBVSxPQUFPLENBQUM7QUFDMUQsYUFBTyxJQUFJLFVBQVUsY0FBYyxPQUFPO0FBRTFDLGFBQU87QUFBQSxJQUNUO0FBRUEsSUFBQUQsUUFBTyxVQUFVLEVBQUUscUJBQUFDLHFCQUFvQjtBQUFBO0FBQUE7OztBQ3RGdkM7QUFBQSx5QkFBQUMsVUFBQUMsU0FBQTtBQUFBLFFBQU0sRUFBRSxhQUFhLElBQUk7QUFFekIsUUFBTSxtQkFBbUI7QUFLekIsYUFBUyxrQkFBa0IsUUFBUTtBQUNqQyxpQkFBVyxRQUFRLE9BQU8sSUFBSSxVQUFVLGdCQUFnQixnQkFBZ0IsR0FBRztBQUN6RSxjQUFNLGtCQUFrQixLQUFLLE1BQU0sS0FBSztBQUN4QyxZQUFJLENBQUMsZ0JBQWlCO0FBRXRCLG1CQUFXLENBQUMsTUFBTSxTQUFTLEtBQUssaUJBQWlCO0FBQy9DLGdCQUFNLFVBQVUsVUFBVSxJQUFJLGNBQWMsNENBQTRDO0FBQ3hGLGNBQUksQ0FBQyxRQUFTO0FBRWQsZ0JBQU0sUUFBUSxPQUFPLFNBQVMsV0FBVyxTQUFTLGFBQWEsUUFBUSxNQUFNLFFBQVEsSUFBSTtBQUN6RixjQUFJLE1BQU8sU0FBUSxNQUFNLFFBQVE7QUFBQSxjQUM1QixTQUFRLE1BQU0sZUFBZSxPQUFPO0FBQUEsUUFDM0M7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUVBLGFBQVNDLHNCQUFxQixRQUFRO0FBQ3BDLFlBQU0sVUFBVSxNQUFNLGtCQUFrQixNQUFNO0FBRzlDLFlBQU0sV0FBVyxJQUFJLGlCQUFpQixPQUFPO0FBQzdDLFlBQU0sZ0JBQWdCLE1BQU07QUFDMUIsbUJBQVcsUUFBUSxPQUFPLElBQUksVUFBVSxnQkFBZ0IsZ0JBQWdCLEdBQUc7QUFDekUsbUJBQVMsUUFBUSxLQUFLLEtBQUssYUFBYSxFQUFFLFdBQVcsTUFBTSxTQUFTLEtBQUssQ0FBQztBQUFBLFFBQzVFO0FBQUEsTUFDRjtBQUNBLGFBQU8sU0FBUyxNQUFNLFNBQVMsV0FBVyxDQUFDO0FBRTNDLGFBQU8sY0FBYyxPQUFPLFNBQVMsR0FBRyxVQUFVLE9BQU8sQ0FBQztBQUMxRCxhQUFPO0FBQUEsUUFDTCxPQUFPLElBQUksVUFBVSxHQUFHLGlCQUFpQixNQUFNO0FBQzdDLHdCQUFjO0FBQ2Qsa0JBQVE7QUFBQSxRQUNWLENBQUM7QUFBQSxNQUNIO0FBRUEsYUFBTyxJQUFJLFVBQVUsY0FBYyxNQUFNO0FBQ3ZDLHNCQUFjO0FBQ2QsZ0JBQVE7QUFBQSxNQUNWLENBQUM7QUFFRCxhQUFPO0FBQUEsSUFDVDtBQUVBLElBQUFELFFBQU8sVUFBVSxFQUFFLHNCQUFBQyxzQkFBcUI7QUFBQTtBQUFBOzs7QUNuRHhDO0FBQUEsK0JBQUFDLFVBQUFDLFNBQUE7QUFBQSxRQUFNLEVBQUUsYUFBYSxJQUFJO0FBRXpCLFFBQU0seUJBQXlCO0FBSy9CLGFBQVMsdUJBQXVCLFFBQVE7QUFDdEMsaUJBQVcsUUFBUSxPQUFPLElBQUksVUFBVSxnQkFBZ0Isc0JBQXNCLEdBQUc7QUFDL0UsY0FBTSxjQUFjLEtBQUssTUFBTSxNQUFNO0FBQ3JDLFlBQUksQ0FBQyxNQUFNLFFBQVEsV0FBVyxFQUFHO0FBRWpDLGNBQU0sV0FBVyxLQUFLLEtBQUssWUFBWSxpQkFBaUIsNkNBQTZDO0FBQ3JHLGlCQUFTLFFBQVEsQ0FBQyxTQUFTLFVBQVU7QUFDbkMsZ0JBQU0sUUFBUSxZQUFZLEtBQUs7QUFDL0IsZ0JBQU0sT0FBTyxRQUFRLE9BQU8sSUFBSSxNQUFNLHNCQUFzQixNQUFNLElBQUksSUFBSTtBQUMxRSxnQkFBTSxRQUFRLE9BQU8sU0FBUyxXQUFXLGNBQWMsYUFBYSxRQUFRLE1BQU0sYUFBYSxJQUFJO0FBQ25HLGNBQUksTUFBTyxTQUFRLE1BQU0sUUFBUTtBQUFBLGNBQzVCLFNBQVEsTUFBTSxlQUFlLE9BQU87QUFBQSxRQUMzQyxDQUFDO0FBQUEsTUFDSDtBQUFBLElBQ0Y7QUFFQSxhQUFTQywyQkFBMEIsUUFBUTtBQUN6QyxZQUFNLFVBQVUsTUFBTSx1QkFBdUIsTUFBTTtBQUVuRCxZQUFNLFdBQVcsSUFBSSxpQkFBaUIsT0FBTztBQUM3QyxZQUFNLGdCQUFnQixNQUFNO0FBQzFCLG1CQUFXLFFBQVEsT0FBTyxJQUFJLFVBQVUsZ0JBQWdCLHNCQUFzQixHQUFHO0FBQy9FLG1CQUFTLFFBQVEsS0FBSyxLQUFLLGFBQWEsRUFBRSxXQUFXLE1BQU0sU0FBUyxLQUFLLENBQUM7QUFBQSxRQUM1RTtBQUFBLE1BQ0Y7QUFDQSxhQUFPLFNBQVMsTUFBTSxTQUFTLFdBQVcsQ0FBQztBQUUzQyxhQUFPLGNBQWMsT0FBTyxTQUFTLEdBQUcsVUFBVSxPQUFPLENBQUM7QUFDMUQsYUFBTztBQUFBLFFBQ0wsT0FBTyxJQUFJLFVBQVUsR0FBRyxpQkFBaUIsTUFBTTtBQUM3Qyx3QkFBYztBQUNkLGtCQUFRO0FBQUEsUUFDVixDQUFDO0FBQUEsTUFDSDtBQUVBLGFBQU8sSUFBSSxVQUFVLGNBQWMsTUFBTTtBQUN2QyxzQkFBYztBQUNkLGdCQUFRO0FBQUEsTUFDVixDQUFDO0FBRUQsYUFBTztBQUFBLElBQ1Q7QUFFQSxJQUFBRCxRQUFPLFVBQVUsRUFBRSwyQkFBQUMsMkJBQTBCO0FBQUE7QUFBQTs7O0FDbEQ3QztBQUFBLDJCQUFBQyxVQUFBQyxTQUFBO0FBQUEsUUFBTSxFQUFFLGFBQWEsSUFBSTtBQUV6QixRQUFNLHFCQUFxQjtBQU8zQixhQUFTLG9CQUFvQixNQUFNO0FBQ2pDLFlBQU0sV0FBVyxNQUFNO0FBQ3ZCLFlBQU0sYUFBYSxDQUFDLFVBQVUsYUFBYSxVQUFVLGFBQWEsTUFBTSxhQUFhLE1BQU0sYUFBYSxNQUFNLEdBQUc7QUFFakgsWUFBTSxVQUFVLENBQUM7QUFDakIsaUJBQVcsT0FBTyxZQUFZO0FBQzVCLFlBQUksS0FBSywyQkFBMkIsSUFBSyxTQUFRLEtBQUssSUFBSSxlQUFlO0FBQUEsTUFDM0U7QUFDQSxhQUFPO0FBQUEsSUFDVDtBQUVBLGFBQVMsYUFBYSxRQUFRLElBQUksTUFBTTtBQUN0QyxZQUFNLFFBQVEsT0FBTyxTQUFTLFdBQVcsWUFBWSxhQUFhLFFBQVEsTUFBTSxXQUFXLElBQUk7QUFDL0YsVUFBSSxNQUFPLElBQUcsTUFBTSxRQUFRO0FBQUEsVUFDdkIsSUFBRyxNQUFNLGVBQWUsT0FBTztBQUFBLElBQ3RDO0FBRUEsYUFBUyx3QkFBd0IsUUFBUTtBQUN2QyxpQkFBVyxRQUFRLE9BQU8sSUFBSSxVQUFVLGdCQUFnQixrQkFBa0IsR0FBRztBQUMzRSxtQkFBVyxVQUFVLG9CQUFvQixLQUFLLElBQUksR0FBRztBQUNuRCxxQkFBVyxDQUFDLE1BQU0sU0FBUyxLQUFLLFFBQVE7QUFDdEMsa0JBQU0sVUFBVSxVQUFVLElBQUksY0FBYyw0Q0FBNEM7QUFDeEYsZ0JBQUksUUFBUyxjQUFhLFFBQVEsU0FBUyxJQUFJO0FBQUEsVUFDakQ7QUFBQSxRQUNGO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFPQSxhQUFTLDRCQUE0QixRQUFRO0FBQzNDLGlCQUFXLFFBQVEsT0FBTyxJQUFJLFVBQVUsZ0JBQWdCLFVBQVUsR0FBRztBQUNuRSxjQUFNLFNBQVMsS0FBSyxLQUFLLFlBQVksY0FBYyxvQ0FBb0M7QUFDdkYsWUFBSSxDQUFDLE9BQVE7QUFFYixjQUFNLGFBQWEsS0FBSyxLQUFLLE1BQU0sUUFBUTtBQUMzQyxjQUFNLFdBQVcsT0FBTyxpQkFBaUIsNENBQTRDO0FBQ3JGLG1CQUFXLFdBQVcsVUFBVTtBQUM5QixnQkFBTSxXQUFXLFFBQVE7QUFDekIsZ0JBQU0sT0FBTyxXQUFXLE9BQU8sSUFBSSxjQUFjLHFCQUFxQixVQUFVLFVBQVUsSUFBSTtBQUM5Rix1QkFBYSxRQUFRLFNBQVMsSUFBSTtBQUFBLFFBQ3BDO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFFQSxhQUFTLG9CQUFvQixRQUFRO0FBQ25DLDhCQUF3QixNQUFNO0FBQzlCLGtDQUE0QixNQUFNO0FBQUEsSUFDcEM7QUFFQSxhQUFTQyx3QkFBdUIsUUFBUTtBQUN0QyxZQUFNLFVBQVUsTUFBTSxvQkFBb0IsTUFBTTtBQWFoRCxZQUFNLFdBQVcsSUFBSSxpQkFBaUIsT0FBTztBQUM3QyxZQUFNLGdCQUFnQixNQUFNO0FBQzFCLG1CQUFXLFFBQVEsT0FBTyxJQUFJLFVBQVUsZ0JBQWdCLGtCQUFrQixHQUFHO0FBQzNFLG1CQUFTLFFBQVEsS0FBSyxLQUFLLGFBQWEsRUFBRSxXQUFXLE1BQU0sU0FBUyxLQUFLLENBQUM7QUFBQSxRQUM1RTtBQUFBLE1BQ0Y7QUFDQSxhQUFPLFNBQVMsTUFBTSxTQUFTLFdBQVcsQ0FBQztBQUUzQyxhQUFPLGNBQWMsT0FBTyxTQUFTLEdBQUcsVUFBVSxPQUFPLENBQUM7QUFHMUQsYUFBTyxjQUFjLE9BQU8sSUFBSSxjQUFjLEdBQUcsWUFBWSxNQUFNLDRCQUE0QixNQUFNLENBQUMsQ0FBQztBQUN2RyxhQUFPO0FBQUEsUUFDTCxPQUFPLElBQUksVUFBVSxHQUFHLGlCQUFpQixNQUFNO0FBQzdDLHdCQUFjO0FBQ2Qsa0JBQVE7QUFBQSxRQUNWLENBQUM7QUFBQSxNQUNIO0FBQ0EsYUFBTyxjQUFjLE9BQU8sSUFBSSxVQUFVLEdBQUcsc0JBQXNCLE9BQU8sQ0FBQztBQUUzRSxhQUFPLElBQUksVUFBVSxjQUFjLE1BQU07QUFDdkMsc0JBQWM7QUFDZCxnQkFBUTtBQUFBLE1BQ1YsQ0FBQztBQUVELGFBQU87QUFBQSxJQUNUO0FBRUEsSUFBQUQsUUFBTyxVQUFVLEVBQUUsd0JBQUFDLHdCQUF1QjtBQUFBO0FBQUE7OztBQ3hHMUM7QUFBQSwyQkFBQUMsVUFBQUMsU0FBQTtBQUFBLFFBQU0sRUFBRSxhQUFhLElBQUk7QUFFekIsUUFBTSxzQkFBc0I7QUFDNUIsUUFBTSxzQkFBc0I7QUFTNUIsYUFBUyxvQkFBb0IsT0FBTyxVQUFVO0FBQzVDLGlCQUFXLFFBQVEsU0FBUyxDQUFDLEdBQUc7QUFDOUIsWUFBSSxLQUFLLFNBQVMsT0FBUSxVQUFTLElBQUk7QUFBQSxpQkFDOUIsS0FBSyxTQUFTLFFBQVMscUJBQW9CLEtBQUssT0FBTyxRQUFRO0FBQUEsTUFDMUU7QUFBQSxJQUNGO0FBRUEsYUFBUyxxQkFBcUIsUUFBUTtBQUNwQyxZQUFNLGtCQUFrQixPQUFPLElBQUksZ0JBQWdCLHFCQUFxQixtQkFBbUI7QUFDM0YsVUFBSSxDQUFDLGdCQUFpQjtBQUV0QixpQkFBVyxRQUFRLE9BQU8sSUFBSSxVQUFVLGdCQUFnQixtQkFBbUIsR0FBRztBQUM1RSxjQUFNLFdBQVcsS0FBSyxNQUFNO0FBQzVCLFlBQUksQ0FBQyxTQUFVO0FBRWYsNEJBQW9CLGdCQUFnQixPQUFPLENBQUMsU0FBUztBQUNuRCxnQkFBTSxVQUFVLFNBQVMsSUFBSSxJQUFJLEdBQUc7QUFDcEMsY0FBSSxDQUFDLFFBQVM7QUFFZCxnQkFBTSxPQUFPLE9BQU8sSUFBSSxNQUFNLHNCQUFzQixLQUFLLElBQUk7QUFDN0QsZ0JBQU0sUUFBUSxPQUFPLFNBQVMsV0FBVyxZQUFZLGFBQWEsUUFBUSxNQUFNLFdBQVcsSUFBSTtBQUMvRixjQUFJLE1BQU8sU0FBUSxNQUFNLFFBQVE7QUFBQSxjQUM1QixTQUFRLE1BQU0sZUFBZSxPQUFPO0FBQUEsUUFDM0MsQ0FBQztBQUFBLE1BQ0g7QUFBQSxJQUNGO0FBRUEsYUFBU0MseUJBQXdCLFFBQVE7QUFDdkMsWUFBTSxVQUFVLE1BQU0scUJBQXFCLE1BQU07QUFLakQsWUFBTSxXQUFXLElBQUksaUJBQWlCLE9BQU87QUFDN0MsWUFBTSxnQkFBZ0IsTUFBTTtBQUMxQixtQkFBVyxRQUFRLE9BQU8sSUFBSSxVQUFVLGdCQUFnQixtQkFBbUIsR0FBRztBQUM1RSxtQkFBUyxRQUFRLEtBQUssS0FBSyxhQUFhLEVBQUUsV0FBVyxNQUFNLFNBQVMsS0FBSyxDQUFDO0FBQUEsUUFDNUU7QUFBQSxNQUNGO0FBQ0EsYUFBTyxTQUFTLE1BQU0sU0FBUyxXQUFXLENBQUM7QUFFM0MsYUFBTyxjQUFjLE9BQU8sU0FBUyxHQUFHLFVBQVUsT0FBTyxDQUFDO0FBQzFELGFBQU87QUFBQSxRQUNMLE9BQU8sSUFBSSxVQUFVLEdBQUcsaUJBQWlCLE1BQU07QUFDN0Msd0JBQWM7QUFDZCxrQkFBUTtBQUFBLFFBQ1YsQ0FBQztBQUFBLE1BQ0g7QUFFQSxhQUFPLElBQUksVUFBVSxjQUFjLE1BQU07QUFDdkMsc0JBQWM7QUFDZCxnQkFBUTtBQUFBLE1BQ1YsQ0FBQztBQUVELGFBQU87QUFBQSxJQUNUO0FBRUEsSUFBQUQsUUFBTyxVQUFVLEVBQUUseUJBQUFDLHlCQUF3QjtBQUFBO0FBQUE7OztBQ3JFM0M7QUFBQSwrQkFBQUMsVUFBQUMsU0FBQTtBQUFBLFFBQU0sRUFBRSxNQUFNLElBQUksUUFBUSxVQUFVO0FBQ3BDLFFBQU0sRUFBRSxjQUFjLGNBQWMsbUJBQW1CLElBQUk7QUFDM0QsUUFBTSxFQUFFLFlBQUFDLFlBQVcsSUFBSTtBQUV2QixRQUFNLFlBQVk7QUFDbEIsUUFBTSxtQkFBbUI7QUFFekIsUUFBTSxvQkFBb0I7QUFDMUIsUUFBTSxjQUFjO0FBQ3BCLFFBQU0sb0JBQW9CO0FBQzFCLFFBQU0sWUFBWTtBQUVsQixRQUFNLG9CQUFvQjtBQUMxQixRQUFNLDBCQUEwQjtBQUNoQyxRQUFNLHdCQUF3QjtBQUM5QixRQUFNLDJCQUEyQjtBQUNqQyxRQUFNLGtCQUFrQjtBQVV4QixhQUFTLGNBQWMsUUFBUSxNQUFNO0FBQ25DLFlBQU0sUUFBUSxPQUFPLFNBQVM7QUFDOUIsVUFBSSxVQUFVLE9BQVEsUUFBTyxFQUFFLE1BQU0sT0FBTztBQUM1QyxVQUFJLFVBQVUsTUFBTyxRQUFPLEVBQUUsTUFBTSxPQUFPLEdBQUcsV0FBVyxRQUFRLElBQUksRUFBRTtBQUt2RSxZQUFNLEVBQUUsU0FBUyxJQUFJO0FBQ3JCLFlBQU0sT0FBTyxPQUFPLFNBQVMsT0FBTyxJQUFJO0FBQ3hDLFVBQUksQ0FBQyxLQUFNLFFBQU8sRUFBRSxNQUFNLE9BQU87QUFDakMsWUFBTSxVQUFVLFNBQVM7QUFDekIsVUFBSSxXQUFXLENBQUMsU0FBUyxXQUFXLElBQUksS0FBSyxDQUFDLFNBQVMsTUFBTSxTQUFTLElBQUksRUFBRyxRQUFPLEVBQUUsTUFBTSxPQUFPO0FBQ25HLFlBQU0sWUFBWSxTQUFTLFdBQVcsSUFBSSxLQUFLO0FBRS9DLFlBQU0sUUFBUSxXQUFXLFFBQVEsTUFBTSxJQUFJO0FBQzNDLFVBQUksQ0FBQyxNQUFPLFFBQU8sRUFBRSxNQUFNLE9BQU87QUFDbEMsWUFBTSxFQUFFLE1BQU0saUJBQWlCLFFBQVEsSUFBSTtBQUMzQyxZQUFNLFFBQVEsVUFBVyxrQkFBa0IsYUFBYSxVQUFVLE1BQU0sT0FBTyxLQUFLLFlBQVksWUFBYTtBQUM3RyxZQUFNLFdBQVcsU0FBUztBQUMxQixhQUFPLEVBQUUsTUFBTSxhQUFhLFVBQVUsZ0JBQWdCLGVBQWUsU0FBUyxPQUFPLFVBQVUsS0FBSztBQUFBLElBQ3RHO0FBUUEsYUFBUyxXQUFXLFFBQVEsTUFBTSxNQUFNO0FBQ3RDLFlBQU0sRUFBRSxTQUFTLElBQUk7QUFDckIsWUFBTSxVQUFVLE9BQU8sU0FBUyxVQUFVLElBQUk7QUFDOUMsWUFBTSxPQUFPLFNBQVMsdUJBQXVCO0FBQzdDLFVBQUksU0FBUyxVQUFXLFFBQU8sVUFBVSxFQUFFLE1BQU0sU0FBUyxpQkFBaUIsTUFBTSxRQUFRLElBQUk7QUFDN0YsVUFBSSxDQUFDLFdBQVcsU0FBUyxPQUFRLFFBQU8sRUFBRSxNQUFNLE1BQU0saUJBQWlCLE9BQU8sUUFBUTtBQUN0RixhQUFPLEVBQUUsTUFBTSxHQUFHLElBQUksSUFBSSxPQUFPLElBQUksaUJBQWlCLENBQUMsQ0FBQyxTQUFTLFdBQVcsdUJBQXVCLFFBQVE7QUFBQSxJQUM3RztBQU9BLGFBQVMsV0FBVyxRQUFRLE1BQU07QUFDaEMsWUFBTSxPQUFPLE9BQU8sU0FBUyxPQUFPLElBQUk7QUFDeEMsVUFBSSxDQUFDLEtBQU0sUUFBTyxFQUFFLE9BQU8sTUFBTSxRQUFRLE1BQU07QUFDL0MsWUFBTSxFQUFFLFNBQVMsSUFBSTtBQUNyQixZQUFNLFlBQVksU0FBUyxXQUFXLElBQUk7QUFDMUMsVUFBSSxDQUFDLFdBQVc7QUFDZCxlQUFPLFNBQVMsTUFBTSxTQUFTLElBQUksSUFBSSxFQUFFLE9BQU8sbUJBQW1CLFFBQVEsS0FBSyxJQUFJLEVBQUUsT0FBTyxNQUFNLFFBQVEsTUFBTTtBQUFBLE1BQ25IO0FBQ0EsWUFBTSxVQUFVLE9BQU8sU0FBUyxVQUFVLElBQUk7QUFDOUMsVUFBSSxTQUFTLFdBQVcseUJBQXlCLFdBQVdBLFlBQVcsVUFBVSxNQUFNLE9BQU8sR0FBRztBQUMvRixlQUFPLEVBQUUsT0FBTyxhQUFhLFVBQVUsTUFBTSxPQUFPLEdBQUcsUUFBUSxDQUFDLG1CQUFtQixVQUFVLE1BQU0sT0FBTyxFQUFFO0FBQUEsTUFDOUc7QUFDQSxhQUFPLEVBQUUsT0FBTyxXQUFXLFFBQVEsTUFBTTtBQUFBLElBQzNDO0FBV0EsYUFBUyxrQkFBa0IsU0FBUyxRQUFRO0FBQzFDLFlBQU0sUUFBUSxPQUFPLFNBQVMsU0FBUyxDQUFDLENBQUMsT0FBTztBQUNoRCxZQUFNLFVBQVUsT0FBTyxTQUFTO0FBRWhDLGNBQVEsVUFBVSxPQUFPLFdBQVcsS0FBSztBQUN6QyxjQUFRLFVBQVUsT0FBTyxrQkFBa0IsU0FBUyxDQUFDLENBQUMsT0FBTyxNQUFNO0FBQ25FLGNBQVEsVUFBVSxPQUFPLGFBQWEsV0FBVyxPQUFPLE9BQU87QUFDL0QsY0FBUSxVQUFVLE9BQU8sbUJBQW1CLFdBQVcsQ0FBQyxPQUFPLE9BQU87QUFFdEUsVUFBSSxRQUFTLFNBQVEsUUFBUSxVQUFVLE9BQU87QUFBQSxVQUN6QyxRQUFPLFFBQVEsUUFBUTtBQUU1QixZQUFNLGNBQWUsU0FBUyxPQUFPLFNBQVcsV0FBVyxPQUFPLFdBQVcsT0FBTyxRQUFTLE9BQU8sUUFBUTtBQUM1RyxVQUFJLFlBQWEsU0FBUSxNQUFNLFlBQVksV0FBVyxXQUFXO0FBQUEsVUFDNUQsU0FBUSxNQUFNLGVBQWUsU0FBUztBQUFBLElBQzdDO0FBVUEsYUFBUyxrQkFBa0IsUUFBUSxTQUFTLFFBQVE7QUFDbEQsWUFBTSxlQUFlLE9BQU8sU0FBUztBQUVyQyxjQUFRLFVBQVUsT0FBTyxtQkFBbUIsZ0JBQWdCLE9BQU8sT0FBTztBQUMxRSxjQUFRLFVBQVUsT0FBTyx5QkFBeUIsZ0JBQWdCLENBQUMsT0FBTyxPQUFPO0FBRWpGLFlBQU0sUUFBUSxPQUFPLFNBQVM7QUFDOUIsY0FBUSxVQUFVLE9BQU8sdUJBQXVCLGdCQUFnQixVQUFVLFFBQVE7QUFDbEYsY0FBUSxVQUFVLE9BQU8sMEJBQTBCLGdCQUFnQixVQUFVLFFBQVE7QUFFckYsVUFBSSxhQUFjLFNBQVEsUUFBUSxVQUFVLE9BQU87QUFBQSxVQUM5QyxRQUFPLFFBQVEsUUFBUTtBQUU1QixZQUFNLGFBQWEsZ0JBQWdCLE9BQU8sV0FBVyxPQUFPLFFBQVEsT0FBTyxRQUFRO0FBQ25GLFVBQUksV0FBWSxTQUFRLE1BQU0sWUFBWSxpQkFBaUIsVUFBVTtBQUFBLFVBQ2hFLFNBQVEsTUFBTSxlQUFlLGVBQWU7QUFBQSxJQUNuRDtBQUVBLGFBQVMsdUJBQXVCLFFBQVE7QUFDdEMsaUJBQVcsUUFBUSxPQUFPLElBQUksVUFBVSxnQkFBZ0IsVUFBVSxHQUFHO0FBQ25FLGNBQU0sY0FBYyxLQUFLLEtBQUs7QUFDOUIsY0FBTSxPQUFPLEtBQUssS0FBSztBQUN2QixjQUFNLFlBQVksZ0JBQWdCLFFBQVEsT0FBTztBQUNqRCxjQUFNLFNBQVMsY0FBYyxRQUFRLFNBQVM7QUFFOUMsY0FBTSxVQUFVLFlBQVksY0FBYyxlQUFlO0FBQ3pELFlBQUksU0FBUztBQUNYLDRCQUFrQixTQUFTLE1BQU07QUFFakMsZ0JBQU0sWUFBWSxPQUFPLFNBQVMsV0FBVyxpQkFBaUIsYUFBYSxRQUFRLFdBQVcsZ0JBQWdCLElBQUk7QUFDbEgsY0FBSSxVQUFXLFNBQVEsTUFBTSxRQUFRO0FBQUEsY0FDaEMsU0FBUSxNQUFNLGVBQWUsT0FBTztBQUFBLFFBQzNDO0FBRUEsY0FBTSxVQUFVLFlBQVksY0FBYyxxQkFBcUI7QUFDL0QsWUFBSSxRQUFTLG1CQUFrQixRQUFRLFNBQVMsTUFBTTtBQUFBLE1BQ3hEO0FBQUEsSUFDRjtBQUVBLGFBQVNDLDJCQUEwQixRQUFRO0FBQ3pDLFlBQU0sVUFBVSxNQUFNLHVCQUF1QixNQUFNO0FBRW5ELGFBQU8sY0FBYyxPQUFPLFNBQVMsR0FBRyxVQUFVLE9BQU8sQ0FBQztBQUMxRCxhQUFPLGNBQWMsT0FBTyxJQUFJLFVBQVUsR0FBRyxhQUFhLE9BQU8sQ0FBQztBQUNsRSxhQUFPLGNBQWMsT0FBTyxJQUFJLFVBQVUsR0FBRyxzQkFBc0IsT0FBTyxDQUFDO0FBQzNFLGFBQU8sY0FBYyxPQUFPLElBQUksVUFBVSxHQUFHLGlCQUFpQixPQUFPLENBQUM7QUFFdEUsYUFBTyxJQUFJLFVBQVUsY0FBYyxPQUFPO0FBRTFDLGFBQU87QUFBQSxJQUNUO0FBRUEsSUFBQUYsUUFBTyxVQUFVLEVBQUUsMkJBQUFFLDJCQUEwQjtBQUFBO0FBQUE7OztBQzFLN0M7QUFBQSx1QkFBQUMsVUFBQUMsU0FBQTtBQUFBLFFBQU0sRUFBRSxpQkFBaUIsWUFBWSxJQUFJLFFBQVEsVUFBVTtBQUMzRCxRQUFNLEVBQUUsWUFBWSxXQUFXLElBQUksUUFBUSxrQkFBa0I7QUFDN0QsUUFBTSxFQUFFLE1BQU0saUJBQWlCLFlBQVksSUFBSSxRQUFRLG1CQUFtQjtBQUMxRSxRQUFNLEVBQUUsV0FBVyxJQUFJLFFBQVEsc0JBQXNCO0FBQ3JELFFBQU0sRUFBRSxhQUFhLElBQUk7QUFzQnpCLFFBQU0sWUFBWTtBQUNsQixRQUFNLGNBQWM7QUFLcEIsUUFBTSxtQkFBbUI7QUFFekIsYUFBUyxpQkFBaUIsUUFBUSxVQUFVLFlBQVk7QUFDdEQsWUFBTSxTQUFTLFNBQVMsTUFBTSxPQUFPLEVBQUUsQ0FBQyxFQUFFLEtBQUs7QUFDL0MsWUFBTSxXQUFXLFlBQVksTUFBTTtBQUNuQyxVQUFJLENBQUMsU0FBVSxRQUFPO0FBQ3RCLFlBQU0sT0FBTyxPQUFPLElBQUksY0FBYyxxQkFBcUIsVUFBVSxVQUFVO0FBQy9FLGFBQU8sYUFBYSxRQUFRLE1BQU0sT0FBTztBQUFBLElBQzNDO0FBSUEsYUFBUyxjQUFjLFFBQVEsVUFBVTtBQUN2QyxZQUFNLE9BQU8sU0FBUyxhQUFhLFdBQVc7QUFDOUMsWUFBTSxRQUNKLE9BQU8sU0FBUyxXQUFXLFNBQVMsUUFBUSxDQUFDLFNBQVMsVUFBVSxTQUFTLGVBQWUsSUFDcEYsaUJBQWlCLFFBQVEsTUFBTSxTQUFTLGFBQWEsV0FBVyxLQUFLLEVBQUUsSUFDdkU7QUFDTixVQUFJLE1BQU8sVUFBUyxNQUFNLFlBQVksV0FBVyxLQUFLO0FBQUEsVUFDakQsVUFBUyxNQUFNLGVBQWUsU0FBUztBQUFBLElBQzlDO0FBTUEsYUFBUyxxQkFBcUIsUUFBUTtBQUNwQyxZQUFNLE9BQU8sb0JBQUksSUFBSTtBQUNyQixhQUFPLElBQUksVUFBVSxpQkFBaUIsQ0FBQyxTQUFTLEtBQUssSUFBSSxLQUFLLEtBQUssWUFBWSxhQUFhLENBQUM7QUFDN0YsaUJBQVcsT0FBTyxNQUFNO0FBQ3RCLG1CQUFXLFlBQVksSUFBSSxpQkFBaUIsbUJBQW1CLFdBQVcsR0FBRyxFQUFHLGVBQWMsUUFBUSxRQUFRO0FBQUEsTUFDaEg7QUFBQSxJQUNGO0FBSUEsUUFBTSxnQkFBZ0IsWUFBWSxPQUFPO0FBRXpDLGFBQVMsb0JBQW9CLFFBQVE7QUFDbkMsWUFBTSxxQkFBcUIsb0JBQUksSUFBSTtBQUNuQyxZQUFNLGdCQUFnQixDQUFDLFVBQVU7QUFDL0IsWUFBSSxhQUFhLG1CQUFtQixJQUFJLEtBQUs7QUFDN0MsWUFBSSxDQUFDLFlBQVk7QUFDZix1QkFBYSxXQUFXLEtBQUs7QUFBQSxZQUMzQixPQUFPO0FBQUEsWUFDUCxZQUFZLEVBQUUsT0FBTyxHQUFHLFNBQVMsS0FBSyxLQUFLLElBQUk7QUFBQSxVQUNqRCxDQUFDO0FBQ0QsNkJBQW1CLElBQUksT0FBTyxVQUFVO0FBQUEsUUFDMUM7QUFDQSxlQUFPO0FBQUEsTUFDVDtBQUVBLFlBQU0sUUFBUSxDQUFDLFNBQVM7QUFDdEIsWUFBSSxDQUFDLE9BQU8sU0FBUyxXQUFXLE1BQU8sUUFBTyxXQUFXO0FBQ3pELGNBQU0sYUFBYSxLQUFLLE1BQU0sTUFBTSxpQkFBaUIsS0FBSyxHQUFHLE1BQU0sUUFBUTtBQUMzRSxjQUFNLE9BQU8sV0FBVyxLQUFLLEtBQUs7QUFDbEMsY0FBTSxVQUFVLElBQUksZ0JBQWdCO0FBRXBDLG1CQUFXLEVBQUUsTUFBTSxHQUFHLEtBQUssS0FBSyxlQUFlO0FBQzdDLGdCQUFNLE9BQU8sS0FBSyxNQUFNLFNBQVMsTUFBTSxFQUFFO0FBQ3pDLDJCQUFpQixZQUFZO0FBQzdCLG1CQUFTLE9BQVEsUUFBUSxpQkFBaUIsS0FBSyxJQUFJLEtBQU07QUFDdkQsa0JBQU0sUUFBUSxPQUFPLE1BQU07QUFHM0IsZ0JBQUksQ0FBQyxLQUFLLGFBQWEsUUFBUSxHQUFHLENBQUMsRUFBRSxLQUFLLFNBQVMsbUJBQW1CLEVBQUc7QUFDekUsa0JBQU0sUUFBUSxpQkFBaUIsUUFBUSxNQUFNLENBQUMsR0FBRyxVQUFVO0FBQzNELGdCQUFJLE1BQU8sU0FBUSxJQUFJLE9BQU8sUUFBUSxNQUFNLENBQUMsRUFBRSxRQUFRLGNBQWMsS0FBSyxDQUFDO0FBQUEsVUFDN0U7QUFBQSxRQUNGO0FBQ0EsZUFBTyxRQUFRLE9BQU87QUFBQSxNQUN4QjtBQUVBLGFBQU8sV0FBVztBQUFBLFFBQ2hCLE1BQU07QUFBQSxVQUNKLFlBQVksTUFBTTtBQUNoQixpQkFBSyxjQUFjLE1BQU0sSUFBSTtBQUFBLFVBQy9CO0FBQUE7QUFBQTtBQUFBLFVBSUEsT0FBTyxRQUFRO0FBQ2IsZ0JBQ0UsT0FBTyxjQUNQLE9BQU8sbUJBQ1AsV0FBVyxPQUFPLFVBQVUsTUFBTSxXQUFXLE9BQU8sS0FBSyxLQUN6RCxPQUFPLGFBQWEsS0FBSyxDQUFDLE9BQU8sR0FBRyxRQUFRLEtBQUssQ0FBQyxXQUFXLE9BQU8sR0FBRyxhQUFhLENBQUMsQ0FBQyxHQUN0RjtBQUNBLG1CQUFLLGNBQWMsTUFBTSxPQUFPLElBQUk7QUFBQSxZQUN0QztBQUFBLFVBQ0Y7QUFBQSxRQUNGO0FBQUEsUUFDQSxFQUFFLGFBQWEsQ0FBQyxVQUFVLE1BQU0sWUFBWTtBQUFBLE1BQzlDO0FBQUEsSUFDRjtBQUVBLGFBQVMsZUFBZSxRQUFRO0FBQzlCLGFBQU8sSUFBSSxVQUFVLGlCQUFpQixDQUFDLFNBQVM7QUFDOUMsYUFBSyxNQUFNLFFBQVEsSUFBSSxTQUFTLEVBQUUsU0FBUyxjQUFjLEdBQUcsSUFBSSxFQUFFLENBQUM7QUFBQSxNQUNyRSxDQUFDO0FBQUEsSUFDSDtBQUlBLGFBQVNDLG9CQUFtQixRQUFRO0FBQ2xDLGFBQU8sOEJBQThCLENBQUMsSUFBSSxRQUFRO0FBR2hELG1CQUFXLFlBQVksR0FBRyxpQkFBaUIsaUJBQWlCLEdBQUc7QUFDN0QsbUJBQVMsYUFBYSxhQUFhLElBQUksVUFBVTtBQUNqRCx3QkFBYyxRQUFRLFFBQVE7QUFBQSxRQUNoQztBQUFBLE1BQ0YsQ0FBQztBQUtELGFBQU8sd0JBQXdCLEtBQUssT0FBTyxvQkFBb0IsTUFBTSxDQUFDLENBQUM7QUFFdkUsWUFBTSxVQUFVLE1BQU07QUFDcEIsNkJBQXFCLE1BQU07QUFDM0IsdUJBQWUsTUFBTTtBQUFBLE1BQ3ZCO0FBQ0EsYUFBTyxjQUFjLE9BQU8sU0FBUyxHQUFHLFVBQVUsT0FBTyxDQUFDO0FBRzFELGFBQU8sU0FBUyxNQUFNO0FBQ3BCLGVBQU8sSUFBSSxVQUFVLGlCQUFpQixDQUFDLFNBQVM7QUFDOUMscUJBQVcsWUFBWSxLQUFLLEtBQUssWUFBWSxpQkFBaUIsbUJBQW1CLFdBQVcsR0FBRyxHQUFHO0FBQ2hHLHFCQUFTLE1BQU0sZUFBZSxTQUFTO0FBQUEsVUFDekM7QUFBQSxRQUNGLENBQUM7QUFBQSxNQUNILENBQUM7QUFDRCxhQUFPO0FBQUEsSUFDVDtBQUVBLElBQUFELFFBQU8sVUFBVSxFQUFFLG9CQUFBQyxvQkFBbUI7QUFBQTtBQUFBOzs7QUN4S3RDO0FBQUEseUNBQUFDLFVBQUFDLFNBQUE7QUFBQSxRQUFNLEVBQUUsaUJBQUFDLGtCQUFpQixZQUFBQyxZQUFXLElBQUk7QUFDeEMsUUFBTSxFQUFFLGFBQWEsSUFBSTtBQUV6QixRQUFNQyxnQkFBZTtBQUNyQixRQUFNLGdCQUFnQjtBQUN0QixRQUFNLDJCQUEyQjtBQUNqQyxRQUFNLGtCQUFrQjtBQUl4QixRQUFNLGlCQUFpQjtBQU92QixhQUFTLGVBQWUsTUFBTSxVQUFVO0FBQ3RDLFVBQUksQ0FBQyxRQUFRLENBQUMsU0FBVSxRQUFPO0FBQy9CLFlBQU0sT0FBTyxPQUFPLEtBQUssUUFBUSxFQUFFLE9BQU8sQ0FBQyxRQUFRLFFBQVEsTUFBTSxJQUFJLFlBQVksTUFBTUEsY0FBYSxZQUFZLENBQUM7QUFDakgsYUFBTyxLQUFLLFNBQVMsSUFBSSxLQUFLLElBQUksQ0FBQyxRQUFRLElBQUksWUFBWSxDQUFDLElBQUk7QUFBQSxJQUNsRTtBQU1BLFFBQU0sZUFBZSxPQUFPLGNBQWM7QUFFMUMsYUFBUyxRQUFRLFVBQVUsY0FBYyxVQUFVLE1BQU07QUFDdkQsWUFBTSxPQUFPLGVBQWUsTUFBTSxRQUFRLEtBQUssQ0FBQztBQUNoRCxhQUFPLEVBQUUsU0FBUyxNQUFNLFVBQVUsSUFBSSxLQUFLLGdCQUFnQixDQUFDLEdBQUcsSUFBSSxDQUFDLFFBQVEsSUFBSSxZQUFZLENBQUMsQ0FBQyxFQUFFO0FBQUEsSUFDbEc7QUFFQSxhQUFTLGNBQWMsUUFBUSxNQUFNLFNBQVM7QUFDNUMsWUFBTSxFQUFFLFNBQVMsSUFBSTtBQUNyQixZQUFNLFNBQVMsQ0FBQyxRQUFRLFNBQVMsdUJBQXVCLElBQUksR0FBRyxTQUFTLGlCQUFpQixJQUFJLEdBQUcsSUFBSSxDQUFDO0FBQ3JHLFlBQU0sZUFBZSxZQUFZLGVBQWVGLGlCQUFnQixVQUFVLElBQUksSUFBSSxVQUFVLENBQUMsT0FBTyxJQUFJLENBQUM7QUFDekcsaUJBQVcsUUFBUSxjQUFjO0FBQy9CLGNBQU0sT0FBT0MsWUFBVyxVQUFVLE1BQU0sSUFBSTtBQUM1QyxZQUFJLEtBQU0sUUFBTyxLQUFLLFFBQVEsS0FBSyxhQUFhLEtBQUssY0FBYyxJQUFJLENBQUM7QUFBQSxNQUMxRTtBQUNBLGFBQU87QUFBQSxJQUNUO0FBU0EsYUFBUyxVQUFVLFFBQVE7QUFDekIsWUFBTSxhQUFhLG9CQUFJLElBQUk7QUFDM0IsaUJBQVcsRUFBRSxNQUFNLFVBQUFFLFVBQVMsS0FBSyxRQUFRO0FBQ3ZDLG1CQUFXLE9BQU8sS0FBTSxZQUFXLElBQUksS0FBS0EsVUFBUyxJQUFJLEdBQUcsQ0FBQztBQUFBLE1BQy9EO0FBQ0EsWUFBTSxXQUFXLG9CQUFJLElBQUk7QUFDekIsWUFBTSxXQUFXLG9CQUFJLElBQUk7QUFDekIsaUJBQVcsQ0FBQyxLQUFLLElBQUksS0FBSyxXQUFZLEVBQUMsT0FBTyxXQUFXLFVBQVUsSUFBSSxHQUFHO0FBQzFFLGFBQU8sRUFBRSxVQUFVLFNBQVMsT0FBTyxJQUFJLFdBQVcsTUFBTSxVQUFVLFNBQVMsT0FBTyxJQUFJLFdBQVcsS0FBSztBQUFBLElBQ3hHO0FBRUEsUUFBTSxVQUFVLEVBQUUsVUFBVSxNQUFNLFVBQVUsS0FBSztBQUVqRCxhQUFTLFlBQVksUUFBUSxNQUFNO0FBQ2pDLFlBQU0sRUFBRSxXQUFXLElBQUksT0FBTztBQUM5QixVQUFJLENBQUMsV0FBVyxvQkFBcUIsUUFBTztBQUM1QyxZQUFNLE9BQU8sT0FBTyxTQUFTLE9BQU8sSUFBSTtBQUN4QyxVQUFJLENBQUMsS0FBTSxRQUFPO0FBQ2xCLFlBQU0sVUFBVSxXQUFXLDRCQUE0QixPQUFPLFNBQVMsVUFBVSxJQUFJLElBQUk7QUFDekYsYUFBTyxVQUFVLGNBQWMsUUFBUSxNQUFNLE9BQU8sQ0FBQztBQUFBLElBQ3ZEO0FBTUEsYUFBUyxhQUFhLFFBQVEsT0FBTztBQUNuQyxZQUFNLEVBQUUsV0FBVyxJQUFJLE9BQU87QUFDOUIsVUFBSSxDQUFDLFdBQVcsdUJBQXVCLENBQUMsTUFBTyxRQUFPO0FBQ3RELFVBQUksTUFBTSxXQUFXLENBQUMsV0FBVywwQkFBMkIsUUFBTztBQUNuRSxhQUFPLFVBQVUsQ0FBQyxRQUFRLE1BQU0sZUFBZSxHQUFHLE1BQU0sWUFBWSxDQUFDLENBQUMsQ0FBQztBQUFBLElBQ3pFO0FBZUEsYUFBUyxpQkFBaUIsUUFBUTtBQUNoQyxZQUFNLE1BQU0sb0JBQUksSUFBSTtBQUNwQixZQUFNLEVBQUUsV0FBVyxJQUFJLE9BQU87QUFDOUIsVUFBSSxDQUFDLFdBQVcsY0FBZSxRQUFPO0FBQ3RDLFlBQU0sUUFBUSxvQkFBSSxJQUFJO0FBQUEsUUFDcEIsR0FBRyxPQUFPLEtBQUssT0FBTyxTQUFTLHNCQUFzQjtBQUFBLFFBQ3JELEdBQUksV0FBVyxzQkFBc0IsT0FBTyxLQUFLLE9BQU8sU0FBUyxnQkFBZ0IsQ0FBQyxDQUFDLElBQUksQ0FBQztBQUFBLE1BQzFGLENBQUM7QUFDRCxpQkFBVyxRQUFRLE9BQU87QUFDeEIsY0FBTSxTQUFTLGNBQWMsUUFBUSxNQUFNLFdBQVcsc0JBQXNCLGVBQWUsSUFBSTtBQUMvRixtQkFBVyxFQUFFLFNBQVMsTUFBTSxTQUFTLEtBQUssUUFBUTtBQUNoRCxxQkFBVyxPQUFPLE1BQU07QUFDdEIsZ0JBQUksQ0FBQyxJQUFJLElBQUksR0FBRyxFQUFHLEtBQUksSUFBSSxLQUFLLEVBQUUsT0FBTyxvQkFBSSxJQUFJLEdBQUcsYUFBYSxLQUFLLENBQUM7QUFDdkUsa0JBQU0sUUFBUSxJQUFJLElBQUksR0FBRztBQUN6QixnQkFBSSxDQUFDLE1BQU0sTUFBTSxJQUFJLElBQUksRUFBRyxPQUFNLE1BQU0sSUFBSSxNQUFNLENBQUMsQ0FBQztBQUNwRCxrQkFBTSxNQUFNLElBQUksSUFBSSxFQUFFLEtBQUssT0FBTztBQUNsQyxrQkFBTSxjQUFjLE1BQU0sZUFBZSxTQUFTLElBQUksR0FBRztBQUFBLFVBQzNEO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFDQSxhQUFPO0FBQUEsSUFDVDtBQUtBLGFBQVMsaUJBQWlCLGFBQWEsY0FBYyxjQUFjO0FBQ2pFLFVBQUksQ0FBQyxZQUFhO0FBQ2xCLFlBQU0sT0FBTyxZQUFZLGlCQUFpQix1Q0FBdUM7QUFDakYsaUJBQVcsT0FBTyxNQUFNO0FBQ3RCLGNBQU0sUUFBUSxJQUFJLGNBQWMsOEJBQThCO0FBQzlELFlBQUksQ0FBQyxNQUFPO0FBQ1osY0FBTSxjQUFjLElBQUksYUFBYSxtQkFBbUI7QUFDeEQsY0FBTSxVQUFVLE9BQU8saUJBQWlCLENBQUMsQ0FBQyxnQkFBZ0IsYUFBYSxJQUFJLFdBQVcsQ0FBQztBQUN2RixjQUFNLFVBQVUsT0FBTyxnQkFBZ0IsQ0FBQyxDQUFDLGdCQUFnQixhQUFhLElBQUksV0FBVyxDQUFDO0FBQUEsTUFDeEY7QUFBQSxJQUNGO0FBYUEsYUFBUyx5QkFBeUIsUUFBUTtBQUN4QyxZQUFNLFdBQVcsaUJBQWlCLE1BQU07QUFDeEMsaUJBQVcsUUFBUSxPQUFPLElBQUksVUFBVSxnQkFBZ0Isd0JBQXdCLEdBQUc7QUFDakYsY0FBTSxPQUFPLEtBQUssTUFBTTtBQUN4QixZQUFJLENBQUMsS0FBTTtBQUNYLG1CQUFXLENBQUMsS0FBSyxHQUFHLEtBQUssT0FBTyxRQUFRLElBQUksR0FBRztBQUM3QyxnQkFBTSxVQUFVLEtBQUs7QUFDckIsY0FBSSxDQUFDLFFBQVM7QUFFZCxnQkFBTSxRQUFRLFNBQVMsSUFBSSxJQUFJLFlBQVksQ0FBQztBQUM1QyxnQkFBTSxRQUFRLE9BQU87QUFDckIsZ0JBQU0sUUFBUSxRQUFRLE1BQU0sT0FBTztBQUNuQyxrQkFBUSxVQUFVLE9BQU8saUJBQWlCLFFBQVEsQ0FBQztBQU1uRCxrQkFBUSxVQUFVLE9BQU8sZ0JBQWdCLFFBQVEsS0FBSyxNQUFNLFdBQVc7QUFPdkUsY0FBSSxVQUFVLEdBQUc7QUFDZixrQkFBTSxDQUFDLENBQUMsVUFBVSxRQUFRLENBQUMsSUFBSTtBQUMvQixrQkFBTSxRQUFRLE9BQU8sU0FBUyxXQUFXLHNCQUNyQyxhQUFhLE9BQU8sVUFBVSxVQUFVLFNBQVMsV0FBVyxJQUFJLFNBQVMsQ0FBQyxJQUFJLElBQUksSUFDbEYsT0FBTyxTQUFTLFdBQVcsUUFBUTtBQUt2QyxnQkFBSSxNQUFPLFNBQVEsTUFBTSxZQUFZLFNBQVMsT0FBTyxXQUFXO0FBQUEsZ0JBQzNELFNBQVEsTUFBTSxlQUFlLE9BQU87QUFBQSxVQUMzQyxPQUFPO0FBQ0wsb0JBQVEsTUFBTSxlQUFlLE9BQU87QUFBQSxVQUN0QztBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUVBLGFBQVMsaUNBQWlDLFFBQVE7QUFDaEQsaUJBQVcsUUFBUSxPQUFPLElBQUksVUFBVSxnQkFBZ0IsVUFBVSxHQUFHO0FBQ25FLGNBQU0sT0FBTyxLQUFLO0FBQ2xCLGNBQU0sRUFBRSxVQUFVLFNBQVMsSUFBSSxZQUFZLFFBQVEsTUFBTSxJQUFJO0FBQzdELHlCQUFpQixNQUFNLGdCQUFnQixhQUFhLFVBQVUsUUFBUTtBQUFBLE1BQ3hFO0FBS0EsaUJBQVcsUUFBUSxPQUFPLElBQUksVUFBVSxnQkFBZ0IsaUJBQWlCLEdBQUc7QUFDMUUsY0FBTSxPQUFPLEtBQUs7QUFDbEIsY0FBTSxPQUFPLE1BQU0sUUFBUSxPQUFPLElBQUksVUFBVSxjQUFjO0FBQzlELGNBQU0sRUFBRSxVQUFVLFNBQVMsSUFBSSxZQUFZLFFBQVEsSUFBSTtBQUN2RCx5QkFBaUIsTUFBTSxnQkFBZ0IsYUFBYSxVQUFVLFFBQVE7QUFBQSxNQUN4RTtBQU1BLGlCQUFXLFFBQVEsT0FBTyxJQUFJLFVBQVUsZ0JBQWdCLGFBQWEsR0FBRztBQUN0RSxtQkFBVyxVQUFVLEtBQUssTUFBTSxzQkFBc0IsQ0FBQyxHQUFHO0FBQ3hELGdCQUFNLEVBQUUsVUFBVSxTQUFTLElBQUksYUFBYSxRQUFRLE9BQU8sT0FBTyxTQUFTO0FBQzNFLDJCQUFpQixPQUFPLGFBQWEsVUFBVSxRQUFRO0FBQUEsUUFDekQ7QUFBQSxNQUNGO0FBRUEsK0JBQXlCLE1BQU07QUFBQSxJQUNqQztBQUVBLGFBQVNDLHFDQUFvQyxRQUFRO0FBQ25ELFlBQU0sVUFBVSxNQUFNLGlDQUFpQyxNQUFNO0FBRTdELGFBQU8sY0FBYyxPQUFPLElBQUksY0FBYyxHQUFHLFdBQVcsT0FBTyxDQUFDO0FBQ3BFLGFBQU8sY0FBYyxPQUFPLElBQUksY0FBYyxHQUFHLFlBQVksT0FBTyxDQUFDO0FBQ3JFLGFBQU8sY0FBYyxPQUFPLElBQUksVUFBVSxHQUFHLGlCQUFpQixPQUFPLENBQUM7QUFDdEUsYUFBTyxjQUFjLE9BQU8sSUFBSSxVQUFVLEdBQUcsc0JBQXNCLE9BQU8sQ0FBQztBQUUzRSxhQUFPLElBQUksVUFBVSxjQUFjLE9BQU87QUFFMUMsYUFBTztBQUFBLElBQ1Q7QUFFQSxJQUFBTCxRQUFPLFVBQVUsRUFBRSxxQ0FBQUsscUNBQW9DO0FBQUE7QUFBQTs7O0FDMU92RDtBQUFBLGdDQUFBQyxVQUFBQyxTQUFBO0FBQUEsUUFBTSxFQUFFLE9BQU8sSUFBSSxRQUFRLFVBQVU7QUFDckMsUUFBTSxFQUFFLFdBQVcsYUFBYSxJQUFJO0FBQ3BDLFFBQU0sRUFBRSxpQkFBQUMsa0JBQWlCLGFBQWEsSUFBSTtBQUUxQyxRQUFNQyxnQkFBZTtBQUNyQixRQUFNQyxtQkFBa0I7QUFLeEIsYUFBUyxRQUFRLEdBQUcsR0FBRztBQUNyQixhQUFPLEVBQUUsWUFBWSxNQUFNLEVBQUUsWUFBWTtBQUFBLElBQzNDO0FBUUEsYUFBUyxjQUFjLE9BQU8sUUFBUSxRQUFRO0FBQzVDLFlBQU0sV0FBVyxNQUFNLGVBQWU7QUFDdEMsWUFBTSxPQUFPLE9BQU8sS0FBSyxRQUFRO0FBQ2pDLFlBQU0sWUFBWSxLQUFLLEtBQUssQ0FBQyxRQUFRLFFBQVEsS0FBSyxNQUFNLENBQUM7QUFDekQsVUFBSSxjQUFjLE9BQVcsUUFBTztBQUdwQyxZQUFNLFlBQVksS0FBSyxLQUFLLENBQUMsUUFBUSxRQUFRLGFBQWEsUUFBUSxLQUFLLE1BQU0sQ0FBQztBQUM5RSxVQUFJLGNBQWMsVUFBYSxjQUFjLE9BQVEsUUFBTztBQUU1RCxZQUFNLE9BQU8sQ0FBQztBQUNkLGlCQUFXLE9BQU8sTUFBTTtBQUN0QixZQUFJLFFBQVEsV0FBVztBQUNyQixlQUFLLEdBQUcsSUFBSSxTQUFTLEdBQUc7QUFBQSxRQUMxQixXQUFXLGNBQWMsUUFBVztBQUNsQyxlQUFLLE1BQU0sSUFBSSxTQUFTLFNBQVM7QUFBQSxRQUNuQztBQUFBLE1BQ0Y7QUFDQSxVQUFJLGNBQWMsVUFBYSxhQUFhLEtBQUssU0FBUyxDQUFDLEVBQUcsTUFBSyxTQUFTLElBQUksU0FBUyxTQUFTO0FBQ2xHLFlBQU0sZUFBZSxJQUFJO0FBRXpCLFlBQU0sV0FBVyxNQUFNLFlBQVk7QUFDbkMsVUFBSSxTQUFTLFNBQVMsR0FBRztBQUV2QixjQUFNO0FBQUEsVUFDSixjQUFjLFNBQ1YsU0FBUyxPQUFPLENBQUMsUUFBUSxRQUFRLFNBQVMsSUFDMUMsU0FBUyxJQUFJLENBQUMsUUFBUyxRQUFRLFlBQVksU0FBUyxHQUFJO0FBQUEsUUFDOUQ7QUFBQSxNQUNGO0FBS0EsWUFBTSxZQUFZLEVBQUUsR0FBRyxNQUFNLGFBQWEsRUFBRTtBQUM1QyxVQUFJLFVBQVUsU0FBUyxHQUFHO0FBQ3hCLFlBQUksY0FBYyxPQUFXLFdBQVUsTUFBTSxJQUFJLFVBQVUsU0FBUztBQUNwRSxlQUFPLFVBQVUsU0FBUztBQUMxQixjQUFNLGFBQWEsU0FBUztBQUFBLE1BQzlCO0FBQ0EsYUFBTztBQUFBLElBQ1Q7QUFLQSxhQUFTLG9CQUFvQixVQUFVLFFBQVEsUUFBUTtBQUNyRCxZQUFNLFFBQVEsU0FBUztBQUN2QixZQUFNLFNBQVMsTUFBTSxLQUFLLENBQUMsVUFBVSxNQUFNLFNBQVMsY0FBYyxRQUFRLE1BQU0sTUFBTSxNQUFNLENBQUM7QUFDN0YsVUFBSSxDQUFDLE9BQVEsUUFBTztBQUNwQixZQUFNLFNBQVMsTUFBTSxLQUFLLENBQUMsVUFBVSxVQUFVLFVBQVUsTUFBTSxTQUFTLGNBQWMsUUFBUSxNQUFNLE1BQU0sTUFBTSxDQUFDO0FBQ2pILFVBQUksT0FBUSxVQUFTLHNCQUFzQixNQUFNLE9BQU8sQ0FBQyxVQUFVLFVBQVUsTUFBTTtBQUFBLGVBQzFFLE9BQU8sU0FBUyxPQUFRLFFBQU87QUFBQSxVQUNuQyxRQUFPLE9BQU87QUFDbkIsYUFBTztBQUFBLElBQ1Q7QUFFQSxtQkFBZSxXQUFXLFFBQVEsUUFBUSxRQUFRO0FBQ2hELFVBQUksT0FBTyxXQUFXLFlBQVksT0FBTyxXQUFXLFNBQVU7QUFDOUQsZUFBUyxPQUFPLEtBQUs7QUFDckIsVUFBSSxXQUFXLE1BQU0sV0FBVyxNQUFNLFdBQVcsT0FBUTtBQUl6RCxVQUFJLENBQUMsUUFBUSxNQUFNLEVBQUUsS0FBSyxDQUFDLFFBQVEsUUFBUSxLQUFLRCxhQUFZLEtBQUssUUFBUSxLQUFLQyxnQkFBZSxDQUFDLEVBQUc7QUFFakcsWUFBTSxFQUFFLFNBQVMsSUFBSTtBQUNyQixVQUFJLFlBQVk7QUFDaEIsVUFBSSxlQUFlO0FBQ25CLFlBQU0sUUFBUSxDQUFDLFVBQVcsTUFBTSxVQUFVLGlCQUFpQjtBQUMzRCxZQUFNLFFBQVEsb0JBQUksSUFBSSxDQUFDLEdBQUcsT0FBTyxLQUFLLFNBQVMsc0JBQXNCLEdBQUcsR0FBRyxPQUFPLEtBQUssU0FBUyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNwSCxpQkFBVyxRQUFRLE9BQU87QUFDeEIsY0FBTSxTQUFTLENBQUMsVUFBVSxRQUFRLElBQUksR0FBRyxHQUFHRixpQkFBZ0IsVUFBVSxJQUFJLEVBQUUsSUFBSSxDQUFDLFlBQVksYUFBYSxRQUFRLE1BQU0sT0FBTyxDQUFDLENBQUM7QUFPakksbUJBQVcsU0FBUyxRQUFRO0FBQzFCLGNBQUksY0FBYyxPQUFPLFFBQVEsTUFBTSxFQUFHLE9BQU0sS0FBSztBQUFBLFFBQ3ZEO0FBQUEsTUFDRjtBQUNBLFlBQU0sZUFBZSxvQkFBb0IsVUFBVSxRQUFRLE1BQU07QUFDakUsVUFBSSxjQUFjLEtBQUssaUJBQWlCLEtBQUssQ0FBQyxhQUFjO0FBRTVELFlBQU0sT0FBTyxhQUFhO0FBQzFCLGFBQU8sbUJBQW1CO0FBRTFCLFlBQU0sUUFBUSxDQUFDO0FBQ2YsVUFBSSxZQUFZLEVBQUcsT0FBTSxLQUFLLEdBQUcsU0FBUyxPQUFPLGNBQWMsSUFBSSxLQUFLLElBQUksRUFBRTtBQUM5RSxVQUFJLGVBQWUsRUFBRyxPQUFNLEtBQUssR0FBRyxZQUFZLFVBQVUsaUJBQWlCLElBQUksS0FBSyxJQUFJLEVBQUU7QUFDMUYsVUFBSSxhQUFjLE9BQU0sS0FBSyxzQkFBc0I7QUFDbkQsVUFBSSxPQUFPLHFCQUFnQixNQUFNLHVCQUFRLE1BQU0sYUFBUSxNQUFNLEtBQUssT0FBTyxDQUFDLGFBQWE7QUFBQSxJQUN6RjtBQVNBLGFBQVNHLDRCQUEyQixRQUFRO0FBQzFDLFlBQU0sY0FBYyxPQUFPLElBQUk7QUFDL0IsVUFBSSxZQUFZLDJCQUE0QjtBQUM1QyxrQkFBWSw2QkFBNkI7QUFFekMsWUFBTSxXQUFXLFlBQVk7QUFDN0Isa0JBQVksaUJBQWlCLGVBQWdCLFFBQVEsV0FBVyxNQUFNO0FBR3BFLGNBQU0sU0FBUyxNQUFNLFNBQVMsS0FBSyxNQUFNLFFBQVEsUUFBUSxHQUFHLElBQUk7QUFDaEUsWUFBSTtBQUNGLGdCQUFNLFdBQVcsUUFBUSxRQUFRLE1BQU07QUFBQSxRQUN6QyxTQUFTLE9BQU87QUFDZCxrQkFBUSxNQUFNLHdEQUFxRCxLQUFLO0FBQ3hFLGNBQUksT0FBTyxxQ0FBZ0MsTUFBTSxxQ0FBd0IsTUFBTSxPQUFPLEVBQUU7QUFBQSxRQUMxRjtBQUNBLGVBQU87QUFBQSxNQUNUO0FBRUEsYUFBTyxTQUFTLE1BQU07QUFDcEIsb0JBQVksaUJBQWlCO0FBQzdCLGVBQU8sWUFBWTtBQUFBLE1BQ3JCLENBQUM7QUFBQSxJQUNIO0FBRUEsSUFBQUosUUFBTyxVQUFVLEVBQUUsNEJBQUFJLDRCQUEyQjtBQUFBO0FBQUE7OztBQ3BKOUM7QUFBQSx1QkFBQUMsVUFBQUMsU0FBQTtBQUFBLFFBQU0sRUFBRSxtQkFBbUIsUUFBUSxtQkFBbUIsSUFBSSxRQUFRLFVBQVU7QUFDNUUsUUFBTSxFQUFFLGNBQWMsb0JBQUFDLG9CQUFtQixJQUFJO0FBQzdDLFFBQU0sRUFBRSxXQUFXLGNBQWMsSUFBSTtBQVNyQyxRQUFNLGlCQUFOLGNBQTZCLGtCQUFrQjtBQUFBLE1BQzdDLFlBQVksS0FBSyxRQUFRLE9BQU8sU0FBUztBQUN2QyxjQUFNLEdBQUc7QUFDVCxhQUFLLFNBQVM7QUFDZCxhQUFLLFFBQVE7QUFDYixhQUFLLFVBQVU7QUFDZixhQUFLLFNBQVM7QUFDZCxhQUFLLGVBQWUsb0JBQWlCO0FBQUEsTUFDdkM7QUFBQSxNQUVBLFdBQVc7QUFDVCxlQUFPLEtBQUs7QUFBQSxNQUNkO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQU1BLFlBQVksTUFBTTtBQUNoQixlQUFPLENBQUMsS0FBSyxNQUFNLEtBQUssVUFBVSxLQUFLLEdBQUcsR0FBRyxLQUFLLFdBQVcsRUFBRSxPQUFPLE9BQU8sRUFBRSxLQUFLLEdBQUc7QUFBQSxNQUN6RjtBQUFBLE1BRUEsaUJBQWlCLE9BQU8sSUFBSTtBQUMxQixjQUFNLE9BQU8sTUFBTTtBQUNuQixXQUFHLFNBQVMsNEJBQTRCO0FBQ3hDLFlBQUksS0FBSyxhQUFjLElBQUcsU0FBUyw4QkFBOEI7QUFFakUsWUFBSSxLQUFLLGNBQWM7QUFDckIsYUFBRyxXQUFXLEVBQUUsS0FBSyx3QkFBd0IsTUFBTSxLQUFLLEtBQUssQ0FBQztBQUFBLFFBQ2hFLE9BQU87QUFDTCxlQUFLLGtCQUFrQixJQUFJLEtBQUssTUFBTSxLQUFLLElBQUk7QUFBQSxRQUNqRDtBQUVBLFlBQUksS0FBSyxVQUFVLE9BQVEsTUFBSyxxQkFBcUIsSUFBSSxJQUFJO0FBRTdELFlBQUksS0FBSyxhQUFhO0FBQ3BCLGFBQUcsV0FBVyxFQUFFLEtBQUssd0JBQXdCLE1BQU0sS0FBSyxZQUFZLENBQUM7QUFBQSxRQUN2RTtBQUVBLFdBQUcsV0FBVyxFQUFFLEtBQUsseUJBQXlCLE1BQU0sT0FBTyxLQUFLLEtBQUssRUFBRSxDQUFDO0FBQUEsTUFDMUU7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BTUEsa0JBQWtCLElBQUksTUFBTSxXQUFXLFVBQVUsTUFBTTtBQUNyRCxjQUFNLEVBQUUsT0FBTyxVQUFVLElBQUksVUFBVSxLQUFLLE9BQU8sVUFBVSxXQUFXLE9BQU87QUFDL0UsWUFBSSxLQUFLLE9BQU8sU0FBUyxXQUFXLFNBQVM7QUFDM0MsYUFBRyxXQUFXLEVBQUUsS0FBSyx3QkFBd0IsS0FBSyxDQUFDLEVBQUUsTUFBTSxRQUFRO0FBQUEsUUFDckUsT0FBTztBQUNMLHdCQUFjLEdBQUcsV0FBVyxFQUFFLEtBQUssc0JBQXNCLENBQUMsR0FBRyxPQUFPLFNBQVM7QUFDN0UsYUFBRyxXQUFXLEVBQUUsS0FBSyx3QkFBd0IsS0FBSyxDQUFDO0FBQUEsUUFDckQ7QUFBQSxNQUNGO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLE1BT0EscUJBQXFCLElBQUksTUFBTTtBQUM3QixjQUFNLFdBQVcsS0FBSyxPQUFPLFNBQVMsV0FBVztBQUNqRCxjQUFNLE9BQU8sR0FBRyxXQUFXLEVBQUUsS0FBSywyQkFBMkIsQ0FBQztBQUM5RCxhQUFLLFdBQVcsR0FBRztBQUNuQixhQUFLLFNBQVMsUUFBUSxDQUFDLFNBQVMsVUFBVTtBQUN4QyxjQUFJLFFBQVEsRUFBRyxNQUFLLFdBQVcsSUFBSTtBQUNuQyxnQkFBTSxPQUFPLEtBQUssV0FBVyxFQUFFLE1BQU0sUUFBUSxDQUFDO0FBQzlDLGNBQUksU0FBVSxNQUFLLE1BQU0sUUFBUSxVQUFVLEtBQUssT0FBTyxVQUFVLEtBQUssTUFBTSxPQUFPLEVBQUU7QUFBQSxRQUN2RixDQUFDO0FBQ0QsYUFBSyxXQUFXLEdBQUc7QUFBQSxNQUNyQjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQVVBLGlCQUFpQixNQUFNLEtBQUs7QUFDMUIsYUFBSyxTQUFTO0FBR2QsYUFBSyxRQUFRLEtBQUssUUFBUSxNQUFNLEtBQUs7QUFDckMsY0FBTSxpQkFBaUIsTUFBTSxHQUFHO0FBQUEsTUFDbEM7QUFBQSxNQUVBLGFBQWEsTUFBTTtBQUNqQixhQUFLLFFBQVEsS0FBSyxJQUFJO0FBQUEsTUFDeEI7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQUtBLFVBQVU7QUFDUixjQUFNLFFBQVE7QUFDZCxZQUFJLENBQUMsS0FBSyxPQUFRLE1BQUssUUFBUSxJQUFJO0FBQUEsTUFDckM7QUFBQSxJQUNGO0FBUUEsUUFBTSxvQkFBTixjQUFnQyxlQUFlO0FBQUEsTUFDN0MsWUFBWSxLQUFLLFFBQVEsTUFBTSxPQUFPLFNBQVMsUUFBUSxJQUFJO0FBQ3pELGNBQU0sS0FBSyxRQUFRLE9BQU8sT0FBTztBQUNqQyxhQUFLLE9BQU87QUFDWixhQUFLLGVBQWUsaUJBQWMsSUFBSSw4QkFBbUI7QUFDekQsYUFBSyxRQUFRLFlBQVksT0FBTyxPQUFPLENBQUMsU0FBUyxLQUFLLFlBQVksSUFBSSxDQUFDO0FBQUEsTUFDekU7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQUtBLFlBQVksTUFBTTtBQUNoQixlQUFPLEtBQUssT0FBTyxHQUFHLEtBQUssSUFBSSxJQUFJLEtBQUssSUFBSSxLQUFLLE1BQU0sWUFBWSxJQUFJO0FBQUEsTUFDekU7QUFBQSxNQUVBLGlCQUFpQixPQUFPLElBQUk7QUFDMUIsY0FBTSxPQUFPLE1BQU07QUFDbkIsV0FBRyxTQUFTLDRCQUE0QjtBQUN4QyxZQUFJLEtBQUssTUFBTTtBQU1iLGVBQUssa0JBQWtCLElBQUksS0FBSyxNQUFNLEtBQUssSUFBSTtBQUMvQyxhQUFHLFdBQVcsRUFBRSxLQUFLLHdCQUF3QixNQUFNLElBQUksS0FBSyxJQUFJLElBQUksQ0FBQztBQUFBLFFBQ3ZFLE9BQU87QUFDTCxlQUFLLGtCQUFrQixJQUFJLEtBQUssTUFBTSxLQUFLLE1BQU0sS0FBSyxJQUFJO0FBQUEsUUFDNUQ7QUFDQSxXQUFHLFdBQVcsRUFBRSxLQUFLLHlCQUF5QixNQUFNLE9BQU8sS0FBSyxLQUFLLEVBQUUsQ0FBQztBQUFBLE1BQzFFO0FBQUEsTUFFQSxhQUFhLE1BQU07QUFDakIsYUFBSyxRQUFRLEtBQUssT0FBTyxLQUFLLEtBQUssSUFBSTtBQUFBLE1BQ3pDO0FBQUEsSUFDRjtBQVVBLFFBQU0sdUJBQU4sY0FBbUMsZUFBZTtBQUFBLE1BQ2hELFlBQVksS0FBSyxRQUFRLFFBQVEsU0FBUztBQUN4QyxjQUFNLEtBQUssUUFBUSxPQUFPLElBQUksQ0FBQyxVQUFVLE1BQU0sSUFBSSxHQUFHLE9BQU87QUFDN0QsYUFBSyxTQUFTO0FBQUEsTUFDaEI7QUFBQSxNQUVBLGVBQWUsT0FBTztBQUNwQixjQUFNLFNBQVMsTUFBTSxLQUFLLElBQUksbUJBQW1CLE1BQU0sS0FBSyxDQUFDLElBQUk7QUFDakUsY0FBTSxVQUFVLEVBQUUsT0FBTyxHQUFHLFNBQVMsQ0FBQyxFQUFFO0FBQ3hDLGNBQU0sVUFBVSxDQUFDO0FBQ2pCLG1CQUFXLEVBQUUsTUFBTSxTQUFTLEtBQUssS0FBSyxRQUFRO0FBQzVDLGdCQUFNLFlBQVksU0FBUyxPQUFPLEtBQUssWUFBWSxJQUFJLENBQUMsSUFBSTtBQUM1RCxjQUFJLGlCQUFpQixTQUFTLElBQUksQ0FBQyxhQUFhLEVBQUUsTUFBTSxTQUFTLE9BQU8sU0FBUyxPQUFPLFFBQVEsT0FBTyxJQUFJLFFBQVEsRUFBRTtBQUNySCxjQUFJLENBQUMsVUFBVyxrQkFBaUIsZUFBZSxPQUFPLENBQUMsVUFBVSxNQUFNLEtBQUs7QUFDN0UsY0FBSSxDQUFDLGFBQWEsZUFBZSxXQUFXLEVBQUc7QUFFL0MsZ0JBQU0sU0FBUyxDQUFDLFdBQVcsR0FBRyxlQUFlLElBQUksQ0FBQyxVQUFVLE1BQU0sS0FBSyxDQUFDLEVBQUUsT0FBTyxPQUFPLEVBQUUsSUFBSSxDQUFDLFVBQVUsTUFBTSxLQUFLO0FBQ3BILGtCQUFRLEtBQUs7QUFBQSxZQUNYLE9BQU8sS0FBSyxJQUFJLEdBQUcsTUFBTTtBQUFBLFlBQ3pCLE1BQU0sQ0FBQyxFQUFFLE1BQU0sT0FBTyxhQUFhLFFBQVEsR0FBRyxHQUFHLGVBQWUsSUFBSSxDQUFDLFdBQVcsRUFBRSxNQUFNLE1BQU0sTUFBTSxPQUFPLE1BQU0sU0FBUyxRQUFRLEVBQUUsQ0FBQztBQUFBLFVBQ3ZJLENBQUM7QUFBQSxRQUNIO0FBQ0EsWUFBSSxPQUFRLFNBQVEsS0FBSyxDQUFDLEdBQUcsTUFBTSxFQUFFLFFBQVEsRUFBRSxLQUFLO0FBQ3BELGVBQU8sUUFBUSxRQUFRLENBQUMsVUFBVSxNQUFNLElBQUk7QUFBQSxNQUM5QztBQUFBLE1BRUEsaUJBQWlCLE9BQU8sSUFBSTtBQUMxQixjQUFNLE9BQU8sTUFBTTtBQUNuQixZQUFJLENBQUMsS0FBSyxTQUFTO0FBQ2pCLGdCQUFNLGlCQUFpQixPQUFPLEVBQUU7QUFDaEM7QUFBQSxRQUNGO0FBQ0EsV0FBRyxTQUFTLDhCQUE4Qix5QkFBeUI7QUFDbkUsYUFBSyxrQkFBa0IsSUFBSSxLQUFLLFNBQVMsS0FBSyxNQUFNLEtBQUssT0FBTztBQUNoRSxXQUFHLFdBQVcsRUFBRSxLQUFLLHlCQUF5QixNQUFNLE9BQU8sS0FBSyxLQUFLLEVBQUUsQ0FBQztBQUFBLE1BQzFFO0FBQUEsTUFFQSxhQUFhLE1BQU07QUFDakIsYUFBSyxRQUFRLEVBQUUsTUFBTSxLQUFLLE1BQU0sU0FBUyxLQUFLLFdBQVcsS0FBSyxDQUFDO0FBQUEsTUFDakU7QUFBQSxJQUNGO0FBUUEsYUFBUyxZQUFZLE9BQU8sT0FBTyxVQUFVO0FBQzNDLFlBQU0sU0FBUyxPQUFPLEtBQUssSUFBSSxtQkFBbUIsTUFBTSxLQUFLLENBQUMsSUFBSTtBQUNsRSxVQUFJLENBQUMsT0FBUSxRQUFPO0FBQ3BCLFlBQU0sU0FBUyxNQUFNLElBQUksQ0FBQyxNQUFNLFdBQVcsRUFBRSxNQUFNLE9BQU8sT0FBTyxPQUFPLFNBQVMsSUFBSSxDQUFDLEdBQUcsU0FBUyxLQUFLLEVBQUU7QUFDekcsVUFBSSxPQUFPLE1BQU0sQ0FBQyxVQUFVLE1BQU0sVUFBVSxJQUFJLEVBQUcsUUFBTztBQUMxRCxhQUFPLEtBQUssQ0FBQyxHQUFHLE1BQU07QUFDcEIsWUFBSSxFQUFFLFVBQVUsUUFBUSxFQUFFLFVBQVUsS0FBTSxRQUFPLEVBQUUsVUFBVSxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLFVBQVUsT0FBTyxJQUFJO0FBQ2xILGVBQU8sRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLFFBQVEsRUFBRTtBQUFBLE1BQzFDLENBQUM7QUFDRCxhQUFPLE9BQU8sSUFBSSxDQUFDLFVBQVUsTUFBTSxJQUFJO0FBQUEsSUFDekM7QUFZQSxhQUFTLFlBQVksS0FBSyxRQUFRLE1BQU0sUUFBUSxJQUFJO0FBQ2xELGFBQU8sSUFBSSxRQUFRLENBQUMsWUFBWTtBQUM5QixjQUFNLFFBQVEsT0FBTyxZQUFZLElBQUksRUFBRSxJQUFJLENBQUMsRUFBRSxTQUFTLE1BQU0sT0FBTyxFQUFFLE1BQU0sU0FBUyxhQUFhLElBQUksTUFBTSxFQUFFO0FBQzlHLFlBQUksTUFBTSxXQUFXLEdBQUc7QUFDdEIsa0JBQVEsRUFBRTtBQUNWO0FBQUEsUUFDRjtBQUdBLGNBQU0sWUFBWSxPQUFPLFNBQVMsY0FBYyxJQUFJLEVBQUU7QUFDdEQsY0FBTSxRQUFRLEVBQUUsTUFBTSxlQUFlLGFBQWEsSUFBSSxPQUFPLFdBQVcsTUFBTSxLQUFLLENBQUM7QUFDcEYsWUFBSSxrQkFBa0IsS0FBSyxRQUFRLE1BQU0sT0FBTyxTQUFTLEtBQUssRUFBRSxLQUFLO0FBQUEsTUFDdkUsQ0FBQztBQUFBLElBQ0g7QUFRQSxhQUFTLGtCQUFrQixLQUFLLFFBQVE7QUFDdEMsWUFBTSxhQUFhLElBQUksSUFBSSxPQUFPLFNBQVMsS0FBSztBQUNoRCxZQUFNLEVBQUUsT0FBTyxJQUFJLE9BQU8sU0FBUyxXQUFXO0FBQzlDLFlBQU0sWUFBWSxPQUFPLFNBQVMsZ0JBQWdCQTtBQUNsRCxhQUFPLENBQUMsR0FBRyxPQUFPLEtBQUssQ0FBQyxFQUNyQixPQUFPLENBQUMsU0FBUyxDQUFDLFdBQVcsSUFBSSxJQUFJLEtBQUssT0FBTyxTQUFTLFdBQVcsSUFBSSxDQUFDLEVBQzFFLEtBQUssQ0FBQyxHQUFHLE1BQU0sYUFBYSxXQUFXLEdBQUcsR0FBRyxRQUFRLE9BQU8sU0FBUyxVQUFVLENBQUMsRUFDaEYsSUFBSSxDQUFDLFVBQVUsRUFBRSxNQUFNLGFBQWEsSUFBSSxPQUFPLE9BQU8sSUFBSSxJQUFJLEtBQUssR0FBRyxjQUFjLEtBQUssRUFBRTtBQUFBLElBQ2hHO0FBYUEsYUFBUyxTQUFTLEtBQUssUUFBUSxVQUFVLENBQUMsR0FBRztBQUMzQyxhQUFPLGNBQWMsS0FBSyxRQUFRLE9BQU8sRUFBRSxLQUFLLENBQUMsVUFBVSxPQUFPLFFBQVEsSUFBSTtBQUFBLElBQ2hGO0FBT0EsYUFBUyxjQUFjLEtBQUssUUFBUSxVQUFVLENBQUMsR0FBRztBQUNoRCxhQUFPLElBQUksUUFBUSxDQUFDLFlBQVk7QUFDOUIsY0FBTSxRQUFRLFVBQVUsS0FBSyxRQUFRLE9BQU87QUFDNUMsWUFBSSxDQUFDLE9BQU87QUFDVixrQkFBUSxJQUFJO0FBQ1o7QUFBQSxRQUNGO0FBQ0EsY0FBTSxRQUFRLElBQUksZUFBZSxLQUFLLFFBQVEsT0FBTyxDQUFDLFNBQVMsUUFBUSxTQUFTLE9BQU8sT0FBTyxFQUFFLE1BQU0sT0FBTyxNQUFNLE1BQU0sQ0FBQyxDQUFDO0FBQzNILGNBQU0sS0FBSztBQUFBLE1BQ2IsQ0FBQztBQUFBLElBQ0g7QUFJQSxhQUFTLFVBQVUsS0FBSyxRQUFRLEVBQUUsbUJBQW1CLE9BQU8sc0JBQXNCLE9BQU8sZUFBZSxNQUFNLElBQUksQ0FBQyxHQUFHO0FBQ3BILFlBQU0sUUFBUSxPQUFPLFNBQVMsRUFBRSxpQkFBaUIsQ0FBQyxFQUFFLElBQUksQ0FBQyxVQUFVLEVBQUUsR0FBRyxNQUFNLGNBQWMsTUFBTSxFQUFFO0FBQ3BHLFVBQUksb0JBQXFCLE9BQU0sS0FBSyxHQUFHLGtCQUFrQixLQUFLLE1BQU0sQ0FBQztBQUdyRSxVQUFJLGNBQWM7QUFDaEIsbUJBQVcsUUFBUSxNQUFPLE1BQUssV0FBVyxPQUFPLFlBQVksS0FBSyxJQUFJLEVBQUUsSUFBSSxDQUFDLEVBQUUsUUFBUSxNQUFNLE9BQU87QUFBQSxNQUN0RztBQUNBLFVBQUksTUFBTSxTQUFTLEVBQUcsUUFBTztBQUM3QixVQUFJLE9BQU8sd0JBQXdCO0FBQ25DLGFBQU87QUFBQSxJQUNUO0FBV0EsbUJBQWUsbUJBQW1CLEtBQUssUUFBUSxVQUFVLENBQUMsR0FBRztBQUMzRCxVQUFJLE9BQU8sU0FBUyx1QkFBdUI7QUFDekMsZUFBTyxNQUFNO0FBQ1gsZ0JBQU0sUUFBUSxNQUFNLGNBQWMsS0FBSyxRQUFRLEVBQUUsR0FBRyxTQUFTLGNBQWMsS0FBSyxDQUFDO0FBQ2pGLGNBQUksQ0FBQyxNQUFPLFFBQU87QUFDbkIsZ0JBQU0sVUFBVSxNQUFNLFlBQVksS0FBSyxRQUFRLE1BQU0sTUFBTSxNQUFNLEtBQUs7QUFDdEUsY0FBSSxZQUFZLEtBQU0sUUFBTyxFQUFFLE1BQU0sTUFBTSxNQUFNLFNBQVMsV0FBVyxLQUFLO0FBQUEsUUFDNUU7QUFBQSxNQUNGO0FBRUEsWUFBTSxRQUFRLFVBQVUsS0FBSyxRQUFRLE9BQU87QUFDNUMsVUFBSSxDQUFDLE1BQU8sUUFBTztBQUNuQixZQUFNLFNBQVMsTUFBTSxJQUFJLENBQUMsVUFBVTtBQUFBLFFBQ2xDO0FBQUEsUUFDQSxVQUFVLE9BQU8sWUFBWSxLQUFLLElBQUksRUFBRSxJQUFJLENBQUMsRUFBRSxTQUFTLE1BQU0sT0FBTyxFQUFFLE1BQU0sS0FBSyxNQUFNLFNBQVMsTUFBTSxFQUFFO0FBQUEsTUFDM0csRUFBRTtBQUNGLGFBQU8sSUFBSSxRQUFRLENBQUMsWUFBWSxJQUFJLHFCQUFxQixLQUFLLFFBQVEsUUFBUSxPQUFPLEVBQUUsS0FBSyxDQUFDO0FBQUEsSUFDL0Y7QUFFQSxJQUFBRCxRQUFPLFVBQVUsRUFBRSxVQUFVLGFBQWEsbUJBQW1CO0FBQUE7QUFBQTs7O0FDcFY3RDtBQUFBLDRCQUFBRSxVQUFBQyxTQUFBO0FBQUEsUUFBTSxFQUFFLE9BQU8sT0FBTyxVQUFVLGNBQWMsSUFBSSxRQUFRLFVBQVU7QUFrQ3BFLFFBQU0sa0JBQWtCO0FBTXhCLGFBQVMsWUFBWSxLQUFLO0FBQ3hCLFlBQU0sU0FBUyxPQUFPLElBQ25CLE1BQU0sR0FBRyxFQUNULElBQUksQ0FBQyxTQUFTLEtBQUssS0FBSyxDQUFDLEVBQ3pCLE9BQU8sQ0FBQyxTQUFTLFNBQVMsRUFBRTtBQUMvQixhQUFPLENBQUMsR0FBRyxJQUFJLElBQUksS0FBSyxDQUFDO0FBQUEsSUFDM0I7QUFTQSxhQUFTQyx5QkFBd0IsUUFBUTtBQUN2QyxZQUFNLEVBQUUsSUFBSSxJQUFJO0FBRWhCLFVBQUksZUFBZTtBQUNuQixVQUFJLFVBQVUsQ0FBQztBQUVmLFlBQU0sc0JBQXNCLE1BQU07QUFDaEMsY0FBTSxTQUFTLElBQUksUUFBUSxRQUFRLG9CQUFvQixHQUFHLFVBQVU7QUFDcEUsZUFBTyxTQUFTLGNBQWMsTUFBTSxJQUFJO0FBQUEsTUFDMUM7QUFFQSxZQUFNLG1CQUFtQixDQUFDLFNBQVMsQ0FBQyxDQUFDLGdCQUFnQixDQUFDLENBQUMsUUFBUSxLQUFLLFdBQVcsZUFBZSxHQUFHO0FBSWpHLHFCQUFlLGlCQUFpQjtBQUM5QixjQUFNLGFBQWEsb0JBQW9CO0FBQ3ZDLHVCQUFlO0FBQ2YsY0FBTSxTQUFTLGFBQWEsSUFBSSxNQUFNLGdCQUFnQixVQUFVLElBQUk7QUFDcEUsY0FBTSxRQUFRLENBQUM7QUFDZixZQUFJLFFBQVE7QUFDVixnQkFBTSxnQkFBZ0IsUUFBUSxDQUFDLFVBQVU7QUFDdkMsZ0JBQUksaUJBQWlCLFNBQVMsTUFBTSxjQUFjLEtBQU0sT0FBTSxLQUFLLEtBQUs7QUFBQSxVQUMxRSxDQUFDO0FBQUEsUUFDSDtBQUNBLGNBQU0sUUFBUSxDQUFDO0FBQ2YsbUJBQVcsUUFBUSxPQUFPO0FBQ3hCLGNBQUk7QUFDRixrQkFBTSxTQUFTLE1BQU0sSUFBSSxNQUFNLFdBQVcsSUFBSSxHQUFHLE1BQU0sZUFBZTtBQUd0RSxnQkFBSSxPQUFPO0FBQ1Qsb0JBQU0sS0FBSztBQUFBLGdCQUNULE1BQU0sS0FBSztBQUFBLGdCQUNYLFFBQVEsTUFBTSxDQUFDLE1BQU0sU0FBWSxPQUFPLFlBQVksTUFBTSxDQUFDLENBQUM7QUFBQSxnQkFDNUQsYUFBYSxNQUFNLENBQUMsS0FBSztBQUFBLGNBQzNCLENBQUM7QUFBQSxZQUNIO0FBQUEsVUFDRixTQUFTLEdBQUc7QUFDVixvQkFBUSxNQUFNLGdDQUFnQyxLQUFLLElBQUksaUJBQWlCLENBQUM7QUFBQSxVQUMzRTtBQUFBLFFBQ0Y7QUFHQSxZQUFJLGVBQWUsYUFBYztBQUNqQyxrQkFBVSxNQUFNLEtBQUssQ0FBQyxHQUFHLE1BQU0sRUFBRSxLQUFLLGNBQWMsRUFBRSxJQUFJLENBQUM7QUFBQSxNQUM3RDtBQUVBLFlBQU0sa0JBQWtCLFNBQVMsZ0JBQWdCLEtBQUssSUFBSTtBQUMxRCxZQUFNLGVBQWUsQ0FBQyxNQUFNLFlBQVk7QUFDdEMsWUFBSSxpQkFBaUIsTUFBTSxJQUFJLEtBQUssaUJBQWlCLE9BQU8sRUFBRyxpQkFBZ0I7QUFBQSxNQUNqRjtBQUNBLGFBQU8sY0FBYyxJQUFJLE1BQU0sR0FBRyxVQUFVLFlBQVksQ0FBQztBQUN6RCxhQUFPLGNBQWMsSUFBSSxNQUFNLEdBQUcsVUFBVSxZQUFZLENBQUM7QUFDekQsYUFBTyxjQUFjLElBQUksTUFBTSxHQUFHLFVBQVUsWUFBWSxDQUFDO0FBQ3pELGFBQU8sY0FBYyxJQUFJLE1BQU0sR0FBRyxVQUFVLFlBQVksQ0FBQztBQUN6RCxVQUFJLFVBQVUsY0FBYyxjQUFjO0FBRTFDLGFBQU8sTUFBTTtBQUdYLFlBQUksb0JBQW9CLE1BQU0sYUFBYyxpQkFBZ0I7QUFDNUQsZUFBTztBQUFBLE1BQ1Q7QUFBQSxJQUNGO0FBRUEsSUFBQUQsUUFBTyxVQUFVLEVBQUUseUJBQUFDLDBCQUF5QixpQkFBaUIsWUFBWTtBQUFBO0FBQUE7OztBQ3pIekUsSUFBTSxFQUFFLE9BQU8sSUFBSSxRQUFRLFVBQVU7QUFDckMsSUFBTSxFQUFFLGtCQUFrQixvQkFBb0IsSUFBSTtBQUNsRCxJQUFNLEVBQUUsaUJBQWlCLElBQUk7QUFDN0IsSUFBTSxFQUFFLGlCQUFpQixpQkFBaUIsbUJBQW1CLElBQUk7QUFDakUsSUFBTSxFQUFFLFVBQVUsc0JBQXNCLGdCQUFnQixjQUFjLGdCQUFnQixJQUFJO0FBQzFGLElBQU0sRUFBRSxZQUFZLGlCQUFpQixzQkFBc0IseUJBQXlCLElBQUk7QUFDeEYsSUFBTSxFQUFFLDZCQUE2QixJQUFJO0FBQ3pDLElBQU0sRUFBRSwyQkFBMkIsSUFBSTtBQUN2QyxJQUFNLEVBQUUsb0JBQW9CLElBQUk7QUFDaEMsSUFBTSxFQUFFLHFCQUFxQixJQUFJO0FBQ2pDLElBQU0sRUFBRSwwQkFBMEIsSUFBSTtBQUN0QyxJQUFNLEVBQUUsdUJBQXVCLElBQUk7QUFDbkMsSUFBTSxFQUFFLHdCQUF3QixJQUFJO0FBQ3BDLElBQU0sRUFBRSwwQkFBMEIsSUFBSTtBQUN0QyxJQUFNLEVBQUUsbUJBQW1CLElBQUk7QUFDL0IsSUFBTSxFQUFFLG9DQUFvQyxJQUFJO0FBQ2hELElBQU0sRUFBRSwyQkFBMkIsSUFBSTtBQUN2QyxJQUFNLEVBQUUsc0JBQXNCLG9CQUFvQixpQkFBaUIsSUFBSTtBQUN2RSxJQUFNLEVBQUUsa0JBQWtCLGNBQWMsZ0JBQWdCLElBQUk7QUFDNUQsSUFBTTtBQUFBLEVBQ0osVUFBVTtBQUFBLEVBQ1YsYUFBYTtBQUFBLEVBQ2Isb0JBQW9CO0FBQ3RCLElBQUk7QUFDSixJQUFNLEVBQUUsd0JBQXdCLElBQUk7QUFRcEMsU0FBUywyQkFBMkIsVUFBVTtBQUM1QyxNQUFJLENBQUMsU0FBUyx3QkFBeUI7QUFDdkMsYUFBVyxDQUFDLE1BQU0sUUFBUSxLQUFLLE9BQU8sUUFBUSxTQUFTLHVCQUF1QixHQUFHO0FBQy9FLFVBQU0sT0FBTyxPQUFPLEtBQUssUUFBUSxFQUFFLE9BQU8sQ0FBQyxRQUFRLFFBQVEsRUFBRTtBQUM3RCxRQUFJLEtBQUssV0FBVyxFQUFHO0FBQ3ZCLGFBQVMsdUJBQXVCLElBQUksSUFBSSxFQUFFLEdBQUksU0FBUyx1QkFBdUIsSUFBSSxLQUFLLENBQUMsR0FBSSxHQUFHLFNBQVM7QUFDeEcsYUFBUyxpQkFBaUIsSUFBSSxJQUFJLENBQUMsR0FBRyxvQkFBSSxJQUFJLENBQUMsR0FBSSxTQUFTLGlCQUFpQixJQUFJLEtBQUssQ0FBQyxHQUFJLEdBQUcsSUFBSSxDQUFDLENBQUM7QUFBQSxFQUN0RztBQUNBLFNBQU8sU0FBUztBQUNsQjtBQWNBLFNBQVMsd0JBQXdCLFVBQVUsUUFBUTtBQUNqRCxNQUFJLFFBQVEsOEJBQThCLE9BQVcsUUFBTztBQUM1RCxNQUFJLE9BQU8scUJBQXFCLFFBQVc7QUFDekMsYUFBUyxtQkFBbUIsT0FBTyw0QkFBNEIsZ0JBQWdCO0FBQUEsRUFDakY7QUFDQSxTQUFPLFNBQVM7QUFDaEIsU0FBTztBQUNUO0FBT0EsU0FBUyx5QkFBeUIsVUFBVTtBQUMxQyxNQUFJLFNBQVMsZ0NBQWdDLE9BQVcsUUFBTztBQUMvRCxTQUFPLFNBQVM7QUFDaEIsU0FBTztBQUNUO0FBRUEsT0FBTyxVQUFVLE1BQU0sd0JBQXdCLE9BQU87QUFBQSxFQUNwRCxNQUFNLFNBQVM7QUFDYixVQUFNLEtBQUssYUFBYTtBQUl4QixTQUFLLFdBQVcsSUFBSSxTQUFTLElBQUk7QUFDakMsU0FBSyxTQUFTLFNBQVM7QUFFdkIscUJBQWlCLElBQUk7QUFDckIsU0FBSyxjQUFjLElBQUksb0JBQW9CLEtBQUssS0FBSyxJQUFJLENBQUM7QUFHMUQsK0JBQTJCLElBQUk7QUFHL0IsU0FBSyxxQkFBcUIsd0JBQXdCLElBQUk7QUFRdEQsU0FBSyw4QkFBOEIsb0NBQW9DLElBQUk7QUFFM0UsVUFBTSxhQUFhO0FBQUEsTUFDakIsZ0JBQWdCLElBQUk7QUFBQSxNQUNwQiwyQkFBMkIsSUFBSTtBQUFBLE1BQy9CLG9CQUFvQixJQUFJO0FBQUEsTUFDeEIscUJBQXFCLElBQUk7QUFBQSxNQUN6QiwwQkFBMEIsSUFBSTtBQUFBLE1BQzlCLHVCQUF1QixJQUFJO0FBQUEsTUFDM0Isd0JBQXdCLElBQUk7QUFBQSxNQUM1QiwwQkFBMEIsSUFBSTtBQUFBLE1BQzlCLG1CQUFtQixJQUFJO0FBQUEsTUFDdkIsS0FBSztBQUFBLElBQ1A7QUFDQSxTQUFLLG1CQUFtQixNQUFNLFdBQVcsUUFBUSxDQUFDLE9BQU8sR0FBRyxDQUFDO0FBZ0I3RCxVQUFNLHFCQUFxQixPQUFPLFdBQVcsTUFBTSxLQUFLLElBQUksVUFBVSxRQUFRLHNCQUFzQixHQUFHLENBQUM7QUFDeEcsU0FBSyxTQUFTLE1BQU0sT0FBTyxhQUFhLGtCQUFrQixDQUFDO0FBQUEsRUFDN0Q7QUFBQSxFQUVBLFdBQVc7QUFBQSxFQUFDO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQW9DWixnQkFBZ0IsTUFBTSxFQUFFLGtCQUFrQixPQUFPLE1BQU0sVUFBVSxLQUFLLElBQUksQ0FBQyxHQUFHO0FBQzVFLFVBQU0sRUFBRSxVQUFVLFVBQVUsSUFBSSxLQUFLLGNBQWMsTUFBTSxTQUFTLGVBQWU7QUFDakYsV0FBTyxpQkFBaUIsVUFBVSxXQUFXLEVBQUUsTUFBTSxLQUFLLEtBQUssSUFBSSxDQUFDO0FBQUEsRUFDdEU7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFPQSxjQUFjLE1BQU0sU0FBUyxpQkFBaUI7QUFDNUMsVUFBTSxXQUFXLENBQUM7QUFDbEIsVUFBTSxZQUFZLENBQUM7QUFDbkIsVUFBTSxhQUFhLG9CQUFJLElBQUk7QUFDM0IsVUFBTSxXQUFXLENBQUMsYUFBYSxjQUFjLG1CQUFtQjtBQUM5RCxZQUFNLGFBQWEsSUFBSSxJQUFJLE9BQU8sS0FBSyxRQUFRLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLFlBQVksR0FBRyxHQUFHLENBQUMsQ0FBQztBQUN2RixpQkFBVyxDQUFDLEtBQUssS0FBSyxLQUFLLE9BQU8sUUFBUSxlQUFlLENBQUMsQ0FBQyxHQUFHO0FBQzVELFlBQUksUUFBUSxHQUFJO0FBQ2hCLGNBQU0sU0FBUyxXQUFXLElBQUksSUFBSSxZQUFZLENBQUMsS0FBSztBQUNwRCxpQkFBUyxNQUFNLElBQUk7QUFDbkIsbUJBQVcsSUFBSSxTQUFTLGdCQUFnQixDQUFDLEdBQUcsU0FBUyxHQUFHLENBQUM7QUFDekQsY0FBTSxVQUFVLGtCQUFrQixDQUFDLEdBQUcsR0FBRztBQUN6QyxZQUFJLE9BQVEsV0FBVSxNQUFNLElBQUk7QUFBQSxZQUMzQixRQUFPLFVBQVUsTUFBTTtBQUFBLE1BQzlCO0FBQUEsSUFDRjtBQUNBLFVBQU0sY0FBYyxVQUFVLFdBQVcsS0FBSyxVQUFVLE1BQU0sT0FBTyxJQUFJO0FBQ3pFO0FBQUEsTUFDRSxLQUFLLFNBQVMsdUJBQXVCLElBQUk7QUFBQSxNQUN6QyxLQUFLLFNBQVMsaUJBQWlCLElBQUk7QUFBQSxNQUNuQyxLQUFLLFNBQVMsY0FBYyxJQUFJO0FBQUEsSUFDbEM7QUFDQSxRQUFJLFlBQWEsVUFBUyxZQUFZLGFBQWEsWUFBWSxjQUFjLFlBQVksU0FBUztBQUVsRyxRQUFJLENBQUMsaUJBQWlCO0FBQ3BCLGlCQUFXLENBQUMsS0FBSyxRQUFRLEtBQUssWUFBWTtBQUN4QyxZQUFJLENBQUMsU0FBVTtBQUNmLGVBQU8sU0FBUyxHQUFHO0FBQ25CLGVBQU8sVUFBVSxHQUFHO0FBQUEsTUFDdEI7QUFBQSxJQUNGO0FBQ0EsV0FBTyxFQUFFLFVBQVUsVUFBVTtBQUFBLEVBQy9CO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFnQ0EsaUJBQWlCLE1BQU0sRUFBRSxrQkFBa0IsT0FBTyxVQUFVLEtBQUssSUFBSSxDQUFDLEdBQUc7QUFDdkUsVUFBTSxFQUFFLFVBQVUsVUFBVSxJQUFJLEtBQUssY0FBYyxNQUFNLFNBQVMsZUFBZTtBQUNqRixVQUFNLFVBQVUsS0FBSyxxQkFBcUIsS0FBSyxDQUFDO0FBQ2hELFVBQU0sU0FBUyxDQUFDO0FBQ2hCLGVBQVcsQ0FBQyxLQUFLLE1BQU0sS0FBSyxPQUFPLFFBQVEsU0FBUyxHQUFHO0FBQ3JELFlBQU0sT0FBTyxhQUFhLE9BQU8sSUFBSTtBQUNyQyxVQUFJLFNBQVMsS0FBTTtBQUNuQixZQUFNLFNBQVMsUUFBUSxLQUFLLENBQUMsTUFBTSxFQUFFLFNBQVMsSUFBSTtBQUNsRCxhQUFPLEdBQUcsSUFBSTtBQUFBLFFBQ1o7QUFBQSxRQUNBLFFBQVEsUUFBUSxVQUFVO0FBQUEsUUFDMUIsTUFBTSxFQUFFLEdBQUksT0FBTyxRQUFRLENBQUMsRUFBRztBQUFBLFFBQy9CLFVBQVUsU0FBUyxHQUFHLEtBQUs7QUFBQSxNQUM3QjtBQUFBLElBQ0Y7QUFDQSxXQUFPO0FBQUEsRUFDVDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBUUEsb0JBQW9CLFFBQVEsTUFBTSxFQUFFLFVBQVUsTUFBTSxNQUFNLE1BQU0sTUFBTSxLQUFLLElBQUksQ0FBQyxHQUFHO0FBQ2pGLFdBQU8sZ0JBQWdCLFFBQVEsTUFBTSxFQUFFLFNBQVMsS0FBSyxJQUFJLENBQUM7QUFBQSxFQUM1RDtBQUFBO0FBQUE7QUFBQSxFQUlBLFlBQVksTUFBTTtBQUNoQixVQUFNLEVBQUUsT0FBTyxJQUFJLEtBQUssU0FBUyxjQUFjLElBQUk7QUFDbkQsV0FBTyxnQkFBZ0IsS0FBSyxVQUFVLElBQUksRUFBRSxJQUFJLENBQUMsYUFBYSxFQUFFLFNBQVMsT0FBTyxPQUFPLElBQUksT0FBTyxLQUFLLEVBQUUsRUFBRTtBQUFBLEVBQzdHO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBT0EsWUFBWSxNQUFNLFFBQVEsSUFBSTtBQUM1QixXQUFPLGlCQUFpQixLQUFLLEtBQUssTUFBTSxNQUFNLEtBQUs7QUFBQSxFQUNyRDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFNQSxvQkFBb0IsYUFBYSxNQUFNLFNBQVM7QUFDOUMseUJBQXFCLGFBQWEsY0FBYyxJQUFJO0FBQ3BELFFBQUksUUFBUyxzQkFBcUIsYUFBYSxpQkFBaUIsT0FBTztBQUFBLFFBQ2xFLGdCQUFlLGFBQWEsZUFBZTtBQUFBLEVBQ2xEO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBT0EsZ0JBQWdCLGFBQWEsTUFBTSxVQUFVLE1BQU07QUFDakQsV0FBTyxtQkFBbUIsTUFBTSxhQUFhLE1BQU0sT0FBTztBQUFBLEVBQzVEO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQU1BLGNBQWMsYUFBYSxLQUFLO0FBQzlCLFdBQU8saUJBQWlCLE1BQU0sYUFBYSxHQUFHO0FBQUEsRUFDaEQ7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQVdBLFNBQVMsRUFBRSxtQkFBbUIsTUFBTSxJQUFJLENBQUMsR0FBRztBQUMxQyxVQUFNLEVBQUUsT0FBTyxJQUFJLEtBQUssU0FBUyxXQUFXO0FBQzVDLFVBQU0sWUFBWSxLQUFLLFNBQVMsZ0JBQWdCO0FBQ2hELFdBQU8sZ0JBQWdCLEtBQUssU0FBUyxPQUFPLFdBQVcsUUFBUSxLQUFLLFNBQVMsVUFBVSxFQUNwRixPQUFPLENBQUMsU0FBUyxxQkFBcUIsS0FBSyxTQUFTLGNBQWMsQ0FBQyxHQUFHLElBQUksTUFBTSxLQUFLLEVBQ3JGLElBQUksQ0FBQyxVQUFVO0FBQUEsTUFDZDtBQUFBLE1BQ0EsYUFBYSxLQUFLLFNBQVMsaUJBQWlCLElBQUksS0FBSztBQUFBLE1BQ3JELE9BQU8sT0FBTyxJQUFJLElBQUksS0FBSztBQUFBLElBQzdCLEVBQUU7QUFBQSxFQUNOO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBT0EsU0FBUyxTQUFTO0FBQ2hCLFdBQU8sY0FBYyxLQUFLLEtBQUssTUFBTSxPQUFPO0FBQUEsRUFDOUM7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFPQSxtQkFBbUIsU0FBUztBQUMxQixXQUFPLHdCQUF3QixLQUFLLEtBQUssTUFBTSxPQUFPO0FBQUEsRUFDeEQ7QUFBQSxFQUVBLE1BQU0sZUFBZTtBQUNuQixVQUFNLFNBQVMsTUFBTSxLQUFLLFNBQVM7QUFDbkMsU0FBSyxXQUFXLE9BQU8sT0FBTyxDQUFDLEdBQUcsa0JBQWtCLE1BQU07QUFJMUQsU0FBSyxTQUFTLGFBQWEsRUFBRSxHQUFHLGlCQUFpQixZQUFZLEdBQUcsS0FBSyxTQUFTLFdBQVc7QUFHekYsU0FBSyxTQUFTLHNCQUFzQixxQkFBcUIsS0FBSyxTQUFTLG1CQUFtQjtBQUMxRiwrQkFBMkIsS0FBSyxRQUFRO0FBR3hDLHlCQUFxQixLQUFLLFFBQVE7QUFLbEMsVUFBTSxXQUFXLENBQUMseUJBQXlCLEtBQUssVUFBVSw0QkFBNEIsR0FBRyx3QkFBd0IsS0FBSyxVQUFVLE1BQU0sR0FBRyx5QkFBeUIsS0FBSyxRQUFRLENBQUM7QUFDaEwsUUFBSSxTQUFTLEtBQUssT0FBTyxFQUFHLE9BQU0sS0FBSyxhQUFhO0FBQUEsRUFDdEQ7QUFBQSxFQUVBLE1BQU0sZUFBZTtBQUNuQixVQUFNLEtBQUssU0FBUyxLQUFLLFFBQVE7QUFBQSxFQUNuQztBQUNGOyIsCiAgIm5hbWVzIjogWyJleHBvcnRzIiwgIm1vZHVsZSIsICJUWVBfUFJPUEVSVFkiLCAiU1VCVFlQX1BST1BFUlRZIiwgInNldENhbm9uaWNhbFByb3BlcnR5IiwgImRlbGV0ZVByb3BlcnR5IiwgIlR5cEluZGV4IiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInNldENhbm9uaWNhbFByb3BlcnR5IiwgIlNVQlRZUF9QUk9QRVJUWSIsICJnZXRTdWJ0eXBlTmFtZXMiLCAiZ2V0U3VidHlwZSIsICJtaWdyYXRlQWJvdmVTdGFuZGFyZCIsICJtaWdyYXRlU3VidHlwZUNvbG9yU2NhbGUiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZ2V0U3VidHlwZSIsICJUWVBfUFJPUEVSVFkiLCAiU1VCVFlQX1BST1BFUlRZIiwgIm5vcm1hbGl6ZUdsb2JhbE9yZGVyIiwgInNvcnRGcm9udG1hdHRlckZvciIsICJwbGFjZVByb3BlcnR5Rm9yIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgIlRZUF9QUk9QRVJUWSIsICJTVUJUWVBfUFJPUEVSVFkiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZ2V0U3VidHlwZSIsICJERUZBVUxUX1NVQlRZUEVfQ09MT1JfUkFOR0VTIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgIkRFRkFVTFRfU1VCVFlQRV9DT0xPUl9SQU5HRVMiLCAiREVGQVVMVF9TRVRUSU5HUyIsICJUeXBTeXN0ZW1TZXR0aW5nVGFiIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyQ29tbWFuZHMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAic2NyaXB0TmFtZU9mIiwgInJlc29sdmVDYWxsQXJncyIsICJyZXNvbHZlU2hvcnRjdXRzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImdldFN1YnR5cGUiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJzb3J0VHlwZXNCeU1vZGUiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZ2V0U3VidHlwZU5hbWVzIiwgImdldFN1YnR5cGUiLCAic29ydFR5cGVzQnlNb2RlIiwgInNldENhbm9uaWNhbFByb3BlcnR5IiwgIlRZUF9QUk9QRVJUWSIsICJTVUJUWVBfUFJPUEVSVFkiLCAiREVGQVVMVF9TT1JUX09SREVSIiwgInJlZ2lzdGVyVHlwVmlldyIsICJsZWFmIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyRmlsZUV4cGxvcmVyQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyR3JhcGhDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJTZWFyY2hDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJSZWNlbnRGaWxlc0NvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlckJhY2tsaW5rQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyQm9va21hcmtzQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImdldFN1YnR5cGUiLCAicmVnaXN0ZXJBY3RpdmVUaXRsZUNvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlckxpbmtDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZ2V0U3VidHlwZU5hbWVzIiwgImdldFN1YnR5cGUiLCAiVFlQX1BST1BFUlRZIiwgImZsb2F0aW5nIiwgInJlZ2lzdGVyRnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0IiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImdldFN1YnR5cGVOYW1lcyIsICJUWVBfUFJPUEVSVFkiLCAiU1VCVFlQX1BST1BFUlRZIiwgInJlZ2lzdGVyUHJvcGVydHlSZW5hbWVTeW5jIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgIkRFRkFVTFRfU09SVF9PUkRFUiIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlclNob3J0Y3V0U2NyaXB0cyJdCn0K
