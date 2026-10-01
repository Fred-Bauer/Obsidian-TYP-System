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
      if (!byName[subtype]) {
        byName[subtype] = { frontmatter: {}, floatingKeys: [], shortcuts: {} };
        if (settings.typeManual?.[type] === false) byName[subtype].manual = false;
      }
      return byName[subtype];
    }
    function isSubtypeManual2(settings, type, subtype) {
      return getSubtype2(settings, type, subtype)?.manual !== false;
    }
    function setSubtypeManual(settings, type, subtype, on) {
      const data = getSubtype2(settings, type, subtype);
      if (!data) return;
      if (on) delete data.manual;
      else data.manual = false;
    }
    function setAllSubtypesManual(settings, type, on) {
      for (const subtype of getSubtypeNames2(settings, type)) setSubtypeManual(settings, type, subtype, on);
    }
    function migrateSubtypeManual2(settings) {
      let changed = false;
      for (const [type, off] of Object.entries(settings.typeManual ?? {})) {
        if (off !== false) continue;
        for (const subtype of getSubtypeNames2(settings, type)) {
          if (!isSubtypeManual2(settings, type, subtype)) continue;
          setSubtypeManual(settings, type, subtype, false);
          changed = true;
        }
      }
      return changed;
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
      isSubtypeManual: isSubtypeManual2,
      setSubtypeManual,
      setAllSubtypesManual,
      migrateSubtypeManual: migrateSubtypeManual2,
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
      isSubtypeManual: isSubtypeManual2,
      setSubtypeManual,
      setAllSubtypesManual,
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
      // Gemeinsamer "Manuell erstellbar"-Knopf von TYP (renderManualToggle) und
      // Subtyp (renderSubtypeManualToggle), jeweils zwischen Umbenennen und
      // Löschen: ein Icon-Knopf statt eines beschrifteten Schalters - die
      // Einstellung ist zu klein, um mit Label und Toggle eine eigene Zeile zu
      // bekommen, und in der Reihe der übrigen Icon-Knöpfe fällt sie nicht mehr
      // auf als diese. Zustand wie bei ihnen über eine Klasse (is-active, siehe
      // styles.css), der Sinn steht im Tooltip - role/aria-checked halten ihn
      // trotzdem als Schalter lesbar.
      //
      // onToggle bekommt den neuen Zustand, speichert ihn und zieht die abhängigen
      // Knöpfe nach (siehe syncManualToggles) - das Anzeigen übernimmt bewusst
      // nicht der Klick selbst, da eine Umschaltung hier nie nur diesen einen
      // Knopf betrifft.
      renderManualIcon(parent, cls, isOn, onToggle) {
        const btn = parent.createDiv({
          cls: `clickable-icon fred-typ-manual-icon ${cls}`,
          attr: { tabindex: "0", role: "checkbox" }
        });
        setIcon(btn, "file-pen-line");
        btn.fredShowManualState = (on) => {
          btn.toggleClass("is-active", on);
          btn.setAttribute("aria-checked", String(on));
          btn.setAttribute("aria-label", on ? "Manuell erstellbar" : "Nicht manuell erstellbar");
        };
        btn.fredShowManualState(isOn);
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
      // "Manuell erstellbar" des TYPs, in der Kopfzeile der Detailansicht zwischen
      // Umbenennen und Löschen.
      //
      // Standardmäßig an - daher wird (wie bei den anderen typeXxx-Dicts) nur die
      // Abweichung vom Default gespeichert, hier also nur "aus" (false); fehlender
      // Eintrag bzw. true bedeuten "an". Steuert, ob ein TYP in getTypes() (siehe
      // main.js) exportiert wird, siehe dortiger Kommentar.
      //
      // Der TYP zieht seine Subtypen dabei immer mit: der Picker führt nur über
      // ihn zu ihnen, ein abgeschalteter TYP würde seine angeschalteten Subtypen
      // also stumm unerreichbar machen (siehe setAllSubtypesManual in subtypes.js).
      renderManualToggle(parent, type) {
        return this.renderManualIcon(parent, "fred-typ-manual-type", this.ensureTypeManual()[type] !== false, async (on) => {
          if (on) delete this.ensureTypeManual()[type];
          else this.ensureTypeManual()[type] = false;
          setAllSubtypesManual(this.plugin.settings, type, on);
          await this.plugin.saveSettings();
          this.syncManualToggles(type);
        });
      }
      // "Manuell erstellbar" eines Subtyps, in den Aktionen im Abschluss seines
      // Blocks zwischen Umbenennen und Löschen (siehe renderSectionFooter). Anders
      // als der TYP-Knopf zieht er nur in eine Richtung mit: ein angeschalteter Subtyp schaltet seinen TYP mit
      // an (sonst wäre er im Picker nicht zu erreichen), die übrigen Subtypen
      // bleiben aber, wie sie sind - genau dafür ist der Knopf da.
      renderSubtypeManualToggle(parent, type, subtype) {
        const btn = this.renderManualIcon(
          parent,
          "fred-typ-manual-subtype",
          isSubtypeManual2(this.plugin.settings, type, subtype),
          async (on) => {
            setSubtypeManual(this.plugin.settings, type, subtype, on);
            if (on) delete this.ensureTypeManual()[type];
            await this.plugin.saveSettings();
            this.syncManualToggles(type);
          }
        );
        btn.fredSubtype = subtype;
        return btn;
      }
      // Zeigt alle Manuell-Knöpfe der Detailansicht neu an, nachdem einer von ihnen
      // die anderen mitgezogen hat. Bewusst nur die Knöpfe statt eines render():
      // ein Neuaufbau nimmt die Frontmatter-Editoren aller Blöcke mit (siehe
      // destroyFrontmatterEditor), samt einer gerade bearbeiteten Zeile, obwohl
      // sich an ihnen nichts geändert hat. Gefunden werden die Knöpfe wie die
      // Farbpunkte der Subtyp-Blöcke über das DOM der Ansicht (siehe
      // openSubtypeColorPopover): den Abschluss eines Blocks baut
      // frontmatter-blocks.js auf, eine Liste davon liegt hier nicht.
      syncManualToggles(type) {
        this.contentEl.querySelector(".fred-typ-manual-type")?.fredShowManualState(this.ensureTypeManual()[type] !== false);
        for (const el of this.contentEl.querySelectorAll(".fred-typ-manual-subtype")) {
          el.fredShowManualState(isSubtypeManual2(this.plugin.settings, type, el.fredSubtype));
        }
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
        this.renderManualToggle(header, type);
        const deleteBtn = header.createDiv({ cls: "clickable-icon fred-typ-detail-delete", attr: { "aria-label": "L\xF6schen" } });
        setIcon(deleteBtn, "trash");
        deleteBtn.addEventListener("click", () => this.showDeleteConfirm(type));
        const body = contentEl.createDiv({ cls: "fred-typ-detail-body" });
        const optionsHeader = body.createDiv({ cls: "fred-typ-frontmatter-header fred-typ-options-header" });
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
      // die Regler öffnet, daneben Zurücksetzen), rechts dieselben Aktionen in
      // derselben Reihenfolge wie im Kopf der TYP-Detailansicht (Umbenennen inkl.
      // Notizen, Umbenennen, "manuell erstellbar", Löschen). Das TYP-Frontmatter
      // hat keinen Abschluss. Der Titel wird erst beim Klick gesucht - Überschrift und
      // Abschluss entstehen bei jedem synchronize() neu.
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
        this.renderSubtypeManualToggle(actions, type, subtype);
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
        const manualCls = "clickable-icon fred-typ-manual-icon" + (this.ensureTypeManual()[type] !== false ? " is-active" : "");
        setIcon(actions.createDiv({ cls: manualCls }), "file-pen-line");
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
      //
      // "Manuell erstellbar" ist der eine Fall, in dem das Zusammenlegen nicht nur
      // Daten umhängt: die übernommenen Subtypen bringen ihren eigenen Schalter
      // mit, der von source stammt, geraten aber unter den Schalter von target.
      // War source an und target aus, stünden sie danach als angeschaltete
      // Subtypen unter einem abgeschalteten TYP - im Picker unerreichbar, da er
      // nur über den TYP zu ihnen führt. Ein abgeschaltetes target zieht sie
      // deshalb mit ab, genau wie sein eigener Knopf es täte (siehe
      // renderManualToggle). Ist target an, bleiben sie, wie sie waren - ein
      // abgeschalteter Subtyp unter einem angeschalteten TYP ist der Normalfall,
      // und das ist, was bei source eingestellt war.
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
        if (this.ensureTypeManual()[target] === false) setAllSubtypesManual(settings, target, false);
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
    function pickSubtype(app, plugin, type, query = "", options = {}) {
      return new Promise((resolve) => {
        const items = plugin.getSubtypes(type, options).map(({ subtype, count }) => ({ type: subtype, description: "", count }));
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
        for (const item of items) item.subtypes = plugin.getSubtypes(item.type, { includeManualOff }).map(({ subtype }) => subtype);
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
          const subtype = await pickSubtype(app, plugin, entry.type, entry.query, options);
          if (subtype !== null) return { type: entry.type, subtype: subtype || null };
        }
      }
      const items = typeItems(app, plugin, options);
      if (!items) return null;
      const groups = items.map((item) => ({
        item,
        subtypes: plugin.getSubtypes(item.type, options).map(({ subtype, count }) => ({ type: item.type, subtype, count }))
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
var {
  getSubtype,
  getSubtypeNames,
  isSubtypeManual,
  migrateAboveStandard,
  migrateSubtypeColorScale,
  migrateSubtypeManual
} = require_subtypes();
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
  //
  // Subtypen mit abgeschaltetem "Manuell erstellbar" (Icon links neben dem
  // Namen ihres Blocks, siehe renderSubtypeManualToggle in typ-view.js) bleiben
  // wie die so abgeschalteten TYPen in getTypes() außen vor - außer
  // includeManualOff ist gesetzt.
  getSubtypes(type, { includeManualOff = false } = {}) {
    const { counts } = this.typIndex.subtypeBucket(type);
    return getSubtypeNames(this.settings, type).filter((subtype) => includeManualOff || isSubtypeManual(this.settings, type, subtype)).map((subtype) => ({ subtype, count: counts.get(subtype) ?? 0 }));
  }
  // Für _obsidian/templater-scripts/TYP.js: Subtyp-Picker (siehe
  // type-picker.js). Löst mit dem gewählten Subtyp auf, mit "" für "Kein
  // Subtyp" (bzw. ohne Picker, wenn der TYP keine Subtypen hat), oder mit
  // null bei ESC (TYP.js kehrt dann zur TYP-Auswahl zurück). query (optional):
  // eine schon getippte Suchanfrage, nach der die Liste vorsortiert steht.
  // options wie bei getSubtypes (includeManualOff).
  pickSubtype(type, query = "", options = {}) {
    return pickSubtypeModal(this.app, this, type, query, options);
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
    const migrated = [
      migrateSubtypeColorScale(this.settings, DEFAULT_SUBTYPE_COLOR_RANGES),
      migrateTypListSecondary(this.settings, stored),
      dropTypListSubtypesAlign(this.settings),
      migrateSubtypeManual(this.settings)
    ];
    if (migrated.some(Boolean)) await this.saveSettings();
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL3R5cC1pbmRleC5qcyIsICJzcmMvc3VidHlwZXMuanMiLCAic3JjL2Zyb250bWF0dGVyLXNvcnQuanMiLCAic3JjL2Zyb250bWF0dGVyLW9yZGVyLWVkaXRvci5qcyIsICJzcmMvdHlwZS1jb2xvcnMuanMiLCAic3JjL3NldHRpbmdzLmpzIiwgInNyYy9jb21tYW5kcy5qcyIsICJzcmMvc2hvcnRjdXRzLmpzIiwgInNyYy9zaG9ydGN1dC1waWNrZXIuanMiLCAic3JjL3R5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzIiwgInNyYy9mcm9udG1hdHRlci1ibG9ja3MuanMiLCAic3JjL3R5cGUtdXRpbHMuanMiLCAic3JjL3R5cC12aWV3LmpzIiwgInNyYy9maWxlLWV4cGxvcmVyLWNvbG9ycy5qcyIsICJzcmMvZ3JhcGgtY29sb3JzLmpzIiwgInNyYy9zZWFyY2gtY29sb3JzLmpzIiwgInNyYy9yZWNlbnQtZmlsZXMtY29sb3JzLmpzIiwgInNyYy9iYWNrbGluay1jb2xvcnMuanMiLCAic3JjL2Jvb2ttYXJrLWNvbG9ycy5qcyIsICJzcmMvYWN0aXZlLXRpdGxlLWNvbG9ycy5qcyIsICJzcmMvbGluay1jb2xvcnMuanMiLCAic3JjL2Zyb250bWF0dGVyLWRlZmF1bHQtaGlnaGxpZ2h0LmpzIiwgInNyYy9wcm9wZXJ0eS1yZW5hbWUtc3luYy5qcyIsICJzcmMvdHlwZS1waWNrZXIuanMiLCAic3JjL3Nob3J0Y3V0LXNjcmlwdHMuanMiLCAic3JjL21haW4uanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IHsgRXZlbnRzLCBURmlsZSwgZGVib3VuY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcblxuY29uc3QgVFlQX1BST1BFUlRZID0gXCJUWVBcIjtcbmNvbnN0IFNVQlRZUF9QUk9QRVJUWSA9IFwiU1VCVFlQXCI7XG5jb25zdCBFTVBUWV9FTlRSWSA9IE9iamVjdC5mcmVlemUoeyB0eXBlS2V5OiBudWxsLCByYXdUeXBlOiBudWxsLCBzdWJ0eXBlS2V5OiBudWxsLCByYXdTdWJ0eXBlOiBudWxsIH0pO1xuXG4vLyBTYW1tZWx0IFx1MDBDNG5kZXJ1bmdlbiBtZWhyZXJlciBEYXRlaWVuICh6LiBCLiBVbWJlbmVubmVuIGVpbmVzIFRZUHMgaW4gdmllbGVuXG4vLyBOb3RpemVuLCBWYXVsdC1TeW5jKSB6dSBlaW5lbSBlaW56aWdlbiBcImNoYW5nZVwiLUV2ZW50LiBPaG5lIHJlc2V0VGltZXIsIGRhbWl0XG4vLyBlaW4gRGF1ZXJzdHJvbSBhbiBcdTAwQzRuZGVydW5nZW4gdHJvdHpkZW0gcmVnZWxtXHUwMEU0XHUwMERGaWcgZHVyY2hnZXJlaWNodCB3aXJkLlxuY29uc3QgRkxVU0hfREVMQVlfTVMgPSAxMDA7XG5cbmZ1bmN0aW9uIHJhd0l0ZW0odmFsdWUpIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBcIlwiO1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiID8gSlNPTi5zdHJpbmdpZnkodmFsdWUpIDogU3RyaW5nKHZhbHVlKTtcbn1cblxuLy8gRWluaGVpdGxpY2hlIEF1c2xlZ3VuZyBlaW5lcyBUWVAtV2VydHMgZlx1MDBGQ3IgZGFzIGdhbnplIFBsdWdpbjogZGVyIFdlcnQgd2lyZFxuLy8gYmV3dXNzdCBOSUNIVCBnZWdsXHUwMEU0dHRldCwgc29uZGVybiBpbiBzZWluZXIgUm9oZm9ybSB6dW0gU2NobFx1MDBGQ3NzZWwgLSBlaW4gVFlQIGlzdFxuLy8gZ2VuYXUgZWluIGVpbnplbG5lciwgc2F1YmVyZXIgV2VydC4gQWxsZXMgYW5kZXJlIChMZWVyemVpY2hlbiBhbSBSYW5kLCBrbGVpblxuLy8gZ2VzY2hyaWViZW4sIExpc3RlIC0gYXVjaCBlaW5lIGVpbmVsZW1lbnRpZ2UpIGVyZ2lidCBlaW5lbiBlaWdlbmVuIFNjaGxcdTAwRkNzc2VsLFxuLy8gZGVyIGluIGtlaW5lbSByZWdpc3RyaWVydGVuIFRZUCBhdWZnZWh0OiBlciBiZWtvbW10IGtlaW5lIEZhcmJlLCB6XHUwMEU0aGx0IG5pY2h0XG4vLyBiZWltIFwicmljaHRpZ2VuXCIgVFlQIG1pdCB1bmQgc3RlaHQgaW4gZGVyIFRZUC1WaWV3IGFscyBlaWdlbmVyLFxuLy8gdW5yZWdpc3RyaWVydGVyIEVpbnRyYWcsIHZvbiB3byBhdXMgZXIgc2ljaCBwZXIgS2xpY2sgYmVyZWluaWdlbiBsXHUwMEU0c3N0XG4vLyAoc2llaGUgcmVnaXN0ZXJUeXBlIGluIHR5cC12aWV3LmpzKS4gTGlzdGVuIGVyc2NoZWluZW4gZGFiZWkgYWxzXG4vLyBcIltBLCBCXVwiIHVuZCBrXHUwMEY2bm5lbiBzbyBuaWUgbWl0IGVpbmVtIEVpbnplbHdlcnQgXCJBLCBCXCIgenVzYW1tZW5mYWxsZW4uXG4vLyBudWxsID0ga2VpbiBUWVAgKGZlaGxlbmQsIGxlZXIsIG51ciBMZWVyemVpY2hlbiwgbGVlcmUgTGlzdGUpLlxuZnVuY3Rpb24gdHlwZUtleU9mKHZhbHVlKSB7XG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgIGNvbnN0IGl0ZW1zID0gdmFsdWUubWFwKHJhd0l0ZW0pO1xuICAgIGlmIChpdGVtcy5ldmVyeSgoaXRlbSkgPT4gaXRlbS50cmltKCkgPT09IFwiXCIpKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gYFske2l0ZW1zLmpvaW4oXCIsIFwiKX1dYDtcbiAgfVxuICBjb25zdCB0ZXh0ID0gcmF3SXRlbSh2YWx1ZSk7XG4gIHJldHVybiB0ZXh0LnRyaW0oKSA9PT0gXCJcIiA/IG51bGwgOiB0ZXh0O1xufVxuXG4vLyBPYnNpZGlhbiBiZWhhbmRlbHQgUHJvcGVydHktTmFtZW4gb2huZSBCZWFjaHR1bmcgZGVyIEdyb1x1MDBERi0vS2xlaW5zY2hyZWlidW5nXG4vLyAoXCJTdWJ0eXBcIiB1bmQgXCJTVUJUWVBcIiBzaW5kIGluIFwiQWxsIHByb3BlcnRpZXNcIiBkaWVzZWxiZSBQcm9wZXJ0eSkgLSBUWVBcbi8vIHVuZCBTVUJUWVAgd2VyZGVuIGRlc2hhbGIgZ2VuYXVzbyBnZWxlc2VuLiBEaWUgZXhha3RlIFNjaHJlaWJ3ZWlzZSBoYXRcbi8vIFZvcnJhbmcsIGZhbGxzIGVpbmUgTm90aXogKGZlaGxlcmhhZnQpIG1laHJlcmUgVmFyaWFudGVuIHRyXHUwMEU0Z3QuXG5mdW5jdGlvbiBwcm9wZXJ0eUtleU9mKGZyb250bWF0dGVyLCBuYW1lKSB7XG4gIGlmICghZnJvbnRtYXR0ZXIpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoZnJvbnRtYXR0ZXIsIG5hbWUpKSByZXR1cm4gbmFtZTtcbiAgY29uc3QgbG93ZXIgPSBuYW1lLnRvTG93ZXJDYXNlKCk7XG4gIHJldHVybiBPYmplY3Qua2V5cyhmcm9udG1hdHRlcikuZmluZCgoa2V5KSA9PiBrZXkudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXIpO1xufVxuXG5mdW5jdGlvbiBwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBuYW1lKSB7XG4gIGNvbnN0IGtleSA9IHByb3BlcnR5S2V5T2YoZnJvbnRtYXR0ZXIsIG5hbWUpO1xuICByZXR1cm4ga2V5ID09PSB1bmRlZmluZWQgPyB1bmRlZmluZWQgOiBmcm9udG1hdHRlcltrZXldO1xufVxuXG4vLyBTY2hyZWlidCB2YWx1ZSB1bnRlciBkZXIgZWluaGVpdGxpY2hlbiBTY2hyZWlid2Vpc2UgbmFtZSAoei4gQi4gXCJTVUJUWVBcIilcbi8vIGluIGRhcyB2b24gcHJvY2Vzc0Zyb250TWF0dGVyIGdlbGllZmVydGUgT2JqZWt0LiBFaW5lIGFid2VpY2hlbmRcbi8vIGdlc2NocmllYmVuZSBWYXJpYW50ZSAoXCJTdWJ0eXBcIikgd2lyZCBkYWJlaSBhbiBPcnQgdW5kIFN0ZWxsZSB1bWJlbmFubnQgLVxuLy8gT2JqZWt0LUluc2VydGlvbi1PcmRlciBiZXN0aW1tdCBkaWUgWUFNTC1SZWloZW5mb2xnZSwgZGFoZXIgYmVpIEJlZGFyZiBhbGxlXG4vLyBLZXlzIGluIGJpc2hlcmlnZXIgUmVpaGVuZm9sZ2UgbmV1IGVpbmZcdTAwRkNnZW4gKHdpZSBpbiBmcm9udG1hdHRlci1zb3J0LmpzKS5cbmZ1bmN0aW9uIHNldENhbm9uaWNhbFByb3BlcnR5KGZyb250bWF0dGVyLCBuYW1lLCB2YWx1ZSkge1xuICBjb25zdCBsb3dlciA9IG5hbWUudG9Mb3dlckNhc2UoKTtcbiAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKGZyb250bWF0dGVyKTtcbiAgaWYgKCFrZXlzLnNvbWUoKGtleSkgPT4ga2V5ICE9PSBuYW1lICYmIGtleS50b0xvd2VyQ2FzZSgpID09PSBsb3dlcikpIHtcbiAgICBmcm9udG1hdHRlcltuYW1lXSA9IHZhbHVlO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBzbmFwc2hvdCA9IHsgLi4uZnJvbnRtYXR0ZXIgfTtcbiAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykgZGVsZXRlIGZyb250bWF0dGVyW2tleV07XG4gIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICBpZiAoa2V5LnRvTG93ZXJDYXNlKCkgIT09IGxvd2VyKSBmcm9udG1hdHRlcltrZXldID0gc25hcHNob3Rba2V5XTtcbiAgICBlbHNlIGlmICghKG5hbWUgaW4gZnJvbnRtYXR0ZXIpKSBmcm9udG1hdHRlcltuYW1lXSA9IHZhbHVlO1xuICB9XG59XG5cbi8vIEVudGZlcm50IG5hbWUgaW4gamVkZXIgU2NocmVpYndlaXNlIGF1cyBkZW0gdm9uIHByb2Nlc3NGcm9udE1hdHRlclxuLy8gZ2VsaWVmZXJ0ZW4gT2JqZWt0LlxuZnVuY3Rpb24gZGVsZXRlUHJvcGVydHkoZnJvbnRtYXR0ZXIsIG5hbWUpIHtcbiAgY29uc3QgbG93ZXIgPSBuYW1lLnRvTG93ZXJDYXNlKCk7XG4gIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGZyb250bWF0dGVyKSkge1xuICAgIGlmIChrZXkudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXIpIGRlbGV0ZSBmcm9udG1hdHRlcltrZXldO1xuICB9XG59XG5cbi8vIFNVQlRZUCB3aXJkIGdlbmF1c28gYXVzZ2VsZWd0ICh0eXBlS2V5T2YpOiBlaW5lIE5vdGl6IGhhdCBoXHUwMEY2Y2hzdGVucyBlaW5lblxuLy8gU1VCVFlQIGFscyBzYXViZXJlbiBFaW56ZWx3ZXJ0LCBhbGxlcyBhbmRlcmUgaXN0IGVpbiBlaWdlbmVyLCBuaWNodFxuLy8gZXJmYXNzdGVyIFNjaGxcdTAwRkNzc2VsIChzaWVoZSBTdWJ0eXAtQmxcdTAwRjZja2UgaW4gZGVyIFRZUC1EZXRhaWxhbnNpY2h0KS5cbmZ1bmN0aW9uIHNhbWVFbnRyeShhLCBiKSB7XG4gIHJldHVybiAhIWEgJiYgISFiICYmIGEudHlwZUtleSA9PT0gYi50eXBlS2V5ICYmIGEuc3VidHlwZUtleSA9PT0gYi5zdWJ0eXBlS2V5O1xufVxuXG4vLyBaZW50cmFsZXIgVFlQLS9TVUJUWVAtSW5kZXggXHUwMEZDYmVyIGFsbGUgTWFya2Rvd24tRGF0ZWllbiAoUGZhZCAtPiBXZXJ0ZSkuXG4vL1xuLy8gWndlY2s6IGRpZSBGYXJiLU1vZHVsZSBoaW5nZW4gYmlzaGVyIGFsbGUgZGlyZWt0IGFuIG1ldGFkYXRhQ2FjaGUgXCJjaGFuZ2VkXCJcbi8vIHVuZCBcInJlc29sdmVkXCIgLSBiZWlkZSBmZXVlcm4gYmVpIEpFREVSIFx1MDBDNG5kZXJ1bmcgYW4gaXJnZW5kZWluZXIgTm90aXogKGJlaW1cbi8vIFRpcHBlbiBldHdhIGFsbGUgendlaSBTZWt1bmRlbiksIHVuZCBqZWRlcyBNb2R1bCBmXHUwMEU0cmJ0ZSBkYXJhdWZoaW4gc2VpbmVcbi8vIGtvbXBsZXR0ZSBBbnNpY2h0IG5ldSwgZG9wcGVsdC4gRGVyIEluZGV4IHZlcmdsZWljaHQgc3RhdHRkZXNzZW4gamUgRGF0ZWksIG9iXG4vLyBzaWNoIFRZUCBvZGVyIFNVQlRZUCB0YXRzXHUwMEU0Y2hsaWNoIGdlXHUwMEU0bmRlcnQgaGF0IChiencuIGVpbmUgTm90aXogaGluenVrYW0vXG4vLyB3ZWdmaWVsKSwgdW5kIGZldWVydCBudXIgZGFubiBzZWluIGVpZ2VuZXMgXCJjaGFuZ2VcIi1FdmVudCAoQXJndW1lbnQ6IFNldCBkZXJcbi8vIGJldHJvZmZlbmVuIFBmYWRlKS4gTm9ybWFsZXMgU2NocmVpYmVuIGxcdTAwRjZzdCBkYW1pdCBnYXIga2VpbiBOZXUtRWluZlx1MDBFNHJiZW4gbWVociBhdXMuXG4vL1xuLy8gWnVzXHUwMEU0dHpsaWNoIGhcdTAwRTRsdCBlciBkaWUgdmF1bHQtd2VpdGVuIFpcdTAwRTRobHVuZ2VuIChUWVAtTGlzdGUsIFNVQlRZUC1MaXN0ZSxcbi8vIFBpY2tlciwgZ2V0VHlwZXMoKSBmXHUwMEZDciBUZW1wbGF0ZXIpIHp3aXNjaGVuZ2VzcGVpY2hlcnQsIHN0YXR0IHNpZSBiZWkgamVkZW1cbi8vIEF1ZnJ1ZiBwZXIgU2NhbiBcdTAwRkNiZXIgYWxsZSBOb3RpemVuIG5ldSB6dSBiZXJlY2huZW4uXG5jbGFzcyBUeXBJbmRleCBleHRlbmRzIEV2ZW50cyB7XG4gIGNvbnN0cnVjdG9yKHBsdWdpbikge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gICAgdGhpcy5hcHAgPSBwbHVnaW4uYXBwO1xuICAgIHRoaXMuZW50cmllcyA9IG5ldyBNYXAoKTtcbiAgICB0aGlzLmJ1aWx0ID0gZmFsc2U7XG4gICAgdGhpcy5hZ2dyZWdhdGVzID0gbnVsbDtcbiAgICB0aGlzLnBlbmRpbmdQYXRocyA9IG5ldyBTZXQoKTtcbiAgICB0aGlzLmZsdXNoID0gZGVib3VuY2UoKCkgPT4ge1xuICAgICAgY29uc3QgcGF0aHMgPSB0aGlzLnBlbmRpbmdQYXRocztcbiAgICAgIHRoaXMucGVuZGluZ1BhdGhzID0gbmV3IFNldCgpO1xuICAgICAgdGhpcy50cmlnZ2VyKFwiY2hhbmdlXCIsIHBhdGhzKTtcbiAgICB9LCBGTFVTSF9ERUxBWV9NUyk7XG4gIH1cblxuICByZWdpc3RlcigpIHtcbiAgICBjb25zdCB7IHBsdWdpbiwgYXBwIH0gPSB0aGlzO1xuICAgIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC5tZXRhZGF0YUNhY2hlLm9uKFwiY2hhbmdlZFwiLCAoZmlsZSkgPT4gdGhpcy51cGRhdGUoZmlsZSkpKTtcbiAgICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAubWV0YWRhdGFDYWNoZS5vbihcImRlbGV0ZWRcIiwgKGZpbGUpID0+IHRoaXMucmVtb3ZlKGZpbGUucGF0aCkpKTtcbiAgICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJyZW5hbWVcIiwgKGZpbGUsIG9sZFBhdGgpID0+IHRoaXMucmVuYW1lKGZpbGUsIG9sZFBhdGgpKSk7XG4gICAgLy8gXCJFeGNsdWRlZCBmaWxlc1wiLUxpc3RlIGdlXHUwMEU0bmRlcnQgKHNpZWhlIHJlZ2lzdGVyVHlwVmlldykgLSBkaWUgRWludHJcdTAwRTRnZVxuICAgIC8vIHNlbGJzdCBibGVpYmVuIGdcdTAwRkNsdGlnLCBudXIgZGllIGRhcmF1cyBnZWZpbHRlcnRlbiBaXHUwMEU0aGx1bmdlbiBuaWNodC5cbiAgICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJjb25maWctY2hhbmdlZFwiLCAoKSA9PiAodGhpcy5hZ2dyZWdhdGVzID0gbnVsbCkpKTtcblxuICAgIC8vIEJlaW0gQXBwLVN0YXJ0IGthbm4gZGVyIGVyc3RlIFp1Z3JpZmYgKGxhenksIHNpZWhlIGVuc3VyZUJ1aWx0KSBub2NoIHZvclxuICAgIC8vIGRlbSB2b2xsc3RcdTAwRTRuZGlnIGdlbGFkZW5lbiBNZXRhZGF0YUNhY2hlIGxpZWdlbi4gRWlubWFsaWcgbmFjaCBkZXNzZW5cbiAgICAvLyBlcnN0ZW0ga29tcGxldHRlbiBBdWZsXHUwMEY2c3VuZ3NkdXJjaGxhdWYgbmV1IGF1ZmJhdWVuOyBBYndlaWNodW5nZW4gbGFuZGVuXG4gICAgLy8gZGFiZWkgd2llIGplZGUgYW5kZXJlIFx1MDBDNG5kZXJ1bmcgaW0gXCJjaGFuZ2VcIi1FdmVudC5cbiAgICBjb25zdCByZXNvbHZlZFJlZiA9IGFwcC5tZXRhZGF0YUNhY2hlLm9uKFwicmVzb2x2ZWRcIiwgKCkgPT4ge1xuICAgICAgYXBwLm1ldGFkYXRhQ2FjaGUub2ZmcmVmKHJlc29sdmVkUmVmKTtcbiAgICAgIHRoaXMucmVidWlsZCgpO1xuICAgIH0pO1xuICAgIHBsdWdpbi5yZWdpc3RlckV2ZW50KHJlc29sdmVkUmVmKTtcblxuICAgIHBsdWdpbi5yZWdpc3RlcigoKSA9PiB0aGlzLmZsdXNoLmNhbmNlbCgpKTtcbiAgfVxuXG4gIHJlYWQoZmlsZSkge1xuICAgIGNvbnN0IGZyb250bWF0dGVyID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyO1xuICAgIGNvbnN0IHJhd1R5cGUgPSBwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBUWVBfUFJPUEVSVFkpID8/IG51bGw7XG4gICAgY29uc3QgcmF3U3VidHlwZSA9IHByb3BlcnR5VmFsdWUoZnJvbnRtYXR0ZXIsIFNVQlRZUF9QUk9QRVJUWSkgPz8gbnVsbDtcbiAgICByZXR1cm4geyB0eXBlS2V5OiB0eXBlS2V5T2YocmF3VHlwZSksIHJhd1R5cGUsIHN1YnR5cGVLZXk6IHR5cGVLZXlPZihyYXdTdWJ0eXBlKSwgcmF3U3VidHlwZSB9O1xuICB9XG5cbiAgZW5zdXJlQnVpbHQoKSB7XG4gICAgaWYgKCF0aGlzLmJ1aWx0KSB0aGlzLnJlYnVpbGQoKTtcbiAgfVxuXG4gIHJlYnVpbGQoKSB7XG4gICAgY29uc3QgcHJldmlvdXMgPSB0aGlzLmVudHJpZXM7XG4gICAgY29uc3Qgd2FzQnVpbHQgPSB0aGlzLmJ1aWx0O1xuICAgIHRoaXMuZW50cmllcyA9IG5ldyBNYXAoKTtcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpKSB0aGlzLmVudHJpZXMuc2V0KGZpbGUucGF0aCwgdGhpcy5yZWFkKGZpbGUpKTtcbiAgICB0aGlzLmJ1aWx0ID0gdHJ1ZTtcbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsO1xuICAgIGlmICghd2FzQnVpbHQpIHJldHVybjtcblxuICAgIGZvciAoY29uc3QgW3BhdGgsIGVudHJ5XSBvZiB0aGlzLmVudHJpZXMpIHtcbiAgICAgIGlmICghc2FtZUVudHJ5KHByZXZpb3VzLmdldChwYXRoKSwgZW50cnkpKSB0aGlzLnBlbmRpbmdQYXRocy5hZGQocGF0aCk7XG4gICAgfVxuICAgIGZvciAoY29uc3QgcGF0aCBvZiBwcmV2aW91cy5rZXlzKCkpIHtcbiAgICAgIGlmICghdGhpcy5lbnRyaWVzLmhhcyhwYXRoKSkgdGhpcy5wZW5kaW5nUGF0aHMuYWRkKHBhdGgpO1xuICAgIH1cbiAgICBpZiAodGhpcy5wZW5kaW5nUGF0aHMuc2l6ZSA+IDApIHRoaXMuZmx1c2goKTtcbiAgfVxuXG4gIG1hcmtDaGFuZ2VkKHBhdGgpIHtcbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsO1xuICAgIHRoaXMucGVuZGluZ1BhdGhzLmFkZChwYXRoKTtcbiAgICB0aGlzLmZsdXNoKCk7XG4gIH1cblxuICB1cGRhdGUoZmlsZSkge1xuICAgIC8vIFZvciBkZW0gZXJzdGVuIFp1Z3JpZmYgZ2lidCBlcyBub2NoIGtlaW5lbiB2ZXJhbHRldGVuIFN0YW5kIC0gZGVyXG4gICAgLy8gc3BcdTAwRTR0ZXJlIGxhenkgQXVmYmF1IGxpZXN0IG9obmVoaW4gZnJpc2NoIGF1cyBkZW0gTWV0YWRhdGFDYWNoZS5cbiAgICBpZiAoIXRoaXMuYnVpbHQgfHwgIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpIHx8IGZpbGUuZXh0ZW5zaW9uICE9PSBcIm1kXCIpIHJldHVybjtcbiAgICBjb25zdCBuZXh0ID0gdGhpcy5yZWFkKGZpbGUpO1xuICAgIGlmIChzYW1lRW50cnkodGhpcy5lbnRyaWVzLmdldChmaWxlLnBhdGgpLCBuZXh0KSkgcmV0dXJuO1xuICAgIHRoaXMuZW50cmllcy5zZXQoZmlsZS5wYXRoLCBuZXh0KTtcbiAgICB0aGlzLm1hcmtDaGFuZ2VkKGZpbGUucGF0aCk7XG4gIH1cblxuICByZW1vdmUocGF0aCkge1xuICAgIGlmICghdGhpcy5idWlsdCB8fCAhdGhpcy5lbnRyaWVzLmRlbGV0ZShwYXRoKSkgcmV0dXJuO1xuICAgIHRoaXMubWFya0NoYW5nZWQocGF0aCk7XG4gIH1cblxuICByZW5hbWUoZmlsZSwgb2xkUGF0aCkge1xuICAgIGlmICghdGhpcy5idWlsdCkgcmV0dXJuO1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5lbnRyaWVzLmdldChvbGRQYXRoKTtcbiAgICBpZiAoZW50cnkpIHtcbiAgICAgIHRoaXMuZW50cmllcy5kZWxldGUob2xkUGF0aCk7XG4gICAgICB0aGlzLm1hcmtDaGFuZ2VkKG9sZFBhdGgpO1xuICAgIH1cbiAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlICYmIGZpbGUuZXh0ZW5zaW9uID09PSBcIm1kXCIpIHtcbiAgICAgIHRoaXMuZW50cmllcy5zZXQoZmlsZS5wYXRoLCBlbnRyeSA/PyB0aGlzLnJlYWQoZmlsZSkpO1xuICAgICAgdGhpcy5tYXJrQ2hhbmdlZChmaWxlLnBhdGgpO1xuICAgIH1cbiAgfVxuXG4gIGVudHJ5Rm9yKGZpbGUpIHtcbiAgICBpZiAoIWZpbGUpIHJldHVybiBFTVBUWV9FTlRSWTtcbiAgICB0aGlzLmVuc3VyZUJ1aWx0KCk7XG4gICAgcmV0dXJuIHRoaXMuZW50cmllcy5nZXQoZmlsZS5wYXRoKSA/PyBFTVBUWV9FTlRSWTtcbiAgfVxuXG4gIC8vIFRZUC1TY2hsXHUwMEZDc3NlbCAoc2llaGUgdHlwZUtleU9mKSBvZGVyIG51bGwuIEZcdTAwRkNyIGVpbmVuIHNhdWJlcmVuIFdlcnQgaXN0IGRhc1xuICAvLyBzY2hsaWNodCBkZXIgVFlQLU5hbWUgc2VsYnN0LlxuICB0eXBlT2YoZmlsZSkge1xuICAgIHJldHVybiB0aGlzLmVudHJ5Rm9yKGZpbGUpLnR5cGVLZXk7XG4gIH1cblxuICAvLyBTVUJUWVAtU2NobFx1MDBGQ3NzZWwgKHNpZWhlIHR5cGVLZXlPZikgb2RlciBudWxsLlxuICBzdWJ0eXBlT2YoZmlsZSkge1xuICAgIHJldHVybiB0aGlzLmVudHJ5Rm9yKGZpbGUpLnN1YnR5cGVLZXk7XG4gIH1cblxuICAvLyBFaW4gdGF0c1x1MDBFNGNobGljaGVyIEZyb250bWF0dGVyLVdlcnQgenUgZWluZW0gU2NobFx1MDBGQ3NzZWwgLSBmXHUwMEZDciBBbnplaWdlLCBTdWNoZVxuICAvLyB1bmQgTm9ybWFsaXNpZXJ1bmcgdW5yZWdpc3RyaWVydGVyIEVpbnRyXHUwMEU0Z2UgKGFsbGUgTm90aXplbiBlaW5lcyBTY2hsXHUwMEZDc3NlbHNcbiAgLy8gaGFiZW4gcGVyIERlZmluaXRpb24gZGllc2VsYmUgUm9oZm9ybSkuXG4gIHJhd1ZhbHVlT2YodHlwZUtleSkge1xuICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZSgpLnJhd0J5S2V5LmdldCh0eXBlS2V5KTtcbiAgfVxuXG4gIC8vIFNhdWJlcmVyIFdlcnQgPSBFaW56ZWx3ZXJ0IG9obmUgTGVlcnplaWNoZW4gYW0gUmFuZC4gS2xlaW4gZ2VzY2hyaWViZW5lXG4gIC8vIFdlcnRlIHpcdTAwRTRobGVuIGhpZXIgYWxzIHNhdWJlciAoc2llIHNpbmQgZWluIGdcdTAwRkNsdGlnZXIsIG51ciBub2NoIG5pY2h0XG4gIC8vIHJlZ2lzdHJpZXJ0ZXIgVFlQLU5hbWUpLCBMaXN0ZW4gdW5kIFJhbmRsZWVyemVpY2hlbiBuaWNodC5cbiAgaXNDbGVhbktleSh0eXBlS2V5KSB7XG4gICAgY29uc3QgcmF3ID0gdGhpcy5yYXdWYWx1ZU9mKHR5cGVLZXkpO1xuICAgIHJldHVybiByYXcgIT09IHVuZGVmaW5lZCAmJiAhQXJyYXkuaXNBcnJheShyYXcpICYmIHR5cGVLZXkgPT09IHR5cGVLZXkudHJpbSgpO1xuICB9XG5cbiAgLy8gRGF0ZWllbiBtaXQgZ2VuYXUgZGllc2VtIFRZUC1TY2hsXHUwMEZDc3NlbCwgdW50ZXIgQmVhY2h0dW5nIGRlclxuICAvLyBcIklnbm9yaWVydGUgTm90aXplbiBiZXJcdTAwRkNja3NpY2h0aWdlblwiLUVpbnN0ZWxsdW5nLlxuICBmaWxlc1dpdGhUeXBlKHR5cGVLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5maWxlc01hdGNoaW5nKChlbnRyeSkgPT4gZW50cnkudHlwZUtleSA9PT0gdHlwZUtleSk7XG4gIH1cblxuICAvLyBEYXRlaWVuIG1pdCBnZW5hdSBkaWVzZW0gVFlQLSB1bmQgU1VCVFlQLVNjaGxcdTAwRkNzc2VsLlxuICBmaWxlc1dpdGhTdWJ0eXBlKHR5cGVLZXksIHN1YnR5cGVLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5maWxlc01hdGNoaW5nKChlbnRyeSkgPT4gZW50cnkudHlwZUtleSA9PT0gdHlwZUtleSAmJiBlbnRyeS5zdWJ0eXBlS2V5ID09PSBzdWJ0eXBlS2V5KTtcbiAgfVxuXG4gIGZpbGVzTWF0Y2hpbmcocHJlZGljYXRlKSB7XG4gICAgdGhpcy5lbnN1cmVCdWlsdCgpO1xuICAgIGNvbnN0IGluY2x1ZGVJZ25vcmVkID0gISF0aGlzLnBsdWdpbi5zZXR0aW5ncy5pbmNsdWRlSWdub3JlZEZpbGVzO1xuICAgIGNvbnN0IGZpbGVzID0gW107XG4gICAgZm9yIChjb25zdCBbcGF0aCwgZW50cnldIG9mIHRoaXMuZW50cmllcykge1xuICAgICAgaWYgKCFwcmVkaWNhdGUoZW50cnkpKSBjb250aW51ZTtcbiAgICAgIGlmICghaW5jbHVkZUlnbm9yZWQgJiYgdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5pc1VzZXJJZ25vcmVkKHBhdGgpKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgocGF0aCk7XG4gICAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSBmaWxlcy5wdXNoKGZpbGUpO1xuICAgIH1cbiAgICByZXR1cm4gZmlsZXM7XG4gIH1cblxuICAvLyBSZXNwZWt0aWVydCBzdGFuZGFyZG1cdTAwRTRcdTAwREZpZyBPYnNpZGlhbnMgZWlnZW5lIFwiRXhjbHVkZWQgZmlsZXNcIi1MaXN0ZSAtIGRvcnRcbiAgLy8gdHJhZ2VuIGF1Y2ggUGx1Z2lucyB3aWUgSGlkZSBGb2xkZXJzIGF1c2dlYmxlbmRldGUgT3JkbmVyIGVpbi4gXHUwMERDYmVyIGRpZVxuICAvLyBFaW5zdGVsbHVuZyBcIklnbm9yaWVydGUgTm90aXplbiBiZXJcdTAwRkNja3NpY2h0aWdlblwiIGFic2NoYWx0YmFyLlxuICAvL1xuICAvLyBFaW5lIE5vdGl6IG9obmUgVFlQIGhhdCBrZWluZW4gU1VCVFlQLUtvbnRleHQuXG4gIGFnZ3JlZ2F0ZSgpIHtcbiAgICB0aGlzLmVuc3VyZUJ1aWx0KCk7XG4gICAgY29uc3QgaW5jbHVkZUlnbm9yZWQgPSAhIXRoaXMucGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXM7XG4gICAgaWYgKHRoaXMuYWdncmVnYXRlcz8uaW5jbHVkZUlnbm9yZWQgPT09IGluY2x1ZGVJZ25vcmVkKSByZXR1cm4gdGhpcy5hZ2dyZWdhdGVzO1xuXG4gICAgY29uc3QgY291bnRzID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IHJhd0J5S2V5ID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IHN1YnR5cGVzQnlUeXBlID0gbmV3IE1hcCgpO1xuICAgIGxldCBub1R5cGUgPSAwO1xuICAgIGZvciAoY29uc3QgW3BhdGgsIHsgdHlwZUtleSwgcmF3VHlwZSwgc3VidHlwZUtleSwgcmF3U3VidHlwZSB9XSBvZiB0aGlzLmVudHJpZXMpIHtcbiAgICAgIGlmICghaW5jbHVkZUlnbm9yZWQgJiYgdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5pc1VzZXJJZ25vcmVkKHBhdGgpKSBjb250aW51ZTtcbiAgICAgIGlmICh0eXBlS2V5ID09PSBudWxsKSB7XG4gICAgICAgIG5vVHlwZSsrO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvdW50cy5zZXQodHlwZUtleSwgKGNvdW50cy5nZXQodHlwZUtleSkgPz8gMCkgKyAxKTtcbiAgICAgIGlmICghcmF3QnlLZXkuaGFzKHR5cGVLZXkpKSByYXdCeUtleS5zZXQodHlwZUtleSwgcmF3VHlwZSk7XG4gICAgICBsZXQgYnVja2V0ID0gc3VidHlwZXNCeVR5cGUuZ2V0KHR5cGVLZXkpO1xuICAgICAgaWYgKCFidWNrZXQpIHtcbiAgICAgICAgYnVja2V0ID0geyBjb3VudHM6IG5ldyBNYXAoKSwgbm9TdWJ0eXBlOiAwLCByYXdCeUtleTogbmV3IE1hcCgpIH07XG4gICAgICAgIHN1YnR5cGVzQnlUeXBlLnNldCh0eXBlS2V5LCBidWNrZXQpO1xuICAgICAgfVxuICAgICAgaWYgKHN1YnR5cGVLZXkgPT09IG51bGwpIHtcbiAgICAgICAgYnVja2V0Lm5vU3VidHlwZSsrO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYnVja2V0LmNvdW50cy5zZXQoc3VidHlwZUtleSwgKGJ1Y2tldC5jb3VudHMuZ2V0KHN1YnR5cGVLZXkpID8/IDApICsgMSk7XG4gICAgICAgIGlmICghYnVja2V0LnJhd0J5S2V5LmhhcyhzdWJ0eXBlS2V5KSkgYnVja2V0LnJhd0J5S2V5LnNldChzdWJ0eXBlS2V5LCByYXdTdWJ0eXBlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5hZ2dyZWdhdGVzID0geyBpbmNsdWRlSWdub3JlZCwgY291bnRzLCBub1R5cGUsIHJhd0J5S2V5LCBzdWJ0eXBlc0J5VHlwZSB9O1xuICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZXM7XG4gIH1cblxuICAvLyBad2lzY2hlbmdlc3BlaWNoZXJ0IC0gZGllIGdlbGllZmVydGVuIE1hcHMgbmljaHQgdmVyXHUwMEU0bmRlcm4uXG4gIHR5cGVDb3VudHMoKSB7XG4gICAgY29uc3QgeyBjb3VudHMsIG5vVHlwZSB9ID0gdGhpcy5hZ2dyZWdhdGUoKTtcbiAgICByZXR1cm4geyBjb3VudHMsIG5vVHlwZSB9O1xuICB9XG5cbiAgLy8gVFlQIC0+IHsgY291bnRzOiBNYXAoU1VCVFlQLVNjaGxcdTAwRkNzc2VsIC0+IEFuemFobCksIG5vU3VidHlwZSwgcmF3QnlLZXkgfS5cbiAgLy8gWndpc2NoZW5nZXNwZWljaGVydCAtIG5pY2h0IHZlclx1MDBFNG5kZXJuLlxuICBzdWJ0eXBlQ291bnRzKCkge1xuICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZSgpLnN1YnR5cGVzQnlUeXBlO1xuICB9XG5cbiAgc3VidHlwZUJ1Y2tldCh0eXBlS2V5KSB7XG4gICAgcmV0dXJuIHRoaXMuc3VidHlwZUNvdW50cygpLmdldCh0eXBlS2V5KSA/PyBFTVBUWV9CVUNLRVQ7XG4gIH1cbn1cblxuY29uc3QgRU1QVFlfQlVDS0VUID0gT2JqZWN0LmZyZWV6ZSh7IGNvdW50czogbmV3IE1hcCgpLCBub1N1YnR5cGU6IDAsIHJhd0J5S2V5OiBuZXcgTWFwKCkgfSk7XG5cbm1vZHVsZS5leHBvcnRzID0geyBUeXBJbmRleCwgdHlwZUtleU9mLCBwcm9wZXJ0eVZhbHVlLCBzZXRDYW5vbmljYWxQcm9wZXJ0eSwgZGVsZXRlUHJvcGVydHksIFRZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZIH07XG4iLCAiY29uc3QgeyB0eXBlS2V5T2YsIHByb3BlcnR5VmFsdWUsIHNldENhbm9uaWNhbFByb3BlcnR5LCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcblxuLy8gU3VidHlwLU5hbWVuIHdlcmRlbiAoYW5kZXJzIGFscyBUWVBlbiwgc2llaGUgbm9ybWFsaXplVHlwZU5hbWUpIG1pdCBncm9cdTAwREZlbVxuLy8gQW5mYW5nc2J1Y2hzdGFiZW4gamUgV29ydCBnZXNjaHJpZWJlbiwgZGVyIFJlc3Qga2xlaW46IFwia3VyeiBHRVNDSElDSFRFXCIgXHUyMTkyXG4vLyBcIkt1cnogR2VzY2hpY2h0ZVwiLiBEaWUgUHJvcGVydHkgU1VCVFlQIHNlbGJzdCBibGVpYnQgaW4gR3JvXHUwMERGYnVjaHN0YWJlbi5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVN1YnR5cGVOYW1lKHJhdykge1xuICByZXR1cm4gcmF3LnRyaW0oKS5yZXBsYWNlKC9cXFMrL2csICh3b3JkKSA9PiB3b3JkLmNoYXJBdCgwKS50b0xvY2FsZVVwcGVyQ2FzZShcImRlXCIpICsgd29yZC5zbGljZSgxKS50b0xvY2FsZUxvd2VyQ2FzZShcImRlXCIpKTtcbn1cblxuLy8gUmVnaXN0cmllcnRlIFNVQlRZUGVuIGplIFRZUCAoc2V0dGluZ3MudHlwZVN1YnR5cGVzKTpcbi8vICAgeyBbVFlQXTogeyBbU1VCVFlQXTogeyBmcm9udG1hdHRlcjogey4uLn0sIGZsb2F0aW5nS2V5czogWy4uLl0sIHNob3J0Y3V0czogey4uLn0sIG1hbnVhbD86IGZhbHNlIH0gfSB9XG4vLyBFaW4gU3VidHlwIGdlaFx1MDBGNnJ0IGltbWVyIHp1IGdlbmF1IGVpbmVtIFRZUDsgZGVyc2VsYmUgTmFtZSBkYXJmIGFiZXIgKGFsc1xuLy8gZWlnZW5zdFx1MDBFNG5kaWdlciBTdWJ0eXApIGF1Y2ggdW50ZXIgZWluZW0gYW5kZXJlbiBUWVAgdm9ya29tbWVuLiBEaWVcbi8vIFJlaWhlbmZvbGdlIGRlciBTY2hsXHUwMEZDc3NlbCBpc3QgZGllIEFuemVpZ2VyZWloZW5mb2xnZSBkZXIgQmxcdTAwRjZja2UgaW4gZGVyXG4vLyBUWVAtRGV0YWlsYW5zaWNodCwgc3RldHMgdW50ZXJoYWxiIGRlcyBUWVAtRnJvbnRtYXR0ZXJzLiBmcm9udG1hdHRlclxuLy8gZXJnXHUwMEU0bnp0IGJ6dy4gXHUwMEZDYmVyc2NocmVpYnQgZGFzIFRZUC1Gcm9udG1hdHRlciBkZXMgVFlQcywgZmxvYXRpbmdLZXlzIHdpZVxuLy8gdHlwZUZsb2F0aW5nS2V5cywgc2hvcnRjdXRzIHdpZSB0eXBlU2hvcnRjdXRzIChzaWVoZSBzaG9ydGN1dHMuanMpIC0gamUgS2V5XG4vLyBkZXMgQmxvY2tzIGVpbiBTaG9ydGN1dC1SZWNvcmQsIGRlciBXZXJ0IGRlcyBLZXlzIGJsZWlidCBkYWJlaSBhbHNcbi8vIFJcdTAwRkNja2ZhbGx3ZXJ0IHN0ZWhlbi4gQmVzdGFuZHNkYXRlbiBmXHUwMEZDaHJlbiBzaG9ydGN1dHMgbm9jaCBuaWNodCwgTGVzZXIgbVx1MDBGQ3NzZW5cbi8vIGVzIGRhaGVyIGFscyBvcHRpb25hbCBiZWhhbmRlbG4uIG1hbnVhbCB3aWUgc2V0dGluZ3MudHlwZU1hbnVhbCBmXHUwMEZDciBUWVBlbiAtXG4vLyBudXIgZGllIEFid2VpY2h1bmcgdm9tIFN0YW5kYXJkIHdpcmQgZ2VzcGVpY2hlcnQgKHNpZWhlIGlzU3VidHlwZU1hbnVhbCkuXG4vL1xuLy8gRGVyc2VsYmUgS2V5IGRhcmYgaW4gbWVocmVyZW4gQmxcdTAwRjZja2VuIGVpbmVzIFRZUHMgc3RlaGVuIChudXIgaW5uZXJoYWxiXG4vLyBFSU5FUyBCbG9ja3MgaXN0IGVyIHp3YW5nc2xcdTAwRTR1ZmlnIGVpbmRldXRpZyk6XG4vLyAgIC0gaW4gendlaSBTdWJ0eXAtQmxcdTAwRjZja2VuOiBrb25mbGlrdGZyZWksIGRhIGVpbmUgTm90aXogaFx1MDBGNmNoc3RlbnMgZWluZW5cbi8vICAgICBTVUJUWVAgaGF0IHVuZCBkaWUgQmxcdTAwRjZja2UgZGFtaXQgbmllIGdsZWljaHplaXRpZyBnZWx0ZW47XG4vLyAgIC0gaW0gVFlQLUZyb250bWF0dGVyIFVORCBlaW5lbSBTdWJ0eXAtQmxvY2s6IGRlciBTdWJ0eXAgXHUwMEZDYmVyc2NocmVpYnRcbi8vICAgICBXZXJ0IHVuZCBGbG9hdGluZy1NYXJraWVydW5nLCBkaWUgWmVpbGUgYmVoXHUwMEU0bHQgYWJlciBkaWUgUG9zaXRpb24gZGVzXG4vLyAgICAgVFlQLUZyb250bWF0dGVycyAoc2llaGUgZ2V0VHlwZURlZmF1bHRzIGluIG1haW4uanMgdW5kXG4vLyAgICAgb3JkZXJlZERlZmF1bHRLZXlzIGluIGZyb250bWF0dGVyLXNvcnQuanMgLSBiZWlkZSBtXHUwMEZDc3NlbiBkaWVzZWxiZVxuLy8gICAgIFJlZ2VsIHZlcndlbmRlbiwgc29uc3Qgc29ydGllcnQgZGllIEZyb250bWF0dGVyLVNvcnRpZXJ1bmcgZWluZSBnZXJhZGVcbi8vICAgICBhbmdlbGVndGUgTm90aXogc29mb3J0IHdpZWRlciB1bSkuXG5cbi8vIFwiTm9jaCBhdXN6dWZcdTAwRkNsbGVuXCIgLSBlaW4gc29sY2hlciBXZXJ0IHdpcmQgYmVpbSBadXNhbW1lbmxlZ2VuIHp3ZWllclxuLy8gQmxcdTAwRjZja2UgYnp3LiB6d2VpZXIgUHJvcGVydGllcyB2b20gamV3ZWlscyBhbmRlcmVuIGdlZlx1MDBGQ2xsdCwgc3RhdHQgZGVuXG4vLyBiZXN0ZWhlbmRlbiBFaW50cmFnIHp1IFx1MDBGQ2JlcnNjaHJlaWJlbiAoc2llaGUgbWVyZ2VTdWJ0eXBlcyBoaWVyIHVuZFxuLy8gcmVuYW1lSW5TdG9yZSBpbiBwcm9wZXJ0eS1yZW5hbWUtc3luYy5qcykuXG5mdW5jdGlvbiBpc0VtcHR5VmFsdWUodmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IFwiXCI7XG59XG5cbmZ1bmN0aW9uIGdldFN1YnR5cGVOYW1lcyhzZXR0aW5ncywgdHlwZSkge1xuICByZXR1cm4gT2JqZWN0LmtleXMoc2V0dGluZ3MudHlwZVN1YnR5cGVzPy5bdHlwZV0gPz8ge30pO1xufVxuXG5mdW5jdGlvbiBnZXRTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKSB7XG4gIHJldHVybiBzZXR0aW5ncy50eXBlU3VidHlwZXM/Llt0eXBlXT8uW3N1YnR5cGVdID8/IG51bGw7XG59XG5cbmZ1bmN0aW9uIGVuc3VyZVN1YnR5cGUoc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpIHtcbiAgaWYgKCFzZXR0aW5ncy50eXBlU3VidHlwZXMpIHNldHRpbmdzLnR5cGVTdWJ0eXBlcyA9IHt9O1xuICBpZiAoIXNldHRpbmdzLnR5cGVTdWJ0eXBlc1t0eXBlXSkgc2V0dGluZ3MudHlwZVN1YnR5cGVzW3R5cGVdID0ge307XG4gIGNvbnN0IGJ5TmFtZSA9IHNldHRpbmdzLnR5cGVTdWJ0eXBlc1t0eXBlXTtcbiAgaWYgKCFieU5hbWVbc3VidHlwZV0pIHtcbiAgICBieU5hbWVbc3VidHlwZV0gPSB7IGZyb250bWF0dGVyOiB7fSwgZmxvYXRpbmdLZXlzOiBbXSwgc2hvcnRjdXRzOiB7fSB9O1xuICAgIC8vIEVpbiBuZXVlciBTdWJ0eXAgZWluZXMgbmljaHQgbWFudWVsbCBlcnN0ZWxsYmFyZW4gVFlQcyBpc3Qgc2VsYnN0IGtlaW5lcjpcbiAgICAvLyBlaW4gbWFudWVsbCBlcnN0ZWxsYmFyZXIgU3VidHlwIHNldHp0IHNlaW5lbiBUWVAgdm9yYXVzLCBkYSBkZXIgUGlja2VyXG4gICAgLy8gbnVyIFx1MDBGQ2JlciBpaG4genUgZGVuIFN1YnR5cGVuIGZcdTAwRkNocnQgKHNpZWhlIGlzU3VidHlwZU1hbnVhbCkuXG4gICAgaWYgKHNldHRpbmdzLnR5cGVNYW51YWw/Llt0eXBlXSA9PT0gZmFsc2UpIGJ5TmFtZVtzdWJ0eXBlXS5tYW51YWwgPSBmYWxzZTtcbiAgfVxuICByZXR1cm4gYnlOYW1lW3N1YnR5cGVdO1xufVxuXG4vKiAtLS0gXCJNYW51ZWxsIGVyc3RlbGxiYXJcIiBqZSBTdWJ0eXAgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAqIFdpZSBzZXR0aW5ncy50eXBlTWFudWFsIGZcdTAwRkNyIFRZUGVuIChzaWVoZSByZW5kZXJNYW51YWxUb2dnbGUgaW4gdHlwLXZpZXcuanMpOlxuICogZ2VzcGVpY2hlcnQgd2lyZCBudXIgZGllIEFid2VpY2h1bmcgdm9tIFN0YW5kYXJkLCBhbHNvIGFsbGVpbiBkYXMgQWJzY2hhbHRlblxuICogKG1hbnVhbDogZmFsc2UpOyBmZWhsZW5kZXIgRWludHJhZyBiencuIHRydWUgYmVkZXV0ZW4gXCJhblwiLiBTdGV1ZXJ0LCBvYiBkZXJcbiAqIFN1YnR5cCBpbiBnZXRTdWJ0eXBlcygpIChzaWVoZSBtYWluLmpzKSB1bmQgZGFtaXQgaW0gU3VidHlwLVBpY2tlciBhdWZ0YXVjaHQuXG4gKlxuICogVFlQIHVuZCBTdWJ0eXBlbiBoXHUwMEU0bmdlbiBkYWJlaSB6dXNhbW1lbiwgd2VpbCBkZXIgUGlja2VyIG51ciBcdTAwRkNiZXIgZGVuIFRZUCB6dVxuICogZGVzc2VuIFN1YnR5cGVuIGZcdTAwRkNocnQ6IGVpbiBhYmdlc2NoYWx0ZXRlciBUWVAgc2NoYWx0ZXQgYWxsZSBzZWluZSBTdWJ0eXBlblxuICogbWl0IGFiLCBlaW4gYW5nZXNjaGFsdGV0ZXIgYWxsZSBtaXQgYW4gKHNldEFsbFN1YnR5cGVzTWFudWFsKSwgdW5kIGVpblxuICogZWluemVsbiBhbmdlc2NoYWx0ZXRlciBTdWJ0eXAgc2NoYWx0ZXQgc2VpbmVuIFRZUCBtaXQgYW4gLSBkaWUgXHUwMEZDYnJpZ2VuXG4gKiBTdWJ0eXBlbiBibGVpYmVuIGRhdm9uIGFiZXIgdW5iZXJcdTAwRkNocnQgKHNpZWhlIHJlbmRlclN1YnR5cGVNYW51YWxUb2dnbGUgaW5cbiAqIHR5cC12aWV3LmpzKS4gRGFtaXQgZ2lsdCBpbW1lcjogZWluIFN1YnR5cCBpc3QgaFx1MDBGNmNoc3RlbnMgZGFubiBtYW51ZWxsXG4gKiBlcnN0ZWxsYmFyLCB3ZW5uIHNlaW4gVFlQIGVzIGF1Y2ggaXN0LlxuICogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5mdW5jdGlvbiBpc1N1YnR5cGVNYW51YWwoc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpIHtcbiAgcmV0dXJuIGdldFN1YnR5cGUoc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpPy5tYW51YWwgIT09IGZhbHNlO1xufVxuXG5mdW5jdGlvbiBzZXRTdWJ0eXBlTWFudWFsKHNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlLCBvbikge1xuICBjb25zdCBkYXRhID0gZ2V0U3VidHlwZShzZXR0aW5ncywgdHlwZSwgc3VidHlwZSk7XG4gIGlmICghZGF0YSkgcmV0dXJuO1xuICBpZiAob24pIGRlbGV0ZSBkYXRhLm1hbnVhbDtcbiAgZWxzZSBkYXRhLm1hbnVhbCA9IGZhbHNlO1xufVxuXG5mdW5jdGlvbiBzZXRBbGxTdWJ0eXBlc01hbnVhbChzZXR0aW5ncywgdHlwZSwgb24pIHtcbiAgZm9yIChjb25zdCBzdWJ0eXBlIG9mIGdldFN1YnR5cGVOYW1lcyhzZXR0aW5ncywgdHlwZSkpIHNldFN1YnR5cGVNYW51YWwoc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUsIG9uKTtcbn1cblxuLy8gWmllaHQgZGllc2UgUmVnZWwgaW4gQmVzdGFuZHNkYXRlbiBlaW5tYWxpZyBuYWNoOiBkb3J0IGdhYiBlcyBkZW4gU2NoYWx0ZXJcbi8vIGplIFN1YnR5cCBub2NoIG5pY2h0LCBkaWUgU3VidHlwZW4gZWluZXMgYWJnZXNjaGFsdGV0ZW4gVFlQcyBzdFx1MDBGQ25kZW4gYWxzb1xuLy8gYWxsZSBhdWYgXCJhblwiIC0gaW4gZGVyIERldGFpbGFuc2ljaHQgc2ljaHRiYXIgYWxzIHZpZXIgYW5nZXNjaGFsdGV0ZVxuLy8gU3VidHlwZW4gdW50ZXIgZWluZW0gYWJnZXNjaGFsdGV0ZW4gVFlQLiBMaWVmZXJ0IHRydWUgYmVpIGVpbmVyIFx1MDBDNG5kZXJ1bmcuXG5mdW5jdGlvbiBtaWdyYXRlU3VidHlwZU1hbnVhbChzZXR0aW5ncykge1xuICBsZXQgY2hhbmdlZCA9IGZhbHNlO1xuICBmb3IgKGNvbnN0IFt0eXBlLCBvZmZdIG9mIE9iamVjdC5lbnRyaWVzKHNldHRpbmdzLnR5cGVNYW51YWwgPz8ge30pKSB7XG4gICAgaWYgKG9mZiAhPT0gZmFsc2UpIGNvbnRpbnVlO1xuICAgIGZvciAoY29uc3Qgc3VidHlwZSBvZiBnZXRTdWJ0eXBlTmFtZXMoc2V0dGluZ3MsIHR5cGUpKSB7XG4gICAgICBpZiAoIWlzU3VidHlwZU1hbnVhbChzZXR0aW5ncywgdHlwZSwgc3VidHlwZSkpIGNvbnRpbnVlO1xuICAgICAgc2V0U3VidHlwZU1hbnVhbChzZXR0aW5ncywgdHlwZSwgc3VidHlwZSwgZmFsc2UpO1xuICAgICAgY2hhbmdlZCA9IHRydWU7XG4gICAgfVxuICB9XG4gIHJldHVybiBjaGFuZ2VkO1xufVxuXG4vLyBCZWltIFVtYmVuZW5uZW4gZWluZXMgVFlQczogU3VidHlwZW4gd2FuZGVybiB1bnRlciBkZW4gbmV1ZW4gTmFtZW4gbWl0LlxuZnVuY3Rpb24gbW92ZVR5cGVTdWJ0eXBlcyhzZXR0aW5ncywgb2xkVHlwZSwgbmV3VHlwZSkge1xuICBpZiAoIXNldHRpbmdzLnR5cGVTdWJ0eXBlcz8uW29sZFR5cGVdKSByZXR1cm47XG4gIHNldHRpbmdzLnR5cGVTdWJ0eXBlc1tuZXdUeXBlXSA9IHNldHRpbmdzLnR5cGVTdWJ0eXBlc1tvbGRUeXBlXTtcbiAgZGVsZXRlIHNldHRpbmdzLnR5cGVTdWJ0eXBlc1tvbGRUeXBlXTtcbn1cblxuZnVuY3Rpb24gZGVsZXRlVHlwZVN1YnR5cGVzKHNldHRpbmdzLCB0eXBlKSB7XG4gIGlmIChzZXR0aW5ncy50eXBlU3VidHlwZXMpIGRlbGV0ZSBzZXR0aW5ncy50eXBlU3VidHlwZXNbdHlwZV07XG59XG5cbi8vIEVudGZlcm50IGRpZSBNYXJraWVydW5nIGFib3ZlU3RhbmRhcmQgYXVzIEJlc3RhbmRzZGF0ZW46IFN1YnR5cC1CbFx1MDBGNmNrZVxuLy8gZHVyZnRlbiBmclx1MDBGQ2hlciBcdTAwRkNiZXIgZGVtIFRZUC1Gcm9udG1hdHRlciBsaWVnZW4sIGRhcyBzdGVodCBqZXR6dCBmZXN0IGdhbnpcbi8vIG9iZW4gKHNpZWhlIGdldFNlY3Rpb25PcmRlcikuIExpZWZlcnQgdHJ1ZSBiZWkgZWluZXIgXHUwMEM0bmRlcnVuZy5cbmZ1bmN0aW9uIG1pZ3JhdGVBYm92ZVN0YW5kYXJkKHNldHRpbmdzKSB7XG4gIGxldCBjaGFuZ2VkID0gZmFsc2U7XG4gIGZvciAoY29uc3QgYnlOYW1lIG9mIE9iamVjdC52YWx1ZXMoc2V0dGluZ3MudHlwZVN1YnR5cGVzID8/IHt9KSkge1xuICAgIGZvciAoY29uc3QgZGF0YSBvZiBPYmplY3QudmFsdWVzKGJ5TmFtZSkpIHtcbiAgICAgIGlmIChkYXRhLmFib3ZlU3RhbmRhcmQgPT09IHVuZGVmaW5lZCkgY29udGludWU7XG4gICAgICBkZWxldGUgZGF0YS5hYm92ZVN0YW5kYXJkO1xuICAgICAgY2hhbmdlZCA9IHRydWU7XG4gICAgfVxuICB9XG4gIHJldHVybiBjaGFuZ2VkO1xufVxuXG4vLyBEaWUgUmVnbGVyIGRlciBTdWJ0eXAtRmFyYmVuIGhhYmVuIHp3ZWltYWwgaWhyZSBCZWRldXR1bmcgZ2VcdTAwRTRuZGVydCwgb2huZVxuLy8gZGFzcyBzaWNoIGRpZSBnZXNwZWljaGVydGVuIFphaGxlbiB2b24gc2VsYnN0IG1pdGJld2VndCBoXHUwMEU0dHRlbiAoc2llaGVcbi8vIGFwcGx5Q29sb3JPZmZzZXQgdW5kIGNoYW5uZWxCb3VuZHMgaW4gdHlwZS1jb2xvcnMuanMpLiBzZXR0aW5ncy5cbi8vIHN1YnR5cGVDb2xvclNjYWxlIGhcdTAwRTRsdCBmZXN0LCB3ZWxjaGVuIFN0YW5kIGRpZSBnZXNwZWljaGVydGVuIFdlcnRlIGhhYmVuO1xuLy8gamVkZXIgU2Nocml0dCBsXHUwMEU0dWZ0IGdlbmF1IGVpbm1hbC4gTGllZmVydCB0cnVlIGJlaSBlaW5lciBcdTAwQzRuZGVydW5nIC0gZGllXG4vLyBnZWhcdTAwRjZydCBzb2ZvcnQgZ2VzcGVpY2hlcnQsIHNvbnN0IGxpZWZlIGRpZSBVbXJlY2hudW5nIGJlaW0gblx1MDBFNGNoc3RlbiBTdGFydFxuLy8gZXJuZXV0LiBXYXJlbiBkaWUgR3JlbnplbiBub2NoIGRpZSBTdGFuZGFyZHdlcnRlIGRlcyBqZXdlaWxpZ2VuIFN0YW5kcyxcbi8vIGdlbHRlbiBkYW5hY2ggZGllIG5ldWVuLlxuLy8gICAxIC0+IDI6IEhlbGxpZ2tlaXQgelx1MDBFNGhsdGUgYWJzb2x1dGUgT0tMQ0gtUHVua3RlLCBqZXR6dCBkZW4gQW50ZWlsIGRlcyBXZWdzXG4vLyAgICAgICAgICAgenUgV2VpXHUwMERGIGJ6dy4gU2Nod2Fyei4gRGllIGFsdGUgWmFobCBsXHUwMEU0c3N0IHNpY2ggbmljaHQgdW1yZWNobmVuXG4vLyAgICAgICAgICAgKHNpZSBoaW5nIHZvbiBkZXIgVFlQLUZhcmJlIGFiKSwgd29obCBhYmVyIGRpZSBBYnNpY2h0IGRhaGludGVyOlxuLy8gICAgICAgICAgIHdhcyBkZW4gUmVnbGVyIGhhbGIgYXVzcmVpenRlLCByZWl6dCBpaG4gYXVjaCBkYW5hY2ggaGFsYiBhdXMuXG4vLyAgIDIgLT4gMzogZGllIFNcdTAwRTR0dGlndW5nIGdlaHQgbnVyIG5vY2ggbmFjaCB1bnRlbjsgZ2VzcGVpY2hlcnRlIHBvc2l0aXZlXG4vLyAgICAgICAgICAgV2VydGUgc2luZCBzb25zdCBzdHVtbSBnZWthcHB0IHVuZCB3XHUwMEU0cmVuIGJlaW0gblx1MDBFNGNoc3RlbiBcdTAwRDZmZm5lbiBkZXNcbi8vICAgICAgICAgICBQb3BvdmVycyB1bmFuZ2VrXHUwMEZDbmRpZ3QgdmVyc2Nod3VuZGVuLlxuY29uc3QgU1VCVFlQRV9DT0xPUl9TQ0FMRSA9IDM7XG5jb25zdCBQUkVWSU9VU19TVUJUWVBFX0NPTE9SX1JBTkdFUyA9IHtcbiAgMjogeyBoOiAyNSwgczogMzAsIGw6IDIwIH0sXG4gIDM6IHsgaDogMzUsIHM6IDIwLCBsOiA0MCB9LFxufTtcblxuZnVuY3Rpb24gbWlncmF0ZVN1YnR5cGVDb2xvclNjYWxlKHNldHRpbmdzLCBkZWZhdWx0UmFuZ2VzKSB7XG4gIGNvbnN0IGZyb20gPSBOdW1iZXIoc2V0dGluZ3Muc3VidHlwZUNvbG9yU2NhbGUpIHx8IDE7XG4gIGlmIChmcm9tID49IFNVQlRZUEVfQ09MT1JfU0NBTEUpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgYWxsQ29sb3JzID0gZnVuY3Rpb24qICgpIHtcbiAgICBmb3IgKGNvbnN0IGJ5TmFtZSBvZiBPYmplY3QudmFsdWVzKHNldHRpbmdzLnR5cGVTdWJ0eXBlcyA/PyB7fSkpIHtcbiAgICAgIGZvciAoY29uc3QgZGF0YSBvZiBPYmplY3QudmFsdWVzKGJ5TmFtZSkpIGlmIChkYXRhLmNvbG9yKSB5aWVsZCBkYXRhLmNvbG9yO1xuICAgIH1cbiAgfTtcbiAgY29uc3QgYWRvcHREZWZhdWx0cyA9IChzdGVwKSA9PiB7XG4gICAgY29uc3QgcHJldmlvdXMgPSBQUkVWSU9VU19TVUJUWVBFX0NPTE9SX1JBTkdFU1tzdGVwXTtcbiAgICBpZiAoT2JqZWN0LmVudHJpZXMocHJldmlvdXMpLmV2ZXJ5KChba2V5LCB2YWx1ZV0pID0+IE51bWJlcihzZXR0aW5ncy5zdWJ0eXBlQ29sb3JSYW5nZXM/LltrZXldKSA9PT0gdmFsdWUpKSB7XG4gICAgICBzZXR0aW5ncy5zdWJ0eXBlQ29sb3JSYW5nZXMgPSB7IC4uLmRlZmF1bHRSYW5nZXMgfTtcbiAgICB9XG4gIH07XG4gIGlmIChmcm9tIDwgMikge1xuICAgIGNvbnN0IG9sZFJhbmdlID0gTnVtYmVyKHNldHRpbmdzLnN1YnR5cGVDb2xvclJhbmdlcz8ubCk7XG4gICAgYWRvcHREZWZhdWx0cygyKTtcbiAgICBjb25zdCBuZXdSYW5nZSA9IE51bWJlcihzZXR0aW5ncy5zdWJ0eXBlQ29sb3JSYW5nZXM/LmwpO1xuICAgIGNvbnN0IGZhY3RvciA9IG9sZFJhbmdlID4gMCAmJiBOdW1iZXIuaXNGaW5pdGUobmV3UmFuZ2UpID8gbmV3UmFuZ2UgLyBvbGRSYW5nZSA6IDE7XG4gICAgZm9yIChjb25zdCBjb2xvciBvZiBhbGxDb2xvcnMoKSkgaWYgKGNvbG9yLmwpIGNvbG9yLmwgPSBNYXRoLnJvdW5kKGNvbG9yLmwgKiBmYWN0b3IpO1xuICB9XG4gIGlmIChmcm9tIDwgMykge1xuICAgIGFkb3B0RGVmYXVsdHMoMyk7XG4gICAgZm9yIChjb25zdCBjb2xvciBvZiBhbGxDb2xvcnMoKSkgaWYgKGNvbG9yLnMgPiAwKSBjb2xvci5zID0gMDtcbiAgfVxuICBzZXR0aW5ncy5zdWJ0eXBlQ29sb3JTY2FsZSA9IFNVQlRZUEVfQ09MT1JfU0NBTEU7XG4gIHJldHVybiB0cnVlO1xufVxuXG4vLyBadXNhbW1lbmxlZ2VuIHp3ZWllciBUWVBlbjogU3VidHlwZW4sIGRpZSBlcyBudXIgYmVpIHNvdXJjZSBnaWJ0LCB3ZXJkZW5cbi8vIFx1MDBGQ2Jlcm5vbW1lbi4gR2xlaWNobmFtaWdlIEJsXHUwMEY2Y2tlIHdlcmRlbiB2ZXJlaW5pZ3QgLSBiZWkgZ2xlaWNoZW0gS2V5XG4vLyBnZXdpbm5lbiBXZXJ0IHVuZCBGbG9hdGluZy1NYXJraWVydW5nIGRlcyBaaWVscywgS2V5cyBudXIgYXVzIHNvdXJjZVxuLy8gd2VyZGVuIGhpbnRlbiBhbmdlaFx1MDBFNG5ndC4gU3RlaHQgZWluIFx1MDBGQ2Jlcm5vbW1lbmVyIEtleSB6dWdsZWljaCBpbVxuLy8gVFlQLUZyb250bWF0dGVyIGRlcyBaaWVscywgYmxlaWJlbiBiZWlkZSBzdGVoZW4gLSBkYXJhdXMgd2lyZCBkaWUgZ2FuelxuLy8gbm9ybWFsZSBcdTAwRENiZXJzY2hyZWlidW5nIChzaWVoZSBLb21tZW50YXIgYW4gdHlwZVN1YnR5cGVzIG9iZW4pLlxuZnVuY3Rpb24gbWVyZ2VUeXBlU3VidHlwZXMoc2V0dGluZ3MsIHNvdXJjZSwgdGFyZ2V0KSB7XG4gIGNvbnN0IHNvdXJjZVN1YnR5cGVzID0gc2V0dGluZ3MudHlwZVN1YnR5cGVzPy5bc291cmNlXTtcbiAgaWYgKCFzb3VyY2VTdWJ0eXBlcykgcmV0dXJuO1xuICBmb3IgKGNvbnN0IFtuYW1lLCBzb3VyY2VEYXRhXSBvZiBPYmplY3QuZW50cmllcyhzb3VyY2VTdWJ0eXBlcykpIHtcbiAgICBjb25zdCB0YXJnZXREYXRhID0gZ2V0U3VidHlwZShzZXR0aW5ncywgdGFyZ2V0LCBuYW1lKTtcbiAgICBpZiAoIXRhcmdldERhdGEpIHtcbiAgICAgIGVuc3VyZVN1YnR5cGUoc2V0dGluZ3MsIHRhcmdldCwgbmFtZSk7XG4gICAgICBzZXR0aW5ncy50eXBlU3VidHlwZXNbdGFyZ2V0XVtuYW1lXSA9IHNvdXJjZURhdGE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgdGFyZ2V0TG93ZXIgPSBuZXcgU2V0KE9iamVjdC5rZXlzKHRhcmdldERhdGEuZnJvbnRtYXR0ZXIpLm1hcCgoa2V5KSA9PiBrZXkudG9Mb3dlckNhc2UoKSkpO1xuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHNvdXJjZURhdGEuZnJvbnRtYXR0ZXIpKSB7XG4gICAgICBpZiAoa2V5ID09PSBcIlwiIHx8IHRhcmdldExvd2VyLmhhcyhrZXkudG9Mb3dlckNhc2UoKSkpIGNvbnRpbnVlO1xuICAgICAgdGFyZ2V0RGF0YS5mcm9udG1hdHRlcltrZXldID0gdmFsdWU7XG4gICAgICBpZiAoc291cmNlRGF0YS5mbG9hdGluZ0tleXMuaW5jbHVkZXMoa2V5KSkgdGFyZ2V0RGF0YS5mbG9hdGluZ0tleXMucHVzaChrZXkpO1xuICAgICAgLy8gRGVyIFNob3J0Y3V0IGhcdTAwRTRuZ3QgYW0gS2V5IHVuZCB3YW5kZXJ0IGRlc2hhbGIgbWl0IGlobSBtaXQuXG4gICAgICBjb25zdCBzaG9ydGN1dCA9IHNvdXJjZURhdGEuc2hvcnRjdXRzPy5ba2V5XTtcbiAgICAgIGlmIChzaG9ydGN1dCkgKHRhcmdldERhdGEuc2hvcnRjdXRzID8/PSB7fSlba2V5XSA9IHNob3J0Y3V0O1xuICAgIH1cbiAgfVxuICBkZWxldGUgc2V0dGluZ3MudHlwZVN1YnR5cGVzW3NvdXJjZV07XG59XG5cbi8vIFVtYmVuZW5uZW4gZWluZXMgU3VidHlwcyBpbm5lcmhhbGIgc2VpbmVzIFRZUHMgLSBkZXIgQmxvY2sgYmVoXHUwMEU0bHQgZGFiZWlcbi8vIHNlaW5lIFBvc2l0aW9uIChBbnplaWdlcmVpaGVuZm9sZ2UgPSBTY2hsXHUwMEZDc3NlbHJlaWhlbmZvbGdlKS5cbmZ1bmN0aW9uIHJlbmFtZVN1YnR5cGUoc2V0dGluZ3MsIHR5cGUsIG9sZE5hbWUsIG5ld05hbWUpIHtcbiAgY29uc3QgYnlOYW1lID0gc2V0dGluZ3MudHlwZVN1YnR5cGVzPy5bdHlwZV07XG4gIGlmICghYnlOYW1lPy5bb2xkTmFtZV0gfHwgb2xkTmFtZSA9PT0gbmV3TmFtZSkgcmV0dXJuO1xuICBzZXR0aW5ncy50eXBlU3VidHlwZXNbdHlwZV0gPSBPYmplY3QuZnJvbUVudHJpZXMoXG4gICAgT2JqZWN0LmVudHJpZXMoYnlOYW1lKS5tYXAoKFtuYW1lLCBkYXRhXSkgPT4gW25hbWUgPT09IG9sZE5hbWUgPyBuZXdOYW1lIDogbmFtZSwgZGF0YV0pXG4gICk7XG59XG5cbi8vIFJlaWhlbmZvbGdlIGFsbGVyIEJsXHUwMEY2Y2tlIGVpbmVzIFRZUHMsIG51bGwgPSBUWVAtRnJvbnRtYXR0ZXIuIERhc1xuLy8gVFlQLUZyb250bWF0dGVyIHN0ZWh0IGltbWVyIGdhbnogb2JlbiwgZGllIFN1YnR5cGVuIGZvbGdlbiBpbiBpaHJlclxuLy8gU2NobFx1MDBGQ3NzZWxyZWloZW5mb2xnZS4gQmVzdGltbXQgZGllIEFuemVpZ2UgaW4gZGVyIFRZUC1EZXRhaWxhbnNpY2h0IGViZW5zb1xuLy8gd2llIGRpZSBGcm9udG1hdHRlci1Tb3J0aWVydW5nIGRlciBOb3RpemVuIChzaWVoZSBvcmRlcmVkRGVmYXVsdEtleXMpLlxuZnVuY3Rpb24gZ2V0U2VjdGlvbk9yZGVyKHNldHRpbmdzLCB0eXBlKSB7XG4gIHJldHVybiBbbnVsbCwgLi4uZ2V0U3VidHlwZU5hbWVzKHNldHRpbmdzLCB0eXBlKV07XG59XG5cbi8vIE5ldWUgQmxvY2stUmVpaGVuZm9sZ2UgKERyYWcgJiBEcm9wIGluIGRlciBUWVAtRGV0YWlsYW5zaWNodCk6IG9yZGVyIHdpZVxuLy8gZ2V0U2VjdGlvbk9yZGVyLCBkYXMgZlx1MDBGQ2hyZW5kZSBudWxsIGZcdTAwRkNyIGRhcyBUWVAtRnJvbnRtYXR0ZXIgd2lyZCBkYWJlaVxuLy8gaWdub3JpZXJ0IChlcyBpc3QgbmljaHQgdmVyc2NoaWViYmFyKS4gTmljaHQgZ2VuYW5udGUgU3VidHlwZW4gYmxlaWJlblxuLy8gZGFoaW50ZXIgZXJoYWx0ZW4uXG5mdW5jdGlvbiByZW9yZGVyU3VidHlwZXMoc2V0dGluZ3MsIHR5cGUsIG9yZGVyKSB7XG4gIGNvbnN0IGJ5TmFtZSA9IHNldHRpbmdzLnR5cGVTdWJ0eXBlcz8uW3R5cGVdO1xuICBpZiAoIWJ5TmFtZSkgcmV0dXJuO1xuICBjb25zdCBuYW1lcyA9IG9yZGVyLmZpbHRlcigobmFtZSkgPT4gbmFtZSAhPT0gbnVsbCAmJiBieU5hbWVbbmFtZV0pO1xuICBjb25zdCBvcmRlcmVkID0gWy4uLm5hbWVzLCAuLi5PYmplY3Qua2V5cyhieU5hbWUpLmZpbHRlcigobmFtZSkgPT4gIW5hbWVzLmluY2x1ZGVzKG5hbWUpKV07XG4gIHNldHRpbmdzLnR5cGVTdWJ0eXBlc1t0eXBlXSA9IE9iamVjdC5mcm9tRW50cmllcyhvcmRlcmVkLm1hcCgobmFtZSkgPT4gW25hbWUsIGJ5TmFtZVtuYW1lXV0pKTtcbn1cblxuZnVuY3Rpb24gZGVsZXRlU3VidHlwZShzZXR0aW5ncywgdHlwZSwgbmFtZSkge1xuICBjb25zdCBieU5hbWUgPSBzZXR0aW5ncy50eXBlU3VidHlwZXM/Llt0eXBlXTtcbiAgaWYgKCFieU5hbWUpIHJldHVybjtcbiAgZGVsZXRlIGJ5TmFtZVtuYW1lXTtcbiAgaWYgKE9iamVjdC5rZXlzKGJ5TmFtZSkubGVuZ3RoID09PSAwKSBkZWxldGUgc2V0dGluZ3MudHlwZVN1YnR5cGVzW3R5cGVdO1xufVxuXG4vLyBadXNhbW1lbmxlZ2VuIHp3ZWllciBTdWJ0eXBlbiBkZXNzZWxiZW4gVFlQczogZGllIFByb3BlcnRpZXMgdm9uIHNvdXJjZVxuLy8gd2FuZGVybiBhbnMgRW5kZSBkZXMgWmllbC1CbG9ja3MsIHNvdXJjZSB2ZXJzY2h3aW5kZXQuIEZcdTAwRkNocnQgZGFzIFppZWwgZWluZW5cbi8vIEtleSBiZXJlaXRzLCBiZWhcdTAwRTRsdCBlcyBQb3NpdGlvbiwgV2VydCB1bmQgRmxvYXRpbmctTWFya2llcnVuZyAtIG51ciBlaW5cbi8vIGxlZXJlciBaaWVsd2VydCB3aXJkIGF1cyBzb3VyY2UgZ2VmXHUwMEZDbGx0IChkYXNzZWxiZSBNdXN0ZXIgd2llIHJlbmFtZUluU3RvcmVcbi8vIGluIHByb3BlcnR5LXJlbmFtZS1zeW5jLmpzIGJlaW0gWnVzYW1tZW5sZWdlbiB6d2VpZXIgUHJvcGVydGllcykuIElubmVyaGFsYlxuLy8gZWluZXMgQmxvY2tzIGJsZWlidCBqZWRlciBLZXkgendhbmdzbFx1MDBFNHVmaWcgZWluZGV1dGlnLCBibG9ja1x1MDBGQ2JlcmdyZWlmZW5kZVxuLy8gRG9wcGx1bmdlbiBzaW5kIGRhdm9uIG5pY2h0IGJldHJvZmZlbi5cbmZ1bmN0aW9uIG1lcmdlU3VidHlwZXMoc2V0dGluZ3MsIHR5cGUsIHNvdXJjZSwgdGFyZ2V0KSB7XG4gIGNvbnN0IHNvdXJjZURhdGEgPSBnZXRTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBzb3VyY2UpO1xuICBjb25zdCB0YXJnZXREYXRhID0gZ2V0U3VidHlwZShzZXR0aW5ncywgdHlwZSwgdGFyZ2V0KTtcbiAgaWYgKCFzb3VyY2VEYXRhIHx8ICF0YXJnZXREYXRhIHx8IHNvdXJjZSA9PT0gdGFyZ2V0KSByZXR1cm47XG5cbiAgY29uc3QgdGFyZ2V0S2V5cyA9IG5ldyBNYXAoT2JqZWN0LmtleXModGFyZ2V0RGF0YS5mcm9udG1hdHRlcikubWFwKChrZXkpID0+IFtrZXkudG9Mb3dlckNhc2UoKSwga2V5XSkpO1xuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzb3VyY2VEYXRhLmZyb250bWF0dGVyKSkge1xuICAgIGlmIChrZXkgPT09IFwiXCIpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGV4aXN0aW5nID0gdGFyZ2V0S2V5cy5nZXQoa2V5LnRvTG93ZXJDYXNlKCkpO1xuICAgIGlmIChleGlzdGluZyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0YXJnZXREYXRhLmZyb250bWF0dGVyW2tleV0gPSB2YWx1ZTtcbiAgICAgIHRhcmdldEtleXMuc2V0KGtleS50b0xvd2VyQ2FzZSgpLCBrZXkpO1xuICAgICAgaWYgKHNvdXJjZURhdGEuZmxvYXRpbmdLZXlzLmluY2x1ZGVzKGtleSkgJiYgIXRhcmdldERhdGEuZmxvYXRpbmdLZXlzLmluY2x1ZGVzKGtleSkpIHRhcmdldERhdGEuZmxvYXRpbmdLZXlzLnB1c2goa2V5KTtcbiAgICAgIC8vIERlciBTaG9ydGN1dCBoXHUwMEU0bmd0IGFtIEtleSB1bmQgd2FuZGVydCBkZXNoYWxiIG1pdCBpaG0gbWl0LlxuICAgICAgY29uc3Qgc2hvcnRjdXQgPSBzb3VyY2VEYXRhLnNob3J0Y3V0cz8uW2tleV07XG4gICAgICBpZiAoc2hvcnRjdXQpICh0YXJnZXREYXRhLnNob3J0Y3V0cyA/Pz0ge30pW2tleV0gPSBzaG9ydGN1dDtcbiAgICB9IGVsc2UgaWYgKGlzRW1wdHlWYWx1ZSh0YXJnZXREYXRhLmZyb250bWF0dGVyW2V4aXN0aW5nXSkpIHtcbiAgICAgIHRhcmdldERhdGEuZnJvbnRtYXR0ZXJbZXhpc3RpbmddID0gdmFsdWU7XG4gICAgfVxuICB9XG4gIGRlbGV0ZVN1YnR5cGUoc2V0dGluZ3MsIHR5cGUsIHNvdXJjZSk7XG59XG5cbi8vIFNjaHJlaWJ0IGRlbiBTVUJUWVAtV2VydCBhbGxlciBOb3RpemVuIG1pdCBUWVAtU2NobFx1MDBGQ3NzZWwgdHlwZSB1bmRcbi8vIFNVQlRZUC1TY2hsXHUwMEZDc3NlbCBvbGRLZXkgYXVmIGRlbiBFaW56ZWx3ZXJ0IG5ld1ZhbHVlIHVtIC0gYW5hbG9nIHp1XG4vLyByZW5hbWVUeXBlSW5Ob3RlcygpIGluIHR5cC12aWV3LmpzLlxuYXN5bmMgZnVuY3Rpb24gcmVuYW1lU3VidHlwZUluTm90ZXMocGx1Z2luLCB0eXBlLCBvbGRLZXksIG5ld1ZhbHVlKSB7XG4gIGxldCBjaGFuZ2VkID0gMDtcbiAgZm9yIChjb25zdCBmaWxlIG9mIHBsdWdpbi50eXBJbmRleC5maWxlc1dpdGhTdWJ0eXBlKHR5cGUsIG9sZEtleSkpIHtcbiAgICBsZXQgbWF0Y2hlZCA9IGZhbHNlO1xuICAgIGF3YWl0IHBsdWdpbi5hcHAuZmlsZU1hbmFnZXIucHJvY2Vzc0Zyb250TWF0dGVyKGZpbGUsIChmcm9udG1hdHRlcikgPT4ge1xuICAgICAgaWYgKHR5cGVLZXlPZihwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBTVUJUWVBfUFJPUEVSVFkpKSAhPT0gb2xkS2V5KSByZXR1cm47XG4gICAgICBzZXRDYW5vbmljYWxQcm9wZXJ0eShmcm9udG1hdHRlciwgU1VCVFlQX1BST1BFUlRZLCBuZXdWYWx1ZSk7XG4gICAgICBtYXRjaGVkID0gdHJ1ZTtcbiAgICB9KTtcbiAgICBpZiAobWF0Y2hlZCkgY2hhbmdlZCsrO1xuICB9XG4gIHJldHVybiBjaGFuZ2VkO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgbm9ybWFsaXplU3VidHlwZU5hbWUsXG4gIGlzRW1wdHlWYWx1ZSxcbiAgZ2V0U3VidHlwZU5hbWVzLFxuICBnZXRTdWJ0eXBlLFxuICBlbnN1cmVTdWJ0eXBlLFxuICBpc1N1YnR5cGVNYW51YWwsXG4gIHNldFN1YnR5cGVNYW51YWwsXG4gIHNldEFsbFN1YnR5cGVzTWFudWFsLFxuICBtaWdyYXRlU3VidHlwZU1hbnVhbCxcbiAgbWlncmF0ZUFib3ZlU3RhbmRhcmQsXG4gIG1pZ3JhdGVTdWJ0eXBlQ29sb3JTY2FsZSxcbiAgbW92ZVR5cGVTdWJ0eXBlcyxcbiAgZGVsZXRlVHlwZVN1YnR5cGVzLFxuICBtZXJnZVR5cGVTdWJ0eXBlcyxcbiAgcmVuYW1lU3VidHlwZSxcbiAgZ2V0U2VjdGlvbk9yZGVyLFxuICByZW9yZGVyU3VidHlwZXMsXG4gIGRlbGV0ZVN1YnR5cGUsXG4gIG1lcmdlU3VidHlwZXMsXG4gIHJlbmFtZVN1YnR5cGVJbk5vdGVzLFxufTtcbiIsICJjb25zdCB7IGdldFN1YnR5cGUgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cGVzXCIpO1xyXG5jb25zdCB7IHR5cGVLZXlPZiwgcHJvcGVydHlWYWx1ZSB9ID0gcmVxdWlyZShcIi4vdHlwLWluZGV4XCIpO1xyXG5cclxuY29uc3QgVFlQX1BST1BFUlRZID0gXCJUWVBcIjtcclxuY29uc3QgU1VCVFlQX1BST1BFUlRZID0gXCJTVUJUWVBcIjtcclxuXHJcbi8vIFdpcmQgYXVjaCB2b24gc2V0dGluZ3MuanMgKERlZmF1bHQgZlx1MDBGQ3IgZ2xvYmFsUHJvcGVydHlPcmRlcikgc293aWUgdm9tXHJcbi8vIE9yZGVyLUVkaXRvciBiZW51dHp0IC0gYWxsZSB2aWVyIFBsYXR6aGFsdGVyLUJsXHUwMEY2Y2tlIHNpbmQgZG9ydCBwZXIgVUkgbmljaHRcclxuLy8gZW50ZmVybmJhciwgbnVyIHZlcnNjaGllYmJhciAoc2llaGUgZnJvbnRtYXR0ZXItb3JkZXItZWRpdG9yLmpzKS5cclxuLy8gXCJ0eXBWYWx1ZVwiIGlzdCBkaWUgVFlQLVByb3BlcnR5IHNlbGJzdCwgXCJzdWJ0eXBWYWx1ZVwiIGFuYWxvZyBkaWUgU1VCVFlQLVxyXG4vLyBQcm9wZXJ0eSwgXCJ0eXBcIiBkaWUgVFlQLUZyb250bWF0dGVyLUxpc3RlIGRlcyBUWVBzIChzaWVoZVxyXG4vLyB0eXBlLWZyb250bWF0dGVyLWVkaXRvci5qcyksIFwib3RoZXJcIiBhbGxlcyBcdTAwRENicmlnZS5cclxuY29uc3QgREVGQVVMVF9HTE9CQUxfT1JERVIgPSBbeyBraW5kOiBcInR5cFZhbHVlXCIgfSwgeyBraW5kOiBcInN1YnR5cFZhbHVlXCIgfSwgeyBraW5kOiBcInR5cFwiIH0sIHsga2luZDogXCJvdGhlclwiIH1dO1xyXG5cclxuLy8gU3RlbGx0IHNpY2hlciwgZGFzcyBnZW5hdSBqZSBlaW4gRWludHJhZyBwcm8gUGxhdHpoYWx0ZXItQXJ0IHZvcmhhbmRlbiBpc3QgLVxyXG4vLyBuXHUwMEY2dGlnIGZcdTAwRkNyIEJlc3RhbmRzaW5zdGFsbGF0aW9uZW4sIGRlcmVuIGdlc3BlaWNoZXJ0ZSBnbG9iYWxQcm9wZXJ0eU9yZGVyXHJcbi8vIG5vY2ggYXVzIGRlciBaZWl0IHZvciBcIlRZUCBhbHMgTGlzdGVuZWludHJhZ1wiIGJ6dy4gdm9yIFNVQlRZUCBzdGFtbXQgKFRZUFxyXG4vLyB3YXIgZGF2b3IgaGFydC1jb2RpZXJ0IGltbWVyIGFuIGVyc3RlciBTdGVsbGUsIGthbSBpbiBkZXIgTGlzdGUgc2VsYnN0XHJcbi8vIG5pY2h0IHZvcikuIEZlaGxlbmRlIEVpbnRyXHUwMEU0Z2Ugd2VyZGVuIGFuIHNpbm52b2xsZXIgRGVmYXVsdC1Qb3NpdGlvbiBlcmdcdTAwRTRuenQsXHJcbi8vIHN0YXR0IGRpZSBiZXN0ZWhlbmRlLCB2b20gTnV0emVyIHBlciBEcmFnICYgRHJvcCBlaW5zb3J0aWVydGUgUmVpaGVuZm9sZ2VcclxuLy8gYW56dXRhc3Rlbi4gXCJzdWJ0eXBWYWx1ZVwiIGxhbmRldCBkYWJlaSBkaXJla3QgaGludGVyIFwidHlwVmFsdWVcIiAoZ2FyYW50aWVydFxyXG4vLyB6dSBkaWVzZW0gWmVpdHB1bmt0IHNjaG9uIHZvcmhhbmRlbiksIHN0YXR0IHdpZSBkaWUgXHUwMEZDYnJpZ2VuIFBsYXR6aGFsdGVyXHJcbi8vIHBhdXNjaGFsIGFuIGRlbiBSYW5kLlxyXG5mdW5jdGlvbiBub3JtYWxpemVHbG9iYWxPcmRlcihvcmRlcikge1xyXG4gIGNvbnN0IHJlc3VsdCA9IEFycmF5LmlzQXJyYXkob3JkZXIpID8gb3JkZXIuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkgJiYgdHlwZW9mIGVudHJ5ID09PSBcIm9iamVjdFwiKSA6IFtdO1xyXG4gIGNvbnN0IGhhc0tpbmQgPSAoa2luZCkgPT4gcmVzdWx0LnNvbWUoKGVudHJ5KSA9PiBlbnRyeS5raW5kID09PSBraW5kKTtcclxuICBpZiAoIWhhc0tpbmQoXCJ0eXBWYWx1ZVwiKSkgcmVzdWx0LnVuc2hpZnQoeyBraW5kOiBcInR5cFZhbHVlXCIgfSk7XHJcbiAgaWYgKCFoYXNLaW5kKFwic3VidHlwVmFsdWVcIikpIHtcclxuICAgIGNvbnN0IHR5cFZhbHVlSW5kZXggPSByZXN1bHQuZmluZEluZGV4KChlbnRyeSkgPT4gZW50cnkua2luZCA9PT0gXCJ0eXBWYWx1ZVwiKTtcclxuICAgIHJlc3VsdC5zcGxpY2UodHlwVmFsdWVJbmRleCArIDEsIDAsIHsga2luZDogXCJzdWJ0eXBWYWx1ZVwiIH0pO1xyXG4gIH1cclxuICBpZiAoIWhhc0tpbmQoXCJ0eXBcIikpIHJlc3VsdC5wdXNoKHsga2luZDogXCJ0eXBcIiB9KTtcclxuICBpZiAoIWhhc0tpbmQoXCJvdGhlclwiKSkgcmVzdWx0LnB1c2goeyBraW5kOiBcIm90aGVyXCIgfSk7XHJcbiAgcmV0dXJuIHJlc3VsdDtcclxufVxyXG5cclxuLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbiAqIEZyb250bWF0dGVyLVNvcnRpZXJ1bmdcclxuICogQnJpbmd0IGRpZSBpbiBlaW5lciBOb3RpeiBWT1JIQU5ERU5FTiBQcm9wZXJ0aWVzIGluIGVpbmUgZmVzdGVcclxuICogUmVpaGVuZm9sZ2UgLSB6dXNhbW1lbmdlc2V0enQgYXVzIChzaWVoZSBnbG9iYWxQcm9wZXJ0eU9yZGVyKTpcclxuICogIC0gZ2xvYmFsIGZlc3QgcG9zaXRpb25pZXJ0ZW4gRWluemVsLVByb3BlcnRpZXMgKHouIEIuIGNzc2NsYXNzZXMsXHJcbiAqICAgIGFsaWFzZXM7IEVpbnN0ZWxsdW5nZW4gLT4gVFlQIC0+IEdsb2JhbGUgUHJvcGVydHktUmVpaGVuZm9sZ2UpLFxyXG4gKiAgLSBkZXIgVFlQLVByb3BlcnR5IHNlbGJzdCxcclxuICogIC0gZGVyIFNVQlRZUC1Qcm9wZXJ0eSBzZWxic3QsXHJcbiAqICAtIGRlbSBCbG9jayBcIlRZUC1Gcm9udG1hdHRlclwiIChUWVAtRnJvbnRtYXR0ZXItTGlzdGUgZGVzXHJcbiAqICAgIGpld2VpbGlnZW4gVHlwcywgc2llaGUgdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMsIGdlZm9sZ3Qgdm9tXHJcbiAqICAgIEZyb250bWF0dGVyLUJsb2NrIHNlaW5lcyBTVUJUWVBzKSwgdW5kXHJcbiAqICAtIGRlbSBCbG9jayBcIlNvbnN0aWdlIFByb3BlcnRpZXNcIiAoYWxsZXMgXHUwMERDYnJpZ2UsIGluIGJpc2hlcmlnZXJcclxuICogICAgUmVpaGVuZm9sZ2UpLlxyXG4gKiBFcmdcdTAwRTRuenQgZGFiZWkga2VpbmUgZmVobGVuZGVuIFN0YW5kYXJkLVByb3BlcnRpZXMgdW5kIFx1MDBFNG5kZXJ0IGtlaW5lXHJcbiAqIFdlcnRlIC0gcmVpbmUgVW1zb3J0aWVydW5nIGRlciBiZXJlaXRzIHZvcmhhbmRlbmVuIFplaWxlbi5cclxuICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovXHJcblxyXG4vLyBTdGFuZGFyZC1Qcm9wZXJ0eS1SZWloZW5mb2xnZSBlaW5lcyBUeXBzLCBpbmtsLiBkZXIgZGFyaW4gYWxzIFwiRmxvYXRpbmdcclxuLy8gUHJvcGVydHlcIiBtYXJraWVydGVuIEtleXMgKHNpZWhlIHR5cGVGbG9hdGluZ0tleXMgaW4gc2V0dGluZ3MuanMpIGFuIGdlbmF1XHJcbi8vIGRlciBTdGVsbGUsIGFuIGRlciBzaWUgaW4gZGVyIExpc3RlIHN0ZWhlbiAtIG9obmUgVFlQIHNlbGJzdCAoZGFzIGlzdCBkb3J0XHJcbi8vIG51ciBhdXMgaGlzdG9yaXNjaGVuIEdyXHUwMEZDbmRlbiBldnRsLiBub2NoIGVudGhhbHRlbiwgc2llaGUgc3RyaXBUeXBQcm9wZXJ0eSlcclxuLy8gdW5kIG9obmUgZGllIGxlZXJlIFBsYXR6aGFsdGVyLVplaWxlIGRlcyBFZGl0b3JzIChcIlByb3BlcnR5IGhpbnp1Zlx1MDBGQ2dlblwiKS5cclxuLy8gRmxvYXRpbmcgUHJvcGVydGllcyB3ZXJkZW4gbnVyIG5pY2h0IGF1dG9tYXRpc2NoIHZvbiBnZXRUeXBlRGVmYXVsdHMoKVxyXG4vLyAobWFpbi5qcykgYW4gVGVtcGxhdGVyIGF1c2dlbGllZmVydCwgc29sbGVuIGFiZXIgdHJvdHpkZW0gYW4gaWhyZXJcclxuLy8gTGlzdGVucG9zaXRpb24gbGFuZGVuLCBzb2JhbGQgZWluZSBOb3RpeiBzaWUgZG9jaCB0clx1MDBFNGd0LiBudWxsLCB3ZW5uIGtlaW5cclxuLy8gVHlwIFx1MDBGQ2JlcmdlYmVuIHd1cmRlIG9kZXIgZlx1MDBGQ3IgZGVuIFR5cCBrZWluZSBTdGFuZGFyZGxpc3RlIGdlcGZsZWd0IGlzdC5cclxuLy9cclxuLy8gTWl0IHN1YnR5cGUgenVzXHUwMEU0dHpsaWNoIGRpZSBLZXlzIGF1cyBkZXNzZW4gRnJvbnRtYXR0ZXItQmxvY2sgKHNpZWhlXHJcbi8vIHN1YnR5cGVzLmpzKSAtIGRhaGludGVyLCBkYSBkYXMgVFlQLUZyb250bWF0dGVyIGltbWVyIG9iZW4gc3RlaHQuIEVpbiBLZXksXHJcbi8vIGRlciBpbiBCRUlERU4gQmxcdTAwRjZja2VuIHZvcmtvbW10LCBiZWhcdTAwRTRsdCBkaWUgUG9zaXRpb24gZGVzIFRZUC1Gcm9udG1hdHRlcnNcclxuLy8gKGRlciBTdWJ0eXAgc3RldWVydCBkb3J0IG51ciBXZXJ0IHVuZCBGbG9hdGluZy1NYXJraWVydW5nIGJlaSwgc2llaGVcclxuLy8gZ2V0VHlwZURlZmF1bHRzIGluIG1haW4uanMpIC0gZGVzaGFsYiBoaWVyIGJld3Vzc3QgXCJlcnN0ZSBQb3NpdGlvbiB6XHUwMEU0aGx0XCIuXHJcbmZ1bmN0aW9uIG9yZGVyZWREZWZhdWx0S2V5cyhwbHVnaW4sIHR5cGUsIHN1YnR5cGUgPSBudWxsKSB7XHJcbiAgaWYgKCF0eXBlKSByZXR1cm4gbnVsbDtcclxuICBjb25zdCBpc1N5c3RlbUtleSA9IChrZXkpID0+IGtleSA9PT0gXCJcIiB8fCBbVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFldLnNvbWUoKHApID0+IGtleS50b0xvd2VyQ2FzZSgpID09PSBwLnRvTG93ZXJDYXNlKCkpO1xyXG4gIGNvbnN0IHN1YnR5cGVEYXRhID0gc3VidHlwZSA/IGdldFN1YnR5cGUocGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKSA6IG51bGw7XHJcbiAgY29uc3QgYmxvY2tzID0gW3BsdWdpbi5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdLCBzdWJ0eXBlRGF0YT8uZnJvbnRtYXR0ZXJdO1xyXG4gIGNvbnN0IGtleXMgPSBbXTtcclxuICBjb25zdCBzZWVuID0gbmV3IFNldCgpO1xyXG4gIGZvciAoY29uc3QgYmxvY2sgb2YgYmxvY2tzKSB7XHJcbiAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhibG9jayA/PyB7fSkpIHtcclxuICAgICAgaWYgKGlzU3lzdGVtS2V5KGtleSkgfHwgc2Vlbi5oYXMoa2V5LnRvTG93ZXJDYXNlKCkpKSBjb250aW51ZTtcclxuICAgICAga2V5cy5wdXNoKGtleSk7XHJcbiAgICAgIHNlZW4uYWRkKGtleS50b0xvd2VyQ2FzZSgpKTtcclxuICAgIH1cclxuICB9XHJcbiAgcmV0dXJuIGtleXMubGVuZ3RoID4gMCA/IGtleXMgOiBudWxsO1xyXG59XHJcblxyXG4vLyBSZWloZW5mb2xnZSwgaW4gZGVyIGRpZSB2b3JoYW5kZW5lbiBQcm9wZXJ0aWVzIGVpbmVyIE5vdGl6IHN0ZWhlbiBzb2xsZW4gLVxyXG4vLyBiZXN0aW1tdCBrb21wbGV0dCBkdXJjaCBnbG9iYWxPcmRlcjogZWluemVsbmUgUHJvcGVydGllcyBhbiBmZXN0ZXJcclxuLy8gUG9zaXRpb24sIHNvd2llIGRpZSBQbGF0emhhbHRlciBcInR5cFZhbHVlXCIgKGRpZSBUWVAtUHJvcGVydHkgc2VsYnN0KSxcclxuLy8gXCJzdWJ0eXBWYWx1ZVwiIChkaWUgU1VCVFlQLVByb3BlcnR5IHNlbGJzdCksIFwidHlwXCIgKFN0YW5kYXJkbGlzdGUgZGVzIFR5cHMpXHJcbi8vIHVuZCBcIm90aGVyXCIgKGFsbGVzIFx1MDBEQ2JyaWdlKS5cclxuLy9cclxuLy8gV2VsY2hlciBCbG9jayBlaW5lIFByb3BlcnR5IGJlYW5zcHJ1Y2h0LCB3aXJkIFZPUiBkZW0gZWlnZW50bGljaGVuIEF1ZmJhdVxyXG4vLyBkZXIgUmVpaGVuZm9sZ2UgZmVzdHN0ZWhlbmQgYmVzdGltbXQgKHBpbm5lZC90eXBCbG9jay9SZXN0IHNpbmQgZGlzanVua3QpIC1cclxuLy8gbmljaHQgZXJzdCBiZWltIGxpbmVhcmVuIER1cmNobGF1ZiB2b24gZ2xvYmFsT3JkZXIuIERhcyBtYWNodCBkaWVcclxuLy8gQmxvY2stWnVvcmRudW5nIHVuYWJoXHUwMEU0bmdpZyBkYXZvbiwgaW4gd2VsY2hlciBSZWloZW5mb2xnZSBkaWUgQmxcdTAwRjZja2UgaW5cclxuLy8gZ2xvYmFsT3JkZXIgc3RlaGVuOiBlaW5lIGdsb2JhbCBmZXN0IHBvc2l0aW9uaWVydGUgUHJvcGVydHkgZ2VoXHUwMEY2cnQgaW1tZXIgenVcclxuLy8gaWhyZW0gZWlnZW5lbiBFaW50cmFnIChuaWUgenVzXHUwMEU0dHpsaWNoIHp1bSBUeXAtQmxvY2ssIHNlbGJzdCB3ZW5uIFwiVFlQXHJcbi8vIFByb3BlcnRpZXNcIiB2b3JoZXIgaW4gZGVyIExpc3RlIHN0ZWh0KSwgdW5kIFwiU29uc3RpZ2UgUHJvcGVydGllc1wiIGVudGhcdTAwRTRsdFxyXG4vLyBpbW1lciBudXIgZWNodGUgUmVzdGJlc3RcdTAwRTRuZGUgKG5pZSB2ZXJzZWhlbnRsaWNoIFByb3BlcnRpZXMsIGRpZSBlaWdlbnRsaWNoXHJcbi8vIGVpbmVtIHNwXHUwMEU0dGVyIGluIGRlciBMaXN0ZSBzdGVoZW5kZW4gQmxvY2sgZ2VoXHUwMEY2cmVuKS5cclxuZnVuY3Rpb24gY29tcHV0ZVNvcnRlZEtleXMoZXhpc3RpbmdLZXlzLCBnbG9iYWxPcmRlciwgdHlwZURlZmF1bHRLZXlzKSB7XHJcbiAgY29uc3QgbG93ZXJUb0FjdHVhbCA9IG5ldyBNYXAoZXhpc3RpbmdLZXlzLm1hcCgoa2V5KSA9PiBba2V5LnRvTG93ZXJDYXNlKCksIGtleV0pKTtcclxuICBjb25zdCByZXNvbHZlID0gKG5hbWUpID0+IGxvd2VyVG9BY3R1YWwuZ2V0KG5hbWUudG9Mb3dlckNhc2UoKSk7XHJcblxyXG4gIGNvbnN0IHBpbm5lZCA9IG5ldyBTZXQoXHJcbiAgICBnbG9iYWxPcmRlclxyXG4gICAgICAuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkua2luZCA9PT0gXCJwcm9wZXJ0eVwiKVxyXG4gICAgICAubWFwKChlbnRyeSkgPT4gcmVzb2x2ZShlbnRyeS5uYW1lKSlcclxuICAgICAgLmZpbHRlcihCb29sZWFuKVxyXG4gICk7XHJcbiAgY29uc3QgdHlwS2V5ID0gcmVzb2x2ZShUWVBfUFJPUEVSVFkpO1xyXG4gIGNvbnN0IHN1YnR5cEtleSA9IHJlc29sdmUoU1VCVFlQX1BST1BFUlRZKTtcclxuICBjb25zdCB0eXBCbG9ja0tleXMgPSBuZXcgU2V0KFxyXG4gICAgKHR5cGVEZWZhdWx0S2V5cyA/PyBbXSkubWFwKHJlc29sdmUpLmZpbHRlcigoa2V5KSA9PiBrZXkgJiYga2V5ICE9PSB0eXBLZXkgJiYgIXBpbm5lZC5oYXMoa2V5KSlcclxuICApO1xyXG4gIGNvbnN0IGNsYWltZWQgPSBuZXcgU2V0KHBpbm5lZCk7XHJcbiAgZm9yIChjb25zdCBrZXkgb2YgdHlwQmxvY2tLZXlzKSBjbGFpbWVkLmFkZChrZXkpO1xyXG4gIGlmICh0eXBLZXkpIGNsYWltZWQuYWRkKHR5cEtleSk7XHJcbiAgaWYgKHN1YnR5cEtleSkgY2xhaW1lZC5hZGQoc3VidHlwS2V5KTtcclxuXHJcbiAgY29uc3Qgc29ydGVkS2V5cyA9IFtdO1xyXG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0KCk7XHJcbiAgY29uc3QgcHVzaCA9IChrZXkpID0+IHtcclxuICAgIGlmIChrZXkgJiYgIXNlZW4uaGFzKGtleSkpIHtcclxuICAgICAgc29ydGVkS2V5cy5wdXNoKGtleSk7XHJcbiAgICAgIHNlZW4uYWRkKGtleSk7XHJcbiAgICB9XHJcbiAgfTtcclxuXHJcbiAgZm9yIChjb25zdCBlbnRyeSBvZiBnbG9iYWxPcmRlcikge1xyXG4gICAgaWYgKGVudHJ5LmtpbmQgPT09IFwicHJvcGVydHlcIikgcHVzaChyZXNvbHZlKGVudHJ5Lm5hbWUpKTtcclxuICAgIGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwidHlwVmFsdWVcIikgcHVzaCh0eXBLZXkpO1xyXG4gICAgZWxzZSBpZiAoZW50cnkua2luZCA9PT0gXCJzdWJ0eXBWYWx1ZVwiKSBwdXNoKHN1YnR5cEtleSk7XHJcbiAgICBlbHNlIGlmIChlbnRyeS5raW5kID09PSBcInR5cFwiKSB7XHJcbiAgICAgIGZvciAoY29uc3QgbmFtZSBvZiB0eXBlRGVmYXVsdEtleXMgPz8gW10pIHtcclxuICAgICAgICBjb25zdCBrZXkgPSByZXNvbHZlKG5hbWUpO1xyXG4gICAgICAgIGlmIChrZXkgJiYgdHlwQmxvY2tLZXlzLmhhcyhrZXkpKSBwdXNoKGtleSk7XHJcbiAgICAgIH1cclxuICAgIH0gZWxzZSBpZiAoZW50cnkua2luZCA9PT0gXCJvdGhlclwiKSB7XHJcbiAgICAgIGZvciAoY29uc3Qga2V5IG9mIGV4aXN0aW5nS2V5cykge1xyXG4gICAgICAgIGlmICghY2xhaW1lZC5oYXMoa2V5KSkgcHVzaChrZXkpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvLyBTaWNoZXJoZWl0c25ldHosIGZhbGxzIGdsb2JhbE9yZGVyIHVudm9sbHN0XHUwMEU0bmRpZyBpc3QgKHouIEIuIGtvcnJ1cHRlXHJcbiAgLy8gRWluc3RlbGx1bmdlbikgLSBkaWUgVUkgdmVyaGluZGVydCBkYXMgZWlnZW50bGljaCAoc2llaGUgbm9ybWFsaXplR2xvYmFsT3JkZXIpLlxyXG4gIGZvciAoY29uc3Qga2V5IG9mIGV4aXN0aW5nS2V5cykgcHVzaChrZXkpO1xyXG4gIHJldHVybiBzb3J0ZWRLZXlzO1xyXG59XHJcblxyXG4vLyBcInBvc2l0aW9uXCIgaXN0IGtlaW4gZWNodGVzIFByb3BlcnR5LCBzb25kZXJuIE9ic2lkaWFucyBlaWdlbmUgQW5nYWJlIHp1clxyXG4vLyBMYWdlIGRlcyBGcm9udG1hdHRlci1CbG9ja3MgaW5uZXJoYWxiIGRlciBEYXRlaSAobnVyIGltIENhY2hlLU9iamVrdFxyXG4vLyB2b3JoYW5kZW4sIG5pY2h0IGltIHZvbiBwcm9jZXNzRnJvbnRNYXR0ZXIgZ2VsaWVmZXJ0ZW4gT2JqZWt0KS5cclxuZnVuY3Rpb24gY2FjaGVkRnJvbnRtYXR0ZXJLZXlzKGFwcCwgZmlsZSkge1xyXG4gIGNvbnN0IGZyb250bWF0dGVyID0gYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlcjtcclxuICBpZiAoIWZyb250bWF0dGVyKSByZXR1cm4gbnVsbDtcclxuICByZXR1cm4gT2JqZWN0LmtleXMoZnJvbnRtYXR0ZXIpLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwicG9zaXRpb25cIik7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHNvcnRGaWxlRnJvbnRtYXR0ZXIoYXBwLCBmaWxlLCBnbG9iYWxPcmRlciwgdHlwZURlZmF1bHRLZXlzKSB7XHJcbiAgLy8gR1x1MDBGQ25zdGlnZXIgVm9yYWItQ2hlY2sgXHUwMEZDYmVyIGRlbiBiZXJlaXRzIGltIFNwZWljaGVyIHZvcmhhbmRlbmVuIE1ldGFkYXRhLVxyXG4gIC8vIENhY2hlIChrZWluIERhdGVpLVp1Z3JpZmYpOiBkZXIgTm9ybWFsZmFsbCAtIGVpbmUgTm90aXogaXN0IHNjaG9uIGtvcnJla3RcclxuICAvLyBzb3J0aWVydCAtIGxcdTAwRTRzc3Qgc2ljaCBzbyBlcmtlbm5lbiwgb2huZSBkaWUgRGF0ZWkgXHUwMEZDYmVyIHByb2Nlc3NGcm9udE1hdHRlclxyXG4gIC8vIFx1MDBGQ2JlcmhhdXB0IHp1IFx1MDBGNmZmbmVuLiBEYXMgaXN0IGJlaSB3aWVkZXJob2x0ZW4gTFx1MDBFNHVmZW4gXHUwMEZDYmVyIGRlbiBnYW56ZW5cclxuICAvLyBWYXVsdCBkZXIgTFx1MDBGNndlbmFudGVpbCBkZXIgTm90aXplbiB1bmQgZGFtaXQgZGVyIGVpZ2VudGxpY2hlIEdlc2Nod2luZGlnLVxyXG4gIC8vIGtlaXRzZ2V3aW5uLiBwcm9jZXNzRnJvbnRNYXR0ZXIgYmxlaWJ0IHRyb3R6ZGVtIGRpZSBhbGxlaW5pZ2UgUXVlbGxlIGRlclxyXG4gIC8vIFdhaHJoZWl0IGZcdTAwRkNyIGRlbiB0YXRzXHUwMEU0Y2hsaWNoZW4gU2NocmVpYnZvcmdhbmcgKENhY2hlIGthbm4ga3VyenplaXRpZ1xyXG4gIC8vIHZlcmFsdGV0IHNlaW4pIC0gZGVyIFZvcmFiLUNoZWNrIFx1MDBGQ2JlcnNwcmluZ3QgbnVyIHNpY2hlciB1bnZlclx1MDBFNG5kZXJ0ZSBGXHUwMEU0bGxlLlxyXG4gIGNvbnN0IGNhY2hlZEtleXMgPSBjYWNoZWRGcm9udG1hdHRlcktleXMoYXBwLCBmaWxlKTtcclxuICBpZiAoIWNhY2hlZEtleXMgfHwgY2FjaGVkS2V5cy5sZW5ndGggPD0gMSkgcmV0dXJuIGZhbHNlO1xyXG4gIGNvbnN0IGNhY2hlZFNvcnRlZCA9IGNvbXB1dGVTb3J0ZWRLZXlzKGNhY2hlZEtleXMsIGdsb2JhbE9yZGVyLCB0eXBlRGVmYXVsdEtleXMpO1xyXG4gIGlmIChjYWNoZWRTb3J0ZWQuZXZlcnkoKGtleSwgaSkgPT4ga2V5ID09PSBjYWNoZWRLZXlzW2ldKSkgcmV0dXJuIGZhbHNlO1xyXG5cclxuICBsZXQgY2hhbmdlZCA9IGZhbHNlO1xyXG4gIGF3YWl0IGFwcC5maWxlTWFuYWdlci5wcm9jZXNzRnJvbnRNYXR0ZXIoZmlsZSwgKGZyb250bWF0dGVyKSA9PiB7XHJcbiAgICBjaGFuZ2VkID0gc29ydEZyb250bWF0dGVyT2JqZWN0KGZyb250bWF0dGVyLCBnbG9iYWxPcmRlciwgdHlwZURlZmF1bHRLZXlzKTtcclxuICB9KTtcclxuICByZXR1cm4gY2hhbmdlZDtcclxufVxyXG5cclxuLy8gU29ydGllcnQgZGFzIHZvbiBwcm9jZXNzRnJvbnRNYXR0ZXIgZ2VsaWVmZXJ0ZSBPYmpla3QgaW4tcGxhY2UgKHNpZWhlXHJcbi8vIEtvbW1lbnRhciBpbiB0eXBlLWZyb250bWF0dGVyLWVkaXRvci5qcyB6dSBzYXZlRnJvbnRtYXR0ZXIvc3RyaXBUeXBQcm9wZXJ0eSk6XHJcbi8vIE9iamVrdC1JbnNlcnRpb24tT3JkZXIgYmVzdGltbXQgZGllIHNwXHUwMEU0dGVyZSBZQU1MLVJlaWhlbmZvbGdlLCBkYWhlciBhbGxlXHJcbi8vIEtleXMgbFx1MDBGNnNjaGVuIHVuZCBpbiBuZXVlciBSZWloZW5mb2xnZSB3aWVkZXIgZWluZlx1MDBGQ2dlbiwgc3RhdHQgZWluIG5ldWVzXHJcbi8vIE9iamVrdCB6dXJcdTAwRkNja3p1Z2ViZW4uIExpZWZlcnQgdHJ1ZSBiZWkgZWluZXIgXHUwMEM0bmRlcnVuZy5cclxuZnVuY3Rpb24gc29ydEZyb250bWF0dGVyT2JqZWN0KGZyb250bWF0dGVyLCBnbG9iYWxPcmRlciwgdHlwZURlZmF1bHRLZXlzKSB7XHJcbiAgY29uc3QgZXhpc3RpbmdLZXlzID0gT2JqZWN0LmtleXMoZnJvbnRtYXR0ZXIpO1xyXG4gIGlmIChleGlzdGluZ0tleXMubGVuZ3RoIDw9IDEpIHJldHVybiBmYWxzZTtcclxuXHJcbiAgY29uc3Qgc29ydGVkS2V5cyA9IGNvbXB1dGVTb3J0ZWRLZXlzKGV4aXN0aW5nS2V5cywgZ2xvYmFsT3JkZXIsIHR5cGVEZWZhdWx0S2V5cyk7XHJcbiAgaWYgKHNvcnRlZEtleXMuZXZlcnkoKGtleSwgaSkgPT4ga2V5ID09PSBleGlzdGluZ0tleXNbaV0pKSByZXR1cm4gZmFsc2U7XHJcblxyXG4gIGNvbnN0IHNuYXBzaG90ID0geyAuLi5mcm9udG1hdHRlciB9O1xyXG4gIGZvciAoY29uc3Qga2V5IG9mIGV4aXN0aW5nS2V5cykgZGVsZXRlIGZyb250bWF0dGVyW2tleV07XHJcbiAgZm9yIChjb25zdCBrZXkgb2Ygc29ydGVkS2V5cykgZnJvbnRtYXR0ZXJba2V5XSA9IHNuYXBzaG90W2tleV07XHJcbiAgcmV0dXJuIHRydWU7XHJcbn1cclxuXHJcbi8vIEZcdTAwRkNyIEF1ZnJ1ZmVyLCBkaWUgb2huZWhpbiBnZXJhZGUgaW4gcHJvY2Vzc0Zyb250TWF0dGVyIHNjaHJlaWJlbiAoei4gQi5cclxuLy8gYXBwbHlUeXBlUHJvcGVydGllcy9fb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzKTogc29ydGllcnQgZGFzXHJcbi8vIE9iamVrdCBkaXJla3QgbWl0IGF1c2RyXHUwMEZDY2tsaWNoIFx1MDBGQ2JlcmdlYmVuZW0gVFlQL1N1YnR5cCAtIGRlciBJbmRleCBiencuXHJcbi8vIE1ldGFkYXRhLUNhY2hlIGtlbm50IGRpZSBnZXJhZGUgZ2VzY2hyaWViZW5lbiBXZXJ0ZSB6dSBkaWVzZW0gWmVpdHB1bmt0XHJcbi8vIG5vY2ggbmljaHQuXHJcbmZ1bmN0aW9uIHNvcnRGcm9udG1hdHRlckZvcihwbHVnaW4sIGZyb250bWF0dGVyLCB0eXBlLCBzdWJ0eXBlKSB7XHJcbiAgY29uc3QgZ2xvYmFsT3JkZXIgPSBub3JtYWxpemVHbG9iYWxPcmRlcihwbHVnaW4uc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcik7XHJcbiAgcmV0dXJuIHNvcnRGcm9udG1hdHRlck9iamVjdChmcm9udG1hdHRlciwgZ2xvYmFsT3JkZXIsIG9yZGVyZWREZWZhdWx0S2V5cyhwbHVnaW4sIHR5cGUsIHN1YnR5cGUpKTtcclxufVxyXG5cclxuLy8gU2V0enQgbnVyIGRpZSBlaW5lIFByb3BlcnR5IGtleSBhbiBpaHJlbiBQbGF0eiBsYXV0IEZyb250bWF0dGVyLVNvcnRpZXJ1bmcsXHJcbi8vIGFsbGUgXHUwMEZDYnJpZ2VuIGJsZWliZW4gaW4gaWhyZXIgYmlzaGVyaWdlbiBSZWloZW5mb2xnZSAtIGZcdTAwRkNyIEF1ZnJ1ZmVyLCBkaWVcclxuLy8gZ2VyYWRlIGVpbmUgUHJvcGVydHkgbmV1IGFuZ2VsZWd0IGhhYmVuICh6LiBCLiBGcmVkcyBQcm9wZXJ0eS1CYWNrbGlua2luZyksXHJcbi8vIGRpZSBzb25zdCBhbSBFbmRlIGxhbmRlbiB3XHUwMEZDcmRlLCBvaG5lIGRhZlx1MDBGQ3IgZ2xlaWNoIGRhcyBnYW56ZSwgZXZ0bC4gYmV3dXNzdFxyXG4vLyBhbmRlcnMgc29ydGllcnRlIEZyb250bWF0dGVyIHVtenVzdGVsbGVuLiBUWVAvU1VCVFlQIHdlcmRlbiBhdXMgZGVtXHJcbi8vIFx1MDBGQ2JlcmdlYmVuZW4gT2JqZWt0IGdlbGVzZW4sIG5pY2h0IGF1cyBJbmRleC9DYWNoZSAoZGllIGtlbm5lbiBpbm5lcmhhbGIgdm9uXHJcbi8vIHByb2Nlc3NGcm9udE1hdHRlciBldnRsLiBub2NoIGVpbmVuIFx1MDBFNGx0ZXJlbiBTdGFuZCkuXHJcbi8vXHJcbi8vIFBsYXR6ID0gZGlyZWt0IGhpbnRlciBkZW0gblx1MDBFNGNoc3RlbiBWb3JnXHUwMEU0bmdlciwgZGVuIGtleSBpbiBkZXIgdm9sbHN0XHUwMEU0bmRpZ1xyXG4vLyBzb3J0aWVydGVuIFJlaWhlbmZvbGdlIGhcdTAwRTR0dGUgKGdhbnogbmFjaCB2b3JuLCB3ZW5uIGVzIGtlaW5lbiBnaWJ0KS4gTGllZmVydFxyXG4vLyB0cnVlIGJlaSBlaW5lciBcdTAwQzRuZGVydW5nLlxyXG5mdW5jdGlvbiBwbGFjZVByb3BlcnR5Rm9yKHBsdWdpbiwgZnJvbnRtYXR0ZXIsIGtleSkge1xyXG4gIGNvbnN0IGV4aXN0aW5nS2V5cyA9IE9iamVjdC5rZXlzKGZyb250bWF0dGVyKTtcclxuICBjb25zdCBhY3R1YWxLZXkgPSBleGlzdGluZ0tleXMuZmluZCgoaykgPT4gay50b0xvd2VyQ2FzZSgpID09PSBrZXkudG9Mb3dlckNhc2UoKSk7XHJcbiAgaWYgKCFhY3R1YWxLZXkgfHwgZXhpc3RpbmdLZXlzLmxlbmd0aCA8PSAxKSByZXR1cm4gZmFsc2U7XHJcblxyXG4gIGNvbnN0IGdsb2JhbE9yZGVyID0gbm9ybWFsaXplR2xvYmFsT3JkZXIocGx1Z2luLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIpO1xyXG4gIGNvbnN0IHR5cGUgPSB0eXBlS2V5T2YocHJvcGVydHlWYWx1ZShmcm9udG1hdHRlciwgVFlQX1BST1BFUlRZKSk7XHJcbiAgY29uc3Qgc3VidHlwZSA9IHR5cGVLZXlPZihwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBTVUJUWVBfUFJPUEVSVFkpKTtcclxuICBjb25zdCBzb3J0ZWRLZXlzID0gY29tcHV0ZVNvcnRlZEtleXMoZXhpc3RpbmdLZXlzLCBnbG9iYWxPcmRlciwgb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgdHlwZSwgc3VidHlwZSkpO1xyXG5cclxuICBjb25zdCByZXN0ID0gZXhpc3RpbmdLZXlzLmZpbHRlcigoaykgPT4gayAhPT0gYWN0dWFsS2V5KTtcclxuICBjb25zdCBwcmVkZWNlc3NvciA9IHNvcnRlZEtleXMuc2xpY2UoMCwgc29ydGVkS2V5cy5pbmRleE9mKGFjdHVhbEtleSkpLnBvcCgpO1xyXG4gIGNvbnN0IG5ld0tleXMgPSBbLi4ucmVzdF07XHJcbiAgbmV3S2V5cy5zcGxpY2UocHJlZGVjZXNzb3IgPT09IHVuZGVmaW5lZCA/IDAgOiByZXN0LmluZGV4T2YocHJlZGVjZXNzb3IpICsgMSwgMCwgYWN0dWFsS2V5KTtcclxuICBpZiAobmV3S2V5cy5ldmVyeSgoaywgaSkgPT4gayA9PT0gZXhpc3RpbmdLZXlzW2ldKSkgcmV0dXJuIGZhbHNlO1xyXG5cclxuICBjb25zdCBzbmFwc2hvdCA9IHsgLi4uZnJvbnRtYXR0ZXIgfTtcclxuICBmb3IgKGNvbnN0IGsgb2YgZXhpc3RpbmdLZXlzKSBkZWxldGUgZnJvbnRtYXR0ZXJba107XHJcbiAgZm9yIChjb25zdCBrIG9mIG5ld0tleXMpIGZyb250bWF0dGVyW2tdID0gc25hcHNob3Rba107XHJcbiAgcmV0dXJuIHRydWU7XHJcbn1cclxuXHJcbi8vIFNvcnRpZXJ0IGVpbmUgZWluemVsbmUsIGJlcmVpdHMgYmVrYW5udGUgTm90aXogKHouIEIuIGRpZSBha3RpdmUgRGF0ZWkpLlxyXG5hc3luYyBmdW5jdGlvbiBzb3J0U2luZ2xlRmlsZUZyb250bWF0dGVyKGFwcCwgcGx1Z2luLCBmaWxlKSB7XHJcbiAgY29uc3QgZ2xvYmFsT3JkZXIgPSBub3JtYWxpemVHbG9iYWxPcmRlcihwbHVnaW4uc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcik7XHJcbiAgLy8gVW5zYXViZXJlIFRZUC1XZXJ0ZSAoTGlzdGUsIFJhbmRsZWVyemVpY2hlbikgaGFiZW4ga2VpbmUgU3RhbmRhcmRsaXN0ZSAtXHJcbiAgLy8gZGFubiBncmVpZnQgbnVyIGRpZSBnbG9iYWxlIFJlaWhlbmZvbGdlIChzaWVoZSB0eXBlS2V5T2YgaW4gdHlwLWluZGV4LmpzKS5cclxuICBjb25zdCB0eXBlID0gcGx1Z2luLnR5cEluZGV4LnR5cGVPZihmaWxlKTtcclxuICBjb25zdCB0eXBlRGVmYXVsdEtleXMgPSBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCB0eXBlLCBwbHVnaW4udHlwSW5kZXguc3VidHlwZU9mKGZpbGUpKTtcclxuICByZXR1cm4gc29ydEZpbGVGcm9udG1hdHRlcihhcHAsIGZpbGUsIGdsb2JhbE9yZGVyLCB0eXBlRGVmYXVsdEtleXMpO1xyXG59XHJcblxyXG4vLyBvbmx5VHlwZTogb3B0aW9uYWwgLSBiZXNjaHJcdTAwRTRua3QgZGVuIExhdWYgYXVmIE5vdGl6ZW4gZ2VuYXUgZGllc2VzIFR5cHMuXHJcbi8vIE9obmUgb25seVR5cGUgd2VyZGVuIGFsbGUgTm90aXplbiBnZXByXHUwMEZDZnQsIGF1Y2ggb2huZSBUWVAgb2RlciBtaXQgZWluZW0gVHlwXHJcbi8vIG9obmUgZ2VwZmxlZ3RlIFN0YW5kYXJkbGlzdGUgLSBkaWUgZ2xvYmFsIGZlc3QgcG9zaXRpb25pZXJ0ZW4gUHJvcGVydGllc1xyXG4vLyAoei4gQi4gY3NzY2xhc3Nlcykgc29sbGVuIHVuYWJoXHUwMEU0bmdpZyB2b20gVHlwIHdpcmtlbiBrXHUwMEY2bm5lbi4gRlx1MDBGQ3IgTm90aXplbiwgYmVpXHJcbi8vIGRlbmVuIHdlZGVyIGVpbiBwYXNzZW5kZXIgVHlwLUJsb2NrIG5vY2ggZWluZSBkZXIga29uZmlndXJpZXJ0ZW5cclxuLy8gRWluemVsLVByb3BlcnRpZXMgZ3JlaWZ0LCBibGVpYnQgZGllIGJpc2hlcmlnZSBSZWloZW5mb2xnZSB1bnZlclx1MDBFNG5kZXJ0LlxyXG5hc3luYyBmdW5jdGlvbiBzb3J0QWxsRnJvbnRtYXR0ZXIoYXBwLCBwbHVnaW4sIG9ubHlUeXBlKSB7XHJcbiAgbGV0IGNoZWNrZWQgPSAwO1xyXG4gIGxldCBjaGFuZ2VkID0gMDtcclxuICBjb25zdCBnbG9iYWxPcmRlciA9IG5vcm1hbGl6ZUdsb2JhbE9yZGVyKHBsdWdpbi5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyKTtcclxuICAvLyBOdXIgYXVzc2FnZWtyXHUwMEU0ZnRpZywgd2VubiBlaW4gZWluemVsbmVyIFR5cCBlaW5nZWdyZW56dCB3dXJkZSAoc29uc3RcclxuICAvLyB3ZWNoc2VsdCBkZXIgVHlwIHZvbiBEYXRlaSB6dSBEYXRlaSkgLSBmXHUwMEZDciBkaWUgUlx1MDBGQ2NrbWVsZHVuZyBkZXMgQmVmZWhsc1xyXG4gIC8vIFwiVFlQIEZyb250bWF0dGVyIFNvcnRpZXJ1bmcgYWt0dWFsaXNpZXJlblwiLCBmYWxscyBmXHUwMEZDciBkZW4gZ2V3XHUwMEU0aGx0ZW4gVHlwXHJcbiAgLy8gZ2FyIGtlaW5lIFRZUC1Gcm9udG1hdHRlci1MaXN0ZSBnZXBmbGVndCBpc3QuXHJcbiAgY29uc3QgaGFzVHlwZURlZmF1bHRzID0gb25seVR5cGUgPyBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCBvbmx5VHlwZSkgIT09IG51bGwgOiBudWxsO1xyXG5cclxuICBmb3IgKGNvbnN0IGZpbGUgb2YgYXBwLnZhdWx0LmdldE1hcmtkb3duRmlsZXMoKSkge1xyXG4gICAgaWYgKCFwbHVnaW4uc2V0dGluZ3MuaW5jbHVkZUlnbm9yZWRGaWxlcyAmJiBhcHAubWV0YWRhdGFDYWNoZS5pc1VzZXJJZ25vcmVkKGZpbGUucGF0aCkpIGNvbnRpbnVlO1xyXG5cclxuICAgIGNvbnN0IHR5cGUgPSBwbHVnaW4udHlwSW5kZXgudHlwZU9mKGZpbGUpO1xyXG4gICAgaWYgKG9ubHlUeXBlICYmIHR5cGUgIT09IG9ubHlUeXBlKSBjb250aW51ZTtcclxuXHJcbiAgICBjb25zdCB0eXBlRGVmYXVsdEtleXMgPSBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCB0eXBlLCBwbHVnaW4udHlwSW5kZXguc3VidHlwZU9mKGZpbGUpKTtcclxuICAgIGNoZWNrZWQrKztcclxuICAgIGlmIChhd2FpdCBzb3J0RmlsZUZyb250bWF0dGVyKGFwcCwgZmlsZSwgZ2xvYmFsT3JkZXIsIHR5cGVEZWZhdWx0S2V5cykpIGNoYW5nZWQrKztcclxuICB9XHJcblxyXG4gIHJldHVybiB7IGNoZWNrZWQsIGNoYW5nZWQsIGhhc1R5cGVEZWZhdWx0cyB9O1xyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IHtcclxuICBzb3J0QWxsRnJvbnRtYXR0ZXIsXHJcbiAgc29ydFNpbmdsZUZpbGVGcm9udG1hdHRlcixcclxuICBzb3J0RnJvbnRtYXR0ZXJGb3IsXHJcbiAgcGxhY2VQcm9wZXJ0eUZvcixcclxuICBub3JtYWxpemVHbG9iYWxPcmRlcixcclxuICBERUZBVUxUX0dMT0JBTF9PUkRFUixcclxuICBUWVBfUFJPUEVSVFksXHJcbiAgU1VCVFlQX1BST1BFUlRZLFxyXG59O1xyXG4iLCAiY29uc3QgeyBzZXRJY29uLCBOb3RpY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFksIHNvcnRBbGxGcm9udG1hdHRlciB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItc29ydFwiKTtcblxuLy8gQW56ZWlnZXRleHQgZGVyIHZpZXIgbmljaHQgZW50ZmVybmJhcmVuIFBsYXR6aGFsdGVyLVplaWxlbiAtIFwidHlwVmFsdWVcIiBpc3Rcbi8vIGRpZSBUWVAtUHJvcGVydHkgc2VsYnN0LCBcInN1YnR5cFZhbHVlXCIgYW5hbG9nIGRpZSBTVUJUWVAtUHJvcGVydHksIFwidHlwXCJcbi8vIGRpZSBUWVAtRnJvbnRtYXR0ZXItTGlzdGUgZGVzIFRZUHMgKHNpZWhlXG4vLyB0eXBlLWZyb250bWF0dGVyLWVkaXRvci5qcyksIFwib3RoZXJcIiBhbGxlIFByb3BlcnRpZXMsIGRpZSB3ZWRlciBkb3J0IG5vY2hcbi8vIGluIGRpZXNlciBMaXN0ZSBuYW1lbnRsaWNoIGdlZlx1MDBGQ2hydCB3ZXJkZW4uIFNpZWhlIGNvbXB1dGVTb3J0ZWRLZXlzIGluXG4vLyBmcm9udG1hdHRlci1zb3J0LmpzIGZcdTAwRkNyIGRpZSB0YXRzXHUwMEU0Y2hsaWNoZSBBdWZsXHUwMEY2c3VuZyBkaWVzZXIgQmxcdTAwRjZja2UuXG5jb25zdCBQTEFDRUhPTERFUl9MQUJFTFMgPSB7XG4gIHR5cFZhbHVlOiBcIlRZUFwiLFxuICBzdWJ0eXBWYWx1ZTogXCJTVUJUWVBcIixcbiAgdHlwOiBcIlRZUC1Gcm9udG1hdHRlclwiLFxuICBvdGhlcjogXCJTb25zdGlnZSBQcm9wZXJ0aWVzXCIsXG59O1xuXG4vLyBFZGl0b3IgZlx1MDBGQ3IgcGx1Z2luLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXI6IGVpbmUgcmVpbmUgTmFtZW5zbGlzdGVcbi8vIChrZWluZSBXZXJ0ZSwgZGFoZXIga2VpbiBlaWdlbmVyIHByaXZhdGUtQVBJLVVtd2VnIFx1MDBGQ2JlciBPYnNpZGlhbnNcbi8vIE1ldGFkYXRhLUVkaXRvci1XaWRnZXQgd2llIGluIHR5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzIG5cdTAwRjZ0aWcpIG1pdFxuLy8gRHJhZy1hbmQtZHJvcC1Tb3J0aWVydW5nLiBEaWUgZHJlaSBQbGF0emhhbHRlci1aZWlsZW4gc2luZCBUZWlsIGRlcnNlbGJlblxuLy8gTGlzdGUsIGxhc3NlbiBzaWNoIHZlcnNjaGllYmVuLCBhYmVyIG5pY2h0IHBlciBVSSBlbnRmZXJuZW4uXG5mdW5jdGlvbiBtb3VudEdsb2JhbE9yZGVyRWRpdG9yKGNvbnRhaW5lckVsLCBwbHVnaW4pIHtcbiAgY29uc3QgaGVhZGVyID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLWhlYWRlclwiIH0pO1xuXG4gIC8vIEVpZ2VuZSBHcnVwcGUgZlx1MDBGQ3IgQnV0dG9uICsgXHUwMERDYmVyc2NocmlmdCwgc3RhdHQgYmVpZGUgYWxzIGdldHJlbm50ZSBLaW5kZXJcbiAgLy8gdm9uIGhlYWRlciBkaXJla3Q6IGJlaSBqdXN0aWZ5LWNvbnRlbnQ6IHNwYWNlLWJldHdlZW4gKHNpZWhlIENTUykgd1x1MDBGQ3JkZVxuICAvLyBlaW4gZHJpdHRlcyBLaW5kIHp3aXNjaGVuIFx1MDBEQ2JlcnNjaHJpZnQgdW5kIFwiK1wiLUJ1dHRvbiBzb25zdCBtaXR0aWcgaW1cbiAgLy8gdmVyYmxlaWJlbmRlbiBQbGF0eiBsYW5kZW4sIHN0YXR0IGRpcmVrdCBuZWJlbiBkZXIgXHUwMERDYmVyc2NocmlmdCB6dSBzaXR6ZW4uXG4gIGNvbnN0IHRpdGxlR3JvdXAgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLXRpdGxlLWdyb3VwXCIgfSk7XG5cbiAgLy8gV2VuZGV0IGRpZSBha3R1ZWxsZSBSZWloZW5mb2xnZSBzb2ZvcnQgYXVmIGRlbiBnZXNhbXRlbiBWYXVsdCBhbiAtIGRlcnNlbGJlXG4gIC8vIExhdWYgd2llIGRlciBCZWZlaGwgXCJGcm9udG1hdHRlciBTb3J0aWVydW5nIEdMT0JBTCBha3R1YWxpc2llcmVuXCJcbiAgLy8gKHNvcnRBbGxGcm9udG1hdHRlciBtaXQgb25seVR5cGUgbnVsbCksIG51ciBkaXJla3QgbmViZW4gZGVyIExpc3RlXG4gIC8vIGVycmVpY2hiYXIgc3RhdHQgXHUwMEZDYmVyIGRpZSBCZWZlaGxzcGFsZXR0ZS5cbiAgY29uc3QgYXBwbHlCdG4gPSB0aXRsZUdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvblwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkF1ZiBhbGxlIE5vdGl6ZW4gYW53ZW5kZW5cIiB9IH0pO1xuICBzZXRJY29uKGFwcGx5QnRuLCBcInBsYXlcIik7XG4gIGFwcGx5QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHsgY2hlY2tlZCwgY2hhbmdlZCB9ID0gYXdhaXQgc29ydEFsbEZyb250bWF0dGVyKHBsdWdpbi5hcHAsIHBsdWdpbiwgbnVsbCk7XG4gICAgICBuZXcgTm90aWNlKFxuICAgICAgICBjaGFuZ2VkID4gMFxuICAgICAgICAgID8gYEZyb250bWF0dGVyIFNvcnRpZXJ1bmc6ICR7Y2hlY2tlZH0gTm90aXplbiBnZXByXHUwMEZDZnQsICR7Y2hhbmdlZH0gc29ydGllcnQuYFxuICAgICAgICAgIDogYEZyb250bWF0dGVyIFNvcnRpZXJ1bmc6ICR7Y2hlY2tlZH0gTm90aXplbiBnZXByXHUwMEZDZnQsIGJlcmVpdHMgYWxsZSBzb3J0aWVydC5gXG4gICAgICApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiW0Zyb250bWF0dGVyIFNvcnRpZXJ1bmddXCIsIGVycm9yKTtcbiAgICAgIG5ldyBOb3RpY2UoYEZyb250bWF0dGVyIFNvcnRpZXJ1bmcgZmVobGdlc2NobGFnZW46ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICB9XG4gIH0pO1xuXG4gIHRpdGxlR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIsIHRleHQ6IFwiR2xvYmFsZSBQcm9wZXJ0eS1SZWloZW5mb2xnZVwiIH0pO1xuXG4gIGNvbnN0IGFkZEJ0biA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb25cIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJQcm9wZXJ0eSBoaW56dWZcdTAwRkNnZW5cIiB9IH0pO1xuICBzZXRJY29uKGFkZEJ0biwgXCJwbHVzXCIpO1xuXG4gIGNvbnN0IGxpc3RFbCA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLW9yZGVyLWxpc3RcIiB9KTtcblxuICBjb25zdCBvcmRlciA9ICgpID0+IHBsdWdpbi5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyO1xuXG4gIC8vIE5ldWUgWmVpbGUgd2lyZCBlcnN0IGJlaSBlaW5lbSBnXHUwMEZDbHRpZ2VuLCBuaWNodC1sZWVyZW4gTmFtZW4gdGF0c1x1MDBFNGNobGljaCBpblxuICAvLyBwbHVnaW4uc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlciBhdWZnZW5vbW1lbiAodW5kIGRhbWl0IHBvdGVuemllbGxcbiAgLy8gZ2VzcGVpY2hlcnQpIC0gYmlzIGRhaGluIGV4aXN0aWVydCBzaWUgbnVyIGFscyBsb2thbGVyIEVudHd1cmYsIGRlciBiZWltXG4gIC8vIFJlLVJlbmRlciB6dXNcdTAwRTR0emxpY2ggYW5zIEVuZGUgZGVyIGVjaHRlbiBMaXN0ZSBnZWhcdTAwRTRuZ3Qgd2lyZC4gU28gbGFuZGVuXG4gIC8vIGxlZXJlIFByb3BlcnR5LUZlbGRlciBuaWUgaW4gZGVuIEVpbnN0ZWxsdW5nZW4sIHNlbGJzdCB3ZW5uIHp3aXNjaGVuZHVyY2hcbiAgLy8gYXVzIGFuZGVyZW0gQW5sYXNzICh6LiBCLiBWZXJzY2hpZWJlbiBlaW5lciBhbmRlcmVuIFplaWxlKSBnZXNwZWljaGVydCB3aXJkLlxuICBsZXQgZHJhZnRFbnRyeSA9IG51bGw7XG5cbiAgY29uc3QgaXNEdXBsaWNhdGVOYW1lID0gKHZhbHVlLCBvd25FbnRyeSkgPT4ge1xuICAgIGNvbnN0IGxvd2VyID0gdmFsdWUudG9Mb3dlckNhc2UoKTtcbiAgICBpZiAobG93ZXIgPT09IFRZUF9QUk9QRVJUWS50b0xvd2VyQ2FzZSgpIHx8IGxvd2VyID09PSBTVUJUWVBfUFJPUEVSVFkudG9Mb3dlckNhc2UoKSkgcmV0dXJuIHRydWU7XG4gICAgcmV0dXJuIG9yZGVyKCkuc29tZSgob3RoZXIpID0+IG90aGVyICE9PSBvd25FbnRyeSAmJiBvdGhlci5raW5kID09PSBcInByb3BlcnR5XCIgJiYgb3RoZXIubmFtZS50b0xvd2VyQ2FzZSgpID09PSBsb3dlcik7XG4gIH07XG5cbiAgY29uc3QgcmVuZGVyID0gKCkgPT4ge1xuICAgIGxpc3RFbC5lbXB0eSgpO1xuICAgIGNvbnN0IGVudHJpZXMgPSBkcmFmdEVudHJ5ID8gWy4uLm9yZGVyKCksIGRyYWZ0RW50cnldIDogb3JkZXIoKTtcblxuICAgIGVudHJpZXMuZm9yRWFjaCgoZW50cnksIGluZGV4KSA9PiB7XG4gICAgICBjb25zdCBpc0RyYWZ0ID0gZW50cnkgPT09IGRyYWZ0RW50cnk7XG4gICAgICBjb25zdCBpc1BsYWNlaG9sZGVyID0gZW50cnkua2luZCAhPT0gXCJwcm9wZXJ0eVwiO1xuICAgICAgY29uc3Qgcm93Q2xzID1cbiAgICAgICAgXCJmcmVkLW9yZGVyLXJvd1wiICsgKGlzUGxhY2Vob2xkZXIgPyBcIiBpcy1wbGFjZWhvbGRlclwiIDogXCJcIikgKyAoZW50cnkua2luZCA9PT0gXCJ0eXBcIiA/IFwiIGlzLXR5cC1kZWZhdWx0c1wiIDogXCJcIik7XG4gICAgICBjb25zdCByb3cgPSBsaXN0RWwuY3JlYXRlRGl2KHsgY2xzOiByb3dDbHMgfSk7XG5cbiAgICAgIGNvbnN0IGRyYWdIYW5kbGUgPSByb3cuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtb3JkZXItZHJhZ1wiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlZlcnNjaGllYmVuXCIgfSB9KTtcbiAgICAgIHNldEljb24oZHJhZ0hhbmRsZSwgXCJncmlwLXZlcnRpY2FsXCIpO1xuXG4gICAgICBpZiAoaXNQbGFjZWhvbGRlcikge1xuICAgICAgICByb3cuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtb3JkZXItbGFiZWxcIiwgdGV4dDogUExBQ0VIT0xERVJfTEFCRUxTW2VudHJ5LmtpbmRdIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgaW5wdXQgPSByb3cuY3JlYXRlRWwoXCJpbnB1dFwiLCB7XG4gICAgICAgICAgdHlwZTogXCJ0ZXh0XCIsXG4gICAgICAgICAgY2xzOiBcImZyZWQtb3JkZXItbmFtZS1pbnB1dFwiLFxuICAgICAgICAgIGF0dHI6IHsgcGxhY2Vob2xkZXI6IFwiUHJvcGVydHktTmFtZVwiIH0sXG4gICAgICAgIH0pO1xuICAgICAgICBpbnB1dC52YWx1ZSA9IGVudHJ5Lm5hbWU7XG5cbiAgICAgICAgLy8gXCJibHVyXCIgc3RhdHQgXCJjaGFuZ2VcIjogTGV0enRlcmVzIGZldWVydCBiZWkgZWluZW0gbGVlciBnZWJsaWViZW5lblxuICAgICAgICAvLyBGZWxkIGdhciBuaWNodCBlcnN0IChCcm93c2VyIHNlaGVuIGRhcmluIGtlaW5lIFdlcnRcdTAwRTRuZGVydW5nKSAtIGRlclxuICAgICAgICAvLyBFbnR3dXJmIHdcdTAwRkNyZGUgZGFubiBuaWUgYXVmZ2VyXHUwMEU0dW10LiBcImJsdXJcIiBncmVpZnQgenV2ZXJsXHUwMEU0c3NpZyBpblxuICAgICAgICAvLyBiZWlkZW4gRlx1MDBFNGxsZW4gKHVtYmVuZW5uZW4gd2llIGxlZXIgbGFzc2VuKS5cbiAgICAgICAgaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImJsdXJcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IHZhbHVlID0gaW5wdXQudmFsdWUudHJpbSgpO1xuXG4gICAgICAgICAgaWYgKCF2YWx1ZSkge1xuICAgICAgICAgICAgaWYgKGlzRHJhZnQpIHtcbiAgICAgICAgICAgICAgZHJhZnRFbnRyeSA9IG51bGw7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBvcmRlcigpLnNwbGljZShvcmRlcigpLmluZGV4T2YoZW50cnkpLCAxKTtcbiAgICAgICAgICAgICAgYXdhaXQgcGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVuZGVyKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGlzRHVwbGljYXRlTmFtZSh2YWx1ZSwgaXNEcmFmdCA/IG51bGwgOiBlbnRyeSkpIHtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoYFwiJHt2YWx1ZX1cIiBpc3QgYmVyZWl0cyBpbiBkZXIgTGlzdGUuYCk7XG4gICAgICAgICAgICBpbnB1dC52YWx1ZSA9IGVudHJ5Lm5hbWU7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZW50cnkubmFtZSA9IHZhbHVlO1xuICAgICAgICAgIGlmIChpc0RyYWZ0KSB7XG4gICAgICAgICAgICBvcmRlcigpLnB1c2goZW50cnkpO1xuICAgICAgICAgICAgZHJhZnRFbnRyeSA9IG51bGw7XG4gICAgICAgICAgfVxuICAgICAgICAgIGF3YWl0IHBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICByZW5kZXIoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgcmVtb3ZlQnRuID0gcm93LmNyZWF0ZURpdih7IGNsczogXCJmcmVkLW9yZGVyLXJlbW92ZSBjbGlja2FibGUtaWNvblwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkVudGZlcm5lblwiIH0gfSk7XG4gICAgICAgIHNldEljb24ocmVtb3ZlQnRuLCBcInhcIik7XG4gICAgICAgIHJlbW92ZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGlmIChpc0RyYWZ0KSB7XG4gICAgICAgICAgICBkcmFmdEVudHJ5ID0gbnVsbDtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgb3JkZXIoKS5zcGxpY2Uob3JkZXIoKS5pbmRleE9mKGVudHJ5KSwgMSk7XG4gICAgICAgICAgICBhd2FpdCBwbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJlbmRlcigpO1xuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgLy8gRGVyIEVudHd1cmYgaGF0IG5vY2gga2VpbmVuIFBsYXR6IGluIGRlciBlY2h0ZW4gTGlzdGUgLSBWZXJzY2hpZWJlblxuICAgICAgLy8gZXJnaWJ0IGZcdTAwRkNyIGlobiBrZWluZW4gU2lubiwgYmV2b3IgZXIgXHUwMEZDYmVyaGF1cHQgZWluZW4gTmFtZW4gaGF0LlxuICAgICAgaWYgKGlzRHJhZnQpIHJldHVybjtcblxuICAgICAgcm93LmRyYWdnYWJsZSA9IHRydWU7XG4gICAgICByb3cuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdzdGFydFwiLCAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQuZGF0YVRyYW5zZmVyLmVmZmVjdEFsbG93ZWQgPSBcIm1vdmVcIjtcbiAgICAgICAgZXZlbnQuZGF0YVRyYW5zZmVyLnNldERhdGEoXCJ0ZXh0L3BsYWluXCIsIFN0cmluZyhpbmRleCkpO1xuICAgICAgICByb3cuY2xhc3NMaXN0LmFkZChcImlzLWRyYWdnaW5nXCIpO1xuICAgICAgfSk7XG4gICAgICByb3cuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdlbmRcIiwgKCkgPT4gcm93LmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcmFnZ2luZ1wiKSk7XG4gICAgICByb3cuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdvdmVyXCIsIChldmVudCkgPT4ge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAvLyBPYmVyZSBvZGVyIHVudGVyZSBIXHUwMEU0bGZ0ZSBkZXIgWmVpbGUgZW50c2NoZWlkZXQsIG9iIGRpZSBnZXpvZ2VuZVxuICAgICAgICAvLyBaZWlsZSBkYXZvciBvZGVyIGRhaGludGVyIGxhbmRldCAtIHNvbnN0IGxpZVx1MDBERmUgc2ljaCBuaWUgXCJuYWNoIGdhbnpcbiAgICAgICAgLy8gdW50ZW5cIiBhYmxlZ2VuIChBYmxlZ2VuIGF1ZiBkZXIgbGV0enRlbiBaZWlsZSBoXHUwMEU0dHRlIGltbWVyIG51ciB2b3JcbiAgICAgICAgLy8gaWhyIGVpbmdlZlx1MDBGQ2d0KS5cbiAgICAgICAgY29uc3QgcmVjdCA9IHJvdy5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgICAgY29uc3QgaXNBZnRlciA9IGV2ZW50LmNsaWVudFkgLSByZWN0LnRvcCA+IHJlY3QuaGVpZ2h0IC8gMjtcbiAgICAgICAgcm93LmNsYXNzTGlzdC50b2dnbGUoXCJpcy1kcm9wLWJlZm9yZVwiLCAhaXNBZnRlcik7XG4gICAgICAgIHJvdy5jbGFzc0xpc3QudG9nZ2xlKFwiaXMtZHJvcC1hZnRlclwiLCBpc0FmdGVyKTtcbiAgICAgIH0pO1xuICAgICAgcm93LmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnbGVhdmVcIiwgKCkgPT4gcm93LmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcm9wLWJlZm9yZVwiLCBcImlzLWRyb3AtYWZ0ZXJcIikpO1xuICAgICAgcm93LmFkZEV2ZW50TGlzdGVuZXIoXCJkcm9wXCIsIGFzeW5jIChldmVudCkgPT4ge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBjb25zdCBpc0FmdGVyID0gcm93LmNsYXNzTGlzdC5jb250YWlucyhcImlzLWRyb3AtYWZ0ZXJcIik7XG4gICAgICAgIHJvdy5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJvcC1iZWZvcmVcIiwgXCJpcy1kcm9wLWFmdGVyXCIpO1xuXG4gICAgICAgIGNvbnN0IGZyb21JbmRleCA9IE51bWJlcihldmVudC5kYXRhVHJhbnNmZXIuZ2V0RGF0YShcInRleHQvcGxhaW5cIikpO1xuICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKGZyb21JbmRleCkpIHJldHVybjtcblxuICAgICAgICAvLyBaaWVscG9zaXRpb24gaW0gQXJyYXkgVk9SIGRlbSBFbnRmZXJuZW4gdm9uIGZyb21JbmRleCBnZWRhY2h0IC1cbiAgICAgICAgLy8gXCJuYWNoIGRpZXNlciBaZWlsZVwiIGhlaVx1MDBERnQ6IGRpcmVrdCB2b3IgZGVyIGpld2VpbHMgblx1MDBFNGNoc3Rlbi5cbiAgICAgICAgbGV0IGluc2VydEJlZm9yZSA9IGlzQWZ0ZXIgPyBpbmRleCArIDEgOiBpbmRleDtcbiAgICAgICAgaWYgKGZyb21JbmRleCA8IGluc2VydEJlZm9yZSkgaW5zZXJ0QmVmb3JlIC09IDE7XG5cbiAgICAgICAgY29uc3QgW21vdmVkXSA9IG9yZGVyKCkuc3BsaWNlKGZyb21JbmRleCwgMSk7XG4gICAgICAgIG9yZGVyKCkuc3BsaWNlKGluc2VydEJlZm9yZSwgMCwgbW92ZWQpO1xuICAgICAgICBhd2FpdCBwbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIHJlbmRlcigpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH07XG5cbiAgYWRkQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgaWYgKCFkcmFmdEVudHJ5KSB7XG4gICAgICBkcmFmdEVudHJ5ID0geyBraW5kOiBcInByb3BlcnR5XCIsIG5hbWU6IFwiXCIgfTtcbiAgICAgIHJlbmRlcigpO1xuICAgIH1cbiAgICBjb25zdCBpbnB1dHMgPSBsaXN0RWwucXVlcnlTZWxlY3RvckFsbChcIi5mcmVkLW9yZGVyLW5hbWUtaW5wdXRcIik7XG4gICAgaW5wdXRzW2lucHV0cy5sZW5ndGggLSAxXT8uZm9jdXMoKTtcbiAgfSk7XG5cbiAgcmVuZGVyKCk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBtb3VudEdsb2JhbE9yZGVyRWRpdG9yIH07XG4iLCAiY29uc3QgeyBnZXRTdWJ0eXBlIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBlc1wiKTtcclxuXHJcbi8vIEZhcmJlIGVpbmVzIFRZUHMgb2huZSBlaWdlbmUgRmFyYmUgLSBoaWVyIHN0YXR0IGluIHR5cC12aWV3LmpzLCB3ZWlsIHNpZVxyXG4vLyB1bnRlcmhhbGIgZGVyIFZpZXcgZ2VicmF1Y2h0IHdpcmQgKHNpZWhlIG5hbWVDb2xvcik7IHR5cC12aWV3LmpzIHJlaWNodCBzaWVcclxuLy8gdW52ZXJcdTAwRTRuZGVydCB3ZWl0ZXIsIGRhbWl0IGJlc3RlaGVuZGUgSW1wb3J0ZSBkb3J0IGdcdTAwRkNsdGlnIGJsZWliZW4uXHJcbmNvbnN0IERFRkFVTFRfVFlQRV9DT0xPUiA9IFwiIzg4ODg4OFwiO1xyXG5cclxuLy8gLS0tIFN1YnR5cC1GYXJiZW4gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4vLyBFaW4gU3VidHlwIHNwZWljaGVydCBrZWluZSBlaWdlbmUgRmFyYmUsIHNvbmRlcm4gbnVyIGVpbmUgQWJ3ZWljaHVuZyB2b24gZGVyXHJcbi8vIEZhcmJlIHNlaW5lcyBUWVBzIChzZXR0aW5ncy50eXBlU3VidHlwZXNbVFlQXVtTVUJUWVBdLmNvbG9yID0geyBoLCBsIH07IGluXHJcbi8vIEJlc3RhbmRzZGF0ZW4gc3RlaHQgZG9ydCBub2NoIGVpbiB3aXJrdW5nc2xvc2VzIHMsIHNpZWhlXHJcbi8vIFNVQlRZUEVfQ09MT1JfQ0hBTk5FTFMpLlxyXG4vLyBEaWUgdGF0c1x1MDBFNGNobGljaGUgRmFyYmUgd2lyZCBqZWRlcyBNYWwgYXVzIGRlciBha3R1ZWxsZW4gVFlQLUZhcmJlIGJlcmVjaG5ldFxyXG4vLyAtIFx1MDBFNG5kZXJ0IHNpY2ggZGllLCB6aWVoZW4gYWxsZSBTdWJ0eXBlbiBtaXQgdW5kIGJsZWliZW4gaW4gZGVyIEZhcmJmYW1pbGllLlxyXG4vLyBHZXJlY2huZXQgd2lyZCBpbiBPS0xDSCBzdGF0dCBIU0w6IGRvcnQgd2lya3QgZWluZSBIZWxsaWdrZWl0c1x1MDBFNG5kZXJ1bmcgXHUwMEZDYmVyXHJcbi8vIGFsbGUgRmFyYnRcdTAwRjZuZSBcdTAwRTRobmxpY2ggc3RhcmsgKGluIEhTTCB3XHUwMEU0cmUgei4gQi4gR2VsYiBiZWkgZ2xlaWNoZW0gV2VydCB2aWVsXHJcbi8vIGhlbGxlciBhbHMgQmxhdSkuIE9obmUgZWlnZW5lIEVpbnN0ZWxsdW5nIGhhdCBlaW4gU3VidHlwIGRpZSBUWVAtRmFyYmUuXHJcbi8vICAgaDogRmFyYnRvbiwgdmVyc2Nob2JlbiB1bSBHcmFkO1xyXG4vLyAgIGw6IEhlbGxpZ2tlaXQgaW4gJSBkZXMgV2VncyB6dSBXZWlcdTAwREYgKCspIGJ6dy4gU2Nod2FyeiAoLSkuXHJcbi8vIFdhcnVtIGJlaWRlIHJlbGF0aXYgcmVjaG5lbiB1bmQgZGllIFNcdTAwRTR0dGlndW5nIGRhYmVpIHZvbiBhbGxlaW4gbWl0emllaHQsXHJcbi8vIHN0ZWh0IGF1c2ZcdTAwRkNocmxpY2ggYW4gYXBwbHlDb2xvck9mZnNldC5cclxuLy8gV2llIHdlaXQgZWluIFN1YnR5cCBqZXdlaWxzIGFid2VpY2hlbiBkYXJmIChcdTAwQjEpLCBpc3QgZWluc3RlbGxiYXJcclxuLy8gKHNldHRpbmdzLnN1YnR5cGVDb2xvclJhbmdlcywgc2llaGUgc2V0dGluZ3MuanMpIC0gZWluZSBzY2hvbiBlaW5nZXN0ZWxsdGVcclxuLy8gQWJ3ZWljaHVuZyB3aXJkIGJlaW0gVmVya2xlaW5lcm4gZGVyIEdyZW56ZSBkYXJhdWYgZ2VrYXBwdC5cclxuLy8gRGllc2UgTGlzdGUgaXN0IGRpZSBlaW56aWdlIFF1ZWxsZTogYXVzIGlociBiYXVlbiBzaWNoIGRpZSBSZWdsZXIgaW1cclxuLy8gUG9wb3ZlciwgZGllIEdyZW56ZW4gaW4gZGVuIEVpbnN0ZWxsdW5nZW4gdW5kIGRpZSBLYXBwdW5nLiBFaW4gaGllclxyXG4vLyBhdXNrb21tZW50aWVydGVyIEthbmFsIHZlcnNjaHdpbmRldCBcdTAwRkNiZXJhbGwgdW5kIHdpcmQgbmljaHQgbWVociBnZXNwZWljaGVydC5cclxuLy9cclxuLy8gRGllIFNcdTAwRTR0dGlndW5nIGlzdCBzdGlsbGdlbGVndC4gU2llIHdhciB1cnNwclx1MDBGQ25nbGljaCBuXHUwMEY2dGlnLCB1bSBhdXN6dWdsZWljaGVuLFxyXG4vLyB3YXMgSGVsbGlna2VpdCB1bmQgRmFyYnRvbiBkZXIgRmFyYmUgYW4gU1x1MDBFNHR0aWd1bmcgd2VnbmFobWVuIC0gc2VpdCBiZWlkZVxyXG4vLyBSZWdsZXIgZGllIFNcdTAwRTR0dGlndW5nIHZvbiBhbGxlaW4gbWl0Zlx1MDBGQ2hyZW4gKHNpZWhlIGNvbXB1dGVDb2xvck9mZnNldCkgYmxpZWJcclxuLy8gaWhyIG51ciBub2NoIGRpZSBBdXNzYWdlIFwiZGllc2VyIFN1YnR5cCBuaW1tdCBzaWNoIHp1clx1MDBGQ2NrXCIsIHVuZCBkYWZcdTAwRkNyIGxvaG50XHJcbi8vIGVpbiBkcml0dGVyIFJlZ2xlciBuaWNodC4gWnVtIFdpZWRlcmJlbGViZW46IGhpZXIsIGluXHJcbi8vIERFRkFVTFRfU1VCVFlQRV9DT0xPUl9SQU5HRVMsIGltIFJlY2hlbndlZyB2b24gY29tcHV0ZUNvbG9yT2Zmc2V0IHVuZCBiZWlcclxuLy8gcmFuZ2VNYXgvcmFuZ2VEZXNjIGluIHNldHRpbmdzLmpzIGpld2VpbHMgZGllIEF1c2tvbW1lbnRpZXJ1bmcgYXVmaGViZW4uXHJcbi8vIGRvd25Pbmx5OiBkZXIgUmVnbGVyIHJlaWNodCBudXIgdm9uIC1HcmVuemUgYmlzIDAuIEVpbiBTdWJ0eXAgc29sbCBzaWNoXHJcbi8vIHp1clx1MDBGQ2NrbmVobWVuIGRcdTAwRkNyZmVuLCBhYmVyIG5pY2h0IGtyXHUwMEU0ZnRpZ2VyIGF1ZnRyZXRlbiBhbHMgc2VpbiBUWVAgLSBidW50ZXJcclxuLy8gYWxzIGRpZSBIYXVwdGZhcmJlIHppZWh0IGRpZSBBdWZtZXJrc2Fta2VpdCBnZW5hdSBmYWxzY2ggaGVydW0uXHJcbmNvbnN0IFNVQlRZUEVfQ09MT1JfQ0hBTk5FTFMgPSBbXHJcbiAgeyBrZXk6IFwiaFwiLCBsYWJlbDogXCJGYXJidG9uXCIsIHVuaXQ6IFwiXHUwMEIwXCIgfSxcclxuICAvLyB7IGtleTogXCJzXCIsIGxhYmVsOiBcIlNcdTAwRTR0dGlndW5nXCIsIHVuaXQ6IFwiJVwiLCBkb3duT25seTogdHJ1ZSB9LFxyXG4gIHsga2V5OiBcImxcIiwgbGFiZWw6IFwiSGVsbGlna2VpdFwiLCB1bml0OiBcIiVcIiB9LFxyXG5dO1xyXG4vLyBTdWJ0eXBlbiBzb2xsZW4gdm9yIGFsbGVtIHVudGVyc2NoZWlkYmFyIHNlaW46IEZhcmJ0b24gdHJcdTAwRTRndCBkYXp1IGFtXHJcbi8vIG1laXN0ZW4gYmVpIHVuZCBiZWtvbW10IGRlbiBnclx1MDBGNlx1MDBERnRlbiBTcGllbHJhdW0sIEhlbGxpZ2tlaXQgYWxzIHp3ZWl0ZSBrbGFyXHJcbi8vIGVya2VubmJhcmUgQWNoc2UgZWJlbmZhbGxzIHJlaWNobGljaC5cclxuY29uc3QgREVGQVVMVF9TVUJUWVBFX0NPTE9SX1JBTkdFUyA9IHsgaDogMzUsIC8qIHM6IDQwLCAqLyBsOiA0MCB9O1xyXG5cclxuZnVuY3Rpb24gY29sb3JSYW5nZShzZXR0aW5ncywga2V5KSB7XHJcbiAgY29uc3QgdmFsdWUgPSBOdW1iZXIoc2V0dGluZ3Muc3VidHlwZUNvbG9yUmFuZ2VzPy5ba2V5XSk7XHJcbiAgcmV0dXJuIE51bWJlci5pc0Zpbml0ZSh2YWx1ZSkgJiYgdmFsdWUgPj0gMCA/IHZhbHVlIDogREVGQVVMVF9TVUJUWVBFX0NPTE9SX1JBTkdFU1trZXldO1xyXG59XHJcblxyXG4vLyBWb24gd28gYmlzIHdvIGVpbiBSZWdsZXIgcmVpY2h0IC0gZWluZSBTdGVsbGUgZlx1MDBGQ3IgUG9wb3ZlciwgS2FwcHVuZyB1bmRcclxuLy8gVmVybGF1ZnN2b3JzY2hhdSwgZGFtaXQgZGllIGRyZWkgbmljaHQgYXVzZWluYW5kZXJsYXVmZW4uXHJcbmZ1bmN0aW9uIGNoYW5uZWxCb3VuZHMoc2V0dGluZ3MsIGtleSkge1xyXG4gIGNvbnN0IHJhbmdlID0gY29sb3JSYW5nZShzZXR0aW5ncywga2V5KTtcclxuICByZXR1cm4gU1VCVFlQRV9DT0xPUl9DSEFOTkVMUy5maW5kKChjaGFubmVsKSA9PiBjaGFubmVsLmtleSA9PT0ga2V5KT8uZG93bk9ubHkgPyBbLXJhbmdlLCAwXSA6IFstcmFuZ2UsIHJhbmdlXTtcclxufVxyXG5cclxuLy8gQWJ3ZWljaHVuZyBlaW5lcyBTdWJ0eXBzLCBhdWYgZGllIGVpbmdlc3RlbGx0ZW4gR3JlbnplbiBnZWthcHB0LlxyXG5mdW5jdGlvbiBjbGFtcGVkT2Zmc2V0KHNldHRpbmdzLCBvZmZzZXQpIHtcclxuICBpZiAoIW9mZnNldCkgcmV0dXJuIG51bGw7XHJcbiAgY29uc3QgcmVzdWx0ID0ge307XHJcbiAgZm9yIChjb25zdCB7IGtleSB9IG9mIFNVQlRZUEVfQ09MT1JfQ0hBTk5FTFMpIHtcclxuICAgIGNvbnN0IFttaW4sIG1heF0gPSBjaGFubmVsQm91bmRzKHNldHRpbmdzLCBrZXkpO1xyXG4gICAgcmVzdWx0W2tleV0gPSBNYXRoLm1pbihtYXgsIE1hdGgubWF4KG1pbiwgTnVtYmVyKG9mZnNldFtrZXldKSB8fCAwKSk7XHJcbiAgfVxyXG4gIHJldHVybiByZXN1bHQ7XHJcbn1cclxuXHJcbmNvbnN0IHRvTGluZWFyID0gKGMpID0+IChjIDw9IDAuMDQwNDUgPyBjIC8gMTIuOTIgOiAoKGMgKyAwLjA1NSkgLyAxLjA1NSkgKiogMi40KTtcclxuY29uc3QgdG9HYW1tYSA9IChjKSA9PiAoYyA8PSAwLjAwMzEzMDggPyAxMi45MiAqIGMgOiAxLjA1NSAqIGMgKiogKDEgLyAyLjQpIC0gMC4wNTUpO1xyXG5cclxuZnVuY3Rpb24gaGV4VG9Pa2xjaChoZXgpIHtcclxuICBjb25zdCBtYXRjaCA9IC9eIz8oWzAtOWEtZl17Nn0pJC9pLmV4ZWMoaGV4ID8/IFwiXCIpO1xyXG4gIGlmICghbWF0Y2gpIHJldHVybiBudWxsO1xyXG4gIGNvbnN0IGludCA9IHBhcnNlSW50KG1hdGNoWzFdLCAxNik7XHJcbiAgY29uc3QgW3IsIGcsIGJdID0gWyhpbnQgPj4gMTYpICYgMjU1LCAoaW50ID4+IDgpICYgMjU1LCBpbnQgJiAyNTVdLm1hcCgoYykgPT4gdG9MaW5lYXIoYyAvIDI1NSkpO1xyXG4gIGNvbnN0IGwgPSBNYXRoLmNicnQoMC40MTIyMjE0NzA4ICogciArIDAuNTM2MzMyNTM2MyAqIGcgKyAwLjA1MTQ0NTk5MjkgKiBiKTtcclxuICBjb25zdCBtID0gTWF0aC5jYnJ0KDAuMjExOTAzNDk4MiAqIHIgKyAwLjY4MDY5OTU0NTEgKiBnICsgMC4xMDczOTY5NTY2ICogYik7XHJcbiAgY29uc3QgcyA9IE1hdGguY2JydCgwLjA4ODMwMjQ2MTkgKiByICsgMC4yODE3MTg4Mzc2ICogZyArIDAuNjI5OTc4NzAwNSAqIGIpO1xyXG4gIGNvbnN0IEwgPSAwLjIxMDQ1NDI1NTMgKiBsICsgMC43OTM2MTc3ODUgKiBtIC0gMC4wMDQwNzIwNDY4ICogcztcclxuICBjb25zdCBBID0gMS45Nzc5OTg0OTUxICogbCAtIDIuNDI4NTkyMjA1ICogbSArIDAuNDUwNTkzNzA5OSAqIHM7XHJcbiAgY29uc3QgQiA9IDAuMDI1OTA0MDM3MSAqIGwgKyAwLjc4Mjc3MTc2NjIgKiBtIC0gMC44MDg2NzU3NjYgKiBzO1xyXG4gIHJldHVybiB7IEwsIEM6IE1hdGguaHlwb3QoQSwgQiksIEg6ICgoTWF0aC5hdGFuMihCLCBBKSAqIDE4MCkgLyBNYXRoLlBJICsgMzYwKSAlIDM2MCB9O1xyXG59XHJcblxyXG4vLyBMaW5lYXJlcyBzUkdCLCBLYW5cdTAwRTRsZSBnZ2YuIGF1XHUwMERGZXJoYWxiIHZvbiAwLi4xIChhdVx1MDBERmVyaGFsYiBkZXMgRmFyYnJhdW1zKS5cclxuZnVuY3Rpb24gb2tsY2hUb0xpbmVhcih7IEwsIEMsIEggfSkge1xyXG4gIGNvbnN0IEEgPSBDICogTWF0aC5jb3MoKEggKiBNYXRoLlBJKSAvIDE4MCk7XHJcbiAgY29uc3QgQiA9IEMgKiBNYXRoLnNpbigoSCAqIE1hdGguUEkpIC8gMTgwKTtcclxuICBjb25zdCBsID0gKEwgKyAwLjM5NjMzNzc3NzQgKiBBICsgMC4yMTU4MDM3NTczICogQikgKiogMztcclxuICBjb25zdCBtID0gKEwgLSAwLjEwNTU2MTM0NTggKiBBIC0gMC4wNjM4NTQxNzI4ICogQikgKiogMztcclxuICBjb25zdCBzID0gKEwgLSAwLjA4OTQ4NDE3NzUgKiBBIC0gMS4yOTE0ODU1NDggKiBCKSAqKiAzO1xyXG4gIHJldHVybiBbXHJcbiAgICA0LjA3Njc0MTY2MjEgKiBsIC0gMy4zMDc3MTE1OTEzICogbSArIDAuMjMwOTY5OTI5MiAqIHMsXHJcbiAgICAtMS4yNjg0MzgwMDQ2ICogbCArIDIuNjA5NzU3NDAxMSAqIG0gLSAwLjM0MTMxOTM5NjUgKiBzLFxyXG4gICAgLTAuMDA0MTk2MDg2MyAqIGwgLSAwLjcwMzQxODYxNDcgKiBtICsgMS43MDc2MTQ3MDEgKiBzLFxyXG4gIF07XHJcbn1cclxuXHJcbmNvbnN0IGluR2FtdXQgPSAocmdiKSA9PiByZ2IuZXZlcnkoKGMpID0+IGMgPj0gLTAuMDAwMSAmJiBjIDw9IDEuMDAwMSk7XHJcblxyXG4vLyBHclx1MDBGNlx1MDBERnRlcyBiZWkgZGllc2VyIEhlbGxpZ2tlaXQgdW5kIGRpZXNlbSBGYXJidG9uIGluIHNSR0Igbm9jaCBkYXJzdGVsbGJhcmVzXHJcbi8vIENocm9tYS4gRGllc2UgR3JlbnplIHNjaHdhbmt0IHN0YXJrIC0gcmVpbmVzIEdlbGIgdmVydHJcdTAwRTRndCBudXIga25hcHAgdW50ZXJcclxuLy8gV2VpXHUwMERGIHZpZWwgQ2hyb21hLCBCbGF1IGFtIG1laXN0ZW4gaW4gZGVyIE1pdHRlIC0sIHVuZCBnZW5hdSBhbiBpaHIgc2NoZWl0ZXJ0XHJcbi8vIGplZGUgUmVjaG51bmcsIGRpZSBDaHJvbWEgYWJzb2x1dCBmZXN0aFx1MDBFNGx0IChzaWVoZSBhcHBseUNvbG9yT2Zmc2V0KS5cclxuZnVuY3Rpb24gbWF4Q2hyb21hKEwsIEgpIHtcclxuICBsZXQgbG93ID0gMDtcclxuICBsZXQgaGlnaCA9IDAuNDsgLy8gXHUwMEZDYmVyIGRlbSBzUkdCLU1heGltdW0gKH4wLDMyKVxyXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgMjA7IGkrKykge1xyXG4gICAgY29uc3QgbWlkID0gKGxvdyArIGhpZ2gpIC8gMjtcclxuICAgIGlmIChpbkdhbXV0KG9rbGNoVG9MaW5lYXIoeyBMLCBDOiBtaWQsIEggfSkpKSBsb3cgPSBtaWQ7XHJcbiAgICBlbHNlIGhpZ2ggPSBtaWQ7XHJcbiAgfVxyXG4gIHJldHVybiBsb3c7XHJcbn1cclxuXHJcbi8vIExpZWd0IGRpZSBGYXJiZSBhdVx1MDBERmVyaGFsYiB2b24gc1JHQiwgd2lyZCBkaWUgU1x1MDBFNHR0aWd1bmcgKENocm9tYSkgc28gd2VpdFxyXG4vLyB2ZXJyaW5nZXJ0LCBiaXMgc2llIGRhcnN0ZWxsYmFyIGlzdCAtIEZhcmJ0b24gdW5kIEhlbGxpZ2tlaXQgYmxlaWJlbi4gRlx1MDBGQ3JcclxuLy8gYXBwbHlDb2xvck9mZnNldCBpc3QgZGFzIG51ciBub2NoIGVpbiBTaWNoZXJoZWl0c25ldHo6IGRvcnQgc3RlaHQgZGFzXHJcbi8vIENocm9tYSBvaG5laGluIHNjaG9uIGFscyBBbnRlaWwgZGVzIGRhcnN0ZWxsYmFyZW4gTWF4aW11bXMgZmVzdC5cclxuZnVuY3Rpb24gb2tsY2hUb0hleChjb2xvcikge1xyXG4gIGxldCByZ2IgPSBva2xjaFRvTGluZWFyKGNvbG9yKTtcclxuICBpZiAoIWluR2FtdXQocmdiKSkgcmdiID0gb2tsY2hUb0xpbmVhcih7IC4uLmNvbG9yLCBDOiBtYXhDaHJvbWEoY29sb3IuTCwgY29sb3IuSCkgfSk7XHJcbiAgcmV0dXJuIChcclxuICAgIFwiI1wiICtcclxuICAgIHJnYlxyXG4gICAgICAubWFwKChjKSA9PiBNYXRoLnJvdW5kKE1hdGgubWluKDEsIE1hdGgubWF4KDAsIHRvR2FtbWEoTWF0aC5taW4oMSwgTWF0aC5tYXgoMCwgYykpKSkpICogMjU1KSlcclxuICAgICAgLm1hcCgoYykgPT4gYy50b1N0cmluZygxNikucGFkU3RhcnQoMiwgXCIwXCIpKVxyXG4gICAgICAuam9pbihcIlwiKVxyXG4gICk7XHJcbn1cclxuXHJcbi8vIEhlbGxpZ2tlaXQgZGVzIFNjaGVpdGVscyBlaW5lcyBGYXJidG9uczogZG9ydCB0clx1MDBFNGd0IGVyIGRhcyBtZWlzdGUgQ2hyb21hLlxyXG4vLyBtYXhDaHJvbWEgc3RlaWd0IFx1MDBGQ2JlciBkaWUgSGVsbGlna2VpdCBiaXMgZG9ydGhpbiB1bmQgZlx1MDBFNGxsdCBkYW5hY2ggd2llZGVyLCBzb1xyXG4vLyBkYXNzIGRpZSBTcGl0emUgc2ljaCBlaW5rcmVpc2VuIGxcdTAwRTRzc3QuIEplIEZhcmJ0b24gZWluIGZlc3RlciBXZXJ0LCB1bmQgZGllXHJcbi8vIFN1Y2hlIGlzdCB0ZXVlciAtIGRhcnVtIG5hY2ggZ2FuemVuIEdyYWQgZ2VtZXJrdC5cclxuY29uc3QgY3VzcENhY2hlID0gbmV3IE1hcCgpO1xyXG5cclxuLy8gQWIgaGllciBnaWx0IGVpbmUgRmFyYmUgYWxzIGJ1bnQuIEVpbiByZWluZXMgR3JhdSBrb21tdCBhdXMgaGV4VG9Pa2xjaCBuaWNodFxyXG4vLyBtaXQgQ2hyb21hIDAgenVyXHUwMEZDY2ssIHNvbmRlcm4gbWl0IHJ1bmQgMmUtOCB1bmQgZWluZW0gYmVsaWViaWdlbiBGYXJidG9uIC1cclxuLy8gZGllIE1hdHJpeGtvbnN0YW50ZW4gc2luZCBnZXJ1bmRldC4gQXVmIFwiZ3JcdTAwRjZcdTAwREZlciBhbHMgMFwiIHp1IHByXHUwMEZDZmVuIGZcdTAwRkNocnRlIGRpZVxyXG4vLyBIZWxsaWdrZWl0IGVpbmVzIEdyYXVzIGFsc28gZGVtIFNjaGVpdGVsIGVpbmVzIEZhcmJ0b25zIG5hY2gsIGRlbiBlcyBnYXJcclxuLy8gbmljaHQgaGF0LiBEaWUgU2Nod2VsbGUgbGllZ3Qgd2VpdCB1bnRlciBhbGxlbSwgd2FzIGluIDggQml0IHNpY2h0YmFyIHdcdTAwRTRyZVxyXG4vLyAoZWluIFNjaHJpdHQgdm9uIDEvMjU1IGluIGVpbmVtIEthbmFsIGVyZ2lidCBydW5kIDAsMDAyKS5cclxuY29uc3QgTkVVVFJBTF9DSFJPTUEgPSAxZS00O1xyXG5cclxuZnVuY3Rpb24gY3VzcExpZ2h0bmVzcyhIKSB7XHJcbiAgY29uc3Qga2V5ID0gTWF0aC5yb3VuZChIKSAlIDM2MDtcclxuICBjb25zdCBjYWNoZWQgPSBjdXNwQ2FjaGUuZ2V0KGtleSk7XHJcbiAgaWYgKGNhY2hlZCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gY2FjaGVkO1xyXG4gIGxldCBsb3cgPSAwO1xyXG4gIGxldCBoaWdoID0gMTtcclxuICBmb3IgKGxldCBpID0gMDsgaSA8IDI0OyBpKyspIHtcclxuICAgIGNvbnN0IHRoaXJkID0gKGhpZ2ggLSBsb3cpIC8gMztcclxuICAgIGlmIChtYXhDaHJvbWEobG93ICsgdGhpcmQsIGtleSkgPCBtYXhDaHJvbWEoaGlnaCAtIHRoaXJkLCBrZXkpKSBsb3cgKz0gdGhpcmQ7XHJcbiAgICBlbHNlIGhpZ2ggLT0gdGhpcmQ7XHJcbiAgfVxyXG4gIGNvbnN0IHJlc3VsdCA9IChsb3cgKyBoaWdoKSAvIDI7XHJcbiAgY3VzcENhY2hlLnNldChrZXksIHJlc3VsdCk7XHJcbiAgcmV0dXJuIHJlc3VsdDtcclxufVxyXG5cclxuLy8gRGllc2VsYmUgSGVsbGlna2VpdCwgYWJlciBnZW1lc3NlbiBhbSBTY2hlaXRlbCBkZXMgWmllbGZhcmJ0b25zIHN0YXR0IGFtXHJcbi8vIGVpZ2VuZW46IGRlciBTY2hlaXRlbCBnZWh0IGF1ZiBkZW4gU2NoZWl0ZWwsIFNjaHdhcnogYXVmIFNjaHdhcnogdW5kIFdlaVx1MDBERlxyXG4vLyBhdWYgV2VpXHUwMERGLCBkYXp3aXNjaGVuIGxpbmVhci4gT2huZSBGYXJidG9uZHJlaHVuZyBrb21tdCBkaWUgSGVsbGlna2VpdFxyXG4vLyB1bnZlclx1MDBFNG5kZXJ0IHp1clx1MDBGQ2NrLlxyXG5mdW5jdGlvbiByZW1hcFRvQ3VzcChMLCBmcm9tSCwgdG9IKSB7XHJcbiAgY29uc3QgZnJvbSA9IGN1c3BMaWdodG5lc3MoZnJvbUgpO1xyXG4gIGNvbnN0IHRvID0gY3VzcExpZ2h0bmVzcyh0b0gpO1xyXG4gIGlmIChMIDw9IGZyb20pIHJldHVybiBmcm9tID4gMCA/IChMIC8gZnJvbSkgKiB0byA6IHRvO1xyXG4gIHJldHVybiBmcm9tIDwgMSA/IHRvICsgKChMIC0gZnJvbSkgLyAoMSAtIGZyb20pKSAqICgxIC0gdG8pIDogdG87XHJcbn1cclxuXHJcbi8vIERpZSBiZWlkZW4gU3VjaGVuIG5hY2ggZGVyIEdhbXV0LUdyZW56ZSBrb3N0ZW4gamUgRmFyYmUgcnVuZCAxMCBcdTAwQjVzIC0genVcclxuLy8gdmllbCwgd2VubiBkZXIgRGF0ZWliYXVtIG9kZXIgZGVyIEdyYXBoIHNpZSBmXHUwMEZDciBqZWRlIERhdGVpIGVybmV1dCBhbnN0XHUwMEY2XHUwMERGdFxyXG4vLyAoc2llaGUgY29sb3JGb3JGaWxlKS4gVmVyc2NoaWVkZW5lIEZhcmJlbiBnaWJ0IGVzIGRhYmVpIG51ciBlaW5lIEhhbmR2b2xsLFxyXG4vLyBlaW5lIGplIFRZUC9TVUJUWVAsIGFsc28gZ2VuXHUwMEZDZ3QgZWluIFp3aXNjaGVuc3BlaWNoZXI7IGJlaW0gWmllaGVuIGVpbmVzXHJcbi8vIFJlZ2xlcnMgd1x1MDBFNGNoc3QgZXIgdW0gamVkZSBad2lzY2hlbnN0ZWxsdW5nIHVuZCB3aXJkIGRhcnVtIGFiIHVuZCB6dSBnZWxlZXJ0LlxyXG5jb25zdCBvZmZzZXRDYWNoZSA9IG5ldyBNYXAoKTtcclxuXHJcbmZ1bmN0aW9uIGFwcGx5Q29sb3JPZmZzZXQoaGV4LCBvZmZzZXQpIHtcclxuICBpZiAoIW9mZnNldCkgcmV0dXJuIGhleDtcclxuICBjb25zdCBjYWNoZUtleSA9IGhleCArIFwifFwiICsgKG9mZnNldC5oID8/IDApICsgXCJ8XCIgKyAob2Zmc2V0LmwgPz8gMCk7XHJcbiAgY29uc3QgY2FjaGVkID0gb2Zmc2V0Q2FjaGUuZ2V0KGNhY2hlS2V5KTtcclxuICBpZiAoY2FjaGVkICE9PSB1bmRlZmluZWQpIHJldHVybiBjYWNoZWQ7XHJcbiAgY29uc3QgcmVzdWx0ID0gY29tcHV0ZUNvbG9yT2Zmc2V0KGhleCwgb2Zmc2V0KTtcclxuICBpZiAob2Zmc2V0Q2FjaGUuc2l6ZSA+IDUwMCkgb2Zmc2V0Q2FjaGUuY2xlYXIoKTtcclxuICBvZmZzZXRDYWNoZS5zZXQoY2FjaGVLZXksIHJlc3VsdCk7XHJcbiAgcmV0dXJuIHJlc3VsdDtcclxufVxyXG5cclxuLy8gQmVpZGUgUmVnbGVyIHdpcmtlbiByZWxhdGl2IHp1ciBUWVAtRmFyYmUsIGRhbWl0IGRlciBTdWJ0eXAgaW4gZGVyXHJcbi8vIEZhbWlsaWUgYmxlaWJ0LiBBYnNvbHV0ZSBXZXJ0ZSBoYWx0ZW4gbmljaHQsIHdhcyBzaWUgdmVyc3ByZWNoZW4sIGRlbm4gd2llXHJcbi8vIHZpZWwgRmFyYmUgc1JHQiBcdTAwRkNiZXJoYXVwdCBoZXJnaWJ0LCBoXHUwMEU0bmd0IHZvbiBIZWxsaWdrZWl0IFVORCBGYXJidG9uIGFiOlxyXG4vLyAgIGw6IEFudGVpbCBkZXMgV2VncyB6dSBXZWlcdTAwREYgKCspIGJ6dy4gU2Nod2FyeiAoLSkuIEFic29sdXRlIE9LTENILVB1bmt0ZVxyXG4vLyAgICAgIGxpZWZlbiBiZWkgZWluZXIgb2huZWhpbiBoZWxsZW4gVFlQLUZhcmJlIHNjaG9uIGluIGRlciBlcnN0ZW5cclxuLy8gICAgICBSZWdsZXJoXHUwMEU0bGZ0ZSBhdWYgcmVpbmVzIFdlaVx1MDBERiwgdW5kIGRlciBSZXN0IGRlcyBSZWdsZXJzIHRhdCBuaWNodHMgbWVoci5cclxuLy8gICBoOiBHcmFkIC0gYWxzIGVpbnppZ2VyIGFic29sdXQsIEFCRVIgZXIgZlx1MDBGQ2hydCBkaWUgSGVsbGlna2VpdCBtaXQgKHNpZWhlXHJcbi8vICAgICAgcmVtYXBUb0N1c3ApLiBKZWRlciBGYXJidG9uIHRyXHUwMEU0Z3Qgc2VpbiBtZWlzdGVzIENocm9tYSBhdWYgZWluZXIgYW5kZXJlblxyXG4vLyAgICAgIEhlbGxpZ2tlaXQ6IEdlbGIgZXJzdCBiZWkgTCAwLDkyLCBPcmFuZ2Ugc2Nob24gYmVpIDAsNzgsIEJsYXUgYmVpIDAsNDkuXHJcbi8vICAgICAgRWluZSBoZWxsZSBnZWxiZSBUWVAtRmFyYmUgYXVmIE9yYW5nZSB6dSBkcmVoZW4gdW5kIGRhYmVpIGRpZVxyXG4vLyAgICAgIEhlbGxpZ2tlaXQgZmVzdHp1aGFsdGVuLCBzZXR6dCBzaWUgd2VpdCBcdTAwRkNiZXIgZGVuIFNjaGVpdGVsIHZvbiBPcmFuZ2UgLVxyXG4vLyAgICAgIGRvcnQgdHJcdTAwRTRndCBkZXIgRmFyYnJhdW0gZmFzdCBrZWluIENocm9tYSBtZWhyLCB1bmQgaGVyYXVzIGtvbW10IGVpblxyXG4vLyAgICAgIGJsYXNzZXMgUGFzdGVsbCwgZGFzIG5lYmVuIHNlaW5lbSBUWVAgd2llIGF1c2dld2FzY2hlbiB1bmQgdmllbCB6dSBoZWxsXHJcbi8vICAgICAgd2lya3QgKHJlY2huZXJpc2NoIGlzdCBlcyBnZW5hdXNvIGhlbGwsIGFiZXIgYmxhc3MgbGllc3Qgc2ljaCBhbHMgaGVsbCkuXHJcbi8vICAgICAgRlx1MDBGQ2hydCBkaWUgSGVsbGlna2VpdCBkYWdlZ2VuIGRlbiBTY2hlaXRlbCBuYWNoLCBibGVpYnQgZGllIEZhcmJrcmFmdFxyXG4vLyAgICAgIFx1MDBGQ2JlciBkaWUgZ2FuemUgRHJlaHVuZyBwcmFrdGlzY2ggZ2xlaWNoLlxyXG4vLyBFaW5lbiBlaWdlbmVuIFJlZ2xlciBmXHUwMEZDciBkaWUgU1x1MDBFNHR0aWd1bmcgZ2lidCBlcyBuYWNoIGFsbCBkZW0gbmljaHQgbWVociAtIHNpZVxyXG4vLyB6aWVodCBiZWkgYmVpZGVuIGFuZGVyZW4gdm9uIGFsbGVpbiBtaXQgKHN0aWxsZ2VsZWd0LCBzaWVoZVxyXG4vLyBTVUJUWVBFX0NPTE9SX0NIQU5ORUxTKS5cclxuLy9cclxuLy8gU2luZCBkaWUgSGVsbGlna2VpdGVuIHNvIGF1ZmVpbmFuZGVyIGJlem9nZW4sIGlzdCBhdWNoIGRhcyBDaHJvbWEgd2llZGVyXHJcbi8vIHNjaGxpY2h0IGVpbiBBbnRlaWwgYW4gZGVyIERlY2tlIChiYXNlLkMgLyBtYXhDaHJvbWEgYW0gQXVzZ2FuZ3NwdW5rdCwgZGFublxyXG4vLyBtYWwgbWF4Q2hyb21hIGFtIFppZWwpOiBkaWUgRGVja2VuIHp3ZWllciBGYXJidFx1MDBGNm5lIHNpbmQgZXJzdCBkYWR1cmNoXHJcbi8vIFx1MDBGQ2JlcmhhdXB0IHZlcmdsZWljaGJhci5cclxuLy9cclxuLy8gV0FTIERJRVNFUiBBTlRFSUwgSVNUIFVORCBXQVMgTklDSFQuIFwiQW50ZWlsIGFuIGRlciBEZWNrZVwiIGlzdCBlaW5lXHJcbi8vIEVudHNjaGVpZHVuZyBcdTAwRkNiZXIgc1JHQiwga2VpbmUgXHUwMEZDYmVyIFdhaHJuZWhtdW5nIC0gZGFzIHNpZWh0IG1hbiBkZW0gQ29kZVxyXG4vLyBuaWNodCBhbiwgd2VpbCBlciBzb25zdCBkdXJjaHdlZyBpbiBlaW5lbSB3YWhybmVobXVuZ3NuYWhlbiBSYXVtIHJlY2huZXQuXHJcbi8vIG1heENocm9tYSBiZXNjaHJlaWJ0IGRpZSBIXHUwMEZDbGxlIGVpbmVzIEF1c2dhYmVnZXJcdTAwRTR0cy4gS29uc3RhbnQgZ2VoYWx0ZW4gd2lyZFxyXG4vLyBoaWVyIGFsc28gXCJnbGVpY2ggd2VpdCBhdXNnZXJlaXp0XCIsIG5pY2h0IFwiZ2xlaWNoIGJ1bnRcIiAoZGFzIHdcdTAwRTRyZSBrb25zdGFudGVzXHJcbi8vIEMpIHVuZCBuaWNodCBcImdsZWljaCBnZXNcdTAwRTR0dGlndFwiIChkYXMgd1x1MDBFNHJlIGtvbnN0YW50ZXMgQy9MKS4gRGFyYXVzIGZvbGd0OlxyXG4vLyAgIC0gRGFzIE1vZGVsbCBpc3QgYW4gc1JHQiBnZWJ1bmRlbi4gSW4gZWluZW0gd2VpdGVyZW4gRmFyYnJhdW0gZXJnXHUwMEU0YmVuXHJcbi8vICAgICBkaWVzZWxiZW4gRWluZ2FiZW4gYW5kZXJlIEZhcmJlbiwgd2VpbCBkaWUgRGVja2Ugd29hbmRlcnMgbGllZ3QuXHJcbi8vICAgLSByZW1hcFRvQ3VzcCBnaWJ0IGdsZWljaGUgd2Focmdlbm9tbWVuZSBIZWxsaWdrZWl0IGJld3Vzc3QgYXVmOiBuYWNoXHJcbi8vICAgICBlaW5lciBGYXJidG9uZHJlaHVuZyBpc3QgZGVyIFN1YnR5cCBuaWNodCBtZWhyIGdsZWljaCBoZWxsIHdpZSBzZWluIFRZUCxcclxuLy8gICAgIHNvbmRlcm4gZ2xlaWNoIG5hY2hkclx1MDBGQ2NrbGljaC4gRGFzIGlzdCBoaWVyIGVyd1x1MDBGQ25zY2h0LCBhYmVyIGVzIGlzdCBlaW5lXHJcbi8vICAgICBHZXN0YWx0dW5nc2VudHNjaGVpZHVuZyB1bmQga2VpbiBwZXJ6ZXB0dWVsbGVzIEdlc2V0ei5cclxuLy8gICAtIFx1MDBEQ2JlciBkaWUgSGVsbGlna2VpdCBpc3QgZGFzIENocm9tYSBuaWNodCBtb25vdG9uLiBMaWVndCBlaW5lIFRZUC1GYXJiZVxyXG4vLyAgICAgXHUwMEZDYmVyIGlocmVtIFNjaGVpdGVsLCBzdGVpZ3QgZXMgYXVmIGRlbSBXZWcgbmFjaCB1bnRlbiBlcnN0IGFuIHVuZCBmXHUwMEU0bGx0XHJcbi8vICAgICBkYW5uIHdpZWRlciAoZWluIGJsYXVlcyAjNzg3OGRjIGhhdCBiZWkgLTIwICUgbWVociBDaHJvbWEgYWxzIGJlaSAwICVcclxuLy8gICAgIHVuZCBiZWkgLTQwICUpLiBEZXIgUmVnbGVyIGZcdTAwRTRocnQgZG9ydCBcdTAwRkNiZXIgZWluZW4gQnVja2VsLlxyXG4vLyBGXHUwMEZDciBmYXJiaWdlIERhdGVpbmFtZW4gaXN0IGFsbCBkYXMgdHJhZ2JhciAtIHdlciBkYXMgTW9kZWxsIHN0cmVuZ2VyIGhhYmVuXHJcbi8vIHdpbGwsIG1cdTAwRkNzc3RlIGRpZSBCZXp1Z3Nnclx1MDBGNlx1MDBERmUgd2VjaHNlbG4sIG5pY2h0IGRpZSBGb3JtZWxuIG5hY2hiZXNzZXJuLlxyXG4vL1xyXG4vLyBBdWNoIE9LTGFiIHNlbGJzdCBpc3QgbmljaHQgc3Bhbm51bmdzZnJlaTogc2VpbmUgRmFyYnRvbmxpbmllbiBsYXVmZW4gaW1cclxuLy8gQmxhdWJlcmVpY2ggKEggMjYwLTI5MCkgbWVya2xpY2ggYW4gZGVyIFdhaHJuZWhtdW5nIHZvcmJlaSwgQmxhdSB6aWVodCBiZWltXHJcbi8vIEF1ZmhlbGxlbiBpbnMgVmlvbGV0dGUuIFJlY2huZXJpc2NoIGJsZWlidCBkZXIgRmFyYnRvbiBkb3J0IGtvbnN0YW50LCB3YXNcclxuLy8gZGFzIFByb2JsZW0gZWhlciB2ZXJkZWNrdCBhbHMgYmVoZWJ0LiBFaW5lIFRZUC1GYXJiZSBpbiBkaWVzZW0gQmVyZWljaCBhbHNvXHJcbi8vIGxpZWJlciBuYWNoc2VoZW4gYWxzIGRlbiBaYWhsZW4gZ2xhdWJlbi5cclxuZnVuY3Rpb24gY29tcHV0ZUNvbG9yT2Zmc2V0KGhleCwgb2Zmc2V0KSB7XHJcbiAgY29uc3QgYmFzZSA9IGhleFRvT2tsY2goaGV4KTtcclxuICBpZiAoIWJhc2UpIHJldHVybiBoZXg7XHJcbiAgY29uc3QgSCA9IChiYXNlLkggKyAob2Zmc2V0LmggPz8gMCkgKyAzNjApICUgMzYwO1xyXG4gIGNvbnN0IGJhc2VDZWlsaW5nID0gbWF4Q2hyb21hKGJhc2UuTCwgYmFzZS5IKTtcclxuICAvLyBFaW5lIGdyYXVlIFRZUC1GYXJiZSBibGVpYnQgZ3JhdSwgdW5kIGlociBGYXJidG9uIGlzdCBiZWRldXR1bmdzbG9zIC0gZGFublxyXG4gIC8vIGdpYnQgZXMgYXVjaCBrZWluZW4gU2NoZWl0ZWwsIGRlbSBkaWUgSGVsbGlna2VpdCBmb2xnZW4ga1x1MDBGNm5udGUuXHJcbiAgY29uc3QgbmV1dHJhbCA9IGJhc2UuQyA8IE5FVVRSQUxfQ0hST01BIHx8IGJhc2VDZWlsaW5nIDw9IDA7XHJcbiAgY29uc3QgcmVsYXRpdmUgPSBuZXV0cmFsID8gMCA6IGJhc2UuQyAvIGJhc2VDZWlsaW5nO1xyXG4gIGNvbnN0IHNoaWZ0ZWQgPSBuZXV0cmFsID8gYmFzZS5MIDogcmVtYXBUb0N1c3AoYmFzZS5MLCBiYXNlLkgsIEgpO1xyXG4gIGNvbnN0IHNoYXJlID0gKG9mZnNldC5sID8/IDApIC8gMTAwO1xyXG4gIGNvbnN0IEwgPSBNYXRoLm1pbigxLCBNYXRoLm1heCgwLCBzaGlmdGVkICsgc2hhcmUgKiAoc2hhcmUgPj0gMCA/IDEgLSBzaGlmdGVkIDogc2hpZnRlZCkpKTtcclxuICBjb25zdCBDID0gcmVsYXRpdmUgKiBtYXhDaHJvbWEoTCwgSCk7IC8qICogKDEgKyAob2Zmc2V0LnMgPz8gMCkgLyAxMDApIC0gU1x1MDBFNHR0aWd1bmcgc3RpbGxnZWxlZ3QgKi9cclxuICByZXR1cm4gb2tsY2hUb0hleCh7IEwsIEM6IE1hdGgubWF4KDAsIEMpLCBIIH0pO1xyXG59XHJcblxyXG5mdW5jdGlvbiBoYXNDb2xvck9mZnNldChvZmZzZXQpIHtcclxuICByZXR1cm4gISFvZmZzZXQgJiYgU1VCVFlQRV9DT0xPUl9DSEFOTkVMUy5zb21lKCh7IGtleSB9KSA9PiAob2Zmc2V0W2tleV0gPz8gMCkgIT09IDApO1xyXG59XHJcblxyXG4vLyBGYXJiZSBlaW5lcyBTdWJ0eXBzIChiencuIGRpZSBkZXMgVFlQcywgc29sYW5nZSBkZXIgU3VidHlwIGtlaW5lIGVpZ2VuZVxyXG4vLyBFaW5zdGVsbHVuZyBoYXQpOyBudWxsLCB3ZW5uIGRlciBUWVAgc2VsYnN0IGtlaW5lIEZhcmJlIGhhdC5cclxuZnVuY3Rpb24gc3VidHlwZUNvbG9yKHNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKSB7XHJcbiAgY29uc3QgdHlwZUNvbG9yID0gc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXSA/PyBudWxsO1xyXG4gIGlmICghdHlwZUNvbG9yIHx8ICFzdWJ0eXBlKSByZXR1cm4gdHlwZUNvbG9yO1xyXG4gIGNvbnN0IG9mZnNldCA9IGNsYW1wZWRPZmZzZXQoc2V0dGluZ3MsIGdldFN1YnR5cGUoc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpPy5jb2xvcik7XHJcbiAgcmV0dXJuIGhhc0NvbG9yT2Zmc2V0KG9mZnNldCkgPyBhcHBseUNvbG9yT2Zmc2V0KHR5cGVDb2xvciwgb2Zmc2V0KSA6IHR5cGVDb2xvcjtcclxufVxyXG5cclxuLy8gSGF0IGRlciBTdWJ0eXAgZWluZSBlaWdlbmUgKGlubmVyaGFsYiBkZXIgR3JlbnplbiB3aXJrc2FtZSkgQWJ3ZWljaHVuZz9cclxuZnVuY3Rpb24gc3VidHlwZUhhc093bkNvbG9yKHNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKSB7XHJcbiAgcmV0dXJuIGhhc0NvbG9yT2Zmc2V0KGNsYW1wZWRPZmZzZXQoc2V0dGluZ3MsIGdldFN1YnR5cGUoc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpPy5jb2xvcikpO1xyXG59XHJcblxyXG4vLyBGYXJiZSwgaW4gZGVyIGVpbiBUWVAtIGJ6dy4gU3VidHlwLU5hbWUgZGFyZ2VzdGVsbHQgd2lyZCAtIGdlbWVpbnNhbWVcclxuLy8gR3J1bmRsYWdlIGZcdTAwRkNyIGRlbiBQaWNrZXIgKHJlbmRlckNvbG9yZWROYW1lL25hbWVDb2xvciBpbiB0eXBlLXBpY2tlci5qcykgdW5kXHJcbi8vIGRpZSBTdWJ0eXAtVm9yc2NoYXUgZGVyIFRZUC1MaXN0ZSAocmVuZGVyU3VidHlwZVByZXZpZXcgaW4gdHlwLXZpZXcuanMpLFxyXG4vLyBkYW1pdCBiZWlkZSBuaWNodCBhdXNlaW5hbmRlcmxhdWZlbi4gTWl0IHN1YnR5cGUgZGllIEZhcmJlIGRlcyBTdWJ0eXBzLFxyXG4vLyBhYmVyIG51ciB3ZW5uIGRlciBVbnRlci1TY2hhbHRlciBcIlN1YnR5cFwiIHZvbiBcIlRZUCBWaWV3XCIgZGFzIHp1bFx1MDBFNHNzdCAtIHNvbnN0XHJcbi8vIGRpZSBkZXMgVFlQcy4gaXNEZWZhdWx0ID0gU3RhbmRhcmR3ZXJ0LCBhbHNvIGhvaGxlciBSaW5nIHN0YXR0IGdlZlx1MDBGQ2xsdGVtXHJcbi8vIFB1bmt0IChzaWVoZSBwYWludENvbG9yRG90KTogZWluIFRZUCBvaG5lIEZhcmJlIGdyYXUsIGVpbiBTdWJ0eXAgb2huZSBlaWdlbmVcclxuLy8gQWJ3ZWljaHVuZyBpbiBkZXIgVFlQLUZhcmJlLCBkaWUgZXIgXHUwMEZDYmVybmltbXQuXHJcbmZ1bmN0aW9uIG5hbWVDb2xvcihzZXR0aW5ncywgdHlwZSwgc3VidHlwZSA9IG51bGwpIHtcclxuICBjb25zdCB1c2VTdWJ0eXBlID0gISFzdWJ0eXBlICYmIHNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdFN1YnR5cDtcclxuICBjb25zdCB0eXBlQ29sb3IgPSBzZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdID8/IG51bGw7XHJcbiAgcmV0dXJuIHtcclxuICAgIGNvbG9yOiAodXNlU3VidHlwZSA/IHN1YnR5cGVDb2xvcihzZXR0aW5ncywgdHlwZSwgc3VidHlwZSkgOiB0eXBlQ29sb3IpID8/IERFRkFVTFRfVFlQRV9DT0xPUixcclxuICAgIGlzRGVmYXVsdDogIXR5cGVDb2xvciB8fCAodXNlU3VidHlwZSAmJiAhc3VidHlwZUhhc093bkNvbG9yKHNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKSksXHJcbiAgfTtcclxufVxyXG5cclxuLy8gRmFyYnB1bmt0IChUWVAtTGlzdGUsIERldGFpbGFuc2ljaHQsIFBpY2tlciwgQmVzdFx1MDBFNHRpZ3VuZ2VuKTogZ2VmXHUwMEZDbGx0IGJlaVxyXG4vLyBlaW5lciBlaWdlbmVuIEZhcmJlLCBhbHMgaG9obGVyIFJpbmcgYmVpbSBTdGFuZGFyZHdlcnQgLSBlaW4gVFlQIG9obmUgRmFyYmVcclxuLy8gYWxzIGdyYXVlciBSaW5nLCBlaW4gU3VidHlwIG9obmUgZWlnZW5lIEVpbnN0ZWxsdW5nIGFscyBSaW5nIGluIGRlclxyXG4vLyBUWVAtRmFyYmUsIGRpZSBlciBcdTAwRkNiZXJuaW1tdC5cclxuZnVuY3Rpb24gcGFpbnRDb2xvckRvdChlbCwgY29sb3IsIGlzRGVmYXVsdCkge1xyXG4gIGVsLnN0eWxlLmJhY2tncm91bmRDb2xvciA9IGlzRGVmYXVsdCA/IFwidHJhbnNwYXJlbnRcIiA6IGNvbG9yO1xyXG4gIGVsLnN0eWxlLmJveFNoYWRvdyA9IGlzRGVmYXVsdCA/IGBpbnNldCAwIDAgMCBtYXgoMS41cHgsIDAuMTVlbSkgJHtjb2xvcn1gIDogXCJcIjtcclxufVxyXG5cclxuLy8gdmlld0tleSAob3B0aW9uYWwpOiBTY2hsXHUwMEZDc3NlbCBkZXIgQW5zaWNodCBpbiBjb2xvclZpZXdzIC0gaXN0IGRvcnQgZGVyXHJcbi8vIFVudGVyLVNjaGFsdGVyIFwiPHZpZXdLZXk+U3VidHlwXCIgYW4sIGdpbHQgZGllIEZhcmJlIGRlcyBTdWJ0eXBzIGRlciBOb3RpelxyXG4vLyBzdGF0dCBkZXIgaWhyZXMgVFlQcy5cclxuZnVuY3Rpb24gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSwgdmlld0tleSA9IG51bGwpIHtcclxuICBjb25zdCB0eXBlID0gcGx1Z2luLnR5cEluZGV4LnR5cGVPZihmaWxlKTtcclxuICBpZiAoIXR5cGUpIHJldHVybiBudWxsO1xyXG4gIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHBsdWdpbjtcclxuICBpZiAoIXZpZXdLZXkgfHwgIXNldHRpbmdzLmNvbG9yVmlld3NbYCR7dmlld0tleX1TdWJ0eXBgXSkgcmV0dXJuIHNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV0gPz8gbnVsbDtcclxuICByZXR1cm4gc3VidHlwZUNvbG9yKHNldHRpbmdzLCB0eXBlLCBwbHVnaW4udHlwSW5kZXguc3VidHlwZU9mKGZpbGUpKTtcclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSB7XHJcbiAgY29sb3JGb3JGaWxlLFxyXG4gIG5hbWVDb2xvcixcclxuICBERUZBVUxUX1RZUEVfQ09MT1IsXHJcbiAgc3VidHlwZUNvbG9yLFxyXG4gIGFwcGx5Q29sb3JPZmZzZXQsXHJcbiAgaGFzQ29sb3JPZmZzZXQsXHJcbiAgc3VidHlwZUhhc093bkNvbG9yLFxyXG4gIHBhaW50Q29sb3JEb3QsXHJcbiAgY29sb3JSYW5nZSxcclxuICBjaGFubmVsQm91bmRzLFxyXG4gIGNsYW1wZWRPZmZzZXQsXHJcbiAgU1VCVFlQRV9DT0xPUl9DSEFOTkVMUyxcclxuICBERUZBVUxUX1NVQlRZUEVfQ09MT1JfUkFOR0VTLFxyXG59O1xyXG4iLCAiY29uc3QgeyBQbHVnaW5TZXR0aW5nVGFiLCBTZXR0aW5nR3JvdXAsIFRvZ2dsZUNvbXBvbmVudCwgRHJvcGRvd25Db21wb25lbnQsIGRlYm91bmNlIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XHJcbmNvbnN0IHsgbW91bnRHbG9iYWxPcmRlckVkaXRvciB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItb3JkZXItZWRpdG9yXCIpO1xyXG5jb25zdCB7IERFRkFVTFRfR0xPQkFMX09SREVSIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1zb3J0XCIpO1xyXG5jb25zdCB7IFNVQlRZUEVfQ09MT1JfQ0hBTk5FTFMsIERFRkFVTFRfU1VCVFlQRV9DT0xPUl9SQU5HRVMsIGNvbG9yUmFuZ2UgfSA9IHJlcXVpcmUoXCIuL3R5cGUtY29sb3JzXCIpO1xyXG5cclxuY29uc3QgREVGQVVMVF9TRVRUSU5HUyA9IHtcclxuICB0eXBlczogW10sXHJcbiAgdHlwZUNvbG9yczoge30sXHJcbiAgdHlwZURlc2NyaXB0aW9uczoge30sXHJcbiAgdHlwZURlZmF1bHRGcm9udG1hdHRlcjoge30sXHJcbiAgLy8gS2V5cyBhdXMgdHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXSwgZGllIGFscyBcIkZsb2F0aW5nIFByb3BlcnR5XCIgbWFya2llcnRcclxuICAvLyBzaW5kIChzaWVoZSB0eXBlLWZyb250bWF0dGVyLWVkaXRvci5qcy90eXAtdmlldy5qcykgLSBUZWlsIGRlcnNlbGJlbiBMaXN0ZVxyXG4gIC8vIHVuZCBSZWloZW5mb2xnZSB3aWUgZGllIFx1MDBGQ2JyaWdlbiBTdGFuZGFyZC1Qcm9wZXJ0aWVzIGRlcyBUeXBzICh3aWNodGlnIGZcdTAwRkNyXHJcbiAgLy8gZGllIEZyb250bWF0dGVyLVNvcnRpZXJ1bmcsIHNpZWhlIG9yZGVyZWREZWZhdWx0S2V5cyBpbiBmcm9udG1hdHRlci1zb3J0LmpzKSxcclxuICAvLyBhYmVyIE5JQ0hUIFRlaWwgZGVzIHZvbiBnZXRUeXBlRGVmYXVsdHMoKSAobWFpbi5qcykgc3RhbmRhcmRtXHUwMEU0XHUwMERGaWdcclxuICAvLyBnZWxpZWZlcnRlbiBGcm9udG1hdHRlcnMgLSBUZW1wbGF0ZXIgbGVndCBzaWUgYmVpbSBBbmxlZ2VuIGVpbmVyIE5vdGl6IGFsc29cclxuICAvLyBuaWNodCBhdXRvbWF0aXNjaCBhbiAobnVyIFx1MDBGQ2JlciBkZW4gZXhwbGl6aXRlbiBpbmNsdWRlRmxvYXRpbmctUGFyYW1ldGVyKS5cclxuICB0eXBlRmxvYXRpbmdLZXlzOiB7fSxcclxuICAvLyBTaG9ydGN1dHMgamUgS2V5IGF1cyB0eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdOlxyXG4gIC8vICAgeyBbVFlQXTogeyBbUHJvcGVydHldOiB7IG5hbWU6IFwidG9kYXlcIiB8IFwidHAuPFNrcmlwdG5hbWU+XCIgfSB9IH1cclxuICAvLyBCZXd1c3N0IE5FQkVOIGRlbSBGcm9udG1hdHRlciBzdGF0dCBhbHMgZGVzc2VuIFdlcnQgLSBzaWVoZSBkaWUgQmVnclx1MDBGQ25kdW5nXHJcbiAgLy8gaW4gc2hvcnRjdXRzLmpzLiBEZXIgV2VydCBkZXIgUHJvcGVydHkgYmxlaWJ0IGRhZHVyY2ggdHlwcmVpbiAoT2JzaWRpYW5zXHJcbiAgLy8gbmF0aXZlcyBXaWRnZXQgYmxlaWJ0IHVuYW5nZXRhc3RldCkgdW5kIGRpZW50IGJlaSBnZXNldHp0ZW0gU2hvcnRjdXQgYWxzXHJcbiAgLy8gUlx1MDBGQ2NrZmFsbHdlcnQsIGZhbGxzIGRlc3NlbiBUZW1wbGF0ZXItU2tyaXB0IGZlaGxzY2hsXHUwMEU0Z3QuXHJcbiAgdHlwZVNob3J0Y3V0czoge30sXHJcbiAgdHlwZU1hbnVhbDoge30sXHJcbiAgLy8gUmVnaXN0cmllcnRlIFN1YnR5cGVuIGplIFRZUCBzYW10IGVpZ2VuZW0gRnJvbnRtYXR0ZXItQmxvY2ssIHNpZWhlIHN1YnR5cGVzLmpzLlxyXG4gIHR5cGVTdWJ0eXBlczoge30sXHJcbiAgLy8gU2llaGUgZnJvbnRtYXR0ZXItb3JkZXItZWRpdG9yLmpzIC8gZnJvbnRtYXR0ZXItc29ydC5qczogUmVpaGVuZm9sZ2UgYXVzXHJcbiAgLy8gZmVzdCBwb3NpdGlvbmllcnRlbiBFaW56ZWwtUHJvcGVydGllcyAoa2luZDogXCJwcm9wZXJ0eVwiKSBzb3dpZSBkZW4gdmllclxyXG4gIC8vIG5pY2h0IGVudGZlcm5iYXJlbiBQbGF0emhhbHRlcm4gXCJ0eXBWYWx1ZVwiIChUWVAtUHJvcGVydHkgc2VsYnN0KSxcclxuICAvLyBcInN1YnR5cFZhbHVlXCIgKFNVQlRZUC1Qcm9wZXJ0eSBzZWxic3QpLCBcInR5cFwiIChTdGFuZGFyZGxpc3RlIGRlcyBUeXBzKVxyXG4gIC8vIHVuZCBcIm90aGVyXCIgKGFsbGVzIFx1MDBEQ2JyaWdlKS5cclxuICBnbG9iYWxQcm9wZXJ0eU9yZGVyOiBERUZBVUxUX0dMT0JBTF9PUkRFUixcclxuICAvLyBTaWVoZSBhY3RpdmUtdGl0bGUtY29sb3JzLmpzOiB3aWUgZGVyIFRZUCBpbiBkZXIgZ2VcdTAwRjZmZm5ldGVuIE5vdGl6IG1hcmtpZXJ0XHJcbiAgLy8gd2lyZCAtIFwibm9uZVwiIChuaWNodHMpLCBcImRvdFwiIChGYXJicHVua3QgYW0gVGl0ZWwpIG9kZXIgXCJiYWRnZVwiIChCb3ggbWl0XHJcbiAgLy8gVFlQLU5hbWVuLCB3ZWl0ZXIga29uZmlndXJpZXJ0IFx1MDBGQ2JlciBkaWUgZHJlaSBmb2xnZW5kZW4gRWluc3RlbGx1bmdlbiwgZGllXHJcbiAgLy8gbnVyIGJlaSBcImJhZGdlXCIgXHUwMEZDYmVyaGF1cHQgZWluZSBSb2xsZSBzcGllbGVuIGJ6dy4gaW4gZGVuIEVpbnN0ZWxsdW5nZW5cclxuICAvLyBhbmdlemVpZ3Qgd2VyZGVuKS4gVW5hYmhcdTAwRTRuZ2lnIGRhdm9uIHVuZCBiZWxpZWJpZyBrb21iaW5pZXJiYXI6XHJcbiAgLy8gY29sb3JWaWV3cy5ub3RlVGl0bGVDb2xvciBmXHUwMEU0cmJ0IGRlbiBUaXRlbHRleHQgc2VsYnN0IGVpbi5cclxuICBub3RlVGl0bGVTdHlsZTogXCJkb3RcIixcclxuICAvLyBOdXIgcmVsZXZhbnQgYmVpIG5vdGVUaXRsZVN0eWxlOiBcImJhZGdlXCIgLSBvYiBkaWUgQm94IGZhcmJpZyAoVFlQLUZhcmJlKVxyXG4gIC8vIG9kZXIgbmV1dHJhbCAodGV4dC1tdXRlZCkgZGFyZ2VzdGVsbHQgd2lyZC5cclxuICBub3RlVGl0bGVCYWRnZUNvbG9yZWQ6IHRydWUsXHJcbiAgLy8gTnVyIHJlbGV2YW50IGJlaSBub3RlVGl0bGVTdHlsZTogXCJiYWRnZVwiIC0gQmVzY2hyaWZ0dW5nIGRlciBCb3g6IFwidHlwZVwiXHJcbiAgLy8gKFtUWVBdKSwgXCJ0eXBlLXN1YnR5cGVcIiAoW1RZUC9TdWJ0eXBdKSBvZGVyIFwic3VidHlwZVwiIChbU3VidHlwXSwgYmVpXHJcbiAgLy8gTm90aXplbiBvaG5lIFN1YnR5cCBrZWluZSBCb3gpLiBGYXJiZSAobWl0IG5vdGVUaXRsZUJhZGdlQ29sb3JlZClcclxuICAvLyBlbnRzcHJlY2hlbmQgZGllIGRlcyBUWVBzIGJ6dy4gZGVzIFN1YnR5cHMgLSBiZWkgXCJ0eXBlLXN1YnR5cGVcIiB3XHUwMEU0aGxiYXJcclxuICAvLyBcdTAwRkNiZXIgY29sb3JWaWV3cy5ub3RlVGl0bGVNYXJrZXJTdWJ0eXAgKFwiU3VidHlwLUZhcmJlXCIpLlxyXG4gIG5vdGVUaXRsZUJhZGdlTGFiZWw6IFwidHlwZVwiLFxyXG4gIC8vIE51ciByZWxldmFudCBiZWkgbm90ZVRpdGxlU3R5bGU6IFwiYmFkZ2VcIiAtIFwidGl0bGVcIiAobmViZW4gZGVtIElubGluZS1UaXRlbCxcclxuICAvLyBub3JtYWxlIEF1c3JpY2h0dW5nKSBvZGVyIFwiYmxvY2tcIiAobGlua3MgYW0gUHJvcGVydHktQmxvY2ssIHVtIDkwXHUwMEIwIGdlZHJlaHQpLlxyXG4gIG5vdGVUaXRsZUJhZGdlUG9zaXRpb246IFwidGl0bGVcIixcclxuICAvLyBOdXIgcmVsZXZhbnQgYmVpIG5vdGVUaXRsZUJhZGdlUG9zaXRpb246IFwiYmxvY2tcIiAtIG9iIGRpZSBnZWRyZWh0ZSBCb3ggYW1cclxuICAvLyBvYmVyZW4gb2RlciB1bnRlcmVuIFJhbmQgZGVzIFByb3BlcnR5LUJsb2NrcyBzaXR6dC5cclxuICBub3RlVGl0bGVWZXJ0aWNhbEFsaWduOiBcInRvcFwiLFxyXG4gIHR5cFNvcnRPcmRlcjogXCJjb3VudC1kZXNjXCIsXHJcbiAgLy8gV2FzIGluIGRlciBUWVAtTGlzdGUgcmVjaHRzIG5lYmVuIGRlbSBOYW1lbiBzdGVodCAtIFwiZGVzY3JpcHRpb25cIixcclxuICAvLyBcInN1YnR5cGVzXCIgb2RlciBcIm5vbmVcIi4gVW1nZXNjaGFsdGV0IHdpcmQgZGFzIG5pY2h0IGhpZXIsIHNvbmRlcm4gXHUwMEZDYmVyIGRlblxyXG4gIC8vIEtub3BmIGltIExpc3Rlbi1IZWFkZXIgbmViZW4gZGVyIFNvcnRpZXJ1bmcgKHNpZWhlIFNFQ09OREFSWV9NT0RFUyBpblxyXG4gIC8vIHR5cC12aWV3LmpzKSwgd2llIHNjaG9uIGRpZSBTb3J0aWVycmVpaGVuZm9sZ2U6IGJlaWRlcyBiZXRyaWZmdCBudXIgZGFzXHJcbiAgLy8gQXVzc2VoZW4gZGllc2VyIGVpbmVuIExpc3RlIHVuZCBnZWhcdTAwRjZydCBkYWhlciBhbiBzaWUgc2VsYnN0LCBuaWNodCBpbiBlaW5lXHJcbiAgLy8gRWluc3RlbGx1bmdzc2VpdGUsIGRpZSBtYW4gZGFmXHUwMEZDciBqZWRlcyBNYWwgXHUwMEY2ZmZuZW4gbVx1MDBGQ3NzdGUuXHJcbiAgdHlwTGlzdFNlY29uZGFyeTogXCJzdWJ0eXBlc1wiLFxyXG4gIC8vIFNpZWhlIHBpY2tUeXBlQW5kU3VidHlwZSBpbiB0eXBlLXBpY2tlci5qczogZmFsc2UgPSBTdWJ0eXBlbiBlaW5nZXJcdTAwRkNja3RcclxuICAvLyBkaXJla3QgaW0gVFlQLVBpY2tlciwgdHJ1ZSA9IGVpZ2VuZXIgU3VidHlwLVBpY2tlciBuYWNoIGRlciBUWVAtQXVzd2FobC5cclxuICBzZXBhcmF0ZVN1YnR5cGVQaWNrZXI6IGZhbHNlLFxyXG4gIGluY2x1ZGVJZ25vcmVkRmlsZXM6IGZhbHNlLFxyXG4gIC8vIEVpZ2VuZSBUYWctL0FuaFx1MDBFNG5nZS1GYXJiZSBpbSBHcmFwaCBkZWFrdGl2aWVydCAoMzAuMDkuMjAyNik6IGJlaWRlcyBpc3QgaW5cclxuICAvLyBkZW4gU3R5bGUgU2V0dGluZ3MgZGVzIE1pbmltYWwgVGhlbWUgZWluc3RlbGxiYXIsIHNpZWhlIGdyYXBoLWNvbG9ycy5qcy5cclxuICAvLyBncmFwaFRhZ0NvbG9yRW5hYmxlZDogZmFsc2UsXHJcbiAgLy8gZ3JhcGhUYWdDb2xvcjogXCJcIixcclxuICAvLyBncmFwaEF0dGFjaG1lbnRDb2xvckVuYWJsZWQ6IGZhbHNlLFxyXG4gIC8vIGdyYXBoQXR0YWNobWVudENvbG9yOiBcIlwiLFxyXG4gIC8vIFdpZSB3ZWl0IGRpZSBGYXJiZSBlaW5lcyBTdWJ0eXBzIGhcdTAwRjZjaHN0ZW5zIHZvbiBkZXIgc2VpbmVzIFRZUHMgYWJ3ZWljaGVuXHJcbiAgLy8gZGFyZiAoXHUwMEIxKSwgc2llaGUgdHlwZS1jb2xvcnMuanM6IEZhcmJ0b24gaW4gR3JhZCwgSGVsbGlna2VpdCBpbiAlIGRlcyBXZWdzXHJcbiAgLy8genUgV2VpXHUwMERGIGJ6dy4gU2Nod2Fyei5cclxuICBzdWJ0eXBlQ29sb3JSYW5nZXM6IHsgLi4uREVGQVVMVF9TVUJUWVBFX0NPTE9SX1JBTkdFUyB9LFxyXG4gIGNvbG9yVmlld3M6IHtcclxuICAgIGZpbGVFeHBsb3JlcjogdHJ1ZSxcclxuICAgIGdyYXBoOiB0cnVlLFxyXG4gICAgc2VhcmNoOiB0cnVlLFxyXG4gICAgcmVjZW50RmlsZXM6IHRydWUsXHJcbiAgICBiYWNrbGlua3M6IHRydWUsXHJcbiAgICBib29rbWFya3M6IHRydWUsXHJcbiAgICAvLyBVbnRlci1TY2hhbHRlciBcIjxBbnNpY2h0PlN1YnR5cFwiIGRlciBFaW5mXHUwMEU0cmJ1bmdlbjogRmFyYmUgZGVzIFN1YnR5cHNcclxuICAgIC8vIGVpbmVyIE5vdGl6IHN0YXR0IGRlciBpaHJlcyBUWVBzIChzaWVoZSBjb2xvckZvckZpbGUgaW4gdHlwZS1jb2xvcnMuanMpLlxyXG4gICAgZmlsZUV4cGxvcmVyU3VidHlwOiB0cnVlLFxyXG4gICAgZ3JhcGhTdWJ0eXA6IHRydWUsXHJcbiAgICBzZWFyY2hTdWJ0eXA6IHRydWUsXHJcbiAgICByZWNlbnRGaWxlc1N1YnR5cDogdHJ1ZSxcclxuICAgIGJhY2tsaW5rc1N1YnR5cDogdHJ1ZSxcclxuICAgIGJvb2ttYXJrc1N1YnR5cDogdHJ1ZSxcclxuICAgIGxpbmtzU3VidHlwOiB0cnVlLFxyXG4gICAgdHlwTGlzdFN1YnR5cDogdHJ1ZSxcclxuICAgIG5vdGVUaXRsZUNvbG9yU3VidHlwOiB0cnVlLFxyXG4gICAgbm90ZVRpdGxlTWFya2VyU3VidHlwOiB0cnVlLFxyXG4gICAgZnJvbnRtYXR0ZXJEZWZhdWx0czogdHJ1ZSxcclxuICAgIC8vIFVudGVyLVNjaGFsdGVyIHp1IGZyb250bWF0dGVyRGVmYXVsdHMgYnp3LiBhbGxQcm9wZXJ0aWVzOiBiZXppZWh0IGRpZVxyXG4gICAgLy8gRnJvbnRtYXR0ZXItQmxcdTAwRjZja2UgZGVyIFN1YnR5cGVuIG1pdCBlaW4gKHNpZWhlXHJcbiAgICAvLyBmcm9udG1hdHRlci1kZWZhdWx0LWhpZ2hsaWdodC5qcykgLSBiZWkgYWxsUHJvcGVydGllcyB6dWdsZWljaCBpbiBkZXJcclxuICAgIC8vIEZhcmJlIGRlcyBqZXdlaWxpZ2VuIFN1YnR5cHMuXHJcbiAgICBmcm9udG1hdHRlckRlZmF1bHRzU3VidHlwOiB0cnVlLFxyXG4gICAgdHlwTGlzdDogdHJ1ZSxcclxuICAgIGFsbFByb3BlcnRpZXM6IHRydWUsXHJcbiAgICBhbGxQcm9wZXJ0aWVzU3VidHlwOiB0cnVlLFxyXG4gICAgbm90ZVRpdGxlQ29sb3I6IHRydWUsXHJcbiAgICBsaW5rczogdHJ1ZSxcclxuICB9LFxyXG59O1xyXG5cclxuY2xhc3MgVHlwU3lzdGVtU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xyXG4gIGNvbnN0cnVjdG9yKGFwcCwgcGx1Z2luKSB7XHJcbiAgICBzdXBlcihhcHAsIHBsdWdpbik7XHJcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcclxuICB9XHJcblxyXG4gIC8vIEplZGVyIEFic2Nobml0dCBpc3QgZWluZSBTZXR0aW5nR3JvdXAgLSBPYnNpZGlhbnMgZWlnZW5lIEdydXBwaWVydW5nXHJcbiAgLy8gKFx1MDBEQ2JlcnNjaHJpZnQgKyBlaW5lIEJveCwgRWludHJcdTAwRTRnZSBkYXJpbiBkdXJjaCBUcmVubmxpbmllbiBnZXRyZW5udCksIHdpZVxyXG4gIC8vIGluIGRlbiBDb3JlLUVpbnN0ZWxsdW5nZW4uIEVpbnplbG4gcGVyIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKSBhbmdlbGVndGVcclxuICAvLyBFaW50clx1MDBFNGdlIHdcdTAwRkNyZGVuIHN0YXR0ZGVzc2VuIGplIGFscyBlaWdlbmUga2xlaW5lIEJveCBnZXJlbmRlcnQuXHJcbiAgZGlzcGxheSgpIHtcclxuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XHJcbiAgICAvLyBTY3JvbGwtUG9zaXRpb24gXHUwMEZDYmVyIGRlbiBOZXVhdWZiYXUgcmV0dGVuIChkaXNwbGF5KCkgd2lyZCBhdWNoIHZvblxyXG4gICAgLy8gU2NoYWx0ZXJuIG1pdCBVbnRlci1PcHRpb25lbiBhdWZnZXJ1ZmVuKTogZGFzIERyb3Bkb3duIGRlclxyXG4gICAgLy8gVFlQLU1hcmtpZXJ1bmcgbWlzc3Qgc2ljaCBiZWltIHNldFZhbHVlKCkgKHJlc2l6ZVRvRml0IGxpZXN0XHJcbiAgICAvLyBvZmZzZXRXaWR0aCkgdW5kIGVyendpbmd0IHNvIGVpbiBMYXlvdXQsIHNvbGFuZ2UgZGllIFNlaXRlIGVyc3QgYmlzXHJcbiAgICAvLyBkb3J0aGluIGF1ZmdlYmF1dCBpc3QgLSBkZXIgQnJvd3NlciBrYXBwdCBzY3JvbGxUb3AgZGFubiBhdWYgZGllc2VcclxuICAgIC8vIFRlaWxoXHUwMEY2aGUsIGRpZSBBbnNpY2h0IHNwclx1MDBFNG5nZSBuYWNoIG9iZW4uXHJcbiAgICBjb25zdCB7IHNjcm9sbFRvcCB9ID0gY29udGFpbmVyRWw7XHJcbiAgICBjb250YWluZXJFbC5lbXB0eSgpO1xyXG5cclxuICAgIG5ldyBTZXR0aW5nR3JvdXAoY29udGFpbmVyRWwpXHJcbiAgICAgIC5zZXRIZWFkaW5nKFwiVFlQLUxpc3RlXCIpXHJcbiAgICAgIC5hZGRTZXR0aW5nKChzZXR0aW5nKSA9PlxyXG4gICAgICAgIHNldHRpbmdcclxuICAgICAgICAgIC5zZXROYW1lKFwiSWdub3JpZXJ0ZSBOb3RpemVuIElNTUVSIGJlclx1MDBGQ2Nrc2ljaHRpZ2VuXCIpXHJcbiAgICAgICAgICAuc2V0RGVzYyhcclxuICAgICAgICAgICAgXCJCZXppZWh0IE5vdGl6ZW4gYXVzIE9ic2lkaWFucyBcXFwiRXhjbHVkZWQgZmlsZXNcXFwiLUxpc3RlIChkb3J0IHRyYWdlbiBhdWNoIFBsdWdpbnMgd2llIEhpZGUgRm9sZGVycyBhdXNnZWJsZW5kZXRlIE9yZG5lciBlaW4pIHdpZWRlciBpbiBUWVAtWlx1MDBFNGhsZXIsIFRZUC1QaWNrZXIgdW5kIGRpZSBGcm9udG1hdHRlci1Tb3J0aWVydW5nIG1pdCBlaW4sIHN0YXR0IHNpZSB6dSBcdTAwRkNiZXJzcHJpbmdlbi5cIlxyXG4gICAgICAgICAgKVxyXG4gICAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxyXG4gICAgICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuaW5jbHVkZUlnbm9yZWRGaWxlcykub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuaW5jbHVkZUlnbm9yZWRGaWxlcyA9IHZhbHVlO1xyXG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgICAgICAgICB9KVxyXG4gICAgICAgICAgKVxyXG4gICAgICApO1xyXG5cclxuICAgIG5ldyBTZXR0aW5nR3JvdXAoY29udGFpbmVyRWwpLnNldEhlYWRpbmcoXCJUWVAtUGlja2VyXCIpLmFkZFNldHRpbmcoKHNldHRpbmcpID0+XHJcbiAgICAgIHNldHRpbmdcclxuICAgICAgICAuc2V0TmFtZShcIlN1YnR5cC1QaWNrZXIgc2VwYXJhdFwiKVxyXG4gICAgICAgIC5zZXREZXNjKFxyXG4gICAgICAgICAgXCJCZWltIEFubGVnZW4gZWluZXIgTm90aXogZm9sZ3QgYXVmIGRlbiBUWVAtUGlja2VyIGVpbiBlaWdlbmVyIFN1YnR5cC1QaWNrZXIgKEVTQyBkb3J0IGZcdTAwRkNocnQgenVyXHUwMEZDY2sgenVyIFRZUC1BdXN3YWhsKSwgc3RhdHQgZGllIFN1YnR5cGVuIGRpcmVrdCBlaW5nZXJcdTAwRkNja3QgdW50ZXIgaWhyZW0gVFlQIGltIFRZUC1QaWNrZXIgYW56dXplaWdlbi4gRGVyIFRZUC1QaWNrZXIgbmVubnQgZGllIFN1YnR5cGVuIGRhbm4gaGludGVyIGRlbSBUWVAtTmFtZW4uXCJcclxuICAgICAgICApXHJcbiAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxyXG4gICAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLnNlcGFyYXRlU3VidHlwZVBpY2tlcikub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnNlcGFyYXRlU3VidHlwZVBpY2tlciA9IHZhbHVlO1xyXG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgIH0pXHJcbiAgICAgICAgKVxyXG4gICAgKTtcclxuXHJcbiAgICAvLyBzdWJ0eXBLZXkgKG9wdGlvbmFsKTogc3RhdHQgZWluZXMgZWluemVsbmVuIFNjaGFsdGVycyB6d2VpIGJlc2NocmlmdGV0ZVxyXG4gICAgLy8gdW50ZXJlaW5hbmRlciAod2llIGRpZSBVbnRlci1TY2hhbHRlciBiZWkgXCJCb3ggbWl0IFRZUC1OYW1lblwiLCBzaWVoZVxyXG4gICAgLy8gdW50ZW4pIC0gXCJUWVBcIiBmXHUwMEZDciBkZW4gZWlnZW50bGljaGVuIFNjaGFsdGVyLCBkYXJ1bnRlciBcIlN1YnR5cFwiLCBudXJcclxuICAgIC8vIHNpY2h0YmFyLCBzb2xhbmdlIFwiVFlQXCIgYW4gaXN0LiBEaWUgVG9vbHRpcHMgcGFzc2VuIHN0YW5kYXJkbVx1MDBFNFx1MDBERmlnIHp1IGRlblxyXG4gICAgLy8gRWluZlx1MDBFNHJidW5nZW4gKFN1YnR5cCA9IEZhcmJlIGRlcyBTdWJ0eXBzIHN0YXR0IGRlciBkZXMgVFlQcykuXHJcbiAgICBjb25zdCBjb2xvclZpZXdUb2dnbGUgPSAoXHJcbiAgICAgIGdyb3VwLFxyXG4gICAgICBrZXksXHJcbiAgICAgIG5hbWUsXHJcbiAgICAgIGRlc2MsXHJcbiAgICAgIHN1YnR5cEtleSA9IG51bGwsXHJcbiAgICAgIHsgdHlwVG9vbHRpcCA9IFwiTmFjaCBUWVAtRmFyYmUgZWluZlx1MDBFNHJiZW5cIiwgc3VidHlwVG9vbHRpcCA9IFwiRmFyYmUgZGVzIFN1YnR5cHMgc3RhdHQgZGVyIGRlcyBUWVBzIHZlcndlbmRlblwiIH0gPSB7fVxyXG4gICAgKSA9PlxyXG4gICAgICBncm91cC5hZGRTZXR0aW5nKChzZXR0aW5nKSA9PiB7XHJcbiAgICAgICAgc2V0dGluZy5zZXROYW1lKG5hbWUpLnNldERlc2MoZGVzYyk7XHJcbiAgICAgICAgY29uc3Qgc2F2ZSA9IGFzeW5jIChzZXR0aW5nS2V5LCB2YWx1ZSkgPT4ge1xyXG4gICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3c1tzZXR0aW5nS2V5XSA9IHZhbHVlO1xyXG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBpZiAoIXN1YnR5cEtleSkge1xyXG4gICAgICAgICAgc2V0dGluZy5hZGRUb2dnbGUoKHRvZ2dsZSkgPT4gdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Nba2V5XSkub25DaGFuZ2UoKHZhbHVlKSA9PiBzYXZlKGtleSwgdmFsdWUpKSk7XHJcbiAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBzZXR0aW5nLnNldHRpbmdFbC5hZGRDbGFzcyhcImZyZWQtbm90ZS10aXRsZS1zZXR0aW5nXCIpO1xyXG4gICAgICAgIGNvbnN0IGFkZFJvdyA9IChsYWJlbCwgdG9vbHRpcCwgc2V0dGluZ0tleSwgb25DaGFuZ2VkKSA9PiB7XHJcbiAgICAgICAgICBjb25zdCByb3cgPSBzZXR0aW5nLmNvbnRyb2xFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC1ub3RlLXRpdGxlLXRvZ2dsZS1yb3dcIiB9KTtcclxuICAgICAgICAgIHJvdy5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtbm90ZS10aXRsZS10b2dnbGUtbGFiZWxcIiwgdGV4dDogbGFiZWwgfSk7XHJcbiAgICAgICAgICBuZXcgVG9nZ2xlQ29tcG9uZW50KHJvdylcclxuICAgICAgICAgICAgLnNldFRvb2x0aXAodG9vbHRpcClcclxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Nbc2V0dGluZ0tleV0pXHJcbiAgICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgICAgICAgICBhd2FpdCBzYXZlKHNldHRpbmdLZXksIHZhbHVlKTtcclxuICAgICAgICAgICAgICBvbkNoYW5nZWQ/LigpO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICB9O1xyXG4gICAgICAgIGFkZFJvdyhcIlRZUFwiLCB0eXBUb29sdGlwLCBrZXksICgpID0+IHRoaXMuZGlzcGxheSgpKTtcclxuICAgICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3c1trZXldKSBhZGRSb3coXCJTdWJ0eXBcIiwgc3VidHlwVG9vbHRpcCwgc3VidHlwS2V5KTtcclxuICAgICAgfSk7XHJcblxyXG4gICAgY29uc3QgY29sb3JpbmdHcm91cCA9IG5ldyBTZXR0aW5nR3JvdXAoY29udGFpbmVyRWwpLnNldEhlYWRpbmcoXCJFaW5mXHUwMEU0cmJ1bmdcIik7XHJcblxyXG4gICAgY29sb3JWaWV3VG9nZ2xlKGNvbG9yaW5nR3JvdXAsIFwiZmlsZUV4cGxvcmVyXCIsIFwiRGF0ZWktRXhwbG9yZXJcIiwgXCJOb3Rpem5hbWVuIGltIERhdGVpLUV4cGxvcmVyIG5hY2ggVFlQIGVpbmZcdTAwRTRyYmVuLlwiLCBcImZpbGVFeHBsb3JlclN1YnR5cFwiKTtcclxuICAgIGNvbG9yVmlld1RvZ2dsZShjb2xvcmluZ0dyb3VwLCBcImdyYXBoXCIsIFwiR3JhcGhcIiwgXCJLbm90ZW4gaW0gR3JhcGggKGdsb2JhbCB1bmQgbG9rYWwpIG5hY2ggVFlQIGVpbmZcdTAwRTRyYmVuLlwiLCBcImdyYXBoU3VidHlwXCIpO1xyXG4gICAgY29sb3JWaWV3VG9nZ2xlKGNvbG9yaW5nR3JvdXAsIFwic2VhcmNoXCIsIFwiU3VjaGVcIiwgXCJUcmVmZmVyLVRpdGVsIGluIGRlciBTdWNoZSBuYWNoIFRZUCBlaW5mXHUwMEU0cmJlbi5cIiwgXCJzZWFyY2hTdWJ0eXBcIik7XHJcbiAgICBjb2xvclZpZXdUb2dnbGUoY29sb3JpbmdHcm91cCwgXCJyZWNlbnRGaWxlc1wiLCBcIlJlY2VudCBGaWxlc1wiLCBcIkVpbnRyXHUwMEU0Z2UgaW0gUmVjZW50LUZpbGVzLVBsdWdpbiBuYWNoIFRZUCBlaW5mXHUwMEU0cmJlbi5cIiwgXCJyZWNlbnRGaWxlc1N1YnR5cFwiKTtcclxuICAgIGNvbG9yVmlld1RvZ2dsZShcclxuICAgICAgY29sb3JpbmdHcm91cCxcclxuICAgICAgXCJsaW5rc1wiLFxyXG4gICAgICBcIkxpbmtzIGluIE5vdGl6ZW5cIixcclxuICAgICAgXCJJbnRlcm5lIExpbmtzIGltIE5vdGl6dGV4dCAoTGVzZS1Nb2R1cywgTGl2ZSBQcmV2aWV3LCBIb3Zlci1Wb3JzY2hhdSkgaW4gZGVyIEZhcmJlIGRlcyBUWVBzIGlocmVzIFppZWxzIGRhcnN0ZWxsZW4uIE5pY2h0IGF1ZmdlbFx1MDBGNnN0ZSBMaW5rcyBibGVpYmVuIHVudmVyXHUwMEU0bmRlcnQuXCIsXHJcbiAgICAgIFwibGlua3NTdWJ0eXBcIlxyXG4gICAgKTtcclxuICAgIGNvbG9yVmlld1RvZ2dsZShcclxuICAgICAgY29sb3JpbmdHcm91cCxcclxuICAgICAgXCJ0eXBMaXN0XCIsXHJcbiAgICAgIFwiVFlQIFZpZXdcIixcclxuICAgICAgXCJUeXAtTmFtZW4gaW4gZGVyIFRZUC1WaWV3IHNlbGJzdCAoTGlzdGUgdW5kIERldGFpbGFuc2ljaHQpIHVuZCBpbSBUWVAtUGlja2VyIGluIGlocmVyIGpld2VpbGlnZW4gRmFyYmUgZGFyc3RlbGxlbi4gTWl0IFxcXCJTdWJ0eXBcXFwiIGF1Y2ggZGllIFN1YnR5cGVuIGluIGlocmVyIGVpZ2VuZW4gRmFyYmUuXCIsXHJcbiAgICAgIFwidHlwTGlzdFN1YnR5cFwiXHJcbiAgICApO1xyXG4gICAgY29sb3JWaWV3VG9nZ2xlKFxyXG4gICAgICBjb2xvcmluZ0dyb3VwLFxyXG4gICAgICBcIm5vdGVUaXRsZUNvbG9yXCIsXHJcbiAgICAgIFwiVGl0ZWwtVGV4dCBlaW5mXHUwMEU0cmJlblwiLFxyXG4gICAgICBcIkZcdTAwRTRyYnQgZGVuIElubGluZS1UaXRlbCBkZXIgZ2VcdTAwRjZmZm5ldGVuIE5vdGl6IHNlbGJzdCBpbiBkZXIgRmFyYmUgaWhyZXMgVFlQcyBlaW4gLSB1bmFiaFx1MDBFNG5naWcgdm9uIGRlciBUWVAtTWFya2llcnVuZyBkYW5lYmVuIChzLiB1LiksIGJlaWRlcyBsXHUwMEU0c3N0IHNpY2gga29tYmluaWVyZW4uXCIsXHJcbiAgICAgIFwibm90ZVRpdGxlQ29sb3JTdWJ0eXBcIlxyXG4gICAgKTtcclxuXHJcbiAgICAvLyBQcm9ncmVzc2l2ZSBPZmZlbmxlZ3VuZzogYmVpIG5vdGVUaXRsZVN0eWxlIFwiYmFkZ2VcIiBrb21tZW4gd2VpdGVyZVxyXG4gICAgLy8gU2NoYWx0ZXIgZGlyZWt0IGluIGRpZXNlciBlaW5lbiBTZXR0aW5nLVplaWxlIGRhenUgKEZhcmJlLCBQb3NpdGlvbiksXHJcbiAgICAvLyBiZWkgUG9zaXRpb24gXCJibG9ja1wiIG5vY2ggZWluIGRyaXR0ZXIgKEF1c3JpY2h0dW5nKSAtIGpld2VpbHMgcGVyXHJcbiAgICAvLyB0aGlzLmRpc3BsYXkoKSBuZXUgZ2VyZW5kZXJ0LCBkYW1pdCBudXIgZGllIGdlcmFkZSByZWxldmFudGVuIFNjaGFsdGVyXHJcbiAgICAvLyBlcnNjaGVpbmVuLCBzdGF0dCBwZXJtYW5lbnQgYWxsZSBhbnp1emVpZ2VuIGJ6dy4gZWlnZW5lIFplaWxlbiB6dSBiZWxlZ2VuLlxyXG4gICAgY29uc3QgaXNCYWRnZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVN0eWxlID09PSBcImJhZGdlXCI7XHJcbiAgICBjb25zdCBpc0Jsb2NrUG9zaXRpb24gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZVBvc2l0aW9uID09PSBcImJsb2NrXCI7XHJcblxyXG4gICAgY29sb3JpbmdHcm91cC5hZGRTZXR0aW5nKChub3RlVGl0bGVTZXR0aW5nKSA9PiB7XHJcbiAgICAgIG5vdGVUaXRsZVNldHRpbmdcclxuICAgICAgICAuc2V0TmFtZShcIlRZUC1NYXJraWVydW5nIGluIGRlciBOb3RpelwiKVxyXG4gICAgICAgIC5zZXREZXNjKFxyXG4gICAgICAgICAgaXNCYWRnZVxyXG4gICAgICAgICAgICA/ICdcIkJveCBtaXQgVFlQLU5hbWVuXCIgLSBCZXNjaHJpZnR1bmcsIFNjaGFsdGVyOiBmYXJiaWcvbmV1dHJhbCwgYW0gVGl0ZWwvYW0gUHJvcGVydHktQmxvY2sgKGdlZHJlaHQpJyArXHJcbiAgICAgICAgICAgICAgICAoaXNCbG9ja1Bvc2l0aW9uID8gXCIsIG9iZW4vdW50ZW4gYW0gUHJvcGVydHktQmxvY2tcIiA6IFwiXCIpICtcclxuICAgICAgICAgICAgICAgIFwiLlwiXHJcbiAgICAgICAgICAgIDogXCJXaWUgZGVyIFRZUCBpbiBkZXIgZ2VcdTAwRjZmZm5ldGVuIE5vdGl6IG1hcmtpZXJ0IHdpcmQuXCJcclxuICAgICAgICApXHJcbiAgICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT5cclxuICAgICAgICAgIGRyb3Bkb3duXHJcbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJub25lXCIsIFwiTmljaHRzXCIpXHJcbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJkb3RcIiwgXCJGYXJicHVua3QgYW0gVGl0ZWxcIilcclxuICAgICAgICAgICAgLmFkZE9wdGlvbihcImJhZGdlXCIsIFwiQm94IG1pdCBUWVAtTmFtZW5cIilcclxuICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVN0eWxlKVxyXG4gICAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlU3R5bGUgPSB2YWx1ZTtcclxuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcclxuICAgICAgICAgICAgfSlcclxuICAgICAgICApO1xyXG5cclxuICAgICAgLy8gXCJTdWJ0eXBcIiAoRmFyYmUgZGVzIFN1YnR5cHMgc3RhdHQgZGVyIGRlcyBUWVBzKSBudXIsIHNvbGFuZ2UgZGllXHJcbiAgICAgIC8vIE1hcmtpZXJ1bmcgXHUwMEZDYmVyaGF1cHQgZmFyYmlnIGlzdDogYmVpbSBQdW5rdCBpbW1lciwgYmVpIGRlciBCb3ggbnVyXHJcbiAgICAgIC8vIG1pdCBcIkZhcmJpZ1wiIHVuZCBCZXNjaHJpZnR1bmcgW1RZUC9TdWJ0eXBdIC0gYmVpIFtUWVBdIGJ6dy4gW1N1YnR5cF1cclxuICAgICAgLy8gZm9sZ3QgZGllIEZhcmJlIGRlciBCZXNjaHJpZnR1bmcuXHJcbiAgICAgIGNvbnN0IGJhZGdlTGFiZWwgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUxhYmVsID8/IFwidHlwZVwiO1xyXG4gICAgICBjb25zdCBzaG93U3VidHlwID1cclxuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVTdHlsZSA9PT0gXCJkb3RcIiB8fFxyXG4gICAgICAgIChpc0JhZGdlICYmIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlQ29sb3JlZCAmJiBiYWRnZUxhYmVsID09PSBcInR5cGUtc3VidHlwZVwiKTtcclxuICAgICAgaWYgKCFpc0JhZGdlICYmICFzaG93U3VidHlwKSByZXR1cm47XHJcblxyXG4gICAgICAvLyBFaWdlbmUgS2xhc3NlLCBkYW1pdCBkaWUgYmVpIFwiYmFkZ2VcIiB6dXNcdTAwRTR0emxpY2ggYW5nZWhcdTAwRTRuZ3RlbiBTY2hhbHRlclxyXG4gICAgICAvLyBzdGF0dCBuZWJlbmVpbmFuZGVyIChPYnNpZGlhbnMgU3RhbmRhcmQtTGF5b3V0IGZcdTAwRkNyIG1laHJlcmUgQ29udHJvbHMgaW5cclxuICAgICAgLy8gZWluZXIgU2V0dGluZy1aZWlsZSkgdW50ZXJlaW5hbmRlciBzdGVoZW4gLSBzaWVoZVxyXG4gICAgICAvLyAuZnJlZC1ub3RlLXRpdGxlLXNldHRpbmcgaW4gc3R5bGVzLmNzcy5cclxuICAgICAgbm90ZVRpdGxlU2V0dGluZy5zZXR0aW5nRWwuYWRkQ2xhc3MoXCJmcmVkLW5vdGUtdGl0bGUtc2V0dGluZ1wiKTtcclxuXHJcbiAgICAgIC8vIEVpZ2VuZXMga2xlaW5lcyBMYWJlbCBqZSBTY2hhbHRlciBzdGF0dCBudXIgVG9vbHRpcCAtIGFkZFRvZ2dsZSgpIGFsbGVpblxyXG4gICAgICAvLyBoXHUwMEU0bmd0IG51ciBkZW4gbmFja3RlbiBTY2hhbHRlciBvaG5lIEJlc2NocmlmdHVuZyBhbiwgZGFoZXIgaGllciBlaW5lXHJcbiAgICAgIC8vIGVpZ2VuZSBaZWlsZSAoTGFiZWwgKyBUb2dnbGVDb21wb25lbnQpIGRpcmVrdCBpbiBjb250cm9sRWwgZ2ViYXV0LlxyXG4gICAgICBjb25zdCBhZGRMYWJlbGVkVG9nZ2xlID0gKGxhYmVsLCB0b29sdGlwLCB2YWx1ZSwgb25DaGFuZ2UpID0+IHtcclxuICAgICAgICBjb25zdCByb3cgPSBub3RlVGl0bGVTZXR0aW5nLmNvbnRyb2xFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC1ub3RlLXRpdGxlLXRvZ2dsZS1yb3dcIiB9KTtcclxuICAgICAgICByb3cuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLW5vdGUtdGl0bGUtdG9nZ2xlLWxhYmVsXCIsIHRleHQ6IGxhYmVsIH0pO1xyXG4gICAgICAgIG5ldyBUb2dnbGVDb21wb25lbnQocm93KS5zZXRUb29sdGlwKHRvb2x0aXApLnNldFZhbHVlKHZhbHVlKS5vbkNoYW5nZShvbkNoYW5nZSk7XHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCBhZGRTdWJ0eXBUb2dnbGUgPSAobGFiZWwpID0+XHJcbiAgICAgICAgYWRkTGFiZWxlZFRvZ2dsZShcclxuICAgICAgICAgIGxhYmVsLFxyXG4gICAgICAgICAgXCJGYXJiZSBkZXMgU3VidHlwcyBzdGF0dCBkZXIgZGVzIFRZUHMgdmVyd2VuZGVuXCIsXHJcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLm5vdGVUaXRsZU1hcmtlclN1YnR5cCxcclxuICAgICAgICAgIGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLm5vdGVUaXRsZU1hcmtlclN1YnR5cCA9IHZhbHVlO1xyXG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgKTtcclxuXHJcbiAgICAgIGlmICghaXNCYWRnZSkge1xyXG4gICAgICAgIGFkZFN1YnR5cFRvZ2dsZShcIlN1YnR5cFwiKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IGxhYmVsUm93ID0gbm90ZVRpdGxlU2V0dGluZy5jb250cm9sRWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtbm90ZS10aXRsZS10b2dnbGUtcm93XCIgfSk7XHJcbiAgICAgIGxhYmVsUm93LmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC1ub3RlLXRpdGxlLXRvZ2dsZS1sYWJlbFwiLCB0ZXh0OiBcIkJlc2NocmlmdHVuZ1wiIH0pO1xyXG4gICAgICBuZXcgRHJvcGRvd25Db21wb25lbnQobGFiZWxSb3cpXHJcbiAgICAgICAgLmFkZE9wdGlvbihcInR5cGVcIiwgXCJbVFlQXVwiKVxyXG4gICAgICAgIC5hZGRPcHRpb24oXCJ0eXBlLXN1YnR5cGVcIiwgXCJbVFlQL1N1YnR5cF1cIilcclxuICAgICAgICAuYWRkT3B0aW9uKFwic3VidHlwZVwiLCBcIltTdWJ0eXBdXCIpXHJcbiAgICAgICAgLnNldFZhbHVlKGJhZGdlTGFiZWwpXHJcbiAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VMYWJlbCA9IHZhbHVlO1xyXG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgYWRkTGFiZWxlZFRvZ2dsZShcIkZhcmJpZ1wiLCBcIkZhcmJpZyAoVFlQLUZhcmJlKSBzdGF0dCBuZXV0cmFsXCIsIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlQ29sb3JlZCwgYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VDb2xvcmVkID0gdmFsdWU7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbiAgICAgICAgdGhpcy5kaXNwbGF5KCk7XHJcbiAgICAgIH0pO1xyXG4gICAgICBpZiAoc2hvd1N1YnR5cCkgYWRkU3VidHlwVG9nZ2xlKFwiU3VidHlwLUZhcmJlXCIpO1xyXG5cclxuICAgICAgYWRkTGFiZWxlZFRvZ2dsZShcIkFtIFByb3BlcnR5LUJsb2NrXCIsIFwiQW0gUHJvcGVydHktQmxvY2sgKGdlZHJlaHQpIHN0YXR0IGFtIFRpdGVsXCIsIGlzQmxvY2tQb3NpdGlvbiwgYXN5bmMgKHZhbHVlKSA9PiB7XHJcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VQb3NpdGlvbiA9IHZhbHVlID8gXCJibG9ja1wiIDogXCJ0aXRsZVwiO1xyXG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgICAgIHRoaXMuZGlzcGxheSgpO1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGlmIChpc0Jsb2NrUG9zaXRpb24pIHtcclxuICAgICAgICBhZGRMYWJlbGVkVG9nZ2xlKFxyXG4gICAgICAgICAgXCJPYmVuIHN0YXR0IHVudGVuXCIsXHJcbiAgICAgICAgICBcIk9iZW4gc3RhdHQgdW50ZW4gYW0gUHJvcGVydHktQmxvY2tcIixcclxuICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVZlcnRpY2FsQWxpZ24gPT09IFwidG9wXCIsXHJcbiAgICAgICAgICBhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlVmVydGljYWxBbGlnbiA9IHZhbHVlID8gXCJ0b3BcIiA6IFwiYm90dG9tXCI7XHJcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICApO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgICBjb2xvclZpZXdUb2dnbGUoXHJcbiAgICAgIGNvbG9yaW5nR3JvdXAsXHJcbiAgICAgIFwiYmFja2xpbmtzXCIsXHJcbiAgICAgIFwiQmFja2xpbmtzXCIsXHJcbiAgICAgIFwiVHJlZmZlcnplaWxlbiBpbSBCYWNrbGlua3MtUGFuZSBzb3dpZSBpbiBkZW4gaW0gRG9rdW1lbnQgZWluZ2ViZXR0ZXRlbiBCYWNrbGlua3MgKGlua2wuIG5pY2h0IHZlcmxpbmt0ZXIgRXJ3XHUwMEU0aG51bmdlbikgbmFjaCBUWVAgZWluZlx1MDBFNHJiZW4uXCIsXHJcbiAgICAgIFwiYmFja2xpbmtzU3VidHlwXCJcclxuICAgICk7XHJcbiAgICBjb2xvclZpZXdUb2dnbGUoXHJcbiAgICAgIGNvbG9yaW5nR3JvdXAsXHJcbiAgICAgIFwiYm9va21hcmtzXCIsXHJcbiAgICAgIFwiQm9va21hcmtzXCIsXHJcbiAgICAgIFwiRWludHJcdTAwRTRnZSBpbSBCb29rbWFya3MtUGFuZSwgZGllIGRpcmVrdCBhdWYgZWluZSBOb3RpeiB6ZWlnZW4sIG5hY2ggVFlQIGVpbmZcdTAwRTRyYmVuLlwiLFxyXG4gICAgICBcImJvb2ttYXJrc1N1YnR5cFwiXHJcbiAgICApO1xyXG4gICAgY29sb3JWaWV3VG9nZ2xlKFxyXG4gICAgICBjb2xvcmluZ0dyb3VwLFxyXG4gICAgICBcImFsbFByb3BlcnRpZXNcIixcclxuICAgICAgXCJBbGwgUHJvcGVydGllc1wiLFxyXG4gICAgICBcIkluIE9ic2lkaWFucyB2YXVsdC13ZWl0ZXIgXFxcIkFsbCBQcm9wZXJ0aWVzXFxcIi1BbnNpY2h0IFByb3BlcnR5LU5hbWVuIGVpbmZcdTAwRTRyYmVuLCBkaWUgaW0gVFlQLUZyb250bWF0dGVyIGdlbmF1IGVpbmVzIFRZUHMgdm9ya29tbWVuIChpbiBkZXNzZW4gRmFyYmUpIC0ga29tbWVuIHNpZSBiZWkgbWVocmVyZW4gVFlQcyB2b3IsIHN0YXR0ZGVzc2VuIGZldHQgc3RhdHQgZWluZ2VmXHUwMEU0cmJ0LiBNaXQgXFxcIlN1YnR5cFxcXCIgelx1MDBFNGhsZW4gYXVjaCBkaWUgRnJvbnRtYXR0ZXItQmxcdTAwRjZja2UgZGVyIFN1YnR5cGVuIGZcdTAwRkNyIGlocmVuIGpld2VpbGlnZW4gVFlQLCBlaW5nZWZcdTAwRTRyYnQgaW4gZGVyIEZhcmJlIGRlcyBTdWJ0eXBzLlwiLFxyXG4gICAgICBcImFsbFByb3BlcnRpZXNTdWJ0eXBcIixcclxuICAgICAgeyB0eXBUb29sdGlwOiBcIlRZUC1Gcm9udG1hdHRlciBkZXIgVFlQZW5cIiwgc3VidHlwVG9vbHRpcDogXCJGcm9udG1hdHRlci1CbFx1MDBGNmNrZSBkZXIgU3VidHlwZW4gbWl0IGVpbmJlemllaGVuLCBpbiBTdWJ0eXAtRmFyYmVcIiB9XHJcbiAgICApO1xyXG5cclxuICAgIC8vIEdyZW56ZW4gZGVyIGRyZWkgUmVnbGVyLCBtaXQgZGVuZW4gZWluIFN1YnR5cCBzZWluZSBGYXJiZSB2b24gZGVyIHNlaW5lc1xyXG4gICAgLy8gVFlQcyBhYmxlaXRldCAoRmFyYnB1bmt0IHVudGVuIGltIFN1YnR5cC1CbG9jayBkZXIgVFlQLURldGFpbGFuc2ljaHQsXHJcbiAgICAvLyBzaWVoZSB0eXBlLWNvbG9ycy5qcykuIEVpbmUgc2Nob24gZWluZ2VzdGVsbHRlLCBnclx1MDBGNlx1MDBERmVyZSBBYndlaWNodW5nIHdpcmRcclxuICAgIC8vIGF1ZiBkaWUgbmV1ZSBHcmVuemUgZ2VrYXBwdC5cclxuICAgIGNvbnN0IHN1YnR5cGVDb2xvckdyb3VwID0gbmV3IFNldHRpbmdHcm91cChjb250YWluZXJFbCkuc2V0SGVhZGluZyhcIlN1YnR5cC1GYXJiZW5cIik7XHJcbiAgICBjb25zdCByYW5nZU1heCA9IHsgaDogMTgwLCAvKiBzOiAxMDAsICovIGw6IDEwMCB9O1xyXG4gICAgY29uc3QgcmFuZ2VEZXNjID0ge1xyXG4gICAgICBoOiBcIldpZSB3ZWl0IGRlciBGYXJidG9uIGVpbmVzIFN1YnR5cHMgaFx1MDBGNmNoc3RlbnMgdm9uIGRlbSBzZWluZXMgVFlQcyBhYndlaWNoZW4gZGFyZiAoXHUwMEIxIEdyYWQpLlwiLFxyXG4gICAgICAvLyBzOiBcIldpZSBibGFzcyBlaW4gU3VidHlwIGdlZ2VuXHUwMEZDYmVyIHNlaW5lbSBUWVAgaFx1MDBGNmNoc3RlbnMgd2VyZGVuIGRhcmYgKFByb3plbnQgZGVyIFRZUC1TXHUwMEU0dHRpZ3VuZykuIERlciBSZWdsZXIgZ2VodCBudXIgbmFjaCB1bnRlbiAtIGtyXHUwMEU0ZnRpZ2VyIGFscyBkaWUgSGF1cHRmYXJiZSBzb2xsIGVpbiBTdWJ0eXAgbmljaHQgd2VyZGVuLlwiLFxyXG4gICAgICBsOiBcIldpZSB3ZWl0IGRpZSBIZWxsaWdrZWl0IGVpbmVzIFN1YnR5cHMgaFx1MDBGNmNoc3RlbnMgdm9uIGRlciBzZWluZXMgVFlQcyBhYndlaWNoZW4gZGFyZiAoXHUwMEIxIFByb3plbnQgZGVzIFdlZ3MgenUgV2VpXHUwMERGIGJ6dy4gU2Nod2FyeiAtIDEwMCAlIHdcdTAwRTRyZSByZWluZXMgV2VpXHUwMERGIGJ6dy4gU2Nod2FyeikuXCIsXHJcbiAgICB9O1xyXG4gICAgLy8gRGVyIFJlZ2xlciBtZWxkZXQgamVkZSBad2lzY2hlbnN0ZWxsdW5nIC0gZGllIFx1MDBGQ2JyaWdlbiBBbnNpY2h0ZW4gZXJzdFxyXG4gICAgLy8gbmFjaHppZWhlbiwgd2VubiBlciBrdXJ6IHJ1aHQuXHJcbiAgICBjb25zdCByZWZyZXNoQ29sb3JzU29vbiA9IGRlYm91bmNlKCgpID0+IHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpLCAzMDAsIHRydWUpO1xyXG4gICAgZm9yIChjb25zdCB7IGtleSwgbGFiZWwsIHVuaXQsIGRvd25Pbmx5IH0gb2YgU1VCVFlQRV9DT0xPUl9DSEFOTkVMUykge1xyXG4gICAgICBzdWJ0eXBlQ29sb3JHcm91cC5hZGRTZXR0aW5nKChzZXR0aW5nKSA9PlxyXG4gICAgICAgIHNldHRpbmdcclxuICAgICAgICAgIC5zZXROYW1lKGAke2xhYmVsfSAoJHtkb3duT25seSA/IFwiXHUyMjEyXCIgOiBcIlx1MDBCMVwifSAke3VuaXR9KWApXHJcbiAgICAgICAgICAuc2V0RGVzYyhyYW5nZURlc2Nba2V5XSlcclxuICAgICAgICAgIC5hZGRTbGlkZXIoKHNsaWRlcikgPT5cclxuICAgICAgICAgICAgc2xpZGVyXHJcbiAgICAgICAgICAgICAgLnNldExpbWl0cygwLCByYW5nZU1heFtrZXldLCAxKVxyXG4gICAgICAgICAgICAgIC5zZXRWYWx1ZShjb2xvclJhbmdlKHRoaXMucGx1Z2luLnNldHRpbmdzLCBrZXkpKVxyXG4gICAgICAgICAgICAgIC5zZXREeW5hbWljVG9vbHRpcCgpXHJcbiAgICAgICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Muc3VidHlwZUNvbG9yUmFuZ2VzID0geyAuLi5ERUZBVUxUX1NVQlRZUEVfQ09MT1JfUkFOR0VTLCAuLi50aGlzLnBsdWdpbi5zZXR0aW5ncy5zdWJ0eXBlQ29sb3JSYW5nZXMsIFtrZXldOiB2YWx1ZSB9O1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAgICAgICAgICAgICByZWZyZXNoQ29sb3JzU29vbigpO1xyXG4gICAgICAgICAgICAgIH0pXHJcbiAgICAgICAgICApXHJcbiAgICAgICAgICAuYWRkRXh0cmFCdXR0b24oKGJ1dHRvbikgPT5cclxuICAgICAgICAgICAgYnV0dG9uXHJcbiAgICAgICAgICAgICAgLnNldEljb24oXCJyb3RhdGUtY2N3XCIpXHJcbiAgICAgICAgICAgICAgLnNldFRvb2x0aXAoYFp1clx1MDBGQ2Nrc2V0emVuIGF1ZiAke0RFRkFVTFRfU1VCVFlQRV9DT0xPUl9SQU5HRVNba2V5XX1gKVxyXG4gICAgICAgICAgICAgIC5vbkNsaWNrKGFzeW5jICgpID0+IHtcclxuICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnN1YnR5cGVDb2xvclJhbmdlcyA9IHsgLi4uREVGQVVMVF9TVUJUWVBFX0NPTE9SX1JBTkdFUywgLi4udGhpcy5wbHVnaW4uc2V0dGluZ3Muc3VidHlwZUNvbG9yUmFuZ2VzLCBba2V5XTogREVGQVVMVF9TVUJUWVBFX0NPTE9SX1JBTkdFU1trZXldIH07XHJcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XHJcbiAgICAgICAgICAgICAgfSlcclxuICAgICAgICAgIClcclxuICAgICAgKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBHcnVwcGUgXCJHcmFwaFwiIChUYWctL0FuaFx1MDBFNG5nZS1GYXJiZSkgZGVha3RpdmllcnQgKDMwLjA5LjIwMjYpOiBiZWlkZXMgaXN0IGltXHJcbiAgICAvLyBNaW5pbWFsIFRoZW1lIFx1MDBGQ2JlciBkaWUgU3R5bGUgU2V0dGluZ3MgZWluc3RlbGxiYXIsIHNpZWhlIGdyYXBoLWNvbG9ycy5qcy5cclxuICAgIC8vIERpZSBUWVAtRWluZlx1MDBFNHJidW5nIGRlciBOb3Rpei1Lbm90ZW4gYmxlaWJ0IGFrdGl2LCBTY2hhbHRlciBvYmVuIHVudGVyXHJcbiAgICAvLyBcIkVpbmZcdTAwRTRyYnVuZ1wiIFx1MjE5MiBcIkdyYXBoXCIuXHJcbiAgICAvLyAgICAgY29uc3QgZ3JhcGhHcm91cCA9IG5ldyBTZXR0aW5nR3JvdXAoY29udGFpbmVyRWwpLnNldEhlYWRpbmcoXCJHcmFwaFwiKTtcclxuICAgIC8vXHJcbiAgICAvLyAgICAgLy8gRWluIFNldHRpbmcgcHJvIE5vZGUtVHlwLCBkZW4gT2JzaWRpYW5zIEdyYXBoLUVuZ2luZSBrZW5udCAtIGdsZWljaGVyXHJcbiAgICAvLyAgICAgLy8gQXVmYmF1IChUb2dnbGUgKyBGYXJid2FobCArIFp1clx1MDBGQ2Nrc2V0emVuKSBmXHUwMEZDciBqZWRlbiwgZGFoZXIgYWxzIEhlbHBlclxyXG4gICAgLy8gICAgIC8vIHN0YXR0IGR1cGxpemllcnQuXHJcbiAgICAvLyAgICAgY29uc3QgZ3JhcGhDb2xvclNldHRpbmcgPSAoZW5hYmxlZEtleSwgY29sb3JLZXksIGRlZmF1bHRDb2xvciwgbmFtZSwgZGVzYykgPT5cclxuICAgIC8vICAgICAgIGdyYXBoR3JvdXAuYWRkU2V0dGluZygoc2V0dGluZykgPT5cclxuICAgIC8vICAgICAgICAgc2V0dGluZ1xyXG4gICAgLy8gICAgICAgICAgIC5zZXROYW1lKG5hbWUpXHJcbiAgICAvLyAgICAgICAgICAgLnNldERlc2MoZGVzYylcclxuICAgIC8vICAgICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XHJcbiAgICAvLyAgICAgICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3NbZW5hYmxlZEtleV0pLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgLy8gICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5nc1tlbmFibGVkS2V5XSA9IHZhbHVlO1xyXG4gICAgLy8gICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcclxuICAgIC8vICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbiAgICAvLyAgICAgICAgICAgICB9KVxyXG4gICAgLy8gICAgICAgICAgIClcclxuICAgIC8vICAgICAgICAgICAuYWRkQ29sb3JQaWNrZXIoKHBpY2tlcikgPT5cclxuICAgIC8vICAgICAgICAgICAgIHBpY2tlci5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5nc1tjb2xvcktleV0gfHwgZGVmYXVsdENvbG9yKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgIC8vICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3NbY29sb3JLZXldID0gdmFsdWU7XHJcbiAgICAvLyAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgLy8gICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcclxuICAgIC8vICAgICAgICAgICAgIH0pXHJcbiAgICAvLyAgICAgICAgICAgKVxyXG4gICAgLy8gICAgICAgICAgIC5hZGRFeHRyYUJ1dHRvbigoYnV0dG9uKSA9PlxyXG4gICAgLy8gICAgICAgICAgICAgYnV0dG9uXHJcbiAgICAvLyAgICAgICAgICAgICAgIC5zZXRJY29uKFwicm90YXRlLWNjd1wiKVxyXG4gICAgLy8gICAgICAgICAgICAgICAuc2V0VG9vbHRpcChcIlp1clx1MDBGQ2Nrc2V0emVuIGF1ZiBTdGFuZGFyZGZhcmJlXCIpXHJcbiAgICAvLyAgICAgICAgICAgICAgIC5vbkNsaWNrKGFzeW5jICgpID0+IHtcclxuICAgIC8vICAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5nc1tjb2xvcktleV0gPSBcIlwiO1xyXG4gICAgLy8gICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xyXG4gICAgLy8gICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG4gICAgLy8gICAgICAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xyXG4gICAgLy8gICAgICAgICAgICAgICB9KVxyXG4gICAgLy8gICAgICAgICAgIClcclxuICAgIC8vICAgICAgICk7XHJcbiAgICAvL1xyXG4gICAgLy8gICAgIGdyYXBoQ29sb3JTZXR0aW5nKFxyXG4gICAgLy8gICAgICAgXCJncmFwaFRhZ0NvbG9yRW5hYmxlZFwiLFxyXG4gICAgLy8gICAgICAgXCJncmFwaFRhZ0NvbG9yXCIsXHJcbiAgICAvLyAgICAgICBcIiM4ODg4ODhcIixcclxuICAgIC8vICAgICAgIFwiVGFnLUZhcmJlXCIsXHJcbiAgICAvLyAgICAgICBcIkVpZ2VuZSBGYXJiZSBmXHUwMEZDciBUYWctS25vdGVuIGltIEdyYXBoIChnbG9iYWwgdW5kIGxva2FsKSB2ZXJ3ZW5kZW4gc3RhdHQgZGVyIFN0YW5kYXJkZmFyYmUuIEVpZ2VuZSBGYXJiZ3J1cHBlbiBpbSBHcmFwaCBoYWJlbiB3ZWl0ZXJoaW4gVm9ycmFuZy5cIlxyXG4gICAgLy8gICAgICk7XHJcbiAgICAvLyAgICAgZ3JhcGhDb2xvclNldHRpbmcoXHJcbiAgICAvLyAgICAgICBcImdyYXBoQXR0YWNobWVudENvbG9yRW5hYmxlZFwiLFxyXG4gICAgLy8gICAgICAgXCJncmFwaEF0dGFjaG1lbnRDb2xvclwiLFxyXG4gICAgLy8gICAgICAgXCIjZTBhYzAwXCIsXHJcbiAgICAvLyAgICAgICBcIkFuaFx1MDBFNG5nZS1GYXJiZVwiLFxyXG4gICAgLy8gICAgICAgXCJFaWdlbmUgRmFyYmUgZlx1MDBGQ3IgQW5oYW5nLUtub3RlbiAoTmljaHQtTWFya2Rvd24tRGF0ZWllbiB3aWUgQmlsZGVyIG9kZXIgUERGcykgaW0gR3JhcGggdmVyd2VuZGVuIHN0YXR0IGRlciBTdGFuZGFyZGZhcmJlLlwiXHJcbiAgICAvLyAgICAgKTtcclxuXHJcbiAgICBjb25zdCBmcm9udG1hdHRlckdyb3VwID0gbmV3IFNldHRpbmdHcm91cChjb250YWluZXJFbCkuc2V0SGVhZGluZyhcIlRZUC1Gcm9udG1hdHRlclwiKTtcclxuXHJcbiAgICBjb2xvclZpZXdUb2dnbGUoXHJcbiAgICAgIGZyb250bWF0dGVyR3JvdXAsXHJcbiAgICAgIFwiZnJvbnRtYXR0ZXJEZWZhdWx0c1wiLFxyXG4gICAgICBcIlByb3BlcnR5LU5hbWVuIGZldHQgbWFya2llcmVuXCIsXHJcbiAgICAgIFwiSW4gTm90aXplbiAoRnJvbnRtYXR0ZXIgaW0gRG9rdW1lbnQgc293aWUgUHJvcGVydGllcy1TZWl0ZW5sZWlzdGUpIGRpZSBOYW1lbiBkZXIgUHJvcGVydGllcyBmZXR0IGRhcnN0ZWxsZW4sIGRpZSBpbSBUWVAtRnJvbnRtYXR0ZXIgZGVzIGpld2VpbGlnZW4gVFlQcyBoaW50ZXJsZWd0IHNpbmQuIE1pdCBcXFwiU3VidHlwXFxcIiB6dXNcdTAwRTR0emxpY2ggZGllIGF1cyBkZW0gRnJvbnRtYXR0ZXItQmxvY2sgaWhyZXMgU1VCVFlQcy5cIixcclxuICAgICAgXCJmcm9udG1hdHRlckRlZmF1bHRzU3VidHlwXCIsXHJcbiAgICAgIHsgdHlwVG9vbHRpcDogXCJUWVAtRnJvbnRtYXR0ZXIgZGVyIFRZUGVuXCIsIHN1YnR5cFRvb2x0aXA6IFwiRnJvbnRtYXR0ZXItQmxcdTAwRjZja2UgZGVyIFN1YnR5cGVuIG1pdCBlaW5iZXppZWhlblwiIH1cclxuICAgICk7XHJcblxyXG4gICAgLy8gT3JkZXItRWRpdG9yIHNhbXQgQmVzY2hyZWlidW5nIGFscyBlaWdlbmVyIEVpbnRyYWcgZGVyc2VsYmVuIEdydXBwZSAtXHJcbiAgICAvLyBicmluZ3QgXHUwMERDYmVyc2NocmlmdCB1bmQgQnV0dG9ucyBzZWxic3QgbWl0LCBkYWhlciBkaXJla3QgaW4gaW5mb0VsIHN0YXR0XHJcbiAgICAvLyBcdTAwRkNiZXIgc2V0TmFtZS9zZXREZXNjIChzaWVoZSAuZnJlZC1vcmRlci1zZXR0aW5nIGluIHN0eWxlcy5jc3MpLlxyXG4gICAgZnJvbnRtYXR0ZXJHcm91cC5hZGRTZXR0aW5nKChzZXR0aW5nKSA9PiB7XHJcbiAgICAgIHNldHRpbmcuc2V0dGluZ0VsLmFkZENsYXNzKFwiZnJlZC1vcmRlci1zZXR0aW5nXCIpO1xyXG4gICAgICBtb3VudEdsb2JhbE9yZGVyRWRpdG9yKHNldHRpbmcuaW5mb0VsLCB0aGlzLnBsdWdpbik7XHJcbiAgICAgIHNldHRpbmcuaW5mb0VsLmNyZWF0ZURpdih7XHJcbiAgICAgICAgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiLFxyXG4gICAgICAgIHRleHQ6XHJcbiAgICAgICAgICAnQmVzdGltbXQgZGllIFJlaWhlbmZvbGdlLCBpbiBkZXIgZGllIEJlZmVobGUgXCJGcm9udG1hdHRlciBTb3J0aWVydW5nIGFrdHVhbGlzaWVyZW5cIiBkaWUgaW4gZWluZXIgTm90aXogdm9yaGFuZGVuZW4gUHJvcGVydGllcyBhbm9yZG5lbiAoZXJnXHUwMEU0bnp0IG9kZXIgXHUwMEU0bmRlcnQga2VpbmUgV2VydGUpLiBFaW56ZWxuZSBQcm9wZXJ0aWVzICh6LiBCLiBjc3NjbGFzc2VzLCBhbGlhc2VzKSBsYXNzZW4gc2ljaCBmZXN0IHBsYXR6aWVyZW4gLSBcIlRZUFwiIGlzdCBkaWUgVFlQLVByb3BlcnR5IHNlbGJzdCwgXCJTVUJUWVBcIiBhbmFsb2cgZGllIFNVQlRZUC1Qcm9wZXJ0eSwgXCJUWVAtRnJvbnRtYXR0ZXJcIiBzdGVodCBmXHUwMEZDciBkaWUgVFlQLUZyb250bWF0dGVyLUxpc3RlIGRlcyBqZXdlaWxpZ2VuIFR5cHMgc2FtdCBkYWhpbnRlciBkZW0gQmxvY2sgc2VpbmVzIFNVQlRZUHMsIFwiU29uc3RpZ2UgUHJvcGVydGllc1wiIGZcdTAwRkNyIGFsbGVzIFx1MDBEQ2JyaWdlLiBSZWloZW5mb2xnZSBwZXIgRHJhZyAmIERyb3AgXHUwMEU0bmRlcmJhciwgZGllIHZpZXIgUGxhdHpoYWx0ZXItWmVpbGVuIGxhc3NlbiBzaWNoIG5pY2h0IGVudGZlcm5lbi4nLFxyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnRhaW5lckVsLnNjcm9sbFRvcCA9IHNjcm9sbFRvcDtcclxuICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0geyBERUZBVUxUX1NFVFRJTkdTLCBUeXBTeXN0ZW1TZXR0aW5nVGFiIH07XHJcbiIsICJjb25zdCB7IE5vdGljZSB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBzb3J0QWxsRnJvbnRtYXR0ZXIsIHNvcnRTaW5nbGVGaWxlRnJvbnRtYXR0ZXIgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLXNvcnRcIik7XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyQ29tbWFuZHMocGx1Z2luKSB7XG5cbiAgLy8gT2JzaWRpYW4gYXdhaXRlZCBkZW4gY2FsbGJhY2sgZWluZXIgQmVmZWhsc2RlZmluaXRpb24gbmljaHQgdW5kIGZcdTAwRTRuZ3QgYXVjaFxuICAvLyBrZWluZSBGZWhsZXIgYWIgLSBlaW5lIEV4Y2VwdGlvbiBkYXJpbiB3XHUwMEZDcmRlIHNvbnN0IGxhdXRsb3MgdmVyc2Nod2luZGVuXG4gIC8vIChudXIgZWluIEVpbnRyYWcgaW4gZGVyIEVudHdpY2tsZXJrb25zb2xlLCBrZWluZSBzaWNodGJhcmUgUlx1MDBGQ2NrbWVsZHVuZykuXG4gIC8vIERpZXNlIGRyZWkgU29ydGllcmJlZmVobGUgbGF1ZmVuIGRlc2hhbGIgXHUwMEZDYmVyIHJ1bk9yUmVwb3J0RXJyb3IoKSwgZGFtaXRcbiAgLy8gaW0gRmVobGVyZmFsbCB0cm90emRlbSBpbW1lciBlaW5lIE5vdGljZSBlcnNjaGVpbnQgc3RhdHQgZ2FyIGtlaW5lLlxuICBjb25zdCBydW5PclJlcG9ydEVycm9yID0gKGxhYmVsLCBmbikgPT4gYXN5bmMgKCkgPT4ge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBmbigpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKGBbJHtsYWJlbH1dYCwgZXJyb3IpO1xuICAgICAgbmV3IE5vdGljZShgJHtsYWJlbH0gZmVobGdlc2NobGFnZW46ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICB9XG4gIH07XG5cbiAgcGx1Z2luLmFkZENvbW1hbmQoe1xuICAgIGlkOiBcImZyb250bWF0dGVyLXNvcnRpZXJ1bmctYWxsZVwiLFxuICAgIG5hbWU6IFwiRnJvbnRtYXR0ZXIgU29ydGllcnVuZyBHTE9CQUwgYWt0dWFsaXNpZXJlblwiLFxuICAgIGNhbGxiYWNrOiBydW5PclJlcG9ydEVycm9yKFwiRnJvbnRtYXR0ZXIgU29ydGllcnVuZ1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB7IGNoZWNrZWQsIGNoYW5nZWQgfSA9IGF3YWl0IHNvcnRBbGxGcm9udG1hdHRlcihwbHVnaW4uYXBwLCBwbHVnaW4sIG51bGwpO1xuICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgY2hhbmdlZCA+IDBcbiAgICAgICAgICA/IGBGcm9udG1hdHRlciBTb3J0aWVydW5nOiAke2NoZWNrZWR9IE5vdGl6ZW4gZ2Vwclx1MDBGQ2Z0LCAke2NoYW5nZWR9IHNvcnRpZXJ0LmBcbiAgICAgICAgICA6IGBGcm9udG1hdHRlciBTb3J0aWVydW5nOiAke2NoZWNrZWR9IE5vdGl6ZW4gZ2Vwclx1MDBGQ2Z0LCBiZXJlaXRzIGFsbGUgc29ydGllcnQuYFxuICAgICAgKTtcbiAgICB9KSxcbiAgfSk7XG5cbiAgcGx1Z2luLmFkZENvbW1hbmQoe1xuICAgIGlkOiBcImZyb250bWF0dGVyLXNvcnRpZXJ1bmctdHlwXCIsXG4gICAgbmFtZTogXCJGcm9udG1hdHRlciBTb3J0aWVydW5nIGZcdTAwRkNyIFRZUCBha3R1YWxpc2llcmVuXCIsXG4gICAgY2FsbGJhY2s6IHJ1bk9yUmVwb3J0RXJyb3IoXCJGcm9udG1hdHRlciBTb3J0aWVydW5nXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIERlcnNlbGJlIFRZUC1QaWNrZXIgd2llIFx1MDBGQ2JlcmFsbCBzb25zdCBpbSBQbHVnaW4gKHNpZWhlIHR5cGUtcGlja2VyLmpzKSAtXG4gICAgICAvLyB6ZWlndCBGYXJiZSwgQmVzY2hyZWlidW5nIHVuZCBOb3Rpei1BbnphaGwgc3RhdHQgZWluZXIgcmVpbmVuIE5hbWVuc2xpc3RlXG4gICAgICAvLyAodW5kIG1lbGRldCBzZWxic3QsIGZhbGxzIGVzIGdhciBrZWluZSBUWVBlbiBnaWJ0KS4gaW5jbHVkZU1hbnVhbE9mZiB1bmRcbiAgICAgIC8vIGluY2x1ZGVVbnJlZ2lzdGVyZWQ6IHRydWUsIGRhIGRpZSBTb3J0aWVydW5nIHVuYWJoXHUwMEU0bmdpZyBkYXZvbiBzaW5udm9sbFxuICAgICAgLy8gaXN0LCBvYiBlaW4gVFlQIG1hbnVlbGwgdmVyZ2ViZW4gd2VyZGVuIGRhcmYgKHouIEIuIEtPTlRBS1QsIEVYVEVSTilcbiAgICAgIC8vIG9kZXIgXHUwMEZDYmVyaGF1cHQgaW4gZGVyIFRZUC1MaXN0ZSByZWdpc3RyaWVydCBpc3QuXG4gICAgICBjb25zdCB0eXBlID0gYXdhaXQgcGx1Z2luLnBpY2tUeXBlKHsgaW5jbHVkZU1hbnVhbE9mZjogdHJ1ZSwgaW5jbHVkZVVucmVnaXN0ZXJlZDogdHJ1ZSB9KTtcbiAgICAgIGlmICghdHlwZSkgcmV0dXJuO1xuICAgICAgY29uc3QgeyBjaGVja2VkLCBjaGFuZ2VkLCBoYXNUeXBlRGVmYXVsdHMgfSA9IGF3YWl0IHNvcnRBbGxGcm9udG1hdHRlcihwbHVnaW4uYXBwLCBwbHVnaW4sIHR5cGUpO1xuICAgICAgbGV0IG1lc3NhZ2UgPVxuICAgICAgICBjaGFuZ2VkID4gMFxuICAgICAgICAgID8gYEZyb250bWF0dGVyIFNvcnRpZXJ1bmcgJHt0eXBlfTogJHtjaGVja2VkfSBOb3RpemVuIGdlcHJcdTAwRkNmdCwgJHtjaGFuZ2VkfSBzb3J0aWVydC5gXG4gICAgICAgICAgOiBgRnJvbnRtYXR0ZXIgU29ydGllcnVuZyAke3R5cGV9OiAke2NoZWNrZWR9IE5vdGl6ZW4gZ2Vwclx1MDBGQ2Z0LCBiZXJlaXRzIGFsbGUgc29ydGllcnQuYDtcbiAgICAgIC8vIEtlaW4gRmVobGVyLCBhYmVyIG9obmUgVFlQLUZyb250bWF0dGVyIGdyZWlmdCBmXHUwMEZDciBkaWVzZW4gVHlwIG51clxuICAgICAgLy8gZGllIGdsb2JhbGUgUmVpaGVuZm9sZ2UgKFRZUCBzZWxic3QsIGZlc3QgcG9zaXRpb25pZXJ0ZSBQcm9wZXJ0aWVzKSAtXG4gICAgICAvLyBvaG5lIGRpZXNlbiBIaW53ZWlzIHdcdTAwRTRyZSB1bmtsYXIsIHdhcnVtIHNpY2ggZ2dmLiBuaWNodHMgZ2VcdTAwRTRuZGVydCBoYXQuXG4gICAgICBpZiAoaGFzVHlwZURlZmF1bHRzID09PSBmYWxzZSkge1xuICAgICAgICBtZXNzYWdlICs9IGAgSGlud2VpczogRlx1MDBGQ3IgJHt0eXBlfSBpc3Qga2VpbiBUWVAtRnJvbnRtYXR0ZXIgaGludGVybGVndCAtIG51ciBkaWUgZ2xvYmFsZSBSZWloZW5mb2xnZSB3dXJkZSBhbmdld2VuZGV0LmA7XG4gICAgICB9XG4gICAgICBuZXcgTm90aWNlKG1lc3NhZ2UpO1xuICAgIH0pLFxuICB9KTtcblxuICBwbHVnaW4uYWRkQ29tbWFuZCh7XG4gICAgaWQ6IFwiZnJvbnRtYXR0ZXItc29ydGllcnVuZy1ha3RpdmUtbm90aXpcIixcbiAgICBuYW1lOiBcIkZyb250bWF0dGVyIFNvcnRpZXJ1bmcgZGVyIGFrdGl2ZW4gTm90aXogYWt0dWFsaXNpZXJlblwiLFxuICAgIGNoZWNrQ2FsbGJhY2s6IChjaGVja2luZykgPT4ge1xuICAgICAgY29uc3QgZmlsZSA9IHBsdWdpbi5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICAgIGlmICghZmlsZSB8fCBmaWxlLmV4dGVuc2lvbiAhPT0gXCJtZFwiKSByZXR1cm4gZmFsc2U7XG4gICAgICBpZiAoY2hlY2tpbmcpIHJldHVybiB0cnVlO1xuXG4gICAgICBydW5PclJlcG9ydEVycm9yKFwiRnJvbnRtYXR0ZXIgU29ydGllcnVuZ1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGNoYW5nZWQgPSBhd2FpdCBzb3J0U2luZ2xlRmlsZUZyb250bWF0dGVyKHBsdWdpbi5hcHAsIHBsdWdpbiwgZmlsZSk7XG4gICAgICAgIG5ldyBOb3RpY2UoY2hhbmdlZCA/IGBGcm9udG1hdHRlciB2b24gXCIke2ZpbGUuYmFzZW5hbWV9XCIgc29ydGllcnQuYCA6IGBGcm9udG1hdHRlciB2b24gXCIke2ZpbGUuYmFzZW5hbWV9XCIgd2FyIGJlcmVpdHMgc29ydGllcnQuYCk7XG4gICAgICB9KSgpO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSxcbiAgfSk7XG5cbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyQ29tbWFuZHMgfTtcbiIsICJjb25zdCB7IG1vbWVudCB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuXG4vLyBFaW4gU2hvcnRjdXQgaXN0IGVpbiBWZXJ3ZWlzIGF1ZiBlaW5lbiBlcnN0IGJlaW0gQW5sZWdlbiBlaW5lciBOb3RpelxuLy8gYmVyZWNobmV0ZW4gV2VydC4gRXIgc3RlaHQgYmV3dXNzdCBOSUNIVCBpbSBGcm9udG1hdHRlci1XZXJ0IGRlciBQcm9wZXJ0eSxcbi8vIHNvbmRlcm4gZGFuZWJlbiAtIGluIHNldHRpbmdzLnR5cGVTaG9ydGN1dHNbVFlQXVtrZXldIGZcdTAwRkNyIGRhcyBUWVAtRnJvbnRtYXR0ZXJcbi8vIGJ6dy4gaW0gc2hvcnRjdXRzLU9iamVrdCBkZXMgamV3ZWlsaWdlbiBTdWJ0eXAtQmxvY2tzIChzaWVoZSBzdWJ0eXBlcy5qcyk6XG4vLyAgIHsgbmFtZTogXCJ0b2RheVwiIH0gICAgICAgICAgICAtIGZlc3RlciBUb2tlbiwgaGllciBpbSBQbHVnaW4gYXVmZ2VsXHUwMEY2c3Rcbi8vICAgeyBuYW1lOiBcInRwLjxTa3JpcHRuYW1lPlwiIH0gIC0gVGVtcGxhdGVyLVNrcmlwdCwgbnVyIHZvbiBUWVAuanMgYXVmbFx1MDBGNnNiYXJcbi8vICAgeyBuYW1lOiBcInRwLjxTa3JpcHRuYW1lPlwiLCBhcmdzOiB7IG9yZG5lcjogXCJMaXRlcmF0dXJcIiwgamFocjogMjAyNCB9IH1cbi8vICAgICAtIGRhc3NlbGJlIG1pdCBBcmd1bWVudGVuLiBEaWUgUGFyYW1ldGVybmFtZW4gZGVrbGFyaWVydCBkYXMgU2tyaXB0XG4vLyAgICAgICBzZWxic3QgaW0gQHR5cC1zaG9ydGN1dC1NYXJrZXIgKHNpZWhlIHNob3J0Y3V0LXNjcmlwdHMuanMpOyBUWVAuanNcbi8vICAgICAgIHJlaWNodCBkYXMgT2JqZWt0IGFscyBjdHguYXJncyBkdXJjaC4gRmVzdGUgVG9rZW4gaGFiZW4gbmllIEFyZ3VtZW50ZS5cbi8vXG4vLyBXYXJ1bSBkYW5lYmVuIHN0YXR0IGltIFdlcnQ6IE9ic2lkaWFucyBQcm9wZXJ0eS1XaWRnZXQgYmVzdGltbXQgZGFzXG4vLyBFaW5nYWJlZmVsZCBlaW5lciBaZWlsZSBhdXMgZGVtIGluIHR5cGVzLmpzb24gZGVrbGFyaWVydGVuIFR5cCBkZXIgUHJvcGVydHlcbi8vIChnZXRUeXBlSW5mbyBpbSBnZWJhdXRlbiBhcHAuanMpLiBCZWkgZWluZXIgYWxzIFwiZGF0ZVwiL1wibnVtYmVyXCIvXCJjaGVja2JveFwiXG4vLyBkZWtsYXJpZXJ0ZW4gUHJvcGVydHkgaXN0IGRhcyBlaW4gPGlucHV0IHR5cGU9XCJkYXRlXCI+LCBlaW5cbi8vIDxpbnB1dCB0eXBlPVwibnVtYmVyXCI+IGJ6dy4gZWluIFRvZ2dsZSAtIGRvcnQgbGllXHUwMERGIHNpY2ggZWluIFRva2VuIHdpZVxuLy8gXCJ7e3RvZGF5fX1cIiBnYXIgbmljaHQgZXJzdCBlaW50aXBwZW4sIGVpbiB0cm90emRlbSBnZXNwZWljaGVydGVyIFdlcnQgbFx1MDBGNnN0ZVxuLy8gT2JzaWRpYW5zIFwiVHlwZSBtaXNtYXRjaFwiLVdhcm51bmcgYXVzLCB1bmQgZGFzIExpc3Rlbi1XaWRnZXQgbWFjaHRlIGF1cyBlaW5lbVxuLy8gU3RyaW5nIGJlaW0gZXJzdGVuIEJlYXJiZWl0ZW4gc3RpbGxzY2h3ZWlnZW5kIGVpbiBBcnJheSAob25DaGFuZ2UoZS5zbGljZSgpKSkuXG4vLyBBbGxlIGRpZXNlIFByb2JsZW1lIGhhYmVuIGRpZXNlbGJlIFVyc2FjaGU6IGVpbiBGcmVtZGtcdTAwRjZycGVyIGluIGVpbmVtIFNsb3QsXG4vLyBkZXNzZW4gRGF0ZW50eXAgT2JzaWRpYW4ga29udHJvbGxpZXJ0LiBMaWVndCBkZXIgU2hvcnRjdXQgZGFuZWJlbiwgYmxlaWJ0IGRlclxuLy8gV2VydCB0eXByZWluIHVuZCBkYXMgbmF0aXZlIFdpZGdldCB1bmFuZ2V0YXN0ZXQgLSBlcyBicmF1Y2h0IGRhZlx1MDBGQ3Iga2VpbmVybGVpXG4vLyBFaW5ncmlmZiBpbiBPYnNpZGlhbnMgWmVpbGVuLVJlbmRlcmluZy5cbi8vXG4vLyBEZXIgRnJvbnRtYXR0ZXItV2VydCBkZXIgUHJvcGVydHkgYmxlaWJ0IGRhYmVpIGVyaGFsdGVuIHVuZCBkaWVudCBhbHNcbi8vIFJcdTAwRENDS0ZBTExXRVJUOiBTY2hsXHUwMEU0Z3QgZGFzIFRlbXBsYXRlci1Ta3JpcHQgZmVobCAoZmVobHQgb2RlciB3aXJmdCksIHNjaHJlaWJ0XG4vLyBUWVAuanMgaWhuIHN0YXR0IGVpbmVzIGxlZXJlbiBXZXJ0cyAoc2llaGUgZ2V0VHlwZVNob3J0Y3V0cyBpbiBtYWluLmpzIHVuZFxuLy8gZGllIEF1c3dlcnR1bmcgaW4gVFlQLmpzKS4gRWluIFNrcmlwdCwgZGFzIGJld3Vzc3QgbnVsbC9cIlwiIGxpZWZlcnQgLSBldHdhIGJlaVxuLy8gRVNDIGltIFBpY2tlciAtLCBnaWx0IGRhZ2VnZW4gbmljaHQgYWxzIEZlaGxzY2hsYWcgdW5kIGxcdTAwRTRzc3QgZGllIFByb3BlcnR5IGxlZXIuXG5cbi8vIERpZSBmZXN0ZW4gVG9rZW4sIGRpZSBkYXMgUGx1Z2luIHNlbGJzdCBhdWZsXHUwMEY2c2VuIGthbm4gLSBvaG5lIFRlbXBsYXRlciB1bmRcbi8vIG9obmUgdHAtWnVncmlmZiwgZGFoZXIgc2Nob24gaW4gZ2V0VHlwZURlZmF1bHRzKCkgKG1haW4uanMpIGVpbmdlc2V0enQuIEVyc3Rcbi8vIGJlaW0gQWJydWYgYXVmZ2VsXHUwMEY2c3QsIG5pY2h0IGJlaW0gU3BlaWNoZXJuLCBkYW1pdCB6LiBCLiBcInRvZGF5XCIgYmVpIGplZGVyIG5ldVxuLy8gYW5nZWxlZ3RlbiBOb3RpeiBkYXMgZGFubiBha3R1ZWxsZSBEYXR1bSBsaWVmZXJ0IHN0YXR0IGRlcyBUYWdlcywgYW4gZGVtIGRlclxuLy8gU2hvcnRjdXQgZ2VzZXR6dCB3dXJkZS5cbmNvbnN0IEZJWEVEX1NIT1JUQ1VUUyA9IFtcbiAge1xuICAgIG5hbWU6IFwidG9kYXlcIixcbiAgICBkZXNjcmlwdGlvbjogXCJIZXV0aWdlcyBEYXR1bSAoSkpKSi1NTS1UVClcIixcbiAgICByZXNvbHZlOiAoKSA9PiBtb21lbnQoKS5mb3JtYXQoXCJZWVlZLU1NLUREXCIpLFxuICB9LFxuICB7XG4gICAgbmFtZTogXCJub3dcIixcbiAgICBkZXNjcmlwdGlvbjogXCJBa3R1ZWxsZXMgRGF0dW0gbWl0IFVocnplaXQgKEpKSkotTU0tVFQgSEg6bW0pXCIsXG4gICAgcmVzb2x2ZTogKCkgPT4gbW9tZW50KCkuZm9ybWF0KFwiWVlZWS1NTS1ERCBISDptbVwiKSxcbiAgfSxcbiAge1xuICAgIC8vIEFuZGVycyBhbHMgdG9kYXkvbm93IG5pY2h0IGRlciBBdWZydWZ6ZWl0cHVua3QsIHNvbmRlcm4gZGFzXG4gICAgLy8gRXJzdGVsbHVuZ3NkYXR1bSBkZXIgamV3ZWlsaWdlbiBEYXRlaSAoZmlsZS5zdGF0LmN0aW1lKSAtIGJyYXVjaHQgZGFoZXJcbiAgICAvLyBkaWUgWmllbC1EYXRlaSBhbHMgS29udGV4dCAoZmlsZS1QYXJhbWV0ZXIsIHZvbiBnZXRUeXBlRGVmYXVsdHNcbiAgICAvLyBkdXJjaGdlcmVpY2h0KS4gT2huZSBEYXRlaSBGYWxsYmFjayBhdWYgZGVuIGFrdHVlbGxlbiBaZWl0cHVua3QuXG4gICAgbmFtZTogXCJjcmVhdGVkXCIsXG4gICAgZGVzY3JpcHRpb246IFwiRXJzdGVsbHVuZ3NkYXR1bSBkZXIgRGF0ZWkgKEpKSkotTU0tVFQpXCIsXG4gICAgcmVzb2x2ZTogKGZpbGUpID0+IG1vbWVudChmaWxlPy5zdGF0Py5jdGltZSA/PyBEYXRlLm5vdygpKS5mb3JtYXQoXCJZWVlZLU1NLUREXCIpLFxuICB9LFxuXTtcblxuLy8gU2tyaXB0LVNob3J0Y3V0cyB0cmFnZW4gZGllc2VuIFByXHUwMEU0Zml4IGltIG5hbWUsIGRhbWl0IGVpbiBTa3JpcHQgbmllIG1pdCBlaW5lbVxuLy8gZmVzdGVuIFRva2VuIGtvbGxpZGllcmVuIGthbm4gLSBhdWNoIGRhbm4gbmljaHQsIHdlbm4gamVtYW5kIGVpbmUgRGF0ZWlcbi8vIFwidG9kYXkuanNcIiBpbiBkZW4gVGVtcGxhdGVyLVNrcmlwdC1PcmRuZXIgbGVndC5cbmNvbnN0IFNDUklQVF9QUkVGSVggPSBcInRwLlwiO1xuXG5mdW5jdGlvbiBmaW5kRml4ZWRTaG9ydGN1dChuYW1lKSB7XG4gIHJldHVybiBGSVhFRF9TSE9SVENVVFMuZmluZCgoc2hvcnRjdXQpID0+IHNob3J0Y3V0Lm5hbWUgPT09IG5hbWUpID8/IG51bGw7XG59XG5cbi8vIFNrcmlwdG5hbWUgZWluZXMgXCJ0cC48U2tyaXB0bmFtZT5cIi1TaG9ydGN1dHMsIHNvbnN0IG51bGwuIFNrcmlwdG5hbWUgPVxuLy8gRGF0ZWluYW1lIGluIHRlbXBsYXRlci1zY3JpcHRzLyBvaG5lIFwiLmpzXCIsIGRhaGVyIGF1Y2ggbWl0IFVtbGF1dGVuLCBcIi1cIlxuLy8gb2RlciBMZWVyemVpY2hlbiBlcmxhdWJ0LlxuZnVuY3Rpb24gc2NyaXB0TmFtZU9mKG5hbWUpIHtcbiAgcmV0dXJuIHR5cGVvZiBuYW1lID09PSBcInN0cmluZ1wiICYmIG5hbWUuc3RhcnRzV2l0aChTQ1JJUFRfUFJFRklYKSA/IG5hbWUuc2xpY2UoU0NSSVBUX1BSRUZJWC5sZW5ndGgpIDogbnVsbDtcbn1cblxuZnVuY3Rpb24gaXNTY3JpcHRTaG9ydGN1dChyZWNvcmQpIHtcbiAgcmV0dXJuIHNjcmlwdE5hbWVPZihyZWNvcmQ/Lm5hbWUpICE9PSBudWxsO1xufVxuXG4vLyBBbnplaWdlZm9ybSBlaW5lcyBTaG9ydGN1dHMgLSBpbiBkZXIgUHJvcGVydHktWmVpbGUgKENoaXApIHVuZCBpbSBBdXN3YWhsLVxuLy8gTW9kYWwuIEJld3Vzc3QgZGVyIG5hY2t0ZSBuYW1lIG9obmUgWmllcnJhdDogRnJcdTAwRkNoZXIgc3RhbmQgZGVyIFNob3J0Y3V0IGFsc1xuLy8gXCJ7e3RvZGF5fX1cIiBpbSBXZXJ0IGRlciBQcm9wZXJ0eSwgZGllIGdlc2Nod2VpZnRlbiBLbGFtbWVybiB3YXJlbiBkb3J0IGRpZVxuLy8gZWluemlnZSBNXHUwMEY2Z2xpY2hrZWl0LCBpaG4gdm9uIGVpbmVtIGZlc3RlbiBXZXJ0IHp1IHVudGVyc2NoZWlkZW4uIEJlaWRlcyBpc3Rcbi8vIHdlZyAtIGdlc3BlaWNoZXJ0IHdpcmQgeyBuYW1lIH0sIFRZUC5qcyBiZWtvbW10IFN0cnVrdHVyIHN0YXR0IFRleHQgKHNpZWhlXG4vLyBnZXRUeXBlU2hvcnRjdXRzIGluIG1haW4uanMpLCB1bmQgZGVuIFVudGVyc2NoaWVkIHp1bSBmZXN0ZW4gV2VydCBtYWNodCBqZXR6dFxuLy8gZGVyIENoaXAgc2VsYnN0IHNhbXQgQWt6ZW50ZmFyYmUuIERpZSBLbGFtbWVybiBiaWxkZXRlbiBhbHNvIG5pY2h0cyBtZWhyIGFiLlxuZnVuY3Rpb24gc2hvcnRjdXRMYWJlbChyZWNvcmQpIHtcbiAgaWYgKCFyZWNvcmQ/Lm5hbWUpIHJldHVybiBcIlwiO1xuICBjb25zdCB3ZXJ0ZSA9IE9iamVjdC52YWx1ZXMocmVjb3JkLmFyZ3MgPz8ge30pLmZpbHRlcigodmFsdWUpID0+IHZhbHVlICE9PSB1bmRlZmluZWQpO1xuICByZXR1cm4gd2VydGUubGVuZ3RoID4gMCA/IGAke3JlY29yZC5uYW1lfTogJHt3ZXJ0ZS5qb2luKFwiLCBcIil9YCA6IHJlY29yZC5uYW1lO1xufVxuXG4vLyBFaW4gZWluZ2V0aXBwdGVzIEFyZ3VtZW50IGluIGRlbiBUeXAgXHUwMEZDYmVyZlx1MDBGQ2hyZW4sIGRlbiBlcyBvZmZlbnNpY2h0bGljaCBtZWludCAtXG4vLyBkYW1pdCBlaW4gU2tyaXB0IFwiNVwiIGFscyBaYWhsIHVuZCBcInRydWVcIiBhbHMgQm9vbGVhbiBiZWtvbW10LCBzdGF0dCBqZWRlc1xuLy8gU2tyaXB0IHNlbGJzdCBjYXN0ZW4genUgbGFzc2VuICh3aWNodGlnIHouIEIuLCB3ZW5uIGRlciBXZXJ0IGFuc2NobGllXHUwMERGZW5kIGluXG4vLyBlaW5lciBhbHMgWmFobCBkZWtsYXJpZXJ0ZW4gUHJvcGVydHkgbGFuZGV0KS4gQmV3dXNzdCBkaWVzZSB3ZW5pZ2VuLCBrbGFyXG4vLyBiZW5hbm50ZW4gRlx1MDBFNGxsZSBzdGF0dCBKU09OLnBhcnNlOiBkYXMgd1x1MDBGQ3JkZSBiZWkgXCJMaXRlcmF0dXJcIiBvaG5laGluXG4vLyBzY2hlaXRlcm4gdW5kIGJlaSAnXCJhXCInIGV0d2FzIGFuZGVyZXMgbGllZmVybiwgYWxzIGRvcnQgc3RlaHQuIEVpbiBsZWVyZXNcbi8vIEZlbGQgaGVpXHUwMERGdCBcIm5pY2h0IGdlc2V0enRcIiAodW5kZWZpbmVkKSB1bmQgZlx1MDBFNGxsdCBhdXMgZGVtIEFyZ3VtZW50LU9iamVrdFxuLy8gaGVyYXVzLCBkYW1pdCBlaW4gU2tyaXB0IHNhdWJlciBtaXQgXCJhcmdzLmphaHIgPz8gZmFsbGJhY2tcIiBhcmJlaXRlbiBrYW5uLlxuZnVuY3Rpb24gcGFyc2VBcmdWYWx1ZShyYXcpIHtcbiAgY29uc3QgdGV4dCA9IFN0cmluZyhyYXcgPz8gXCJcIikudHJpbSgpO1xuICBpZiAodGV4dCA9PT0gXCJcIikgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKHRleHQgPT09IFwidHJ1ZVwiKSByZXR1cm4gdHJ1ZTtcbiAgaWYgKHRleHQgPT09IFwiZmFsc2VcIikgcmV0dXJuIGZhbHNlO1xuICBpZiAodGV4dCA9PT0gXCJudWxsXCIpIHJldHVybiBudWxsO1xuICBpZiAoL14tP1xcZCsoPzpcXC5cXGQrKT8kLy50ZXN0KHRleHQpKSByZXR1cm4gTnVtYmVyKHRleHQpO1xuICByZXR1cm4gdGV4dDtcbn1cblxuLy8gTmFtZW4sIGRpZSBpbiBkZXIgUGFyYW1ldGVybGlzdGUgZWluZXMgTWFya2VycyBmXHUwMEZDciBXZXJ0ZSBzdGVoZW4sIGRpZSBkYXNcbi8vIFBsdWdpbiBiencuIFRZUC5qcyBzZWxic3Qga2VubnQgLSBzaWUgd2VyZGVuIG5pY2h0IGFiZ2VmcmFndCwgc29uZGVybiBiZWltXG4vLyBBdWZydWYgZWluZ2VzZXR6dDpcbi8vICAgbmV3RmlsZSAgZGllIG5ldSBhbmdlbGVndGUgTm90aXpcbi8vICAgY3R4ICAgICAgZGVyIEtvbnRleHQgeyB0eXAsIHN1YnR5cCwga2V5LCB3ZXJ0ZSwgZGFuYWNoLCBhcmdzIH1cbi8vICAga2V5ICAgICAgZGllIFByb3BlcnR5LCBhbiBkZXIgZGVyIFNob3J0Y3V0IGhcdTAwRTRuZ3QuIEVyc3BhcnQgZXMsIGlocmVuIE5hbWVuXG4vLyAgICAgICAgICAgIGFscyBBcmd1bWVudCB6dSB3aWVkZXJob2xlbiAtIGVpbiBTa3JpcHQgd2llIHJlbGF0aW9uLmpzLCBkYXNcbi8vICAgICAgICAgICAgc2ljaCBzZWluZSBQcm9wZXJ0eSBzYWdlbiBsXHUwMEU0c3N0LCBiZWtvbW10IGRhbWl0IGF1dG9tYXRpc2NoIGRpZVxuLy8gICAgICAgICAgICByaWNodGlnZSwgYXVjaCB3ZW5uIGRlcnNlbGJlIFNob3J0Y3V0IGFuIGVpbmVyIGFuZGVyZW4gWmVpbGVcbi8vICAgICAgICAgICAgc2l0enQuXG4vLyBcInRwXCIgc3RlaHQgaW1tZXIgYWxzIGVyc3RlcyBBcmd1bWVudCB1bmQgbXVzcyBuaWNodCBkZWtsYXJpZXJ0IHdlcmRlbjsgd2lyZFxuLy8gZXMgdHJvdHpkZW0gZ2VuYW5udCwgd2lyZCBlcyBcdTAwRkNiZXJnYW5nZW4sIHN0YXR0IGVzIGVpbiB6d2VpdGVzIE1hbCB6dVxuLy8gXHUwMEZDYmVyZ2ViZW4uXG5jb25zdCBSRVNFUlZFRF9QQVJBTVMgPSBbXCJuZXdGaWxlXCIsIFwiY3R4XCIsIFwia2V5XCJdO1xuXG4vLyBEaWUgUGFyYW1ldGVyLCBmXHUwMEZDciBkaWUgZGFzIE1vZGFsIGVpbiBFaW5nYWJlZmVsZCB6ZWlndDogYWxsZXMsIHdhcyBuaWNodFxuLy8gcmVzZXJ2aWVydCBpc3QuIHBhcmFtcyA9PT0gbnVsbCAoa2VpbiBLbGFtbWVycGFhciBhbSBNYXJrZXIpIGhlaVx1MDBERnRcbi8vIFwiaGVya1x1MDBGNm1tbGljaGVyIEF1ZnJ1ZlwiLCBhbHNvIGViZW5mYWxscyBrZWluZSBGZWxkZXIuXG5mdW5jdGlvbiBpbnB1dFBhcmFtcyhwYXJhbXMpIHtcbiAgcmV0dXJuIChwYXJhbXMgPz8gW10pLmZpbHRlcigobmFtZSkgPT4gbmFtZSAhPT0gXCJ0cFwiICYmICFSRVNFUlZFRF9QQVJBTVMuaW5jbHVkZXMobmFtZSkpO1xufVxuXG4vLyBFaW5nYWJlbiAoamUgUGFyYW1ldGVybmFtZSBlaW4gVGV4dCkgaW4gZGFzIGdlc3BlaWNoZXJ0ZSBBcmd1bWVudC1PYmpla3QuXG4vLyBwYXJhbXMgZ2lidCBkaWUgUmVpaGVuZm9sZ2Ugdm9yLCBkYW1pdCBzaG9ydGN1dExhYmVsKCkgc2llIGluIGRlciB2b20gU2tyaXB0XG4vLyBkZWtsYXJpZXJ0ZW4gRm9sZ2UgYW56ZWlndDsgbGVlcmUgRmVsZGVyIGZlaGxlbiBpbSBFcmdlYm5pcyBnYW56LlxuZnVuY3Rpb24gYnVpbGRBcmdzKHBhcmFtcywgZWluZ2FiZW4pIHtcbiAgY29uc3QgYXJncyA9IHt9O1xuICBmb3IgKGNvbnN0IG5hbWUgb2YgaW5wdXRQYXJhbXMocGFyYW1zKSkge1xuICAgIGNvbnN0IHZhbHVlID0gcGFyc2VBcmdWYWx1ZShlaW5nYWJlbltuYW1lXSk7XG4gICAgaWYgKHZhbHVlICE9PSB1bmRlZmluZWQpIGFyZ3NbbmFtZV0gPSB2YWx1ZTtcbiAgfVxuICByZXR1cm4gYXJncztcbn1cblxuLy8gQXVzIGRlciBkZWtsYXJpZXJ0ZW4gUGFyYW1ldGVybGlzdGUgZGllIEFyZ3VtZW50ZSBmXHUwMEZDciBkZW4gQXVmcnVmXG4vLyBmKHRwLCAuLi5oaWVyKSBiYXVlbiAtIGF1ZmdlcnVmZW4gdm9uIFRZUC5qcywgZGFzIGFscyBlaW56aWdlcyBuZXdGaWxlIHVuZFxuLy8gY3R4IGtlbm50LlxuLy9cbi8vIE9obmUgS2xhbW1lcm4gYW0gTWFya2VyIChwYXJhbXMgPT09IG51bGwpIGJsZWlidCBlcyBiZWltIGhlcmtcdTAwRjZtbWxpY2hlblxuLy8gQXVmcnVmIGYodHAsIG5ld0ZpbGUsIGN0eCkuIFNvbnN0IHdpcmQgZGllIExpc3RlIEVpbnRyYWcgZlx1MDBGQ3IgRWludHJhZ1xuLy8gYXVmZ2VsXHUwMEY2c3Q6IHJlc2VydmllcnRlIE5hbWVuIHp1IGRlbiBcdTAwRkNiZXJnZWJlbmVuIFdlcnRlbiwgYWxsZSBhbmRlcmVuIHp1bVxuLy8gZWluZ2V0aXBwdGVuIEFyZ3VtZW50LlxuLy9cbi8vIEVpbiBQdW5rdC1OYW1lIChcIm9wdGlvbnMudHlwXCIpIGJlc2NocmVpYnQga2VpbiBlaWdlbmVzIEFyZ3VtZW50LCBzb25kZXJuIGVpblxuLy8gRkVMRCBlaW5lcyBPYmpla3QtQXJndW1lbnRzOiBhbGxlIFwib3B0aW9ucy4qXCIgc2FtbWVsbiBzaWNoIHp1IGVpbmVtIGVpbnppZ2VuXG4vLyBPYmpla3QgYW4gZGVyIFBvc2l0aW9uIGlocmVzIGVyc3RlbiBWb3Jrb21tZW5zLiBEYW1pdCBsYXNzZW4gc2ljaCBhdWNoXG4vLyBTa3JpcHRlIGJlZGllbmVuLCBkZXJlbiBTaWduYXR1ciBlaW4gT3B0aW9ucy1PYmpla3QgZXJ3YXJ0ZXQsIG9obmUgZGFzcyBtYW5cbi8vIEpTT04gaW4gZWluIEVpbmdhYmVmZWxkIHRpcHBlbiBtXHUwMEZDc3N0ZS4gTnVyIGVpbmUgRWJlbmUgdGllZiAtIGJlaSBcImEuYi5jXCJcbi8vIGVudHN0XHUwMEZDbmRlIGVpbiBGZWxkLCBkYXMgd1x1MDBGNnJ0bGljaCBcImIuY1wiIGhlaVx1MDBERnQuXG5mdW5jdGlvbiByZXNvbHZlQ2FsbEFyZ3MocGFyYW1zLCBhcmdzLCByZXNlcnZlZCA9IHt9KSB7XG4gIGlmIChwYXJhbXMgPT09IG51bGwgfHwgcGFyYW1zID09PSB1bmRlZmluZWQpIHJldHVybiBbcmVzZXJ2ZWQubmV3RmlsZSwgcmVzZXJ2ZWQuY3R4XTtcblxuICBjb25zdCB3ZXJ0ZSA9IFtdO1xuICBjb25zdCBvYmpla3RQb3NpdGlvbiA9IG5ldyBNYXAoKTtcbiAgZm9yIChjb25zdCBuYW1lIG9mIHBhcmFtcykge1xuICAgIGlmIChuYW1lID09PSBcInRwXCIpIGNvbnRpbnVlO1xuICAgIGlmIChSRVNFUlZFRF9QQVJBTVMuaW5jbHVkZXMobmFtZSkpIHtcbiAgICAgIHdlcnRlLnB1c2gocmVzZXJ2ZWRbbmFtZV0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IHB1bmt0ID0gbmFtZS5pbmRleE9mKFwiLlwiKTtcbiAgICBpZiAocHVua3QgPT09IC0xKSB7XG4gICAgICB3ZXJ0ZS5wdXNoKGFyZ3M/LltuYW1lXSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgYmFzaXMgPSBuYW1lLnNsaWNlKDAsIHB1bmt0KTtcbiAgICBpZiAoIW9iamVrdFBvc2l0aW9uLmhhcyhiYXNpcykpIHtcbiAgICAgIG9iamVrdFBvc2l0aW9uLnNldChiYXNpcywgd2VydGUubGVuZ3RoKTtcbiAgICAgIHdlcnRlLnB1c2goe30pO1xuICAgIH1cbiAgICBjb25zdCB3ZXJ0ID0gYXJncz8uW25hbWVdO1xuICAgIGlmICh3ZXJ0ICE9PSB1bmRlZmluZWQpIHdlcnRlW29iamVrdFBvc2l0aW9uLmdldChiYXNpcyldW25hbWUuc2xpY2UocHVua3QgKyAxKV0gPSB3ZXJ0O1xuICB9XG4gIHJldHVybiB3ZXJ0ZTtcbn1cblxuLy8gT2IgZGllIFByb3BlcnR5IGxhdXQgdHlwZXMuanNvbiAoYnp3LiwgZmFsbHMgZG9ydCBuaWNodCBnZXNldHp0LCBsYXV0IGlocmVyXG4vLyBiaXNoZXJpZ2VuIFZlcndlbmR1bmcgaW0gVmF1bHQpIGVpbmUgTGlzdGUgaXN0IC0gZGFubiB3aXJkIGVpbiBhdWZnZWxcdTAwRjZzdGVyXG4vLyBTaG9ydGN1dC1XZXJ0IGVpbmVsZW1lbnRpZyBlaW5nZXBhY2t0LCBkYW1pdCBkZXIgZ2VsaWVmZXJ0ZSBXZXJ0IHp1bVxuLy8gZGVrbGFyaWVydGVuIFR5cCBkZXIgUHJvcGVydHkgcGFzc3QuIE9obmUgYXBwICh6LiBCLiBpbiBUZXN0cykgd2llIGJpc2hlclxuLy8gb2huZSBFaW5wYWNrZW4uXG5mdW5jdGlvbiBpc0xpc3RQcm9wZXJ0eShhcHAsIGtleSkge1xuICByZXR1cm4gYXBwPy5tZXRhZGF0YVR5cGVNYW5hZ2VyPy5nZXRUeXBlSW5mbz8uKGtleSk/LmV4cGVjdGVkPy50eXBlID09PSBcIm11bHRpdGV4dFwiO1xufVxuXG4vLyBLb3BpZSB2b24gZnJvbnRtYXR0ZXIsIGluIGRlciBqZWRlciBLZXkgbWl0IFNob3J0Y3V0IHNlaW5lbiBiZXJlY2huZXRlbiBXZXJ0XG4vLyB0clx1MDBFNGd0OlxuLy8gICAtIGZlc3RlciBUb2tlbiAtPiBhdWZnZWxcdTAwRjZzdCAoYmVpIGVpbmVyIExpc3Rlbi1Qcm9wZXJ0eSBlaW5lbGVtZW50aWdcbi8vICAgICBlaW5nZXBhY2t0KSxcbi8vICAgLSBcInRwLjxTa3JpcHQ+XCIgLT4gbnVsbDsgbnVyIFRlbXBsYXRlciBrYW5uIGRhcyBhdWZsXHUwMEY2c2VuLCBUWVAuanMgaG9sdCBzaWNoXG4vLyAgICAgZGllc2UgS2V5cyBcdTAwRkNiZXIgZ2V0VHlwZVNob3J0Y3V0cygpIHVuZCBzZXR6dCBzaWUgc2VsYnN0IGVpbi5cbi8vIEtleXMgb2huZSBTaG9ydGN1dCBibGVpYmVuIHVudmVyXHUwMEU0bmRlcnQgLSBlYmVuc28gZGVyIFdlcnQgZWluZXMgS2V5cyBNSVRcbi8vIFNob3J0Y3V0IGluIGRlbiBTZXR0aW5ncyBzZWxic3Q6IGVyIGJsZWlidCBkb3J0IGFscyBSXHUwMEZDY2tmYWxsd2VydCBzdGVoZW4gKHNpZWhlXG4vLyBLb21tZW50YXIgb2JlbikgdW5kIHdpcmQgaGllciBudXIgXHUwMEZDYmVyc2NocmllYmVuLCBuaWNodCBnZWxcdTAwRjZzY2h0LlxuZnVuY3Rpb24gcmVzb2x2ZVNob3J0Y3V0cyhmcm9udG1hdHRlciwgc2hvcnRjdXRzLCB7IGZpbGUsIGFwcCB9ID0ge30pIHtcbiAgY29uc3QgcmVzb2x2ZWQgPSB7fTtcbiAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoZnJvbnRtYXR0ZXIpKSB7XG4gICAgY29uc3QgcmVjb3JkID0gc2hvcnRjdXRzPy5ba2V5XTtcbiAgICBjb25zdCBmaXhlZCA9IHJlY29yZCA/IGZpbmRGaXhlZFNob3J0Y3V0KHJlY29yZC5uYW1lKSA6IG51bGw7XG4gICAgaWYgKGZpeGVkKSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBmaXhlZC5yZXNvbHZlKGZpbGUpO1xuICAgICAgcmVzb2x2ZWRba2V5XSA9IGlzTGlzdFByb3BlcnR5KGFwcCwga2V5KSA/IFtyZXN1bHRdIDogcmVzdWx0O1xuICAgIH0gZWxzZSBpZiAoaXNTY3JpcHRTaG9ydGN1dChyZWNvcmQpKSB7XG4gICAgICByZXNvbHZlZFtrZXldID0gbnVsbDtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVzb2x2ZWRba2V5XSA9IHZhbHVlO1xuICAgIH1cbiAgfVxuICByZXR1cm4gcmVzb2x2ZWQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBGSVhFRF9TSE9SVENVVFMsXG4gIFNDUklQVF9QUkVGSVgsXG4gIGZpbmRGaXhlZFNob3J0Y3V0LFxuICBzY3JpcHROYW1lT2YsXG4gIGlzU2NyaXB0U2hvcnRjdXQsXG4gIHNob3J0Y3V0TGFiZWwsXG4gIHBhcnNlQXJnVmFsdWUsXG4gIGJ1aWxkQXJncyxcbiAgaW5wdXRQYXJhbXMsXG4gIHJlc29sdmVDYWxsQXJncyxcbiAgUkVTRVJWRURfUEFSQU1TLFxuICByZXNvbHZlU2hvcnRjdXRzLFxufTtcbiIsICJjb25zdCB7IEZ1enp5U3VnZ2VzdE1vZGFsLCBNb2RhbCwgU2V0dGluZyB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBGSVhFRF9TSE9SVENVVFMsIFNDUklQVF9QUkVGSVgsIGJ1aWxkQXJncywgaW5wdXRQYXJhbXMgfSA9IHJlcXVpcmUoXCIuL3Nob3J0Y3V0c1wiKTtcblxuLy8gQW56ZWlnZWZvcm0gZWluZXMgTGlzdGVuZWludHJhZ3M6IGRlciBOYW1lLCBiZWkgZWluZW0gU2tyaXB0IG1pdCBkZWtsYXJpZXJ0ZW5cbi8vIFBhcmFtZXRlcm4genVzXHUwMEU0dHpsaWNoIGRlcmVuIE5hbWVuIGluIEtsYW1tZXJuIC0gc28gaXN0IHNjaG9uIGluIGRlciBBdXN3YWhsXG4vLyB6dSBzZWhlbiwgZGFzcyAodW5kIHdvbWl0KSBlaW4gU2tyaXB0IHBhcmFtZXRyaXNpZXJ0IHdpcmQuXG5mdW5jdGlvbiBpdGVtTGFiZWwoaXRlbSkge1xuICByZXR1cm4gaXRlbS5wYXJhbXMgPyBgJHtpdGVtLm5hbWV9KCR7aXRlbS5wYXJhbXMuam9pbihcIiwgXCIpfSlgIDogaXRlbS5uYW1lO1xufVxuXG4vLyBBdXN3YWhsIGVpbmVzIFNob3J0Y3V0cyBmXHUwMEZDciBlaW5lIFByb3BlcnR5IGRlcyBUWVAtRnJvbnRtYXR0ZXJzIChLbm9wZiBiencuXG4vLyBDaGlwIGluIGRlciBQcm9wZXJ0eS1aZWlsZSwgc2llaGUgdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpLiBFcnNldHp0IGRpZVxuLy8gZnJcdTAwRkNoZXJlIExlZ2VuZGUgdW50ZXJoYWxiIGRlciBGcm9udG1hdHRlci1CbFx1MDBGNmNrZTogZGllc2VsYmVuIFRva2VuLCBhYmVyIGFtXG4vLyBPcnQgZGVyIFZlcndlbmR1bmcsIGR1cmNoc3VjaGJhciAtIHVuZCBiZWkgU2tyaXB0ZW4genVzXHUwMEU0dHpsaWNoIG1pdCBkZXJcbi8vIEJlc2NocmVpYnVuZyBhdXMgZGVyZW4gQHR5cC1zaG9ydGN1dC1NYXJrZXIsIGRpZSBlaW5lIGZlc3RlIExlZ2VuZGUgZ2FyIG5pY2h0XG4vLyBrZW5uZW4ga29ubnRlLlxuLy9cbi8vIEdld1x1MDBFNGhsdCB3aXJkIG5pZSBmcmVpZXIgVGV4dDogZGllIExpc3RlIGlzdCBkaWUgbWFcdTAwREZnZWJsaWNoZSBRdWVsbGUsIGVpblxuLy8gVGlwcGZlaGxlciBpbSBTa3JpcHRuYW1lbiBpc3QgZGFtaXQgYXVzZ2VzY2hsb3NzZW4uXG5jbGFzcyBTaG9ydGN1dFBpY2tlck1vZGFsIGV4dGVuZHMgRnV6enlTdWdnZXN0TW9kYWwge1xuICBjb25zdHJ1Y3RvcihhcHAsIGtleSwgaXRlbXMsIHJlc29sdmUpIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMuaXRlbXMgPSBpdGVtcztcbiAgICB0aGlzLnJlc29sdmUgPSByZXNvbHZlO1xuICAgIHRoaXMuY2hvc2VuID0gZmFsc2U7XG4gICAgdGhpcy5zZXRQbGFjZWhvbGRlcihgU2hvcnRjdXQgZlx1MDBGQ3IgXHUyMDFFJHtrZXl9XHUyMDFDIFx1MjAxMyBFU0MgZlx1MDBGQ3IgQWJicnVjaGApO1xuICB9XG5cbiAgZ2V0SXRlbXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuaXRlbXM7XG4gIH1cblxuICAvLyBGdXp6eS1TdWNoZSBncmVpZnQgYXVjaCBhdWYgZGllIEJlc2NocmVpYnVuZywgbmljaHQgbnVyIGF1ZiBkZW4gTmFtZW4gLVxuICAvLyBcIkVyc3RlbGx1bmdzZGF0dW1cIiBmaW5kZXQgc28gYXVjaCBcImNyZWF0ZWRcIi5cbiAgZ2V0SXRlbVRleHQoaXRlbSkge1xuICAgIGNvbnN0IGxhYmVsID0gaXRlbUxhYmVsKGl0ZW0pO1xuICAgIHJldHVybiBpdGVtLmRlc2NyaXB0aW9uID8gYCR7bGFiZWx9ICR7aXRlbS5kZXNjcmlwdGlvbn1gIDogbGFiZWw7XG4gIH1cblxuICByZW5kZXJTdWdnZXN0aW9uKG1hdGNoLCBlbCkge1xuICAgIGNvbnN0IGl0ZW0gPSBtYXRjaC5pdGVtO1xuICAgIGVsLmFkZENsYXNzKFwiZnJlZC10eXAtc2hvcnRjdXQtc3VnZ2VzdGlvblwiKTtcbiAgICBlbC5jcmVhdGVFbChcImNvZGVcIiwgeyBjbHM6IFwiZnJlZC10eXAtc2hvcnRjdXQtc3VnZ2VzdGlvbi1uYW1lXCIsIHRleHQ6IGl0ZW1MYWJlbChpdGVtKSB9KTtcbiAgICBpZiAoaXRlbS5kZXNjcmlwdGlvbikgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1zaG9ydGN1dC1zdWdnZXN0aW9uLWRlc2NcIiwgdGV4dDogaXRlbS5kZXNjcmlwdGlvbiB9KTtcbiAgfVxuXG4gIC8vIFNpZWhlIFR5cFBpY2tlck1vZGFsIGluIHR5cGUtcGlja2VyLmpzOiBPYnNpZGlhbnMgc2VsZWN0U3VnZ2VzdGlvbigpIHJ1ZnRcbiAgLy8gZXJzdCBjbG9zZSgpIHVuZCBkYW5hY2ggZXJzdCBvbkNob29zZUl0ZW0oKSAtIFwiY2hvc2VuXCIgbXVzcyBkZXNoYWxiIHNjaG9uXG4gIC8vIGhpZXIgZ2VzZXR6dCB3ZXJkZW4sIHNvbnN0IGxcdTAwRjZzdCBkYXMgdm9uIGNsb3NlKCkgYXVzZ2VsXHUwMEY2c3RlIG9uQ2xvc2UoKSBkYXNcbiAgLy8gUHJvbWlzZSB2b3J6ZWl0aWcgbWl0IG51bGwgYXVmIHVuZCBkaWUgZWlnZW50bGljaGUgQXVzd2FobCBnZWh0IHZlcmxvcmVuLlxuICBzZWxlY3RTdWdnZXN0aW9uKGl0ZW0sIGV2dCkge1xuICAgIHRoaXMuY2hvc2VuID0gdHJ1ZTtcbiAgICBzdXBlci5zZWxlY3RTdWdnZXN0aW9uKGl0ZW0sIGV2dCk7XG4gIH1cblxuICBvbkNob29zZUl0ZW0oaXRlbSkge1xuICAgIHRoaXMucmVzb2x2ZShpdGVtKTtcbiAgfVxuXG4gIG9uQ2xvc2UoKSB7XG4gICAgc3VwZXIub25DbG9zZSgpO1xuICAgIGlmICghdGhpcy5jaG9zZW4pIHRoaXMucmVzb2x2ZShudWxsKTtcbiAgfVxufVxuXG4vLyBBYmZyYWdlIGRlciBBcmd1bWVudGUgZWluZXMgU2tyaXB0cywgZGFzIHdlbGNoZSBkZWtsYXJpZXJ0IGhhdCAtIGVpbiBEaWFsb2dcbi8vIG1pdCBhbGxlbiBGZWxkZXJuIHVudGVyZWluYW5kZXIgc3RhdHQgZWluZXIgS2V0dGUgdm9uIEVpbnplbGFiZnJhZ2VuLCBkYW1pdFxuLy8gbWFuIHNpZSBnZW1laW5zYW0gc2llaHQgdW5kIGtvcnJpZ2llcmVuIGthbm4uIERpZSBGZWxkZXIgc2luZCBuYWNoIGRlblxuLy8gUGFyYW1ldGVybmFtZW4gZGVzIFNrcmlwdHMgYmVuYW5udDsgdm9yYmVsZWd0IHdlcmRlbiBzaWUgbWl0IGRlbiBiZXJlaXRzXG4vLyBnZXNwZWljaGVydGVuIFdlcnRlbiAodm9yaGFuZGVuZSBBcmd1bWVudGUpLCBzb2Rhc3MgZWluIGVybmV1dGVzIFdcdTAwRTRobGVuXG4vLyBkZXNzZWxiZW4gU2tyaXB0cyB6dW0gS29ycmlnaWVyZW4gZWluemVsbmVyIFdlcnRlIHRhdWd0LlxuLy9cbi8vIEVpbiBsZWVyIGdlbGFzc2VuZXMgRmVsZCBnaWx0IGFscyBcIm5pY2h0IGdlc2V0enRcIiB1bmQgZlx1MDBFNGxsdCBhdXMgZGVtIEVyZ2VibmlzXG4vLyBoZXJhdXMgKHNpZWhlIGJ1aWxkQXJncyBpbiBzaG9ydGN1dHMuanMpIC0gZGVzaGFsYiBnaWJ0IGVzIGhpZXIga2VpbmVcbi8vIFBmbGljaHRmZWxkZXIgdW5kIGtlaW5lIFZhbGlkaWVydW5nOiB3YXMgZGFzIFNrcmlwdCBicmF1Y2h0LCB3ZWlcdTAwREYgbnVyIGRhc1xuLy8gU2tyaXB0IHNlbGJzdC5cbmNsYXNzIFNob3J0Y3V0QXJnc01vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBjb25zdHJ1Y3RvcihhcHAsIGl0ZW0sIHZvcmhhbmRlbmUsIHJlc29sdmUpIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMuaXRlbSA9IGl0ZW07XG4gICAgdGhpcy5yZXNvbHZlID0gcmVzb2x2ZTtcbiAgICB0aGlzLmZlbGRlciA9IGlucHV0UGFyYW1zKGl0ZW0ucGFyYW1zKTtcbiAgICB0aGlzLmVpbmdhYmVuID0ge307XG4gICAgZm9yIChjb25zdCBuYW1lIG9mIHRoaXMuZmVsZGVyKSB7XG4gICAgICBjb25zdCB3ZXJ0ID0gdm9yaGFuZGVuZT8uW25hbWVdO1xuICAgICAgdGhpcy5laW5nYWJlbltuYW1lXSA9IHdlcnQgPT09IHVuZGVmaW5lZCB8fCB3ZXJ0ID09PSBudWxsID8gXCJcIiA6IFN0cmluZyh3ZXJ0KTtcbiAgICB9XG4gICAgdGhpcy5iZXN0YWV0aWd0ID0gZmFsc2U7XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgdGhpcy50aXRsZUVsLnNldFRleHQoYEFyZ3VtZW50ZSBmXHUwMEZDciAke3RoaXMuaXRlbS5uYW1lfWApO1xuICAgIGlmICh0aGlzLml0ZW0uZGVzY3JpcHRpb24pIHtcbiAgICAgIHRoaXMuY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1zaG9ydGN1dC1hcmdzLWRlc2NcIiwgdGV4dDogdGhpcy5pdGVtLmRlc2NyaXB0aW9uIH0pO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IG5hbWUgb2YgdGhpcy5mZWxkZXIpIHtcbiAgICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGVudEVsKS5zZXROYW1lKG5hbWUpLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHRcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5laW5nYWJlbltuYW1lXSlcbiAgICAgICAgICAub25DaGFuZ2UoKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmVpbmdhYmVuW25hbWVdID0gdmFsdWU7XG4gICAgICAgICAgfSlcbiAgICAgICAgICAvLyBFbnRlciBpbiBlaW5lbSBGZWxkIHNjaGxpZVx1MDBERnQgZGVuIERpYWxvZyBhYiwgd2llIGluIE9ic2lkaWFuc1xuICAgICAgICAgIC8vIGVpZ2VuZW4gVW1iZW5lbm5lbi1EaWFsb2dlbi5cbiAgICAgICAgICAuaW5wdXRFbC5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCAoZXZlbnQpID0+IHtcbiAgICAgICAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRW50ZXJcIiAmJiAhZXZlbnQuaXNDb21wb3NpbmcpIHtcbiAgICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgICAgICAgdGhpcy51ZWJlcm5laG1lbigpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pXG4gICAgICApO1xuICAgIH1cbiAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRlbnRFbCkuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICBidXR0b25cbiAgICAgICAgLnNldEJ1dHRvblRleHQoXCJcdTAwRENiZXJuZWhtZW5cIilcbiAgICAgICAgLnNldEN0YSgpXG4gICAgICAgIC5vbkNsaWNrKCgpID0+IHRoaXMudWViZXJuZWhtZW4oKSlcbiAgICApO1xuICB9XG5cbiAgdWViZXJuZWhtZW4oKSB7XG4gICAgdGhpcy5iZXN0YWV0aWd0ID0gdHJ1ZTtcbiAgICB0aGlzLmNsb3NlKCk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gICAgLy8gRVNDIGJ6dy4gS2xpY2sgZGFuZWJlbjoga2VpbiBTaG9ydGN1dCBnZXNldHp0LCBkZXIgYmlzaGVyaWdlIGJsZWlidFxuICAgIC8vIHVuYW5nZXRhc3RldCAtIHNvbnN0IHdcdTAwRTRyZSBlaW4gdmVyc2VoZW50bGljaGVzIFNjaGxpZVx1MDBERmVuIGVpbiBzdGlsbGVyXG4gICAgLy8gRGF0ZW52ZXJsdXN0LlxuICAgIHRoaXMucmVzb2x2ZSh0aGlzLmJlc3RhZXRpZ3QgPyBidWlsZEFyZ3ModGhpcy5mZWxkZXIsIHRoaXMuZWluZ2FiZW4pIDogbnVsbCk7XG4gIH1cbn1cblxuLy8gXHUwMEQ2ZmZuZXQgZGllIEF1c3dhaGwgZlx1MDBGQ3IgZGllIFByb3BlcnR5IGtleS4gZ2V0U2NyaXB0cyBpc3QgZGVyIEFjY2Vzc29yIGF1c1xuLy8gcmVnaXN0ZXJTaG9ydGN1dFNjcmlwdHMoKSAoc2hvcnRjdXQtc2NyaXB0cy5qcyksIHZvcmhhbmRlbiBkZXIgYWt0dWVsbFxuLy8gZ2VzZXR6dGUgU2hvcnRjdXQtUmVjb3JkIChmXHUwMEZDciBkaWUgVm9yYmVsZWd1bmcgZGVyIEFyZ3VtZW50ZSkuIExcdTAwRjZzdCBtaXQgZGVtXG4vLyBuZXVlbiBSZWNvcmQgKHsgbmFtZSB9IGJ6dy4geyBuYW1lLCBhcmdzIH0pIGF1Ziwgb2RlciBtaXQgbnVsbCBiZWkgQWJicnVjaCAtXG4vLyBhdWNoIGRhbm4sIHdlbm4gendhciBlaW4gU2tyaXB0IGdld1x1MDBFNGhsdCwgZGVyIEFyZ3VtZW50LURpYWxvZyBkYW5hY2ggYWJlclxuLy8gYWJnZWJyb2NoZW4gd3VyZGUuXG5hc3luYyBmdW5jdGlvbiBwaWNrU2hvcnRjdXQoYXBwLCBrZXksIGdldFNjcmlwdHMsIHZvcmhhbmRlbiA9IG51bGwpIHtcbiAgY29uc3QgaXRlbXMgPSBbXG4gICAgLi4uRklYRURfU0hPUlRDVVRTLm1hcCgoeyBuYW1lLCBkZXNjcmlwdGlvbiB9KSA9PiAoeyBuYW1lLCBkZXNjcmlwdGlvbiwgcGFyYW1zOiBudWxsIH0pKSxcbiAgICAuLi5nZXRTY3JpcHRzKCkubWFwKCh7IG5hbWUsIHBhcmFtcywgZGVzY3JpcHRpb24gfSkgPT4gKHsgbmFtZTogU0NSSVBUX1BSRUZJWCArIG5hbWUsIHBhcmFtcywgZGVzY3JpcHRpb24gfSkpLFxuICBdO1xuXG4gIGNvbnN0IGl0ZW0gPSBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gbmV3IFNob3J0Y3V0UGlja2VyTW9kYWwoYXBwLCBrZXksIGl0ZW1zLCByZXNvbHZlKS5vcGVuKCkpO1xuICBpZiAoIWl0ZW0pIHJldHVybiBudWxsO1xuICAvLyBPaG5lIGFienVmcmFnZW5kZSBGZWxkZXIgZW50Zlx1MDBFNGxsdCBkZXIgendlaXRlIFNjaHJpdHQgZ2FueiAtIGRhcyBnaWx0IGZcdTAwRkNyXG4gIC8vIGRpZSBmZXN0ZW4gU2hvcnRjdXRzIGViZW5zbyB3aWUgZlx1MDBGQ3IgZWluIFNrcmlwdCwgZGVzc2VuIFBhcmFtZXRlcmxpc3RlIG51clxuICAvLyByZXNlcnZpZXJ0ZSBOYW1lbiBlbnRoXHUwMEU0bHQgKGV0d2EgXCIobmV3RmlsZSlcIikuXG4gIGlmIChpbnB1dFBhcmFtcyhpdGVtLnBhcmFtcykubGVuZ3RoID09PSAwKSByZXR1cm4geyBuYW1lOiBpdGVtLm5hbWUgfTtcblxuICAvLyBWb3JiZWxlZ3VuZyBudXIsIHdlbm4gZGFzc2VsYmUgU2tyaXB0IHNjaG9uIGdlc2V0enQgd2FyIC0gYmVpIGVpbmVtXG4gIC8vIFdlY2hzZWwgd1x1MDBFNHJlbiBkaWUgYWx0ZW4gV2VydGUgZlx1MDBGQ3IgYW5kZXJlIFBhcmFtZXRlcm5hbWVuIGJlZGV1dHVuZ3Nsb3MuXG4gIGNvbnN0IHZvcmJlbGVndW5nID0gdm9yaGFuZGVuPy5uYW1lID09PSBpdGVtLm5hbWUgPyB2b3JoYW5kZW4uYXJncyA6IG51bGw7XG4gIGNvbnN0IGFyZ3MgPSBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gbmV3IFNob3J0Y3V0QXJnc01vZGFsKGFwcCwgaXRlbSwgdm9yYmVsZWd1bmcsIHJlc29sdmUpLm9wZW4oKSk7XG4gIGlmIChhcmdzID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIE9iamVjdC5rZXlzKGFyZ3MpLmxlbmd0aCA+IDAgPyB7IG5hbWU6IGl0ZW0ubmFtZSwgYXJncyB9IDogeyBuYW1lOiBpdGVtLm5hbWUgfTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHBpY2tTaG9ydGN1dCB9O1xuIiwgImNvbnN0IHsgTWFya2Rvd25WaWV3LCBNZW51LCBXb3Jrc3BhY2VMZWFmLCBzZXRJY29uIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IHNob3J0Y3V0TGFiZWwgfSA9IHJlcXVpcmUoXCIuL3Nob3J0Y3V0c1wiKTtcbmNvbnN0IHsgcGlja1Nob3J0Y3V0IH0gPSByZXF1aXJlKFwiLi9zaG9ydGN1dC1waWNrZXJcIik7XG5jb25zdCB7IGdldFN1YnR5cGUsIGVuc3VyZVN1YnR5cGUgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cGVzXCIpO1xuXG4vLyBNYXJrZXItS2xhc3NlIGFtIENvbnRhaW5lciBkZXMgVFlQLUZyb250bWF0dGVyLUVkaXRvcnMgLSBncmVuenQgZGllXG4vLyBTaG9ydGN1dC1SZWdlbG4gaW4gc3R5bGVzLmNzcyBhdWYgZGllc2VuIEVkaXRvciBlaW4sIGVjaHRlIE5vdGl6ZW4gYmxlaWJlblxuLy8gdW5iZXJcdTAwRkNocnQuXG5jb25zdCBFRElUT1JfQ0xBU1MgPSBcImZyZWQtdHlwLWZyb250bWF0dGVyLWVkaXRvclwiO1xuXG5jb25zdCBUWVBfUFJPUEVSVFkgPSBcIlRZUFwiO1xuY29uc3QgU1VCVFlQX1BST1BFUlRZID0gXCJTVUJUWVBcIjtcbmNvbnN0IFNZU1RFTV9QUk9QRVJUSUVTID0gW1RZUF9QUk9QRVJUWS50b0xvd2VyQ2FzZSgpLCBTVUJUWVBfUFJPUEVSVFkudG9Mb3dlckNhc2UoKV07XG5cbi8vIERlciBXZXJ0IGRlciBUWVAtIGJ6dy4gU1VCVFlQLVByb3BlcnR5IGlzdCBwZXIgRGVmaW5pdGlvbiBpbW1lciBkZXIgTmFtZSBkZXNcbi8vIFRZUHMvU3VidHlwcyBzZWxic3QgLSBhbHMgXCJTdGFuZGFyZFwiLVByb3BlcnR5IHdcdTAwRTRyZSBzaWUgYWxzbyByZWR1bmRhbnQgdW5kXG4vLyBrXHUwMEY2bm50ZSBiZWkgZWluZXIgVW1iZW5lbm51bmcgKHVuYmVtZXJrdCkgdm9tIHRhdHNcdTAwRTRjaGxpY2hlbiBOYW1lbiBhYndlaWNoZW4uXG4vLyBTaWUgZGFyZiBkZXNoYWxiIGluIGRpZXNlbSBFZGl0b3IgZ2FyIG5pY2h0IGVyc3QgYWxzIGVpZ2VuZSBaZWlsZSBhdWZ0YXVjaGVuLlxuLy8gTXV0aWVydCBcImZyb250bWF0dGVyXCIgaW4tcGxhY2UgKHN0YXR0IGVpbmUgS29waWUgenVyXHUwMEZDY2t6dWdlYmVuKSAtIE9ic2lkaWFuc1xuLy8gUHJvcGVydHktRWRpdG9yIHNjaGVpbnQgYmVpbSBzeW5jaHJvbml6ZSgpIGF1ZiBlaW5lIHN0YWJpbGUgT2JqZWt0cmVmZXJlbnpcbi8vIGFuZ2V3aWVzZW4genUgc2VpbjsgZWluZSBuZXUgZXJ6ZXVndGUgS29waWUgaGF0IGJlaW0gYWxsZXJlcnN0ZW4gUmVuZGVybiB6dVxuLy8gZWluZW0gU3RhY2sgT3ZlcmZsb3cgaW4gT2JzaWRpYW5zIGVpZ2VuZXIgcmVuZGVyUHJvcGVydHkoKS1QaXBlbGluZSBnZWZcdTAwRkNocnQuXG5mdW5jdGlvbiBzdHJpcFR5cFByb3BlcnR5KGZyb250bWF0dGVyKSB7XG4gIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGZyb250bWF0dGVyKSkge1xuICAgIGlmIChTWVNURU1fUFJPUEVSVElFUy5pbmNsdWRlcyhrZXkudHJpbSgpLnRvTG93ZXJDYXNlKCkpKSBkZWxldGUgZnJvbnRtYXR0ZXJba2V5XTtcbiAgfVxuICByZXR1cm4gZnJvbnRtYXR0ZXI7XG59XG5cbi8vIFNwZWljaGVyb3J0IGVpbmVzIEZyb250bWF0dGVyLUJsb2NrcyBpbiBkZW4gUGx1Z2luLVNldHRpbmdzIC0gZW50d2VkZXIgZGFzXG4vLyBUWVAtRnJvbnRtYXR0ZXIgZWluZXMgVFlQcyAodHlwZURlZmF1bHRGcm9udG1hdHRlci90eXBlRmxvYXRpbmdLZXlzL1xuLy8gdHlwZVNob3J0Y3V0cykgb2RlciBkZXIgQmxvY2sgZWluZXMgc2VpbmVyIFN1YnR5cGVuICh0eXBlU3VidHlwZXMsIHNpZWhlXG4vLyBzdWJ0eXBlcy5qcykuIEVkaXRvciwgRmxvYXRpbmctTWVuXHUwMEZDLCBTaG9ydGN1dC1Lbm9wZiB1bmQgUHJvcGVydHktVW1iZW5lbm51bmdcbi8vIGFyYmVpdGVuIGF1c3NjaGxpZVx1MDBERmxpY2ggXHUwMEZDYmVyIGRpZXNlIFNjaG5pdHRzdGVsbGUgdW5kIG1cdTAwRkNzc2VuIGRlbiBVbnRlcnNjaGllZFxuLy8gbmljaHQga2VubmVuLlxuLy9cbi8vIGdldFNob3J0Y3V0cy9zZXRTaG9ydGN1dHMgaGFsdGVuIGRpZSBTaG9ydGN1dC1SZWNvcmRzIGplIEtleSAoeyBuYW1lIH0sXG4vLyBzaWVoZSBzaG9ydGN1dHMuanMpIC0gYmV3dXNzdCBuZWJlbiBkZW0gRnJvbnRtYXR0ZXIgc3RhdHQgZGFyaW4sIGRhbWl0IGRlclxuLy8gV2VydCBkZXIgUHJvcGVydHkgdHlwcmVpbiBibGVpYnQgdW5kIE9ic2lkaWFucyBuYXRpdmVzIFdpZGdldCB1bmFuZ2V0YXN0ZXRcbi8vIHdlaXRlcmxcdTAwRTR1ZnQuIERlciBXZXJ0IGltIEZyb250bWF0dGVyIGJsZWlidCBiZWkgZ2VzZXR6dGVtIFNob3J0Y3V0IGFsc1xuLy8gUlx1MDBGQ2NrZmFsbHdlcnQgc3RlaGVuLlxuZnVuY3Rpb24gdHlwZVN0b3JlKHBsdWdpbiwgdHlwZSkge1xuICByZXR1cm4ge1xuICAgIHR5cGUsXG4gICAgc3VidHlwZTogbnVsbCxcbiAgICBnZXRGcm9udG1hdHRlcjogKCkgPT4gcGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV0gPz8ge30sXG4gICAgc2V0RnJvbnRtYXR0ZXI6IChmcm9udG1hdHRlcikgPT4ge1xuICAgICAgcGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV0gPSBmcm9udG1hdHRlcjtcbiAgICB9LFxuICAgIGdldEZsb2F0aW5nOiAoKSA9PiBwbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXSA/PyBbXSxcbiAgICBzZXRGbG9hdGluZzogKGtleXMpID0+IHtcbiAgICAgIGlmIChrZXlzLmxlbmd0aCA+IDApIHBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdID0ga2V5cztcbiAgICAgIGVsc2UgZGVsZXRlIHBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdO1xuICAgIH0sXG4gICAgZ2V0U2hvcnRjdXRzOiAoKSA9PiBwbHVnaW4uc2V0dGluZ3MudHlwZVNob3J0Y3V0c1t0eXBlXSA/PyB7fSxcbiAgICBzZXRTaG9ydGN1dHM6IChzaG9ydGN1dHMpID0+IHtcbiAgICAgIGlmIChPYmplY3Qua2V5cyhzaG9ydGN1dHMpLmxlbmd0aCA+IDApIHBsdWdpbi5zZXR0aW5ncy50eXBlU2hvcnRjdXRzW3R5cGVdID0gc2hvcnRjdXRzO1xuICAgICAgZWxzZSBkZWxldGUgcGx1Z2luLnNldHRpbmdzLnR5cGVTaG9ydGN1dHNbdHlwZV07XG4gICAgfSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gc3VidHlwZVN0b3JlKHBsdWdpbiwgdHlwZSwgc3VidHlwZSkge1xuICByZXR1cm4ge1xuICAgIHR5cGUsXG4gICAgc3VidHlwZSxcbiAgICBnZXRGcm9udG1hdHRlcjogKCkgPT4gZ2V0U3VidHlwZShwbHVnaW4uc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpPy5mcm9udG1hdHRlciA/PyB7fSxcbiAgICBzZXRGcm9udG1hdHRlcjogKGZyb250bWF0dGVyKSA9PiB7XG4gICAgICBlbnN1cmVTdWJ0eXBlKHBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSkuZnJvbnRtYXR0ZXIgPSBmcm9udG1hdHRlcjtcbiAgICB9LFxuICAgIGdldEZsb2F0aW5nOiAoKSA9PiBnZXRTdWJ0eXBlKHBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSk/LmZsb2F0aW5nS2V5cyA/PyBbXSxcbiAgICBzZXRGbG9hdGluZzogKGtleXMpID0+IHtcbiAgICAgIGVuc3VyZVN1YnR5cGUocGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKS5mbG9hdGluZ0tleXMgPSBrZXlzO1xuICAgIH0sXG4gICAgZ2V0U2hvcnRjdXRzOiAoKSA9PiBnZXRTdWJ0eXBlKHBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSk/LnNob3J0Y3V0cyA/PyB7fSxcbiAgICBzZXRTaG9ydGN1dHM6IChzaG9ydGN1dHMpID0+IHtcbiAgICAgIGVuc3VyZVN1YnR5cGUocGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKS5zaG9ydGN1dHMgPSBzaG9ydGN1dHM7XG4gICAgfSxcbiAgfTtcbn1cblxuLy8gT2JzaWRpYW5zIGVpZ2VuZXMgRnJvbnRtYXR0ZXItV2lkZ2V0IChcIlByb3BlcnRpZXNcIikgaXN0IGtlaW5lIG9mZml6aWVsbGVcbi8vIFBsdWdpbi1BUEkuIEludGVybiBpc3QgZXMgZWluZSBDb21wb25lbnQtS2xhc3NlIChpbSBnZWJhdXRlbiBhcHAuanMgenVcbi8vIFwiTWV0YWRhdGFFZGl0b3JcIiBtaW5pZml6aWVydCksIGRpZSBzb3dvaGwgdm9uIGplZGVyIE1hcmtkb3duVmlldyBhbHMgYXVjaCB2b25cbi8vIGRlciBlaW5nZWJhdXRlbiBcIkZpbGUgUHJvcGVydGllc1wiLVBhbmUgdmVyd2VuZGV0IHdpcmQgLSBiZWlkZSBsZWdlbiBzaWNoIGJlaW1cbi8vIEVyemV1Z2VuIHVuY29uZGl0aW9uYWwgZWluZSBJbnN0YW56IHVudGVyIHZpZXcubWV0YWRhdGFFZGl0b3IgYW4uIERpZSBLbGFzc2Vcbi8vIHNlbGJzdCB3aXJkIG5pcmdlbmRzIHVudGVyIGVpbmVtIE5hbWVuIGV4cG9ydGllcnQsIGlzdCBhYmVyIFx1MDBGQ2JlciBlaW5lXG4vLyBiZWxpZWJpZ2UgYmVyZWl0cyB2b3JoYW5kZW5lIEluc3RhbnogZXJyZWljaGJhciAoaW5zdGFuY2UuY29uc3RydWN0b3IpIHVuZFxuLy8gYmxlaWJ0IGZcdTAwRkNyIGRpZSBEYXVlciBkZXIgT2JzaWRpYW4tU2Vzc2lvbiBzdGFiaWwgLSBlaW5tYWxpZ2VzIEFiZ3JlaWZlbiB1bmRcbi8vIFp3aXNjaGVuc3BlaWNoZXJuIHJlaWNodCBkZXNoYWxiIGF1cy5cbmxldCBjYWNoZWRFZGl0b3JDbGFzcyA9IG51bGw7XG5cbmZ1bmN0aW9uIGdldE1ldGFkYXRhRWRpdG9yQ2xhc3MoYXBwKSB7XG4gIGlmIChjYWNoZWRFZGl0b3JDbGFzcykgcmV0dXJuIGNhY2hlZEVkaXRvckNsYXNzO1xuXG4gIGNvbnN0IGFjdGl2ZSA9IGFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xuICBpZiAoYWN0aXZlPy5tZXRhZGF0YUVkaXRvcikge1xuICAgIGNhY2hlZEVkaXRvckNsYXNzID0gYWN0aXZlLm1ldGFkYXRhRWRpdG9yLmNvbnN0cnVjdG9yO1xuICAgIHJldHVybiBjYWNoZWRFZGl0b3JDbGFzcztcbiAgfVxuICBmb3IgKGNvbnN0IGxlYWYgb2YgYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xuICAgIGlmIChsZWFmLnZpZXc/Lm1ldGFkYXRhRWRpdG9yKSB7XG4gICAgICBjYWNoZWRFZGl0b3JDbGFzcyA9IGxlYWYudmlldy5tZXRhZGF0YUVkaXRvci5jb25zdHJ1Y3RvcjtcbiAgICAgIHJldHVybiBjYWNoZWRFZGl0b3JDbGFzcztcbiAgICB9XG4gIH1cbiAgY2FjaGVkRWRpdG9yQ2xhc3MgPSBoYXJ2ZXN0RWRpdG9yQ2xhc3MoYXBwKTtcbiAgcmV0dXJuIGNhY2hlZEVkaXRvckNsYXNzO1xufVxuXG4vLyBTb2xhbmdlIGluIGRpZXNlciBTZXNzaW9uIG5vY2gga2VpbmUgTm90aXogb2ZmZW4gd2FyICh6LiBCLiBkaXJla3QgbmFjaCBkZW1cbi8vIFN0YXJ0LCB3ZW5uIGRpZSBUWVAtQW5zaWNodCBkaWUgZXJzdGUgaXN0LCBkaWUgbWFuIFx1MDBGNmZmbmV0KSwgZ2lidCBlcyBrZWluZVxuLy8gZWluemlnZSBNYXJrZG93blZpZXcgdW5kIGRhbWl0IGF1Y2gga2VpbmUgSW5zdGFueiwgXHUwMEZDYmVyIGRpZSBkaWUgS2xhc3NlIG9iZW5cbi8vIGVycmVpY2hiYXIgd1x1MDBFNHJlLiBEYW5uIGJhdXQgc2ljaCBkaWVzZXIgV2VnIHNlbGJzdCBlaW5lOiBlaW5lIGZyZWllXG4vLyBXb3Jrc3BhY2VMZWFmIChvaG5lIFBhcmVudCwgbmllIGluIGVpbmVtIFNwbGl0IHVuZCBuaWUgaW0gRE9NKSB1bmQgZGFyYXVmXG4vLyBlaW5lIE1hcmtkb3duVmlldyBhdXMgT2JzaWRpYW5zIGVpZ2VuZXIgVmlldy1SZWdpc3RyeSAtIGRlcmVuIEtvbnN0cnVrdG9yXG4vLyBsZWd0IGRpZSBtZXRhZGF0YUVkaXRvci1JbnN0YW56IHVuY29uZGl0aW9uYWwgYW4gKGRhc3NlbGJlLCB3YXMgc29uc3QgamVkZVxuLy8gZ2VcdTAwRjZmZm5ldGUgTm90aXogdHV0KS4gR2VicmF1Y2h0IHdpcmQgbnVyIGRpZSBLbGFzc2VucmVmZXJlbno7IGRpZSBWaWV3IHdpcmRcbi8vIGRpcmVrdCBkYW5hY2ggd2llZGVyIGVudGxhZGVuLCBkaWUgTGVhZiBoXHUwMEU0bmd0IGFuIG5pY2h0cyB1bmQgdmVyc2Nod2luZGV0IG1pdFxuLy8gaWhyLiBCZXd1c3N0IE5JQ0hUIGxlYWYuZGV0YWNoKCk6IGRhcyBlcndhcnRldCBlaW5lbiBQYXJlbnQsIGRlbiBkaWVzZSBMZWFmXG4vLyBuaWUgaGF0dGUuXG5mdW5jdGlvbiBoYXJ2ZXN0RWRpdG9yQ2xhc3MoYXBwKSB7XG4gIGxldCB2aWV3ID0gbnVsbDtcbiAgdHJ5IHtcbiAgICBjb25zdCBjcmVhdGVWaWV3ID0gYXBwLnZpZXdSZWdpc3RyeT8uZ2V0Vmlld0NyZWF0b3JCeVR5cGU/LihcIm1hcmtkb3duXCIpO1xuICAgIGlmICghY3JlYXRlVmlldykgcmV0dXJuIG51bGw7XG4gICAgdmlldyA9IGNyZWF0ZVZpZXcobmV3IFdvcmtzcGFjZUxlYWYoYXBwKSk7XG4gICAgcmV0dXJuIHZpZXcubWV0YWRhdGFFZGl0b3I/LmNvbnN0cnVjdG9yID8/IG51bGw7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcihcIlt0eXAtc3lzdGVtXSBNZXRhZGF0YUVkaXRvci1LbGFzc2Uga29ubnRlIG5pY2h0IGVybWl0dGVsdCB3ZXJkZW5cIiwgZXJyb3IpO1xuICAgIHJldHVybiBudWxsO1xuICB9IGZpbmFsbHkge1xuICAgIHRyeSB7XG4gICAgICB2aWV3Py51bmxvYWQoKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihcIlt0eXAtc3lzdGVtXSBWZXJ3ZXJmZW4gZGVyIEhpbGZzLU1hcmtkb3duVmlldyBmZWhsZ2VzY2hsYWdlblwiLCBlcnJvcik7XG4gICAgfVxuICB9XG59XG5cbi8vIEFuYWxvZyB6dSBnZXRNZXRhZGF0YUVkaXRvckNsYXNzIG9iZW46IFJlZmVyZW56IGF1ZiBkaWUgcHJpdmF0ZSBQcm9wZXJ0eS1cbi8vIFplaWxlbi1LbGFzc2UgKGltIGdlYmF1dGVuIGFwcC5qcyBtaW5pZml6aWVydCksIFx1MDBGQ2JlciBlaW5lIGJlcmVpdHNcbi8vIGdlcmVuZGVydGUgWmVpbGUgYWJnZWdyaWZmZW4gKGRlcmVuIC5jb25zdHJ1Y3RvcikgLSBzdGFiaWwgZlx1MDBGQ3IgZGllIERhdWVyXG4vLyBkZXIgU2Vzc2lvbi4gXCJlZGl0b3JcIiAoZmFsbHMgc2Nob24gdm9yaGFuZGVuKSB3aXJkIHp1ZXJzdCBwcm9iaWVydCwgZGFcbi8vIGRpZXNlIEtsYXNzZSBhdXNzY2hsaWVcdTAwREZsaWNoIGZcdTAwRkNyIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoKCkgZ2VicmF1Y2h0IHdpcmRcbi8vIHVuZCBpbiBhbGxlciBSZWdlbCBzY2hvbiBkb3J0IHZlcmZcdTAwRkNnYmFyIGlzdCwgc29iYWxkIGRlciBUeXAgbWluZGVzdGVuc1xuLy8gZWluZSBQcm9wZXJ0eSBoYXQuXG5sZXQgY2FjaGVkUHJvcGVydHlSb3dDbGFzcyA9IG51bGw7XG5cbmZ1bmN0aW9uIGdldFByb3BlcnR5Um93Q2xhc3MoYXBwLCBlZGl0b3IpIHtcbiAgaWYgKGNhY2hlZFByb3BlcnR5Um93Q2xhc3MpIHJldHVybiBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzO1xuICBpZiAoZWRpdG9yPy5yZW5kZXJlZD8uWzBdKSB7XG4gICAgY2FjaGVkUHJvcGVydHlSb3dDbGFzcyA9IGVkaXRvci5yZW5kZXJlZFswXS5jb25zdHJ1Y3RvcjtcbiAgICByZXR1cm4gY2FjaGVkUHJvcGVydHlSb3dDbGFzcztcbiAgfVxuICBjb25zdCBhY3RpdmUgPSBhcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcbiAgaWYgKGFjdGl2ZT8ubWV0YWRhdGFFZGl0b3I/LnJlbmRlcmVkPy5bMF0pIHtcbiAgICBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzID0gYWN0aXZlLm1ldGFkYXRhRWRpdG9yLnJlbmRlcmVkWzBdLmNvbnN0cnVjdG9yO1xuICAgIHJldHVybiBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzO1xuICB9XG4gIGZvciAoY29uc3QgbGVhZiBvZiBhcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpKSB7XG4gICAgaWYgKGxlYWYudmlldz8ubWV0YWRhdGFFZGl0b3I/LnJlbmRlcmVkPy5bMF0pIHtcbiAgICAgIGNhY2hlZFByb3BlcnR5Um93Q2xhc3MgPSBsZWFmLnZpZXcubWV0YWRhdGFFZGl0b3IucmVuZGVyZWRbMF0uY29uc3RydWN0b3I7XG4gICAgICByZXR1cm4gY2FjaGVkUHJvcGVydHlSb3dDbGFzcztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIG51bGw7XG59XG5cbi8vIEVyZ1x1MDBFNG56dCBkYXMgUmVjaHRza2xpY2stS29udGV4dG1lblx1MDBGQyBlaW5lciBQcm9wZXJ0eS1aZWlsZSB1bSBlaW5lbiBUb2dnbGVcbi8vIFwiRmxvYXRpbmdcIiBHQU5aIE9CRU4gLSBhYmVyIGV4a2x1c2l2IGZcdTAwRkNyIFplaWxlbiBkaWVzZXMgUGx1Z2luc1xuLy8gZWlnZW5lciBUWVAtRGV0YWlsYW5zaWNodCAoZXJrYW5udCBhbiBvd25lci5mcmVkU3RvcmUsIHNpZWhlIHVudGVuKSwgbmllIGluXG4vLyBlY2h0ZW4gTm90aXplbi4gVW5hYmhcdTAwRTRuZ2lnIHZvbSBcIitcIi1CdXR0b24gbGlua3MgbmViZW4gZGVtIG5vcm1hbGVuXG4vLyAoZnJlZFBlbmRpbmdGbG9hdGluZ0FkZCksIGRlciBudXIgYmVpbSBORVVFTiBBbmxlZ2VuIGdyZWlmdCAtIGRpZXNlciBUb2dnbGVcbi8vIHdpcmt0IGF1ZiBKRURFIGJlcmVpdHMgdm9yaGFuZGVuZSBQcm9wZXJ0eSwgaW4gYmVpZGUgUmljaHR1bmdlbi5cbi8vXG4vLyBPYnNpZGlhbnMgUHJvcGVydHktS29udGV4dG1lblx1MDBGQyBpc3Qga2VpbmUgb2ZmaXppZWxsZSBFcndlaXRlcnVuZ3NzdGVsbGU6IEVzXG4vLyBiYXV0IGF1ZiBkZW0gRGVza3RvcCBlaW5lbiBOQVRJVkVOIEVsZWN0cm9uLU1lblx1MDBGQyBhdXMgZWluZXIgaW50ZXJuXG4vLyBlcnpldWd0ZW4gTWVudS1JbnN0YW56IHVuZCB6ZWlndCBzaWUgaW5uZXJoYWxiIHZvbiBzaG93UHJvcGVydHlNZW51KCkgaW5cbi8vIGVpbmVtIGVpbnppZ2VuIHN5bmNocm9uZW4gQXVmcnVmIGFuIChrZWluIFdvcmtzcGFjZS1FdmVudCwga2VpbiBET00tUG9wdXAsXG4vLyBkYXMgc2ljaCBuYWNodHJcdTAwRTRnbGljaCBwZXIgRE9NLU1hbmlwdWxhdGlvbiBlcndlaXRlcm4gbGllXHUwMERGZSAtIGFuZGVycyBhbHNcbi8vIHouIEIuIGJlaSBcImZpbGUtbWVudVwiKS4gRGVzaGFsYiBoaWVyIGVpbiBNb25rZXktUGF0Y2ggYXVmIGRpZSBwcml2YXRlXG4vLyBaZWlsZW4tS2xhc3NlIHNlbGJzdCAod2llIHNjaG9uIGJlaW0gR3JhcGgtUmVuZGVyZXIsIHNpZWhlXG4vLyBncmFwaC1jb2xvcnMuanMpLCBhYmVyIHNvIGVuZyB3aWUgbVx1MDBGNmdsaWNoIGdlaGFsdGVuOiBmXHUwMEZDciBaZWlsZW4gZGllc2VzXG4vLyBQbHVnaW5zIHdpcmQgbGVkaWdsaWNoLCB1bm1pdHRlbGJhciBiZXZvciBPYnNpZGlhbiBzZWluZSBiZXJlaXRzIGZlcnRpZ1xuLy8gYXVmZ2ViYXV0ZSBNZW51LUluc3RhbnogYW56ZWlndCwgZWluIGVpbnppZ2VyIHp1c1x1MDBFNHR6bGljaGVyIGFkZEl0ZW0oKS1BdWZydWZcbi8vIGRhendpc2NoZW5nZXNjaG9iZW4gKFx1MDBGQ2JlciBlaW5lbiBudXIgZlx1MDBGQ3IgZGllc2VuIGVpbmVuIHN5bmNocm9uZW4gQXVmcnVmXG4vLyBha3RpdmVuLCBzaWNoIGRhbmFjaCBzZWxic3Qgd2llZGVyIHp1clx1MDBGQ2Nrc2V0emVuZGVuIFBhdGNoIGF1ZlxuLy8gTWVudS5wcm90b3R5cGUuc2hvd0F0TW91c2VFdmVudCAtIHNpY2hlciwgZGEgSlMgc2luZ2xlLXRocmVhZGVkIGlzdCB1bmRcbi8vIHdcdTAwRTRocmVuZGRlc3NlbiBrZWluIHp3ZWl0ZXMgTWVuXHUwMEZDIGF1ZmdlYmF1dCB3ZXJkZW4ga2FubikuIERpZSBnZXNhbXRlIFx1MDBGQ2JyaWdlXG4vLyBuYXRpdmUgTWVuXHUwMEZDLUxvZ2lrIChUeXAgXHUwMEU0bmRlcm4sIEF1c3NjaG5laWRlbi9Lb3BpZXJlbi9FaW5mXHUwMEZDZ2VuLCBFbnRmZXJuZW4pXG4vLyBibGVpYnQgZGFiZWkga29tcGxldHQgdW5hbmdldGFzdGV0LlxuZnVuY3Rpb24gZW5zdXJlUHJvcGVydHlNZW51UGF0Y2goYXBwLCBlZGl0b3IpIHtcbiAgY29uc3QgUm93Q2xhc3MgPSBnZXRQcm9wZXJ0eVJvd0NsYXNzKGFwcCwgZWRpdG9yKTtcbiAgaWYgKCFSb3dDbGFzcyB8fCBSb3dDbGFzcy5fZnJlZE1lbnVQYXRjaGVkKSByZXR1cm47XG4gIFJvd0NsYXNzLl9mcmVkTWVudVBhdGNoZWQgPSB0cnVlO1xuXG4gIGNvbnN0IG9yaWdpbmFsU2hvd1Byb3BlcnR5TWVudSA9IFJvd0NsYXNzLnByb3RvdHlwZS5zaG93UHJvcGVydHlNZW51O1xuICBSb3dDbGFzcy5wcm90b3R5cGUuc2hvd1Byb3BlcnR5TWVudSA9IGZ1bmN0aW9uIChldmVudCkge1xuICAgIGNvbnN0IG93bmVyID0gdGhpcy5tZXRhZGF0YUVkaXRvcj8ub3duZXI7XG4gICAgaWYgKCFvd25lcj8uZnJlZFN0b3JlKSByZXR1cm4gb3JpZ2luYWxTaG93UHJvcGVydHlNZW51LmNhbGwodGhpcywgZXZlbnQpO1xuXG4gICAgY29uc3Qgcm93ID0gdGhpcztcbiAgICBjb25zdCBvcmlnaW5hbFNob3dBdE1vdXNlRXZlbnQgPSBNZW51LnByb3RvdHlwZS5zaG93QXRNb3VzZUV2ZW50O1xuICAgIE1lbnUucHJvdG90eXBlLnNob3dBdE1vdXNlRXZlbnQgPSBmdW5jdGlvbiAobW91c2VFdmVudCkge1xuICAgICAgTWVudS5wcm90b3R5cGUuc2hvd0F0TW91c2VFdmVudCA9IG9yaWdpbmFsU2hvd0F0TW91c2VFdmVudDtcbiAgICAgIGNvbnN0IGlzRmxvYXRpbmcgPSBvd25lci5mcmVkU3RvcmUuZ2V0RmxvYXRpbmcoKS5pbmNsdWRlcyhyb3cuZW50cnkua2V5KTtcbiAgICAgIC8vIFwidGl0bGVcIiBpc3QgZGllIGVyc3RlIGRlciB2b24gc2hvd1Byb3BlcnR5TWVudSByZWdpc3RyaWVydGVuXG4gICAgICAvLyBTZWN0aW9ucyAoYWRkU2VjdGlvbnMoWy4uLl0pKSB1bmQgYXVmIGRlbSBEZXNrdG9wIHNvbnN0IGxlZXIgKG51clxuICAgICAgLy8gYXVmIE1vYmlsZSBtaXQgZWluZW0gcmVpbmVuIExhYmVsLUVpbnRyYWcgYmVsZWd0KSAtIGxhbmRldCBhbHNvXG4gICAgICAvLyB6dXZlcmxcdTAwRTRzc2lnIGdhbnogb2Jlbi4gXCJwaW4tb2ZmXCIgKGR1cmNoZ2VzdHJpY2hlbmVyIFBpbikgcGFzc3RcbiAgICAgIC8vIGluaGFsdGxpY2ggenUgXCJuaWNodCBmZXN0IHZlcmFua2VydFwiID0gZmxvYXRpbmcsIGluIEFuYWxvZ2llIHp1XG4gICAgICAvLyBcInBpblwiIGZcdTAwRkNyIFwiZml4aWVydFwiIGluIGFuZGVyZW4gQXBwcy5cbiAgICAgIHRoaXMuYWRkSXRlbSgoaXRlbSkgPT5cbiAgICAgICAgaXRlbVxuICAgICAgICAgIC5zZXRUaXRsZShcIkZsb2F0aW5nXCIpXG4gICAgICAgICAgLnNldEljb24oXCJwaW4tb2ZmXCIpXG4gICAgICAgICAgLnNldENoZWNrZWQoaXNGbG9hdGluZylcbiAgICAgICAgICAuc2V0U2VjdGlvbihcInRpdGxlXCIpXG4gICAgICAgICAgLm9uQ2xpY2soKCkgPT4gdG9nZ2xlRmxvYXRpbmdQcm9wZXJ0eShvd25lci5mcmVkVmlldywgb3duZXIuZnJlZFN0b3JlLCByb3cuZW50cnkua2V5KSlcbiAgICAgICk7XG4gICAgICByZXR1cm4gb3JpZ2luYWxTaG93QXRNb3VzZUV2ZW50LmNhbGwodGhpcywgbW91c2VFdmVudCk7XG4gICAgfTtcblxuICAgIHJldHVybiBvcmlnaW5hbFNob3dQcm9wZXJ0eU1lbnUuY2FsbCh0aGlzLCBldmVudCk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIHRvZ2dsZUZsb2F0aW5nUHJvcGVydHkodmlldywgc3RvcmUsIGtleSkge1xuICBjb25zdCBmbG9hdGluZyA9IHN0b3JlLmdldEZsb2F0aW5nKCk7XG4gIHN0b3JlLnNldEZsb2F0aW5nKGZsb2F0aW5nLmluY2x1ZGVzKGtleSkgPyBmbG9hdGluZy5maWx0ZXIoKGspID0+IGsgIT09IGtleSkgOiBbLi4uZmxvYXRpbmcsIGtleV0pO1xuICB2aWV3LnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgLy8gQWt0dWFsaXNpZXJ0IGRpZSBGZXR0LS9LdXJzaXYtTWFya2llcnVuZyBzb2ZvcnQgLSBzb3dvaGwgaW4gZGllc2VyXG4gIC8vIERldGFpbGFuc2ljaHQgYWxzIGF1Y2ggaW4gYmVyZWl0cyBvZmZlbmVuIE5vdGl6ZW4gZGllc2VzIFR5cHMuXG4gIHZpZXcucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xufVxuXG4vLyBEYXMgV2lkZ2V0IGVyd2FydGV0IGFscyB6d2VpdGVuIEtvbnN0cnVrdG9yLVBhcmFtZXRlciBlaW4gXCJvd25lclwiLU9iamVrdCAtXG4vLyBkYXMgaXN0IGRpZSBlaW56aWdlIFNjaG5pdHRzdGVsbGUsIFx1MDBGQ2JlciBkaWUgZXMgYW4gZWluZSBEYXRlaSBnZWJ1bmRlbiB3aXJkLlxuLy8gU3RhdHQgZWluZXIgZWNodGVuIE5vdGl6IGhcdTAwRTRuZ2VuIHdpciBlcyBoaWVyIGFuIGVpbiBQbGFpbi1PYmplY3QgaW4gZGVuXG4vLyBQbHVnaW4tU2V0dGluZ3M6IHNhdmVGcm9udG1hdHRlcihvYmopIGJla29tbXQgYmVpIGplZGVyIFx1MDBDNG5kZXJ1bmcgKFByb3BlcnR5XG4vLyBoaW56dWdlZlx1MDBGQ2d0L3VtYmVuYW5udC9nZWxcdTAwRjZzY2h0LCBXZXJ0IGdlXHUwMEU0bmRlcnQsIFJlaWhlbmZvbGdlIGdlXHUwMEU0bmRlcnQpIGRhc1xuLy8gdm9sbHN0XHUwMEU0bmRpZ2UsIGFrdHVlbGxlIFByb3BlcnR5LVNldCBcdTAwRkNiZXJnZWJlbi4gc2hpZnRGb2N1c0JlZm9yZS9BZnRlciBzdGV1ZXJuXG4vLyBudXIsIHdvaGluIGRlciBGb2t1cyBiZWltIFZlcmxhc3NlbiBkZXMgV2lkZ2V0cyBwZXIgUGZlaWx0YXN0ZS9UYWIgc3ByaW5ndCxcbi8vIHVuZCBkXHUwMEZDcmZlbiBOby1PcHMgc2Vpbi4gZ2V0RmlsZSgpIHdpcmQgdm9uIGplZGVyIGVpbnplbG5lbiBQcm9wZXJ0eS1aZWlsZVxuLy8gYmVpbSBSZW5kZXJuIGF1ZmdlcnVmZW4gKGZcdTAwRkNyIHNvdXJjZVBhdGgsIHouIEIuIGJlaSBMaW5rLVdlcnRlbikgLSBvaG5lXG4vLyBlY2h0ZSBEYXRlaSBnaWJ0IGVzIGhpZXIgbmljaHRzIFNpbm52b2xsZXMgenVyXHUwMEZDY2t6dWdlYmVuLCBhYmVyIGRpZSBNZXRob2RlXG4vLyBtdXNzIGV4aXN0aWVyZW4sIHNvbnN0IGNyYXNodCBkYXMgV2lkZ2V0IGJlaW0gUmVuZGVybiBqZWRlciBQcm9wZXJ0eS5cbi8vXG4vLyBFaW5lIEVkaXRvci1JbnN0YW56IGplIEJsb2NrIChUWVAgYnp3LiBTdWJ0eXApLCBnZWJ1bmRlbiBhbiBkZW4gU3BlaWNoZXJvcnRcbi8vIGF1cyBzdG9yZSAoc2llaGUgdHlwZVN0b3JlL3N1YnR5cGVTdG9yZSkgLSBTdGFuZGFyZC0gdW5kIEZsb2F0aW5nIFByb3BlcnRpZXNcbi8vIChzaWVoZSB0eXBlRmxvYXRpbmdLZXlzIGluIHNldHRpbmdzLmpzKSB0ZWlsZW4gc2ljaCBkaWVzZWxiZSBMaXN0ZSB1bmRcbi8vIFJlaWhlbmZvbGdlLCBudXIgRmxvYXRpbmctbWFya2llcnRlIEtleXMgd2VyZGVuIHZvbiBnZXRUeXBlRGVmYXVsdHMoKVxuLy8gKG1haW4uanMpIG5pY2h0IGF1dG9tYXRpc2NoIGF1c2dlbGllZmVydC4gZWRpdG9yLmZyZWRQZW5kaW5nRmxvYXRpbmdBZGQgd2lyZFxuLy8gdm9uIHR5cC12aWV3LmpzIHZvciBhZGRCbGFua1Byb3BlcnR5KCkgZ2VzZXR6dCwgdW0gZGllIGFscyBuXHUwMEU0Y2hzdGVzXG4vLyBoaW56dWdlZlx1MDBGQ2d0ZSAoYnp3LiB1bWJlbmFubnRlKSBQcm9wZXJ0eSBhbHMgRmxvYXRpbmcgenUgbWFya2llcmVuIC0gc2llaGVcbi8vIHNhdmVGcm9udG1hdHRlciB1bnRlbi5cbi8vIFRhc3RhdHVyLU5hdmlnYXRpb24gXHUwMEZDYmVyIGRpZSBHcmVuemVuIGVpbmVyIEVkaXRvci1JbnN0YW56IGhpbmF1cyAoc2llaGVcbi8vIGZyb250bWF0dGVyLWJsb2Nrcy5qcyk6IE9ic2lkaWFuIGJld2VndCBkZW4gRm9rdXMgbnVyIGlubmVyaGFsYiBzZWluZXJcbi8vIGVpZ2VuZW4gWmVpbGVubGlzdGUgLSBhbSBvYmVyZW4gRW5kZSBzcHJpbmd0IGVyIGF1ZiBkaWUgXHUwMERDYmVyc2NocmlmdCBkZXNcbi8vIEVkaXRvcnMsIGFtIHVudGVyZW4gYXVmIGRlc3NlbiBcIkFkZCBwcm9wZXJ0eVwiLUJ1dHRvbi4gQmVpZGUgc2luZCBoaWVyIHBlclxuLy8gQ1NTIGF1c2dlYmxlbmRldCwgZGllIEtldHRlIGVuZGV0ZSBhbHNvIGFtIEJsb2NrcmFuZC5cbi8vXG4vLyBTdGF0dCBvd25lci5zaGlmdEZvY3VzQmVmb3JlL3NoaWZ0Rm9jdXNBZnRlciAoZGllIE9ic2lkaWFuIG51ciBcdTAwRkNiZXIgZ2VuYXVcbi8vIGRpZXNlIGJlaWRlbiBhdXNnZWJsZW5kZXRlbiBFbGVtZW50ZSBlcnJlaWNodCkgZGFoZXIgZWluIGVpZ2VuZXIgSGFuZGxlciBpblxuLy8gZGVyIENhcHR1cmUtUGhhc2UsIGRlciBWT1IgZGVtIEhhbmRsZXIgZGVyIFplaWxlIGxcdTAwRTR1ZnQuIEVyIGdyZWlmdCBudXIsIHdlbm5cbi8vIGRpZSBaZWlsZSBTRUxCU1QgZGVuIEZva3VzIGhhdCAoZXZlbnQudGFyZ2V0ID09PSBjb250YWluZXJFbCBkZXIgWmVpbGUpIC1cbi8vIGdlbmF1IGRpZSBCZWRpbmd1bmcsIHVudGVyIGRlciBhdWNoIE9ic2lkaWFuIHNlaW5lIGovay1OYXZpZ2F0aW9uIHp1bFx1MDBFNHNzdCxcbi8vIGJlaW0gVGlwcGVuIGluIGVpbmVtIEtleS0vV2VydC1GZWxkIGFsc28gbmllLlxuZnVuY3Rpb24gcmVnaXN0ZXJGb2N1c0NoYWluKGVkaXRvciwgb25TaGlmdEZvY3VzKSB7XG4gIGVkaXRvci5jb250YWluZXJFbC5hZGRFdmVudExpc3RlbmVyKFxuICAgIFwia2V5ZG93blwiLFxuICAgIChldmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmlzQ29tcG9zaW5nIHx8IGV2ZW50LmRlZmF1bHRQcmV2ZW50ZWQpIHJldHVybjtcbiAgICAgIC8vIE1laHJmYWNoLUF1c3dhaGw6IE9ic2lkaWFuIGVyd2VpdGVydCBkYW1pdCBkaWUgQXVzd2FobCwgc3RhdHQgZGVuXG4gICAgICAvLyBGb2t1cyB6dSBiZXdlZ2VuLlxuICAgICAgaWYgKGVkaXRvci5zZWxlY3RlZExpbmVzPy5zaXplID4gMSkgcmV0dXJuO1xuICAgICAgaWYgKGV2ZW50LnNoaWZ0S2V5ICYmIChldmVudC5rZXkgPT09IFwiQXJyb3dVcFwiIHx8IGV2ZW50LmtleSA9PT0gXCJBcnJvd0Rvd25cIikpIHJldHVybjtcblxuICAgICAgY29uc3QgaW5kZXggPSBlZGl0b3IucmVuZGVyZWQuZmluZEluZGV4KChyb3cpID0+IHJvdy5jb250YWluZXJFbCA9PT0gZXZlbnQudGFyZ2V0KTtcbiAgICAgIGlmIChpbmRleCA9PT0gLTEpIHJldHVybjtcblxuICAgICAgY29uc3QgdXAgPSBldmVudC5rZXkgPT09IFwiQXJyb3dVcFwiIHx8IGV2ZW50LmtleSA9PT0gXCJrXCIgfHwgKGV2ZW50LmtleSA9PT0gXCJUYWJcIiAmJiBldmVudC5zaGlmdEtleSk7XG4gICAgICBjb25zdCBkb3duID0gZXZlbnQua2V5ID09PSBcIkFycm93RG93blwiIHx8IGV2ZW50LmtleSA9PT0gXCJqXCIgfHwgKGV2ZW50LmtleSA9PT0gXCJUYWJcIiAmJiAhZXZlbnQuc2hpZnRLZXkpO1xuICAgICAgbGV0IHN0ZXAgPSAwO1xuICAgICAgaWYgKHVwICYmIGluZGV4ID09PSAwKSBzdGVwID0gLTE7XG4gICAgICBlbHNlIGlmIChkb3duICYmIGluZGV4ID09PSBlZGl0b3IucmVuZGVyZWQubGVuZ3RoIC0gMSkgc3RlcCA9IDE7XG4gICAgICBpZiAoc3RlcCA9PT0gMCB8fCAhb25TaGlmdEZvY3VzKHN0ZXApKSByZXR1cm47XG5cbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICB9LFxuICAgIHRydWVcbiAgKTtcbn1cblxuZnVuY3Rpb24gbW91bnRGcm9udG1hdHRlckVkaXRvcih2aWV3LCBjb250YWluZXJFbCwgc3RvcmUsIHsgb25TaGlmdEZvY3VzIH0gPSB7fSkge1xuICBjb25zdCBhcHAgPSB2aWV3LmFwcDtcbiAgY29uc3QgRWRpdG9yQ2xhc3MgPSBnZXRNZXRhZGF0YUVkaXRvckNsYXNzKGFwcCk7XG4gIGlmICghRWRpdG9yQ2xhc3MpIHtcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLXVuYXZhaWxhYmxlXCIsXG4gICAgICB0ZXh0OiBcIlp1bSBJbml0aWFsaXNpZXJlbiBkZXMgRWRpdG9ycyBiaXR0ZSB6dWVyc3QgZWlubWFsIGVpbmUgTm90aXogXHUwMEY2ZmZuZW4uXCIsXG4gICAgfSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBvd25lciA9IHtcbiAgICBhcHAsXG4gICAgLy8gTWFya2VyIGZcdTAwRkNyIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoKCkgb2JlbjogaWRlbnRpZml6aWVydCBQcm9wZXJ0eS1cbiAgICAvLyBaZWlsZW4gZGllc2VzIFBsdWdpbi1laWdlbmVuIEVkaXRvcnMgKG5pZSBlaW5lciBlY2h0ZW4gTm90aXopIHVuZFxuICAgIC8vIGxpZWZlcnQgU3BlaWNoZXJvcnQvVmlldywgZGllIGRlciBnbG9iYWxlIE1lblx1MDBGQy1QYXRjaCBwcm8gWmVpbGVcbiAgICAvLyBkeW5hbWlzY2ggYnJhdWNodCAoZGllIFBhdGNoLUluc3RhbGxhdGlvbiBzZWxic3QgcGFzc2llcnQgbnVyIGVpbm1hbCxcbiAgICAvLyB1bmFiaFx1MDBFNG5naWcgZGF2b24sIHdlbGNoZXIgQmxvY2sgZGFiZWkgZ2VyYWRlIG9mZmVuIHdhcikuXG4gICAgZnJlZFN0b3JlOiBzdG9yZSxcbiAgICBmcmVkVmlldzogdmlldyxcbiAgICBnZXRGaWxlKCkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfSxcbiAgICAvLyBOdXIgZlx1MDBGQ3IgT2JzaWRpYW5zIEhvdmVyLVByZXZpZXcgYmVpIGludGVybmVuIExpbmtzIGlubmVyaGFsYiBlaW5lc1xuICAgIC8vIFByb3BlcnR5LVdlcnRzIChFdmVudCBcImhvdmVyLWxpbmtcIikgLSBiZWxpZWJpZ2VyIFN0cmluZyByZWljaHQuXG4gICAgZ2V0SG92ZXJTb3VyY2UoKSB7XG4gICAgICByZXR1cm4gXCJmcmVkLXR5cC1mcm9udG1hdHRlclwiO1xuICAgIH0sXG4gICAgc2hpZnRGb2N1c0JlZm9yZSgpIHt9LFxuICAgIHNoaWZ0Rm9jdXNBZnRlcigpIHt9LFxuICAgIC8vIE9ic2lkaWFucyBFZGl0b3IgcnVmdCBkaWVzIGdlbmF1IGVpbm1hbCBwcm8gYWJnZXNjaGxvc3NlbmVyIFx1MDBDNG5kZXJ1bmcgYXVmXG4gICAgLy8gKFJlbmFtZSBlcnN0IGJlaW0gQmx1ciBkZXMgS2V5LUlucHV0cywgc2llaGUgaGFuZGxlVXBkYXRlS2V5IGltXG4gICAgLy8gZ2ViYXV0ZW4gYXBwLmpzKSAtIGplZGVyIEF1ZnJ1ZiB0clx1MDBFNGd0IGhpZXIgYWxzbyBtYXhpbWFsIGVpbmVcbiAgICAvLyBoaW56dWdlZlx1MDBGQ2d0ZSB1bmQvb2RlciBlbnRmZXJudGUgKG5pY2h0LWxlZXJlKSBQcm9wZXJ0eSwgbmllIG1laHJlcmVcbiAgICAvLyBnbGVpY2h6ZWl0aWcgYXVcdTAwREZlciBiZWkgZWluZW0gTWVocmZhY2gtTFx1MDBGNnNjaGVuLiBEYXMgbWFjaHQgZGllXG4gICAgLy8gRmxvYXRpbmctTWFya2llcnVuZyB1bnRlbiByb2J1c3QgbmFjaGZcdTAwRkNocmJhciwgb2huZSBad2lzY2hlbnp1c3RcdTAwRTRuZGVcbiAgICAvLyB3XHUwMEU0aHJlbmQgZGVzIFRpcHBlbnMgdmVyZm9sZ2VuIHp1IG1cdTAwRkNzc2VuLlxuICAgIHNhdmVGcm9udG1hdHRlcihmcm9udG1hdHRlcikge1xuICAgICAgLy8gRmFsbHMgaGllciBnZXJhZGUgZWluZSBaZWlsZSBcIlRZUFwiL1wiU1VCVFlQXCIgZWluZ2VnZWJlbiB3dXJkZTogbmljaHQgXHUwMEZDYmVybmVobWVuLlxuICAgICAgLy8gU2llIGJsZWlidCBiaXMgenVtIG5cdTAwRTRjaHN0ZW4gTmV1LU1vdW50ZW4gc2ljaHRiYXIgKGtlaW4gZXJuZXV0ZXJcbiAgICAgIC8vIHN5bmNocm9uaXplKCktQXVmcnVmIGhpZXIsIHNpZWhlIEtvbW1lbnRhciBhbiBzdHJpcFR5cFByb3BlcnR5KS5cbiAgICAgIHN0cmlwVHlwUHJvcGVydHkoZnJvbnRtYXR0ZXIpO1xuXG4gICAgICBjb25zdCBwcmV2aW91cyA9IHN0b3JlLmdldEZyb250bWF0dGVyKCk7XG4gICAgICBjb25zdCBwcmV2aW91c0tleXMgPSBPYmplY3Qua2V5cyhwcmV2aW91cykuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gXCJcIik7XG4gICAgICBjb25zdCBjdXJyZW50S2V5cyA9IE9iamVjdC5rZXlzKGZyb250bWF0dGVyKS5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBcIlwiKTtcbiAgICAgIGNvbnN0IHJlbW92ZWRLZXlzID0gcHJldmlvdXNLZXlzLmZpbHRlcigoa2V5KSA9PiAhY3VycmVudEtleXMuaW5jbHVkZXMoa2V5KSk7XG4gICAgICBjb25zdCBhZGRlZEtleXMgPSBjdXJyZW50S2V5cy5maWx0ZXIoKGtleSkgPT4gIXByZXZpb3VzS2V5cy5pbmNsdWRlcyhrZXkpKTtcblxuICAgICAgbGV0IGZsb2F0aW5nID0gc3RvcmUuZ2V0RmxvYXRpbmcoKTtcbiAgICAgIGlmIChyZW1vdmVkS2V5cy5sZW5ndGggPT09IDEgJiYgYWRkZWRLZXlzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAvLyBVbWJlbmVubnVuZyBlaW5lciBiZXN0ZWhlbmRlbiBQcm9wZXJ0eSAtIEZsb2F0aW5nLU1hcmtpZXJ1bmcgd2FuZGVydCBtaXQgdW0uXG4gICAgICAgIGZsb2F0aW5nID0gZmxvYXRpbmcubWFwKChrZXkpID0+IChrZXkgPT09IHJlbW92ZWRLZXlzWzBdID8gYWRkZWRLZXlzWzBdIDoga2V5KSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAocmVtb3ZlZEtleXMubGVuZ3RoID4gMCkgZmxvYXRpbmcgPSBmbG9hdGluZy5maWx0ZXIoKGtleSkgPT4gIXJlbW92ZWRLZXlzLmluY2x1ZGVzKGtleSkpO1xuICAgICAgICBpZiAoZWRpdG9yLmZyZWRQZW5kaW5nRmxvYXRpbmdBZGQgJiYgYWRkZWRLZXlzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAgIGZsb2F0aW5nID0gWy4uLmZsb2F0aW5nLCBhZGRlZEtleXNbMF1dO1xuICAgICAgICAgIGVkaXRvci5mcmVkUGVuZGluZ0Zsb2F0aW5nQWRkID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIFNob3J0Y3V0cyBoXHUwMEU0bmdlbiBhbSBLZXksIG5pY2h0IGFtIFdlcnQgKHNpZWhlIHNob3J0Y3V0cy5qcykgdW5kIG1cdTAwRkNzc2VuXG4gICAgICAvLyBkZXNoYWxiIGdlbmF1IHdpZSBkaWUgRmxvYXRpbmctTWFya2llcnVuZyBuYWNoZ2VmXHUwMEZDaHJ0IHdlcmRlbjogYmVpIGVpbmVyXG4gICAgICAvLyBVbWJlbmVubnVuZyBtaXR3YW5kZXJuLCBiZWkgZWluZW0gTFx1MDBGNnNjaGVuIG1pdCB2ZXJzY2h3aW5kZW4uXG4gICAgICBjb25zdCBzaG9ydGN1dHMgPSB7IC4uLnN0b3JlLmdldFNob3J0Y3V0cygpIH07XG4gICAgICBpZiAocmVtb3ZlZEtleXMubGVuZ3RoID09PSAxICYmIGFkZGVkS2V5cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgaWYgKHNob3J0Y3V0c1tyZW1vdmVkS2V5c1swXV0pIHtcbiAgICAgICAgICBzaG9ydGN1dHNbYWRkZWRLZXlzWzBdXSA9IHNob3J0Y3V0c1tyZW1vdmVkS2V5c1swXV07XG4gICAgICAgICAgZGVsZXRlIHNob3J0Y3V0c1tyZW1vdmVkS2V5c1swXV07XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZvciAoY29uc3Qga2V5IG9mIHJlbW92ZWRLZXlzKSBkZWxldGUgc2hvcnRjdXRzW2tleV07XG4gICAgICB9XG5cbiAgICAgIHN0b3JlLnNldEZyb250bWF0dGVyKGZyb250bWF0dGVyKTtcbiAgICAgIHN0b3JlLnNldEZsb2F0aW5nKGZsb2F0aW5nKTtcbiAgICAgIHN0b3JlLnNldFNob3J0Y3V0cyhzaG9ydGN1dHMpO1xuICAgICAgdmlldy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAvLyBLbm9wZi9DaGlwIGFuIGRpZSBuZXVlIFplaWxlbi0gdW5kIEtleS1MYWdlIGFucGFzc2VuIC0gZWluZSBnZXJhZGVcbiAgICAgIC8vIGJlbmFubnRlIFplaWxlIGJla29tbXQgc28gaWhyZW4gS25vcGYsIGVpbmUgZ2VsXHUwMEY2c2NodGUgbmltbXQgaWhyZW4gbWl0LlxuICAgICAgcmVuZGVyU2hvcnRjdXRDb250cm9scyh2aWV3LCBlZGl0b3IsIHN0b3JlKTtcbiAgICAgIC8vIERhbWl0IGRpZSBGZXR0LS9LdXJzaXYtTWFya2llcnVuZyBpbiBiZXJlaXRzIG9mZmVuZW4gTm90aXplbiBkaWVzZXNcbiAgICAgIC8vIFR5cHMgc29mb3J0IG1pdHppZWh0LCB3ZW5uIHNpY2ggaGllciBkaWUgUHJvcGVydHktTGlzdGUgXHUwMEU0bmRlcnQuXG4gICAgICB2aWV3LnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICB9LFxuICB9O1xuXG4gIGNvbnN0IGVkaXRvciA9IG5ldyBFZGl0b3JDbGFzcyhhcHAsIG93bmVyKTtcbiAgZWRpdG9yLmZyZWRQZW5kaW5nRmxvYXRpbmdBZGQgPSBmYWxzZTtcbiAgaWYgKG9uU2hpZnRGb2N1cykgcmVnaXN0ZXJGb2N1c0NoYWluKGVkaXRvciwgb25TaGlmdEZvY3VzKTtcbiAgLy8gR3Jlbnp0IGRpZSBTaG9ydGN1dC1SZWdlbG4gaW4gc3R5bGVzLmNzcyBhdWYgZGllc2VuIEVkaXRvciBlaW4uXG4gIGVkaXRvci5jb250YWluZXJFbC5hZGRDbGFzcyhFRElUT1JfQ0xBU1MpO1xuICBjb250YWluZXJFbC5hcHBlbmRDaGlsZChlZGl0b3IuY29udGFpbmVyRWwpO1xuICB2aWV3LmFkZENoaWxkKGVkaXRvcik7XG5cbiAgY29uc3QgZGVmYXVsdHMgPSBzdG9yZS5nZXRGcm9udG1hdHRlcigpO1xuICBjb25zdCBoYWRUeXAgPSBPYmplY3Qua2V5cyhkZWZhdWx0cykuc29tZSgoa2V5KSA9PiBTWVNURU1fUFJPUEVSVElFUy5pbmNsdWRlcyhrZXkudHJpbSgpLnRvTG93ZXJDYXNlKCkpKTtcbiAgc3RyaXBUeXBQcm9wZXJ0eShkZWZhdWx0cyk7XG4gIC8vIEVpbiBiZWltIExhZGVuIG5vY2ggdm9yaGFuZGVuZXMgVFlQICh6LiBCLiBhdXMgZWluZXIgXHUwMEU0bHRlcmVuIFBsdWdpbi1WZXJzaW9uKVxuICAvLyBkYXVlcmhhZnQgZW50ZmVybmVuLCBzdGF0dCBlcyBudXIgZlx1MDBGQ3IgZGllc2UgU2Vzc2lvbiB6dSB2ZXJzdGVja2VuLlxuICBpZiAoaGFkVHlwKSB2aWV3LnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgZWRpdG9yLnN5bmNocm9uaXplKGRlZmF1bHRzKTtcbiAgcmVuZGVyU2hvcnRjdXRDb250cm9scyh2aWV3LCBlZGl0b3IsIHN0b3JlKTtcbiAgLy8gRXJzdCBuYWNoIGRlbSBlcnN0ZW4gc3luY2hyb25pemUoKSB2ZXJzdWNodCAoc2llaGUgZ2V0UHJvcGVydHlSb3dDbGFzcykgLVxuICAvLyBiZWkgZWluZW0gbm9jaCBnYW56IGxlZXJlbiBUeXAgaGllciBlaW4gTm8tT3AsIGhvbHQgc2ljaCBhYmVyIHNwXHUwMEU0dGVzdGVuc1xuICAvLyBiZWltIG5cdTAwRTRjaHN0ZW4gTW91bnRlbiBlaW5lcyBuaWNodC1sZWVyZW4gVHlwcyAob2RlciBhdXMgZWluZXIgb2ZmZW5lblxuICAvLyBOb3RpeikgZGllIGJlblx1MDBGNnRpZ3RlIEtsYXNzZW5yZWZlcmVueiBhdXRvbWF0aXNjaCBuYWNoLlxuICBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaChhcHAsIGVkaXRvcik7XG4gIHJldHVybiBlZGl0b3I7XG59XG5cbmNvbnN0IENISVBfQ0xBU1MgPSBcImZyZWQtdHlwLXNob3J0Y3V0LWNoaXBcIjtcbmNvbnN0IENISVBfVEVYVF9DTEFTUyA9IFwiZnJlZC10eXAtc2hvcnRjdXQtY2hpcC10ZXh0XCI7XG5jb25zdCBCVVRUT05fQ0xBU1MgPSBcImZyZWQtdHlwLXNob3J0Y3V0LWJ1dHRvblwiO1xuY29uc3QgUk9XX0NMQVNTID0gXCJmcmVkLXR5cC1oYXMtc2hvcnRjdXRcIjtcbmNvbnN0IFdBUk5JTkdfQ0xBU1MgPSBcImZyZWQtdHlwLXNob3J0Y3V0LWJsb2NrZWRcIjtcblxuLy8gS25vcGYgdW5kIENoaXAgamUgUHJvcGVydHktWmVpbGUuIEJlaWRlIGhcdTAwRTRuZ2VuIGFtIGNvbnRhaW5lckVsIGRlciBaZWlsZSwgTklDSFRcbi8vIGFuIGRlcmVuIHZhbHVlRWw6IE9ic2lkaWFucyByZW5kZXJQcm9wZXJ0eSgpIGxlZXJ0IGJlaSBqZWRlbSBOZXUtUmVuZGVybiBudXJcbi8vIGRhcyB2YWx1ZUVsLCBkYXMgY29udGFpbmVyRWwgZGFnZWdlbiBuaWUgLSB3YXMgaGllciBlaW5tYWwgYW5nZWhcdTAwRTRuZ3Qgd3VyZGUsXG4vLyBcdTAwRkNiZXJsZWJ0IGFsc28gamVkZW4gVHlwLS9XZXJ0d2VjaHNlbCB2b24gc2VsYnN0LCBvaG5lIEVpbmdyaWZmIGluIE9ic2lkaWFuc1xuLy8gUmVuZGVyLVBpcGVsaW5lLlxuLy9cbi8vIERlciBLbm9wZiBpc3QgZWluIFVtc2NoYWx0ZXI6IGJlaSBlaW5lciBaZWlsZSBvaG5lIFNob3J0Y3V0IFx1MDBGNmZmbmV0IGVyIGRpZVxuLy8gQXVzd2FobCwgYmVpIGVpbmVyIFplaWxlIG1pdCBTaG9ydGN1dCBlbnRmZXJudCBlciBpaG4gd2llZGVyLiBadW0gV0VDSFNFTE5cbi8vIGRpZW50IGRlciBDaGlwIHNlbGJzdC4gU2ljaHRiYXIgd2lyZCBkZXIgS25vcGYgcGVyIENTUyBudXIgYmVpIEhvdmVyL0Zva3VzXG4vLyBkZXIgWmVpbGUgKHVuZCBkYXVlcmhhZnQsIHNvbGFuZ2UgZWluIFNob3J0Y3V0IGdlc2V0enQgaXN0KSAtIHNvbnN0IHN0XHUwMEZDbmRlIGluXG4vLyBqZWRlciBaZWlsZSBkYXVlcmhhZnQgZWluIEJlZGllbmVsZW1lbnQsIGRhcyBkaWUgbWVpc3RlbiBuaWUgYnJhdWNoZW4uXG4vL1xuLy8gRGFzIEF1c2JsZW5kZW4gZGVzIFdlcnRmZWxkcyBiZWkgZ2VzZXR6dGVtIFNob3J0Y3V0IG1hY2h0IGFsbGVpbiBDU1MgKHNpZWhlXG4vLyBST1dfQ0xBU1MgaW4gc3R5bGVzLmNzcykuIERhcyBuYXRpdmUgV2lkZ2V0IHJlbmRlcnQgZGFydW50ZXIgdW52ZXJcdTAwRTRuZGVydFxuLy8gd2VpdGVyIC0gU2V0emVuIHVuZCBFbnRmZXJuZW4gc2luZCBkZXNoYWxiIGVpbiByZWluZXIgS2xhc3Nlbi1VbXNjaGFsdGVyIHVuZFxuLy8gYnJhdWNoZW4ga2VpbiByZW5kZXJQcm9wZXJ0eSgpL3N5bmNocm9uaXplKCksIHdhcyBoaWVyIG9obmVoaW4gaGVpa2VsIHdcdTAwRTRyZVxuLy8gKHNpZWhlIEtvbW1lbnRhciBhbiBzdHJpcFR5cFByb3BlcnR5KS5cbmZ1bmN0aW9uIHJlbmRlclNob3J0Y3V0Q29udHJvbHModmlldywgZWRpdG9yLCBzdG9yZSkge1xuICBjb25zdCBzaG9ydGN1dHMgPSBzdG9yZS5nZXRTaG9ydGN1dHMoKTtcbiAgZm9yIChjb25zdCByb3cgb2YgZWRpdG9yLnJlbmRlcmVkID8/IFtdKSB7XG4gICAgY29uc3QgY29udGFpbmVyRWwgPSByb3cuY29udGFpbmVyRWw7XG4gICAgY29uc3Qga2V5ID0gcm93LmVudHJ5Py5rZXkgPz8gXCJcIjtcbiAgICAvLyBFaW5lIG5vY2ggbmFtZW5sb3NlIFplaWxlIGthbm4ga2VpbmVuIFNob3J0Y3V0IHRyYWdlbiAtIGVzIGdcdTAwRTRiZSBrZWluZW5cbiAgICAvLyBTY2hsXHUwMEZDc3NlbCwgdW50ZXIgZGVtIGVyIHN0XHUwMEZDbmRlLiBEZXIgS25vcGYgZXJzY2hlaW50LCBzb2JhbGQgZWluIE5hbWVcbiAgICAvLyBlaW5nZXRyYWdlbiBpc3QgKGplZGUgXHUwMEM0bmRlcnVuZyBsXHUwMEU0dWZ0IGR1cmNoIHNhdmVGcm9udG1hdHRlciB1bmQgZGFtaXRcbiAgICAvLyBlcm5ldXQgaGllciBkdXJjaCkuXG4gICAgY29uc3QgcmVjb3JkID0ga2V5ID09PSBcIlwiID8gbnVsbCA6IHNob3J0Y3V0c1trZXldID8/IG51bGw7XG4gICAgY29udGFpbmVyRWwudG9nZ2xlQ2xhc3MoUk9XX0NMQVNTLCAhIXJlY29yZCk7XG5cbiAgICAvLyBPYnNpZGlhbnMgV2FybmRyZWllY2sgc2l0enQgbmljaHQgaW0gRmxleC1GbHVzcyBkZXIgWmVpbGUsIHNvbmRlcm4gaXN0XG4gICAgLy8gYWJzb2x1dCBhbiBkZXJlbiByZWNodGVtIFJhbmQgdmVyYW5rZXJ0IChwb3NpdGlvbjogYWJzb2x1dGUsXG4gICAgLy8gaW5zZXQtaW5saW5lLWVuZC90b3AvYm90dG9tOiB2YXIoLS1zaXplLTItMSkpIC0gYWxzbyBnZW5hdSBkb3J0LCB3byBhdWNoXG4gICAgLy8gZGVyIFNob3J0Y3V0LUtub3BmIHNpdHp0LiBCZWlkZSBnbGVpY2h6ZWl0aWcgaGllXHUwMERGZTogXHUwMEZDYmVyZWluYW5kZXIuIFplaWd0XG4gICAgLy8gZGllIFplaWxlIGVpbmUgVHlwLVdhcm51bmcgdW5kIGlzdCBLRUlOIFNob3J0Y3V0IGdlc2V0enQsIHdlaWNodCBkZXJcbiAgICAvLyBLbm9wZi4gQmVpIGdlc2V0enRlbSBTaG9ydGN1dCBibGVpYnQgZXIgZGFnZWdlbiBzdGVoZW4gLSBlciBpc3QgZGVyXG4gICAgLy8gZWluemlnZSBXZWcsIGRlbiBTaG9ydGN1dCB3aWVkZXIgbG9zenV3ZXJkZW4gLSwgdW5kIHN0YXR0ZGVzc2VuIHdlaWNodFxuICAgIC8vIGRhcyBXYXJuZHJlaWVjayAoc2llaGUgc3R5bGVzLmNzcyk6IGVzIGJlemllaHQgc2ljaCBkYW5uIGF1ZiBkZW5cbiAgICAvLyBhdXNnZWJsZW5kZXRlbiBSXHUwMEZDY2tmYWxsd2VydCwgaXN0IGRvcnQgYWxzbyBnYXIgbmljaHQgenUgYmVoZWJlbi5cbiAgICBjb25zdCBtaXNtYXRjaCA9ICEhcm93LnR5cGVJbmZvICYmIHJvdy50eXBlSW5mby5leHBlY3RlZCAhPT0gcm93LnR5cGVJbmZvLmluZmVycmVkO1xuICAgIGNvbnRhaW5lckVsLnRvZ2dsZUNsYXNzKFdBUk5JTkdfQ0xBU1MsIG1pc21hdGNoICYmICFyZWNvcmQpO1xuXG4gICAgbGV0IGJ1dHRvbkVsID0gY29udGFpbmVyRWwucXVlcnlTZWxlY3RvcihgOnNjb3BlID4gLiR7QlVUVE9OX0NMQVNTfWApO1xuICAgIGlmIChrZXkgPT09IFwiXCIpIHtcbiAgICAgIGJ1dHRvbkVsPy5yZW1vdmUoKTtcbiAgICAgIGNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3IoYDpzY29wZSA+IC4ke0NISVBfQ0xBU1N9YCk/LnJlbW92ZSgpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICghYnV0dG9uRWwpIHtcbiAgICAgIGJ1dHRvbkVsID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBgY2xpY2thYmxlLWljb24gJHtCVVRUT05fQ0xBU1N9YCB9KTtcbiAgICAgIHNldEljb24oYnV0dG9uRWwsIFwic3F1YXJlLWZ1bmN0aW9uXCIpO1xuICAgICAgLy8gRGVuIEtleSBlcnN0IGJlaW0gS2xpY2sgYXVzIGRlciBaZWlsZSBsZXNlbiwgbmljaHQgaGllciBlaW5mYW5nZW4gLVxuICAgICAgLy8gZWluZSBVbWJlbmVubnVuZyBcdTAwRTRuZGVydCByb3cuZW50cnkua2V5LCBvaG5lIGRpZSBaZWlsZSBuZXUgYW56dWxlZ2VuLlxuICAgICAgYnV0dG9uRWwuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgICAgaWYgKHN0b3JlLmdldFNob3J0Y3V0cygpW3Jvdy5lbnRyeT8ua2V5ID8/IFwiXCJdKSByZW1vdmVTaG9ydGN1dCh2aWV3LCBlZGl0b3IsIHN0b3JlLCByb3cpO1xuICAgICAgICBlbHNlIG9wZW5TaG9ydGN1dFBpY2tlcih2aWV3LCBlZGl0b3IsIHN0b3JlLCByb3cpO1xuICAgICAgfSk7XG4gICAgfVxuICAgIGJ1dHRvbkVsLnNldEF0dHIoXCJhcmlhLWxhYmVsXCIsIHJlY29yZCA/IFwiU2hvcnRjdXQgZW50ZmVybmVuXCIgOiBcIlNob3J0Y3V0IHNldHplblwiKTtcblxuICAgIGxldCBjaGlwRWwgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKGA6c2NvcGUgPiAuJHtDSElQX0NMQVNTfWApO1xuICAgIGlmICghcmVjb3JkKSB7XG4gICAgICBjaGlwRWw/LnJlbW92ZSgpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmICghY2hpcEVsKSB7XG4gICAgICBjaGlwRWwgPSBjcmVhdGVFbChcImNvZGVcIiwgeyBjbHM6IENISVBfQ0xBU1MgfSk7XG4gICAgICAvLyBEZXIgVGV4dCBzdGVja3QgaW4gZWluZW0gZWlnZW5lbiBTcGFuLCB3ZWlsIGRlciBDaGlwIHNlbGJzdCBlaW5cbiAgICAgIC8vIEZsZXgtQ29udGFpbmVyIGlzdCAodmVydGlrYWxlIFplbnRyaWVydW5nIHdpZSBiZWltIGVjaHRlbiBXZXJ0ZmVsZCkgLVxuICAgICAgLy8gdGV4dC1vdmVyZmxvdzogZWxsaXBzaXMgZ3JlaWZ0IGFiZXIgbnVyIGF1ZiBlaW5lbSBCbG9jay1FbGVtZW50LCBuaWNodFxuICAgICAgLy8gYXVmIGRlbSBGbGV4LUNvbnRhaW5lciBkYXJcdTAwRkNiZXIuXG4gICAgICBjaGlwRWwuY3JlYXRlU3Bhbih7IGNsczogQ0hJUF9URVhUX0NMQVNTIH0pO1xuICAgICAgY2hpcEVsLnNldEF0dHIoXCJhcmlhLWxhYmVsXCIsIFwiU2hvcnRjdXQgXHUwMEU0bmRlcm5cIik7XG4gICAgICBjaGlwRWwuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IG9wZW5TaG9ydGN1dFBpY2tlcih2aWV3LCBlZGl0b3IsIHN0b3JlLCByb3cpKTtcbiAgICAgIC8vIFZvciBkZW0gS25vcGYgZWluaFx1MDBFNG5nZW4sIGRhbWl0IGRpZSBaZWlsZSB1bmFiaFx1MDBFNG5naWcgdm9uIGRlclxuICAgICAgLy8gRW50c3RlaHVuZ3NyZWloZW5mb2xnZSBpbW1lciBcIk5hbWUgfCBDaGlwIHwgS25vcGZcIiBsaWVzdC5cbiAgICAgIGNvbnRhaW5lckVsLmluc2VydEJlZm9yZShjaGlwRWwsIGJ1dHRvbkVsKTtcbiAgICB9XG4gICAgY2hpcEVsLmZpcnN0RWxlbWVudENoaWxkLnNldFRleHQoc2hvcnRjdXRMYWJlbChyZWNvcmQpKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBvcGVuU2hvcnRjdXRQaWNrZXIodmlldywgZWRpdG9yLCBzdG9yZSwgcm93KSB7XG4gIGNvbnN0IGtleSA9IHJvdy5lbnRyeT8ua2V5ID8/IFwiXCI7XG4gIGlmIChrZXkgPT09IFwiXCIpIHJldHVybjtcbiAgLy8gRGVuIGJpc2hlcmlnZW4gUmVjb3JkIG1pdGdlYmVuOiB3aXJkIGRhc3NlbGJlIFNrcmlwdCBlcm5ldXQgZ2V3XHUwMEU0aGx0LCBrb21tdFxuICAvLyBkZXIgQXJndW1lbnQtRGlhbG9nIG1pdCBkZW4gYWt0dWVsbGVuIFdlcnRlbiB2b3JiZWxlZ3QgLSBzbyBpc3QgZGVyIEtsaWNrXG4gIC8vIGF1ZiBkZW4gQ2hpcCBhdWNoIGRlciBXZWcsIGVpbnplbG5lIEFyZ3VtZW50ZSB6dSBrb3JyaWdpZXJlbi5cbiAgY29uc3QgcmVjb3JkID0gYXdhaXQgcGlja1Nob3J0Y3V0KHZpZXcuYXBwLCBrZXksIHZpZXcucGx1Z2luLmdldFNob3J0Y3V0U2NyaXB0cywgc3RvcmUuZ2V0U2hvcnRjdXRzKClba2V5XSA/PyBudWxsKTtcbiAgaWYgKCFyZWNvcmQpIHJldHVybjtcbiAgLy8gV1x1MDBFNGhyZW5kIGRlciBEaWFsb2cgb2ZmZW4gd2FyLCBrYW5uIGRpZSBQcm9wZXJ0eSB2ZXJzY2h3dW5kZW4gc2VpbiAoZXR3YVxuICAvLyB3ZWlsIGRpZSBBbnNpY2h0IHp3aXNjaGVuemVpdGxpY2ggbmV1IGF1ZmdlYmF1dCB3dXJkZSkuIE9obmUgZGllc2UgUHJcdTAwRkNmdW5nXG4gIC8vIGJsaWViZSBkZXIgU2hvcnRjdXQgYWxzIFdhaXNlIGluIGRlbiBFaW5zdGVsbHVuZ2VuIHN0ZWhlbjogc2F2ZUZyb250bWF0dGVyXG4gIC8vIHppZWh0IG51ciBLZXlzIG5hY2gsIGRpZSBpbiBkZXJzZWxiZW4gQmVhcmJlaXR1bmcgZW50ZmVybnQgd3VyZGVuLCB1bmRcbiAgLy8gY29sbGVjdEJsb2NrcyBsXHUwMEU0dWZ0IG9obmVoaW4gbnVyIFx1MDBGQ2JlciB2b3JoYW5kZW5lIEZyb250bWF0dGVyLUtleXMgLSBkZXJcbiAgLy8gRWludHJhZyB3XHUwMEU0cmUgYWxzbyB1bnNpY2h0YmFyIHVuZCB3XHUwMEZDcmRlIG5pZSB3aWVkZXIgYXVmZ2VyXHUwMEU0dW10LlxuICBpZiAoIU9iamVjdC5oYXNPd24oc3RvcmUuZ2V0RnJvbnRtYXR0ZXIoKSwga2V5KSkgcmV0dXJuO1xuICBzdG9yZS5zZXRTaG9ydGN1dHMoeyAuLi5zdG9yZS5nZXRTaG9ydGN1dHMoKSwgW2tleV06IHJlY29yZCB9KTtcbiAgc2F2ZVNob3J0Y3V0cyh2aWV3LCBlZGl0b3IsIHN0b3JlKTtcbn1cblxuZnVuY3Rpb24gcmVtb3ZlU2hvcnRjdXQodmlldywgZWRpdG9yLCBzdG9yZSwgcm93KSB7XG4gIGNvbnN0IGtleSA9IHJvdy5lbnRyeT8ua2V5ID8/IFwiXCI7XG4gIGNvbnN0IHNob3J0Y3V0cyA9IHsgLi4uc3RvcmUuZ2V0U2hvcnRjdXRzKCkgfTtcbiAgaWYgKCEoa2V5IGluIHNob3J0Y3V0cykpIHJldHVybjtcbiAgZGVsZXRlIHNob3J0Y3V0c1trZXldO1xuICBzdG9yZS5zZXRTaG9ydGN1dHMoc2hvcnRjdXRzKTtcbiAgc2F2ZVNob3J0Y3V0cyh2aWV3LCBlZGl0b3IsIHN0b3JlKTtcbn1cblxuZnVuY3Rpb24gc2F2ZVNob3J0Y3V0cyh2aWV3LCBlZGl0b3IsIHN0b3JlKSB7XG4gIHZpZXcucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICByZW5kZXJTaG9ydGN1dENvbnRyb2xzKHZpZXcsIGVkaXRvciwgc3RvcmUpO1xufVxuXG4vLyBFaWdlbmUsIGVpbmZhY2hlIFwiUHJvcGVydHkgaGluenVmXHUwMEZDZ2VuXCItRnVua3Rpb24gc3RhdHQgZGVzIGludGVybmVuXG4vLyBlZGl0b3IuYWRkUHJvcGVydHkoKTogZlx1MDBGQ2d0IGVpbmVuIGxlZXJlbiBLZXkgbWl0IFdlcnQgbnVsbCBhbiB1bmQgbFx1MDBFNHNzdCBkYXNcbi8vIFdpZGdldCBkaWUgWmVpbGUgZ2FueiBub3JtYWwgcmVuZGVybiAoZGllc2VsYmUgT3B0aWsgd2llIGluIGVpbmVyIGVjaHRlblxuLy8gTm90aXosIGRhIHN5bmNocm9uaXplKCkgdW52ZXJcdTAwRTRuZGVydCBPYnNpZGlhbnMgZWlnZW5lIFJlbmRlci1QaXBlbGluZVxuLy8gZHVyY2hsXHUwMEU0dWZ0KSAtIGRlciBGb2t1cyBzcHJpbmd0IGFuc2NobGllXHUwMERGZW5kIGlucyBLZXktRmVsZCBkZXIgbmV1ZW4gWmVpbGUuXG5mdW5jdGlvbiBhZGRCbGFua1Byb3BlcnR5KGVkaXRvcikge1xuICBpZiAoIWVkaXRvcikgcmV0dXJuO1xuICBjb25zdCBjdXJyZW50ID0gZWRpdG9yLnNlcmlhbGl6ZSgpO1xuICBpZiAoIWN1cnJlbnQuaGFzT3duUHJvcGVydHkoXCJcIikpIHtcbiAgICBjdXJyZW50W1wiXCJdID0gbnVsbDtcbiAgICBlZGl0b3Iuc3luY2hyb25pemUoY3VycmVudCk7XG4gICAgLy8gc3luY2hyb25pemUoKSBsZWd0IGRpZSBuZXVlIFplaWxlIGFuIC0gZGllIGJlc3RlaGVuZGVuIFplaWxlbiBiZWhhbHRlblxuICAgIC8vIGRhYmVpIHp3YXIgaWhyZW4gS25vcGYgKGVyIGhcdTAwRTRuZ3QgYW0gY29udGFpbmVyRWwsIHNpZWhlXG4gICAgLy8gcmVuZGVyU2hvcnRjdXRDb250cm9scyksIGRpZSBuZXVlIGhhdCBhYmVyIG5vY2gga2VpbmVuLlxuICAgIHJlbmRlclNob3J0Y3V0Q29udHJvbHMoZWRpdG9yLm93bmVyLmZyZWRWaWV3LCBlZGl0b3IsIGVkaXRvci5vd25lci5mcmVkU3RvcmUpO1xuICB9XG4gIGVkaXRvci5mb2N1c0tleShcIlwiKTtcbiAgLy8gRGVja3QgZGVuIEZhbGwgYWIsIGRhc3MgbW91bnRGcm9udG1hdHRlckVkaXRvcigpIGJlaSBlaW5lbSB6dSBkaWVzZW1cbiAgLy8gWmVpdHB1bmt0IG5vY2ggZ2FueiBsZWVyZW4gVHlwICh1bmQgb2huZSBvZmZlbmUgTm90aXopIGtlaW5lIFplaWxlbi1LbGFzc2VcbiAgLy8genVtIFBhdGNoZW4gZmluZGVuIGtvbm50ZSAtIGpldHp0IGV4aXN0aWVydCBtaXQgZGVyIGdlcmFkZSBhbmdlbGVndGVuXG4gIC8vIFplaWxlIGdhcmFudGllcnQgbWluZGVzdGVucyBlaW5lLlxuICBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaChlZGl0b3Iub3duZXIuYXBwLCBlZGl0b3IpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgbW91bnRGcm9udG1hdHRlckVkaXRvciwgYWRkQmxhbmtQcm9wZXJ0eSwgZW5zdXJlUHJvcGVydHlNZW51UGF0Y2gsIHR5cGVTdG9yZSwgc3VidHlwZVN0b3JlIH07XG4iLCAiY29uc3QgeyBtb3VudEZyb250bWF0dGVyRWRpdG9yLCBhZGRCbGFua1Byb3BlcnR5LCB0eXBlU3RvcmUsIHN1YnR5cGVTdG9yZSB9ID0gcmVxdWlyZShcIi4vdHlwZS1mcm9udG1hdHRlci1lZGl0b3JcIik7XHJcbmNvbnN0IHsgZ2V0U2VjdGlvbk9yZGVyLCBpc0VtcHR5VmFsdWUgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cGVzXCIpO1xyXG5cclxuLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbiAqIERpZSBGcm9udG1hdHRlci1CbFx1MDBGNmNrZSBlaW5lcyBUWVBzIGluIGRlciBUWVAtRGV0YWlsYW5zaWNodCAoc2llaGVcclxuICogcmVuZGVyVHlwZVNldHRpbmdzIGluIHR5cC12aWV3LmpzKTogenVvYmVyc3QgZGFzIFRZUC1Gcm9udG1hdHRlciwgZGFydW50ZXJcclxuICogamUgcmVnaXN0cmllcnRlbSBTdWJ0eXAgZWluIGVpZ2VuZXIgQmxvY2suXHJcbiAqXHJcbiAqIEplIEJsb2NrIGVpbmUgZWlnZW5lIEluc3Rhbnogdm9uIE9ic2lkaWFucyBQcm9wZXJ0eS1FZGl0b3IsIGdlYnVuZGVuIGFuXHJcbiAqIHR5cGVTdG9yZSBiencuIHN1YnR5cGVTdG9yZSAoc2llaGUgdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpLiBEYWR1cmNoXHJcbiAqIGRhcmYgZGVyc2VsYmUgS2V5IGluIG1laHJlcmVuIEJsXHUwMEY2Y2tlbiBzdGVoZW4gLSBpbm5lcmhhbGIgZWluZXMgQmxvY2tzIGlzdFxyXG4gKiBlciBkdXJjaCBkYXMgRnJvbnRtYXR0ZXItT2JqZWt0IHNlbGJzdCB6d2FuZ3NsXHUwMEU0dWZpZyBlaW5kZXV0aWcsIGRhclx1MDBGQ2JlclxyXG4gKiBoaW5hdXMgbmljaHQgKHNpZWhlIEtvbW1lbnRhciBhbiB0eXBlU3VidHlwZXMgaW4gc3VidHlwZXMuanMpLlxyXG4gKlxyXG4gKiBPYnNpZGlhbnMgZWlnZW5lcyBaZWlsZW4tRHJhZyByZWljaHQgbnVyIGlubmVyaGFsYiBlaW5lciBJbnN0YW56LiBEYW1pdFxyXG4gKiBlaW5lIFByb3BlcnR5IHRyb3R6ZGVtIHZvbiBCbG9jayB6dSBCbG9jayB3YW5kZXJuIGthbm4sIHNldHp0XHJcbiAqIHJlZ2lzdGVyUHJvcGVydHlEcmFnKCkgdW50ZW4gYXVmIGdlbmF1IGRpZXNlbSBEcmFnIGF1Ziwgc3RhdHQgZWluIGVpZ2VuZXNcclxuICogenUgYmF1ZW4uIERpZSBUYXN0YXR1ci1OYXZpZ2F0aW9uIFx1MDBGQ2JlciBhbGxlIEJsXHUwMEY2Y2tlIHN0ZWNrdCBpblxyXG4gKiByZWdpc3RlckZvY3VzQ2hhaW4oKSAodHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpLlxyXG4gKlxyXG4gKiBTZWN0aW9uOiBudWxsID0gVFlQLUZyb250bWF0dGVyLCBzb25zdCBkZXIgU3VidHlwLU5hbWUuXHJcbiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqL1xyXG5cclxuLy8gQW5mYXNzYmFyIGZcdTAwRkNyIGRhcyBWZXJzY2hpZWJlbiBlaW5lcyBnYW56ZW4gQmxvY2tzIGlzdCBhbGxlcyBhdVx1MDBERmVyaGFsYiBkZXJcclxuLy8gUHJvcGVydHktWmVpbGVuIC0gXHUwMERDYmVyc2NocmlmdCwgQWJzY2hsdXNzIHVuZCBkaWUgc2VpdGxpY2hlbiBSXHUwMEU0bmRlci5cclxuLy8gQmVkaWVuZWxlbWVudGUgdW5kIGVpbiBnZXJhZGUgYmVhcmJlaXRldGVyIFRpdGVsIGJsZWliZW4gYXVzZ2Vub21tZW4uXHJcbmZ1bmN0aW9uIGlzR3JhYlRhcmdldCh0YXJnZXQpIHtcclxuICBpZiAodGFyZ2V0LmNsb3Nlc3QoXCIuY2xpY2thYmxlLWljb24sIC5mcmVkLXR5cC1zdWJ0eXBlLWNvbG9yLWRvdCwgW2NvbnRlbnRlZGl0YWJsZT0ndHJ1ZSddLCBpbnB1dCwgdGV4dGFyZWFcIikpIHJldHVybiBmYWxzZTtcclxuICByZXR1cm4gIXRhcmdldC5jbG9zZXN0KFwiLm1ldGFkYXRhLXByb3BlcnR5XCIpO1xyXG59XHJcblxyXG4vLyByZW5kZXJIZWFkZXIoc2VjdGlvbiwgZWwsIGJsb2NrcykgLyByZW5kZXJGb290ZXIoc2VjdGlvbiwgZWwsIGJsb2NrcykgZlx1MDBGQ2xsZW5cclxuLy8gXHUwMERDYmVyc2NocmlmdCBiencuIEFic2NobHVzcyBlaW5lcyBCbG9ja3MuIG9uTW92ZVNlY3Rpb24ob3JkZXIpIG1lbGRldCBkaWVcclxuLy8gbmV1ZSBCbG9jay1SZWloZW5mb2xnZSBuYWNoIGVpbmVtIEJsb2NrLURyYWcgKHdpZSBnZXRTZWN0aW9uT3JkZXIsIHNhbXRcclxuLy8gZlx1MDBGQ2hyZW5kZW0gbnVsbCBmXHUwMEZDciBkYXMgVFlQLUZyb250bWF0dGVyKS5cclxuZnVuY3Rpb24gbW91bnRGcm9udG1hdHRlckJsb2Nrcyh2aWV3LCBjb250YWluZXJFbCwgdHlwZSwgeyByZW5kZXJIZWFkZXIsIHJlbmRlckZvb3Rlciwgb25Nb3ZlU2VjdGlvbiB9KSB7XHJcbiAgY29uc3Qgd3JhcHBlciA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1ibG9ja3NcIiB9KTtcclxuICBjb25zdCBzZWN0aW9ucyA9IGdldFNlY3Rpb25PcmRlcih2aWV3LnBsdWdpbi5zZXR0aW5ncywgdHlwZSk7XHJcbiAgY29uc3QgZWRpdG9ycyA9IG5ldyBNYXAoKTtcclxuICBjb25zdCBibG9ja0VscyA9IG5ldyBNYXAoKTtcclxuICBjb25zdCBzdG9yZXMgPSBuZXcgTWFwKCk7XHJcblxyXG4gIGNvbnN0IGFwaSA9IHtcclxuICAgIC8vIEFsbGUgRWRpdG9yLUluc3RhbnplbiBpbiBCbG9jay1SZWloZW5mb2xnZSAtIHR5cC12aWV3LmpzIGhcdTAwRTRuZ3Qgc2llIGFsc1xyXG4gICAgLy8gQ29tcG9uZW50LUNoaWxkcmVuIGVpbiB1bmQgYmF1dCBzaWUgdm9yIGplZGVtIE5ldWF1ZmJhdSB3aWVkZXIgYWIuXHJcbiAgICBlZGl0b3JzOiBbXSxcclxuICAgIC8vIExlZXJ6ZWlsZSBhbSBFbmRlIGRlcyBnZXdcdTAwRkNuc2NodGVuIEJsb2NrcyBhbmxlZ2VuLCBtaXQgZGVtIEZva3VzIGltXHJcbiAgICAvLyBLZXktRmVsZCAoc2llaGUgYWRkQmxhbmtQcm9wZXJ0eSBpbiB0eXBlLWZyb250bWF0dGVyLWVkaXRvci5qcykuXHJcbiAgICAvLyBmbG9hdGluZyBtYXJraWVydCBkaWUgYWxzIG5cdTAwRTRjaHN0ZXMgYmVuYW5udGUgUHJvcGVydHkgYWxzIEZsb2F0aW5nLlxyXG4gICAgYWRkQmxhbmsoc2VjdGlvbiwgZmxvYXRpbmcgPSBmYWxzZSkge1xyXG4gICAgICBjb25zdCBlZGl0b3IgPSBlZGl0b3JzLmdldChzZWN0aW9uKTtcclxuICAgICAgaWYgKCFlZGl0b3IpIHJldHVybjtcclxuICAgICAgZWRpdG9yLmZyZWRQZW5kaW5nRmxvYXRpbmdBZGQgPSBmbG9hdGluZztcclxuICAgICAgYWRkQmxhbmtQcm9wZXJ0eShlZGl0b3IpO1xyXG4gICAgfSxcclxuICB9O1xyXG5cclxuICAvLyBOYWNoYmFyYmxvY2sgaW4gUmljaHR1bmcgc3RlcCwgZGVyIFx1MDBGQ2JlcmhhdXB0IGVpbmUgWmVpbGUgenVtIEFuc3ByaW5nZW5cclxuICAvLyBoYXQgLSBsZWVyZSBCbFx1MDBGNmNrZSB3ZXJkZW4gXHUwMEZDYmVyc3BydW5nZW4uXHJcbiAgY29uc3QgZm9jdXNOZWlnaGJvciA9IChzZWN0aW9uLCBzdGVwKSA9PiB7XHJcbiAgICBmb3IgKGxldCBpID0gc2VjdGlvbnMuaW5kZXhPZihzZWN0aW9uKSArIHN0ZXA7IGkgPj0gMCAmJiBpIDwgc2VjdGlvbnMubGVuZ3RoOyBpICs9IHN0ZXApIHtcclxuICAgICAgY29uc3QgZWRpdG9yID0gZWRpdG9ycy5nZXQoc2VjdGlvbnNbaV0pO1xyXG4gICAgICBpZiAoIWVkaXRvciB8fCBlZGl0b3IucmVuZGVyZWQubGVuZ3RoID09PSAwKSBjb250aW51ZTtcclxuICAgICAgZWRpdG9yLmZvY3VzUHJvcGVydHlBdEluZGV4KHN0ZXAgPiAwID8gMCA6IC0xKTtcclxuICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbiAgfTtcclxuXHJcbiAgZm9yIChjb25zdCBzZWN0aW9uIG9mIHNlY3Rpb25zKSB7XHJcbiAgICBjb25zdCBpc1N1YiA9IHNlY3Rpb24gIT09IG51bGw7XHJcbiAgICBjb25zdCBibG9ja0VsID0gd3JhcHBlci5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwiZnJlZC10eXAtYmxvY2tcIiArIChpc1N1YiA/IFwiIGZyZWQtdHlwLWZyb250bWF0dGVyLWJsb2NrIGZyZWQtdHlwLXN1YnR5cGUtYmxvY2tcIiA6IFwiXCIpLFxyXG4gICAgfSk7XHJcbiAgICBibG9ja0Vscy5zZXQoc2VjdGlvbiwgYmxvY2tFbCk7XHJcbiAgICBibG9ja0VsLmZyZWRTZWN0aW9uID0gc2VjdGlvbjtcclxuXHJcbiAgICBjb25zdCBoZWFkZXIgPSBibG9ja0VsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1mcm9udG1hdHRlci1oZWFkZXIgZnJlZC10eXAtc2VjdGlvbi1oZWFkZXJcIiB9KTtcclxuICAgIGhlYWRlci50b2dnbGVDbGFzcyhcImZyZWQtdHlwLXNlY3Rpb24tc3ViXCIsIGlzU3ViKTtcclxuXHJcbiAgICBjb25zdCBzdG9yZSA9IHNlY3Rpb24gPT09IG51bGwgPyB0eXBlU3RvcmUodmlldy5wbHVnaW4sIHR5cGUpIDogc3VidHlwZVN0b3JlKHZpZXcucGx1Z2luLCB0eXBlLCBzZWN0aW9uKTtcclxuICAgIHN0b3Jlcy5zZXQoc2VjdGlvbiwgc3RvcmUpO1xyXG4gICAgY29uc3QgZWRpdG9yID0gbW91bnRGcm9udG1hdHRlckVkaXRvcih2aWV3LCBibG9ja0VsLCBzdG9yZSwge1xyXG4gICAgICBvblNoaWZ0Rm9jdXM6IChzdGVwKSA9PiBmb2N1c05laWdoYm9yKHNlY3Rpb24sIHN0ZXApLFxyXG4gICAgfSk7XHJcbiAgICBpZiAoZWRpdG9yKSB7XHJcbiAgICAgIGVkaXRvcnMuc2V0KHNlY3Rpb24sIGVkaXRvcik7XHJcbiAgICAgIGFwaS5lZGl0b3JzLnB1c2goZWRpdG9yKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBmb290ZXIgPSBibG9ja0VsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1zZWN0aW9uLWZvb3RlclwiIH0pO1xyXG4gICAgZm9vdGVyLnRvZ2dsZUNsYXNzKFwiZnJlZC10eXAtc2VjdGlvbi1zdWJcIiwgaXNTdWIpO1xyXG4gICAgcmVuZGVySGVhZGVyKHNlY3Rpb24sIGhlYWRlciwgYXBpKTtcclxuICAgIHJlbmRlckZvb3Rlcj8uKHNlY3Rpb24sIGZvb3RlciwgYXBpKTtcclxuXHJcbiAgICBpZiAoIWlzU3ViKSBjb250aW51ZTtcclxuICAgIC8vIEhpZXIgbGFnIGZyXHUwMEZDaGVyIGVpbiBjb250ZXh0bWVudS1IYW5kbGVyLCBkZXIgYXVmIGRlciBnYW56ZW4gQmxvY2tmbFx1MDBFNGNoZVxyXG4gICAgLy8gZGllIFN1Y2hlIFx1MDBGNmZmbmV0ZS4gRGllIGhcdTAwRTRuZ3QgamV0enQgYW0gS2xpY2sgYXVmIGRlbiBCbG9jay1OYW1lbiAoc2llaGVcclxuICAgIC8vIG1ha2VTZWFyY2hhYmxlIGluIHR5cC12aWV3LmpzKSwgd29taXQgZGVyIFJlY2h0c2tsaWNrIGltIEJsb2NrIHdpZWRlclxyXG4gICAgLy8gT2JzaWRpYW5zIGVpZ2VuZW4gTWVuXHUwMEZDcyBnZWhcdTAwRjZydC5cclxuICAgIGJsb2NrRWwuYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlZG93blwiLCAoZXZlbnQpID0+IHN0YXJ0QmxvY2tEcmFnKGV2ZW50LCBzZWN0aW9uKSk7XHJcbiAgfVxyXG5cclxuICAvLyBFaWdlbmVzIE1hdXMtRHJhZyBzdGF0dCBIVE1MNS1kcmFnZ2FibGU6IGVpbiBkcmFnZ2FibGUtVm9yZmFocmUgc3RcdTAwRjZydGUgZGllXHJcbiAgLy8gVGV4dGF1c3dhaGwgaW4gZGVuIEVpbmdhYmVmZWxkZXJuIGRlciBaZWlsZW4uIERlciBEcmFnIGJlZ2lubnQgZXJzdCBuYWNoXHJcbiAgLy8gZWluIHBhYXIgUGl4ZWxuIEJld2VndW5nLCBlaW4gU3RyaWNoIGluIEFremVudGZhcmJlIHplaWd0IGRpZVxyXG4gIC8vIFppZWxwb3NpdGlvbiB6d2lzY2hlbiBkZW4gQmxcdTAwRjZja2VuLCBFc2NhcGUgYnJpY2h0IGFiLiBEYXMgVFlQLUZyb250bWF0dGVyXHJcbiAgLy8gc3RlaHQgZmVzdCBnYW56IG9iZW4gKHNpZWhlIGdldFNlY3Rpb25PcmRlciBpbiBzdWJ0eXBlcy5qcykgLSBaaWVscG9zaXRpb25cclxuICAvLyAwIGdpYnQgZXMgZGVzaGFsYiBuaWNodCwgZGVyIG9iZXJzdGUgbVx1MDBGNmdsaWNoZSBQbGF0eiBpc3QgZGlyZWt0IGRhcnVudGVyLlxyXG4gIGZ1bmN0aW9uIHN0YXJ0QmxvY2tEcmFnKGV2ZW50LCBzZWN0aW9uKSB7XHJcbiAgICBpZiAoZXZlbnQuYnV0dG9uICE9PSAwIHx8ICFpc0dyYWJUYXJnZXQoZXZlbnQudGFyZ2V0KSkgcmV0dXJuO1xyXG4gICAgY29uc3Qgd2luID0gd3JhcHBlci53aW47XHJcbiAgICBjb25zdCBzdGFydFkgPSBldmVudC5jbGllbnRZO1xyXG4gICAgbGV0IGRyYWdnaW5nID0gZmFsc2U7XHJcbiAgICBsZXQgaW5kaWNhdG9yID0gbnVsbDtcclxuICAgIGxldCBib3hlcyA9IFtdO1xyXG4gICAgbGV0IHRhcmdldEluZGV4ID0gbnVsbDtcclxuXHJcbiAgICBjb25zdCBtZWFzdXJlID0gKCkgPT4ge1xyXG4gICAgICBjb25zdCBiYXNlID0gd3JhcHBlci5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcclxuICAgICAgYm94ZXMgPSBzZWN0aW9ucy5tYXAoKG5hbWUpID0+IHtcclxuICAgICAgICBjb25zdCByZWN0ID0gYmxvY2tFbHMuZ2V0KG5hbWUpLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xyXG4gICAgICAgIHJldHVybiB7IHNlY3Rpb246IG5hbWUsIHRvcDogcmVjdC50b3AgLSBiYXNlLnRvcCwgYm90dG9tOiByZWN0LmJvdHRvbSAtIGJhc2UudG9wIH07XHJcbiAgICAgIH0pO1xyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBvbk1vdmUgPSAobW92ZUV2ZW50KSA9PiB7XHJcbiAgICAgIGlmICghZHJhZ2dpbmcpIHtcclxuICAgICAgICBpZiAoTWF0aC5hYnMobW92ZUV2ZW50LmNsaWVudFkgLSBzdGFydFkpIDwgNCkgcmV0dXJuO1xyXG4gICAgICAgIGRyYWdnaW5nID0gdHJ1ZTtcclxuICAgICAgICB3cmFwcGVyLmRvYy5ib2R5LmFkZENsYXNzKFwiZnJlZC10eXAtYmxvY2stZHJhZ2dpbmdcIik7XHJcbiAgICAgICAgd2luLmdldFNlbGVjdGlvbigpPy5yZW1vdmVBbGxSYW5nZXMoKTtcclxuICAgICAgICBibG9ja0Vscy5nZXQoc2VjdGlvbikuYWRkQ2xhc3MoXCJpcy1kcmFnZ2luZ1wiKTtcclxuICAgICAgICBtZWFzdXJlKCk7XHJcbiAgICAgICAgaW5kaWNhdG9yID0gd3JhcHBlci5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtYmxvY2stZHJvcC1pbmRpY2F0b3JcIiB9KTtcclxuICAgICAgfVxyXG4gICAgICBtb3ZlRXZlbnQucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgY29uc3QgeSA9IG1vdmVFdmVudC5jbGllbnRZIC0gd3JhcHBlci5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKS50b3A7XHJcbiAgICAgIHRhcmdldEluZGV4ID0gTWF0aC5tYXgoMSwgYm94ZXMuZmlsdGVyKChib3gpID0+IChib3gudG9wICsgYm94LmJvdHRvbSkgLyAyIDwgeSkubGVuZ3RoKTtcclxuICAgICAgY29uc3QgZnJvbSA9IGJveGVzLmZpbmRJbmRleCgoYm94KSA9PiBib3guc2VjdGlvbiA9PT0gc2VjdGlvbik7XHJcbiAgICAgIGluZGljYXRvci50b2dnbGUodGFyZ2V0SW5kZXggIT09IGZyb20gJiYgdGFyZ2V0SW5kZXggIT09IGZyb20gKyAxKTtcclxuICAgICAgLy8gTWl0dGUgZGVyIExcdTAwRkNja2Ugendpc2NoZW4gendlaSBCbFx1MDBGNmNrZW4gKEFic3RhbmQgc2llaGVcclxuICAgICAgLy8gLmZyZWQtdHlwLWJsb2NrICsgLmZyZWQtdHlwLWJsb2NrIGluIHN0eWxlcy5jc3MpLlxyXG4gICAgICBjb25zdCBoYWxmR2FwID0gNjtcclxuICAgICAgY29uc3QgZ2FwWSA9XHJcbiAgICAgICAgdGFyZ2V0SW5kZXggPT09IGJveGVzLmxlbmd0aFxyXG4gICAgICAgICAgPyBib3hlc1tib3hlcy5sZW5ndGggLSAxXS5ib3R0b20gKyBoYWxmR2FwXHJcbiAgICAgICAgICA6IChib3hlc1t0YXJnZXRJbmRleCAtIDFdLmJvdHRvbSArIGJveGVzW3RhcmdldEluZGV4XS50b3ApIC8gMjtcclxuICAgICAgaW5kaWNhdG9yLnN0eWxlLnRvcCA9IGAke2dhcFkgLSAxfXB4YDtcclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgZW5kID0gKGNvbW1pdCkgPT4ge1xyXG4gICAgICB3aW4ucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNlbW92ZVwiLCBvbk1vdmUpO1xyXG4gICAgICB3aW4ucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNldXBcIiwgb25VcCk7XHJcbiAgICAgIHdpbi5yZW1vdmVFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCBvbktleSwgdHJ1ZSk7XHJcbiAgICAgIGlmICghZHJhZ2dpbmcpIHJldHVybjtcclxuICAgICAgd3JhcHBlci5kb2MuYm9keS5yZW1vdmVDbGFzcyhcImZyZWQtdHlwLWJsb2NrLWRyYWdnaW5nXCIpO1xyXG4gICAgICBibG9ja0Vscy5nZXQoc2VjdGlvbikucmVtb3ZlQ2xhc3MoXCJpcy1kcmFnZ2luZ1wiKTtcclxuICAgICAgaW5kaWNhdG9yPy5yZW1vdmUoKTtcclxuXHJcbiAgICAgIGNvbnN0IG9yZGVyID0gYm94ZXMubWFwKChib3gpID0+IGJveC5zZWN0aW9uKTtcclxuICAgICAgY29uc3QgZnJvbSA9IG9yZGVyLmluZGV4T2Yoc2VjdGlvbik7XHJcbiAgICAgIGlmICghY29tbWl0IHx8IHRhcmdldEluZGV4ID09PSBudWxsIHx8IHRhcmdldEluZGV4ID09PSBmcm9tIHx8IHRhcmdldEluZGV4ID09PSBmcm9tICsgMSkgcmV0dXJuO1xyXG4gICAgICBvcmRlci5zcGxpY2UoZnJvbSwgMSk7XHJcbiAgICAgIG9yZGVyLnNwbGljZShmcm9tIDwgdGFyZ2V0SW5kZXggPyB0YXJnZXRJbmRleCAtIDEgOiB0YXJnZXRJbmRleCwgMCwgc2VjdGlvbik7XHJcbiAgICAgIG9uTW92ZVNlY3Rpb24/LihvcmRlcik7XHJcbiAgICB9O1xyXG4gICAgY29uc3Qgb25VcCA9ICgpID0+IGVuZCh0cnVlKTtcclxuICAgIGNvbnN0IG9uS2V5ID0gKGtleUV2ZW50KSA9PiB7XHJcbiAgICAgIGlmIChrZXlFdmVudC5rZXkgIT09IFwiRXNjYXBlXCIpIHJldHVybjtcclxuICAgICAga2V5RXZlbnQucHJldmVudERlZmF1bHQoKTtcclxuICAgICAga2V5RXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XHJcbiAgICAgIGVuZChmYWxzZSk7XHJcbiAgICB9O1xyXG4gICAgd2luLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZW1vdmVcIiwgb25Nb3ZlKTtcclxuICAgIHdpbi5hZGRFdmVudExpc3RlbmVyKFwibW91c2V1cFwiLCBvblVwKTtcclxuICAgIHdpbi5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCBvbktleSwgdHJ1ZSk7XHJcbiAgfVxyXG5cclxuICByZWdpc3RlclByb3BlcnR5RHJhZygpO1xyXG4gIHJldHVybiBhcGk7XHJcblxyXG4gIC8qIC0tLSBFaW5lIFByb3BlcnR5IGluIGVpbmVuIGFuZGVyZW4gQmxvY2sgemllaGVuIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gICAqIEF1Zmdlc2V0enQgYXVmIE9ic2lkaWFucyBlaWdlbmVzIFplaWxlbi1EcmFnIChHdiBpbSBnZWJhdXRlbiBhcHAuanMpLFxyXG4gICAqIHN0YXR0IGVpbiB6d2VpdGVzIGRhbmViZW56dXN0ZWxsZW46IGRhcyBoXHUwMEU0bmd0IGFtIFR5cC1JY29uIGRlciBaZWlsZVxyXG4gICAqICgubWV0YWRhdGEtcHJvcGVydHktaWNvbiksIGxlZ3QgZWluZW4gLmRyYWctcmVvcmRlci1naG9zdCBhbiBkZW4gQm9keSAtXHJcbiAgICogZGVyIGZvbGd0IGRlbSBDdXJzb3IgYWxzbyBvaG5laGluIFx1MDBGQ2JlciBCbG9ja2dyZW56ZW4gaGlud2VnIC0gdW5kXHJcbiAgICogbWFya2llcnQgZGllIFVyc3BydW5nc3plaWxlIG1pdCAuZHJhZy1naG9zdC1oaWRkZW4sIE9ic2lkaWFucyBlaWdlbmVtXHJcbiAgICogQWt6ZW50LVJlY2h0ZWNrLCBkYXMgZGllIEVpbmZcdTAwRkNnZXN0ZWxsZSB6ZWlndC4gSW5uZXJoYWxiIGVpbmVzIEJsb2Nrc1xyXG4gICAqIG1hY2h0IE9ic2lkaWFuIGRhbWl0IHVudmVyXHUwMEU0bmRlcnQgYWxsZXMgc2VsYnN0LiBEYXp1IGtvbW10IGhpZXIgbnVyOlxyXG4gICAqXHJcbiAgICogIC0gZWluIGxlZXJlcyBadXNhdHpraW5kIGluIGRlciBMaXN0ZSwgc29sYW5nZSBnZXpvZ2VuIHdpcmQ6IE9ic2lkaWFuXHJcbiAgICogICAgc3RhcnRldCBkZW4gRHJhZyBzb25zdCBnYXIgbmljaHQsIHdlbm4gZWluIEJsb2NrIG51ciBlaW5lIGVpbnppZ2VcclxuICAgKiAgICBaZWlsZSBoYXQgKFByXHUwMEZDZnVuZyBuLmZpcnN0Q2hpbGQgIT09IG4ubGFzdENoaWxkIGJlaW0gbW91c2Vkb3duKTtcclxuICAgKiAgLSBlaW4gUGxhdHpoYWx0ZXIgbWl0IGRlcnNlbGJlbiBLbGFzc2UgLmRyYWctZ2hvc3QtaGlkZGVuIGltIFppZWxibG9jayxcclxuICAgKiAgICBzb2JhbGQgZGVyIEN1cnNvciBlaW5lbiBmcmVtZGVuIEJsb2NrIGVycmVpY2h0IC0gZGllIFVyc3BydW5nc3plaWxlXHJcbiAgICogICAgd2lyZCBzb2xhbmdlIGF1c2dlYmxlbmRldCwgZGFtaXQgbmljaHQgendlaSBSZWNodGVja2Ugc3RlaGVuO1xyXG4gICAqICAtIHJlb3JkZXJLZXkgamUgSW5zdGFueiwgZGFzIGJlaW0gTG9zbGFzc2VuIFx1MDBGQ2JlciBlaW5lbSBmcmVtZGVuIEJsb2NrXHJcbiAgICogICAgZGllIFByb3BlcnR5IGRvcnRoaW4gdW1oXHUwMEU0bmd0LCBzdGF0dCBpbm5lcmhhbGIgZGVzIGVpZ2VuZW4genUgc29ydGllcmVuLlxyXG4gICAqXHJcbiAgICogRGllIGVpZ2VuZW4gSGFuZGxlciBsYXVmZW4gaW4gZGVyIENhcHR1cmUtUGhhc2UgYW0gRmVuc3RlciB1bmQgZGFtaXQgdm9yXHJcbiAgICogT2JzaWRpYW5zIGVpZ2VuZW4gKGRpZSBlcyBpbiBzZWluZW0gbW91c2Vkb3duLUhhbmRsZXIgYXVmIHdpbmRvdyBsZWd0KS5cclxuICAgKiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xyXG4gIGZ1bmN0aW9uIHJlZ2lzdGVyUHJvcGVydHlEcmFnKCkge1xyXG4gICAgLy8gT2huZSBlaW5lbiB6d2VpdGVuIEJsb2NrIGdpYnQgZXMga2VpbiBaaWVsIC0gZGFubiBibGVpYnQgT2JzaWRpYW5zXHJcbiAgICAvLyBlaWdlbmVzIERyYWcgdlx1MDBGNmxsaWcgdW5hbmdldGFzdGV0LlxyXG4gICAgY29uc3QgYW5jaG9yID0gYXBpLmVkaXRvcnNbMF07XHJcbiAgICBpZiAoIWFuY2hvciB8fCBzZWN0aW9ucy5sZW5ndGggPCAyKSByZXR1cm47XHJcblxyXG4gICAgLy8gTFx1MDBFNHVmdCBlaW4gRHJhZywgaFx1MDBFNGx0IGRpZXMgZGVzc2VuIFp1c3RhbmQ7IGRyb3AgbWVya3Qgc2ljaCBiZWltXHJcbiAgICAvLyBMb3NsYXNzZW4gZGFzIFppZWwgZlx1MDBGQ3IgZGFzIGFuc2NobGllXHUwMERGZW5kZSByZW9yZGVyS2V5LlxyXG4gICAgbGV0IGRyYWcgPSBudWxsO1xyXG4gICAgbGV0IGRyb3AgPSBudWxsO1xyXG5cclxuICAgIGNvbnN0IHNlY3Rpb25BdCA9IChjbGllbnRZKSA9PlxyXG4gICAgICBzZWN0aW9ucy5maW5kKChzZWN0aW9uKSA9PiB7XHJcbiAgICAgICAgY29uc3QgcmVjdCA9IGJsb2NrRWxzLmdldChzZWN0aW9uKS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcclxuICAgICAgICByZXR1cm4gY2xpZW50WSA+PSByZWN0LnRvcCAmJiBjbGllbnRZIDw9IHJlY3QuYm90dG9tO1xyXG4gICAgICB9KTtcclxuXHJcbiAgICBjb25zdCBjbGVhclBsYWNlaG9sZGVyID0gKCkgPT4ge1xyXG4gICAgICBkcmFnLnBsYWNlaG9sZGVyPy5yZW1vdmUoKTtcclxuICAgICAgZHJhZy5wbGFjZWhvbGRlciA9IG51bGw7XHJcbiAgICAgIGRyYWcucm93RWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJkaXNwbGF5XCIpO1xyXG4gICAgICBkcmFnLnRhcmdldCA9IG51bGw7XHJcbiAgICB9O1xyXG5cclxuICAgIHdyYXBwZXIuYWRkRXZlbnRMaXN0ZW5lcihcclxuICAgICAgXCJtb3VzZWRvd25cIixcclxuICAgICAgKGV2ZW50KSA9PiB7XHJcbiAgICAgICAgaWYgKGV2ZW50LmJ1dHRvbiAhPT0gMCkgcmV0dXJuO1xyXG4gICAgICAgIGNvbnN0IHJvd0VsID0gZXZlbnQudGFyZ2V0LmNsb3Nlc3QoXCIubWV0YWRhdGEtcHJvcGVydHktaWNvblwiKT8uY2xvc2VzdChcIi5tZXRhZGF0YS1wcm9wZXJ0eVwiKTtcclxuICAgICAgICBjb25zdCBzZWN0aW9uID0gcm93RWw/LmNsb3Nlc3QoXCIuZnJlZC10eXAtYmxvY2tcIik/LmZyZWRTZWN0aW9uO1xyXG4gICAgICAgIGNvbnN0IGVkaXRvciA9IHNlY3Rpb24gPT09IHVuZGVmaW5lZCA/IG51bGwgOiBlZGl0b3JzLmdldChzZWN0aW9uKTtcclxuICAgICAgICBjb25zdCBrZXkgPSBlZGl0b3I/LnJlbmRlcmVkLmZpbmQoKHJvdykgPT4gcm93LmNvbnRhaW5lckVsID09PSByb3dFbCk/LmVudHJ5LmtleTtcclxuICAgICAgICAvLyBFaW5lIG5vY2ggdW5iZW5hbm50ZSBaZWlsZSBoYXQgaW4gZWluZW0gYW5kZXJlbiBCbG9jayBuaWNodHMgenVcclxuICAgICAgICAvLyBzdWNoZW4gLSBzaWUgYmxlaWJ0IE9ic2lkaWFucyBlaWdlbmVyIFNvcnRpZXJ1bmcgXHUwMEZDYmVybGFzc2VuLlxyXG4gICAgICAgIGlmICgha2V5KSByZXR1cm47XHJcbiAgICAgICAgZHJhZyA9IHtcclxuICAgICAgICAgIHNlY3Rpb24sXHJcbiAgICAgICAgICBrZXksXHJcbiAgICAgICAgICByb3dFbCxcclxuICAgICAgICAgIC8vIEpldHp0IHNjaG9uIGdlbWVzc2VuOiBzb2JhbGQgZGllIFplaWxlIGZcdTAwRkNyIGRlbiBQbGF0emhhbHRlclxyXG4gICAgICAgICAgLy8gYXVzZ2VibGVuZGV0IGlzdCwgbGllZmVydCBvZmZzZXRIZWlnaHQgMC5cclxuICAgICAgICAgIGhlaWdodDogcm93RWwub2Zmc2V0SGVpZ2h0LFxyXG4gICAgICAgICAgc3BhY2VyOiBlZGl0b3IucHJvcGVydHlMaXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRyYWctc3BhY2VyXCIgfSksXHJcbiAgICAgICAgICBwbGFjZWhvbGRlcjogbnVsbCxcclxuICAgICAgICAgIHRhcmdldDogbnVsbCxcclxuICAgICAgICB9O1xyXG4gICAgICAgIGRyb3AgPSBudWxsO1xyXG4gICAgICB9LFxyXG4gICAgICB0cnVlXHJcbiAgICApO1xyXG5cclxuICAgIC8vIEFtIEZlbnN0ZXIgcmVnaXN0cmllcnQsIGRhbWl0IGVpbiBEcmFnIGF1Y2ggYXVcdTAwREZlcmhhbGIgZGVyIEJsXHUwMEY2Y2tlXHJcbiAgICAvLyB3ZWl0ZXJ2ZXJmb2xndCB3aXJkIC0gYWJnZXJcdTAwRTR1bXQgbWl0IGRlbSBlcnN0ZW4gRWRpdG9yLCBkZXIgYmVpbVxyXG4gICAgLy8gblx1MDBFNGNoc3RlbiBOZXVhdWZiYXUgZGVyIERldGFpbGFuc2ljaHQgZW50bGFkZW4gd2lyZCAoc2llaGVcclxuICAgIC8vIGRlc3Ryb3lGcm9udG1hdHRlckVkaXRvciBpbiB0eXAtdmlldy5qcykuXHJcbiAgICBjb25zdCBvbldpbk1vdmUgPSAoZXZlbnQpID0+IHtcclxuICAgICAgaWYgKCFkcmFnKSByZXR1cm47XHJcbiAgICAgIGNvbnN0IHRhcmdldCA9IHNlY3Rpb25BdChldmVudC5jbGllbnRZKTtcclxuICAgICAgaWYgKHRhcmdldCA9PT0gdW5kZWZpbmVkIHx8IHRhcmdldCA9PT0gZHJhZy5zZWN0aW9uKSB7XHJcbiAgICAgICAgaWYgKGRyYWcucGxhY2Vob2xkZXIpIGNsZWFyUGxhY2Vob2xkZXIoKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IGxpc3QgPSBlZGl0b3JzLmdldCh0YXJnZXQpLnByb3BlcnR5TGlzdEVsO1xyXG4gICAgICBpZiAoIWRyYWcucGxhY2Vob2xkZXIpIHtcclxuICAgICAgICBkcmFnLnJvd0VsLnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcclxuICAgICAgICBkcmFnLnBsYWNlaG9sZGVyID0gY3JlYXRlRGl2KHsgY2xzOiBcIm1ldGFkYXRhLXByb3BlcnR5IGRyYWctZ2hvc3QtaGlkZGVuIGZyZWQtdHlwLWRyYWctcGxhY2Vob2xkZXJcIiB9KTtcclxuICAgICAgICBkcmFnLnBsYWNlaG9sZGVyLnN0eWxlLmhlaWdodCA9IGAke2RyYWcuaGVpZ2h0fXB4YDtcclxuICAgICAgfVxyXG4gICAgICAvLyBFaW5mXHUwMEZDZ2VzdGVsbGUgd2llIGJlaSBPYnNpZGlhbiBzZWxic3Q6IHZvciBkZXIgZXJzdGVuIFplaWxlLCBkZXJlblxyXG4gICAgICAvLyBNaXR0ZSB1bnRlcmhhbGIgZGVzIEN1cnNvcnMgbGllZ3QuXHJcbiAgICAgIGNvbnN0IHJvd3MgPSBbLi4ubGlzdC5jaGlsZHJlbl0uZmlsdGVyKChlbCkgPT4gZWwgIT09IGRyYWcucGxhY2Vob2xkZXIgJiYgZWwgIT09IGRyYWcuc3BhY2VyKTtcclxuICAgICAgY29uc3QgYmVmb3JlID0gcm93cy5maW5kKChlbCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IHJlY3QgPSBlbC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcclxuICAgICAgICByZXR1cm4gZXZlbnQuY2xpZW50WSA8IHJlY3QudG9wICsgcmVjdC5oZWlnaHQgLyAyO1xyXG4gICAgICB9KTtcclxuICAgICAgZHJhZy50YXJnZXQgPSB7IHNlY3Rpb246IHRhcmdldCwgaW5kZXg6IGJlZm9yZSA/IHJvd3MuaW5kZXhPZihiZWZvcmUpIDogcm93cy5sZW5ndGggfTtcclxuICAgICAgbGlzdC5pbnNlcnRCZWZvcmUoZHJhZy5wbGFjZWhvbGRlciwgYmVmb3JlID8/IG51bGwpO1xyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBvbldpblVwID0gKCkgPT4ge1xyXG4gICAgICBpZiAoIWRyYWcpIHJldHVybjtcclxuICAgICAgY29uc3QgeyBzcGFjZXIsIHBsYWNlaG9sZGVyLCByb3dFbCwgdGFyZ2V0IH0gPSBkcmFnO1xyXG4gICAgICBkcmFnID0gbnVsbDtcclxuICAgICAgZHJvcCA9IHRhcmdldDtcclxuICAgICAgcGxhY2Vob2xkZXI/LnJlbW92ZSgpO1xyXG4gICAgICByb3dFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImRpc3BsYXlcIik7XHJcbiAgICAgIC8vIEVyc3QgbmFjaCBPYnNpZGlhbnMgZWlnZW5lbSBEcmFnLUFic2NobHVzczogZGVyIGJlc3RpbW10IGRpZVxyXG4gICAgICAvLyBFaW5mXHUwMEZDZ2VzdGVsbGUgaW5uZXJoYWxiIGRlcyBBdXNnYW5nc2Jsb2NrcyBub2NoIFx1MDBGQ2JlciBkaWUgS2luZGVybGlzdGUsXHJcbiAgICAgIC8vIGluIGRlciBkYXMgWnVzYXR6a2luZCBkaWUgbGV0enRlIFBvc2l0aW9uIG1hcmtpZXJ0LlxyXG4gICAgICB3cmFwcGVyLndpbi5zZXRUaW1lb3V0KCgpID0+IHNwYWNlci5yZW1vdmUoKSwgMCk7XHJcbiAgICB9O1xyXG5cclxuICAgIHdyYXBwZXIud2luLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZW1vdmVcIiwgb25XaW5Nb3ZlLCB0cnVlKTtcclxuICAgIHdyYXBwZXIud2luLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZXVwXCIsIG9uV2luVXAsIHRydWUpO1xyXG4gICAgYW5jaG9yLnJlZ2lzdGVyKCgpID0+IHtcclxuICAgICAgd3JhcHBlci53aW4ucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNlbW92ZVwiLCBvbldpbk1vdmUsIHRydWUpO1xyXG4gICAgICB3cmFwcGVyLndpbi5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2V1cFwiLCBvbldpblVwLCB0cnVlKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGZvciAoY29uc3QgW3NlY3Rpb24sIGVkaXRvcl0gb2YgZWRpdG9ycykge1xyXG4gICAgICBjb25zdCBvcmlnaW5hbFJlb3JkZXJLZXkgPSBlZGl0b3IucmVvcmRlcktleTtcclxuICAgICAgZWRpdG9yLnJlb3JkZXJLZXkgPSBmdW5jdGlvbiAoZW50cnksIGluZGV4KSB7XHJcbiAgICAgICAgY29uc3QgdGFyZ2V0ID0gZHJvcDtcclxuICAgICAgICBkcm9wID0gbnVsbDtcclxuICAgICAgICBpZiAoIXRhcmdldCkgcmV0dXJuIG9yaWdpbmFsUmVvcmRlcktleS5jYWxsKHRoaXMsIGVudHJ5LCBpbmRleCk7XHJcbiAgICAgICAgbW92ZVByb3BlcnR5KHNlY3Rpb24sIHRhcmdldC5zZWN0aW9uLCBlbnRyeS5rZXksIHRhcmdldC5pbmRleCk7XHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvLyBIXHUwMEU0bmd0IGtleSBhdXMgZGVtIEJsb2NrIGZyb20gaW4gZGVuIEJsb2NrIHRvIHVtLCBkb3J0IGFuIFBvc2l0aW9uIGluZGV4LlxyXG4gIC8vIEZcdTAwRkNocnQgZGFzIFppZWwgZGVuIE5hbWVuIGJlcmVpdHMgKGlubmVyaGFsYiBlaW5lcyBCbG9ja3MgbXVzcyBlciBlaW5kZXV0aWdcclxuICAvLyBibGVpYmVuKSwgd2VyZGVuIGJlaWRlIHp1c2FtbWVuZ2VsZWd0OiBkZXIgYmVzdGVoZW5kZSBFaW50cmFnIGJlaFx1MDBFNGx0XHJcbiAgLy8gUG9zaXRpb24sIFdlcnQsIEZsb2F0aW5nLU1hcmtpZXJ1bmcgdW5kIFNob3J0Y3V0LCBudXIgZWluIGxlZXJlciBXZXJ0IHdpcmRcclxuICAvLyBhdXMgZGVyIGdlem9nZW5lbiBQcm9wZXJ0eSBnZWZcdTAwRkNsbHQgLSBkaWVzZWxiZSBSZWdlbCB3aWUgYmVpIG1lcmdlU3VidHlwZXNcclxuICAvLyAoc3VidHlwZXMuanMpIHVuZCByZW5hbWVJblN0b3JlIChwcm9wZXJ0eS1yZW5hbWUtc3luYy5qcykuXHJcbiAgYXN5bmMgZnVuY3Rpb24gbW92ZVByb3BlcnR5KGZyb20sIHRvLCBrZXksIGluZGV4KSB7XHJcbiAgICBjb25zdCBzb3VyY2UgPSBzdG9yZXMuZ2V0KGZyb20pO1xyXG4gICAgY29uc3QgdGFyZ2V0ID0gc3RvcmVzLmdldCh0byk7XHJcbiAgICBpZiAoIXNvdXJjZSB8fCAhdGFyZ2V0IHx8IGZyb20gPT09IHRvKSByZXR1cm47XHJcblxyXG4gICAgY29uc3Qgc291cmNlRnJvbnRtYXR0ZXIgPSB7IC4uLnNvdXJjZS5nZXRGcm9udG1hdHRlcigpIH07XHJcbiAgICBjb25zdCB2YWx1ZSA9IHNvdXJjZUZyb250bWF0dGVyW2tleV07XHJcbiAgICBjb25zdCB3YXNGbG9hdGluZyA9IHNvdXJjZS5nZXRGbG9hdGluZygpLmluY2x1ZGVzKGtleSk7XHJcbiAgICAvLyBEZXIgU2hvcnRjdXQgaFx1MDBFNG5ndCBhbSBLZXkgKHNpZWhlIHNob3J0Y3V0cy5qcykgdW5kIHppZWh0IGRlc2hhbGIgbWl0IGRlclxyXG4gICAgLy8gUHJvcGVydHkgaW4gZGVuIGFuZGVyZW4gQmxvY2sgdW0uXHJcbiAgICBjb25zdCBzb3VyY2VTaG9ydGN1dHMgPSB7IC4uLnNvdXJjZS5nZXRTaG9ydGN1dHMoKSB9O1xyXG4gICAgY29uc3Qgc2hvcnRjdXQgPSBzb3VyY2VTaG9ydGN1dHNba2V5XSA/PyBudWxsO1xyXG4gICAgZGVsZXRlIHNvdXJjZVNob3J0Y3V0c1trZXldO1xyXG4gICAgZGVsZXRlIHNvdXJjZUZyb250bWF0dGVyW2tleV07XHJcbiAgICBzb3VyY2Uuc2V0RnJvbnRtYXR0ZXIoc291cmNlRnJvbnRtYXR0ZXIpO1xyXG4gICAgc291cmNlLnNldEZsb2F0aW5nKHNvdXJjZS5nZXRGbG9hdGluZygpLmZpbHRlcigoaykgPT4gayAhPT0ga2V5KSk7XHJcbiAgICBzb3VyY2Uuc2V0U2hvcnRjdXRzKHNvdXJjZVNob3J0Y3V0cyk7XHJcblxyXG4gICAgY29uc3QgdGFyZ2V0RnJvbnRtYXR0ZXIgPSB0YXJnZXQuZ2V0RnJvbnRtYXR0ZXIoKTtcclxuICAgIGNvbnN0IGV4aXN0aW5nID0gT2JqZWN0LmtleXModGFyZ2V0RnJvbnRtYXR0ZXIpLmZpbmQoKGspID0+IGsudG9Mb3dlckNhc2UoKSA9PT0ga2V5LnRvTG93ZXJDYXNlKCkpO1xyXG4gICAgaWYgKGV4aXN0aW5nICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgaWYgKGlzRW1wdHlWYWx1ZSh0YXJnZXRGcm9udG1hdHRlcltleGlzdGluZ10pKSB0YXJnZXQuc2V0RnJvbnRtYXR0ZXIoeyAuLi50YXJnZXRGcm9udG1hdHRlciwgW2V4aXN0aW5nXTogdmFsdWUgfSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXModGFyZ2V0RnJvbnRtYXR0ZXIpO1xyXG4gICAgICBjb25zdCBhdCA9IE1hdGgubWF4KDAsIE1hdGgubWluKGluZGV4LCBrZXlzLmxlbmd0aCkpO1xyXG4gICAgICBjb25zdCBuZXh0ID0ge307XHJcbiAgICAgIGZvciAoY29uc3QgayBvZiBrZXlzLnNsaWNlKDAsIGF0KSkgbmV4dFtrXSA9IHRhcmdldEZyb250bWF0dGVyW2tdO1xyXG4gICAgICBuZXh0W2tleV0gPSB2YWx1ZTtcclxuICAgICAgZm9yIChjb25zdCBrIG9mIGtleXMuc2xpY2UoYXQpKSBuZXh0W2tdID0gdGFyZ2V0RnJvbnRtYXR0ZXJba107XHJcbiAgICAgIHRhcmdldC5zZXRGcm9udG1hdHRlcihuZXh0KTtcclxuICAgICAgaWYgKHdhc0Zsb2F0aW5nKSB0YXJnZXQuc2V0RmxvYXRpbmcoWy4uLnRhcmdldC5nZXRGbG9hdGluZygpLCBrZXldKTtcclxuICAgICAgaWYgKHNob3J0Y3V0KSB0YXJnZXQuc2V0U2hvcnRjdXRzKHsgLi4udGFyZ2V0LmdldFNob3J0Y3V0cygpLCBba2V5XTogc2hvcnRjdXQgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgYXdhaXQgdmlldy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgICAvLyBSZW5kZXJ0IHUuIGEuIGRpZXNlIERldGFpbGFuc2ljaHQgbmV1IChzaWVoZSByZWdpc3RlclR5cFZpZXcpIC0gZGllXHJcbiAgICAvLyBCbFx1MDBGNmNrZSBlbnRzdGVoZW4gZGFiZWkgc2FtdCBFZGl0b3JlbiBmcmlzY2ggYXVzIGRlbiBFaW5zdGVsbHVuZ2VuLlxyXG4gICAgdmlldy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XHJcbiAgfVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IHsgbW91bnRGcm9udG1hdHRlckJsb2NrcyB9O1xyXG4iLCAiLy8gUmVpbmUgSGlsZnNmdW5rdGlvbmVuIG9obmUgZWlnZW5lbiBTdGF0ZSBydW5kIHVtIFRZUC1OYW1lbiB1bmQgZGVyZW5cbi8vIFNvcnRpZXJ1bmcuXG5cbi8vIFRZUGVuIHdlcmRlbiBhdXNzY2hsaWVcdTAwREZsaWNoIGluIEdyb1x1MDBERmJ1Y2hzdGFiZW4gYW5nZWxlZ3QvdW1iZW5hbm50IC0gYmVpbVxuLy8gQW5sZWdlbiB3aWUgYmVpbSBVbWJlbmVubmVuLiBCZXRyaWZmdCBudXIgXHUwMEZDYmVyIGRpZSBMaXN0ZSBnZXRpcHB0ZSBOYW1lbixcbi8vIG5pY2h0IFdlcnRlLCBkaWUgei4gQi4gZGlyZWt0IGltIEZyb250bWF0dGVyIGVpbmVyIE5vdGl6IGluIEtsZWluc2NocmVpYnVuZ1xuLy8gc3RlaGVuIChzaWVoZSBcInVucmVnaXN0cmllcnRlXCIgWmVpbGVuIGluIHR5cC12aWV3LmpzKS5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVR5cGVOYW1lKHJhdykge1xuICByZXR1cm4gcmF3LnRyaW0oKS50b1VwcGVyQ2FzZSgpO1xufVxuXG4vLyBGYXJidG9uICgwLTM2MFx1MDBCMCkgYXVzIGVpbmVtIEhleC1Db2RlLCBmXHUwMEZDciBkaWUgU29ydGllcnVuZyBuYWNoIEZhcmJzcGVrdHJ1bVxuLy8gc3RhdHQgbmFjaCBIZXgtU3RyaW5nLiBSb3QgbGllZ3QgYmVpIDBcdTAwQjAvMzYwXHUwMEIwIChLcmVpcykgLSBhdWZzdGVpZ2VuZCBiZWdpbm50XG4vLyBkaWUgU29ydGllcnVuZyBkYW1pdCBiZWkgUm90LCBsXHUwMEU0dWZ0IFx1MDBGQ2JlciBPcmFuZ2UvR2VsYi9Hclx1MDBGQ24vQ3lhbi9CbGF1L01hZ2VudGFcbi8vIHVuZCBsYW5kZXQgd2llZGVyIGJlaSBSb3QuIEFjaHJvbWF0aXNjaGUgRmFyYmVuIChHcmF1L1NjaHdhcnovV2VpXHUwMERGLCBkZWx0YT0wKVxuLy8gaGFiZW4ga2VpbmVuIGRlZmluaWVydGVuIEZhcmJ0b24gLSBkYWZcdTAwRkNyIGxpZWZlcnQgZGllc2UgRnVua3Rpb24gbnVsbCwgZGFtaXRcbi8vIGNvbXBhcmVUeXBlcyBzaWUgdW5hYmhcdTAwRTRuZ2lnIHZvbiBkZXIgU29ydGllcnJpY2h0dW5nIGFucyBFbmRlIHN0ZWxsZW4ga2Fubi5cbmZ1bmN0aW9uIGhleFRvSHVlKGhleCkge1xuICBjb25zdCBtYXRjaCA9IC9eIz8oWzAtOWEtZl17Nn0pJC9pLmV4ZWMoaGV4ID8/IFwiXCIpO1xuICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgaW50ID0gcGFyc2VJbnQobWF0Y2hbMV0sIDE2KTtcbiAgY29uc3QgciA9ICgoaW50ID4+IDE2KSAmIDI1NSkgLyAyNTU7XG4gIGNvbnN0IGcgPSAoKGludCA+PiA4KSAmIDI1NSkgLyAyNTU7XG4gIGNvbnN0IGIgPSAoaW50ICYgMjU1KSAvIDI1NTtcbiAgY29uc3QgbWF4ID0gTWF0aC5tYXgociwgZywgYik7XG4gIGNvbnN0IG1pbiA9IE1hdGgubWluKHIsIGcsIGIpO1xuICBjb25zdCBkZWx0YSA9IG1heCAtIG1pbjtcbiAgaWYgKGRlbHRhID09PSAwKSByZXR1cm4gbnVsbDtcblxuICBsZXQgaHVlO1xuICBpZiAobWF4ID09PSByKSBodWUgPSAoKGcgLSBiKSAvIGRlbHRhKSAlIDY7XG4gIGVsc2UgaWYgKG1heCA9PT0gZykgaHVlID0gKGIgLSByKSAvIGRlbHRhICsgMjtcbiAgZWxzZSBodWUgPSAociAtIGcpIC8gZGVsdGEgKyA0O1xuICBodWUgKj0gNjA7XG4gIHJldHVybiBodWUgPCAwID8gaHVlICsgMzYwIDogaHVlO1xufVxuXG4vLyBHZW1laW5zYW1lIFNvcnRpZXJsb2dpayBmXHUwMEZDciBUWVAtIHVuZCBTVUJUWVAtTGlzdGVuLiB0eXBlQ29sb3JzIGRhcmYgZWluXG4vLyBsZWVyZXMgT2JqZWt0IHNlaW4gKFNVQlRZUCBoYXQga2VpbmUgZWlnZW5lIEZhcmJlKSAtIGRlciBcImNvbG9yXCItTW9kdXMgd2lyZFxuLy8gZG9ydCBzY2hsaWNodCBuaWUgYXVzZ2V3XHUwMEU0aGx0LlxuZnVuY3Rpb24gY29tcGFyZVR5cGVzKG1vZGUsIGEsIGIsIGNvdW50cywgdHlwZUNvbG9ycykge1xuICBjb25zdCBba2V5LCBkaXJdID0gbW9kZS5zcGxpdChcIi1cIik7XG4gIGxldCBjbXA7XG4gIGlmIChrZXkgPT09IFwiY291bnRcIikge1xuICAgIGNtcCA9IChjb3VudHMuZ2V0KGEpID8/IDApIC0gKGNvdW50cy5nZXQoYikgPz8gMCk7XG4gICAgaWYgKGRpciA9PT0gXCJkZXNjXCIpIGNtcCA9IC1jbXA7XG4gIH0gZWxzZSBpZiAoa2V5ID09PSBcImNvbG9yXCIpIHtcbiAgICBjb25zdCBodWVBID0gaGV4VG9IdWUodHlwZUNvbG9yc1thXSA/PyBudWxsKTtcbiAgICBjb25zdCBodWVCID0gaGV4VG9IdWUodHlwZUNvbG9yc1tiXSA/PyBudWxsKTtcbiAgICAvLyBBY2hyb21hdGlzY2hlIEZhcmJlbiBibGVpYmVuIGltbWVyIGFtIEVuZGUsIGVnYWwgb2IgYXVmLSBvZGVyIGFic3RlaWdlbmRcbiAgICAvLyBzb3J0aWVydCB3aXJkIC0gbnVyIGRpZSBSZWloZW5mb2xnZSBpbm5lcmhhbGIgZGVyIGVjaHRlbiBGYXJidFx1MDBGNm5lIGRyZWh0IHNpY2ggdW0uXG4gICAgaWYgKGh1ZUEgPT09IG51bGwgJiYgaHVlQiA9PT0gbnVsbCkgY21wID0gMDtcbiAgICBlbHNlIGlmIChodWVBID09PSBudWxsKSBjbXAgPSAxO1xuICAgIGVsc2UgaWYgKGh1ZUIgPT09IG51bGwpIGNtcCA9IC0xO1xuICAgIGVsc2Uge1xuICAgICAgY21wID0gaHVlQSAtIGh1ZUI7XG4gICAgICBpZiAoZGlyID09PSBcImRlc2NcIikgY21wID0gLWNtcDtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgY21wID0gYS5sb2NhbGVDb21wYXJlKGIpO1xuICAgIGlmIChkaXIgPT09IFwiZGVzY1wiKSBjbXAgPSAtY21wO1xuICB9XG4gIHJldHVybiBjbXAgfHwgYS5sb2NhbGVDb21wYXJlKGIpO1xufVxuXG4vLyBXZW5kZXQgZGVuIGFrdHVlbGxlbiBTb3J0aWVybW9kdXMgYXVmIGVpbmUgTGlzdGUgdm9uIFRZUGVuIGFuLiBTb25kZXJmYWxsXG4vLyBcIm1hbnVhbFwiIChzaWVoZSBTT1JUX09QVElPTlMgaW4gdHlwLXZpZXcuanMpOiBkb3J0IGJsZWlidCBiZXd1c3N0IGRpZVxuLy8gXHUwMEZDYmVyZ2ViZW5lIFJlaWhlbmZvbGdlIHNlbGJzdCBlcmhhbHRlbiwgc3RhdHQgc2llIHp1IHNvcnRpZXJlbiAtIHNpZSBJU1QgaW5cbi8vIGRpZXNlbSBNb2R1cyBkaWUgZ2VzcGVpY2hlcnRlIFNvcnRpZXJ1bmcgKHBsdWdpbi5zZXR0aW5ncy50eXBlcywgcGVyIERyYWcgJlxuLy8gRHJvcCBpbiB0eXAtdmlldy5qcyB2ZXJzY2hvYmVuKS4gRWluIFZlcmdsZWljaCB6d2VpZXIgVFlQZW4ga1x1MDBGNm5udGUgZGllc2Vcbi8vIFJlaWhlbmZvbGdlIG5pY2h0IGhlcmxlaXRlbiwgY29tcGFyZVR5cGVzIGJsZWlidCBkYWhlciB1bmFuZ2V0YXN0ZXQuIFZvblxuLy8gbWFpbi5qcyAoZ2V0VHlwZXMoKSwgZlx1MDBGQ3IgVGVtcGxhdGVyL1BpY2tlcikgVU5EIHR5cC12aWV3LmpzIGdlbnV0enQsIGRhbWl0XG4vLyBiZWlkZSBkaWVzZWxiZSBSZWloZW5mb2xnZSB6ZWlnZW4uXG5mdW5jdGlvbiBzb3J0VHlwZXNCeU1vZGUodHlwZXMsIG1vZGUsIGNvdW50cywgdHlwZUNvbG9ycykge1xuICBpZiAobW9kZSA9PT0gXCJtYW51YWxcIikgcmV0dXJuIFsuLi50eXBlc107XG4gIHJldHVybiBbLi4udHlwZXNdLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVUeXBlcyhtb2RlLCBhLCBiLCBjb3VudHMsIHR5cGVDb2xvcnMpKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IG5vcm1hbGl6ZVR5cGVOYW1lLCBoZXhUb0h1ZSwgY29tcGFyZVR5cGVzLCBzb3J0VHlwZXNCeU1vZGUgfTtcbiIsICJjb25zdCB7IEl0ZW1WaWV3LCBNZW51LCBNb2RhbCwgTm90aWNlLCBzZXRJY29uLCBkZWJvdW5jZSB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBtb3VudEZyb250bWF0dGVyQmxvY2tzIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1ibG9ja3NcIik7XG5jb25zdCB7XG4gIG5vcm1hbGl6ZVN1YnR5cGVOYW1lLFxuICBnZXRTdWJ0eXBlTmFtZXMsXG4gIGVuc3VyZVN1YnR5cGUsXG4gIG1vdmVUeXBlU3VidHlwZXMsXG4gIGRlbGV0ZVR5cGVTdWJ0eXBlcyxcbiAgbWVyZ2VUeXBlU3VidHlwZXMsXG4gIGdldFN1YnR5cGUsXG4gIGlzU3VidHlwZU1hbnVhbCxcbiAgc2V0U3VidHlwZU1hbnVhbCxcbiAgc2V0QWxsU3VidHlwZXNNYW51YWwsXG4gIHJlbmFtZVN1YnR5cGUsXG4gIHJlb3JkZXJTdWJ0eXBlcyxcbiAgZGVsZXRlU3VidHlwZSxcbiAgbWVyZ2VTdWJ0eXBlcyxcbiAgcmVuYW1lU3VidHlwZUluTm90ZXMsXG59ID0gcmVxdWlyZShcIi4vc3VidHlwZXNcIik7XG5jb25zdCB7IG5vcm1hbGl6ZVR5cGVOYW1lLCBjb21wYXJlVHlwZXMsIHNvcnRUeXBlc0J5TW9kZSB9ID0gcmVxdWlyZShcIi4vdHlwZS11dGlsc1wiKTtcbmNvbnN0IHsgdHlwZUtleU9mLCBwcm9wZXJ0eVZhbHVlLCBzZXRDYW5vbmljYWxQcm9wZXJ0eSwgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcbmNvbnN0IHtcbiAgc3VidHlwZUNvbG9yLFxuICBhcHBseUNvbG9yT2Zmc2V0LFxuICBoYXNDb2xvck9mZnNldCxcbiAgc3VidHlwZUhhc093bkNvbG9yLFxuICBwYWludENvbG9yRG90LFxuICBuYW1lQ29sb3IsXG4gIGNoYW5uZWxCb3VuZHMsXG4gIGNsYW1wZWRPZmZzZXQsXG4gIFNVQlRZUEVfQ09MT1JfQ0hBTk5FTFMsXG4gIERFRkFVTFRfVFlQRV9DT0xPUixcbn0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcblxuY29uc3QgVklFV19UWVBFX1RZUCA9IFwiZnJlZC10eXAtdmlld1wiO1xuY29uc3QgREVGQVVMVF9TT1JUX09SREVSID0gXCJjb3VudC1kZXNjXCI7XG5jb25zdCBERUZBVUxUX1NFQ09OREFSWSA9IFwic3VidHlwZXNcIjtcblxuLy8gV2FzIGluIGRlciBUWVAtTGlzdGUgcmVjaHRzIG5lYmVuIGRlbSBOYW1lbiBzdGVodCAoc2V0dGluZ3MudHlwTGlzdFNlY29uZGFyeSkuXG4vLyBVbWdlc2NoYWx0ZXQgd2lyZCBuaWNodCBcdTAwRkNiZXIgZGllIEVpbnN0ZWxsdW5nZW4sIHNvbmRlcm4gXHUwMEZDYmVyIGVpbmVuIEtub3BmIGltXG4vLyBMaXN0ZW4tSGVhZGVyIG5lYmVuIGRlciBTb3J0aWVydW5nLCBkZXIgZGllIE1vZGkgZGVyIFJlaWhlIG5hY2ggZHVyY2hzY2hhbHRldFxuLy8gKHNpZWhlIGN5Y2xlU2Vjb25kYXJ5KSAtIGVzIHNpbmQgenUgd2VuaWdlIHVuZCB6dSB1bm1pdHRlbGJhciBzaWNodGJhcmVcbi8vIFp1c3RhZW5kZSBmdWVyIGVpbiBNZW51ZS5cbi8vICAgc3VidHlwZXMgICAgLSBkaWUgU3VidHlwZW4gZGVzIFRZUHMgaW4gS2xhbW1lcm4sIGplIGluIHNlaW5lciBGYXJiZVxuLy8gICAgICAgICAgICAgICAgICh3aWUgZGllIFZvcnNjaGF1IGltIHNlcGFyYXRlbiBUWVAtUGlja2VyLCBzaWVoZVxuLy8gICAgICAgICAgICAgICAgIHJlbmRlclN1YnR5cGVQcmV2aWV3IGluIHR5cGUtcGlja2VyLmpzKVxuLy8gICBkZXNjcmlwdGlvbiAtIFRleHRmZWxkIHp1ciBCZWFyYmVpdHVuZyBkZXIgVFlQLUJlc2NocmVpYnVuZ1xuLy8gICBub25lICAgICAgICAtIG5pY2h0cywgZGVyIE5hbWUgYmVrb21tdCBkaWUgZ2FuemUgWmVpbGVcbi8vIERpZSBSZWloZW5mb2xnZSBpc3QgenVnbGVpY2ggZGllIGRlcyBEdXJjaHNjaGFsdGVucywgZGVyIGVyc3RlIEVpbnRyYWcgZGVyXG4vLyBTdGFuZGFyZCAoREVGQVVMVF9TRUNPTkRBUlkpOiBkaWUgU3VidHlwZW4gc3RlaGVuIHNvbnN0IG5pcmdlbmRzIGluIGRlclxuLy8gTGlzdGUsIGRpZSBCZXNjaHJlaWJ1bmcgZGFnZWdlbiBhdWNoIGluIGRlciBEZXRhaWxhbnNpY2h0IGRlcyBUWVBzLlxuY29uc3QgU0VDT05EQVJZX01PREVTID0gW1xuICB7IG1vZGU6IFwic3VidHlwZXNcIiwgdGl0bGU6IFwiU3VidHlwZW5cIiwgaWNvbjogXCJsaXN0LXRyZWVcIiB9LFxuICB7IG1vZGU6IFwiZGVzY3JpcHRpb25cIiwgdGl0bGU6IFwiQmVzY2hyZWlidW5nXCIsIGljb246IFwidGV4dC1jdXJzb3ItaW5wdXRcIiB9LFxuICB7IG1vZGU6IFwibm9uZVwiLCB0aXRsZTogXCJOaWNodHNcIiwgaWNvbjogXCJtaW51c1wiIH0sXG5dO1xuXG5jb25zdCBTT1JUX09QVElPTlMgPSBbXG4gIC8vIE51dHp0IChhbmRlcnMgYWxzIGRpZSBcdTAwRkNicmlnZW4gTW9kaSkga2VpbmVuIGVpZ2VuZW4gVmVyZ2xlaWNoLCBzb25kZXJuIGRpZVxuICAvLyBSZWloZW5mb2xnZSB2b24gcGx1Z2luLnNldHRpbmdzLnR5cGVzIHNlbGJzdCBhbHMgU3BlaWNoZXJvcnQgLSBzaWVoZVxuICAvLyByZW5kZXIoKSB1bmQgcmVuZGVyUmVnaXN0ZXJlZEl0ZW0oKSBmXHUwMEZDciBkYXMgcGVyIERyYWcgJiBEcm9wIHZlcnNjaGllYmJhcmVcbiAgLy8gUmVuZGVybiwgZGFzIGdlbmF1IGRhcmF1ZiBhdWZiYXV0LiBCZXd1c3N0IGFscyBlcnN0ZSBPcHRpb24gKHNpZWhlXG4gIC8vIHNob3dTb3J0TWVudSkgLSBlaWdlbmUsIG9iZXJzdGUgR3J1cHBlIGltIE1lblx1MDBGQyBzdGF0dCBlaW5zb3J0aWVydCB6d2lzY2hlblxuICAvLyBkaWUgZWlnZW50bGljaGVuIFNvcnRpZXJrcml0ZXJpZW4uXG4gIHsgbW9kZTogXCJtYW51YWxcIiwgdGl0bGU6IFwiTWFudWVsbCAoRHJhZyAmIERyb3ApXCIgfSxcbiAgeyBtb2RlOiBcImNvdW50LWRlc2NcIiwgdGl0bGU6IFwiSFx1MDBFNHVmaWdrZWl0IChhYnN0ZWlnZW5kKVwiIH0sXG4gIHsgbW9kZTogXCJjb3VudC1hc2NcIiwgdGl0bGU6IFwiSFx1MDBFNHVmaWdrZWl0IChhdWZzdGVpZ2VuZClcIiB9LFxuICB7IG1vZGU6IFwibmFtZS1hc2NcIiwgdGl0bGU6IFwiTmFtZSAoQSBiaXMgWilcIiB9LFxuICB7IG1vZGU6IFwibmFtZS1kZXNjXCIsIHRpdGxlOiBcIk5hbWUgKFogYmlzIEEpXCIgfSxcbiAgeyBtb2RlOiBcImNvbG9yLWFzY1wiLCB0aXRsZTogXCJGYXJiZSAoUm90IFx1MjE5MiBWaW9sZXR0KVwiIH0sXG4gIHsgbW9kZTogXCJjb2xvci1kZXNjXCIsIHRpdGxlOiBcIkZhcmJlIChWaW9sZXR0IFx1MjE5MiBSb3QpXCIgfSxcbl07XG5cbi8vIFNjaHJlaWJ0IGRlbiBUWVAtV2VydCBhbGxlciBOb3RpemVuIG1pdCBkZW0gU2NobFx1MDBGQ3NzZWwgb2xkS2V5IChzaWVoZVxuLy8gdHlwZUtleU9mIGluIHR5cC1pbmRleC5qcyAtIGZcdTAwRkNyIGVpbmVuIHNhdWJlcmVuIFdlcnQgZGVyIFRZUC1OYW1lIHNlbGJzdCxcbi8vIHNvbnN0IGRpZSBSb2hmb3JtLCB6LiBCLiBcIiBidWNoXCIgb2RlciBcIltQRVJTT04sIEJVQ0hdXCIpIGF1ZiBkZW4gRWluemVsd2VydFxuLy8gbmV3VmFsdWUgdW0uIEdlbnV0enQgZlx1MDBGQ3IgcmVnaXN0ZXJUeXBlKCkgKEJlcmVpbmlnZW4pLCBVbWJlbmVubmVuIHVuZFxuLy8gWnVzYW1tZW5sZWdlbi4gRGVyIEFiZ2xlaWNoIGVyZm9sZ3QgZXhha3QgXHUwMEZDYmVyIGRlbiBTY2hsXHUwMEZDc3NlbCwgZWluZSBMaXN0ZVxuLy8gd2lyZCBkYWJlaSBhbHNvIGFscyBHYW56ZXMgZXJzZXR6dCBzdGF0dCBudXIgZWluZXIgaWhyZXIgRWludHJcdTAwRTRnZS4gRWluXG4vLyBhYndlaWNoZW5kIGdlc2NocmllYmVuZXIgUHJvcGVydHktTmFtZSAoXCJ0eXBcIikgd2lyZCBkYWJlaSB6dSBcIlRZUFwiLlxuYXN5bmMgZnVuY3Rpb24gcmVuYW1lVHlwZUluTm90ZXMocGx1Z2luLCBvbGRLZXksIG5ld1ZhbHVlKSB7XG4gIGxldCBjaGFuZ2VkID0gMDtcbiAgZm9yIChjb25zdCBmaWxlIG9mIHBsdWdpbi50eXBJbmRleC5maWxlc1dpdGhUeXBlKG9sZEtleSkpIHtcbiAgICBsZXQgbWF0Y2hlZCA9IGZhbHNlO1xuICAgIGF3YWl0IHBsdWdpbi5hcHAuZmlsZU1hbmFnZXIucHJvY2Vzc0Zyb250TWF0dGVyKGZpbGUsIChmcm9udG1hdHRlcikgPT4ge1xuICAgICAgaWYgKHR5cGVLZXlPZihwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBUWVBfUFJPUEVSVFkpKSAhPT0gb2xkS2V5KSByZXR1cm47XG4gICAgICBzZXRDYW5vbmljYWxQcm9wZXJ0eShmcm9udG1hdHRlciwgVFlQX1BST1BFUlRZLCBuZXdWYWx1ZSk7XG4gICAgICBtYXRjaGVkID0gdHJ1ZTtcbiAgICB9KTtcbiAgICBpZiAobWF0Y2hlZCkgY2hhbmdlZCsrO1xuICB9XG4gIHJldHVybiBjaGFuZ2VkO1xufVxuXG4vLyBCZXJlaW5pZ3RlIEZvcm0gZWluZXMgUm9od2VydHMgZlx1MDBGQ3IgcmVnaXN0ZXJUeXBlKCk6IEVpbnplbHdlcnQgZ2V0cmltbXQgdW5kXG4vLyBncm9cdTAwREYgZ2VzY2hyaWViZW47IGVpbmUgTGlzdGUgd2lyZCBiZXd1c3N0IE5JQ0hUIGF1ZiBlaW5lbiBpaHJlciBFaW50clx1MDBFNGdlXG4vLyByZWR1emllcnQsIHNvbmRlcm4gYWxzIEdhbnplcyB6dSBlaW5lbSBFaW56ZWx3ZXJ0IFwiQSwgQlwiIChSb2hmb3JtKSAtIGRhcmF1c1xuLy8gbFx1MDBFNHNzdCBzaWNoIGRlciBUWVAgZGFuYWNoIHBlciBVbWJlbmVubmVuIGdlemllbHQgaW4gZWluZW4gYW5kZXJlbiBcdTAwRkNiZXJmXHUwMEZDaHJlblxuLy8gKHNpZWhlIHN0YXJ0RGV0YWlsUmVuYW1lL3Nob3dNZXJnZUNvbmZpcm0pLiBub3JtYWxpemU6IFNjaHJlaWJ3ZWlzZSBkZXJcbi8vIGVpbnplbG5lbiBOYW1lbiAtIGZcdTAwRkNyIFN1YnR5cGVuIG5vcm1hbGl6ZVN1YnR5cGVOYW1lIChzaWVoZSBzdWJ0eXBlcy5qcykuXG5mdW5jdGlvbiBub3JtYWxpemVSYXdUeXBlKHJhdywgbm9ybWFsaXplID0gbm9ybWFsaXplVHlwZU5hbWUpIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkocmF3KSkge1xuICAgIHJldHVybiByYXdcbiAgICAgIC5tYXAoKHYpID0+IG5vcm1hbGl6ZShTdHJpbmcodiA/PyBcIlwiKSkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgICAuam9pbihcIiwgXCIpO1xuICB9XG4gIHJldHVybiBub3JtYWxpemUoU3RyaW5nKHJhdykpO1xufVxuXG4vLyBBbnplaWdlIGVpbmVzIHVucmVnaXN0cmllcnRlbiBTY2hsXHUwMEZDc3NlbHM6IFJhbmRsZWVyemVpY2hlbiB3XHUwMEU0cmVuIGFscyByZWluZXJcbi8vIFRleHQgdW5zaWNodGJhciwgZGFoZXIgZGFubiBpbiBBbmZcdTAwRkNocnVuZ3N6ZWljaGVuLiBMaXN0ZW4gdHJhZ2VuIGlocmVcbi8vIGVja2lnZW4gS2xhbW1lcm4gc2Nob24gaW0gU2NobFx1MDBGQ3NzZWwuXG5mdW5jdGlvbiBkaXNwbGF5VHlwZUtleSh0eXBlS2V5KSB7XG4gIHJldHVybiB0eXBlS2V5ICE9PSB0eXBlS2V5LnRyaW0oKSA/IGBcIiR7dHlwZUtleX1cImAgOiB0eXBlS2V5O1xufVxuXG4vLyBUWVAtTmFtZSBpbiBGbGllXHUwMERGdGV4dCAoQmVzdFx1MDBFNHRpZ3VuZ3MtTW9kYWxlKTogZWluZ2VmXHUwMEU0cmJ0ZXIgTmFtZSwgd2VubiBcIlRZUFxuLy8gVmlldyBlaW5mXHUwMEU0cmJlblwiIGFrdGl2IGlzdCAoY29sb3JWaWV3cy50eXBMaXN0KSwgc29uc3QgZWluIEZhcmJwdW5rdCBkYXZvclxuLy8gcGx1cyBub3JtYWxlciBUZXh0IC0gZGllc2VsYmUgVW1zY2hhbHR1bmcgd2llIGltIFRZUC1QaWNrZXIgKHNpZWhlXG4vLyByZW5kZXJTdWdnZXN0aW9uIGluIHR5cGUtcGlja2VyLmpzKSB1bmQgaW4gZGVyIFRZUC1MaXN0ZSBzZWxic3QuIGNvbG9yIHdpcmRcbi8vIHZvbSBBdWZydWZlciBcdTAwRkNiZXJnZWJlbiBzdGF0dCBoaWVyIG5hY2hnZXNjaGxhZ2VuLCBkYW1pdCB6LiBCLiBiZWkgZWluZXJcbi8vIFVtYmVuZW5udW5nIGJld3Vzc3QgZlx1MDBGQ3IgYWx0IFVORCBuZXUgZGllc2VsYmUgKGRpZSBkZXMgYWx0ZW4gTmFtZW5zLCBkaWUgbmFjaFxuLy8gZGVtIFVtYmVuZW5uZW4gZXJoYWx0ZW4gYmxlaWJ0KSBGYXJiZSB2ZXJ3ZW5kZXQgd2VyZGVuIGthbm4uIGNvbG9yIG51bGwgPVxuLy8gVFlQIG9obmUgZWlnZW5lIEZhcmJlIChOYW1lIHVuZ2VmXHUwMEU0cmJ0IGJ6dy4gUHVua3QgYWxzIGhvaGxlciBncmF1ZXIgUmluZykuXG5mdW5jdGlvbiBhcHBlbmRUeXBlTmFtZShwYXJlbnRFbCwgcGx1Z2luLCB0eXBlLCBjb2xvcikge1xuICBpZiAocGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdCkge1xuICAgIGNvbnN0IG5hbWVFbCA9IHBhcmVudEVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtaW5saW5lLW5hbWVcIiwgdGV4dDogdHlwZSB9KTtcbiAgICBpZiAoY29sb3IpIG5hbWVFbC5zdHlsZS5jb2xvciA9IGNvbG9yO1xuICB9IGVsc2Uge1xuICAgIHBhaW50Q29sb3JEb3QocGFyZW50RWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1pbmxpbmUtZG90XCIgfSksIGNvbG9yID8/IERFRkFVTFRfVFlQRV9DT0xPUiwgIWNvbG9yKTtcbiAgICBwYXJlbnRFbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLWlubGluZS1uYW1lXCIsIHRleHQ6IHR5cGUgfSk7XG4gIH1cbn1cblxuY2xhc3MgQ29uZmlybURlbGV0ZVR5cGVNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgY29uc3RydWN0b3IocGx1Z2luLCB0eXBlLCBvbkNvbmZpcm0pIHtcbiAgICBzdXBlcihwbHVnaW4uYXBwKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgICB0aGlzLnR5cGUgPSB0eXBlO1xuICAgIHRoaXMub25Db25maXJtID0gb25Db25maXJtO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIHRoaXMubW9kYWxFbC5hZGRDbGFzcyhcImZyZWQtY29uZmlybS1kZWxldGUtbW9kYWxcIik7XG4gICAgY29uc3QgcCA9IGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIik7XG4gICAgcC5hcHBlbmRUZXh0KFwiVHlwIFwiKTtcbiAgICBhcHBlbmRUeXBlTmFtZShwLCB0aGlzLnBsdWdpbiwgdGhpcy50eXBlLCB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3RoaXMudHlwZV0gPz8gbnVsbCk7XG4gICAgcC5hcHBlbmRUZXh0KFwiIHdpcmtsaWNoIGxcdTAwRjZzY2hlbj9cIik7XG5cbiAgICBjb25zdCBidXR0b25Sb3cgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcIm1vZGFsLWJ1dHRvbi1jb250YWluZXJcIiB9KTtcbiAgICBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkFiYnJlY2hlblwiIH0pLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xuXG4gICAgY29uc3QgY29uZmlybUJ0biA9IGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IGNsczogXCJtb2Qtd2FybmluZ1wiLCB0ZXh0OiBcIkxcdTAwRjZzY2hlblwiIH0pO1xuICAgIGNvbmZpcm1CdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgIHRoaXMub25Db25maXJtKCk7XG4gICAgfSk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gIH1cbn1cblxuLy8gVm9yIGRlbSBcIlVtYmVuZW5uZW4gKGlua2wuIE5vdGl6ZW4gYW5wYXNzZW4pXCItQnV0dG9uIChzaWVoZSByZW5kZXJUeXBlU2V0dGluZ3Ncbi8vIHVuZCBzdGFydERldGFpbFJlbmFtZSkgLSBpbSBHZWdlbnNhdHogenVyIG5vcm1hbGVuIFVtYmVuZW5udW5nLCBkaWUgbnVyIGRpZVxuLy8gUGx1Z2luLUVpbnN0ZWxsdW5nZW4gXHUwMEU0bmRlcnQsIHNjaHJlaWJ0IGRpZXNlIFZhcmlhbnRlIHp1c1x1MDBFNHR6bGljaCBkZW4gVFlQLVdlcnRcbi8vIGFsbGVyIGJldHJvZmZlbmVuIE5vdGl6ZW4gdW0uIERhcyBpc3QgZWluIEJ1bGstU2NocmVpYnZvcmdhbmcgXHUwMEZDYmVyXG4vLyBwb3RlbnppZWxsIHZpZWxlIERhdGVpZW4sIGRhaGVyIGhpZXIgZWluZSBleHBsaXppdGUgQmVzdFx1MDBFNHRpZ3VuZyBkYXZvci5cbmNsYXNzIENvbmZpcm1SZW5hbWVUeXBlTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKHBsdWdpbiwgb2xkVHlwZSwgbmV3VHlwZSwgYWZmZWN0ZWRDb3VudCwgb25Db25maXJtLCBvbkNhbmNlbCkge1xuICAgIHN1cGVyKHBsdWdpbi5hcHApO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICAgIHRoaXMub2xkVHlwZSA9IG9sZFR5cGU7XG4gICAgdGhpcy5uZXdUeXBlID0gbmV3VHlwZTtcbiAgICB0aGlzLmFmZmVjdGVkQ291bnQgPSBhZmZlY3RlZENvdW50O1xuICAgIHRoaXMub25Db25maXJtID0gb25Db25maXJtO1xuICAgIHRoaXMub25DYW5jZWwgPSBvbkNhbmNlbDtcbiAgICB0aGlzLmNvbmZpcm1lZCA9IGZhbHNlO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIHRoaXMubW9kYWxFbC5hZGRDbGFzcyhcImZyZWQtY29uZmlybS1kZWxldGUtbW9kYWxcIik7XG4gICAgLy8gRGllc2VsYmUgRmFyYmUgZlx1MDBGQ3IgYWx0IHVuZCBuZXUgKGRpZSBkZXMgYWx0ZW4gTmFtZW5zKSAtIGRlciBuZXVlIE5hbWVcbiAgICAvLyBoYXQgdm9yIGRlbSBlaWdlbnRsaWNoZW4gVW1iZW5lbm5lbiBub2NoIGtlaW5lbiBlaWdlbmVuIEVpbnRyYWcgaW5cbiAgICAvLyB0eXBlQ29sb3JzLCBcdTAwRkNiZXJuaW1tdCBhYmVyIGRpZSBGYXJiZSBkZXMgYWx0ZW4gKHNpZWhlIGFwcGx5UmVuYW1lKS5cbiAgICBjb25zdCBjb2xvciA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdGhpcy5vbGRUeXBlXSA/PyBudWxsO1xuICAgIGNvbnN0IHAgPSBjb250ZW50RWwuY3JlYXRlRWwoXCJwXCIpO1xuICAgIHAuYXBwZW5kVGV4dChcIlRZUCBcIik7XG4gICAgYXBwZW5kVHlwZU5hbWUocCwgdGhpcy5wbHVnaW4sIHRoaXMub2xkVHlwZSwgY29sb3IpO1xuICAgIHAuYXBwZW5kVGV4dChcIiBpbiBcIik7XG4gICAgYXBwZW5kVHlwZU5hbWUocCwgdGhpcy5wbHVnaW4sIHRoaXMubmV3VHlwZSwgY29sb3IpO1xuICAgIHAuYXBwZW5kVGV4dChgIHVtYmVuZW5uZW4gdW5kICR7dGhpcy5hZmZlY3RlZENvdW50fSBOb3RpeihlbikgZW50c3ByZWNoZW5kIGFucGFzc2VuP2ApO1xuXG4gICAgY29uc3QgYnV0dG9uUm93ID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJtb2RhbC1idXR0b24tY29udGFpbmVyXCIgfSk7XG4gICAgYnV0dG9uUm93LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJBYmJyZWNoZW5cIiB9KS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5jbG9zZSgpKTtcblxuICAgIGNvbnN0IGNvbmZpcm1CdG4gPSBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IFwibW9kLWN0YVwiLCB0ZXh0OiBcIlVtYmVuZW5uZW5cIiB9KTtcbiAgICBjb25maXJtQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICB0aGlzLmNvbmZpcm1lZCA9IHRydWU7XG4gICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICB0aGlzLm9uQ29uZmlybSgpO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gRGVja3Qgc293b2hsIFwiQWJicmVjaGVuXCItS2xpY2sgYWxzIGF1Y2ggRXNjYXBlL0tsaWNrIGRhbmViZW4gYWIgLSBhbmFsb2dcbiAgLy8genVtIENhbmNlbC1IYW5kbGluZyBpbiBUeXBQaWNrZXJNb2RhbC5cbiAgb25DbG9zZSgpIHtcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIGlmICghdGhpcy5jb25maXJtZWQpIHRoaXMub25DYW5jZWw/LigpO1xuICB9XG59XG5cbi8vIFVtYmVuZW5uZW4gYXVmIGRlbiBOYW1lbiBlaW5lcyBiZXJlaXRzIHJlZ2lzdHJpZXJ0ZW4gVFlQcyAoc2llaGVcbi8vIHN0YXJ0RGV0YWlsUmVuYW1lKSAtIHN0YXR0IGRpZSBVbWJlbmVubnVuZyBzdGlsbHNjaHdlaWdlbmQgenUgdmVyd2VyZmVuLFxuLy8gYW5iaWV0ZW4sIGJlaWRlIHp1c2FtbWVuenVsZWdlbiAoc2llaGUgbWVyZ2VUeXBlKS4gU2NocmVpYnQgaW1tZXIgYXVjaCBkaWVcbi8vIE5vdGl6ZW4gdW0sIHVuYWJoXHUwMEU0bmdpZyBkYXZvbiwgXHUwMEZDYmVyIHdlbGNoZW4gZGVyIGJlaWRlbiBVbWJlbmVubmVuLUJ1dHRvbnMgZXNcbi8vIGF1c2dlbFx1MDBGNnN0IHd1cmRlOiBlaW4gWnVzYW1tZW5sZWdlbiBudXIgaW4gZGVuIEVpbnN0ZWxsdW5nZW4gbGllXHUwMERGZSBkaWVcbi8vIE5vdGl6ZW4gZGVzIFF1ZWxsLVRZUHMgYWxzIHVucmVnaXN0cmllcnRlbiBFaW50cmFnIHp1clx1MDBGQ2NrLlxuY2xhc3MgQ29uZmlybU1lcmdlVHlwZU1vZGFsIGV4dGVuZHMgQ29uZmlybVJlbmFtZVR5cGVNb2RhbCB7XG4gIG9uT3BlbigpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICB0aGlzLm1vZGFsRWwuYWRkQ2xhc3MoXCJmcmVkLWNvbmZpcm0tZGVsZXRlLW1vZGFsXCIpO1xuICAgIGNvbnN0IHNldHRpbmdzID0gdGhpcy5wbHVnaW4uc2V0dGluZ3M7XG4gICAgY29uc3QgcCA9IGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIik7XG4gICAgcC5hcHBlbmRUZXh0KFwiVFlQIFwiKTtcbiAgICBhcHBlbmRUeXBlTmFtZShwLCB0aGlzLnBsdWdpbiwgdGhpcy5uZXdUeXBlLCBzZXR0aW5ncy50eXBlQ29sb3JzW3RoaXMubmV3VHlwZV0gPz8gbnVsbCk7XG4gICAgcC5hcHBlbmRUZXh0KFwiIGV4aXN0aWVydCBiZXJlaXRzLiBcIik7XG4gICAgYXBwZW5kVHlwZU5hbWUocCwgdGhpcy5wbHVnaW4sIHRoaXMub2xkVHlwZSwgc2V0dGluZ3MudHlwZUNvbG9yc1t0aGlzLm9sZFR5cGVdID8/IG51bGwpO1xuICAgIHAuYXBwZW5kVGV4dChcIiBkYW1pdCB6dXNhbW1lbmxlZ2VuP1wiKTtcblxuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgdGV4dDpcbiAgICAgICAgYCR7dGhpcy5hZmZlY3RlZENvdW50fSBOb3Rpeihlbikgd2VyZGVuIGF1ZiAke3RoaXMubmV3VHlwZX0gdW1nZXN0ZWxsdC4gYCArXG4gICAgICAgIGBGYXJiZSwgQmVzY2hyZWlidW5nIHVuZCBUWVAtRnJvbnRtYXR0ZXIgdm9uICR7dGhpcy5vbGRUeXBlfSBlbnRmYWxsZW4sIGAgK1xuICAgICAgICBgc2VpbmUgU3VidHlwZW4gd2VyZGVuIFx1MDBGQ2Jlcm5vbW1lbiAoZ2xlaWNobmFtaWdlIFN1YnR5cC1CbFx1MDBGNmNrZSB6dXNhbW1lbmdlZlx1MDBGQ2hydCkuYCxcbiAgICB9KTtcblxuICAgIGNvbnN0IGJ1dHRvblJvdyA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibW9kYWwtYnV0dG9uLWNvbnRhaW5lclwiIH0pO1xuICAgIGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IHRleHQ6IFwiQWJicmVjaGVuXCIgfSkuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuY2xvc2UoKSk7XG5cbiAgICBjb25zdCBjb25maXJtQnRuID0gYnV0dG9uUm93LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgY2xzOiBcIm1vZC13YXJuaW5nXCIsIHRleHQ6IFwiWnVzYW1tZW5sZWdlblwiIH0pO1xuICAgIGNvbmZpcm1CdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIHRoaXMuY29uZmlybWVkID0gdHJ1ZTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgIHRoaXMub25Db25maXJtKCk7XG4gICAgfSk7XG4gIH1cbn1cblxuLy8gQmVzdFx1MDBFNHRpZ3VuZ2VuIHJ1bmQgdW0gU3VidHlwZW4gKHNpZWhlIHJlbmRlclNlY3Rpb25Gb290ZXIpOiBzY2hsaWNodGVyIFRleHRcbi8vIHN0YXR0IGVpbmdlZlx1MDBFNHJidGVyIFRZUC1OYW1lbiwgc29uc3Qgd2llIGRpZSBUWVAtTW9kYWxlIG9iZW4uIG9uQ2FuY2VsIGdyZWlmdFxuLy8gd2llIGRvcnQgYXVjaCBiZWkgRXNjYXBlL0tsaWNrIGRhbmViZW4uXG5jbGFzcyBDb25maXJtU3VidHlwZU1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBjb25zdHJ1Y3RvcihhcHAsIHsgcGFyYWdyYXBocywgY29uZmlybVRleHQsIGNvbmZpcm1DbHMsIG9uQ29uZmlybSwgb25DYW5jZWwgfSkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5wYXJhZ3JhcGhzID0gcGFyYWdyYXBocztcbiAgICB0aGlzLmNvbmZpcm1UZXh0ID0gY29uZmlybVRleHQ7XG4gICAgdGhpcy5jb25maXJtQ2xzID0gY29uZmlybUNscztcbiAgICB0aGlzLm9uQ29uZmlybSA9IG9uQ29uZmlybTtcbiAgICB0aGlzLm9uQ2FuY2VsID0gb25DYW5jZWw7XG4gICAgdGhpcy5jb25maXJtZWQgPSBmYWxzZTtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICB0aGlzLm1vZGFsRWwuYWRkQ2xhc3MoXCJmcmVkLWNvbmZpcm0tZGVsZXRlLW1vZGFsXCIpO1xuICAgIGZvciAoY29uc3QgdGV4dCBvZiB0aGlzLnBhcmFncmFwaHMpIGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIiwgeyB0ZXh0IH0pO1xuXG4gICAgY29uc3QgYnV0dG9uUm93ID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJtb2RhbC1idXR0b24tY29udGFpbmVyXCIgfSk7XG4gICAgYnV0dG9uUm93LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJBYmJyZWNoZW5cIiB9KS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5jbG9zZSgpKTtcblxuICAgIGNvbnN0IGNvbmZpcm1CdG4gPSBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IHRoaXMuY29uZmlybUNscywgdGV4dDogdGhpcy5jb25maXJtVGV4dCB9KTtcbiAgICBjb25maXJtQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICB0aGlzLmNvbmZpcm1lZCA9IHRydWU7XG4gICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICB0aGlzLm9uQ29uZmlybSgpO1xuICAgIH0pO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIGlmICghdGhpcy5jb25maXJtZWQpIHRoaXMub25DYW5jZWw/LigpO1xuICB9XG59XG5cbmNsYXNzIFR5cFZpZXcgZXh0ZW5kcyBJdGVtVmlldyB7XG4gIGNvbnN0cnVjdG9yKGxlYWYsIHBsdWdpbikge1xuICAgIHN1cGVyKGxlYWYpO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICB9XG5cbiAgZ2V0Vmlld1R5cGUoKSB7XG4gICAgcmV0dXJuIFZJRVdfVFlQRV9UWVA7XG4gIH1cblxuICBnZXREaXNwbGF5VGV4dCgpIHtcbiAgICByZXR1cm4gXCJUWVBcIjtcbiAgfVxuXG4gIGdldEljb24oKSB7XG4gICAgcmV0dXJuIFwic2hhcGVzXCI7XG4gIH1cblxuICBhc3luYyBvbk9wZW4oKSB7XG4gICAgdGhpcy5pc0VkaXRpbmcgPSBmYWxzZTtcbiAgICB0aGlzLnNlbGVjdGVkVHlwZSA9IG51bGw7XG4gICAgdGhpcy5mcm9udG1hdHRlckJsb2NrcyA9IG51bGw7XG4gICAgdGhpcy5mcm9udG1hdHRlckVkaXRvcnMgPSBbXTtcblxuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gICAgdGhpcy5jb250ZW50RWwuYWRkQ2xhc3MoXCJmcmVkLXR5cC12aWV3XCIpO1xuXG4gICAgdGhpcy5yZWdpc3RlckRvbUV2ZW50KHRoaXMuY29udGVudEVsLCBcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVzY2FwZVwiICYmIHRoaXMuc2VsZWN0ZWRUeXBlICE9PSBudWxsKSB0aGlzLmNsb3NlVHlwZVNldHRpbmdzKCk7XG4gICAgfSk7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfVxuXG4gIGFzeW5jIG9uQ2xvc2UoKSB7XG4gICAgdGhpcy5jbG9zZVN1YnR5cGVDb2xvclBvcG92ZXI/LigpO1xuICB9XG5cbiAgb3BlblNlYXJjaCh0eXBlKSB7XG4gICAgY29uc3QgZ2xvYmFsU2VhcmNoID0gdGhpcy5wbHVnaW4uYXBwLmludGVybmFsUGx1Z2lucy5nZXRQbHVnaW5CeUlkKFwiZ2xvYmFsLXNlYXJjaFwiKTtcbiAgICBpZiAoIWdsb2JhbFNlYXJjaCkgcmV0dXJuO1xuICAgIC8vIFwia2VpbiBUeXBcIiB0clx1MDBFNGZlIG9obmUgRmlsdGVyIGF1Y2ggYWxsZSBOaWNodC1NYXJrZG93bi1EYXRlaWVuIChkaWUgbmF0dXJnZW1cdTAwRTRcdTAwREZcbiAgICAvLyBuaWUgZWluZSBGcm9udG1hdHRlci1Qcm9wZXJ0eSBoYWJlbiBrXHUwMEY2bm5lbikgLSBkYWhlciBleHBsaXppdCBhdWYgLm1kIGVpbmdyZW56ZW4uXG4gICAgLy8gRlx1MDBGQ3IgZWluZSBMaXN0ZSAodW5yZWdpc3RyaWVydGVyIFNjaGxcdTAwRkNzc2VsIFwiW0EsIEJdXCIpIGdpYnQgZXMga2VpbmUgZXhha3RlXG4gICAgLy8gU3VjaHN5bnRheCAtIGRhbm4gbmFjaCBOb3RpemVuIHN1Y2hlbiwgZGllIGFsbGUgaWhyZSBFaW50clx1MDBFNGdlIHRyYWdlbi5cbiAgICBjb25zdCBxdWVyeSA9IHR5cGUgPT09IG51bGwgPyBgLVtcIiR7VFlQX1BST1BFUlRZfVwiXSBmaWxlOi5tZGAgOiB0aGlzLnR5cGVDbGF1c2UodHlwZSk7XG4gICAgZ2xvYmFsU2VhcmNoLmluc3RhbmNlLm9wZW5HbG9iYWxTZWFyY2gocXVlcnkpO1xuICB9XG5cbiAgLy8gU3VjaGtsYXVzZWwgZlx1MDBGQ3IgZWluZW4gVFlQLVNjaGxcdTAwRkNzc2VsLiBGXHUwMEZDciBlaW5lIExpc3RlICh1bnJlZ2lzdHJpZXJ0ZXJcbiAgLy8gU2NobFx1MDBGQ3NzZWwgXCJbQSwgQl1cIikgZ2lidCBlcyBrZWluZSBleGFrdGUgU3VjaHN5bnRheCAtIGRhbm4gbmFjaCBOb3RpemVuXG4gIC8vIHN1Y2hlbiwgZGllIGFsbGUgaWhyZSBFaW50clx1MDBFNGdlIHRyYWdlbi4gQXVjaCB2b24gb3BlblN1YnR5cGVTZWFyY2goKVxuICAvLyBnZW51dHp0OiBzZWl0IGRpZSBuaWNodCBlcmZhc3N0ZW4gU3VidHlwZW4gaW4gZGVyIExpc3RlIHN0ZWhlbiwga2FubiBkb3J0XG4gIC8vIGF1Y2ggZWluIG5pY2h0IGVyZmFzc3RlciAodW5kIGRhbWl0IHVuc2F1YmVyZXIpIFRZUC1TY2hsXHUwMEZDc3NlbCBhbmtvbW1lbi5cbiAgdHlwZUNsYXVzZSh0eXBlKSB7XG4gICAgY29uc3QgcmF3ID0gdGhpcy5wbHVnaW4udHlwSW5kZXgucmF3VmFsdWVPZih0eXBlKTtcbiAgICByZXR1cm4gQXJyYXkuaXNBcnJheShyYXcpXG4gICAgICA/IHJhdy5tYXAoKHYpID0+IGBbXCIke1RZUF9QUk9QRVJUWX1cIjpcIiR7U3RyaW5nKHYgPz8gXCJcIikudHJpbSgpfVwiXWApLmpvaW4oXCIgXCIpXG4gICAgICA6IGBbXCIke1RZUF9QUk9QRVJUWX1cIjpcIiR7dHlwZX1cIl1gO1xuICB9XG5cbiAgLy8gdHlwZUtleSBrb21tdCAxOjEgYXVzIGRlbiB0YXRzXHUwMEU0Y2hsaWNoZW4gRnJvbnRtYXR0ZXItV2VydGVuIChzaWVoZVxuICAvLyB1bnJlZ2lzdGVyZWRSb3dzIGluIHJlbmRlcigpIHVuZCB0eXBlS2V5T2YgaW4gdHlwLWluZGV4LmpzKSAtIGthbm4gYWxzb1xuICAvLyBrbGVpbiBnZXNjaHJpZWJlbiBzZWluLCBSYW5kbGVlcnplaWNoZW4gdHJhZ2VuIG9kZXIgZWluZSBMaXN0ZSBzZWluLiBUWVBlblxuICAvLyB3ZXJkZW4gYWJlciBpbW1lciBhbHMgc2F1YmVyZXIgRWluemVsd2VydCBpbiBHcm9cdTAwREZidWNoc3RhYmVuIGdlZlx1MDBGQ2hydCAtXG4gIC8vIHJlZ2lzdHJpZXJ0IHdpcmQgZGVzaGFsYiBkaWUgYmVyZWluaWd0ZSBGb3JtIChzaWVoZSBub3JtYWxpemVSYXdUeXBlKSwgdW5kXG4gIC8vIGRpZSBiZXRyb2ZmZW5lbiBOb3RpemVuIHdlcmRlbiBnbGVpY2ggbWl0IHVtZ2VzY2hyaWViZW4sIGRhbWl0IHNpZSBuaWNodFxuICAvLyB3ZWl0ZXJoaW4gYWxzIFwibmljaHQgcmVnaXN0cmllcnRcIiBhdWZ0YXVjaGVuLlxuICBhc3luYyByZWdpc3RlclR5cGUodHlwZUtleSkge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuYXBwbHlUeXBlUmVnaXN0cmF0aW9uKHR5cGVLZXkpO1xuICAgIGlmICghcmVzdWx0KSByZXR1cm47XG5cbiAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICB0aGlzLnJlbmRlcigpO1xuICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuXG4gICAgaWYgKHJlc3VsdC5yZW5hbWVkID4gMCkge1xuICAgICAgbmV3IE5vdGljZShgVFlQICR7cmVzdWx0LnR5cGV9IHJlZ2lzdHJpZXJ0LCAke3Jlc3VsdC5yZW5hbWVkfSBOb3RpeihlbikgYW5nZXBhc3N0LmApO1xuICAgIH1cbiAgfVxuXG4gIC8vIERlciBlaWdlbnRsaWNoZSBWb3JnYW5nIGF1cyByZWdpc3RlclR5cGUoKSwgb2huZSBTcGVpY2hlcm4sIE5ldXplaWNobmVuXG4gIC8vIHVuZCBOb3RpY2U6IHNvIGthbm4gcmVnaXN0ZXJUeXBlV2l0aFN1YnR5cGUoKSBUWVAgdW5kIFN1YnR5cCBuYWNoZWluYW5kZXJcbiAgLy8gZWludHJhZ2VuIHVuZCBkYW5hY2ggRUlOTUFMIHNwZWljaGVybiB1bmQgRUlORSBOb3RpY2UgemVpZ2VuLCBzdGF0dCB6d2VpbWFsLlxuICAvLyBMaWVmZXJ0IHsgdHlwZSwgcmVuYW1lZCB9IG9kZXIgbnVsbCwgd2VubiBuaWNodHMgQnJhdWNoYmFyZXMgXHUwMEZDYnJpZyBibGVpYnQuXG4gIGFzeW5jIGFwcGx5VHlwZVJlZ2lzdHJhdGlvbih0eXBlS2V5KSB7XG4gICAgY29uc3QgcmF3ID0gdGhpcy5wbHVnaW4udHlwSW5kZXgucmF3VmFsdWVPZih0eXBlS2V5KTtcbiAgICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplUmF3VHlwZShyYXcgPT09IHVuZGVmaW5lZCA/IHR5cGVLZXkgOiByYXcpO1xuICAgIGlmICghbm9ybWFsaXplZCkgcmV0dXJuIG51bGw7XG4gICAgaWYgKCF0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlcy5pbmNsdWRlcyhub3JtYWxpemVkKSkge1xuICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXMucHVzaChub3JtYWxpemVkKTtcbiAgICB9XG4gICAgY29uc3QgcmVuYW1lZCA9IG5vcm1hbGl6ZWQgIT09IHR5cGVLZXkgPyBhd2FpdCByZW5hbWVUeXBlSW5Ob3Rlcyh0aGlzLnBsdWdpbiwgdHlwZUtleSwgbm9ybWFsaXplZCkgOiAwO1xuICAgIHJldHVybiB7IHR5cGU6IG5vcm1hbGl6ZWQsIHJlbmFtZWQgfTtcbiAgfVxuXG4gIC8vIE5ldWVzLCBsZWVyZXMgVHJlZS1JdGVtIGFubGVnZW4gdW5kIHNvZm9ydCBpbiBkZW4gRWRpdGllci1Nb2R1cyB2ZXJzZXR6ZW4gLVxuICAvLyB3aWUgYmVpIE9ic2lkaWFucyBlaWdlbmVuIFZpZXdzICh6LiBCLiBuZXVlIEJvb2ttYXJrLUdydXBwZSkuXG4gIHN0YXJ0QWRkKCkge1xuICAgIGlmICh0aGlzLmlzRWRpdGluZykgcmV0dXJuO1xuXG4gICAgY29uc3QgdHJlZUl0ZW0gPSB0aGlzLmxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtXCIgfSk7XG4gICAgaWYgKHRoaXMuc2VwYXJhdG9yRWwpIHRoaXMubGlzdEVsLmluc2VydEJlZm9yZSh0cmVlSXRlbSwgdGhpcy5zZXBhcmF0b3JFbCk7XG4gICAgY29uc3Qgc2VsZiA9IHRyZWVJdGVtLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0tc2VsZiBpcy1jbGlja2FibGVcIiB9KTtcbiAgICBjb25zdCBpbm5lciA9IHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1pbm5lclwiIH0pO1xuXG4gICAgdGhpcy5zdGFydEVkaXRpbmcobnVsbCwgc2VsZiwgaW5uZXIpO1xuICB9XG5cbiAgLy8gV2llIE9ic2lkaWFucyBlaWdlbmUgVHJlZS1JdGVtczoga2VpbiB6dXNcdTAwRTR0emxpY2hlcyBJbnB1dC1FbGVtZW50LCBzb25kZXJuXG4gIC8vIGRhcyBiZXN0ZWhlbmRlIFRleHQtRWxlbWVudCB3aXJkIHNlbGJzdCBlZGl0aWVyYmFyIChjb250ZW50ZWRpdGFibGUpLlxuICAvLyB0eXBlID09PSBudWxsIFx1MjE5MiBuZXVlciBFaW50cmFnLCBzb25zdCBVbWJlbmVubmVuIGRlcyBcdTAwRkNiZXJnZWJlbmVuIFR5cHMuXG4gIHN0YXJ0RWRpdGluZyh0eXBlLCBzZWxmLCBpbm5lcikge1xuICAgIGlmICh0aGlzLmlzRWRpdGluZykgcmV0dXJuO1xuICAgIHRoaXMuaXNFZGl0aW5nID0gdHJ1ZTtcblxuICAgIHNlbGYuYWRkQ2xhc3MoXCJpcy1iZWluZy1yZW5hbWVkXCIpO1xuICAgIGlubmVyLnNldEF0dHJpYnV0ZShcImNvbnRlbnRlZGl0YWJsZVwiLCBcInRydWVcIik7XG4gICAgaW5uZXIuc2V0QXR0cmlidXRlKFwic3BlbGxjaGVja1wiLCBcImZhbHNlXCIpO1xuICAgIGlubmVyLmZvY3VzKCk7XG5cbiAgICBjb25zdCByYW5nZSA9IGlubmVyLmRvYy5jcmVhdGVSYW5nZSgpO1xuICAgIHJhbmdlLnNlbGVjdE5vZGVDb250ZW50cyhpbm5lcik7XG4gICAgY29uc3Qgc2VsZWN0aW9uID0gaW5uZXIud2luLmdldFNlbGVjdGlvbigpO1xuICAgIHNlbGVjdGlvbi5yZW1vdmVBbGxSYW5nZXMoKTtcbiAgICBzZWxlY3Rpb24uYWRkUmFuZ2UocmFuZ2UpO1xuXG4gICAgbGV0IGRvbmUgPSBmYWxzZTtcbiAgICBjb25zdCBmaW5pc2ggPSBhc3luYyAoY29tbWl0KSA9PiB7XG4gICAgICBpZiAoZG9uZSkgcmV0dXJuO1xuICAgICAgZG9uZSA9IHRydWU7XG4gICAgICB0aGlzLmlzRWRpdGluZyA9IGZhbHNlO1xuXG4gICAgICBjb25zdCB2YWx1ZSA9IG5vcm1hbGl6ZVR5cGVOYW1lKGlubmVyLnRleHRDb250ZW50KTtcbiAgICAgIGlmIChjb21taXQgJiYgdmFsdWUgJiYgdmFsdWUgIT09IHR5cGUpIHtcbiAgICAgICAgY29uc3QgZXhpc3RzID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXMuc29tZShcbiAgICAgICAgICAodCkgPT4gdC50b0xvd2VyQ2FzZSgpID09PSB2YWx1ZS50b0xvd2VyQ2FzZSgpICYmIHQgIT09IHR5cGVcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKCFleGlzdHMpIHtcbiAgICAgICAgICBpZiAodHlwZSA9PT0gbnVsbCkge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXMucHVzaCh2YWx1ZSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IGlkeCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVzLmluZGV4T2YodHlwZSk7XG4gICAgICAgICAgICBpZiAoaWR4ICE9PSAtMSkgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXNbaWR4XSA9IHZhbHVlO1xuICAgICAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV07XG4gICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV07XG4gICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3R5cGVdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV07XG4gICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV07XG4gICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVTaG9ydGN1dHNbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlU2hvcnRjdXRzW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVTaG9ydGN1dHNbdHlwZV07XG4gICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlU2hvcnRjdXRzW3R5cGVdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHRoaXMuZW5zdXJlVHlwZU1hbnVhbCgpW3R5cGVdICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZU1hbnVhbFt2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlTWFudWFsW3R5cGVdO1xuICAgICAgICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZU1hbnVhbFt0eXBlXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG1vdmVUeXBlU3VidHlwZXModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUsIHZhbHVlKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgfTtcblxuICAgIGlubmVyLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIChldmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmtleSA9PT0gXCJFbnRlclwiKSB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGZpbmlzaCh0cnVlKTtcbiAgICAgIH0gZWxzZSBpZiAoZXZlbnQua2V5ID09PSBcIkVzY2FwZVwiKSB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGZpbmlzaChmYWxzZSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBpbm5lci5hZGRFdmVudExpc3RlbmVyKFwiYmx1clwiLCAoKSA9PiBmaW5pc2godHJ1ZSkpO1xuICB9XG5cbiAgb3BlblR5cGVTZXR0aW5ncyh0eXBlKSB7XG4gICAgdGhpcy5zZWxlY3RlZFR5cGUgPSB0eXBlO1xuICAgIHRoaXMucmVuZGVyKCk7XG4gIH1cblxuICBjbG9zZVR5cGVTZXR0aW5ncygpIHtcbiAgICB0aGlzLnNlbGVjdGVkVHlwZSA9IG51bGw7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfVxuXG4gIC8vIFdpcmQgYWxzIENvbXBvbmVudC1DaGlsZCBnZWxhZGVuIChzaWVoZSBtb3VudEZyb250bWF0dGVyRWRpdG9yKSB1bmQgbXVzc1xuICAvLyBkZXNoYWxiIHZvciBqZWRlbSBOZXVhdWZiYXUgZGVyIERldGFpbC1BbnNpY2h0IGV4cGxpeml0IGVudGxhZGVuIHdlcmRlbiAtXG4gIC8vIGNvbnRlbnRFbC5lbXB0eSgpIGFsbGVpbiB3XHUwMEZDcmRlIG51ciBkaWUgRE9NLUVsZW1lbnRlIGVudGZlcm5lbiwgbmljaHQgYWJlclxuICAvLyBkZW4gZGFyYXVmIHJlZ2lzdHJpZXJ0ZW4gbWV0YWRhdGFUeXBlTWFuYWdlci1MaXN0ZW5lciBkZXIgRWRpdG9yLUluc3RhbnouXG4gIC8vIGZyb250bWF0dGVyQmxvY2tzIGlzdCBkaWUgU3RldWVydW5nIFx1MDBGQ2JlciBhbGxlIEJsXHUwMEY2Y2tlICh1LiBhLiBmXHUwMEZDciBkZW5cbiAgLy8gQmVmZWhsIFwiU3RhbmRhcmQtUHJvcGVydHkgaGluenVmXHUwMEZDZ2VuXCIpLCBmcm9udG1hdHRlckVkaXRvcnMgYWxsZSBFZGl0b3JlblxuICAvLyBkZXIgRGV0YWlsYW5zaWNodCBpbmtsLiBkZXIgU3VidHlwLUJsXHUwMEY2Y2tlLlxuICBkZXN0cm95RnJvbnRtYXR0ZXJFZGl0b3IoKSB7XG4gICAgZm9yIChjb25zdCBlZGl0b3Igb2YgdGhpcy5mcm9udG1hdHRlckVkaXRvcnMgPz8gW10pIHRoaXMucmVtb3ZlQ2hpbGQoZWRpdG9yKTtcbiAgICB0aGlzLmZyb250bWF0dGVyRWRpdG9ycyA9IFtdO1xuICAgIHRoaXMuZnJvbnRtYXR0ZXJCbG9ja3MgPSBudWxsO1xuICB9XG5cbiAgcmVuZGVyKCkge1xuICAgIC8vIFJlZW50cmFuY3ktR3VhcmQ6IHJlbmRlclR5cGVTZXR0aW5ncygpIGxcdTAwRjZzdCBhbSBFbmRlIHNlbGJzdFxuICAgIC8vIHBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzKCkgYXVzIChzaWVoZSBkb3J0aWdlciBLb21tZW50YXIpLCB3YXMgdS4gYS5cbiAgICAvLyBcdTAwRkNiZXIgcmVnaXN0ZXJUeXBWaWV3IHdpZWRlcnVtIHJlbmRlcigpIGF1ZiBhbGxlbiBUWVAtVmlldy1MZWF2ZXNcbiAgICAvLyBhdWZydWZ0IC0gaW5rbHVzaXZlIGRpZXNlbSwgd1x1MDBFNGhyZW5kIGVzIG5vY2ggbWl0dGVuIGluIGdlbmF1IGRpZXNlbVxuICAgIC8vIEF1ZnJ1ZiBzdGVja3QuIE9obmUgR3VhcmQgcmVrdXJzaWVydCBkYXMgc3luY2hyb24gb2huZSBBYmJydWNoIGJpc1xuICAgIC8vIHp1bSBTdGFjayBPdmVyZmxvdywgYmVpIGplZGVtIFx1MDBENmZmbmVuL1VtYmVuZW5uZW4gZWluZXMgVFlQcy5cbiAgICBpZiAodGhpcy5fcmVuZGVyaW5nKSByZXR1cm47XG4gICAgdGhpcy5fcmVuZGVyaW5nID0gdHJ1ZTtcbiAgICB0cnkge1xuICAgICAgdGhpcy5kZXN0cm95RnJvbnRtYXR0ZXJFZGl0b3IoKTtcbiAgICAgIGlmICh0aGlzLnNlbGVjdGVkVHlwZSAhPT0gbnVsbCkge1xuICAgICAgICB0aGlzLnJlbmRlclR5cGVTZXR0aW5ncyh0aGlzLnNlbGVjdGVkVHlwZSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgICBjb250ZW50RWwuZW1wdHkoKTtcblxuICAgICAgY29uc3QgeyBjb3VudHMsIG5vVHlwZSB9ID0gdGhpcy5wbHVnaW4udHlwSW5kZXgudHlwZUNvdW50cygpO1xuICAgICAgY29uc3QgcmVnaXN0ZXJlZCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVzO1xuICAgICAgY29uc3QgdHlwZUNvbG9ycyA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnM7XG4gICAgICBjb25zdCBzb3J0T3JkZXIgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBTb3J0T3JkZXIgPz8gREVGQVVMVF9TT1JUX09SREVSO1xuICAgICAgY29uc3QgaXNNYW51YWxTb3J0ID0gc29ydE9yZGVyID09PSBcIm1hbnVhbFwiO1xuICAgICAgY29uc3QgYnlDdXJyZW50T3JkZXIgPSAoYSwgYikgPT4gY29tcGFyZVR5cGVzKHNvcnRPcmRlciwgYSwgYiwgY291bnRzLCB0eXBlQ29sb3JzKTtcblxuICAgICAgdGhpcy5yZW5kZXJMaXN0SGVhZGVyKGNvbnRlbnRFbCk7XG5cbiAgICAgIGNvbnN0IHVucmVnaXN0ZXJlZFJvd3MgPSBbLi4uY291bnRzLmtleXMoKV1cbiAgICAgICAgLmZpbHRlcigodHlwZSkgPT4gIXJlZ2lzdGVyZWQuaW5jbHVkZXModHlwZSkpXG4gICAgICAgIC5zb3J0KGJ5Q3VycmVudE9yZGVyKVxuICAgICAgICAubWFwKCh0eXBlKSA9PiAoeyB0eXBlLCBjb3VudDogY291bnRzLmdldCh0eXBlKSA/PyAwIH0pKTtcbiAgICAgIGNvbnN0IHVucmVnaXN0ZXJlZFN1YnR5cGVSb3dzID0gdGhpcy51bnJlZ2lzdGVyZWRTdWJ0eXBlUm93cygpO1xuXG4gICAgICAvLyBPaG5lIHp3ZWl0ZSBTcGFsdGUgZGFyZiBkZXIgTmFtZSBkaWUgZ2FuemUgWmVpbGUgbmVobWVuIChzaWVoZVxuICAgICAgLy8gLmZyZWQtdHlwLWxpc3Qtbm8tc2Vjb25kYXJ5IGluIHN0eWxlcy5jc3MpLlxuICAgICAgY29uc3QgbGlzdENscyA9IFwiZnJlZC10eXAtbGlzdCBuYXYtZmlsZXMtY29udGFpbmVyXCIgKyAodGhpcy5zZWNvbmRhcnlNb2RlKCkgPT09IFwibm9uZVwiID8gXCIgZnJlZC10eXAtbGlzdC1uby1zZWNvbmRhcnlcIiA6IFwiXCIpO1xuICAgICAgdGhpcy5saXN0RWwgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBsaXN0Q2xzIH0pO1xuICAgICAgdGhpcy5zZXBhcmF0b3JFbCA9IG51bGw7XG5cbiAgICAgIC8vIHNvcnRUeXBlc0J5TW9kZSgpIGxcdTAwRTRzc3QgaW0gTWFudWVsbC1Nb2R1cyBiZXd1c3N0IGRpZSBSZWloZW5mb2xnZSB2b25cbiAgICAgIC8vIHBsdWdpbi5zZXR0aW5ncy50eXBlcyB1bmFuZ2V0YXN0ZXQgLSBwZXIgRHJhZyAmIERyb3AgaW5cbiAgICAgIC8vIHJlbmRlclJlZ2lzdGVyZWRJdGVtKCkgdW1zb3J0aWVydC4gRGVyIGluZGV4IHdpcmQgZGFmXHUwMEZDciAxOjEgYWxzXG4gICAgICAvLyBQb3NpdGlvbiBpbiBkaWVzZXIgKGluIGRpZXNlbSBNb2R1cyB1bnZlclx1MDBFNG5kZXJ0ZW4pIFJlaWhlbmZvbGdlXG4gICAgICAvLyB3ZWl0ZXJnZWdlYmVuLlxuICAgICAgY29uc3QgcmVnaXN0ZXJlZE9yZGVyID0gc29ydFR5cGVzQnlNb2RlKHJlZ2lzdGVyZWQsIHNvcnRPcmRlciwgY291bnRzLCB0eXBlQ29sb3JzKTtcbiAgICAgIHJlZ2lzdGVyZWRPcmRlci5mb3JFYWNoKCh0eXBlLCBpbmRleCkgPT4ge1xuICAgICAgICB0aGlzLnJlbmRlclJlZ2lzdGVyZWRJdGVtKHR5cGUsIGNvdW50cy5nZXQodHlwZSkgPz8gMCwgeyBkcmFnZ2FibGU6IGlzTWFudWFsU29ydCwgaW5kZXggfSk7XG4gICAgICB9KTtcblxuICAgICAgLy8gVW50ZXJoYWxiIGRlciBUcmVubmxpbmllIGRyZWkgQWJzY2huaXR0ZSwgamVkZXIgZlx1MDBGQ3Igc2ljaCBvcHRpb25hbDpcbiAgICAgIC8vIG5pY2h0IGVyZmFzc3RlIFRZUGVuLCBuaWNodCBlcmZhc3N0ZSBTdWJ0eXBlbiwgXCJbS0VJTiBUWVBdXCIuIERpZVxuICAgICAgLy8gU3VidHlwZW4gYmVrb21tZW4gZWluZSBlaWdlbmUgVHJlbm5saW5pZSwgd2VpbCBzaWUgbmFjaCBlaW5lciBhbmRlcmVuXG4gICAgICAvLyBSZWdlbCBzb3J0aWVydCBzaW5kIGFscyBkaWUgVFlQZW4gZGFyXHUwMEZDYmVyIChBbnphaGwgc3RhdHQgU29ydGllci1CdXR0b24sXG4gICAgICAvLyBzaWVoZSB1bnJlZ2lzdGVyZWRTdWJ0eXBlUm93cykgLSBvaG5lIHNpY2h0YmFyZW4gU2Nobml0dCBzXHUwMEU0aGUgZGFzIG5hY2hcbiAgICAgIC8vIGthcHV0dGVyIFNvcnRpZXJ1bmcgYXVzLiBcIltLRUlOIFRZUF1cIiBpc3Qga2VpbiBlY2h0ZXIgVHlwLCBuaW1tdCBhblxuICAgICAgLy8ga2VpbmVyIFNvcnRpZXJ1bmcgdGVpbCB1bmQgc3RlaHQgdW5hYmhcdTAwRTRuZ2lnIHZvbiBzZWluZXIgQW56YWhsIHp1bGV0enQ7XG4gICAgICAvLyBlcyBzY2hsaWVcdTAwREZ0IGRpcmVrdCBhbiwgc3RhdHQgZWluZSBkcml0dGUgTGluaWUgenUgYmVrb21tZW4uXG4gICAgICAvL1xuICAgICAgLy8gdGhpcy5zZXBhcmF0b3JFbCBibGVpYnQgYmV3dXNzdCBkaWUgRVJTVEUgTGluaWU6IHN0YXJ0QWRkKCkgaFx1MDBFNG5ndCBkYXNcbiAgICAgIC8vIG5ldWUgVHJlZS1JdGVtIGRhdm9yLCB1bmQgZWluIG5ldWVyIFRZUCBnZWhcdTAwRjZydCBhbnMgRW5kZSBkZXIgZXJmYXNzdGVuLFxuICAgICAgLy8gbmljaHQgendpc2NoZW4gZGllIG5pY2h0IGVyZmFzc3RlbiBBYnNjaG5pdHRlLlxuICAgICAgY29uc3Qgc2VwYXJhdG9yID0gKCkgPT4ge1xuICAgICAgICBjb25zdCBlbCA9IHRoaXMubGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1zZXBhcmF0b3JcIiB9KTtcbiAgICAgICAgdGhpcy5zZXBhcmF0b3JFbCA9IHRoaXMuc2VwYXJhdG9yRWwgPz8gZWw7XG4gICAgICB9O1xuXG4gICAgICBpZiAodW5yZWdpc3RlcmVkUm93cy5sZW5ndGggPiAwIHx8IHVucmVnaXN0ZXJlZFN1YnR5cGVSb3dzLmxlbmd0aCA+IDAgfHwgbm9UeXBlID4gMCkgc2VwYXJhdG9yKCk7XG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiB1bnJlZ2lzdGVyZWRSb3dzKSB0aGlzLnJlbmRlclVucmVnaXN0ZXJlZEl0ZW0ocm93LnR5cGUsIHJvdy5jb3VudCk7XG5cbiAgICAgIGlmICh1bnJlZ2lzdGVyZWRTdWJ0eXBlUm93cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGlmICh1bnJlZ2lzdGVyZWRSb3dzLmxlbmd0aCA+IDApIHNlcGFyYXRvcigpO1xuICAgICAgICBmb3IgKGNvbnN0IHJvdyBvZiB1bnJlZ2lzdGVyZWRTdWJ0eXBlUm93cykgdGhpcy5yZW5kZXJVbnJlZ2lzdGVyZWRTdWJ0eXBlSXRlbShyb3cpO1xuICAgICAgfVxuXG4gICAgICBpZiAobm9UeXBlID4gMCkgdGhpcy5yZW5kZXJOb1R5cGVJdGVtKG5vVHlwZSk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX3JlbmRlcmluZyA9IGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIC8vIFdpZSBkZXIgXCJDaGFuZ2Ugc29ydCBvcmRlclwiLUJ1dHRvbiBpbiBPYnNpZGlhbnMgVGFncy0gYnp3LiBBbGwtUHJvcGVydGllcy1WaWV3LlxuICByZW5kZXJMaXN0SGVhZGVyKGNvbnRlbnRFbCkge1xuICAgIGNvbnN0IGhlYWRlciA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibmF2LWhlYWRlclwiIH0pO1xuICAgIGNvbnN0IGJ1dHRvbnNDb250YWluZXIgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcIm5hdi1idXR0b25zLWNvbnRhaW5lclwiIH0pO1xuXG4gICAgY29uc3QgYWRkQnRuID0gYnV0dG9uc0NvbnRhaW5lci5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIG5hdi1hY3Rpb24tYnV0dG9uXCIsXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIk5ldWVuIFR5cCBoaW56dWZcdTAwRkNnZW5cIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24oYWRkQnRuLCBcInBsdXNcIik7XG4gICAgYWRkQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnN0YXJ0QWRkKCkpO1xuXG4gICAgY29uc3Qgc29ydEJ0biA9IGJ1dHRvbnNDb250YWluZXIuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiBuYXYtYWN0aW9uLWJ1dHRvblwiLFxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJTb3J0aWVycmVpaGVuZm9sZ2UgXHUwMEU0bmRlcm5cIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24oc29ydEJ0biwgXCJsdWNpZGUtc29ydC1hc2NcIik7XG4gICAgc29ydEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB0aGlzLnNob3dTb3J0TWVudShldmVudCkpO1xuXG4gICAgLy8gWndlaXRlIFNwYWx0ZTogYmV3dXNzdCBrZWluIE1lbnVlLCBzb25kZXJuIGVpbiBLbm9wZiwgZGVyIGRpZSBkcmVpIE1vZGlcbiAgICAvLyBkZXIgUmVpaGUgbmFjaCBkdXJjaHNjaGFsdGV0IC0gYmVpIHNvIHdlbmlnZW4gWnVzdGFlbmRlbiwgZGVyZW4gV2lya3VuZ1xuICAgIC8vIGRpcmVrdCBkYXJ1bnRlciBzaWNodGJhciB3aXJkLCBpc3QgRHVyY2hrbGlja2VuIHNjaG5lbGxlciBhbHMgQXVma2xhcHBlblxuICAgIC8vIHVuZCBBdXN3YWVobGVuLiBJY29uIHVuZCBUb29sdGlwIHplaWdlbiBkZW4gYWt0dWVsbGVuIE1vZHVzLlxuICAgIGNvbnN0IGN1cnJlbnQgPSBTRUNPTkRBUllfTU9ERVNbdGhpcy5zZWNvbmRhcnlJbmRleCgpXTtcbiAgICBjb25zdCBzZWNvbmRhcnlCdG4gPSBidXR0b25zQ29udGFpbmVyLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gbmF2LWFjdGlvbi1idXR0b25cIixcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IGBOZWJlbiBkZW0gTmFtZW46ICR7Y3VycmVudC50aXRsZX1gIH0sXG4gICAgfSk7XG4gICAgc2V0SWNvbihzZWNvbmRhcnlCdG4sIGN1cnJlbnQuaWNvbik7XG4gICAgc2Vjb25kYXJ5QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmN5Y2xlU2Vjb25kYXJ5KCkpO1xuICB9XG5cbiAgLy8gc2V0dGluZ3MudHlwTGlzdFNlY29uZGFyeSwgYWJlciBpbW1lciBlaW4gZ3VlbHRpZ2VyIE1vZHVzIC0gQmVzdGFuZHNkYXRlblxuICAvLyBrZW5uZW4gZGVuIFNjaGx1ZXNzZWwgbm9jaCBuaWNodCAoc2llaGUgbWlncmF0ZVR5cExpc3RTZWNvbmRhcnkgaW4gbWFpbi5qcyksXG4gIC8vIHVuZCBlaW4gc3BhZXRlciBlbnRmZXJudGVyIE1vZHVzIHNvbGwgZGllIExpc3RlIG5pY2h0IGxlZXIgbGFzc2VuLlxuICBzZWNvbmRhcnlNb2RlKCkge1xuICAgIGNvbnN0IG1vZGUgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBMaXN0U2Vjb25kYXJ5O1xuICAgIHJldHVybiBTRUNPTkRBUllfTU9ERVMuc29tZSgoZW50cnkpID0+IGVudHJ5Lm1vZGUgPT09IG1vZGUpID8gbW9kZSA6IERFRkFVTFRfU0VDT05EQVJZO1xuICB9XG5cbiAgc2Vjb25kYXJ5SW5kZXgoKSB7XG4gICAgcmV0dXJuIFNFQ09OREFSWV9NT0RFUy5maW5kSW5kZXgoKGVudHJ5KSA9PiBlbnRyeS5tb2RlID09PSB0aGlzLnNlY29uZGFyeU1vZGUoKSk7XG4gIH1cblxuICBhc3luYyBjeWNsZVNlY29uZGFyeSgpIHtcbiAgICBjb25zdCBuZXh0ID0gU0VDT05EQVJZX01PREVTWyh0aGlzLnNlY29uZGFyeUluZGV4KCkgKyAxKSAlIFNFQ09OREFSWV9NT0RFUy5sZW5ndGhdO1xuICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cExpc3RTZWNvbmRhcnkgPSBuZXh0Lm1vZGU7XG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgLy8gV2llIGltIFNvcnRpZXItTWVudWU6IG51ciBuZXUgemVpY2huZW4uIERlciBNb2R1cyBiZXRyaWZmdCBhdXNzY2hsaWVzc2xpY2hcbiAgICAvLyBkaWVzZSBMaXN0ZSwgbmljaHQgZGllIEVpbmZhZXJidW5nIGFuZGVyc3dvIC0gcmVmcmVzaFR5cENvbG9ycyB3YWVyZSBoaWVyXG4gICAgLy8gYWxzbyBudXIgZWluIHVubm9ldGlnZXMgUnVuZHVtLU5ldXplaWNobmVuIGFsbGVyIEFuc2ljaHRlbi5cbiAgICB0aGlzLnJlbmRlcigpO1xuICB9XG5cbiAgc2hvd1NvcnRNZW51KGV2ZW50KSB7XG4gICAgY29uc3QgY3VycmVudCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cFNvcnRPcmRlciA/PyBERUZBVUxUX1NPUlRfT1JERVI7XG4gICAgY29uc3QgbWVudSA9IG5ldyBNZW51KCk7XG5cbiAgICBjb25zdCBhZGRHcm91cCA9IChzdGFydCwgZW5kKSA9PiB7XG4gICAgICBmb3IgKGxldCBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgICAgICBjb25zdCB7IG1vZGUsIHRpdGxlIH0gPSBTT1JUX09QVElPTlNbaV07XG4gICAgICAgIG1lbnUuYWRkSXRlbSgoaXRlbSkgPT5cbiAgICAgICAgICBpdGVtXG4gICAgICAgICAgICAuc2V0VGl0bGUodGl0bGUpXG4gICAgICAgICAgICAuc2V0Q2hlY2tlZChjdXJyZW50ID09PSBtb2RlKVxuICAgICAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBTb3J0T3JkZXIgPSBtb2RlO1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfTtcblxuICAgIGFkZEdyb3VwKDAsIDEpO1xuICAgIG1lbnUuYWRkU2VwYXJhdG9yKCk7XG4gICAgYWRkR3JvdXAoMSwgMyk7XG4gICAgbWVudS5hZGRTZXBhcmF0b3IoKTtcbiAgICBhZGRHcm91cCgzLCA1KTtcbiAgICBtZW51LmFkZFNlcGFyYXRvcigpO1xuICAgIGFkZEdyb3VwKDUsIDcpO1xuXG4gICAgbWVudS5zaG93QXRNb3VzZUV2ZW50KGV2ZW50KTtcbiAgfVxuXG4gIHJlbmRlck5vVHlwZUl0ZW0oY291bnQpIHtcbiAgICBjb25zdCB0cmVlSXRlbSA9IHRoaXMubGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW1cIiB9KTtcbiAgICBjb25zdCBzZWxmID0gdHJlZUl0ZW0uY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1zZWxmIGlzLWNsaWNrYWJsZSBmcmVkLXR5cC11bnJlZ2lzdGVyZWRcIiB9KTtcbiAgICBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0taW5uZXJcIiwgdGV4dDogXCJbS0VJTiBUWVBdXCIgfSk7XG4gICAgdGhpcy5yZW5kZXJDb3VudEZsYWlyKHNlbGYsIGNvdW50KTtcblxuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMub3BlblNlYXJjaChudWxsKSk7XG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY29udGV4dG1lbnVcIiwgKGV2ZW50KSA9PiB7XG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICB0aGlzLm9wZW5TZWFyY2gobnVsbCk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBDaHJvbWl1bXMgaW5wdXRbdHlwZT1jb2xvcl0gaGF0IGVpbmVuIGVpZ2VuZW4gTWluZGVzdC1Td2F0Y2gsIGRlciBzaWNoIG5pY2h0XG4gIC8vIHVudGVyIFRleHRnclx1MDBGNlx1MDBERmUgc2thbGllcmVuIGxcdTAwRTRzc3QgLSBkYWhlciBudXIgYWxzIHVuc2ljaHRiYXJlbiBQaWNrZXItVHJpZ2dlclxuICAvLyBcdTAwRkNiZXIgZGVtIGZyZWkgc2thbGllcmJhcmVuIFB1bmt0IHBsYXR6aWVyZW4uIE9obmUgZWlnZW5lIEZhcmJlIHN0ZWh0IGRlclxuICAvLyBQdW5rdCBhbHMgaG9obGVyIGdyYXVlciBSaW5nIGRhIChzaWVoZSBwYWludENvbG9yRG90KTsgbWl0IHNob3dSZXNldFxuICAvLyAoRGV0YWlsYW5zaWNodCkgbmVubnQgZWluIFRvb2x0aXAgZGVuIFp1c3RhbmQsIHVuZCBkZXIgWnVyXHUwMEZDY2tzZXR6ZW4tQnV0dG9uXG4gIC8vIGlzdCBkYW5uIGF1c2dlZ3JhdXQuXG4gIHJlbmRlckNvbG9yUGlja2VyKHBhcmVudCwgdHlwZSwgb25DaGFuZ2UsIHsgc2hvd1Jlc2V0ID0gZmFsc2UgfSA9IHt9KSB7XG4gICAgY29uc3QgY3VycmVudENvbG9yID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXSA/PyBERUZBVUxUX1RZUEVfQ09MT1I7XG4gICAgY29uc3QgY29sb3JXcmFwID0gcGFyZW50LmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1jb2xvci13cmFwXCIgfSk7XG4gICAgY29uc3QgY29sb3JEb3QgPSBjb2xvcldyYXAuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWNvbG9yLWRvdFwiIH0pO1xuICAgIGxldCByZXNldEJ0biA9IG51bGw7XG4gICAgY29uc3Qgc2hvd1N0YXRlID0gKGNvbG9yLCBpc0RlZmF1bHQpID0+IHtcbiAgICAgIHBhaW50Q29sb3JEb3QoY29sb3JEb3QsIGNvbG9yLCBpc0RlZmF1bHQpO1xuICAgICAgaWYgKCFzaG93UmVzZXQpIHJldHVybjtcbiAgICAgIGNvbG9yV3JhcC5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIGlzRGVmYXVsdCA/IFwiU3RhbmRhcmQgKGtlaW5lIEZhcmJlKVwiIDogXCJGYXJiZSBcdTAwRTRuZGVyblwiKTtcbiAgICAgIHJlc2V0QnRuPy50b2dnbGVDbGFzcyhcImlzLWRpc2FibGVkXCIsIGlzRGVmYXVsdCk7XG4gICAgfTtcblxuICAgIGNvbnN0IGNvbG9ySW5wdXQgPSBjb2xvcldyYXAuY3JlYXRlRWwoXCJpbnB1dFwiLCB7IHR5cGU6IFwiY29sb3JcIiwgY2xzOiBcImZyZWQtdHlwLWNvbG9yLWlucHV0XCIgfSk7XG4gICAgY29sb3JJbnB1dC52YWx1ZSA9IGN1cnJlbnRDb2xvcjtcbiAgICBjb2xvcklucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpKTtcblxuICAgIC8vIFwiaW5wdXRcIiBmZXVlcnQgYmVpIGplZGVyIFp3aXNjaGVuZmFyYmUsIHdcdTAwRTRocmVuZCBkZXIgbmF0aXZlIFBpY2tlciBub2NoXG4gICAgLy8gb2ZmZW4gaXN0IC0gaGllciBudXIgbG9rYWxlIFZvcnNjaGF1IChQdW5rdCwgZ2dmLiBOYW1lIHZpYSBvbkNoYW5nZSksIG9obmVcbiAgICAvLyBkaWUgXHUwMEZDYnJpZ2VuIFZpZXdzIChEYXRlaS1FeHBsb3JlciwgR3JhcGgsIC4uLikgbmV1IHp1IHJlbmRlcm46XG4gICAgLy8gcmVmcmVzaFR5cENvbG9ycygpIGxcdTAwRjZzdCBkYWZcdTAwRkNyIHUuIGEuIHJlbmRlcigpIGF1ZiBkaWVzZXIgVFlQLVZpZXcgc2VsYnN0XG4gICAgLy8gYXVzLCB3YXMgZGllc2VzIDxpbnB1dCB0eXBlPWNvbG9yPiBhdXMgZGVtIERPTSBlbnRmZXJuZW4gdW5kIGRlbiBuYXRpdmVuXG4gICAgLy8gUGlja2VyIGRhbWl0IHNvZm9ydCBzY2hsaWVcdTAwREZlbiB3XHUwMEZDcmRlIC0gbm9jaCBiZXZvciBtYW4gXHUwMEZDYmVyaGF1cHQgZWluZSBGYXJiZVxuICAgIC8vIGF1c3dcdTAwRTRobGVuIGthbm4gKHNjaG9uIGJlaW0gZXJzdGVuIEtsaWNrLCB2b3IgZGVtIExvc2xhc3NlbiBkZXIgVGFzdGUpLlxuICAgIGNvbG9ySW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImlucHV0XCIsIGFzeW5jICgpID0+IHtcbiAgICAgIHNob3dTdGF0ZShjb2xvcklucHV0LnZhbHVlLCBmYWxzZSk7XG4gICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdID0gY29sb3JJbnB1dC52YWx1ZTtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgb25DaGFuZ2U/Lihjb2xvcklucHV0LnZhbHVlKTtcbiAgICB9KTtcblxuICAgIC8vIEVyc3Qgd2VubiBkaWUgQXVzd2FobCBiZXN0XHUwMEU0dGlndCB1bmQgZGVyIG5hdGl2ZSBQaWNrZXIgZGFkdXJjaCBnZXNjaGxvc3NlblxuICAgIC8vIHdpcmQsIGRpZSBcdTAwRkNicmlnZW4gVmlld3MgbmFjaHppZWhlbiAtIGFuIGRlbSBQdW5rdCBrYW5uIGVpbiBOZXUtUmVuZGVyblxuICAgIC8vIGRpZXNlciBUWVAtVmlldyBzZWxic3QgbmljaHRzIG1laHIga2FwdXR0IG1hY2hlbi5cbiAgICBjb2xvcklucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgKCkgPT4gdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCkpO1xuXG4gICAgaWYgKHNob3dSZXNldCkge1xuICAgICAgcmVzZXRCdG4gPSBwYXJlbnQuY3JlYXRlRGl2KHtcbiAgICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWNvbG9yLXJlc2V0XCIsXG4gICAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiRmFyYmUgenVyXHUwMEZDY2tzZXR6ZW5cIiB9LFxuICAgICAgfSk7XG4gICAgICBzZXRJY29uKHJlc2V0QnRuLCBcInJvdGF0ZS1jY3dcIik7XG4gICAgICByZXNldEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXTtcbiAgICAgICAgY29sb3JJbnB1dC52YWx1ZSA9IERFRkFVTFRfVFlQRV9DT0xPUjtcbiAgICAgICAgc2hvd1N0YXRlKERFRkFVTFRfVFlQRV9DT0xPUiwgdHJ1ZSk7XG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgICAgb25DaGFuZ2U/LihERUZBVUxUX1RZUEVfQ09MT1IpO1xuICAgICAgfSk7XG4gICAgfVxuICAgIHNob3dTdGF0ZShjdXJyZW50Q29sb3IsIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV0gPT09IHVuZGVmaW5lZCk7XG5cbiAgICByZXR1cm4gY29sb3JXcmFwO1xuICB9XG5cbiAgLy8gRlx1MDBFNG5ndCBCZXN0YW5kc2luc3RhbGxhdGlvbmVuIGFiLCBkZXJlbiBzZXR0aW5ncy1PYmpla3Qgc2Nob24gdm9yIEVpbmZcdTAwRkNocnVuZ1xuICAvLyB2b24gdHlwZU1hbnVhbCBnZWxhZGVuIHd1cmRlICh6LiBCLiBsYXVmZW5kZSBTZXNzaW9uIHZvciBlaW5lbSB2b2xsc3RcdTAwRTRuZGlnZW5cbiAgLy8gUGx1Z2luLVJlbG9hZCBuYWNoIEhvdC1SZWxvYWQpIC0gb2huZSBkYXMgd1x1MDBGQ3JkZSBqZWRlciBadWdyaWZmIHVudGVuIG1pdFxuICAvLyBcIkNhbm5vdCByZWFkIHByb3BlcnRpZXMgb2YgdW5kZWZpbmVkXCIgYWJicmVjaGVuIHVuZCBkYWJlaSBkZW4gZ2VzYW10ZW5cbiAgLy8gcmVzdGxpY2hlbiByZW5kZXJUeXBlU2V0dGluZ3MoKS1BdWZydWYgKEZhcmJlLCBCZXNjaHJlaWJ1bmcsIEZyb250bWF0dGVyKVxuICAvLyBtaXQgc2ljaCByZWlcdTAwREZlbiwgZGEgZGVyIEZlaGxlciBzeW5jaHJvbiBtaXR0ZW4gaW4gZGVyIEZ1bmt0aW9uIGF1ZnRyaXR0LlxuICBlbnN1cmVUeXBlTWFudWFsKCkge1xuICAgIGlmICghdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZU1hbnVhbCkgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZU1hbnVhbCA9IHt9O1xuICAgIHJldHVybiB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlTWFudWFsO1xuICB9XG5cbiAgLy8gR2VtZWluc2FtZXIgXCJNYW51ZWxsIGVyc3RlbGxiYXJcIi1Lbm9wZiB2b24gVFlQIChyZW5kZXJNYW51YWxUb2dnbGUpIHVuZFxuICAvLyBTdWJ0eXAgKHJlbmRlclN1YnR5cGVNYW51YWxUb2dnbGUpLCBqZXdlaWxzIHp3aXNjaGVuIFVtYmVuZW5uZW4gdW5kXG4gIC8vIExcdTAwRjZzY2hlbjogZWluIEljb24tS25vcGYgc3RhdHQgZWluZXMgYmVzY2hyaWZ0ZXRlbiBTY2hhbHRlcnMgLSBkaWVcbiAgLy8gRWluc3RlbGx1bmcgaXN0IHp1IGtsZWluLCB1bSBtaXQgTGFiZWwgdW5kIFRvZ2dsZSBlaW5lIGVpZ2VuZSBaZWlsZSB6dVxuICAvLyBiZWtvbW1lbiwgdW5kIGluIGRlciBSZWloZSBkZXIgXHUwMEZDYnJpZ2VuIEljb24tS25cdTAwRjZwZmUgZlx1MDBFNGxsdCBzaWUgbmljaHQgbWVoclxuICAvLyBhdWYgYWxzIGRpZXNlLiBadXN0YW5kIHdpZSBiZWkgaWhuZW4gXHUwMEZDYmVyIGVpbmUgS2xhc3NlIChpcy1hY3RpdmUsIHNpZWhlXG4gIC8vIHN0eWxlcy5jc3MpLCBkZXIgU2lubiBzdGVodCBpbSBUb29sdGlwIC0gcm9sZS9hcmlhLWNoZWNrZWQgaGFsdGVuIGloblxuICAvLyB0cm90emRlbSBhbHMgU2NoYWx0ZXIgbGVzYmFyLlxuICAvL1xuICAvLyBvblRvZ2dsZSBiZWtvbW10IGRlbiBuZXVlbiBadXN0YW5kLCBzcGVpY2hlcnQgaWhuIHVuZCB6aWVodCBkaWUgYWJoXHUwMEU0bmdpZ2VuXG4gIC8vIEtuXHUwMEY2cGZlIG5hY2ggKHNpZWhlIHN5bmNNYW51YWxUb2dnbGVzKSAtIGRhcyBBbnplaWdlbiBcdTAwRkNiZXJuaW1tdCBiZXd1c3N0XG4gIC8vIG5pY2h0IGRlciBLbGljayBzZWxic3QsIGRhIGVpbmUgVW1zY2hhbHR1bmcgaGllciBuaWUgbnVyIGRpZXNlbiBlaW5lblxuICAvLyBLbm9wZiBiZXRyaWZmdC5cbiAgcmVuZGVyTWFudWFsSWNvbihwYXJlbnQsIGNscywgaXNPbiwgb25Ub2dnbGUpIHtcbiAgICBjb25zdCBidG4gPSBwYXJlbnQuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogYGNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLW1hbnVhbC1pY29uICR7Y2xzfWAsXG4gICAgICBhdHRyOiB7IHRhYmluZGV4OiBcIjBcIiwgcm9sZTogXCJjaGVja2JveFwiIH0sXG4gICAgfSk7XG4gICAgc2V0SWNvbihidG4sIFwiZmlsZS1wZW4tbGluZVwiKTtcblxuICAgIGJ0bi5mcmVkU2hvd01hbnVhbFN0YXRlID0gKG9uKSA9PiB7XG4gICAgICBidG4udG9nZ2xlQ2xhc3MoXCJpcy1hY3RpdmVcIiwgb24pO1xuICAgICAgYnRuLnNldEF0dHJpYnV0ZShcImFyaWEtY2hlY2tlZFwiLCBTdHJpbmcob24pKTtcbiAgICAgIGJ0bi5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIG9uID8gXCJNYW51ZWxsIGVyc3RlbGxiYXJcIiA6IFwiTmljaHQgbWFudWVsbCBlcnN0ZWxsYmFyXCIpO1xuICAgIH07XG4gICAgYnRuLmZyZWRTaG93TWFudWFsU3RhdGUoaXNPbik7XG5cbiAgICBjb25zdCB0b2dnbGUgPSAoKSA9PiBvblRvZ2dsZSghYnRuLmhhc0NsYXNzKFwiaXMtYWN0aXZlXCIpKTtcbiAgICBidG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIHRvZ2dsZSk7XG4gICAgYnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIChldmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmtleSA9PT0gXCJFbnRlclwiIHx8IGV2ZW50LmtleSA9PT0gXCIgXCIpIHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgdG9nZ2xlKCk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gYnRuO1xuICB9XG5cbiAgLy8gXCJNYW51ZWxsIGVyc3RlbGxiYXJcIiBkZXMgVFlQcywgaW4gZGVyIEtvcGZ6ZWlsZSBkZXIgRGV0YWlsYW5zaWNodCB6d2lzY2hlblxuICAvLyBVbWJlbmVubmVuIHVuZCBMXHUwMEY2c2NoZW4uXG4gIC8vXG4gIC8vIFN0YW5kYXJkbVx1MDBFNFx1MDBERmlnIGFuIC0gZGFoZXIgd2lyZCAod2llIGJlaSBkZW4gYW5kZXJlbiB0eXBlWHh4LURpY3RzKSBudXIgZGllXG4gIC8vIEFid2VpY2h1bmcgdm9tIERlZmF1bHQgZ2VzcGVpY2hlcnQsIGhpZXIgYWxzbyBudXIgXCJhdXNcIiAoZmFsc2UpOyBmZWhsZW5kZXJcbiAgLy8gRWludHJhZyBiencuIHRydWUgYmVkZXV0ZW4gXCJhblwiLiBTdGV1ZXJ0LCBvYiBlaW4gVFlQIGluIGdldFR5cGVzKCkgKHNpZWhlXG4gIC8vIG1haW4uanMpIGV4cG9ydGllcnQgd2lyZCwgc2llaGUgZG9ydGlnZXIgS29tbWVudGFyLlxuICAvL1xuICAvLyBEZXIgVFlQIHppZWh0IHNlaW5lIFN1YnR5cGVuIGRhYmVpIGltbWVyIG1pdDogZGVyIFBpY2tlciBmXHUwMEZDaHJ0IG51ciBcdTAwRkNiZXJcbiAgLy8gaWhuIHp1IGlobmVuLCBlaW4gYWJnZXNjaGFsdGV0ZXIgVFlQIHdcdTAwRkNyZGUgc2VpbmUgYW5nZXNjaGFsdGV0ZW4gU3VidHlwZW5cbiAgLy8gYWxzbyBzdHVtbSB1bmVycmVpY2hiYXIgbWFjaGVuIChzaWVoZSBzZXRBbGxTdWJ0eXBlc01hbnVhbCBpbiBzdWJ0eXBlcy5qcykuXG4gIHJlbmRlck1hbnVhbFRvZ2dsZShwYXJlbnQsIHR5cGUpIHtcbiAgICByZXR1cm4gdGhpcy5yZW5kZXJNYW51YWxJY29uKHBhcmVudCwgXCJmcmVkLXR5cC1tYW51YWwtdHlwZVwiLCB0aGlzLmVuc3VyZVR5cGVNYW51YWwoKVt0eXBlXSAhPT0gZmFsc2UsIGFzeW5jIChvbikgPT4ge1xuICAgICAgaWYgKG9uKSBkZWxldGUgdGhpcy5lbnN1cmVUeXBlTWFudWFsKClbdHlwZV07XG4gICAgICBlbHNlIHRoaXMuZW5zdXJlVHlwZU1hbnVhbCgpW3R5cGVdID0gZmFsc2U7XG4gICAgICBzZXRBbGxTdWJ0eXBlc01hbnVhbCh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgb24pO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICB0aGlzLnN5bmNNYW51YWxUb2dnbGVzKHR5cGUpO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gXCJNYW51ZWxsIGVyc3RlbGxiYXJcIiBlaW5lcyBTdWJ0eXBzLCBpbiBkZW4gQWt0aW9uZW4gaW0gQWJzY2hsdXNzIHNlaW5lc1xuICAvLyBCbG9ja3Mgendpc2NoZW4gVW1iZW5lbm5lbiB1bmQgTFx1MDBGNnNjaGVuIChzaWVoZSByZW5kZXJTZWN0aW9uRm9vdGVyKS4gQW5kZXJzXG4gIC8vIGFscyBkZXIgVFlQLUtub3BmIHppZWh0IGVyIG51ciBpbiBlaW5lIFJpY2h0dW5nIG1pdDogZWluIGFuZ2VzY2hhbHRldGVyIFN1YnR5cCBzY2hhbHRldCBzZWluZW4gVFlQIG1pdFxuICAvLyBhbiAoc29uc3Qgd1x1MDBFNHJlIGVyIGltIFBpY2tlciBuaWNodCB6dSBlcnJlaWNoZW4pLCBkaWUgXHUwMEZDYnJpZ2VuIFN1YnR5cGVuXG4gIC8vIGJsZWliZW4gYWJlciwgd2llIHNpZSBzaW5kIC0gZ2VuYXUgZGFmXHUwMEZDciBpc3QgZGVyIEtub3BmIGRhLlxuICByZW5kZXJTdWJ0eXBlTWFudWFsVG9nZ2xlKHBhcmVudCwgdHlwZSwgc3VidHlwZSkge1xuICAgIGNvbnN0IGJ0biA9IHRoaXMucmVuZGVyTWFudWFsSWNvbihcbiAgICAgIHBhcmVudCxcbiAgICAgIFwiZnJlZC10eXAtbWFudWFsLXN1YnR5cGVcIixcbiAgICAgIGlzU3VidHlwZU1hbnVhbCh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSksXG4gICAgICBhc3luYyAob24pID0+IHtcbiAgICAgICAgc2V0U3VidHlwZU1hbnVhbCh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSwgb24pO1xuICAgICAgICBpZiAob24pIGRlbGV0ZSB0aGlzLmVuc3VyZVR5cGVNYW51YWwoKVt0eXBlXTtcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIHRoaXMuc3luY01hbnVhbFRvZ2dsZXModHlwZSk7XG4gICAgICB9XG4gICAgKTtcbiAgICBidG4uZnJlZFN1YnR5cGUgPSBzdWJ0eXBlO1xuICAgIHJldHVybiBidG47XG4gIH1cblxuICAvLyBaZWlndCBhbGxlIE1hbnVlbGwtS25cdTAwRjZwZmUgZGVyIERldGFpbGFuc2ljaHQgbmV1IGFuLCBuYWNoZGVtIGVpbmVyIHZvbiBpaG5lblxuICAvLyBkaWUgYW5kZXJlbiBtaXRnZXpvZ2VuIGhhdC4gQmV3dXNzdCBudXIgZGllIEtuXHUwMEY2cGZlIHN0YXR0IGVpbmVzIHJlbmRlcigpOlxuICAvLyBlaW4gTmV1YXVmYmF1IG5pbW10IGRpZSBGcm9udG1hdHRlci1FZGl0b3JlbiBhbGxlciBCbFx1MDBGNmNrZSBtaXQgKHNpZWhlXG4gIC8vIGRlc3Ryb3lGcm9udG1hdHRlckVkaXRvciksIHNhbXQgZWluZXIgZ2VyYWRlIGJlYXJiZWl0ZXRlbiBaZWlsZSwgb2J3b2hsXG4gIC8vIHNpY2ggYW4gaWhuZW4gbmljaHRzIGdlXHUwMEU0bmRlcnQgaGF0LiBHZWZ1bmRlbiB3ZXJkZW4gZGllIEtuXHUwMEY2cGZlIHdpZSBkaWVcbiAgLy8gRmFyYnB1bmt0ZSBkZXIgU3VidHlwLUJsXHUwMEY2Y2tlIFx1MDBGQ2JlciBkYXMgRE9NIGRlciBBbnNpY2h0IChzaWVoZVxuICAvLyBvcGVuU3VidHlwZUNvbG9yUG9wb3Zlcik6IGRlbiBBYnNjaGx1c3MgZWluZXMgQmxvY2tzIGJhdXRcbiAgLy8gZnJvbnRtYXR0ZXItYmxvY2tzLmpzIGF1ZiwgZWluZSBMaXN0ZSBkYXZvbiBsaWVndCBoaWVyIG5pY2h0LlxuICBzeW5jTWFudWFsVG9nZ2xlcyh0eXBlKSB7XG4gICAgdGhpcy5jb250ZW50RWwucXVlcnlTZWxlY3RvcihcIi5mcmVkLXR5cC1tYW51YWwtdHlwZVwiKT8uZnJlZFNob3dNYW51YWxTdGF0ZSh0aGlzLmVuc3VyZVR5cGVNYW51YWwoKVt0eXBlXSAhPT0gZmFsc2UpO1xuICAgIGZvciAoY29uc3QgZWwgb2YgdGhpcy5jb250ZW50RWwucXVlcnlTZWxlY3RvckFsbChcIi5mcmVkLXR5cC1tYW51YWwtc3VidHlwZVwiKSkge1xuICAgICAgZWwuZnJlZFNob3dNYW51YWxTdGF0ZShpc1N1YnR5cGVNYW51YWwodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUsIGVsLmZyZWRTdWJ0eXBlKSk7XG4gICAgfVxuICB9XG5cbiAgcmVuZGVyUmVnaXN0ZXJlZEl0ZW0odHlwZSwgY291bnQsIHsgZHJhZ2dhYmxlID0gZmFsc2UsIGluZGV4ID0gLTEgfSA9IHt9KSB7XG4gICAgY29uc3QgdHJlZUl0ZW0gPSB0aGlzLmxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtXCIgfSk7XG4gICAgY29uc3Qgc2VsZiA9IHRyZWVJdGVtLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0tc2VsZiBpcy1jbGlja2FibGVcIiB9KTtcblxuICAgIGxldCBuYW1lRWw7XG4gICAgdGhpcy5yZW5kZXJDb2xvclBpY2tlcihzZWxmLCB0eXBlLCAobmV3Q29sb3IpID0+IHtcbiAgICAgIGlmIChuYW1lRWwgJiYgdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0KSBuYW1lRWwuc3R5bGUuY29sb3IgPSBuZXdDb2xvcjtcbiAgICB9KTtcblxuICAgIG5hbWVFbCA9IHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1pbm5lclwiLCB0ZXh0OiB0eXBlIH0pO1xuICAgIGNvbnN0IGNvbG9yID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0ID8gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXSA6IG51bGw7XG4gICAgaWYgKGNvbG9yKSBuYW1lRWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcblxuICAgIC8vIFp3ZWl0ZSBTcGFsdGUsIHVtZ2VzY2hhbHRldCB1ZWJlciBkZW4gS25vcGYgaW0gTGlzdGVuLUhlYWRlciAoc2llaGVcbiAgICAvLyBTRUNPTkRBUllfTU9ERVMgdW5kIGN5Y2xlU2Vjb25kYXJ5KS5cbiAgICBjb25zdCBzZWNvbmRhcnkgPSB0aGlzLnNlY29uZGFyeU1vZGUoKTtcbiAgICBpZiAoc2Vjb25kYXJ5ID09PSBcImRlc2NyaXB0aW9uXCIpIHRoaXMucmVuZGVyRGVzY3JpcHRpb25JbnB1dChzZWxmLCB0eXBlKTtcbiAgICBlbHNlIGlmIChzZWNvbmRhcnkgPT09IFwic3VidHlwZXNcIikgdGhpcy5yZW5kZXJTdWJ0eXBlUHJldmlldyhzZWxmLCB0eXBlKTtcblxuICAgIHRoaXMucmVuZGVyQ291bnRGbGFpcihzZWxmLCBjb3VudCk7XG5cbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5pc0VkaXRpbmcpIHJldHVybjtcbiAgICAgIHRoaXMub3BlblR5cGVTZXR0aW5ncyh0eXBlKTtcbiAgICB9KTtcbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHRoaXMub3BlblNlYXJjaCh0eXBlKTtcbiAgICB9KTtcblxuICAgIC8vIE51ciBpbSBNYW51ZWxsLVNvcnRpZXJtb2R1cyBha3RpdiAoc2llaGUgcmVuZGVyKCkpIC0gZGllIGdhbnplIFplaWxlIGlzdFxuICAgIC8vIGRhbm4gcGVyIERyYWcgJiBEcm9wIHZlcnNjaGllYmJhciAoZWluIERyYWcsIGRlciBhdWYgZGVtIEZhcmJwdW5rdCBvZGVyXG4gICAgLy8gaW0gQmVzY2hyZWlidW5nc2ZlbGQgYmVnaW5udCwgZ3JlaWZ0IHRyb3R6ZGVtIG5pY2h0IC0gZGllc2UgRWxlbWVudGVcbiAgICAvLyBuZWhtZW4gZGVuIE1vdXNlZG93biBzZWxic3QgZlx1MDBGQ3IgRmFyYi0vVGV4dGF1c3dhaGwpLiBWZXJzY2hvYmVuIHdpcmRcbiAgICAvLyBkaXJla3QgaW4gcGx1Z2luLnNldHRpbmdzLnR5cGVzIC0gZGllc2VsYmUgTGlzdGUsIGRpZSBpbSBNYW51ZWxsLU1vZHVzXG4gICAgLy8gdW5zb3J0aWVydCBhbHMgQW56ZWlnZXJlaWhlbmZvbGdlIGRpZW50IChzaWVoZSByZW5kZXIoKSkuXG4gICAgaWYgKGRyYWdnYWJsZSkge1xuICAgICAgc2VsZi5kcmFnZ2FibGUgPSB0cnVlO1xuICAgICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ3N0YXJ0XCIsIChldmVudCkgPT4ge1xuICAgICAgICBldmVudC5kYXRhVHJhbnNmZXIuZWZmZWN0QWxsb3dlZCA9IFwibW92ZVwiO1xuICAgICAgICBldmVudC5kYXRhVHJhbnNmZXIuc2V0RGF0YShcInRleHQvcGxhaW5cIiwgU3RyaW5nKGluZGV4KSk7XG4gICAgICAgIHNlbGYuY2xhc3NMaXN0LmFkZChcImlzLWRyYWdnaW5nXCIpO1xuICAgICAgfSk7XG4gICAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnZW5kXCIsICgpID0+IHNlbGYuY2xhc3NMaXN0LnJlbW92ZShcImlzLWRyYWdnaW5nXCIpKTtcbiAgICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdvdmVyXCIsIChldmVudCkgPT4ge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBjb25zdCByZWN0ID0gc2VsZi5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgICAgY29uc3QgaXNBZnRlciA9IGV2ZW50LmNsaWVudFkgLSByZWN0LnRvcCA+IHJlY3QuaGVpZ2h0IC8gMjtcbiAgICAgICAgc2VsZi5jbGFzc0xpc3QudG9nZ2xlKFwiaXMtZHJvcC1iZWZvcmVcIiwgIWlzQWZ0ZXIpO1xuICAgICAgICBzZWxmLmNsYXNzTGlzdC50b2dnbGUoXCJpcy1kcm9wLWFmdGVyXCIsIGlzQWZ0ZXIpO1xuICAgICAgfSk7XG4gICAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnbGVhdmVcIiwgKCkgPT4gc2VsZi5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJvcC1iZWZvcmVcIiwgXCJpcy1kcm9wLWFmdGVyXCIpKTtcbiAgICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImRyb3BcIiwgYXN5bmMgKGV2ZW50KSA9PiB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGNvbnN0IGlzQWZ0ZXIgPSBzZWxmLmNsYXNzTGlzdC5jb250YWlucyhcImlzLWRyb3AtYWZ0ZXJcIik7XG4gICAgICAgIHNlbGYuY2xhc3NMaXN0LnJlbW92ZShcImlzLWRyb3AtYmVmb3JlXCIsIFwiaXMtZHJvcC1hZnRlclwiKTtcblxuICAgICAgICBjb25zdCBmcm9tSW5kZXggPSBOdW1iZXIoZXZlbnQuZGF0YVRyYW5zZmVyLmdldERhdGEoXCJ0ZXh0L3BsYWluXCIpKTtcbiAgICAgICAgaWYgKE51bWJlci5pc05hTihmcm9tSW5kZXgpIHx8IGZyb21JbmRleCA9PT0gaW5kZXgpIHJldHVybjtcblxuICAgICAgICBsZXQgaW5zZXJ0QmVmb3JlID0gaXNBZnRlciA/IGluZGV4ICsgMSA6IGluZGV4O1xuICAgICAgICBpZiAoZnJvbUluZGV4IDwgaW5zZXJ0QmVmb3JlKSBpbnNlcnRCZWZvcmUgLT0gMTtcblxuICAgICAgICBjb25zdCB0eXBlcyA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVzO1xuICAgICAgICBjb25zdCBbbW92ZWRdID0gdHlwZXMuc3BsaWNlKGZyb21JbmRleCwgMSk7XG4gICAgICAgIHR5cGVzLnNwbGljZShpbnNlcnRCZWZvcmUsIDAsIG1vdmVkKTtcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICAvLyBFY2h0ZXMgVGV4dC1JbnB1dCBzdGF0dCBudXIgQW56ZWlnZTogZGllIEJlc2NocmVpYnVuZyBpc3QgZGlyZWt0IGluIGRlclxuICAvLyBMaXN0ZSBiZWFyYmVpdGJhciwgb2huZSBkYWZcdTAwRkNyIGVyc3QgZGllIERldGFpbGFuc2ljaHQgXHUwMEY2ZmZuZW4genUgbVx1MDBGQ3NzZW4uXG4gIC8vIGNsaWNrIGhpZXIgbXVzcyBkaWUgWmVpbGUgc2VsYnN0IGdlemllbHQgTklDSFQgYXVzbFx1MDBGNnNlblxuICAvLyAoc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgLi4uKSBpbiByZW5kZXJSZWdpc3RlcmVkSXRlbSBcdTAwRjZmZm5ldCBzb25zdFxuICAvLyBkaWUgRGV0YWlsYW5zaWNodCksIGRhaGVyIHN0b3BQcm9wYWdhdGlvbi5cbiAgcmVuZGVyRGVzY3JpcHRpb25JbnB1dChzZWxmLCB0eXBlKSB7XG4gICAgY29uc3QgZGVzY0lucHV0ID0gc2VsZi5jcmVhdGVFbChcImlucHV0XCIsIHtcbiAgICAgIHR5cGU6IFwidGV4dFwiLFxuICAgICAgY2xzOiBcImZyZWQtdHlwLWxpc3QtZGVzY3JpcHRpb24taW5wdXRcIixcbiAgICB9KTtcbiAgICBkZXNjSW5wdXQudmFsdWUgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3R5cGVdID8/IFwiXCI7XG4gICAgZGVzY0lucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpKTtcbiAgICBkZXNjSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB2YWx1ZSA9IGRlc2NJbnB1dC52YWx1ZS50cmltKCk7XG4gICAgICBpZiAodmFsdWUpIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV0gPSB2YWx1ZTtcbiAgICAgIGVsc2UgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV07XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIFwiKFN1YnR5cCAxLCBTdWJ0eXAgMilcIiBzdGF0dCBkZXIgQmVzY2hyZWlidW5nIC0gZGllc2VsYmUgRGFyc3RlbGx1bmcgd2llXG4gIC8vIGRpZSBTdWJ0eXAtVm9yc2NoYXUgaW0gc2VwYXJhdGVuIFRZUC1QaWNrZXIgKHJlbmRlclN1YnR5cGVQcmV2aWV3IGluXG4gIC8vIHR5cGUtcGlja2VyLmpzLCBnZW1laW5zYW1lIEZhcmJncnVuZGxhZ2UgbmFtZUNvbG9yIGluIHR5cGUtY29sb3JzLmpzKTpcbiAgLy8gS2xhbW1lcm4gdW5kIEtvbW1hcyBtdXRlZCwgamVkZXIgTmFtZSBpbiBzZWluZXIgZWlnZW5lbiBTdWJ0eXAtRmFyYmU7IG9obmVcbiAgLy8gXCJUWVAgVmlldyBlaW5mXHUwMEU0cmJlblwiIGJsZWlidCBkaWUgVm9yc2NoYXUgd2llIGRlciBUWVAtTmFtZSBzZWxic3QgdW5nZWZcdTAwRTRyYnQsXG4gIC8vIHVuZCBvaG5lIGRlc3NlbiBVbnRlci1TY2hhbHRlciBcIlN1YnR5cFwiIHN0ZWhlbiBhbGxlIGluIGRlciBUWVAtRmFyYmUuXG4gIC8vIEJld3Vzc3QgbnVyIGRpZSBlcmZhc3N0ZW4gU3VidHlwZW4gdW5kIG9obmUgTm90aXotQW56YWhsOiBuaWNodCBlcmZhc3N0ZVxuICAvLyBXZXJ0ZSBoYWJlbiB3ZWRlciBGYXJiZSBub2NoIERlZmluaXRpb24sIHVuZCBaYWhsZW4gamUgTmFtZSB3XHUwMEZDcmRlbiBkaWVcbiAgLy8gWmVpbGUgc28gdmVybFx1MDBFNG5nZXJuLCBkYXNzIGJlaSBtZWhyZXJlbiBTdWJ0eXBlbiBuaWNodHMgbWVociBkYXZvbiB6dSBsZXNlblxuICAvLyB3XHUwMEU0cmUuIFJlaW5lIEFuemVpZ2UgLSBLbGljayB1bmQgUmVjaHRza2xpY2sgZ2VoXHUwMEY2cmVuIHdlaXRlciBkZXIgZ2FuemVuXG4gIC8vIFplaWxlIChEZXRhaWxhbnNpY2h0IGJ6dy4gU3VjaGUpLiBPYiBkaWUgTGlzdGUgbGlua3MgaGludGVyIGRlbSBOYW1lblxuICAvLyBiZWdpbm50IG9kZXIgcmVjaHRzYlx1MDBGQ25kaWcgdm9yIGRlciBBbnphaGwgZW5kZXQsIGlzdCBoaWVyIGJld3Vzc3QgbmljaHRcbiAgLy8gYWJnZWZyYWd0OiBkYXMgc2NoYWx0ZXQgU3R5bGUgU2V0dGluZ3MgXHUwMEZDYmVyIGVpbmUgYm9keS1LbGFzc2UgKHNpZWhlIGRlblxuICAvLyBAc2V0dGluZ3MtQmxvY2sgdW5kIC5mcmVkLXR5cC1saXN0LXN1YnR5cGVzIGluIHN0eWxlcy5jc3MpLCBkYXMgTWFya3VwXG4gIC8vIGJsZWlidCBpbiBiZWlkZW4gRlx1MDBFNGxsZW4gZGFzc2VsYmUuXG4gIHJlbmRlclN1YnR5cGVQcmV2aWV3KHNlbGYsIHR5cGUpIHtcbiAgICBjb25zdCBzdWJ0eXBlcyA9IGdldFN1YnR5cGVOYW1lcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSk7XG4gICAgaWYgKHN1YnR5cGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gICAgY29uc3QgY29sb3JpemUgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3Q7XG4gICAgY29uc3Qgd3JhcCA9IHNlbGYuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1saXN0LXN1YnR5cGVzXCIgfSk7XG4gICAgd3JhcC5hcHBlbmRUZXh0KFwiKFwiKTtcbiAgICBzdWJ0eXBlcy5mb3JFYWNoKChzdWJ0eXBlLCBpbmRleCkgPT4ge1xuICAgICAgaWYgKGluZGV4ID4gMCkgd3JhcC5hcHBlbmRUZXh0KFwiLCBcIik7XG4gICAgICBjb25zdCBzcGFuID0gd3JhcC5jcmVhdGVTcGFuKHsgdGV4dDogc3VidHlwZSB9KTtcbiAgICAgIGlmIChjb2xvcml6ZSkgc3Bhbi5zdHlsZS5jb2xvciA9IG5hbWVDb2xvcih0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSkuY29sb3I7XG4gICAgfSk7XG4gICAgd3JhcC5hcHBlbmRUZXh0KFwiKVwiKTtcbiAgfVxuXG4gIHJlbmRlclVucmVnaXN0ZXJlZEl0ZW0odHlwZSwgY291bnQpIHtcbiAgICBjb25zdCB0cmVlSXRlbSA9IHRoaXMubGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW1cIiB9KTtcbiAgICBjb25zdCBzZWxmID0gdHJlZUl0ZW0uY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1zZWxmIGlzLWNsaWNrYWJsZSBmcmVkLXR5cC11bnJlZ2lzdGVyZWRcIiB9KTtcbiAgICBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0taW5uZXJcIiwgdGV4dDogZGlzcGxheVR5cGVLZXkodHlwZSkgfSk7XG4gICAgdGhpcy5yZW5kZXJDb3VudEZsYWlyKHNlbGYsIGNvdW50KTtcblxuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMucmVnaXN0ZXJUeXBlKHR5cGUpKTtcbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHRoaXMub3BlblNlYXJjaCh0eXBlKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIEFsbGUgU1VCVFlQLVdlcnRlLCBkaWUgaW4gTm90aXplbiB2b3Jrb21tZW4sIGFiZXIgdW50ZXIgaWhyZW0gVFlQIG5pY2h0XG4gIC8vIGVyZmFzc3Qgc2luZCAtIFx1MDBGQ2JlciBkZW4gZ2FuemVuIFZhdWx0LCBuaWNodCBudXIgZlx1MDBGQ3IgZWluZW4gVFlQIHdpZVxuICAvLyByZW5kZXJVbnJlZ2lzdGVyZWRTdWJ0eXBlcygpIGluIGRlciBEZXRhaWxhbnNpY2h0LiBEZXIgSW5kZXggZlx1MDBGQ2hydCBzZWluZVxuICAvLyBCdWNrZXRzIFx1MDBGQ2JlciBBTExFIFRZUC1TY2hsXHUwMEZDc3NlbCwgYWxzbyBhdWNoIFx1MDBGQ2JlciBuaWNodCBlcmZhc3N0ZTsgZGVyZW5cbiAgLy8gU3VidHlwZW4ga29tbWVuIGRhaGVyIG1pdCAoS2xpY2sgZXJmYXNzdCBkYW5uIGJlaWRlcywgc2llaGVcbiAgLy8gcmVnaXN0ZXJUeXBlV2l0aFN1YnR5cGUpLlxuICAvL1xuICAvLyBTb3J0aWVydCBuYWNoIEFuemFobCwgZGFubiBuYWNoIGRlbSBaZWlsZW50ZXh0IHZvbiBsaW5rcyBuYWNoIHJlY2h0cyAoZXJzdFxuICAvLyBUWVAsIGRhbm4gU3VidHlwKSAtIGRpZXNlbGJlIFJlZ2VsIHdpZSBpbiBkZXIgRGV0YWlsYW5zaWNodCwgd28gZGFzXG4gIC8vIEhcdTAwRTR1Zmlnc3RlIG9iZW4gc3RlaHQuIEJld3Vzc3QgTklDSFQgbmFjaCBkZW0gU29ydGllci1CdXR0b24gZGVyIExpc3RlOlxuICAvLyBcIkZhcmJlXCIgdW5kIFwiTWFudWVsbFwiIGhhYmVuIGZcdTAwRkNyIG5pY2h0IGVyZmFzc3RlIFdlcnRlIGtlaW5lIEJlZGV1dHVuZy5cbiAgLy9cbiAgLy8gRWluZSBOb3RpeiBvaG5lIFRZUCBibGVpYnQgYXVcdTAwREZlbiB2b3IgLSBkZXIgSW5kZXggdmVyd2lyZnQgaWhyZW4gU1VCVFlQXG4gIC8vIHNjaG9uIGJlaW0gWlx1MDBFNGhsZW4gKHNpZWhlIGFnZ3JlZ2F0ZSgpIGluIHR5cC1pbmRleC5qcyksIGVpbiBTVUJUWVAgb2huZSBUWVBcbiAgLy8gaGF0IGtlaW5lbiBLb250ZXh0LlxuICB1bnJlZ2lzdGVyZWRTdWJ0eXBlUm93cygpIHtcbiAgICBjb25zdCByZWdpc3RlcmVkID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXM7XG4gICAgY29uc3Qgcm93cyA9IFtdO1xuICAgIGZvciAoY29uc3QgW3R5cGUsIGJ1Y2tldF0gb2YgdGhpcy5wbHVnaW4udHlwSW5kZXguc3VidHlwZUNvdW50cygpKSB7XG4gICAgICBjb25zdCBrbm93biA9IGdldFN1YnR5cGVOYW1lcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSk7XG4gICAgICBmb3IgKGNvbnN0IFtzdWJ0eXBlLCBjb3VudF0gb2YgYnVja2V0LmNvdW50cykge1xuICAgICAgICBpZiAoa25vd24uaW5jbHVkZXMoc3VidHlwZSkpIGNvbnRpbnVlO1xuICAgICAgICByb3dzLnB1c2goeyB0eXBlLCBzdWJ0eXBlLCBjb3VudCwgdHlwZVJlZ2lzdGVyZWQ6IHJlZ2lzdGVyZWQuaW5jbHVkZXModHlwZSkgfSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiByb3dzLnNvcnQoKGEsIGIpID0+IGIuY291bnQgLSBhLmNvdW50IHx8IGEudHlwZS5sb2NhbGVDb21wYXJlKGIudHlwZSkgfHwgYS5zdWJ0eXBlLmxvY2FsZUNvbXBhcmUoYi5zdWJ0eXBlKSk7XG4gIH1cblxuICAvLyBcIk5PVElaIC8gS3VyeiBHZXNjaGljaHRlXCIgLSBkZXIgU3VidHlwIGFsbGVpbiB3XHUwMEU0cmUgbWVocmRldXRpZywgZGVuc2VsYmVuXG4gIC8vIE5hbWVuIGthbm4gZXMgdW50ZXIgbWVocmVyZW4gVFlQZW4gZ2ViZW4uIElzdCBkZXIgVFlQIGJlcmVpdHMgZXJmYXNzdCxcbiAgLy8gdHJcdTAwRTRndCBzZWluIFRlaWwgZGVyIFplaWxlIHNlaW5lIEZhcmJlIChiencuIGVpbmVuIEZhcmJwdW5rdCBkYXZvciwgamUgbmFjaFxuICAvLyBFaW5zdGVsbHVuZyBcIlRZUCBWaWV3IGVpbmZcdTAwRTRyYmVuXCIpIC0gYWJnZXNjaHdcdTAwRTRjaHQgXHUwMEZDYmVyIGRhcyBTdHlsZSBTZXR0aW5nXG4gIC8vIFwiRmFyYmUgZXJmYXNzdGVyIFRZUGVuIGluIGRpZXNlciBMaXN0ZVwiLCBkYW1pdCBkaWUgWmVpbGVuIHRyb3R6IEZhcmJlXG4gIC8vIGhpbnRlciBkZW4gZXJmYXNzdGVuIFRZUGVuIG9iZW4genVyXHUwMEZDY2tibGVpYmVuLiBJc3QgYXVjaCBkZXIgVFlQIG5pY2h0XG4gIC8vIGVyZmFzc3QsIGJsZWlidCBkaWUgZ2FuemUgWmVpbGUgbXV0ZWQgd2llIGRpZSBFaW50clx1MDBFNGdlIGRhclx1MDBGQ2Jlci5cbiAgcmVuZGVyVW5yZWdpc3RlcmVkU3VidHlwZUl0ZW0oeyB0eXBlLCBzdWJ0eXBlLCBjb3VudCwgdHlwZVJlZ2lzdGVyZWQgfSkge1xuICAgIGNvbnN0IHRyZWVJdGVtID0gdGhpcy5saXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbVwiIH0pO1xuICAgIGNvbnN0IHNlbGYgPSB0cmVlSXRlbS5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLXNlbGYgaXMtY2xpY2thYmxlIGZyZWQtdHlwLXVucmVnaXN0ZXJlZFwiIH0pO1xuXG4gICAgY29uc3QgY29sb3JpemUgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3Q7XG4gICAgY29uc3QgeyBjb2xvciwgaXNEZWZhdWx0IH0gPSBuYW1lQ29sb3IodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUpO1xuICAgIGlmICh0eXBlUmVnaXN0ZXJlZCAmJiAhY29sb3JpemUpIHtcbiAgICAgIGNvbnN0IHdyYXAgPSBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1jb2xvci13cmFwIGZyZWQtdHlwLXVucmVnaXN0ZXJlZC1zdWJ0eXBlLWNvbG9yXCIgfSk7XG4gICAgICBwYWludENvbG9yRG90KHdyYXAuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWNvbG9yLWRvdFwiIH0pLCBjb2xvciwgaXNEZWZhdWx0KTtcbiAgICB9XG5cbiAgICBjb25zdCBpbm5lciA9IHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1pbm5lclwiIH0pO1xuICAgIGNvbnN0IHR5cGVFbCA9IGlubmVyLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtdW5yZWdpc3RlcmVkLXN1YnR5cGUtdHlwZVwiLCB0ZXh0OiBkaXNwbGF5VHlwZUtleSh0eXBlKSB9KTtcbiAgICBpZiAodHlwZVJlZ2lzdGVyZWQgJiYgY29sb3JpemUgJiYgIWlzRGVmYXVsdCkge1xuICAgICAgdHlwZUVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gICAgICB0eXBlRWwuYWRkQ2xhc3MoXCJmcmVkLXR5cC11bnJlZ2lzdGVyZWQtc3VidHlwZS1jb2xvclwiKTtcbiAgICB9XG4gICAgaW5uZXIuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC11bnJlZ2lzdGVyZWQtc3VidHlwZS1zbGFzaFwiLCB0ZXh0OiBcIiAvIFwiIH0pO1xuICAgIGlubmVyLmNyZWF0ZVNwYW4oeyB0ZXh0OiBkaXNwbGF5VHlwZUtleShzdWJ0eXBlKSB9KTtcblxuICAgIHRoaXMucmVuZGVyQ291bnRGbGFpcihzZWxmLCBjb3VudCk7XG5cbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnJlZ2lzdGVyVHlwZVdpdGhTdWJ0eXBlKHR5cGUsIHN1YnR5cGUpKTtcbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHRoaXMub3BlblN1YnR5cGVTZWFyY2godHlwZSwgc3VidHlwZSk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBLbGljayBhdWYgZWluZSBzb2xjaGUgWmVpbGU6IGVyZmFzc3QgZGVuIFN1YnR5cCAtIHVuZCwgZmFsbHMgblx1MDBGNnRpZywgc2VpbmVuXG4gIC8vIFRZUCBnbGVpY2ggbWl0LiBSZWloZW5mb2xnZSB6d2luZ2VuZCBlcnN0IFRZUCwgZGFubiBTdWJ0eXA6IGRhcyBFcmZhc3NlblxuICAvLyBlaW5lcyBUWVBzIGthbm4gZGVzc2VuIFdlcnQgaW4gZGVuIE5vdGl6ZW4gYmVyZWluaWdlbiAoXCIgYnVjaFwiIFx1MjE5MiBcIkJVQ0hcIiksXG4gIC8vIGRhbmFjaCBtdXNzIGRlciBTdWJ0eXAtQWJnbGVpY2ggc2Nob24gZGVuIE5FVUVOIFRZUC1OYW1lbiB2ZXJ3ZW5kZW4sIHNvbnN0XG4gIC8vIGZpbmRldCByZW5hbWVTdWJ0eXBlSW5Ob3RlcygpIGtlaW5lIERhdGVpIG1laHIuXG4gIC8vXG4gIC8vIEJlaWRlcyB6dXNhbW1lbiB3aXJkIGRpcmVrdCBhdXNnZWZcdTAwRkNocnQsIG9obmUgQmVzdFx1MDBFNHRpZ3VuZzogZXMgaXN0IGVpbmVcbiAgLy8gcmVpbmUgRXJmYXNzdW5nLiBOb3RpemVuIFx1MDBFNG5kZXJuIHNpY2ggbnVyLCB3ZW5uIGRlciBSb2h3ZXJ0IHVuc2F1YmVyIHdhciB1bmRcbiAgLy8gZGFiZWkgYmVyZWluaWd0IHdpcmQgLSBlaW4gc2F1YmVyZXIgV2VydCBmYXNzdCBrZWluZSBlaW56aWdlIERhdGVpIGFuLlxuICBhc3luYyByZWdpc3RlclR5cGVXaXRoU3VidHlwZSh0eXBlS2V5LCBzdWJ0eXBlS2V5KSB7XG4gICAgY29uc3QgYnVja2V0ID0gdGhpcy5wbHVnaW4udHlwSW5kZXguc3VidHlwZUJ1Y2tldCh0eXBlS2V5KTtcbiAgICBjb25zdCB0eXBlUmVzdWx0ID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXMuaW5jbHVkZXModHlwZUtleSlcbiAgICAgID8geyB0eXBlOiB0eXBlS2V5LCByZW5hbWVkOiAwIH1cbiAgICAgIDogYXdhaXQgdGhpcy5hcHBseVR5cGVSZWdpc3RyYXRpb24odHlwZUtleSk7XG4gICAgaWYgKCF0eXBlUmVzdWx0KSByZXR1cm47XG5cbiAgICBjb25zdCBzdWJ0eXBlUmVzdWx0ID0gYXdhaXQgdGhpcy5hcHBseVN1YnR5cGVSZWdpc3RyYXRpb24odHlwZVJlc3VsdC50eXBlLCBzdWJ0eXBlS2V5LCBidWNrZXQpO1xuICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgIHRoaXMucmVuZGVyKCk7XG4gICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG5cbiAgICBpZiAoIXN1YnR5cGVSZXN1bHQpIHJldHVybjtcbiAgICBjb25zdCBwYXJ0cyA9IFtdO1xuICAgIGlmICh0eXBlUmVzdWx0LnR5cGUgIT09IHR5cGVLZXkpIHBhcnRzLnB1c2goYFRZUCAke3R5cGVSZXN1bHQudHlwZX1gKTtcbiAgICBwYXJ0cy5wdXNoKGBTVUJUWVAgJHtzdWJ0eXBlUmVzdWx0LnN1YnR5cGV9YCk7XG4gICAgY29uc3QgY2hhbmdlZCA9IHR5cGVSZXN1bHQucmVuYW1lZCArIHN1YnR5cGVSZXN1bHQucmVuYW1lZDtcbiAgICBuZXcgTm90aWNlKGAke3BhcnRzLmpvaW4oXCIgdW5kIFwiKX0gcmVnaXN0cmllcnQke2NoYW5nZWQgPiAwID8gYCwgJHtjaGFuZ2VkfSBOb3RpeihlbikgYW5nZXBhc3N0YCA6IFwiXCJ9LmApO1xuICB9XG5cbiAgcmVuZGVyVHlwZVNldHRpbmdzKHR5cGUpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcblxuICAgIGNvbnN0IGhlYWRlciA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZGV0YWlsLWhlYWRlclwiIH0pO1xuICAgIGNvbnN0IGJhY2tCdG4gPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWJhY2tcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJadXJcdTAwRkNja1wiIH0gfSk7XG4gICAgc2V0SWNvbihiYWNrQnRuLCBcImFycm93LWxlZnRcIik7XG4gICAgYmFja0J0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5jbG9zZVR5cGVTZXR0aW5ncygpKTtcblxuICAgIGNvbnN0IHRpdGxlRWwgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC10aXRsZVwiLCB0ZXh0OiB0eXBlIH0pO1xuICAgIGNvbnN0IHRpdGxlQ29sb3IgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3QgPyB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdIDogbnVsbDtcbiAgICAvLyBEaWUgVFlQLUZhcmJlIGJld3Vzc3QgYWxzIEN1c3RvbSBQcm9wZXJ0eSBzdGF0dCBkaXJla3QgYWxzIGNvbG9yOiBlaW5lXG4gICAgLy8gSW5saW5lLUZhcmJlIHNjaGxcdTAwRTRndCBqZWRlIFN0eWxlc2hlZXQtUmVnZWwsIGRpZSBBa3plbnRmYXJiZSBiZWltIEhvdmVyblxuICAgIC8vIChzaWVoZSAuZnJlZC10eXAtc2VhcmNoYWJsZSkga1x1MDBFNG1lIHNvbnN0IG51ciBtaXQgIWltcG9ydGFudCBkYWdlZ2VuIGFuLlxuICAgIGlmICh0aXRsZUNvbG9yKSB0aXRsZUVsLnN0eWxlLnNldFByb3BlcnR5KFwiLS1mcmVkLXR5cC1uYW1lLWNvbG9yXCIsIHRpdGxlQ29sb3IpO1xuICAgIHRoaXMubWFrZVNlYXJjaGFibGUodGl0bGVFbCwgKCkgPT4gdGhpcy5vcGVuU2VhcmNoKHR5cGUpKTtcblxuICAgIGNvbnN0IHsgY291bnRzIH0gPSB0aGlzLnBsdWdpbi50eXBJbmRleC50eXBlQ291bnRzKCk7XG4gICAgaGVhZGVyLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtZGV0YWlsLWNvdW50XCIsIHRleHQ6IFN0cmluZyhjb3VudHMuZ2V0KHR5cGUpID8/IDApIH0pO1xuXG4gICAgLy8gTGlua3MgbmViZW4gZGVtIG5vcm1hbGVuIFVtYmVuZW5uZW4tQnV0dG9uLCBoZXJ2b3JnZWhvYmVuIChBa3plbnRmYXJiZSxcbiAgICAvLyBzaWVoZSBzdHlsZXMuY3NzKSAtIGltIEdlZ2Vuc2F0eiB6dSBkaWVzZW0gc2NocmVpYnQgZGllc2UgVmFyaWFudGUgYmVpbVxuICAgIC8vIFVtYmVuZW5uZW4genVzXHUwMEU0dHpsaWNoIGRlbiBUWVAtV2VydCBhbGxlciBiZXRyb2ZmZW5lbiBOb3RpemVuIHVtIChuYWNoXG4gICAgLy8gQmVzdFx1MDBFNHRpZ3VuZywgc2llaGUgc3RhcnREZXRhaWxSZW5hbWUvQ29uZmlybVJlbmFtZVR5cGVNb2RhbCkuXG4gICAgY29uc3QgcmVuYW1lV2l0aE5vdGVzQnRuID0gaGVhZGVyLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gZnJlZC10eXAtZGV0YWlsLXJlbmFtZS1ub3Rlc1wiLFxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJVbWJlbmVubmVuIChpbmtsLiBOb3RpemVuIGFucGFzc2VuKVwiIH0sXG4gICAgfSk7XG4gICAgc2V0SWNvbihyZW5hbWVXaXRoTm90ZXNCdG4sIFwicGVuY2lsXCIpO1xuICAgIHJlbmFtZVdpdGhOb3Rlc0J0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5zdGFydERldGFpbFJlbmFtZSh0eXBlLCB0aXRsZUVsLCB7IHVwZGF0ZU5vdGVzOiB0cnVlIH0pKTtcblxuICAgIGNvbnN0IHJlbmFtZUJ0biA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gZnJlZC10eXAtZGV0YWlsLXJlbmFtZVwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlVtYmVuZW5uZW5cIiB9IH0pO1xuICAgIHNldEljb24ocmVuYW1lQnRuLCBcInBlbmNpbFwiKTtcbiAgICByZW5hbWVCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuc3RhcnREZXRhaWxSZW5hbWUodHlwZSwgdGl0bGVFbCkpO1xuXG4gICAgLy8gWndpc2NoZW4gVW1iZW5lbm5lbiB1bmQgTFx1MDBGNnNjaGVuLCBhbiBkZXJzZWxiZW4gU3RlbGxlIHdpZSBiZWkgZGVuXG4gICAgLy8gU3VidHlwZW4gKHNpZWhlIHJlbmRlclNlY3Rpb25Gb290ZXIpOiBpbiBkZXIgUmVpaGUgZGVyIFx1MDBGQ2JyaWdlblxuICAgIC8vIEljb24tS25cdTAwRjZwZmVuIGRlcyBUWVBzIHN0YXR0IGFscyB2aWVydGVyIEJldGVpbGlndGVyIG5lYmVuIE5hbWVuLFxuICAgIC8vIEFuemFobCB1bmQgQWt0aW9uZW4uXG4gICAgdGhpcy5yZW5kZXJNYW51YWxUb2dnbGUoaGVhZGVyLCB0eXBlKTtcblxuICAgIGNvbnN0IGRlbGV0ZUJ0biA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gZnJlZC10eXAtZGV0YWlsLWRlbGV0ZVwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkxcdTAwRjZzY2hlblwiIH0gfSk7XG4gICAgc2V0SWNvbihkZWxldGVCdG4sIFwidHJhc2hcIik7XG4gICAgZGVsZXRlQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnNob3dEZWxldGVDb25maXJtKHR5cGUpKTtcblxuICAgIGNvbnN0IGJvZHkgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC1ib2R5XCIgfSk7XG5cbiAgICAvLyBFaW5lIFplaWxlIHVudGVyIGRlciBLb3BmemVpbGU6IGxpbmtzIGRpZSBUWVAtRmFyYmUsIHJlY2h0cyBkYW5lYmVuIGRpZVxuICAgIC8vIEJlc2NocmVpYnVuZyBcdTAwRkNiZXIgZGVuIHJlc3RsaWNoZW4gUGxhdHouIFVtYmVuZW5uZW4sIExcdTAwRjZzY2hlbiB1bmRcbiAgICAvLyBcIm1hbnVlbGwgZXJzdGVsbGJhclwiIHN0ZWhlbiBvYmVuIGluIGRlciBLb3BmemVpbGUuXG4gICAgY29uc3Qgb3B0aW9uc0hlYWRlciA9IGJvZHkuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLWhlYWRlciBmcmVkLXR5cC1vcHRpb25zLWhlYWRlclwiIH0pO1xuXG4gICAgY29uc3QgY29sb3JSb3cgPSBvcHRpb25zSGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtY29sb3Itcm93XCIgfSk7XG4gICAgdGhpcy5yZW5kZXJDb2xvclBpY2tlcihcbiAgICAgIGNvbG9yUm93LFxuICAgICAgdHlwZSxcbiAgICAgIChuZXdDb2xvcikgPT4ge1xuICAgICAgICBpZiAoIXRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdCkgcmV0dXJuO1xuICAgICAgICAvLyBEaWVzZWxiZSBDdXN0b20gUHJvcGVydHkgd2llIGJlaW0gQXVmYmF1IG9iZW4sIG5pY2h0IHN0eWxlLmNvbG9yOlxuICAgICAgICAvLyBlaW5lIElubGluZS1GYXJiZSB3dWVyZGUgZGllIEFremVudGZhcmJlIGJlaW0gSG92ZXJuIHdpZWRlciBzY2hsYWdlbi5cbiAgICAgICAgdGl0bGVFbC5zdHlsZS5zZXRQcm9wZXJ0eShcIi0tZnJlZC10eXAtbmFtZS1jb2xvclwiLCBuZXdDb2xvcik7XG4gICAgICB9LFxuICAgICAgeyBzaG93UmVzZXQ6IHRydWUgfVxuICAgICk7XG5cbiAgICAvLyBSZWNodHMgbmViZW4gZGVyIEZhcmJ3YWhsLCBkZW4gXHUwMEZDYnJpZ2VuIFBsYXR6IGRlciBaZWlsZSBmXHUwMEZDbGxlbmQuIEVpbnplaWxpZ2VzIElucHV0IHN0YXR0IGRlcyBmclx1MDBGQ2hlcmVuIHp3ZWl6ZWlsaWdlblxuICAgIC8vIFRleHRhcmVhIC0gaW4gZWluZXIgWmVpbGUgbmViZW4gZGVuIEljb25zIGhhdCBlaW4gbWVocnplaWxpZ2VzIEZlbGRcbiAgICAvLyBrZWluZW4gUGxhdHosIHVuZCBkaWVzZWxiZSBCZXNjaHJlaWJ1bmcgaXN0IGluIGRlciBUWVAtTGlzdGUgb2huZWhpblxuICAgIC8vIHNjaG9uIGFscyBlaW56ZWlsaWdlcyBJbnB1dCBiZWFyYmVpdGJhciAoc2llaGUgcmVuZGVyRGVzY3JpcHRpb25JbnB1dCkuXG4gICAgLy8gT2huZSBlaWdlbmUgXHUwMERDYmVyc2NocmlmdDogc29sYW5nZSBkYXMgRmVsZCBsZWVyIGlzdCwgc2FndCBzZWluXG4gICAgLy8gUGxhdHpoYWx0ZXIgKGdlZmFkZXQsIHNpZWhlIHN0eWxlcy5jc3MpLCB3b3J1bSBlcyBnZWh0LlxuICAgIGNvbnN0IGRlc2NJbnB1dCA9IG9wdGlvbnNIZWFkZXIuY3JlYXRlRWwoXCJpbnB1dFwiLCB7XG4gICAgICB0eXBlOiBcInRleHRcIixcbiAgICAgIGNsczogXCJmcmVkLXR5cC1kZXNjcmlwdGlvbi1pbnB1dFwiLFxuICAgICAgYXR0cjogeyBwbGFjZWhvbGRlcjogXCJCZXNjaHJlaWJ1bmdcIiB9LFxuICAgIH0pO1xuICAgIGRlc2NJbnB1dC52YWx1ZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV0gPz8gXCJcIjtcbiAgICBkZXNjSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB2YWx1ZSA9IGRlc2NJbnB1dC52YWx1ZS50cmltKCk7XG4gICAgICBpZiAodmFsdWUpIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV0gPSB2YWx1ZTtcbiAgICAgIGVsc2UgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV07XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICB9KTtcblxuICAgIC8vIFRyZW5udCBkaWUgRnJvbnRtYXR0ZXItQmxcdTAwRjZja2Ugdm9uIGRlbiBcdTAwRkNicmlnZW4gRWluc3RlbGx1bmdlbiBkZXMgVFlQc1xuICAgIC8vIChGYXJiZSwgQmVzY2hyZWlidW5nKS5cbiAgICBib2R5LmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtc2VwYXJhdG9yXCIgfSk7XG5cbiAgICAvLyBUWVAtRnJvbnRtYXR0ZXIgdW5kIGplIHJlZ2lzdHJpZXJ0ZW0gU3VidHlwIGVpbiBCbG9jayBkYXJ1bnRlciwgamVkZXJcbiAgICAvLyBtaXQgZWlnZW5lciBFZGl0b3ItSW5zdGFueiAoc2llaGUgZnJvbnRtYXR0ZXItYmxvY2tzLmpzKSAtIGRlcnNlbGJlIEtleVxuICAgIC8vIGRhcmYgZGVzaGFsYiBpbiBtZWhyZXJlbiBCbFx1MDBGNmNrZW4gc3RlaGVuLiBFaW4gU3VidHlwLUJsb2NrIGVyZ1x1MDBFNG56dCBkYXNcbiAgICAvLyBUWVAtRnJvbnRtYXR0ZXIgZlx1MDBGQ3IgTm90aXplbiBtaXQgZGllc2VtIFNVQlRZUCB1bmQgXHUwMEZDYmVyc2NocmVpYnQgZG9ydFxuICAgIC8vIGdsZWljaG5hbWlnZSBQcm9wZXJ0aWVzIChzaWVoZSBzdWJ0eXBlcy5qcykuXG4gICAgY29uc3QgYnVja2V0ID0gdGhpcy5wbHVnaW4udHlwSW5kZXguc3VidHlwZUJ1Y2tldCh0eXBlKTtcbiAgICB0aGlzLmZyb250bWF0dGVyQmxvY2tzID0gbW91bnRGcm9udG1hdHRlckJsb2Nrcyh0aGlzLCBib2R5LCB0eXBlLCB7XG4gICAgICByZW5kZXJIZWFkZXI6IChzZWN0aW9uLCBlbCwgYmxvY2tzKSA9PiB0aGlzLnJlbmRlclNlY3Rpb25IZWFkZXIoZWwsIHR5cGUsIHNlY3Rpb24sIGJ1Y2tldCwgYmxvY2tzKSxcbiAgICAgIHJlbmRlckZvb3RlcjogKHNlY3Rpb24sIGVsKSA9PiB7XG4gICAgICAgIGlmIChzZWN0aW9uICE9PSBudWxsKSB0aGlzLnJlbmRlclNlY3Rpb25Gb290ZXIoZWwsIHR5cGUsIHNlY3Rpb24pO1xuICAgICAgfSxcbiAgICAgIG9uTW92ZVNlY3Rpb246IGFzeW5jIChvcmRlcikgPT4ge1xuICAgICAgICByZW9yZGVyU3VidHlwZXModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUsIG9yZGVyKTtcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICB9LFxuICAgIH0pO1xuICAgIHRoaXMuZnJvbnRtYXR0ZXJFZGl0b3JzLnB1c2goLi4udGhpcy5mcm9udG1hdHRlckJsb2Nrcy5lZGl0b3JzKTtcblxuICAgIC8vIEJld3Vzc3QgXHUwMEZDYmVyIGRpZSB2b2xsZSBCcmVpdGUgdW5kIGluIEFremVudGZhcmJlLCBkYW1pdCBlciBzaWNoIHZvbiBkZW5cbiAgICAvLyBrbGVpbmVuIEljb24tQnV0dG9ucyBkZXIgQmxcdTAwRjZja2UgYWJoZWJ0LlxuICAgIHRoaXMuc3VidHlwZUFkZEJ0bkVsID0gYm9keS5jcmVhdGVFbChcImJ1dHRvblwiLCB7IGNsczogXCJtb2QtY3RhIGZyZWQtdHlwLXN1YnR5cGUtYWRkXCIgfSk7XG4gICAgc2V0SWNvbih0aGlzLnN1YnR5cGVBZGRCdG5FbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLXN1YnR5cGUtYWRkLWljb25cIiB9KSwgXCJwbHVzXCIpO1xuICAgIHRoaXMuc3VidHlwZUFkZEJ0bkVsLmNyZWF0ZVNwYW4oeyB0ZXh0OiBcIlN1YnR5cCBoaW56dWZcdTAwRkNnZW5cIiB9KTtcbiAgICB0aGlzLnN1YnR5cGVBZGRCdG5FbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5zdGFydEFkZFN1YnR5cGUodHlwZSkpO1xuXG4gICAgdGhpcy5yZW5kZXJVbnJlZ2lzdGVyZWRTdWJ0eXBlcyhib2R5LCB0eXBlLCBidWNrZXQpO1xuXG4gICAgYm9keS5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZGV0YWlsLXNlcGFyYXRvclwiIH0pO1xuICAgIHRoaXMucmVuZGVyRmxvYXRpbmdIaW50KGJvZHkpO1xuICAgIC8vIEZldHQtTWFya2llcnVuZyAoc2llaGUgZnJvbnRtYXR0ZXItZGVmYXVsdC1oaWdobGlnaHQuanMpIHJlYWdpZXJ0IG51ciBhdWZcbiAgICAvLyBNZXRhZGF0ZW4tL0xheW91dC1FdmVudHMgLSBkYXMgXHUwMEQ2ZmZuZW4gZGllc2VyIERldGFpbGFuc2ljaHQgc2VsYnN0IGxcdTAwRjZzdFxuICAgIC8vIGtlaW5zIGRhdm9uIGF1cywgZGFoZXIgaGllciBkaXJla3QgbmFjaCBkZW0gTW91bnRlbiBhbnN0b1x1MDBERmVuLiBCZXd1c3N0XG4gICAgLy8gbnVyIGRpZXNlciBlaW5lLCBnZXppZWx0ZSBSZWZyZXNoIHN0YXR0IGRlcyB2b2xsZW4gcmVmcmVzaFR5cENvbG9ycygpLVxuICAgIC8vIEJcdTAwRkNuZGVsczogZGFzIHdcdTAwRkNyZGUgdS4gYS4gYXVjaCByZW5kZXIoKSBhdWYgZGllc2VtIChnZXJhZGUgZXJzdCBtaXR0ZW5cbiAgICAvLyBpbSBlaWdlbmVuIHJlbmRlcigpLUR1cmNobGF1ZiBiZWZpbmRsaWNoZW4pIFZpZXcgZXJuZXV0IGF1c2xcdTAwRjZzZW4uXG4gICAgdGhpcy5wbHVnaW4ucmVmcmVzaEZyb250bWF0dGVySGlnaGxpZ2h0Py4oKTtcbiAgfVxuXG4gIC8vIFx1MDBEQ2JlcnNjaHJpZnQgZWluZXMgQmxvY2tzIChzaWVoZSBmcm9udG1hdHRlci1ibG9ja3MuanMpOiBUaXRlbCBtaXRcbiAgLy8gTm90aXotQW56YWhsIChiZWltIFRZUC1Gcm9udG1hdHRlciBkaWUgTm90aXplbiBvaG5lIFNVQlRZUCAtIGZcdTAwRkNyIGRpZSBnaWx0XG4gIC8vIG51ciBkaWVzZXIgQmxvY2spLCBTdWNoZSBwZXIgS2xpY2sgYXVmIGRlbiBUaXRlbCwgdW5kIGRpZSBiZWlkZW5cbiAgLy8gXCJQcm9wZXJ0eSBoaW56dWZcdTAwRkNnZW5cIi1CdXR0b25zLCBkaWUgZWluZSBMZWVyemVpbGUgaW4gZ2VuYXUgZGllc2VtIEJsb2NrXG4gIC8vIGFubGVnZW4uXG4gIHJlbmRlclNlY3Rpb25IZWFkZXIoZWwsIHR5cGUsIHNlY3Rpb24sIGJ1Y2tldCwgYmxvY2tzKSB7XG4gICAgY29uc3QgdGl0bGVHcm91cCA9IGVsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1mcm9udG1hdHRlci10aXRsZS1ncm91cFwiIH0pO1xuICAgIC8vIEJld3Vzc3QgbmllIGVpbmdlZlx1MDBFNHJidCAod2VkZXIgaW4gZGVyIFRZUC0gbm9jaCBpbiBkZXIgU3VidHlwLUZhcmJlKSxcbiAgICAvLyBhbmRlcnMgYWxzIGRlciBUaXRlbCBkZXIgRGV0YWlsYW5zaWNodCBkYXJcdTAwRkNiZXI6IGRpZSBGYXJiZSBlaW5lcyBCbG9ja3NcbiAgICAvLyBzdGVodCBpbSBGYXJicHVua3Qgc2VpbmVzIEFic2NobHVzc2VzIChzaWVoZSByZW5kZXJTZWN0aW9uRm9vdGVyKS5cbiAgICBjb25zdCB0aXRsZUVsID0gdGl0bGVHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZGV0YWlsLXNlY3Rpb24tdGl0bGVcIiwgdGV4dDogc2VjdGlvbiA/PyBgJHt0eXBlfS1Gcm9udG1hdHRlcmAgfSk7XG4gICAgY29uc3QgY291bnQgPSBzZWN0aW9uID09PSBudWxsID8gYnVja2V0Lm5vU3VidHlwZSA6IGJ1Y2tldC5jb3VudHMuZ2V0KHNlY3Rpb24pID8/IDA7XG4gICAgdGl0bGVHcm91cC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLXN1YnR5cGUtY291bnRcIiwgdGV4dDogU3RyaW5nKGNvdW50KSB9KTtcbiAgICB0aGlzLm1ha2VTZWFyY2hhYmxlKHRpdGxlRWwsICgpID0+IHRoaXMub3BlblN1YnR5cGVTZWFyY2godHlwZSwgc2VjdGlvbikpO1xuXG4gICAgLy8gRmxvYXRpbmcgUHJvcGVydGllcyAoc2llaGUgdHlwZUZsb2F0aW5nS2V5cyBpbiBzZXR0aW5ncy5qcykgc2luZCBUZWlsXG4gICAgLy8gZGVyc2VsYmVuIExpc3RlIHVuZCBSZWloZW5mb2xnZSB3aWUgZGllIFx1MDBGQ2JyaWdlbiBQcm9wZXJ0aWVzICh3aWNodGlnIGZcdTAwRkNyXG4gICAgLy8gZGllIEZyb250bWF0dGVyLVNvcnRpZXJ1bmcpLCBsYW5kZW4gYWxzbyBhbiBnZW5hdSBkZXIgU3RlbGxlLCBhbiBkaWUgc2llXG4gICAgLy8gcGVyIERyYWcgJiBEcm9wIGVpbnNvcnRpZXJ0IHdlcmRlbiwgc3RhdHQgZmVzdCBhbnMgRW5kZSBlaW5lciB6d2VpdGVuIExpc3RlLlxuICAgIGNvbnN0IGFkZEJ1dHRvbnMgPSBlbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItYWRkLWdyb3VwXCIgfSk7XG5cbiAgICAvLyBMaW5rcyBuZWJlbiBkZW0gbm9ybWFsZW4gQnV0dG9uLCBoZXJ2b3JnZWhvYmVuIChBa3plbnRmYXJiZSwgd2llXG4gICAgLy8gcmVuYW1lV2l0aE5vdGVzQnRuIG9iZW4pIC0gbWFya2llcnQgZGllIGFscyBuXHUwMEU0Y2hzdGVzIGhpbnp1Z2VmXHUwMEZDZ3RlIChiencuXG4gICAgLy8gYmlzIHp1bSBuXHUwMEU0Y2hzdGVuIFNwZWljaGVybiB1bWJlbmFubnRlKSBQcm9wZXJ0eSBhbHMgRmxvYXRpbmcsIHN0YXR0IHNpZVxuICAgIC8vIGFscyBub3JtYWxlIFN0YW5kYXJkLVByb3BlcnR5IGFuenVsZWdlbiAoc2llaGUgZWRpdG9yLmZyZWRQZW5kaW5nRmxvYXRpbmdBZGRcbiAgICAvLyBpbiB0eXBlLWZyb250bWF0dGVyLWVkaXRvci5qcykuIEZsb2F0aW5nIFByb3BlcnRpZXMgd2VyZGVuIE5JQ0hUXG4gICAgLy8gYXV0b21hdGlzY2ggYmVpIG5ldWVuIE5vdGl6ZW4gYW5nZWxlZ3QgKHNpZWhlIGdldFR5cGVEZWZhdWx0cygpIGluXG4gICAgLy8gbWFpbi5qcykgdW5kIGRvcnQsIHNvYmFsZCBkb2NoIHZvcmhhbmRlbiwga3Vyc2l2IHN0YXR0IGZldHQgZGFyZ2VzdGVsbHRcbiAgICAvLyAoc2llaGUgZnJvbnRtYXR0ZXItZGVmYXVsdC1oaWdobGlnaHQuanMpLlxuICAgIGNvbnN0IGFkZEZsb2F0aW5nUHJvcGVydHlCdG4gPSBhZGRCdXR0b25zLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gZnJlZC10eXAtZnJvbnRtYXR0ZXItYWRkLWZsb2F0aW5nXCIsXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkZsb2F0aW5nIFByb3BlcnR5IGhpbnp1Zlx1MDBGQ2dlblwiIH0sXG4gICAgfSk7XG4gICAgc2V0SWNvbihhZGRGbG9hdGluZ1Byb3BlcnR5QnRuLCBcInBsdXNcIik7XG4gICAgYWRkRmxvYXRpbmdQcm9wZXJ0eUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gYmxvY2tzLmFkZEJsYW5rKHNlY3Rpb24sIHRydWUpKTtcblxuICAgIGNvbnN0IGFkZFByb3BlcnR5QnRuID0gYWRkQnV0dG9ucy5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWZyb250bWF0dGVyLWFkZFwiLFxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJQcm9wZXJ0eSBoaW56dWZcdTAwRkNnZW5cIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24oYWRkUHJvcGVydHlCdG4sIFwicGx1c1wiKTtcbiAgICBhZGRQcm9wZXJ0eUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gYmxvY2tzLmFkZEJsYW5rKHNlY3Rpb24sIGZhbHNlKSk7XG4gIH1cblxuICAvLyBBYnNjaGx1c3MgZWluZXMgU3VidHlwLUJsb2NrczogbGlua3MgZGllIEZhcmJlIGRlcyBTdWJ0eXBzIChGYXJicHVua3QsIGRlclxuICAvLyBkaWUgUmVnbGVyIFx1MDBGNmZmbmV0LCBkYW5lYmVuIFp1clx1MDBGQ2Nrc2V0emVuKSwgcmVjaHRzIGRpZXNlbGJlbiBBa3Rpb25lbiBpblxuICAvLyBkZXJzZWxiZW4gUmVpaGVuZm9sZ2Ugd2llIGltIEtvcGYgZGVyIFRZUC1EZXRhaWxhbnNpY2h0IChVbWJlbmVubmVuIGlua2wuXG4gIC8vIE5vdGl6ZW4sIFVtYmVuZW5uZW4sIFwibWFudWVsbCBlcnN0ZWxsYmFyXCIsIExcdTAwRjZzY2hlbikuIERhcyBUWVAtRnJvbnRtYXR0ZXJcbiAgLy8gaGF0IGtlaW5lbiBBYnNjaGx1c3MuIERlciBUaXRlbCB3aXJkIGVyc3QgYmVpbSBLbGljayBnZXN1Y2h0IC0gXHUwMERDYmVyc2NocmlmdCB1bmRcbiAgLy8gQWJzY2hsdXNzIGVudHN0ZWhlbiBiZWkgamVkZW0gc3luY2hyb25pemUoKSBuZXUuXG4gIHJlbmRlclNlY3Rpb25Gb290ZXIoZWwsIHR5cGUsIHN1YnR5cGUpIHtcbiAgICBlbC5hZGRDbGFzcyhcImZyZWQtdHlwLXN1YnR5cGUtYWN0aW9uc1wiKTtcbiAgICBjb25zdCBjb2xvckdyb3VwID0gZWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLXN1YnR5cGUtY29sb3ItZ3JvdXBcIiB9KTtcbiAgICAvLyBSaW5nIGF1Y2gsIHNvbGFuZ2UgZGVyIFRZUCBzZWxic3Qga2VpbmUgRmFyYmUgaGF0IC0gZGFubiBmXHUwMEU0cmJ0IGF1Y2hcbiAgICAvLyBlaW5lIGVpbmdlc3RlbGx0ZSBBYndlaWNodW5nIG5pcmdlbmRzIGVpbi5cbiAgICBjb25zdCBvd25Db2xvciA9IHN1YnR5cGVIYXNPd25Db2xvcih0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSk7XG4gICAgY29uc3QgdHlwZUhhc0NvbG9yID0gISF0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdO1xuICAgIGNvbnN0IGNvbG9yRG90ID0gY29sb3JHcm91cC5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImZyZWQtdHlwLXN1YnR5cGUtY29sb3ItZG90XCIsXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiAhdHlwZUhhc0NvbG9yID8gXCJUWVAgaGF0IGtlaW5lIEZhcmJlXCIgOiBvd25Db2xvciA/IFwiRmFyYmUgYW5wYXNzZW5cIiA6IFwiXHUwMERDYmVybmltbXQgVFlQLUZhcmJlXCIgfSxcbiAgICB9KTtcbiAgICBjb2xvckRvdC5mcmVkU3VidHlwZSA9IHN1YnR5cGU7XG4gICAgcGFpbnRDb2xvckRvdChjb2xvckRvdCwgc3VidHlwZUNvbG9yKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKSA/PyBERUZBVUxUX1RZUEVfQ09MT1IsICFvd25Db2xvciB8fCAhdHlwZUhhc0NvbG9yKTtcbiAgICBjb2xvckRvdC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5vcGVuU3VidHlwZUNvbG9yUG9wb3Zlcihjb2xvckRvdCwgdHlwZSwgc3VidHlwZSkpO1xuICAgIGNvbnN0IHJlc2V0QnRuID0gY29sb3JHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gZnJlZC10eXAtY29sb3ItcmVzZXRcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJGYXJiZSB6dXJcdTAwRkNja3NldHplblwiIH0gfSk7XG4gICAgcmVzZXRCdG4udG9nZ2xlQ2xhc3MoXCJpcy1kaXNhYmxlZFwiLCAhb3duQ29sb3IpO1xuICAgIHNldEljb24ocmVzZXRCdG4sIFwicm90YXRlLWNjd1wiKTtcbiAgICByZXNldEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZGF0YSA9IGdldFN1YnR5cGUodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpO1xuICAgICAgaWYgKCFkYXRhPy5jb2xvcikgcmV0dXJuO1xuICAgICAgZGVsZXRlIGRhdGEuY29sb3I7XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICB9KTtcblxuICAgIGNvbnN0IGFjdGlvbnMgPSBlbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtc3VidHlwZS1hY3Rpb24tZ3JvdXBcIiB9KTtcbiAgICBjb25zdCB0aXRsZUVsID0gKCkgPT4ge1xuICAgICAgbGV0IHNpYmxpbmcgPSBlbC5wcmV2aW91c0VsZW1lbnRTaWJsaW5nO1xuICAgICAgd2hpbGUgKHNpYmxpbmcgJiYgIXNpYmxpbmcuaGFzQ2xhc3MoXCJmcmVkLXR5cC1zZWN0aW9uLWhlYWRlclwiKSkgc2libGluZyA9IHNpYmxpbmcucHJldmlvdXNFbGVtZW50U2libGluZztcbiAgICAgIHJldHVybiBzaWJsaW5nPy5xdWVyeVNlbGVjdG9yKFwiLmZyZWQtdHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIpID8/IG51bGw7XG4gICAgfTtcbiAgICBjb25zdCByZW5hbWUgPSAodXBkYXRlTm90ZXMpID0+IHtcbiAgICAgIGNvbnN0IHRhcmdldCA9IHRpdGxlRWwoKTtcbiAgICAgIGlmICh0YXJnZXQpIHRoaXMuc3RhcnRTdWJ0eXBlUmVuYW1lKHR5cGUsIHN1YnR5cGUsIHRhcmdldCwgeyB1cGRhdGVOb3RlcyB9KTtcbiAgICB9O1xuXG4gICAgY29uc3QgcmVuYW1lV2l0aE5vdGVzQnRuID0gYWN0aW9ucy5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWRldGFpbC1yZW5hbWUtbm90ZXNcIixcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiVW1iZW5lbm5lbiAoaW5rbC4gTm90aXplbiBhbnBhc3NlbilcIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24ocmVuYW1lV2l0aE5vdGVzQnRuLCBcInBlbmNpbFwiKTtcbiAgICByZW5hbWVXaXRoTm90ZXNCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHJlbmFtZSh0cnVlKSk7XG5cbiAgICBjb25zdCByZW5hbWVCdG4gPSBhY3Rpb25zLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1kZXRhaWwtcmVuYW1lXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiVW1iZW5lbm5lblwiIH0gfSk7XG4gICAgc2V0SWNvbihyZW5hbWVCdG4sIFwicGVuY2lsXCIpO1xuICAgIHJlbmFtZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gcmVuYW1lKGZhbHNlKSk7XG5cbiAgICB0aGlzLnJlbmRlclN1YnR5cGVNYW51YWxUb2dnbGUoYWN0aW9ucywgdHlwZSwgc3VidHlwZSk7XG5cbiAgICBjb25zdCBkZWxldGVCdG4gPSBhY3Rpb25zLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1kZXRhaWwtZGVsZXRlXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiTFx1MDBGNnNjaGVuXCIgfSB9KTtcbiAgICBzZXRJY29uKGRlbGV0ZUJ0biwgXCJ0cmFzaFwiKTtcbiAgICBkZWxldGVCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuZGVsZXRlU3VidHlwZVdpdGhDb25maXJtKHR5cGUsIHN1YnR5cGUpKTtcbiAgfVxuXG4gIC8vIFBvcG92ZXIgdW50ZXIgZGVtIEZhcmJwdW5rdCBlaW5lcyBTdWJ0eXAtQmxvY2tzOiBqZSBlaW4gUmVnbGVyIGZcdTAwRkNyXG4gIC8vIEZhcmJ0b24sIFNcdTAwRTR0dGlndW5nIHVuZCBIZWxsaWdrZWl0LCBiZWdyZW56dCBhdWYgZGllIGluIGRlbiBFaW5zdGVsbHVuZ2VuXG4gIC8vIGZlc3RnZWxlZ3RlIEFid2VpY2h1bmcgKHNpZWhlIHR5cGUtY29sb3JzLmpzKS4gRGllIExlaXN0ZSBqZWRlcyBSZWdsZXJzXG4gIC8vIHplaWd0IGFscyBWZXJsYXVmIGRpZSBGYXJiZW4sIGRpZSBlciBlcnJlaWNoZW4ga2Fubi4gQmVpbSBaaWVoZW4gXHUwMEU0bmRlcnRcbiAgLy8gc2ljaCBudXIgZGVyIEZhcmJwdW5rdCBoaWVyOyBnZXNwZWljaGVydCB1bmQgaW4gZGllIFx1MDBGQ2JyaWdlbiBBbnNpY2h0ZW5cbiAgLy8gXHUwMEZDYmVybm9tbWVuIHdpcmQgYmVpbSBTY2hsaWVcdTAwREZlbiAoS2xpY2sgZGFuZWJlbiBvZGVyIEVzY2FwZSkgLSBlaW5cbiAgLy8gcmVmcmVzaFR5cENvbG9ycygpIHJlbmRlcnQgdS4gYS4gZGllc2UgQW5zaWNodCBuZXUuXG4gIG9wZW5TdWJ0eXBlQ29sb3JQb3BvdmVyKGFuY2hvckVsLCB0eXBlLCBzdWJ0eXBlKSB7XG4gICAgdGhpcy5jbG9zZVN1YnR5cGVDb2xvclBvcG92ZXI/LigpO1xuICAgIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHRoaXMucGx1Z2luO1xuICAgIGNvbnN0IGRhdGEgPSBnZXRTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKTtcbiAgICBpZiAoIWRhdGEpIHJldHVybjtcbiAgICBjb25zdCB0eXBlQ29sb3IgPSBzZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdID8/IERFRkFVTFRfVFlQRV9DT0xPUjtcbiAgICAvLyBPaG5lIGVpZ2VuZSBBYndlaWNodW5nIHN0ZWh0IGplZGVyIFJlZ2xlciBhdWYgMCAtIHdlbGNoZSBlcyBnaWJ0LCBzYWd0XG4gICAgLy8gYWxsZWluIFNVQlRZUEVfQ09MT1JfQ0hBTk5FTFMgKHNpZWhlIHR5cGUtY29sb3JzLmpzKS5cbiAgICBjb25zdCBvZmZzZXQgPSBjbGFtcGVkT2Zmc2V0KHNldHRpbmdzLCBkYXRhLmNvbG9yKSA/PyBPYmplY3QuZnJvbUVudHJpZXMoU1VCVFlQRV9DT0xPUl9DSEFOTkVMUy5tYXAoKHsga2V5IH0pID0+IFtrZXksIDBdKSk7XG4gICAgY29uc3QgZG9jID0gYW5jaG9yRWwuZG9jO1xuICAgIGNvbnN0IHBvcG92ZXIgPSBkb2MuYm9keS5jcmVhdGVEaXYoeyBjbHM6IFwibWVudSBmcmVkLXR5cC1zdWJ0eXBlLWNvbG9yLXBvcG92ZXJcIiB9KTtcblxuICAgIGNvbnN0IHJvd3MgPSBbXTtcbiAgICBjb25zdCB1cGRhdGUgPSAoKSA9PiB7XG4gICAgICBjb25zdCBjb2xvciA9IGFwcGx5Q29sb3JPZmZzZXQodHlwZUNvbG9yLCBvZmZzZXQpO1xuICAgICAgZm9yIChjb25zdCBlbCBvZiB0aGlzLmNvbnRlbnRFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLmZyZWQtdHlwLXN1YnR5cGUtY29sb3ItZG90XCIpKSB7XG4gICAgICAgIGlmIChlbC5mcmVkU3VidHlwZSA9PT0gc3VidHlwZSkgcGFpbnRDb2xvckRvdChlbCwgY29sb3IsICFoYXNDb2xvck9mZnNldChvZmZzZXQpIHx8ICFzZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdKTtcbiAgICAgIH1cbiAgICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHJvdygpO1xuICAgIH07XG5cbiAgICBmb3IgKGNvbnN0IHsga2V5LCBsYWJlbCwgdW5pdCB9IG9mIFNVQlRZUEVfQ09MT1JfQ0hBTk5FTFMpIHtcbiAgICAgIGNvbnN0IFttaW4sIG1heF0gPSBjaGFubmVsQm91bmRzKHNldHRpbmdzLCBrZXkpO1xuICAgICAgY29uc3Qgcm93ID0gcG9wb3Zlci5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtc3VidHlwZS1jb2xvci1yb3dcIiB9KTtcbiAgICAgIHJvdy5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLXN1YnR5cGUtY29sb3ItbGFiZWxcIiwgdGV4dDogbGFiZWwgfSk7XG4gICAgICBjb25zdCBpbnB1dCA9IHJvdy5jcmVhdGVFbChcImlucHV0XCIsIHsgdHlwZTogXCJyYW5nZVwiLCBjbHM6IFwic2xpZGVyIGZyZWQtdHlwLXN1YnR5cGUtY29sb3Itc2xpZGVyXCIgfSk7XG4gICAgICBpbnB1dC5taW4gPSBTdHJpbmcobWluKTtcbiAgICAgIGlucHV0Lm1heCA9IFN0cmluZyhtYXgpO1xuICAgICAgaW5wdXQuc3RlcCA9IFwiMVwiO1xuICAgICAgaW5wdXQudmFsdWUgPSBTdHJpbmcob2Zmc2V0W2tleV0pO1xuICAgICAgaW5wdXQuZGlzYWJsZWQgPSBtaW4gPT09IG1heDtcbiAgICAgIGNvbnN0IHZhbHVlRWwgPSByb3cuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1zdWJ0eXBlLWNvbG9yLXZhbHVlXCIgfSk7XG4gICAgICBpbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiaW5wdXRcIiwgKCkgPT4ge1xuICAgICAgICBvZmZzZXRba2V5XSA9IE51bWJlcihpbnB1dC52YWx1ZSk7XG4gICAgICAgIHVwZGF0ZSgpO1xuICAgICAgfSk7XG4gICAgICByb3dzLnB1c2goKCkgPT4ge1xuICAgICAgICBjb25zdCBzdGVwcyA9IDg7XG4gICAgICAgIGNvbnN0IHN0b3BzID0gW107XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDw9IHN0ZXBzOyBpKyspIHtcbiAgICAgICAgICBzdG9wcy5wdXNoKGFwcGx5Q29sb3JPZmZzZXQodHlwZUNvbG9yLCB7IC4uLm9mZnNldCwgW2tleV06IG1pbiArICgobWF4IC0gbWluKSAqIGkpIC8gc3RlcHMgfSkpO1xuICAgICAgICB9XG4gICAgICAgIGlucHV0LnN0eWxlLnNldFByb3BlcnR5KFwiLS1mcmVkLXRyYWNrXCIsIGBsaW5lYXItZ3JhZGllbnQodG8gcmlnaHQsICR7c3RvcHMuam9pbihcIiwgXCIpfSlgKTtcbiAgICAgICAgdmFsdWVFbC5zZXRUZXh0KGAke29mZnNldFtrZXldID4gMCA/IFwiK1wiIDogXCJcIn0ke29mZnNldFtrZXldfSR7dW5pdH1gKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICB1cGRhdGUoKTtcblxuICAgIC8vIFVudGVyIGRlbSBQdW5rdCwgYWJlciBpbm5lcmhhbGIgZGVzIEZlbnN0ZXJzLlxuICAgIGNvbnN0IHJlY3QgPSBhbmNob3JFbC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICBjb25zdCB3aW4gPSBkb2MuZGVmYXVsdFZpZXc7XG4gICAgY29uc3Qgd2lkdGggPSBwb3BvdmVyLm9mZnNldFdpZHRoO1xuICAgIGNvbnN0IGhlaWdodCA9IHBvcG92ZXIub2Zmc2V0SGVpZ2h0O1xuICAgIHBvcG92ZXIuc3R5bGUubGVmdCA9IGAke01hdGgubWF4KDgsIE1hdGgubWluKHJlY3QubGVmdCwgd2luLmlubmVyV2lkdGggLSB3aWR0aCAtIDgpKX1weGA7XG4gICAgcG9wb3Zlci5zdHlsZS50b3AgPSBgJHtyZWN0LmJvdHRvbSArIDYgKyBoZWlnaHQgPiB3aW4uaW5uZXJIZWlnaHQgLSA4ID8gcmVjdC50b3AgLSA2IC0gaGVpZ2h0IDogcmVjdC5ib3R0b20gKyA2fXB4YDtcblxuICAgIGNvbnN0IG9uUG9pbnRlckRvd24gPSAoZXZlbnQpID0+IHtcbiAgICAgIGlmICghcG9wb3Zlci5jb250YWlucyhldmVudC50YXJnZXQpKSBjbG9zZSgpO1xuICAgIH07XG4gICAgY29uc3Qgb25LZXlEb3duID0gKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoZXZlbnQua2V5ICE9PSBcIkVzY2FwZVwiKSByZXR1cm47XG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICBjbG9zZSgpO1xuICAgIH07XG4gICAgY29uc3QgY2xvc2UgPSBhc3luYyAoKSA9PiB7XG4gICAgICB0aGlzLmNsb3NlU3VidHlwZUNvbG9yUG9wb3ZlciA9IG51bGw7XG4gICAgICBkb2MucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNlZG93blwiLCBvblBvaW50ZXJEb3duLCB0cnVlKTtcbiAgICAgIGRvYy5yZW1vdmVFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCBvbktleURvd24sIHRydWUpO1xuICAgICAgcG9wb3Zlci5yZW1vdmUoKTtcbiAgICAgIGNvbnN0IGN1cnJlbnQgPSBnZXRTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKTtcbiAgICAgIGlmICghY3VycmVudCkgcmV0dXJuO1xuICAgICAgaWYgKGhhc0NvbG9yT2Zmc2V0KG9mZnNldCkpIGN1cnJlbnQuY29sb3IgPSB7IC4uLm9mZnNldCB9O1xuICAgICAgZWxzZSBkZWxldGUgY3VycmVudC5jb2xvcjtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICB0aGlzLnJlbmRlcigpO1xuICAgIH07XG4gICAgdGhpcy5jbG9zZVN1YnR5cGVDb2xvclBvcG92ZXIgPSBjbG9zZTtcbiAgICBkb2MuYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlZG93blwiLCBvblBvaW50ZXJEb3duLCB0cnVlKTtcbiAgICBkb2MuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgb25LZXlEb3duLCB0cnVlKTtcbiAgfVxuXG4gIC8vIExcdTAwRjZzY2h0IGRlbiBTdWJ0eXAtQmxvY2sgc2FtdCBzZWluZXIgUHJvcGVydGllcy4gRGllIE5vdGl6ZW4gYmVoYWx0ZW4gaWhyZW5cbiAgLy8gU1VCVFlQLVdlcnQgKGVyIGVyc2NoZWludCBkYW5hY2ggdW50ZW4gYWxzIG5pY2h0IGVyZmFzc3RlciBTdWJ0eXApIC0gZWluZVxuICAvLyBCZXN0XHUwMEU0dGlndW5nIGJyYXVjaHQgZXMgZGFoZXIgbnVyLCB3ZW5uIGRhYmVpIFByb3BlcnRpZXMgdmVybG9yZW4gZ2VoZW4uXG4gIGRlbGV0ZVN1YnR5cGVXaXRoQ29uZmlybSh0eXBlLCBzdWJ0eXBlKSB7XG4gICAgY29uc3QgYXBwbHkgPSBhc3luYyAoKSA9PiB7XG4gICAgICBkZWxldGVTdWJ0eXBlKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKTtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICB0aGlzLnJlbmRlcigpO1xuICAgIH07XG4gICAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKGdldFN1YnR5cGUodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpPy5mcm9udG1hdHRlciA/PyB7fSkuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gXCJcIik7XG4gICAgaWYgKGtleXMubGVuZ3RoID09PSAwKSB7XG4gICAgICBhcHBseSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBuZXcgQ29uZmlybVN1YnR5cGVNb2RhbCh0aGlzLmFwcCwge1xuICAgICAgcGFyYWdyYXBoczogW1xuICAgICAgICBgU3VidHlwICR7c3VidHlwZX0gdm9uICR7dHlwZX0gd2lya2xpY2ggbFx1MDBGNnNjaGVuP2AsXG4gICAgICAgIGAke2tleXMubGVuZ3RoID09PSAxID8gXCJEaWUgUHJvcGVydHlcIiA6IGBEaWUgJHtrZXlzLmxlbmd0aH0gUHJvcGVydGllc2B9ICR7a2V5cy5qb2luKFwiLCBcIil9ICR7a2V5cy5sZW5ndGggPT09IDEgPyBcImdlaHRcIiA6IFwiZ2VoZW5cIn0gZGFiZWkgdmVybG9yZW4uYCxcbiAgICAgIF0sXG4gICAgICBjb25maXJtVGV4dDogXCJMXHUwMEY2c2NoZW5cIixcbiAgICAgIGNvbmZpcm1DbHM6IFwibW9kLXdhcm5pbmdcIixcbiAgICAgIG9uQ29uZmlybTogYXBwbHksXG4gICAgfSkub3BlbigpO1xuICB9XG5cbiAgLy8gV2llIHN0YXJ0RGV0YWlsUmVuYW1lKCksIGFiZXIgYXVmIGRlbSBUaXRlbCBlaW5lcyBTdWJ0eXAtQmxvY2tzLiBEZXIgQmxvY2tcbiAgLy8gYmVoXHUwMEU0bHQgc2VpbmUgUG9zaXRpb247IHVwZGF0ZU5vdGVzOiB0cnVlIHNjaHJlaWJ0IG5hY2ggQmVzdFx1MDBFNHRpZ3VuZyBhdWNoIGRlblxuICAvLyBTVUJUWVAgZGVyIGJldHJvZmZlbmVuIE5vdGl6ZW4gdW0uIEVpbiBiZXJlaXRzIHZvcmhhbmRlbmVyIE5hbWUgYmlldGV0XG4gIC8vIHN0YXR0ZGVzc2VuIGRhcyBadXNhbW1lbmxlZ2VuIGFuIChzY2hyZWlidCBkaWUgTm90aXplbiBpbW1lciBtaXQgdW0pLlxuICBzdGFydFN1YnR5cGVSZW5hbWUodHlwZSwgc3VidHlwZSwgdGl0bGVFbCwgeyB1cGRhdGVOb3RlcyA9IGZhbHNlIH0gPSB7fSkge1xuICAgIGlmICh0aGlzLmlzRWRpdGluZykgcmV0dXJuO1xuICAgIHRoaXMuaXNFZGl0aW5nID0gdHJ1ZTtcblxuICAgIHRpdGxlRWwuYWRkQ2xhc3MoXCJmcmVkLXR5cC1zdWJ0eXBlLW5hbWUtaW5wdXRcIiwgXCJpcy1iZWluZy1yZW5hbWVkXCIpO1xuICAgIHRpdGxlRWwuc2V0QXR0cmlidXRlKFwiY29udGVudGVkaXRhYmxlXCIsIFwidHJ1ZVwiKTtcbiAgICB0aXRsZUVsLnNldEF0dHJpYnV0ZShcInNwZWxsY2hlY2tcIiwgXCJmYWxzZVwiKTtcbiAgICB0aXRsZUVsLmZvY3VzKCk7XG5cbiAgICBjb25zdCByYW5nZSA9IHRpdGxlRWwuZG9jLmNyZWF0ZVJhbmdlKCk7XG4gICAgcmFuZ2Uuc2VsZWN0Tm9kZUNvbnRlbnRzKHRpdGxlRWwpO1xuICAgIGNvbnN0IHNlbGVjdGlvbiA9IHRpdGxlRWwud2luLmdldFNlbGVjdGlvbigpO1xuICAgIHNlbGVjdGlvbi5yZW1vdmVBbGxSYW5nZXMoKTtcbiAgICBzZWxlY3Rpb24uYWRkUmFuZ2UocmFuZ2UpO1xuXG4gICAgY29uc3QgY291bnRPZiA9IChuYW1lKSA9PiB0aGlzLnBsdWdpbi50eXBJbmRleC5zdWJ0eXBlQnVja2V0KHR5cGUpLmNvdW50cy5nZXQobmFtZSkgPz8gMDtcbiAgICBjb25zdCBhcHBseVJlbmFtZSA9IGFzeW5jICh2YWx1ZSwgeyB3aXRoTm90ZXMgfSkgPT4ge1xuICAgICAgcmVuYW1lU3VidHlwZSh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSwgdmFsdWUpO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICBjb25zdCByZW5hbWVkID0gd2l0aE5vdGVzID8gYXdhaXQgcmVuYW1lU3VidHlwZUluTm90ZXModGhpcy5wbHVnaW4sIHR5cGUsIHN1YnR5cGUsIHZhbHVlKSA6IDA7XG4gICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgIGlmICh3aXRoTm90ZXMpIG5ldyBOb3RpY2UoYFNVQlRZUCAke3ZhbHVlfTogJHtyZW5hbWVkfSBOb3RpeihlbikgYW5nZXBhc3N0LmApO1xuICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICB9O1xuXG4gICAgbGV0IGRvbmUgPSBmYWxzZTtcbiAgICBjb25zdCBmaW5pc2ggPSBhc3luYyAoY29tbWl0KSA9PiB7XG4gICAgICBpZiAoZG9uZSkgcmV0dXJuO1xuICAgICAgZG9uZSA9IHRydWU7XG4gICAgICB0aGlzLmlzRWRpdGluZyA9IGZhbHNlO1xuXG4gICAgICBjb25zdCB2YWx1ZSA9IG5vcm1hbGl6ZVN1YnR5cGVOYW1lKHRpdGxlRWwudGV4dENvbnRlbnQpO1xuICAgICAgaWYgKCFjb21taXQgfHwgIXZhbHVlIHx8IHZhbHVlID09PSBzdWJ0eXBlKSB7XG4gICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgY29uc3QgZXhpc3RpbmcgPSBnZXRTdWJ0eXBlTmFtZXModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUpLmZpbmQoXG4gICAgICAgIChuYW1lKSA9PiBuYW1lLnRvTG93ZXJDYXNlKCkgPT09IHZhbHVlLnRvTG93ZXJDYXNlKCkgJiYgbmFtZSAhPT0gc3VidHlwZVxuICAgICAgKTtcbiAgICAgIGlmIChleGlzdGluZykge1xuICAgICAgICBuZXcgQ29uZmlybVN1YnR5cGVNb2RhbCh0aGlzLmFwcCwge1xuICAgICAgICAgIHBhcmFncmFwaHM6IFtcbiAgICAgICAgICAgIGBTdWJ0eXAgJHtleGlzdGluZ30gZXhpc3RpZXJ0IGJlaSAke3R5cGV9IGJlcmVpdHMuICR7c3VidHlwZX0gZGFtaXQgenVzYW1tZW5sZWdlbj9gLFxuICAgICAgICAgICAgYCR7Y291bnRPZihzdWJ0eXBlKX0gTm90aXooZW4pIHdlcmRlbiBhdWYgJHtleGlzdGluZ30gdW1nZXN0ZWxsdCwgZGllIFByb3BlcnRpZXMgdm9uICR7c3VidHlwZX0gd2FuZGVybiBpbiBkZW4gQmxvY2sgJHtleGlzdGluZ30uYCxcbiAgICAgICAgICBdLFxuICAgICAgICAgIGNvbmZpcm1UZXh0OiBcIlp1c2FtbWVubGVnZW5cIixcbiAgICAgICAgICBjb25maXJtQ2xzOiBcIm1vZC13YXJuaW5nXCIsXG4gICAgICAgICAgb25Db25maXJtOiBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBtZXJnZVN1YnR5cGVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlLCBleGlzdGluZyk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIGNvbnN0IHJlbmFtZWQgPSBhd2FpdCByZW5hbWVTdWJ0eXBlSW5Ob3Rlcyh0aGlzLnBsdWdpbiwgdHlwZSwgc3VidHlwZSwgZXhpc3RpbmcpO1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgICAgICBuZXcgTm90aWNlKGBTdWJ0eXAgJHtzdWJ0eXBlfSBtaXQgJHtleGlzdGluZ30genVzYW1tZW5nZWxlZ3QsICR7cmVuYW1lZH0gTm90aXooZW4pIGFuZ2VwYXNzdC5gKTtcbiAgICAgICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICAgICAgfSxcbiAgICAgICAgICBvbkNhbmNlbDogKCkgPT4gdGhpcy5yZW5kZXIoKSxcbiAgICAgICAgfSkub3BlbigpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmICghdXBkYXRlTm90ZXMpIHtcbiAgICAgICAgYXdhaXQgYXBwbHlSZW5hbWUodmFsdWUsIHsgd2l0aE5vdGVzOiBmYWxzZSB9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgbmV3IENvbmZpcm1TdWJ0eXBlTW9kYWwodGhpcy5hcHAsIHtcbiAgICAgICAgcGFyYWdyYXBoczogW2BTdWJ0eXAgJHtzdWJ0eXBlfSBpbiAke3ZhbHVlfSB1bWJlbmVubmVuIHVuZCAke2NvdW50T2Yoc3VidHlwZSl9IE5vdGl6KGVuKSBlbnRzcHJlY2hlbmQgYW5wYXNzZW4/YF0sXG4gICAgICAgIGNvbmZpcm1UZXh0OiBcIlVtYmVuZW5uZW5cIixcbiAgICAgICAgY29uZmlybUNsczogXCJtb2QtY3RhXCIsXG4gICAgICAgIG9uQ29uZmlybTogKCkgPT4gYXBwbHlSZW5hbWUodmFsdWUsIHsgd2l0aE5vdGVzOiB0cnVlIH0pLFxuICAgICAgICBvbkNhbmNlbDogKCkgPT4gdGhpcy5yZW5kZXIoKSxcbiAgICAgIH0pLm9wZW4oKTtcbiAgICB9O1xuXG4gICAgLy8gQWxsZSBUYXN0ZW4gaGllciBiZWhhbHRlbjogZGVyIFRpdGVsIHN0ZWh0IGluIGRlciBMaXN0ZSB2b24gT2JzaWRpYW5zXG4gICAgLy8gUHJvcGVydHktRWRpdG9yLCBkZXNzZW4gZWlnZW5lIFRhc3RhdHVyLU5hdmlnYXRpb24gc29uc3QgbWl0cmVhZ2llcnRlXG4gICAgLy8gKEVzY2FwZSB6dXNcdTAwRTR0emxpY2ggd2VnZW4gZGVyIERldGFpbGFuc2ljaHQsIHNpZWhlIG9uT3BlbikuXG4gICAgdGl0bGVFbC5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgaWYgKGV2ZW50LmtleSA9PT0gXCJFbnRlclwiKSB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGZpbmlzaCh0cnVlKTtcbiAgICAgIH0gZWxzZSBpZiAoZXZlbnQua2V5ID09PSBcIkVzY2FwZVwiKSB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGZpbmlzaChmYWxzZSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgdGl0bGVFbC5hZGRFdmVudExpc3RlbmVyKFwiYmx1clwiLCAoKSA9PiBmaW5pc2godHJ1ZSkpO1xuICB9XG5cbiAgLy8gV2llIGRpZSB1bnJlZ2lzdHJpZXJ0ZW4gRWludHJcdTAwRTRnZSBkZXIgVFlQLUxpc3RlOiBTVUJUWVAtV2VydGUgdm9uIE5vdGl6ZW5cbiAgLy8gZGllc2VzIFRZUHMsIGRpZSAobm9jaCkga2VpbmVuIGVpZ2VuZW4gQmxvY2sgaGFiZW4gKE5vdGl6ZW4gZ2FueiBvaG5lXG4gIC8vIFNVQlRZUCB6XHUwMEU0aGx0IHN0YXR0ZGVzc2VuIGRhcyBUWVAtRnJvbnRtYXR0ZXIpLiBEYXJnZXN0ZWxsdCB3aWUgZGllXG4gIC8vIFN1YnR5cC1CbFx1MDBGNmNrZSwgYWJlciBudXIgbWl0IFx1MDBEQ2JlcnNjaHJpZnQgc2FtdCBBbnphaGwuIEVpbiBLbGljayBhdWYgZGllXG4gIC8vIEJsb2NrZmxcdTAwRTRjaGUgXHUwMEZDYmVybmltbXQgZGVuIFdlcnQgYWxzIFN1YnR5cCwgZWluIEtsaWNrIGF1ZiBkZW4gTmFtZW4gXHUwMEY2ZmZuZXRcbiAgLy8gc3RhdHRkZXNzZW4gZGllIFN1Y2hlIC0gdm9yIGRlbSBFcmZhc3NlbiBuYWNoenVzZWhlbiwgd2FzIGluIGVpbmVtIFdlcnRcbiAgLy8gZWlnZW50bGljaCBzdGVja3QsIGlzdCBoaWVyIGRlciBoXHUwMEU0dWZpZ2UgRmFsbC4gRGVyIE5hbWUgaGVidCBzaWNoIGJlaW1cbiAgLy8gSG92ZXJuIGluIEFremVudGZhcmJlIGFiIHVuZCB6ZWlndCBkYW1pdCBzZWxic3QgYW4sIGRhc3MgZXIgZXR3YXMgYW5kZXJlc1xuICAvLyB0dXQgYWxzIGRpZSBGbFx1MDBFNGNoZSB1bSBpaG4gaGVydW0uXG4gIHJlbmRlclVucmVnaXN0ZXJlZFN1YnR5cGVzKHBhcmVudCwgdHlwZSwgYnVja2V0KSB7XG4gICAgY29uc3QgcmVnaXN0ZXJlZCA9IGdldFN1YnR5cGVOYW1lcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSk7XG4gICAgY29uc3QgdW5yZWdpc3RlcmVkID0gWy4uLmJ1Y2tldC5jb3VudHMua2V5cygpXVxuICAgICAgLmZpbHRlcigoa2V5KSA9PiAhcmVnaXN0ZXJlZC5pbmNsdWRlcyhrZXkpKVxuICAgICAgLnNvcnQoKGEsIGIpID0+IGJ1Y2tldC5jb3VudHMuZ2V0KGIpIC0gYnVja2V0LmNvdW50cy5nZXQoYSkgfHwgYS5sb2NhbGVDb21wYXJlKGIpKTtcbiAgICBpZiAodW5yZWdpc3RlcmVkLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gICAgY29uc3QgbGlzdEVsID0gcGFyZW50LmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1zdWJ0eXBlLXVucmVnaXN0ZXJlZC1saXN0XCIgfSk7XG4gICAgZm9yIChjb25zdCBrZXkgb2YgdW5yZWdpc3RlcmVkKSB7XG4gICAgICBjb25zdCBibG9jayA9IGxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItYmxvY2sgZnJlZC10eXAtc3VidHlwZS1ibG9jayBmcmVkLXR5cC1zdWJ0eXBlLXVucmVnaXN0ZXJlZFwiIH0pO1xuICAgICAgY29uc3QgaGVhZGVyID0gYmxvY2suY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLWhlYWRlclwiIH0pO1xuICAgICAgY29uc3QgdGl0bGVHcm91cCA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItdGl0bGUtZ3JvdXBcIiB9KTtcbiAgICAgIGNvbnN0IHRpdGxlRWwgPSB0aXRsZUdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtc2VjdGlvbi10aXRsZVwiLCB0ZXh0OiBkaXNwbGF5VHlwZUtleShrZXkpIH0pO1xuICAgICAgdGl0bGVHcm91cC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLXN1YnR5cGUtY291bnRcIiwgdGV4dDogU3RyaW5nKGJ1Y2tldC5jb3VudHMuZ2V0KGtleSkpIH0pO1xuICAgICAgYmxvY2suYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMucmVnaXN0ZXJTdWJ0eXBlKHR5cGUsIGtleSwgYnVja2V0KSk7XG4gICAgICAvLyBzdG9wUHJvcGFnYXRpb24sIHNvbnN0IGVyZmFzc3RlIGRlcnNlbGJlIEtsaWNrIFx1MDBGQ2JlciBkZW4gQmxvY2stSGFuZGxlclxuICAgICAgLy8genVzXHUwMEU0dHpsaWNoIGRlbiBXZXJ0LCBkZW4gbWFuIGdlcmFkZSBlcnN0IG5hY2hzY2hsYWdlbiB3b2xsdGUuXG4gICAgICB0aGlzLm1ha2VTZWFyY2hhYmxlKHRpdGxlRWwsICgpID0+IHRoaXMub3BlblN1YnR5cGVTZWFyY2godHlwZSwga2V5KSwgeyBzdG9wUHJvcGFnYXRpb246IHRydWUgfSk7XG4gICAgfVxuICB9XG5cbiAgLy8gRWluIE5hbWUsIGRlc3NlbiBLbGljayBkaWUgU3VjaGUgXHUwMEY2ZmZuZXQ6IFplaWdlci1DdXJzb3IgdW5kIEFremVudGZhcmJlIGJlaW1cbiAgLy8gSG92ZXJuIChzaWVoZSAuZnJlZC10eXAtc2VhcmNoYWJsZSBpbiBzdHlsZXMuY3NzKSwgZGFtaXQgZGllIEFuc2ljaHQgc2VsYnN0XG4gIC8vIHplaWd0LCB3byBldHdhcyBwYXNzaWVydC4gRGllIFN1Y2hlIGxhZyBoaWVyIGZyXHUwMEZDaGVyIGF1ZiBkZW0gUmVjaHRza2xpY2sgLVxuICAvLyBiZWltIFRZUC1Gcm9udG1hdHRlciBhdWYgZGVtIFRpdGVsLCBiZWkgU3VidHlwLUJsXHUwMEY2Y2tlbiBhdWYgZGVyIGdhbnplblxuICAvLyBCbG9ja2ZsXHUwMEU0Y2hlIC0gdW5kIHdhciBkYW1pdCBwcmFrdGlzY2ggdW5hdWZmaW5kYmFyOiBuaWNodHMgZGV1dGV0ZSBkYXJhdWZcbiAgLy8gaGluLCB1bmQgZWluIFJlY2h0c2tsaWNrIGlzdCBcdTAwRkNiZXJhbGwgc29uc3QgZWluIEtvbnRleHRtZW5cdTAwRkMuIERlciBOYW1lIGlzdFxuICAvLyBkZXIgT3J0LCBhbiBkZW0gbWFuIFwiemVpZyBtaXIgZGllc2UgTm90aXplblwiIGVyd2FydGV0LCBhbHNvIGhcdTAwRTRuZ3QgZXMgamV0enRcbiAgLy8gZ2VuYXUgZG9ydC4gV1x1MDBFNGhyZW5kIGVpbmVyIFVtYmVuZW5udW5nIHRyXHUwMEU0Z3QgZGFzc2VsYmUgRWxlbWVudCBkaWUgS2xhc3NlXG4gIC8vIGlzLWJlaW5nLXJlbmFtZWQgdW5kIGlzdCBlaW4gRWluZ2FiZWZlbGQgLSBkYW5uIGRhcmYgZWluIEtsaWNrIGhpbmVpbiBkZW5cbiAgLy8gQ3Vyc29yIHNldHplbiB1bmQga2VpbmUgU3VjaGUgYXVzbFx1MDBGNnNlbi5cbiAgbWFrZVNlYXJjaGFibGUoZWwsIG9uU2VhcmNoLCB7IHN0b3BQcm9wYWdhdGlvbiA9IGZhbHNlIH0gPSB7fSkge1xuICAgIGVsLmFkZENsYXNzKFwiZnJlZC10eXAtc2VhcmNoYWJsZVwiKTtcbiAgICBlbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoZWwuaGFzQ2xhc3MoXCJpcy1iZWluZy1yZW5hbWVkXCIpKSByZXR1cm47XG4gICAgICBpZiAoc3RvcFByb3BhZ2F0aW9uKSBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIG9uU2VhcmNoKCk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBzdWJ0eXBlS2V5ID09PSBudWxsIFx1MjE5MiBOb3RpemVuIGRpZXNlcyBUWVBzIG9obmUgU1VCVFlQLiBGXHUwMEZDciBlaW5lIExpc3RlXG4gIC8vIGdpYnQgZXMgd2llIGJlaSBvcGVuU2VhcmNoKCkga2VpbmUgZXhha3RlIFN1Y2hzeW50YXggLSBkYW5uIG5hY2ggTm90aXplblxuICAvLyBzdWNoZW4sIGRpZSBhbGxlIGlocmUgRWludHJcdTAwRTRnZSB0cmFnZW4uXG4gIG9wZW5TdWJ0eXBlU2VhcmNoKHR5cGUsIHN1YnR5cGVLZXkpIHtcbiAgICBjb25zdCBnbG9iYWxTZWFyY2ggPSB0aGlzLnBsdWdpbi5hcHAuaW50ZXJuYWxQbHVnaW5zLmdldFBsdWdpbkJ5SWQoXCJnbG9iYWwtc2VhcmNoXCIpO1xuICAgIGlmICghZ2xvYmFsU2VhcmNoKSByZXR1cm47XG4gICAgY29uc3QgdHlwQ2xhdXNlID0gdGhpcy50eXBlQ2xhdXNlKHR5cGUpO1xuICAgIGxldCBzdWJ0eXBDbGF1c2U7XG4gICAgaWYgKHN1YnR5cGVLZXkgPT09IG51bGwpIHtcbiAgICAgIHN1YnR5cENsYXVzZSA9IGAtW1wiJHtTVUJUWVBfUFJPUEVSVFl9XCJdYDtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgcmF3ID0gdGhpcy5wbHVnaW4udHlwSW5kZXguc3VidHlwZUJ1Y2tldCh0eXBlKS5yYXdCeUtleS5nZXQoc3VidHlwZUtleSk7XG4gICAgICBzdWJ0eXBDbGF1c2UgPSBBcnJheS5pc0FycmF5KHJhdylcbiAgICAgICAgPyByYXcubWFwKCh2KSA9PiBgW1wiJHtTVUJUWVBfUFJPUEVSVFl9XCI6XCIke1N0cmluZyh2ID8/IFwiXCIpLnRyaW0oKX1cIl1gKS5qb2luKFwiIFwiKVxuICAgICAgICA6IGBbXCIke1NVQlRZUF9QUk9QRVJUWX1cIjpcIiR7c3VidHlwZUtleX1cIl1gO1xuICAgIH1cbiAgICBnbG9iYWxTZWFyY2guaW5zdGFuY2Uub3Blbkdsb2JhbFNlYXJjaChgJHt0eXBDbGF1c2V9ICR7c3VidHlwQ2xhdXNlfWApO1xuICB9XG5cbiAgLy8gV2llIHJlZ2lzdGVyVHlwZSgpOiBcdTAwRkNiZXJuaW1tdCBkaWUgYmVyZWluaWd0ZSBGb3JtIChHcm9cdTAwREZidWNoc3RhYmVuLCBMaXN0ZVxuICAvLyBhbHMgRWluemVsd2VydCBcIkEsIEJcIikgYWxzIFN1YnR5cCBkaWVzZXMgVFlQcyB1bmQgc2NocmVpYnQgZGVuIFNVQlRZUCBkZXJcbiAgLy8gYmV0cm9mZmVuZW4gTm90aXplbiBnbGVpY2ggbWl0IHVtLiBHaWJ0IGVzIGRlbiBTdWJ0eXAgaW4gYW5kZXJlciBTY2hyZWliLVxuICAvLyB3ZWlzZSBzY2hvbiwgbGFuZGVuIGRpZSBOb3RpemVuIGRvcnQuXG4gIGFzeW5jIHJlZ2lzdGVyU3VidHlwZSh0eXBlLCBzdWJ0eXBlS2V5LCBidWNrZXQpIHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmFwcGx5U3VidHlwZVJlZ2lzdHJhdGlvbih0eXBlLCBzdWJ0eXBlS2V5LCBidWNrZXQpO1xuICAgIGlmICghcmVzdWx0KSByZXR1cm47XG5cbiAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICBpZiAocmVzdWx0LnJlbmFtZWQgPiAwKSBuZXcgTm90aWNlKGBTVUJUWVAgJHtyZXN1bHQuc3VidHlwZX0gcmVnaXN0cmllcnQsICR7cmVzdWx0LnJlbmFtZWR9IE5vdGl6KGVuKSBhbmdlcGFzc3QuYCk7XG4gIH1cblxuICAvLyBXaWUgYXBwbHlUeXBlUmVnaXN0cmF0aW9uIGZcdTAwRkNyIGRlbiBUWVA6IGRlciBWb3JnYW5nIG9obmUgU3BlaWNoZXJuIHVuZFxuICAvLyBOb3RpY2UsIGRhbWl0IHJlZ2lzdGVyVHlwZVdpdGhTdWJ0eXBlKCkgaWhuIG1pdCBkZXIgVFlQLUVyZmFzc3VuZyBiXHUwMEZDbmRlbG5cbiAgLy8ga2Fubi4gTGllZmVydCB7IHN1YnR5cGUsIHJlbmFtZWQgfSBvZGVyIG51bGwuXG4gIGFzeW5jIGFwcGx5U3VidHlwZVJlZ2lzdHJhdGlvbih0eXBlLCBzdWJ0eXBlS2V5LCBidWNrZXQpIHtcbiAgICBjb25zdCByYXcgPSBidWNrZXQucmF3QnlLZXkuZ2V0KHN1YnR5cGVLZXkpO1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVSYXdUeXBlKHJhdyA9PT0gdW5kZWZpbmVkID8gc3VidHlwZUtleSA6IHJhdywgbm9ybWFsaXplU3VidHlwZU5hbWUpO1xuICAgIGlmICghbm9ybWFsaXplZCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgZXhpc3RpbmcgPSBnZXRTdWJ0eXBlTmFtZXModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUpLmZpbmQoKG5hbWUpID0+IG5hbWUudG9Mb3dlckNhc2UoKSA9PT0gbm9ybWFsaXplZC50b0xvd2VyQ2FzZSgpKTtcbiAgICBjb25zdCBzdWJ0eXBlID0gZXhpc3RpbmcgPz8gbm9ybWFsaXplZDtcbiAgICBlbnN1cmVTdWJ0eXBlKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKTtcblxuICAgIGNvbnN0IHJlbmFtZWQgPSBzdWJ0eXBlICE9PSBzdWJ0eXBlS2V5ID8gYXdhaXQgcmVuYW1lU3VidHlwZUluTm90ZXModGhpcy5wbHVnaW4sIHR5cGUsIHN1YnR5cGVLZXksIHN1YnR5cGUpIDogMDtcbiAgICByZXR1cm4geyBzdWJ0eXBlLCByZW5hbWVkIH07XG4gIH1cblxuICAvLyBOZXVlciwgbGVlcmVyIFN1YnR5cC1CbG9jayBkaXJla3QgXHUwMEZDYmVyIGRlbSBcIlN1YnR5cCBoaW56dWZcdTAwRkNnZW5cIi1CdXR0b24sXG4gIC8vIGRlc3NlbiBOYW1lIHNvZm9ydCBpbmxpbmUgZWluZ2VnZWJlbiB3aXJkICh3aWUgc3RhcnRBZGQoKSBpbiBkZXIgTGlzdGUpLlxuICBzdGFydEFkZFN1YnR5cGUodHlwZSkge1xuICAgIGlmICh0aGlzLmlzRWRpdGluZyB8fCAhdGhpcy5zdWJ0eXBlQWRkQnRuRWwpIHJldHVybjtcbiAgICB0aGlzLmlzRWRpdGluZyA9IHRydWU7XG5cbiAgICAvLyBBdWZnZWJhdXQgd2llIGRlciBmZXJ0aWdlIChsZWVyZSkgQmxvY2sgaW0gZ2VtZWluc2FtZW4gRWRpdG9yIC0gc2FtdCBkZW5cbiAgICAvLyBcIitcIi1CdXR0b25zIHVuZCBkZW4gQWt0aW9uZW4gaW0gQWJzY2hsdXNzLCBkaWUgaGllciBub2NoIG5pY2h0cyB0dW4sIG51clxuICAgIC8vIG5vY2ggb2huZSBBbnphaGwgLSwgZGFtaXQgYmVpbSBBYnNjaGxpZVx1MDBERmVuIGRlciBFaW5nYWJlIG5pY2h0cyBzcHJpbmd0XG4gICAgLy8gKHNpZWhlIC5mcmVkLXR5cC1zdWJ0eXBlLXBlbmRpbmcpLlxuICAgIGNvbnN0IGJsb2NrID0gY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLWJsb2NrIGZyZWQtdHlwLXN1YnR5cGUtYmxvY2sgZnJlZC10eXAtc3VidHlwZS1wZW5kaW5nXCIgfSk7XG4gICAgdGhpcy5zdWJ0eXBlQWRkQnRuRWwucGFyZW50RWxlbWVudC5pbnNlcnRCZWZvcmUoYmxvY2ssIHRoaXMuc3VidHlwZUFkZEJ0bkVsKTtcbiAgICBjb25zdCBoZWFkZXIgPSBibG9jay5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItaGVhZGVyXCIgfSk7XG4gICAgY29uc3QgdGl0bGVHcm91cCA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItdGl0bGUtZ3JvdXBcIiB9KTtcbiAgICBjb25zdCBuYW1lRWwgPSB0aXRsZUdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtc2VjdGlvbi10aXRsZSBmcmVkLXR5cC1zdWJ0eXBlLW5hbWUtaW5wdXQgaXMtYmVpbmctcmVuYW1lZFwiIH0pO1xuICAgIGNvbnN0IGFkZEJ1dHRvbnMgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLWFkZC1ncm91cFwiIH0pO1xuICAgIHNldEljb24oYWRkQnV0dG9ucy5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gZnJlZC10eXAtZnJvbnRtYXR0ZXItYWRkLWZsb2F0aW5nXCIgfSksIFwicGx1c1wiKTtcbiAgICBzZXRJY29uKGFkZEJ1dHRvbnMuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWZyb250bWF0dGVyLWFkZFwiIH0pLCBcInBsdXNcIik7XG4gICAgY29uc3QgZm9vdGVyID0gYmxvY2suY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLXNlY3Rpb24tZm9vdGVyIGZyZWQtdHlwLXN1YnR5cGUtYWN0aW9uc1wiIH0pO1xuICAgIGNvbnN0IGNvbG9yR3JvdXAgPSBmb290ZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLXN1YnR5cGUtY29sb3ItZ3JvdXBcIiB9KTtcbiAgICBwYWludENvbG9yRG90KGNvbG9yR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLXN1YnR5cGUtY29sb3ItZG90XCIgfSksIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV0gPz8gREVGQVVMVF9UWVBFX0NPTE9SLCB0cnVlKTtcbiAgICBzZXRJY29uKGNvbG9yR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWNvbG9yLXJlc2V0IGlzLWRpc2FibGVkXCIgfSksIFwicm90YXRlLWNjd1wiKTtcbiAgICBjb25zdCBhY3Rpb25zID0gZm9vdGVyLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1zdWJ0eXBlLWFjdGlvbi1ncm91cFwiIH0pO1xuICAgIHNldEljb24oYWN0aW9ucy5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gZnJlZC10eXAtZGV0YWlsLXJlbmFtZS1ub3Rlc1wiIH0pLCBcInBlbmNpbFwiKTtcbiAgICBzZXRJY29uKGFjdGlvbnMuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWRldGFpbC1yZW5hbWVcIiB9KSwgXCJwZW5jaWxcIik7XG4gICAgLy8gWnVzdGFuZCB3aWUgZGVyLCBkZW4gZW5zdXJlU3VidHlwZSBkZW0gbmV1ZW4gU3VidHlwIGdsZWljaCBnZWJlbiB3aXJkOlxuICAgIC8vIGRlciBzZWluZXMgVFlQcyAoc2llaGUgc3VidHlwZXMuanMpLlxuICAgIGNvbnN0IG1hbnVhbENscyA9IFwiY2xpY2thYmxlLWljb24gZnJlZC10eXAtbWFudWFsLWljb25cIiArICh0aGlzLmVuc3VyZVR5cGVNYW51YWwoKVt0eXBlXSAhPT0gZmFsc2UgPyBcIiBpcy1hY3RpdmVcIiA6IFwiXCIpO1xuICAgIHNldEljb24oYWN0aW9ucy5jcmVhdGVEaXYoeyBjbHM6IG1hbnVhbENscyB9KSwgXCJmaWxlLXBlbi1saW5lXCIpO1xuICAgIHNldEljb24oYWN0aW9ucy5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gZnJlZC10eXAtZGV0YWlsLWRlbGV0ZVwiIH0pLCBcInRyYXNoXCIpO1xuICAgIG5hbWVFbC5zZXRBdHRyaWJ1dGUoXCJjb250ZW50ZWRpdGFibGVcIiwgXCJ0cnVlXCIpO1xuICAgIG5hbWVFbC5zZXRBdHRyaWJ1dGUoXCJzcGVsbGNoZWNrXCIsIFwiZmFsc2VcIik7XG4gICAgbmFtZUVsLmZvY3VzKCk7XG5cbiAgICBsZXQgZG9uZSA9IGZhbHNlO1xuICAgIGNvbnN0IGZpbmlzaCA9IGFzeW5jIChjb21taXQpID0+IHtcbiAgICAgIGlmIChkb25lKSByZXR1cm47XG4gICAgICBkb25lID0gdHJ1ZTtcbiAgICAgIHRoaXMuaXNFZGl0aW5nID0gZmFsc2U7XG5cbiAgICAgIGNvbnN0IHZhbHVlID0gbm9ybWFsaXplU3VidHlwZU5hbWUobmFtZUVsLnRleHRDb250ZW50KTtcbiAgICAgIGlmIChjb21taXQgJiYgdmFsdWUpIHtcbiAgICAgICAgY29uc3QgZXhpc3RpbmcgPSBnZXRTdWJ0eXBlTmFtZXModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUpLmZpbmQoKG5hbWUpID0+IG5hbWUudG9Mb3dlckNhc2UoKSA9PT0gdmFsdWUudG9Mb3dlckNhc2UoKSk7XG4gICAgICAgIGlmIChleGlzdGluZykge1xuICAgICAgICAgIG5ldyBOb3RpY2UoYFN1YnR5cCAke2V4aXN0aW5nfSBnaWJ0IGVzIGJlaSAke3R5cGV9IGJlcmVpdHMuYCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZW5zdXJlU3VidHlwZSh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgdmFsdWUpO1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICB0aGlzLnJlbmRlcigpO1xuICAgIH07XG5cbiAgICBuYW1lRWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVudGVyXCIpIHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgIGZpbmlzaCh0cnVlKTtcbiAgICAgIH0gZWxzZSBpZiAoZXZlbnQua2V5ID09PSBcIkVzY2FwZVwiKSB7XG4gICAgICAgIC8vIHN0b3BQcm9wYWdhdGlvbiwgc29uc3QgdmVybFx1MDBFNHNzdCBkZXIgRXNjYXBlLUhhbmRsZXIgZGVyIGdlc2FtdGVuXG4gICAgICAgIC8vIERldGFpbGFuc2ljaHQgc2llIGdsZWljaCBtaXQuXG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICBmaW5pc2goZmFsc2UpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIG5hbWVFbC5hZGRFdmVudExpc3RlbmVyKFwiYmx1clwiLCAoKSA9PiBmaW5pc2godHJ1ZSkpO1xuICB9XG5cbiAgc2hvd0RlbGV0ZUNvbmZpcm0odHlwZSkge1xuICAgIG5ldyBDb25maXJtRGVsZXRlVHlwZU1vZGFsKHRoaXMucGx1Z2luLCB0eXBlLCBhc3luYyAoKSA9PiB7XG4gICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlcyA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVzLmZpbHRlcigodCkgPT4gdCAhPT0gdHlwZSk7XG4gICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXTtcbiAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3R5cGVdO1xuICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV07XG4gICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXTtcbiAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlU2hvcnRjdXRzW3R5cGVdO1xuICAgICAgZGVsZXRlIHRoaXMuZW5zdXJlVHlwZU1hbnVhbCgpW3R5cGVdO1xuICAgICAgZGVsZXRlVHlwZVN1YnR5cGVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlKTtcbiAgICAgIC8vIFZvciByZWZyZXNoVHlwQ29sb3JzKCkgenVyXHUwMEZDY2sgenVyIExpc3RlLCBhdXMgZGVtc2VsYmVuIEdydW5kIHdpZSBiZWltXG4gICAgICAvLyBVbWJlbmVubmVuOiByZWZyZXNoVHlwQ29sb3JzKCkgcmVuZGVydCAodS4gYS4gXHUwMEZDYmVyIHJlZ2lzdGVyVHlwVmlldylcbiAgICAgIC8vIHN5bmNocm9uIG5ldSAtIHN0XHUwMEZDbmRlIHNlbGVjdGVkVHlwZSBub2NoIGF1ZiBkZW0gZ2VyYWRlIGdlbFx1MDBGNnNjaHRlblxuICAgICAgLy8gVHlwLCB3XHUwMEZDcmRlIGRlc3NlbiBqZXR6dCBkYXRlbmxvc2UgRGV0YWlsYW5zaWNodCBrdXJ6IGVybmV1dCBnZXJlbmRlcnQuXG4gICAgICB0aGlzLmNsb3NlVHlwZVNldHRpbmdzKCk7XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgIH0pLm9wZW4oKTtcbiAgfVxuXG4gIC8vIFdpZSBzdGFydEVkaXRpbmcoKSwgYWJlciBhdWYgZGVtIGZyZWlzdGVoZW5kZW4gVGl0ZWwtRWxlbWVudCBkZXIgRGV0YWlsLUFuc2ljaHRcbiAgLy8gc3RhdHQgYXVmIGVpbmVtIFRyZWUtSXRlbSAtIHVuZCBtaXQgcmVzdWx0aWVyZW5kZW0gc2VsZWN0ZWRUeXBlLVdlY2hzZWwgc3RhdHRcbiAgLy8gZWluZXMgc2NobGljaHRlbiBSZS1SZW5kZXJzIGRlciBMaXN0ZS4gdXBkYXRlTm90ZXM6IHRydWUgKHp3ZWl0ZXIsIGhlcnZvci1cbiAgLy8gZ2Vob2JlbmVyIEJ1dHRvbikgc2NocmVpYnQgbmFjaCBCZXN0XHUwMEU0dGlndW5nIHp1c1x1MDBFNHR6bGljaCBkZW4gVFlQLVdlcnQgYWxsZXJcbiAgLy8gYmV0cm9mZmVuZW4gTm90aXplbiB1bSAoc2llaGUgcmVuYW1lVHlwZUluTm90ZXMpLCBzdGF0dCBudXIgZGllIFBsdWdpbi1cbiAgLy8gRWluc3RlbGx1bmdlbiB6dSBtaWdyaWVyZW4uXG4gIHN0YXJ0RGV0YWlsUmVuYW1lKHR5cGUsIHRpdGxlRWwsIHsgdXBkYXRlTm90ZXMgPSBmYWxzZSB9ID0ge30pIHtcbiAgICBpZiAodGhpcy5pc0VkaXRpbmcpIHJldHVybjtcbiAgICB0aGlzLmlzRWRpdGluZyA9IHRydWU7XG5cbiAgICB0aXRsZUVsLmFkZENsYXNzKFwiaXMtYmVpbmctcmVuYW1lZFwiKTtcbiAgICB0aXRsZUVsLnNldEF0dHJpYnV0ZShcImNvbnRlbnRlZGl0YWJsZVwiLCBcInRydWVcIik7XG4gICAgdGl0bGVFbC5zZXRBdHRyaWJ1dGUoXCJzcGVsbGNoZWNrXCIsIFwiZmFsc2VcIik7XG4gICAgdGl0bGVFbC5mb2N1cygpO1xuXG4gICAgY29uc3QgcmFuZ2UgPSB0aXRsZUVsLmRvYy5jcmVhdGVSYW5nZSgpO1xuICAgIHJhbmdlLnNlbGVjdE5vZGVDb250ZW50cyh0aXRsZUVsKTtcbiAgICBjb25zdCBzZWxlY3Rpb24gPSB0aXRsZUVsLndpbi5nZXRTZWxlY3Rpb24oKTtcbiAgICBzZWxlY3Rpb24ucmVtb3ZlQWxsUmFuZ2VzKCk7XG4gICAgc2VsZWN0aW9uLmFkZFJhbmdlKHJhbmdlKTtcblxuICAgIC8vIE1pZ3JpZXJ0IG51ciBkaWUgUGx1Z2luLUVpbnN0ZWxsdW5nZW4gKExpc3RlLCBGYXJiZSwgQmVzY2hyZWlidW5nLFxuICAgIC8vIFRZUC1Gcm9udG1hdHRlciwgTWFudWVsbGVyLVRZUC1TY2hhbHRlcikgYXVmIGRlbiBuZXVlbiBOYW1lbiAtXG4gICAgLy8gclx1MDBGQ2hydCBrZWluZSBOb3RpemVuIGFuLiBHZW1laW5zYW0gZ2VudXR6dCB2b24gYmVpZGVuIFVtYmVuZW5uZW4tUGZhZGVuLlxuICAgIGNvbnN0IGFwcGx5UmVuYW1lID0gYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICBjb25zdCBpZHggPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlcy5pbmRleE9mKHR5cGUpO1xuICAgICAgaWYgKGlkeCAhPT0gLTEpIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVzW2lkeF0gPSB2YWx1ZTtcbiAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdO1xuICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXTtcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3R5cGVdICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3R5cGVdO1xuICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXTtcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdO1xuICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXTtcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdO1xuICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXTtcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlU2hvcnRjdXRzW3R5cGVdICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZVNob3J0Y3V0c1t2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlU2hvcnRjdXRzW3R5cGVdO1xuICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZVNob3J0Y3V0c1t0eXBlXTtcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLmVuc3VyZVR5cGVNYW51YWwoKVt0eXBlXSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVNYW51YWxbdmFsdWVdID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZU1hbnVhbFt0eXBlXTtcbiAgICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVNYW51YWxbdHlwZV07XG4gICAgICB9XG4gICAgICBtb3ZlVHlwZVN1YnR5cGVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlLCB2YWx1ZSk7XG4gICAgICAvLyBWb3IgcmVmcmVzaFR5cENvbG9ycygpIHNldHplbjogZGFzIHJ1ZnQgKHUuIGEuIFx1MDBGQ2JlciBkZW4gaW5cbiAgICAgIC8vIHJlZ2lzdGVyVHlwVmlldyB6dXJcdTAwRkNja2dlZ2ViZW5lbiBSZWZyZXNoKSBzeW5jaHJvbiByZW5kZXIoKSBhdWYgLVxuICAgICAgLy8gc3RcdTAwRkNuZGUgc2VsZWN0ZWRUeXBlIG5vY2ggYXVmIGRlbSBhbHRlbiAoYmVyZWl0cyBtaWdyaWVydGVuLFxuICAgICAgLy8gZGFoZXIgamV0enQgZGF0ZW4tbG9zZW4pIE5hbWVuLCB3XHUwMEZDcmRlIGt1cnp6ZWl0aWcgZ2VuYXUgZGVyIEFsdC1cbiAgICAgIC8vIE5hbWUgbWl0IGxlZXJlbiBEYXRlbiBnZXJlbmRlcnQuXG4gICAgICB0aGlzLnNlbGVjdGVkVHlwZSA9IHZhbHVlO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICB9O1xuXG4gICAgbGV0IGRvbmUgPSBmYWxzZTtcbiAgICBjb25zdCBmaW5pc2ggPSBhc3luYyAoY29tbWl0KSA9PiB7XG4gICAgICBpZiAoZG9uZSkgcmV0dXJuO1xuICAgICAgZG9uZSA9IHRydWU7XG4gICAgICB0aGlzLmlzRWRpdGluZyA9IGZhbHNlO1xuXG4gICAgICBjb25zdCB2YWx1ZSA9IG5vcm1hbGl6ZVR5cGVOYW1lKHRpdGxlRWwudGV4dENvbnRlbnQpO1xuICAgICAgaWYgKCFjb21taXQgfHwgIXZhbHVlIHx8IHZhbHVlID09PSB0eXBlKSB7XG4gICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlcy5maW5kKFxuICAgICAgICAodCkgPT4gdC50b0xvd2VyQ2FzZSgpID09PSB2YWx1ZS50b0xvd2VyQ2FzZSgpICYmIHQgIT09IHR5cGVcbiAgICAgICk7XG4gICAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgICAgdGhpcy5zaG93TWVyZ2VDb25maXJtKHR5cGUsIGV4aXN0aW5nKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAoIXVwZGF0ZU5vdGVzKSB7XG4gICAgICAgIGF3YWl0IGFwcGx5UmVuYW1lKHZhbHVlKTtcbiAgICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICAvLyBCdWxrLVNjaHJlaWJ2b3JnYW5nIFx1MDBGQ2JlciBwb3RlbnppZWxsIHZpZWxlIERhdGVpZW4gLSB2b3JoZXIgYmVzdFx1MDBFNHRpZ2VuXG4gICAgICAvLyBsYXNzZW4sIHN0YXR0IHNvZm9ydCB6dSBzcGVpY2hlcm4uXG4gICAgICBjb25zdCB7IGNvdW50cyB9ID0gdGhpcy5wbHVnaW4udHlwSW5kZXgudHlwZUNvdW50cygpO1xuICAgICAgbmV3IENvbmZpcm1SZW5hbWVUeXBlTW9kYWwoXG4gICAgICAgIHRoaXMucGx1Z2luLFxuICAgICAgICB0eXBlLFxuICAgICAgICB2YWx1ZSxcbiAgICAgICAgY291bnRzLmdldCh0eXBlKSA/PyAwLFxuICAgICAgICBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYXdhaXQgYXBwbHlSZW5hbWUodmFsdWUpO1xuICAgICAgICAgIGNvbnN0IHJlbmFtZWQgPSBhd2FpdCByZW5hbWVUeXBlSW5Ob3Rlcyh0aGlzLnBsdWdpbiwgdHlwZSwgdmFsdWUpO1xuICAgICAgICAgIG5ldyBOb3RpY2UoYFRZUCAke3ZhbHVlfTogJHtyZW5hbWVkfSBOb3RpeihlbikgYW5nZXBhc3N0LmApO1xuICAgICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICAgIH0sXG4gICAgICAgICgpID0+IHRoaXMucmVuZGVyKClcbiAgICAgICkub3BlbigpO1xuICAgIH07XG5cbiAgICB0aXRsZUVsLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIChldmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmtleSA9PT0gXCJFbnRlclwiKSB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICBmaW5pc2godHJ1ZSk7XG4gICAgICB9IGVsc2UgaWYgKGV2ZW50LmtleSA9PT0gXCJFc2NhcGVcIikge1xuICAgICAgICAvLyBzdG9wUHJvcGFnYXRpb24sIHNvbnN0IGdyZWlmdCB6dXNcdTAwRTR0emxpY2ggZGVyIEVzY2FwZS1IYW5kbGVyIGRlclxuICAgICAgICAvLyBnZXNhbXRlbiBEZXRhaWwtQW5zaWNodCB1bmQgdmVybFx1MDBFNHNzdCBzaWUgZ2xlaWNoIG1pdC5cbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgIGZpbmlzaChmYWxzZSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICB0aXRsZUVsLmFkZEV2ZW50TGlzdGVuZXIoXCJibHVyXCIsICgpID0+IGZpbmlzaCh0cnVlKSk7XG4gIH1cblxuICBzaG93TWVyZ2VDb25maXJtKHNvdXJjZSwgdGFyZ2V0KSB7XG4gICAgY29uc3QgeyBjb3VudHMgfSA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnR5cGVDb3VudHMoKTtcbiAgICBuZXcgQ29uZmlybU1lcmdlVHlwZU1vZGFsKFxuICAgICAgdGhpcy5wbHVnaW4sXG4gICAgICBzb3VyY2UsXG4gICAgICB0YXJnZXQsXG4gICAgICBjb3VudHMuZ2V0KHNvdXJjZSkgPz8gMCxcbiAgICAgICgpID0+IHRoaXMubWVyZ2VUeXBlKHNvdXJjZSwgdGFyZ2V0KSxcbiAgICAgICgpID0+IHRoaXMucmVuZGVyKClcbiAgICApLm9wZW4oKTtcbiAgfVxuXG4gIC8vIExlZ3Qgc291cmNlIGluIHRhcmdldCBhdWY6IE5vdGl6ZW4gd2VyZGVuIGF1ZiB0YXJnZXQgdW1nZXNjaHJpZWJlbixcbiAgLy8gc291cmNlIHZlcnNjaHdpbmRldCBhdXMgZGVyIFRZUC1MaXN0ZSBzYW10IGVpZ2VuZXIgRWluc3RlbGx1bmdlbiAodGFyZ2V0XG4gIC8vIGJlaFx1MDBFNGx0IHNlaW5lKS4gRGllIFN1YnR5cGVuIHZvbiBzb3VyY2Ugd2VyZGVuIFx1MDBGQ2Jlcm5vbW1lbiwgZ2xlaWNobmFtaWdlXG4gIC8vIEJsXHUwMEY2Y2tlIHp1c2FtbWVuZ2VmXHUwMEZDaHJ0IChzaWVoZSBtZXJnZVR5cGVTdWJ0eXBlcyBpbiBzdWJ0eXBlcy5qcykuXG4gIC8vXG4gIC8vIFwiTWFudWVsbCBlcnN0ZWxsYmFyXCIgaXN0IGRlciBlaW5lIEZhbGwsIGluIGRlbSBkYXMgWnVzYW1tZW5sZWdlbiBuaWNodCBudXJcbiAgLy8gRGF0ZW4gdW1oXHUwMEU0bmd0OiBkaWUgXHUwMEZDYmVybm9tbWVuZW4gU3VidHlwZW4gYnJpbmdlbiBpaHJlbiBlaWdlbmVuIFNjaGFsdGVyXG4gIC8vIG1pdCwgZGVyIHZvbiBzb3VyY2Ugc3RhbW10LCBnZXJhdGVuIGFiZXIgdW50ZXIgZGVuIFNjaGFsdGVyIHZvbiB0YXJnZXQuXG4gIC8vIFdhciBzb3VyY2UgYW4gdW5kIHRhcmdldCBhdXMsIHN0XHUwMEZDbmRlbiBzaWUgZGFuYWNoIGFscyBhbmdlc2NoYWx0ZXRlXG4gIC8vIFN1YnR5cGVuIHVudGVyIGVpbmVtIGFiZ2VzY2hhbHRldGVuIFRZUCAtIGltIFBpY2tlciB1bmVycmVpY2hiYXIsIGRhIGVyXG4gIC8vIG51ciBcdTAwRkNiZXIgZGVuIFRZUCB6dSBpaG5lbiBmXHUwMEZDaHJ0LiBFaW4gYWJnZXNjaGFsdGV0ZXMgdGFyZ2V0IHppZWh0IHNpZVxuICAvLyBkZXNoYWxiIG1pdCBhYiwgZ2VuYXUgd2llIHNlaW4gZWlnZW5lciBLbm9wZiBlcyB0XHUwMEU0dGUgKHNpZWhlXG4gIC8vIHJlbmRlck1hbnVhbFRvZ2dsZSkuIElzdCB0YXJnZXQgYW4sIGJsZWliZW4gc2llLCB3aWUgc2llIHdhcmVuIC0gZWluXG4gIC8vIGFiZ2VzY2hhbHRldGVyIFN1YnR5cCB1bnRlciBlaW5lbSBhbmdlc2NoYWx0ZXRlbiBUWVAgaXN0IGRlciBOb3JtYWxmYWxsLFxuICAvLyB1bmQgZGFzIGlzdCwgd2FzIGJlaSBzb3VyY2UgZWluZ2VzdGVsbHQgd2FyLlxuICBhc3luYyBtZXJnZVR5cGUoc291cmNlLCB0YXJnZXQpIHtcbiAgICBjb25zdCBzZXR0aW5ncyA9IHRoaXMucGx1Z2luLnNldHRpbmdzO1xuICAgIGNvbnN0IHJlbmFtZWQgPSBhd2FpdCByZW5hbWVUeXBlSW5Ob3Rlcyh0aGlzLnBsdWdpbiwgc291cmNlLCB0YXJnZXQpO1xuXG4gICAgc2V0dGluZ3MudHlwZXMgPSBzZXR0aW5ncy50eXBlcy5maWx0ZXIoKHQpID0+IHQgIT09IHNvdXJjZSk7XG4gICAgZGVsZXRlIHNldHRpbmdzLnR5cGVDb2xvcnNbc291cmNlXTtcbiAgICBkZWxldGUgc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1tzb3VyY2VdO1xuICAgIGRlbGV0ZSBzZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3NvdXJjZV07XG4gICAgZGVsZXRlIHNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbc291cmNlXTtcbiAgICBkZWxldGUgc2V0dGluZ3MudHlwZVNob3J0Y3V0c1tzb3VyY2VdO1xuICAgIGRlbGV0ZSB0aGlzLmVuc3VyZVR5cGVNYW51YWwoKVtzb3VyY2VdO1xuICAgIG1lcmdlVHlwZVN1YnR5cGVzKHNldHRpbmdzLCBzb3VyY2UsIHRhcmdldCk7XG4gICAgaWYgKHRoaXMuZW5zdXJlVHlwZU1hbnVhbCgpW3RhcmdldF0gPT09IGZhbHNlKSBzZXRBbGxTdWJ0eXBlc01hbnVhbChzZXR0aW5ncywgdGFyZ2V0LCBmYWxzZSk7XG5cbiAgICAvLyBWb3IgcmVmcmVzaFR5cENvbG9ycygpIHNldHplbiwgYXVzIGRlbXNlbGJlbiBHcnVuZCB3aWUgaW4gYXBwbHlSZW5hbWUuXG4gICAgdGhpcy5zZWxlY3RlZFR5cGUgPSB0YXJnZXQ7XG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgbmV3IE5vdGljZShgVFlQICR7c291cmNlfSBtaXQgJHt0YXJnZXR9IHp1c2FtbWVuZ2VsZWd0LCAke3JlbmFtZWR9IE5vdGl6KGVuKSBhbmdlcGFzc3QuYCk7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfVxuXG4gIHJlbmRlckNvdW50RmxhaXIoc2VsZiwgY291bnQpIHtcbiAgICBjb25zdCBmbGFpck91dGVyID0gc2VsZi5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLWZsYWlyLW91dGVyXCIgfSk7XG4gICAgZmxhaXJPdXRlci5jcmVhdGVTcGFuKHsgY2xzOiBcInRyZWUtaXRlbS1mbGFpclwiLCB0ZXh0OiBTdHJpbmcoY291bnQpIH0pO1xuICB9XG5cbiAgLy8gUmVpbiBpbmZvcm1hdGl2LCB1bnRlciBkZW0gVFlQLUZyb250bWF0dGVyLUVkaXRvcjogZXJrbFx1MDBFNHJ0IGRlblxuICAvLyBGbG9hdGluZy1Qcm9wZXJ0eS1Ub2dnbGUgKFJlY2h0c2tsaWNrIGF1ZiBlaW5lIFByb3BlcnR5IG9iZW4sIHNpZWhlXG4gIC8vIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoIGluIHR5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKS4gQmV3dXNzdCBvaG5lIGVpZ2VuZVxuICAvLyBcdTAwRENiZXJzY2hyaWZ0LCBkYSBkaXJla3QgdW50ZXIgZGVyIFByb3BlcnR5LUxpc3RlIG9obmVoaW4ga2xhciBpc3QsIHdvcmF1ZlxuICAvLyBzaWNoIGRlciBIaW53ZWlzIGJlemllaHQuXG4gIC8vXG4gIC8vIEhpZXIgc3RhbmQgZnJcdTAwRkNoZXIgenVzXHUwMEU0dHpsaWNoIGVpbmUgZmVzdGUgTGlzdGUgZGVyIFBsYXR6aGFsdGVyLVRva2VuLiBEaWVcbiAgLy8gaXN0IG1pdCBkZW0gU2hvcnRjdXQtS25vcGYgamUgUHJvcGVydHktWmVpbGUgZW50ZmFsbGVuOiBkZXNzZW4gQXVzd2FobFxuICAvLyAoc2hvcnRjdXQtcGlja2VyLmpzKSBmXHUwMEZDaHJ0IGRpZXNlbGJlbiBUb2tlbiwgYWJlciBhbSBPcnQgZGVyIFZlcndlbmR1bmcsXG4gIC8vIGR1cmNoc3VjaGJhciB1bmQgYmVpIFNrcmlwdGVuIHNhbXQgZGVyZW4gZWlnZW5lciBCZXNjaHJlaWJ1bmcuXG4gIHJlbmRlckZsb2F0aW5nSGludChwYXJlbnQpIHtcbiAgICBjb25zdCBzZWN0aW9uID0gcGFyZW50LmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1mbG9hdGluZy1oaW50LXNlY3Rpb25cIiB9KTtcbiAgICBzZWN0aW9uLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiZnJlZC10eXAtZmxvYXRpbmctaGludFwiLFxuICAgICAgdGV4dDogXCJZb3UgY2FuIGNoYW5nZSBhIHByb3BlcnR5IHRvIGZsb2F0aW5nIGluIHRoZSByaWdodC1jbGljayBtZW51LlwiLFxuICAgIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyVHlwVmlldyhwbHVnaW4pIHtcbiAgcGx1Z2luLnJlZ2lzdGVyVmlldyhWSUVXX1RZUEVfVFlQLCAobGVhZikgPT4gbmV3IFR5cFZpZXcobGVhZiwgcGx1Z2luKSk7XG5cbiAgcGx1Z2luLmFkZENvbW1hbmQoe1xuICAgIGlkOiBcInR5cC12aWV3LW9lZmZuZW5cIixcbiAgICBuYW1lOiBcIlRZUC1WaWV3IFx1MDBGNmZmbmVuXCIsXG4gICAgY2FsbGJhY2s6ICgpID0+IGFjdGl2YXRlVHlwVmlldyhwbHVnaW4pLFxuICB9KTtcblxuICBwbHVnaW4uYWRkQ29tbWFuZCh7XG4gICAgaWQ6IFwidHlwLXByb3BlcnR5LWhpbnp1ZnVlZ2VuXCIsXG4gICAgbmFtZTogXCJUWVAtUHJvcGVydHkgaGluenVmXHUwMEZDZ2VuXCIsXG4gICAgY2FsbGJhY2s6ICgpID0+IGFkZFR5cFByb3BlcnR5Q29tbWFuZChwbHVnaW4pLFxuICB9KTtcblxuICAvLyBCZWltIEhvdC1SZWxvYWQgYmxlaWJ0IGRlciBhbHRlIExlYWYgYWxzIE9iamVrdCB1bmFuZ2V0YXN0ZXQgYmVzdGVoZW4gKG51clxuICAvLyB1bnNlciBQbHVnaW4tTW9kdWwgd2lyZCBuZXUgZ2VsYWRlbiksIGFiZXIgXCJpbnN0YW5jZW9mIFR5cFZpZXdcIiBzY2hsXHUwMEU0Z3QgZ2VnZW5cbiAgLy8gZGllIG5ldSBnZWxhZGVuZSBLbGFzc2UgZmVobC4gYXBwLmpzIHNlbGJzdCBiZXN0aW1tdCBnZXRWaWV3VHlwZSgpIHJlaW4gYXVzXG4gIC8vIGxlYWYudmlldyAtIGRhcyByZWljaHQgenVyIEVya2VubnVuZyBhbHNvIG5pY2h0LiBhcHAgc2VsYnN0IFx1MDBGQ2JlcmxlYnQgZGVuXG4gIC8vIEhvdC1SZWxvYWQgZGFnZWdlbiB1bnZlclx1MDBFNG5kZXJ0LCBkYWhlciBkaWUgTGVhZi1SZWZlcmVueiBkaXJla3QgZG9ydCBhYmxlZ2VuLlxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IGFjdGl2YXRlVHlwVmlldyhwbHVnaW4sIGZhbHNlLCBmYWxzZSkpO1xuXG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShWSUVXX1RZUEVfVFlQKSkge1xuICAgICAgbGVhZi52aWV3Py5yZW5kZXI/LigpO1xuICAgIH1cbiAgfTtcblxuICAvLyBaXHUwMEU0aGxlciAoTGlzdGUgdW5kIFBpY2tlciwgc2llaGUgdHlwSW5kZXgudHlwZUNvdW50cygpKSBzb25zdCBudXIgc28gYWt0dWVsbFxuICAvLyB3aWUgYmVpbSBsZXR6dGVuIFJlbmRlciBkaWVzZXIgVmlldyAtIGplZGUgVFlQLXJlbGV2YW50ZSBcdTAwQzRuZGVydW5nIGFuZGVyc3dvXG4gIC8vIChuZXVlL2dlbFx1MDBGNnNjaHRlIE5vdGl6LCBUWVAgb2RlciBTVUJUWVAgdW1nZXRyYWdlbikgbGllXHUwMERGZSBzaWUgc29uc3QgdmVyYWx0ZW4sXG4gIC8vIGJpcyBpcmdlbmRlaW4gYW5kZXJlciBHcnVuZCAoei4gQi4gZWluZSBFaW5zdGVsbHVuZykgenVmXHUwMEU0bGxpZyBlaW5lbiBSZWZyZXNoXG4gIC8vIGF1c2xcdTAwRjZzdC4gRGFzIFwiY2hhbmdlXCItRXZlbnQgZGVzIEluZGV4IGZldWVydCBudXIgYmVpIGdlbmF1IHNvbGNoZW5cbiAgLy8gXHUwMEM0bmRlcnVuZ2VuLCBuaWNodCBiZWkgamVkZW0gQXV0b3NhdmUtVGljay4gVHJvdHpkZW0gZGVib3VuY2VkLCBkYSBkYXNcbiAgLy8gUmVuZGVybiBkZXIgTGlzdGUgdmVyZ2xlaWNoc3dlaXNlIHRldWVyIGlzdCAtIHJlc2V0VGltZXI6dHJ1ZSBzYW1tZWx0IGVpbmVcbiAgLy8gXHUwMEM0bmRlcnVuZ3NzZXJpZSAoei4gQi4gQnVsay1JbXBvcnQpIHp1IGVpbmVtIGVpbnppZ2VuIFJlZnJlc2guXG4gIGNvbnN0IGRlYm91bmNlZFJlZnJlc2ggPSBkZWJvdW5jZShyZWZyZXNoLCA1MDAsIHRydWUpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgZGVib3VuY2VkUmVmcmVzaCkpO1xuICAvLyBcdTAwQzRuZGVydCBkaWUgXCJFeGNsdWRlZCBmaWxlc1wiLUxpc3RlIHNlbGJzdCAoei4gQi4gSGlkZSBGb2xkZXJzIGJlaW0gQXVzLS9cbiAgLy8gRWluYmxlbmRlbiBlaW5lcyBPcmRuZXJzKSAtIE9ic2lkaWFucyBlaWdlbmVyIE1ldGFkYXRhQ2FjaGUgbGF1c2NodCBpbnRlcm5cbiAgLy8gZWJlbmZhbGxzIGdlbmF1IGF1ZiBkaWVzZXMgRXZlbnQsIHVtIHNlaW5lIElnbm9yZS1GaWx0ZXIgbmV1IHp1IGxhZGVuLlxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLnZhdWx0Lm9uKFwiY29uZmlnLWNoYW5nZWRcIiwgZGVib3VuY2VkUmVmcmVzaCkpO1xuXG4gIC8vIEZcdTAwRkNyIHBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzICh6LiBCLiBuYWNoIFVtc2NoYWx0ZW4gZGVyIFwiVFlQLUxpc3RlXG4gIC8vIGVpbmZcdTAwRTRyYmVuXCItRWluc3RlbGx1bmcpIC0gcmVuZGVydCBkaWUgTGlzdGUgKGJ6dy4gYmxlaWJ0IGluIGRlclxuICAvLyBEZXRhaWxhbnNpY2h0LCByZW5kZXIoKSBicmFuY2gndCBzZWxic3QpIG5ldS5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbi8vIGNyZWF0ZUlmTWlzc2luZzogZmFsc2UgYmVpbSBhdXRvbWF0aXNjaGVuIG9uTGF5b3V0UmVhZHktQXVmcnVmIChzaWVoZVxuLy8gcmVnaXN0ZXJUeXBWaWV3KSAtIGRlciBzb2xsIGF1c3NjaGxpZVx1MDBERmxpY2ggZWluZW4gYmVpbSBIb3QtUmVsb2FkIHZlcndhaXN0ZW4sXG4vLyBhYmVyIGJlcmVpdHMgdm9yaGFuZGVuZW4gTGVhZiB3aWVkZXJ2ZXJiaW5kZW4gKHNpZWhlIEtvbW1lbnRhciBkb3J0KSwgbmljaHRcbi8vIGJlaSBqZWRlbSByZWd1bFx1MDBFNHJlbiBPYnNpZGlhbi1TdGFydCB1bmNvbmRpdGlvbmFsIGVpbmVuIG5ldWVuIExlYWYgZXJ6ZXVnZW5cbi8vIHVuZCBha3RpdmllcmVuLiBXYXIgZGllIFRZUC1QYW5lIGJlaW0gbGV0enRlbiBCZWVuZGVuIGdlc2NobG9zc2VuIChvZGVyXG4vLyBlaW5lbSBmcmlzY2hlbiBWYXVsdCksIGJsZWlidCBzaWUgb2huZSBkaWVzZSBVbnRlcnNjaGVpZHVuZyBzb25zdCBhdWNoIHp1LlxuYXN5bmMgZnVuY3Rpb24gYWN0aXZhdGVUeXBWaWV3KHBsdWdpbiwgcmV2ZWFsID0gdHJ1ZSwgY3JlYXRlSWZNaXNzaW5nID0gdHJ1ZSkge1xuICBjb25zdCBhcHAgPSBwbHVnaW4uYXBwO1xuICBjb25zdCB7IHdvcmtzcGFjZSB9ID0gYXBwO1xuXG4gIGNvbnN0IGNhbmRpZGF0ZXMgPSBbXTtcbiAgd29ya3NwYWNlLml0ZXJhdGVBbGxMZWF2ZXMoKGxlYWYpID0+IHtcbiAgICBpZiAobGVhZiA9PT0gYXBwLl9fZnJlZFR5cExlYWYgfHwgKGxlYWYudmlldyAmJiBsZWFmLnZpZXcuZ2V0Vmlld1R5cGUoKSA9PT0gVklFV19UWVBFX1RZUCkpIHtcbiAgICAgIGNhbmRpZGF0ZXMucHVzaChsZWFmKTtcbiAgICB9XG4gIH0pO1xuXG4gIGxldCBsZWFmID0gY2FuZGlkYXRlcy5zaGlmdCgpID8/IG51bGw7XG4gIGZvciAoY29uc3QgZXh0cmEgb2YgY2FuZGlkYXRlcykgZXh0cmEuZGV0YWNoKCk7XG5cbiAgaWYgKCFsZWFmKSB7XG4gICAgaWYgKCFjcmVhdGVJZk1pc3NpbmcpIHJldHVybjtcbiAgICBsZWFmID0gd29ya3NwYWNlLmdldExlZnRMZWFmKGZhbHNlKTtcbiAgICBhd2FpdCBsZWFmLnNldFZpZXdTdGF0ZSh7IHR5cGU6IFZJRVdfVFlQRV9UWVAsIGFjdGl2ZTogdHJ1ZSB9KTtcbiAgfSBlbHNlIGlmICghKGxlYWYudmlldyBpbnN0YW5jZW9mIFR5cFZpZXcpKSB7XG4gICAgLy8gYWN0aXZlOiBmYWxzZSAtIHJlaW5lcyBXaWVkZXJ2ZXJiaW5kZW4gbmFjaCBIb3QtUmVsb2FkIChzaWVoZSBLb21tZW50YXJcbiAgICAvLyBvYmVuIGFuIGFjdGl2YXRlVHlwVmlldyksIGRlciBMZWFmIGlzdCBqYSBiZXJlaXRzIHZvcmhhbmRlbi9zaWNodGJhci5cbiAgICAvLyBNaXQgYWN0aXZlOiB0cnVlIHdcdTAwRkNyZGUgamVkZXIgUGx1Z2luLVJlbG9hZCAobmljaHQgbnVyIGVpbiBBcHAtTmV1c3RhcnQpXG4gICAgLy8gZGVuIGdsb2JhbGVuIEZva3VzIGF1ZiBkaWUgVFlQLVBhbmUgcmVpXHUwMERGZW4gLSBvbkxheW91dFJlYWR5KCkgZmV1ZXJ0XG4gICAgLy8gc2VpbmVuIENhbGxiYWNrIHNvZm9ydCwgc29iYWxkIHdvcmtzcGFjZS5sYXlvdXRSZWFkeSBlaW5tYWwgdHJ1ZSBpc3QsXG4gICAgLy8gYWxzbyBiZWkgamVkZW0gZWluemVsbmVuIEhvdC1SZWxvYWQgd1x1MDBFNGhyZW5kIGRlciBFbnR3aWNrbHVuZyBlcm5ldXQuXG4gICAgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoeyB0eXBlOiBWSUVXX1RZUEVfVFlQLCBhY3RpdmU6IGZhbHNlIH0pO1xuICB9XG5cbiAgYXBwLl9fZnJlZFR5cExlYWYgPSBsZWFmO1xuICBpZiAocmV2ZWFsKSB3b3Jrc3BhY2UucmV2ZWFsTGVhZihsZWFmKTtcbn1cblxuLy8gVm9ycmFuZ2lnIGluIGRlciBiZXJlaXRzIG9mZmVuZW4gVFlQLURldGFpbGFuc2ljaHQgKGRhbm4gZXhha3Qgd2llIGRlclxuLy8gZG9ydGlnZSArLUJ1dHRvbiksIHNvbnN0IHdpcmQgZGllIERldGFpbGFuc2ljaHQgZlx1MDBGQ3IgZGVuIFRZUCBkZXIgYWt0aXZlblxuLy8gTm90aXogZ2VcdTAwRjZmZm5ldCB1bmQgZGllIFByb3BlcnR5IGRvcnQgZXJnXHUwMEU0bnp0LiBJc3Qga2VpbmUgTm90aXogb2ZmZW4gb2RlclxuLy8gaGF0IHNpZSBrZWluZW4gVFlQLCBkaWVudCBlaW5lIHp3YXIgbmljaHQgZm9rdXNzaWVydGUsIGFiZXIgaW4gZGVyXG4vLyBEZXRhaWxhbnNpY2h0IG9mZmVuZSBUWVAtVmlldyBhbHMgUlx1MDBGQ2NrZmFsbGViZW5lLiBJc3QgbnVyIGRpZSBUWVBlbi1MaXN0ZVxuLy8gb2ZmZW4gKGtlaW4gc2VsZWN0ZWRUeXBlKSwgelx1MDBFNGhsdCBkYXMgbmljaHQgYWxzIFwib2ZmZW5lIERldGFpbGFuc2ljaHRcIiAtXG4vLyBkYWZcdTAwRkNyIGZlaGx0IGRvcnQgZWluIEZyb250bWF0dGVyLUVkaXRvciwgYW4gZGVtIHNpY2ggZXR3YXMgaGluenVmXHUwMEZDZ2VuIGxpZVx1MDBERmUuXG5hc3luYyBmdW5jdGlvbiBhZGRUeXBQcm9wZXJ0eUNvbW1hbmQocGx1Z2luKSB7XG4gIGNvbnN0IGFwcCA9IHBsdWdpbi5hcHA7XG5cbiAgY29uc3QgYWN0aXZlVHlwVmlldyA9IGFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShUeXBWaWV3KTtcbiAgaWYgKGFjdGl2ZVR5cFZpZXcgJiYgYWN0aXZlVHlwVmlldy5zZWxlY3RlZFR5cGUgIT09IG51bGwpIHtcbiAgICBhY3RpdmVUeXBWaWV3LmZyb250bWF0dGVyQmxvY2tzPy5hZGRCbGFuayhudWxsKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBmaWxlID0gYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gIGNvbnN0IHR5cGUgPSBwbHVnaW4udHlwSW5kZXgudHlwZU9mKGZpbGUpO1xuICBpZiAoIXR5cGUpIHtcbiAgICBjb25zdCBvcGVuTGVhZiA9IGFwcC53b3Jrc3BhY2VcbiAgICAgIC5nZXRMZWF2ZXNPZlR5cGUoVklFV19UWVBFX1RZUClcbiAgICAgIC5maW5kKChsZWFmKSA9PiBsZWFmLnZpZXcgaW5zdGFuY2VvZiBUeXBWaWV3ICYmIGxlYWYudmlldy5zZWxlY3RlZFR5cGUgIT09IG51bGwpO1xuICAgIGlmIChvcGVuTGVhZikge1xuICAgICAgYXdhaXQgYXBwLndvcmtzcGFjZS5yZXZlYWxMZWFmKG9wZW5MZWFmKTtcbiAgICAgIG9wZW5MZWFmLnZpZXcuZnJvbnRtYXR0ZXJCbG9ja3M/LmFkZEJsYW5rKG51bGwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBuZXcgTm90aWNlKGZpbGUgPyBcIkFrdGl2ZSBOb3RpeiBoYXQga2VpbmVuIFRZUCB1bmQgaW4gZGVyIFRZUC1WaWV3IGlzdCBrZWluIFRZUCBnZVx1MDBGNmZmbmV0LlwiIDogXCJLZWluZSBOb3RpeiBvZmZlbiB1bmQgaW4gZGVyIFRZUC1WaWV3IGlzdCBrZWluIFRZUCBnZVx1MDBGNmZmbmV0LlwiKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBhd2FpdCBhY3RpdmF0ZVR5cFZpZXcocGx1Z2luKTtcbiAgY29uc3QgdmlldyA9IGFwcC5fX2ZyZWRUeXBMZWFmPy52aWV3O1xuICBpZiAoISh2aWV3IGluc3RhbmNlb2YgVHlwVmlldykpIHJldHVybjtcbiAgdmlldy5vcGVuVHlwZVNldHRpbmdzKHR5cGUpO1xuICB2aWV3LmZyb250bWF0dGVyQmxvY2tzPy5hZGRCbGFuayhudWxsKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyVHlwVmlldywgVklFV19UWVBFX1RZUCwgY29tcGFyZVR5cGVzLCBzb3J0VHlwZXNCeU1vZGUsIERFRkFVTFRfU09SVF9PUkRFUiwgREVGQVVMVF9UWVBFX0NPTE9SIH07XG4iLCAiY29uc3QgeyBURmlsZSwgVEZvbGRlciB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBjb2xvckZvckZpbGUgfSA9IHJlcXVpcmUoXCIuL3R5cGUtY29sb3JzXCIpO1xuXG5jb25zdCBGSUxFX0VYUExPUkVSX1ZJRVdfVFlQRSA9IFwiZmlsZS1leHBsb3JlclwiO1xuY29uc3QgRk9MREVSX05PVEVTX1BMVUdJTl9JRCA9IFwiZm9sZGVyLW5vdGVzXCI7XG5cbi8vIERhcyBcIkZvbGRlciBOb3Rlc1wiLVBsdWdpbiB6ZWlndCBlaW5lIE5vdGl6IHN0YXR0IGFscyBlaWdlbmUgWmVpbGUgYWxzIE9yZG5lciBhbi5cbi8vIEVzIGhhdCBrZWluZSBcdTAwRjZmZmVudGxpY2hlIEFQSSBkYWZcdTAwRkNyLCBkYWhlciBkZW4gRGF0ZWluYW1lbiBhdXMgc2VpbmVuIGVpZ2VuZW5cbi8vIChMaXZlLSlFaW5zdGVsbHVuZ2VuIG5hY2hiYXVlbiwgc3RhdHQgc2VpbmUgaW50ZXJuZW4gRnVua3Rpb25lbiBhbnp1emFwZmVuLlxuZnVuY3Rpb24gZ2V0Rm9sZGVyTm90ZUZpbGUocGx1Z2luLCBmb2xkZXIpIHtcbiAgY29uc3QgZm9sZGVyTm90ZXMgPSBwbHVnaW4uYXBwLnBsdWdpbnMucGx1Z2luc1tGT0xERVJfTk9URVNfUExVR0lOX0lEXTtcbiAgY29uc3Qgc2V0dGluZ3MgPSBmb2xkZXJOb3Rlcz8uc2V0dGluZ3M7XG4gIGlmICghc2V0dGluZ3MpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGZpbGVOYW1lID1cbiAgICAoc2V0dGluZ3MuZm9sZGVyTm90ZU5hbWUgfHwgXCJ7e2ZvbGRlcl9uYW1lfX1cIikucmVwbGFjZShcInt7Zm9sZGVyX25hbWV9fVwiLCBmb2xkZXIubmFtZSkgK1xuICAgIChzZXR0aW5ncy5mb2xkZXJOb3RlVHlwZSB8fCBcIi5tZFwiKTtcbiAgY29uc3QgZGlyUGF0aCA9IHNldHRpbmdzLnN0b3JhZ2VMb2NhdGlvbiA9PT0gXCJwYXJlbnRGb2xkZXJcIiA/IGZvbGRlci5wYXJlbnQ/LnBhdGggPz8gXCJcIiA6IGZvbGRlci5wYXRoO1xuICBjb25zdCBwYXRoID0gZGlyUGF0aCA/IGAke2RpclBhdGh9LyR7ZmlsZU5hbWV9YCA6IGZpbGVOYW1lO1xuXG4gIGNvbnN0IGZpbGUgPSBwbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChwYXRoKTtcbiAgcmV0dXJuIGZpbGUgaW5zdGFuY2VvZiBURmlsZSA/IGZpbGUgOiBudWxsO1xufVxuXG5mdW5jdGlvbiBhcHBseUNvbG9yVG9UaXRsZShwbHVnaW4sIHRpdGxlRWwsIGZpbGUpIHtcbiAgY29uc3QgY29udGVudEVsID0gdGl0bGVFbC5xdWVyeVNlbGVjdG9yKFwiLm5hdi1maWxlLXRpdGxlLWNvbnRlbnQsIC5uYXYtZm9sZGVyLXRpdGxlLWNvbnRlbnRcIik7XG4gIGlmICghY29udGVudEVsKSByZXR1cm47XG5cbiAgY29uc3QgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5maWxlRXhwbG9yZXIgPyBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCBcImZpbGVFeHBsb3JlclwiKSA6IG51bGw7XG4gIGlmIChjb2xvcikgY29udGVudEVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gIGVsc2UgY29udGVudEVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiY29sb3JcIik7XG59XG5cbmZ1bmN0aW9uIGFwcGx5RmlsZUV4cGxvcmVyQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEZJTEVfRVhQTE9SRVJfVklFV19UWVBFKSkge1xuICAgIGNvbnN0IGZpbGVUaXRsZUVscyA9IGxlYWYudmlldy5jb250YWluZXJFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLm5hdi1maWxlLXRpdGxlW2RhdGEtcGF0aF1cIik7XG4gICAgZm9yIChjb25zdCB0aXRsZUVsIG9mIGZpbGVUaXRsZUVscykge1xuICAgICAgY29uc3QgZmlsZSA9IHBsdWdpbi5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHRpdGxlRWwuZ2V0QXR0cmlidXRlKFwiZGF0YS1wYXRoXCIpKTtcbiAgICAgIGFwcGx5Q29sb3JUb1RpdGxlKHBsdWdpbiwgdGl0bGVFbCwgZmlsZSBpbnN0YW5jZW9mIFRGaWxlID8gZmlsZSA6IG51bGwpO1xuICAgIH1cblxuICAgIGNvbnN0IGZvbGRlclRpdGxlRWxzID0gbGVhZi52aWV3LmNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIubmF2LWZvbGRlci10aXRsZVtkYXRhLXBhdGhdXCIpO1xuICAgIGZvciAoY29uc3QgdGl0bGVFbCBvZiBmb2xkZXJUaXRsZUVscykge1xuICAgICAgY29uc3QgZm9sZGVyID0gcGx1Z2luLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgodGl0bGVFbC5nZXRBdHRyaWJ1dGUoXCJkYXRhLXBhdGhcIikpO1xuICAgICAgY29uc3Qgbm90ZUZpbGUgPSBmb2xkZXIgaW5zdGFuY2VvZiBURm9sZGVyID8gZ2V0Rm9sZGVyTm90ZUZpbGUocGx1Z2luLCBmb2xkZXIpIDogbnVsbDtcbiAgICAgIGFwcGx5Q29sb3JUb1RpdGxlKHBsdWdpbiwgdGl0bGVFbCwgbm90ZUZpbGUpO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlckZpbGVFeHBsb3JlckNvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5RmlsZUV4cGxvcmVyQ29sb3JzKHBsdWdpbik7XG5cbiAgLy8gRGVyIEZpbGUtRXhwbG9yZXIgcmVuZGVydCBFaW50clx1MDBFNGdlIGJlaW0gQXVmLS9adWtsYXBwZW4gdm9uIE9yZG5lcm4gZHluYW1pc2NoXG4gIC8vIG5ldSAtIHBlciBNdXRhdGlvbk9ic2VydmVyIGF1ZiBuZXUgZWluZ2VmXHUwMEZDZ3RlIEVsZW1lbnRlIHJlYWdpZXJlbiwgc3RhdHQgbnVyXG4gIC8vIGVpbm1hbGlnIGJlaW0gU3RhcnQgZWluenVmXHUwMEU0cmJlbi5cbiAgY29uc3Qgb2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcihyZWZyZXNoKTtcbiAgY29uc3Qgb2JzZXJ2ZUV4cGxvcmVyTGVhdmVzID0gKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoRklMRV9FWFBMT1JFUl9WSUVXX1RZUEUpKSB7XG4gICAgICBvYnNlcnZlci5vYnNlcnZlKGxlYWYudmlldy5jb250YWluZXJFbCwgeyBjaGlsZExpc3Q6IHRydWUsIHN1YnRyZWU6IHRydWUgfSk7XG4gICAgfVxuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4gb2JzZXJ2ZXIuZGlzY29ubmVjdCgpKTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLnZhdWx0Lm9uKFwicmVuYW1lXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoXG4gICAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgIG9ic2VydmVFeHBsb3JlckxlYXZlcygpO1xuICAgICAgcmVmcmVzaCgpO1xuICAgIH0pXG4gICk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgb2JzZXJ2ZUV4cGxvcmVyTGVhdmVzKCk7XG4gICAgcmVmcmVzaCgpO1xuICB9KTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyRmlsZUV4cGxvcmVyQ29sb3JzIH07XG4iLCAiY29uc3QgeyBjb2xvckZvckZpbGUgfSA9IHJlcXVpcmUoXCIuL3R5cGUtY29sb3JzXCIpO1xuXG5jb25zdCBHUkFQSF9WSUVXX1RZUEVTID0gW1wiZ3JhcGhcIiwgXCJsb2NhbGdyYXBoXCJdO1xuXG5mdW5jdGlvbiBoZXhUb0ludChoZXgpIHtcbiAgcmV0dXJuIHBhcnNlSW50KGhleC5yZXBsYWNlKFwiI1wiLCBcIlwiKSwgMTYpO1xufVxuXG4vLyBlbmdpbmUucmVuZGVyKCkgbGllc3Qgc2VpbiBpbnRlcm5lcyBmaWxlRmlsdGVyLU9iamVrdCBudXIgYXVzLCB3ZW5uIGJlcmVpdHNcbi8vIG1pbmRlc3RlbnMgZWluZSBlaWdlbmUgRmFyYmdydXBwZS9GaWx0ZXItUXVlcnkgYWt0aXYgaXN0IC0gb2huZSBlaWdlbmUgR3J1cHBlblxuLy8gYmVrb21tdCBqZWRlIERhdGVpIHBhdXNjaGFsIGNvbG9yOnRydWUgKGtlaW4gRmFyYndlcnQpLCBmaWxlRmlsdGVyIHdpcmQgZ2FyXG4vLyBuaWNodCBlcnN0IGtvbnN1bHRpZXJ0LiBSb2J1c3RlciBpc3QgZGVyIEVpbmdyaWZmIGRpcmVrdCBhbiByZW5kZXJlci5zZXREYXRhLFxuLy8gdW5taXR0ZWxiYXIgYmV2b3IgZGllIGZlcnRpZ2VuIE5vZGUtRGF0ZW4gYW4gZGVuIFdlYkdMLVJlbmRlcmVyIGdlaGVuIC0gYW5cbi8vIGV4YWt0IGRpZXNlciBTdGVsbGUgcGF0Y2h0IGF1Y2ggZGFzIENvbW11bml0eS1QbHVnaW4gXCJncmFwaC1uZXN0ZWQtdGFnc1wiLlxuLy8gRWlnZW5lIEZhcmJncnVwcGVuIGhhYmVuIGRvcnQgbm9kZS5jb2xvciBiZXJlaXRzIGdlc2V0enQgdW5kIGJsZWliZW4gdW5hbmdldGFzdGV0LlxuZnVuY3Rpb24gcGF0Y2hSZW5kZXJlcihwbHVnaW4sIHJlbmRlcmVyKSB7XG4gIGlmIChyZW5kZXJlci5fX2ZyZWRUeXBDb2xvclBhdGNoZWQpIHJldHVybjtcbiAgcmVuZGVyZXIuX19mcmVkVHlwQ29sb3JQYXRjaGVkID0gdHJ1ZTtcblxuICBjb25zdCBvcmlnaW5hbCA9IHJlbmRlcmVyLnNldERhdGE7XG4gIHJlbmRlcmVyLnNldERhdGEgPSBmdW5jdGlvbiAoZGF0YSkge1xuICAgIGZvciAoY29uc3QgcGF0aCBpbiBkYXRhLm5vZGVzKSB7XG4gICAgICBjb25zdCBub2RlID0gZGF0YS5ub2Rlc1twYXRoXTtcbiAgICAgIGlmIChub2RlLmNvbG9yKSBjb250aW51ZTtcblxuICAgICAgaWYgKG5vZGUudHlwZSA9PT0gXCJ0YWdcIikge1xuICAgICAgICAvLyBFaWdlbmUgVGFnLUZhcmJlIGRlYWt0aXZpZXJ0ICgzMC4wOS4yMDI2KTogVGFnLUtub3RlbiBsYXNzZW4gc2ljaCBpbVxuICAgICAgICAvLyBNaW5pbWFsIFRoZW1lIGJlcmVpdHMgXHUwMEZDYmVyIGRpZSBTdHlsZSBTZXR0aW5ncyBlaW5mXHUwMEU0cmJlbiAoR3JhcGhzIFx1MjE5MlxuICAgICAgICAvLyBcIlRhZyBub2RlIGNvbG9yXCIpLCBkYXMgaGllciB3YXIgZWluZSBEb3BwbHVuZy4gRGllIFRZUC1FaW5mXHUwMEU0cmJ1bmcgZGVyXG4gICAgICAgIC8vIE5vdGl6LUtub3RlbiB1bnRlbiBibGVpYnQsIGRpZSBrYW5uIFN0eWxlIFNldHRpbmdzIG5pY2h0LlxuICAgICAgICAvLyBpZiAocGx1Z2luLnNldHRpbmdzLmdyYXBoVGFnQ29sb3JFbmFibGVkICYmIHBsdWdpbi5zZXR0aW5ncy5ncmFwaFRhZ0NvbG9yKSB7XG4gICAgICAgIC8vICAgbm9kZS5jb2xvciA9IHsgYTogMSwgcmdiOiBoZXhUb0ludChwbHVnaW4uc2V0dGluZ3MuZ3JhcGhUYWdDb2xvcikgfTtcbiAgICAgICAgLy8gfVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgZmlsZSA9IHBsdWdpbi5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHBhdGgpO1xuICAgICAgbGV0IGNvbG9yID0gbnVsbDtcblxuICAgICAgaWYgKGZpbGUgJiYgZmlsZS5leHRlbnNpb24gIT09IFwibWRcIikge1xuICAgICAgICAvLyBFaWdlbmUgQW5oXHUwMEU0bmdlLUZhcmJlIGRlYWt0aXZpZXJ0ICgzMC4wOS4yMDI2KSwgd2llIGRpZSBUYWctRmFyYmUgb2JlbjpcbiAgICAgICAgLy8gU3R5bGUgU2V0dGluZ3MgZGVzIE1pbmltYWwgVGhlbWUsIEdyYXBocyBcdTIxOTIgXCJBdHRhY2htZW50IG5vZGUgY29sb3JcIi5cbiAgICAgICAgLy8gaWYgKHBsdWdpbi5zZXR0aW5ncy5ncmFwaEF0dGFjaG1lbnRDb2xvckVuYWJsZWQgJiYgcGx1Z2luLnNldHRpbmdzLmdyYXBoQXR0YWNobWVudENvbG9yKSB7XG4gICAgICAgIC8vICAgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuZ3JhcGhBdHRhY2htZW50Q29sb3I7XG4gICAgICAgIC8vIH1cbiAgICAgIH0gZWxzZSBpZiAocGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MuZ3JhcGgpIHtcbiAgICAgICAgY29sb3IgPSBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCBcImdyYXBoXCIpO1xuICAgICAgfVxuXG4gICAgICBpZiAoY29sb3IpIG5vZGUuY29sb3IgPSB7IGE6IDEsIHJnYjogaGV4VG9JbnQoY29sb3IpIH07XG4gICAgfVxuICAgIHJldHVybiBvcmlnaW5hbC5jYWxsKHRoaXMsIGRhdGEpO1xuICB9O1xuXG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiB7XG4gICAgcmVuZGVyZXIuc2V0RGF0YSA9IG9yaWdpbmFsO1xuICAgIGRlbGV0ZSByZW5kZXJlci5fX2ZyZWRUeXBDb2xvclBhdGNoZWQ7XG4gIH0pO1xufVxuXG5mdW5jdGlvbiBnZXRHcmFwaExlYXZlcyhhcHApIHtcbiAgY29uc3QgbGVhdmVzID0gW107XG4gIGZvciAoY29uc3QgdHlwZSBvZiBHUkFQSF9WSUVXX1RZUEVTKSBsZWF2ZXMucHVzaCguLi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZSh0eXBlKSk7XG4gIHJldHVybiBsZWF2ZXM7XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyR3JhcGhDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIGdldEdyYXBoTGVhdmVzKHBsdWdpbi5hcHApKSB7XG4gICAgICBpZiAobGVhZi52aWV3Py5yZW5kZXJlcikgcGF0Y2hSZW5kZXJlcihwbHVnaW4sIGxlYWYudmlldy5yZW5kZXJlcik7XG4gICAgICAvLyBEZXIgZ2xvYmFsZSBHcmFwaCBoXHUwMEU0bHQgc2VpbmUgRW5naW5lIGluIHZpZXcuZGF0YUVuZ2luZSwgZGVyIGxva2FsZSBpblxuICAgICAgLy8gdmlldy5lbmdpbmUgLSBvaG5lIGRlbiB6d2VpdGVuIEZhbGwgYmVrYW0gZWluIGxva2FsZXIgR3JhcGggZWluZVxuICAgICAgLy8gZ2VcdTAwRTRuZGVydGUgVFlQLUZhcmJlIGVyc3QgYmVpbSBuXHUwMEU0Y2hzdGVuIGVpZ2VuZW4gTmV1YXVmYmF1IHp1IHNlaGVuLlxuICAgICAgKGxlYWYudmlldz8uZGF0YUVuZ2luZSA/PyBsZWFmLnZpZXc/LmVuZ2luZSk/LnJlbmRlcigpO1xuICAgIH1cbiAgfTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICAvLyBOdXIgYmVpIHRhdHNcdTAwRTRjaGxpY2ggZ2VcdTAwRTRuZGVydGVtIFRZUCAoc2llaGUgdHlwLWluZGV4LmpzKSAtIHNvbnN0IHplaWd0ZSBkZXJcbiAgLy8gR3JhcGggZWluZSB1bWdldHJhZ2VuZSBGYXJiZSBlcnN0IG5hY2ggZGVtIG5cdTAwRTRjaHN0ZW4gZWlnZW5lbiBOZXVhdWZiYXUuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkocmVmcmVzaCk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckdyYXBoQ29sb3JzIH07XG4iLCAiY29uc3QgeyBjb2xvckZvckZpbGUgfSA9IHJlcXVpcmUoXCIuL3R5cGUtY29sb3JzXCIpO1xuXG5jb25zdCBTRUFSQ0hfVklFV19UWVBFID0gXCJzZWFyY2hcIjtcblxuLy8gRXJnZWJuaXN6ZWlsZW4gaW0gU2VhcmNoIFZpZXcgdHJhZ2VuIGtlaW4gZGF0YS1wYXRoLUF0dHJpYnV0LCBhYmVyIGRpZVxuLy8gU2VhcmNoVmlldyBwZmxlZ3QgaW50ZXJuIGVpbmUgTWFwIHZvbiBURmlsZSAtPiBFcmdlYm5pcy1ET00tT2JqZWt0XG4vLyAoZG9tLnJlc3VsdERvbUxvb2t1cCkgLSBkYXJcdTAwRkNiZXIgbFx1MDBFNHNzdCBzaWNoIERhdGVpIHVuZCBaZWlsZSBkaXJla3QgdmVyYmluZGVuLlxuZnVuY3Rpb24gYXBwbHlTZWFyY2hDb2xvcnMocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoU0VBUkNIX1ZJRVdfVFlQRSkpIHtcbiAgICBjb25zdCByZXN1bHREb21Mb29rdXAgPSBsZWFmLnZpZXc/LmRvbT8ucmVzdWx0RG9tTG9va3VwO1xuICAgIGlmICghcmVzdWx0RG9tTG9va3VwKSBjb250aW51ZTtcblxuICAgIGZvciAoY29uc3QgW2ZpbGUsIHJlc3VsdERvbV0gb2YgcmVzdWx0RG9tTG9va3VwKSB7XG4gICAgICBjb25zdCB0aXRsZUVsID0gcmVzdWx0RG9tLmVsPy5xdWVyeVNlbGVjdG9yKFwiLnNlYXJjaC1yZXN1bHQtZmlsZS10aXRsZSAudHJlZS1pdGVtLWlubmVyXCIpO1xuICAgICAgaWYgKCF0aXRsZUVsKSBjb250aW51ZTtcblxuICAgICAgY29uc3QgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5zZWFyY2ggPyBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCBcInNlYXJjaFwiKSA6IG51bGw7XG4gICAgICBpZiAoY29sb3IpIHRpdGxlRWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcbiAgICAgIGVsc2UgdGl0bGVFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImNvbG9yXCIpO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlclNlYXJjaENvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5U2VhcmNoQ29sb3JzKHBsdWdpbik7XG5cbiAgLy8gRXJnZWJuaXNzZSB3ZXJkZW4gYmVpIGplZGVyIFN1Y2hlaW5nYWJlIGtvbXBsZXR0IG5ldSBhdWZnZWJhdXQuXG4gIGNvbnN0IG9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIocmVmcmVzaCk7XG4gIGNvbnN0IG9ic2VydmVMZWF2ZXMgPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShTRUFSQ0hfVklFV19UWVBFKSkge1xuICAgICAgb2JzZXJ2ZXIub2JzZXJ2ZShsZWFmLnZpZXcuY29udGFpbmVyRWwsIHsgY2hpbGRMaXN0OiB0cnVlLCBzdWJ0cmVlOiB0cnVlIH0pO1xuICAgIH1cbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IG9ic2VydmVyLmRpc2Nvbm5lY3QoKSk7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoXG4gICAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICAgIHJlZnJlc2goKTtcbiAgICB9KVxuICApO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICByZWZyZXNoKCk7XG4gIH0pO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJTZWFyY2hDb2xvcnMgfTtcbiIsICJjb25zdCB7IGNvbG9yRm9yRmlsZSB9ID0gcmVxdWlyZShcIi4vdHlwZS1jb2xvcnNcIik7XG5cbmNvbnN0IFJFQ0VOVF9GSUxFU19WSUVXX1RZUEUgPSBcInJlY2VudC1maWxlc1wiO1xuXG4vLyBSZWNlbnQgRmlsZXMgc2V0enQga2VpbiBkYXRhLXBhdGgtQXR0cmlidXQgYXVmIHNlaW5lIFplaWxlbi4gRXMgcmVuZGVydCBzZWluZVxuLy8gTGlzdGUgYWJlciBvaG5lIFx1MDBGQ2JlcnNwcnVuZ2VuZSBFaW50clx1MDBFNGdlIGRpcmVrdCBhdXMgZGF0YS5yZWNlbnRGaWxlcywgZGFoZXJcbi8vIGxcdTAwRTRzc3Qgc2ljaCBkaWUgWmVpbGUgXHUwMEZDYmVyIGRlbiBJbmRleCBlaW5kZXV0aWcgZGVtIFBmYWQgenVvcmRuZW4uXG5mdW5jdGlvbiBhcHBseVJlY2VudEZpbGVzQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFJFQ0VOVF9GSUxFU19WSUVXX1RZUEUpKSB7XG4gICAgY29uc3QgcmVjZW50RmlsZXMgPSBsZWFmLnZpZXc/LmRhdGE/LnJlY2VudEZpbGVzO1xuICAgIGlmICghQXJyYXkuaXNBcnJheShyZWNlbnRGaWxlcykpIGNvbnRpbnVlO1xuXG4gICAgY29uc3QgdGl0bGVFbHMgPSBsZWFmLnZpZXcuY29udGFpbmVyRWwucXVlcnlTZWxlY3RvckFsbChcIi5yZWNlbnQtZmlsZXMtdGl0bGUgLm5hdi1maWxlLXRpdGxlLWNvbnRlbnRcIik7XG4gICAgdGl0bGVFbHMuZm9yRWFjaCgodGl0bGVFbCwgaW5kZXgpID0+IHtcbiAgICAgIGNvbnN0IGVudHJ5ID0gcmVjZW50RmlsZXNbaW5kZXhdO1xuICAgICAgY29uc3QgZmlsZSA9IGVudHJ5ID8gcGx1Z2luLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoZW50cnkucGF0aCkgOiBudWxsO1xuICAgICAgY29uc3QgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5yZWNlbnRGaWxlcyA/IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIFwicmVjZW50RmlsZXNcIikgOiBudWxsO1xuICAgICAgaWYgKGNvbG9yKSB0aXRsZUVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gICAgICBlbHNlIHRpdGxlRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlclJlY2VudEZpbGVzQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlSZWNlbnRGaWxlc0NvbG9ycyhwbHVnaW4pO1xuXG4gIGNvbnN0IG9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIocmVmcmVzaCk7XG4gIGNvbnN0IG9ic2VydmVMZWF2ZXMgPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShSRUNFTlRfRklMRVNfVklFV19UWVBFKSkge1xuICAgICAgb2JzZXJ2ZXIub2JzZXJ2ZShsZWFmLnZpZXcuY29udGFpbmVyRWwsIHsgY2hpbGRMaXN0OiB0cnVlLCBzdWJ0cmVlOiB0cnVlIH0pO1xuICAgIH1cbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IG9ic2VydmVyLmRpc2Nvbm5lY3QoKSk7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoXG4gICAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICAgIHJlZnJlc2goKTtcbiAgICB9KVxuICApO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICByZWZyZXNoKCk7XG4gIH0pO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJSZWNlbnRGaWxlc0NvbG9ycyB9O1xuIiwgImNvbnN0IHsgY29sb3JGb3JGaWxlIH0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcblxuY29uc3QgQkFDS0xJTktfVklFV19UWVBFID0gXCJiYWNrbGlua1wiO1xuXG4vLyBEYXMgQmFja2xpbmtzLVBhbmUgKFNlaXRlbmxlaXN0ZSkgcmVuZGVydCBUcmVmZmVyIGludGVybiBcdTAwRkNiZXIgZGllc2VsYmVcbi8vIFNlYXJjaFJlc3VsdERvbS1LbGFzc2Ugd2llIGRpZSBTdWNoZS4gVmVybGlua3RlIHVuZCBuaWNodCB2ZXJsaW5rdGVcbi8vIEVyd1x1MDBFNGhudW5nZW4gbGllZ2VuIGFscyB6d2VpIHJlc3VsdERvbUxvb2t1cC1NYXBzIGltIEJhY2tsaW5rUmVuZGVyZXJcbi8vICh2aWV3LmJhY2tsaW5rKSAtIEZlbGRuYW1lbiBzaW5kIG5pY2h0IG9mZml6aWVsbCBkb2t1bWVudGllcnQsIGRhaGVyXG4vLyBtZWhyZXJlIGJla2FubnRlIFBmYWRlIHByb2JpZXJlbiBzdGF0dCBlaW5lbiBmZXN0IGFuenVuZWhtZW4uXG5mdW5jdGlvbiBnZXRSZXN1bHREb21Mb29rdXBzKHZpZXcpIHtcbiAgY29uc3QgcmVuZGVyZXIgPSB2aWV3Py5iYWNrbGluaztcbiAgY29uc3QgY2FuZGlkYXRlcyA9IFtyZW5kZXJlcj8uYmFja2xpbmtEb20sIHJlbmRlcmVyPy51bmxpbmtlZERvbSwgdmlldz8uYmFja2xpbmtEb20sIHZpZXc/LnVubGlua2VkRG9tLCB2aWV3Py5kb21dO1xuXG4gIGNvbnN0IGxvb2t1cHMgPSBbXTtcbiAgZm9yIChjb25zdCBkb20gb2YgY2FuZGlkYXRlcykge1xuICAgIGlmIChkb20/LnJlc3VsdERvbUxvb2t1cCBpbnN0YW5jZW9mIE1hcCkgbG9va3Vwcy5wdXNoKGRvbS5yZXN1bHREb21Mb29rdXApO1xuICB9XG4gIHJldHVybiBsb29rdXBzO1xufVxuXG5mdW5jdGlvbiBjb2xvclRpdGxlRWwocGx1Z2luLCBlbCwgZmlsZSkge1xuICBjb25zdCBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmJhY2tsaW5rcyA/IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIFwiYmFja2xpbmtzXCIpIDogbnVsbDtcbiAgaWYgKGNvbG9yKSBlbC5zdHlsZS5jb2xvciA9IGNvbG9yO1xuICBlbHNlIGVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiY29sb3JcIik7XG59XG5cbmZ1bmN0aW9uIGFwcGx5QmFja2xpbmtQYW5lQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEJBQ0tMSU5LX1ZJRVdfVFlQRSkpIHtcbiAgICBmb3IgKGNvbnN0IGxvb2t1cCBvZiBnZXRSZXN1bHREb21Mb29rdXBzKGxlYWYudmlldykpIHtcbiAgICAgIGZvciAoY29uc3QgW2ZpbGUsIHJlc3VsdERvbV0gb2YgbG9va3VwKSB7XG4gICAgICAgIGNvbnN0IHRpdGxlRWwgPSByZXN1bHREb20uZWw/LnF1ZXJ5U2VsZWN0b3IoXCIuc2VhcmNoLXJlc3VsdC1maWxlLXRpdGxlIC50cmVlLWl0ZW0taW5uZXJcIik7XG4gICAgICAgIGlmICh0aXRsZUVsKSBjb2xvclRpdGxlRWwocGx1Z2luLCB0aXRsZUVsLCBmaWxlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuLy8gXCJCYWNrbGlua3MgaW0gRG9rdW1lbnRcIiBpc3Qga2VpbmUgZWlnZW5lIEFuc2ljaHQva2VpbiBlaWdlbmVyIExlYWYsIHNvbmRlcm5cbi8vIHVudGVuIGluIGRpZSBNYXJrZG93blZpZXcgZWluZ2ViZXR0ZXQgKC5lbWJlZGRlZC1iYWNrbGlua3MpIC0gaGllciByZWljaHRcbi8vIGtlaW4gTGVhZi1UeXAsIHN0YXR0ZGVzc2VuIFx1MDBGQ2JlciBvZmZlbmUgTWFya2Rvd24tTGVhdmVzIG5hY2ggZGVyIERPTS1LbGFzc2Vcbi8vIHN1Y2hlbi4gT2huZSBkYXRhLXBhdGggamUgWmVpbGUgd2lyZCBkaWUgRGF0ZWkgXHUwMEZDYmVyIGRlbiBhbmdlemVpZ3RlblxuLy8gRGF0ZWluYW1lbiAoTGlua3RleHQpIGF1ZmdlbFx1MDBGNnN0LCB3aWUgT2JzaWRpYW4gaW50ZXJuIExpbmtzIGF1ZmxcdTAwRjZzdC5cbmZ1bmN0aW9uIGFwcGx5RW1iZWRkZWRCYWNrbGlua0NvbG9ycyhwbHVnaW4pIHtcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpKSB7XG4gICAgY29uc3QgcGFuZUVsID0gbGVhZi52aWV3LmNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3IoXCIuZW1iZWRkZWQtYmFja2xpbmtzIC5iYWNrbGluay1wYW5lXCIpO1xuICAgIGlmICghcGFuZUVsKSBjb250aW51ZTtcblxuICAgIGNvbnN0IHNvdXJjZVBhdGggPSBsZWFmLnZpZXcuZmlsZT8ucGF0aCA/PyBcIlwiO1xuICAgIGNvbnN0IHRpdGxlRWxzID0gcGFuZUVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIuc2VhcmNoLXJlc3VsdC1maWxlLXRpdGxlIC50cmVlLWl0ZW0taW5uZXJcIik7XG4gICAgZm9yIChjb25zdCB0aXRsZUVsIG9mIHRpdGxlRWxzKSB7XG4gICAgICBjb25zdCBiYXNlbmFtZSA9IHRpdGxlRWwudGV4dENvbnRlbnQ7XG4gICAgICBjb25zdCBmaWxlID0gYmFzZW5hbWUgPyBwbHVnaW4uYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0Rmlyc3RMaW5rcGF0aERlc3QoYmFzZW5hbWUsIHNvdXJjZVBhdGgpIDogbnVsbDtcbiAgICAgIGNvbG9yVGl0bGVFbChwbHVnaW4sIHRpdGxlRWwsIGZpbGUpO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBhcHBseUJhY2tsaW5rQ29sb3JzKHBsdWdpbikge1xuICBhcHBseUJhY2tsaW5rUGFuZUNvbG9ycyhwbHVnaW4pO1xuICBhcHBseUVtYmVkZGVkQmFja2xpbmtDb2xvcnMocGx1Z2luKTtcbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJCYWNrbGlua0NvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5QmFja2xpbmtDb2xvcnMocGx1Z2luKTtcblxuICAvLyBOdXIgZGFzIChrbGVpbmUpIEJhY2tsaW5rcy1QYW5lIGluIGRlciBTZWl0ZW5sZWlzdGUgcGVyIE11dGF0aW9uT2JzZXJ2ZXJcbiAgLy8gYmVvYmFjaHRlbiAtIE5JQ0hUIGRpZSBNYXJrZG93blZpZXctQ29udGFpbmVyLCBkYSBkZXJlbiBFZGl0b3ItU3VidHJlZSBiZWlcbiAgLy8gamVkZW0gVGFzdGVuZHJ1Y2sgdmllbGUgTXV0YXRpb25lbiBlcnpldWd0IChzaWVoZSBXYXJudW5nIGluXG4gIC8vIGRhdGFiYXNlLWZvbGRlcnMuanM6IGVpbiBzdWJ0cmVlLU9ic2VydmVyIFx1MDBGQ2JlciBlaW5lbiBFZGl0b3ItbmFoZW4gQ29udGFpbmVyXG4gIC8vIGhhdCBkaWVzZXMgVmF1bHQgc2Nob24gZWlubWFsIGtvbXBsZXR0IGVpbmdlZnJvcmVuKS4gRGllIGVpbmdlYmV0dGV0ZW5cbiAgLy8gQmFja2xpbmtzIGltIERva3VtZW50IGJyYXVjaGVuIGRhZlx1MDBGQ3Iga2VpbmVuIGVpZ2VuZW4gT2JzZXJ2ZXI6IHNpZSBcdTAwRTRuZGVyblxuICAvLyBzaWNoIG51ciwgd2VubiBpcmdlbmR3byBpbSBWYXVsdCBMaW5rcyBoaW56dWtvbW1lbi93ZWdmYWxsZW4gb2RlciBiZWltXG4gIC8vIFx1MDBENmZmbmVuL1dlY2hzZWxuIGVpbmVyIE5vdGl6IC0gYmVpZGVzIGlzdCBcdTAwRkNiZXIgZGllIEV2ZW50cyB1bnRlbiBiZXJlaXRzXG4gIC8vIGFiZ2VkZWNrdCAoXCJyZXNvbHZlZFwiIG5hY2ggamVkZXIgTGluay1BdWZsXHUwMEY2c3VuZywgbGF5b3V0LWNoYW5nZS9cbiAgLy8gYWN0aXZlLWxlYWYtY2hhbmdlIGxcdTAwRjZzZW4gb2huZWhpbiBhcHBseUJhY2tsaW5rQ29sb3JzKCkgdW5kIGRhbWl0IGF1Y2hcbiAgLy8gYXBwbHlFbWJlZGRlZEJhY2tsaW5rQ29sb3JzKCkgYXVzKS5cbiAgY29uc3Qgb2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcihyZWZyZXNoKTtcbiAgY29uc3Qgb2JzZXJ2ZUxlYXZlcyA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEJBQ0tMSU5LX1ZJRVdfVFlQRSkpIHtcbiAgICAgIG9ic2VydmVyLm9ic2VydmUobGVhZi52aWV3LmNvbnRhaW5lckVsLCB7IGNoaWxkTGlzdDogdHJ1ZSwgc3VidHJlZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiBvYnNlcnZlci5kaXNjb25uZWN0KCkpO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIC8vIE51ciBkZXIgZWluZ2ViZXR0ZXRlIFRlaWwgaFx1MDBFNG5ndCAobWFuZ2VscyBlaWdlbmVtIE9ic2VydmVyLCBzaWVoZSBvYmVuKVxuICAvLyB3ZWl0ZXJoaW4gYW4gZGVyIExpbmstQXVmbFx1MDBGNnN1bmcgLSBkaWUgU2VpdGVubGVpc3RlIGRlY2t0IGlociBPYnNlcnZlciBhYi5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC5tZXRhZGF0YUNhY2hlLm9uKFwicmVzb2x2ZWRcIiwgKCkgPT4gYXBwbHlFbWJlZGRlZEJhY2tsaW5rQ29sb3JzKHBsdWdpbikpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoXG4gICAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICAgIHJlZnJlc2goKTtcbiAgICB9KVxuICApO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImFjdGl2ZS1sZWFmLWNoYW5nZVwiLCByZWZyZXNoKSk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgIHJlZnJlc2goKTtcbiAgfSk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckJhY2tsaW5rQ29sb3JzIH07XG4iLCAiY29uc3QgeyBjb2xvckZvckZpbGUgfSA9IHJlcXVpcmUoXCIuL3R5cGUtY29sb3JzXCIpO1xuXG5jb25zdCBCT09LTUFSS1NfVklFV19UWVBFID0gXCJib29rbWFya3NcIjtcbmNvbnN0IEJPT0tNQVJLU19QTFVHSU5fSUQgPSBcImJvb2ttYXJrc1wiO1xuXG4vLyBCb29rbWFyay1aZWlsZW4gdHJhZ2VuIGtlaW4gZGF0YS1wYXRoLUF0dHJpYnV0LiBEZXIgVmlldyBoXHUwMEU0bHQgYWJlciBpbnRlcm5cbi8vIGVpbmUgV2Vha01hcCAodmlldy5pdGVtRG9tczogQm9va21hcmstSXRlbSAtPiBUcmVlLUl0ZW0tRG9tIG1pdCAudGl0bGVFbCkgLVxuLy8gZGFyXHUwMEZDYmVyIGxcdTAwRTRzc3Qgc2ljaCBqZWRlcyBJdGVtIGdlemllbHQgc2VpbmVyIFplaWxlIHp1b3JkbmVuLCBvaG5lIGRpZSAobmljaHRcbi8vIGl0ZXJpZXJiYXJlKSBXZWFrTWFwIHNlbGJzdCBkdXJjaGxhdWZlbiB6dSBtXHUwMEZDc3Nlbjogc3RhdHRkZXNzZW4gcmVrdXJzaXYgXHUwMEZDYmVyXG4vLyBkZW4gSXRlbS1CYXVtIGRlcyBCb29rbWFya3MtUGx1Z2lucyBzZWxic3QgbGF1ZmVuIChsaWVndCB1bmFiaFx1MDBFNG5naWcgdm9tXG4vLyBSZW5kZXItL0NvbGxhcHNlLVp1c3RhbmQgaW1tZXIgdm9sbHN0XHUwMEU0bmRpZyB2b3IpIHVuZCBqZSBJdGVtIHBlciAuZ2V0KClcbi8vIG5hY2hzY2hsYWdlbiwgb2IgKHVuZCB3bykgZXMgYWt0dWVsbCBnZXJlbmRlcnQgaXN0LlxuZnVuY3Rpb24gZm9yRWFjaEZpbGVCb29rbWFyayhpdGVtcywgY2FsbGJhY2spIHtcbiAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zID8/IFtdKSB7XG4gICAgaWYgKGl0ZW0udHlwZSA9PT0gXCJmaWxlXCIpIGNhbGxiYWNrKGl0ZW0pO1xuICAgIGVsc2UgaWYgKGl0ZW0udHlwZSA9PT0gXCJncm91cFwiKSBmb3JFYWNoRmlsZUJvb2ttYXJrKGl0ZW0uaXRlbXMsIGNhbGxiYWNrKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBhcHBseUJvb2ttYXJrc0NvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgYm9va21hcmtzUGx1Z2luID0gcGx1Z2luLmFwcC5pbnRlcm5hbFBsdWdpbnMuZ2V0RW5hYmxlZFBsdWdpbkJ5SWQoQk9PS01BUktTX1BMVUdJTl9JRCk7XG4gIGlmICghYm9va21hcmtzUGx1Z2luKSByZXR1cm47XG5cbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShCT09LTUFSS1NfVklFV19UWVBFKSkge1xuICAgIGNvbnN0IGl0ZW1Eb21zID0gbGVhZi52aWV3Py5pdGVtRG9tcztcbiAgICBpZiAoIWl0ZW1Eb21zKSBjb250aW51ZTtcblxuICAgIGZvckVhY2hGaWxlQm9va21hcmsoYm9va21hcmtzUGx1Z2luLml0ZW1zLCAoaXRlbSkgPT4ge1xuICAgICAgY29uc3QgdGl0bGVFbCA9IGl0ZW1Eb21zLmdldChpdGVtKT8udGl0bGVFbDtcbiAgICAgIGlmICghdGl0bGVFbCkgcmV0dXJuO1xuXG4gICAgICBjb25zdCBmaWxlID0gcGx1Z2luLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoaXRlbS5wYXRoKTtcbiAgICAgIGNvbnN0IGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MuYm9va21hcmtzID8gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSwgXCJib29rbWFya3NcIikgOiBudWxsO1xuICAgICAgaWYgKGNvbG9yKSB0aXRsZUVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gICAgICBlbHNlIHRpdGxlRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcbiAgICB9KTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlckJvb2ttYXJrc0NvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5Qm9va21hcmtzQ29sb3JzKHBsdWdpbik7XG5cbiAgLy8gQW5hbG9nIHp1IGZpbGUtZXhwbG9yZXItY29sb3JzLmpzOiBCb29rbWFya3MgcmVuZGVydCBaZWlsZW4gYmVpbVxuICAvLyBBdWYtL1p1a2xhcHBlbiB2b24gR3J1cHBlbiBzb3dpZSBiZWltIEhpbnp1Zlx1MDBGQ2dlbi9FbnRmZXJuZW4vVW1zb3J0aWVyZW5cbiAgLy8gZHluYW1pc2NoIG5ldS5cbiAgY29uc3Qgb2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcihyZWZyZXNoKTtcbiAgY29uc3Qgb2JzZXJ2ZUxlYXZlcyA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEJPT0tNQVJLU19WSUVXX1RZUEUpKSB7XG4gICAgICBvYnNlcnZlci5vYnNlcnZlKGxlYWYudmlldy5jb250YWluZXJFbCwgeyBjaGlsZExpc3Q6IHRydWUsIHN1YnRyZWU6IHRydWUgfSk7XG4gICAgfVxuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4gb2JzZXJ2ZXIuZGlzY29ubmVjdCgpKTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgICAgcmVmcmVzaCgpO1xuICAgIH0pXG4gICk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgIHJlZnJlc2goKTtcbiAgfSk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckJvb2ttYXJrc0NvbG9ycyB9O1xuIiwgImNvbnN0IHsgVEZpbGUgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgY29sb3JGb3JGaWxlLCBzdWJ0eXBlQ29sb3IsIHN1YnR5cGVIYXNPd25Db2xvciB9ID0gcmVxdWlyZShcIi4vdHlwZS1jb2xvcnNcIik7XG5jb25zdCB7IGdldFN1YnR5cGUgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cGVzXCIpO1xuXG5jb25zdCBET1RfQ0xBU1MgPSBcImZyZWQtdHlwLXRpdGxlLWRvdFwiO1xuY29uc3QgRE9UX0hPTExPV19DTEFTUyA9IFwiZnJlZC10eXAtdGl0bGUtZG90LWhvbGxvd1wiO1xuLy8gV2llIERFRkFVTFRfVFlQRV9DT0xPUiBpbiB0eXAtdmlldy5qcyAoRmFyYmUgZWluZXMgVFlQcyBvaG5lIGVpZ2VuZSBGYXJiZSkuXG5jb25zdCBERUZBVUxUX0RPVF9DT0xPUiA9IFwiIzg4ODg4OFwiO1xuY29uc3QgQkFER0VfQ0xBU1MgPSBcImZyZWQtdHlwLXRpdGxlLWJhZGdlXCI7XG5jb25zdCBCQURHRV9QTEFJTl9DTEFTUyA9IFwiZnJlZC10eXAtdGl0bGUtYmFkZ2UtcGxhaW5cIjtcbmNvbnN0IENPTE9SX1ZBUiA9IFwiLS1mcmVkLXR5cC10aXRsZS1jb2xvclwiO1xuXG5jb25zdCBCTE9DS19CQURHRV9DTEFTUyA9IFwiZnJlZC10eXAtYmxvY2stYmFkZ2VcIjtcbmNvbnN0IEJMT0NLX0JBREdFX1BMQUlOX0NMQVNTID0gXCJmcmVkLXR5cC1ibG9jay1iYWRnZS1wbGFpblwiO1xuY29uc3QgQkxPQ0tfQUxJR05fVE9QX0NMQVNTID0gXCJmcmVkLXR5cC1ibG9jay1iYWRnZS10b3BcIjtcbmNvbnN0IEJMT0NLX0FMSUdOX0JPVFRPTV9DTEFTUyA9IFwiZnJlZC10eXAtYmxvY2stYmFkZ2UtYm90dG9tXCI7XG5jb25zdCBCTE9DS19DT0xPUl9WQVIgPSBcIi0tZnJlZC10eXAtYmxvY2stY29sb3JcIjtcblxuLy8gbm90ZVRpdGxlU3R5bGU6IFwibm9uZVwiIHwgXCJkb3RcIiB8IFwiYmFkZ2VcIi4gQmVpIFwiYmFkZ2VcIiBiZXN0aW1tZW4gendlaVxuLy8gd2VpdGVyZSBFaW5zdGVsbHVuZ2VuIEZhcmJlIChub3RlVGl0bGVCYWRnZUNvbG9yZWQpIHVuZCBQb3NpdGlvblxuLy8gKG5vdGVUaXRsZUJhZGdlUG9zaXRpb246IFwidGl0bGVcIiB8IFwiYmxvY2tcIikgLSBzaWVoZSBzZXR0aW5ncy5qcywgZG9ydCBudXJcbi8vIGJlaSBcImJhZGdlXCIgXHUwMEZDYmVyaGF1cHQgYW5nZXplaWd0IChwcm9ncmVzc2l2ZSBPZmZlbmxlZ3VuZykuIFwiZG90XCIgc2l0enRcbi8vIGltbWVyIGFtIFRpdGVsLCBcImJhZGdlXCIgamUgbmFjaCBQb3NpdGlvbiBlbnR3ZWRlciBhbSBUaXRlbCBvZGVyIGFtXG4vLyBQcm9wZXJ0eS1CbG9jayAoZG9ydCB6dXNcdTAwRTR0emxpY2ggcGVyIG5vdGVUaXRsZVZlcnRpY2FsQWxpZ24gb2Jlbi91bnRlbikuXG4vLyBjb2xvclZpZXdzLm5vdGVUaXRsZUNvbG9yIChUaXRlbHRleHQgc2VsYnN0IGVpbmZcdTAwRTRyYmVuKSBpc3QgZGF2b24gdW5hYmhcdTAwRTRuZ2lnXG4vLyB1bmQgYmVsaWViaWcga29tYmluaWVyYmFyLlxuZnVuY3Rpb24gcmVzb2x2ZU1hcmtlcihwbHVnaW4sIGZpbGUpIHtcbiAgY29uc3Qgc3R5bGUgPSBwbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlU3R5bGU7XG4gIGlmIChzdHlsZSA9PT0gXCJub25lXCIpIHJldHVybiB7IGtpbmQ6IFwibm9uZVwiIH07XG4gIGlmIChzdHlsZSA9PT0gXCJkb3RcIikgcmV0dXJuIHsga2luZDogXCJkb3RcIiwgLi4ucmVzb2x2ZURvdChwbHVnaW4sIGZpbGUpIH07XG5cbiAgLy8gc3R5bGUgPT09IFwiYmFkZ2VcIiAtIGZhcmJpZyBiZWkgZWluZW0gcmVnaXN0cmllcnRlbiBUWVAgb2huZSBlaWdlbmUgRmFyYmVcbiAgLy8gaW4gZGVyIGdyYXVlbiBTdGFuZGFyZGZhcmJlICh3aWUgZGVyIFJpbmcgdm9uIHJlc29sdmVEb3QpOyBlaW4gbmljaHRcbiAgLy8gcmVnaXN0cmllcnRlciBUWVAgYmVrb21tdCBmYXJiaWcga2VpbmUgQm94LCB3aWUgYXVjaCBrZWluZW4gUHVua3QuXG4gIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHBsdWdpbjtcbiAgY29uc3QgdHlwZSA9IHBsdWdpbi50eXBJbmRleC50eXBlT2YoZmlsZSk7XG4gIGlmICghdHlwZSkgcmV0dXJuIHsga2luZDogXCJub25lXCIgfTtcbiAgY29uc3QgY29sb3JlZCA9IHNldHRpbmdzLm5vdGVUaXRsZUJhZGdlQ29sb3JlZDtcbiAgaWYgKGNvbG9yZWQgJiYgIXNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV0gJiYgIXNldHRpbmdzLnR5cGVzLmluY2x1ZGVzKHR5cGUpKSByZXR1cm4geyBraW5kOiBcIm5vbmVcIiB9O1xuICBjb25zdCB0eXBlQ29sb3IgPSBzZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdID8/IERFRkFVTFRfRE9UX0NPTE9SO1xuXG4gIGNvbnN0IGxhYmVsID0gYmFkZ2VMYWJlbChwbHVnaW4sIGZpbGUsIHR5cGUpO1xuICBpZiAoIWxhYmVsKSByZXR1cm4geyBraW5kOiBcIm5vbmVcIiB9O1xuICBjb25zdCB7IHRleHQsIHVzZVN1YnR5cGVDb2xvciwgc3VidHlwZSB9ID0gbGFiZWw7XG4gIGNvbnN0IGNvbG9yID0gY29sb3JlZCA/ICh1c2VTdWJ0eXBlQ29sb3IgPyBzdWJ0eXBlQ29sb3Ioc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpID8/IHR5cGVDb2xvciA6IHR5cGVDb2xvcikgOiBudWxsO1xuICBjb25zdCBwb3NpdGlvbiA9IHNldHRpbmdzLm5vdGVUaXRsZUJhZGdlUG9zaXRpb247XG4gIHJldHVybiB7IGtpbmQ6IHBvc2l0aW9uID09PSBcImJsb2NrXCIgPyBcImJsb2NrLWJhZGdlXCIgOiBcInRpdGxlLWJhZGdlXCIsIGNvbG9yZWQsIGNvbG9yLCB0eXBlTmFtZTogdGV4dCB9O1xufVxuXG4vLyBCZXNjaHJpZnR1bmcgZGVyIEJveCAobm90ZVRpdGxlQmFkZ2VMYWJlbCkgc2FtdCBkZXIgZGF6dSBwYXNzZW5kZW4gRmFyYmU6XG4vLyBbVFlQXSBpbiBUWVAtRmFyYmUsIFtTdWJ0eXBdIGluIFN1YnR5cC1GYXJiZSAob2huZSBTdWJ0eXAga2VpbmUgQm94IC1cbi8vIGRhbm4gbnVsbCksIFtUWVAvU3VidHlwXSBqZSBuYWNoIFNjaGFsdGVyIFwiU3VidHlwLUZhcmJlXCJcbi8vIChjb2xvclZpZXdzLm5vdGVUaXRsZU1hcmtlclN1YnR5cCkuIEVpbiBuaWNodCByZWdpc3RyaWVydGVyIFNVQlRZUC1XZXJ0XG4vLyBzdGVodCBhbHMgVGV4dCBkYSwgaGF0IGFiZXIga2VpbmUgZWlnZW5lIEZhcmJlIChzdWJ0eXBlQ29sb3IgbGllZmVydCBkYW5uXG4vLyBkaWUgZGVzIFRZUHMpLlxuZnVuY3Rpb24gYmFkZ2VMYWJlbChwbHVnaW4sIGZpbGUsIHR5cGUpIHtcbiAgY29uc3QgeyBzZXR0aW5ncyB9ID0gcGx1Z2luO1xuICBjb25zdCBzdWJ0eXBlID0gcGx1Z2luLnR5cEluZGV4LnN1YnR5cGVPZihmaWxlKTtcbiAgY29uc3QgbW9kZSA9IHNldHRpbmdzLm5vdGVUaXRsZUJhZGdlTGFiZWwgPz8gXCJ0eXBlXCI7XG4gIGlmIChtb2RlID09PSBcInN1YnR5cGVcIikgcmV0dXJuIHN1YnR5cGUgPyB7IHRleHQ6IHN1YnR5cGUsIHVzZVN1YnR5cGVDb2xvcjogdHJ1ZSwgc3VidHlwZSB9IDogbnVsbDtcbiAgaWYgKCFzdWJ0eXBlIHx8IG1vZGUgPT09IFwidHlwZVwiKSByZXR1cm4geyB0ZXh0OiB0eXBlLCB1c2VTdWJ0eXBlQ29sb3I6IGZhbHNlLCBzdWJ0eXBlIH07XG4gIHJldHVybiB7IHRleHQ6IGAke3R5cGV9LyR7c3VidHlwZX1gLCB1c2VTdWJ0eXBlQ29sb3I6ICEhc2V0dGluZ3MuY29sb3JWaWV3cy5ub3RlVGl0bGVNYXJrZXJTdWJ0eXAsIHN1YnR5cGUgfTtcbn1cblxuLy8gRmFyYnB1bmt0IGFtIFRpdGVsIC0gd2llIGRpZSBGYXJicHVua3RlIGRlciBUWVAtVmlldyAoc2llaGUgcGFpbnRDb2xvckRvdFxuLy8gaW4gdHlwZS1jb2xvcnMuanMpIGJlaW0gU3RhbmRhcmR3ZXJ0IGFscyBob2hsZXIgUmluZzogZWluIHJlZ2lzdHJpZXJ0ZXIgVFlQXG4vLyBvaG5lIEZhcmJlIGdyYXUsIGVpbiBTdWJ0eXAgb2huZSBlaWdlbmUgRWluc3RlbGx1bmcgKG1pdCBkZW0gVW50ZXItU2NoYWx0ZXJcbi8vIFwiU3VidHlwXCIpIGluIGRlciBUWVAtRmFyYmUsIGRpZSBlciBcdTAwRkNiZXJuaW1tdC4gTmljaHQgcmVnaXN0cmllcnRlIFRZUGVuXG4vLyBibGVpYmVuIHdpZSBpbiBkZXIgVFlQLUxpc3RlIG9obmUgUHVua3QuXG5mdW5jdGlvbiByZXNvbHZlRG90KHBsdWdpbiwgZmlsZSkge1xuICBjb25zdCB0eXBlID0gcGx1Z2luLnR5cEluZGV4LnR5cGVPZihmaWxlKTtcbiAgaWYgKCF0eXBlKSByZXR1cm4geyBjb2xvcjogbnVsbCwgaG9sbG93OiBmYWxzZSB9O1xuICBjb25zdCB7IHNldHRpbmdzIH0gPSBwbHVnaW47XG4gIGNvbnN0IHR5cGVDb2xvciA9IHNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV07XG4gIGlmICghdHlwZUNvbG9yKSB7XG4gICAgcmV0dXJuIHNldHRpbmdzLnR5cGVzLmluY2x1ZGVzKHR5cGUpID8geyBjb2xvcjogREVGQVVMVF9ET1RfQ09MT1IsIGhvbGxvdzogdHJ1ZSB9IDogeyBjb2xvcjogbnVsbCwgaG9sbG93OiBmYWxzZSB9O1xuICB9XG4gIGNvbnN0IHN1YnR5cGUgPSBwbHVnaW4udHlwSW5kZXguc3VidHlwZU9mKGZpbGUpO1xuICBpZiAoc2V0dGluZ3MuY29sb3JWaWV3cy5ub3RlVGl0bGVNYXJrZXJTdWJ0eXAgJiYgc3VidHlwZSAmJiBnZXRTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKSkge1xuICAgIHJldHVybiB7IGNvbG9yOiBzdWJ0eXBlQ29sb3Ioc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpLCBob2xsb3c6ICFzdWJ0eXBlSGFzT3duQ29sb3Ioc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpIH07XG4gIH1cbiAgcmV0dXJuIHsgY29sb3I6IHR5cGVDb2xvciwgaG9sbG93OiBmYWxzZSB9O1xufVxuXG4vLyBUaXRlbCBkZXIgTm90aXogc2VsYnN0ICguaW5saW5lLXRpdGxlLCBzaWNodGJhciBzb2Zlcm4gT2JzaWRpYW5zIGVpZ2VuZVxuLy8gRWluc3RlbGx1bmcgXCJJbmxpbmUtVGl0ZWwgYW56ZWlnZW5cIiBha3RpdiBpc3QpLiBCZXd1c3N0IGFscyA6OmJlZm9yZVxuLy8gcmVhbGlzaWVydCAoc2llaGUgc3R5bGVzLmNzcykgc3RhdHQgYWxzIGVpZ2VuZXMgRE9NLUVsZW1lbnQgb2RlciBXcmFwcGVyOlxuLy8gLmlubGluZS10aXRsZSBoXHUwMEU0bmd0IGluIG1laHJlcmVuIFRoZW1lcyAodS4gYS4gTWluaW1hbCkgcGVyIEtpbmQtU2VsZWt0b3Jcbi8vIChcIj5cIikgZGlyZWt0IGFuIHNlaW5lbSBFbHRlcm4tQ29udGFpbmVyICh6LiBCLiBmXHUwMEZDciBtYXgtd2lkdGgvbWFyZ2luKSAtIGVpblxuLy8genVzXHUwMEU0dHpsaWNoZXMgRWxlbWVudCBkYXZvciBvZGVyIGVpbiBXcmFwcGVyIGRhcnVtIHdcdTAwRkNyZGUgZGllc2UgUmVnZWxuXG4vLyB1bnRlcndhbmRlcm4uIEZhcmJlIHVuZCBUWVAtTmFtZSBsYXNzZW4gc2ljaCBlaW5lbSA6OmJlZm9yZSBuaWNodCBkaXJla3Rcbi8vIHp1d2Vpc2VuLCBkYWhlciBkZXIgVW13ZWcgXHUwMEZDYmVyIGVpbmUgQ1NTLVZhcmlhYmxlIGJ6dy4gZWluIGRhdGEtQXR0cmlidXQsXG4vLyBkaWUgZGllIDo6YmVmb3JlLVJlZ2VsbiBhdXNsZXNlbiAodmFyKCkvYXR0cigpKS5cbmZ1bmN0aW9uIGFwcGx5U3R5bGVUb1RpdGxlKHRpdGxlRWwsIG1hcmtlcikge1xuICBjb25zdCBpc0RvdCA9IG1hcmtlci5raW5kID09PSBcImRvdFwiICYmICEhbWFya2VyLmNvbG9yO1xuICBjb25zdCBpc0JhZGdlID0gbWFya2VyLmtpbmQgPT09IFwidGl0bGUtYmFkZ2VcIjtcblxuICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoRE9UX0NMQVNTLCBpc0RvdCk7XG4gIHRpdGxlRWwuY2xhc3NMaXN0LnRvZ2dsZShET1RfSE9MTE9XX0NMQVNTLCBpc0RvdCAmJiAhIW1hcmtlci5ob2xsb3cpO1xuICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoQkFER0VfQ0xBU1MsIGlzQmFkZ2UgJiYgbWFya2VyLmNvbG9yZWQpO1xuICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoQkFER0VfUExBSU5fQ0xBU1MsIGlzQmFkZ2UgJiYgIW1hcmtlci5jb2xvcmVkKTtcblxuICBpZiAoaXNCYWRnZSkgdGl0bGVFbC5kYXRhc2V0LmZyZWRUeXAgPSBtYXJrZXIudHlwZU5hbWU7XG4gIGVsc2UgZGVsZXRlIHRpdGxlRWwuZGF0YXNldC5mcmVkVHlwO1xuXG4gIGNvbnN0IG1hcmtlckNvbG9yID0gKGlzRG90ICYmIG1hcmtlci5jb2xvcikgfHwgKGlzQmFkZ2UgJiYgbWFya2VyLmNvbG9yZWQgJiYgbWFya2VyLmNvbG9yKSA/IG1hcmtlci5jb2xvciA6IG51bGw7XG4gIGlmIChtYXJrZXJDb2xvcikgdGl0bGVFbC5zdHlsZS5zZXRQcm9wZXJ0eShDT0xPUl9WQVIsIG1hcmtlckNvbG9yKTtcbiAgZWxzZSB0aXRsZUVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KENPTE9SX1ZBUik7XG59XG5cbi8vIFByb3BlcnR5LUJsb2NrIGRlciBOb3RpeiAoLm1ldGFkYXRhLWNvbnRhaW5lcikuIERpZSBcImJsb2NrXCItUG9zaXRpb24gdm9uXG4vLyBub3RlVGl0bGVCYWRnZVBvc2l0aW9uOiBkaWVzZWxiZSBCb3ggd2llIGFtIFRpdGVsLCBhYmVyIHVtIDkwXHUwMEIwIGdlZHJlaHRcbi8vICh3cml0aW5nLW1vZGUgc3RhdHQgdHJhbnNmb3JtOnJvdGF0ZSgpIC0gZGFkdXJjaCB3XHUwMEU0Y2hzdCBkaWUgQm94IG1pdCBkZXJcbi8vIFRleHRsXHUwMEU0bmdlIGluIGRlciByaWNodGlnZW4gUmljaHR1bmcsIG9obmUgZGllIFBvc2l0aW9uaWVydW5nIHBlclxuLy8gdHJhbnNmb3JtLW9yaWdpbiB2b24gSGFuZCBuYWNocmVjaG5lbiB6dSBtXHUwMEZDc3NlbikgdW5kIGxpbmtzIGFtIFByb3BlcnR5LUJsb2NrXG4vLyBzdGF0dCBhbSBUaXRlbCB2ZXJhbmtlcnQsIG9iZW4gb2RlciB1bnRlbiAobm90ZVRpdGxlVmVydGljYWxBbGlnbikuIEJsZWlidFxuLy8gYmVpbSAoRWluLS9BdXMtKUJsZW5kZW4gZGVzIEJsb2NrcyAoc2llaGUgUHJvcGVydHktQmxvY2suY3NzKSBhdXRvbWF0aXNjaFxuLy8gbWl0IHZlcnNjaHdpbmRlbi9lcnNjaGVpbmVuLCBkYSBzaWUgYWxzIDo6YmVmb3JlIGRhcmF1ZiBzaXR6dC5cbmZ1bmN0aW9uIGFwcGx5U3R5bGVUb0Jsb2NrKHBsdWdpbiwgYmxvY2tFbCwgbWFya2VyKSB7XG4gIGNvbnN0IGlzQmxvY2tCYWRnZSA9IG1hcmtlci5raW5kID09PSBcImJsb2NrLWJhZGdlXCI7XG5cbiAgYmxvY2tFbC5jbGFzc0xpc3QudG9nZ2xlKEJMT0NLX0JBREdFX0NMQVNTLCBpc0Jsb2NrQmFkZ2UgJiYgbWFya2VyLmNvbG9yZWQpO1xuICBibG9ja0VsLmNsYXNzTGlzdC50b2dnbGUoQkxPQ0tfQkFER0VfUExBSU5fQ0xBU1MsIGlzQmxvY2tCYWRnZSAmJiAhbWFya2VyLmNvbG9yZWQpO1xuXG4gIGNvbnN0IGFsaWduID0gcGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVZlcnRpY2FsQWxpZ247XG4gIGJsb2NrRWwuY2xhc3NMaXN0LnRvZ2dsZShCTE9DS19BTElHTl9UT1BfQ0xBU1MsIGlzQmxvY2tCYWRnZSAmJiBhbGlnbiAhPT0gXCJib3R0b21cIik7XG4gIGJsb2NrRWwuY2xhc3NMaXN0LnRvZ2dsZShCTE9DS19BTElHTl9CT1RUT01fQ0xBU1MsIGlzQmxvY2tCYWRnZSAmJiBhbGlnbiA9PT0gXCJib3R0b21cIik7XG5cbiAgaWYgKGlzQmxvY2tCYWRnZSkgYmxvY2tFbC5kYXRhc2V0LmZyZWRUeXAgPSBtYXJrZXIudHlwZU5hbWU7XG4gIGVsc2UgZGVsZXRlIGJsb2NrRWwuZGF0YXNldC5mcmVkVHlwO1xuXG4gIGNvbnN0IGJsb2NrQ29sb3IgPSBpc0Jsb2NrQmFkZ2UgJiYgbWFya2VyLmNvbG9yZWQgJiYgbWFya2VyLmNvbG9yID8gbWFya2VyLmNvbG9yIDogbnVsbDtcbiAgaWYgKGJsb2NrQ29sb3IpIGJsb2NrRWwuc3R5bGUuc2V0UHJvcGVydHkoQkxPQ0tfQ09MT1JfVkFSLCBibG9ja0NvbG9yKTtcbiAgZWxzZSBibG9ja0VsLnN0eWxlLnJlbW92ZVByb3BlcnR5KEJMT0NLX0NPTE9SX1ZBUik7XG59XG5cbmZ1bmN0aW9uIGFwcGx5QWN0aXZlVGl0bGVDb2xvcnMocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xuICAgIGNvbnN0IGNvbnRhaW5lckVsID0gbGVhZi52aWV3LmNvbnRhaW5lckVsO1xuICAgIGNvbnN0IGZpbGUgPSBsZWFmLnZpZXcuZmlsZTtcbiAgICBjb25zdCB0eXBlZEZpbGUgPSBmaWxlIGluc3RhbmNlb2YgVEZpbGUgPyBmaWxlIDogbnVsbDtcbiAgICBjb25zdCBtYXJrZXIgPSByZXNvbHZlTWFya2VyKHBsdWdpbiwgdHlwZWRGaWxlKTtcblxuICAgIGNvbnN0IHRpdGxlRWwgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKFwiLmlubGluZS10aXRsZVwiKTtcbiAgICBpZiAodGl0bGVFbCkge1xuICAgICAgYXBwbHlTdHlsZVRvVGl0bGUodGl0bGVFbCwgbWFya2VyKTtcblxuICAgICAgY29uc3QgdGV4dENvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Mubm90ZVRpdGxlQ29sb3IgPyBjb2xvckZvckZpbGUocGx1Z2luLCB0eXBlZEZpbGUsIFwibm90ZVRpdGxlQ29sb3JcIikgOiBudWxsO1xuICAgICAgaWYgKHRleHRDb2xvcikgdGl0bGVFbC5zdHlsZS5jb2xvciA9IHRleHRDb2xvcjtcbiAgICAgIGVsc2UgdGl0bGVFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImNvbG9yXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IGJsb2NrRWwgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKFwiLm1ldGFkYXRhLWNvbnRhaW5lclwiKTtcbiAgICBpZiAoYmxvY2tFbCkgYXBwbHlTdHlsZVRvQmxvY2socGx1Z2luLCBibG9ja0VsLCBtYXJrZXIpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseUFjdGl2ZVRpdGxlQ29sb3JzKHBsdWdpbik7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJmaWxlLW9wZW5cIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImFjdGl2ZS1sZWFmLWNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCByZWZyZXNoKSk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeShyZWZyZXNoKTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnMgfTtcbiIsICJjb25zdCB7IGVkaXRvckluZm9GaWVsZCwgZ2V0TGlua3BhdGggfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgVmlld1BsdWdpbiwgRGVjb3JhdGlvbiB9ID0gcmVxdWlyZShcIkBjb2RlbWlycm9yL3ZpZXdcIik7XG5jb25zdCB7IFByZWMsIFJhbmdlU2V0QnVpbGRlciwgU3RhdGVFZmZlY3QgfSA9IHJlcXVpcmUoXCJAY29kZW1pcnJvci9zdGF0ZVwiKTtcbmNvbnN0IHsgc3ludGF4VHJlZSB9ID0gcmVxdWlyZShcIkBjb2RlbWlycm9yL2xhbmd1YWdlXCIpO1xuY29uc3QgeyBjb2xvckZvckZpbGUgfSA9IHJlcXVpcmUoXCIuL3R5cGUtY29sb3JzXCIpO1xuXG4vLyBMaW5rcyBpbSBOb3RpenRleHQgbmFjaCBkZW0gVFlQIGlocmVzIFppZWxzIGVpbmZcdTAwRTRyYmVuLiBPYnNpZGlhbiBmXHUwMEU0cmJ0XG4vLyBpbnRlcm5lIExpbmtzIGluIGJlaWRlbiBEYXJzdGVsbHVuZ2VuIFx1MDBGQ2JlciB2YXIoLS1saW5rLWNvbG9yKSBiencuXG4vLyB2YXIoLS1saW5rLWNvbG9yLWhvdmVyKSAoc2llaGUgYXBwLmNzczogXCIubWFya2Rvd24tcmVuZGVyZWQgLmludGVybmFsLWxpbmtcIlxuLy8gdW5kIFwiLmNtLXMtb2JzaWRpYW4gc3Bhbi5jbS1obWQtaW50ZXJuYWwtbGlua1wiKSAtIHN0YXR0IGVpZ2VuZXIgRmFyYnJlZ2VsblxuLy8gd2lyZCBkYWhlciBudXIgLS1saW5rLWNvbG9yIGplIExpbmsgXHUwMEZDYmVyc2NocmllYmVuLiAtLWxpbmstY29sb3ItaG92ZXIgYmxlaWJ0XG4vLyBiZXd1c3N0IHVuYW5nZXRhc3RldDogYmVpbSBcdTAwRENiZXJmYWhyZW4gZXJzY2hlaW50IHdpZWRlciBkaWUgbm9ybWFsZVxuLy8gTGluay1GYXJiZS4gVW50ZXJzdHJlaWNodW5nIHVuZCBUaGVtZS1BbnBhc3N1bmdlbiBibGVpYmVuIGViZW5zbyBlcmhhbHRlbi5cbi8vXG4vLyBad2VpIGdldHJlbm50ZSBXZWdlLCBkYSBzaWNoIGRpZSBEYXJzdGVsbHVuZ2VuIGdydW5kbGVnZW5kIHVudGVyc2NoZWlkZW46XG4vLyAgLSBMZXNlLU1vZHVzLCBIb3Zlci1Wb3JzY2hhdSwgZ2VyZW5kZXJ0ZSBCbFx1MDBGNmNrZSBpbiBMaXZlIFByZXZpZXcgKFRhYmVsbGVuLFxuLy8gICAgQ2FsbG91dHMpOiBlY2h0ZSA8YSBjbGFzcz1cImludGVybmFsLWxpbmtcIiBkYXRhLWhyZWY9XCJcdTIwMjZcIj4tRWxlbWVudGUgYXVzXG4vLyAgICBPYnNpZGlhbnMgTWFya2Rvd24tUmVuZGVyZXIgLT4gTWFya2Rvd25Qb3N0UHJvY2Vzc29yLCBqZSBMaW5rIGVpbm1hbGlnXG4vLyAgICBiZWltIFJlbmRlcm4uXG4vLyAgLSBMaXZlIFByZXZpZXcvUXVlbGx0ZXh0LU1vZHVzOiBkb3J0IGdpYnQgZXMga2VpbmUgTGluay1FbGVtZW50ZSBtaXRcbi8vICAgIFppZWxhdHRyaWJ1dCwgbnVyIENvZGVNaXJyb3ItU3BhbnMgKFwiLmNtLWhtZC1pbnRlcm5hbC1saW5rXCIpIFx1MDBGQ2JlciBkZW1cbi8vICAgIFJvaHRleHQgLT4gZWlnZW5lciBWaWV3UGx1Z2luLCBkZXIgbnVyIGRlbiBzaWNodGJhcmVuIEJlcmVpY2ggYmV0cmFjaHRldC5cbi8vXG4vLyBOZXUgZWluZ2VmXHUwMEU0cmJ0IHdpcmQgZGFyXHUwMEZDYmVyIGhpbmF1cyBudXIgYmVpIHRhdHNcdTAwRTRjaGxpY2ggZ2VcdTAwRTRuZGVydGVtIFRZUFxuLy8gKHR5cEluZGV4IFwiY2hhbmdlXCIpIG9kZXIgZ2VcdTAwRTRuZGVydGVyIEVpbnN0ZWxsdW5nIC0gbmljaHQgYmVpIGplZGVtIFNwZWljaGVybi5cblxuY29uc3QgQ09MT1JfVkFSID0gXCItLWxpbmstY29sb3JcIjtcbmNvbnN0IFNPVVJDRV9BVFRSID0gXCJkYXRhLWZyZWQtdHlwLXNyY1wiO1xuXG4vLyBbW1ppZWxdXSwgW1taaWVsfEFsaWFzXV0sIFtbWmllbCNcdTAwRENiZXJzY2hyaWZ0XV0gLSBFaW5iZXR0dW5nZW4gKCFbW1x1MjAyNl1dKVxuLy8gYmxlaWJlbiBhdVx1MDBERmVuIHZvciwgZGllIHNpbmQga2VpbmUgTGlua3MgaW0gZWlnZW50bGljaGVuIFNpbm4uIEluIFRhYmVsbGVuXG4vLyBzdGVodCBkaWUgQWxpYXMtUGlwZSBlc2NhcGVkIChcIlxcfFwiKS5cbmNvbnN0IFdJS0lMSU5LX1BBVFRFUk4gPSAvKD88ISEpXFxbXFxbKFteW1xcXV0rPylcXF1cXF0vZztcblxuZnVuY3Rpb24gY29sb3JGb3JMaW5rdGV4dChwbHVnaW4sIGxpbmt0ZXh0LCBzb3VyY2VQYXRoKSB7XG4gIGNvbnN0IHRhcmdldCA9IGxpbmt0ZXh0LnNwbGl0KC9cXFxcP1xcfC8pWzBdLnRyaW0oKTtcbiAgY29uc3QgbGlua3BhdGggPSBnZXRMaW5rcGF0aCh0YXJnZXQpO1xuICBpZiAoIWxpbmtwYXRoKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgZmlsZSA9IHBsdWdpbi5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaXJzdExpbmtwYXRoRGVzdChsaW5rcGF0aCwgc291cmNlUGF0aCk7XG4gIHJldHVybiBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCBcImxpbmtzXCIpO1xufVxuXG4vLyAtLS0gTGVzZS1Nb2R1cyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZnVuY3Rpb24gYXBwbHlUb0FuY2hvcihwbHVnaW4sIGFuY2hvckVsKSB7XG4gIGNvbnN0IGhyZWYgPSBhbmNob3JFbC5nZXRBdHRyaWJ1dGUoXCJkYXRhLWhyZWZcIik7XG4gIGNvbnN0IGNvbG9yID1cbiAgICBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5saW5rcyAmJiBocmVmICYmICFhbmNob3JFbC5jbGFzc0xpc3QuY29udGFpbnMoXCJpcy11bnJlc29sdmVkXCIpXG4gICAgICA/IGNvbG9yRm9yTGlua3RleHQocGx1Z2luLCBocmVmLCBhbmNob3JFbC5nZXRBdHRyaWJ1dGUoU09VUkNFX0FUVFIpID8/IFwiXCIpXG4gICAgICA6IG51bGw7XG4gIGlmIChjb2xvcikgYW5jaG9yRWwuc3R5bGUuc2V0UHJvcGVydHkoQ09MT1JfVkFSLCBjb2xvcik7XG4gIGVsc2UgYW5jaG9yRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoQ09MT1JfVkFSKTtcbn1cblxuLy8gQmVyZWl0cyBnZXJlbmRlcnRlIExpbmtzIG5ldSBlaW5mXHUwMEU0cmJlbiAoVFlQLSBvZGVyIEVpbnN0ZWxsdW5nc1x1MDBFNG5kZXJ1bmcpLiBEZXJcbi8vIFBvc3QtUHJvY2Vzc29yIG1lcmt0IHNpY2ggZGFmXHUwMEZDciBhbiBqZWRlbSBMaW5rIGRlc3NlbiBRdWVsbG5vdGl6LCBkYSBkaWUgenVyXG4vLyBBdWZsXHUwMEY2c3VuZyBtZWhyZGV1dGlnZXIgTGlua3RleHRlIGdlYnJhdWNodCB3aXJkLiBBbGxlIEZlbnN0ZXIgKFBvcC1vdXRzKVxuLy8gXHUwMEZDYmVyIGlocmUgTGVhdmVzIGVpbmdlc2FtbWVsdC5cbmZ1bmN0aW9uIHJlZnJlc2hSZW5kZXJlZExpbmtzKHBsdWdpbikge1xuICBjb25zdCBkb2NzID0gbmV3IFNldCgpO1xuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5pdGVyYXRlQWxsTGVhdmVzKChsZWFmKSA9PiBkb2NzLmFkZChsZWFmLnZpZXcuY29udGFpbmVyRWwub3duZXJEb2N1bWVudCkpO1xuICBmb3IgKGNvbnN0IGRvYyBvZiBkb2NzKSB7XG4gICAgZm9yIChjb25zdCBhbmNob3JFbCBvZiBkb2MucXVlcnlTZWxlY3RvckFsbChgYS5pbnRlcm5hbC1saW5rWyR7U09VUkNFX0FUVFJ9XWApKSBhcHBseVRvQW5jaG9yKHBsdWdpbiwgYW5jaG9yRWwpO1xuICB9XG59XG5cbi8vIC0tLSBMaXZlIFByZXZpZXcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5jb25zdCByZWZyZXNoRWZmZWN0ID0gU3RhdGVFZmZlY3QuZGVmaW5lKCk7XG5cbmZ1bmN0aW9uIGJ1aWxkTGlua1ZpZXdQbHVnaW4ocGx1Z2luKSB7XG4gIGNvbnN0IGRlY29yYXRpb25zQnlDb2xvciA9IG5ldyBNYXAoKTtcbiAgY29uc3QgZGVjb3JhdGlvbkZvciA9IChjb2xvcikgPT4ge1xuICAgIGxldCBkZWNvcmF0aW9uID0gZGVjb3JhdGlvbnNCeUNvbG9yLmdldChjb2xvcik7XG4gICAgaWYgKCFkZWNvcmF0aW9uKSB7XG4gICAgICBkZWNvcmF0aW9uID0gRGVjb3JhdGlvbi5tYXJrKHtcbiAgICAgICAgY2xhc3M6IFwiZnJlZC10eXAtbGlua1wiLFxuICAgICAgICBhdHRyaWJ1dGVzOiB7IHN0eWxlOiBgJHtDT0xPUl9WQVJ9OiAke2NvbG9yfTtgIH0sXG4gICAgICB9KTtcbiAgICAgIGRlY29yYXRpb25zQnlDb2xvci5zZXQoY29sb3IsIGRlY29yYXRpb24pO1xuICAgIH1cbiAgICByZXR1cm4gZGVjb3JhdGlvbjtcbiAgfTtcblxuICBjb25zdCBidWlsZCA9ICh2aWV3KSA9PiB7XG4gICAgaWYgKCFwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5saW5rcykgcmV0dXJuIERlY29yYXRpb24ubm9uZTtcbiAgICBjb25zdCBzb3VyY2VQYXRoID0gdmlldy5zdGF0ZS5maWVsZChlZGl0b3JJbmZvRmllbGQsIGZhbHNlKT8uZmlsZT8ucGF0aCA/PyBcIlwiO1xuICAgIGNvbnN0IHRyZWUgPSBzeW50YXhUcmVlKHZpZXcuc3RhdGUpO1xuICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgUmFuZ2VTZXRCdWlsZGVyKCk7XG5cbiAgICBmb3IgKGNvbnN0IHsgZnJvbSwgdG8gfSBvZiB2aWV3LnZpc2libGVSYW5nZXMpIHtcbiAgICAgIGNvbnN0IHRleHQgPSB2aWV3LnN0YXRlLnNsaWNlRG9jKGZyb20sIHRvKTtcbiAgICAgIFdJS0lMSU5LX1BBVFRFUk4ubGFzdEluZGV4ID0gMDtcbiAgICAgIGZvciAobGV0IG1hdGNoOyAobWF0Y2ggPSBXSUtJTElOS19QQVRURVJOLmV4ZWModGV4dCkpOyApIHtcbiAgICAgICAgY29uc3Qgc3RhcnQgPSBmcm9tICsgbWF0Y2guaW5kZXg7XG4gICAgICAgIC8vIE51ciwgd2FzIE9ic2lkaWFucyBNYXJrZG93bi1QYXJzZXIgc2VsYnN0IGFscyBpbnRlcm5lbiBMaW5rIGVya2VubnQgLVxuICAgICAgICAvLyBzY2hsaWVcdTAwREZ0IHouIEIuIFtbXHUyMDI2XV0gaW4gQ29kZS1CbFx1MDBGNmNrZW4gb2RlciBJbmxpbmUtQ29kZSBhdXMuXG4gICAgICAgIGlmICghdHJlZS5yZXNvbHZlSW5uZXIoc3RhcnQgKyAyLCAxKS5uYW1lLmluY2x1ZGVzKFwiaG1kLWludGVybmFsLWxpbmtcIikpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBjb2xvciA9IGNvbG9yRm9yTGlua3RleHQocGx1Z2luLCBtYXRjaFsxXSwgc291cmNlUGF0aCk7XG4gICAgICAgIGlmIChjb2xvcikgYnVpbGRlci5hZGQoc3RhcnQsIHN0YXJ0ICsgbWF0Y2hbMF0ubGVuZ3RoLCBkZWNvcmF0aW9uRm9yKGNvbG9yKSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBidWlsZGVyLmZpbmlzaCgpO1xuICB9O1xuXG4gIHJldHVybiBWaWV3UGx1Z2luLmZyb21DbGFzcyhcbiAgICBjbGFzcyB7XG4gICAgICBjb25zdHJ1Y3Rvcih2aWV3KSB7XG4gICAgICAgIHRoaXMuZGVjb3JhdGlvbnMgPSBidWlsZCh2aWV3KTtcbiAgICAgIH1cblxuICAgICAgLy8gRGVyIFBhcnNlciBhcmJlaXRldCBkZW4gc2ljaHRiYXJlbiBCZXJlaWNoIGdnZi4gZXJzdCBuYWNoIHVuZCBuYWNoIGFiIC1cbiAgICAgIC8vIGVpbiBuZXVlciBTeW50YXhiYXVtIHpcdTAwRTRobHQgZGFoZXIgZWJlbmZhbGxzIGFscyBBbmxhc3MgenVtIE5ldWF1ZmJhdS5cbiAgICAgIHVwZGF0ZSh1cGRhdGUpIHtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIHVwZGF0ZS5kb2NDaGFuZ2VkIHx8XG4gICAgICAgICAgdXBkYXRlLnZpZXdwb3J0Q2hhbmdlZCB8fFxuICAgICAgICAgIHN5bnRheFRyZWUodXBkYXRlLnN0YXJ0U3RhdGUpICE9PSBzeW50YXhUcmVlKHVwZGF0ZS5zdGF0ZSkgfHxcbiAgICAgICAgICB1cGRhdGUudHJhbnNhY3Rpb25zLnNvbWUoKHRyKSA9PiB0ci5lZmZlY3RzLnNvbWUoKGVmZmVjdCkgPT4gZWZmZWN0LmlzKHJlZnJlc2hFZmZlY3QpKSlcbiAgICAgICAgKSB7XG4gICAgICAgICAgdGhpcy5kZWNvcmF0aW9ucyA9IGJ1aWxkKHVwZGF0ZS52aWV3KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0sXG4gICAgeyBkZWNvcmF0aW9uczogKHZhbHVlKSA9PiB2YWx1ZS5kZWNvcmF0aW9ucyB9XG4gICk7XG59XG5cbmZ1bmN0aW9uIHJlZnJlc2hFZGl0b3JzKHBsdWdpbikge1xuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5pdGVyYXRlQWxsTGVhdmVzKChsZWFmKSA9PiB7XG4gICAgbGVhZi52aWV3Py5lZGl0b3I/LmNtPy5kaXNwYXRjaCh7IGVmZmVjdHM6IHJlZnJlc2hFZmZlY3Qub2YobnVsbCkgfSk7XG4gIH0pO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZnVuY3Rpb24gcmVnaXN0ZXJMaW5rQ29sb3JzKHBsdWdpbikge1xuICBwbHVnaW4ucmVnaXN0ZXJNYXJrZG93blBvc3RQcm9jZXNzb3IoKGVsLCBjdHgpID0+IHtcbiAgICAvLyBRdWVsbGUgaW1tZXIgdmVybWVya2VuLCBhdWNoIGJlaSBhdXNnZXNjaGFsdGV0ZXIgRWluZlx1MDBFNHJidW5nIC0gc28gZ3JlaWZ0XG4gICAgLy8gZWluIHNwXHUwMEU0dGVyZXMgRWluc2NoYWx0ZW4gYXVjaCBmXHUwMEZDciBiZXJlaXRzIGdlcmVuZGVydGUgTGlua3MuXG4gICAgZm9yIChjb25zdCBhbmNob3JFbCBvZiBlbC5xdWVyeVNlbGVjdG9yQWxsKFwiYS5pbnRlcm5hbC1saW5rXCIpKSB7XG4gICAgICBhbmNob3JFbC5zZXRBdHRyaWJ1dGUoU09VUkNFX0FUVFIsIGN0eC5zb3VyY2VQYXRoKTtcbiAgICAgIGFwcGx5VG9BbmNob3IocGx1Z2luLCBhbmNob3JFbCk7XG4gICAgfVxuICB9KTtcbiAgLy8gT2JzaWRpYW5zIFN5bnRheC1TcGFuIFwiLmNtLWhtZC1pbnRlcm5hbC1saW5rXCIgbGllZ3QgdW5hYmhcdTAwRTRuZ2lnIHZvbiBkZXJcbiAgLy8gUHJpb3JpdFx1MDBFNHQgaW1tZXIgYXVcdTAwREZlbiwgZGllIE1hcmtpZXJ1bmcgYWxzbyBkYXJpbiAtIGRpZSBGYXJiZSBzZXR6dCBkYWhlclxuICAvLyBlaW5lIGVpZ2VuZSBSZWdlbCBpbiBzdHlsZXMuY3NzICguZnJlZC10eXAtbGluaykuIE5pZWRyaWdzdGUgUHJpb3JpdFx1MDBFNHQgbGVndFxuICAvLyBzaWUgaW1tZXJoaW4gdW0gXCIuY20tdW5kZXJsaW5lXCIgaGVydW0sIGRhbWl0IGRlciBnYW56ZSBMaW5rdGV4dCBlcmZhc3N0IGlzdC5cbiAgcGx1Z2luLnJlZ2lzdGVyRWRpdG9yRXh0ZW5zaW9uKFByZWMubG93ZXN0KGJ1aWxkTGlua1ZpZXdQbHVnaW4ocGx1Z2luKSkpO1xuXG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiB7XG4gICAgcmVmcmVzaFJlbmRlcmVkTGlua3MocGx1Z2luKTtcbiAgICByZWZyZXNoRWRpdG9ycyhwbHVnaW4pO1xuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICAvLyBEaWUgRWRpdG9yLURla29yYXRpb25lbiB2ZXJzY2h3aW5kZW4gYmVpbSBFbnRsYWRlbiBtaXQgZGVyIEVyd2VpdGVydW5nIHZvblxuICAvLyBzZWxic3QsIGRpZSBJbmxpbmUtVmFyaWFibGVuIGFuIGdlcmVuZGVydGVuIExpbmtzIG5pY2h0LlxuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4ge1xuICAgIHBsdWdpbi5hcHAud29ya3NwYWNlLml0ZXJhdGVBbGxMZWF2ZXMoKGxlYWYpID0+IHtcbiAgICAgIGZvciAoY29uc3QgYW5jaG9yRWwgb2YgbGVhZi52aWV3LmNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3JBbGwoYGEuaW50ZXJuYWwtbGlua1ske1NPVVJDRV9BVFRSfV1gKSkge1xuICAgICAgICBhbmNob3JFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShDT0xPUl9WQVIpO1xuICAgICAgfVxuICAgIH0pO1xuICB9KTtcbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckxpbmtDb2xvcnMgfTtcbiIsICJjb25zdCB7IGdldFN1YnR5cGVOYW1lcywgZ2V0U3VidHlwZSB9ID0gcmVxdWlyZShcIi4vc3VidHlwZXNcIik7XHJcbmNvbnN0IHsgc3VidHlwZUNvbG9yIH0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcclxuXHJcbmNvbnN0IFRZUF9QUk9QRVJUWSA9IFwiVFlQXCI7XHJcbmNvbnN0IFRZUF9WSUVXX1RZUEUgPSBcImZyZWQtdHlwLXZpZXdcIjtcclxuY29uc3QgQUxMX1BST1BFUlRJRVNfVklFV19UWVBFID0gXCJhbGwtcHJvcGVydGllc1wiO1xyXG5jb25zdCBISUdITElHSFRfQ0xBU1MgPSBcImZyZWQtdHlwLWRlZmF1bHQtcHJvcGVydHlcIjtcclxuLy8gRmxvYXRpbmcgUHJvcGVydGllcyAoc2llaGUgdHlwZUZsb2F0aW5nS2V5cyBpbiBzZXR0aW5ncy5qcykgLSBkaWVzZWxiZVxyXG4vLyBMaXN0ZSB3aWUgZGllIFx1MDBGQ2JyaWdlbiBTdGFuZGFyZC1Qcm9wZXJ0aWVzIGRlcyBUeXBzLCBhYmVyIGt1cnNpdiBzdGF0dCBmZXR0XHJcbi8vIG1hcmtpZXJ0LCBhbmFsb2cgenUgSElHSExJR0hUX0NMQVNTLlxyXG5jb25zdCBGTE9BVElOR19DTEFTUyA9IFwiZnJlZC10eXAtZmxvYXRpbmctcHJvcGVydHlcIjtcclxuXHJcbi8vIE9ic2lkaWFuIHNjaHJlaWJ0IGRhdGEtcHJvcGVydHkta2V5IGludGVybiBpbW1lciBrbGVpbiAodW5hYmhcdTAwRTRuZ2lnIHZvbiBkZXJcclxuLy8gU2NocmVpYndlaXNlIGltIFlBTUwpIC0gVmVyZ2xlaWNoIGRlc2hhbGIgZWJlbmZhbGxzIGNhc2UtaW5zZW5zaXRpdmUuIFRZUFxyXG4vLyBpc3Qga2VpbmUgZWNodGUgXCJTdGFuZGFyZFwiLVByb3BlcnR5IChpaHIgV2VydCBpc3QgaW1tZXIgZGVyIFRZUC1OYW1lXHJcbi8vIHNlbGJzdCkgLSBmYWxscyBkb2NoIG5vY2ggaXJnZW5kd28gZWluIGFsdGVyIEVpbnRyYWcgaGVydW1saWVndCwgaGllclxyXG4vLyBlYmVuZmFsbHMgaWdub3JpZXJlbiBzdGF0dCBkaWUgVFlQLVplaWxlIGZldHQgenUgbWFya2llcmVuLlxyXG5mdW5jdGlvbiByYXdLZXlzRm9yVHlwZSh0eXBlLCBkZWZhdWx0cykge1xyXG4gIGlmICghdHlwZSB8fCAhZGVmYXVsdHMpIHJldHVybiBudWxsO1xyXG4gIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyhkZWZhdWx0cykuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gXCJcIiAmJiBrZXkudG9Mb3dlckNhc2UoKSAhPT0gVFlQX1BST1BFUlRZLnRvTG93ZXJDYXNlKCkpO1xyXG4gIHJldHVybiBrZXlzLmxlbmd0aCA+IDAgPyBrZXlzLm1hcCgoa2V5KSA9PiBrZXkudG9Mb3dlckNhc2UoKSkgOiBudWxsO1xyXG59XHJcblxyXG4vLyBGcm9udG1hdHRlci1CbFx1MDBGNmNrZSBlaW5lcyBUWVBzIGFscyBMaXN0ZSB2b24geyBrZXlzLCBmbG9hdGluZyB9IChqZXdlaWxzXHJcbi8vIGxvd2VyY2FzZSk6IHp1ZXJzdCBkYXMgVFlQLUZyb250bWF0dGVyIGRlcyBUWVBzLCBkYW5hY2ggLSBmYWxsc1xyXG4vLyBnZXdcdTAwRkNuc2NodCAtIGRlciBCbG9jayBlaW5lcyBiZXN0aW1tdGVuIFN1YnR5cHMgKHN1YnR5cGUpIGJ6dy4gYWxsZXIgc2VpbmVyXHJcbi8vIFN1YnR5cGVuIChzdWJ0eXBlID09PSBBTExfU1VCVFlQRVMpLCBzaWVoZSBzdWJ0eXBlcy5qcy5cclxuY29uc3QgQUxMX1NVQlRZUEVTID0gU3ltYm9sKFwiYWxsLXN1YnR5cGVzXCIpO1xyXG5cclxuZnVuY3Rpb24gYmxvY2tPZihkZWZhdWx0cywgZmxvYXRpbmdLZXlzLCBzZWN0aW9uID0gbnVsbCkge1xyXG4gIGNvbnN0IGtleXMgPSByYXdLZXlzRm9yVHlwZSh0cnVlLCBkZWZhdWx0cykgPz8gW107XHJcbiAgcmV0dXJuIHsgc2VjdGlvbiwga2V5cywgZmxvYXRpbmc6IG5ldyBTZXQoKGZsb2F0aW5nS2V5cyA/PyBbXSkubWFwKChrZXkpID0+IGtleS50b0xvd2VyQ2FzZSgpKSkgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gYmxvY2tzRm9yVHlwZShwbHVnaW4sIHR5cGUsIHN1YnR5cGUpIHtcclxuICBjb25zdCB7IHNldHRpbmdzIH0gPSBwbHVnaW47XHJcbiAgY29uc3QgYmxvY2tzID0gW2Jsb2NrT2Yoc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXSwgc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXSwgbnVsbCldO1xyXG4gIGNvbnN0IHN1YnR5cGVOYW1lcyA9IHN1YnR5cGUgPT09IEFMTF9TVUJUWVBFUyA/IGdldFN1YnR5cGVOYW1lcyhzZXR0aW5ncywgdHlwZSkgOiBzdWJ0eXBlID8gW3N1YnR5cGVdIDogW107XHJcbiAgZm9yIChjb25zdCBuYW1lIG9mIHN1YnR5cGVOYW1lcykge1xyXG4gICAgY29uc3QgZGF0YSA9IGdldFN1YnR5cGUoc2V0dGluZ3MsIHR5cGUsIG5hbWUpO1xyXG4gICAgaWYgKGRhdGEpIGJsb2Nrcy5wdXNoKGJsb2NrT2YoZGF0YS5mcm9udG1hdHRlciwgZGF0YS5mbG9hdGluZ0tleXMsIG5hbWUpKTtcclxuICB9XHJcbiAgcmV0dXJuIGJsb2NrcztcclxufVxyXG5cclxuLy8gTGllZmVydCBnZXRyZW5udGUgU2V0cyBmXHUwMEZDciBmZXR0IGRhcnp1c3RlbGxlbmRlIChcInN0YW5kYXJkXCIpIHVuZCBrdXJzaXZcclxuLy8gZGFyenVzdGVsbGVuZGUgKFwiZmxvYXRpbmdcIikgUHJvcGVydHktTmFtZW4gKGpld2VpbHMgbG93ZXJjYXNlKSBhdXMgZGVuXHJcbi8vIFx1MDBGQ2JlcmdlYmVuZW4gQmxcdTAwRjZja2VuIC0gRmxvYXRpbmctbWFya2llcnRlIEtleXMgelx1MDBFNGhsZW4gZGFiZWkgbnVyIHp1XHJcbi8vIFwiZmxvYXRpbmdcIiwgbmllIHp1c1x1MDBFNHR6bGljaCB6dSBcInN0YW5kYXJkXCIuIEtvbW10IGVpbiBLZXkgaW4gbWVocmVyZW4gQmxcdTAwRjZja2VuXHJcbi8vIHZvciwgZ2lsdCBkaWUgTWFya2llcnVuZyBkZXMgc3BcdTAwRTR0ZXJlbiBCbG9ja3M6IGZcdTAwRkNyIGVpbmUgTm90aXogc2luZCBkYXNcclxuLy8gVFlQLUZyb250bWF0dGVyIHVuZCBkYW5hY2ggZGVyIEJsb2NrIGlocmVzIFNVQlRZUHMsIGRlciBTdWJ0eXAgZ2V3aW5udCBhbHNvXHJcbi8vIC0gZGllc2VsYmUgUmVnZWwgd2llIGJlaW0gV2VydCBpbiBnZXRUeXBlRGVmYXVsdHMgKG1haW4uanMpLlxyXG5mdW5jdGlvbiBzcGxpdEtleXMoYmxvY2tzKSB7XHJcbiAgY29uc3QgaXNGbG9hdGluZyA9IG5ldyBNYXAoKTtcclxuICBmb3IgKGNvbnN0IHsga2V5cywgZmxvYXRpbmcgfSBvZiBibG9ja3MpIHtcclxuICAgIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIGlzRmxvYXRpbmcuc2V0KGtleSwgZmxvYXRpbmcuaGFzKGtleSkpO1xyXG4gIH1cclxuICBjb25zdCBzdGFuZGFyZCA9IG5ldyBTZXQoKTtcclxuICBjb25zdCBmbG9hdGluZyA9IG5ldyBTZXQoKTtcclxuICBmb3IgKGNvbnN0IFtrZXksIGZsYWddIG9mIGlzRmxvYXRpbmcpIChmbGFnID8gZmxvYXRpbmcgOiBzdGFuZGFyZCkuYWRkKGtleSk7XHJcbiAgcmV0dXJuIHsgc3RhbmRhcmQ6IHN0YW5kYXJkLnNpemUgPiAwID8gc3RhbmRhcmQgOiBudWxsLCBmbG9hdGluZzogZmxvYXRpbmcuc2l6ZSA+IDAgPyBmbG9hdGluZyA6IG51bGwgfTtcclxufVxyXG5cclxuY29uc3QgTk9fS0VZUyA9IHsgc3RhbmRhcmQ6IG51bGwsIGZsb2F0aW5nOiBudWxsIH07XHJcblxyXG5mdW5jdGlvbiBrZXlzRm9yRmlsZShwbHVnaW4sIGZpbGUpIHtcclxuICBjb25zdCB7IGNvbG9yVmlld3MgfSA9IHBsdWdpbi5zZXR0aW5ncztcclxuICBpZiAoIWNvbG9yVmlld3MuZnJvbnRtYXR0ZXJEZWZhdWx0cykgcmV0dXJuIE5PX0tFWVM7XHJcbiAgY29uc3QgdHlwZSA9IHBsdWdpbi50eXBJbmRleC50eXBlT2YoZmlsZSk7XHJcbiAgaWYgKCF0eXBlKSByZXR1cm4gTk9fS0VZUztcclxuICBjb25zdCBzdWJ0eXBlID0gY29sb3JWaWV3cy5mcm9udG1hdHRlckRlZmF1bHRzU3VidHlwID8gcGx1Z2luLnR5cEluZGV4LnN1YnR5cGVPZihmaWxlKSA6IG51bGw7XHJcbiAgcmV0dXJuIHNwbGl0S2V5cyhibG9ja3NGb3JUeXBlKHBsdWdpbiwgdHlwZSwgc3VidHlwZSkpO1xyXG59XHJcblxyXG4vLyBFZGl0b3IgZGVyIFRZUC1EZXRhaWxhbnNpY2h0OiBqZSBCbG9jayBlaW5lIGVpZ2VuZSBFZGl0b3ItSW5zdGFueiAoc2llaGVcclxuLy8gdHlwZVN0b3JlL3N1YnR5cGVTdG9yZSBpbiB0eXBlLWZyb250bWF0dGVyLWVkaXRvci5qcyksIGRpZSBNYXJraWVydW5nIHplaWd0XHJcbi8vIGFsc28gZ2VuYXUgZGllIFN0YW5kYXJkLS9GbG9hdGluZy1Qcm9wZXJ0aWVzIGRpZXNlcyBlaW5lbiBCbG9ja3MgLVxyXG4vLyBTdWJ0eXAtQmxcdTAwRjZja2UgbnVyIG1pdCBkZW0gVW50ZXItU2NoYWx0ZXIgXCJTdWJ0eXBcIi5cclxuZnVuY3Rpb24ga2V5c0ZvclN0b3JlKHBsdWdpbiwgc3RvcmUpIHtcclxuICBjb25zdCB7IGNvbG9yVmlld3MgfSA9IHBsdWdpbi5zZXR0aW5ncztcclxuICBpZiAoIWNvbG9yVmlld3MuZnJvbnRtYXR0ZXJEZWZhdWx0cyB8fCAhc3RvcmUpIHJldHVybiBOT19LRVlTO1xyXG4gIGlmIChzdG9yZS5zdWJ0eXBlICYmICFjb2xvclZpZXdzLmZyb250bWF0dGVyRGVmYXVsdHNTdWJ0eXApIHJldHVybiBOT19LRVlTO1xyXG4gIHJldHVybiBzcGxpdEtleXMoW2Jsb2NrT2Yoc3RvcmUuZ2V0RnJvbnRtYXR0ZXIoKSwgc3RvcmUuZ2V0RmxvYXRpbmcoKSldKTtcclxufVxyXG5cclxuLy8gUHJvcGVydHktTmFtZSAobG93ZXJjYXNlKSAtPiB7IHR5cGVzLCBhbGxGbG9hdGluZyB9IFx1MDBGQ2JlciBhbGxlIFR5cGVuLCBpblxyXG4vLyBkZXJlbiBGcm9udG1hdHRlciAoZ2dmLiBpbmtsLiBpaHJlciBTdWJ0eXAtQmxcdTAwRjZja2UpIGVyIHZvcmtvbW10LiBEaWUgXCJBbGxcclxuLy8gUHJvcGVydGllc1wiLUFuc2ljaHQgaXN0IHZhdWx0LXdlaXQgdW5kIGtlbm50IGtlaW5lbiBlaW56ZWxuZW4gVFlQLUtvbnRleHQgLVxyXG4vLyBkYWhlciBoaWVyIGdsZWljaCBkaWUgdm9sbHN0XHUwMEU0bmRpZ2UgWnVvcmRudW5nIHNhbW1lbG4sIGRhbWl0XHJcbi8vIGFwcGx5VG9BbGxQcm9wZXJ0aWVzVmlldyB6d2lzY2hlbiBcImdlbmF1IGVpbiBUeXBcIiAoZWluZlx1MDBFNHJiZW4pIHVuZCBcIm1laHJlcmVcclxuLy8gVHlwZW5cIiAoZmV0dCkgdW50ZXJzY2hlaWRlbiBrYW5uLiB0eXBlcyBpc3QgTWFwKFRZUCAtPiBMaXN0ZSBkZXIgQmxcdTAwRjZja2UsXHJcbi8vIGRpZSBkZW4gS2V5IGZcdTAwRkNocmVuOyBudWxsIHN0ZWh0IGZcdTAwRkNyIGRhcyBUWVAtRnJvbnRtYXR0ZXIpIC0gZWluIEtleSBkYXJmIGluXHJcbi8vIG1laHJlcmVuIEJsXHUwMEY2Y2tlbiBlaW5lcyBUWVBzIHN0ZWhlbiwgZWluZ2VmXHUwMEU0cmJ0IHdpcmQgbnVyIGRlciBlaW5kZXV0aWdlXHJcbi8vIEZhbGwuIGFsbEZsb2F0aW5nIGlzdCB0cnVlLCB3ZW5uIGRlciBLZXkgaW4gSkVERU0gQmxvY2sgSkVERVMgVHlwcyBhbHNcclxuLy8gRmxvYXRpbmcgbWFya2llcnQgaXN0IChzb25zdCB3XHUwMEU0cmUgZGllIEt1cnNpdi1NYXJraWVydW5nIGlycmVmXHUwMEZDaHJlbmQpLlxyXG4vL1xyXG4vLyBFaWdlbmVyIFNjaGFsdGVyIChjb2xvclZpZXdzLmFsbFByb3BlcnRpZXMpLCB1bmFiaFx1MDBFNG5naWcgdm9uXHJcbi8vIGNvbG9yVmlld3MuZnJvbnRtYXR0ZXJEZWZhdWx0cy4gRWluZSBTdWJ0eXAtUHJvcGVydHkgelx1MDBFNGhsdCBmXHUwMEZDciBpaHJlbiBUWVAuXHJcbmZ1bmN0aW9uIHR5cGVzVXNpbmdLZXlNYXAocGx1Z2luKSB7XHJcbiAgY29uc3QgbWFwID0gbmV3IE1hcCgpO1xyXG4gIGNvbnN0IHsgY29sb3JWaWV3cyB9ID0gcGx1Z2luLnNldHRpbmdzO1xyXG4gIGlmICghY29sb3JWaWV3cy5hbGxQcm9wZXJ0aWVzKSByZXR1cm4gbWFwO1xyXG4gIGNvbnN0IHR5cGVzID0gbmV3IFNldChbXHJcbiAgICAuLi5PYmplY3Qua2V5cyhwbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlciksXHJcbiAgICAuLi4oY29sb3JWaWV3cy5hbGxQcm9wZXJ0aWVzU3VidHlwID8gT2JqZWN0LmtleXMocGx1Z2luLnNldHRpbmdzLnR5cGVTdWJ0eXBlcyA/PyB7fSkgOiBbXSksXHJcbiAgXSk7XHJcbiAgZm9yIChjb25zdCB0eXBlIG9mIHR5cGVzKSB7XHJcbiAgICBjb25zdCBibG9ja3MgPSBibG9ja3NGb3JUeXBlKHBsdWdpbiwgdHlwZSwgY29sb3JWaWV3cy5hbGxQcm9wZXJ0aWVzU3VidHlwID8gQUxMX1NVQlRZUEVTIDogbnVsbCk7XHJcbiAgICBmb3IgKGNvbnN0IHsgc2VjdGlvbiwga2V5cywgZmxvYXRpbmcgfSBvZiBibG9ja3MpIHtcclxuICAgICAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykge1xyXG4gICAgICAgIGlmICghbWFwLmhhcyhrZXkpKSBtYXAuc2V0KGtleSwgeyB0eXBlczogbmV3IE1hcCgpLCBhbGxGbG9hdGluZzogdHJ1ZSB9KTtcclxuICAgICAgICBjb25zdCBlbnRyeSA9IG1hcC5nZXQoa2V5KTtcclxuICAgICAgICBpZiAoIWVudHJ5LnR5cGVzLmhhcyh0eXBlKSkgZW50cnkudHlwZXMuc2V0KHR5cGUsIFtdKTtcclxuICAgICAgICBlbnRyeS50eXBlcy5nZXQodHlwZSkucHVzaChzZWN0aW9uKTtcclxuICAgICAgICBlbnRyeS5hbGxGbG9hdGluZyA9IGVudHJ5LmFsbEZsb2F0aW5nICYmIGZsb2F0aW5nLmhhcyhrZXkpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG4gIHJldHVybiBtYXA7XHJcbn1cclxuXHJcbi8vIE51ciBkYXMgTGFiZWwgKFByb3BlcnR5LUtleS1JbnB1dCkgZmV0dC9rdXJzaXYgbWFya2llcmVuLCBuaWNodCBkaWUgV2VydGUgLVxyXG4vLyBiZXRyaWZmdCBzb3dvaGwgTm90aXplbiAoRnJvbnRtYXR0ZXIgaW0gRG9rdW1lbnQgKyBcIlByb3BlcnRpZXNcIi1cclxuLy8gU2VpdGVubGVpc3RlKSBhbHMgYXVjaCBkaWUgZWlnZW5lIFRZUC1EZXRhaWxhbnNpY2h0IGRlcyBQbHVnaW5zIHNlbGJzdC5cclxuZnVuY3Rpb24gYXBwbHlUb0NvbnRhaW5lcihjb250YWluZXJFbCwgc3RhbmRhcmRLZXlzLCBmbG9hdGluZ0tleXMpIHtcclxuICBpZiAoIWNvbnRhaW5lckVsKSByZXR1cm47XHJcbiAgY29uc3Qgcm93cyA9IGNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIubWV0YWRhdGEtcHJvcGVydHlbZGF0YS1wcm9wZXJ0eS1rZXldXCIpO1xyXG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcclxuICAgIGNvbnN0IGtleUVsID0gcm93LnF1ZXJ5U2VsZWN0b3IoXCIubWV0YWRhdGEtcHJvcGVydHkta2V5LWlucHV0XCIpO1xyXG4gICAgaWYgKCFrZXlFbCkgY29udGludWU7XHJcbiAgICBjb25zdCBwcm9wZXJ0eUtleSA9IHJvdy5nZXRBdHRyaWJ1dGUoXCJkYXRhLXByb3BlcnR5LWtleVwiKTtcclxuICAgIGtleUVsLmNsYXNzTGlzdC50b2dnbGUoSElHSExJR0hUX0NMQVNTLCAhIXN0YW5kYXJkS2V5cyAmJiBzdGFuZGFyZEtleXMuaGFzKHByb3BlcnR5S2V5KSk7XHJcbiAgICBrZXlFbC5jbGFzc0xpc3QudG9nZ2xlKEZMT0FUSU5HX0NMQVNTLCAhIWZsb2F0aW5nS2V5cyAmJiBmbG9hdGluZ0tleXMuaGFzKHByb3BlcnR5S2V5KSk7XHJcbiAgfVxyXG59XHJcblxyXG4vLyBEaWUgXCJBbGwgUHJvcGVydGllc1wiLUFuc2ljaHQgcmVuZGVydCBpaHJlIFplaWxlbiBuaWNodCBcdTAwRkNiZXIgZGFzXHJcbi8vIE1ldGFkYXRhLVdpZGdldCwgc29uZGVybiBcdTAwRkNiZXIgZWlnZW5lIFRyZWUtSXRlbS1Lb21wb25lbnRlbiAoS2xhc3NlIFwiYUhcIiBpbVxyXG4vLyBnZWJhdXRlbiBhcHAuanMpLCBlcnJlaWNoYmFyIFx1MDBGQ2JlciB2aWV3LmRvbXMgKFByb3BlcnR5LU5hbWUgLT4gS29tcG9uZW50ZSkuXHJcbi8vIERlcmVuIFRpdGVsLUVsZW1lbnQgdHJcdTAwRTRndCBkaWUgS2xhc3NlIFwidHJlZS1pdGVtLWlubmVyLXRleHRcIiwgbmljaHRcclxuLy8gXCIubWV0YWRhdGEtcHJvcGVydHkta2V5LWlucHV0XCIgd2llIGltIEZyb250bWF0dGVyLVdpZGdldC5cclxuLy9cclxuLy8gTnV0enQgZ2VuYXUgZWluIFR5cCBkaWVzZSBQcm9wZXJ0eSBhbHMgU3RhbmRhcmQsIHdpcmQgZGVyIE5hbWUgaW4gZGVzc2VuXHJcbi8vIEZhcmJlIGVpbmdlZlx1MDBFNHJidCAod2llIGRlciBGYXJicHVua3QvZGllIExpc3RlIGRlcyBUeXBzKSAtIGVpbmRldXRpZyBnZW51ZyxcclxuLy8gdW0gc2llIHp1enVvcmRuZW4uIE51dHplbiBtZWhyZXJlIFR5cGVuIHNpZSwgd1x1MDBFNHJlIGVpbmUgZWluemVsbmUgRmFyYmVcclxuLy8gaXJyZWZcdTAwRkNocmVuZCwgZGFoZXIgc3RhdHRkZXNzZW4gZmV0dCAoZGllc2VsYmUgTWFya2llcnVuZyB3aWUgaW1cclxuLy8gRnJvbnRtYXR0ZXItV2lkZ2V0IGVpbmVyIE5vdGl6KS5cclxuZnVuY3Rpb24gYXBwbHlUb0FsbFByb3BlcnRpZXNWaWV3KHBsdWdpbikge1xyXG4gIGNvbnN0IHVzYWdlTWFwID0gdHlwZXNVc2luZ0tleU1hcChwbHVnaW4pO1xyXG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoQUxMX1BST1BFUlRJRVNfVklFV19UWVBFKSkge1xyXG4gICAgY29uc3QgZG9tcyA9IGxlYWYudmlldz8uZG9tcztcclxuICAgIGlmICghZG9tcykgY29udGludWU7XHJcbiAgICBmb3IgKGNvbnN0IFtrZXksIGRvbV0gb2YgT2JqZWN0LmVudHJpZXMoZG9tcykpIHtcclxuICAgICAgY29uc3QgdGl0bGVFbCA9IGRvbT8udGl0bGVFbDtcclxuICAgICAgaWYgKCF0aXRsZUVsKSBjb250aW51ZTtcclxuXHJcbiAgICAgIGNvbnN0IGVudHJ5ID0gdXNhZ2VNYXAuZ2V0KGtleS50b0xvd2VyQ2FzZSgpKTtcclxuICAgICAgY29uc3QgdHlwZXMgPSBlbnRyeT8udHlwZXM7XHJcbiAgICAgIGNvbnN0IGNvdW50ID0gdHlwZXMgPyB0eXBlcy5zaXplIDogMDtcclxuICAgICAgdGl0bGVFbC5jbGFzc0xpc3QudG9nZ2xlKEhJR0hMSUdIVF9DTEFTUywgY291bnQgPiAxKTtcclxuXHJcbiAgICAgIC8vIEt1cnNpdiwgc29iYWxkIGRpZSBQcm9wZXJ0eSBcdTAwRENCRVJBTEwgYWxzIEZsb2F0aW5nIG1hcmtpZXJ0IGlzdCAtIGluXHJcbiAgICAgIC8vIGplZGVtIEJsb2NrIGplZGVzIFRZUHMsIGRlciBzaWUgZlx1MDBGQ2hydC4gQW5kZXJzIGFscyBkaWUgRmV0dC1NYXJraWVydW5nXHJcbiAgICAgIC8vIGlzdCBkYXMgbmljaHQgYXVmIFwiZ2VuYXUgZWluIFRZUFwiIGJlc2Noclx1MDBFNG5rdDogYmVpZGVzIGthbm4gYWxzb1xyXG4gICAgICAvLyB6dXNhbW1lbnRyZWZmZW4gKG1laHJlcmUgVFlQZW4sIGRvcnQgZHVyY2h3ZWcgZmxvYXRpbmcpLlxyXG4gICAgICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoRkxPQVRJTkdfQ0xBU1MsIGNvdW50ID4gMCAmJiBlbnRyeS5hbGxGbG9hdGluZyk7XHJcblxyXG4gICAgICAvLyBNaXQgXCJTdWJ0eXBcIiBpbiBkZXIgRmFyYmUgZGVzIFN1YnR5cC1CbG9ja3MsIGF1cyBkZW0gZGllIFByb3BlcnR5XHJcbiAgICAgIC8vIHN0YW1tdCAtIGFiZXIgbnVyLCB3ZW5uIHNpZSBpbiBnZW5hdSBlaW5lbSBCbG9jayBkaWVzZXMgVFlQcyBzdGVodC5cclxuICAgICAgLy8gQmVpIGVpbmVyIERvcHBsdW5nIFx1MDBGQ2JlciBtZWhyZXJlIEJsXHUwMEY2Y2tlIHdcdTAwRTRyZSBkaWUgV2FobCB3aWxsa1x1MDBGQ3JsaWNoIHVuZFxyXG4gICAgICAvLyB3XHUwMEZDcmRlIHNpY2ggYmVpbSBVbXNvcnRpZXJlbiBkZXIgQmxcdTAwRjZja2UgXHUwMEU0bmRlcm4sIGRhaGVyIGRhbm4gZGllXHJcbiAgICAgIC8vIFRZUC1GYXJiZSAoc3VidHlwZUNvbG9yIG1pdCBudWxsIGxpZWZlcnQgZ2VuYXUgZGllKS5cclxuICAgICAgaWYgKGNvdW50ID09PSAxKSB7XHJcbiAgICAgICAgY29uc3QgW1tvbmx5VHlwZSwgc2VjdGlvbnNdXSA9IHR5cGVzO1xyXG4gICAgICAgIGNvbnN0IGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MuYWxsUHJvcGVydGllc1N1YnR5cFxyXG4gICAgICAgICAgPyBzdWJ0eXBlQ29sb3IocGx1Z2luLnNldHRpbmdzLCBvbmx5VHlwZSwgc2VjdGlvbnMubGVuZ3RoID09PSAxID8gc2VjdGlvbnNbMF0gOiBudWxsKVxyXG4gICAgICAgICAgOiBwbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1tvbmx5VHlwZV07XHJcbiAgICAgICAgLy8gIWltcG9ydGFudCB2aWEgc2V0UHJvcGVydHksIGRhIGRpZSBGZXR0LVJlZ2VsIGZcdTAwRkNyIC5mcmVkLXR5cC1kZWZhdWx0LVxyXG4gICAgICAgIC8vIHByb3BlcnR5IGluIHN0eWxlcy5jc3MgZWJlbmZhbGxzICFpbXBvcnRhbnQgY29sb3Igc2V0enQgdW5kIGVpblxyXG4gICAgICAgIC8vIElubGluZS1TdHlsZSBvaG5lICFpbXBvcnRhbnQgZGFnZWdlbiB2ZXJsaWVyZW4gd1x1MDBGQ3JkZSwgZmFsbHMgZGllXHJcbiAgICAgICAgLy8gS2xhc3NlIChhdXMgZWluZW0gdm9yaGVyaWdlbiBadXN0YW5kIG1pdCBtZWhyZXJlbiBUeXBlbikgbm9jaCBkcmFuaFx1MDBFNG5ndC5cclxuICAgICAgICBpZiAoY29sb3IpIHRpdGxlRWwuc3R5bGUuc2V0UHJvcGVydHkoXCJjb2xvclwiLCBjb2xvciwgXCJpbXBvcnRhbnRcIik7XHJcbiAgICAgICAgZWxzZSB0aXRsZUVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KFwiY29sb3JcIik7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgdGl0bGVFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImNvbG9yXCIpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBhcHBseUZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodChwbHVnaW4pIHtcclxuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikpIHtcclxuICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXc7XHJcbiAgICBjb25zdCB7IHN0YW5kYXJkLCBmbG9hdGluZyB9ID0ga2V5c0ZvckZpbGUocGx1Z2luLCB2aWV3Py5maWxlKTtcclxuICAgIGFwcGx5VG9Db250YWluZXIodmlldz8ubWV0YWRhdGFFZGl0b3I/LmNvbnRhaW5lckVsLCBzdGFuZGFyZCwgZmxvYXRpbmcpO1xyXG4gIH1cclxuXHJcbiAgLy8gRGllIFwiUHJvcGVydGllc1wiLVNlaXRlbmxlaXN0ZSB6ZWlndCBpbW1lciBkaWUgYWt0aXZlIERhdGVpLCBoXHUwMEU0bHQgYWJlclxyXG4gIC8vIGtlaW5lIGVpZ2VuZSwgdmVybFx1MDBFNHNzbGljaGUgUmVmZXJlbnogZGFyYXVmIGdyaWZmYmVyZWl0IHdpZSBNYXJrZG93blZpZXcgLVxyXG4gIC8vIGRhaGVyIGF1ZiBkaWUgdm9tIFdvcmtzcGFjZSBha3R1ZWxsIGFrdGl2ZSBEYXRlaSB6dXJcdTAwRkNja2ZhbGxlbi5cclxuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwiZmlsZS1wcm9wZXJ0aWVzXCIpKSB7XHJcbiAgICBjb25zdCB2aWV3ID0gbGVhZi52aWV3O1xyXG4gICAgY29uc3QgZmlsZSA9IHZpZXc/LmZpbGUgPz8gcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xyXG4gICAgY29uc3QgeyBzdGFuZGFyZCwgZmxvYXRpbmcgfSA9IGtleXNGb3JGaWxlKHBsdWdpbiwgZmlsZSk7XHJcbiAgICBhcHBseVRvQ29udGFpbmVyKHZpZXc/Lm1ldGFkYXRhRWRpdG9yPy5jb250YWluZXJFbCwgc3RhbmRhcmQsIGZsb2F0aW5nKTtcclxuICB9XHJcblxyXG4gIC8vIFRZUC1EZXRhaWxhbnNpY2h0IGRlcyBQbHVnaW5zIHNlbGJzdDogZG9ydCB6ZWlndCBqZWRlciBFZGl0b3IgZGlyZWt0IGVpbmVuXHJcbiAgLy8gRnJvbnRtYXR0ZXItQmxvY2sgKFRZUCBiencuIFN1YnR5cCksIGVudHNwcmljaHQgYWxzbyAxOjEgZGVzc2VuXHJcbiAgLy8gXCJTdGFuZGFyZFwiLSBiencuIFwiRmxvYXRpbmdcIi1Qcm9wZXJ0aWVzICh2aWV3LmZyb250bWF0dGVyRWRpdG9ycyBrb21tdCBhdXNcclxuICAvLyB0eXAtdmlldy5qcywgZWRpdG9yLm93bmVyLmZyZWRTdG9yZSBhdXMgdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpLlxyXG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoVFlQX1ZJRVdfVFlQRSkpIHtcclxuICAgIGZvciAoY29uc3QgZWRpdG9yIG9mIGxlYWYudmlldz8uZnJvbnRtYXR0ZXJFZGl0b3JzID8/IFtdKSB7XHJcbiAgICAgIGNvbnN0IHsgc3RhbmRhcmQsIGZsb2F0aW5nIH0gPSBrZXlzRm9yU3RvcmUocGx1Z2luLCBlZGl0b3Iub3duZXI/LmZyZWRTdG9yZSk7XHJcbiAgICAgIGFwcGx5VG9Db250YWluZXIoZWRpdG9yLmNvbnRhaW5lckVsLCBzdGFuZGFyZCwgZmxvYXRpbmcpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXBwbHlUb0FsbFByb3BlcnRpZXNWaWV3KHBsdWdpbik7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlZ2lzdGVyRnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0KHBsdWdpbikge1xyXG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseUZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodChwbHVnaW4pO1xyXG5cclxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLm1ldGFkYXRhQ2FjaGUub24oXCJjaGFuZ2VkXCIsIHJlZnJlc2gpKTtcclxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLm1ldGFkYXRhQ2FjaGUub24oXCJyZXNvbHZlZFwiLCByZWZyZXNoKSk7XHJcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsIHJlZnJlc2gpKTtcclxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImFjdGl2ZS1sZWFmLWNoYW5nZVwiLCByZWZyZXNoKSk7XHJcblxyXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkocmVmcmVzaCk7XHJcblxyXG4gIHJldHVybiByZWZyZXNoO1xyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQgfTtcclxuIiwgImNvbnN0IHsgTm90aWNlIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XHJcbmNvbnN0IHsgdHlwZVN0b3JlLCBzdWJ0eXBlU3RvcmUgfSA9IHJlcXVpcmUoXCIuL3R5cGUtZnJvbnRtYXR0ZXItZWRpdG9yXCIpO1xyXG5jb25zdCB7IGdldFN1YnR5cGVOYW1lcywgaXNFbXB0eVZhbHVlIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBlc1wiKTtcclxuXHJcbmNvbnN0IFRZUF9QUk9QRVJUWSA9IFwiVFlQXCI7XHJcbmNvbnN0IFNVQlRZUF9QUk9QRVJUWSA9IFwiU1VCVFlQXCI7XHJcblxyXG4vLyBPYnNpZGlhbiBzY2hyZWlidCBQcm9wZXJ0eS1OYW1lbiBpbnRlcm4ga2xlaW4gKHNpZWhlIGZyb250bWF0dGVyLWRlZmF1bHQtXHJcbi8vIGhpZ2hsaWdodC5qcykgLSBadW9yZG51bmcgZGFoZXIgY2FzZS1pbnNlbnNpdGl2LCBkZXIgbmV1ZSBOYW1lIHdpcmQgYWJlclxyXG4vLyBleGFrdCBzbyBcdTAwRkNiZXJub21tZW4sIHdpZSBlciBlaW5nZWdlYmVuIHd1cmRlLlxyXG5mdW5jdGlvbiBzYW1lS2V5KGEsIGIpIHtcclxuICByZXR1cm4gYS50b0xvd2VyQ2FzZSgpID09PSBiLnRvTG93ZXJDYXNlKCk7XHJcbn1cclxuXHJcbi8vIEJlbmVubnQgb2xkS2V5IGluIGVpbmVtIEZyb250bWF0dGVyLUJsb2NrIChUWVAgb2RlciBTdWJ0eXAsIHNpZWhlXHJcbi8vIHR5cGVTdG9yZS9zdWJ0eXBlU3RvcmUgaW4gdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpIHVtIChSZWloZW5mb2xnZSBibGVpYnRcclxuLy8gZXJoYWx0ZW4pIHVuZCB6aWVodCBkaWUgRmxvYXRpbmctTWFya2llcnVuZyBtaXQuIEdpYnQgZXMgbmV3S2V5IGRvcnQgYmVyZWl0c1xyXG4vLyAoWnVzYW1tZW5sZWdlbiwgYW5hbG9nIHp1IE9ic2lkaWFucyBlaWdlbmVtIE1lcmdlIGluIGRlbiBOb3RpemVuKSwgYmxlaWJ0IGRlclxyXG4vLyBiZXN0ZWhlbmRlIEVpbnRyYWcgYW4gc2VpbmVyIFBvc2l0aW9uIC0gZGVyIFdlcnQgZGVzIGFsdGVuIEVpbnRyYWdzIHdpcmQgbnVyXHJcbi8vIFx1MDBGQ2Jlcm5vbW1lbiwgd2VubiBkZXIgYmVzdGVoZW5kZSBsZWVyIGlzdC4gTGllZmVydCB0cnVlIGJlaSBlaW5lciBcdTAwQzRuZGVydW5nLlxyXG5mdW5jdGlvbiByZW5hbWVJblN0b3JlKHN0b3JlLCBvbGRLZXksIG5ld0tleSkge1xyXG4gIGNvbnN0IGRlZmF1bHRzID0gc3RvcmUuZ2V0RnJvbnRtYXR0ZXIoKTtcclxuICBjb25zdCBrZXlzID0gT2JqZWN0LmtleXMoZGVmYXVsdHMpO1xyXG4gIGNvbnN0IHNvdXJjZUtleSA9IGtleXMuZmluZCgoa2V5KSA9PiBzYW1lS2V5KGtleSwgb2xkS2V5KSk7XHJcbiAgaWYgKHNvdXJjZUtleSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7XHJcbiAgLy8gQmVpIGVpbmVyIHJlaW5lbiBcdTAwQzRuZGVydW5nIGRlciBHcm9cdTAwREYtL0tsZWluc2NocmVpYnVuZyBpc3Qgc291cmNlS2V5IHNlbGJzdFxyXG4gIC8vIGRlciBlaW56aWdlIFRyZWZmZXIgZlx1MDBGQ3IgbmV3S2V5IC0gZGFzIGlzdCBkYW5uIGtlaW4gWnVzYW1tZW5sZWdlbi5cclxuICBjb25zdCB0YXJnZXRLZXkgPSBrZXlzLmZpbmQoKGtleSkgPT4ga2V5ICE9PSBzb3VyY2VLZXkgJiYgc2FtZUtleShrZXksIG5ld0tleSkpO1xyXG4gIGlmICh0YXJnZXRLZXkgPT09IHVuZGVmaW5lZCAmJiBzb3VyY2VLZXkgPT09IG5ld0tleSkgcmV0dXJuIGZhbHNlO1xyXG5cclxuICBjb25zdCBuZXh0ID0ge307XHJcbiAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykge1xyXG4gICAgaWYgKGtleSAhPT0gc291cmNlS2V5KSB7XHJcbiAgICAgIG5leHRba2V5XSA9IGRlZmF1bHRzW2tleV07XHJcbiAgICB9IGVsc2UgaWYgKHRhcmdldEtleSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIG5leHRbbmV3S2V5XSA9IGRlZmF1bHRzW3NvdXJjZUtleV07XHJcbiAgICB9XHJcbiAgfVxyXG4gIGlmICh0YXJnZXRLZXkgIT09IHVuZGVmaW5lZCAmJiBpc0VtcHR5VmFsdWUobmV4dFt0YXJnZXRLZXldKSkgbmV4dFt0YXJnZXRLZXldID0gZGVmYXVsdHNbc291cmNlS2V5XTtcclxuICBzdG9yZS5zZXRGcm9udG1hdHRlcihuZXh0KTtcclxuXHJcbiAgY29uc3QgZmxvYXRpbmcgPSBzdG9yZS5nZXRGbG9hdGluZygpO1xyXG4gIGlmIChmbG9hdGluZy5sZW5ndGggPiAwKSB7XHJcbiAgICAvLyBCZWltIFp1c2FtbWVubGVnZW4gYmxlaWJ0IGRpZSBGbG9hdGluZy1NYXJraWVydW5nIGRlcyBaaWVscyBtYVx1MDBERmdlYmxpY2guXHJcbiAgICBzdG9yZS5zZXRGbG9hdGluZyhcclxuICAgICAgdGFyZ2V0S2V5ICE9PSB1bmRlZmluZWRcclxuICAgICAgICA/IGZsb2F0aW5nLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IHNvdXJjZUtleSlcclxuICAgICAgICA6IGZsb2F0aW5nLm1hcCgoa2V5KSA9PiAoa2V5ID09PSBzb3VyY2VLZXkgPyBuZXdLZXkgOiBrZXkpKVxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIC8vIERlciBTaG9ydGN1dCBoXHUwMEU0bmd0IGFtIEtleSAoc2llaGUgc2hvcnRjdXRzLmpzKSB1bmQgd2FuZGVydCBkZXNoYWxiIG1pdCBkZXJcclxuICAvLyBVbWJlbmVubnVuZyBtaXQgLSBiZWltIFp1c2FtbWVubGVnZW4gYmxlaWJ0LCB3aWUgYmVpIEZsb2F0aW5nLCBkZXIgZGVzXHJcbiAgLy8gWmllbHMgbWFcdTAwREZnZWJsaWNoLlxyXG4gIGNvbnN0IHNob3J0Y3V0cyA9IHsgLi4uc3RvcmUuZ2V0U2hvcnRjdXRzKCkgfTtcclxuICBpZiAoc2hvcnRjdXRzW3NvdXJjZUtleV0pIHtcclxuICAgIGlmICh0YXJnZXRLZXkgPT09IHVuZGVmaW5lZCkgc2hvcnRjdXRzW25ld0tleV0gPSBzaG9ydGN1dHNbc291cmNlS2V5XTtcclxuICAgIGRlbGV0ZSBzaG9ydGN1dHNbc291cmNlS2V5XTtcclxuICAgIHN0b3JlLnNldFNob3J0Y3V0cyhzaG9ydGN1dHMpO1xyXG4gIH1cclxuICByZXR1cm4gdHJ1ZTtcclxufVxyXG5cclxuLy8gRWluemVsLVByb3BlcnR5LUVpbnRyXHUwMEU0Z2UgZGVyIGdsb2JhbGVuIFJlaWhlbmZvbGdlIC0gZG9ydCBzaW5kIGtlaW5lXHJcbi8vIERvcHBsdW5nZW4gZXJsYXVidCwgZWluIGJlcmVpdHMgdm9yaGFuZGVuZXIgWmllbGVpbnRyYWcgYmVoXHUwMEU0bHQgZGFoZXIgc2VpbmVcclxuLy8gUG9zaXRpb24gdW5kIGRlciBhbHRlIGVudGZcdTAwRTRsbHQuXHJcbmZ1bmN0aW9uIHJlbmFtZUluR2xvYmFsT3JkZXIoc2V0dGluZ3MsIG9sZEtleSwgbmV3S2V5KSB7XHJcbiAgY29uc3Qgb3JkZXIgPSBzZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyO1xyXG4gIGNvbnN0IHNvdXJjZSA9IG9yZGVyLmZpbmQoKGVudHJ5KSA9PiBlbnRyeS5raW5kID09PSBcInByb3BlcnR5XCIgJiYgc2FtZUtleShlbnRyeS5uYW1lLCBvbGRLZXkpKTtcclxuICBpZiAoIXNvdXJjZSkgcmV0dXJuIGZhbHNlO1xyXG4gIGNvbnN0IHRhcmdldCA9IG9yZGVyLmZpbmQoKGVudHJ5KSA9PiBlbnRyeSAhPT0gc291cmNlICYmIGVudHJ5LmtpbmQgPT09IFwicHJvcGVydHlcIiAmJiBzYW1lS2V5KGVudHJ5Lm5hbWUsIG5ld0tleSkpO1xyXG4gIGlmICh0YXJnZXQpIHNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIgPSBvcmRlci5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeSAhPT0gc291cmNlKTtcclxuICBlbHNlIGlmIChzb3VyY2UubmFtZSA9PT0gbmV3S2V5KSByZXR1cm4gZmFsc2U7XHJcbiAgZWxzZSBzb3VyY2UubmFtZSA9IG5ld0tleTtcclxuICByZXR1cm4gdHJ1ZTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gc3luY1JlbmFtZShwbHVnaW4sIG9sZEtleSwgbmV3S2V5KSB7XHJcbiAgaWYgKHR5cGVvZiBvbGRLZXkgIT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIG5ld0tleSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuO1xyXG4gIG5ld0tleSA9IG5ld0tleS50cmltKCk7XHJcbiAgaWYgKG9sZEtleSA9PT0gXCJcIiB8fCBuZXdLZXkgPT09IFwiXCIgfHwgb2xkS2V5ID09PSBuZXdLZXkpIHJldHVybjtcclxuICAvLyBUWVAvU1VCVFlQIHNpbmQgbmllIFRlaWwgZWluZXMgRnJvbnRtYXR0ZXItQmxvY2tzIChzaWVoZSBzdHJpcFR5cFByb3BlcnR5XHJcbiAgLy8gaW4gdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpIC0gZWluIFVtYmVuZW5uZW4gdm9uL25hY2ggVFlQL1NVQlRZUCBkYWhlclxyXG4gIC8vIGlnbm9yaWVyZW4uXHJcbiAgaWYgKFtvbGRLZXksIG5ld0tleV0uc29tZSgoa2V5KSA9PiBzYW1lS2V5KGtleSwgVFlQX1BST1BFUlRZKSB8fCBzYW1lS2V5KGtleSwgU1VCVFlQX1BST1BFUlRZKSkpIHJldHVybjtcclxuXHJcbiAgY29uc3QgeyBzZXR0aW5ncyB9ID0gcGx1Z2luO1xyXG4gIGxldCB0eXBlQ291bnQgPSAwO1xyXG4gIGxldCBzdWJ0eXBlQ291bnQgPSAwO1xyXG4gIGNvbnN0IGNvdW50ID0gKHN0b3JlKSA9PiAoc3RvcmUuc3VidHlwZSA/IHN1YnR5cGVDb3VudCsrIDogdHlwZUNvdW50KyspO1xyXG4gIGNvbnN0IHR5cGVzID0gbmV3IFNldChbLi4uT2JqZWN0LmtleXMoc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlciksIC4uLk9iamVjdC5rZXlzKHNldHRpbmdzLnR5cGVTdWJ0eXBlcyA/PyB7fSldKTtcclxuICBmb3IgKGNvbnN0IHR5cGUgb2YgdHlwZXMpIHtcclxuICAgIGNvbnN0IHN0b3JlcyA9IFt0eXBlU3RvcmUocGx1Z2luLCB0eXBlKSwgLi4uZ2V0U3VidHlwZU5hbWVzKHNldHRpbmdzLCB0eXBlKS5tYXAoKHN1YnR5cGUpID0+IHN1YnR5cGVTdG9yZShwbHVnaW4sIHR5cGUsIHN1YnR5cGUpKV07XHJcblxyXG4gICAgLy8gRWluZSB2YXVsdC13ZWl0ZSBVbWJlbmVubnVuZyBzY2hsXHUwMEU0Z3QgYXVmIEpFREVOIEJsb2NrIGR1cmNoLCBpbiBkZW0gZGVyXHJcbiAgICAvLyBLZXkgc3RlaHQgLSBkZXJzZWxiZSBLZXkgZGFyZiBibG9ja1x1MDBGQ2JlcmdyZWlmZW5kIG1laHJmYWNoIHZvcmtvbW1lblxyXG4gICAgLy8gKHNpZWhlIEtvbW1lbnRhciBhbiB0eXBlU3VidHlwZXMgaW4gc3VidHlwZXMuanMpLiBOdXIgSU5ORVJIQUxCIGVpbmVzXHJcbiAgICAvLyBCbG9ja3Mga2FubiBkZXIgbmV1ZSBOYW1lIGtvbGxpZGllcmVuOyBkb3J0IGxlZ3QgcmVuYW1lSW5TdG9yZSBkaWVcclxuICAgIC8vIGJlaWRlbiB3aWUgYmlzaGVyIHp1c2FtbWVuLlxyXG4gICAgZm9yIChjb25zdCBzdG9yZSBvZiBzdG9yZXMpIHtcclxuICAgICAgaWYgKHJlbmFtZUluU3RvcmUoc3RvcmUsIG9sZEtleSwgbmV3S2V5KSkgY291bnQoc3RvcmUpO1xyXG4gICAgfVxyXG4gIH1cclxuICBjb25zdCBvcmRlckNoYW5nZWQgPSByZW5hbWVJbkdsb2JhbE9yZGVyKHNldHRpbmdzLCBvbGRLZXksIG5ld0tleSk7XHJcbiAgaWYgKHR5cGVDb3VudCA9PT0gMCAmJiBzdWJ0eXBlQ291bnQgPT09IDAgJiYgIW9yZGVyQ2hhbmdlZCkgcmV0dXJuO1xyXG5cclxuICBhd2FpdCBwbHVnaW4uc2F2ZVNldHRpbmdzKCk7XHJcbiAgcGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xyXG5cclxuICBjb25zdCBwYXJ0cyA9IFtdO1xyXG4gIGlmICh0eXBlQ291bnQgPiAwKSBwYXJ0cy5wdXNoKGAke3R5cGVDb3VudH0gVFlQJHt0eXBlQ291bnQgPT09IDEgPyBcIlwiIDogXCJlblwifWApO1xyXG4gIGlmIChzdWJ0eXBlQ291bnQgPiAwKSBwYXJ0cy5wdXNoKGAke3N1YnR5cGVDb3VudH0gU3VidHlwJHtzdWJ0eXBlQ291bnQgPT09IDEgPyBcIlwiIDogXCJlblwifWApO1xyXG4gIGlmIChvcmRlckNoYW5nZWQpIHBhcnRzLnB1c2goXCJnbG9iYWxlciBSZWloZW5mb2xnZVwiKTtcclxuICBuZXcgTm90aWNlKGBUWVAtU3lzdGVtOiBcdTIwMUUke29sZEtleX1cdTIwMUMgXHUyMTkyIFx1MjAxRSR7bmV3S2V5fVx1MjAxQyBpbiAke3BhcnRzLmpvaW4oXCIgdW5kIFwiKX0gdW1iZW5hbm50LmApO1xyXG59XHJcblxyXG4vLyBPYnNpZGlhbnMgXCJBbGwgcHJvcGVydGllc1wiLUFuc2ljaHQgKGFjY2VwdFJlbmFtZSkgdW5kIEJhc2VzIChOYW1lbnNmZWxkIGVpbmVyXHJcbi8vIG5ldSBhbmdlbGVndGVuIE5vdGl6LVByb3BlcnR5KSBiZW5lbm5lbiBQcm9wZXJ0aWVzIHZhdWx0LXdlaXQgYXVzc2NobGllXHUwMERGbGljaFxyXG4vLyBcdTAwRkNiZXIgYXBwLmZpbGVNYW5hZ2VyLnJlbmFtZVByb3BlcnR5KGFsdCwgbmV1KSB1bSAoc2llaGUgZ2ViYXV0ZXMgYXBwLmpzKSAtXHJcbi8vIGVpbiBXcmFwcGVyIGdlbmF1IGRvcnQgZXJmYXNzdCBhbHNvIGplZGUgZWNodGUgVW1iZW5lbm51bmcsIG9obmUgZGllXHJcbi8vIGpld2VpbGlnZW4gVmlld3Mgc2VsYnN0IGFuZmFzc2VuIHp1IG1cdTAwRkNzc2VuLiBCYXNlcycgXCJEaXNwbGF5IG5hbWVcIiBmXHUwMEZDclxyXG4vLyBiZXN0ZWhlbmRlIFByb3BlcnRpZXMgXHUwMEU0bmRlcnQgbnVyIGRpZSAuYmFzZS1EYXRlaSwgbmljaHQgZGllIE5vdGl6ZW4sIHVuZFxyXG4vLyBsXHUwMEU0dWZ0IGRlc2hhbGIgKHJpY2h0aWdlcndlaXNlKSBuaWNodCBoaWVyIGR1cmNoLlxyXG5mdW5jdGlvbiByZWdpc3RlclByb3BlcnR5UmVuYW1lU3luYyhwbHVnaW4pIHtcclxuICBjb25zdCBmaWxlTWFuYWdlciA9IHBsdWdpbi5hcHAuZmlsZU1hbmFnZXI7XHJcbiAgaWYgKGZpbGVNYW5hZ2VyLl9fZnJlZFR5cFJlbmFtZVN5bmNQYXRjaGVkKSByZXR1cm47XHJcbiAgZmlsZU1hbmFnZXIuX19mcmVkVHlwUmVuYW1lU3luY1BhdGNoZWQgPSB0cnVlO1xyXG5cclxuICBjb25zdCBvcmlnaW5hbCA9IGZpbGVNYW5hZ2VyLnJlbmFtZVByb3BlcnR5O1xyXG4gIGZpbGVNYW5hZ2VyLnJlbmFtZVByb3BlcnR5ID0gYXN5bmMgZnVuY3Rpb24gKG9sZEtleSwgbmV3S2V5LCAuLi5yZXN0KSB7XHJcbiAgICAvLyBXaXJmdCBkYXMgT3JpZ2luYWwgKGFjY2VwdFJlbmFtZSBmXHUwMEU0bmd0IGRhcyBzZWxic3QgYWIpLCBibGVpYmVuIGRpZVxyXG4gICAgLy8gUGx1Z2luLUVpbnN0ZWxsdW5nZW4gdW52ZXJcdTAwRTRuZGVydC5cclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IG9yaWdpbmFsLmNhbGwodGhpcywgb2xkS2V5LCBuZXdLZXksIC4uLnJlc3QpO1xyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgc3luY1JlbmFtZShwbHVnaW4sIG9sZEtleSwgbmV3S2V5KTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJUWVAtU3lzdGVtOiBQcm9wZXJ0eS1VbWJlbmVubnVuZyBuaWNodCBcdTAwRkNiZXJub21tZW5cIiwgZXJyb3IpO1xyXG4gICAgICBuZXcgTm90aWNlKGBUWVAtU3lzdGVtOiBVbWJlbmVubnVuZyB2b24gXHUyMDFFJHtvbGRLZXl9XHUyMDFDIG5pY2h0IFx1MDBGQ2Jlcm5vbW1lbiBcdTIwMTMgJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9O1xyXG5cclxuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4ge1xyXG4gICAgZmlsZU1hbmFnZXIucmVuYW1lUHJvcGVydHkgPSBvcmlnaW5hbDtcclxuICAgIGRlbGV0ZSBmaWxlTWFuYWdlci5fX2ZyZWRUeXBSZW5hbWVTeW5jUGF0Y2hlZDtcclxuICB9KTtcclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyUHJvcGVydHlSZW5hbWVTeW5jIH07XHJcbiIsICJjb25zdCB7IEZ1enp5U3VnZ2VzdE1vZGFsLCBOb3RpY2UsIHByZXBhcmVGdXp6eVNlYXJjaCB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBjb21wYXJlVHlwZXMsIERFRkFVTFRfU09SVF9PUkRFUiB9ID0gcmVxdWlyZShcIi4vdHlwLXZpZXdcIik7XG5jb25zdCB7IG5hbWVDb2xvciwgcGFpbnRDb2xvckRvdCB9ID0gcmVxdWlyZShcIi4vdHlwZS1jb2xvcnNcIik7XG5cbi8vIE5hdGl2ZXIgRXJzYXR6IGZcdTAwRkNyIFRlbXBsYXRlcnMgdHAuc3lzdGVtLnN1Z2dlc3RlciBiZWkgZGVyIFRZUC1BdXN3YWhsIChzaWVoZVxuLy8gX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qcyk6IGJhdXQgYXVmIE9ic2lkaWFucyBlaWdlbmVtXG4vLyBGdXp6eVN1Z2dlc3RNb2RhbCBhdWYgKGRpZXNlbGJlIEJhc2lzLCBhdWYgZGVyIGF1Y2ggVGVtcGxhdGVycyBTdWdnZXN0ZXJcbi8vIHNlbGJzdCBiZXJ1aHQpLCB6ZWlndCB6dXNcdTAwRTR0emxpY2ggYWJlciBUWVAtRmFyYmUvLVB1bmt0LCBCZXNjaHJlaWJ1bmcgdW5kXG4vLyBOb3Rpei1BbnphaGwgamUgWmVpbGUuIE5pY2h0IGVyZmFzc3RlIChpdGVtLnVucmVnaXN0ZXJlZCkgVFlQZW4gd2VyZGVuIHN0YXR0XG4vLyBpbiBpaHJlciAobmljaHQgZXhpc3RpZXJlbmRlbikgRmFyYmUgbXV0ZWQgZGFyZ2VzdGVsbHQsIGFuYWxvZyB6dXJcbi8vIFRZUC1MaXN0ZSBzZWxic3QgKHNpZWhlIC5mcmVkLXR5cC11bnJlZ2lzdGVyZWQgaW4gdHlwLXZpZXcuanMpLlxuY2xhc3MgVHlwUGlja2VyTW9kYWwgZXh0ZW5kcyBGdXp6eVN1Z2dlc3RNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKGFwcCwgcGx1Z2luLCBpdGVtcywgcmVzb2x2ZSkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gICAgdGhpcy5pdGVtcyA9IGl0ZW1zO1xuICAgIHRoaXMucmVzb2x2ZSA9IHJlc29sdmU7XG4gICAgdGhpcy5jaG9zZW4gPSBmYWxzZTtcbiAgICB0aGlzLnNldFBsYWNlaG9sZGVyKFwiRVNDIGZcdTAwRkNyIEFiYnJ1Y2hcIik7XG4gIH1cblxuICBnZXRJdGVtcygpIHtcbiAgICByZXR1cm4gdGhpcy5pdGVtcztcbiAgfVxuXG4gIC8vIEZ1enp5LVN1Y2hlIGdyZWlmdCBhdWNoIGF1ZiBkaWUgQmVzY2hyZWlidW5nLCBuaWNodCBudXIgYXVmIGRlbiBUWVAtTmFtZW4gLVxuICAvLyB1bmQgYXVmIGRpZSBTdWJ0eXBlbiwgd28gc2llIGluIGRlciBaZWlsZSBzdGVoZW4gKHNob3dTdWJ0eXBlcywgc2llaGVcbiAgLy8gdHlwZUl0ZW1zKTogc2llIHNpbmQgZGFubiBzaWNodGJhciwgYWxzbyBlcndhcnRldCBtYW4gYXVjaCwgc2llIHRpcHBlbiB6dVxuICAvLyBrXHUwMEY2bm5lbiwgdW5kIGltIHNlcGFyYXRlbiBBYmxhdWYgaXN0IGRlciBUWVAgZGFyXHUwMEZDYmVyIGRlciBXZWcgenUgaWhuZW4uXG4gIGdldEl0ZW1UZXh0KGl0ZW0pIHtcbiAgICByZXR1cm4gW2l0ZW0udHlwZSwgaXRlbS5zdWJ0eXBlcz8uam9pbihcIiBcIiksIGl0ZW0uZGVzY3JpcHRpb25dLmZpbHRlcihCb29sZWFuKS5qb2luKFwiIFwiKTtcbiAgfVxuXG4gIHJlbmRlclN1Z2dlc3Rpb24obWF0Y2gsIGVsKSB7XG4gICAgY29uc3QgaXRlbSA9IG1hdGNoLml0ZW07XG4gICAgZWwuYWRkQ2xhc3MoXCJmcmVkLXR5cC1waWNrZXItc3VnZ2VzdGlvblwiKTtcbiAgICBpZiAoaXRlbS51bnJlZ2lzdGVyZWQpIGVsLmFkZENsYXNzKFwiZnJlZC10eXAtcGlja2VyLXVucmVnaXN0ZXJlZFwiKTtcblxuICAgIGlmIChpdGVtLnVucmVnaXN0ZXJlZCkge1xuICAgICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1waWNrZXItbmFtZVwiLCB0ZXh0OiBpdGVtLnR5cGUgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucmVuZGVyQ29sb3JlZE5hbWUoZWwsIGl0ZW0udHlwZSwgaXRlbS50eXBlKTtcbiAgICB9XG5cbiAgICBpZiAoaXRlbS5zdWJ0eXBlcz8ubGVuZ3RoKSB0aGlzLnJlbmRlclN1YnR5cGVQcmV2aWV3KGVsLCBpdGVtKTtcblxuICAgIGlmIChpdGVtLmRlc2NyaXB0aW9uKSB7XG4gICAgICBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLXBpY2tlci1kZXNjXCIsIHRleHQ6IGl0ZW0uZGVzY3JpcHRpb24gfSk7XG4gICAgfVxuXG4gICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1waWNrZXItY291bnRcIiwgdGV4dDogU3RyaW5nKGl0ZW0uY291bnQpIH0pO1xuICB9XG5cbiAgLy8gTmFtZSBpbiBkZXIgRmFyYmUgdm9uIGNvbG9yVHlwZSAoYnp3LiBkZXMgU3VidHlwcywgc2llaGUgbmFtZUNvbG9yIGluXG4gIC8vIHR5cGUtY29sb3JzLmpzIC0gZGllc2VsYmUgR3J1bmRsYWdlIG51dHp0IGRpZSBTdWJ0eXAtVm9yc2NoYXUgZGVyIFRZUC1MaXN0ZSlcbiAgLy8gLSBqZSBuYWNoIEVpbnN0ZWxsdW5nIFwiVFlQIFZpZXcgZWluZlx1MDBFNHJiZW5cIiBhbHMgZWluZ2VmXHUwMEU0cmJ0ZXIgVGV4dCBvZGVyIG1pdFxuICAvLyB2b3Jhbmdlc3RlbGx0ZW0gRmFyYnB1bmt0LlxuICByZW5kZXJDb2xvcmVkTmFtZShlbCwgdGV4dCwgY29sb3JUeXBlLCBzdWJ0eXBlID0gbnVsbCkge1xuICAgIGNvbnN0IHsgY29sb3IsIGlzRGVmYXVsdCB9ID0gbmFtZUNvbG9yKHRoaXMucGx1Z2luLnNldHRpbmdzLCBjb2xvclR5cGUsIHN1YnR5cGUpO1xuICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3QpIHtcbiAgICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtcGlja2VyLW5hbWVcIiwgdGV4dCB9KS5zdHlsZS5jb2xvciA9IGNvbG9yO1xuICAgIH0gZWxzZSB7XG4gICAgICBwYWludENvbG9yRG90KGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtcGlja2VyLWRvdFwiIH0pLCBjb2xvciwgaXNEZWZhdWx0KTtcbiAgICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtcGlja2VyLW5hbWVcIiwgdGV4dCB9KTtcbiAgICB9XG4gIH1cblxuICAvLyBcIlRZUCAoU3VidHlwIDEsIFN1YnR5cCAyKVwiIC0gd2VsY2hlIFN1YnR5cGVuIHVudGVyIGRlbSBUWVAgbGllZ2VuLCBzY2hvblxuICAvLyBpbiBkZXIgVFlQLUF1c3dhaGwgZGVzIHNlcGFyYXRlbiBBYmxhdWZzIChzaWVoZSBwaWNrVHlwZUFuZFN1YnR5cGUpLCB3b1xuICAvLyBkZXIgU3VidHlwLVBpY2tlciBlcnN0IGRhbmFjaCBrb21tdC4gSmVkZXIgU3VidHlwIGluIHNlaW5lciBlaWdlbmVuIEZhcmJlLFxuICAvLyBLbGFtbWVybiB1bmQgS29tbWFzIG11dGVkOyBvaG5lIFwiVFlQIFZpZXcgZWluZlx1MDBFNHJiZW5cIiBibGVpYnQgZGllIFZvcnNjaGF1XG4gIC8vIHdpZSBkZXIgTmFtZSBzZWxic3QgdW5nZWZcdTAwRTRyYnQuXG4gIHJlbmRlclN1YnR5cGVQcmV2aWV3KGVsLCBpdGVtKSB7XG4gICAgY29uc3QgY29sb3JpemUgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3Q7XG4gICAgY29uc3Qgd3JhcCA9IGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtcGlja2VyLXN1YnR5cGVzXCIgfSk7XG4gICAgd3JhcC5hcHBlbmRUZXh0KFwiKFwiKTtcbiAgICBpdGVtLnN1YnR5cGVzLmZvckVhY2goKHN1YnR5cGUsIGluZGV4KSA9PiB7XG4gICAgICBpZiAoaW5kZXggPiAwKSB3cmFwLmFwcGVuZFRleHQoXCIsIFwiKTtcbiAgICAgIGNvbnN0IHNwYW4gPSB3cmFwLmNyZWF0ZVNwYW4oeyB0ZXh0OiBzdWJ0eXBlIH0pO1xuICAgICAgaWYgKGNvbG9yaXplKSBzcGFuLnN0eWxlLmNvbG9yID0gbmFtZUNvbG9yKHRoaXMucGx1Z2luLnNldHRpbmdzLCBpdGVtLnR5cGUsIHN1YnR5cGUpLmNvbG9yO1xuICAgIH0pO1xuICAgIHdyYXAuYXBwZW5kVGV4dChcIilcIik7XG4gIH1cblxuICAvLyBPYnNpZGlhbnMgU3VnZ2VzdE1vZGFsLnNlbGVjdFN1Z2dlc3Rpb24oKSBydWZ0IGludGVybiBlcnN0IHRoaXMuY2xvc2UoKVxuICAvLyBhdWYgdW5kIGRhbmFjaCBlcnN0IG9uQ2hvb3NlU3VnZ2VzdGlvbigpL29uQ2hvb3NlSXRlbSgpIC0gXCJjaG9zZW5cIiBoaWVyIHp1XG4gIC8vIHNldHplbiAoc3RhdHQgaW4gb25DaG9vc2VJdGVtKSBpc3QgZGFoZXIgbmljaHQgYmxvXHUwMERGIEdlc2NobWFja3NzYWNoZTogd1x1MDBGQ3JkZVxuICAvLyBlcyBlcnN0IGluIG9uQ2hvb3NlSXRlbSBnZXNldHp0LCBoXHUwMEU0dHRlIGRhcyBjbG9zZSgpLWF1c2dlbFx1MDBGNnN0ZSBvbkNsb3NlKClcbiAgLy8gdW50ZW4gXCJjaG9zZW5cIiBub2NoIGFscyBmYWxzZSBnZXNlaGVuIHVuZCBkYXMgUHJvbWlzZSBmXHUwMEU0bHNjaGxpY2ggc2Nob24gbWl0XG4gIC8vIG51bGwgYXVmZ2VsXHUwMEY2c3QsIGJldm9yIGRlciBlaWdlbnRsaWNoZSBvbkNob29zZUl0ZW0tQXVmcnVmIFx1MDBGQ2JlcmhhdXB0IGxpZWYgLVxuICAvLyBkYXMgendlaXRlIHJlc29sdmUoKSBncmVpZnQgZGFubiBuaWNodCBtZWhyIChlaW4gUHJvbWlzZSBsXHUwMEY2c3QgbnVyIGVpbm1hbFxuICAvLyBhdWYpLCBkYXMgRXJnZWJuaXMgd2FyIHVuYWJoXHUwMEU0bmdpZyB2b24gZGVyIEF1c3dhaGwgaW1tZXIgbnVsbC5cbiAgc2VsZWN0U3VnZ2VzdGlvbihpdGVtLCBldnQpIHtcbiAgICB0aGlzLmNob3NlbiA9IHRydWU7XG4gICAgLy8gV2FzIGJlaSBkZXIgQXVzd2FobCBpbSBTdWNoZmVsZCBzdGFuZCAtIGRlciBTdWJ0eXAtUGlja2VyIHNvcnRpZXJ0IGRhbmFjaFxuICAgIC8vIHZvciAoc2llaGUgcGlja1R5cGVFbnRyeS9zb3J0QnlRdWVyeSkuXG4gICAgdGhpcy5xdWVyeSA9IHRoaXMuaW5wdXRFbC52YWx1ZS50cmltKCk7XG4gICAgc3VwZXIuc2VsZWN0U3VnZ2VzdGlvbihpdGVtLCBldnQpO1xuICB9XG5cbiAgb25DaG9vc2VJdGVtKGl0ZW0pIHtcbiAgICB0aGlzLnJlc29sdmUoaXRlbS50eXBlKTtcbiAgfVxuXG4gIC8vIEVTQyAob2RlciBLbGljayBkYW5lYmVuKSBzY2hsaWVcdTAwREZ0IGRhcyBNb2RhbCBvaG5lIHNlbGVjdFN1Z2dlc3Rpb24gLSBkYW5uXG4gIC8vIHN0YXR0IGVpbmVzIGhcdTAwRTRuZ2VuZGVuIFByb21pc2UgbWl0IG51bGwgYXVmbFx1MDBGNnNlbiwgYW5hbG9nIHp1XG4gIC8vIHRwLnN5c3RlbS5zdWdnZXN0ZXIuXG4gIG9uQ2xvc2UoKSB7XG4gICAgc3VwZXIub25DbG9zZSgpO1xuICAgIGlmICghdGhpcy5jaG9zZW4pIHRoaXMucmVzb2x2ZShudWxsKTtcbiAgfVxufVxuXG4vLyBBdXN3YWhsIGVpbmVzIFN1YnR5cHMgZlx1MDBGQ3IgZWluZW4gYmVyZWl0cyBnZXdcdTAwRTRobHRlbiBUWVAgKHNpZWhlIHBpY2tTdWJ0eXBlKS5cbi8vIFdpZSBUeXBQaWNrZXJNb2RhbCwgenVzXHUwMEU0dHpsaWNoIG1pdCBkZW0gRWludHJhZyBcIlRZUCAob2huZSBTdWJ0eXApXCIgYW5cbi8vIGVyc3RlciBTdGVsbGUgKGl0ZW0ubm9uZSkuIEVTQyBsXHUwMEY2c3QgbWl0IG51bGwgYXVmIC0gVFlQLmpzIGtlaHJ0IGRhbm4genVyXG4vLyBUWVAtQXVzd2FobCB6dXJcdTAwRkNjay4gU3VidHlwZW4gaGFiZW4ga2VpbmUgQmVzY2hyZWlidW5nLCBkZXIgTmFtZSBzdGVodCBpblxuLy8gZGVyIEZhcmJlIGRlcyBTdWJ0eXBzIChiencuIGRlcyBUWVBzKSBtaXQgTm90aXotQW56YWhsLiBxdWVyeSBpc3QgZGllXG4vLyBTdWNoYW5mcmFnZSBhdXMgZGVtIFRZUC1QaWNrZXIsIG5hY2ggZGVyIGRpZSBMaXN0ZSB2b3Jzb3J0aWVydCBzdGVodC5cbmNsYXNzIFN1YnR5cFBpY2tlck1vZGFsIGV4dGVuZHMgVHlwUGlja2VyTW9kYWwge1xuICBjb25zdHJ1Y3RvcihhcHAsIHBsdWdpbiwgdHlwZSwgaXRlbXMsIHJlc29sdmUsIHF1ZXJ5ID0gXCJcIikge1xuICAgIHN1cGVyKGFwcCwgcGx1Z2luLCBpdGVtcywgcmVzb2x2ZSk7XG4gICAgdGhpcy50eXBlID0gdHlwZTtcbiAgICB0aGlzLnNldFBsYWNlaG9sZGVyKGBTdWJ0eXAgZlx1MDBGQ3IgJHt0eXBlfSBcdTIwMTMgRVNDIGZcdTAwRkNyIHp1clx1MDBGQ2NrYCk7XG4gICAgdGhpcy5pdGVtcyA9IHNvcnRCeVF1ZXJ5KGl0ZW1zLCBxdWVyeSwgKGl0ZW0pID0+IHRoaXMuZ2V0SXRlbVRleHQoaXRlbSkpO1xuICB9XG5cbiAgLy8gRGllIFwib2huZSBTdWJ0eXBcIi1aZWlsZSBpc3QgYXVjaCBcdTAwRkNiZXIgZGVuIFRZUC1OYW1lbiB6dSBmaW5kZW4sIGRlbiBzaWVcbiAgLy8gemVpZ3QgLSBlaW4gaW0gVFlQLVBpY2tlciBnZXRpcHB0ZXMgXCJPUkdBXCIgaG9sdCBzaWUgZGFtaXQgdm9uIGFsbGVpblxuICAvLyB3aWVkZXIgYW4gZGVuIEFuZmFuZywgb2J3b2hsIGRvcnQgZGVyIFRZUCB1bmQgbmljaHQgZWluIFN1YnR5cCBnZW1laW50IHdhci5cbiAgZ2V0SXRlbVRleHQoaXRlbSkge1xuICAgIHJldHVybiBpdGVtLm5vbmUgPyBgJHt0aGlzLnR5cGV9ICR7aXRlbS50eXBlfWAgOiBzdXBlci5nZXRJdGVtVGV4dChpdGVtKTtcbiAgfVxuXG4gIHJlbmRlclN1Z2dlc3Rpb24obWF0Y2gsIGVsKSB7XG4gICAgY29uc3QgaXRlbSA9IG1hdGNoLml0ZW07XG4gICAgZWwuYWRkQ2xhc3MoXCJmcmVkLXR5cC1waWNrZXItc3VnZ2VzdGlvblwiKTtcbiAgICBpZiAoaXRlbS5ub25lKSB7XG4gICAgICAvLyBcIk9SR0EgKG9obmUgU3VidHlwKVwiOiBkZXIgVFlQIHNlbGJzdCBpbiBzZWluZXIgRmFyYmUgKGJ6dy4gbWl0XG4gICAgICAvLyBGYXJicHVua3QpLCBkZXIgWnVzYXR6IGluIG5vcm1hbGVyIFRleHRmYXJiZSBzdGF0dCBtdXRlZCAtIGRpZSBaZWlsZVxuICAgICAgLy8gaXN0IGRpZSBXYWhsIFwiZGllc2VyIFRZUCwgb2huZSBTdWJ0eXBcIiB1bmQga2VpbmUgYXVzZ2VncmF1dGVcbiAgICAgIC8vIE5pY2h0LVdhaGwsIHVuZCBkZXIgaGVsbGUgWnVzYXR6IGhlYnQgc2llIHp1Z2xlaWNoIHZvbiBkZW5cbiAgICAgIC8vIFN1YnR5cC1aZWlsZW4gZGFydW50ZXIgYWIsIGRpZSBudXIgYXVzIGlocmVtIE5hbWVuIGJlc3RlaGVuLlxuICAgICAgdGhpcy5yZW5kZXJDb2xvcmVkTmFtZShlbCwgdGhpcy50eXBlLCB0aGlzLnR5cGUpO1xuICAgICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1waWNrZXItbm9uZVwiLCB0ZXh0OiBgKCR7aXRlbS50eXBlfSlgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnJlbmRlckNvbG9yZWROYW1lKGVsLCBpdGVtLnR5cGUsIHRoaXMudHlwZSwgaXRlbS50eXBlKTtcbiAgICB9XG4gICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1waWNrZXItY291bnRcIiwgdGV4dDogU3RyaW5nKGl0ZW0uY291bnQpIH0pO1xuICB9XG5cbiAgb25DaG9vc2VJdGVtKGl0ZW0pIHtcbiAgICB0aGlzLnJlc29sdmUoaXRlbS5ub25lID8gXCJcIiA6IGl0ZW0udHlwZSk7XG4gIH1cbn1cblxuLy8gVFlQLVBpY2tlciBtaXQgZGVuIFN1YnR5cGVuIGRpcmVrdCBlaW5nZXJcdTAwRkNja3QgdW50ZXIgaWhyZW0gVFlQIChTdGFuZGFyZCxcbi8vIHNvbGFuZ2UgXCJTdWJ0eXAtUGlja2VyIHNlcGFyYXRcIiBpbiBkZW4gRWluc3RlbGx1bmdlbiBhdXMgaXN0LCBzaWVoZVxuLy8gcGlja1R5cGVBbmRTdWJ0eXBlKS4gRGllIFRZUC1aZWlsZSBzZWxic3Qgc3RlaHQgZlx1MDBGQ3IgXCJUWVAgb2huZSBTdWJ0eXBcIi5cbi8vIEdlc3VjaHQgd2lyZCBncnVwcGVud2Vpc2Ugc3RhdHQgamUgWmVpbGUsIGRhbWl0IGVpbiBTdWJ0eXAgbmllIG9obmUgc2VpbmVuXG4vLyBUWVAgZGFyXHUwMEZDYmVyIGVyc2NoZWludDogcGFzc3QgZGllIFN1Y2hlIGF1ZiBkZW4gVFlQLCBibGVpYmVuIGFsbGUgc2VpbmVcbi8vIFN1YnR5cGVuIHN0ZWhlbjsgcGFzc3Qgc2llIG51ciBhdWYgZWluemVsbmUgU3VidHlwZW4sIGJsZWliZW4gZGllc2Ugc2FtdFxuLy8gaWhyZW0gVFlQIHN0ZWhlbi4gRGllIEdydXBwZW4gc29ydGllcmVuIHNpY2ggbmFjaCBpaHJlbSBiZXN0ZW4gVHJlZmZlcixcbi8vIGlubmVyaGFsYiBlaW5lciBHcnVwcGUgYmxlaWJ0IGRpZSBCbG9jay1SZWloZW5mb2xnZS5cbmNsYXNzIFR5cFN1YnR5cFBpY2tlck1vZGFsIGV4dGVuZHMgVHlwUGlja2VyTW9kYWwge1xuICBjb25zdHJ1Y3RvcihhcHAsIHBsdWdpbiwgZ3JvdXBzLCByZXNvbHZlKSB7XG4gICAgc3VwZXIoYXBwLCBwbHVnaW4sIGdyb3Vwcy5tYXAoKGdyb3VwKSA9PiBncm91cC5pdGVtKSwgcmVzb2x2ZSk7XG4gICAgdGhpcy5ncm91cHMgPSBncm91cHM7XG4gIH1cblxuICBnZXRTdWdnZXN0aW9ucyhxdWVyeSkge1xuICAgIGNvbnN0IHNlYXJjaCA9IHF1ZXJ5LnRyaW0oKSA/IHByZXBhcmVGdXp6eVNlYXJjaChxdWVyeS50cmltKCkpIDogbnVsbDtcbiAgICBjb25zdCBub01hdGNoID0geyBzY29yZTogMCwgbWF0Y2hlczogW10gfTtcbiAgICBjb25zdCByZXN1bHRzID0gW107XG4gICAgZm9yIChjb25zdCB7IGl0ZW0sIHN1YnR5cGVzIH0gb2YgdGhpcy5ncm91cHMpIHtcbiAgICAgIGNvbnN0IHR5cGVNYXRjaCA9IHNlYXJjaCA/IHNlYXJjaCh0aGlzLmdldEl0ZW1UZXh0KGl0ZW0pKSA6IG5vTWF0Y2g7XG4gICAgICBsZXQgc3VidHlwZU1hdGNoZXMgPSBzdWJ0eXBlcy5tYXAoKHN1YnR5cGUpID0+ICh7IGl0ZW06IHN1YnR5cGUsIG1hdGNoOiBzZWFyY2ggPyBzZWFyY2goc3VidHlwZS5zdWJ0eXBlKSA6IG5vTWF0Y2ggfSkpO1xuICAgICAgaWYgKCF0eXBlTWF0Y2gpIHN1YnR5cGVNYXRjaGVzID0gc3VidHlwZU1hdGNoZXMuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkubWF0Y2gpO1xuICAgICAgaWYgKCF0eXBlTWF0Y2ggJiYgc3VidHlwZU1hdGNoZXMubGVuZ3RoID09PSAwKSBjb250aW51ZTtcblxuICAgICAgY29uc3Qgc2NvcmVzID0gW3R5cGVNYXRjaCwgLi4uc3VidHlwZU1hdGNoZXMubWFwKChlbnRyeSkgPT4gZW50cnkubWF0Y2gpXS5maWx0ZXIoQm9vbGVhbikubWFwKChtYXRjaCkgPT4gbWF0Y2guc2NvcmUpO1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc2NvcmU6IE1hdGgubWF4KC4uLnNjb3JlcyksXG4gICAgICAgIHJvd3M6IFt7IGl0ZW0sIG1hdGNoOiB0eXBlTWF0Y2ggPz8gbm9NYXRjaCB9LCAuLi5zdWJ0eXBlTWF0Y2hlcy5tYXAoKGVudHJ5KSA9PiAoeyBpdGVtOiBlbnRyeS5pdGVtLCBtYXRjaDogZW50cnkubWF0Y2ggPz8gbm9NYXRjaCB9KSldLFxuICAgICAgfSk7XG4gICAgfVxuICAgIGlmIChzZWFyY2gpIHJlc3VsdHMuc29ydCgoYSwgYikgPT4gYi5zY29yZSAtIGEuc2NvcmUpO1xuICAgIHJldHVybiByZXN1bHRzLmZsYXRNYXAoKGdyb3VwKSA9PiBncm91cC5yb3dzKTtcbiAgfVxuXG4gIHJlbmRlclN1Z2dlc3Rpb24obWF0Y2gsIGVsKSB7XG4gICAgY29uc3QgaXRlbSA9IG1hdGNoLml0ZW07XG4gICAgaWYgKCFpdGVtLnN1YnR5cGUpIHtcbiAgICAgIHN1cGVyLnJlbmRlclN1Z2dlc3Rpb24obWF0Y2gsIGVsKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZWwuYWRkQ2xhc3MoXCJmcmVkLXR5cC1waWNrZXItc3VnZ2VzdGlvblwiLCBcImZyZWQtdHlwLXBpY2tlci1zdWJ0eXBlXCIpO1xuICAgIHRoaXMucmVuZGVyQ29sb3JlZE5hbWUoZWwsIGl0ZW0uc3VidHlwZSwgaXRlbS50eXBlLCBpdGVtLnN1YnR5cGUpO1xuICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtcGlja2VyLWNvdW50XCIsIHRleHQ6IFN0cmluZyhpdGVtLmNvdW50KSB9KTtcbiAgfVxuXG4gIG9uQ2hvb3NlSXRlbShpdGVtKSB7XG4gICAgdGhpcy5yZXNvbHZlKHsgdHlwZTogaXRlbS50eXBlLCBzdWJ0eXBlOiBpdGVtLnN1YnR5cGUgPz8gbnVsbCB9KTtcbiAgfVxufVxuXG4vLyBBdXNnYW5ncy1SZWloZW5mb2xnZSBlaW5lciBQaWNrZXItTGlzdGUgbmFjaCBlaW5lciBzY2hvbiBnZXRpcHB0ZW4gU3VjaGFuZnJhZ2Vcbi8vIChkZXIgYXVzIGRlbSBUWVAtUGlja2VyLCBzaWVoZSBwaWNrVHlwZUVudHJ5KTogd29yYXVmIHNpZSBwYXNzdCwgc3RlaHQgb2Jlbixcbi8vIG5hY2ggVHJlZmZlcmdcdTAwRkN0ZSwgYWxsZXMgYW5kZXJlIGRhaGludGVyIGluIHVudmVyXHUwMEU0bmRlcnRlciBSZWloZW5mb2xnZS4gXCJQYXNzdFxuLy8gYXVmIG5pY2h0c1wiIGxcdTAwRTRzc3QgZGllIExpc3RlLCB3aWUgc2llIHdhciAtIGdldGlwcHQgd2FyIGRhbm4gei4gQi4gZWluZVxuLy8gQmVzY2hyZWlidW5nLCBcdTAwRkNiZXIgZGllIGhpZXIgbmljaHRzIHp1IHNjaGxpZVx1MDBERmVuIGlzdC4gRGFuYWNoIGdyZWlmdCB3aWVkZXJcbi8vIE9ic2lkaWFucyBlaWdlbmUgU3VjaGUsIHNvYmFsZCBpbSBQaWNrZXIgc2VsYnN0IGdldGlwcHQgd2lyZC5cbmZ1bmN0aW9uIHNvcnRCeVF1ZXJ5KGl0ZW1zLCBxdWVyeSwgaXRlbVRleHQpIHtcbiAgY29uc3Qgc2VhcmNoID0gcXVlcnk/LnRyaW0oKSA/IHByZXBhcmVGdXp6eVNlYXJjaChxdWVyeS50cmltKCkpIDogbnVsbDtcbiAgaWYgKCFzZWFyY2gpIHJldHVybiBpdGVtcztcbiAgY29uc3Qgc2NvcmVkID0gaXRlbXMubWFwKChpdGVtLCBpbmRleCkgPT4gKHsgaXRlbSwgaW5kZXgsIHNjb3JlOiBzZWFyY2goaXRlbVRleHQoaXRlbSkpPy5zY29yZSA/PyBudWxsIH0pKTtcbiAgaWYgKHNjb3JlZC5ldmVyeSgoZW50cnkpID0+IGVudHJ5LnNjb3JlID09PSBudWxsKSkgcmV0dXJuIGl0ZW1zO1xuICBzY29yZWQuc29ydCgoYSwgYikgPT4ge1xuICAgIGlmIChhLnNjb3JlID09PSBudWxsIHx8IGIuc2NvcmUgPT09IG51bGwpIHJldHVybiBhLnNjb3JlID09PSBiLnNjb3JlID8gYS5pbmRleCAtIGIuaW5kZXggOiBhLnNjb3JlID09PSBudWxsID8gMSA6IC0xO1xuICAgIHJldHVybiBiLnNjb3JlIC0gYS5zY29yZSB8fCBhLmluZGV4IC0gYi5pbmRleDtcbiAgfSk7XG4gIHJldHVybiBzY29yZWQubWFwKChlbnRyeSkgPT4gZW50cnkuaXRlbSk7XG59XG5cbi8vIEZcdTAwRkNyIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanM6IFx1MDBGNmZmbmV0IGRlbiBTdWJ0eXAtUGlja2VyLCBzb2JhbGRcbi8vIGRlciBUWVAgbWluZGVzdGVucyBlaW5lbiByZWdpc3RyaWVydGVuIFN1YnR5cCBoYXQgKGluIGRlciBSZWloZW5mb2xnZSBkZXJcbi8vIEJsXHUwMEY2Y2tlIGluIGRlciBUWVAtRGV0YWlsYW5zaWNodCkuIHF1ZXJ5IGlzdCBkaWUgU3VjaGFuZnJhZ2UgYXVzIGRlbVxuLy8gVFlQLVBpY2tlciwgbmFjaCBkZXIgZGllIExpc3RlIHZvcnNvcnRpZXJ0IHdpcmQgKHNpZWhlIHNvcnRCeVF1ZXJ5KTogd2VyXG4vLyBkb3J0IFwiTGVocnZlcmFuc3RhbHR1bmdcIiB0aXBwdGUgdW5kIHNvIHp1IE9SR0Ega2FtLCBtZWludGUgZGllc2VuIFN1YnR5cCB1bmRcbi8vIGZpbmRldCBpaG4gaGllciBvYmVuIC0gRW50ZXIgZ2VuXHUwMEZDZ3QuIG9wdGlvbnMgd2llIGJlaSBnZXRTdWJ0eXBlczogU3VidHlwZW5cbi8vIG1pdCBhYmdlc2NoYWx0ZXRlbSBcIk1hbnVlbGwgZXJzdGVsbGJhclwiIHNpbmQgc3RhbmRhcmRtXHUwMEU0XHUwMERGaWcgYXVzZ2VrbGFtbWVydCxcbi8vIGdlbmF1IHdpZSBkaWUgc28gYWJnZXNjaGFsdGV0ZW4gVFlQZW4gaW4gZGVyIFRZUC1BdXN3YWhsIGRhdm9yLiBMXHUwMEY2c3QgYXVmIG1pdFxuLy8gIC0gZGVtIGdld1x1MDBFNGhsdGVuIFN1YnR5cCxcbi8vICAtIFwiXCIgZlx1MDBGQ3IgXCJvaG5lIFN1YnR5cFwiIChvaG5lIEFuZnJhZ2UgZGVyIGVyc3RlIEVpbnRyYWcgZGVyIExpc3RlKSAtIGJ6dy5cbi8vICAgIHNvZm9ydCwgb2huZSBQaWNrZXIsIHdlbm4gZGVyIFRZUCBnYXIga2VpbmVuIGF1c3dcdTAwRTRobGJhcmVuIFN1YnR5cCBoYXQsXG4vLyAgLSBudWxsIGJlaSBFU0MgKFRZUC5qcyBrZWhydCBkYW5uIHp1ciBUWVAtQXVzd2FobCB6dXJcdTAwRkNjaykuXG5mdW5jdGlvbiBwaWNrU3VidHlwZShhcHAsIHBsdWdpbiwgdHlwZSwgcXVlcnkgPSBcIlwiLCBvcHRpb25zID0ge30pIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgY29uc3QgaXRlbXMgPSBwbHVnaW4uZ2V0U3VidHlwZXModHlwZSwgb3B0aW9ucykubWFwKCh7IHN1YnR5cGUsIGNvdW50IH0pID0+ICh7IHR5cGU6IHN1YnR5cGUsIGRlc2NyaXB0aW9uOiBcIlwiLCBjb3VudCB9KSk7XG4gICAgaWYgKGl0ZW1zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmVzb2x2ZShcIlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgLy8gXCJvaG5lIFN1YnR5cFwiIGFuIGVyc3RlciBTdGVsbGU6IGRpZSBBdXN3YWhsIGlzdCBvaG5lIFRpcHBlbiBtaXQgRW50ZXJcbiAgICAvLyBlcmxlZGlndCwgdW5kIGRlciBGYWxsIGlzdCBoXHUwMEU0dWZpZ2VyIGFscyBqZWRlciBlaW56ZWxuZSBTdWJ0eXAuXG4gICAgY29uc3Qgbm9uZUNvdW50ID0gcGx1Z2luLnR5cEluZGV4LnN1YnR5cGVCdWNrZXQodHlwZSkubm9TdWJ0eXBlO1xuICAgIGl0ZW1zLnVuc2hpZnQoeyB0eXBlOiBcIm9obmUgU3VidHlwXCIsIGRlc2NyaXB0aW9uOiBcIlwiLCBjb3VudDogbm9uZUNvdW50LCBub25lOiB0cnVlIH0pO1xuICAgIG5ldyBTdWJ0eXBQaWNrZXJNb2RhbChhcHAsIHBsdWdpbiwgdHlwZSwgaXRlbXMsIHJlc29sdmUsIHF1ZXJ5KS5vcGVuKCk7XG4gIH0pO1xufVxuXG4vLyBOaWNodCBpbiBwbHVnaW4uc2V0dGluZ3MudHlwZXMgcmVnaXN0cmllcnRlIFRZUGVuLCBkaWUgYWJlciB0YXRzXHUwMEU0Y2hsaWNoIGluXG4vLyBOb3RpemVuIHZvcmtvbW1lbiAtIGFuYWxvZyB6dSBkZW4gXCJ1bnJlZ2lzdHJpZXJ0ZW5cIiBaZWlsZW4gZGVyIFRZUC1MaXN0ZVxuLy8gKHNpZWhlIHVucmVnaXN0ZXJlZFJvd3MgaW4gdHlwLXZpZXcuanMpLiBLZWluZSBCZXNjaHJlaWJ1bmcvRmFyYmUsIGRhIGZcdTAwRkNyXG4vLyBzaWUgbmljaHRzIGRlcmdsZWljaGVuIGdlcGZsZWd0IGlzdC4gTGlzdGVuIHVuZCBXZXJ0ZSBtaXQgUmFuZGxlZXJ6ZWljaGVuXG4vLyAoc2llaGUgaXNDbGVhbktleSBpbiB0eXAtaW5kZXguanMpIGJsZWliZW4gYXVcdTAwREZlbiB2b3IgLSBkZXIgZ2V3XHUwMEU0aGx0ZSBXZXJ0XG4vLyB3aXJkIGluIGVpbmUgbmV1ZSBOb3RpeiBnZXNjaHJpZWJlbiB1bmQgc29sbCBkb3J0IGtlaW4gQXVmclx1MDBFNHVtZmFsbCBzZWluLlxuZnVuY3Rpb24gdW5yZWdpc3RlcmVkSXRlbXMoYXBwLCBwbHVnaW4pIHtcbiAgY29uc3QgcmVnaXN0ZXJlZCA9IG5ldyBTZXQocGx1Z2luLnNldHRpbmdzLnR5cGVzKTtcbiAgY29uc3QgeyBjb3VudHMgfSA9IHBsdWdpbi50eXBJbmRleC50eXBlQ291bnRzKCk7XG4gIGNvbnN0IHNvcnRPcmRlciA9IHBsdWdpbi5zZXR0aW5ncy50eXBTb3J0T3JkZXIgPz8gREVGQVVMVF9TT1JUX09SREVSO1xuICByZXR1cm4gWy4uLmNvdW50cy5rZXlzKCldXG4gICAgLmZpbHRlcigodHlwZSkgPT4gIXJlZ2lzdGVyZWQuaGFzKHR5cGUpICYmIHBsdWdpbi50eXBJbmRleC5pc0NsZWFuS2V5KHR5cGUpKVxuICAgIC5zb3J0KChhLCBiKSA9PiBjb21wYXJlVHlwZXMoc29ydE9yZGVyLCBhLCBiLCBjb3VudHMsIHBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzKSlcbiAgICAubWFwKCh0eXBlKSA9PiAoeyB0eXBlLCBkZXNjcmlwdGlvbjogXCJcIiwgY291bnQ6IGNvdW50cy5nZXQodHlwZSkgPz8gMCwgdW5yZWdpc3RlcmVkOiB0cnVlIH0pKTtcbn1cblxuLy8gRlx1MDBGQ3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qcyBzb3dpZSBcdTAwRkNiZXJhbGwgc29uc3QgaW0gUGx1Z2luLCB3b1xuLy8gZWluIGVpbnplbG5lciBUWVAgYXVzZ2V3XHUwMEU0aGx0IHdlcmRlbiBtdXNzLiBpbmNsdWRlTWFudWFsT2ZmIHdpZSBiZWlcbi8vIHBsdWdpbi5nZXRUeXBlcygpOiBUWVBlbiBtaXQgYWJnZXNjaGFsdGV0ZW0gXCJNYW51ZWxsIGVyc3RlbGxiYXJcIiBzaW5kXG4vLyBzdGFuZGFyZG1cdTAwRTRcdTAwREZpZyBhdXNnZWtsYW1tZXJ0LiBpbmNsdWRlVW5yZWdpc3RlcmVkIGVyZ1x1MDBFNG56dCB6dXNcdTAwRTR0emxpY2ggVFlQZW4sXG4vLyBkaWUgaW4gTm90aXplbiB2b3Jrb21tZW4sIGFiZXIgbmljaHQgaW4gZGVyIFRZUC1MaXN0ZSByZWdpc3RyaWVydCBzaW5kIC1cbi8vIG11dGVkIGRhcmdlc3RlbGx0LCBkYSBmXHUwMEZDciBzaWUga2VpbmUgRmFyYmUvQmVzY2hyZWlidW5nIGV4aXN0aWVydC4gTFx1MDBGNnN0IG1pdFxuLy8gZGVtIGdld1x1MDBFNGhsdGVuIFRZUCBhdWYsIG9kZXIgbWl0IG51bGwgYmVpIEFiYnJ1Y2ggYnp3LiBmYWxscyBlcyAoYXVjaCBtaXRcbi8vIGRlbiBnZXdcdTAwRTRobHRlbiBPcHRpb25lbikga2VpbmUgYW56dXplaWdlbmRlbiBUWVBlbiBnaWJ0LiBzaG93U3VidHlwZXMgc3RlbGx0XG4vLyBkaWUgU3VidHlwZW4gZGVzIFRZUHMgaGludGVyIGRlc3NlbiBOYW1lbiAoc2llaGUgcmVuZGVyU3VidHlwZVByZXZpZXcpIC1cbi8vIGdlZGFjaHQgZlx1MDBGQ3IgZGllIFRZUC1BdXN3YWhsIGRlcyBzZXBhcmF0ZW4gQWJsYXVmcywgd28gZGVyIFN1YnR5cC1QaWNrZXJcbi8vIGVyc3QgZGFuYWNoIGtvbW10LlxuZnVuY3Rpb24gcGlja1R5cGUoYXBwLCBwbHVnaW4sIG9wdGlvbnMgPSB7fSkge1xuICByZXR1cm4gcGlja1R5cGVFbnRyeShhcHAsIHBsdWdpbiwgb3B0aW9ucykudGhlbigoZW50cnkpID0+IGVudHJ5Py50eXBlID8/IG51bGwpO1xufVxuXG4vLyBXaWUgcGlja1R5cGUsIGxcdTAwRjZzdCBhYmVyIG1pdCB7IHR5cGUsIHF1ZXJ5IH0gYXVmIC0gcXVlcnkgaXN0LCB3YXMgYmVpIGRlclxuLy8gQXVzd2FobCBpbSBTdWNoZmVsZCBzdGFuZC4gTnVyIGZcdTAwRkNyIHBpY2tUeXBlQW5kU3VidHlwZTogZG9ydCB0clx1MDBFNGd0IGRpZVxuLy8gQW5mcmFnZSBpbiBkZW4gU3VidHlwLVBpY2tlciB3ZWl0ZXIgKHNpZWhlIHNvcnRCeVF1ZXJ5KSwgZGVubiB3ZXJcbi8vIFwiTGVocnZlcmFuc3RhbHR1bmdcIiB0aXBwdCwgbGFuZGV0IFx1MDBGQ2JlciBkaWUgU3VidHlwLVZvcnNjaGF1IGJlaSBPUkdBIHVuZFxuLy8gbWVpbnQgZGFtaXQgZGVuIFN1YnR5cCwgbmljaHQgYmxvXHUwMERGIGRlbiBUWVAuXG5mdW5jdGlvbiBwaWNrVHlwZUVudHJ5KGFwcCwgcGx1Z2luLCBvcHRpb25zID0ge30pIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgY29uc3QgaXRlbXMgPSB0eXBlSXRlbXMoYXBwLCBwbHVnaW4sIG9wdGlvbnMpO1xuICAgIGlmICghaXRlbXMpIHtcbiAgICAgIHJlc29sdmUobnVsbCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IG1vZGFsID0gbmV3IFR5cFBpY2tlck1vZGFsKGFwcCwgcGx1Z2luLCBpdGVtcywgKHR5cGUpID0+IHJlc29sdmUodHlwZSA9PT0gbnVsbCA/IG51bGwgOiB7IHR5cGUsIHF1ZXJ5OiBtb2RhbC5xdWVyeSB9KSk7XG4gICAgbW9kYWwub3BlbigpO1xuICB9KTtcbn1cblxuLy8gR2VtZWluc2FtZSBUWVAtTGlzdGUgZlx1MDBGQ3IgcGlja1R5cGUvcGlja1R5cGVBbmRTdWJ0eXBlIC0gbnVsbCBzYW10IE5vdGljZSxcbi8vIGZhbGxzIGVzIChhdWNoIG1pdCBkZW4gZ2V3XHUwMEU0aGx0ZW4gT3B0aW9uZW4pIGtlaW5lIFRZUGVuIGdpYnQuXG5mdW5jdGlvbiB0eXBlSXRlbXMoYXBwLCBwbHVnaW4sIHsgaW5jbHVkZU1hbnVhbE9mZiA9IGZhbHNlLCBpbmNsdWRlVW5yZWdpc3RlcmVkID0gZmFsc2UsIHNob3dTdWJ0eXBlcyA9IGZhbHNlIH0gPSB7fSkge1xuICBjb25zdCBpdGVtcyA9IHBsdWdpbi5nZXRUeXBlcyh7IGluY2x1ZGVNYW51YWxPZmYgfSkubWFwKChpdGVtKSA9PiAoeyAuLi5pdGVtLCB1bnJlZ2lzdGVyZWQ6IGZhbHNlIH0pKTtcbiAgaWYgKGluY2x1ZGVVbnJlZ2lzdGVyZWQpIGl0ZW1zLnB1c2goLi4udW5yZWdpc3RlcmVkSXRlbXMoYXBwLCBwbHVnaW4pKTtcbiAgLy8gTnVyIHJlZ2lzdHJpZXJ0ZSBUWVBlbiBoYWJlbiBnZXBmbGVndGUgU3VidHlwZW4gLSBmXHUwMEZDciBkaWUgXHUwMEZDYnJpZ2VuIGJsZWlidFxuICAvLyBkaWUgTGlzdGUgbGVlciB1bmQgZGllIFplaWxlIGRhbWl0IHVudmVyXHUwMEU0bmRlcnQuXG4gIGlmIChzaG93U3VidHlwZXMpIHtcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMpIGl0ZW0uc3VidHlwZXMgPSBwbHVnaW4uZ2V0U3VidHlwZXMoaXRlbS50eXBlLCB7IGluY2x1ZGVNYW51YWxPZmYgfSkubWFwKCh7IHN1YnR5cGUgfSkgPT4gc3VidHlwZSk7XG4gIH1cbiAgaWYgKGl0ZW1zLmxlbmd0aCA+IDApIHJldHVybiBpdGVtcztcbiAgbmV3IE5vdGljZShcIktlaW5lIFRZUGVuIHZvcmhhbmRlbi5cIik7XG4gIHJldHVybiBudWxsO1xufVxuXG4vLyBGXHUwMEZDciBfb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzOiBUWVAgdW5kIFN1YnR5cCBpbiBlaW5lbSBadWcuIEplXG4vLyBuYWNoIEVpbnN0ZWxsdW5nIHNlcGFyYXRlU3VidHlwZVBpY2tlciBlbnR3ZWRlciBlaW4gZWluemlnZXIgUGlja2VyIG1pdCBkZW5cbi8vIFN1YnR5cGVuIGVpbmdlclx1MDBGQ2NrdCB1bnRlciBpaHJlbSBUWVAgKFN0YW5kYXJkKSwgb2RlciB3aWUgZnJcdTAwRkNoZXIgZXJzdCBkZXJcbi8vIFRZUC1QaWNrZXIgLSBkb3J0IG1pdCBkZW4gU3VidHlwZW4gZGVzIFRZUHMgaGludGVyIGRlc3NlbiBOYW1lbiwgZGFtaXQgbWFuXG4vLyBzaWUgc2Nob24gdm9yIGRlciBXYWhsIHNpZWh0IC0gdW5kIGRhbmFjaCwgZmFsbHMgZGVyIFRZUCBhdXN3XHUwMEU0aGxiYXJlXG4vLyBTdWJ0eXBlbiBoYXQsIGRlciBTdWJ0eXAtUGlja2VyLCB2b3Jzb3J0aWVydCBuYWNoIGRlciBTdWNoYW5mcmFnZSB2b24gZG9ydFxuLy8gKEVTQyBmXHUwMEZDaHJ0IHp1clx1MDBGQ2NrIHp1ciBUWVAtQXVzd2FobCkuIE9wdGlvbmVuIHdpZSBiZWkgcGlja1R5cGU7XG4vLyBpbmNsdWRlTWFudWFsT2ZmIGdpbHQgZGFiZWkgYXVjaCBmXHUwMEZDciBkaWUgU3VidHlwZW4gKHNpZWhlIHBpY2tTdWJ0eXBlKS5cbi8vIExcdTAwRjZzdCBhdWYgbWl0XG4vLyB7IHR5cGUsIHN1YnR5cGUgfSAoc3VidHlwZSBudWxsIGZcdTAwRkNyIFwib2huZSBTdWJ0eXBcIiksIG9kZXIgbWl0IG51bGwgYmVpXG4vLyBBYmJydWNoLlxuYXN5bmMgZnVuY3Rpb24gcGlja1R5cGVBbmRTdWJ0eXBlKGFwcCwgcGx1Z2luLCBvcHRpb25zID0ge30pIHtcbiAgaWYgKHBsdWdpbi5zZXR0aW5ncy5zZXBhcmF0ZVN1YnR5cGVQaWNrZXIpIHtcbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgY29uc3QgZW50cnkgPSBhd2FpdCBwaWNrVHlwZUVudHJ5KGFwcCwgcGx1Z2luLCB7IC4uLm9wdGlvbnMsIHNob3dTdWJ0eXBlczogdHJ1ZSB9KTtcbiAgICAgIGlmICghZW50cnkpIHJldHVybiBudWxsO1xuICAgICAgY29uc3Qgc3VidHlwZSA9IGF3YWl0IHBpY2tTdWJ0eXBlKGFwcCwgcGx1Z2luLCBlbnRyeS50eXBlLCBlbnRyeS5xdWVyeSwgb3B0aW9ucyk7XG4gICAgICBpZiAoc3VidHlwZSAhPT0gbnVsbCkgcmV0dXJuIHsgdHlwZTogZW50cnkudHlwZSwgc3VidHlwZTogc3VidHlwZSB8fCBudWxsIH07XG4gICAgfVxuICB9XG5cbiAgY29uc3QgaXRlbXMgPSB0eXBlSXRlbXMoYXBwLCBwbHVnaW4sIG9wdGlvbnMpO1xuICBpZiAoIWl0ZW1zKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgZ3JvdXBzID0gaXRlbXMubWFwKChpdGVtKSA9PiAoe1xuICAgIGl0ZW0sXG4gICAgc3VidHlwZXM6IHBsdWdpbi5nZXRTdWJ0eXBlcyhpdGVtLnR5cGUsIG9wdGlvbnMpLm1hcCgoeyBzdWJ0eXBlLCBjb3VudCB9KSA9PiAoeyB0eXBlOiBpdGVtLnR5cGUsIHN1YnR5cGUsIGNvdW50IH0pKSxcbiAgfSkpO1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IG5ldyBUeXBTdWJ0eXBQaWNrZXJNb2RhbChhcHAsIHBsdWdpbiwgZ3JvdXBzLCByZXNvbHZlKS5vcGVuKCkpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcGlja1R5cGUsIHBpY2tTdWJ0eXBlLCBwaWNrVHlwZUFuZFN1YnR5cGUgfTtcbiIsICJjb25zdCB7IFRGaWxlLCBWYXVsdCwgZGVib3VuY2UsIG5vcm1hbGl6ZVBhdGggfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcblxuLy8gTnVyIFRlbXBsYXRlci1Ta3JpcHRlIG1pdCBkaWVzZW0gTWFya2VyIGluIGVpbmVtIEtvbW1lbnRhciB3ZXJkZW4gaW1cbi8vIFNob3J0Y3V0LU1vZGFsIChzaG9ydGN1dC1waWNrZXIuanMpIGFuZ2Vib3RlbiAtIHJlaW5lIEhpbGZzc2tyaXB0ZSAoei4gQi5cbi8vIHRvTGlzdElmTXVsdGlwbGUsIFRZUCBzZWxic3QpIGVyZ2ViZW4gYWxzIFNob3J0Y3V0IGtlaW5lbiBTaW5uLiBEZXIgVGV4dFxuLy8gaGludGVyIGRlbSBNYXJrZXIgYmlzIHp1bSBaZWlsZW5lbmRlIGRpZW50IGFscyBCZXNjaHJlaWJ1bmcgaW4gZGVyIExpc3RlO1xuLy8gZmVobHQgZXIsIHN0ZWh0IGRvcnQgbnVyIGRlciBTa3JpcHRuYW1lLiBFaW4gYWJzY2hsaWVcdTAwREZlbmRlcyBcIiovXCIgZWluZXNcbi8vIEJsb2Nra29tbWVudGFycyBnZWhcdTAwRjZydCBuaWNodCB6dXIgQmVzY2hyZWlidW5nLlxuLy9cbi8vIE9wdGlvbmFsIGZvbGd0IGRpcmVrdCBhdWYgZGVuIE1hcmtlciBlaW5lIFBhcmFtZXRlcmxpc3RlIGluIEtsYW1tZXJuLiBTaWVcbi8vIGJlc2NocmVpYnQgZGllIFZPTExTVFx1MDBDNE5ESUdFIEFyZ3VtZW50bGlzdGUgZGVzIEF1ZnJ1ZnMgbmFjaCBcInRwXCIgLSBhbHNvIG5pY2h0XG4vLyBudXIgZGllIGFiZ2VmcmFndGVuIFdlcnRlLCBzb25kZXJuIGF1Y2gsIGFuIHdlbGNoZXIgU3RlbGxlIGRhcyBTa3JpcHQgZGllXG4vLyBEYXRlaSBiencuIGRlbiBLb250ZXh0IGhhYmVuIHdpbGwgKHNpZWhlIFJFU0VSVkVEX1BBUkFNUyBpbiBzaG9ydGN1dHMuanMpOlxuLy8gICAvLyBAdHlwLXNob3J0Y3V0KG9yZG5lciwgamFocikgICAgICAgLT4gZih0cCwgXCJMaXRlcmF0dXJcIiwgMjAyNClcbi8vICAgLy8gQHR5cC1zaG9ydGN1dChuZXdGaWxlLCBqYWhyKSAgICAgIC0+IGYodHAsIG5ld0ZpbGUsIDIwMjQpXG4vLyAgIC8vIEB0eXAtc2hvcnRjdXQocHJvcGVydHkpICAgICAgICAgICAtPiBmKHRwLCBcIkZhbWlsaWVcIilcbi8vICAgLy8gQHR5cC1zaG9ydGN1dCAgICAgICAgICAgICAgICAgICAgIC0+IGYodHAsIG5ld0ZpbGUsIGN0eClcbi8vIERhZHVyY2ggYmVrb21tdCBqZWRlcyBTa3JpcHQgc2VpbmUgZWlnZW5lbiBQYXJhbWV0ZXIgaW4gc2VpbmVyIGVpZ2VuZW5cbi8vIFJlaWhlbmZvbGdlLCBzdGF0dCBzaWNoIGVpbmVyIGZlc3RlbiBLb252ZW50aW9uIGJldWdlbiB6dSBtXHUwMEZDc3Nlbi5cbi8vXG4vLyBVbnRlcnNjaGllZGVuIHdpcmQgendpc2NoZW4gXCJnYXIga2VpbmUgS2xhbW1lcm5cIiAocGFyYW1zID09PSBudWxsLCBkZXJcbi8vIGhlcmtcdTAwRjZtbWxpY2hlIEF1ZnJ1ZiBmKHRwLCBuZXdGaWxlLCBjdHgpIC0gc28gdmVyaGFsdGVuIHNpY2ggYWxsZSBiaXNoZXJcbi8vIG1hcmtpZXJ0ZW4gU2tyaXB0ZSB1bnZlclx1MDBFNG5kZXJ0KSB1bmQgXCJsZWVyZSBLbGFtbWVyblwiIChwYXJhbXMgPT09IFtdLCBlaW5cbi8vIEF1ZnJ1ZiBnYW56IG9obmUgQXJndW1lbnRlIGF1XHUwMERGZXIgdHApLlxuLy9cbi8vIERlciBNYXJrZXIgbXVzcyB1bm1pdHRlbGJhciBhdWYgZGVuIEtvbW1lbnRhcmJlZ2lubiBmb2xnZW4uIEVpbmUgZnJcdTAwRkNoZXJlXG4vLyBGYXNzdW5nIGVybGF1YnRlIGJlbGllYmlnZW4gVGV4dCBkYXZvciAtIGRhbWl0IGdlblx1MDBGQ2d0ZSBhYmVyIHNjaG9uIGVpbmVcbi8vIEVyd1x1MDBFNGhudW5nIGluIEZsaWVcdTAwREZ0ZXh0IChcIi4uLiBpbiBzZWluZW0gQHR5cC1zaG9ydGN1dC1NYXJrZXIgZGVrbGFyaWVydFwiKSxcbi8vIHVtIGVpbiBTa3JpcHQgdW5nZXdvbGx0IGFscyBTaG9ydGN1dCBhbnp1YmlldGVuLiBHZW5hdSBkYXMgaXN0IFRZUC5qc1xuLy8gcGFzc2llcnQsIGRlc3NlbiBLb3Bma29tbWVudGFyIGRpZSBLb252ZW50aW9uIGJlc2NocmVpYnQuIEFsbGUgdGF0c1x1MDBFNGNobGljaFxuLy8gbWFya2llcnRlbiBTa3JpcHRlIHNjaHJlaWJlbiBkZW4gTWFya2VyIG9obmVoaW4gYW4gZGVuIFplaWxlbmFuZmFuZy5cbi8vXG4vLyBcIlxcYlwiIGhpbnRlciBkZW0gTWFya2VybmFtZW4gdmVyaGluZGVydCwgZGFzcyBcIkB0eXAtc2hvcnRjdXRYWVpcIiBhbnNjaGxcdTAwRTRndCxcbi8vIHVuZCBzdFx1MDBGNnJ0IGRpZSBkaXJla3QgZm9sZ2VuZGUgS2xhbW1lciBuaWNodCAodCAtPiAoIGlzdCBlaW5lIFdvcnRncmVuemUpLlxuY29uc3QgU0hPUlRDVVRfTUFSS0VSID0gL15bIFxcdF0qKD86XFwvXFwvK3xcXC9cXCorfFxcKilbIFxcdF0qQHR5cC1zaG9ydGN1dFxcYig/OlxcKChbXildKilcXCkpP1sgXFx0XSooLio/KVsgXFx0XSooPzpcXCpcXC8pP1sgXFx0XSokL207XG5cbi8vIFBhcmFtZXRlcm5hbWVuIGF1cyBkZXIgS2xhbW1lciBkZXMgTWFya2VycywgaW4gRGVrbGFyYXRpb25zcmVpaGVuZm9sZ2UuXG4vLyBMZWVyZSBFaW50clx1MDBFNGdlICh6LiBCLiBiZWkgXCIoKVwiIG9kZXIgZWluZW0gXHUwMEZDYmVyelx1MDBFNGhsaWdlbiBLb21tYSkgZmFsbGVuIHdlZztcbi8vIGVpbiB2ZXJzZWhlbnRsaWNoIGRvcHBlbHQgZ2VuYW5udGVyIE5hbWUgZXJnXHUwMEU0YmUgendlaSBFaW5nYWJlZmVsZGVyLCBkaWVcbi8vIGJlaWRlIGRlbnNlbGJlbiBFaW50cmFnIHNjaHJlaWJlbiwgdW5kIGJsZWlidCBkZXNoYWxiIG51ciBlaW5tYWwgc3RlaGVuLlxuZnVuY3Rpb24gcGFyc2VQYXJhbXMocmF3KSB7XG4gIGNvbnN0IG5hbWVuID0gKHJhdyA/PyBcIlwiKVxuICAgIC5zcGxpdChcIixcIilcbiAgICAubWFwKChuYW1lKSA9PiBuYW1lLnRyaW0oKSlcbiAgICAuZmlsdGVyKChuYW1lKSA9PiBuYW1lICE9PSBcIlwiKTtcbiAgcmV0dXJuIFsuLi5uZXcgU2V0KG5hbWVuKV07XG59XG5cbi8vIEhcdTAwRTRsdCBkaWUgTGlzdGUgZGVyIGFscyBTaG9ydGN1dCBtYXJraWVydGVuIFRlbXBsYXRlci1Ta3JpcHRlIGFrdHVlbGwuXG4vL1xuLy8gRGllIExpc3RlIHdpcmQgdm9yYWIgKGFzeW5jaHJvbikgYXVzIFRlbXBsYXRlcnMgU2tyaXB0LU9yZG5lciBnZWxlc2VuIHVuZCBiZWlcbi8vIFx1MDBDNG5kZXJ1bmdlbiBkYXJpbiBuYWNoZ2VmXHUwMEZDaHJ0LCBzdGF0dCBzaWUgZXJzdCBiZWltIFx1MDBENmZmbmVuIGRlcyBNb2RhbHMgenVcbi8vIGVybWl0dGVsbiAtIHNvIGlzdCBzaWUgZG9ydCBvaG5lIFdhcnRlemVpdCBkYSwgdW5kIGRhcyBNb2RhbCBibGVpYnQgZnJlaSB2b25cbi8vIERhdGVpenVncmlmZmVuLiBMaWVmZXJ0IGVpbmVuIEFjY2Vzc29yIGF1ZiBkaWUgamV3ZWlscyBha3R1ZWxsZSBMaXN0ZVxuLy8gKFt7IG5hbWUsIHBhcmFtcywgZGVzY3JpcHRpb24gfV0sIG5hY2ggTmFtZW4gc29ydGllcnQpLlxuZnVuY3Rpb24gcmVnaXN0ZXJTaG9ydGN1dFNjcmlwdHMocGx1Z2luKSB7XG4gIGNvbnN0IHsgYXBwIH0gPSBwbHVnaW47XG5cbiAgbGV0IHNjcmlwdEZvbGRlciA9IG51bGw7XG4gIGxldCBzY3JpcHRzID0gW107XG5cbiAgY29uc3QgY3VycmVudFNjcmlwdEZvbGRlciA9ICgpID0+IHtcbiAgICBjb25zdCBmb2xkZXIgPSBhcHAucGx1Z2lucy5wbHVnaW5zW1widGVtcGxhdGVyLW9ic2lkaWFuXCJdPy5zZXR0aW5ncz8udXNlcl9zY3JpcHRzX2ZvbGRlcjtcbiAgICByZXR1cm4gZm9sZGVyID8gbm9ybWFsaXplUGF0aChmb2xkZXIpIDogbnVsbDtcbiAgfTtcblxuICBjb25zdCBpc0luU2NyaXB0Rm9sZGVyID0gKHBhdGgpID0+ICEhc2NyaXB0Rm9sZGVyICYmICEhcGF0aCAmJiBwYXRoLnN0YXJ0c1dpdGgoc2NyaXB0Rm9sZGVyICsgXCIvXCIpO1xuXG4gIC8vIFdpZSBUZW1wbGF0ZXIgc2VsYnN0OiBhbGxlIC5qcy1EYXRlaWVuIGltIFNrcmlwdC1PcmRuZXIgaW5rbC5cbiAgLy8gVW50ZXJvcmRuZXJuLCBTa3JpcHRuYW1lID0gRGF0ZWluYW1lIG9obmUgRW5kdW5nLlxuICBhc3luYyBmdW5jdGlvbiByZWZyZXNoU2NyaXB0cygpIHtcbiAgICBjb25zdCBmb2xkZXJQYXRoID0gY3VycmVudFNjcmlwdEZvbGRlcigpO1xuICAgIHNjcmlwdEZvbGRlciA9IGZvbGRlclBhdGg7XG4gICAgY29uc3QgZm9sZGVyID0gZm9sZGVyUGF0aCA/IGFwcC52YXVsdC5nZXRGb2xkZXJCeVBhdGgoZm9sZGVyUGF0aCkgOiBudWxsO1xuICAgIGNvbnN0IGZpbGVzID0gW107XG4gICAgaWYgKGZvbGRlcikge1xuICAgICAgVmF1bHQucmVjdXJzZUNoaWxkcmVuKGZvbGRlciwgKGNoaWxkKSA9PiB7XG4gICAgICAgIGlmIChjaGlsZCBpbnN0YW5jZW9mIFRGaWxlICYmIGNoaWxkLmV4dGVuc2lvbiA9PT0gXCJqc1wiKSBmaWxlcy5wdXNoKGNoaWxkKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICBjb25zdCBmb3VuZCA9IFtdO1xuICAgIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgbWF0Y2ggPSAoYXdhaXQgYXBwLnZhdWx0LmNhY2hlZFJlYWQoZmlsZSkpLm1hdGNoKFNIT1JUQ1VUX01BUktFUik7XG4gICAgICAgIC8vIG1hdGNoWzFdIGlzdCB1bmRlZmluZWQsIHdlbm4gZ2FyIGtlaW5lIEtsYW1tZXJuIGRhc3RlaGVuLCB1bmQgXCJcIiBiZWlcbiAgICAgICAgLy8gbGVlcmVuIEtsYW1tZXJuIC0gZGVyIFVudGVyc2NoaWVkIGVudHNjaGVpZGV0IFx1MDBGQ2JlciBkaWUgQXVmcnVmZm9ybS5cbiAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgZm91bmQucHVzaCh7XG4gICAgICAgICAgICBuYW1lOiBmaWxlLmJhc2VuYW1lLFxuICAgICAgICAgICAgcGFyYW1zOiBtYXRjaFsxXSA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IHBhcnNlUGFyYW1zKG1hdGNoWzFdKSxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBtYXRjaFsyXSA/PyBcIlwiLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYFRZUC1TeXN0ZW06IFRlbXBsYXRlci1Ta3JpcHQgJHtmaWxlLnBhdGh9IG5pY2h0IGxlc2JhcmAsIGUpO1xuICAgICAgfVxuICAgIH1cbiAgICAvLyBPcmRuZXIgendpc2NoZW56ZWl0bGljaCBpbiBUZW1wbGF0ZXIgdW1nZXN0ZWxsdDogRXJnZWJuaXMgdmVyd2VyZmVuLFxuICAgIC8vIGRlciBMYXVmIGZcdTAwRkNyIGRlbiBuZXVlbiBPcmRuZXIgaXN0IGJlcmVpdHMgYW5nZXN0b1x1MDBERmVuLlxuICAgIGlmIChmb2xkZXJQYXRoICE9PSBzY3JpcHRGb2xkZXIpIHJldHVybjtcbiAgICBzY3JpcHRzID0gZm91bmQuc29ydCgoYSwgYikgPT4gYS5uYW1lLmxvY2FsZUNvbXBhcmUoYi5uYW1lKSk7XG4gIH1cblxuICBjb25zdCBzY2hlZHVsZVJlZnJlc2ggPSBkZWJvdW5jZShyZWZyZXNoU2NyaXB0cywgMzAwLCB0cnVlKTtcbiAgY29uc3Qgb25GaWxlQ2hhbmdlID0gKGZpbGUsIG9sZFBhdGgpID0+IHtcbiAgICBpZiAoaXNJblNjcmlwdEZvbGRlcihmaWxlPy5wYXRoKSB8fCBpc0luU2NyaXB0Rm9sZGVyKG9sZFBhdGgpKSBzY2hlZHVsZVJlZnJlc2goKTtcbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoYXBwLnZhdWx0Lm9uKFwiY3JlYXRlXCIsIG9uRmlsZUNoYW5nZSkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJtb2RpZnlcIiwgb25GaWxlQ2hhbmdlKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC52YXVsdC5vbihcImRlbGV0ZVwiLCBvbkZpbGVDaGFuZ2UpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoYXBwLnZhdWx0Lm9uKFwicmVuYW1lXCIsIG9uRmlsZUNoYW5nZSkpO1xuICBhcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkocmVmcmVzaFNjcmlwdHMpO1xuXG4gIHJldHVybiAoKSA9PiB7XG4gICAgLy8gVGVtcGxhdGVyLU9yZG5lciBpbnp3aXNjaGVuIHVtZ2VzdGVsbHQ6IGZcdTAwRkNyIGRlbiBuXHUwMEU0Y2hzdGVuIEF1ZnJ1ZlxuICAgIC8vIG5hY2hsYWRlbiwgamV0enQgbm9jaCBtaXQgZGVyIGJpc2hlcmlnZW4gTGlzdGUgYW50d29ydGVuLlxuICAgIGlmIChjdXJyZW50U2NyaXB0Rm9sZGVyKCkgIT09IHNjcmlwdEZvbGRlcikgc2NoZWR1bGVSZWZyZXNoKCk7XG4gICAgcmV0dXJuIHNjcmlwdHM7XG4gIH07XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlclNob3J0Y3V0U2NyaXB0cywgU0hPUlRDVVRfTUFSS0VSLCBwYXJzZVBhcmFtcyB9O1xuIiwgImNvbnN0IHsgUGx1Z2luIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IERFRkFVTFRfU0VUVElOR1MsIFR5cFN5c3RlbVNldHRpbmdUYWIgfSA9IHJlcXVpcmUoXCIuL3NldHRpbmdzXCIpO1xuY29uc3QgeyByZWdpc3RlckNvbW1hbmRzIH0gPSByZXF1aXJlKFwiLi9jb21tYW5kc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJUeXBWaWV3LCBzb3J0VHlwZXNCeU1vZGUsIERFRkFVTFRfU09SVF9PUkRFUiB9ID0gcmVxdWlyZShcIi4vdHlwLXZpZXdcIik7XG5jb25zdCB7IFR5cEluZGV4LCBzZXRDYW5vbmljYWxQcm9wZXJ0eSwgZGVsZXRlUHJvcGVydHksIFRZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZIH0gPSByZXF1aXJlKFwiLi90eXAtaW5kZXhcIik7XG5jb25zdCB7XG4gIGdldFN1YnR5cGUsXG4gIGdldFN1YnR5cGVOYW1lcyxcbiAgaXNTdWJ0eXBlTWFudWFsLFxuICBtaWdyYXRlQWJvdmVTdGFuZGFyZCxcbiAgbWlncmF0ZVN1YnR5cGVDb2xvclNjYWxlLFxuICBtaWdyYXRlU3VidHlwZU1hbnVhbCxcbn0gPSByZXF1aXJlKFwiLi9zdWJ0eXBlc1wiKTtcbmNvbnN0IHsgREVGQVVMVF9TVUJUWVBFX0NPTE9SX1JBTkdFUyB9ID0gcmVxdWlyZShcIi4vdHlwZS1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyRmlsZUV4cGxvcmVyQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9maWxlLWV4cGxvcmVyLWNvbG9yc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJHcmFwaENvbG9ycyB9ID0gcmVxdWlyZShcIi4vZ3JhcGgtY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlclNlYXJjaENvbG9ycyB9ID0gcmVxdWlyZShcIi4vc2VhcmNoLWNvbG9yc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJSZWNlbnRGaWxlc0NvbG9ycyB9ID0gcmVxdWlyZShcIi4vcmVjZW50LWZpbGVzLWNvbG9yc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJCYWNrbGlua0NvbG9ycyB9ID0gcmVxdWlyZShcIi4vYmFja2xpbmstY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlckJvb2ttYXJrc0NvbG9ycyB9ID0gcmVxdWlyZShcIi4vYm9va21hcmstY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlckFjdGl2ZVRpdGxlQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9hY3RpdmUtdGl0bGUtY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlckxpbmtDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL2xpbmstY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlckZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodCB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItZGVmYXVsdC1oaWdobGlnaHRcIik7XG5jb25zdCB7IHJlZ2lzdGVyUHJvcGVydHlSZW5hbWVTeW5jIH0gPSByZXF1aXJlKFwiLi9wcm9wZXJ0eS1yZW5hbWUtc3luY1wiKTtcbmNvbnN0IHsgbm9ybWFsaXplR2xvYmFsT3JkZXIsIHNvcnRGcm9udG1hdHRlckZvciwgcGxhY2VQcm9wZXJ0eUZvciB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItc29ydFwiKTtcbmNvbnN0IHsgcmVzb2x2ZVNob3J0Y3V0cywgc2NyaXB0TmFtZU9mLCByZXNvbHZlQ2FsbEFyZ3MgfSA9IHJlcXVpcmUoXCIuL3Nob3J0Y3V0c1wiKTtcbmNvbnN0IHtcbiAgcGlja1R5cGU6IHBpY2tUeXBlTW9kYWwsXG4gIHBpY2tTdWJ0eXBlOiBwaWNrU3VidHlwZU1vZGFsLFxuICBwaWNrVHlwZUFuZFN1YnR5cGU6IHBpY2tUeXBlQW5kU3VidHlwZU1vZGFsLFxufSA9IHJlcXVpcmUoXCIuL3R5cGUtcGlja2VyXCIpO1xuY29uc3QgeyByZWdpc3RlclNob3J0Y3V0U2NyaXB0cyB9ID0gcmVxdWlyZShcIi4vc2hvcnRjdXQtc2NyaXB0c1wiKTtcblxuLy8gTWlncmllcnQgQmVzdGFuZHNpbnN0YWxsYXRpb25lbiB2b24gZGVyIGFsdGVuLCBzZXBhcmF0ZW5cbi8vIHR5cGVGbG9hdGluZ0Zyb250bWF0dGVyLUxpc3RlIChlaWdlbmVzIERpY3QgamUgVHlwLCBpbW1lciBoaW50ZXIgZGVyXG4vLyBTdGFuZGFyZGxpc3RlIHNvcnRpZXJ0KSBhdWYgZGllIG5ldWUgdHlwZUZsb2F0aW5nS2V5cy1NYXJraWVydW5nIGlubmVyaGFsYlxuLy8gZGVyc2VsYmVuIHR5cGVEZWZhdWx0RnJvbnRtYXR0ZXItTGlzdGUgKHNpZWhlIEtvbW1lbnRhciBhbiB0eXBlRmxvYXRpbmdLZXlzXG4vLyBpbiBzZXR0aW5ncy5qcykgLSBkaWUgRmxvYXRpbmcgUHJvcGVydGllcyBsYW5kZW4gZGFiZWkgdW52ZXJcdTAwRTRuZGVydCBkaXJla3Rcbi8vIGltIEFuc2NobHVzcyBhbiBkaWUgYmlzaGVyaWdlIFN0YW5kYXJkbGlzdGUsIGdlbmF1IHdpZSB6dXZvci5cbmZ1bmN0aW9uIG1pZ3JhdGVGbG9hdGluZ0Zyb250bWF0dGVyKHNldHRpbmdzKSB7XG4gIGlmICghc2V0dGluZ3MudHlwZUZsb2F0aW5nRnJvbnRtYXR0ZXIpIHJldHVybjtcbiAgZm9yIChjb25zdCBbdHlwZSwgZmxvYXRpbmddIG9mIE9iamVjdC5lbnRyaWVzKHNldHRpbmdzLnR5cGVGbG9hdGluZ0Zyb250bWF0dGVyKSkge1xuICAgIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyhmbG9hdGluZykuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gXCJcIik7XG4gICAgaWYgKGtleXMubGVuZ3RoID09PSAwKSBjb250aW51ZTtcbiAgICBzZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdID0geyAuLi4oc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXSA/PyB7fSksIC4uLmZsb2F0aW5nIH07XG4gICAgc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXSA9IFsuLi5uZXcgU2V0KFsuLi4oc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXSA/PyBbXSksIC4uLmtleXNdKV07XG4gIH1cbiAgZGVsZXRlIHNldHRpbmdzLnR5cGVGbG9hdGluZ0Zyb250bWF0dGVyO1xufVxuXG4vLyBBdXMgZGVtIGZydWVoZXJlbiBTY2hhbHRlciBcIkJlc2NocmVpYnVuZ3MtVGV4dGZlbGQgYW56ZWlnZW5cIiAoQm9vbGVhbikgaXN0XG4vLyBkZXIgZHJlaXN0dWZpZ2UgTW9kdXMgZGVyIHp3ZWl0ZW4gU3BhbHRlIGdld29yZGVuLCB1bWdlc2NoYWx0ZXQgdWViZXIgZGVuXG4vLyBLbm9wZiBpbSBMaXN0ZW4tSGVhZGVyIChzaWVoZSBTRUNPTkRBUllfTU9ERVMgaW4gdHlwLXZpZXcuanMpLiBEZXIgYWx0ZSBXZXJ0XG4vLyBrZW5udCBudXIgendlaSBkZXIgZHJlaSBadXN0YWVuZGUgLSB0cnVlIHdpcmQgenVyIEJlc2NocmVpYnVuZywgZmFsc2UgenVcbi8vIFwibmljaHRzXCI7IFwic3VidHlwZXNcIiBnYWIgZXMgZGFtYWxzIG5vY2ggbmljaHQuIExpZWZlcnQgdHJ1ZSBiZWkgZWluZXJcbi8vIEFlbmRlcnVuZywgZGFtaXQgZGVyIEF1ZnJ1ZmVyIHNpZSBnbGVpY2ggc2NocmVpYnQgdW5kIGRlciBhbHRlIFNjaGx1ZXNzZWxcbi8vIG5pY2h0IGluIGRhdGEuanNvbiBsaWVnZW4gYmxlaWJ0LlxuLy9cbi8vIEdlcHJ1ZWZ0IHdpcmQgZ2VnZW4gc3RvcmVkIChkaWUgcm9oZW4gZ2VsYWRlbmVuIERhdGVuKSwgTklDSFQgZ2VnZW4gc2V0dGluZ3M6XG4vLyBkb3J0IGhhdCBPYmplY3QuYXNzaWduIGRlbiBuZXVlbiBTY2hsdWVzc2VsIGxhZW5nc3QgYXVzIERFRkFVTFRfU0VUVElOR1Ncbi8vIGdlZnVlbGx0LCBcIm5vY2ggbmljaHQgZ2VzZXR6dFwiIHdhZXJlIGRhcmFuIGFsc28gbmllIHp1IGVya2VubmVuIHVuZCBkZXIgYWx0ZVxuLy8gV2VydCBibGllYmUgc3RpbGxzY2h3ZWlnZW5kIGxpZWdlbi5cbmZ1bmN0aW9uIG1pZ3JhdGVUeXBMaXN0U2Vjb25kYXJ5KHNldHRpbmdzLCBzdG9yZWQpIHtcbiAgaWYgKHN0b3JlZD8udHlwTGlzdERlc2NyaXB0aW9uRW5hYmxlZCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7XG4gIGlmIChzdG9yZWQudHlwTGlzdFNlY29uZGFyeSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgc2V0dGluZ3MudHlwTGlzdFNlY29uZGFyeSA9IHN0b3JlZC50eXBMaXN0RGVzY3JpcHRpb25FbmFibGVkID8gXCJkZXNjcmlwdGlvblwiIDogXCJub25lXCI7XG4gIH1cbiAgZGVsZXRlIHNldHRpbmdzLnR5cExpc3REZXNjcmlwdGlvbkVuYWJsZWQ7XG4gIHJldHVybiB0cnVlO1xufVxuXG4vLyBEaWUgQXVzcmljaHR1bmcgZGVyIFN1YnR5cC1Wb3JzY2hhdSB3YXIga3VyenplaXRpZyBlaW5lIGVpZ2VuZSBFaW5zdGVsbHVuZ1xuLy8gdW5kIGlzdCBqZXR6dCBlaW4gU3R5bGUgU2V0dGluZyAoYm9keS1LbGFzc2UsIHNpZWhlIGRlbiBAc2V0dGluZ3MtQmxvY2sgaW5cbi8vIHN0eWxlcy5jc3MpIC0gZGFzIFBsdWdpbiBsaWVzdCBkZW4gU2NobHVlc3NlbCBuaWNodCBtZWhyLiBPaG5lIGRpZXNlc1xuLy8gQXVmcmFldW1lbiBibGllYmUgZXIgdWViZXIgT2JqZWN0LmFzc2lnbiBpbiBsb2FkU2V0dGluZ3MgZGF1ZXJoYWZ0IGluXG4vLyBkYXRhLmpzb24gc3RlaGVuLlxuZnVuY3Rpb24gZHJvcFR5cExpc3RTdWJ0eXBlc0FsaWduKHNldHRpbmdzKSB7XG4gIGlmIChzZXR0aW5ncy50eXBMaXN0U3VidHlwZXNSaWdodEFsaWduZWQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZhbHNlO1xuICBkZWxldGUgc2V0dGluZ3MudHlwTGlzdFN1YnR5cGVzUmlnaHRBbGlnbmVkO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBjbGFzcyBUeXBTeXN0ZW1QbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBhc3luYyBvbmxvYWQoKSB7XG4gICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoKTtcblxuICAgIC8vIFZvciBhbGxlbiBcdTAwRkNicmlnZW4gTW9kdWxlbjogZGllIHJlZ2lzdHJpZXJlbiBzaWNoIGF1ZiBkZXNzZW4gXCJjaGFuZ2VcIi1cbiAgICAvLyBFdmVudCB1bmQgbGVzZW4gVFlQL1NVQlRZUCBhdXNzY2hsaWVcdTAwREZsaWNoIGRhclx1MDBGQ2JlciAoc2llaGUgdHlwLWluZGV4LmpzKS5cbiAgICB0aGlzLnR5cEluZGV4ID0gbmV3IFR5cEluZGV4KHRoaXMpO1xuICAgIHRoaXMudHlwSW5kZXgucmVnaXN0ZXIoKTtcblxuICAgIHJlZ2lzdGVyQ29tbWFuZHModGhpcyk7XG4gICAgdGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBUeXBTeXN0ZW1TZXR0aW5nVGFiKHRoaXMuYXBwLCB0aGlzKSk7XG4gICAgLy8gVW1iZW5lbm51bmdlbiBcdTAwRkNiZXIgXCJBbGwgcHJvcGVydGllc1wiL0Jhc2VzIGF1Y2ggaW5zIFRZUC1Gcm9udG1hdHRlclxuICAgIC8vIGRlciBUeXBlbiBcdTAwRkNiZXJuZWhtZW4gKHNpZWhlIHByb3BlcnR5LXJlbmFtZS1zeW5jLmpzKS5cbiAgICByZWdpc3RlclByb3BlcnR5UmVuYW1lU3luYyh0aGlzKTtcbiAgICAvLyBBY2Nlc3NvciBhdWYgZGllIGFscyBcIkB0eXAtc2hvcnRjdXRcIiBtYXJraWVydGVuIFRlbXBsYXRlci1Ta3JpcHRlLCBmXHUwMEZDclxuICAgIC8vIGRhcyBBdXN3YWhsLU1vZGFsIGRlciBQcm9wZXJ0eS1aZWlsZW4gKHNpZWhlIHNob3J0Y3V0LXBpY2tlci5qcykuXG4gICAgdGhpcy5nZXRTaG9ydGN1dFNjcmlwdHMgPSByZWdpc3RlclNob3J0Y3V0U2NyaXB0cyh0aGlzKTtcblxuICAgIC8vIFNlcGFyYXQgZ2VoYWx0ZW4gKG5pY2h0IG51ciBUZWlsIHZvbiByZWZyZXNoRm5zKTogZGllIFRZUC1EZXRhaWxhbnNpY2h0XG4gICAgLy8gYnJhdWNodCBuYWNoIGRlbSBNb3VudGVuIGlocmVzIFRZUC1Gcm9udG1hdHRlci1FZGl0b3JzIGdlemllbHQgbnVyXG4gICAgLy8gZGllc2VuIGVpbmVuIFJlZnJlc2ggKEZldHQtTWFya2llcnVuZyBkZXIgUHJvcGVydHktWmVpbGVuKSAtIGRhcyBnYW56ZVxuICAgIC8vIHJlZnJlc2hUeXBDb2xvcnMoKS1CXHUwMEZDbmRlbCB3XHUwMEZDcmRlIGRvcnQgYXVjaCB1bm5cdTAwRjZ0aWcgcmVnaXN0ZXJUeXBWaWV3J3NcbiAgICAvLyBlaWdlbmVuIFJlbmRlci1SZWZyZXNoIG1pdGFuc3RvXHUwMERGZW4gdW5kIHNpY2ggZGFtaXQgc2VsYnN0IHJla3Vyc2l2XG4gICAgLy8gZXJuZXV0IHJlbmRlcm4gKGZcdTAwRkNocnRlIHp1IGVpbmVtIFN0YWNrIE92ZXJmbG93IGJlaSBqZWRlbSBUWVAtXHUwMEQ2ZmZuZW4pLlxuICAgIHRoaXMucmVmcmVzaEZyb250bWF0dGVySGlnaGxpZ2h0ID0gcmVnaXN0ZXJGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQodGhpcyk7XG5cbiAgICBjb25zdCByZWZyZXNoRm5zID0gW1xuICAgICAgcmVnaXN0ZXJUeXBWaWV3KHRoaXMpLFxuICAgICAgcmVnaXN0ZXJGaWxlRXhwbG9yZXJDb2xvcnModGhpcyksXG4gICAgICByZWdpc3RlckdyYXBoQ29sb3JzKHRoaXMpLFxuICAgICAgcmVnaXN0ZXJTZWFyY2hDb2xvcnModGhpcyksXG4gICAgICByZWdpc3RlclJlY2VudEZpbGVzQ29sb3JzKHRoaXMpLFxuICAgICAgcmVnaXN0ZXJCYWNrbGlua0NvbG9ycyh0aGlzKSxcbiAgICAgIHJlZ2lzdGVyQm9va21hcmtzQ29sb3JzKHRoaXMpLFxuICAgICAgcmVnaXN0ZXJBY3RpdmVUaXRsZUNvbG9ycyh0aGlzKSxcbiAgICAgIHJlZ2lzdGVyTGlua0NvbG9ycyh0aGlzKSxcbiAgICAgIHRoaXMucmVmcmVzaEZyb250bWF0dGVySGlnaGxpZ2h0LFxuICAgIF07XG4gICAgdGhpcy5yZWZyZXNoVHlwQ29sb3JzID0gKCkgPT4gcmVmcmVzaEZucy5mb3JFYWNoKChmbikgPT4gZm4oKSk7XG5cbiAgICAvLyBEZXIgQHNldHRpbmdzLUJsb2NrIGluIHN0eWxlcy5jc3MgKFN0eWxlIFNldHRpbmdzLCBzaWVoZSBkb3J0KSB3aXJkIHNvbnN0XG4gICAgLy8gamUgbmFjaCBMYWRlcmVpaGVuZm9sZ2UgdWViZXJzZWhlbjogU3R5bGUgU2V0dGluZ3MgbGllc3QgZGllIFN0eWxlc2hlZXRzXG4gICAgLy8gYmVpbSBlaWdlbmVuIExhZGVuIHVuZCBkYW5hY2ggbnVyIG5vY2ggYmVpIFwiY3NzLWNoYW5nZVwiIC0gZGFzIGZldWVydCBhYmVyXG4gICAgLy8gYXVzc2NobGllc3NsaWNoIGZ1ZXIgVGhlbWVzIHVuZCBTbmlwcGV0cywgbmljaHQgZnVlciBkYXMgc3R5bGVzLmNzcyBlaW5lc1xuICAgIC8vIFBsdWdpbnMuIFdlciBzcGFldGVyIGdlbGFkZW4gd2lyZCBhbHMgU3R5bGUgU2V0dGluZ3MgKG9kZXIgcGVyIEhvdC1SZWxvYWRcbiAgICAvLyBuZXUgZ2VsYWRlbiB3aXJkKSwgdGF1Y2h0IGRvcnQgYWxzbyBnYXIgbmljaHQgYXVmLiBcInBhcnNlLXN0eWxlLXNldHRpbmdzXCJcbiAgICAvLyBpc3QgZGVyIGRhZnVlciB2b3JnZXNlaGVuZSBIb29rOyBvaG5lIGluc3RhbGxpZXJ0ZXMgU3R5bGUgU2V0dGluZ3MgaG9lcnRcbiAgICAvLyBuaWVtYW5kIHp1IHVuZCBkZXIgQXVmcnVmIHZlcnB1ZmZ0IGZvbGdlbmxvcy5cbiAgICAvL1xuICAgIC8vIEVyc3QgaW0gbmFlY2hzdGVuIFRpY2s6IE9ic2lkaWFuIGhhZW5ndCBkYXMgc3R5bGVzLmNzcyBlaW5lcyBQbHVnaW5zIGVyc3RcbiAgICAvLyBOQUNIIGRlc3NlbiBvbmxvYWQoKSBpbiBkZW4gRE9NIC0gc3luY2hyb24gaGllciBnZXJ1ZmVuIGZ1ZW5kZSBTdHlsZVxuICAgIC8vIFNldHRpbmdzIGRhcyBTdHlsZXNoZWV0IG5vY2ggZ2FyIG5pY2h0IHVuZCBsaWVzc2UgZGVuIEFic2Nobml0dCBhdXMuXG4gICAgLy8gb25MYXlvdXRSZWFkeSB0YXVndCBkYWZ1ZXIgbmljaHQ6IGJlaW0gSG90LVJlbG9hZCBpc3QgZGFzIExheW91dCBsYWVuZ3N0XG4gICAgLy8gZmVydGlnLCBkZXIgUnVlY2tydWYgbGllZmUgYWxzbyBzb2ZvcnQgdW5kIGRhbWl0IGdlbmF1c28genUgZnJ1ZWguXG4gICAgY29uc3QgcGFyc2VTdHlsZVNldHRpbmdzID0gd2luZG93LnNldFRpbWVvdXQoKCkgPT4gdGhpcy5hcHAud29ya3NwYWNlLnRyaWdnZXIoXCJwYXJzZS1zdHlsZS1zZXR0aW5nc1wiKSwgMCk7XG4gICAgdGhpcy5yZWdpc3RlcigoKSA9PiB3aW5kb3cuY2xlYXJUaW1lb3V0KHBhcnNlU3R5bGVTZXR0aW5ncykpO1xuICB9XG5cbiAgb251bmxvYWQoKSB7fVxuXG4gIC8vIEZcdTAwRkNyIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanM6IGxpZWZlcnQgZGllIGltIFRZUC1WaWV3IHVudGVyXG4gIC8vIFwiVFlQLUZyb250bWF0dGVyXCIgaGludGVybGVndGVuIFByb3BlcnRpZXMgZlx1MDBGQ3IgZGVuIGdlZ2ViZW5lbiBUWVAsIGRhbWl0XG4gIC8vIFRlbXBsYXRlciBzaWUgYmVpbSBBbmxlZ2VuIGVpbmVyIG5ldWVuIE5vdGl6IFx1MDBGQ2Jlcm5laG1lbiBrYW5uLCBzdGF0dCBzaWUgZG9ydFxuICAvLyBlaW4gendlaXRlcyBNYWwgenUgcGZsZWdlbi4gS29waWUgc3RhdHQgZGlyZWt0ZXIgUmVmZXJlbnosIGRhbWl0IGVpblxuICAvLyBBdWZydWZlciBkaWUgenVyXHUwMEZDY2tnZWdlYmVuZW4gV2VydGUgZ2VmYWhybG9zIG11dGllcmVuIGthbm4sIG9obmUgZGllXG4gIC8vIFBsdWdpbi1TZXR0aW5ncyB6dSB2ZXJcdTAwRTRuZGVybi5cbiAgLy9cbiAgLy8gUHJvcGVydGllcyBtaXQgZWluZW0gZmVzdGVuIFNob3J0Y3V0ICh0b2RheS9ub3cvY3JlYXRlZCwgc2llaGVcbiAgLy8gc2hvcnRjdXRzLmpzKSB0cmFnZW4gZGVzc2VuIGVyc3QgaGllciBhdWZnZWxcdTAwRjZzdGVuIFdlcnQgLSBuaWNodCBkZW4gYmVpbVxuICAvLyBTZXR6ZW4gZ1x1MDBGQ2x0aWdlbiwgZXMga29tbXQgYWxzbyBiZWkgamVkZW0gQXVmcnVmIGZyaXNjaCBCZXJlY2huZXRlcyBoZXJhdXMuXG4gIC8vIFByb3BlcnRpZXMgbWl0IGVpbmVtIFNrcmlwdC1TaG9ydGN1dCB0cmFnZW4gbnVsbDogZGllIGthbm4gbnVyIFRlbXBsYXRlclxuICAvLyBhdWZsXHUwMEY2c2VuLCBUWVAuanMgaG9sdCBzaWUgc2ljaCBcdTAwRkNiZXIgZ2V0VHlwZVNob3J0Y3V0cygpICh1bnRlbikgdW5kIHNldHp0XG4gIC8vIHNpZSBzZWxic3QgZWluLiBLZXkgdW5kIFBvc2l0aW9uIGJsZWliZW4gaW4gYmVpZGVuIEZcdTAwRTRsbGVuIGVyaGFsdGVuLlxuICAvL1xuICAvLyBpbmNsdWRlRmxvYXRpbmcgKFN0YW5kYXJkOiBmYWxzZSkgbFx1MDBFNHNzdCBkaWUgYWxzIFwiRmxvYXRpbmcgUHJvcGVydHlcIlxuICAvLyBtYXJraWVydGVuIEtleXMgKHR5cGVGbG9hdGluZ0tleXMpIGluIGRlciBMaXN0ZSAtIGFuZGVycyBhbHMgZGllIFx1MDBGQ2JyaWdlblxuICAvLyBTdGFuZGFyZC1Qcm9wZXJ0aWVzIHdlcmRlbiBkaWVzZSBOSUNIVCBhdXRvbWF0aXNjaCBiZWkgamVkZXIgbmV1ZW4gTm90aXpcbiAgLy8gYW5nZWxlZ3QgKHNpZSB6XHUwMEU0aGxlbiB6d2FyIGZcdTAwRkNyIGRpZSBGcm9udG1hdHRlci1Tb3J0aWVydW5nIG1pdCwgc2llaGVcbiAgLy8gb3JkZXJlZERlZmF1bHRLZXlzIGluIGZyb250bWF0dGVyLXNvcnQuanMsIHNvbGxlbiBhYmVyIG51ciBiZWkgQmVkYXJmXG4gIC8vIGV4cGxpeml0IHZvbiBlaW5lbSBUZW1wbGF0ZXItU2tyaXB0IGFiZ2VncmlmZmVuIHdlcmRlbikuXG4gIC8vXG4gIC8vIGZpbGUgKG9wdGlvbmFsKSB3aXJkIGFuIHJlc29sdmVTaG9ydGN1dHMoKSBkdXJjaGdlcmVpY2h0IC0gbnVyIGZcdTAwRkNyIGRlblxuICAvLyBcImNyZWF0ZWRcIi1TaG9ydGN1dCByZWxldmFudCwgZGVyIGRhcyBFcnN0ZWxsdW5nc2RhdHVtIGRlciBaaWVsLURhdGVpIHN0YXR0XG4gIC8vIGRlcyBBdWZydWZ6ZWl0cHVua3RzIGxpZWZlcnQuXG4gIC8vXG4gIC8vIHN1YnR5cGUgKG9wdGlvbmFsKTogZXJnXHUwMEU0bnp0IGRhcyBUWVAtRnJvbnRtYXR0ZXIgdW0gZGVuIEJsb2NrIGRpZXNlc1xuICAvLyBTdWJ0eXBzIChzaWVoZSBzdWJ0eXBlcy5qcyksIGRlc3NlbiBLZXlzIGZvbGdlbiBkYWhpbnRlciAod2ljaHRpZyBmXHUwMEZDciBkaWVcbiAgLy8gUmVpaGVuZm9sZ2UgZGVyIFNrcmlwdC1TaG9ydGN1dHMpLiBTdGVodCBlaW4gS2V5IGluIEJFSURFTiBCbFx1MDBGNmNrZW4sIGJlaFx1MDBFNGx0XG4gIC8vIGVyIGRpZSBQb3NpdGlvbiBkZXMgVFlQLUZyb250bWF0dGVycywgV2VydCwgRmxvYXRpbmctTWFya2llcnVuZyB1bmRcbiAgLy8gU2hvcnRjdXQga29tbWVuIGFiZXIgdm9tIFN1YnR5cCAtIGVpbmUgWnV3ZWlzdW5nIGF1ZiBlaW5lbiBiZXJlaXRzIHZvcmhhbmRlbmVuXG4gIC8vIE9iamVrdHNjaGxcdTAwRkNzc2VsIFx1MDBGQ2JlcnNjaHJlaWJ0IGlobiwgb2huZSBpaG4genUgdmVyc2NoaWViZW4uIERpZVxuICAvLyBGcm9udG1hdHRlci1Tb3J0aWVydW5nIG11c3MgZGllc2VsYmUgUmVnZWwgdmVyd2VuZGVuLCBzb25zdCB3XHUwMEZDcmRlIHNpZVxuICAvLyBlaW5lIGdlcmFkZSBhbmdlbGVndGUgTm90aXogc29mb3J0IHdpZWRlciB1bXNvcnRpZXJlbiAoc2llaGVcbiAgLy8gb3JkZXJlZERlZmF1bHRLZXlzIGluIGZyb250bWF0dGVyLXNvcnQuanMpLlxuICBnZXRUeXBlRGVmYXVsdHModHlwZSwgeyBpbmNsdWRlRmxvYXRpbmcgPSBmYWxzZSwgZmlsZSwgc3VidHlwZSA9IG51bGwgfSA9IHt9KSB7XG4gICAgY29uc3QgeyBkZWZhdWx0cywgc2hvcnRjdXRzIH0gPSB0aGlzLmNvbGxlY3RCbG9ja3ModHlwZSwgc3VidHlwZSwgaW5jbHVkZUZsb2F0aW5nKTtcbiAgICByZXR1cm4gcmVzb2x2ZVNob3J0Y3V0cyhkZWZhdWx0cywgc2hvcnRjdXRzLCB7IGZpbGUsIGFwcDogdGhpcy5hcHAgfSk7XG4gIH1cblxuICAvLyBHZW1laW5zYW1lIEdydW5kbGFnZSB2b24gZ2V0VHlwZURlZmF1bHRzKCkgdW5kIGdldFR5cGVTaG9ydGN1dHMoKTogZGFzXG4gIC8vIFRZUC1Gcm9udG1hdHRlciBkZXMgVHlwcywgZXJnXHUwMEU0bnp0IHVtIGRlbiBCbG9jayBkZXMgU3VidHlwcy4gRWluIEtleSwgZGVyIGluXG4gIC8vIEJFSURFTiBCbFx1MDBGNmNrZW4gc3RlaHQsIGJlaFx1MDBFNGx0IGRpZSBQb3NpdGlvbiBkZXMgVFlQLUZyb250bWF0dGVyczsgV2VydCxcbiAgLy8gRmxvYXRpbmctTWFya2llcnVuZyBVTkQgU2hvcnRjdXQga29tbWVuIGRhbm4gdm9tIFN1YnR5cCAtIGF1Y2ggXCJrZWluXG4gIC8vIFNob3J0Y3V0XCIgZ2lsdCBkYWJlaSBhbHMgQW5nYWJlIGRlcyBTdWJ0eXBzIHVuZCBoZWJ0IGRlbiBkZXMgVFlQcyBhdWYuXG4gIGNvbGxlY3RCbG9ja3ModHlwZSwgc3VidHlwZSwgaW5jbHVkZUZsb2F0aW5nKSB7XG4gICAgY29uc3QgZGVmYXVsdHMgPSB7fTtcbiAgICBjb25zdCBzaG9ydGN1dHMgPSB7fTtcbiAgICBjb25zdCBpc0Zsb2F0aW5nID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IGFkZEJsb2NrID0gKGZyb250bWF0dGVyLCBmbG9hdGluZ0tleXMsIGJsb2NrU2hvcnRjdXRzKSA9PiB7XG4gICAgICBjb25zdCBhY3R1YWxLZXlzID0gbmV3IE1hcChPYmplY3Qua2V5cyhkZWZhdWx0cykubWFwKChrZXkpID0+IFtrZXkudG9Mb3dlckNhc2UoKSwga2V5XSkpO1xuICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoZnJvbnRtYXR0ZXIgPz8ge30pKSB7XG4gICAgICAgIGlmIChrZXkgPT09IFwiXCIpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCB0YXJnZXQgPSBhY3R1YWxLZXlzLmdldChrZXkudG9Mb3dlckNhc2UoKSkgPz8ga2V5O1xuICAgICAgICBkZWZhdWx0c1t0YXJnZXRdID0gdmFsdWU7XG4gICAgICAgIGlzRmxvYXRpbmcuc2V0KHRhcmdldCwgKGZsb2F0aW5nS2V5cyA/PyBbXSkuaW5jbHVkZXMoa2V5KSk7XG4gICAgICAgIGNvbnN0IHJlY29yZCA9IChibG9ja1Nob3J0Y3V0cyA/PyB7fSlba2V5XTtcbiAgICAgICAgaWYgKHJlY29yZCkgc2hvcnRjdXRzW3RhcmdldF0gPSByZWNvcmQ7XG4gICAgICAgIGVsc2UgZGVsZXRlIHNob3J0Y3V0c1t0YXJnZXRdO1xuICAgICAgfVxuICAgIH07XG4gICAgY29uc3Qgc3VidHlwZURhdGEgPSBzdWJ0eXBlID8gZ2V0U3VidHlwZSh0aGlzLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKSA6IG51bGw7XG4gICAgYWRkQmxvY2soXG4gICAgICB0aGlzLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV0sXG4gICAgICB0aGlzLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV0sXG4gICAgICB0aGlzLnNldHRpbmdzLnR5cGVTaG9ydGN1dHNbdHlwZV1cbiAgICApO1xuICAgIGlmIChzdWJ0eXBlRGF0YSkgYWRkQmxvY2soc3VidHlwZURhdGEuZnJvbnRtYXR0ZXIsIHN1YnR5cGVEYXRhLmZsb2F0aW5nS2V5cywgc3VidHlwZURhdGEuc2hvcnRjdXRzKTtcblxuICAgIGlmICghaW5jbHVkZUZsb2F0aW5nKSB7XG4gICAgICBmb3IgKGNvbnN0IFtrZXksIGZsb2F0aW5nXSBvZiBpc0Zsb2F0aW5nKSB7XG4gICAgICAgIGlmICghZmxvYXRpbmcpIGNvbnRpbnVlO1xuICAgICAgICBkZWxldGUgZGVmYXVsdHNba2V5XTtcbiAgICAgICAgZGVsZXRlIHNob3J0Y3V0c1trZXldO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4geyBkZWZhdWx0cywgc2hvcnRjdXRzIH07XG4gIH1cblxuICAvLyBGXHUwMEZDciBfb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzOiBkaWUgUHJvcGVydGllcyBkaWVzZXMgVFlQcywgZGVyZW5cbiAgLy8gV2VydCBiZWltIEFubGVnZW4gZWluZXIgTm90aXogdm9uIGVpbmVtIFRlbXBsYXRlci1Ta3JpcHQga29tbXQgLVxuICAvLyB7IFtQcm9wZXJ0eV06IHsgbmFtZSwgYXJncywgZmFsbGJhY2sgfSB9LCBpbiBkZXIgUmVpaGVuZm9sZ2UgZGVzXG4gIC8vIFRZUC1Gcm9udG1hdHRlcnMgKGRpZSBTa3JpcHRlIGxhdWZlbiBuYWNoZWluYW5kZXIgdW5kIHNlaGVuIGRpZSBFcmdlYm5pc3NlXG4gIC8vIGRlciBqZXdlaWxzIGZyXHUwMEZDaGVyZW4pLlxuICAvL1xuICAvLyAgIG5hbWUgICAgIFNrcmlwdG5hbWUsIGFsc28gdHAudXNlci48bmFtZT4gLSBvaG5lIFwidHAuXCItUHJcdTAwRTRmaXhcbiAgLy8gICBwYXJhbXMgICBkaWUgaW0gQHR5cC1zaG9ydGN1dC1NYXJrZXIgZGVrbGFyaWVydGUgUGFyYW1ldGVybGlzdGUgZGVzXG4gIC8vICAgICAgICAgICAgU2tyaXB0cyAoc2llaGUgc2hvcnRjdXQtc2NyaXB0cy5qcyksIG9kZXIgbnVsbCBiZWkgZWluZW0gTWFya2VyXG4gIC8vICAgICAgICAgICAgb2huZSBLbGFtbWVybi4gU2llIHN0YW1tdCBhdXMgZGVtIGFrdHVlbGxlbiBTY2FuLCBuaWNodCBhdXMgZGVtXG4gIC8vICAgICAgICAgICAgZ2VzcGVpY2hlcnRlbiBSZWNvcmQgLSBlaW5lIGdlXHUwMEU0bmRlcnRlIERla2xhcmF0aW9uIHdpcmt0IGFsc29cbiAgLy8gICAgICAgICAgICBzb2ZvcnQuIFRZUC5qcyBtYWNodCBkYXJhdXMgbWl0IHJlc29sdmVTaG9ydGN1dEFyZ3MoKSB1bnRlbiBkaWVcbiAgLy8gICAgICAgICAgICBBcmd1bWVudGxpc3RlIGRlcyBBdWZydWZzXG4gIC8vICAgYXJncyAgICAgZGllIGVpbmdldGlwcHRlbiBBcmd1bWVudGUsIGJlbmFubnQgbmFjaCBkZW4gbmljaHQgcmVzZXJ2aWVydGVuXG4gIC8vICAgICAgICAgICAgUGFyYW1ldGVybi4gTGVlcmVzIE9iamVrdCwgd2VubiBrZWluZSBnZXNldHp0IHNpbmQ7IGVpbiBsZWVyXG4gIC8vICAgICAgICAgICAgZ2VsYXNzZW5lcyBGZWxkIGZlaGx0IGRhcmluIGdhbnosIGRhbWl0IFwiYXJncy54ID8/IGZhbGxiYWNrXCJcbiAgLy8gICAgICAgICAgICBpbSBTa3JpcHQgdHJcdTAwRTRndFxuICAvLyAgIGZhbGxiYWNrIGRlciBpbiBkZXIgVFlQLUFuc2ljaHQgaGludGVybGVndGUgZmVzdGUgV2VydCBkZXIgUHJvcGVydHkuIE51clxuICAvLyAgICAgICAgICAgIGFscyBSXHUwMERDQ0tGQUxMIGdlZGFjaHQ6IHNjaGxcdTAwRTRndCBkYXMgU2tyaXB0IGZlaGwgKGZlaGx0IG9kZXJcbiAgLy8gICAgICAgICAgICB3aXJmdCksIHNjaHJlaWJ0IFRZUC5qcyBpaG4gc3RhdHQgZWluZXMgbGVlcmVuIFdlcnRzLiBFaW5cbiAgLy8gICAgICAgICAgICBTa3JpcHQsIGRhcyBiZXd1c3N0IG51bGwvXCJcIiBsaWVmZXJ0ICh6LiBCLiBFU0MgaW0gUGlja2VyKSwgaXN0XG4gIC8vICAgICAgICAgICAga2VpbiBGZWhsc2NobGFnIC0gZG9ydCBibGVpYnQgZGllIFByb3BlcnR5IGxlZXIuXG4gIC8vXG4gIC8vIERpZSBmZXN0ZW4gU2hvcnRjdXRzICh0b2RheS9ub3cvY3JlYXRlZCkgdGF1Y2hlbiBoaWVyIE5JQ0hUIGF1ZjogZGllIGxcdTAwRjZzdFxuICAvLyBkYXMgUGx1Z2luIHNlbGJzdCBhdWYgdW5kIGxpZWZlcnQgc2llIGZlcnRpZyBcdTAwRkNiZXIgZ2V0VHlwZURlZmF1bHRzKCkuIERlc3NlblxuICAvLyBSXHUwMEZDY2tnYWJlIGZcdTAwRkNocnQgZGllIFNrcmlwdC1LZXlzIG1pdCBkZW0gV2VydCBudWxsIC0gS2V5IHVuZCBQb3NpdGlvbiBibGVpYmVuXG4gIC8vIGFsc28gZXJoYWx0ZW4sIG51ciBkZXIgV2VydCBrb21tdCB2b24gaGllci5cbiAgLy9cbiAgLy8gT3B0aW9uZW4gd2llIGJlaSBnZXRUeXBlRGVmYXVsdHMoKTsgaW5jbHVkZUZsb2F0aW5nIHN0YW5kYXJkbVx1MDBFNFx1MDBERmlnIGZhbHNlLFxuICAvLyBkYW1pdCBmXHUwMEZDciBlaW5lIEZsb2F0aW5nIFByb3BlcnR5IG5pY2h0IHVuZ2VmcmFndCBlaW4gU2tyaXB0IGxcdTAwRTR1ZnQuXG4gIGdldFR5cGVTaG9ydGN1dHModHlwZSwgeyBpbmNsdWRlRmxvYXRpbmcgPSBmYWxzZSwgc3VidHlwZSA9IG51bGwgfSA9IHt9KSB7XG4gICAgY29uc3QgeyBkZWZhdWx0cywgc2hvcnRjdXRzIH0gPSB0aGlzLmNvbGxlY3RCbG9ja3ModHlwZSwgc3VidHlwZSwgaW5jbHVkZUZsb2F0aW5nKTtcbiAgICBjb25zdCBza3JpcHRlID0gdGhpcy5nZXRTaG9ydGN1dFNjcmlwdHM/LigpID8/IFtdO1xuICAgIGNvbnN0IHJlc3VsdCA9IHt9O1xuICAgIGZvciAoY29uc3QgW2tleSwgcmVjb3JkXSBvZiBPYmplY3QuZW50cmllcyhzaG9ydGN1dHMpKSB7XG4gICAgICBjb25zdCBuYW1lID0gc2NyaXB0TmFtZU9mKHJlY29yZC5uYW1lKTtcbiAgICAgIGlmIChuYW1lID09PSBudWxsKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IHNrcmlwdCA9IHNrcmlwdGUuZmluZCgocykgPT4gcy5uYW1lID09PSBuYW1lKTtcbiAgICAgIHJlc3VsdFtrZXldID0ge1xuICAgICAgICBuYW1lLFxuICAgICAgICBwYXJhbXM6IHNrcmlwdD8ucGFyYW1zID8/IG51bGwsXG4gICAgICAgIGFyZ3M6IHsgLi4uKHJlY29yZC5hcmdzID8/IHt9KSB9LFxuICAgICAgICBmYWxsYmFjazogZGVmYXVsdHNba2V5XSA/PyBudWxsLFxuICAgICAgfTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIC8vIEZcdTAwRkNyIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanM6IG1hY2h0IGF1cyBkZXIgUGFyYW1ldGVybGlzdGUgZWluZXNcbiAgLy8gU2hvcnRjdXRzIGRpZSBBcmd1bWVudGUgZlx1MDBGQ3IgZGVuIEF1ZnJ1ZiB0cC51c2VyLjxuYW1lPih0cCwgLi4uKSAtIHNpZWhlXG4gIC8vIHJlc29sdmVDYWxsQXJncyBpbiBzaG9ydGN1dHMuanMuIERpZSBBdWZsXHUwMEY2c3VuZyBsZWJ0IGhpZXIgc3RhdHQgaW4gVFlQLmpzLFxuICAvLyBkYW1pdCBkaWUgUmVnZWxuIChyZXNlcnZpZXJ0ZSBOYW1lbiwgUHVua3QtTmFtZW4gZlx1MDBGQ3IgT2JqZWt0LUFyZ3VtZW50ZSkgbnVyXG4gIC8vIGFuIGVpbmVyIFN0ZWxsZSBzdGVoZW47IG5ld0ZpbGUgdW5kIGN0eCBrZW5udCBhbGxlcmRpbmdzIG51ciBUWVAuanMgdW5kXG4gIC8vIHJlaWNodCBzaWUgZGVzaGFsYiBoZXJlaW4uXG4gIHJlc29sdmVTaG9ydGN1dEFyZ3MocGFyYW1zLCBhcmdzLCB7IG5ld0ZpbGUgPSBudWxsLCBjdHggPSBudWxsLCBrZXkgPSBudWxsIH0gPSB7fSkge1xuICAgIHJldHVybiByZXNvbHZlQ2FsbEFyZ3MocGFyYW1zLCBhcmdzLCB7IG5ld0ZpbGUsIGN0eCwga2V5IH0pO1xuICB9XG5cbiAgLy8gRlx1MDBGQ3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qczogcmVnaXN0cmllcnRlIFN1YnR5cGVuIGVpbmVzIFRZUHMgaW5cbiAgLy8gZGVyIFJlaWhlbmZvbGdlIGlocmVyIEJsXHUwMEY2Y2tlLCBzYW10IE5vdGl6LUFuemFobC5cbiAgLy9cbiAgLy8gU3VidHlwZW4gbWl0IGFiZ2VzY2hhbHRldGVtIFwiTWFudWVsbCBlcnN0ZWxsYmFyXCIgKEljb24gbGlua3MgbmViZW4gZGVtXG4gIC8vIE5hbWVuIGlocmVzIEJsb2Nrcywgc2llaGUgcmVuZGVyU3VidHlwZU1hbnVhbFRvZ2dsZSBpbiB0eXAtdmlldy5qcykgYmxlaWJlblxuICAvLyB3aWUgZGllIHNvIGFiZ2VzY2hhbHRldGVuIFRZUGVuIGluIGdldFR5cGVzKCkgYXVcdTAwREZlbiB2b3IgLSBhdVx1MDBERmVyXG4gIC8vIGluY2x1ZGVNYW51YWxPZmYgaXN0IGdlc2V0enQuXG4gIGdldFN1YnR5cGVzKHR5cGUsIHsgaW5jbHVkZU1hbnVhbE9mZiA9IGZhbHNlIH0gPSB7fSkge1xuICAgIGNvbnN0IHsgY291bnRzIH0gPSB0aGlzLnR5cEluZGV4LnN1YnR5cGVCdWNrZXQodHlwZSk7XG4gICAgcmV0dXJuIGdldFN1YnR5cGVOYW1lcyh0aGlzLnNldHRpbmdzLCB0eXBlKVxuICAgICAgLmZpbHRlcigoc3VidHlwZSkgPT4gaW5jbHVkZU1hbnVhbE9mZiB8fCBpc1N1YnR5cGVNYW51YWwodGhpcy5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSkpXG4gICAgICAubWFwKChzdWJ0eXBlKSA9PiAoeyBzdWJ0eXBlLCBjb3VudDogY291bnRzLmdldChzdWJ0eXBlKSA/PyAwIH0pKTtcbiAgfVxuXG4gIC8vIEZcdTAwRkNyIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanM6IFN1YnR5cC1QaWNrZXIgKHNpZWhlXG4gIC8vIHR5cGUtcGlja2VyLmpzKS4gTFx1MDBGNnN0IG1pdCBkZW0gZ2V3XHUwMEU0aGx0ZW4gU3VidHlwIGF1ZiwgbWl0IFwiXCIgZlx1MDBGQ3IgXCJLZWluXG4gIC8vIFN1YnR5cFwiIChiencuIG9obmUgUGlja2VyLCB3ZW5uIGRlciBUWVAga2VpbmUgU3VidHlwZW4gaGF0KSwgb2RlciBtaXRcbiAgLy8gbnVsbCBiZWkgRVNDIChUWVAuanMga2VocnQgZGFubiB6dXIgVFlQLUF1c3dhaGwgenVyXHUwMEZDY2spLiBxdWVyeSAob3B0aW9uYWwpOlxuICAvLyBlaW5lIHNjaG9uIGdldGlwcHRlIFN1Y2hhbmZyYWdlLCBuYWNoIGRlciBkaWUgTGlzdGUgdm9yc29ydGllcnQgc3RlaHQuXG4gIC8vIG9wdGlvbnMgd2llIGJlaSBnZXRTdWJ0eXBlcyAoaW5jbHVkZU1hbnVhbE9mZikuXG4gIHBpY2tTdWJ0eXBlKHR5cGUsIHF1ZXJ5ID0gXCJcIiwgb3B0aW9ucyA9IHt9KSB7XG4gICAgcmV0dXJuIHBpY2tTdWJ0eXBlTW9kYWwodGhpcy5hcHAsIHRoaXMsIHR5cGUsIHF1ZXJ5LCBvcHRpb25zKTtcbiAgfVxuXG4gIC8vIEZcdTAwRkNyIF9vYnNpZGlhbi90ZW1wbGF0ZXItc2NyaXB0cy9UWVAuanMsIGlubmVyaGFsYiB2b24gcHJvY2Vzc0Zyb250TWF0dGVyOlxuICAvLyBzZXR6dCBUWVAgdW5kIFNVQlRZUCBpbiBlaW5oZWl0bGljaGVyIFNjaHJlaWJ3ZWlzZSAtIGVpbmUgYWJ3ZWljaGVuZFxuICAvLyBnZXNjaHJpZWJlbmUgUHJvcGVydHkgKFwidHlwXCIsIFwiU3VidHlwXCIpIHdpcmQgYW4gaWhyZXIgU3RlbGxlIHVtYmVuYW5udFxuICAvLyBzdGF0dCB2ZXJkb3BwZWx0LiBzdWJ0eXBlIG51bGwgZW50ZmVybnQgZWluZW4gdm9yaGFuZGVuZW4gU1VCVFlQLlxuICBhcHBseVR5cGVQcm9wZXJ0aWVzKGZyb250bWF0dGVyLCB0eXBlLCBzdWJ0eXBlKSB7XG4gICAgc2V0Q2Fub25pY2FsUHJvcGVydHkoZnJvbnRtYXR0ZXIsIFRZUF9QUk9QRVJUWSwgdHlwZSk7XG4gICAgaWYgKHN1YnR5cGUpIHNldENhbm9uaWNhbFByb3BlcnR5KGZyb250bWF0dGVyLCBTVUJUWVBfUFJPUEVSVFksIHN1YnR5cGUpO1xuICAgIGVsc2UgZGVsZXRlUHJvcGVydHkoZnJvbnRtYXR0ZXIsIFNVQlRZUF9QUk9QRVJUWSk7XG4gIH1cblxuICAvLyBGXHUwMEZDciBfb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzLCBpbm5lcmhhbGIgdm9uIHByb2Nlc3NGcm9udE1hdHRlclxuICAvLyB1bmQgbmFjaCBhbGxlbiBcdTAwRkNicmlnZW4gXHUwMEM0bmRlcnVuZ2VuOiBicmluZ3QgZGFzIEZyb250bWF0dGVyIGluIGRpZVxuICAvLyBSZWloZW5mb2xnZSBkZXIgRnJvbnRtYXR0ZXItU29ydGllcnVuZyAoZ2xvYmFsZSBSZWloZW5mb2xnZSwgVFlQLVxuICAvLyBGcm9udG1hdHRlciBzYW10IFN1YnR5cC1CbG9jaykgLSBzb25zdCBsYW5kZW4gbmV1IGVyZ1x1MDBFNG56dGUgUHJvcGVydGllc1xuICAvLyAoei4gQi4gU1VCVFlQIGluIGVpbmVyIGJlc3RlaGVuZGVuIE5vdGl6KSBhbSBFbmRlLlxuICBzb3J0RnJvbnRtYXR0ZXIoZnJvbnRtYXR0ZXIsIHR5cGUsIHN1YnR5cGUgPSBudWxsKSB7XG4gICAgcmV0dXJuIHNvcnRGcm9udG1hdHRlckZvcih0aGlzLCBmcm9udG1hdHRlciwgdHlwZSwgc3VidHlwZSk7XG4gIH1cblxuICAvLyBJbm5lcmhhbGIgdm9uIHByb2Nlc3NGcm9udE1hdHRlcjogc2V0enQgbnVyIGRpZSBQcm9wZXJ0eSBrZXkgYW4gaWhyZW5cbiAgLy8gUGxhdHogbGF1dCBGcm9udG1hdHRlci1Tb3J0aWVydW5nIChUWVAvU1VCVFlQIGF1cyBkZW0gT2JqZWt0IHNlbGJzdCksXG4gIC8vIGFsbGVzIFx1MDBEQ2JyaWdlIGJsZWlidCwgd2llIGVzIGlzdCAtIHouIEIuIGZcdTAwRkNyIEZyZWRzIFByb3BlcnR5LUJhY2tsaW5raW5nLFxuICAvLyBkYW1pdCBlaW5lIG5ldSBhbmdlbGVndGUgUHJvcGVydHkgbmljaHQgYW0gRW5kZSBsYW5kZXQuXG4gIHBsYWNlUHJvcGVydHkoZnJvbnRtYXR0ZXIsIGtleSkge1xuICAgIHJldHVybiBwbGFjZVByb3BlcnR5Rm9yKHRoaXMsIGZyb250bWF0dGVyLCBrZXkpO1xuICB9XG5cbiAgLy8gRlx1MDBGQ3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qczogZGllIGltIFRZUC1WaWV3IHJlZ2lzdHJpZXJ0ZW4gVFlQZW5cbiAgLy8gc2FtdCBpaHJlciBkb3J0IGdlcGZsZWd0ZW4gQmVzY2hyZWlidW5nLCBzdGF0dCBzaWUgYXVzIF9vYnNpZGlhbi9UeXBlbi5tZCB6dSBwYXJzZW4gLVxuICAvLyBpbiBkZXJzZWxiZW4gUmVpaGVuZm9sZ2UsIGluIGRlciBzaWUgYXVjaCBpbiBkZXIgVFlQLUxpc3RlIHNlbGJzdCBlcnNjaGVpbmVuXG4gIC8vIChha3R1ZWxsZSBTb3J0aWVyZWluc3RlbGx1bmcgZG9ydCwgei4gQi4gSFx1MDBFNHVmaWdrZWl0IG9kZXIgTmFtZSkuXG4gIC8vXG4gIC8vIFRZUGVuIG1pdCBhYmdlc2NoYWx0ZXRlbSBcIk1hbnVlbGwgZXJzdGVsbGJhclwiIChJY29uIGluIGRlciBUWVAtRGV0YWlsYW5zaWNodClcbiAgLy8gc2luZCBuaWNodCBmXHUwMEZDciBkaWUgbWFudWVsbGUgQXVzd2FobCBnZWRhY2h0ICh6LiBCLiBiZWltIEFubGVnZW4gZWluZXIgbmV1ZW5cbiAgLy8gTm90aXopIHVuZCB3ZXJkZW4gZGVzaGFsYiBzdGFuZGFyZG1cdTAwRTRcdTAwREZpZyBhdXNnZWtsYW1tZXJ0IC0gQXVmcnVmZXIsIGRpZVxuICAvLyB0cm90emRlbSBhbGxlIFRZUGVuIGJyYXVjaGVuLCBcdTAwRkNiZXJnZWJlbiBpbmNsdWRlTWFudWFsT2ZmOiB0cnVlLlxuICBnZXRUeXBlcyh7IGluY2x1ZGVNYW51YWxPZmYgPSBmYWxzZSB9ID0ge30pIHtcbiAgICBjb25zdCB7IGNvdW50cyB9ID0gdGhpcy50eXBJbmRleC50eXBlQ291bnRzKCk7XG4gICAgY29uc3Qgc29ydE9yZGVyID0gdGhpcy5zZXR0aW5ncy50eXBTb3J0T3JkZXIgPz8gREVGQVVMVF9TT1JUX09SREVSO1xuICAgIHJldHVybiBzb3J0VHlwZXNCeU1vZGUodGhpcy5zZXR0aW5ncy50eXBlcywgc29ydE9yZGVyLCBjb3VudHMsIHRoaXMuc2V0dGluZ3MudHlwZUNvbG9ycylcbiAgICAgIC5maWx0ZXIoKHR5cGUpID0+IGluY2x1ZGVNYW51YWxPZmYgfHwgKHRoaXMuc2V0dGluZ3MudHlwZU1hbnVhbCA/PyB7fSlbdHlwZV0gIT09IGZhbHNlKVxuICAgICAgLm1hcCgodHlwZSkgPT4gKHtcbiAgICAgICAgdHlwZSxcbiAgICAgICAgZGVzY3JpcHRpb246IHRoaXMuc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXSA/PyBcIlwiLFxuICAgICAgICBjb3VudDogY291bnRzLmdldCh0eXBlKSA/PyAwLFxuICAgICAgfSkpO1xuICB9XG5cbiAgLy8gRlx1MDBGQ3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qczogbmF0aXZlciBUWVAtUGlja2VyIChzaWVoZVxuICAvLyB0eXBlLXBpY2tlci5qcykgc3RhdHQgZGVyIHJlaW5lbiBUZXh0LUxpc3RlIGF1cyBnZXRUeXBlcygpICtcbiAgLy8gdHAuc3lzdGVtLnN1Z2dlc3RlciAtIG1pdCBUWVAtRmFyYmUvLVB1bmt0LCBCZXNjaHJlaWJ1bmcgdW5kIE5vdGl6LUFuemFobFxuICAvLyBqZSBaZWlsZS4gaW5jbHVkZU1hbnVhbE9mZiB3aWUgYmVpIGdldFR5cGVzKCkuIExcdTAwRjZzdCBtaXQgZGVtIGdld1x1MDBFNGhsdGVuIFRZUFxuICAvLyBhdWYsIG9kZXIgbWl0IG51bGwgYmVpIEFiYnJ1Y2ggKEVTQykuXG4gIHBpY2tUeXBlKG9wdGlvbnMpIHtcbiAgICByZXR1cm4gcGlja1R5cGVNb2RhbCh0aGlzLmFwcCwgdGhpcywgb3B0aW9ucyk7XG4gIH1cblxuICAvLyBGXHUwMEZDciBfb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzOiBUWVAgdW5kIFN1YnR5cCBpbiBlaW5lbSBadWcgKHNpZWhlXG4gIC8vIHR5cGUtcGlja2VyLmpzKSAtIGplIG5hY2ggRWluc3RlbGx1bmcgXCJTdWJ0eXAtUGlja2VyIHNlcGFyYXRcIiBlaW4gZWluemlnZXJcbiAgLy8gUGlja2VyIG1pdCBlaW5nZXJcdTAwRkNja3RlbiBTdWJ0eXBlbiBvZGVyIGJlaWRlIFBpY2tlciBuYWNoZWluYW5kZXIuIE9wdGlvbmVuXG4gIC8vIHdpZSBiZWkgcGlja1R5cGUoKS4gTFx1MDBGNnN0IG1pdCB7IHR5cGUsIHN1YnR5cGUgfSBhdWYgKHN1YnR5cGUgbnVsbCBmXHUwMEZDciBcIm9obmVcbiAgLy8gU3VidHlwXCIpLCBvZGVyIG1pdCBudWxsIGJlaSBBYmJydWNoIChFU0MpLlxuICBwaWNrVHlwZUFuZFN1YnR5cGUob3B0aW9ucykge1xuICAgIHJldHVybiBwaWNrVHlwZUFuZFN1YnR5cGVNb2RhbCh0aGlzLmFwcCwgdGhpcywgb3B0aW9ucyk7XG4gIH1cblxuICBhc3luYyBsb2FkU2V0dGluZ3MoKSB7XG4gICAgY29uc3Qgc3RvcmVkID0gYXdhaXQgdGhpcy5sb2FkRGF0YSgpO1xuICAgIHRoaXMuc2V0dGluZ3MgPSBPYmplY3QuYXNzaWduKHt9LCBERUZBVUxUX1NFVFRJTkdTLCBzdG9yZWQpO1xuICAgIC8vIE9iamVjdC5hc3NpZ24gZXJzZXR6dCB2ZXJzY2hhY2h0ZWx0ZSBPYmpla3RlIGFscyBHYW56ZXMgLSBzcFx1MDBFNHRlclxuICAgIC8vIGhpbnp1Z2Vrb21tZW5lIEFuc2ljaHRlbiAoei4gQi4gY29sb3JWaWV3cy5saW5rcykgZmVobHRlbiBpbiBiZXJlaXRzXG4gICAgLy8gZ2VzcGVpY2hlcnRlbiBFaW5zdGVsbHVuZ2VuIHNvbnN0IHVuZCB3XHUwMEU0cmVuIHN0aWxsc2Nod2VpZ2VuZCBhdXMuXG4gICAgdGhpcy5zZXR0aW5ncy5jb2xvclZpZXdzID0geyAuLi5ERUZBVUxUX1NFVFRJTkdTLmNvbG9yVmlld3MsIC4uLnRoaXMuc2V0dGluZ3MuY29sb3JWaWV3cyB9O1xuICAgIC8vIE1pZ3JpZXJ0IEJlc3RhbmRzaW5zdGFsbGF0aW9uZW4sIGRlcmVuIGdsb2JhbFByb3BlcnR5T3JkZXIgbm9jaCBhdXMgZGVyXG4gICAgLy8gWmVpdCB2b3IgXCJUWVAgYWxzIExpc3RlbmVpbnRyYWdcIiBzdGFtbXQgKHNpZWhlIGZyb250bWF0dGVyLXNvcnQuanMpLlxuICAgIHRoaXMuc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlciA9IG5vcm1hbGl6ZUdsb2JhbE9yZGVyKHRoaXMuc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcik7XG4gICAgbWlncmF0ZUZsb2F0aW5nRnJvbnRtYXR0ZXIodGhpcy5zZXR0aW5ncyk7XG4gICAgLy8gU3VidHlwLUJsXHUwMEY2Y2tlIGxhZ2VuIGZyXHUwMEZDaGVyIHdhaGx3ZWlzZSBcdTAwRkNiZXIgZGVtIFRZUC1Gcm9udG1hdHRlcjsgZGFzIHN0ZWh0XG4gICAgLy8gamV0enQgZmVzdCBnYW56IG9iZW4gKHNpZWhlIGdldFNlY3Rpb25PcmRlciBpbiBzdWJ0eXBlcy5qcykuXG4gICAgbWlncmF0ZUFib3ZlU3RhbmRhcmQodGhpcy5zZXR0aW5ncyk7XG4gICAgLy8gQW5kZXJzIGFscyBkaWUgXHUwMEZDYnJpZ2VuIE1pZ3JhdGlvbmVuIGdsZWljaCBzY2hyZWliZW46IGRpZSBlaW5lIHJlY2huZXRcbiAgICAvLyBnZXNwZWljaGVydGUgWmFobGVuIHVtIHVuZCBkYXJmIGRhcyBiZWltIG5cdTAwRTRjaHN0ZW4gU3RhcnQgbmljaHQgZXJuZXV0IHR1bixcbiAgICAvLyBkaWUgYW5kZXJlIGVudGZlcm50IGVpbmVuIFNjaGxcdTAwRkNzc2VsLCBkZXIgc29uc3QgYmVpIGplZGVtIFN0YXJ0IHdpZWRlclxuICAgIC8vIGdlbGVzZW4gd1x1MDBGQ3JkZSAtIHVuZCBkaWUgbGV0enRlIGVyZ1x1MDBFNG56dCBTY2hhbHRlciwgZGllIGRlciBOdXR6ZXIgdm9uIGRhIGFuXG4gICAgLy8gc2VsYnN0IHVtc3RlbGxlbiBrYW5uIHVuZCBkaWUgaWhtIGJlaW0gblx1MDBFNGNoc3RlbiBTdGFydCBuaWNodCBlcm5ldXRcbiAgICAvLyBcdTAwRkNiZXJzY2hyaWViZW4gd2VyZGVuIGRcdTAwRkNyZmVuLlxuICAgIGNvbnN0IG1pZ3JhdGVkID0gW1xuICAgICAgbWlncmF0ZVN1YnR5cGVDb2xvclNjYWxlKHRoaXMuc2V0dGluZ3MsIERFRkFVTFRfU1VCVFlQRV9DT0xPUl9SQU5HRVMpLFxuICAgICAgbWlncmF0ZVR5cExpc3RTZWNvbmRhcnkodGhpcy5zZXR0aW5ncywgc3RvcmVkKSxcbiAgICAgIGRyb3BUeXBMaXN0U3VidHlwZXNBbGlnbih0aGlzLnNldHRpbmdzKSxcbiAgICAgIG1pZ3JhdGVTdWJ0eXBlTWFudWFsKHRoaXMuc2V0dGluZ3MpLFxuICAgIF07XG4gICAgaWYgKG1pZ3JhdGVkLnNvbWUoQm9vbGVhbikpIGF3YWl0IHRoaXMuc2F2ZVNldHRpbmdzKCk7XG4gIH1cblxuICBhc3luYyBzYXZlU2V0dGluZ3MoKSB7XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcbiAgfVxufTtcbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7OztBQUFBO0FBQUEscUJBQUFBLFVB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QUFLLFFBQVE7QUFBQSxJQUNwQztBQUNBLFFBQUksU0FBUyxLQUFLLE9BQU8sRUFBRyxPQUFNLEtBQUssYUFBYTtBQUFBLEVBQ3REO0FBQUEsRUFFQSxNQUFNLGVBQWU7QUFDbkIsVUFBTSxLQUFLLFNBQVMsS0FBSyxRQUFRO0FBQUEsRUFDbkM7QUFDRjsiLAogICJuYW1lcyI6IFsiZXhwb3J0cyIsICJtb2R1bGUiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJzZXRDYW5vbmljYWxQcm9wZXJ0eSIsICJkZWxldGVQcm9wZXJ0eSIsICJUeXBJbmRleCIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJzZXRDYW5vbmljYWxQcm9wZXJ0eSIsICJTVUJUWVBfUFJPUEVSVFkiLCAiZ2V0U3VidHlwZU5hbWVzIiwgImdldFN1YnR5cGUiLCAiaXNTdWJ0eXBlTWFudWFsIiwgIm1pZ3JhdGVTdWJ0eXBlTWFudWFsIiwgIm1pZ3JhdGVBYm92ZVN0YW5kYXJkIiwgIm1pZ3JhdGVTdWJ0eXBlQ29sb3JTY2FsZSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXBlIiwgIlRZUF9QUk9QRVJUWSIsICJTVUJUWVBfUFJPUEVSVFkiLCAibm9ybWFsaXplR2xvYmFsT3JkZXIiLCAic29ydEZyb250bWF0dGVyRm9yIiwgInBsYWNlUHJvcGVydHlGb3IiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXBlIiwgIkRFRkFVTFRfU1VCVFlQRV9DT0xPUl9SQU5HRVMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiREVGQVVMVF9TVUJUWVBFX0NPTE9SX1JBTkdFUyIsICJERUZBVUxUX1NFVFRJTkdTIiwgIlR5cFN5c3RlbVNldHRpbmdUYWIiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJDb21tYW5kcyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJzY3JpcHROYW1lT2YiLCAicmVzb2x2ZUNhbGxBcmdzIiwgInJlc29sdmVTaG9ydGN1dHMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZ2V0U3VidHlwZSIsICJUWVBfUFJPUEVSVFkiLCAiU1VCVFlQX1BST1BFUlRZIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInNvcnRUeXBlc0J5TW9kZSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXBlTmFtZXMiLCAiZ2V0U3VidHlwZSIsICJpc1N1YnR5cGVNYW51YWwiLCAic29ydFR5cGVzQnlNb2RlIiwgInNldENhbm9uaWNhbFByb3BlcnR5IiwgIlRZUF9QUk9QRVJUWSIsICJTVUJUWVBfUFJPUEVSVFkiLCAiREVGQVVMVF9TT1JUX09SREVSIiwgInJlZ2lzdGVyVHlwVmlldyIsICJsZWFmIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyRmlsZUV4cGxvcmVyQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyR3JhcGhDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJTZWFyY2hDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJSZWNlbnRGaWxlc0NvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlckJhY2tsaW5rQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyQm9va21hcmtzQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImdldFN1YnR5cGUiLCAicmVnaXN0ZXJBY3RpdmVUaXRsZUNvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlckxpbmtDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZ2V0U3VidHlwZU5hbWVzIiwgImdldFN1YnR5cGUiLCAiVFlQX1BST1BFUlRZIiwgImZsb2F0aW5nIiwgInJlZ2lzdGVyRnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0IiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImdldFN1YnR5cGVOYW1lcyIsICJUWVBfUFJPUEVSVFkiLCAiU1VCVFlQX1BST1BFUlRZIiwgInJlZ2lzdGVyUHJvcGVydHlSZW5hbWVTeW5jIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgIkRFRkFVTFRfU09SVF9PUkRFUiIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlclNob3J0Y3V0U2NyaXB0cyJdCn0K
