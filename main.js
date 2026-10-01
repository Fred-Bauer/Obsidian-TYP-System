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
    var { MarkdownView, Menu, WorkspaceLeaf, setIcon } = require("obsidian");
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
        console.error("[typ-system] MetadataEditor-Klasse konnte nicht ermittelt werden", error);
        return null;
      } finally {
        try {
          view?.unload();
        } catch (error) {
          console.error("[typ-system] Verwerfen der Hilfs-MarkdownView fehlgeschlagen", error);
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
    function mountFrontmatterBlocks(view, containerEl, type, { renderHeader, renderFooter, onMoveSection }) {
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
      // Ein Icon-Knopf statt eines beschrifteten Schalters: die Einstellung ist zu
      // klein, um mit Label und Toggle so viel Platz und Aufmerksamkeit zu
      // bekommen wie das Beschreibungsfeld darunter. Zustand wie bei den übrigen
      // Icon-Knöpfen der Ansicht über eine Klasse (is-active, siehe styles.css),
      // der Sinn steht im Tooltip - role/aria-checked halten ihn trotzdem als
      // Schalter lesbar.
      //
      // Standardmäßig an - daher wird (wie bei den anderen typeXxx-Dicts) nur die
      // Abweichung vom Default gespeichert, hier also nur "aus" (false); fehlender
      // Eintrag bzw. true bedeuten "an". Steuert, ob ein TYP in getTypes() (siehe
      // main.js) exportiert wird, siehe dortiger Kommentar.
      renderManualToggle(parent, type) {
        const btn = parent.createDiv({
          cls: "clickable-icon fred-typ-manual-icon",
          attr: { tabindex: "0", role: "checkbox" }
        });
        setIcon(btn, "file-pen-line");
        const showState = (on) => {
          btn.toggleClass("is-active", on);
          btn.setAttribute("aria-checked", String(on));
          btn.setAttribute("aria-label", on ? "Manuell erstellbar" : "Nicht manuell erstellbar");
        };
        showState(this.ensureTypeManual()[type] !== false);
        const toggle = async () => {
          const next = !btn.hasClass("is-active");
          showState(next);
          if (next) delete this.ensureTypeManual()[type];
          else this.ensureTypeManual()[type] = false;
          await this.plugin.saveSettings();
        };
        btn.addEventListener("click", toggle);
        btn.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle();
          }
        });
        return btn;
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
        if (titleColor) titleEl.style.setProperty("--fred-typ-name-color", titleColor);
        this.makeSearchable(titleEl, () => this.openSearch(type));
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
        const optionsHeader = body.createDiv({ cls: "fred-typ-frontmatter-header fred-typ-options-header" });
        this.renderManualToggle(optionsHeader, type);
        const colorRow = optionsHeader.createDiv({ cls: "fred-typ-detail-color-row" });
        this.renderColorPicker(
          colorRow,
          type,
          (newColor) => {
            if (!this.plugin.settings.colorViews.typList) return;
            titleEl.style.setProperty("--fred-typ-name-color", newColor);
          },
          { showReset: true }
        );
        const descInput = optionsHeader.createEl("input", {
          type: "text",
          cls: "fred-typ-description-input",
          attr: { placeholder: "Beschreibung" }
        });
        descInput.value = this.plugin.settings.typeDescriptions[type] ?? "";
        descInput.addEventListener("change", async () => {
          const value = descInput.value.trim();
          if (value) this.plugin.settings.typeDescriptions[type] = value;
          else delete this.plugin.settings.typeDescriptions[type];
          await this.plugin.saveSettings();
        });
        body.createDiv({ cls: "fred-typ-detail-separator" });
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
          }
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
      // nur dieser Block), Suche per Klick auf den Titel, und die beiden
      // "Property hinzufügen"-Buttons, die eine Leerzeile in genau diesem Block
      // anlegen.
      renderSectionHeader(el, type, section, bucket, blocks) {
        const titleGroup = el.createDiv({ cls: "fred-typ-frontmatter-title-group" });
        const titleEl = titleGroup.createDiv({ cls: "fred-typ-detail-section-title", text: section ?? `${type}-Frontmatter` });
        const count = section === null ? bucket.noSubtype : bucket.counts.get(section) ?? 0;
        titleGroup.createSpan({ cls: "fred-typ-subtype-count", text: String(count) });
        this.makeSearchable(titleEl, () => this.openSubtypeSearch(type, section));
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
      // Subtyp-Blöcke, aber nur mit Überschrift samt Anzahl. Ein Klick auf die
      // Blockfläche übernimmt den Wert als Subtyp, ein Klick auf den Namen öffnet
      // stattdessen die Suche - vor dem Erfassen nachzusehen, was in einem Wert
      // eigentlich steckt, ist hier der häufige Fall. Der Name hebt sich beim
      // Hovern in Akzentfarbe ab und zeigt damit selbst an, dass er etwas anderes
      // tut als die Fläche um ihn herum.
      renderUnregisteredSubtypes(parent, type, bucket) {
        const registered = getSubtypeNames2(this.plugin.settings, type);
        const unregistered = [...bucket.counts.keys()].filter((key) => !registered.includes(key)).sort((a, b) => bucket.counts.get(b) - bucket.counts.get(a) || a.localeCompare(b));
        if (unregistered.length === 0) return;
        const listEl = parent.createDiv({ cls: "fred-typ-subtype-unregistered-list" });
        for (const key of unregistered) {
          const block = listEl.createDiv({ cls: "fred-typ-frontmatter-block fred-typ-subtype-block fred-typ-subtype-unregistered" });
          const header = block.createDiv({ cls: "fred-typ-frontmatter-header" });
          const titleGroup = header.createDiv({ cls: "fred-typ-frontmatter-title-group" });
          const titleEl = titleGroup.createDiv({ cls: "fred-typ-detail-section-title", text: displayTypeKey(key) });
          titleGroup.createSpan({ cls: "fred-typ-subtype-count", text: String(bucket.counts.get(key)) });
          block.addEventListener("click", () => this.registerSubtype(type, key, bucket));
          this.makeSearchable(titleEl, () => this.openSubtypeSearch(type, key), { stopPropagation: true });
        }
      }
      // Ein Name, dessen Klick die Suche öffnet: Zeiger-Cursor und Akzentfarbe beim
      // Hovern (siehe .fred-typ-searchable in styles.css), damit die Ansicht selbst
      // zeigt, wo etwas passiert. Die Suche lag hier früher auf dem Rechtsklick -
      // beim TYP-Frontmatter auf dem Titel, bei Subtyp-Blöcken auf der ganzen
      // Blockfläche - und war damit praktisch unauffindbar: nichts deutete darauf
      // hin, und ein Rechtsklick ist überall sonst ein Kontextmenü. Der Name ist
      // der Ort, an dem man "zeig mir diese Notizen" erwartet, also hängt es jetzt
      // genau dort. Während einer Umbenennung trägt dasselbe Element die Klasse
      // is-being-renamed und ist ein Eingabefeld - dann darf ein Klick hinein den
      // Cursor setzen und keine Suche auslösen.
      makeSearchable(el, onSearch, { stopPropagation = false } = {}) {
        el.addClass("fred-typ-searchable");
        el.addEventListener("click", (event) => {
          if (el.hasClass("is-being-renamed")) return;
          if (stopPropagation) event.stopPropagation();
          onSearch();
        });
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
  // TYPen mit abgeschaltetem "Manuell erstellbar" (Icon in der TYP-Detailansicht)
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL3R5cC1pbmRleC5qcyIsICJzcmMvc3VidHlwZXMuanMiLCAic3JjL2Zyb250bWF0dGVyLXNvcnQuanMiLCAic3JjL2Zyb250bWF0dGVyLW9yZGVyLWVkaXRvci5qcyIsICJzcmMvdHlwZS1jb2xvcnMuanMiLCAic3JjL3NldHRpbmdzLmpzIiwgInNyYy9jb21tYW5kcy5qcyIsICJzcmMvc2hvcnRjdXRzLmpzIiwgInNyYy9zaG9ydGN1dC1waWNrZXIuanMiLCAic3JjL3R5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzIiwgInNyYy9mcm9udG1hdHRlci1ibG9ja3MuanMiLCAic3JjL3R5cGUtdXRpbHMuanMiLCAic3JjL3R5cC12aWV3LmpzIiwgInNyYy9maWxlLWV4cGxvcmVyLWNvbG9ycy5qcyIsICJzcmMvZ3JhcGgtY29sb3JzLmpzIiwgInNyYy9zZWFyY2gtY29sb3JzLmpzIiwgInNyYy9yZWNlbnQtZmlsZXMtY29sb3JzLmpzIiwgInNyYy9iYWNrbGluay1jb2xvcnMuanMiLCAic3JjL2Jvb2ttYXJrLWNvbG9ycy5qcyIsICJzcmMvYWN0aXZlLXRpdGxlLWNvbG9ycy5qcyIsICJzcmMvbGluay1jb2xvcnMuanMiLCAic3JjL2Zyb250bWF0dGVyLWRlZmF1bHQtaGlnaGxpZ2h0LmpzIiwgInNyYy9wcm9wZXJ0eS1yZW5hbWUtc3luYy5qcyIsICJzcmMvdHlwZS1waWNrZXIuanMiLCAic3JjL3Nob3J0Y3V0LXNjcmlwdHMuanMiLCAic3JjL21haW4uanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IHsgRXZlbnRzLCBURmlsZSwgZGVib3VuY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcblxuY29uc3QgVFlQX1BST1BFUlRZID0gXCJUWVBcIjtcbmNvbnN0IFNVQlRZUF9QUk9QRVJUWSA9IFwiU1VCVFlQXCI7XG5jb25zdCBFTVBUWV9FTlRSWSA9IE9iamVjdC5mcmVlemUoeyB0eXBlS2V5OiBudWxsLCByYXdUeXBlOiBudWxsLCBzdWJ0eXBlS2V5OiBudWxsLCByYXdTdWJ0eXBlOiBudWxsIH0pO1xuXG4vLyBTYW1tZWx0IFx1MDBDNG5kZXJ1bmdlbiBtZWhyZXJlciBEYXRlaWVuICh6LiBCLiBVbWJlbmVubmVuIGVpbmVzIFRZUHMgaW4gdmllbGVuXG4vLyBOb3RpemVuLCBWYXVsdC1TeW5jKSB6dSBlaW5lbSBlaW56aWdlbiBcImNoYW5nZVwiLUV2ZW50LiBPaG5lIHJlc2V0VGltZXIsIGRhbWl0XG4vLyBlaW4gRGF1ZXJzdHJvbSBhbiBcdTAwQzRuZGVydW5nZW4gdHJvdHpkZW0gcmVnZWxtXHUwMEU0XHUwMERGaWcgZHVyY2hnZXJlaWNodCB3aXJkLlxuY29uc3QgRkxVU0hfREVMQVlfTVMgPSAxMDA7XG5cbmZ1bmN0aW9uIHJhd0l0ZW0odmFsdWUpIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBcIlwiO1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiID8gSlNPTi5zdHJpbmdpZnkodmFsdWUpIDogU3RyaW5nKHZhbHVlKTtcbn1cblxuLy8gRWluaGVpdGxpY2hlIEF1c2xlZ3VuZyBlaW5lcyBUWVAtV2VydHMgZlx1MDBGQ3IgZGFzIGdhbnplIFBsdWdpbjogZGVyIFdlcnQgd2lyZFxuLy8gYmV3dXNzdCBOSUNIVCBnZWdsXHUwMEU0dHRldCwgc29uZGVybiBpbiBzZWluZXIgUm9oZm9ybSB6dW0gU2NobFx1MDBGQ3NzZWwgLSBlaW4gVFlQIGlzdFxuLy8gZ2VuYXUgZWluIGVpbnplbG5lciwgc2F1YmVyZXIgV2VydC4gQWxsZXMgYW5kZXJlIChMZWVyemVpY2hlbiBhbSBSYW5kLCBrbGVpblxuLy8gZ2VzY2hyaWViZW4sIExpc3RlIC0gYXVjaCBlaW5lIGVpbmVsZW1lbnRpZ2UpIGVyZ2lidCBlaW5lbiBlaWdlbmVuIFNjaGxcdTAwRkNzc2VsLFxuLy8gZGVyIGluIGtlaW5lbSByZWdpc3RyaWVydGVuIFRZUCBhdWZnZWh0OiBlciBiZWtvbW10IGtlaW5lIEZhcmJlLCB6XHUwMEU0aGx0IG5pY2h0XG4vLyBiZWltIFwicmljaHRpZ2VuXCIgVFlQIG1pdCB1bmQgc3RlaHQgaW4gZGVyIFRZUC1WaWV3IGFscyBlaWdlbmVyLFxuLy8gdW5yZWdpc3RyaWVydGVyIEVpbnRyYWcsIHZvbiB3byBhdXMgZXIgc2ljaCBwZXIgS2xpY2sgYmVyZWluaWdlbiBsXHUwMEU0c3N0XG4vLyAoc2llaGUgcmVnaXN0ZXJUeXBlIGluIHR5cC12aWV3LmpzKS4gTGlzdGVuIGVyc2NoZWluZW4gZGFiZWkgYWxzXG4vLyBcIltBLCBCXVwiIHVuZCBrXHUwMEY2bm5lbiBzbyBuaWUgbWl0IGVpbmVtIEVpbnplbHdlcnQgXCJBLCBCXCIgenVzYW1tZW5mYWxsZW4uXG4vLyBudWxsID0ga2VpbiBUWVAgKGZlaGxlbmQsIGxlZXIsIG51ciBMZWVyemVpY2hlbiwgbGVlcmUgTGlzdGUpLlxuZnVuY3Rpb24gdHlwZUtleU9mKHZhbHVlKSB7XG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgIGNvbnN0IGl0ZW1zID0gdmFsdWUubWFwKHJhd0l0ZW0pO1xuICAgIGlmIChpdGVtcy5ldmVyeSgoaXRlbSkgPT4gaXRlbS50cmltKCkgPT09IFwiXCIpKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gYFske2l0ZW1zLmpvaW4oXCIsIFwiKX1dYDtcbiAgfVxuICBjb25zdCB0ZXh0ID0gcmF3SXRlbSh2YWx1ZSk7XG4gIHJldHVybiB0ZXh0LnRyaW0oKSA9PT0gXCJcIiA/IG51bGwgOiB0ZXh0O1xufVxuXG4vLyBPYnNpZGlhbiBiZWhhbmRlbHQgUHJvcGVydHktTmFtZW4gb2huZSBCZWFjaHR1bmcgZGVyIEdyb1x1MDBERi0vS2xlaW5zY2hyZWlidW5nXG4vLyAoXCJTdWJ0eXBcIiB1bmQgXCJTVUJUWVBcIiBzaW5kIGluIFwiQWxsIHByb3BlcnRpZXNcIiBkaWVzZWxiZSBQcm9wZXJ0eSkgLSBUWVBcbi8vIHVuZCBTVUJUWVAgd2VyZGVuIGRlc2hhbGIgZ2VuYXVzbyBnZWxlc2VuLiBEaWUgZXhha3RlIFNjaHJlaWJ3ZWlzZSBoYXRcbi8vIFZvcnJhbmcsIGZhbGxzIGVpbmUgTm90aXogKGZlaGxlcmhhZnQpIG1laHJlcmUgVmFyaWFudGVuIHRyXHUwMEU0Z3QuXG5mdW5jdGlvbiBwcm9wZXJ0eUtleU9mKGZyb250bWF0dGVyLCBuYW1lKSB7XG4gIGlmICghZnJvbnRtYXR0ZXIpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoZnJvbnRtYXR0ZXIsIG5hbWUpKSByZXR1cm4gbmFtZTtcbiAgY29uc3QgbG93ZXIgPSBuYW1lLnRvTG93ZXJDYXNlKCk7XG4gIHJldHVybiBPYmplY3Qua2V5cyhmcm9udG1hdHRlcikuZmluZCgoa2V5KSA9PiBrZXkudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXIpO1xufVxuXG5mdW5jdGlvbiBwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBuYW1lKSB7XG4gIGNvbnN0IGtleSA9IHByb3BlcnR5S2V5T2YoZnJvbnRtYXR0ZXIsIG5hbWUpO1xuICByZXR1cm4ga2V5ID09PSB1bmRlZmluZWQgPyB1bmRlZmluZWQgOiBmcm9udG1hdHRlcltrZXldO1xufVxuXG4vLyBTY2hyZWlidCB2YWx1ZSB1bnRlciBkZXIgZWluaGVpdGxpY2hlbiBTY2hyZWlid2Vpc2UgbmFtZSAoei4gQi4gXCJTVUJUWVBcIilcbi8vIGluIGRhcyB2b24gcHJvY2Vzc0Zyb250TWF0dGVyIGdlbGllZmVydGUgT2JqZWt0LiBFaW5lIGFid2VpY2hlbmRcbi8vIGdlc2NocmllYmVuZSBWYXJpYW50ZSAoXCJTdWJ0eXBcIikgd2lyZCBkYWJlaSBhbiBPcnQgdW5kIFN0ZWxsZSB1bWJlbmFubnQgLVxuLy8gT2JqZWt0LUluc2VydGlvbi1PcmRlciBiZXN0aW1tdCBkaWUgWUFNTC1SZWloZW5mb2xnZSwgZGFoZXIgYmVpIEJlZGFyZiBhbGxlXG4vLyBLZXlzIGluIGJpc2hlcmlnZXIgUmVpaGVuZm9sZ2UgbmV1IGVpbmZcdTAwRkNnZW4gKHdpZSBpbiBmcm9udG1hdHRlci1zb3J0LmpzKS5cbmZ1bmN0aW9uIHNldENhbm9uaWNhbFByb3BlcnR5KGZyb250bWF0dGVyLCBuYW1lLCB2YWx1ZSkge1xuICBjb25zdCBsb3dlciA9IG5hbWUudG9Mb3dlckNhc2UoKTtcbiAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKGZyb250bWF0dGVyKTtcbiAgaWYgKCFrZXlzLnNvbWUoKGtleSkgPT4ga2V5ICE9PSBuYW1lICYmIGtleS50b0xvd2VyQ2FzZSgpID09PSBsb3dlcikpIHtcbiAgICBmcm9udG1hdHRlcltuYW1lXSA9IHZhbHVlO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBzbmFwc2hvdCA9IHsgLi4uZnJvbnRtYXR0ZXIgfTtcbiAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykgZGVsZXRlIGZyb250bWF0dGVyW2tleV07XG4gIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICBpZiAoa2V5LnRvTG93ZXJDYXNlKCkgIT09IGxvd2VyKSBmcm9udG1hdHRlcltrZXldID0gc25hcHNob3Rba2V5XTtcbiAgICBlbHNlIGlmICghKG5hbWUgaW4gZnJvbnRtYXR0ZXIpKSBmcm9udG1hdHRlcltuYW1lXSA9IHZhbHVlO1xuICB9XG59XG5cbi8vIEVudGZlcm50IG5hbWUgaW4gamVkZXIgU2NocmVpYndlaXNlIGF1cyBkZW0gdm9uIHByb2Nlc3NGcm9udE1hdHRlclxuLy8gZ2VsaWVmZXJ0ZW4gT2JqZWt0LlxuZnVuY3Rpb24gZGVsZXRlUHJvcGVydHkoZnJvbnRtYXR0ZXIsIG5hbWUpIHtcbiAgY29uc3QgbG93ZXIgPSBuYW1lLnRvTG93ZXJDYXNlKCk7XG4gIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGZyb250bWF0dGVyKSkge1xuICAgIGlmIChrZXkudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXIpIGRlbGV0ZSBmcm9udG1hdHRlcltrZXldO1xuICB9XG59XG5cbi8vIFNVQlRZUCB3aXJkIGdlbmF1c28gYXVzZ2VsZWd0ICh0eXBlS2V5T2YpOiBlaW5lIE5vdGl6IGhhdCBoXHUwMEY2Y2hzdGVucyBlaW5lblxuLy8gU1VCVFlQIGFscyBzYXViZXJlbiBFaW56ZWx3ZXJ0LCBhbGxlcyBhbmRlcmUgaXN0IGVpbiBlaWdlbmVyLCBuaWNodFxuLy8gZXJmYXNzdGVyIFNjaGxcdTAwRkNzc2VsIChzaWVoZSBTdWJ0eXAtQmxcdTAwRjZja2UgaW4gZGVyIFRZUC1EZXRhaWxhbnNpY2h0KS5cbmZ1bmN0aW9uIHNhbWVFbnRyeShhLCBiKSB7XG4gIHJldHVybiAhIWEgJiYgISFiICYmIGEudHlwZUtleSA9PT0gYi50eXBlS2V5ICYmIGEuc3VidHlwZUtleSA9PT0gYi5zdWJ0eXBlS2V5O1xufVxuXG4vLyBaZW50cmFsZXIgVFlQLS9TVUJUWVAtSW5kZXggXHUwMEZDYmVyIGFsbGUgTWFya2Rvd24tRGF0ZWllbiAoUGZhZCAtPiBXZXJ0ZSkuXG4vL1xuLy8gWndlY2s6IGRpZSBGYXJiLU1vZHVsZSBoaW5nZW4gYmlzaGVyIGFsbGUgZGlyZWt0IGFuIG1ldGFkYXRhQ2FjaGUgXCJjaGFuZ2VkXCJcbi8vIHVuZCBcInJlc29sdmVkXCIgLSBiZWlkZSBmZXVlcm4gYmVpIEpFREVSIFx1MDBDNG5kZXJ1bmcgYW4gaXJnZW5kZWluZXIgTm90aXogKGJlaW1cbi8vIFRpcHBlbiBldHdhIGFsbGUgendlaSBTZWt1bmRlbiksIHVuZCBqZWRlcyBNb2R1bCBmXHUwMEU0cmJ0ZSBkYXJhdWZoaW4gc2VpbmVcbi8vIGtvbXBsZXR0ZSBBbnNpY2h0IG5ldSwgZG9wcGVsdC4gRGVyIEluZGV4IHZlcmdsZWljaHQgc3RhdHRkZXNzZW4gamUgRGF0ZWksIG9iXG4vLyBzaWNoIFRZUCBvZGVyIFNVQlRZUCB0YXRzXHUwMEU0Y2hsaWNoIGdlXHUwMEU0bmRlcnQgaGF0IChiencuIGVpbmUgTm90aXogaGluenVrYW0vXG4vLyB3ZWdmaWVsKSwgdW5kIGZldWVydCBudXIgZGFubiBzZWluIGVpZ2VuZXMgXCJjaGFuZ2VcIi1FdmVudCAoQXJndW1lbnQ6IFNldCBkZXJcbi8vIGJldHJvZmZlbmVuIFBmYWRlKS4gTm9ybWFsZXMgU2NocmVpYmVuIGxcdTAwRjZzdCBkYW1pdCBnYXIga2VpbiBOZXUtRWluZlx1MDBFNHJiZW4gbWVociBhdXMuXG4vL1xuLy8gWnVzXHUwMEU0dHpsaWNoIGhcdTAwRTRsdCBlciBkaWUgdmF1bHQtd2VpdGVuIFpcdTAwRTRobHVuZ2VuIChUWVAtTGlzdGUsIFNVQlRZUC1MaXN0ZSxcbi8vIFBpY2tlciwgZ2V0VHlwZXMoKSBmXHUwMEZDciBUZW1wbGF0ZXIpIHp3aXNjaGVuZ2VzcGVpY2hlcnQsIHN0YXR0IHNpZSBiZWkgamVkZW1cbi8vIEF1ZnJ1ZiBwZXIgU2NhbiBcdTAwRkNiZXIgYWxsZSBOb3RpemVuIG5ldSB6dSBiZXJlY2huZW4uXG5jbGFzcyBUeXBJbmRleCBleHRlbmRzIEV2ZW50cyB7XG4gIGNvbnN0cnVjdG9yKHBsdWdpbikge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gICAgdGhpcy5hcHAgPSBwbHVnaW4uYXBwO1xuICAgIHRoaXMuZW50cmllcyA9IG5ldyBNYXAoKTtcbiAgICB0aGlzLmJ1aWx0ID0gZmFsc2U7XG4gICAgdGhpcy5hZ2dyZWdhdGVzID0gbnVsbDtcbiAgICB0aGlzLnBlbmRpbmdQYXRocyA9IG5ldyBTZXQoKTtcbiAgICB0aGlzLmZsdXNoID0gZGVib3VuY2UoKCkgPT4ge1xuICAgICAgY29uc3QgcGF0aHMgPSB0aGlzLnBlbmRpbmdQYXRocztcbiAgICAgIHRoaXMucGVuZGluZ1BhdGhzID0gbmV3IFNldCgpO1xuICAgICAgdGhpcy50cmlnZ2VyKFwiY2hhbmdlXCIsIHBhdGhzKTtcbiAgICB9LCBGTFVTSF9ERUxBWV9NUyk7XG4gIH1cblxuICByZWdpc3RlcigpIHtcbiAgICBjb25zdCB7IHBsdWdpbiwgYXBwIH0gPSB0aGlzO1xuICAgIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC5tZXRhZGF0YUNhY2hlLm9uKFwiY2hhbmdlZFwiLCAoZmlsZSkgPT4gdGhpcy51cGRhdGUoZmlsZSkpKTtcbiAgICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAubWV0YWRhdGFDYWNoZS5vbihcImRlbGV0ZWRcIiwgKGZpbGUpID0+IHRoaXMucmVtb3ZlKGZpbGUucGF0aCkpKTtcbiAgICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJyZW5hbWVcIiwgKGZpbGUsIG9sZFBhdGgpID0+IHRoaXMucmVuYW1lKGZpbGUsIG9sZFBhdGgpKSk7XG4gICAgLy8gXCJFeGNsdWRlZCBmaWxlc1wiLUxpc3RlIGdlXHUwMEU0bmRlcnQgKHNpZWhlIHJlZ2lzdGVyVHlwVmlldykgLSBkaWUgRWludHJcdTAwRTRnZVxuICAgIC8vIHNlbGJzdCBibGVpYmVuIGdcdTAwRkNsdGlnLCBudXIgZGllIGRhcmF1cyBnZWZpbHRlcnRlbiBaXHUwMEU0aGx1bmdlbiBuaWNodC5cbiAgICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJjb25maWctY2hhbmdlZFwiLCAoKSA9PiAodGhpcy5hZ2dyZWdhdGVzID0gbnVsbCkpKTtcblxuICAgIC8vIEJlaW0gQXBwLVN0YXJ0IGthbm4gZGVyIGVyc3RlIFp1Z3JpZmYgKGxhenksIHNpZWhlIGVuc3VyZUJ1aWx0KSBub2NoIHZvclxuICAgIC8vIGRlbSB2b2xsc3RcdTAwRTRuZGlnIGdlbGFkZW5lbiBNZXRhZGF0YUNhY2hlIGxpZWdlbi4gRWlubWFsaWcgbmFjaCBkZXNzZW5cbiAgICAvLyBlcnN0ZW0ga29tcGxldHRlbiBBdWZsXHUwMEY2c3VuZ3NkdXJjaGxhdWYgbmV1IGF1ZmJhdWVuOyBBYndlaWNodW5nZW4gbGFuZGVuXG4gICAgLy8gZGFiZWkgd2llIGplZGUgYW5kZXJlIFx1MDBDNG5kZXJ1bmcgaW0gXCJjaGFuZ2VcIi1FdmVudC5cbiAgICBjb25zdCByZXNvbHZlZFJlZiA9IGFwcC5tZXRhZGF0YUNhY2hlLm9uKFwicmVzb2x2ZWRcIiwgKCkgPT4ge1xuICAgICAgYXBwLm1ldGFkYXRhQ2FjaGUub2ZmcmVmKHJlc29sdmVkUmVmKTtcbiAgICAgIHRoaXMucmVidWlsZCgpO1xuICAgIH0pO1xuICAgIHBsdWdpbi5yZWdpc3RlckV2ZW50KHJlc29sdmVkUmVmKTtcblxuICAgIHBsdWdpbi5yZWdpc3RlcigoKSA9PiB0aGlzLmZsdXNoLmNhbmNlbCgpKTtcbiAgfVxuXG4gIHJlYWQoZmlsZSkge1xuICAgIGNvbnN0IGZyb250bWF0dGVyID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyO1xuICAgIGNvbnN0IHJhd1R5cGUgPSBwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBUWVBfUFJPUEVSVFkpID8/IG51bGw7XG4gICAgY29uc3QgcmF3U3VidHlwZSA9IHByb3BlcnR5VmFsdWUoZnJvbnRtYXR0ZXIsIFNVQlRZUF9QUk9QRVJUWSkgPz8gbnVsbDtcbiAgICByZXR1cm4geyB0eXBlS2V5OiB0eXBlS2V5T2YocmF3VHlwZSksIHJhd1R5cGUsIHN1YnR5cGVLZXk6IHR5cGVLZXlPZihyYXdTdWJ0eXBlKSwgcmF3U3VidHlwZSB9O1xuICB9XG5cbiAgZW5zdXJlQnVpbHQoKSB7XG4gICAgaWYgKCF0aGlzLmJ1aWx0KSB0aGlzLnJlYnVpbGQoKTtcbiAgfVxuXG4gIHJlYnVpbGQoKSB7XG4gICAgY29uc3QgcHJldmlvdXMgPSB0aGlzLmVudHJpZXM7XG4gICAgY29uc3Qgd2FzQnVpbHQgPSB0aGlzLmJ1aWx0O1xuICAgIHRoaXMuZW50cmllcyA9IG5ldyBNYXAoKTtcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpKSB0aGlzLmVudHJpZXMuc2V0KGZpbGUucGF0aCwgdGhpcy5yZWFkKGZpbGUpKTtcbiAgICB0aGlzLmJ1aWx0ID0gdHJ1ZTtcbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsO1xuICAgIGlmICghd2FzQnVpbHQpIHJldHVybjtcblxuICAgIGZvciAoY29uc3QgW3BhdGgsIGVudHJ5XSBvZiB0aGlzLmVudHJpZXMpIHtcbiAgICAgIGlmICghc2FtZUVudHJ5KHByZXZpb3VzLmdldChwYXRoKSwgZW50cnkpKSB0aGlzLnBlbmRpbmdQYXRocy5hZGQocGF0aCk7XG4gICAgfVxuICAgIGZvciAoY29uc3QgcGF0aCBvZiBwcmV2aW91cy5rZXlzKCkpIHtcbiAgICAgIGlmICghdGhpcy5lbnRyaWVzLmhhcyhwYXRoKSkgdGhpcy5wZW5kaW5nUGF0aHMuYWRkKHBhdGgpO1xuICAgIH1cbiAgICBpZiAodGhpcy5wZW5kaW5nUGF0aHMuc2l6ZSA+IDApIHRoaXMuZmx1c2goKTtcbiAgfVxuXG4gIG1hcmtDaGFuZ2VkKHBhdGgpIHtcbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsO1xuICAgIHRoaXMucGVuZGluZ1BhdGhzLmFkZChwYXRoKTtcbiAgICB0aGlzLmZsdXNoKCk7XG4gIH1cblxuICB1cGRhdGUoZmlsZSkge1xuICAgIC8vIFZvciBkZW0gZXJzdGVuIFp1Z3JpZmYgZ2lidCBlcyBub2NoIGtlaW5lbiB2ZXJhbHRldGVuIFN0YW5kIC0gZGVyXG4gICAgLy8gc3BcdTAwRTR0ZXJlIGxhenkgQXVmYmF1IGxpZXN0IG9obmVoaW4gZnJpc2NoIGF1cyBkZW0gTWV0YWRhdGFDYWNoZS5cbiAgICBpZiAoIXRoaXMuYnVpbHQgfHwgIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpIHx8IGZpbGUuZXh0ZW5zaW9uICE9PSBcIm1kXCIpIHJldHVybjtcbiAgICBjb25zdCBuZXh0ID0gdGhpcy5yZWFkKGZpbGUpO1xuICAgIGlmIChzYW1lRW50cnkodGhpcy5lbnRyaWVzLmdldChmaWxlLnBhdGgpLCBuZXh0KSkgcmV0dXJuO1xuICAgIHRoaXMuZW50cmllcy5zZXQoZmlsZS5wYXRoLCBuZXh0KTtcbiAgICB0aGlzLm1hcmtDaGFuZ2VkKGZpbGUucGF0aCk7XG4gIH1cblxuICByZW1vdmUocGF0aCkge1xuICAgIGlmICghdGhpcy5idWlsdCB8fCAhdGhpcy5lbnRyaWVzLmRlbGV0ZShwYXRoKSkgcmV0dXJuO1xuICAgIHRoaXMubWFya0NoYW5nZWQocGF0aCk7XG4gIH1cblxuICByZW5hbWUoZmlsZSwgb2xkUGF0aCkge1xuICAgIGlmICghdGhpcy5idWlsdCkgcmV0dXJuO1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5lbnRyaWVzLmdldChvbGRQYXRoKTtcbiAgICBpZiAoZW50cnkpIHtcbiAgICAgIHRoaXMuZW50cmllcy5kZWxldGUob2xkUGF0aCk7XG4gICAgICB0aGlzLm1hcmtDaGFuZ2VkKG9sZFBhdGgpO1xuICAgIH1cbiAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlICYmIGZpbGUuZXh0ZW5zaW9uID09PSBcIm1kXCIpIHtcbiAgICAgIHRoaXMuZW50cmllcy5zZXQoZmlsZS5wYXRoLCBlbnRyeSA/PyB0aGlzLnJlYWQoZmlsZSkpO1xuICAgICAgdGhpcy5tYXJrQ2hhbmdlZChmaWxlLnBhdGgpO1xuICAgIH1cbiAgfVxuXG4gIGVudHJ5Rm9yKGZpbGUpIHtcbiAgICBpZiAoIWZpbGUpIHJldHVybiBFTVBUWV9FTlRSWTtcbiAgICB0aGlzLmVuc3VyZUJ1aWx0KCk7XG4gICAgcmV0dXJuIHRoaXMuZW50cmllcy5nZXQoZmlsZS5wYXRoKSA/PyBFTVBUWV9FTlRSWTtcbiAgfVxuXG4gIC8vIFRZUC1TY2hsXHUwMEZDc3NlbCAoc2llaGUgdHlwZUtleU9mKSBvZGVyIG51bGwuIEZcdTAwRkNyIGVpbmVuIHNhdWJlcmVuIFdlcnQgaXN0IGRhc1xuICAvLyBzY2hsaWNodCBkZXIgVFlQLU5hbWUgc2VsYnN0LlxuICB0eXBlT2YoZmlsZSkge1xuICAgIHJldHVybiB0aGlzLmVudHJ5Rm9yKGZpbGUpLnR5cGVLZXk7XG4gIH1cblxuICAvLyBTVUJUWVAtU2NobFx1MDBGQ3NzZWwgKHNpZWhlIHR5cGVLZXlPZikgb2RlciBudWxsLlxuICBzdWJ0eXBlT2YoZmlsZSkge1xuICAgIHJldHVybiB0aGlzLmVudHJ5Rm9yKGZpbGUpLnN1YnR5cGVLZXk7XG4gIH1cblxuICAvLyBFaW4gdGF0c1x1MDBFNGNobGljaGVyIEZyb250bWF0dGVyLVdlcnQgenUgZWluZW0gU2NobFx1MDBGQ3NzZWwgLSBmXHUwMEZDciBBbnplaWdlLCBTdWNoZVxuICAvLyB1bmQgTm9ybWFsaXNpZXJ1bmcgdW5yZWdpc3RyaWVydGVyIEVpbnRyXHUwMEU0Z2UgKGFsbGUgTm90aXplbiBlaW5lcyBTY2hsXHUwMEZDc3NlbHNcbiAgLy8gaGFiZW4gcGVyIERlZmluaXRpb24gZGllc2VsYmUgUm9oZm9ybSkuXG4gIHJhd1ZhbHVlT2YodHlwZUtleSkge1xuICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZSgpLnJhd0J5S2V5LmdldCh0eXBlS2V5KTtcbiAgfVxuXG4gIC8vIFNhdWJlcmVyIFdlcnQgPSBFaW56ZWx3ZXJ0IG9obmUgTGVlcnplaWNoZW4gYW0gUmFuZC4gS2xlaW4gZ2VzY2hyaWViZW5lXG4gIC8vIFdlcnRlIHpcdTAwRTRobGVuIGhpZXIgYWxzIHNhdWJlciAoc2llIHNpbmQgZWluIGdcdTAwRkNsdGlnZXIsIG51ciBub2NoIG5pY2h0XG4gIC8vIHJlZ2lzdHJpZXJ0ZXIgVFlQLU5hbWUpLCBMaXN0ZW4gdW5kIFJhbmRsZWVyemVpY2hlbiBuaWNodC5cbiAgaXNDbGVhbktleSh0eXBlS2V5KSB7XG4gICAgY29uc3QgcmF3ID0gdGhpcy5yYXdWYWx1ZU9mKHR5cGVLZXkpO1xuICAgIHJldHVybiByYXcgIT09IHVuZGVmaW5lZCAmJiAhQXJyYXkuaXNBcnJheShyYXcpICYmIHR5cGVLZXkgPT09IHR5cGVLZXkudHJpbSgpO1xuICB9XG5cbiAgLy8gRGF0ZWllbiBtaXQgZ2VuYXUgZGllc2VtIFRZUC1TY2hsXHUwMEZDc3NlbCwgdW50ZXIgQmVhY2h0dW5nIGRlclxuICAvLyBcIklnbm9yaWVydGUgTm90aXplbiBiZXJcdTAwRkNja3NpY2h0aWdlblwiLUVpbnN0ZWxsdW5nLlxuICBmaWxlc1dpdGhUeXBlKHR5cGVLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5maWxlc01hdGNoaW5nKChlbnRyeSkgPT4gZW50cnkudHlwZUtleSA9PT0gdHlwZUtleSk7XG4gIH1cblxuICAvLyBEYXRlaWVuIG1pdCBnZW5hdSBkaWVzZW0gVFlQLSB1bmQgU1VCVFlQLVNjaGxcdTAwRkNzc2VsLlxuICBmaWxlc1dpdGhTdWJ0eXBlKHR5cGVLZXksIHN1YnR5cGVLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5maWxlc01hdGNoaW5nKChlbnRyeSkgPT4gZW50cnkudHlwZUtleSA9PT0gdHlwZUtleSAmJiBlbnRyeS5zdWJ0eXBlS2V5ID09PSBzdWJ0eXBlS2V5KTtcbiAgfVxuXG4gIGZpbGVzTWF0Y2hpbmcocHJlZGljYXRlKSB7XG4gICAgdGhpcy5lbnN1cmVCdWlsdCgpO1xuICAgIGNvbnN0IGluY2x1ZGVJZ25vcmVkID0gISF0aGlzLnBsdWdpbi5zZXR0aW5ncy5pbmNsdWRlSWdub3JlZEZpbGVzO1xuICAgIGNvbnN0IGZpbGVzID0gW107XG4gICAgZm9yIChjb25zdCBbcGF0aCwgZW50cnldIG9mIHRoaXMuZW50cmllcykge1xuICAgICAgaWYgKCFwcmVkaWNhdGUoZW50cnkpKSBjb250aW51ZTtcbiAgICAgIGlmICghaW5jbHVkZUlnbm9yZWQgJiYgdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5pc1VzZXJJZ25vcmVkKHBhdGgpKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgocGF0aCk7XG4gICAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSBmaWxlcy5wdXNoKGZpbGUpO1xuICAgIH1cbiAgICByZXR1cm4gZmlsZXM7XG4gIH1cblxuICAvLyBSZXNwZWt0aWVydCBzdGFuZGFyZG1cdTAwRTRcdTAwREZpZyBPYnNpZGlhbnMgZWlnZW5lIFwiRXhjbHVkZWQgZmlsZXNcIi1MaXN0ZSAtIGRvcnRcbiAgLy8gdHJhZ2VuIGF1Y2ggUGx1Z2lucyB3aWUgSGlkZSBGb2xkZXJzIGF1c2dlYmxlbmRldGUgT3JkbmVyIGVpbi4gXHUwMERDYmVyIGRpZVxuICAvLyBFaW5zdGVsbHVuZyBcIklnbm9yaWVydGUgTm90aXplbiBiZXJcdTAwRkNja3NpY2h0aWdlblwiIGFic2NoYWx0YmFyLlxuICAvL1xuICAvLyBFaW5lIE5vdGl6IG9obmUgVFlQIGhhdCBrZWluZW4gU1VCVFlQLUtvbnRleHQuXG4gIGFnZ3JlZ2F0ZSgpIHtcbiAgICB0aGlzLmVuc3VyZUJ1aWx0KCk7XG4gICAgY29uc3QgaW5jbHVkZUlnbm9yZWQgPSAhIXRoaXMucGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXM7XG4gICAgaWYgKHRoaXMuYWdncmVnYXRlcz8uaW5jbHVkZUlnbm9yZWQgPT09IGluY2x1ZGVJZ25vcmVkKSByZXR1cm4gdGhpcy5hZ2dyZWdhdGVzO1xuXG4gICAgY29uc3QgY291bnRzID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IHJhd0J5S2V5ID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IHN1YnR5cGVzQnlUeXBlID0gbmV3IE1hcCgpO1xuICAgIGxldCBub1R5cGUgPSAwO1xuICAgIGZvciAoY29uc3QgW3BhdGgsIHsgdHlwZUtleSwgcmF3VHlwZSwgc3VidHlwZUtleSwgcmF3U3VidHlwZSB9XSBvZiB0aGlzLmVudHJpZXMpIHtcbiAgICAgIGlmICghaW5jbHVkZUlnbm9yZWQgJiYgdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5pc1VzZXJJZ25vcmVkKHBhdGgpKSBjb250aW51ZTtcbiAgICAgIGlmICh0eXBlS2V5ID09PSBudWxsKSB7XG4gICAgICAgIG5vVHlwZSsrO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvdW50cy5zZXQodHlwZUtleSwgKGNvdW50cy5nZXQodHlwZUtleSkgPz8gMCkgKyAxKTtcbiAgICAgIGlmICghcmF3QnlLZXkuaGFzKHR5cGVLZXkpKSByYXdCeUtleS5zZXQodHlwZUtleSwgcmF3VHlwZSk7XG4gICAgICBsZXQgYnVja2V0ID0gc3VidHlwZXNCeVR5cGUuZ2V0KHR5cGVLZXkpO1xuICAgICAgaWYgKCFidWNrZXQpIHtcbiAgICAgICAgYnVja2V0ID0geyBjb3VudHM6IG5ldyBNYXAoKSwgbm9TdWJ0eXBlOiAwLCByYXdCeUtleTogbmV3IE1hcCgpIH07XG4gICAgICAgIHN1YnR5cGVzQnlUeXBlLnNldCh0eXBlS2V5LCBidWNrZXQpO1xuICAgICAgfVxuICAgICAgaWYgKHN1YnR5cGVLZXkgPT09IG51bGwpIHtcbiAgICAgICAgYnVja2V0Lm5vU3VidHlwZSsrO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYnVja2V0LmNvdW50cy5zZXQoc3VidHlwZUtleSwgKGJ1Y2tldC5jb3VudHMuZ2V0KHN1YnR5cGVLZXkpID8/IDApICsgMSk7XG4gICAgICAgIGlmICghYnVja2V0LnJhd0J5S2V5LmhhcyhzdWJ0eXBlS2V5KSkgYnVja2V0LnJhd0J5S2V5LnNldChzdWJ0eXBlS2V5LCByYXdTdWJ0eXBlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5hZ2dyZWdhdGVzID0geyBpbmNsdWRlSWdub3JlZCwgY291bnRzLCBub1R5cGUsIHJhd0J5S2V5LCBzdWJ0eXBlc0J5VHlwZSB9O1xuICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZXM7XG4gIH1cblxuICAvLyBad2lzY2hlbmdlc3BlaWNoZXJ0IC0gZGllIGdlbGllZmVydGVuIE1hcHMgbmljaHQgdmVyXHUwMEU0bmRlcm4uXG4gIHR5cGVDb3VudHMoKSB7XG4gICAgY29uc3QgeyBjb3VudHMsIG5vVHlwZSB9ID0gdGhpcy5hZ2dyZWdhdGUoKTtcbiAgICByZXR1cm4geyBjb3VudHMsIG5vVHlwZSB9O1xuICB9XG5cbiAgLy8gVFlQIC0+IHsgY291bnRzOiBNYXAoU1VCVFlQLVNjaGxcdTAwRkNzc2VsIC0+IEFuemFobCksIG5vU3VidHlwZSwgcmF3QnlLZXkgfS5cbiAgLy8gWndpc2NoZW5nZXNwZWljaGVydCAtIG5pY2h0IHZlclx1MDBFNG5kZXJuLlxuICBzdWJ0eXBlQ291bnRzKCkge1xuICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZSgpLnN1YnR5cGVzQnlUeXBlO1xuICB9XG5cbiAgc3VidHlwZUJ1Y2tldCh0eXBlS2V5KSB7XG4gICAgcmV0dXJuIHRoaXMuc3VidHlwZUNvdW50cygpLmdldCh0eXBlS2V5KSA/PyBFTVBUWV9CVUNLRVQ7XG4gIH1cbn1cblxuY29uc3QgRU1QVFlfQlVDS0VUID0gT2JqZWN0LmZyZWV6ZSh7IGNvdW50czogbmV3IE1hcCgpLCBub1N1YnR5cGU6IDAsIHJhd0J5S2V5OiBuZXcgTWFwKCkgfSk7XG5cbm1vZHVsZS5leHBvcnRzID0geyBUeXBJbmRleCwgdHlwZUtleU9mLCBwcm9wZXJ0eVZhbHVlLCBzZXRDYW5vbmljYWxQcm9wZXJ0eSwgZGVsZXRlUHJvcGVydHksIFRZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZIH07XG4iLCAiY29uc3QgeyB0eXBlS2V5T2YsIHByb3BlcnR5VmFsdWUsIHNldENhbm9uaWNhbFByb3BlcnR5LCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcclxuXHJcbi8vIFN1YnR5cC1OYW1lbiB3ZXJkZW4gKGFuZGVycyBhbHMgVFlQZW4sIHNpZWhlIG5vcm1hbGl6ZVR5cGVOYW1lKSBtaXQgZ3JvXHUwMERGZW1cclxuLy8gQW5mYW5nc2J1Y2hzdGFiZW4gamUgV29ydCBnZXNjaHJpZWJlbiwgZGVyIFJlc3Qga2xlaW46IFwia3VyeiBHRVNDSElDSFRFXCIgXHUyMTkyXHJcbi8vIFwiS3VyeiBHZXNjaGljaHRlXCIuIERpZSBQcm9wZXJ0eSBTVUJUWVAgc2VsYnN0IGJsZWlidCBpbiBHcm9cdTAwREZidWNoc3RhYmVuLlxyXG5mdW5jdGlvbiBub3JtYWxpemVTdWJ0eXBlTmFtZShyYXcpIHtcclxuICByZXR1cm4gcmF3LnRyaW0oKS5yZXBsYWNlKC9cXFMrL2csICh3b3JkKSA9PiB3b3JkLmNoYXJBdCgwKS50b0xvY2FsZVVwcGVyQ2FzZShcImRlXCIpICsgd29yZC5zbGljZSgxKS50b0xvY2FsZUxvd2VyQ2FzZShcImRlXCIpKTtcclxufVxyXG5cclxuLy8gUmVnaXN0cmllcnRlIFNVQlRZUGVuIGplIFRZUCAoc2V0dGluZ3MudHlwZVN1YnR5cGVzKTpcclxuLy8gICB7IFtUWVBdOiB7IFtTVUJUWVBdOiB7IGZyb250bWF0dGVyOiB7Li4ufSwgZmxvYXRpbmdLZXlzOiBbLi4uXSwgc2hvcnRjdXRzOiB7Li4ufSB9IH0gfVxyXG4vLyBFaW4gU3VidHlwIGdlaFx1MDBGNnJ0IGltbWVyIHp1IGdlbmF1IGVpbmVtIFRZUDsgZGVyc2VsYmUgTmFtZSBkYXJmIGFiZXIgKGFsc1xyXG4vLyBlaWdlbnN0XHUwMEU0bmRpZ2VyIFN1YnR5cCkgYXVjaCB1bnRlciBlaW5lbSBhbmRlcmVuIFRZUCB2b3Jrb21tZW4uIERpZVxyXG4vLyBSZWloZW5mb2xnZSBkZXIgU2NobFx1MDBGQ3NzZWwgaXN0IGRpZSBBbnplaWdlcmVpaGVuZm9sZ2UgZGVyIEJsXHUwMEY2Y2tlIGluIGRlclxyXG4vLyBUWVAtRGV0YWlsYW5zaWNodCwgc3RldHMgdW50ZXJoYWxiIGRlcyBUWVAtRnJvbnRtYXR0ZXJzLiBmcm9udG1hdHRlclxyXG4vLyBlcmdcdTAwRTRuenQgYnp3LiBcdTAwRkNiZXJzY2hyZWlidCBkYXMgVFlQLUZyb250bWF0dGVyIGRlcyBUWVBzLCBmbG9hdGluZ0tleXMgd2llXHJcbi8vIHR5cGVGbG9hdGluZ0tleXMsIHNob3J0Y3V0cyB3aWUgdHlwZVNob3J0Y3V0cyAoc2llaGUgc2hvcnRjdXRzLmpzKSAtIGplIEtleVxyXG4vLyBkZXMgQmxvY2tzIGVpbiBTaG9ydGN1dC1SZWNvcmQsIGRlciBXZXJ0IGRlcyBLZXlzIGJsZWlidCBkYWJlaSBhbHNcclxuLy8gUlx1MDBGQ2NrZmFsbHdlcnQgc3RlaGVuLiBCZXN0YW5kc2RhdGVuIGZcdTAwRkNocmVuIHNob3J0Y3V0cyBub2NoIG5pY2h0LCBMZXNlciBtXHUwMEZDc3NlblxyXG4vLyBlcyBkYWhlciBhbHMgb3B0aW9uYWwgYmVoYW5kZWxuLlxyXG4vL1xyXG4vLyBEZXJzZWxiZSBLZXkgZGFyZiBpbiBtZWhyZXJlbiBCbFx1MDBGNmNrZW4gZWluZXMgVFlQcyBzdGVoZW4gKG51ciBpbm5lcmhhbGJcclxuLy8gRUlORVMgQmxvY2tzIGlzdCBlciB6d2FuZ3NsXHUwMEU0dWZpZyBlaW5kZXV0aWcpOlxyXG4vLyAgIC0gaW4gendlaSBTdWJ0eXAtQmxcdTAwRjZja2VuOiBrb25mbGlrdGZyZWksIGRhIGVpbmUgTm90aXogaFx1MDBGNmNoc3RlbnMgZWluZW5cclxuLy8gICAgIFNVQlRZUCBoYXQgdW5kIGRpZSBCbFx1MDBGNmNrZSBkYW1pdCBuaWUgZ2xlaWNoemVpdGlnIGdlbHRlbjtcclxuLy8gICAtIGltIFRZUC1Gcm9udG1hdHRlciBVTkQgZWluZW0gU3VidHlwLUJsb2NrOiBkZXIgU3VidHlwIFx1MDBGQ2JlcnNjaHJlaWJ0XHJcbi8vICAgICBXZXJ0IHVuZCBGbG9hdGluZy1NYXJraWVydW5nLCBkaWUgWmVpbGUgYmVoXHUwMEU0bHQgYWJlciBkaWUgUG9zaXRpb24gZGVzXHJcbi8vICAgICBUWVAtRnJvbnRtYXR0ZXJzIChzaWVoZSBnZXRUeXBlRGVmYXVsdHMgaW4gbWFpbi5qcyB1bmRcclxuLy8gICAgIG9yZGVyZWREZWZhdWx0S2V5cyBpbiBmcm9udG1hdHRlci1zb3J0LmpzIC0gYmVpZGUgbVx1MDBGQ3NzZW4gZGllc2VsYmVcclxuLy8gICAgIFJlZ2VsIHZlcndlbmRlbiwgc29uc3Qgc29ydGllcnQgZGllIEZyb250bWF0dGVyLVNvcnRpZXJ1bmcgZWluZSBnZXJhZGVcclxuLy8gICAgIGFuZ2VsZWd0ZSBOb3RpeiBzb2ZvcnQgd2llZGVyIHVtKS5cclxuXHJcbi8vIFwiTm9jaCBhdXN6dWZcdTAwRkNsbGVuXCIgLSBlaW4gc29sY2hlciBXZXJ0IHdpcmQgYmVpbSBadXNhbW1lbmxlZ2VuIHp3ZWllclxyXG4vLyBCbFx1MDBGNmNrZSBiencuIHp3ZWllciBQcm9wZXJ0aWVzIHZvbSBqZXdlaWxzIGFuZGVyZW4gZ2VmXHUwMEZDbGx0LCBzdGF0dCBkZW5cclxuLy8gYmVzdGVoZW5kZW4gRWludHJhZyB6dSBcdTAwRkNiZXJzY2hyZWliZW4gKHNpZWhlIG1lcmdlU3VidHlwZXMgaGllciB1bmRcclxuLy8gcmVuYW1lSW5TdG9yZSBpbiBwcm9wZXJ0eS1yZW5hbWUtc3luYy5qcykuXHJcbmZ1bmN0aW9uIGlzRW1wdHlWYWx1ZSh2YWx1ZSkge1xyXG4gIHJldHVybiB2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSBcIlwiO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRTdWJ0eXBlTmFtZXMoc2V0dGluZ3MsIHR5cGUpIHtcclxuICByZXR1cm4gT2JqZWN0LmtleXMoc2V0dGluZ3MudHlwZVN1YnR5cGVzPy5bdHlwZV0gPz8ge30pO1xyXG59XHJcblxyXG5mdW5jdGlvbiBnZXRTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKSB7XHJcbiAgcmV0dXJuIHNldHRpbmdzLnR5cGVTdWJ0eXBlcz8uW3R5cGVdPy5bc3VidHlwZV0gPz8gbnVsbDtcclxufVxyXG5cclxuZnVuY3Rpb24gZW5zdXJlU3VidHlwZShzZXR0aW5ncywgdHlwZSwgc3VidHlwZSkge1xyXG4gIGlmICghc2V0dGluZ3MudHlwZVN1YnR5cGVzKSBzZXR0aW5ncy50eXBlU3VidHlwZXMgPSB7fTtcclxuICBpZiAoIXNldHRpbmdzLnR5cGVTdWJ0eXBlc1t0eXBlXSkgc2V0dGluZ3MudHlwZVN1YnR5cGVzW3R5cGVdID0ge307XHJcbiAgY29uc3QgYnlOYW1lID0gc2V0dGluZ3MudHlwZVN1YnR5cGVzW3R5cGVdO1xyXG4gIGlmICghYnlOYW1lW3N1YnR5cGVdKSBieU5hbWVbc3VidHlwZV0gPSB7IGZyb250bWF0dGVyOiB7fSwgZmxvYXRpbmdLZXlzOiBbXSwgc2hvcnRjdXRzOiB7fSB9O1xyXG4gIHJldHVybiBieU5hbWVbc3VidHlwZV07XHJcbn1cclxuXHJcbi8vIEJlaW0gVW1iZW5lbm5lbiBlaW5lcyBUWVBzOiBTdWJ0eXBlbiB3YW5kZXJuIHVudGVyIGRlbiBuZXVlbiBOYW1lbiBtaXQuXHJcbmZ1bmN0aW9uIG1vdmVUeXBlU3VidHlwZXMoc2V0dGluZ3MsIG9sZFR5cGUsIG5ld1R5cGUpIHtcclxuICBpZiAoIXNldHRpbmdzLnR5cGVTdWJ0eXBlcz8uW29sZFR5cGVdKSByZXR1cm47XHJcbiAgc2V0dGluZ3MudHlwZVN1YnR5cGVzW25ld1R5cGVdID0gc2V0dGluZ3MudHlwZVN1YnR5cGVzW29sZFR5cGVdO1xyXG4gIGRlbGV0ZSBzZXR0aW5ncy50eXBlU3VidHlwZXNbb2xkVHlwZV07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGRlbGV0ZVR5cGVTdWJ0eXBlcyhzZXR0aW5ncywgdHlwZSkge1xyXG4gIGlmIChzZXR0aW5ncy50eXBlU3VidHlwZXMpIGRlbGV0ZSBzZXR0aW5ncy50eXBlU3VidHlwZXNbdHlwZV07XHJcbn1cclxuXHJcbi8vIEVudGZlcm50IGRpZSBNYXJraWVydW5nIGFib3ZlU3RhbmRhcmQgYXVzIEJlc3RhbmRzZGF0ZW46IFN1YnR5cC1CbFx1MDBGNmNrZVxyXG4vLyBkdXJmdGVuIGZyXHUwMEZDaGVyIFx1MDBGQ2JlciBkZW0gVFlQLUZyb250bWF0dGVyIGxpZWdlbiwgZGFzIHN0ZWh0IGpldHp0IGZlc3QgZ2FuelxyXG4vLyBvYmVuIChzaWVoZSBnZXRTZWN0aW9uT3JkZXIpLiBMaWVmZXJ0IHRydWUgYmVpIGVpbmVyIFx1MDBDNG5kZXJ1bmcuXHJcbmZ1bmN0aW9uIG1pZ3JhdGVBYm92ZVN0YW5kYXJkKHNldHRpbmdzKSB7XHJcbiAgbGV0IGNoYW5nZWQgPSBmYWxzZTtcclxuICBmb3IgKGNvbnN0IGJ5TmFtZSBvZiBPYmplY3QudmFsdWVzKHNldHRpbmdzLnR5cGVTdWJ0eXBlcyA/PyB7fSkpIHtcclxuICAgIGZvciAoY29uc3QgZGF0YSBvZiBPYmplY3QudmFsdWVzKGJ5TmFtZSkpIHtcclxuICAgICAgaWYgKGRhdGEuYWJvdmVTdGFuZGFyZCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcclxuICAgICAgZGVsZXRlIGRhdGEuYWJvdmVTdGFuZGFyZDtcclxuICAgICAgY2hhbmdlZCA9IHRydWU7XHJcbiAgICB9XHJcbiAgfVxyXG4gIHJldHVybiBjaGFuZ2VkO1xyXG59XHJcblxyXG4vLyBEaWUgUmVnbGVyIGRlciBTdWJ0eXAtRmFyYmVuIGhhYmVuIHp3ZWltYWwgaWhyZSBCZWRldXR1bmcgZ2VcdTAwRTRuZGVydCwgb2huZVxyXG4vLyBkYXNzIHNpY2ggZGllIGdlc3BlaWNoZXJ0ZW4gWmFobGVuIHZvbiBzZWxic3QgbWl0YmV3ZWd0IGhcdTAwRTR0dGVuIChzaWVoZVxyXG4vLyBhcHBseUNvbG9yT2Zmc2V0IHVuZCBjaGFubmVsQm91bmRzIGluIHR5cGUtY29sb3JzLmpzKS4gc2V0dGluZ3MuXHJcbi8vIHN1YnR5cGVDb2xvclNjYWxlIGhcdTAwRTRsdCBmZXN0LCB3ZWxjaGVuIFN0YW5kIGRpZSBnZXNwZWljaGVydGVuIFdlcnRlIGhhYmVuO1xyXG4vLyBqZWRlciBTY2hyaXR0IGxcdTAwRTR1ZnQgZ2VuYXUgZWlubWFsLiBMaWVmZXJ0IHRydWUgYmVpIGVpbmVyIFx1MDBDNG5kZXJ1bmcgLSBkaWVcclxuLy8gZ2VoXHUwMEY2cnQgc29mb3J0IGdlc3BlaWNoZXJ0LCBzb25zdCBsaWVmZSBkaWUgVW1yZWNobnVuZyBiZWltIG5cdTAwRTRjaHN0ZW4gU3RhcnRcclxuLy8gZXJuZXV0LiBXYXJlbiBkaWUgR3JlbnplbiBub2NoIGRpZSBTdGFuZGFyZHdlcnRlIGRlcyBqZXdlaWxpZ2VuIFN0YW5kcyxcclxuLy8gZ2VsdGVuIGRhbmFjaCBkaWUgbmV1ZW4uXHJcbi8vICAgMSAtPiAyOiBIZWxsaWdrZWl0IHpcdTAwRTRobHRlIGFic29sdXRlIE9LTENILVB1bmt0ZSwgamV0enQgZGVuIEFudGVpbCBkZXMgV2Vnc1xyXG4vLyAgICAgICAgICAgenUgV2VpXHUwMERGIGJ6dy4gU2Nod2Fyei4gRGllIGFsdGUgWmFobCBsXHUwMEU0c3N0IHNpY2ggbmljaHQgdW1yZWNobmVuXHJcbi8vICAgICAgICAgICAoc2llIGhpbmcgdm9uIGRlciBUWVAtRmFyYmUgYWIpLCB3b2hsIGFiZXIgZGllIEFic2ljaHQgZGFoaW50ZXI6XHJcbi8vICAgICAgICAgICB3YXMgZGVuIFJlZ2xlciBoYWxiIGF1c3JlaXp0ZSwgcmVpenQgaWhuIGF1Y2ggZGFuYWNoIGhhbGIgYXVzLlxyXG4vLyAgIDIgLT4gMzogZGllIFNcdTAwRTR0dGlndW5nIGdlaHQgbnVyIG5vY2ggbmFjaCB1bnRlbjsgZ2VzcGVpY2hlcnRlIHBvc2l0aXZlXHJcbi8vICAgICAgICAgICBXZXJ0ZSBzaW5kIHNvbnN0IHN0dW1tIGdla2FwcHQgdW5kIHdcdTAwRTRyZW4gYmVpbSBuXHUwMEU0Y2hzdGVuIFx1MDBENmZmbmVuIGRlc1xyXG4vLyAgICAgICAgICAgUG9wb3ZlcnMgdW5hbmdla1x1MDBGQ25kaWd0IHZlcnNjaHd1bmRlbi5cclxuY29uc3QgU1VCVFlQRV9DT0xPUl9TQ0FMRSA9IDM7XHJcbmNvbnN0IFBSRVZJT1VTX1NVQlRZUEVfQ09MT1JfUkFOR0VTID0ge1xyXG4gIDI6IHsgaDogMjUsIHM6IDMwLCBsOiAyMCB9LFxyXG4gIDM6IHsgaDogMzUsIHM6IDIwLCBsOiA0MCB9LFxyXG59O1xyXG5cclxuZnVuY3Rpb24gbWlncmF0ZVN1YnR5cGVDb2xvclNjYWxlKHNldHRpbmdzLCBkZWZhdWx0UmFuZ2VzKSB7XHJcbiAgY29uc3QgZnJvbSA9IE51bWJlcihzZXR0aW5ncy5zdWJ0eXBlQ29sb3JTY2FsZSkgfHwgMTtcclxuICBpZiAoZnJvbSA+PSBTVUJUWVBFX0NPTE9SX1NDQUxFKSByZXR1cm4gZmFsc2U7XHJcbiAgY29uc3QgYWxsQ29sb3JzID0gZnVuY3Rpb24qICgpIHtcclxuICAgIGZvciAoY29uc3QgYnlOYW1lIG9mIE9iamVjdC52YWx1ZXMoc2V0dGluZ3MudHlwZVN1YnR5cGVzID8/IHt9KSkge1xyXG4gICAgICBmb3IgKGNvbnN0IGRhdGEgb2YgT2JqZWN0LnZhbHVlcyhieU5hbWUpKSBpZiAoZGF0YS5jb2xvcikgeWllbGQgZGF0YS5jb2xvcjtcclxuICAgIH1cclxuICB9O1xyXG4gIGNvbnN0IGFkb3B0RGVmYXVsdHMgPSAoc3RlcCkgPT4ge1xyXG4gICAgY29uc3QgcHJldmlvdXMgPSBQUkVWSU9VU19TVUJUWVBFX0NPTE9SX1JBTkdFU1tzdGVwXTtcclxuICAgIGlmIChPYmplY3QuZW50cmllcyhwcmV2aW91cykuZXZlcnkoKFtrZXksIHZhbHVlXSkgPT4gTnVtYmVyKHNldHRpbmdzLnN1YnR5cGVDb2xvclJhbmdlcz8uW2tleV0pID09PSB2YWx1ZSkpIHtcclxuICAgICAgc2V0dGluZ3Muc3VidHlwZUNvbG9yUmFuZ2VzID0geyAuLi5kZWZhdWx0UmFuZ2VzIH07XHJcbiAgICB9XHJcbiAgfTtcclxuICBpZiAoZnJvbSA8IDIpIHtcclxuICAgIGNvbnN0IG9sZFJhbmdlID0gTnVtYmVyKHNldHRpbmdzLnN1YnR5cGVDb2xvclJhbmdlcz8ubCk7XHJcbiAgICBhZG9wdERlZmF1bHRzKDIpO1xyXG4gICAgY29uc3QgbmV3UmFuZ2UgPSBOdW1iZXIoc2V0dGluZ3Muc3VidHlwZUNvbG9yUmFuZ2VzPy5sKTtcclxuICAgIGNvbnN0IGZhY3RvciA9IG9sZFJhbmdlID4gMCAmJiBOdW1iZXIuaXNGaW5pdGUobmV3UmFuZ2UpID8gbmV3UmFuZ2UgLyBvbGRSYW5nZSA6IDE7XHJcbiAgICBmb3IgKGNvbnN0IGNvbG9yIG9mIGFsbENvbG9ycygpKSBpZiAoY29sb3IubCkgY29sb3IubCA9IE1hdGgucm91bmQoY29sb3IubCAqIGZhY3Rvcik7XHJcbiAgfVxyXG4gIGlmIChmcm9tIDwgMykge1xyXG4gICAgYWRvcHREZWZhdWx0cygzKTtcclxuICAgIGZvciAoY29uc3QgY29sb3Igb2YgYWxsQ29sb3JzKCkpIGlmIChjb2xvci5zID4gMCkgY29sb3IucyA9IDA7XHJcbiAgfVxyXG4gIHNldHRpbmdzLnN1YnR5cGVDb2xvclNjYWxlID0gU1VCVFlQRV9DT0xPUl9TQ0FMRTtcclxuICByZXR1cm4gdHJ1ZTtcclxufVxyXG5cclxuLy8gWnVzYW1tZW5sZWdlbiB6d2VpZXIgVFlQZW46IFN1YnR5cGVuLCBkaWUgZXMgbnVyIGJlaSBzb3VyY2UgZ2lidCwgd2VyZGVuXHJcbi8vIFx1MDBGQ2Jlcm5vbW1lbi4gR2xlaWNobmFtaWdlIEJsXHUwMEY2Y2tlIHdlcmRlbiB2ZXJlaW5pZ3QgLSBiZWkgZ2xlaWNoZW0gS2V5XHJcbi8vIGdld2lubmVuIFdlcnQgdW5kIEZsb2F0aW5nLU1hcmtpZXJ1bmcgZGVzIFppZWxzLCBLZXlzIG51ciBhdXMgc291cmNlXHJcbi8vIHdlcmRlbiBoaW50ZW4gYW5nZWhcdTAwRTRuZ3QuIFN0ZWh0IGVpbiBcdTAwRkNiZXJub21tZW5lciBLZXkgenVnbGVpY2ggaW1cclxuLy8gVFlQLUZyb250bWF0dGVyIGRlcyBaaWVscywgYmxlaWJlbiBiZWlkZSBzdGVoZW4gLSBkYXJhdXMgd2lyZCBkaWUgZ2FuelxyXG4vLyBub3JtYWxlIFx1MDBEQ2JlcnNjaHJlaWJ1bmcgKHNpZWhlIEtvbW1lbnRhciBhbiB0eXBlU3VidHlwZXMgb2JlbikuXHJcbmZ1bmN0aW9uIG1lcmdlVHlwZVN1YnR5cGVzKHNldHRpbmdzLCBzb3VyY2UsIHRhcmdldCkge1xyXG4gIGNvbnN0IHNvdXJjZVN1YnR5cGVzID0gc2V0dGluZ3MudHlwZVN1YnR5cGVzPy5bc291cmNlXTtcclxuICBpZiAoIXNvdXJjZVN1YnR5cGVzKSByZXR1cm47XHJcbiAgZm9yIChjb25zdCBbbmFtZSwgc291cmNlRGF0YV0gb2YgT2JqZWN0LmVudHJpZXMoc291cmNlU3VidHlwZXMpKSB7XHJcbiAgICBjb25zdCB0YXJnZXREYXRhID0gZ2V0U3VidHlwZShzZXR0aW5ncywgdGFyZ2V0LCBuYW1lKTtcclxuICAgIGlmICghdGFyZ2V0RGF0YSkge1xyXG4gICAgICBlbnN1cmVTdWJ0eXBlKHNldHRpbmdzLCB0YXJnZXQsIG5hbWUpO1xyXG4gICAgICBzZXR0aW5ncy50eXBlU3VidHlwZXNbdGFyZ2V0XVtuYW1lXSA9IHNvdXJjZURhdGE7XHJcbiAgICAgIGNvbnRpbnVlO1xyXG4gICAgfVxyXG4gICAgY29uc3QgdGFyZ2V0TG93ZXIgPSBuZXcgU2V0KE9iamVjdC5rZXlzKHRhcmdldERhdGEuZnJvbnRtYXR0ZXIpLm1hcCgoa2V5KSA9PiBrZXkudG9Mb3dlckNhc2UoKSkpO1xyXG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoc291cmNlRGF0YS5mcm9udG1hdHRlcikpIHtcclxuICAgICAgaWYgKGtleSA9PT0gXCJcIiB8fCB0YXJnZXRMb3dlci5oYXMoa2V5LnRvTG93ZXJDYXNlKCkpKSBjb250aW51ZTtcclxuICAgICAgdGFyZ2V0RGF0YS5mcm9udG1hdHRlcltrZXldID0gdmFsdWU7XHJcbiAgICAgIGlmIChzb3VyY2VEYXRhLmZsb2F0aW5nS2V5cy5pbmNsdWRlcyhrZXkpKSB0YXJnZXREYXRhLmZsb2F0aW5nS2V5cy5wdXNoKGtleSk7XHJcbiAgICAgIC8vIERlciBTaG9ydGN1dCBoXHUwMEU0bmd0IGFtIEtleSB1bmQgd2FuZGVydCBkZXNoYWxiIG1pdCBpaG0gbWl0LlxyXG4gICAgICBjb25zdCBzaG9ydGN1dCA9IHNvdXJjZURhdGEuc2hvcnRjdXRzPy5ba2V5XTtcclxuICAgICAgaWYgKHNob3J0Y3V0KSAodGFyZ2V0RGF0YS5zaG9ydGN1dHMgPz89IHt9KVtrZXldID0gc2hvcnRjdXQ7XHJcbiAgICB9XHJcbiAgfVxyXG4gIGRlbGV0ZSBzZXR0aW5ncy50eXBlU3VidHlwZXNbc291cmNlXTtcclxufVxyXG5cclxuLy8gVW1iZW5lbm5lbiBlaW5lcyBTdWJ0eXBzIGlubmVyaGFsYiBzZWluZXMgVFlQcyAtIGRlciBCbG9jayBiZWhcdTAwRTRsdCBkYWJlaVxyXG4vLyBzZWluZSBQb3NpdGlvbiAoQW56ZWlnZXJlaWhlbmZvbGdlID0gU2NobFx1MDBGQ3NzZWxyZWloZW5mb2xnZSkuXHJcbmZ1bmN0aW9uIHJlbmFtZVN1YnR5cGUoc2V0dGluZ3MsIHR5cGUsIG9sZE5hbWUsIG5ld05hbWUpIHtcclxuICBjb25zdCBieU5hbWUgPSBzZXR0aW5ncy50eXBlU3VidHlwZXM/Llt0eXBlXTtcclxuICBpZiAoIWJ5TmFtZT8uW29sZE5hbWVdIHx8IG9sZE5hbWUgPT09IG5ld05hbWUpIHJldHVybjtcclxuICBzZXR0aW5ncy50eXBlU3VidHlwZXNbdHlwZV0gPSBPYmplY3QuZnJvbUVudHJpZXMoXHJcbiAgICBPYmplY3QuZW50cmllcyhieU5hbWUpLm1hcCgoW25hbWUsIGRhdGFdKSA9PiBbbmFtZSA9PT0gb2xkTmFtZSA/IG5ld05hbWUgOiBuYW1lLCBkYXRhXSlcclxuICApO1xyXG59XHJcblxyXG4vLyBSZWloZW5mb2xnZSBhbGxlciBCbFx1MDBGNmNrZSBlaW5lcyBUWVBzLCBudWxsID0gVFlQLUZyb250bWF0dGVyLiBEYXNcclxuLy8gVFlQLUZyb250bWF0dGVyIHN0ZWh0IGltbWVyIGdhbnogb2JlbiwgZGllIFN1YnR5cGVuIGZvbGdlbiBpbiBpaHJlclxyXG4vLyBTY2hsXHUwMEZDc3NlbHJlaWhlbmZvbGdlLiBCZXN0aW1tdCBkaWUgQW56ZWlnZSBpbiBkZXIgVFlQLURldGFpbGFuc2ljaHQgZWJlbnNvXHJcbi8vIHdpZSBkaWUgRnJvbnRtYXR0ZXItU29ydGllcnVuZyBkZXIgTm90aXplbiAoc2llaGUgb3JkZXJlZERlZmF1bHRLZXlzKS5cclxuZnVuY3Rpb24gZ2V0U2VjdGlvbk9yZGVyKHNldHRpbmdzLCB0eXBlKSB7XHJcbiAgcmV0dXJuIFtudWxsLCAuLi5nZXRTdWJ0eXBlTmFtZXMoc2V0dGluZ3MsIHR5cGUpXTtcclxufVxyXG5cclxuLy8gTmV1ZSBCbG9jay1SZWloZW5mb2xnZSAoRHJhZyAmIERyb3AgaW4gZGVyIFRZUC1EZXRhaWxhbnNpY2h0KTogb3JkZXIgd2llXHJcbi8vIGdldFNlY3Rpb25PcmRlciwgZGFzIGZcdTAwRkNocmVuZGUgbnVsbCBmXHUwMEZDciBkYXMgVFlQLUZyb250bWF0dGVyIHdpcmQgZGFiZWlcclxuLy8gaWdub3JpZXJ0IChlcyBpc3QgbmljaHQgdmVyc2NoaWViYmFyKS4gTmljaHQgZ2VuYW5udGUgU3VidHlwZW4gYmxlaWJlblxyXG4vLyBkYWhpbnRlciBlcmhhbHRlbi5cclxuZnVuY3Rpb24gcmVvcmRlclN1YnR5cGVzKHNldHRpbmdzLCB0eXBlLCBvcmRlcikge1xyXG4gIGNvbnN0IGJ5TmFtZSA9IHNldHRpbmdzLnR5cGVTdWJ0eXBlcz8uW3R5cGVdO1xyXG4gIGlmICghYnlOYW1lKSByZXR1cm47XHJcbiAgY29uc3QgbmFtZXMgPSBvcmRlci5maWx0ZXIoKG5hbWUpID0+IG5hbWUgIT09IG51bGwgJiYgYnlOYW1lW25hbWVdKTtcclxuICBjb25zdCBvcmRlcmVkID0gWy4uLm5hbWVzLCAuLi5PYmplY3Qua2V5cyhieU5hbWUpLmZpbHRlcigobmFtZSkgPT4gIW5hbWVzLmluY2x1ZGVzKG5hbWUpKV07XHJcbiAgc2V0dGluZ3MudHlwZVN1YnR5cGVzW3R5cGVdID0gT2JqZWN0LmZyb21FbnRyaWVzKG9yZGVyZWQubWFwKChuYW1lKSA9PiBbbmFtZSwgYnlOYW1lW25hbWVdXSkpO1xyXG59XHJcblxyXG5mdW5jdGlvbiBkZWxldGVTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBuYW1lKSB7XHJcbiAgY29uc3QgYnlOYW1lID0gc2V0dGluZ3MudHlwZVN1YnR5cGVzPy5bdHlwZV07XHJcbiAgaWYgKCFieU5hbWUpIHJldHVybjtcclxuICBkZWxldGUgYnlOYW1lW25hbWVdO1xyXG4gIGlmIChPYmplY3Qua2V5cyhieU5hbWUpLmxlbmd0aCA9PT0gMCkgZGVsZXRlIHNldHRpbmdzLnR5cGVTdWJ0eXBlc1t0eXBlXTtcclxufVxyXG5cclxuLy8gWnVzYW1tZW5sZWdlbiB6d2VpZXIgU3VidHlwZW4gZGVzc2VsYmVuIFRZUHM6IGRpZSBQcm9wZXJ0aWVzIHZvbiBzb3VyY2VcclxuLy8gd2FuZGVybiBhbnMgRW5kZSBkZXMgWmllbC1CbG9ja3MsIHNvdXJjZSB2ZXJzY2h3aW5kZXQuIEZcdTAwRkNocnQgZGFzIFppZWwgZWluZW5cclxuLy8gS2V5IGJlcmVpdHMsIGJlaFx1MDBFNGx0IGVzIFBvc2l0aW9uLCBXZXJ0IHVuZCBGbG9hdGluZy1NYXJraWVydW5nIC0gbnVyIGVpblxyXG4vLyBsZWVyZXIgWmllbHdlcnQgd2lyZCBhdXMgc291cmNlIGdlZlx1MDBGQ2xsdCAoZGFzc2VsYmUgTXVzdGVyIHdpZSByZW5hbWVJblN0b3JlXHJcbi8vIGluIHByb3BlcnR5LXJlbmFtZS1zeW5jLmpzIGJlaW0gWnVzYW1tZW5sZWdlbiB6d2VpZXIgUHJvcGVydGllcykuIElubmVyaGFsYlxyXG4vLyBlaW5lcyBCbG9ja3MgYmxlaWJ0IGplZGVyIEtleSB6d2FuZ3NsXHUwMEU0dWZpZyBlaW5kZXV0aWcsIGJsb2NrXHUwMEZDYmVyZ3JlaWZlbmRlXHJcbi8vIERvcHBsdW5nZW4gc2luZCBkYXZvbiBuaWNodCBiZXRyb2ZmZW4uXHJcbmZ1bmN0aW9uIG1lcmdlU3VidHlwZXMoc2V0dGluZ3MsIHR5cGUsIHNvdXJjZSwgdGFyZ2V0KSB7XHJcbiAgY29uc3Qgc291cmNlRGF0YSA9IGdldFN1YnR5cGUoc2V0dGluZ3MsIHR5cGUsIHNvdXJjZSk7XHJcbiAgY29uc3QgdGFyZ2V0RGF0YSA9IGdldFN1YnR5cGUoc2V0dGluZ3MsIHR5cGUsIHRhcmdldCk7XHJcbiAgaWYgKCFzb3VyY2VEYXRhIHx8ICF0YXJnZXREYXRhIHx8IHNvdXJjZSA9PT0gdGFyZ2V0KSByZXR1cm47XHJcblxyXG4gIGNvbnN0IHRhcmdldEtleXMgPSBuZXcgTWFwKE9iamVjdC5rZXlzKHRhcmdldERhdGEuZnJvbnRtYXR0ZXIpLm1hcCgoa2V5KSA9PiBba2V5LnRvTG93ZXJDYXNlKCksIGtleV0pKTtcclxuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzb3VyY2VEYXRhLmZyb250bWF0dGVyKSkge1xyXG4gICAgaWYgKGtleSA9PT0gXCJcIikgY29udGludWU7XHJcbiAgICBjb25zdCBleGlzdGluZyA9IHRhcmdldEtleXMuZ2V0KGtleS50b0xvd2VyQ2FzZSgpKTtcclxuICAgIGlmIChleGlzdGluZyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIHRhcmdldERhdGEuZnJvbnRtYXR0ZXJba2V5XSA9IHZhbHVlO1xyXG4gICAgICB0YXJnZXRLZXlzLnNldChrZXkudG9Mb3dlckNhc2UoKSwga2V5KTtcclxuICAgICAgaWYgKHNvdXJjZURhdGEuZmxvYXRpbmdLZXlzLmluY2x1ZGVzKGtleSkgJiYgIXRhcmdldERhdGEuZmxvYXRpbmdLZXlzLmluY2x1ZGVzKGtleSkpIHRhcmdldERhdGEuZmxvYXRpbmdLZXlzLnB1c2goa2V5KTtcclxuICAgICAgLy8gRGVyIFNob3J0Y3V0IGhcdTAwRTRuZ3QgYW0gS2V5IHVuZCB3YW5kZXJ0IGRlc2hhbGIgbWl0IGlobSBtaXQuXHJcbiAgICAgIGNvbnN0IHNob3J0Y3V0ID0gc291cmNlRGF0YS5zaG9ydGN1dHM/LltrZXldO1xyXG4gICAgICBpZiAoc2hvcnRjdXQpICh0YXJnZXREYXRhLnNob3J0Y3V0cyA/Pz0ge30pW2tleV0gPSBzaG9ydGN1dDtcclxuICAgIH0gZWxzZSBpZiAoaXNFbXB0eVZhbHVlKHRhcmdldERhdGEuZnJvbnRtYXR0ZXJbZXhpc3RpbmddKSkge1xyXG4gICAgICB0YXJnZXREYXRhLmZyb250bWF0dGVyW2V4aXN0aW5nXSA9IHZhbHVlO1xyXG4gICAgfVxyXG4gIH1cclxuICBkZWxldGVTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBzb3VyY2UpO1xyXG59XHJcblxyXG4vLyBTY2hyZWlidCBkZW4gU1VCVFlQLVdlcnQgYWxsZXIgTm90aXplbiBtaXQgVFlQLVNjaGxcdTAwRkNzc2VsIHR5cGUgdW5kXHJcbi8vIFNVQlRZUC1TY2hsXHUwMEZDc3NlbCBvbGRLZXkgYXVmIGRlbiBFaW56ZWx3ZXJ0IG5ld1ZhbHVlIHVtIC0gYW5hbG9nIHp1XHJcbi8vIHJlbmFtZVR5cGVJbk5vdGVzKCkgaW4gdHlwLXZpZXcuanMuXHJcbmFzeW5jIGZ1bmN0aW9uIHJlbmFtZVN1YnR5cGVJbk5vdGVzKHBsdWdpbiwgdHlwZSwgb2xkS2V5LCBuZXdWYWx1ZSkge1xyXG4gIGxldCBjaGFuZ2VkID0gMDtcclxuICBmb3IgKGNvbnN0IGZpbGUgb2YgcGx1Z2luLnR5cEluZGV4LmZpbGVzV2l0aFN1YnR5cGUodHlwZSwgb2xkS2V5KSkge1xyXG4gICAgbGV0IG1hdGNoZWQgPSBmYWxzZTtcclxuICAgIGF3YWl0IHBsdWdpbi5hcHAuZmlsZU1hbmFnZXIucHJvY2Vzc0Zyb250TWF0dGVyKGZpbGUsIChmcm9udG1hdHRlcikgPT4ge1xyXG4gICAgICBpZiAodHlwZUtleU9mKHByb3BlcnR5VmFsdWUoZnJvbnRtYXR0ZXIsIFNVQlRZUF9QUk9QRVJUWSkpICE9PSBvbGRLZXkpIHJldHVybjtcclxuICAgICAgc2V0Q2Fub25pY2FsUHJvcGVydHkoZnJvbnRtYXR0ZXIsIFNVQlRZUF9QUk9QRVJUWSwgbmV3VmFsdWUpO1xyXG4gICAgICBtYXRjaGVkID0gdHJ1ZTtcclxuICAgIH0pO1xyXG4gICAgaWYgKG1hdGNoZWQpIGNoYW5nZWQrKztcclxuICB9XHJcbiAgcmV0dXJuIGNoYW5nZWQ7XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0ge1xyXG4gIG5vcm1hbGl6ZVN1YnR5cGVOYW1lLFxyXG4gIGlzRW1wdHlWYWx1ZSxcclxuICBnZXRTdWJ0eXBlTmFtZXMsXHJcbiAgZ2V0U3VidHlwZSxcclxuICBlbnN1cmVTdWJ0eXBlLFxyXG4gIG1pZ3JhdGVBYm92ZVN0YW5kYXJkLFxyXG4gIG1pZ3JhdGVTdWJ0eXBlQ29sb3JTY2FsZSxcclxuICBtb3ZlVHlwZVN1YnR5cGVzLFxyXG4gIGRlbGV0ZVR5cGVTdWJ0eXBlcyxcclxuICBtZXJnZVR5cGVTdWJ0eXBlcyxcclxuICByZW5hbWVTdWJ0eXBlLFxyXG4gIGdldFNlY3Rpb25PcmRlcixcclxuICByZW9yZGVyU3VidHlwZXMsXHJcbiAgZGVsZXRlU3VidHlwZSxcclxuICBtZXJnZVN1YnR5cGVzLFxyXG4gIHJlbmFtZVN1YnR5cGVJbk5vdGVzLFxyXG59O1xyXG4iLCAiY29uc3QgeyBnZXRTdWJ0eXBlIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBlc1wiKTtcclxuY29uc3QgeyB0eXBlS2V5T2YsIHByb3BlcnR5VmFsdWUgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcclxuXHJcbmNvbnN0IFRZUF9QUk9QRVJUWSA9IFwiVFlQXCI7XHJcbmNvbnN0IFNVQlRZUF9QUk9QRVJUWSA9IFwiU1VCVFlQXCI7XHJcblxyXG4vLyBXaXJkIGF1Y2ggdm9uIHNldHRpbmdzLmpzIChEZWZhdWx0IGZcdTAwRkNyIGdsb2JhbFByb3BlcnR5T3JkZXIpIHNvd2llIHZvbVxyXG4vLyBPcmRlci1FZGl0b3IgYmVudXR6dCAtIGFsbGUgdmllciBQbGF0emhhbHRlci1CbFx1MDBGNmNrZSBzaW5kIGRvcnQgcGVyIFVJIG5pY2h0XHJcbi8vIGVudGZlcm5iYXIsIG51ciB2ZXJzY2hpZWJiYXIgKHNpZWhlIGZyb250bWF0dGVyLW9yZGVyLWVkaXRvci5qcykuXHJcbi8vIFwidHlwVmFsdWVcIiBpc3QgZGllIFRZUC1Qcm9wZXJ0eSBzZWxic3QsIFwic3VidHlwVmFsdWVcIiBhbmFsb2cgZGllIFNVQlRZUC1cclxuLy8gUHJvcGVydHksIFwidHlwXCIgZGllIFRZUC1Gcm9udG1hdHRlci1MaXN0ZSBkZXMgVFlQcyAoc2llaGVcclxuLy8gdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpLCBcIm90aGVyXCIgYWxsZXMgXHUwMERDYnJpZ2UuXHJcbmNvbnN0IERFRkFVTFRfR0xPQkFMX09SREVSID0gW3sga2luZDogXCJ0eXBWYWx1ZVwiIH0sIHsga2luZDogXCJzdWJ0eXBWYWx1ZVwiIH0sIHsga2luZDogXCJ0eXBcIiB9LCB7IGtpbmQ6IFwib3RoZXJcIiB9XTtcclxuXHJcbi8vIFN0ZWxsdCBzaWNoZXIsIGRhc3MgZ2VuYXUgamUgZWluIEVpbnRyYWcgcHJvIFBsYXR6aGFsdGVyLUFydCB2b3JoYW5kZW4gaXN0IC1cclxuLy8gblx1MDBGNnRpZyBmXHUwMEZDciBCZXN0YW5kc2luc3RhbGxhdGlvbmVuLCBkZXJlbiBnZXNwZWljaGVydGUgZ2xvYmFsUHJvcGVydHlPcmRlclxyXG4vLyBub2NoIGF1cyBkZXIgWmVpdCB2b3IgXCJUWVAgYWxzIExpc3RlbmVpbnRyYWdcIiBiencuIHZvciBTVUJUWVAgc3RhbW10IChUWVBcclxuLy8gd2FyIGRhdm9yIGhhcnQtY29kaWVydCBpbW1lciBhbiBlcnN0ZXIgU3RlbGxlLCBrYW0gaW4gZGVyIExpc3RlIHNlbGJzdFxyXG4vLyBuaWNodCB2b3IpLiBGZWhsZW5kZSBFaW50clx1MDBFNGdlIHdlcmRlbiBhbiBzaW5udm9sbGVyIERlZmF1bHQtUG9zaXRpb24gZXJnXHUwMEU0bnp0LFxyXG4vLyBzdGF0dCBkaWUgYmVzdGVoZW5kZSwgdm9tIE51dHplciBwZXIgRHJhZyAmIERyb3AgZWluc29ydGllcnRlIFJlaWhlbmZvbGdlXHJcbi8vIGFuenV0YXN0ZW4uIFwic3VidHlwVmFsdWVcIiBsYW5kZXQgZGFiZWkgZGlyZWt0IGhpbnRlciBcInR5cFZhbHVlXCIgKGdhcmFudGllcnRcclxuLy8genUgZGllc2VtIFplaXRwdW5rdCBzY2hvbiB2b3JoYW5kZW4pLCBzdGF0dCB3aWUgZGllIFx1MDBGQ2JyaWdlbiBQbGF0emhhbHRlclxyXG4vLyBwYXVzY2hhbCBhbiBkZW4gUmFuZC5cclxuZnVuY3Rpb24gbm9ybWFsaXplR2xvYmFsT3JkZXIob3JkZXIpIHtcclxuICBjb25zdCByZXN1bHQgPSBBcnJheS5pc0FycmF5KG9yZGVyKSA/IG9yZGVyLmZpbHRlcigoZW50cnkpID0+IGVudHJ5ICYmIHR5cGVvZiBlbnRyeSA9PT0gXCJvYmplY3RcIikgOiBbXTtcclxuICBjb25zdCBoYXNLaW5kID0gKGtpbmQpID0+IHJlc3VsdC5zb21lKChlbnRyeSkgPT4gZW50cnkua2luZCA9PT0ga2luZCk7XHJcbiAgaWYgKCFoYXNLaW5kKFwidHlwVmFsdWVcIikpIHJlc3VsdC51bnNoaWZ0KHsga2luZDogXCJ0eXBWYWx1ZVwiIH0pO1xyXG4gIGlmICghaGFzS2luZChcInN1YnR5cFZhbHVlXCIpKSB7XHJcbiAgICBjb25zdCB0eXBWYWx1ZUluZGV4ID0gcmVzdWx0LmZpbmRJbmRleCgoZW50cnkpID0+IGVudHJ5LmtpbmQgPT09IFwidHlwVmFsdWVcIik7XHJcbiAgICByZXN1bHQuc3BsaWNlKHR5cFZhbHVlSW5kZXggKyAxLCAwLCB7IGtpbmQ6IFwic3VidHlwVmFsdWVcIiB9KTtcclxuICB9XHJcbiAgaWYgKCFoYXNLaW5kKFwidHlwXCIpKSByZXN1bHQucHVzaCh7IGtpbmQ6IFwidHlwXCIgfSk7XHJcbiAgaWYgKCFoYXNLaW5kKFwib3RoZXJcIikpIHJlc3VsdC5wdXNoKHsga2luZDogXCJvdGhlclwiIH0pO1xyXG4gIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4gKiBGcm9udG1hdHRlci1Tb3J0aWVydW5nXHJcbiAqIEJyaW5ndCBkaWUgaW4gZWluZXIgTm90aXogVk9SSEFOREVORU4gUHJvcGVydGllcyBpbiBlaW5lIGZlc3RlXHJcbiAqIFJlaWhlbmZvbGdlIC0genVzYW1tZW5nZXNldHp0IGF1cyAoc2llaGUgZ2xvYmFsUHJvcGVydHlPcmRlcik6XHJcbiAqICAtIGdsb2JhbCBmZXN0IHBvc2l0aW9uaWVydGVuIEVpbnplbC1Qcm9wZXJ0aWVzICh6LiBCLiBjc3NjbGFzc2VzLFxyXG4gKiAgICBhbGlhc2VzOyBFaW5zdGVsbHVuZ2VuIC0+IFRZUCAtPiBHbG9iYWxlIFByb3BlcnR5LVJlaWhlbmZvbGdlKSxcclxuICogIC0gZGVyIFRZUC1Qcm9wZXJ0eSBzZWxic3QsXHJcbiAqICAtIGRlciBTVUJUWVAtUHJvcGVydHkgc2VsYnN0LFxyXG4gKiAgLSBkZW0gQmxvY2sgXCJUWVAtRnJvbnRtYXR0ZXJcIiAoVFlQLUZyb250bWF0dGVyLUxpc3RlIGRlc1xyXG4gKiAgICBqZXdlaWxpZ2VuIFR5cHMsIHNpZWhlIHR5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzLCBnZWZvbGd0IHZvbVxyXG4gKiAgICBGcm9udG1hdHRlci1CbG9jayBzZWluZXMgU1VCVFlQcyksIHVuZFxyXG4gKiAgLSBkZW0gQmxvY2sgXCJTb25zdGlnZSBQcm9wZXJ0aWVzXCIgKGFsbGVzIFx1MDBEQ2JyaWdlLCBpbiBiaXNoZXJpZ2VyXHJcbiAqICAgIFJlaWhlbmZvbGdlKS5cclxuICogRXJnXHUwMEU0bnp0IGRhYmVpIGtlaW5lIGZlaGxlbmRlbiBTdGFuZGFyZC1Qcm9wZXJ0aWVzIHVuZCBcdTAwRTRuZGVydCBrZWluZVxyXG4gKiBXZXJ0ZSAtIHJlaW5lIFVtc29ydGllcnVuZyBkZXIgYmVyZWl0cyB2b3JoYW5kZW5lbiBaZWlsZW4uXHJcbiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqL1xyXG5cclxuLy8gU3RhbmRhcmQtUHJvcGVydHktUmVpaGVuZm9sZ2UgZWluZXMgVHlwcywgaW5rbC4gZGVyIGRhcmluIGFscyBcIkZsb2F0aW5nXHJcbi8vIFByb3BlcnR5XCIgbWFya2llcnRlbiBLZXlzIChzaWVoZSB0eXBlRmxvYXRpbmdLZXlzIGluIHNldHRpbmdzLmpzKSBhbiBnZW5hdVxyXG4vLyBkZXIgU3RlbGxlLCBhbiBkZXIgc2llIGluIGRlciBMaXN0ZSBzdGVoZW4gLSBvaG5lIFRZUCBzZWxic3QgKGRhcyBpc3QgZG9ydFxyXG4vLyBudXIgYXVzIGhpc3RvcmlzY2hlbiBHclx1MDBGQ25kZW4gZXZ0bC4gbm9jaCBlbnRoYWx0ZW4sIHNpZWhlIHN0cmlwVHlwUHJvcGVydHkpXHJcbi8vIHVuZCBvaG5lIGRpZSBsZWVyZSBQbGF0emhhbHRlci1aZWlsZSBkZXMgRWRpdG9ycyAoXCJQcm9wZXJ0eSBoaW56dWZcdTAwRkNnZW5cIikuXHJcbi8vIEZsb2F0aW5nIFByb3BlcnRpZXMgd2VyZGVuIG51ciBuaWNodCBhdXRvbWF0aXNjaCB2b24gZ2V0VHlwZURlZmF1bHRzKClcclxuLy8gKG1haW4uanMpIGFuIFRlbXBsYXRlciBhdXNnZWxpZWZlcnQsIHNvbGxlbiBhYmVyIHRyb3R6ZGVtIGFuIGlocmVyXHJcbi8vIExpc3RlbnBvc2l0aW9uIGxhbmRlbiwgc29iYWxkIGVpbmUgTm90aXogc2llIGRvY2ggdHJcdTAwRTRndC4gbnVsbCwgd2VubiBrZWluXHJcbi8vIFR5cCBcdTAwRkNiZXJnZWJlbiB3dXJkZSBvZGVyIGZcdTAwRkNyIGRlbiBUeXAga2VpbmUgU3RhbmRhcmRsaXN0ZSBnZXBmbGVndCBpc3QuXHJcbi8vXHJcbi8vIE1pdCBzdWJ0eXBlIHp1c1x1MDBFNHR6bGljaCBkaWUgS2V5cyBhdXMgZGVzc2VuIEZyb250bWF0dGVyLUJsb2NrIChzaWVoZVxyXG4vLyBzdWJ0eXBlcy5qcykgLSBkYWhpbnRlciwgZGEgZGFzIFRZUC1Gcm9udG1hdHRlciBpbW1lciBvYmVuIHN0ZWh0LiBFaW4gS2V5LFxyXG4vLyBkZXIgaW4gQkVJREVOIEJsXHUwMEY2Y2tlbiB2b3Jrb21tdCwgYmVoXHUwMEU0bHQgZGllIFBvc2l0aW9uIGRlcyBUWVAtRnJvbnRtYXR0ZXJzXHJcbi8vIChkZXIgU3VidHlwIHN0ZXVlcnQgZG9ydCBudXIgV2VydCB1bmQgRmxvYXRpbmctTWFya2llcnVuZyBiZWksIHNpZWhlXHJcbi8vIGdldFR5cGVEZWZhdWx0cyBpbiBtYWluLmpzKSAtIGRlc2hhbGIgaGllciBiZXd1c3N0IFwiZXJzdGUgUG9zaXRpb24gelx1MDBFNGhsdFwiLlxyXG5mdW5jdGlvbiBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCB0eXBlLCBzdWJ0eXBlID0gbnVsbCkge1xyXG4gIGlmICghdHlwZSkgcmV0dXJuIG51bGw7XHJcbiAgY29uc3QgaXNTeXN0ZW1LZXkgPSAoa2V5KSA9PiBrZXkgPT09IFwiXCIgfHwgW1RZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZXS5zb21lKChwKSA9PiBrZXkudG9Mb3dlckNhc2UoKSA9PT0gcC50b0xvd2VyQ2FzZSgpKTtcclxuICBjb25zdCBzdWJ0eXBlRGF0YSA9IHN1YnR5cGUgPyBnZXRTdWJ0eXBlKHBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSkgOiBudWxsO1xyXG4gIGNvbnN0IGJsb2NrcyA9IFtwbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXSwgc3VidHlwZURhdGE/LmZyb250bWF0dGVyXTtcclxuICBjb25zdCBrZXlzID0gW107XHJcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQoKTtcclxuICBmb3IgKGNvbnN0IGJsb2NrIG9mIGJsb2Nrcykge1xyXG4gICAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoYmxvY2sgPz8ge30pKSB7XHJcbiAgICAgIGlmIChpc1N5c3RlbUtleShrZXkpIHx8IHNlZW4uaGFzKGtleS50b0xvd2VyQ2FzZSgpKSkgY29udGludWU7XHJcbiAgICAgIGtleXMucHVzaChrZXkpO1xyXG4gICAgICBzZWVuLmFkZChrZXkudG9Mb3dlckNhc2UoKSk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIHJldHVybiBrZXlzLmxlbmd0aCA+IDAgPyBrZXlzIDogbnVsbDtcclxufVxyXG5cclxuLy8gUmVpaGVuZm9sZ2UsIGluIGRlciBkaWUgdm9yaGFuZGVuZW4gUHJvcGVydGllcyBlaW5lciBOb3RpeiBzdGVoZW4gc29sbGVuIC1cclxuLy8gYmVzdGltbXQga29tcGxldHQgZHVyY2ggZ2xvYmFsT3JkZXI6IGVpbnplbG5lIFByb3BlcnRpZXMgYW4gZmVzdGVyXHJcbi8vIFBvc2l0aW9uLCBzb3dpZSBkaWUgUGxhdHpoYWx0ZXIgXCJ0eXBWYWx1ZVwiIChkaWUgVFlQLVByb3BlcnR5IHNlbGJzdCksXHJcbi8vIFwic3VidHlwVmFsdWVcIiAoZGllIFNVQlRZUC1Qcm9wZXJ0eSBzZWxic3QpLCBcInR5cFwiIChTdGFuZGFyZGxpc3RlIGRlcyBUeXBzKVxyXG4vLyB1bmQgXCJvdGhlclwiIChhbGxlcyBcdTAwRENicmlnZSkuXHJcbi8vXHJcbi8vIFdlbGNoZXIgQmxvY2sgZWluZSBQcm9wZXJ0eSBiZWFuc3BydWNodCwgd2lyZCBWT1IgZGVtIGVpZ2VudGxpY2hlbiBBdWZiYXVcclxuLy8gZGVyIFJlaWhlbmZvbGdlIGZlc3RzdGVoZW5kIGJlc3RpbW10IChwaW5uZWQvdHlwQmxvY2svUmVzdCBzaW5kIGRpc2p1bmt0KSAtXHJcbi8vIG5pY2h0IGVyc3QgYmVpbSBsaW5lYXJlbiBEdXJjaGxhdWYgdm9uIGdsb2JhbE9yZGVyLiBEYXMgbWFjaHQgZGllXHJcbi8vIEJsb2NrLVp1b3JkbnVuZyB1bmFiaFx1MDBFNG5naWcgZGF2b24sIGluIHdlbGNoZXIgUmVpaGVuZm9sZ2UgZGllIEJsXHUwMEY2Y2tlIGluXHJcbi8vIGdsb2JhbE9yZGVyIHN0ZWhlbjogZWluZSBnbG9iYWwgZmVzdCBwb3NpdGlvbmllcnRlIFByb3BlcnR5IGdlaFx1MDBGNnJ0IGltbWVyIHp1XHJcbi8vIGlocmVtIGVpZ2VuZW4gRWludHJhZyAobmllIHp1c1x1MDBFNHR6bGljaCB6dW0gVHlwLUJsb2NrLCBzZWxic3Qgd2VubiBcIlRZUFxyXG4vLyBQcm9wZXJ0aWVzXCIgdm9yaGVyIGluIGRlciBMaXN0ZSBzdGVodCksIHVuZCBcIlNvbnN0aWdlIFByb3BlcnRpZXNcIiBlbnRoXHUwMEU0bHRcclxuLy8gaW1tZXIgbnVyIGVjaHRlIFJlc3RiZXN0XHUwMEU0bmRlIChuaWUgdmVyc2VoZW50bGljaCBQcm9wZXJ0aWVzLCBkaWUgZWlnZW50bGljaFxyXG4vLyBlaW5lbSBzcFx1MDBFNHRlciBpbiBkZXIgTGlzdGUgc3RlaGVuZGVuIEJsb2NrIGdlaFx1MDBGNnJlbikuXHJcbmZ1bmN0aW9uIGNvbXB1dGVTb3J0ZWRLZXlzKGV4aXN0aW5nS2V5cywgZ2xvYmFsT3JkZXIsIHR5cGVEZWZhdWx0S2V5cykge1xyXG4gIGNvbnN0IGxvd2VyVG9BY3R1YWwgPSBuZXcgTWFwKGV4aXN0aW5nS2V5cy5tYXAoKGtleSkgPT4gW2tleS50b0xvd2VyQ2FzZSgpLCBrZXldKSk7XHJcbiAgY29uc3QgcmVzb2x2ZSA9IChuYW1lKSA9PiBsb3dlclRvQWN0dWFsLmdldChuYW1lLnRvTG93ZXJDYXNlKCkpO1xyXG5cclxuICBjb25zdCBwaW5uZWQgPSBuZXcgU2V0KFxyXG4gICAgZ2xvYmFsT3JkZXJcclxuICAgICAgLmZpbHRlcigoZW50cnkpID0+IGVudHJ5LmtpbmQgPT09IFwicHJvcGVydHlcIilcclxuICAgICAgLm1hcCgoZW50cnkpID0+IHJlc29sdmUoZW50cnkubmFtZSkpXHJcbiAgICAgIC5maWx0ZXIoQm9vbGVhbilcclxuICApO1xyXG4gIGNvbnN0IHR5cEtleSA9IHJlc29sdmUoVFlQX1BST1BFUlRZKTtcclxuICBjb25zdCBzdWJ0eXBLZXkgPSByZXNvbHZlKFNVQlRZUF9QUk9QRVJUWSk7XHJcbiAgY29uc3QgdHlwQmxvY2tLZXlzID0gbmV3IFNldChcclxuICAgICh0eXBlRGVmYXVsdEtleXMgPz8gW10pLm1hcChyZXNvbHZlKS5maWx0ZXIoKGtleSkgPT4ga2V5ICYmIGtleSAhPT0gdHlwS2V5ICYmICFwaW5uZWQuaGFzKGtleSkpXHJcbiAgKTtcclxuICBjb25zdCBjbGFpbWVkID0gbmV3IFNldChwaW5uZWQpO1xyXG4gIGZvciAoY29uc3Qga2V5IG9mIHR5cEJsb2NrS2V5cykgY2xhaW1lZC5hZGQoa2V5KTtcclxuICBpZiAodHlwS2V5KSBjbGFpbWVkLmFkZCh0eXBLZXkpO1xyXG4gIGlmIChzdWJ0eXBLZXkpIGNsYWltZWQuYWRkKHN1YnR5cEtleSk7XHJcblxyXG4gIGNvbnN0IHNvcnRlZEtleXMgPSBbXTtcclxuICBjb25zdCBzZWVuID0gbmV3IFNldCgpO1xyXG4gIGNvbnN0IHB1c2ggPSAoa2V5KSA9PiB7XHJcbiAgICBpZiAoa2V5ICYmICFzZWVuLmhhcyhrZXkpKSB7XHJcbiAgICAgIHNvcnRlZEtleXMucHVzaChrZXkpO1xyXG4gICAgICBzZWVuLmFkZChrZXkpO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIGZvciAoY29uc3QgZW50cnkgb2YgZ2xvYmFsT3JkZXIpIHtcclxuICAgIGlmIChlbnRyeS5raW5kID09PSBcInByb3BlcnR5XCIpIHB1c2gocmVzb2x2ZShlbnRyeS5uYW1lKSk7XHJcbiAgICBlbHNlIGlmIChlbnRyeS5raW5kID09PSBcInR5cFZhbHVlXCIpIHB1c2godHlwS2V5KTtcclxuICAgIGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwic3VidHlwVmFsdWVcIikgcHVzaChzdWJ0eXBLZXkpO1xyXG4gICAgZWxzZSBpZiAoZW50cnkua2luZCA9PT0gXCJ0eXBcIikge1xyXG4gICAgICBmb3IgKGNvbnN0IG5hbWUgb2YgdHlwZURlZmF1bHRLZXlzID8/IFtdKSB7XHJcbiAgICAgICAgY29uc3Qga2V5ID0gcmVzb2x2ZShuYW1lKTtcclxuICAgICAgICBpZiAoa2V5ICYmIHR5cEJsb2NrS2V5cy5oYXMoa2V5KSkgcHVzaChrZXkpO1xyXG4gICAgICB9XHJcbiAgICB9IGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwib3RoZXJcIikge1xyXG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBleGlzdGluZ0tleXMpIHtcclxuICAgICAgICBpZiAoIWNsYWltZWQuaGFzKGtleSkpIHB1c2goa2V5KTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLy8gU2ljaGVyaGVpdHNuZXR6LCBmYWxscyBnbG9iYWxPcmRlciB1bnZvbGxzdFx1MDBFNG5kaWcgaXN0ICh6LiBCLiBrb3JydXB0ZVxyXG4gIC8vIEVpbnN0ZWxsdW5nZW4pIC0gZGllIFVJIHZlcmhpbmRlcnQgZGFzIGVpZ2VudGxpY2ggKHNpZWhlIG5vcm1hbGl6ZUdsb2JhbE9yZGVyKS5cclxuICBmb3IgKGNvbnN0IGtleSBvZiBleGlzdGluZ0tleXMpIHB1c2goa2V5KTtcclxuICByZXR1cm4gc29ydGVkS2V5cztcclxufVxyXG5cclxuLy8gXCJwb3NpdGlvblwiIGlzdCBrZWluIGVjaHRlcyBQcm9wZXJ0eSwgc29uZGVybiBPYnNpZGlhbnMgZWlnZW5lIEFuZ2FiZSB6dXJcclxuLy8gTGFnZSBkZXMgRnJvbnRtYXR0ZXItQmxvY2tzIGlubmVyaGFsYiBkZXIgRGF0ZWkgKG51ciBpbSBDYWNoZS1PYmpla3RcclxuLy8gdm9yaGFuZGVuLCBuaWNodCBpbSB2b24gcHJvY2Vzc0Zyb250TWF0dGVyIGdlbGllZmVydGVuIE9iamVrdCkuXHJcbmZ1bmN0aW9uIGNhY2hlZEZyb250bWF0dGVyS2V5cyhhcHAsIGZpbGUpIHtcclxuICBjb25zdCBmcm9udG1hdHRlciA9IGFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXI7XHJcbiAgaWYgKCFmcm9udG1hdHRlcikgcmV0dXJuIG51bGw7XHJcbiAgcmV0dXJuIE9iamVjdC5rZXlzKGZyb250bWF0dGVyKS5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBcInBvc2l0aW9uXCIpO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBzb3J0RmlsZUZyb250bWF0dGVyKGFwcCwgZmlsZSwgZ2xvYmFsT3JkZXIsIHR5cGVEZWZhdWx0S2V5cykge1xyXG4gIC8vIEdcdTAwRkNuc3RpZ2VyIFZvcmFiLUNoZWNrIFx1MDBGQ2JlciBkZW4gYmVyZWl0cyBpbSBTcGVpY2hlciB2b3JoYW5kZW5lbiBNZXRhZGF0YS1cclxuICAvLyBDYWNoZSAoa2VpbiBEYXRlaS1adWdyaWZmKTogZGVyIE5vcm1hbGZhbGwgLSBlaW5lIE5vdGl6IGlzdCBzY2hvbiBrb3JyZWt0XHJcbiAgLy8gc29ydGllcnQgLSBsXHUwMEU0c3N0IHNpY2ggc28gZXJrZW5uZW4sIG9obmUgZGllIERhdGVpIFx1MDBGQ2JlciBwcm9jZXNzRnJvbnRNYXR0ZXJcclxuICAvLyBcdTAwRkNiZXJoYXVwdCB6dSBcdTAwRjZmZm5lbi4gRGFzIGlzdCBiZWkgd2llZGVyaG9sdGVuIExcdTAwRTR1ZmVuIFx1MDBGQ2JlciBkZW4gZ2FuemVuXHJcbiAgLy8gVmF1bHQgZGVyIExcdTAwRjZ3ZW5hbnRlaWwgZGVyIE5vdGl6ZW4gdW5kIGRhbWl0IGRlciBlaWdlbnRsaWNoZSBHZXNjaHdpbmRpZy1cclxuICAvLyBrZWl0c2dld2lubi4gcHJvY2Vzc0Zyb250TWF0dGVyIGJsZWlidCB0cm90emRlbSBkaWUgYWxsZWluaWdlIFF1ZWxsZSBkZXJcclxuICAvLyBXYWhyaGVpdCBmXHUwMEZDciBkZW4gdGF0c1x1MDBFNGNobGljaGVuIFNjaHJlaWJ2b3JnYW5nIChDYWNoZSBrYW5uIGt1cnp6ZWl0aWdcclxuICAvLyB2ZXJhbHRldCBzZWluKSAtIGRlciBWb3JhYi1DaGVjayBcdTAwRkNiZXJzcHJpbmd0IG51ciBzaWNoZXIgdW52ZXJcdTAwRTRuZGVydGUgRlx1MDBFNGxsZS5cclxuICBjb25zdCBjYWNoZWRLZXlzID0gY2FjaGVkRnJvbnRtYXR0ZXJLZXlzKGFwcCwgZmlsZSk7XHJcbiAgaWYgKCFjYWNoZWRLZXlzIHx8IGNhY2hlZEtleXMubGVuZ3RoIDw9IDEpIHJldHVybiBmYWxzZTtcclxuICBjb25zdCBjYWNoZWRTb3J0ZWQgPSBjb21wdXRlU29ydGVkS2V5cyhjYWNoZWRLZXlzLCBnbG9iYWxPcmRlciwgdHlwZURlZmF1bHRLZXlzKTtcclxuICBpZiAoY2FjaGVkU29ydGVkLmV2ZXJ5KChrZXksIGkpID0+IGtleSA9PT0gY2FjaGVkS2V5c1tpXSkpIHJldHVybiBmYWxzZTtcclxuXHJcbiAgbGV0IGNoYW5nZWQgPSBmYWxzZTtcclxuICBhd2FpdCBhcHAuZmlsZU1hbmFnZXIucHJvY2Vzc0Zyb250TWF0dGVyKGZpbGUsIChmcm9udG1hdHRlcikgPT4ge1xyXG4gICAgY2hhbmdlZCA9IHNvcnRGcm9udG1hdHRlck9iamVjdChmcm9udG1hdHRlciwgZ2xvYmFsT3JkZXIsIHR5cGVEZWZhdWx0S2V5cyk7XHJcbiAgfSk7XHJcbiAgcmV0dXJuIGNoYW5nZWQ7XHJcbn1cclxuXHJcbi8vIFNvcnRpZXJ0IGRhcyB2b24gcHJvY2Vzc0Zyb250TWF0dGVyIGdlbGllZmVydGUgT2JqZWt0IGluLXBsYWNlIChzaWVoZVxyXG4vLyBLb21tZW50YXIgaW4gdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMgenUgc2F2ZUZyb250bWF0dGVyL3N0cmlwVHlwUHJvcGVydHkpOlxyXG4vLyBPYmpla3QtSW5zZXJ0aW9uLU9yZGVyIGJlc3RpbW10IGRpZSBzcFx1MDBFNHRlcmUgWUFNTC1SZWloZW5mb2xnZSwgZGFoZXIgYWxsZVxyXG4vLyBLZXlzIGxcdTAwRjZzY2hlbiB1bmQgaW4gbmV1ZXIgUmVpaGVuZm9sZ2Ugd2llZGVyIGVpbmZcdTAwRkNnZW4sIHN0YXR0IGVpbiBuZXVlc1xyXG4vLyBPYmpla3QgenVyXHUwMEZDY2t6dWdlYmVuLiBMaWVmZXJ0IHRydWUgYmVpIGVpbmVyIFx1MDBDNG5kZXJ1bmcuXHJcbmZ1bmN0aW9uIHNvcnRGcm9udG1hdHRlck9iamVjdChmcm9udG1hdHRlciwgZ2xvYmFsT3JkZXIsIHR5cGVEZWZhdWx0S2V5cykge1xyXG4gIGNvbnN0IGV4aXN0aW5nS2V5cyA9IE9iamVjdC5rZXlzKGZyb250bWF0dGVyKTtcclxuICBpZiAoZXhpc3RpbmdLZXlzLmxlbmd0aCA8PSAxKSByZXR1cm4gZmFsc2U7XHJcblxyXG4gIGNvbnN0IHNvcnRlZEtleXMgPSBjb21wdXRlU29ydGVkS2V5cyhleGlzdGluZ0tleXMsIGdsb2JhbE9yZGVyLCB0eXBlRGVmYXVsdEtleXMpO1xyXG4gIGlmIChzb3J0ZWRLZXlzLmV2ZXJ5KChrZXksIGkpID0+IGtleSA9PT0gZXhpc3RpbmdLZXlzW2ldKSkgcmV0dXJuIGZhbHNlO1xyXG5cclxuICBjb25zdCBzbmFwc2hvdCA9IHsgLi4uZnJvbnRtYXR0ZXIgfTtcclxuICBmb3IgKGNvbnN0IGtleSBvZiBleGlzdGluZ0tleXMpIGRlbGV0ZSBmcm9udG1hdHRlcltrZXldO1xyXG4gIGZvciAoY29uc3Qga2V5IG9mIHNvcnRlZEtleXMpIGZyb250bWF0dGVyW2tleV0gPSBzbmFwc2hvdFtrZXldO1xyXG4gIHJldHVybiB0cnVlO1xyXG59XHJcblxyXG4vLyBGXHUwMEZDciBBdWZydWZlciwgZGllIG9obmVoaW4gZ2VyYWRlIGluIHByb2Nlc3NGcm9udE1hdHRlciBzY2hyZWliZW4gKHouIEIuXHJcbi8vIGFwcGx5VHlwZVByb3BlcnRpZXMvX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qcyk6IHNvcnRpZXJ0IGRhc1xyXG4vLyBPYmpla3QgZGlyZWt0IG1pdCBhdXNkclx1MDBGQ2NrbGljaCBcdTAwRkNiZXJnZWJlbmVtIFRZUC9TdWJ0eXAgLSBkZXIgSW5kZXggYnp3LlxyXG4vLyBNZXRhZGF0YS1DYWNoZSBrZW5udCBkaWUgZ2VyYWRlIGdlc2NocmllYmVuZW4gV2VydGUgenUgZGllc2VtIFplaXRwdW5rdFxyXG4vLyBub2NoIG5pY2h0LlxyXG5mdW5jdGlvbiBzb3J0RnJvbnRtYXR0ZXJGb3IocGx1Z2luLCBmcm9udG1hdHRlciwgdHlwZSwgc3VidHlwZSkge1xyXG4gIGNvbnN0IGdsb2JhbE9yZGVyID0gbm9ybWFsaXplR2xvYmFsT3JkZXIocGx1Z2luLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIpO1xyXG4gIHJldHVybiBzb3J0RnJvbnRtYXR0ZXJPYmplY3QoZnJvbnRtYXR0ZXIsIGdsb2JhbE9yZGVyLCBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCB0eXBlLCBzdWJ0eXBlKSk7XHJcbn1cclxuXHJcbi8vIFNldHp0IG51ciBkaWUgZWluZSBQcm9wZXJ0eSBrZXkgYW4gaWhyZW4gUGxhdHogbGF1dCBGcm9udG1hdHRlci1Tb3J0aWVydW5nLFxyXG4vLyBhbGxlIFx1MDBGQ2JyaWdlbiBibGVpYmVuIGluIGlocmVyIGJpc2hlcmlnZW4gUmVpaGVuZm9sZ2UgLSBmXHUwMEZDciBBdWZydWZlciwgZGllXHJcbi8vIGdlcmFkZSBlaW5lIFByb3BlcnR5IG5ldSBhbmdlbGVndCBoYWJlbiAoei4gQi4gRnJlZHMgUHJvcGVydHktQmFja2xpbmtpbmcpLFxyXG4vLyBkaWUgc29uc3QgYW0gRW5kZSBsYW5kZW4gd1x1MDBGQ3JkZSwgb2huZSBkYWZcdTAwRkNyIGdsZWljaCBkYXMgZ2FuemUsIGV2dGwuIGJld3Vzc3RcclxuLy8gYW5kZXJzIHNvcnRpZXJ0ZSBGcm9udG1hdHRlciB1bXp1c3RlbGxlbi4gVFlQL1NVQlRZUCB3ZXJkZW4gYXVzIGRlbVxyXG4vLyBcdTAwRkNiZXJnZWJlbmVuIE9iamVrdCBnZWxlc2VuLCBuaWNodCBhdXMgSW5kZXgvQ2FjaGUgKGRpZSBrZW5uZW4gaW5uZXJoYWxiIHZvblxyXG4vLyBwcm9jZXNzRnJvbnRNYXR0ZXIgZXZ0bC4gbm9jaCBlaW5lbiBcdTAwRTRsdGVyZW4gU3RhbmQpLlxyXG4vL1xyXG4vLyBQbGF0eiA9IGRpcmVrdCBoaW50ZXIgZGVtIG5cdTAwRTRjaHN0ZW4gVm9yZ1x1MDBFNG5nZXIsIGRlbiBrZXkgaW4gZGVyIHZvbGxzdFx1MDBFNG5kaWdcclxuLy8gc29ydGllcnRlbiBSZWloZW5mb2xnZSBoXHUwMEU0dHRlIChnYW56IG5hY2ggdm9ybiwgd2VubiBlcyBrZWluZW4gZ2lidCkuIExpZWZlcnRcclxuLy8gdHJ1ZSBiZWkgZWluZXIgXHUwMEM0bmRlcnVuZy5cclxuZnVuY3Rpb24gcGxhY2VQcm9wZXJ0eUZvcihwbHVnaW4sIGZyb250bWF0dGVyLCBrZXkpIHtcclxuICBjb25zdCBleGlzdGluZ0tleXMgPSBPYmplY3Qua2V5cyhmcm9udG1hdHRlcik7XHJcbiAgY29uc3QgYWN0dWFsS2V5ID0gZXhpc3RpbmdLZXlzLmZpbmQoKGspID0+IGsudG9Mb3dlckNhc2UoKSA9PT0ga2V5LnRvTG93ZXJDYXNlKCkpO1xyXG4gIGlmICghYWN0dWFsS2V5IHx8IGV4aXN0aW5nS2V5cy5sZW5ndGggPD0gMSkgcmV0dXJuIGZhbHNlO1xyXG5cclxuICBjb25zdCBnbG9iYWxPcmRlciA9IG5vcm1hbGl6ZUdsb2JhbE9yZGVyKHBsdWdpbi5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyKTtcclxuICBjb25zdCB0eXBlID0gdHlwZUtleU9mKHByb3BlcnR5VmFsdWUoZnJvbnRtYXR0ZXIsIFRZUF9QUk9QRVJUWSkpO1xyXG4gIGNvbnN0IHN1YnR5cGUgPSB0eXBlS2V5T2YocHJvcGVydHlWYWx1ZShmcm9udG1hdHRlciwgU1VCVFlQX1BST1BFUlRZKSk7XHJcbiAgY29uc3Qgc29ydGVkS2V5cyA9IGNvbXB1dGVTb3J0ZWRLZXlzKGV4aXN0aW5nS2V5cywgZ2xvYmFsT3JkZXIsIG9yZGVyZWREZWZhdWx0S2V5cyhwbHVnaW4sIHR5cGUsIHN1YnR5cGUpKTtcclxuXHJcbiAgY29uc3QgcmVzdCA9IGV4aXN0aW5nS2V5cy5maWx0ZXIoKGspID0+IGsgIT09IGFjdHVhbEtleSk7XHJcbiAgY29uc3QgcHJlZGVjZXNzb3IgPSBzb3J0ZWRLZXlzLnNsaWNlKDAsIHNvcnRlZEtleXMuaW5kZXhPZihhY3R1YWxLZXkpKS5wb3AoKTtcclxuICBjb25zdCBuZXdLZXlzID0gWy4uLnJlc3RdO1xyXG4gIG5ld0tleXMuc3BsaWNlKHByZWRlY2Vzc29yID09PSB1bmRlZmluZWQgPyAwIDogcmVzdC5pbmRleE9mKHByZWRlY2Vzc29yKSArIDEsIDAsIGFjdHVhbEtleSk7XHJcbiAgaWYgKG5ld0tleXMuZXZlcnkoKGssIGkpID0+IGsgPT09IGV4aXN0aW5nS2V5c1tpXSkpIHJldHVybiBmYWxzZTtcclxuXHJcbiAgY29uc3Qgc25hcHNob3QgPSB7IC4uLmZyb250bWF0dGVyIH07XHJcbiAgZm9yIChjb25zdCBrIG9mIGV4aXN0aW5nS2V5cykgZGVsZXRlIGZyb250bWF0dGVyW2tdO1xyXG4gIGZvciAoY29uc3QgayBvZiBuZXdLZXlzKSBmcm9udG1hdHRlcltrXSA9IHNuYXBzaG90W2tdO1xyXG4gIHJldHVybiB0cnVlO1xyXG59XHJcblxyXG4vLyBTb3J0aWVydCBlaW5lIGVpbnplbG5lLCBiZXJlaXRzIGJla2FubnRlIE5vdGl6ICh6LiBCLiBkaWUgYWt0aXZlIERhdGVpKS5cclxuYXN5bmMgZnVuY3Rpb24gc29ydFNpbmdsZUZpbGVGcm9udG1hdHRlcihhcHAsIHBsdWdpbiwgZmlsZSkge1xyXG4gIGNvbnN0IGdsb2JhbE9yZGVyID0gbm9ybWFsaXplR2xvYmFsT3JkZXIocGx1Z2luLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIpO1xyXG4gIC8vIFVuc2F1YmVyZSBUWVAtV2VydGUgKExpc3RlLCBSYW5kbGVlcnplaWNoZW4pIGhhYmVuIGtlaW5lIFN0YW5kYXJkbGlzdGUgLVxyXG4gIC8vIGRhbm4gZ3JlaWZ0IG51ciBkaWUgZ2xvYmFsZSBSZWloZW5mb2xnZSAoc2llaGUgdHlwZUtleU9mIGluIHR5cC1pbmRleC5qcykuXHJcbiAgY29uc3QgdHlwZSA9IHBsdWdpbi50eXBJbmRleC50eXBlT2YoZmlsZSk7XHJcbiAgY29uc3QgdHlwZURlZmF1bHRLZXlzID0gb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgdHlwZSwgcGx1Z2luLnR5cEluZGV4LnN1YnR5cGVPZihmaWxlKSk7XHJcbiAgcmV0dXJuIHNvcnRGaWxlRnJvbnRtYXR0ZXIoYXBwLCBmaWxlLCBnbG9iYWxPcmRlciwgdHlwZURlZmF1bHRLZXlzKTtcclxufVxyXG5cclxuLy8gb25seVR5cGU6IG9wdGlvbmFsIC0gYmVzY2hyXHUwMEU0bmt0IGRlbiBMYXVmIGF1ZiBOb3RpemVuIGdlbmF1IGRpZXNlcyBUeXBzLlxyXG4vLyBPaG5lIG9ubHlUeXBlIHdlcmRlbiBhbGxlIE5vdGl6ZW4gZ2Vwclx1MDBGQ2Z0LCBhdWNoIG9obmUgVFlQIG9kZXIgbWl0IGVpbmVtIFR5cFxyXG4vLyBvaG5lIGdlcGZsZWd0ZSBTdGFuZGFyZGxpc3RlIC0gZGllIGdsb2JhbCBmZXN0IHBvc2l0aW9uaWVydGVuIFByb3BlcnRpZXNcclxuLy8gKHouIEIuIGNzc2NsYXNzZXMpIHNvbGxlbiB1bmFiaFx1MDBFNG5naWcgdm9tIFR5cCB3aXJrZW4ga1x1MDBGNm5uZW4uIEZcdTAwRkNyIE5vdGl6ZW4sIGJlaVxyXG4vLyBkZW5lbiB3ZWRlciBlaW4gcGFzc2VuZGVyIFR5cC1CbG9jayBub2NoIGVpbmUgZGVyIGtvbmZpZ3VyaWVydGVuXHJcbi8vIEVpbnplbC1Qcm9wZXJ0aWVzIGdyZWlmdCwgYmxlaWJ0IGRpZSBiaXNoZXJpZ2UgUmVpaGVuZm9sZ2UgdW52ZXJcdTAwRTRuZGVydC5cclxuYXN5bmMgZnVuY3Rpb24gc29ydEFsbEZyb250bWF0dGVyKGFwcCwgcGx1Z2luLCBvbmx5VHlwZSkge1xyXG4gIGxldCBjaGVja2VkID0gMDtcclxuICBsZXQgY2hhbmdlZCA9IDA7XHJcbiAgY29uc3QgZ2xvYmFsT3JkZXIgPSBub3JtYWxpemVHbG9iYWxPcmRlcihwbHVnaW4uc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcik7XHJcbiAgLy8gTnVyIGF1c3NhZ2Vrclx1MDBFNGZ0aWcsIHdlbm4gZWluIGVpbnplbG5lciBUeXAgZWluZ2VncmVuenQgd3VyZGUgKHNvbnN0XHJcbiAgLy8gd2VjaHNlbHQgZGVyIFR5cCB2b24gRGF0ZWkgenUgRGF0ZWkpIC0gZlx1MDBGQ3IgZGllIFJcdTAwRkNja21lbGR1bmcgZGVzIEJlZmVobHNcclxuICAvLyBcIlRZUCBGcm9udG1hdHRlciBTb3J0aWVydW5nIGFrdHVhbGlzaWVyZW5cIiwgZmFsbHMgZlx1MDBGQ3IgZGVuIGdld1x1MDBFNGhsdGVuIFR5cFxyXG4gIC8vIGdhciBrZWluZSBUWVAtRnJvbnRtYXR0ZXItTGlzdGUgZ2VwZmxlZ3QgaXN0LlxyXG4gIGNvbnN0IGhhc1R5cGVEZWZhdWx0cyA9IG9ubHlUeXBlID8gb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgb25seVR5cGUpICE9PSBudWxsIDogbnVsbDtcclxuXHJcbiAgZm9yIChjb25zdCBmaWxlIG9mIGFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCkpIHtcclxuICAgIGlmICghcGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXMgJiYgYXBwLm1ldGFkYXRhQ2FjaGUuaXNVc2VySWdub3JlZChmaWxlLnBhdGgpKSBjb250aW51ZTtcclxuXHJcbiAgICBjb25zdCB0eXBlID0gcGx1Z2luLnR5cEluZGV4LnR5cGVPZihmaWxlKTtcclxuICAgIGlmIChvbmx5VHlwZSAmJiB0eXBlICE9PSBvbmx5VHlwZSkgY29udGludWU7XHJcblxyXG4gICAgY29uc3QgdHlwZURlZmF1bHRLZXlzID0gb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgdHlwZSwgcGx1Z2luLnR5cEluZGV4LnN1YnR5cGVPZihmaWxlKSk7XHJcbiAgICBjaGVja2VkKys7XHJcbiAgICBpZiAoYXdhaXQgc29ydEZpbGVGcm9udG1hdHRlcihhcHAsIGZpbGUsIGdsb2JhbE9yZGVyLCB0eXBlRGVmYXVsdEtleXMpKSBjaGFuZ2VkKys7XHJcbiAgfVxyXG5cclxuICByZXR1cm4geyBjaGVja2VkLCBjaGFuZ2VkLCBoYXNUeXBlRGVmYXVsdHMgfTtcclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSB7XHJcbiAgc29ydEFsbEZyb250bWF0dGVyLFxyXG4gIHNvcnRTaW5nbGVGaWxlRnJvbnRtYXR0ZXIsXHJcbiAgc29ydEZyb250bWF0dGVyRm9yLFxyXG4gIHBsYWNlUHJvcGVydHlGb3IsXHJcbiAgbm9ybWFsaXplR2xvYmFsT3JkZXIsXHJcbiAgREVGQVVMVF9HTE9CQUxfT1JERVIsXHJcbiAgVFlQX1BST1BFUlRZLFxyXG4gIFNVQlRZUF9QUk9QRVJUWSxcclxufTtcclxuIiwgImNvbnN0IHsgc2V0SWNvbiwgTm90aWNlIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IFRZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZLCBzb3J0QWxsRnJvbnRtYXR0ZXIgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLXNvcnRcIik7XG5cbi8vIEFuemVpZ2V0ZXh0IGRlciB2aWVyIG5pY2h0IGVudGZlcm5iYXJlbiBQbGF0emhhbHRlci1aZWlsZW4gLSBcInR5cFZhbHVlXCIgaXN0XG4vLyBkaWUgVFlQLVByb3BlcnR5IHNlbGJzdCwgXCJzdWJ0eXBWYWx1ZVwiIGFuYWxvZyBkaWUgU1VCVFlQLVByb3BlcnR5LCBcInR5cFwiXG4vLyBkaWUgVFlQLUZyb250bWF0dGVyLUxpc3RlIGRlcyBUWVBzIChzaWVoZVxuLy8gdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpLCBcIm90aGVyXCIgYWxsZSBQcm9wZXJ0aWVzLCBkaWUgd2VkZXIgZG9ydCBub2NoXG4vLyBpbiBkaWVzZXIgTGlzdGUgbmFtZW50bGljaCBnZWZcdTAwRkNocnQgd2VyZGVuLiBTaWVoZSBjb21wdXRlU29ydGVkS2V5cyBpblxuLy8gZnJvbnRtYXR0ZXItc29ydC5qcyBmXHUwMEZDciBkaWUgdGF0c1x1MDBFNGNobGljaGUgQXVmbFx1MDBGNnN1bmcgZGllc2VyIEJsXHUwMEY2Y2tlLlxuY29uc3QgUExBQ0VIT0xERVJfTEFCRUxTID0ge1xuICB0eXBWYWx1ZTogXCJUWVBcIixcbiAgc3VidHlwVmFsdWU6IFwiU1VCVFlQXCIsXG4gIHR5cDogXCJUWVAtRnJvbnRtYXR0ZXJcIixcbiAgb3RoZXI6IFwiU29uc3RpZ2UgUHJvcGVydGllc1wiLFxufTtcblxuLy8gRWRpdG9yIGZcdTAwRkNyIHBsdWdpbi5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyOiBlaW5lIHJlaW5lIE5hbWVuc2xpc3RlXG4vLyAoa2VpbmUgV2VydGUsIGRhaGVyIGtlaW4gZWlnZW5lciBwcml2YXRlLUFQSS1VbXdlZyBcdTAwRkNiZXIgT2JzaWRpYW5zXG4vLyBNZXRhZGF0YS1FZGl0b3ItV2lkZ2V0IHdpZSBpbiB0eXBlLWZyb250bWF0dGVyLWVkaXRvci5qcyBuXHUwMEY2dGlnKSBtaXRcbi8vIERyYWctYW5kLWRyb3AtU29ydGllcnVuZy4gRGllIGRyZWkgUGxhdHpoYWx0ZXItWmVpbGVuIHNpbmQgVGVpbCBkZXJzZWxiZW5cbi8vIExpc3RlLCBsYXNzZW4gc2ljaCB2ZXJzY2hpZWJlbiwgYWJlciBuaWNodCBwZXIgVUkgZW50ZmVybmVuLlxuZnVuY3Rpb24gbW91bnRHbG9iYWxPcmRlckVkaXRvcihjb250YWluZXJFbCwgcGx1Z2luKSB7XG4gIGNvbnN0IGhlYWRlciA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1mcm9udG1hdHRlci1oZWFkZXJcIiB9KTtcblxuICAvLyBFaWdlbmUgR3J1cHBlIGZcdTAwRkNyIEJ1dHRvbiArIFx1MDBEQ2JlcnNjaHJpZnQsIHN0YXR0IGJlaWRlIGFscyBnZXRyZW5udGUgS2luZGVyXG4gIC8vIHZvbiBoZWFkZXIgZGlyZWt0OiBiZWkganVzdGlmeS1jb250ZW50OiBzcGFjZS1iZXR3ZWVuIChzaWVoZSBDU1MpIHdcdTAwRkNyZGVcbiAgLy8gZWluIGRyaXR0ZXMgS2luZCB6d2lzY2hlbiBcdTAwRENiZXJzY2hyaWZ0IHVuZCBcIitcIi1CdXR0b24gc29uc3QgbWl0dGlnIGltXG4gIC8vIHZlcmJsZWliZW5kZW4gUGxhdHogbGFuZGVuLCBzdGF0dCBkaXJla3QgbmViZW4gZGVyIFx1MDBEQ2JlcnNjaHJpZnQgenUgc2l0emVuLlxuICBjb25zdCB0aXRsZUdyb3VwID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1mcm9udG1hdHRlci10aXRsZS1ncm91cFwiIH0pO1xuXG4gIC8vIFdlbmRldCBkaWUgYWt0dWVsbGUgUmVpaGVuZm9sZ2Ugc29mb3J0IGF1ZiBkZW4gZ2VzYW10ZW4gVmF1bHQgYW4gLSBkZXJzZWxiZVxuICAvLyBMYXVmIHdpZSBkZXIgQmVmZWhsIFwiRnJvbnRtYXR0ZXIgU29ydGllcnVuZyBHTE9CQUwgYWt0dWFsaXNpZXJlblwiXG4gIC8vIChzb3J0QWxsRnJvbnRtYXR0ZXIgbWl0IG9ubHlUeXBlIG51bGwpLCBudXIgZGlyZWt0IG5lYmVuIGRlciBMaXN0ZVxuICAvLyBlcnJlaWNoYmFyIHN0YXR0IFx1MDBGQ2JlciBkaWUgQmVmZWhsc3BhbGV0dGUuXG4gIGNvbnN0IGFwcGx5QnRuID0gdGl0bGVHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb25cIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJBdWYgYWxsZSBOb3RpemVuIGFud2VuZGVuXCIgfSB9KTtcbiAgc2V0SWNvbihhcHBseUJ0biwgXCJwbGF5XCIpO1xuICBhcHBseUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCB7IGNoZWNrZWQsIGNoYW5nZWQgfSA9IGF3YWl0IHNvcnRBbGxGcm9udG1hdHRlcihwbHVnaW4uYXBwLCBwbHVnaW4sIG51bGwpO1xuICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgY2hhbmdlZCA+IDBcbiAgICAgICAgICA/IGBGcm9udG1hdHRlciBTb3J0aWVydW5nOiAke2NoZWNrZWR9IE5vdGl6ZW4gZ2Vwclx1MDBGQ2Z0LCAke2NoYW5nZWR9IHNvcnRpZXJ0LmBcbiAgICAgICAgICA6IGBGcm9udG1hdHRlciBTb3J0aWVydW5nOiAke2NoZWNrZWR9IE5vdGl6ZW4gZ2Vwclx1MDBGQ2Z0LCBiZXJlaXRzIGFsbGUgc29ydGllcnQuYFxuICAgICAgKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihcIltGcm9udG1hdHRlciBTb3J0aWVydW5nXVwiLCBlcnJvcik7XG4gICAgICBuZXcgTm90aWNlKGBGcm9udG1hdHRlciBTb3J0aWVydW5nIGZlaGxnZXNjaGxhZ2VuOiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgfVxuICB9KTtcblxuICB0aXRsZUdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtc2VjdGlvbi10aXRsZVwiLCB0ZXh0OiBcIkdsb2JhbGUgUHJvcGVydHktUmVpaGVuZm9sZ2VcIiB9KTtcblxuICBjb25zdCBhZGRCdG4gPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiUHJvcGVydHkgaGluenVmXHUwMEZDZ2VuXCIgfSB9KTtcbiAgc2V0SWNvbihhZGRCdG4sIFwicGx1c1wiKTtcblxuICBjb25zdCBsaXN0RWwgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC1vcmRlci1saXN0XCIgfSk7XG5cbiAgY29uc3Qgb3JkZXIgPSAoKSA9PiBwbHVnaW4uc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcjtcblxuICAvLyBOZXVlIFplaWxlIHdpcmQgZXJzdCBiZWkgZWluZW0gZ1x1MDBGQ2x0aWdlbiwgbmljaHQtbGVlcmVuIE5hbWVuIHRhdHNcdTAwRTRjaGxpY2ggaW5cbiAgLy8gcGx1Z2luLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIgYXVmZ2Vub21tZW4gKHVuZCBkYW1pdCBwb3RlbnppZWxsXG4gIC8vIGdlc3BlaWNoZXJ0KSAtIGJpcyBkYWhpbiBleGlzdGllcnQgc2llIG51ciBhbHMgbG9rYWxlciBFbnR3dXJmLCBkZXIgYmVpbVxuICAvLyBSZS1SZW5kZXIgenVzXHUwMEU0dHpsaWNoIGFucyBFbmRlIGRlciBlY2h0ZW4gTGlzdGUgZ2VoXHUwMEU0bmd0IHdpcmQuIFNvIGxhbmRlblxuICAvLyBsZWVyZSBQcm9wZXJ0eS1GZWxkZXIgbmllIGluIGRlbiBFaW5zdGVsbHVuZ2VuLCBzZWxic3Qgd2VubiB6d2lzY2hlbmR1cmNoXG4gIC8vIGF1cyBhbmRlcmVtIEFubGFzcyAoei4gQi4gVmVyc2NoaWViZW4gZWluZXIgYW5kZXJlbiBaZWlsZSkgZ2VzcGVpY2hlcnQgd2lyZC5cbiAgbGV0IGRyYWZ0RW50cnkgPSBudWxsO1xuXG4gIGNvbnN0IGlzRHVwbGljYXRlTmFtZSA9ICh2YWx1ZSwgb3duRW50cnkpID0+IHtcbiAgICBjb25zdCBsb3dlciA9IHZhbHVlLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKGxvd2VyID09PSBUWVBfUFJPUEVSVFkudG9Mb3dlckNhc2UoKSB8fCBsb3dlciA9PT0gU1VCVFlQX1BST1BFUlRZLnRvTG93ZXJDYXNlKCkpIHJldHVybiB0cnVlO1xuICAgIHJldHVybiBvcmRlcigpLnNvbWUoKG90aGVyKSA9PiBvdGhlciAhPT0gb3duRW50cnkgJiYgb3RoZXIua2luZCA9PT0gXCJwcm9wZXJ0eVwiICYmIG90aGVyLm5hbWUudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXIpO1xuICB9O1xuXG4gIGNvbnN0IHJlbmRlciA9ICgpID0+IHtcbiAgICBsaXN0RWwuZW1wdHkoKTtcbiAgICBjb25zdCBlbnRyaWVzID0gZHJhZnRFbnRyeSA/IFsuLi5vcmRlcigpLCBkcmFmdEVudHJ5XSA6IG9yZGVyKCk7XG5cbiAgICBlbnRyaWVzLmZvckVhY2goKGVudHJ5LCBpbmRleCkgPT4ge1xuICAgICAgY29uc3QgaXNEcmFmdCA9IGVudHJ5ID09PSBkcmFmdEVudHJ5O1xuICAgICAgY29uc3QgaXNQbGFjZWhvbGRlciA9IGVudHJ5LmtpbmQgIT09IFwicHJvcGVydHlcIjtcbiAgICAgIGNvbnN0IHJvd0NscyA9XG4gICAgICAgIFwiZnJlZC1vcmRlci1yb3dcIiArIChpc1BsYWNlaG9sZGVyID8gXCIgaXMtcGxhY2Vob2xkZXJcIiA6IFwiXCIpICsgKGVudHJ5LmtpbmQgPT09IFwidHlwXCIgPyBcIiBpcy10eXAtZGVmYXVsdHNcIiA6IFwiXCIpO1xuICAgICAgY29uc3Qgcm93ID0gbGlzdEVsLmNyZWF0ZURpdih7IGNsczogcm93Q2xzIH0pO1xuXG4gICAgICBjb25zdCBkcmFnSGFuZGxlID0gcm93LmNyZWF0ZURpdih7IGNsczogXCJmcmVkLW9yZGVyLWRyYWdcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJWZXJzY2hpZWJlblwiIH0gfSk7XG4gICAgICBzZXRJY29uKGRyYWdIYW5kbGUsIFwiZ3JpcC12ZXJ0aWNhbFwiKTtcblxuICAgICAgaWYgKGlzUGxhY2Vob2xkZXIpIHtcbiAgICAgICAgcm93LmNyZWF0ZURpdih7IGNsczogXCJmcmVkLW9yZGVyLWxhYmVsXCIsIHRleHQ6IFBMQUNFSE9MREVSX0xBQkVMU1tlbnRyeS5raW5kXSB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IGlucHV0ID0gcm93LmNyZWF0ZUVsKFwiaW5wdXRcIiwge1xuICAgICAgICAgIHR5cGU6IFwidGV4dFwiLFxuICAgICAgICAgIGNsczogXCJmcmVkLW9yZGVyLW5hbWUtaW5wdXRcIixcbiAgICAgICAgICBhdHRyOiB7IHBsYWNlaG9sZGVyOiBcIlByb3BlcnR5LU5hbWVcIiB9LFxuICAgICAgICB9KTtcbiAgICAgICAgaW5wdXQudmFsdWUgPSBlbnRyeS5uYW1lO1xuXG4gICAgICAgIC8vIFwiYmx1clwiIHN0YXR0IFwiY2hhbmdlXCI6IExldHp0ZXJlcyBmZXVlcnQgYmVpIGVpbmVtIGxlZXIgZ2VibGllYmVuZW5cbiAgICAgICAgLy8gRmVsZCBnYXIgbmljaHQgZXJzdCAoQnJvd3NlciBzZWhlbiBkYXJpbiBrZWluZSBXZXJ0XHUwMEU0bmRlcnVuZykgLSBkZXJcbiAgICAgICAgLy8gRW50d3VyZiB3XHUwMEZDcmRlIGRhbm4gbmllIGF1Zmdlclx1MDBFNHVtdC4gXCJibHVyXCIgZ3JlaWZ0IHp1dmVybFx1MDBFNHNzaWcgaW5cbiAgICAgICAgLy8gYmVpZGVuIEZcdTAwRTRsbGVuICh1bWJlbmVubmVuIHdpZSBsZWVyIGxhc3NlbikuXG4gICAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJibHVyXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBjb25zdCB2YWx1ZSA9IGlucHV0LnZhbHVlLnRyaW0oKTtcblxuICAgICAgICAgIGlmICghdmFsdWUpIHtcbiAgICAgICAgICAgIGlmIChpc0RyYWZ0KSB7XG4gICAgICAgICAgICAgIGRyYWZ0RW50cnkgPSBudWxsO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgb3JkZXIoKS5zcGxpY2Uob3JkZXIoKS5pbmRleE9mKGVudHJ5KSwgMSk7XG4gICAgICAgICAgICAgIGF3YWl0IHBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlbmRlcigpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChpc0R1cGxpY2F0ZU5hbWUodmFsdWUsIGlzRHJhZnQgPyBudWxsIDogZW50cnkpKSB7XG4gICAgICAgICAgICBuZXcgTm90aWNlKGBcIiR7dmFsdWV9XCIgaXN0IGJlcmVpdHMgaW4gZGVyIExpc3RlLmApO1xuICAgICAgICAgICAgaW5wdXQudmFsdWUgPSBlbnRyeS5uYW1lO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGVudHJ5Lm5hbWUgPSB2YWx1ZTtcbiAgICAgICAgICBpZiAoaXNEcmFmdCkge1xuICAgICAgICAgICAgb3JkZXIoKS5wdXNoKGVudHJ5KTtcbiAgICAgICAgICAgIGRyYWZ0RW50cnkgPSBudWxsO1xuICAgICAgICAgIH1cbiAgICAgICAgICBhd2FpdCBwbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgcmVuZGVyKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHJlbW92ZUJ0biA9IHJvdy5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC1vcmRlci1yZW1vdmUgY2xpY2thYmxlLWljb25cIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJFbnRmZXJuZW5cIiB9IH0pO1xuICAgICAgICBzZXRJY29uKHJlbW92ZUJ0biwgXCJ4XCIpO1xuICAgICAgICByZW1vdmVCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBpZiAoaXNEcmFmdCkge1xuICAgICAgICAgICAgZHJhZnRFbnRyeSA9IG51bGw7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIG9yZGVyKCkuc3BsaWNlKG9yZGVyKCkuaW5kZXhPZihlbnRyeSksIDEpO1xuICAgICAgICAgICAgYXdhaXQgcGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZW5kZXIoKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIC8vIERlciBFbnR3dXJmIGhhdCBub2NoIGtlaW5lbiBQbGF0eiBpbiBkZXIgZWNodGVuIExpc3RlIC0gVmVyc2NoaWViZW5cbiAgICAgIC8vIGVyZ2lidCBmXHUwMEZDciBpaG4ga2VpbmVuIFNpbm4sIGJldm9yIGVyIFx1MDBGQ2JlcmhhdXB0IGVpbmVuIE5hbWVuIGhhdC5cbiAgICAgIGlmIChpc0RyYWZ0KSByZXR1cm47XG5cbiAgICAgIHJvdy5kcmFnZ2FibGUgPSB0cnVlO1xuICAgICAgcm93LmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnc3RhcnRcIiwgKGV2ZW50KSA9PiB7XG4gICAgICAgIGV2ZW50LmRhdGFUcmFuc2Zlci5lZmZlY3RBbGxvd2VkID0gXCJtb3ZlXCI7XG4gICAgICAgIGV2ZW50LmRhdGFUcmFuc2Zlci5zZXREYXRhKFwidGV4dC9wbGFpblwiLCBTdHJpbmcoaW5kZXgpKTtcbiAgICAgICAgcm93LmNsYXNzTGlzdC5hZGQoXCJpcy1kcmFnZ2luZ1wiKTtcbiAgICAgIH0pO1xuICAgICAgcm93LmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnZW5kXCIsICgpID0+IHJvdy5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJhZ2dpbmdcIikpO1xuICAgICAgcm93LmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnb3ZlclwiLCAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgLy8gT2JlcmUgb2RlciB1bnRlcmUgSFx1MDBFNGxmdGUgZGVyIFplaWxlIGVudHNjaGVpZGV0LCBvYiBkaWUgZ2V6b2dlbmVcbiAgICAgICAgLy8gWmVpbGUgZGF2b3Igb2RlciBkYWhpbnRlciBsYW5kZXQgLSBzb25zdCBsaWVcdTAwREZlIHNpY2ggbmllIFwibmFjaCBnYW56XG4gICAgICAgIC8vIHVudGVuXCIgYWJsZWdlbiAoQWJsZWdlbiBhdWYgZGVyIGxldHp0ZW4gWmVpbGUgaFx1MDBFNHR0ZSBpbW1lciBudXIgdm9yXG4gICAgICAgIC8vIGlociBlaW5nZWZcdTAwRkNndCkuXG4gICAgICAgIGNvbnN0IHJlY3QgPSByb3cuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICAgIGNvbnN0IGlzQWZ0ZXIgPSBldmVudC5jbGllbnRZIC0gcmVjdC50b3AgPiByZWN0LmhlaWdodCAvIDI7XG4gICAgICAgIHJvdy5jbGFzc0xpc3QudG9nZ2xlKFwiaXMtZHJvcC1iZWZvcmVcIiwgIWlzQWZ0ZXIpO1xuICAgICAgICByb3cuY2xhc3NMaXN0LnRvZ2dsZShcImlzLWRyb3AtYWZ0ZXJcIiwgaXNBZnRlcik7XG4gICAgICB9KTtcbiAgICAgIHJvdy5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ2xlYXZlXCIsICgpID0+IHJvdy5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJvcC1iZWZvcmVcIiwgXCJpcy1kcm9wLWFmdGVyXCIpKTtcbiAgICAgIHJvdy5hZGRFdmVudExpc3RlbmVyKFwiZHJvcFwiLCBhc3luYyAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgY29uc3QgaXNBZnRlciA9IHJvdy5jbGFzc0xpc3QuY29udGFpbnMoXCJpcy1kcm9wLWFmdGVyXCIpO1xuICAgICAgICByb3cuY2xhc3NMaXN0LnJlbW92ZShcImlzLWRyb3AtYmVmb3JlXCIsIFwiaXMtZHJvcC1hZnRlclwiKTtcblxuICAgICAgICBjb25zdCBmcm9tSW5kZXggPSBOdW1iZXIoZXZlbnQuZGF0YVRyYW5zZmVyLmdldERhdGEoXCJ0ZXh0L3BsYWluXCIpKTtcbiAgICAgICAgaWYgKE51bWJlci5pc05hTihmcm9tSW5kZXgpKSByZXR1cm47XG5cbiAgICAgICAgLy8gWmllbHBvc2l0aW9uIGltIEFycmF5IFZPUiBkZW0gRW50ZmVybmVuIHZvbiBmcm9tSW5kZXggZ2VkYWNodCAtXG4gICAgICAgIC8vIFwibmFjaCBkaWVzZXIgWmVpbGVcIiBoZWlcdTAwREZ0OiBkaXJla3Qgdm9yIGRlciBqZXdlaWxzIG5cdTAwRTRjaHN0ZW4uXG4gICAgICAgIGxldCBpbnNlcnRCZWZvcmUgPSBpc0FmdGVyID8gaW5kZXggKyAxIDogaW5kZXg7XG4gICAgICAgIGlmIChmcm9tSW5kZXggPCBpbnNlcnRCZWZvcmUpIGluc2VydEJlZm9yZSAtPSAxO1xuXG4gICAgICAgIGNvbnN0IFttb3ZlZF0gPSBvcmRlcigpLnNwbGljZShmcm9tSW5kZXgsIDEpO1xuICAgICAgICBvcmRlcigpLnNwbGljZShpbnNlcnRCZWZvcmUsIDAsIG1vdmVkKTtcbiAgICAgICAgYXdhaXQgcGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICByZW5kZXIoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9O1xuXG4gIGFkZEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgIGlmICghZHJhZnRFbnRyeSkge1xuICAgICAgZHJhZnRFbnRyeSA9IHsga2luZDogXCJwcm9wZXJ0eVwiLCBuYW1lOiBcIlwiIH07XG4gICAgICByZW5kZXIoKTtcbiAgICB9XG4gICAgY29uc3QgaW5wdXRzID0gbGlzdEVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIuZnJlZC1vcmRlci1uYW1lLWlucHV0XCIpO1xuICAgIGlucHV0c1tpbnB1dHMubGVuZ3RoIC0gMV0/LmZvY3VzKCk7XG4gIH0pO1xuXG4gIHJlbmRlcigpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgbW91bnRHbG9iYWxPcmRlckVkaXRvciB9O1xuIiwgImNvbnN0IHsgZ2V0U3VidHlwZSB9ID0gcmVxdWlyZShcIi4vc3VidHlwZXNcIik7XHJcblxyXG4vLyBGYXJiZSBlaW5lcyBUWVBzIG9obmUgZWlnZW5lIEZhcmJlIC0gaGllciBzdGF0dCBpbiB0eXAtdmlldy5qcywgd2VpbCBzaWVcclxuLy8gdW50ZXJoYWxiIGRlciBWaWV3IGdlYnJhdWNodCB3aXJkIChzaWVoZSBuYW1lQ29sb3IpOyB0eXAtdmlldy5qcyByZWljaHQgc2llXHJcbi8vIHVudmVyXHUwMEU0bmRlcnQgd2VpdGVyLCBkYW1pdCBiZXN0ZWhlbmRlIEltcG9ydGUgZG9ydCBnXHUwMEZDbHRpZyBibGVpYmVuLlxyXG5jb25zdCBERUZBVUxUX1RZUEVfQ09MT1IgPSBcIiM4ODg4ODhcIjtcclxuXHJcbi8vIC0tLSBTdWJ0eXAtRmFyYmVuIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuLy8gRWluIFN1YnR5cCBzcGVpY2hlcnQga2VpbmUgZWlnZW5lIEZhcmJlLCBzb25kZXJuIG51ciBlaW5lIEFid2VpY2h1bmcgdm9uIGRlclxyXG4vLyBGYXJiZSBzZWluZXMgVFlQcyAoc2V0dGluZ3MudHlwZVN1YnR5cGVzW1RZUF1bU1VCVFlQXS5jb2xvciA9IHsgaCwgbCB9OyBpblxyXG4vLyBCZXN0YW5kc2RhdGVuIHN0ZWh0IGRvcnQgbm9jaCBlaW4gd2lya3VuZ3Nsb3NlcyBzLCBzaWVoZVxyXG4vLyBTVUJUWVBFX0NPTE9SX0NIQU5ORUxTKS5cclxuLy8gRGllIHRhdHNcdTAwRTRjaGxpY2hlIEZhcmJlIHdpcmQgamVkZXMgTWFsIGF1cyBkZXIgYWt0dWVsbGVuIFRZUC1GYXJiZSBiZXJlY2huZXRcclxuLy8gLSBcdTAwRTRuZGVydCBzaWNoIGRpZSwgemllaGVuIGFsbGUgU3VidHlwZW4gbWl0IHVuZCBibGVpYmVuIGluIGRlciBGYXJiZmFtaWxpZS5cclxuLy8gR2VyZWNobmV0IHdpcmQgaW4gT0tMQ0ggc3RhdHQgSFNMOiBkb3J0IHdpcmt0IGVpbmUgSGVsbGlna2VpdHNcdTAwRTRuZGVydW5nIFx1MDBGQ2JlclxyXG4vLyBhbGxlIEZhcmJ0XHUwMEY2bmUgXHUwMEU0aG5saWNoIHN0YXJrIChpbiBIU0wgd1x1MDBFNHJlIHouIEIuIEdlbGIgYmVpIGdsZWljaGVtIFdlcnQgdmllbFxyXG4vLyBoZWxsZXIgYWxzIEJsYXUpLiBPaG5lIGVpZ2VuZSBFaW5zdGVsbHVuZyBoYXQgZWluIFN1YnR5cCBkaWUgVFlQLUZhcmJlLlxyXG4vLyAgIGg6IEZhcmJ0b24sIHZlcnNjaG9iZW4gdW0gR3JhZDtcclxuLy8gICBsOiBIZWxsaWdrZWl0IGluICUgZGVzIFdlZ3MgenUgV2VpXHUwMERGICgrKSBiencuIFNjaHdhcnogKC0pLlxyXG4vLyBXYXJ1bSBiZWlkZSByZWxhdGl2IHJlY2huZW4gdW5kIGRpZSBTXHUwMEU0dHRpZ3VuZyBkYWJlaSB2b24gYWxsZWluIG1pdHppZWh0LFxyXG4vLyBzdGVodCBhdXNmXHUwMEZDaHJsaWNoIGFuIGFwcGx5Q29sb3JPZmZzZXQuXHJcbi8vIFdpZSB3ZWl0IGVpbiBTdWJ0eXAgamV3ZWlscyBhYndlaWNoZW4gZGFyZiAoXHUwMEIxKSwgaXN0IGVpbnN0ZWxsYmFyXHJcbi8vIChzZXR0aW5ncy5zdWJ0eXBlQ29sb3JSYW5nZXMsIHNpZWhlIHNldHRpbmdzLmpzKSAtIGVpbmUgc2Nob24gZWluZ2VzdGVsbHRlXHJcbi8vIEFid2VpY2h1bmcgd2lyZCBiZWltIFZlcmtsZWluZXJuIGRlciBHcmVuemUgZGFyYXVmIGdla2FwcHQuXHJcbi8vIERpZXNlIExpc3RlIGlzdCBkaWUgZWluemlnZSBRdWVsbGU6IGF1cyBpaHIgYmF1ZW4gc2ljaCBkaWUgUmVnbGVyIGltXHJcbi8vIFBvcG92ZXIsIGRpZSBHcmVuemVuIGluIGRlbiBFaW5zdGVsbHVuZ2VuIHVuZCBkaWUgS2FwcHVuZy4gRWluIGhpZXJcclxuLy8gYXVza29tbWVudGllcnRlciBLYW5hbCB2ZXJzY2h3aW5kZXQgXHUwMEZDYmVyYWxsIHVuZCB3aXJkIG5pY2h0IG1laHIgZ2VzcGVpY2hlcnQuXHJcbi8vXHJcbi8vIERpZSBTXHUwMEU0dHRpZ3VuZyBpc3Qgc3RpbGxnZWxlZ3QuIFNpZSB3YXIgdXJzcHJcdTAwRkNuZ2xpY2ggblx1MDBGNnRpZywgdW0gYXVzenVnbGVpY2hlbixcclxuLy8gd2FzIEhlbGxpZ2tlaXQgdW5kIEZhcmJ0b24gZGVyIEZhcmJlIGFuIFNcdTAwRTR0dGlndW5nIHdlZ25haG1lbiAtIHNlaXQgYmVpZGVcclxuLy8gUmVnbGVyIGRpZSBTXHUwMEU0dHRpZ3VuZyB2b24gYWxsZWluIG1pdGZcdTAwRkNocmVuIChzaWVoZSBjb21wdXRlQ29sb3JPZmZzZXQpIGJsaWViXHJcbi8vIGlociBudXIgbm9jaCBkaWUgQXVzc2FnZSBcImRpZXNlciBTdWJ0eXAgbmltbXQgc2ljaCB6dXJcdTAwRkNja1wiLCB1bmQgZGFmXHUwMEZDciBsb2hudFxyXG4vLyBlaW4gZHJpdHRlciBSZWdsZXIgbmljaHQuIFp1bSBXaWVkZXJiZWxlYmVuOiBoaWVyLCBpblxyXG4vLyBERUZBVUxUX1NVQlRZUEVfQ09MT1JfUkFOR0VTLCBpbSBSZWNoZW53ZWcgdm9uIGNvbXB1dGVDb2xvck9mZnNldCB1bmQgYmVpXHJcbi8vIHJhbmdlTWF4L3JhbmdlRGVzYyBpbiBzZXR0aW5ncy5qcyBqZXdlaWxzIGRpZSBBdXNrb21tZW50aWVydW5nIGF1ZmhlYmVuLlxyXG4vLyBkb3duT25seTogZGVyIFJlZ2xlciByZWljaHQgbnVyIHZvbiAtR3JlbnplIGJpcyAwLiBFaW4gU3VidHlwIHNvbGwgc2ljaFxyXG4vLyB6dXJcdTAwRkNja25laG1lbiBkXHUwMEZDcmZlbiwgYWJlciBuaWNodCBrclx1MDBFNGZ0aWdlciBhdWZ0cmV0ZW4gYWxzIHNlaW4gVFlQIC0gYnVudGVyXHJcbi8vIGFscyBkaWUgSGF1cHRmYXJiZSB6aWVodCBkaWUgQXVmbWVya3NhbWtlaXQgZ2VuYXUgZmFsc2NoIGhlcnVtLlxyXG5jb25zdCBTVUJUWVBFX0NPTE9SX0NIQU5ORUxTID0gW1xyXG4gIHsga2V5OiBcImhcIiwgbGFiZWw6IFwiRmFyYnRvblwiLCB1bml0OiBcIlx1MDBCMFwiIH0sXHJcbiAgLy8geyBrZXk6IFwic1wiLCBsYWJlbDogXCJTXHUwMEU0dHRpZ3VuZ1wiLCB1bml0OiBcIiVcIiwgZG93bk9ubHk6IHRydWUgfSxcclxuICB7IGtleTogXCJsXCIsIGxhYmVsOiBcIkhlbGxpZ2tlaXRcIiwgdW5pdDogXCIlXCIgfSxcclxuXTtcclxuLy8gU3VidHlwZW4gc29sbGVuIHZvciBhbGxlbSB1bnRlcnNjaGVpZGJhciBzZWluOiBGYXJidG9uIHRyXHUwMEU0Z3QgZGF6dSBhbVxyXG4vLyBtZWlzdGVuIGJlaSB1bmQgYmVrb21tdCBkZW4gZ3JcdTAwRjZcdTAwREZ0ZW4gU3BpZWxyYXVtLCBIZWxsaWdrZWl0IGFscyB6d2VpdGUga2xhclxyXG4vLyBlcmtlbm5iYXJlIEFjaHNlIGViZW5mYWxscyByZWljaGxpY2guXHJcbmNvbnN0IERFRkFVTFRfU1VCVFlQRV9DT0xPUl9SQU5HRVMgPSB7IGg6IDM1LCAvKiBzOiA0MCwgKi8gbDogNDAgfTtcclxuXHJcbmZ1bmN0aW9uIGNvbG9yUmFuZ2Uoc2V0dGluZ3MsIGtleSkge1xyXG4gIGNvbnN0IHZhbHVlID0gTnVtYmVyKHNldHRpbmdzLnN1YnR5cGVDb2xvclJhbmdlcz8uW2tleV0pO1xyXG4gIHJldHVybiBOdW1iZXIuaXNGaW5pdGUodmFsdWUpICYmIHZhbHVlID49IDAgPyB2YWx1ZSA6IERFRkFVTFRfU1VCVFlQRV9DT0xPUl9SQU5HRVNba2V5XTtcclxufVxyXG5cclxuLy8gVm9uIHdvIGJpcyB3byBlaW4gUmVnbGVyIHJlaWNodCAtIGVpbmUgU3RlbGxlIGZcdTAwRkNyIFBvcG92ZXIsIEthcHB1bmcgdW5kXHJcbi8vIFZlcmxhdWZzdm9yc2NoYXUsIGRhbWl0IGRpZSBkcmVpIG5pY2h0IGF1c2VpbmFuZGVybGF1ZmVuLlxyXG5mdW5jdGlvbiBjaGFubmVsQm91bmRzKHNldHRpbmdzLCBrZXkpIHtcclxuICBjb25zdCByYW5nZSA9IGNvbG9yUmFuZ2Uoc2V0dGluZ3MsIGtleSk7XHJcbiAgcmV0dXJuIFNVQlRZUEVfQ09MT1JfQ0hBTk5FTFMuZmluZCgoY2hhbm5lbCkgPT4gY2hhbm5lbC5rZXkgPT09IGtleSk/LmRvd25Pbmx5ID8gWy1yYW5nZSwgMF0gOiBbLXJhbmdlLCByYW5nZV07XHJcbn1cclxuXHJcbi8vIEFid2VpY2h1bmcgZWluZXMgU3VidHlwcywgYXVmIGRpZSBlaW5nZXN0ZWxsdGVuIEdyZW56ZW4gZ2VrYXBwdC5cclxuZnVuY3Rpb24gY2xhbXBlZE9mZnNldChzZXR0aW5ncywgb2Zmc2V0KSB7XHJcbiAgaWYgKCFvZmZzZXQpIHJldHVybiBudWxsO1xyXG4gIGNvbnN0IHJlc3VsdCA9IHt9O1xyXG4gIGZvciAoY29uc3QgeyBrZXkgfSBvZiBTVUJUWVBFX0NPTE9SX0NIQU5ORUxTKSB7XHJcbiAgICBjb25zdCBbbWluLCBtYXhdID0gY2hhbm5lbEJvdW5kcyhzZXR0aW5ncywga2V5KTtcclxuICAgIHJlc3VsdFtrZXldID0gTWF0aC5taW4obWF4LCBNYXRoLm1heChtaW4sIE51bWJlcihvZmZzZXRba2V5XSkgfHwgMCkpO1xyXG4gIH1cclxuICByZXR1cm4gcmVzdWx0O1xyXG59XHJcblxyXG5jb25zdCB0b0xpbmVhciA9IChjKSA9PiAoYyA8PSAwLjA0MDQ1ID8gYyAvIDEyLjkyIDogKChjICsgMC4wNTUpIC8gMS4wNTUpICoqIDIuNCk7XHJcbmNvbnN0IHRvR2FtbWEgPSAoYykgPT4gKGMgPD0gMC4wMDMxMzA4ID8gMTIuOTIgKiBjIDogMS4wNTUgKiBjICoqICgxIC8gMi40KSAtIDAuMDU1KTtcclxuXHJcbmZ1bmN0aW9uIGhleFRvT2tsY2goaGV4KSB7XHJcbiAgY29uc3QgbWF0Y2ggPSAvXiM/KFswLTlhLWZdezZ9KSQvaS5leGVjKGhleCA/PyBcIlwiKTtcclxuICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbDtcclxuICBjb25zdCBpbnQgPSBwYXJzZUludChtYXRjaFsxXSwgMTYpO1xyXG4gIGNvbnN0IFtyLCBnLCBiXSA9IFsoaW50ID4+IDE2KSAmIDI1NSwgKGludCA+PiA4KSAmIDI1NSwgaW50ICYgMjU1XS5tYXAoKGMpID0+IHRvTGluZWFyKGMgLyAyNTUpKTtcclxuICBjb25zdCBsID0gTWF0aC5jYnJ0KDAuNDEyMjIxNDcwOCAqIHIgKyAwLjUzNjMzMjUzNjMgKiBnICsgMC4wNTE0NDU5OTI5ICogYik7XHJcbiAgY29uc3QgbSA9IE1hdGguY2JydCgwLjIxMTkwMzQ5ODIgKiByICsgMC42ODA2OTk1NDUxICogZyArIDAuMTA3Mzk2OTU2NiAqIGIpO1xyXG4gIGNvbnN0IHMgPSBNYXRoLmNicnQoMC4wODgzMDI0NjE5ICogciArIDAuMjgxNzE4ODM3NiAqIGcgKyAwLjYyOTk3ODcwMDUgKiBiKTtcclxuICBjb25zdCBMID0gMC4yMTA0NTQyNTUzICogbCArIDAuNzkzNjE3Nzg1ICogbSAtIDAuMDA0MDcyMDQ2OCAqIHM7XHJcbiAgY29uc3QgQSA9IDEuOTc3OTk4NDk1MSAqIGwgLSAyLjQyODU5MjIwNSAqIG0gKyAwLjQ1MDU5MzcwOTkgKiBzO1xyXG4gIGNvbnN0IEIgPSAwLjAyNTkwNDAzNzEgKiBsICsgMC43ODI3NzE3NjYyICogbSAtIDAuODA4Njc1NzY2ICogcztcclxuICByZXR1cm4geyBMLCBDOiBNYXRoLmh5cG90KEEsIEIpLCBIOiAoKE1hdGguYXRhbjIoQiwgQSkgKiAxODApIC8gTWF0aC5QSSArIDM2MCkgJSAzNjAgfTtcclxufVxyXG5cclxuLy8gTGluZWFyZXMgc1JHQiwgS2FuXHUwMEU0bGUgZ2dmLiBhdVx1MDBERmVyaGFsYiB2b24gMC4uMSAoYXVcdTAwREZlcmhhbGIgZGVzIEZhcmJyYXVtcykuXHJcbmZ1bmN0aW9uIG9rbGNoVG9MaW5lYXIoeyBMLCBDLCBIIH0pIHtcclxuICBjb25zdCBBID0gQyAqIE1hdGguY29zKChIICogTWF0aC5QSSkgLyAxODApO1xyXG4gIGNvbnN0IEIgPSBDICogTWF0aC5zaW4oKEggKiBNYXRoLlBJKSAvIDE4MCk7XHJcbiAgY29uc3QgbCA9IChMICsgMC4zOTYzMzc3Nzc0ICogQSArIDAuMjE1ODAzNzU3MyAqIEIpICoqIDM7XHJcbiAgY29uc3QgbSA9IChMIC0gMC4xMDU1NjEzNDU4ICogQSAtIDAuMDYzODU0MTcyOCAqIEIpICoqIDM7XHJcbiAgY29uc3QgcyA9IChMIC0gMC4wODk0ODQxNzc1ICogQSAtIDEuMjkxNDg1NTQ4ICogQikgKiogMztcclxuICByZXR1cm4gW1xyXG4gICAgNC4wNzY3NDE2NjIxICogbCAtIDMuMzA3NzExNTkxMyAqIG0gKyAwLjIzMDk2OTkyOTIgKiBzLFxyXG4gICAgLTEuMjY4NDM4MDA0NiAqIGwgKyAyLjYwOTc1NzQwMTEgKiBtIC0gMC4zNDEzMTkzOTY1ICogcyxcclxuICAgIC0wLjAwNDE5NjA4NjMgKiBsIC0gMC43MDM0MTg2MTQ3ICogbSArIDEuNzA3NjE0NzAxICogcyxcclxuICBdO1xyXG59XHJcblxyXG5jb25zdCBpbkdhbXV0ID0gKHJnYikgPT4gcmdiLmV2ZXJ5KChjKSA9PiBjID49IC0wLjAwMDEgJiYgYyA8PSAxLjAwMDEpO1xyXG5cclxuLy8gR3JcdTAwRjZcdTAwREZ0ZXMgYmVpIGRpZXNlciBIZWxsaWdrZWl0IHVuZCBkaWVzZW0gRmFyYnRvbiBpbiBzUkdCIG5vY2ggZGFyc3RlbGxiYXJlc1xyXG4vLyBDaHJvbWEuIERpZXNlIEdyZW56ZSBzY2h3YW5rdCBzdGFyayAtIHJlaW5lcyBHZWxiIHZlcnRyXHUwMEU0Z3QgbnVyIGtuYXBwIHVudGVyXHJcbi8vIFdlaVx1MDBERiB2aWVsIENocm9tYSwgQmxhdSBhbSBtZWlzdGVuIGluIGRlciBNaXR0ZSAtLCB1bmQgZ2VuYXUgYW4gaWhyIHNjaGVpdGVydFxyXG4vLyBqZWRlIFJlY2hudW5nLCBkaWUgQ2hyb21hIGFic29sdXQgZmVzdGhcdTAwRTRsdCAoc2llaGUgYXBwbHlDb2xvck9mZnNldCkuXHJcbmZ1bmN0aW9uIG1heENocm9tYShMLCBIKSB7XHJcbiAgbGV0IGxvdyA9IDA7XHJcbiAgbGV0IGhpZ2ggPSAwLjQ7IC8vIFx1MDBGQ2JlciBkZW0gc1JHQi1NYXhpbXVtICh+MCwzMilcclxuICBmb3IgKGxldCBpID0gMDsgaSA8IDIwOyBpKyspIHtcclxuICAgIGNvbnN0IG1pZCA9IChsb3cgKyBoaWdoKSAvIDI7XHJcbiAgICBpZiAoaW5HYW11dChva2xjaFRvTGluZWFyKHsgTCwgQzogbWlkLCBIIH0pKSkgbG93ID0gbWlkO1xyXG4gICAgZWxzZSBoaWdoID0gbWlkO1xyXG4gIH1cclxuICByZXR1cm4gbG93O1xyXG59XHJcblxyXG4vLyBMaWVndCBkaWUgRmFyYmUgYXVcdTAwREZlcmhhbGIgdm9uIHNSR0IsIHdpcmQgZGllIFNcdTAwRTR0dGlndW5nIChDaHJvbWEpIHNvIHdlaXRcclxuLy8gdmVycmluZ2VydCwgYmlzIHNpZSBkYXJzdGVsbGJhciBpc3QgLSBGYXJidG9uIHVuZCBIZWxsaWdrZWl0IGJsZWliZW4uIEZcdTAwRkNyXHJcbi8vIGFwcGx5Q29sb3JPZmZzZXQgaXN0IGRhcyBudXIgbm9jaCBlaW4gU2ljaGVyaGVpdHNuZXR6OiBkb3J0IHN0ZWh0IGRhc1xyXG4vLyBDaHJvbWEgb2huZWhpbiBzY2hvbiBhbHMgQW50ZWlsIGRlcyBkYXJzdGVsbGJhcmVuIE1heGltdW1zIGZlc3QuXHJcbmZ1bmN0aW9uIG9rbGNoVG9IZXgoY29sb3IpIHtcclxuICBsZXQgcmdiID0gb2tsY2hUb0xpbmVhcihjb2xvcik7XHJcbiAgaWYgKCFpbkdhbXV0KHJnYikpIHJnYiA9IG9rbGNoVG9MaW5lYXIoeyAuLi5jb2xvciwgQzogbWF4Q2hyb21hKGNvbG9yLkwsIGNvbG9yLkgpIH0pO1xyXG4gIHJldHVybiAoXHJcbiAgICBcIiNcIiArXHJcbiAgICByZ2JcclxuICAgICAgLm1hcCgoYykgPT4gTWF0aC5yb3VuZChNYXRoLm1pbigxLCBNYXRoLm1heCgwLCB0b0dhbW1hKE1hdGgubWluKDEsIE1hdGgubWF4KDAsIGMpKSkpKSAqIDI1NSkpXHJcbiAgICAgIC5tYXAoKGMpID0+IGMudG9TdHJpbmcoMTYpLnBhZFN0YXJ0KDIsIFwiMFwiKSlcclxuICAgICAgLmpvaW4oXCJcIilcclxuICApO1xyXG59XHJcblxyXG4vLyBIZWxsaWdrZWl0IGRlcyBTY2hlaXRlbHMgZWluZXMgRmFyYnRvbnM6IGRvcnQgdHJcdTAwRTRndCBlciBkYXMgbWVpc3RlIENocm9tYS5cclxuLy8gbWF4Q2hyb21hIHN0ZWlndCBcdTAwRkNiZXIgZGllIEhlbGxpZ2tlaXQgYmlzIGRvcnRoaW4gdW5kIGZcdTAwRTRsbHQgZGFuYWNoIHdpZWRlciwgc29cclxuLy8gZGFzcyBkaWUgU3BpdHplIHNpY2ggZWlua3JlaXNlbiBsXHUwMEU0c3N0LiBKZSBGYXJidG9uIGVpbiBmZXN0ZXIgV2VydCwgdW5kIGRpZVxyXG4vLyBTdWNoZSBpc3QgdGV1ZXIgLSBkYXJ1bSBuYWNoIGdhbnplbiBHcmFkIGdlbWVya3QuXHJcbmNvbnN0IGN1c3BDYWNoZSA9IG5ldyBNYXAoKTtcclxuXHJcbi8vIEFiIGhpZXIgZ2lsdCBlaW5lIEZhcmJlIGFscyBidW50LiBFaW4gcmVpbmVzIEdyYXUga29tbXQgYXVzIGhleFRvT2tsY2ggbmljaHRcclxuLy8gbWl0IENocm9tYSAwIHp1clx1MDBGQ2NrLCBzb25kZXJuIG1pdCBydW5kIDJlLTggdW5kIGVpbmVtIGJlbGllYmlnZW4gRmFyYnRvbiAtXHJcbi8vIGRpZSBNYXRyaXhrb25zdGFudGVuIHNpbmQgZ2VydW5kZXQuIEF1ZiBcImdyXHUwMEY2XHUwMERGZXIgYWxzIDBcIiB6dSBwclx1MDBGQ2ZlbiBmXHUwMEZDaHJ0ZSBkaWVcclxuLy8gSGVsbGlna2VpdCBlaW5lcyBHcmF1cyBhbHNvIGRlbSBTY2hlaXRlbCBlaW5lcyBGYXJidG9ucyBuYWNoLCBkZW4gZXMgZ2FyXHJcbi8vIG5pY2h0IGhhdC4gRGllIFNjaHdlbGxlIGxpZWd0IHdlaXQgdW50ZXIgYWxsZW0sIHdhcyBpbiA4IEJpdCBzaWNodGJhciB3XHUwMEU0cmVcclxuLy8gKGVpbiBTY2hyaXR0IHZvbiAxLzI1NSBpbiBlaW5lbSBLYW5hbCBlcmdpYnQgcnVuZCAwLDAwMikuXHJcbmNvbnN0IE5FVVRSQUxfQ0hST01BID0gMWUtNDtcclxuXHJcbmZ1bmN0aW9uIGN1c3BMaWdodG5lc3MoSCkge1xyXG4gIGNvbnN0IGtleSA9IE1hdGgucm91bmQoSCkgJSAzNjA7XHJcbiAgY29uc3QgY2FjaGVkID0gY3VzcENhY2hlLmdldChrZXkpO1xyXG4gIGlmIChjYWNoZWQgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGNhY2hlZDtcclxuICBsZXQgbG93ID0gMDtcclxuICBsZXQgaGlnaCA9IDE7XHJcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCAyNDsgaSsrKSB7XHJcbiAgICBjb25zdCB0aGlyZCA9IChoaWdoIC0gbG93KSAvIDM7XHJcbiAgICBpZiAobWF4Q2hyb21hKGxvdyArIHRoaXJkLCBrZXkpIDwgbWF4Q2hyb21hKGhpZ2ggLSB0aGlyZCwga2V5KSkgbG93ICs9IHRoaXJkO1xyXG4gICAgZWxzZSBoaWdoIC09IHRoaXJkO1xyXG4gIH1cclxuICBjb25zdCByZXN1bHQgPSAobG93ICsgaGlnaCkgLyAyO1xyXG4gIGN1c3BDYWNoZS5zZXQoa2V5LCByZXN1bHQpO1xyXG4gIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbi8vIERpZXNlbGJlIEhlbGxpZ2tlaXQsIGFiZXIgZ2VtZXNzZW4gYW0gU2NoZWl0ZWwgZGVzIFppZWxmYXJidG9ucyBzdGF0dCBhbVxyXG4vLyBlaWdlbmVuOiBkZXIgU2NoZWl0ZWwgZ2VodCBhdWYgZGVuIFNjaGVpdGVsLCBTY2h3YXJ6IGF1ZiBTY2h3YXJ6IHVuZCBXZWlcdTAwREZcclxuLy8gYXVmIFdlaVx1MDBERiwgZGF6d2lzY2hlbiBsaW5lYXIuIE9obmUgRmFyYnRvbmRyZWh1bmcga29tbXQgZGllIEhlbGxpZ2tlaXRcclxuLy8gdW52ZXJcdTAwRTRuZGVydCB6dXJcdTAwRkNjay5cclxuZnVuY3Rpb24gcmVtYXBUb0N1c3AoTCwgZnJvbUgsIHRvSCkge1xyXG4gIGNvbnN0IGZyb20gPSBjdXNwTGlnaHRuZXNzKGZyb21IKTtcclxuICBjb25zdCB0byA9IGN1c3BMaWdodG5lc3ModG9IKTtcclxuICBpZiAoTCA8PSBmcm9tKSByZXR1cm4gZnJvbSA+IDAgPyAoTCAvIGZyb20pICogdG8gOiB0bztcclxuICByZXR1cm4gZnJvbSA8IDEgPyB0byArICgoTCAtIGZyb20pIC8gKDEgLSBmcm9tKSkgKiAoMSAtIHRvKSA6IHRvO1xyXG59XHJcblxyXG4vLyBEaWUgYmVpZGVuIFN1Y2hlbiBuYWNoIGRlciBHYW11dC1HcmVuemUga29zdGVuIGplIEZhcmJlIHJ1bmQgMTAgXHUwMEI1cyAtIHp1XHJcbi8vIHZpZWwsIHdlbm4gZGVyIERhdGVpYmF1bSBvZGVyIGRlciBHcmFwaCBzaWUgZlx1MDBGQ3IgamVkZSBEYXRlaSBlcm5ldXQgYW5zdFx1MDBGNlx1MDBERnRcclxuLy8gKHNpZWhlIGNvbG9yRm9yRmlsZSkuIFZlcnNjaGllZGVuZSBGYXJiZW4gZ2lidCBlcyBkYWJlaSBudXIgZWluZSBIYW5kdm9sbCxcclxuLy8gZWluZSBqZSBUWVAvU1VCVFlQLCBhbHNvIGdlblx1MDBGQ2d0IGVpbiBad2lzY2hlbnNwZWljaGVyOyBiZWltIFppZWhlbiBlaW5lc1xyXG4vLyBSZWdsZXJzIHdcdTAwRTRjaHN0IGVyIHVtIGplZGUgWndpc2NoZW5zdGVsbHVuZyB1bmQgd2lyZCBkYXJ1bSBhYiB1bmQgenUgZ2VsZWVydC5cclxuY29uc3Qgb2Zmc2V0Q2FjaGUgPSBuZXcgTWFwKCk7XHJcblxyXG5mdW5jdGlvbiBhcHBseUNvbG9yT2Zmc2V0KGhleCwgb2Zmc2V0KSB7XHJcbiAgaWYgKCFvZmZzZXQpIHJldHVybiBoZXg7XHJcbiAgY29uc3QgY2FjaGVLZXkgPSBoZXggKyBcInxcIiArIChvZmZzZXQuaCA/PyAwKSArIFwifFwiICsgKG9mZnNldC5sID8/IDApO1xyXG4gIGNvbnN0IGNhY2hlZCA9IG9mZnNldENhY2hlLmdldChjYWNoZUtleSk7XHJcbiAgaWYgKGNhY2hlZCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gY2FjaGVkO1xyXG4gIGNvbnN0IHJlc3VsdCA9IGNvbXB1dGVDb2xvck9mZnNldChoZXgsIG9mZnNldCk7XHJcbiAgaWYgKG9mZnNldENhY2hlLnNpemUgPiA1MDApIG9mZnNldENhY2hlLmNsZWFyKCk7XHJcbiAgb2Zmc2V0Q2FjaGUuc2V0KGNhY2hlS2V5LCByZXN1bHQpO1xyXG4gIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbi8vIEJlaWRlIFJlZ2xlciB3aXJrZW4gcmVsYXRpdiB6dXIgVFlQLUZhcmJlLCBkYW1pdCBkZXIgU3VidHlwIGluIGRlclxyXG4vLyBGYW1pbGllIGJsZWlidC4gQWJzb2x1dGUgV2VydGUgaGFsdGVuIG5pY2h0LCB3YXMgc2llIHZlcnNwcmVjaGVuLCBkZW5uIHdpZVxyXG4vLyB2aWVsIEZhcmJlIHNSR0IgXHUwMEZDYmVyaGF1cHQgaGVyZ2lidCwgaFx1MDBFNG5ndCB2b24gSGVsbGlna2VpdCBVTkQgRmFyYnRvbiBhYjpcclxuLy8gICBsOiBBbnRlaWwgZGVzIFdlZ3MgenUgV2VpXHUwMERGICgrKSBiencuIFNjaHdhcnogKC0pLiBBYnNvbHV0ZSBPS0xDSC1QdW5rdGVcclxuLy8gICAgICBsaWVmZW4gYmVpIGVpbmVyIG9obmVoaW4gaGVsbGVuIFRZUC1GYXJiZSBzY2hvbiBpbiBkZXIgZXJzdGVuXHJcbi8vICAgICAgUmVnbGVyaFx1MDBFNGxmdGUgYXVmIHJlaW5lcyBXZWlcdTAwREYsIHVuZCBkZXIgUmVzdCBkZXMgUmVnbGVycyB0YXQgbmljaHRzIG1laHIuXHJcbi8vICAgaDogR3JhZCAtIGFscyBlaW56aWdlciBhYnNvbHV0LCBBQkVSIGVyIGZcdTAwRkNocnQgZGllIEhlbGxpZ2tlaXQgbWl0IChzaWVoZVxyXG4vLyAgICAgIHJlbWFwVG9DdXNwKS4gSmVkZXIgRmFyYnRvbiB0clx1MDBFNGd0IHNlaW4gbWVpc3RlcyBDaHJvbWEgYXVmIGVpbmVyIGFuZGVyZW5cclxuLy8gICAgICBIZWxsaWdrZWl0OiBHZWxiIGVyc3QgYmVpIEwgMCw5MiwgT3JhbmdlIHNjaG9uIGJlaSAwLDc4LCBCbGF1IGJlaSAwLDQ5LlxyXG4vLyAgICAgIEVpbmUgaGVsbGUgZ2VsYmUgVFlQLUZhcmJlIGF1ZiBPcmFuZ2UgenUgZHJlaGVuIHVuZCBkYWJlaSBkaWVcclxuLy8gICAgICBIZWxsaWdrZWl0IGZlc3R6dWhhbHRlbiwgc2V0enQgc2llIHdlaXQgXHUwMEZDYmVyIGRlbiBTY2hlaXRlbCB2b24gT3JhbmdlIC1cclxuLy8gICAgICBkb3J0IHRyXHUwMEU0Z3QgZGVyIEZhcmJyYXVtIGZhc3Qga2VpbiBDaHJvbWEgbWVociwgdW5kIGhlcmF1cyBrb21tdCBlaW5cclxuLy8gICAgICBibGFzc2VzIFBhc3RlbGwsIGRhcyBuZWJlbiBzZWluZW0gVFlQIHdpZSBhdXNnZXdhc2NoZW4gdW5kIHZpZWwgenUgaGVsbFxyXG4vLyAgICAgIHdpcmt0IChyZWNobmVyaXNjaCBpc3QgZXMgZ2VuYXVzbyBoZWxsLCBhYmVyIGJsYXNzIGxpZXN0IHNpY2ggYWxzIGhlbGwpLlxyXG4vLyAgICAgIEZcdTAwRkNocnQgZGllIEhlbGxpZ2tlaXQgZGFnZWdlbiBkZW4gU2NoZWl0ZWwgbmFjaCwgYmxlaWJ0IGRpZSBGYXJia3JhZnRcclxuLy8gICAgICBcdTAwRkNiZXIgZGllIGdhbnplIERyZWh1bmcgcHJha3Rpc2NoIGdsZWljaC5cclxuLy8gRWluZW4gZWlnZW5lbiBSZWdsZXIgZlx1MDBGQ3IgZGllIFNcdTAwRTR0dGlndW5nIGdpYnQgZXMgbmFjaCBhbGwgZGVtIG5pY2h0IG1laHIgLSBzaWVcclxuLy8gemllaHQgYmVpIGJlaWRlbiBhbmRlcmVuIHZvbiBhbGxlaW4gbWl0IChzdGlsbGdlbGVndCwgc2llaGVcclxuLy8gU1VCVFlQRV9DT0xPUl9DSEFOTkVMUykuXHJcbi8vXHJcbi8vIFNpbmQgZGllIEhlbGxpZ2tlaXRlbiBzbyBhdWZlaW5hbmRlciBiZXpvZ2VuLCBpc3QgYXVjaCBkYXMgQ2hyb21hIHdpZWRlclxyXG4vLyBzY2hsaWNodCBlaW4gQW50ZWlsIGFuIGRlciBEZWNrZSAoYmFzZS5DIC8gbWF4Q2hyb21hIGFtIEF1c2dhbmdzcHVua3QsIGRhbm5cclxuLy8gbWFsIG1heENocm9tYSBhbSBaaWVsKTogZGllIERlY2tlbiB6d2VpZXIgRmFyYnRcdTAwRjZuZSBzaW5kIGVyc3QgZGFkdXJjaFxyXG4vLyBcdTAwRkNiZXJoYXVwdCB2ZXJnbGVpY2hiYXIuXHJcbi8vXHJcbi8vIFdBUyBESUVTRVIgQU5URUlMIElTVCBVTkQgV0FTIE5JQ0hULiBcIkFudGVpbCBhbiBkZXIgRGVja2VcIiBpc3QgZWluZVxyXG4vLyBFbnRzY2hlaWR1bmcgXHUwMEZDYmVyIHNSR0IsIGtlaW5lIFx1MDBGQ2JlciBXYWhybmVobXVuZyAtIGRhcyBzaWVodCBtYW4gZGVtIENvZGVcclxuLy8gbmljaHQgYW4sIHdlaWwgZXIgc29uc3QgZHVyY2h3ZWcgaW4gZWluZW0gd2Focm5laG11bmdzbmFoZW4gUmF1bSByZWNobmV0LlxyXG4vLyBtYXhDaHJvbWEgYmVzY2hyZWlidCBkaWUgSFx1MDBGQ2xsZSBlaW5lcyBBdXNnYWJlZ2VyXHUwMEU0dHMuIEtvbnN0YW50IGdlaGFsdGVuIHdpcmRcclxuLy8gaGllciBhbHNvIFwiZ2xlaWNoIHdlaXQgYXVzZ2VyZWl6dFwiLCBuaWNodCBcImdsZWljaCBidW50XCIgKGRhcyB3XHUwMEU0cmUga29uc3RhbnRlc1xyXG4vLyBDKSB1bmQgbmljaHQgXCJnbGVpY2ggZ2VzXHUwMEU0dHRpZ3RcIiAoZGFzIHdcdTAwRTRyZSBrb25zdGFudGVzIEMvTCkuIERhcmF1cyBmb2xndDpcclxuLy8gICAtIERhcyBNb2RlbGwgaXN0IGFuIHNSR0IgZ2VidW5kZW4uIEluIGVpbmVtIHdlaXRlcmVuIEZhcmJyYXVtIGVyZ1x1MDBFNGJlblxyXG4vLyAgICAgZGllc2VsYmVuIEVpbmdhYmVuIGFuZGVyZSBGYXJiZW4sIHdlaWwgZGllIERlY2tlIHdvYW5kZXJzIGxpZWd0LlxyXG4vLyAgIC0gcmVtYXBUb0N1c3AgZ2lidCBnbGVpY2hlIHdhaHJnZW5vbW1lbmUgSGVsbGlna2VpdCBiZXd1c3N0IGF1ZjogbmFjaFxyXG4vLyAgICAgZWluZXIgRmFyYnRvbmRyZWh1bmcgaXN0IGRlciBTdWJ0eXAgbmljaHQgbWVociBnbGVpY2ggaGVsbCB3aWUgc2VpbiBUWVAsXHJcbi8vICAgICBzb25kZXJuIGdsZWljaCBuYWNoZHJcdTAwRkNja2xpY2guIERhcyBpc3QgaGllciBlcndcdTAwRkNuc2NodCwgYWJlciBlcyBpc3QgZWluZVxyXG4vLyAgICAgR2VzdGFsdHVuZ3NlbnRzY2hlaWR1bmcgdW5kIGtlaW4gcGVyemVwdHVlbGxlcyBHZXNldHouXHJcbi8vICAgLSBcdTAwRENiZXIgZGllIEhlbGxpZ2tlaXQgaXN0IGRhcyBDaHJvbWEgbmljaHQgbW9ub3Rvbi4gTGllZ3QgZWluZSBUWVAtRmFyYmVcclxuLy8gICAgIFx1MDBGQ2JlciBpaHJlbSBTY2hlaXRlbCwgc3RlaWd0IGVzIGF1ZiBkZW0gV2VnIG5hY2ggdW50ZW4gZXJzdCBhbiB1bmQgZlx1MDBFNGxsdFxyXG4vLyAgICAgZGFubiB3aWVkZXIgKGVpbiBibGF1ZXMgIzc4NzhkYyBoYXQgYmVpIC0yMCAlIG1laHIgQ2hyb21hIGFscyBiZWkgMCAlXHJcbi8vICAgICB1bmQgYmVpIC00MCAlKS4gRGVyIFJlZ2xlciBmXHUwMEU0aHJ0IGRvcnQgXHUwMEZDYmVyIGVpbmVuIEJ1Y2tlbC5cclxuLy8gRlx1MDBGQ3IgZmFyYmlnZSBEYXRlaW5hbWVuIGlzdCBhbGwgZGFzIHRyYWdiYXIgLSB3ZXIgZGFzIE1vZGVsbCBzdHJlbmdlciBoYWJlblxyXG4vLyB3aWxsLCBtXHUwMEZDc3N0ZSBkaWUgQmV6dWdzZ3JcdTAwRjZcdTAwREZlIHdlY2hzZWxuLCBuaWNodCBkaWUgRm9ybWVsbiBuYWNoYmVzc2Vybi5cclxuLy9cclxuLy8gQXVjaCBPS0xhYiBzZWxic3QgaXN0IG5pY2h0IHNwYW5udW5nc2ZyZWk6IHNlaW5lIEZhcmJ0b25saW5pZW4gbGF1ZmVuIGltXHJcbi8vIEJsYXViZXJlaWNoIChIIDI2MC0yOTApIG1lcmtsaWNoIGFuIGRlciBXYWhybmVobXVuZyB2b3JiZWksIEJsYXUgemllaHQgYmVpbVxyXG4vLyBBdWZoZWxsZW4gaW5zIFZpb2xldHRlLiBSZWNobmVyaXNjaCBibGVpYnQgZGVyIEZhcmJ0b24gZG9ydCBrb25zdGFudCwgd2FzXHJcbi8vIGRhcyBQcm9ibGVtIGVoZXIgdmVyZGVja3QgYWxzIGJlaGVidC4gRWluZSBUWVAtRmFyYmUgaW4gZGllc2VtIEJlcmVpY2ggYWxzb1xyXG4vLyBsaWViZXIgbmFjaHNlaGVuIGFscyBkZW4gWmFobGVuIGdsYXViZW4uXHJcbmZ1bmN0aW9uIGNvbXB1dGVDb2xvck9mZnNldChoZXgsIG9mZnNldCkge1xyXG4gIGNvbnN0IGJhc2UgPSBoZXhUb09rbGNoKGhleCk7XHJcbiAgaWYgKCFiYXNlKSByZXR1cm4gaGV4O1xyXG4gIGNvbnN0IEggPSAoYmFzZS5IICsgKG9mZnNldC5oID8/IDApICsgMzYwKSAlIDM2MDtcclxuICBjb25zdCBiYXNlQ2VpbGluZyA9IG1heENocm9tYShiYXNlLkwsIGJhc2UuSCk7XHJcbiAgLy8gRWluZSBncmF1ZSBUWVAtRmFyYmUgYmxlaWJ0IGdyYXUsIHVuZCBpaHIgRmFyYnRvbiBpc3QgYmVkZXV0dW5nc2xvcyAtIGRhbm5cclxuICAvLyBnaWJ0IGVzIGF1Y2gga2VpbmVuIFNjaGVpdGVsLCBkZW0gZGllIEhlbGxpZ2tlaXQgZm9sZ2VuIGtcdTAwRjZubnRlLlxyXG4gIGNvbnN0IG5ldXRyYWwgPSBiYXNlLkMgPCBORVVUUkFMX0NIUk9NQSB8fCBiYXNlQ2VpbGluZyA8PSAwO1xyXG4gIGNvbnN0IHJlbGF0aXZlID0gbmV1dHJhbCA/IDAgOiBiYXNlLkMgLyBiYXNlQ2VpbGluZztcclxuICBjb25zdCBzaGlmdGVkID0gbmV1dHJhbCA/IGJhc2UuTCA6IHJlbWFwVG9DdXNwKGJhc2UuTCwgYmFzZS5ILCBIKTtcclxuICBjb25zdCBzaGFyZSA9IChvZmZzZXQubCA/PyAwKSAvIDEwMDtcclxuICBjb25zdCBMID0gTWF0aC5taW4oMSwgTWF0aC5tYXgoMCwgc2hpZnRlZCArIHNoYXJlICogKHNoYXJlID49IDAgPyAxIC0gc2hpZnRlZCA6IHNoaWZ0ZWQpKSk7XHJcbiAgY29uc3QgQyA9IHJlbGF0aXZlICogbWF4Q2hyb21hKEwsIEgpOyAvKiAqICgxICsgKG9mZnNldC5zID8/IDApIC8gMTAwKSAtIFNcdTAwRTR0dGlndW5nIHN0aWxsZ2VsZWd0ICovXHJcbiAgcmV0dXJuIG9rbGNoVG9IZXgoeyBMLCBDOiBNYXRoLm1heCgwLCBDKSwgSCB9KTtcclxufVxyXG5cclxuZnVuY3Rpb24gaGFzQ29sb3JPZmZzZXQob2Zmc2V0KSB7XHJcbiAgcmV0dXJuICEhb2Zmc2V0ICYmIFNVQlRZUEVfQ09MT1JfQ0hBTk5FTFMuc29tZSgoeyBrZXkgfSkgPT4gKG9mZnNldFtrZXldID8/IDApICE9PSAwKTtcclxufVxyXG5cclxuLy8gRmFyYmUgZWluZXMgU3VidHlwcyAoYnp3LiBkaWUgZGVzIFRZUHMsIHNvbGFuZ2UgZGVyIFN1YnR5cCBrZWluZSBlaWdlbmVcclxuLy8gRWluc3RlbGx1bmcgaGF0KTsgbnVsbCwgd2VubiBkZXIgVFlQIHNlbGJzdCBrZWluZSBGYXJiZSBoYXQuXHJcbmZ1bmN0aW9uIHN1YnR5cGVDb2xvcihzZXR0aW5ncywgdHlwZSwgc3VidHlwZSkge1xyXG4gIGNvbnN0IHR5cGVDb2xvciA9IHNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV0gPz8gbnVsbDtcclxuICBpZiAoIXR5cGVDb2xvciB8fCAhc3VidHlwZSkgcmV0dXJuIHR5cGVDb2xvcjtcclxuICBjb25zdCBvZmZzZXQgPSBjbGFtcGVkT2Zmc2V0KHNldHRpbmdzLCBnZXRTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKT8uY29sb3IpO1xyXG4gIHJldHVybiBoYXNDb2xvck9mZnNldChvZmZzZXQpID8gYXBwbHlDb2xvck9mZnNldCh0eXBlQ29sb3IsIG9mZnNldCkgOiB0eXBlQ29sb3I7XHJcbn1cclxuXHJcbi8vIEhhdCBkZXIgU3VidHlwIGVpbmUgZWlnZW5lIChpbm5lcmhhbGIgZGVyIEdyZW56ZW4gd2lya3NhbWUpIEFid2VpY2h1bmc/XHJcbmZ1bmN0aW9uIHN1YnR5cGVIYXNPd25Db2xvcihzZXR0aW5ncywgdHlwZSwgc3VidHlwZSkge1xyXG4gIHJldHVybiBoYXNDb2xvck9mZnNldChjbGFtcGVkT2Zmc2V0KHNldHRpbmdzLCBnZXRTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKT8uY29sb3IpKTtcclxufVxyXG5cclxuLy8gRmFyYmUsIGluIGRlciBlaW4gVFlQLSBiencuIFN1YnR5cC1OYW1lIGRhcmdlc3RlbGx0IHdpcmQgLSBnZW1laW5zYW1lXHJcbi8vIEdydW5kbGFnZSBmXHUwMEZDciBkZW4gUGlja2VyIChyZW5kZXJDb2xvcmVkTmFtZS9uYW1lQ29sb3IgaW4gdHlwZS1waWNrZXIuanMpIHVuZFxyXG4vLyBkaWUgU3VidHlwLVZvcnNjaGF1IGRlciBUWVAtTGlzdGUgKHJlbmRlclN1YnR5cGVQcmV2aWV3IGluIHR5cC12aWV3LmpzKSxcclxuLy8gZGFtaXQgYmVpZGUgbmljaHQgYXVzZWluYW5kZXJsYXVmZW4uIE1pdCBzdWJ0eXBlIGRpZSBGYXJiZSBkZXMgU3VidHlwcyxcclxuLy8gYWJlciBudXIgd2VubiBkZXIgVW50ZXItU2NoYWx0ZXIgXCJTdWJ0eXBcIiB2b24gXCJUWVAgVmlld1wiIGRhcyB6dWxcdTAwRTRzc3QgLSBzb25zdFxyXG4vLyBkaWUgZGVzIFRZUHMuIGlzRGVmYXVsdCA9IFN0YW5kYXJkd2VydCwgYWxzbyBob2hsZXIgUmluZyBzdGF0dCBnZWZcdTAwRkNsbHRlbVxyXG4vLyBQdW5rdCAoc2llaGUgcGFpbnRDb2xvckRvdCk6IGVpbiBUWVAgb2huZSBGYXJiZSBncmF1LCBlaW4gU3VidHlwIG9obmUgZWlnZW5lXHJcbi8vIEFid2VpY2h1bmcgaW4gZGVyIFRZUC1GYXJiZSwgZGllIGVyIFx1MDBGQ2Jlcm5pbW10LlxyXG5mdW5jdGlvbiBuYW1lQ29sb3Ioc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUgPSBudWxsKSB7XHJcbiAgY29uc3QgdXNlU3VidHlwZSA9ICEhc3VidHlwZSAmJiBzZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3RTdWJ0eXA7XHJcbiAgY29uc3QgdHlwZUNvbG9yID0gc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXSA/PyBudWxsO1xyXG4gIHJldHVybiB7XHJcbiAgICBjb2xvcjogKHVzZVN1YnR5cGUgPyBzdWJ0eXBlQ29sb3Ioc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpIDogdHlwZUNvbG9yKSA/PyBERUZBVUxUX1RZUEVfQ09MT1IsXHJcbiAgICBpc0RlZmF1bHQ6ICF0eXBlQ29sb3IgfHwgKHVzZVN1YnR5cGUgJiYgIXN1YnR5cGVIYXNPd25Db2xvcihzZXR0aW5ncywgdHlwZSwgc3VidHlwZSkpLFxyXG4gIH07XHJcbn1cclxuXHJcbi8vIEZhcmJwdW5rdCAoVFlQLUxpc3RlLCBEZXRhaWxhbnNpY2h0LCBQaWNrZXIsIEJlc3RcdTAwRTR0aWd1bmdlbik6IGdlZlx1MDBGQ2xsdCBiZWlcclxuLy8gZWluZXIgZWlnZW5lbiBGYXJiZSwgYWxzIGhvaGxlciBSaW5nIGJlaW0gU3RhbmRhcmR3ZXJ0IC0gZWluIFRZUCBvaG5lIEZhcmJlXHJcbi8vIGFscyBncmF1ZXIgUmluZywgZWluIFN1YnR5cCBvaG5lIGVpZ2VuZSBFaW5zdGVsbHVuZyBhbHMgUmluZyBpbiBkZXJcclxuLy8gVFlQLUZhcmJlLCBkaWUgZXIgXHUwMEZDYmVybmltbXQuXHJcbmZ1bmN0aW9uIHBhaW50Q29sb3JEb3QoZWwsIGNvbG9yLCBpc0RlZmF1bHQpIHtcclxuICBlbC5zdHlsZS5iYWNrZ3JvdW5kQ29sb3IgPSBpc0RlZmF1bHQgPyBcInRyYW5zcGFyZW50XCIgOiBjb2xvcjtcclxuICBlbC5zdHlsZS5ib3hTaGFkb3cgPSBpc0RlZmF1bHQgPyBgaW5zZXQgMCAwIDAgbWF4KDEuNXB4LCAwLjE1ZW0pICR7Y29sb3J9YCA6IFwiXCI7XHJcbn1cclxuXHJcbi8vIHZpZXdLZXkgKG9wdGlvbmFsKTogU2NobFx1MDBGQ3NzZWwgZGVyIEFuc2ljaHQgaW4gY29sb3JWaWV3cyAtIGlzdCBkb3J0IGRlclxyXG4vLyBVbnRlci1TY2hhbHRlciBcIjx2aWV3S2V5PlN1YnR5cFwiIGFuLCBnaWx0IGRpZSBGYXJiZSBkZXMgU3VidHlwcyBkZXIgTm90aXpcclxuLy8gc3RhdHQgZGVyIGlocmVzIFRZUHMuXHJcbmZ1bmN0aW9uIGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIHZpZXdLZXkgPSBudWxsKSB7XHJcbiAgY29uc3QgdHlwZSA9IHBsdWdpbi50eXBJbmRleC50eXBlT2YoZmlsZSk7XHJcbiAgaWYgKCF0eXBlKSByZXR1cm4gbnVsbDtcclxuICBjb25zdCB7IHNldHRpbmdzIH0gPSBwbHVnaW47XHJcbiAgaWYgKCF2aWV3S2V5IHx8ICFzZXR0aW5ncy5jb2xvclZpZXdzW2Ake3ZpZXdLZXl9U3VidHlwYF0pIHJldHVybiBzZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdID8/IG51bGw7XHJcbiAgcmV0dXJuIHN1YnR5cGVDb2xvcihzZXR0aW5ncywgdHlwZSwgcGx1Z2luLnR5cEluZGV4LnN1YnR5cGVPZihmaWxlKSk7XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0ge1xyXG4gIGNvbG9yRm9yRmlsZSxcclxuICBuYW1lQ29sb3IsXHJcbiAgREVGQVVMVF9UWVBFX0NPTE9SLFxyXG4gIHN1YnR5cGVDb2xvcixcclxuICBhcHBseUNvbG9yT2Zmc2V0LFxyXG4gIGhhc0NvbG9yT2Zmc2V0LFxyXG4gIHN1YnR5cGVIYXNPd25Db2xvcixcclxuICBwYWludENvbG9yRG90LFxyXG4gIGNvbG9yUmFuZ2UsXHJcbiAgY2hhbm5lbEJvdW5kcyxcclxuICBjbGFtcGVkT2Zmc2V0LFxyXG4gIFNVQlRZUEVfQ09MT1JfQ0hBTk5FTFMsXHJcbiAgREVGQVVMVF9TVUJUWVBFX0NPTE9SX1JBTkdFUyxcclxufTtcclxuIiwgImNvbnN0IHsgUGx1Z2luU2V0dGluZ1RhYiwgU2V0dGluZ0dyb3VwLCBUb2dnbGVDb21wb25lbnQsIERyb3Bkb3duQ29tcG9uZW50LCBkZWJvdW5jZSB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xyXG5jb25zdCB7IG1vdW50R2xvYmFsT3JkZXJFZGl0b3IgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLW9yZGVyLWVkaXRvclwiKTtcclxuY29uc3QgeyBERUZBVUxUX0dMT0JBTF9PUkRFUiB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItc29ydFwiKTtcclxuY29uc3QgeyBTVUJUWVBFX0NPTE9SX0NIQU5ORUxTLCBERUZBVUxUX1NVQlRZUEVfQ09MT1JfUkFOR0VTLCBjb2xvclJhbmdlIH0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcclxuXHJcbmNvbnN0IERFRkFVTFRfU0VUVElOR1MgPSB7XHJcbiAgdHlwZXM6IFtdLFxyXG4gIHR5cGVDb2xvcnM6IHt9LFxyXG4gIHR5cGVEZXNjcmlwdGlvbnM6IHt9LFxyXG4gIHR5cGVEZWZhdWx0RnJvbnRtYXR0ZXI6IHt9LFxyXG4gIC8vIEtleXMgYXVzIHR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV0sIGRpZSBhbHMgXCJGbG9hdGluZyBQcm9wZXJ0eVwiIG1hcmtpZXJ0XHJcbiAgLy8gc2luZCAoc2llaGUgdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMvdHlwLXZpZXcuanMpIC0gVGVpbCBkZXJzZWxiZW4gTGlzdGVcclxuICAvLyB1bmQgUmVpaGVuZm9sZ2Ugd2llIGRpZSBcdTAwRkNicmlnZW4gU3RhbmRhcmQtUHJvcGVydGllcyBkZXMgVHlwcyAod2ljaHRpZyBmXHUwMEZDclxyXG4gIC8vIGRpZSBGcm9udG1hdHRlci1Tb3J0aWVydW5nLCBzaWVoZSBvcmRlcmVkRGVmYXVsdEtleXMgaW4gZnJvbnRtYXR0ZXItc29ydC5qcyksXHJcbiAgLy8gYWJlciBOSUNIVCBUZWlsIGRlcyB2b24gZ2V0VHlwZURlZmF1bHRzKCkgKG1haW4uanMpIHN0YW5kYXJkbVx1MDBFNFx1MDBERmlnXHJcbiAgLy8gZ2VsaWVmZXJ0ZW4gRnJvbnRtYXR0ZXJzIC0gVGVtcGxhdGVyIGxlZ3Qgc2llIGJlaW0gQW5sZWdlbiBlaW5lciBOb3RpeiBhbHNvXHJcbiAgLy8gbmljaHQgYXV0b21hdGlzY2ggYW4gKG51ciBcdTAwRkNiZXIgZGVuIGV4cGxpeml0ZW4gaW5jbHVkZUZsb2F0aW5nLVBhcmFtZXRlcikuXHJcbiAgdHlwZUZsb2F0aW5nS2V5czoge30sXHJcbiAgLy8gU2hvcnRjdXRzIGplIEtleSBhdXMgdHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXTpcclxuICAvLyAgIHsgW1RZUF06IHsgW1Byb3BlcnR5XTogeyBuYW1lOiBcInRvZGF5XCIgfCBcInRwLjxTa3JpcHRuYW1lPlwiIH0gfSB9XHJcbiAgLy8gQmV3dXNzdCBORUJFTiBkZW0gRnJvbnRtYXR0ZXIgc3RhdHQgYWxzIGRlc3NlbiBXZXJ0IC0gc2llaGUgZGllIEJlZ3JcdTAwRkNuZHVuZ1xyXG4gIC8vIGluIHNob3J0Y3V0cy5qcy4gRGVyIFdlcnQgZGVyIFByb3BlcnR5IGJsZWlidCBkYWR1cmNoIHR5cHJlaW4gKE9ic2lkaWFuc1xyXG4gIC8vIG5hdGl2ZXMgV2lkZ2V0IGJsZWlidCB1bmFuZ2V0YXN0ZXQpIHVuZCBkaWVudCBiZWkgZ2VzZXR6dGVtIFNob3J0Y3V0IGFsc1xyXG4gIC8vIFJcdTAwRkNja2ZhbGx3ZXJ0LCBmYWxscyBkZXNzZW4gVGVtcGxhdGVyLVNrcmlwdCBmZWhsc2NobFx1MDBFNGd0LlxyXG4gIHR5cGVTaG9ydGN1dHM6IHt9LFxyXG4gIHR5cGVNYW51YWw6IHt9LFxyXG4gIC8vIFJlZ2lzdHJpZXJ0ZSBTdWJ0eXBlbiBqZSBUWVAgc2FtdCBlaWdlbmVtIEZyb250bWF0dGVyLUJsb2NrLCBzaWVoZSBzdWJ0eXBlcy5qcy5cclxuICB0eXBlU3VidHlwZXM6IHt9LFxyXG4gIC8vIFNpZWhlIGZyb250bWF0dGVyLW9yZGVyLWVkaXRvci5qcyAvIGZyb250bWF0dGVyLXNvcnQuanM6IFJlaWhlbmZvbGdlIGF1c1xyXG4gIC8vIGZlc3QgcG9zaXRpb25pZXJ0ZW4gRWluemVsLVByb3BlcnRpZXMgKGtpbmQ6IFwicHJvcGVydHlcIikgc293aWUgZGVuIHZpZXJcclxuICAvLyBuaWNodCBlbnRmZXJuYmFyZW4gUGxhdHpoYWx0ZXJuIFwidHlwVmFsdWVcIiAoVFlQLVByb3BlcnR5IHNlbGJzdCksXHJcbiAgLy8gXCJzdWJ0eXBWYWx1ZVwiIChTVUJUWVAtUHJvcGVydHkgc2VsYnN0KSwgXCJ0eXBcIiAoU3RhbmRhcmRsaXN0ZSBkZXMgVHlwcylcclxuICAvLyB1bmQgXCJvdGhlclwiIChhbGxlcyBcdTAwRENicmlnZSkuXHJcbiAgZ2xvYmFsUHJvcGVydHlPcmRlcjogREVGQVVMVF9HTE9CQUxfT1JERVIsXHJcbiAgLy8gU2llaGUgYWN0aXZlLXRpdGxlLWNvbG9ycy5qczogd2llIGRlciBUWVAgaW4gZGVyIGdlXHUwMEY2ZmZuZXRlbiBOb3RpeiBtYXJraWVydFxyXG4gIC8vIHdpcmQgLSBcIm5vbmVcIiAobmljaHRzKSwgXCJkb3RcIiAoRmFyYnB1bmt0IGFtIFRpdGVsKSBvZGVyIFwiYmFkZ2VcIiAoQm94IG1pdFxyXG4gIC8vIFRZUC1OYW1lbiwgd2VpdGVyIGtvbmZpZ3VyaWVydCBcdTAwRkNiZXIgZGllIGRyZWkgZm9sZ2VuZGVuIEVpbnN0ZWxsdW5nZW4sIGRpZVxyXG4gIC8vIG51ciBiZWkgXCJiYWRnZVwiIFx1MDBGQ2JlcmhhdXB0IGVpbmUgUm9sbGUgc3BpZWxlbiBiencuIGluIGRlbiBFaW5zdGVsbHVuZ2VuXHJcbiAgLy8gYW5nZXplaWd0IHdlcmRlbikuIFVuYWJoXHUwMEU0bmdpZyBkYXZvbiB1bmQgYmVsaWViaWcga29tYmluaWVyYmFyOlxyXG4gIC8vIGNvbG9yVmlld3Mubm90ZVRpdGxlQ29sb3IgZlx1MDBFNHJidCBkZW4gVGl0ZWx0ZXh0IHNlbGJzdCBlaW4uXHJcbiAgbm90ZVRpdGxlU3R5bGU6IFwiZG90XCIsXHJcbiAgLy8gTnVyIHJlbGV2YW50IGJlaSBub3RlVGl0bGVTdHlsZTogXCJiYWRnZVwiIC0gb2IgZGllIEJveCBmYXJiaWcgKFRZUC1GYXJiZSlcclxuICAvLyBvZGVyIG5ldXRyYWwgKHRleHQtbXV0ZWQpIGRhcmdlc3RlbGx0IHdpcmQuXHJcbiAgbm90ZVRpdGxlQmFkZ2VDb2xvcmVkOiB0cnVlLFxyXG4gIC8vIE51ciByZWxldmFudCBiZWkgbm90ZVRpdGxlU3R5bGU6IFwiYmFkZ2VcIiAtIEJlc2NocmlmdHVuZyBkZXIgQm94OiBcInR5cGVcIlxyXG4gIC8vIChbVFlQXSksIFwidHlwZS1zdWJ0eXBlXCIgKFtUWVAvU3VidHlwXSkgb2RlciBcInN1YnR5cGVcIiAoW1N1YnR5cF0sIGJlaVxyXG4gIC8vIE5vdGl6ZW4gb2huZSBTdWJ0eXAga2VpbmUgQm94KS4gRmFyYmUgKG1pdCBub3RlVGl0bGVCYWRnZUNvbG9yZWQpXHJcbiAgLy8gZW50c3ByZWNoZW5kIGRpZSBkZXMgVFlQcyBiencuIGRlcyBTdWJ0eXBzIC0gYmVpIFwidHlwZS1zdWJ0eXBlXCIgd1x1MDBFNGhsYmFyXHJcbiAgLy8gXHUwMEZDYmVyIGNvbG9yVmlld3Mubm90ZVRpdGxlTWFya2VyU3VidHlwIChcIlN1YnR5cC1GYXJiZVwiKS5cclxuICBub3RlVGl0bGVCYWRnZUxhYmVsOiBcInR5cGVcIixcclxuICAvLyBOdXIgcmVsZXZhbnQgYmVpIG5vdGVUaXRsZVN0eWxlOiBcImJhZGdlXCIgLSBcInRpdGxlXCIgKG5lYmVuIGRlbSBJbmxpbmUtVGl0ZWwsXHJcbiAgLy8gbm9ybWFsZSBBdXNyaWNodHVuZykgb2RlciBcImJsb2NrXCIgKGxpbmtzIGFtIFByb3BlcnR5LUJsb2NrLCB1bSA5MFx1MDBCMCBnZWRyZWh0KS5cclxuICBub3RlVGl0bGVCYWRnZVBvc2l0aW9uOiBcInRpdGxlXCIsXHJcbiAgLy8gTnVyIHJlbGV2YW50IGJlaSBub3RlVGl0bGVCYWRnZVBvc2l0aW9uOiBcImJsb2NrXCIgLSBvYiBkaWUgZ2VkcmVodGUgQm94IGFtXHJcbiAgLy8gb2JlcmVuIG9kZXIgdW50ZXJlbiBSYW5kIGRlcyBQcm9wZXJ0eS1CbG9ja3Mgc2l0enQuXHJcbiAgbm90ZVRpdGxlVmVydGljYWxBbGlnbjogXCJ0b3BcIixcclxuICB0eXBTb3J0T3JkZXI6IFwiY291bnQtZGVzY1wiLFxyXG4gIC8vIFdhcyBpbiBkZXIgVFlQLUxpc3RlIHJlY2h0cyBuZWJlbiBkZW0gTmFtZW4gc3RlaHQgLSBcImRlc2NyaXB0aW9uXCIsXHJcbiAgLy8gXCJzdWJ0eXBlc1wiIG9kZXIgXCJub25lXCIuIFVtZ2VzY2hhbHRldCB3aXJkIGRhcyBuaWNodCBoaWVyLCBzb25kZXJuIFx1MDBGQ2JlciBkZW5cclxuICAvLyBLbm9wZiBpbSBMaXN0ZW4tSGVhZGVyIG5lYmVuIGRlciBTb3J0aWVydW5nIChzaWVoZSBTRUNPTkRBUllfTU9ERVMgaW5cclxuICAvLyB0eXAtdmlldy5qcyksIHdpZSBzY2hvbiBkaWUgU29ydGllcnJlaWhlbmZvbGdlOiBiZWlkZXMgYmV0cmlmZnQgbnVyIGRhc1xyXG4gIC8vIEF1c3NlaGVuIGRpZXNlciBlaW5lbiBMaXN0ZSB1bmQgZ2VoXHUwMEY2cnQgZGFoZXIgYW4gc2llIHNlbGJzdCwgbmljaHQgaW4gZWluZVxyXG4gIC8vIEVpbnN0ZWxsdW5nc3NlaXRlLCBkaWUgbWFuIGRhZlx1MDBGQ3IgamVkZXMgTWFsIFx1MDBGNmZmbmVuIG1cdTAwRkNzc3RlLlxyXG4gIHR5cExpc3RTZWNvbmRhcnk6IFwic3VidHlwZXNcIixcclxuICAvLyBTaWVoZSBwaWNrVHlwZUFuZFN1YnR5cGUgaW4gdHlwZS1waWNrZXIuanM6IGZhbHNlID0gU3VidHlwZW4gZWluZ2VyXHUwMEZDY2t0XHJcbiAgLy8gZGlyZWt0IGltIFRZUC1QaWNrZXIsIHRydWUgPSBlaWdlbmVyIFN1YnR5cC1QaWNrZXIgbmFjaCBkZXIgVFlQLUF1c3dhaGwuXHJcbiAgc2VwYXJhdGVTdWJ0eXBlUGlja2VyOiBmYWxzZSxcclxuICBpbmNsdWRlSWdub3JlZEZpbGVzOiBmYWxzZSxcclxuICAvLyBFaWdlbmUgVGFnLS9BbmhcdTAwRTRuZ2UtRmFyYmUgaW0gR3JhcGggZGVha3RpdmllcnQgKDMwLjA5LjIwMjYpOiBiZWlkZXMgaXN0IGluXHJcbiAgLy8gZGVuIFN0eWxlIFNldHRpbmdzIGRlcyBNaW5pbWFsIFRoZW1lIGVpbnN0ZWxsYmFyLCBzaWVoZSBncmFwaC1jb2xvcnMuanMuXHJcbiAgLy8gZ3JhcGhUYWdDb2xvckVuYWJsZWQ6IGZhbHNlLFxyXG4gIC8vIGdyYXBoVGFnQ29sb3I6IFwiXCIsXHJcbiAgLy8gZ3JhcGhBdHRhY2htZW50Q29sb3JFbmFibGVkOiBmYWxzZSxcclxuICAvLyBncmFwaEF0dGFjaG1lbnRDb2xvcjogXCJcIixcclxuICAvLyBXaWUgd2VpdCBkaWUgRmFyYmUgZWluZXMgU3VidHlwcyBoXHUwMEY2Y2hzdGVucyB2b24gZGVyIHNlaW5lcyBUWVBzIGFid2VpY2hlblxyXG4gIC8vIGRhcmYgKFx1MDBCMSksIHNpZWhlIHR5cGUtY29sb3JzLmpzOiBGYXJidG9uIGluIEdyYWQsIEhlbGxpZ2tlaXQgaW4gJSBkZXMgV2Vnc1xyXG4gIC8vIHp1IFdlaVx1MDBERiBiencuIFNjaHdhcnouXHJcbiAgc3VidHlwZUNvbG9yUmFuZ2VzOiB7IC4uLkRFRkFVTFRfU1VCVFlQRV9DT0xPUl9SQU5HRVMgfSxcclxuICBjb2xvclZpZXdzOiB7XHJcbiAgICBmaWxlRXhwbG9yZXI6IHRydWUsXHJcbiAgICBncmFwaDogdHJ1ZSxcclxuICAgIHNlYXJjaDogdHJ1ZSxcclxuICAgIHJlY2VudEZpbGVzOiB0cnVlLFxyXG4gICAgYmFja2xpbmtzOiB0cnVlLFxyXG4gICAgYm9va21hcmtzOiB0cnVlLFxyXG4gICAgLy8gVW50ZXItU2NoYWx0ZXIgXCI8QW5zaWNodD5TdWJ0eXBcIiBkZXIgRWluZlx1MDBFNHJidW5nZW46IEZhcmJlIGRlcyBTdWJ0eXBzXHJcbiAgICAvLyBlaW5lciBOb3RpeiBzdGF0dCBkZXIgaWhyZXMgVFlQcyAoc2llaGUgY29sb3JGb3JGaWxlIGluIHR5cGUtY29sb3JzLmpzKS5cclxuICAgIGZpbGVFeHBsb3JlclN1YnR5cDogdHJ1ZSxcclxuICAgIGdyYXBoU3VidHlwOiB0cnVlLFxyXG4gICAgc2VhcmNoU3VidHlwOiB0cnVlLFxyXG4gICAgcmVjZW50RmlsZXNTdWJ0eXA6IHRydWUsXHJcbiAgICBiYWNrbGlua3NTdWJ0eXA6IHRydWUsXHJcbiAgICBib29rbWFya3NTdWJ0eXA6IHRydWUsXHJcbiAgICBsaW5rc1N1YnR5cDogdHJ1ZSxcclxuICAgIHR5cExpc3RTdWJ0eXA6IHRydWUsXHJcbiAgICBub3RlVGl0bGVDb2xvclN1YnR5cDogdHJ1ZSxcclxuICAgIG5vdGVUaXRsZU1hcmtlclN1YnR5cDogdHJ1ZSxcclxuICAgIGZyb250bWF0dGVyRGVmYXVsdHM6IHRydWUsXHJcbiAgICAvLyBVbnRlci1TY2hhbHRlciB6dSBmcm9udG1hdHRlckRlZmF1bHRzIGJ6dy4gYWxsUHJvcGVydGllczogYmV6aWVodCBkaWVcclxuICAgIC8vIEZyb250bWF0dGVyLUJsXHUwMEY2Y2tlIGRlciBTdWJ0eXBlbiBtaXQgZWluIChzaWVoZVxyXG4gICAgLy8gZnJvbnRtYXR0ZXItZGVmYXVsdC1oaWdobGlnaHQuanMpIC0gYmVpIGFsbFByb3BlcnRpZXMgenVnbGVpY2ggaW4gZGVyXHJcbiAgICAvLyBGYXJiZSBkZXMgamV3ZWlsaWdlbiBTdWJ0eXBzLlxyXG4gICAgZnJvbnRtYXR0ZXJEZWZhdWx0c1N1YnR5cDogdHJ1ZSxcclxuICAgIHR5cExpc3Q6IHRydWUsXHJcbiAgICBhbGxQcm9wZXJ0aWVzOiB0cnVlLFxyXG4gICAgYWxsUHJvcGVydGllc1N1YnR5cDogdHJ1ZSxcclxuICAgIG5vdGVUaXRsZUNvbG9yOiB0cnVlLFxyXG4gICAgbGlua3M6IHRydWUsXHJcbiAgfSxcclxufTtcclxuXHJcbmNsYXNzIFR5cFN5c3RlbVNldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcclxuICBjb25zdHJ1Y3RvcihhcHAsIHBsdWdpbikge1xyXG4gICAgc3VwZXIoYXBwLCBwbHVnaW4pO1xyXG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XHJcbiAgfVxyXG5cclxuICAvLyBKZWRlciBBYnNjaG5pdHQgaXN0IGVpbmUgU2V0dGluZ0dyb3VwIC0gT2JzaWRpYW5zIGVpZ2VuZSBHcnVwcGllcnVuZ1xyXG4gIC8vIChcdTAwRENiZXJzY2hyaWZ0ICsgZWluZSBCb3gsIEVpbnRyXHUwMEU0Z2UgZGFyaW4gZHVyY2ggVHJlbm5saW5pZW4gZ2V0cmVubnQpLCB3aWVcclxuICAvLyBpbiBkZW4gQ29yZS1FaW5zdGVsbHVuZ2VuLiBFaW56ZWxuIHBlciBuZXcgU2V0dGluZyhjb250YWluZXJFbCkgYW5nZWxlZ3RlXHJcbiAgLy8gRWludHJcdTAwRTRnZSB3XHUwMEZDcmRlbiBzdGF0dGRlc3NlbiBqZSBhbHMgZWlnZW5lIGtsZWluZSBCb3ggZ2VyZW5kZXJ0LlxyXG4gIGRpc3BsYXkoKSB7XHJcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xyXG4gICAgLy8gU2Nyb2xsLVBvc2l0aW9uIFx1MDBGQ2JlciBkZW4gTmV1YXVmYmF1IHJldHRlbiAoZGlzcGxheSgpIHdpcmQgYXVjaCB2b25cclxuICAgIC8vIFNjaGFsdGVybiBtaXQgVW50ZXItT3B0aW9uZW4gYXVmZ2VydWZlbik6IGRhcyBEcm9wZG93biBkZXJcclxuICAgIC8vIFRZUC1NYXJraWVydW5nIG1pc3N0IHNpY2ggYmVpbSBzZXRWYWx1ZSgpIChyZXNpemVUb0ZpdCBsaWVzdFxyXG4gICAgLy8gb2Zmc2V0V2lkdGgpIHVuZCBlcnp3aW5ndCBzbyBlaW4gTGF5b3V0LCBzb2xhbmdlIGRpZSBTZWl0ZSBlcnN0IGJpc1xyXG4gICAgLy8gZG9ydGhpbiBhdWZnZWJhdXQgaXN0IC0gZGVyIEJyb3dzZXIga2FwcHQgc2Nyb2xsVG9wIGRhbm4gYXVmIGRpZXNlXHJcbiAgICAvLyBUZWlsaFx1MDBGNmhlLCBkaWUgQW5zaWNodCBzcHJcdTAwRTRuZ2UgbmFjaCBvYmVuLlxyXG4gICAgY29uc3QgeyBzY3JvbGxUb3AgfSA9IGNvbnRhaW5lckVsO1xyXG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcclxuXHJcbiAgICBuZXcgU2V0dGluZ0dyb3VwKGNvbnRhaW5lckVsKVxyXG4gICAgICAuc2V0SGVhZGluZyhcIlRZUC1MaXN0ZVwiKVxyXG4gICAgICAuYWRkU2V0dGluZygoc2V0dGluZykgPT5cclxuICAgICAgICBzZXR0aW5nXHJcbiAgICAgICAgICAuc2V0TmFtZShcIklnbm9yaWVydGUgTm90aXplbiBJTU1FUiBiZXJcdTAwRkNja3NpY2h0aWdlblwiKVxyXG4gICAgICAgICAgLnNldERlc2MoXHJcbiAgICAgICAgICAgIFwiQmV6aWVodCBOb3RpemVuIGF1cyBPYnNpZGlhbnMgXFxcIkV4Y2x1ZGVkIGZpbGVzXFxcIi1MaXN0ZSAoZG9ydCB0cmFnZW4gYXVjaCBQbHVnaW5zIHdpZSBIaWRlIEZvbGRlcnMgYXVzZ2VibGVuZGV0ZSBPcmRuZXIgZWluKSB3aWVkZXIgaW4gVFlQLVpcdTAwRTRobGVyLCBUWVAtUGlja2VyIHVuZCBkaWUgRnJvbnRtYXR0ZXItU29ydGllcnVuZyBtaXQgZWluLCBzdGF0dCBzaWUgenUgXHUwMEZDYmVyc3ByaW5nZW4uXCJcclxuICAgICAgICAgIClcclxuICAgICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cclxuICAgICAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXMpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXMgPSB2YWx1ZTtcclxuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgICAgICAgICAgfSlcclxuICAgICAgICAgIClcclxuICAgICAgKTtcclxuXHJcbiAgICBuZXcgU2V0dGluZ0dyb3VwKGNvbnRhaW5lckVsKS5zZXRIZWFkaW5nKFwiVFlQLVBpY2tlclwiKS5hZGRTZXR0aW5nKChzZXR0aW5nKSA9PlxyXG4gICAgICBzZXR0aW5nXHJcbiAgICAgICAgLnNldE5hbWUoXCJTdWJ0eXAtUGlja2VyIHNlcGFyYXRcIilcclxuICAgICAgICAuc2V0RGVzYyhcclxuICAgICAgICAgIFwiQmVpbSBBbmxlZ2VuIGVpbmVyIE5vdGl6IGZvbGd0IGF1ZiBkZW4gVFlQLVBpY2tlciBlaW4gZWlnZW5lciBTdWJ0eXAtUGlja2VyIChFU0MgZG9ydCBmXHUwMEZDaHJ0IHp1clx1MDBGQ2NrIHp1ciBUWVAtQXVzd2FobCksIHN0YXR0IGRpZSBTdWJ0eXBlbiBkaXJla3QgZWluZ2VyXHUwMEZDY2t0IHVudGVyIGlocmVtIFRZUCBpbSBUWVAtUGlja2VyIGFuenV6ZWlnZW4uIERlciBUWVAtUGlja2VyIG5lbm50IGRpZSBTdWJ0eXBlbiBkYW5uIGhpbnRlciBkZW0gVFlQLU5hbWVuLlwiXHJcbiAgICAgICAgKVxyXG4gICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cclxuICAgICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5zZXBhcmF0ZVN1YnR5cGVQaWNrZXIpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5zZXBhcmF0ZVN1YnR5cGVQaWNrZXIgPSB2YWx1ZTtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgICB9KVxyXG4gICAgICAgIClcclxuICAgICk7XHJcblxyXG4gICAgLy8gc3VidHlwS2V5IChvcHRpb25hbCk6IHN0YXR0IGVpbmVzIGVpbnplbG5lbiBTY2hhbHRlcnMgendlaSBiZXNjaHJpZnRldGVcclxuICAgIC8vIHVudGVyZWluYW5kZXIgKHdpZSBkaWUgVW50ZXItU2NoYWx0ZXIgYmVpIFwiQm94IG1pdCBUWVAtTmFtZW5cIiwgc2llaGVcclxuICAgIC8vIHVudGVuKSAtIFwiVFlQXCIgZlx1MDBGQ3IgZGVuIGVpZ2VudGxpY2hlbiBTY2hhbHRlciwgZGFydW50ZXIgXCJTdWJ0eXBcIiwgbnVyXHJcbiAgICAvLyBzaWNodGJhciwgc29sYW5nZSBcIlRZUFwiIGFuIGlzdC4gRGllIFRvb2x0aXBzIHBhc3NlbiBzdGFuZGFyZG1cdTAwRTRcdTAwREZpZyB6dSBkZW5cclxuICAgIC8vIEVpbmZcdTAwRTRyYnVuZ2VuIChTdWJ0eXAgPSBGYXJiZSBkZXMgU3VidHlwcyBzdGF0dCBkZXIgZGVzIFRZUHMpLlxyXG4gICAgY29uc3QgY29sb3JWaWV3VG9nZ2xlID0gKFxyXG4gICAgICBncm91cCxcclxuICAgICAga2V5LFxyXG4gICAgICBuYW1lLFxyXG4gICAgICBkZXNjLFxyXG4gICAgICBzdWJ0eXBLZXkgPSBudWxsLFxyXG4gICAgICB7IHR5cFRvb2x0aXAgPSBcIk5hY2ggVFlQLUZhcmJlIGVpbmZcdTAwRTRyYmVuXCIsIHN1YnR5cFRvb2x0aXAgPSBcIkZhcmJlIGRlcyBTdWJ0eXBzIHN0YXR0IGRlciBkZXMgVFlQcyB2ZXJ3ZW5kZW5cIiB9ID0ge31cclxuICAgICkgPT5cclxuICAgICAgZ3JvdXAuYWRkU2V0dGluZygoc2V0dGluZykgPT4ge1xyXG4gICAgICAgIHNldHRpbmcuc2V0TmFtZShuYW1lKS5zZXREZXNjKGRlc2MpO1xyXG4gICAgICAgIGNvbnN0IHNhdmUgPSBhc3luYyAoc2V0dGluZ0tleSwgdmFsdWUpID0+IHtcclxuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Nbc2V0dGluZ0tleV0gPSB2YWx1ZTtcclxuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgaWYgKCFzdWJ0eXBLZXkpIHtcclxuICAgICAgICAgIHNldHRpbmcuYWRkVG9nZ2xlKCh0b2dnbGUpID0+IHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzW2tleV0pLm9uQ2hhbmdlKCh2YWx1ZSkgPT4gc2F2ZShrZXksIHZhbHVlKSkpO1xyXG4gICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgc2V0dGluZy5zZXR0aW5nRWwuYWRkQ2xhc3MoXCJmcmVkLW5vdGUtdGl0bGUtc2V0dGluZ1wiKTtcclxuICAgICAgICBjb25zdCBhZGRSb3cgPSAobGFiZWwsIHRvb2x0aXAsIHNldHRpbmdLZXksIG9uQ2hhbmdlZCkgPT4ge1xyXG4gICAgICAgICAgY29uc3Qgcm93ID0gc2V0dGluZy5jb250cm9sRWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtbm90ZS10aXRsZS10b2dnbGUtcm93XCIgfSk7XHJcbiAgICAgICAgICByb3cuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLW5vdGUtdGl0bGUtdG9nZ2xlLWxhYmVsXCIsIHRleHQ6IGxhYmVsIH0pO1xyXG4gICAgICAgICAgbmV3IFRvZ2dsZUNvbXBvbmVudChyb3cpXHJcbiAgICAgICAgICAgIC5zZXRUb29sdGlwKHRvb2x0aXApXHJcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzW3NldHRpbmdLZXldKVxyXG4gICAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgICAgICAgYXdhaXQgc2F2ZShzZXR0aW5nS2V5LCB2YWx1ZSk7XHJcbiAgICAgICAgICAgICAgb25DaGFuZ2VkPy4oKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfTtcclxuICAgICAgICBhZGRSb3coXCJUWVBcIiwgdHlwVG9vbHRpcCwga2V5LCAoKSA9PiB0aGlzLmRpc3BsYXkoKSk7XHJcbiAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Nba2V5XSkgYWRkUm93KFwiU3VidHlwXCIsIHN1YnR5cFRvb2x0aXAsIHN1YnR5cEtleSk7XHJcbiAgICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGNvbG9yaW5nR3JvdXAgPSBuZXcgU2V0dGluZ0dyb3VwKGNvbnRhaW5lckVsKS5zZXRIZWFkaW5nKFwiRWluZlx1MDBFNHJidW5nXCIpO1xyXG5cclxuICAgIGNvbG9yVmlld1RvZ2dsZShjb2xvcmluZ0dyb3VwLCBcImZpbGVFeHBsb3JlclwiLCBcIkRhdGVpLUV4cGxvcmVyXCIsIFwiTm90aXpuYW1lbiBpbSBEYXRlaS1FeHBsb3JlciBuYWNoIFRZUCBlaW5mXHUwMEU0cmJlbi5cIiwgXCJmaWxlRXhwbG9yZXJTdWJ0eXBcIik7XHJcbiAgICBjb2xvclZpZXdUb2dnbGUoY29sb3JpbmdHcm91cCwgXCJncmFwaFwiLCBcIkdyYXBoXCIsIFwiS25vdGVuIGltIEdyYXBoIChnbG9iYWwgdW5kIGxva2FsKSBuYWNoIFRZUCBlaW5mXHUwMEU0cmJlbi5cIiwgXCJncmFwaFN1YnR5cFwiKTtcclxuICAgIGNvbG9yVmlld1RvZ2dsZShjb2xvcmluZ0dyb3VwLCBcInNlYXJjaFwiLCBcIlN1Y2hlXCIsIFwiVHJlZmZlci1UaXRlbCBpbiBkZXIgU3VjaGUgbmFjaCBUWVAgZWluZlx1MDBFNHJiZW4uXCIsIFwic2VhcmNoU3VidHlwXCIpO1xyXG4gICAgY29sb3JWaWV3VG9nZ2xlKGNvbG9yaW5nR3JvdXAsIFwicmVjZW50RmlsZXNcIiwgXCJSZWNlbnQgRmlsZXNcIiwgXCJFaW50clx1MDBFNGdlIGltIFJlY2VudC1GaWxlcy1QbHVnaW4gbmFjaCBUWVAgZWluZlx1MDBFNHJiZW4uXCIsIFwicmVjZW50RmlsZXNTdWJ0eXBcIik7XHJcbiAgICBjb2xvclZpZXdUb2dnbGUoXHJcbiAgICAgIGNvbG9yaW5nR3JvdXAsXHJcbiAgICAgIFwibGlua3NcIixcclxuICAgICAgXCJMaW5rcyBpbiBOb3RpemVuXCIsXHJcbiAgICAgIFwiSW50ZXJuZSBMaW5rcyBpbSBOb3RpenRleHQgKExlc2UtTW9kdXMsIExpdmUgUHJldmlldywgSG92ZXItVm9yc2NoYXUpIGluIGRlciBGYXJiZSBkZXMgVFlQcyBpaHJlcyBaaWVscyBkYXJzdGVsbGVuLiBOaWNodCBhdWZnZWxcdTAwRjZzdGUgTGlua3MgYmxlaWJlbiB1bnZlclx1MDBFNG5kZXJ0LlwiLFxyXG4gICAgICBcImxpbmtzU3VidHlwXCJcclxuICAgICk7XHJcbiAgICBjb2xvclZpZXdUb2dnbGUoXHJcbiAgICAgIGNvbG9yaW5nR3JvdXAsXHJcbiAgICAgIFwidHlwTGlzdFwiLFxyXG4gICAgICBcIlRZUCBWaWV3XCIsXHJcbiAgICAgIFwiVHlwLU5hbWVuIGluIGRlciBUWVAtVmlldyBzZWxic3QgKExpc3RlIHVuZCBEZXRhaWxhbnNpY2h0KSB1bmQgaW0gVFlQLVBpY2tlciBpbiBpaHJlciBqZXdlaWxpZ2VuIEZhcmJlIGRhcnN0ZWxsZW4uIE1pdCBcXFwiU3VidHlwXFxcIiBhdWNoIGRpZSBTdWJ0eXBlbiBpbiBpaHJlciBlaWdlbmVuIEZhcmJlLlwiLFxyXG4gICAgICBcInR5cExpc3RTdWJ0eXBcIlxyXG4gICAgKTtcclxuICAgIGNvbG9yVmlld1RvZ2dsZShcclxuICAgICAgY29sb3JpbmdHcm91cCxcclxuICAgICAgXCJub3RlVGl0bGVDb2xvclwiLFxyXG4gICAgICBcIlRpdGVsLVRleHQgZWluZlx1MDBFNHJiZW5cIixcclxuICAgICAgXCJGXHUwMEU0cmJ0IGRlbiBJbmxpbmUtVGl0ZWwgZGVyIGdlXHUwMEY2ZmZuZXRlbiBOb3RpeiBzZWxic3QgaW4gZGVyIEZhcmJlIGlocmVzIFRZUHMgZWluIC0gdW5hYmhcdTAwRTRuZ2lnIHZvbiBkZXIgVFlQLU1hcmtpZXJ1bmcgZGFuZWJlbiAocy4gdS4pLCBiZWlkZXMgbFx1MDBFNHNzdCBzaWNoIGtvbWJpbmllcmVuLlwiLFxyXG4gICAgICBcIm5vdGVUaXRsZUNvbG9yU3VidHlwXCJcclxuICAgICk7XHJcblxyXG4gICAgLy8gUHJvZ3Jlc3NpdmUgT2ZmZW5sZWd1bmc6IGJlaSBub3RlVGl0bGVTdHlsZSBcImJhZGdlXCIga29tbWVuIHdlaXRlcmVcclxuICAgIC8vIFNjaGFsdGVyIGRpcmVrdCBpbiBkaWVzZXIgZWluZW4gU2V0dGluZy1aZWlsZSBkYXp1IChGYXJiZSwgUG9zaXRpb24pLFxyXG4gICAgLy8gYmVpIFBvc2l0aW9uIFwiYmxvY2tcIiBub2NoIGVpbiBkcml0dGVyIChBdXNyaWNodHVuZykgLSBqZXdlaWxzIHBlclxyXG4gICAgLy8gdGhpcy5kaXNwbGF5KCkgbmV1IGdlcmVuZGVydCwgZGFtaXQgbnVyIGRpZSBnZXJhZGUgcmVsZXZhbnRlbiBTY2hhbHRlclxyXG4gICAgLy8gZXJzY2hlaW5lbiwgc3RhdHQgcGVybWFuZW50IGFsbGUgYW56dXplaWdlbiBiencuIGVpZ2VuZSBaZWlsZW4genUgYmVsZWdlbi5cclxuICAgIGNvbnN0IGlzQmFkZ2UgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVTdHlsZSA9PT0gXCJiYWRnZVwiO1xyXG4gICAgY29uc3QgaXNCbG9ja1Bvc2l0aW9uID0gdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VQb3NpdGlvbiA9PT0gXCJibG9ja1wiO1xyXG5cclxuICAgIGNvbG9yaW5nR3JvdXAuYWRkU2V0dGluZygobm90ZVRpdGxlU2V0dGluZykgPT4ge1xyXG4gICAgICBub3RlVGl0bGVTZXR0aW5nXHJcbiAgICAgICAgLnNldE5hbWUoXCJUWVAtTWFya2llcnVuZyBpbiBkZXIgTm90aXpcIilcclxuICAgICAgICAuc2V0RGVzYyhcclxuICAgICAgICAgIGlzQmFkZ2VcclxuICAgICAgICAgICAgPyAnXCJCb3ggbWl0IFRZUC1OYW1lblwiIC0gQmVzY2hyaWZ0dW5nLCBTY2hhbHRlcjogZmFyYmlnL25ldXRyYWwsIGFtIFRpdGVsL2FtIFByb3BlcnR5LUJsb2NrIChnZWRyZWh0KScgK1xyXG4gICAgICAgICAgICAgICAgKGlzQmxvY2tQb3NpdGlvbiA/IFwiLCBvYmVuL3VudGVuIGFtIFByb3BlcnR5LUJsb2NrXCIgOiBcIlwiKSArXHJcbiAgICAgICAgICAgICAgICBcIi5cIlxyXG4gICAgICAgICAgICA6IFwiV2llIGRlciBUWVAgaW4gZGVyIGdlXHUwMEY2ZmZuZXRlbiBOb3RpeiBtYXJraWVydCB3aXJkLlwiXHJcbiAgICAgICAgKVxyXG4gICAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+XHJcbiAgICAgICAgICBkcm9wZG93blxyXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwibm9uZVwiLCBcIk5pY2h0c1wiKVxyXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwiZG90XCIsIFwiRmFyYnB1bmt0IGFtIFRpdGVsXCIpXHJcbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJiYWRnZVwiLCBcIkJveCBtaXQgVFlQLU5hbWVuXCIpXHJcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVTdHlsZSlcclxuICAgICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVN0eWxlID0gdmFsdWU7XHJcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbiAgICAgICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XHJcbiAgICAgICAgICAgIH0pXHJcbiAgICAgICAgKTtcclxuXHJcbiAgICAgIC8vIFwiU3VidHlwXCIgKEZhcmJlIGRlcyBTdWJ0eXBzIHN0YXR0IGRlciBkZXMgVFlQcykgbnVyLCBzb2xhbmdlIGRpZVxyXG4gICAgICAvLyBNYXJraWVydW5nIFx1MDBGQ2JlcmhhdXB0IGZhcmJpZyBpc3Q6IGJlaW0gUHVua3QgaW1tZXIsIGJlaSBkZXIgQm94IG51clxyXG4gICAgICAvLyBtaXQgXCJGYXJiaWdcIiB1bmQgQmVzY2hyaWZ0dW5nIFtUWVAvU3VidHlwXSAtIGJlaSBbVFlQXSBiencuIFtTdWJ0eXBdXHJcbiAgICAgIC8vIGZvbGd0IGRpZSBGYXJiZSBkZXIgQmVzY2hyaWZ0dW5nLlxyXG4gICAgICBjb25zdCBiYWRnZUxhYmVsID0gdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VMYWJlbCA/PyBcInR5cGVcIjtcclxuICAgICAgY29uc3Qgc2hvd1N1YnR5cCA9XHJcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlU3R5bGUgPT09IFwiZG90XCIgfHxcclxuICAgICAgICAoaXNCYWRnZSAmJiB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUNvbG9yZWQgJiYgYmFkZ2VMYWJlbCA9PT0gXCJ0eXBlLXN1YnR5cGVcIik7XHJcbiAgICAgIGlmICghaXNCYWRnZSAmJiAhc2hvd1N1YnR5cCkgcmV0dXJuO1xyXG5cclxuICAgICAgLy8gRWlnZW5lIEtsYXNzZSwgZGFtaXQgZGllIGJlaSBcImJhZGdlXCIgenVzXHUwMEU0dHpsaWNoIGFuZ2VoXHUwMEU0bmd0ZW4gU2NoYWx0ZXJcclxuICAgICAgLy8gc3RhdHQgbmViZW5laW5hbmRlciAoT2JzaWRpYW5zIFN0YW5kYXJkLUxheW91dCBmXHUwMEZDciBtZWhyZXJlIENvbnRyb2xzIGluXHJcbiAgICAgIC8vIGVpbmVyIFNldHRpbmctWmVpbGUpIHVudGVyZWluYW5kZXIgc3RlaGVuIC0gc2llaGVcclxuICAgICAgLy8gLmZyZWQtbm90ZS10aXRsZS1zZXR0aW5nIGluIHN0eWxlcy5jc3MuXHJcbiAgICAgIG5vdGVUaXRsZVNldHRpbmcuc2V0dGluZ0VsLmFkZENsYXNzKFwiZnJlZC1ub3RlLXRpdGxlLXNldHRpbmdcIik7XHJcblxyXG4gICAgICAvLyBFaWdlbmVzIGtsZWluZXMgTGFiZWwgamUgU2NoYWx0ZXIgc3RhdHQgbnVyIFRvb2x0aXAgLSBhZGRUb2dnbGUoKSBhbGxlaW5cclxuICAgICAgLy8gaFx1MDBFNG5ndCBudXIgZGVuIG5hY2t0ZW4gU2NoYWx0ZXIgb2huZSBCZXNjaHJpZnR1bmcgYW4sIGRhaGVyIGhpZXIgZWluZVxyXG4gICAgICAvLyBlaWdlbmUgWmVpbGUgKExhYmVsICsgVG9nZ2xlQ29tcG9uZW50KSBkaXJla3QgaW4gY29udHJvbEVsIGdlYmF1dC5cclxuICAgICAgY29uc3QgYWRkTGFiZWxlZFRvZ2dsZSA9IChsYWJlbCwgdG9vbHRpcCwgdmFsdWUsIG9uQ2hhbmdlKSA9PiB7XHJcbiAgICAgICAgY29uc3Qgcm93ID0gbm90ZVRpdGxlU2V0dGluZy5jb250cm9sRWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtbm90ZS10aXRsZS10b2dnbGUtcm93XCIgfSk7XHJcbiAgICAgICAgcm93LmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC1ub3RlLXRpdGxlLXRvZ2dsZS1sYWJlbFwiLCB0ZXh0OiBsYWJlbCB9KTtcclxuICAgICAgICBuZXcgVG9nZ2xlQ29tcG9uZW50KHJvdykuc2V0VG9vbHRpcCh0b29sdGlwKS5zZXRWYWx1ZSh2YWx1ZSkub25DaGFuZ2Uob25DaGFuZ2UpO1xyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgYWRkU3VidHlwVG9nZ2xlID0gKGxhYmVsKSA9PlxyXG4gICAgICAgIGFkZExhYmVsZWRUb2dnbGUoXHJcbiAgICAgICAgICBsYWJlbCxcclxuICAgICAgICAgIFwiRmFyYmUgZGVzIFN1YnR5cHMgc3RhdHQgZGVyIGRlcyBUWVBzIHZlcndlbmRlblwiLFxyXG4gICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5ub3RlVGl0bGVNYXJrZXJTdWJ0eXAsXHJcbiAgICAgICAgICBhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5ub3RlVGl0bGVNYXJrZXJTdWJ0eXAgPSB2YWx1ZTtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICk7XHJcblxyXG4gICAgICBpZiAoIWlzQmFkZ2UpIHtcclxuICAgICAgICBhZGRTdWJ0eXBUb2dnbGUoXCJTdWJ0eXBcIik7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCBsYWJlbFJvdyA9IG5vdGVUaXRsZVNldHRpbmcuY29udHJvbEVsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLW5vdGUtdGl0bGUtdG9nZ2xlLXJvd1wiIH0pO1xyXG4gICAgICBsYWJlbFJvdy5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtbm90ZS10aXRsZS10b2dnbGUtbGFiZWxcIiwgdGV4dDogXCJCZXNjaHJpZnR1bmdcIiB9KTtcclxuICAgICAgbmV3IERyb3Bkb3duQ29tcG9uZW50KGxhYmVsUm93KVxyXG4gICAgICAgIC5hZGRPcHRpb24oXCJ0eXBlXCIsIFwiW1RZUF1cIilcclxuICAgICAgICAuYWRkT3B0aW9uKFwidHlwZS1zdWJ0eXBlXCIsIFwiW1RZUC9TdWJ0eXBdXCIpXHJcbiAgICAgICAgLmFkZE9wdGlvbihcInN1YnR5cGVcIiwgXCJbU3VidHlwXVwiKVxyXG4gICAgICAgIC5zZXRWYWx1ZShiYWRnZUxhYmVsKVxyXG4gICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlTGFiZWwgPSB2YWx1ZTtcclxuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbiAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgIGFkZExhYmVsZWRUb2dnbGUoXCJGYXJiaWdcIiwgXCJGYXJiaWcgKFRZUC1GYXJiZSkgc3RhdHQgbmV1dHJhbFwiLCB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUNvbG9yZWQsIGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlQ29sb3JlZCA9IHZhbHVlO1xyXG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgICAgIHRoaXMuZGlzcGxheSgpO1xyXG4gICAgICB9KTtcclxuICAgICAgaWYgKHNob3dTdWJ0eXApIGFkZFN1YnR5cFRvZ2dsZShcIlN1YnR5cC1GYXJiZVwiKTtcclxuXHJcbiAgICAgIGFkZExhYmVsZWRUb2dnbGUoXCJBbSBQcm9wZXJ0eS1CbG9ja1wiLCBcIkFtIFByb3BlcnR5LUJsb2NrIChnZWRyZWh0KSBzdGF0dCBhbSBUaXRlbFwiLCBpc0Jsb2NrUG9zaXRpb24sIGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlUG9zaXRpb24gPSB2YWx1ZSA/IFwiYmxvY2tcIiA6IFwidGl0bGVcIjtcclxuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgICAgICB0aGlzLmRpc3BsYXkoKTtcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBpZiAoaXNCbG9ja1Bvc2l0aW9uKSB7XHJcbiAgICAgICAgYWRkTGFiZWxlZFRvZ2dsZShcclxuICAgICAgICAgIFwiT2JlbiBzdGF0dCB1bnRlblwiLFxyXG4gICAgICAgICAgXCJPYmVuIHN0YXR0IHVudGVuIGFtIFByb3BlcnR5LUJsb2NrXCIsXHJcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVWZXJ0aWNhbEFsaWduID09PSBcInRvcFwiLFxyXG4gICAgICAgICAgYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVZlcnRpY2FsQWxpZ24gPSB2YWx1ZSA/IFwidG9wXCIgOiBcImJvdHRvbVwiO1xyXG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgY29sb3JWaWV3VG9nZ2xlKFxyXG4gICAgICBjb2xvcmluZ0dyb3VwLFxyXG4gICAgICBcImJhY2tsaW5rc1wiLFxyXG4gICAgICBcIkJhY2tsaW5rc1wiLFxyXG4gICAgICBcIlRyZWZmZXJ6ZWlsZW4gaW0gQmFja2xpbmtzLVBhbmUgc293aWUgaW4gZGVuIGltIERva3VtZW50IGVpbmdlYmV0dGV0ZW4gQmFja2xpbmtzIChpbmtsLiBuaWNodCB2ZXJsaW5rdGVyIEVyd1x1MDBFNGhudW5nZW4pIG5hY2ggVFlQIGVpbmZcdTAwRTRyYmVuLlwiLFxyXG4gICAgICBcImJhY2tsaW5rc1N1YnR5cFwiXHJcbiAgICApO1xyXG4gICAgY29sb3JWaWV3VG9nZ2xlKFxyXG4gICAgICBjb2xvcmluZ0dyb3VwLFxyXG4gICAgICBcImJvb2ttYXJrc1wiLFxyXG4gICAgICBcIkJvb2ttYXJrc1wiLFxyXG4gICAgICBcIkVpbnRyXHUwMEU0Z2UgaW0gQm9va21hcmtzLVBhbmUsIGRpZSBkaXJla3QgYXVmIGVpbmUgTm90aXogemVpZ2VuLCBuYWNoIFRZUCBlaW5mXHUwMEU0cmJlbi5cIixcclxuICAgICAgXCJib29rbWFya3NTdWJ0eXBcIlxyXG4gICAgKTtcclxuICAgIGNvbG9yVmlld1RvZ2dsZShcclxuICAgICAgY29sb3JpbmdHcm91cCxcclxuICAgICAgXCJhbGxQcm9wZXJ0aWVzXCIsXHJcbiAgICAgIFwiQWxsIFByb3BlcnRpZXNcIixcclxuICAgICAgXCJJbiBPYnNpZGlhbnMgdmF1bHQtd2VpdGVyIFxcXCJBbGwgUHJvcGVydGllc1xcXCItQW5zaWNodCBQcm9wZXJ0eS1OYW1lbiBlaW5mXHUwMEU0cmJlbiwgZGllIGltIFRZUC1Gcm9udG1hdHRlciBnZW5hdSBlaW5lcyBUWVBzIHZvcmtvbW1lbiAoaW4gZGVzc2VuIEZhcmJlKSAtIGtvbW1lbiBzaWUgYmVpIG1laHJlcmVuIFRZUHMgdm9yLCBzdGF0dGRlc3NlbiBmZXR0IHN0YXR0IGVpbmdlZlx1MDBFNHJidC4gTWl0IFxcXCJTdWJ0eXBcXFwiIHpcdTAwRTRobGVuIGF1Y2ggZGllIEZyb250bWF0dGVyLUJsXHUwMEY2Y2tlIGRlciBTdWJ0eXBlbiBmXHUwMEZDciBpaHJlbiBqZXdlaWxpZ2VuIFRZUCwgZWluZ2VmXHUwMEU0cmJ0IGluIGRlciBGYXJiZSBkZXMgU3VidHlwcy5cIixcclxuICAgICAgXCJhbGxQcm9wZXJ0aWVzU3VidHlwXCIsXHJcbiAgICAgIHsgdHlwVG9vbHRpcDogXCJUWVAtRnJvbnRtYXR0ZXIgZGVyIFRZUGVuXCIsIHN1YnR5cFRvb2x0aXA6IFwiRnJvbnRtYXR0ZXItQmxcdTAwRjZja2UgZGVyIFN1YnR5cGVuIG1pdCBlaW5iZXppZWhlbiwgaW4gU3VidHlwLUZhcmJlXCIgfVxyXG4gICAgKTtcclxuXHJcbiAgICAvLyBHcmVuemVuIGRlciBkcmVpIFJlZ2xlciwgbWl0IGRlbmVuIGVpbiBTdWJ0eXAgc2VpbmUgRmFyYmUgdm9uIGRlciBzZWluZXNcclxuICAgIC8vIFRZUHMgYWJsZWl0ZXQgKEZhcmJwdW5rdCB1bnRlbiBpbSBTdWJ0eXAtQmxvY2sgZGVyIFRZUC1EZXRhaWxhbnNpY2h0LFxyXG4gICAgLy8gc2llaGUgdHlwZS1jb2xvcnMuanMpLiBFaW5lIHNjaG9uIGVpbmdlc3RlbGx0ZSwgZ3JcdTAwRjZcdTAwREZlcmUgQWJ3ZWljaHVuZyB3aXJkXHJcbiAgICAvLyBhdWYgZGllIG5ldWUgR3JlbnplIGdla2FwcHQuXHJcbiAgICBjb25zdCBzdWJ0eXBlQ29sb3JHcm91cCA9IG5ldyBTZXR0aW5nR3JvdXAoY29udGFpbmVyRWwpLnNldEhlYWRpbmcoXCJTdWJ0eXAtRmFyYmVuXCIpO1xyXG4gICAgY29uc3QgcmFuZ2VNYXggPSB7IGg6IDE4MCwgLyogczogMTAwLCAqLyBsOiAxMDAgfTtcclxuICAgIGNvbnN0IHJhbmdlRGVzYyA9IHtcclxuICAgICAgaDogXCJXaWUgd2VpdCBkZXIgRmFyYnRvbiBlaW5lcyBTdWJ0eXBzIGhcdTAwRjZjaHN0ZW5zIHZvbiBkZW0gc2VpbmVzIFRZUHMgYWJ3ZWljaGVuIGRhcmYgKFx1MDBCMSBHcmFkKS5cIixcclxuICAgICAgLy8gczogXCJXaWUgYmxhc3MgZWluIFN1YnR5cCBnZWdlblx1MDBGQ2JlciBzZWluZW0gVFlQIGhcdTAwRjZjaHN0ZW5zIHdlcmRlbiBkYXJmIChQcm96ZW50IGRlciBUWVAtU1x1MDBFNHR0aWd1bmcpLiBEZXIgUmVnbGVyIGdlaHQgbnVyIG5hY2ggdW50ZW4gLSBrclx1MDBFNGZ0aWdlciBhbHMgZGllIEhhdXB0ZmFyYmUgc29sbCBlaW4gU3VidHlwIG5pY2h0IHdlcmRlbi5cIixcclxuICAgICAgbDogXCJXaWUgd2VpdCBkaWUgSGVsbGlna2VpdCBlaW5lcyBTdWJ0eXBzIGhcdTAwRjZjaHN0ZW5zIHZvbiBkZXIgc2VpbmVzIFRZUHMgYWJ3ZWljaGVuIGRhcmYgKFx1MDBCMSBQcm96ZW50IGRlcyBXZWdzIHp1IFdlaVx1MDBERiBiencuIFNjaHdhcnogLSAxMDAgJSB3XHUwMEU0cmUgcmVpbmVzIFdlaVx1MDBERiBiencuIFNjaHdhcnopLlwiLFxyXG4gICAgfTtcclxuICAgIC8vIERlciBSZWdsZXIgbWVsZGV0IGplZGUgWndpc2NoZW5zdGVsbHVuZyAtIGRpZSBcdTAwRkNicmlnZW4gQW5zaWNodGVuIGVyc3RcclxuICAgIC8vIG5hY2h6aWVoZW4sIHdlbm4gZXIga3VyeiBydWh0LlxyXG4gICAgY29uc3QgcmVmcmVzaENvbG9yc1Nvb24gPSBkZWJvdW5jZSgoKSA9PiB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKSwgMzAwLCB0cnVlKTtcclxuICAgIGZvciAoY29uc3QgeyBrZXksIGxhYmVsLCB1bml0LCBkb3duT25seSB9IG9mIFNVQlRZUEVfQ09MT1JfQ0hBTk5FTFMpIHtcclxuICAgICAgc3VidHlwZUNvbG9yR3JvdXAuYWRkU2V0dGluZygoc2V0dGluZykgPT5cclxuICAgICAgICBzZXR0aW5nXHJcbiAgICAgICAgICAuc2V0TmFtZShgJHtsYWJlbH0gKCR7ZG93bk9ubHkgPyBcIlx1MjIxMlwiIDogXCJcdTAwQjFcIn0gJHt1bml0fSlgKVxyXG4gICAgICAgICAgLnNldERlc2MocmFuZ2VEZXNjW2tleV0pXHJcbiAgICAgICAgICAuYWRkU2xpZGVyKChzbGlkZXIpID0+XHJcbiAgICAgICAgICAgIHNsaWRlclxyXG4gICAgICAgICAgICAgIC5zZXRMaW1pdHMoMCwgcmFuZ2VNYXhba2V5XSwgMSlcclxuICAgICAgICAgICAgICAuc2V0VmFsdWUoY29sb3JSYW5nZSh0aGlzLnBsdWdpbi5zZXR0aW5ncywga2V5KSlcclxuICAgICAgICAgICAgICAuc2V0RHluYW1pY1Rvb2x0aXAoKVxyXG4gICAgICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnN1YnR5cGVDb2xvclJhbmdlcyA9IHsgLi4uREVGQVVMVF9TVUJUWVBFX0NPTE9SX1JBTkdFUywgLi4udGhpcy5wbHVnaW4uc2V0dGluZ3Muc3VidHlwZUNvbG9yUmFuZ2VzLCBba2V5XTogdmFsdWUgfTtcclxuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgICAgICAgICAgcmVmcmVzaENvbG9yc1Nvb24oKTtcclxuICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgKVxyXG4gICAgICAgICAgLmFkZEV4dHJhQnV0dG9uKChidXR0b24pID0+XHJcbiAgICAgICAgICAgIGJ1dHRvblxyXG4gICAgICAgICAgICAgIC5zZXRJY29uKFwicm90YXRlLWNjd1wiKVxyXG4gICAgICAgICAgICAgIC5zZXRUb29sdGlwKGBadXJcdTAwRkNja3NldHplbiBhdWYgJHtERUZBVUxUX1NVQlRZUEVfQ09MT1JfUkFOR0VTW2tleV19YClcclxuICAgICAgICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5zdWJ0eXBlQ29sb3JSYW5nZXMgPSB7IC4uLkRFRkFVTFRfU1VCVFlQRV9DT0xPUl9SQU5HRVMsIC4uLnRoaXMucGx1Z2luLnNldHRpbmdzLnN1YnR5cGVDb2xvclJhbmdlcywgW2tleV06IERFRkFVTFRfU1VCVFlQRV9DT0xPUl9SQU5HRVNba2V5XSB9O1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgICAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xyXG4gICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICApXHJcbiAgICAgICk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gR3J1cHBlIFwiR3JhcGhcIiAoVGFnLS9BbmhcdTAwRTRuZ2UtRmFyYmUpIGRlYWt0aXZpZXJ0ICgzMC4wOS4yMDI2KTogYmVpZGVzIGlzdCBpbVxyXG4gICAgLy8gTWluaW1hbCBUaGVtZSBcdTAwRkNiZXIgZGllIFN0eWxlIFNldHRpbmdzIGVpbnN0ZWxsYmFyLCBzaWVoZSBncmFwaC1jb2xvcnMuanMuXHJcbiAgICAvLyBEaWUgVFlQLUVpbmZcdTAwRTRyYnVuZyBkZXIgTm90aXotS25vdGVuIGJsZWlidCBha3RpdiwgU2NoYWx0ZXIgb2JlbiB1bnRlclxyXG4gICAgLy8gXCJFaW5mXHUwMEU0cmJ1bmdcIiBcdTIxOTIgXCJHcmFwaFwiLlxyXG4gICAgLy8gICAgIGNvbnN0IGdyYXBoR3JvdXAgPSBuZXcgU2V0dGluZ0dyb3VwKGNvbnRhaW5lckVsKS5zZXRIZWFkaW5nKFwiR3JhcGhcIik7XHJcbiAgICAvL1xyXG4gICAgLy8gICAgIC8vIEVpbiBTZXR0aW5nIHBybyBOb2RlLVR5cCwgZGVuIE9ic2lkaWFucyBHcmFwaC1FbmdpbmUga2VubnQgLSBnbGVpY2hlclxyXG4gICAgLy8gICAgIC8vIEF1ZmJhdSAoVG9nZ2xlICsgRmFyYndhaGwgKyBadXJcdTAwRkNja3NldHplbikgZlx1MDBGQ3IgamVkZW4sIGRhaGVyIGFscyBIZWxwZXJcclxuICAgIC8vICAgICAvLyBzdGF0dCBkdXBsaXppZXJ0LlxyXG4gICAgLy8gICAgIGNvbnN0IGdyYXBoQ29sb3JTZXR0aW5nID0gKGVuYWJsZWRLZXksIGNvbG9yS2V5LCBkZWZhdWx0Q29sb3IsIG5hbWUsIGRlc2MpID0+XHJcbiAgICAvLyAgICAgICBncmFwaEdyb3VwLmFkZFNldHRpbmcoKHNldHRpbmcpID0+XHJcbiAgICAvLyAgICAgICAgIHNldHRpbmdcclxuICAgIC8vICAgICAgICAgICAuc2V0TmFtZShuYW1lKVxyXG4gICAgLy8gICAgICAgICAgIC5zZXREZXNjKGRlc2MpXHJcbiAgICAvLyAgICAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxyXG4gICAgLy8gICAgICAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzW2VuYWJsZWRLZXldKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgIC8vICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3NbZW5hYmxlZEtleV0gPSB2YWx1ZTtcclxuICAgIC8vICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAvLyAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgLy8gICAgICAgICAgICAgfSlcclxuICAgIC8vICAgICAgICAgICApXHJcbiAgICAvLyAgICAgICAgICAgLmFkZENvbG9yUGlja2VyKChwaWNrZXIpID0+XHJcbiAgICAvLyAgICAgICAgICAgICBwaWNrZXIuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3NbY29sb3JLZXldIHx8IGRlZmF1bHRDb2xvcikub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAvLyAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzW2NvbG9yS2V5XSA9IHZhbHVlO1xyXG4gICAgLy8gICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgIC8vICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbiAgICAvLyAgICAgICAgICAgICB9KVxyXG4gICAgLy8gICAgICAgICAgIClcclxuICAgIC8vICAgICAgICAgICAuYWRkRXh0cmFCdXR0b24oKGJ1dHRvbikgPT5cclxuICAgIC8vICAgICAgICAgICAgIGJ1dHRvblxyXG4gICAgLy8gICAgICAgICAgICAgICAuc2V0SWNvbihcInJvdGF0ZS1jY3dcIilcclxuICAgIC8vICAgICAgICAgICAgICAgLnNldFRvb2x0aXAoXCJadXJcdTAwRkNja3NldHplbiBhdWYgU3RhbmRhcmRmYXJiZVwiKVxyXG4gICAgLy8gICAgICAgICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XHJcbiAgICAvLyAgICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3NbY29sb3JLZXldID0gXCJcIjtcclxuICAgIC8vICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgIC8vICAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgIC8vICAgICAgICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcclxuICAgIC8vICAgICAgICAgICAgICAgfSlcclxuICAgIC8vICAgICAgICAgICApXHJcbiAgICAvLyAgICAgICApO1xyXG4gICAgLy9cclxuICAgIC8vICAgICBncmFwaENvbG9yU2V0dGluZyhcclxuICAgIC8vICAgICAgIFwiZ3JhcGhUYWdDb2xvckVuYWJsZWRcIixcclxuICAgIC8vICAgICAgIFwiZ3JhcGhUYWdDb2xvclwiLFxyXG4gICAgLy8gICAgICAgXCIjODg4ODg4XCIsXHJcbiAgICAvLyAgICAgICBcIlRhZy1GYXJiZVwiLFxyXG4gICAgLy8gICAgICAgXCJFaWdlbmUgRmFyYmUgZlx1MDBGQ3IgVGFnLUtub3RlbiBpbSBHcmFwaCAoZ2xvYmFsIHVuZCBsb2thbCkgdmVyd2VuZGVuIHN0YXR0IGRlciBTdGFuZGFyZGZhcmJlLiBFaWdlbmUgRmFyYmdydXBwZW4gaW0gR3JhcGggaGFiZW4gd2VpdGVyaGluIFZvcnJhbmcuXCJcclxuICAgIC8vICAgICApO1xyXG4gICAgLy8gICAgIGdyYXBoQ29sb3JTZXR0aW5nKFxyXG4gICAgLy8gICAgICAgXCJncmFwaEF0dGFjaG1lbnRDb2xvckVuYWJsZWRcIixcclxuICAgIC8vICAgICAgIFwiZ3JhcGhBdHRhY2htZW50Q29sb3JcIixcclxuICAgIC8vICAgICAgIFwiI2UwYWMwMFwiLFxyXG4gICAgLy8gICAgICAgXCJBbmhcdTAwRTRuZ2UtRmFyYmVcIixcclxuICAgIC8vICAgICAgIFwiRWlnZW5lIEZhcmJlIGZcdTAwRkNyIEFuaGFuZy1Lbm90ZW4gKE5pY2h0LU1hcmtkb3duLURhdGVpZW4gd2llIEJpbGRlciBvZGVyIFBERnMpIGltIEdyYXBoIHZlcndlbmRlbiBzdGF0dCBkZXIgU3RhbmRhcmRmYXJiZS5cIlxyXG4gICAgLy8gICAgICk7XHJcblxyXG4gICAgY29uc3QgZnJvbnRtYXR0ZXJHcm91cCA9IG5ldyBTZXR0aW5nR3JvdXAoY29udGFpbmVyRWwpLnNldEhlYWRpbmcoXCJUWVAtRnJvbnRtYXR0ZXJcIik7XHJcblxyXG4gICAgY29sb3JWaWV3VG9nZ2xlKFxyXG4gICAgICBmcm9udG1hdHRlckdyb3VwLFxyXG4gICAgICBcImZyb250bWF0dGVyRGVmYXVsdHNcIixcclxuICAgICAgXCJQcm9wZXJ0eS1OYW1lbiBmZXR0IG1hcmtpZXJlblwiLFxyXG4gICAgICBcIkluIE5vdGl6ZW4gKEZyb250bWF0dGVyIGltIERva3VtZW50IHNvd2llIFByb3BlcnRpZXMtU2VpdGVubGVpc3RlKSBkaWUgTmFtZW4gZGVyIFByb3BlcnRpZXMgZmV0dCBkYXJzdGVsbGVuLCBkaWUgaW0gVFlQLUZyb250bWF0dGVyIGRlcyBqZXdlaWxpZ2VuIFRZUHMgaGludGVybGVndCBzaW5kLiBNaXQgXFxcIlN1YnR5cFxcXCIgenVzXHUwMEU0dHpsaWNoIGRpZSBhdXMgZGVtIEZyb250bWF0dGVyLUJsb2NrIGlocmVzIFNVQlRZUHMuXCIsXHJcbiAgICAgIFwiZnJvbnRtYXR0ZXJEZWZhdWx0c1N1YnR5cFwiLFxyXG4gICAgICB7IHR5cFRvb2x0aXA6IFwiVFlQLUZyb250bWF0dGVyIGRlciBUWVBlblwiLCBzdWJ0eXBUb29sdGlwOiBcIkZyb250bWF0dGVyLUJsXHUwMEY2Y2tlIGRlciBTdWJ0eXBlbiBtaXQgZWluYmV6aWVoZW5cIiB9XHJcbiAgICApO1xyXG5cclxuICAgIC8vIE9yZGVyLUVkaXRvciBzYW10IEJlc2NocmVpYnVuZyBhbHMgZWlnZW5lciBFaW50cmFnIGRlcnNlbGJlbiBHcnVwcGUgLVxyXG4gICAgLy8gYnJpbmd0IFx1MDBEQ2JlcnNjaHJpZnQgdW5kIEJ1dHRvbnMgc2VsYnN0IG1pdCwgZGFoZXIgZGlyZWt0IGluIGluZm9FbCBzdGF0dFxyXG4gICAgLy8gXHUwMEZDYmVyIHNldE5hbWUvc2V0RGVzYyAoc2llaGUgLmZyZWQtb3JkZXItc2V0dGluZyBpbiBzdHlsZXMuY3NzKS5cclxuICAgIGZyb250bWF0dGVyR3JvdXAuYWRkU2V0dGluZygoc2V0dGluZykgPT4ge1xyXG4gICAgICBzZXR0aW5nLnNldHRpbmdFbC5hZGRDbGFzcyhcImZyZWQtb3JkZXItc2V0dGluZ1wiKTtcclxuICAgICAgbW91bnRHbG9iYWxPcmRlckVkaXRvcihzZXR0aW5nLmluZm9FbCwgdGhpcy5wbHVnaW4pO1xyXG4gICAgICBzZXR0aW5nLmluZm9FbC5jcmVhdGVEaXYoe1xyXG4gICAgICAgIGNsczogXCJzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb25cIixcclxuICAgICAgICB0ZXh0OlxyXG4gICAgICAgICAgJ0Jlc3RpbW10IGRpZSBSZWloZW5mb2xnZSwgaW4gZGVyIGRpZSBCZWZlaGxlIFwiRnJvbnRtYXR0ZXIgU29ydGllcnVuZyBha3R1YWxpc2llcmVuXCIgZGllIGluIGVpbmVyIE5vdGl6IHZvcmhhbmRlbmVuIFByb3BlcnRpZXMgYW5vcmRuZW4gKGVyZ1x1MDBFNG56dCBvZGVyIFx1MDBFNG5kZXJ0IGtlaW5lIFdlcnRlKS4gRWluemVsbmUgUHJvcGVydGllcyAoei4gQi4gY3NzY2xhc3NlcywgYWxpYXNlcykgbGFzc2VuIHNpY2ggZmVzdCBwbGF0emllcmVuIC0gXCJUWVBcIiBpc3QgZGllIFRZUC1Qcm9wZXJ0eSBzZWxic3QsIFwiU1VCVFlQXCIgYW5hbG9nIGRpZSBTVUJUWVAtUHJvcGVydHksIFwiVFlQLUZyb250bWF0dGVyXCIgc3RlaHQgZlx1MDBGQ3IgZGllIFRZUC1Gcm9udG1hdHRlci1MaXN0ZSBkZXMgamV3ZWlsaWdlbiBUeXBzIHNhbXQgZGFoaW50ZXIgZGVtIEJsb2NrIHNlaW5lcyBTVUJUWVBzLCBcIlNvbnN0aWdlIFByb3BlcnRpZXNcIiBmXHUwMEZDciBhbGxlcyBcdTAwRENicmlnZS4gUmVpaGVuZm9sZ2UgcGVyIERyYWcgJiBEcm9wIFx1MDBFNG5kZXJiYXIsIGRpZSB2aWVyIFBsYXR6aGFsdGVyLVplaWxlbiBsYXNzZW4gc2ljaCBuaWNodCBlbnRmZXJuZW4uJyxcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBjb250YWluZXJFbC5zY3JvbGxUb3AgPSBzY3JvbGxUb3A7XHJcbiAgfVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IHsgREVGQVVMVF9TRVRUSU5HUywgVHlwU3lzdGVtU2V0dGluZ1RhYiB9O1xyXG4iLCAiY29uc3QgeyBOb3RpY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgc29ydEFsbEZyb250bWF0dGVyLCBzb3J0U2luZ2xlRmlsZUZyb250bWF0dGVyIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1zb3J0XCIpO1xuXG5mdW5jdGlvbiByZWdpc3RlckNvbW1hbmRzKHBsdWdpbikge1xuXG4gIC8vIE9ic2lkaWFuIGF3YWl0ZWQgZGVuIGNhbGxiYWNrIGVpbmVyIEJlZmVobHNkZWZpbml0aW9uIG5pY2h0IHVuZCBmXHUwMEU0bmd0IGF1Y2hcbiAgLy8ga2VpbmUgRmVobGVyIGFiIC0gZWluZSBFeGNlcHRpb24gZGFyaW4gd1x1MDBGQ3JkZSBzb25zdCBsYXV0bG9zIHZlcnNjaHdpbmRlblxuICAvLyAobnVyIGVpbiBFaW50cmFnIGluIGRlciBFbnR3aWNrbGVya29uc29sZSwga2VpbmUgc2ljaHRiYXJlIFJcdTAwRkNja21lbGR1bmcpLlxuICAvLyBEaWVzZSBkcmVpIFNvcnRpZXJiZWZlaGxlIGxhdWZlbiBkZXNoYWxiIFx1MDBGQ2JlciBydW5PclJlcG9ydEVycm9yKCksIGRhbWl0XG4gIC8vIGltIEZlaGxlcmZhbGwgdHJvdHpkZW0gaW1tZXIgZWluZSBOb3RpY2UgZXJzY2hlaW50IHN0YXR0IGdhciBrZWluZS5cbiAgY29uc3QgcnVuT3JSZXBvcnRFcnJvciA9IChsYWJlbCwgZm4pID0+IGFzeW5jICgpID0+IHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgZm4oKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihgWyR7bGFiZWx9XWAsIGVycm9yKTtcbiAgICAgIG5ldyBOb3RpY2UoYCR7bGFiZWx9IGZlaGxnZXNjaGxhZ2VuOiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgfVxuICB9O1xuXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJmcm9udG1hdHRlci1zb3J0aWVydW5nLWFsbGVcIixcbiAgICBuYW1lOiBcIkZyb250bWF0dGVyIFNvcnRpZXJ1bmcgR0xPQkFMIGFrdHVhbGlzaWVyZW5cIixcbiAgICBjYWxsYmFjazogcnVuT3JSZXBvcnRFcnJvcihcIkZyb250bWF0dGVyIFNvcnRpZXJ1bmdcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgeyBjaGVja2VkLCBjaGFuZ2VkIH0gPSBhd2FpdCBzb3J0QWxsRnJvbnRtYXR0ZXIocGx1Z2luLmFwcCwgcGx1Z2luLCBudWxsKTtcbiAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgIGNoYW5nZWQgPiAwXG4gICAgICAgICAgPyBgRnJvbnRtYXR0ZXIgU29ydGllcnVuZzogJHtjaGVja2VkfSBOb3RpemVuIGdlcHJcdTAwRkNmdCwgJHtjaGFuZ2VkfSBzb3J0aWVydC5gXG4gICAgICAgICAgOiBgRnJvbnRtYXR0ZXIgU29ydGllcnVuZzogJHtjaGVja2VkfSBOb3RpemVuIGdlcHJcdTAwRkNmdCwgYmVyZWl0cyBhbGxlIHNvcnRpZXJ0LmBcbiAgICAgICk7XG4gICAgfSksXG4gIH0pO1xuXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJmcm9udG1hdHRlci1zb3J0aWVydW5nLXR5cFwiLFxuICAgIG5hbWU6IFwiRnJvbnRtYXR0ZXIgU29ydGllcnVuZyBmXHUwMEZDciBUWVAgYWt0dWFsaXNpZXJlblwiLFxuICAgIGNhbGxiYWNrOiBydW5PclJlcG9ydEVycm9yKFwiRnJvbnRtYXR0ZXIgU29ydGllcnVuZ1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBEZXJzZWxiZSBUWVAtUGlja2VyIHdpZSBcdTAwRkNiZXJhbGwgc29uc3QgaW0gUGx1Z2luIChzaWVoZSB0eXBlLXBpY2tlci5qcykgLVxuICAgICAgLy8gemVpZ3QgRmFyYmUsIEJlc2NocmVpYnVuZyB1bmQgTm90aXotQW56YWhsIHN0YXR0IGVpbmVyIHJlaW5lbiBOYW1lbnNsaXN0ZVxuICAgICAgLy8gKHVuZCBtZWxkZXQgc2VsYnN0LCBmYWxscyBlcyBnYXIga2VpbmUgVFlQZW4gZ2lidCkuIGluY2x1ZGVNYW51YWxPZmYgdW5kXG4gICAgICAvLyBpbmNsdWRlVW5yZWdpc3RlcmVkOiB0cnVlLCBkYSBkaWUgU29ydGllcnVuZyB1bmFiaFx1MDBFNG5naWcgZGF2b24gc2lubnZvbGxcbiAgICAgIC8vIGlzdCwgb2IgZWluIFRZUCBtYW51ZWxsIHZlcmdlYmVuIHdlcmRlbiBkYXJmICh6LiBCLiBLT05UQUtULCBFWFRFUk4pXG4gICAgICAvLyBvZGVyIFx1MDBGQ2JlcmhhdXB0IGluIGRlciBUWVAtTGlzdGUgcmVnaXN0cmllcnQgaXN0LlxuICAgICAgY29uc3QgdHlwZSA9IGF3YWl0IHBsdWdpbi5waWNrVHlwZSh7IGluY2x1ZGVNYW51YWxPZmY6IHRydWUsIGluY2x1ZGVVbnJlZ2lzdGVyZWQ6IHRydWUgfSk7XG4gICAgICBpZiAoIXR5cGUpIHJldHVybjtcbiAgICAgIGNvbnN0IHsgY2hlY2tlZCwgY2hhbmdlZCwgaGFzVHlwZURlZmF1bHRzIH0gPSBhd2FpdCBzb3J0QWxsRnJvbnRtYXR0ZXIocGx1Z2luLmFwcCwgcGx1Z2luLCB0eXBlKTtcbiAgICAgIGxldCBtZXNzYWdlID1cbiAgICAgICAgY2hhbmdlZCA+IDBcbiAgICAgICAgICA/IGBGcm9udG1hdHRlciBTb3J0aWVydW5nICR7dHlwZX06ICR7Y2hlY2tlZH0gTm90aXplbiBnZXByXHUwMEZDZnQsICR7Y2hhbmdlZH0gc29ydGllcnQuYFxuICAgICAgICAgIDogYEZyb250bWF0dGVyIFNvcnRpZXJ1bmcgJHt0eXBlfTogJHtjaGVja2VkfSBOb3RpemVuIGdlcHJcdTAwRkNmdCwgYmVyZWl0cyBhbGxlIHNvcnRpZXJ0LmA7XG4gICAgICAvLyBLZWluIEZlaGxlciwgYWJlciBvaG5lIFRZUC1Gcm9udG1hdHRlciBncmVpZnQgZlx1MDBGQ3IgZGllc2VuIFR5cCBudXJcbiAgICAgIC8vIGRpZSBnbG9iYWxlIFJlaWhlbmZvbGdlIChUWVAgc2VsYnN0LCBmZXN0IHBvc2l0aW9uaWVydGUgUHJvcGVydGllcykgLVxuICAgICAgLy8gb2huZSBkaWVzZW4gSGlud2VpcyB3XHUwMEU0cmUgdW5rbGFyLCB3YXJ1bSBzaWNoIGdnZi4gbmljaHRzIGdlXHUwMEU0bmRlcnQgaGF0LlxuICAgICAgaWYgKGhhc1R5cGVEZWZhdWx0cyA9PT0gZmFsc2UpIHtcbiAgICAgICAgbWVzc2FnZSArPSBgIEhpbndlaXM6IEZcdTAwRkNyICR7dHlwZX0gaXN0IGtlaW4gVFlQLUZyb250bWF0dGVyIGhpbnRlcmxlZ3QgLSBudXIgZGllIGdsb2JhbGUgUmVpaGVuZm9sZ2Ugd3VyZGUgYW5nZXdlbmRldC5gO1xuICAgICAgfVxuICAgICAgbmV3IE5vdGljZShtZXNzYWdlKTtcbiAgICB9KSxcbiAgfSk7XG5cbiAgcGx1Z2luLmFkZENvbW1hbmQoe1xuICAgIGlkOiBcImZyb250bWF0dGVyLXNvcnRpZXJ1bmctYWt0aXZlLW5vdGl6XCIsXG4gICAgbmFtZTogXCJGcm9udG1hdHRlciBTb3J0aWVydW5nIGRlciBha3RpdmVuIE5vdGl6IGFrdHVhbGlzaWVyZW5cIixcbiAgICBjaGVja0NhbGxiYWNrOiAoY2hlY2tpbmcpID0+IHtcbiAgICAgIGNvbnN0IGZpbGUgPSBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gICAgICBpZiAoIWZpbGUgfHwgZmlsZS5leHRlbnNpb24gIT09IFwibWRcIikgcmV0dXJuIGZhbHNlO1xuICAgICAgaWYgKGNoZWNraW5nKSByZXR1cm4gdHJ1ZTtcblxuICAgICAgcnVuT3JSZXBvcnRFcnJvcihcIkZyb250bWF0dGVyIFNvcnRpZXJ1bmdcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBjb25zdCBjaGFuZ2VkID0gYXdhaXQgc29ydFNpbmdsZUZpbGVGcm9udG1hdHRlcihwbHVnaW4uYXBwLCBwbHVnaW4sIGZpbGUpO1xuICAgICAgICBuZXcgTm90aWNlKGNoYW5nZWQgPyBgRnJvbnRtYXR0ZXIgdm9uIFwiJHtmaWxlLmJhc2VuYW1lfVwiIHNvcnRpZXJ0LmAgOiBgRnJvbnRtYXR0ZXIgdm9uIFwiJHtmaWxlLmJhc2VuYW1lfVwiIHdhciBiZXJlaXRzIHNvcnRpZXJ0LmApO1xuICAgICAgfSkoKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH0sXG4gIH0pO1xuXG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckNvbW1hbmRzIH07XG4iLCAiY29uc3QgeyBtb21lbnQgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcblxuLy8gRWluIFNob3J0Y3V0IGlzdCBlaW4gVmVyd2VpcyBhdWYgZWluZW4gZXJzdCBiZWltIEFubGVnZW4gZWluZXIgTm90aXpcbi8vIGJlcmVjaG5ldGVuIFdlcnQuIEVyIHN0ZWh0IGJld3Vzc3QgTklDSFQgaW0gRnJvbnRtYXR0ZXItV2VydCBkZXIgUHJvcGVydHksXG4vLyBzb25kZXJuIGRhbmViZW4gLSBpbiBzZXR0aW5ncy50eXBlU2hvcnRjdXRzW1RZUF1ba2V5XSBmXHUwMEZDciBkYXMgVFlQLUZyb250bWF0dGVyXG4vLyBiencuIGltIHNob3J0Y3V0cy1PYmpla3QgZGVzIGpld2VpbGlnZW4gU3VidHlwLUJsb2NrcyAoc2llaGUgc3VidHlwZXMuanMpOlxuLy8gICB7IG5hbWU6IFwidG9kYXlcIiB9ICAgICAgICAgICAgLSBmZXN0ZXIgVG9rZW4sIGhpZXIgaW0gUGx1Z2luIGF1ZmdlbFx1MDBGNnN0XG4vLyAgIHsgbmFtZTogXCJ0cC48U2tyaXB0bmFtZT5cIiB9ICAtIFRlbXBsYXRlci1Ta3JpcHQsIG51ciB2b24gVFlQLmpzIGF1ZmxcdTAwRjZzYmFyXG4vLyAgIHsgbmFtZTogXCJ0cC48U2tyaXB0bmFtZT5cIiwgYXJnczogeyBvcmRuZXI6IFwiTGl0ZXJhdHVyXCIsIGphaHI6IDIwMjQgfSB9XG4vLyAgICAgLSBkYXNzZWxiZSBtaXQgQXJndW1lbnRlbi4gRGllIFBhcmFtZXRlcm5hbWVuIGRla2xhcmllcnQgZGFzIFNrcmlwdFxuLy8gICAgICAgc2VsYnN0IGltIEB0eXAtc2hvcnRjdXQtTWFya2VyIChzaWVoZSBzaG9ydGN1dC1zY3JpcHRzLmpzKTsgVFlQLmpzXG4vLyAgICAgICByZWljaHQgZGFzIE9iamVrdCBhbHMgY3R4LmFyZ3MgZHVyY2guIEZlc3RlIFRva2VuIGhhYmVuIG5pZSBBcmd1bWVudGUuXG4vL1xuLy8gV2FydW0gZGFuZWJlbiBzdGF0dCBpbSBXZXJ0OiBPYnNpZGlhbnMgUHJvcGVydHktV2lkZ2V0IGJlc3RpbW10IGRhc1xuLy8gRWluZ2FiZWZlbGQgZWluZXIgWmVpbGUgYXVzIGRlbSBpbiB0eXBlcy5qc29uIGRla2xhcmllcnRlbiBUeXAgZGVyIFByb3BlcnR5XG4vLyAoZ2V0VHlwZUluZm8gaW0gZ2ViYXV0ZW4gYXBwLmpzKS4gQmVpIGVpbmVyIGFscyBcImRhdGVcIi9cIm51bWJlclwiL1wiY2hlY2tib3hcIlxuLy8gZGVrbGFyaWVydGVuIFByb3BlcnR5IGlzdCBkYXMgZWluIDxpbnB1dCB0eXBlPVwiZGF0ZVwiPiwgZWluXG4vLyA8aW5wdXQgdHlwZT1cIm51bWJlclwiPiBiencuIGVpbiBUb2dnbGUgLSBkb3J0IGxpZVx1MDBERiBzaWNoIGVpbiBUb2tlbiB3aWVcbi8vIFwie3t0b2RheX19XCIgZ2FyIG5pY2h0IGVyc3QgZWludGlwcGVuLCBlaW4gdHJvdHpkZW0gZ2VzcGVpY2hlcnRlciBXZXJ0IGxcdTAwRjZzdGVcbi8vIE9ic2lkaWFucyBcIlR5cGUgbWlzbWF0Y2hcIi1XYXJudW5nIGF1cywgdW5kIGRhcyBMaXN0ZW4tV2lkZ2V0IG1hY2h0ZSBhdXMgZWluZW1cbi8vIFN0cmluZyBiZWltIGVyc3RlbiBCZWFyYmVpdGVuIHN0aWxsc2Nod2VpZ2VuZCBlaW4gQXJyYXkgKG9uQ2hhbmdlKGUuc2xpY2UoKSkpLlxuLy8gQWxsZSBkaWVzZSBQcm9ibGVtZSBoYWJlbiBkaWVzZWxiZSBVcnNhY2hlOiBlaW4gRnJlbWRrXHUwMEY2cnBlciBpbiBlaW5lbSBTbG90LFxuLy8gZGVzc2VuIERhdGVudHlwIE9ic2lkaWFuIGtvbnRyb2xsaWVydC4gTGllZ3QgZGVyIFNob3J0Y3V0IGRhbmViZW4sIGJsZWlidCBkZXJcbi8vIFdlcnQgdHlwcmVpbiB1bmQgZGFzIG5hdGl2ZSBXaWRnZXQgdW5hbmdldGFzdGV0IC0gZXMgYnJhdWNodCBkYWZcdTAwRkNyIGtlaW5lcmxlaVxuLy8gRWluZ3JpZmYgaW4gT2JzaWRpYW5zIFplaWxlbi1SZW5kZXJpbmcuXG4vL1xuLy8gRGVyIEZyb250bWF0dGVyLVdlcnQgZGVyIFByb3BlcnR5IGJsZWlidCBkYWJlaSBlcmhhbHRlbiB1bmQgZGllbnQgYWxzXG4vLyBSXHUwMERDQ0tGQUxMV0VSVDogU2NobFx1MDBFNGd0IGRhcyBUZW1wbGF0ZXItU2tyaXB0IGZlaGwgKGZlaGx0IG9kZXIgd2lyZnQpLCBzY2hyZWlidFxuLy8gVFlQLmpzIGlobiBzdGF0dCBlaW5lcyBsZWVyZW4gV2VydHMgKHNpZWhlIGdldFR5cGVTaG9ydGN1dHMgaW4gbWFpbi5qcyB1bmRcbi8vIGRpZSBBdXN3ZXJ0dW5nIGluIFRZUC5qcykuIEVpbiBTa3JpcHQsIGRhcyBiZXd1c3N0IG51bGwvXCJcIiBsaWVmZXJ0IC0gZXR3YSBiZWlcbi8vIEVTQyBpbSBQaWNrZXIgLSwgZ2lsdCBkYWdlZ2VuIG5pY2h0IGFscyBGZWhsc2NobGFnIHVuZCBsXHUwMEU0c3N0IGRpZSBQcm9wZXJ0eSBsZWVyLlxuXG4vLyBEaWUgZmVzdGVuIFRva2VuLCBkaWUgZGFzIFBsdWdpbiBzZWxic3QgYXVmbFx1MDBGNnNlbiBrYW5uIC0gb2huZSBUZW1wbGF0ZXIgdW5kXG4vLyBvaG5lIHRwLVp1Z3JpZmYsIGRhaGVyIHNjaG9uIGluIGdldFR5cGVEZWZhdWx0cygpIChtYWluLmpzKSBlaW5nZXNldHp0LiBFcnN0XG4vLyBiZWltIEFicnVmIGF1ZmdlbFx1MDBGNnN0LCBuaWNodCBiZWltIFNwZWljaGVybiwgZGFtaXQgei4gQi4gXCJ0b2RheVwiIGJlaSBqZWRlciBuZXVcbi8vIGFuZ2VsZWd0ZW4gTm90aXogZGFzIGRhbm4gYWt0dWVsbGUgRGF0dW0gbGllZmVydCBzdGF0dCBkZXMgVGFnZXMsIGFuIGRlbSBkZXJcbi8vIFNob3J0Y3V0IGdlc2V0enQgd3VyZGUuXG5jb25zdCBGSVhFRF9TSE9SVENVVFMgPSBbXG4gIHtcbiAgICBuYW1lOiBcInRvZGF5XCIsXG4gICAgZGVzY3JpcHRpb246IFwiSGV1dGlnZXMgRGF0dW0gKEpKSkotTU0tVFQpXCIsXG4gICAgcmVzb2x2ZTogKCkgPT4gbW9tZW50KCkuZm9ybWF0KFwiWVlZWS1NTS1ERFwiKSxcbiAgfSxcbiAge1xuICAgIG5hbWU6IFwibm93XCIsXG4gICAgZGVzY3JpcHRpb246IFwiQWt0dWVsbGVzIERhdHVtIG1pdCBVaHJ6ZWl0IChKSkpKLU1NLVRUIEhIOm1tKVwiLFxuICAgIHJlc29sdmU6ICgpID0+IG1vbWVudCgpLmZvcm1hdChcIllZWVktTU0tREQgSEg6bW1cIiksXG4gIH0sXG4gIHtcbiAgICAvLyBBbmRlcnMgYWxzIHRvZGF5L25vdyBuaWNodCBkZXIgQXVmcnVmemVpdHB1bmt0LCBzb25kZXJuIGRhc1xuICAgIC8vIEVyc3RlbGx1bmdzZGF0dW0gZGVyIGpld2VpbGlnZW4gRGF0ZWkgKGZpbGUuc3RhdC5jdGltZSkgLSBicmF1Y2h0IGRhaGVyXG4gICAgLy8gZGllIFppZWwtRGF0ZWkgYWxzIEtvbnRleHQgKGZpbGUtUGFyYW1ldGVyLCB2b24gZ2V0VHlwZURlZmF1bHRzXG4gICAgLy8gZHVyY2hnZXJlaWNodCkuIE9obmUgRGF0ZWkgRmFsbGJhY2sgYXVmIGRlbiBha3R1ZWxsZW4gWmVpdHB1bmt0LlxuICAgIG5hbWU6IFwiY3JlYXRlZFwiLFxuICAgIGRlc2NyaXB0aW9uOiBcIkVyc3RlbGx1bmdzZGF0dW0gZGVyIERhdGVpIChKSkpKLU1NLVRUKVwiLFxuICAgIHJlc29sdmU6IChmaWxlKSA9PiBtb21lbnQoZmlsZT8uc3RhdD8uY3RpbWUgPz8gRGF0ZS5ub3coKSkuZm9ybWF0KFwiWVlZWS1NTS1ERFwiKSxcbiAgfSxcbl07XG5cbi8vIFNrcmlwdC1TaG9ydGN1dHMgdHJhZ2VuIGRpZXNlbiBQclx1MDBFNGZpeCBpbSBuYW1lLCBkYW1pdCBlaW4gU2tyaXB0IG5pZSBtaXQgZWluZW1cbi8vIGZlc3RlbiBUb2tlbiBrb2xsaWRpZXJlbiBrYW5uIC0gYXVjaCBkYW5uIG5pY2h0LCB3ZW5uIGplbWFuZCBlaW5lIERhdGVpXG4vLyBcInRvZGF5LmpzXCIgaW4gZGVuIFRlbXBsYXRlci1Ta3JpcHQtT3JkbmVyIGxlZ3QuXG5jb25zdCBTQ1JJUFRfUFJFRklYID0gXCJ0cC5cIjtcblxuZnVuY3Rpb24gZmluZEZpeGVkU2hvcnRjdXQobmFtZSkge1xuICByZXR1cm4gRklYRURfU0hPUlRDVVRTLmZpbmQoKHNob3J0Y3V0KSA9PiBzaG9ydGN1dC5uYW1lID09PSBuYW1lKSA/PyBudWxsO1xufVxuXG4vLyBTa3JpcHRuYW1lIGVpbmVzIFwidHAuPFNrcmlwdG5hbWU+XCItU2hvcnRjdXRzLCBzb25zdCBudWxsLiBTa3JpcHRuYW1lID1cbi8vIERhdGVpbmFtZSBpbiB0ZW1wbGF0ZXItc2NyaXB0cy8gb2huZSBcIi5qc1wiLCBkYWhlciBhdWNoIG1pdCBVbWxhdXRlbiwgXCItXCJcbi8vIG9kZXIgTGVlcnplaWNoZW4gZXJsYXVidC5cbmZ1bmN0aW9uIHNjcmlwdE5hbWVPZihuYW1lKSB7XG4gIHJldHVybiB0eXBlb2YgbmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBuYW1lLnN0YXJ0c1dpdGgoU0NSSVBUX1BSRUZJWCkgPyBuYW1lLnNsaWNlKFNDUklQVF9QUkVGSVgubGVuZ3RoKSA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIGlzU2NyaXB0U2hvcnRjdXQocmVjb3JkKSB7XG4gIHJldHVybiBzY3JpcHROYW1lT2YocmVjb3JkPy5uYW1lKSAhPT0gbnVsbDtcbn1cblxuLy8gQW56ZWlnZWZvcm0gZWluZXMgU2hvcnRjdXRzIC0gaW4gZGVyIFByb3BlcnR5LVplaWxlIChDaGlwKSB1bmQgaW0gQXVzd2FobC1cbi8vIE1vZGFsLiBCZXd1c3N0IGRlciBuYWNrdGUgbmFtZSBvaG5lIFppZXJyYXQ6IEZyXHUwMEZDaGVyIHN0YW5kIGRlciBTaG9ydGN1dCBhbHNcbi8vIFwie3t0b2RheX19XCIgaW0gV2VydCBkZXIgUHJvcGVydHksIGRpZSBnZXNjaHdlaWZ0ZW4gS2xhbW1lcm4gd2FyZW4gZG9ydCBkaWVcbi8vIGVpbnppZ2UgTVx1MDBGNmdsaWNoa2VpdCwgaWhuIHZvbiBlaW5lbSBmZXN0ZW4gV2VydCB6dSB1bnRlcnNjaGVpZGVuLiBCZWlkZXMgaXN0XG4vLyB3ZWcgLSBnZXNwZWljaGVydCB3aXJkIHsgbmFtZSB9LCBUWVAuanMgYmVrb21tdCBTdHJ1a3R1ciBzdGF0dCBUZXh0IChzaWVoZVxuLy8gZ2V0VHlwZVNob3J0Y3V0cyBpbiBtYWluLmpzKSwgdW5kIGRlbiBVbnRlcnNjaGllZCB6dW0gZmVzdGVuIFdlcnQgbWFjaHQgamV0enRcbi8vIGRlciBDaGlwIHNlbGJzdCBzYW10IEFremVudGZhcmJlLiBEaWUgS2xhbW1lcm4gYmlsZGV0ZW4gYWxzbyBuaWNodHMgbWVociBhYi5cbmZ1bmN0aW9uIHNob3J0Y3V0TGFiZWwocmVjb3JkKSB7XG4gIGlmICghcmVjb3JkPy5uYW1lKSByZXR1cm4gXCJcIjtcbiAgY29uc3Qgd2VydGUgPSBPYmplY3QudmFsdWVzKHJlY29yZC5hcmdzID8/IHt9KS5maWx0ZXIoKHZhbHVlKSA9PiB2YWx1ZSAhPT0gdW5kZWZpbmVkKTtcbiAgcmV0dXJuIHdlcnRlLmxlbmd0aCA+IDAgPyBgJHtyZWNvcmQubmFtZX06ICR7d2VydGUuam9pbihcIiwgXCIpfWAgOiByZWNvcmQubmFtZTtcbn1cblxuLy8gRWluIGVpbmdldGlwcHRlcyBBcmd1bWVudCBpbiBkZW4gVHlwIFx1MDBGQ2JlcmZcdTAwRkNocmVuLCBkZW4gZXMgb2ZmZW5zaWNodGxpY2ggbWVpbnQgLVxuLy8gZGFtaXQgZWluIFNrcmlwdCBcIjVcIiBhbHMgWmFobCB1bmQgXCJ0cnVlXCIgYWxzIEJvb2xlYW4gYmVrb21tdCwgc3RhdHQgamVkZXNcbi8vIFNrcmlwdCBzZWxic3QgY2FzdGVuIHp1IGxhc3NlbiAod2ljaHRpZyB6LiBCLiwgd2VubiBkZXIgV2VydCBhbnNjaGxpZVx1MDBERmVuZCBpblxuLy8gZWluZXIgYWxzIFphaGwgZGVrbGFyaWVydGVuIFByb3BlcnR5IGxhbmRldCkuIEJld3Vzc3QgZGllc2Ugd2VuaWdlbiwga2xhclxuLy8gYmVuYW5udGVuIEZcdTAwRTRsbGUgc3RhdHQgSlNPTi5wYXJzZTogZGFzIHdcdTAwRkNyZGUgYmVpIFwiTGl0ZXJhdHVyXCIgb2huZWhpblxuLy8gc2NoZWl0ZXJuIHVuZCBiZWkgJ1wiYVwiJyBldHdhcyBhbmRlcmVzIGxpZWZlcm4sIGFscyBkb3J0IHN0ZWh0LiBFaW4gbGVlcmVzXG4vLyBGZWxkIGhlaVx1MDBERnQgXCJuaWNodCBnZXNldHp0XCIgKHVuZGVmaW5lZCkgdW5kIGZcdTAwRTRsbHQgYXVzIGRlbSBBcmd1bWVudC1PYmpla3Rcbi8vIGhlcmF1cywgZGFtaXQgZWluIFNrcmlwdCBzYXViZXIgbWl0IFwiYXJncy5qYWhyID8/IGZhbGxiYWNrXCIgYXJiZWl0ZW4ga2Fubi5cbmZ1bmN0aW9uIHBhcnNlQXJnVmFsdWUocmF3KSB7XG4gIGNvbnN0IHRleHQgPSBTdHJpbmcocmF3ID8/IFwiXCIpLnRyaW0oKTtcbiAgaWYgKHRleHQgPT09IFwiXCIpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmICh0ZXh0ID09PSBcInRydWVcIikgcmV0dXJuIHRydWU7XG4gIGlmICh0ZXh0ID09PSBcImZhbHNlXCIpIHJldHVybiBmYWxzZTtcbiAgaWYgKHRleHQgPT09IFwibnVsbFwiKSByZXR1cm4gbnVsbDtcbiAgaWYgKC9eLT9cXGQrKD86XFwuXFxkKyk/JC8udGVzdCh0ZXh0KSkgcmV0dXJuIE51bWJlcih0ZXh0KTtcbiAgcmV0dXJuIHRleHQ7XG59XG5cbi8vIE5hbWVuLCBkaWUgaW4gZGVyIFBhcmFtZXRlcmxpc3RlIGVpbmVzIE1hcmtlcnMgZlx1MDBGQ3IgV2VydGUgc3RlaGVuLCBkaWUgZGFzXG4vLyBQbHVnaW4gYnp3LiBUWVAuanMgc2VsYnN0IGtlbm50IC0gc2llIHdlcmRlbiBuaWNodCBhYmdlZnJhZ3QsIHNvbmRlcm4gYmVpbVxuLy8gQXVmcnVmIGVpbmdlc2V0enQ6XG4vLyAgIG5ld0ZpbGUgIGRpZSBuZXUgYW5nZWxlZ3RlIE5vdGl6XG4vLyAgIGN0eCAgICAgIGRlciBLb250ZXh0IHsgdHlwLCBzdWJ0eXAsIGtleSwgd2VydGUsIGRhbmFjaCwgYXJncyB9XG4vLyAgIGtleSAgICAgIGRpZSBQcm9wZXJ0eSwgYW4gZGVyIGRlciBTaG9ydGN1dCBoXHUwMEU0bmd0LiBFcnNwYXJ0IGVzLCBpaHJlbiBOYW1lblxuLy8gICAgICAgICAgICBhbHMgQXJndW1lbnQgenUgd2llZGVyaG9sZW4gLSBlaW4gU2tyaXB0IHdpZSByZWxhdGlvbi5qcywgZGFzXG4vLyAgICAgICAgICAgIHNpY2ggc2VpbmUgUHJvcGVydHkgc2FnZW4gbFx1MDBFNHNzdCwgYmVrb21tdCBkYW1pdCBhdXRvbWF0aXNjaCBkaWVcbi8vICAgICAgICAgICAgcmljaHRpZ2UsIGF1Y2ggd2VubiBkZXJzZWxiZSBTaG9ydGN1dCBhbiBlaW5lciBhbmRlcmVuIFplaWxlXG4vLyAgICAgICAgICAgIHNpdHp0LlxuLy8gXCJ0cFwiIHN0ZWh0IGltbWVyIGFscyBlcnN0ZXMgQXJndW1lbnQgdW5kIG11c3MgbmljaHQgZGVrbGFyaWVydCB3ZXJkZW47IHdpcmRcbi8vIGVzIHRyb3R6ZGVtIGdlbmFubnQsIHdpcmQgZXMgXHUwMEZDYmVyZ2FuZ2VuLCBzdGF0dCBlcyBlaW4gendlaXRlcyBNYWwgenVcbi8vIFx1MDBGQ2JlcmdlYmVuLlxuY29uc3QgUkVTRVJWRURfUEFSQU1TID0gW1wibmV3RmlsZVwiLCBcImN0eFwiLCBcImtleVwiXTtcblxuLy8gRGllIFBhcmFtZXRlciwgZlx1MDBGQ3IgZGllIGRhcyBNb2RhbCBlaW4gRWluZ2FiZWZlbGQgemVpZ3Q6IGFsbGVzLCB3YXMgbmljaHRcbi8vIHJlc2VydmllcnQgaXN0LiBwYXJhbXMgPT09IG51bGwgKGtlaW4gS2xhbW1lcnBhYXIgYW0gTWFya2VyKSBoZWlcdTAwREZ0XG4vLyBcImhlcmtcdTAwRjZtbWxpY2hlciBBdWZydWZcIiwgYWxzbyBlYmVuZmFsbHMga2VpbmUgRmVsZGVyLlxuZnVuY3Rpb24gaW5wdXRQYXJhbXMocGFyYW1zKSB7XG4gIHJldHVybiAocGFyYW1zID8/IFtdKS5maWx0ZXIoKG5hbWUpID0+IG5hbWUgIT09IFwidHBcIiAmJiAhUkVTRVJWRURfUEFSQU1TLmluY2x1ZGVzKG5hbWUpKTtcbn1cblxuLy8gRWluZ2FiZW4gKGplIFBhcmFtZXRlcm5hbWUgZWluIFRleHQpIGluIGRhcyBnZXNwZWljaGVydGUgQXJndW1lbnQtT2JqZWt0LlxuLy8gcGFyYW1zIGdpYnQgZGllIFJlaWhlbmZvbGdlIHZvciwgZGFtaXQgc2hvcnRjdXRMYWJlbCgpIHNpZSBpbiBkZXIgdm9tIFNrcmlwdFxuLy8gZGVrbGFyaWVydGVuIEZvbGdlIGFuemVpZ3Q7IGxlZXJlIEZlbGRlciBmZWhsZW4gaW0gRXJnZWJuaXMgZ2Fuei5cbmZ1bmN0aW9uIGJ1aWxkQXJncyhwYXJhbXMsIGVpbmdhYmVuKSB7XG4gIGNvbnN0IGFyZ3MgPSB7fTtcbiAgZm9yIChjb25zdCBuYW1lIG9mIGlucHV0UGFyYW1zKHBhcmFtcykpIHtcbiAgICBjb25zdCB2YWx1ZSA9IHBhcnNlQXJnVmFsdWUoZWluZ2FiZW5bbmFtZV0pO1xuICAgIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkKSBhcmdzW25hbWVdID0gdmFsdWU7XG4gIH1cbiAgcmV0dXJuIGFyZ3M7XG59XG5cbi8vIEF1cyBkZXIgZGVrbGFyaWVydGVuIFBhcmFtZXRlcmxpc3RlIGRpZSBBcmd1bWVudGUgZlx1MDBGQ3IgZGVuIEF1ZnJ1ZlxuLy8gZih0cCwgLi4uaGllcikgYmF1ZW4gLSBhdWZnZXJ1ZmVuIHZvbiBUWVAuanMsIGRhcyBhbHMgZWluemlnZXMgbmV3RmlsZSB1bmRcbi8vIGN0eCBrZW5udC5cbi8vXG4vLyBPaG5lIEtsYW1tZXJuIGFtIE1hcmtlciAocGFyYW1zID09PSBudWxsKSBibGVpYnQgZXMgYmVpbSBoZXJrXHUwMEY2bW1saWNoZW5cbi8vIEF1ZnJ1ZiBmKHRwLCBuZXdGaWxlLCBjdHgpLiBTb25zdCB3aXJkIGRpZSBMaXN0ZSBFaW50cmFnIGZcdTAwRkNyIEVpbnRyYWdcbi8vIGF1ZmdlbFx1MDBGNnN0OiByZXNlcnZpZXJ0ZSBOYW1lbiB6dSBkZW4gXHUwMEZDYmVyZ2ViZW5lbiBXZXJ0ZW4sIGFsbGUgYW5kZXJlbiB6dW1cbi8vIGVpbmdldGlwcHRlbiBBcmd1bWVudC5cbi8vXG4vLyBFaW4gUHVua3QtTmFtZSAoXCJvcHRpb25zLnR5cFwiKSBiZXNjaHJlaWJ0IGtlaW4gZWlnZW5lcyBBcmd1bWVudCwgc29uZGVybiBlaW5cbi8vIEZFTEQgZWluZXMgT2JqZWt0LUFyZ3VtZW50czogYWxsZSBcIm9wdGlvbnMuKlwiIHNhbW1lbG4gc2ljaCB6dSBlaW5lbSBlaW56aWdlblxuLy8gT2JqZWt0IGFuIGRlciBQb3NpdGlvbiBpaHJlcyBlcnN0ZW4gVm9ya29tbWVucy4gRGFtaXQgbGFzc2VuIHNpY2ggYXVjaFxuLy8gU2tyaXB0ZSBiZWRpZW5lbiwgZGVyZW4gU2lnbmF0dXIgZWluIE9wdGlvbnMtT2JqZWt0IGVyd2FydGV0LCBvaG5lIGRhc3MgbWFuXG4vLyBKU09OIGluIGVpbiBFaW5nYWJlZmVsZCB0aXBwZW4gbVx1MDBGQ3NzdGUuIE51ciBlaW5lIEViZW5lIHRpZWYgLSBiZWkgXCJhLmIuY1wiXG4vLyBlbnRzdFx1MDBGQ25kZSBlaW4gRmVsZCwgZGFzIHdcdTAwRjZydGxpY2ggXCJiLmNcIiBoZWlcdTAwREZ0LlxuZnVuY3Rpb24gcmVzb2x2ZUNhbGxBcmdzKHBhcmFtcywgYXJncywgcmVzZXJ2ZWQgPSB7fSkge1xuICBpZiAocGFyYW1zID09PSBudWxsIHx8IHBhcmFtcyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gW3Jlc2VydmVkLm5ld0ZpbGUsIHJlc2VydmVkLmN0eF07XG5cbiAgY29uc3Qgd2VydGUgPSBbXTtcbiAgY29uc3Qgb2JqZWt0UG9zaXRpb24gPSBuZXcgTWFwKCk7XG4gIGZvciAoY29uc3QgbmFtZSBvZiBwYXJhbXMpIHtcbiAgICBpZiAobmFtZSA9PT0gXCJ0cFwiKSBjb250aW51ZTtcbiAgICBpZiAoUkVTRVJWRURfUEFSQU1TLmluY2x1ZGVzKG5hbWUpKSB7XG4gICAgICB3ZXJ0ZS5wdXNoKHJlc2VydmVkW25hbWVdKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBwdW5rdCA9IG5hbWUuaW5kZXhPZihcIi5cIik7XG4gICAgaWYgKHB1bmt0ID09PSAtMSkge1xuICAgICAgd2VydGUucHVzaChhcmdzPy5bbmFtZV0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGJhc2lzID0gbmFtZS5zbGljZSgwLCBwdW5rdCk7XG4gICAgaWYgKCFvYmpla3RQb3NpdGlvbi5oYXMoYmFzaXMpKSB7XG4gICAgICBvYmpla3RQb3NpdGlvbi5zZXQoYmFzaXMsIHdlcnRlLmxlbmd0aCk7XG4gICAgICB3ZXJ0ZS5wdXNoKHt9KTtcbiAgICB9XG4gICAgY29uc3Qgd2VydCA9IGFyZ3M/LltuYW1lXTtcbiAgICBpZiAod2VydCAhPT0gdW5kZWZpbmVkKSB3ZXJ0ZVtvYmpla3RQb3NpdGlvbi5nZXQoYmFzaXMpXVtuYW1lLnNsaWNlKHB1bmt0ICsgMSldID0gd2VydDtcbiAgfVxuICByZXR1cm4gd2VydGU7XG59XG5cbi8vIE9iIGRpZSBQcm9wZXJ0eSBsYXV0IHR5cGVzLmpzb24gKGJ6dy4sIGZhbGxzIGRvcnQgbmljaHQgZ2VzZXR6dCwgbGF1dCBpaHJlclxuLy8gYmlzaGVyaWdlbiBWZXJ3ZW5kdW5nIGltIFZhdWx0KSBlaW5lIExpc3RlIGlzdCAtIGRhbm4gd2lyZCBlaW4gYXVmZ2VsXHUwMEY2c3RlclxuLy8gU2hvcnRjdXQtV2VydCBlaW5lbGVtZW50aWcgZWluZ2VwYWNrdCwgZGFtaXQgZGVyIGdlbGllZmVydGUgV2VydCB6dW1cbi8vIGRla2xhcmllcnRlbiBUeXAgZGVyIFByb3BlcnR5IHBhc3N0LiBPaG5lIGFwcCAoei4gQi4gaW4gVGVzdHMpIHdpZSBiaXNoZXJcbi8vIG9obmUgRWlucGFja2VuLlxuZnVuY3Rpb24gaXNMaXN0UHJvcGVydHkoYXBwLCBrZXkpIHtcbiAgcmV0dXJuIGFwcD8ubWV0YWRhdGFUeXBlTWFuYWdlcj8uZ2V0VHlwZUluZm8/LihrZXkpPy5leHBlY3RlZD8udHlwZSA9PT0gXCJtdWx0aXRleHRcIjtcbn1cblxuLy8gS29waWUgdm9uIGZyb250bWF0dGVyLCBpbiBkZXIgamVkZXIgS2V5IG1pdCBTaG9ydGN1dCBzZWluZW4gYmVyZWNobmV0ZW4gV2VydFxuLy8gdHJcdTAwRTRndDpcbi8vICAgLSBmZXN0ZXIgVG9rZW4gLT4gYXVmZ2VsXHUwMEY2c3QgKGJlaSBlaW5lciBMaXN0ZW4tUHJvcGVydHkgZWluZWxlbWVudGlnXG4vLyAgICAgZWluZ2VwYWNrdCksXG4vLyAgIC0gXCJ0cC48U2tyaXB0PlwiIC0+IG51bGw7IG51ciBUZW1wbGF0ZXIga2FubiBkYXMgYXVmbFx1MDBGNnNlbiwgVFlQLmpzIGhvbHQgc2ljaFxuLy8gICAgIGRpZXNlIEtleXMgXHUwMEZDYmVyIGdldFR5cGVTaG9ydGN1dHMoKSB1bmQgc2V0enQgc2llIHNlbGJzdCBlaW4uXG4vLyBLZXlzIG9obmUgU2hvcnRjdXQgYmxlaWJlbiB1bnZlclx1MDBFNG5kZXJ0IC0gZWJlbnNvIGRlciBXZXJ0IGVpbmVzIEtleXMgTUlUXG4vLyBTaG9ydGN1dCBpbiBkZW4gU2V0dGluZ3Mgc2VsYnN0OiBlciBibGVpYnQgZG9ydCBhbHMgUlx1MDBGQ2NrZmFsbHdlcnQgc3RlaGVuIChzaWVoZVxuLy8gS29tbWVudGFyIG9iZW4pIHVuZCB3aXJkIGhpZXIgbnVyIFx1MDBGQ2JlcnNjaHJpZWJlbiwgbmljaHQgZ2VsXHUwMEY2c2NodC5cbmZ1bmN0aW9uIHJlc29sdmVTaG9ydGN1dHMoZnJvbnRtYXR0ZXIsIHNob3J0Y3V0cywgeyBmaWxlLCBhcHAgfSA9IHt9KSB7XG4gIGNvbnN0IHJlc29sdmVkID0ge307XG4gIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGZyb250bWF0dGVyKSkge1xuICAgIGNvbnN0IHJlY29yZCA9IHNob3J0Y3V0cz8uW2tleV07XG4gICAgY29uc3QgZml4ZWQgPSByZWNvcmQgPyBmaW5kRml4ZWRTaG9ydGN1dChyZWNvcmQubmFtZSkgOiBudWxsO1xuICAgIGlmIChmaXhlZCkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gZml4ZWQucmVzb2x2ZShmaWxlKTtcbiAgICAgIHJlc29sdmVkW2tleV0gPSBpc0xpc3RQcm9wZXJ0eShhcHAsIGtleSkgPyBbcmVzdWx0XSA6IHJlc3VsdDtcbiAgICB9IGVsc2UgaWYgKGlzU2NyaXB0U2hvcnRjdXQocmVjb3JkKSkge1xuICAgICAgcmVzb2x2ZWRba2V5XSA9IG51bGw7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc29sdmVkW2tleV0gPSB2YWx1ZTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlc29sdmVkO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgRklYRURfU0hPUlRDVVRTLFxuICBTQ1JJUFRfUFJFRklYLFxuICBmaW5kRml4ZWRTaG9ydGN1dCxcbiAgc2NyaXB0TmFtZU9mLFxuICBpc1NjcmlwdFNob3J0Y3V0LFxuICBzaG9ydGN1dExhYmVsLFxuICBwYXJzZUFyZ1ZhbHVlLFxuICBidWlsZEFyZ3MsXG4gIGlucHV0UGFyYW1zLFxuICByZXNvbHZlQ2FsbEFyZ3MsXG4gIFJFU0VSVkVEX1BBUkFNUyxcbiAgcmVzb2x2ZVNob3J0Y3V0cyxcbn07XG4iLCAiY29uc3QgeyBGdXp6eVN1Z2dlc3RNb2RhbCwgTW9kYWwsIFNldHRpbmcgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgRklYRURfU0hPUlRDVVRTLCBTQ1JJUFRfUFJFRklYLCBidWlsZEFyZ3MsIGlucHV0UGFyYW1zIH0gPSByZXF1aXJlKFwiLi9zaG9ydGN1dHNcIik7XG5cbi8vIEFuemVpZ2Vmb3JtIGVpbmVzIExpc3RlbmVpbnRyYWdzOiBkZXIgTmFtZSwgYmVpIGVpbmVtIFNrcmlwdCBtaXQgZGVrbGFyaWVydGVuXG4vLyBQYXJhbWV0ZXJuIHp1c1x1MDBFNHR6bGljaCBkZXJlbiBOYW1lbiBpbiBLbGFtbWVybiAtIHNvIGlzdCBzY2hvbiBpbiBkZXIgQXVzd2FobFxuLy8genUgc2VoZW4sIGRhc3MgKHVuZCB3b21pdCkgZWluIFNrcmlwdCBwYXJhbWV0cmlzaWVydCB3aXJkLlxuZnVuY3Rpb24gaXRlbUxhYmVsKGl0ZW0pIHtcbiAgcmV0dXJuIGl0ZW0ucGFyYW1zID8gYCR7aXRlbS5uYW1lfSgke2l0ZW0ucGFyYW1zLmpvaW4oXCIsIFwiKX0pYCA6IGl0ZW0ubmFtZTtcbn1cblxuLy8gQXVzd2FobCBlaW5lcyBTaG9ydGN1dHMgZlx1MDBGQ3IgZWluZSBQcm9wZXJ0eSBkZXMgVFlQLUZyb250bWF0dGVycyAoS25vcGYgYnp3LlxuLy8gQ2hpcCBpbiBkZXIgUHJvcGVydHktWmVpbGUsIHNpZWhlIHR5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKS4gRXJzZXR6dCBkaWVcbi8vIGZyXHUwMEZDaGVyZSBMZWdlbmRlIHVudGVyaGFsYiBkZXIgRnJvbnRtYXR0ZXItQmxcdTAwRjZja2U6IGRpZXNlbGJlbiBUb2tlbiwgYWJlciBhbVxuLy8gT3J0IGRlciBWZXJ3ZW5kdW5nLCBkdXJjaHN1Y2hiYXIgLSB1bmQgYmVpIFNrcmlwdGVuIHp1c1x1MDBFNHR6bGljaCBtaXQgZGVyXG4vLyBCZXNjaHJlaWJ1bmcgYXVzIGRlcmVuIEB0eXAtc2hvcnRjdXQtTWFya2VyLCBkaWUgZWluZSBmZXN0ZSBMZWdlbmRlIGdhciBuaWNodFxuLy8ga2VubmVuIGtvbm50ZS5cbi8vXG4vLyBHZXdcdTAwRTRobHQgd2lyZCBuaWUgZnJlaWVyIFRleHQ6IGRpZSBMaXN0ZSBpc3QgZGllIG1hXHUwMERGZ2VibGljaGUgUXVlbGxlLCBlaW5cbi8vIFRpcHBmZWhsZXIgaW0gU2tyaXB0bmFtZW4gaXN0IGRhbWl0IGF1c2dlc2NobG9zc2VuLlxuY2xhc3MgU2hvcnRjdXRQaWNrZXJNb2RhbCBleHRlbmRzIEZ1enp5U3VnZ2VzdE1vZGFsIHtcbiAgY29uc3RydWN0b3IoYXBwLCBrZXksIGl0ZW1zLCByZXNvbHZlKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLml0ZW1zID0gaXRlbXM7XG4gICAgdGhpcy5yZXNvbHZlID0gcmVzb2x2ZTtcbiAgICB0aGlzLmNob3NlbiA9IGZhbHNlO1xuICAgIHRoaXMuc2V0UGxhY2Vob2xkZXIoYFNob3J0Y3V0IGZcdTAwRkNyIFx1MjAxRSR7a2V5fVx1MjAxQyBcdTIwMTMgRVNDIGZcdTAwRkNyIEFiYnJ1Y2hgKTtcbiAgfVxuXG4gIGdldEl0ZW1zKCkge1xuICAgIHJldHVybiB0aGlzLml0ZW1zO1xuICB9XG5cbiAgLy8gRnV6enktU3VjaGUgZ3JlaWZ0IGF1Y2ggYXVmIGRpZSBCZXNjaHJlaWJ1bmcsIG5pY2h0IG51ciBhdWYgZGVuIE5hbWVuIC1cbiAgLy8gXCJFcnN0ZWxsdW5nc2RhdHVtXCIgZmluZGV0IHNvIGF1Y2ggXCJjcmVhdGVkXCIuXG4gIGdldEl0ZW1UZXh0KGl0ZW0pIHtcbiAgICBjb25zdCBsYWJlbCA9IGl0ZW1MYWJlbChpdGVtKTtcbiAgICByZXR1cm4gaXRlbS5kZXNjcmlwdGlvbiA/IGAke2xhYmVsfSAke2l0ZW0uZGVzY3JpcHRpb259YCA6IGxhYmVsO1xuICB9XG5cbiAgcmVuZGVyU3VnZ2VzdGlvbihtYXRjaCwgZWwpIHtcbiAgICBjb25zdCBpdGVtID0gbWF0Y2guaXRlbTtcbiAgICBlbC5hZGRDbGFzcyhcImZyZWQtdHlwLXNob3J0Y3V0LXN1Z2dlc3Rpb25cIik7XG4gICAgZWwuY3JlYXRlRWwoXCJjb2RlXCIsIHsgY2xzOiBcImZyZWQtdHlwLXNob3J0Y3V0LXN1Z2dlc3Rpb24tbmFtZVwiLCB0ZXh0OiBpdGVtTGFiZWwoaXRlbSkgfSk7XG4gICAgaWYgKGl0ZW0uZGVzY3JpcHRpb24pIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtc2hvcnRjdXQtc3VnZ2VzdGlvbi1kZXNjXCIsIHRleHQ6IGl0ZW0uZGVzY3JpcHRpb24gfSk7XG4gIH1cblxuICAvLyBTaWVoZSBUeXBQaWNrZXJNb2RhbCBpbiB0eXBlLXBpY2tlci5qczogT2JzaWRpYW5zIHNlbGVjdFN1Z2dlc3Rpb24oKSBydWZ0XG4gIC8vIGVyc3QgY2xvc2UoKSB1bmQgZGFuYWNoIGVyc3Qgb25DaG9vc2VJdGVtKCkgLSBcImNob3NlblwiIG11c3MgZGVzaGFsYiBzY2hvblxuICAvLyBoaWVyIGdlc2V0enQgd2VyZGVuLCBzb25zdCBsXHUwMEY2c3QgZGFzIHZvbiBjbG9zZSgpIGF1c2dlbFx1MDBGNnN0ZSBvbkNsb3NlKCkgZGFzXG4gIC8vIFByb21pc2Ugdm9yemVpdGlnIG1pdCBudWxsIGF1ZiB1bmQgZGllIGVpZ2VudGxpY2hlIEF1c3dhaGwgZ2VodCB2ZXJsb3Jlbi5cbiAgc2VsZWN0U3VnZ2VzdGlvbihpdGVtLCBldnQpIHtcbiAgICB0aGlzLmNob3NlbiA9IHRydWU7XG4gICAgc3VwZXIuc2VsZWN0U3VnZ2VzdGlvbihpdGVtLCBldnQpO1xuICB9XG5cbiAgb25DaG9vc2VJdGVtKGl0ZW0pIHtcbiAgICB0aGlzLnJlc29sdmUoaXRlbSk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHN1cGVyLm9uQ2xvc2UoKTtcbiAgICBpZiAoIXRoaXMuY2hvc2VuKSB0aGlzLnJlc29sdmUobnVsbCk7XG4gIH1cbn1cblxuLy8gQWJmcmFnZSBkZXIgQXJndW1lbnRlIGVpbmVzIFNrcmlwdHMsIGRhcyB3ZWxjaGUgZGVrbGFyaWVydCBoYXQgLSBlaW4gRGlhbG9nXG4vLyBtaXQgYWxsZW4gRmVsZGVybiB1bnRlcmVpbmFuZGVyIHN0YXR0IGVpbmVyIEtldHRlIHZvbiBFaW56ZWxhYmZyYWdlbiwgZGFtaXRcbi8vIG1hbiBzaWUgZ2VtZWluc2FtIHNpZWh0IHVuZCBrb3JyaWdpZXJlbiBrYW5uLiBEaWUgRmVsZGVyIHNpbmQgbmFjaCBkZW5cbi8vIFBhcmFtZXRlcm5hbWVuIGRlcyBTa3JpcHRzIGJlbmFubnQ7IHZvcmJlbGVndCB3ZXJkZW4gc2llIG1pdCBkZW4gYmVyZWl0c1xuLy8gZ2VzcGVpY2hlcnRlbiBXZXJ0ZW4gKHZvcmhhbmRlbmUgQXJndW1lbnRlKSwgc29kYXNzIGVpbiBlcm5ldXRlcyBXXHUwMEU0aGxlblxuLy8gZGVzc2VsYmVuIFNrcmlwdHMgenVtIEtvcnJpZ2llcmVuIGVpbnplbG5lciBXZXJ0ZSB0YXVndC5cbi8vXG4vLyBFaW4gbGVlciBnZWxhc3NlbmVzIEZlbGQgZ2lsdCBhbHMgXCJuaWNodCBnZXNldHp0XCIgdW5kIGZcdTAwRTRsbHQgYXVzIGRlbSBFcmdlYm5pc1xuLy8gaGVyYXVzIChzaWVoZSBidWlsZEFyZ3MgaW4gc2hvcnRjdXRzLmpzKSAtIGRlc2hhbGIgZ2lidCBlcyBoaWVyIGtlaW5lXG4vLyBQZmxpY2h0ZmVsZGVyIHVuZCBrZWluZSBWYWxpZGllcnVuZzogd2FzIGRhcyBTa3JpcHQgYnJhdWNodCwgd2VpXHUwMERGIG51ciBkYXNcbi8vIFNrcmlwdCBzZWxic3QuXG5jbGFzcyBTaG9ydGN1dEFyZ3NNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgY29uc3RydWN0b3IoYXBwLCBpdGVtLCB2b3JoYW5kZW5lLCByZXNvbHZlKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLml0ZW0gPSBpdGVtO1xuICAgIHRoaXMucmVzb2x2ZSA9IHJlc29sdmU7XG4gICAgdGhpcy5mZWxkZXIgPSBpbnB1dFBhcmFtcyhpdGVtLnBhcmFtcyk7XG4gICAgdGhpcy5laW5nYWJlbiA9IHt9O1xuICAgIGZvciAoY29uc3QgbmFtZSBvZiB0aGlzLmZlbGRlcikge1xuICAgICAgY29uc3Qgd2VydCA9IHZvcmhhbmRlbmU/LltuYW1lXTtcbiAgICAgIHRoaXMuZWluZ2FiZW5bbmFtZV0gPSB3ZXJ0ID09PSB1bmRlZmluZWQgfHwgd2VydCA9PT0gbnVsbCA/IFwiXCIgOiBTdHJpbmcod2VydCk7XG4gICAgfVxuICAgIHRoaXMuYmVzdGFldGlndCA9IGZhbHNlO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIHRoaXMudGl0bGVFbC5zZXRUZXh0KGBBcmd1bWVudGUgZlx1MDBGQ3IgJHt0aGlzLml0ZW0ubmFtZX1gKTtcbiAgICBpZiAodGhpcy5pdGVtLmRlc2NyaXB0aW9uKSB7XG4gICAgICB0aGlzLmNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtc2hvcnRjdXQtYXJncy1kZXNjXCIsIHRleHQ6IHRoaXMuaXRlbS5kZXNjcmlwdGlvbiB9KTtcbiAgICB9XG4gICAgZm9yIChjb25zdCBuYW1lIG9mIHRoaXMuZmVsZGVyKSB7XG4gICAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRlbnRFbCkuc2V0TmFtZShuYW1lKS5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0XG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMuZWluZ2FiZW5bbmFtZV0pXG4gICAgICAgICAgLm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5laW5nYWJlbltuYW1lXSA9IHZhbHVlO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLy8gRW50ZXIgaW4gZWluZW0gRmVsZCBzY2hsaWVcdTAwREZ0IGRlbiBEaWFsb2cgYWIsIHdpZSBpbiBPYnNpZGlhbnNcbiAgICAgICAgICAvLyBlaWdlbmVuIFVtYmVuZW5uZW4tRGlhbG9nZW4uXG4gICAgICAgICAgLmlucHV0RWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XG4gICAgICAgICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVudGVyXCIgJiYgIWV2ZW50LmlzQ29tcG9zaW5nKSB7XG4gICAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICAgIHRoaXMudWViZXJuZWhtZW4oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9XG4gICAgbmV3IFNldHRpbmcodGhpcy5jb250ZW50RWwpLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgYnV0dG9uXG4gICAgICAgIC5zZXRCdXR0b25UZXh0KFwiXHUwMERDYmVybmVobWVuXCIpXG4gICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAub25DbGljaygoKSA9PiB0aGlzLnVlYmVybmVobWVuKCkpXG4gICAgKTtcbiAgfVxuXG4gIHVlYmVybmVobWVuKCkge1xuICAgIHRoaXMuYmVzdGFldGlndCA9IHRydWU7XG4gICAgdGhpcy5jbG9zZSgpO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIC8vIEVTQyBiencuIEtsaWNrIGRhbmViZW46IGtlaW4gU2hvcnRjdXQgZ2VzZXR6dCwgZGVyIGJpc2hlcmlnZSBibGVpYnRcbiAgICAvLyB1bmFuZ2V0YXN0ZXQgLSBzb25zdCB3XHUwMEU0cmUgZWluIHZlcnNlaGVudGxpY2hlcyBTY2hsaWVcdTAwREZlbiBlaW4gc3RpbGxlclxuICAgIC8vIERhdGVudmVybHVzdC5cbiAgICB0aGlzLnJlc29sdmUodGhpcy5iZXN0YWV0aWd0ID8gYnVpbGRBcmdzKHRoaXMuZmVsZGVyLCB0aGlzLmVpbmdhYmVuKSA6IG51bGwpO1xuICB9XG59XG5cbi8vIFx1MDBENmZmbmV0IGRpZSBBdXN3YWhsIGZcdTAwRkNyIGRpZSBQcm9wZXJ0eSBrZXkuIGdldFNjcmlwdHMgaXN0IGRlciBBY2Nlc3NvciBhdXNcbi8vIHJlZ2lzdGVyU2hvcnRjdXRTY3JpcHRzKCkgKHNob3J0Y3V0LXNjcmlwdHMuanMpLCB2b3JoYW5kZW4gZGVyIGFrdHVlbGxcbi8vIGdlc2V0enRlIFNob3J0Y3V0LVJlY29yZCAoZlx1MDBGQ3IgZGllIFZvcmJlbGVndW5nIGRlciBBcmd1bWVudGUpLiBMXHUwMEY2c3QgbWl0IGRlbVxuLy8gbmV1ZW4gUmVjb3JkICh7IG5hbWUgfSBiencuIHsgbmFtZSwgYXJncyB9KSBhdWYsIG9kZXIgbWl0IG51bGwgYmVpIEFiYnJ1Y2ggLVxuLy8gYXVjaCBkYW5uLCB3ZW5uIHp3YXIgZWluIFNrcmlwdCBnZXdcdTAwRTRobHQsIGRlciBBcmd1bWVudC1EaWFsb2cgZGFuYWNoIGFiZXJcbi8vIGFiZ2Vicm9jaGVuIHd1cmRlLlxuYXN5bmMgZnVuY3Rpb24gcGlja1Nob3J0Y3V0KGFwcCwga2V5LCBnZXRTY3JpcHRzLCB2b3JoYW5kZW4gPSBudWxsKSB7XG4gIGNvbnN0IGl0ZW1zID0gW1xuICAgIC4uLkZJWEVEX1NIT1JUQ1VUUy5tYXAoKHsgbmFtZSwgZGVzY3JpcHRpb24gfSkgPT4gKHsgbmFtZSwgZGVzY3JpcHRpb24sIHBhcmFtczogbnVsbCB9KSksXG4gICAgLi4uZ2V0U2NyaXB0cygpLm1hcCgoeyBuYW1lLCBwYXJhbXMsIGRlc2NyaXB0aW9uIH0pID0+ICh7IG5hbWU6IFNDUklQVF9QUkVGSVggKyBuYW1lLCBwYXJhbXMsIGRlc2NyaXB0aW9uIH0pKSxcbiAgXTtcblxuICBjb25zdCBpdGVtID0gYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IG5ldyBTaG9ydGN1dFBpY2tlck1vZGFsKGFwcCwga2V5LCBpdGVtcywgcmVzb2x2ZSkub3BlbigpKTtcbiAgaWYgKCFpdGVtKSByZXR1cm4gbnVsbDtcbiAgLy8gT2huZSBhYnp1ZnJhZ2VuZGUgRmVsZGVyIGVudGZcdTAwRTRsbHQgZGVyIHp3ZWl0ZSBTY2hyaXR0IGdhbnogLSBkYXMgZ2lsdCBmXHUwMEZDclxuICAvLyBkaWUgZmVzdGVuIFNob3J0Y3V0cyBlYmVuc28gd2llIGZcdTAwRkNyIGVpbiBTa3JpcHQsIGRlc3NlbiBQYXJhbWV0ZXJsaXN0ZSBudXJcbiAgLy8gcmVzZXJ2aWVydGUgTmFtZW4gZW50aFx1MDBFNGx0IChldHdhIFwiKG5ld0ZpbGUpXCIpLlxuICBpZiAoaW5wdXRQYXJhbXMoaXRlbS5wYXJhbXMpLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHsgbmFtZTogaXRlbS5uYW1lIH07XG5cbiAgLy8gVm9yYmVsZWd1bmcgbnVyLCB3ZW5uIGRhc3NlbGJlIFNrcmlwdCBzY2hvbiBnZXNldHp0IHdhciAtIGJlaSBlaW5lbVxuICAvLyBXZWNoc2VsIHdcdTAwRTRyZW4gZGllIGFsdGVuIFdlcnRlIGZcdTAwRkNyIGFuZGVyZSBQYXJhbWV0ZXJuYW1lbiBiZWRldXR1bmdzbG9zLlxuICBjb25zdCB2b3JiZWxlZ3VuZyA9IHZvcmhhbmRlbj8ubmFtZSA9PT0gaXRlbS5uYW1lID8gdm9yaGFuZGVuLmFyZ3MgOiBudWxsO1xuICBjb25zdCBhcmdzID0gYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IG5ldyBTaG9ydGN1dEFyZ3NNb2RhbChhcHAsIGl0ZW0sIHZvcmJlbGVndW5nLCByZXNvbHZlKS5vcGVuKCkpO1xuICBpZiAoYXJncyA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiBPYmplY3Qua2V5cyhhcmdzKS5sZW5ndGggPiAwID8geyBuYW1lOiBpdGVtLm5hbWUsIGFyZ3MgfSA6IHsgbmFtZTogaXRlbS5uYW1lIH07XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBwaWNrU2hvcnRjdXQgfTtcbiIsICJjb25zdCB7IE1hcmtkb3duVmlldywgTWVudSwgV29ya3NwYWNlTGVhZiwgc2V0SWNvbiB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBzaG9ydGN1dExhYmVsIH0gPSByZXF1aXJlKFwiLi9zaG9ydGN1dHNcIik7XG5jb25zdCB7IHBpY2tTaG9ydGN1dCB9ID0gcmVxdWlyZShcIi4vc2hvcnRjdXQtcGlja2VyXCIpO1xuY29uc3QgeyBnZXRTdWJ0eXBlLCBlbnN1cmVTdWJ0eXBlIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBlc1wiKTtcblxuLy8gTWFya2VyLUtsYXNzZSBhbSBDb250YWluZXIgZGVzIFRZUC1Gcm9udG1hdHRlci1FZGl0b3JzIC0gZ3Jlbnp0IGRpZVxuLy8gU2hvcnRjdXQtUmVnZWxuIGluIHN0eWxlcy5jc3MgYXVmIGRpZXNlbiBFZGl0b3IgZWluLCBlY2h0ZSBOb3RpemVuIGJsZWliZW5cbi8vIHVuYmVyXHUwMEZDaHJ0LlxuY29uc3QgRURJVE9SX0NMQVNTID0gXCJmcmVkLXR5cC1mcm9udG1hdHRlci1lZGl0b3JcIjtcblxuY29uc3QgVFlQX1BST1BFUlRZID0gXCJUWVBcIjtcbmNvbnN0IFNVQlRZUF9QUk9QRVJUWSA9IFwiU1VCVFlQXCI7XG5jb25zdCBTWVNURU1fUFJPUEVSVElFUyA9IFtUWVBfUFJPUEVSVFkudG9Mb3dlckNhc2UoKSwgU1VCVFlQX1BST1BFUlRZLnRvTG93ZXJDYXNlKCldO1xuXG4vLyBEZXIgV2VydCBkZXIgVFlQLSBiencuIFNVQlRZUC1Qcm9wZXJ0eSBpc3QgcGVyIERlZmluaXRpb24gaW1tZXIgZGVyIE5hbWUgZGVzXG4vLyBUWVBzL1N1YnR5cHMgc2VsYnN0IC0gYWxzIFwiU3RhbmRhcmRcIi1Qcm9wZXJ0eSB3XHUwMEU0cmUgc2llIGFsc28gcmVkdW5kYW50IHVuZFxuLy8ga1x1MDBGNm5udGUgYmVpIGVpbmVyIFVtYmVuZW5udW5nICh1bmJlbWVya3QpIHZvbSB0YXRzXHUwMEU0Y2hsaWNoZW4gTmFtZW4gYWJ3ZWljaGVuLlxuLy8gU2llIGRhcmYgZGVzaGFsYiBpbiBkaWVzZW0gRWRpdG9yIGdhciBuaWNodCBlcnN0IGFscyBlaWdlbmUgWmVpbGUgYXVmdGF1Y2hlbi5cbi8vIE11dGllcnQgXCJmcm9udG1hdHRlclwiIGluLXBsYWNlIChzdGF0dCBlaW5lIEtvcGllIHp1clx1MDBGQ2NrenVnZWJlbikgLSBPYnNpZGlhbnNcbi8vIFByb3BlcnR5LUVkaXRvciBzY2hlaW50IGJlaW0gc3luY2hyb25pemUoKSBhdWYgZWluZSBzdGFiaWxlIE9iamVrdHJlZmVyZW56XG4vLyBhbmdld2llc2VuIHp1IHNlaW47IGVpbmUgbmV1IGVyemV1Z3RlIEtvcGllIGhhdCBiZWltIGFsbGVyZXJzdGVuIFJlbmRlcm4genVcbi8vIGVpbmVtIFN0YWNrIE92ZXJmbG93IGluIE9ic2lkaWFucyBlaWdlbmVyIHJlbmRlclByb3BlcnR5KCktUGlwZWxpbmUgZ2VmXHUwMEZDaHJ0LlxuZnVuY3Rpb24gc3RyaXBUeXBQcm9wZXJ0eShmcm9udG1hdHRlcikge1xuICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhmcm9udG1hdHRlcikpIHtcbiAgICBpZiAoU1lTVEVNX1BST1BFUlRJRVMuaW5jbHVkZXMoa2V5LnRyaW0oKS50b0xvd2VyQ2FzZSgpKSkgZGVsZXRlIGZyb250bWF0dGVyW2tleV07XG4gIH1cbiAgcmV0dXJuIGZyb250bWF0dGVyO1xufVxuXG4vLyBTcGVpY2hlcm9ydCBlaW5lcyBGcm9udG1hdHRlci1CbG9ja3MgaW4gZGVuIFBsdWdpbi1TZXR0aW5ncyAtIGVudHdlZGVyIGRhc1xuLy8gVFlQLUZyb250bWF0dGVyIGVpbmVzIFRZUHMgKHR5cGVEZWZhdWx0RnJvbnRtYXR0ZXIvdHlwZUZsb2F0aW5nS2V5cy9cbi8vIHR5cGVTaG9ydGN1dHMpIG9kZXIgZGVyIEJsb2NrIGVpbmVzIHNlaW5lciBTdWJ0eXBlbiAodHlwZVN1YnR5cGVzLCBzaWVoZVxuLy8gc3VidHlwZXMuanMpLiBFZGl0b3IsIEZsb2F0aW5nLU1lblx1MDBGQywgU2hvcnRjdXQtS25vcGYgdW5kIFByb3BlcnR5LVVtYmVuZW5udW5nXG4vLyBhcmJlaXRlbiBhdXNzY2hsaWVcdTAwREZsaWNoIFx1MDBGQ2JlciBkaWVzZSBTY2huaXR0c3RlbGxlIHVuZCBtXHUwMEZDc3NlbiBkZW4gVW50ZXJzY2hpZWRcbi8vIG5pY2h0IGtlbm5lbi5cbi8vXG4vLyBnZXRTaG9ydGN1dHMvc2V0U2hvcnRjdXRzIGhhbHRlbiBkaWUgU2hvcnRjdXQtUmVjb3JkcyBqZSBLZXkgKHsgbmFtZSB9LFxuLy8gc2llaGUgc2hvcnRjdXRzLmpzKSAtIGJld3Vzc3QgbmViZW4gZGVtIEZyb250bWF0dGVyIHN0YXR0IGRhcmluLCBkYW1pdCBkZXJcbi8vIFdlcnQgZGVyIFByb3BlcnR5IHR5cHJlaW4gYmxlaWJ0IHVuZCBPYnNpZGlhbnMgbmF0aXZlcyBXaWRnZXQgdW5hbmdldGFzdGV0XG4vLyB3ZWl0ZXJsXHUwMEU0dWZ0LiBEZXIgV2VydCBpbSBGcm9udG1hdHRlciBibGVpYnQgYmVpIGdlc2V0enRlbSBTaG9ydGN1dCBhbHNcbi8vIFJcdTAwRkNja2ZhbGx3ZXJ0IHN0ZWhlbi5cbmZ1bmN0aW9uIHR5cGVTdG9yZShwbHVnaW4sIHR5cGUpIHtcbiAgcmV0dXJuIHtcbiAgICB0eXBlLFxuICAgIHN1YnR5cGU6IG51bGwsXG4gICAgZ2V0RnJvbnRtYXR0ZXI6ICgpID0+IHBsdWdpbi5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdID8/IHt9LFxuICAgIHNldEZyb250bWF0dGVyOiAoZnJvbnRtYXR0ZXIpID0+IHtcbiAgICAgIHBsdWdpbi5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdID0gZnJvbnRtYXR0ZXI7XG4gICAgfSxcbiAgICBnZXRGbG9hdGluZzogKCkgPT4gcGx1Z2luLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV0gPz8gW10sXG4gICAgc2V0RmxvYXRpbmc6IChrZXlzKSA9PiB7XG4gICAgICBpZiAoa2V5cy5sZW5ndGggPiAwKSBwbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXSA9IGtleXM7XG4gICAgICBlbHNlIGRlbGV0ZSBwbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXTtcbiAgICB9LFxuICAgIGdldFNob3J0Y3V0czogKCkgPT4gcGx1Z2luLnNldHRpbmdzLnR5cGVTaG9ydGN1dHNbdHlwZV0gPz8ge30sXG4gICAgc2V0U2hvcnRjdXRzOiAoc2hvcnRjdXRzKSA9PiB7XG4gICAgICBpZiAoT2JqZWN0LmtleXMoc2hvcnRjdXRzKS5sZW5ndGggPiAwKSBwbHVnaW4uc2V0dGluZ3MudHlwZVNob3J0Y3V0c1t0eXBlXSA9IHNob3J0Y3V0cztcbiAgICAgIGVsc2UgZGVsZXRlIHBsdWdpbi5zZXR0aW5ncy50eXBlU2hvcnRjdXRzW3R5cGVdO1xuICAgIH0sXG4gIH07XG59XG5cbmZ1bmN0aW9uIHN1YnR5cGVTdG9yZShwbHVnaW4sIHR5cGUsIHN1YnR5cGUpIHtcbiAgcmV0dXJuIHtcbiAgICB0eXBlLFxuICAgIHN1YnR5cGUsXG4gICAgZ2V0RnJvbnRtYXR0ZXI6ICgpID0+IGdldFN1YnR5cGUocGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKT8uZnJvbnRtYXR0ZXIgPz8ge30sXG4gICAgc2V0RnJvbnRtYXR0ZXI6IChmcm9udG1hdHRlcikgPT4ge1xuICAgICAgZW5zdXJlU3VidHlwZShwbHVnaW4uc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpLmZyb250bWF0dGVyID0gZnJvbnRtYXR0ZXI7XG4gICAgfSxcbiAgICBnZXRGbG9hdGluZzogKCkgPT4gZ2V0U3VidHlwZShwbHVnaW4uc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpPy5mbG9hdGluZ0tleXMgPz8gW10sXG4gICAgc2V0RmxvYXRpbmc6IChrZXlzKSA9PiB7XG4gICAgICBlbnN1cmVTdWJ0eXBlKHBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSkuZmxvYXRpbmdLZXlzID0ga2V5cztcbiAgICB9LFxuICAgIGdldFNob3J0Y3V0czogKCkgPT4gZ2V0U3VidHlwZShwbHVnaW4uc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpPy5zaG9ydGN1dHMgPz8ge30sXG4gICAgc2V0U2hvcnRjdXRzOiAoc2hvcnRjdXRzKSA9PiB7XG4gICAgICBlbnN1cmVTdWJ0eXBlKHBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSkuc2hvcnRjdXRzID0gc2hvcnRjdXRzO1xuICAgIH0sXG4gIH07XG59XG5cbi8vIE9ic2lkaWFucyBlaWdlbmVzIEZyb250bWF0dGVyLVdpZGdldCAoXCJQcm9wZXJ0aWVzXCIpIGlzdCBrZWluZSBvZmZpemllbGxlXG4vLyBQbHVnaW4tQVBJLiBJbnRlcm4gaXN0IGVzIGVpbmUgQ29tcG9uZW50LUtsYXNzZSAoaW0gZ2ViYXV0ZW4gYXBwLmpzIHp1XG4vLyBcIk1ldGFkYXRhRWRpdG9yXCIgbWluaWZpemllcnQpLCBkaWUgc293b2hsIHZvbiBqZWRlciBNYXJrZG93blZpZXcgYWxzIGF1Y2ggdm9uXG4vLyBkZXIgZWluZ2ViYXV0ZW4gXCJGaWxlIFByb3BlcnRpZXNcIi1QYW5lIHZlcndlbmRldCB3aXJkIC0gYmVpZGUgbGVnZW4gc2ljaCBiZWltXG4vLyBFcnpldWdlbiB1bmNvbmRpdGlvbmFsIGVpbmUgSW5zdGFueiB1bnRlciB2aWV3Lm1ldGFkYXRhRWRpdG9yIGFuLiBEaWUgS2xhc3NlXG4vLyBzZWxic3Qgd2lyZCBuaXJnZW5kcyB1bnRlciBlaW5lbSBOYW1lbiBleHBvcnRpZXJ0LCBpc3QgYWJlciBcdTAwRkNiZXIgZWluZVxuLy8gYmVsaWViaWdlIGJlcmVpdHMgdm9yaGFuZGVuZSBJbnN0YW56IGVycmVpY2hiYXIgKGluc3RhbmNlLmNvbnN0cnVjdG9yKSB1bmRcbi8vIGJsZWlidCBmXHUwMEZDciBkaWUgRGF1ZXIgZGVyIE9ic2lkaWFuLVNlc3Npb24gc3RhYmlsIC0gZWlubWFsaWdlcyBBYmdyZWlmZW4gdW5kXG4vLyBad2lzY2hlbnNwZWljaGVybiByZWljaHQgZGVzaGFsYiBhdXMuXG5sZXQgY2FjaGVkRWRpdG9yQ2xhc3MgPSBudWxsO1xuXG5mdW5jdGlvbiBnZXRNZXRhZGF0YUVkaXRvckNsYXNzKGFwcCkge1xuICBpZiAoY2FjaGVkRWRpdG9yQ2xhc3MpIHJldHVybiBjYWNoZWRFZGl0b3JDbGFzcztcblxuICBjb25zdCBhY3RpdmUgPSBhcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcbiAgaWYgKGFjdGl2ZT8ubWV0YWRhdGFFZGl0b3IpIHtcbiAgICBjYWNoZWRFZGl0b3JDbGFzcyA9IGFjdGl2ZS5tZXRhZGF0YUVkaXRvci5jb25zdHJ1Y3RvcjtcbiAgICByZXR1cm4gY2FjaGVkRWRpdG9yQ2xhc3M7XG4gIH1cbiAgZm9yIChjb25zdCBsZWFmIG9mIGFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikpIHtcbiAgICBpZiAobGVhZi52aWV3Py5tZXRhZGF0YUVkaXRvcikge1xuICAgICAgY2FjaGVkRWRpdG9yQ2xhc3MgPSBsZWFmLnZpZXcubWV0YWRhdGFFZGl0b3IuY29uc3RydWN0b3I7XG4gICAgICByZXR1cm4gY2FjaGVkRWRpdG9yQ2xhc3M7XG4gICAgfVxuICB9XG4gIGNhY2hlZEVkaXRvckNsYXNzID0gaGFydmVzdEVkaXRvckNsYXNzKGFwcCk7XG4gIHJldHVybiBjYWNoZWRFZGl0b3JDbGFzcztcbn1cblxuLy8gU29sYW5nZSBpbiBkaWVzZXIgU2Vzc2lvbiBub2NoIGtlaW5lIE5vdGl6IG9mZmVuIHdhciAoei4gQi4gZGlyZWt0IG5hY2ggZGVtXG4vLyBTdGFydCwgd2VubiBkaWUgVFlQLUFuc2ljaHQgZGllIGVyc3RlIGlzdCwgZGllIG1hbiBcdTAwRjZmZm5ldCksIGdpYnQgZXMga2VpbmVcbi8vIGVpbnppZ2UgTWFya2Rvd25WaWV3IHVuZCBkYW1pdCBhdWNoIGtlaW5lIEluc3RhbnosIFx1MDBGQ2JlciBkaWUgZGllIEtsYXNzZSBvYmVuXG4vLyBlcnJlaWNoYmFyIHdcdTAwRTRyZS4gRGFubiBiYXV0IHNpY2ggZGllc2VyIFdlZyBzZWxic3QgZWluZTogZWluZSBmcmVpZVxuLy8gV29ya3NwYWNlTGVhZiAob2huZSBQYXJlbnQsIG5pZSBpbiBlaW5lbSBTcGxpdCB1bmQgbmllIGltIERPTSkgdW5kIGRhcmF1ZlxuLy8gZWluZSBNYXJrZG93blZpZXcgYXVzIE9ic2lkaWFucyBlaWdlbmVyIFZpZXctUmVnaXN0cnkgLSBkZXJlbiBLb25zdHJ1a3RvclxuLy8gbGVndCBkaWUgbWV0YWRhdGFFZGl0b3ItSW5zdGFueiB1bmNvbmRpdGlvbmFsIGFuIChkYXNzZWxiZSwgd2FzIHNvbnN0IGplZGVcbi8vIGdlXHUwMEY2ZmZuZXRlIE5vdGl6IHR1dCkuIEdlYnJhdWNodCB3aXJkIG51ciBkaWUgS2xhc3NlbnJlZmVyZW56OyBkaWUgVmlldyB3aXJkXG4vLyBkaXJla3QgZGFuYWNoIHdpZWRlciBlbnRsYWRlbiwgZGllIExlYWYgaFx1MDBFNG5ndCBhbiBuaWNodHMgdW5kIHZlcnNjaHdpbmRldCBtaXRcbi8vIGloci4gQmV3dXNzdCBOSUNIVCBsZWFmLmRldGFjaCgpOiBkYXMgZXJ3YXJ0ZXQgZWluZW4gUGFyZW50LCBkZW4gZGllc2UgTGVhZlxuLy8gbmllIGhhdHRlLlxuZnVuY3Rpb24gaGFydmVzdEVkaXRvckNsYXNzKGFwcCkge1xuICBsZXQgdmlldyA9IG51bGw7XG4gIHRyeSB7XG4gICAgY29uc3QgY3JlYXRlVmlldyA9IGFwcC52aWV3UmVnaXN0cnk/LmdldFZpZXdDcmVhdG9yQnlUeXBlPy4oXCJtYXJrZG93blwiKTtcbiAgICBpZiAoIWNyZWF0ZVZpZXcpIHJldHVybiBudWxsO1xuICAgIHZpZXcgPSBjcmVhdGVWaWV3KG5ldyBXb3Jrc3BhY2VMZWFmKGFwcCkpO1xuICAgIHJldHVybiB2aWV3Lm1ldGFkYXRhRWRpdG9yPy5jb25zdHJ1Y3RvciA/PyBudWxsO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnNvbGUuZXJyb3IoXCJbdHlwLXN5c3RlbV0gTWV0YWRhdGFFZGl0b3ItS2xhc3NlIGtvbm50ZSBuaWNodCBlcm1pdHRlbHQgd2VyZGVuXCIsIGVycm9yKTtcbiAgICByZXR1cm4gbnVsbDtcbiAgfSBmaW5hbGx5IHtcbiAgICB0cnkge1xuICAgICAgdmlldz8udW5sb2FkKCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJbdHlwLXN5c3RlbV0gVmVyd2VyZmVuIGRlciBIaWxmcy1NYXJrZG93blZpZXcgZmVobGdlc2NobGFnZW5cIiwgZXJyb3IpO1xuICAgIH1cbiAgfVxufVxuXG4vLyBBbmFsb2cgenUgZ2V0TWV0YWRhdGFFZGl0b3JDbGFzcyBvYmVuOiBSZWZlcmVueiBhdWYgZGllIHByaXZhdGUgUHJvcGVydHktXG4vLyBaZWlsZW4tS2xhc3NlIChpbSBnZWJhdXRlbiBhcHAuanMgbWluaWZpemllcnQpLCBcdTAwRkNiZXIgZWluZSBiZXJlaXRzXG4vLyBnZXJlbmRlcnRlIFplaWxlIGFiZ2VncmlmZmVuIChkZXJlbiAuY29uc3RydWN0b3IpIC0gc3RhYmlsIGZcdTAwRkNyIGRpZSBEYXVlclxuLy8gZGVyIFNlc3Npb24uIFwiZWRpdG9yXCIgKGZhbGxzIHNjaG9uIHZvcmhhbmRlbikgd2lyZCB6dWVyc3QgcHJvYmllcnQsIGRhXG4vLyBkaWVzZSBLbGFzc2UgYXVzc2NobGllXHUwMERGbGljaCBmXHUwMEZDciBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaCgpIGdlYnJhdWNodCB3aXJkXG4vLyB1bmQgaW4gYWxsZXIgUmVnZWwgc2Nob24gZG9ydCB2ZXJmXHUwMEZDZ2JhciBpc3QsIHNvYmFsZCBkZXIgVHlwIG1pbmRlc3RlbnNcbi8vIGVpbmUgUHJvcGVydHkgaGF0LlxubGV0IGNhY2hlZFByb3BlcnR5Um93Q2xhc3MgPSBudWxsO1xuXG5mdW5jdGlvbiBnZXRQcm9wZXJ0eVJvd0NsYXNzKGFwcCwgZWRpdG9yKSB7XG4gIGlmIChjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzKSByZXR1cm4gY2FjaGVkUHJvcGVydHlSb3dDbGFzcztcbiAgaWYgKGVkaXRvcj8ucmVuZGVyZWQ/LlswXSkge1xuICAgIGNhY2hlZFByb3BlcnR5Um93Q2xhc3MgPSBlZGl0b3IucmVuZGVyZWRbMF0uY29uc3RydWN0b3I7XG4gICAgcmV0dXJuIGNhY2hlZFByb3BlcnR5Um93Q2xhc3M7XG4gIH1cbiAgY29uc3QgYWN0aXZlID0gYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gIGlmIChhY3RpdmU/Lm1ldGFkYXRhRWRpdG9yPy5yZW5kZXJlZD8uWzBdKSB7XG4gICAgY2FjaGVkUHJvcGVydHlSb3dDbGFzcyA9IGFjdGl2ZS5tZXRhZGF0YUVkaXRvci5yZW5kZXJlZFswXS5jb25zdHJ1Y3RvcjtcbiAgICByZXR1cm4gY2FjaGVkUHJvcGVydHlSb3dDbGFzcztcbiAgfVxuICBmb3IgKGNvbnN0IGxlYWYgb2YgYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xuICAgIGlmIChsZWFmLnZpZXc/Lm1ldGFkYXRhRWRpdG9yPy5yZW5kZXJlZD8uWzBdKSB7XG4gICAgICBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzID0gbGVhZi52aWV3Lm1ldGFkYXRhRWRpdG9yLnJlbmRlcmVkWzBdLmNvbnN0cnVjdG9yO1xuICAgICAgcmV0dXJuIGNhY2hlZFByb3BlcnR5Um93Q2xhc3M7XG4gICAgfVxuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vLyBFcmdcdTAwRTRuenQgZGFzIFJlY2h0c2tsaWNrLUtvbnRleHRtZW5cdTAwRkMgZWluZXIgUHJvcGVydHktWmVpbGUgdW0gZWluZW4gVG9nZ2xlXG4vLyBcIkZsb2F0aW5nXCIgR0FOWiBPQkVOIC0gYWJlciBleGtsdXNpdiBmXHUwMEZDciBaZWlsZW4gZGllc2VzIFBsdWdpbnNcbi8vIGVpZ2VuZXIgVFlQLURldGFpbGFuc2ljaHQgKGVya2FubnQgYW4gb3duZXIuZnJlZFN0b3JlLCBzaWVoZSB1bnRlbiksIG5pZSBpblxuLy8gZWNodGVuIE5vdGl6ZW4uIFVuYWJoXHUwMEU0bmdpZyB2b20gXCIrXCItQnV0dG9uIGxpbmtzIG5lYmVuIGRlbSBub3JtYWxlblxuLy8gKGZyZWRQZW5kaW5nRmxvYXRpbmdBZGQpLCBkZXIgbnVyIGJlaW0gTkVVRU4gQW5sZWdlbiBncmVpZnQgLSBkaWVzZXIgVG9nZ2xlXG4vLyB3aXJrdCBhdWYgSkVERSBiZXJlaXRzIHZvcmhhbmRlbmUgUHJvcGVydHksIGluIGJlaWRlIFJpY2h0dW5nZW4uXG4vL1xuLy8gT2JzaWRpYW5zIFByb3BlcnR5LUtvbnRleHRtZW5cdTAwRkMgaXN0IGtlaW5lIG9mZml6aWVsbGUgRXJ3ZWl0ZXJ1bmdzc3RlbGxlOiBFc1xuLy8gYmF1dCBhdWYgZGVtIERlc2t0b3AgZWluZW4gTkFUSVZFTiBFbGVjdHJvbi1NZW5cdTAwRkMgYXVzIGVpbmVyIGludGVyblxuLy8gZXJ6ZXVndGVuIE1lbnUtSW5zdGFueiB1bmQgemVpZ3Qgc2llIGlubmVyaGFsYiB2b24gc2hvd1Byb3BlcnR5TWVudSgpIGluXG4vLyBlaW5lbSBlaW56aWdlbiBzeW5jaHJvbmVuIEF1ZnJ1ZiBhbiAoa2VpbiBXb3Jrc3BhY2UtRXZlbnQsIGtlaW4gRE9NLVBvcHVwLFxuLy8gZGFzIHNpY2ggbmFjaHRyXHUwMEU0Z2xpY2ggcGVyIERPTS1NYW5pcHVsYXRpb24gZXJ3ZWl0ZXJuIGxpZVx1MDBERmUgLSBhbmRlcnMgYWxzXG4vLyB6LiBCLiBiZWkgXCJmaWxlLW1lbnVcIikuIERlc2hhbGIgaGllciBlaW4gTW9ua2V5LVBhdGNoIGF1ZiBkaWUgcHJpdmF0ZVxuLy8gWmVpbGVuLUtsYXNzZSBzZWxic3QgKHdpZSBzY2hvbiBiZWltIEdyYXBoLVJlbmRlcmVyLCBzaWVoZVxuLy8gZ3JhcGgtY29sb3JzLmpzKSwgYWJlciBzbyBlbmcgd2llIG1cdTAwRjZnbGljaCBnZWhhbHRlbjogZlx1MDBGQ3IgWmVpbGVuIGRpZXNlc1xuLy8gUGx1Z2lucyB3aXJkIGxlZGlnbGljaCwgdW5taXR0ZWxiYXIgYmV2b3IgT2JzaWRpYW4gc2VpbmUgYmVyZWl0cyBmZXJ0aWdcbi8vIGF1ZmdlYmF1dGUgTWVudS1JbnN0YW56IGFuemVpZ3QsIGVpbiBlaW56aWdlciB6dXNcdTAwRTR0emxpY2hlciBhZGRJdGVtKCktQXVmcnVmXG4vLyBkYXp3aXNjaGVuZ2VzY2hvYmVuIChcdTAwRkNiZXIgZWluZW4gbnVyIGZcdTAwRkNyIGRpZXNlbiBlaW5lbiBzeW5jaHJvbmVuIEF1ZnJ1ZlxuLy8gYWt0aXZlbiwgc2ljaCBkYW5hY2ggc2VsYnN0IHdpZWRlciB6dXJcdTAwRkNja3NldHplbmRlbiBQYXRjaCBhdWZcbi8vIE1lbnUucHJvdG90eXBlLnNob3dBdE1vdXNlRXZlbnQgLSBzaWNoZXIsIGRhIEpTIHNpbmdsZS10aHJlYWRlZCBpc3QgdW5kXG4vLyB3XHUwMEU0aHJlbmRkZXNzZW4ga2VpbiB6d2VpdGVzIE1lblx1MDBGQyBhdWZnZWJhdXQgd2VyZGVuIGthbm4pLiBEaWUgZ2VzYW10ZSBcdTAwRkNicmlnZVxuLy8gbmF0aXZlIE1lblx1MDBGQy1Mb2dpayAoVHlwIFx1MDBFNG5kZXJuLCBBdXNzY2huZWlkZW4vS29waWVyZW4vRWluZlx1MDBGQ2dlbiwgRW50ZmVybmVuKVxuLy8gYmxlaWJ0IGRhYmVpIGtvbXBsZXR0IHVuYW5nZXRhc3RldC5cbmZ1bmN0aW9uIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoKGFwcCwgZWRpdG9yKSB7XG4gIGNvbnN0IFJvd0NsYXNzID0gZ2V0UHJvcGVydHlSb3dDbGFzcyhhcHAsIGVkaXRvcik7XG4gIGlmICghUm93Q2xhc3MgfHwgUm93Q2xhc3MuX2ZyZWRNZW51UGF0Y2hlZCkgcmV0dXJuO1xuICBSb3dDbGFzcy5fZnJlZE1lbnVQYXRjaGVkID0gdHJ1ZTtcblxuICBjb25zdCBvcmlnaW5hbFNob3dQcm9wZXJ0eU1lbnUgPSBSb3dDbGFzcy5wcm90b3R5cGUuc2hvd1Byb3BlcnR5TWVudTtcbiAgUm93Q2xhc3MucHJvdG90eXBlLnNob3dQcm9wZXJ0eU1lbnUgPSBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICBjb25zdCBvd25lciA9IHRoaXMubWV0YWRhdGFFZGl0b3I/Lm93bmVyO1xuICAgIGlmICghb3duZXI/LmZyZWRTdG9yZSkgcmV0dXJuIG9yaWdpbmFsU2hvd1Byb3BlcnR5TWVudS5jYWxsKHRoaXMsIGV2ZW50KTtcblxuICAgIGNvbnN0IHJvdyA9IHRoaXM7XG4gICAgY29uc3Qgb3JpZ2luYWxTaG93QXRNb3VzZUV2ZW50ID0gTWVudS5wcm90b3R5cGUuc2hvd0F0TW91c2VFdmVudDtcbiAgICBNZW51LnByb3RvdHlwZS5zaG93QXRNb3VzZUV2ZW50ID0gZnVuY3Rpb24gKG1vdXNlRXZlbnQpIHtcbiAgICAgIE1lbnUucHJvdG90eXBlLnNob3dBdE1vdXNlRXZlbnQgPSBvcmlnaW5hbFNob3dBdE1vdXNlRXZlbnQ7XG4gICAgICBjb25zdCBpc0Zsb2F0aW5nID0gb3duZXIuZnJlZFN0b3JlLmdldEZsb2F0aW5nKCkuaW5jbHVkZXMocm93LmVudHJ5LmtleSk7XG4gICAgICAvLyBcInRpdGxlXCIgaXN0IGRpZSBlcnN0ZSBkZXIgdm9uIHNob3dQcm9wZXJ0eU1lbnUgcmVnaXN0cmllcnRlblxuICAgICAgLy8gU2VjdGlvbnMgKGFkZFNlY3Rpb25zKFsuLi5dKSkgdW5kIGF1ZiBkZW0gRGVza3RvcCBzb25zdCBsZWVyIChudXJcbiAgICAgIC8vIGF1ZiBNb2JpbGUgbWl0IGVpbmVtIHJlaW5lbiBMYWJlbC1FaW50cmFnIGJlbGVndCkgLSBsYW5kZXQgYWxzb1xuICAgICAgLy8genV2ZXJsXHUwMEU0c3NpZyBnYW56IG9iZW4uIFwicGluLW9mZlwiIChkdXJjaGdlc3RyaWNoZW5lciBQaW4pIHBhc3N0XG4gICAgICAvLyBpbmhhbHRsaWNoIHp1IFwibmljaHQgZmVzdCB2ZXJhbmtlcnRcIiA9IGZsb2F0aW5nLCBpbiBBbmFsb2dpZSB6dVxuICAgICAgLy8gXCJwaW5cIiBmXHUwMEZDciBcImZpeGllcnRcIiBpbiBhbmRlcmVuIEFwcHMuXG4gICAgICB0aGlzLmFkZEl0ZW0oKGl0ZW0pID0+XG4gICAgICAgIGl0ZW1cbiAgICAgICAgICAuc2V0VGl0bGUoXCJGbG9hdGluZ1wiKVxuICAgICAgICAgIC5zZXRJY29uKFwicGluLW9mZlwiKVxuICAgICAgICAgIC5zZXRDaGVja2VkKGlzRmxvYXRpbmcpXG4gICAgICAgICAgLnNldFNlY3Rpb24oXCJ0aXRsZVwiKVxuICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHRvZ2dsZUZsb2F0aW5nUHJvcGVydHkob3duZXIuZnJlZFZpZXcsIG93bmVyLmZyZWRTdG9yZSwgcm93LmVudHJ5LmtleSkpXG4gICAgICApO1xuICAgICAgcmV0dXJuIG9yaWdpbmFsU2hvd0F0TW91c2VFdmVudC5jYWxsKHRoaXMsIG1vdXNlRXZlbnQpO1xuICAgIH07XG5cbiAgICByZXR1cm4gb3JpZ2luYWxTaG93UHJvcGVydHlNZW51LmNhbGwodGhpcywgZXZlbnQpO1xuICB9O1xufVxuXG5mdW5jdGlvbiB0b2dnbGVGbG9hdGluZ1Byb3BlcnR5KHZpZXcsIHN0b3JlLCBrZXkpIHtcbiAgY29uc3QgZmxvYXRpbmcgPSBzdG9yZS5nZXRGbG9hdGluZygpO1xuICBzdG9yZS5zZXRGbG9hdGluZyhmbG9hdGluZy5pbmNsdWRlcyhrZXkpID8gZmxvYXRpbmcuZmlsdGVyKChrKSA9PiBrICE9PSBrZXkpIDogWy4uLmZsb2F0aW5nLCBrZXldKTtcbiAgdmlldy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gIC8vIEFrdHVhbGlzaWVydCBkaWUgRmV0dC0vS3Vyc2l2LU1hcmtpZXJ1bmcgc29mb3J0IC0gc293b2hsIGluIGRpZXNlclxuICAvLyBEZXRhaWxhbnNpY2h0IGFscyBhdWNoIGluIGJlcmVpdHMgb2ZmZW5lbiBOb3RpemVuIGRpZXNlcyBUeXBzLlxuICB2aWV3LnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbn1cblxuLy8gRGFzIFdpZGdldCBlcndhcnRldCBhbHMgendlaXRlbiBLb25zdHJ1a3Rvci1QYXJhbWV0ZXIgZWluIFwib3duZXJcIi1PYmpla3QgLVxuLy8gZGFzIGlzdCBkaWUgZWluemlnZSBTY2huaXR0c3RlbGxlLCBcdTAwRkNiZXIgZGllIGVzIGFuIGVpbmUgRGF0ZWkgZ2VidW5kZW4gd2lyZC5cbi8vIFN0YXR0IGVpbmVyIGVjaHRlbiBOb3RpeiBoXHUwMEU0bmdlbiB3aXIgZXMgaGllciBhbiBlaW4gUGxhaW4tT2JqZWN0IGluIGRlblxuLy8gUGx1Z2luLVNldHRpbmdzOiBzYXZlRnJvbnRtYXR0ZXIob2JqKSBiZWtvbW10IGJlaSBqZWRlciBcdTAwQzRuZGVydW5nIChQcm9wZXJ0eVxuLy8gaGluenVnZWZcdTAwRkNndC91bWJlbmFubnQvZ2VsXHUwMEY2c2NodCwgV2VydCBnZVx1MDBFNG5kZXJ0LCBSZWloZW5mb2xnZSBnZVx1MDBFNG5kZXJ0KSBkYXNcbi8vIHZvbGxzdFx1MDBFNG5kaWdlLCBha3R1ZWxsZSBQcm9wZXJ0eS1TZXQgXHUwMEZDYmVyZ2ViZW4uIHNoaWZ0Rm9jdXNCZWZvcmUvQWZ0ZXIgc3RldWVyblxuLy8gbnVyLCB3b2hpbiBkZXIgRm9rdXMgYmVpbSBWZXJsYXNzZW4gZGVzIFdpZGdldHMgcGVyIFBmZWlsdGFzdGUvVGFiIHNwcmluZ3QsXG4vLyB1bmQgZFx1MDBGQ3JmZW4gTm8tT3BzIHNlaW4uIGdldEZpbGUoKSB3aXJkIHZvbiBqZWRlciBlaW56ZWxuZW4gUHJvcGVydHktWmVpbGVcbi8vIGJlaW0gUmVuZGVybiBhdWZnZXJ1ZmVuIChmXHUwMEZDciBzb3VyY2VQYXRoLCB6LiBCLiBiZWkgTGluay1XZXJ0ZW4pIC0gb2huZVxuLy8gZWNodGUgRGF0ZWkgZ2lidCBlcyBoaWVyIG5pY2h0cyBTaW5udm9sbGVzIHp1clx1MDBGQ2NrenVnZWJlbiwgYWJlciBkaWUgTWV0aG9kZVxuLy8gbXVzcyBleGlzdGllcmVuLCBzb25zdCBjcmFzaHQgZGFzIFdpZGdldCBiZWltIFJlbmRlcm4gamVkZXIgUHJvcGVydHkuXG4vL1xuLy8gRWluZSBFZGl0b3ItSW5zdGFueiBqZSBCbG9jayAoVFlQIGJ6dy4gU3VidHlwKSwgZ2VidW5kZW4gYW4gZGVuIFNwZWljaGVyb3J0XG4vLyBhdXMgc3RvcmUgKHNpZWhlIHR5cGVTdG9yZS9zdWJ0eXBlU3RvcmUpIC0gU3RhbmRhcmQtIHVuZCBGbG9hdGluZyBQcm9wZXJ0aWVzXG4vLyAoc2llaGUgdHlwZUZsb2F0aW5nS2V5cyBpbiBzZXR0aW5ncy5qcykgdGVpbGVuIHNpY2ggZGllc2VsYmUgTGlzdGUgdW5kXG4vLyBSZWloZW5mb2xnZSwgbnVyIEZsb2F0aW5nLW1hcmtpZXJ0ZSBLZXlzIHdlcmRlbiB2b24gZ2V0VHlwZURlZmF1bHRzKClcbi8vIChtYWluLmpzKSBuaWNodCBhdXRvbWF0aXNjaCBhdXNnZWxpZWZlcnQuIGVkaXRvci5mcmVkUGVuZGluZ0Zsb2F0aW5nQWRkIHdpcmRcbi8vIHZvbiB0eXAtdmlldy5qcyB2b3IgYWRkQmxhbmtQcm9wZXJ0eSgpIGdlc2V0enQsIHVtIGRpZSBhbHMgblx1MDBFNGNoc3Rlc1xuLy8gaGluenVnZWZcdTAwRkNndGUgKGJ6dy4gdW1iZW5hbm50ZSkgUHJvcGVydHkgYWxzIEZsb2F0aW5nIHp1IG1hcmtpZXJlbiAtIHNpZWhlXG4vLyBzYXZlRnJvbnRtYXR0ZXIgdW50ZW4uXG4vLyBUYXN0YXR1ci1OYXZpZ2F0aW9uIFx1MDBGQ2JlciBkaWUgR3JlbnplbiBlaW5lciBFZGl0b3ItSW5zdGFueiBoaW5hdXMgKHNpZWhlXG4vLyBmcm9udG1hdHRlci1ibG9ja3MuanMpOiBPYnNpZGlhbiBiZXdlZ3QgZGVuIEZva3VzIG51ciBpbm5lcmhhbGIgc2VpbmVyXG4vLyBlaWdlbmVuIFplaWxlbmxpc3RlIC0gYW0gb2JlcmVuIEVuZGUgc3ByaW5ndCBlciBhdWYgZGllIFx1MDBEQ2JlcnNjaHJpZnQgZGVzXG4vLyBFZGl0b3JzLCBhbSB1bnRlcmVuIGF1ZiBkZXNzZW4gXCJBZGQgcHJvcGVydHlcIi1CdXR0b24uIEJlaWRlIHNpbmQgaGllciBwZXJcbi8vIENTUyBhdXNnZWJsZW5kZXQsIGRpZSBLZXR0ZSBlbmRldGUgYWxzbyBhbSBCbG9ja3JhbmQuXG4vL1xuLy8gU3RhdHQgb3duZXIuc2hpZnRGb2N1c0JlZm9yZS9zaGlmdEZvY3VzQWZ0ZXIgKGRpZSBPYnNpZGlhbiBudXIgXHUwMEZDYmVyIGdlbmF1XG4vLyBkaWVzZSBiZWlkZW4gYXVzZ2VibGVuZGV0ZW4gRWxlbWVudGUgZXJyZWljaHQpIGRhaGVyIGVpbiBlaWdlbmVyIEhhbmRsZXIgaW5cbi8vIGRlciBDYXB0dXJlLVBoYXNlLCBkZXIgVk9SIGRlbSBIYW5kbGVyIGRlciBaZWlsZSBsXHUwMEU0dWZ0LiBFciBncmVpZnQgbnVyLCB3ZW5uXG4vLyBkaWUgWmVpbGUgU0VMQlNUIGRlbiBGb2t1cyBoYXQgKGV2ZW50LnRhcmdldCA9PT0gY29udGFpbmVyRWwgZGVyIFplaWxlKSAtXG4vLyBnZW5hdSBkaWUgQmVkaW5ndW5nLCB1bnRlciBkZXIgYXVjaCBPYnNpZGlhbiBzZWluZSBqL2stTmF2aWdhdGlvbiB6dWxcdTAwRTRzc3QsXG4vLyBiZWltIFRpcHBlbiBpbiBlaW5lbSBLZXktL1dlcnQtRmVsZCBhbHNvIG5pZS5cbmZ1bmN0aW9uIHJlZ2lzdGVyRm9jdXNDaGFpbihlZGl0b3IsIG9uU2hpZnRGb2N1cykge1xuICBlZGl0b3IuY29udGFpbmVyRWwuYWRkRXZlbnRMaXN0ZW5lcihcbiAgICBcImtleWRvd25cIixcbiAgICAoZXZlbnQpID0+IHtcbiAgICAgIGlmIChldmVudC5pc0NvbXBvc2luZyB8fCBldmVudC5kZWZhdWx0UHJldmVudGVkKSByZXR1cm47XG4gICAgICAvLyBNZWhyZmFjaC1BdXN3YWhsOiBPYnNpZGlhbiBlcndlaXRlcnQgZGFtaXQgZGllIEF1c3dhaGwsIHN0YXR0IGRlblxuICAgICAgLy8gRm9rdXMgenUgYmV3ZWdlbi5cbiAgICAgIGlmIChlZGl0b3Iuc2VsZWN0ZWRMaW5lcz8uc2l6ZSA+IDEpIHJldHVybjtcbiAgICAgIGlmIChldmVudC5zaGlmdEtleSAmJiAoZXZlbnQua2V5ID09PSBcIkFycm93VXBcIiB8fCBldmVudC5rZXkgPT09IFwiQXJyb3dEb3duXCIpKSByZXR1cm47XG5cbiAgICAgIGNvbnN0IGluZGV4ID0gZWRpdG9yLnJlbmRlcmVkLmZpbmRJbmRleCgocm93KSA9PiByb3cuY29udGFpbmVyRWwgPT09IGV2ZW50LnRhcmdldCk7XG4gICAgICBpZiAoaW5kZXggPT09IC0xKSByZXR1cm47XG5cbiAgICAgIGNvbnN0IHVwID0gZXZlbnQua2V5ID09PSBcIkFycm93VXBcIiB8fCBldmVudC5rZXkgPT09IFwia1wiIHx8IChldmVudC5rZXkgPT09IFwiVGFiXCIgJiYgZXZlbnQuc2hpZnRLZXkpO1xuICAgICAgY29uc3QgZG93biA9IGV2ZW50LmtleSA9PT0gXCJBcnJvd0Rvd25cIiB8fCBldmVudC5rZXkgPT09IFwialwiIHx8IChldmVudC5rZXkgPT09IFwiVGFiXCIgJiYgIWV2ZW50LnNoaWZ0S2V5KTtcbiAgICAgIGxldCBzdGVwID0gMDtcbiAgICAgIGlmICh1cCAmJiBpbmRleCA9PT0gMCkgc3RlcCA9IC0xO1xuICAgICAgZWxzZSBpZiAoZG93biAmJiBpbmRleCA9PT0gZWRpdG9yLnJlbmRlcmVkLmxlbmd0aCAtIDEpIHN0ZXAgPSAxO1xuICAgICAgaWYgKHN0ZXAgPT09IDAgfHwgIW9uU2hpZnRGb2N1cyhzdGVwKSkgcmV0dXJuO1xuXG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgfSxcbiAgICB0cnVlXG4gICk7XG59XG5cbmZ1bmN0aW9uIG1vdW50RnJvbnRtYXR0ZXJFZGl0b3IodmlldywgY29udGFpbmVyRWwsIHN0b3JlLCB7IG9uU2hpZnRGb2N1cyB9ID0ge30pIHtcbiAgY29uc3QgYXBwID0gdmlldy5hcHA7XG4gIGNvbnN0IEVkaXRvckNsYXNzID0gZ2V0TWV0YWRhdGFFZGl0b3JDbGFzcyhhcHApO1xuICBpZiAoIUVkaXRvckNsYXNzKSB7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJwXCIsIHtcbiAgICAgIGNsczogXCJmcmVkLXR5cC1mcm9udG1hdHRlci11bmF2YWlsYWJsZVwiLFxuICAgICAgdGV4dDogXCJadW0gSW5pdGlhbGlzaWVyZW4gZGVzIEVkaXRvcnMgYml0dGUgenVlcnN0IGVpbm1hbCBlaW5lIE5vdGl6IFx1MDBGNmZmbmVuLlwiLFxuICAgIH0pO1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3Qgb3duZXIgPSB7XG4gICAgYXBwLFxuICAgIC8vIE1hcmtlciBmXHUwMEZDciBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaCgpIG9iZW46IGlkZW50aWZpemllcnQgUHJvcGVydHktXG4gICAgLy8gWmVpbGVuIGRpZXNlcyBQbHVnaW4tZWlnZW5lbiBFZGl0b3JzIChuaWUgZWluZXIgZWNodGVuIE5vdGl6KSB1bmRcbiAgICAvLyBsaWVmZXJ0IFNwZWljaGVyb3J0L1ZpZXcsIGRpZSBkZXIgZ2xvYmFsZSBNZW5cdTAwRkMtUGF0Y2ggcHJvIFplaWxlXG4gICAgLy8gZHluYW1pc2NoIGJyYXVjaHQgKGRpZSBQYXRjaC1JbnN0YWxsYXRpb24gc2VsYnN0IHBhc3NpZXJ0IG51ciBlaW5tYWwsXG4gICAgLy8gdW5hYmhcdTAwRTRuZ2lnIGRhdm9uLCB3ZWxjaGVyIEJsb2NrIGRhYmVpIGdlcmFkZSBvZmZlbiB3YXIpLlxuICAgIGZyZWRTdG9yZTogc3RvcmUsXG4gICAgZnJlZFZpZXc6IHZpZXcsXG4gICAgZ2V0RmlsZSgpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH0sXG4gICAgLy8gTnVyIGZcdTAwRkNyIE9ic2lkaWFucyBIb3Zlci1QcmV2aWV3IGJlaSBpbnRlcm5lbiBMaW5rcyBpbm5lcmhhbGIgZWluZXNcbiAgICAvLyBQcm9wZXJ0eS1XZXJ0cyAoRXZlbnQgXCJob3Zlci1saW5rXCIpIC0gYmVsaWViaWdlciBTdHJpbmcgcmVpY2h0LlxuICAgIGdldEhvdmVyU291cmNlKCkge1xuICAgICAgcmV0dXJuIFwiZnJlZC10eXAtZnJvbnRtYXR0ZXJcIjtcbiAgICB9LFxuICAgIHNoaWZ0Rm9jdXNCZWZvcmUoKSB7fSxcbiAgICBzaGlmdEZvY3VzQWZ0ZXIoKSB7fSxcbiAgICAvLyBPYnNpZGlhbnMgRWRpdG9yIHJ1ZnQgZGllcyBnZW5hdSBlaW5tYWwgcHJvIGFiZ2VzY2hsb3NzZW5lciBcdTAwQzRuZGVydW5nIGF1ZlxuICAgIC8vIChSZW5hbWUgZXJzdCBiZWltIEJsdXIgZGVzIEtleS1JbnB1dHMsIHNpZWhlIGhhbmRsZVVwZGF0ZUtleSBpbVxuICAgIC8vIGdlYmF1dGVuIGFwcC5qcykgLSBqZWRlciBBdWZydWYgdHJcdTAwRTRndCBoaWVyIGFsc28gbWF4aW1hbCBlaW5lXG4gICAgLy8gaGluenVnZWZcdTAwRkNndGUgdW5kL29kZXIgZW50ZmVybnRlIChuaWNodC1sZWVyZSkgUHJvcGVydHksIG5pZSBtZWhyZXJlXG4gICAgLy8gZ2xlaWNoemVpdGlnIGF1XHUwMERGZXIgYmVpIGVpbmVtIE1laHJmYWNoLUxcdTAwRjZzY2hlbi4gRGFzIG1hY2h0IGRpZVxuICAgIC8vIEZsb2F0aW5nLU1hcmtpZXJ1bmcgdW50ZW4gcm9idXN0IG5hY2hmXHUwMEZDaHJiYXIsIG9obmUgWndpc2NoZW56dXN0XHUwMEU0bmRlXG4gICAgLy8gd1x1MDBFNGhyZW5kIGRlcyBUaXBwZW5zIHZlcmZvbGdlbiB6dSBtXHUwMEZDc3Nlbi5cbiAgICBzYXZlRnJvbnRtYXR0ZXIoZnJvbnRtYXR0ZXIpIHtcbiAgICAgIC8vIEZhbGxzIGhpZXIgZ2VyYWRlIGVpbmUgWmVpbGUgXCJUWVBcIi9cIlNVQlRZUFwiIGVpbmdlZ2ViZW4gd3VyZGU6IG5pY2h0IFx1MDBGQ2Jlcm5laG1lbi5cbiAgICAgIC8vIFNpZSBibGVpYnQgYmlzIHp1bSBuXHUwMEU0Y2hzdGVuIE5ldS1Nb3VudGVuIHNpY2h0YmFyIChrZWluIGVybmV1dGVyXG4gICAgICAvLyBzeW5jaHJvbml6ZSgpLUF1ZnJ1ZiBoaWVyLCBzaWVoZSBLb21tZW50YXIgYW4gc3RyaXBUeXBQcm9wZXJ0eSkuXG4gICAgICBzdHJpcFR5cFByb3BlcnR5KGZyb250bWF0dGVyKTtcblxuICAgICAgY29uc3QgcHJldmlvdXMgPSBzdG9yZS5nZXRGcm9udG1hdHRlcigpO1xuICAgICAgY29uc3QgcHJldmlvdXNLZXlzID0gT2JqZWN0LmtleXMocHJldmlvdXMpLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwiXCIpO1xuICAgICAgY29uc3QgY3VycmVudEtleXMgPSBPYmplY3Qua2V5cyhmcm9udG1hdHRlcikuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gXCJcIik7XG4gICAgICBjb25zdCByZW1vdmVkS2V5cyA9IHByZXZpb3VzS2V5cy5maWx0ZXIoKGtleSkgPT4gIWN1cnJlbnRLZXlzLmluY2x1ZGVzKGtleSkpO1xuICAgICAgY29uc3QgYWRkZWRLZXlzID0gY3VycmVudEtleXMuZmlsdGVyKChrZXkpID0+ICFwcmV2aW91c0tleXMuaW5jbHVkZXMoa2V5KSk7XG5cbiAgICAgIGxldCBmbG9hdGluZyA9IHN0b3JlLmdldEZsb2F0aW5nKCk7XG4gICAgICBpZiAocmVtb3ZlZEtleXMubGVuZ3RoID09PSAxICYmIGFkZGVkS2V5cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgLy8gVW1iZW5lbm51bmcgZWluZXIgYmVzdGVoZW5kZW4gUHJvcGVydHkgLSBGbG9hdGluZy1NYXJraWVydW5nIHdhbmRlcnQgbWl0IHVtLlxuICAgICAgICBmbG9hdGluZyA9IGZsb2F0aW5nLm1hcCgoa2V5KSA9PiAoa2V5ID09PSByZW1vdmVkS2V5c1swXSA/IGFkZGVkS2V5c1swXSA6IGtleSkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKHJlbW92ZWRLZXlzLmxlbmd0aCA+IDApIGZsb2F0aW5nID0gZmxvYXRpbmcuZmlsdGVyKChrZXkpID0+ICFyZW1vdmVkS2V5cy5pbmNsdWRlcyhrZXkpKTtcbiAgICAgICAgaWYgKGVkaXRvci5mcmVkUGVuZGluZ0Zsb2F0aW5nQWRkICYmIGFkZGVkS2V5cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgICBmbG9hdGluZyA9IFsuLi5mbG9hdGluZywgYWRkZWRLZXlzWzBdXTtcbiAgICAgICAgICBlZGl0b3IuZnJlZFBlbmRpbmdGbG9hdGluZ0FkZCA9IGZhbHNlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICAvLyBTaG9ydGN1dHMgaFx1MDBFNG5nZW4gYW0gS2V5LCBuaWNodCBhbSBXZXJ0IChzaWVoZSBzaG9ydGN1dHMuanMpIHVuZCBtXHUwMEZDc3NlblxuICAgICAgLy8gZGVzaGFsYiBnZW5hdSB3aWUgZGllIEZsb2F0aW5nLU1hcmtpZXJ1bmcgbmFjaGdlZlx1MDBGQ2hydCB3ZXJkZW46IGJlaSBlaW5lclxuICAgICAgLy8gVW1iZW5lbm51bmcgbWl0d2FuZGVybiwgYmVpIGVpbmVtIExcdTAwRjZzY2hlbiBtaXQgdmVyc2Nod2luZGVuLlxuICAgICAgY29uc3Qgc2hvcnRjdXRzID0geyAuLi5zdG9yZS5nZXRTaG9ydGN1dHMoKSB9O1xuICAgICAgaWYgKHJlbW92ZWRLZXlzLmxlbmd0aCA9PT0gMSAmJiBhZGRlZEtleXMubGVuZ3RoID09PSAxKSB7XG4gICAgICAgIGlmIChzaG9ydGN1dHNbcmVtb3ZlZEtleXNbMF1dKSB7XG4gICAgICAgICAgc2hvcnRjdXRzW2FkZGVkS2V5c1swXV0gPSBzaG9ydGN1dHNbcmVtb3ZlZEtleXNbMF1dO1xuICAgICAgICAgIGRlbGV0ZSBzaG9ydGN1dHNbcmVtb3ZlZEtleXNbMF1dO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmb3IgKGNvbnN0IGtleSBvZiByZW1vdmVkS2V5cykgZGVsZXRlIHNob3J0Y3V0c1trZXldO1xuICAgICAgfVxuXG4gICAgICBzdG9yZS5zZXRGcm9udG1hdHRlcihmcm9udG1hdHRlcik7XG4gICAgICBzdG9yZS5zZXRGbG9hdGluZyhmbG9hdGluZyk7XG4gICAgICBzdG9yZS5zZXRTaG9ydGN1dHMoc2hvcnRjdXRzKTtcbiAgICAgIHZpZXcucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgLy8gS25vcGYvQ2hpcCBhbiBkaWUgbmV1ZSBaZWlsZW4tIHVuZCBLZXktTGFnZSBhbnBhc3NlbiAtIGVpbmUgZ2VyYWRlXG4gICAgICAvLyBiZW5hbm50ZSBaZWlsZSBiZWtvbW10IHNvIGlocmVuIEtub3BmLCBlaW5lIGdlbFx1MDBGNnNjaHRlIG5pbW10IGlocmVuIG1pdC5cbiAgICAgIHJlbmRlclNob3J0Y3V0Q29udHJvbHModmlldywgZWRpdG9yLCBzdG9yZSk7XG4gICAgICAvLyBEYW1pdCBkaWUgRmV0dC0vS3Vyc2l2LU1hcmtpZXJ1bmcgaW4gYmVyZWl0cyBvZmZlbmVuIE5vdGl6ZW4gZGllc2VzXG4gICAgICAvLyBUeXBzIHNvZm9ydCBtaXR6aWVodCwgd2VubiBzaWNoIGhpZXIgZGllIFByb3BlcnR5LUxpc3RlIFx1MDBFNG5kZXJ0LlxuICAgICAgdmlldy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgfSxcbiAgfTtcblxuICBjb25zdCBlZGl0b3IgPSBuZXcgRWRpdG9yQ2xhc3MoYXBwLCBvd25lcik7XG4gIGVkaXRvci5mcmVkUGVuZGluZ0Zsb2F0aW5nQWRkID0gZmFsc2U7XG4gIGlmIChvblNoaWZ0Rm9jdXMpIHJlZ2lzdGVyRm9jdXNDaGFpbihlZGl0b3IsIG9uU2hpZnRGb2N1cyk7XG4gIC8vIEdyZW56dCBkaWUgU2hvcnRjdXQtUmVnZWxuIGluIHN0eWxlcy5jc3MgYXVmIGRpZXNlbiBFZGl0b3IgZWluLlxuICBlZGl0b3IuY29udGFpbmVyRWwuYWRkQ2xhc3MoRURJVE9SX0NMQVNTKTtcbiAgY29udGFpbmVyRWwuYXBwZW5kQ2hpbGQoZWRpdG9yLmNvbnRhaW5lckVsKTtcbiAgdmlldy5hZGRDaGlsZChlZGl0b3IpO1xuXG4gIGNvbnN0IGRlZmF1bHRzID0gc3RvcmUuZ2V0RnJvbnRtYXR0ZXIoKTtcbiAgY29uc3QgaGFkVHlwID0gT2JqZWN0LmtleXMoZGVmYXVsdHMpLnNvbWUoKGtleSkgPT4gU1lTVEVNX1BST1BFUlRJRVMuaW5jbHVkZXMoa2V5LnRyaW0oKS50b0xvd2VyQ2FzZSgpKSk7XG4gIHN0cmlwVHlwUHJvcGVydHkoZGVmYXVsdHMpO1xuICAvLyBFaW4gYmVpbSBMYWRlbiBub2NoIHZvcmhhbmRlbmVzIFRZUCAoei4gQi4gYXVzIGVpbmVyIFx1MDBFNGx0ZXJlbiBQbHVnaW4tVmVyc2lvbilcbiAgLy8gZGF1ZXJoYWZ0IGVudGZlcm5lbiwgc3RhdHQgZXMgbnVyIGZcdTAwRkNyIGRpZXNlIFNlc3Npb24genUgdmVyc3RlY2tlbi5cbiAgaWYgKGhhZFR5cCkgdmlldy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gIGVkaXRvci5zeW5jaHJvbml6ZShkZWZhdWx0cyk7XG4gIHJlbmRlclNob3J0Y3V0Q29udHJvbHModmlldywgZWRpdG9yLCBzdG9yZSk7XG4gIC8vIEVyc3QgbmFjaCBkZW0gZXJzdGVuIHN5bmNocm9uaXplKCkgdmVyc3VjaHQgKHNpZWhlIGdldFByb3BlcnR5Um93Q2xhc3MpIC1cbiAgLy8gYmVpIGVpbmVtIG5vY2ggZ2FueiBsZWVyZW4gVHlwIGhpZXIgZWluIE5vLU9wLCBob2x0IHNpY2ggYWJlciBzcFx1MDBFNHRlc3RlbnNcbiAgLy8gYmVpbSBuXHUwMEU0Y2hzdGVuIE1vdW50ZW4gZWluZXMgbmljaHQtbGVlcmVuIFR5cHMgKG9kZXIgYXVzIGVpbmVyIG9mZmVuZW5cbiAgLy8gTm90aXopIGRpZSBiZW5cdTAwRjZ0aWd0ZSBLbGFzc2VucmVmZXJlbnogYXV0b21hdGlzY2ggbmFjaC5cbiAgZW5zdXJlUHJvcGVydHlNZW51UGF0Y2goYXBwLCBlZGl0b3IpO1xuICByZXR1cm4gZWRpdG9yO1xufVxuXG5jb25zdCBDSElQX0NMQVNTID0gXCJmcmVkLXR5cC1zaG9ydGN1dC1jaGlwXCI7XG5jb25zdCBDSElQX1RFWFRfQ0xBU1MgPSBcImZyZWQtdHlwLXNob3J0Y3V0LWNoaXAtdGV4dFwiO1xuY29uc3QgQlVUVE9OX0NMQVNTID0gXCJmcmVkLXR5cC1zaG9ydGN1dC1idXR0b25cIjtcbmNvbnN0IFJPV19DTEFTUyA9IFwiZnJlZC10eXAtaGFzLXNob3J0Y3V0XCI7XG5jb25zdCBXQVJOSU5HX0NMQVNTID0gXCJmcmVkLXR5cC1zaG9ydGN1dC1ibG9ja2VkXCI7XG5cbi8vIEtub3BmIHVuZCBDaGlwIGplIFByb3BlcnR5LVplaWxlLiBCZWlkZSBoXHUwMEU0bmdlbiBhbSBjb250YWluZXJFbCBkZXIgWmVpbGUsIE5JQ0hUXG4vLyBhbiBkZXJlbiB2YWx1ZUVsOiBPYnNpZGlhbnMgcmVuZGVyUHJvcGVydHkoKSBsZWVydCBiZWkgamVkZW0gTmV1LVJlbmRlcm4gbnVyXG4vLyBkYXMgdmFsdWVFbCwgZGFzIGNvbnRhaW5lckVsIGRhZ2VnZW4gbmllIC0gd2FzIGhpZXIgZWlubWFsIGFuZ2VoXHUwMEU0bmd0IHd1cmRlLFxuLy8gXHUwMEZDYmVybGVidCBhbHNvIGplZGVuIFR5cC0vV2VydHdlY2hzZWwgdm9uIHNlbGJzdCwgb2huZSBFaW5ncmlmZiBpbiBPYnNpZGlhbnNcbi8vIFJlbmRlci1QaXBlbGluZS5cbi8vXG4vLyBEZXIgS25vcGYgaXN0IGVpbiBVbXNjaGFsdGVyOiBiZWkgZWluZXIgWmVpbGUgb2huZSBTaG9ydGN1dCBcdTAwRjZmZm5ldCBlciBkaWVcbi8vIEF1c3dhaGwsIGJlaSBlaW5lciBaZWlsZSBtaXQgU2hvcnRjdXQgZW50ZmVybnQgZXIgaWhuIHdpZWRlci4gWnVtIFdFQ0hTRUxOXG4vLyBkaWVudCBkZXIgQ2hpcCBzZWxic3QuIFNpY2h0YmFyIHdpcmQgZGVyIEtub3BmIHBlciBDU1MgbnVyIGJlaSBIb3Zlci9Gb2t1c1xuLy8gZGVyIFplaWxlICh1bmQgZGF1ZXJoYWZ0LCBzb2xhbmdlIGVpbiBTaG9ydGN1dCBnZXNldHp0IGlzdCkgLSBzb25zdCBzdFx1MDBGQ25kZSBpblxuLy8gamVkZXIgWmVpbGUgZGF1ZXJoYWZ0IGVpbiBCZWRpZW5lbGVtZW50LCBkYXMgZGllIG1laXN0ZW4gbmllIGJyYXVjaGVuLlxuLy9cbi8vIERhcyBBdXNibGVuZGVuIGRlcyBXZXJ0ZmVsZHMgYmVpIGdlc2V0enRlbSBTaG9ydGN1dCBtYWNodCBhbGxlaW4gQ1NTIChzaWVoZVxuLy8gUk9XX0NMQVNTIGluIHN0eWxlcy5jc3MpLiBEYXMgbmF0aXZlIFdpZGdldCByZW5kZXJ0IGRhcnVudGVyIHVudmVyXHUwMEU0bmRlcnRcbi8vIHdlaXRlciAtIFNldHplbiB1bmQgRW50ZmVybmVuIHNpbmQgZGVzaGFsYiBlaW4gcmVpbmVyIEtsYXNzZW4tVW1zY2hhbHRlciB1bmRcbi8vIGJyYXVjaGVuIGtlaW4gcmVuZGVyUHJvcGVydHkoKS9zeW5jaHJvbml6ZSgpLCB3YXMgaGllciBvaG5laGluIGhlaWtlbCB3XHUwMEU0cmVcbi8vIChzaWVoZSBLb21tZW50YXIgYW4gc3RyaXBUeXBQcm9wZXJ0eSkuXG5mdW5jdGlvbiByZW5kZXJTaG9ydGN1dENvbnRyb2xzKHZpZXcsIGVkaXRvciwgc3RvcmUpIHtcbiAgY29uc3Qgc2hvcnRjdXRzID0gc3RvcmUuZ2V0U2hvcnRjdXRzKCk7XG4gIGZvciAoY29uc3Qgcm93IG9mIGVkaXRvci5yZW5kZXJlZCA/PyBbXSkge1xuICAgIGNvbnN0IGNvbnRhaW5lckVsID0gcm93LmNvbnRhaW5lckVsO1xuICAgIGNvbnN0IGtleSA9IHJvdy5lbnRyeT8ua2V5ID8/IFwiXCI7XG4gICAgLy8gRWluZSBub2NoIG5hbWVubG9zZSBaZWlsZSBrYW5uIGtlaW5lbiBTaG9ydGN1dCB0cmFnZW4gLSBlcyBnXHUwMEU0YmUga2VpbmVuXG4gICAgLy8gU2NobFx1MDBGQ3NzZWwsIHVudGVyIGRlbSBlciBzdFx1MDBGQ25kZS4gRGVyIEtub3BmIGVyc2NoZWludCwgc29iYWxkIGVpbiBOYW1lXG4gICAgLy8gZWluZ2V0cmFnZW4gaXN0IChqZWRlIFx1MDBDNG5kZXJ1bmcgbFx1MDBFNHVmdCBkdXJjaCBzYXZlRnJvbnRtYXR0ZXIgdW5kIGRhbWl0XG4gICAgLy8gZXJuZXV0IGhpZXIgZHVyY2gpLlxuICAgIGNvbnN0IHJlY29yZCA9IGtleSA9PT0gXCJcIiA/IG51bGwgOiBzaG9ydGN1dHNba2V5XSA/PyBudWxsO1xuICAgIGNvbnRhaW5lckVsLnRvZ2dsZUNsYXNzKFJPV19DTEFTUywgISFyZWNvcmQpO1xuXG4gICAgLy8gT2JzaWRpYW5zIFdhcm5kcmVpZWNrIHNpdHp0IG5pY2h0IGltIEZsZXgtRmx1c3MgZGVyIFplaWxlLCBzb25kZXJuIGlzdFxuICAgIC8vIGFic29sdXQgYW4gZGVyZW4gcmVjaHRlbSBSYW5kIHZlcmFua2VydCAocG9zaXRpb246IGFic29sdXRlLFxuICAgIC8vIGluc2V0LWlubGluZS1lbmQvdG9wL2JvdHRvbTogdmFyKC0tc2l6ZS0yLTEpKSAtIGFsc28gZ2VuYXUgZG9ydCwgd28gYXVjaFxuICAgIC8vIGRlciBTaG9ydGN1dC1Lbm9wZiBzaXR6dC4gQmVpZGUgZ2xlaWNoemVpdGlnIGhpZVx1MDBERmU6IFx1MDBGQ2JlcmVpbmFuZGVyLiBaZWlndFxuICAgIC8vIGRpZSBaZWlsZSBlaW5lIFR5cC1XYXJudW5nIHVuZCBpc3QgS0VJTiBTaG9ydGN1dCBnZXNldHp0LCB3ZWljaHQgZGVyXG4gICAgLy8gS25vcGYuIEJlaSBnZXNldHp0ZW0gU2hvcnRjdXQgYmxlaWJ0IGVyIGRhZ2VnZW4gc3RlaGVuIC0gZXIgaXN0IGRlclxuICAgIC8vIGVpbnppZ2UgV2VnLCBkZW4gU2hvcnRjdXQgd2llZGVyIGxvc3p1d2VyZGVuIC0sIHVuZCBzdGF0dGRlc3NlbiB3ZWljaHRcbiAgICAvLyBkYXMgV2FybmRyZWllY2sgKHNpZWhlIHN0eWxlcy5jc3MpOiBlcyBiZXppZWh0IHNpY2ggZGFubiBhdWYgZGVuXG4gICAgLy8gYXVzZ2VibGVuZGV0ZW4gUlx1MDBGQ2NrZmFsbHdlcnQsIGlzdCBkb3J0IGFsc28gZ2FyIG5pY2h0IHp1IGJlaGViZW4uXG4gICAgY29uc3QgbWlzbWF0Y2ggPSAhIXJvdy50eXBlSW5mbyAmJiByb3cudHlwZUluZm8uZXhwZWN0ZWQgIT09IHJvdy50eXBlSW5mby5pbmZlcnJlZDtcbiAgICBjb250YWluZXJFbC50b2dnbGVDbGFzcyhXQVJOSU5HX0NMQVNTLCBtaXNtYXRjaCAmJiAhcmVjb3JkKTtcblxuICAgIGxldCBidXR0b25FbCA9IGNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3IoYDpzY29wZSA+IC4ke0JVVFRPTl9DTEFTU31gKTtcbiAgICBpZiAoa2V5ID09PSBcIlwiKSB7XG4gICAgICBidXR0b25FbD8ucmVtb3ZlKCk7XG4gICAgICBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKGA6c2NvcGUgPiAuJHtDSElQX0NMQVNTfWApPy5yZW1vdmUoKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoIWJ1dHRvbkVsKSB7XG4gICAgICBidXR0b25FbCA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogYGNsaWNrYWJsZS1pY29uICR7QlVUVE9OX0NMQVNTfWAgfSk7XG4gICAgICBzZXRJY29uKGJ1dHRvbkVsLCBcInNxdWFyZS1mdW5jdGlvblwiKTtcbiAgICAgIC8vIERlbiBLZXkgZXJzdCBiZWltIEtsaWNrIGF1cyBkZXIgWmVpbGUgbGVzZW4sIG5pY2h0IGhpZXIgZWluZmFuZ2VuIC1cbiAgICAgIC8vIGVpbmUgVW1iZW5lbm51bmcgXHUwMEU0bmRlcnQgcm93LmVudHJ5LmtleSwgb2huZSBkaWUgWmVpbGUgbmV1IGFuenVsZWdlbi5cbiAgICAgIGJ1dHRvbkVsLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICAgIGlmIChzdG9yZS5nZXRTaG9ydGN1dHMoKVtyb3cuZW50cnk/LmtleSA/PyBcIlwiXSkgcmVtb3ZlU2hvcnRjdXQodmlldywgZWRpdG9yLCBzdG9yZSwgcm93KTtcbiAgICAgICAgZWxzZSBvcGVuU2hvcnRjdXRQaWNrZXIodmlldywgZWRpdG9yLCBzdG9yZSwgcm93KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICBidXR0b25FbC5zZXRBdHRyKFwiYXJpYS1sYWJlbFwiLCByZWNvcmQgPyBcIlNob3J0Y3V0IGVudGZlcm5lblwiIDogXCJTaG9ydGN1dCBzZXR6ZW5cIik7XG5cbiAgICBsZXQgY2hpcEVsID0gY29udGFpbmVyRWwucXVlcnlTZWxlY3RvcihgOnNjb3BlID4gLiR7Q0hJUF9DTEFTU31gKTtcbiAgICBpZiAoIXJlY29yZCkge1xuICAgICAgY2hpcEVsPy5yZW1vdmUoKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoIWNoaXBFbCkge1xuICAgICAgY2hpcEVsID0gY3JlYXRlRWwoXCJjb2RlXCIsIHsgY2xzOiBDSElQX0NMQVNTIH0pO1xuICAgICAgLy8gRGVyIFRleHQgc3RlY2t0IGluIGVpbmVtIGVpZ2VuZW4gU3Bhbiwgd2VpbCBkZXIgQ2hpcCBzZWxic3QgZWluXG4gICAgICAvLyBGbGV4LUNvbnRhaW5lciBpc3QgKHZlcnRpa2FsZSBaZW50cmllcnVuZyB3aWUgYmVpbSBlY2h0ZW4gV2VydGZlbGQpIC1cbiAgICAgIC8vIHRleHQtb3ZlcmZsb3c6IGVsbGlwc2lzIGdyZWlmdCBhYmVyIG51ciBhdWYgZWluZW0gQmxvY2stRWxlbWVudCwgbmljaHRcbiAgICAgIC8vIGF1ZiBkZW0gRmxleC1Db250YWluZXIgZGFyXHUwMEZDYmVyLlxuICAgICAgY2hpcEVsLmNyZWF0ZVNwYW4oeyBjbHM6IENISVBfVEVYVF9DTEFTUyB9KTtcbiAgICAgIGNoaXBFbC5zZXRBdHRyKFwiYXJpYS1sYWJlbFwiLCBcIlNob3J0Y3V0IFx1MDBFNG5kZXJuXCIpO1xuICAgICAgY2hpcEVsLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiBvcGVuU2hvcnRjdXRQaWNrZXIodmlldywgZWRpdG9yLCBzdG9yZSwgcm93KSk7XG4gICAgICAvLyBWb3IgZGVtIEtub3BmIGVpbmhcdTAwRTRuZ2VuLCBkYW1pdCBkaWUgWmVpbGUgdW5hYmhcdTAwRTRuZ2lnIHZvbiBkZXJcbiAgICAgIC8vIEVudHN0ZWh1bmdzcmVpaGVuZm9sZ2UgaW1tZXIgXCJOYW1lIHwgQ2hpcCB8IEtub3BmXCIgbGllc3QuXG4gICAgICBjb250YWluZXJFbC5pbnNlcnRCZWZvcmUoY2hpcEVsLCBidXR0b25FbCk7XG4gICAgfVxuICAgIGNoaXBFbC5maXJzdEVsZW1lbnRDaGlsZC5zZXRUZXh0KHNob3J0Y3V0TGFiZWwocmVjb3JkKSk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gb3BlblNob3J0Y3V0UGlja2VyKHZpZXcsIGVkaXRvciwgc3RvcmUsIHJvdykge1xuICBjb25zdCBrZXkgPSByb3cuZW50cnk/LmtleSA/PyBcIlwiO1xuICBpZiAoa2V5ID09PSBcIlwiKSByZXR1cm47XG4gIC8vIERlbiBiaXNoZXJpZ2VuIFJlY29yZCBtaXRnZWJlbjogd2lyZCBkYXNzZWxiZSBTa3JpcHQgZXJuZXV0IGdld1x1MDBFNGhsdCwga29tbXRcbiAgLy8gZGVyIEFyZ3VtZW50LURpYWxvZyBtaXQgZGVuIGFrdHVlbGxlbiBXZXJ0ZW4gdm9yYmVsZWd0IC0gc28gaXN0IGRlciBLbGlja1xuICAvLyBhdWYgZGVuIENoaXAgYXVjaCBkZXIgV2VnLCBlaW56ZWxuZSBBcmd1bWVudGUgenUga29ycmlnaWVyZW4uXG4gIGNvbnN0IHJlY29yZCA9IGF3YWl0IHBpY2tTaG9ydGN1dCh2aWV3LmFwcCwga2V5LCB2aWV3LnBsdWdpbi5nZXRTaG9ydGN1dFNjcmlwdHMsIHN0b3JlLmdldFNob3J0Y3V0cygpW2tleV0gPz8gbnVsbCk7XG4gIGlmICghcmVjb3JkKSByZXR1cm47XG4gIC8vIFdcdTAwRTRocmVuZCBkZXIgRGlhbG9nIG9mZmVuIHdhciwga2FubiBkaWUgUHJvcGVydHkgdmVyc2Nod3VuZGVuIHNlaW4gKGV0d2FcbiAgLy8gd2VpbCBkaWUgQW5zaWNodCB6d2lzY2hlbnplaXRsaWNoIG5ldSBhdWZnZWJhdXQgd3VyZGUpLiBPaG5lIGRpZXNlIFByXHUwMEZDZnVuZ1xuICAvLyBibGllYmUgZGVyIFNob3J0Y3V0IGFscyBXYWlzZSBpbiBkZW4gRWluc3RlbGx1bmdlbiBzdGVoZW46IHNhdmVGcm9udG1hdHRlclxuICAvLyB6aWVodCBudXIgS2V5cyBuYWNoLCBkaWUgaW4gZGVyc2VsYmVuIEJlYXJiZWl0dW5nIGVudGZlcm50IHd1cmRlbiwgdW5kXG4gIC8vIGNvbGxlY3RCbG9ja3MgbFx1MDBFNHVmdCBvaG5laGluIG51ciBcdTAwRkNiZXIgdm9yaGFuZGVuZSBGcm9udG1hdHRlci1LZXlzIC0gZGVyXG4gIC8vIEVpbnRyYWcgd1x1MDBFNHJlIGFsc28gdW5zaWNodGJhciB1bmQgd1x1MDBGQ3JkZSBuaWUgd2llZGVyIGF1Zmdlclx1MDBFNHVtdC5cbiAgaWYgKCFPYmplY3QuaGFzT3duKHN0b3JlLmdldEZyb250bWF0dGVyKCksIGtleSkpIHJldHVybjtcbiAgc3RvcmUuc2V0U2hvcnRjdXRzKHsgLi4uc3RvcmUuZ2V0U2hvcnRjdXRzKCksIFtrZXldOiByZWNvcmQgfSk7XG4gIHNhdmVTaG9ydGN1dHModmlldywgZWRpdG9yLCBzdG9yZSk7XG59XG5cbmZ1bmN0aW9uIHJlbW92ZVNob3J0Y3V0KHZpZXcsIGVkaXRvciwgc3RvcmUsIHJvdykge1xuICBjb25zdCBrZXkgPSByb3cuZW50cnk/LmtleSA/PyBcIlwiO1xuICBjb25zdCBzaG9ydGN1dHMgPSB7IC4uLnN0b3JlLmdldFNob3J0Y3V0cygpIH07XG4gIGlmICghKGtleSBpbiBzaG9ydGN1dHMpKSByZXR1cm47XG4gIGRlbGV0ZSBzaG9ydGN1dHNba2V5XTtcbiAgc3RvcmUuc2V0U2hvcnRjdXRzKHNob3J0Y3V0cyk7XG4gIHNhdmVTaG9ydGN1dHModmlldywgZWRpdG9yLCBzdG9yZSk7XG59XG5cbmZ1bmN0aW9uIHNhdmVTaG9ydGN1dHModmlldywgZWRpdG9yLCBzdG9yZSkge1xuICB2aWV3LnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgcmVuZGVyU2hvcnRjdXRDb250cm9scyh2aWV3LCBlZGl0b3IsIHN0b3JlKTtcbn1cblxuLy8gRWlnZW5lLCBlaW5mYWNoZSBcIlByb3BlcnR5IGhpbnp1Zlx1MDBGQ2dlblwiLUZ1bmt0aW9uIHN0YXR0IGRlcyBpbnRlcm5lblxuLy8gZWRpdG9yLmFkZFByb3BlcnR5KCk6IGZcdTAwRkNndCBlaW5lbiBsZWVyZW4gS2V5IG1pdCBXZXJ0IG51bGwgYW4gdW5kIGxcdTAwRTRzc3QgZGFzXG4vLyBXaWRnZXQgZGllIFplaWxlIGdhbnogbm9ybWFsIHJlbmRlcm4gKGRpZXNlbGJlIE9wdGlrIHdpZSBpbiBlaW5lciBlY2h0ZW5cbi8vIE5vdGl6LCBkYSBzeW5jaHJvbml6ZSgpIHVudmVyXHUwMEU0bmRlcnQgT2JzaWRpYW5zIGVpZ2VuZSBSZW5kZXItUGlwZWxpbmVcbi8vIGR1cmNobFx1MDBFNHVmdCkgLSBkZXIgRm9rdXMgc3ByaW5ndCBhbnNjaGxpZVx1MDBERmVuZCBpbnMgS2V5LUZlbGQgZGVyIG5ldWVuIFplaWxlLlxuZnVuY3Rpb24gYWRkQmxhbmtQcm9wZXJ0eShlZGl0b3IpIHtcbiAgaWYgKCFlZGl0b3IpIHJldHVybjtcbiAgY29uc3QgY3VycmVudCA9IGVkaXRvci5zZXJpYWxpemUoKTtcbiAgaWYgKCFjdXJyZW50Lmhhc093blByb3BlcnR5KFwiXCIpKSB7XG4gICAgY3VycmVudFtcIlwiXSA9IG51bGw7XG4gICAgZWRpdG9yLnN5bmNocm9uaXplKGN1cnJlbnQpO1xuICAgIC8vIHN5bmNocm9uaXplKCkgbGVndCBkaWUgbmV1ZSBaZWlsZSBhbiAtIGRpZSBiZXN0ZWhlbmRlbiBaZWlsZW4gYmVoYWx0ZW5cbiAgICAvLyBkYWJlaSB6d2FyIGlocmVuIEtub3BmIChlciBoXHUwMEU0bmd0IGFtIGNvbnRhaW5lckVsLCBzaWVoZVxuICAgIC8vIHJlbmRlclNob3J0Y3V0Q29udHJvbHMpLCBkaWUgbmV1ZSBoYXQgYWJlciBub2NoIGtlaW5lbi5cbiAgICByZW5kZXJTaG9ydGN1dENvbnRyb2xzKGVkaXRvci5vd25lci5mcmVkVmlldywgZWRpdG9yLCBlZGl0b3Iub3duZXIuZnJlZFN0b3JlKTtcbiAgfVxuICBlZGl0b3IuZm9jdXNLZXkoXCJcIik7XG4gIC8vIERlY2t0IGRlbiBGYWxsIGFiLCBkYXNzIG1vdW50RnJvbnRtYXR0ZXJFZGl0b3IoKSBiZWkgZWluZW0genUgZGllc2VtXG4gIC8vIFplaXRwdW5rdCBub2NoIGdhbnogbGVlcmVuIFR5cCAodW5kIG9obmUgb2ZmZW5lIE5vdGl6KSBrZWluZSBaZWlsZW4tS2xhc3NlXG4gIC8vIHp1bSBQYXRjaGVuIGZpbmRlbiBrb25udGUgLSBqZXR6dCBleGlzdGllcnQgbWl0IGRlciBnZXJhZGUgYW5nZWxlZ3RlblxuICAvLyBaZWlsZSBnYXJhbnRpZXJ0IG1pbmRlc3RlbnMgZWluZS5cbiAgZW5zdXJlUHJvcGVydHlNZW51UGF0Y2goZWRpdG9yLm93bmVyLmFwcCwgZWRpdG9yKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IG1vdW50RnJvbnRtYXR0ZXJFZGl0b3IsIGFkZEJsYW5rUHJvcGVydHksIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoLCB0eXBlU3RvcmUsIHN1YnR5cGVTdG9yZSB9O1xuIiwgImNvbnN0IHsgbW91bnRGcm9udG1hdHRlckVkaXRvciwgYWRkQmxhbmtQcm9wZXJ0eSwgdHlwZVN0b3JlLCBzdWJ0eXBlU3RvcmUgfSA9IHJlcXVpcmUoXCIuL3R5cGUtZnJvbnRtYXR0ZXItZWRpdG9yXCIpO1xyXG5jb25zdCB7IGdldFNlY3Rpb25PcmRlciwgaXNFbXB0eVZhbHVlIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBlc1wiKTtcclxuXHJcbi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4gKiBEaWUgRnJvbnRtYXR0ZXItQmxcdTAwRjZja2UgZWluZXMgVFlQcyBpbiBkZXIgVFlQLURldGFpbGFuc2ljaHQgKHNpZWhlXHJcbiAqIHJlbmRlclR5cGVTZXR0aW5ncyBpbiB0eXAtdmlldy5qcyk6IHp1b2JlcnN0IGRhcyBUWVAtRnJvbnRtYXR0ZXIsIGRhcnVudGVyXHJcbiAqIGplIHJlZ2lzdHJpZXJ0ZW0gU3VidHlwIGVpbiBlaWdlbmVyIEJsb2NrLlxyXG4gKlxyXG4gKiBKZSBCbG9jayBlaW5lIGVpZ2VuZSBJbnN0YW56IHZvbiBPYnNpZGlhbnMgUHJvcGVydHktRWRpdG9yLCBnZWJ1bmRlbiBhblxyXG4gKiB0eXBlU3RvcmUgYnp3LiBzdWJ0eXBlU3RvcmUgKHNpZWhlIHR5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKS4gRGFkdXJjaFxyXG4gKiBkYXJmIGRlcnNlbGJlIEtleSBpbiBtZWhyZXJlbiBCbFx1MDBGNmNrZW4gc3RlaGVuIC0gaW5uZXJoYWxiIGVpbmVzIEJsb2NrcyBpc3RcclxuICogZXIgZHVyY2ggZGFzIEZyb250bWF0dGVyLU9iamVrdCBzZWxic3QgendhbmdzbFx1MDBFNHVmaWcgZWluZGV1dGlnLCBkYXJcdTAwRkNiZXJcclxuICogaGluYXVzIG5pY2h0IChzaWVoZSBLb21tZW50YXIgYW4gdHlwZVN1YnR5cGVzIGluIHN1YnR5cGVzLmpzKS5cclxuICpcclxuICogT2JzaWRpYW5zIGVpZ2VuZXMgWmVpbGVuLURyYWcgcmVpY2h0IG51ciBpbm5lcmhhbGIgZWluZXIgSW5zdGFuei4gRGFtaXRcclxuICogZWluZSBQcm9wZXJ0eSB0cm90emRlbSB2b24gQmxvY2sgenUgQmxvY2sgd2FuZGVybiBrYW5uLCBzZXR6dFxyXG4gKiByZWdpc3RlclByb3BlcnR5RHJhZygpIHVudGVuIGF1ZiBnZW5hdSBkaWVzZW0gRHJhZyBhdWYsIHN0YXR0IGVpbiBlaWdlbmVzXHJcbiAqIHp1IGJhdWVuLiBEaWUgVGFzdGF0dXItTmF2aWdhdGlvbiBcdTAwRkNiZXIgYWxsZSBCbFx1MDBGNmNrZSBzdGVja3QgaW5cclxuICogcmVnaXN0ZXJGb2N1c0NoYWluKCkgKHR5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKS5cclxuICpcclxuICogU2VjdGlvbjogbnVsbCA9IFRZUC1Gcm9udG1hdHRlciwgc29uc3QgZGVyIFN1YnR5cC1OYW1lLlxyXG4gKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi9cclxuXHJcbi8vIEFuZmFzc2JhciBmXHUwMEZDciBkYXMgVmVyc2NoaWViZW4gZWluZXMgZ2FuemVuIEJsb2NrcyBpc3QgYWxsZXMgYXVcdTAwREZlcmhhbGIgZGVyXHJcbi8vIFByb3BlcnR5LVplaWxlbiAtIFx1MDBEQ2JlcnNjaHJpZnQsIEFic2NobHVzcyB1bmQgZGllIHNlaXRsaWNoZW4gUlx1MDBFNG5kZXIuXHJcbi8vIEJlZGllbmVsZW1lbnRlIHVuZCBlaW4gZ2VyYWRlIGJlYXJiZWl0ZXRlciBUaXRlbCBibGVpYmVuIGF1c2dlbm9tbWVuLlxyXG5mdW5jdGlvbiBpc0dyYWJUYXJnZXQodGFyZ2V0KSB7XHJcbiAgaWYgKHRhcmdldC5jbG9zZXN0KFwiLmNsaWNrYWJsZS1pY29uLCAuZnJlZC10eXAtc3VidHlwZS1jb2xvci1kb3QsIFtjb250ZW50ZWRpdGFibGU9J3RydWUnXSwgaW5wdXQsIHRleHRhcmVhXCIpKSByZXR1cm4gZmFsc2U7XHJcbiAgcmV0dXJuICF0YXJnZXQuY2xvc2VzdChcIi5tZXRhZGF0YS1wcm9wZXJ0eVwiKTtcclxufVxyXG5cclxuLy8gcmVuZGVySGVhZGVyKHNlY3Rpb24sIGVsLCBibG9ja3MpIC8gcmVuZGVyRm9vdGVyKHNlY3Rpb24sIGVsLCBibG9ja3MpIGZcdTAwRkNsbGVuXHJcbi8vIFx1MDBEQ2JlcnNjaHJpZnQgYnp3LiBBYnNjaGx1c3MgZWluZXMgQmxvY2tzLiBvbk1vdmVTZWN0aW9uKG9yZGVyKSBtZWxkZXQgZGllXHJcbi8vIG5ldWUgQmxvY2stUmVpaGVuZm9sZ2UgbmFjaCBlaW5lbSBCbG9jay1EcmFnICh3aWUgZ2V0U2VjdGlvbk9yZGVyLCBzYW10XHJcbi8vIGZcdTAwRkNocmVuZGVtIG51bGwgZlx1MDBGQ3IgZGFzIFRZUC1Gcm9udG1hdHRlcikuXHJcbmZ1bmN0aW9uIG1vdW50RnJvbnRtYXR0ZXJCbG9ja3ModmlldywgY29udGFpbmVyRWwsIHR5cGUsIHsgcmVuZGVySGVhZGVyLCByZW5kZXJGb290ZXIsIG9uTW92ZVNlY3Rpb24gfSkge1xyXG4gIGNvbnN0IHdyYXBwZXIgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtYmxvY2tzXCIgfSk7XHJcbiAgY29uc3Qgc2VjdGlvbnMgPSBnZXRTZWN0aW9uT3JkZXIodmlldy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUpO1xyXG4gIGNvbnN0IGVkaXRvcnMgPSBuZXcgTWFwKCk7XHJcbiAgY29uc3QgYmxvY2tFbHMgPSBuZXcgTWFwKCk7XHJcbiAgY29uc3Qgc3RvcmVzID0gbmV3IE1hcCgpO1xyXG5cclxuICBjb25zdCBhcGkgPSB7XHJcbiAgICAvLyBBbGxlIEVkaXRvci1JbnN0YW56ZW4gaW4gQmxvY2stUmVpaGVuZm9sZ2UgLSB0eXAtdmlldy5qcyBoXHUwMEU0bmd0IHNpZSBhbHNcclxuICAgIC8vIENvbXBvbmVudC1DaGlsZHJlbiBlaW4gdW5kIGJhdXQgc2llIHZvciBqZWRlbSBOZXVhdWZiYXUgd2llZGVyIGFiLlxyXG4gICAgZWRpdG9yczogW10sXHJcbiAgICAvLyBMZWVyemVpbGUgYW0gRW5kZSBkZXMgZ2V3XHUwMEZDbnNjaHRlbiBCbG9ja3MgYW5sZWdlbiwgbWl0IGRlbSBGb2t1cyBpbVxyXG4gICAgLy8gS2V5LUZlbGQgKHNpZWhlIGFkZEJsYW5rUHJvcGVydHkgaW4gdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpLlxyXG4gICAgLy8gZmxvYXRpbmcgbWFya2llcnQgZGllIGFscyBuXHUwMEU0Y2hzdGVzIGJlbmFubnRlIFByb3BlcnR5IGFscyBGbG9hdGluZy5cclxuICAgIGFkZEJsYW5rKHNlY3Rpb24sIGZsb2F0aW5nID0gZmFsc2UpIHtcclxuICAgICAgY29uc3QgZWRpdG9yID0gZWRpdG9ycy5nZXQoc2VjdGlvbik7XHJcbiAgICAgIGlmICghZWRpdG9yKSByZXR1cm47XHJcbiAgICAgIGVkaXRvci5mcmVkUGVuZGluZ0Zsb2F0aW5nQWRkID0gZmxvYXRpbmc7XHJcbiAgICAgIGFkZEJsYW5rUHJvcGVydHkoZWRpdG9yKTtcclxuICAgIH0sXHJcbiAgfTtcclxuXHJcbiAgLy8gTmFjaGJhcmJsb2NrIGluIFJpY2h0dW5nIHN0ZXAsIGRlciBcdTAwRkNiZXJoYXVwdCBlaW5lIFplaWxlIHp1bSBBbnNwcmluZ2VuXHJcbiAgLy8gaGF0IC0gbGVlcmUgQmxcdTAwRjZja2Ugd2VyZGVuIFx1MDBGQ2JlcnNwcnVuZ2VuLlxyXG4gIGNvbnN0IGZvY3VzTmVpZ2hib3IgPSAoc2VjdGlvbiwgc3RlcCkgPT4ge1xyXG4gICAgZm9yIChsZXQgaSA9IHNlY3Rpb25zLmluZGV4T2Yoc2VjdGlvbikgKyBzdGVwOyBpID49IDAgJiYgaSA8IHNlY3Rpb25zLmxlbmd0aDsgaSArPSBzdGVwKSB7XHJcbiAgICAgIGNvbnN0IGVkaXRvciA9IGVkaXRvcnMuZ2V0KHNlY3Rpb25zW2ldKTtcclxuICAgICAgaWYgKCFlZGl0b3IgfHwgZWRpdG9yLnJlbmRlcmVkLmxlbmd0aCA9PT0gMCkgY29udGludWU7XHJcbiAgICAgIGVkaXRvci5mb2N1c1Byb3BlcnR5QXRJbmRleChzdGVwID4gMCA/IDAgOiAtMSk7XHJcbiAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG4gIH07XHJcblxyXG4gIGZvciAoY29uc3Qgc2VjdGlvbiBvZiBzZWN0aW9ucykge1xyXG4gICAgY29uc3QgaXNTdWIgPSBzZWN0aW9uICE9PSBudWxsO1xyXG4gICAgY29uc3QgYmxvY2tFbCA9IHdyYXBwZXIuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcImZyZWQtdHlwLWJsb2NrXCIgKyAoaXNTdWIgPyBcIiBmcmVkLXR5cC1mcm9udG1hdHRlci1ibG9jayBmcmVkLXR5cC1zdWJ0eXBlLWJsb2NrXCIgOiBcIlwiKSxcclxuICAgIH0pO1xyXG4gICAgYmxvY2tFbHMuc2V0KHNlY3Rpb24sIGJsb2NrRWwpO1xyXG4gICAgYmxvY2tFbC5mcmVkU2VjdGlvbiA9IHNlY3Rpb247XHJcblxyXG4gICAgY29uc3QgaGVhZGVyID0gYmxvY2tFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItaGVhZGVyIGZyZWQtdHlwLXNlY3Rpb24taGVhZGVyXCIgfSk7XHJcbiAgICBoZWFkZXIudG9nZ2xlQ2xhc3MoXCJmcmVkLXR5cC1zZWN0aW9uLXN1YlwiLCBpc1N1Yik7XHJcblxyXG4gICAgY29uc3Qgc3RvcmUgPSBzZWN0aW9uID09PSBudWxsID8gdHlwZVN0b3JlKHZpZXcucGx1Z2luLCB0eXBlKSA6IHN1YnR5cGVTdG9yZSh2aWV3LnBsdWdpbiwgdHlwZSwgc2VjdGlvbik7XHJcbiAgICBzdG9yZXMuc2V0KHNlY3Rpb24sIHN0b3JlKTtcclxuICAgIGNvbnN0IGVkaXRvciA9IG1vdW50RnJvbnRtYXR0ZXJFZGl0b3IodmlldywgYmxvY2tFbCwgc3RvcmUsIHtcclxuICAgICAgb25TaGlmdEZvY3VzOiAoc3RlcCkgPT4gZm9jdXNOZWlnaGJvcihzZWN0aW9uLCBzdGVwKSxcclxuICAgIH0pO1xyXG4gICAgaWYgKGVkaXRvcikge1xyXG4gICAgICBlZGl0b3JzLnNldChzZWN0aW9uLCBlZGl0b3IpO1xyXG4gICAgICBhcGkuZWRpdG9ycy5wdXNoKGVkaXRvcik7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgZm9vdGVyID0gYmxvY2tFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtc2VjdGlvbi1mb290ZXJcIiB9KTtcclxuICAgIGZvb3Rlci50b2dnbGVDbGFzcyhcImZyZWQtdHlwLXNlY3Rpb24tc3ViXCIsIGlzU3ViKTtcclxuICAgIHJlbmRlckhlYWRlcihzZWN0aW9uLCBoZWFkZXIsIGFwaSk7XHJcbiAgICByZW5kZXJGb290ZXI/LihzZWN0aW9uLCBmb290ZXIsIGFwaSk7XHJcblxyXG4gICAgaWYgKCFpc1N1YikgY29udGludWU7XHJcbiAgICAvLyBIaWVyIGxhZyBmclx1MDBGQ2hlciBlaW4gY29udGV4dG1lbnUtSGFuZGxlciwgZGVyIGF1ZiBkZXIgZ2FuemVuIEJsb2NrZmxcdTAwRTRjaGVcclxuICAgIC8vIGRpZSBTdWNoZSBcdTAwRjZmZm5ldGUuIERpZSBoXHUwMEU0bmd0IGpldHp0IGFtIEtsaWNrIGF1ZiBkZW4gQmxvY2stTmFtZW4gKHNpZWhlXHJcbiAgICAvLyBtYWtlU2VhcmNoYWJsZSBpbiB0eXAtdmlldy5qcyksIHdvbWl0IGRlciBSZWNodHNrbGljayBpbSBCbG9jayB3aWVkZXJcclxuICAgIC8vIE9ic2lkaWFucyBlaWdlbmVuIE1lblx1MDBGQ3MgZ2VoXHUwMEY2cnQuXHJcbiAgICBibG9ja0VsLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZWRvd25cIiwgKGV2ZW50KSA9PiBzdGFydEJsb2NrRHJhZyhldmVudCwgc2VjdGlvbikpO1xyXG4gIH1cclxuXHJcbiAgLy8gRWlnZW5lcyBNYXVzLURyYWcgc3RhdHQgSFRNTDUtZHJhZ2dhYmxlOiBlaW4gZHJhZ2dhYmxlLVZvcmZhaHJlIHN0XHUwMEY2cnRlIGRpZVxyXG4gIC8vIFRleHRhdXN3YWhsIGluIGRlbiBFaW5nYWJlZmVsZGVybiBkZXIgWmVpbGVuLiBEZXIgRHJhZyBiZWdpbm50IGVyc3QgbmFjaFxyXG4gIC8vIGVpbiBwYWFyIFBpeGVsbiBCZXdlZ3VuZywgZWluIFN0cmljaCBpbiBBa3plbnRmYXJiZSB6ZWlndCBkaWVcclxuICAvLyBaaWVscG9zaXRpb24gendpc2NoZW4gZGVuIEJsXHUwMEY2Y2tlbiwgRXNjYXBlIGJyaWNodCBhYi4gRGFzIFRZUC1Gcm9udG1hdHRlclxyXG4gIC8vIHN0ZWh0IGZlc3QgZ2FueiBvYmVuIChzaWVoZSBnZXRTZWN0aW9uT3JkZXIgaW4gc3VidHlwZXMuanMpIC0gWmllbHBvc2l0aW9uXHJcbiAgLy8gMCBnaWJ0IGVzIGRlc2hhbGIgbmljaHQsIGRlciBvYmVyc3RlIG1cdTAwRjZnbGljaGUgUGxhdHogaXN0IGRpcmVrdCBkYXJ1bnRlci5cclxuICBmdW5jdGlvbiBzdGFydEJsb2NrRHJhZyhldmVudCwgc2VjdGlvbikge1xyXG4gICAgaWYgKGV2ZW50LmJ1dHRvbiAhPT0gMCB8fCAhaXNHcmFiVGFyZ2V0KGV2ZW50LnRhcmdldCkpIHJldHVybjtcclxuICAgIGNvbnN0IHdpbiA9IHdyYXBwZXIud2luO1xyXG4gICAgY29uc3Qgc3RhcnRZID0gZXZlbnQuY2xpZW50WTtcclxuICAgIGxldCBkcmFnZ2luZyA9IGZhbHNlO1xyXG4gICAgbGV0IGluZGljYXRvciA9IG51bGw7XHJcbiAgICBsZXQgYm94ZXMgPSBbXTtcclxuICAgIGxldCB0YXJnZXRJbmRleCA9IG51bGw7XHJcblxyXG4gICAgY29uc3QgbWVhc3VyZSA9ICgpID0+IHtcclxuICAgICAgY29uc3QgYmFzZSA9IHdyYXBwZXIuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XHJcbiAgICAgIGJveGVzID0gc2VjdGlvbnMubWFwKChuYW1lKSA9PiB7XHJcbiAgICAgICAgY29uc3QgcmVjdCA9IGJsb2NrRWxzLmdldChuYW1lKS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcclxuICAgICAgICByZXR1cm4geyBzZWN0aW9uOiBuYW1lLCB0b3A6IHJlY3QudG9wIC0gYmFzZS50b3AsIGJvdHRvbTogcmVjdC5ib3R0b20gLSBiYXNlLnRvcCB9O1xyXG4gICAgICB9KTtcclxuICAgIH07XHJcblxyXG4gICAgY29uc3Qgb25Nb3ZlID0gKG1vdmVFdmVudCkgPT4ge1xyXG4gICAgICBpZiAoIWRyYWdnaW5nKSB7XHJcbiAgICAgICAgaWYgKE1hdGguYWJzKG1vdmVFdmVudC5jbGllbnRZIC0gc3RhcnRZKSA8IDQpIHJldHVybjtcclxuICAgICAgICBkcmFnZ2luZyA9IHRydWU7XHJcbiAgICAgICAgd3JhcHBlci5kb2MuYm9keS5hZGRDbGFzcyhcImZyZWQtdHlwLWJsb2NrLWRyYWdnaW5nXCIpO1xyXG4gICAgICAgIHdpbi5nZXRTZWxlY3Rpb24oKT8ucmVtb3ZlQWxsUmFuZ2VzKCk7XHJcbiAgICAgICAgYmxvY2tFbHMuZ2V0KHNlY3Rpb24pLmFkZENsYXNzKFwiaXMtZHJhZ2dpbmdcIik7XHJcbiAgICAgICAgbWVhc3VyZSgpO1xyXG4gICAgICAgIGluZGljYXRvciA9IHdyYXBwZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWJsb2NrLWRyb3AtaW5kaWNhdG9yXCIgfSk7XHJcbiAgICAgIH1cclxuICAgICAgbW92ZUV2ZW50LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgIGNvbnN0IHkgPSBtb3ZlRXZlbnQuY2xpZW50WSAtIHdyYXBwZXIuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCkudG9wO1xyXG4gICAgICB0YXJnZXRJbmRleCA9IE1hdGgubWF4KDEsIGJveGVzLmZpbHRlcigoYm94KSA9PiAoYm94LnRvcCArIGJveC5ib3R0b20pIC8gMiA8IHkpLmxlbmd0aCk7XHJcbiAgICAgIGNvbnN0IGZyb20gPSBib3hlcy5maW5kSW5kZXgoKGJveCkgPT4gYm94LnNlY3Rpb24gPT09IHNlY3Rpb24pO1xyXG4gICAgICBpbmRpY2F0b3IudG9nZ2xlKHRhcmdldEluZGV4ICE9PSBmcm9tICYmIHRhcmdldEluZGV4ICE9PSBmcm9tICsgMSk7XHJcbiAgICAgIC8vIE1pdHRlIGRlciBMXHUwMEZDY2tlIHp3aXNjaGVuIHp3ZWkgQmxcdTAwRjZja2VuIChBYnN0YW5kIHNpZWhlXHJcbiAgICAgIC8vIC5mcmVkLXR5cC1ibG9jayArIC5mcmVkLXR5cC1ibG9jayBpbiBzdHlsZXMuY3NzKS5cclxuICAgICAgY29uc3QgaGFsZkdhcCA9IDY7XHJcbiAgICAgIGNvbnN0IGdhcFkgPVxyXG4gICAgICAgIHRhcmdldEluZGV4ID09PSBib3hlcy5sZW5ndGhcclxuICAgICAgICAgID8gYm94ZXNbYm94ZXMubGVuZ3RoIC0gMV0uYm90dG9tICsgaGFsZkdhcFxyXG4gICAgICAgICAgOiAoYm94ZXNbdGFyZ2V0SW5kZXggLSAxXS5ib3R0b20gKyBib3hlc1t0YXJnZXRJbmRleF0udG9wKSAvIDI7XHJcbiAgICAgIGluZGljYXRvci5zdHlsZS50b3AgPSBgJHtnYXBZIC0gMX1weGA7XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IGVuZCA9IChjb21taXQpID0+IHtcclxuICAgICAgd2luLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtb3VzZW1vdmVcIiwgb25Nb3ZlKTtcclxuICAgICAgd2luLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtb3VzZXVwXCIsIG9uVXApO1xyXG4gICAgICB3aW4ucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgb25LZXksIHRydWUpO1xyXG4gICAgICBpZiAoIWRyYWdnaW5nKSByZXR1cm47XHJcbiAgICAgIHdyYXBwZXIuZG9jLmJvZHkucmVtb3ZlQ2xhc3MoXCJmcmVkLXR5cC1ibG9jay1kcmFnZ2luZ1wiKTtcclxuICAgICAgYmxvY2tFbHMuZ2V0KHNlY3Rpb24pLnJlbW92ZUNsYXNzKFwiaXMtZHJhZ2dpbmdcIik7XHJcbiAgICAgIGluZGljYXRvcj8ucmVtb3ZlKCk7XHJcblxyXG4gICAgICBjb25zdCBvcmRlciA9IGJveGVzLm1hcCgoYm94KSA9PiBib3guc2VjdGlvbik7XHJcbiAgICAgIGNvbnN0IGZyb20gPSBvcmRlci5pbmRleE9mKHNlY3Rpb24pO1xyXG4gICAgICBpZiAoIWNvbW1pdCB8fCB0YXJnZXRJbmRleCA9PT0gbnVsbCB8fCB0YXJnZXRJbmRleCA9PT0gZnJvbSB8fCB0YXJnZXRJbmRleCA9PT0gZnJvbSArIDEpIHJldHVybjtcclxuICAgICAgb3JkZXIuc3BsaWNlKGZyb20sIDEpO1xyXG4gICAgICBvcmRlci5zcGxpY2UoZnJvbSA8IHRhcmdldEluZGV4ID8gdGFyZ2V0SW5kZXggLSAxIDogdGFyZ2V0SW5kZXgsIDAsIHNlY3Rpb24pO1xyXG4gICAgICBvbk1vdmVTZWN0aW9uPy4ob3JkZXIpO1xyXG4gICAgfTtcclxuICAgIGNvbnN0IG9uVXAgPSAoKSA9PiBlbmQodHJ1ZSk7XHJcbiAgICBjb25zdCBvbktleSA9IChrZXlFdmVudCkgPT4ge1xyXG4gICAgICBpZiAoa2V5RXZlbnQua2V5ICE9PSBcIkVzY2FwZVwiKSByZXR1cm47XHJcbiAgICAgIGtleUV2ZW50LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgIGtleUV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgICBlbmQoZmFsc2UpO1xyXG4gICAgfTtcclxuICAgIHdpbi5hZGRFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIG9uTW92ZSk7XHJcbiAgICB3aW4uYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNldXBcIiwgb25VcCk7XHJcbiAgICB3aW4uYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgb25LZXksIHRydWUpO1xyXG4gIH1cclxuXHJcbiAgcmVnaXN0ZXJQcm9wZXJ0eURyYWcoKTtcclxuICByZXR1cm4gYXBpO1xyXG5cclxuICAvKiAtLS0gRWluZSBQcm9wZXJ0eSBpbiBlaW5lbiBhbmRlcmVuIEJsb2NrIHppZWhlbiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAgKiBBdWZnZXNldHp0IGF1ZiBPYnNpZGlhbnMgZWlnZW5lcyBaZWlsZW4tRHJhZyAoR3YgaW0gZ2ViYXV0ZW4gYXBwLmpzKSxcclxuICAgKiBzdGF0dCBlaW4gendlaXRlcyBkYW5lYmVuenVzdGVsbGVuOiBkYXMgaFx1MDBFNG5ndCBhbSBUeXAtSWNvbiBkZXIgWmVpbGVcclxuICAgKiAoLm1ldGFkYXRhLXByb3BlcnR5LWljb24pLCBsZWd0IGVpbmVuIC5kcmFnLXJlb3JkZXItZ2hvc3QgYW4gZGVuIEJvZHkgLVxyXG4gICAqIGRlciBmb2xndCBkZW0gQ3Vyc29yIGFsc28gb2huZWhpbiBcdTAwRkNiZXIgQmxvY2tncmVuemVuIGhpbndlZyAtIHVuZFxyXG4gICAqIG1hcmtpZXJ0IGRpZSBVcnNwcnVuZ3N6ZWlsZSBtaXQgLmRyYWctZ2hvc3QtaGlkZGVuLCBPYnNpZGlhbnMgZWlnZW5lbVxyXG4gICAqIEFremVudC1SZWNodGVjaywgZGFzIGRpZSBFaW5mXHUwMEZDZ2VzdGVsbGUgemVpZ3QuIElubmVyaGFsYiBlaW5lcyBCbG9ja3NcclxuICAgKiBtYWNodCBPYnNpZGlhbiBkYW1pdCB1bnZlclx1MDBFNG5kZXJ0IGFsbGVzIHNlbGJzdC4gRGF6dSBrb21tdCBoaWVyIG51cjpcclxuICAgKlxyXG4gICAqICAtIGVpbiBsZWVyZXMgWnVzYXR6a2luZCBpbiBkZXIgTGlzdGUsIHNvbGFuZ2UgZ2V6b2dlbiB3aXJkOiBPYnNpZGlhblxyXG4gICAqICAgIHN0YXJ0ZXQgZGVuIERyYWcgc29uc3QgZ2FyIG5pY2h0LCB3ZW5uIGVpbiBCbG9jayBudXIgZWluZSBlaW56aWdlXHJcbiAgICogICAgWmVpbGUgaGF0IChQclx1MDBGQ2Z1bmcgbi5maXJzdENoaWxkICE9PSBuLmxhc3RDaGlsZCBiZWltIG1vdXNlZG93bik7XHJcbiAgICogIC0gZWluIFBsYXR6aGFsdGVyIG1pdCBkZXJzZWxiZW4gS2xhc3NlIC5kcmFnLWdob3N0LWhpZGRlbiBpbSBaaWVsYmxvY2ssXHJcbiAgICogICAgc29iYWxkIGRlciBDdXJzb3IgZWluZW4gZnJlbWRlbiBCbG9jayBlcnJlaWNodCAtIGRpZSBVcnNwcnVuZ3N6ZWlsZVxyXG4gICAqICAgIHdpcmQgc29sYW5nZSBhdXNnZWJsZW5kZXQsIGRhbWl0IG5pY2h0IHp3ZWkgUmVjaHRlY2tlIHN0ZWhlbjtcclxuICAgKiAgLSByZW9yZGVyS2V5IGplIEluc3RhbnosIGRhcyBiZWltIExvc2xhc3NlbiBcdTAwRkNiZXIgZWluZW0gZnJlbWRlbiBCbG9ja1xyXG4gICAqICAgIGRpZSBQcm9wZXJ0eSBkb3J0aGluIHVtaFx1MDBFNG5ndCwgc3RhdHQgaW5uZXJoYWxiIGRlcyBlaWdlbmVuIHp1IHNvcnRpZXJlbi5cclxuICAgKlxyXG4gICAqIERpZSBlaWdlbmVuIEhhbmRsZXIgbGF1ZmVuIGluIGRlciBDYXB0dXJlLVBoYXNlIGFtIEZlbnN0ZXIgdW5kIGRhbWl0IHZvclxyXG4gICAqIE9ic2lkaWFucyBlaWdlbmVuIChkaWUgZXMgaW4gc2VpbmVtIG1vdXNlZG93bi1IYW5kbGVyIGF1ZiB3aW5kb3cgbGVndCkuXHJcbiAgICogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cclxuICBmdW5jdGlvbiByZWdpc3RlclByb3BlcnR5RHJhZygpIHtcclxuICAgIC8vIE9obmUgZWluZW4gendlaXRlbiBCbG9jayBnaWJ0IGVzIGtlaW4gWmllbCAtIGRhbm4gYmxlaWJ0IE9ic2lkaWFuc1xyXG4gICAgLy8gZWlnZW5lcyBEcmFnIHZcdTAwRjZsbGlnIHVuYW5nZXRhc3RldC5cclxuICAgIGNvbnN0IGFuY2hvciA9IGFwaS5lZGl0b3JzWzBdO1xyXG4gICAgaWYgKCFhbmNob3IgfHwgc2VjdGlvbnMubGVuZ3RoIDwgMikgcmV0dXJuO1xyXG5cclxuICAgIC8vIExcdTAwRTR1ZnQgZWluIERyYWcsIGhcdTAwRTRsdCBkaWVzIGRlc3NlbiBadXN0YW5kOyBkcm9wIG1lcmt0IHNpY2ggYmVpbVxyXG4gICAgLy8gTG9zbGFzc2VuIGRhcyBaaWVsIGZcdTAwRkNyIGRhcyBhbnNjaGxpZVx1MDBERmVuZGUgcmVvcmRlcktleS5cclxuICAgIGxldCBkcmFnID0gbnVsbDtcclxuICAgIGxldCBkcm9wID0gbnVsbDtcclxuXHJcbiAgICBjb25zdCBzZWN0aW9uQXQgPSAoY2xpZW50WSkgPT5cclxuICAgICAgc2VjdGlvbnMuZmluZCgoc2VjdGlvbikgPT4ge1xyXG4gICAgICAgIGNvbnN0IHJlY3QgPSBibG9ja0Vscy5nZXQoc2VjdGlvbikuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XHJcbiAgICAgICAgcmV0dXJuIGNsaWVudFkgPj0gcmVjdC50b3AgJiYgY2xpZW50WSA8PSByZWN0LmJvdHRvbTtcclxuICAgICAgfSk7XHJcblxyXG4gICAgY29uc3QgY2xlYXJQbGFjZWhvbGRlciA9ICgpID0+IHtcclxuICAgICAgZHJhZy5wbGFjZWhvbGRlcj8ucmVtb3ZlKCk7XHJcbiAgICAgIGRyYWcucGxhY2Vob2xkZXIgPSBudWxsO1xyXG4gICAgICBkcmFnLnJvd0VsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiZGlzcGxheVwiKTtcclxuICAgICAgZHJhZy50YXJnZXQgPSBudWxsO1xyXG4gICAgfTtcclxuXHJcbiAgICB3cmFwcGVyLmFkZEV2ZW50TGlzdGVuZXIoXHJcbiAgICAgIFwibW91c2Vkb3duXCIsXHJcbiAgICAgIChldmVudCkgPT4ge1xyXG4gICAgICAgIGlmIChldmVudC5idXR0b24gIT09IDApIHJldHVybjtcclxuICAgICAgICBjb25zdCByb3dFbCA9IGV2ZW50LnRhcmdldC5jbG9zZXN0KFwiLm1ldGFkYXRhLXByb3BlcnR5LWljb25cIik/LmNsb3Nlc3QoXCIubWV0YWRhdGEtcHJvcGVydHlcIik7XHJcbiAgICAgICAgY29uc3Qgc2VjdGlvbiA9IHJvd0VsPy5jbG9zZXN0KFwiLmZyZWQtdHlwLWJsb2NrXCIpPy5mcmVkU2VjdGlvbjtcclxuICAgICAgICBjb25zdCBlZGl0b3IgPSBzZWN0aW9uID09PSB1bmRlZmluZWQgPyBudWxsIDogZWRpdG9ycy5nZXQoc2VjdGlvbik7XHJcbiAgICAgICAgY29uc3Qga2V5ID0gZWRpdG9yPy5yZW5kZXJlZC5maW5kKChyb3cpID0+IHJvdy5jb250YWluZXJFbCA9PT0gcm93RWwpPy5lbnRyeS5rZXk7XHJcbiAgICAgICAgLy8gRWluZSBub2NoIHVuYmVuYW5udGUgWmVpbGUgaGF0IGluIGVpbmVtIGFuZGVyZW4gQmxvY2sgbmljaHRzIHp1XHJcbiAgICAgICAgLy8gc3VjaGVuIC0gc2llIGJsZWlidCBPYnNpZGlhbnMgZWlnZW5lciBTb3J0aWVydW5nIFx1MDBGQ2Jlcmxhc3Nlbi5cclxuICAgICAgICBpZiAoIWtleSkgcmV0dXJuO1xyXG4gICAgICAgIGRyYWcgPSB7XHJcbiAgICAgICAgICBzZWN0aW9uLFxyXG4gICAgICAgICAga2V5LFxyXG4gICAgICAgICAgcm93RWwsXHJcbiAgICAgICAgICAvLyBKZXR6dCBzY2hvbiBnZW1lc3Nlbjogc29iYWxkIGRpZSBaZWlsZSBmXHUwMEZDciBkZW4gUGxhdHpoYWx0ZXJcclxuICAgICAgICAgIC8vIGF1c2dlYmxlbmRldCBpc3QsIGxpZWZlcnQgb2Zmc2V0SGVpZ2h0IDAuXHJcbiAgICAgICAgICBoZWlnaHQ6IHJvd0VsLm9mZnNldEhlaWdodCxcclxuICAgICAgICAgIHNwYWNlcjogZWRpdG9yLnByb3BlcnR5TGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kcmFnLXNwYWNlclwiIH0pLFxyXG4gICAgICAgICAgcGxhY2Vob2xkZXI6IG51bGwsXHJcbiAgICAgICAgICB0YXJnZXQ6IG51bGwsXHJcbiAgICAgICAgfTtcclxuICAgICAgICBkcm9wID0gbnVsbDtcclxuICAgICAgfSxcclxuICAgICAgdHJ1ZVxyXG4gICAgKTtcclxuXHJcbiAgICAvLyBBbSBGZW5zdGVyIHJlZ2lzdHJpZXJ0LCBkYW1pdCBlaW4gRHJhZyBhdWNoIGF1XHUwMERGZXJoYWxiIGRlciBCbFx1MDBGNmNrZVxyXG4gICAgLy8gd2VpdGVydmVyZm9sZ3Qgd2lyZCAtIGFiZ2VyXHUwMEU0dW10IG1pdCBkZW0gZXJzdGVuIEVkaXRvciwgZGVyIGJlaW1cclxuICAgIC8vIG5cdTAwRTRjaHN0ZW4gTmV1YXVmYmF1IGRlciBEZXRhaWxhbnNpY2h0IGVudGxhZGVuIHdpcmQgKHNpZWhlXHJcbiAgICAvLyBkZXN0cm95RnJvbnRtYXR0ZXJFZGl0b3IgaW4gdHlwLXZpZXcuanMpLlxyXG4gICAgY29uc3Qgb25XaW5Nb3ZlID0gKGV2ZW50KSA9PiB7XHJcbiAgICAgIGlmICghZHJhZykgcmV0dXJuO1xyXG4gICAgICBjb25zdCB0YXJnZXQgPSBzZWN0aW9uQXQoZXZlbnQuY2xpZW50WSk7XHJcbiAgICAgIGlmICh0YXJnZXQgPT09IHVuZGVmaW5lZCB8fCB0YXJnZXQgPT09IGRyYWcuc2VjdGlvbikge1xyXG4gICAgICAgIGlmIChkcmFnLnBsYWNlaG9sZGVyKSBjbGVhclBsYWNlaG9sZGVyKCk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCBsaXN0ID0gZWRpdG9ycy5nZXQodGFyZ2V0KS5wcm9wZXJ0eUxpc3RFbDtcclxuICAgICAgaWYgKCFkcmFnLnBsYWNlaG9sZGVyKSB7XHJcbiAgICAgICAgZHJhZy5yb3dFbC5zdHlsZS5kaXNwbGF5ID0gXCJub25lXCI7XHJcbiAgICAgICAgZHJhZy5wbGFjZWhvbGRlciA9IGNyZWF0ZURpdih7IGNsczogXCJtZXRhZGF0YS1wcm9wZXJ0eSBkcmFnLWdob3N0LWhpZGRlbiBmcmVkLXR5cC1kcmFnLXBsYWNlaG9sZGVyXCIgfSk7XHJcbiAgICAgICAgZHJhZy5wbGFjZWhvbGRlci5zdHlsZS5oZWlnaHQgPSBgJHtkcmFnLmhlaWdodH1weGA7XHJcbiAgICAgIH1cclxuICAgICAgLy8gRWluZlx1MDBGQ2dlc3RlbGxlIHdpZSBiZWkgT2JzaWRpYW4gc2VsYnN0OiB2b3IgZGVyIGVyc3RlbiBaZWlsZSwgZGVyZW5cclxuICAgICAgLy8gTWl0dGUgdW50ZXJoYWxiIGRlcyBDdXJzb3JzIGxpZWd0LlxyXG4gICAgICBjb25zdCByb3dzID0gWy4uLmxpc3QuY2hpbGRyZW5dLmZpbHRlcigoZWwpID0+IGVsICE9PSBkcmFnLnBsYWNlaG9sZGVyICYmIGVsICE9PSBkcmFnLnNwYWNlcik7XHJcbiAgICAgIGNvbnN0IGJlZm9yZSA9IHJvd3MuZmluZCgoZWwpID0+IHtcclxuICAgICAgICBjb25zdCByZWN0ID0gZWwuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XHJcbiAgICAgICAgcmV0dXJuIGV2ZW50LmNsaWVudFkgPCByZWN0LnRvcCArIHJlY3QuaGVpZ2h0IC8gMjtcclxuICAgICAgfSk7XHJcbiAgICAgIGRyYWcudGFyZ2V0ID0geyBzZWN0aW9uOiB0YXJnZXQsIGluZGV4OiBiZWZvcmUgPyByb3dzLmluZGV4T2YoYmVmb3JlKSA6IHJvd3MubGVuZ3RoIH07XHJcbiAgICAgIGxpc3QuaW5zZXJ0QmVmb3JlKGRyYWcucGxhY2Vob2xkZXIsIGJlZm9yZSA/PyBudWxsKTtcclxuICAgIH07XHJcblxyXG4gICAgY29uc3Qgb25XaW5VcCA9ICgpID0+IHtcclxuICAgICAgaWYgKCFkcmFnKSByZXR1cm47XHJcbiAgICAgIGNvbnN0IHsgc3BhY2VyLCBwbGFjZWhvbGRlciwgcm93RWwsIHRhcmdldCB9ID0gZHJhZztcclxuICAgICAgZHJhZyA9IG51bGw7XHJcbiAgICAgIGRyb3AgPSB0YXJnZXQ7XHJcbiAgICAgIHBsYWNlaG9sZGVyPy5yZW1vdmUoKTtcclxuICAgICAgcm93RWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJkaXNwbGF5XCIpO1xyXG4gICAgICAvLyBFcnN0IG5hY2ggT2JzaWRpYW5zIGVpZ2VuZW0gRHJhZy1BYnNjaGx1c3M6IGRlciBiZXN0aW1tdCBkaWVcclxuICAgICAgLy8gRWluZlx1MDBGQ2dlc3RlbGxlIGlubmVyaGFsYiBkZXMgQXVzZ2FuZ3NibG9ja3Mgbm9jaCBcdTAwRkNiZXIgZGllIEtpbmRlcmxpc3RlLFxyXG4gICAgICAvLyBpbiBkZXIgZGFzIFp1c2F0emtpbmQgZGllIGxldHp0ZSBQb3NpdGlvbiBtYXJraWVydC5cclxuICAgICAgd3JhcHBlci53aW4uc2V0VGltZW91dCgoKSA9PiBzcGFjZXIucmVtb3ZlKCksIDApO1xyXG4gICAgfTtcclxuXHJcbiAgICB3cmFwcGVyLndpbi5hZGRFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIG9uV2luTW92ZSwgdHJ1ZSk7XHJcbiAgICB3cmFwcGVyLndpbi5hZGRFdmVudExpc3RlbmVyKFwibW91c2V1cFwiLCBvbldpblVwLCB0cnVlKTtcclxuICAgIGFuY2hvci5yZWdpc3RlcigoKSA9PiB7XHJcbiAgICAgIHdyYXBwZXIud2luLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtb3VzZW1vdmVcIiwgb25XaW5Nb3ZlLCB0cnVlKTtcclxuICAgICAgd3JhcHBlci53aW4ucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNldXBcIiwgb25XaW5VcCwgdHJ1ZSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IFtzZWN0aW9uLCBlZGl0b3JdIG9mIGVkaXRvcnMpIHtcclxuICAgICAgY29uc3Qgb3JpZ2luYWxSZW9yZGVyS2V5ID0gZWRpdG9yLnJlb3JkZXJLZXk7XHJcbiAgICAgIGVkaXRvci5yZW9yZGVyS2V5ID0gZnVuY3Rpb24gKGVudHJ5LCBpbmRleCkge1xyXG4gICAgICAgIGNvbnN0IHRhcmdldCA9IGRyb3A7XHJcbiAgICAgICAgZHJvcCA9IG51bGw7XHJcbiAgICAgICAgaWYgKCF0YXJnZXQpIHJldHVybiBvcmlnaW5hbFJlb3JkZXJLZXkuY2FsbCh0aGlzLCBlbnRyeSwgaW5kZXgpO1xyXG4gICAgICAgIG1vdmVQcm9wZXJ0eShzZWN0aW9uLCB0YXJnZXQuc2VjdGlvbiwgZW50cnkua2V5LCB0YXJnZXQuaW5kZXgpO1xyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLy8gSFx1MDBFNG5ndCBrZXkgYXVzIGRlbSBCbG9jayBmcm9tIGluIGRlbiBCbG9jayB0byB1bSwgZG9ydCBhbiBQb3NpdGlvbiBpbmRleC5cclxuICAvLyBGXHUwMEZDaHJ0IGRhcyBaaWVsIGRlbiBOYW1lbiBiZXJlaXRzIChpbm5lcmhhbGIgZWluZXMgQmxvY2tzIG11c3MgZXIgZWluZGV1dGlnXHJcbiAgLy8gYmxlaWJlbiksIHdlcmRlbiBiZWlkZSB6dXNhbW1lbmdlbGVndDogZGVyIGJlc3RlaGVuZGUgRWludHJhZyBiZWhcdTAwRTRsdFxyXG4gIC8vIFBvc2l0aW9uLCBXZXJ0LCBGbG9hdGluZy1NYXJraWVydW5nIHVuZCBTaG9ydGN1dCwgbnVyIGVpbiBsZWVyZXIgV2VydCB3aXJkXHJcbiAgLy8gYXVzIGRlciBnZXpvZ2VuZW4gUHJvcGVydHkgZ2VmXHUwMEZDbGx0IC0gZGllc2VsYmUgUmVnZWwgd2llIGJlaSBtZXJnZVN1YnR5cGVzXHJcbiAgLy8gKHN1YnR5cGVzLmpzKSB1bmQgcmVuYW1lSW5TdG9yZSAocHJvcGVydHktcmVuYW1lLXN5bmMuanMpLlxyXG4gIGFzeW5jIGZ1bmN0aW9uIG1vdmVQcm9wZXJ0eShmcm9tLCB0bywga2V5LCBpbmRleCkge1xyXG4gICAgY29uc3Qgc291cmNlID0gc3RvcmVzLmdldChmcm9tKTtcclxuICAgIGNvbnN0IHRhcmdldCA9IHN0b3Jlcy5nZXQodG8pO1xyXG4gICAgaWYgKCFzb3VyY2UgfHwgIXRhcmdldCB8fCBmcm9tID09PSB0bykgcmV0dXJuO1xyXG5cclxuICAgIGNvbnN0IHNvdXJjZUZyb250bWF0dGVyID0geyAuLi5zb3VyY2UuZ2V0RnJvbnRtYXR0ZXIoKSB9O1xyXG4gICAgY29uc3QgdmFsdWUgPSBzb3VyY2VGcm9udG1hdHRlcltrZXldO1xyXG4gICAgY29uc3Qgd2FzRmxvYXRpbmcgPSBzb3VyY2UuZ2V0RmxvYXRpbmcoKS5pbmNsdWRlcyhrZXkpO1xyXG4gICAgLy8gRGVyIFNob3J0Y3V0IGhcdTAwRTRuZ3QgYW0gS2V5IChzaWVoZSBzaG9ydGN1dHMuanMpIHVuZCB6aWVodCBkZXNoYWxiIG1pdCBkZXJcclxuICAgIC8vIFByb3BlcnR5IGluIGRlbiBhbmRlcmVuIEJsb2NrIHVtLlxyXG4gICAgY29uc3Qgc291cmNlU2hvcnRjdXRzID0geyAuLi5zb3VyY2UuZ2V0U2hvcnRjdXRzKCkgfTtcclxuICAgIGNvbnN0IHNob3J0Y3V0ID0gc291cmNlU2hvcnRjdXRzW2tleV0gPz8gbnVsbDtcclxuICAgIGRlbGV0ZSBzb3VyY2VTaG9ydGN1dHNba2V5XTtcclxuICAgIGRlbGV0ZSBzb3VyY2VGcm9udG1hdHRlcltrZXldO1xyXG4gICAgc291cmNlLnNldEZyb250bWF0dGVyKHNvdXJjZUZyb250bWF0dGVyKTtcclxuICAgIHNvdXJjZS5zZXRGbG9hdGluZyhzb3VyY2UuZ2V0RmxvYXRpbmcoKS5maWx0ZXIoKGspID0+IGsgIT09IGtleSkpO1xyXG4gICAgc291cmNlLnNldFNob3J0Y3V0cyhzb3VyY2VTaG9ydGN1dHMpO1xyXG5cclxuICAgIGNvbnN0IHRhcmdldEZyb250bWF0dGVyID0gdGFyZ2V0LmdldEZyb250bWF0dGVyKCk7XHJcbiAgICBjb25zdCBleGlzdGluZyA9IE9iamVjdC5rZXlzKHRhcmdldEZyb250bWF0dGVyKS5maW5kKChrKSA9PiBrLnRvTG93ZXJDYXNlKCkgPT09IGtleS50b0xvd2VyQ2FzZSgpKTtcclxuICAgIGlmIChleGlzdGluZyAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIGlmIChpc0VtcHR5VmFsdWUodGFyZ2V0RnJvbnRtYXR0ZXJbZXhpc3RpbmddKSkgdGFyZ2V0LnNldEZyb250bWF0dGVyKHsgLi4udGFyZ2V0RnJvbnRtYXR0ZXIsIFtleGlzdGluZ106IHZhbHVlIH0pO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKHRhcmdldEZyb250bWF0dGVyKTtcclxuICAgICAgY29uc3QgYXQgPSBNYXRoLm1heCgwLCBNYXRoLm1pbihpbmRleCwga2V5cy5sZW5ndGgpKTtcclxuICAgICAgY29uc3QgbmV4dCA9IHt9O1xyXG4gICAgICBmb3IgKGNvbnN0IGsgb2Yga2V5cy5zbGljZSgwLCBhdCkpIG5leHRba10gPSB0YXJnZXRGcm9udG1hdHRlcltrXTtcclxuICAgICAgbmV4dFtrZXldID0gdmFsdWU7XHJcbiAgICAgIGZvciAoY29uc3QgayBvZiBrZXlzLnNsaWNlKGF0KSkgbmV4dFtrXSA9IHRhcmdldEZyb250bWF0dGVyW2tdO1xyXG4gICAgICB0YXJnZXQuc2V0RnJvbnRtYXR0ZXIobmV4dCk7XHJcbiAgICAgIGlmICh3YXNGbG9hdGluZykgdGFyZ2V0LnNldEZsb2F0aW5nKFsuLi50YXJnZXQuZ2V0RmxvYXRpbmcoKSwga2V5XSk7XHJcbiAgICAgIGlmIChzaG9ydGN1dCkgdGFyZ2V0LnNldFNob3J0Y3V0cyh7IC4uLnRhcmdldC5nZXRTaG9ydGN1dHMoKSwgW2tleV06IHNob3J0Y3V0IH0pO1xyXG4gICAgfVxyXG5cclxuICAgIGF3YWl0IHZpZXcucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgLy8gUmVuZGVydCB1LiBhLiBkaWVzZSBEZXRhaWxhbnNpY2h0IG5ldSAoc2llaGUgcmVnaXN0ZXJUeXBWaWV3KSAtIGRpZVxyXG4gICAgLy8gQmxcdTAwRjZja2UgZW50c3RlaGVuIGRhYmVpIHNhbXQgRWRpdG9yZW4gZnJpc2NoIGF1cyBkZW4gRWluc3RlbGx1bmdlbi5cclxuICAgIHZpZXcucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gIH1cclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSB7IG1vdW50RnJvbnRtYXR0ZXJCbG9ja3MgfTtcclxuIiwgIi8vIFJlaW5lIEhpbGZzZnVua3Rpb25lbiBvaG5lIGVpZ2VuZW4gU3RhdGUgcnVuZCB1bSBUWVAtTmFtZW4gdW5kIGRlcmVuXG4vLyBTb3J0aWVydW5nLlxuXG4vLyBUWVBlbiB3ZXJkZW4gYXVzc2NobGllXHUwMERGbGljaCBpbiBHcm9cdTAwREZidWNoc3RhYmVuIGFuZ2VsZWd0L3VtYmVuYW5udCAtIGJlaW1cbi8vIEFubGVnZW4gd2llIGJlaW0gVW1iZW5lbm5lbi4gQmV0cmlmZnQgbnVyIFx1MDBGQ2JlciBkaWUgTGlzdGUgZ2V0aXBwdGUgTmFtZW4sXG4vLyBuaWNodCBXZXJ0ZSwgZGllIHouIEIuIGRpcmVrdCBpbSBGcm9udG1hdHRlciBlaW5lciBOb3RpeiBpbiBLbGVpbnNjaHJlaWJ1bmdcbi8vIHN0ZWhlbiAoc2llaGUgXCJ1bnJlZ2lzdHJpZXJ0ZVwiIFplaWxlbiBpbiB0eXAtdmlldy5qcykuXG5mdW5jdGlvbiBub3JtYWxpemVUeXBlTmFtZShyYXcpIHtcbiAgcmV0dXJuIHJhdy50cmltKCkudG9VcHBlckNhc2UoKTtcbn1cblxuLy8gRmFyYnRvbiAoMC0zNjBcdTAwQjApIGF1cyBlaW5lbSBIZXgtQ29kZSwgZlx1MDBGQ3IgZGllIFNvcnRpZXJ1bmcgbmFjaCBGYXJic3Bla3RydW1cbi8vIHN0YXR0IG5hY2ggSGV4LVN0cmluZy4gUm90IGxpZWd0IGJlaSAwXHUwMEIwLzM2MFx1MDBCMCAoS3JlaXMpIC0gYXVmc3RlaWdlbmQgYmVnaW5udFxuLy8gZGllIFNvcnRpZXJ1bmcgZGFtaXQgYmVpIFJvdCwgbFx1MDBFNHVmdCBcdTAwRkNiZXIgT3JhbmdlL0dlbGIvR3JcdTAwRkNuL0N5YW4vQmxhdS9NYWdlbnRhXG4vLyB1bmQgbGFuZGV0IHdpZWRlciBiZWkgUm90LiBBY2hyb21hdGlzY2hlIEZhcmJlbiAoR3JhdS9TY2h3YXJ6L1dlaVx1MDBERiwgZGVsdGE9MClcbi8vIGhhYmVuIGtlaW5lbiBkZWZpbmllcnRlbiBGYXJidG9uIC0gZGFmXHUwMEZDciBsaWVmZXJ0IGRpZXNlIEZ1bmt0aW9uIG51bGwsIGRhbWl0XG4vLyBjb21wYXJlVHlwZXMgc2llIHVuYWJoXHUwMEU0bmdpZyB2b24gZGVyIFNvcnRpZXJyaWNodHVuZyBhbnMgRW5kZSBzdGVsbGVuIGthbm4uXG5mdW5jdGlvbiBoZXhUb0h1ZShoZXgpIHtcbiAgY29uc3QgbWF0Y2ggPSAvXiM/KFswLTlhLWZdezZ9KSQvaS5leGVjKGhleCA/PyBcIlwiKTtcbiAgaWYgKCFtYXRjaCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGludCA9IHBhcnNlSW50KG1hdGNoWzFdLCAxNik7XG4gIGNvbnN0IHIgPSAoKGludCA+PiAxNikgJiAyNTUpIC8gMjU1O1xuICBjb25zdCBnID0gKChpbnQgPj4gOCkgJiAyNTUpIC8gMjU1O1xuICBjb25zdCBiID0gKGludCAmIDI1NSkgLyAyNTU7XG4gIGNvbnN0IG1heCA9IE1hdGgubWF4KHIsIGcsIGIpO1xuICBjb25zdCBtaW4gPSBNYXRoLm1pbihyLCBnLCBiKTtcbiAgY29uc3QgZGVsdGEgPSBtYXggLSBtaW47XG4gIGlmIChkZWx0YSA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgbGV0IGh1ZTtcbiAgaWYgKG1heCA9PT0gcikgaHVlID0gKChnIC0gYikgLyBkZWx0YSkgJSA2O1xuICBlbHNlIGlmIChtYXggPT09IGcpIGh1ZSA9IChiIC0gcikgLyBkZWx0YSArIDI7XG4gIGVsc2UgaHVlID0gKHIgLSBnKSAvIGRlbHRhICsgNDtcbiAgaHVlICo9IDYwO1xuICByZXR1cm4gaHVlIDwgMCA/IGh1ZSArIDM2MCA6IGh1ZTtcbn1cblxuLy8gR2VtZWluc2FtZSBTb3J0aWVybG9naWsgZlx1MDBGQ3IgVFlQLSB1bmQgU1VCVFlQLUxpc3Rlbi4gdHlwZUNvbG9ycyBkYXJmIGVpblxuLy8gbGVlcmVzIE9iamVrdCBzZWluIChTVUJUWVAgaGF0IGtlaW5lIGVpZ2VuZSBGYXJiZSkgLSBkZXIgXCJjb2xvclwiLU1vZHVzIHdpcmRcbi8vIGRvcnQgc2NobGljaHQgbmllIGF1c2dld1x1MDBFNGhsdC5cbmZ1bmN0aW9uIGNvbXBhcmVUeXBlcyhtb2RlLCBhLCBiLCBjb3VudHMsIHR5cGVDb2xvcnMpIHtcbiAgY29uc3QgW2tleSwgZGlyXSA9IG1vZGUuc3BsaXQoXCItXCIpO1xuICBsZXQgY21wO1xuICBpZiAoa2V5ID09PSBcImNvdW50XCIpIHtcbiAgICBjbXAgPSAoY291bnRzLmdldChhKSA/PyAwKSAtIChjb3VudHMuZ2V0KGIpID8/IDApO1xuICAgIGlmIChkaXIgPT09IFwiZGVzY1wiKSBjbXAgPSAtY21wO1xuICB9IGVsc2UgaWYgKGtleSA9PT0gXCJjb2xvclwiKSB7XG4gICAgY29uc3QgaHVlQSA9IGhleFRvSHVlKHR5cGVDb2xvcnNbYV0gPz8gbnVsbCk7XG4gICAgY29uc3QgaHVlQiA9IGhleFRvSHVlKHR5cGVDb2xvcnNbYl0gPz8gbnVsbCk7XG4gICAgLy8gQWNocm9tYXRpc2NoZSBGYXJiZW4gYmxlaWJlbiBpbW1lciBhbSBFbmRlLCBlZ2FsIG9iIGF1Zi0gb2RlciBhYnN0ZWlnZW5kXG4gICAgLy8gc29ydGllcnQgd2lyZCAtIG51ciBkaWUgUmVpaGVuZm9sZ2UgaW5uZXJoYWxiIGRlciBlY2h0ZW4gRmFyYnRcdTAwRjZuZSBkcmVodCBzaWNoIHVtLlxuICAgIGlmIChodWVBID09PSBudWxsICYmIGh1ZUIgPT09IG51bGwpIGNtcCA9IDA7XG4gICAgZWxzZSBpZiAoaHVlQSA9PT0gbnVsbCkgY21wID0gMTtcbiAgICBlbHNlIGlmIChodWVCID09PSBudWxsKSBjbXAgPSAtMTtcbiAgICBlbHNlIHtcbiAgICAgIGNtcCA9IGh1ZUEgLSBodWVCO1xuICAgICAgaWYgKGRpciA9PT0gXCJkZXNjXCIpIGNtcCA9IC1jbXA7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIGNtcCA9IGEubG9jYWxlQ29tcGFyZShiKTtcbiAgICBpZiAoZGlyID09PSBcImRlc2NcIikgY21wID0gLWNtcDtcbiAgfVxuICByZXR1cm4gY21wIHx8IGEubG9jYWxlQ29tcGFyZShiKTtcbn1cblxuLy8gV2VuZGV0IGRlbiBha3R1ZWxsZW4gU29ydGllcm1vZHVzIGF1ZiBlaW5lIExpc3RlIHZvbiBUWVBlbiBhbi4gU29uZGVyZmFsbFxuLy8gXCJtYW51YWxcIiAoc2llaGUgU09SVF9PUFRJT05TIGluIHR5cC12aWV3LmpzKTogZG9ydCBibGVpYnQgYmV3dXNzdCBkaWVcbi8vIFx1MDBGQ2JlcmdlYmVuZSBSZWloZW5mb2xnZSBzZWxic3QgZXJoYWx0ZW4sIHN0YXR0IHNpZSB6dSBzb3J0aWVyZW4gLSBzaWUgSVNUIGluXG4vLyBkaWVzZW0gTW9kdXMgZGllIGdlc3BlaWNoZXJ0ZSBTb3J0aWVydW5nIChwbHVnaW4uc2V0dGluZ3MudHlwZXMsIHBlciBEcmFnICZcbi8vIERyb3AgaW4gdHlwLXZpZXcuanMgdmVyc2Nob2JlbikuIEVpbiBWZXJnbGVpY2ggendlaWVyIFRZUGVuIGtcdTAwRjZubnRlIGRpZXNlXG4vLyBSZWloZW5mb2xnZSBuaWNodCBoZXJsZWl0ZW4sIGNvbXBhcmVUeXBlcyBibGVpYnQgZGFoZXIgdW5hbmdldGFzdGV0LiBWb25cbi8vIG1haW4uanMgKGdldFR5cGVzKCksIGZcdTAwRkNyIFRlbXBsYXRlci9QaWNrZXIpIFVORCB0eXAtdmlldy5qcyBnZW51dHp0LCBkYW1pdFxuLy8gYmVpZGUgZGllc2VsYmUgUmVpaGVuZm9sZ2UgemVpZ2VuLlxuZnVuY3Rpb24gc29ydFR5cGVzQnlNb2RlKHR5cGVzLCBtb2RlLCBjb3VudHMsIHR5cGVDb2xvcnMpIHtcbiAgaWYgKG1vZGUgPT09IFwibWFudWFsXCIpIHJldHVybiBbLi4udHlwZXNdO1xuICByZXR1cm4gWy4uLnR5cGVzXS5zb3J0KChhLCBiKSA9PiBjb21wYXJlVHlwZXMobW9kZSwgYSwgYiwgY291bnRzLCB0eXBlQ29sb3JzKSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBub3JtYWxpemVUeXBlTmFtZSwgaGV4VG9IdWUsIGNvbXBhcmVUeXBlcywgc29ydFR5cGVzQnlNb2RlIH07XG4iLCAiY29uc3QgeyBJdGVtVmlldywgTWVudSwgTW9kYWwsIE5vdGljZSwgc2V0SWNvbiwgZGVib3VuY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcclxuY29uc3QgeyBtb3VudEZyb250bWF0dGVyQmxvY2tzIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1ibG9ja3NcIik7XHJcbmNvbnN0IHtcclxuICBub3JtYWxpemVTdWJ0eXBlTmFtZSxcclxuICBnZXRTdWJ0eXBlTmFtZXMsXHJcbiAgZW5zdXJlU3VidHlwZSxcclxuICBtb3ZlVHlwZVN1YnR5cGVzLFxyXG4gIGRlbGV0ZVR5cGVTdWJ0eXBlcyxcclxuICBtZXJnZVR5cGVTdWJ0eXBlcyxcclxuICBnZXRTdWJ0eXBlLFxyXG4gIHJlbmFtZVN1YnR5cGUsXHJcbiAgcmVvcmRlclN1YnR5cGVzLFxyXG4gIGRlbGV0ZVN1YnR5cGUsXHJcbiAgbWVyZ2VTdWJ0eXBlcyxcclxuICByZW5hbWVTdWJ0eXBlSW5Ob3RlcyxcclxufSA9IHJlcXVpcmUoXCIuL3N1YnR5cGVzXCIpO1xyXG5jb25zdCB7IG5vcm1hbGl6ZVR5cGVOYW1lLCBjb21wYXJlVHlwZXMsIHNvcnRUeXBlc0J5TW9kZSB9ID0gcmVxdWlyZShcIi4vdHlwZS11dGlsc1wiKTtcclxuY29uc3QgeyB0eXBlS2V5T2YsIHByb3BlcnR5VmFsdWUsIHNldENhbm9uaWNhbFByb3BlcnR5LCBUWVBfUFJPUEVSVFksIFNVQlRZUF9QUk9QRVJUWSB9ID0gcmVxdWlyZShcIi4vdHlwLWluZGV4XCIpO1xyXG5jb25zdCB7XHJcbiAgc3VidHlwZUNvbG9yLFxyXG4gIGFwcGx5Q29sb3JPZmZzZXQsXHJcbiAgaGFzQ29sb3JPZmZzZXQsXHJcbiAgc3VidHlwZUhhc093bkNvbG9yLFxyXG4gIHBhaW50Q29sb3JEb3QsXHJcbiAgbmFtZUNvbG9yLFxyXG4gIGNoYW5uZWxCb3VuZHMsXHJcbiAgY2xhbXBlZE9mZnNldCxcclxuICBTVUJUWVBFX0NPTE9SX0NIQU5ORUxTLFxyXG4gIERFRkFVTFRfVFlQRV9DT0xPUixcclxufSA9IHJlcXVpcmUoXCIuL3R5cGUtY29sb3JzXCIpO1xyXG5cclxuY29uc3QgVklFV19UWVBFX1RZUCA9IFwiZnJlZC10eXAtdmlld1wiO1xyXG5jb25zdCBERUZBVUxUX1NPUlRfT1JERVIgPSBcImNvdW50LWRlc2NcIjtcclxuY29uc3QgREVGQVVMVF9TRUNPTkRBUlkgPSBcInN1YnR5cGVzXCI7XHJcblxyXG4vLyBXYXMgaW4gZGVyIFRZUC1MaXN0ZSByZWNodHMgbmViZW4gZGVtIE5hbWVuIHN0ZWh0IChzZXR0aW5ncy50eXBMaXN0U2Vjb25kYXJ5KS5cclxuLy8gVW1nZXNjaGFsdGV0IHdpcmQgbmljaHQgXHUwMEZDYmVyIGRpZSBFaW5zdGVsbHVuZ2VuLCBzb25kZXJuIFx1MDBGQ2JlciBlaW5lbiBLbm9wZiBpbVxyXG4vLyBMaXN0ZW4tSGVhZGVyIG5lYmVuIGRlciBTb3J0aWVydW5nLCBkZXIgZGllIE1vZGkgZGVyIFJlaWhlIG5hY2ggZHVyY2hzY2hhbHRldFxyXG4vLyAoc2llaGUgY3ljbGVTZWNvbmRhcnkpIC0gZXMgc2luZCB6dSB3ZW5pZ2UgdW5kIHp1IHVubWl0dGVsYmFyIHNpY2h0YmFyZVxyXG4vLyBadXN0YWVuZGUgZnVlciBlaW4gTWVudWUuXHJcbi8vICAgc3VidHlwZXMgICAgLSBkaWUgU3VidHlwZW4gZGVzIFRZUHMgaW4gS2xhbW1lcm4sIGplIGluIHNlaW5lciBGYXJiZVxyXG4vLyAgICAgICAgICAgICAgICAgKHdpZSBkaWUgVm9yc2NoYXUgaW0gc2VwYXJhdGVuIFRZUC1QaWNrZXIsIHNpZWhlXHJcbi8vICAgICAgICAgICAgICAgICByZW5kZXJTdWJ0eXBlUHJldmlldyBpbiB0eXBlLXBpY2tlci5qcylcclxuLy8gICBkZXNjcmlwdGlvbiAtIFRleHRmZWxkIHp1ciBCZWFyYmVpdHVuZyBkZXIgVFlQLUJlc2NocmVpYnVuZ1xyXG4vLyAgIG5vbmUgICAgICAgIC0gbmljaHRzLCBkZXIgTmFtZSBiZWtvbW10IGRpZSBnYW56ZSBaZWlsZVxyXG4vLyBEaWUgUmVpaGVuZm9sZ2UgaXN0IHp1Z2xlaWNoIGRpZSBkZXMgRHVyY2hzY2hhbHRlbnMsIGRlciBlcnN0ZSBFaW50cmFnIGRlclxyXG4vLyBTdGFuZGFyZCAoREVGQVVMVF9TRUNPTkRBUlkpOiBkaWUgU3VidHlwZW4gc3RlaGVuIHNvbnN0IG5pcmdlbmRzIGluIGRlclxyXG4vLyBMaXN0ZSwgZGllIEJlc2NocmVpYnVuZyBkYWdlZ2VuIGF1Y2ggaW4gZGVyIERldGFpbGFuc2ljaHQgZGVzIFRZUHMuXHJcbmNvbnN0IFNFQ09OREFSWV9NT0RFUyA9IFtcclxuICB7IG1vZGU6IFwic3VidHlwZXNcIiwgdGl0bGU6IFwiU3VidHlwZW5cIiwgaWNvbjogXCJsaXN0LXRyZWVcIiB9LFxyXG4gIHsgbW9kZTogXCJkZXNjcmlwdGlvblwiLCB0aXRsZTogXCJCZXNjaHJlaWJ1bmdcIiwgaWNvbjogXCJ0ZXh0LWN1cnNvci1pbnB1dFwiIH0sXHJcbiAgeyBtb2RlOiBcIm5vbmVcIiwgdGl0bGU6IFwiTmljaHRzXCIsIGljb246IFwibWludXNcIiB9LFxyXG5dO1xyXG5cclxuY29uc3QgU09SVF9PUFRJT05TID0gW1xyXG4gIC8vIE51dHp0IChhbmRlcnMgYWxzIGRpZSBcdTAwRkNicmlnZW4gTW9kaSkga2VpbmVuIGVpZ2VuZW4gVmVyZ2xlaWNoLCBzb25kZXJuIGRpZVxyXG4gIC8vIFJlaWhlbmZvbGdlIHZvbiBwbHVnaW4uc2V0dGluZ3MudHlwZXMgc2VsYnN0IGFscyBTcGVpY2hlcm9ydCAtIHNpZWhlXHJcbiAgLy8gcmVuZGVyKCkgdW5kIHJlbmRlclJlZ2lzdGVyZWRJdGVtKCkgZlx1MDBGQ3IgZGFzIHBlciBEcmFnICYgRHJvcCB2ZXJzY2hpZWJiYXJlXHJcbiAgLy8gUmVuZGVybiwgZGFzIGdlbmF1IGRhcmF1ZiBhdWZiYXV0LiBCZXd1c3N0IGFscyBlcnN0ZSBPcHRpb24gKHNpZWhlXHJcbiAgLy8gc2hvd1NvcnRNZW51KSAtIGVpZ2VuZSwgb2JlcnN0ZSBHcnVwcGUgaW0gTWVuXHUwMEZDIHN0YXR0IGVpbnNvcnRpZXJ0IHp3aXNjaGVuXHJcbiAgLy8gZGllIGVpZ2VudGxpY2hlbiBTb3J0aWVya3JpdGVyaWVuLlxyXG4gIHsgbW9kZTogXCJtYW51YWxcIiwgdGl0bGU6IFwiTWFudWVsbCAoRHJhZyAmIERyb3ApXCIgfSxcclxuICB7IG1vZGU6IFwiY291bnQtZGVzY1wiLCB0aXRsZTogXCJIXHUwMEU0dWZpZ2tlaXQgKGFic3RlaWdlbmQpXCIgfSxcclxuICB7IG1vZGU6IFwiY291bnQtYXNjXCIsIHRpdGxlOiBcIkhcdTAwRTR1Zmlna2VpdCAoYXVmc3RlaWdlbmQpXCIgfSxcclxuICB7IG1vZGU6IFwibmFtZS1hc2NcIiwgdGl0bGU6IFwiTmFtZSAoQSBiaXMgWilcIiB9LFxyXG4gIHsgbW9kZTogXCJuYW1lLWRlc2NcIiwgdGl0bGU6IFwiTmFtZSAoWiBiaXMgQSlcIiB9LFxyXG4gIHsgbW9kZTogXCJjb2xvci1hc2NcIiwgdGl0bGU6IFwiRmFyYmUgKFJvdCBcdTIxOTIgVmlvbGV0dClcIiB9LFxyXG4gIHsgbW9kZTogXCJjb2xvci1kZXNjXCIsIHRpdGxlOiBcIkZhcmJlIChWaW9sZXR0IFx1MjE5MiBSb3QpXCIgfSxcclxuXTtcclxuXHJcbi8vIFNjaHJlaWJ0IGRlbiBUWVAtV2VydCBhbGxlciBOb3RpemVuIG1pdCBkZW0gU2NobFx1MDBGQ3NzZWwgb2xkS2V5IChzaWVoZVxyXG4vLyB0eXBlS2V5T2YgaW4gdHlwLWluZGV4LmpzIC0gZlx1MDBGQ3IgZWluZW4gc2F1YmVyZW4gV2VydCBkZXIgVFlQLU5hbWUgc2VsYnN0LFxyXG4vLyBzb25zdCBkaWUgUm9oZm9ybSwgei4gQi4gXCIgYnVjaFwiIG9kZXIgXCJbUEVSU09OLCBCVUNIXVwiKSBhdWYgZGVuIEVpbnplbHdlcnRcclxuLy8gbmV3VmFsdWUgdW0uIEdlbnV0enQgZlx1MDBGQ3IgcmVnaXN0ZXJUeXBlKCkgKEJlcmVpbmlnZW4pLCBVbWJlbmVubmVuIHVuZFxyXG4vLyBadXNhbW1lbmxlZ2VuLiBEZXIgQWJnbGVpY2ggZXJmb2xndCBleGFrdCBcdTAwRkNiZXIgZGVuIFNjaGxcdTAwRkNzc2VsLCBlaW5lIExpc3RlXHJcbi8vIHdpcmQgZGFiZWkgYWxzbyBhbHMgR2FuemVzIGVyc2V0enQgc3RhdHQgbnVyIGVpbmVyIGlocmVyIEVpbnRyXHUwMEU0Z2UuIEVpblxyXG4vLyBhYndlaWNoZW5kIGdlc2NocmllYmVuZXIgUHJvcGVydHktTmFtZSAoXCJ0eXBcIikgd2lyZCBkYWJlaSB6dSBcIlRZUFwiLlxyXG5hc3luYyBmdW5jdGlvbiByZW5hbWVUeXBlSW5Ob3RlcyhwbHVnaW4sIG9sZEtleSwgbmV3VmFsdWUpIHtcclxuICBsZXQgY2hhbmdlZCA9IDA7XHJcbiAgZm9yIChjb25zdCBmaWxlIG9mIHBsdWdpbi50eXBJbmRleC5maWxlc1dpdGhUeXBlKG9sZEtleSkpIHtcclxuICAgIGxldCBtYXRjaGVkID0gZmFsc2U7XHJcbiAgICBhd2FpdCBwbHVnaW4uYXBwLmZpbGVNYW5hZ2VyLnByb2Nlc3NGcm9udE1hdHRlcihmaWxlLCAoZnJvbnRtYXR0ZXIpID0+IHtcclxuICAgICAgaWYgKHR5cGVLZXlPZihwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBUWVBfUFJPUEVSVFkpKSAhPT0gb2xkS2V5KSByZXR1cm47XHJcbiAgICAgIHNldENhbm9uaWNhbFByb3BlcnR5KGZyb250bWF0dGVyLCBUWVBfUFJPUEVSVFksIG5ld1ZhbHVlKTtcclxuICAgICAgbWF0Y2hlZCA9IHRydWU7XHJcbiAgICB9KTtcclxuICAgIGlmIChtYXRjaGVkKSBjaGFuZ2VkKys7XHJcbiAgfVxyXG4gIHJldHVybiBjaGFuZ2VkO1xyXG59XHJcblxyXG4vLyBCZXJlaW5pZ3RlIEZvcm0gZWluZXMgUm9od2VydHMgZlx1MDBGQ3IgcmVnaXN0ZXJUeXBlKCk6IEVpbnplbHdlcnQgZ2V0cmltbXQgdW5kXHJcbi8vIGdyb1x1MDBERiBnZXNjaHJpZWJlbjsgZWluZSBMaXN0ZSB3aXJkIGJld3Vzc3QgTklDSFQgYXVmIGVpbmVuIGlocmVyIEVpbnRyXHUwMEU0Z2VcclxuLy8gcmVkdXppZXJ0LCBzb25kZXJuIGFscyBHYW56ZXMgenUgZWluZW0gRWluemVsd2VydCBcIkEsIEJcIiAoUm9oZm9ybSkgLSBkYXJhdXNcclxuLy8gbFx1MDBFNHNzdCBzaWNoIGRlciBUWVAgZGFuYWNoIHBlciBVbWJlbmVubmVuIGdlemllbHQgaW4gZWluZW4gYW5kZXJlbiBcdTAwRkNiZXJmXHUwMEZDaHJlblxyXG4vLyAoc2llaGUgc3RhcnREZXRhaWxSZW5hbWUvc2hvd01lcmdlQ29uZmlybSkuIG5vcm1hbGl6ZTogU2NocmVpYndlaXNlIGRlclxyXG4vLyBlaW56ZWxuZW4gTmFtZW4gLSBmXHUwMEZDciBTdWJ0eXBlbiBub3JtYWxpemVTdWJ0eXBlTmFtZSAoc2llaGUgc3VidHlwZXMuanMpLlxyXG5mdW5jdGlvbiBub3JtYWxpemVSYXdUeXBlKHJhdywgbm9ybWFsaXplID0gbm9ybWFsaXplVHlwZU5hbWUpIHtcclxuICBpZiAoQXJyYXkuaXNBcnJheShyYXcpKSB7XHJcbiAgICByZXR1cm4gcmF3XHJcbiAgICAgIC5tYXAoKHYpID0+IG5vcm1hbGl6ZShTdHJpbmcodiA/PyBcIlwiKSkpXHJcbiAgICAgIC5maWx0ZXIoQm9vbGVhbilcclxuICAgICAgLmpvaW4oXCIsIFwiKTtcclxuICB9XHJcbiAgcmV0dXJuIG5vcm1hbGl6ZShTdHJpbmcocmF3KSk7XHJcbn1cclxuXHJcbi8vIEFuemVpZ2UgZWluZXMgdW5yZWdpc3RyaWVydGVuIFNjaGxcdTAwRkNzc2VsczogUmFuZGxlZXJ6ZWljaGVuIHdcdTAwRTRyZW4gYWxzIHJlaW5lclxyXG4vLyBUZXh0IHVuc2ljaHRiYXIsIGRhaGVyIGRhbm4gaW4gQW5mXHUwMEZDaHJ1bmdzemVpY2hlbi4gTGlzdGVuIHRyYWdlbiBpaHJlXHJcbi8vIGVja2lnZW4gS2xhbW1lcm4gc2Nob24gaW0gU2NobFx1MDBGQ3NzZWwuXHJcbmZ1bmN0aW9uIGRpc3BsYXlUeXBlS2V5KHR5cGVLZXkpIHtcclxuICByZXR1cm4gdHlwZUtleSAhPT0gdHlwZUtleS50cmltKCkgPyBgXCIke3R5cGVLZXl9XCJgIDogdHlwZUtleTtcclxufVxyXG5cclxuLy8gVFlQLU5hbWUgaW4gRmxpZVx1MDBERnRleHQgKEJlc3RcdTAwRTR0aWd1bmdzLU1vZGFsZSk6IGVpbmdlZlx1MDBFNHJidGVyIE5hbWUsIHdlbm4gXCJUWVBcclxuLy8gVmlldyBlaW5mXHUwMEU0cmJlblwiIGFrdGl2IGlzdCAoY29sb3JWaWV3cy50eXBMaXN0KSwgc29uc3QgZWluIEZhcmJwdW5rdCBkYXZvclxyXG4vLyBwbHVzIG5vcm1hbGVyIFRleHQgLSBkaWVzZWxiZSBVbXNjaGFsdHVuZyB3aWUgaW0gVFlQLVBpY2tlciAoc2llaGVcclxuLy8gcmVuZGVyU3VnZ2VzdGlvbiBpbiB0eXBlLXBpY2tlci5qcykgdW5kIGluIGRlciBUWVAtTGlzdGUgc2VsYnN0LiBjb2xvciB3aXJkXHJcbi8vIHZvbSBBdWZydWZlciBcdTAwRkNiZXJnZWJlbiBzdGF0dCBoaWVyIG5hY2hnZXNjaGxhZ2VuLCBkYW1pdCB6LiBCLiBiZWkgZWluZXJcclxuLy8gVW1iZW5lbm51bmcgYmV3dXNzdCBmXHUwMEZDciBhbHQgVU5EIG5ldSBkaWVzZWxiZSAoZGllIGRlcyBhbHRlbiBOYW1lbnMsIGRpZSBuYWNoXHJcbi8vIGRlbSBVbWJlbmVubmVuIGVyaGFsdGVuIGJsZWlidCkgRmFyYmUgdmVyd2VuZGV0IHdlcmRlbiBrYW5uLiBjb2xvciBudWxsID1cclxuLy8gVFlQIG9obmUgZWlnZW5lIEZhcmJlIChOYW1lIHVuZ2VmXHUwMEU0cmJ0IGJ6dy4gUHVua3QgYWxzIGhvaGxlciBncmF1ZXIgUmluZykuXHJcbmZ1bmN0aW9uIGFwcGVuZFR5cGVOYW1lKHBhcmVudEVsLCBwbHVnaW4sIHR5cGUsIGNvbG9yKSB7XHJcbiAgaWYgKHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3QpIHtcclxuICAgIGNvbnN0IG5hbWVFbCA9IHBhcmVudEVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtaW5saW5lLW5hbWVcIiwgdGV4dDogdHlwZSB9KTtcclxuICAgIGlmIChjb2xvcikgbmFtZUVsLnN0eWxlLmNvbG9yID0gY29sb3I7XHJcbiAgfSBlbHNlIHtcclxuICAgIHBhaW50Q29sb3JEb3QocGFyZW50RWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1pbmxpbmUtZG90XCIgfSksIGNvbG9yID8/IERFRkFVTFRfVFlQRV9DT0xPUiwgIWNvbG9yKTtcclxuICAgIHBhcmVudEVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtaW5saW5lLW5hbWVcIiwgdGV4dDogdHlwZSB9KTtcclxuICB9XHJcbn1cclxuXHJcbmNsYXNzIENvbmZpcm1EZWxldGVUeXBlTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XHJcbiAgY29uc3RydWN0b3IocGx1Z2luLCB0eXBlLCBvbkNvbmZpcm0pIHtcclxuICAgIHN1cGVyKHBsdWdpbi5hcHApO1xyXG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XHJcbiAgICB0aGlzLnR5cGUgPSB0eXBlO1xyXG4gICAgdGhpcy5vbkNvbmZpcm0gPSBvbkNvbmZpcm07XHJcbiAgfVxyXG5cclxuICBvbk9wZW4oKSB7XHJcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcclxuICAgIHRoaXMubW9kYWxFbC5hZGRDbGFzcyhcImZyZWQtY29uZmlybS1kZWxldGUtbW9kYWxcIik7XHJcbiAgICBjb25zdCBwID0gY29udGVudEVsLmNyZWF0ZUVsKFwicFwiKTtcclxuICAgIHAuYXBwZW5kVGV4dChcIlR5cCBcIik7XHJcbiAgICBhcHBlbmRUeXBlTmFtZShwLCB0aGlzLnBsdWdpbiwgdGhpcy50eXBlLCB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3RoaXMudHlwZV0gPz8gbnVsbCk7XHJcbiAgICBwLmFwcGVuZFRleHQoXCIgd2lya2xpY2ggbFx1MDBGNnNjaGVuP1wiKTtcclxuXHJcbiAgICBjb25zdCBidXR0b25Sb3cgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcIm1vZGFsLWJ1dHRvbi1jb250YWluZXJcIiB9KTtcclxuICAgIGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiQWJicmVjaGVuXCIgfSkuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY2xvc2UoKSk7XHJcblxyXG4gICAgY29uc3QgY29uZmlybUJ0biA9IGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IGNsczogXCJtb2Qtd2FybmluZ1wiLCB0ZXh0OiBcIkxcdTAwRjZzY2hlblwiIH0pO1xyXG4gICAgY29uZmlybUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICB0aGlzLmNsb3NlKCk7XHJcbiAgICAgIHRoaXMub25Db25maXJtKCk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIG9uQ2xvc2UoKSB7XHJcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xyXG4gIH1cclxufVxyXG5cclxuLy8gVm9yIGRlbSBcIlVtYmVuZW5uZW4gKGlua2wuIE5vdGl6ZW4gYW5wYXNzZW4pXCItQnV0dG9uIChzaWVoZSByZW5kZXJUeXBlU2V0dGluZ3NcclxuLy8gdW5kIHN0YXJ0RGV0YWlsUmVuYW1lKSAtIGltIEdlZ2Vuc2F0eiB6dXIgbm9ybWFsZW4gVW1iZW5lbm51bmcsIGRpZSBudXIgZGllXHJcbi8vIFBsdWdpbi1FaW5zdGVsbHVuZ2VuIFx1MDBFNG5kZXJ0LCBzY2hyZWlidCBkaWVzZSBWYXJpYW50ZSB6dXNcdTAwRTR0emxpY2ggZGVuIFRZUC1XZXJ0XHJcbi8vIGFsbGVyIGJldHJvZmZlbmVuIE5vdGl6ZW4gdW0uIERhcyBpc3QgZWluIEJ1bGstU2NocmVpYnZvcmdhbmcgXHUwMEZDYmVyXHJcbi8vIHBvdGVuemllbGwgdmllbGUgRGF0ZWllbiwgZGFoZXIgaGllciBlaW5lIGV4cGxpeml0ZSBCZXN0XHUwMEU0dGlndW5nIGRhdm9yLlxyXG5jbGFzcyBDb25maXJtUmVuYW1lVHlwZU1vZGFsIGV4dGVuZHMgTW9kYWwge1xyXG4gIGNvbnN0cnVjdG9yKHBsdWdpbiwgb2xkVHlwZSwgbmV3VHlwZSwgYWZmZWN0ZWRDb3VudCwgb25Db25maXJtLCBvbkNhbmNlbCkge1xyXG4gICAgc3VwZXIocGx1Z2luLmFwcCk7XHJcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcclxuICAgIHRoaXMub2xkVHlwZSA9IG9sZFR5cGU7XHJcbiAgICB0aGlzLm5ld1R5cGUgPSBuZXdUeXBlO1xyXG4gICAgdGhpcy5hZmZlY3RlZENvdW50ID0gYWZmZWN0ZWRDb3VudDtcclxuICAgIHRoaXMub25Db25maXJtID0gb25Db25maXJtO1xyXG4gICAgdGhpcy5vbkNhbmNlbCA9IG9uQ2FuY2VsO1xyXG4gICAgdGhpcy5jb25maXJtZWQgPSBmYWxzZTtcclxuICB9XHJcblxyXG4gIG9uT3BlbigpIHtcclxuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xyXG4gICAgdGhpcy5tb2RhbEVsLmFkZENsYXNzKFwiZnJlZC1jb25maXJtLWRlbGV0ZS1tb2RhbFwiKTtcclxuICAgIC8vIERpZXNlbGJlIEZhcmJlIGZcdTAwRkNyIGFsdCB1bmQgbmV1IChkaWUgZGVzIGFsdGVuIE5hbWVucykgLSBkZXIgbmV1ZSBOYW1lXHJcbiAgICAvLyBoYXQgdm9yIGRlbSBlaWdlbnRsaWNoZW4gVW1iZW5lbm5lbiBub2NoIGtlaW5lbiBlaWdlbmVuIEVpbnRyYWcgaW5cclxuICAgIC8vIHR5cGVDb2xvcnMsIFx1MDBGQ2Jlcm5pbW10IGFiZXIgZGllIEZhcmJlIGRlcyBhbHRlbiAoc2llaGUgYXBwbHlSZW5hbWUpLlxyXG4gICAgY29uc3QgY29sb3IgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3RoaXMub2xkVHlwZV0gPz8gbnVsbDtcclxuICAgIGNvbnN0IHAgPSBjb250ZW50RWwuY3JlYXRlRWwoXCJwXCIpO1xyXG4gICAgcC5hcHBlbmRUZXh0KFwiVFlQIFwiKTtcclxuICAgIGFwcGVuZFR5cGVOYW1lKHAsIHRoaXMucGx1Z2luLCB0aGlzLm9sZFR5cGUsIGNvbG9yKTtcclxuICAgIHAuYXBwZW5kVGV4dChcIiBpbiBcIik7XHJcbiAgICBhcHBlbmRUeXBlTmFtZShwLCB0aGlzLnBsdWdpbiwgdGhpcy5uZXdUeXBlLCBjb2xvcik7XHJcbiAgICBwLmFwcGVuZFRleHQoYCB1bWJlbmVubmVuIHVuZCAke3RoaXMuYWZmZWN0ZWRDb3VudH0gTm90aXooZW4pIGVudHNwcmVjaGVuZCBhbnBhc3Nlbj9gKTtcclxuXHJcbiAgICBjb25zdCBidXR0b25Sb3cgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcIm1vZGFsLWJ1dHRvbi1jb250YWluZXJcIiB9KTtcclxuICAgIGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiQWJicmVjaGVuXCIgfSkuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY2xvc2UoKSk7XHJcblxyXG4gICAgY29uc3QgY29uZmlybUJ0biA9IGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IGNsczogXCJtb2QtY3RhXCIsIHRleHQ6IFwiVW1iZW5lbm5lblwiIH0pO1xyXG4gICAgY29uZmlybUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICB0aGlzLmNvbmZpcm1lZCA9IHRydWU7XHJcbiAgICAgIHRoaXMuY2xvc2UoKTtcclxuICAgICAgdGhpcy5vbkNvbmZpcm0oKTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgLy8gRGVja3Qgc293b2hsIFwiQWJicmVjaGVuXCItS2xpY2sgYWxzIGF1Y2ggRXNjYXBlL0tsaWNrIGRhbmViZW4gYWIgLSBhbmFsb2dcclxuICAvLyB6dW0gQ2FuY2VsLUhhbmRsaW5nIGluIFR5cFBpY2tlck1vZGFsLlxyXG4gIG9uQ2xvc2UoKSB7XHJcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xyXG4gICAgaWYgKCF0aGlzLmNvbmZpcm1lZCkgdGhpcy5vbkNhbmNlbD8uKCk7XHJcbiAgfVxyXG59XHJcblxyXG4vLyBVbWJlbmVubmVuIGF1ZiBkZW4gTmFtZW4gZWluZXMgYmVyZWl0cyByZWdpc3RyaWVydGVuIFRZUHMgKHNpZWhlXHJcbi8vIHN0YXJ0RGV0YWlsUmVuYW1lKSAtIHN0YXR0IGRpZSBVbWJlbmVubnVuZyBzdGlsbHNjaHdlaWdlbmQgenUgdmVyd2VyZmVuLFxyXG4vLyBhbmJpZXRlbiwgYmVpZGUgenVzYW1tZW56dWxlZ2VuIChzaWVoZSBtZXJnZVR5cGUpLiBTY2hyZWlidCBpbW1lciBhdWNoIGRpZVxyXG4vLyBOb3RpemVuIHVtLCB1bmFiaFx1MDBFNG5naWcgZGF2b24sIFx1MDBGQ2JlciB3ZWxjaGVuIGRlciBiZWlkZW4gVW1iZW5lbm5lbi1CdXR0b25zIGVzXHJcbi8vIGF1c2dlbFx1MDBGNnN0IHd1cmRlOiBlaW4gWnVzYW1tZW5sZWdlbiBudXIgaW4gZGVuIEVpbnN0ZWxsdW5nZW4gbGllXHUwMERGZSBkaWVcclxuLy8gTm90aXplbiBkZXMgUXVlbGwtVFlQcyBhbHMgdW5yZWdpc3RyaWVydGVuIEVpbnRyYWcgenVyXHUwMEZDY2suXHJcbmNsYXNzIENvbmZpcm1NZXJnZVR5cGVNb2RhbCBleHRlbmRzIENvbmZpcm1SZW5hbWVUeXBlTW9kYWwge1xyXG4gIG9uT3BlbigpIHtcclxuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xyXG4gICAgdGhpcy5tb2RhbEVsLmFkZENsYXNzKFwiZnJlZC1jb25maXJtLWRlbGV0ZS1tb2RhbFwiKTtcclxuICAgIGNvbnN0IHNldHRpbmdzID0gdGhpcy5wbHVnaW4uc2V0dGluZ3M7XHJcbiAgICBjb25zdCBwID0gY29udGVudEVsLmNyZWF0ZUVsKFwicFwiKTtcclxuICAgIHAuYXBwZW5kVGV4dChcIlRZUCBcIik7XHJcbiAgICBhcHBlbmRUeXBlTmFtZShwLCB0aGlzLnBsdWdpbiwgdGhpcy5uZXdUeXBlLCBzZXR0aW5ncy50eXBlQ29sb3JzW3RoaXMubmV3VHlwZV0gPz8gbnVsbCk7XHJcbiAgICBwLmFwcGVuZFRleHQoXCIgZXhpc3RpZXJ0IGJlcmVpdHMuIFwiKTtcclxuICAgIGFwcGVuZFR5cGVOYW1lKHAsIHRoaXMucGx1Z2luLCB0aGlzLm9sZFR5cGUsIHNldHRpbmdzLnR5cGVDb2xvcnNbdGhpcy5vbGRUeXBlXSA/PyBudWxsKTtcclxuICAgIHAuYXBwZW5kVGV4dChcIiBkYW1pdCB6dXNhbW1lbmxlZ2VuP1wiKTtcclxuXHJcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJwXCIsIHtcclxuICAgICAgdGV4dDpcclxuICAgICAgICBgJHt0aGlzLmFmZmVjdGVkQ291bnR9IE5vdGl6KGVuKSB3ZXJkZW4gYXVmICR7dGhpcy5uZXdUeXBlfSB1bWdlc3RlbGx0LiBgICtcclxuICAgICAgICBgRmFyYmUsIEJlc2NocmVpYnVuZyB1bmQgVFlQLUZyb250bWF0dGVyIHZvbiAke3RoaXMub2xkVHlwZX0gZW50ZmFsbGVuLCBgICtcclxuICAgICAgICBgc2VpbmUgU3VidHlwZW4gd2VyZGVuIFx1MDBGQ2Jlcm5vbW1lbiAoZ2xlaWNobmFtaWdlIFN1YnR5cC1CbFx1MDBGNmNrZSB6dXNhbW1lbmdlZlx1MDBGQ2hydCkuYCxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGJ1dHRvblJvdyA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibW9kYWwtYnV0dG9uLWNvbnRhaW5lclwiIH0pO1xyXG4gICAgYnV0dG9uUm93LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJBYmJyZWNoZW5cIiB9KS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5jbG9zZSgpKTtcclxuXHJcbiAgICBjb25zdCBjb25maXJtQnRuID0gYnV0dG9uUm93LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgY2xzOiBcIm1vZC13YXJuaW5nXCIsIHRleHQ6IFwiWnVzYW1tZW5sZWdlblwiIH0pO1xyXG4gICAgY29uZmlybUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICB0aGlzLmNvbmZpcm1lZCA9IHRydWU7XHJcbiAgICAgIHRoaXMuY2xvc2UoKTtcclxuICAgICAgdGhpcy5vbkNvbmZpcm0oKTtcclxuICAgIH0pO1xyXG4gIH1cclxufVxyXG5cclxuLy8gQmVzdFx1MDBFNHRpZ3VuZ2VuIHJ1bmQgdW0gU3VidHlwZW4gKHNpZWhlIHJlbmRlclNlY3Rpb25Gb290ZXIpOiBzY2hsaWNodGVyIFRleHRcclxuLy8gc3RhdHQgZWluZ2VmXHUwMEU0cmJ0ZXIgVFlQLU5hbWVuLCBzb25zdCB3aWUgZGllIFRZUC1Nb2RhbGUgb2Jlbi4gb25DYW5jZWwgZ3JlaWZ0XHJcbi8vIHdpZSBkb3J0IGF1Y2ggYmVpIEVzY2FwZS9LbGljayBkYW5lYmVuLlxyXG5jbGFzcyBDb25maXJtU3VidHlwZU1vZGFsIGV4dGVuZHMgTW9kYWwge1xyXG4gIGNvbnN0cnVjdG9yKGFwcCwgeyBwYXJhZ3JhcGhzLCBjb25maXJtVGV4dCwgY29uZmlybUNscywgb25Db25maXJtLCBvbkNhbmNlbCB9KSB7XHJcbiAgICBzdXBlcihhcHApO1xyXG4gICAgdGhpcy5wYXJhZ3JhcGhzID0gcGFyYWdyYXBocztcclxuICAgIHRoaXMuY29uZmlybVRleHQgPSBjb25maXJtVGV4dDtcclxuICAgIHRoaXMuY29uZmlybUNscyA9IGNvbmZpcm1DbHM7XHJcbiAgICB0aGlzLm9uQ29uZmlybSA9IG9uQ29uZmlybTtcclxuICAgIHRoaXMub25DYW5jZWwgPSBvbkNhbmNlbDtcclxuICAgIHRoaXMuY29uZmlybWVkID0gZmFsc2U7XHJcbiAgfVxyXG5cclxuICBvbk9wZW4oKSB7XHJcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcclxuICAgIHRoaXMubW9kYWxFbC5hZGRDbGFzcyhcImZyZWQtY29uZmlybS1kZWxldGUtbW9kYWxcIik7XHJcbiAgICBmb3IgKGNvbnN0IHRleHQgb2YgdGhpcy5wYXJhZ3JhcGhzKSBjb250ZW50RWwuY3JlYXRlRWwoXCJwXCIsIHsgdGV4dCB9KTtcclxuXHJcbiAgICBjb25zdCBidXR0b25Sb3cgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcIm1vZGFsLWJ1dHRvbi1jb250YWluZXJcIiB9KTtcclxuICAgIGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiQWJicmVjaGVuXCIgfSkuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY2xvc2UoKSk7XHJcblxyXG4gICAgY29uc3QgY29uZmlybUJ0biA9IGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IGNsczogdGhpcy5jb25maXJtQ2xzLCB0ZXh0OiB0aGlzLmNvbmZpcm1UZXh0IH0pO1xyXG4gICAgY29uZmlybUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICB0aGlzLmNvbmZpcm1lZCA9IHRydWU7XHJcbiAgICAgIHRoaXMuY2xvc2UoKTtcclxuICAgICAgdGhpcy5vbkNvbmZpcm0oKTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgb25DbG9zZSgpIHtcclxuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XHJcbiAgICBpZiAoIXRoaXMuY29uZmlybWVkKSB0aGlzLm9uQ2FuY2VsPy4oKTtcclxuICB9XHJcbn1cclxuXHJcbmNsYXNzIFR5cFZpZXcgZXh0ZW5kcyBJdGVtVmlldyB7XHJcbiAgY29uc3RydWN0b3IobGVhZiwgcGx1Z2luKSB7XHJcbiAgICBzdXBlcihsZWFmKTtcclxuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xyXG4gIH1cclxuXHJcbiAgZ2V0Vmlld1R5cGUoKSB7XHJcbiAgICByZXR1cm4gVklFV19UWVBFX1RZUDtcclxuICB9XHJcblxyXG4gIGdldERpc3BsYXlUZXh0KCkge1xyXG4gICAgcmV0dXJuIFwiVFlQXCI7XHJcbiAgfVxyXG5cclxuICBnZXRJY29uKCkge1xyXG4gICAgcmV0dXJuIFwic2hhcGVzXCI7XHJcbiAgfVxyXG5cclxuICBhc3luYyBvbk9wZW4oKSB7XHJcbiAgICB0aGlzLmlzRWRpdGluZyA9IGZhbHNlO1xyXG4gICAgdGhpcy5zZWxlY3RlZFR5cGUgPSBudWxsO1xyXG4gICAgdGhpcy5mcm9udG1hdHRlckJsb2NrcyA9IG51bGw7XHJcbiAgICB0aGlzLmZyb250bWF0dGVyRWRpdG9ycyA9IFtdO1xyXG5cclxuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XHJcbiAgICB0aGlzLmNvbnRlbnRFbC5hZGRDbGFzcyhcImZyZWQtdHlwLXZpZXdcIik7XHJcblxyXG4gICAgdGhpcy5yZWdpc3RlckRvbUV2ZW50KHRoaXMuY29udGVudEVsLCBcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XHJcbiAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRXNjYXBlXCIgJiYgdGhpcy5zZWxlY3RlZFR5cGUgIT09IG51bGwpIHRoaXMuY2xvc2VUeXBlU2V0dGluZ3MoKTtcclxuICAgIH0pO1xyXG4gICAgdGhpcy5yZW5kZXIoKTtcclxuICB9XHJcblxyXG4gIGFzeW5jIG9uQ2xvc2UoKSB7XHJcbiAgICB0aGlzLmNsb3NlU3VidHlwZUNvbG9yUG9wb3Zlcj8uKCk7XHJcbiAgfVxyXG5cclxuICBvcGVuU2VhcmNoKHR5cGUpIHtcclxuICAgIGNvbnN0IGdsb2JhbFNlYXJjaCA9IHRoaXMucGx1Z2luLmFwcC5pbnRlcm5hbFBsdWdpbnMuZ2V0UGx1Z2luQnlJZChcImdsb2JhbC1zZWFyY2hcIik7XHJcbiAgICBpZiAoIWdsb2JhbFNlYXJjaCkgcmV0dXJuO1xyXG4gICAgLy8gXCJrZWluIFR5cFwiIHRyXHUwMEU0ZmUgb2huZSBGaWx0ZXIgYXVjaCBhbGxlIE5pY2h0LU1hcmtkb3duLURhdGVpZW4gKGRpZSBuYXR1cmdlbVx1MDBFNFx1MDBERlxyXG4gICAgLy8gbmllIGVpbmUgRnJvbnRtYXR0ZXItUHJvcGVydHkgaGFiZW4ga1x1MDBGNm5uZW4pIC0gZGFoZXIgZXhwbGl6aXQgYXVmIC5tZCBlaW5ncmVuemVuLlxyXG4gICAgLy8gRlx1MDBGQ3IgZWluZSBMaXN0ZSAodW5yZWdpc3RyaWVydGVyIFNjaGxcdTAwRkNzc2VsIFwiW0EsIEJdXCIpIGdpYnQgZXMga2VpbmUgZXhha3RlXHJcbiAgICAvLyBTdWNoc3ludGF4IC0gZGFubiBuYWNoIE5vdGl6ZW4gc3VjaGVuLCBkaWUgYWxsZSBpaHJlIEVpbnRyXHUwMEU0Z2UgdHJhZ2VuLlxyXG4gICAgY29uc3QgcXVlcnkgPSB0eXBlID09PSBudWxsID8gYC1bXCIke1RZUF9QUk9QRVJUWX1cIl0gZmlsZToubWRgIDogdGhpcy50eXBlQ2xhdXNlKHR5cGUpO1xyXG4gICAgZ2xvYmFsU2VhcmNoLmluc3RhbmNlLm9wZW5HbG9iYWxTZWFyY2gocXVlcnkpO1xyXG4gIH1cclxuXHJcbiAgLy8gU3VjaGtsYXVzZWwgZlx1MDBGQ3IgZWluZW4gVFlQLVNjaGxcdTAwRkNzc2VsLiBGXHUwMEZDciBlaW5lIExpc3RlICh1bnJlZ2lzdHJpZXJ0ZXJcclxuICAvLyBTY2hsXHUwMEZDc3NlbCBcIltBLCBCXVwiKSBnaWJ0IGVzIGtlaW5lIGV4YWt0ZSBTdWNoc3ludGF4IC0gZGFubiBuYWNoIE5vdGl6ZW5cclxuICAvLyBzdWNoZW4sIGRpZSBhbGxlIGlocmUgRWludHJcdTAwRTRnZSB0cmFnZW4uIEF1Y2ggdm9uIG9wZW5TdWJ0eXBlU2VhcmNoKClcclxuICAvLyBnZW51dHp0OiBzZWl0IGRpZSBuaWNodCBlcmZhc3N0ZW4gU3VidHlwZW4gaW4gZGVyIExpc3RlIHN0ZWhlbiwga2FubiBkb3J0XHJcbiAgLy8gYXVjaCBlaW4gbmljaHQgZXJmYXNzdGVyICh1bmQgZGFtaXQgdW5zYXViZXJlcikgVFlQLVNjaGxcdTAwRkNzc2VsIGFua29tbWVuLlxyXG4gIHR5cGVDbGF1c2UodHlwZSkge1xyXG4gICAgY29uc3QgcmF3ID0gdGhpcy5wbHVnaW4udHlwSW5kZXgucmF3VmFsdWVPZih0eXBlKTtcclxuICAgIHJldHVybiBBcnJheS5pc0FycmF5KHJhdylcclxuICAgICAgPyByYXcubWFwKCh2KSA9PiBgW1wiJHtUWVBfUFJPUEVSVFl9XCI6XCIke1N0cmluZyh2ID8/IFwiXCIpLnRyaW0oKX1cIl1gKS5qb2luKFwiIFwiKVxyXG4gICAgICA6IGBbXCIke1RZUF9QUk9QRVJUWX1cIjpcIiR7dHlwZX1cIl1gO1xyXG4gIH1cclxuXHJcbiAgLy8gdHlwZUtleSBrb21tdCAxOjEgYXVzIGRlbiB0YXRzXHUwMEU0Y2hsaWNoZW4gRnJvbnRtYXR0ZXItV2VydGVuIChzaWVoZVxyXG4gIC8vIHVucmVnaXN0ZXJlZFJvd3MgaW4gcmVuZGVyKCkgdW5kIHR5cGVLZXlPZiBpbiB0eXAtaW5kZXguanMpIC0ga2FubiBhbHNvXHJcbiAgLy8ga2xlaW4gZ2VzY2hyaWViZW4gc2VpbiwgUmFuZGxlZXJ6ZWljaGVuIHRyYWdlbiBvZGVyIGVpbmUgTGlzdGUgc2Vpbi4gVFlQZW5cclxuICAvLyB3ZXJkZW4gYWJlciBpbW1lciBhbHMgc2F1YmVyZXIgRWluemVsd2VydCBpbiBHcm9cdTAwREZidWNoc3RhYmVuIGdlZlx1MDBGQ2hydCAtXHJcbiAgLy8gcmVnaXN0cmllcnQgd2lyZCBkZXNoYWxiIGRpZSBiZXJlaW5pZ3RlIEZvcm0gKHNpZWhlIG5vcm1hbGl6ZVJhd1R5cGUpLCB1bmRcclxuICAvLyBkaWUgYmV0cm9mZmVuZW4gTm90aXplbiB3ZXJkZW4gZ2xlaWNoIG1pdCB1bWdlc2NocmllYmVuLCBkYW1pdCBzaWUgbmljaHRcclxuICAvLyB3ZWl0ZXJoaW4gYWxzIFwibmljaHQgcmVnaXN0cmllcnRcIiBhdWZ0YXVjaGVuLlxyXG4gIGFzeW5jIHJlZ2lzdGVyVHlwZSh0eXBlS2V5KSB7XHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmFwcGx5VHlwZVJlZ2lzdHJhdGlvbih0eXBlS2V5KTtcclxuICAgIGlmICghcmVzdWx0KSByZXR1cm47XHJcblxyXG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICB0aGlzLnJlbmRlcigpO1xyXG4gICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcblxyXG4gICAgaWYgKHJlc3VsdC5yZW5hbWVkID4gMCkge1xyXG4gICAgICBuZXcgTm90aWNlKGBUWVAgJHtyZXN1bHQudHlwZX0gcmVnaXN0cmllcnQsICR7cmVzdWx0LnJlbmFtZWR9IE5vdGl6KGVuKSBhbmdlcGFzc3QuYCk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvLyBEZXIgZWlnZW50bGljaGUgVm9yZ2FuZyBhdXMgcmVnaXN0ZXJUeXBlKCksIG9obmUgU3BlaWNoZXJuLCBOZXV6ZWljaG5lblxyXG4gIC8vIHVuZCBOb3RpY2U6IHNvIGthbm4gcmVnaXN0ZXJUeXBlV2l0aFN1YnR5cGUoKSBUWVAgdW5kIFN1YnR5cCBuYWNoZWluYW5kZXJcclxuICAvLyBlaW50cmFnZW4gdW5kIGRhbmFjaCBFSU5NQUwgc3BlaWNoZXJuIHVuZCBFSU5FIE5vdGljZSB6ZWlnZW4sIHN0YXR0IHp3ZWltYWwuXHJcbiAgLy8gTGllZmVydCB7IHR5cGUsIHJlbmFtZWQgfSBvZGVyIG51bGwsIHdlbm4gbmljaHRzIEJyYXVjaGJhcmVzIFx1MDBGQ2JyaWcgYmxlaWJ0LlxyXG4gIGFzeW5jIGFwcGx5VHlwZVJlZ2lzdHJhdGlvbih0eXBlS2V5KSB7XHJcbiAgICBjb25zdCByYXcgPSB0aGlzLnBsdWdpbi50eXBJbmRleC5yYXdWYWx1ZU9mKHR5cGVLZXkpO1xyXG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVJhd1R5cGUocmF3ID09PSB1bmRlZmluZWQgPyB0eXBlS2V5IDogcmF3KTtcclxuICAgIGlmICghbm9ybWFsaXplZCkgcmV0dXJuIG51bGw7XHJcbiAgICBpZiAoIXRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVzLmluY2x1ZGVzKG5vcm1hbGl6ZWQpKSB7XHJcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVzLnB1c2gobm9ybWFsaXplZCk7XHJcbiAgICB9XHJcbiAgICBjb25zdCByZW5hbWVkID0gbm9ybWFsaXplZCAhPT0gdHlwZUtleSA/IGF3YWl0IHJlbmFtZVR5cGVJbk5vdGVzKHRoaXMucGx1Z2luLCB0eXBlS2V5LCBub3JtYWxpemVkKSA6IDA7XHJcbiAgICByZXR1cm4geyB0eXBlOiBub3JtYWxpemVkLCByZW5hbWVkIH07XHJcbiAgfVxyXG5cclxuICAvLyBOZXVlcywgbGVlcmVzIFRyZWUtSXRlbSBhbmxlZ2VuIHVuZCBzb2ZvcnQgaW4gZGVuIEVkaXRpZXItTW9kdXMgdmVyc2V0emVuIC1cclxuICAvLyB3aWUgYmVpIE9ic2lkaWFucyBlaWdlbmVuIFZpZXdzICh6LiBCLiBuZXVlIEJvb2ttYXJrLUdydXBwZSkuXHJcbiAgc3RhcnRBZGQoKSB7XHJcbiAgICBpZiAodGhpcy5pc0VkaXRpbmcpIHJldHVybjtcclxuXHJcbiAgICBjb25zdCB0cmVlSXRlbSA9IHRoaXMubGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW1cIiB9KTtcclxuICAgIGlmICh0aGlzLnNlcGFyYXRvckVsKSB0aGlzLmxpc3RFbC5pbnNlcnRCZWZvcmUodHJlZUl0ZW0sIHRoaXMuc2VwYXJhdG9yRWwpO1xyXG4gICAgY29uc3Qgc2VsZiA9IHRyZWVJdGVtLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0tc2VsZiBpcy1jbGlja2FibGVcIiB9KTtcclxuICAgIGNvbnN0IGlubmVyID0gc2VsZi5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLWlubmVyXCIgfSk7XHJcblxyXG4gICAgdGhpcy5zdGFydEVkaXRpbmcobnVsbCwgc2VsZiwgaW5uZXIpO1xyXG4gIH1cclxuXHJcbiAgLy8gV2llIE9ic2lkaWFucyBlaWdlbmUgVHJlZS1JdGVtczoga2VpbiB6dXNcdTAwRTR0emxpY2hlcyBJbnB1dC1FbGVtZW50LCBzb25kZXJuXHJcbiAgLy8gZGFzIGJlc3RlaGVuZGUgVGV4dC1FbGVtZW50IHdpcmQgc2VsYnN0IGVkaXRpZXJiYXIgKGNvbnRlbnRlZGl0YWJsZSkuXHJcbiAgLy8gdHlwZSA9PT0gbnVsbCBcdTIxOTIgbmV1ZXIgRWludHJhZywgc29uc3QgVW1iZW5lbm5lbiBkZXMgXHUwMEZDYmVyZ2ViZW5lbiBUeXBzLlxyXG4gIHN0YXJ0RWRpdGluZyh0eXBlLCBzZWxmLCBpbm5lcikge1xyXG4gICAgaWYgKHRoaXMuaXNFZGl0aW5nKSByZXR1cm47XHJcbiAgICB0aGlzLmlzRWRpdGluZyA9IHRydWU7XHJcblxyXG4gICAgc2VsZi5hZGRDbGFzcyhcImlzLWJlaW5nLXJlbmFtZWRcIik7XHJcbiAgICBpbm5lci5zZXRBdHRyaWJ1dGUoXCJjb250ZW50ZWRpdGFibGVcIiwgXCJ0cnVlXCIpO1xyXG4gICAgaW5uZXIuc2V0QXR0cmlidXRlKFwic3BlbGxjaGVja1wiLCBcImZhbHNlXCIpO1xyXG4gICAgaW5uZXIuZm9jdXMoKTtcclxuXHJcbiAgICBjb25zdCByYW5nZSA9IGlubmVyLmRvYy5jcmVhdGVSYW5nZSgpO1xyXG4gICAgcmFuZ2Uuc2VsZWN0Tm9kZUNvbnRlbnRzKGlubmVyKTtcclxuICAgIGNvbnN0IHNlbGVjdGlvbiA9IGlubmVyLndpbi5nZXRTZWxlY3Rpb24oKTtcclxuICAgIHNlbGVjdGlvbi5yZW1vdmVBbGxSYW5nZXMoKTtcclxuICAgIHNlbGVjdGlvbi5hZGRSYW5nZShyYW5nZSk7XHJcblxyXG4gICAgbGV0IGRvbmUgPSBmYWxzZTtcclxuICAgIGNvbnN0IGZpbmlzaCA9IGFzeW5jIChjb21taXQpID0+IHtcclxuICAgICAgaWYgKGRvbmUpIHJldHVybjtcclxuICAgICAgZG9uZSA9IHRydWU7XHJcbiAgICAgIHRoaXMuaXNFZGl0aW5nID0gZmFsc2U7XHJcblxyXG4gICAgICBjb25zdCB2YWx1ZSA9IG5vcm1hbGl6ZVR5cGVOYW1lKGlubmVyLnRleHRDb250ZW50KTtcclxuICAgICAgaWYgKGNvbW1pdCAmJiB2YWx1ZSAmJiB2YWx1ZSAhPT0gdHlwZSkge1xyXG4gICAgICAgIGNvbnN0IGV4aXN0cyA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVzLnNvbWUoXHJcbiAgICAgICAgICAodCkgPT4gdC50b0xvd2VyQ2FzZSgpID09PSB2YWx1ZS50b0xvd2VyQ2FzZSgpICYmIHQgIT09IHR5cGVcclxuICAgICAgICApO1xyXG4gICAgICAgIGlmICghZXhpc3RzKSB7XHJcbiAgICAgICAgICBpZiAodHlwZSA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlcy5wdXNoKHZhbHVlKTtcclxuICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGlkeCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVzLmluZGV4T2YodHlwZSk7XHJcbiAgICAgICAgICAgIGlmIChpZHggIT09IC0xKSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlc1tpZHhdID0gdmFsdWU7XHJcbiAgICAgICAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV07XHJcbiAgICAgICAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXTtcclxuICAgICAgICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdO1xyXG4gICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV07XHJcbiAgICAgICAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVTaG9ydGN1dHNbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVTaG9ydGN1dHNbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZVNob3J0Y3V0c1t0eXBlXTtcclxuICAgICAgICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZVNob3J0Y3V0c1t0eXBlXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBpZiAodGhpcy5lbnN1cmVUeXBlTWFudWFsKClbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVNYW51YWxbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZU1hbnVhbFt0eXBlXTtcclxuICAgICAgICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZU1hbnVhbFt0eXBlXTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBtb3ZlVHlwZVN1YnR5cGVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlLCB2YWx1ZSk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICB0aGlzLnJlbmRlcigpO1xyXG4gICAgfTtcclxuXHJcbiAgICBpbm5lci5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCAoZXZlbnQpID0+IHtcclxuICAgICAgaWYgKGV2ZW50LmtleSA9PT0gXCJFbnRlclwiKSB7XHJcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgICBmaW5pc2godHJ1ZSk7XHJcbiAgICAgIH0gZWxzZSBpZiAoZXZlbnQua2V5ID09PSBcIkVzY2FwZVwiKSB7XHJcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgICBmaW5pc2goZmFsc2UpO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgICBpbm5lci5hZGRFdmVudExpc3RlbmVyKFwiYmx1clwiLCAoKSA9PiBmaW5pc2godHJ1ZSkpO1xyXG4gIH1cclxuXHJcbiAgb3BlblR5cGVTZXR0aW5ncyh0eXBlKSB7XHJcbiAgICB0aGlzLnNlbGVjdGVkVHlwZSA9IHR5cGU7XHJcbiAgICB0aGlzLnJlbmRlcigpO1xyXG4gIH1cclxuXHJcbiAgY2xvc2VUeXBlU2V0dGluZ3MoKSB7XHJcbiAgICB0aGlzLnNlbGVjdGVkVHlwZSA9IG51bGw7XHJcbiAgICB0aGlzLnJlbmRlcigpO1xyXG4gIH1cclxuXHJcbiAgLy8gV2lyZCBhbHMgQ29tcG9uZW50LUNoaWxkIGdlbGFkZW4gKHNpZWhlIG1vdW50RnJvbnRtYXR0ZXJFZGl0b3IpIHVuZCBtdXNzXHJcbiAgLy8gZGVzaGFsYiB2b3IgamVkZW0gTmV1YXVmYmF1IGRlciBEZXRhaWwtQW5zaWNodCBleHBsaXppdCBlbnRsYWRlbiB3ZXJkZW4gLVxyXG4gIC8vIGNvbnRlbnRFbC5lbXB0eSgpIGFsbGVpbiB3XHUwMEZDcmRlIG51ciBkaWUgRE9NLUVsZW1lbnRlIGVudGZlcm5lbiwgbmljaHQgYWJlclxyXG4gIC8vIGRlbiBkYXJhdWYgcmVnaXN0cmllcnRlbiBtZXRhZGF0YVR5cGVNYW5hZ2VyLUxpc3RlbmVyIGRlciBFZGl0b3ItSW5zdGFuei5cclxuICAvLyBmcm9udG1hdHRlckJsb2NrcyBpc3QgZGllIFN0ZXVlcnVuZyBcdTAwRkNiZXIgYWxsZSBCbFx1MDBGNmNrZSAodS4gYS4gZlx1MDBGQ3IgZGVuXHJcbiAgLy8gQmVmZWhsIFwiU3RhbmRhcmQtUHJvcGVydHkgaGluenVmXHUwMEZDZ2VuXCIpLCBmcm9udG1hdHRlckVkaXRvcnMgYWxsZSBFZGl0b3JlblxyXG4gIC8vIGRlciBEZXRhaWxhbnNpY2h0IGlua2wuIGRlciBTdWJ0eXAtQmxcdTAwRjZja2UuXHJcbiAgZGVzdHJveUZyb250bWF0dGVyRWRpdG9yKCkge1xyXG4gICAgZm9yIChjb25zdCBlZGl0b3Igb2YgdGhpcy5mcm9udG1hdHRlckVkaXRvcnMgPz8gW10pIHRoaXMucmVtb3ZlQ2hpbGQoZWRpdG9yKTtcclxuICAgIHRoaXMuZnJvbnRtYXR0ZXJFZGl0b3JzID0gW107XHJcbiAgICB0aGlzLmZyb250bWF0dGVyQmxvY2tzID0gbnVsbDtcclxuICB9XHJcblxyXG4gIHJlbmRlcigpIHtcclxuICAgIC8vIFJlZW50cmFuY3ktR3VhcmQ6IHJlbmRlclR5cGVTZXR0aW5ncygpIGxcdTAwRjZzdCBhbSBFbmRlIHNlbGJzdFxyXG4gICAgLy8gcGx1Z2luLnJlZnJlc2hUeXBDb2xvcnMoKSBhdXMgKHNpZWhlIGRvcnRpZ2VyIEtvbW1lbnRhciksIHdhcyB1LiBhLlxyXG4gICAgLy8gXHUwMEZDYmVyIHJlZ2lzdGVyVHlwVmlldyB3aWVkZXJ1bSByZW5kZXIoKSBhdWYgYWxsZW4gVFlQLVZpZXctTGVhdmVzXHJcbiAgICAvLyBhdWZydWZ0IC0gaW5rbHVzaXZlIGRpZXNlbSwgd1x1MDBFNGhyZW5kIGVzIG5vY2ggbWl0dGVuIGluIGdlbmF1IGRpZXNlbVxyXG4gICAgLy8gQXVmcnVmIHN0ZWNrdC4gT2huZSBHdWFyZCByZWt1cnNpZXJ0IGRhcyBzeW5jaHJvbiBvaG5lIEFiYnJ1Y2ggYmlzXHJcbiAgICAvLyB6dW0gU3RhY2sgT3ZlcmZsb3csIGJlaSBqZWRlbSBcdTAwRDZmZm5lbi9VbWJlbmVubmVuIGVpbmVzIFRZUHMuXHJcbiAgICBpZiAodGhpcy5fcmVuZGVyaW5nKSByZXR1cm47XHJcbiAgICB0aGlzLl9yZW5kZXJpbmcgPSB0cnVlO1xyXG4gICAgdHJ5IHtcclxuICAgICAgdGhpcy5kZXN0cm95RnJvbnRtYXR0ZXJFZGl0b3IoKTtcclxuICAgICAgaWYgKHRoaXMuc2VsZWN0ZWRUeXBlICE9PSBudWxsKSB7XHJcbiAgICAgICAgdGhpcy5yZW5kZXJUeXBlU2V0dGluZ3ModGhpcy5zZWxlY3RlZFR5cGUpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XHJcbiAgICAgIGNvbnRlbnRFbC5lbXB0eSgpO1xyXG5cclxuICAgICAgY29uc3QgeyBjb3VudHMsIG5vVHlwZSB9ID0gdGhpcy5wbHVnaW4udHlwSW5kZXgudHlwZUNvdW50cygpO1xyXG4gICAgICBjb25zdCByZWdpc3RlcmVkID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXM7XHJcbiAgICAgIGNvbnN0IHR5cGVDb2xvcnMgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzO1xyXG4gICAgICBjb25zdCBzb3J0T3JkZXIgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBTb3J0T3JkZXIgPz8gREVGQVVMVF9TT1JUX09SREVSO1xyXG4gICAgICBjb25zdCBpc01hbnVhbFNvcnQgPSBzb3J0T3JkZXIgPT09IFwibWFudWFsXCI7XHJcbiAgICAgIGNvbnN0IGJ5Q3VycmVudE9yZGVyID0gKGEsIGIpID0+IGNvbXBhcmVUeXBlcyhzb3J0T3JkZXIsIGEsIGIsIGNvdW50cywgdHlwZUNvbG9ycyk7XHJcblxyXG4gICAgICB0aGlzLnJlbmRlckxpc3RIZWFkZXIoY29udGVudEVsKTtcclxuXHJcbiAgICAgIGNvbnN0IHVucmVnaXN0ZXJlZFJvd3MgPSBbLi4uY291bnRzLmtleXMoKV1cclxuICAgICAgICAuZmlsdGVyKCh0eXBlKSA9PiAhcmVnaXN0ZXJlZC5pbmNsdWRlcyh0eXBlKSlcclxuICAgICAgICAuc29ydChieUN1cnJlbnRPcmRlcilcclxuICAgICAgICAubWFwKCh0eXBlKSA9PiAoeyB0eXBlLCBjb3VudDogY291bnRzLmdldCh0eXBlKSA/PyAwIH0pKTtcclxuICAgICAgY29uc3QgdW5yZWdpc3RlcmVkU3VidHlwZVJvd3MgPSB0aGlzLnVucmVnaXN0ZXJlZFN1YnR5cGVSb3dzKCk7XHJcblxyXG4gICAgICAvLyBPaG5lIHp3ZWl0ZSBTcGFsdGUgZGFyZiBkZXIgTmFtZSBkaWUgZ2FuemUgWmVpbGUgbmVobWVuIChzaWVoZVxyXG4gICAgICAvLyAuZnJlZC10eXAtbGlzdC1uby1zZWNvbmRhcnkgaW4gc3R5bGVzLmNzcykuXHJcbiAgICAgIGNvbnN0IGxpc3RDbHMgPSBcImZyZWQtdHlwLWxpc3QgbmF2LWZpbGVzLWNvbnRhaW5lclwiICsgKHRoaXMuc2Vjb25kYXJ5TW9kZSgpID09PSBcIm5vbmVcIiA/IFwiIGZyZWQtdHlwLWxpc3Qtbm8tc2Vjb25kYXJ5XCIgOiBcIlwiKTtcclxuICAgICAgdGhpcy5saXN0RWwgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBsaXN0Q2xzIH0pO1xyXG4gICAgICB0aGlzLnNlcGFyYXRvckVsID0gbnVsbDtcclxuXHJcbiAgICAgIC8vIHNvcnRUeXBlc0J5TW9kZSgpIGxcdTAwRTRzc3QgaW0gTWFudWVsbC1Nb2R1cyBiZXd1c3N0IGRpZSBSZWloZW5mb2xnZSB2b25cclxuICAgICAgLy8gcGx1Z2luLnNldHRpbmdzLnR5cGVzIHVuYW5nZXRhc3RldCAtIHBlciBEcmFnICYgRHJvcCBpblxyXG4gICAgICAvLyByZW5kZXJSZWdpc3RlcmVkSXRlbSgpIHVtc29ydGllcnQuIERlciBpbmRleCB3aXJkIGRhZlx1MDBGQ3IgMToxIGFsc1xyXG4gICAgICAvLyBQb3NpdGlvbiBpbiBkaWVzZXIgKGluIGRpZXNlbSBNb2R1cyB1bnZlclx1MDBFNG5kZXJ0ZW4pIFJlaWhlbmZvbGdlXHJcbiAgICAgIC8vIHdlaXRlcmdlZ2ViZW4uXHJcbiAgICAgIGNvbnN0IHJlZ2lzdGVyZWRPcmRlciA9IHNvcnRUeXBlc0J5TW9kZShyZWdpc3RlcmVkLCBzb3J0T3JkZXIsIGNvdW50cywgdHlwZUNvbG9ycyk7XHJcbiAgICAgIHJlZ2lzdGVyZWRPcmRlci5mb3JFYWNoKCh0eXBlLCBpbmRleCkgPT4ge1xyXG4gICAgICAgIHRoaXMucmVuZGVyUmVnaXN0ZXJlZEl0ZW0odHlwZSwgY291bnRzLmdldCh0eXBlKSA/PyAwLCB7IGRyYWdnYWJsZTogaXNNYW51YWxTb3J0LCBpbmRleCB9KTtcclxuICAgICAgfSk7XHJcblxyXG4gICAgICAvLyBVbnRlcmhhbGIgZGVyIFRyZW5ubGluaWUgZHJlaSBBYnNjaG5pdHRlLCBqZWRlciBmXHUwMEZDciBzaWNoIG9wdGlvbmFsOlxyXG4gICAgICAvLyBuaWNodCBlcmZhc3N0ZSBUWVBlbiwgbmljaHQgZXJmYXNzdGUgU3VidHlwZW4sIFwiW0tFSU4gVFlQXVwiLiBEaWVcclxuICAgICAgLy8gU3VidHlwZW4gYmVrb21tZW4gZWluZSBlaWdlbmUgVHJlbm5saW5pZSwgd2VpbCBzaWUgbmFjaCBlaW5lciBhbmRlcmVuXHJcbiAgICAgIC8vIFJlZ2VsIHNvcnRpZXJ0IHNpbmQgYWxzIGRpZSBUWVBlbiBkYXJcdTAwRkNiZXIgKEFuemFobCBzdGF0dCBTb3J0aWVyLUJ1dHRvbixcclxuICAgICAgLy8gc2llaGUgdW5yZWdpc3RlcmVkU3VidHlwZVJvd3MpIC0gb2huZSBzaWNodGJhcmVuIFNjaG5pdHQgc1x1MDBFNGhlIGRhcyBuYWNoXHJcbiAgICAgIC8vIGthcHV0dGVyIFNvcnRpZXJ1bmcgYXVzLiBcIltLRUlOIFRZUF1cIiBpc3Qga2VpbiBlY2h0ZXIgVHlwLCBuaW1tdCBhblxyXG4gICAgICAvLyBrZWluZXIgU29ydGllcnVuZyB0ZWlsIHVuZCBzdGVodCB1bmFiaFx1MDBFNG5naWcgdm9uIHNlaW5lciBBbnphaGwgenVsZXR6dDtcclxuICAgICAgLy8gZXMgc2NobGllXHUwMERGdCBkaXJla3QgYW4sIHN0YXR0IGVpbmUgZHJpdHRlIExpbmllIHp1IGJla29tbWVuLlxyXG4gICAgICAvL1xyXG4gICAgICAvLyB0aGlzLnNlcGFyYXRvckVsIGJsZWlidCBiZXd1c3N0IGRpZSBFUlNURSBMaW5pZTogc3RhcnRBZGQoKSBoXHUwMEU0bmd0IGRhc1xyXG4gICAgICAvLyBuZXVlIFRyZWUtSXRlbSBkYXZvciwgdW5kIGVpbiBuZXVlciBUWVAgZ2VoXHUwMEY2cnQgYW5zIEVuZGUgZGVyIGVyZmFzc3RlbixcclxuICAgICAgLy8gbmljaHQgendpc2NoZW4gZGllIG5pY2h0IGVyZmFzc3RlbiBBYnNjaG5pdHRlLlxyXG4gICAgICBjb25zdCBzZXBhcmF0b3IgPSAoKSA9PiB7XHJcbiAgICAgICAgY29uc3QgZWwgPSB0aGlzLmxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtc2VwYXJhdG9yXCIgfSk7XHJcbiAgICAgICAgdGhpcy5zZXBhcmF0b3JFbCA9IHRoaXMuc2VwYXJhdG9yRWwgPz8gZWw7XHJcbiAgICAgIH07XHJcblxyXG4gICAgICBpZiAodW5yZWdpc3RlcmVkUm93cy5sZW5ndGggPiAwIHx8IHVucmVnaXN0ZXJlZFN1YnR5cGVSb3dzLmxlbmd0aCA+IDAgfHwgbm9UeXBlID4gMCkgc2VwYXJhdG9yKCk7XHJcbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHVucmVnaXN0ZXJlZFJvd3MpIHRoaXMucmVuZGVyVW5yZWdpc3RlcmVkSXRlbShyb3cudHlwZSwgcm93LmNvdW50KTtcclxuXHJcbiAgICAgIGlmICh1bnJlZ2lzdGVyZWRTdWJ0eXBlUm93cy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgaWYgKHVucmVnaXN0ZXJlZFJvd3MubGVuZ3RoID4gMCkgc2VwYXJhdG9yKCk7XHJcbiAgICAgICAgZm9yIChjb25zdCByb3cgb2YgdW5yZWdpc3RlcmVkU3VidHlwZVJvd3MpIHRoaXMucmVuZGVyVW5yZWdpc3RlcmVkU3VidHlwZUl0ZW0ocm93KTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKG5vVHlwZSA+IDApIHRoaXMucmVuZGVyTm9UeXBlSXRlbShub1R5cGUpO1xyXG4gICAgfSBmaW5hbGx5IHtcclxuICAgICAgdGhpcy5fcmVuZGVyaW5nID0gZmFsc2U7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvLyBXaWUgZGVyIFwiQ2hhbmdlIHNvcnQgb3JkZXJcIi1CdXR0b24gaW4gT2JzaWRpYW5zIFRhZ3MtIGJ6dy4gQWxsLVByb3BlcnRpZXMtVmlldy5cclxuICByZW5kZXJMaXN0SGVhZGVyKGNvbnRlbnRFbCkge1xyXG4gICAgY29uc3QgaGVhZGVyID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJuYXYtaGVhZGVyXCIgfSk7XHJcbiAgICBjb25zdCBidXR0b25zQ29udGFpbmVyID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJuYXYtYnV0dG9ucy1jb250YWluZXJcIiB9KTtcclxuXHJcbiAgICBjb25zdCBhZGRCdG4gPSBidXR0b25zQ29udGFpbmVyLmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiBuYXYtYWN0aW9uLWJ1dHRvblwiLFxyXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIk5ldWVuIFR5cCBoaW56dWZcdTAwRkNnZW5cIiB9LFxyXG4gICAgfSk7XHJcbiAgICBzZXRJY29uKGFkZEJ0biwgXCJwbHVzXCIpO1xyXG4gICAgYWRkQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnN0YXJ0QWRkKCkpO1xyXG5cclxuICAgIGNvbnN0IHNvcnRCdG4gPSBidXR0b25zQ29udGFpbmVyLmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiBuYXYtYWN0aW9uLWJ1dHRvblwiLFxyXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlNvcnRpZXJyZWloZW5mb2xnZSBcdTAwRTRuZGVyblwiIH0sXHJcbiAgICB9KTtcclxuICAgIHNldEljb24oc29ydEJ0biwgXCJsdWNpZGUtc29ydC1hc2NcIik7XHJcbiAgICBzb3J0QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IHRoaXMuc2hvd1NvcnRNZW51KGV2ZW50KSk7XHJcblxyXG4gICAgLy8gWndlaXRlIFNwYWx0ZTogYmV3dXNzdCBrZWluIE1lbnVlLCBzb25kZXJuIGVpbiBLbm9wZiwgZGVyIGRpZSBkcmVpIE1vZGlcclxuICAgIC8vIGRlciBSZWloZSBuYWNoIGR1cmNoc2NoYWx0ZXQgLSBiZWkgc28gd2VuaWdlbiBadXN0YWVuZGVuLCBkZXJlbiBXaXJrdW5nXHJcbiAgICAvLyBkaXJla3QgZGFydW50ZXIgc2ljaHRiYXIgd2lyZCwgaXN0IER1cmNoa2xpY2tlbiBzY2huZWxsZXIgYWxzIEF1ZmtsYXBwZW5cclxuICAgIC8vIHVuZCBBdXN3YWVobGVuLiBJY29uIHVuZCBUb29sdGlwIHplaWdlbiBkZW4gYWt0dWVsbGVuIE1vZHVzLlxyXG4gICAgY29uc3QgY3VycmVudCA9IFNFQ09OREFSWV9NT0RFU1t0aGlzLnNlY29uZGFyeUluZGV4KCldO1xyXG4gICAgY29uc3Qgc2Vjb25kYXJ5QnRuID0gYnV0dG9uc0NvbnRhaW5lci5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gbmF2LWFjdGlvbi1idXR0b25cIixcclxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogYE5lYmVuIGRlbSBOYW1lbjogJHtjdXJyZW50LnRpdGxlfWAgfSxcclxuICAgIH0pO1xyXG4gICAgc2V0SWNvbihzZWNvbmRhcnlCdG4sIGN1cnJlbnQuaWNvbik7XHJcbiAgICBzZWNvbmRhcnlCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY3ljbGVTZWNvbmRhcnkoKSk7XHJcbiAgfVxyXG5cclxuICAvLyBzZXR0aW5ncy50eXBMaXN0U2Vjb25kYXJ5LCBhYmVyIGltbWVyIGVpbiBndWVsdGlnZXIgTW9kdXMgLSBCZXN0YW5kc2RhdGVuXHJcbiAgLy8ga2VubmVuIGRlbiBTY2hsdWVzc2VsIG5vY2ggbmljaHQgKHNpZWhlIG1pZ3JhdGVUeXBMaXN0U2Vjb25kYXJ5IGluIG1haW4uanMpLFxyXG4gIC8vIHVuZCBlaW4gc3BhZXRlciBlbnRmZXJudGVyIE1vZHVzIHNvbGwgZGllIExpc3RlIG5pY2h0IGxlZXIgbGFzc2VuLlxyXG4gIHNlY29uZGFyeU1vZGUoKSB7XHJcbiAgICBjb25zdCBtb2RlID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwTGlzdFNlY29uZGFyeTtcclxuICAgIHJldHVybiBTRUNPTkRBUllfTU9ERVMuc29tZSgoZW50cnkpID0+IGVudHJ5Lm1vZGUgPT09IG1vZGUpID8gbW9kZSA6IERFRkFVTFRfU0VDT05EQVJZO1xyXG4gIH1cclxuXHJcbiAgc2Vjb25kYXJ5SW5kZXgoKSB7XHJcbiAgICByZXR1cm4gU0VDT05EQVJZX01PREVTLmZpbmRJbmRleCgoZW50cnkpID0+IGVudHJ5Lm1vZGUgPT09IHRoaXMuc2Vjb25kYXJ5TW9kZSgpKTtcclxuICB9XHJcblxyXG4gIGFzeW5jIGN5Y2xlU2Vjb25kYXJ5KCkge1xyXG4gICAgY29uc3QgbmV4dCA9IFNFQ09OREFSWV9NT0RFU1sodGhpcy5zZWNvbmRhcnlJbmRleCgpICsgMSkgJSBTRUNPTkRBUllfTU9ERVMubGVuZ3RoXTtcclxuICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cExpc3RTZWNvbmRhcnkgPSBuZXh0Lm1vZGU7XHJcbiAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgIC8vIFdpZSBpbSBTb3J0aWVyLU1lbnVlOiBudXIgbmV1IHplaWNobmVuLiBEZXIgTW9kdXMgYmV0cmlmZnQgYXVzc2NobGllc3NsaWNoXHJcbiAgICAvLyBkaWVzZSBMaXN0ZSwgbmljaHQgZGllIEVpbmZhZXJidW5nIGFuZGVyc3dvIC0gcmVmcmVzaFR5cENvbG9ycyB3YWVyZSBoaWVyXHJcbiAgICAvLyBhbHNvIG51ciBlaW4gdW5ub2V0aWdlcyBSdW5kdW0tTmV1emVpY2huZW4gYWxsZXIgQW5zaWNodGVuLlxyXG4gICAgdGhpcy5yZW5kZXIoKTtcclxuICB9XHJcblxyXG4gIHNob3dTb3J0TWVudShldmVudCkge1xyXG4gICAgY29uc3QgY3VycmVudCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cFNvcnRPcmRlciA/PyBERUZBVUxUX1NPUlRfT1JERVI7XHJcbiAgICBjb25zdCBtZW51ID0gbmV3IE1lbnUoKTtcclxuXHJcbiAgICBjb25zdCBhZGRHcm91cCA9IChzdGFydCwgZW5kKSA9PiB7XHJcbiAgICAgIGZvciAobGV0IGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XHJcbiAgICAgICAgY29uc3QgeyBtb2RlLCB0aXRsZSB9ID0gU09SVF9PUFRJT05TW2ldO1xyXG4gICAgICAgIG1lbnUuYWRkSXRlbSgoaXRlbSkgPT5cclxuICAgICAgICAgIGl0ZW1cclxuICAgICAgICAgICAgLnNldFRpdGxlKHRpdGxlKVxyXG4gICAgICAgICAgICAuc2V0Q2hlY2tlZChjdXJyZW50ID09PSBtb2RlKVxyXG4gICAgICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwU29ydE9yZGVyID0gbW9kZTtcclxuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgICAgICB0aGlzLnJlbmRlcigpO1xyXG4gICAgICAgICAgICB9KVxyXG4gICAgICAgICk7XHJcbiAgICAgIH1cclxuICAgIH07XHJcblxyXG4gICAgYWRkR3JvdXAoMCwgMSk7XHJcbiAgICBtZW51LmFkZFNlcGFyYXRvcigpO1xyXG4gICAgYWRkR3JvdXAoMSwgMyk7XHJcbiAgICBtZW51LmFkZFNlcGFyYXRvcigpO1xyXG4gICAgYWRkR3JvdXAoMywgNSk7XHJcbiAgICBtZW51LmFkZFNlcGFyYXRvcigpO1xyXG4gICAgYWRkR3JvdXAoNSwgNyk7XHJcblxyXG4gICAgbWVudS5zaG93QXRNb3VzZUV2ZW50KGV2ZW50KTtcclxuICB9XHJcblxyXG4gIHJlbmRlck5vVHlwZUl0ZW0oY291bnQpIHtcclxuICAgIGNvbnN0IHRyZWVJdGVtID0gdGhpcy5saXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbVwiIH0pO1xyXG4gICAgY29uc3Qgc2VsZiA9IHRyZWVJdGVtLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0tc2VsZiBpcy1jbGlja2FibGUgZnJlZC10eXAtdW5yZWdpc3RlcmVkXCIgfSk7XHJcbiAgICBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0taW5uZXJcIiwgdGV4dDogXCJbS0VJTiBUWVBdXCIgfSk7XHJcbiAgICB0aGlzLnJlbmRlckNvdW50RmxhaXIoc2VsZiwgY291bnQpO1xyXG5cclxuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMub3BlblNlYXJjaChudWxsKSk7XHJcbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcclxuICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgIHRoaXMub3BlblNlYXJjaChudWxsKTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgLy8gQ2hyb21pdW1zIGlucHV0W3R5cGU9Y29sb3JdIGhhdCBlaW5lbiBlaWdlbmVuIE1pbmRlc3QtU3dhdGNoLCBkZXIgc2ljaCBuaWNodFxyXG4gIC8vIHVudGVyIFRleHRnclx1MDBGNlx1MDBERmUgc2thbGllcmVuIGxcdTAwRTRzc3QgLSBkYWhlciBudXIgYWxzIHVuc2ljaHRiYXJlbiBQaWNrZXItVHJpZ2dlclxyXG4gIC8vIFx1MDBGQ2JlciBkZW0gZnJlaSBza2FsaWVyYmFyZW4gUHVua3QgcGxhdHppZXJlbi4gT2huZSBlaWdlbmUgRmFyYmUgc3RlaHQgZGVyXHJcbiAgLy8gUHVua3QgYWxzIGhvaGxlciBncmF1ZXIgUmluZyBkYSAoc2llaGUgcGFpbnRDb2xvckRvdCk7IG1pdCBzaG93UmVzZXRcclxuICAvLyAoRGV0YWlsYW5zaWNodCkgbmVubnQgZWluIFRvb2x0aXAgZGVuIFp1c3RhbmQsIHVuZCBkZXIgWnVyXHUwMEZDY2tzZXR6ZW4tQnV0dG9uXHJcbiAgLy8gaXN0IGRhbm4gYXVzZ2VncmF1dC5cclxuICByZW5kZXJDb2xvclBpY2tlcihwYXJlbnQsIHR5cGUsIG9uQ2hhbmdlLCB7IHNob3dSZXNldCA9IGZhbHNlIH0gPSB7fSkge1xyXG4gICAgY29uc3QgY3VycmVudENvbG9yID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXSA/PyBERUZBVUxUX1RZUEVfQ09MT1I7XHJcbiAgICBjb25zdCBjb2xvcldyYXAgPSBwYXJlbnQuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWNvbG9yLXdyYXBcIiB9KTtcclxuICAgIGNvbnN0IGNvbG9yRG90ID0gY29sb3JXcmFwLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1jb2xvci1kb3RcIiB9KTtcclxuICAgIGxldCByZXNldEJ0biA9IG51bGw7XHJcbiAgICBjb25zdCBzaG93U3RhdGUgPSAoY29sb3IsIGlzRGVmYXVsdCkgPT4ge1xyXG4gICAgICBwYWludENvbG9yRG90KGNvbG9yRG90LCBjb2xvciwgaXNEZWZhdWx0KTtcclxuICAgICAgaWYgKCFzaG93UmVzZXQpIHJldHVybjtcclxuICAgICAgY29sb3JXcmFwLnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgaXNEZWZhdWx0ID8gXCJTdGFuZGFyZCAoa2VpbmUgRmFyYmUpXCIgOiBcIkZhcmJlIFx1MDBFNG5kZXJuXCIpO1xyXG4gICAgICByZXNldEJ0bj8udG9nZ2xlQ2xhc3MoXCJpcy1kaXNhYmxlZFwiLCBpc0RlZmF1bHQpO1xyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBjb2xvcklucHV0ID0gY29sb3JXcmFwLmNyZWF0ZUVsKFwiaW5wdXRcIiwgeyB0eXBlOiBcImNvbG9yXCIsIGNsczogXCJmcmVkLXR5cC1jb2xvci1pbnB1dFwiIH0pO1xyXG4gICAgY29sb3JJbnB1dC52YWx1ZSA9IGN1cnJlbnRDb2xvcjtcclxuICAgIGNvbG9ySW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChldmVudCkgPT4gZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCkpO1xyXG5cclxuICAgIC8vIFwiaW5wdXRcIiBmZXVlcnQgYmVpIGplZGVyIFp3aXNjaGVuZmFyYmUsIHdcdTAwRTRocmVuZCBkZXIgbmF0aXZlIFBpY2tlciBub2NoXHJcbiAgICAvLyBvZmZlbiBpc3QgLSBoaWVyIG51ciBsb2thbGUgVm9yc2NoYXUgKFB1bmt0LCBnZ2YuIE5hbWUgdmlhIG9uQ2hhbmdlKSwgb2huZVxyXG4gICAgLy8gZGllIFx1MDBGQ2JyaWdlbiBWaWV3cyAoRGF0ZWktRXhwbG9yZXIsIEdyYXBoLCAuLi4pIG5ldSB6dSByZW5kZXJuOlxyXG4gICAgLy8gcmVmcmVzaFR5cENvbG9ycygpIGxcdTAwRjZzdCBkYWZcdTAwRkNyIHUuIGEuIHJlbmRlcigpIGF1ZiBkaWVzZXIgVFlQLVZpZXcgc2VsYnN0XHJcbiAgICAvLyBhdXMsIHdhcyBkaWVzZXMgPGlucHV0IHR5cGU9Y29sb3I+IGF1cyBkZW0gRE9NIGVudGZlcm5lbiB1bmQgZGVuIG5hdGl2ZW5cclxuICAgIC8vIFBpY2tlciBkYW1pdCBzb2ZvcnQgc2NobGllXHUwMERGZW4gd1x1MDBGQ3JkZSAtIG5vY2ggYmV2b3IgbWFuIFx1MDBGQ2JlcmhhdXB0IGVpbmUgRmFyYmVcclxuICAgIC8vIGF1c3dcdTAwRTRobGVuIGthbm4gKHNjaG9uIGJlaW0gZXJzdGVuIEtsaWNrLCB2b3IgZGVtIExvc2xhc3NlbiBkZXIgVGFzdGUpLlxyXG4gICAgY29sb3JJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiaW5wdXRcIiwgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBzaG93U3RhdGUoY29sb3JJbnB1dC52YWx1ZSwgZmFsc2UpO1xyXG4gICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdID0gY29sb3JJbnB1dC52YWx1ZTtcclxuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgIG9uQ2hhbmdlPy4oY29sb3JJbnB1dC52YWx1ZSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBFcnN0IHdlbm4gZGllIEF1c3dhaGwgYmVzdFx1MDBFNHRpZ3QgdW5kIGRlciBuYXRpdmUgUGlja2VyIGRhZHVyY2ggZ2VzY2hsb3NzZW5cclxuICAgIC8vIHdpcmQsIGRpZSBcdTAwRkNicmlnZW4gVmlld3MgbmFjaHppZWhlbiAtIGFuIGRlbSBQdW5rdCBrYW5uIGVpbiBOZXUtUmVuZGVyblxyXG4gICAgLy8gZGllc2VyIFRZUC1WaWV3IHNlbGJzdCBuaWNodHMgbWVociBrYXB1dHQgbWFjaGVuLlxyXG4gICAgY29sb3JJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsICgpID0+IHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpKTtcclxuXHJcbiAgICBpZiAoc2hvd1Jlc2V0KSB7XHJcbiAgICAgIHJlc2V0QnRuID0gcGFyZW50LmNyZWF0ZURpdih7XHJcbiAgICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWNvbG9yLXJlc2V0XCIsXHJcbiAgICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJGYXJiZSB6dXJcdTAwRkNja3NldHplblwiIH0sXHJcbiAgICAgIH0pO1xyXG4gICAgICBzZXRJY29uKHJlc2V0QnRuLCBcInJvdGF0ZS1jY3dcIik7XHJcbiAgICAgIHJlc2V0QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV07XHJcbiAgICAgICAgY29sb3JJbnB1dC52YWx1ZSA9IERFRkFVTFRfVFlQRV9DT0xPUjtcclxuICAgICAgICBzaG93U3RhdGUoREVGQVVMVF9UWVBFX0NPTE9SLCB0cnVlKTtcclxuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgICAgICBvbkNoYW5nZT8uKERFRkFVTFRfVFlQRV9DT0xPUik7XHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgc2hvd1N0YXRlKGN1cnJlbnRDb2xvciwgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXSA9PT0gdW5kZWZpbmVkKTtcclxuXHJcbiAgICByZXR1cm4gY29sb3JXcmFwO1xyXG4gIH1cclxuXHJcbiAgLy8gRlx1MDBFNG5ndCBCZXN0YW5kc2luc3RhbGxhdGlvbmVuIGFiLCBkZXJlbiBzZXR0aW5ncy1PYmpla3Qgc2Nob24gdm9yIEVpbmZcdTAwRkNocnVuZ1xyXG4gIC8vIHZvbiB0eXBlTWFudWFsIGdlbGFkZW4gd3VyZGUgKHouIEIuIGxhdWZlbmRlIFNlc3Npb24gdm9yIGVpbmVtIHZvbGxzdFx1MDBFNG5kaWdlblxyXG4gIC8vIFBsdWdpbi1SZWxvYWQgbmFjaCBIb3QtUmVsb2FkKSAtIG9obmUgZGFzIHdcdTAwRkNyZGUgamVkZXIgWnVncmlmZiB1bnRlbiBtaXRcclxuICAvLyBcIkNhbm5vdCByZWFkIHByb3BlcnRpZXMgb2YgdW5kZWZpbmVkXCIgYWJicmVjaGVuIHVuZCBkYWJlaSBkZW4gZ2VzYW10ZW5cclxuICAvLyByZXN0bGljaGVuIHJlbmRlclR5cGVTZXR0aW5ncygpLUF1ZnJ1ZiAoRmFyYmUsIEJlc2NocmVpYnVuZywgRnJvbnRtYXR0ZXIpXHJcbiAgLy8gbWl0IHNpY2ggcmVpXHUwMERGZW4sIGRhIGRlciBGZWhsZXIgc3luY2hyb24gbWl0dGVuIGluIGRlciBGdW5rdGlvbiBhdWZ0cml0dC5cclxuICBlbnN1cmVUeXBlTWFudWFsKCkge1xyXG4gICAgaWYgKCF0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlTWFudWFsKSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlTWFudWFsID0ge307XHJcbiAgICByZXR1cm4gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZU1hbnVhbDtcclxuICB9XHJcblxyXG4gIC8vIEVpbiBJY29uLUtub3BmIHN0YXR0IGVpbmVzIGJlc2NocmlmdGV0ZW4gU2NoYWx0ZXJzOiBkaWUgRWluc3RlbGx1bmcgaXN0IHp1XHJcbiAgLy8ga2xlaW4sIHVtIG1pdCBMYWJlbCB1bmQgVG9nZ2xlIHNvIHZpZWwgUGxhdHogdW5kIEF1Zm1lcmtzYW1rZWl0IHp1XHJcbiAgLy8gYmVrb21tZW4gd2llIGRhcyBCZXNjaHJlaWJ1bmdzZmVsZCBkYXJ1bnRlci4gWnVzdGFuZCB3aWUgYmVpIGRlbiBcdTAwRkNicmlnZW5cclxuICAvLyBJY29uLUtuXHUwMEY2cGZlbiBkZXIgQW5zaWNodCBcdTAwRkNiZXIgZWluZSBLbGFzc2UgKGlzLWFjdGl2ZSwgc2llaGUgc3R5bGVzLmNzcyksXHJcbiAgLy8gZGVyIFNpbm4gc3RlaHQgaW0gVG9vbHRpcCAtIHJvbGUvYXJpYS1jaGVja2VkIGhhbHRlbiBpaG4gdHJvdHpkZW0gYWxzXHJcbiAgLy8gU2NoYWx0ZXIgbGVzYmFyLlxyXG4gIC8vXHJcbiAgLy8gU3RhbmRhcmRtXHUwMEU0XHUwMERGaWcgYW4gLSBkYWhlciB3aXJkICh3aWUgYmVpIGRlbiBhbmRlcmVuIHR5cGVYeHgtRGljdHMpIG51ciBkaWVcclxuICAvLyBBYndlaWNodW5nIHZvbSBEZWZhdWx0IGdlc3BlaWNoZXJ0LCBoaWVyIGFsc28gbnVyIFwiYXVzXCIgKGZhbHNlKTsgZmVobGVuZGVyXHJcbiAgLy8gRWludHJhZyBiencuIHRydWUgYmVkZXV0ZW4gXCJhblwiLiBTdGV1ZXJ0LCBvYiBlaW4gVFlQIGluIGdldFR5cGVzKCkgKHNpZWhlXHJcbiAgLy8gbWFpbi5qcykgZXhwb3J0aWVydCB3aXJkLCBzaWVoZSBkb3J0aWdlciBLb21tZW50YXIuXHJcbiAgcmVuZGVyTWFudWFsVG9nZ2xlKHBhcmVudCwgdHlwZSkge1xyXG4gICAgY29uc3QgYnRuID0gcGFyZW50LmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1tYW51YWwtaWNvblwiLFxyXG4gICAgICBhdHRyOiB7IHRhYmluZGV4OiBcIjBcIiwgcm9sZTogXCJjaGVja2JveFwiIH0sXHJcbiAgICB9KTtcclxuICAgIHNldEljb24oYnRuLCBcImZpbGUtcGVuLWxpbmVcIik7XHJcblxyXG4gICAgY29uc3Qgc2hvd1N0YXRlID0gKG9uKSA9PiB7XHJcbiAgICAgIGJ0bi50b2dnbGVDbGFzcyhcImlzLWFjdGl2ZVwiLCBvbik7XHJcbiAgICAgIGJ0bi5zZXRBdHRyaWJ1dGUoXCJhcmlhLWNoZWNrZWRcIiwgU3RyaW5nKG9uKSk7XHJcbiAgICAgIGJ0bi5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIG9uID8gXCJNYW51ZWxsIGVyc3RlbGxiYXJcIiA6IFwiTmljaHQgbWFudWVsbCBlcnN0ZWxsYmFyXCIpO1xyXG4gICAgfTtcclxuICAgIHNob3dTdGF0ZSh0aGlzLmVuc3VyZVR5cGVNYW51YWwoKVt0eXBlXSAhPT0gZmFsc2UpO1xyXG5cclxuICAgIGNvbnN0IHRvZ2dsZSA9IGFzeW5jICgpID0+IHtcclxuICAgICAgY29uc3QgbmV4dCA9ICFidG4uaGFzQ2xhc3MoXCJpcy1hY3RpdmVcIik7XHJcbiAgICAgIHNob3dTdGF0ZShuZXh0KTtcclxuICAgICAgaWYgKG5leHQpIGRlbGV0ZSB0aGlzLmVuc3VyZVR5cGVNYW51YWwoKVt0eXBlXTtcclxuICAgICAgZWxzZSB0aGlzLmVuc3VyZVR5cGVNYW51YWwoKVt0eXBlXSA9IGZhbHNlO1xyXG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgIH07XHJcblxyXG4gICAgYnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCB0b2dnbGUpO1xyXG4gICAgYnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIChldmVudCkgPT4ge1xyXG4gICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVudGVyXCIgfHwgZXZlbnQua2V5ID09PSBcIiBcIikge1xyXG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgdG9nZ2xlKCk7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIHJldHVybiBidG47XHJcbiAgfVxyXG5cclxuICByZW5kZXJSZWdpc3RlcmVkSXRlbSh0eXBlLCBjb3VudCwgeyBkcmFnZ2FibGUgPSBmYWxzZSwgaW5kZXggPSAtMSB9ID0ge30pIHtcclxuICAgIGNvbnN0IHRyZWVJdGVtID0gdGhpcy5saXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbVwiIH0pO1xyXG4gICAgY29uc3Qgc2VsZiA9IHRyZWVJdGVtLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0tc2VsZiBpcy1jbGlja2FibGVcIiB9KTtcclxuXHJcbiAgICBsZXQgbmFtZUVsO1xyXG4gICAgdGhpcy5yZW5kZXJDb2xvclBpY2tlcihzZWxmLCB0eXBlLCAobmV3Q29sb3IpID0+IHtcclxuICAgICAgaWYgKG5hbWVFbCAmJiB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3QpIG5hbWVFbC5zdHlsZS5jb2xvciA9IG5ld0NvbG9yO1xyXG4gICAgfSk7XHJcblxyXG4gICAgbmFtZUVsID0gc2VsZi5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLWlubmVyXCIsIHRleHQ6IHR5cGUgfSk7XHJcbiAgICBjb25zdCBjb2xvciA9IHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdCA/IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV0gOiBudWxsO1xyXG4gICAgaWYgKGNvbG9yKSBuYW1lRWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcclxuXHJcbiAgICAvLyBad2VpdGUgU3BhbHRlLCB1bWdlc2NoYWx0ZXQgdWViZXIgZGVuIEtub3BmIGltIExpc3Rlbi1IZWFkZXIgKHNpZWhlXHJcbiAgICAvLyBTRUNPTkRBUllfTU9ERVMgdW5kIGN5Y2xlU2Vjb25kYXJ5KS5cclxuICAgIGNvbnN0IHNlY29uZGFyeSA9IHRoaXMuc2Vjb25kYXJ5TW9kZSgpO1xyXG4gICAgaWYgKHNlY29uZGFyeSA9PT0gXCJkZXNjcmlwdGlvblwiKSB0aGlzLnJlbmRlckRlc2NyaXB0aW9uSW5wdXQoc2VsZiwgdHlwZSk7XHJcbiAgICBlbHNlIGlmIChzZWNvbmRhcnkgPT09IFwic3VidHlwZXNcIikgdGhpcy5yZW5kZXJTdWJ0eXBlUHJldmlldyhzZWxmLCB0eXBlKTtcclxuXHJcbiAgICB0aGlzLnJlbmRlckNvdW50RmxhaXIoc2VsZiwgY291bnQpO1xyXG5cclxuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgaWYgKHRoaXMuaXNFZGl0aW5nKSByZXR1cm47XHJcbiAgICAgIHRoaXMub3BlblR5cGVTZXR0aW5ncyh0eXBlKTtcclxuICAgIH0pO1xyXG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY29udGV4dG1lbnVcIiwgKGV2ZW50KSA9PiB7XHJcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgICB0aGlzLm9wZW5TZWFyY2godHlwZSk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBOdXIgaW0gTWFudWVsbC1Tb3J0aWVybW9kdXMgYWt0aXYgKHNpZWhlIHJlbmRlcigpKSAtIGRpZSBnYW56ZSBaZWlsZSBpc3RcclxuICAgIC8vIGRhbm4gcGVyIERyYWcgJiBEcm9wIHZlcnNjaGllYmJhciAoZWluIERyYWcsIGRlciBhdWYgZGVtIEZhcmJwdW5rdCBvZGVyXHJcbiAgICAvLyBpbSBCZXNjaHJlaWJ1bmdzZmVsZCBiZWdpbm50LCBncmVpZnQgdHJvdHpkZW0gbmljaHQgLSBkaWVzZSBFbGVtZW50ZVxyXG4gICAgLy8gbmVobWVuIGRlbiBNb3VzZWRvd24gc2VsYnN0IGZcdTAwRkNyIEZhcmItL1RleHRhdXN3YWhsKS4gVmVyc2Nob2JlbiB3aXJkXHJcbiAgICAvLyBkaXJla3QgaW4gcGx1Z2luLnNldHRpbmdzLnR5cGVzIC0gZGllc2VsYmUgTGlzdGUsIGRpZSBpbSBNYW51ZWxsLU1vZHVzXHJcbiAgICAvLyB1bnNvcnRpZXJ0IGFscyBBbnplaWdlcmVpaGVuZm9sZ2UgZGllbnQgKHNpZWhlIHJlbmRlcigpKS5cclxuICAgIGlmIChkcmFnZ2FibGUpIHtcclxuICAgICAgc2VsZi5kcmFnZ2FibGUgPSB0cnVlO1xyXG4gICAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnc3RhcnRcIiwgKGV2ZW50KSA9PiB7XHJcbiAgICAgICAgZXZlbnQuZGF0YVRyYW5zZmVyLmVmZmVjdEFsbG93ZWQgPSBcIm1vdmVcIjtcclxuICAgICAgICBldmVudC5kYXRhVHJhbnNmZXIuc2V0RGF0YShcInRleHQvcGxhaW5cIiwgU3RyaW5nKGluZGV4KSk7XHJcbiAgICAgICAgc2VsZi5jbGFzc0xpc3QuYWRkKFwiaXMtZHJhZ2dpbmdcIik7XHJcbiAgICAgIH0pO1xyXG4gICAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnZW5kXCIsICgpID0+IHNlbGYuY2xhc3NMaXN0LnJlbW92ZShcImlzLWRyYWdnaW5nXCIpKTtcclxuICAgICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ292ZXJcIiwgKGV2ZW50KSA9PiB7XHJcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgICBjb25zdCByZWN0ID0gc2VsZi5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcclxuICAgICAgICBjb25zdCBpc0FmdGVyID0gZXZlbnQuY2xpZW50WSAtIHJlY3QudG9wID4gcmVjdC5oZWlnaHQgLyAyO1xyXG4gICAgICAgIHNlbGYuY2xhc3NMaXN0LnRvZ2dsZShcImlzLWRyb3AtYmVmb3JlXCIsICFpc0FmdGVyKTtcclxuICAgICAgICBzZWxmLmNsYXNzTGlzdC50b2dnbGUoXCJpcy1kcm9wLWFmdGVyXCIsIGlzQWZ0ZXIpO1xyXG4gICAgICB9KTtcclxuICAgICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ2xlYXZlXCIsICgpID0+IHNlbGYuY2xhc3NMaXN0LnJlbW92ZShcImlzLWRyb3AtYmVmb3JlXCIsIFwiaXMtZHJvcC1hZnRlclwiKSk7XHJcbiAgICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImRyb3BcIiwgYXN5bmMgKGV2ZW50KSA9PiB7XHJcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgICBjb25zdCBpc0FmdGVyID0gc2VsZi5jbGFzc0xpc3QuY29udGFpbnMoXCJpcy1kcm9wLWFmdGVyXCIpO1xyXG4gICAgICAgIHNlbGYuY2xhc3NMaXN0LnJlbW92ZShcImlzLWRyb3AtYmVmb3JlXCIsIFwiaXMtZHJvcC1hZnRlclwiKTtcclxuXHJcbiAgICAgICAgY29uc3QgZnJvbUluZGV4ID0gTnVtYmVyKGV2ZW50LmRhdGFUcmFuc2Zlci5nZXREYXRhKFwidGV4dC9wbGFpblwiKSk7XHJcbiAgICAgICAgaWYgKE51bWJlci5pc05hTihmcm9tSW5kZXgpIHx8IGZyb21JbmRleCA9PT0gaW5kZXgpIHJldHVybjtcclxuXHJcbiAgICAgICAgbGV0IGluc2VydEJlZm9yZSA9IGlzQWZ0ZXIgPyBpbmRleCArIDEgOiBpbmRleDtcclxuICAgICAgICBpZiAoZnJvbUluZGV4IDwgaW5zZXJ0QmVmb3JlKSBpbnNlcnRCZWZvcmUgLT0gMTtcclxuXHJcbiAgICAgICAgY29uc3QgdHlwZXMgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlcztcclxuICAgICAgICBjb25zdCBbbW92ZWRdID0gdHlwZXMuc3BsaWNlKGZyb21JbmRleCwgMSk7XHJcbiAgICAgICAgdHlwZXMuc3BsaWNlKGluc2VydEJlZm9yZSwgMCwgbW92ZWQpO1xyXG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgIHRoaXMucmVuZGVyKCk7XHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLy8gRWNodGVzIFRleHQtSW5wdXQgc3RhdHQgbnVyIEFuemVpZ2U6IGRpZSBCZXNjaHJlaWJ1bmcgaXN0IGRpcmVrdCBpbiBkZXJcclxuICAvLyBMaXN0ZSBiZWFyYmVpdGJhciwgb2huZSBkYWZcdTAwRkNyIGVyc3QgZGllIERldGFpbGFuc2ljaHQgXHUwMEY2ZmZuZW4genUgbVx1MDBGQ3NzZW4uXHJcbiAgLy8gY2xpY2sgaGllciBtdXNzIGRpZSBaZWlsZSBzZWxic3QgZ2V6aWVsdCBOSUNIVCBhdXNsXHUwMEY2c2VuXHJcbiAgLy8gKHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIC4uLikgaW4gcmVuZGVyUmVnaXN0ZXJlZEl0ZW0gXHUwMEY2ZmZuZXQgc29uc3RcclxuICAvLyBkaWUgRGV0YWlsYW5zaWNodCksIGRhaGVyIHN0b3BQcm9wYWdhdGlvbi5cclxuICByZW5kZXJEZXNjcmlwdGlvbklucHV0KHNlbGYsIHR5cGUpIHtcclxuICAgIGNvbnN0IGRlc2NJbnB1dCA9IHNlbGYuY3JlYXRlRWwoXCJpbnB1dFwiLCB7XHJcbiAgICAgIHR5cGU6IFwidGV4dFwiLFxyXG4gICAgICBjbHM6IFwiZnJlZC10eXAtbGlzdC1kZXNjcmlwdGlvbi1pbnB1dFwiLFxyXG4gICAgfSk7XHJcbiAgICBkZXNjSW5wdXQudmFsdWUgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3R5cGVdID8/IFwiXCI7XHJcbiAgICBkZXNjSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChldmVudCkgPT4gZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCkpO1xyXG4gICAgZGVzY0lucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCB2YWx1ZSA9IGRlc2NJbnB1dC52YWx1ZS50cmltKCk7XHJcbiAgICAgIGlmICh2YWx1ZSkgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXSA9IHZhbHVlO1xyXG4gICAgICBlbHNlIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3R5cGVdO1xyXG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgLy8gXCIoU3VidHlwIDEsIFN1YnR5cCAyKVwiIHN0YXR0IGRlciBCZXNjaHJlaWJ1bmcgLSBkaWVzZWxiZSBEYXJzdGVsbHVuZyB3aWVcclxuICAvLyBkaWUgU3VidHlwLVZvcnNjaGF1IGltIHNlcGFyYXRlbiBUWVAtUGlja2VyIChyZW5kZXJTdWJ0eXBlUHJldmlldyBpblxyXG4gIC8vIHR5cGUtcGlja2VyLmpzLCBnZW1laW5zYW1lIEZhcmJncnVuZGxhZ2UgbmFtZUNvbG9yIGluIHR5cGUtY29sb3JzLmpzKTpcclxuICAvLyBLbGFtbWVybiB1bmQgS29tbWFzIG11dGVkLCBqZWRlciBOYW1lIGluIHNlaW5lciBlaWdlbmVuIFN1YnR5cC1GYXJiZTsgb2huZVxyXG4gIC8vIFwiVFlQIFZpZXcgZWluZlx1MDBFNHJiZW5cIiBibGVpYnQgZGllIFZvcnNjaGF1IHdpZSBkZXIgVFlQLU5hbWUgc2VsYnN0IHVuZ2VmXHUwMEU0cmJ0LFxyXG4gIC8vIHVuZCBvaG5lIGRlc3NlbiBVbnRlci1TY2hhbHRlciBcIlN1YnR5cFwiIHN0ZWhlbiBhbGxlIGluIGRlciBUWVAtRmFyYmUuXHJcbiAgLy8gQmV3dXNzdCBudXIgZGllIGVyZmFzc3RlbiBTdWJ0eXBlbiB1bmQgb2huZSBOb3Rpei1BbnphaGw6IG5pY2h0IGVyZmFzc3RlXHJcbiAgLy8gV2VydGUgaGFiZW4gd2VkZXIgRmFyYmUgbm9jaCBEZWZpbml0aW9uLCB1bmQgWmFobGVuIGplIE5hbWUgd1x1MDBGQ3JkZW4gZGllXHJcbiAgLy8gWmVpbGUgc28gdmVybFx1MDBFNG5nZXJuLCBkYXNzIGJlaSBtZWhyZXJlbiBTdWJ0eXBlbiBuaWNodHMgbWVociBkYXZvbiB6dSBsZXNlblxyXG4gIC8vIHdcdTAwRTRyZS4gUmVpbmUgQW56ZWlnZSAtIEtsaWNrIHVuZCBSZWNodHNrbGljayBnZWhcdTAwRjZyZW4gd2VpdGVyIGRlciBnYW56ZW5cclxuICAvLyBaZWlsZSAoRGV0YWlsYW5zaWNodCBiencuIFN1Y2hlKS4gT2IgZGllIExpc3RlIGxpbmtzIGhpbnRlciBkZW0gTmFtZW5cclxuICAvLyBiZWdpbm50IG9kZXIgcmVjaHRzYlx1MDBGQ25kaWcgdm9yIGRlciBBbnphaGwgZW5kZXQsIGlzdCBoaWVyIGJld3Vzc3QgbmljaHRcclxuICAvLyBhYmdlZnJhZ3Q6IGRhcyBzY2hhbHRldCBTdHlsZSBTZXR0aW5ncyBcdTAwRkNiZXIgZWluZSBib2R5LUtsYXNzZSAoc2llaGUgZGVuXHJcbiAgLy8gQHNldHRpbmdzLUJsb2NrIHVuZCAuZnJlZC10eXAtbGlzdC1zdWJ0eXBlcyBpbiBzdHlsZXMuY3NzKSwgZGFzIE1hcmt1cFxyXG4gIC8vIGJsZWlidCBpbiBiZWlkZW4gRlx1MDBFNGxsZW4gZGFzc2VsYmUuXHJcbiAgcmVuZGVyU3VidHlwZVByZXZpZXcoc2VsZiwgdHlwZSkge1xyXG4gICAgY29uc3Qgc3VidHlwZXMgPSBnZXRTdWJ0eXBlTmFtZXModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUpO1xyXG4gICAgaWYgKHN1YnR5cGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xyXG5cclxuICAgIGNvbnN0IGNvbG9yaXplID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0O1xyXG4gICAgY29uc3Qgd3JhcCA9IHNlbGYuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1saXN0LXN1YnR5cGVzXCIgfSk7XHJcbiAgICB3cmFwLmFwcGVuZFRleHQoXCIoXCIpO1xyXG4gICAgc3VidHlwZXMuZm9yRWFjaCgoc3VidHlwZSwgaW5kZXgpID0+IHtcclxuICAgICAgaWYgKGluZGV4ID4gMCkgd3JhcC5hcHBlbmRUZXh0KFwiLCBcIik7XHJcbiAgICAgIGNvbnN0IHNwYW4gPSB3cmFwLmNyZWF0ZVNwYW4oeyB0ZXh0OiBzdWJ0eXBlIH0pO1xyXG4gICAgICBpZiAoY29sb3JpemUpIHNwYW4uc3R5bGUuY29sb3IgPSBuYW1lQ29sb3IodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpLmNvbG9yO1xyXG4gICAgfSk7XHJcbiAgICB3cmFwLmFwcGVuZFRleHQoXCIpXCIpO1xyXG4gIH1cclxuXHJcbiAgcmVuZGVyVW5yZWdpc3RlcmVkSXRlbSh0eXBlLCBjb3VudCkge1xyXG4gICAgY29uc3QgdHJlZUl0ZW0gPSB0aGlzLmxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtXCIgfSk7XHJcbiAgICBjb25zdCBzZWxmID0gdHJlZUl0ZW0uY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1zZWxmIGlzLWNsaWNrYWJsZSBmcmVkLXR5cC11bnJlZ2lzdGVyZWRcIiB9KTtcclxuICAgIHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1pbm5lclwiLCB0ZXh0OiBkaXNwbGF5VHlwZUtleSh0eXBlKSB9KTtcclxuICAgIHRoaXMucmVuZGVyQ291bnRGbGFpcihzZWxmLCBjb3VudCk7XHJcblxyXG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5yZWdpc3RlclR5cGUodHlwZSkpO1xyXG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY29udGV4dG1lbnVcIiwgKGV2ZW50KSA9PiB7XHJcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgICB0aGlzLm9wZW5TZWFyY2godHlwZSk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIC8vIEFsbGUgU1VCVFlQLVdlcnRlLCBkaWUgaW4gTm90aXplbiB2b3Jrb21tZW4sIGFiZXIgdW50ZXIgaWhyZW0gVFlQIG5pY2h0XHJcbiAgLy8gZXJmYXNzdCBzaW5kIC0gXHUwMEZDYmVyIGRlbiBnYW56ZW4gVmF1bHQsIG5pY2h0IG51ciBmXHUwMEZDciBlaW5lbiBUWVAgd2llXHJcbiAgLy8gcmVuZGVyVW5yZWdpc3RlcmVkU3VidHlwZXMoKSBpbiBkZXIgRGV0YWlsYW5zaWNodC4gRGVyIEluZGV4IGZcdTAwRkNocnQgc2VpbmVcclxuICAvLyBCdWNrZXRzIFx1MDBGQ2JlciBBTExFIFRZUC1TY2hsXHUwMEZDc3NlbCwgYWxzbyBhdWNoIFx1MDBGQ2JlciBuaWNodCBlcmZhc3N0ZTsgZGVyZW5cclxuICAvLyBTdWJ0eXBlbiBrb21tZW4gZGFoZXIgbWl0IChLbGljayBlcmZhc3N0IGRhbm4gYmVpZGVzLCBzaWVoZVxyXG4gIC8vIHJlZ2lzdGVyVHlwZVdpdGhTdWJ0eXBlKS5cclxuICAvL1xyXG4gIC8vIFNvcnRpZXJ0IG5hY2ggQW56YWhsLCBkYW5uIG5hY2ggZGVtIFplaWxlbnRleHQgdm9uIGxpbmtzIG5hY2ggcmVjaHRzIChlcnN0XHJcbiAgLy8gVFlQLCBkYW5uIFN1YnR5cCkgLSBkaWVzZWxiZSBSZWdlbCB3aWUgaW4gZGVyIERldGFpbGFuc2ljaHQsIHdvIGRhc1xyXG4gIC8vIEhcdTAwRTR1Zmlnc3RlIG9iZW4gc3RlaHQuIEJld3Vzc3QgTklDSFQgbmFjaCBkZW0gU29ydGllci1CdXR0b24gZGVyIExpc3RlOlxyXG4gIC8vIFwiRmFyYmVcIiB1bmQgXCJNYW51ZWxsXCIgaGFiZW4gZlx1MDBGQ3IgbmljaHQgZXJmYXNzdGUgV2VydGUga2VpbmUgQmVkZXV0dW5nLlxyXG4gIC8vXHJcbiAgLy8gRWluZSBOb3RpeiBvaG5lIFRZUCBibGVpYnQgYXVcdTAwREZlbiB2b3IgLSBkZXIgSW5kZXggdmVyd2lyZnQgaWhyZW4gU1VCVFlQXHJcbiAgLy8gc2Nob24gYmVpbSBaXHUwMEU0aGxlbiAoc2llaGUgYWdncmVnYXRlKCkgaW4gdHlwLWluZGV4LmpzKSwgZWluIFNVQlRZUCBvaG5lIFRZUFxyXG4gIC8vIGhhdCBrZWluZW4gS29udGV4dC5cclxuICB1bnJlZ2lzdGVyZWRTdWJ0eXBlUm93cygpIHtcclxuICAgIGNvbnN0IHJlZ2lzdGVyZWQgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlcztcclxuICAgIGNvbnN0IHJvd3MgPSBbXTtcclxuICAgIGZvciAoY29uc3QgW3R5cGUsIGJ1Y2tldF0gb2YgdGhpcy5wbHVnaW4udHlwSW5kZXguc3VidHlwZUNvdW50cygpKSB7XHJcbiAgICAgIGNvbnN0IGtub3duID0gZ2V0U3VidHlwZU5hbWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlKTtcclxuICAgICAgZm9yIChjb25zdCBbc3VidHlwZSwgY291bnRdIG9mIGJ1Y2tldC5jb3VudHMpIHtcclxuICAgICAgICBpZiAoa25vd24uaW5jbHVkZXMoc3VidHlwZSkpIGNvbnRpbnVlO1xyXG4gICAgICAgIHJvd3MucHVzaCh7IHR5cGUsIHN1YnR5cGUsIGNvdW50LCB0eXBlUmVnaXN0ZXJlZDogcmVnaXN0ZXJlZC5pbmNsdWRlcyh0eXBlKSB9KTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJvd3Muc29ydCgoYSwgYikgPT4gYi5jb3VudCAtIGEuY291bnQgfHwgYS50eXBlLmxvY2FsZUNvbXBhcmUoYi50eXBlKSB8fCBhLnN1YnR5cGUubG9jYWxlQ29tcGFyZShiLnN1YnR5cGUpKTtcclxuICB9XHJcblxyXG4gIC8vIFwiTk9USVogLyBLdXJ6IEdlc2NoaWNodGVcIiAtIGRlciBTdWJ0eXAgYWxsZWluIHdcdTAwRTRyZSBtZWhyZGV1dGlnLCBkZW5zZWxiZW5cclxuICAvLyBOYW1lbiBrYW5uIGVzIHVudGVyIG1laHJlcmVuIFRZUGVuIGdlYmVuLiBJc3QgZGVyIFRZUCBiZXJlaXRzIGVyZmFzc3QsXHJcbiAgLy8gdHJcdTAwRTRndCBzZWluIFRlaWwgZGVyIFplaWxlIHNlaW5lIEZhcmJlIChiencuIGVpbmVuIEZhcmJwdW5rdCBkYXZvciwgamUgbmFjaFxyXG4gIC8vIEVpbnN0ZWxsdW5nIFwiVFlQIFZpZXcgZWluZlx1MDBFNHJiZW5cIikgLSBhYmdlc2Nod1x1MDBFNGNodCBcdTAwRkNiZXIgZGFzIFN0eWxlIFNldHRpbmdcclxuICAvLyBcIkZhcmJlIGVyZmFzc3RlciBUWVBlbiBpbiBkaWVzZXIgTGlzdGVcIiwgZGFtaXQgZGllIFplaWxlbiB0cm90eiBGYXJiZVxyXG4gIC8vIGhpbnRlciBkZW4gZXJmYXNzdGVuIFRZUGVuIG9iZW4genVyXHUwMEZDY2tibGVpYmVuLiBJc3QgYXVjaCBkZXIgVFlQIG5pY2h0XHJcbiAgLy8gZXJmYXNzdCwgYmxlaWJ0IGRpZSBnYW56ZSBaZWlsZSBtdXRlZCB3aWUgZGllIEVpbnRyXHUwMEU0Z2UgZGFyXHUwMEZDYmVyLlxyXG4gIHJlbmRlclVucmVnaXN0ZXJlZFN1YnR5cGVJdGVtKHsgdHlwZSwgc3VidHlwZSwgY291bnQsIHR5cGVSZWdpc3RlcmVkIH0pIHtcclxuICAgIGNvbnN0IHRyZWVJdGVtID0gdGhpcy5saXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbVwiIH0pO1xyXG4gICAgY29uc3Qgc2VsZiA9IHRyZWVJdGVtLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0tc2VsZiBpcy1jbGlja2FibGUgZnJlZC10eXAtdW5yZWdpc3RlcmVkXCIgfSk7XHJcblxyXG4gICAgY29uc3QgY29sb3JpemUgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3Q7XHJcbiAgICBjb25zdCB7IGNvbG9yLCBpc0RlZmF1bHQgfSA9IG5hbWVDb2xvcih0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSk7XHJcbiAgICBpZiAodHlwZVJlZ2lzdGVyZWQgJiYgIWNvbG9yaXplKSB7XHJcbiAgICAgIGNvbnN0IHdyYXAgPSBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1jb2xvci13cmFwIGZyZWQtdHlwLXVucmVnaXN0ZXJlZC1zdWJ0eXBlLWNvbG9yXCIgfSk7XHJcbiAgICAgIHBhaW50Q29sb3JEb3Qod3JhcC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtY29sb3ItZG90XCIgfSksIGNvbG9yLCBpc0RlZmF1bHQpO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGlubmVyID0gc2VsZi5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLWlubmVyXCIgfSk7XHJcbiAgICBjb25zdCB0eXBlRWwgPSBpbm5lci5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLXVucmVnaXN0ZXJlZC1zdWJ0eXBlLXR5cGVcIiwgdGV4dDogZGlzcGxheVR5cGVLZXkodHlwZSkgfSk7XHJcbiAgICBpZiAodHlwZVJlZ2lzdGVyZWQgJiYgY29sb3JpemUgJiYgIWlzRGVmYXVsdCkge1xyXG4gICAgICB0eXBlRWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcclxuICAgICAgdHlwZUVsLmFkZENsYXNzKFwiZnJlZC10eXAtdW5yZWdpc3RlcmVkLXN1YnR5cGUtY29sb3JcIik7XHJcbiAgICB9XHJcbiAgICBpbm5lci5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLXVucmVnaXN0ZXJlZC1zdWJ0eXBlLXNsYXNoXCIsIHRleHQ6IFwiIC8gXCIgfSk7XHJcbiAgICBpbm5lci5jcmVhdGVTcGFuKHsgdGV4dDogZGlzcGxheVR5cGVLZXkoc3VidHlwZSkgfSk7XHJcblxyXG4gICAgdGhpcy5yZW5kZXJDb3VudEZsYWlyKHNlbGYsIGNvdW50KTtcclxuXHJcbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnJlZ2lzdGVyVHlwZVdpdGhTdWJ0eXBlKHR5cGUsIHN1YnR5cGUpKTtcclxuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNvbnRleHRtZW51XCIsIChldmVudCkgPT4ge1xyXG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgdGhpcy5vcGVuU3VidHlwZVNlYXJjaCh0eXBlLCBzdWJ0eXBlKTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgLy8gS2xpY2sgYXVmIGVpbmUgc29sY2hlIFplaWxlOiBlcmZhc3N0IGRlbiBTdWJ0eXAgLSB1bmQsIGZhbGxzIG5cdTAwRjZ0aWcsIHNlaW5lblxyXG4gIC8vIFRZUCBnbGVpY2ggbWl0LiBSZWloZW5mb2xnZSB6d2luZ2VuZCBlcnN0IFRZUCwgZGFubiBTdWJ0eXA6IGRhcyBFcmZhc3NlblxyXG4gIC8vIGVpbmVzIFRZUHMga2FubiBkZXNzZW4gV2VydCBpbiBkZW4gTm90aXplbiBiZXJlaW5pZ2VuIChcIiBidWNoXCIgXHUyMTkyIFwiQlVDSFwiKSxcclxuICAvLyBkYW5hY2ggbXVzcyBkZXIgU3VidHlwLUFiZ2xlaWNoIHNjaG9uIGRlbiBORVVFTiBUWVAtTmFtZW4gdmVyd2VuZGVuLCBzb25zdFxyXG4gIC8vIGZpbmRldCByZW5hbWVTdWJ0eXBlSW5Ob3RlcygpIGtlaW5lIERhdGVpIG1laHIuXHJcbiAgLy9cclxuICAvLyBCZWlkZXMgenVzYW1tZW4gd2lyZCBkaXJla3QgYXVzZ2VmXHUwMEZDaHJ0LCBvaG5lIEJlc3RcdTAwRTR0aWd1bmc6IGVzIGlzdCBlaW5lXHJcbiAgLy8gcmVpbmUgRXJmYXNzdW5nLiBOb3RpemVuIFx1MDBFNG5kZXJuIHNpY2ggbnVyLCB3ZW5uIGRlciBSb2h3ZXJ0IHVuc2F1YmVyIHdhciB1bmRcclxuICAvLyBkYWJlaSBiZXJlaW5pZ3Qgd2lyZCAtIGVpbiBzYXViZXJlciBXZXJ0IGZhc3N0IGtlaW5lIGVpbnppZ2UgRGF0ZWkgYW4uXHJcbiAgYXN5bmMgcmVnaXN0ZXJUeXBlV2l0aFN1YnR5cGUodHlwZUtleSwgc3VidHlwZUtleSkge1xyXG4gICAgY29uc3QgYnVja2V0ID0gdGhpcy5wbHVnaW4udHlwSW5kZXguc3VidHlwZUJ1Y2tldCh0eXBlS2V5KTtcclxuICAgIGNvbnN0IHR5cGVSZXN1bHQgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlcy5pbmNsdWRlcyh0eXBlS2V5KVxyXG4gICAgICA/IHsgdHlwZTogdHlwZUtleSwgcmVuYW1lZDogMCB9XHJcbiAgICAgIDogYXdhaXQgdGhpcy5hcHBseVR5cGVSZWdpc3RyYXRpb24odHlwZUtleSk7XHJcbiAgICBpZiAoIXR5cGVSZXN1bHQpIHJldHVybjtcclxuXHJcbiAgICBjb25zdCBzdWJ0eXBlUmVzdWx0ID0gYXdhaXQgdGhpcy5hcHBseVN1YnR5cGVSZWdpc3RyYXRpb24odHlwZVJlc3VsdC50eXBlLCBzdWJ0eXBlS2V5LCBidWNrZXQpO1xyXG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICB0aGlzLnJlbmRlcigpO1xyXG4gICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcblxyXG4gICAgaWYgKCFzdWJ0eXBlUmVzdWx0KSByZXR1cm47XHJcbiAgICBjb25zdCBwYXJ0cyA9IFtdO1xyXG4gICAgaWYgKHR5cGVSZXN1bHQudHlwZSAhPT0gdHlwZUtleSkgcGFydHMucHVzaChgVFlQICR7dHlwZVJlc3VsdC50eXBlfWApO1xyXG4gICAgcGFydHMucHVzaChgU1VCVFlQICR7c3VidHlwZVJlc3VsdC5zdWJ0eXBlfWApO1xyXG4gICAgY29uc3QgY2hhbmdlZCA9IHR5cGVSZXN1bHQucmVuYW1lZCArIHN1YnR5cGVSZXN1bHQucmVuYW1lZDtcclxuICAgIG5ldyBOb3RpY2UoYCR7cGFydHMuam9pbihcIiB1bmQgXCIpfSByZWdpc3RyaWVydCR7Y2hhbmdlZCA+IDAgPyBgLCAke2NoYW5nZWR9IE5vdGl6KGVuKSBhbmdlcGFzc3RgIDogXCJcIn0uYCk7XHJcbiAgfVxyXG5cclxuICByZW5kZXJUeXBlU2V0dGluZ3ModHlwZSkge1xyXG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XHJcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcclxuXHJcbiAgICBjb25zdCBoZWFkZXIgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC1oZWFkZXJcIiB9KTtcclxuICAgIGNvbnN0IGJhY2tCdG4gPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWJhY2tcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJadXJcdTAwRkNja1wiIH0gfSk7XHJcbiAgICBzZXRJY29uKGJhY2tCdG4sIFwiYXJyb3ctbGVmdFwiKTtcclxuICAgIGJhY2tCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY2xvc2VUeXBlU2V0dGluZ3MoKSk7XHJcblxyXG4gICAgY29uc3QgdGl0bGVFbCA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZGV0YWlsLXRpdGxlXCIsIHRleHQ6IHR5cGUgfSk7XHJcbiAgICBjb25zdCB0aXRsZUNvbG9yID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0ID8gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXSA6IG51bGw7XHJcbiAgICAvLyBEaWUgVFlQLUZhcmJlIGJld3Vzc3QgYWxzIEN1c3RvbSBQcm9wZXJ0eSBzdGF0dCBkaXJla3QgYWxzIGNvbG9yOiBlaW5lXHJcbiAgICAvLyBJbmxpbmUtRmFyYmUgc2NobFx1MDBFNGd0IGplZGUgU3R5bGVzaGVldC1SZWdlbCwgZGllIEFremVudGZhcmJlIGJlaW0gSG92ZXJuXHJcbiAgICAvLyAoc2llaGUgLmZyZWQtdHlwLXNlYXJjaGFibGUpIGtcdTAwRTRtZSBzb25zdCBudXIgbWl0ICFpbXBvcnRhbnQgZGFnZWdlbiBhbi5cclxuICAgIGlmICh0aXRsZUNvbG9yKSB0aXRsZUVsLnN0eWxlLnNldFByb3BlcnR5KFwiLS1mcmVkLXR5cC1uYW1lLWNvbG9yXCIsIHRpdGxlQ29sb3IpO1xyXG4gICAgdGhpcy5tYWtlU2VhcmNoYWJsZSh0aXRsZUVsLCAoKSA9PiB0aGlzLm9wZW5TZWFyY2godHlwZSkpO1xyXG5cclxuICAgIGNvbnN0IHsgY291bnRzIH0gPSB0aGlzLnBsdWdpbi50eXBJbmRleC50eXBlQ291bnRzKCk7XHJcbiAgICBoZWFkZXIuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtY291bnRcIiwgdGV4dDogU3RyaW5nKGNvdW50cy5nZXQodHlwZSkgPz8gMCkgfSk7XHJcblxyXG4gICAgLy8gTGlua3MgbmViZW4gZGVtIG5vcm1hbGVuIFVtYmVuZW5uZW4tQnV0dG9uLCBoZXJ2b3JnZWhvYmVuIChBa3plbnRmYXJiZSxcclxuICAgIC8vIHNpZWhlIHN0eWxlcy5jc3MpIC0gaW0gR2VnZW5zYXR6IHp1IGRpZXNlbSBzY2hyZWlidCBkaWVzZSBWYXJpYW50ZSBiZWltXHJcbiAgICAvLyBVbWJlbmVubmVuIHp1c1x1MDBFNHR6bGljaCBkZW4gVFlQLVdlcnQgYWxsZXIgYmV0cm9mZmVuZW4gTm90aXplbiB1bSAobmFjaFxyXG4gICAgLy8gQmVzdFx1MDBFNHRpZ3VuZywgc2llaGUgc3RhcnREZXRhaWxSZW5hbWUvQ29uZmlybVJlbmFtZVR5cGVNb2RhbCkuXHJcbiAgICBjb25zdCByZW5hbWVXaXRoTm90ZXNCdG4gPSBoZWFkZXIuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWRldGFpbC1yZW5hbWUtbm90ZXNcIixcclxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJVbWJlbmVubmVuIChpbmtsLiBOb3RpemVuIGFucGFzc2VuKVwiIH0sXHJcbiAgICB9KTtcclxuICAgIHNldEljb24ocmVuYW1lV2l0aE5vdGVzQnRuLCBcInBlbmNpbFwiKTtcclxuICAgIHJlbmFtZVdpdGhOb3Rlc0J0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5zdGFydERldGFpbFJlbmFtZSh0eXBlLCB0aXRsZUVsLCB7IHVwZGF0ZU5vdGVzOiB0cnVlIH0pKTtcclxuXHJcbiAgICBjb25zdCByZW5hbWVCdG4gPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWRldGFpbC1yZW5hbWVcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJVbWJlbmVubmVuXCIgfSB9KTtcclxuICAgIHNldEljb24ocmVuYW1lQnRuLCBcInBlbmNpbFwiKTtcclxuICAgIHJlbmFtZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5zdGFydERldGFpbFJlbmFtZSh0eXBlLCB0aXRsZUVsKSk7XHJcblxyXG4gICAgY29uc3QgZGVsZXRlQnRuID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1kZXRhaWwtZGVsZXRlXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiTFx1MDBGNnNjaGVuXCIgfSB9KTtcclxuICAgIHNldEljb24oZGVsZXRlQnRuLCBcInRyYXNoXCIpO1xyXG4gICAgZGVsZXRlQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnNob3dEZWxldGVDb25maXJtKHR5cGUpKTtcclxuXHJcbiAgICBjb25zdCBib2R5ID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtYm9keVwiIH0pO1xyXG5cclxuICAgIC8vIEVpbmUgWmVpbGUgdW50ZXIgZGVyIEtvcGZ6ZWlsZTogbGlua3MgXCJtYW51ZWxsIGVyc3RlbGxiYXJcIiB1bmQgZGllXHJcbiAgICAvLyBUWVAtRmFyYmUsIHJlY2h0cyBkYW5lYmVuIGRpZSBCZXNjaHJlaWJ1bmcgXHUwMEZDYmVyIGRlbiByZXN0bGljaGVuIFBsYXR6LlxyXG4gICAgLy8gVW1iZW5lbm5lbiB1bmQgTFx1MDBGNnNjaGVuIHN0ZWhlbiBvYmVuIGluIGRlciBLb3BmemVpbGUuXHJcbiAgICBjb25zdCBvcHRpb25zSGVhZGVyID0gYm9keS5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItaGVhZGVyIGZyZWQtdHlwLW9wdGlvbnMtaGVhZGVyXCIgfSk7XHJcblxyXG4gICAgdGhpcy5yZW5kZXJNYW51YWxUb2dnbGUob3B0aW9uc0hlYWRlciwgdHlwZSk7XHJcblxyXG4gICAgY29uc3QgY29sb3JSb3cgPSBvcHRpb25zSGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtY29sb3Itcm93XCIgfSk7XHJcbiAgICB0aGlzLnJlbmRlckNvbG9yUGlja2VyKFxyXG4gICAgICBjb2xvclJvdyxcclxuICAgICAgdHlwZSxcclxuICAgICAgKG5ld0NvbG9yKSA9PiB7XHJcbiAgICAgICAgaWYgKCF0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3QpIHJldHVybjtcclxuICAgICAgICAvLyBEaWVzZWxiZSBDdXN0b20gUHJvcGVydHkgd2llIGJlaW0gQXVmYmF1IG9iZW4sIG5pY2h0IHN0eWxlLmNvbG9yOlxyXG4gICAgICAgIC8vIGVpbmUgSW5saW5lLUZhcmJlIHd1ZXJkZSBkaWUgQWt6ZW50ZmFyYmUgYmVpbSBIb3Zlcm4gd2llZGVyIHNjaGxhZ2VuLlxyXG4gICAgICAgIHRpdGxlRWwuc3R5bGUuc2V0UHJvcGVydHkoXCItLWZyZWQtdHlwLW5hbWUtY29sb3JcIiwgbmV3Q29sb3IpO1xyXG4gICAgICB9LFxyXG4gICAgICB7IHNob3dSZXNldDogdHJ1ZSB9XHJcbiAgICApO1xyXG5cclxuICAgIC8vIFJlY2h0cyBuZWJlbiBkZW4gYmVpZGVuIEtuXHUwMEY2cGZlbiwgZGVuIFx1MDBGQ2JyaWdlbiBQbGF0eiBkZXIgWmVpbGUgZlx1MDBGQ2xsZW5kLiBFaW56ZWlsaWdlcyBJbnB1dCBzdGF0dCBkZXMgZnJcdTAwRkNoZXJlbiB6d2VpemVpbGlnZW5cclxuICAgIC8vIFRleHRhcmVhIC0gaW4gZWluZXIgWmVpbGUgbmViZW4gZGVuIEljb25zIGhhdCBlaW4gbWVocnplaWxpZ2VzIEZlbGRcclxuICAgIC8vIGtlaW5lbiBQbGF0eiwgdW5kIGRpZXNlbGJlIEJlc2NocmVpYnVuZyBpc3QgaW4gZGVyIFRZUC1MaXN0ZSBvaG5laGluXHJcbiAgICAvLyBzY2hvbiBhbHMgZWluemVpbGlnZXMgSW5wdXQgYmVhcmJlaXRiYXIgKHNpZWhlIHJlbmRlckRlc2NyaXB0aW9uSW5wdXQpLlxyXG4gICAgLy8gT2huZSBlaWdlbmUgXHUwMERDYmVyc2NocmlmdDogc29sYW5nZSBkYXMgRmVsZCBsZWVyIGlzdCwgc2FndCBzZWluXHJcbiAgICAvLyBQbGF0emhhbHRlciAoZ2VmYWRldCwgc2llaGUgc3R5bGVzLmNzcyksIHdvcnVtIGVzIGdlaHQuXHJcbiAgICBjb25zdCBkZXNjSW5wdXQgPSBvcHRpb25zSGVhZGVyLmNyZWF0ZUVsKFwiaW5wdXRcIiwge1xyXG4gICAgICB0eXBlOiBcInRleHRcIixcclxuICAgICAgY2xzOiBcImZyZWQtdHlwLWRlc2NyaXB0aW9uLWlucHV0XCIsXHJcbiAgICAgIGF0dHI6IHsgcGxhY2Vob2xkZXI6IFwiQmVzY2hyZWlidW5nXCIgfSxcclxuICAgIH0pO1xyXG4gICAgZGVzY0lucHV0LnZhbHVlID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXSA/PyBcIlwiO1xyXG4gICAgZGVzY0lucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCB2YWx1ZSA9IGRlc2NJbnB1dC52YWx1ZS50cmltKCk7XHJcbiAgICAgIGlmICh2YWx1ZSkgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXSA9IHZhbHVlO1xyXG4gICAgICBlbHNlIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3R5cGVdO1xyXG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFRyZW5udCBkaWUgRnJvbnRtYXR0ZXItQmxcdTAwRjZja2Ugdm9uIGRlbiBcdTAwRkNicmlnZW4gRWluc3RlbGx1bmdlbiBkZXMgVFlQc1xyXG4gICAgLy8gKEJlc2NocmVpYnVuZywgRmFyYmUsIFwibWFudWVsbCBlcnN0ZWxsYmFyXCIpLlxyXG4gICAgYm9keS5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZGV0YWlsLXNlcGFyYXRvclwiIH0pO1xyXG5cclxuICAgIC8vIFRZUC1Gcm9udG1hdHRlciB1bmQgamUgcmVnaXN0cmllcnRlbSBTdWJ0eXAgZWluIEJsb2NrIGRhcnVudGVyLCBqZWRlclxyXG4gICAgLy8gbWl0IGVpZ2VuZXIgRWRpdG9yLUluc3RhbnogKHNpZWhlIGZyb250bWF0dGVyLWJsb2Nrcy5qcykgLSBkZXJzZWxiZSBLZXlcclxuICAgIC8vIGRhcmYgZGVzaGFsYiBpbiBtZWhyZXJlbiBCbFx1MDBGNmNrZW4gc3RlaGVuLiBFaW4gU3VidHlwLUJsb2NrIGVyZ1x1MDBFNG56dCBkYXNcclxuICAgIC8vIFRZUC1Gcm9udG1hdHRlciBmXHUwMEZDciBOb3RpemVuIG1pdCBkaWVzZW0gU1VCVFlQIHVuZCBcdTAwRkNiZXJzY2hyZWlidCBkb3J0XHJcbiAgICAvLyBnbGVpY2huYW1pZ2UgUHJvcGVydGllcyAoc2llaGUgc3VidHlwZXMuanMpLlxyXG4gICAgY29uc3QgYnVja2V0ID0gdGhpcy5wbHVnaW4udHlwSW5kZXguc3VidHlwZUJ1Y2tldCh0eXBlKTtcclxuICAgIHRoaXMuZnJvbnRtYXR0ZXJCbG9ja3MgPSBtb3VudEZyb250bWF0dGVyQmxvY2tzKHRoaXMsIGJvZHksIHR5cGUsIHtcclxuICAgICAgcmVuZGVySGVhZGVyOiAoc2VjdGlvbiwgZWwsIGJsb2NrcykgPT4gdGhpcy5yZW5kZXJTZWN0aW9uSGVhZGVyKGVsLCB0eXBlLCBzZWN0aW9uLCBidWNrZXQsIGJsb2NrcyksXHJcbiAgICAgIHJlbmRlckZvb3RlcjogKHNlY3Rpb24sIGVsKSA9PiB7XHJcbiAgICAgICAgaWYgKHNlY3Rpb24gIT09IG51bGwpIHRoaXMucmVuZGVyU2VjdGlvbkZvb3RlcihlbCwgdHlwZSwgc2VjdGlvbik7XHJcbiAgICAgIH0sXHJcbiAgICAgIG9uTW92ZVNlY3Rpb246IGFzeW5jIChvcmRlcikgPT4ge1xyXG4gICAgICAgIHJlb3JkZXJTdWJ0eXBlcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgb3JkZXIpO1xyXG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgIHRoaXMucmVuZGVyKCk7XHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuICAgIHRoaXMuZnJvbnRtYXR0ZXJFZGl0b3JzLnB1c2goLi4udGhpcy5mcm9udG1hdHRlckJsb2Nrcy5lZGl0b3JzKTtcclxuXHJcbiAgICAvLyBCZXd1c3N0IFx1MDBGQ2JlciBkaWUgdm9sbGUgQnJlaXRlIHVuZCBpbiBBa3plbnRmYXJiZSwgZGFtaXQgZXIgc2ljaCB2b24gZGVuXHJcbiAgICAvLyBrbGVpbmVuIEljb24tQnV0dG9ucyBkZXIgQmxcdTAwRjZja2UgYWJoZWJ0LlxyXG4gICAgdGhpcy5zdWJ0eXBlQWRkQnRuRWwgPSBib2R5LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgY2xzOiBcIm1vZC1jdGEgZnJlZC10eXAtc3VidHlwZS1hZGRcIiB9KTtcclxuICAgIHNldEljb24odGhpcy5zdWJ0eXBlQWRkQnRuRWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1zdWJ0eXBlLWFkZC1pY29uXCIgfSksIFwicGx1c1wiKTtcclxuICAgIHRoaXMuc3VidHlwZUFkZEJ0bkVsLmNyZWF0ZVNwYW4oeyB0ZXh0OiBcIlN1YnR5cCBoaW56dWZcdTAwRkNnZW5cIiB9KTtcclxuICAgIHRoaXMuc3VidHlwZUFkZEJ0bkVsLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnN0YXJ0QWRkU3VidHlwZSh0eXBlKSk7XHJcblxyXG4gICAgdGhpcy5yZW5kZXJVbnJlZ2lzdGVyZWRTdWJ0eXBlcyhib2R5LCB0eXBlLCBidWNrZXQpO1xyXG5cclxuICAgIGJvZHkuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC1zZXBhcmF0b3JcIiB9KTtcclxuICAgIHRoaXMucmVuZGVyRmxvYXRpbmdIaW50KGJvZHkpO1xyXG4gICAgLy8gRmV0dC1NYXJraWVydW5nIChzaWVoZSBmcm9udG1hdHRlci1kZWZhdWx0LWhpZ2hsaWdodC5qcykgcmVhZ2llcnQgbnVyIGF1ZlxyXG4gICAgLy8gTWV0YWRhdGVuLS9MYXlvdXQtRXZlbnRzIC0gZGFzIFx1MDBENmZmbmVuIGRpZXNlciBEZXRhaWxhbnNpY2h0IHNlbGJzdCBsXHUwMEY2c3RcclxuICAgIC8vIGtlaW5zIGRhdm9uIGF1cywgZGFoZXIgaGllciBkaXJla3QgbmFjaCBkZW0gTW91bnRlbiBhbnN0b1x1MDBERmVuLiBCZXd1c3N0XHJcbiAgICAvLyBudXIgZGllc2VyIGVpbmUsIGdlemllbHRlIFJlZnJlc2ggc3RhdHQgZGVzIHZvbGxlbiByZWZyZXNoVHlwQ29sb3JzKCktXHJcbiAgICAvLyBCXHUwMEZDbmRlbHM6IGRhcyB3XHUwMEZDcmRlIHUuIGEuIGF1Y2ggcmVuZGVyKCkgYXVmIGRpZXNlbSAoZ2VyYWRlIGVyc3QgbWl0dGVuXHJcbiAgICAvLyBpbSBlaWdlbmVuIHJlbmRlcigpLUR1cmNobGF1ZiBiZWZpbmRsaWNoZW4pIFZpZXcgZXJuZXV0IGF1c2xcdTAwRjZzZW4uXHJcbiAgICB0aGlzLnBsdWdpbi5yZWZyZXNoRnJvbnRtYXR0ZXJIaWdobGlnaHQ/LigpO1xyXG4gIH1cclxuXHJcbiAgLy8gXHUwMERDYmVyc2NocmlmdCBlaW5lcyBCbG9ja3MgKHNpZWhlIGZyb250bWF0dGVyLWJsb2Nrcy5qcyk6IFRpdGVsIG1pdFxyXG4gIC8vIE5vdGl6LUFuemFobCAoYmVpbSBUWVAtRnJvbnRtYXR0ZXIgZGllIE5vdGl6ZW4gb2huZSBTVUJUWVAgLSBmXHUwMEZDciBkaWUgZ2lsdFxyXG4gIC8vIG51ciBkaWVzZXIgQmxvY2spLCBTdWNoZSBwZXIgS2xpY2sgYXVmIGRlbiBUaXRlbCwgdW5kIGRpZSBiZWlkZW5cclxuICAvLyBcIlByb3BlcnR5IGhpbnp1Zlx1MDBGQ2dlblwiLUJ1dHRvbnMsIGRpZSBlaW5lIExlZXJ6ZWlsZSBpbiBnZW5hdSBkaWVzZW0gQmxvY2tcclxuICAvLyBhbmxlZ2VuLlxyXG4gIHJlbmRlclNlY3Rpb25IZWFkZXIoZWwsIHR5cGUsIHNlY3Rpb24sIGJ1Y2tldCwgYmxvY2tzKSB7XHJcbiAgICBjb25zdCB0aXRsZUdyb3VwID0gZWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLXRpdGxlLWdyb3VwXCIgfSk7XHJcbiAgICAvLyBCZXd1c3N0IG5pZSBlaW5nZWZcdTAwRTRyYnQgKHdlZGVyIGluIGRlciBUWVAtIG5vY2ggaW4gZGVyIFN1YnR5cC1GYXJiZSksXHJcbiAgICAvLyBhbmRlcnMgYWxzIGRlciBUaXRlbCBkZXIgRGV0YWlsYW5zaWNodCBkYXJcdTAwRkNiZXI6IGRpZSBGYXJiZSBlaW5lcyBCbG9ja3NcclxuICAgIC8vIHN0ZWh0IGltIEZhcmJwdW5rdCBzZWluZXMgQWJzY2hsdXNzZXMgKHNpZWhlIHJlbmRlclNlY3Rpb25Gb290ZXIpLlxyXG4gICAgY29uc3QgdGl0bGVFbCA9IHRpdGxlR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIsIHRleHQ6IHNlY3Rpb24gPz8gYCR7dHlwZX0tRnJvbnRtYXR0ZXJgIH0pO1xyXG4gICAgY29uc3QgY291bnQgPSBzZWN0aW9uID09PSBudWxsID8gYnVja2V0Lm5vU3VidHlwZSA6IGJ1Y2tldC5jb3VudHMuZ2V0KHNlY3Rpb24pID8/IDA7XHJcbiAgICB0aXRsZUdyb3VwLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtc3VidHlwZS1jb3VudFwiLCB0ZXh0OiBTdHJpbmcoY291bnQpIH0pO1xyXG4gICAgdGhpcy5tYWtlU2VhcmNoYWJsZSh0aXRsZUVsLCAoKSA9PiB0aGlzLm9wZW5TdWJ0eXBlU2VhcmNoKHR5cGUsIHNlY3Rpb24pKTtcclxuXHJcbiAgICAvLyBGbG9hdGluZyBQcm9wZXJ0aWVzIChzaWVoZSB0eXBlRmxvYXRpbmdLZXlzIGluIHNldHRpbmdzLmpzKSBzaW5kIFRlaWxcclxuICAgIC8vIGRlcnNlbGJlbiBMaXN0ZSB1bmQgUmVpaGVuZm9sZ2Ugd2llIGRpZSBcdTAwRkNicmlnZW4gUHJvcGVydGllcyAod2ljaHRpZyBmXHUwMEZDclxyXG4gICAgLy8gZGllIEZyb250bWF0dGVyLVNvcnRpZXJ1bmcpLCBsYW5kZW4gYWxzbyBhbiBnZW5hdSBkZXIgU3RlbGxlLCBhbiBkaWUgc2llXHJcbiAgICAvLyBwZXIgRHJhZyAmIERyb3AgZWluc29ydGllcnQgd2VyZGVuLCBzdGF0dCBmZXN0IGFucyBFbmRlIGVpbmVyIHp3ZWl0ZW4gTGlzdGUuXHJcbiAgICBjb25zdCBhZGRCdXR0b25zID0gZWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLWFkZC1ncm91cFwiIH0pO1xyXG5cclxuICAgIC8vIExpbmtzIG5lYmVuIGRlbSBub3JtYWxlbiBCdXR0b24sIGhlcnZvcmdlaG9iZW4gKEFremVudGZhcmJlLCB3aWVcclxuICAgIC8vIHJlbmFtZVdpdGhOb3Rlc0J0biBvYmVuKSAtIG1hcmtpZXJ0IGRpZSBhbHMgblx1MDBFNGNoc3RlcyBoaW56dWdlZlx1MDBGQ2d0ZSAoYnp3LlxyXG4gICAgLy8gYmlzIHp1bSBuXHUwMEU0Y2hzdGVuIFNwZWljaGVybiB1bWJlbmFubnRlKSBQcm9wZXJ0eSBhbHMgRmxvYXRpbmcsIHN0YXR0IHNpZVxyXG4gICAgLy8gYWxzIG5vcm1hbGUgU3RhbmRhcmQtUHJvcGVydHkgYW56dWxlZ2VuIChzaWVoZSBlZGl0b3IuZnJlZFBlbmRpbmdGbG9hdGluZ0FkZFxyXG4gICAgLy8gaW4gdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpLiBGbG9hdGluZyBQcm9wZXJ0aWVzIHdlcmRlbiBOSUNIVFxyXG4gICAgLy8gYXV0b21hdGlzY2ggYmVpIG5ldWVuIE5vdGl6ZW4gYW5nZWxlZ3QgKHNpZWhlIGdldFR5cGVEZWZhdWx0cygpIGluXHJcbiAgICAvLyBtYWluLmpzKSB1bmQgZG9ydCwgc29iYWxkIGRvY2ggdm9yaGFuZGVuLCBrdXJzaXYgc3RhdHQgZmV0dCBkYXJnZXN0ZWxsdFxyXG4gICAgLy8gKHNpZWhlIGZyb250bWF0dGVyLWRlZmF1bHQtaGlnaGxpZ2h0LmpzKS5cclxuICAgIGNvbnN0IGFkZEZsb2F0aW5nUHJvcGVydHlCdG4gPSBhZGRCdXR0b25zLmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1mcm9udG1hdHRlci1hZGQtZmxvYXRpbmdcIixcclxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJGbG9hdGluZyBQcm9wZXJ0eSBoaW56dWZcdTAwRkNnZW5cIiB9LFxyXG4gICAgfSk7XHJcbiAgICBzZXRJY29uKGFkZEZsb2F0aW5nUHJvcGVydHlCdG4sIFwicGx1c1wiKTtcclxuICAgIGFkZEZsb2F0aW5nUHJvcGVydHlCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IGJsb2Nrcy5hZGRCbGFuayhzZWN0aW9uLCB0cnVlKSk7XHJcblxyXG4gICAgY29uc3QgYWRkUHJvcGVydHlCdG4gPSBhZGRCdXR0b25zLmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1mcm9udG1hdHRlci1hZGRcIixcclxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJQcm9wZXJ0eSBoaW56dWZcdTAwRkNnZW5cIiB9LFxyXG4gICAgfSk7XHJcbiAgICBzZXRJY29uKGFkZFByb3BlcnR5QnRuLCBcInBsdXNcIik7XHJcbiAgICBhZGRQcm9wZXJ0eUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gYmxvY2tzLmFkZEJsYW5rKHNlY3Rpb24sIGZhbHNlKSk7XHJcbiAgfVxyXG5cclxuICAvLyBBYnNjaGx1c3MgZWluZXMgU3VidHlwLUJsb2NrczogbGlua3MgZGllIEZhcmJlIGRlcyBTdWJ0eXBzIChGYXJicHVua3QsIGRlclxyXG4gIC8vIGRpZSBSZWdsZXIgXHUwMEY2ZmZuZXQsIGRhbmViZW4gWnVyXHUwMEZDY2tzZXR6ZW4pLCByZWNodHMgZGllIEFrdGlvbmVuIHdpZSBpbSBLb3BmXHJcbiAgLy8gZGVyIFRZUC1EZXRhaWxhbnNpY2h0IChVbWJlbmVubmVuIGlua2wuIE5vdGl6ZW4sIFVtYmVuZW5uZW4sIExcdTAwRjZzY2hlbikuIERhc1xyXG4gIC8vIFRZUC1Gcm9udG1hdHRlciBoYXQga2VpbmVuLiBEZXIgVGl0ZWwgd2lyZCBlcnN0IGJlaW0gS2xpY2sgZ2VzdWNodCAtXHJcbiAgLy8gXHUwMERDYmVyc2NocmlmdCB1bmQgQWJzY2hsdXNzIGVudHN0ZWhlbiBiZWkgamVkZW0gc3luY2hyb25pemUoKSBuZXUuXHJcbiAgcmVuZGVyU2VjdGlvbkZvb3RlcihlbCwgdHlwZSwgc3VidHlwZSkge1xyXG4gICAgZWwuYWRkQ2xhc3MoXCJmcmVkLXR5cC1zdWJ0eXBlLWFjdGlvbnNcIik7XHJcbiAgICBjb25zdCBjb2xvckdyb3VwID0gZWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLXN1YnR5cGUtY29sb3ItZ3JvdXBcIiB9KTtcclxuICAgIC8vIFJpbmcgYXVjaCwgc29sYW5nZSBkZXIgVFlQIHNlbGJzdCBrZWluZSBGYXJiZSBoYXQgLSBkYW5uIGZcdTAwRTRyYnQgYXVjaFxyXG4gICAgLy8gZWluZSBlaW5nZXN0ZWxsdGUgQWJ3ZWljaHVuZyBuaXJnZW5kcyBlaW4uXHJcbiAgICBjb25zdCBvd25Db2xvciA9IHN1YnR5cGVIYXNPd25Db2xvcih0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSk7XHJcbiAgICBjb25zdCB0eXBlSGFzQ29sb3IgPSAhIXRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV07XHJcbiAgICBjb25zdCBjb2xvckRvdCA9IGNvbG9yR3JvdXAuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcImZyZWQtdHlwLXN1YnR5cGUtY29sb3ItZG90XCIsXHJcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6ICF0eXBlSGFzQ29sb3IgPyBcIlRZUCBoYXQga2VpbmUgRmFyYmVcIiA6IG93bkNvbG9yID8gXCJGYXJiZSBhbnBhc3NlblwiIDogXCJcdTAwRENiZXJuaW1tdCBUWVAtRmFyYmVcIiB9LFxyXG4gICAgfSk7XHJcbiAgICBjb2xvckRvdC5mcmVkU3VidHlwZSA9IHN1YnR5cGU7XHJcbiAgICBwYWludENvbG9yRG90KGNvbG9yRG90LCBzdWJ0eXBlQ29sb3IodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpID8/IERFRkFVTFRfVFlQRV9DT0xPUiwgIW93bkNvbG9yIHx8ICF0eXBlSGFzQ29sb3IpO1xyXG4gICAgY29sb3JEb3QuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMub3BlblN1YnR5cGVDb2xvclBvcG92ZXIoY29sb3JEb3QsIHR5cGUsIHN1YnR5cGUpKTtcclxuICAgIGNvbnN0IHJlc2V0QnRuID0gY29sb3JHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gZnJlZC10eXAtY29sb3ItcmVzZXRcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJGYXJiZSB6dXJcdTAwRkNja3NldHplblwiIH0gfSk7XHJcbiAgICByZXNldEJ0bi50b2dnbGVDbGFzcyhcImlzLWRpc2FibGVkXCIsICFvd25Db2xvcik7XHJcbiAgICBzZXRJY29uKHJlc2V0QnRuLCBcInJvdGF0ZS1jY3dcIik7XHJcbiAgICByZXNldEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBjb25zdCBkYXRhID0gZ2V0U3VidHlwZSh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSk7XHJcbiAgICAgIGlmICghZGF0YT8uY29sb3IpIHJldHVybjtcclxuICAgICAgZGVsZXRlIGRhdGEuY29sb3I7XHJcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgICAgdGhpcy5yZW5kZXIoKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGFjdGlvbnMgPSBlbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtc3VidHlwZS1hY3Rpb24tZ3JvdXBcIiB9KTtcclxuICAgIGNvbnN0IHRpdGxlRWwgPSAoKSA9PiB7XHJcbiAgICAgIGxldCBzaWJsaW5nID0gZWwucHJldmlvdXNFbGVtZW50U2libGluZztcclxuICAgICAgd2hpbGUgKHNpYmxpbmcgJiYgIXNpYmxpbmcuaGFzQ2xhc3MoXCJmcmVkLXR5cC1zZWN0aW9uLWhlYWRlclwiKSkgc2libGluZyA9IHNpYmxpbmcucHJldmlvdXNFbGVtZW50U2libGluZztcclxuICAgICAgcmV0dXJuIHNpYmxpbmc/LnF1ZXJ5U2VsZWN0b3IoXCIuZnJlZC10eXAtZGV0YWlsLXNlY3Rpb24tdGl0bGVcIikgPz8gbnVsbDtcclxuICAgIH07XHJcbiAgICBjb25zdCByZW5hbWUgPSAodXBkYXRlTm90ZXMpID0+IHtcclxuICAgICAgY29uc3QgdGFyZ2V0ID0gdGl0bGVFbCgpO1xyXG4gICAgICBpZiAodGFyZ2V0KSB0aGlzLnN0YXJ0U3VidHlwZVJlbmFtZSh0eXBlLCBzdWJ0eXBlLCB0YXJnZXQsIHsgdXBkYXRlTm90ZXMgfSk7XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IHJlbmFtZVdpdGhOb3Rlc0J0biA9IGFjdGlvbnMuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWRldGFpbC1yZW5hbWUtbm90ZXNcIixcclxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJVbWJlbmVubmVuIChpbmtsLiBOb3RpemVuIGFucGFzc2VuKVwiIH0sXHJcbiAgICB9KTtcclxuICAgIHNldEljb24ocmVuYW1lV2l0aE5vdGVzQnRuLCBcInBlbmNpbFwiKTtcclxuICAgIHJlbmFtZVdpdGhOb3Rlc0J0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gcmVuYW1lKHRydWUpKTtcclxuXHJcbiAgICBjb25zdCByZW5hbWVCdG4gPSBhY3Rpb25zLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1kZXRhaWwtcmVuYW1lXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiVW1iZW5lbm5lblwiIH0gfSk7XHJcbiAgICBzZXRJY29uKHJlbmFtZUJ0biwgXCJwZW5jaWxcIik7XHJcbiAgICByZW5hbWVCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHJlbmFtZShmYWxzZSkpO1xyXG5cclxuICAgIGNvbnN0IGRlbGV0ZUJ0biA9IGFjdGlvbnMuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWRldGFpbC1kZWxldGVcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJMXHUwMEY2c2NoZW5cIiB9IH0pO1xyXG4gICAgc2V0SWNvbihkZWxldGVCdG4sIFwidHJhc2hcIik7XHJcbiAgICBkZWxldGVCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuZGVsZXRlU3VidHlwZVdpdGhDb25maXJtKHR5cGUsIHN1YnR5cGUpKTtcclxuICB9XHJcblxyXG4gIC8vIFBvcG92ZXIgdW50ZXIgZGVtIEZhcmJwdW5rdCBlaW5lcyBTdWJ0eXAtQmxvY2tzOiBqZSBlaW4gUmVnbGVyIGZcdTAwRkNyXHJcbiAgLy8gRmFyYnRvbiwgU1x1MDBFNHR0aWd1bmcgdW5kIEhlbGxpZ2tlaXQsIGJlZ3Jlbnp0IGF1ZiBkaWUgaW4gZGVuIEVpbnN0ZWxsdW5nZW5cclxuICAvLyBmZXN0Z2VsZWd0ZSBBYndlaWNodW5nIChzaWVoZSB0eXBlLWNvbG9ycy5qcykuIERpZSBMZWlzdGUgamVkZXMgUmVnbGVyc1xyXG4gIC8vIHplaWd0IGFscyBWZXJsYXVmIGRpZSBGYXJiZW4sIGRpZSBlciBlcnJlaWNoZW4ga2Fubi4gQmVpbSBaaWVoZW4gXHUwMEU0bmRlcnRcclxuICAvLyBzaWNoIG51ciBkZXIgRmFyYnB1bmt0IGhpZXI7IGdlc3BlaWNoZXJ0IHVuZCBpbiBkaWUgXHUwMEZDYnJpZ2VuIEFuc2ljaHRlblxyXG4gIC8vIFx1MDBGQ2Jlcm5vbW1lbiB3aXJkIGJlaW0gU2NobGllXHUwMERGZW4gKEtsaWNrIGRhbmViZW4gb2RlciBFc2NhcGUpIC0gZWluXHJcbiAgLy8gcmVmcmVzaFR5cENvbG9ycygpIHJlbmRlcnQgdS4gYS4gZGllc2UgQW5zaWNodCBuZXUuXHJcbiAgb3BlblN1YnR5cGVDb2xvclBvcG92ZXIoYW5jaG9yRWwsIHR5cGUsIHN1YnR5cGUpIHtcclxuICAgIHRoaXMuY2xvc2VTdWJ0eXBlQ29sb3JQb3BvdmVyPy4oKTtcclxuICAgIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHRoaXMucGx1Z2luO1xyXG4gICAgY29uc3QgZGF0YSA9IGdldFN1YnR5cGUoc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpO1xyXG4gICAgaWYgKCFkYXRhKSByZXR1cm47XHJcbiAgICBjb25zdCB0eXBlQ29sb3IgPSBzZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdID8/IERFRkFVTFRfVFlQRV9DT0xPUjtcclxuICAgIC8vIE9obmUgZWlnZW5lIEFid2VpY2h1bmcgc3RlaHQgamVkZXIgUmVnbGVyIGF1ZiAwIC0gd2VsY2hlIGVzIGdpYnQsIHNhZ3RcclxuICAgIC8vIGFsbGVpbiBTVUJUWVBFX0NPTE9SX0NIQU5ORUxTIChzaWVoZSB0eXBlLWNvbG9ycy5qcykuXHJcbiAgICBjb25zdCBvZmZzZXQgPSBjbGFtcGVkT2Zmc2V0KHNldHRpbmdzLCBkYXRhLmNvbG9yKSA/PyBPYmplY3QuZnJvbUVudHJpZXMoU1VCVFlQRV9DT0xPUl9DSEFOTkVMUy5tYXAoKHsga2V5IH0pID0+IFtrZXksIDBdKSk7XHJcbiAgICBjb25zdCBkb2MgPSBhbmNob3JFbC5kb2M7XHJcbiAgICBjb25zdCBwb3BvdmVyID0gZG9jLmJvZHkuY3JlYXRlRGl2KHsgY2xzOiBcIm1lbnUgZnJlZC10eXAtc3VidHlwZS1jb2xvci1wb3BvdmVyXCIgfSk7XHJcblxyXG4gICAgY29uc3Qgcm93cyA9IFtdO1xyXG4gICAgY29uc3QgdXBkYXRlID0gKCkgPT4ge1xyXG4gICAgICBjb25zdCBjb2xvciA9IGFwcGx5Q29sb3JPZmZzZXQodHlwZUNvbG9yLCBvZmZzZXQpO1xyXG4gICAgICBmb3IgKGNvbnN0IGVsIG9mIHRoaXMuY29udGVudEVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIuZnJlZC10eXAtc3VidHlwZS1jb2xvci1kb3RcIikpIHtcclxuICAgICAgICBpZiAoZWwuZnJlZFN1YnR5cGUgPT09IHN1YnR5cGUpIHBhaW50Q29sb3JEb3QoZWwsIGNvbG9yLCAhaGFzQ29sb3JPZmZzZXQob2Zmc2V0KSB8fCAhc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXSk7XHJcbiAgICAgIH1cclxuICAgICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykgcm93KCk7XHJcbiAgICB9O1xyXG5cclxuICAgIGZvciAoY29uc3QgeyBrZXksIGxhYmVsLCB1bml0IH0gb2YgU1VCVFlQRV9DT0xPUl9DSEFOTkVMUykge1xyXG4gICAgICBjb25zdCBbbWluLCBtYXhdID0gY2hhbm5lbEJvdW5kcyhzZXR0aW5ncywga2V5KTtcclxuICAgICAgY29uc3Qgcm93ID0gcG9wb3Zlci5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtc3VidHlwZS1jb2xvci1yb3dcIiB9KTtcclxuICAgICAgcm93LmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtc3VidHlwZS1jb2xvci1sYWJlbFwiLCB0ZXh0OiBsYWJlbCB9KTtcclxuICAgICAgY29uc3QgaW5wdXQgPSByb3cuY3JlYXRlRWwoXCJpbnB1dFwiLCB7IHR5cGU6IFwicmFuZ2VcIiwgY2xzOiBcInNsaWRlciBmcmVkLXR5cC1zdWJ0eXBlLWNvbG9yLXNsaWRlclwiIH0pO1xyXG4gICAgICBpbnB1dC5taW4gPSBTdHJpbmcobWluKTtcclxuICAgICAgaW5wdXQubWF4ID0gU3RyaW5nKG1heCk7XHJcbiAgICAgIGlucHV0LnN0ZXAgPSBcIjFcIjtcclxuICAgICAgaW5wdXQudmFsdWUgPSBTdHJpbmcob2Zmc2V0W2tleV0pO1xyXG4gICAgICBpbnB1dC5kaXNhYmxlZCA9IG1pbiA9PT0gbWF4O1xyXG4gICAgICBjb25zdCB2YWx1ZUVsID0gcm93LmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtc3VidHlwZS1jb2xvci12YWx1ZVwiIH0pO1xyXG4gICAgICBpbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiaW5wdXRcIiwgKCkgPT4ge1xyXG4gICAgICAgIG9mZnNldFtrZXldID0gTnVtYmVyKGlucHV0LnZhbHVlKTtcclxuICAgICAgICB1cGRhdGUoKTtcclxuICAgICAgfSk7XHJcbiAgICAgIHJvd3MucHVzaCgoKSA9PiB7XHJcbiAgICAgICAgY29uc3Qgc3RlcHMgPSA4O1xyXG4gICAgICAgIGNvbnN0IHN0b3BzID0gW107XHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPD0gc3RlcHM7IGkrKykge1xyXG4gICAgICAgICAgc3RvcHMucHVzaChhcHBseUNvbG9yT2Zmc2V0KHR5cGVDb2xvciwgeyAuLi5vZmZzZXQsIFtrZXldOiBtaW4gKyAoKG1heCAtIG1pbikgKiBpKSAvIHN0ZXBzIH0pKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgaW5wdXQuc3R5bGUuc2V0UHJvcGVydHkoXCItLWZyZWQtdHJhY2tcIiwgYGxpbmVhci1ncmFkaWVudCh0byByaWdodCwgJHtzdG9wcy5qb2luKFwiLCBcIil9KWApO1xyXG4gICAgICAgIHZhbHVlRWwuc2V0VGV4dChgJHtvZmZzZXRba2V5XSA+IDAgPyBcIitcIiA6IFwiXCJ9JHtvZmZzZXRba2V5XX0ke3VuaXR9YCk7XHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgdXBkYXRlKCk7XHJcblxyXG4gICAgLy8gVW50ZXIgZGVtIFB1bmt0LCBhYmVyIGlubmVyaGFsYiBkZXMgRmVuc3RlcnMuXHJcbiAgICBjb25zdCByZWN0ID0gYW5jaG9yRWwuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XHJcbiAgICBjb25zdCB3aW4gPSBkb2MuZGVmYXVsdFZpZXc7XHJcbiAgICBjb25zdCB3aWR0aCA9IHBvcG92ZXIub2Zmc2V0V2lkdGg7XHJcbiAgICBjb25zdCBoZWlnaHQgPSBwb3BvdmVyLm9mZnNldEhlaWdodDtcclxuICAgIHBvcG92ZXIuc3R5bGUubGVmdCA9IGAke01hdGgubWF4KDgsIE1hdGgubWluKHJlY3QubGVmdCwgd2luLmlubmVyV2lkdGggLSB3aWR0aCAtIDgpKX1weGA7XHJcbiAgICBwb3BvdmVyLnN0eWxlLnRvcCA9IGAke3JlY3QuYm90dG9tICsgNiArIGhlaWdodCA+IHdpbi5pbm5lckhlaWdodCAtIDggPyByZWN0LnRvcCAtIDYgLSBoZWlnaHQgOiByZWN0LmJvdHRvbSArIDZ9cHhgO1xyXG5cclxuICAgIGNvbnN0IG9uUG9pbnRlckRvd24gPSAoZXZlbnQpID0+IHtcclxuICAgICAgaWYgKCFwb3BvdmVyLmNvbnRhaW5zKGV2ZW50LnRhcmdldCkpIGNsb3NlKCk7XHJcbiAgICB9O1xyXG4gICAgY29uc3Qgb25LZXlEb3duID0gKGV2ZW50KSA9PiB7XHJcbiAgICAgIGlmIChldmVudC5rZXkgIT09IFwiRXNjYXBlXCIpIHJldHVybjtcclxuICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgIGNsb3NlKCk7XHJcbiAgICB9O1xyXG4gICAgY29uc3QgY2xvc2UgPSBhc3luYyAoKSA9PiB7XHJcbiAgICAgIHRoaXMuY2xvc2VTdWJ0eXBlQ29sb3JQb3BvdmVyID0gbnVsbDtcclxuICAgICAgZG9jLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtb3VzZWRvd25cIiwgb25Qb2ludGVyRG93biwgdHJ1ZSk7XHJcbiAgICAgIGRvYy5yZW1vdmVFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCBvbktleURvd24sIHRydWUpO1xyXG4gICAgICBwb3BvdmVyLnJlbW92ZSgpO1xyXG4gICAgICBjb25zdCBjdXJyZW50ID0gZ2V0U3VidHlwZShzZXR0aW5ncywgdHlwZSwgc3VidHlwZSk7XHJcbiAgICAgIGlmICghY3VycmVudCkgcmV0dXJuO1xyXG4gICAgICBpZiAoaGFzQ29sb3JPZmZzZXQob2Zmc2V0KSkgY3VycmVudC5jb2xvciA9IHsgLi4ub2Zmc2V0IH07XHJcbiAgICAgIGVsc2UgZGVsZXRlIGN1cnJlbnQuY29sb3I7XHJcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgICAgdGhpcy5yZW5kZXIoKTtcclxuICAgIH07XHJcbiAgICB0aGlzLmNsb3NlU3VidHlwZUNvbG9yUG9wb3ZlciA9IGNsb3NlO1xyXG4gICAgZG9jLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZWRvd25cIiwgb25Qb2ludGVyRG93biwgdHJ1ZSk7XHJcbiAgICBkb2MuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgb25LZXlEb3duLCB0cnVlKTtcclxuICB9XHJcblxyXG4gIC8vIExcdTAwRjZzY2h0IGRlbiBTdWJ0eXAtQmxvY2sgc2FtdCBzZWluZXIgUHJvcGVydGllcy4gRGllIE5vdGl6ZW4gYmVoYWx0ZW4gaWhyZW5cclxuICAvLyBTVUJUWVAtV2VydCAoZXIgZXJzY2hlaW50IGRhbmFjaCB1bnRlbiBhbHMgbmljaHQgZXJmYXNzdGVyIFN1YnR5cCkgLSBlaW5lXHJcbiAgLy8gQmVzdFx1MDBFNHRpZ3VuZyBicmF1Y2h0IGVzIGRhaGVyIG51ciwgd2VubiBkYWJlaSBQcm9wZXJ0aWVzIHZlcmxvcmVuIGdlaGVuLlxyXG4gIGRlbGV0ZVN1YnR5cGVXaXRoQ29uZmlybSh0eXBlLCBzdWJ0eXBlKSB7XHJcbiAgICBjb25zdCBhcHBseSA9IGFzeW5jICgpID0+IHtcclxuICAgICAgZGVsZXRlU3VidHlwZSh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSk7XHJcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgICAgdGhpcy5yZW5kZXIoKTtcclxuICAgIH07XHJcbiAgICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXMoZ2V0U3VidHlwZSh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSk/LmZyb250bWF0dGVyID8/IHt9KS5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBcIlwiKTtcclxuICAgIGlmIChrZXlzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICBhcHBseSgpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBuZXcgQ29uZmlybVN1YnR5cGVNb2RhbCh0aGlzLmFwcCwge1xyXG4gICAgICBwYXJhZ3JhcGhzOiBbXHJcbiAgICAgICAgYFN1YnR5cCAke3N1YnR5cGV9IHZvbiAke3R5cGV9IHdpcmtsaWNoIGxcdTAwRjZzY2hlbj9gLFxyXG4gICAgICAgIGAke2tleXMubGVuZ3RoID09PSAxID8gXCJEaWUgUHJvcGVydHlcIiA6IGBEaWUgJHtrZXlzLmxlbmd0aH0gUHJvcGVydGllc2B9ICR7a2V5cy5qb2luKFwiLCBcIil9ICR7a2V5cy5sZW5ndGggPT09IDEgPyBcImdlaHRcIiA6IFwiZ2VoZW5cIn0gZGFiZWkgdmVybG9yZW4uYCxcclxuICAgICAgXSxcclxuICAgICAgY29uZmlybVRleHQ6IFwiTFx1MDBGNnNjaGVuXCIsXHJcbiAgICAgIGNvbmZpcm1DbHM6IFwibW9kLXdhcm5pbmdcIixcclxuICAgICAgb25Db25maXJtOiBhcHBseSxcclxuICAgIH0pLm9wZW4oKTtcclxuICB9XHJcblxyXG4gIC8vIFdpZSBzdGFydERldGFpbFJlbmFtZSgpLCBhYmVyIGF1ZiBkZW0gVGl0ZWwgZWluZXMgU3VidHlwLUJsb2Nrcy4gRGVyIEJsb2NrXHJcbiAgLy8gYmVoXHUwMEU0bHQgc2VpbmUgUG9zaXRpb247IHVwZGF0ZU5vdGVzOiB0cnVlIHNjaHJlaWJ0IG5hY2ggQmVzdFx1MDBFNHRpZ3VuZyBhdWNoIGRlblxyXG4gIC8vIFNVQlRZUCBkZXIgYmV0cm9mZmVuZW4gTm90aXplbiB1bS4gRWluIGJlcmVpdHMgdm9yaGFuZGVuZXIgTmFtZSBiaWV0ZXRcclxuICAvLyBzdGF0dGRlc3NlbiBkYXMgWnVzYW1tZW5sZWdlbiBhbiAoc2NocmVpYnQgZGllIE5vdGl6ZW4gaW1tZXIgbWl0IHVtKS5cclxuICBzdGFydFN1YnR5cGVSZW5hbWUodHlwZSwgc3VidHlwZSwgdGl0bGVFbCwgeyB1cGRhdGVOb3RlcyA9IGZhbHNlIH0gPSB7fSkge1xyXG4gICAgaWYgKHRoaXMuaXNFZGl0aW5nKSByZXR1cm47XHJcbiAgICB0aGlzLmlzRWRpdGluZyA9IHRydWU7XHJcblxyXG4gICAgdGl0bGVFbC5hZGRDbGFzcyhcImZyZWQtdHlwLXN1YnR5cGUtbmFtZS1pbnB1dFwiLCBcImlzLWJlaW5nLXJlbmFtZWRcIik7XHJcbiAgICB0aXRsZUVsLnNldEF0dHJpYnV0ZShcImNvbnRlbnRlZGl0YWJsZVwiLCBcInRydWVcIik7XHJcbiAgICB0aXRsZUVsLnNldEF0dHJpYnV0ZShcInNwZWxsY2hlY2tcIiwgXCJmYWxzZVwiKTtcclxuICAgIHRpdGxlRWwuZm9jdXMoKTtcclxuXHJcbiAgICBjb25zdCByYW5nZSA9IHRpdGxlRWwuZG9jLmNyZWF0ZVJhbmdlKCk7XHJcbiAgICByYW5nZS5zZWxlY3ROb2RlQ29udGVudHModGl0bGVFbCk7XHJcbiAgICBjb25zdCBzZWxlY3Rpb24gPSB0aXRsZUVsLndpbi5nZXRTZWxlY3Rpb24oKTtcclxuICAgIHNlbGVjdGlvbi5yZW1vdmVBbGxSYW5nZXMoKTtcclxuICAgIHNlbGVjdGlvbi5hZGRSYW5nZShyYW5nZSk7XHJcblxyXG4gICAgY29uc3QgY291bnRPZiA9IChuYW1lKSA9PiB0aGlzLnBsdWdpbi50eXBJbmRleC5zdWJ0eXBlQnVja2V0KHR5cGUpLmNvdW50cy5nZXQobmFtZSkgPz8gMDtcclxuICAgIGNvbnN0IGFwcGx5UmVuYW1lID0gYXN5bmMgKHZhbHVlLCB7IHdpdGhOb3RlcyB9KSA9PiB7XHJcbiAgICAgIHJlbmFtZVN1YnR5cGUodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUsIHZhbHVlKTtcclxuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgIGNvbnN0IHJlbmFtZWQgPSB3aXRoTm90ZXMgPyBhd2FpdCByZW5hbWVTdWJ0eXBlSW5Ob3Rlcyh0aGlzLnBsdWdpbiwgdHlwZSwgc3VidHlwZSwgdmFsdWUpIDogMDtcclxuICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbiAgICAgIGlmICh3aXRoTm90ZXMpIG5ldyBOb3RpY2UoYFNVQlRZUCAke3ZhbHVlfTogJHtyZW5hbWVkfSBOb3RpeihlbikgYW5nZXBhc3N0LmApO1xyXG4gICAgICB0aGlzLnJlbmRlcigpO1xyXG4gICAgfTtcclxuXHJcbiAgICBsZXQgZG9uZSA9IGZhbHNlO1xyXG4gICAgY29uc3QgZmluaXNoID0gYXN5bmMgKGNvbW1pdCkgPT4ge1xyXG4gICAgICBpZiAoZG9uZSkgcmV0dXJuO1xyXG4gICAgICBkb25lID0gdHJ1ZTtcclxuICAgICAgdGhpcy5pc0VkaXRpbmcgPSBmYWxzZTtcclxuXHJcbiAgICAgIGNvbnN0IHZhbHVlID0gbm9ybWFsaXplU3VidHlwZU5hbWUodGl0bGVFbC50ZXh0Q29udGVudCk7XHJcbiAgICAgIGlmICghY29tbWl0IHx8ICF2YWx1ZSB8fCB2YWx1ZSA9PT0gc3VidHlwZSkge1xyXG4gICAgICAgIHRoaXMucmVuZGVyKCk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCBleGlzdGluZyA9IGdldFN1YnR5cGVOYW1lcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSkuZmluZChcclxuICAgICAgICAobmFtZSkgPT4gbmFtZS50b0xvd2VyQ2FzZSgpID09PSB2YWx1ZS50b0xvd2VyQ2FzZSgpICYmIG5hbWUgIT09IHN1YnR5cGVcclxuICAgICAgKTtcclxuICAgICAgaWYgKGV4aXN0aW5nKSB7XHJcbiAgICAgICAgbmV3IENvbmZpcm1TdWJ0eXBlTW9kYWwodGhpcy5hcHAsIHtcclxuICAgICAgICAgIHBhcmFncmFwaHM6IFtcclxuICAgICAgICAgICAgYFN1YnR5cCAke2V4aXN0aW5nfSBleGlzdGllcnQgYmVpICR7dHlwZX0gYmVyZWl0cy4gJHtzdWJ0eXBlfSBkYW1pdCB6dXNhbW1lbmxlZ2VuP2AsXHJcbiAgICAgICAgICAgIGAke2NvdW50T2Yoc3VidHlwZSl9IE5vdGl6KGVuKSB3ZXJkZW4gYXVmICR7ZXhpc3Rpbmd9IHVtZ2VzdGVsbHQsIGRpZSBQcm9wZXJ0aWVzIHZvbiAke3N1YnR5cGV9IHdhbmRlcm4gaW4gZGVuIEJsb2NrICR7ZXhpc3Rpbmd9LmAsXHJcbiAgICAgICAgICBdLFxyXG4gICAgICAgICAgY29uZmlybVRleHQ6IFwiWnVzYW1tZW5sZWdlblwiLFxyXG4gICAgICAgICAgY29uZmlybUNsczogXCJtb2Qtd2FybmluZ1wiLFxyXG4gICAgICAgICAgb25Db25maXJtOiBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgICAgIG1lcmdlU3VidHlwZXModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUsIGV4aXN0aW5nKTtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IHJlbmFtZWQgPSBhd2FpdCByZW5hbWVTdWJ0eXBlSW5Ob3Rlcyh0aGlzLnBsdWdpbiwgdHlwZSwgc3VidHlwZSwgZXhpc3RpbmcpO1xyXG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgICAgICAgICAgbmV3IE5vdGljZShgU3VidHlwICR7c3VidHlwZX0gbWl0ICR7ZXhpc3Rpbmd9IHp1c2FtbWVuZ2VsZWd0LCAke3JlbmFtZWR9IE5vdGl6KGVuKSBhbmdlcGFzc3QuYCk7XHJcbiAgICAgICAgICAgIHRoaXMucmVuZGVyKCk7XHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgICAgb25DYW5jZWw6ICgpID0+IHRoaXMucmVuZGVyKCksXHJcbiAgICAgICAgfSkub3BlbigpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKCF1cGRhdGVOb3Rlcykge1xyXG4gICAgICAgIGF3YWl0IGFwcGx5UmVuYW1lKHZhbHVlLCB7IHdpdGhOb3RlczogZmFsc2UgfSk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcbiAgICAgIG5ldyBDb25maXJtU3VidHlwZU1vZGFsKHRoaXMuYXBwLCB7XHJcbiAgICAgICAgcGFyYWdyYXBoczogW2BTdWJ0eXAgJHtzdWJ0eXBlfSBpbiAke3ZhbHVlfSB1bWJlbmVubmVuIHVuZCAke2NvdW50T2Yoc3VidHlwZSl9IE5vdGl6KGVuKSBlbnRzcHJlY2hlbmQgYW5wYXNzZW4/YF0sXHJcbiAgICAgICAgY29uZmlybVRleHQ6IFwiVW1iZW5lbm5lblwiLFxyXG4gICAgICAgIGNvbmZpcm1DbHM6IFwibW9kLWN0YVwiLFxyXG4gICAgICAgIG9uQ29uZmlybTogKCkgPT4gYXBwbHlSZW5hbWUodmFsdWUsIHsgd2l0aE5vdGVzOiB0cnVlIH0pLFxyXG4gICAgICAgIG9uQ2FuY2VsOiAoKSA9PiB0aGlzLnJlbmRlcigpLFxyXG4gICAgICB9KS5vcGVuKCk7XHJcbiAgICB9O1xyXG5cclxuICAgIC8vIEFsbGUgVGFzdGVuIGhpZXIgYmVoYWx0ZW46IGRlciBUaXRlbCBzdGVodCBpbiBkZXIgTGlzdGUgdm9uIE9ic2lkaWFuc1xyXG4gICAgLy8gUHJvcGVydHktRWRpdG9yLCBkZXNzZW4gZWlnZW5lIFRhc3RhdHVyLU5hdmlnYXRpb24gc29uc3QgbWl0cmVhZ2llcnRlXHJcbiAgICAvLyAoRXNjYXBlIHp1c1x1MDBFNHR6bGljaCB3ZWdlbiBkZXIgRGV0YWlsYW5zaWNodCwgc2llaGUgb25PcGVuKS5cclxuICAgIHRpdGxlRWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XHJcbiAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVudGVyXCIpIHtcclxuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgIGZpbmlzaCh0cnVlKTtcclxuICAgICAgfSBlbHNlIGlmIChldmVudC5rZXkgPT09IFwiRXNjYXBlXCIpIHtcclxuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgIGZpbmlzaChmYWxzZSk7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG4gICAgdGl0bGVFbC5hZGRFdmVudExpc3RlbmVyKFwiYmx1clwiLCAoKSA9PiBmaW5pc2godHJ1ZSkpO1xyXG4gIH1cclxuXHJcbiAgLy8gV2llIGRpZSB1bnJlZ2lzdHJpZXJ0ZW4gRWludHJcdTAwRTRnZSBkZXIgVFlQLUxpc3RlOiBTVUJUWVAtV2VydGUgdm9uIE5vdGl6ZW5cclxuICAvLyBkaWVzZXMgVFlQcywgZGllIChub2NoKSBrZWluZW4gZWlnZW5lbiBCbG9jayBoYWJlbiAoTm90aXplbiBnYW56IG9obmVcclxuICAvLyBTVUJUWVAgelx1MDBFNGhsdCBzdGF0dGRlc3NlbiBkYXMgVFlQLUZyb250bWF0dGVyKS4gRGFyZ2VzdGVsbHQgd2llIGRpZVxyXG4gIC8vIFN1YnR5cC1CbFx1MDBGNmNrZSwgYWJlciBudXIgbWl0IFx1MDBEQ2JlcnNjaHJpZnQgc2FtdCBBbnphaGwuIEVpbiBLbGljayBhdWYgZGllXHJcbiAgLy8gQmxvY2tmbFx1MDBFNGNoZSBcdTAwRkNiZXJuaW1tdCBkZW4gV2VydCBhbHMgU3VidHlwLCBlaW4gS2xpY2sgYXVmIGRlbiBOYW1lbiBcdTAwRjZmZm5ldFxyXG4gIC8vIHN0YXR0ZGVzc2VuIGRpZSBTdWNoZSAtIHZvciBkZW0gRXJmYXNzZW4gbmFjaHp1c2VoZW4sIHdhcyBpbiBlaW5lbSBXZXJ0XHJcbiAgLy8gZWlnZW50bGljaCBzdGVja3QsIGlzdCBoaWVyIGRlciBoXHUwMEU0dWZpZ2UgRmFsbC4gRGVyIE5hbWUgaGVidCBzaWNoIGJlaW1cclxuICAvLyBIb3Zlcm4gaW4gQWt6ZW50ZmFyYmUgYWIgdW5kIHplaWd0IGRhbWl0IHNlbGJzdCBhbiwgZGFzcyBlciBldHdhcyBhbmRlcmVzXHJcbiAgLy8gdHV0IGFscyBkaWUgRmxcdTAwRTRjaGUgdW0gaWhuIGhlcnVtLlxyXG4gIHJlbmRlclVucmVnaXN0ZXJlZFN1YnR5cGVzKHBhcmVudCwgdHlwZSwgYnVja2V0KSB7XHJcbiAgICBjb25zdCByZWdpc3RlcmVkID0gZ2V0U3VidHlwZU5hbWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlKTtcclxuICAgIGNvbnN0IHVucmVnaXN0ZXJlZCA9IFsuLi5idWNrZXQuY291bnRzLmtleXMoKV1cclxuICAgICAgLmZpbHRlcigoa2V5KSA9PiAhcmVnaXN0ZXJlZC5pbmNsdWRlcyhrZXkpKVxyXG4gICAgICAuc29ydCgoYSwgYikgPT4gYnVja2V0LmNvdW50cy5nZXQoYikgLSBidWNrZXQuY291bnRzLmdldChhKSB8fCBhLmxvY2FsZUNvbXBhcmUoYikpO1xyXG4gICAgaWYgKHVucmVnaXN0ZXJlZC5sZW5ndGggPT09IDApIHJldHVybjtcclxuXHJcbiAgICBjb25zdCBsaXN0RWwgPSBwYXJlbnQuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLXN1YnR5cGUtdW5yZWdpc3RlcmVkLWxpc3RcIiB9KTtcclxuICAgIGZvciAoY29uc3Qga2V5IG9mIHVucmVnaXN0ZXJlZCkge1xyXG4gICAgICBjb25zdCBibG9jayA9IGxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItYmxvY2sgZnJlZC10eXAtc3VidHlwZS1ibG9jayBmcmVkLXR5cC1zdWJ0eXBlLXVucmVnaXN0ZXJlZFwiIH0pO1xyXG4gICAgICBjb25zdCBoZWFkZXIgPSBibG9jay5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItaGVhZGVyXCIgfSk7XHJcbiAgICAgIGNvbnN0IHRpdGxlR3JvdXAgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLXRpdGxlLWdyb3VwXCIgfSk7XHJcbiAgICAgIGNvbnN0IHRpdGxlRWwgPSB0aXRsZUdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtc2VjdGlvbi10aXRsZVwiLCB0ZXh0OiBkaXNwbGF5VHlwZUtleShrZXkpIH0pO1xyXG4gICAgICB0aXRsZUdyb3VwLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtc3VidHlwZS1jb3VudFwiLCB0ZXh0OiBTdHJpbmcoYnVja2V0LmNvdW50cy5nZXQoa2V5KSkgfSk7XHJcbiAgICAgIGJsb2NrLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnJlZ2lzdGVyU3VidHlwZSh0eXBlLCBrZXksIGJ1Y2tldCkpO1xyXG4gICAgICAvLyBzdG9wUHJvcGFnYXRpb24sIHNvbnN0IGVyZmFzc3RlIGRlcnNlbGJlIEtsaWNrIFx1MDBGQ2JlciBkZW4gQmxvY2stSGFuZGxlclxyXG4gICAgICAvLyB6dXNcdTAwRTR0emxpY2ggZGVuIFdlcnQsIGRlbiBtYW4gZ2VyYWRlIGVyc3QgbmFjaHNjaGxhZ2VuIHdvbGx0ZS5cclxuICAgICAgdGhpcy5tYWtlU2VhcmNoYWJsZSh0aXRsZUVsLCAoKSA9PiB0aGlzLm9wZW5TdWJ0eXBlU2VhcmNoKHR5cGUsIGtleSksIHsgc3RvcFByb3BhZ2F0aW9uOiB0cnVlIH0pO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLy8gRWluIE5hbWUsIGRlc3NlbiBLbGljayBkaWUgU3VjaGUgXHUwMEY2ZmZuZXQ6IFplaWdlci1DdXJzb3IgdW5kIEFremVudGZhcmJlIGJlaW1cclxuICAvLyBIb3Zlcm4gKHNpZWhlIC5mcmVkLXR5cC1zZWFyY2hhYmxlIGluIHN0eWxlcy5jc3MpLCBkYW1pdCBkaWUgQW5zaWNodCBzZWxic3RcclxuICAvLyB6ZWlndCwgd28gZXR3YXMgcGFzc2llcnQuIERpZSBTdWNoZSBsYWcgaGllciBmclx1MDBGQ2hlciBhdWYgZGVtIFJlY2h0c2tsaWNrIC1cclxuICAvLyBiZWltIFRZUC1Gcm9udG1hdHRlciBhdWYgZGVtIFRpdGVsLCBiZWkgU3VidHlwLUJsXHUwMEY2Y2tlbiBhdWYgZGVyIGdhbnplblxyXG4gIC8vIEJsb2NrZmxcdTAwRTRjaGUgLSB1bmQgd2FyIGRhbWl0IHByYWt0aXNjaCB1bmF1ZmZpbmRiYXI6IG5pY2h0cyBkZXV0ZXRlIGRhcmF1ZlxyXG4gIC8vIGhpbiwgdW5kIGVpbiBSZWNodHNrbGljayBpc3QgXHUwMEZDYmVyYWxsIHNvbnN0IGVpbiBLb250ZXh0bWVuXHUwMEZDLiBEZXIgTmFtZSBpc3RcclxuICAvLyBkZXIgT3J0LCBhbiBkZW0gbWFuIFwiemVpZyBtaXIgZGllc2UgTm90aXplblwiIGVyd2FydGV0LCBhbHNvIGhcdTAwRTRuZ3QgZXMgamV0enRcclxuICAvLyBnZW5hdSBkb3J0LiBXXHUwMEU0aHJlbmQgZWluZXIgVW1iZW5lbm51bmcgdHJcdTAwRTRndCBkYXNzZWxiZSBFbGVtZW50IGRpZSBLbGFzc2VcclxuICAvLyBpcy1iZWluZy1yZW5hbWVkIHVuZCBpc3QgZWluIEVpbmdhYmVmZWxkIC0gZGFubiBkYXJmIGVpbiBLbGljayBoaW5laW4gZGVuXHJcbiAgLy8gQ3Vyc29yIHNldHplbiB1bmQga2VpbmUgU3VjaGUgYXVzbFx1MDBGNnNlbi5cclxuICBtYWtlU2VhcmNoYWJsZShlbCwgb25TZWFyY2gsIHsgc3RvcFByb3BhZ2F0aW9uID0gZmFsc2UgfSA9IHt9KSB7XHJcbiAgICBlbC5hZGRDbGFzcyhcImZyZWQtdHlwLXNlYXJjaGFibGVcIik7XHJcbiAgICBlbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB7XHJcbiAgICAgIGlmIChlbC5oYXNDbGFzcyhcImlzLWJlaW5nLXJlbmFtZWRcIikpIHJldHVybjtcclxuICAgICAgaWYgKHN0b3BQcm9wYWdhdGlvbikgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgIG9uU2VhcmNoKCk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIC8vIHN1YnR5cGVLZXkgPT09IG51bGwgXHUyMTkyIE5vdGl6ZW4gZGllc2VzIFRZUHMgb2huZSBTVUJUWVAuIEZcdTAwRkNyIGVpbmUgTGlzdGVcclxuICAvLyBnaWJ0IGVzIHdpZSBiZWkgb3BlblNlYXJjaCgpIGtlaW5lIGV4YWt0ZSBTdWNoc3ludGF4IC0gZGFubiBuYWNoIE5vdGl6ZW5cclxuICAvLyBzdWNoZW4sIGRpZSBhbGxlIGlocmUgRWludHJcdTAwRTRnZSB0cmFnZW4uXHJcbiAgb3BlblN1YnR5cGVTZWFyY2godHlwZSwgc3VidHlwZUtleSkge1xyXG4gICAgY29uc3QgZ2xvYmFsU2VhcmNoID0gdGhpcy5wbHVnaW4uYXBwLmludGVybmFsUGx1Z2lucy5nZXRQbHVnaW5CeUlkKFwiZ2xvYmFsLXNlYXJjaFwiKTtcclxuICAgIGlmICghZ2xvYmFsU2VhcmNoKSByZXR1cm47XHJcbiAgICBjb25zdCB0eXBDbGF1c2UgPSB0aGlzLnR5cGVDbGF1c2UodHlwZSk7XHJcbiAgICBsZXQgc3VidHlwQ2xhdXNlO1xyXG4gICAgaWYgKHN1YnR5cGVLZXkgPT09IG51bGwpIHtcclxuICAgICAgc3VidHlwQ2xhdXNlID0gYC1bXCIke1NVQlRZUF9QUk9QRVJUWX1cIl1gO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgY29uc3QgcmF3ID0gdGhpcy5wbHVnaW4udHlwSW5kZXguc3VidHlwZUJ1Y2tldCh0eXBlKS5yYXdCeUtleS5nZXQoc3VidHlwZUtleSk7XHJcbiAgICAgIHN1YnR5cENsYXVzZSA9IEFycmF5LmlzQXJyYXkocmF3KVxyXG4gICAgICAgID8gcmF3Lm1hcCgodikgPT4gYFtcIiR7U1VCVFlQX1BST1BFUlRZfVwiOlwiJHtTdHJpbmcodiA/PyBcIlwiKS50cmltKCl9XCJdYCkuam9pbihcIiBcIilcclxuICAgICAgICA6IGBbXCIke1NVQlRZUF9QUk9QRVJUWX1cIjpcIiR7c3VidHlwZUtleX1cIl1gO1xyXG4gICAgfVxyXG4gICAgZ2xvYmFsU2VhcmNoLmluc3RhbmNlLm9wZW5HbG9iYWxTZWFyY2goYCR7dHlwQ2xhdXNlfSAke3N1YnR5cENsYXVzZX1gKTtcclxuICB9XHJcblxyXG4gIC8vIFdpZSByZWdpc3RlclR5cGUoKTogXHUwMEZDYmVybmltbXQgZGllIGJlcmVpbmlndGUgRm9ybSAoR3JvXHUwMERGYnVjaHN0YWJlbiwgTGlzdGVcclxuICAvLyBhbHMgRWluemVsd2VydCBcIkEsIEJcIikgYWxzIFN1YnR5cCBkaWVzZXMgVFlQcyB1bmQgc2NocmVpYnQgZGVuIFNVQlRZUCBkZXJcclxuICAvLyBiZXRyb2ZmZW5lbiBOb3RpemVuIGdsZWljaCBtaXQgdW0uIEdpYnQgZXMgZGVuIFN1YnR5cCBpbiBhbmRlcmVyIFNjaHJlaWItXHJcbiAgLy8gd2Vpc2Ugc2Nob24sIGxhbmRlbiBkaWUgTm90aXplbiBkb3J0LlxyXG4gIGFzeW5jIHJlZ2lzdGVyU3VidHlwZSh0eXBlLCBzdWJ0eXBlS2V5LCBidWNrZXQpIHtcclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuYXBwbHlTdWJ0eXBlUmVnaXN0cmF0aW9uKHR5cGUsIHN1YnR5cGVLZXksIGJ1Y2tldCk7XHJcbiAgICBpZiAoIXJlc3VsdCkgcmV0dXJuO1xyXG5cclxuICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbiAgICBpZiAocmVzdWx0LnJlbmFtZWQgPiAwKSBuZXcgTm90aWNlKGBTVUJUWVAgJHtyZXN1bHQuc3VidHlwZX0gcmVnaXN0cmllcnQsICR7cmVzdWx0LnJlbmFtZWR9IE5vdGl6KGVuKSBhbmdlcGFzc3QuYCk7XHJcbiAgfVxyXG5cclxuICAvLyBXaWUgYXBwbHlUeXBlUmVnaXN0cmF0aW9uIGZcdTAwRkNyIGRlbiBUWVA6IGRlciBWb3JnYW5nIG9obmUgU3BlaWNoZXJuIHVuZFxyXG4gIC8vIE5vdGljZSwgZGFtaXQgcmVnaXN0ZXJUeXBlV2l0aFN1YnR5cGUoKSBpaG4gbWl0IGRlciBUWVAtRXJmYXNzdW5nIGJcdTAwRkNuZGVsblxyXG4gIC8vIGthbm4uIExpZWZlcnQgeyBzdWJ0eXBlLCByZW5hbWVkIH0gb2RlciBudWxsLlxyXG4gIGFzeW5jIGFwcGx5U3VidHlwZVJlZ2lzdHJhdGlvbih0eXBlLCBzdWJ0eXBlS2V5LCBidWNrZXQpIHtcclxuICAgIGNvbnN0IHJhdyA9IGJ1Y2tldC5yYXdCeUtleS5nZXQoc3VidHlwZUtleSk7XHJcbiAgICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplUmF3VHlwZShyYXcgPT09IHVuZGVmaW5lZCA/IHN1YnR5cGVLZXkgOiByYXcsIG5vcm1hbGl6ZVN1YnR5cGVOYW1lKTtcclxuICAgIGlmICghbm9ybWFsaXplZCkgcmV0dXJuIG51bGw7XHJcbiAgICBjb25zdCBleGlzdGluZyA9IGdldFN1YnR5cGVOYW1lcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSkuZmluZCgobmFtZSkgPT4gbmFtZS50b0xvd2VyQ2FzZSgpID09PSBub3JtYWxpemVkLnRvTG93ZXJDYXNlKCkpO1xyXG4gICAgY29uc3Qgc3VidHlwZSA9IGV4aXN0aW5nID8/IG5vcm1hbGl6ZWQ7XHJcbiAgICBlbnN1cmVTdWJ0eXBlKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKTtcclxuXHJcbiAgICBjb25zdCByZW5hbWVkID0gc3VidHlwZSAhPT0gc3VidHlwZUtleSA/IGF3YWl0IHJlbmFtZVN1YnR5cGVJbk5vdGVzKHRoaXMucGx1Z2luLCB0eXBlLCBzdWJ0eXBlS2V5LCBzdWJ0eXBlKSA6IDA7XHJcbiAgICByZXR1cm4geyBzdWJ0eXBlLCByZW5hbWVkIH07XHJcbiAgfVxyXG5cclxuICAvLyBOZXVlciwgbGVlcmVyIFN1YnR5cC1CbG9jayBkaXJla3QgXHUwMEZDYmVyIGRlbSBcIlN1YnR5cCBoaW56dWZcdTAwRkNnZW5cIi1CdXR0b24sXHJcbiAgLy8gZGVzc2VuIE5hbWUgc29mb3J0IGlubGluZSBlaW5nZWdlYmVuIHdpcmQgKHdpZSBzdGFydEFkZCgpIGluIGRlciBMaXN0ZSkuXHJcbiAgc3RhcnRBZGRTdWJ0eXBlKHR5cGUpIHtcclxuICAgIGlmICh0aGlzLmlzRWRpdGluZyB8fCAhdGhpcy5zdWJ0eXBlQWRkQnRuRWwpIHJldHVybjtcclxuICAgIHRoaXMuaXNFZGl0aW5nID0gdHJ1ZTtcclxuXHJcbiAgICAvLyBBdWZnZWJhdXQgd2llIGRlciBmZXJ0aWdlIChsZWVyZSkgQmxvY2sgaW0gZ2VtZWluc2FtZW4gRWRpdG9yIC0gc2FtdCBkZW5cclxuICAgIC8vIFwiK1wiLUJ1dHRvbnMgdW5kIGRlbiBBa3Rpb25lbiBpbSBBYnNjaGx1c3MsIGRpZSBoaWVyIG5vY2ggbmljaHRzIHR1biwgbnVyXHJcbiAgICAvLyBub2NoIG9obmUgQW56YWhsIC0sIGRhbWl0IGJlaW0gQWJzY2hsaWVcdTAwREZlbiBkZXIgRWluZ2FiZSBuaWNodHMgc3ByaW5ndFxyXG4gICAgLy8gKHNpZWhlIC5mcmVkLXR5cC1zdWJ0eXBlLXBlbmRpbmcpLlxyXG4gICAgY29uc3QgYmxvY2sgPSBjcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItYmxvY2sgZnJlZC10eXAtc3VidHlwZS1ibG9jayBmcmVkLXR5cC1zdWJ0eXBlLXBlbmRpbmdcIiB9KTtcclxuICAgIHRoaXMuc3VidHlwZUFkZEJ0bkVsLnBhcmVudEVsZW1lbnQuaW5zZXJ0QmVmb3JlKGJsb2NrLCB0aGlzLnN1YnR5cGVBZGRCdG5FbCk7XHJcbiAgICBjb25zdCBoZWFkZXIgPSBibG9jay5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItaGVhZGVyXCIgfSk7XHJcbiAgICBjb25zdCB0aXRsZUdyb3VwID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1mcm9udG1hdHRlci10aXRsZS1ncm91cFwiIH0pO1xyXG4gICAgY29uc3QgbmFtZUVsID0gdGl0bGVHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZGV0YWlsLXNlY3Rpb24tdGl0bGUgZnJlZC10eXAtc3VidHlwZS1uYW1lLWlucHV0IGlzLWJlaW5nLXJlbmFtZWRcIiB9KTtcclxuICAgIGNvbnN0IGFkZEJ1dHRvbnMgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLWFkZC1ncm91cFwiIH0pO1xyXG4gICAgc2V0SWNvbihhZGRCdXR0b25zLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1mcm9udG1hdHRlci1hZGQtZmxvYXRpbmdcIiB9KSwgXCJwbHVzXCIpO1xyXG4gICAgc2V0SWNvbihhZGRCdXR0b25zLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1mcm9udG1hdHRlci1hZGRcIiB9KSwgXCJwbHVzXCIpO1xyXG4gICAgY29uc3QgZm9vdGVyID0gYmxvY2suY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLXNlY3Rpb24tZm9vdGVyIGZyZWQtdHlwLXN1YnR5cGUtYWN0aW9uc1wiIH0pO1xyXG4gICAgY29uc3QgY29sb3JHcm91cCA9IGZvb3Rlci5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtc3VidHlwZS1jb2xvci1ncm91cFwiIH0pO1xyXG4gICAgcGFpbnRDb2xvckRvdChjb2xvckdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1zdWJ0eXBlLWNvbG9yLWRvdFwiIH0pLCB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdID8/IERFRkFVTFRfVFlQRV9DT0xPUiwgdHJ1ZSk7XHJcbiAgICBzZXRJY29uKGNvbG9yR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWNvbG9yLXJlc2V0IGlzLWRpc2FibGVkXCIgfSksIFwicm90YXRlLWNjd1wiKTtcclxuICAgIGNvbnN0IGFjdGlvbnMgPSBmb290ZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLXN1YnR5cGUtYWN0aW9uLWdyb3VwXCIgfSk7XHJcbiAgICBzZXRJY29uKGFjdGlvbnMuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWRldGFpbC1yZW5hbWUtbm90ZXNcIiB9KSwgXCJwZW5jaWxcIik7XHJcbiAgICBzZXRJY29uKGFjdGlvbnMuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWRldGFpbC1yZW5hbWVcIiB9KSwgXCJwZW5jaWxcIik7XHJcbiAgICBzZXRJY29uKGFjdGlvbnMuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWRldGFpbC1kZWxldGVcIiB9KSwgXCJ0cmFzaFwiKTtcclxuICAgIG5hbWVFbC5zZXRBdHRyaWJ1dGUoXCJjb250ZW50ZWRpdGFibGVcIiwgXCJ0cnVlXCIpO1xyXG4gICAgbmFtZUVsLnNldEF0dHJpYnV0ZShcInNwZWxsY2hlY2tcIiwgXCJmYWxzZVwiKTtcclxuICAgIG5hbWVFbC5mb2N1cygpO1xyXG5cclxuICAgIGxldCBkb25lID0gZmFsc2U7XHJcbiAgICBjb25zdCBmaW5pc2ggPSBhc3luYyAoY29tbWl0KSA9PiB7XHJcbiAgICAgIGlmIChkb25lKSByZXR1cm47XHJcbiAgICAgIGRvbmUgPSB0cnVlO1xyXG4gICAgICB0aGlzLmlzRWRpdGluZyA9IGZhbHNlO1xyXG5cclxuICAgICAgY29uc3QgdmFsdWUgPSBub3JtYWxpemVTdWJ0eXBlTmFtZShuYW1lRWwudGV4dENvbnRlbnQpO1xyXG4gICAgICBpZiAoY29tbWl0ICYmIHZhbHVlKSB7XHJcbiAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBnZXRTdWJ0eXBlTmFtZXModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUpLmZpbmQoKG5hbWUpID0+IG5hbWUudG9Mb3dlckNhc2UoKSA9PT0gdmFsdWUudG9Mb3dlckNhc2UoKSk7XHJcbiAgICAgICAgaWYgKGV4aXN0aW5nKSB7XHJcbiAgICAgICAgICBuZXcgTm90aWNlKGBTdWJ0eXAgJHtleGlzdGluZ30gZ2lidCBlcyBiZWkgJHt0eXBlfSBiZXJlaXRzLmApO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICBlbnN1cmVTdWJ0eXBlKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlLCB2YWx1ZSk7XHJcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgdGhpcy5yZW5kZXIoKTtcclxuICAgIH07XHJcblxyXG4gICAgbmFtZUVsLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIChldmVudCkgPT4ge1xyXG4gICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVudGVyXCIpIHtcclxuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgICAgIGZpbmlzaCh0cnVlKTtcclxuICAgICAgfSBlbHNlIGlmIChldmVudC5rZXkgPT09IFwiRXNjYXBlXCIpIHtcclxuICAgICAgICAvLyBzdG9wUHJvcGFnYXRpb24sIHNvbnN0IHZlcmxcdTAwRTRzc3QgZGVyIEVzY2FwZS1IYW5kbGVyIGRlciBnZXNhbXRlblxyXG4gICAgICAgIC8vIERldGFpbGFuc2ljaHQgc2llIGdsZWljaCBtaXQuXHJcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcclxuICAgICAgICBmaW5pc2goZmFsc2UpO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuICAgIG5hbWVFbC5hZGRFdmVudExpc3RlbmVyKFwiYmx1clwiLCAoKSA9PiBmaW5pc2godHJ1ZSkpO1xyXG4gIH1cclxuXHJcbiAgc2hvd0RlbGV0ZUNvbmZpcm0odHlwZSkge1xyXG4gICAgbmV3IENvbmZpcm1EZWxldGVUeXBlTW9kYWwodGhpcy5wbHVnaW4sIHR5cGUsIGFzeW5jICgpID0+IHtcclxuICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXMgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlcy5maWx0ZXIoKHQpID0+IHQgIT09IHR5cGUpO1xyXG4gICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXTtcclxuICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV07XHJcbiAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdO1xyXG4gICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXTtcclxuICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVTaG9ydGN1dHNbdHlwZV07XHJcbiAgICAgIGRlbGV0ZSB0aGlzLmVuc3VyZVR5cGVNYW51YWwoKVt0eXBlXTtcclxuICAgICAgZGVsZXRlVHlwZVN1YnR5cGVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlKTtcclxuICAgICAgLy8gVm9yIHJlZnJlc2hUeXBDb2xvcnMoKSB6dXJcdTAwRkNjayB6dXIgTGlzdGUsIGF1cyBkZW1zZWxiZW4gR3J1bmQgd2llIGJlaW1cclxuICAgICAgLy8gVW1iZW5lbm5lbjogcmVmcmVzaFR5cENvbG9ycygpIHJlbmRlcnQgKHUuIGEuIFx1MDBGQ2JlciByZWdpc3RlclR5cFZpZXcpXHJcbiAgICAgIC8vIHN5bmNocm9uIG5ldSAtIHN0XHUwMEZDbmRlIHNlbGVjdGVkVHlwZSBub2NoIGF1ZiBkZW0gZ2VyYWRlIGdlbFx1MDBGNnNjaHRlblxyXG4gICAgICAvLyBUeXAsIHdcdTAwRkNyZGUgZGVzc2VuIGpldHp0IGRhdGVubG9zZSBEZXRhaWxhbnNpY2h0IGt1cnogZXJuZXV0IGdlcmVuZGVydC5cclxuICAgICAgdGhpcy5jbG9zZVR5cGVTZXR0aW5ncygpO1xyXG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbiAgICB9KS5vcGVuKCk7XHJcbiAgfVxyXG5cclxuICAvLyBXaWUgc3RhcnRFZGl0aW5nKCksIGFiZXIgYXVmIGRlbSBmcmVpc3RlaGVuZGVuIFRpdGVsLUVsZW1lbnQgZGVyIERldGFpbC1BbnNpY2h0XHJcbiAgLy8gc3RhdHQgYXVmIGVpbmVtIFRyZWUtSXRlbSAtIHVuZCBtaXQgcmVzdWx0aWVyZW5kZW0gc2VsZWN0ZWRUeXBlLVdlY2hzZWwgc3RhdHRcclxuICAvLyBlaW5lcyBzY2hsaWNodGVuIFJlLVJlbmRlcnMgZGVyIExpc3RlLiB1cGRhdGVOb3RlczogdHJ1ZSAoendlaXRlciwgaGVydm9yLVxyXG4gIC8vIGdlaG9iZW5lciBCdXR0b24pIHNjaHJlaWJ0IG5hY2ggQmVzdFx1MDBFNHRpZ3VuZyB6dXNcdTAwRTR0emxpY2ggZGVuIFRZUC1XZXJ0IGFsbGVyXHJcbiAgLy8gYmV0cm9mZmVuZW4gTm90aXplbiB1bSAoc2llaGUgcmVuYW1lVHlwZUluTm90ZXMpLCBzdGF0dCBudXIgZGllIFBsdWdpbi1cclxuICAvLyBFaW5zdGVsbHVuZ2VuIHp1IG1pZ3JpZXJlbi5cclxuICBzdGFydERldGFpbFJlbmFtZSh0eXBlLCB0aXRsZUVsLCB7IHVwZGF0ZU5vdGVzID0gZmFsc2UgfSA9IHt9KSB7XHJcbiAgICBpZiAodGhpcy5pc0VkaXRpbmcpIHJldHVybjtcclxuICAgIHRoaXMuaXNFZGl0aW5nID0gdHJ1ZTtcclxuXHJcbiAgICB0aXRsZUVsLmFkZENsYXNzKFwiaXMtYmVpbmctcmVuYW1lZFwiKTtcclxuICAgIHRpdGxlRWwuc2V0QXR0cmlidXRlKFwiY29udGVudGVkaXRhYmxlXCIsIFwidHJ1ZVwiKTtcclxuICAgIHRpdGxlRWwuc2V0QXR0cmlidXRlKFwic3BlbGxjaGVja1wiLCBcImZhbHNlXCIpO1xyXG4gICAgdGl0bGVFbC5mb2N1cygpO1xyXG5cclxuICAgIGNvbnN0IHJhbmdlID0gdGl0bGVFbC5kb2MuY3JlYXRlUmFuZ2UoKTtcclxuICAgIHJhbmdlLnNlbGVjdE5vZGVDb250ZW50cyh0aXRsZUVsKTtcclxuICAgIGNvbnN0IHNlbGVjdGlvbiA9IHRpdGxlRWwud2luLmdldFNlbGVjdGlvbigpO1xyXG4gICAgc2VsZWN0aW9uLnJlbW92ZUFsbFJhbmdlcygpO1xyXG4gICAgc2VsZWN0aW9uLmFkZFJhbmdlKHJhbmdlKTtcclxuXHJcbiAgICAvLyBNaWdyaWVydCBudXIgZGllIFBsdWdpbi1FaW5zdGVsbHVuZ2VuIChMaXN0ZSwgRmFyYmUsIEJlc2NocmVpYnVuZyxcclxuICAgIC8vIFRZUC1Gcm9udG1hdHRlciwgTWFudWVsbGVyLVRZUC1TY2hhbHRlcikgYXVmIGRlbiBuZXVlbiBOYW1lbiAtXHJcbiAgICAvLyByXHUwMEZDaHJ0IGtlaW5lIE5vdGl6ZW4gYW4uIEdlbWVpbnNhbSBnZW51dHp0IHZvbiBiZWlkZW4gVW1iZW5lbm5lbi1QZmFkZW4uXHJcbiAgICBjb25zdCBhcHBseVJlbmFtZSA9IGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICBjb25zdCBpZHggPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlcy5pbmRleE9mKHR5cGUpO1xyXG4gICAgICBpZiAoaWR4ICE9PSAtMSkgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXNbaWR4XSA9IHZhbHVlO1xyXG4gICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdO1xyXG4gICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdO1xyXG4gICAgICB9XHJcbiAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3R5cGVdICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV07XHJcbiAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV07XHJcbiAgICAgIH1cclxuICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXTtcclxuICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXTtcclxuICAgICAgfVxyXG4gICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdO1xyXG4gICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdO1xyXG4gICAgICB9XHJcbiAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlU2hvcnRjdXRzW3R5cGVdICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlU2hvcnRjdXRzW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVTaG9ydGN1dHNbdHlwZV07XHJcbiAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVTaG9ydGN1dHNbdHlwZV07XHJcbiAgICAgIH1cclxuICAgICAgaWYgKHRoaXMuZW5zdXJlVHlwZU1hbnVhbCgpW3R5cGVdICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlTWFudWFsW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVNYW51YWxbdHlwZV07XHJcbiAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVNYW51YWxbdHlwZV07XHJcbiAgICAgIH1cclxuICAgICAgbW92ZVR5cGVTdWJ0eXBlcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgdmFsdWUpO1xyXG4gICAgICAvLyBWb3IgcmVmcmVzaFR5cENvbG9ycygpIHNldHplbjogZGFzIHJ1ZnQgKHUuIGEuIFx1MDBGQ2JlciBkZW4gaW5cclxuICAgICAgLy8gcmVnaXN0ZXJUeXBWaWV3IHp1clx1MDBGQ2NrZ2VnZWJlbmVuIFJlZnJlc2gpIHN5bmNocm9uIHJlbmRlcigpIGF1ZiAtXHJcbiAgICAgIC8vIHN0XHUwMEZDbmRlIHNlbGVjdGVkVHlwZSBub2NoIGF1ZiBkZW0gYWx0ZW4gKGJlcmVpdHMgbWlncmllcnRlbixcclxuICAgICAgLy8gZGFoZXIgamV0enQgZGF0ZW4tbG9zZW4pIE5hbWVuLCB3XHUwMEZDcmRlIGt1cnp6ZWl0aWcgZ2VuYXUgZGVyIEFsdC1cclxuICAgICAgLy8gTmFtZSBtaXQgbGVlcmVuIERhdGVuIGdlcmVuZGVydC5cclxuICAgICAgdGhpcy5zZWxlY3RlZFR5cGUgPSB2YWx1ZTtcclxuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgfTtcclxuXHJcbiAgICBsZXQgZG9uZSA9IGZhbHNlO1xyXG4gICAgY29uc3QgZmluaXNoID0gYXN5bmMgKGNvbW1pdCkgPT4ge1xyXG4gICAgICBpZiAoZG9uZSkgcmV0dXJuO1xyXG4gICAgICBkb25lID0gdHJ1ZTtcclxuICAgICAgdGhpcy5pc0VkaXRpbmcgPSBmYWxzZTtcclxuXHJcbiAgICAgIGNvbnN0IHZhbHVlID0gbm9ybWFsaXplVHlwZU5hbWUodGl0bGVFbC50ZXh0Q29udGVudCk7XHJcbiAgICAgIGlmICghY29tbWl0IHx8ICF2YWx1ZSB8fCB2YWx1ZSA9PT0gdHlwZSkge1xyXG4gICAgICAgIHRoaXMucmVuZGVyKCk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVzLmZpbmQoXHJcbiAgICAgICAgKHQpID0+IHQudG9Mb3dlckNhc2UoKSA9PT0gdmFsdWUudG9Mb3dlckNhc2UoKSAmJiB0ICE9PSB0eXBlXHJcbiAgICAgICk7XHJcbiAgICAgIGlmIChleGlzdGluZykge1xyXG4gICAgICAgIHRoaXMuc2hvd01lcmdlQ29uZmlybSh0eXBlLCBleGlzdGluZyk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAoIXVwZGF0ZU5vdGVzKSB7XHJcbiAgICAgICAgYXdhaXQgYXBwbHlSZW5hbWUodmFsdWUpO1xyXG4gICAgICAgIHRoaXMucmVuZGVyKCk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBCdWxrLVNjaHJlaWJ2b3JnYW5nIFx1MDBGQ2JlciBwb3RlbnppZWxsIHZpZWxlIERhdGVpZW4gLSB2b3JoZXIgYmVzdFx1MDBFNHRpZ2VuXHJcbiAgICAgIC8vIGxhc3Nlbiwgc3RhdHQgc29mb3J0IHp1IHNwZWljaGVybi5cclxuICAgICAgY29uc3QgeyBjb3VudHMgfSA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnR5cGVDb3VudHMoKTtcclxuICAgICAgbmV3IENvbmZpcm1SZW5hbWVUeXBlTW9kYWwoXHJcbiAgICAgICAgdGhpcy5wbHVnaW4sXHJcbiAgICAgICAgdHlwZSxcclxuICAgICAgICB2YWx1ZSxcclxuICAgICAgICBjb3VudHMuZ2V0KHR5cGUpID8/IDAsXHJcbiAgICAgICAgYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgICAgYXdhaXQgYXBwbHlSZW5hbWUodmFsdWUpO1xyXG4gICAgICAgICAgY29uc3QgcmVuYW1lZCA9IGF3YWl0IHJlbmFtZVR5cGVJbk5vdGVzKHRoaXMucGx1Z2luLCB0eXBlLCB2YWx1ZSk7XHJcbiAgICAgICAgICBuZXcgTm90aWNlKGBUWVAgJHt2YWx1ZX06ICR7cmVuYW1lZH0gTm90aXooZW4pIGFuZ2VwYXNzdC5gKTtcclxuICAgICAgICAgIHRoaXMucmVuZGVyKCk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICAoKSA9PiB0aGlzLnJlbmRlcigpXHJcbiAgICAgICkub3BlbigpO1xyXG4gICAgfTtcclxuXHJcbiAgICB0aXRsZUVsLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIChldmVudCkgPT4ge1xyXG4gICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVudGVyXCIpIHtcclxuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xyXG4gICAgICAgIGZpbmlzaCh0cnVlKTtcclxuICAgICAgfSBlbHNlIGlmIChldmVudC5rZXkgPT09IFwiRXNjYXBlXCIpIHtcclxuICAgICAgICAvLyBzdG9wUHJvcGFnYXRpb24sIHNvbnN0IGdyZWlmdCB6dXNcdTAwRTR0emxpY2ggZGVyIEVzY2FwZS1IYW5kbGVyIGRlclxyXG4gICAgICAgIC8vIGdlc2FtdGVuIERldGFpbC1BbnNpY2h0IHVuZCB2ZXJsXHUwMEU0c3N0IHNpZSBnbGVpY2ggbWl0LlxyXG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgICAgZmluaXNoKGZhbHNlKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgdGl0bGVFbC5hZGRFdmVudExpc3RlbmVyKFwiYmx1clwiLCAoKSA9PiBmaW5pc2godHJ1ZSkpO1xyXG4gIH1cclxuXHJcbiAgc2hvd01lcmdlQ29uZmlybShzb3VyY2UsIHRhcmdldCkge1xyXG4gICAgY29uc3QgeyBjb3VudHMgfSA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnR5cGVDb3VudHMoKTtcclxuICAgIG5ldyBDb25maXJtTWVyZ2VUeXBlTW9kYWwoXHJcbiAgICAgIHRoaXMucGx1Z2luLFxyXG4gICAgICBzb3VyY2UsXHJcbiAgICAgIHRhcmdldCxcclxuICAgICAgY291bnRzLmdldChzb3VyY2UpID8/IDAsXHJcbiAgICAgICgpID0+IHRoaXMubWVyZ2VUeXBlKHNvdXJjZSwgdGFyZ2V0KSxcclxuICAgICAgKCkgPT4gdGhpcy5yZW5kZXIoKVxyXG4gICAgKS5vcGVuKCk7XHJcbiAgfVxyXG5cclxuICAvLyBMZWd0IHNvdXJjZSBpbiB0YXJnZXQgYXVmOiBOb3RpemVuIHdlcmRlbiBhdWYgdGFyZ2V0IHVtZ2VzY2hyaWViZW4sXHJcbiAgLy8gc291cmNlIHZlcnNjaHdpbmRldCBhdXMgZGVyIFRZUC1MaXN0ZSBzYW10IGVpZ2VuZXIgRWluc3RlbGx1bmdlbiAodGFyZ2V0XHJcbiAgLy8gYmVoXHUwMEU0bHQgc2VpbmUpLiBEaWUgU3VidHlwZW4gdm9uIHNvdXJjZSB3ZXJkZW4gXHUwMEZDYmVybm9tbWVuLCBnbGVpY2huYW1pZ2VcclxuICAvLyBCbFx1MDBGNmNrZSB6dXNhbW1lbmdlZlx1MDBGQ2hydCAoc2llaGUgbWVyZ2VUeXBlU3VidHlwZXMgaW4gc3VidHlwZXMuanMpLlxyXG4gIGFzeW5jIG1lcmdlVHlwZShzb3VyY2UsIHRhcmdldCkge1xyXG4gICAgY29uc3Qgc2V0dGluZ3MgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncztcclxuICAgIGNvbnN0IHJlbmFtZWQgPSBhd2FpdCByZW5hbWVUeXBlSW5Ob3Rlcyh0aGlzLnBsdWdpbiwgc291cmNlLCB0YXJnZXQpO1xyXG5cclxuICAgIHNldHRpbmdzLnR5cGVzID0gc2V0dGluZ3MudHlwZXMuZmlsdGVyKCh0KSA9PiB0ICE9PSBzb3VyY2UpO1xyXG4gICAgZGVsZXRlIHNldHRpbmdzLnR5cGVDb2xvcnNbc291cmNlXTtcclxuICAgIGRlbGV0ZSBzZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3NvdXJjZV07XHJcbiAgICBkZWxldGUgc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlcltzb3VyY2VdO1xyXG4gICAgZGVsZXRlIHNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbc291cmNlXTtcclxuICAgIGRlbGV0ZSBzZXR0aW5ncy50eXBlU2hvcnRjdXRzW3NvdXJjZV07XHJcbiAgICBkZWxldGUgdGhpcy5lbnN1cmVUeXBlTWFudWFsKClbc291cmNlXTtcclxuICAgIG1lcmdlVHlwZVN1YnR5cGVzKHNldHRpbmdzLCBzb3VyY2UsIHRhcmdldCk7XHJcblxyXG4gICAgLy8gVm9yIHJlZnJlc2hUeXBDb2xvcnMoKSBzZXR6ZW4sIGF1cyBkZW1zZWxiZW4gR3J1bmQgd2llIGluIGFwcGx5UmVuYW1lLlxyXG4gICAgdGhpcy5zZWxlY3RlZFR5cGUgPSB0YXJnZXQ7XHJcbiAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgbmV3IE5vdGljZShgVFlQICR7c291cmNlfSBtaXQgJHt0YXJnZXR9IHp1c2FtbWVuZ2VsZWd0LCAke3JlbmFtZWR9IE5vdGl6KGVuKSBhbmdlcGFzc3QuYCk7XHJcbiAgICB0aGlzLnJlbmRlcigpO1xyXG4gIH1cclxuXHJcbiAgcmVuZGVyQ291bnRGbGFpcihzZWxmLCBjb3VudCkge1xyXG4gICAgY29uc3QgZmxhaXJPdXRlciA9IHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1mbGFpci1vdXRlclwiIH0pO1xyXG4gICAgZmxhaXJPdXRlci5jcmVhdGVTcGFuKHsgY2xzOiBcInRyZWUtaXRlbS1mbGFpclwiLCB0ZXh0OiBTdHJpbmcoY291bnQpIH0pO1xyXG4gIH1cclxuXHJcbiAgLy8gUmVpbiBpbmZvcm1hdGl2LCB1bnRlciBkZW0gVFlQLUZyb250bWF0dGVyLUVkaXRvcjogZXJrbFx1MDBFNHJ0IGRlblxyXG4gIC8vIEZsb2F0aW5nLVByb3BlcnR5LVRvZ2dsZSAoUmVjaHRza2xpY2sgYXVmIGVpbmUgUHJvcGVydHkgb2Jlbiwgc2llaGVcclxuICAvLyBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaCBpbiB0eXBlLWZyb250bWF0dGVyLWVkaXRvci5qcykuIEJld3Vzc3Qgb2huZSBlaWdlbmVcclxuICAvLyBcdTAwRENiZXJzY2hyaWZ0LCBkYSBkaXJla3QgdW50ZXIgZGVyIFByb3BlcnR5LUxpc3RlIG9obmVoaW4ga2xhciBpc3QsIHdvcmF1ZlxyXG4gIC8vIHNpY2ggZGVyIEhpbndlaXMgYmV6aWVodC5cclxuICAvL1xyXG4gIC8vIEhpZXIgc3RhbmQgZnJcdTAwRkNoZXIgenVzXHUwMEU0dHpsaWNoIGVpbmUgZmVzdGUgTGlzdGUgZGVyIFBsYXR6aGFsdGVyLVRva2VuLiBEaWVcclxuICAvLyBpc3QgbWl0IGRlbSBTaG9ydGN1dC1Lbm9wZiBqZSBQcm9wZXJ0eS1aZWlsZSBlbnRmYWxsZW46IGRlc3NlbiBBdXN3YWhsXHJcbiAgLy8gKHNob3J0Y3V0LXBpY2tlci5qcykgZlx1MDBGQ2hydCBkaWVzZWxiZW4gVG9rZW4sIGFiZXIgYW0gT3J0IGRlciBWZXJ3ZW5kdW5nLFxyXG4gIC8vIGR1cmNoc3VjaGJhciB1bmQgYmVpIFNrcmlwdGVuIHNhbXQgZGVyZW4gZWlnZW5lciBCZXNjaHJlaWJ1bmcuXHJcbiAgcmVuZGVyRmxvYXRpbmdIaW50KHBhcmVudCkge1xyXG4gICAgY29uc3Qgc2VjdGlvbiA9IHBhcmVudC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZmxvYXRpbmctaGludC1zZWN0aW9uXCIgfSk7XHJcbiAgICBzZWN0aW9uLmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJmcmVkLXR5cC1mbG9hdGluZy1oaW50XCIsXHJcbiAgICAgIHRleHQ6IFwiWW91IGNhbiBjaGFuZ2UgYSBwcm9wZXJ0eSB0byBmbG9hdGluZyBpbiB0aGUgcmlnaHQtY2xpY2sgbWVudS5cIixcclxuICAgIH0pO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gcmVnaXN0ZXJUeXBWaWV3KHBsdWdpbikge1xyXG4gIHBsdWdpbi5yZWdpc3RlclZpZXcoVklFV19UWVBFX1RZUCwgKGxlYWYpID0+IG5ldyBUeXBWaWV3KGxlYWYsIHBsdWdpbikpO1xyXG5cclxuICBwbHVnaW4uYWRkQ29tbWFuZCh7XHJcbiAgICBpZDogXCJ0eXAtdmlldy1vZWZmbmVuXCIsXHJcbiAgICBuYW1lOiBcIlRZUC1WaWV3IFx1MDBGNmZmbmVuXCIsXHJcbiAgICBjYWxsYmFjazogKCkgPT4gYWN0aXZhdGVUeXBWaWV3KHBsdWdpbiksXHJcbiAgfSk7XHJcblxyXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcclxuICAgIGlkOiBcInR5cC1wcm9wZXJ0eS1oaW56dWZ1ZWdlblwiLFxyXG4gICAgbmFtZTogXCJUWVAtUHJvcGVydHkgaGluenVmXHUwMEZDZ2VuXCIsXHJcbiAgICBjYWxsYmFjazogKCkgPT4gYWRkVHlwUHJvcGVydHlDb21tYW5kKHBsdWdpbiksXHJcbiAgfSk7XHJcblxyXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcclxuICAgIGlkOiBcInR5cC1oaW56dWZ1ZWdlblwiLFxyXG4gICAgbmFtZTogXCJOZXVlbiBUWVAgaGluenVmXHUwMEZDZ2VuXCIsXHJcbiAgICBjYWxsYmFjazogKCkgPT4gYWRkVHlwQ29tbWFuZChwbHVnaW4pLFxyXG4gIH0pO1xyXG5cclxuICAvLyBCZWltIEhvdC1SZWxvYWQgYmxlaWJ0IGRlciBhbHRlIExlYWYgYWxzIE9iamVrdCB1bmFuZ2V0YXN0ZXQgYmVzdGVoZW4gKG51clxyXG4gIC8vIHVuc2VyIFBsdWdpbi1Nb2R1bCB3aXJkIG5ldSBnZWxhZGVuKSwgYWJlciBcImluc3RhbmNlb2YgVHlwVmlld1wiIHNjaGxcdTAwRTRndCBnZWdlblxyXG4gIC8vIGRpZSBuZXUgZ2VsYWRlbmUgS2xhc3NlIGZlaGwuIGFwcC5qcyBzZWxic3QgYmVzdGltbXQgZ2V0Vmlld1R5cGUoKSByZWluIGF1c1xyXG4gIC8vIGxlYWYudmlldyAtIGRhcyByZWljaHQgenVyIEVya2VubnVuZyBhbHNvIG5pY2h0LiBhcHAgc2VsYnN0IFx1MDBGQ2JlcmxlYnQgZGVuXHJcbiAgLy8gSG90LVJlbG9hZCBkYWdlZ2VuIHVudmVyXHUwMEU0bmRlcnQsIGRhaGVyIGRpZSBMZWFmLVJlZmVyZW56IGRpcmVrdCBkb3J0IGFibGVnZW4uXHJcbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiBhY3RpdmF0ZVR5cFZpZXcocGx1Z2luLCBmYWxzZSwgZmFsc2UpKTtcclxuXHJcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IHtcclxuICAgIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoVklFV19UWVBFX1RZUCkpIHtcclxuICAgICAgbGVhZi52aWV3Py5yZW5kZXI/LigpO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIC8vIFpcdTAwRTRobGVyIChMaXN0ZSB1bmQgUGlja2VyLCBzaWVoZSB0eXBJbmRleC50eXBlQ291bnRzKCkpIHNvbnN0IG51ciBzbyBha3R1ZWxsXHJcbiAgLy8gd2llIGJlaW0gbGV0enRlbiBSZW5kZXIgZGllc2VyIFZpZXcgLSBqZWRlIFRZUC1yZWxldmFudGUgXHUwMEM0bmRlcnVuZyBhbmRlcnN3b1xyXG4gIC8vIChuZXVlL2dlbFx1MDBGNnNjaHRlIE5vdGl6LCBUWVAgb2RlciBTVUJUWVAgdW1nZXRyYWdlbikgbGllXHUwMERGZSBzaWUgc29uc3QgdmVyYWx0ZW4sXHJcbiAgLy8gYmlzIGlyZ2VuZGVpbiBhbmRlcmVyIEdydW5kICh6LiBCLiBlaW5lIEVpbnN0ZWxsdW5nKSB6dWZcdTAwRTRsbGlnIGVpbmVuIFJlZnJlc2hcclxuICAvLyBhdXNsXHUwMEY2c3QuIERhcyBcImNoYW5nZVwiLUV2ZW50IGRlcyBJbmRleCBmZXVlcnQgbnVyIGJlaSBnZW5hdSBzb2xjaGVuXHJcbiAgLy8gXHUwMEM0bmRlcnVuZ2VuLCBuaWNodCBiZWkgamVkZW0gQXV0b3NhdmUtVGljay4gVHJvdHpkZW0gZGVib3VuY2VkLCBkYSBkYXNcclxuICAvLyBSZW5kZXJuIGRlciBMaXN0ZSB2ZXJnbGVpY2hzd2Vpc2UgdGV1ZXIgaXN0IC0gcmVzZXRUaW1lcjp0cnVlIHNhbW1lbHQgZWluZVxyXG4gIC8vIFx1MDBDNG5kZXJ1bmdzc2VyaWUgKHouIEIuIEJ1bGstSW1wb3J0KSB6dSBlaW5lbSBlaW56aWdlbiBSZWZyZXNoLlxyXG4gIGNvbnN0IGRlYm91bmNlZFJlZnJlc2ggPSBkZWJvdW5jZShyZWZyZXNoLCA1MDAsIHRydWUpO1xyXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCBkZWJvdW5jZWRSZWZyZXNoKSk7XHJcbiAgLy8gXHUwMEM0bmRlcnQgZGllIFwiRXhjbHVkZWQgZmlsZXNcIi1MaXN0ZSBzZWxic3QgKHouIEIuIEhpZGUgRm9sZGVycyBiZWltIEF1cy0vXHJcbiAgLy8gRWluYmxlbmRlbiBlaW5lcyBPcmRuZXJzKSAtIE9ic2lkaWFucyBlaWdlbmVyIE1ldGFkYXRhQ2FjaGUgbGF1c2NodCBpbnRlcm5cclxuICAvLyBlYmVuZmFsbHMgZ2VuYXUgYXVmIGRpZXNlcyBFdmVudCwgdW0gc2VpbmUgSWdub3JlLUZpbHRlciBuZXUgenUgbGFkZW4uXHJcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC52YXVsdC5vbihcImNvbmZpZy1jaGFuZ2VkXCIsIGRlYm91bmNlZFJlZnJlc2gpKTtcclxuXHJcbiAgLy8gRlx1MDBGQ3IgcGx1Z2luLnJlZnJlc2hUeXBDb2xvcnMgKHouIEIuIG5hY2ggVW1zY2hhbHRlbiBkZXIgXCJUWVAtTGlzdGVcclxuICAvLyBlaW5mXHUwMEU0cmJlblwiLUVpbnN0ZWxsdW5nKSAtIHJlbmRlcnQgZGllIExpc3RlIChiencuIGJsZWlidCBpbiBkZXJcclxuICAvLyBEZXRhaWxhbnNpY2h0LCByZW5kZXIoKSBicmFuY2gndCBzZWxic3QpIG5ldS5cclxuICByZXR1cm4gcmVmcmVzaDtcclxufVxyXG5cclxuLy8gY3JlYXRlSWZNaXNzaW5nOiBmYWxzZSBiZWltIGF1dG9tYXRpc2NoZW4gb25MYXlvdXRSZWFkeS1BdWZydWYgKHNpZWhlXHJcbi8vIHJlZ2lzdGVyVHlwVmlldykgLSBkZXIgc29sbCBhdXNzY2hsaWVcdTAwREZsaWNoIGVpbmVuIGJlaW0gSG90LVJlbG9hZCB2ZXJ3YWlzdGVuLFxyXG4vLyBhYmVyIGJlcmVpdHMgdm9yaGFuZGVuZW4gTGVhZiB3aWVkZXJ2ZXJiaW5kZW4gKHNpZWhlIEtvbW1lbnRhciBkb3J0KSwgbmljaHRcclxuLy8gYmVpIGplZGVtIHJlZ3VsXHUwMEU0cmVuIE9ic2lkaWFuLVN0YXJ0IHVuY29uZGl0aW9uYWwgZWluZW4gbmV1ZW4gTGVhZiBlcnpldWdlblxyXG4vLyB1bmQgYWt0aXZpZXJlbi4gV2FyIGRpZSBUWVAtUGFuZSBiZWltIGxldHp0ZW4gQmVlbmRlbiBnZXNjaGxvc3NlbiAob2RlclxyXG4vLyBlaW5lbSBmcmlzY2hlbiBWYXVsdCksIGJsZWlidCBzaWUgb2huZSBkaWVzZSBVbnRlcnNjaGVpZHVuZyBzb25zdCBhdWNoIHp1LlxyXG5hc3luYyBmdW5jdGlvbiBhY3RpdmF0ZVR5cFZpZXcocGx1Z2luLCByZXZlYWwgPSB0cnVlLCBjcmVhdGVJZk1pc3NpbmcgPSB0cnVlKSB7XHJcbiAgY29uc3QgYXBwID0gcGx1Z2luLmFwcDtcclxuICBjb25zdCB7IHdvcmtzcGFjZSB9ID0gYXBwO1xyXG5cclxuICBjb25zdCBjYW5kaWRhdGVzID0gW107XHJcbiAgd29ya3NwYWNlLml0ZXJhdGVBbGxMZWF2ZXMoKGxlYWYpID0+IHtcclxuICAgIGlmIChsZWFmID09PSBhcHAuX19mcmVkVHlwTGVhZiB8fCAobGVhZi52aWV3ICYmIGxlYWYudmlldy5nZXRWaWV3VHlwZSgpID09PSBWSUVXX1RZUEVfVFlQKSkge1xyXG4gICAgICBjYW5kaWRhdGVzLnB1c2gobGVhZik7XHJcbiAgICB9XHJcbiAgfSk7XHJcblxyXG4gIGxldCBsZWFmID0gY2FuZGlkYXRlcy5zaGlmdCgpID8/IG51bGw7XHJcbiAgZm9yIChjb25zdCBleHRyYSBvZiBjYW5kaWRhdGVzKSBleHRyYS5kZXRhY2goKTtcclxuXHJcbiAgaWYgKCFsZWFmKSB7XHJcbiAgICBpZiAoIWNyZWF0ZUlmTWlzc2luZykgcmV0dXJuO1xyXG4gICAgbGVhZiA9IHdvcmtzcGFjZS5nZXRMZWZ0TGVhZihmYWxzZSk7XHJcbiAgICBhd2FpdCBsZWFmLnNldFZpZXdTdGF0ZSh7IHR5cGU6IFZJRVdfVFlQRV9UWVAsIGFjdGl2ZTogdHJ1ZSB9KTtcclxuICB9IGVsc2UgaWYgKCEobGVhZi52aWV3IGluc3RhbmNlb2YgVHlwVmlldykpIHtcclxuICAgIC8vIGFjdGl2ZTogZmFsc2UgLSByZWluZXMgV2llZGVydmVyYmluZGVuIG5hY2ggSG90LVJlbG9hZCAoc2llaGUgS29tbWVudGFyXHJcbiAgICAvLyBvYmVuIGFuIGFjdGl2YXRlVHlwVmlldyksIGRlciBMZWFmIGlzdCBqYSBiZXJlaXRzIHZvcmhhbmRlbi9zaWNodGJhci5cclxuICAgIC8vIE1pdCBhY3RpdmU6IHRydWUgd1x1MDBGQ3JkZSBqZWRlciBQbHVnaW4tUmVsb2FkIChuaWNodCBudXIgZWluIEFwcC1OZXVzdGFydClcclxuICAgIC8vIGRlbiBnbG9iYWxlbiBGb2t1cyBhdWYgZGllIFRZUC1QYW5lIHJlaVx1MDBERmVuIC0gb25MYXlvdXRSZWFkeSgpIGZldWVydFxyXG4gICAgLy8gc2VpbmVuIENhbGxiYWNrIHNvZm9ydCwgc29iYWxkIHdvcmtzcGFjZS5sYXlvdXRSZWFkeSBlaW5tYWwgdHJ1ZSBpc3QsXHJcbiAgICAvLyBhbHNvIGJlaSBqZWRlbSBlaW56ZWxuZW4gSG90LVJlbG9hZCB3XHUwMEU0aHJlbmQgZGVyIEVudHdpY2tsdW5nIGVybmV1dC5cclxuICAgIGF3YWl0IGxlYWYuc2V0Vmlld1N0YXRlKHsgdHlwZTogVklFV19UWVBFX1RZUCwgYWN0aXZlOiBmYWxzZSB9KTtcclxuICB9XHJcblxyXG4gIGFwcC5fX2ZyZWRUeXBMZWFmID0gbGVhZjtcclxuICBpZiAocmV2ZWFsKSB3b3Jrc3BhY2UucmV2ZWFsTGVhZihsZWFmKTtcclxufVxyXG5cclxuLy8gVm9ycmFuZ2lnIGluIGRlciBiZXJlaXRzIG9mZmVuZW4gVFlQLURldGFpbGFuc2ljaHQgKGRhbm4gZXhha3Qgd2llIGRlclxyXG4vLyBkb3J0aWdlICstQnV0dG9uKSwgc29uc3Qgd2lyZCBkaWUgRGV0YWlsYW5zaWNodCBmXHUwMEZDciBkZW4gVFlQIGRlciBha3RpdmVuXHJcbi8vIE5vdGl6IGdlXHUwMEY2ZmZuZXQgdW5kIGRpZSBQcm9wZXJ0eSBkb3J0IGVyZ1x1MDBFNG56dC4gSXN0IGtlaW5lIE5vdGl6IG9mZmVuIG9kZXJcclxuLy8gaGF0IHNpZSBrZWluZW4gVFlQLCBkaWVudCBlaW5lIHp3YXIgbmljaHQgZm9rdXNzaWVydGUsIGFiZXIgaW4gZGVyXHJcbi8vIERldGFpbGFuc2ljaHQgb2ZmZW5lIFRZUC1WaWV3IGFscyBSXHUwMEZDY2tmYWxsZWJlbmUuIElzdCBudXIgZGllIFRZUGVuLUxpc3RlXHJcbi8vIG9mZmVuIChrZWluIHNlbGVjdGVkVHlwZSksIHpcdTAwRTRobHQgZGFzIG5pY2h0IGFscyBcIm9mZmVuZSBEZXRhaWxhbnNpY2h0XCIgLVxyXG4vLyBkYWZcdTAwRkNyIGZlaGx0IGRvcnQgZWluIEZyb250bWF0dGVyLUVkaXRvciwgYW4gZGVtIHNpY2ggZXR3YXMgaGluenVmXHUwMEZDZ2VuIGxpZVx1MDBERmUuXHJcbmFzeW5jIGZ1bmN0aW9uIGFkZFR5cFByb3BlcnR5Q29tbWFuZChwbHVnaW4pIHtcclxuICBjb25zdCBhcHAgPSBwbHVnaW4uYXBwO1xyXG5cclxuICBjb25zdCBhY3RpdmVUeXBWaWV3ID0gYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKFR5cFZpZXcpO1xyXG4gIGlmIChhY3RpdmVUeXBWaWV3ICYmIGFjdGl2ZVR5cFZpZXcuc2VsZWN0ZWRUeXBlICE9PSBudWxsKSB7XHJcbiAgICBhY3RpdmVUeXBWaWV3LmZyb250bWF0dGVyQmxvY2tzPy5hZGRCbGFuayhudWxsKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcblxyXG4gIGNvbnN0IGZpbGUgPSBhcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcclxuICBjb25zdCB0eXBlID0gcGx1Z2luLnR5cEluZGV4LnR5cGVPZihmaWxlKTtcclxuICBpZiAoIXR5cGUpIHtcclxuICAgIGNvbnN0IG9wZW5MZWFmID0gYXBwLndvcmtzcGFjZVxyXG4gICAgICAuZ2V0TGVhdmVzT2ZUeXBlKFZJRVdfVFlQRV9UWVApXHJcbiAgICAgIC5maW5kKChsZWFmKSA9PiBsZWFmLnZpZXcgaW5zdGFuY2VvZiBUeXBWaWV3ICYmIGxlYWYudmlldy5zZWxlY3RlZFR5cGUgIT09IG51bGwpO1xyXG4gICAgaWYgKG9wZW5MZWFmKSB7XHJcbiAgICAgIGF3YWl0IGFwcC53b3Jrc3BhY2UucmV2ZWFsTGVhZihvcGVuTGVhZik7XHJcbiAgICAgIG9wZW5MZWFmLnZpZXcuZnJvbnRtYXR0ZXJCbG9ja3M/LmFkZEJsYW5rKG51bGwpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBuZXcgTm90aWNlKGZpbGUgPyBcIkFrdGl2ZSBOb3RpeiBoYXQga2VpbmVuIFRZUCB1bmQgaW4gZGVyIFRZUC1WaWV3IGlzdCBrZWluIFRZUCBnZVx1MDBGNmZmbmV0LlwiIDogXCJLZWluZSBOb3RpeiBvZmZlbiB1bmQgaW4gZGVyIFRZUC1WaWV3IGlzdCBrZWluIFRZUCBnZVx1MDBGNmZmbmV0LlwiKTtcclxuICAgIHJldHVybjtcclxuICB9XHJcblxyXG4gIGF3YWl0IGFjdGl2YXRlVHlwVmlldyhwbHVnaW4pO1xyXG4gIGNvbnN0IHZpZXcgPSBhcHAuX19mcmVkVHlwTGVhZj8udmlldztcclxuICBpZiAoISh2aWV3IGluc3RhbmNlb2YgVHlwVmlldykpIHJldHVybjtcclxuICB2aWV3Lm9wZW5UeXBlU2V0dGluZ3ModHlwZSk7XHJcbiAgdmlldy5mcm9udG1hdHRlckJsb2Nrcz8uYWRkQmxhbmsobnVsbCk7XHJcbn1cclxuXHJcbi8vIFx1MDBENmZmbmV0IGJlaSBCZWRhcmYgZXJzdCBkaWUgVFlQLVZpZXcgKGJ6dy4gdmVybFx1MDBFNHNzdCBlaW5lIG9mZmVuZSBEZXRhaWxhbnNpY2h0XHJcbi8vIHp1clx1MDBGQ2NrIHp1ciBMaXN0ZSAtIHN0YXJ0QWRkKCkgbGVndCBkYXMgbmV1ZSBUcmVlLUl0ZW0gaW4gdGhpcy5saXN0RWwgYW4sIGRhc1xyXG4vLyBlcyBudXIgaW4gZGVyIExpc3RlbmFuc2ljaHQgZ2lidCksIHVuZCBzdFx1MDBGNlx1MDBERnQgZG9ydCBkZW5zZWxiZW4gQWJsYXVmIHdpZSBkZXJcclxuLy8gKy1CdXR0b24gaW0gTGlzdGVuLUhlYWRlciBhbi5cclxuYXN5bmMgZnVuY3Rpb24gYWRkVHlwQ29tbWFuZChwbHVnaW4pIHtcclxuICBhd2FpdCBhY3RpdmF0ZVR5cFZpZXcocGx1Z2luKTtcclxuICBjb25zdCB2aWV3ID0gcGx1Z2luLmFwcC5fX2ZyZWRUeXBMZWFmPy52aWV3O1xyXG4gIGlmICghKHZpZXcgaW5zdGFuY2VvZiBUeXBWaWV3KSkgcmV0dXJuO1xyXG4gIGlmICh2aWV3LnNlbGVjdGVkVHlwZSAhPT0gbnVsbCkgdmlldy5jbG9zZVR5cGVTZXR0aW5ncygpO1xyXG4gIHZpZXcuc3RhcnRBZGQoKTtcclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyVHlwVmlldywgVklFV19UWVBFX1RZUCwgY29tcGFyZVR5cGVzLCBzb3J0VHlwZXNCeU1vZGUsIERFRkFVTFRfU09SVF9PUkRFUiwgREVGQVVMVF9UWVBFX0NPTE9SIH07XHJcbiIsICJjb25zdCB7IFRGaWxlLCBURm9sZGVyIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IGNvbG9yRm9yRmlsZSB9ID0gcmVxdWlyZShcIi4vdHlwZS1jb2xvcnNcIik7XG5cbmNvbnN0IEZJTEVfRVhQTE9SRVJfVklFV19UWVBFID0gXCJmaWxlLWV4cGxvcmVyXCI7XG5jb25zdCBGT0xERVJfTk9URVNfUExVR0lOX0lEID0gXCJmb2xkZXItbm90ZXNcIjtcblxuLy8gRGFzIFwiRm9sZGVyIE5vdGVzXCItUGx1Z2luIHplaWd0IGVpbmUgTm90aXogc3RhdHQgYWxzIGVpZ2VuZSBaZWlsZSBhbHMgT3JkbmVyIGFuLlxuLy8gRXMgaGF0IGtlaW5lIFx1MDBGNmZmZW50bGljaGUgQVBJIGRhZlx1MDBGQ3IsIGRhaGVyIGRlbiBEYXRlaW5hbWVuIGF1cyBzZWluZW4gZWlnZW5lblxuLy8gKExpdmUtKUVpbnN0ZWxsdW5nZW4gbmFjaGJhdWVuLCBzdGF0dCBzZWluZSBpbnRlcm5lbiBGdW5rdGlvbmVuIGFuenV6YXBmZW4uXG5mdW5jdGlvbiBnZXRGb2xkZXJOb3RlRmlsZShwbHVnaW4sIGZvbGRlcikge1xuICBjb25zdCBmb2xkZXJOb3RlcyA9IHBsdWdpbi5hcHAucGx1Z2lucy5wbHVnaW5zW0ZPTERFUl9OT1RFU19QTFVHSU5fSURdO1xuICBjb25zdCBzZXR0aW5ncyA9IGZvbGRlck5vdGVzPy5zZXR0aW5ncztcbiAgaWYgKCFzZXR0aW5ncykgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgZmlsZU5hbWUgPVxuICAgIChzZXR0aW5ncy5mb2xkZXJOb3RlTmFtZSB8fCBcInt7Zm9sZGVyX25hbWV9fVwiKS5yZXBsYWNlKFwie3tmb2xkZXJfbmFtZX19XCIsIGZvbGRlci5uYW1lKSArXG4gICAgKHNldHRpbmdzLmZvbGRlck5vdGVUeXBlIHx8IFwiLm1kXCIpO1xuICBjb25zdCBkaXJQYXRoID0gc2V0dGluZ3Muc3RvcmFnZUxvY2F0aW9uID09PSBcInBhcmVudEZvbGRlclwiID8gZm9sZGVyLnBhcmVudD8ucGF0aCA/PyBcIlwiIDogZm9sZGVyLnBhdGg7XG4gIGNvbnN0IHBhdGggPSBkaXJQYXRoID8gYCR7ZGlyUGF0aH0vJHtmaWxlTmFtZX1gIDogZmlsZU5hbWU7XG5cbiAgY29uc3QgZmlsZSA9IHBsdWdpbi5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHBhdGgpO1xuICByZXR1cm4gZmlsZSBpbnN0YW5jZW9mIFRGaWxlID8gZmlsZSA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIGFwcGx5Q29sb3JUb1RpdGxlKHBsdWdpbiwgdGl0bGVFbCwgZmlsZSkge1xuICBjb25zdCBjb250ZW50RWwgPSB0aXRsZUVsLnF1ZXJ5U2VsZWN0b3IoXCIubmF2LWZpbGUtdGl0bGUtY29udGVudCwgLm5hdi1mb2xkZXItdGl0bGUtY29udGVudFwiKTtcbiAgaWYgKCFjb250ZW50RWwpIHJldHVybjtcblxuICBjb25zdCBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmZpbGVFeHBsb3JlciA/IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIFwiZmlsZUV4cGxvcmVyXCIpIDogbnVsbDtcbiAgaWYgKGNvbG9yKSBjb250ZW50RWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcbiAgZWxzZSBjb250ZW50RWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcbn1cblxuZnVuY3Rpb24gYXBwbHlGaWxlRXhwbG9yZXJDb2xvcnMocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoRklMRV9FWFBMT1JFUl9WSUVXX1RZUEUpKSB7XG4gICAgY29uc3QgZmlsZVRpdGxlRWxzID0gbGVhZi52aWV3LmNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIubmF2LWZpbGUtdGl0bGVbZGF0YS1wYXRoXVwiKTtcbiAgICBmb3IgKGNvbnN0IHRpdGxlRWwgb2YgZmlsZVRpdGxlRWxzKSB7XG4gICAgICBjb25zdCBmaWxlID0gcGx1Z2luLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgodGl0bGVFbC5nZXRBdHRyaWJ1dGUoXCJkYXRhLXBhdGhcIikpO1xuICAgICAgYXBwbHlDb2xvclRvVGl0bGUocGx1Z2luLCB0aXRsZUVsLCBmaWxlIGluc3RhbmNlb2YgVEZpbGUgPyBmaWxlIDogbnVsbCk7XG4gICAgfVxuXG4gICAgY29uc3QgZm9sZGVyVGl0bGVFbHMgPSBsZWFmLnZpZXcuY29udGFpbmVyRWwucXVlcnlTZWxlY3RvckFsbChcIi5uYXYtZm9sZGVyLXRpdGxlW2RhdGEtcGF0aF1cIik7XG4gICAgZm9yIChjb25zdCB0aXRsZUVsIG9mIGZvbGRlclRpdGxlRWxzKSB7XG4gICAgICBjb25zdCBmb2xkZXIgPSBwbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aCh0aXRsZUVsLmdldEF0dHJpYnV0ZShcImRhdGEtcGF0aFwiKSk7XG4gICAgICBjb25zdCBub3RlRmlsZSA9IGZvbGRlciBpbnN0YW5jZW9mIFRGb2xkZXIgPyBnZXRGb2xkZXJOb3RlRmlsZShwbHVnaW4sIGZvbGRlcikgOiBudWxsO1xuICAgICAgYXBwbHlDb2xvclRvVGl0bGUocGx1Z2luLCB0aXRsZUVsLCBub3RlRmlsZSk7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyRmlsZUV4cGxvcmVyQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlGaWxlRXhwbG9yZXJDb2xvcnMocGx1Z2luKTtcblxuICAvLyBEZXIgRmlsZS1FeHBsb3JlciByZW5kZXJ0IEVpbnRyXHUwMEU0Z2UgYmVpbSBBdWYtL1p1a2xhcHBlbiB2b24gT3JkbmVybiBkeW5hbWlzY2hcbiAgLy8gbmV1IC0gcGVyIE11dGF0aW9uT2JzZXJ2ZXIgYXVmIG5ldSBlaW5nZWZcdTAwRkNndGUgRWxlbWVudGUgcmVhZ2llcmVuLCBzdGF0dCBudXJcbiAgLy8gZWlubWFsaWcgYmVpbSBTdGFydCBlaW56dWZcdTAwRTRyYmVuLlxuICBjb25zdCBvYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKHJlZnJlc2gpO1xuICBjb25zdCBvYnNlcnZlRXhwbG9yZXJMZWF2ZXMgPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShGSUxFX0VYUExPUkVSX1ZJRVdfVFlQRSkpIHtcbiAgICAgIG9ic2VydmVyLm9ic2VydmUobGVhZi52aWV3LmNvbnRhaW5lckVsLCB7IGNoaWxkTGlzdDogdHJ1ZSwgc3VidHJlZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiBvYnNlcnZlci5kaXNjb25uZWN0KCkpO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAudmF1bHQub24oXCJyZW5hbWVcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgb2JzZXJ2ZUV4cGxvcmVyTGVhdmVzKCk7XG4gICAgICByZWZyZXNoKCk7XG4gICAgfSlcbiAgKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICBvYnNlcnZlRXhwbG9yZXJMZWF2ZXMoKTtcbiAgICByZWZyZXNoKCk7XG4gIH0pO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJGaWxlRXhwbG9yZXJDb2xvcnMgfTtcbiIsICJjb25zdCB7IGNvbG9yRm9yRmlsZSB9ID0gcmVxdWlyZShcIi4vdHlwZS1jb2xvcnNcIik7XG5cbmNvbnN0IEdSQVBIX1ZJRVdfVFlQRVMgPSBbXCJncmFwaFwiLCBcImxvY2FsZ3JhcGhcIl07XG5cbmZ1bmN0aW9uIGhleFRvSW50KGhleCkge1xuICByZXR1cm4gcGFyc2VJbnQoaGV4LnJlcGxhY2UoXCIjXCIsIFwiXCIpLCAxNik7XG59XG5cbi8vIGVuZ2luZS5yZW5kZXIoKSBsaWVzdCBzZWluIGludGVybmVzIGZpbGVGaWx0ZXItT2JqZWt0IG51ciBhdXMsIHdlbm4gYmVyZWl0c1xuLy8gbWluZGVzdGVucyBlaW5lIGVpZ2VuZSBGYXJiZ3J1cHBlL0ZpbHRlci1RdWVyeSBha3RpdiBpc3QgLSBvaG5lIGVpZ2VuZSBHcnVwcGVuXG4vLyBiZWtvbW10IGplZGUgRGF0ZWkgcGF1c2NoYWwgY29sb3I6dHJ1ZSAoa2VpbiBGYXJid2VydCksIGZpbGVGaWx0ZXIgd2lyZCBnYXJcbi8vIG5pY2h0IGVyc3Qga29uc3VsdGllcnQuIFJvYnVzdGVyIGlzdCBkZXIgRWluZ3JpZmYgZGlyZWt0IGFuIHJlbmRlcmVyLnNldERhdGEsXG4vLyB1bm1pdHRlbGJhciBiZXZvciBkaWUgZmVydGlnZW4gTm9kZS1EYXRlbiBhbiBkZW4gV2ViR0wtUmVuZGVyZXIgZ2VoZW4gLSBhblxuLy8gZXhha3QgZGllc2VyIFN0ZWxsZSBwYXRjaHQgYXVjaCBkYXMgQ29tbXVuaXR5LVBsdWdpbiBcImdyYXBoLW5lc3RlZC10YWdzXCIuXG4vLyBFaWdlbmUgRmFyYmdydXBwZW4gaGFiZW4gZG9ydCBub2RlLmNvbG9yIGJlcmVpdHMgZ2VzZXR6dCB1bmQgYmxlaWJlbiB1bmFuZ2V0YXN0ZXQuXG5mdW5jdGlvbiBwYXRjaFJlbmRlcmVyKHBsdWdpbiwgcmVuZGVyZXIpIHtcbiAgaWYgKHJlbmRlcmVyLl9fZnJlZFR5cENvbG9yUGF0Y2hlZCkgcmV0dXJuO1xuICByZW5kZXJlci5fX2ZyZWRUeXBDb2xvclBhdGNoZWQgPSB0cnVlO1xuXG4gIGNvbnN0IG9yaWdpbmFsID0gcmVuZGVyZXIuc2V0RGF0YTtcbiAgcmVuZGVyZXIuc2V0RGF0YSA9IGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgZm9yIChjb25zdCBwYXRoIGluIGRhdGEubm9kZXMpIHtcbiAgICAgIGNvbnN0IG5vZGUgPSBkYXRhLm5vZGVzW3BhdGhdO1xuICAgICAgaWYgKG5vZGUuY29sb3IpIGNvbnRpbnVlO1xuXG4gICAgICBpZiAobm9kZS50eXBlID09PSBcInRhZ1wiKSB7XG4gICAgICAgIC8vIEVpZ2VuZSBUYWctRmFyYmUgZGVha3RpdmllcnQgKDMwLjA5LjIwMjYpOiBUYWctS25vdGVuIGxhc3NlbiBzaWNoIGltXG4gICAgICAgIC8vIE1pbmltYWwgVGhlbWUgYmVyZWl0cyBcdTAwRkNiZXIgZGllIFN0eWxlIFNldHRpbmdzIGVpbmZcdTAwRTRyYmVuIChHcmFwaHMgXHUyMTkyXG4gICAgICAgIC8vIFwiVGFnIG5vZGUgY29sb3JcIiksIGRhcyBoaWVyIHdhciBlaW5lIERvcHBsdW5nLiBEaWUgVFlQLUVpbmZcdTAwRTRyYnVuZyBkZXJcbiAgICAgICAgLy8gTm90aXotS25vdGVuIHVudGVuIGJsZWlidCwgZGllIGthbm4gU3R5bGUgU2V0dGluZ3MgbmljaHQuXG4gICAgICAgIC8vIGlmIChwbHVnaW4uc2V0dGluZ3MuZ3JhcGhUYWdDb2xvckVuYWJsZWQgJiYgcGx1Z2luLnNldHRpbmdzLmdyYXBoVGFnQ29sb3IpIHtcbiAgICAgICAgLy8gICBub2RlLmNvbG9yID0geyBhOiAxLCByZ2I6IGhleFRvSW50KHBsdWdpbi5zZXR0aW5ncy5ncmFwaFRhZ0NvbG9yKSB9O1xuICAgICAgICAvLyB9XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBmaWxlID0gcGx1Z2luLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgocGF0aCk7XG4gICAgICBsZXQgY29sb3IgPSBudWxsO1xuXG4gICAgICBpZiAoZmlsZSAmJiBmaWxlLmV4dGVuc2lvbiAhPT0gXCJtZFwiKSB7XG4gICAgICAgIC8vIEVpZ2VuZSBBbmhcdTAwRTRuZ2UtRmFyYmUgZGVha3RpdmllcnQgKDMwLjA5LjIwMjYpLCB3aWUgZGllIFRhZy1GYXJiZSBvYmVuOlxuICAgICAgICAvLyBTdHlsZSBTZXR0aW5ncyBkZXMgTWluaW1hbCBUaGVtZSwgR3JhcGhzIFx1MjE5MiBcIkF0dGFjaG1lbnQgbm9kZSBjb2xvclwiLlxuICAgICAgICAvLyBpZiAocGx1Z2luLnNldHRpbmdzLmdyYXBoQXR0YWNobWVudENvbG9yRW5hYmxlZCAmJiBwbHVnaW4uc2V0dGluZ3MuZ3JhcGhBdHRhY2htZW50Q29sb3IpIHtcbiAgICAgICAgLy8gICBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5ncmFwaEF0dGFjaG1lbnRDb2xvcjtcbiAgICAgICAgLy8gfVxuICAgICAgfSBlbHNlIGlmIChwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5ncmFwaCkge1xuICAgICAgICBjb2xvciA9IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIFwiZ3JhcGhcIik7XG4gICAgICB9XG5cbiAgICAgIGlmIChjb2xvcikgbm9kZS5jb2xvciA9IHsgYTogMSwgcmdiOiBoZXhUb0ludChjb2xvcikgfTtcbiAgICB9XG4gICAgcmV0dXJuIG9yaWdpbmFsLmNhbGwodGhpcywgZGF0YSk7XG4gIH07XG5cbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IHtcbiAgICByZW5kZXJlci5zZXREYXRhID0gb3JpZ2luYWw7XG4gICAgZGVsZXRlIHJlbmRlcmVyLl9fZnJlZFR5cENvbG9yUGF0Y2hlZDtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGdldEdyYXBoTGVhdmVzKGFwcCkge1xuICBjb25zdCBsZWF2ZXMgPSBbXTtcbiAgZm9yIChjb25zdCB0eXBlIG9mIEdSQVBIX1ZJRVdfVFlQRVMpIGxlYXZlcy5wdXNoKC4uLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKHR5cGUpKTtcbiAgcmV0dXJuIGxlYXZlcztcbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJHcmFwaENvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgZ2V0R3JhcGhMZWF2ZXMocGx1Z2luLmFwcCkpIHtcbiAgICAgIGlmIChsZWFmLnZpZXc/LnJlbmRlcmVyKSBwYXRjaFJlbmRlcmVyKHBsdWdpbiwgbGVhZi52aWV3LnJlbmRlcmVyKTtcbiAgICAgIC8vIERlciBnbG9iYWxlIEdyYXBoIGhcdTAwRTRsdCBzZWluZSBFbmdpbmUgaW4gdmlldy5kYXRhRW5naW5lLCBkZXIgbG9rYWxlIGluXG4gICAgICAvLyB2aWV3LmVuZ2luZSAtIG9obmUgZGVuIHp3ZWl0ZW4gRmFsbCBiZWthbSBlaW4gbG9rYWxlciBHcmFwaCBlaW5lXG4gICAgICAvLyBnZVx1MDBFNG5kZXJ0ZSBUWVAtRmFyYmUgZXJzdCBiZWltIG5cdTAwRTRjaHN0ZW4gZWlnZW5lbiBOZXVhdWZiYXUgenUgc2VoZW4uXG4gICAgICAobGVhZi52aWV3Py5kYXRhRW5naW5lID8/IGxlYWYudmlldz8uZW5naW5lKT8ucmVuZGVyKCk7XG4gICAgfVxuICB9O1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIC8vIE51ciBiZWkgdGF0c1x1MDBFNGNobGljaCBnZVx1MDBFNG5kZXJ0ZW0gVFlQIChzaWVoZSB0eXAtaW5kZXguanMpIC0gc29uc3QgemVpZ3RlIGRlclxuICAvLyBHcmFwaCBlaW5lIHVtZ2V0cmFnZW5lIEZhcmJlIGVyc3QgbmFjaCBkZW0gblx1MDBFNGNoc3RlbiBlaWdlbmVuIE5ldWF1ZmJhdS5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeShyZWZyZXNoKTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyR3JhcGhDb2xvcnMgfTtcbiIsICJjb25zdCB7IGNvbG9yRm9yRmlsZSB9ID0gcmVxdWlyZShcIi4vdHlwZS1jb2xvcnNcIik7XG5cbmNvbnN0IFNFQVJDSF9WSUVXX1RZUEUgPSBcInNlYXJjaFwiO1xuXG4vLyBFcmdlYm5pc3plaWxlbiBpbSBTZWFyY2ggVmlldyB0cmFnZW4ga2VpbiBkYXRhLXBhdGgtQXR0cmlidXQsIGFiZXIgZGllXG4vLyBTZWFyY2hWaWV3IHBmbGVndCBpbnRlcm4gZWluZSBNYXAgdm9uIFRGaWxlIC0+IEVyZ2VibmlzLURPTS1PYmpla3Rcbi8vIChkb20ucmVzdWx0RG9tTG9va3VwKSAtIGRhclx1MDBGQ2JlciBsXHUwMEU0c3N0IHNpY2ggRGF0ZWkgdW5kIFplaWxlIGRpcmVrdCB2ZXJiaW5kZW4uXG5mdW5jdGlvbiBhcHBseVNlYXJjaENvbG9ycyhwbHVnaW4pIHtcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShTRUFSQ0hfVklFV19UWVBFKSkge1xuICAgIGNvbnN0IHJlc3VsdERvbUxvb2t1cCA9IGxlYWYudmlldz8uZG9tPy5yZXN1bHREb21Mb29rdXA7XG4gICAgaWYgKCFyZXN1bHREb21Mb29rdXApIGNvbnRpbnVlO1xuXG4gICAgZm9yIChjb25zdCBbZmlsZSwgcmVzdWx0RG9tXSBvZiByZXN1bHREb21Mb29rdXApIHtcbiAgICAgIGNvbnN0IHRpdGxlRWwgPSByZXN1bHREb20uZWw/LnF1ZXJ5U2VsZWN0b3IoXCIuc2VhcmNoLXJlc3VsdC1maWxlLXRpdGxlIC50cmVlLWl0ZW0taW5uZXJcIik7XG4gICAgICBpZiAoIXRpdGxlRWwpIGNvbnRpbnVlO1xuXG4gICAgICBjb25zdCBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnNlYXJjaCA/IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIFwic2VhcmNoXCIpIDogbnVsbDtcbiAgICAgIGlmIChjb2xvcikgdGl0bGVFbC5zdHlsZS5jb2xvciA9IGNvbG9yO1xuICAgICAgZWxzZSB0aXRsZUVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiY29sb3JcIik7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyU2VhcmNoQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlTZWFyY2hDb2xvcnMocGx1Z2luKTtcblxuICAvLyBFcmdlYm5pc3NlIHdlcmRlbiBiZWkgamVkZXIgU3VjaGVpbmdhYmUga29tcGxldHQgbmV1IGF1ZmdlYmF1dC5cbiAgY29uc3Qgb2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcihyZWZyZXNoKTtcbiAgY29uc3Qgb2JzZXJ2ZUxlYXZlcyA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFNFQVJDSF9WSUVXX1RZUEUpKSB7XG4gICAgICBvYnNlcnZlci5vYnNlcnZlKGxlYWYudmlldy5jb250YWluZXJFbCwgeyBjaGlsZExpc3Q6IHRydWUsIHN1YnRyZWU6IHRydWUgfSk7XG4gICAgfVxuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4gb2JzZXJ2ZXIuZGlzY29ubmVjdCgpKTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgICAgcmVmcmVzaCgpO1xuICAgIH0pXG4gICk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgIHJlZnJlc2goKTtcbiAgfSk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlclNlYXJjaENvbG9ycyB9O1xuIiwgImNvbnN0IHsgY29sb3JGb3JGaWxlIH0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcblxuY29uc3QgUkVDRU5UX0ZJTEVTX1ZJRVdfVFlQRSA9IFwicmVjZW50LWZpbGVzXCI7XG5cbi8vIFJlY2VudCBGaWxlcyBzZXR6dCBrZWluIGRhdGEtcGF0aC1BdHRyaWJ1dCBhdWYgc2VpbmUgWmVpbGVuLiBFcyByZW5kZXJ0IHNlaW5lXG4vLyBMaXN0ZSBhYmVyIG9obmUgXHUwMEZDYmVyc3BydW5nZW5lIEVpbnRyXHUwMEU0Z2UgZGlyZWt0IGF1cyBkYXRhLnJlY2VudEZpbGVzLCBkYWhlclxuLy8gbFx1MDBFNHNzdCBzaWNoIGRpZSBaZWlsZSBcdTAwRkNiZXIgZGVuIEluZGV4IGVpbmRldXRpZyBkZW0gUGZhZCB6dW9yZG5lbi5cbmZ1bmN0aW9uIGFwcGx5UmVjZW50RmlsZXNDb2xvcnMocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoUkVDRU5UX0ZJTEVTX1ZJRVdfVFlQRSkpIHtcbiAgICBjb25zdCByZWNlbnRGaWxlcyA9IGxlYWYudmlldz8uZGF0YT8ucmVjZW50RmlsZXM7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHJlY2VudEZpbGVzKSkgY29udGludWU7XG5cbiAgICBjb25zdCB0aXRsZUVscyA9IGxlYWYudmlldy5jb250YWluZXJFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLnJlY2VudC1maWxlcy10aXRsZSAubmF2LWZpbGUtdGl0bGUtY29udGVudFwiKTtcbiAgICB0aXRsZUVscy5mb3JFYWNoKCh0aXRsZUVsLCBpbmRleCkgPT4ge1xuICAgICAgY29uc3QgZW50cnkgPSByZWNlbnRGaWxlc1tpbmRleF07XG4gICAgICBjb25zdCBmaWxlID0gZW50cnkgPyBwbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChlbnRyeS5wYXRoKSA6IG51bGw7XG4gICAgICBjb25zdCBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnJlY2VudEZpbGVzID8gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSwgXCJyZWNlbnRGaWxlc1wiKSA6IG51bGw7XG4gICAgICBpZiAoY29sb3IpIHRpdGxlRWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcbiAgICAgIGVsc2UgdGl0bGVFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImNvbG9yXCIpO1xuICAgIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyUmVjZW50RmlsZXNDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseVJlY2VudEZpbGVzQ29sb3JzKHBsdWdpbik7XG5cbiAgY29uc3Qgb2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcihyZWZyZXNoKTtcbiAgY29uc3Qgb2JzZXJ2ZUxlYXZlcyA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFJFQ0VOVF9GSUxFU19WSUVXX1RZUEUpKSB7XG4gICAgICBvYnNlcnZlci5vYnNlcnZlKGxlYWYudmlldy5jb250YWluZXJFbCwgeyBjaGlsZExpc3Q6IHRydWUsIHN1YnRyZWU6IHRydWUgfSk7XG4gICAgfVxuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4gb2JzZXJ2ZXIuZGlzY29ubmVjdCgpKTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgICAgcmVmcmVzaCgpO1xuICAgIH0pXG4gICk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgIHJlZnJlc2goKTtcbiAgfSk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlclJlY2VudEZpbGVzQ29sb3JzIH07XG4iLCAiY29uc3QgeyBjb2xvckZvckZpbGUgfSA9IHJlcXVpcmUoXCIuL3R5cGUtY29sb3JzXCIpO1xuXG5jb25zdCBCQUNLTElOS19WSUVXX1RZUEUgPSBcImJhY2tsaW5rXCI7XG5cbi8vIERhcyBCYWNrbGlua3MtUGFuZSAoU2VpdGVubGVpc3RlKSByZW5kZXJ0IFRyZWZmZXIgaW50ZXJuIFx1MDBGQ2JlciBkaWVzZWxiZVxuLy8gU2VhcmNoUmVzdWx0RG9tLUtsYXNzZSB3aWUgZGllIFN1Y2hlLiBWZXJsaW5rdGUgdW5kIG5pY2h0IHZlcmxpbmt0ZVxuLy8gRXJ3XHUwMEU0aG51bmdlbiBsaWVnZW4gYWxzIHp3ZWkgcmVzdWx0RG9tTG9va3VwLU1hcHMgaW0gQmFja2xpbmtSZW5kZXJlclxuLy8gKHZpZXcuYmFja2xpbmspIC0gRmVsZG5hbWVuIHNpbmQgbmljaHQgb2ZmaXppZWxsIGRva3VtZW50aWVydCwgZGFoZXJcbi8vIG1laHJlcmUgYmVrYW5udGUgUGZhZGUgcHJvYmllcmVuIHN0YXR0IGVpbmVuIGZlc3QgYW56dW5laG1lbi5cbmZ1bmN0aW9uIGdldFJlc3VsdERvbUxvb2t1cHModmlldykge1xuICBjb25zdCByZW5kZXJlciA9IHZpZXc/LmJhY2tsaW5rO1xuICBjb25zdCBjYW5kaWRhdGVzID0gW3JlbmRlcmVyPy5iYWNrbGlua0RvbSwgcmVuZGVyZXI/LnVubGlua2VkRG9tLCB2aWV3Py5iYWNrbGlua0RvbSwgdmlldz8udW5saW5rZWREb20sIHZpZXc/LmRvbV07XG5cbiAgY29uc3QgbG9va3VwcyA9IFtdO1xuICBmb3IgKGNvbnN0IGRvbSBvZiBjYW5kaWRhdGVzKSB7XG4gICAgaWYgKGRvbT8ucmVzdWx0RG9tTG9va3VwIGluc3RhbmNlb2YgTWFwKSBsb29rdXBzLnB1c2goZG9tLnJlc3VsdERvbUxvb2t1cCk7XG4gIH1cbiAgcmV0dXJuIGxvb2t1cHM7XG59XG5cbmZ1bmN0aW9uIGNvbG9yVGl0bGVFbChwbHVnaW4sIGVsLCBmaWxlKSB7XG4gIGNvbnN0IGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MuYmFja2xpbmtzID8gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSwgXCJiYWNrbGlua3NcIikgOiBudWxsO1xuICBpZiAoY29sb3IpIGVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gIGVsc2UgZWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcbn1cblxuZnVuY3Rpb24gYXBwbHlCYWNrbGlua1BhbmVDb2xvcnMocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoQkFDS0xJTktfVklFV19UWVBFKSkge1xuICAgIGZvciAoY29uc3QgbG9va3VwIG9mIGdldFJlc3VsdERvbUxvb2t1cHMobGVhZi52aWV3KSkge1xuICAgICAgZm9yIChjb25zdCBbZmlsZSwgcmVzdWx0RG9tXSBvZiBsb29rdXApIHtcbiAgICAgICAgY29uc3QgdGl0bGVFbCA9IHJlc3VsdERvbS5lbD8ucXVlcnlTZWxlY3RvcihcIi5zZWFyY2gtcmVzdWx0LWZpbGUtdGl0bGUgLnRyZWUtaXRlbS1pbm5lclwiKTtcbiAgICAgICAgaWYgKHRpdGxlRWwpIGNvbG9yVGl0bGVFbChwbHVnaW4sIHRpdGxlRWwsIGZpbGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG4vLyBcIkJhY2tsaW5rcyBpbSBEb2t1bWVudFwiIGlzdCBrZWluZSBlaWdlbmUgQW5zaWNodC9rZWluIGVpZ2VuZXIgTGVhZiwgc29uZGVyblxuLy8gdW50ZW4gaW4gZGllIE1hcmtkb3duVmlldyBlaW5nZWJldHRldCAoLmVtYmVkZGVkLWJhY2tsaW5rcykgLSBoaWVyIHJlaWNodFxuLy8ga2VpbiBMZWFmLVR5cCwgc3RhdHRkZXNzZW4gXHUwMEZDYmVyIG9mZmVuZSBNYXJrZG93bi1MZWF2ZXMgbmFjaCBkZXIgRE9NLUtsYXNzZVxuLy8gc3VjaGVuLiBPaG5lIGRhdGEtcGF0aCBqZSBaZWlsZSB3aXJkIGRpZSBEYXRlaSBcdTAwRkNiZXIgZGVuIGFuZ2V6ZWlndGVuXG4vLyBEYXRlaW5hbWVuIChMaW5rdGV4dCkgYXVmZ2VsXHUwMEY2c3QsIHdpZSBPYnNpZGlhbiBpbnRlcm4gTGlua3MgYXVmbFx1MDBGNnN0LlxuZnVuY3Rpb24gYXBwbHlFbWJlZGRlZEJhY2tsaW5rQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikpIHtcbiAgICBjb25zdCBwYW5lRWwgPSBsZWFmLnZpZXcuY29udGFpbmVyRWwucXVlcnlTZWxlY3RvcihcIi5lbWJlZGRlZC1iYWNrbGlua3MgLmJhY2tsaW5rLXBhbmVcIik7XG4gICAgaWYgKCFwYW5lRWwpIGNvbnRpbnVlO1xuXG4gICAgY29uc3Qgc291cmNlUGF0aCA9IGxlYWYudmlldy5maWxlPy5wYXRoID8/IFwiXCI7XG4gICAgY29uc3QgdGl0bGVFbHMgPSBwYW5lRWwucXVlcnlTZWxlY3RvckFsbChcIi5zZWFyY2gtcmVzdWx0LWZpbGUtdGl0bGUgLnRyZWUtaXRlbS1pbm5lclwiKTtcbiAgICBmb3IgKGNvbnN0IHRpdGxlRWwgb2YgdGl0bGVFbHMpIHtcbiAgICAgIGNvbnN0IGJhc2VuYW1lID0gdGl0bGVFbC50ZXh0Q29udGVudDtcbiAgICAgIGNvbnN0IGZpbGUgPSBiYXNlbmFtZSA/IHBsdWdpbi5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaXJzdExpbmtwYXRoRGVzdChiYXNlbmFtZSwgc291cmNlUGF0aCkgOiBudWxsO1xuICAgICAgY29sb3JUaXRsZUVsKHBsdWdpbiwgdGl0bGVFbCwgZmlsZSk7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGFwcGx5QmFja2xpbmtDb2xvcnMocGx1Z2luKSB7XG4gIGFwcGx5QmFja2xpbmtQYW5lQ29sb3JzKHBsdWdpbik7XG4gIGFwcGx5RW1iZWRkZWRCYWNrbGlua0NvbG9ycyhwbHVnaW4pO1xufVxuXG5mdW5jdGlvbiByZWdpc3RlckJhY2tsaW5rQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlCYWNrbGlua0NvbG9ycyhwbHVnaW4pO1xuXG4gIC8vIE51ciBkYXMgKGtsZWluZSkgQmFja2xpbmtzLVBhbmUgaW4gZGVyIFNlaXRlbmxlaXN0ZSBwZXIgTXV0YXRpb25PYnNlcnZlclxuICAvLyBiZW9iYWNodGVuIC0gTklDSFQgZGllIE1hcmtkb3duVmlldy1Db250YWluZXIsIGRhIGRlcmVuIEVkaXRvci1TdWJ0cmVlIGJlaVxuICAvLyBqZWRlbSBUYXN0ZW5kcnVjayB2aWVsZSBNdXRhdGlvbmVuIGVyemV1Z3QgKHNpZWhlIFdhcm51bmcgaW5cbiAgLy8gZGF0YWJhc2UtZm9sZGVycy5qczogZWluIHN1YnRyZWUtT2JzZXJ2ZXIgXHUwMEZDYmVyIGVpbmVuIEVkaXRvci1uYWhlbiBDb250YWluZXJcbiAgLy8gaGF0IGRpZXNlcyBWYXVsdCBzY2hvbiBlaW5tYWwga29tcGxldHQgZWluZ2Vmcm9yZW4pLiBEaWUgZWluZ2ViZXR0ZXRlblxuICAvLyBCYWNrbGlua3MgaW0gRG9rdW1lbnQgYnJhdWNoZW4gZGFmXHUwMEZDciBrZWluZW4gZWlnZW5lbiBPYnNlcnZlcjogc2llIFx1MDBFNG5kZXJuXG4gIC8vIHNpY2ggbnVyLCB3ZW5uIGlyZ2VuZHdvIGltIFZhdWx0IExpbmtzIGhpbnp1a29tbWVuL3dlZ2ZhbGxlbiBvZGVyIGJlaW1cbiAgLy8gXHUwMEQ2ZmZuZW4vV2VjaHNlbG4gZWluZXIgTm90aXogLSBiZWlkZXMgaXN0IFx1MDBGQ2JlciBkaWUgRXZlbnRzIHVudGVuIGJlcmVpdHNcbiAgLy8gYWJnZWRlY2t0IChcInJlc29sdmVkXCIgbmFjaCBqZWRlciBMaW5rLUF1ZmxcdTAwRjZzdW5nLCBsYXlvdXQtY2hhbmdlL1xuICAvLyBhY3RpdmUtbGVhZi1jaGFuZ2UgbFx1MDBGNnNlbiBvaG5laGluIGFwcGx5QmFja2xpbmtDb2xvcnMoKSB1bmQgZGFtaXQgYXVjaFxuICAvLyBhcHBseUVtYmVkZGVkQmFja2xpbmtDb2xvcnMoKSBhdXMpLlxuICBjb25zdCBvYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKHJlZnJlc2gpO1xuICBjb25zdCBvYnNlcnZlTGVhdmVzID0gKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoQkFDS0xJTktfVklFV19UWVBFKSkge1xuICAgICAgb2JzZXJ2ZXIub2JzZXJ2ZShsZWFmLnZpZXcuY29udGFpbmVyRWwsIHsgY2hpbGRMaXN0OiB0cnVlLCBzdWJ0cmVlOiB0cnVlIH0pO1xuICAgIH1cbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IG9ic2VydmVyLmRpc2Nvbm5lY3QoKSk7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgLy8gTnVyIGRlciBlaW5nZWJldHRldGUgVGVpbCBoXHUwMEU0bmd0IChtYW5nZWxzIGVpZ2VuZW0gT2JzZXJ2ZXIsIHNpZWhlIG9iZW4pXG4gIC8vIHdlaXRlcmhpbiBhbiBkZXIgTGluay1BdWZsXHUwMEY2c3VuZyAtIGRpZSBTZWl0ZW5sZWlzdGUgZGVja3QgaWhyIE9ic2VydmVyIGFiLlxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLm1ldGFkYXRhQ2FjaGUub24oXCJyZXNvbHZlZFwiLCAoKSA9PiBhcHBseUVtYmVkZGVkQmFja2xpbmtDb2xvcnMocGx1Z2luKSkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgICAgcmVmcmVzaCgpO1xuICAgIH0pXG4gICk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwiYWN0aXZlLWxlYWYtY2hhbmdlXCIsIHJlZnJlc2gpKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgcmVmcmVzaCgpO1xuICB9KTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyQmFja2xpbmtDb2xvcnMgfTtcbiIsICJjb25zdCB7IGNvbG9yRm9yRmlsZSB9ID0gcmVxdWlyZShcIi4vdHlwZS1jb2xvcnNcIik7XG5cbmNvbnN0IEJPT0tNQVJLU19WSUVXX1RZUEUgPSBcImJvb2ttYXJrc1wiO1xuY29uc3QgQk9PS01BUktTX1BMVUdJTl9JRCA9IFwiYm9va21hcmtzXCI7XG5cbi8vIEJvb2ttYXJrLVplaWxlbiB0cmFnZW4ga2VpbiBkYXRhLXBhdGgtQXR0cmlidXQuIERlciBWaWV3IGhcdTAwRTRsdCBhYmVyIGludGVyblxuLy8gZWluZSBXZWFrTWFwICh2aWV3Lml0ZW1Eb21zOiBCb29rbWFyay1JdGVtIC0+IFRyZWUtSXRlbS1Eb20gbWl0IC50aXRsZUVsKSAtXG4vLyBkYXJcdTAwRkNiZXIgbFx1MDBFNHNzdCBzaWNoIGplZGVzIEl0ZW0gZ2V6aWVsdCBzZWluZXIgWmVpbGUgenVvcmRuZW4sIG9obmUgZGllIChuaWNodFxuLy8gaXRlcmllcmJhcmUpIFdlYWtNYXAgc2VsYnN0IGR1cmNobGF1ZmVuIHp1IG1cdTAwRkNzc2VuOiBzdGF0dGRlc3NlbiByZWt1cnNpdiBcdTAwRkNiZXJcbi8vIGRlbiBJdGVtLUJhdW0gZGVzIEJvb2ttYXJrcy1QbHVnaW5zIHNlbGJzdCBsYXVmZW4gKGxpZWd0IHVuYWJoXHUwMEU0bmdpZyB2b21cbi8vIFJlbmRlci0vQ29sbGFwc2UtWnVzdGFuZCBpbW1lciB2b2xsc3RcdTAwRTRuZGlnIHZvcikgdW5kIGplIEl0ZW0gcGVyIC5nZXQoKVxuLy8gbmFjaHNjaGxhZ2VuLCBvYiAodW5kIHdvKSBlcyBha3R1ZWxsIGdlcmVuZGVydCBpc3QuXG5mdW5jdGlvbiBmb3JFYWNoRmlsZUJvb2ttYXJrKGl0ZW1zLCBjYWxsYmFjaykge1xuICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMgPz8gW10pIHtcbiAgICBpZiAoaXRlbS50eXBlID09PSBcImZpbGVcIikgY2FsbGJhY2soaXRlbSk7XG4gICAgZWxzZSBpZiAoaXRlbS50eXBlID09PSBcImdyb3VwXCIpIGZvckVhY2hGaWxlQm9va21hcmsoaXRlbS5pdGVtcywgY2FsbGJhY2spO1xuICB9XG59XG5cbmZ1bmN0aW9uIGFwcGx5Qm9va21hcmtzQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCBib29rbWFya3NQbHVnaW4gPSBwbHVnaW4uYXBwLmludGVybmFsUGx1Z2lucy5nZXRFbmFibGVkUGx1Z2luQnlJZChCT09LTUFSS1NfUExVR0lOX0lEKTtcbiAgaWYgKCFib29rbWFya3NQbHVnaW4pIHJldHVybjtcblxuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEJPT0tNQVJLU19WSUVXX1RZUEUpKSB7XG4gICAgY29uc3QgaXRlbURvbXMgPSBsZWFmLnZpZXc/Lml0ZW1Eb21zO1xuICAgIGlmICghaXRlbURvbXMpIGNvbnRpbnVlO1xuXG4gICAgZm9yRWFjaEZpbGVCb29rbWFyayhib29rbWFya3NQbHVnaW4uaXRlbXMsIChpdGVtKSA9PiB7XG4gICAgICBjb25zdCB0aXRsZUVsID0gaXRlbURvbXMuZ2V0KGl0ZW0pPy50aXRsZUVsO1xuICAgICAgaWYgKCF0aXRsZUVsKSByZXR1cm47XG5cbiAgICAgIGNvbnN0IGZpbGUgPSBwbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChpdGVtLnBhdGgpO1xuICAgICAgY29uc3QgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5ib29rbWFya3MgPyBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCBcImJvb2ttYXJrc1wiKSA6IG51bGw7XG4gICAgICBpZiAoY29sb3IpIHRpdGxlRWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcbiAgICAgIGVsc2UgdGl0bGVFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImNvbG9yXCIpO1xuICAgIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyQm9va21hcmtzQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlCb29rbWFya3NDb2xvcnMocGx1Z2luKTtcblxuICAvLyBBbmFsb2cgenUgZmlsZS1leHBsb3Jlci1jb2xvcnMuanM6IEJvb2ttYXJrcyByZW5kZXJ0IFplaWxlbiBiZWltXG4gIC8vIEF1Zi0vWnVrbGFwcGVuIHZvbiBHcnVwcGVuIHNvd2llIGJlaW0gSGluenVmXHUwMEZDZ2VuL0VudGZlcm5lbi9VbXNvcnRpZXJlblxuICAvLyBkeW5hbWlzY2ggbmV1LlxuICBjb25zdCBvYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKHJlZnJlc2gpO1xuICBjb25zdCBvYnNlcnZlTGVhdmVzID0gKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoQk9PS01BUktTX1ZJRVdfVFlQRSkpIHtcbiAgICAgIG9ic2VydmVyLm9ic2VydmUobGVhZi52aWV3LmNvbnRhaW5lckVsLCB7IGNoaWxkTGlzdDogdHJ1ZSwgc3VidHJlZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiBvYnNlcnZlci5kaXNjb25uZWN0KCkpO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KFxuICAgIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgICByZWZyZXNoKCk7XG4gICAgfSlcbiAgKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgcmVmcmVzaCgpO1xuICB9KTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyQm9va21hcmtzQ29sb3JzIH07XG4iLCAiY29uc3QgeyBURmlsZSB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBjb2xvckZvckZpbGUsIHN1YnR5cGVDb2xvciwgc3VidHlwZUhhc093bkNvbG9yIH0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcbmNvbnN0IHsgZ2V0U3VidHlwZSB9ID0gcmVxdWlyZShcIi4vc3VidHlwZXNcIik7XG5cbmNvbnN0IERPVF9DTEFTUyA9IFwiZnJlZC10eXAtdGl0bGUtZG90XCI7XG5jb25zdCBET1RfSE9MTE9XX0NMQVNTID0gXCJmcmVkLXR5cC10aXRsZS1kb3QtaG9sbG93XCI7XG4vLyBXaWUgREVGQVVMVF9UWVBFX0NPTE9SIGluIHR5cC12aWV3LmpzIChGYXJiZSBlaW5lcyBUWVBzIG9obmUgZWlnZW5lIEZhcmJlKS5cbmNvbnN0IERFRkFVTFRfRE9UX0NPTE9SID0gXCIjODg4ODg4XCI7XG5jb25zdCBCQURHRV9DTEFTUyA9IFwiZnJlZC10eXAtdGl0bGUtYmFkZ2VcIjtcbmNvbnN0IEJBREdFX1BMQUlOX0NMQVNTID0gXCJmcmVkLXR5cC10aXRsZS1iYWRnZS1wbGFpblwiO1xuY29uc3QgQ09MT1JfVkFSID0gXCItLWZyZWQtdHlwLXRpdGxlLWNvbG9yXCI7XG5cbmNvbnN0IEJMT0NLX0JBREdFX0NMQVNTID0gXCJmcmVkLXR5cC1ibG9jay1iYWRnZVwiO1xuY29uc3QgQkxPQ0tfQkFER0VfUExBSU5fQ0xBU1MgPSBcImZyZWQtdHlwLWJsb2NrLWJhZGdlLXBsYWluXCI7XG5jb25zdCBCTE9DS19BTElHTl9UT1BfQ0xBU1MgPSBcImZyZWQtdHlwLWJsb2NrLWJhZGdlLXRvcFwiO1xuY29uc3QgQkxPQ0tfQUxJR05fQk9UVE9NX0NMQVNTID0gXCJmcmVkLXR5cC1ibG9jay1iYWRnZS1ib3R0b21cIjtcbmNvbnN0IEJMT0NLX0NPTE9SX1ZBUiA9IFwiLS1mcmVkLXR5cC1ibG9jay1jb2xvclwiO1xuXG4vLyBub3RlVGl0bGVTdHlsZTogXCJub25lXCIgfCBcImRvdFwiIHwgXCJiYWRnZVwiLiBCZWkgXCJiYWRnZVwiIGJlc3RpbW1lbiB6d2VpXG4vLyB3ZWl0ZXJlIEVpbnN0ZWxsdW5nZW4gRmFyYmUgKG5vdGVUaXRsZUJhZGdlQ29sb3JlZCkgdW5kIFBvc2l0aW9uXG4vLyAobm90ZVRpdGxlQmFkZ2VQb3NpdGlvbjogXCJ0aXRsZVwiIHwgXCJibG9ja1wiKSAtIHNpZWhlIHNldHRpbmdzLmpzLCBkb3J0IG51clxuLy8gYmVpIFwiYmFkZ2VcIiBcdTAwRkNiZXJoYXVwdCBhbmdlemVpZ3QgKHByb2dyZXNzaXZlIE9mZmVubGVndW5nKS4gXCJkb3RcIiBzaXR6dFxuLy8gaW1tZXIgYW0gVGl0ZWwsIFwiYmFkZ2VcIiBqZSBuYWNoIFBvc2l0aW9uIGVudHdlZGVyIGFtIFRpdGVsIG9kZXIgYW1cbi8vIFByb3BlcnR5LUJsb2NrIChkb3J0IHp1c1x1MDBFNHR6bGljaCBwZXIgbm90ZVRpdGxlVmVydGljYWxBbGlnbiBvYmVuL3VudGVuKS5cbi8vIGNvbG9yVmlld3Mubm90ZVRpdGxlQ29sb3IgKFRpdGVsdGV4dCBzZWxic3QgZWluZlx1MDBFNHJiZW4pIGlzdCBkYXZvbiB1bmFiaFx1MDBFNG5naWdcbi8vIHVuZCBiZWxpZWJpZyBrb21iaW5pZXJiYXIuXG5mdW5jdGlvbiByZXNvbHZlTWFya2VyKHBsdWdpbiwgZmlsZSkge1xuICBjb25zdCBzdHlsZSA9IHBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVTdHlsZTtcbiAgaWYgKHN0eWxlID09PSBcIm5vbmVcIikgcmV0dXJuIHsga2luZDogXCJub25lXCIgfTtcbiAgaWYgKHN0eWxlID09PSBcImRvdFwiKSByZXR1cm4geyBraW5kOiBcImRvdFwiLCAuLi5yZXNvbHZlRG90KHBsdWdpbiwgZmlsZSkgfTtcblxuICAvLyBzdHlsZSA9PT0gXCJiYWRnZVwiIC0gZmFyYmlnIGJlaSBlaW5lbSByZWdpc3RyaWVydGVuIFRZUCBvaG5lIGVpZ2VuZSBGYXJiZVxuICAvLyBpbiBkZXIgZ3JhdWVuIFN0YW5kYXJkZmFyYmUgKHdpZSBkZXIgUmluZyB2b24gcmVzb2x2ZURvdCk7IGVpbiBuaWNodFxuICAvLyByZWdpc3RyaWVydGVyIFRZUCBiZWtvbW10IGZhcmJpZyBrZWluZSBCb3gsIHdpZSBhdWNoIGtlaW5lbiBQdW5rdC5cbiAgY29uc3QgeyBzZXR0aW5ncyB9ID0gcGx1Z2luO1xuICBjb25zdCB0eXBlID0gcGx1Z2luLnR5cEluZGV4LnR5cGVPZihmaWxlKTtcbiAgaWYgKCF0eXBlKSByZXR1cm4geyBraW5kOiBcIm5vbmVcIiB9O1xuICBjb25zdCBjb2xvcmVkID0gc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VDb2xvcmVkO1xuICBpZiAoY29sb3JlZCAmJiAhc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXSAmJiAhc2V0dGluZ3MudHlwZXMuaW5jbHVkZXModHlwZSkpIHJldHVybiB7IGtpbmQ6IFwibm9uZVwiIH07XG4gIGNvbnN0IHR5cGVDb2xvciA9IHNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV0gPz8gREVGQVVMVF9ET1RfQ09MT1I7XG5cbiAgY29uc3QgbGFiZWwgPSBiYWRnZUxhYmVsKHBsdWdpbiwgZmlsZSwgdHlwZSk7XG4gIGlmICghbGFiZWwpIHJldHVybiB7IGtpbmQ6IFwibm9uZVwiIH07XG4gIGNvbnN0IHsgdGV4dCwgdXNlU3VidHlwZUNvbG9yLCBzdWJ0eXBlIH0gPSBsYWJlbDtcbiAgY29uc3QgY29sb3IgPSBjb2xvcmVkID8gKHVzZVN1YnR5cGVDb2xvciA/IHN1YnR5cGVDb2xvcihzZXR0aW5ncywgdHlwZSwgc3VidHlwZSkgPz8gdHlwZUNvbG9yIDogdHlwZUNvbG9yKSA6IG51bGw7XG4gIGNvbnN0IHBvc2l0aW9uID0gc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VQb3NpdGlvbjtcbiAgcmV0dXJuIHsga2luZDogcG9zaXRpb24gPT09IFwiYmxvY2tcIiA/IFwiYmxvY2stYmFkZ2VcIiA6IFwidGl0bGUtYmFkZ2VcIiwgY29sb3JlZCwgY29sb3IsIHR5cGVOYW1lOiB0ZXh0IH07XG59XG5cbi8vIEJlc2NocmlmdHVuZyBkZXIgQm94IChub3RlVGl0bGVCYWRnZUxhYmVsKSBzYW10IGRlciBkYXp1IHBhc3NlbmRlbiBGYXJiZTpcbi8vIFtUWVBdIGluIFRZUC1GYXJiZSwgW1N1YnR5cF0gaW4gU3VidHlwLUZhcmJlIChvaG5lIFN1YnR5cCBrZWluZSBCb3ggLVxuLy8gZGFubiBudWxsKSwgW1RZUC9TdWJ0eXBdIGplIG5hY2ggU2NoYWx0ZXIgXCJTdWJ0eXAtRmFyYmVcIlxuLy8gKGNvbG9yVmlld3Mubm90ZVRpdGxlTWFya2VyU3VidHlwKS4gRWluIG5pY2h0IHJlZ2lzdHJpZXJ0ZXIgU1VCVFlQLVdlcnRcbi8vIHN0ZWh0IGFscyBUZXh0IGRhLCBoYXQgYWJlciBrZWluZSBlaWdlbmUgRmFyYmUgKHN1YnR5cGVDb2xvciBsaWVmZXJ0IGRhbm5cbi8vIGRpZSBkZXMgVFlQcykuXG5mdW5jdGlvbiBiYWRnZUxhYmVsKHBsdWdpbiwgZmlsZSwgdHlwZSkge1xuICBjb25zdCB7IHNldHRpbmdzIH0gPSBwbHVnaW47XG4gIGNvbnN0IHN1YnR5cGUgPSBwbHVnaW4udHlwSW5kZXguc3VidHlwZU9mKGZpbGUpO1xuICBjb25zdCBtb2RlID0gc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VMYWJlbCA/PyBcInR5cGVcIjtcbiAgaWYgKG1vZGUgPT09IFwic3VidHlwZVwiKSByZXR1cm4gc3VidHlwZSA/IHsgdGV4dDogc3VidHlwZSwgdXNlU3VidHlwZUNvbG9yOiB0cnVlLCBzdWJ0eXBlIH0gOiBudWxsO1xuICBpZiAoIXN1YnR5cGUgfHwgbW9kZSA9PT0gXCJ0eXBlXCIpIHJldHVybiB7IHRleHQ6IHR5cGUsIHVzZVN1YnR5cGVDb2xvcjogZmFsc2UsIHN1YnR5cGUgfTtcbiAgcmV0dXJuIHsgdGV4dDogYCR7dHlwZX0vJHtzdWJ0eXBlfWAsIHVzZVN1YnR5cGVDb2xvcjogISFzZXR0aW5ncy5jb2xvclZpZXdzLm5vdGVUaXRsZU1hcmtlclN1YnR5cCwgc3VidHlwZSB9O1xufVxuXG4vLyBGYXJicHVua3QgYW0gVGl0ZWwgLSB3aWUgZGllIEZhcmJwdW5rdGUgZGVyIFRZUC1WaWV3IChzaWVoZSBwYWludENvbG9yRG90XG4vLyBpbiB0eXBlLWNvbG9ycy5qcykgYmVpbSBTdGFuZGFyZHdlcnQgYWxzIGhvaGxlciBSaW5nOiBlaW4gcmVnaXN0cmllcnRlciBUWVBcbi8vIG9obmUgRmFyYmUgZ3JhdSwgZWluIFN1YnR5cCBvaG5lIGVpZ2VuZSBFaW5zdGVsbHVuZyAobWl0IGRlbSBVbnRlci1TY2hhbHRlclxuLy8gXCJTdWJ0eXBcIikgaW4gZGVyIFRZUC1GYXJiZSwgZGllIGVyIFx1MDBGQ2Jlcm5pbW10LiBOaWNodCByZWdpc3RyaWVydGUgVFlQZW5cbi8vIGJsZWliZW4gd2llIGluIGRlciBUWVAtTGlzdGUgb2huZSBQdW5rdC5cbmZ1bmN0aW9uIHJlc29sdmVEb3QocGx1Z2luLCBmaWxlKSB7XG4gIGNvbnN0IHR5cGUgPSBwbHVnaW4udHlwSW5kZXgudHlwZU9mKGZpbGUpO1xuICBpZiAoIXR5cGUpIHJldHVybiB7IGNvbG9yOiBudWxsLCBob2xsb3c6IGZhbHNlIH07XG4gIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHBsdWdpbjtcbiAgY29uc3QgdHlwZUNvbG9yID0gc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXTtcbiAgaWYgKCF0eXBlQ29sb3IpIHtcbiAgICByZXR1cm4gc2V0dGluZ3MudHlwZXMuaW5jbHVkZXModHlwZSkgPyB7IGNvbG9yOiBERUZBVUxUX0RPVF9DT0xPUiwgaG9sbG93OiB0cnVlIH0gOiB7IGNvbG9yOiBudWxsLCBob2xsb3c6IGZhbHNlIH07XG4gIH1cbiAgY29uc3Qgc3VidHlwZSA9IHBsdWdpbi50eXBJbmRleC5zdWJ0eXBlT2YoZmlsZSk7XG4gIGlmIChzZXR0aW5ncy5jb2xvclZpZXdzLm5vdGVUaXRsZU1hcmtlclN1YnR5cCAmJiBzdWJ0eXBlICYmIGdldFN1YnR5cGUoc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpKSB7XG4gICAgcmV0dXJuIHsgY29sb3I6IHN1YnR5cGVDb2xvcihzZXR0aW5ncywgdHlwZSwgc3VidHlwZSksIGhvbGxvdzogIXN1YnR5cGVIYXNPd25Db2xvcihzZXR0aW5ncywgdHlwZSwgc3VidHlwZSkgfTtcbiAgfVxuICByZXR1cm4geyBjb2xvcjogdHlwZUNvbG9yLCBob2xsb3c6IGZhbHNlIH07XG59XG5cbi8vIFRpdGVsIGRlciBOb3RpeiBzZWxic3QgKC5pbmxpbmUtdGl0bGUsIHNpY2h0YmFyIHNvZmVybiBPYnNpZGlhbnMgZWlnZW5lXG4vLyBFaW5zdGVsbHVuZyBcIklubGluZS1UaXRlbCBhbnplaWdlblwiIGFrdGl2IGlzdCkuIEJld3Vzc3QgYWxzIDo6YmVmb3JlXG4vLyByZWFsaXNpZXJ0IChzaWVoZSBzdHlsZXMuY3NzKSBzdGF0dCBhbHMgZWlnZW5lcyBET00tRWxlbWVudCBvZGVyIFdyYXBwZXI6XG4vLyAuaW5saW5lLXRpdGxlIGhcdTAwRTRuZ3QgaW4gbWVocmVyZW4gVGhlbWVzICh1LiBhLiBNaW5pbWFsKSBwZXIgS2luZC1TZWxla3RvclxuLy8gKFwiPlwiKSBkaXJla3QgYW4gc2VpbmVtIEVsdGVybi1Db250YWluZXIgKHouIEIuIGZcdTAwRkNyIG1heC13aWR0aC9tYXJnaW4pIC0gZWluXG4vLyB6dXNcdTAwRTR0emxpY2hlcyBFbGVtZW50IGRhdm9yIG9kZXIgZWluIFdyYXBwZXIgZGFydW0gd1x1MDBGQ3JkZSBkaWVzZSBSZWdlbG5cbi8vIHVudGVyd2FuZGVybi4gRmFyYmUgdW5kIFRZUC1OYW1lIGxhc3NlbiBzaWNoIGVpbmVtIDo6YmVmb3JlIG5pY2h0IGRpcmVrdFxuLy8genV3ZWlzZW4sIGRhaGVyIGRlciBVbXdlZyBcdTAwRkNiZXIgZWluZSBDU1MtVmFyaWFibGUgYnp3LiBlaW4gZGF0YS1BdHRyaWJ1dCxcbi8vIGRpZSBkaWUgOjpiZWZvcmUtUmVnZWxuIGF1c2xlc2VuICh2YXIoKS9hdHRyKCkpLlxuZnVuY3Rpb24gYXBwbHlTdHlsZVRvVGl0bGUodGl0bGVFbCwgbWFya2VyKSB7XG4gIGNvbnN0IGlzRG90ID0gbWFya2VyLmtpbmQgPT09IFwiZG90XCIgJiYgISFtYXJrZXIuY29sb3I7XG4gIGNvbnN0IGlzQmFkZ2UgPSBtYXJrZXIua2luZCA9PT0gXCJ0aXRsZS1iYWRnZVwiO1xuXG4gIHRpdGxlRWwuY2xhc3NMaXN0LnRvZ2dsZShET1RfQ0xBU1MsIGlzRG90KTtcbiAgdGl0bGVFbC5jbGFzc0xpc3QudG9nZ2xlKERPVF9IT0xMT1dfQ0xBU1MsIGlzRG90ICYmICEhbWFya2VyLmhvbGxvdyk7XG4gIHRpdGxlRWwuY2xhc3NMaXN0LnRvZ2dsZShCQURHRV9DTEFTUywgaXNCYWRnZSAmJiBtYXJrZXIuY29sb3JlZCk7XG4gIHRpdGxlRWwuY2xhc3NMaXN0LnRvZ2dsZShCQURHRV9QTEFJTl9DTEFTUywgaXNCYWRnZSAmJiAhbWFya2VyLmNvbG9yZWQpO1xuXG4gIGlmIChpc0JhZGdlKSB0aXRsZUVsLmRhdGFzZXQuZnJlZFR5cCA9IG1hcmtlci50eXBlTmFtZTtcbiAgZWxzZSBkZWxldGUgdGl0bGVFbC5kYXRhc2V0LmZyZWRUeXA7XG5cbiAgY29uc3QgbWFya2VyQ29sb3IgPSAoaXNEb3QgJiYgbWFya2VyLmNvbG9yKSB8fCAoaXNCYWRnZSAmJiBtYXJrZXIuY29sb3JlZCAmJiBtYXJrZXIuY29sb3IpID8gbWFya2VyLmNvbG9yIDogbnVsbDtcbiAgaWYgKG1hcmtlckNvbG9yKSB0aXRsZUVsLnN0eWxlLnNldFByb3BlcnR5KENPTE9SX1ZBUiwgbWFya2VyQ29sb3IpO1xuICBlbHNlIHRpdGxlRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoQ09MT1JfVkFSKTtcbn1cblxuLy8gUHJvcGVydHktQmxvY2sgZGVyIE5vdGl6ICgubWV0YWRhdGEtY29udGFpbmVyKS4gRGllIFwiYmxvY2tcIi1Qb3NpdGlvbiB2b25cbi8vIG5vdGVUaXRsZUJhZGdlUG9zaXRpb246IGRpZXNlbGJlIEJveCB3aWUgYW0gVGl0ZWwsIGFiZXIgdW0gOTBcdTAwQjAgZ2VkcmVodFxuLy8gKHdyaXRpbmctbW9kZSBzdGF0dCB0cmFuc2Zvcm06cm90YXRlKCkgLSBkYWR1cmNoIHdcdTAwRTRjaHN0IGRpZSBCb3ggbWl0IGRlclxuLy8gVGV4dGxcdTAwRTRuZ2UgaW4gZGVyIHJpY2h0aWdlbiBSaWNodHVuZywgb2huZSBkaWUgUG9zaXRpb25pZXJ1bmcgcGVyXG4vLyB0cmFuc2Zvcm0tb3JpZ2luIHZvbiBIYW5kIG5hY2hyZWNobmVuIHp1IG1cdTAwRkNzc2VuKSB1bmQgbGlua3MgYW0gUHJvcGVydHktQmxvY2tcbi8vIHN0YXR0IGFtIFRpdGVsIHZlcmFua2VydCwgb2JlbiBvZGVyIHVudGVuIChub3RlVGl0bGVWZXJ0aWNhbEFsaWduKS4gQmxlaWJ0XG4vLyBiZWltIChFaW4tL0F1cy0pQmxlbmRlbiBkZXMgQmxvY2tzIChzaWVoZSBQcm9wZXJ0eS1CbG9jay5jc3MpIGF1dG9tYXRpc2NoXG4vLyBtaXQgdmVyc2Nod2luZGVuL2Vyc2NoZWluZW4sIGRhIHNpZSBhbHMgOjpiZWZvcmUgZGFyYXVmIHNpdHp0LlxuZnVuY3Rpb24gYXBwbHlTdHlsZVRvQmxvY2socGx1Z2luLCBibG9ja0VsLCBtYXJrZXIpIHtcbiAgY29uc3QgaXNCbG9ja0JhZGdlID0gbWFya2VyLmtpbmQgPT09IFwiYmxvY2stYmFkZ2VcIjtcblxuICBibG9ja0VsLmNsYXNzTGlzdC50b2dnbGUoQkxPQ0tfQkFER0VfQ0xBU1MsIGlzQmxvY2tCYWRnZSAmJiBtYXJrZXIuY29sb3JlZCk7XG4gIGJsb2NrRWwuY2xhc3NMaXN0LnRvZ2dsZShCTE9DS19CQURHRV9QTEFJTl9DTEFTUywgaXNCbG9ja0JhZGdlICYmICFtYXJrZXIuY29sb3JlZCk7XG5cbiAgY29uc3QgYWxpZ24gPSBwbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlVmVydGljYWxBbGlnbjtcbiAgYmxvY2tFbC5jbGFzc0xpc3QudG9nZ2xlKEJMT0NLX0FMSUdOX1RPUF9DTEFTUywgaXNCbG9ja0JhZGdlICYmIGFsaWduICE9PSBcImJvdHRvbVwiKTtcbiAgYmxvY2tFbC5jbGFzc0xpc3QudG9nZ2xlKEJMT0NLX0FMSUdOX0JPVFRPTV9DTEFTUywgaXNCbG9ja0JhZGdlICYmIGFsaWduID09PSBcImJvdHRvbVwiKTtcblxuICBpZiAoaXNCbG9ja0JhZGdlKSBibG9ja0VsLmRhdGFzZXQuZnJlZFR5cCA9IG1hcmtlci50eXBlTmFtZTtcbiAgZWxzZSBkZWxldGUgYmxvY2tFbC5kYXRhc2V0LmZyZWRUeXA7XG5cbiAgY29uc3QgYmxvY2tDb2xvciA9IGlzQmxvY2tCYWRnZSAmJiBtYXJrZXIuY29sb3JlZCAmJiBtYXJrZXIuY29sb3IgPyBtYXJrZXIuY29sb3IgOiBudWxsO1xuICBpZiAoYmxvY2tDb2xvcikgYmxvY2tFbC5zdHlsZS5zZXRQcm9wZXJ0eShCTE9DS19DT0xPUl9WQVIsIGJsb2NrQ29sb3IpO1xuICBlbHNlIGJsb2NrRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoQkxPQ0tfQ09MT1JfVkFSKTtcbn1cblxuZnVuY3Rpb24gYXBwbHlBY3RpdmVUaXRsZUNvbG9ycyhwbHVnaW4pIHtcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpKSB7XG4gICAgY29uc3QgY29udGFpbmVyRWwgPSBsZWFmLnZpZXcuY29udGFpbmVyRWw7XG4gICAgY29uc3QgZmlsZSA9IGxlYWYudmlldy5maWxlO1xuICAgIGNvbnN0IHR5cGVkRmlsZSA9IGZpbGUgaW5zdGFuY2VvZiBURmlsZSA/IGZpbGUgOiBudWxsO1xuICAgIGNvbnN0IG1hcmtlciA9IHJlc29sdmVNYXJrZXIocGx1Z2luLCB0eXBlZEZpbGUpO1xuXG4gICAgY29uc3QgdGl0bGVFbCA9IGNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3IoXCIuaW5saW5lLXRpdGxlXCIpO1xuICAgIGlmICh0aXRsZUVsKSB7XG4gICAgICBhcHBseVN0eWxlVG9UaXRsZSh0aXRsZUVsLCBtYXJrZXIpO1xuXG4gICAgICBjb25zdCB0ZXh0Q29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5ub3RlVGl0bGVDb2xvciA/IGNvbG9yRm9yRmlsZShwbHVnaW4sIHR5cGVkRmlsZSwgXCJub3RlVGl0bGVDb2xvclwiKSA6IG51bGw7XG4gICAgICBpZiAodGV4dENvbG9yKSB0aXRsZUVsLnN0eWxlLmNvbG9yID0gdGV4dENvbG9yO1xuICAgICAgZWxzZSB0aXRsZUVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiY29sb3JcIik7XG4gICAgfVxuXG4gICAgY29uc3QgYmxvY2tFbCA9IGNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3IoXCIubWV0YWRhdGEtY29udGFpbmVyXCIpO1xuICAgIGlmIChibG9ja0VsKSBhcHBseVN0eWxlVG9CbG9jayhwbHVnaW4sIGJsb2NrRWwsIG1hcmtlcik7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJBY3RpdmVUaXRsZUNvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5QWN0aXZlVGl0bGVDb2xvcnMocGx1Z2luKTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImZpbGUtb3BlblwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwiYWN0aXZlLWxlYWYtY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsIHJlZnJlc2gpKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KHJlZnJlc2gpO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJBY3RpdmVUaXRsZUNvbG9ycyB9O1xuIiwgImNvbnN0IHsgZWRpdG9ySW5mb0ZpZWxkLCBnZXRMaW5rcGF0aCB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBWaWV3UGx1Z2luLCBEZWNvcmF0aW9uIH0gPSByZXF1aXJlKFwiQGNvZGVtaXJyb3Ivdmlld1wiKTtcbmNvbnN0IHsgUHJlYywgUmFuZ2VTZXRCdWlsZGVyLCBTdGF0ZUVmZmVjdCB9ID0gcmVxdWlyZShcIkBjb2RlbWlycm9yL3N0YXRlXCIpO1xuY29uc3QgeyBzeW50YXhUcmVlIH0gPSByZXF1aXJlKFwiQGNvZGVtaXJyb3IvbGFuZ3VhZ2VcIik7XG5jb25zdCB7IGNvbG9yRm9yRmlsZSB9ID0gcmVxdWlyZShcIi4vdHlwZS1jb2xvcnNcIik7XG5cbi8vIExpbmtzIGltIE5vdGl6dGV4dCBuYWNoIGRlbSBUWVAgaWhyZXMgWmllbHMgZWluZlx1MDBFNHJiZW4uIE9ic2lkaWFuIGZcdTAwRTRyYnRcbi8vIGludGVybmUgTGlua3MgaW4gYmVpZGVuIERhcnN0ZWxsdW5nZW4gXHUwMEZDYmVyIHZhcigtLWxpbmstY29sb3IpIGJ6dy5cbi8vIHZhcigtLWxpbmstY29sb3ItaG92ZXIpIChzaWVoZSBhcHAuY3NzOiBcIi5tYXJrZG93bi1yZW5kZXJlZCAuaW50ZXJuYWwtbGlua1wiXG4vLyB1bmQgXCIuY20tcy1vYnNpZGlhbiBzcGFuLmNtLWhtZC1pbnRlcm5hbC1saW5rXCIpIC0gc3RhdHQgZWlnZW5lciBGYXJicmVnZWxuXG4vLyB3aXJkIGRhaGVyIG51ciAtLWxpbmstY29sb3IgamUgTGluayBcdTAwRkNiZXJzY2hyaWViZW4uIC0tbGluay1jb2xvci1ob3ZlciBibGVpYnRcbi8vIGJld3Vzc3QgdW5hbmdldGFzdGV0OiBiZWltIFx1MDBEQ2JlcmZhaHJlbiBlcnNjaGVpbnQgd2llZGVyIGRpZSBub3JtYWxlXG4vLyBMaW5rLUZhcmJlLiBVbnRlcnN0cmVpY2h1bmcgdW5kIFRoZW1lLUFucGFzc3VuZ2VuIGJsZWliZW4gZWJlbnNvIGVyaGFsdGVuLlxuLy9cbi8vIFp3ZWkgZ2V0cmVubnRlIFdlZ2UsIGRhIHNpY2ggZGllIERhcnN0ZWxsdW5nZW4gZ3J1bmRsZWdlbmQgdW50ZXJzY2hlaWRlbjpcbi8vICAtIExlc2UtTW9kdXMsIEhvdmVyLVZvcnNjaGF1LCBnZXJlbmRlcnRlIEJsXHUwMEY2Y2tlIGluIExpdmUgUHJldmlldyAoVGFiZWxsZW4sXG4vLyAgICBDYWxsb3V0cyk6IGVjaHRlIDxhIGNsYXNzPVwiaW50ZXJuYWwtbGlua1wiIGRhdGEtaHJlZj1cIlx1MjAyNlwiPi1FbGVtZW50ZSBhdXNcbi8vICAgIE9ic2lkaWFucyBNYXJrZG93bi1SZW5kZXJlciAtPiBNYXJrZG93blBvc3RQcm9jZXNzb3IsIGplIExpbmsgZWlubWFsaWdcbi8vICAgIGJlaW0gUmVuZGVybi5cbi8vICAtIExpdmUgUHJldmlldy9RdWVsbHRleHQtTW9kdXM6IGRvcnQgZ2lidCBlcyBrZWluZSBMaW5rLUVsZW1lbnRlIG1pdFxuLy8gICAgWmllbGF0dHJpYnV0LCBudXIgQ29kZU1pcnJvci1TcGFucyAoXCIuY20taG1kLWludGVybmFsLWxpbmtcIikgXHUwMEZDYmVyIGRlbVxuLy8gICAgUm9odGV4dCAtPiBlaWdlbmVyIFZpZXdQbHVnaW4sIGRlciBudXIgZGVuIHNpY2h0YmFyZW4gQmVyZWljaCBiZXRyYWNodGV0LlxuLy9cbi8vIE5ldSBlaW5nZWZcdTAwRTRyYnQgd2lyZCBkYXJcdTAwRkNiZXIgaGluYXVzIG51ciBiZWkgdGF0c1x1MDBFNGNobGljaCBnZVx1MDBFNG5kZXJ0ZW0gVFlQXG4vLyAodHlwSW5kZXggXCJjaGFuZ2VcIikgb2RlciBnZVx1MDBFNG5kZXJ0ZXIgRWluc3RlbGx1bmcgLSBuaWNodCBiZWkgamVkZW0gU3BlaWNoZXJuLlxuXG5jb25zdCBDT0xPUl9WQVIgPSBcIi0tbGluay1jb2xvclwiO1xuY29uc3QgU09VUkNFX0FUVFIgPSBcImRhdGEtZnJlZC10eXAtc3JjXCI7XG5cbi8vIFtbWmllbF1dLCBbW1ppZWx8QWxpYXNdXSwgW1taaWVsI1x1MDBEQ2JlcnNjaHJpZnRdXSAtIEVpbmJldHR1bmdlbiAoIVtbXHUyMDI2XV0pXG4vLyBibGVpYmVuIGF1XHUwMERGZW4gdm9yLCBkaWUgc2luZCBrZWluZSBMaW5rcyBpbSBlaWdlbnRsaWNoZW4gU2lubi4gSW4gVGFiZWxsZW5cbi8vIHN0ZWh0IGRpZSBBbGlhcy1QaXBlIGVzY2FwZWQgKFwiXFx8XCIpLlxuY29uc3QgV0lLSUxJTktfUEFUVEVSTiA9IC8oPzwhISlcXFtcXFsoW15bXFxdXSs/KVxcXVxcXS9nO1xuXG5mdW5jdGlvbiBjb2xvckZvckxpbmt0ZXh0KHBsdWdpbiwgbGlua3RleHQsIHNvdXJjZVBhdGgpIHtcbiAgY29uc3QgdGFyZ2V0ID0gbGlua3RleHQuc3BsaXQoL1xcXFw/XFx8LylbMF0udHJpbSgpO1xuICBjb25zdCBsaW5rcGF0aCA9IGdldExpbmtwYXRoKHRhcmdldCk7XG4gIGlmICghbGlua3BhdGgpIHJldHVybiBudWxsO1xuICBjb25zdCBmaWxlID0gcGx1Z2luLmFwcC5tZXRhZGF0YUNhY2hlLmdldEZpcnN0TGlua3BhdGhEZXN0KGxpbmtwYXRoLCBzb3VyY2VQYXRoKTtcbiAgcmV0dXJuIGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIFwibGlua3NcIik7XG59XG5cbi8vIC0tLSBMZXNlLU1vZHVzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5mdW5jdGlvbiBhcHBseVRvQW5jaG9yKHBsdWdpbiwgYW5jaG9yRWwpIHtcbiAgY29uc3QgaHJlZiA9IGFuY2hvckVsLmdldEF0dHJpYnV0ZShcImRhdGEtaHJlZlwiKTtcbiAgY29uc3QgY29sb3IgPVxuICAgIHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmxpbmtzICYmIGhyZWYgJiYgIWFuY2hvckVsLmNsYXNzTGlzdC5jb250YWlucyhcImlzLXVucmVzb2x2ZWRcIilcbiAgICAgID8gY29sb3JGb3JMaW5rdGV4dChwbHVnaW4sIGhyZWYsIGFuY2hvckVsLmdldEF0dHJpYnV0ZShTT1VSQ0VfQVRUUikgPz8gXCJcIilcbiAgICAgIDogbnVsbDtcbiAgaWYgKGNvbG9yKSBhbmNob3JFbC5zdHlsZS5zZXRQcm9wZXJ0eShDT0xPUl9WQVIsIGNvbG9yKTtcbiAgZWxzZSBhbmNob3JFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShDT0xPUl9WQVIpO1xufVxuXG4vLyBCZXJlaXRzIGdlcmVuZGVydGUgTGlua3MgbmV1IGVpbmZcdTAwRTRyYmVuIChUWVAtIG9kZXIgRWluc3RlbGx1bmdzXHUwMEU0bmRlcnVuZykuIERlclxuLy8gUG9zdC1Qcm9jZXNzb3IgbWVya3Qgc2ljaCBkYWZcdTAwRkNyIGFuIGplZGVtIExpbmsgZGVzc2VuIFF1ZWxsbm90aXosIGRhIGRpZSB6dXJcbi8vIEF1ZmxcdTAwRjZzdW5nIG1laHJkZXV0aWdlciBMaW5rdGV4dGUgZ2VicmF1Y2h0IHdpcmQuIEFsbGUgRmVuc3RlciAoUG9wLW91dHMpXG4vLyBcdTAwRkNiZXIgaWhyZSBMZWF2ZXMgZWluZ2VzYW1tZWx0LlxuZnVuY3Rpb24gcmVmcmVzaFJlbmRlcmVkTGlua3MocGx1Z2luKSB7XG4gIGNvbnN0IGRvY3MgPSBuZXcgU2V0KCk7XG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLml0ZXJhdGVBbGxMZWF2ZXMoKGxlYWYpID0+IGRvY3MuYWRkKGxlYWYudmlldy5jb250YWluZXJFbC5vd25lckRvY3VtZW50KSk7XG4gIGZvciAoY29uc3QgZG9jIG9mIGRvY3MpIHtcbiAgICBmb3IgKGNvbnN0IGFuY2hvckVsIG9mIGRvYy5xdWVyeVNlbGVjdG9yQWxsKGBhLmludGVybmFsLWxpbmtbJHtTT1VSQ0VfQVRUUn1dYCkpIGFwcGx5VG9BbmNob3IocGx1Z2luLCBhbmNob3JFbCk7XG4gIH1cbn1cblxuLy8gLS0tIExpdmUgUHJldmlldyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmNvbnN0IHJlZnJlc2hFZmZlY3QgPSBTdGF0ZUVmZmVjdC5kZWZpbmUoKTtcblxuZnVuY3Rpb24gYnVpbGRMaW5rVmlld1BsdWdpbihwbHVnaW4pIHtcbiAgY29uc3QgZGVjb3JhdGlvbnNCeUNvbG9yID0gbmV3IE1hcCgpO1xuICBjb25zdCBkZWNvcmF0aW9uRm9yID0gKGNvbG9yKSA9PiB7XG4gICAgbGV0IGRlY29yYXRpb24gPSBkZWNvcmF0aW9uc0J5Q29sb3IuZ2V0KGNvbG9yKTtcbiAgICBpZiAoIWRlY29yYXRpb24pIHtcbiAgICAgIGRlY29yYXRpb24gPSBEZWNvcmF0aW9uLm1hcmsoe1xuICAgICAgICBjbGFzczogXCJmcmVkLXR5cC1saW5rXCIsXG4gICAgICAgIGF0dHJpYnV0ZXM6IHsgc3R5bGU6IGAke0NPTE9SX1ZBUn06ICR7Y29sb3J9O2AgfSxcbiAgICAgIH0pO1xuICAgICAgZGVjb3JhdGlvbnNCeUNvbG9yLnNldChjb2xvciwgZGVjb3JhdGlvbik7XG4gICAgfVxuICAgIHJldHVybiBkZWNvcmF0aW9uO1xuICB9O1xuXG4gIGNvbnN0IGJ1aWxkID0gKHZpZXcpID0+IHtcbiAgICBpZiAoIXBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmxpbmtzKSByZXR1cm4gRGVjb3JhdGlvbi5ub25lO1xuICAgIGNvbnN0IHNvdXJjZVBhdGggPSB2aWV3LnN0YXRlLmZpZWxkKGVkaXRvckluZm9GaWVsZCwgZmFsc2UpPy5maWxlPy5wYXRoID8/IFwiXCI7XG4gICAgY29uc3QgdHJlZSA9IHN5bnRheFRyZWUodmlldy5zdGF0ZSk7XG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyBSYW5nZVNldEJ1aWxkZXIoKTtcblxuICAgIGZvciAoY29uc3QgeyBmcm9tLCB0byB9IG9mIHZpZXcudmlzaWJsZVJhbmdlcykge1xuICAgICAgY29uc3QgdGV4dCA9IHZpZXcuc3RhdGUuc2xpY2VEb2MoZnJvbSwgdG8pO1xuICAgICAgV0lLSUxJTktfUEFUVEVSTi5sYXN0SW5kZXggPSAwO1xuICAgICAgZm9yIChsZXQgbWF0Y2g7IChtYXRjaCA9IFdJS0lMSU5LX1BBVFRFUk4uZXhlYyh0ZXh0KSk7ICkge1xuICAgICAgICBjb25zdCBzdGFydCA9IGZyb20gKyBtYXRjaC5pbmRleDtcbiAgICAgICAgLy8gTnVyLCB3YXMgT2JzaWRpYW5zIE1hcmtkb3duLVBhcnNlciBzZWxic3QgYWxzIGludGVybmVuIExpbmsgZXJrZW5udCAtXG4gICAgICAgIC8vIHNjaGxpZVx1MDBERnQgei4gQi4gW1tcdTIwMjZdXSBpbiBDb2RlLUJsXHUwMEY2Y2tlbiBvZGVyIElubGluZS1Db2RlIGF1cy5cbiAgICAgICAgaWYgKCF0cmVlLnJlc29sdmVJbm5lcihzdGFydCArIDIsIDEpLm5hbWUuaW5jbHVkZXMoXCJobWQtaW50ZXJuYWwtbGlua1wiKSkgY29udGludWU7XG4gICAgICAgIGNvbnN0IGNvbG9yID0gY29sb3JGb3JMaW5rdGV4dChwbHVnaW4sIG1hdGNoWzFdLCBzb3VyY2VQYXRoKTtcbiAgICAgICAgaWYgKGNvbG9yKSBidWlsZGVyLmFkZChzdGFydCwgc3RhcnQgKyBtYXRjaFswXS5sZW5ndGgsIGRlY29yYXRpb25Gb3IoY29sb3IpKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGJ1aWxkZXIuZmluaXNoKCk7XG4gIH07XG5cbiAgcmV0dXJuIFZpZXdQbHVnaW4uZnJvbUNsYXNzKFxuICAgIGNsYXNzIHtcbiAgICAgIGNvbnN0cnVjdG9yKHZpZXcpIHtcbiAgICAgICAgdGhpcy5kZWNvcmF0aW9ucyA9IGJ1aWxkKHZpZXcpO1xuICAgICAgfVxuXG4gICAgICAvLyBEZXIgUGFyc2VyIGFyYmVpdGV0IGRlbiBzaWNodGJhcmVuIEJlcmVpY2ggZ2dmLiBlcnN0IG5hY2ggdW5kIG5hY2ggYWIgLVxuICAgICAgLy8gZWluIG5ldWVyIFN5bnRheGJhdW0gelx1MDBFNGhsdCBkYWhlciBlYmVuZmFsbHMgYWxzIEFubGFzcyB6dW0gTmV1YXVmYmF1LlxuICAgICAgdXBkYXRlKHVwZGF0ZSkge1xuICAgICAgICBpZiAoXG4gICAgICAgICAgdXBkYXRlLmRvY0NoYW5nZWQgfHxcbiAgICAgICAgICB1cGRhdGUudmlld3BvcnRDaGFuZ2VkIHx8XG4gICAgICAgICAgc3ludGF4VHJlZSh1cGRhdGUuc3RhcnRTdGF0ZSkgIT09IHN5bnRheFRyZWUodXBkYXRlLnN0YXRlKSB8fFxuICAgICAgICAgIHVwZGF0ZS50cmFuc2FjdGlvbnMuc29tZSgodHIpID0+IHRyLmVmZmVjdHMuc29tZSgoZWZmZWN0KSA9PiBlZmZlY3QuaXMocmVmcmVzaEVmZmVjdCkpKVxuICAgICAgICApIHtcbiAgICAgICAgICB0aGlzLmRlY29yYXRpb25zID0gYnVpbGQodXBkYXRlLnZpZXcpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSxcbiAgICB7IGRlY29yYXRpb25zOiAodmFsdWUpID0+IHZhbHVlLmRlY29yYXRpb25zIH1cbiAgKTtcbn1cblxuZnVuY3Rpb24gcmVmcmVzaEVkaXRvcnMocGx1Z2luKSB7XG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLml0ZXJhdGVBbGxMZWF2ZXMoKGxlYWYpID0+IHtcbiAgICBsZWFmLnZpZXc/LmVkaXRvcj8uY20/LmRpc3BhdGNoKHsgZWZmZWN0czogcmVmcmVzaEVmZmVjdC5vZihudWxsKSB9KTtcbiAgfSk7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5mdW5jdGlvbiByZWdpc3RlckxpbmtDb2xvcnMocGx1Z2luKSB7XG4gIHBsdWdpbi5yZWdpc3Rlck1hcmtkb3duUG9zdFByb2Nlc3NvcigoZWwsIGN0eCkgPT4ge1xuICAgIC8vIFF1ZWxsZSBpbW1lciB2ZXJtZXJrZW4sIGF1Y2ggYmVpIGF1c2dlc2NoYWx0ZXRlciBFaW5mXHUwMEU0cmJ1bmcgLSBzbyBncmVpZnRcbiAgICAvLyBlaW4gc3BcdTAwRTR0ZXJlcyBFaW5zY2hhbHRlbiBhdWNoIGZcdTAwRkNyIGJlcmVpdHMgZ2VyZW5kZXJ0ZSBMaW5rcy5cbiAgICBmb3IgKGNvbnN0IGFuY2hvckVsIG9mIGVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCJhLmludGVybmFsLWxpbmtcIikpIHtcbiAgICAgIGFuY2hvckVsLnNldEF0dHJpYnV0ZShTT1VSQ0VfQVRUUiwgY3R4LnNvdXJjZVBhdGgpO1xuICAgICAgYXBwbHlUb0FuY2hvcihwbHVnaW4sIGFuY2hvckVsKTtcbiAgICB9XG4gIH0pO1xuICAvLyBPYnNpZGlhbnMgU3ludGF4LVNwYW4gXCIuY20taG1kLWludGVybmFsLWxpbmtcIiBsaWVndCB1bmFiaFx1MDBFNG5naWcgdm9uIGRlclxuICAvLyBQcmlvcml0XHUwMEU0dCBpbW1lciBhdVx1MDBERmVuLCBkaWUgTWFya2llcnVuZyBhbHNvIGRhcmluIC0gZGllIEZhcmJlIHNldHp0IGRhaGVyXG4gIC8vIGVpbmUgZWlnZW5lIFJlZ2VsIGluIHN0eWxlcy5jc3MgKC5mcmVkLXR5cC1saW5rKS4gTmllZHJpZ3N0ZSBQcmlvcml0XHUwMEU0dCBsZWd0XG4gIC8vIHNpZSBpbW1lcmhpbiB1bSBcIi5jbS11bmRlcmxpbmVcIiBoZXJ1bSwgZGFtaXQgZGVyIGdhbnplIExpbmt0ZXh0IGVyZmFzc3QgaXN0LlxuICBwbHVnaW4ucmVnaXN0ZXJFZGl0b3JFeHRlbnNpb24oUHJlYy5sb3dlc3QoYnVpbGRMaW5rVmlld1BsdWdpbihwbHVnaW4pKSk7XG5cbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IHtcbiAgICByZWZyZXNoUmVuZGVyZWRMaW5rcyhwbHVnaW4pO1xuICAgIHJlZnJlc2hFZGl0b3JzKHBsdWdpbik7XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIC8vIERpZSBFZGl0b3ItRGVrb3JhdGlvbmVuIHZlcnNjaHdpbmRlbiBiZWltIEVudGxhZGVuIG1pdCBkZXIgRXJ3ZWl0ZXJ1bmcgdm9uXG4gIC8vIHNlbGJzdCwgZGllIElubGluZS1WYXJpYWJsZW4gYW4gZ2VyZW5kZXJ0ZW4gTGlua3MgbmljaHQuXG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiB7XG4gICAgcGx1Z2luLmFwcC53b3Jrc3BhY2UuaXRlcmF0ZUFsbExlYXZlcygobGVhZikgPT4ge1xuICAgICAgZm9yIChjb25zdCBhbmNob3JFbCBvZiBsZWFmLnZpZXcuY29udGFpbmVyRWwucXVlcnlTZWxlY3RvckFsbChgYS5pbnRlcm5hbC1saW5rWyR7U09VUkNFX0FUVFJ9XWApKSB7XG4gICAgICAgIGFuY2hvckVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KENPTE9SX1ZBUik7XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyTGlua0NvbG9ycyB9O1xuIiwgImNvbnN0IHsgZ2V0U3VidHlwZU5hbWVzLCBnZXRTdWJ0eXBlIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBlc1wiKTtcclxuY29uc3QgeyBzdWJ0eXBlQ29sb3IgfSA9IHJlcXVpcmUoXCIuL3R5cGUtY29sb3JzXCIpO1xyXG5cclxuY29uc3QgVFlQX1BST1BFUlRZID0gXCJUWVBcIjtcclxuY29uc3QgVFlQX1ZJRVdfVFlQRSA9IFwiZnJlZC10eXAtdmlld1wiO1xyXG5jb25zdCBBTExfUFJPUEVSVElFU19WSUVXX1RZUEUgPSBcImFsbC1wcm9wZXJ0aWVzXCI7XHJcbmNvbnN0IEhJR0hMSUdIVF9DTEFTUyA9IFwiZnJlZC10eXAtZGVmYXVsdC1wcm9wZXJ0eVwiO1xyXG4vLyBGbG9hdGluZyBQcm9wZXJ0aWVzIChzaWVoZSB0eXBlRmxvYXRpbmdLZXlzIGluIHNldHRpbmdzLmpzKSAtIGRpZXNlbGJlXHJcbi8vIExpc3RlIHdpZSBkaWUgXHUwMEZDYnJpZ2VuIFN0YW5kYXJkLVByb3BlcnRpZXMgZGVzIFR5cHMsIGFiZXIga3Vyc2l2IHN0YXR0IGZldHRcclxuLy8gbWFya2llcnQsIGFuYWxvZyB6dSBISUdITElHSFRfQ0xBU1MuXHJcbmNvbnN0IEZMT0FUSU5HX0NMQVNTID0gXCJmcmVkLXR5cC1mbG9hdGluZy1wcm9wZXJ0eVwiO1xyXG5cclxuLy8gT2JzaWRpYW4gc2NocmVpYnQgZGF0YS1wcm9wZXJ0eS1rZXkgaW50ZXJuIGltbWVyIGtsZWluICh1bmFiaFx1MDBFNG5naWcgdm9uIGRlclxyXG4vLyBTY2hyZWlid2Vpc2UgaW0gWUFNTCkgLSBWZXJnbGVpY2ggZGVzaGFsYiBlYmVuZmFsbHMgY2FzZS1pbnNlbnNpdGl2ZS4gVFlQXHJcbi8vIGlzdCBrZWluZSBlY2h0ZSBcIlN0YW5kYXJkXCItUHJvcGVydHkgKGlociBXZXJ0IGlzdCBpbW1lciBkZXIgVFlQLU5hbWVcclxuLy8gc2VsYnN0KSAtIGZhbGxzIGRvY2ggbm9jaCBpcmdlbmR3byBlaW4gYWx0ZXIgRWludHJhZyBoZXJ1bWxpZWd0LCBoaWVyXHJcbi8vIGViZW5mYWxscyBpZ25vcmllcmVuIHN0YXR0IGRpZSBUWVAtWmVpbGUgZmV0dCB6dSBtYXJraWVyZW4uXHJcbmZ1bmN0aW9uIHJhd0tleXNGb3JUeXBlKHR5cGUsIGRlZmF1bHRzKSB7XHJcbiAgaWYgKCF0eXBlIHx8ICFkZWZhdWx0cykgcmV0dXJuIG51bGw7XHJcbiAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKGRlZmF1bHRzKS5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBcIlwiICYmIGtleS50b0xvd2VyQ2FzZSgpICE9PSBUWVBfUFJPUEVSVFkudG9Mb3dlckNhc2UoKSk7XHJcbiAgcmV0dXJuIGtleXMubGVuZ3RoID4gMCA/IGtleXMubWFwKChrZXkpID0+IGtleS50b0xvd2VyQ2FzZSgpKSA6IG51bGw7XHJcbn1cclxuXHJcbi8vIEZyb250bWF0dGVyLUJsXHUwMEY2Y2tlIGVpbmVzIFRZUHMgYWxzIExpc3RlIHZvbiB7IGtleXMsIGZsb2F0aW5nIH0gKGpld2VpbHNcclxuLy8gbG93ZXJjYXNlKTogenVlcnN0IGRhcyBUWVAtRnJvbnRtYXR0ZXIgZGVzIFRZUHMsIGRhbmFjaCAtIGZhbGxzXHJcbi8vIGdld1x1MDBGQ25zY2h0IC0gZGVyIEJsb2NrIGVpbmVzIGJlc3RpbW10ZW4gU3VidHlwcyAoc3VidHlwZSkgYnp3LiBhbGxlciBzZWluZXJcclxuLy8gU3VidHlwZW4gKHN1YnR5cGUgPT09IEFMTF9TVUJUWVBFUyksIHNpZWhlIHN1YnR5cGVzLmpzLlxyXG5jb25zdCBBTExfU1VCVFlQRVMgPSBTeW1ib2woXCJhbGwtc3VidHlwZXNcIik7XHJcblxyXG5mdW5jdGlvbiBibG9ja09mKGRlZmF1bHRzLCBmbG9hdGluZ0tleXMsIHNlY3Rpb24gPSBudWxsKSB7XHJcbiAgY29uc3Qga2V5cyA9IHJhd0tleXNGb3JUeXBlKHRydWUsIGRlZmF1bHRzKSA/PyBbXTtcclxuICByZXR1cm4geyBzZWN0aW9uLCBrZXlzLCBmbG9hdGluZzogbmV3IFNldCgoZmxvYXRpbmdLZXlzID8/IFtdKS5tYXAoKGtleSkgPT4ga2V5LnRvTG93ZXJDYXNlKCkpKSB9O1xyXG59XHJcblxyXG5mdW5jdGlvbiBibG9ja3NGb3JUeXBlKHBsdWdpbiwgdHlwZSwgc3VidHlwZSkge1xyXG4gIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHBsdWdpbjtcclxuICBjb25zdCBibG9ja3MgPSBbYmxvY2tPZihzZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdLCBzZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdLCBudWxsKV07XHJcbiAgY29uc3Qgc3VidHlwZU5hbWVzID0gc3VidHlwZSA9PT0gQUxMX1NVQlRZUEVTID8gZ2V0U3VidHlwZU5hbWVzKHNldHRpbmdzLCB0eXBlKSA6IHN1YnR5cGUgPyBbc3VidHlwZV0gOiBbXTtcclxuICBmb3IgKGNvbnN0IG5hbWUgb2Ygc3VidHlwZU5hbWVzKSB7XHJcbiAgICBjb25zdCBkYXRhID0gZ2V0U3VidHlwZShzZXR0aW5ncywgdHlwZSwgbmFtZSk7XHJcbiAgICBpZiAoZGF0YSkgYmxvY2tzLnB1c2goYmxvY2tPZihkYXRhLmZyb250bWF0dGVyLCBkYXRhLmZsb2F0aW5nS2V5cywgbmFtZSkpO1xyXG4gIH1cclxuICByZXR1cm4gYmxvY2tzO1xyXG59XHJcblxyXG4vLyBMaWVmZXJ0IGdldHJlbm50ZSBTZXRzIGZcdTAwRkNyIGZldHQgZGFyenVzdGVsbGVuZGUgKFwic3RhbmRhcmRcIikgdW5kIGt1cnNpdlxyXG4vLyBkYXJ6dXN0ZWxsZW5kZSAoXCJmbG9hdGluZ1wiKSBQcm9wZXJ0eS1OYW1lbiAoamV3ZWlscyBsb3dlcmNhc2UpIGF1cyBkZW5cclxuLy8gXHUwMEZDYmVyZ2ViZW5lbiBCbFx1MDBGNmNrZW4gLSBGbG9hdGluZy1tYXJraWVydGUgS2V5cyB6XHUwMEU0aGxlbiBkYWJlaSBudXIgenVcclxuLy8gXCJmbG9hdGluZ1wiLCBuaWUgenVzXHUwMEU0dHpsaWNoIHp1IFwic3RhbmRhcmRcIi4gS29tbXQgZWluIEtleSBpbiBtZWhyZXJlbiBCbFx1MDBGNmNrZW5cclxuLy8gdm9yLCBnaWx0IGRpZSBNYXJraWVydW5nIGRlcyBzcFx1MDBFNHRlcmVuIEJsb2NrczogZlx1MDBGQ3IgZWluZSBOb3RpeiBzaW5kIGRhc1xyXG4vLyBUWVAtRnJvbnRtYXR0ZXIgdW5kIGRhbmFjaCBkZXIgQmxvY2sgaWhyZXMgU1VCVFlQcywgZGVyIFN1YnR5cCBnZXdpbm50IGFsc29cclxuLy8gLSBkaWVzZWxiZSBSZWdlbCB3aWUgYmVpbSBXZXJ0IGluIGdldFR5cGVEZWZhdWx0cyAobWFpbi5qcykuXHJcbmZ1bmN0aW9uIHNwbGl0S2V5cyhibG9ja3MpIHtcclxuICBjb25zdCBpc0Zsb2F0aW5nID0gbmV3IE1hcCgpO1xyXG4gIGZvciAoY29uc3QgeyBrZXlzLCBmbG9hdGluZyB9IG9mIGJsb2Nrcykge1xyXG4gICAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykgaXNGbG9hdGluZy5zZXQoa2V5LCBmbG9hdGluZy5oYXMoa2V5KSk7XHJcbiAgfVxyXG4gIGNvbnN0IHN0YW5kYXJkID0gbmV3IFNldCgpO1xyXG4gIGNvbnN0IGZsb2F0aW5nID0gbmV3IFNldCgpO1xyXG4gIGZvciAoY29uc3QgW2tleSwgZmxhZ10gb2YgaXNGbG9hdGluZykgKGZsYWcgPyBmbG9hdGluZyA6IHN0YW5kYXJkKS5hZGQoa2V5KTtcclxuICByZXR1cm4geyBzdGFuZGFyZDogc3RhbmRhcmQuc2l6ZSA+IDAgPyBzdGFuZGFyZCA6IG51bGwsIGZsb2F0aW5nOiBmbG9hdGluZy5zaXplID4gMCA/IGZsb2F0aW5nIDogbnVsbCB9O1xyXG59XHJcblxyXG5jb25zdCBOT19LRVlTID0geyBzdGFuZGFyZDogbnVsbCwgZmxvYXRpbmc6IG51bGwgfTtcclxuXHJcbmZ1bmN0aW9uIGtleXNGb3JGaWxlKHBsdWdpbiwgZmlsZSkge1xyXG4gIGNvbnN0IHsgY29sb3JWaWV3cyB9ID0gcGx1Z2luLnNldHRpbmdzO1xyXG4gIGlmICghY29sb3JWaWV3cy5mcm9udG1hdHRlckRlZmF1bHRzKSByZXR1cm4gTk9fS0VZUztcclxuICBjb25zdCB0eXBlID0gcGx1Z2luLnR5cEluZGV4LnR5cGVPZihmaWxlKTtcclxuICBpZiAoIXR5cGUpIHJldHVybiBOT19LRVlTO1xyXG4gIGNvbnN0IHN1YnR5cGUgPSBjb2xvclZpZXdzLmZyb250bWF0dGVyRGVmYXVsdHNTdWJ0eXAgPyBwbHVnaW4udHlwSW5kZXguc3VidHlwZU9mKGZpbGUpIDogbnVsbDtcclxuICByZXR1cm4gc3BsaXRLZXlzKGJsb2Nrc0ZvclR5cGUocGx1Z2luLCB0eXBlLCBzdWJ0eXBlKSk7XHJcbn1cclxuXHJcbi8vIEVkaXRvciBkZXIgVFlQLURldGFpbGFuc2ljaHQ6IGplIEJsb2NrIGVpbmUgZWlnZW5lIEVkaXRvci1JbnN0YW56IChzaWVoZVxyXG4vLyB0eXBlU3RvcmUvc3VidHlwZVN0b3JlIGluIHR5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKSwgZGllIE1hcmtpZXJ1bmcgemVpZ3RcclxuLy8gYWxzbyBnZW5hdSBkaWUgU3RhbmRhcmQtL0Zsb2F0aW5nLVByb3BlcnRpZXMgZGllc2VzIGVpbmVuIEJsb2NrcyAtXHJcbi8vIFN1YnR5cC1CbFx1MDBGNmNrZSBudXIgbWl0IGRlbSBVbnRlci1TY2hhbHRlciBcIlN1YnR5cFwiLlxyXG5mdW5jdGlvbiBrZXlzRm9yU3RvcmUocGx1Z2luLCBzdG9yZSkge1xyXG4gIGNvbnN0IHsgY29sb3JWaWV3cyB9ID0gcGx1Z2luLnNldHRpbmdzO1xyXG4gIGlmICghY29sb3JWaWV3cy5mcm9udG1hdHRlckRlZmF1bHRzIHx8ICFzdG9yZSkgcmV0dXJuIE5PX0tFWVM7XHJcbiAgaWYgKHN0b3JlLnN1YnR5cGUgJiYgIWNvbG9yVmlld3MuZnJvbnRtYXR0ZXJEZWZhdWx0c1N1YnR5cCkgcmV0dXJuIE5PX0tFWVM7XHJcbiAgcmV0dXJuIHNwbGl0S2V5cyhbYmxvY2tPZihzdG9yZS5nZXRGcm9udG1hdHRlcigpLCBzdG9yZS5nZXRGbG9hdGluZygpKV0pO1xyXG59XHJcblxyXG4vLyBQcm9wZXJ0eS1OYW1lIChsb3dlcmNhc2UpIC0+IHsgdHlwZXMsIGFsbEZsb2F0aW5nIH0gXHUwMEZDYmVyIGFsbGUgVHlwZW4sIGluXHJcbi8vIGRlcmVuIEZyb250bWF0dGVyIChnZ2YuIGlua2wuIGlocmVyIFN1YnR5cC1CbFx1MDBGNmNrZSkgZXIgdm9ya29tbXQuIERpZSBcIkFsbFxyXG4vLyBQcm9wZXJ0aWVzXCItQW5zaWNodCBpc3QgdmF1bHQtd2VpdCB1bmQga2VubnQga2VpbmVuIGVpbnplbG5lbiBUWVAtS29udGV4dCAtXHJcbi8vIGRhaGVyIGhpZXIgZ2xlaWNoIGRpZSB2b2xsc3RcdTAwRTRuZGlnZSBadW9yZG51bmcgc2FtbWVsbiwgZGFtaXRcclxuLy8gYXBwbHlUb0FsbFByb3BlcnRpZXNWaWV3IHp3aXNjaGVuIFwiZ2VuYXUgZWluIFR5cFwiIChlaW5mXHUwMEU0cmJlbikgdW5kIFwibWVocmVyZVxyXG4vLyBUeXBlblwiIChmZXR0KSB1bnRlcnNjaGVpZGVuIGthbm4uIHR5cGVzIGlzdCBNYXAoVFlQIC0+IExpc3RlIGRlciBCbFx1MDBGNmNrZSxcclxuLy8gZGllIGRlbiBLZXkgZlx1MDBGQ2hyZW47IG51bGwgc3RlaHQgZlx1MDBGQ3IgZGFzIFRZUC1Gcm9udG1hdHRlcikgLSBlaW4gS2V5IGRhcmYgaW5cclxuLy8gbWVocmVyZW4gQmxcdTAwRjZja2VuIGVpbmVzIFRZUHMgc3RlaGVuLCBlaW5nZWZcdTAwRTRyYnQgd2lyZCBudXIgZGVyIGVpbmRldXRpZ2VcclxuLy8gRmFsbC4gYWxsRmxvYXRpbmcgaXN0IHRydWUsIHdlbm4gZGVyIEtleSBpbiBKRURFTSBCbG9jayBKRURFUyBUeXBzIGFsc1xyXG4vLyBGbG9hdGluZyBtYXJraWVydCBpc3QgKHNvbnN0IHdcdTAwRTRyZSBkaWUgS3Vyc2l2LU1hcmtpZXJ1bmcgaXJyZWZcdTAwRkNocmVuZCkuXHJcbi8vXHJcbi8vIEVpZ2VuZXIgU2NoYWx0ZXIgKGNvbG9yVmlld3MuYWxsUHJvcGVydGllcyksIHVuYWJoXHUwMEU0bmdpZyB2b25cclxuLy8gY29sb3JWaWV3cy5mcm9udG1hdHRlckRlZmF1bHRzLiBFaW5lIFN1YnR5cC1Qcm9wZXJ0eSB6XHUwMEU0aGx0IGZcdTAwRkNyIGlocmVuIFRZUC5cclxuZnVuY3Rpb24gdHlwZXNVc2luZ0tleU1hcChwbHVnaW4pIHtcclxuICBjb25zdCBtYXAgPSBuZXcgTWFwKCk7XHJcbiAgY29uc3QgeyBjb2xvclZpZXdzIH0gPSBwbHVnaW4uc2V0dGluZ3M7XHJcbiAgaWYgKCFjb2xvclZpZXdzLmFsbFByb3BlcnRpZXMpIHJldHVybiBtYXA7XHJcbiAgY29uc3QgdHlwZXMgPSBuZXcgU2V0KFtcclxuICAgIC4uLk9iamVjdC5rZXlzKHBsdWdpbi5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyKSxcclxuICAgIC4uLihjb2xvclZpZXdzLmFsbFByb3BlcnRpZXNTdWJ0eXAgPyBPYmplY3Qua2V5cyhwbHVnaW4uc2V0dGluZ3MudHlwZVN1YnR5cGVzID8/IHt9KSA6IFtdKSxcclxuICBdKTtcclxuICBmb3IgKGNvbnN0IHR5cGUgb2YgdHlwZXMpIHtcclxuICAgIGNvbnN0IGJsb2NrcyA9IGJsb2Nrc0ZvclR5cGUocGx1Z2luLCB0eXBlLCBjb2xvclZpZXdzLmFsbFByb3BlcnRpZXNTdWJ0eXAgPyBBTExfU1VCVFlQRVMgOiBudWxsKTtcclxuICAgIGZvciAoY29uc3QgeyBzZWN0aW9uLCBrZXlzLCBmbG9hdGluZyB9IG9mIGJsb2Nrcykge1xyXG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBrZXlzKSB7XHJcbiAgICAgICAgaWYgKCFtYXAuaGFzKGtleSkpIG1hcC5zZXQoa2V5LCB7IHR5cGVzOiBuZXcgTWFwKCksIGFsbEZsb2F0aW5nOiB0cnVlIH0pO1xyXG4gICAgICAgIGNvbnN0IGVudHJ5ID0gbWFwLmdldChrZXkpO1xyXG4gICAgICAgIGlmICghZW50cnkudHlwZXMuaGFzKHR5cGUpKSBlbnRyeS50eXBlcy5zZXQodHlwZSwgW10pO1xyXG4gICAgICAgIGVudHJ5LnR5cGVzLmdldCh0eXBlKS5wdXNoKHNlY3Rpb24pO1xyXG4gICAgICAgIGVudHJ5LmFsbEZsb2F0aW5nID0gZW50cnkuYWxsRmxvYXRpbmcgJiYgZmxvYXRpbmcuaGFzKGtleSk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcbiAgcmV0dXJuIG1hcDtcclxufVxyXG5cclxuLy8gTnVyIGRhcyBMYWJlbCAoUHJvcGVydHktS2V5LUlucHV0KSBmZXR0L2t1cnNpdiBtYXJraWVyZW4sIG5pY2h0IGRpZSBXZXJ0ZSAtXHJcbi8vIGJldHJpZmZ0IHNvd29obCBOb3RpemVuIChGcm9udG1hdHRlciBpbSBEb2t1bWVudCArIFwiUHJvcGVydGllc1wiLVxyXG4vLyBTZWl0ZW5sZWlzdGUpIGFscyBhdWNoIGRpZSBlaWdlbmUgVFlQLURldGFpbGFuc2ljaHQgZGVzIFBsdWdpbnMgc2VsYnN0LlxyXG5mdW5jdGlvbiBhcHBseVRvQ29udGFpbmVyKGNvbnRhaW5lckVsLCBzdGFuZGFyZEtleXMsIGZsb2F0aW5nS2V5cykge1xyXG4gIGlmICghY29udGFpbmVyRWwpIHJldHVybjtcclxuICBjb25zdCByb3dzID0gY29udGFpbmVyRWwucXVlcnlTZWxlY3RvckFsbChcIi5tZXRhZGF0YS1wcm9wZXJ0eVtkYXRhLXByb3BlcnR5LWtleV1cIik7XHJcbiAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xyXG4gICAgY29uc3Qga2V5RWwgPSByb3cucXVlcnlTZWxlY3RvcihcIi5tZXRhZGF0YS1wcm9wZXJ0eS1rZXktaW5wdXRcIik7XHJcbiAgICBpZiAoIWtleUVsKSBjb250aW51ZTtcclxuICAgIGNvbnN0IHByb3BlcnR5S2V5ID0gcm93LmdldEF0dHJpYnV0ZShcImRhdGEtcHJvcGVydHkta2V5XCIpO1xyXG4gICAga2V5RWwuY2xhc3NMaXN0LnRvZ2dsZShISUdITElHSFRfQ0xBU1MsICEhc3RhbmRhcmRLZXlzICYmIHN0YW5kYXJkS2V5cy5oYXMocHJvcGVydHlLZXkpKTtcclxuICAgIGtleUVsLmNsYXNzTGlzdC50b2dnbGUoRkxPQVRJTkdfQ0xBU1MsICEhZmxvYXRpbmdLZXlzICYmIGZsb2F0aW5nS2V5cy5oYXMocHJvcGVydHlLZXkpKTtcclxuICB9XHJcbn1cclxuXHJcbi8vIERpZSBcIkFsbCBQcm9wZXJ0aWVzXCItQW5zaWNodCByZW5kZXJ0IGlocmUgWmVpbGVuIG5pY2h0IFx1MDBGQ2JlciBkYXNcclxuLy8gTWV0YWRhdGEtV2lkZ2V0LCBzb25kZXJuIFx1MDBGQ2JlciBlaWdlbmUgVHJlZS1JdGVtLUtvbXBvbmVudGVuIChLbGFzc2UgXCJhSFwiIGltXHJcbi8vIGdlYmF1dGVuIGFwcC5qcyksIGVycmVpY2hiYXIgXHUwMEZDYmVyIHZpZXcuZG9tcyAoUHJvcGVydHktTmFtZSAtPiBLb21wb25lbnRlKS5cclxuLy8gRGVyZW4gVGl0ZWwtRWxlbWVudCB0clx1MDBFNGd0IGRpZSBLbGFzc2UgXCJ0cmVlLWl0ZW0taW5uZXItdGV4dFwiLCBuaWNodFxyXG4vLyBcIi5tZXRhZGF0YS1wcm9wZXJ0eS1rZXktaW5wdXRcIiB3aWUgaW0gRnJvbnRtYXR0ZXItV2lkZ2V0LlxyXG4vL1xyXG4vLyBOdXR6dCBnZW5hdSBlaW4gVHlwIGRpZXNlIFByb3BlcnR5IGFscyBTdGFuZGFyZCwgd2lyZCBkZXIgTmFtZSBpbiBkZXNzZW5cclxuLy8gRmFyYmUgZWluZ2VmXHUwMEU0cmJ0ICh3aWUgZGVyIEZhcmJwdW5rdC9kaWUgTGlzdGUgZGVzIFR5cHMpIC0gZWluZGV1dGlnIGdlbnVnLFxyXG4vLyB1bSBzaWUgenV6dW9yZG5lbi4gTnV0emVuIG1laHJlcmUgVHlwZW4gc2llLCB3XHUwMEU0cmUgZWluZSBlaW56ZWxuZSBGYXJiZVxyXG4vLyBpcnJlZlx1MDBGQ2hyZW5kLCBkYWhlciBzdGF0dGRlc3NlbiBmZXR0IChkaWVzZWxiZSBNYXJraWVydW5nIHdpZSBpbVxyXG4vLyBGcm9udG1hdHRlci1XaWRnZXQgZWluZXIgTm90aXopLlxyXG5mdW5jdGlvbiBhcHBseVRvQWxsUHJvcGVydGllc1ZpZXcocGx1Z2luKSB7XHJcbiAgY29uc3QgdXNhZ2VNYXAgPSB0eXBlc1VzaW5nS2V5TWFwKHBsdWdpbik7XHJcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShBTExfUFJPUEVSVElFU19WSUVXX1RZUEUpKSB7XHJcbiAgICBjb25zdCBkb21zID0gbGVhZi52aWV3Py5kb21zO1xyXG4gICAgaWYgKCFkb21zKSBjb250aW51ZTtcclxuICAgIGZvciAoY29uc3QgW2tleSwgZG9tXSBvZiBPYmplY3QuZW50cmllcyhkb21zKSkge1xyXG4gICAgICBjb25zdCB0aXRsZUVsID0gZG9tPy50aXRsZUVsO1xyXG4gICAgICBpZiAoIXRpdGxlRWwpIGNvbnRpbnVlO1xyXG5cclxuICAgICAgY29uc3QgZW50cnkgPSB1c2FnZU1hcC5nZXQoa2V5LnRvTG93ZXJDYXNlKCkpO1xyXG4gICAgICBjb25zdCB0eXBlcyA9IGVudHJ5Py50eXBlcztcclxuICAgICAgY29uc3QgY291bnQgPSB0eXBlcyA/IHR5cGVzLnNpemUgOiAwO1xyXG4gICAgICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoSElHSExJR0hUX0NMQVNTLCBjb3VudCA+IDEpO1xyXG5cclxuICAgICAgLy8gS3Vyc2l2LCBzb2JhbGQgZGllIFByb3BlcnR5IFx1MDBEQ0JFUkFMTCBhbHMgRmxvYXRpbmcgbWFya2llcnQgaXN0IC0gaW5cclxuICAgICAgLy8gamVkZW0gQmxvY2sgamVkZXMgVFlQcywgZGVyIHNpZSBmXHUwMEZDaHJ0LiBBbmRlcnMgYWxzIGRpZSBGZXR0LU1hcmtpZXJ1bmdcclxuICAgICAgLy8gaXN0IGRhcyBuaWNodCBhdWYgXCJnZW5hdSBlaW4gVFlQXCIgYmVzY2hyXHUwMEU0bmt0OiBiZWlkZXMga2FubiBhbHNvXHJcbiAgICAgIC8vIHp1c2FtbWVudHJlZmZlbiAobWVocmVyZSBUWVBlbiwgZG9ydCBkdXJjaHdlZyBmbG9hdGluZykuXHJcbiAgICAgIHRpdGxlRWwuY2xhc3NMaXN0LnRvZ2dsZShGTE9BVElOR19DTEFTUywgY291bnQgPiAwICYmIGVudHJ5LmFsbEZsb2F0aW5nKTtcclxuXHJcbiAgICAgIC8vIE1pdCBcIlN1YnR5cFwiIGluIGRlciBGYXJiZSBkZXMgU3VidHlwLUJsb2NrcywgYXVzIGRlbSBkaWUgUHJvcGVydHlcclxuICAgICAgLy8gc3RhbW10IC0gYWJlciBudXIsIHdlbm4gc2llIGluIGdlbmF1IGVpbmVtIEJsb2NrIGRpZXNlcyBUWVBzIHN0ZWh0LlxyXG4gICAgICAvLyBCZWkgZWluZXIgRG9wcGx1bmcgXHUwMEZDYmVyIG1laHJlcmUgQmxcdTAwRjZja2Ugd1x1MDBFNHJlIGRpZSBXYWhsIHdpbGxrXHUwMEZDcmxpY2ggdW5kXHJcbiAgICAgIC8vIHdcdTAwRkNyZGUgc2ljaCBiZWltIFVtc29ydGllcmVuIGRlciBCbFx1MDBGNmNrZSBcdTAwRTRuZGVybiwgZGFoZXIgZGFubiBkaWVcclxuICAgICAgLy8gVFlQLUZhcmJlIChzdWJ0eXBlQ29sb3IgbWl0IG51bGwgbGllZmVydCBnZW5hdSBkaWUpLlxyXG4gICAgICBpZiAoY291bnQgPT09IDEpIHtcclxuICAgICAgICBjb25zdCBbW29ubHlUeXBlLCBzZWN0aW9uc11dID0gdHlwZXM7XHJcbiAgICAgICAgY29uc3QgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5hbGxQcm9wZXJ0aWVzU3VidHlwXHJcbiAgICAgICAgICA/IHN1YnR5cGVDb2xvcihwbHVnaW4uc2V0dGluZ3MsIG9ubHlUeXBlLCBzZWN0aW9ucy5sZW5ndGggPT09IDEgPyBzZWN0aW9uc1swXSA6IG51bGwpXHJcbiAgICAgICAgICA6IHBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW29ubHlUeXBlXTtcclxuICAgICAgICAvLyAhaW1wb3J0YW50IHZpYSBzZXRQcm9wZXJ0eSwgZGEgZGllIEZldHQtUmVnZWwgZlx1MDBGQ3IgLmZyZWQtdHlwLWRlZmF1bHQtXHJcbiAgICAgICAgLy8gcHJvcGVydHkgaW4gc3R5bGVzLmNzcyBlYmVuZmFsbHMgIWltcG9ydGFudCBjb2xvciBzZXR6dCB1bmQgZWluXHJcbiAgICAgICAgLy8gSW5saW5lLVN0eWxlIG9obmUgIWltcG9ydGFudCBkYWdlZ2VuIHZlcmxpZXJlbiB3XHUwMEZDcmRlLCBmYWxscyBkaWVcclxuICAgICAgICAvLyBLbGFzc2UgKGF1cyBlaW5lbSB2b3JoZXJpZ2VuIFp1c3RhbmQgbWl0IG1laHJlcmVuIFR5cGVuKSBub2NoIGRyYW5oXHUwMEU0bmd0LlxyXG4gICAgICAgIGlmIChjb2xvcikgdGl0bGVFbC5zdHlsZS5zZXRQcm9wZXJ0eShcImNvbG9yXCIsIGNvbG9yLCBcImltcG9ydGFudFwiKTtcclxuICAgICAgICBlbHNlIHRpdGxlRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICB0aXRsZUVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiY29sb3JcIik7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGFwcGx5RnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0KHBsdWdpbikge1xyXG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xyXG4gICAgY29uc3QgdmlldyA9IGxlYWYudmlldztcclxuICAgIGNvbnN0IHsgc3RhbmRhcmQsIGZsb2F0aW5nIH0gPSBrZXlzRm9yRmlsZShwbHVnaW4sIHZpZXc/LmZpbGUpO1xyXG4gICAgYXBwbHlUb0NvbnRhaW5lcih2aWV3Py5tZXRhZGF0YUVkaXRvcj8uY29udGFpbmVyRWwsIHN0YW5kYXJkLCBmbG9hdGluZyk7XHJcbiAgfVxyXG5cclxuICAvLyBEaWUgXCJQcm9wZXJ0aWVzXCItU2VpdGVubGVpc3RlIHplaWd0IGltbWVyIGRpZSBha3RpdmUgRGF0ZWksIGhcdTAwRTRsdCBhYmVyXHJcbiAgLy8ga2VpbmUgZWlnZW5lLCB2ZXJsXHUwMEU0c3NsaWNoZSBSZWZlcmVueiBkYXJhdWYgZ3JpZmZiZXJlaXQgd2llIE1hcmtkb3duVmlldyAtXHJcbiAgLy8gZGFoZXIgYXVmIGRpZSB2b20gV29ya3NwYWNlIGFrdHVlbGwgYWt0aXZlIERhdGVpIHp1clx1MDBGQ2NrZmFsbGVuLlxyXG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJmaWxlLXByb3BlcnRpZXNcIikpIHtcclxuICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXc7XHJcbiAgICBjb25zdCBmaWxlID0gdmlldz8uZmlsZSA/PyBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XHJcbiAgICBjb25zdCB7IHN0YW5kYXJkLCBmbG9hdGluZyB9ID0ga2V5c0ZvckZpbGUocGx1Z2luLCBmaWxlKTtcclxuICAgIGFwcGx5VG9Db250YWluZXIodmlldz8ubWV0YWRhdGFFZGl0b3I/LmNvbnRhaW5lckVsLCBzdGFuZGFyZCwgZmxvYXRpbmcpO1xyXG4gIH1cclxuXHJcbiAgLy8gVFlQLURldGFpbGFuc2ljaHQgZGVzIFBsdWdpbnMgc2VsYnN0OiBkb3J0IHplaWd0IGplZGVyIEVkaXRvciBkaXJla3QgZWluZW5cclxuICAvLyBGcm9udG1hdHRlci1CbG9jayAoVFlQIGJ6dy4gU3VidHlwKSwgZW50c3ByaWNodCBhbHNvIDE6MSBkZXNzZW5cclxuICAvLyBcIlN0YW5kYXJkXCItIGJ6dy4gXCJGbG9hdGluZ1wiLVByb3BlcnRpZXMgKHZpZXcuZnJvbnRtYXR0ZXJFZGl0b3JzIGtvbW10IGF1c1xyXG4gIC8vIHR5cC12aWV3LmpzLCBlZGl0b3Iub3duZXIuZnJlZFN0b3JlIGF1cyB0eXBlLWZyb250bWF0dGVyLWVkaXRvci5qcykuXHJcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShUWVBfVklFV19UWVBFKSkge1xyXG4gICAgZm9yIChjb25zdCBlZGl0b3Igb2YgbGVhZi52aWV3Py5mcm9udG1hdHRlckVkaXRvcnMgPz8gW10pIHtcclxuICAgICAgY29uc3QgeyBzdGFuZGFyZCwgZmxvYXRpbmcgfSA9IGtleXNGb3JTdG9yZShwbHVnaW4sIGVkaXRvci5vd25lcj8uZnJlZFN0b3JlKTtcclxuICAgICAgYXBwbHlUb0NvbnRhaW5lcihlZGl0b3IuY29udGFpbmVyRWwsIHN0YW5kYXJkLCBmbG9hdGluZyk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhcHBseVRvQWxsUHJvcGVydGllc1ZpZXcocGx1Z2luKTtcclxufVxyXG5cclxuZnVuY3Rpb24gcmVnaXN0ZXJGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQocGx1Z2luKSB7XHJcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5RnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0KHBsdWdpbik7XHJcblxyXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAubWV0YWRhdGFDYWNoZS5vbihcImNoYW5nZWRcIiwgcmVmcmVzaCkpO1xyXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAubWV0YWRhdGFDYWNoZS5vbihcInJlc29sdmVkXCIsIHJlZnJlc2gpKTtcclxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgcmVmcmVzaCkpO1xyXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwiYWN0aXZlLWxlYWYtY2hhbmdlXCIsIHJlZnJlc2gpKTtcclxuXHJcbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeShyZWZyZXNoKTtcclxuXHJcbiAgcmV0dXJuIHJlZnJlc2g7XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodCB9O1xyXG4iLCAiY29uc3QgeyBOb3RpY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcclxuY29uc3QgeyB0eXBlU3RvcmUsIHN1YnR5cGVTdG9yZSB9ID0gcmVxdWlyZShcIi4vdHlwZS1mcm9udG1hdHRlci1lZGl0b3JcIik7XHJcbmNvbnN0IHsgZ2V0U3VidHlwZU5hbWVzLCBpc0VtcHR5VmFsdWUgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cGVzXCIpO1xyXG5cclxuY29uc3QgVFlQX1BST1BFUlRZID0gXCJUWVBcIjtcclxuY29uc3QgU1VCVFlQX1BST1BFUlRZID0gXCJTVUJUWVBcIjtcclxuXHJcbi8vIE9ic2lkaWFuIHNjaHJlaWJ0IFByb3BlcnR5LU5hbWVuIGludGVybiBrbGVpbiAoc2llaGUgZnJvbnRtYXR0ZXItZGVmYXVsdC1cclxuLy8gaGlnaGxpZ2h0LmpzKSAtIFp1b3JkbnVuZyBkYWhlciBjYXNlLWluc2Vuc2l0aXYsIGRlciBuZXVlIE5hbWUgd2lyZCBhYmVyXHJcbi8vIGV4YWt0IHNvIFx1MDBGQ2Jlcm5vbW1lbiwgd2llIGVyIGVpbmdlZ2ViZW4gd3VyZGUuXHJcbmZ1bmN0aW9uIHNhbWVLZXkoYSwgYikge1xyXG4gIHJldHVybiBhLnRvTG93ZXJDYXNlKCkgPT09IGIudG9Mb3dlckNhc2UoKTtcclxufVxyXG5cclxuLy8gQmVuZW5udCBvbGRLZXkgaW4gZWluZW0gRnJvbnRtYXR0ZXItQmxvY2sgKFRZUCBvZGVyIFN1YnR5cCwgc2llaGVcclxuLy8gdHlwZVN0b3JlL3N1YnR5cGVTdG9yZSBpbiB0eXBlLWZyb250bWF0dGVyLWVkaXRvci5qcykgdW0gKFJlaWhlbmZvbGdlIGJsZWlidFxyXG4vLyBlcmhhbHRlbikgdW5kIHppZWh0IGRpZSBGbG9hdGluZy1NYXJraWVydW5nIG1pdC4gR2lidCBlcyBuZXdLZXkgZG9ydCBiZXJlaXRzXHJcbi8vIChadXNhbW1lbmxlZ2VuLCBhbmFsb2cgenUgT2JzaWRpYW5zIGVpZ2VuZW0gTWVyZ2UgaW4gZGVuIE5vdGl6ZW4pLCBibGVpYnQgZGVyXHJcbi8vIGJlc3RlaGVuZGUgRWludHJhZyBhbiBzZWluZXIgUG9zaXRpb24gLSBkZXIgV2VydCBkZXMgYWx0ZW4gRWludHJhZ3Mgd2lyZCBudXJcclxuLy8gXHUwMEZDYmVybm9tbWVuLCB3ZW5uIGRlciBiZXN0ZWhlbmRlIGxlZXIgaXN0LiBMaWVmZXJ0IHRydWUgYmVpIGVpbmVyIFx1MDBDNG5kZXJ1bmcuXHJcbmZ1bmN0aW9uIHJlbmFtZUluU3RvcmUoc3RvcmUsIG9sZEtleSwgbmV3S2V5KSB7XHJcbiAgY29uc3QgZGVmYXVsdHMgPSBzdG9yZS5nZXRGcm9udG1hdHRlcigpO1xyXG4gIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyhkZWZhdWx0cyk7XHJcbiAgY29uc3Qgc291cmNlS2V5ID0ga2V5cy5maW5kKChrZXkpID0+IHNhbWVLZXkoa2V5LCBvbGRLZXkpKTtcclxuICBpZiAoc291cmNlS2V5ID09PSB1bmRlZmluZWQpIHJldHVybiBmYWxzZTtcclxuICAvLyBCZWkgZWluZXIgcmVpbmVuIFx1MDBDNG5kZXJ1bmcgZGVyIEdyb1x1MDBERi0vS2xlaW5zY2hyZWlidW5nIGlzdCBzb3VyY2VLZXkgc2VsYnN0XHJcbiAgLy8gZGVyIGVpbnppZ2UgVHJlZmZlciBmXHUwMEZDciBuZXdLZXkgLSBkYXMgaXN0IGRhbm4ga2VpbiBadXNhbW1lbmxlZ2VuLlxyXG4gIGNvbnN0IHRhcmdldEtleSA9IGtleXMuZmluZCgoa2V5KSA9PiBrZXkgIT09IHNvdXJjZUtleSAmJiBzYW1lS2V5KGtleSwgbmV3S2V5KSk7XHJcbiAgaWYgKHRhcmdldEtleSA9PT0gdW5kZWZpbmVkICYmIHNvdXJjZUtleSA9PT0gbmV3S2V5KSByZXR1cm4gZmFsc2U7XHJcblxyXG4gIGNvbnN0IG5leHQgPSB7fTtcclxuICBmb3IgKGNvbnN0IGtleSBvZiBrZXlzKSB7XHJcbiAgICBpZiAoa2V5ICE9PSBzb3VyY2VLZXkpIHtcclxuICAgICAgbmV4dFtrZXldID0gZGVmYXVsdHNba2V5XTtcclxuICAgIH0gZWxzZSBpZiAodGFyZ2V0S2V5ID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgbmV4dFtuZXdLZXldID0gZGVmYXVsdHNbc291cmNlS2V5XTtcclxuICAgIH1cclxuICB9XHJcbiAgaWYgKHRhcmdldEtleSAhPT0gdW5kZWZpbmVkICYmIGlzRW1wdHlWYWx1ZShuZXh0W3RhcmdldEtleV0pKSBuZXh0W3RhcmdldEtleV0gPSBkZWZhdWx0c1tzb3VyY2VLZXldO1xyXG4gIHN0b3JlLnNldEZyb250bWF0dGVyKG5leHQpO1xyXG5cclxuICBjb25zdCBmbG9hdGluZyA9IHN0b3JlLmdldEZsb2F0aW5nKCk7XHJcbiAgaWYgKGZsb2F0aW5nLmxlbmd0aCA+IDApIHtcclxuICAgIC8vIEJlaW0gWnVzYW1tZW5sZWdlbiBibGVpYnQgZGllIEZsb2F0aW5nLU1hcmtpZXJ1bmcgZGVzIFppZWxzIG1hXHUwMERGZ2VibGljaC5cclxuICAgIHN0b3JlLnNldEZsb2F0aW5nKFxyXG4gICAgICB0YXJnZXRLZXkgIT09IHVuZGVmaW5lZFxyXG4gICAgICAgID8gZmxvYXRpbmcuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gc291cmNlS2V5KVxyXG4gICAgICAgIDogZmxvYXRpbmcubWFwKChrZXkpID0+IChrZXkgPT09IHNvdXJjZUtleSA/IG5ld0tleSA6IGtleSkpXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgLy8gRGVyIFNob3J0Y3V0IGhcdTAwRTRuZ3QgYW0gS2V5IChzaWVoZSBzaG9ydGN1dHMuanMpIHVuZCB3YW5kZXJ0IGRlc2hhbGIgbWl0IGRlclxyXG4gIC8vIFVtYmVuZW5udW5nIG1pdCAtIGJlaW0gWnVzYW1tZW5sZWdlbiBibGVpYnQsIHdpZSBiZWkgRmxvYXRpbmcsIGRlciBkZXNcclxuICAvLyBaaWVscyBtYVx1MDBERmdlYmxpY2guXHJcbiAgY29uc3Qgc2hvcnRjdXRzID0geyAuLi5zdG9yZS5nZXRTaG9ydGN1dHMoKSB9O1xyXG4gIGlmIChzaG9ydGN1dHNbc291cmNlS2V5XSkge1xyXG4gICAgaWYgKHRhcmdldEtleSA9PT0gdW5kZWZpbmVkKSBzaG9ydGN1dHNbbmV3S2V5XSA9IHNob3J0Y3V0c1tzb3VyY2VLZXldO1xyXG4gICAgZGVsZXRlIHNob3J0Y3V0c1tzb3VyY2VLZXldO1xyXG4gICAgc3RvcmUuc2V0U2hvcnRjdXRzKHNob3J0Y3V0cyk7XHJcbiAgfVxyXG4gIHJldHVybiB0cnVlO1xyXG59XHJcblxyXG4vLyBFaW56ZWwtUHJvcGVydHktRWludHJcdTAwRTRnZSBkZXIgZ2xvYmFsZW4gUmVpaGVuZm9sZ2UgLSBkb3J0IHNpbmQga2VpbmVcclxuLy8gRG9wcGx1bmdlbiBlcmxhdWJ0LCBlaW4gYmVyZWl0cyB2b3JoYW5kZW5lciBaaWVsZWludHJhZyBiZWhcdTAwRTRsdCBkYWhlciBzZWluZVxyXG4vLyBQb3NpdGlvbiB1bmQgZGVyIGFsdGUgZW50Zlx1MDBFNGxsdC5cclxuZnVuY3Rpb24gcmVuYW1lSW5HbG9iYWxPcmRlcihzZXR0aW5ncywgb2xkS2V5LCBuZXdLZXkpIHtcclxuICBjb25zdCBvcmRlciA9IHNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXI7XHJcbiAgY29uc3Qgc291cmNlID0gb3JkZXIuZmluZCgoZW50cnkpID0+IGVudHJ5LmtpbmQgPT09IFwicHJvcGVydHlcIiAmJiBzYW1lS2V5KGVudHJ5Lm5hbWUsIG9sZEtleSkpO1xyXG4gIGlmICghc291cmNlKSByZXR1cm4gZmFsc2U7XHJcbiAgY29uc3QgdGFyZ2V0ID0gb3JkZXIuZmluZCgoZW50cnkpID0+IGVudHJ5ICE9PSBzb3VyY2UgJiYgZW50cnkua2luZCA9PT0gXCJwcm9wZXJ0eVwiICYmIHNhbWVLZXkoZW50cnkubmFtZSwgbmV3S2V5KSk7XHJcbiAgaWYgKHRhcmdldCkgc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlciA9IG9yZGVyLmZpbHRlcigoZW50cnkpID0+IGVudHJ5ICE9PSBzb3VyY2UpO1xyXG4gIGVsc2UgaWYgKHNvdXJjZS5uYW1lID09PSBuZXdLZXkpIHJldHVybiBmYWxzZTtcclxuICBlbHNlIHNvdXJjZS5uYW1lID0gbmV3S2V5O1xyXG4gIHJldHVybiB0cnVlO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBzeW5jUmVuYW1lKHBsdWdpbiwgb2xkS2V5LCBuZXdLZXkpIHtcclxuICBpZiAodHlwZW9mIG9sZEtleSAhPT0gXCJzdHJpbmdcIiB8fCB0eXBlb2YgbmV3S2V5ICE9PSBcInN0cmluZ1wiKSByZXR1cm47XHJcbiAgbmV3S2V5ID0gbmV3S2V5LnRyaW0oKTtcclxuICBpZiAob2xkS2V5ID09PSBcIlwiIHx8IG5ld0tleSA9PT0gXCJcIiB8fCBvbGRLZXkgPT09IG5ld0tleSkgcmV0dXJuO1xyXG4gIC8vIFRZUC9TVUJUWVAgc2luZCBuaWUgVGVpbCBlaW5lcyBGcm9udG1hdHRlci1CbG9ja3MgKHNpZWhlIHN0cmlwVHlwUHJvcGVydHlcclxuICAvLyBpbiB0eXBlLWZyb250bWF0dGVyLWVkaXRvci5qcykgLSBlaW4gVW1iZW5lbm5lbiB2b24vbmFjaCBUWVAvU1VCVFlQIGRhaGVyXHJcbiAgLy8gaWdub3JpZXJlbi5cclxuICBpZiAoW29sZEtleSwgbmV3S2V5XS5zb21lKChrZXkpID0+IHNhbWVLZXkoa2V5LCBUWVBfUFJPUEVSVFkpIHx8IHNhbWVLZXkoa2V5LCBTVUJUWVBfUFJPUEVSVFkpKSkgcmV0dXJuO1xyXG5cclxuICBjb25zdCB7IHNldHRpbmdzIH0gPSBwbHVnaW47XHJcbiAgbGV0IHR5cGVDb3VudCA9IDA7XHJcbiAgbGV0IHN1YnR5cGVDb3VudCA9IDA7XHJcbiAgY29uc3QgY291bnQgPSAoc3RvcmUpID0+IChzdG9yZS5zdWJ0eXBlID8gc3VidHlwZUNvdW50KysgOiB0eXBlQ291bnQrKyk7XHJcbiAgY29uc3QgdHlwZXMgPSBuZXcgU2V0KFsuLi5PYmplY3Qua2V5cyhzZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyKSwgLi4uT2JqZWN0LmtleXMoc2V0dGluZ3MudHlwZVN1YnR5cGVzID8/IHt9KV0pO1xyXG4gIGZvciAoY29uc3QgdHlwZSBvZiB0eXBlcykge1xyXG4gICAgY29uc3Qgc3RvcmVzID0gW3R5cGVTdG9yZShwbHVnaW4sIHR5cGUpLCAuLi5nZXRTdWJ0eXBlTmFtZXMoc2V0dGluZ3MsIHR5cGUpLm1hcCgoc3VidHlwZSkgPT4gc3VidHlwZVN0b3JlKHBsdWdpbiwgdHlwZSwgc3VidHlwZSkpXTtcclxuXHJcbiAgICAvLyBFaW5lIHZhdWx0LXdlaXRlIFVtYmVuZW5udW5nIHNjaGxcdTAwRTRndCBhdWYgSkVERU4gQmxvY2sgZHVyY2gsIGluIGRlbSBkZXJcclxuICAgIC8vIEtleSBzdGVodCAtIGRlcnNlbGJlIEtleSBkYXJmIGJsb2NrXHUwMEZDYmVyZ3JlaWZlbmQgbWVocmZhY2ggdm9ya29tbWVuXHJcbiAgICAvLyAoc2llaGUgS29tbWVudGFyIGFuIHR5cGVTdWJ0eXBlcyBpbiBzdWJ0eXBlcy5qcykuIE51ciBJTk5FUkhBTEIgZWluZXNcclxuICAgIC8vIEJsb2NrcyBrYW5uIGRlciBuZXVlIE5hbWUga29sbGlkaWVyZW47IGRvcnQgbGVndCByZW5hbWVJblN0b3JlIGRpZVxyXG4gICAgLy8gYmVpZGVuIHdpZSBiaXNoZXIgenVzYW1tZW4uXHJcbiAgICBmb3IgKGNvbnN0IHN0b3JlIG9mIHN0b3Jlcykge1xyXG4gICAgICBpZiAocmVuYW1lSW5TdG9yZShzdG9yZSwgb2xkS2V5LCBuZXdLZXkpKSBjb3VudChzdG9yZSk7XHJcbiAgICB9XHJcbiAgfVxyXG4gIGNvbnN0IG9yZGVyQ2hhbmdlZCA9IHJlbmFtZUluR2xvYmFsT3JkZXIoc2V0dGluZ3MsIG9sZEtleSwgbmV3S2V5KTtcclxuICBpZiAodHlwZUNvdW50ID09PSAwICYmIHN1YnR5cGVDb3VudCA9PT0gMCAmJiAhb3JkZXJDaGFuZ2VkKSByZXR1cm47XHJcblxyXG4gIGF3YWl0IHBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICBwbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcblxyXG4gIGNvbnN0IHBhcnRzID0gW107XHJcbiAgaWYgKHR5cGVDb3VudCA+IDApIHBhcnRzLnB1c2goYCR7dHlwZUNvdW50fSBUWVAke3R5cGVDb3VudCA9PT0gMSA/IFwiXCIgOiBcImVuXCJ9YCk7XHJcbiAgaWYgKHN1YnR5cGVDb3VudCA+IDApIHBhcnRzLnB1c2goYCR7c3VidHlwZUNvdW50fSBTdWJ0eXAke3N1YnR5cGVDb3VudCA9PT0gMSA/IFwiXCIgOiBcImVuXCJ9YCk7XHJcbiAgaWYgKG9yZGVyQ2hhbmdlZCkgcGFydHMucHVzaChcImdsb2JhbGVyIFJlaWhlbmZvbGdlXCIpO1xyXG4gIG5ldyBOb3RpY2UoYFRZUC1TeXN0ZW06IFx1MjAxRSR7b2xkS2V5fVx1MjAxQyBcdTIxOTIgXHUyMDFFJHtuZXdLZXl9XHUyMDFDIGluICR7cGFydHMuam9pbihcIiB1bmQgXCIpfSB1bWJlbmFubnQuYCk7XHJcbn1cclxuXHJcbi8vIE9ic2lkaWFucyBcIkFsbCBwcm9wZXJ0aWVzXCItQW5zaWNodCAoYWNjZXB0UmVuYW1lKSB1bmQgQmFzZXMgKE5hbWVuc2ZlbGQgZWluZXJcclxuLy8gbmV1IGFuZ2VsZWd0ZW4gTm90aXotUHJvcGVydHkpIGJlbmVubmVuIFByb3BlcnRpZXMgdmF1bHQtd2VpdCBhdXNzY2hsaWVcdTAwREZsaWNoXHJcbi8vIFx1MDBGQ2JlciBhcHAuZmlsZU1hbmFnZXIucmVuYW1lUHJvcGVydHkoYWx0LCBuZXUpIHVtIChzaWVoZSBnZWJhdXRlcyBhcHAuanMpIC1cclxuLy8gZWluIFdyYXBwZXIgZ2VuYXUgZG9ydCBlcmZhc3N0IGFsc28gamVkZSBlY2h0ZSBVbWJlbmVubnVuZywgb2huZSBkaWVcclxuLy8gamV3ZWlsaWdlbiBWaWV3cyBzZWxic3QgYW5mYXNzZW4genUgbVx1MDBGQ3NzZW4uIEJhc2VzJyBcIkRpc3BsYXkgbmFtZVwiIGZcdTAwRkNyXHJcbi8vIGJlc3RlaGVuZGUgUHJvcGVydGllcyBcdTAwRTRuZGVydCBudXIgZGllIC5iYXNlLURhdGVpLCBuaWNodCBkaWUgTm90aXplbiwgdW5kXHJcbi8vIGxcdTAwRTR1ZnQgZGVzaGFsYiAocmljaHRpZ2Vyd2Vpc2UpIG5pY2h0IGhpZXIgZHVyY2guXHJcbmZ1bmN0aW9uIHJlZ2lzdGVyUHJvcGVydHlSZW5hbWVTeW5jKHBsdWdpbikge1xyXG4gIGNvbnN0IGZpbGVNYW5hZ2VyID0gcGx1Z2luLmFwcC5maWxlTWFuYWdlcjtcclxuICBpZiAoZmlsZU1hbmFnZXIuX19mcmVkVHlwUmVuYW1lU3luY1BhdGNoZWQpIHJldHVybjtcclxuICBmaWxlTWFuYWdlci5fX2ZyZWRUeXBSZW5hbWVTeW5jUGF0Y2hlZCA9IHRydWU7XHJcblxyXG4gIGNvbnN0IG9yaWdpbmFsID0gZmlsZU1hbmFnZXIucmVuYW1lUHJvcGVydHk7XHJcbiAgZmlsZU1hbmFnZXIucmVuYW1lUHJvcGVydHkgPSBhc3luYyBmdW5jdGlvbiAob2xkS2V5LCBuZXdLZXksIC4uLnJlc3QpIHtcclxuICAgIC8vIFdpcmZ0IGRhcyBPcmlnaW5hbCAoYWNjZXB0UmVuYW1lIGZcdTAwRTRuZ3QgZGFzIHNlbGJzdCBhYiksIGJsZWliZW4gZGllXHJcbiAgICAvLyBQbHVnaW4tRWluc3RlbGx1bmdlbiB1bnZlclx1MDBFNG5kZXJ0LlxyXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgb3JpZ2luYWwuY2FsbCh0aGlzLCBvbGRLZXksIG5ld0tleSwgLi4ucmVzdCk7XHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCBzeW5jUmVuYW1lKHBsdWdpbiwgb2xkS2V5LCBuZXdLZXkpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihcIlRZUC1TeXN0ZW06IFByb3BlcnR5LVVtYmVuZW5udW5nIG5pY2h0IFx1MDBGQ2Jlcm5vbW1lblwiLCBlcnJvcik7XHJcbiAgICAgIG5ldyBOb3RpY2UoYFRZUC1TeXN0ZW06IFVtYmVuZW5udW5nIHZvbiBcdTIwMUUke29sZEtleX1cdTIwMUMgbmljaHQgXHUwMEZDYmVybm9tbWVuIFx1MjAxMyAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG4gIH07XHJcblxyXG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiB7XHJcbiAgICBmaWxlTWFuYWdlci5yZW5hbWVQcm9wZXJ0eSA9IG9yaWdpbmFsO1xyXG4gICAgZGVsZXRlIGZpbGVNYW5hZ2VyLl9fZnJlZFR5cFJlbmFtZVN5bmNQYXRjaGVkO1xyXG4gIH0pO1xyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJQcm9wZXJ0eVJlbmFtZVN5bmMgfTtcclxuIiwgImNvbnN0IHsgRnV6enlTdWdnZXN0TW9kYWwsIE5vdGljZSwgcHJlcGFyZUZ1enp5U2VhcmNoIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XHJcbmNvbnN0IHsgY29tcGFyZVR5cGVzLCBERUZBVUxUX1NPUlRfT1JERVIgfSA9IHJlcXVpcmUoXCIuL3R5cC12aWV3XCIpO1xyXG5jb25zdCB7IG5hbWVDb2xvciwgcGFpbnRDb2xvckRvdCB9ID0gcmVxdWlyZShcIi4vdHlwZS1jb2xvcnNcIik7XHJcblxyXG4vLyBOYXRpdmVyIEVyc2F0eiBmXHUwMEZDciBUZW1wbGF0ZXJzIHRwLnN5c3RlbS5zdWdnZXN0ZXIgYmVpIGRlciBUWVAtQXVzd2FobCAoc2llaGVcclxuLy8gX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qcyk6IGJhdXQgYXVmIE9ic2lkaWFucyBlaWdlbmVtXHJcbi8vIEZ1enp5U3VnZ2VzdE1vZGFsIGF1ZiAoZGllc2VsYmUgQmFzaXMsIGF1ZiBkZXIgYXVjaCBUZW1wbGF0ZXJzIFN1Z2dlc3RlclxyXG4vLyBzZWxic3QgYmVydWh0KSwgemVpZ3QgenVzXHUwMEU0dHpsaWNoIGFiZXIgVFlQLUZhcmJlLy1QdW5rdCwgQmVzY2hyZWlidW5nIHVuZFxyXG4vLyBOb3Rpei1BbnphaGwgamUgWmVpbGUuIE5pY2h0IGVyZmFzc3RlIChpdGVtLnVucmVnaXN0ZXJlZCkgVFlQZW4gd2VyZGVuIHN0YXR0XHJcbi8vIGluIGlocmVyIChuaWNodCBleGlzdGllcmVuZGVuKSBGYXJiZSBtdXRlZCBkYXJnZXN0ZWxsdCwgYW5hbG9nIHp1clxyXG4vLyBUWVAtTGlzdGUgc2VsYnN0IChzaWVoZSAuZnJlZC10eXAtdW5yZWdpc3RlcmVkIGluIHR5cC12aWV3LmpzKS5cclxuY2xhc3MgVHlwUGlja2VyTW9kYWwgZXh0ZW5kcyBGdXp6eVN1Z2dlc3RNb2RhbCB7XHJcbiAgY29uc3RydWN0b3IoYXBwLCBwbHVnaW4sIGl0ZW1zLCByZXNvbHZlKSB7XHJcbiAgICBzdXBlcihhcHApO1xyXG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XHJcbiAgICB0aGlzLml0ZW1zID0gaXRlbXM7XHJcbiAgICB0aGlzLnJlc29sdmUgPSByZXNvbHZlO1xyXG4gICAgdGhpcy5jaG9zZW4gPSBmYWxzZTtcclxuICAgIHRoaXMuc2V0UGxhY2Vob2xkZXIoXCJFU0MgZlx1MDBGQ3IgQWJicnVjaFwiKTtcclxuICB9XHJcblxyXG4gIGdldEl0ZW1zKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuaXRlbXM7XHJcbiAgfVxyXG5cclxuICAvLyBGdXp6eS1TdWNoZSBncmVpZnQgYXVjaCBhdWYgZGllIEJlc2NocmVpYnVuZywgbmljaHQgbnVyIGF1ZiBkZW4gVFlQLU5hbWVuIC1cclxuICAvLyB1bmQgYXVmIGRpZSBTdWJ0eXBlbiwgd28gc2llIGluIGRlciBaZWlsZSBzdGVoZW4gKHNob3dTdWJ0eXBlcywgc2llaGVcclxuICAvLyB0eXBlSXRlbXMpOiBzaWUgc2luZCBkYW5uIHNpY2h0YmFyLCBhbHNvIGVyd2FydGV0IG1hbiBhdWNoLCBzaWUgdGlwcGVuIHp1XHJcbiAgLy8ga1x1MDBGNm5uZW4sIHVuZCBpbSBzZXBhcmF0ZW4gQWJsYXVmIGlzdCBkZXIgVFlQIGRhclx1MDBGQ2JlciBkZXIgV2VnIHp1IGlobmVuLlxyXG4gIGdldEl0ZW1UZXh0KGl0ZW0pIHtcclxuICAgIHJldHVybiBbaXRlbS50eXBlLCBpdGVtLnN1YnR5cGVzPy5qb2luKFwiIFwiKSwgaXRlbS5kZXNjcmlwdGlvbl0uZmlsdGVyKEJvb2xlYW4pLmpvaW4oXCIgXCIpO1xyXG4gIH1cclxuXHJcbiAgcmVuZGVyU3VnZ2VzdGlvbihtYXRjaCwgZWwpIHtcclxuICAgIGNvbnN0IGl0ZW0gPSBtYXRjaC5pdGVtO1xyXG4gICAgZWwuYWRkQ2xhc3MoXCJmcmVkLXR5cC1waWNrZXItc3VnZ2VzdGlvblwiKTtcclxuICAgIGlmIChpdGVtLnVucmVnaXN0ZXJlZCkgZWwuYWRkQ2xhc3MoXCJmcmVkLXR5cC1waWNrZXItdW5yZWdpc3RlcmVkXCIpO1xyXG5cclxuICAgIGlmIChpdGVtLnVucmVnaXN0ZXJlZCkge1xyXG4gICAgICBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLXBpY2tlci1uYW1lXCIsIHRleHQ6IGl0ZW0udHlwZSB9KTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHRoaXMucmVuZGVyQ29sb3JlZE5hbWUoZWwsIGl0ZW0udHlwZSwgaXRlbS50eXBlKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoaXRlbS5zdWJ0eXBlcz8ubGVuZ3RoKSB0aGlzLnJlbmRlclN1YnR5cGVQcmV2aWV3KGVsLCBpdGVtKTtcclxuXHJcbiAgICBpZiAoaXRlbS5kZXNjcmlwdGlvbikge1xyXG4gICAgICBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLXBpY2tlci1kZXNjXCIsIHRleHQ6IGl0ZW0uZGVzY3JpcHRpb24gfSk7XHJcbiAgICB9XHJcblxyXG4gICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1waWNrZXItY291bnRcIiwgdGV4dDogU3RyaW5nKGl0ZW0uY291bnQpIH0pO1xyXG4gIH1cclxuXHJcbiAgLy8gTmFtZSBpbiBkZXIgRmFyYmUgdm9uIGNvbG9yVHlwZSAoYnp3LiBkZXMgU3VidHlwcywgc2llaGUgbmFtZUNvbG9yIGluXHJcbiAgLy8gdHlwZS1jb2xvcnMuanMgLSBkaWVzZWxiZSBHcnVuZGxhZ2UgbnV0enQgZGllIFN1YnR5cC1Wb3JzY2hhdSBkZXIgVFlQLUxpc3RlKVxyXG4gIC8vIC0gamUgbmFjaCBFaW5zdGVsbHVuZyBcIlRZUCBWaWV3IGVpbmZcdTAwRTRyYmVuXCIgYWxzIGVpbmdlZlx1MDBFNHJidGVyIFRleHQgb2RlciBtaXRcclxuICAvLyB2b3Jhbmdlc3RlbGx0ZW0gRmFyYnB1bmt0LlxyXG4gIHJlbmRlckNvbG9yZWROYW1lKGVsLCB0ZXh0LCBjb2xvclR5cGUsIHN1YnR5cGUgPSBudWxsKSB7XHJcbiAgICBjb25zdCB7IGNvbG9yLCBpc0RlZmF1bHQgfSA9IG5hbWVDb2xvcih0aGlzLnBsdWdpbi5zZXR0aW5ncywgY29sb3JUeXBlLCBzdWJ0eXBlKTtcclxuICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3QpIHtcclxuICAgICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1waWNrZXItbmFtZVwiLCB0ZXh0IH0pLnN0eWxlLmNvbG9yID0gY29sb3I7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBwYWludENvbG9yRG90KGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtcGlja2VyLWRvdFwiIH0pLCBjb2xvciwgaXNEZWZhdWx0KTtcclxuICAgICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1waWNrZXItbmFtZVwiLCB0ZXh0IH0pO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLy8gXCJUWVAgKFN1YnR5cCAxLCBTdWJ0eXAgMilcIiAtIHdlbGNoZSBTdWJ0eXBlbiB1bnRlciBkZW0gVFlQIGxpZWdlbiwgc2Nob25cclxuICAvLyBpbiBkZXIgVFlQLUF1c3dhaGwgZGVzIHNlcGFyYXRlbiBBYmxhdWZzIChzaWVoZSBwaWNrVHlwZUFuZFN1YnR5cGUpLCB3b1xyXG4gIC8vIGRlciBTdWJ0eXAtUGlja2VyIGVyc3QgZGFuYWNoIGtvbW10LiBKZWRlciBTdWJ0eXAgaW4gc2VpbmVyIGVpZ2VuZW4gRmFyYmUsXHJcbiAgLy8gS2xhbW1lcm4gdW5kIEtvbW1hcyBtdXRlZDsgb2huZSBcIlRZUCBWaWV3IGVpbmZcdTAwRTRyYmVuXCIgYmxlaWJ0IGRpZSBWb3JzY2hhdVxyXG4gIC8vIHdpZSBkZXIgTmFtZSBzZWxic3QgdW5nZWZcdTAwRTRyYnQuXHJcbiAgcmVuZGVyU3VidHlwZVByZXZpZXcoZWwsIGl0ZW0pIHtcclxuICAgIGNvbnN0IGNvbG9yaXplID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0O1xyXG4gICAgY29uc3Qgd3JhcCA9IGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtcGlja2VyLXN1YnR5cGVzXCIgfSk7XHJcbiAgICB3cmFwLmFwcGVuZFRleHQoXCIoXCIpO1xyXG4gICAgaXRlbS5zdWJ0eXBlcy5mb3JFYWNoKChzdWJ0eXBlLCBpbmRleCkgPT4ge1xyXG4gICAgICBpZiAoaW5kZXggPiAwKSB3cmFwLmFwcGVuZFRleHQoXCIsIFwiKTtcclxuICAgICAgY29uc3Qgc3BhbiA9IHdyYXAuY3JlYXRlU3Bhbih7IHRleHQ6IHN1YnR5cGUgfSk7XHJcbiAgICAgIGlmIChjb2xvcml6ZSkgc3Bhbi5zdHlsZS5jb2xvciA9IG5hbWVDb2xvcih0aGlzLnBsdWdpbi5zZXR0aW5ncywgaXRlbS50eXBlLCBzdWJ0eXBlKS5jb2xvcjtcclxuICAgIH0pO1xyXG4gICAgd3JhcC5hcHBlbmRUZXh0KFwiKVwiKTtcclxuICB9XHJcblxyXG4gIC8vIE9ic2lkaWFucyBTdWdnZXN0TW9kYWwuc2VsZWN0U3VnZ2VzdGlvbigpIHJ1ZnQgaW50ZXJuIGVyc3QgdGhpcy5jbG9zZSgpXHJcbiAgLy8gYXVmIHVuZCBkYW5hY2ggZXJzdCBvbkNob29zZVN1Z2dlc3Rpb24oKS9vbkNob29zZUl0ZW0oKSAtIFwiY2hvc2VuXCIgaGllciB6dVxyXG4gIC8vIHNldHplbiAoc3RhdHQgaW4gb25DaG9vc2VJdGVtKSBpc3QgZGFoZXIgbmljaHQgYmxvXHUwMERGIEdlc2NobWFja3NzYWNoZTogd1x1MDBGQ3JkZVxyXG4gIC8vIGVzIGVyc3QgaW4gb25DaG9vc2VJdGVtIGdlc2V0enQsIGhcdTAwRTR0dGUgZGFzIGNsb3NlKCktYXVzZ2VsXHUwMEY2c3RlIG9uQ2xvc2UoKVxyXG4gIC8vIHVudGVuIFwiY2hvc2VuXCIgbm9jaCBhbHMgZmFsc2UgZ2VzZWhlbiB1bmQgZGFzIFByb21pc2UgZlx1MDBFNGxzY2hsaWNoIHNjaG9uIG1pdFxyXG4gIC8vIG51bGwgYXVmZ2VsXHUwMEY2c3QsIGJldm9yIGRlciBlaWdlbnRsaWNoZSBvbkNob29zZUl0ZW0tQXVmcnVmIFx1MDBGQ2JlcmhhdXB0IGxpZWYgLVxyXG4gIC8vIGRhcyB6d2VpdGUgcmVzb2x2ZSgpIGdyZWlmdCBkYW5uIG5pY2h0IG1laHIgKGVpbiBQcm9taXNlIGxcdTAwRjZzdCBudXIgZWlubWFsXHJcbiAgLy8gYXVmKSwgZGFzIEVyZ2VibmlzIHdhciB1bmFiaFx1MDBFNG5naWcgdm9uIGRlciBBdXN3YWhsIGltbWVyIG51bGwuXHJcbiAgc2VsZWN0U3VnZ2VzdGlvbihpdGVtLCBldnQpIHtcclxuICAgIHRoaXMuY2hvc2VuID0gdHJ1ZTtcclxuICAgIC8vIFdhcyBiZWkgZGVyIEF1c3dhaGwgaW0gU3VjaGZlbGQgc3RhbmQgLSBkZXIgU3VidHlwLVBpY2tlciBzb3J0aWVydCBkYW5hY2hcclxuICAgIC8vIHZvciAoc2llaGUgcGlja1R5cGVFbnRyeS9zb3J0QnlRdWVyeSkuXHJcbiAgICB0aGlzLnF1ZXJ5ID0gdGhpcy5pbnB1dEVsLnZhbHVlLnRyaW0oKTtcclxuICAgIHN1cGVyLnNlbGVjdFN1Z2dlc3Rpb24oaXRlbSwgZXZ0KTtcclxuICB9XHJcblxyXG4gIG9uQ2hvb3NlSXRlbShpdGVtKSB7XHJcbiAgICB0aGlzLnJlc29sdmUoaXRlbS50eXBlKTtcclxuICB9XHJcblxyXG4gIC8vIEVTQyAob2RlciBLbGljayBkYW5lYmVuKSBzY2hsaWVcdTAwREZ0IGRhcyBNb2RhbCBvaG5lIHNlbGVjdFN1Z2dlc3Rpb24gLSBkYW5uXHJcbiAgLy8gc3RhdHQgZWluZXMgaFx1MDBFNG5nZW5kZW4gUHJvbWlzZSBtaXQgbnVsbCBhdWZsXHUwMEY2c2VuLCBhbmFsb2cgenVcclxuICAvLyB0cC5zeXN0ZW0uc3VnZ2VzdGVyLlxyXG4gIG9uQ2xvc2UoKSB7XHJcbiAgICBzdXBlci5vbkNsb3NlKCk7XHJcbiAgICBpZiAoIXRoaXMuY2hvc2VuKSB0aGlzLnJlc29sdmUobnVsbCk7XHJcbiAgfVxyXG59XHJcblxyXG4vLyBBdXN3YWhsIGVpbmVzIFN1YnR5cHMgZlx1MDBGQ3IgZWluZW4gYmVyZWl0cyBnZXdcdTAwRTRobHRlbiBUWVAgKHNpZWhlIHBpY2tTdWJ0eXBlKS5cclxuLy8gV2llIFR5cFBpY2tlck1vZGFsLCB6dXNcdTAwRTR0emxpY2ggbWl0IGRlbSBFaW50cmFnIFwiVFlQIChvaG5lIFN1YnR5cClcIiBhblxyXG4vLyBlcnN0ZXIgU3RlbGxlIChpdGVtLm5vbmUpLiBFU0MgbFx1MDBGNnN0IG1pdCBudWxsIGF1ZiAtIFRZUC5qcyBrZWhydCBkYW5uIHp1clxyXG4vLyBUWVAtQXVzd2FobCB6dXJcdTAwRkNjay4gU3VidHlwZW4gaGFiZW4ga2VpbmUgQmVzY2hyZWlidW5nLCBkZXIgTmFtZSBzdGVodCBpblxyXG4vLyBkZXIgRmFyYmUgZGVzIFN1YnR5cHMgKGJ6dy4gZGVzIFRZUHMpIG1pdCBOb3Rpei1BbnphaGwuIHF1ZXJ5IGlzdCBkaWVcclxuLy8gU3VjaGFuZnJhZ2UgYXVzIGRlbSBUWVAtUGlja2VyLCBuYWNoIGRlciBkaWUgTGlzdGUgdm9yc29ydGllcnQgc3RlaHQuXHJcbmNsYXNzIFN1YnR5cFBpY2tlck1vZGFsIGV4dGVuZHMgVHlwUGlja2VyTW9kYWwge1xyXG4gIGNvbnN0cnVjdG9yKGFwcCwgcGx1Z2luLCB0eXBlLCBpdGVtcywgcmVzb2x2ZSwgcXVlcnkgPSBcIlwiKSB7XHJcbiAgICBzdXBlcihhcHAsIHBsdWdpbiwgaXRlbXMsIHJlc29sdmUpO1xyXG4gICAgdGhpcy50eXBlID0gdHlwZTtcclxuICAgIHRoaXMuc2V0UGxhY2Vob2xkZXIoYFN1YnR5cCBmXHUwMEZDciAke3R5cGV9IFx1MjAxMyBFU0MgZlx1MDBGQ3IgenVyXHUwMEZDY2tgKTtcclxuICAgIHRoaXMuaXRlbXMgPSBzb3J0QnlRdWVyeShpdGVtcywgcXVlcnksIChpdGVtKSA9PiB0aGlzLmdldEl0ZW1UZXh0KGl0ZW0pKTtcclxuICB9XHJcblxyXG4gIC8vIERpZSBcIm9obmUgU3VidHlwXCItWmVpbGUgaXN0IGF1Y2ggXHUwMEZDYmVyIGRlbiBUWVAtTmFtZW4genUgZmluZGVuLCBkZW4gc2llXHJcbiAgLy8gemVpZ3QgLSBlaW4gaW0gVFlQLVBpY2tlciBnZXRpcHB0ZXMgXCJPUkdBXCIgaG9sdCBzaWUgZGFtaXQgdm9uIGFsbGVpblxyXG4gIC8vIHdpZWRlciBhbiBkZW4gQW5mYW5nLCBvYndvaGwgZG9ydCBkZXIgVFlQIHVuZCBuaWNodCBlaW4gU3VidHlwIGdlbWVpbnQgd2FyLlxyXG4gIGdldEl0ZW1UZXh0KGl0ZW0pIHtcclxuICAgIHJldHVybiBpdGVtLm5vbmUgPyBgJHt0aGlzLnR5cGV9ICR7aXRlbS50eXBlfWAgOiBzdXBlci5nZXRJdGVtVGV4dChpdGVtKTtcclxuICB9XHJcblxyXG4gIHJlbmRlclN1Z2dlc3Rpb24obWF0Y2gsIGVsKSB7XHJcbiAgICBjb25zdCBpdGVtID0gbWF0Y2guaXRlbTtcclxuICAgIGVsLmFkZENsYXNzKFwiZnJlZC10eXAtcGlja2VyLXN1Z2dlc3Rpb25cIik7XHJcbiAgICBpZiAoaXRlbS5ub25lKSB7XHJcbiAgICAgIC8vIFwiT1JHQSAob2huZSBTdWJ0eXApXCI6IGRlciBUWVAgc2VsYnN0IGluIHNlaW5lciBGYXJiZSAoYnp3LiBtaXRcclxuICAgICAgLy8gRmFyYnB1bmt0KSwgZGVyIFp1c2F0eiBpbiBub3JtYWxlciBUZXh0ZmFyYmUgc3RhdHQgbXV0ZWQgLSBkaWUgWmVpbGVcclxuICAgICAgLy8gaXN0IGRpZSBXYWhsIFwiZGllc2VyIFRZUCwgb2huZSBTdWJ0eXBcIiB1bmQga2VpbmUgYXVzZ2VncmF1dGVcclxuICAgICAgLy8gTmljaHQtV2FobCwgdW5kIGRlciBoZWxsZSBadXNhdHogaGVidCBzaWUgenVnbGVpY2ggdm9uIGRlblxyXG4gICAgICAvLyBTdWJ0eXAtWmVpbGVuIGRhcnVudGVyIGFiLCBkaWUgbnVyIGF1cyBpaHJlbSBOYW1lbiBiZXN0ZWhlbi5cclxuICAgICAgdGhpcy5yZW5kZXJDb2xvcmVkTmFtZShlbCwgdGhpcy50eXBlLCB0aGlzLnR5cGUpO1xyXG4gICAgICBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLXBpY2tlci1ub25lXCIsIHRleHQ6IGAoJHtpdGVtLnR5cGV9KWAgfSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICB0aGlzLnJlbmRlckNvbG9yZWROYW1lKGVsLCBpdGVtLnR5cGUsIHRoaXMudHlwZSwgaXRlbS50eXBlKTtcclxuICAgIH1cclxuICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtcGlja2VyLWNvdW50XCIsIHRleHQ6IFN0cmluZyhpdGVtLmNvdW50KSB9KTtcclxuICB9XHJcblxyXG4gIG9uQ2hvb3NlSXRlbShpdGVtKSB7XHJcbiAgICB0aGlzLnJlc29sdmUoaXRlbS5ub25lID8gXCJcIiA6IGl0ZW0udHlwZSk7XHJcbiAgfVxyXG59XHJcblxyXG4vLyBUWVAtUGlja2VyIG1pdCBkZW4gU3VidHlwZW4gZGlyZWt0IGVpbmdlclx1MDBGQ2NrdCB1bnRlciBpaHJlbSBUWVAgKFN0YW5kYXJkLFxyXG4vLyBzb2xhbmdlIFwiU3VidHlwLVBpY2tlciBzZXBhcmF0XCIgaW4gZGVuIEVpbnN0ZWxsdW5nZW4gYXVzIGlzdCwgc2llaGVcclxuLy8gcGlja1R5cGVBbmRTdWJ0eXBlKS4gRGllIFRZUC1aZWlsZSBzZWxic3Qgc3RlaHQgZlx1MDBGQ3IgXCJUWVAgb2huZSBTdWJ0eXBcIi5cclxuLy8gR2VzdWNodCB3aXJkIGdydXBwZW53ZWlzZSBzdGF0dCBqZSBaZWlsZSwgZGFtaXQgZWluIFN1YnR5cCBuaWUgb2huZSBzZWluZW5cclxuLy8gVFlQIGRhclx1MDBGQ2JlciBlcnNjaGVpbnQ6IHBhc3N0IGRpZSBTdWNoZSBhdWYgZGVuIFRZUCwgYmxlaWJlbiBhbGxlIHNlaW5lXHJcbi8vIFN1YnR5cGVuIHN0ZWhlbjsgcGFzc3Qgc2llIG51ciBhdWYgZWluemVsbmUgU3VidHlwZW4sIGJsZWliZW4gZGllc2Ugc2FtdFxyXG4vLyBpaHJlbSBUWVAgc3RlaGVuLiBEaWUgR3J1cHBlbiBzb3J0aWVyZW4gc2ljaCBuYWNoIGlocmVtIGJlc3RlbiBUcmVmZmVyLFxyXG4vLyBpbm5lcmhhbGIgZWluZXIgR3J1cHBlIGJsZWlidCBkaWUgQmxvY2stUmVpaGVuZm9sZ2UuXHJcbmNsYXNzIFR5cFN1YnR5cFBpY2tlck1vZGFsIGV4dGVuZHMgVHlwUGlja2VyTW9kYWwge1xyXG4gIGNvbnN0cnVjdG9yKGFwcCwgcGx1Z2luLCBncm91cHMsIHJlc29sdmUpIHtcclxuICAgIHN1cGVyKGFwcCwgcGx1Z2luLCBncm91cHMubWFwKChncm91cCkgPT4gZ3JvdXAuaXRlbSksIHJlc29sdmUpO1xyXG4gICAgdGhpcy5ncm91cHMgPSBncm91cHM7XHJcbiAgfVxyXG5cclxuICBnZXRTdWdnZXN0aW9ucyhxdWVyeSkge1xyXG4gICAgY29uc3Qgc2VhcmNoID0gcXVlcnkudHJpbSgpID8gcHJlcGFyZUZ1enp5U2VhcmNoKHF1ZXJ5LnRyaW0oKSkgOiBudWxsO1xyXG4gICAgY29uc3Qgbm9NYXRjaCA9IHsgc2NvcmU6IDAsIG1hdGNoZXM6IFtdIH07XHJcbiAgICBjb25zdCByZXN1bHRzID0gW107XHJcbiAgICBmb3IgKGNvbnN0IHsgaXRlbSwgc3VidHlwZXMgfSBvZiB0aGlzLmdyb3Vwcykge1xyXG4gICAgICBjb25zdCB0eXBlTWF0Y2ggPSBzZWFyY2ggPyBzZWFyY2godGhpcy5nZXRJdGVtVGV4dChpdGVtKSkgOiBub01hdGNoO1xyXG4gICAgICBsZXQgc3VidHlwZU1hdGNoZXMgPSBzdWJ0eXBlcy5tYXAoKHN1YnR5cGUpID0+ICh7IGl0ZW06IHN1YnR5cGUsIG1hdGNoOiBzZWFyY2ggPyBzZWFyY2goc3VidHlwZS5zdWJ0eXBlKSA6IG5vTWF0Y2ggfSkpO1xyXG4gICAgICBpZiAoIXR5cGVNYXRjaCkgc3VidHlwZU1hdGNoZXMgPSBzdWJ0eXBlTWF0Y2hlcy5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeS5tYXRjaCk7XHJcbiAgICAgIGlmICghdHlwZU1hdGNoICYmIHN1YnR5cGVNYXRjaGVzLmxlbmd0aCA9PT0gMCkgY29udGludWU7XHJcblxyXG4gICAgICBjb25zdCBzY29yZXMgPSBbdHlwZU1hdGNoLCAuLi5zdWJ0eXBlTWF0Y2hlcy5tYXAoKGVudHJ5KSA9PiBlbnRyeS5tYXRjaCldLmZpbHRlcihCb29sZWFuKS5tYXAoKG1hdGNoKSA9PiBtYXRjaC5zY29yZSk7XHJcbiAgICAgIHJlc3VsdHMucHVzaCh7XHJcbiAgICAgICAgc2NvcmU6IE1hdGgubWF4KC4uLnNjb3JlcyksXHJcbiAgICAgICAgcm93czogW3sgaXRlbSwgbWF0Y2g6IHR5cGVNYXRjaCA/PyBub01hdGNoIH0sIC4uLnN1YnR5cGVNYXRjaGVzLm1hcCgoZW50cnkpID0+ICh7IGl0ZW06IGVudHJ5Lml0ZW0sIG1hdGNoOiBlbnRyeS5tYXRjaCA/PyBub01hdGNoIH0pKV0sXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgaWYgKHNlYXJjaCkgcmVzdWx0cy5zb3J0KChhLCBiKSA9PiBiLnNjb3JlIC0gYS5zY29yZSk7XHJcbiAgICByZXR1cm4gcmVzdWx0cy5mbGF0TWFwKChncm91cCkgPT4gZ3JvdXAucm93cyk7XHJcbiAgfVxyXG5cclxuICByZW5kZXJTdWdnZXN0aW9uKG1hdGNoLCBlbCkge1xyXG4gICAgY29uc3QgaXRlbSA9IG1hdGNoLml0ZW07XHJcbiAgICBpZiAoIWl0ZW0uc3VidHlwZSkge1xyXG4gICAgICBzdXBlci5yZW5kZXJTdWdnZXN0aW9uKG1hdGNoLCBlbCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGVsLmFkZENsYXNzKFwiZnJlZC10eXAtcGlja2VyLXN1Z2dlc3Rpb25cIiwgXCJmcmVkLXR5cC1waWNrZXItc3VidHlwZVwiKTtcclxuICAgIHRoaXMucmVuZGVyQ29sb3JlZE5hbWUoZWwsIGl0ZW0uc3VidHlwZSwgaXRlbS50eXBlLCBpdGVtLnN1YnR5cGUpO1xyXG4gICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1waWNrZXItY291bnRcIiwgdGV4dDogU3RyaW5nKGl0ZW0uY291bnQpIH0pO1xyXG4gIH1cclxuXHJcbiAgb25DaG9vc2VJdGVtKGl0ZW0pIHtcclxuICAgIHRoaXMucmVzb2x2ZSh7IHR5cGU6IGl0ZW0udHlwZSwgc3VidHlwZTogaXRlbS5zdWJ0eXBlID8/IG51bGwgfSk7XHJcbiAgfVxyXG59XHJcblxyXG4vLyBBdXNnYW5ncy1SZWloZW5mb2xnZSBlaW5lciBQaWNrZXItTGlzdGUgbmFjaCBlaW5lciBzY2hvbiBnZXRpcHB0ZW4gU3VjaGFuZnJhZ2VcclxuLy8gKGRlciBhdXMgZGVtIFRZUC1QaWNrZXIsIHNpZWhlIHBpY2tUeXBlRW50cnkpOiB3b3JhdWYgc2llIHBhc3N0LCBzdGVodCBvYmVuLFxyXG4vLyBuYWNoIFRyZWZmZXJnXHUwMEZDdGUsIGFsbGVzIGFuZGVyZSBkYWhpbnRlciBpbiB1bnZlclx1MDBFNG5kZXJ0ZXIgUmVpaGVuZm9sZ2UuIFwiUGFzc3RcclxuLy8gYXVmIG5pY2h0c1wiIGxcdTAwRTRzc3QgZGllIExpc3RlLCB3aWUgc2llIHdhciAtIGdldGlwcHQgd2FyIGRhbm4gei4gQi4gZWluZVxyXG4vLyBCZXNjaHJlaWJ1bmcsIFx1MDBGQ2JlciBkaWUgaGllciBuaWNodHMgenUgc2NobGllXHUwMERGZW4gaXN0LiBEYW5hY2ggZ3JlaWZ0IHdpZWRlclxyXG4vLyBPYnNpZGlhbnMgZWlnZW5lIFN1Y2hlLCBzb2JhbGQgaW0gUGlja2VyIHNlbGJzdCBnZXRpcHB0IHdpcmQuXHJcbmZ1bmN0aW9uIHNvcnRCeVF1ZXJ5KGl0ZW1zLCBxdWVyeSwgaXRlbVRleHQpIHtcclxuICBjb25zdCBzZWFyY2ggPSBxdWVyeT8udHJpbSgpID8gcHJlcGFyZUZ1enp5U2VhcmNoKHF1ZXJ5LnRyaW0oKSkgOiBudWxsO1xyXG4gIGlmICghc2VhcmNoKSByZXR1cm4gaXRlbXM7XHJcbiAgY29uc3Qgc2NvcmVkID0gaXRlbXMubWFwKChpdGVtLCBpbmRleCkgPT4gKHsgaXRlbSwgaW5kZXgsIHNjb3JlOiBzZWFyY2goaXRlbVRleHQoaXRlbSkpPy5zY29yZSA/PyBudWxsIH0pKTtcclxuICBpZiAoc2NvcmVkLmV2ZXJ5KChlbnRyeSkgPT4gZW50cnkuc2NvcmUgPT09IG51bGwpKSByZXR1cm4gaXRlbXM7XHJcbiAgc2NvcmVkLnNvcnQoKGEsIGIpID0+IHtcclxuICAgIGlmIChhLnNjb3JlID09PSBudWxsIHx8IGIuc2NvcmUgPT09IG51bGwpIHJldHVybiBhLnNjb3JlID09PSBiLnNjb3JlID8gYS5pbmRleCAtIGIuaW5kZXggOiBhLnNjb3JlID09PSBudWxsID8gMSA6IC0xO1xyXG4gICAgcmV0dXJuIGIuc2NvcmUgLSBhLnNjb3JlIHx8IGEuaW5kZXggLSBiLmluZGV4O1xyXG4gIH0pO1xyXG4gIHJldHVybiBzY29yZWQubWFwKChlbnRyeSkgPT4gZW50cnkuaXRlbSk7XHJcbn1cclxuXHJcbi8vIEZcdTAwRkNyIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanM6IFx1MDBGNmZmbmV0IGRlbiBTdWJ0eXAtUGlja2VyLCBzb2JhbGRcclxuLy8gZGVyIFRZUCBtaW5kZXN0ZW5zIGVpbmVuIHJlZ2lzdHJpZXJ0ZW4gU3VidHlwIGhhdCAoaW4gZGVyIFJlaWhlbmZvbGdlIGRlclxyXG4vLyBCbFx1MDBGNmNrZSBpbiBkZXIgVFlQLURldGFpbGFuc2ljaHQpLiBxdWVyeSBpc3QgZGllIFN1Y2hhbmZyYWdlIGF1cyBkZW1cclxuLy8gVFlQLVBpY2tlciwgbmFjaCBkZXIgZGllIExpc3RlIHZvcnNvcnRpZXJ0IHdpcmQgKHNpZWhlIHNvcnRCeVF1ZXJ5KTogd2VyXHJcbi8vIGRvcnQgXCJMZWhydmVyYW5zdGFsdHVuZ1wiIHRpcHB0ZSB1bmQgc28genUgT1JHQSBrYW0sIG1laW50ZSBkaWVzZW4gU3VidHlwIHVuZFxyXG4vLyBmaW5kZXQgaWhuIGhpZXIgb2JlbiAtIEVudGVyIGdlblx1MDBGQ2d0LiBMXHUwMEY2c3QgYXVmIG1pdFxyXG4vLyAgLSBkZW0gZ2V3XHUwMEU0aGx0ZW4gU3VidHlwLFxyXG4vLyAgLSBcIlwiIGZcdTAwRkNyIFwib2huZSBTdWJ0eXBcIiAob2huZSBBbmZyYWdlIGRlciBlcnN0ZSBFaW50cmFnIGRlciBMaXN0ZSkgLSBiencuXHJcbi8vICAgIHNvZm9ydCwgb2huZSBQaWNrZXIsIHdlbm4gZGVyIFRZUCBnYXIga2VpbmUgU3VidHlwZW4gaGF0LFxyXG4vLyAgLSBudWxsIGJlaSBFU0MgKFRZUC5qcyBrZWhydCBkYW5uIHp1ciBUWVAtQXVzd2FobCB6dXJcdTAwRkNjaykuXHJcbmZ1bmN0aW9uIHBpY2tTdWJ0eXBlKGFwcCwgcGx1Z2luLCB0eXBlLCBxdWVyeSA9IFwiXCIpIHtcclxuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcclxuICAgIGNvbnN0IGl0ZW1zID0gcGx1Z2luLmdldFN1YnR5cGVzKHR5cGUpLm1hcCgoeyBzdWJ0eXBlLCBjb3VudCB9KSA9PiAoeyB0eXBlOiBzdWJ0eXBlLCBkZXNjcmlwdGlvbjogXCJcIiwgY291bnQgfSkpO1xyXG4gICAgaWYgKGl0ZW1zLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICByZXNvbHZlKFwiXCIpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICAvLyBcIm9obmUgU3VidHlwXCIgYW4gZXJzdGVyIFN0ZWxsZTogZGllIEF1c3dhaGwgaXN0IG9obmUgVGlwcGVuIG1pdCBFbnRlclxyXG4gICAgLy8gZXJsZWRpZ3QsIHVuZCBkZXIgRmFsbCBpc3QgaFx1MDBFNHVmaWdlciBhbHMgamVkZXIgZWluemVsbmUgU3VidHlwLlxyXG4gICAgY29uc3Qgbm9uZUNvdW50ID0gcGx1Z2luLnR5cEluZGV4LnN1YnR5cGVCdWNrZXQodHlwZSkubm9TdWJ0eXBlO1xyXG4gICAgaXRlbXMudW5zaGlmdCh7IHR5cGU6IFwib2huZSBTdWJ0eXBcIiwgZGVzY3JpcHRpb246IFwiXCIsIGNvdW50OiBub25lQ291bnQsIG5vbmU6IHRydWUgfSk7XHJcbiAgICBuZXcgU3VidHlwUGlja2VyTW9kYWwoYXBwLCBwbHVnaW4sIHR5cGUsIGl0ZW1zLCByZXNvbHZlLCBxdWVyeSkub3BlbigpO1xyXG4gIH0pO1xyXG59XHJcblxyXG4vLyBOaWNodCBpbiBwbHVnaW4uc2V0dGluZ3MudHlwZXMgcmVnaXN0cmllcnRlIFRZUGVuLCBkaWUgYWJlciB0YXRzXHUwMEU0Y2hsaWNoIGluXHJcbi8vIE5vdGl6ZW4gdm9ya29tbWVuIC0gYW5hbG9nIHp1IGRlbiBcInVucmVnaXN0cmllcnRlblwiIFplaWxlbiBkZXIgVFlQLUxpc3RlXHJcbi8vIChzaWVoZSB1bnJlZ2lzdGVyZWRSb3dzIGluIHR5cC12aWV3LmpzKS4gS2VpbmUgQmVzY2hyZWlidW5nL0ZhcmJlLCBkYSBmXHUwMEZDclxyXG4vLyBzaWUgbmljaHRzIGRlcmdsZWljaGVuIGdlcGZsZWd0IGlzdC4gTGlzdGVuIHVuZCBXZXJ0ZSBtaXQgUmFuZGxlZXJ6ZWljaGVuXHJcbi8vIChzaWVoZSBpc0NsZWFuS2V5IGluIHR5cC1pbmRleC5qcykgYmxlaWJlbiBhdVx1MDBERmVuIHZvciAtIGRlciBnZXdcdTAwRTRobHRlIFdlcnRcclxuLy8gd2lyZCBpbiBlaW5lIG5ldWUgTm90aXogZ2VzY2hyaWViZW4gdW5kIHNvbGwgZG9ydCBrZWluIEF1ZnJcdTAwRTR1bWZhbGwgc2Vpbi5cclxuZnVuY3Rpb24gdW5yZWdpc3RlcmVkSXRlbXMoYXBwLCBwbHVnaW4pIHtcclxuICBjb25zdCByZWdpc3RlcmVkID0gbmV3IFNldChwbHVnaW4uc2V0dGluZ3MudHlwZXMpO1xyXG4gIGNvbnN0IHsgY291bnRzIH0gPSBwbHVnaW4udHlwSW5kZXgudHlwZUNvdW50cygpO1xyXG4gIGNvbnN0IHNvcnRPcmRlciA9IHBsdWdpbi5zZXR0aW5ncy50eXBTb3J0T3JkZXIgPz8gREVGQVVMVF9TT1JUX09SREVSO1xyXG4gIHJldHVybiBbLi4uY291bnRzLmtleXMoKV1cclxuICAgIC5maWx0ZXIoKHR5cGUpID0+ICFyZWdpc3RlcmVkLmhhcyh0eXBlKSAmJiBwbHVnaW4udHlwSW5kZXguaXNDbGVhbktleSh0eXBlKSlcclxuICAgIC5zb3J0KChhLCBiKSA9PiBjb21wYXJlVHlwZXMoc29ydE9yZGVyLCBhLCBiLCBjb3VudHMsIHBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzKSlcclxuICAgIC5tYXAoKHR5cGUpID0+ICh7IHR5cGUsIGRlc2NyaXB0aW9uOiBcIlwiLCBjb3VudDogY291bnRzLmdldCh0eXBlKSA/PyAwLCB1bnJlZ2lzdGVyZWQ6IHRydWUgfSkpO1xyXG59XHJcblxyXG4vLyBGXHUwMEZDciBfb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzIHNvd2llIFx1MDBGQ2JlcmFsbCBzb25zdCBpbSBQbHVnaW4sIHdvXHJcbi8vIGVpbiBlaW56ZWxuZXIgVFlQIGF1c2dld1x1MDBFNGhsdCB3ZXJkZW4gbXVzcy4gaW5jbHVkZU1hbnVhbE9mZiB3aWUgYmVpXHJcbi8vIHBsdWdpbi5nZXRUeXBlcygpOiBUWVBlbiBtaXQgYWJnZXNjaGFsdGV0ZW0gXCJNYW51ZWxsIGVyc3RlbGxiYXJcIiBzaW5kXHJcbi8vIHN0YW5kYXJkbVx1MDBFNFx1MDBERmlnIGF1c2dla2xhbW1lcnQuIGluY2x1ZGVVbnJlZ2lzdGVyZWQgZXJnXHUwMEU0bnp0IHp1c1x1MDBFNHR6bGljaCBUWVBlbixcclxuLy8gZGllIGluIE5vdGl6ZW4gdm9ya29tbWVuLCBhYmVyIG5pY2h0IGluIGRlciBUWVAtTGlzdGUgcmVnaXN0cmllcnQgc2luZCAtXHJcbi8vIG11dGVkIGRhcmdlc3RlbGx0LCBkYSBmXHUwMEZDciBzaWUga2VpbmUgRmFyYmUvQmVzY2hyZWlidW5nIGV4aXN0aWVydC4gTFx1MDBGNnN0IG1pdFxyXG4vLyBkZW0gZ2V3XHUwMEU0aGx0ZW4gVFlQIGF1Ziwgb2RlciBtaXQgbnVsbCBiZWkgQWJicnVjaCBiencuIGZhbGxzIGVzIChhdWNoIG1pdFxyXG4vLyBkZW4gZ2V3XHUwMEU0aGx0ZW4gT3B0aW9uZW4pIGtlaW5lIGFuenV6ZWlnZW5kZW4gVFlQZW4gZ2lidC4gc2hvd1N1YnR5cGVzIHN0ZWxsdFxyXG4vLyBkaWUgU3VidHlwZW4gZGVzIFRZUHMgaGludGVyIGRlc3NlbiBOYW1lbiAoc2llaGUgcmVuZGVyU3VidHlwZVByZXZpZXcpIC1cclxuLy8gZ2VkYWNodCBmXHUwMEZDciBkaWUgVFlQLUF1c3dhaGwgZGVzIHNlcGFyYXRlbiBBYmxhdWZzLCB3byBkZXIgU3VidHlwLVBpY2tlclxyXG4vLyBlcnN0IGRhbmFjaCBrb21tdC5cclxuZnVuY3Rpb24gcGlja1R5cGUoYXBwLCBwbHVnaW4sIG9wdGlvbnMgPSB7fSkge1xyXG4gIHJldHVybiBwaWNrVHlwZUVudHJ5KGFwcCwgcGx1Z2luLCBvcHRpb25zKS50aGVuKChlbnRyeSkgPT4gZW50cnk/LnR5cGUgPz8gbnVsbCk7XHJcbn1cclxuXHJcbi8vIFdpZSBwaWNrVHlwZSwgbFx1MDBGNnN0IGFiZXIgbWl0IHsgdHlwZSwgcXVlcnkgfSBhdWYgLSBxdWVyeSBpc3QsIHdhcyBiZWkgZGVyXHJcbi8vIEF1c3dhaGwgaW0gU3VjaGZlbGQgc3RhbmQuIE51ciBmXHUwMEZDciBwaWNrVHlwZUFuZFN1YnR5cGU6IGRvcnQgdHJcdTAwRTRndCBkaWVcclxuLy8gQW5mcmFnZSBpbiBkZW4gU3VidHlwLVBpY2tlciB3ZWl0ZXIgKHNpZWhlIHNvcnRCeVF1ZXJ5KSwgZGVubiB3ZXJcclxuLy8gXCJMZWhydmVyYW5zdGFsdHVuZ1wiIHRpcHB0LCBsYW5kZXQgXHUwMEZDYmVyIGRpZSBTdWJ0eXAtVm9yc2NoYXUgYmVpIE9SR0EgdW5kXHJcbi8vIG1laW50IGRhbWl0IGRlbiBTdWJ0eXAsIG5pY2h0IGJsb1x1MDBERiBkZW4gVFlQLlxyXG5mdW5jdGlvbiBwaWNrVHlwZUVudHJ5KGFwcCwgcGx1Z2luLCBvcHRpb25zID0ge30pIHtcclxuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcclxuICAgIGNvbnN0IGl0ZW1zID0gdHlwZUl0ZW1zKGFwcCwgcGx1Z2luLCBvcHRpb25zKTtcclxuICAgIGlmICghaXRlbXMpIHtcclxuICAgICAgcmVzb2x2ZShudWxsKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgY29uc3QgbW9kYWwgPSBuZXcgVHlwUGlja2VyTW9kYWwoYXBwLCBwbHVnaW4sIGl0ZW1zLCAodHlwZSkgPT4gcmVzb2x2ZSh0eXBlID09PSBudWxsID8gbnVsbCA6IHsgdHlwZSwgcXVlcnk6IG1vZGFsLnF1ZXJ5IH0pKTtcclxuICAgIG1vZGFsLm9wZW4oKTtcclxuICB9KTtcclxufVxyXG5cclxuLy8gR2VtZWluc2FtZSBUWVAtTGlzdGUgZlx1MDBGQ3IgcGlja1R5cGUvcGlja1R5cGVBbmRTdWJ0eXBlIC0gbnVsbCBzYW10IE5vdGljZSxcclxuLy8gZmFsbHMgZXMgKGF1Y2ggbWl0IGRlbiBnZXdcdTAwRTRobHRlbiBPcHRpb25lbikga2VpbmUgVFlQZW4gZ2lidC5cclxuZnVuY3Rpb24gdHlwZUl0ZW1zKGFwcCwgcGx1Z2luLCB7IGluY2x1ZGVNYW51YWxPZmYgPSBmYWxzZSwgaW5jbHVkZVVucmVnaXN0ZXJlZCA9IGZhbHNlLCBzaG93U3VidHlwZXMgPSBmYWxzZSB9ID0ge30pIHtcclxuICBjb25zdCBpdGVtcyA9IHBsdWdpbi5nZXRUeXBlcyh7IGluY2x1ZGVNYW51YWxPZmYgfSkubWFwKChpdGVtKSA9PiAoeyAuLi5pdGVtLCB1bnJlZ2lzdGVyZWQ6IGZhbHNlIH0pKTtcclxuICBpZiAoaW5jbHVkZVVucmVnaXN0ZXJlZCkgaXRlbXMucHVzaCguLi51bnJlZ2lzdGVyZWRJdGVtcyhhcHAsIHBsdWdpbikpO1xyXG4gIC8vIE51ciByZWdpc3RyaWVydGUgVFlQZW4gaGFiZW4gZ2VwZmxlZ3RlIFN1YnR5cGVuIC0gZlx1MDBGQ3IgZGllIFx1MDBGQ2JyaWdlbiBibGVpYnRcclxuICAvLyBkaWUgTGlzdGUgbGVlciB1bmQgZGllIFplaWxlIGRhbWl0IHVudmVyXHUwMEU0bmRlcnQuXHJcbiAgaWYgKHNob3dTdWJ0eXBlcykge1xyXG4gICAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSBpdGVtLnN1YnR5cGVzID0gcGx1Z2luLmdldFN1YnR5cGVzKGl0ZW0udHlwZSkubWFwKCh7IHN1YnR5cGUgfSkgPT4gc3VidHlwZSk7XHJcbiAgfVxyXG4gIGlmIChpdGVtcy5sZW5ndGggPiAwKSByZXR1cm4gaXRlbXM7XHJcbiAgbmV3IE5vdGljZShcIktlaW5lIFRZUGVuIHZvcmhhbmRlbi5cIik7XHJcbiAgcmV0dXJuIG51bGw7XHJcbn1cclxuXHJcbi8vIEZcdTAwRkNyIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanM6IFRZUCB1bmQgU3VidHlwIGluIGVpbmVtIFp1Zy4gSmVcclxuLy8gbmFjaCBFaW5zdGVsbHVuZyBzZXBhcmF0ZVN1YnR5cGVQaWNrZXIgZW50d2VkZXIgZWluIGVpbnppZ2VyIFBpY2tlciBtaXQgZGVuXHJcbi8vIFN1YnR5cGVuIGVpbmdlclx1MDBGQ2NrdCB1bnRlciBpaHJlbSBUWVAgKFN0YW5kYXJkKSwgb2RlciB3aWUgZnJcdTAwRkNoZXIgZXJzdCBkZXJcclxuLy8gVFlQLVBpY2tlciAtIGRvcnQgbWl0IGRlbiBTdWJ0eXBlbiBkZXMgVFlQcyBoaW50ZXIgZGVzc2VuIE5hbWVuLCBkYW1pdCBtYW5cclxuLy8gc2llIHNjaG9uIHZvciBkZXIgV2FobCBzaWVodCAtIHVuZCBkYW5hY2gsIGZhbGxzIGRlciBUWVAgU3VidHlwZW4gaGF0LCBkZXJcclxuLy8gU3VidHlwLVBpY2tlciwgdm9yc29ydGllcnQgbmFjaCBkZXIgU3VjaGFuZnJhZ2Ugdm9uIGRvcnQgKEVTQyBmXHUwMEZDaHJ0IHp1clx1MDBGQ2NrXHJcbi8vIHp1ciBUWVAtQXVzd2FobCkuIE9wdGlvbmVuIHdpZSBiZWkgcGlja1R5cGUuIExcdTAwRjZzdCBhdWYgbWl0XHJcbi8vIHsgdHlwZSwgc3VidHlwZSB9IChzdWJ0eXBlIG51bGwgZlx1MDBGQ3IgXCJvaG5lIFN1YnR5cFwiKSwgb2RlciBtaXQgbnVsbCBiZWlcclxuLy8gQWJicnVjaC5cclxuYXN5bmMgZnVuY3Rpb24gcGlja1R5cGVBbmRTdWJ0eXBlKGFwcCwgcGx1Z2luLCBvcHRpb25zID0ge30pIHtcclxuICBpZiAocGx1Z2luLnNldHRpbmdzLnNlcGFyYXRlU3VidHlwZVBpY2tlcikge1xyXG4gICAgd2hpbGUgKHRydWUpIHtcclxuICAgICAgY29uc3QgZW50cnkgPSBhd2FpdCBwaWNrVHlwZUVudHJ5KGFwcCwgcGx1Z2luLCB7IC4uLm9wdGlvbnMsIHNob3dTdWJ0eXBlczogdHJ1ZSB9KTtcclxuICAgICAgaWYgKCFlbnRyeSkgcmV0dXJuIG51bGw7XHJcbiAgICAgIGNvbnN0IHN1YnR5cGUgPSBhd2FpdCBwaWNrU3VidHlwZShhcHAsIHBsdWdpbiwgZW50cnkudHlwZSwgZW50cnkucXVlcnkpO1xyXG4gICAgICBpZiAoc3VidHlwZSAhPT0gbnVsbCkgcmV0dXJuIHsgdHlwZTogZW50cnkudHlwZSwgc3VidHlwZTogc3VidHlwZSB8fCBudWxsIH07XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBjb25zdCBpdGVtcyA9IHR5cGVJdGVtcyhhcHAsIHBsdWdpbiwgb3B0aW9ucyk7XHJcbiAgaWYgKCFpdGVtcykgcmV0dXJuIG51bGw7XHJcbiAgY29uc3QgZ3JvdXBzID0gaXRlbXMubWFwKChpdGVtKSA9PiAoe1xyXG4gICAgaXRlbSxcclxuICAgIHN1YnR5cGVzOiBwbHVnaW4uZ2V0U3VidHlwZXMoaXRlbS50eXBlKS5tYXAoKHsgc3VidHlwZSwgY291bnQgfSkgPT4gKHsgdHlwZTogaXRlbS50eXBlLCBzdWJ0eXBlLCBjb3VudCB9KSksXHJcbiAgfSkpO1xyXG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gbmV3IFR5cFN1YnR5cFBpY2tlck1vZGFsKGFwcCwgcGx1Z2luLCBncm91cHMsIHJlc29sdmUpLm9wZW4oKSk7XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0geyBwaWNrVHlwZSwgcGlja1N1YnR5cGUsIHBpY2tUeXBlQW5kU3VidHlwZSB9O1xyXG4iLCAiY29uc3QgeyBURmlsZSwgVmF1bHQsIGRlYm91bmNlLCBub3JtYWxpemVQYXRoIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5cbi8vIE51ciBUZW1wbGF0ZXItU2tyaXB0ZSBtaXQgZGllc2VtIE1hcmtlciBpbiBlaW5lbSBLb21tZW50YXIgd2VyZGVuIGltXG4vLyBTaG9ydGN1dC1Nb2RhbCAoc2hvcnRjdXQtcGlja2VyLmpzKSBhbmdlYm90ZW4gLSByZWluZSBIaWxmc3NrcmlwdGUgKHouIEIuXG4vLyB0b0xpc3RJZk11bHRpcGxlLCBUWVAgc2VsYnN0KSBlcmdlYmVuIGFscyBTaG9ydGN1dCBrZWluZW4gU2lubi4gRGVyIFRleHRcbi8vIGhpbnRlciBkZW0gTWFya2VyIGJpcyB6dW0gWmVpbGVuZW5kZSBkaWVudCBhbHMgQmVzY2hyZWlidW5nIGluIGRlciBMaXN0ZTtcbi8vIGZlaGx0IGVyLCBzdGVodCBkb3J0IG51ciBkZXIgU2tyaXB0bmFtZS4gRWluIGFic2NobGllXHUwMERGZW5kZXMgXCIqL1wiIGVpbmVzXG4vLyBCbG9ja2tvbW1lbnRhcnMgZ2VoXHUwMEY2cnQgbmljaHQgenVyIEJlc2NocmVpYnVuZy5cbi8vXG4vLyBPcHRpb25hbCBmb2xndCBkaXJla3QgYXVmIGRlbiBNYXJrZXIgZWluZSBQYXJhbWV0ZXJsaXN0ZSBpbiBLbGFtbWVybi4gU2llXG4vLyBiZXNjaHJlaWJ0IGRpZSBWT0xMU1RcdTAwQzRORElHRSBBcmd1bWVudGxpc3RlIGRlcyBBdWZydWZzIG5hY2ggXCJ0cFwiIC0gYWxzbyBuaWNodFxuLy8gbnVyIGRpZSBhYmdlZnJhZ3RlbiBXZXJ0ZSwgc29uZGVybiBhdWNoLCBhbiB3ZWxjaGVyIFN0ZWxsZSBkYXMgU2tyaXB0IGRpZVxuLy8gRGF0ZWkgYnp3LiBkZW4gS29udGV4dCBoYWJlbiB3aWxsIChzaWVoZSBSRVNFUlZFRF9QQVJBTVMgaW4gc2hvcnRjdXRzLmpzKTpcbi8vICAgLy8gQHR5cC1zaG9ydGN1dChvcmRuZXIsIGphaHIpICAgICAgIC0+IGYodHAsIFwiTGl0ZXJhdHVyXCIsIDIwMjQpXG4vLyAgIC8vIEB0eXAtc2hvcnRjdXQobmV3RmlsZSwgamFocikgICAgICAtPiBmKHRwLCBuZXdGaWxlLCAyMDI0KVxuLy8gICAvLyBAdHlwLXNob3J0Y3V0KHByb3BlcnR5KSAgICAgICAgICAgLT4gZih0cCwgXCJGYW1pbGllXCIpXG4vLyAgIC8vIEB0eXAtc2hvcnRjdXQgICAgICAgICAgICAgICAgICAgICAtPiBmKHRwLCBuZXdGaWxlLCBjdHgpXG4vLyBEYWR1cmNoIGJla29tbXQgamVkZXMgU2tyaXB0IHNlaW5lIGVpZ2VuZW4gUGFyYW1ldGVyIGluIHNlaW5lciBlaWdlbmVuXG4vLyBSZWloZW5mb2xnZSwgc3RhdHQgc2ljaCBlaW5lciBmZXN0ZW4gS29udmVudGlvbiBiZXVnZW4genUgbVx1MDBGQ3NzZW4uXG4vL1xuLy8gVW50ZXJzY2hpZWRlbiB3aXJkIHp3aXNjaGVuIFwiZ2FyIGtlaW5lIEtsYW1tZXJuXCIgKHBhcmFtcyA9PT0gbnVsbCwgZGVyXG4vLyBoZXJrXHUwMEY2bW1saWNoZSBBdWZydWYgZih0cCwgbmV3RmlsZSwgY3R4KSAtIHNvIHZlcmhhbHRlbiBzaWNoIGFsbGUgYmlzaGVyXG4vLyBtYXJraWVydGVuIFNrcmlwdGUgdW52ZXJcdTAwRTRuZGVydCkgdW5kIFwibGVlcmUgS2xhbW1lcm5cIiAocGFyYW1zID09PSBbXSwgZWluXG4vLyBBdWZydWYgZ2FueiBvaG5lIEFyZ3VtZW50ZSBhdVx1MDBERmVyIHRwKS5cbi8vXG4vLyBEZXIgTWFya2VyIG11c3MgdW5taXR0ZWxiYXIgYXVmIGRlbiBLb21tZW50YXJiZWdpbm4gZm9sZ2VuLiBFaW5lIGZyXHUwMEZDaGVyZVxuLy8gRmFzc3VuZyBlcmxhdWJ0ZSBiZWxpZWJpZ2VuIFRleHQgZGF2b3IgLSBkYW1pdCBnZW5cdTAwRkNndGUgYWJlciBzY2hvbiBlaW5lXG4vLyBFcndcdTAwRTRobnVuZyBpbiBGbGllXHUwMERGdGV4dCAoXCIuLi4gaW4gc2VpbmVtIEB0eXAtc2hvcnRjdXQtTWFya2VyIGRla2xhcmllcnRcIiksXG4vLyB1bSBlaW4gU2tyaXB0IHVuZ2V3b2xsdCBhbHMgU2hvcnRjdXQgYW56dWJpZXRlbi4gR2VuYXUgZGFzIGlzdCBUWVAuanNcbi8vIHBhc3NpZXJ0LCBkZXNzZW4gS29wZmtvbW1lbnRhciBkaWUgS29udmVudGlvbiBiZXNjaHJlaWJ0LiBBbGxlIHRhdHNcdTAwRTRjaGxpY2hcbi8vIG1hcmtpZXJ0ZW4gU2tyaXB0ZSBzY2hyZWliZW4gZGVuIE1hcmtlciBvaG5laGluIGFuIGRlbiBaZWlsZW5hbmZhbmcuXG4vL1xuLy8gXCJcXGJcIiBoaW50ZXIgZGVtIE1hcmtlcm5hbWVuIHZlcmhpbmRlcnQsIGRhc3MgXCJAdHlwLXNob3J0Y3V0WFlaXCIgYW5zY2hsXHUwMEU0Z3QsXG4vLyB1bmQgc3RcdTAwRjZydCBkaWUgZGlyZWt0IGZvbGdlbmRlIEtsYW1tZXIgbmljaHQgKHQgLT4gKCBpc3QgZWluZSBXb3J0Z3JlbnplKS5cbmNvbnN0IFNIT1JUQ1VUX01BUktFUiA9IC9eWyBcXHRdKig/OlxcL1xcLyt8XFwvXFwqK3xcXCopWyBcXHRdKkB0eXAtc2hvcnRjdXRcXGIoPzpcXCgoW14pXSopXFwpKT9bIFxcdF0qKC4qPylbIFxcdF0qKD86XFwqXFwvKT9bIFxcdF0qJC9tO1xuXG4vLyBQYXJhbWV0ZXJuYW1lbiBhdXMgZGVyIEtsYW1tZXIgZGVzIE1hcmtlcnMsIGluIERla2xhcmF0aW9uc3JlaWhlbmZvbGdlLlxuLy8gTGVlcmUgRWludHJcdTAwRTRnZSAoei4gQi4gYmVpIFwiKClcIiBvZGVyIGVpbmVtIFx1MDBGQ2JlcnpcdTAwRTRobGlnZW4gS29tbWEpIGZhbGxlbiB3ZWc7XG4vLyBlaW4gdmVyc2VoZW50bGljaCBkb3BwZWx0IGdlbmFubnRlciBOYW1lIGVyZ1x1MDBFNGJlIHp3ZWkgRWluZ2FiZWZlbGRlciwgZGllXG4vLyBiZWlkZSBkZW5zZWxiZW4gRWludHJhZyBzY2hyZWliZW4sIHVuZCBibGVpYnQgZGVzaGFsYiBudXIgZWlubWFsIHN0ZWhlbi5cbmZ1bmN0aW9uIHBhcnNlUGFyYW1zKHJhdykge1xuICBjb25zdCBuYW1lbiA9IChyYXcgPz8gXCJcIilcbiAgICAuc3BsaXQoXCIsXCIpXG4gICAgLm1hcCgobmFtZSkgPT4gbmFtZS50cmltKCkpXG4gICAgLmZpbHRlcigobmFtZSkgPT4gbmFtZSAhPT0gXCJcIik7XG4gIHJldHVybiBbLi4ubmV3IFNldChuYW1lbildO1xufVxuXG4vLyBIXHUwMEU0bHQgZGllIExpc3RlIGRlciBhbHMgU2hvcnRjdXQgbWFya2llcnRlbiBUZW1wbGF0ZXItU2tyaXB0ZSBha3R1ZWxsLlxuLy9cbi8vIERpZSBMaXN0ZSB3aXJkIHZvcmFiIChhc3luY2hyb24pIGF1cyBUZW1wbGF0ZXJzIFNrcmlwdC1PcmRuZXIgZ2VsZXNlbiB1bmQgYmVpXG4vLyBcdTAwQzRuZGVydW5nZW4gZGFyaW4gbmFjaGdlZlx1MDBGQ2hydCwgc3RhdHQgc2llIGVyc3QgYmVpbSBcdTAwRDZmZm5lbiBkZXMgTW9kYWxzIHp1XG4vLyBlcm1pdHRlbG4gLSBzbyBpc3Qgc2llIGRvcnQgb2huZSBXYXJ0ZXplaXQgZGEsIHVuZCBkYXMgTW9kYWwgYmxlaWJ0IGZyZWkgdm9uXG4vLyBEYXRlaXp1Z3JpZmZlbi4gTGllZmVydCBlaW5lbiBBY2Nlc3NvciBhdWYgZGllIGpld2VpbHMgYWt0dWVsbGUgTGlzdGVcbi8vIChbeyBuYW1lLCBwYXJhbXMsIGRlc2NyaXB0aW9uIH1dLCBuYWNoIE5hbWVuIHNvcnRpZXJ0KS5cbmZ1bmN0aW9uIHJlZ2lzdGVyU2hvcnRjdXRTY3JpcHRzKHBsdWdpbikge1xuICBjb25zdCB7IGFwcCB9ID0gcGx1Z2luO1xuXG4gIGxldCBzY3JpcHRGb2xkZXIgPSBudWxsO1xuICBsZXQgc2NyaXB0cyA9IFtdO1xuXG4gIGNvbnN0IGN1cnJlbnRTY3JpcHRGb2xkZXIgPSAoKSA9PiB7XG4gICAgY29uc3QgZm9sZGVyID0gYXBwLnBsdWdpbnMucGx1Z2luc1tcInRlbXBsYXRlci1vYnNpZGlhblwiXT8uc2V0dGluZ3M/LnVzZXJfc2NyaXB0c19mb2xkZXI7XG4gICAgcmV0dXJuIGZvbGRlciA/IG5vcm1hbGl6ZVBhdGgoZm9sZGVyKSA6IG51bGw7XG4gIH07XG5cbiAgY29uc3QgaXNJblNjcmlwdEZvbGRlciA9IChwYXRoKSA9PiAhIXNjcmlwdEZvbGRlciAmJiAhIXBhdGggJiYgcGF0aC5zdGFydHNXaXRoKHNjcmlwdEZvbGRlciArIFwiL1wiKTtcblxuICAvLyBXaWUgVGVtcGxhdGVyIHNlbGJzdDogYWxsZSAuanMtRGF0ZWllbiBpbSBTa3JpcHQtT3JkbmVyIGlua2wuXG4gIC8vIFVudGVyb3JkbmVybiwgU2tyaXB0bmFtZSA9IERhdGVpbmFtZSBvaG5lIEVuZHVuZy5cbiAgYXN5bmMgZnVuY3Rpb24gcmVmcmVzaFNjcmlwdHMoKSB7XG4gICAgY29uc3QgZm9sZGVyUGF0aCA9IGN1cnJlbnRTY3JpcHRGb2xkZXIoKTtcbiAgICBzY3JpcHRGb2xkZXIgPSBmb2xkZXJQYXRoO1xuICAgIGNvbnN0IGZvbGRlciA9IGZvbGRlclBhdGggPyBhcHAudmF1bHQuZ2V0Rm9sZGVyQnlQYXRoKGZvbGRlclBhdGgpIDogbnVsbDtcbiAgICBjb25zdCBmaWxlcyA9IFtdO1xuICAgIGlmIChmb2xkZXIpIHtcbiAgICAgIFZhdWx0LnJlY3Vyc2VDaGlsZHJlbihmb2xkZXIsIChjaGlsZCkgPT4ge1xuICAgICAgICBpZiAoY2hpbGQgaW5zdGFuY2VvZiBURmlsZSAmJiBjaGlsZC5leHRlbnNpb24gPT09IFwianNcIikgZmlsZXMucHVzaChjaGlsZCk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgY29uc3QgZm91bmQgPSBbXTtcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IG1hdGNoID0gKGF3YWl0IGFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpKS5tYXRjaChTSE9SVENVVF9NQVJLRVIpO1xuICAgICAgICAvLyBtYXRjaFsxXSBpc3QgdW5kZWZpbmVkLCB3ZW5uIGdhciBrZWluZSBLbGFtbWVybiBkYXN0ZWhlbiwgdW5kIFwiXCIgYmVpXG4gICAgICAgIC8vIGxlZXJlbiBLbGFtbWVybiAtIGRlciBVbnRlcnNjaGllZCBlbnRzY2hlaWRldCBcdTAwRkNiZXIgZGllIEF1ZnJ1ZmZvcm0uXG4gICAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICAgIGZvdW5kLnB1c2goe1xuICAgICAgICAgICAgbmFtZTogZmlsZS5iYXNlbmFtZSxcbiAgICAgICAgICAgIHBhcmFtczogbWF0Y2hbMV0gPT09IHVuZGVmaW5lZCA/IG51bGwgOiBwYXJzZVBhcmFtcyhtYXRjaFsxXSksXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogbWF0Y2hbMl0gPz8gXCJcIixcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLmVycm9yKGBUWVAtU3lzdGVtOiBUZW1wbGF0ZXItU2tyaXB0ICR7ZmlsZS5wYXRofSBuaWNodCBsZXNiYXJgLCBlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gT3JkbmVyIHp3aXNjaGVuemVpdGxpY2ggaW4gVGVtcGxhdGVyIHVtZ2VzdGVsbHQ6IEVyZ2VibmlzIHZlcndlcmZlbixcbiAgICAvLyBkZXIgTGF1ZiBmXHUwMEZDciBkZW4gbmV1ZW4gT3JkbmVyIGlzdCBiZXJlaXRzIGFuZ2VzdG9cdTAwREZlbi5cbiAgICBpZiAoZm9sZGVyUGF0aCAhPT0gc2NyaXB0Rm9sZGVyKSByZXR1cm47XG4gICAgc2NyaXB0cyA9IGZvdW5kLnNvcnQoKGEsIGIpID0+IGEubmFtZS5sb2NhbGVDb21wYXJlKGIubmFtZSkpO1xuICB9XG5cbiAgY29uc3Qgc2NoZWR1bGVSZWZyZXNoID0gZGVib3VuY2UocmVmcmVzaFNjcmlwdHMsIDMwMCwgdHJ1ZSk7XG4gIGNvbnN0IG9uRmlsZUNoYW5nZSA9IChmaWxlLCBvbGRQYXRoKSA9PiB7XG4gICAgaWYgKGlzSW5TY3JpcHRGb2xkZXIoZmlsZT8ucGF0aCkgfHwgaXNJblNjcmlwdEZvbGRlcihvbGRQYXRoKSkgc2NoZWR1bGVSZWZyZXNoKCk7XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC52YXVsdC5vbihcImNyZWF0ZVwiLCBvbkZpbGVDaGFuZ2UpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoYXBwLnZhdWx0Lm9uKFwibW9kaWZ5XCIsIG9uRmlsZUNoYW5nZSkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJkZWxldGVcIiwgb25GaWxlQ2hhbmdlKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC52YXVsdC5vbihcInJlbmFtZVwiLCBvbkZpbGVDaGFuZ2UpKTtcbiAgYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KHJlZnJlc2hTY3JpcHRzKTtcblxuICByZXR1cm4gKCkgPT4ge1xuICAgIC8vIFRlbXBsYXRlci1PcmRuZXIgaW56d2lzY2hlbiB1bWdlc3RlbGx0OiBmXHUwMEZDciBkZW4gblx1MDBFNGNoc3RlbiBBdWZydWZcbiAgICAvLyBuYWNobGFkZW4sIGpldHp0IG5vY2ggbWl0IGRlciBiaXNoZXJpZ2VuIExpc3RlIGFudHdvcnRlbi5cbiAgICBpZiAoY3VycmVudFNjcmlwdEZvbGRlcigpICE9PSBzY3JpcHRGb2xkZXIpIHNjaGVkdWxlUmVmcmVzaCgpO1xuICAgIHJldHVybiBzY3JpcHRzO1xuICB9O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJTaG9ydGN1dFNjcmlwdHMsIFNIT1JUQ1VUX01BUktFUiwgcGFyc2VQYXJhbXMgfTtcbiIsICJjb25zdCB7IFBsdWdpbiB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xyXG5jb25zdCB7IERFRkFVTFRfU0VUVElOR1MsIFR5cFN5c3RlbVNldHRpbmdUYWIgfSA9IHJlcXVpcmUoXCIuL3NldHRpbmdzXCIpO1xyXG5jb25zdCB7IHJlZ2lzdGVyQ29tbWFuZHMgfSA9IHJlcXVpcmUoXCIuL2NvbW1hbmRzXCIpO1xyXG5jb25zdCB7IHJlZ2lzdGVyVHlwVmlldywgc29ydFR5cGVzQnlNb2RlLCBERUZBVUxUX1NPUlRfT1JERVIgfSA9IHJlcXVpcmUoXCIuL3R5cC12aWV3XCIpO1xyXG5jb25zdCB7IFR5cEluZGV4LCBzZXRDYW5vbmljYWxQcm9wZXJ0eSwgZGVsZXRlUHJvcGVydHksIFRZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZIH0gPSByZXF1aXJlKFwiLi90eXAtaW5kZXhcIik7XHJcbmNvbnN0IHsgZ2V0U3VidHlwZSwgZ2V0U3VidHlwZU5hbWVzLCBtaWdyYXRlQWJvdmVTdGFuZGFyZCwgbWlncmF0ZVN1YnR5cGVDb2xvclNjYWxlIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBlc1wiKTtcclxuY29uc3QgeyBERUZBVUxUX1NVQlRZUEVfQ09MT1JfUkFOR0VTIH0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcclxuY29uc3QgeyByZWdpc3RlckZpbGVFeHBsb3JlckNvbG9ycyB9ID0gcmVxdWlyZShcIi4vZmlsZS1leHBsb3Jlci1jb2xvcnNcIik7XHJcbmNvbnN0IHsgcmVnaXN0ZXJHcmFwaENvbG9ycyB9ID0gcmVxdWlyZShcIi4vZ3JhcGgtY29sb3JzXCIpO1xyXG5jb25zdCB7IHJlZ2lzdGVyU2VhcmNoQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9zZWFyY2gtY29sb3JzXCIpO1xyXG5jb25zdCB7IHJlZ2lzdGVyUmVjZW50RmlsZXNDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL3JlY2VudC1maWxlcy1jb2xvcnNcIik7XHJcbmNvbnN0IHsgcmVnaXN0ZXJCYWNrbGlua0NvbG9ycyB9ID0gcmVxdWlyZShcIi4vYmFja2xpbmstY29sb3JzXCIpO1xyXG5jb25zdCB7IHJlZ2lzdGVyQm9va21hcmtzQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9ib29rbWFyay1jb2xvcnNcIik7XHJcbmNvbnN0IHsgcmVnaXN0ZXJBY3RpdmVUaXRsZUNvbG9ycyB9ID0gcmVxdWlyZShcIi4vYWN0aXZlLXRpdGxlLWNvbG9yc1wiKTtcclxuY29uc3QgeyByZWdpc3RlckxpbmtDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL2xpbmstY29sb3JzXCIpO1xyXG5jb25zdCB7IHJlZ2lzdGVyRnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0IH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1kZWZhdWx0LWhpZ2hsaWdodFwiKTtcclxuY29uc3QgeyByZWdpc3RlclByb3BlcnR5UmVuYW1lU3luYyB9ID0gcmVxdWlyZShcIi4vcHJvcGVydHktcmVuYW1lLXN5bmNcIik7XHJcbmNvbnN0IHsgbm9ybWFsaXplR2xvYmFsT3JkZXIsIHNvcnRGcm9udG1hdHRlckZvciwgcGxhY2VQcm9wZXJ0eUZvciB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItc29ydFwiKTtcclxuY29uc3QgeyByZXNvbHZlU2hvcnRjdXRzLCBzY3JpcHROYW1lT2YsIHJlc29sdmVDYWxsQXJncyB9ID0gcmVxdWlyZShcIi4vc2hvcnRjdXRzXCIpO1xyXG5jb25zdCB7XHJcbiAgcGlja1R5cGU6IHBpY2tUeXBlTW9kYWwsXHJcbiAgcGlja1N1YnR5cGU6IHBpY2tTdWJ0eXBlTW9kYWwsXHJcbiAgcGlja1R5cGVBbmRTdWJ0eXBlOiBwaWNrVHlwZUFuZFN1YnR5cGVNb2RhbCxcclxufSA9IHJlcXVpcmUoXCIuL3R5cGUtcGlja2VyXCIpO1xyXG5jb25zdCB7IHJlZ2lzdGVyU2hvcnRjdXRTY3JpcHRzIH0gPSByZXF1aXJlKFwiLi9zaG9ydGN1dC1zY3JpcHRzXCIpO1xyXG5cclxuLy8gTWlncmllcnQgQmVzdGFuZHNpbnN0YWxsYXRpb25lbiB2b24gZGVyIGFsdGVuLCBzZXBhcmF0ZW5cclxuLy8gdHlwZUZsb2F0aW5nRnJvbnRtYXR0ZXItTGlzdGUgKGVpZ2VuZXMgRGljdCBqZSBUeXAsIGltbWVyIGhpbnRlciBkZXJcclxuLy8gU3RhbmRhcmRsaXN0ZSBzb3J0aWVydCkgYXVmIGRpZSBuZXVlIHR5cGVGbG9hdGluZ0tleXMtTWFya2llcnVuZyBpbm5lcmhhbGJcclxuLy8gZGVyc2VsYmVuIHR5cGVEZWZhdWx0RnJvbnRtYXR0ZXItTGlzdGUgKHNpZWhlIEtvbW1lbnRhciBhbiB0eXBlRmxvYXRpbmdLZXlzXHJcbi8vIGluIHNldHRpbmdzLmpzKSAtIGRpZSBGbG9hdGluZyBQcm9wZXJ0aWVzIGxhbmRlbiBkYWJlaSB1bnZlclx1MDBFNG5kZXJ0IGRpcmVrdFxyXG4vLyBpbSBBbnNjaGx1c3MgYW4gZGllIGJpc2hlcmlnZSBTdGFuZGFyZGxpc3RlLCBnZW5hdSB3aWUgenV2b3IuXHJcbmZ1bmN0aW9uIG1pZ3JhdGVGbG9hdGluZ0Zyb250bWF0dGVyKHNldHRpbmdzKSB7XHJcbiAgaWYgKCFzZXR0aW5ncy50eXBlRmxvYXRpbmdGcm9udG1hdHRlcikgcmV0dXJuO1xyXG4gIGZvciAoY29uc3QgW3R5cGUsIGZsb2F0aW5nXSBvZiBPYmplY3QuZW50cmllcyhzZXR0aW5ncy50eXBlRmxvYXRpbmdGcm9udG1hdHRlcikpIHtcclxuICAgIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyhmbG9hdGluZykuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gXCJcIik7XHJcbiAgICBpZiAoa2V5cy5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xyXG4gICAgc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXSA9IHsgLi4uKHNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV0gPz8ge30pLCAuLi5mbG9hdGluZyB9O1xyXG4gICAgc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXSA9IFsuLi5uZXcgU2V0KFsuLi4oc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXSA/PyBbXSksIC4uLmtleXNdKV07XHJcbiAgfVxyXG4gIGRlbGV0ZSBzZXR0aW5ncy50eXBlRmxvYXRpbmdGcm9udG1hdHRlcjtcclxufVxyXG5cclxuLy8gQXVzIGRlbSBmcnVlaGVyZW4gU2NoYWx0ZXIgXCJCZXNjaHJlaWJ1bmdzLVRleHRmZWxkIGFuemVpZ2VuXCIgKEJvb2xlYW4pIGlzdFxyXG4vLyBkZXIgZHJlaXN0dWZpZ2UgTW9kdXMgZGVyIHp3ZWl0ZW4gU3BhbHRlIGdld29yZGVuLCB1bWdlc2NoYWx0ZXQgdWViZXIgZGVuXHJcbi8vIEtub3BmIGltIExpc3Rlbi1IZWFkZXIgKHNpZWhlIFNFQ09OREFSWV9NT0RFUyBpbiB0eXAtdmlldy5qcykuIERlciBhbHRlIFdlcnRcclxuLy8ga2VubnQgbnVyIHp3ZWkgZGVyIGRyZWkgWnVzdGFlbmRlIC0gdHJ1ZSB3aXJkIHp1ciBCZXNjaHJlaWJ1bmcsIGZhbHNlIHp1XHJcbi8vIFwibmljaHRzXCI7IFwic3VidHlwZXNcIiBnYWIgZXMgZGFtYWxzIG5vY2ggbmljaHQuIExpZWZlcnQgdHJ1ZSBiZWkgZWluZXJcclxuLy8gQWVuZGVydW5nLCBkYW1pdCBkZXIgQXVmcnVmZXIgc2llIGdsZWljaCBzY2hyZWlidCB1bmQgZGVyIGFsdGUgU2NobHVlc3NlbFxyXG4vLyBuaWNodCBpbiBkYXRhLmpzb24gbGllZ2VuIGJsZWlidC5cclxuLy9cclxuLy8gR2VwcnVlZnQgd2lyZCBnZWdlbiBzdG9yZWQgKGRpZSByb2hlbiBnZWxhZGVuZW4gRGF0ZW4pLCBOSUNIVCBnZWdlbiBzZXR0aW5nczpcclxuLy8gZG9ydCBoYXQgT2JqZWN0LmFzc2lnbiBkZW4gbmV1ZW4gU2NobHVlc3NlbCBsYWVuZ3N0IGF1cyBERUZBVUxUX1NFVFRJTkdTXHJcbi8vIGdlZnVlbGx0LCBcIm5vY2ggbmljaHQgZ2VzZXR6dFwiIHdhZXJlIGRhcmFuIGFsc28gbmllIHp1IGVya2VubmVuIHVuZCBkZXIgYWx0ZVxyXG4vLyBXZXJ0IGJsaWViZSBzdGlsbHNjaHdlaWdlbmQgbGllZ2VuLlxyXG5mdW5jdGlvbiBtaWdyYXRlVHlwTGlzdFNlY29uZGFyeShzZXR0aW5ncywgc3RvcmVkKSB7XHJcbiAgaWYgKHN0b3JlZD8udHlwTGlzdERlc2NyaXB0aW9uRW5hYmxlZCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7XHJcbiAgaWYgKHN0b3JlZC50eXBMaXN0U2Vjb25kYXJ5ID09PSB1bmRlZmluZWQpIHtcclxuICAgIHNldHRpbmdzLnR5cExpc3RTZWNvbmRhcnkgPSBzdG9yZWQudHlwTGlzdERlc2NyaXB0aW9uRW5hYmxlZCA/IFwiZGVzY3JpcHRpb25cIiA6IFwibm9uZVwiO1xyXG4gIH1cclxuICBkZWxldGUgc2V0dGluZ3MudHlwTGlzdERlc2NyaXB0aW9uRW5hYmxlZDtcclxuICByZXR1cm4gdHJ1ZTtcclxufVxyXG5cclxuLy8gRGllIEF1c3JpY2h0dW5nIGRlciBTdWJ0eXAtVm9yc2NoYXUgd2FyIGt1cnp6ZWl0aWcgZWluZSBlaWdlbmUgRWluc3RlbGx1bmdcclxuLy8gdW5kIGlzdCBqZXR6dCBlaW4gU3R5bGUgU2V0dGluZyAoYm9keS1LbGFzc2UsIHNpZWhlIGRlbiBAc2V0dGluZ3MtQmxvY2sgaW5cclxuLy8gc3R5bGVzLmNzcykgLSBkYXMgUGx1Z2luIGxpZXN0IGRlbiBTY2hsdWVzc2VsIG5pY2h0IG1laHIuIE9obmUgZGllc2VzXHJcbi8vIEF1ZnJhZXVtZW4gYmxpZWJlIGVyIHVlYmVyIE9iamVjdC5hc3NpZ24gaW4gbG9hZFNldHRpbmdzIGRhdWVyaGFmdCBpblxyXG4vLyBkYXRhLmpzb24gc3RlaGVuLlxyXG5mdW5jdGlvbiBkcm9wVHlwTGlzdFN1YnR5cGVzQWxpZ24oc2V0dGluZ3MpIHtcclxuICBpZiAoc2V0dGluZ3MudHlwTGlzdFN1YnR5cGVzUmlnaHRBbGlnbmVkID09PSB1bmRlZmluZWQpIHJldHVybiBmYWxzZTtcclxuICBkZWxldGUgc2V0dGluZ3MudHlwTGlzdFN1YnR5cGVzUmlnaHRBbGlnbmVkO1xyXG4gIHJldHVybiB0cnVlO1xyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IGNsYXNzIFR5cFN5c3RlbVBsdWdpbiBleHRlbmRzIFBsdWdpbiB7XHJcbiAgYXN5bmMgb25sb2FkKCkge1xyXG4gICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcclxuXHJcbiAgICAvLyBWb3IgYWxsZW4gXHUwMEZDYnJpZ2VuIE1vZHVsZW46IGRpZSByZWdpc3RyaWVyZW4gc2ljaCBhdWYgZGVzc2VuIFwiY2hhbmdlXCItXHJcbiAgICAvLyBFdmVudCB1bmQgbGVzZW4gVFlQL1NVQlRZUCBhdXNzY2hsaWVcdTAwREZsaWNoIGRhclx1MDBGQ2JlciAoc2llaGUgdHlwLWluZGV4LmpzKS5cclxuICAgIHRoaXMudHlwSW5kZXggPSBuZXcgVHlwSW5kZXgodGhpcyk7XHJcbiAgICB0aGlzLnR5cEluZGV4LnJlZ2lzdGVyKCk7XHJcblxyXG4gICAgcmVnaXN0ZXJDb21tYW5kcyh0aGlzKTtcclxuICAgIHRoaXMuYWRkU2V0dGluZ1RhYihuZXcgVHlwU3lzdGVtU2V0dGluZ1RhYih0aGlzLmFwcCwgdGhpcykpO1xyXG4gICAgLy8gVW1iZW5lbm51bmdlbiBcdTAwRkNiZXIgXCJBbGwgcHJvcGVydGllc1wiL0Jhc2VzIGF1Y2ggaW5zIFRZUC1Gcm9udG1hdHRlclxyXG4gICAgLy8gZGVyIFR5cGVuIFx1MDBGQ2Jlcm5laG1lbiAoc2llaGUgcHJvcGVydHktcmVuYW1lLXN5bmMuanMpLlxyXG4gICAgcmVnaXN0ZXJQcm9wZXJ0eVJlbmFtZVN5bmModGhpcyk7XHJcbiAgICAvLyBBY2Nlc3NvciBhdWYgZGllIGFscyBcIkB0eXAtc2hvcnRjdXRcIiBtYXJraWVydGVuIFRlbXBsYXRlci1Ta3JpcHRlLCBmXHUwMEZDclxyXG4gICAgLy8gZGFzIEF1c3dhaGwtTW9kYWwgZGVyIFByb3BlcnR5LVplaWxlbiAoc2llaGUgc2hvcnRjdXQtcGlja2VyLmpzKS5cclxuICAgIHRoaXMuZ2V0U2hvcnRjdXRTY3JpcHRzID0gcmVnaXN0ZXJTaG9ydGN1dFNjcmlwdHModGhpcyk7XHJcblxyXG4gICAgLy8gU2VwYXJhdCBnZWhhbHRlbiAobmljaHQgbnVyIFRlaWwgdm9uIHJlZnJlc2hGbnMpOiBkaWUgVFlQLURldGFpbGFuc2ljaHRcclxuICAgIC8vIGJyYXVjaHQgbmFjaCBkZW0gTW91bnRlbiBpaHJlcyBUWVAtRnJvbnRtYXR0ZXItRWRpdG9ycyBnZXppZWx0IG51clxyXG4gICAgLy8gZGllc2VuIGVpbmVuIFJlZnJlc2ggKEZldHQtTWFya2llcnVuZyBkZXIgUHJvcGVydHktWmVpbGVuKSAtIGRhcyBnYW56ZVxyXG4gICAgLy8gcmVmcmVzaFR5cENvbG9ycygpLUJcdTAwRkNuZGVsIHdcdTAwRkNyZGUgZG9ydCBhdWNoIHVublx1MDBGNnRpZyByZWdpc3RlclR5cFZpZXcnc1xyXG4gICAgLy8gZWlnZW5lbiBSZW5kZXItUmVmcmVzaCBtaXRhbnN0b1x1MDBERmVuIHVuZCBzaWNoIGRhbWl0IHNlbGJzdCByZWt1cnNpdlxyXG4gICAgLy8gZXJuZXV0IHJlbmRlcm4gKGZcdTAwRkNocnRlIHp1IGVpbmVtIFN0YWNrIE92ZXJmbG93IGJlaSBqZWRlbSBUWVAtXHUwMEQ2ZmZuZW4pLlxyXG4gICAgdGhpcy5yZWZyZXNoRnJvbnRtYXR0ZXJIaWdobGlnaHQgPSByZWdpc3RlckZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodCh0aGlzKTtcclxuXHJcbiAgICBjb25zdCByZWZyZXNoRm5zID0gW1xyXG4gICAgICByZWdpc3RlclR5cFZpZXcodGhpcyksXHJcbiAgICAgIHJlZ2lzdGVyRmlsZUV4cGxvcmVyQ29sb3JzKHRoaXMpLFxyXG4gICAgICByZWdpc3RlckdyYXBoQ29sb3JzKHRoaXMpLFxyXG4gICAgICByZWdpc3RlclNlYXJjaENvbG9ycyh0aGlzKSxcclxuICAgICAgcmVnaXN0ZXJSZWNlbnRGaWxlc0NvbG9ycyh0aGlzKSxcclxuICAgICAgcmVnaXN0ZXJCYWNrbGlua0NvbG9ycyh0aGlzKSxcclxuICAgICAgcmVnaXN0ZXJCb29rbWFya3NDb2xvcnModGhpcyksXHJcbiAgICAgIHJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnModGhpcyksXHJcbiAgICAgIHJlZ2lzdGVyTGlua0NvbG9ycyh0aGlzKSxcclxuICAgICAgdGhpcy5yZWZyZXNoRnJvbnRtYXR0ZXJIaWdobGlnaHQsXHJcbiAgICBdO1xyXG4gICAgdGhpcy5yZWZyZXNoVHlwQ29sb3JzID0gKCkgPT4gcmVmcmVzaEZucy5mb3JFYWNoKChmbikgPT4gZm4oKSk7XHJcblxyXG4gICAgLy8gRGVyIEBzZXR0aW5ncy1CbG9jayBpbiBzdHlsZXMuY3NzIChTdHlsZSBTZXR0aW5ncywgc2llaGUgZG9ydCkgd2lyZCBzb25zdFxyXG4gICAgLy8gamUgbmFjaCBMYWRlcmVpaGVuZm9sZ2UgdWViZXJzZWhlbjogU3R5bGUgU2V0dGluZ3MgbGllc3QgZGllIFN0eWxlc2hlZXRzXHJcbiAgICAvLyBiZWltIGVpZ2VuZW4gTGFkZW4gdW5kIGRhbmFjaCBudXIgbm9jaCBiZWkgXCJjc3MtY2hhbmdlXCIgLSBkYXMgZmV1ZXJ0IGFiZXJcclxuICAgIC8vIGF1c3NjaGxpZXNzbGljaCBmdWVyIFRoZW1lcyB1bmQgU25pcHBldHMsIG5pY2h0IGZ1ZXIgZGFzIHN0eWxlcy5jc3MgZWluZXNcclxuICAgIC8vIFBsdWdpbnMuIFdlciBzcGFldGVyIGdlbGFkZW4gd2lyZCBhbHMgU3R5bGUgU2V0dGluZ3MgKG9kZXIgcGVyIEhvdC1SZWxvYWRcclxuICAgIC8vIG5ldSBnZWxhZGVuIHdpcmQpLCB0YXVjaHQgZG9ydCBhbHNvIGdhciBuaWNodCBhdWYuIFwicGFyc2Utc3R5bGUtc2V0dGluZ3NcIlxyXG4gICAgLy8gaXN0IGRlciBkYWZ1ZXIgdm9yZ2VzZWhlbmUgSG9vazsgb2huZSBpbnN0YWxsaWVydGVzIFN0eWxlIFNldHRpbmdzIGhvZXJ0XHJcbiAgICAvLyBuaWVtYW5kIHp1IHVuZCBkZXIgQXVmcnVmIHZlcnB1ZmZ0IGZvbGdlbmxvcy5cclxuICAgIC8vXHJcbiAgICAvLyBFcnN0IGltIG5hZWNoc3RlbiBUaWNrOiBPYnNpZGlhbiBoYWVuZ3QgZGFzIHN0eWxlcy5jc3MgZWluZXMgUGx1Z2lucyBlcnN0XHJcbiAgICAvLyBOQUNIIGRlc3NlbiBvbmxvYWQoKSBpbiBkZW4gRE9NIC0gc3luY2hyb24gaGllciBnZXJ1ZmVuIGZ1ZW5kZSBTdHlsZVxyXG4gICAgLy8gU2V0dGluZ3MgZGFzIFN0eWxlc2hlZXQgbm9jaCBnYXIgbmljaHQgdW5kIGxpZXNzZSBkZW4gQWJzY2huaXR0IGF1cy5cclxuICAgIC8vIG9uTGF5b3V0UmVhZHkgdGF1Z3QgZGFmdWVyIG5pY2h0OiBiZWltIEhvdC1SZWxvYWQgaXN0IGRhcyBMYXlvdXQgbGFlbmdzdFxyXG4gICAgLy8gZmVydGlnLCBkZXIgUnVlY2tydWYgbGllZmUgYWxzbyBzb2ZvcnQgdW5kIGRhbWl0IGdlbmF1c28genUgZnJ1ZWguXHJcbiAgICBjb25zdCBwYXJzZVN0eWxlU2V0dGluZ3MgPSB3aW5kb3cuc2V0VGltZW91dCgoKSA9PiB0aGlzLmFwcC53b3Jrc3BhY2UudHJpZ2dlcihcInBhcnNlLXN0eWxlLXNldHRpbmdzXCIpLCAwKTtcclxuICAgIHRoaXMucmVnaXN0ZXIoKCkgPT4gd2luZG93LmNsZWFyVGltZW91dChwYXJzZVN0eWxlU2V0dGluZ3MpKTtcclxuICB9XHJcblxyXG4gIG9udW5sb2FkKCkge31cclxuXHJcbiAgLy8gRlx1MDBGQ3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qczogbGllZmVydCBkaWUgaW0gVFlQLVZpZXcgdW50ZXJcclxuICAvLyBcIlRZUC1Gcm9udG1hdHRlclwiIGhpbnRlcmxlZ3RlbiBQcm9wZXJ0aWVzIGZcdTAwRkNyIGRlbiBnZWdlYmVuZW4gVFlQLCBkYW1pdFxyXG4gIC8vIFRlbXBsYXRlciBzaWUgYmVpbSBBbmxlZ2VuIGVpbmVyIG5ldWVuIE5vdGl6IFx1MDBGQ2Jlcm5laG1lbiBrYW5uLCBzdGF0dCBzaWUgZG9ydFxyXG4gIC8vIGVpbiB6d2VpdGVzIE1hbCB6dSBwZmxlZ2VuLiBLb3BpZSBzdGF0dCBkaXJla3RlciBSZWZlcmVueiwgZGFtaXQgZWluXHJcbiAgLy8gQXVmcnVmZXIgZGllIHp1clx1MDBGQ2NrZ2VnZWJlbmVuIFdlcnRlIGdlZmFocmxvcyBtdXRpZXJlbiBrYW5uLCBvaG5lIGRpZVxyXG4gIC8vIFBsdWdpbi1TZXR0aW5ncyB6dSB2ZXJcdTAwRTRuZGVybi5cclxuICAvL1xyXG4gIC8vIFByb3BlcnRpZXMgbWl0IGVpbmVtIGZlc3RlbiBTaG9ydGN1dCAodG9kYXkvbm93L2NyZWF0ZWQsIHNpZWhlXHJcbiAgLy8gc2hvcnRjdXRzLmpzKSB0cmFnZW4gZGVzc2VuIGVyc3QgaGllciBhdWZnZWxcdTAwRjZzdGVuIFdlcnQgLSBuaWNodCBkZW4gYmVpbVxyXG4gIC8vIFNldHplbiBnXHUwMEZDbHRpZ2VuLCBlcyBrb21tdCBhbHNvIGJlaSBqZWRlbSBBdWZydWYgZnJpc2NoIEJlcmVjaG5ldGVzIGhlcmF1cy5cclxuICAvLyBQcm9wZXJ0aWVzIG1pdCBlaW5lbSBTa3JpcHQtU2hvcnRjdXQgdHJhZ2VuIG51bGw6IGRpZSBrYW5uIG51ciBUZW1wbGF0ZXJcclxuICAvLyBhdWZsXHUwMEY2c2VuLCBUWVAuanMgaG9sdCBzaWUgc2ljaCBcdTAwRkNiZXIgZ2V0VHlwZVNob3J0Y3V0cygpICh1bnRlbikgdW5kIHNldHp0XHJcbiAgLy8gc2llIHNlbGJzdCBlaW4uIEtleSB1bmQgUG9zaXRpb24gYmxlaWJlbiBpbiBiZWlkZW4gRlx1MDBFNGxsZW4gZXJoYWx0ZW4uXHJcbiAgLy9cclxuICAvLyBpbmNsdWRlRmxvYXRpbmcgKFN0YW5kYXJkOiBmYWxzZSkgbFx1MDBFNHNzdCBkaWUgYWxzIFwiRmxvYXRpbmcgUHJvcGVydHlcIlxyXG4gIC8vIG1hcmtpZXJ0ZW4gS2V5cyAodHlwZUZsb2F0aW5nS2V5cykgaW4gZGVyIExpc3RlIC0gYW5kZXJzIGFscyBkaWUgXHUwMEZDYnJpZ2VuXHJcbiAgLy8gU3RhbmRhcmQtUHJvcGVydGllcyB3ZXJkZW4gZGllc2UgTklDSFQgYXV0b21hdGlzY2ggYmVpIGplZGVyIG5ldWVuIE5vdGl6XHJcbiAgLy8gYW5nZWxlZ3QgKHNpZSB6XHUwMEU0aGxlbiB6d2FyIGZcdTAwRkNyIGRpZSBGcm9udG1hdHRlci1Tb3J0aWVydW5nIG1pdCwgc2llaGVcclxuICAvLyBvcmRlcmVkRGVmYXVsdEtleXMgaW4gZnJvbnRtYXR0ZXItc29ydC5qcywgc29sbGVuIGFiZXIgbnVyIGJlaSBCZWRhcmZcclxuICAvLyBleHBsaXppdCB2b24gZWluZW0gVGVtcGxhdGVyLVNrcmlwdCBhYmdlZ3JpZmZlbiB3ZXJkZW4pLlxyXG4gIC8vXHJcbiAgLy8gZmlsZSAob3B0aW9uYWwpIHdpcmQgYW4gcmVzb2x2ZVNob3J0Y3V0cygpIGR1cmNoZ2VyZWljaHQgLSBudXIgZlx1MDBGQ3IgZGVuXHJcbiAgLy8gXCJjcmVhdGVkXCItU2hvcnRjdXQgcmVsZXZhbnQsIGRlciBkYXMgRXJzdGVsbHVuZ3NkYXR1bSBkZXIgWmllbC1EYXRlaSBzdGF0dFxyXG4gIC8vIGRlcyBBdWZydWZ6ZWl0cHVua3RzIGxpZWZlcnQuXHJcbiAgLy9cclxuICAvLyBzdWJ0eXBlIChvcHRpb25hbCk6IGVyZ1x1MDBFNG56dCBkYXMgVFlQLUZyb250bWF0dGVyIHVtIGRlbiBCbG9jayBkaWVzZXNcclxuICAvLyBTdWJ0eXBzIChzaWVoZSBzdWJ0eXBlcy5qcyksIGRlc3NlbiBLZXlzIGZvbGdlbiBkYWhpbnRlciAod2ljaHRpZyBmXHUwMEZDciBkaWVcclxuICAvLyBSZWloZW5mb2xnZSBkZXIgU2tyaXB0LVNob3J0Y3V0cykuIFN0ZWh0IGVpbiBLZXkgaW4gQkVJREVOIEJsXHUwMEY2Y2tlbiwgYmVoXHUwMEU0bHRcclxuICAvLyBlciBkaWUgUG9zaXRpb24gZGVzIFRZUC1Gcm9udG1hdHRlcnMsIFdlcnQsIEZsb2F0aW5nLU1hcmtpZXJ1bmcgdW5kXHJcbiAgLy8gU2hvcnRjdXQga29tbWVuIGFiZXIgdm9tIFN1YnR5cCAtIGVpbmUgWnV3ZWlzdW5nIGF1ZiBlaW5lbiBiZXJlaXRzIHZvcmhhbmRlbmVuXHJcbiAgLy8gT2JqZWt0c2NobFx1MDBGQ3NzZWwgXHUwMEZDYmVyc2NocmVpYnQgaWhuLCBvaG5lIGlobiB6dSB2ZXJzY2hpZWJlbi4gRGllXHJcbiAgLy8gRnJvbnRtYXR0ZXItU29ydGllcnVuZyBtdXNzIGRpZXNlbGJlIFJlZ2VsIHZlcndlbmRlbiwgc29uc3Qgd1x1MDBGQ3JkZSBzaWVcclxuICAvLyBlaW5lIGdlcmFkZSBhbmdlbGVndGUgTm90aXogc29mb3J0IHdpZWRlciB1bXNvcnRpZXJlbiAoc2llaGVcclxuICAvLyBvcmRlcmVkRGVmYXVsdEtleXMgaW4gZnJvbnRtYXR0ZXItc29ydC5qcykuXHJcbiAgZ2V0VHlwZURlZmF1bHRzKHR5cGUsIHsgaW5jbHVkZUZsb2F0aW5nID0gZmFsc2UsIGZpbGUsIHN1YnR5cGUgPSBudWxsIH0gPSB7fSkge1xyXG4gICAgY29uc3QgeyBkZWZhdWx0cywgc2hvcnRjdXRzIH0gPSB0aGlzLmNvbGxlY3RCbG9ja3ModHlwZSwgc3VidHlwZSwgaW5jbHVkZUZsb2F0aW5nKTtcclxuICAgIHJldHVybiByZXNvbHZlU2hvcnRjdXRzKGRlZmF1bHRzLCBzaG9ydGN1dHMsIHsgZmlsZSwgYXBwOiB0aGlzLmFwcCB9KTtcclxuICB9XHJcblxyXG4gIC8vIEdlbWVpbnNhbWUgR3J1bmRsYWdlIHZvbiBnZXRUeXBlRGVmYXVsdHMoKSB1bmQgZ2V0VHlwZVNob3J0Y3V0cygpOiBkYXNcclxuICAvLyBUWVAtRnJvbnRtYXR0ZXIgZGVzIFR5cHMsIGVyZ1x1MDBFNG56dCB1bSBkZW4gQmxvY2sgZGVzIFN1YnR5cHMuIEVpbiBLZXksIGRlciBpblxyXG4gIC8vIEJFSURFTiBCbFx1MDBGNmNrZW4gc3RlaHQsIGJlaFx1MDBFNGx0IGRpZSBQb3NpdGlvbiBkZXMgVFlQLUZyb250bWF0dGVyczsgV2VydCxcclxuICAvLyBGbG9hdGluZy1NYXJraWVydW5nIFVORCBTaG9ydGN1dCBrb21tZW4gZGFubiB2b20gU3VidHlwIC0gYXVjaCBcImtlaW5cclxuICAvLyBTaG9ydGN1dFwiIGdpbHQgZGFiZWkgYWxzIEFuZ2FiZSBkZXMgU3VidHlwcyB1bmQgaGVidCBkZW4gZGVzIFRZUHMgYXVmLlxyXG4gIGNvbGxlY3RCbG9ja3ModHlwZSwgc3VidHlwZSwgaW5jbHVkZUZsb2F0aW5nKSB7XHJcbiAgICBjb25zdCBkZWZhdWx0cyA9IHt9O1xyXG4gICAgY29uc3Qgc2hvcnRjdXRzID0ge307XHJcbiAgICBjb25zdCBpc0Zsb2F0aW5nID0gbmV3IE1hcCgpO1xyXG4gICAgY29uc3QgYWRkQmxvY2sgPSAoZnJvbnRtYXR0ZXIsIGZsb2F0aW5nS2V5cywgYmxvY2tTaG9ydGN1dHMpID0+IHtcclxuICAgICAgY29uc3QgYWN0dWFsS2V5cyA9IG5ldyBNYXAoT2JqZWN0LmtleXMoZGVmYXVsdHMpLm1hcCgoa2V5KSA9PiBba2V5LnRvTG93ZXJDYXNlKCksIGtleV0pKTtcclxuICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoZnJvbnRtYXR0ZXIgPz8ge30pKSB7XHJcbiAgICAgICAgaWYgKGtleSA9PT0gXCJcIikgY29udGludWU7XHJcbiAgICAgICAgY29uc3QgdGFyZ2V0ID0gYWN0dWFsS2V5cy5nZXQoa2V5LnRvTG93ZXJDYXNlKCkpID8/IGtleTtcclxuICAgICAgICBkZWZhdWx0c1t0YXJnZXRdID0gdmFsdWU7XHJcbiAgICAgICAgaXNGbG9hdGluZy5zZXQodGFyZ2V0LCAoZmxvYXRpbmdLZXlzID8/IFtdKS5pbmNsdWRlcyhrZXkpKTtcclxuICAgICAgICBjb25zdCByZWNvcmQgPSAoYmxvY2tTaG9ydGN1dHMgPz8ge30pW2tleV07XHJcbiAgICAgICAgaWYgKHJlY29yZCkgc2hvcnRjdXRzW3RhcmdldF0gPSByZWNvcmQ7XHJcbiAgICAgICAgZWxzZSBkZWxldGUgc2hvcnRjdXRzW3RhcmdldF07XHJcbiAgICAgIH1cclxuICAgIH07XHJcbiAgICBjb25zdCBzdWJ0eXBlRGF0YSA9IHN1YnR5cGUgPyBnZXRTdWJ0eXBlKHRoaXMuc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpIDogbnVsbDtcclxuICAgIGFkZEJsb2NrKFxyXG4gICAgICB0aGlzLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV0sXHJcbiAgICAgIHRoaXMuc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXSxcclxuICAgICAgdGhpcy5zZXR0aW5ncy50eXBlU2hvcnRjdXRzW3R5cGVdXHJcbiAgICApO1xyXG4gICAgaWYgKHN1YnR5cGVEYXRhKSBhZGRCbG9jayhzdWJ0eXBlRGF0YS5mcm9udG1hdHRlciwgc3VidHlwZURhdGEuZmxvYXRpbmdLZXlzLCBzdWJ0eXBlRGF0YS5zaG9ydGN1dHMpO1xyXG5cclxuICAgIGlmICghaW5jbHVkZUZsb2F0aW5nKSB7XHJcbiAgICAgIGZvciAoY29uc3QgW2tleSwgZmxvYXRpbmddIG9mIGlzRmxvYXRpbmcpIHtcclxuICAgICAgICBpZiAoIWZsb2F0aW5nKSBjb250aW51ZTtcclxuICAgICAgICBkZWxldGUgZGVmYXVsdHNba2V5XTtcclxuICAgICAgICBkZWxldGUgc2hvcnRjdXRzW2tleV07XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiB7IGRlZmF1bHRzLCBzaG9ydGN1dHMgfTtcclxuICB9XHJcblxyXG4gIC8vIEZcdTAwRkNyIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanM6IGRpZSBQcm9wZXJ0aWVzIGRpZXNlcyBUWVBzLCBkZXJlblxyXG4gIC8vIFdlcnQgYmVpbSBBbmxlZ2VuIGVpbmVyIE5vdGl6IHZvbiBlaW5lbSBUZW1wbGF0ZXItU2tyaXB0IGtvbW10IC1cclxuICAvLyB7IFtQcm9wZXJ0eV06IHsgbmFtZSwgYXJncywgZmFsbGJhY2sgfSB9LCBpbiBkZXIgUmVpaGVuZm9sZ2UgZGVzXHJcbiAgLy8gVFlQLUZyb250bWF0dGVycyAoZGllIFNrcmlwdGUgbGF1ZmVuIG5hY2hlaW5hbmRlciB1bmQgc2VoZW4gZGllIEVyZ2Vibmlzc2VcclxuICAvLyBkZXIgamV3ZWlscyBmclx1MDBGQ2hlcmVuKS5cclxuICAvL1xyXG4gIC8vICAgbmFtZSAgICAgU2tyaXB0bmFtZSwgYWxzbyB0cC51c2VyLjxuYW1lPiAtIG9obmUgXCJ0cC5cIi1Qclx1MDBFNGZpeFxyXG4gIC8vICAgcGFyYW1zICAgZGllIGltIEB0eXAtc2hvcnRjdXQtTWFya2VyIGRla2xhcmllcnRlIFBhcmFtZXRlcmxpc3RlIGRlc1xyXG4gIC8vICAgICAgICAgICAgU2tyaXB0cyAoc2llaGUgc2hvcnRjdXQtc2NyaXB0cy5qcyksIG9kZXIgbnVsbCBiZWkgZWluZW0gTWFya2VyXHJcbiAgLy8gICAgICAgICAgICBvaG5lIEtsYW1tZXJuLiBTaWUgc3RhbW10IGF1cyBkZW0gYWt0dWVsbGVuIFNjYW4sIG5pY2h0IGF1cyBkZW1cclxuICAvLyAgICAgICAgICAgIGdlc3BlaWNoZXJ0ZW4gUmVjb3JkIC0gZWluZSBnZVx1MDBFNG5kZXJ0ZSBEZWtsYXJhdGlvbiB3aXJrdCBhbHNvXHJcbiAgLy8gICAgICAgICAgICBzb2ZvcnQuIFRZUC5qcyBtYWNodCBkYXJhdXMgbWl0IHJlc29sdmVTaG9ydGN1dEFyZ3MoKSB1bnRlbiBkaWVcclxuICAvLyAgICAgICAgICAgIEFyZ3VtZW50bGlzdGUgZGVzIEF1ZnJ1ZnNcclxuICAvLyAgIGFyZ3MgICAgIGRpZSBlaW5nZXRpcHB0ZW4gQXJndW1lbnRlLCBiZW5hbm50IG5hY2ggZGVuIG5pY2h0IHJlc2VydmllcnRlblxyXG4gIC8vICAgICAgICAgICAgUGFyYW1ldGVybi4gTGVlcmVzIE9iamVrdCwgd2VubiBrZWluZSBnZXNldHp0IHNpbmQ7IGVpbiBsZWVyXHJcbiAgLy8gICAgICAgICAgICBnZWxhc3NlbmVzIEZlbGQgZmVobHQgZGFyaW4gZ2FueiwgZGFtaXQgXCJhcmdzLnggPz8gZmFsbGJhY2tcIlxyXG4gIC8vICAgICAgICAgICAgaW0gU2tyaXB0IHRyXHUwMEU0Z3RcclxuICAvLyAgIGZhbGxiYWNrIGRlciBpbiBkZXIgVFlQLUFuc2ljaHQgaGludGVybGVndGUgZmVzdGUgV2VydCBkZXIgUHJvcGVydHkuIE51clxyXG4gIC8vICAgICAgICAgICAgYWxzIFJcdTAwRENDS0ZBTEwgZ2VkYWNodDogc2NobFx1MDBFNGd0IGRhcyBTa3JpcHQgZmVobCAoZmVobHQgb2RlclxyXG4gIC8vICAgICAgICAgICAgd2lyZnQpLCBzY2hyZWlidCBUWVAuanMgaWhuIHN0YXR0IGVpbmVzIGxlZXJlbiBXZXJ0cy4gRWluXHJcbiAgLy8gICAgICAgICAgICBTa3JpcHQsIGRhcyBiZXd1c3N0IG51bGwvXCJcIiBsaWVmZXJ0ICh6LiBCLiBFU0MgaW0gUGlja2VyKSwgaXN0XHJcbiAgLy8gICAgICAgICAgICBrZWluIEZlaGxzY2hsYWcgLSBkb3J0IGJsZWlidCBkaWUgUHJvcGVydHkgbGVlci5cclxuICAvL1xyXG4gIC8vIERpZSBmZXN0ZW4gU2hvcnRjdXRzICh0b2RheS9ub3cvY3JlYXRlZCkgdGF1Y2hlbiBoaWVyIE5JQ0hUIGF1ZjogZGllIGxcdTAwRjZzdFxyXG4gIC8vIGRhcyBQbHVnaW4gc2VsYnN0IGF1ZiB1bmQgbGllZmVydCBzaWUgZmVydGlnIFx1MDBGQ2JlciBnZXRUeXBlRGVmYXVsdHMoKS4gRGVzc2VuXHJcbiAgLy8gUlx1MDBGQ2NrZ2FiZSBmXHUwMEZDaHJ0IGRpZSBTa3JpcHQtS2V5cyBtaXQgZGVtIFdlcnQgbnVsbCAtIEtleSB1bmQgUG9zaXRpb24gYmxlaWJlblxyXG4gIC8vIGFsc28gZXJoYWx0ZW4sIG51ciBkZXIgV2VydCBrb21tdCB2b24gaGllci5cclxuICAvL1xyXG4gIC8vIE9wdGlvbmVuIHdpZSBiZWkgZ2V0VHlwZURlZmF1bHRzKCk7IGluY2x1ZGVGbG9hdGluZyBzdGFuZGFyZG1cdTAwRTRcdTAwREZpZyBmYWxzZSxcclxuICAvLyBkYW1pdCBmXHUwMEZDciBlaW5lIEZsb2F0aW5nIFByb3BlcnR5IG5pY2h0IHVuZ2VmcmFndCBlaW4gU2tyaXB0IGxcdTAwRTR1ZnQuXHJcbiAgZ2V0VHlwZVNob3J0Y3V0cyh0eXBlLCB7IGluY2x1ZGVGbG9hdGluZyA9IGZhbHNlLCBzdWJ0eXBlID0gbnVsbCB9ID0ge30pIHtcclxuICAgIGNvbnN0IHsgZGVmYXVsdHMsIHNob3J0Y3V0cyB9ID0gdGhpcy5jb2xsZWN0QmxvY2tzKHR5cGUsIHN1YnR5cGUsIGluY2x1ZGVGbG9hdGluZyk7XHJcbiAgICBjb25zdCBza3JpcHRlID0gdGhpcy5nZXRTaG9ydGN1dFNjcmlwdHM/LigpID8/IFtdO1xyXG4gICAgY29uc3QgcmVzdWx0ID0ge307XHJcbiAgICBmb3IgKGNvbnN0IFtrZXksIHJlY29yZF0gb2YgT2JqZWN0LmVudHJpZXMoc2hvcnRjdXRzKSkge1xyXG4gICAgICBjb25zdCBuYW1lID0gc2NyaXB0TmFtZU9mKHJlY29yZC5uYW1lKTtcclxuICAgICAgaWYgKG5hbWUgPT09IG51bGwpIGNvbnRpbnVlO1xyXG4gICAgICBjb25zdCBza3JpcHQgPSBza3JpcHRlLmZpbmQoKHMpID0+IHMubmFtZSA9PT0gbmFtZSk7XHJcbiAgICAgIHJlc3VsdFtrZXldID0ge1xyXG4gICAgICAgIG5hbWUsXHJcbiAgICAgICAgcGFyYW1zOiBza3JpcHQ/LnBhcmFtcyA/PyBudWxsLFxyXG4gICAgICAgIGFyZ3M6IHsgLi4uKHJlY29yZC5hcmdzID8/IHt9KSB9LFxyXG4gICAgICAgIGZhbGxiYWNrOiBkZWZhdWx0c1trZXldID8/IG51bGwsXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG4gIH1cclxuXHJcbiAgLy8gRlx1MDBGQ3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qczogbWFjaHQgYXVzIGRlciBQYXJhbWV0ZXJsaXN0ZSBlaW5lc1xyXG4gIC8vIFNob3J0Y3V0cyBkaWUgQXJndW1lbnRlIGZcdTAwRkNyIGRlbiBBdWZydWYgdHAudXNlci48bmFtZT4odHAsIC4uLikgLSBzaWVoZVxyXG4gIC8vIHJlc29sdmVDYWxsQXJncyBpbiBzaG9ydGN1dHMuanMuIERpZSBBdWZsXHUwMEY2c3VuZyBsZWJ0IGhpZXIgc3RhdHQgaW4gVFlQLmpzLFxyXG4gIC8vIGRhbWl0IGRpZSBSZWdlbG4gKHJlc2VydmllcnRlIE5hbWVuLCBQdW5rdC1OYW1lbiBmXHUwMEZDciBPYmpla3QtQXJndW1lbnRlKSBudXJcclxuICAvLyBhbiBlaW5lciBTdGVsbGUgc3RlaGVuOyBuZXdGaWxlIHVuZCBjdHgga2VubnQgYWxsZXJkaW5ncyBudXIgVFlQLmpzIHVuZFxyXG4gIC8vIHJlaWNodCBzaWUgZGVzaGFsYiBoZXJlaW4uXHJcbiAgcmVzb2x2ZVNob3J0Y3V0QXJncyhwYXJhbXMsIGFyZ3MsIHsgbmV3RmlsZSA9IG51bGwsIGN0eCA9IG51bGwsIGtleSA9IG51bGwgfSA9IHt9KSB7XHJcbiAgICByZXR1cm4gcmVzb2x2ZUNhbGxBcmdzKHBhcmFtcywgYXJncywgeyBuZXdGaWxlLCBjdHgsIGtleSB9KTtcclxuICB9XHJcblxyXG4gIC8vIEZcdTAwRkNyIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanM6IHJlZ2lzdHJpZXJ0ZSBTdWJ0eXBlbiBlaW5lcyBUWVBzIGluXHJcbiAgLy8gZGVyIFJlaWhlbmZvbGdlIGlocmVyIEJsXHUwMEY2Y2tlLCBzYW10IE5vdGl6LUFuemFobC5cclxuICBnZXRTdWJ0eXBlcyh0eXBlKSB7XHJcbiAgICBjb25zdCB7IGNvdW50cyB9ID0gdGhpcy50eXBJbmRleC5zdWJ0eXBlQnVja2V0KHR5cGUpO1xyXG4gICAgcmV0dXJuIGdldFN1YnR5cGVOYW1lcyh0aGlzLnNldHRpbmdzLCB0eXBlKS5tYXAoKHN1YnR5cGUpID0+ICh7IHN1YnR5cGUsIGNvdW50OiBjb3VudHMuZ2V0KHN1YnR5cGUpID8/IDAgfSkpO1xyXG4gIH1cclxuXHJcbiAgLy8gRlx1MDBGQ3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qczogU3VidHlwLVBpY2tlciAoc2llaGVcclxuICAvLyB0eXBlLXBpY2tlci5qcykuIExcdTAwRjZzdCBtaXQgZGVtIGdld1x1MDBFNGhsdGVuIFN1YnR5cCBhdWYsIG1pdCBcIlwiIGZcdTAwRkNyIFwiS2VpblxyXG4gIC8vIFN1YnR5cFwiIChiencuIG9obmUgUGlja2VyLCB3ZW5uIGRlciBUWVAga2VpbmUgU3VidHlwZW4gaGF0KSwgb2RlciBtaXRcclxuICAvLyBudWxsIGJlaSBFU0MgKFRZUC5qcyBrZWhydCBkYW5uIHp1ciBUWVAtQXVzd2FobCB6dXJcdTAwRkNjaykuIHF1ZXJ5IChvcHRpb25hbCk6XHJcbiAgLy8gZWluZSBzY2hvbiBnZXRpcHB0ZSBTdWNoYW5mcmFnZSwgbmFjaCBkZXIgZGllIExpc3RlIHZvcnNvcnRpZXJ0IHN0ZWh0LlxyXG4gIHBpY2tTdWJ0eXBlKHR5cGUsIHF1ZXJ5ID0gXCJcIikge1xyXG4gICAgcmV0dXJuIHBpY2tTdWJ0eXBlTW9kYWwodGhpcy5hcHAsIHRoaXMsIHR5cGUsIHF1ZXJ5KTtcclxuICB9XHJcblxyXG4gIC8vIEZcdTAwRkNyIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanMsIGlubmVyaGFsYiB2b24gcHJvY2Vzc0Zyb250TWF0dGVyOlxyXG4gIC8vIHNldHp0IFRZUCB1bmQgU1VCVFlQIGluIGVpbmhlaXRsaWNoZXIgU2NocmVpYndlaXNlIC0gZWluZSBhYndlaWNoZW5kXHJcbiAgLy8gZ2VzY2hyaWViZW5lIFByb3BlcnR5IChcInR5cFwiLCBcIlN1YnR5cFwiKSB3aXJkIGFuIGlocmVyIFN0ZWxsZSB1bWJlbmFubnRcclxuICAvLyBzdGF0dCB2ZXJkb3BwZWx0LiBzdWJ0eXBlIG51bGwgZW50ZmVybnQgZWluZW4gdm9yaGFuZGVuZW4gU1VCVFlQLlxyXG4gIGFwcGx5VHlwZVByb3BlcnRpZXMoZnJvbnRtYXR0ZXIsIHR5cGUsIHN1YnR5cGUpIHtcclxuICAgIHNldENhbm9uaWNhbFByb3BlcnR5KGZyb250bWF0dGVyLCBUWVBfUFJPUEVSVFksIHR5cGUpO1xyXG4gICAgaWYgKHN1YnR5cGUpIHNldENhbm9uaWNhbFByb3BlcnR5KGZyb250bWF0dGVyLCBTVUJUWVBfUFJPUEVSVFksIHN1YnR5cGUpO1xyXG4gICAgZWxzZSBkZWxldGVQcm9wZXJ0eShmcm9udG1hdHRlciwgU1VCVFlQX1BST1BFUlRZKTtcclxuICB9XHJcblxyXG4gIC8vIEZcdTAwRkNyIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanMsIGlubmVyaGFsYiB2b24gcHJvY2Vzc0Zyb250TWF0dGVyXHJcbiAgLy8gdW5kIG5hY2ggYWxsZW4gXHUwMEZDYnJpZ2VuIFx1MDBDNG5kZXJ1bmdlbjogYnJpbmd0IGRhcyBGcm9udG1hdHRlciBpbiBkaWVcclxuICAvLyBSZWloZW5mb2xnZSBkZXIgRnJvbnRtYXR0ZXItU29ydGllcnVuZyAoZ2xvYmFsZSBSZWloZW5mb2xnZSwgVFlQLVxyXG4gIC8vIEZyb250bWF0dGVyIHNhbXQgU3VidHlwLUJsb2NrKSAtIHNvbnN0IGxhbmRlbiBuZXUgZXJnXHUwMEU0bnp0ZSBQcm9wZXJ0aWVzXHJcbiAgLy8gKHouIEIuIFNVQlRZUCBpbiBlaW5lciBiZXN0ZWhlbmRlbiBOb3RpeikgYW0gRW5kZS5cclxuICBzb3J0RnJvbnRtYXR0ZXIoZnJvbnRtYXR0ZXIsIHR5cGUsIHN1YnR5cGUgPSBudWxsKSB7XHJcbiAgICByZXR1cm4gc29ydEZyb250bWF0dGVyRm9yKHRoaXMsIGZyb250bWF0dGVyLCB0eXBlLCBzdWJ0eXBlKTtcclxuICB9XHJcblxyXG4gIC8vIElubmVyaGFsYiB2b24gcHJvY2Vzc0Zyb250TWF0dGVyOiBzZXR6dCBudXIgZGllIFByb3BlcnR5IGtleSBhbiBpaHJlblxyXG4gIC8vIFBsYXR6IGxhdXQgRnJvbnRtYXR0ZXItU29ydGllcnVuZyAoVFlQL1NVQlRZUCBhdXMgZGVtIE9iamVrdCBzZWxic3QpLFxyXG4gIC8vIGFsbGVzIFx1MDBEQ2JyaWdlIGJsZWlidCwgd2llIGVzIGlzdCAtIHouIEIuIGZcdTAwRkNyIEZyZWRzIFByb3BlcnR5LUJhY2tsaW5raW5nLFxyXG4gIC8vIGRhbWl0IGVpbmUgbmV1IGFuZ2VsZWd0ZSBQcm9wZXJ0eSBuaWNodCBhbSBFbmRlIGxhbmRldC5cclxuICBwbGFjZVByb3BlcnR5KGZyb250bWF0dGVyLCBrZXkpIHtcclxuICAgIHJldHVybiBwbGFjZVByb3BlcnR5Rm9yKHRoaXMsIGZyb250bWF0dGVyLCBrZXkpO1xyXG4gIH1cclxuXHJcbiAgLy8gRlx1MDBGQ3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qczogZGllIGltIFRZUC1WaWV3IHJlZ2lzdHJpZXJ0ZW4gVFlQZW5cclxuICAvLyBzYW10IGlocmVyIGRvcnQgZ2VwZmxlZ3RlbiBCZXNjaHJlaWJ1bmcsIHN0YXR0IHNpZSBhdXMgX29ic2lkaWFuL1R5cGVuLm1kIHp1IHBhcnNlbiAtXHJcbiAgLy8gaW4gZGVyc2VsYmVuIFJlaWhlbmZvbGdlLCBpbiBkZXIgc2llIGF1Y2ggaW4gZGVyIFRZUC1MaXN0ZSBzZWxic3QgZXJzY2hlaW5lblxyXG4gIC8vIChha3R1ZWxsZSBTb3J0aWVyZWluc3RlbGx1bmcgZG9ydCwgei4gQi4gSFx1MDBFNHVmaWdrZWl0IG9kZXIgTmFtZSkuXHJcbiAgLy9cclxuICAvLyBUWVBlbiBtaXQgYWJnZXNjaGFsdGV0ZW0gXCJNYW51ZWxsIGVyc3RlbGxiYXJcIiAoSWNvbiBpbiBkZXIgVFlQLURldGFpbGFuc2ljaHQpXHJcbiAgLy8gc2luZCBuaWNodCBmXHUwMEZDciBkaWUgbWFudWVsbGUgQXVzd2FobCBnZWRhY2h0ICh6LiBCLiBiZWltIEFubGVnZW4gZWluZXIgbmV1ZW5cclxuICAvLyBOb3RpeikgdW5kIHdlcmRlbiBkZXNoYWxiIHN0YW5kYXJkbVx1MDBFNFx1MDBERmlnIGF1c2dla2xhbW1lcnQgLSBBdWZydWZlciwgZGllXHJcbiAgLy8gdHJvdHpkZW0gYWxsZSBUWVBlbiBicmF1Y2hlbiwgXHUwMEZDYmVyZ2ViZW4gaW5jbHVkZU1hbnVhbE9mZjogdHJ1ZS5cclxuICBnZXRUeXBlcyh7IGluY2x1ZGVNYW51YWxPZmYgPSBmYWxzZSB9ID0ge30pIHtcclxuICAgIGNvbnN0IHsgY291bnRzIH0gPSB0aGlzLnR5cEluZGV4LnR5cGVDb3VudHMoKTtcclxuICAgIGNvbnN0IHNvcnRPcmRlciA9IHRoaXMuc2V0dGluZ3MudHlwU29ydE9yZGVyID8/IERFRkFVTFRfU09SVF9PUkRFUjtcclxuICAgIHJldHVybiBzb3J0VHlwZXNCeU1vZGUodGhpcy5zZXR0aW5ncy50eXBlcywgc29ydE9yZGVyLCBjb3VudHMsIHRoaXMuc2V0dGluZ3MudHlwZUNvbG9ycylcclxuICAgICAgLmZpbHRlcigodHlwZSkgPT4gaW5jbHVkZU1hbnVhbE9mZiB8fCAodGhpcy5zZXR0aW5ncy50eXBlTWFudWFsID8/IHt9KVt0eXBlXSAhPT0gZmFsc2UpXHJcbiAgICAgIC5tYXAoKHR5cGUpID0+ICh7XHJcbiAgICAgICAgdHlwZSxcclxuICAgICAgICBkZXNjcmlwdGlvbjogdGhpcy5zZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3R5cGVdID8/IFwiXCIsXHJcbiAgICAgICAgY291bnQ6IGNvdW50cy5nZXQodHlwZSkgPz8gMCxcclxuICAgICAgfSkpO1xyXG4gIH1cclxuXHJcbiAgLy8gRlx1MDBGQ3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qczogbmF0aXZlciBUWVAtUGlja2VyIChzaWVoZVxyXG4gIC8vIHR5cGUtcGlja2VyLmpzKSBzdGF0dCBkZXIgcmVpbmVuIFRleHQtTGlzdGUgYXVzIGdldFR5cGVzKCkgK1xyXG4gIC8vIHRwLnN5c3RlbS5zdWdnZXN0ZXIgLSBtaXQgVFlQLUZhcmJlLy1QdW5rdCwgQmVzY2hyZWlidW5nIHVuZCBOb3Rpei1BbnphaGxcclxuICAvLyBqZSBaZWlsZS4gaW5jbHVkZU1hbnVhbE9mZiB3aWUgYmVpIGdldFR5cGVzKCkuIExcdTAwRjZzdCBtaXQgZGVtIGdld1x1MDBFNGhsdGVuIFRZUFxyXG4gIC8vIGF1Ziwgb2RlciBtaXQgbnVsbCBiZWkgQWJicnVjaCAoRVNDKS5cclxuICBwaWNrVHlwZShvcHRpb25zKSB7XHJcbiAgICByZXR1cm4gcGlja1R5cGVNb2RhbCh0aGlzLmFwcCwgdGhpcywgb3B0aW9ucyk7XHJcbiAgfVxyXG5cclxuICAvLyBGXHUwMEZDciBfb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzOiBUWVAgdW5kIFN1YnR5cCBpbiBlaW5lbSBadWcgKHNpZWhlXHJcbiAgLy8gdHlwZS1waWNrZXIuanMpIC0gamUgbmFjaCBFaW5zdGVsbHVuZyBcIlN1YnR5cC1QaWNrZXIgc2VwYXJhdFwiIGVpbiBlaW56aWdlclxyXG4gIC8vIFBpY2tlciBtaXQgZWluZ2VyXHUwMEZDY2t0ZW4gU3VidHlwZW4gb2RlciBiZWlkZSBQaWNrZXIgbmFjaGVpbmFuZGVyLiBPcHRpb25lblxyXG4gIC8vIHdpZSBiZWkgcGlja1R5cGUoKS4gTFx1MDBGNnN0IG1pdCB7IHR5cGUsIHN1YnR5cGUgfSBhdWYgKHN1YnR5cGUgbnVsbCBmXHUwMEZDciBcIm9obmVcclxuICAvLyBTdWJ0eXBcIiksIG9kZXIgbWl0IG51bGwgYmVpIEFiYnJ1Y2ggKEVTQykuXHJcbiAgcGlja1R5cGVBbmRTdWJ0eXBlKG9wdGlvbnMpIHtcclxuICAgIHJldHVybiBwaWNrVHlwZUFuZFN1YnR5cGVNb2RhbCh0aGlzLmFwcCwgdGhpcywgb3B0aW9ucyk7XHJcbiAgfVxyXG5cclxuICBhc3luYyBsb2FkU2V0dGluZ3MoKSB7XHJcbiAgICBjb25zdCBzdG9yZWQgPSBhd2FpdCB0aGlzLmxvYWREYXRhKCk7XHJcbiAgICB0aGlzLnNldHRpbmdzID0gT2JqZWN0LmFzc2lnbih7fSwgREVGQVVMVF9TRVRUSU5HUywgc3RvcmVkKTtcclxuICAgIC8vIE9iamVjdC5hc3NpZ24gZXJzZXR6dCB2ZXJzY2hhY2h0ZWx0ZSBPYmpla3RlIGFscyBHYW56ZXMgLSBzcFx1MDBFNHRlclxyXG4gICAgLy8gaGluenVnZWtvbW1lbmUgQW5zaWNodGVuICh6LiBCLiBjb2xvclZpZXdzLmxpbmtzKSBmZWhsdGVuIGluIGJlcmVpdHNcclxuICAgIC8vIGdlc3BlaWNoZXJ0ZW4gRWluc3RlbGx1bmdlbiBzb25zdCB1bmQgd1x1MDBFNHJlbiBzdGlsbHNjaHdlaWdlbmQgYXVzLlxyXG4gICAgdGhpcy5zZXR0aW5ncy5jb2xvclZpZXdzID0geyAuLi5ERUZBVUxUX1NFVFRJTkdTLmNvbG9yVmlld3MsIC4uLnRoaXMuc2V0dGluZ3MuY29sb3JWaWV3cyB9O1xyXG4gICAgLy8gTWlncmllcnQgQmVzdGFuZHNpbnN0YWxsYXRpb25lbiwgZGVyZW4gZ2xvYmFsUHJvcGVydHlPcmRlciBub2NoIGF1cyBkZXJcclxuICAgIC8vIFplaXQgdm9yIFwiVFlQIGFscyBMaXN0ZW5laW50cmFnXCIgc3RhbW10IChzaWVoZSBmcm9udG1hdHRlci1zb3J0LmpzKS5cclxuICAgIHRoaXMuc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlciA9IG5vcm1hbGl6ZUdsb2JhbE9yZGVyKHRoaXMuc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcik7XHJcbiAgICBtaWdyYXRlRmxvYXRpbmdGcm9udG1hdHRlcih0aGlzLnNldHRpbmdzKTtcclxuICAgIC8vIFN1YnR5cC1CbFx1MDBGNmNrZSBsYWdlbiBmclx1MDBGQ2hlciB3YWhsd2Vpc2UgXHUwMEZDYmVyIGRlbSBUWVAtRnJvbnRtYXR0ZXI7IGRhcyBzdGVodFxyXG4gICAgLy8gamV0enQgZmVzdCBnYW56IG9iZW4gKHNpZWhlIGdldFNlY3Rpb25PcmRlciBpbiBzdWJ0eXBlcy5qcykuXHJcbiAgICBtaWdyYXRlQWJvdmVTdGFuZGFyZCh0aGlzLnNldHRpbmdzKTtcclxuICAgIC8vIEFuZGVycyBhbHMgZGllIFx1MDBGQ2JyaWdlbiBNaWdyYXRpb25lbiBnbGVpY2ggc2NocmVpYmVuOiBkaWUgZWluZSByZWNobmV0XHJcbiAgICAvLyBnZXNwZWljaGVydGUgWmFobGVuIHVtIHVuZCBkYXJmIGRhcyBiZWltIG5cdTAwRTRjaHN0ZW4gU3RhcnQgbmljaHQgZXJuZXV0IHR1bixcclxuICAgIC8vIGRpZSBhbmRlcmUgZW50ZmVybnQgZWluZW4gU2NobFx1MDBGQ3NzZWwsIGRlciBzb25zdCBiZWkgamVkZW0gU3RhcnQgd2llZGVyXHJcbiAgICAvLyBnZWxlc2VuIHdcdTAwRkNyZGUuXHJcbiAgICBjb25zdCBtaWdyYXRlZCA9IFttaWdyYXRlU3VidHlwZUNvbG9yU2NhbGUodGhpcy5zZXR0aW5ncywgREVGQVVMVF9TVUJUWVBFX0NPTE9SX1JBTkdFUyksIG1pZ3JhdGVUeXBMaXN0U2Vjb25kYXJ5KHRoaXMuc2V0dGluZ3MsIHN0b3JlZCksIGRyb3BUeXBMaXN0U3VidHlwZXNBbGlnbih0aGlzLnNldHRpbmdzKV07XHJcbiAgICBpZiAobWlncmF0ZWQuc29tZShCb29sZWFuKSkgYXdhaXQgdGhpcy5zYXZlU2V0dGluZ3MoKTtcclxuICB9XHJcblxyXG4gIGFzeW5jIHNhdmVTZXR0aW5ncygpIHtcclxuICAgIGF3YWl0IHRoaXMuc2F2ZURhdGEodGhpcy5zZXR0aW5ncyk7XHJcbiAgfVxyXG59O1xyXG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7QUFBQTtBQUFBLHFCQUFBQSxVQUFBQyxTQUFBO0FBQUEsUUFBTSxFQUFFLFFBQVEsT0FBTyxTQUFTLElBQUksUUFBUSxVQUFVO0FBRXRELFFBQU1DLGdCQUFlO0FBQ3JCLFFBQU1DLG1CQUFrQjtBQUN4QixRQUFNLGNBQWMsT0FBTyxPQUFPLEVBQUUsU0FBUyxNQUFNLFNBQVMsTUFBTSxZQUFZLE1BQU0sWUFBWSxLQUFLLENBQUM7QUFLdEcsUUFBTSxpQkFB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QUFBQSxNQUNyRCxPQUFPLE9BQU8sSUFBSSxJQUFJLEtBQUs7QUFBQSxJQUM3QixFQUFFO0FBQUEsRUFDTjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQU9BLFNBQVMsU0FBUztBQUNoQixXQUFPLGNBQWMsS0FBSyxLQUFLLE1BQU0sT0FBTztBQUFBLEVBQzlDO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBT0EsbUJBQW1CLFNBQVM7QUFDMUIsV0FBTyx3QkFBd0IsS0FBSyxLQUFLLE1BQU0sT0FBTztBQUFBLEVBQ3hEO0FBQUEsRUFFQSxNQUFNLGVBQWU7QUFDbkIsVUFBTSxTQUFTLE1BQU0sS0FBSyxTQUFTO0FBQ25DLFNBQUssV0FBVyxPQUFPLE9BQU8sQ0FBQyxHQUFHLGtCQUFrQixNQUFNO0FBSTFELFNBQUssU0FBUyxhQUFhLEVBQUUsR0FBRyxpQkFBaUIsWUFBWSxHQUFHLEtBQUssU0FBUyxXQUFXO0FBR3pGLFNBQUssU0FBUyxzQkFBc0IscUJBQXFCLEtBQUssU0FBUyxtQkFBbUI7QUFDMUYsK0JBQTJCLEtBQUssUUFBUTtBQUd4Qyx5QkFBcUIsS0FBSyxRQUFRO0FBS2xDLFVBQU0sV0FBVyxDQUFDLHlCQUF5QixLQUFLLFVBQVUsNEJBQTRCLEdBQUcsd0JBQXdCLEtBQUssVUFBVSxNQUFNLEdBQUcseUJBQXlCLEtBQUssUUFBUSxDQUFDO0FBQ2hMLFFBQUksU0FBUyxLQUFLLE9BQU8sRUFBRyxPQUFNLEtBQUssYUFBYTtBQUFBLEVBQ3REO0FBQUEsRUFFQSxNQUFNLGVBQWU7QUFDbkIsVUFBTSxLQUFLLFNBQVMsS0FBSyxRQUFRO0FBQUEsRUFDbkM7QUFDRjsiLAogICJuYW1lcyI6IFsiZXhwb3J0cyIsICJtb2R1bGUiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJzZXRDYW5vbmljYWxQcm9wZXJ0eSIsICJkZWxldGVQcm9wZXJ0eSIsICJUeXBJbmRleCIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJzZXRDYW5vbmljYWxQcm9wZXJ0eSIsICJTVUJUWVBfUFJPUEVSVFkiLCAiZ2V0U3VidHlwZU5hbWVzIiwgImdldFN1YnR5cGUiLCAibWlncmF0ZUFib3ZlU3RhbmRhcmQiLCAibWlncmF0ZVN1YnR5cGVDb2xvclNjYWxlIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImdldFN1YnR5cGUiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJub3JtYWxpemVHbG9iYWxPcmRlciIsICJzb3J0RnJvbnRtYXR0ZXJGb3IiLCAicGxhY2VQcm9wZXJ0eUZvciIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJUWVBfUFJPUEVSVFkiLCAiU1VCVFlQX1BST1BFUlRZIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImdldFN1YnR5cGUiLCAiREVGQVVMVF9TVUJUWVBFX0NPTE9SX1JBTkdFUyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJERUZBVUxUX1NVQlRZUEVfQ09MT1JfUkFOR0VTIiwgIkRFRkFVTFRfU0VUVElOR1MiLCAiVHlwU3lzdGVtU2V0dGluZ1RhYiIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlckNvbW1hbmRzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInNjcmlwdE5hbWVPZiIsICJyZXNvbHZlQ2FsbEFyZ3MiLCAicmVzb2x2ZVNob3J0Y3V0cyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXBlIiwgIlRZUF9QUk9QRVJUWSIsICJTVUJUWVBfUFJPUEVSVFkiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAic29ydFR5cGVzQnlNb2RlIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImdldFN1YnR5cGVOYW1lcyIsICJnZXRTdWJ0eXBlIiwgInNvcnRUeXBlc0J5TW9kZSIsICJzZXRDYW5vbmljYWxQcm9wZXJ0eSIsICJUWVBfUFJPUEVSVFkiLCAiU1VCVFlQX1BST1BFUlRZIiwgIkRFRkFVTFRfU09SVF9PUkRFUiIsICJyZWdpc3RlclR5cFZpZXciLCAibGVhZiIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlckZpbGVFeHBsb3JlckNvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlckdyYXBoQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyU2VhcmNoQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyUmVjZW50RmlsZXNDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJCYWNrbGlua0NvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlckJvb2ttYXJrc0NvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXBlIiwgInJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJMaW5rQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImdldFN1YnR5cGVOYW1lcyIsICJnZXRTdWJ0eXBlIiwgIlRZUF9QUk9QRVJUWSIsICJmbG9hdGluZyIsICJyZWdpc3RlckZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodCIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXBlTmFtZXMiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJyZWdpc3RlclByb3BlcnR5UmVuYW1lU3luYyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJERUZBVUxUX1NPUlRfT1JERVIiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJTaG9ydGN1dFNjcmlwdHMiXQp9Cg==
