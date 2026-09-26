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
      if (!byName[subtype]) byName[subtype] = { frontmatter: {}, floatingKeys: [] };
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
    function enforceUniqueKeys2(settings, type) {
      const seen = new Set(Object.keys(settings.typeDefaultFrontmatter[type] ?? {}).map((key) => key.toLowerCase()));
      let changed = false;
      for (const subtype of getSubtypeNames2(settings, type)) {
        const data = settings.typeSubtypes[type][subtype];
        for (const key of Object.keys(data.frontmatter)) {
          if (key === "") continue;
          const lower = key.toLowerCase();
          if (seen.has(lower)) {
            delete data.frontmatter[key];
            data.floatingKeys = data.floatingKeys.filter((k) => k !== key);
            changed = true;
          } else {
            seen.add(lower);
          }
        }
      }
      return changed;
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
        }
      }
      delete settings.typeSubtypes[source];
      enforceUniqueKeys2(settings, target);
    }
    function renameSubtype(settings, type, oldName, newName) {
      const byName = settings.typeSubtypes?.[type];
      if (!byName?.[oldName] || oldName === newName) return;
      settings.typeSubtypes[type] = Object.fromEntries(
        Object.entries(byName).map(([name, data]) => [name === oldName ? newName : name, data])
      );
    }
    function getSectionOrder(settings, type) {
      const names = getSubtypeNames2(settings, type);
      const above = names.filter((name) => settings.typeSubtypes[type][name].aboveStandard);
      return [...above, null, ...names.filter((name) => !above.includes(name))];
    }
    function reorderSubtypes(settings, type, order) {
      const byName = settings.typeSubtypes?.[type];
      if (!byName) return;
      const standardIndex = order.indexOf(null);
      const names = order.filter((name) => name !== null && byName[name]);
      const ordered = [...names, ...Object.keys(byName).filter((name) => !names.includes(name))];
      for (const name of ordered) {
        if (standardIndex !== -1 && order.indexOf(name) !== -1 && order.indexOf(name) < standardIndex) byName[name].aboveStandard = true;
        else delete byName[name].aboveStandard;
      }
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
      Object.assign(targetData.frontmatter, sourceData.frontmatter);
      targetData.floatingKeys.push(...sourceData.floatingKeys.filter((key) => !targetData.floatingKeys.includes(key)));
      deleteSubtype(settings, type, source);
      enforceUniqueKeys2(settings, type);
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
      getSubtypeNames: getSubtypeNames2,
      getSubtype: getSubtype2,
      ensureSubtype,
      enforceUniqueKeys: enforceUniqueKeys2,
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
      if (subtypeData?.aboveStandard) blocks.reverse();
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

// src/settings.js
var require_settings = __commonJS({
  "src/settings.js"(exports2, module2) {
    var { PluginSettingTab, SettingGroup, ToggleComponent } = require("obsidian");
    var { mountGlobalOrderEditor } = require_frontmatter_order_editor();
    var { DEFAULT_GLOBAL_ORDER } = require_frontmatter_sort();
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
      // Nur relevant bei noteTitleStyle: "badge" - "title" (neben dem Inline-Titel,
      // normale Ausrichtung) oder "block" (links am Property-Block, um 90° gedreht).
      noteTitleBadgePosition: "title",
      // Nur relevant bei noteTitleBadgePosition: "block" - ob die gedrehte Box am
      // oberen oder unteren Rand des Property-Blocks sitzt.
      noteTitleVerticalAlign: "top",
      typSortOrder: "count-desc",
      typListDescriptionEnabled: true,
      // Siehe pickTypeAndSubtype in type-picker.js: false = Subtypen eingerückt
      // direkt im TYP-Picker, true = eigener Subtyp-Picker nach der TYP-Auswahl.
      separateSubtypePicker: false,
      includeIgnoredFiles: false,
      graphTagColorEnabled: false,
      graphTagColor: "",
      graphAttachmentColorEnabled: false,
      graphAttachmentColor: "",
      colorViews: {
        fileExplorer: true,
        graph: true,
        search: true,
        recentFiles: true,
        backlinks: true,
        bookmarks: true,
        frontmatterDefaults: true,
        // Unter-Schalter zu frontmatterDefaults bzw. allProperties: bezieht die
        // Frontmatter-Blöcke der Subtypen mit ein (siehe
        // frontmatter-default-highlight.js).
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
          (setting) => setting.setName("Beschreibungs-Textfeld anzeigen").setDesc("Zeigt in der TYP-Liste neben jedem registrierten TYP ein Textfeld zur Bearbeitung seiner Beschreibung.").addToggle(
            (toggle) => toggle.setValue(this.plugin.settings.typListDescriptionEnabled).onChange(async (value) => {
              this.plugin.settings.typListDescriptionEnabled = value;
              await this.plugin.saveSettings();
              this.plugin.refreshTypColors?.();
            })
          )
        ).addSetting(
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
            "Beim Anlegen einer Notiz folgt auf den TYP-Picker ein eigener Subtyp-Picker (ESC dort f\xFChrt zur\xFCck zur TYP-Auswahl), statt die Subtypen direkt einger\xFCckt unter ihrem TYP im TYP-Picker anzuzeigen."
          ).addToggle(
            (toggle) => toggle.setValue(this.plugin.settings.separateSubtypePicker).onChange(async (value) => {
              this.plugin.settings.separateSubtypePicker = value;
              await this.plugin.saveSettings();
            })
          )
        );
        const colorViewToggle = (group, key, name, desc, subtypKey = null) => group.addSetting((setting) => {
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
          addRow("TYP", "Standard-Frontmatter der TYPen", key, () => this.display());
          if (this.plugin.settings.colorViews[key]) {
            addRow("Subtyp", "Frontmatter-Bl\xF6cke der Subtypen mit einbeziehen", subtypKey);
          }
        });
        const coloringGroup = new SettingGroup(containerEl).setHeading("Einf\xE4rbung");
        colorViewToggle(coloringGroup, "fileExplorer", "Datei-Explorer", "Notiznamen im Datei-Explorer nach TYP einf\xE4rben.");
        colorViewToggle(coloringGroup, "graph", "Graph", "Knoten im Graph (global und lokal) nach TYP einf\xE4rben.");
        colorViewToggle(coloringGroup, "search", "Suche", "Treffer-Titel in der Suche nach TYP einf\xE4rben.");
        colorViewToggle(coloringGroup, "recentFiles", "Recent Files", "Eintr\xE4ge im Recent-Files-Plugin nach TYP einf\xE4rben.");
        colorViewToggle(
          coloringGroup,
          "links",
          "Links in Notizen",
          "Interne Links im Notiztext (Lese-Modus, Live Preview, Hover-Vorschau) in der Farbe des TYPs ihres Ziels darstellen. Nicht aufgel\xF6ste Links bleiben unver\xE4ndert."
        );
        colorViewToggle(coloringGroup, "typList", "TYP View", "Typ-Namen in der TYP-View selbst (Liste und Detailansicht) in ihrer jeweiligen Farbe darstellen.");
        colorViewToggle(
          coloringGroup,
          "noteTitleColor",
          "Titel-Text einf\xE4rben",
          "F\xE4rbt den Inline-Titel der ge\xF6ffneten Notiz selbst in der Farbe ihres TYPs ein - unabh\xE4ngig von der TYP-Markierung daneben (s. u.), beides l\xE4sst sich kombinieren."
        );
        const isBadge = this.plugin.settings.noteTitleStyle === "badge";
        const isBlockPosition = this.plugin.settings.noteTitleBadgePosition === "block";
        coloringGroup.addSetting((noteTitleSetting) => {
          noteTitleSetting.setName("TYP-Markierung in der Notiz").setDesc(
            isBadge ? '"Box mit TYP-Namen" - Schalter: farbig/neutral, am Titel/am Property-Block (gedreht)' + (isBlockPosition ? ", oben/unten am Property-Block" : "") + "." : "Wie der TYP in der ge\xF6ffneten Notiz markiert wird."
          ).addDropdown(
            (dropdown) => dropdown.addOption("none", "Nichts").addOption("dot", "Farbpunkt am Titel").addOption("badge", "Box mit TYP-Namen").setValue(this.plugin.settings.noteTitleStyle).onChange(async (value) => {
              this.plugin.settings.noteTitleStyle = value;
              await this.plugin.saveSettings();
              this.plugin.refreshTypColors?.();
              this.display();
            })
          );
          if (!isBadge) return;
          noteTitleSetting.settingEl.addClass("fred-note-title-setting");
          const addLabeledToggle = (label, tooltip, value, onChange) => {
            const row = noteTitleSetting.controlEl.createDiv({ cls: "fred-note-title-toggle-row" });
            row.createSpan({ cls: "fred-note-title-toggle-label", text: label });
            new ToggleComponent(row).setTooltip(tooltip).setValue(value).onChange(onChange);
          };
          addLabeledToggle("Farbig", "Farbig (TYP-Farbe) statt neutral", this.plugin.settings.noteTitleBadgeColored, async (value) => {
            this.plugin.settings.noteTitleBadgeColored = value;
            await this.plugin.saveSettings();
            this.plugin.refreshTypColors?.();
          });
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
          "Trefferzeilen im Backlinks-Pane sowie in den im Dokument eingebetteten Backlinks (inkl. nicht verlinkter Erw\xE4hnungen) nach TYP einf\xE4rben."
        );
        colorViewToggle(
          coloringGroup,
          "bookmarks",
          "Bookmarks",
          "Eintr\xE4ge im Bookmarks-Pane, die direkt auf eine Notiz zeigen, nach TYP einf\xE4rben."
        );
        colorViewToggle(
          coloringGroup,
          "allProperties",
          "All Properties",
          'In Obsidians vault-weiter "All Properties"-Ansicht Property-Namen einf\xE4rben, die im Standard-Frontmatter genau eines TYPs vorkommen (in dessen Farbe) - kommen sie bei mehreren TYPs vor, stattdessen fett statt eingef\xE4rbt. Mit "Subtyp" z\xE4hlen auch die Frontmatter-Bl\xF6cke der Subtypen f\xFCr ihren jeweiligen TYP.',
          "allPropertiesSubtyp"
        );
        const graphGroup = new SettingGroup(containerEl).setHeading("Graph");
        const graphColorSetting = (enabledKey, colorKey, defaultColor, name, desc) => graphGroup.addSetting(
          (setting) => setting.setName(name).setDesc(desc).addToggle(
            (toggle) => toggle.setValue(this.plugin.settings[enabledKey]).onChange(async (value) => {
              this.plugin.settings[enabledKey] = value;
              await this.plugin.saveSettings();
              this.plugin.refreshTypColors?.();
            })
          ).addColorPicker(
            (picker) => picker.setValue(this.plugin.settings[colorKey] || defaultColor).onChange(async (value) => {
              this.plugin.settings[colorKey] = value;
              await this.plugin.saveSettings();
              this.plugin.refreshTypColors?.();
            })
          ).addExtraButton(
            (button) => button.setIcon("rotate-ccw").setTooltip("Zur\xFCcksetzen auf Standardfarbe").onClick(async () => {
              this.plugin.settings[colorKey] = "";
              await this.plugin.saveSettings();
              this.plugin.refreshTypColors?.();
              this.display();
            })
          )
        );
        graphColorSetting(
          "graphTagColorEnabled",
          "graphTagColor",
          "#888888",
          "Tag-Farbe",
          "Eigene Farbe f\xFCr Tag-Knoten im Graph (global und lokal) verwenden statt der Standardfarbe. Eigene Farbgruppen im Graph haben weiterhin Vorrang."
        );
        graphColorSetting(
          "graphAttachmentColorEnabled",
          "graphAttachmentColor",
          "#e0ac00",
          "Anh\xE4nge-Farbe",
          "Eigene Farbe f\xFCr Anhang-Knoten (Nicht-Markdown-Dateien wie Bilder oder PDFs) im Graph verwenden statt der Standardfarbe."
        );
        const frontmatterGroup = new SettingGroup(containerEl).setHeading("Standard-Frontmatter");
        colorViewToggle(
          frontmatterGroup,
          "frontmatterDefaults",
          "Property-Namen fett markieren",
          'In Notizen (Frontmatter im Dokument sowie Properties-Seitenleiste) die Namen der Properties fett darstellen, die im Standard-Frontmatter des jeweiligen TYPs hinterlegt sind. Mit "Subtyp" zus\xE4tzlich die aus dem Frontmatter-Block ihres SUBTYPs.',
          "frontmatterDefaultsSubtyp"
        );
        frontmatterGroup.addSetting((setting) => {
          setting.settingEl.addClass("fred-order-setting");
          mountGlobalOrderEditor(setting.infoEl, this.plugin);
          setting.infoEl.createDiv({
            cls: "setting-item-description",
            text: 'Bestimmt die Reihenfolge, in der die Befehle "Frontmatter Sortierung aktualisieren" die in einer Notiz vorhandenen Properties anordnen (erg\xE4nzt oder \xE4ndert keine Werte). Einzelne Properties (z. B. cssclasses, aliases) lassen sich fest platzieren - "TYP" ist die TYP-Property selbst, "SUBTYP" analog die SUBTYP-Property, "TYP-Frontmatter" steht f\xFCr die Standard-Frontmatter-Liste des jeweiligen Typs samt dahinter dem Block seines SUBTYPs, "Sonstige Properties" f\xFCr alles \xDCbrige. Reihenfolge per Drag & Drop \xE4nderbar, die vier Platzhalter-Zeilen lassen sich nicht entfernen.'
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
        name: "TYP - Frontmatter Sortierung GLOBAL aktualisieren",
        callback: runOrReportError("Frontmatter Sortierung", async () => {
          const { checked, changed } = await sortAllFrontmatter(plugin.app, plugin, null);
          new Notice(
            changed > 0 ? `Frontmatter Sortierung: ${checked} Notizen gepr\xFCft, ${changed} sortiert.` : `Frontmatter Sortierung: ${checked} Notizen gepr\xFCft, bereits alle sortiert.`
          );
        })
      });
      plugin.addCommand({
        id: "frontmatter-sortierung-typ",
        name: "TYP - Frontmatter Sortierung f\xFCr TYP aktualisieren",
        callback: runOrReportError("Frontmatter Sortierung", async () => {
          const type = await plugin.pickType({ includeManualOff: true, includeUnregistered: true });
          if (!type) return;
          const { checked, changed, hasTypeDefaults } = await sortAllFrontmatter(plugin.app, plugin, type);
          let message = changed > 0 ? `Frontmatter Sortierung ${type}: ${checked} Notizen gepr\xFCft, ${changed} sortiert.` : `Frontmatter Sortierung ${type}: ${checked} Notizen gepr\xFCft, bereits alle sortiert.`;
          if (hasTypeDefaults === false) {
            message += ` Hinweis: F\xFCr ${type} ist kein Standard-Frontmatter hinterlegt - nur die globale Reihenfolge wurde angewendet.`;
          }
          new Notice(message);
        })
      });
      plugin.addCommand({
        id: "frontmatter-sortierung-aktive-notiz",
        name: "TYP - Frontmatter Sortierung der aktiven Notiz aktualisieren",
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

// src/frontmatter-placeholders.js
var require_frontmatter_placeholders = __commonJS({
  "src/frontmatter-placeholders.js"(exports2, module2) {
    var { moment } = require("obsidian");
    var FRONTMATTER_PLACEHOLDERS = [
      {
        token: "{{today}}",
        description: "Heutiges Datum (JJJJ-MM-TT)",
        resolve: () => moment().format("YYYY-MM-DD")
      },
      {
        token: "{{now}}",
        description: "Aktuelles Datum mit Uhrzeit (JJJJ-MM-TT HH:mm)",
        resolve: () => moment().format("YYYY-MM-DD HH:mm")
      },
      {
        // Anders als {{today}}/{{now}} nicht der Aufrufzeitpunkt, sondern das
        // Erstellungsdatum der jeweiligen Datei (file.stat.ctime) - braucht daher
        // die Ziel-Datei als Kontext, siehe file-Parameter bei resolve() und
        // resolveFrontmatterPlaceholders() unten. Ohne Datei (z. B. Aufruf ohne
        // file-Option) Fallback auf den aktuellen Zeitpunkt.
        token: "{{created}}",
        description: "Erstellungsdatum der Datei (JJJJ-MM-TT)",
        resolve: (file) => moment(file?.stat?.ctime ?? Date.now()).format("YYYY-MM-DD")
      }
    ];
    var DYNAMIC_PLACEHOLDER_PATTERN2 = /^\{\{tp\.([^{}]*[^{}\s][^{}]*)\}\}$/;
    var DYNAMIC_PLACEHOLDER_INFO = {
      token: "{{tp.<Skriptname>}}",
      description: "Ruft beim Anlegen tp.user.<Skriptname>(tp, newFile, ctx) auf \u2013 R\xFCckgabe: Wert dieser Property, oder ein Objekt mit Werten f\xFCr mehrere Properties des TYPs"
    };
    function resolveFrontmatterPlaceholders2(frontmatter, file) {
      const resolved = {};
      for (const [key, value] of Object.entries(frontmatter)) {
        const placeholder = FRONTMATTER_PLACEHOLDERS.find((p) => p.token === value);
        resolved[key] = placeholder ? placeholder.resolve(file) : value;
      }
      return resolved;
    }
    function isPlaceholderToken(value) {
      if (typeof value !== "string") return false;
      if (FRONTMATTER_PLACEHOLDERS.some((p) => p.token === value)) return true;
      return DYNAMIC_PLACEHOLDER_PATTERN2.test(value);
    }
    module2.exports = {
      FRONTMATTER_PLACEHOLDERS,
      DYNAMIC_PLACEHOLDER_PATTERN: DYNAMIC_PLACEHOLDER_PATTERN2,
      DYNAMIC_PLACEHOLDER_INFO,
      resolveFrontmatterPlaceholders: resolveFrontmatterPlaceholders2,
      isPlaceholderToken
    };
  }
});

// src/placeholder-suggest.js
var require_placeholder_suggest = __commonJS({
  "src/placeholder-suggest.js"(exports2, module2) {
    var { TFile, Vault, debounce, normalizePath } = require("obsidian");
    var { FRONTMATTER_PLACEHOLDERS } = require_frontmatter_placeholders();
    var EDITOR_CLASS = "fred-typ-frontmatter-editor";
    var SHORTCUT_MARKER = /^\s*(?:\/\/|\/\*|\*).*@typ-shortcut\b/m;
    function registerPlaceholderSuggest2(plugin) {
      const { app } = plugin;
      const metadataCache = app.metadataCache;
      let scriptFolder = null;
      let shortcutScripts = [];
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
        const names = [];
        for (const file of files) {
          try {
            if (SHORTCUT_MARKER.test(await app.vault.cachedRead(file))) names.push(file.basename);
          } catch (e) {
            console.error(`TYP-System: Templater-Skript ${file.path} nicht lesbar`, e);
          }
        }
        if (folderPath !== scriptFolder) return;
        shortcutScripts = names.sort((a, b) => a.localeCompare(b));
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
      const placeholderTokens = () => [
        ...FRONTMATTER_PLACEHOLDERS.map((p) => p.token),
        ...shortcutScripts.map((name) => `{{tp.${name}}}`)
      ];
      const original = metadataCache.getFrontmatterPropertyValuesForKey;
      const wrapped = function(...args) {
        const values = original.apply(this, args);
        const inputEl = activeDocument.activeElement;
        if (!inputEl?.closest?.(`.${EDITOR_CLASS}`)) return values;
        const text = typeof inputEl.value === "string" ? inputEl.value : inputEl.textContent ?? "";
        if (!text.trimStart().startsWith("{")) return values;
        if (currentScriptFolder() !== scriptFolder) scheduleRefresh();
        const tokens = placeholderTokens();
        return [...tokens, ...values.filter((v) => !tokens.includes(v))];
      };
      metadataCache.getFrontmatterPropertyValuesForKey = wrapped;
      plugin.register(() => {
        if (metadataCache.getFrontmatterPropertyValuesForKey === wrapped) {
          metadataCache.getFrontmatterPropertyValuesForKey = original;
        }
      });
    }
    module2.exports = { registerPlaceholderSuggest: registerPlaceholderSuggest2, EDITOR_CLASS };
  }
});

// src/type-frontmatter-editor.js
var require_type_frontmatter_editor = __commonJS({
  "src/type-frontmatter-editor.js"(exports2, module2) {
    var { MarkdownView, Menu } = require("obsidian");
    var { isPlaceholderToken } = require_frontmatter_placeholders();
    var { EDITOR_CLASS: PLACEHOLDER_SUGGEST_EDITOR_CLASS } = require_placeholder_suggest();
    var { getSubtype: getSubtype2, ensureSubtype } = require_subtypes();
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
    function mountFrontmatterEditor(view, containerEl, store) {
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
          store.setFrontmatter(frontmatter);
          store.setFloating(floating);
          view.plugin.saveSettings();
          view.plugin.refreshTypColors?.();
        }
      };
      const editor = new EditorClass(app, owner);
      editor.fredPendingFloatingAdd = false;
      editor.containerEl.addClass(PLACEHOLDER_SUGGEST_EDITOR_CLASS);
      containerEl.appendChild(editor.containerEl);
      view.addChild(editor);
      const defaults = store.getFrontmatter();
      const hadTyp = Object.keys(defaults).some((key) => SYSTEM_PROPERTIES.includes(key.trim().toLowerCase()));
      stripTypProperty(defaults);
      if (hadTyp) view.plugin.saveSettings();
      editor.synchronize(defaults);
      markPlaceholderRows(editor.containerEl, defaults);
      ensurePropertyMenuPatch(app, editor);
      return editor;
    }
    function markPlaceholderRows(containerEl, frontmatter) {
      for (const row of containerEl.querySelectorAll(".metadata-property")) {
        const rowKey = row.getAttribute("data-property-key");
        const actualKey = Object.keys(frontmatter).find((k) => k.toLowerCase() === rowKey?.toLowerCase());
        row.toggleClass("fred-typ-placeholder-value", isPlaceholderToken(frontmatter[actualKey]));
      }
    }
    function addBlankProperty(editor) {
      if (!editor) return;
      const current = editor.serialize();
      if (!current.hasOwnProperty("")) {
        current[""] = null;
        editor.synchronize(current);
      }
      editor.focusKey("");
      ensurePropertyMenuPatch(editor.owner.app, editor);
    }
    module2.exports = { mountFrontmatterEditor, addBlankProperty, ensurePropertyMenuPatch, typeStore, subtypeStore };
  }
});

// src/unified-frontmatter-editor.js
var require_unified_frontmatter_editor = __commonJS({
  "src/unified-frontmatter-editor.js"(exports2, module2) {
    var { mountFrontmatterEditor, ensurePropertyMenuPatch } = require_type_frontmatter_editor();
    var { getSubtypeNames: getSubtypeNames2, getSubtype: getSubtype2, ensureSubtype, getSectionOrder } = require_subtypes();
    function unifiedStore(plugin, type) {
      const layout = /* @__PURE__ */ new Map();
      let current = {};
      const sections = () => getSectionOrder(plugin.settings, type);
      const load = () => {
        layout.clear();
        current = {};
        const seen = /* @__PURE__ */ new Set();
        const add = (frontmatter, section) => {
          for (const [key, value] of Object.entries(frontmatter ?? {})) {
            if (key === "" || seen.has(key.toLowerCase())) continue;
            seen.add(key.toLowerCase());
            current[key] = value;
            layout.set(key, section);
          }
        };
        for (const section of sections()) {
          add(section === null ? plugin.settings.typeDefaultFrontmatter[type] : getSubtype2(plugin.settings, type, section)?.frontmatter, section);
        }
      };
      load();
      const sectionOf = (key) => layout.has(key) ? layout.get(key) : null;
      return {
        type,
        subtype: null,
        unified: true,
        layout,
        sections,
        sectionOf,
        getFrontmatter: () => current,
        // Verteilt das vollständige Property-Set wieder auf die Blöcke. Neue Keys
        // landen im Block der zuvor angelegten Leerzeile (layout ""), eine
        // Umbenennung (genau ein Key weg, einer neu) behält den Block, sonst
        // entscheidet der davor stehende Key.
        setFrontmatter(frontmatter) {
          const keys = Object.keys(frontmatter);
          const removed = [...layout.keys()].filter((key) => key !== "" && !Object.hasOwn(frontmatter, key));
          const added = keys.filter((key) => key !== "" && !layout.has(key));
          if (removed.length === 1 && added.length === 1) {
            layout.set(added[0], layout.get(removed[0]));
          } else {
            for (const key of added) {
              if (layout.has("")) {
                layout.set(key, layout.get(""));
              } else {
                const before = keys.slice(0, keys.indexOf(key)).reverse().find((k) => layout.has(k));
                layout.set(key, before === void 0 ? null : layout.get(before));
              }
            }
          }
          for (const key of removed) layout.delete(key);
          if (!Object.hasOwn(frontmatter, "")) layout.delete("");
          const blocks = new Map(sections().map((section) => [section, {}]));
          for (const key of keys) {
            if (key === "") continue;
            (blocks.get(sectionOf(key)) ?? blocks.get(null))[key] = frontmatter[key];
          }
          plugin.settings.typeDefaultFrontmatter[type] = blocks.get(null);
          for (const subtype of getSubtypeNames2(plugin.settings, type)) {
            ensureSubtype(plugin.settings, type, subtype).frontmatter = blocks.get(subtype);
          }
          current = frontmatter;
        },
        getFloating() {
          return [
            ...plugin.settings.typeFloatingKeys[type] ?? [],
            ...getSubtypeNames2(plugin.settings, type).flatMap((subtype) => getSubtype2(plugin.settings, type, subtype)?.floatingKeys ?? [])
          ];
        },
        setFloating(keys) {
          const bySection = new Map(sections().map((section) => [section, []]));
          for (const key of keys) (bySection.get(sectionOf(key)) ?? bySection.get(null)).push(key);
          const typeKeys = bySection.get(null);
          if (typeKeys.length > 0) plugin.settings.typeFloatingKeys[type] = typeKeys;
          else delete plugin.settings.typeFloatingKeys[type];
          for (const subtype of getSubtypeNames2(plugin.settings, type)) {
            ensureSubtype(plugin.settings, type, subtype).floatingKeys = bySection.get(subtype);
          }
        }
      };
    }
    function mountUnifiedFrontmatterEditor(view, containerEl, type, { renderHeader, renderFooter, onMoveSection, onSectionContextMenu }) {
      const store = unifiedStore(view.plugin, type);
      const wrapper = containerEl.createDiv({ cls: "fred-typ-unified" });
      const cardLayer = wrapper.createDiv({ cls: "fred-typ-unified-cards" });
      const editor = mountFrontmatterEditor(view, wrapper, store);
      if (!editor) return null;
      const listEl = editor.propertyListEl;
      let blocks = [];
      let hoveredSection;
      let dragSection;
      const layoutCards = () => {
        cardLayer.empty();
        blocks = [];
        const base = wrapper.getBoundingClientRect();
        for (const header of listEl.querySelectorAll(":scope > .fred-typ-section-header")) {
          const footer = header.fredFooter;
          if (!footer?.isConnected) continue;
          const section = header.fredSection;
          const top = header.getBoundingClientRect().top - base.top;
          const bottom = footer.getBoundingClientRect().bottom - base.top;
          let el = null;
          if (section !== null) {
            el = cardLayer.createDiv({ cls: "fred-typ-unified-card" });
            el.style.top = `${top}px`;
            el.style.height = `${bottom - top}px`;
            el.toggleClass("is-hovered", section === hoveredSection && dragSection === void 0);
            el.toggleClass("is-dragging", section === dragSection);
          }
          blocks.push({ section, top, bottom, el });
        }
      };
      let injected = [];
      let injecting = false;
      const injectSections = () => {
        if (injecting || !listEl.isConnected) return;
        injecting = true;
        try {
          for (const el of injected) el.detach();
          injected = [];
          const sections = store.sections();
          const rows = [...listEl.children];
          const rowsBySection = new Map(sections.map((section) => [section, []]));
          for (const rowEl of rows) {
            const row = editor.rendered.find((r) => r.containerEl === rowEl);
            const section = store.sectionOf(row?.entry.key);
            (rowsBySection.get(section) ?? rowsBySection.get(null)).push(rowEl);
          }
          const ordered = [...rowsBySection.values()].flat();
          const inOrder = ordered.every((rowEl, i) => rowEl === rows[i]);
          let anchor = listEl.firstChild;
          for (const [section, sectionRows] of rowsBySection) {
            const sub = section !== null;
            const header = createDiv({ cls: "fred-typ-frontmatter-header fred-typ-section-header" });
            const footer = createDiv({ cls: "fred-typ-section-footer" });
            header.toggleClass("fred-typ-section-sub", sub);
            footer.toggleClass("fred-typ-section-sub", sub);
            header.fredSection = section;
            header.fredFooter = footer;
            renderHeader(section, header, editor);
            renderFooter?.(section, footer, editor);
            injected.push(header, footer);
            for (const rowEl of sectionRows) rowEl.toggleClass("fred-typ-section-sub", sub);
            if (!inOrder) continue;
            listEl.insertBefore(header, anchor);
            if (sectionRows.length > 0) anchor = sectionRows[sectionRows.length - 1].nextSibling;
            listEl.insertBefore(footer, anchor);
          }
          if (!inOrder) {
            const children = [];
            for (let i = 0; i < injected.length; i += 2) {
              const header = injected[i];
              children.push(header, ...rowsBySection.get(header.fredSection), injected[i + 1]);
            }
            listEl.setChildrenInPlace(children);
          }
        } finally {
          injecting = false;
        }
        layoutCards();
      };
      const originalSynchronize = editor.synchronize;
      editor.synchronize = function(frontmatter) {
        originalSynchronize.call(this, frontmatter);
        injectSections();
      };
      editor.reorderKey = function() {
        const serialized = this.serialize();
        const frontmatter = {};
        let section = null;
        for (const el of listEl.children) {
          if (el.hasClass("fred-typ-section-header")) {
            section = el.fredSection;
            continue;
          }
          const row = this.rendered.find((r) => r.containerEl === el);
          if (!row) continue;
          frontmatter[row.entry.key] = serialized[row.entry.key];
          store.layout.set(row.entry.key, section);
        }
        this.owner.saveFrontmatter(frontmatter);
      };
      editor.fredAddBlank = function(section, floating = false) {
        this.fredPendingFloatingAdd = floating;
        store.layout.set("", section);
        const current = this.serialize();
        const next = {};
        for (const s of store.sections()) {
          for (const [key, value] of Object.entries(current)) {
            if (key !== "" && store.sectionOf(key) === s) next[key] = value;
          }
          if (s === section) next[""] = null;
        }
        this.synchronize(next);
        this.focusKey("");
        ensurePropertyMenuPatch(view.app, this);
      };
      const blockAt = (event) => {
        const y = event.clientY - wrapper.getBoundingClientRect().top;
        return blocks.find((block) => y >= block.top && y <= block.bottom) ?? null;
      };
      const subtypeBlockAt = (event) => {
        const block = blockAt(event);
        return block?.section != null ? block : null;
      };
      const isGrabTarget = (target) => {
        if (target.closest(".clickable-icon, [contenteditable='true'], input, textarea")) return false;
        if (target === listEl) return true;
        return !!target.closest(".fred-typ-section-header.fred-typ-section-sub, .fred-typ-section-footer.fred-typ-section-sub");
      };
      const setHovered = (section) => {
        if (section === hoveredSection) return;
        hoveredSection = section;
        for (const block of blocks) block.el?.toggleClass("is-hovered", block.section === section && dragSection === void 0);
      };
      const markSection = (section) => {
        let current = null;
        for (const el of listEl.children) {
          if (el.hasClass("fred-typ-section-header")) current = el.fredSection;
          el.toggleClass("fred-typ-block-drag-source", section !== void 0 && current === section);
        }
      };
      wrapper.addEventListener("mousemove", (event) => {
        if (dragSection === void 0) setHovered(subtypeBlockAt(event)?.section);
      });
      wrapper.addEventListener("mouseleave", () => setHovered(void 0));
      wrapper.addEventListener("contextmenu", (event) => {
        if (event.defaultPrevented || event.target.closest("input, textarea, [contenteditable='true']")) return;
        const block = subtypeBlockAt(event);
        if (!block) return;
        event.preventDefault();
        onSectionContextMenu?.(block.section, event);
      });
      wrapper.addEventListener("mousedown", (event) => {
        if (event.button !== 0 || !isGrabTarget(event.target)) return;
        const startBlock = subtypeBlockAt(event);
        if (!startBlock) return;
        const win = wrapper.win;
        const startY = event.clientY;
        let indicator = null;
        let targetIndex = null;
        const onMove = (moveEvent) => {
          if (dragSection === void 0) {
            if (Math.abs(moveEvent.clientY - startY) < 4) return;
            dragSection = startBlock.section;
            setHovered(void 0);
            wrapper.doc.body.addClass("fred-typ-block-dragging");
            win.getSelection()?.removeAllRanges();
            markSection(dragSection);
            layoutCards();
            indicator = wrapper.createDiv({ cls: "fred-typ-unified-drop-indicator" });
          }
          moveEvent.preventDefault();
          if (blocks.length === 0) return;
          const y = moveEvent.clientY - wrapper.getBoundingClientRect().top;
          targetIndex = blocks.filter((block) => (block.top + block.bottom) / 2 < y).length;
          const from = blocks.findIndex((block) => block.section === dragSection);
          indicator.toggle(targetIndex !== from && targetIndex !== from + 1);
          const halfGap = 6;
          const gapY = targetIndex === 0 ? blocks[0].top - halfGap : targetIndex === blocks.length ? blocks[blocks.length - 1].bottom + halfGap : (blocks[targetIndex - 1].bottom + blocks[targetIndex].top) / 2;
          indicator.style.top = `${gapY - 1}px`;
        };
        const end = (commit) => {
          win.removeEventListener("mousemove", onMove);
          win.removeEventListener("mouseup", onUp);
          win.removeEventListener("keydown", onKey, true);
          if (dragSection === void 0) return;
          const section = dragSection;
          dragSection = void 0;
          wrapper.doc.body.removeClass("fred-typ-block-dragging");
          indicator?.remove();
          markSection(void 0);
          layoutCards();
          const order = blocks.map((block) => block.section);
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
      });
      const mutationObserver = new MutationObserver(() => layoutCards());
      mutationObserver.observe(listEl, { childList: true });
      const resizeObserver = new ResizeObserver(() => layoutCards());
      resizeObserver.observe(wrapper);
      editor.register(() => {
        mutationObserver.disconnect();
        resizeObserver.disconnect();
      });
      injectSections();
      return editor;
    }
    module2.exports = { mountUnifiedFrontmatterEditor };
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
    var { mountUnifiedFrontmatterEditor } = require_unified_frontmatter_editor();
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
    var { FRONTMATTER_PLACEHOLDERS, DYNAMIC_PLACEHOLDER_INFO } = require_frontmatter_placeholders();
    var { normalizeTypeName, compareTypes, sortTypesByMode: sortTypesByMode2 } = require_type_utils();
    var { typeKeyOf, propertyValue, setCanonicalProperty: setCanonicalProperty2, TYP_PROPERTY: TYP_PROPERTY2, SUBTYP_PROPERTY: SUBTYP_PROPERTY2 } = require_typ_index();
    var VIEW_TYPE_TYP = "fred-typ-view";
    var DEFAULT_TYPE_COLOR = "#888888";
    var DEFAULT_SORT_ORDER2 = "count-desc";
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
        parentEl.createSpan({ cls: "fred-typ-inline-name", text: type }).style.color = color;
      } else {
        parentEl.createSpan({ cls: "fred-typ-inline-dot" }).style.backgroundColor = color;
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
        appendTypeName(p, this.plugin, this.type, this.plugin.settings.typeColors[this.type] ?? DEFAULT_TYPE_COLOR);
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
        const color = this.plugin.settings.typeColors[this.oldType] ?? DEFAULT_TYPE_COLOR;
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
        appendTypeName(p, this.plugin, this.newType, settings.typeColors[this.newType] ?? DEFAULT_TYPE_COLOR);
        p.appendText(" existiert bereits. ");
        appendTypeName(p, this.plugin, this.oldType, settings.typeColors[this.oldType] ?? DEFAULT_TYPE_COLOR);
        p.appendText(" damit zusammenlegen?");
        contentEl.createEl("p", {
          text: `${this.affectedCount} Notiz(en) werden auf ${this.newType} umgestellt. Farbe, Beschreibung und Standard-Frontmatter von ${this.oldType} entfallen, seine Subtypen werden \xFCbernommen (gleichnamige Subtyp-Bl\xF6cke zusammengef\xFChrt).`
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
        this.frontmatterEditor = null;
        this.frontmatterEditors = [];
        this.contentEl.empty();
        this.contentEl.addClass("fred-typ-view");
        this.registerDomEvent(this.contentEl, "keydown", (event) => {
          if (event.key === "Escape" && this.selectedType !== null) this.closeTypeSettings();
        });
        this.render();
      }
      async onClose() {
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
      // frontmatterEditor ist der Editor des TYP-Blocks (u. a. für den Befehl
      // "Standard-Property hinzufügen"), frontmatterEditors alle Editoren der
      // Detailansicht inkl. der Subtyp-Blöcke.
      destroyFrontmatterEditor() {
        for (const editor of this.frontmatterEditors ?? []) this.removeChild(editor);
        this.frontmatterEditors = [];
        this.frontmatterEditor = null;
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
          const listCls = "fred-typ-list nav-files-container" + (this.plugin.settings.typListDescriptionEnabled ? "" : " fred-typ-list-no-description");
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
      // über dem frei skalierbaren Punkt platzieren.
      renderColorPicker(parent, type, onChange, { showReset = false } = {}) {
        const currentColor = this.plugin.settings.typeColors[type] ?? DEFAULT_TYPE_COLOR;
        const colorWrap = parent.createDiv({ cls: "fred-typ-color-wrap" });
        const colorDot = colorWrap.createDiv({ cls: "fred-typ-color-dot" });
        colorDot.style.backgroundColor = currentColor;
        const colorInput = colorWrap.createEl("input", { type: "color", cls: "fred-typ-color-input" });
        colorInput.value = currentColor;
        colorInput.addEventListener("click", (event) => event.stopPropagation());
        colorInput.addEventListener("input", async () => {
          colorDot.style.backgroundColor = colorInput.value;
          this.plugin.settings.typeColors[type] = colorInput.value;
          await this.plugin.saveSettings();
          onChange?.(colorInput.value);
        });
        colorInput.addEventListener("change", () => this.plugin.refreshTypColors?.());
        if (showReset) {
          const resetBtn = parent.createDiv({
            cls: "clickable-icon fred-typ-color-reset",
            attr: { "aria-label": "Farbe zur\xFCcksetzen" }
          });
          setIcon(resetBtn, "rotate-ccw");
          resetBtn.addEventListener("click", async () => {
            delete this.plugin.settings.typeColors[type];
            colorInput.value = DEFAULT_TYPE_COLOR;
            colorDot.style.backgroundColor = DEFAULT_TYPE_COLOR;
            await this.plugin.saveSettings();
            this.plugin.refreshTypColors?.();
            onChange?.(DEFAULT_TYPE_COLOR);
          });
        }
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
        if (this.plugin.settings.typListDescriptionEnabled) {
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
            if (this.plugin.settings.colorViews.typList) titleEl.style.color = newColor;
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
        this.frontmatterEditor = mountUnifiedFrontmatterEditor(this, body, type, {
          renderHeader: (section, el, editor) => this.renderSectionHeader(el, type, section, bucket, editor),
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
        if (this.frontmatterEditor) this.frontmatterEditors.push(this.frontmatterEditor);
        this.subtypeAddBtnEl = body.createEl("button", { cls: "mod-cta fred-typ-subtype-add" });
        setIcon(this.subtypeAddBtnEl.createSpan({ cls: "fred-typ-subtype-add-icon" }), "plus");
        this.subtypeAddBtnEl.createSpan({ text: "Subtyp hinzuf\xFCgen" });
        this.subtypeAddBtnEl.addEventListener("click", () => this.startAddSubtype(type));
        this.renderUnregisteredSubtypes(body, type, bucket);
        body.createDiv({ cls: "fred-typ-detail-separator" });
        this.renderPlaceholderList(body);
        this.plugin.refreshFrontmatterHighlight?.();
      }
      // Überschrift eines Blocks im gemeinsamen Editor (siehe
      // unified-frontmatter-editor.js): Titel mit Notiz-Anzahl (beim Standard-
      // Frontmatter die Notizen ohne SUBTYP - für die gilt nur dieser Block),
      // Suche per Rechtsklick (beim Standard-Frontmatter auf den Titel), und die beiden "Property
      // hinzufügen"-Buttons, die eine Leerzeile in genau diesem Block anlegen.
      renderSectionHeader(el, type, section, bucket, editor) {
        const titleGroup = el.createDiv({ cls: "fred-typ-frontmatter-title-group" });
        const titleEl = titleGroup.createDiv({ cls: "fred-typ-detail-section-title", text: section ?? "Standard-Frontmatter" });
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
        addFloatingPropertyBtn.addEventListener("click", () => editor.fredAddBlank(section, true));
        const addPropertyBtn = addButtons.createDiv({
          cls: "clickable-icon fred-typ-frontmatter-add",
          attr: { "aria-label": "Property hinzuf\xFCgen" }
        });
        setIcon(addPropertyBtn, "plus");
        addPropertyBtn.addEventListener("click", () => editor.fredAddBlank(section, false));
      }
      // Abschluss eines Subtyp-Blocks: zentriert die Aktionen des Subtyps, wie im
      // Kopf der TYP-Detailansicht (Umbenennen inkl. Notizen, Umbenennen, Löschen).
      // Das Standard-Frontmatter hat keine. Der Titel wird erst beim Klick
      // gesucht - Überschrift und Abschluss entstehen bei jedem synchronize() neu.
      renderSectionFooter(el, type, subtype) {
        el.addClass("fred-typ-subtype-actions");
        const titleEl = () => {
          let sibling = el.previousElementSibling;
          while (sibling && !sibling.hasClass("fred-typ-section-header")) sibling = sibling.previousElementSibling;
          return sibling?.querySelector(".fred-typ-detail-section-title") ?? null;
        };
        const rename = (updateNotes) => {
          const target = titleEl();
          if (target) this.startSubtypeRename(type, subtype, target, { updateNotes });
        };
        const renameWithNotesBtn = el.createDiv({
          cls: "clickable-icon fred-typ-detail-rename-notes",
          attr: { "aria-label": "Umbenennen (inkl. Notizen anpassen)" }
        });
        setIcon(renameWithNotesBtn, "pencil");
        renameWithNotesBtn.addEventListener("click", () => rename(true));
        const renameBtn = el.createDiv({ cls: "clickable-icon fred-typ-detail-rename", attr: { "aria-label": "Umbenennen" } });
        setIcon(renameBtn, "pencil");
        renameBtn.addEventListener("click", () => rename(false));
        const deleteBtn = el.createDiv({ cls: "clickable-icon fred-typ-detail-delete", attr: { "aria-label": "L\xF6schen" } });
        setIcon(deleteBtn, "trash");
        deleteBtn.addEventListener("click", () => this.deleteSubtypeWithConfirm(type, subtype));
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
      // SUBTYP zählt stattdessen das Standard-Frontmatter). Dargestellt wie die
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
        setIcon(footer.createDiv({ cls: "clickable-icon fred-typ-detail-rename-notes" }), "pencil");
        setIcon(footer.createDiv({ cls: "clickable-icon fred-typ-detail-rename" }), "pencil");
        setIcon(footer.createDiv({ cls: "clickable-icon fred-typ-detail-delete" }), "trash");
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
      // Rein informativ, unter dem Standard-Frontmatter-Editor: der Hinweistext
      // erklärt den Floating-Property-Toggle (Rechtsklick auf eine Property oben,
      // siehe ensurePropertyMenuPatch in type-frontmatter-editor.js), die Liste
      // darunter die Platzhalter, die als Wert einer Property eingetragen werden
      // können (z. B. bei "Datum" der Text "{{today}}") - getTypeDefaults()
      // (main.js) löst sie bei jedem Abruf frisch auf, siehe
      // frontmatter-placeholders.js. Bewusst ohne eigene Überschrift, da direkt
      // unter der Property-Liste ohnehin klar ist, worauf sich beides bezieht.
      renderPlaceholderList(parent) {
        const section = parent.createDiv({ cls: "fred-typ-placeholder-section" });
        const list = section.createDiv({ cls: "fred-typ-placeholder-list" });
        for (const { token, description } of [...FRONTMATTER_PLACEHOLDERS, DYNAMIC_PLACEHOLDER_INFO]) {
          const row = list.createDiv({ cls: "fred-typ-placeholder-row" });
          row.createEl("code", { cls: "fred-typ-placeholder-token", text: token });
          row.createSpan({ cls: "fred-typ-placeholder-desc", text: description });
        }
        section.createDiv({
          cls: "fred-typ-placeholder-hint",
          text: "You can change a property to floating in the right-click menu."
        });
      }
    };
    function registerTypView2(plugin) {
      plugin.registerView(VIEW_TYPE_TYP, (leaf) => new TypView(leaf, plugin));
      plugin.addCommand({
        id: "typ-view-oeffnen",
        name: "TYP - TYP-View \xF6ffnen",
        callback: () => activateTypView(plugin)
      });
      plugin.addCommand({
        id: "typ-property-hinzufuegen",
        name: "TYP - Standard-Property hinzuf\xFCgen",
        callback: () => addTypPropertyCommand(plugin)
      });
      plugin.addCommand({
        id: "typ-hinzufuegen",
        name: "TYP - Neuen TYP hinzuf\xFCgen",
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
        activeTypView.frontmatterEditor?.fredAddBlank(null);
        return;
      }
      const file = app.workspace.getActiveFile();
      const type = plugin.typIndex.typeOf(file);
      if (!type) {
        new Notice("Aktive Notiz hat keinen TYP.");
        return;
      }
      await activateTypView(plugin);
      const view = app.__fredTypLeaf?.view;
      if (!(view instanceof TypView)) return;
      view.openTypeSettings(type);
      view.frontmatterEditor?.fredAddBlank(null);
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

// src/type-colors.js
var require_type_colors = __commonJS({
  "src/type-colors.js"(exports2, module2) {
    function colorForFile(plugin, file) {
      const type = plugin.typIndex.typeOf(file);
      return type ? plugin.settings.typeColors[type] ?? null : null;
    }
    module2.exports = { colorForFile };
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
      const color = plugin.settings.colorViews.fileExplorer ? colorForFile(plugin, file) : null;
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
            if (plugin.settings.graphTagColorEnabled && plugin.settings.graphTagColor) {
              node.color = { a: 1, rgb: hexToInt(plugin.settings.graphTagColor) };
            }
            continue;
          }
          const file = plugin.app.vault.getAbstractFileByPath(path);
          let color = null;
          if (file && file.extension !== "md") {
            if (plugin.settings.graphAttachmentColorEnabled && plugin.settings.graphAttachmentColor) {
              color = plugin.settings.graphAttachmentColor;
            }
          } else if (plugin.settings.colorViews.graph) {
            color = colorForFile(plugin, file);
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
          leaf.view?.dataEngine?.render();
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
          const color = plugin.settings.colorViews.search ? colorForFile(plugin, file) : null;
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
          const color = plugin.settings.colorViews.recentFiles ? colorForFile(plugin, file) : null;
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
      const color = plugin.settings.colorViews.backlinks ? colorForFile(plugin, file) : null;
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
          const color = plugin.settings.colorViews.bookmarks ? colorForFile(plugin, file) : null;
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
    var { colorForFile } = require_type_colors();
    var DOT_CLASS = "fred-typ-title-dot";
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
      if (style === "dot") return { kind: "dot", color: colorForFile(plugin, file) };
      const colored = plugin.settings.noteTitleBadgeColored;
      const color = colored ? colorForFile(plugin, file) : null;
      const typeName = colored ? color ? plugin.typIndex.typeOf(file) : null : plugin.typIndex.typeOf(file);
      if (!typeName) return { kind: "none" };
      const position = plugin.settings.noteTitleBadgePosition;
      return { kind: position === "block" ? "block-badge" : "title-badge", colored, color, typeName };
    }
    function applyStyleToTitle(titleEl, marker) {
      const isDot = marker.kind === "dot" && !!marker.color;
      const isBadge = marker.kind === "title-badge";
      titleEl.classList.toggle(DOT_CLASS, isDot);
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
          const textColor = plugin.settings.colorViews.noteTitleColor ? colorForFile(plugin, typedFile) : null;
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
      return colorForFile(plugin, file);
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
    function blockOf(defaults, floatingKeys) {
      const keys = rawKeysForType(true, defaults) ?? [];
      return { keys, floating: new Set((floatingKeys ?? []).map((key) => key.toLowerCase())) };
    }
    function blocksForType(plugin, type, subtype) {
      const { settings } = plugin;
      const blocks = [blockOf(settings.typeDefaultFrontmatter[type], settings.typeFloatingKeys[type])];
      const subtypeNames = subtype === ALL_SUBTYPES ? getSubtypeNames2(settings, type) : subtype ? [subtype] : [];
      for (const name of subtypeNames) {
        const data = getSubtype2(settings, type, name);
        if (data) blocks.push(blockOf(data.frontmatter, data.floatingKeys));
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
      if (store.unified) {
        return splitKeys(blocksForType(plugin, store.type, colorViews.frontmatterDefaultsSubtyp ? ALL_SUBTYPES : null));
      }
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
        for (const { keys, floating } of blocks) {
          for (const key of keys) {
            if (!map.has(key)) map.set(key, /* @__PURE__ */ new Map());
            const byType = map.get(key);
            byType.set(type, (byType.get(type) ?? true) && floating.has(key));
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
          const types = usageMap.get(key.toLowerCase());
          const count = types ? types.size : 0;
          titleEl.classList.toggle(HIGHLIGHT_CLASS, count > 1);
          let isFloating = false;
          if (count === 1) {
            const [[onlyType, onlyFloating]] = types;
            isFloating = onlyFloating;
            const color = plugin.settings.typeColors[onlyType];
            if (color) titleEl.style.setProperty("color", color, "important");
            else titleEl.style.removeProperty("color");
          } else {
            titleEl.style.removeProperty("color");
          }
          titleEl.classList.toggle(FLOATING_CLASS, isFloating);
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
    var { getSubtypeNames: getSubtypeNames2 } = require_subtypes();
    var TYP_PROPERTY2 = "TYP";
    var SUBTYP_PROPERTY2 = "SUBTYP";
    function sameKey(a, b) {
      return a.toLowerCase() === b.toLowerCase();
    }
    function isEmptyValue(value) {
      return value === null || value === void 0 || value === "";
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
      return true;
    }
    function moveIntoOwner(store, owner, oldKey, newKey) {
      const defaults = store.getFrontmatter();
      const sourceKey = Object.keys(defaults).find((key) => sameKey(key, oldKey));
      if (sourceKey === void 0) return false;
      const next = { ...defaults };
      delete next[sourceKey];
      store.setFrontmatter(next);
      store.setFloating(store.getFloating().filter((key) => key !== sourceKey));
      const ownerDefaults = owner.getFrontmatter();
      const targetKey = Object.keys(ownerDefaults).find((key) => sameKey(key, newKey));
      if (isEmptyValue(ownerDefaults[targetKey]) && !isEmptyValue(defaults[sourceKey])) {
        owner.setFrontmatter({ ...ownerDefaults, [targetKey]: defaults[sourceKey] });
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
        const owner = sameKey(oldKey, newKey) ? null : stores.find((store) => Object.keys(store.getFrontmatter()).some((key) => sameKey(key, newKey)));
        for (const store of stores) {
          if (!owner || store === owner) {
            if (renameInStore(store, oldKey, newKey)) count(store);
          } else if (moveIntoOwner(store, owner, oldKey, newKey)) {
            count(store);
          }
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
    var { DEFAULT_TYPE_COLOR, compareTypes, DEFAULT_SORT_ORDER: DEFAULT_SORT_ORDER2 } = require_typ_view();
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
      // Fuzzy-Suche greift auch auf die Beschreibung, nicht nur auf den TYP-Namen.
      getItemText(item) {
        return item.description ? `${item.type} ${item.description}` : item.type;
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
        if (item.description) {
          el.createSpan({ cls: "fred-typ-picker-desc", text: item.description });
        }
        el.createSpan({ cls: "fred-typ-picker-count", text: String(item.count) });
      }
      // Name in der Farbe von colorType - je nach Einstellung "TYP View einfärben"
      // als eingefärbter Text oder mit vorangestelltem Farbpunkt.
      renderColoredName(el, text, colorType) {
        const color = this.plugin.settings.typeColors[colorType] ?? DEFAULT_TYPE_COLOR;
        if (this.plugin.settings.colorViews.typList) {
          el.createSpan({ cls: "fred-typ-picker-name", text }).style.color = color;
        } else {
          el.createSpan({ cls: "fred-typ-picker-dot" }).style.backgroundColor = color;
          el.createSpan({ cls: "fred-typ-picker-name", text });
        }
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
      constructor(app, plugin, type, items, resolve) {
        super(app, plugin, items, resolve);
        this.setPlaceholder(`Subtyp f\xFCr ${type} \u2013 ESC f\xFCr zur\xFCck`);
      }
      renderSuggestion(match, el) {
        const item = match.item;
        el.addClass("fred-typ-picker-suggestion");
        if (item.none) el.addClass("fred-typ-picker-unregistered");
        el.createSpan({ cls: "fred-typ-picker-name", text: item.type });
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
        this.renderColoredName(el, item.subtype, item.type);
        el.createSpan({ cls: "fred-typ-picker-count", text: String(item.count) });
      }
      onChooseItem(item) {
        this.resolve({ type: item.type, subtype: item.subtype ?? null });
      }
    };
    function pickSubtype(app, plugin, type) {
      return new Promise((resolve) => {
        const items = plugin.getSubtypes(type).map(({ subtype, count }) => ({ type: subtype, description: "", count }));
        if (items.length === 0) {
          resolve("");
          return;
        }
        const noneCount = plugin.typIndex.subtypeBucket(type).noSubtype;
        items.push({ type: "Kein Subtyp", description: "", count: noneCount, none: true });
        new SubtypPickerModal(app, plugin, type, items, resolve).open();
      });
    }
    function unregisteredItems(app, plugin) {
      const registered = new Set(plugin.settings.types);
      const { counts } = plugin.typIndex.typeCounts();
      const sortOrder = plugin.settings.typSortOrder ?? DEFAULT_SORT_ORDER2;
      return [...counts.keys()].filter((type) => !registered.has(type) && plugin.typIndex.isCleanKey(type)).sort((a, b) => compareTypes(sortOrder, a, b, counts, plugin.settings.typeColors)).map((type) => ({ type, description: "", count: counts.get(type) ?? 0, unregistered: true }));
    }
    function pickType(app, plugin, options = {}) {
      return new Promise((resolve) => {
        const items = typeItems(app, plugin, options);
        if (!items) {
          resolve(null);
          return;
        }
        new TypPickerModal(app, plugin, items, resolve).open();
      });
    }
    function typeItems(app, plugin, { includeManualOff = false, includeUnregistered = false } = {}) {
      const items = plugin.getTypes({ includeManualOff }).map((item) => ({ ...item, unregistered: false }));
      if (includeUnregistered) items.push(...unregisteredItems(app, plugin));
      if (items.length > 0) return items;
      new Notice("Keine TYPen vorhanden.");
      return null;
    }
    async function pickTypeAndSubtype(app, plugin, options = {}) {
      if (plugin.settings.separateSubtypePicker) {
        while (true) {
          const type = await pickType(app, plugin, options);
          if (!type) return null;
          const subtype = await pickSubtype(app, plugin, type);
          if (subtype !== null) return { type, subtype: subtype || null };
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

// src/main.js
var { Plugin } = require("obsidian");
var { DEFAULT_SETTINGS, TypSystemSettingTab } = require_settings();
var { registerCommands } = require_commands();
var { registerTypView, sortTypesByMode, DEFAULT_SORT_ORDER } = require_typ_view();
var { TypIndex, setCanonicalProperty, deleteProperty, TYP_PROPERTY, SUBTYP_PROPERTY } = require_typ_index();
var { getSubtype, getSubtypeNames, enforceUniqueKeys } = require_subtypes();
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
var { normalizeGlobalOrder, sortFrontmatterFor } = require_frontmatter_sort();
var { resolveFrontmatterPlaceholders, DYNAMIC_PLACEHOLDER_PATTERN } = require_frontmatter_placeholders();
var {
  pickType: pickTypeModal,
  pickSubtype: pickSubtypeModal,
  pickTypeAndSubtype: pickTypeAndSubtypeModal
} = require_type_picker();
var { registerPlaceholderSuggest } = require_placeholder_suggest();
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
module.exports = class TypSystemPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.typIndex = new TypIndex(this);
    this.typIndex.register();
    registerCommands(this);
    this.addSettingTab(new TypSystemSettingTab(this.app, this));
    registerPropertyRenameSync(this);
    registerPlaceholderSuggest(this);
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
  }
  onunload() {
  }
  // Für _obsidian/templater-scripts/TYP.js: liefert die im TYP-View unter
  // "Standard-Frontmatter" hinterlegten Properties für den gegebenen TYP, damit
  // Templater sie beim Anlegen einer neuen Notiz übernehmen kann, statt sie dort
  // ein zweites Mal zu pflegen. Werte wie "{{today}}" werden dabei erst hier
  // aufgelöst (siehe frontmatter-placeholders.js), nicht schon beim Speichern -
  // liefert also bei jedem Aufruf frisch berechnete Werte. Kopie statt direkter
  // Referenz, damit ein Aufrufer die zurückgegebenen Werte gefahrlos mutieren
  // kann, ohne die Plugin-Settings zu verändern.
  //
  // includeFloating (Standard: false) lässt die als "Floating Property"
  // markierten Keys (typeFloatingKeys) in der Liste - anders als die übrigen
  // Standard-Properties werden diese NICHT automatisch bei jeder neuen Notiz
  // angelegt (sie zählen zwar für die Frontmatter-Sortierung mit, siehe
  // orderedDefaultKeys in frontmatter-sort.js, sollen aber nur bei Bedarf
  // explizit von einem Templater-Skript abgegriffen werden).
  //
  // file (optional) wird an resolveFrontmatterPlaceholders() durchgereicht -
  // nur für den "{{created}}"-Platzhalter relevant, der das Erstellungsdatum
  // der Ziel-Datei statt des Aufrufzeitpunkts liefert.
  //
  // subtype (optional): ergänzt das Standard-Frontmatter um den Block dieses
  // Subtyps (siehe subtypes.js), dessen Keys folgen dahinter - bzw. stehen
  // davor, wenn der Subtyp-Block über dem Standard-Frontmatter liegt
  // (aboveStandard; wichtig für die Reihenfolge der tp.-Platzhalter). Jeder
  // Key gehört zu genau einem Block (siehe enforceUniqueKeys) - käme er doch
  // doppelt vor, bliebe seine erste Position, Wert und Floating-Markierung
  // kämen aus dem späteren Block.
  getTypeDefaults(type, { includeFloating = false, file, subtype = null } = {}) {
    const defaults = {};
    const isFloating = /* @__PURE__ */ new Map();
    const addBlock = (frontmatter, floatingKeys) => {
      const actualKeys = new Map(Object.keys(defaults).map((key) => [key.toLowerCase(), key]));
      for (const [key, value] of Object.entries(frontmatter ?? {})) {
        if (key === "") continue;
        const target = actualKeys.get(key.toLowerCase()) ?? key;
        defaults[target] = value;
        isFloating.set(target, (floatingKeys ?? []).includes(key));
      }
    };
    const subtypeData = subtype ? getSubtype(this.settings, type, subtype) : null;
    if (subtypeData?.aboveStandard) addBlock(subtypeData.frontmatter, subtypeData.floatingKeys);
    addBlock(this.settings.typeDefaultFrontmatter[type], this.settings.typeFloatingKeys[type]);
    if (subtypeData && !subtypeData.aboveStandard) addBlock(subtypeData.frontmatter, subtypeData.floatingKeys);
    if (!includeFloating) {
      for (const [key, floating] of isFloating) if (floating) delete defaults[key];
    }
    return resolveFrontmatterPlaceholders(defaults, file);
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
  // null bei ESC (TYP.js kehrt dann zur TYP-Auswahl zurück).
  pickSubtype(type) {
    return pickSubtypeModal(this.app, this, type);
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
  // Für _obsidian/templater-scripts/TYP.js: erkennt einen dynamischen
  // "{{tp.<Skriptname>}}"-Platzhalter (siehe frontmatter-placeholders.js) in
  // einem Standard-Frontmatter-Wert und liefert den referenzierten Skriptnamen,
  // sonst null. Die eigentliche Auflösung (Aufruf von tp.user.<Skriptname>)
  // kann nur Templater selbst übernehmen - das Plugin hat keinen tp-Zugriff,
  // daher hier bewusst nur Erkennung statt Auflösung wie bei getTypeDefaults().
  matchDynamicPlaceholder(value) {
    if (typeof value !== "string") return null;
    const match = value.match(DYNAMIC_PLACEHOLDER_PATTERN);
    return match ? match[1].trim() : null;
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.colorViews = { ...DEFAULT_SETTINGS.colorViews, ...this.settings.colorViews };
    this.settings.globalPropertyOrder = normalizeGlobalOrder(this.settings.globalPropertyOrder);
    migrateFloatingFrontmatter(this.settings);
    for (const type of Object.keys(this.settings.typeSubtypes ?? {})) enforceUniqueKeys(this.settings, type);
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL3R5cC1pbmRleC5qcyIsICJzcmMvc3VidHlwZXMuanMiLCAic3JjL2Zyb250bWF0dGVyLXNvcnQuanMiLCAic3JjL2Zyb250bWF0dGVyLW9yZGVyLWVkaXRvci5qcyIsICJzcmMvc2V0dGluZ3MuanMiLCAic3JjL2NvbW1hbmRzLmpzIiwgInNyYy9mcm9udG1hdHRlci1wbGFjZWhvbGRlcnMuanMiLCAic3JjL3BsYWNlaG9sZGVyLXN1Z2dlc3QuanMiLCAic3JjL3R5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzIiwgInNyYy91bmlmaWVkLWZyb250bWF0dGVyLWVkaXRvci5qcyIsICJzcmMvdHlwZS11dGlscy5qcyIsICJzcmMvdHlwLXZpZXcuanMiLCAic3JjL3R5cGUtY29sb3JzLmpzIiwgInNyYy9maWxlLWV4cGxvcmVyLWNvbG9ycy5qcyIsICJzcmMvZ3JhcGgtY29sb3JzLmpzIiwgInNyYy9zZWFyY2gtY29sb3JzLmpzIiwgInNyYy9yZWNlbnQtZmlsZXMtY29sb3JzLmpzIiwgInNyYy9iYWNrbGluay1jb2xvcnMuanMiLCAic3JjL2Jvb2ttYXJrLWNvbG9ycy5qcyIsICJzcmMvYWN0aXZlLXRpdGxlLWNvbG9ycy5qcyIsICJzcmMvbGluay1jb2xvcnMuanMiLCAic3JjL2Zyb250bWF0dGVyLWRlZmF1bHQtaGlnaGxpZ2h0LmpzIiwgInNyYy9wcm9wZXJ0eS1yZW5hbWUtc3luYy5qcyIsICJzcmMvdHlwZS1waWNrZXIuanMiLCAic3JjL21haW4uanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IHsgRXZlbnRzLCBURmlsZSwgZGVib3VuY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcblxuY29uc3QgVFlQX1BST1BFUlRZID0gXCJUWVBcIjtcbmNvbnN0IFNVQlRZUF9QUk9QRVJUWSA9IFwiU1VCVFlQXCI7XG5jb25zdCBFTVBUWV9FTlRSWSA9IE9iamVjdC5mcmVlemUoeyB0eXBlS2V5OiBudWxsLCByYXdUeXBlOiBudWxsLCBzdWJ0eXBlS2V5OiBudWxsLCByYXdTdWJ0eXBlOiBudWxsIH0pO1xuXG4vLyBTYW1tZWx0IFx1MDBDNG5kZXJ1bmdlbiBtZWhyZXJlciBEYXRlaWVuICh6LiBCLiBVbWJlbmVubmVuIGVpbmVzIFRZUHMgaW4gdmllbGVuXG4vLyBOb3RpemVuLCBWYXVsdC1TeW5jKSB6dSBlaW5lbSBlaW56aWdlbiBcImNoYW5nZVwiLUV2ZW50LiBPaG5lIHJlc2V0VGltZXIsIGRhbWl0XG4vLyBlaW4gRGF1ZXJzdHJvbSBhbiBcdTAwQzRuZGVydW5nZW4gdHJvdHpkZW0gcmVnZWxtXHUwMEU0XHUwMERGaWcgZHVyY2hnZXJlaWNodCB3aXJkLlxuY29uc3QgRkxVU0hfREVMQVlfTVMgPSAxMDA7XG5cbmZ1bmN0aW9uIHJhd0l0ZW0odmFsdWUpIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBcIlwiO1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiID8gSlNPTi5zdHJpbmdpZnkodmFsdWUpIDogU3RyaW5nKHZhbHVlKTtcbn1cblxuLy8gRWluaGVpdGxpY2hlIEF1c2xlZ3VuZyBlaW5lcyBUWVAtV2VydHMgZlx1MDBGQ3IgZGFzIGdhbnplIFBsdWdpbjogZGVyIFdlcnQgd2lyZFxuLy8gYmV3dXNzdCBOSUNIVCBnZWdsXHUwMEU0dHRldCwgc29uZGVybiBpbiBzZWluZXIgUm9oZm9ybSB6dW0gU2NobFx1MDBGQ3NzZWwgLSBlaW4gVFlQIGlzdFxuLy8gZ2VuYXUgZWluIGVpbnplbG5lciwgc2F1YmVyZXIgV2VydC4gQWxsZXMgYW5kZXJlIChMZWVyemVpY2hlbiBhbSBSYW5kLCBrbGVpblxuLy8gZ2VzY2hyaWViZW4sIExpc3RlIC0gYXVjaCBlaW5lIGVpbmVsZW1lbnRpZ2UpIGVyZ2lidCBlaW5lbiBlaWdlbmVuIFNjaGxcdTAwRkNzc2VsLFxuLy8gZGVyIGluIGtlaW5lbSByZWdpc3RyaWVydGVuIFRZUCBhdWZnZWh0OiBlciBiZWtvbW10IGtlaW5lIEZhcmJlLCB6XHUwMEU0aGx0IG5pY2h0XG4vLyBiZWltIFwicmljaHRpZ2VuXCIgVFlQIG1pdCB1bmQgc3RlaHQgaW4gZGVyIFRZUC1WaWV3IGFscyBlaWdlbmVyLFxuLy8gdW5yZWdpc3RyaWVydGVyIEVpbnRyYWcsIHZvbiB3byBhdXMgZXIgc2ljaCBwZXIgS2xpY2sgYmVyZWluaWdlbiBsXHUwMEU0c3N0XG4vLyAoc2llaGUgcmVnaXN0ZXJUeXBlIGluIHR5cC12aWV3LmpzKS4gTGlzdGVuIGVyc2NoZWluZW4gZGFiZWkgYWxzXG4vLyBcIltBLCBCXVwiIHVuZCBrXHUwMEY2bm5lbiBzbyBuaWUgbWl0IGVpbmVtIEVpbnplbHdlcnQgXCJBLCBCXCIgenVzYW1tZW5mYWxsZW4uXG4vLyBudWxsID0ga2VpbiBUWVAgKGZlaGxlbmQsIGxlZXIsIG51ciBMZWVyemVpY2hlbiwgbGVlcmUgTGlzdGUpLlxuZnVuY3Rpb24gdHlwZUtleU9mKHZhbHVlKSB7XG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgIGNvbnN0IGl0ZW1zID0gdmFsdWUubWFwKHJhd0l0ZW0pO1xuICAgIGlmIChpdGVtcy5ldmVyeSgoaXRlbSkgPT4gaXRlbS50cmltKCkgPT09IFwiXCIpKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gYFske2l0ZW1zLmpvaW4oXCIsIFwiKX1dYDtcbiAgfVxuICBjb25zdCB0ZXh0ID0gcmF3SXRlbSh2YWx1ZSk7XG4gIHJldHVybiB0ZXh0LnRyaW0oKSA9PT0gXCJcIiA/IG51bGwgOiB0ZXh0O1xufVxuXG4vLyBPYnNpZGlhbiBiZWhhbmRlbHQgUHJvcGVydHktTmFtZW4gb2huZSBCZWFjaHR1bmcgZGVyIEdyb1x1MDBERi0vS2xlaW5zY2hyZWlidW5nXG4vLyAoXCJTdWJ0eXBcIiB1bmQgXCJTVUJUWVBcIiBzaW5kIGluIFwiQWxsIHByb3BlcnRpZXNcIiBkaWVzZWxiZSBQcm9wZXJ0eSkgLSBUWVBcbi8vIHVuZCBTVUJUWVAgd2VyZGVuIGRlc2hhbGIgZ2VuYXVzbyBnZWxlc2VuLiBEaWUgZXhha3RlIFNjaHJlaWJ3ZWlzZSBoYXRcbi8vIFZvcnJhbmcsIGZhbGxzIGVpbmUgTm90aXogKGZlaGxlcmhhZnQpIG1laHJlcmUgVmFyaWFudGVuIHRyXHUwMEU0Z3QuXG5mdW5jdGlvbiBwcm9wZXJ0eUtleU9mKGZyb250bWF0dGVyLCBuYW1lKSB7XG4gIGlmICghZnJvbnRtYXR0ZXIpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoZnJvbnRtYXR0ZXIsIG5hbWUpKSByZXR1cm4gbmFtZTtcbiAgY29uc3QgbG93ZXIgPSBuYW1lLnRvTG93ZXJDYXNlKCk7XG4gIHJldHVybiBPYmplY3Qua2V5cyhmcm9udG1hdHRlcikuZmluZCgoa2V5KSA9PiBrZXkudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXIpO1xufVxuXG5mdW5jdGlvbiBwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBuYW1lKSB7XG4gIGNvbnN0IGtleSA9IHByb3BlcnR5S2V5T2YoZnJvbnRtYXR0ZXIsIG5hbWUpO1xuICByZXR1cm4ga2V5ID09PSB1bmRlZmluZWQgPyB1bmRlZmluZWQgOiBmcm9udG1hdHRlcltrZXldO1xufVxuXG4vLyBTY2hyZWlidCB2YWx1ZSB1bnRlciBkZXIgZWluaGVpdGxpY2hlbiBTY2hyZWlid2Vpc2UgbmFtZSAoei4gQi4gXCJTVUJUWVBcIilcbi8vIGluIGRhcyB2b24gcHJvY2Vzc0Zyb250TWF0dGVyIGdlbGllZmVydGUgT2JqZWt0LiBFaW5lIGFid2VpY2hlbmRcbi8vIGdlc2NocmllYmVuZSBWYXJpYW50ZSAoXCJTdWJ0eXBcIikgd2lyZCBkYWJlaSBhbiBPcnQgdW5kIFN0ZWxsZSB1bWJlbmFubnQgLVxuLy8gT2JqZWt0LUluc2VydGlvbi1PcmRlciBiZXN0aW1tdCBkaWUgWUFNTC1SZWloZW5mb2xnZSwgZGFoZXIgYmVpIEJlZGFyZiBhbGxlXG4vLyBLZXlzIGluIGJpc2hlcmlnZXIgUmVpaGVuZm9sZ2UgbmV1IGVpbmZcdTAwRkNnZW4gKHdpZSBpbiBmcm9udG1hdHRlci1zb3J0LmpzKS5cbmZ1bmN0aW9uIHNldENhbm9uaWNhbFByb3BlcnR5KGZyb250bWF0dGVyLCBuYW1lLCB2YWx1ZSkge1xuICBjb25zdCBsb3dlciA9IG5hbWUudG9Mb3dlckNhc2UoKTtcbiAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKGZyb250bWF0dGVyKTtcbiAgaWYgKCFrZXlzLnNvbWUoKGtleSkgPT4ga2V5ICE9PSBuYW1lICYmIGtleS50b0xvd2VyQ2FzZSgpID09PSBsb3dlcikpIHtcbiAgICBmcm9udG1hdHRlcltuYW1lXSA9IHZhbHVlO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBzbmFwc2hvdCA9IHsgLi4uZnJvbnRtYXR0ZXIgfTtcbiAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykgZGVsZXRlIGZyb250bWF0dGVyW2tleV07XG4gIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICBpZiAoa2V5LnRvTG93ZXJDYXNlKCkgIT09IGxvd2VyKSBmcm9udG1hdHRlcltrZXldID0gc25hcHNob3Rba2V5XTtcbiAgICBlbHNlIGlmICghKG5hbWUgaW4gZnJvbnRtYXR0ZXIpKSBmcm9udG1hdHRlcltuYW1lXSA9IHZhbHVlO1xuICB9XG59XG5cbi8vIEVudGZlcm50IG5hbWUgaW4gamVkZXIgU2NocmVpYndlaXNlIGF1cyBkZW0gdm9uIHByb2Nlc3NGcm9udE1hdHRlclxuLy8gZ2VsaWVmZXJ0ZW4gT2JqZWt0LlxuZnVuY3Rpb24gZGVsZXRlUHJvcGVydHkoZnJvbnRtYXR0ZXIsIG5hbWUpIHtcbiAgY29uc3QgbG93ZXIgPSBuYW1lLnRvTG93ZXJDYXNlKCk7XG4gIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGZyb250bWF0dGVyKSkge1xuICAgIGlmIChrZXkudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXIpIGRlbGV0ZSBmcm9udG1hdHRlcltrZXldO1xuICB9XG59XG5cbi8vIFNVQlRZUCB3aXJkIGdlbmF1c28gYXVzZ2VsZWd0ICh0eXBlS2V5T2YpOiBlaW5lIE5vdGl6IGhhdCBoXHUwMEY2Y2hzdGVucyBlaW5lblxuLy8gU1VCVFlQIGFscyBzYXViZXJlbiBFaW56ZWx3ZXJ0LCBhbGxlcyBhbmRlcmUgaXN0IGVpbiBlaWdlbmVyLCBuaWNodFxuLy8gZXJmYXNzdGVyIFNjaGxcdTAwRkNzc2VsIChzaWVoZSBTdWJ0eXAtQmxcdTAwRjZja2UgaW4gZGVyIFRZUC1EZXRhaWxhbnNpY2h0KS5cbmZ1bmN0aW9uIHNhbWVFbnRyeShhLCBiKSB7XG4gIHJldHVybiAhIWEgJiYgISFiICYmIGEudHlwZUtleSA9PT0gYi50eXBlS2V5ICYmIGEuc3VidHlwZUtleSA9PT0gYi5zdWJ0eXBlS2V5O1xufVxuXG4vLyBaZW50cmFsZXIgVFlQLS9TVUJUWVAtSW5kZXggXHUwMEZDYmVyIGFsbGUgTWFya2Rvd24tRGF0ZWllbiAoUGZhZCAtPiBXZXJ0ZSkuXG4vL1xuLy8gWndlY2s6IGRpZSBGYXJiLU1vZHVsZSBoaW5nZW4gYmlzaGVyIGFsbGUgZGlyZWt0IGFuIG1ldGFkYXRhQ2FjaGUgXCJjaGFuZ2VkXCJcbi8vIHVuZCBcInJlc29sdmVkXCIgLSBiZWlkZSBmZXVlcm4gYmVpIEpFREVSIFx1MDBDNG5kZXJ1bmcgYW4gaXJnZW5kZWluZXIgTm90aXogKGJlaW1cbi8vIFRpcHBlbiBldHdhIGFsbGUgendlaSBTZWt1bmRlbiksIHVuZCBqZWRlcyBNb2R1bCBmXHUwMEU0cmJ0ZSBkYXJhdWZoaW4gc2VpbmVcbi8vIGtvbXBsZXR0ZSBBbnNpY2h0IG5ldSwgZG9wcGVsdC4gRGVyIEluZGV4IHZlcmdsZWljaHQgc3RhdHRkZXNzZW4gamUgRGF0ZWksIG9iXG4vLyBzaWNoIFRZUCBvZGVyIFNVQlRZUCB0YXRzXHUwMEU0Y2hsaWNoIGdlXHUwMEU0bmRlcnQgaGF0IChiencuIGVpbmUgTm90aXogaGluenVrYW0vXG4vLyB3ZWdmaWVsKSwgdW5kIGZldWVydCBudXIgZGFubiBzZWluIGVpZ2VuZXMgXCJjaGFuZ2VcIi1FdmVudCAoQXJndW1lbnQ6IFNldCBkZXJcbi8vIGJldHJvZmZlbmVuIFBmYWRlKS4gTm9ybWFsZXMgU2NocmVpYmVuIGxcdTAwRjZzdCBkYW1pdCBnYXIga2VpbiBOZXUtRWluZlx1MDBFNHJiZW4gbWVociBhdXMuXG4vL1xuLy8gWnVzXHUwMEU0dHpsaWNoIGhcdTAwRTRsdCBlciBkaWUgdmF1bHQtd2VpdGVuIFpcdTAwRTRobHVuZ2VuIChUWVAtTGlzdGUsIFNVQlRZUC1MaXN0ZSxcbi8vIFBpY2tlciwgZ2V0VHlwZXMoKSBmXHUwMEZDciBUZW1wbGF0ZXIpIHp3aXNjaGVuZ2VzcGVpY2hlcnQsIHN0YXR0IHNpZSBiZWkgamVkZW1cbi8vIEF1ZnJ1ZiBwZXIgU2NhbiBcdTAwRkNiZXIgYWxsZSBOb3RpemVuIG5ldSB6dSBiZXJlY2huZW4uXG5jbGFzcyBUeXBJbmRleCBleHRlbmRzIEV2ZW50cyB7XG4gIGNvbnN0cnVjdG9yKHBsdWdpbikge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gICAgdGhpcy5hcHAgPSBwbHVnaW4uYXBwO1xuICAgIHRoaXMuZW50cmllcyA9IG5ldyBNYXAoKTtcbiAgICB0aGlzLmJ1aWx0ID0gZmFsc2U7XG4gICAgdGhpcy5hZ2dyZWdhdGVzID0gbnVsbDtcbiAgICB0aGlzLnBlbmRpbmdQYXRocyA9IG5ldyBTZXQoKTtcbiAgICB0aGlzLmZsdXNoID0gZGVib3VuY2UoKCkgPT4ge1xuICAgICAgY29uc3QgcGF0aHMgPSB0aGlzLnBlbmRpbmdQYXRocztcbiAgICAgIHRoaXMucGVuZGluZ1BhdGhzID0gbmV3IFNldCgpO1xuICAgICAgdGhpcy50cmlnZ2VyKFwiY2hhbmdlXCIsIHBhdGhzKTtcbiAgICB9LCBGTFVTSF9ERUxBWV9NUyk7XG4gIH1cblxuICByZWdpc3RlcigpIHtcbiAgICBjb25zdCB7IHBsdWdpbiwgYXBwIH0gPSB0aGlzO1xuICAgIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC5tZXRhZGF0YUNhY2hlLm9uKFwiY2hhbmdlZFwiLCAoZmlsZSkgPT4gdGhpcy51cGRhdGUoZmlsZSkpKTtcbiAgICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAubWV0YWRhdGFDYWNoZS5vbihcImRlbGV0ZWRcIiwgKGZpbGUpID0+IHRoaXMucmVtb3ZlKGZpbGUucGF0aCkpKTtcbiAgICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJyZW5hbWVcIiwgKGZpbGUsIG9sZFBhdGgpID0+IHRoaXMucmVuYW1lKGZpbGUsIG9sZFBhdGgpKSk7XG4gICAgLy8gXCJFeGNsdWRlZCBmaWxlc1wiLUxpc3RlIGdlXHUwMEU0bmRlcnQgKHNpZWhlIHJlZ2lzdGVyVHlwVmlldykgLSBkaWUgRWludHJcdTAwRTRnZVxuICAgIC8vIHNlbGJzdCBibGVpYmVuIGdcdTAwRkNsdGlnLCBudXIgZGllIGRhcmF1cyBnZWZpbHRlcnRlbiBaXHUwMEU0aGx1bmdlbiBuaWNodC5cbiAgICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJjb25maWctY2hhbmdlZFwiLCAoKSA9PiAodGhpcy5hZ2dyZWdhdGVzID0gbnVsbCkpKTtcblxuICAgIC8vIEJlaW0gQXBwLVN0YXJ0IGthbm4gZGVyIGVyc3RlIFp1Z3JpZmYgKGxhenksIHNpZWhlIGVuc3VyZUJ1aWx0KSBub2NoIHZvclxuICAgIC8vIGRlbSB2b2xsc3RcdTAwRTRuZGlnIGdlbGFkZW5lbiBNZXRhZGF0YUNhY2hlIGxpZWdlbi4gRWlubWFsaWcgbmFjaCBkZXNzZW5cbiAgICAvLyBlcnN0ZW0ga29tcGxldHRlbiBBdWZsXHUwMEY2c3VuZ3NkdXJjaGxhdWYgbmV1IGF1ZmJhdWVuOyBBYndlaWNodW5nZW4gbGFuZGVuXG4gICAgLy8gZGFiZWkgd2llIGplZGUgYW5kZXJlIFx1MDBDNG5kZXJ1bmcgaW0gXCJjaGFuZ2VcIi1FdmVudC5cbiAgICBjb25zdCByZXNvbHZlZFJlZiA9IGFwcC5tZXRhZGF0YUNhY2hlLm9uKFwicmVzb2x2ZWRcIiwgKCkgPT4ge1xuICAgICAgYXBwLm1ldGFkYXRhQ2FjaGUub2ZmcmVmKHJlc29sdmVkUmVmKTtcbiAgICAgIHRoaXMucmVidWlsZCgpO1xuICAgIH0pO1xuICAgIHBsdWdpbi5yZWdpc3RlckV2ZW50KHJlc29sdmVkUmVmKTtcblxuICAgIHBsdWdpbi5yZWdpc3RlcigoKSA9PiB0aGlzLmZsdXNoLmNhbmNlbCgpKTtcbiAgfVxuXG4gIHJlYWQoZmlsZSkge1xuICAgIGNvbnN0IGZyb250bWF0dGVyID0gdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaWxlQ2FjaGUoZmlsZSk/LmZyb250bWF0dGVyO1xuICAgIGNvbnN0IHJhd1R5cGUgPSBwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBUWVBfUFJPUEVSVFkpID8/IG51bGw7XG4gICAgY29uc3QgcmF3U3VidHlwZSA9IHByb3BlcnR5VmFsdWUoZnJvbnRtYXR0ZXIsIFNVQlRZUF9QUk9QRVJUWSkgPz8gbnVsbDtcbiAgICByZXR1cm4geyB0eXBlS2V5OiB0eXBlS2V5T2YocmF3VHlwZSksIHJhd1R5cGUsIHN1YnR5cGVLZXk6IHR5cGVLZXlPZihyYXdTdWJ0eXBlKSwgcmF3U3VidHlwZSB9O1xuICB9XG5cbiAgZW5zdXJlQnVpbHQoKSB7XG4gICAgaWYgKCF0aGlzLmJ1aWx0KSB0aGlzLnJlYnVpbGQoKTtcbiAgfVxuXG4gIHJlYnVpbGQoKSB7XG4gICAgY29uc3QgcHJldmlvdXMgPSB0aGlzLmVudHJpZXM7XG4gICAgY29uc3Qgd2FzQnVpbHQgPSB0aGlzLmJ1aWx0O1xuICAgIHRoaXMuZW50cmllcyA9IG5ldyBNYXAoKTtcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpKSB0aGlzLmVudHJpZXMuc2V0KGZpbGUucGF0aCwgdGhpcy5yZWFkKGZpbGUpKTtcbiAgICB0aGlzLmJ1aWx0ID0gdHJ1ZTtcbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsO1xuICAgIGlmICghd2FzQnVpbHQpIHJldHVybjtcblxuICAgIGZvciAoY29uc3QgW3BhdGgsIGVudHJ5XSBvZiB0aGlzLmVudHJpZXMpIHtcbiAgICAgIGlmICghc2FtZUVudHJ5KHByZXZpb3VzLmdldChwYXRoKSwgZW50cnkpKSB0aGlzLnBlbmRpbmdQYXRocy5hZGQocGF0aCk7XG4gICAgfVxuICAgIGZvciAoY29uc3QgcGF0aCBvZiBwcmV2aW91cy5rZXlzKCkpIHtcbiAgICAgIGlmICghdGhpcy5lbnRyaWVzLmhhcyhwYXRoKSkgdGhpcy5wZW5kaW5nUGF0aHMuYWRkKHBhdGgpO1xuICAgIH1cbiAgICBpZiAodGhpcy5wZW5kaW5nUGF0aHMuc2l6ZSA+IDApIHRoaXMuZmx1c2goKTtcbiAgfVxuXG4gIG1hcmtDaGFuZ2VkKHBhdGgpIHtcbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsO1xuICAgIHRoaXMucGVuZGluZ1BhdGhzLmFkZChwYXRoKTtcbiAgICB0aGlzLmZsdXNoKCk7XG4gIH1cblxuICB1cGRhdGUoZmlsZSkge1xuICAgIC8vIFZvciBkZW0gZXJzdGVuIFp1Z3JpZmYgZ2lidCBlcyBub2NoIGtlaW5lbiB2ZXJhbHRldGVuIFN0YW5kIC0gZGVyXG4gICAgLy8gc3BcdTAwRTR0ZXJlIGxhenkgQXVmYmF1IGxpZXN0IG9obmVoaW4gZnJpc2NoIGF1cyBkZW0gTWV0YWRhdGFDYWNoZS5cbiAgICBpZiAoIXRoaXMuYnVpbHQgfHwgIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpIHx8IGZpbGUuZXh0ZW5zaW9uICE9PSBcIm1kXCIpIHJldHVybjtcbiAgICBjb25zdCBuZXh0ID0gdGhpcy5yZWFkKGZpbGUpO1xuICAgIGlmIChzYW1lRW50cnkodGhpcy5lbnRyaWVzLmdldChmaWxlLnBhdGgpLCBuZXh0KSkgcmV0dXJuO1xuICAgIHRoaXMuZW50cmllcy5zZXQoZmlsZS5wYXRoLCBuZXh0KTtcbiAgICB0aGlzLm1hcmtDaGFuZ2VkKGZpbGUucGF0aCk7XG4gIH1cblxuICByZW1vdmUocGF0aCkge1xuICAgIGlmICghdGhpcy5idWlsdCB8fCAhdGhpcy5lbnRyaWVzLmRlbGV0ZShwYXRoKSkgcmV0dXJuO1xuICAgIHRoaXMubWFya0NoYW5nZWQocGF0aCk7XG4gIH1cblxuICByZW5hbWUoZmlsZSwgb2xkUGF0aCkge1xuICAgIGlmICghdGhpcy5idWlsdCkgcmV0dXJuO1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5lbnRyaWVzLmdldChvbGRQYXRoKTtcbiAgICBpZiAoZW50cnkpIHtcbiAgICAgIHRoaXMuZW50cmllcy5kZWxldGUob2xkUGF0aCk7XG4gICAgICB0aGlzLm1hcmtDaGFuZ2VkKG9sZFBhdGgpO1xuICAgIH1cbiAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlICYmIGZpbGUuZXh0ZW5zaW9uID09PSBcIm1kXCIpIHtcbiAgICAgIHRoaXMuZW50cmllcy5zZXQoZmlsZS5wYXRoLCBlbnRyeSA/PyB0aGlzLnJlYWQoZmlsZSkpO1xuICAgICAgdGhpcy5tYXJrQ2hhbmdlZChmaWxlLnBhdGgpO1xuICAgIH1cbiAgfVxuXG4gIGVudHJ5Rm9yKGZpbGUpIHtcbiAgICBpZiAoIWZpbGUpIHJldHVybiBFTVBUWV9FTlRSWTtcbiAgICB0aGlzLmVuc3VyZUJ1aWx0KCk7XG4gICAgcmV0dXJuIHRoaXMuZW50cmllcy5nZXQoZmlsZS5wYXRoKSA/PyBFTVBUWV9FTlRSWTtcbiAgfVxuXG4gIC8vIFRZUC1TY2hsXHUwMEZDc3NlbCAoc2llaGUgdHlwZUtleU9mKSBvZGVyIG51bGwuIEZcdTAwRkNyIGVpbmVuIHNhdWJlcmVuIFdlcnQgaXN0IGRhc1xuICAvLyBzY2hsaWNodCBkZXIgVFlQLU5hbWUgc2VsYnN0LlxuICB0eXBlT2YoZmlsZSkge1xuICAgIHJldHVybiB0aGlzLmVudHJ5Rm9yKGZpbGUpLnR5cGVLZXk7XG4gIH1cblxuICAvLyBTVUJUWVAtU2NobFx1MDBGQ3NzZWwgKHNpZWhlIHR5cGVLZXlPZikgb2RlciBudWxsLlxuICBzdWJ0eXBlT2YoZmlsZSkge1xuICAgIHJldHVybiB0aGlzLmVudHJ5Rm9yKGZpbGUpLnN1YnR5cGVLZXk7XG4gIH1cblxuICAvLyBFaW4gdGF0c1x1MDBFNGNobGljaGVyIEZyb250bWF0dGVyLVdlcnQgenUgZWluZW0gU2NobFx1MDBGQ3NzZWwgLSBmXHUwMEZDciBBbnplaWdlLCBTdWNoZVxuICAvLyB1bmQgTm9ybWFsaXNpZXJ1bmcgdW5yZWdpc3RyaWVydGVyIEVpbnRyXHUwMEU0Z2UgKGFsbGUgTm90aXplbiBlaW5lcyBTY2hsXHUwMEZDc3NlbHNcbiAgLy8gaGFiZW4gcGVyIERlZmluaXRpb24gZGllc2VsYmUgUm9oZm9ybSkuXG4gIHJhd1ZhbHVlT2YodHlwZUtleSkge1xuICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZSgpLnJhd0J5S2V5LmdldCh0eXBlS2V5KTtcbiAgfVxuXG4gIC8vIFNhdWJlcmVyIFdlcnQgPSBFaW56ZWx3ZXJ0IG9obmUgTGVlcnplaWNoZW4gYW0gUmFuZC4gS2xlaW4gZ2VzY2hyaWViZW5lXG4gIC8vIFdlcnRlIHpcdTAwRTRobGVuIGhpZXIgYWxzIHNhdWJlciAoc2llIHNpbmQgZWluIGdcdTAwRkNsdGlnZXIsIG51ciBub2NoIG5pY2h0XG4gIC8vIHJlZ2lzdHJpZXJ0ZXIgVFlQLU5hbWUpLCBMaXN0ZW4gdW5kIFJhbmRsZWVyemVpY2hlbiBuaWNodC5cbiAgaXNDbGVhbktleSh0eXBlS2V5KSB7XG4gICAgY29uc3QgcmF3ID0gdGhpcy5yYXdWYWx1ZU9mKHR5cGVLZXkpO1xuICAgIHJldHVybiByYXcgIT09IHVuZGVmaW5lZCAmJiAhQXJyYXkuaXNBcnJheShyYXcpICYmIHR5cGVLZXkgPT09IHR5cGVLZXkudHJpbSgpO1xuICB9XG5cbiAgLy8gRGF0ZWllbiBtaXQgZ2VuYXUgZGllc2VtIFRZUC1TY2hsXHUwMEZDc3NlbCwgdW50ZXIgQmVhY2h0dW5nIGRlclxuICAvLyBcIklnbm9yaWVydGUgTm90aXplbiBiZXJcdTAwRkNja3NpY2h0aWdlblwiLUVpbnN0ZWxsdW5nLlxuICBmaWxlc1dpdGhUeXBlKHR5cGVLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5maWxlc01hdGNoaW5nKChlbnRyeSkgPT4gZW50cnkudHlwZUtleSA9PT0gdHlwZUtleSk7XG4gIH1cblxuICAvLyBEYXRlaWVuIG1pdCBnZW5hdSBkaWVzZW0gVFlQLSB1bmQgU1VCVFlQLVNjaGxcdTAwRkNzc2VsLlxuICBmaWxlc1dpdGhTdWJ0eXBlKHR5cGVLZXksIHN1YnR5cGVLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5maWxlc01hdGNoaW5nKChlbnRyeSkgPT4gZW50cnkudHlwZUtleSA9PT0gdHlwZUtleSAmJiBlbnRyeS5zdWJ0eXBlS2V5ID09PSBzdWJ0eXBlS2V5KTtcbiAgfVxuXG4gIGZpbGVzTWF0Y2hpbmcocHJlZGljYXRlKSB7XG4gICAgdGhpcy5lbnN1cmVCdWlsdCgpO1xuICAgIGNvbnN0IGluY2x1ZGVJZ25vcmVkID0gISF0aGlzLnBsdWdpbi5zZXR0aW5ncy5pbmNsdWRlSWdub3JlZEZpbGVzO1xuICAgIGNvbnN0IGZpbGVzID0gW107XG4gICAgZm9yIChjb25zdCBbcGF0aCwgZW50cnldIG9mIHRoaXMuZW50cmllcykge1xuICAgICAgaWYgKCFwcmVkaWNhdGUoZW50cnkpKSBjb250aW51ZTtcbiAgICAgIGlmICghaW5jbHVkZUlnbm9yZWQgJiYgdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5pc1VzZXJJZ25vcmVkKHBhdGgpKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgocGF0aCk7XG4gICAgICBpZiAoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSBmaWxlcy5wdXNoKGZpbGUpO1xuICAgIH1cbiAgICByZXR1cm4gZmlsZXM7XG4gIH1cblxuICAvLyBSZXNwZWt0aWVydCBzdGFuZGFyZG1cdTAwRTRcdTAwREZpZyBPYnNpZGlhbnMgZWlnZW5lIFwiRXhjbHVkZWQgZmlsZXNcIi1MaXN0ZSAtIGRvcnRcbiAgLy8gdHJhZ2VuIGF1Y2ggUGx1Z2lucyB3aWUgSGlkZSBGb2xkZXJzIGF1c2dlYmxlbmRldGUgT3JkbmVyIGVpbi4gXHUwMERDYmVyIGRpZVxuICAvLyBFaW5zdGVsbHVuZyBcIklnbm9yaWVydGUgTm90aXplbiBiZXJcdTAwRkNja3NpY2h0aWdlblwiIGFic2NoYWx0YmFyLlxuICAvL1xuICAvLyBFaW5lIE5vdGl6IG9obmUgVFlQIGhhdCBrZWluZW4gU1VCVFlQLUtvbnRleHQuXG4gIGFnZ3JlZ2F0ZSgpIHtcbiAgICB0aGlzLmVuc3VyZUJ1aWx0KCk7XG4gICAgY29uc3QgaW5jbHVkZUlnbm9yZWQgPSAhIXRoaXMucGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXM7XG4gICAgaWYgKHRoaXMuYWdncmVnYXRlcz8uaW5jbHVkZUlnbm9yZWQgPT09IGluY2x1ZGVJZ25vcmVkKSByZXR1cm4gdGhpcy5hZ2dyZWdhdGVzO1xuXG4gICAgY29uc3QgY291bnRzID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IHJhd0J5S2V5ID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IHN1YnR5cGVzQnlUeXBlID0gbmV3IE1hcCgpO1xuICAgIGxldCBub1R5cGUgPSAwO1xuICAgIGZvciAoY29uc3QgW3BhdGgsIHsgdHlwZUtleSwgcmF3VHlwZSwgc3VidHlwZUtleSwgcmF3U3VidHlwZSB9XSBvZiB0aGlzLmVudHJpZXMpIHtcbiAgICAgIGlmICghaW5jbHVkZUlnbm9yZWQgJiYgdGhpcy5hcHAubWV0YWRhdGFDYWNoZS5pc1VzZXJJZ25vcmVkKHBhdGgpKSBjb250aW51ZTtcbiAgICAgIGlmICh0eXBlS2V5ID09PSBudWxsKSB7XG4gICAgICAgIG5vVHlwZSsrO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvdW50cy5zZXQodHlwZUtleSwgKGNvdW50cy5nZXQodHlwZUtleSkgPz8gMCkgKyAxKTtcbiAgICAgIGlmICghcmF3QnlLZXkuaGFzKHR5cGVLZXkpKSByYXdCeUtleS5zZXQodHlwZUtleSwgcmF3VHlwZSk7XG4gICAgICBsZXQgYnVja2V0ID0gc3VidHlwZXNCeVR5cGUuZ2V0KHR5cGVLZXkpO1xuICAgICAgaWYgKCFidWNrZXQpIHtcbiAgICAgICAgYnVja2V0ID0geyBjb3VudHM6IG5ldyBNYXAoKSwgbm9TdWJ0eXBlOiAwLCByYXdCeUtleTogbmV3IE1hcCgpIH07XG4gICAgICAgIHN1YnR5cGVzQnlUeXBlLnNldCh0eXBlS2V5LCBidWNrZXQpO1xuICAgICAgfVxuICAgICAgaWYgKHN1YnR5cGVLZXkgPT09IG51bGwpIHtcbiAgICAgICAgYnVja2V0Lm5vU3VidHlwZSsrO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYnVja2V0LmNvdW50cy5zZXQoc3VidHlwZUtleSwgKGJ1Y2tldC5jb3VudHMuZ2V0KHN1YnR5cGVLZXkpID8/IDApICsgMSk7XG4gICAgICAgIGlmICghYnVja2V0LnJhd0J5S2V5LmhhcyhzdWJ0eXBlS2V5KSkgYnVja2V0LnJhd0J5S2V5LnNldChzdWJ0eXBlS2V5LCByYXdTdWJ0eXBlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5hZ2dyZWdhdGVzID0geyBpbmNsdWRlSWdub3JlZCwgY291bnRzLCBub1R5cGUsIHJhd0J5S2V5LCBzdWJ0eXBlc0J5VHlwZSB9O1xuICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZXM7XG4gIH1cblxuICAvLyBad2lzY2hlbmdlc3BlaWNoZXJ0IC0gZGllIGdlbGllZmVydGVuIE1hcHMgbmljaHQgdmVyXHUwMEU0bmRlcm4uXG4gIHR5cGVDb3VudHMoKSB7XG4gICAgY29uc3QgeyBjb3VudHMsIG5vVHlwZSB9ID0gdGhpcy5hZ2dyZWdhdGUoKTtcbiAgICByZXR1cm4geyBjb3VudHMsIG5vVHlwZSB9O1xuICB9XG5cbiAgLy8gVFlQIC0+IHsgY291bnRzOiBNYXAoU1VCVFlQLVNjaGxcdTAwRkNzc2VsIC0+IEFuemFobCksIG5vU3VidHlwZSwgcmF3QnlLZXkgfS5cbiAgLy8gWndpc2NoZW5nZXNwZWljaGVydCAtIG5pY2h0IHZlclx1MDBFNG5kZXJuLlxuICBzdWJ0eXBlQ291bnRzKCkge1xuICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZSgpLnN1YnR5cGVzQnlUeXBlO1xuICB9XG5cbiAgc3VidHlwZUJ1Y2tldCh0eXBlS2V5KSB7XG4gICAgcmV0dXJuIHRoaXMuc3VidHlwZUNvdW50cygpLmdldCh0eXBlS2V5KSA/PyBFTVBUWV9CVUNLRVQ7XG4gIH1cbn1cblxuY29uc3QgRU1QVFlfQlVDS0VUID0gT2JqZWN0LmZyZWV6ZSh7IGNvdW50czogbmV3IE1hcCgpLCBub1N1YnR5cGU6IDAsIHJhd0J5S2V5OiBuZXcgTWFwKCkgfSk7XG5cbm1vZHVsZS5leHBvcnRzID0geyBUeXBJbmRleCwgdHlwZUtleU9mLCBwcm9wZXJ0eVZhbHVlLCBzZXRDYW5vbmljYWxQcm9wZXJ0eSwgZGVsZXRlUHJvcGVydHksIFRZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZIH07XG4iLCAiY29uc3QgeyB0eXBlS2V5T2YsIHByb3BlcnR5VmFsdWUsIHNldENhbm9uaWNhbFByb3BlcnR5LCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcblxuLy8gU3VidHlwLU5hbWVuIHdlcmRlbiAoYW5kZXJzIGFscyBUWVBlbiwgc2llaGUgbm9ybWFsaXplVHlwZU5hbWUpIG1pdCBncm9cdTAwREZlbVxuLy8gQW5mYW5nc2J1Y2hzdGFiZW4gamUgV29ydCBnZXNjaHJpZWJlbiwgZGVyIFJlc3Qga2xlaW46IFwia3VyeiBHRVNDSElDSFRFXCIgXHUyMTkyXG4vLyBcIkt1cnogR2VzY2hpY2h0ZVwiLiBEaWUgUHJvcGVydHkgU1VCVFlQIHNlbGJzdCBibGVpYnQgaW4gR3JvXHUwMERGYnVjaHN0YWJlbi5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVN1YnR5cGVOYW1lKHJhdykge1xuICByZXR1cm4gcmF3LnRyaW0oKS5yZXBsYWNlKC9cXFMrL2csICh3b3JkKSA9PiB3b3JkLmNoYXJBdCgwKS50b0xvY2FsZVVwcGVyQ2FzZShcImRlXCIpICsgd29yZC5zbGljZSgxKS50b0xvY2FsZUxvd2VyQ2FzZShcImRlXCIpKTtcbn1cblxuLy8gUmVnaXN0cmllcnRlIFNVQlRZUGVuIGplIFRZUCAoc2V0dGluZ3MudHlwZVN1YnR5cGVzKTpcbi8vICAgeyBbVFlQXTogeyBbU1VCVFlQXTogeyBmcm9udG1hdHRlcjogey4uLn0sIGZsb2F0aW5nS2V5czogWy4uLl0sIGFib3ZlU3RhbmRhcmQ/OiB0cnVlIH0gfSB9XG4vLyBFaW4gU3VidHlwIGdlaFx1MDBGNnJ0IGltbWVyIHp1IGdlbmF1IGVpbmVtIFRZUDsgZGVyc2VsYmUgTmFtZSBkYXJmIGFiZXIgKGFsc1xuLy8gZWlnZW5zdFx1MDBFNG5kaWdlciBTdWJ0eXApIGF1Y2ggdW50ZXIgZWluZW0gYW5kZXJlbiBUWVAgdm9ya29tbWVuLiBEaWVcbi8vIFJlaWhlbmZvbGdlIGRlciBTY2hsXHUwMEZDc3NlbCBpc3QgZGllIEFuemVpZ2VyZWloZW5mb2xnZSBkZXIgQmxcdTAwRjZja2UgaW4gZGVyXG4vLyBUWVAtRGV0YWlsYW5zaWNodC4gZnJvbnRtYXR0ZXIgZXJnXHUwMEU0bnp0IGJ6dy4gXHUwMEZDYmVyc2NocmVpYnQgZGFzXG4vLyBTdGFuZGFyZC1Gcm9udG1hdHRlciBkZXMgVFlQcywgZmxvYXRpbmdLZXlzIHdpZSB0eXBlRmxvYXRpbmdLZXlzLlxuXG5mdW5jdGlvbiBnZXRTdWJ0eXBlTmFtZXMoc2V0dGluZ3MsIHR5cGUpIHtcbiAgcmV0dXJuIE9iamVjdC5rZXlzKHNldHRpbmdzLnR5cGVTdWJ0eXBlcz8uW3R5cGVdID8/IHt9KTtcbn1cblxuZnVuY3Rpb24gZ2V0U3VidHlwZShzZXR0aW5ncywgdHlwZSwgc3VidHlwZSkge1xuICByZXR1cm4gc2V0dGluZ3MudHlwZVN1YnR5cGVzPy5bdHlwZV0/LltzdWJ0eXBlXSA/PyBudWxsO1xufVxuXG5mdW5jdGlvbiBlbnN1cmVTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKSB7XG4gIGlmICghc2V0dGluZ3MudHlwZVN1YnR5cGVzKSBzZXR0aW5ncy50eXBlU3VidHlwZXMgPSB7fTtcbiAgaWYgKCFzZXR0aW5ncy50eXBlU3VidHlwZXNbdHlwZV0pIHNldHRpbmdzLnR5cGVTdWJ0eXBlc1t0eXBlXSA9IHt9O1xuICBjb25zdCBieU5hbWUgPSBzZXR0aW5ncy50eXBlU3VidHlwZXNbdHlwZV07XG4gIGlmICghYnlOYW1lW3N1YnR5cGVdKSBieU5hbWVbc3VidHlwZV0gPSB7IGZyb250bWF0dGVyOiB7fSwgZmxvYXRpbmdLZXlzOiBbXSB9O1xuICByZXR1cm4gYnlOYW1lW3N1YnR5cGVdO1xufVxuXG4vLyBCZWltIFVtYmVuZW5uZW4gZWluZXMgVFlQczogU3VidHlwZW4gd2FuZGVybiB1bnRlciBkZW4gbmV1ZW4gTmFtZW4gbWl0LlxuZnVuY3Rpb24gbW92ZVR5cGVTdWJ0eXBlcyhzZXR0aW5ncywgb2xkVHlwZSwgbmV3VHlwZSkge1xuICBpZiAoIXNldHRpbmdzLnR5cGVTdWJ0eXBlcz8uW29sZFR5cGVdKSByZXR1cm47XG4gIHNldHRpbmdzLnR5cGVTdWJ0eXBlc1tuZXdUeXBlXSA9IHNldHRpbmdzLnR5cGVTdWJ0eXBlc1tvbGRUeXBlXTtcbiAgZGVsZXRlIHNldHRpbmdzLnR5cGVTdWJ0eXBlc1tvbGRUeXBlXTtcbn1cblxuZnVuY3Rpb24gZGVsZXRlVHlwZVN1YnR5cGVzKHNldHRpbmdzLCB0eXBlKSB7XG4gIGlmIChzZXR0aW5ncy50eXBlU3VidHlwZXMpIGRlbGV0ZSBzZXR0aW5ncy50eXBlU3VidHlwZXNbdHlwZV07XG59XG5cbi8vIEplZGVyIEtleSBnZWhcdTAwRjZydCB6dSBnZW5hdSBlaW5lbSBCbG9jayBlaW5lcyBUWVBzIChTdGFuZGFyZC1Gcm9udG1hdHRlciBPREVSXG4vLyBlaW4gU3VidHlwLCBBYmdsZWljaCBvaG5lIEJlYWNodHVuZyBkZXIgR3JvXHUwMERGLS9LbGVpbnNjaHJlaWJ1bmcpLiBLb21tdCBlclxuLy8gdHJvdHpkZW0gbWVocmZhY2ggdm9yIChcdTAwRTRsdGVyZSBEYXRlbiwgWnVzYW1tZW5sZWdlbiB6d2VpZXIgVFlQZW4pLCBibGVpYnQgZXJcbi8vIGltIGVyc3RlbiBCbG9jayAtIFN0YW5kYXJkLUZyb250bWF0dGVyIHZvciBkZW4gU3VidHlwZW4gaW4gaWhyZXJcbi8vIFJlaWhlbmZvbGdlIC0gdW5kIHZlcnNjaHdpbmRldCBzYW10IEZsb2F0aW5nLU1hcmtpZXJ1bmcgYXVzIGRlbiBcdTAwRkNicmlnZW4uXG4vLyBMaWVmZXJ0IHRydWUgYmVpIGVpbmVyIFx1MDBDNG5kZXJ1bmcuXG5mdW5jdGlvbiBlbmZvcmNlVW5pcXVlS2V5cyhzZXR0aW5ncywgdHlwZSkge1xuICBjb25zdCBzZWVuID0gbmV3IFNldChPYmplY3Qua2V5cyhzZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdID8/IHt9KS5tYXAoKGtleSkgPT4ga2V5LnRvTG93ZXJDYXNlKCkpKTtcbiAgbGV0IGNoYW5nZWQgPSBmYWxzZTtcbiAgZm9yIChjb25zdCBzdWJ0eXBlIG9mIGdldFN1YnR5cGVOYW1lcyhzZXR0aW5ncywgdHlwZSkpIHtcbiAgICBjb25zdCBkYXRhID0gc2V0dGluZ3MudHlwZVN1YnR5cGVzW3R5cGVdW3N1YnR5cGVdO1xuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGRhdGEuZnJvbnRtYXR0ZXIpKSB7XG4gICAgICBpZiAoa2V5ID09PSBcIlwiKSBjb250aW51ZTtcbiAgICAgIGNvbnN0IGxvd2VyID0ga2V5LnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAoc2Vlbi5oYXMobG93ZXIpKSB7XG4gICAgICAgIGRlbGV0ZSBkYXRhLmZyb250bWF0dGVyW2tleV07XG4gICAgICAgIGRhdGEuZmxvYXRpbmdLZXlzID0gZGF0YS5mbG9hdGluZ0tleXMuZmlsdGVyKChrKSA9PiBrICE9PSBrZXkpO1xuICAgICAgICBjaGFuZ2VkID0gdHJ1ZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNlZW4uYWRkKGxvd2VyKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIGNoYW5nZWQ7XG59XG5cbi8vIFp1c2FtbWVubGVnZW4gendlaWVyIFRZUGVuOiBTdWJ0eXBlbiwgZGllIGVzIG51ciBiZWkgc291cmNlIGdpYnQsIHdlcmRlblxuLy8gXHUwMEZDYmVybm9tbWVuLiBHbGVpY2huYW1pZ2UgQmxcdTAwRjZja2Ugd2VyZGVuIHZlcmVpbmlndCAtIGJlaSBnbGVpY2hlbSBLZXlcbi8vIGdld2lubmVuIFdlcnQgdW5kIEZsb2F0aW5nLU1hcmtpZXJ1bmcgZGVzIFppZWxzLCBLZXlzIG51ciBhdXMgc291cmNlXG4vLyB3ZXJkZW4gaGludGVuIGFuZ2VoXHUwMEU0bmd0LiBEYW5hY2ggZ2lsdCB3aWVkZXIgXCJqZWRlciBLZXkgbnVyIGluIGVpbmVtXG4vLyBCbG9ja1wiIChlbmZvcmNlVW5pcXVlS2V5cykuXG5mdW5jdGlvbiBtZXJnZVR5cGVTdWJ0eXBlcyhzZXR0aW5ncywgc291cmNlLCB0YXJnZXQpIHtcbiAgY29uc3Qgc291cmNlU3VidHlwZXMgPSBzZXR0aW5ncy50eXBlU3VidHlwZXM/Lltzb3VyY2VdO1xuICBpZiAoIXNvdXJjZVN1YnR5cGVzKSByZXR1cm47XG4gIGZvciAoY29uc3QgW25hbWUsIHNvdXJjZURhdGFdIG9mIE9iamVjdC5lbnRyaWVzKHNvdXJjZVN1YnR5cGVzKSkge1xuICAgIGNvbnN0IHRhcmdldERhdGEgPSBnZXRTdWJ0eXBlKHNldHRpbmdzLCB0YXJnZXQsIG5hbWUpO1xuICAgIGlmICghdGFyZ2V0RGF0YSkge1xuICAgICAgZW5zdXJlU3VidHlwZShzZXR0aW5ncywgdGFyZ2V0LCBuYW1lKTtcbiAgICAgIHNldHRpbmdzLnR5cGVTdWJ0eXBlc1t0YXJnZXRdW25hbWVdID0gc291cmNlRGF0YTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCB0YXJnZXRMb3dlciA9IG5ldyBTZXQoT2JqZWN0LmtleXModGFyZ2V0RGF0YS5mcm9udG1hdHRlcikubWFwKChrZXkpID0+IGtleS50b0xvd2VyQ2FzZSgpKSk7XG4gICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoc291cmNlRGF0YS5mcm9udG1hdHRlcikpIHtcbiAgICAgIGlmIChrZXkgPT09IFwiXCIgfHwgdGFyZ2V0TG93ZXIuaGFzKGtleS50b0xvd2VyQ2FzZSgpKSkgY29udGludWU7XG4gICAgICB0YXJnZXREYXRhLmZyb250bWF0dGVyW2tleV0gPSB2YWx1ZTtcbiAgICAgIGlmIChzb3VyY2VEYXRhLmZsb2F0aW5nS2V5cy5pbmNsdWRlcyhrZXkpKSB0YXJnZXREYXRhLmZsb2F0aW5nS2V5cy5wdXNoKGtleSk7XG4gICAgfVxuICB9XG4gIGRlbGV0ZSBzZXR0aW5ncy50eXBlU3VidHlwZXNbc291cmNlXTtcbiAgZW5mb3JjZVVuaXF1ZUtleXMoc2V0dGluZ3MsIHRhcmdldCk7XG59XG5cbi8vIFVtYmVuZW5uZW4gZWluZXMgU3VidHlwcyBpbm5lcmhhbGIgc2VpbmVzIFRZUHMgLSBkZXIgQmxvY2sgYmVoXHUwMEU0bHQgZGFiZWlcbi8vIHNlaW5lIFBvc2l0aW9uIChBbnplaWdlcmVpaGVuZm9sZ2UgPSBTY2hsXHUwMEZDc3NlbHJlaWhlbmZvbGdlKS5cbmZ1bmN0aW9uIHJlbmFtZVN1YnR5cGUoc2V0dGluZ3MsIHR5cGUsIG9sZE5hbWUsIG5ld05hbWUpIHtcbiAgY29uc3QgYnlOYW1lID0gc2V0dGluZ3MudHlwZVN1YnR5cGVzPy5bdHlwZV07XG4gIGlmICghYnlOYW1lPy5bb2xkTmFtZV0gfHwgb2xkTmFtZSA9PT0gbmV3TmFtZSkgcmV0dXJuO1xuICBzZXR0aW5ncy50eXBlU3VidHlwZXNbdHlwZV0gPSBPYmplY3QuZnJvbUVudHJpZXMoXG4gICAgT2JqZWN0LmVudHJpZXMoYnlOYW1lKS5tYXAoKFtuYW1lLCBkYXRhXSkgPT4gW25hbWUgPT09IG9sZE5hbWUgPyBuZXdOYW1lIDogbmFtZSwgZGF0YV0pXG4gICk7XG59XG5cbi8vIFJlaWhlbmZvbGdlIGFsbGVyIEJsXHUwMEY2Y2tlIGVpbmVzIFRZUHMsIG51bGwgPSBTdGFuZGFyZC1Gcm9udG1hdHRlci4gU3VidHlwZW5cbi8vIG1pdCBhYm92ZVN0YW5kYXJkIHN0ZWhlbiBkYXZvciAtIGFscyBNYXJraWVydW5nIGFtIFN1YnR5cCBzZWxic3Qgc3RhdHQgYWxzXG4vLyBQb3NpdGlvbiwgZGFtaXQgc2llIFVtYmVuZW5uZW4sIExcdTAwRjZzY2hlbiB1bmQgWnVzYW1tZW5sZWdlbiBvaG5lIE5hY2hwZmxlZ2Vcbi8vIFx1MDBGQ2JlcnN0ZWh0LiBCZXN0aW1tdCBkaWUgQW56ZWlnZSBpbiBkZXIgVFlQLURldGFpbGFuc2ljaHQgZWJlbnNvIHdpZSBkaWVcbi8vIEZyb250bWF0dGVyLVNvcnRpZXJ1bmcgZGVyIE5vdGl6ZW4gKHNpZWhlIG9yZGVyZWREZWZhdWx0S2V5cykuXG5mdW5jdGlvbiBnZXRTZWN0aW9uT3JkZXIoc2V0dGluZ3MsIHR5cGUpIHtcbiAgY29uc3QgbmFtZXMgPSBnZXRTdWJ0eXBlTmFtZXMoc2V0dGluZ3MsIHR5cGUpO1xuICBjb25zdCBhYm92ZSA9IG5hbWVzLmZpbHRlcigobmFtZSkgPT4gc2V0dGluZ3MudHlwZVN1YnR5cGVzW3R5cGVdW25hbWVdLmFib3ZlU3RhbmRhcmQpO1xuICByZXR1cm4gWy4uLmFib3ZlLCBudWxsLCAuLi5uYW1lcy5maWx0ZXIoKG5hbWUpID0+ICFhYm92ZS5pbmNsdWRlcyhuYW1lKSldO1xufVxuXG4vLyBOZXVlIEJsb2NrLVJlaWhlbmZvbGdlIChEcmFnICYgRHJvcCBpbiBkZXIgVFlQLURldGFpbGFuc2ljaHQpOiBvcmRlciB3aWVcbi8vIGdldFNlY3Rpb25PcmRlciwgc2FtdCBudWxsIGZcdTAwRkNyIGRhcyBTdGFuZGFyZC1Gcm9udG1hdHRlci4gTmljaHQgZ2VuYW5udGVcbi8vIFN1YnR5cGVuIGJsZWliZW4gZGFoaW50ZXIgZXJoYWx0ZW4uXG5mdW5jdGlvbiByZW9yZGVyU3VidHlwZXMoc2V0dGluZ3MsIHR5cGUsIG9yZGVyKSB7XG4gIGNvbnN0IGJ5TmFtZSA9IHNldHRpbmdzLnR5cGVTdWJ0eXBlcz8uW3R5cGVdO1xuICBpZiAoIWJ5TmFtZSkgcmV0dXJuO1xuICBjb25zdCBzdGFuZGFyZEluZGV4ID0gb3JkZXIuaW5kZXhPZihudWxsKTtcbiAgY29uc3QgbmFtZXMgPSBvcmRlci5maWx0ZXIoKG5hbWUpID0+IG5hbWUgIT09IG51bGwgJiYgYnlOYW1lW25hbWVdKTtcbiAgY29uc3Qgb3JkZXJlZCA9IFsuLi5uYW1lcywgLi4uT2JqZWN0LmtleXMoYnlOYW1lKS5maWx0ZXIoKG5hbWUpID0+ICFuYW1lcy5pbmNsdWRlcyhuYW1lKSldO1xuICBmb3IgKGNvbnN0IG5hbWUgb2Ygb3JkZXJlZCkge1xuICAgIGlmIChzdGFuZGFyZEluZGV4ICE9PSAtMSAmJiBvcmRlci5pbmRleE9mKG5hbWUpICE9PSAtMSAmJiBvcmRlci5pbmRleE9mKG5hbWUpIDwgc3RhbmRhcmRJbmRleCkgYnlOYW1lW25hbWVdLmFib3ZlU3RhbmRhcmQgPSB0cnVlO1xuICAgIGVsc2UgZGVsZXRlIGJ5TmFtZVtuYW1lXS5hYm92ZVN0YW5kYXJkO1xuICB9XG4gIHNldHRpbmdzLnR5cGVTdWJ0eXBlc1t0eXBlXSA9IE9iamVjdC5mcm9tRW50cmllcyhvcmRlcmVkLm1hcCgobmFtZSkgPT4gW25hbWUsIGJ5TmFtZVtuYW1lXV0pKTtcbn1cblxuZnVuY3Rpb24gZGVsZXRlU3VidHlwZShzZXR0aW5ncywgdHlwZSwgbmFtZSkge1xuICBjb25zdCBieU5hbWUgPSBzZXR0aW5ncy50eXBlU3VidHlwZXM/Llt0eXBlXTtcbiAgaWYgKCFieU5hbWUpIHJldHVybjtcbiAgZGVsZXRlIGJ5TmFtZVtuYW1lXTtcbiAgaWYgKE9iamVjdC5rZXlzKGJ5TmFtZSkubGVuZ3RoID09PSAwKSBkZWxldGUgc2V0dGluZ3MudHlwZVN1YnR5cGVzW3R5cGVdO1xufVxuXG4vLyBadXNhbW1lbmxlZ2VuIHp3ZWllciBTdWJ0eXBlbiBkZXNzZWxiZW4gVFlQczogZGllIFByb3BlcnRpZXMgdm9uIHNvdXJjZVxuLy8gd2FuZGVybiBhbnMgRW5kZSBkZXMgWmllbC1CbG9ja3MgKEtleXMga29tbWVuIG9obmVoaW4gbnVyIGluIGVpbmVtIEJsb2NrXG4vLyB2b3IsIHNpZWhlIGVuZm9yY2VVbmlxdWVLZXlzKSwgc291cmNlIHZlcnNjaHdpbmRldC5cbmZ1bmN0aW9uIG1lcmdlU3VidHlwZXMoc2V0dGluZ3MsIHR5cGUsIHNvdXJjZSwgdGFyZ2V0KSB7XG4gIGNvbnN0IHNvdXJjZURhdGEgPSBnZXRTdWJ0eXBlKHNldHRpbmdzLCB0eXBlLCBzb3VyY2UpO1xuICBjb25zdCB0YXJnZXREYXRhID0gZ2V0U3VidHlwZShzZXR0aW5ncywgdHlwZSwgdGFyZ2V0KTtcbiAgaWYgKCFzb3VyY2VEYXRhIHx8ICF0YXJnZXREYXRhIHx8IHNvdXJjZSA9PT0gdGFyZ2V0KSByZXR1cm47XG4gIE9iamVjdC5hc3NpZ24odGFyZ2V0RGF0YS5mcm9udG1hdHRlciwgc291cmNlRGF0YS5mcm9udG1hdHRlcik7XG4gIHRhcmdldERhdGEuZmxvYXRpbmdLZXlzLnB1c2goLi4uc291cmNlRGF0YS5mbG9hdGluZ0tleXMuZmlsdGVyKChrZXkpID0+ICF0YXJnZXREYXRhLmZsb2F0aW5nS2V5cy5pbmNsdWRlcyhrZXkpKSk7XG4gIGRlbGV0ZVN1YnR5cGUoc2V0dGluZ3MsIHR5cGUsIHNvdXJjZSk7XG4gIGVuZm9yY2VVbmlxdWVLZXlzKHNldHRpbmdzLCB0eXBlKTtcbn1cblxuLy8gU2NocmVpYnQgZGVuIFNVQlRZUC1XZXJ0IGFsbGVyIE5vdGl6ZW4gbWl0IFRZUC1TY2hsXHUwMEZDc3NlbCB0eXBlIHVuZFxuLy8gU1VCVFlQLVNjaGxcdTAwRkNzc2VsIG9sZEtleSBhdWYgZGVuIEVpbnplbHdlcnQgbmV3VmFsdWUgdW0gLSBhbmFsb2cgenVcbi8vIHJlbmFtZVR5cGVJbk5vdGVzKCkgaW4gdHlwLXZpZXcuanMuXG5hc3luYyBmdW5jdGlvbiByZW5hbWVTdWJ0eXBlSW5Ob3RlcyhwbHVnaW4sIHR5cGUsIG9sZEtleSwgbmV3VmFsdWUpIHtcbiAgbGV0IGNoYW5nZWQgPSAwO1xuICBmb3IgKGNvbnN0IGZpbGUgb2YgcGx1Z2luLnR5cEluZGV4LmZpbGVzV2l0aFN1YnR5cGUodHlwZSwgb2xkS2V5KSkge1xuICAgIGxldCBtYXRjaGVkID0gZmFsc2U7XG4gICAgYXdhaXQgcGx1Z2luLmFwcC5maWxlTWFuYWdlci5wcm9jZXNzRnJvbnRNYXR0ZXIoZmlsZSwgKGZyb250bWF0dGVyKSA9PiB7XG4gICAgICBpZiAodHlwZUtleU9mKHByb3BlcnR5VmFsdWUoZnJvbnRtYXR0ZXIsIFNVQlRZUF9QUk9QRVJUWSkpICE9PSBvbGRLZXkpIHJldHVybjtcbiAgICAgIHNldENhbm9uaWNhbFByb3BlcnR5KGZyb250bWF0dGVyLCBTVUJUWVBfUFJPUEVSVFksIG5ld1ZhbHVlKTtcbiAgICAgIG1hdGNoZWQgPSB0cnVlO1xuICAgIH0pO1xuICAgIGlmIChtYXRjaGVkKSBjaGFuZ2VkKys7XG4gIH1cbiAgcmV0dXJuIGNoYW5nZWQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBub3JtYWxpemVTdWJ0eXBlTmFtZSxcbiAgZ2V0U3VidHlwZU5hbWVzLFxuICBnZXRTdWJ0eXBlLFxuICBlbnN1cmVTdWJ0eXBlLFxuICBlbmZvcmNlVW5pcXVlS2V5cyxcbiAgbW92ZVR5cGVTdWJ0eXBlcyxcbiAgZGVsZXRlVHlwZVN1YnR5cGVzLFxuICBtZXJnZVR5cGVTdWJ0eXBlcyxcbiAgcmVuYW1lU3VidHlwZSxcbiAgZ2V0U2VjdGlvbk9yZGVyLFxuICByZW9yZGVyU3VidHlwZXMsXG4gIGRlbGV0ZVN1YnR5cGUsXG4gIG1lcmdlU3VidHlwZXMsXG4gIHJlbmFtZVN1YnR5cGVJbk5vdGVzLFxufTtcbiIsICJjb25zdCB7IGdldFN1YnR5cGUgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cGVzXCIpO1xuXG5jb25zdCBUWVBfUFJPUEVSVFkgPSBcIlRZUFwiO1xuY29uc3QgU1VCVFlQX1BST1BFUlRZID0gXCJTVUJUWVBcIjtcblxuLy8gV2lyZCBhdWNoIHZvbiBzZXR0aW5ncy5qcyAoRGVmYXVsdCBmXHUwMEZDciBnbG9iYWxQcm9wZXJ0eU9yZGVyKSBzb3dpZSB2b21cbi8vIE9yZGVyLUVkaXRvciBiZW51dHp0IC0gYWxsZSB2aWVyIFBsYXR6aGFsdGVyLUJsXHUwMEY2Y2tlIHNpbmQgZG9ydCBwZXIgVUkgbmljaHRcbi8vIGVudGZlcm5iYXIsIG51ciB2ZXJzY2hpZWJiYXIgKHNpZWhlIGZyb250bWF0dGVyLW9yZGVyLWVkaXRvci5qcykuXG4vLyBcInR5cFZhbHVlXCIgaXN0IGRpZSBUWVAtUHJvcGVydHkgc2VsYnN0LCBcInN1YnR5cFZhbHVlXCIgYW5hbG9nIGRpZSBTVUJUWVAtXG4vLyBQcm9wZXJ0eSwgXCJ0eXBcIiBkaWUgU3RhbmRhcmQtRnJvbnRtYXR0ZXItTGlzdGUgZGVzIFRZUHMgKHNpZWhlXG4vLyB0eXBlLWZyb250bWF0dGVyLWVkaXRvci5qcyksIFwib3RoZXJcIiBhbGxlcyBcdTAwRENicmlnZS5cbmNvbnN0IERFRkFVTFRfR0xPQkFMX09SREVSID0gW3sga2luZDogXCJ0eXBWYWx1ZVwiIH0sIHsga2luZDogXCJzdWJ0eXBWYWx1ZVwiIH0sIHsga2luZDogXCJ0eXBcIiB9LCB7IGtpbmQ6IFwib3RoZXJcIiB9XTtcblxuLy8gU3RlbGx0IHNpY2hlciwgZGFzcyBnZW5hdSBqZSBlaW4gRWludHJhZyBwcm8gUGxhdHpoYWx0ZXItQXJ0IHZvcmhhbmRlbiBpc3QgLVxuLy8gblx1MDBGNnRpZyBmXHUwMEZDciBCZXN0YW5kc2luc3RhbGxhdGlvbmVuLCBkZXJlbiBnZXNwZWljaGVydGUgZ2xvYmFsUHJvcGVydHlPcmRlclxuLy8gbm9jaCBhdXMgZGVyIFplaXQgdm9yIFwiVFlQIGFscyBMaXN0ZW5laW50cmFnXCIgYnp3LiB2b3IgU1VCVFlQIHN0YW1tdCAoVFlQXG4vLyB3YXIgZGF2b3IgaGFydC1jb2RpZXJ0IGltbWVyIGFuIGVyc3RlciBTdGVsbGUsIGthbSBpbiBkZXIgTGlzdGUgc2VsYnN0XG4vLyBuaWNodCB2b3IpLiBGZWhsZW5kZSBFaW50clx1MDBFNGdlIHdlcmRlbiBhbiBzaW5udm9sbGVyIERlZmF1bHQtUG9zaXRpb24gZXJnXHUwMEU0bnp0LFxuLy8gc3RhdHQgZGllIGJlc3RlaGVuZGUsIHZvbSBOdXR6ZXIgcGVyIERyYWcgJiBEcm9wIGVpbnNvcnRpZXJ0ZSBSZWloZW5mb2xnZVxuLy8gYW56dXRhc3Rlbi4gXCJzdWJ0eXBWYWx1ZVwiIGxhbmRldCBkYWJlaSBkaXJla3QgaGludGVyIFwidHlwVmFsdWVcIiAoZ2FyYW50aWVydFxuLy8genUgZGllc2VtIFplaXRwdW5rdCBzY2hvbiB2b3JoYW5kZW4pLCBzdGF0dCB3aWUgZGllIFx1MDBGQ2JyaWdlbiBQbGF0emhhbHRlclxuLy8gcGF1c2NoYWwgYW4gZGVuIFJhbmQuXG5mdW5jdGlvbiBub3JtYWxpemVHbG9iYWxPcmRlcihvcmRlcikge1xuICBjb25zdCByZXN1bHQgPSBBcnJheS5pc0FycmF5KG9yZGVyKSA/IG9yZGVyLmZpbHRlcigoZW50cnkpID0+IGVudHJ5ICYmIHR5cGVvZiBlbnRyeSA9PT0gXCJvYmplY3RcIikgOiBbXTtcbiAgY29uc3QgaGFzS2luZCA9IChraW5kKSA9PiByZXN1bHQuc29tZSgoZW50cnkpID0+IGVudHJ5LmtpbmQgPT09IGtpbmQpO1xuICBpZiAoIWhhc0tpbmQoXCJ0eXBWYWx1ZVwiKSkgcmVzdWx0LnVuc2hpZnQoeyBraW5kOiBcInR5cFZhbHVlXCIgfSk7XG4gIGlmICghaGFzS2luZChcInN1YnR5cFZhbHVlXCIpKSB7XG4gICAgY29uc3QgdHlwVmFsdWVJbmRleCA9IHJlc3VsdC5maW5kSW5kZXgoKGVudHJ5KSA9PiBlbnRyeS5raW5kID09PSBcInR5cFZhbHVlXCIpO1xuICAgIHJlc3VsdC5zcGxpY2UodHlwVmFsdWVJbmRleCArIDEsIDAsIHsga2luZDogXCJzdWJ0eXBWYWx1ZVwiIH0pO1xuICB9XG4gIGlmICghaGFzS2luZChcInR5cFwiKSkgcmVzdWx0LnB1c2goeyBraW5kOiBcInR5cFwiIH0pO1xuICBpZiAoIWhhc0tpbmQoXCJvdGhlclwiKSkgcmVzdWx0LnB1c2goeyBraW5kOiBcIm90aGVyXCIgfSk7XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICogRnJvbnRtYXR0ZXItU29ydGllcnVuZ1xuICogQnJpbmd0IGRpZSBpbiBlaW5lciBOb3RpeiBWT1JIQU5ERU5FTiBQcm9wZXJ0aWVzIGluIGVpbmUgZmVzdGVcbiAqIFJlaWhlbmZvbGdlIC0genVzYW1tZW5nZXNldHp0IGF1cyAoc2llaGUgZ2xvYmFsUHJvcGVydHlPcmRlcik6XG4gKiAgLSBnbG9iYWwgZmVzdCBwb3NpdGlvbmllcnRlbiBFaW56ZWwtUHJvcGVydGllcyAoei4gQi4gY3NzY2xhc3NlcyxcbiAqICAgIGFsaWFzZXM7IEVpbnN0ZWxsdW5nZW4gLT4gVFlQIC0+IEdsb2JhbGUgUHJvcGVydHktUmVpaGVuZm9sZ2UpLFxuICogIC0gZGVyIFRZUC1Qcm9wZXJ0eSBzZWxic3QsXG4gKiAgLSBkZXIgU1VCVFlQLVByb3BlcnR5IHNlbGJzdCxcbiAqICAtIGRlbSBCbG9jayBcIlRZUC1Gcm9udG1hdHRlclwiIChTdGFuZGFyZC1Gcm9udG1hdHRlci1MaXN0ZSBkZXNcbiAqICAgIGpld2VpbGlnZW4gVHlwcywgc2llaGUgdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMsIGdlZm9sZ3Qgdm9tXG4gKiAgICBGcm9udG1hdHRlci1CbG9jayBzZWluZXMgU1VCVFlQcyksIHVuZFxuICogIC0gZGVtIEJsb2NrIFwiU29uc3RpZ2UgUHJvcGVydGllc1wiIChhbGxlcyBcdTAwRENicmlnZSwgaW4gYmlzaGVyaWdlclxuICogICAgUmVpaGVuZm9sZ2UpLlxuICogRXJnXHUwMEU0bnp0IGRhYmVpIGtlaW5lIGZlaGxlbmRlbiBTdGFuZGFyZC1Qcm9wZXJ0aWVzIHVuZCBcdTAwRTRuZGVydCBrZWluZVxuICogV2VydGUgLSByZWluZSBVbXNvcnRpZXJ1bmcgZGVyIGJlcmVpdHMgdm9yaGFuZGVuZW4gWmVpbGVuLlxuICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovXG5cbi8vIFN0YW5kYXJkLVByb3BlcnR5LVJlaWhlbmZvbGdlIGVpbmVzIFR5cHMsIGlua2wuIGRlciBkYXJpbiBhbHMgXCJGbG9hdGluZ1xuLy8gUHJvcGVydHlcIiBtYXJraWVydGVuIEtleXMgKHNpZWhlIHR5cGVGbG9hdGluZ0tleXMgaW4gc2V0dGluZ3MuanMpIGFuIGdlbmF1XG4vLyBkZXIgU3RlbGxlLCBhbiBkZXIgc2llIGluIGRlciBMaXN0ZSBzdGVoZW4gLSBvaG5lIFRZUCBzZWxic3QgKGRhcyBpc3QgZG9ydFxuLy8gbnVyIGF1cyBoaXN0b3Jpc2NoZW4gR3JcdTAwRkNuZGVuIGV2dGwuIG5vY2ggZW50aGFsdGVuLCBzaWVoZSBzdHJpcFR5cFByb3BlcnR5KVxuLy8gdW5kIG9obmUgZGllIGxlZXJlIFBsYXR6aGFsdGVyLVplaWxlIGRlcyBFZGl0b3JzIChcIlByb3BlcnR5IGhpbnp1Zlx1MDBGQ2dlblwiKS5cbi8vIEZsb2F0aW5nIFByb3BlcnRpZXMgd2VyZGVuIG51ciBuaWNodCBhdXRvbWF0aXNjaCB2b24gZ2V0VHlwZURlZmF1bHRzKClcbi8vIChtYWluLmpzKSBhbiBUZW1wbGF0ZXIgYXVzZ2VsaWVmZXJ0LCBzb2xsZW4gYWJlciB0cm90emRlbSBhbiBpaHJlclxuLy8gTGlzdGVucG9zaXRpb24gbGFuZGVuLCBzb2JhbGQgZWluZSBOb3RpeiBzaWUgZG9jaCB0clx1MDBFNGd0LiBudWxsLCB3ZW5uIGtlaW5cbi8vIFR5cCBcdTAwRkNiZXJnZWJlbiB3dXJkZSBvZGVyIGZcdTAwRkNyIGRlbiBUeXAga2VpbmUgU3RhbmRhcmRsaXN0ZSBnZXBmbGVndCBpc3QuXG4vL1xuLy8gTWl0IHN1YnR5cGUgenVzXHUwMEU0dHpsaWNoIGRpZSBLZXlzIGF1cyBkZXNzZW4gRnJvbnRtYXR0ZXItQmxvY2sgKHNpZWhlXG4vLyBzdWJ0eXBlcy5qcykgLSBkYWhpbnRlciwgb2RlciBkYXZvciwgd2VubiBkZXIgU3VidHlwLUJsb2NrIGluIGRlciBUWVAtXG4vLyBEZXRhaWxhbnNpY2h0IFx1MDBGQ2JlciBkZW0gU3RhbmRhcmQtRnJvbnRtYXR0ZXIgc3RlaHQgKGFib3ZlU3RhbmRhcmQpLiBLXHUwMEU0bWUgZWluXG4vLyBLZXkgZG9jaCBpbiBiZWlkZW4gdm9yLCB6XHUwMEU0aGx0IHNlaW5lIGVyc3RlIFBvc2l0aW9uLlxuZnVuY3Rpb24gb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgdHlwZSwgc3VidHlwZSA9IG51bGwpIHtcbiAgaWYgKCF0eXBlKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgaXNTeXN0ZW1LZXkgPSAoa2V5KSA9PiBrZXkgPT09IFwiXCIgfHwgW1RZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZXS5zb21lKChwKSA9PiBrZXkudG9Mb3dlckNhc2UoKSA9PT0gcC50b0xvd2VyQ2FzZSgpKTtcbiAgY29uc3Qgc3VidHlwZURhdGEgPSBzdWJ0eXBlID8gZ2V0U3VidHlwZShwbHVnaW4uc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpIDogbnVsbDtcbiAgY29uc3QgYmxvY2tzID0gW3BsdWdpbi5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdLCBzdWJ0eXBlRGF0YT8uZnJvbnRtYXR0ZXJdO1xuICBpZiAoc3VidHlwZURhdGE/LmFib3ZlU3RhbmRhcmQpIGJsb2Nrcy5yZXZlcnNlKCk7XG4gIGNvbnN0IGtleXMgPSBbXTtcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQoKTtcbiAgZm9yIChjb25zdCBibG9jayBvZiBibG9ja3MpIHtcbiAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhibG9jayA/PyB7fSkpIHtcbiAgICAgIGlmIChpc1N5c3RlbUtleShrZXkpIHx8IHNlZW4uaGFzKGtleS50b0xvd2VyQ2FzZSgpKSkgY29udGludWU7XG4gICAgICBrZXlzLnB1c2goa2V5KTtcbiAgICAgIHNlZW4uYWRkKGtleS50b0xvd2VyQ2FzZSgpKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGtleXMubGVuZ3RoID4gMCA/IGtleXMgOiBudWxsO1xufVxuXG4vLyBSZWloZW5mb2xnZSwgaW4gZGVyIGRpZSB2b3JoYW5kZW5lbiBQcm9wZXJ0aWVzIGVpbmVyIE5vdGl6IHN0ZWhlbiBzb2xsZW4gLVxuLy8gYmVzdGltbXQga29tcGxldHQgZHVyY2ggZ2xvYmFsT3JkZXI6IGVpbnplbG5lIFByb3BlcnRpZXMgYW4gZmVzdGVyXG4vLyBQb3NpdGlvbiwgc293aWUgZGllIFBsYXR6aGFsdGVyIFwidHlwVmFsdWVcIiAoZGllIFRZUC1Qcm9wZXJ0eSBzZWxic3QpLFxuLy8gXCJzdWJ0eXBWYWx1ZVwiIChkaWUgU1VCVFlQLVByb3BlcnR5IHNlbGJzdCksIFwidHlwXCIgKFN0YW5kYXJkbGlzdGUgZGVzIFR5cHMpXG4vLyB1bmQgXCJvdGhlclwiIChhbGxlcyBcdTAwRENicmlnZSkuXG4vL1xuLy8gV2VsY2hlciBCbG9jayBlaW5lIFByb3BlcnR5IGJlYW5zcHJ1Y2h0LCB3aXJkIFZPUiBkZW0gZWlnZW50bGljaGVuIEF1ZmJhdVxuLy8gZGVyIFJlaWhlbmZvbGdlIGZlc3RzdGVoZW5kIGJlc3RpbW10IChwaW5uZWQvdHlwQmxvY2svUmVzdCBzaW5kIGRpc2p1bmt0KSAtXG4vLyBuaWNodCBlcnN0IGJlaW0gbGluZWFyZW4gRHVyY2hsYXVmIHZvbiBnbG9iYWxPcmRlci4gRGFzIG1hY2h0IGRpZVxuLy8gQmxvY2stWnVvcmRudW5nIHVuYWJoXHUwMEU0bmdpZyBkYXZvbiwgaW4gd2VsY2hlciBSZWloZW5mb2xnZSBkaWUgQmxcdTAwRjZja2UgaW5cbi8vIGdsb2JhbE9yZGVyIHN0ZWhlbjogZWluZSBnbG9iYWwgZmVzdCBwb3NpdGlvbmllcnRlIFByb3BlcnR5IGdlaFx1MDBGNnJ0IGltbWVyIHp1XG4vLyBpaHJlbSBlaWdlbmVuIEVpbnRyYWcgKG5pZSB6dXNcdTAwRTR0emxpY2ggenVtIFR5cC1CbG9jaywgc2VsYnN0IHdlbm4gXCJUWVBcbi8vIFByb3BlcnRpZXNcIiB2b3JoZXIgaW4gZGVyIExpc3RlIHN0ZWh0KSwgdW5kIFwiU29uc3RpZ2UgUHJvcGVydGllc1wiIGVudGhcdTAwRTRsdFxuLy8gaW1tZXIgbnVyIGVjaHRlIFJlc3RiZXN0XHUwMEU0bmRlIChuaWUgdmVyc2VoZW50bGljaCBQcm9wZXJ0aWVzLCBkaWUgZWlnZW50bGljaFxuLy8gZWluZW0gc3BcdTAwRTR0ZXIgaW4gZGVyIExpc3RlIHN0ZWhlbmRlbiBCbG9jayBnZWhcdTAwRjZyZW4pLlxuZnVuY3Rpb24gY29tcHV0ZVNvcnRlZEtleXMoZXhpc3RpbmdLZXlzLCBnbG9iYWxPcmRlciwgdHlwZURlZmF1bHRLZXlzKSB7XG4gIGNvbnN0IGxvd2VyVG9BY3R1YWwgPSBuZXcgTWFwKGV4aXN0aW5nS2V5cy5tYXAoKGtleSkgPT4gW2tleS50b0xvd2VyQ2FzZSgpLCBrZXldKSk7XG4gIGNvbnN0IHJlc29sdmUgPSAobmFtZSkgPT4gbG93ZXJUb0FjdHVhbC5nZXQobmFtZS50b0xvd2VyQ2FzZSgpKTtcblxuICBjb25zdCBwaW5uZWQgPSBuZXcgU2V0KFxuICAgIGdsb2JhbE9yZGVyXG4gICAgICAuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkua2luZCA9PT0gXCJwcm9wZXJ0eVwiKVxuICAgICAgLm1hcCgoZW50cnkpID0+IHJlc29sdmUoZW50cnkubmFtZSkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICk7XG4gIGNvbnN0IHR5cEtleSA9IHJlc29sdmUoVFlQX1BST1BFUlRZKTtcbiAgY29uc3Qgc3VidHlwS2V5ID0gcmVzb2x2ZShTVUJUWVBfUFJPUEVSVFkpO1xuICBjb25zdCB0eXBCbG9ja0tleXMgPSBuZXcgU2V0KFxuICAgICh0eXBlRGVmYXVsdEtleXMgPz8gW10pLm1hcChyZXNvbHZlKS5maWx0ZXIoKGtleSkgPT4ga2V5ICYmIGtleSAhPT0gdHlwS2V5ICYmICFwaW5uZWQuaGFzKGtleSkpXG4gICk7XG4gIGNvbnN0IGNsYWltZWQgPSBuZXcgU2V0KHBpbm5lZCk7XG4gIGZvciAoY29uc3Qga2V5IG9mIHR5cEJsb2NrS2V5cykgY2xhaW1lZC5hZGQoa2V5KTtcbiAgaWYgKHR5cEtleSkgY2xhaW1lZC5hZGQodHlwS2V5KTtcbiAgaWYgKHN1YnR5cEtleSkgY2xhaW1lZC5hZGQoc3VidHlwS2V5KTtcblxuICBjb25zdCBzb3J0ZWRLZXlzID0gW107XG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0KCk7XG4gIGNvbnN0IHB1c2ggPSAoa2V5KSA9PiB7XG4gICAgaWYgKGtleSAmJiAhc2Vlbi5oYXMoa2V5KSkge1xuICAgICAgc29ydGVkS2V5cy5wdXNoKGtleSk7XG4gICAgICBzZWVuLmFkZChrZXkpO1xuICAgIH1cbiAgfTtcblxuICBmb3IgKGNvbnN0IGVudHJ5IG9mIGdsb2JhbE9yZGVyKSB7XG4gICAgaWYgKGVudHJ5LmtpbmQgPT09IFwicHJvcGVydHlcIikgcHVzaChyZXNvbHZlKGVudHJ5Lm5hbWUpKTtcbiAgICBlbHNlIGlmIChlbnRyeS5raW5kID09PSBcInR5cFZhbHVlXCIpIHB1c2godHlwS2V5KTtcbiAgICBlbHNlIGlmIChlbnRyeS5raW5kID09PSBcInN1YnR5cFZhbHVlXCIpIHB1c2goc3VidHlwS2V5KTtcbiAgICBlbHNlIGlmIChlbnRyeS5raW5kID09PSBcInR5cFwiKSB7XG4gICAgICBmb3IgKGNvbnN0IG5hbWUgb2YgdHlwZURlZmF1bHRLZXlzID8/IFtdKSB7XG4gICAgICAgIGNvbnN0IGtleSA9IHJlc29sdmUobmFtZSk7XG4gICAgICAgIGlmIChrZXkgJiYgdHlwQmxvY2tLZXlzLmhhcyhrZXkpKSBwdXNoKGtleSk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChlbnRyeS5raW5kID09PSBcIm90aGVyXCIpIHtcbiAgICAgIGZvciAoY29uc3Qga2V5IG9mIGV4aXN0aW5nS2V5cykge1xuICAgICAgICBpZiAoIWNsYWltZWQuaGFzKGtleSkpIHB1c2goa2V5KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBTaWNoZXJoZWl0c25ldHosIGZhbGxzIGdsb2JhbE9yZGVyIHVudm9sbHN0XHUwMEU0bmRpZyBpc3QgKHouIEIuIGtvcnJ1cHRlXG4gIC8vIEVpbnN0ZWxsdW5nZW4pIC0gZGllIFVJIHZlcmhpbmRlcnQgZGFzIGVpZ2VudGxpY2ggKHNpZWhlIG5vcm1hbGl6ZUdsb2JhbE9yZGVyKS5cbiAgZm9yIChjb25zdCBrZXkgb2YgZXhpc3RpbmdLZXlzKSBwdXNoKGtleSk7XG4gIHJldHVybiBzb3J0ZWRLZXlzO1xufVxuXG4vLyBcInBvc2l0aW9uXCIgaXN0IGtlaW4gZWNodGVzIFByb3BlcnR5LCBzb25kZXJuIE9ic2lkaWFucyBlaWdlbmUgQW5nYWJlIHp1clxuLy8gTGFnZSBkZXMgRnJvbnRtYXR0ZXItQmxvY2tzIGlubmVyaGFsYiBkZXIgRGF0ZWkgKG51ciBpbSBDYWNoZS1PYmpla3Rcbi8vIHZvcmhhbmRlbiwgbmljaHQgaW0gdm9uIHByb2Nlc3NGcm9udE1hdHRlciBnZWxpZWZlcnRlbiBPYmpla3QpLlxuZnVuY3Rpb24gY2FjaGVkRnJvbnRtYXR0ZXJLZXlzKGFwcCwgZmlsZSkge1xuICBjb25zdCBmcm9udG1hdHRlciA9IGFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXI7XG4gIGlmICghZnJvbnRtYXR0ZXIpIHJldHVybiBudWxsO1xuICByZXR1cm4gT2JqZWN0LmtleXMoZnJvbnRtYXR0ZXIpLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwicG9zaXRpb25cIik7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNvcnRGaWxlRnJvbnRtYXR0ZXIoYXBwLCBmaWxlLCBnbG9iYWxPcmRlciwgdHlwZURlZmF1bHRLZXlzKSB7XG4gIC8vIEdcdTAwRkNuc3RpZ2VyIFZvcmFiLUNoZWNrIFx1MDBGQ2JlciBkZW4gYmVyZWl0cyBpbSBTcGVpY2hlciB2b3JoYW5kZW5lbiBNZXRhZGF0YS1cbiAgLy8gQ2FjaGUgKGtlaW4gRGF0ZWktWnVncmlmZik6IGRlciBOb3JtYWxmYWxsIC0gZWluZSBOb3RpeiBpc3Qgc2Nob24ga29ycmVrdFxuICAvLyBzb3J0aWVydCAtIGxcdTAwRTRzc3Qgc2ljaCBzbyBlcmtlbm5lbiwgb2huZSBkaWUgRGF0ZWkgXHUwMEZDYmVyIHByb2Nlc3NGcm9udE1hdHRlclxuICAvLyBcdTAwRkNiZXJoYXVwdCB6dSBcdTAwRjZmZm5lbi4gRGFzIGlzdCBiZWkgd2llZGVyaG9sdGVuIExcdTAwRTR1ZmVuIFx1MDBGQ2JlciBkZW4gZ2FuemVuXG4gIC8vIFZhdWx0IGRlciBMXHUwMEY2d2VuYW50ZWlsIGRlciBOb3RpemVuIHVuZCBkYW1pdCBkZXIgZWlnZW50bGljaGUgR2VzY2h3aW5kaWctXG4gIC8vIGtlaXRzZ2V3aW5uLiBwcm9jZXNzRnJvbnRNYXR0ZXIgYmxlaWJ0IHRyb3R6ZGVtIGRpZSBhbGxlaW5pZ2UgUXVlbGxlIGRlclxuICAvLyBXYWhyaGVpdCBmXHUwMEZDciBkZW4gdGF0c1x1MDBFNGNobGljaGVuIFNjaHJlaWJ2b3JnYW5nIChDYWNoZSBrYW5uIGt1cnp6ZWl0aWdcbiAgLy8gdmVyYWx0ZXQgc2VpbikgLSBkZXIgVm9yYWItQ2hlY2sgXHUwMEZDYmVyc3ByaW5ndCBudXIgc2ljaGVyIHVudmVyXHUwMEU0bmRlcnRlIEZcdTAwRTRsbGUuXG4gIGNvbnN0IGNhY2hlZEtleXMgPSBjYWNoZWRGcm9udG1hdHRlcktleXMoYXBwLCBmaWxlKTtcbiAgaWYgKCFjYWNoZWRLZXlzIHx8IGNhY2hlZEtleXMubGVuZ3RoIDw9IDEpIHJldHVybiBmYWxzZTtcbiAgY29uc3QgY2FjaGVkU29ydGVkID0gY29tcHV0ZVNvcnRlZEtleXMoY2FjaGVkS2V5cywgZ2xvYmFsT3JkZXIsIHR5cGVEZWZhdWx0S2V5cyk7XG4gIGlmIChjYWNoZWRTb3J0ZWQuZXZlcnkoKGtleSwgaSkgPT4ga2V5ID09PSBjYWNoZWRLZXlzW2ldKSkgcmV0dXJuIGZhbHNlO1xuXG4gIGxldCBjaGFuZ2VkID0gZmFsc2U7XG4gIGF3YWl0IGFwcC5maWxlTWFuYWdlci5wcm9jZXNzRnJvbnRNYXR0ZXIoZmlsZSwgKGZyb250bWF0dGVyKSA9PiB7XG4gICAgY2hhbmdlZCA9IHNvcnRGcm9udG1hdHRlck9iamVjdChmcm9udG1hdHRlciwgZ2xvYmFsT3JkZXIsIHR5cGVEZWZhdWx0S2V5cyk7XG4gIH0pO1xuICByZXR1cm4gY2hhbmdlZDtcbn1cblxuLy8gU29ydGllcnQgZGFzIHZvbiBwcm9jZXNzRnJvbnRNYXR0ZXIgZ2VsaWVmZXJ0ZSBPYmpla3QgaW4tcGxhY2UgKHNpZWhlXG4vLyBLb21tZW50YXIgaW4gdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMgenUgc2F2ZUZyb250bWF0dGVyL3N0cmlwVHlwUHJvcGVydHkpOlxuLy8gT2JqZWt0LUluc2VydGlvbi1PcmRlciBiZXN0aW1tdCBkaWUgc3BcdTAwRTR0ZXJlIFlBTUwtUmVpaGVuZm9sZ2UsIGRhaGVyIGFsbGVcbi8vIEtleXMgbFx1MDBGNnNjaGVuIHVuZCBpbiBuZXVlciBSZWloZW5mb2xnZSB3aWVkZXIgZWluZlx1MDBGQ2dlbiwgc3RhdHQgZWluIG5ldWVzXG4vLyBPYmpla3QgenVyXHUwMEZDY2t6dWdlYmVuLiBMaWVmZXJ0IHRydWUgYmVpIGVpbmVyIFx1MDBDNG5kZXJ1bmcuXG5mdW5jdGlvbiBzb3J0RnJvbnRtYXR0ZXJPYmplY3QoZnJvbnRtYXR0ZXIsIGdsb2JhbE9yZGVyLCB0eXBlRGVmYXVsdEtleXMpIHtcbiAgY29uc3QgZXhpc3RpbmdLZXlzID0gT2JqZWN0LmtleXMoZnJvbnRtYXR0ZXIpO1xuICBpZiAoZXhpc3RpbmdLZXlzLmxlbmd0aCA8PSAxKSByZXR1cm4gZmFsc2U7XG5cbiAgY29uc3Qgc29ydGVkS2V5cyA9IGNvbXB1dGVTb3J0ZWRLZXlzKGV4aXN0aW5nS2V5cywgZ2xvYmFsT3JkZXIsIHR5cGVEZWZhdWx0S2V5cyk7XG4gIGlmIChzb3J0ZWRLZXlzLmV2ZXJ5KChrZXksIGkpID0+IGtleSA9PT0gZXhpc3RpbmdLZXlzW2ldKSkgcmV0dXJuIGZhbHNlO1xuXG4gIGNvbnN0IHNuYXBzaG90ID0geyAuLi5mcm9udG1hdHRlciB9O1xuICBmb3IgKGNvbnN0IGtleSBvZiBleGlzdGluZ0tleXMpIGRlbGV0ZSBmcm9udG1hdHRlcltrZXldO1xuICBmb3IgKGNvbnN0IGtleSBvZiBzb3J0ZWRLZXlzKSBmcm9udG1hdHRlcltrZXldID0gc25hcHNob3Rba2V5XTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbi8vIEZcdTAwRkNyIEF1ZnJ1ZmVyLCBkaWUgb2huZWhpbiBnZXJhZGUgaW4gcHJvY2Vzc0Zyb250TWF0dGVyIHNjaHJlaWJlbiAoei4gQi5cbi8vIGFwcGx5VHlwZVByb3BlcnRpZXMvX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qcyk6IHNvcnRpZXJ0IGRhc1xuLy8gT2JqZWt0IGRpcmVrdCBtaXQgYXVzZHJcdTAwRkNja2xpY2ggXHUwMEZDYmVyZ2ViZW5lbSBUWVAvU3VidHlwIC0gZGVyIEluZGV4IGJ6dy5cbi8vIE1ldGFkYXRhLUNhY2hlIGtlbm50IGRpZSBnZXJhZGUgZ2VzY2hyaWViZW5lbiBXZXJ0ZSB6dSBkaWVzZW0gWmVpdHB1bmt0XG4vLyBub2NoIG5pY2h0LlxuZnVuY3Rpb24gc29ydEZyb250bWF0dGVyRm9yKHBsdWdpbiwgZnJvbnRtYXR0ZXIsIHR5cGUsIHN1YnR5cGUpIHtcbiAgY29uc3QgZ2xvYmFsT3JkZXIgPSBub3JtYWxpemVHbG9iYWxPcmRlcihwbHVnaW4uc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcik7XG4gIHJldHVybiBzb3J0RnJvbnRtYXR0ZXJPYmplY3QoZnJvbnRtYXR0ZXIsIGdsb2JhbE9yZGVyLCBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCB0eXBlLCBzdWJ0eXBlKSk7XG59XG5cbi8vIFNvcnRpZXJ0IGVpbmUgZWluemVsbmUsIGJlcmVpdHMgYmVrYW5udGUgTm90aXogKHouIEIuIGRpZSBha3RpdmUgRGF0ZWkpLlxuYXN5bmMgZnVuY3Rpb24gc29ydFNpbmdsZUZpbGVGcm9udG1hdHRlcihhcHAsIHBsdWdpbiwgZmlsZSkge1xuICBjb25zdCBnbG9iYWxPcmRlciA9IG5vcm1hbGl6ZUdsb2JhbE9yZGVyKHBsdWdpbi5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyKTtcbiAgLy8gVW5zYXViZXJlIFRZUC1XZXJ0ZSAoTGlzdGUsIFJhbmRsZWVyemVpY2hlbikgaGFiZW4ga2VpbmUgU3RhbmRhcmRsaXN0ZSAtXG4gIC8vIGRhbm4gZ3JlaWZ0IG51ciBkaWUgZ2xvYmFsZSBSZWloZW5mb2xnZSAoc2llaGUgdHlwZUtleU9mIGluIHR5cC1pbmRleC5qcykuXG4gIGNvbnN0IHR5cGUgPSBwbHVnaW4udHlwSW5kZXgudHlwZU9mKGZpbGUpO1xuICBjb25zdCB0eXBlRGVmYXVsdEtleXMgPSBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCB0eXBlLCBwbHVnaW4udHlwSW5kZXguc3VidHlwZU9mKGZpbGUpKTtcbiAgcmV0dXJuIHNvcnRGaWxlRnJvbnRtYXR0ZXIoYXBwLCBmaWxlLCBnbG9iYWxPcmRlciwgdHlwZURlZmF1bHRLZXlzKTtcbn1cblxuLy8gb25seVR5cGU6IG9wdGlvbmFsIC0gYmVzY2hyXHUwMEU0bmt0IGRlbiBMYXVmIGF1ZiBOb3RpemVuIGdlbmF1IGRpZXNlcyBUeXBzLlxuLy8gT2huZSBvbmx5VHlwZSB3ZXJkZW4gYWxsZSBOb3RpemVuIGdlcHJcdTAwRkNmdCwgYXVjaCBvaG5lIFRZUCBvZGVyIG1pdCBlaW5lbSBUeXBcbi8vIG9obmUgZ2VwZmxlZ3RlIFN0YW5kYXJkbGlzdGUgLSBkaWUgZ2xvYmFsIGZlc3QgcG9zaXRpb25pZXJ0ZW4gUHJvcGVydGllc1xuLy8gKHouIEIuIGNzc2NsYXNzZXMpIHNvbGxlbiB1bmFiaFx1MDBFNG5naWcgdm9tIFR5cCB3aXJrZW4ga1x1MDBGNm5uZW4uIEZcdTAwRkNyIE5vdGl6ZW4sIGJlaVxuLy8gZGVuZW4gd2VkZXIgZWluIHBhc3NlbmRlciBUeXAtQmxvY2sgbm9jaCBlaW5lIGRlciBrb25maWd1cmllcnRlblxuLy8gRWluemVsLVByb3BlcnRpZXMgZ3JlaWZ0LCBibGVpYnQgZGllIGJpc2hlcmlnZSBSZWloZW5mb2xnZSB1bnZlclx1MDBFNG5kZXJ0LlxuYXN5bmMgZnVuY3Rpb24gc29ydEFsbEZyb250bWF0dGVyKGFwcCwgcGx1Z2luLCBvbmx5VHlwZSkge1xuICBsZXQgY2hlY2tlZCA9IDA7XG4gIGxldCBjaGFuZ2VkID0gMDtcbiAgY29uc3QgZ2xvYmFsT3JkZXIgPSBub3JtYWxpemVHbG9iYWxPcmRlcihwbHVnaW4uc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcik7XG4gIC8vIE51ciBhdXNzYWdla3JcdTAwRTRmdGlnLCB3ZW5uIGVpbiBlaW56ZWxuZXIgVHlwIGVpbmdlZ3Jlbnp0IHd1cmRlIChzb25zdFxuICAvLyB3ZWNoc2VsdCBkZXIgVHlwIHZvbiBEYXRlaSB6dSBEYXRlaSkgLSBmXHUwMEZDciBkaWUgUlx1MDBGQ2NrbWVsZHVuZyBkZXMgQmVmZWhsc1xuICAvLyBcIlRZUCBGcm9udG1hdHRlciBTb3J0aWVydW5nIGFrdHVhbGlzaWVyZW5cIiwgZmFsbHMgZlx1MDBGQ3IgZGVuIGdld1x1MDBFNGhsdGVuIFR5cFxuICAvLyBnYXIga2VpbmUgU3RhbmRhcmQtRnJvbnRtYXR0ZXItTGlzdGUgZ2VwZmxlZ3QgaXN0LlxuICBjb25zdCBoYXNUeXBlRGVmYXVsdHMgPSBvbmx5VHlwZSA/IG9yZGVyZWREZWZhdWx0S2V5cyhwbHVnaW4sIG9ubHlUeXBlKSAhPT0gbnVsbCA6IG51bGw7XG5cbiAgZm9yIChjb25zdCBmaWxlIG9mIGFwcC52YXVsdC5nZXRNYXJrZG93bkZpbGVzKCkpIHtcbiAgICBpZiAoIXBsdWdpbi5zZXR0aW5ncy5pbmNsdWRlSWdub3JlZEZpbGVzICYmIGFwcC5tZXRhZGF0YUNhY2hlLmlzVXNlcklnbm9yZWQoZmlsZS5wYXRoKSkgY29udGludWU7XG5cbiAgICBjb25zdCB0eXBlID0gcGx1Z2luLnR5cEluZGV4LnR5cGVPZihmaWxlKTtcbiAgICBpZiAob25seVR5cGUgJiYgdHlwZSAhPT0gb25seVR5cGUpIGNvbnRpbnVlO1xuXG4gICAgY29uc3QgdHlwZURlZmF1bHRLZXlzID0gb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgdHlwZSwgcGx1Z2luLnR5cEluZGV4LnN1YnR5cGVPZihmaWxlKSk7XG4gICAgY2hlY2tlZCsrO1xuICAgIGlmIChhd2FpdCBzb3J0RmlsZUZyb250bWF0dGVyKGFwcCwgZmlsZSwgZ2xvYmFsT3JkZXIsIHR5cGVEZWZhdWx0S2V5cykpIGNoYW5nZWQrKztcbiAgfVxuXG4gIHJldHVybiB7IGNoZWNrZWQsIGNoYW5nZWQsIGhhc1R5cGVEZWZhdWx0cyB9O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgc29ydEFsbEZyb250bWF0dGVyLFxuICBzb3J0U2luZ2xlRmlsZUZyb250bWF0dGVyLFxuICBzb3J0RnJvbnRtYXR0ZXJGb3IsXG4gIG5vcm1hbGl6ZUdsb2JhbE9yZGVyLFxuICBERUZBVUxUX0dMT0JBTF9PUkRFUixcbiAgVFlQX1BST1BFUlRZLFxuICBTVUJUWVBfUFJPUEVSVFksXG59O1xuIiwgImNvbnN0IHsgc2V0SWNvbiwgTm90aWNlIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IFRZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZLCBzb3J0QWxsRnJvbnRtYXR0ZXIgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLXNvcnRcIik7XG5cbi8vIEFuemVpZ2V0ZXh0IGRlciB2aWVyIG5pY2h0IGVudGZlcm5iYXJlbiBQbGF0emhhbHRlci1aZWlsZW4gLSBcInR5cFZhbHVlXCIgaXN0XG4vLyBkaWUgVFlQLVByb3BlcnR5IHNlbGJzdCwgXCJzdWJ0eXBWYWx1ZVwiIGFuYWxvZyBkaWUgU1VCVFlQLVByb3BlcnR5LCBcInR5cFwiXG4vLyBkaWUgU3RhbmRhcmQtRnJvbnRtYXR0ZXItTGlzdGUgZGVzIFRZUHMgKHNpZWhlXG4vLyB0eXBlLWZyb250bWF0dGVyLWVkaXRvci5qcyksIFwib3RoZXJcIiBhbGxlIFByb3BlcnRpZXMsIGRpZSB3ZWRlciBkb3J0IG5vY2hcbi8vIGluIGRpZXNlciBMaXN0ZSBuYW1lbnRsaWNoIGdlZlx1MDBGQ2hydCB3ZXJkZW4uIFNpZWhlIGNvbXB1dGVTb3J0ZWRLZXlzIGluXG4vLyBmcm9udG1hdHRlci1zb3J0LmpzIGZcdTAwRkNyIGRpZSB0YXRzXHUwMEU0Y2hsaWNoZSBBdWZsXHUwMEY2c3VuZyBkaWVzZXIgQmxcdTAwRjZja2UuXG5jb25zdCBQTEFDRUhPTERFUl9MQUJFTFMgPSB7XG4gIHR5cFZhbHVlOiBcIlRZUFwiLFxuICBzdWJ0eXBWYWx1ZTogXCJTVUJUWVBcIixcbiAgdHlwOiBcIlRZUC1Gcm9udG1hdHRlclwiLFxuICBvdGhlcjogXCJTb25zdGlnZSBQcm9wZXJ0aWVzXCIsXG59O1xuXG4vLyBFZGl0b3IgZlx1MDBGQ3IgcGx1Z2luLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXI6IGVpbmUgcmVpbmUgTmFtZW5zbGlzdGVcbi8vIChrZWluZSBXZXJ0ZSwgZGFoZXIga2VpbiBlaWdlbmVyIHByaXZhdGUtQVBJLVVtd2VnIFx1MDBGQ2JlciBPYnNpZGlhbnNcbi8vIE1ldGFkYXRhLUVkaXRvci1XaWRnZXQgd2llIGluIHR5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzIG5cdTAwRjZ0aWcpIG1pdFxuLy8gRHJhZy1hbmQtZHJvcC1Tb3J0aWVydW5nLiBEaWUgZHJlaSBQbGF0emhhbHRlci1aZWlsZW4gc2luZCBUZWlsIGRlcnNlbGJlblxuLy8gTGlzdGUsIGxhc3NlbiBzaWNoIHZlcnNjaGllYmVuLCBhYmVyIG5pY2h0IHBlciBVSSBlbnRmZXJuZW4uXG5mdW5jdGlvbiBtb3VudEdsb2JhbE9yZGVyRWRpdG9yKGNvbnRhaW5lckVsLCBwbHVnaW4pIHtcbiAgY29uc3QgaGVhZGVyID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLWhlYWRlclwiIH0pO1xuXG4gIC8vIEVpZ2VuZSBHcnVwcGUgZlx1MDBGQ3IgQnV0dG9uICsgXHUwMERDYmVyc2NocmlmdCwgc3RhdHQgYmVpZGUgYWxzIGdldHJlbm50ZSBLaW5kZXJcbiAgLy8gdm9uIGhlYWRlciBkaXJla3Q6IGJlaSBqdXN0aWZ5LWNvbnRlbnQ6IHNwYWNlLWJldHdlZW4gKHNpZWhlIENTUykgd1x1MDBGQ3JkZVxuICAvLyBlaW4gZHJpdHRlcyBLaW5kIHp3aXNjaGVuIFx1MDBEQ2JlcnNjaHJpZnQgdW5kIFwiK1wiLUJ1dHRvbiBzb25zdCBtaXR0aWcgaW1cbiAgLy8gdmVyYmxlaWJlbmRlbiBQbGF0eiBsYW5kZW4sIHN0YXR0IGRpcmVrdCBuZWJlbiBkZXIgXHUwMERDYmVyc2NocmlmdCB6dSBzaXR6ZW4uXG4gIGNvbnN0IHRpdGxlR3JvdXAgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLXRpdGxlLWdyb3VwXCIgfSk7XG5cbiAgLy8gV2VuZGV0IGRpZSBha3R1ZWxsZSBSZWloZW5mb2xnZSBzb2ZvcnQgYXVmIGRlbiBnZXNhbXRlbiBWYXVsdCBhbiAtIGRlcnNlbGJlXG4gIC8vIExhdWYgd2llIGRlciBCZWZlaGwgXCJGcm9udG1hdHRlciBTb3J0aWVydW5nIEdMT0JBTCBha3R1YWxpc2llcmVuXCJcbiAgLy8gKHNvcnRBbGxGcm9udG1hdHRlciBtaXQgb25seVR5cGUgbnVsbCksIG51ciBkaXJla3QgbmViZW4gZGVyIExpc3RlXG4gIC8vIGVycmVpY2hiYXIgc3RhdHQgXHUwMEZDYmVyIGRpZSBCZWZlaGxzcGFsZXR0ZS5cbiAgY29uc3QgYXBwbHlCdG4gPSB0aXRsZUdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvblwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkF1ZiBhbGxlIE5vdGl6ZW4gYW53ZW5kZW5cIiB9IH0pO1xuICBzZXRJY29uKGFwcGx5QnRuLCBcInBsYXlcIik7XG4gIGFwcGx5QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHsgY2hlY2tlZCwgY2hhbmdlZCB9ID0gYXdhaXQgc29ydEFsbEZyb250bWF0dGVyKHBsdWdpbi5hcHAsIHBsdWdpbiwgbnVsbCk7XG4gICAgICBuZXcgTm90aWNlKFxuICAgICAgICBjaGFuZ2VkID4gMFxuICAgICAgICAgID8gYEZyb250bWF0dGVyIFNvcnRpZXJ1bmc6ICR7Y2hlY2tlZH0gTm90aXplbiBnZXByXHUwMEZDZnQsICR7Y2hhbmdlZH0gc29ydGllcnQuYFxuICAgICAgICAgIDogYEZyb250bWF0dGVyIFNvcnRpZXJ1bmc6ICR7Y2hlY2tlZH0gTm90aXplbiBnZXByXHUwMEZDZnQsIGJlcmVpdHMgYWxsZSBzb3J0aWVydC5gXG4gICAgICApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiW0Zyb250bWF0dGVyIFNvcnRpZXJ1bmddXCIsIGVycm9yKTtcbiAgICAgIG5ldyBOb3RpY2UoYEZyb250bWF0dGVyIFNvcnRpZXJ1bmcgZmVobGdlc2NobGFnZW46ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICB9XG4gIH0pO1xuXG4gIHRpdGxlR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIsIHRleHQ6IFwiR2xvYmFsZSBQcm9wZXJ0eS1SZWloZW5mb2xnZVwiIH0pO1xuXG4gIGNvbnN0IGFkZEJ0biA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb25cIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJQcm9wZXJ0eSBoaW56dWZcdTAwRkNnZW5cIiB9IH0pO1xuICBzZXRJY29uKGFkZEJ0biwgXCJwbHVzXCIpO1xuXG4gIGNvbnN0IGxpc3RFbCA9IGNvbnRhaW5lckVsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLW9yZGVyLWxpc3RcIiB9KTtcblxuICBjb25zdCBvcmRlciA9ICgpID0+IHBsdWdpbi5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyO1xuXG4gIC8vIE5ldWUgWmVpbGUgd2lyZCBlcnN0IGJlaSBlaW5lbSBnXHUwMEZDbHRpZ2VuLCBuaWNodC1sZWVyZW4gTmFtZW4gdGF0c1x1MDBFNGNobGljaCBpblxuICAvLyBwbHVnaW4uc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlciBhdWZnZW5vbW1lbiAodW5kIGRhbWl0IHBvdGVuemllbGxcbiAgLy8gZ2VzcGVpY2hlcnQpIC0gYmlzIGRhaGluIGV4aXN0aWVydCBzaWUgbnVyIGFscyBsb2thbGVyIEVudHd1cmYsIGRlciBiZWltXG4gIC8vIFJlLVJlbmRlciB6dXNcdTAwRTR0emxpY2ggYW5zIEVuZGUgZGVyIGVjaHRlbiBMaXN0ZSBnZWhcdTAwRTRuZ3Qgd2lyZC4gU28gbGFuZGVuXG4gIC8vIGxlZXJlIFByb3BlcnR5LUZlbGRlciBuaWUgaW4gZGVuIEVpbnN0ZWxsdW5nZW4sIHNlbGJzdCB3ZW5uIHp3aXNjaGVuZHVyY2hcbiAgLy8gYXVzIGFuZGVyZW0gQW5sYXNzICh6LiBCLiBWZXJzY2hpZWJlbiBlaW5lciBhbmRlcmVuIFplaWxlKSBnZXNwZWljaGVydCB3aXJkLlxuICBsZXQgZHJhZnRFbnRyeSA9IG51bGw7XG5cbiAgY29uc3QgaXNEdXBsaWNhdGVOYW1lID0gKHZhbHVlLCBvd25FbnRyeSkgPT4ge1xuICAgIGNvbnN0IGxvd2VyID0gdmFsdWUudG9Mb3dlckNhc2UoKTtcbiAgICBpZiAobG93ZXIgPT09IFRZUF9QUk9QRVJUWS50b0xvd2VyQ2FzZSgpIHx8IGxvd2VyID09PSBTVUJUWVBfUFJPUEVSVFkudG9Mb3dlckNhc2UoKSkgcmV0dXJuIHRydWU7XG4gICAgcmV0dXJuIG9yZGVyKCkuc29tZSgob3RoZXIpID0+IG90aGVyICE9PSBvd25FbnRyeSAmJiBvdGhlci5raW5kID09PSBcInByb3BlcnR5XCIgJiYgb3RoZXIubmFtZS50b0xvd2VyQ2FzZSgpID09PSBsb3dlcik7XG4gIH07XG5cbiAgY29uc3QgcmVuZGVyID0gKCkgPT4ge1xuICAgIGxpc3RFbC5lbXB0eSgpO1xuICAgIGNvbnN0IGVudHJpZXMgPSBkcmFmdEVudHJ5ID8gWy4uLm9yZGVyKCksIGRyYWZ0RW50cnldIDogb3JkZXIoKTtcblxuICAgIGVudHJpZXMuZm9yRWFjaCgoZW50cnksIGluZGV4KSA9PiB7XG4gICAgICBjb25zdCBpc0RyYWZ0ID0gZW50cnkgPT09IGRyYWZ0RW50cnk7XG4gICAgICBjb25zdCBpc1BsYWNlaG9sZGVyID0gZW50cnkua2luZCAhPT0gXCJwcm9wZXJ0eVwiO1xuICAgICAgY29uc3Qgcm93Q2xzID1cbiAgICAgICAgXCJmcmVkLW9yZGVyLXJvd1wiICsgKGlzUGxhY2Vob2xkZXIgPyBcIiBpcy1wbGFjZWhvbGRlclwiIDogXCJcIikgKyAoZW50cnkua2luZCA9PT0gXCJ0eXBcIiA/IFwiIGlzLXR5cC1kZWZhdWx0c1wiIDogXCJcIik7XG4gICAgICBjb25zdCByb3cgPSBsaXN0RWwuY3JlYXRlRGl2KHsgY2xzOiByb3dDbHMgfSk7XG5cbiAgICAgIGNvbnN0IGRyYWdIYW5kbGUgPSByb3cuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtb3JkZXItZHJhZ1wiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlZlcnNjaGllYmVuXCIgfSB9KTtcbiAgICAgIHNldEljb24oZHJhZ0hhbmRsZSwgXCJncmlwLXZlcnRpY2FsXCIpO1xuXG4gICAgICBpZiAoaXNQbGFjZWhvbGRlcikge1xuICAgICAgICByb3cuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtb3JkZXItbGFiZWxcIiwgdGV4dDogUExBQ0VIT0xERVJfTEFCRUxTW2VudHJ5LmtpbmRdIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgaW5wdXQgPSByb3cuY3JlYXRlRWwoXCJpbnB1dFwiLCB7XG4gICAgICAgICAgdHlwZTogXCJ0ZXh0XCIsXG4gICAgICAgICAgY2xzOiBcImZyZWQtb3JkZXItbmFtZS1pbnB1dFwiLFxuICAgICAgICAgIGF0dHI6IHsgcGxhY2Vob2xkZXI6IFwiUHJvcGVydHktTmFtZVwiIH0sXG4gICAgICAgIH0pO1xuICAgICAgICBpbnB1dC52YWx1ZSA9IGVudHJ5Lm5hbWU7XG5cbiAgICAgICAgLy8gXCJibHVyXCIgc3RhdHQgXCJjaGFuZ2VcIjogTGV0enRlcmVzIGZldWVydCBiZWkgZWluZW0gbGVlciBnZWJsaWViZW5lblxuICAgICAgICAvLyBGZWxkIGdhciBuaWNodCBlcnN0IChCcm93c2VyIHNlaGVuIGRhcmluIGtlaW5lIFdlcnRcdTAwRTRuZGVydW5nKSAtIGRlclxuICAgICAgICAvLyBFbnR3dXJmIHdcdTAwRkNyZGUgZGFubiBuaWUgYXVmZ2VyXHUwMEU0dW10LiBcImJsdXJcIiBncmVpZnQgenV2ZXJsXHUwMEU0c3NpZyBpblxuICAgICAgICAvLyBiZWlkZW4gRlx1MDBFNGxsZW4gKHVtYmVuZW5uZW4gd2llIGxlZXIgbGFzc2VuKS5cbiAgICAgICAgaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImJsdXJcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IHZhbHVlID0gaW5wdXQudmFsdWUudHJpbSgpO1xuXG4gICAgICAgICAgaWYgKCF2YWx1ZSkge1xuICAgICAgICAgICAgaWYgKGlzRHJhZnQpIHtcbiAgICAgICAgICAgICAgZHJhZnRFbnRyeSA9IG51bGw7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBvcmRlcigpLnNwbGljZShvcmRlcigpLmluZGV4T2YoZW50cnkpLCAxKTtcbiAgICAgICAgICAgICAgYXdhaXQgcGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVuZGVyKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGlzRHVwbGljYXRlTmFtZSh2YWx1ZSwgaXNEcmFmdCA/IG51bGwgOiBlbnRyeSkpIHtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoYFwiJHt2YWx1ZX1cIiBpc3QgYmVyZWl0cyBpbiBkZXIgTGlzdGUuYCk7XG4gICAgICAgICAgICBpbnB1dC52YWx1ZSA9IGVudHJ5Lm5hbWU7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZW50cnkubmFtZSA9IHZhbHVlO1xuICAgICAgICAgIGlmIChpc0RyYWZ0KSB7XG4gICAgICAgICAgICBvcmRlcigpLnB1c2goZW50cnkpO1xuICAgICAgICAgICAgZHJhZnRFbnRyeSA9IG51bGw7XG4gICAgICAgICAgfVxuICAgICAgICAgIGF3YWl0IHBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICByZW5kZXIoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgcmVtb3ZlQnRuID0gcm93LmNyZWF0ZURpdih7IGNsczogXCJmcmVkLW9yZGVyLXJlbW92ZSBjbGlja2FibGUtaWNvblwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkVudGZlcm5lblwiIH0gfSk7XG4gICAgICAgIHNldEljb24ocmVtb3ZlQnRuLCBcInhcIik7XG4gICAgICAgIHJlbW92ZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGlmIChpc0RyYWZ0KSB7XG4gICAgICAgICAgICBkcmFmdEVudHJ5ID0gbnVsbDtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgb3JkZXIoKS5zcGxpY2Uob3JkZXIoKS5pbmRleE9mKGVudHJ5KSwgMSk7XG4gICAgICAgICAgICBhd2FpdCBwbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJlbmRlcigpO1xuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgLy8gRGVyIEVudHd1cmYgaGF0IG5vY2gga2VpbmVuIFBsYXR6IGluIGRlciBlY2h0ZW4gTGlzdGUgLSBWZXJzY2hpZWJlblxuICAgICAgLy8gZXJnaWJ0IGZcdTAwRkNyIGlobiBrZWluZW4gU2lubiwgYmV2b3IgZXIgXHUwMEZDYmVyaGF1cHQgZWluZW4gTmFtZW4gaGF0LlxuICAgICAgaWYgKGlzRHJhZnQpIHJldHVybjtcblxuICAgICAgcm93LmRyYWdnYWJsZSA9IHRydWU7XG4gICAgICByb3cuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdzdGFydFwiLCAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQuZGF0YVRyYW5zZmVyLmVmZmVjdEFsbG93ZWQgPSBcIm1vdmVcIjtcbiAgICAgICAgZXZlbnQuZGF0YVRyYW5zZmVyLnNldERhdGEoXCJ0ZXh0L3BsYWluXCIsIFN0cmluZyhpbmRleCkpO1xuICAgICAgICByb3cuY2xhc3NMaXN0LmFkZChcImlzLWRyYWdnaW5nXCIpO1xuICAgICAgfSk7XG4gICAgICByb3cuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdlbmRcIiwgKCkgPT4gcm93LmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcmFnZ2luZ1wiKSk7XG4gICAgICByb3cuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdvdmVyXCIsIChldmVudCkgPT4ge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAvLyBPYmVyZSBvZGVyIHVudGVyZSBIXHUwMEU0bGZ0ZSBkZXIgWmVpbGUgZW50c2NoZWlkZXQsIG9iIGRpZSBnZXpvZ2VuZVxuICAgICAgICAvLyBaZWlsZSBkYXZvciBvZGVyIGRhaGludGVyIGxhbmRldCAtIHNvbnN0IGxpZVx1MDBERmUgc2ljaCBuaWUgXCJuYWNoIGdhbnpcbiAgICAgICAgLy8gdW50ZW5cIiBhYmxlZ2VuIChBYmxlZ2VuIGF1ZiBkZXIgbGV0enRlbiBaZWlsZSBoXHUwMEU0dHRlIGltbWVyIG51ciB2b3JcbiAgICAgICAgLy8gaWhyIGVpbmdlZlx1MDBGQ2d0KS5cbiAgICAgICAgY29uc3QgcmVjdCA9IHJvdy5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgICAgY29uc3QgaXNBZnRlciA9IGV2ZW50LmNsaWVudFkgLSByZWN0LnRvcCA+IHJlY3QuaGVpZ2h0IC8gMjtcbiAgICAgICAgcm93LmNsYXNzTGlzdC50b2dnbGUoXCJpcy1kcm9wLWJlZm9yZVwiLCAhaXNBZnRlcik7XG4gICAgICAgIHJvdy5jbGFzc0xpc3QudG9nZ2xlKFwiaXMtZHJvcC1hZnRlclwiLCBpc0FmdGVyKTtcbiAgICAgIH0pO1xuICAgICAgcm93LmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnbGVhdmVcIiwgKCkgPT4gcm93LmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcm9wLWJlZm9yZVwiLCBcImlzLWRyb3AtYWZ0ZXJcIikpO1xuICAgICAgcm93LmFkZEV2ZW50TGlzdGVuZXIoXCJkcm9wXCIsIGFzeW5jIChldmVudCkgPT4ge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBjb25zdCBpc0FmdGVyID0gcm93LmNsYXNzTGlzdC5jb250YWlucyhcImlzLWRyb3AtYWZ0ZXJcIik7XG4gICAgICAgIHJvdy5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJvcC1iZWZvcmVcIiwgXCJpcy1kcm9wLWFmdGVyXCIpO1xuXG4gICAgICAgIGNvbnN0IGZyb21JbmRleCA9IE51bWJlcihldmVudC5kYXRhVHJhbnNmZXIuZ2V0RGF0YShcInRleHQvcGxhaW5cIikpO1xuICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKGZyb21JbmRleCkpIHJldHVybjtcblxuICAgICAgICAvLyBaaWVscG9zaXRpb24gaW0gQXJyYXkgVk9SIGRlbSBFbnRmZXJuZW4gdm9uIGZyb21JbmRleCBnZWRhY2h0IC1cbiAgICAgICAgLy8gXCJuYWNoIGRpZXNlciBaZWlsZVwiIGhlaVx1MDBERnQ6IGRpcmVrdCB2b3IgZGVyIGpld2VpbHMgblx1MDBFNGNoc3Rlbi5cbiAgICAgICAgbGV0IGluc2VydEJlZm9yZSA9IGlzQWZ0ZXIgPyBpbmRleCArIDEgOiBpbmRleDtcbiAgICAgICAgaWYgKGZyb21JbmRleCA8IGluc2VydEJlZm9yZSkgaW5zZXJ0QmVmb3JlIC09IDE7XG5cbiAgICAgICAgY29uc3QgW21vdmVkXSA9IG9yZGVyKCkuc3BsaWNlKGZyb21JbmRleCwgMSk7XG4gICAgICAgIG9yZGVyKCkuc3BsaWNlKGluc2VydEJlZm9yZSwgMCwgbW92ZWQpO1xuICAgICAgICBhd2FpdCBwbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIHJlbmRlcigpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH07XG5cbiAgYWRkQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgaWYgKCFkcmFmdEVudHJ5KSB7XG4gICAgICBkcmFmdEVudHJ5ID0geyBraW5kOiBcInByb3BlcnR5XCIsIG5hbWU6IFwiXCIgfTtcbiAgICAgIHJlbmRlcigpO1xuICAgIH1cbiAgICBjb25zdCBpbnB1dHMgPSBsaXN0RWwucXVlcnlTZWxlY3RvckFsbChcIi5mcmVkLW9yZGVyLW5hbWUtaW5wdXRcIik7XG4gICAgaW5wdXRzW2lucHV0cy5sZW5ndGggLSAxXT8uZm9jdXMoKTtcbiAgfSk7XG5cbiAgcmVuZGVyKCk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBtb3VudEdsb2JhbE9yZGVyRWRpdG9yIH07XG4iLCAiY29uc3QgeyBQbHVnaW5TZXR0aW5nVGFiLCBTZXR0aW5nR3JvdXAsIFRvZ2dsZUNvbXBvbmVudCB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBtb3VudEdsb2JhbE9yZGVyRWRpdG9yIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1vcmRlci1lZGl0b3JcIik7XG5jb25zdCB7IERFRkFVTFRfR0xPQkFMX09SREVSIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1zb3J0XCIpO1xuXG5jb25zdCBERUZBVUxUX1NFVFRJTkdTID0ge1xuICB0eXBlczogW10sXG4gIHR5cGVDb2xvcnM6IHt9LFxuICB0eXBlRGVzY3JpcHRpb25zOiB7fSxcbiAgdHlwZURlZmF1bHRGcm9udG1hdHRlcjoge30sXG4gIC8vIEtleXMgYXVzIHR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV0sIGRpZSBhbHMgXCJGbG9hdGluZyBQcm9wZXJ0eVwiIG1hcmtpZXJ0XG4gIC8vIHNpbmQgKHNpZWhlIHR5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzL3R5cC12aWV3LmpzKSAtIFRlaWwgZGVyc2VsYmVuIExpc3RlXG4gIC8vIHVuZCBSZWloZW5mb2xnZSB3aWUgZGllIFx1MDBGQ2JyaWdlbiBTdGFuZGFyZC1Qcm9wZXJ0aWVzIGRlcyBUeXBzICh3aWNodGlnIGZcdTAwRkNyXG4gIC8vIGRpZSBGcm9udG1hdHRlci1Tb3J0aWVydW5nLCBzaWVoZSBvcmRlcmVkRGVmYXVsdEtleXMgaW4gZnJvbnRtYXR0ZXItc29ydC5qcyksXG4gIC8vIGFiZXIgTklDSFQgVGVpbCBkZXMgdm9uIGdldFR5cGVEZWZhdWx0cygpIChtYWluLmpzKSBzdGFuZGFyZG1cdTAwRTRcdTAwREZpZ1xuICAvLyBnZWxpZWZlcnRlbiBGcm9udG1hdHRlcnMgLSBUZW1wbGF0ZXIgbGVndCBzaWUgYmVpbSBBbmxlZ2VuIGVpbmVyIE5vdGl6IGFsc29cbiAgLy8gbmljaHQgYXV0b21hdGlzY2ggYW4gKG51ciBcdTAwRkNiZXIgZGVuIGV4cGxpeml0ZW4gaW5jbHVkZUZsb2F0aW5nLVBhcmFtZXRlcikuXG4gIHR5cGVGbG9hdGluZ0tleXM6IHt9LFxuICB0eXBlTWFudWFsOiB7fSxcbiAgLy8gUmVnaXN0cmllcnRlIFN1YnR5cGVuIGplIFRZUCBzYW10IGVpZ2VuZW0gRnJvbnRtYXR0ZXItQmxvY2ssIHNpZWhlIHN1YnR5cGVzLmpzLlxuICB0eXBlU3VidHlwZXM6IHt9LFxuICAvLyBTaWVoZSBmcm9udG1hdHRlci1vcmRlci1lZGl0b3IuanMgLyBmcm9udG1hdHRlci1zb3J0LmpzOiBSZWloZW5mb2xnZSBhdXNcbiAgLy8gZmVzdCBwb3NpdGlvbmllcnRlbiBFaW56ZWwtUHJvcGVydGllcyAoa2luZDogXCJwcm9wZXJ0eVwiKSBzb3dpZSBkZW4gdmllclxuICAvLyBuaWNodCBlbnRmZXJuYmFyZW4gUGxhdHpoYWx0ZXJuIFwidHlwVmFsdWVcIiAoVFlQLVByb3BlcnR5IHNlbGJzdCksXG4gIC8vIFwic3VidHlwVmFsdWVcIiAoU1VCVFlQLVByb3BlcnR5IHNlbGJzdCksIFwidHlwXCIgKFN0YW5kYXJkbGlzdGUgZGVzIFR5cHMpXG4gIC8vIHVuZCBcIm90aGVyXCIgKGFsbGVzIFx1MDBEQ2JyaWdlKS5cbiAgZ2xvYmFsUHJvcGVydHlPcmRlcjogREVGQVVMVF9HTE9CQUxfT1JERVIsXG4gIC8vIFNpZWhlIGFjdGl2ZS10aXRsZS1jb2xvcnMuanM6IHdpZSBkZXIgVFlQIGluIGRlciBnZVx1MDBGNmZmbmV0ZW4gTm90aXogbWFya2llcnRcbiAgLy8gd2lyZCAtIFwibm9uZVwiIChuaWNodHMpLCBcImRvdFwiIChGYXJicHVua3QgYW0gVGl0ZWwpIG9kZXIgXCJiYWRnZVwiIChCb3ggbWl0XG4gIC8vIFRZUC1OYW1lbiwgd2VpdGVyIGtvbmZpZ3VyaWVydCBcdTAwRkNiZXIgZGllIGRyZWkgZm9sZ2VuZGVuIEVpbnN0ZWxsdW5nZW4sIGRpZVxuICAvLyBudXIgYmVpIFwiYmFkZ2VcIiBcdTAwRkNiZXJoYXVwdCBlaW5lIFJvbGxlIHNwaWVsZW4gYnp3LiBpbiBkZW4gRWluc3RlbGx1bmdlblxuICAvLyBhbmdlemVpZ3Qgd2VyZGVuKS4gVW5hYmhcdTAwRTRuZ2lnIGRhdm9uIHVuZCBiZWxpZWJpZyBrb21iaW5pZXJiYXI6XG4gIC8vIGNvbG9yVmlld3Mubm90ZVRpdGxlQ29sb3IgZlx1MDBFNHJidCBkZW4gVGl0ZWx0ZXh0IHNlbGJzdCBlaW4uXG4gIG5vdGVUaXRsZVN0eWxlOiBcImRvdFwiLFxuICAvLyBOdXIgcmVsZXZhbnQgYmVpIG5vdGVUaXRsZVN0eWxlOiBcImJhZGdlXCIgLSBvYiBkaWUgQm94IGZhcmJpZyAoVFlQLUZhcmJlKVxuICAvLyBvZGVyIG5ldXRyYWwgKHRleHQtbXV0ZWQpIGRhcmdlc3RlbGx0IHdpcmQuXG4gIG5vdGVUaXRsZUJhZGdlQ29sb3JlZDogdHJ1ZSxcbiAgLy8gTnVyIHJlbGV2YW50IGJlaSBub3RlVGl0bGVTdHlsZTogXCJiYWRnZVwiIC0gXCJ0aXRsZVwiIChuZWJlbiBkZW0gSW5saW5lLVRpdGVsLFxuICAvLyBub3JtYWxlIEF1c3JpY2h0dW5nKSBvZGVyIFwiYmxvY2tcIiAobGlua3MgYW0gUHJvcGVydHktQmxvY2ssIHVtIDkwXHUwMEIwIGdlZHJlaHQpLlxuICBub3RlVGl0bGVCYWRnZVBvc2l0aW9uOiBcInRpdGxlXCIsXG4gIC8vIE51ciByZWxldmFudCBiZWkgbm90ZVRpdGxlQmFkZ2VQb3NpdGlvbjogXCJibG9ja1wiIC0gb2IgZGllIGdlZHJlaHRlIEJveCBhbVxuICAvLyBvYmVyZW4gb2RlciB1bnRlcmVuIFJhbmQgZGVzIFByb3BlcnR5LUJsb2NrcyBzaXR6dC5cbiAgbm90ZVRpdGxlVmVydGljYWxBbGlnbjogXCJ0b3BcIixcbiAgdHlwU29ydE9yZGVyOiBcImNvdW50LWRlc2NcIixcbiAgdHlwTGlzdERlc2NyaXB0aW9uRW5hYmxlZDogdHJ1ZSxcbiAgLy8gU2llaGUgcGlja1R5cGVBbmRTdWJ0eXBlIGluIHR5cGUtcGlja2VyLmpzOiBmYWxzZSA9IFN1YnR5cGVuIGVpbmdlclx1MDBGQ2NrdFxuICAvLyBkaXJla3QgaW0gVFlQLVBpY2tlciwgdHJ1ZSA9IGVpZ2VuZXIgU3VidHlwLVBpY2tlciBuYWNoIGRlciBUWVAtQXVzd2FobC5cbiAgc2VwYXJhdGVTdWJ0eXBlUGlja2VyOiBmYWxzZSxcbiAgaW5jbHVkZUlnbm9yZWRGaWxlczogZmFsc2UsXG4gIGdyYXBoVGFnQ29sb3JFbmFibGVkOiBmYWxzZSxcbiAgZ3JhcGhUYWdDb2xvcjogXCJcIixcbiAgZ3JhcGhBdHRhY2htZW50Q29sb3JFbmFibGVkOiBmYWxzZSxcbiAgZ3JhcGhBdHRhY2htZW50Q29sb3I6IFwiXCIsXG4gIGNvbG9yVmlld3M6IHtcbiAgICBmaWxlRXhwbG9yZXI6IHRydWUsXG4gICAgZ3JhcGg6IHRydWUsXG4gICAgc2VhcmNoOiB0cnVlLFxuICAgIHJlY2VudEZpbGVzOiB0cnVlLFxuICAgIGJhY2tsaW5rczogdHJ1ZSxcbiAgICBib29rbWFya3M6IHRydWUsXG4gICAgZnJvbnRtYXR0ZXJEZWZhdWx0czogdHJ1ZSxcbiAgICAvLyBVbnRlci1TY2hhbHRlciB6dSBmcm9udG1hdHRlckRlZmF1bHRzIGJ6dy4gYWxsUHJvcGVydGllczogYmV6aWVodCBkaWVcbiAgICAvLyBGcm9udG1hdHRlci1CbFx1MDBGNmNrZSBkZXIgU3VidHlwZW4gbWl0IGVpbiAoc2llaGVcbiAgICAvLyBmcm9udG1hdHRlci1kZWZhdWx0LWhpZ2hsaWdodC5qcykuXG4gICAgZnJvbnRtYXR0ZXJEZWZhdWx0c1N1YnR5cDogdHJ1ZSxcbiAgICB0eXBMaXN0OiB0cnVlLFxuICAgIGFsbFByb3BlcnRpZXM6IHRydWUsXG4gICAgYWxsUHJvcGVydGllc1N1YnR5cDogdHJ1ZSxcbiAgICBub3RlVGl0bGVDb2xvcjogdHJ1ZSxcbiAgICBsaW5rczogdHJ1ZSxcbiAgfSxcbn07XG5cbmNsYXNzIFR5cFN5c3RlbVNldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcbiAgY29uc3RydWN0b3IoYXBwLCBwbHVnaW4pIHtcbiAgICBzdXBlcihhcHAsIHBsdWdpbik7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cblxuICAvLyBKZWRlciBBYnNjaG5pdHQgaXN0IGVpbmUgU2V0dGluZ0dyb3VwIC0gT2JzaWRpYW5zIGVpZ2VuZSBHcnVwcGllcnVuZ1xuICAvLyAoXHUwMERDYmVyc2NocmlmdCArIGVpbmUgQm94LCBFaW50clx1MDBFNGdlIGRhcmluIGR1cmNoIFRyZW5ubGluaWVuIGdldHJlbm50KSwgd2llXG4gIC8vIGluIGRlbiBDb3JlLUVpbnN0ZWxsdW5nZW4uIEVpbnplbG4gcGVyIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKSBhbmdlbGVndGVcbiAgLy8gRWludHJcdTAwRTRnZSB3XHUwMEZDcmRlbiBzdGF0dGRlc3NlbiBqZSBhbHMgZWlnZW5lIGtsZWluZSBCb3ggZ2VyZW5kZXJ0LlxuICBkaXNwbGF5KCkge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgLy8gU2Nyb2xsLVBvc2l0aW9uIFx1MDBGQ2JlciBkZW4gTmV1YXVmYmF1IHJldHRlbiAoZGlzcGxheSgpIHdpcmQgYXVjaCB2b25cbiAgICAvLyBTY2hhbHRlcm4gbWl0IFVudGVyLU9wdGlvbmVuIGF1ZmdlcnVmZW4pOiBkYXMgRHJvcGRvd24gZGVyXG4gICAgLy8gVFlQLU1hcmtpZXJ1bmcgbWlzc3Qgc2ljaCBiZWltIHNldFZhbHVlKCkgKHJlc2l6ZVRvRml0IGxpZXN0XG4gICAgLy8gb2Zmc2V0V2lkdGgpIHVuZCBlcnp3aW5ndCBzbyBlaW4gTGF5b3V0LCBzb2xhbmdlIGRpZSBTZWl0ZSBlcnN0IGJpc1xuICAgIC8vIGRvcnRoaW4gYXVmZ2ViYXV0IGlzdCAtIGRlciBCcm93c2VyIGthcHB0IHNjcm9sbFRvcCBkYW5uIGF1ZiBkaWVzZVxuICAgIC8vIFRlaWxoXHUwMEY2aGUsIGRpZSBBbnNpY2h0IHNwclx1MDBFNG5nZSBuYWNoIG9iZW4uXG4gICAgY29uc3QgeyBzY3JvbGxUb3AgfSA9IGNvbnRhaW5lckVsO1xuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG5cbiAgICBuZXcgU2V0dGluZ0dyb3VwKGNvbnRhaW5lckVsKVxuICAgICAgLnNldEhlYWRpbmcoXCJUWVAtTGlzdGVcIilcbiAgICAgIC5hZGRTZXR0aW5nKChzZXR0aW5nKSA9PlxuICAgICAgICBzZXR0aW5nXG4gICAgICAgICAgLnNldE5hbWUoXCJCZXNjaHJlaWJ1bmdzLVRleHRmZWxkIGFuemVpZ2VuXCIpXG4gICAgICAgICAgLnNldERlc2MoXCJaZWlndCBpbiBkZXIgVFlQLUxpc3RlIG5lYmVuIGplZGVtIHJlZ2lzdHJpZXJ0ZW4gVFlQIGVpbiBUZXh0ZmVsZCB6dXIgQmVhcmJlaXR1bmcgc2VpbmVyIEJlc2NocmVpYnVuZy5cIilcbiAgICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwTGlzdERlc2NyaXB0aW9uRW5hYmxlZCkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cExpc3REZXNjcmlwdGlvbkVuYWJsZWQgPSB2YWx1ZTtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICApXG4gICAgICApXG4gICAgICAuYWRkU2V0dGluZygoc2V0dGluZykgPT5cbiAgICAgICAgc2V0dGluZ1xuICAgICAgICAgIC5zZXROYW1lKFwiSWdub3JpZXJ0ZSBOb3RpemVuIElNTUVSIGJlclx1MDBGQ2Nrc2ljaHRpZ2VuXCIpXG4gICAgICAgICAgLnNldERlc2MoXG4gICAgICAgICAgICBcIkJlemllaHQgTm90aXplbiBhdXMgT2JzaWRpYW5zIFxcXCJFeGNsdWRlZCBmaWxlc1xcXCItTGlzdGUgKGRvcnQgdHJhZ2VuIGF1Y2ggUGx1Z2lucyB3aWUgSGlkZSBGb2xkZXJzIGF1c2dlYmxlbmRldGUgT3JkbmVyIGVpbikgd2llZGVyIGluIFRZUC1aXHUwMEU0aGxlciwgVFlQLVBpY2tlciB1bmQgZGllIEZyb250bWF0dGVyLVNvcnRpZXJ1bmcgbWl0IGVpbiwgc3RhdHQgc2llIHp1IFx1MDBGQ2JlcnNwcmluZ2VuLlwiXG4gICAgICAgICAgKVxuICAgICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5pbmNsdWRlSWdub3JlZEZpbGVzKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuaW5jbHVkZUlnbm9yZWRGaWxlcyA9IHZhbHVlO1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgICAgICB9KVxuICAgICAgICAgIClcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZ0dyb3VwKGNvbnRhaW5lckVsKS5zZXRIZWFkaW5nKFwiVFlQLVBpY2tlclwiKS5hZGRTZXR0aW5nKChzZXR0aW5nKSA9PlxuICAgICAgc2V0dGluZ1xuICAgICAgICAuc2V0TmFtZShcIlN1YnR5cC1QaWNrZXIgc2VwYXJhdFwiKVxuICAgICAgICAuc2V0RGVzYyhcbiAgICAgICAgICBcIkJlaW0gQW5sZWdlbiBlaW5lciBOb3RpeiBmb2xndCBhdWYgZGVuIFRZUC1QaWNrZXIgZWluIGVpZ2VuZXIgU3VidHlwLVBpY2tlciAoRVNDIGRvcnQgZlx1MDBGQ2hydCB6dXJcdTAwRkNjayB6dXIgVFlQLUF1c3dhaGwpLCBzdGF0dCBkaWUgU3VidHlwZW4gZGlyZWt0IGVpbmdlclx1MDBGQ2NrdCB1bnRlciBpaHJlbSBUWVAgaW0gVFlQLVBpY2tlciBhbnp1emVpZ2VuLlwiXG4gICAgICAgIClcbiAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5zZXBhcmF0ZVN1YnR5cGVQaWNrZXIpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Muc2VwYXJhdGVTdWJ0eXBlUGlja2VyID0gdmFsdWU7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9KVxuICAgICAgICApXG4gICAgKTtcblxuICAgIC8vIHN1YnR5cEtleSAob3B0aW9uYWwpOiBzdGF0dCBlaW5lcyBlaW56ZWxuZW4gU2NoYWx0ZXJzIHp3ZWkgYmVzY2hyaWZ0ZXRlXG4gICAgLy8gdW50ZXJlaW5hbmRlciAod2llIGRpZSBVbnRlci1TY2hhbHRlciBiZWkgXCJCb3ggbWl0IFRZUC1OYW1lblwiLCBzaWVoZVxuICAgIC8vIHVudGVuKSAtIFwiVFlQXCIgZlx1MDBGQ3IgZGVuIGVpZ2VudGxpY2hlbiBTY2hhbHRlciwgZGFydW50ZXIgXCJTdWJ0eXBcIiwgbnVyXG4gICAgLy8gc2ljaHRiYXIsIHNvbGFuZ2UgXCJUWVBcIiBhbiBpc3QuXG4gICAgY29uc3QgY29sb3JWaWV3VG9nZ2xlID0gKGdyb3VwLCBrZXksIG5hbWUsIGRlc2MsIHN1YnR5cEtleSA9IG51bGwpID0+XG4gICAgICBncm91cC5hZGRTZXR0aW5nKChzZXR0aW5nKSA9PiB7XG4gICAgICAgIHNldHRpbmcuc2V0TmFtZShuYW1lKS5zZXREZXNjKGRlc2MpO1xuICAgICAgICBjb25zdCBzYXZlID0gYXN5bmMgKHNldHRpbmdLZXksIHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3c1tzZXR0aW5nS2V5XSA9IHZhbHVlO1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICB9O1xuXG4gICAgICAgIGlmICghc3VidHlwS2V5KSB7XG4gICAgICAgICAgc2V0dGluZy5hZGRUb2dnbGUoKHRvZ2dsZSkgPT4gdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Nba2V5XSkub25DaGFuZ2UoKHZhbHVlKSA9PiBzYXZlKGtleSwgdmFsdWUpKSk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgc2V0dGluZy5zZXR0aW5nRWwuYWRkQ2xhc3MoXCJmcmVkLW5vdGUtdGl0bGUtc2V0dGluZ1wiKTtcbiAgICAgICAgY29uc3QgYWRkUm93ID0gKGxhYmVsLCB0b29sdGlwLCBzZXR0aW5nS2V5LCBvbkNoYW5nZWQpID0+IHtcbiAgICAgICAgICBjb25zdCByb3cgPSBzZXR0aW5nLmNvbnRyb2xFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC1ub3RlLXRpdGxlLXRvZ2dsZS1yb3dcIiB9KTtcbiAgICAgICAgICByb3cuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLW5vdGUtdGl0bGUtdG9nZ2xlLWxhYmVsXCIsIHRleHQ6IGxhYmVsIH0pO1xuICAgICAgICAgIG5ldyBUb2dnbGVDb21wb25lbnQocm93KVxuICAgICAgICAgICAgLnNldFRvb2x0aXAodG9vbHRpcClcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzW3NldHRpbmdLZXldKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgICBhd2FpdCBzYXZlKHNldHRpbmdLZXksIHZhbHVlKTtcbiAgICAgICAgICAgICAgb25DaGFuZ2VkPy4oKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9O1xuICAgICAgICBhZGRSb3coXCJUWVBcIiwgXCJTdGFuZGFyZC1Gcm9udG1hdHRlciBkZXIgVFlQZW5cIiwga2V5LCAoKSA9PiB0aGlzLmRpc3BsYXkoKSk7XG4gICAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzW2tleV0pIHtcbiAgICAgICAgICBhZGRSb3coXCJTdWJ0eXBcIiwgXCJGcm9udG1hdHRlci1CbFx1MDBGNmNrZSBkZXIgU3VidHlwZW4gbWl0IGVpbmJlemllaGVuXCIsIHN1YnR5cEtleSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgY29uc3QgY29sb3JpbmdHcm91cCA9IG5ldyBTZXR0aW5nR3JvdXAoY29udGFpbmVyRWwpLnNldEhlYWRpbmcoXCJFaW5mXHUwMEU0cmJ1bmdcIik7XG5cbiAgICBjb2xvclZpZXdUb2dnbGUoY29sb3JpbmdHcm91cCwgXCJmaWxlRXhwbG9yZXJcIiwgXCJEYXRlaS1FeHBsb3JlclwiLCBcIk5vdGl6bmFtZW4gaW0gRGF0ZWktRXhwbG9yZXIgbmFjaCBUWVAgZWluZlx1MDBFNHJiZW4uXCIpO1xuICAgIGNvbG9yVmlld1RvZ2dsZShjb2xvcmluZ0dyb3VwLCBcImdyYXBoXCIsIFwiR3JhcGhcIiwgXCJLbm90ZW4gaW0gR3JhcGggKGdsb2JhbCB1bmQgbG9rYWwpIG5hY2ggVFlQIGVpbmZcdTAwRTRyYmVuLlwiKTtcbiAgICBjb2xvclZpZXdUb2dnbGUoY29sb3JpbmdHcm91cCwgXCJzZWFyY2hcIiwgXCJTdWNoZVwiLCBcIlRyZWZmZXItVGl0ZWwgaW4gZGVyIFN1Y2hlIG5hY2ggVFlQIGVpbmZcdTAwRTRyYmVuLlwiKTtcbiAgICBjb2xvclZpZXdUb2dnbGUoY29sb3JpbmdHcm91cCwgXCJyZWNlbnRGaWxlc1wiLCBcIlJlY2VudCBGaWxlc1wiLCBcIkVpbnRyXHUwMEU0Z2UgaW0gUmVjZW50LUZpbGVzLVBsdWdpbiBuYWNoIFRZUCBlaW5mXHUwMEU0cmJlbi5cIik7XG4gICAgY29sb3JWaWV3VG9nZ2xlKFxuICAgICAgY29sb3JpbmdHcm91cCxcbiAgICAgIFwibGlua3NcIixcbiAgICAgIFwiTGlua3MgaW4gTm90aXplblwiLFxuICAgICAgXCJJbnRlcm5lIExpbmtzIGltIE5vdGl6dGV4dCAoTGVzZS1Nb2R1cywgTGl2ZSBQcmV2aWV3LCBIb3Zlci1Wb3JzY2hhdSkgaW4gZGVyIEZhcmJlIGRlcyBUWVBzIGlocmVzIFppZWxzIGRhcnN0ZWxsZW4uIE5pY2h0IGF1ZmdlbFx1MDBGNnN0ZSBMaW5rcyBibGVpYmVuIHVudmVyXHUwMEU0bmRlcnQuXCJcbiAgICApO1xuICAgIGNvbG9yVmlld1RvZ2dsZShjb2xvcmluZ0dyb3VwLCBcInR5cExpc3RcIiwgXCJUWVAgVmlld1wiLCBcIlR5cC1OYW1lbiBpbiBkZXIgVFlQLVZpZXcgc2VsYnN0IChMaXN0ZSB1bmQgRGV0YWlsYW5zaWNodCkgaW4gaWhyZXIgamV3ZWlsaWdlbiBGYXJiZSBkYXJzdGVsbGVuLlwiKTtcbiAgICBjb2xvclZpZXdUb2dnbGUoXG4gICAgICBjb2xvcmluZ0dyb3VwLFxuICAgICAgXCJub3RlVGl0bGVDb2xvclwiLFxuICAgICAgXCJUaXRlbC1UZXh0IGVpbmZcdTAwRTRyYmVuXCIsXG4gICAgICBcIkZcdTAwRTRyYnQgZGVuIElubGluZS1UaXRlbCBkZXIgZ2VcdTAwRjZmZm5ldGVuIE5vdGl6IHNlbGJzdCBpbiBkZXIgRmFyYmUgaWhyZXMgVFlQcyBlaW4gLSB1bmFiaFx1MDBFNG5naWcgdm9uIGRlciBUWVAtTWFya2llcnVuZyBkYW5lYmVuIChzLiB1LiksIGJlaWRlcyBsXHUwMEU0c3N0IHNpY2gga29tYmluaWVyZW4uXCJcbiAgICApO1xuXG4gICAgLy8gUHJvZ3Jlc3NpdmUgT2ZmZW5sZWd1bmc6IGJlaSBub3RlVGl0bGVTdHlsZSBcImJhZGdlXCIga29tbWVuIHdlaXRlcmVcbiAgICAvLyBTY2hhbHRlciBkaXJla3QgaW4gZGllc2VyIGVpbmVuIFNldHRpbmctWmVpbGUgZGF6dSAoRmFyYmUsIFBvc2l0aW9uKSxcbiAgICAvLyBiZWkgUG9zaXRpb24gXCJibG9ja1wiIG5vY2ggZWluIGRyaXR0ZXIgKEF1c3JpY2h0dW5nKSAtIGpld2VpbHMgcGVyXG4gICAgLy8gdGhpcy5kaXNwbGF5KCkgbmV1IGdlcmVuZGVydCwgZGFtaXQgbnVyIGRpZSBnZXJhZGUgcmVsZXZhbnRlbiBTY2hhbHRlclxuICAgIC8vIGVyc2NoZWluZW4sIHN0YXR0IHBlcm1hbmVudCBhbGxlIGFuenV6ZWlnZW4gYnp3LiBlaWdlbmUgWmVpbGVuIHp1IGJlbGVnZW4uXG4gICAgY29uc3QgaXNCYWRnZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVN0eWxlID09PSBcImJhZGdlXCI7XG4gICAgY29uc3QgaXNCbG9ja1Bvc2l0aW9uID0gdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VQb3NpdGlvbiA9PT0gXCJibG9ja1wiO1xuXG4gICAgY29sb3JpbmdHcm91cC5hZGRTZXR0aW5nKChub3RlVGl0bGVTZXR0aW5nKSA9PiB7XG4gICAgICBub3RlVGl0bGVTZXR0aW5nXG4gICAgICAgIC5zZXROYW1lKFwiVFlQLU1hcmtpZXJ1bmcgaW4gZGVyIE5vdGl6XCIpXG4gICAgICAgIC5zZXREZXNjKFxuICAgICAgICAgIGlzQmFkZ2VcbiAgICAgICAgICAgID8gJ1wiQm94IG1pdCBUWVAtTmFtZW5cIiAtIFNjaGFsdGVyOiBmYXJiaWcvbmV1dHJhbCwgYW0gVGl0ZWwvYW0gUHJvcGVydHktQmxvY2sgKGdlZHJlaHQpJyArXG4gICAgICAgICAgICAgICAgKGlzQmxvY2tQb3NpdGlvbiA/IFwiLCBvYmVuL3VudGVuIGFtIFByb3BlcnR5LUJsb2NrXCIgOiBcIlwiKSArXG4gICAgICAgICAgICAgICAgXCIuXCJcbiAgICAgICAgICAgIDogXCJXaWUgZGVyIFRZUCBpbiBkZXIgZ2VcdTAwRjZmZm5ldGVuIE5vdGl6IG1hcmtpZXJ0IHdpcmQuXCJcbiAgICAgICAgKVxuICAgICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PlxuICAgICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwibm9uZVwiLCBcIk5pY2h0c1wiKVxuICAgICAgICAgICAgLmFkZE9wdGlvbihcImRvdFwiLCBcIkZhcmJwdW5rdCBhbSBUaXRlbFwiKVxuICAgICAgICAgICAgLmFkZE9wdGlvbihcImJhZGdlXCIsIFwiQm94IG1pdCBUWVAtTmFtZW5cIilcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVTdHlsZSlcbiAgICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlU3R5bGUgPSB2YWx1ZTtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICk7XG5cbiAgICAgIGlmICghaXNCYWRnZSkgcmV0dXJuO1xuXG4gICAgICAvLyBFaWdlbmUgS2xhc3NlLCBkYW1pdCBkaWUgYmVpIFwiYmFkZ2VcIiB6dXNcdTAwRTR0emxpY2ggYW5nZWhcdTAwRTRuZ3RlbiBTY2hhbHRlclxuICAgICAgLy8gc3RhdHQgbmViZW5laW5hbmRlciAoT2JzaWRpYW5zIFN0YW5kYXJkLUxheW91dCBmXHUwMEZDciBtZWhyZXJlIENvbnRyb2xzIGluXG4gICAgICAvLyBlaW5lciBTZXR0aW5nLVplaWxlKSB1bnRlcmVpbmFuZGVyIHN0ZWhlbiAtIHNpZWhlXG4gICAgICAvLyAuZnJlZC1ub3RlLXRpdGxlLXNldHRpbmcgaW4gc3R5bGVzLmNzcy5cbiAgICAgIG5vdGVUaXRsZVNldHRpbmcuc2V0dGluZ0VsLmFkZENsYXNzKFwiZnJlZC1ub3RlLXRpdGxlLXNldHRpbmdcIik7XG5cbiAgICAgIC8vIEVpZ2VuZXMga2xlaW5lcyBMYWJlbCBqZSBTY2hhbHRlciBzdGF0dCBudXIgVG9vbHRpcCAtIGFkZFRvZ2dsZSgpIGFsbGVpblxuICAgICAgLy8gaFx1MDBFNG5ndCBudXIgZGVuIG5hY2t0ZW4gU2NoYWx0ZXIgb2huZSBCZXNjaHJpZnR1bmcgYW4sIGRhaGVyIGhpZXIgZWluZVxuICAgICAgLy8gZWlnZW5lIFplaWxlIChMYWJlbCArIFRvZ2dsZUNvbXBvbmVudCkgZGlyZWt0IGluIGNvbnRyb2xFbCBnZWJhdXQuXG4gICAgICBjb25zdCBhZGRMYWJlbGVkVG9nZ2xlID0gKGxhYmVsLCB0b29sdGlwLCB2YWx1ZSwgb25DaGFuZ2UpID0+IHtcbiAgICAgICAgY29uc3Qgcm93ID0gbm90ZVRpdGxlU2V0dGluZy5jb250cm9sRWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtbm90ZS10aXRsZS10b2dnbGUtcm93XCIgfSk7XG4gICAgICAgIHJvdy5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtbm90ZS10aXRsZS10b2dnbGUtbGFiZWxcIiwgdGV4dDogbGFiZWwgfSk7XG4gICAgICAgIG5ldyBUb2dnbGVDb21wb25lbnQocm93KS5zZXRUb29sdGlwKHRvb2x0aXApLnNldFZhbHVlKHZhbHVlKS5vbkNoYW5nZShvbkNoYW5nZSk7XG4gICAgICB9O1xuXG4gICAgICBhZGRMYWJlbGVkVG9nZ2xlKFwiRmFyYmlnXCIsIFwiRmFyYmlnIChUWVAtRmFyYmUpIHN0YXR0IG5ldXRyYWxcIiwgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VDb2xvcmVkLCBhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VDb2xvcmVkID0gdmFsdWU7XG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgIH0pO1xuXG4gICAgICBhZGRMYWJlbGVkVG9nZ2xlKFwiQW0gUHJvcGVydHktQmxvY2tcIiwgXCJBbSBQcm9wZXJ0eS1CbG9jayAoZ2VkcmVodCkgc3RhdHQgYW0gVGl0ZWxcIiwgaXNCbG9ja1Bvc2l0aW9uLCBhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VQb3NpdGlvbiA9IHZhbHVlID8gXCJibG9ja1wiIDogXCJ0aXRsZVwiO1xuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgfSk7XG5cbiAgICAgIGlmIChpc0Jsb2NrUG9zaXRpb24pIHtcbiAgICAgICAgYWRkTGFiZWxlZFRvZ2dsZShcbiAgICAgICAgICBcIk9iZW4gc3RhdHQgdW50ZW5cIixcbiAgICAgICAgICBcIk9iZW4gc3RhdHQgdW50ZW4gYW0gUHJvcGVydHktQmxvY2tcIixcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVWZXJ0aWNhbEFsaWduID09PSBcInRvcFwiLFxuICAgICAgICAgIGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlVmVydGljYWxBbGlnbiA9IHZhbHVlID8gXCJ0b3BcIiA6IFwiYm90dG9tXCI7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICAgIH1cbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbG9yVmlld1RvZ2dsZShcbiAgICAgIGNvbG9yaW5nR3JvdXAsXG4gICAgICBcImJhY2tsaW5rc1wiLFxuICAgICAgXCJCYWNrbGlua3NcIixcbiAgICAgIFwiVHJlZmZlcnplaWxlbiBpbSBCYWNrbGlua3MtUGFuZSBzb3dpZSBpbiBkZW4gaW0gRG9rdW1lbnQgZWluZ2ViZXR0ZXRlbiBCYWNrbGlua3MgKGlua2wuIG5pY2h0IHZlcmxpbmt0ZXIgRXJ3XHUwMEU0aG51bmdlbikgbmFjaCBUWVAgZWluZlx1MDBFNHJiZW4uXCJcbiAgICApO1xuICAgIGNvbG9yVmlld1RvZ2dsZShcbiAgICAgIGNvbG9yaW5nR3JvdXAsXG4gICAgICBcImJvb2ttYXJrc1wiLFxuICAgICAgXCJCb29rbWFya3NcIixcbiAgICAgIFwiRWludHJcdTAwRTRnZSBpbSBCb29rbWFya3MtUGFuZSwgZGllIGRpcmVrdCBhdWYgZWluZSBOb3RpeiB6ZWlnZW4sIG5hY2ggVFlQIGVpbmZcdTAwRTRyYmVuLlwiXG4gICAgKTtcbiAgICBjb2xvclZpZXdUb2dnbGUoXG4gICAgICBjb2xvcmluZ0dyb3VwLFxuICAgICAgXCJhbGxQcm9wZXJ0aWVzXCIsXG4gICAgICBcIkFsbCBQcm9wZXJ0aWVzXCIsXG4gICAgICBcIkluIE9ic2lkaWFucyB2YXVsdC13ZWl0ZXIgXFxcIkFsbCBQcm9wZXJ0aWVzXFxcIi1BbnNpY2h0IFByb3BlcnR5LU5hbWVuIGVpbmZcdTAwRTRyYmVuLCBkaWUgaW0gU3RhbmRhcmQtRnJvbnRtYXR0ZXIgZ2VuYXUgZWluZXMgVFlQcyB2b3Jrb21tZW4gKGluIGRlc3NlbiBGYXJiZSkgLSBrb21tZW4gc2llIGJlaSBtZWhyZXJlbiBUWVBzIHZvciwgc3RhdHRkZXNzZW4gZmV0dCBzdGF0dCBlaW5nZWZcdTAwRTRyYnQuIE1pdCBcXFwiU3VidHlwXFxcIiB6XHUwMEU0aGxlbiBhdWNoIGRpZSBGcm9udG1hdHRlci1CbFx1MDBGNmNrZSBkZXIgU3VidHlwZW4gZlx1MDBGQ3IgaWhyZW4gamV3ZWlsaWdlbiBUWVAuXCIsXG4gICAgICBcImFsbFByb3BlcnRpZXNTdWJ0eXBcIlxuICAgICk7XG5cbiAgICBjb25zdCBncmFwaEdyb3VwID0gbmV3IFNldHRpbmdHcm91cChjb250YWluZXJFbCkuc2V0SGVhZGluZyhcIkdyYXBoXCIpO1xuXG4gICAgLy8gRWluIFNldHRpbmcgcHJvIE5vZGUtVHlwLCBkZW4gT2JzaWRpYW5zIEdyYXBoLUVuZ2luZSBrZW5udCAtIGdsZWljaGVyXG4gICAgLy8gQXVmYmF1IChUb2dnbGUgKyBGYXJid2FobCArIFp1clx1MDBGQ2Nrc2V0emVuKSBmXHUwMEZDciBqZWRlbiwgZGFoZXIgYWxzIEhlbHBlclxuICAgIC8vIHN0YXR0IGR1cGxpemllcnQuXG4gICAgY29uc3QgZ3JhcGhDb2xvclNldHRpbmcgPSAoZW5hYmxlZEtleSwgY29sb3JLZXksIGRlZmF1bHRDb2xvciwgbmFtZSwgZGVzYykgPT5cbiAgICAgIGdyYXBoR3JvdXAuYWRkU2V0dGluZygoc2V0dGluZykgPT5cbiAgICAgICAgc2V0dGluZ1xuICAgICAgICAgIC5zZXROYW1lKG5hbWUpXG4gICAgICAgICAgLnNldERlc2MoZGVzYylcbiAgICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3NbZW5hYmxlZEtleV0pLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5nc1tlbmFibGVkS2V5XSA9IHZhbHVlO1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgICAgICB9KVxuICAgICAgICAgIClcbiAgICAgICAgICAuYWRkQ29sb3JQaWNrZXIoKHBpY2tlcikgPT5cbiAgICAgICAgICAgIHBpY2tlci5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5nc1tjb2xvcktleV0gfHwgZGVmYXVsdENvbG9yKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3NbY29sb3JLZXldID0gdmFsdWU7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgKVxuICAgICAgICAgIC5hZGRFeHRyYUJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICAgICAgYnV0dG9uXG4gICAgICAgICAgICAgIC5zZXRJY29uKFwicm90YXRlLWNjd1wiKVxuICAgICAgICAgICAgICAuc2V0VG9vbHRpcChcIlp1clx1MDBGQ2Nrc2V0emVuIGF1ZiBTdGFuZGFyZGZhcmJlXCIpXG4gICAgICAgICAgICAgIC5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5nc1tjb2xvcktleV0gPSBcIlwiO1xuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICAgICAgICB9KVxuICAgICAgICAgIClcbiAgICAgICk7XG5cbiAgICBncmFwaENvbG9yU2V0dGluZyhcbiAgICAgIFwiZ3JhcGhUYWdDb2xvckVuYWJsZWRcIixcbiAgICAgIFwiZ3JhcGhUYWdDb2xvclwiLFxuICAgICAgXCIjODg4ODg4XCIsXG4gICAgICBcIlRhZy1GYXJiZVwiLFxuICAgICAgXCJFaWdlbmUgRmFyYmUgZlx1MDBGQ3IgVGFnLUtub3RlbiBpbSBHcmFwaCAoZ2xvYmFsIHVuZCBsb2thbCkgdmVyd2VuZGVuIHN0YXR0IGRlciBTdGFuZGFyZGZhcmJlLiBFaWdlbmUgRmFyYmdydXBwZW4gaW0gR3JhcGggaGFiZW4gd2VpdGVyaGluIFZvcnJhbmcuXCJcbiAgICApO1xuICAgIGdyYXBoQ29sb3JTZXR0aW5nKFxuICAgICAgXCJncmFwaEF0dGFjaG1lbnRDb2xvckVuYWJsZWRcIixcbiAgICAgIFwiZ3JhcGhBdHRhY2htZW50Q29sb3JcIixcbiAgICAgIFwiI2UwYWMwMFwiLFxuICAgICAgXCJBbmhcdTAwRTRuZ2UtRmFyYmVcIixcbiAgICAgIFwiRWlnZW5lIEZhcmJlIGZcdTAwRkNyIEFuaGFuZy1Lbm90ZW4gKE5pY2h0LU1hcmtkb3duLURhdGVpZW4gd2llIEJpbGRlciBvZGVyIFBERnMpIGltIEdyYXBoIHZlcndlbmRlbiBzdGF0dCBkZXIgU3RhbmRhcmRmYXJiZS5cIlxuICAgICk7XG5cbiAgICBjb25zdCBmcm9udG1hdHRlckdyb3VwID0gbmV3IFNldHRpbmdHcm91cChjb250YWluZXJFbCkuc2V0SGVhZGluZyhcIlN0YW5kYXJkLUZyb250bWF0dGVyXCIpO1xuXG4gICAgY29sb3JWaWV3VG9nZ2xlKFxuICAgICAgZnJvbnRtYXR0ZXJHcm91cCxcbiAgICAgIFwiZnJvbnRtYXR0ZXJEZWZhdWx0c1wiLFxuICAgICAgXCJQcm9wZXJ0eS1OYW1lbiBmZXR0IG1hcmtpZXJlblwiLFxuICAgICAgXCJJbiBOb3RpemVuIChGcm9udG1hdHRlciBpbSBEb2t1bWVudCBzb3dpZSBQcm9wZXJ0aWVzLVNlaXRlbmxlaXN0ZSkgZGllIE5hbWVuIGRlciBQcm9wZXJ0aWVzIGZldHQgZGFyc3RlbGxlbiwgZGllIGltIFN0YW5kYXJkLUZyb250bWF0dGVyIGRlcyBqZXdlaWxpZ2VuIFRZUHMgaGludGVybGVndCBzaW5kLiBNaXQgXFxcIlN1YnR5cFxcXCIgenVzXHUwMEU0dHpsaWNoIGRpZSBhdXMgZGVtIEZyb250bWF0dGVyLUJsb2NrIGlocmVzIFNVQlRZUHMuXCIsXG4gICAgICBcImZyb250bWF0dGVyRGVmYXVsdHNTdWJ0eXBcIlxuICAgICk7XG5cbiAgICAvLyBPcmRlci1FZGl0b3Igc2FtdCBCZXNjaHJlaWJ1bmcgYWxzIGVpZ2VuZXIgRWludHJhZyBkZXJzZWxiZW4gR3J1cHBlIC1cbiAgICAvLyBicmluZ3QgXHUwMERDYmVyc2NocmlmdCB1bmQgQnV0dG9ucyBzZWxic3QgbWl0LCBkYWhlciBkaXJla3QgaW4gaW5mb0VsIHN0YXR0XG4gICAgLy8gXHUwMEZDYmVyIHNldE5hbWUvc2V0RGVzYyAoc2llaGUgLmZyZWQtb3JkZXItc2V0dGluZyBpbiBzdHlsZXMuY3NzKS5cbiAgICBmcm9udG1hdHRlckdyb3VwLmFkZFNldHRpbmcoKHNldHRpbmcpID0+IHtcbiAgICAgIHNldHRpbmcuc2V0dGluZ0VsLmFkZENsYXNzKFwiZnJlZC1vcmRlci1zZXR0aW5nXCIpO1xuICAgICAgbW91bnRHbG9iYWxPcmRlckVkaXRvcihzZXR0aW5nLmluZm9FbCwgdGhpcy5wbHVnaW4pO1xuICAgICAgc2V0dGluZy5pbmZvRWwuY3JlYXRlRGl2KHtcbiAgICAgICAgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiLFxuICAgICAgICB0ZXh0OlxuICAgICAgICAgICdCZXN0aW1tdCBkaWUgUmVpaGVuZm9sZ2UsIGluIGRlciBkaWUgQmVmZWhsZSBcIkZyb250bWF0dGVyIFNvcnRpZXJ1bmcgYWt0dWFsaXNpZXJlblwiIGRpZSBpbiBlaW5lciBOb3RpeiB2b3JoYW5kZW5lbiBQcm9wZXJ0aWVzIGFub3JkbmVuIChlcmdcdTAwRTRuenQgb2RlciBcdTAwRTRuZGVydCBrZWluZSBXZXJ0ZSkuIEVpbnplbG5lIFByb3BlcnRpZXMgKHouIEIuIGNzc2NsYXNzZXMsIGFsaWFzZXMpIGxhc3NlbiBzaWNoIGZlc3QgcGxhdHppZXJlbiAtIFwiVFlQXCIgaXN0IGRpZSBUWVAtUHJvcGVydHkgc2VsYnN0LCBcIlNVQlRZUFwiIGFuYWxvZyBkaWUgU1VCVFlQLVByb3BlcnR5LCBcIlRZUC1Gcm9udG1hdHRlclwiIHN0ZWh0IGZcdTAwRkNyIGRpZSBTdGFuZGFyZC1Gcm9udG1hdHRlci1MaXN0ZSBkZXMgamV3ZWlsaWdlbiBUeXBzIHNhbXQgZGFoaW50ZXIgZGVtIEJsb2NrIHNlaW5lcyBTVUJUWVBzLCBcIlNvbnN0aWdlIFByb3BlcnRpZXNcIiBmXHUwMEZDciBhbGxlcyBcdTAwRENicmlnZS4gUmVpaGVuZm9sZ2UgcGVyIERyYWcgJiBEcm9wIFx1MDBFNG5kZXJiYXIsIGRpZSB2aWVyIFBsYXR6aGFsdGVyLVplaWxlbiBsYXNzZW4gc2ljaCBuaWNodCBlbnRmZXJuZW4uJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgY29udGFpbmVyRWwuc2Nyb2xsVG9wID0gc2Nyb2xsVG9wO1xuICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBERUZBVUxUX1NFVFRJTkdTLCBUeXBTeXN0ZW1TZXR0aW5nVGFiIH07XG4iLCAiY29uc3QgeyBOb3RpY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgc29ydEFsbEZyb250bWF0dGVyLCBzb3J0U2luZ2xlRmlsZUZyb250bWF0dGVyIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1zb3J0XCIpO1xuXG5mdW5jdGlvbiByZWdpc3RlckNvbW1hbmRzKHBsdWdpbikge1xuXG4gIC8vIE9ic2lkaWFuIGF3YWl0ZWQgZGVuIGNhbGxiYWNrIGVpbmVyIEJlZmVobHNkZWZpbml0aW9uIG5pY2h0IHVuZCBmXHUwMEU0bmd0IGF1Y2hcbiAgLy8ga2VpbmUgRmVobGVyIGFiIC0gZWluZSBFeGNlcHRpb24gZGFyaW4gd1x1MDBGQ3JkZSBzb25zdCBsYXV0bG9zIHZlcnNjaHdpbmRlblxuICAvLyAobnVyIGVpbiBFaW50cmFnIGluIGRlciBFbnR3aWNrbGVya29uc29sZSwga2VpbmUgc2ljaHRiYXJlIFJcdTAwRkNja21lbGR1bmcpLlxuICAvLyBEaWVzZSBkcmVpIFNvcnRpZXJiZWZlaGxlIGxhdWZlbiBkZXNoYWxiIFx1MDBGQ2JlciBydW5PclJlcG9ydEVycm9yKCksIGRhbWl0XG4gIC8vIGltIEZlaGxlcmZhbGwgdHJvdHpkZW0gaW1tZXIgZWluZSBOb3RpY2UgZXJzY2hlaW50IHN0YXR0IGdhciBrZWluZS5cbiAgY29uc3QgcnVuT3JSZXBvcnRFcnJvciA9IChsYWJlbCwgZm4pID0+IGFzeW5jICgpID0+IHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgZm4oKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihgWyR7bGFiZWx9XWAsIGVycm9yKTtcbiAgICAgIG5ldyBOb3RpY2UoYCR7bGFiZWx9IGZlaGxnZXNjaGxhZ2VuOiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgfVxuICB9O1xuXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJmcm9udG1hdHRlci1zb3J0aWVydW5nLWFsbGVcIixcbiAgICBuYW1lOiBcIlRZUCAtIEZyb250bWF0dGVyIFNvcnRpZXJ1bmcgR0xPQkFMIGFrdHVhbGlzaWVyZW5cIixcbiAgICBjYWxsYmFjazogcnVuT3JSZXBvcnRFcnJvcihcIkZyb250bWF0dGVyIFNvcnRpZXJ1bmdcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgeyBjaGVja2VkLCBjaGFuZ2VkIH0gPSBhd2FpdCBzb3J0QWxsRnJvbnRtYXR0ZXIocGx1Z2luLmFwcCwgcGx1Z2luLCBudWxsKTtcbiAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgIGNoYW5nZWQgPiAwXG4gICAgICAgICAgPyBgRnJvbnRtYXR0ZXIgU29ydGllcnVuZzogJHtjaGVja2VkfSBOb3RpemVuIGdlcHJcdTAwRkNmdCwgJHtjaGFuZ2VkfSBzb3J0aWVydC5gXG4gICAgICAgICAgOiBgRnJvbnRtYXR0ZXIgU29ydGllcnVuZzogJHtjaGVja2VkfSBOb3RpemVuIGdlcHJcdTAwRkNmdCwgYmVyZWl0cyBhbGxlIHNvcnRpZXJ0LmBcbiAgICAgICk7XG4gICAgfSksXG4gIH0pO1xuXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJmcm9udG1hdHRlci1zb3J0aWVydW5nLXR5cFwiLFxuICAgIG5hbWU6IFwiVFlQIC0gRnJvbnRtYXR0ZXIgU29ydGllcnVuZyBmXHUwMEZDciBUWVAgYWt0dWFsaXNpZXJlblwiLFxuICAgIGNhbGxiYWNrOiBydW5PclJlcG9ydEVycm9yKFwiRnJvbnRtYXR0ZXIgU29ydGllcnVuZ1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAvLyBEZXJzZWxiZSBUWVAtUGlja2VyIHdpZSBcdTAwRkNiZXJhbGwgc29uc3QgaW0gUGx1Z2luIChzaWVoZSB0eXBlLXBpY2tlci5qcykgLVxuICAgICAgLy8gemVpZ3QgRmFyYmUsIEJlc2NocmVpYnVuZyB1bmQgTm90aXotQW56YWhsIHN0YXR0IGVpbmVyIHJlaW5lbiBOYW1lbnNsaXN0ZVxuICAgICAgLy8gKHVuZCBtZWxkZXQgc2VsYnN0LCBmYWxscyBlcyBnYXIga2VpbmUgVFlQZW4gZ2lidCkuIGluY2x1ZGVNYW51YWxPZmYgdW5kXG4gICAgICAvLyBpbmNsdWRlVW5yZWdpc3RlcmVkOiB0cnVlLCBkYSBkaWUgU29ydGllcnVuZyB1bmFiaFx1MDBFNG5naWcgZGF2b24gc2lubnZvbGxcbiAgICAgIC8vIGlzdCwgb2IgZWluIFRZUCBtYW51ZWxsIHZlcmdlYmVuIHdlcmRlbiBkYXJmICh6LiBCLiBLT05UQUtULCBFWFRFUk4pXG4gICAgICAvLyBvZGVyIFx1MDBGQ2JlcmhhdXB0IGluIGRlciBUWVAtTGlzdGUgcmVnaXN0cmllcnQgaXN0LlxuICAgICAgY29uc3QgdHlwZSA9IGF3YWl0IHBsdWdpbi5waWNrVHlwZSh7IGluY2x1ZGVNYW51YWxPZmY6IHRydWUsIGluY2x1ZGVVbnJlZ2lzdGVyZWQ6IHRydWUgfSk7XG4gICAgICBpZiAoIXR5cGUpIHJldHVybjtcbiAgICAgIGNvbnN0IHsgY2hlY2tlZCwgY2hhbmdlZCwgaGFzVHlwZURlZmF1bHRzIH0gPSBhd2FpdCBzb3J0QWxsRnJvbnRtYXR0ZXIocGx1Z2luLmFwcCwgcGx1Z2luLCB0eXBlKTtcbiAgICAgIGxldCBtZXNzYWdlID1cbiAgICAgICAgY2hhbmdlZCA+IDBcbiAgICAgICAgICA/IGBGcm9udG1hdHRlciBTb3J0aWVydW5nICR7dHlwZX06ICR7Y2hlY2tlZH0gTm90aXplbiBnZXByXHUwMEZDZnQsICR7Y2hhbmdlZH0gc29ydGllcnQuYFxuICAgICAgICAgIDogYEZyb250bWF0dGVyIFNvcnRpZXJ1bmcgJHt0eXBlfTogJHtjaGVja2VkfSBOb3RpemVuIGdlcHJcdTAwRkNmdCwgYmVyZWl0cyBhbGxlIHNvcnRpZXJ0LmA7XG4gICAgICAvLyBLZWluIEZlaGxlciwgYWJlciBvaG5lIFN0YW5kYXJkLUZyb250bWF0dGVyIGdyZWlmdCBmXHUwMEZDciBkaWVzZW4gVHlwIG51clxuICAgICAgLy8gZGllIGdsb2JhbGUgUmVpaGVuZm9sZ2UgKFRZUCBzZWxic3QsIGZlc3QgcG9zaXRpb25pZXJ0ZSBQcm9wZXJ0aWVzKSAtXG4gICAgICAvLyBvaG5lIGRpZXNlbiBIaW53ZWlzIHdcdTAwRTRyZSB1bmtsYXIsIHdhcnVtIHNpY2ggZ2dmLiBuaWNodHMgZ2VcdTAwRTRuZGVydCBoYXQuXG4gICAgICBpZiAoaGFzVHlwZURlZmF1bHRzID09PSBmYWxzZSkge1xuICAgICAgICBtZXNzYWdlICs9IGAgSGlud2VpczogRlx1MDBGQ3IgJHt0eXBlfSBpc3Qga2VpbiBTdGFuZGFyZC1Gcm9udG1hdHRlciBoaW50ZXJsZWd0IC0gbnVyIGRpZSBnbG9iYWxlIFJlaWhlbmZvbGdlIHd1cmRlIGFuZ2V3ZW5kZXQuYDtcbiAgICAgIH1cbiAgICAgIG5ldyBOb3RpY2UobWVzc2FnZSk7XG4gICAgfSksXG4gIH0pO1xuXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJmcm9udG1hdHRlci1zb3J0aWVydW5nLWFrdGl2ZS1ub3RpelwiLFxuICAgIG5hbWU6IFwiVFlQIC0gRnJvbnRtYXR0ZXIgU29ydGllcnVuZyBkZXIgYWt0aXZlbiBOb3RpeiBha3R1YWxpc2llcmVuXCIsXG4gICAgY2hlY2tDYWxsYmFjazogKGNoZWNraW5nKSA9PiB7XG4gICAgICBjb25zdCBmaWxlID0gcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xuICAgICAgaWYgKCFmaWxlIHx8IGZpbGUuZXh0ZW5zaW9uICE9PSBcIm1kXCIpIHJldHVybiBmYWxzZTtcbiAgICAgIGlmIChjaGVja2luZykgcmV0dXJuIHRydWU7XG5cbiAgICAgIHJ1bk9yUmVwb3J0RXJyb3IoXCJGcm9udG1hdHRlciBTb3J0aWVydW5nXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgY2hhbmdlZCA9IGF3YWl0IHNvcnRTaW5nbGVGaWxlRnJvbnRtYXR0ZXIocGx1Z2luLmFwcCwgcGx1Z2luLCBmaWxlKTtcbiAgICAgICAgbmV3IE5vdGljZShjaGFuZ2VkID8gYEZyb250bWF0dGVyIHZvbiBcIiR7ZmlsZS5iYXNlbmFtZX1cIiBzb3J0aWVydC5gIDogYEZyb250bWF0dGVyIHZvbiBcIiR7ZmlsZS5iYXNlbmFtZX1cIiB3YXIgYmVyZWl0cyBzb3J0aWVydC5gKTtcbiAgICAgIH0pKCk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9LFxuICB9KTtcblxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJDb21tYW5kcyB9O1xuIiwgImNvbnN0IHsgbW9tZW50IH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5cbi8vIEVya2FubnRlIFBsYXR6aGFsdGVyIGZcdTAwRkNyIFdlcnRlIGltIFN0YW5kYXJkLUZyb250bWF0dGVyIGVpbmVzIFRZUHMgKFRZUC1cbi8vIERldGFpbGFuc2ljaHQpLiBBbHMgcmVpbmVyIFRleHQtV2VydCBpbnMgRnJvbnRtYXR0ZXItV2lkZ2V0IGVpbmdldHJhZ2VuXG4vLyAoei4gQi4gYmVpIFwiRGF0dW1cIiBhbHMgV2VydCBcInt7dG9kYXl9fVwiIHN0YXR0IGVpbmVzIGVjaHRlbiBEYXR1bXMpIHVuZCBlcnN0XG4vLyBiZWltIEFicnVmIFx1MDBGQ2JlciBnZXRUeXBlRGVmYXVsdHMoKSBhdWZnZWxcdTAwRjZzdCAoc2llaGUgbWFpbi5qcykgLSBuaWNodCBzY2hvblxuLy8gYmVpbSBTcGVpY2hlcm4sIGRhbWl0IHouIEIuIFwie3t0b2RheX19XCIgYmVpIGplZGVyIG5ldSBhbmdlbGVndGVuIE5vdGl6IGRhc1xuLy8gZGFubiBha3R1ZWxsZSBEYXR1bSBsaWVmZXJ0IHN0YXR0IGRlcyBUYWdlcywgYW4gZGVtIGRlciBEZWZhdWx0IGdlc2V0enQgd3VyZGUuXG5jb25zdCBGUk9OVE1BVFRFUl9QTEFDRUhPTERFUlMgPSBbXG4gIHtcbiAgICB0b2tlbjogXCJ7e3RvZGF5fX1cIixcbiAgICBkZXNjcmlwdGlvbjogXCJIZXV0aWdlcyBEYXR1bSAoSkpKSi1NTS1UVClcIixcbiAgICByZXNvbHZlOiAoKSA9PiBtb21lbnQoKS5mb3JtYXQoXCJZWVlZLU1NLUREXCIpLFxuICB9LFxuICB7XG4gICAgdG9rZW46IFwie3tub3d9fVwiLFxuICAgIGRlc2NyaXB0aW9uOiBcIkFrdHVlbGxlcyBEYXR1bSBtaXQgVWhyemVpdCAoSkpKSi1NTS1UVCBISDptbSlcIixcbiAgICByZXNvbHZlOiAoKSA9PiBtb21lbnQoKS5mb3JtYXQoXCJZWVlZLU1NLUREIEhIOm1tXCIpLFxuICB9LFxuICB7XG4gICAgLy8gQW5kZXJzIGFscyB7e3RvZGF5fX0ve3tub3d9fSBuaWNodCBkZXIgQXVmcnVmemVpdHB1bmt0LCBzb25kZXJuIGRhc1xuICAgIC8vIEVyc3RlbGx1bmdzZGF0dW0gZGVyIGpld2VpbGlnZW4gRGF0ZWkgKGZpbGUuc3RhdC5jdGltZSkgLSBicmF1Y2h0IGRhaGVyXG4gICAgLy8gZGllIFppZWwtRGF0ZWkgYWxzIEtvbnRleHQsIHNpZWhlIGZpbGUtUGFyYW1ldGVyIGJlaSByZXNvbHZlKCkgdW5kXG4gICAgLy8gcmVzb2x2ZUZyb250bWF0dGVyUGxhY2Vob2xkZXJzKCkgdW50ZW4uIE9obmUgRGF0ZWkgKHouIEIuIEF1ZnJ1ZiBvaG5lXG4gICAgLy8gZmlsZS1PcHRpb24pIEZhbGxiYWNrIGF1ZiBkZW4gYWt0dWVsbGVuIFplaXRwdW5rdC5cbiAgICB0b2tlbjogXCJ7e2NyZWF0ZWR9fVwiLFxuICAgIGRlc2NyaXB0aW9uOiBcIkVyc3RlbGx1bmdzZGF0dW0gZGVyIERhdGVpIChKSkpKLU1NLVRUKVwiLFxuICAgIHJlc29sdmU6IChmaWxlKSA9PiBtb21lbnQoZmlsZT8uc3RhdD8uY3RpbWUgPz8gRGF0ZS5ub3coKSkuZm9ybWF0KFwiWVlZWS1NTS1ERFwiKSxcbiAgfSxcbl07XG5cbi8vIER5bmFtaXNjaGVyIFBsYXR6aGFsdGVyLCB6LiBCLiBcInt7dHAud2FlaGxlQXV0b3JWb3J0cmFnfX1cIiAtIHJ1ZnQgYmVpbVxuLy8gQW5sZWdlbiBlaW5lciBOb3RpeiBkYXMgZ2xlaWNobmFtaWdlIFRlbXBsYXRlci1Ta3JpcHQgKHRwLnVzZXIuPFNrcmlwdG5hbWU+LFxuLy8gc2llaGUgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzLykgYXVmIHVuZCBcdTAwRkNiZXJuaW1tdCBkZXNzZW4gUlx1MDBGQ2NrZ2FiZXdlcnQuXG4vLyBBbmRlcnMgYWxzIGRpZSBleGFrdGVuIFRva2VuIG9iZW4gaGllciBOSUNIVCBhdWZsXHUwMEY2c2JhciAoZGFzIFBsdWdpbiBoYXRcbi8vIGtlaW5lbiBadWdyaWZmIGF1ZiB0cCkgLSBudXIgYWxzIE11c3RlciBlcmtlbm5iYXIsIGRhbWl0IGRpZSBXYXJudW5ncy1cbi8vIFVudGVyZHJcdTAwRkNja3VuZy9FaW5mXHUwMEU0cmJ1bmcgaW0gU3RhbmRhcmQtRnJvbnRtYXR0ZXItRWRpdG9yIHRyb3R6ZGVtIGdyZWlmdC5cbi8vIERpZSBlaWdlbnRsaWNoZSBBdWZsXHUwMEY2c3VuZyBcdTAwRkNiZXJuaW1tdCBUWVAuanMgc2VsYnN0LCB2b3IgZGVtIFNjaHJlaWJlbiBpbnNcbi8vIEZyb250bWF0dGVyIChBdWZydWYtIHVuZCBSXHUwMEZDY2tnYWJlLUtvbnZlbnRpb24gc2llaGUgZG9ydCBiencuIFJFQURNRSkuXG4vLyBTa3JpcHRuYW1lID0gRGF0ZWluYW1lIGluIHRlbXBsYXRlci1zY3JpcHRzLyBvaG5lIFwiLmpzXCIsIGRhaGVyIGF1Y2ggbWl0XG4vLyBVbWxhdXRlbiwgXCItXCIgb2RlciBMZWVyemVpY2hlbiBlcmxhdWJ0IC0gbnVyIGtlaW5lIGdlc2Nod2VpZnRlbiBLbGFtbWVybi5cbmNvbnN0IERZTkFNSUNfUExBQ0VIT0xERVJfUEFUVEVSTiA9IC9eXFx7XFx7dHBcXC4oW157fV0qW157fVxcc11bXnt9XSopXFx9XFx9JC87XG5jb25zdCBEWU5BTUlDX1BMQUNFSE9MREVSX0lORk8gPSB7XG4gIHRva2VuOiBcInt7dHAuPFNrcmlwdG5hbWU+fX1cIixcbiAgZGVzY3JpcHRpb246XG4gICAgXCJSdWZ0IGJlaW0gQW5sZWdlbiB0cC51c2VyLjxTa3JpcHRuYW1lPih0cCwgbmV3RmlsZSwgY3R4KSBhdWYgXHUyMDEzIFJcdTAwRkNja2dhYmU6IFdlcnQgZGllc2VyIFByb3BlcnR5LCBvZGVyIGVpbiBPYmpla3QgbWl0IFdlcnRlbiBmXHUwMEZDciBtZWhyZXJlIFByb3BlcnRpZXMgZGVzIFRZUHNcIixcbn07XG5cbi8vIEtvcGllIHZvbiBmcm9udG1hdHRlciBtaXQgYXVmZ2VsXHUwMEY2c3RlbiBQbGF0emhhbHRlcm4gLSBudXIgZXhha3RlIFdlcnRlXG4vLyAoa2VpbiBFcnNldHplbiBpbm5lcmhhbGIgZWluZXMgbFx1MDBFNG5nZXJlbiBTdHJpbmdzKSwgZGFtaXQgei4gQi4gXCJ7e3RvZGF5fX1cIlxuLy8gYWxzIGxpdGVyYWxlciBUZXh0IGluIGVpbmVtIGFuZGVyZW4gUHJvcGVydHkgdW5hbmdldGFzdGV0IGJsZWlidC4gV2VydGUgaW1cbi8vIGR5bmFtaXNjaGVuIFwie3t0cC48U2tyaXB0bmFtZT59fVwiLU11c3RlciBibGVpYmVuIGhpZXIgYmV3dXNzdCB1bmFuZ2V0YXN0ZXQsXG4vLyBzaWVoZSBLb21tZW50YXIgYmVpIERZTkFNSUNfUExBQ0VIT0xERVJfUEFUVEVSTi4gZmlsZSAob3B0aW9uYWwpIHdpcmQgYW5cbi8vIHJlc29sdmUoKSBkdXJjaGdlcmVpY2h0IC0gbnVyIHZvbiBcInt7Y3JlYXRlZH19XCIgZ2VudXR6dCwgc2llaGUgb2Jlbi5cbmZ1bmN0aW9uIHJlc29sdmVGcm9udG1hdHRlclBsYWNlaG9sZGVycyhmcm9udG1hdHRlciwgZmlsZSkge1xuICBjb25zdCByZXNvbHZlZCA9IHt9O1xuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhmcm9udG1hdHRlcikpIHtcbiAgICBjb25zdCBwbGFjZWhvbGRlciA9IEZST05UTUFUVEVSX1BMQUNFSE9MREVSUy5maW5kKChwKSA9PiBwLnRva2VuID09PSB2YWx1ZSk7XG4gICAgcmVzb2x2ZWRba2V5XSA9IHBsYWNlaG9sZGVyID8gcGxhY2Vob2xkZXIucmVzb2x2ZShmaWxlKSA6IHZhbHVlO1xuICB9XG4gIHJldHVybiByZXNvbHZlZDtcbn1cblxuZnVuY3Rpb24gaXNQbGFjZWhvbGRlclRva2VuKHZhbHVlKSB7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIpIHJldHVybiBmYWxzZTtcbiAgaWYgKEZST05UTUFUVEVSX1BMQUNFSE9MREVSUy5zb21lKChwKSA9PiBwLnRva2VuID09PSB2YWx1ZSkpIHJldHVybiB0cnVlO1xuICByZXR1cm4gRFlOQU1JQ19QTEFDRUhPTERFUl9QQVRURVJOLnRlc3QodmFsdWUpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgRlJPTlRNQVRURVJfUExBQ0VIT0xERVJTLFxuICBEWU5BTUlDX1BMQUNFSE9MREVSX1BBVFRFUk4sXG4gIERZTkFNSUNfUExBQ0VIT0xERVJfSU5GTyxcbiAgcmVzb2x2ZUZyb250bWF0dGVyUGxhY2Vob2xkZXJzLFxuICBpc1BsYWNlaG9sZGVyVG9rZW4sXG59O1xuIiwgImNvbnN0IHsgVEZpbGUsIFZhdWx0LCBkZWJvdW5jZSwgbm9ybWFsaXplUGF0aCB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBGUk9OVE1BVFRFUl9QTEFDRUhPTERFUlMgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLXBsYWNlaG9sZGVyc1wiKTtcblxuLy8gTWFya2VyLUtsYXNzZSBhbSBDb250YWluZXIgZGVzIFN0YW5kYXJkLUZyb250bWF0dGVyLUVkaXRvcnMgKGdlc2V0enQgaW5cbi8vIG1vdW50RnJvbnRtYXR0ZXJFZGl0b3IsIHR5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKSAtIGdyZW56dCBkaWVcbi8vIFBsYXR6aGFsdGVyLVZvcnNjaGxcdTAwRTRnZSB1bnRlbiBhdWYgZGllc2VuIEVkaXRvciBlaW4sIGVjaHRlIE5vdGl6ZW4gYmxlaWJlblxuLy8gdW5iZXJcdTAwRkNocnQuXG5jb25zdCBFRElUT1JfQ0xBU1MgPSBcImZyZWQtdHlwLWZyb250bWF0dGVyLWVkaXRvclwiO1xuXG4vLyBOdXIgVGVtcGxhdGVyLVNrcmlwdGUgbWl0IGRpZXNlbSBNYXJrZXIgaW4gZWluZW0gS29tbWVudGFyIHdlcmRlbiBhbHNcbi8vIFwie3t0cC48U2tyaXB0bmFtZT59fVwiIHZvcmdlc2NobGFnZW4gLSByZWluZSBIaWxmc3NrcmlwdGUgKHouIEIuXG4vLyB0b0xpc3RJZk11bHRpcGxlLCBUWVAgc2VsYnN0KSBlcmdlYmVuIGFscyBTaG9ydGN1dCBrZWluZW4gU2lubi5cbmNvbnN0IFNIT1JUQ1VUX01BUktFUiA9IC9eXFxzKig/OlxcL1xcL3xcXC9cXCp8XFwqKS4qQHR5cC1zaG9ydGN1dFxcYi9tO1xuXG4vLyBQbGF0emhhbHRlci1Wb3JzY2hsXHUwMEU0Z2UgaW0gV2VydC1GZWxkIGRlcyBTdGFuZGFyZC1Gcm9udG1hdHRlci1FZGl0b3JzLFxuLy8gc29iYWxkIGRlciBXZXJ0IG1pdCBcIntcIiBiZWdpbm50OiBkaWUgZmVzdGVuIFRva2VuICh7e3RvZGF5fX0gdXN3Likgc293aWVcbi8vIFwie3t0cC48U2tyaXB0bmFtZT59fVwiIGZcdTAwRkNyIGplZGVzIG1hcmtpZXJ0ZSBUZW1wbGF0ZXItU2tyaXB0LlxuLy9cbi8vIE9ic2lkaWFucyBXZXJ0LVZvcnNjaGxcdTAwRTRnZSAoVGV4dC0gdW5kIExpc3Rlbi1Qcm9wZXJ0aWVzKSBob2xlbiBpaHJlXG4vLyBLYW5kaWRhdGVuIGF1c3NjaGxpZVx1MDBERmxpY2ggXHUwMEZDYmVyIG1ldGFkYXRhQ2FjaGUuZ2V0RnJvbnRtYXR0ZXJQcm9wZXJ0eVZhbHVlc0ZvcktleVxuLy8gKGtleSkgdW5kIGZpbHRlcm4vc29ydGllcmVuL3JlbmRlcm4gc2llIGRhbmFjaCBzZWxic3QgKGZ1enp5IGdlZ2VuIGRlblxuLy8gZ2V0aXBwdGVuIFRleHQsIHNpZWhlIGdldFN1Z2dlc3Rpb25zIGRlciBQcm9wZXJ0eS1XZXJ0LVN1Z2dlc3QtS2xhc3NlIGltXG4vLyBnZWJhdXRlbiBhcHAuanMpLiBTdGF0dCBlaW5lIGVpZ2VuZSBTdWdnZXN0LUtvbXBvbmVudGUgZGFuZWJlbnp1c2V0emVuXG4vLyAoZGllIG1pdCBkZXIgbmF0aXZlbiBrb25rdXJyaWVyZW4gd1x1MDBGQ3JkZSksIHdpcmQgZGVzaGFsYiBudXIgZGllc2UgZWluZVxuLy8gTWV0aG9kZSB1bWhcdTAwRkNsbHQ6IExpZWd0IGRlciBGb2t1cyBnZXJhZGUgaW4gZWluZW0gV2VydC1GZWxkIGRpZXNlcyBFZGl0b3JzXG4vLyB1bmQgYmVnaW5udCBkZXIgV2VydCBtaXQgXCJ7XCIsIGtvbW1lbiBkaWUgUGxhdHpoYWx0ZXIgdm9ybmUgZGF6dSAtIHNvbnN0XG4vLyB1bnZlclx1MDBFNG5kZXJ0IGRhcyBPcmlnaW5hbC4gRGVyIEF1ZnJ1ZiBwYXNzaWVydCBzeW5jaHJvbiBiZWltIFRpcHBlbiwgZGVyXG4vLyBGb2t1cyBpc3QgZGFiZWkgenV2ZXJsXHUwMEU0c3NpZyBkYXMgRWluZ2FiZWZlbGQgc2VsYnN0LlxuLy9cbi8vIERpZSBTa3JpcHRsaXN0ZSB3aXJkIHZvcmFiIChhc3luY2hyb24pIGF1cyBUZW1wbGF0ZXJzIFNrcmlwdC1PcmRuZXJcbi8vIGdlbGVzZW4gdW5kIGJlaSBcdTAwQzRuZGVydW5nZW4gZGFyaW4gbmFjaGdlZlx1MDBGQ2hydCAtIGRpZSB1bWhcdTAwRkNsbHRlIE1ldGhvZGUgbXVzc1xuLy8gc3luY2hyb24gYmxlaWJlbiB1bmQga2FubiBEYXRlaWVuIG5pY2h0IGVyc3QgYmVpbSBUaXBwZW4gbGVzZW4uXG5mdW5jdGlvbiByZWdpc3RlclBsYWNlaG9sZGVyU3VnZ2VzdChwbHVnaW4pIHtcbiAgY29uc3QgeyBhcHAgfSA9IHBsdWdpbjtcbiAgY29uc3QgbWV0YWRhdGFDYWNoZSA9IGFwcC5tZXRhZGF0YUNhY2hlO1xuXG4gIGxldCBzY3JpcHRGb2xkZXIgPSBudWxsO1xuICBsZXQgc2hvcnRjdXRTY3JpcHRzID0gW107XG5cbiAgY29uc3QgY3VycmVudFNjcmlwdEZvbGRlciA9ICgpID0+IHtcbiAgICBjb25zdCBmb2xkZXIgPSBhcHAucGx1Z2lucy5wbHVnaW5zW1widGVtcGxhdGVyLW9ic2lkaWFuXCJdPy5zZXR0aW5ncz8udXNlcl9zY3JpcHRzX2ZvbGRlcjtcbiAgICByZXR1cm4gZm9sZGVyID8gbm9ybWFsaXplUGF0aChmb2xkZXIpIDogbnVsbDtcbiAgfTtcblxuICBjb25zdCBpc0luU2NyaXB0Rm9sZGVyID0gKHBhdGgpID0+ICEhc2NyaXB0Rm9sZGVyICYmICEhcGF0aCAmJiBwYXRoLnN0YXJ0c1dpdGgoc2NyaXB0Rm9sZGVyICsgXCIvXCIpO1xuXG4gIC8vIFdpZSBUZW1wbGF0ZXIgc2VsYnN0OiBhbGxlIC5qcy1EYXRlaWVuIGltIFNrcmlwdC1PcmRuZXIgaW5rbC5cbiAgLy8gVW50ZXJvcmRuZXJuLCBTa3JpcHRuYW1lID0gRGF0ZWluYW1lIG9obmUgRW5kdW5nLlxuICBhc3luYyBmdW5jdGlvbiByZWZyZXNoU2NyaXB0cygpIHtcbiAgICBjb25zdCBmb2xkZXJQYXRoID0gY3VycmVudFNjcmlwdEZvbGRlcigpO1xuICAgIHNjcmlwdEZvbGRlciA9IGZvbGRlclBhdGg7XG4gICAgY29uc3QgZm9sZGVyID0gZm9sZGVyUGF0aCA/IGFwcC52YXVsdC5nZXRGb2xkZXJCeVBhdGgoZm9sZGVyUGF0aCkgOiBudWxsO1xuICAgIGNvbnN0IGZpbGVzID0gW107XG4gICAgaWYgKGZvbGRlcikge1xuICAgICAgVmF1bHQucmVjdXJzZUNoaWxkcmVuKGZvbGRlciwgKGNoaWxkKSA9PiB7XG4gICAgICAgIGlmIChjaGlsZCBpbnN0YW5jZW9mIFRGaWxlICYmIGNoaWxkLmV4dGVuc2lvbiA9PT0gXCJqc1wiKSBmaWxlcy5wdXNoKGNoaWxkKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICBjb25zdCBuYW1lcyA9IFtdO1xuICAgIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgaWYgKFNIT1JUQ1VUX01BUktFUi50ZXN0KGF3YWl0IGFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpKSkgbmFtZXMucHVzaChmaWxlLmJhc2VuYW1lKTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihgVFlQLVN5c3RlbTogVGVtcGxhdGVyLVNrcmlwdCAke2ZpbGUucGF0aH0gbmljaHQgbGVzYmFyYCwgZSk7XG4gICAgICB9XG4gICAgfVxuICAgIC8vIE9yZG5lciB6d2lzY2hlbnplaXRsaWNoIGluIFRlbXBsYXRlciB1bWdlc3RlbGx0OiBFcmdlYm5pcyB2ZXJ3ZXJmZW4sXG4gICAgLy8gZGVyIExhdWYgZlx1MDBGQ3IgZGVuIG5ldWVuIE9yZG5lciBpc3QgYmVyZWl0cyBhbmdlc3RvXHUwMERGZW4uXG4gICAgaWYgKGZvbGRlclBhdGggIT09IHNjcmlwdEZvbGRlcikgcmV0dXJuO1xuICAgIHNob3J0Y3V0U2NyaXB0cyA9IG5hbWVzLnNvcnQoKGEsIGIpID0+IGEubG9jYWxlQ29tcGFyZShiKSk7XG4gIH1cblxuICBjb25zdCBzY2hlZHVsZVJlZnJlc2ggPSBkZWJvdW5jZShyZWZyZXNoU2NyaXB0cywgMzAwLCB0cnVlKTtcbiAgY29uc3Qgb25GaWxlQ2hhbmdlID0gKGZpbGUsIG9sZFBhdGgpID0+IHtcbiAgICBpZiAoaXNJblNjcmlwdEZvbGRlcihmaWxlPy5wYXRoKSB8fCBpc0luU2NyaXB0Rm9sZGVyKG9sZFBhdGgpKSBzY2hlZHVsZVJlZnJlc2goKTtcbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoYXBwLnZhdWx0Lm9uKFwiY3JlYXRlXCIsIG9uRmlsZUNoYW5nZSkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJtb2RpZnlcIiwgb25GaWxlQ2hhbmdlKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC52YXVsdC5vbihcImRlbGV0ZVwiLCBvbkZpbGVDaGFuZ2UpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoYXBwLnZhdWx0Lm9uKFwicmVuYW1lXCIsIG9uRmlsZUNoYW5nZSkpO1xuICBhcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkocmVmcmVzaFNjcmlwdHMpO1xuXG4gIGNvbnN0IHBsYWNlaG9sZGVyVG9rZW5zID0gKCkgPT4gW1xuICAgIC4uLkZST05UTUFUVEVSX1BMQUNFSE9MREVSUy5tYXAoKHApID0+IHAudG9rZW4pLFxuICAgIC4uLnNob3J0Y3V0U2NyaXB0cy5tYXAoKG5hbWUpID0+IGB7e3RwLiR7bmFtZX19fWApLFxuICBdO1xuXG4gIGNvbnN0IG9yaWdpbmFsID0gbWV0YWRhdGFDYWNoZS5nZXRGcm9udG1hdHRlclByb3BlcnR5VmFsdWVzRm9yS2V5O1xuICBjb25zdCB3cmFwcGVkID0gZnVuY3Rpb24gKC4uLmFyZ3MpIHtcbiAgICBjb25zdCB2YWx1ZXMgPSBvcmlnaW5hbC5hcHBseSh0aGlzLCBhcmdzKTtcbiAgICBjb25zdCBpbnB1dEVsID0gYWN0aXZlRG9jdW1lbnQuYWN0aXZlRWxlbWVudDtcbiAgICBpZiAoIWlucHV0RWw/LmNsb3Nlc3Q/LihgLiR7RURJVE9SX0NMQVNTfWApKSByZXR1cm4gdmFsdWVzO1xuICAgIGNvbnN0IHRleHQgPSB0eXBlb2YgaW5wdXRFbC52YWx1ZSA9PT0gXCJzdHJpbmdcIiA/IGlucHV0RWwudmFsdWUgOiBpbnB1dEVsLnRleHRDb250ZW50ID8/IFwiXCI7XG4gICAgaWYgKCF0ZXh0LnRyaW1TdGFydCgpLnN0YXJ0c1dpdGgoXCJ7XCIpKSByZXR1cm4gdmFsdWVzO1xuXG4gICAgLy8gVGVtcGxhdGVyLU9yZG5lciBpbnp3aXNjaGVuIHVtZ2VzdGVsbHQ6IGZcdTAwRkNyIGRlbiBuXHUwMEU0Y2hzdGVuIFRhc3RlbmRydWNrXG4gICAgLy8gbmFjaGxhZGVuLCBqZXR6dCBub2NoIG1pdCBkZXIgYmlzaGVyaWdlbiBMaXN0ZSBhbnR3b3J0ZW4uXG4gICAgaWYgKGN1cnJlbnRTY3JpcHRGb2xkZXIoKSAhPT0gc2NyaXB0Rm9sZGVyKSBzY2hlZHVsZVJlZnJlc2goKTtcbiAgICBjb25zdCB0b2tlbnMgPSBwbGFjZWhvbGRlclRva2VucygpO1xuICAgIHJldHVybiBbLi4udG9rZW5zLCAuLi52YWx1ZXMuZmlsdGVyKCh2KSA9PiAhdG9rZW5zLmluY2x1ZGVzKHYpKV07XG4gIH07XG4gIG1ldGFkYXRhQ2FjaGUuZ2V0RnJvbnRtYXR0ZXJQcm9wZXJ0eVZhbHVlc0ZvcktleSA9IHdyYXBwZWQ7XG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiB7XG4gICAgaWYgKG1ldGFkYXRhQ2FjaGUuZ2V0RnJvbnRtYXR0ZXJQcm9wZXJ0eVZhbHVlc0ZvcktleSA9PT0gd3JhcHBlZCkge1xuICAgICAgbWV0YWRhdGFDYWNoZS5nZXRGcm9udG1hdHRlclByb3BlcnR5VmFsdWVzRm9yS2V5ID0gb3JpZ2luYWw7XG4gICAgfVxuICB9KTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyUGxhY2Vob2xkZXJTdWdnZXN0LCBFRElUT1JfQ0xBU1MgfTtcbiIsICJjb25zdCB7IE1hcmtkb3duVmlldywgTWVudSB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBpc1BsYWNlaG9sZGVyVG9rZW4gfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLXBsYWNlaG9sZGVyc1wiKTtcbmNvbnN0IHsgRURJVE9SX0NMQVNTOiBQTEFDRUhPTERFUl9TVUdHRVNUX0VESVRPUl9DTEFTUyB9ID0gcmVxdWlyZShcIi4vcGxhY2Vob2xkZXItc3VnZ2VzdFwiKTtcbmNvbnN0IHsgZ2V0U3VidHlwZSwgZW5zdXJlU3VidHlwZSB9ID0gcmVxdWlyZShcIi4vc3VidHlwZXNcIik7XG5cbmNvbnN0IFRZUF9QUk9QRVJUWSA9IFwiVFlQXCI7XG5jb25zdCBTVUJUWVBfUFJPUEVSVFkgPSBcIlNVQlRZUFwiO1xuY29uc3QgU1lTVEVNX1BST1BFUlRJRVMgPSBbVFlQX1BST1BFUlRZLnRvTG93ZXJDYXNlKCksIFNVQlRZUF9QUk9QRVJUWS50b0xvd2VyQ2FzZSgpXTtcblxuLy8gRGVyIFdlcnQgZGVyIFRZUC0gYnp3LiBTVUJUWVAtUHJvcGVydHkgaXN0IHBlciBEZWZpbml0aW9uIGltbWVyIGRlciBOYW1lIGRlc1xuLy8gVFlQcy9TdWJ0eXBzIHNlbGJzdCAtIGFscyBcIlN0YW5kYXJkXCItUHJvcGVydHkgd1x1MDBFNHJlIHNpZSBhbHNvIHJlZHVuZGFudCB1bmRcbi8vIGtcdTAwRjZubnRlIGJlaSBlaW5lciBVbWJlbmVubnVuZyAodW5iZW1lcmt0KSB2b20gdGF0c1x1MDBFNGNobGljaGVuIE5hbWVuIGFid2VpY2hlbi5cbi8vIFNpZSBkYXJmIGRlc2hhbGIgaW4gZGllc2VtIEVkaXRvciBnYXIgbmljaHQgZXJzdCBhbHMgZWlnZW5lIFplaWxlIGF1ZnRhdWNoZW4uXG4vLyBNdXRpZXJ0IFwiZnJvbnRtYXR0ZXJcIiBpbi1wbGFjZSAoc3RhdHQgZWluZSBLb3BpZSB6dXJcdTAwRkNja3p1Z2ViZW4pIC0gT2JzaWRpYW5zXG4vLyBQcm9wZXJ0eS1FZGl0b3Igc2NoZWludCBiZWltIHN5bmNocm9uaXplKCkgYXVmIGVpbmUgc3RhYmlsZSBPYmpla3RyZWZlcmVuelxuLy8gYW5nZXdpZXNlbiB6dSBzZWluOyBlaW5lIG5ldSBlcnpldWd0ZSBLb3BpZSBoYXQgYmVpbSBhbGxlcmVyc3RlbiBSZW5kZXJuIHp1XG4vLyBlaW5lbSBTdGFjayBPdmVyZmxvdyBpbiBPYnNpZGlhbnMgZWlnZW5lciByZW5kZXJQcm9wZXJ0eSgpLVBpcGVsaW5lIGdlZlx1MDBGQ2hydC5cbmZ1bmN0aW9uIHN0cmlwVHlwUHJvcGVydHkoZnJvbnRtYXR0ZXIpIHtcbiAgZm9yIChjb25zdCBrZXkgb2YgT2JqZWN0LmtleXMoZnJvbnRtYXR0ZXIpKSB7XG4gICAgaWYgKFNZU1RFTV9QUk9QRVJUSUVTLmluY2x1ZGVzKGtleS50cmltKCkudG9Mb3dlckNhc2UoKSkpIGRlbGV0ZSBmcm9udG1hdHRlcltrZXldO1xuICB9XG4gIHJldHVybiBmcm9udG1hdHRlcjtcbn1cblxuLy8gU3BlaWNoZXJvcnQgZWluZXMgRnJvbnRtYXR0ZXItQmxvY2tzIGluIGRlbiBQbHVnaW4tU2V0dGluZ3MgLSBlbnR3ZWRlciBkYXNcbi8vIFN0YW5kYXJkLUZyb250bWF0dGVyIGVpbmVzIFRZUHMgKHR5cGVEZWZhdWx0RnJvbnRtYXR0ZXIvdHlwZUZsb2F0aW5nS2V5cylcbi8vIG9kZXIgZGVyIEJsb2NrIGVpbmVzIHNlaW5lciBTdWJ0eXBlbiAodHlwZVN1YnR5cGVzLCBzaWVoZSBzdWJ0eXBlcy5qcykuXG4vLyBFZGl0b3IsIEZsb2F0aW5nLU1lblx1MDBGQyB1bmQgUHJvcGVydHktVW1iZW5lbm51bmcgYXJiZWl0ZW4gYXVzc2NobGllXHUwMERGbGljaCBcdTAwRkNiZXJcbi8vIGRpZXNlIFNjaG5pdHRzdGVsbGUgdW5kIG1cdTAwRkNzc2VuIGRlbiBVbnRlcnNjaGllZCBuaWNodCBrZW5uZW4uXG5mdW5jdGlvbiB0eXBlU3RvcmUocGx1Z2luLCB0eXBlKSB7XG4gIHJldHVybiB7XG4gICAgdHlwZSxcbiAgICBzdWJ0eXBlOiBudWxsLFxuICAgIGdldEZyb250bWF0dGVyOiAoKSA9PiBwbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXSA/PyB7fSxcbiAgICBzZXRGcm9udG1hdHRlcjogKGZyb250bWF0dGVyKSA9PiB7XG4gICAgICBwbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXSA9IGZyb250bWF0dGVyO1xuICAgIH0sXG4gICAgZ2V0RmxvYXRpbmc6ICgpID0+IHBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdID8/IFtdLFxuICAgIHNldEZsb2F0aW5nOiAoa2V5cykgPT4ge1xuICAgICAgaWYgKGtleXMubGVuZ3RoID4gMCkgcGx1Z2luLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV0gPSBrZXlzO1xuICAgICAgZWxzZSBkZWxldGUgcGx1Z2luLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV07XG4gICAgfSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gc3VidHlwZVN0b3JlKHBsdWdpbiwgdHlwZSwgc3VidHlwZSkge1xuICByZXR1cm4ge1xuICAgIHR5cGUsXG4gICAgc3VidHlwZSxcbiAgICBnZXRGcm9udG1hdHRlcjogKCkgPT4gZ2V0U3VidHlwZShwbHVnaW4uc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpPy5mcm9udG1hdHRlciA/PyB7fSxcbiAgICBzZXRGcm9udG1hdHRlcjogKGZyb250bWF0dGVyKSA9PiB7XG4gICAgICBlbnN1cmVTdWJ0eXBlKHBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSkuZnJvbnRtYXR0ZXIgPSBmcm9udG1hdHRlcjtcbiAgICB9LFxuICAgIGdldEZsb2F0aW5nOiAoKSA9PiBnZXRTdWJ0eXBlKHBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSk/LmZsb2F0aW5nS2V5cyA/PyBbXSxcbiAgICBzZXRGbG9hdGluZzogKGtleXMpID0+IHtcbiAgICAgIGVuc3VyZVN1YnR5cGUocGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKS5mbG9hdGluZ0tleXMgPSBrZXlzO1xuICAgIH0sXG4gIH07XG59XG5cbi8vIE9ic2lkaWFucyBlaWdlbmVzIEZyb250bWF0dGVyLVdpZGdldCAoXCJQcm9wZXJ0aWVzXCIpIGlzdCBrZWluZSBvZmZpemllbGxlXG4vLyBQbHVnaW4tQVBJLiBJbnRlcm4gaXN0IGVzIGVpbmUgQ29tcG9uZW50LUtsYXNzZSAoaW0gZ2ViYXV0ZW4gYXBwLmpzIHp1XG4vLyBcIk1ldGFkYXRhRWRpdG9yXCIgbWluaWZpemllcnQpLCBkaWUgc293b2hsIHZvbiBqZWRlciBNYXJrZG93blZpZXcgYWxzIGF1Y2ggdm9uXG4vLyBkZXIgZWluZ2ViYXV0ZW4gXCJGaWxlIFByb3BlcnRpZXNcIi1QYW5lIHZlcndlbmRldCB3aXJkIC0gYmVpZGUgbGVnZW4gc2ljaCBiZWltXG4vLyBFcnpldWdlbiB1bmNvbmRpdGlvbmFsIGVpbmUgSW5zdGFueiB1bnRlciB2aWV3Lm1ldGFkYXRhRWRpdG9yIGFuLiBEaWUgS2xhc3NlXG4vLyBzZWxic3Qgd2lyZCBuaXJnZW5kcyB1bnRlciBlaW5lbSBOYW1lbiBleHBvcnRpZXJ0LCBpc3QgYWJlciBcdTAwRkNiZXIgZWluZVxuLy8gYmVsaWViaWdlIGJlcmVpdHMgdm9yaGFuZGVuZSBJbnN0YW56IGVycmVpY2hiYXIgKGluc3RhbmNlLmNvbnN0cnVjdG9yKSB1bmRcbi8vIGJsZWlidCBmXHUwMEZDciBkaWUgRGF1ZXIgZGVyIE9ic2lkaWFuLVNlc3Npb24gc3RhYmlsIC0gZWlubWFsaWdlcyBBYmdyZWlmZW4gdW5kXG4vLyBad2lzY2hlbnNwZWljaGVybiByZWljaHQgZGVzaGFsYiBhdXMuXG5sZXQgY2FjaGVkRWRpdG9yQ2xhc3MgPSBudWxsO1xuXG5mdW5jdGlvbiBnZXRNZXRhZGF0YUVkaXRvckNsYXNzKGFwcCkge1xuICBpZiAoY2FjaGVkRWRpdG9yQ2xhc3MpIHJldHVybiBjYWNoZWRFZGl0b3JDbGFzcztcblxuICBjb25zdCBhY3RpdmUgPSBhcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcbiAgaWYgKGFjdGl2ZT8ubWV0YWRhdGFFZGl0b3IpIHtcbiAgICBjYWNoZWRFZGl0b3JDbGFzcyA9IGFjdGl2ZS5tZXRhZGF0YUVkaXRvci5jb25zdHJ1Y3RvcjtcbiAgICByZXR1cm4gY2FjaGVkRWRpdG9yQ2xhc3M7XG4gIH1cbiAgZm9yIChjb25zdCBsZWFmIG9mIGFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikpIHtcbiAgICBpZiAobGVhZi52aWV3Py5tZXRhZGF0YUVkaXRvcikge1xuICAgICAgY2FjaGVkRWRpdG9yQ2xhc3MgPSBsZWFmLnZpZXcubWV0YWRhdGFFZGl0b3IuY29uc3RydWN0b3I7XG4gICAgICByZXR1cm4gY2FjaGVkRWRpdG9yQ2xhc3M7XG4gICAgfVxuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vLyBBbmFsb2cgenUgZ2V0TWV0YWRhdGFFZGl0b3JDbGFzcyBvYmVuOiBSZWZlcmVueiBhdWYgZGllIHByaXZhdGUgUHJvcGVydHktXG4vLyBaZWlsZW4tS2xhc3NlIChpbSBnZWJhdXRlbiBhcHAuanMgbWluaWZpemllcnQpLCBcdTAwRkNiZXIgZWluZSBiZXJlaXRzXG4vLyBnZXJlbmRlcnRlIFplaWxlIGFiZ2VncmlmZmVuIChkZXJlbiAuY29uc3RydWN0b3IpIC0gc3RhYmlsIGZcdTAwRkNyIGRpZSBEYXVlclxuLy8gZGVyIFNlc3Npb24uIFwiZWRpdG9yXCIgKGZhbGxzIHNjaG9uIHZvcmhhbmRlbikgd2lyZCB6dWVyc3QgcHJvYmllcnQsIGRhXG4vLyBkaWVzZSBLbGFzc2UgYXVzc2NobGllXHUwMERGbGljaCBmXHUwMEZDciBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaCgpIGdlYnJhdWNodCB3aXJkXG4vLyB1bmQgaW4gYWxsZXIgUmVnZWwgc2Nob24gZG9ydCB2ZXJmXHUwMEZDZ2JhciBpc3QsIHNvYmFsZCBkZXIgVHlwIG1pbmRlc3RlbnNcbi8vIGVpbmUgUHJvcGVydHkgaGF0LlxubGV0IGNhY2hlZFByb3BlcnR5Um93Q2xhc3MgPSBudWxsO1xuXG5mdW5jdGlvbiBnZXRQcm9wZXJ0eVJvd0NsYXNzKGFwcCwgZWRpdG9yKSB7XG4gIGlmIChjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzKSByZXR1cm4gY2FjaGVkUHJvcGVydHlSb3dDbGFzcztcbiAgaWYgKGVkaXRvcj8ucmVuZGVyZWQ/LlswXSkge1xuICAgIGNhY2hlZFByb3BlcnR5Um93Q2xhc3MgPSBlZGl0b3IucmVuZGVyZWRbMF0uY29uc3RydWN0b3I7XG4gICAgcmV0dXJuIGNhY2hlZFByb3BlcnR5Um93Q2xhc3M7XG4gIH1cbiAgY29uc3QgYWN0aXZlID0gYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XG4gIGlmIChhY3RpdmU/Lm1ldGFkYXRhRWRpdG9yPy5yZW5kZXJlZD8uWzBdKSB7XG4gICAgY2FjaGVkUHJvcGVydHlSb3dDbGFzcyA9IGFjdGl2ZS5tZXRhZGF0YUVkaXRvci5yZW5kZXJlZFswXS5jb25zdHJ1Y3RvcjtcbiAgICByZXR1cm4gY2FjaGVkUHJvcGVydHlSb3dDbGFzcztcbiAgfVxuICBmb3IgKGNvbnN0IGxlYWYgb2YgYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xuICAgIGlmIChsZWFmLnZpZXc/Lm1ldGFkYXRhRWRpdG9yPy5yZW5kZXJlZD8uWzBdKSB7XG4gICAgICBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzID0gbGVhZi52aWV3Lm1ldGFkYXRhRWRpdG9yLnJlbmRlcmVkWzBdLmNvbnN0cnVjdG9yO1xuICAgICAgcmV0dXJuIGNhY2hlZFByb3BlcnR5Um93Q2xhc3M7XG4gICAgfVxuICB9XG4gIHJldHVybiBudWxsO1xufVxuXG4vLyBFcmdcdTAwRTRuenQgZGFzIFJlY2h0c2tsaWNrLUtvbnRleHRtZW5cdTAwRkMgZWluZXIgUHJvcGVydHktWmVpbGUgdW0gZWluZW4gVG9nZ2xlXG4vLyBcIkZsb2F0aW5nXCIgR0FOWiBPQkVOIC0gYWJlciBleGtsdXNpdiBmXHUwMEZDciBaZWlsZW4gZGllc2VzIFBsdWdpbnNcbi8vIGVpZ2VuZXIgVFlQLURldGFpbGFuc2ljaHQgKGVya2FubnQgYW4gb3duZXIuZnJlZFN0b3JlLCBzaWVoZSB1bnRlbiksIG5pZSBpblxuLy8gZWNodGVuIE5vdGl6ZW4uIFVuYWJoXHUwMEU0bmdpZyB2b20gXCIrXCItQnV0dG9uIGxpbmtzIG5lYmVuIGRlbSBub3JtYWxlblxuLy8gKGZyZWRQZW5kaW5nRmxvYXRpbmdBZGQpLCBkZXIgbnVyIGJlaW0gTkVVRU4gQW5sZWdlbiBncmVpZnQgLSBkaWVzZXIgVG9nZ2xlXG4vLyB3aXJrdCBhdWYgSkVERSBiZXJlaXRzIHZvcmhhbmRlbmUgUHJvcGVydHksIGluIGJlaWRlIFJpY2h0dW5nZW4uXG4vL1xuLy8gT2JzaWRpYW5zIFByb3BlcnR5LUtvbnRleHRtZW5cdTAwRkMgaXN0IGtlaW5lIG9mZml6aWVsbGUgRXJ3ZWl0ZXJ1bmdzc3RlbGxlOiBFc1xuLy8gYmF1dCBhdWYgZGVtIERlc2t0b3AgZWluZW4gTkFUSVZFTiBFbGVjdHJvbi1NZW5cdTAwRkMgYXVzIGVpbmVyIGludGVyblxuLy8gZXJ6ZXVndGVuIE1lbnUtSW5zdGFueiB1bmQgemVpZ3Qgc2llIGlubmVyaGFsYiB2b24gc2hvd1Byb3BlcnR5TWVudSgpIGluXG4vLyBlaW5lbSBlaW56aWdlbiBzeW5jaHJvbmVuIEF1ZnJ1ZiBhbiAoa2VpbiBXb3Jrc3BhY2UtRXZlbnQsIGtlaW4gRE9NLVBvcHVwLFxuLy8gZGFzIHNpY2ggbmFjaHRyXHUwMEU0Z2xpY2ggcGVyIERPTS1NYW5pcHVsYXRpb24gZXJ3ZWl0ZXJuIGxpZVx1MDBERmUgLSBhbmRlcnMgYWxzXG4vLyB6LiBCLiBiZWkgXCJmaWxlLW1lbnVcIikuIERlc2hhbGIgaGllciBlaW4gTW9ua2V5LVBhdGNoIGF1ZiBkaWUgcHJpdmF0ZVxuLy8gWmVpbGVuLUtsYXNzZSBzZWxic3QgKHdpZSBzY2hvbiBiZWltIEdyYXBoLVJlbmRlcmVyLCBzaWVoZVxuLy8gZ3JhcGgtY29sb3JzLmpzKSwgYWJlciBzbyBlbmcgd2llIG1cdTAwRjZnbGljaCBnZWhhbHRlbjogZlx1MDBGQ3IgWmVpbGVuIGRpZXNlc1xuLy8gUGx1Z2lucyB3aXJkIGxlZGlnbGljaCwgdW5taXR0ZWxiYXIgYmV2b3IgT2JzaWRpYW4gc2VpbmUgYmVyZWl0cyBmZXJ0aWdcbi8vIGF1ZmdlYmF1dGUgTWVudS1JbnN0YW56IGFuemVpZ3QsIGVpbiBlaW56aWdlciB6dXNcdTAwRTR0emxpY2hlciBhZGRJdGVtKCktQXVmcnVmXG4vLyBkYXp3aXNjaGVuZ2VzY2hvYmVuIChcdTAwRkNiZXIgZWluZW4gbnVyIGZcdTAwRkNyIGRpZXNlbiBlaW5lbiBzeW5jaHJvbmVuIEF1ZnJ1ZlxuLy8gYWt0aXZlbiwgc2ljaCBkYW5hY2ggc2VsYnN0IHdpZWRlciB6dXJcdTAwRkNja3NldHplbmRlbiBQYXRjaCBhdWZcbi8vIE1lbnUucHJvdG90eXBlLnNob3dBdE1vdXNlRXZlbnQgLSBzaWNoZXIsIGRhIEpTIHNpbmdsZS10aHJlYWRlZCBpc3QgdW5kXG4vLyB3XHUwMEU0aHJlbmRkZXNzZW4ga2VpbiB6d2VpdGVzIE1lblx1MDBGQyBhdWZnZWJhdXQgd2VyZGVuIGthbm4pLiBEaWUgZ2VzYW10ZSBcdTAwRkNicmlnZVxuLy8gbmF0aXZlIE1lblx1MDBGQy1Mb2dpayAoVHlwIFx1MDBFNG5kZXJuLCBBdXNzY2huZWlkZW4vS29waWVyZW4vRWluZlx1MDBGQ2dlbiwgRW50ZmVybmVuKVxuLy8gYmxlaWJ0IGRhYmVpIGtvbXBsZXR0IHVuYW5nZXRhc3RldC5cbmZ1bmN0aW9uIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoKGFwcCwgZWRpdG9yKSB7XG4gIGNvbnN0IFJvd0NsYXNzID0gZ2V0UHJvcGVydHlSb3dDbGFzcyhhcHAsIGVkaXRvcik7XG4gIGlmICghUm93Q2xhc3MgfHwgUm93Q2xhc3MuX2ZyZWRNZW51UGF0Y2hlZCkgcmV0dXJuO1xuICBSb3dDbGFzcy5fZnJlZE1lbnVQYXRjaGVkID0gdHJ1ZTtcblxuICBjb25zdCBvcmlnaW5hbFNob3dQcm9wZXJ0eU1lbnUgPSBSb3dDbGFzcy5wcm90b3R5cGUuc2hvd1Byb3BlcnR5TWVudTtcbiAgUm93Q2xhc3MucHJvdG90eXBlLnNob3dQcm9wZXJ0eU1lbnUgPSBmdW5jdGlvbiAoZXZlbnQpIHtcbiAgICBjb25zdCBvd25lciA9IHRoaXMubWV0YWRhdGFFZGl0b3I/Lm93bmVyO1xuICAgIGlmICghb3duZXI/LmZyZWRTdG9yZSkgcmV0dXJuIG9yaWdpbmFsU2hvd1Byb3BlcnR5TWVudS5jYWxsKHRoaXMsIGV2ZW50KTtcblxuICAgIGNvbnN0IHJvdyA9IHRoaXM7XG4gICAgY29uc3Qgb3JpZ2luYWxTaG93QXRNb3VzZUV2ZW50ID0gTWVudS5wcm90b3R5cGUuc2hvd0F0TW91c2VFdmVudDtcbiAgICBNZW51LnByb3RvdHlwZS5zaG93QXRNb3VzZUV2ZW50ID0gZnVuY3Rpb24gKG1vdXNlRXZlbnQpIHtcbiAgICAgIE1lbnUucHJvdG90eXBlLnNob3dBdE1vdXNlRXZlbnQgPSBvcmlnaW5hbFNob3dBdE1vdXNlRXZlbnQ7XG4gICAgICBjb25zdCBpc0Zsb2F0aW5nID0gb3duZXIuZnJlZFN0b3JlLmdldEZsb2F0aW5nKCkuaW5jbHVkZXMocm93LmVudHJ5LmtleSk7XG4gICAgICAvLyBcInRpdGxlXCIgaXN0IGRpZSBlcnN0ZSBkZXIgdm9uIHNob3dQcm9wZXJ0eU1lbnUgcmVnaXN0cmllcnRlblxuICAgICAgLy8gU2VjdGlvbnMgKGFkZFNlY3Rpb25zKFsuLi5dKSkgdW5kIGF1ZiBkZW0gRGVza3RvcCBzb25zdCBsZWVyIChudXJcbiAgICAgIC8vIGF1ZiBNb2JpbGUgbWl0IGVpbmVtIHJlaW5lbiBMYWJlbC1FaW50cmFnIGJlbGVndCkgLSBsYW5kZXQgYWxzb1xuICAgICAgLy8genV2ZXJsXHUwMEU0c3NpZyBnYW56IG9iZW4uIFwicGluLW9mZlwiIChkdXJjaGdlc3RyaWNoZW5lciBQaW4pIHBhc3N0XG4gICAgICAvLyBpbmhhbHRsaWNoIHp1IFwibmljaHQgZmVzdCB2ZXJhbmtlcnRcIiA9IGZsb2F0aW5nLCBpbiBBbmFsb2dpZSB6dVxuICAgICAgLy8gXCJwaW5cIiBmXHUwMEZDciBcImZpeGllcnRcIiBpbiBhbmRlcmVuIEFwcHMuXG4gICAgICB0aGlzLmFkZEl0ZW0oKGl0ZW0pID0+XG4gICAgICAgIGl0ZW1cbiAgICAgICAgICAuc2V0VGl0bGUoXCJGbG9hdGluZ1wiKVxuICAgICAgICAgIC5zZXRJY29uKFwicGluLW9mZlwiKVxuICAgICAgICAgIC5zZXRDaGVja2VkKGlzRmxvYXRpbmcpXG4gICAgICAgICAgLnNldFNlY3Rpb24oXCJ0aXRsZVwiKVxuICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHRvZ2dsZUZsb2F0aW5nUHJvcGVydHkob3duZXIuZnJlZFZpZXcsIG93bmVyLmZyZWRTdG9yZSwgcm93LmVudHJ5LmtleSkpXG4gICAgICApO1xuICAgICAgcmV0dXJuIG9yaWdpbmFsU2hvd0F0TW91c2VFdmVudC5jYWxsKHRoaXMsIG1vdXNlRXZlbnQpO1xuICAgIH07XG5cbiAgICByZXR1cm4gb3JpZ2luYWxTaG93UHJvcGVydHlNZW51LmNhbGwodGhpcywgZXZlbnQpO1xuICB9O1xufVxuXG5mdW5jdGlvbiB0b2dnbGVGbG9hdGluZ1Byb3BlcnR5KHZpZXcsIHN0b3JlLCBrZXkpIHtcbiAgY29uc3QgZmxvYXRpbmcgPSBzdG9yZS5nZXRGbG9hdGluZygpO1xuICBzdG9yZS5zZXRGbG9hdGluZyhmbG9hdGluZy5pbmNsdWRlcyhrZXkpID8gZmxvYXRpbmcuZmlsdGVyKChrKSA9PiBrICE9PSBrZXkpIDogWy4uLmZsb2F0aW5nLCBrZXldKTtcbiAgdmlldy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gIC8vIEFrdHVhbGlzaWVydCBkaWUgRmV0dC0vS3Vyc2l2LU1hcmtpZXJ1bmcgc29mb3J0IC0gc293b2hsIGluIGRpZXNlclxuICAvLyBEZXRhaWxhbnNpY2h0IGFscyBhdWNoIGluIGJlcmVpdHMgb2ZmZW5lbiBOb3RpemVuIGRpZXNlcyBUeXBzLlxuICB2aWV3LnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbn1cblxuLy8gRGFzIFdpZGdldCBlcndhcnRldCBhbHMgendlaXRlbiBLb25zdHJ1a3Rvci1QYXJhbWV0ZXIgZWluIFwib3duZXJcIi1PYmpla3QgLVxuLy8gZGFzIGlzdCBkaWUgZWluemlnZSBTY2huaXR0c3RlbGxlLCBcdTAwRkNiZXIgZGllIGVzIGFuIGVpbmUgRGF0ZWkgZ2VidW5kZW4gd2lyZC5cbi8vIFN0YXR0IGVpbmVyIGVjaHRlbiBOb3RpeiBoXHUwMEU0bmdlbiB3aXIgZXMgaGllciBhbiBlaW4gUGxhaW4tT2JqZWN0IGluIGRlblxuLy8gUGx1Z2luLVNldHRpbmdzOiBzYXZlRnJvbnRtYXR0ZXIob2JqKSBiZWtvbW10IGJlaSBqZWRlciBcdTAwQzRuZGVydW5nIChQcm9wZXJ0eVxuLy8gaGluenVnZWZcdTAwRkNndC91bWJlbmFubnQvZ2VsXHUwMEY2c2NodCwgV2VydCBnZVx1MDBFNG5kZXJ0LCBSZWloZW5mb2xnZSBnZVx1MDBFNG5kZXJ0KSBkYXNcbi8vIHZvbGxzdFx1MDBFNG5kaWdlLCBha3R1ZWxsZSBQcm9wZXJ0eS1TZXQgXHUwMEZDYmVyZ2ViZW4uIHNoaWZ0Rm9jdXNCZWZvcmUvQWZ0ZXIgc3RldWVyblxuLy8gbnVyLCB3b2hpbiBkZXIgRm9rdXMgYmVpbSBWZXJsYXNzZW4gZGVzIFdpZGdldHMgcGVyIFBmZWlsdGFzdGUvVGFiIHNwcmluZ3QsXG4vLyB1bmQgZFx1MDBGQ3JmZW4gTm8tT3BzIHNlaW4uIGdldEZpbGUoKSB3aXJkIHZvbiBqZWRlciBlaW56ZWxuZW4gUHJvcGVydHktWmVpbGVcbi8vIGJlaW0gUmVuZGVybiBhdWZnZXJ1ZmVuIChmXHUwMEZDciBzb3VyY2VQYXRoLCB6LiBCLiBiZWkgTGluay1XZXJ0ZW4pIC0gb2huZVxuLy8gZWNodGUgRGF0ZWkgZ2lidCBlcyBoaWVyIG5pY2h0cyBTaW5udm9sbGVzIHp1clx1MDBGQ2NrenVnZWJlbiwgYWJlciBkaWUgTWV0aG9kZVxuLy8gbXVzcyBleGlzdGllcmVuLCBzb25zdCBjcmFzaHQgZGFzIFdpZGdldCBiZWltIFJlbmRlcm4gamVkZXIgUHJvcGVydHkuXG4vL1xuLy8gRWluZSBFZGl0b3ItSW5zdGFueiBqZSBCbG9jayAoVFlQIGJ6dy4gU3VidHlwKSwgZ2VidW5kZW4gYW4gZGVuIFNwZWljaGVyb3J0XG4vLyBhdXMgc3RvcmUgKHNpZWhlIHR5cGVTdG9yZS9zdWJ0eXBlU3RvcmUpIC0gU3RhbmRhcmQtIHVuZCBGbG9hdGluZyBQcm9wZXJ0aWVzXG4vLyAoc2llaGUgdHlwZUZsb2F0aW5nS2V5cyBpbiBzZXR0aW5ncy5qcykgdGVpbGVuIHNpY2ggZGllc2VsYmUgTGlzdGUgdW5kXG4vLyBSZWloZW5mb2xnZSwgbnVyIEZsb2F0aW5nLW1hcmtpZXJ0ZSBLZXlzIHdlcmRlbiB2b24gZ2V0VHlwZURlZmF1bHRzKClcbi8vIChtYWluLmpzKSBuaWNodCBhdXRvbWF0aXNjaCBhdXNnZWxpZWZlcnQuIGVkaXRvci5mcmVkUGVuZGluZ0Zsb2F0aW5nQWRkIHdpcmRcbi8vIHZvbiB0eXAtdmlldy5qcyB2b3IgYWRkQmxhbmtQcm9wZXJ0eSgpIGdlc2V0enQsIHVtIGRpZSBhbHMgblx1MDBFNGNoc3Rlc1xuLy8gaGluenVnZWZcdTAwRkNndGUgKGJ6dy4gdW1iZW5hbm50ZSkgUHJvcGVydHkgYWxzIEZsb2F0aW5nIHp1IG1hcmtpZXJlbiAtIHNpZWhlXG4vLyBzYXZlRnJvbnRtYXR0ZXIgdW50ZW4uXG5mdW5jdGlvbiBtb3VudEZyb250bWF0dGVyRWRpdG9yKHZpZXcsIGNvbnRhaW5lckVsLCBzdG9yZSkge1xuICBjb25zdCBhcHAgPSB2aWV3LmFwcDtcbiAgY29uc3QgRWRpdG9yQ2xhc3MgPSBnZXRNZXRhZGF0YUVkaXRvckNsYXNzKGFwcCk7XG4gIGlmICghRWRpdG9yQ2xhc3MpIHtcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLXVuYXZhaWxhYmxlXCIsXG4gICAgICB0ZXh0OiBcIlp1bSBJbml0aWFsaXNpZXJlbiBkZXMgRWRpdG9ycyBiaXR0ZSB6dWVyc3QgZWlubWFsIGVpbmUgTm90aXogXHUwMEY2ZmZuZW4uXCIsXG4gICAgfSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdCBvd25lciA9IHtcbiAgICBhcHAsXG4gICAgLy8gTWFya2VyIGZcdTAwRkNyIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoKCkgb2JlbjogaWRlbnRpZml6aWVydCBQcm9wZXJ0eS1cbiAgICAvLyBaZWlsZW4gZGllc2VzIFBsdWdpbi1laWdlbmVuIEVkaXRvcnMgKG5pZSBlaW5lciBlY2h0ZW4gTm90aXopIHVuZFxuICAgIC8vIGxpZWZlcnQgU3BlaWNoZXJvcnQvVmlldywgZGllIGRlciBnbG9iYWxlIE1lblx1MDBGQy1QYXRjaCBwcm8gWmVpbGVcbiAgICAvLyBkeW5hbWlzY2ggYnJhdWNodCAoZGllIFBhdGNoLUluc3RhbGxhdGlvbiBzZWxic3QgcGFzc2llcnQgbnVyIGVpbm1hbCxcbiAgICAvLyB1bmFiaFx1MDBFNG5naWcgZGF2b24sIHdlbGNoZXIgQmxvY2sgZGFiZWkgZ2VyYWRlIG9mZmVuIHdhcikuXG4gICAgZnJlZFN0b3JlOiBzdG9yZSxcbiAgICBmcmVkVmlldzogdmlldyxcbiAgICBnZXRGaWxlKCkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfSxcbiAgICAvLyBOdXIgZlx1MDBGQ3IgT2JzaWRpYW5zIEhvdmVyLVByZXZpZXcgYmVpIGludGVybmVuIExpbmtzIGlubmVyaGFsYiBlaW5lc1xuICAgIC8vIFByb3BlcnR5LVdlcnRzIChFdmVudCBcImhvdmVyLWxpbmtcIikgLSBiZWxpZWJpZ2VyIFN0cmluZyByZWljaHQuXG4gICAgZ2V0SG92ZXJTb3VyY2UoKSB7XG4gICAgICByZXR1cm4gXCJmcmVkLXR5cC1mcm9udG1hdHRlclwiO1xuICAgIH0sXG4gICAgc2hpZnRGb2N1c0JlZm9yZSgpIHt9LFxuICAgIHNoaWZ0Rm9jdXNBZnRlcigpIHt9LFxuICAgIC8vIE9ic2lkaWFucyBFZGl0b3IgcnVmdCBkaWVzIGdlbmF1IGVpbm1hbCBwcm8gYWJnZXNjaGxvc3NlbmVyIFx1MDBDNG5kZXJ1bmcgYXVmXG4gICAgLy8gKFJlbmFtZSBlcnN0IGJlaW0gQmx1ciBkZXMgS2V5LUlucHV0cywgc2llaGUgaGFuZGxlVXBkYXRlS2V5IGltXG4gICAgLy8gZ2ViYXV0ZW4gYXBwLmpzKSAtIGplZGVyIEF1ZnJ1ZiB0clx1MDBFNGd0IGhpZXIgYWxzbyBtYXhpbWFsIGVpbmVcbiAgICAvLyBoaW56dWdlZlx1MDBGQ2d0ZSB1bmQvb2RlciBlbnRmZXJudGUgKG5pY2h0LWxlZXJlKSBQcm9wZXJ0eSwgbmllIG1laHJlcmVcbiAgICAvLyBnbGVpY2h6ZWl0aWcgYXVcdTAwREZlciBiZWkgZWluZW0gTWVocmZhY2gtTFx1MDBGNnNjaGVuLiBEYXMgbWFjaHQgZGllXG4gICAgLy8gRmxvYXRpbmctTWFya2llcnVuZyB1bnRlbiByb2J1c3QgbmFjaGZcdTAwRkNocmJhciwgb2huZSBad2lzY2hlbnp1c3RcdTAwRTRuZGVcbiAgICAvLyB3XHUwMEU0aHJlbmQgZGVzIFRpcHBlbnMgdmVyZm9sZ2VuIHp1IG1cdTAwRkNzc2VuLlxuICAgIHNhdmVGcm9udG1hdHRlcihmcm9udG1hdHRlcikge1xuICAgICAgLy8gRmFsbHMgaGllciBnZXJhZGUgZWluZSBaZWlsZSBcIlRZUFwiL1wiU1VCVFlQXCIgZWluZ2VnZWJlbiB3dXJkZTogbmljaHQgXHUwMEZDYmVybmVobWVuLlxuICAgICAgLy8gU2llIGJsZWlidCBiaXMgenVtIG5cdTAwRTRjaHN0ZW4gTmV1LU1vdW50ZW4gc2ljaHRiYXIgKGtlaW4gZXJuZXV0ZXJcbiAgICAgIC8vIHN5bmNocm9uaXplKCktQXVmcnVmIGhpZXIsIHNpZWhlIEtvbW1lbnRhciBhbiBzdHJpcFR5cFByb3BlcnR5KS5cbiAgICAgIHN0cmlwVHlwUHJvcGVydHkoZnJvbnRtYXR0ZXIpO1xuXG4gICAgICBjb25zdCBwcmV2aW91cyA9IHN0b3JlLmdldEZyb250bWF0dGVyKCk7XG4gICAgICBjb25zdCBwcmV2aW91c0tleXMgPSBPYmplY3Qua2V5cyhwcmV2aW91cykuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gXCJcIik7XG4gICAgICBjb25zdCBjdXJyZW50S2V5cyA9IE9iamVjdC5rZXlzKGZyb250bWF0dGVyKS5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBcIlwiKTtcbiAgICAgIGNvbnN0IHJlbW92ZWRLZXlzID0gcHJldmlvdXNLZXlzLmZpbHRlcigoa2V5KSA9PiAhY3VycmVudEtleXMuaW5jbHVkZXMoa2V5KSk7XG4gICAgICBjb25zdCBhZGRlZEtleXMgPSBjdXJyZW50S2V5cy5maWx0ZXIoKGtleSkgPT4gIXByZXZpb3VzS2V5cy5pbmNsdWRlcyhrZXkpKTtcblxuICAgICAgbGV0IGZsb2F0aW5nID0gc3RvcmUuZ2V0RmxvYXRpbmcoKTtcbiAgICAgIGlmIChyZW1vdmVkS2V5cy5sZW5ndGggPT09IDEgJiYgYWRkZWRLZXlzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAvLyBVbWJlbmVubnVuZyBlaW5lciBiZXN0ZWhlbmRlbiBQcm9wZXJ0eSAtIEZsb2F0aW5nLU1hcmtpZXJ1bmcgd2FuZGVydCBtaXQgdW0uXG4gICAgICAgIGZsb2F0aW5nID0gZmxvYXRpbmcubWFwKChrZXkpID0+IChrZXkgPT09IHJlbW92ZWRLZXlzWzBdID8gYWRkZWRLZXlzWzBdIDoga2V5KSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAocmVtb3ZlZEtleXMubGVuZ3RoID4gMCkgZmxvYXRpbmcgPSBmbG9hdGluZy5maWx0ZXIoKGtleSkgPT4gIXJlbW92ZWRLZXlzLmluY2x1ZGVzKGtleSkpO1xuICAgICAgICBpZiAoZWRpdG9yLmZyZWRQZW5kaW5nRmxvYXRpbmdBZGQgJiYgYWRkZWRLZXlzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAgIGZsb2F0aW5nID0gWy4uLmZsb2F0aW5nLCBhZGRlZEtleXNbMF1dO1xuICAgICAgICAgIGVkaXRvci5mcmVkUGVuZGluZ0Zsb2F0aW5nQWRkID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIEVyc3QgZGllIFByb3BlcnRpZXMsIGRhbm4gZGllIEZsb2F0aW5nLU1hcmtpZXJ1bmdlbiAtIGRlciBTcGVpY2hlciBkZXNcbiAgICAgIC8vIGdlbWVpbnNhbWVuIEVkaXRvcnMgKHVuaWZpZWQtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKSB2ZXJ0ZWlsdCBsZXR6dGVyZVxuICAgICAgLy8gYW5oYW5kIGRlciBkYWJlaSBlcm1pdHRlbHRlbiBCbG9jay1adW9yZG51bmcuXG4gICAgICBzdG9yZS5zZXRGcm9udG1hdHRlcihmcm9udG1hdHRlcik7XG4gICAgICBzdG9yZS5zZXRGbG9hdGluZyhmbG9hdGluZyk7XG4gICAgICB2aWV3LnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgIC8vIERhbWl0IGRpZSBGZXR0LS9LdXJzaXYtTWFya2llcnVuZyBpbiBiZXJlaXRzIG9mZmVuZW4gTm90aXplbiBkaWVzZXNcbiAgICAgIC8vIFR5cHMgc29mb3J0IG1pdHppZWh0LCB3ZW5uIHNpY2ggaGllciBkaWUgUHJvcGVydHktTGlzdGUgXHUwMEU0bmRlcnQuXG4gICAgICB2aWV3LnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICB9LFxuICB9O1xuXG4gIGNvbnN0IGVkaXRvciA9IG5ldyBFZGl0b3JDbGFzcyhhcHAsIG93bmVyKTtcbiAgZWRpdG9yLmZyZWRQZW5kaW5nRmxvYXRpbmdBZGQgPSBmYWxzZTtcbiAgLy8gR3Jlbnp0IGRpZSBQbGF0emhhbHRlci1Wb3JzY2hsXHUwMEU0Z2UgKHBsYWNlaG9sZGVyLXN1Z2dlc3QuanMpIGF1ZiBkaWVzZW4gRWRpdG9yIGVpbi5cbiAgZWRpdG9yLmNvbnRhaW5lckVsLmFkZENsYXNzKFBMQUNFSE9MREVSX1NVR0dFU1RfRURJVE9SX0NMQVNTKTtcbiAgY29udGFpbmVyRWwuYXBwZW5kQ2hpbGQoZWRpdG9yLmNvbnRhaW5lckVsKTtcbiAgdmlldy5hZGRDaGlsZChlZGl0b3IpO1xuXG4gIGNvbnN0IGRlZmF1bHRzID0gc3RvcmUuZ2V0RnJvbnRtYXR0ZXIoKTtcbiAgY29uc3QgaGFkVHlwID0gT2JqZWN0LmtleXMoZGVmYXVsdHMpLnNvbWUoKGtleSkgPT4gU1lTVEVNX1BST1BFUlRJRVMuaW5jbHVkZXMoa2V5LnRyaW0oKS50b0xvd2VyQ2FzZSgpKSk7XG4gIHN0cmlwVHlwUHJvcGVydHkoZGVmYXVsdHMpO1xuICAvLyBFaW4gYmVpbSBMYWRlbiBub2NoIHZvcmhhbmRlbmVzIFRZUCAoei4gQi4gYXVzIGVpbmVyIFx1MDBFNGx0ZXJlbiBQbHVnaW4tVmVyc2lvbilcbiAgLy8gZGF1ZXJoYWZ0IGVudGZlcm5lbiwgc3RhdHQgZXMgbnVyIGZcdTAwRkNyIGRpZXNlIFNlc3Npb24genUgdmVyc3RlY2tlbi5cbiAgaWYgKGhhZFR5cCkgdmlldy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gIGVkaXRvci5zeW5jaHJvbml6ZShkZWZhdWx0cyk7XG4gIG1hcmtQbGFjZWhvbGRlclJvd3MoZWRpdG9yLmNvbnRhaW5lckVsLCBkZWZhdWx0cyk7XG4gIC8vIEVyc3QgbmFjaCBkZW0gZXJzdGVuIHN5bmNocm9uaXplKCkgdmVyc3VjaHQgKHNpZWhlIGdldFByb3BlcnR5Um93Q2xhc3MpIC1cbiAgLy8gYmVpIGVpbmVtIG5vY2ggZ2FueiBsZWVyZW4gVHlwIGhpZXIgZWluIE5vLU9wLCBob2x0IHNpY2ggYWJlciBzcFx1MDBFNHRlc3RlbnNcbiAgLy8gYmVpbSBuXHUwMEU0Y2hzdGVuIE1vdW50ZW4gZWluZXMgbmljaHQtbGVlcmVuIFR5cHMgKG9kZXIgYXVzIGVpbmVyIG9mZmVuZW5cbiAgLy8gTm90aXopIGRpZSBiZW5cdTAwRjZ0aWd0ZSBLbGFzc2VucmVmZXJlbnogYXV0b21hdGlzY2ggbmFjaC5cbiAgZW5zdXJlUHJvcGVydHlNZW51UGF0Y2goYXBwLCBlZGl0b3IpO1xuICByZXR1cm4gZWRpdG9yO1xufVxuXG4vLyBPYnNpZGlhbnMgZWlnZW5lcyBcIlR5cGUgbWlzbWF0Y2gsIGV4cGVjdGVkIC4uLlwiLVdhcm5zeW1ib2wgKG9yYW5nZXMgRHJlaWVjayxcbi8vIEtsYXNzZSBcIm1ldGFkYXRhLXByb3BlcnR5LXdhcm5pbmctaWNvblwiLCBkaXJla3RlcyBLaW5kIHZvbiBcIi5tZXRhZGF0YS1wcm9wZXJ0eVxuLy8gW2RhdGEtcHJvcGVydHkta2V5XVwiKSB2ZXJnbGVpY2h0IGRlbiBlcndhcnRldGVuIG1pdCBkZW0gYXVzIGRlbSBXZXJ0IGVya2FubnRlblxuLy8gVHlwIC0gYmVpIGVpbmVtIFBsYXR6aGFsdGVyIHdpZSBcInt7dG9kYXl9fVwiIGluIGVpbmVyIGFscyBcImRhdGVcIiBkZWtsYXJpZXJ0ZW5cbi8vIFByb3BlcnR5IChzaWVoZSAub2JzaWRpYW4vdHlwZXMuanNvbikgc2NobFx1MDBFNGd0IGRhcyB6d2FuZ3NsXHUwMEU0dWZpZyBhbiwgb2J3b2hsIGRlclxuLy8gV2VydCBlcnN0IFx1MDBGQ2JlciBnZXRUeXBlRGVmYXVsdHMoKSBhdWZnZWxcdTAwRjZzdCB3aXJkLiBPYnNpZGlhbiBibGVuZGV0IGRhcyBJY29uXG4vLyBcdTAwRkNiZXIgSW5saW5lLXN0eWxlLmRpc3BsYXkgZWluIChrZWluIGhpZGRlbi1BdHRyaWJ1dCkgLSBlaW5lICFpbXBvcnRhbnQtUmVnZWxcbi8vIGluIHN0eWxlcy5jc3MgZ2V3aW5udCB0cm90emRlbSBkYWdlZ2VuLCBkaWUgYmV0cm9mZmVuZSBaZWlsZSBicmF1Y2h0IGRhZlx1MDBGQ3IgbnVyXG4vLyBkaWVzZSBNYXJrZXItS2xhc3NlLlxuZnVuY3Rpb24gbWFya1BsYWNlaG9sZGVyUm93cyhjb250YWluZXJFbCwgZnJvbnRtYXR0ZXIpIHtcbiAgZm9yIChjb25zdCByb3cgb2YgY29udGFpbmVyRWwucXVlcnlTZWxlY3RvckFsbChcIi5tZXRhZGF0YS1wcm9wZXJ0eVwiKSkge1xuICAgIC8vIGRhdGEtcHJvcGVydHkta2V5IGxpZWd0IGJlaSBPYnNpZGlhbiBrbGVpbmdlc2NocmllYmVuIHZvciAoei4gQi4gXCJkYXR1bVwiKSxcbiAgICAvLyB1bnNlcmUgZnJvbnRtYXR0ZXItS2V5cyBhYmVyIHdpZSBlaW5nZXRyYWdlbiAoei4gQi4gXCJEYXR1bVwiKSAtIGRhaGVyIGhpZXJcbiAgICAvLyBjYXNlLWluc2Vuc2l0aXYgZ2VnZW4gZGllIGVjaHRlbiBLZXlzIGFiZ2xlaWNoZW4gc3RhdHQgZGlyZWt0IHp1IGluZGl6aWVyZW4uXG4gICAgY29uc3Qgcm93S2V5ID0gcm93LmdldEF0dHJpYnV0ZShcImRhdGEtcHJvcGVydHkta2V5XCIpO1xuICAgIGNvbnN0IGFjdHVhbEtleSA9IE9iamVjdC5rZXlzKGZyb250bWF0dGVyKS5maW5kKChrKSA9PiBrLnRvTG93ZXJDYXNlKCkgPT09IHJvd0tleT8udG9Mb3dlckNhc2UoKSk7XG4gICAgcm93LnRvZ2dsZUNsYXNzKFwiZnJlZC10eXAtcGxhY2Vob2xkZXItdmFsdWVcIiwgaXNQbGFjZWhvbGRlclRva2VuKGZyb250bWF0dGVyW2FjdHVhbEtleV0pKTtcbiAgfVxufVxuXG4vLyBFaWdlbmUsIGVpbmZhY2hlIFwiUHJvcGVydHkgaGluenVmXHUwMEZDZ2VuXCItRnVua3Rpb24gc3RhdHQgZGVzIGludGVybmVuXG4vLyBlZGl0b3IuYWRkUHJvcGVydHkoKTogZlx1MDBGQ2d0IGVpbmVuIGxlZXJlbiBLZXkgbWl0IFdlcnQgbnVsbCBhbiB1bmQgbFx1MDBFNHNzdCBkYXNcbi8vIFdpZGdldCBkaWUgWmVpbGUgZ2FueiBub3JtYWwgcmVuZGVybiAoZGllc2VsYmUgT3B0aWsgd2llIGluIGVpbmVyIGVjaHRlblxuLy8gTm90aXosIGRhIHN5bmNocm9uaXplKCkgdW52ZXJcdTAwRTRuZGVydCBPYnNpZGlhbnMgZWlnZW5lIFJlbmRlci1QaXBlbGluZVxuLy8gZHVyY2hsXHUwMEU0dWZ0KSAtIGRlciBGb2t1cyBzcHJpbmd0IGFuc2NobGllXHUwMERGZW5kIGlucyBLZXktRmVsZCBkZXIgbmV1ZW4gWmVpbGUuXG5mdW5jdGlvbiBhZGRCbGFua1Byb3BlcnR5KGVkaXRvcikge1xuICBpZiAoIWVkaXRvcikgcmV0dXJuO1xuICBjb25zdCBjdXJyZW50ID0gZWRpdG9yLnNlcmlhbGl6ZSgpO1xuICBpZiAoIWN1cnJlbnQuaGFzT3duUHJvcGVydHkoXCJcIikpIHtcbiAgICBjdXJyZW50W1wiXCJdID0gbnVsbDtcbiAgICBlZGl0b3Iuc3luY2hyb25pemUoY3VycmVudCk7XG4gIH1cbiAgZWRpdG9yLmZvY3VzS2V5KFwiXCIpO1xuICAvLyBEZWNrdCBkZW4gRmFsbCBhYiwgZGFzcyBtb3VudEZyb250bWF0dGVyRWRpdG9yKCkgYmVpIGVpbmVtIHp1IGRpZXNlbVxuICAvLyBaZWl0cHVua3Qgbm9jaCBnYW56IGxlZXJlbiBUeXAgKHVuZCBvaG5lIG9mZmVuZSBOb3Rpeikga2VpbmUgWmVpbGVuLUtsYXNzZVxuICAvLyB6dW0gUGF0Y2hlbiBmaW5kZW4ga29ubnRlIC0gamV0enQgZXhpc3RpZXJ0IG1pdCBkZXIgZ2VyYWRlIGFuZ2VsZWd0ZW5cbiAgLy8gWmVpbGUgZ2FyYW50aWVydCBtaW5kZXN0ZW5zIGVpbmUuXG4gIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoKGVkaXRvci5vd25lci5hcHAsIGVkaXRvcik7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBtb3VudEZyb250bWF0dGVyRWRpdG9yLCBhZGRCbGFua1Byb3BlcnR5LCBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaCwgdHlwZVN0b3JlLCBzdWJ0eXBlU3RvcmUgfTtcbiIsICJjb25zdCB7IG1vdW50RnJvbnRtYXR0ZXJFZGl0b3IsIGVuc3VyZVByb3BlcnR5TWVudVBhdGNoIH0gPSByZXF1aXJlKFwiLi90eXBlLWZyb250bWF0dGVyLWVkaXRvclwiKTtcbmNvbnN0IHsgZ2V0U3VidHlwZU5hbWVzLCBnZXRTdWJ0eXBlLCBlbnN1cmVTdWJ0eXBlLCBnZXRTZWN0aW9uT3JkZXIgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cGVzXCIpO1xuXG4vKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAqIEVpbiBlaW56aWdlciBQcm9wZXJ0eS1FZGl0b3IgZlx1MDBGQ3IgZGFzIFN0YW5kYXJkLUZyb250bWF0dGVyIGVpbmVzIFRZUHMgdW5kXG4gKiBhbGxlIHNlaW5lIFN1YnR5cC1CbFx1MDBGNmNrZSAoVFlQLURldGFpbGFuc2ljaHQsIHNpZWhlIHJlbmRlclR5cGVTZXR0aW5ncyBpblxuICogdHlwLXZpZXcuanMpLlxuICpcbiAqIEplZGVyIEtleSBnZWhcdTAwRjZydCB6dSBnZW5hdSBlaW5lbSBCbG9jayAoU3RhbmRhcmQtRnJvbnRtYXR0ZXIgT0RFUiBlaW5cbiAqIFN1YnR5cCkgLSBpbiBlaW5lbSBnZW1laW5zYW1lbiBPYmpla3QgaXN0IGRhcyBhdXRvbWF0aXNjaCBnZXdcdTAwRTRocmxlaXN0ZXQsXG4gKiB1bmQgT2JzaWRpYW5zIGVpZ2VuZXMgRHJhZyAmIERyb3AgKHNhbXQgQXV0by1TY3JvbGwgdW5kIFRhc3RhdHVyLVxuICogTmF2aWdhdGlvbikgcmVpY2h0IHNvIFx1MDBGQ2JlciBhbGxlIEJsXHUwMEY2Y2tlIGhpbndlZy5cbiAqXG4gKiBEaWUgQmxcdTAwRjZja2Ugc2VsYnN0IHNpbmQgbnVyIE9wdGlrOiBcdTAwRENiZXJzY2hyaWZ0IHVuZCBBYnNjaGx1c3MgamUgQmxvY2sgc2luZFxuICogZWlnZW5lIEVsZW1lbnRlLCBkaWUgbmFjaCBqZWRlbSBzeW5jaHJvbml6ZSgpIHp3aXNjaGVuIE9ic2lkaWFucyBaZWlsZW5cbiAqIGVpbmdlc2V0enQgd2VyZGVuIChzeW5jaHJvbml6ZSgpIHJcdTAwRTR1bXQgZnJlbWRlIEVsZW1lbnRlIHBlclxuICogc2V0Q2hpbGRyZW5JblBsYWNlIGF1cyBkZXIgTGlzdGUpLiBEaWUgS2FydGVuZmxcdTAwRTRjaGUgZGVyIFN1YnR5cC1CbFx1MDBGNmNrZSBsaWVndFxuICogYWxzIGVpZ2VuZSBFYmVuZSBISU5URVIgZGVyIExpc3RlLCB2b24gZGVyIFx1MDBEQ2JlcnNjaHJpZnQgYmlzIHp1bSBBYnNjaGx1c3MgLVxuICogc28gYmxlaWJlbiBkaWUgSG92ZXItL0Zva3VzLUhpbnRlcmdyXHUwMEZDbmRlIGRlciBaZWlsZW4gdW5hbmdldGFzdGV0LlxuICpcbiAqIFNlY3Rpb246IG51bGwgPSBTdGFuZGFyZC1Gcm9udG1hdHRlciwgc29uc3QgZGVyIFN1YnR5cC1OYW1lLlxuICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovXG5cbi8vIFNwZWljaGVyLVNjaG5pdHRzdGVsbGUgd2llIHR5cGVTdG9yZS9zdWJ0eXBlU3RvcmUgKHR5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKSxcbi8vIGFiZXIgXHUwMEZDYmVyIGFsbGUgQmxcdTAwRjZja2UgZWluZXMgVFlQcy4gbGF5b3V0IG9yZG5ldCBqZWRlbSBLZXkgc2VpbmVuIEJsb2NrIHp1O1xuLy8gXCJcIiBzdGVodCBmXHUwMEZDciBlaW5lIGdlcmFkZSBhbmdlbGVndGUsIG5vY2ggdW5iZW5hbm50ZSBaZWlsZSAoc2llaGUgYWRkQmxhbmspLlxuZnVuY3Rpb24gdW5pZmllZFN0b3JlKHBsdWdpbiwgdHlwZSkge1xuICBjb25zdCBsYXlvdXQgPSBuZXcgTWFwKCk7XG4gIGxldCBjdXJyZW50ID0ge307XG5cbiAgY29uc3Qgc2VjdGlvbnMgPSAoKSA9PiBnZXRTZWN0aW9uT3JkZXIocGx1Z2luLnNldHRpbmdzLCB0eXBlKTtcblxuICAvLyBLb21tdCBlaW4gS2V5IChhdXMgXHUwMEU0bHRlcmVuIERhdGVuKSBpbiBtZWhyZXJlbiBCbFx1MDBGNmNrZW4gdm9yLCBnZXdpbm50IGRlclxuICAvLyBlcnN0ZSAtIHNpZWhlIGF1Y2ggZW5mb3JjZVVuaXF1ZUtleXMgaW4gc3VidHlwZXMuanMuIERhcyBPYmpla3QgZW50c3RlaHRcbiAgLy8gaW4gQmxvY2stUmVpaGVuZm9sZ2UsIGRhbWl0IGRpZSBaZWlsZW4gYmxvY2t3ZWlzZSBzdGVoZW4gKGluamVjdFNlY3Rpb25zKS5cbiAgY29uc3QgbG9hZCA9ICgpID0+IHtcbiAgICBsYXlvdXQuY2xlYXIoKTtcbiAgICBjdXJyZW50ID0ge307XG4gICAgY29uc3Qgc2VlbiA9IG5ldyBTZXQoKTtcbiAgICBjb25zdCBhZGQgPSAoZnJvbnRtYXR0ZXIsIHNlY3Rpb24pID0+IHtcbiAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGZyb250bWF0dGVyID8/IHt9KSkge1xuICAgICAgICBpZiAoa2V5ID09PSBcIlwiIHx8IHNlZW4uaGFzKGtleS50b0xvd2VyQ2FzZSgpKSkgY29udGludWU7XG4gICAgICAgIHNlZW4uYWRkKGtleS50b0xvd2VyQ2FzZSgpKTtcbiAgICAgICAgY3VycmVudFtrZXldID0gdmFsdWU7XG4gICAgICAgIGxheW91dC5zZXQoa2V5LCBzZWN0aW9uKTtcbiAgICAgIH1cbiAgICB9O1xuICAgIGZvciAoY29uc3Qgc2VjdGlvbiBvZiBzZWN0aW9ucygpKSB7XG4gICAgICBhZGQoc2VjdGlvbiA9PT0gbnVsbCA/IHBsdWdpbi5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdIDogZ2V0U3VidHlwZShwbHVnaW4uc2V0dGluZ3MsIHR5cGUsIHNlY3Rpb24pPy5mcm9udG1hdHRlciwgc2VjdGlvbik7XG4gICAgfVxuICB9O1xuICBsb2FkKCk7XG5cbiAgY29uc3Qgc2VjdGlvbk9mID0gKGtleSkgPT4gKGxheW91dC5oYXMoa2V5KSA/IGxheW91dC5nZXQoa2V5KSA6IG51bGwpO1xuXG4gIHJldHVybiB7XG4gICAgdHlwZSxcbiAgICBzdWJ0eXBlOiBudWxsLFxuICAgIHVuaWZpZWQ6IHRydWUsXG4gICAgbGF5b3V0LFxuICAgIHNlY3Rpb25zLFxuICAgIHNlY3Rpb25PZixcbiAgICBnZXRGcm9udG1hdHRlcjogKCkgPT4gY3VycmVudCxcblxuICAgIC8vIFZlcnRlaWx0IGRhcyB2b2xsc3RcdTAwRTRuZGlnZSBQcm9wZXJ0eS1TZXQgd2llZGVyIGF1ZiBkaWUgQmxcdTAwRjZja2UuIE5ldWUgS2V5c1xuICAgIC8vIGxhbmRlbiBpbSBCbG9jayBkZXIgenV2b3IgYW5nZWxlZ3RlbiBMZWVyemVpbGUgKGxheW91dCBcIlwiKSwgZWluZVxuICAgIC8vIFVtYmVuZW5udW5nIChnZW5hdSBlaW4gS2V5IHdlZywgZWluZXIgbmV1KSBiZWhcdTAwRTRsdCBkZW4gQmxvY2ssIHNvbnN0XG4gICAgLy8gZW50c2NoZWlkZXQgZGVyIGRhdm9yIHN0ZWhlbmRlIEtleS5cbiAgICBzZXRGcm9udG1hdHRlcihmcm9udG1hdHRlcikge1xuICAgICAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKGZyb250bWF0dGVyKTtcbiAgICAgIGNvbnN0IHJlbW92ZWQgPSBbLi4ubGF5b3V0LmtleXMoKV0uZmlsdGVyKChrZXkpID0+IGtleSAhPT0gXCJcIiAmJiAhT2JqZWN0Lmhhc093bihmcm9udG1hdHRlciwga2V5KSk7XG4gICAgICBjb25zdCBhZGRlZCA9IGtleXMuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gXCJcIiAmJiAhbGF5b3V0LmhhcyhrZXkpKTtcbiAgICAgIGlmIChyZW1vdmVkLmxlbmd0aCA9PT0gMSAmJiBhZGRlZC5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgbGF5b3V0LnNldChhZGRlZFswXSwgbGF5b3V0LmdldChyZW1vdmVkWzBdKSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmb3IgKGNvbnN0IGtleSBvZiBhZGRlZCkge1xuICAgICAgICAgIGlmIChsYXlvdXQuaGFzKFwiXCIpKSB7XG4gICAgICAgICAgICBsYXlvdXQuc2V0KGtleSwgbGF5b3V0LmdldChcIlwiKSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IGJlZm9yZSA9IGtleXMuc2xpY2UoMCwga2V5cy5pbmRleE9mKGtleSkpLnJldmVyc2UoKS5maW5kKChrKSA9PiBsYXlvdXQuaGFzKGspKTtcbiAgICAgICAgICAgIGxheW91dC5zZXQoa2V5LCBiZWZvcmUgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBsYXlvdXQuZ2V0KGJlZm9yZSkpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBrZXkgb2YgcmVtb3ZlZCkgbGF5b3V0LmRlbGV0ZShrZXkpO1xuICAgICAgaWYgKCFPYmplY3QuaGFzT3duKGZyb250bWF0dGVyLCBcIlwiKSkgbGF5b3V0LmRlbGV0ZShcIlwiKTtcblxuICAgICAgY29uc3QgYmxvY2tzID0gbmV3IE1hcChzZWN0aW9ucygpLm1hcCgoc2VjdGlvbikgPT4gW3NlY3Rpb24sIHt9XSkpO1xuICAgICAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykge1xuICAgICAgICBpZiAoa2V5ID09PSBcIlwiKSBjb250aW51ZTtcbiAgICAgICAgKGJsb2Nrcy5nZXQoc2VjdGlvbk9mKGtleSkpID8/IGJsb2Nrcy5nZXQobnVsbCkpW2tleV0gPSBmcm9udG1hdHRlcltrZXldO1xuICAgICAgfVxuICAgICAgcGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV0gPSBibG9ja3MuZ2V0KG51bGwpO1xuICAgICAgZm9yIChjb25zdCBzdWJ0eXBlIG9mIGdldFN1YnR5cGVOYW1lcyhwbHVnaW4uc2V0dGluZ3MsIHR5cGUpKSB7XG4gICAgICAgIGVuc3VyZVN1YnR5cGUocGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKS5mcm9udG1hdHRlciA9IGJsb2Nrcy5nZXQoc3VidHlwZSk7XG4gICAgICB9XG4gICAgICBjdXJyZW50ID0gZnJvbnRtYXR0ZXI7XG4gICAgfSxcblxuICAgIGdldEZsb2F0aW5nKCkge1xuICAgICAgcmV0dXJuIFtcbiAgICAgICAgLi4uKHBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdID8/IFtdKSxcbiAgICAgICAgLi4uZ2V0U3VidHlwZU5hbWVzKHBsdWdpbi5zZXR0aW5ncywgdHlwZSkuZmxhdE1hcCgoc3VidHlwZSkgPT4gZ2V0U3VidHlwZShwbHVnaW4uc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpPy5mbG9hdGluZ0tleXMgPz8gW10pLFxuICAgICAgXTtcbiAgICB9LFxuXG4gICAgc2V0RmxvYXRpbmcoa2V5cykge1xuICAgICAgY29uc3QgYnlTZWN0aW9uID0gbmV3IE1hcChzZWN0aW9ucygpLm1hcCgoc2VjdGlvbikgPT4gW3NlY3Rpb24sIFtdXSkpO1xuICAgICAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykgKGJ5U2VjdGlvbi5nZXQoc2VjdGlvbk9mKGtleSkpID8/IGJ5U2VjdGlvbi5nZXQobnVsbCkpLnB1c2goa2V5KTtcbiAgICAgIGNvbnN0IHR5cGVLZXlzID0gYnlTZWN0aW9uLmdldChudWxsKTtcbiAgICAgIGlmICh0eXBlS2V5cy5sZW5ndGggPiAwKSBwbHVnaW4uc2V0dGluZ3MudHlwZUZsb2F0aW5nS2V5c1t0eXBlXSA9IHR5cGVLZXlzO1xuICAgICAgZWxzZSBkZWxldGUgcGx1Z2luLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV07XG4gICAgICBmb3IgKGNvbnN0IHN1YnR5cGUgb2YgZ2V0U3VidHlwZU5hbWVzKHBsdWdpbi5zZXR0aW5ncywgdHlwZSkpIHtcbiAgICAgICAgZW5zdXJlU3VidHlwZShwbHVnaW4uc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpLmZsb2F0aW5nS2V5cyA9IGJ5U2VjdGlvbi5nZXQoc3VidHlwZSk7XG4gICAgICB9XG4gICAgfSxcbiAgfTtcbn1cblxuLy8gcmVuZGVySGVhZGVyKHNlY3Rpb24sIGVsLCBlZGl0b3IpIC8gcmVuZGVyRm9vdGVyKHNlY3Rpb24sIGVsLCBlZGl0b3IpXG4vLyBmXHUwMEZDbGxlbiBcdTAwRENiZXJzY2hyaWZ0IGJ6dy4gQWJzY2hsdXNzIGVpbmVzIEJsb2Nrcy4gb25Nb3ZlU2VjdGlvbihvcmRlcikgbWVsZGV0XG4vLyBkaWUgbmV1ZSBCbG9jay1SZWloZW5mb2xnZSBuYWNoIGVpbmVtIEJsb2NrLURyYWcgKHdpZSBnZXRTZWN0aW9uT3JkZXIsIHNhbXRcbi8vIG51bGwgZlx1MDBGQ3IgZGFzIFN0YW5kYXJkLUZyb250bWF0dGVyKSwgb25TZWN0aW9uQ29udGV4dE1lbnUoc2VjdGlvbiwgZXZlbnQpXG4vLyBlaW5lbiBSZWNodHNrbGljayBpbiBlaW5lbSBTdWJ0eXAtQmxvY2suXG5mdW5jdGlvbiBtb3VudFVuaWZpZWRGcm9udG1hdHRlckVkaXRvcih2aWV3LCBjb250YWluZXJFbCwgdHlwZSwgeyByZW5kZXJIZWFkZXIsIHJlbmRlckZvb3Rlciwgb25Nb3ZlU2VjdGlvbiwgb25TZWN0aW9uQ29udGV4dE1lbnUgfSkge1xuICBjb25zdCBzdG9yZSA9IHVuaWZpZWRTdG9yZSh2aWV3LnBsdWdpbiwgdHlwZSk7XG4gIGNvbnN0IHdyYXBwZXIgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtdW5pZmllZFwiIH0pO1xuICBjb25zdCBjYXJkTGF5ZXIgPSB3cmFwcGVyLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC11bmlmaWVkLWNhcmRzXCIgfSk7XG5cbiAgLy8gVm9yIGRlbSBNb3VudGVuOiBtb3VudEZyb250bWF0dGVyRWRpdG9yKCkgcnVmdCBzeW5jaHJvbml6ZSgpIHNjaG9uIHNlbGJzdFxuICAvLyBhdWYgLSBkZXIgUHJvdG90eXAgd2lyZCBkZXNoYWxiIGVyc3QgZGFuYWNoIGplIEluc3RhbnogdW1oXHUwMEZDbGx0LCB1bmQgZGFzXG4gIC8vIGVyc3RlIEVpbnNldHplbiBkZXIgQmxcdTAwRjZja2UgdW50ZW4gZXhwbGl6aXQgbmFjaGdlaG9sdC5cbiAgY29uc3QgZWRpdG9yID0gbW91bnRGcm9udG1hdHRlckVkaXRvcih2aWV3LCB3cmFwcGVyLCBzdG9yZSk7XG4gIGlmICghZWRpdG9yKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgbGlzdEVsID0gZWRpdG9yLnByb3BlcnR5TGlzdEVsO1xuXG4gIC8vIEFsbGUgQmxcdTAwRjZja2UgaW4gQW56ZWlnZXJlaWhlbmZvbGdlLCBqZSB7IHNlY3Rpb24sIHRvcCwgYm90dG9tLCBlbCB9IHJlbGF0aXZcbiAgLy8genVtIHdyYXBwZXIgLSBlbCBpc3QgZGllIEthcnRlbmZsXHUwMEU0Y2hlIChudXIgU3VidHlwLUJsXHUwMEY2Y2tlLCBkYXMgU3RhbmRhcmQtXG4gIC8vIEZyb250bWF0dGVyIGJsZWlidCB0cmFuc3BhcmVudCkuIFp1Z2xlaWNoIEdydW5kbGFnZSBmXHUwMEZDciBIb3ZlciwgUmVjaHRza2xpY2tcbiAgLy8gdW5kIEJsb2NrLURyYWcgKHNpZWhlIHVudGVuKS5cbiAgbGV0IGJsb2NrcyA9IFtdO1xuICBsZXQgaG92ZXJlZFNlY3Rpb247XG4gIGxldCBkcmFnU2VjdGlvbjtcblxuICBjb25zdCBsYXlvdXRDYXJkcyA9ICgpID0+IHtcbiAgICBjYXJkTGF5ZXIuZW1wdHkoKTtcbiAgICBibG9ja3MgPSBbXTtcbiAgICBjb25zdCBiYXNlID0gd3JhcHBlci5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICBmb3IgKGNvbnN0IGhlYWRlciBvZiBsaXN0RWwucXVlcnlTZWxlY3RvckFsbChcIjpzY29wZSA+IC5mcmVkLXR5cC1zZWN0aW9uLWhlYWRlclwiKSkge1xuICAgICAgY29uc3QgZm9vdGVyID0gaGVhZGVyLmZyZWRGb290ZXI7XG4gICAgICBpZiAoIWZvb3Rlcj8uaXNDb25uZWN0ZWQpIGNvbnRpbnVlO1xuICAgICAgY29uc3Qgc2VjdGlvbiA9IGhlYWRlci5mcmVkU2VjdGlvbjtcbiAgICAgIGNvbnN0IHRvcCA9IGhlYWRlci5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKS50b3AgLSBiYXNlLnRvcDtcbiAgICAgIGNvbnN0IGJvdHRvbSA9IGZvb3Rlci5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKS5ib3R0b20gLSBiYXNlLnRvcDtcbiAgICAgIGxldCBlbCA9IG51bGw7XG4gICAgICBpZiAoc2VjdGlvbiAhPT0gbnVsbCkge1xuICAgICAgICBlbCA9IGNhcmRMYXllci5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtdW5pZmllZC1jYXJkXCIgfSk7XG4gICAgICAgIGVsLnN0eWxlLnRvcCA9IGAke3RvcH1weGA7XG4gICAgICAgIGVsLnN0eWxlLmhlaWdodCA9IGAke2JvdHRvbSAtIHRvcH1weGA7XG4gICAgICAgIGVsLnRvZ2dsZUNsYXNzKFwiaXMtaG92ZXJlZFwiLCBzZWN0aW9uID09PSBob3ZlcmVkU2VjdGlvbiAmJiBkcmFnU2VjdGlvbiA9PT0gdW5kZWZpbmVkKTtcbiAgICAgICAgZWwudG9nZ2xlQ2xhc3MoXCJpcy1kcmFnZ2luZ1wiLCBzZWN0aW9uID09PSBkcmFnU2VjdGlvbik7XG4gICAgICB9XG4gICAgICBibG9ja3MucHVzaCh7IHNlY3Rpb24sIHRvcCwgYm90dG9tLCBlbCB9KTtcbiAgICB9XG4gIH07XG5cbiAgLy8gU2V0enQgXHUwMERDYmVyc2NocmlmdCB1bmQgQWJzY2hsdXNzIGplIEJsb2NrIHp3aXNjaGVuIE9ic2lkaWFucyBaZWlsZW4sIE9ITkVcbiAgLy8gZGllIFplaWxlbiBzZWxic3QgdW16dWhcdTAwRTRuZ2VuOiBlaW5lIHZlcnNjaG9iZW5lIFplaWxlIG1pdCBGb2t1cyB2ZXJsXHUwMEY2cmVcbiAgLy8gaWhuIGt1cnosIHVuZCBPYnNpZGlhbnMgQmx1ci1IYW5kbGVyICh6LiBCLiBFbnRmZXJuZW4gZWluZXIgbGVlcmVuIFplaWxlKVxuICAvLyBcdTAwRTRuZGVydGUgZGllIExpc3RlIG1pdHRlbiBpbSBFaW5mXHUwMEZDZ2VuLiBWb3JhdXNzZXR6dW5nIGlzdCwgZGFzcyBkaWUgWmVpbGVuXG4gIC8vIGJsb2Nrd2Vpc2UgaW4gQmxvY2stUmVpaGVuZm9sZ2Ugc3RlaGVuIC0gZGFmXHUwMEZDciBzb3JnZW4gZGllIE9iamVrdGUsIGRpZVxuICAvLyBoaWVyIGFua29tbWVuIChzaWVoZSB1bmlmaWVkU3RvcmUsIHJlb3JkZXJLZXksIGZyZWRBZGRCbGFuaykuIE51ciBmYWxsc1xuICAvLyBkYXMgZG9jaCBlaW5tYWwgbmljaHQgenV0cmlmZnQsIHdpcmQgZGllIExpc3RlIGtvbXBsZXR0IG5ldSBnZW9yZG5ldC5cbiAgbGV0IGluamVjdGVkID0gW107XG4gIGxldCBpbmplY3RpbmcgPSBmYWxzZTtcbiAgY29uc3QgaW5qZWN0U2VjdGlvbnMgPSAoKSA9PiB7XG4gICAgLy8gV2lyZCBkaWUgQW5zaWNodCBnZXJhZGUgYWJnZWJhdXQsIGxcdTAwRjZzdCBkZXIgQmx1ciBlaW5lciBaZWlsZSBub2NoIGVpblxuICAgIC8vIHN5bmNocm9uaXplKCkgYXVzIC0gZGFubiBnaWJ0IGVzIG5pY2h0cyBtZWhyIGVpbnp1c2V0emVuLlxuICAgIGlmIChpbmplY3RpbmcgfHwgIWxpc3RFbC5pc0Nvbm5lY3RlZCkgcmV0dXJuO1xuICAgIGluamVjdGluZyA9IHRydWU7XG4gICAgdHJ5IHtcbiAgICAgIGZvciAoY29uc3QgZWwgb2YgaW5qZWN0ZWQpIGVsLmRldGFjaCgpO1xuICAgICAgaW5qZWN0ZWQgPSBbXTtcblxuICAgICAgY29uc3Qgc2VjdGlvbnMgPSBzdG9yZS5zZWN0aW9ucygpO1xuICAgICAgY29uc3Qgcm93cyA9IFsuLi5saXN0RWwuY2hpbGRyZW5dO1xuICAgICAgY29uc3Qgcm93c0J5U2VjdGlvbiA9IG5ldyBNYXAoc2VjdGlvbnMubWFwKChzZWN0aW9uKSA9PiBbc2VjdGlvbiwgW11dKSk7XG4gICAgICBmb3IgKGNvbnN0IHJvd0VsIG9mIHJvd3MpIHtcbiAgICAgICAgY29uc3Qgcm93ID0gZWRpdG9yLnJlbmRlcmVkLmZpbmQoKHIpID0+IHIuY29udGFpbmVyRWwgPT09IHJvd0VsKTtcbiAgICAgICAgY29uc3Qgc2VjdGlvbiA9IHN0b3JlLnNlY3Rpb25PZihyb3c/LmVudHJ5LmtleSk7XG4gICAgICAgIChyb3dzQnlTZWN0aW9uLmdldChzZWN0aW9uKSA/PyByb3dzQnlTZWN0aW9uLmdldChudWxsKSkucHVzaChyb3dFbCk7XG4gICAgICB9XG4gICAgICBjb25zdCBvcmRlcmVkID0gWy4uLnJvd3NCeVNlY3Rpb24udmFsdWVzKCldLmZsYXQoKTtcbiAgICAgIGNvbnN0IGluT3JkZXIgPSBvcmRlcmVkLmV2ZXJ5KChyb3dFbCwgaSkgPT4gcm93RWwgPT09IHJvd3NbaV0pO1xuXG4gICAgICBsZXQgYW5jaG9yID0gbGlzdEVsLmZpcnN0Q2hpbGQ7XG4gICAgICBmb3IgKGNvbnN0IFtzZWN0aW9uLCBzZWN0aW9uUm93c10gb2Ygcm93c0J5U2VjdGlvbikge1xuICAgICAgICBjb25zdCBzdWIgPSBzZWN0aW9uICE9PSBudWxsO1xuICAgICAgICBjb25zdCBoZWFkZXIgPSBjcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItaGVhZGVyIGZyZWQtdHlwLXNlY3Rpb24taGVhZGVyXCIgfSk7XG4gICAgICAgIGNvbnN0IGZvb3RlciA9IGNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1zZWN0aW9uLWZvb3RlclwiIH0pO1xuICAgICAgICBoZWFkZXIudG9nZ2xlQ2xhc3MoXCJmcmVkLXR5cC1zZWN0aW9uLXN1YlwiLCBzdWIpO1xuICAgICAgICBmb290ZXIudG9nZ2xlQ2xhc3MoXCJmcmVkLXR5cC1zZWN0aW9uLXN1YlwiLCBzdWIpO1xuICAgICAgICBoZWFkZXIuZnJlZFNlY3Rpb24gPSBzZWN0aW9uO1xuICAgICAgICBoZWFkZXIuZnJlZEZvb3RlciA9IGZvb3RlcjtcbiAgICAgICAgcmVuZGVySGVhZGVyKHNlY3Rpb24sIGhlYWRlciwgZWRpdG9yKTtcbiAgICAgICAgcmVuZGVyRm9vdGVyPy4oc2VjdGlvbiwgZm9vdGVyLCBlZGl0b3IpO1xuICAgICAgICBpbmplY3RlZC5wdXNoKGhlYWRlciwgZm9vdGVyKTtcbiAgICAgICAgZm9yIChjb25zdCByb3dFbCBvZiBzZWN0aW9uUm93cykgcm93RWwudG9nZ2xlQ2xhc3MoXCJmcmVkLXR5cC1zZWN0aW9uLXN1YlwiLCBzdWIpO1xuXG4gICAgICAgIGlmICghaW5PcmRlcikgY29udGludWU7XG4gICAgICAgIGxpc3RFbC5pbnNlcnRCZWZvcmUoaGVhZGVyLCBhbmNob3IpO1xuICAgICAgICBpZiAoc2VjdGlvblJvd3MubGVuZ3RoID4gMCkgYW5jaG9yID0gc2VjdGlvblJvd3Nbc2VjdGlvblJvd3MubGVuZ3RoIC0gMV0ubmV4dFNpYmxpbmc7XG4gICAgICAgIGxpc3RFbC5pbnNlcnRCZWZvcmUoZm9vdGVyLCBhbmNob3IpO1xuICAgICAgfVxuXG4gICAgICBpZiAoIWluT3JkZXIpIHtcbiAgICAgICAgY29uc3QgY2hpbGRyZW4gPSBbXTtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBpbmplY3RlZC5sZW5ndGg7IGkgKz0gMikge1xuICAgICAgICAgIGNvbnN0IGhlYWRlciA9IGluamVjdGVkW2ldO1xuICAgICAgICAgIGNoaWxkcmVuLnB1c2goaGVhZGVyLCAuLi5yb3dzQnlTZWN0aW9uLmdldChoZWFkZXIuZnJlZFNlY3Rpb24pLCBpbmplY3RlZFtpICsgMV0pO1xuICAgICAgICB9XG4gICAgICAgIGxpc3RFbC5zZXRDaGlsZHJlbkluUGxhY2UoY2hpbGRyZW4pO1xuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBpbmplY3RpbmcgPSBmYWxzZTtcbiAgICB9XG4gICAgbGF5b3V0Q2FyZHMoKTtcbiAgfTtcblxuICBjb25zdCBvcmlnaW5hbFN5bmNocm9uaXplID0gZWRpdG9yLnN5bmNocm9uaXplO1xuICBlZGl0b3Iuc3luY2hyb25pemUgPSBmdW5jdGlvbiAoZnJvbnRtYXR0ZXIpIHtcbiAgICBvcmlnaW5hbFN5bmNocm9uaXplLmNhbGwodGhpcywgZnJvbnRtYXR0ZXIpO1xuICAgIGluamVjdFNlY3Rpb25zKCk7XG4gIH07XG5cbiAgLy8gT2JzaWRpYW4gbWVsZGV0IG5hY2ggZWluZW0gRHJhZyBkaWUgWmllbC1Qb3NpdGlvbiBhbHMgSW5kZXggdW50ZXIgQUxMRU5cbiAgLy8gS2luZGVybiBkZXIgTGlzdGUgKFx1MDBEQ2JlcnNjaHJpZnRlbi9BYnNjaGxcdTAwRkNzc2Ugelx1MDBFNGhsZW4gbWl0KSB1bmQgaGF0IGRpZSBaZWlsZVxuICAvLyB6dSBkaWVzZW0gWmVpdHB1bmt0IGJlcmVpdHMgaW0gRE9NIHZlcnNjaG9iZW4uIFJlaWhlbmZvbGdlIHVuZCBCbG9jay1cbiAgLy8gWnVvcmRudW5nIHdlcmRlbiBkZXNoYWxiIGRpcmVrdCBhdXMgZGVtIERPTSBhYmdlbGVzZW46IGplZGUgWmVpbGUgZ2VoXHUwMEY2cnRcbiAgLy8genVtIEJsb2NrIGRlciBsZXR6dGVuIFx1MDBEQ2JlcnNjaHJpZnQgZGF2b3IuXG4gIGVkaXRvci5yZW9yZGVyS2V5ID0gZnVuY3Rpb24gKCkge1xuICAgIGNvbnN0IHNlcmlhbGl6ZWQgPSB0aGlzLnNlcmlhbGl6ZSgpO1xuICAgIGNvbnN0IGZyb250bWF0dGVyID0ge307XG4gICAgbGV0IHNlY3Rpb24gPSBudWxsO1xuICAgIGZvciAoY29uc3QgZWwgb2YgbGlzdEVsLmNoaWxkcmVuKSB7XG4gICAgICBpZiAoZWwuaGFzQ2xhc3MoXCJmcmVkLXR5cC1zZWN0aW9uLWhlYWRlclwiKSkge1xuICAgICAgICBzZWN0aW9uID0gZWwuZnJlZFNlY3Rpb247XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3Qgcm93ID0gdGhpcy5yZW5kZXJlZC5maW5kKChyKSA9PiByLmNvbnRhaW5lckVsID09PSBlbCk7XG4gICAgICBpZiAoIXJvdykgY29udGludWU7XG4gICAgICBmcm9udG1hdHRlcltyb3cuZW50cnkua2V5XSA9IHNlcmlhbGl6ZWRbcm93LmVudHJ5LmtleV07XG4gICAgICBzdG9yZS5sYXlvdXQuc2V0KHJvdy5lbnRyeS5rZXksIHNlY3Rpb24pO1xuICAgIH1cbiAgICB0aGlzLm93bmVyLnNhdmVGcm9udG1hdHRlcihmcm9udG1hdHRlcik7XG4gIH07XG5cbiAgLy8gTGVlcnplaWxlIGFtIEVuZGUgZGVzIGdld1x1MDBGQ25zY2h0ZW4gQmxvY2tzIGFubGVnZW4gKHN0YXR0IGFtIEVuZGUgZGVyIExpc3RlXG4gIC8vIHdpZSBhZGRCbGFua1Byb3BlcnR5KSAtIGlociBLZXkgXCJcIiBtZXJrdCBzaWNoIGRlbiBCbG9jaywgYmlzIHNpZSBiZW5hbm50XG4gIC8vIGlzdC4gRGFzIE9iamVrdCB3aXJkIGRhYmVpIGJsb2Nrd2Vpc2UgYXVmZ2ViYXV0LCBkYW1pdCBkaWUgWmVpbGVuIGluXG4gIC8vIEJsb2NrLVJlaWhlbmZvbGdlIHN0ZWhlbiAoc2llaGUgaW5qZWN0U2VjdGlvbnMpLlxuICBlZGl0b3IuZnJlZEFkZEJsYW5rID0gZnVuY3Rpb24gKHNlY3Rpb24sIGZsb2F0aW5nID0gZmFsc2UpIHtcbiAgICB0aGlzLmZyZWRQZW5kaW5nRmxvYXRpbmdBZGQgPSBmbG9hdGluZztcbiAgICBzdG9yZS5sYXlvdXQuc2V0KFwiXCIsIHNlY3Rpb24pO1xuICAgIGNvbnN0IGN1cnJlbnQgPSB0aGlzLnNlcmlhbGl6ZSgpO1xuICAgIGNvbnN0IG5leHQgPSB7fTtcbiAgICBmb3IgKGNvbnN0IHMgb2Ygc3RvcmUuc2VjdGlvbnMoKSkge1xuICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoY3VycmVudCkpIHtcbiAgICAgICAgaWYgKGtleSAhPT0gXCJcIiAmJiBzdG9yZS5zZWN0aW9uT2Yoa2V5KSA9PT0gcykgbmV4dFtrZXldID0gdmFsdWU7XG4gICAgICB9XG4gICAgICBpZiAocyA9PT0gc2VjdGlvbikgbmV4dFtcIlwiXSA9IG51bGw7XG4gICAgfVxuICAgIHRoaXMuc3luY2hyb25pemUobmV4dCk7XG4gICAgdGhpcy5mb2N1c0tleShcIlwiKTtcbiAgICBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaCh2aWV3LmFwcCwgdGhpcyk7XG4gIH07XG5cbiAgLy8gLS0tIEhvdmVyLCBSZWNodHNrbGljayB1bmQgVmVyc2NoaWViZW4gZ2FuemVyIFN1YnR5cC1CbFx1MDBGNmNrZSAtLS0tLS0tLS0tLS0tLVxuICAvLyBBbGxlcyBcdTAwRkNiZXIgZGllIEJsb2NrZmxcdTAwRTRjaGVuIChzaWVoZSBsYXlvdXRDYXJkcyksIGRhIGVpbiBCbG9jayBrZWluIGVpZ2VuZXNcbiAgLy8gRWxlbWVudCBpc3QuIEhvdmVyIHVuZCBSZWNodHNrbGljayAoU3VjaGUgbmFjaCBkZW4gTm90aXplbiBkZXMgU3VidHlwcylcbiAgLy8gZ2VsdGVuIGltIGdhbnplbiBTdWJ0eXAtQmxvY2suIEFuZ2VmYXNzdCB3aXJkIGVpbiBCbG9jayBcdTAwRkNiZXJhbGwgYXVcdTAwREZlcmhhbGJcbiAgLy8gc2VpbmVyIFByb3BlcnR5LVplaWxlbjogXHUwMERDYmVyc2NocmlmdCwgQWJzY2hsdXNzIHVuZCBkaWUgc2VpdGxpY2hlbiBSXHUwMEU0bmRlclxuICAvLyAoZG9ydCBpc3QgZGllIExpc3RlIHNlbGJzdCBkYXMgWmllbCk7IEJ1dHRvbnMgdW5kIGVpbiBnZXJhZGUgYmVhcmJlaXRldGVyXG4gIC8vIFRpdGVsIGJsZWliZW4gYXVzZ2Vub21tZW4uIERhcyBTdGFuZGFyZC1Gcm9udG1hdHRlciBzZWxic3QgaXN0IG5pY2h0XG4gIC8vIHZlcnNjaGllYmJhciwgU3VidHlwZW4gZFx1MDBGQ3JmZW4gYWJlciBhdWNoIGRhclx1MDBGQ2JlciBsaWVnZW4uXG4gIGNvbnN0IGJsb2NrQXQgPSAoZXZlbnQpID0+IHtcbiAgICBjb25zdCB5ID0gZXZlbnQuY2xpZW50WSAtIHdyYXBwZXIuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCkudG9wO1xuICAgIHJldHVybiBibG9ja3MuZmluZCgoYmxvY2spID0+IHkgPj0gYmxvY2sudG9wICYmIHkgPD0gYmxvY2suYm90dG9tKSA/PyBudWxsO1xuICB9O1xuICBjb25zdCBzdWJ0eXBlQmxvY2tBdCA9IChldmVudCkgPT4ge1xuICAgIGNvbnN0IGJsb2NrID0gYmxvY2tBdChldmVudCk7XG4gICAgcmV0dXJuIGJsb2NrPy5zZWN0aW9uICE9IG51bGwgPyBibG9jayA6IG51bGw7XG4gIH07XG5cbiAgY29uc3QgaXNHcmFiVGFyZ2V0ID0gKHRhcmdldCkgPT4ge1xuICAgIGlmICh0YXJnZXQuY2xvc2VzdChcIi5jbGlja2FibGUtaWNvbiwgW2NvbnRlbnRlZGl0YWJsZT0ndHJ1ZSddLCBpbnB1dCwgdGV4dGFyZWFcIikpIHJldHVybiBmYWxzZTtcbiAgICBpZiAodGFyZ2V0ID09PSBsaXN0RWwpIHJldHVybiB0cnVlO1xuICAgIHJldHVybiAhIXRhcmdldC5jbG9zZXN0KFwiLmZyZWQtdHlwLXNlY3Rpb24taGVhZGVyLmZyZWQtdHlwLXNlY3Rpb24tc3ViLCAuZnJlZC10eXAtc2VjdGlvbi1mb290ZXIuZnJlZC10eXAtc2VjdGlvbi1zdWJcIik7XG4gIH07XG5cbiAgY29uc3Qgc2V0SG92ZXJlZCA9IChzZWN0aW9uKSA9PiB7XG4gICAgaWYgKHNlY3Rpb24gPT09IGhvdmVyZWRTZWN0aW9uKSByZXR1cm47XG4gICAgaG92ZXJlZFNlY3Rpb24gPSBzZWN0aW9uO1xuICAgIGZvciAoY29uc3QgYmxvY2sgb2YgYmxvY2tzKSBibG9jay5lbD8udG9nZ2xlQ2xhc3MoXCJpcy1ob3ZlcmVkXCIsIGJsb2NrLnNlY3Rpb24gPT09IHNlY3Rpb24gJiYgZHJhZ1NlY3Rpb24gPT09IHVuZGVmaW5lZCk7XG4gIH07XG5cbiAgLy8gXHUwMERDYmVyc2NocmlmdCwgWmVpbGVuIHVuZCBBYnNjaGx1c3MgZWluZXMgQmxvY2tzIChmXHUwMEZDciBkaWUgYWJnZWJsZW5kZXRlXG4gIC8vIERhcnN0ZWxsdW5nIGRlcyBnZXJhZGUgZ2V6b2dlbmVuIEJsb2NrcykuXG4gIGNvbnN0IG1hcmtTZWN0aW9uID0gKHNlY3Rpb24pID0+IHtcbiAgICBsZXQgY3VycmVudCA9IG51bGw7XG4gICAgZm9yIChjb25zdCBlbCBvZiBsaXN0RWwuY2hpbGRyZW4pIHtcbiAgICAgIGlmIChlbC5oYXNDbGFzcyhcImZyZWQtdHlwLXNlY3Rpb24taGVhZGVyXCIpKSBjdXJyZW50ID0gZWwuZnJlZFNlY3Rpb247XG4gICAgICBlbC50b2dnbGVDbGFzcyhcImZyZWQtdHlwLWJsb2NrLWRyYWctc291cmNlXCIsIHNlY3Rpb24gIT09IHVuZGVmaW5lZCAmJiBjdXJyZW50ID09PSBzZWN0aW9uKTtcbiAgICB9XG4gIH07XG5cbiAgd3JhcHBlci5hZGRFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIChldmVudCkgPT4ge1xuICAgIGlmIChkcmFnU2VjdGlvbiA9PT0gdW5kZWZpbmVkKSBzZXRIb3ZlcmVkKHN1YnR5cGVCbG9ja0F0KGV2ZW50KT8uc2VjdGlvbik7XG4gIH0pO1xuICB3cmFwcGVyLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZWxlYXZlXCIsICgpID0+IHNldEhvdmVyZWQodW5kZWZpbmVkKSk7XG5cbiAgLy8gT2JzaWRpYW5zIGVpZ2VuZSBNZW5cdTAwRkNzICh6LiBCLiBkYXMgZWluZXIgUHJvcGVydHkpIHVuZCBUZXh0ZmVsZGVyIGhhYmVuXG4gIC8vIFZvcnJhbmcgLSBzaWUgcmVhZ2llcmVuIHZvcmhlciB1bmQgc2V0emVuIGRlZmF1bHRQcmV2ZW50ZWQuXG4gIHdyYXBwZXIuYWRkRXZlbnRMaXN0ZW5lcihcImNvbnRleHRtZW51XCIsIChldmVudCkgPT4ge1xuICAgIGlmIChldmVudC5kZWZhdWx0UHJldmVudGVkIHx8IGV2ZW50LnRhcmdldC5jbG9zZXN0KFwiaW5wdXQsIHRleHRhcmVhLCBbY29udGVudGVkaXRhYmxlPSd0cnVlJ11cIikpIHJldHVybjtcbiAgICBjb25zdCBibG9jayA9IHN1YnR5cGVCbG9ja0F0KGV2ZW50KTtcbiAgICBpZiAoIWJsb2NrKSByZXR1cm47XG4gICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICBvblNlY3Rpb25Db250ZXh0TWVudT8uKGJsb2NrLnNlY3Rpb24sIGV2ZW50KTtcbiAgfSk7XG5cbiAgLy8gRWlnZW5lcyBNYXVzLURyYWcgc3RhdHQgSFRNTDUtZHJhZ2dhYmxlOiBlaW4gZHJhZ2dhYmxlLVZvcmZhaHJlIHN0XHUwMEY2cnRlIGRpZVxuICAvLyBUZXh0YXVzd2FobCBpbiBkZW4gRWluZ2FiZWZlbGRlcm4gZGVyIFplaWxlbi4gRGVyIERyYWcgYmVnaW5udCBlcnN0IG5hY2hcbiAgLy8gZWluIHBhYXIgUGl4ZWxuIEJld2VndW5nLCBlaW4gU3RyaWNoIGluIEFremVudGZhcmJlIHplaWd0IGRpZSBaaWVscG9zaXRpb25cbiAgLy8gendpc2NoZW4gZGVuIEJsXHUwMEY2Y2tlbiwgRXNjYXBlIGJyaWNodCBhYi5cbiAgd3JhcHBlci5hZGRFdmVudExpc3RlbmVyKFwibW91c2Vkb3duXCIsIChldmVudCkgPT4ge1xuICAgIGlmIChldmVudC5idXR0b24gIT09IDAgfHwgIWlzR3JhYlRhcmdldChldmVudC50YXJnZXQpKSByZXR1cm47XG4gICAgY29uc3Qgc3RhcnRCbG9jayA9IHN1YnR5cGVCbG9ja0F0KGV2ZW50KTtcbiAgICBpZiAoIXN0YXJ0QmxvY2spIHJldHVybjtcbiAgICBjb25zdCB3aW4gPSB3cmFwcGVyLndpbjtcbiAgICBjb25zdCBzdGFydFkgPSBldmVudC5jbGllbnRZO1xuICAgIGxldCBpbmRpY2F0b3IgPSBudWxsO1xuICAgIGxldCB0YXJnZXRJbmRleCA9IG51bGw7XG5cbiAgICBjb25zdCBvbk1vdmUgPSAobW92ZUV2ZW50KSA9PiB7XG4gICAgICBpZiAoZHJhZ1NlY3Rpb24gPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBpZiAoTWF0aC5hYnMobW92ZUV2ZW50LmNsaWVudFkgLSBzdGFydFkpIDwgNCkgcmV0dXJuO1xuICAgICAgICBkcmFnU2VjdGlvbiA9IHN0YXJ0QmxvY2suc2VjdGlvbjtcbiAgICAgICAgc2V0SG92ZXJlZCh1bmRlZmluZWQpO1xuICAgICAgICB3cmFwcGVyLmRvYy5ib2R5LmFkZENsYXNzKFwiZnJlZC10eXAtYmxvY2stZHJhZ2dpbmdcIik7XG4gICAgICAgIHdpbi5nZXRTZWxlY3Rpb24oKT8ucmVtb3ZlQWxsUmFuZ2VzKCk7XG4gICAgICAgIG1hcmtTZWN0aW9uKGRyYWdTZWN0aW9uKTtcbiAgICAgICAgbGF5b3V0Q2FyZHMoKTtcbiAgICAgICAgaW5kaWNhdG9yID0gd3JhcHBlci5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtdW5pZmllZC1kcm9wLWluZGljYXRvclwiIH0pO1xuICAgICAgfVxuICAgICAgbW92ZUV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBpZiAoYmxvY2tzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICAgICAgY29uc3QgeSA9IG1vdmVFdmVudC5jbGllbnRZIC0gd3JhcHBlci5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKS50b3A7XG4gICAgICB0YXJnZXRJbmRleCA9IGJsb2Nrcy5maWx0ZXIoKGJsb2NrKSA9PiAoYmxvY2sudG9wICsgYmxvY2suYm90dG9tKSAvIDIgPCB5KS5sZW5ndGg7XG4gICAgICBjb25zdCBmcm9tID0gYmxvY2tzLmZpbmRJbmRleCgoYmxvY2spID0+IGJsb2NrLnNlY3Rpb24gPT09IGRyYWdTZWN0aW9uKTtcbiAgICAgIGluZGljYXRvci50b2dnbGUodGFyZ2V0SW5kZXggIT09IGZyb20gJiYgdGFyZ2V0SW5kZXggIT09IGZyb20gKyAxKTtcbiAgICAgIC8vIE1pdHRlIGRlciBMXHUwMEZDY2tlIHp3aXNjaGVuIHp3ZWkgQmxcdTAwRjZja2VuIChBYnN0YW5kIHNpZWhlXG4gICAgICAvLyAuZnJlZC10eXAtc2VjdGlvbi1oZWFkZXI6bm90KDpmaXJzdC1jaGlsZCkgaW4gc3R5bGVzLmNzcykuXG4gICAgICBjb25zdCBoYWxmR2FwID0gNjtcbiAgICAgIGNvbnN0IGdhcFkgPVxuICAgICAgICB0YXJnZXRJbmRleCA9PT0gMFxuICAgICAgICAgID8gYmxvY2tzWzBdLnRvcCAtIGhhbGZHYXBcbiAgICAgICAgICA6IHRhcmdldEluZGV4ID09PSBibG9ja3MubGVuZ3RoXG4gICAgICAgICAgICA/IGJsb2Nrc1tibG9ja3MubGVuZ3RoIC0gMV0uYm90dG9tICsgaGFsZkdhcFxuICAgICAgICAgICAgOiAoYmxvY2tzW3RhcmdldEluZGV4IC0gMV0uYm90dG9tICsgYmxvY2tzW3RhcmdldEluZGV4XS50b3ApIC8gMjtcbiAgICAgIGluZGljYXRvci5zdHlsZS50b3AgPSBgJHtnYXBZIC0gMX1weGA7XG4gICAgfTtcblxuICAgIGNvbnN0IGVuZCA9IChjb21taXQpID0+IHtcbiAgICAgIHdpbi5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIG9uTW92ZSk7XG4gICAgICB3aW4ucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNldXBcIiwgb25VcCk7XG4gICAgICB3aW4ucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgb25LZXksIHRydWUpO1xuICAgICAgaWYgKGRyYWdTZWN0aW9uID09PSB1bmRlZmluZWQpIHJldHVybjtcbiAgICAgIGNvbnN0IHNlY3Rpb24gPSBkcmFnU2VjdGlvbjtcbiAgICAgIGRyYWdTZWN0aW9uID0gdW5kZWZpbmVkO1xuICAgICAgd3JhcHBlci5kb2MuYm9keS5yZW1vdmVDbGFzcyhcImZyZWQtdHlwLWJsb2NrLWRyYWdnaW5nXCIpO1xuICAgICAgaW5kaWNhdG9yPy5yZW1vdmUoKTtcbiAgICAgIG1hcmtTZWN0aW9uKHVuZGVmaW5lZCk7XG4gICAgICBsYXlvdXRDYXJkcygpO1xuXG4gICAgICBjb25zdCBvcmRlciA9IGJsb2Nrcy5tYXAoKGJsb2NrKSA9PiBibG9jay5zZWN0aW9uKTtcbiAgICAgIGNvbnN0IGZyb20gPSBvcmRlci5pbmRleE9mKHNlY3Rpb24pO1xuICAgICAgaWYgKCFjb21taXQgfHwgdGFyZ2V0SW5kZXggPT09IG51bGwgfHwgdGFyZ2V0SW5kZXggPT09IGZyb20gfHwgdGFyZ2V0SW5kZXggPT09IGZyb20gKyAxKSByZXR1cm47XG4gICAgICBvcmRlci5zcGxpY2UoZnJvbSwgMSk7XG4gICAgICBvcmRlci5zcGxpY2UoZnJvbSA8IHRhcmdldEluZGV4ID8gdGFyZ2V0SW5kZXggLSAxIDogdGFyZ2V0SW5kZXgsIDAsIHNlY3Rpb24pO1xuICAgICAgb25Nb3ZlU2VjdGlvbj8uKG9yZGVyKTtcbiAgICB9O1xuICAgIGNvbnN0IG9uVXAgPSAoKSA9PiBlbmQodHJ1ZSk7XG4gICAgY29uc3Qgb25LZXkgPSAoa2V5RXZlbnQpID0+IHtcbiAgICAgIGlmIChrZXlFdmVudC5rZXkgIT09IFwiRXNjYXBlXCIpIHJldHVybjtcbiAgICAgIGtleUV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBrZXlFdmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIGVuZChmYWxzZSk7XG4gICAgfTtcbiAgICB3aW4uYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlbW92ZVwiLCBvbk1vdmUpO1xuICAgIHdpbi5hZGRFdmVudExpc3RlbmVyKFwibW91c2V1cFwiLCBvblVwKTtcbiAgICB3aW4uYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgb25LZXksIHRydWUpO1xuICB9KTtcblxuICAvLyBLYXJ0ZW4gZm9sZ2VuIGplZGVyIFx1MDBDNG5kZXJ1bmcgZGVyIExpc3RlIC0gYXVjaCBsaXZlIHdcdTAwRTRocmVuZCBlaW5lcyBEcmFncyxcbiAgLy8gYmVpIGRlbSBPYnNpZGlhbiBkaWUgWmVpbGUgbGF1ZmVuZCBpbSBET00gdW1oXHUwMEU0bmd0LlxuICBjb25zdCBtdXRhdGlvbk9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIoKCkgPT4gbGF5b3V0Q2FyZHMoKSk7XG4gIG11dGF0aW9uT2JzZXJ2ZXIub2JzZXJ2ZShsaXN0RWwsIHsgY2hpbGRMaXN0OiB0cnVlIH0pO1xuICBjb25zdCByZXNpemVPYnNlcnZlciA9IG5ldyBSZXNpemVPYnNlcnZlcigoKSA9PiBsYXlvdXRDYXJkcygpKTtcbiAgcmVzaXplT2JzZXJ2ZXIub2JzZXJ2ZSh3cmFwcGVyKTtcbiAgZWRpdG9yLnJlZ2lzdGVyKCgpID0+IHtcbiAgICBtdXRhdGlvbk9ic2VydmVyLmRpc2Nvbm5lY3QoKTtcbiAgICByZXNpemVPYnNlcnZlci5kaXNjb25uZWN0KCk7XG4gIH0pO1xuXG4gIGluamVjdFNlY3Rpb25zKCk7XG4gIHJldHVybiBlZGl0b3I7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBtb3VudFVuaWZpZWRGcm9udG1hdHRlckVkaXRvciB9O1xuIiwgIi8vIFJlaW5lIEhpbGZzZnVua3Rpb25lbiBvaG5lIGVpZ2VuZW4gU3RhdGUgcnVuZCB1bSBUWVAtTmFtZW4gdW5kIGRlcmVuXG4vLyBTb3J0aWVydW5nLlxuXG4vLyBUWVBlbiB3ZXJkZW4gYXVzc2NobGllXHUwMERGbGljaCBpbiBHcm9cdTAwREZidWNoc3RhYmVuIGFuZ2VsZWd0L3VtYmVuYW5udCAtIGJlaW1cbi8vIEFubGVnZW4gd2llIGJlaW0gVW1iZW5lbm5lbi4gQmV0cmlmZnQgbnVyIFx1MDBGQ2JlciBkaWUgTGlzdGUgZ2V0aXBwdGUgTmFtZW4sXG4vLyBuaWNodCBXZXJ0ZSwgZGllIHouIEIuIGRpcmVrdCBpbSBGcm9udG1hdHRlciBlaW5lciBOb3RpeiBpbiBLbGVpbnNjaHJlaWJ1bmdcbi8vIHN0ZWhlbiAoc2llaGUgXCJ1bnJlZ2lzdHJpZXJ0ZVwiIFplaWxlbiBpbiB0eXAtdmlldy5qcykuXG5mdW5jdGlvbiBub3JtYWxpemVUeXBlTmFtZShyYXcpIHtcbiAgcmV0dXJuIHJhdy50cmltKCkudG9VcHBlckNhc2UoKTtcbn1cblxuLy8gRmFyYnRvbiAoMC0zNjBcdTAwQjApIGF1cyBlaW5lbSBIZXgtQ29kZSwgZlx1MDBGQ3IgZGllIFNvcnRpZXJ1bmcgbmFjaCBGYXJic3Bla3RydW1cbi8vIHN0YXR0IG5hY2ggSGV4LVN0cmluZy4gUm90IGxpZWd0IGJlaSAwXHUwMEIwLzM2MFx1MDBCMCAoS3JlaXMpIC0gYXVmc3RlaWdlbmQgYmVnaW5udFxuLy8gZGllIFNvcnRpZXJ1bmcgZGFtaXQgYmVpIFJvdCwgbFx1MDBFNHVmdCBcdTAwRkNiZXIgT3JhbmdlL0dlbGIvR3JcdTAwRkNuL0N5YW4vQmxhdS9NYWdlbnRhXG4vLyB1bmQgbGFuZGV0IHdpZWRlciBiZWkgUm90LiBBY2hyb21hdGlzY2hlIEZhcmJlbiAoR3JhdS9TY2h3YXJ6L1dlaVx1MDBERiwgZGVsdGE9MClcbi8vIGhhYmVuIGtlaW5lbiBkZWZpbmllcnRlbiBGYXJidG9uIC0gZGFmXHUwMEZDciBsaWVmZXJ0IGRpZXNlIEZ1bmt0aW9uIG51bGwsIGRhbWl0XG4vLyBjb21wYXJlVHlwZXMgc2llIHVuYWJoXHUwMEU0bmdpZyB2b24gZGVyIFNvcnRpZXJyaWNodHVuZyBhbnMgRW5kZSBzdGVsbGVuIGthbm4uXG5mdW5jdGlvbiBoZXhUb0h1ZShoZXgpIHtcbiAgY29uc3QgbWF0Y2ggPSAvXiM/KFswLTlhLWZdezZ9KSQvaS5leGVjKGhleCA/PyBcIlwiKTtcbiAgaWYgKCFtYXRjaCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGludCA9IHBhcnNlSW50KG1hdGNoWzFdLCAxNik7XG4gIGNvbnN0IHIgPSAoKGludCA+PiAxNikgJiAyNTUpIC8gMjU1O1xuICBjb25zdCBnID0gKChpbnQgPj4gOCkgJiAyNTUpIC8gMjU1O1xuICBjb25zdCBiID0gKGludCAmIDI1NSkgLyAyNTU7XG4gIGNvbnN0IG1heCA9IE1hdGgubWF4KHIsIGcsIGIpO1xuICBjb25zdCBtaW4gPSBNYXRoLm1pbihyLCBnLCBiKTtcbiAgY29uc3QgZGVsdGEgPSBtYXggLSBtaW47XG4gIGlmIChkZWx0YSA9PT0gMCkgcmV0dXJuIG51bGw7XG5cbiAgbGV0IGh1ZTtcbiAgaWYgKG1heCA9PT0gcikgaHVlID0gKChnIC0gYikgLyBkZWx0YSkgJSA2O1xuICBlbHNlIGlmIChtYXggPT09IGcpIGh1ZSA9IChiIC0gcikgLyBkZWx0YSArIDI7XG4gIGVsc2UgaHVlID0gKHIgLSBnKSAvIGRlbHRhICsgNDtcbiAgaHVlICo9IDYwO1xuICByZXR1cm4gaHVlIDwgMCA/IGh1ZSArIDM2MCA6IGh1ZTtcbn1cblxuLy8gR2VtZWluc2FtZSBTb3J0aWVybG9naWsgZlx1MDBGQ3IgVFlQLSB1bmQgU1VCVFlQLUxpc3Rlbi4gdHlwZUNvbG9ycyBkYXJmIGVpblxuLy8gbGVlcmVzIE9iamVrdCBzZWluIChTVUJUWVAgaGF0IGtlaW5lIGVpZ2VuZSBGYXJiZSkgLSBkZXIgXCJjb2xvclwiLU1vZHVzIHdpcmRcbi8vIGRvcnQgc2NobGljaHQgbmllIGF1c2dld1x1MDBFNGhsdC5cbmZ1bmN0aW9uIGNvbXBhcmVUeXBlcyhtb2RlLCBhLCBiLCBjb3VudHMsIHR5cGVDb2xvcnMpIHtcbiAgY29uc3QgW2tleSwgZGlyXSA9IG1vZGUuc3BsaXQoXCItXCIpO1xuICBsZXQgY21wO1xuICBpZiAoa2V5ID09PSBcImNvdW50XCIpIHtcbiAgICBjbXAgPSAoY291bnRzLmdldChhKSA/PyAwKSAtIChjb3VudHMuZ2V0KGIpID8/IDApO1xuICAgIGlmIChkaXIgPT09IFwiZGVzY1wiKSBjbXAgPSAtY21wO1xuICB9IGVsc2UgaWYgKGtleSA9PT0gXCJjb2xvclwiKSB7XG4gICAgY29uc3QgaHVlQSA9IGhleFRvSHVlKHR5cGVDb2xvcnNbYV0gPz8gbnVsbCk7XG4gICAgY29uc3QgaHVlQiA9IGhleFRvSHVlKHR5cGVDb2xvcnNbYl0gPz8gbnVsbCk7XG4gICAgLy8gQWNocm9tYXRpc2NoZSBGYXJiZW4gYmxlaWJlbiBpbW1lciBhbSBFbmRlLCBlZ2FsIG9iIGF1Zi0gb2RlciBhYnN0ZWlnZW5kXG4gICAgLy8gc29ydGllcnQgd2lyZCAtIG51ciBkaWUgUmVpaGVuZm9sZ2UgaW5uZXJoYWxiIGRlciBlY2h0ZW4gRmFyYnRcdTAwRjZuZSBkcmVodCBzaWNoIHVtLlxuICAgIGlmIChodWVBID09PSBudWxsICYmIGh1ZUIgPT09IG51bGwpIGNtcCA9IDA7XG4gICAgZWxzZSBpZiAoaHVlQSA9PT0gbnVsbCkgY21wID0gMTtcbiAgICBlbHNlIGlmIChodWVCID09PSBudWxsKSBjbXAgPSAtMTtcbiAgICBlbHNlIHtcbiAgICAgIGNtcCA9IGh1ZUEgLSBodWVCO1xuICAgICAgaWYgKGRpciA9PT0gXCJkZXNjXCIpIGNtcCA9IC1jbXA7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIGNtcCA9IGEubG9jYWxlQ29tcGFyZShiKTtcbiAgICBpZiAoZGlyID09PSBcImRlc2NcIikgY21wID0gLWNtcDtcbiAgfVxuICByZXR1cm4gY21wIHx8IGEubG9jYWxlQ29tcGFyZShiKTtcbn1cblxuLy8gV2VuZGV0IGRlbiBha3R1ZWxsZW4gU29ydGllcm1vZHVzIGF1ZiBlaW5lIExpc3RlIHZvbiBUWVBlbiBhbi4gU29uZGVyZmFsbFxuLy8gXCJtYW51YWxcIiAoc2llaGUgU09SVF9PUFRJT05TIGluIHR5cC12aWV3LmpzKTogZG9ydCBibGVpYnQgYmV3dXNzdCBkaWVcbi8vIFx1MDBGQ2JlcmdlYmVuZSBSZWloZW5mb2xnZSBzZWxic3QgZXJoYWx0ZW4sIHN0YXR0IHNpZSB6dSBzb3J0aWVyZW4gLSBzaWUgSVNUIGluXG4vLyBkaWVzZW0gTW9kdXMgZGllIGdlc3BlaWNoZXJ0ZSBTb3J0aWVydW5nIChwbHVnaW4uc2V0dGluZ3MudHlwZXMsIHBlciBEcmFnICZcbi8vIERyb3AgaW4gdHlwLXZpZXcuanMgdmVyc2Nob2JlbikuIEVpbiBWZXJnbGVpY2ggendlaWVyIFRZUGVuIGtcdTAwRjZubnRlIGRpZXNlXG4vLyBSZWloZW5mb2xnZSBuaWNodCBoZXJsZWl0ZW4sIGNvbXBhcmVUeXBlcyBibGVpYnQgZGFoZXIgdW5hbmdldGFzdGV0LiBWb25cbi8vIG1haW4uanMgKGdldFR5cGVzKCksIGZcdTAwRkNyIFRlbXBsYXRlci9QaWNrZXIpIFVORCB0eXAtdmlldy5qcyBnZW51dHp0LCBkYW1pdFxuLy8gYmVpZGUgZGllc2VsYmUgUmVpaGVuZm9sZ2UgemVpZ2VuLlxuZnVuY3Rpb24gc29ydFR5cGVzQnlNb2RlKHR5cGVzLCBtb2RlLCBjb3VudHMsIHR5cGVDb2xvcnMpIHtcbiAgaWYgKG1vZGUgPT09IFwibWFudWFsXCIpIHJldHVybiBbLi4udHlwZXNdO1xuICByZXR1cm4gWy4uLnR5cGVzXS5zb3J0KChhLCBiKSA9PiBjb21wYXJlVHlwZXMobW9kZSwgYSwgYiwgY291bnRzLCB0eXBlQ29sb3JzKSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBub3JtYWxpemVUeXBlTmFtZSwgaGV4VG9IdWUsIGNvbXBhcmVUeXBlcywgc29ydFR5cGVzQnlNb2RlIH07XG4iLCAiY29uc3QgeyBJdGVtVmlldywgTWVudSwgTW9kYWwsIE5vdGljZSwgc2V0SWNvbiwgZGVib3VuY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgbW91bnRVbmlmaWVkRnJvbnRtYXR0ZXJFZGl0b3IgfSA9IHJlcXVpcmUoXCIuL3VuaWZpZWQtZnJvbnRtYXR0ZXItZWRpdG9yXCIpO1xuY29uc3Qge1xuICBub3JtYWxpemVTdWJ0eXBlTmFtZSxcbiAgZ2V0U3VidHlwZU5hbWVzLFxuICBlbnN1cmVTdWJ0eXBlLFxuICBtb3ZlVHlwZVN1YnR5cGVzLFxuICBkZWxldGVUeXBlU3VidHlwZXMsXG4gIG1lcmdlVHlwZVN1YnR5cGVzLFxuICBnZXRTdWJ0eXBlLFxuICByZW5hbWVTdWJ0eXBlLFxuICByZW9yZGVyU3VidHlwZXMsXG4gIGRlbGV0ZVN1YnR5cGUsXG4gIG1lcmdlU3VidHlwZXMsXG4gIHJlbmFtZVN1YnR5cGVJbk5vdGVzLFxufSA9IHJlcXVpcmUoXCIuL3N1YnR5cGVzXCIpO1xuY29uc3QgeyBGUk9OVE1BVFRFUl9QTEFDRUhPTERFUlMsIERZTkFNSUNfUExBQ0VIT0xERVJfSU5GTyB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItcGxhY2Vob2xkZXJzXCIpO1xuY29uc3QgeyBub3JtYWxpemVUeXBlTmFtZSwgY29tcGFyZVR5cGVzLCBzb3J0VHlwZXNCeU1vZGUgfSA9IHJlcXVpcmUoXCIuL3R5cGUtdXRpbHNcIik7XG5jb25zdCB7IHR5cGVLZXlPZiwgcHJvcGVydHlWYWx1ZSwgc2V0Q2Fub25pY2FsUHJvcGVydHksIFRZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZIH0gPSByZXF1aXJlKFwiLi90eXAtaW5kZXhcIik7XG5cbmNvbnN0IFZJRVdfVFlQRV9UWVAgPSBcImZyZWQtdHlwLXZpZXdcIjtcbmNvbnN0IERFRkFVTFRfVFlQRV9DT0xPUiA9IFwiIzg4ODg4OFwiO1xuY29uc3QgREVGQVVMVF9TT1JUX09SREVSID0gXCJjb3VudC1kZXNjXCI7XG5cbmNvbnN0IFNPUlRfT1BUSU9OUyA9IFtcbiAgLy8gTnV0enQgKGFuZGVycyBhbHMgZGllIFx1MDBGQ2JyaWdlbiBNb2RpKSBrZWluZW4gZWlnZW5lbiBWZXJnbGVpY2gsIHNvbmRlcm4gZGllXG4gIC8vIFJlaWhlbmZvbGdlIHZvbiBwbHVnaW4uc2V0dGluZ3MudHlwZXMgc2VsYnN0IGFscyBTcGVpY2hlcm9ydCAtIHNpZWhlXG4gIC8vIHJlbmRlcigpIHVuZCByZW5kZXJSZWdpc3RlcmVkSXRlbSgpIGZcdTAwRkNyIGRhcyBwZXIgRHJhZyAmIERyb3AgdmVyc2NoaWViYmFyZVxuICAvLyBSZW5kZXJuLCBkYXMgZ2VuYXUgZGFyYXVmIGF1ZmJhdXQuIEJld3Vzc3QgYWxzIGVyc3RlIE9wdGlvbiAoc2llaGVcbiAgLy8gc2hvd1NvcnRNZW51KSAtIGVpZ2VuZSwgb2JlcnN0ZSBHcnVwcGUgaW0gTWVuXHUwMEZDIHN0YXR0IGVpbnNvcnRpZXJ0IHp3aXNjaGVuXG4gIC8vIGRpZSBlaWdlbnRsaWNoZW4gU29ydGllcmtyaXRlcmllbi5cbiAgeyBtb2RlOiBcIm1hbnVhbFwiLCB0aXRsZTogXCJNYW51ZWxsIChEcmFnICYgRHJvcClcIiB9LFxuICB7IG1vZGU6IFwiY291bnQtZGVzY1wiLCB0aXRsZTogXCJIXHUwMEU0dWZpZ2tlaXQgKGFic3RlaWdlbmQpXCIgfSxcbiAgeyBtb2RlOiBcImNvdW50LWFzY1wiLCB0aXRsZTogXCJIXHUwMEU0dWZpZ2tlaXQgKGF1ZnN0ZWlnZW5kKVwiIH0sXG4gIHsgbW9kZTogXCJuYW1lLWFzY1wiLCB0aXRsZTogXCJOYW1lIChBIGJpcyBaKVwiIH0sXG4gIHsgbW9kZTogXCJuYW1lLWRlc2NcIiwgdGl0bGU6IFwiTmFtZSAoWiBiaXMgQSlcIiB9LFxuICB7IG1vZGU6IFwiY29sb3ItYXNjXCIsIHRpdGxlOiBcIkZhcmJlIChSb3QgXHUyMTkyIFZpb2xldHQpXCIgfSxcbiAgeyBtb2RlOiBcImNvbG9yLWRlc2NcIiwgdGl0bGU6IFwiRmFyYmUgKFZpb2xldHQgXHUyMTkyIFJvdClcIiB9LFxuXTtcblxuLy8gU2NocmVpYnQgZGVuIFRZUC1XZXJ0IGFsbGVyIE5vdGl6ZW4gbWl0IGRlbSBTY2hsXHUwMEZDc3NlbCBvbGRLZXkgKHNpZWhlXG4vLyB0eXBlS2V5T2YgaW4gdHlwLWluZGV4LmpzIC0gZlx1MDBGQ3IgZWluZW4gc2F1YmVyZW4gV2VydCBkZXIgVFlQLU5hbWUgc2VsYnN0LFxuLy8gc29uc3QgZGllIFJvaGZvcm0sIHouIEIuIFwiIGJ1Y2hcIiBvZGVyIFwiW1BFUlNPTiwgQlVDSF1cIikgYXVmIGRlbiBFaW56ZWx3ZXJ0XG4vLyBuZXdWYWx1ZSB1bS4gR2VudXR6dCBmXHUwMEZDciByZWdpc3RlclR5cGUoKSAoQmVyZWluaWdlbiksIFVtYmVuZW5uZW4gdW5kXG4vLyBadXNhbW1lbmxlZ2VuLiBEZXIgQWJnbGVpY2ggZXJmb2xndCBleGFrdCBcdTAwRkNiZXIgZGVuIFNjaGxcdTAwRkNzc2VsLCBlaW5lIExpc3RlXG4vLyB3aXJkIGRhYmVpIGFsc28gYWxzIEdhbnplcyBlcnNldHp0IHN0YXR0IG51ciBlaW5lciBpaHJlciBFaW50clx1MDBFNGdlLiBFaW5cbi8vIGFid2VpY2hlbmQgZ2VzY2hyaWViZW5lciBQcm9wZXJ0eS1OYW1lIChcInR5cFwiKSB3aXJkIGRhYmVpIHp1IFwiVFlQXCIuXG5hc3luYyBmdW5jdGlvbiByZW5hbWVUeXBlSW5Ob3RlcyhwbHVnaW4sIG9sZEtleSwgbmV3VmFsdWUpIHtcbiAgbGV0IGNoYW5nZWQgPSAwO1xuICBmb3IgKGNvbnN0IGZpbGUgb2YgcGx1Z2luLnR5cEluZGV4LmZpbGVzV2l0aFR5cGUob2xkS2V5KSkge1xuICAgIGxldCBtYXRjaGVkID0gZmFsc2U7XG4gICAgYXdhaXQgcGx1Z2luLmFwcC5maWxlTWFuYWdlci5wcm9jZXNzRnJvbnRNYXR0ZXIoZmlsZSwgKGZyb250bWF0dGVyKSA9PiB7XG4gICAgICBpZiAodHlwZUtleU9mKHByb3BlcnR5VmFsdWUoZnJvbnRtYXR0ZXIsIFRZUF9QUk9QRVJUWSkpICE9PSBvbGRLZXkpIHJldHVybjtcbiAgICAgIHNldENhbm9uaWNhbFByb3BlcnR5KGZyb250bWF0dGVyLCBUWVBfUFJPUEVSVFksIG5ld1ZhbHVlKTtcbiAgICAgIG1hdGNoZWQgPSB0cnVlO1xuICAgIH0pO1xuICAgIGlmIChtYXRjaGVkKSBjaGFuZ2VkKys7XG4gIH1cbiAgcmV0dXJuIGNoYW5nZWQ7XG59XG5cbi8vIEJlcmVpbmlndGUgRm9ybSBlaW5lcyBSb2h3ZXJ0cyBmXHUwMEZDciByZWdpc3RlclR5cGUoKTogRWluemVsd2VydCBnZXRyaW1tdCB1bmRcbi8vIGdyb1x1MDBERiBnZXNjaHJpZWJlbjsgZWluZSBMaXN0ZSB3aXJkIGJld3Vzc3QgTklDSFQgYXVmIGVpbmVuIGlocmVyIEVpbnRyXHUwMEU0Z2Vcbi8vIHJlZHV6aWVydCwgc29uZGVybiBhbHMgR2FuemVzIHp1IGVpbmVtIEVpbnplbHdlcnQgXCJBLCBCXCIgKFJvaGZvcm0pIC0gZGFyYXVzXG4vLyBsXHUwMEU0c3N0IHNpY2ggZGVyIFRZUCBkYW5hY2ggcGVyIFVtYmVuZW5uZW4gZ2V6aWVsdCBpbiBlaW5lbiBhbmRlcmVuIFx1MDBGQ2JlcmZcdTAwRkNocmVuXG4vLyAoc2llaGUgc3RhcnREZXRhaWxSZW5hbWUvc2hvd01lcmdlQ29uZmlybSkuIG5vcm1hbGl6ZTogU2NocmVpYndlaXNlIGRlclxuLy8gZWluemVsbmVuIE5hbWVuIC0gZlx1MDBGQ3IgU3VidHlwZW4gbm9ybWFsaXplU3VidHlwZU5hbWUgKHNpZWhlIHN1YnR5cGVzLmpzKS5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVJhd1R5cGUocmF3LCBub3JtYWxpemUgPSBub3JtYWxpemVUeXBlTmFtZSkge1xuICBpZiAoQXJyYXkuaXNBcnJheShyYXcpKSB7XG4gICAgcmV0dXJuIHJhd1xuICAgICAgLm1hcCgodikgPT4gbm9ybWFsaXplKFN0cmluZyh2ID8/IFwiXCIpKSlcbiAgICAgIC5maWx0ZXIoQm9vbGVhbilcbiAgICAgIC5qb2luKFwiLCBcIik7XG4gIH1cbiAgcmV0dXJuIG5vcm1hbGl6ZShTdHJpbmcocmF3KSk7XG59XG5cbi8vIEFuemVpZ2UgZWluZXMgdW5yZWdpc3RyaWVydGVuIFNjaGxcdTAwRkNzc2VsczogUmFuZGxlZXJ6ZWljaGVuIHdcdTAwRTRyZW4gYWxzIHJlaW5lclxuLy8gVGV4dCB1bnNpY2h0YmFyLCBkYWhlciBkYW5uIGluIEFuZlx1MDBGQ2hydW5nc3plaWNoZW4uIExpc3RlbiB0cmFnZW4gaWhyZVxuLy8gZWNraWdlbiBLbGFtbWVybiBzY2hvbiBpbSBTY2hsXHUwMEZDc3NlbC5cbmZ1bmN0aW9uIGRpc3BsYXlUeXBlS2V5KHR5cGVLZXkpIHtcbiAgcmV0dXJuIHR5cGVLZXkgIT09IHR5cGVLZXkudHJpbSgpID8gYFwiJHt0eXBlS2V5fVwiYCA6IHR5cGVLZXk7XG59XG5cbi8vIFRZUC1OYW1lIGluIEZsaWVcdTAwREZ0ZXh0IChCZXN0XHUwMEU0dGlndW5ncy1Nb2RhbGUpOiBlaW5nZWZcdTAwRTRyYnRlciBOYW1lLCB3ZW5uIFwiVFlQXG4vLyBWaWV3IGVpbmZcdTAwRTRyYmVuXCIgYWt0aXYgaXN0IChjb2xvclZpZXdzLnR5cExpc3QpLCBzb25zdCBlaW4gRmFyYnB1bmt0IGRhdm9yXG4vLyBwbHVzIG5vcm1hbGVyIFRleHQgLSBkaWVzZWxiZSBVbXNjaGFsdHVuZyB3aWUgaW0gVFlQLVBpY2tlciAoc2llaGVcbi8vIHJlbmRlclN1Z2dlc3Rpb24gaW4gdHlwZS1waWNrZXIuanMpIHVuZCBpbiBkZXIgVFlQLUxpc3RlIHNlbGJzdC4gY29sb3Igd2lyZFxuLy8gdm9tIEF1ZnJ1ZmVyIFx1MDBGQ2JlcmdlYmVuIHN0YXR0IGhpZXIgbmFjaGdlc2NobGFnZW4sIGRhbWl0IHouIEIuIGJlaSBlaW5lclxuLy8gVW1iZW5lbm51bmcgYmV3dXNzdCBmXHUwMEZDciBhbHQgVU5EIG5ldSBkaWVzZWxiZSAoZGllIGRlcyBhbHRlbiBOYW1lbnMsIGRpZSBuYWNoXG4vLyBkZW0gVW1iZW5lbm5lbiBlcmhhbHRlbiBibGVpYnQpIEZhcmJlIHZlcndlbmRldCB3ZXJkZW4ga2Fubi5cbmZ1bmN0aW9uIGFwcGVuZFR5cGVOYW1lKHBhcmVudEVsLCBwbHVnaW4sIHR5cGUsIGNvbG9yKSB7XG4gIGlmIChwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0KSB7XG4gICAgcGFyZW50RWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1pbmxpbmUtbmFtZVwiLCB0ZXh0OiB0eXBlIH0pLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gIH0gZWxzZSB7XG4gICAgcGFyZW50RWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1pbmxpbmUtZG90XCIgfSkuc3R5bGUuYmFja2dyb3VuZENvbG9yID0gY29sb3I7XG4gICAgcGFyZW50RWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1pbmxpbmUtbmFtZVwiLCB0ZXh0OiB0eXBlIH0pO1xuICB9XG59XG5cbmNsYXNzIENvbmZpcm1EZWxldGVUeXBlTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKHBsdWdpbiwgdHlwZSwgb25Db25maXJtKSB7XG4gICAgc3VwZXIocGx1Z2luLmFwcCk7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gICAgdGhpcy50eXBlID0gdHlwZTtcbiAgICB0aGlzLm9uQ29uZmlybSA9IG9uQ29uZmlybTtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICB0aGlzLm1vZGFsRWwuYWRkQ2xhc3MoXCJmcmVkLWNvbmZpcm0tZGVsZXRlLW1vZGFsXCIpO1xuICAgIGNvbnN0IHAgPSBjb250ZW50RWwuY3JlYXRlRWwoXCJwXCIpO1xuICAgIHAuYXBwZW5kVGV4dChcIlR5cCBcIik7XG4gICAgYXBwZW5kVHlwZU5hbWUocCwgdGhpcy5wbHVnaW4sIHRoaXMudHlwZSwgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0aGlzLnR5cGVdID8/IERFRkFVTFRfVFlQRV9DT0xPUik7XG4gICAgcC5hcHBlbmRUZXh0KFwiIHdpcmtsaWNoIGxcdTAwRjZzY2hlbj9cIik7XG5cbiAgICBjb25zdCBidXR0b25Sb3cgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcIm1vZGFsLWJ1dHRvbi1jb250YWluZXJcIiB9KTtcbiAgICBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkFiYnJlY2hlblwiIH0pLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xuXG4gICAgY29uc3QgY29uZmlybUJ0biA9IGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IGNsczogXCJtb2Qtd2FybmluZ1wiLCB0ZXh0OiBcIkxcdTAwRjZzY2hlblwiIH0pO1xuICAgIGNvbmZpcm1CdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgIHRoaXMub25Db25maXJtKCk7XG4gICAgfSk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gIH1cbn1cblxuLy8gVm9yIGRlbSBcIlVtYmVuZW5uZW4gKGlua2wuIE5vdGl6ZW4gYW5wYXNzZW4pXCItQnV0dG9uIChzaWVoZSByZW5kZXJUeXBlU2V0dGluZ3Ncbi8vIHVuZCBzdGFydERldGFpbFJlbmFtZSkgLSBpbSBHZWdlbnNhdHogenVyIG5vcm1hbGVuIFVtYmVuZW5udW5nLCBkaWUgbnVyIGRpZVxuLy8gUGx1Z2luLUVpbnN0ZWxsdW5nZW4gXHUwMEU0bmRlcnQsIHNjaHJlaWJ0IGRpZXNlIFZhcmlhbnRlIHp1c1x1MDBFNHR6bGljaCBkZW4gVFlQLVdlcnRcbi8vIGFsbGVyIGJldHJvZmZlbmVuIE5vdGl6ZW4gdW0uIERhcyBpc3QgZWluIEJ1bGstU2NocmVpYnZvcmdhbmcgXHUwMEZDYmVyXG4vLyBwb3RlbnppZWxsIHZpZWxlIERhdGVpZW4sIGRhaGVyIGhpZXIgZWluZSBleHBsaXppdGUgQmVzdFx1MDBFNHRpZ3VuZyBkYXZvci5cbmNsYXNzIENvbmZpcm1SZW5hbWVUeXBlTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKHBsdWdpbiwgb2xkVHlwZSwgbmV3VHlwZSwgYWZmZWN0ZWRDb3VudCwgb25Db25maXJtLCBvbkNhbmNlbCkge1xuICAgIHN1cGVyKHBsdWdpbi5hcHApO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICAgIHRoaXMub2xkVHlwZSA9IG9sZFR5cGU7XG4gICAgdGhpcy5uZXdUeXBlID0gbmV3VHlwZTtcbiAgICB0aGlzLmFmZmVjdGVkQ291bnQgPSBhZmZlY3RlZENvdW50O1xuICAgIHRoaXMub25Db25maXJtID0gb25Db25maXJtO1xuICAgIHRoaXMub25DYW5jZWwgPSBvbkNhbmNlbDtcbiAgICB0aGlzLmNvbmZpcm1lZCA9IGZhbHNlO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIHRoaXMubW9kYWxFbC5hZGRDbGFzcyhcImZyZWQtY29uZmlybS1kZWxldGUtbW9kYWxcIik7XG4gICAgLy8gRGllc2VsYmUgRmFyYmUgZlx1MDBGQ3IgYWx0IHVuZCBuZXUgKGRpZSBkZXMgYWx0ZW4gTmFtZW5zKSAtIGRlciBuZXVlIE5hbWVcbiAgICAvLyBoYXQgdm9yIGRlbSBlaWdlbnRsaWNoZW4gVW1iZW5lbm5lbiBub2NoIGtlaW5lbiBlaWdlbmVuIEVpbnRyYWcgaW5cbiAgICAvLyB0eXBlQ29sb3JzLCBcdTAwRkNiZXJuaW1tdCBhYmVyIGRpZSBGYXJiZSBkZXMgYWx0ZW4gKHNpZWhlIGFwcGx5UmVuYW1lKS5cbiAgICBjb25zdCBjb2xvciA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdGhpcy5vbGRUeXBlXSA/PyBERUZBVUxUX1RZUEVfQ09MT1I7XG4gICAgY29uc3QgcCA9IGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIik7XG4gICAgcC5hcHBlbmRUZXh0KFwiVFlQIFwiKTtcbiAgICBhcHBlbmRUeXBlTmFtZShwLCB0aGlzLnBsdWdpbiwgdGhpcy5vbGRUeXBlLCBjb2xvcik7XG4gICAgcC5hcHBlbmRUZXh0KFwiIGluIFwiKTtcbiAgICBhcHBlbmRUeXBlTmFtZShwLCB0aGlzLnBsdWdpbiwgdGhpcy5uZXdUeXBlLCBjb2xvcik7XG4gICAgcC5hcHBlbmRUZXh0KGAgdW1iZW5lbm5lbiB1bmQgJHt0aGlzLmFmZmVjdGVkQ291bnR9IE5vdGl6KGVuKSBlbnRzcHJlY2hlbmQgYW5wYXNzZW4/YCk7XG5cbiAgICBjb25zdCBidXR0b25Sb3cgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcIm1vZGFsLWJ1dHRvbi1jb250YWluZXJcIiB9KTtcbiAgICBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkFiYnJlY2hlblwiIH0pLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xuXG4gICAgY29uc3QgY29uZmlybUJ0biA9IGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IGNsczogXCJtb2QtY3RhXCIsIHRleHQ6IFwiVW1iZW5lbm5lblwiIH0pO1xuICAgIGNvbmZpcm1CdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIHRoaXMuY29uZmlybWVkID0gdHJ1ZTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgIHRoaXMub25Db25maXJtKCk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBEZWNrdCBzb3dvaGwgXCJBYmJyZWNoZW5cIi1LbGljayBhbHMgYXVjaCBFc2NhcGUvS2xpY2sgZGFuZWJlbiBhYiAtIGFuYWxvZ1xuICAvLyB6dW0gQ2FuY2VsLUhhbmRsaW5nIGluIFR5cFBpY2tlck1vZGFsLlxuICBvbkNsb3NlKCkge1xuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gICAgaWYgKCF0aGlzLmNvbmZpcm1lZCkgdGhpcy5vbkNhbmNlbD8uKCk7XG4gIH1cbn1cblxuLy8gVW1iZW5lbm5lbiBhdWYgZGVuIE5hbWVuIGVpbmVzIGJlcmVpdHMgcmVnaXN0cmllcnRlbiBUWVBzIChzaWVoZVxuLy8gc3RhcnREZXRhaWxSZW5hbWUpIC0gc3RhdHQgZGllIFVtYmVuZW5udW5nIHN0aWxsc2Nod2VpZ2VuZCB6dSB2ZXJ3ZXJmZW4sXG4vLyBhbmJpZXRlbiwgYmVpZGUgenVzYW1tZW56dWxlZ2VuIChzaWVoZSBtZXJnZVR5cGUpLiBTY2hyZWlidCBpbW1lciBhdWNoIGRpZVxuLy8gTm90aXplbiB1bSwgdW5hYmhcdTAwRTRuZ2lnIGRhdm9uLCBcdTAwRkNiZXIgd2VsY2hlbiBkZXIgYmVpZGVuIFVtYmVuZW5uZW4tQnV0dG9ucyBlc1xuLy8gYXVzZ2VsXHUwMEY2c3Qgd3VyZGU6IGVpbiBadXNhbW1lbmxlZ2VuIG51ciBpbiBkZW4gRWluc3RlbGx1bmdlbiBsaWVcdTAwREZlIGRpZVxuLy8gTm90aXplbiBkZXMgUXVlbGwtVFlQcyBhbHMgdW5yZWdpc3RyaWVydGVuIEVpbnRyYWcgenVyXHUwMEZDY2suXG5jbGFzcyBDb25maXJtTWVyZ2VUeXBlTW9kYWwgZXh0ZW5kcyBDb25maXJtUmVuYW1lVHlwZU1vZGFsIHtcbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIHRoaXMubW9kYWxFbC5hZGRDbGFzcyhcImZyZWQtY29uZmlybS1kZWxldGUtbW9kYWxcIik7XG4gICAgY29uc3Qgc2V0dGluZ3MgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncztcbiAgICBjb25zdCBwID0gY29udGVudEVsLmNyZWF0ZUVsKFwicFwiKTtcbiAgICBwLmFwcGVuZFRleHQoXCJUWVAgXCIpO1xuICAgIGFwcGVuZFR5cGVOYW1lKHAsIHRoaXMucGx1Z2luLCB0aGlzLm5ld1R5cGUsIHNldHRpbmdzLnR5cGVDb2xvcnNbdGhpcy5uZXdUeXBlXSA/PyBERUZBVUxUX1RZUEVfQ09MT1IpO1xuICAgIHAuYXBwZW5kVGV4dChcIiBleGlzdGllcnQgYmVyZWl0cy4gXCIpO1xuICAgIGFwcGVuZFR5cGVOYW1lKHAsIHRoaXMucGx1Z2luLCB0aGlzLm9sZFR5cGUsIHNldHRpbmdzLnR5cGVDb2xvcnNbdGhpcy5vbGRUeXBlXSA/PyBERUZBVUxUX1RZUEVfQ09MT1IpO1xuICAgIHAuYXBwZW5kVGV4dChcIiBkYW1pdCB6dXNhbW1lbmxlZ2VuP1wiKTtcblxuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgdGV4dDpcbiAgICAgICAgYCR7dGhpcy5hZmZlY3RlZENvdW50fSBOb3Rpeihlbikgd2VyZGVuIGF1ZiAke3RoaXMubmV3VHlwZX0gdW1nZXN0ZWxsdC4gYCArXG4gICAgICAgIGBGYXJiZSwgQmVzY2hyZWlidW5nIHVuZCBTdGFuZGFyZC1Gcm9udG1hdHRlciB2b24gJHt0aGlzLm9sZFR5cGV9IGVudGZhbGxlbiwgYCArXG4gICAgICAgIGBzZWluZSBTdWJ0eXBlbiB3ZXJkZW4gXHUwMEZDYmVybm9tbWVuIChnbGVpY2huYW1pZ2UgU3VidHlwLUJsXHUwMEY2Y2tlIHp1c2FtbWVuZ2VmXHUwMEZDaHJ0KS5gLFxuICAgIH0pO1xuXG4gICAgY29uc3QgYnV0dG9uUm93ID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJtb2RhbC1idXR0b24tY29udGFpbmVyXCIgfSk7XG4gICAgYnV0dG9uUm93LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCJBYmJyZWNoZW5cIiB9KS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5jbG9zZSgpKTtcblxuICAgIGNvbnN0IGNvbmZpcm1CdG4gPSBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IFwibW9kLXdhcm5pbmdcIiwgdGV4dDogXCJadXNhbW1lbmxlZ2VuXCIgfSk7XG4gICAgY29uZmlybUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5jb25maXJtZWQgPSB0cnVlO1xuICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgdGhpcy5vbkNvbmZpcm0oKTtcbiAgICB9KTtcbiAgfVxufVxuXG4vLyBCZXN0XHUwMEU0dGlndW5nZW4gcnVuZCB1bSBTdWJ0eXBlbiAoc2llaGUgcmVuZGVyU2VjdGlvbkZvb3Rlcik6IHNjaGxpY2h0ZXIgVGV4dFxuLy8gc3RhdHQgZWluZ2VmXHUwMEU0cmJ0ZXIgVFlQLU5hbWVuLCBzb25zdCB3aWUgZGllIFRZUC1Nb2RhbGUgb2Jlbi4gb25DYW5jZWwgZ3JlaWZ0XG4vLyB3aWUgZG9ydCBhdWNoIGJlaSBFc2NhcGUvS2xpY2sgZGFuZWJlbi5cbmNsYXNzIENvbmZpcm1TdWJ0eXBlTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKGFwcCwgeyBwYXJhZ3JhcGhzLCBjb25maXJtVGV4dCwgY29uZmlybUNscywgb25Db25maXJtLCBvbkNhbmNlbCB9KSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLnBhcmFncmFwaHMgPSBwYXJhZ3JhcGhzO1xuICAgIHRoaXMuY29uZmlybVRleHQgPSBjb25maXJtVGV4dDtcbiAgICB0aGlzLmNvbmZpcm1DbHMgPSBjb25maXJtQ2xzO1xuICAgIHRoaXMub25Db25maXJtID0gb25Db25maXJtO1xuICAgIHRoaXMub25DYW5jZWwgPSBvbkNhbmNlbDtcbiAgICB0aGlzLmNvbmZpcm1lZCA9IGZhbHNlO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIHRoaXMubW9kYWxFbC5hZGRDbGFzcyhcImZyZWQtY29uZmlybS1kZWxldGUtbW9kYWxcIik7XG4gICAgZm9yIChjb25zdCB0ZXh0IG9mIHRoaXMucGFyYWdyYXBocykgY29udGVudEVsLmNyZWF0ZUVsKFwicFwiLCB7IHRleHQgfSk7XG5cbiAgICBjb25zdCBidXR0b25Sb3cgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcIm1vZGFsLWJ1dHRvbi1jb250YWluZXJcIiB9KTtcbiAgICBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkFiYnJlY2hlblwiIH0pLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xuXG4gICAgY29uc3QgY29uZmlybUJ0biA9IGJ1dHRvblJvdy5jcmVhdGVFbChcImJ1dHRvblwiLCB7IGNsczogdGhpcy5jb25maXJtQ2xzLCB0ZXh0OiB0aGlzLmNvbmZpcm1UZXh0IH0pO1xuICAgIGNvbmZpcm1CdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIHRoaXMuY29uZmlybWVkID0gdHJ1ZTtcbiAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgIHRoaXMub25Db25maXJtKCk7XG4gICAgfSk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gICAgaWYgKCF0aGlzLmNvbmZpcm1lZCkgdGhpcy5vbkNhbmNlbD8uKCk7XG4gIH1cbn1cblxuY2xhc3MgVHlwVmlldyBleHRlbmRzIEl0ZW1WaWV3IHtcbiAgY29uc3RydWN0b3IobGVhZiwgcGx1Z2luKSB7XG4gICAgc3VwZXIobGVhZik7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cblxuICBnZXRWaWV3VHlwZSgpIHtcbiAgICByZXR1cm4gVklFV19UWVBFX1RZUDtcbiAgfVxuXG4gIGdldERpc3BsYXlUZXh0KCkge1xuICAgIHJldHVybiBcIlRZUFwiO1xuICB9XG5cbiAgZ2V0SWNvbigpIHtcbiAgICByZXR1cm4gXCJzaGFwZXNcIjtcbiAgfVxuXG4gIGFzeW5jIG9uT3BlbigpIHtcbiAgICB0aGlzLmlzRWRpdGluZyA9IGZhbHNlO1xuICAgIHRoaXMuc2VsZWN0ZWRUeXBlID0gbnVsbDtcbiAgICB0aGlzLmZyb250bWF0dGVyRWRpdG9yID0gbnVsbDtcbiAgICB0aGlzLmZyb250bWF0dGVyRWRpdG9ycyA9IFtdO1xuXG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcbiAgICB0aGlzLmNvbnRlbnRFbC5hZGRDbGFzcyhcImZyZWQtdHlwLXZpZXdcIik7XG5cbiAgICB0aGlzLnJlZ2lzdGVyRG9tRXZlbnQodGhpcy5jb250ZW50RWwsIFwia2V5ZG93blwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRXNjYXBlXCIgJiYgdGhpcy5zZWxlY3RlZFR5cGUgIT09IG51bGwpIHRoaXMuY2xvc2VUeXBlU2V0dGluZ3MoKTtcbiAgICB9KTtcbiAgICB0aGlzLnJlbmRlcigpO1xuICB9XG5cbiAgYXN5bmMgb25DbG9zZSgpIHt9XG5cbiAgb3BlblNlYXJjaCh0eXBlKSB7XG4gICAgY29uc3QgZ2xvYmFsU2VhcmNoID0gdGhpcy5wbHVnaW4uYXBwLmludGVybmFsUGx1Z2lucy5nZXRQbHVnaW5CeUlkKFwiZ2xvYmFsLXNlYXJjaFwiKTtcbiAgICBpZiAoIWdsb2JhbFNlYXJjaCkgcmV0dXJuO1xuICAgIC8vIFwia2VpbiBUeXBcIiB0clx1MDBFNGZlIG9obmUgRmlsdGVyIGF1Y2ggYWxsZSBOaWNodC1NYXJrZG93bi1EYXRlaWVuIChkaWUgbmF0dXJnZW1cdTAwRTRcdTAwREZcbiAgICAvLyBuaWUgZWluZSBGcm9udG1hdHRlci1Qcm9wZXJ0eSBoYWJlbiBrXHUwMEY2bm5lbikgLSBkYWhlciBleHBsaXppdCBhdWYgLm1kIGVpbmdyZW56ZW4uXG4gICAgLy8gRlx1MDBGQ3IgZWluZSBMaXN0ZSAodW5yZWdpc3RyaWVydGVyIFNjaGxcdTAwRkNzc2VsIFwiW0EsIEJdXCIpIGdpYnQgZXMga2VpbmUgZXhha3RlXG4gICAgLy8gU3VjaHN5bnRheCAtIGRhbm4gbmFjaCBOb3RpemVuIHN1Y2hlbiwgZGllIGFsbGUgaWhyZSBFaW50clx1MDBFNGdlIHRyYWdlbi5cbiAgICBjb25zdCByYXcgPSB0eXBlID09PSBudWxsID8gdW5kZWZpbmVkIDogdGhpcy5wbHVnaW4udHlwSW5kZXgucmF3VmFsdWVPZih0eXBlKTtcbiAgICBjb25zdCBxdWVyeSA9XG4gICAgICB0eXBlID09PSBudWxsXG4gICAgICAgID8gYC1bXCIke1RZUF9QUk9QRVJUWX1cIl0gZmlsZToubWRgXG4gICAgICAgIDogQXJyYXkuaXNBcnJheShyYXcpXG4gICAgICAgICAgPyByYXcubWFwKCh2KSA9PiBgW1wiJHtUWVBfUFJPUEVSVFl9XCI6XCIke1N0cmluZyh2ID8/IFwiXCIpLnRyaW0oKX1cIl1gKS5qb2luKFwiIFwiKVxuICAgICAgICAgIDogYFtcIiR7VFlQX1BST1BFUlRZfVwiOlwiJHt0eXBlfVwiXWA7XG4gICAgZ2xvYmFsU2VhcmNoLmluc3RhbmNlLm9wZW5HbG9iYWxTZWFyY2gocXVlcnkpO1xuICB9XG5cbiAgLy8gdHlwZUtleSBrb21tdCAxOjEgYXVzIGRlbiB0YXRzXHUwMEU0Y2hsaWNoZW4gRnJvbnRtYXR0ZXItV2VydGVuIChzaWVoZVxuICAvLyB1bnJlZ2lzdGVyZWRSb3dzIGluIHJlbmRlcigpIHVuZCB0eXBlS2V5T2YgaW4gdHlwLWluZGV4LmpzKSAtIGthbm4gYWxzb1xuICAvLyBrbGVpbiBnZXNjaHJpZWJlbiBzZWluLCBSYW5kbGVlcnplaWNoZW4gdHJhZ2VuIG9kZXIgZWluZSBMaXN0ZSBzZWluLiBUWVBlblxuICAvLyB3ZXJkZW4gYWJlciBpbW1lciBhbHMgc2F1YmVyZXIgRWluemVsd2VydCBpbiBHcm9cdTAwREZidWNoc3RhYmVuIGdlZlx1MDBGQ2hydCAtXG4gIC8vIHJlZ2lzdHJpZXJ0IHdpcmQgZGVzaGFsYiBkaWUgYmVyZWluaWd0ZSBGb3JtIChzaWVoZSBub3JtYWxpemVSYXdUeXBlKSwgdW5kXG4gIC8vIGRpZSBiZXRyb2ZmZW5lbiBOb3RpemVuIHdlcmRlbiBnbGVpY2ggbWl0IHVtZ2VzY2hyaWViZW4sIGRhbWl0IHNpZSBuaWNodFxuICAvLyB3ZWl0ZXJoaW4gYWxzIFwibmljaHQgcmVnaXN0cmllcnRcIiBhdWZ0YXVjaGVuLlxuICBhc3luYyByZWdpc3RlclR5cGUodHlwZUtleSkge1xuICAgIGNvbnN0IHJhdyA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnJhd1ZhbHVlT2YodHlwZUtleSk7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVJhd1R5cGUocmF3ID09PSB1bmRlZmluZWQgPyB0eXBlS2V5IDogcmF3KTtcbiAgICBpZiAoIW5vcm1hbGl6ZWQpIHJldHVybjtcbiAgICBpZiAoIXRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVzLmluY2x1ZGVzKG5vcm1hbGl6ZWQpKSB7XG4gICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlcy5wdXNoKG5vcm1hbGl6ZWQpO1xuICAgIH1cblxuICAgIGxldCByZW5hbWVkID0gMDtcbiAgICBpZiAobm9ybWFsaXplZCAhPT0gdHlwZUtleSkge1xuICAgICAgcmVuYW1lZCA9IGF3YWl0IHJlbmFtZVR5cGVJbk5vdGVzKHRoaXMucGx1Z2luLCB0eXBlS2V5LCBub3JtYWxpemVkKTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICB0aGlzLnJlbmRlcigpO1xuICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuXG4gICAgaWYgKHJlbmFtZWQgPiAwKSB7XG4gICAgICBuZXcgTm90aWNlKGBUWVAgJHtub3JtYWxpemVkfSByZWdpc3RyaWVydCwgJHtyZW5hbWVkfSBOb3RpeihlbikgYW5nZXBhc3N0LmApO1xuICAgIH1cbiAgfVxuXG4gIC8vIE5ldWVzLCBsZWVyZXMgVHJlZS1JdGVtIGFubGVnZW4gdW5kIHNvZm9ydCBpbiBkZW4gRWRpdGllci1Nb2R1cyB2ZXJzZXR6ZW4gLVxuICAvLyB3aWUgYmVpIE9ic2lkaWFucyBlaWdlbmVuIFZpZXdzICh6LiBCLiBuZXVlIEJvb2ttYXJrLUdydXBwZSkuXG4gIHN0YXJ0QWRkKCkge1xuICAgIGlmICh0aGlzLmlzRWRpdGluZykgcmV0dXJuO1xuXG4gICAgY29uc3QgdHJlZUl0ZW0gPSB0aGlzLmxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtXCIgfSk7XG4gICAgaWYgKHRoaXMuc2VwYXJhdG9yRWwpIHRoaXMubGlzdEVsLmluc2VydEJlZm9yZSh0cmVlSXRlbSwgdGhpcy5zZXBhcmF0b3JFbCk7XG4gICAgY29uc3Qgc2VsZiA9IHRyZWVJdGVtLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0tc2VsZiBpcy1jbGlja2FibGVcIiB9KTtcbiAgICBjb25zdCBpbm5lciA9IHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1pbm5lclwiIH0pO1xuXG4gICAgdGhpcy5zdGFydEVkaXRpbmcobnVsbCwgc2VsZiwgaW5uZXIpO1xuICB9XG5cbiAgLy8gV2llIE9ic2lkaWFucyBlaWdlbmUgVHJlZS1JdGVtczoga2VpbiB6dXNcdTAwRTR0emxpY2hlcyBJbnB1dC1FbGVtZW50LCBzb25kZXJuXG4gIC8vIGRhcyBiZXN0ZWhlbmRlIFRleHQtRWxlbWVudCB3aXJkIHNlbGJzdCBlZGl0aWVyYmFyIChjb250ZW50ZWRpdGFibGUpLlxuICAvLyB0eXBlID09PSBudWxsIFx1MjE5MiBuZXVlciBFaW50cmFnLCBzb25zdCBVbWJlbmVubmVuIGRlcyBcdTAwRkNiZXJnZWJlbmVuIFR5cHMuXG4gIHN0YXJ0RWRpdGluZyh0eXBlLCBzZWxmLCBpbm5lcikge1xuICAgIGlmICh0aGlzLmlzRWRpdGluZykgcmV0dXJuO1xuICAgIHRoaXMuaXNFZGl0aW5nID0gdHJ1ZTtcblxuICAgIHNlbGYuYWRkQ2xhc3MoXCJpcy1iZWluZy1yZW5hbWVkXCIpO1xuICAgIGlubmVyLnNldEF0dHJpYnV0ZShcImNvbnRlbnRlZGl0YWJsZVwiLCBcInRydWVcIik7XG4gICAgaW5uZXIuc2V0QXR0cmlidXRlKFwic3BlbGxjaGVja1wiLCBcImZhbHNlXCIpO1xuICAgIGlubmVyLmZvY3VzKCk7XG5cbiAgICBjb25zdCByYW5nZSA9IGlubmVyLmRvYy5jcmVhdGVSYW5nZSgpO1xuICAgIHJhbmdlLnNlbGVjdE5vZGVDb250ZW50cyhpbm5lcik7XG4gICAgY29uc3Qgc2VsZWN0aW9uID0gaW5uZXIud2luLmdldFNlbGVjdGlvbigpO1xuICAgIHNlbGVjdGlvbi5yZW1vdmVBbGxSYW5nZXMoKTtcbiAgICBzZWxlY3Rpb24uYWRkUmFuZ2UocmFuZ2UpO1xuXG4gICAgbGV0IGRvbmUgPSBmYWxzZTtcbiAgICBjb25zdCBmaW5pc2ggPSBhc3luYyAoY29tbWl0KSA9PiB7XG4gICAgICBpZiAoZG9uZSkgcmV0dXJuO1xuICAgICAgZG9uZSA9IHRydWU7XG4gICAgICB0aGlzLmlzRWRpdGluZyA9IGZhbHNlO1xuXG4gICAgICBjb25zdCB2YWx1ZSA9IG5vcm1hbGl6ZVR5cGVOYW1lKGlubmVyLnRleHRDb250ZW50KTtcbiAgICAgIGlmIChjb21taXQgJiYgdmFsdWUgJiYgdmFsdWUgIT09IHR5cGUpIHtcbiAgICAgICAgY29uc3QgZXhpc3RzID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXMuc29tZShcbiAgICAgICAgICAodCkgPT4gdC50b0xvd2VyQ2FzZSgpID09PSB2YWx1ZS50b0xvd2VyQ2FzZSgpICYmIHQgIT09IHR5cGVcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKCFleGlzdHMpIHtcbiAgICAgICAgICBpZiAodHlwZSA9PT0gbnVsbCkge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXMucHVzaCh2YWx1ZSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IGlkeCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVzLmluZGV4T2YodHlwZSk7XG4gICAgICAgICAgICBpZiAoaWR4ICE9PSAtMSkgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXNbaWR4XSA9IHZhbHVlO1xuICAgICAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV07XG4gICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV07XG4gICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3R5cGVdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV07XG4gICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV07XG4gICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHRoaXMuZW5zdXJlVHlwZU1hbnVhbCgpW3R5cGVdICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZU1hbnVhbFt2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlTWFudWFsW3R5cGVdO1xuICAgICAgICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZU1hbnVhbFt0eXBlXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIG1vdmVUeXBlU3VidHlwZXModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUsIHZhbHVlKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgfTtcblxuICAgIGlubmVyLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIChldmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmtleSA9PT0gXCJFbnRlclwiKSB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGZpbmlzaCh0cnVlKTtcbiAgICAgIH0gZWxzZSBpZiAoZXZlbnQua2V5ID09PSBcIkVzY2FwZVwiKSB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGZpbmlzaChmYWxzZSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBpbm5lci5hZGRFdmVudExpc3RlbmVyKFwiYmx1clwiLCAoKSA9PiBmaW5pc2godHJ1ZSkpO1xuICB9XG5cbiAgb3BlblR5cGVTZXR0aW5ncyh0eXBlKSB7XG4gICAgdGhpcy5zZWxlY3RlZFR5cGUgPSB0eXBlO1xuICAgIHRoaXMucmVuZGVyKCk7XG4gIH1cblxuICBjbG9zZVR5cGVTZXR0aW5ncygpIHtcbiAgICB0aGlzLnNlbGVjdGVkVHlwZSA9IG51bGw7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfVxuXG4gIC8vIFdpcmQgYWxzIENvbXBvbmVudC1DaGlsZCBnZWxhZGVuIChzaWVoZSBtb3VudEZyb250bWF0dGVyRWRpdG9yKSB1bmQgbXVzc1xuICAvLyBkZXNoYWxiIHZvciBqZWRlbSBOZXVhdWZiYXUgZGVyIERldGFpbC1BbnNpY2h0IGV4cGxpeml0IGVudGxhZGVuIHdlcmRlbiAtXG4gIC8vIGNvbnRlbnRFbC5lbXB0eSgpIGFsbGVpbiB3XHUwMEZDcmRlIG51ciBkaWUgRE9NLUVsZW1lbnRlIGVudGZlcm5lbiwgbmljaHQgYWJlclxuICAvLyBkZW4gZGFyYXVmIHJlZ2lzdHJpZXJ0ZW4gbWV0YWRhdGFUeXBlTWFuYWdlci1MaXN0ZW5lciBkZXIgRWRpdG9yLUluc3RhbnouXG4gIC8vIGZyb250bWF0dGVyRWRpdG9yIGlzdCBkZXIgRWRpdG9yIGRlcyBUWVAtQmxvY2tzICh1LiBhLiBmXHUwMEZDciBkZW4gQmVmZWhsXG4gIC8vIFwiU3RhbmRhcmQtUHJvcGVydHkgaGluenVmXHUwMEZDZ2VuXCIpLCBmcm9udG1hdHRlckVkaXRvcnMgYWxsZSBFZGl0b3JlbiBkZXJcbiAgLy8gRGV0YWlsYW5zaWNodCBpbmtsLiBkZXIgU3VidHlwLUJsXHUwMEY2Y2tlLlxuICBkZXN0cm95RnJvbnRtYXR0ZXJFZGl0b3IoKSB7XG4gICAgZm9yIChjb25zdCBlZGl0b3Igb2YgdGhpcy5mcm9udG1hdHRlckVkaXRvcnMgPz8gW10pIHRoaXMucmVtb3ZlQ2hpbGQoZWRpdG9yKTtcbiAgICB0aGlzLmZyb250bWF0dGVyRWRpdG9ycyA9IFtdO1xuICAgIHRoaXMuZnJvbnRtYXR0ZXJFZGl0b3IgPSBudWxsO1xuICB9XG5cbiAgcmVuZGVyKCkge1xuICAgIC8vIFJlZW50cmFuY3ktR3VhcmQ6IHJlbmRlclR5cGVTZXR0aW5ncygpIGxcdTAwRjZzdCBhbSBFbmRlIHNlbGJzdFxuICAgIC8vIHBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzKCkgYXVzIChzaWVoZSBkb3J0aWdlciBLb21tZW50YXIpLCB3YXMgdS4gYS5cbiAgICAvLyBcdTAwRkNiZXIgcmVnaXN0ZXJUeXBWaWV3IHdpZWRlcnVtIHJlbmRlcigpIGF1ZiBhbGxlbiBUWVAtVmlldy1MZWF2ZXNcbiAgICAvLyBhdWZydWZ0IC0gaW5rbHVzaXZlIGRpZXNlbSwgd1x1MDBFNGhyZW5kIGVzIG5vY2ggbWl0dGVuIGluIGdlbmF1IGRpZXNlbVxuICAgIC8vIEF1ZnJ1ZiBzdGVja3QuIE9obmUgR3VhcmQgcmVrdXJzaWVydCBkYXMgc3luY2hyb24gb2huZSBBYmJydWNoIGJpc1xuICAgIC8vIHp1bSBTdGFjayBPdmVyZmxvdywgYmVpIGplZGVtIFx1MDBENmZmbmVuL1VtYmVuZW5uZW4gZWluZXMgVFlQcy5cbiAgICBpZiAodGhpcy5fcmVuZGVyaW5nKSByZXR1cm47XG4gICAgdGhpcy5fcmVuZGVyaW5nID0gdHJ1ZTtcbiAgICB0cnkge1xuICAgICAgdGhpcy5kZXN0cm95RnJvbnRtYXR0ZXJFZGl0b3IoKTtcbiAgICAgIGlmICh0aGlzLnNlbGVjdGVkVHlwZSAhPT0gbnVsbCkge1xuICAgICAgICB0aGlzLnJlbmRlclR5cGVTZXR0aW5ncyh0aGlzLnNlbGVjdGVkVHlwZSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgICBjb250ZW50RWwuZW1wdHkoKTtcblxuICAgICAgY29uc3QgeyBjb3VudHMsIG5vVHlwZSB9ID0gdGhpcy5wbHVnaW4udHlwSW5kZXgudHlwZUNvdW50cygpO1xuICAgICAgY29uc3QgcmVnaXN0ZXJlZCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVzO1xuICAgICAgY29uc3QgdHlwZUNvbG9ycyA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnM7XG4gICAgICBjb25zdCBzb3J0T3JkZXIgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBTb3J0T3JkZXIgPz8gREVGQVVMVF9TT1JUX09SREVSO1xuICAgICAgY29uc3QgaXNNYW51YWxTb3J0ID0gc29ydE9yZGVyID09PSBcIm1hbnVhbFwiO1xuICAgICAgY29uc3QgYnlDdXJyZW50T3JkZXIgPSAoYSwgYikgPT4gY29tcGFyZVR5cGVzKHNvcnRPcmRlciwgYSwgYiwgY291bnRzLCB0eXBlQ29sb3JzKTtcblxuICAgICAgdGhpcy5yZW5kZXJMaXN0SGVhZGVyKGNvbnRlbnRFbCk7XG5cbiAgICAgIC8vIFwiW0tFSU4gVFlQXVwiIGlzdCBrZWluIGVjaHRlciBUeXAgdW5kIG5pbW10IGFuIGRlciBTb3J0aWVydW5nIG5pY2h0IHRlaWwgLVxuICAgICAgLy8gc3RlaHQgdW5hYmhcdTAwRTRuZ2lnIHZvbiBzZWluZXIgQW56YWhsIGltbWVyIHp1bGV0enQuXG4gICAgICBjb25zdCB1bnJlZ2lzdGVyZWRSb3dzID0gWy4uLmNvdW50cy5rZXlzKCldXG4gICAgICAgIC5maWx0ZXIoKHR5cGUpID0+ICFyZWdpc3RlcmVkLmluY2x1ZGVzKHR5cGUpKVxuICAgICAgICAuc29ydChieUN1cnJlbnRPcmRlcilcbiAgICAgICAgLm1hcCgodHlwZSkgPT4gKHsgdHlwZSwgY291bnQ6IGNvdW50cy5nZXQodHlwZSkgPz8gMCB9KSk7XG4gICAgICBpZiAobm9UeXBlID4gMCkge1xuICAgICAgICB1bnJlZ2lzdGVyZWRSb3dzLnB1c2goeyB0eXBlOiBudWxsLCBjb3VudDogbm9UeXBlIH0pO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBsaXN0Q2xzID0gXCJmcmVkLXR5cC1saXN0IG5hdi1maWxlcy1jb250YWluZXJcIiArICh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBMaXN0RGVzY3JpcHRpb25FbmFibGVkID8gXCJcIiA6IFwiIGZyZWQtdHlwLWxpc3Qtbm8tZGVzY3JpcHRpb25cIik7XG4gICAgICB0aGlzLmxpc3RFbCA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IGxpc3RDbHMgfSk7XG4gICAgICB0aGlzLnNlcGFyYXRvckVsID0gbnVsbDtcblxuICAgICAgLy8gc29ydFR5cGVzQnlNb2RlKCkgbFx1MDBFNHNzdCBpbSBNYW51ZWxsLU1vZHVzIGJld3Vzc3QgZGllIFJlaWhlbmZvbGdlIHZvblxuICAgICAgLy8gcGx1Z2luLnNldHRpbmdzLnR5cGVzIHVuYW5nZXRhc3RldCAtIHBlciBEcmFnICYgRHJvcCBpblxuICAgICAgLy8gcmVuZGVyUmVnaXN0ZXJlZEl0ZW0oKSB1bXNvcnRpZXJ0LiBEZXIgaW5kZXggd2lyZCBkYWZcdTAwRkNyIDE6MSBhbHNcbiAgICAgIC8vIFBvc2l0aW9uIGluIGRpZXNlciAoaW4gZGllc2VtIE1vZHVzIHVudmVyXHUwMEU0bmRlcnRlbikgUmVpaGVuZm9sZ2VcbiAgICAgIC8vIHdlaXRlcmdlZ2ViZW4uXG4gICAgICBjb25zdCByZWdpc3RlcmVkT3JkZXIgPSBzb3J0VHlwZXNCeU1vZGUocmVnaXN0ZXJlZCwgc29ydE9yZGVyLCBjb3VudHMsIHR5cGVDb2xvcnMpO1xuICAgICAgcmVnaXN0ZXJlZE9yZGVyLmZvckVhY2goKHR5cGUsIGluZGV4KSA9PiB7XG4gICAgICAgIHRoaXMucmVuZGVyUmVnaXN0ZXJlZEl0ZW0odHlwZSwgY291bnRzLmdldCh0eXBlKSA/PyAwLCB7IGRyYWdnYWJsZTogaXNNYW51YWxTb3J0LCBpbmRleCB9KTtcbiAgICAgIH0pO1xuXG4gICAgICBpZiAodW5yZWdpc3RlcmVkUm93cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHRoaXMuc2VwYXJhdG9yRWwgPSB0aGlzLmxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtc2VwYXJhdG9yXCIgfSk7XG4gICAgICAgIGZvciAoY29uc3Qgcm93IG9mIHVucmVnaXN0ZXJlZFJvd3MpIHtcbiAgICAgICAgICBpZiAocm93LnR5cGUgPT09IG51bGwpIHRoaXMucmVuZGVyTm9UeXBlSXRlbShyb3cuY291bnQpO1xuICAgICAgICAgIGVsc2UgdGhpcy5yZW5kZXJVbnJlZ2lzdGVyZWRJdGVtKHJvdy50eXBlLCByb3cuY291bnQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX3JlbmRlcmluZyA9IGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIC8vIFdpZSBkZXIgXCJDaGFuZ2Ugc29ydCBvcmRlclwiLUJ1dHRvbiBpbiBPYnNpZGlhbnMgVGFncy0gYnp3LiBBbGwtUHJvcGVydGllcy1WaWV3LlxuICByZW5kZXJMaXN0SGVhZGVyKGNvbnRlbnRFbCkge1xuICAgIGNvbnN0IGhlYWRlciA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibmF2LWhlYWRlclwiIH0pO1xuICAgIGNvbnN0IGJ1dHRvbnNDb250YWluZXIgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcIm5hdi1idXR0b25zLWNvbnRhaW5lclwiIH0pO1xuXG4gICAgY29uc3QgYWRkQnRuID0gYnV0dG9uc0NvbnRhaW5lci5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIG5hdi1hY3Rpb24tYnV0dG9uXCIsXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIk5ldWVuIFR5cCBoaW56dWZcdTAwRkNnZW5cIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24oYWRkQnRuLCBcInBsdXNcIik7XG4gICAgYWRkQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnN0YXJ0QWRkKCkpO1xuXG4gICAgY29uc3Qgc29ydEJ0biA9IGJ1dHRvbnNDb250YWluZXIuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiBuYXYtYWN0aW9uLWJ1dHRvblwiLFxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJTb3J0aWVycmVpaGVuZm9sZ2UgXHUwMEU0bmRlcm5cIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24oc29ydEJ0biwgXCJsdWNpZGUtc29ydC1hc2NcIik7XG4gICAgc29ydEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB0aGlzLnNob3dTb3J0TWVudShldmVudCkpO1xuICB9XG5cbiAgc2hvd1NvcnRNZW51KGV2ZW50KSB7XG4gICAgY29uc3QgY3VycmVudCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cFNvcnRPcmRlciA/PyBERUZBVUxUX1NPUlRfT1JERVI7XG4gICAgY29uc3QgbWVudSA9IG5ldyBNZW51KCk7XG5cbiAgICBjb25zdCBhZGRHcm91cCA9IChzdGFydCwgZW5kKSA9PiB7XG4gICAgICBmb3IgKGxldCBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgICAgICBjb25zdCB7IG1vZGUsIHRpdGxlIH0gPSBTT1JUX09QVElPTlNbaV07XG4gICAgICAgIG1lbnUuYWRkSXRlbSgoaXRlbSkgPT5cbiAgICAgICAgICBpdGVtXG4gICAgICAgICAgICAuc2V0VGl0bGUodGl0bGUpXG4gICAgICAgICAgICAuc2V0Q2hlY2tlZChjdXJyZW50ID09PSBtb2RlKVxuICAgICAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBTb3J0T3JkZXIgPSBtb2RlO1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfTtcblxuICAgIGFkZEdyb3VwKDAsIDEpO1xuICAgIG1lbnUuYWRkU2VwYXJhdG9yKCk7XG4gICAgYWRkR3JvdXAoMSwgMyk7XG4gICAgbWVudS5hZGRTZXBhcmF0b3IoKTtcbiAgICBhZGRHcm91cCgzLCA1KTtcbiAgICBtZW51LmFkZFNlcGFyYXRvcigpO1xuICAgIGFkZEdyb3VwKDUsIDcpO1xuXG4gICAgbWVudS5zaG93QXRNb3VzZUV2ZW50KGV2ZW50KTtcbiAgfVxuXG4gIHJlbmRlck5vVHlwZUl0ZW0oY291bnQpIHtcbiAgICBjb25zdCB0cmVlSXRlbSA9IHRoaXMubGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW1cIiB9KTtcbiAgICBjb25zdCBzZWxmID0gdHJlZUl0ZW0uY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1zZWxmIGlzLWNsaWNrYWJsZSBmcmVkLXR5cC11bnJlZ2lzdGVyZWRcIiB9KTtcbiAgICBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0taW5uZXJcIiwgdGV4dDogXCJbS0VJTiBUWVBdXCIgfSk7XG4gICAgdGhpcy5yZW5kZXJDb3VudEZsYWlyKHNlbGYsIGNvdW50KTtcblxuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMub3BlblNlYXJjaChudWxsKSk7XG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY29udGV4dG1lbnVcIiwgKGV2ZW50KSA9PiB7XG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICB0aGlzLm9wZW5TZWFyY2gobnVsbCk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBDaHJvbWl1bXMgaW5wdXRbdHlwZT1jb2xvcl0gaGF0IGVpbmVuIGVpZ2VuZW4gTWluZGVzdC1Td2F0Y2gsIGRlciBzaWNoIG5pY2h0XG4gIC8vIHVudGVyIFRleHRnclx1MDBGNlx1MDBERmUgc2thbGllcmVuIGxcdTAwRTRzc3QgLSBkYWhlciBudXIgYWxzIHVuc2ljaHRiYXJlbiBQaWNrZXItVHJpZ2dlclxuICAvLyBcdTAwRkNiZXIgZGVtIGZyZWkgc2thbGllcmJhcmVuIFB1bmt0IHBsYXR6aWVyZW4uXG4gIHJlbmRlckNvbG9yUGlja2VyKHBhcmVudCwgdHlwZSwgb25DaGFuZ2UsIHsgc2hvd1Jlc2V0ID0gZmFsc2UgfSA9IHt9KSB7XG4gICAgY29uc3QgY3VycmVudENvbG9yID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXSA/PyBERUZBVUxUX1RZUEVfQ09MT1I7XG4gICAgY29uc3QgY29sb3JXcmFwID0gcGFyZW50LmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1jb2xvci13cmFwXCIgfSk7XG4gICAgY29uc3QgY29sb3JEb3QgPSBjb2xvcldyYXAuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWNvbG9yLWRvdFwiIH0pO1xuICAgIGNvbG9yRG90LnN0eWxlLmJhY2tncm91bmRDb2xvciA9IGN1cnJlbnRDb2xvcjtcblxuICAgIGNvbnN0IGNvbG9ySW5wdXQgPSBjb2xvcldyYXAuY3JlYXRlRWwoXCJpbnB1dFwiLCB7IHR5cGU6IFwiY29sb3JcIiwgY2xzOiBcImZyZWQtdHlwLWNvbG9yLWlucHV0XCIgfSk7XG4gICAgY29sb3JJbnB1dC52YWx1ZSA9IGN1cnJlbnRDb2xvcjtcbiAgICBjb2xvcklucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpKTtcblxuICAgIC8vIFwiaW5wdXRcIiBmZXVlcnQgYmVpIGplZGVyIFp3aXNjaGVuZmFyYmUsIHdcdTAwRTRocmVuZCBkZXIgbmF0aXZlIFBpY2tlciBub2NoXG4gICAgLy8gb2ZmZW4gaXN0IC0gaGllciBudXIgbG9rYWxlIFZvcnNjaGF1IChQdW5rdCwgZ2dmLiBOYW1lIHZpYSBvbkNoYW5nZSksIG9obmVcbiAgICAvLyBkaWUgXHUwMEZDYnJpZ2VuIFZpZXdzIChEYXRlaS1FeHBsb3JlciwgR3JhcGgsIC4uLikgbmV1IHp1IHJlbmRlcm46XG4gICAgLy8gcmVmcmVzaFR5cENvbG9ycygpIGxcdTAwRjZzdCBkYWZcdTAwRkNyIHUuIGEuIHJlbmRlcigpIGF1ZiBkaWVzZXIgVFlQLVZpZXcgc2VsYnN0XG4gICAgLy8gYXVzLCB3YXMgZGllc2VzIDxpbnB1dCB0eXBlPWNvbG9yPiBhdXMgZGVtIERPTSBlbnRmZXJuZW4gdW5kIGRlbiBuYXRpdmVuXG4gICAgLy8gUGlja2VyIGRhbWl0IHNvZm9ydCBzY2hsaWVcdTAwREZlbiB3XHUwMEZDcmRlIC0gbm9jaCBiZXZvciBtYW4gXHUwMEZDYmVyaGF1cHQgZWluZSBGYXJiZVxuICAgIC8vIGF1c3dcdTAwRTRobGVuIGthbm4gKHNjaG9uIGJlaW0gZXJzdGVuIEtsaWNrLCB2b3IgZGVtIExvc2xhc3NlbiBkZXIgVGFzdGUpLlxuICAgIGNvbG9ySW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImlucHV0XCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbG9yRG90LnN0eWxlLmJhY2tncm91bmRDb2xvciA9IGNvbG9ySW5wdXQudmFsdWU7XG4gICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdID0gY29sb3JJbnB1dC52YWx1ZTtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgb25DaGFuZ2U/Lihjb2xvcklucHV0LnZhbHVlKTtcbiAgICB9KTtcblxuICAgIC8vIEVyc3Qgd2VubiBkaWUgQXVzd2FobCBiZXN0XHUwMEU0dGlndCB1bmQgZGVyIG5hdGl2ZSBQaWNrZXIgZGFkdXJjaCBnZXNjaGxvc3NlblxuICAgIC8vIHdpcmQsIGRpZSBcdTAwRkNicmlnZW4gVmlld3MgbmFjaHppZWhlbiAtIGFuIGRlbSBQdW5rdCBrYW5uIGVpbiBOZXUtUmVuZGVyblxuICAgIC8vIGRpZXNlciBUWVAtVmlldyBzZWxic3QgbmljaHRzIG1laHIga2FwdXR0IG1hY2hlbi5cbiAgICBjb2xvcklucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgKCkgPT4gdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCkpO1xuXG4gICAgaWYgKHNob3dSZXNldCkge1xuICAgICAgY29uc3QgcmVzZXRCdG4gPSBwYXJlbnQuY3JlYXRlRGl2KHtcbiAgICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWNvbG9yLXJlc2V0XCIsXG4gICAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiRmFyYmUgenVyXHUwMEZDY2tzZXR6ZW5cIiB9LFxuICAgICAgfSk7XG4gICAgICBzZXRJY29uKHJlc2V0QnRuLCBcInJvdGF0ZS1jY3dcIik7XG4gICAgICByZXNldEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXTtcbiAgICAgICAgY29sb3JJbnB1dC52YWx1ZSA9IERFRkFVTFRfVFlQRV9DT0xPUjtcbiAgICAgICAgY29sb3JEb3Quc3R5bGUuYmFja2dyb3VuZENvbG9yID0gREVGQVVMVF9UWVBFX0NPTE9SO1xuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgIG9uQ2hhbmdlPy4oREVGQVVMVF9UWVBFX0NPTE9SKTtcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHJldHVybiBjb2xvcldyYXA7XG4gIH1cblxuICAvLyBGXHUwMEU0bmd0IEJlc3RhbmRzaW5zdGFsbGF0aW9uZW4gYWIsIGRlcmVuIHNldHRpbmdzLU9iamVrdCBzY2hvbiB2b3IgRWluZlx1MDBGQ2hydW5nXG4gIC8vIHZvbiB0eXBlTWFudWFsIGdlbGFkZW4gd3VyZGUgKHouIEIuIGxhdWZlbmRlIFNlc3Npb24gdm9yIGVpbmVtIHZvbGxzdFx1MDBFNG5kaWdlblxuICAvLyBQbHVnaW4tUmVsb2FkIG5hY2ggSG90LVJlbG9hZCkgLSBvaG5lIGRhcyB3XHUwMEZDcmRlIGplZGVyIFp1Z3JpZmYgdW50ZW4gbWl0XG4gIC8vIFwiQ2Fubm90IHJlYWQgcHJvcGVydGllcyBvZiB1bmRlZmluZWRcIiBhYmJyZWNoZW4gdW5kIGRhYmVpIGRlbiBnZXNhbXRlblxuICAvLyByZXN0bGljaGVuIHJlbmRlclR5cGVTZXR0aW5ncygpLUF1ZnJ1ZiAoRmFyYmUsIEJlc2NocmVpYnVuZywgRnJvbnRtYXR0ZXIpXG4gIC8vIG1pdCBzaWNoIHJlaVx1MDBERmVuLCBkYSBkZXIgRmVobGVyIHN5bmNocm9uIG1pdHRlbiBpbiBkZXIgRnVua3Rpb24gYXVmdHJpdHQuXG4gIGVuc3VyZVR5cGVNYW51YWwoKSB7XG4gICAgaWYgKCF0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlTWFudWFsKSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlTWFudWFsID0ge307XG4gICAgcmV0dXJuIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVNYW51YWw7XG4gIH1cblxuICAvLyBOYWNoZ2ViYXV0IHdpZSBPYnNpZGlhbnMgZWlnZW5lciBUb2dnbGVDb21wb25lbnQgKGNoZWNrYm94LWNvbnRhaW5lciArXG4gIC8vIHZlcnN0ZWNrdGVzIGlucHV0W3R5cGU9Y2hlY2tib3hdKSwgZGEgd2lyIGhpZXIgZGlyZWt0IGltIERPTSBzdGF0dCBcdTAwRkNiZXJcbiAgLy8gZGllIFNldHRpbmctQVBJIGJhdWVuLiBTdGFuZGFyZG1cdTAwRTRcdTAwREZpZyBhbiAtIGRhaGVyIHdpcmQgKHdpZSBiZWkgZGVuIGFuZGVyZW5cbiAgLy8gdHlwZVh4eC1EaWN0cykgbnVyIGRpZSBBYndlaWNodW5nIHZvbSBEZWZhdWx0IGdlc3BlaWNoZXJ0LCBoaWVyIGFsc28gbnVyXG4gIC8vIFwiYXVzXCIgKGZhbHNlKTsgZmVobGVuZGVyIEVpbnRyYWcgYnp3LiB0cnVlIGJlZGV1dGVuIFwiYW5cIi4gU3RldWVydCwgb2IgZWluXG4gIC8vIFRZUCBpbiBnZXRUeXBlcygpIChzaWVoZSBtYWluLmpzKSBleHBvcnRpZXJ0IHdpcmQsIHNpZWhlIGRvcnRpZ2VyIEtvbW1lbnRhci5cbiAgcmVuZGVyTWFudWFsVG9nZ2xlKHBhcmVudCwgdHlwZSkge1xuICAgIGNvbnN0IGN1cnJlbnQgPSB0aGlzLmVuc3VyZVR5cGVNYW51YWwoKVt0eXBlXSAhPT0gZmFsc2U7XG4gICAgY29uc3QgdG9nZ2xlRWwgPSBwYXJlbnQuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJjaGVja2JveC1jb250YWluZXJcIiArIChjdXJyZW50ID8gXCIgaXMtZW5hYmxlZFwiIDogXCJcIiksXG4gICAgICBhdHRyOiB7IHRhYmluZGV4OiBcIjBcIiwgcm9sZTogXCJjaGVja2JveFwiLCBcImFyaWEtY2hlY2tlZFwiOiBTdHJpbmcoY3VycmVudCkgfSxcbiAgICB9KTtcbiAgICB0b2dnbGVFbC5jcmVhdGVFbChcImlucHV0XCIsIHsgdHlwZTogXCJjaGVja2JveFwiIH0pO1xuXG4gICAgY29uc3QgdG9nZ2xlID0gYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgbmV4dCA9ICF0b2dnbGVFbC5oYXNDbGFzcyhcImlzLWVuYWJsZWRcIik7XG4gICAgICB0b2dnbGVFbC50b2dnbGVDbGFzcyhcImlzLWVuYWJsZWRcIiwgbmV4dCk7XG4gICAgICB0b2dnbGVFbC5zZXRBdHRyaWJ1dGUoXCJhcmlhLWNoZWNrZWRcIiwgU3RyaW5nKG5leHQpKTtcbiAgICAgIGlmIChuZXh0KSBkZWxldGUgdGhpcy5lbnN1cmVUeXBlTWFudWFsKClbdHlwZV07XG4gICAgICBlbHNlIHRoaXMuZW5zdXJlVHlwZU1hbnVhbCgpW3R5cGVdID0gZmFsc2U7XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICB9O1xuXG4gICAgdG9nZ2xlRWwuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIHRvZ2dsZSk7XG4gICAgdG9nZ2xlRWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVudGVyXCIgfHwgZXZlbnQua2V5ID09PSBcIiBcIikge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICB0b2dnbGUoKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiB0b2dnbGVFbDtcbiAgfVxuXG4gIHJlbmRlclJlZ2lzdGVyZWRJdGVtKHR5cGUsIGNvdW50LCB7IGRyYWdnYWJsZSA9IGZhbHNlLCBpbmRleCA9IC0xIH0gPSB7fSkge1xuICAgIGNvbnN0IHRyZWVJdGVtID0gdGhpcy5saXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbVwiIH0pO1xuICAgIGNvbnN0IHNlbGYgPSB0cmVlSXRlbS5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLXNlbGYgaXMtY2xpY2thYmxlXCIgfSk7XG5cbiAgICBsZXQgbmFtZUVsO1xuICAgIHRoaXMucmVuZGVyQ29sb3JQaWNrZXIoc2VsZiwgdHlwZSwgKG5ld0NvbG9yKSA9PiB7XG4gICAgICBpZiAobmFtZUVsICYmIHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdCkgbmFtZUVsLnN0eWxlLmNvbG9yID0gbmV3Q29sb3I7XG4gICAgfSk7XG5cbiAgICBuYW1lRWwgPSBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0taW5uZXJcIiwgdGV4dDogdHlwZSB9KTtcbiAgICBjb25zdCBjb2xvciA9IHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdCA/IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV0gOiBudWxsO1xuICAgIGlmIChjb2xvcikgbmFtZUVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG5cbiAgICAvLyBFY2h0ZXMgVGV4dC1JbnB1dCBzdGF0dCBudXIgQW56ZWlnZTogZGlyZWt0IGluIGRlciBMaXN0ZSBiZWFyYmVpdGJhciwgb2huZVxuICAgIC8vIGRhZlx1MDBGQ3IgZXJzdCBkaWUgRGV0YWlsYW5zaWNodCBcdTAwRjZmZm5lbiB6dSBtXHUwMEZDc3Nlbi4gY2xpY2sgaGllciBtdXNzIGRpZSBaZWlsZVxuICAgIC8vIHNlbGJzdCBnZXppZWx0IE5JQ0hUIGF1c2xcdTAwRjZzZW4gKHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIC4uLikgdW50ZW5cbiAgICAvLyBcdTAwRjZmZm5ldCBzb25zdCBkaWUgRGV0YWlsYW5zaWNodCksIGRhaGVyIHN0b3BQcm9wYWdhdGlvbi4gXHUwMERDYmVyIGRpZSBFaW5zdGVsbHVuZ1xuICAgIC8vIFwiQmVzY2hyZWlidW5ncy1UZXh0ZmVsZCBhbnplaWdlblwiIGtvbXBsZXR0IGF1c3N0ZWxsYmFyLlxuICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBMaXN0RGVzY3JpcHRpb25FbmFibGVkKSB7XG4gICAgICBjb25zdCBkZXNjSW5wdXQgPSBzZWxmLmNyZWF0ZUVsKFwiaW5wdXRcIiwge1xuICAgICAgICB0eXBlOiBcInRleHRcIixcbiAgICAgICAgY2xzOiBcImZyZWQtdHlwLWxpc3QtZGVzY3JpcHRpb24taW5wdXRcIixcbiAgICAgIH0pO1xuICAgICAgZGVzY0lucHV0LnZhbHVlID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXSA/PyBcIlwiO1xuICAgICAgZGVzY0lucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpKTtcbiAgICAgIGRlc2NJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgY29uc3QgdmFsdWUgPSBkZXNjSW5wdXQudmFsdWUudHJpbSgpO1xuICAgICAgICBpZiAodmFsdWUpIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV0gPSB2YWx1ZTtcbiAgICAgICAgZWxzZSBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXTtcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICB0aGlzLnJlbmRlckNvdW50RmxhaXIoc2VsZiwgY291bnQpO1xuXG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgaWYgKHRoaXMuaXNFZGl0aW5nKSByZXR1cm47XG4gICAgICB0aGlzLm9wZW5UeXBlU2V0dGluZ3ModHlwZSk7XG4gICAgfSk7XG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY29udGV4dG1lbnVcIiwgKGV2ZW50KSA9PiB7XG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICB0aGlzLm9wZW5TZWFyY2godHlwZSk7XG4gICAgfSk7XG5cbiAgICAvLyBOdXIgaW0gTWFudWVsbC1Tb3J0aWVybW9kdXMgYWt0aXYgKHNpZWhlIHJlbmRlcigpKSAtIGRpZSBnYW56ZSBaZWlsZSBpc3RcbiAgICAvLyBkYW5uIHBlciBEcmFnICYgRHJvcCB2ZXJzY2hpZWJiYXIgKGVpbiBEcmFnLCBkZXIgYXVmIGRlbSBGYXJicHVua3Qgb2RlclxuICAgIC8vIGltIEJlc2NocmVpYnVuZ3NmZWxkIGJlZ2lubnQsIGdyZWlmdCB0cm90emRlbSBuaWNodCAtIGRpZXNlIEVsZW1lbnRlXG4gICAgLy8gbmVobWVuIGRlbiBNb3VzZWRvd24gc2VsYnN0IGZcdTAwRkNyIEZhcmItL1RleHRhdXN3YWhsKS4gVmVyc2Nob2JlbiB3aXJkXG4gICAgLy8gZGlyZWt0IGluIHBsdWdpbi5zZXR0aW5ncy50eXBlcyAtIGRpZXNlbGJlIExpc3RlLCBkaWUgaW0gTWFudWVsbC1Nb2R1c1xuICAgIC8vIHVuc29ydGllcnQgYWxzIEFuemVpZ2VyZWloZW5mb2xnZSBkaWVudCAoc2llaGUgcmVuZGVyKCkpLlxuICAgIGlmIChkcmFnZ2FibGUpIHtcbiAgICAgIHNlbGYuZHJhZ2dhYmxlID0gdHJ1ZTtcbiAgICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdzdGFydFwiLCAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQuZGF0YVRyYW5zZmVyLmVmZmVjdEFsbG93ZWQgPSBcIm1vdmVcIjtcbiAgICAgICAgZXZlbnQuZGF0YVRyYW5zZmVyLnNldERhdGEoXCJ0ZXh0L3BsYWluXCIsIFN0cmluZyhpbmRleCkpO1xuICAgICAgICBzZWxmLmNsYXNzTGlzdC5hZGQoXCJpcy1kcmFnZ2luZ1wiKTtcbiAgICAgIH0pO1xuICAgICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ2VuZFwiLCAoKSA9PiBzZWxmLmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcmFnZ2luZ1wiKSk7XG4gICAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnb3ZlclwiLCAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgY29uc3QgcmVjdCA9IHNlbGYuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICAgIGNvbnN0IGlzQWZ0ZXIgPSBldmVudC5jbGllbnRZIC0gcmVjdC50b3AgPiByZWN0LmhlaWdodCAvIDI7XG4gICAgICAgIHNlbGYuY2xhc3NMaXN0LnRvZ2dsZShcImlzLWRyb3AtYmVmb3JlXCIsICFpc0FmdGVyKTtcbiAgICAgICAgc2VsZi5jbGFzc0xpc3QudG9nZ2xlKFwiaXMtZHJvcC1hZnRlclwiLCBpc0FmdGVyKTtcbiAgICAgIH0pO1xuICAgICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ2xlYXZlXCIsICgpID0+IHNlbGYuY2xhc3NMaXN0LnJlbW92ZShcImlzLWRyb3AtYmVmb3JlXCIsIFwiaXMtZHJvcC1hZnRlclwiKSk7XG4gICAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJkcm9wXCIsIGFzeW5jIChldmVudCkgPT4ge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBjb25zdCBpc0FmdGVyID0gc2VsZi5jbGFzc0xpc3QuY29udGFpbnMoXCJpcy1kcm9wLWFmdGVyXCIpO1xuICAgICAgICBzZWxmLmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcm9wLWJlZm9yZVwiLCBcImlzLWRyb3AtYWZ0ZXJcIik7XG5cbiAgICAgICAgY29uc3QgZnJvbUluZGV4ID0gTnVtYmVyKGV2ZW50LmRhdGFUcmFuc2Zlci5nZXREYXRhKFwidGV4dC9wbGFpblwiKSk7XG4gICAgICAgIGlmIChOdW1iZXIuaXNOYU4oZnJvbUluZGV4KSB8fCBmcm9tSW5kZXggPT09IGluZGV4KSByZXR1cm47XG5cbiAgICAgICAgbGV0IGluc2VydEJlZm9yZSA9IGlzQWZ0ZXIgPyBpbmRleCArIDEgOiBpbmRleDtcbiAgICAgICAgaWYgKGZyb21JbmRleCA8IGluc2VydEJlZm9yZSkgaW5zZXJ0QmVmb3JlIC09IDE7XG5cbiAgICAgICAgY29uc3QgdHlwZXMgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlcztcbiAgICAgICAgY29uc3QgW21vdmVkXSA9IHR5cGVzLnNwbGljZShmcm9tSW5kZXgsIDEpO1xuICAgICAgICB0eXBlcy5zcGxpY2UoaW5zZXJ0QmVmb3JlLCAwLCBtb3ZlZCk7XG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB0aGlzLnJlbmRlcigpO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcmVuZGVyVW5yZWdpc3RlcmVkSXRlbSh0eXBlLCBjb3VudCkge1xuICAgIGNvbnN0IHRyZWVJdGVtID0gdGhpcy5saXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbVwiIH0pO1xuICAgIGNvbnN0IHNlbGYgPSB0cmVlSXRlbS5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLXNlbGYgaXMtY2xpY2thYmxlIGZyZWQtdHlwLXVucmVnaXN0ZXJlZFwiIH0pO1xuICAgIHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1pbm5lclwiLCB0ZXh0OiBkaXNwbGF5VHlwZUtleSh0eXBlKSB9KTtcbiAgICB0aGlzLnJlbmRlckNvdW50RmxhaXIoc2VsZiwgY291bnQpO1xuXG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5yZWdpc3RlclR5cGUodHlwZSkpO1xuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNvbnRleHRtZW51XCIsIChldmVudCkgPT4ge1xuICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgdGhpcy5vcGVuU2VhcmNoKHR5cGUpO1xuICAgIH0pO1xuICB9XG5cbiAgcmVuZGVyVHlwZVNldHRpbmdzKHR5cGUpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuZW1wdHkoKTtcblxuICAgIGNvbnN0IGhlYWRlciA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZGV0YWlsLWhlYWRlclwiIH0pO1xuICAgIGNvbnN0IGJhY2tCdG4gPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWJhY2tcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJadXJcdTAwRkNja1wiIH0gfSk7XG4gICAgc2V0SWNvbihiYWNrQnRuLCBcImFycm93LWxlZnRcIik7XG4gICAgYmFja0J0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5jbG9zZVR5cGVTZXR0aW5ncygpKTtcblxuICAgIGNvbnN0IHRpdGxlRWwgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC10aXRsZVwiLCB0ZXh0OiB0eXBlIH0pO1xuICAgIGNvbnN0IHRpdGxlQ29sb3IgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3QgPyB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdIDogbnVsbDtcbiAgICBpZiAodGl0bGVDb2xvcikgdGl0bGVFbC5zdHlsZS5jb2xvciA9IHRpdGxlQ29sb3I7XG5cbiAgICBjb25zdCB7IGNvdW50cyB9ID0gdGhpcy5wbHVnaW4udHlwSW5kZXgudHlwZUNvdW50cygpO1xuICAgIGhlYWRlci5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC1jb3VudFwiLCB0ZXh0OiBTdHJpbmcoY291bnRzLmdldCh0eXBlKSA/PyAwKSB9KTtcblxuICAgIC8vIExpbmtzIG5lYmVuIGRlbSBub3JtYWxlbiBVbWJlbmVubmVuLUJ1dHRvbiwgaGVydm9yZ2Vob2JlbiAoQWt6ZW50ZmFyYmUsXG4gICAgLy8gc2llaGUgc3R5bGVzLmNzcykgLSBpbSBHZWdlbnNhdHogenUgZGllc2VtIHNjaHJlaWJ0IGRpZXNlIFZhcmlhbnRlIGJlaW1cbiAgICAvLyBVbWJlbmVubmVuIHp1c1x1MDBFNHR6bGljaCBkZW4gVFlQLVdlcnQgYWxsZXIgYmV0cm9mZmVuZW4gTm90aXplbiB1bSAobmFjaFxuICAgIC8vIEJlc3RcdTAwRTR0aWd1bmcsIHNpZWhlIHN0YXJ0RGV0YWlsUmVuYW1lL0NvbmZpcm1SZW5hbWVUeXBlTW9kYWwpLlxuICAgIGNvbnN0IHJlbmFtZVdpdGhOb3Rlc0J0biA9IGhlYWRlci5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWRldGFpbC1yZW5hbWUtbm90ZXNcIixcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiVW1iZW5lbm5lbiAoaW5rbC4gTm90aXplbiBhbnBhc3NlbilcIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24ocmVuYW1lV2l0aE5vdGVzQnRuLCBcInBlbmNpbFwiKTtcbiAgICByZW5hbWVXaXRoTm90ZXNCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuc3RhcnREZXRhaWxSZW5hbWUodHlwZSwgdGl0bGVFbCwgeyB1cGRhdGVOb3RlczogdHJ1ZSB9KSk7XG5cbiAgICBjb25zdCByZW5hbWVCdG4gPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWRldGFpbC1yZW5hbWVcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJVbWJlbmVubmVuXCIgfSB9KTtcbiAgICBzZXRJY29uKHJlbmFtZUJ0biwgXCJwZW5jaWxcIik7XG4gICAgcmVuYW1lQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnN0YXJ0RGV0YWlsUmVuYW1lKHR5cGUsIHRpdGxlRWwpKTtcblxuICAgIGNvbnN0IGRlbGV0ZUJ0biA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gZnJlZC10eXAtZGV0YWlsLWRlbGV0ZVwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkxcdTAwRjZzY2hlblwiIH0gfSk7XG4gICAgc2V0SWNvbihkZWxldGVCdG4sIFwidHJhc2hcIik7XG4gICAgZGVsZXRlQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnNob3dEZWxldGVDb25maXJtKHR5cGUpKTtcblxuICAgIGNvbnN0IGJvZHkgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC1ib2R5XCIgfSk7XG5cbiAgICBjb25zdCBkZXNjU2VjdGlvbiA9IGJvZHkuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRlc2NyaXB0aW9uLXNlY3Rpb25cIiB9KTtcblxuICAgIGNvbnN0IG9wdGlvbnNIZWFkZXIgPSBkZXNjU2VjdGlvbi5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItaGVhZGVyIGZyZWQtdHlwLW9wdGlvbnMtaGVhZGVyXCIgfSk7XG4gICAgY29uc3QgbWFudWFsVG9nZ2xlV3JhcCA9IG9wdGlvbnNIZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLW1hbnVhbC10b2dnbGVcIiB9KTtcbiAgICBtYW51YWxUb2dnbGVXcmFwLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtZGV0YWlsLXNlY3Rpb24tdGl0bGVcIiwgdGV4dDogXCJNYW51ZWxsZXIgVFlQXCIgfSk7XG4gICAgdGhpcy5yZW5kZXJNYW51YWxUb2dnbGUobWFudWFsVG9nZ2xlV3JhcCwgdHlwZSk7XG5cbiAgICBjb25zdCBjb2xvclJvdyA9IG9wdGlvbnNIZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC1jb2xvci1yb3dcIiB9KTtcbiAgICB0aGlzLnJlbmRlckNvbG9yUGlja2VyKFxuICAgICAgY29sb3JSb3csXG4gICAgICB0eXBlLFxuICAgICAgKG5ld0NvbG9yKSA9PiB7XG4gICAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3QpIHRpdGxlRWwuc3R5bGUuY29sb3IgPSBuZXdDb2xvcjtcbiAgICAgIH0sXG4gICAgICB7IHNob3dSZXNldDogdHJ1ZSB9XG4gICAgKTtcblxuICAgIGNvbnN0IGRlc2NIZWFkZXIgPSBkZXNjU2VjdGlvbi5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItaGVhZGVyXCIgfSk7XG4gICAgZGVzY0hlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZGV0YWlsLXNlY3Rpb24tdGl0bGVcIiwgdGV4dDogXCJCZXNjaHJlaWJ1bmdcIiB9KTtcblxuICAgIGNvbnN0IGRlc2NJbnB1dCA9IGRlc2NTZWN0aW9uLmNyZWF0ZUVsKFwidGV4dGFyZWFcIiwge1xuICAgICAgY2xzOiBcImZyZWQtdHlwLWRlc2NyaXB0aW9uLWlucHV0XCIsXG4gICAgICBhdHRyOiB7IHJvd3M6IFwiMlwiIH0sXG4gICAgfSk7XG4gICAgZGVzY0lucHV0LnZhbHVlID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXSA/PyBcIlwiO1xuICAgIGRlc2NJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gZGVzY0lucHV0LnZhbHVlLnRyaW0oKTtcbiAgICAgIGlmICh2YWx1ZSkgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXSA9IHZhbHVlO1xuICAgICAgZWxzZSBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXTtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgIH0pO1xuXG4gICAgLy8gVHJlbm50IGRpZSBGcm9udG1hdHRlci1CbFx1MDBGNmNrZSB2b24gZGVuIFx1MDBGQ2JyaWdlbiBFaW5zdGVsbHVuZ2VuIGRlcyBUWVBzLlxuICAgIC8vIGJvZHkuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC1zZXBhcmF0b3JcIiB9KTtcblxuICAgIC8vIFN0YW5kYXJkLUZyb250bWF0dGVyIHVuZCBqZSByZWdpc3RyaWVydGVtIFN1YnR5cCBlaW4gQmxvY2sgZGFydW50ZXIsIGFsbGVcbiAgICAvLyBpbiBlaW5lbSBnZW1laW5zYW1lbiBQcm9wZXJ0eS1FZGl0b3IgKHNpZWhlIHVuaWZpZWQtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKVxuICAgIC8vIC0gamVkZXIgS2V5IGdlaFx1MDBGNnJ0IHp1IGdlbmF1IGVpbmVtIEJsb2NrLCBEcmFnICYgRHJvcCByZWljaHQgXHUwMEZDYmVyIGFsbGVcbiAgICAvLyBCbFx1MDBGNmNrZS4gRWluIFN1YnR5cC1CbG9jayBlcmdcdTAwRTRuenQgZGFzIFN0YW5kYXJkLUZyb250bWF0dGVyIGZcdTAwRkNyIE5vdGl6ZW5cbiAgICAvLyBtaXQgZGllc2VtIFNVQlRZUCAoc2llaGUgc3VidHlwZXMuanMpLlxuICAgIGNvbnN0IGJ1Y2tldCA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnN1YnR5cGVCdWNrZXQodHlwZSk7XG4gICAgdGhpcy5mcm9udG1hdHRlckVkaXRvciA9IG1vdW50VW5pZmllZEZyb250bWF0dGVyRWRpdG9yKHRoaXMsIGJvZHksIHR5cGUsIHtcbiAgICAgIHJlbmRlckhlYWRlcjogKHNlY3Rpb24sIGVsLCBlZGl0b3IpID0+IHRoaXMucmVuZGVyU2VjdGlvbkhlYWRlcihlbCwgdHlwZSwgc2VjdGlvbiwgYnVja2V0LCBlZGl0b3IpLFxuICAgICAgcmVuZGVyRm9vdGVyOiAoc2VjdGlvbiwgZWwpID0+IHtcbiAgICAgICAgaWYgKHNlY3Rpb24gIT09IG51bGwpIHRoaXMucmVuZGVyU2VjdGlvbkZvb3RlcihlbCwgdHlwZSwgc2VjdGlvbik7XG4gICAgICB9LFxuICAgICAgb25Nb3ZlU2VjdGlvbjogYXN5bmMgKG9yZGVyKSA9PiB7XG4gICAgICAgIHJlb3JkZXJTdWJ0eXBlcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgb3JkZXIpO1xuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgIH0sXG4gICAgICBvblNlY3Rpb25Db250ZXh0TWVudTogKHNlY3Rpb24pID0+IHRoaXMub3BlblN1YnR5cGVTZWFyY2godHlwZSwgc2VjdGlvbiksXG4gICAgfSk7XG4gICAgaWYgKHRoaXMuZnJvbnRtYXR0ZXJFZGl0b3IpIHRoaXMuZnJvbnRtYXR0ZXJFZGl0b3JzLnB1c2godGhpcy5mcm9udG1hdHRlckVkaXRvcik7XG5cbiAgICAvLyBCZXd1c3N0IFx1MDBGQ2JlciBkaWUgdm9sbGUgQnJlaXRlIHVuZCBpbiBBa3plbnRmYXJiZSwgZGFtaXQgZXIgc2ljaCB2b24gZGVuXG4gICAgLy8ga2xlaW5lbiBJY29uLUJ1dHRvbnMgZGVyIEJsXHUwMEY2Y2tlIGFiaGVidC5cbiAgICB0aGlzLnN1YnR5cGVBZGRCdG5FbCA9IGJvZHkuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IFwibW9kLWN0YSBmcmVkLXR5cC1zdWJ0eXBlLWFkZFwiIH0pO1xuICAgIHNldEljb24odGhpcy5zdWJ0eXBlQWRkQnRuRWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1zdWJ0eXBlLWFkZC1pY29uXCIgfSksIFwicGx1c1wiKTtcbiAgICB0aGlzLnN1YnR5cGVBZGRCdG5FbC5jcmVhdGVTcGFuKHsgdGV4dDogXCJTdWJ0eXAgaGluenVmXHUwMEZDZ2VuXCIgfSk7XG4gICAgdGhpcy5zdWJ0eXBlQWRkQnRuRWwuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuc3RhcnRBZGRTdWJ0eXBlKHR5cGUpKTtcblxuICAgIHRoaXMucmVuZGVyVW5yZWdpc3RlcmVkU3VidHlwZXMoYm9keSwgdHlwZSwgYnVja2V0KTtcblxuICAgIGJvZHkuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC1zZXBhcmF0b3JcIiB9KTtcbiAgICB0aGlzLnJlbmRlclBsYWNlaG9sZGVyTGlzdChib2R5KTtcbiAgICAvLyBGZXR0LU1hcmtpZXJ1bmcgKHNpZWhlIGZyb250bWF0dGVyLWRlZmF1bHQtaGlnaGxpZ2h0LmpzKSByZWFnaWVydCBudXIgYXVmXG4gICAgLy8gTWV0YWRhdGVuLS9MYXlvdXQtRXZlbnRzIC0gZGFzIFx1MDBENmZmbmVuIGRpZXNlciBEZXRhaWxhbnNpY2h0IHNlbGJzdCBsXHUwMEY2c3RcbiAgICAvLyBrZWlucyBkYXZvbiBhdXMsIGRhaGVyIGhpZXIgZGlyZWt0IG5hY2ggZGVtIE1vdW50ZW4gYW5zdG9cdTAwREZlbi4gQmV3dXNzdFxuICAgIC8vIG51ciBkaWVzZXIgZWluZSwgZ2V6aWVsdGUgUmVmcmVzaCBzdGF0dCBkZXMgdm9sbGVuIHJlZnJlc2hUeXBDb2xvcnMoKS1cbiAgICAvLyBCXHUwMEZDbmRlbHM6IGRhcyB3XHUwMEZDcmRlIHUuIGEuIGF1Y2ggcmVuZGVyKCkgYXVmIGRpZXNlbSAoZ2VyYWRlIGVyc3QgbWl0dGVuXG4gICAgLy8gaW0gZWlnZW5lbiByZW5kZXIoKS1EdXJjaGxhdWYgYmVmaW5kbGljaGVuKSBWaWV3IGVybmV1dCBhdXNsXHUwMEY2c2VuLlxuICAgIHRoaXMucGx1Z2luLnJlZnJlc2hGcm9udG1hdHRlckhpZ2hsaWdodD8uKCk7XG4gIH1cblxuICAvLyBcdTAwRENiZXJzY2hyaWZ0IGVpbmVzIEJsb2NrcyBpbSBnZW1laW5zYW1lbiBFZGl0b3IgKHNpZWhlXG4gIC8vIHVuaWZpZWQtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKTogVGl0ZWwgbWl0IE5vdGl6LUFuemFobCAoYmVpbSBTdGFuZGFyZC1cbiAgLy8gRnJvbnRtYXR0ZXIgZGllIE5vdGl6ZW4gb2huZSBTVUJUWVAgLSBmXHUwMEZDciBkaWUgZ2lsdCBudXIgZGllc2VyIEJsb2NrKSxcbiAgLy8gU3VjaGUgcGVyIFJlY2h0c2tsaWNrIChiZWltIFN0YW5kYXJkLUZyb250bWF0dGVyIGF1ZiBkZW4gVGl0ZWwpLCB1bmQgZGllIGJlaWRlbiBcIlByb3BlcnR5XG4gIC8vIGhpbnp1Zlx1MDBGQ2dlblwiLUJ1dHRvbnMsIGRpZSBlaW5lIExlZXJ6ZWlsZSBpbiBnZW5hdSBkaWVzZW0gQmxvY2sgYW5sZWdlbi5cbiAgcmVuZGVyU2VjdGlvbkhlYWRlcihlbCwgdHlwZSwgc2VjdGlvbiwgYnVja2V0LCBlZGl0b3IpIHtcbiAgICBjb25zdCB0aXRsZUdyb3VwID0gZWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLXRpdGxlLWdyb3VwXCIgfSk7XG4gICAgY29uc3QgdGl0bGVFbCA9IHRpdGxlR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIsIHRleHQ6IHNlY3Rpb24gPz8gXCJTdGFuZGFyZC1Gcm9udG1hdHRlclwiIH0pO1xuICAgIGNvbnN0IGNvdW50ID0gc2VjdGlvbiA9PT0gbnVsbCA/IGJ1Y2tldC5ub1N1YnR5cGUgOiBidWNrZXQuY291bnRzLmdldChzZWN0aW9uKSA/PyAwO1xuICAgIHRpdGxlR3JvdXAuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1zdWJ0eXBlLWNvdW50XCIsIHRleHQ6IFN0cmluZyhjb3VudCkgfSk7XG4gICAgLy8gU3VidHlwLUJsXHUwMEY2Y2tlIHJlYWdpZXJlbiBhdWYgaWhyZXIgZ2FuemVuIEZsXHUwMEU0Y2hlIChzaWVoZVxuICAgIC8vIG9uU2VjdGlvbkNvbnRleHRNZW51IGluIHJlbmRlclR5cGVTZXR0aW5ncyksIGRhcyBTdGFuZGFyZC1Gcm9udG1hdHRlclxuICAgIC8vIG51ciBhdWYgZGVtIFRpdGVsLlxuICAgIGlmIChzZWN0aW9uID09PSBudWxsKSB7XG4gICAgICB0aXRsZUVsLmFkZEV2ZW50TGlzdGVuZXIoXCJjb250ZXh0bWVudVwiLCAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgdGhpcy5vcGVuU3VidHlwZVNlYXJjaCh0eXBlLCBudWxsKTtcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIEZsb2F0aW5nIFByb3BlcnRpZXMgKHNpZWhlIHR5cGVGbG9hdGluZ0tleXMgaW4gc2V0dGluZ3MuanMpIHNpbmQgVGVpbFxuICAgIC8vIGRlcnNlbGJlbiBMaXN0ZSB1bmQgUmVpaGVuZm9sZ2Ugd2llIGRpZSBcdTAwRkNicmlnZW4gUHJvcGVydGllcyAod2ljaHRpZyBmXHUwMEZDclxuICAgIC8vIGRpZSBGcm9udG1hdHRlci1Tb3J0aWVydW5nKSwgbGFuZGVuIGFsc28gYW4gZ2VuYXUgZGVyIFN0ZWxsZSwgYW4gZGllIHNpZVxuICAgIC8vIHBlciBEcmFnICYgRHJvcCBlaW5zb3J0aWVydCB3ZXJkZW4sIHN0YXR0IGZlc3QgYW5zIEVuZGUgZWluZXIgendlaXRlbiBMaXN0ZS5cbiAgICBjb25zdCBhZGRCdXR0b25zID0gZWwuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLWFkZC1ncm91cFwiIH0pO1xuXG4gICAgLy8gTGlua3MgbmViZW4gZGVtIG5vcm1hbGVuIEJ1dHRvbiwgaGVydm9yZ2Vob2JlbiAoQWt6ZW50ZmFyYmUsIHdpZVxuICAgIC8vIHJlbmFtZVdpdGhOb3Rlc0J0biBvYmVuKSAtIG1hcmtpZXJ0IGRpZSBhbHMgblx1MDBFNGNoc3RlcyBoaW56dWdlZlx1MDBGQ2d0ZSAoYnp3LlxuICAgIC8vIGJpcyB6dW0gblx1MDBFNGNoc3RlbiBTcGVpY2hlcm4gdW1iZW5hbm50ZSkgUHJvcGVydHkgYWxzIEZsb2F0aW5nLCBzdGF0dCBzaWVcbiAgICAvLyBhbHMgbm9ybWFsZSBTdGFuZGFyZC1Qcm9wZXJ0eSBhbnp1bGVnZW4gKHNpZWhlIGVkaXRvci5mcmVkUGVuZGluZ0Zsb2F0aW5nQWRkXG4gICAgLy8gaW4gdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpLiBGbG9hdGluZyBQcm9wZXJ0aWVzIHdlcmRlbiBOSUNIVFxuICAgIC8vIGF1dG9tYXRpc2NoIGJlaSBuZXVlbiBOb3RpemVuIGFuZ2VsZWd0IChzaWVoZSBnZXRUeXBlRGVmYXVsdHMoKSBpblxuICAgIC8vIG1haW4uanMpIHVuZCBkb3J0LCBzb2JhbGQgZG9jaCB2b3JoYW5kZW4sIGt1cnNpdiBzdGF0dCBmZXR0IGRhcmdlc3RlbGx0XG4gICAgLy8gKHNpZWhlIGZyb250bWF0dGVyLWRlZmF1bHQtaGlnaGxpZ2h0LmpzKS5cbiAgICBjb25zdCBhZGRGbG9hdGluZ1Byb3BlcnR5QnRuID0gYWRkQnV0dG9ucy5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWZyb250bWF0dGVyLWFkZC1mbG9hdGluZ1wiLFxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJGbG9hdGluZyBQcm9wZXJ0eSBoaW56dWZcdTAwRkNnZW5cIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24oYWRkRmxvYXRpbmdQcm9wZXJ0eUJ0biwgXCJwbHVzXCIpO1xuICAgIGFkZEZsb2F0aW5nUHJvcGVydHlCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IGVkaXRvci5mcmVkQWRkQmxhbmsoc2VjdGlvbiwgdHJ1ZSkpO1xuXG4gICAgY29uc3QgYWRkUHJvcGVydHlCdG4gPSBhZGRCdXR0b25zLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gZnJlZC10eXAtZnJvbnRtYXR0ZXItYWRkXCIsXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlByb3BlcnR5IGhpbnp1Zlx1MDBGQ2dlblwiIH0sXG4gICAgfSk7XG4gICAgc2V0SWNvbihhZGRQcm9wZXJ0eUJ0biwgXCJwbHVzXCIpO1xuICAgIGFkZFByb3BlcnR5QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiBlZGl0b3IuZnJlZEFkZEJsYW5rKHNlY3Rpb24sIGZhbHNlKSk7XG4gIH1cblxuICAvLyBBYnNjaGx1c3MgZWluZXMgU3VidHlwLUJsb2NrczogemVudHJpZXJ0IGRpZSBBa3Rpb25lbiBkZXMgU3VidHlwcywgd2llIGltXG4gIC8vIEtvcGYgZGVyIFRZUC1EZXRhaWxhbnNpY2h0IChVbWJlbmVubmVuIGlua2wuIE5vdGl6ZW4sIFVtYmVuZW5uZW4sIExcdTAwRjZzY2hlbikuXG4gIC8vIERhcyBTdGFuZGFyZC1Gcm9udG1hdHRlciBoYXQga2VpbmUuIERlciBUaXRlbCB3aXJkIGVyc3QgYmVpbSBLbGlja1xuICAvLyBnZXN1Y2h0IC0gXHUwMERDYmVyc2NocmlmdCB1bmQgQWJzY2hsdXNzIGVudHN0ZWhlbiBiZWkgamVkZW0gc3luY2hyb25pemUoKSBuZXUuXG4gIHJlbmRlclNlY3Rpb25Gb290ZXIoZWwsIHR5cGUsIHN1YnR5cGUpIHtcbiAgICBlbC5hZGRDbGFzcyhcImZyZWQtdHlwLXN1YnR5cGUtYWN0aW9uc1wiKTtcbiAgICBjb25zdCB0aXRsZUVsID0gKCkgPT4ge1xuICAgICAgbGV0IHNpYmxpbmcgPSBlbC5wcmV2aW91c0VsZW1lbnRTaWJsaW5nO1xuICAgICAgd2hpbGUgKHNpYmxpbmcgJiYgIXNpYmxpbmcuaGFzQ2xhc3MoXCJmcmVkLXR5cC1zZWN0aW9uLWhlYWRlclwiKSkgc2libGluZyA9IHNpYmxpbmcucHJldmlvdXNFbGVtZW50U2libGluZztcbiAgICAgIHJldHVybiBzaWJsaW5nPy5xdWVyeVNlbGVjdG9yKFwiLmZyZWQtdHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIpID8/IG51bGw7XG4gICAgfTtcbiAgICBjb25zdCByZW5hbWUgPSAodXBkYXRlTm90ZXMpID0+IHtcbiAgICAgIGNvbnN0IHRhcmdldCA9IHRpdGxlRWwoKTtcbiAgICAgIGlmICh0YXJnZXQpIHRoaXMuc3RhcnRTdWJ0eXBlUmVuYW1lKHR5cGUsIHN1YnR5cGUsIHRhcmdldCwgeyB1cGRhdGVOb3RlcyB9KTtcbiAgICB9O1xuXG4gICAgY29uc3QgcmVuYW1lV2l0aE5vdGVzQnRuID0gZWwuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1kZXRhaWwtcmVuYW1lLW5vdGVzXCIsXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlVtYmVuZW5uZW4gKGlua2wuIE5vdGl6ZW4gYW5wYXNzZW4pXCIgfSxcbiAgICB9KTtcbiAgICBzZXRJY29uKHJlbmFtZVdpdGhOb3Rlc0J0biwgXCJwZW5jaWxcIik7XG4gICAgcmVuYW1lV2l0aE5vdGVzQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiByZW5hbWUodHJ1ZSkpO1xuXG4gICAgY29uc3QgcmVuYW1lQnRuID0gZWwuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWRldGFpbC1yZW5hbWVcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJVbWJlbmVubmVuXCIgfSB9KTtcbiAgICBzZXRJY29uKHJlbmFtZUJ0biwgXCJwZW5jaWxcIik7XG4gICAgcmVuYW1lQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiByZW5hbWUoZmFsc2UpKTtcblxuICAgIGNvbnN0IGRlbGV0ZUJ0biA9IGVsLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1kZXRhaWwtZGVsZXRlXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiTFx1MDBGNnNjaGVuXCIgfSB9KTtcbiAgICBzZXRJY29uKGRlbGV0ZUJ0biwgXCJ0cmFzaFwiKTtcbiAgICBkZWxldGVCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuZGVsZXRlU3VidHlwZVdpdGhDb25maXJtKHR5cGUsIHN1YnR5cGUpKTtcbiAgfVxuXG4gIC8vIExcdTAwRjZzY2h0IGRlbiBTdWJ0eXAtQmxvY2sgc2FtdCBzZWluZXIgUHJvcGVydGllcy4gRGllIE5vdGl6ZW4gYmVoYWx0ZW4gaWhyZW5cbiAgLy8gU1VCVFlQLVdlcnQgKGVyIGVyc2NoZWludCBkYW5hY2ggdW50ZW4gYWxzIG5pY2h0IGVyZmFzc3RlciBTdWJ0eXApIC0gZWluZVxuICAvLyBCZXN0XHUwMEU0dGlndW5nIGJyYXVjaHQgZXMgZGFoZXIgbnVyLCB3ZW5uIGRhYmVpIFByb3BlcnRpZXMgdmVybG9yZW4gZ2VoZW4uXG4gIGRlbGV0ZVN1YnR5cGVXaXRoQ29uZmlybSh0eXBlLCBzdWJ0eXBlKSB7XG4gICAgY29uc3QgYXBwbHkgPSBhc3luYyAoKSA9PiB7XG4gICAgICBkZWxldGVTdWJ0eXBlKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlKTtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICB0aGlzLnJlbmRlcigpO1xuICAgIH07XG4gICAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKGdldFN1YnR5cGUodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpPy5mcm9udG1hdHRlciA/PyB7fSkuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gXCJcIik7XG4gICAgaWYgKGtleXMubGVuZ3RoID09PSAwKSB7XG4gICAgICBhcHBseSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBuZXcgQ29uZmlybVN1YnR5cGVNb2RhbCh0aGlzLmFwcCwge1xuICAgICAgcGFyYWdyYXBoczogW1xuICAgICAgICBgU3VidHlwICR7c3VidHlwZX0gdm9uICR7dHlwZX0gd2lya2xpY2ggbFx1MDBGNnNjaGVuP2AsXG4gICAgICAgIGAke2tleXMubGVuZ3RoID09PSAxID8gXCJEaWUgUHJvcGVydHlcIiA6IGBEaWUgJHtrZXlzLmxlbmd0aH0gUHJvcGVydGllc2B9ICR7a2V5cy5qb2luKFwiLCBcIil9ICR7a2V5cy5sZW5ndGggPT09IDEgPyBcImdlaHRcIiA6IFwiZ2VoZW5cIn0gZGFiZWkgdmVybG9yZW4uYCxcbiAgICAgIF0sXG4gICAgICBjb25maXJtVGV4dDogXCJMXHUwMEY2c2NoZW5cIixcbiAgICAgIGNvbmZpcm1DbHM6IFwibW9kLXdhcm5pbmdcIixcbiAgICAgIG9uQ29uZmlybTogYXBwbHksXG4gICAgfSkub3BlbigpO1xuICB9XG5cbiAgLy8gV2llIHN0YXJ0RGV0YWlsUmVuYW1lKCksIGFiZXIgYXVmIGRlbSBUaXRlbCBlaW5lcyBTdWJ0eXAtQmxvY2tzLiBEZXIgQmxvY2tcbiAgLy8gYmVoXHUwMEU0bHQgc2VpbmUgUG9zaXRpb247IHVwZGF0ZU5vdGVzOiB0cnVlIHNjaHJlaWJ0IG5hY2ggQmVzdFx1MDBFNHRpZ3VuZyBhdWNoIGRlblxuICAvLyBTVUJUWVAgZGVyIGJldHJvZmZlbmVuIE5vdGl6ZW4gdW0uIEVpbiBiZXJlaXRzIHZvcmhhbmRlbmVyIE5hbWUgYmlldGV0XG4gIC8vIHN0YXR0ZGVzc2VuIGRhcyBadXNhbW1lbmxlZ2VuIGFuIChzY2hyZWlidCBkaWUgTm90aXplbiBpbW1lciBtaXQgdW0pLlxuICBzdGFydFN1YnR5cGVSZW5hbWUodHlwZSwgc3VidHlwZSwgdGl0bGVFbCwgeyB1cGRhdGVOb3RlcyA9IGZhbHNlIH0gPSB7fSkge1xuICAgIGlmICh0aGlzLmlzRWRpdGluZykgcmV0dXJuO1xuICAgIHRoaXMuaXNFZGl0aW5nID0gdHJ1ZTtcblxuICAgIHRpdGxlRWwuYWRkQ2xhc3MoXCJmcmVkLXR5cC1zdWJ0eXBlLW5hbWUtaW5wdXRcIiwgXCJpcy1iZWluZy1yZW5hbWVkXCIpO1xuICAgIHRpdGxlRWwuc2V0QXR0cmlidXRlKFwiY29udGVudGVkaXRhYmxlXCIsIFwidHJ1ZVwiKTtcbiAgICB0aXRsZUVsLnNldEF0dHJpYnV0ZShcInNwZWxsY2hlY2tcIiwgXCJmYWxzZVwiKTtcbiAgICB0aXRsZUVsLmZvY3VzKCk7XG5cbiAgICBjb25zdCByYW5nZSA9IHRpdGxlRWwuZG9jLmNyZWF0ZVJhbmdlKCk7XG4gICAgcmFuZ2Uuc2VsZWN0Tm9kZUNvbnRlbnRzKHRpdGxlRWwpO1xuICAgIGNvbnN0IHNlbGVjdGlvbiA9IHRpdGxlRWwud2luLmdldFNlbGVjdGlvbigpO1xuICAgIHNlbGVjdGlvbi5yZW1vdmVBbGxSYW5nZXMoKTtcbiAgICBzZWxlY3Rpb24uYWRkUmFuZ2UocmFuZ2UpO1xuXG4gICAgY29uc3QgY291bnRPZiA9IChuYW1lKSA9PiB0aGlzLnBsdWdpbi50eXBJbmRleC5zdWJ0eXBlQnVja2V0KHR5cGUpLmNvdW50cy5nZXQobmFtZSkgPz8gMDtcbiAgICBjb25zdCBhcHBseVJlbmFtZSA9IGFzeW5jICh2YWx1ZSwgeyB3aXRoTm90ZXMgfSkgPT4ge1xuICAgICAgcmVuYW1lU3VidHlwZSh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSwgdmFsdWUpO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICBjb25zdCByZW5hbWVkID0gd2l0aE5vdGVzID8gYXdhaXQgcmVuYW1lU3VidHlwZUluTm90ZXModGhpcy5wbHVnaW4sIHR5cGUsIHN1YnR5cGUsIHZhbHVlKSA6IDA7XG4gICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgIGlmICh3aXRoTm90ZXMpIG5ldyBOb3RpY2UoYFNVQlRZUCAke3ZhbHVlfTogJHtyZW5hbWVkfSBOb3RpeihlbikgYW5nZXBhc3N0LmApO1xuICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICB9O1xuXG4gICAgbGV0IGRvbmUgPSBmYWxzZTtcbiAgICBjb25zdCBmaW5pc2ggPSBhc3luYyAoY29tbWl0KSA9PiB7XG4gICAgICBpZiAoZG9uZSkgcmV0dXJuO1xuICAgICAgZG9uZSA9IHRydWU7XG4gICAgICB0aGlzLmlzRWRpdGluZyA9IGZhbHNlO1xuXG4gICAgICBjb25zdCB2YWx1ZSA9IG5vcm1hbGl6ZVN1YnR5cGVOYW1lKHRpdGxlRWwudGV4dENvbnRlbnQpO1xuICAgICAgaWYgKCFjb21taXQgfHwgIXZhbHVlIHx8IHZhbHVlID09PSBzdWJ0eXBlKSB7XG4gICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgY29uc3QgZXhpc3RpbmcgPSBnZXRTdWJ0eXBlTmFtZXModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUpLmZpbmQoXG4gICAgICAgIChuYW1lKSA9PiBuYW1lLnRvTG93ZXJDYXNlKCkgPT09IHZhbHVlLnRvTG93ZXJDYXNlKCkgJiYgbmFtZSAhPT0gc3VidHlwZVxuICAgICAgKTtcbiAgICAgIGlmIChleGlzdGluZykge1xuICAgICAgICBuZXcgQ29uZmlybVN1YnR5cGVNb2RhbCh0aGlzLmFwcCwge1xuICAgICAgICAgIHBhcmFncmFwaHM6IFtcbiAgICAgICAgICAgIGBTdWJ0eXAgJHtleGlzdGluZ30gZXhpc3RpZXJ0IGJlaSAke3R5cGV9IGJlcmVpdHMuICR7c3VidHlwZX0gZGFtaXQgenVzYW1tZW5sZWdlbj9gLFxuICAgICAgICAgICAgYCR7Y291bnRPZihzdWJ0eXBlKX0gTm90aXooZW4pIHdlcmRlbiBhdWYgJHtleGlzdGluZ30gdW1nZXN0ZWxsdCwgZGllIFByb3BlcnRpZXMgdm9uICR7c3VidHlwZX0gd2FuZGVybiBpbiBkZW4gQmxvY2sgJHtleGlzdGluZ30uYCxcbiAgICAgICAgICBdLFxuICAgICAgICAgIGNvbmZpcm1UZXh0OiBcIlp1c2FtbWVubGVnZW5cIixcbiAgICAgICAgICBjb25maXJtQ2xzOiBcIm1vZC13YXJuaW5nXCIsXG4gICAgICAgICAgb25Db25maXJtOiBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBtZXJnZVN1YnR5cGVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlLCBzdWJ0eXBlLCBleGlzdGluZyk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIGNvbnN0IHJlbmFtZWQgPSBhd2FpdCByZW5hbWVTdWJ0eXBlSW5Ob3Rlcyh0aGlzLnBsdWdpbiwgdHlwZSwgc3VidHlwZSwgZXhpc3RpbmcpO1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgICAgICBuZXcgTm90aWNlKGBTdWJ0eXAgJHtzdWJ0eXBlfSBtaXQgJHtleGlzdGluZ30genVzYW1tZW5nZWxlZ3QsICR7cmVuYW1lZH0gTm90aXooZW4pIGFuZ2VwYXNzdC5gKTtcbiAgICAgICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICAgICAgfSxcbiAgICAgICAgICBvbkNhbmNlbDogKCkgPT4gdGhpcy5yZW5kZXIoKSxcbiAgICAgICAgfSkub3BlbigpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmICghdXBkYXRlTm90ZXMpIHtcbiAgICAgICAgYXdhaXQgYXBwbHlSZW5hbWUodmFsdWUsIHsgd2l0aE5vdGVzOiBmYWxzZSB9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgbmV3IENvbmZpcm1TdWJ0eXBlTW9kYWwodGhpcy5hcHAsIHtcbiAgICAgICAgcGFyYWdyYXBoczogW2BTdWJ0eXAgJHtzdWJ0eXBlfSBpbiAke3ZhbHVlfSB1bWJlbmVubmVuIHVuZCAke2NvdW50T2Yoc3VidHlwZSl9IE5vdGl6KGVuKSBlbnRzcHJlY2hlbmQgYW5wYXNzZW4/YF0sXG4gICAgICAgIGNvbmZpcm1UZXh0OiBcIlVtYmVuZW5uZW5cIixcbiAgICAgICAgY29uZmlybUNsczogXCJtb2QtY3RhXCIsXG4gICAgICAgIG9uQ29uZmlybTogKCkgPT4gYXBwbHlSZW5hbWUodmFsdWUsIHsgd2l0aE5vdGVzOiB0cnVlIH0pLFxuICAgICAgICBvbkNhbmNlbDogKCkgPT4gdGhpcy5yZW5kZXIoKSxcbiAgICAgIH0pLm9wZW4oKTtcbiAgICB9O1xuXG4gICAgLy8gQWxsZSBUYXN0ZW4gaGllciBiZWhhbHRlbjogZGVyIFRpdGVsIHN0ZWh0IGluIGRlciBMaXN0ZSB2b24gT2JzaWRpYW5zXG4gICAgLy8gUHJvcGVydHktRWRpdG9yLCBkZXNzZW4gZWlnZW5lIFRhc3RhdHVyLU5hdmlnYXRpb24gc29uc3QgbWl0cmVhZ2llcnRlXG4gICAgLy8gKEVzY2FwZSB6dXNcdTAwRTR0emxpY2ggd2VnZW4gZGVyIERldGFpbGFuc2ljaHQsIHNpZWhlIG9uT3BlbikuXG4gICAgdGl0bGVFbC5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgaWYgKGV2ZW50LmtleSA9PT0gXCJFbnRlclwiKSB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGZpbmlzaCh0cnVlKTtcbiAgICAgIH0gZWxzZSBpZiAoZXZlbnQua2V5ID09PSBcIkVzY2FwZVwiKSB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGZpbmlzaChmYWxzZSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgdGl0bGVFbC5hZGRFdmVudExpc3RlbmVyKFwiYmx1clwiLCAoKSA9PiBmaW5pc2godHJ1ZSkpO1xuICB9XG5cbiAgLy8gV2llIGRpZSB1bnJlZ2lzdHJpZXJ0ZW4gRWludHJcdTAwRTRnZSBkZXIgVFlQLUxpc3RlOiBTVUJUWVAtV2VydGUgdm9uIE5vdGl6ZW5cbiAgLy8gZGllc2VzIFRZUHMsIGRpZSAobm9jaCkga2VpbmVuIGVpZ2VuZW4gQmxvY2sgaGFiZW4gKE5vdGl6ZW4gZ2FueiBvaG5lXG4gIC8vIFNVQlRZUCB6XHUwMEU0aGx0IHN0YXR0ZGVzc2VuIGRhcyBTdGFuZGFyZC1Gcm9udG1hdHRlcikuIERhcmdlc3RlbGx0IHdpZSBkaWVcbiAgLy8gU3VidHlwLUJsXHUwMEY2Y2tlLCBhYmVyIG51ciBtaXQgKGF1c2dlZ3JhdXRlcikgXHUwMERDYmVyc2NocmlmdCBzYW10IEFuemFobC5cbiAgLy8gTGlua3NrbGljayBcdTAwRkNiZXJuaW1tdCBlaW5lbiBXZXJ0IGFscyBTdWJ0eXAsIFJlY2h0c2tsaWNrIFx1MDBGNmZmbmV0IGRpZSBTdWNoZS5cbiAgcmVuZGVyVW5yZWdpc3RlcmVkU3VidHlwZXMocGFyZW50LCB0eXBlLCBidWNrZXQpIHtcbiAgICBjb25zdCByZWdpc3RlcmVkID0gZ2V0U3VidHlwZU5hbWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlKTtcbiAgICBjb25zdCB1bnJlZ2lzdGVyZWQgPSBbLi4uYnVja2V0LmNvdW50cy5rZXlzKCldXG4gICAgICAuZmlsdGVyKChrZXkpID0+ICFyZWdpc3RlcmVkLmluY2x1ZGVzKGtleSkpXG4gICAgICAuc29ydCgoYSwgYikgPT4gYnVja2V0LmNvdW50cy5nZXQoYikgLSBidWNrZXQuY291bnRzLmdldChhKSB8fCBhLmxvY2FsZUNvbXBhcmUoYikpO1xuICAgIGlmICh1bnJlZ2lzdGVyZWQubGVuZ3RoID09PSAwKSByZXR1cm47XG5cbiAgICBjb25zdCBsaXN0RWwgPSBwYXJlbnQuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLXN1YnR5cGUtdW5yZWdpc3RlcmVkLWxpc3RcIiB9KTtcbiAgICBmb3IgKGNvbnN0IGtleSBvZiB1bnJlZ2lzdGVyZWQpIHtcbiAgICAgIGNvbnN0IGJsb2NrID0gbGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1mcm9udG1hdHRlci1ibG9jayBmcmVkLXR5cC1zdWJ0eXBlLWJsb2NrIGZyZWQtdHlwLXN1YnR5cGUtdW5yZWdpc3RlcmVkXCIgfSk7XG4gICAgICBjb25zdCBoZWFkZXIgPSBibG9jay5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItaGVhZGVyXCIgfSk7XG4gICAgICBjb25zdCB0aXRsZUdyb3VwID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1mcm9udG1hdHRlci10aXRsZS1ncm91cFwiIH0pO1xuICAgICAgdGl0bGVHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZGV0YWlsLXNlY3Rpb24tdGl0bGVcIiwgdGV4dDogZGlzcGxheVR5cGVLZXkoa2V5KSB9KTtcbiAgICAgIHRpdGxlR3JvdXAuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1zdWJ0eXBlLWNvdW50XCIsIHRleHQ6IFN0cmluZyhidWNrZXQuY291bnRzLmdldChrZXkpKSB9KTtcbiAgICAgIGJsb2NrLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnJlZ2lzdGVyU3VidHlwZSh0eXBlLCBrZXksIGJ1Y2tldCkpO1xuICAgICAgYmxvY2suYWRkRXZlbnRMaXN0ZW5lcihcImNvbnRleHRtZW51XCIsIChldmVudCkgPT4ge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgdGhpcy5vcGVuU3VidHlwZVNlYXJjaCh0eXBlLCBrZXkpO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgLy8gc3VidHlwZUtleSA9PT0gbnVsbCBcdTIxOTIgTm90aXplbiBkaWVzZXMgVFlQcyBvaG5lIFNVQlRZUC4gRlx1MDBGQ3IgZWluZSBMaXN0ZVxuICAvLyBnaWJ0IGVzIHdpZSBiZWkgb3BlblNlYXJjaCgpIGtlaW5lIGV4YWt0ZSBTdWNoc3ludGF4IC0gZGFubiBuYWNoIE5vdGl6ZW5cbiAgLy8gc3VjaGVuLCBkaWUgYWxsZSBpaHJlIEVpbnRyXHUwMEU0Z2UgdHJhZ2VuLlxuICBvcGVuU3VidHlwZVNlYXJjaCh0eXBlLCBzdWJ0eXBlS2V5KSB7XG4gICAgY29uc3QgZ2xvYmFsU2VhcmNoID0gdGhpcy5wbHVnaW4uYXBwLmludGVybmFsUGx1Z2lucy5nZXRQbHVnaW5CeUlkKFwiZ2xvYmFsLXNlYXJjaFwiKTtcbiAgICBpZiAoIWdsb2JhbFNlYXJjaCkgcmV0dXJuO1xuICAgIGNvbnN0IHR5cENsYXVzZSA9IGBbXCIke1RZUF9QUk9QRVJUWX1cIjpcIiR7dHlwZX1cIl1gO1xuICAgIGxldCBzdWJ0eXBDbGF1c2U7XG4gICAgaWYgKHN1YnR5cGVLZXkgPT09IG51bGwpIHtcbiAgICAgIHN1YnR5cENsYXVzZSA9IGAtW1wiJHtTVUJUWVBfUFJPUEVSVFl9XCJdYDtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgcmF3ID0gdGhpcy5wbHVnaW4udHlwSW5kZXguc3VidHlwZUJ1Y2tldCh0eXBlKS5yYXdCeUtleS5nZXQoc3VidHlwZUtleSk7XG4gICAgICBzdWJ0eXBDbGF1c2UgPSBBcnJheS5pc0FycmF5KHJhdylcbiAgICAgICAgPyByYXcubWFwKCh2KSA9PiBgW1wiJHtTVUJUWVBfUFJPUEVSVFl9XCI6XCIke1N0cmluZyh2ID8/IFwiXCIpLnRyaW0oKX1cIl1gKS5qb2luKFwiIFwiKVxuICAgICAgICA6IGBbXCIke1NVQlRZUF9QUk9QRVJUWX1cIjpcIiR7c3VidHlwZUtleX1cIl1gO1xuICAgIH1cbiAgICBnbG9iYWxTZWFyY2guaW5zdGFuY2Uub3Blbkdsb2JhbFNlYXJjaChgJHt0eXBDbGF1c2V9ICR7c3VidHlwQ2xhdXNlfWApO1xuICB9XG5cbiAgLy8gV2llIHJlZ2lzdGVyVHlwZSgpOiBcdTAwRkNiZXJuaW1tdCBkaWUgYmVyZWluaWd0ZSBGb3JtIChHcm9cdTAwREZidWNoc3RhYmVuLCBMaXN0ZVxuICAvLyBhbHMgRWluemVsd2VydCBcIkEsIEJcIikgYWxzIFN1YnR5cCBkaWVzZXMgVFlQcyB1bmQgc2NocmVpYnQgZGVuIFNVQlRZUCBkZXJcbiAgLy8gYmV0cm9mZmVuZW4gTm90aXplbiBnbGVpY2ggbWl0IHVtLiBHaWJ0IGVzIGRlbiBTdWJ0eXAgaW4gYW5kZXJlciBTY2hyZWliLVxuICAvLyB3ZWlzZSBzY2hvbiwgbGFuZGVuIGRpZSBOb3RpemVuIGRvcnQuXG4gIGFzeW5jIHJlZ2lzdGVyU3VidHlwZSh0eXBlLCBzdWJ0eXBlS2V5LCBidWNrZXQpIHtcbiAgICBjb25zdCByYXcgPSBidWNrZXQucmF3QnlLZXkuZ2V0KHN1YnR5cGVLZXkpO1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVSYXdUeXBlKHJhdyA9PT0gdW5kZWZpbmVkID8gc3VidHlwZUtleSA6IHJhdywgbm9ybWFsaXplU3VidHlwZU5hbWUpO1xuICAgIGlmICghbm9ybWFsaXplZCkgcmV0dXJuO1xuICAgIGNvbnN0IGV4aXN0aW5nID0gZ2V0U3VidHlwZU5hbWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlKS5maW5kKChuYW1lKSA9PiBuYW1lLnRvTG93ZXJDYXNlKCkgPT09IG5vcm1hbGl6ZWQudG9Mb3dlckNhc2UoKSk7XG4gICAgY29uc3Qgc3VidHlwZSA9IGV4aXN0aW5nID8/IG5vcm1hbGl6ZWQ7XG4gICAgZW5zdXJlU3VidHlwZSh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSwgc3VidHlwZSk7XG5cbiAgICBsZXQgcmVuYW1lZCA9IDA7XG4gICAgaWYgKHN1YnR5cGUgIT09IHN1YnR5cGVLZXkpIHJlbmFtZWQgPSBhd2FpdCByZW5hbWVTdWJ0eXBlSW5Ob3Rlcyh0aGlzLnBsdWdpbiwgdHlwZSwgc3VidHlwZUtleSwgc3VidHlwZSk7XG5cbiAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICBpZiAocmVuYW1lZCA+IDApIG5ldyBOb3RpY2UoYFNVQlRZUCAke3N1YnR5cGV9IHJlZ2lzdHJpZXJ0LCAke3JlbmFtZWR9IE5vdGl6KGVuKSBhbmdlcGFzc3QuYCk7XG4gIH1cblxuICAvLyBOZXVlciwgbGVlcmVyIFN1YnR5cC1CbG9jayBkaXJla3QgXHUwMEZDYmVyIGRlbSBcIlN1YnR5cCBoaW56dWZcdTAwRkNnZW5cIi1CdXR0b24sXG4gIC8vIGRlc3NlbiBOYW1lIHNvZm9ydCBpbmxpbmUgZWluZ2VnZWJlbiB3aXJkICh3aWUgc3RhcnRBZGQoKSBpbiBkZXIgTGlzdGUpLlxuICBzdGFydEFkZFN1YnR5cGUodHlwZSkge1xuICAgIGlmICh0aGlzLmlzRWRpdGluZyB8fCAhdGhpcy5zdWJ0eXBlQWRkQnRuRWwpIHJldHVybjtcbiAgICB0aGlzLmlzRWRpdGluZyA9IHRydWU7XG5cbiAgICAvLyBBdWZnZWJhdXQgd2llIGRlciBmZXJ0aWdlIChsZWVyZSkgQmxvY2sgaW0gZ2VtZWluc2FtZW4gRWRpdG9yIC0gc2FtdCBkZW5cbiAgICAvLyBcIitcIi1CdXR0b25zIHVuZCBkZW4gQWt0aW9uZW4gaW0gQWJzY2hsdXNzLCBkaWUgaGllciBub2NoIG5pY2h0cyB0dW4sIG51clxuICAgIC8vIG5vY2ggb2huZSBBbnphaGwgLSwgZGFtaXQgYmVpbSBBYnNjaGxpZVx1MDBERmVuIGRlciBFaW5nYWJlIG5pY2h0cyBzcHJpbmd0XG4gICAgLy8gKHNpZWhlIC5mcmVkLXR5cC1zdWJ0eXBlLXBlbmRpbmcpLlxuICAgIGNvbnN0IGJsb2NrID0gY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLWJsb2NrIGZyZWQtdHlwLXN1YnR5cGUtYmxvY2sgZnJlZC10eXAtc3VidHlwZS1wZW5kaW5nXCIgfSk7XG4gICAgdGhpcy5zdWJ0eXBlQWRkQnRuRWwucGFyZW50RWxlbWVudC5pbnNlcnRCZWZvcmUoYmxvY2ssIHRoaXMuc3VidHlwZUFkZEJ0bkVsKTtcbiAgICBjb25zdCBoZWFkZXIgPSBibG9jay5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItaGVhZGVyXCIgfSk7XG4gICAgY29uc3QgdGl0bGVHcm91cCA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtZnJvbnRtYXR0ZXItdGl0bGUtZ3JvdXBcIiB9KTtcbiAgICBjb25zdCBuYW1lRWwgPSB0aXRsZUdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1kZXRhaWwtc2VjdGlvbi10aXRsZSBmcmVkLXR5cC1zdWJ0eXBlLW5hbWUtaW5wdXQgaXMtYmVpbmctcmVuYW1lZFwiIH0pO1xuICAgIGNvbnN0IGFkZEJ1dHRvbnMgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLWZyb250bWF0dGVyLWFkZC1ncm91cFwiIH0pO1xuICAgIHNldEljb24oYWRkQnV0dG9ucy5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gZnJlZC10eXAtZnJvbnRtYXR0ZXItYWRkLWZsb2F0aW5nXCIgfSksIFwicGx1c1wiKTtcbiAgICBzZXRJY29uKGFkZEJ1dHRvbnMuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIGZyZWQtdHlwLWZyb250bWF0dGVyLWFkZFwiIH0pLCBcInBsdXNcIik7XG4gICAgY29uc3QgZm9vdGVyID0gYmxvY2suY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLXNlY3Rpb24tZm9vdGVyIGZyZWQtdHlwLXN1YnR5cGUtYWN0aW9uc1wiIH0pO1xuICAgIHNldEljb24oZm9vdGVyLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1kZXRhaWwtcmVuYW1lLW5vdGVzXCIgfSksIFwicGVuY2lsXCIpO1xuICAgIHNldEljb24oZm9vdGVyLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1kZXRhaWwtcmVuYW1lXCIgfSksIFwicGVuY2lsXCIpO1xuICAgIHNldEljb24oZm9vdGVyLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiBmcmVkLXR5cC1kZXRhaWwtZGVsZXRlXCIgfSksIFwidHJhc2hcIik7XG4gICAgbmFtZUVsLnNldEF0dHJpYnV0ZShcImNvbnRlbnRlZGl0YWJsZVwiLCBcInRydWVcIik7XG4gICAgbmFtZUVsLnNldEF0dHJpYnV0ZShcInNwZWxsY2hlY2tcIiwgXCJmYWxzZVwiKTtcbiAgICBuYW1lRWwuZm9jdXMoKTtcblxuICAgIGxldCBkb25lID0gZmFsc2U7XG4gICAgY29uc3QgZmluaXNoID0gYXN5bmMgKGNvbW1pdCkgPT4ge1xuICAgICAgaWYgKGRvbmUpIHJldHVybjtcbiAgICAgIGRvbmUgPSB0cnVlO1xuICAgICAgdGhpcy5pc0VkaXRpbmcgPSBmYWxzZTtcblxuICAgICAgY29uc3QgdmFsdWUgPSBub3JtYWxpemVTdWJ0eXBlTmFtZShuYW1lRWwudGV4dENvbnRlbnQpO1xuICAgICAgaWYgKGNvbW1pdCAmJiB2YWx1ZSkge1xuICAgICAgICBjb25zdCBleGlzdGluZyA9IGdldFN1YnR5cGVOYW1lcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwZSkuZmluZCgobmFtZSkgPT4gbmFtZS50b0xvd2VyQ2FzZSgpID09PSB2YWx1ZS50b0xvd2VyQ2FzZSgpKTtcbiAgICAgICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICAgICAgbmV3IE5vdGljZShgU3VidHlwICR7ZXhpc3Rpbmd9IGdpYnQgZXMgYmVpICR7dHlwZX0gYmVyZWl0cy5gKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBlbnN1cmVTdWJ0eXBlKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlLCB2YWx1ZSk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgfTtcblxuICAgIG5hbWVFbC5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRW50ZXJcIikge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgZmluaXNoKHRydWUpO1xuICAgICAgfSBlbHNlIGlmIChldmVudC5rZXkgPT09IFwiRXNjYXBlXCIpIHtcbiAgICAgICAgLy8gc3RvcFByb3BhZ2F0aW9uLCBzb25zdCB2ZXJsXHUwMEU0c3N0IGRlciBFc2NhcGUtSGFuZGxlciBkZXIgZ2VzYW10ZW5cbiAgICAgICAgLy8gRGV0YWlsYW5zaWNodCBzaWUgZ2xlaWNoIG1pdC5cbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgIGZpbmlzaChmYWxzZSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgbmFtZUVsLmFkZEV2ZW50TGlzdGVuZXIoXCJibHVyXCIsICgpID0+IGZpbmlzaCh0cnVlKSk7XG4gIH1cblxuICBzaG93RGVsZXRlQ29uZmlybSh0eXBlKSB7XG4gICAgbmV3IENvbmZpcm1EZWxldGVUeXBlTW9kYWwodGhpcy5wbHVnaW4sIHR5cGUsIGFzeW5jICgpID0+IHtcbiAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVzID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXMuZmlsdGVyKCh0KSA9PiB0ICE9PSB0eXBlKTtcbiAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdO1xuICAgICAgZGVsZXRlIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV07XG4gICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXTtcbiAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdO1xuICAgICAgZGVsZXRlIHRoaXMuZW5zdXJlVHlwZU1hbnVhbCgpW3R5cGVdO1xuICAgICAgZGVsZXRlVHlwZVN1YnR5cGVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXBlKTtcbiAgICAgIC8vIFZvciByZWZyZXNoVHlwQ29sb3JzKCkgenVyXHUwMEZDY2sgenVyIExpc3RlLCBhdXMgZGVtc2VsYmVuIEdydW5kIHdpZSBiZWltXG4gICAgICAvLyBVbWJlbmVubmVuOiByZWZyZXNoVHlwQ29sb3JzKCkgcmVuZGVydCAodS4gYS4gXHUwMEZDYmVyIHJlZ2lzdGVyVHlwVmlldylcbiAgICAgIC8vIHN5bmNocm9uIG5ldSAtIHN0XHUwMEZDbmRlIHNlbGVjdGVkVHlwZSBub2NoIGF1ZiBkZW0gZ2VyYWRlIGdlbFx1MDBGNnNjaHRlblxuICAgICAgLy8gVHlwLCB3XHUwMEZDcmRlIGRlc3NlbiBqZXR6dCBkYXRlbmxvc2UgRGV0YWlsYW5zaWNodCBrdXJ6IGVybmV1dCBnZXJlbmRlcnQuXG4gICAgICB0aGlzLmNsb3NlVHlwZVNldHRpbmdzKCk7XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgIH0pLm9wZW4oKTtcbiAgfVxuXG4gIC8vIFdpZSBzdGFydEVkaXRpbmcoKSwgYWJlciBhdWYgZGVtIGZyZWlzdGVoZW5kZW4gVGl0ZWwtRWxlbWVudCBkZXIgRGV0YWlsLUFuc2ljaHRcbiAgLy8gc3RhdHQgYXVmIGVpbmVtIFRyZWUtSXRlbSAtIHVuZCBtaXQgcmVzdWx0aWVyZW5kZW0gc2VsZWN0ZWRUeXBlLVdlY2hzZWwgc3RhdHRcbiAgLy8gZWluZXMgc2NobGljaHRlbiBSZS1SZW5kZXJzIGRlciBMaXN0ZS4gdXBkYXRlTm90ZXM6IHRydWUgKHp3ZWl0ZXIsIGhlcnZvci1cbiAgLy8gZ2Vob2JlbmVyIEJ1dHRvbikgc2NocmVpYnQgbmFjaCBCZXN0XHUwMEU0dGlndW5nIHp1c1x1MDBFNHR6bGljaCBkZW4gVFlQLVdlcnQgYWxsZXJcbiAgLy8gYmV0cm9mZmVuZW4gTm90aXplbiB1bSAoc2llaGUgcmVuYW1lVHlwZUluTm90ZXMpLCBzdGF0dCBudXIgZGllIFBsdWdpbi1cbiAgLy8gRWluc3RlbGx1bmdlbiB6dSBtaWdyaWVyZW4uXG4gIHN0YXJ0RGV0YWlsUmVuYW1lKHR5cGUsIHRpdGxlRWwsIHsgdXBkYXRlTm90ZXMgPSBmYWxzZSB9ID0ge30pIHtcbiAgICBpZiAodGhpcy5pc0VkaXRpbmcpIHJldHVybjtcbiAgICB0aGlzLmlzRWRpdGluZyA9IHRydWU7XG5cbiAgICB0aXRsZUVsLmFkZENsYXNzKFwiaXMtYmVpbmctcmVuYW1lZFwiKTtcbiAgICB0aXRsZUVsLnNldEF0dHJpYnV0ZShcImNvbnRlbnRlZGl0YWJsZVwiLCBcInRydWVcIik7XG4gICAgdGl0bGVFbC5zZXRBdHRyaWJ1dGUoXCJzcGVsbGNoZWNrXCIsIFwiZmFsc2VcIik7XG4gICAgdGl0bGVFbC5mb2N1cygpO1xuXG4gICAgY29uc3QgcmFuZ2UgPSB0aXRsZUVsLmRvYy5jcmVhdGVSYW5nZSgpO1xuICAgIHJhbmdlLnNlbGVjdE5vZGVDb250ZW50cyh0aXRsZUVsKTtcbiAgICBjb25zdCBzZWxlY3Rpb24gPSB0aXRsZUVsLndpbi5nZXRTZWxlY3Rpb24oKTtcbiAgICBzZWxlY3Rpb24ucmVtb3ZlQWxsUmFuZ2VzKCk7XG4gICAgc2VsZWN0aW9uLmFkZFJhbmdlKHJhbmdlKTtcblxuICAgIC8vIE1pZ3JpZXJ0IG51ciBkaWUgUGx1Z2luLUVpbnN0ZWxsdW5nZW4gKExpc3RlLCBGYXJiZSwgQmVzY2hyZWlidW5nLFxuICAgIC8vIFN0YW5kYXJkLUZyb250bWF0dGVyLCBNYW51ZWxsZXItVFlQLVNjaGFsdGVyKSBhdWYgZGVuIG5ldWVuIE5hbWVuIC1cbiAgICAvLyByXHUwMEZDaHJ0IGtlaW5lIE5vdGl6ZW4gYW4uIEdlbWVpbnNhbSBnZW51dHp0IHZvbiBiZWlkZW4gVW1iZW5lbm5lbi1QZmFkZW4uXG4gICAgY29uc3QgYXBwbHlSZW5hbWUgPSBhc3luYyAodmFsdWUpID0+IHtcbiAgICAgIGNvbnN0IGlkeCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVzLmluZGV4T2YodHlwZSk7XG4gICAgICBpZiAoaWR4ICE9PSAtMSkgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZXNbaWR4XSA9IHZhbHVlO1xuICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbdHlwZV07XG4gICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlQ29sb3JzW3R5cGVdO1xuICAgICAgfVxuICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbdHlwZV07XG4gICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVzY3JpcHRpb25zW3R5cGVdO1xuICAgICAgfVxuICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV07XG4gICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdO1xuICAgICAgfVxuICAgICAgaWYgKHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3ZhbHVlXSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVGbG9hdGluZ0tleXNbdHlwZV07XG4gICAgICAgIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdO1xuICAgICAgfVxuICAgICAgaWYgKHRoaXMuZW5zdXJlVHlwZU1hbnVhbCgpW3R5cGVdICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZU1hbnVhbFt2YWx1ZV0gPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBlTWFudWFsW3R5cGVdO1xuICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZU1hbnVhbFt0eXBlXTtcbiAgICAgIH1cbiAgICAgIG1vdmVUeXBlU3VidHlwZXModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cGUsIHZhbHVlKTtcbiAgICAgIC8vIFZvciByZWZyZXNoVHlwQ29sb3JzKCkgc2V0emVuOiBkYXMgcnVmdCAodS4gYS4gXHUwMEZDYmVyIGRlbiBpblxuICAgICAgLy8gcmVnaXN0ZXJUeXBWaWV3IHp1clx1MDBGQ2NrZ2VnZWJlbmVuIFJlZnJlc2gpIHN5bmNocm9uIHJlbmRlcigpIGF1ZiAtXG4gICAgICAvLyBzdFx1MDBGQ25kZSBzZWxlY3RlZFR5cGUgbm9jaCBhdWYgZGVtIGFsdGVuIChiZXJlaXRzIG1pZ3JpZXJ0ZW4sXG4gICAgICAvLyBkYWhlciBqZXR6dCBkYXRlbi1sb3NlbikgTmFtZW4sIHdcdTAwRkNyZGUga3VyenplaXRpZyBnZW5hdSBkZXIgQWx0LVxuICAgICAgLy8gTmFtZSBtaXQgbGVlcmVuIERhdGVuIGdlcmVuZGVydC5cbiAgICAgIHRoaXMuc2VsZWN0ZWRUeXBlID0gdmFsdWU7XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgIH07XG5cbiAgICBsZXQgZG9uZSA9IGZhbHNlO1xuICAgIGNvbnN0IGZpbmlzaCA9IGFzeW5jIChjb21taXQpID0+IHtcbiAgICAgIGlmIChkb25lKSByZXR1cm47XG4gICAgICBkb25lID0gdHJ1ZTtcbiAgICAgIHRoaXMuaXNFZGl0aW5nID0gZmFsc2U7XG5cbiAgICAgIGNvbnN0IHZhbHVlID0gbm9ybWFsaXplVHlwZU5hbWUodGl0bGVFbC50ZXh0Q29udGVudCk7XG4gICAgICBpZiAoIWNvbW1pdCB8fCAhdmFsdWUgfHwgdmFsdWUgPT09IHR5cGUpIHtcbiAgICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBleGlzdGluZyA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cGVzLmZpbmQoXG4gICAgICAgICh0KSA9PiB0LnRvTG93ZXJDYXNlKCkgPT09IHZhbHVlLnRvTG93ZXJDYXNlKCkgJiYgdCAhPT0gdHlwZVxuICAgICAgKTtcbiAgICAgIGlmIChleGlzdGluZykge1xuICAgICAgICB0aGlzLnNob3dNZXJnZUNvbmZpcm0odHlwZSwgZXhpc3RpbmcpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmICghdXBkYXRlTm90ZXMpIHtcbiAgICAgICAgYXdhaXQgYXBwbHlSZW5hbWUodmFsdWUpO1xuICAgICAgICB0aGlzLnJlbmRlcigpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIC8vIEJ1bGstU2NocmVpYnZvcmdhbmcgXHUwMEZDYmVyIHBvdGVuemllbGwgdmllbGUgRGF0ZWllbiAtIHZvcmhlciBiZXN0XHUwMEU0dGlnZW5cbiAgICAgIC8vIGxhc3Nlbiwgc3RhdHQgc29mb3J0IHp1IHNwZWljaGVybi5cbiAgICAgIGNvbnN0IHsgY291bnRzIH0gPSB0aGlzLnBsdWdpbi50eXBJbmRleC50eXBlQ291bnRzKCk7XG4gICAgICBuZXcgQ29uZmlybVJlbmFtZVR5cGVNb2RhbChcbiAgICAgICAgdGhpcy5wbHVnaW4sXG4gICAgICAgIHR5cGUsXG4gICAgICAgIHZhbHVlLFxuICAgICAgICBjb3VudHMuZ2V0KHR5cGUpID8/IDAsXG4gICAgICAgIGFzeW5jICgpID0+IHtcbiAgICAgICAgICBhd2FpdCBhcHBseVJlbmFtZSh2YWx1ZSk7XG4gICAgICAgICAgY29uc3QgcmVuYW1lZCA9IGF3YWl0IHJlbmFtZVR5cGVJbk5vdGVzKHRoaXMucGx1Z2luLCB0eXBlLCB2YWx1ZSk7XG4gICAgICAgICAgbmV3IE5vdGljZShgVFlQICR7dmFsdWV9OiAke3JlbmFtZWR9IE5vdGl6KGVuKSBhbmdlcGFzc3QuYCk7XG4gICAgICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgICAgfSxcbiAgICAgICAgKCkgPT4gdGhpcy5yZW5kZXIoKVxuICAgICAgKS5vcGVuKCk7XG4gICAgfTtcblxuICAgIHRpdGxlRWwuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVudGVyXCIpIHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgIGZpbmlzaCh0cnVlKTtcbiAgICAgIH0gZWxzZSBpZiAoZXZlbnQua2V5ID09PSBcIkVzY2FwZVwiKSB7XG4gICAgICAgIC8vIHN0b3BQcm9wYWdhdGlvbiwgc29uc3QgZ3JlaWZ0IHp1c1x1MDBFNHR6bGljaCBkZXIgRXNjYXBlLUhhbmRsZXIgZGVyXG4gICAgICAgIC8vIGdlc2FtdGVuIERldGFpbC1BbnNpY2h0IHVuZCB2ZXJsXHUwMEU0c3N0IHNpZSBnbGVpY2ggbWl0LlxuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgZmluaXNoKGZhbHNlKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHRpdGxlRWwuYWRkRXZlbnRMaXN0ZW5lcihcImJsdXJcIiwgKCkgPT4gZmluaXNoKHRydWUpKTtcbiAgfVxuXG4gIHNob3dNZXJnZUNvbmZpcm0oc291cmNlLCB0YXJnZXQpIHtcbiAgICBjb25zdCB7IGNvdW50cyB9ID0gdGhpcy5wbHVnaW4udHlwSW5kZXgudHlwZUNvdW50cygpO1xuICAgIG5ldyBDb25maXJtTWVyZ2VUeXBlTW9kYWwoXG4gICAgICB0aGlzLnBsdWdpbixcbiAgICAgIHNvdXJjZSxcbiAgICAgIHRhcmdldCxcbiAgICAgIGNvdW50cy5nZXQoc291cmNlKSA/PyAwLFxuICAgICAgKCkgPT4gdGhpcy5tZXJnZVR5cGUoc291cmNlLCB0YXJnZXQpLFxuICAgICAgKCkgPT4gdGhpcy5yZW5kZXIoKVxuICAgICkub3BlbigpO1xuICB9XG5cbiAgLy8gTGVndCBzb3VyY2UgaW4gdGFyZ2V0IGF1ZjogTm90aXplbiB3ZXJkZW4gYXVmIHRhcmdldCB1bWdlc2NocmllYmVuLFxuICAvLyBzb3VyY2UgdmVyc2Nod2luZGV0IGF1cyBkZXIgVFlQLUxpc3RlIHNhbXQgZWlnZW5lciBFaW5zdGVsbHVuZ2VuICh0YXJnZXRcbiAgLy8gYmVoXHUwMEU0bHQgc2VpbmUpLiBEaWUgU3VidHlwZW4gdm9uIHNvdXJjZSB3ZXJkZW4gXHUwMEZDYmVybm9tbWVuLCBnbGVpY2huYW1pZ2VcbiAgLy8gQmxcdTAwRjZja2UgenVzYW1tZW5nZWZcdTAwRkNocnQgKHNpZWhlIG1lcmdlVHlwZVN1YnR5cGVzIGluIHN1YnR5cGVzLmpzKS5cbiAgYXN5bmMgbWVyZ2VUeXBlKHNvdXJjZSwgdGFyZ2V0KSB7XG4gICAgY29uc3Qgc2V0dGluZ3MgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncztcbiAgICBjb25zdCByZW5hbWVkID0gYXdhaXQgcmVuYW1lVHlwZUluTm90ZXModGhpcy5wbHVnaW4sIHNvdXJjZSwgdGFyZ2V0KTtcblxuICAgIHNldHRpbmdzLnR5cGVzID0gc2V0dGluZ3MudHlwZXMuZmlsdGVyKCh0KSA9PiB0ICE9PSBzb3VyY2UpO1xuICAgIGRlbGV0ZSBzZXR0aW5ncy50eXBlQ29sb3JzW3NvdXJjZV07XG4gICAgZGVsZXRlIHNldHRpbmdzLnR5cGVEZXNjcmlwdGlvbnNbc291cmNlXTtcbiAgICBkZWxldGUgc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlcltzb3VyY2VdO1xuICAgIGRlbGV0ZSBzZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3NvdXJjZV07XG4gICAgZGVsZXRlIHRoaXMuZW5zdXJlVHlwZU1hbnVhbCgpW3NvdXJjZV07XG4gICAgbWVyZ2VUeXBlU3VidHlwZXMoc2V0dGluZ3MsIHNvdXJjZSwgdGFyZ2V0KTtcblxuICAgIC8vIFZvciByZWZyZXNoVHlwQ29sb3JzKCkgc2V0emVuLCBhdXMgZGVtc2VsYmVuIEdydW5kIHdpZSBpbiBhcHBseVJlbmFtZS5cbiAgICB0aGlzLnNlbGVjdGVkVHlwZSA9IHRhcmdldDtcbiAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICBuZXcgTm90aWNlKGBUWVAgJHtzb3VyY2V9IG1pdCAke3RhcmdldH0genVzYW1tZW5nZWxlZ3QsICR7cmVuYW1lZH0gTm90aXooZW4pIGFuZ2VwYXNzdC5gKTtcbiAgICB0aGlzLnJlbmRlcigpO1xuICB9XG5cbiAgcmVuZGVyQ291bnRGbGFpcihzZWxmLCBjb3VudCkge1xuICAgIGNvbnN0IGZsYWlyT3V0ZXIgPSBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0tZmxhaXItb3V0ZXJcIiB9KTtcbiAgICBmbGFpck91dGVyLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHJlZS1pdGVtLWZsYWlyXCIsIHRleHQ6IFN0cmluZyhjb3VudCkgfSk7XG4gIH1cblxuICAvLyBSZWluIGluZm9ybWF0aXYsIHVudGVyIGRlbSBTdGFuZGFyZC1Gcm9udG1hdHRlci1FZGl0b3I6IGRlciBIaW53ZWlzdGV4dFxuICAvLyBlcmtsXHUwMEU0cnQgZGVuIEZsb2F0aW5nLVByb3BlcnR5LVRvZ2dsZSAoUmVjaHRza2xpY2sgYXVmIGVpbmUgUHJvcGVydHkgb2JlbixcbiAgLy8gc2llaGUgZW5zdXJlUHJvcGVydHlNZW51UGF0Y2ggaW4gdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpLCBkaWUgTGlzdGVcbiAgLy8gZGFydW50ZXIgZGllIFBsYXR6aGFsdGVyLCBkaWUgYWxzIFdlcnQgZWluZXIgUHJvcGVydHkgZWluZ2V0cmFnZW4gd2VyZGVuXG4gIC8vIGtcdTAwRjZubmVuICh6LiBCLiBiZWkgXCJEYXR1bVwiIGRlciBUZXh0IFwie3t0b2RheX19XCIpIC0gZ2V0VHlwZURlZmF1bHRzKClcbiAgLy8gKG1haW4uanMpIGxcdTAwRjZzdCBzaWUgYmVpIGplZGVtIEFicnVmIGZyaXNjaCBhdWYsIHNpZWhlXG4gIC8vIGZyb250bWF0dGVyLXBsYWNlaG9sZGVycy5qcy4gQmV3dXNzdCBvaG5lIGVpZ2VuZSBcdTAwRENiZXJzY2hyaWZ0LCBkYSBkaXJla3RcbiAgLy8gdW50ZXIgZGVyIFByb3BlcnR5LUxpc3RlIG9obmVoaW4ga2xhciBpc3QsIHdvcmF1ZiBzaWNoIGJlaWRlcyBiZXppZWh0LlxuICByZW5kZXJQbGFjZWhvbGRlckxpc3QocGFyZW50KSB7XG4gICAgY29uc3Qgc2VjdGlvbiA9IHBhcmVudC5jcmVhdGVEaXYoeyBjbHM6IFwiZnJlZC10eXAtcGxhY2Vob2xkZXItc2VjdGlvblwiIH0pO1xuICAgIGNvbnN0IGxpc3QgPSBzZWN0aW9uLmNyZWF0ZURpdih7IGNsczogXCJmcmVkLXR5cC1wbGFjZWhvbGRlci1saXN0XCIgfSk7XG4gICAgZm9yIChjb25zdCB7IHRva2VuLCBkZXNjcmlwdGlvbiB9IG9mIFsuLi5GUk9OVE1BVFRFUl9QTEFDRUhPTERFUlMsIERZTkFNSUNfUExBQ0VIT0xERVJfSU5GT10pIHtcbiAgICAgIGNvbnN0IHJvdyA9IGxpc3QuY3JlYXRlRGl2KHsgY2xzOiBcImZyZWQtdHlwLXBsYWNlaG9sZGVyLXJvd1wiIH0pO1xuICAgICAgcm93LmNyZWF0ZUVsKFwiY29kZVwiLCB7IGNsczogXCJmcmVkLXR5cC1wbGFjZWhvbGRlci10b2tlblwiLCB0ZXh0OiB0b2tlbiB9KTtcbiAgICAgIHJvdy5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLXBsYWNlaG9sZGVyLWRlc2NcIiwgdGV4dDogZGVzY3JpcHRpb24gfSk7XG4gICAgfVxuICAgIHNlY3Rpb24uY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJmcmVkLXR5cC1wbGFjZWhvbGRlci1oaW50XCIsXG4gICAgICB0ZXh0OiBcIllvdSBjYW4gY2hhbmdlIGEgcHJvcGVydHkgdG8gZmxvYXRpbmcgaW4gdGhlIHJpZ2h0LWNsaWNrIG1lbnUuXCIsXG4gICAgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJUeXBWaWV3KHBsdWdpbikge1xuICBwbHVnaW4ucmVnaXN0ZXJWaWV3KFZJRVdfVFlQRV9UWVAsIChsZWFmKSA9PiBuZXcgVHlwVmlldyhsZWFmLCBwbHVnaW4pKTtcblxuICBwbHVnaW4uYWRkQ29tbWFuZCh7XG4gICAgaWQ6IFwidHlwLXZpZXctb2VmZm5lblwiLFxuICAgIG5hbWU6IFwiVFlQIC0gVFlQLVZpZXcgXHUwMEY2ZmZuZW5cIixcbiAgICBjYWxsYmFjazogKCkgPT4gYWN0aXZhdGVUeXBWaWV3KHBsdWdpbiksXG4gIH0pO1xuXG4gIHBsdWdpbi5hZGRDb21tYW5kKHtcbiAgICBpZDogXCJ0eXAtcHJvcGVydHktaGluenVmdWVnZW5cIixcbiAgICBuYW1lOiBcIlRZUCAtIFN0YW5kYXJkLVByb3BlcnR5IGhpbnp1Zlx1MDBGQ2dlblwiLFxuICAgIGNhbGxiYWNrOiAoKSA9PiBhZGRUeXBQcm9wZXJ0eUNvbW1hbmQocGx1Z2luKSxcbiAgfSk7XG5cbiAgcGx1Z2luLmFkZENvbW1hbmQoe1xuICAgIGlkOiBcInR5cC1oaW56dWZ1ZWdlblwiLFxuICAgIG5hbWU6IFwiVFlQIC0gTmV1ZW4gVFlQIGhpbnp1Zlx1MDBGQ2dlblwiLFxuICAgIGNhbGxiYWNrOiAoKSA9PiBhZGRUeXBDb21tYW5kKHBsdWdpbiksXG4gIH0pO1xuXG4gIC8vIEJlaW0gSG90LVJlbG9hZCBibGVpYnQgZGVyIGFsdGUgTGVhZiBhbHMgT2JqZWt0IHVuYW5nZXRhc3RldCBiZXN0ZWhlbiAobnVyXG4gIC8vIHVuc2VyIFBsdWdpbi1Nb2R1bCB3aXJkIG5ldSBnZWxhZGVuKSwgYWJlciBcImluc3RhbmNlb2YgVHlwVmlld1wiIHNjaGxcdTAwRTRndCBnZWdlblxuICAvLyBkaWUgbmV1IGdlbGFkZW5lIEtsYXNzZSBmZWhsLiBhcHAuanMgc2VsYnN0IGJlc3RpbW10IGdldFZpZXdUeXBlKCkgcmVpbiBhdXNcbiAgLy8gbGVhZi52aWV3IC0gZGFzIHJlaWNodCB6dXIgRXJrZW5udW5nIGFsc28gbmljaHQuIGFwcCBzZWxic3QgXHUwMEZDYmVybGVidCBkZW5cbiAgLy8gSG90LVJlbG9hZCBkYWdlZ2VuIHVudmVyXHUwMEU0bmRlcnQsIGRhaGVyIGRpZSBMZWFmLVJlZmVyZW56IGRpcmVrdCBkb3J0IGFibGVnZW4uXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4gYWN0aXZhdGVUeXBWaWV3KHBsdWdpbiwgZmFsc2UsIGZhbHNlKSk7XG5cbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFZJRVdfVFlQRV9UWVApKSB7XG4gICAgICBsZWFmLnZpZXc/LnJlbmRlcj8uKCk7XG4gICAgfVxuICB9O1xuXG4gIC8vIFpcdTAwRTRobGVyIChMaXN0ZSB1bmQgUGlja2VyLCBzaWVoZSB0eXBJbmRleC50eXBlQ291bnRzKCkpIHNvbnN0IG51ciBzbyBha3R1ZWxsXG4gIC8vIHdpZSBiZWltIGxldHp0ZW4gUmVuZGVyIGRpZXNlciBWaWV3IC0gamVkZSBUWVAtcmVsZXZhbnRlIFx1MDBDNG5kZXJ1bmcgYW5kZXJzd29cbiAgLy8gKG5ldWUvZ2VsXHUwMEY2c2NodGUgTm90aXosIFRZUCBvZGVyIFNVQlRZUCB1bWdldHJhZ2VuKSBsaWVcdTAwREZlIHNpZSBzb25zdCB2ZXJhbHRlbixcbiAgLy8gYmlzIGlyZ2VuZGVpbiBhbmRlcmVyIEdydW5kICh6LiBCLiBlaW5lIEVpbnN0ZWxsdW5nKSB6dWZcdTAwRTRsbGlnIGVpbmVuIFJlZnJlc2hcbiAgLy8gYXVzbFx1MDBGNnN0LiBEYXMgXCJjaGFuZ2VcIi1FdmVudCBkZXMgSW5kZXggZmV1ZXJ0IG51ciBiZWkgZ2VuYXUgc29sY2hlblxuICAvLyBcdTAwQzRuZGVydW5nZW4sIG5pY2h0IGJlaSBqZWRlbSBBdXRvc2F2ZS1UaWNrLiBUcm90emRlbSBkZWJvdW5jZWQsIGRhIGRhc1xuICAvLyBSZW5kZXJuIGRlciBMaXN0ZSB2ZXJnbGVpY2hzd2Vpc2UgdGV1ZXIgaXN0IC0gcmVzZXRUaW1lcjp0cnVlIHNhbW1lbHQgZWluZVxuICAvLyBcdTAwQzRuZGVydW5nc3NlcmllICh6LiBCLiBCdWxrLUltcG9ydCkgenUgZWluZW0gZWluemlnZW4gUmVmcmVzaC5cbiAgY29uc3QgZGVib3VuY2VkUmVmcmVzaCA9IGRlYm91bmNlKHJlZnJlc2gsIDUwMCwgdHJ1ZSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCBkZWJvdW5jZWRSZWZyZXNoKSk7XG4gIC8vIFx1MDBDNG5kZXJ0IGRpZSBcIkV4Y2x1ZGVkIGZpbGVzXCItTGlzdGUgc2VsYnN0ICh6LiBCLiBIaWRlIEZvbGRlcnMgYmVpbSBBdXMtL1xuICAvLyBFaW5ibGVuZGVuIGVpbmVzIE9yZG5lcnMpIC0gT2JzaWRpYW5zIGVpZ2VuZXIgTWV0YWRhdGFDYWNoZSBsYXVzY2h0IGludGVyblxuICAvLyBlYmVuZmFsbHMgZ2VuYXUgYXVmIGRpZXNlcyBFdmVudCwgdW0gc2VpbmUgSWdub3JlLUZpbHRlciBuZXUgenUgbGFkZW4uXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAudmF1bHQub24oXCJjb25maWctY2hhbmdlZFwiLCBkZWJvdW5jZWRSZWZyZXNoKSk7XG5cbiAgLy8gRlx1MDBGQ3IgcGx1Z2luLnJlZnJlc2hUeXBDb2xvcnMgKHouIEIuIG5hY2ggVW1zY2hhbHRlbiBkZXIgXCJUWVAtTGlzdGVcbiAgLy8gZWluZlx1MDBFNHJiZW5cIi1FaW5zdGVsbHVuZykgLSByZW5kZXJ0IGRpZSBMaXN0ZSAoYnp3LiBibGVpYnQgaW4gZGVyXG4gIC8vIERldGFpbGFuc2ljaHQsIHJlbmRlcigpIGJyYW5jaCd0IHNlbGJzdCkgbmV1LlxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxuLy8gY3JlYXRlSWZNaXNzaW5nOiBmYWxzZSBiZWltIGF1dG9tYXRpc2NoZW4gb25MYXlvdXRSZWFkeS1BdWZydWYgKHNpZWhlXG4vLyByZWdpc3RlclR5cFZpZXcpIC0gZGVyIHNvbGwgYXVzc2NobGllXHUwMERGbGljaCBlaW5lbiBiZWltIEhvdC1SZWxvYWQgdmVyd2Fpc3Rlbixcbi8vIGFiZXIgYmVyZWl0cyB2b3JoYW5kZW5lbiBMZWFmIHdpZWRlcnZlcmJpbmRlbiAoc2llaGUgS29tbWVudGFyIGRvcnQpLCBuaWNodFxuLy8gYmVpIGplZGVtIHJlZ3VsXHUwMEU0cmVuIE9ic2lkaWFuLVN0YXJ0IHVuY29uZGl0aW9uYWwgZWluZW4gbmV1ZW4gTGVhZiBlcnpldWdlblxuLy8gdW5kIGFrdGl2aWVyZW4uIFdhciBkaWUgVFlQLVBhbmUgYmVpbSBsZXR6dGVuIEJlZW5kZW4gZ2VzY2hsb3NzZW4gKG9kZXJcbi8vIGVpbmVtIGZyaXNjaGVuIFZhdWx0KSwgYmxlaWJ0IHNpZSBvaG5lIGRpZXNlIFVudGVyc2NoZWlkdW5nIHNvbnN0IGF1Y2ggenUuXG5hc3luYyBmdW5jdGlvbiBhY3RpdmF0ZVR5cFZpZXcocGx1Z2luLCByZXZlYWwgPSB0cnVlLCBjcmVhdGVJZk1pc3NpbmcgPSB0cnVlKSB7XG4gIGNvbnN0IGFwcCA9IHBsdWdpbi5hcHA7XG4gIGNvbnN0IHsgd29ya3NwYWNlIH0gPSBhcHA7XG5cbiAgY29uc3QgY2FuZGlkYXRlcyA9IFtdO1xuICB3b3Jrc3BhY2UuaXRlcmF0ZUFsbExlYXZlcygobGVhZikgPT4ge1xuICAgIGlmIChsZWFmID09PSBhcHAuX19mcmVkVHlwTGVhZiB8fCAobGVhZi52aWV3ICYmIGxlYWYudmlldy5nZXRWaWV3VHlwZSgpID09PSBWSUVXX1RZUEVfVFlQKSkge1xuICAgICAgY2FuZGlkYXRlcy5wdXNoKGxlYWYpO1xuICAgIH1cbiAgfSk7XG5cbiAgbGV0IGxlYWYgPSBjYW5kaWRhdGVzLnNoaWZ0KCkgPz8gbnVsbDtcbiAgZm9yIChjb25zdCBleHRyYSBvZiBjYW5kaWRhdGVzKSBleHRyYS5kZXRhY2goKTtcblxuICBpZiAoIWxlYWYpIHtcbiAgICBpZiAoIWNyZWF0ZUlmTWlzc2luZykgcmV0dXJuO1xuICAgIGxlYWYgPSB3b3Jrc3BhY2UuZ2V0TGVmdExlYWYoZmFsc2UpO1xuICAgIGF3YWl0IGxlYWYuc2V0Vmlld1N0YXRlKHsgdHlwZTogVklFV19UWVBFX1RZUCwgYWN0aXZlOiB0cnVlIH0pO1xuICB9IGVsc2UgaWYgKCEobGVhZi52aWV3IGluc3RhbmNlb2YgVHlwVmlldykpIHtcbiAgICAvLyBhY3RpdmU6IGZhbHNlIC0gcmVpbmVzIFdpZWRlcnZlcmJpbmRlbiBuYWNoIEhvdC1SZWxvYWQgKHNpZWhlIEtvbW1lbnRhclxuICAgIC8vIG9iZW4gYW4gYWN0aXZhdGVUeXBWaWV3KSwgZGVyIExlYWYgaXN0IGphIGJlcmVpdHMgdm9yaGFuZGVuL3NpY2h0YmFyLlxuICAgIC8vIE1pdCBhY3RpdmU6IHRydWUgd1x1MDBGQ3JkZSBqZWRlciBQbHVnaW4tUmVsb2FkIChuaWNodCBudXIgZWluIEFwcC1OZXVzdGFydClcbiAgICAvLyBkZW4gZ2xvYmFsZW4gRm9rdXMgYXVmIGRpZSBUWVAtUGFuZSByZWlcdTAwREZlbiAtIG9uTGF5b3V0UmVhZHkoKSBmZXVlcnRcbiAgICAvLyBzZWluZW4gQ2FsbGJhY2sgc29mb3J0LCBzb2JhbGQgd29ya3NwYWNlLmxheW91dFJlYWR5IGVpbm1hbCB0cnVlIGlzdCxcbiAgICAvLyBhbHNvIGJlaSBqZWRlbSBlaW56ZWxuZW4gSG90LVJlbG9hZCB3XHUwMEU0aHJlbmQgZGVyIEVudHdpY2tsdW5nIGVybmV1dC5cbiAgICBhd2FpdCBsZWFmLnNldFZpZXdTdGF0ZSh7IHR5cGU6IFZJRVdfVFlQRV9UWVAsIGFjdGl2ZTogZmFsc2UgfSk7XG4gIH1cblxuICBhcHAuX19mcmVkVHlwTGVhZiA9IGxlYWY7XG4gIGlmIChyZXZlYWwpIHdvcmtzcGFjZS5yZXZlYWxMZWFmKGxlYWYpO1xufVxuXG4vLyBWb3JyYW5naWcgaW4gZGVyIGJlcmVpdHMgb2ZmZW5lbiBUWVAtRGV0YWlsYW5zaWNodCAoZGFubiBleGFrdCB3aWUgZGVyXG4vLyBkb3J0aWdlICstQnV0dG9uKSwgc29uc3Qgd2lyZCBkaWUgRGV0YWlsYW5zaWNodCBmXHUwMEZDciBkZW4gVFlQIGRlciBha3RpdmVuXG4vLyBOb3RpeiBnZVx1MDBGNmZmbmV0IHVuZCBkaWUgUHJvcGVydHkgZG9ydCBlcmdcdTAwRTRuenQuIElzdCBudXIgZGllIFRZUGVuLUxpc3RlXG4vLyBvZmZlbiAoa2VpbiBzZWxlY3RlZFR5cGUpLCB6XHUwMEU0aGx0IGRhcyBuaWNodCBhbHMgXCJha3RpdmUgRGV0YWlsYW5zaWNodFwiIC1cbi8vIGRhZlx1MDBGQ3IgZmVobHQgZG9ydCBlaW4gRnJvbnRtYXR0ZXItRWRpdG9yLCBhbiBkZW0gc2ljaCBldHdhcyBoaW56dWZcdTAwRkNnZW4gbGllXHUwMERGZS5cbmFzeW5jIGZ1bmN0aW9uIGFkZFR5cFByb3BlcnR5Q29tbWFuZChwbHVnaW4pIHtcbiAgY29uc3QgYXBwID0gcGx1Z2luLmFwcDtcblxuICBjb25zdCBhY3RpdmVUeXBWaWV3ID0gYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKFR5cFZpZXcpO1xuICBpZiAoYWN0aXZlVHlwVmlldyAmJiBhY3RpdmVUeXBWaWV3LnNlbGVjdGVkVHlwZSAhPT0gbnVsbCkge1xuICAgIGFjdGl2ZVR5cFZpZXcuZnJvbnRtYXR0ZXJFZGl0b3I/LmZyZWRBZGRCbGFuayhudWxsKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBmaWxlID0gYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gIGNvbnN0IHR5cGUgPSBwbHVnaW4udHlwSW5kZXgudHlwZU9mKGZpbGUpO1xuICBpZiAoIXR5cGUpIHtcbiAgICBuZXcgTm90aWNlKFwiQWt0aXZlIE5vdGl6IGhhdCBrZWluZW4gVFlQLlwiKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBhd2FpdCBhY3RpdmF0ZVR5cFZpZXcocGx1Z2luKTtcbiAgY29uc3QgdmlldyA9IGFwcC5fX2ZyZWRUeXBMZWFmPy52aWV3O1xuICBpZiAoISh2aWV3IGluc3RhbmNlb2YgVHlwVmlldykpIHJldHVybjtcbiAgdmlldy5vcGVuVHlwZVNldHRpbmdzKHR5cGUpO1xuICB2aWV3LmZyb250bWF0dGVyRWRpdG9yPy5mcmVkQWRkQmxhbmsobnVsbCk7XG59XG5cbi8vIFx1MDBENmZmbmV0IGJlaSBCZWRhcmYgZXJzdCBkaWUgVFlQLVZpZXcgKGJ6dy4gdmVybFx1MDBFNHNzdCBlaW5lIG9mZmVuZSBEZXRhaWxhbnNpY2h0XG4vLyB6dXJcdTAwRkNjayB6dXIgTGlzdGUgLSBzdGFydEFkZCgpIGxlZ3QgZGFzIG5ldWUgVHJlZS1JdGVtIGluIHRoaXMubGlzdEVsIGFuLCBkYXNcbi8vIGVzIG51ciBpbiBkZXIgTGlzdGVuYW5zaWNodCBnaWJ0KSwgdW5kIHN0XHUwMEY2XHUwMERGdCBkb3J0IGRlbnNlbGJlbiBBYmxhdWYgd2llIGRlclxuLy8gKy1CdXR0b24gaW0gTGlzdGVuLUhlYWRlciBhbi5cbmFzeW5jIGZ1bmN0aW9uIGFkZFR5cENvbW1hbmQocGx1Z2luKSB7XG4gIGF3YWl0IGFjdGl2YXRlVHlwVmlldyhwbHVnaW4pO1xuICBjb25zdCB2aWV3ID0gcGx1Z2luLmFwcC5fX2ZyZWRUeXBMZWFmPy52aWV3O1xuICBpZiAoISh2aWV3IGluc3RhbmNlb2YgVHlwVmlldykpIHJldHVybjtcbiAgaWYgKHZpZXcuc2VsZWN0ZWRUeXBlICE9PSBudWxsKSB2aWV3LmNsb3NlVHlwZVNldHRpbmdzKCk7XG4gIHZpZXcuc3RhcnRBZGQoKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyVHlwVmlldywgVklFV19UWVBFX1RZUCwgY29tcGFyZVR5cGVzLCBzb3J0VHlwZXNCeU1vZGUsIERFRkFVTFRfU09SVF9PUkRFUiwgREVGQVVMVF9UWVBFX0NPTE9SIH07XG4iLCAiZnVuY3Rpb24gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSkge1xuICBjb25zdCB0eXBlID0gcGx1Z2luLnR5cEluZGV4LnR5cGVPZihmaWxlKTtcbiAgcmV0dXJuIHR5cGUgPyBwbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1t0eXBlXSA/PyBudWxsIDogbnVsbDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IGNvbG9yRm9yRmlsZSB9O1xuIiwgImNvbnN0IHsgVEZpbGUsIFRGb2xkZXIgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgY29sb3JGb3JGaWxlIH0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcblxuY29uc3QgRklMRV9FWFBMT1JFUl9WSUVXX1RZUEUgPSBcImZpbGUtZXhwbG9yZXJcIjtcbmNvbnN0IEZPTERFUl9OT1RFU19QTFVHSU5fSUQgPSBcImZvbGRlci1ub3Rlc1wiO1xuXG4vLyBEYXMgXCJGb2xkZXIgTm90ZXNcIi1QbHVnaW4gemVpZ3QgZWluZSBOb3RpeiBzdGF0dCBhbHMgZWlnZW5lIFplaWxlIGFscyBPcmRuZXIgYW4uXG4vLyBFcyBoYXQga2VpbmUgXHUwMEY2ZmZlbnRsaWNoZSBBUEkgZGFmXHUwMEZDciwgZGFoZXIgZGVuIERhdGVpbmFtZW4gYXVzIHNlaW5lbiBlaWdlbmVuXG4vLyAoTGl2ZS0pRWluc3RlbGx1bmdlbiBuYWNoYmF1ZW4sIHN0YXR0IHNlaW5lIGludGVybmVuIEZ1bmt0aW9uZW4gYW56dXphcGZlbi5cbmZ1bmN0aW9uIGdldEZvbGRlck5vdGVGaWxlKHBsdWdpbiwgZm9sZGVyKSB7XG4gIGNvbnN0IGZvbGRlck5vdGVzID0gcGx1Z2luLmFwcC5wbHVnaW5zLnBsdWdpbnNbRk9MREVSX05PVEVTX1BMVUdJTl9JRF07XG4gIGNvbnN0IHNldHRpbmdzID0gZm9sZGVyTm90ZXM/LnNldHRpbmdzO1xuICBpZiAoIXNldHRpbmdzKSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBmaWxlTmFtZSA9XG4gICAgKHNldHRpbmdzLmZvbGRlck5vdGVOYW1lIHx8IFwie3tmb2xkZXJfbmFtZX19XCIpLnJlcGxhY2UoXCJ7e2ZvbGRlcl9uYW1lfX1cIiwgZm9sZGVyLm5hbWUpICtcbiAgICAoc2V0dGluZ3MuZm9sZGVyTm90ZVR5cGUgfHwgXCIubWRcIik7XG4gIGNvbnN0IGRpclBhdGggPSBzZXR0aW5ncy5zdG9yYWdlTG9jYXRpb24gPT09IFwicGFyZW50Rm9sZGVyXCIgPyBmb2xkZXIucGFyZW50Py5wYXRoID8/IFwiXCIgOiBmb2xkZXIucGF0aDtcbiAgY29uc3QgcGF0aCA9IGRpclBhdGggPyBgJHtkaXJQYXRofS8ke2ZpbGVOYW1lfWAgOiBmaWxlTmFtZTtcblxuICBjb25zdCBmaWxlID0gcGx1Z2luLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgocGF0aCk7XG4gIHJldHVybiBmaWxlIGluc3RhbmNlb2YgVEZpbGUgPyBmaWxlIDogbnVsbDtcbn1cblxuZnVuY3Rpb24gYXBwbHlDb2xvclRvVGl0bGUocGx1Z2luLCB0aXRsZUVsLCBmaWxlKSB7XG4gIGNvbnN0IGNvbnRlbnRFbCA9IHRpdGxlRWwucXVlcnlTZWxlY3RvcihcIi5uYXYtZmlsZS10aXRsZS1jb250ZW50LCAubmF2LWZvbGRlci10aXRsZS1jb250ZW50XCIpO1xuICBpZiAoIWNvbnRlbnRFbCkgcmV0dXJuO1xuXG4gIGNvbnN0IGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MuZmlsZUV4cGxvcmVyID8gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSkgOiBudWxsO1xuICBpZiAoY29sb3IpIGNvbnRlbnRFbC5zdHlsZS5jb2xvciA9IGNvbG9yO1xuICBlbHNlIGNvbnRlbnRFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImNvbG9yXCIpO1xufVxuXG5mdW5jdGlvbiBhcHBseUZpbGVFeHBsb3JlckNvbG9ycyhwbHVnaW4pIHtcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShGSUxFX0VYUExPUkVSX1ZJRVdfVFlQRSkpIHtcbiAgICBjb25zdCBmaWxlVGl0bGVFbHMgPSBsZWFmLnZpZXcuY29udGFpbmVyRWwucXVlcnlTZWxlY3RvckFsbChcIi5uYXYtZmlsZS10aXRsZVtkYXRhLXBhdGhdXCIpO1xuICAgIGZvciAoY29uc3QgdGl0bGVFbCBvZiBmaWxlVGl0bGVFbHMpIHtcbiAgICAgIGNvbnN0IGZpbGUgPSBwbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aCh0aXRsZUVsLmdldEF0dHJpYnV0ZShcImRhdGEtcGF0aFwiKSk7XG4gICAgICBhcHBseUNvbG9yVG9UaXRsZShwbHVnaW4sIHRpdGxlRWwsIGZpbGUgaW5zdGFuY2VvZiBURmlsZSA/IGZpbGUgOiBudWxsKTtcbiAgICB9XG5cbiAgICBjb25zdCBmb2xkZXJUaXRsZUVscyA9IGxlYWYudmlldy5jb250YWluZXJFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLm5hdi1mb2xkZXItdGl0bGVbZGF0YS1wYXRoXVwiKTtcbiAgICBmb3IgKGNvbnN0IHRpdGxlRWwgb2YgZm9sZGVyVGl0bGVFbHMpIHtcbiAgICAgIGNvbnN0IGZvbGRlciA9IHBsdWdpbi5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHRpdGxlRWwuZ2V0QXR0cmlidXRlKFwiZGF0YS1wYXRoXCIpKTtcbiAgICAgIGNvbnN0IG5vdGVGaWxlID0gZm9sZGVyIGluc3RhbmNlb2YgVEZvbGRlciA/IGdldEZvbGRlck5vdGVGaWxlKHBsdWdpbiwgZm9sZGVyKSA6IG51bGw7XG4gICAgICBhcHBseUNvbG9yVG9UaXRsZShwbHVnaW4sIHRpdGxlRWwsIG5vdGVGaWxlKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJGaWxlRXhwbG9yZXJDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseUZpbGVFeHBsb3JlckNvbG9ycyhwbHVnaW4pO1xuXG4gIC8vIERlciBGaWxlLUV4cGxvcmVyIHJlbmRlcnQgRWludHJcdTAwRTRnZSBiZWltIEF1Zi0vWnVrbGFwcGVuIHZvbiBPcmRuZXJuIGR5bmFtaXNjaFxuICAvLyBuZXUgLSBwZXIgTXV0YXRpb25PYnNlcnZlciBhdWYgbmV1IGVpbmdlZlx1MDBGQ2d0ZSBFbGVtZW50ZSByZWFnaWVyZW4sIHN0YXR0IG51clxuICAvLyBlaW5tYWxpZyBiZWltIFN0YXJ0IGVpbnp1Zlx1MDBFNHJiZW4uXG4gIGNvbnN0IG9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIocmVmcmVzaCk7XG4gIGNvbnN0IG9ic2VydmVFeHBsb3JlckxlYXZlcyA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEZJTEVfRVhQTE9SRVJfVklFV19UWVBFKSkge1xuICAgICAgb2JzZXJ2ZXIub2JzZXJ2ZShsZWFmLnZpZXcuY29udGFpbmVyRWwsIHsgY2hpbGRMaXN0OiB0cnVlLCBzdWJ0cmVlOiB0cnVlIH0pO1xuICAgIH1cbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IG9ic2VydmVyLmRpc2Nvbm5lY3QoKSk7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC52YXVsdC5vbihcInJlbmFtZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KFxuICAgIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICBvYnNlcnZlRXhwbG9yZXJMZWF2ZXMoKTtcbiAgICAgIHJlZnJlc2goKTtcbiAgICB9KVxuICApO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgIG9ic2VydmVFeHBsb3JlckxlYXZlcygpO1xuICAgIHJlZnJlc2goKTtcbiAgfSk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckZpbGVFeHBsb3JlckNvbG9ycyB9O1xuIiwgImNvbnN0IHsgY29sb3JGb3JGaWxlIH0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcblxuY29uc3QgR1JBUEhfVklFV19UWVBFUyA9IFtcImdyYXBoXCIsIFwibG9jYWxncmFwaFwiXTtcblxuZnVuY3Rpb24gaGV4VG9JbnQoaGV4KSB7XG4gIHJldHVybiBwYXJzZUludChoZXgucmVwbGFjZShcIiNcIiwgXCJcIiksIDE2KTtcbn1cblxuLy8gZW5naW5lLnJlbmRlcigpIGxpZXN0IHNlaW4gaW50ZXJuZXMgZmlsZUZpbHRlci1PYmpla3QgbnVyIGF1cywgd2VubiBiZXJlaXRzXG4vLyBtaW5kZXN0ZW5zIGVpbmUgZWlnZW5lIEZhcmJncnVwcGUvRmlsdGVyLVF1ZXJ5IGFrdGl2IGlzdCAtIG9obmUgZWlnZW5lIEdydXBwZW5cbi8vIGJla29tbXQgamVkZSBEYXRlaSBwYXVzY2hhbCBjb2xvcjp0cnVlIChrZWluIEZhcmJ3ZXJ0KSwgZmlsZUZpbHRlciB3aXJkIGdhclxuLy8gbmljaHQgZXJzdCBrb25zdWx0aWVydC4gUm9idXN0ZXIgaXN0IGRlciBFaW5ncmlmZiBkaXJla3QgYW4gcmVuZGVyZXIuc2V0RGF0YSxcbi8vIHVubWl0dGVsYmFyIGJldm9yIGRpZSBmZXJ0aWdlbiBOb2RlLURhdGVuIGFuIGRlbiBXZWJHTC1SZW5kZXJlciBnZWhlbiAtIGFuXG4vLyBleGFrdCBkaWVzZXIgU3RlbGxlIHBhdGNodCBhdWNoIGRhcyBDb21tdW5pdHktUGx1Z2luIFwiZ3JhcGgtbmVzdGVkLXRhZ3NcIi5cbi8vIEVpZ2VuZSBGYXJiZ3J1cHBlbiBoYWJlbiBkb3J0IG5vZGUuY29sb3IgYmVyZWl0cyBnZXNldHp0IHVuZCBibGVpYmVuIHVuYW5nZXRhc3RldC5cbmZ1bmN0aW9uIHBhdGNoUmVuZGVyZXIocGx1Z2luLCByZW5kZXJlcikge1xuICBpZiAocmVuZGVyZXIuX19mcmVkVHlwQ29sb3JQYXRjaGVkKSByZXR1cm47XG4gIHJlbmRlcmVyLl9fZnJlZFR5cENvbG9yUGF0Y2hlZCA9IHRydWU7XG5cbiAgY29uc3Qgb3JpZ2luYWwgPSByZW5kZXJlci5zZXREYXRhO1xuICByZW5kZXJlci5zZXREYXRhID0gZnVuY3Rpb24gKGRhdGEpIHtcbiAgICBmb3IgKGNvbnN0IHBhdGggaW4gZGF0YS5ub2Rlcykge1xuICAgICAgY29uc3Qgbm9kZSA9IGRhdGEubm9kZXNbcGF0aF07XG4gICAgICBpZiAobm9kZS5jb2xvcikgY29udGludWU7XG5cbiAgICAgIGlmIChub2RlLnR5cGUgPT09IFwidGFnXCIpIHtcbiAgICAgICAgaWYgKHBsdWdpbi5zZXR0aW5ncy5ncmFwaFRhZ0NvbG9yRW5hYmxlZCAmJiBwbHVnaW4uc2V0dGluZ3MuZ3JhcGhUYWdDb2xvcikge1xuICAgICAgICAgIG5vZGUuY29sb3IgPSB7IGE6IDEsIHJnYjogaGV4VG9JbnQocGx1Z2luLnNldHRpbmdzLmdyYXBoVGFnQ29sb3IpIH07XG4gICAgICAgIH1cbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGZpbGUgPSBwbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChwYXRoKTtcbiAgICAgIGxldCBjb2xvciA9IG51bGw7XG5cbiAgICAgIGlmIChmaWxlICYmIGZpbGUuZXh0ZW5zaW9uICE9PSBcIm1kXCIpIHtcbiAgICAgICAgaWYgKHBsdWdpbi5zZXR0aW5ncy5ncmFwaEF0dGFjaG1lbnRDb2xvckVuYWJsZWQgJiYgcGx1Z2luLnNldHRpbmdzLmdyYXBoQXR0YWNobWVudENvbG9yKSB7XG4gICAgICAgICAgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuZ3JhcGhBdHRhY2htZW50Q29sb3I7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAocGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MuZ3JhcGgpIHtcbiAgICAgICAgY29sb3IgPSBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlKTtcbiAgICAgIH1cblxuICAgICAgaWYgKGNvbG9yKSBub2RlLmNvbG9yID0geyBhOiAxLCByZ2I6IGhleFRvSW50KGNvbG9yKSB9O1xuICAgIH1cbiAgICByZXR1cm4gb3JpZ2luYWwuY2FsbCh0aGlzLCBkYXRhKTtcbiAgfTtcblxuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4ge1xuICAgIHJlbmRlcmVyLnNldERhdGEgPSBvcmlnaW5hbDtcbiAgICBkZWxldGUgcmVuZGVyZXIuX19mcmVkVHlwQ29sb3JQYXRjaGVkO1xuICB9KTtcbn1cblxuZnVuY3Rpb24gZ2V0R3JhcGhMZWF2ZXMoYXBwKSB7XG4gIGNvbnN0IGxlYXZlcyA9IFtdO1xuICBmb3IgKGNvbnN0IHR5cGUgb2YgR1JBUEhfVklFV19UWVBFUykgbGVhdmVzLnB1c2goLi4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUodHlwZSkpO1xuICByZXR1cm4gbGVhdmVzO1xufVxuXG5mdW5jdGlvbiByZWdpc3RlckdyYXBoQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBnZXRHcmFwaExlYXZlcyhwbHVnaW4uYXBwKSkge1xuICAgICAgaWYgKGxlYWYudmlldz8ucmVuZGVyZXIpIHBhdGNoUmVuZGVyZXIocGx1Z2luLCBsZWFmLnZpZXcucmVuZGVyZXIpO1xuICAgICAgbGVhZi52aWV3Py5kYXRhRW5naW5lPy5yZW5kZXIoKTtcbiAgICB9XG4gIH07XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgLy8gTnVyIGJlaSB0YXRzXHUwMEU0Y2hsaWNoIGdlXHUwMEU0bmRlcnRlbSBUWVAgKHNpZWhlIHR5cC1pbmRleC5qcykgLSBzb25zdCB6ZWlndGUgZGVyXG4gIC8vIEdyYXBoIGVpbmUgdW1nZXRyYWdlbmUgRmFyYmUgZXJzdCBuYWNoIGRlbSBuXHUwMEU0Y2hzdGVuIGVpZ2VuZW4gTmV1YXVmYmF1LlxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KHJlZnJlc2gpO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJHcmFwaENvbG9ycyB9O1xuIiwgImNvbnN0IHsgY29sb3JGb3JGaWxlIH0gPSByZXF1aXJlKFwiLi90eXBlLWNvbG9yc1wiKTtcblxuY29uc3QgU0VBUkNIX1ZJRVdfVFlQRSA9IFwic2VhcmNoXCI7XG5cbi8vIEVyZ2VibmlzemVpbGVuIGltIFNlYXJjaCBWaWV3IHRyYWdlbiBrZWluIGRhdGEtcGF0aC1BdHRyaWJ1dCwgYWJlciBkaWVcbi8vIFNlYXJjaFZpZXcgcGZsZWd0IGludGVybiBlaW5lIE1hcCB2b24gVEZpbGUgLT4gRXJnZWJuaXMtRE9NLU9iamVrdFxuLy8gKGRvbS5yZXN1bHREb21Mb29rdXApIC0gZGFyXHUwMEZDYmVyIGxcdTAwRTRzc3Qgc2ljaCBEYXRlaSB1bmQgWmVpbGUgZGlyZWt0IHZlcmJpbmRlbi5cbmZ1bmN0aW9uIGFwcGx5U2VhcmNoQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFNFQVJDSF9WSUVXX1RZUEUpKSB7XG4gICAgY29uc3QgcmVzdWx0RG9tTG9va3VwID0gbGVhZi52aWV3Py5kb20/LnJlc3VsdERvbUxvb2t1cDtcbiAgICBpZiAoIXJlc3VsdERvbUxvb2t1cCkgY29udGludWU7XG5cbiAgICBmb3IgKGNvbnN0IFtmaWxlLCByZXN1bHREb21dIG9mIHJlc3VsdERvbUxvb2t1cCkge1xuICAgICAgY29uc3QgdGl0bGVFbCA9IHJlc3VsdERvbS5lbD8ucXVlcnlTZWxlY3RvcihcIi5zZWFyY2gtcmVzdWx0LWZpbGUtdGl0bGUgLnRyZWUtaXRlbS1pbm5lclwiKTtcbiAgICAgIGlmICghdGl0bGVFbCkgY29udGludWU7XG5cbiAgICAgIGNvbnN0IGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Muc2VhcmNoID8gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSkgOiBudWxsO1xuICAgICAgaWYgKGNvbG9yKSB0aXRsZUVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gICAgICBlbHNlIHRpdGxlRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJTZWFyY2hDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseVNlYXJjaENvbG9ycyhwbHVnaW4pO1xuXG4gIC8vIEVyZ2Vibmlzc2Ugd2VyZGVuIGJlaSBqZWRlciBTdWNoZWluZ2FiZSBrb21wbGV0dCBuZXUgYXVmZ2ViYXV0LlxuICBjb25zdCBvYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKHJlZnJlc2gpO1xuICBjb25zdCBvYnNlcnZlTGVhdmVzID0gKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoU0VBUkNIX1ZJRVdfVFlQRSkpIHtcbiAgICAgIG9ic2VydmVyLm9ic2VydmUobGVhZi52aWV3LmNvbnRhaW5lckVsLCB7IGNoaWxkTGlzdDogdHJ1ZSwgc3VidHJlZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiBvYnNlcnZlci5kaXNjb25uZWN0KCkpO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KFxuICAgIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgICByZWZyZXNoKCk7XG4gICAgfSlcbiAgKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgcmVmcmVzaCgpO1xuICB9KTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyU2VhcmNoQ29sb3JzIH07XG4iLCAiY29uc3QgeyBjb2xvckZvckZpbGUgfSA9IHJlcXVpcmUoXCIuL3R5cGUtY29sb3JzXCIpO1xuXG5jb25zdCBSRUNFTlRfRklMRVNfVklFV19UWVBFID0gXCJyZWNlbnQtZmlsZXNcIjtcblxuLy8gUmVjZW50IEZpbGVzIHNldHp0IGtlaW4gZGF0YS1wYXRoLUF0dHJpYnV0IGF1ZiBzZWluZSBaZWlsZW4uIEVzIHJlbmRlcnQgc2VpbmVcbi8vIExpc3RlIGFiZXIgb2huZSBcdTAwRkNiZXJzcHJ1bmdlbmUgRWludHJcdTAwRTRnZSBkaXJla3QgYXVzIGRhdGEucmVjZW50RmlsZXMsIGRhaGVyXG4vLyBsXHUwMEU0c3N0IHNpY2ggZGllIFplaWxlIFx1MDBGQ2JlciBkZW4gSW5kZXggZWluZGV1dGlnIGRlbSBQZmFkIHp1b3JkbmVuLlxuZnVuY3Rpb24gYXBwbHlSZWNlbnRGaWxlc0NvbG9ycyhwbHVnaW4pIHtcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShSRUNFTlRfRklMRVNfVklFV19UWVBFKSkge1xuICAgIGNvbnN0IHJlY2VudEZpbGVzID0gbGVhZi52aWV3Py5kYXRhPy5yZWNlbnRGaWxlcztcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkocmVjZW50RmlsZXMpKSBjb250aW51ZTtcblxuICAgIGNvbnN0IHRpdGxlRWxzID0gbGVhZi52aWV3LmNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIucmVjZW50LWZpbGVzLXRpdGxlIC5uYXYtZmlsZS10aXRsZS1jb250ZW50XCIpO1xuICAgIHRpdGxlRWxzLmZvckVhY2goKHRpdGxlRWwsIGluZGV4KSA9PiB7XG4gICAgICBjb25zdCBlbnRyeSA9IHJlY2VudEZpbGVzW2luZGV4XTtcbiAgICAgIGNvbnN0IGZpbGUgPSBlbnRyeSA/IHBsdWdpbi5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGVudHJ5LnBhdGgpIDogbnVsbDtcbiAgICAgIGNvbnN0IGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MucmVjZW50RmlsZXMgPyBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlKSA6IG51bGw7XG4gICAgICBpZiAoY29sb3IpIHRpdGxlRWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcbiAgICAgIGVsc2UgdGl0bGVFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImNvbG9yXCIpO1xuICAgIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyUmVjZW50RmlsZXNDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseVJlY2VudEZpbGVzQ29sb3JzKHBsdWdpbik7XG5cbiAgY29uc3Qgb2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcihyZWZyZXNoKTtcbiAgY29uc3Qgb2JzZXJ2ZUxlYXZlcyA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFJFQ0VOVF9GSUxFU19WSUVXX1RZUEUpKSB7XG4gICAgICBvYnNlcnZlci5vYnNlcnZlKGxlYWYudmlldy5jb250YWluZXJFbCwgeyBjaGlsZExpc3Q6IHRydWUsIHN1YnRyZWU6IHRydWUgfSk7XG4gICAgfVxuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4gb2JzZXJ2ZXIuZGlzY29ubmVjdCgpKTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgICAgcmVmcmVzaCgpO1xuICAgIH0pXG4gICk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeSgoKSA9PiB7XG4gICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgIHJlZnJlc2goKTtcbiAgfSk7XG5cbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlclJlY2VudEZpbGVzQ29sb3JzIH07XG4iLCAiY29uc3QgeyBjb2xvckZvckZpbGUgfSA9IHJlcXVpcmUoXCIuL3R5cGUtY29sb3JzXCIpO1xuXG5jb25zdCBCQUNLTElOS19WSUVXX1RZUEUgPSBcImJhY2tsaW5rXCI7XG5cbi8vIERhcyBCYWNrbGlua3MtUGFuZSAoU2VpdGVubGVpc3RlKSByZW5kZXJ0IFRyZWZmZXIgaW50ZXJuIFx1MDBGQ2JlciBkaWVzZWxiZVxuLy8gU2VhcmNoUmVzdWx0RG9tLUtsYXNzZSB3aWUgZGllIFN1Y2hlLiBWZXJsaW5rdGUgdW5kIG5pY2h0IHZlcmxpbmt0ZVxuLy8gRXJ3XHUwMEU0aG51bmdlbiBsaWVnZW4gYWxzIHp3ZWkgcmVzdWx0RG9tTG9va3VwLU1hcHMgaW0gQmFja2xpbmtSZW5kZXJlclxuLy8gKHZpZXcuYmFja2xpbmspIC0gRmVsZG5hbWVuIHNpbmQgbmljaHQgb2ZmaXppZWxsIGRva3VtZW50aWVydCwgZGFoZXJcbi8vIG1laHJlcmUgYmVrYW5udGUgUGZhZGUgcHJvYmllcmVuIHN0YXR0IGVpbmVuIGZlc3QgYW56dW5laG1lbi5cbmZ1bmN0aW9uIGdldFJlc3VsdERvbUxvb2t1cHModmlldykge1xuICBjb25zdCByZW5kZXJlciA9IHZpZXc/LmJhY2tsaW5rO1xuICBjb25zdCBjYW5kaWRhdGVzID0gW3JlbmRlcmVyPy5iYWNrbGlua0RvbSwgcmVuZGVyZXI/LnVubGlua2VkRG9tLCB2aWV3Py5iYWNrbGlua0RvbSwgdmlldz8udW5saW5rZWREb20sIHZpZXc/LmRvbV07XG5cbiAgY29uc3QgbG9va3VwcyA9IFtdO1xuICBmb3IgKGNvbnN0IGRvbSBvZiBjYW5kaWRhdGVzKSB7XG4gICAgaWYgKGRvbT8ucmVzdWx0RG9tTG9va3VwIGluc3RhbmNlb2YgTWFwKSBsb29rdXBzLnB1c2goZG9tLnJlc3VsdERvbUxvb2t1cCk7XG4gIH1cbiAgcmV0dXJuIGxvb2t1cHM7XG59XG5cbmZ1bmN0aW9uIGNvbG9yVGl0bGVFbChwbHVnaW4sIGVsLCBmaWxlKSB7XG4gIGNvbnN0IGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MuYmFja2xpbmtzID8gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSkgOiBudWxsO1xuICBpZiAoY29sb3IpIGVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gIGVsc2UgZWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcbn1cblxuZnVuY3Rpb24gYXBwbHlCYWNrbGlua1BhbmVDb2xvcnMocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoQkFDS0xJTktfVklFV19UWVBFKSkge1xuICAgIGZvciAoY29uc3QgbG9va3VwIG9mIGdldFJlc3VsdERvbUxvb2t1cHMobGVhZi52aWV3KSkge1xuICAgICAgZm9yIChjb25zdCBbZmlsZSwgcmVzdWx0RG9tXSBvZiBsb29rdXApIHtcbiAgICAgICAgY29uc3QgdGl0bGVFbCA9IHJlc3VsdERvbS5lbD8ucXVlcnlTZWxlY3RvcihcIi5zZWFyY2gtcmVzdWx0LWZpbGUtdGl0bGUgLnRyZWUtaXRlbS1pbm5lclwiKTtcbiAgICAgICAgaWYgKHRpdGxlRWwpIGNvbG9yVGl0bGVFbChwbHVnaW4sIHRpdGxlRWwsIGZpbGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG4vLyBcIkJhY2tsaW5rcyBpbSBEb2t1bWVudFwiIGlzdCBrZWluZSBlaWdlbmUgQW5zaWNodC9rZWluIGVpZ2VuZXIgTGVhZiwgc29uZGVyblxuLy8gdW50ZW4gaW4gZGllIE1hcmtkb3duVmlldyBlaW5nZWJldHRldCAoLmVtYmVkZGVkLWJhY2tsaW5rcykgLSBoaWVyIHJlaWNodFxuLy8ga2VpbiBMZWFmLVR5cCwgc3RhdHRkZXNzZW4gXHUwMEZDYmVyIG9mZmVuZSBNYXJrZG93bi1MZWF2ZXMgbmFjaCBkZXIgRE9NLUtsYXNzZVxuLy8gc3VjaGVuLiBPaG5lIGRhdGEtcGF0aCBqZSBaZWlsZSB3aXJkIGRpZSBEYXRlaSBcdTAwRkNiZXIgZGVuIGFuZ2V6ZWlndGVuXG4vLyBEYXRlaW5hbWVuIChMaW5rdGV4dCkgYXVmZ2VsXHUwMEY2c3QsIHdpZSBPYnNpZGlhbiBpbnRlcm4gTGlua3MgYXVmbFx1MDBGNnN0LlxuZnVuY3Rpb24gYXBwbHlFbWJlZGRlZEJhY2tsaW5rQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikpIHtcbiAgICBjb25zdCBwYW5lRWwgPSBsZWFmLnZpZXcuY29udGFpbmVyRWwucXVlcnlTZWxlY3RvcihcIi5lbWJlZGRlZC1iYWNrbGlua3MgLmJhY2tsaW5rLXBhbmVcIik7XG4gICAgaWYgKCFwYW5lRWwpIGNvbnRpbnVlO1xuXG4gICAgY29uc3Qgc291cmNlUGF0aCA9IGxlYWYudmlldy5maWxlPy5wYXRoID8/IFwiXCI7XG4gICAgY29uc3QgdGl0bGVFbHMgPSBwYW5lRWwucXVlcnlTZWxlY3RvckFsbChcIi5zZWFyY2gtcmVzdWx0LWZpbGUtdGl0bGUgLnRyZWUtaXRlbS1pbm5lclwiKTtcbiAgICBmb3IgKGNvbnN0IHRpdGxlRWwgb2YgdGl0bGVFbHMpIHtcbiAgICAgIGNvbnN0IGJhc2VuYW1lID0gdGl0bGVFbC50ZXh0Q29udGVudDtcbiAgICAgIGNvbnN0IGZpbGUgPSBiYXNlbmFtZSA/IHBsdWdpbi5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaXJzdExpbmtwYXRoRGVzdChiYXNlbmFtZSwgc291cmNlUGF0aCkgOiBudWxsO1xuICAgICAgY29sb3JUaXRsZUVsKHBsdWdpbiwgdGl0bGVFbCwgZmlsZSk7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGFwcGx5QmFja2xpbmtDb2xvcnMocGx1Z2luKSB7XG4gIGFwcGx5QmFja2xpbmtQYW5lQ29sb3JzKHBsdWdpbik7XG4gIGFwcGx5RW1iZWRkZWRCYWNrbGlua0NvbG9ycyhwbHVnaW4pO1xufVxuXG5mdW5jdGlvbiByZWdpc3RlckJhY2tsaW5rQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlCYWNrbGlua0NvbG9ycyhwbHVnaW4pO1xuXG4gIC8vIE51ciBkYXMgKGtsZWluZSkgQmFja2xpbmtzLVBhbmUgaW4gZGVyIFNlaXRlbmxlaXN0ZSBwZXIgTXV0YXRpb25PYnNlcnZlclxuICAvLyBiZW9iYWNodGVuIC0gTklDSFQgZGllIE1hcmtkb3duVmlldy1Db250YWluZXIsIGRhIGRlcmVuIEVkaXRvci1TdWJ0cmVlIGJlaVxuICAvLyBqZWRlbSBUYXN0ZW5kcnVjayB2aWVsZSBNdXRhdGlvbmVuIGVyemV1Z3QgKHNpZWhlIFdhcm51bmcgaW5cbiAgLy8gZGF0YWJhc2UtZm9sZGVycy5qczogZWluIHN1YnRyZWUtT2JzZXJ2ZXIgXHUwMEZDYmVyIGVpbmVuIEVkaXRvci1uYWhlbiBDb250YWluZXJcbiAgLy8gaGF0IGRpZXNlcyBWYXVsdCBzY2hvbiBlaW5tYWwga29tcGxldHQgZWluZ2Vmcm9yZW4pLiBEaWUgZWluZ2ViZXR0ZXRlblxuICAvLyBCYWNrbGlua3MgaW0gRG9rdW1lbnQgYnJhdWNoZW4gZGFmXHUwMEZDciBrZWluZW4gZWlnZW5lbiBPYnNlcnZlcjogc2llIFx1MDBFNG5kZXJuXG4gIC8vIHNpY2ggbnVyLCB3ZW5uIGlyZ2VuZHdvIGltIFZhdWx0IExpbmtzIGhpbnp1a29tbWVuL3dlZ2ZhbGxlbiBvZGVyIGJlaW1cbiAgLy8gXHUwMEQ2ZmZuZW4vV2VjaHNlbG4gZWluZXIgTm90aXogLSBiZWlkZXMgaXN0IFx1MDBGQ2JlciBkaWUgRXZlbnRzIHVudGVuIGJlcmVpdHNcbiAgLy8gYWJnZWRlY2t0IChcInJlc29sdmVkXCIgbmFjaCBqZWRlciBMaW5rLUF1ZmxcdTAwRjZzdW5nLCBsYXlvdXQtY2hhbmdlL1xuICAvLyBhY3RpdmUtbGVhZi1jaGFuZ2UgbFx1MDBGNnNlbiBvaG5laGluIGFwcGx5QmFja2xpbmtDb2xvcnMoKSB1bmQgZGFtaXQgYXVjaFxuICAvLyBhcHBseUVtYmVkZGVkQmFja2xpbmtDb2xvcnMoKSBhdXMpLlxuICBjb25zdCBvYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKHJlZnJlc2gpO1xuICBjb25zdCBvYnNlcnZlTGVhdmVzID0gKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoQkFDS0xJTktfVklFV19UWVBFKSkge1xuICAgICAgb2JzZXJ2ZXIub2JzZXJ2ZShsZWFmLnZpZXcuY29udGFpbmVyRWwsIHsgY2hpbGRMaXN0OiB0cnVlLCBzdWJ0cmVlOiB0cnVlIH0pO1xuICAgIH1cbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IG9ic2VydmVyLmRpc2Nvbm5lY3QoKSk7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgLy8gTnVyIGRlciBlaW5nZWJldHRldGUgVGVpbCBoXHUwMEU0bmd0IChtYW5nZWxzIGVpZ2VuZW0gT2JzZXJ2ZXIsIHNpZWhlIG9iZW4pXG4gIC8vIHdlaXRlcmhpbiBhbiBkZXIgTGluay1BdWZsXHUwMEY2c3VuZyAtIGRpZSBTZWl0ZW5sZWlzdGUgZGVja3QgaWhyIE9ic2VydmVyIGFiLlxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLm1ldGFkYXRhQ2FjaGUub24oXCJyZXNvbHZlZFwiLCAoKSA9PiBhcHBseUVtYmVkZGVkQmFja2xpbmtDb2xvcnMocGx1Z2luKSkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgb2JzZXJ2ZUxlYXZlcygpO1xuICAgICAgcmVmcmVzaCgpO1xuICAgIH0pXG4gICk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwiYWN0aXZlLWxlYWYtY2hhbmdlXCIsIHJlZnJlc2gpKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgcmVmcmVzaCgpO1xuICB9KTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyQmFja2xpbmtDb2xvcnMgfTtcbiIsICJjb25zdCB7IGNvbG9yRm9yRmlsZSB9ID0gcmVxdWlyZShcIi4vdHlwZS1jb2xvcnNcIik7XG5cbmNvbnN0IEJPT0tNQVJLU19WSUVXX1RZUEUgPSBcImJvb2ttYXJrc1wiO1xuY29uc3QgQk9PS01BUktTX1BMVUdJTl9JRCA9IFwiYm9va21hcmtzXCI7XG5cbi8vIEJvb2ttYXJrLVplaWxlbiB0cmFnZW4ga2VpbiBkYXRhLXBhdGgtQXR0cmlidXQuIERlciBWaWV3IGhcdTAwRTRsdCBhYmVyIGludGVyblxuLy8gZWluZSBXZWFrTWFwICh2aWV3Lml0ZW1Eb21zOiBCb29rbWFyay1JdGVtIC0+IFRyZWUtSXRlbS1Eb20gbWl0IC50aXRsZUVsKSAtXG4vLyBkYXJcdTAwRkNiZXIgbFx1MDBFNHNzdCBzaWNoIGplZGVzIEl0ZW0gZ2V6aWVsdCBzZWluZXIgWmVpbGUgenVvcmRuZW4sIG9obmUgZGllIChuaWNodFxuLy8gaXRlcmllcmJhcmUpIFdlYWtNYXAgc2VsYnN0IGR1cmNobGF1ZmVuIHp1IG1cdTAwRkNzc2VuOiBzdGF0dGRlc3NlbiByZWt1cnNpdiBcdTAwRkNiZXJcbi8vIGRlbiBJdGVtLUJhdW0gZGVzIEJvb2ttYXJrcy1QbHVnaW5zIHNlbGJzdCBsYXVmZW4gKGxpZWd0IHVuYWJoXHUwMEU0bmdpZyB2b21cbi8vIFJlbmRlci0vQ29sbGFwc2UtWnVzdGFuZCBpbW1lciB2b2xsc3RcdTAwRTRuZGlnIHZvcikgdW5kIGplIEl0ZW0gcGVyIC5nZXQoKVxuLy8gbmFjaHNjaGxhZ2VuLCBvYiAodW5kIHdvKSBlcyBha3R1ZWxsIGdlcmVuZGVydCBpc3QuXG5mdW5jdGlvbiBmb3JFYWNoRmlsZUJvb2ttYXJrKGl0ZW1zLCBjYWxsYmFjaykge1xuICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMgPz8gW10pIHtcbiAgICBpZiAoaXRlbS50eXBlID09PSBcImZpbGVcIikgY2FsbGJhY2soaXRlbSk7XG4gICAgZWxzZSBpZiAoaXRlbS50eXBlID09PSBcImdyb3VwXCIpIGZvckVhY2hGaWxlQm9va21hcmsoaXRlbS5pdGVtcywgY2FsbGJhY2spO1xuICB9XG59XG5cbmZ1bmN0aW9uIGFwcGx5Qm9va21hcmtzQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCBib29rbWFya3NQbHVnaW4gPSBwbHVnaW4uYXBwLmludGVybmFsUGx1Z2lucy5nZXRFbmFibGVkUGx1Z2luQnlJZChCT09LTUFSS1NfUExVR0lOX0lEKTtcbiAgaWYgKCFib29rbWFya3NQbHVnaW4pIHJldHVybjtcblxuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEJPT0tNQVJLU19WSUVXX1RZUEUpKSB7XG4gICAgY29uc3QgaXRlbURvbXMgPSBsZWFmLnZpZXc/Lml0ZW1Eb21zO1xuICAgIGlmICghaXRlbURvbXMpIGNvbnRpbnVlO1xuXG4gICAgZm9yRWFjaEZpbGVCb29rbWFyayhib29rbWFya3NQbHVnaW4uaXRlbXMsIChpdGVtKSA9PiB7XG4gICAgICBjb25zdCB0aXRsZUVsID0gaXRlbURvbXMuZ2V0KGl0ZW0pPy50aXRsZUVsO1xuICAgICAgaWYgKCF0aXRsZUVsKSByZXR1cm47XG5cbiAgICAgIGNvbnN0IGZpbGUgPSBwbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChpdGVtLnBhdGgpO1xuICAgICAgY29uc3QgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5ib29rbWFya3MgPyBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlKSA6IG51bGw7XG4gICAgICBpZiAoY29sb3IpIHRpdGxlRWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcbiAgICAgIGVsc2UgdGl0bGVFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImNvbG9yXCIpO1xuICAgIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyQm9va21hcmtzQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlCb29rbWFya3NDb2xvcnMocGx1Z2luKTtcblxuICAvLyBBbmFsb2cgenUgZmlsZS1leHBsb3Jlci1jb2xvcnMuanM6IEJvb2ttYXJrcyByZW5kZXJ0IFplaWxlbiBiZWltXG4gIC8vIEF1Zi0vWnVrbGFwcGVuIHZvbiBHcnVwcGVuIHNvd2llIGJlaW0gSGluenVmXHUwMEZDZ2VuL0VudGZlcm5lbi9VbXNvcnRpZXJlblxuICAvLyBkeW5hbWlzY2ggbmV1LlxuICBjb25zdCBvYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKHJlZnJlc2gpO1xuICBjb25zdCBvYnNlcnZlTGVhdmVzID0gKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoQk9PS01BUktTX1ZJRVdfVFlQRSkpIHtcbiAgICAgIG9ic2VydmVyLm9ic2VydmUobGVhZi52aWV3LmNvbnRhaW5lckVsLCB7IGNoaWxkTGlzdDogdHJ1ZSwgc3VidHJlZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiBvYnNlcnZlci5kaXNjb25uZWN0KCkpO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KFxuICAgIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgICByZWZyZXNoKCk7XG4gICAgfSlcbiAgKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgcmVmcmVzaCgpO1xuICB9KTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyQm9va21hcmtzQ29sb3JzIH07XG4iLCAiY29uc3QgeyBURmlsZSB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBjb2xvckZvckZpbGUgfSA9IHJlcXVpcmUoXCIuL3R5cGUtY29sb3JzXCIpO1xuXG5jb25zdCBET1RfQ0xBU1MgPSBcImZyZWQtdHlwLXRpdGxlLWRvdFwiO1xuY29uc3QgQkFER0VfQ0xBU1MgPSBcImZyZWQtdHlwLXRpdGxlLWJhZGdlXCI7XG5jb25zdCBCQURHRV9QTEFJTl9DTEFTUyA9IFwiZnJlZC10eXAtdGl0bGUtYmFkZ2UtcGxhaW5cIjtcbmNvbnN0IENPTE9SX1ZBUiA9IFwiLS1mcmVkLXR5cC10aXRsZS1jb2xvclwiO1xuXG5jb25zdCBCTE9DS19CQURHRV9DTEFTUyA9IFwiZnJlZC10eXAtYmxvY2stYmFkZ2VcIjtcbmNvbnN0IEJMT0NLX0JBREdFX1BMQUlOX0NMQVNTID0gXCJmcmVkLXR5cC1ibG9jay1iYWRnZS1wbGFpblwiO1xuY29uc3QgQkxPQ0tfQUxJR05fVE9QX0NMQVNTID0gXCJmcmVkLXR5cC1ibG9jay1iYWRnZS10b3BcIjtcbmNvbnN0IEJMT0NLX0FMSUdOX0JPVFRPTV9DTEFTUyA9IFwiZnJlZC10eXAtYmxvY2stYmFkZ2UtYm90dG9tXCI7XG5jb25zdCBCTE9DS19DT0xPUl9WQVIgPSBcIi0tZnJlZC10eXAtYmxvY2stY29sb3JcIjtcblxuLy8gbm90ZVRpdGxlU3R5bGU6IFwibm9uZVwiIHwgXCJkb3RcIiB8IFwiYmFkZ2VcIi4gQmVpIFwiYmFkZ2VcIiBiZXN0aW1tZW4gendlaVxuLy8gd2VpdGVyZSBFaW5zdGVsbHVuZ2VuIEZhcmJlIChub3RlVGl0bGVCYWRnZUNvbG9yZWQpIHVuZCBQb3NpdGlvblxuLy8gKG5vdGVUaXRsZUJhZGdlUG9zaXRpb246IFwidGl0bGVcIiB8IFwiYmxvY2tcIikgLSBzaWVoZSBzZXR0aW5ncy5qcywgZG9ydCBudXJcbi8vIGJlaSBcImJhZGdlXCIgXHUwMEZDYmVyaGF1cHQgYW5nZXplaWd0IChwcm9ncmVzc2l2ZSBPZmZlbmxlZ3VuZykuIFwiZG90XCIgc2l0enRcbi8vIGltbWVyIGFtIFRpdGVsLCBcImJhZGdlXCIgamUgbmFjaCBQb3NpdGlvbiBlbnR3ZWRlciBhbSBUaXRlbCBvZGVyIGFtXG4vLyBQcm9wZXJ0eS1CbG9jayAoZG9ydCB6dXNcdTAwRTR0emxpY2ggcGVyIG5vdGVUaXRsZVZlcnRpY2FsQWxpZ24gb2Jlbi91bnRlbikuXG4vLyBjb2xvclZpZXdzLm5vdGVUaXRsZUNvbG9yIChUaXRlbHRleHQgc2VsYnN0IGVpbmZcdTAwRTRyYmVuKSBpc3QgZGF2b24gdW5hYmhcdTAwRTRuZ2lnXG4vLyB1bmQgYmVsaWViaWcga29tYmluaWVyYmFyLlxuZnVuY3Rpb24gcmVzb2x2ZU1hcmtlcihwbHVnaW4sIGZpbGUpIHtcbiAgY29uc3Qgc3R5bGUgPSBwbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlU3R5bGU7XG4gIGlmIChzdHlsZSA9PT0gXCJub25lXCIpIHJldHVybiB7IGtpbmQ6IFwibm9uZVwiIH07XG4gIGlmIChzdHlsZSA9PT0gXCJkb3RcIikgcmV0dXJuIHsga2luZDogXCJkb3RcIiwgY29sb3I6IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUpIH07XG5cbiAgLy8gc3R5bGUgPT09IFwiYmFkZ2VcIlxuICBjb25zdCBjb2xvcmVkID0gcGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlQ29sb3JlZDtcbiAgY29uc3QgY29sb3IgPSBjb2xvcmVkID8gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSkgOiBudWxsO1xuICBjb25zdCB0eXBlTmFtZSA9IGNvbG9yZWQgPyAoY29sb3IgPyBwbHVnaW4udHlwSW5kZXgudHlwZU9mKGZpbGUpIDogbnVsbCkgOiBwbHVnaW4udHlwSW5kZXgudHlwZU9mKGZpbGUpO1xuICBpZiAoIXR5cGVOYW1lKSByZXR1cm4geyBraW5kOiBcIm5vbmVcIiB9O1xuXG4gIGNvbnN0IHBvc2l0aW9uID0gcGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlUG9zaXRpb247XG4gIHJldHVybiB7IGtpbmQ6IHBvc2l0aW9uID09PSBcImJsb2NrXCIgPyBcImJsb2NrLWJhZGdlXCIgOiBcInRpdGxlLWJhZGdlXCIsIGNvbG9yZWQsIGNvbG9yLCB0eXBlTmFtZSB9O1xufVxuXG4vLyBUaXRlbCBkZXIgTm90aXogc2VsYnN0ICguaW5saW5lLXRpdGxlLCBzaWNodGJhciBzb2Zlcm4gT2JzaWRpYW5zIGVpZ2VuZVxuLy8gRWluc3RlbGx1bmcgXCJJbmxpbmUtVGl0ZWwgYW56ZWlnZW5cIiBha3RpdiBpc3QpLiBCZXd1c3N0IGFscyA6OmJlZm9yZVxuLy8gcmVhbGlzaWVydCAoc2llaGUgc3R5bGVzLmNzcykgc3RhdHQgYWxzIGVpZ2VuZXMgRE9NLUVsZW1lbnQgb2RlciBXcmFwcGVyOlxuLy8gLmlubGluZS10aXRsZSBoXHUwMEU0bmd0IGluIG1laHJlcmVuIFRoZW1lcyAodS4gYS4gTWluaW1hbCkgcGVyIEtpbmQtU2VsZWt0b3Jcbi8vIChcIj5cIikgZGlyZWt0IGFuIHNlaW5lbSBFbHRlcm4tQ29udGFpbmVyICh6LiBCLiBmXHUwMEZDciBtYXgtd2lkdGgvbWFyZ2luKSAtIGVpblxuLy8genVzXHUwMEU0dHpsaWNoZXMgRWxlbWVudCBkYXZvciBvZGVyIGVpbiBXcmFwcGVyIGRhcnVtIHdcdTAwRkNyZGUgZGllc2UgUmVnZWxuXG4vLyB1bnRlcndhbmRlcm4uIEZhcmJlIHVuZCBUWVAtTmFtZSBsYXNzZW4gc2ljaCBlaW5lbSA6OmJlZm9yZSBuaWNodCBkaXJla3Rcbi8vIHp1d2Vpc2VuLCBkYWhlciBkZXIgVW13ZWcgXHUwMEZDYmVyIGVpbmUgQ1NTLVZhcmlhYmxlIGJ6dy4gZWluIGRhdGEtQXR0cmlidXQsXG4vLyBkaWUgZGllIDo6YmVmb3JlLVJlZ2VsbiBhdXNsZXNlbiAodmFyKCkvYXR0cigpKS5cbmZ1bmN0aW9uIGFwcGx5U3R5bGVUb1RpdGxlKHRpdGxlRWwsIG1hcmtlcikge1xuICBjb25zdCBpc0RvdCA9IG1hcmtlci5raW5kID09PSBcImRvdFwiICYmICEhbWFya2VyLmNvbG9yO1xuICBjb25zdCBpc0JhZGdlID0gbWFya2VyLmtpbmQgPT09IFwidGl0bGUtYmFkZ2VcIjtcblxuICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoRE9UX0NMQVNTLCBpc0RvdCk7XG4gIHRpdGxlRWwuY2xhc3NMaXN0LnRvZ2dsZShCQURHRV9DTEFTUywgaXNCYWRnZSAmJiBtYXJrZXIuY29sb3JlZCk7XG4gIHRpdGxlRWwuY2xhc3NMaXN0LnRvZ2dsZShCQURHRV9QTEFJTl9DTEFTUywgaXNCYWRnZSAmJiAhbWFya2VyLmNvbG9yZWQpO1xuXG4gIGlmIChpc0JhZGdlKSB0aXRsZUVsLmRhdGFzZXQuZnJlZFR5cCA9IG1hcmtlci50eXBlTmFtZTtcbiAgZWxzZSBkZWxldGUgdGl0bGVFbC5kYXRhc2V0LmZyZWRUeXA7XG5cbiAgY29uc3QgbWFya2VyQ29sb3IgPSAoaXNEb3QgJiYgbWFya2VyLmNvbG9yKSB8fCAoaXNCYWRnZSAmJiBtYXJrZXIuY29sb3JlZCAmJiBtYXJrZXIuY29sb3IpID8gbWFya2VyLmNvbG9yIDogbnVsbDtcbiAgaWYgKG1hcmtlckNvbG9yKSB0aXRsZUVsLnN0eWxlLnNldFByb3BlcnR5KENPTE9SX1ZBUiwgbWFya2VyQ29sb3IpO1xuICBlbHNlIHRpdGxlRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoQ09MT1JfVkFSKTtcbn1cblxuLy8gUHJvcGVydHktQmxvY2sgZGVyIE5vdGl6ICgubWV0YWRhdGEtY29udGFpbmVyKS4gRGllIFwiYmxvY2tcIi1Qb3NpdGlvbiB2b25cbi8vIG5vdGVUaXRsZUJhZGdlUG9zaXRpb246IGRpZXNlbGJlIEJveCB3aWUgYW0gVGl0ZWwsIGFiZXIgdW0gOTBcdTAwQjAgZ2VkcmVodFxuLy8gKHdyaXRpbmctbW9kZSBzdGF0dCB0cmFuc2Zvcm06cm90YXRlKCkgLSBkYWR1cmNoIHdcdTAwRTRjaHN0IGRpZSBCb3ggbWl0IGRlclxuLy8gVGV4dGxcdTAwRTRuZ2UgaW4gZGVyIHJpY2h0aWdlbiBSaWNodHVuZywgb2huZSBkaWUgUG9zaXRpb25pZXJ1bmcgcGVyXG4vLyB0cmFuc2Zvcm0tb3JpZ2luIHZvbiBIYW5kIG5hY2hyZWNobmVuIHp1IG1cdTAwRkNzc2VuKSB1bmQgbGlua3MgYW0gUHJvcGVydHktQmxvY2tcbi8vIHN0YXR0IGFtIFRpdGVsIHZlcmFua2VydCwgb2JlbiBvZGVyIHVudGVuIChub3RlVGl0bGVWZXJ0aWNhbEFsaWduKS4gQmxlaWJ0XG4vLyBiZWltIChFaW4tL0F1cy0pQmxlbmRlbiBkZXMgQmxvY2tzIChzaWVoZSBQcm9wZXJ0eS1CbG9jay5jc3MpIGF1dG9tYXRpc2NoXG4vLyBtaXQgdmVyc2Nod2luZGVuL2Vyc2NoZWluZW4sIGRhIHNpZSBhbHMgOjpiZWZvcmUgZGFyYXVmIHNpdHp0LlxuZnVuY3Rpb24gYXBwbHlTdHlsZVRvQmxvY2socGx1Z2luLCBibG9ja0VsLCBtYXJrZXIpIHtcbiAgY29uc3QgaXNCbG9ja0JhZGdlID0gbWFya2VyLmtpbmQgPT09IFwiYmxvY2stYmFkZ2VcIjtcblxuICBibG9ja0VsLmNsYXNzTGlzdC50b2dnbGUoQkxPQ0tfQkFER0VfQ0xBU1MsIGlzQmxvY2tCYWRnZSAmJiBtYXJrZXIuY29sb3JlZCk7XG4gIGJsb2NrRWwuY2xhc3NMaXN0LnRvZ2dsZShCTE9DS19CQURHRV9QTEFJTl9DTEFTUywgaXNCbG9ja0JhZGdlICYmICFtYXJrZXIuY29sb3JlZCk7XG5cbiAgY29uc3QgYWxpZ24gPSBwbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlVmVydGljYWxBbGlnbjtcbiAgYmxvY2tFbC5jbGFzc0xpc3QudG9nZ2xlKEJMT0NLX0FMSUdOX1RPUF9DTEFTUywgaXNCbG9ja0JhZGdlICYmIGFsaWduICE9PSBcImJvdHRvbVwiKTtcbiAgYmxvY2tFbC5jbGFzc0xpc3QudG9nZ2xlKEJMT0NLX0FMSUdOX0JPVFRPTV9DTEFTUywgaXNCbG9ja0JhZGdlICYmIGFsaWduID09PSBcImJvdHRvbVwiKTtcblxuICBpZiAoaXNCbG9ja0JhZGdlKSBibG9ja0VsLmRhdGFzZXQuZnJlZFR5cCA9IG1hcmtlci50eXBlTmFtZTtcbiAgZWxzZSBkZWxldGUgYmxvY2tFbC5kYXRhc2V0LmZyZWRUeXA7XG5cbiAgY29uc3QgYmxvY2tDb2xvciA9IGlzQmxvY2tCYWRnZSAmJiBtYXJrZXIuY29sb3JlZCAmJiBtYXJrZXIuY29sb3IgPyBtYXJrZXIuY29sb3IgOiBudWxsO1xuICBpZiAoYmxvY2tDb2xvcikgYmxvY2tFbC5zdHlsZS5zZXRQcm9wZXJ0eShCTE9DS19DT0xPUl9WQVIsIGJsb2NrQ29sb3IpO1xuICBlbHNlIGJsb2NrRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoQkxPQ0tfQ09MT1JfVkFSKTtcbn1cblxuZnVuY3Rpb24gYXBwbHlBY3RpdmVUaXRsZUNvbG9ycyhwbHVnaW4pIHtcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpKSB7XG4gICAgY29uc3QgY29udGFpbmVyRWwgPSBsZWFmLnZpZXcuY29udGFpbmVyRWw7XG4gICAgY29uc3QgZmlsZSA9IGxlYWYudmlldy5maWxlO1xuICAgIGNvbnN0IHR5cGVkRmlsZSA9IGZpbGUgaW5zdGFuY2VvZiBURmlsZSA/IGZpbGUgOiBudWxsO1xuICAgIGNvbnN0IG1hcmtlciA9IHJlc29sdmVNYXJrZXIocGx1Z2luLCB0eXBlZEZpbGUpO1xuXG4gICAgY29uc3QgdGl0bGVFbCA9IGNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3IoXCIuaW5saW5lLXRpdGxlXCIpO1xuICAgIGlmICh0aXRsZUVsKSB7XG4gICAgICBhcHBseVN0eWxlVG9UaXRsZSh0aXRsZUVsLCBtYXJrZXIpO1xuXG4gICAgICBjb25zdCB0ZXh0Q29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5ub3RlVGl0bGVDb2xvciA/IGNvbG9yRm9yRmlsZShwbHVnaW4sIHR5cGVkRmlsZSkgOiBudWxsO1xuICAgICAgaWYgKHRleHRDb2xvcikgdGl0bGVFbC5zdHlsZS5jb2xvciA9IHRleHRDb2xvcjtcbiAgICAgIGVsc2UgdGl0bGVFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImNvbG9yXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IGJsb2NrRWwgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKFwiLm1ldGFkYXRhLWNvbnRhaW5lclwiKTtcbiAgICBpZiAoYmxvY2tFbCkgYXBwbHlTdHlsZVRvQmxvY2socGx1Z2luLCBibG9ja0VsLCBtYXJrZXIpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseUFjdGl2ZVRpdGxlQ29sb3JzKHBsdWdpbik7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJmaWxlLW9wZW5cIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImFjdGl2ZS1sZWFmLWNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCByZWZyZXNoKSk7XG5cbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeShyZWZyZXNoKTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnMgfTtcbiIsICJjb25zdCB7IGVkaXRvckluZm9GaWVsZCwgZ2V0TGlua3BhdGggfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgVmlld1BsdWdpbiwgRGVjb3JhdGlvbiB9ID0gcmVxdWlyZShcIkBjb2RlbWlycm9yL3ZpZXdcIik7XG5jb25zdCB7IFByZWMsIFJhbmdlU2V0QnVpbGRlciwgU3RhdGVFZmZlY3QgfSA9IHJlcXVpcmUoXCJAY29kZW1pcnJvci9zdGF0ZVwiKTtcbmNvbnN0IHsgc3ludGF4VHJlZSB9ID0gcmVxdWlyZShcIkBjb2RlbWlycm9yL2xhbmd1YWdlXCIpO1xuY29uc3QgeyBjb2xvckZvckZpbGUgfSA9IHJlcXVpcmUoXCIuL3R5cGUtY29sb3JzXCIpO1xuXG4vLyBMaW5rcyBpbSBOb3RpenRleHQgbmFjaCBkZW0gVFlQIGlocmVzIFppZWxzIGVpbmZcdTAwRTRyYmVuLiBPYnNpZGlhbiBmXHUwMEU0cmJ0XG4vLyBpbnRlcm5lIExpbmtzIGluIGJlaWRlbiBEYXJzdGVsbHVuZ2VuIFx1MDBGQ2JlciB2YXIoLS1saW5rLWNvbG9yKSBiencuXG4vLyB2YXIoLS1saW5rLWNvbG9yLWhvdmVyKSAoc2llaGUgYXBwLmNzczogXCIubWFya2Rvd24tcmVuZGVyZWQgLmludGVybmFsLWxpbmtcIlxuLy8gdW5kIFwiLmNtLXMtb2JzaWRpYW4gc3Bhbi5jbS1obWQtaW50ZXJuYWwtbGlua1wiKSAtIHN0YXR0IGVpZ2VuZXIgRmFyYnJlZ2VsblxuLy8gd2lyZCBkYWhlciBudXIgLS1saW5rLWNvbG9yIGplIExpbmsgXHUwMEZDYmVyc2NocmllYmVuLiAtLWxpbmstY29sb3ItaG92ZXIgYmxlaWJ0XG4vLyBiZXd1c3N0IHVuYW5nZXRhc3RldDogYmVpbSBcdTAwRENiZXJmYWhyZW4gZXJzY2hlaW50IHdpZWRlciBkaWUgbm9ybWFsZVxuLy8gTGluay1GYXJiZS4gVW50ZXJzdHJlaWNodW5nIHVuZCBUaGVtZS1BbnBhc3N1bmdlbiBibGVpYmVuIGViZW5zbyBlcmhhbHRlbi5cbi8vXG4vLyBad2VpIGdldHJlbm50ZSBXZWdlLCBkYSBzaWNoIGRpZSBEYXJzdGVsbHVuZ2VuIGdydW5kbGVnZW5kIHVudGVyc2NoZWlkZW46XG4vLyAgLSBMZXNlLU1vZHVzLCBIb3Zlci1Wb3JzY2hhdSwgZ2VyZW5kZXJ0ZSBCbFx1MDBGNmNrZSBpbiBMaXZlIFByZXZpZXcgKFRhYmVsbGVuLFxuLy8gICAgQ2FsbG91dHMpOiBlY2h0ZSA8YSBjbGFzcz1cImludGVybmFsLWxpbmtcIiBkYXRhLWhyZWY9XCJcdTIwMjZcIj4tRWxlbWVudGUgYXVzXG4vLyAgICBPYnNpZGlhbnMgTWFya2Rvd24tUmVuZGVyZXIgLT4gTWFya2Rvd25Qb3N0UHJvY2Vzc29yLCBqZSBMaW5rIGVpbm1hbGlnXG4vLyAgICBiZWltIFJlbmRlcm4uXG4vLyAgLSBMaXZlIFByZXZpZXcvUXVlbGx0ZXh0LU1vZHVzOiBkb3J0IGdpYnQgZXMga2VpbmUgTGluay1FbGVtZW50ZSBtaXRcbi8vICAgIFppZWxhdHRyaWJ1dCwgbnVyIENvZGVNaXJyb3ItU3BhbnMgKFwiLmNtLWhtZC1pbnRlcm5hbC1saW5rXCIpIFx1MDBGQ2JlciBkZW1cbi8vICAgIFJvaHRleHQgLT4gZWlnZW5lciBWaWV3UGx1Z2luLCBkZXIgbnVyIGRlbiBzaWNodGJhcmVuIEJlcmVpY2ggYmV0cmFjaHRldC5cbi8vXG4vLyBOZXUgZWluZ2VmXHUwMEU0cmJ0IHdpcmQgZGFyXHUwMEZDYmVyIGhpbmF1cyBudXIgYmVpIHRhdHNcdTAwRTRjaGxpY2ggZ2VcdTAwRTRuZGVydGVtIFRZUFxuLy8gKHR5cEluZGV4IFwiY2hhbmdlXCIpIG9kZXIgZ2VcdTAwRTRuZGVydGVyIEVpbnN0ZWxsdW5nIC0gbmljaHQgYmVpIGplZGVtIFNwZWljaGVybi5cblxuY29uc3QgQ09MT1JfVkFSID0gXCItLWxpbmstY29sb3JcIjtcbmNvbnN0IFNPVVJDRV9BVFRSID0gXCJkYXRhLWZyZWQtdHlwLXNyY1wiO1xuXG4vLyBbW1ppZWxdXSwgW1taaWVsfEFsaWFzXV0sIFtbWmllbCNcdTAwRENiZXJzY2hyaWZ0XV0gLSBFaW5iZXR0dW5nZW4gKCFbW1x1MjAyNl1dKVxuLy8gYmxlaWJlbiBhdVx1MDBERmVuIHZvciwgZGllIHNpbmQga2VpbmUgTGlua3MgaW0gZWlnZW50bGljaGVuIFNpbm4uIEluIFRhYmVsbGVuXG4vLyBzdGVodCBkaWUgQWxpYXMtUGlwZSBlc2NhcGVkIChcIlxcfFwiKS5cbmNvbnN0IFdJS0lMSU5LX1BBVFRFUk4gPSAvKD88ISEpXFxbXFxbKFteW1xcXV0rPylcXF1cXF0vZztcblxuZnVuY3Rpb24gY29sb3JGb3JMaW5rdGV4dChwbHVnaW4sIGxpbmt0ZXh0LCBzb3VyY2VQYXRoKSB7XG4gIGNvbnN0IHRhcmdldCA9IGxpbmt0ZXh0LnNwbGl0KC9cXFxcP1xcfC8pWzBdLnRyaW0oKTtcbiAgY29uc3QgbGlua3BhdGggPSBnZXRMaW5rcGF0aCh0YXJnZXQpO1xuICBpZiAoIWxpbmtwYXRoKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgZmlsZSA9IHBsdWdpbi5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaXJzdExpbmtwYXRoRGVzdChsaW5rcGF0aCwgc291cmNlUGF0aCk7XG4gIHJldHVybiBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlKTtcbn1cblxuLy8gLS0tIExlc2UtTW9kdXMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmZ1bmN0aW9uIGFwcGx5VG9BbmNob3IocGx1Z2luLCBhbmNob3JFbCkge1xuICBjb25zdCBocmVmID0gYW5jaG9yRWwuZ2V0QXR0cmlidXRlKFwiZGF0YS1ocmVmXCIpO1xuICBjb25zdCBjb2xvciA9XG4gICAgcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MubGlua3MgJiYgaHJlZiAmJiAhYW5jaG9yRWwuY2xhc3NMaXN0LmNvbnRhaW5zKFwiaXMtdW5yZXNvbHZlZFwiKVxuICAgICAgPyBjb2xvckZvckxpbmt0ZXh0KHBsdWdpbiwgaHJlZiwgYW5jaG9yRWwuZ2V0QXR0cmlidXRlKFNPVVJDRV9BVFRSKSA/PyBcIlwiKVxuICAgICAgOiBudWxsO1xuICBpZiAoY29sb3IpIGFuY2hvckVsLnN0eWxlLnNldFByb3BlcnR5KENPTE9SX1ZBUiwgY29sb3IpO1xuICBlbHNlIGFuY2hvckVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KENPTE9SX1ZBUik7XG59XG5cbi8vIEJlcmVpdHMgZ2VyZW5kZXJ0ZSBMaW5rcyBuZXUgZWluZlx1MDBFNHJiZW4gKFRZUC0gb2RlciBFaW5zdGVsbHVuZ3NcdTAwRTRuZGVydW5nKS4gRGVyXG4vLyBQb3N0LVByb2Nlc3NvciBtZXJrdCBzaWNoIGRhZlx1MDBGQ3IgYW4gamVkZW0gTGluayBkZXNzZW4gUXVlbGxub3RpeiwgZGEgZGllIHp1clxuLy8gQXVmbFx1MDBGNnN1bmcgbWVocmRldXRpZ2VyIExpbmt0ZXh0ZSBnZWJyYXVjaHQgd2lyZC4gQWxsZSBGZW5zdGVyIChQb3Atb3V0cylcbi8vIFx1MDBGQ2JlciBpaHJlIExlYXZlcyBlaW5nZXNhbW1lbHQuXG5mdW5jdGlvbiByZWZyZXNoUmVuZGVyZWRMaW5rcyhwbHVnaW4pIHtcbiAgY29uc3QgZG9jcyA9IG5ldyBTZXQoKTtcbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2UuaXRlcmF0ZUFsbExlYXZlcygobGVhZikgPT4gZG9jcy5hZGQobGVhZi52aWV3LmNvbnRhaW5lckVsLm93bmVyRG9jdW1lbnQpKTtcbiAgZm9yIChjb25zdCBkb2Mgb2YgZG9jcykge1xuICAgIGZvciAoY29uc3QgYW5jaG9yRWwgb2YgZG9jLnF1ZXJ5U2VsZWN0b3JBbGwoYGEuaW50ZXJuYWwtbGlua1ske1NPVVJDRV9BVFRSfV1gKSkgYXBwbHlUb0FuY2hvcihwbHVnaW4sIGFuY2hvckVsKTtcbiAgfVxufVxuXG4vLyAtLS0gTGl2ZSBQcmV2aWV3IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgcmVmcmVzaEVmZmVjdCA9IFN0YXRlRWZmZWN0LmRlZmluZSgpO1xuXG5mdW5jdGlvbiBidWlsZExpbmtWaWV3UGx1Z2luKHBsdWdpbikge1xuICBjb25zdCBkZWNvcmF0aW9uc0J5Q29sb3IgPSBuZXcgTWFwKCk7XG4gIGNvbnN0IGRlY29yYXRpb25Gb3IgPSAoY29sb3IpID0+IHtcbiAgICBsZXQgZGVjb3JhdGlvbiA9IGRlY29yYXRpb25zQnlDb2xvci5nZXQoY29sb3IpO1xuICAgIGlmICghZGVjb3JhdGlvbikge1xuICAgICAgZGVjb3JhdGlvbiA9IERlY29yYXRpb24ubWFyayh7XG4gICAgICAgIGNsYXNzOiBcImZyZWQtdHlwLWxpbmtcIixcbiAgICAgICAgYXR0cmlidXRlczogeyBzdHlsZTogYCR7Q09MT1JfVkFSfTogJHtjb2xvcn07YCB9LFxuICAgICAgfSk7XG4gICAgICBkZWNvcmF0aW9uc0J5Q29sb3Iuc2V0KGNvbG9yLCBkZWNvcmF0aW9uKTtcbiAgICB9XG4gICAgcmV0dXJuIGRlY29yYXRpb247XG4gIH07XG5cbiAgY29uc3QgYnVpbGQgPSAodmlldykgPT4ge1xuICAgIGlmICghcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MubGlua3MpIHJldHVybiBEZWNvcmF0aW9uLm5vbmU7XG4gICAgY29uc3Qgc291cmNlUGF0aCA9IHZpZXcuc3RhdGUuZmllbGQoZWRpdG9ySW5mb0ZpZWxkLCBmYWxzZSk/LmZpbGU/LnBhdGggPz8gXCJcIjtcbiAgICBjb25zdCB0cmVlID0gc3ludGF4VHJlZSh2aWV3LnN0YXRlKTtcbiAgICBjb25zdCBidWlsZGVyID0gbmV3IFJhbmdlU2V0QnVpbGRlcigpO1xuXG4gICAgZm9yIChjb25zdCB7IGZyb20sIHRvIH0gb2Ygdmlldy52aXNpYmxlUmFuZ2VzKSB7XG4gICAgICBjb25zdCB0ZXh0ID0gdmlldy5zdGF0ZS5zbGljZURvYyhmcm9tLCB0byk7XG4gICAgICBXSUtJTElOS19QQVRURVJOLmxhc3RJbmRleCA9IDA7XG4gICAgICBmb3IgKGxldCBtYXRjaDsgKG1hdGNoID0gV0lLSUxJTktfUEFUVEVSTi5leGVjKHRleHQpKTsgKSB7XG4gICAgICAgIGNvbnN0IHN0YXJ0ID0gZnJvbSArIG1hdGNoLmluZGV4O1xuICAgICAgICAvLyBOdXIsIHdhcyBPYnNpZGlhbnMgTWFya2Rvd24tUGFyc2VyIHNlbGJzdCBhbHMgaW50ZXJuZW4gTGluayBlcmtlbm50IC1cbiAgICAgICAgLy8gc2NobGllXHUwMERGdCB6LiBCLiBbW1x1MjAyNl1dIGluIENvZGUtQmxcdTAwRjZja2VuIG9kZXIgSW5saW5lLUNvZGUgYXVzLlxuICAgICAgICBpZiAoIXRyZWUucmVzb2x2ZUlubmVyKHN0YXJ0ICsgMiwgMSkubmFtZS5pbmNsdWRlcyhcImhtZC1pbnRlcm5hbC1saW5rXCIpKSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgY29sb3IgPSBjb2xvckZvckxpbmt0ZXh0KHBsdWdpbiwgbWF0Y2hbMV0sIHNvdXJjZVBhdGgpO1xuICAgICAgICBpZiAoY29sb3IpIGJ1aWxkZXIuYWRkKHN0YXJ0LCBzdGFydCArIG1hdGNoWzBdLmxlbmd0aCwgZGVjb3JhdGlvbkZvcihjb2xvcikpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gYnVpbGRlci5maW5pc2goKTtcbiAgfTtcblxuICByZXR1cm4gVmlld1BsdWdpbi5mcm9tQ2xhc3MoXG4gICAgY2xhc3Mge1xuICAgICAgY29uc3RydWN0b3Iodmlldykge1xuICAgICAgICB0aGlzLmRlY29yYXRpb25zID0gYnVpbGQodmlldyk7XG4gICAgICB9XG5cbiAgICAgIC8vIERlciBQYXJzZXIgYXJiZWl0ZXQgZGVuIHNpY2h0YmFyZW4gQmVyZWljaCBnZ2YuIGVyc3QgbmFjaCB1bmQgbmFjaCBhYiAtXG4gICAgICAvLyBlaW4gbmV1ZXIgU3ludGF4YmF1bSB6XHUwMEU0aGx0IGRhaGVyIGViZW5mYWxscyBhbHMgQW5sYXNzIHp1bSBOZXVhdWZiYXUuXG4gICAgICB1cGRhdGUodXBkYXRlKSB7XG4gICAgICAgIGlmIChcbiAgICAgICAgICB1cGRhdGUuZG9jQ2hhbmdlZCB8fFxuICAgICAgICAgIHVwZGF0ZS52aWV3cG9ydENoYW5nZWQgfHxcbiAgICAgICAgICBzeW50YXhUcmVlKHVwZGF0ZS5zdGFydFN0YXRlKSAhPT0gc3ludGF4VHJlZSh1cGRhdGUuc3RhdGUpIHx8XG4gICAgICAgICAgdXBkYXRlLnRyYW5zYWN0aW9ucy5zb21lKCh0cikgPT4gdHIuZWZmZWN0cy5zb21lKChlZmZlY3QpID0+IGVmZmVjdC5pcyhyZWZyZXNoRWZmZWN0KSkpXG4gICAgICAgICkge1xuICAgICAgICAgIHRoaXMuZGVjb3JhdGlvbnMgPSBidWlsZCh1cGRhdGUudmlldyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LFxuICAgIHsgZGVjb3JhdGlvbnM6ICh2YWx1ZSkgPT4gdmFsdWUuZGVjb3JhdGlvbnMgfVxuICApO1xufVxuXG5mdW5jdGlvbiByZWZyZXNoRWRpdG9ycyhwbHVnaW4pIHtcbiAgcGx1Z2luLmFwcC53b3Jrc3BhY2UuaXRlcmF0ZUFsbExlYXZlcygobGVhZikgPT4ge1xuICAgIGxlYWYudmlldz8uZWRpdG9yPy5jbT8uZGlzcGF0Y2goeyBlZmZlY3RzOiByZWZyZXNoRWZmZWN0Lm9mKG51bGwpIH0pO1xuICB9KTtcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmZ1bmN0aW9uIHJlZ2lzdGVyTGlua0NvbG9ycyhwbHVnaW4pIHtcbiAgcGx1Z2luLnJlZ2lzdGVyTWFya2Rvd25Qb3N0UHJvY2Vzc29yKChlbCwgY3R4KSA9PiB7XG4gICAgLy8gUXVlbGxlIGltbWVyIHZlcm1lcmtlbiwgYXVjaCBiZWkgYXVzZ2VzY2hhbHRldGVyIEVpbmZcdTAwRTRyYnVuZyAtIHNvIGdyZWlmdFxuICAgIC8vIGVpbiBzcFx1MDBFNHRlcmVzIEVpbnNjaGFsdGVuIGF1Y2ggZlx1MDBGQ3IgYmVyZWl0cyBnZXJlbmRlcnRlIExpbmtzLlxuICAgIGZvciAoY29uc3QgYW5jaG9yRWwgb2YgZWwucXVlcnlTZWxlY3RvckFsbChcImEuaW50ZXJuYWwtbGlua1wiKSkge1xuICAgICAgYW5jaG9yRWwuc2V0QXR0cmlidXRlKFNPVVJDRV9BVFRSLCBjdHguc291cmNlUGF0aCk7XG4gICAgICBhcHBseVRvQW5jaG9yKHBsdWdpbiwgYW5jaG9yRWwpO1xuICAgIH1cbiAgfSk7XG4gIC8vIE9ic2lkaWFucyBTeW50YXgtU3BhbiBcIi5jbS1obWQtaW50ZXJuYWwtbGlua1wiIGxpZWd0IHVuYWJoXHUwMEU0bmdpZyB2b24gZGVyXG4gIC8vIFByaW9yaXRcdTAwRTR0IGltbWVyIGF1XHUwMERGZW4sIGRpZSBNYXJraWVydW5nIGFsc28gZGFyaW4gLSBkaWUgRmFyYmUgc2V0enQgZGFoZXJcbiAgLy8gZWluZSBlaWdlbmUgUmVnZWwgaW4gc3R5bGVzLmNzcyAoLmZyZWQtdHlwLWxpbmspLiBOaWVkcmlnc3RlIFByaW9yaXRcdTAwRTR0IGxlZ3RcbiAgLy8gc2llIGltbWVyaGluIHVtIFwiLmNtLXVuZGVybGluZVwiIGhlcnVtLCBkYW1pdCBkZXIgZ2FuemUgTGlua3RleHQgZXJmYXNzdCBpc3QuXG4gIHBsdWdpbi5yZWdpc3RlckVkaXRvckV4dGVuc2lvbihQcmVjLmxvd2VzdChidWlsZExpbmtWaWV3UGx1Z2luKHBsdWdpbikpKTtcblxuICBjb25zdCByZWZyZXNoID0gKCkgPT4ge1xuICAgIHJlZnJlc2hSZW5kZXJlZExpbmtzKHBsdWdpbik7XG4gICAgcmVmcmVzaEVkaXRvcnMocGx1Z2luKTtcbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgLy8gRGllIEVkaXRvci1EZWtvcmF0aW9uZW4gdmVyc2Nod2luZGVuIGJlaW0gRW50bGFkZW4gbWl0IGRlciBFcndlaXRlcnVuZyB2b25cbiAgLy8gc2VsYnN0LCBkaWUgSW5saW5lLVZhcmlhYmxlbiBhbiBnZXJlbmRlcnRlbiBMaW5rcyBuaWNodC5cbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IHtcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5pdGVyYXRlQWxsTGVhdmVzKChsZWFmKSA9PiB7XG4gICAgICBmb3IgKGNvbnN0IGFuY2hvckVsIG9mIGxlYWYudmlldy5jb250YWluZXJFbC5xdWVyeVNlbGVjdG9yQWxsKGBhLmludGVybmFsLWxpbmtbJHtTT1VSQ0VfQVRUUn1dYCkpIHtcbiAgICAgICAgYW5jaG9yRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoQ09MT1JfVkFSKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSk7XG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJMaW5rQ29sb3JzIH07XG4iLCAiY29uc3QgeyBnZXRTdWJ0eXBlTmFtZXMsIGdldFN1YnR5cGUgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cGVzXCIpO1xuXG5jb25zdCBUWVBfUFJPUEVSVFkgPSBcIlRZUFwiO1xuY29uc3QgVFlQX1ZJRVdfVFlQRSA9IFwiZnJlZC10eXAtdmlld1wiO1xuY29uc3QgQUxMX1BST1BFUlRJRVNfVklFV19UWVBFID0gXCJhbGwtcHJvcGVydGllc1wiO1xuY29uc3QgSElHSExJR0hUX0NMQVNTID0gXCJmcmVkLXR5cC1kZWZhdWx0LXByb3BlcnR5XCI7XG4vLyBGbG9hdGluZyBQcm9wZXJ0aWVzIChzaWVoZSB0eXBlRmxvYXRpbmdLZXlzIGluIHNldHRpbmdzLmpzKSAtIGRpZXNlbGJlXG4vLyBMaXN0ZSB3aWUgZGllIFx1MDBGQ2JyaWdlbiBTdGFuZGFyZC1Qcm9wZXJ0aWVzIGRlcyBUeXBzLCBhYmVyIGt1cnNpdiBzdGF0dCBmZXR0XG4vLyBtYXJraWVydCwgYW5hbG9nIHp1IEhJR0hMSUdIVF9DTEFTUy5cbmNvbnN0IEZMT0FUSU5HX0NMQVNTID0gXCJmcmVkLXR5cC1mbG9hdGluZy1wcm9wZXJ0eVwiO1xuXG4vLyBPYnNpZGlhbiBzY2hyZWlidCBkYXRhLXByb3BlcnR5LWtleSBpbnRlcm4gaW1tZXIga2xlaW4gKHVuYWJoXHUwMEU0bmdpZyB2b24gZGVyXG4vLyBTY2hyZWlid2Vpc2UgaW0gWUFNTCkgLSBWZXJnbGVpY2ggZGVzaGFsYiBlYmVuZmFsbHMgY2FzZS1pbnNlbnNpdGl2ZS4gVFlQXG4vLyBpc3Qga2VpbmUgZWNodGUgXCJTdGFuZGFyZFwiLVByb3BlcnR5IChpaHIgV2VydCBpc3QgaW1tZXIgZGVyIFRZUC1OYW1lXG4vLyBzZWxic3QpIC0gZmFsbHMgZG9jaCBub2NoIGlyZ2VuZHdvIGVpbiBhbHRlciBFaW50cmFnIGhlcnVtbGllZ3QsIGhpZXJcbi8vIGViZW5mYWxscyBpZ25vcmllcmVuIHN0YXR0IGRpZSBUWVAtWmVpbGUgZmV0dCB6dSBtYXJraWVyZW4uXG5mdW5jdGlvbiByYXdLZXlzRm9yVHlwZSh0eXBlLCBkZWZhdWx0cykge1xuICBpZiAoIXR5cGUgfHwgIWRlZmF1bHRzKSByZXR1cm4gbnVsbDtcbiAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKGRlZmF1bHRzKS5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBcIlwiICYmIGtleS50b0xvd2VyQ2FzZSgpICE9PSBUWVBfUFJPUEVSVFkudG9Mb3dlckNhc2UoKSk7XG4gIHJldHVybiBrZXlzLmxlbmd0aCA+IDAgPyBrZXlzLm1hcCgoa2V5KSA9PiBrZXkudG9Mb3dlckNhc2UoKSkgOiBudWxsO1xufVxuXG4vLyBGcm9udG1hdHRlci1CbFx1MDBGNmNrZSBlaW5lcyBUWVBzIGFscyBMaXN0ZSB2b24geyBrZXlzLCBmbG9hdGluZyB9IChqZXdlaWxzXG4vLyBsb3dlcmNhc2UpOiB6dWVyc3QgZGFzIFN0YW5kYXJkLUZyb250bWF0dGVyIGRlcyBUWVBzLCBkYW5hY2ggLSBmYWxsc1xuLy8gZ2V3XHUwMEZDbnNjaHQgLSBkZXIgQmxvY2sgZWluZXMgYmVzdGltbXRlbiBTdWJ0eXBzIChzdWJ0eXBlKSBiencuIGFsbGVyIHNlaW5lclxuLy8gU3VidHlwZW4gKHN1YnR5cGUgPT09IEFMTF9TVUJUWVBFUyksIHNpZWhlIHN1YnR5cGVzLmpzLlxuY29uc3QgQUxMX1NVQlRZUEVTID0gU3ltYm9sKFwiYWxsLXN1YnR5cGVzXCIpO1xuXG5mdW5jdGlvbiBibG9ja09mKGRlZmF1bHRzLCBmbG9hdGluZ0tleXMpIHtcbiAgY29uc3Qga2V5cyA9IHJhd0tleXNGb3JUeXBlKHRydWUsIGRlZmF1bHRzKSA/PyBbXTtcbiAgcmV0dXJuIHsga2V5cywgZmxvYXRpbmc6IG5ldyBTZXQoKGZsb2F0aW5nS2V5cyA/PyBbXSkubWFwKChrZXkpID0+IGtleS50b0xvd2VyQ2FzZSgpKSkgfTtcbn1cblxuZnVuY3Rpb24gYmxvY2tzRm9yVHlwZShwbHVnaW4sIHR5cGUsIHN1YnR5cGUpIHtcbiAgY29uc3QgeyBzZXR0aW5ncyB9ID0gcGx1Z2luO1xuICBjb25zdCBibG9ja3MgPSBbYmxvY2tPZihzZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdLCBzZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdKV07XG4gIGNvbnN0IHN1YnR5cGVOYW1lcyA9IHN1YnR5cGUgPT09IEFMTF9TVUJUWVBFUyA/IGdldFN1YnR5cGVOYW1lcyhzZXR0aW5ncywgdHlwZSkgOiBzdWJ0eXBlID8gW3N1YnR5cGVdIDogW107XG4gIGZvciAoY29uc3QgbmFtZSBvZiBzdWJ0eXBlTmFtZXMpIHtcbiAgICBjb25zdCBkYXRhID0gZ2V0U3VidHlwZShzZXR0aW5ncywgdHlwZSwgbmFtZSk7XG4gICAgaWYgKGRhdGEpIGJsb2Nrcy5wdXNoKGJsb2NrT2YoZGF0YS5mcm9udG1hdHRlciwgZGF0YS5mbG9hdGluZ0tleXMpKTtcbiAgfVxuICByZXR1cm4gYmxvY2tzO1xufVxuXG4vLyBMaWVmZXJ0IGdldHJlbm50ZSBTZXRzIGZcdTAwRkNyIGZldHQgZGFyenVzdGVsbGVuZGUgKFwic3RhbmRhcmRcIikgdW5kIGt1cnNpdlxuLy8gZGFyenVzdGVsbGVuZGUgKFwiZmxvYXRpbmdcIikgUHJvcGVydHktTmFtZW4gKGpld2VpbHMgbG93ZXJjYXNlKSBhdXMgZGVuXG4vLyBcdTAwRkNiZXJnZWJlbmVuIEJsXHUwMEY2Y2tlbiAtIEZsb2F0aW5nLW1hcmtpZXJ0ZSBLZXlzIHpcdTAwRTRobGVuIGRhYmVpIG51ciB6dVxuLy8gXCJmbG9hdGluZ1wiLCBuaWUgenVzXHUwMEU0dHpsaWNoIHp1IFwic3RhbmRhcmRcIi4gS29tbXQgZWluIEtleSBpbiBtZWhyZXJlbiBCbFx1MDBGNmNrZW5cbi8vIHZvciAoU3VidHlwIFx1MDBGQ2JlcnNjaHJlaWJ0IFRZUCksIGdpbHQgZGllIE1hcmtpZXJ1bmcgZGVzIHNwXHUwMEU0dGVyZW4gQmxvY2tzLlxuZnVuY3Rpb24gc3BsaXRLZXlzKGJsb2Nrcykge1xuICBjb25zdCBpc0Zsb2F0aW5nID0gbmV3IE1hcCgpO1xuICBmb3IgKGNvbnN0IHsga2V5cywgZmxvYXRpbmcgfSBvZiBibG9ja3MpIHtcbiAgICBmb3IgKGNvbnN0IGtleSBvZiBrZXlzKSBpc0Zsb2F0aW5nLnNldChrZXksIGZsb2F0aW5nLmhhcyhrZXkpKTtcbiAgfVxuICBjb25zdCBzdGFuZGFyZCA9IG5ldyBTZXQoKTtcbiAgY29uc3QgZmxvYXRpbmcgPSBuZXcgU2V0KCk7XG4gIGZvciAoY29uc3QgW2tleSwgZmxhZ10gb2YgaXNGbG9hdGluZykgKGZsYWcgPyBmbG9hdGluZyA6IHN0YW5kYXJkKS5hZGQoa2V5KTtcbiAgcmV0dXJuIHsgc3RhbmRhcmQ6IHN0YW5kYXJkLnNpemUgPiAwID8gc3RhbmRhcmQgOiBudWxsLCBmbG9hdGluZzogZmxvYXRpbmcuc2l6ZSA+IDAgPyBmbG9hdGluZyA6IG51bGwgfTtcbn1cblxuY29uc3QgTk9fS0VZUyA9IHsgc3RhbmRhcmQ6IG51bGwsIGZsb2F0aW5nOiBudWxsIH07XG5cbmZ1bmN0aW9uIGtleXNGb3JGaWxlKHBsdWdpbiwgZmlsZSkge1xuICBjb25zdCB7IGNvbG9yVmlld3MgfSA9IHBsdWdpbi5zZXR0aW5ncztcbiAgaWYgKCFjb2xvclZpZXdzLmZyb250bWF0dGVyRGVmYXVsdHMpIHJldHVybiBOT19LRVlTO1xuICBjb25zdCB0eXBlID0gcGx1Z2luLnR5cEluZGV4LnR5cGVPZihmaWxlKTtcbiAgaWYgKCF0eXBlKSByZXR1cm4gTk9fS0VZUztcbiAgY29uc3Qgc3VidHlwZSA9IGNvbG9yVmlld3MuZnJvbnRtYXR0ZXJEZWZhdWx0c1N1YnR5cCA/IHBsdWdpbi50eXBJbmRleC5zdWJ0eXBlT2YoZmlsZSkgOiBudWxsO1xuICByZXR1cm4gc3BsaXRLZXlzKGJsb2Nrc0ZvclR5cGUocGx1Z2luLCB0eXBlLCBzdWJ0eXBlKSk7XG59XG5cbi8vIEVkaXRvciBkZXIgVFlQLURldGFpbGFuc2ljaHQ6IGRlciBnZW1laW5zYW1lIEVkaXRvciBcdTAwRkNiZXIgYWxsZSBCbFx1MDBGNmNrZSBlaW5lc1xuLy8gVFlQcyAoc3RvcmUudW5pZmllZCwgc2llaGUgdW5pZmllZC1mcm9udG1hdHRlci1lZGl0b3IuanMpIC0gU3VidHlwLUJsXHUwMEY2Y2tlXG4vLyBudXIgbWl0IGRlbSBVbnRlci1TY2hhbHRlciBcIlN1YnR5cFwiIC0gYnp3LiBlaW4gZWluemVsbmVyIEJsb2NrIChzaWVoZVxuLy8gdHlwZVN0b3JlL3N1YnR5cGVTdG9yZSBpbiB0eXBlLWZyb250bWF0dGVyLWVkaXRvci5qcykuXG5mdW5jdGlvbiBrZXlzRm9yU3RvcmUocGx1Z2luLCBzdG9yZSkge1xuICBjb25zdCB7IGNvbG9yVmlld3MgfSA9IHBsdWdpbi5zZXR0aW5ncztcbiAgaWYgKCFjb2xvclZpZXdzLmZyb250bWF0dGVyRGVmYXVsdHMgfHwgIXN0b3JlKSByZXR1cm4gTk9fS0VZUztcbiAgaWYgKHN0b3JlLnVuaWZpZWQpIHtcbiAgICByZXR1cm4gc3BsaXRLZXlzKGJsb2Nrc0ZvclR5cGUocGx1Z2luLCBzdG9yZS50eXBlLCBjb2xvclZpZXdzLmZyb250bWF0dGVyRGVmYXVsdHNTdWJ0eXAgPyBBTExfU1VCVFlQRVMgOiBudWxsKSk7XG4gIH1cbiAgaWYgKHN0b3JlLnN1YnR5cGUgJiYgIWNvbG9yVmlld3MuZnJvbnRtYXR0ZXJEZWZhdWx0c1N1YnR5cCkgcmV0dXJuIE5PX0tFWVM7XG4gIHJldHVybiBzcGxpdEtleXMoW2Jsb2NrT2Yoc3RvcmUuZ2V0RnJvbnRtYXR0ZXIoKSwgc3RvcmUuZ2V0RmxvYXRpbmcoKSldKTtcbn1cblxuLy8gUHJvcGVydHktTmFtZSAobG93ZXJjYXNlKSAtPiBNYXAoVFlQIC0+IG51ciBhbHMgRmxvYXRpbmcgbWFya2llcnQ/KSBcdTAwRkNiZXJcbi8vIGFsbGUgVHlwZW4sIGluIGRlcmVuIEZyb250bWF0dGVyIChnZ2YuIGlua2wuIGlocmVyIFN1YnR5cC1CbFx1MDBGNmNrZSkgZXJcbi8vIHZvcmtvbW10LiBEaWUgXCJBbGwgUHJvcGVydGllc1wiLUFuc2ljaHQgaXN0IHZhdWx0LXdlaXQgdW5kIGtlbm50IGtlaW5lblxuLy8gZWluemVsbmVuIFRZUC1Lb250ZXh0IC0gZGFoZXIgaGllciBzdGF0dCBlaW5lcyBlaW56ZWxuZW4gRmV0dC1GbGFncyBnbGVpY2hcbi8vIGRpZSB2b2xsc3RcdTAwRTRuZGlnZSBadW9yZG51bmcgc2FtbWVsbiwgZGFtaXQgYXBwbHlUb0FsbFByb3BlcnRpZXNWaWV3IHp3aXNjaGVuXG4vLyBcImdlbmF1IGVpbiBUeXBcIiAoZWluZlx1MDBFNHJiZW4pIHVuZCBcIm1laHJlcmUgVHlwZW5cIiAoZmV0dCkgdW50ZXJzY2hlaWRlbiBrYW5uLlxuLy8gRWlnZW5lciBTY2hhbHRlciAoY29sb3JWaWV3cy5hbGxQcm9wZXJ0aWVzKSwgdW5hYmhcdTAwRTRuZ2lnIHZvblxuLy8gY29sb3JWaWV3cy5mcm9udG1hdHRlckRlZmF1bHRzLiBFaW5lIFN1YnR5cC1Qcm9wZXJ0eSB6XHUwMEU0aGx0IGZcdTAwRkNyIGlocmVuIFRZUC5cbmZ1bmN0aW9uIHR5cGVzVXNpbmdLZXlNYXAocGx1Z2luKSB7XG4gIGNvbnN0IG1hcCA9IG5ldyBNYXAoKTtcbiAgY29uc3QgeyBjb2xvclZpZXdzIH0gPSBwbHVnaW4uc2V0dGluZ3M7XG4gIGlmICghY29sb3JWaWV3cy5hbGxQcm9wZXJ0aWVzKSByZXR1cm4gbWFwO1xuICBjb25zdCB0eXBlcyA9IG5ldyBTZXQoW1xuICAgIC4uLk9iamVjdC5rZXlzKHBsdWdpbi5zZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyKSxcbiAgICAuLi4oY29sb3JWaWV3cy5hbGxQcm9wZXJ0aWVzU3VidHlwID8gT2JqZWN0LmtleXMocGx1Z2luLnNldHRpbmdzLnR5cGVTdWJ0eXBlcyA/PyB7fSkgOiBbXSksXG4gIF0pO1xuICBmb3IgKGNvbnN0IHR5cGUgb2YgdHlwZXMpIHtcbiAgICBjb25zdCBibG9ja3MgPSBibG9ja3NGb3JUeXBlKHBsdWdpbiwgdHlwZSwgY29sb3JWaWV3cy5hbGxQcm9wZXJ0aWVzU3VidHlwID8gQUxMX1NVQlRZUEVTIDogbnVsbCk7XG4gICAgZm9yIChjb25zdCB7IGtleXMsIGZsb2F0aW5nIH0gb2YgYmxvY2tzKSB7XG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBrZXlzKSB7XG4gICAgICAgIGlmICghbWFwLmhhcyhrZXkpKSBtYXAuc2V0KGtleSwgbmV3IE1hcCgpKTtcbiAgICAgICAgY29uc3QgYnlUeXBlID0gbWFwLmdldChrZXkpO1xuICAgICAgICBieVR5cGUuc2V0KHR5cGUsIChieVR5cGUuZ2V0KHR5cGUpID8/IHRydWUpICYmIGZsb2F0aW5nLmhhcyhrZXkpKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIG1hcDtcbn1cblxuLy8gTnVyIGRhcyBMYWJlbCAoUHJvcGVydHktS2V5LUlucHV0KSBmZXR0L2t1cnNpdiBtYXJraWVyZW4sIG5pY2h0IGRpZSBXZXJ0ZSAtXG4vLyBiZXRyaWZmdCBzb3dvaGwgTm90aXplbiAoRnJvbnRtYXR0ZXIgaW0gRG9rdW1lbnQgKyBcIlByb3BlcnRpZXNcIi1cbi8vIFNlaXRlbmxlaXN0ZSkgYWxzIGF1Y2ggZGllIGVpZ2VuZSBUWVAtRGV0YWlsYW5zaWNodCBkZXMgUGx1Z2lucyBzZWxic3QuXG5mdW5jdGlvbiBhcHBseVRvQ29udGFpbmVyKGNvbnRhaW5lckVsLCBzdGFuZGFyZEtleXMsIGZsb2F0aW5nS2V5cykge1xuICBpZiAoIWNvbnRhaW5lckVsKSByZXR1cm47XG4gIGNvbnN0IHJvd3MgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLm1ldGFkYXRhLXByb3BlcnR5W2RhdGEtcHJvcGVydHkta2V5XVwiKTtcbiAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgIGNvbnN0IGtleUVsID0gcm93LnF1ZXJ5U2VsZWN0b3IoXCIubWV0YWRhdGEtcHJvcGVydHkta2V5LWlucHV0XCIpO1xuICAgIGlmICgha2V5RWwpIGNvbnRpbnVlO1xuICAgIGNvbnN0IHByb3BlcnR5S2V5ID0gcm93LmdldEF0dHJpYnV0ZShcImRhdGEtcHJvcGVydHkta2V5XCIpO1xuICAgIGtleUVsLmNsYXNzTGlzdC50b2dnbGUoSElHSExJR0hUX0NMQVNTLCAhIXN0YW5kYXJkS2V5cyAmJiBzdGFuZGFyZEtleXMuaGFzKHByb3BlcnR5S2V5KSk7XG4gICAga2V5RWwuY2xhc3NMaXN0LnRvZ2dsZShGTE9BVElOR19DTEFTUywgISFmbG9hdGluZ0tleXMgJiYgZmxvYXRpbmdLZXlzLmhhcyhwcm9wZXJ0eUtleSkpO1xuICB9XG59XG5cbi8vIERpZSBcIkFsbCBQcm9wZXJ0aWVzXCItQW5zaWNodCByZW5kZXJ0IGlocmUgWmVpbGVuIG5pY2h0IFx1MDBGQ2JlciBkYXNcbi8vIE1ldGFkYXRhLVdpZGdldCwgc29uZGVybiBcdTAwRkNiZXIgZWlnZW5lIFRyZWUtSXRlbS1Lb21wb25lbnRlbiAoS2xhc3NlIFwiYUhcIiBpbVxuLy8gZ2ViYXV0ZW4gYXBwLmpzKSwgZXJyZWljaGJhciBcdTAwRkNiZXIgdmlldy5kb21zIChQcm9wZXJ0eS1OYW1lIC0+IEtvbXBvbmVudGUpLlxuLy8gRGVyZW4gVGl0ZWwtRWxlbWVudCB0clx1MDBFNGd0IGRpZSBLbGFzc2UgXCJ0cmVlLWl0ZW0taW5uZXItdGV4dFwiLCBuaWNodFxuLy8gXCIubWV0YWRhdGEtcHJvcGVydHkta2V5LWlucHV0XCIgd2llIGltIEZyb250bWF0dGVyLVdpZGdldC5cbi8vXG4vLyBOdXR6dCBnZW5hdSBlaW4gVHlwIGRpZXNlIFByb3BlcnR5IGFscyBTdGFuZGFyZCwgd2lyZCBkZXIgTmFtZSBpbiBkZXNzZW5cbi8vIEZhcmJlIGVpbmdlZlx1MDBFNHJidCAod2llIGRlciBGYXJicHVua3QvZGllIExpc3RlIGRlcyBUeXBzKSAtIGVpbmRldXRpZyBnZW51Zyxcbi8vIHVtIHNpZSB6dXp1b3JkbmVuLiBOdXR6ZW4gbWVocmVyZSBUeXBlbiBzaWUsIHdcdTAwRTRyZSBlaW5lIGVpbnplbG5lIEZhcmJlXG4vLyBpcnJlZlx1MDBGQ2hyZW5kLCBkYWhlciBzdGF0dGRlc3NlbiBmZXR0IChkaWVzZWxiZSBNYXJraWVydW5nIHdpZSBpbVxuLy8gRnJvbnRtYXR0ZXItV2lkZ2V0IGVpbmVyIE5vdGl6KS5cbmZ1bmN0aW9uIGFwcGx5VG9BbGxQcm9wZXJ0aWVzVmlldyhwbHVnaW4pIHtcbiAgY29uc3QgdXNhZ2VNYXAgPSB0eXBlc1VzaW5nS2V5TWFwKHBsdWdpbik7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoQUxMX1BST1BFUlRJRVNfVklFV19UWVBFKSkge1xuICAgIGNvbnN0IGRvbXMgPSBsZWFmLnZpZXc/LmRvbXM7XG4gICAgaWYgKCFkb21zKSBjb250aW51ZTtcbiAgICBmb3IgKGNvbnN0IFtrZXksIGRvbV0gb2YgT2JqZWN0LmVudHJpZXMoZG9tcykpIHtcbiAgICAgIGNvbnN0IHRpdGxlRWwgPSBkb20/LnRpdGxlRWw7XG4gICAgICBpZiAoIXRpdGxlRWwpIGNvbnRpbnVlO1xuXG4gICAgICBjb25zdCB0eXBlcyA9IHVzYWdlTWFwLmdldChrZXkudG9Mb3dlckNhc2UoKSk7XG4gICAgICBjb25zdCBjb3VudCA9IHR5cGVzID8gdHlwZXMuc2l6ZSA6IDA7XG4gICAgICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoSElHSExJR0hUX0NMQVNTLCBjb3VudCA+IDEpO1xuXG4gICAgICAvLyBLdXJzaXYgbnVyLCB3ZW5uIGVpbmRldXRpZyBnZW5hdSBlaW4gVFlQIGRpZSBQcm9wZXJ0eSBudXR6dCBVTkQgc2llXG4gICAgICAvLyBkb3J0IFx1MDBGQ2JlcmFsbCAoVFlQLSB3aWUgU3VidHlwLUJsXHUwMEY2Y2tlKSBhbHMgRmxvYXRpbmcgbWFya2llcnQgaXN0IC0gYmVpXG4gICAgICAvLyBtZWhyZXJlbiBUWVBzIChGZXR0LUZhbGwpIHdcdTAwRTRyZSBuaWNodCBrbGFyLCB3ZXNzZW4gRmxvYXRpbmctTWFya2llcnVuZ1xuICAgICAgLy8gZ2VtZWludCBpc3QuXG4gICAgICBsZXQgaXNGbG9hdGluZyA9IGZhbHNlO1xuICAgICAgaWYgKGNvdW50ID09PSAxKSB7XG4gICAgICAgIGNvbnN0IFtbb25seVR5cGUsIG9ubHlGbG9hdGluZ11dID0gdHlwZXM7XG4gICAgICAgIGlzRmxvYXRpbmcgPSBvbmx5RmxvYXRpbmc7XG4gICAgICAgIGNvbnN0IGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnNbb25seVR5cGVdO1xuICAgICAgICAvLyAhaW1wb3J0YW50IHZpYSBzZXRQcm9wZXJ0eSwgZGEgZGllIEZldHQtUmVnZWwgZlx1MDBGQ3IgLmZyZWQtdHlwLWRlZmF1bHQtXG4gICAgICAgIC8vIHByb3BlcnR5IGluIHN0eWxlcy5jc3MgZWJlbmZhbGxzICFpbXBvcnRhbnQgY29sb3Igc2V0enQgdW5kIGVpblxuICAgICAgICAvLyBJbmxpbmUtU3R5bGUgb2huZSAhaW1wb3J0YW50IGRhZ2VnZW4gdmVybGllcmVuIHdcdTAwRkNyZGUsIGZhbGxzIGRpZVxuICAgICAgICAvLyBLbGFzc2UgKGF1cyBlaW5lbSB2b3JoZXJpZ2VuIFp1c3RhbmQgbWl0IG1laHJlcmVuIFR5cGVuKSBub2NoIGRyYW5oXHUwMEU0bmd0LlxuICAgICAgICBpZiAoY29sb3IpIHRpdGxlRWwuc3R5bGUuc2V0UHJvcGVydHkoXCJjb2xvclwiLCBjb2xvciwgXCJpbXBvcnRhbnRcIik7XG4gICAgICAgIGVsc2UgdGl0bGVFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImNvbG9yXCIpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGl0bGVFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImNvbG9yXCIpO1xuICAgICAgfVxuICAgICAgdGl0bGVFbC5jbGFzc0xpc3QudG9nZ2xlKEZMT0FUSU5HX0NMQVNTLCBpc0Zsb2F0aW5nKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gYXBwbHlGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xuICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXc7XG4gICAgY29uc3QgeyBzdGFuZGFyZCwgZmxvYXRpbmcgfSA9IGtleXNGb3JGaWxlKHBsdWdpbiwgdmlldz8uZmlsZSk7XG4gICAgYXBwbHlUb0NvbnRhaW5lcih2aWV3Py5tZXRhZGF0YUVkaXRvcj8uY29udGFpbmVyRWwsIHN0YW5kYXJkLCBmbG9hdGluZyk7XG4gIH1cblxuICAvLyBEaWUgXCJQcm9wZXJ0aWVzXCItU2VpdGVubGVpc3RlIHplaWd0IGltbWVyIGRpZSBha3RpdmUgRGF0ZWksIGhcdTAwRTRsdCBhYmVyXG4gIC8vIGtlaW5lIGVpZ2VuZSwgdmVybFx1MDBFNHNzbGljaGUgUmVmZXJlbnogZGFyYXVmIGdyaWZmYmVyZWl0IHdpZSBNYXJrZG93blZpZXcgLVxuICAvLyBkYWhlciBhdWYgZGllIHZvbSBXb3Jrc3BhY2UgYWt0dWVsbCBha3RpdmUgRGF0ZWkgenVyXHUwMEZDY2tmYWxsZW4uXG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJmaWxlLXByb3BlcnRpZXNcIikpIHtcbiAgICBjb25zdCB2aWV3ID0gbGVhZi52aWV3O1xuICAgIGNvbnN0IGZpbGUgPSB2aWV3Py5maWxlID8/IHBsdWdpbi5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICBjb25zdCB7IHN0YW5kYXJkLCBmbG9hdGluZyB9ID0ga2V5c0ZvckZpbGUocGx1Z2luLCBmaWxlKTtcbiAgICBhcHBseVRvQ29udGFpbmVyKHZpZXc/Lm1ldGFkYXRhRWRpdG9yPy5jb250YWluZXJFbCwgc3RhbmRhcmQsIGZsb2F0aW5nKTtcbiAgfVxuXG4gIC8vIFRZUC1EZXRhaWxhbnNpY2h0IGRlcyBQbHVnaW5zIHNlbGJzdDogZG9ydCB6ZWlndCBqZWRlciBFZGl0b3IgZGlyZWt0IGVpbmVuXG4gIC8vIEZyb250bWF0dGVyLUJsb2NrIChUWVAgYnp3LiBTdWJ0eXApLCBlbnRzcHJpY2h0IGFsc28gMToxIGRlc3NlblxuICAvLyBcIlN0YW5kYXJkXCItIGJ6dy4gXCJGbG9hdGluZ1wiLVByb3BlcnRpZXMgKHZpZXcuZnJvbnRtYXR0ZXJFZGl0b3JzIGtvbW10IGF1c1xuICAvLyB0eXAtdmlldy5qcywgZWRpdG9yLm93bmVyLmZyZWRTdG9yZSBhdXMgdHlwZS1mcm9udG1hdHRlci1lZGl0b3IuanMpLlxuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFRZUF9WSUVXX1RZUEUpKSB7XG4gICAgZm9yIChjb25zdCBlZGl0b3Igb2YgbGVhZi52aWV3Py5mcm9udG1hdHRlckVkaXRvcnMgPz8gW10pIHtcbiAgICAgIGNvbnN0IHsgc3RhbmRhcmQsIGZsb2F0aW5nIH0gPSBrZXlzRm9yU3RvcmUocGx1Z2luLCBlZGl0b3Iub3duZXI/LmZyZWRTdG9yZSk7XG4gICAgICBhcHBseVRvQ29udGFpbmVyKGVkaXRvci5jb250YWluZXJFbCwgc3RhbmRhcmQsIGZsb2F0aW5nKTtcbiAgICB9XG4gIH1cblxuICBhcHBseVRvQWxsUHJvcGVydGllc1ZpZXcocGx1Z2luKTtcbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseUZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodChwbHVnaW4pO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAubWV0YWRhdGFDYWNoZS5vbihcImNoYW5nZWRcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLm1ldGFkYXRhQ2FjaGUub24oXCJyZXNvbHZlZFwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwiYWN0aXZlLWxlYWYtY2hhbmdlXCIsIHJlZnJlc2gpKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KHJlZnJlc2gpO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQgfTtcbiIsICJjb25zdCB7IE5vdGljZSB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyB0eXBlU3RvcmUsIHN1YnR5cGVTdG9yZSB9ID0gcmVxdWlyZShcIi4vdHlwZS1mcm9udG1hdHRlci1lZGl0b3JcIik7XG5jb25zdCB7IGdldFN1YnR5cGVOYW1lcyB9ID0gcmVxdWlyZShcIi4vc3VidHlwZXNcIik7XG5cbmNvbnN0IFRZUF9QUk9QRVJUWSA9IFwiVFlQXCI7XG5jb25zdCBTVUJUWVBfUFJPUEVSVFkgPSBcIlNVQlRZUFwiO1xuXG4vLyBPYnNpZGlhbiBzY2hyZWlidCBQcm9wZXJ0eS1OYW1lbiBpbnRlcm4ga2xlaW4gKHNpZWhlIGZyb250bWF0dGVyLWRlZmF1bHQtXG4vLyBoaWdobGlnaHQuanMpIC0gWnVvcmRudW5nIGRhaGVyIGNhc2UtaW5zZW5zaXRpdiwgZGVyIG5ldWUgTmFtZSB3aXJkIGFiZXJcbi8vIGV4YWt0IHNvIFx1MDBGQ2Jlcm5vbW1lbiwgd2llIGVyIGVpbmdlZ2ViZW4gd3VyZGUuXG5mdW5jdGlvbiBzYW1lS2V5KGEsIGIpIHtcbiAgcmV0dXJuIGEudG9Mb3dlckNhc2UoKSA9PT0gYi50b0xvd2VyQ2FzZSgpO1xufVxuXG5mdW5jdGlvbiBpc0VtcHR5VmFsdWUodmFsdWUpIHtcbiAgcmV0dXJuIHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IFwiXCI7XG59XG5cbi8vIEJlbmVubnQgb2xkS2V5IGluIGVpbmVtIEZyb250bWF0dGVyLUJsb2NrIChUWVAgb2RlciBTdWJ0eXAsIHNpZWhlXG4vLyB0eXBlU3RvcmUvc3VidHlwZVN0b3JlIGluIHR5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKSB1bSAoUmVpaGVuZm9sZ2UgYmxlaWJ0XG4vLyBlcmhhbHRlbikgdW5kIHppZWh0IGRpZSBGbG9hdGluZy1NYXJraWVydW5nIG1pdC4gR2lidCBlcyBuZXdLZXkgZG9ydCBiZXJlaXRzXG4vLyAoWnVzYW1tZW5sZWdlbiwgYW5hbG9nIHp1IE9ic2lkaWFucyBlaWdlbmVtIE1lcmdlIGluIGRlbiBOb3RpemVuKSwgYmxlaWJ0IGRlclxuLy8gYmVzdGVoZW5kZSBFaW50cmFnIGFuIHNlaW5lciBQb3NpdGlvbiAtIGRlciBXZXJ0IGRlcyBhbHRlbiBFaW50cmFncyB3aXJkIG51clxuLy8gXHUwMEZDYmVybm9tbWVuLCB3ZW5uIGRlciBiZXN0ZWhlbmRlIGxlZXIgaXN0LiBMaWVmZXJ0IHRydWUgYmVpIGVpbmVyIFx1MDBDNG5kZXJ1bmcuXG5mdW5jdGlvbiByZW5hbWVJblN0b3JlKHN0b3JlLCBvbGRLZXksIG5ld0tleSkge1xuICBjb25zdCBkZWZhdWx0cyA9IHN0b3JlLmdldEZyb250bWF0dGVyKCk7XG4gIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyhkZWZhdWx0cyk7XG4gIGNvbnN0IHNvdXJjZUtleSA9IGtleXMuZmluZCgoa2V5KSA9PiBzYW1lS2V5KGtleSwgb2xkS2V5KSk7XG4gIGlmIChzb3VyY2VLZXkgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZhbHNlO1xuICAvLyBCZWkgZWluZXIgcmVpbmVuIFx1MDBDNG5kZXJ1bmcgZGVyIEdyb1x1MDBERi0vS2xlaW5zY2hyZWlidW5nIGlzdCBzb3VyY2VLZXkgc2VsYnN0XG4gIC8vIGRlciBlaW56aWdlIFRyZWZmZXIgZlx1MDBGQ3IgbmV3S2V5IC0gZGFzIGlzdCBkYW5uIGtlaW4gWnVzYW1tZW5sZWdlbi5cbiAgY29uc3QgdGFyZ2V0S2V5ID0ga2V5cy5maW5kKChrZXkpID0+IGtleSAhPT0gc291cmNlS2V5ICYmIHNhbWVLZXkoa2V5LCBuZXdLZXkpKTtcbiAgaWYgKHRhcmdldEtleSA9PT0gdW5kZWZpbmVkICYmIHNvdXJjZUtleSA9PT0gbmV3S2V5KSByZXR1cm4gZmFsc2U7XG5cbiAgY29uc3QgbmV4dCA9IHt9O1xuICBmb3IgKGNvbnN0IGtleSBvZiBrZXlzKSB7XG4gICAgaWYgKGtleSAhPT0gc291cmNlS2V5KSB7XG4gICAgICBuZXh0W2tleV0gPSBkZWZhdWx0c1trZXldO1xuICAgIH0gZWxzZSBpZiAodGFyZ2V0S2V5ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIG5leHRbbmV3S2V5XSA9IGRlZmF1bHRzW3NvdXJjZUtleV07XG4gICAgfVxuICB9XG4gIGlmICh0YXJnZXRLZXkgIT09IHVuZGVmaW5lZCAmJiBpc0VtcHR5VmFsdWUobmV4dFt0YXJnZXRLZXldKSkgbmV4dFt0YXJnZXRLZXldID0gZGVmYXVsdHNbc291cmNlS2V5XTtcbiAgc3RvcmUuc2V0RnJvbnRtYXR0ZXIobmV4dCk7XG5cbiAgY29uc3QgZmxvYXRpbmcgPSBzdG9yZS5nZXRGbG9hdGluZygpO1xuICBpZiAoZmxvYXRpbmcubGVuZ3RoID4gMCkge1xuICAgIC8vIEJlaW0gWnVzYW1tZW5sZWdlbiBibGVpYnQgZGllIEZsb2F0aW5nLU1hcmtpZXJ1bmcgZGVzIFppZWxzIG1hXHUwMERGZ2VibGljaC5cbiAgICBzdG9yZS5zZXRGbG9hdGluZyhcbiAgICAgIHRhcmdldEtleSAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8gZmxvYXRpbmcuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gc291cmNlS2V5KVxuICAgICAgICA6IGZsb2F0aW5nLm1hcCgoa2V5KSA9PiAoa2V5ID09PSBzb3VyY2VLZXkgPyBuZXdLZXkgOiBrZXkpKVxuICAgICk7XG4gIH1cbiAgcmV0dXJuIHRydWU7XG59XG5cbi8vIEVudGZlcm50IG9sZEtleSBzYW10IEZsb2F0aW5nLU1hcmtpZXJ1bmcgYXVzIHN0b3JlIChlaW4gYW5kZXJlciBCbG9ja1xuLy8gZGVzc2VsYmVuIFRZUHMpLCB3ZWlsIG93bmVyIG5ld0tleSBiZXJlaXRzIGZcdTAwRkNocnQgLSBkZXNzZW4gbGVlcmVyIFdlcnRcbi8vIFx1MDBGQ2Jlcm5pbW10IGRhYmVpIGRlbiBhbHRlbi4gTGllZmVydCB0cnVlIGJlaSBlaW5lciBcdTAwQzRuZGVydW5nLlxuZnVuY3Rpb24gbW92ZUludG9Pd25lcihzdG9yZSwgb3duZXIsIG9sZEtleSwgbmV3S2V5KSB7XG4gIGNvbnN0IGRlZmF1bHRzID0gc3RvcmUuZ2V0RnJvbnRtYXR0ZXIoKTtcbiAgY29uc3Qgc291cmNlS2V5ID0gT2JqZWN0LmtleXMoZGVmYXVsdHMpLmZpbmQoKGtleSkgPT4gc2FtZUtleShrZXksIG9sZEtleSkpO1xuICBpZiAoc291cmNlS2V5ID09PSB1bmRlZmluZWQpIHJldHVybiBmYWxzZTtcblxuICBjb25zdCBuZXh0ID0geyAuLi5kZWZhdWx0cyB9O1xuICBkZWxldGUgbmV4dFtzb3VyY2VLZXldO1xuICBzdG9yZS5zZXRGcm9udG1hdHRlcihuZXh0KTtcbiAgc3RvcmUuc2V0RmxvYXRpbmcoc3RvcmUuZ2V0RmxvYXRpbmcoKS5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBzb3VyY2VLZXkpKTtcblxuICBjb25zdCBvd25lckRlZmF1bHRzID0gb3duZXIuZ2V0RnJvbnRtYXR0ZXIoKTtcbiAgY29uc3QgdGFyZ2V0S2V5ID0gT2JqZWN0LmtleXMob3duZXJEZWZhdWx0cykuZmluZCgoa2V5KSA9PiBzYW1lS2V5KGtleSwgbmV3S2V5KSk7XG4gIGlmIChpc0VtcHR5VmFsdWUob3duZXJEZWZhdWx0c1t0YXJnZXRLZXldKSAmJiAhaXNFbXB0eVZhbHVlKGRlZmF1bHRzW3NvdXJjZUtleV0pKSB7XG4gICAgb3duZXIuc2V0RnJvbnRtYXR0ZXIoeyAuLi5vd25lckRlZmF1bHRzLCBbdGFyZ2V0S2V5XTogZGVmYXVsdHNbc291cmNlS2V5XSB9KTtcbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn1cblxuLy8gRWluemVsLVByb3BlcnR5LUVpbnRyXHUwMEU0Z2UgZGVyIGdsb2JhbGVuIFJlaWhlbmZvbGdlIC0gZG9ydCBzaW5kIGtlaW5lXG4vLyBEb3BwbHVuZ2VuIGVybGF1YnQsIGVpbiBiZXJlaXRzIHZvcmhhbmRlbmVyIFppZWxlaW50cmFnIGJlaFx1MDBFNGx0IGRhaGVyIHNlaW5lXG4vLyBQb3NpdGlvbiB1bmQgZGVyIGFsdGUgZW50Zlx1MDBFNGxsdC5cbmZ1bmN0aW9uIHJlbmFtZUluR2xvYmFsT3JkZXIoc2V0dGluZ3MsIG9sZEtleSwgbmV3S2V5KSB7XG4gIGNvbnN0IG9yZGVyID0gc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcjtcbiAgY29uc3Qgc291cmNlID0gb3JkZXIuZmluZCgoZW50cnkpID0+IGVudHJ5LmtpbmQgPT09IFwicHJvcGVydHlcIiAmJiBzYW1lS2V5KGVudHJ5Lm5hbWUsIG9sZEtleSkpO1xuICBpZiAoIXNvdXJjZSkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCB0YXJnZXQgPSBvcmRlci5maW5kKChlbnRyeSkgPT4gZW50cnkgIT09IHNvdXJjZSAmJiBlbnRyeS5raW5kID09PSBcInByb3BlcnR5XCIgJiYgc2FtZUtleShlbnRyeS5uYW1lLCBuZXdLZXkpKTtcbiAgaWYgKHRhcmdldCkgc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlciA9IG9yZGVyLmZpbHRlcigoZW50cnkpID0+IGVudHJ5ICE9PSBzb3VyY2UpO1xuICBlbHNlIGlmIChzb3VyY2UubmFtZSA9PT0gbmV3S2V5KSByZXR1cm4gZmFsc2U7XG4gIGVsc2Ugc291cmNlLm5hbWUgPSBuZXdLZXk7XG4gIHJldHVybiB0cnVlO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzeW5jUmVuYW1lKHBsdWdpbiwgb2xkS2V5LCBuZXdLZXkpIHtcbiAgaWYgKHR5cGVvZiBvbGRLZXkgIT09IFwic3RyaW5nXCIgfHwgdHlwZW9mIG5ld0tleSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuO1xuICBuZXdLZXkgPSBuZXdLZXkudHJpbSgpO1xuICBpZiAob2xkS2V5ID09PSBcIlwiIHx8IG5ld0tleSA9PT0gXCJcIiB8fCBvbGRLZXkgPT09IG5ld0tleSkgcmV0dXJuO1xuICAvLyBUWVAvU1VCVFlQIHNpbmQgbmllIFRlaWwgZWluZXMgRnJvbnRtYXR0ZXItQmxvY2tzIChzaWVoZSBzdHJpcFR5cFByb3BlcnR5XG4gIC8vIGluIHR5cGUtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKSAtIGVpbiBVbWJlbmVubmVuIHZvbi9uYWNoIFRZUC9TVUJUWVAgZGFoZXJcbiAgLy8gaWdub3JpZXJlbi5cbiAgaWYgKFtvbGRLZXksIG5ld0tleV0uc29tZSgoa2V5KSA9PiBzYW1lS2V5KGtleSwgVFlQX1BST1BFUlRZKSB8fCBzYW1lS2V5KGtleSwgU1VCVFlQX1BST1BFUlRZKSkpIHJldHVybjtcblxuICBjb25zdCB7IHNldHRpbmdzIH0gPSBwbHVnaW47XG4gIGxldCB0eXBlQ291bnQgPSAwO1xuICBsZXQgc3VidHlwZUNvdW50ID0gMDtcbiAgY29uc3QgY291bnQgPSAoc3RvcmUpID0+IChzdG9yZS5zdWJ0eXBlID8gc3VidHlwZUNvdW50KysgOiB0eXBlQ291bnQrKyk7XG4gIGNvbnN0IHR5cGVzID0gbmV3IFNldChbLi4uT2JqZWN0LmtleXMoc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlciksIC4uLk9iamVjdC5rZXlzKHNldHRpbmdzLnR5cGVTdWJ0eXBlcyA/PyB7fSldKTtcbiAgZm9yIChjb25zdCB0eXBlIG9mIHR5cGVzKSB7XG4gICAgY29uc3Qgc3RvcmVzID0gW3R5cGVTdG9yZShwbHVnaW4sIHR5cGUpLCAuLi5nZXRTdWJ0eXBlTmFtZXMoc2V0dGluZ3MsIHR5cGUpLm1hcCgoc3VidHlwZSkgPT4gc3VidHlwZVN0b3JlKHBsdWdpbiwgdHlwZSwgc3VidHlwZSkpXTtcblxuICAgIC8vIEplZGVyIEtleSBnZWhcdTAwRjZydCB6dSBnZW5hdSBlaW5lbSBCbG9jayBlaW5lcyBUWVBzIChzaWVoZVxuICAgIC8vIGVuZm9yY2VVbmlxdWVLZXlzIGluIHN1YnR5cGVzLmpzKTogZ2lidCBlcyBuZXdLZXkgc2Nob24gaW4gZWluZW0gQmxvY2ssXG4gICAgLy8gYmVoXHUwMEU0bHQgZGllc2VyIGlobiAtIGF1cyBkZW4gXHUwMEZDYnJpZ2VuIHZlcnNjaHdpbmRldCBvbGRLZXksIHNlaW4gV2VydCB3aXJkXG4gICAgLy8gbnVyIFx1MDBGQ2Jlcm5vbW1lbiwgd2VubiBkZXIgYmVzdGVoZW5kZSBFaW50cmFnIGxlZXIgaXN0LiBCZWkgZWluZXIgcmVpbmVuXG4gICAgLy8gXHUwMEM0bmRlcnVuZyBkZXIgR3JvXHUwMERGLS9LbGVpbnNjaHJlaWJ1bmcgaXN0IGRhcyBuaWUgZGVyIEZhbGwuXG4gICAgY29uc3Qgb3duZXIgPSBzYW1lS2V5KG9sZEtleSwgbmV3S2V5KVxuICAgICAgPyBudWxsXG4gICAgICA6IHN0b3Jlcy5maW5kKChzdG9yZSkgPT4gT2JqZWN0LmtleXMoc3RvcmUuZ2V0RnJvbnRtYXR0ZXIoKSkuc29tZSgoa2V5KSA9PiBzYW1lS2V5KGtleSwgbmV3S2V5KSkpO1xuICAgIGZvciAoY29uc3Qgc3RvcmUgb2Ygc3RvcmVzKSB7XG4gICAgICBpZiAoIW93bmVyIHx8IHN0b3JlID09PSBvd25lcikge1xuICAgICAgICBpZiAocmVuYW1lSW5TdG9yZShzdG9yZSwgb2xkS2V5LCBuZXdLZXkpKSBjb3VudChzdG9yZSk7XG4gICAgICB9IGVsc2UgaWYgKG1vdmVJbnRvT3duZXIoc3RvcmUsIG93bmVyLCBvbGRLZXksIG5ld0tleSkpIHtcbiAgICAgICAgY291bnQoc3RvcmUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICBjb25zdCBvcmRlckNoYW5nZWQgPSByZW5hbWVJbkdsb2JhbE9yZGVyKHNldHRpbmdzLCBvbGRLZXksIG5ld0tleSk7XG4gIGlmICh0eXBlQ291bnQgPT09IDAgJiYgc3VidHlwZUNvdW50ID09PSAwICYmICFvcmRlckNoYW5nZWQpIHJldHVybjtcblxuICBhd2FpdCBwbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gIHBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcblxuICBjb25zdCBwYXJ0cyA9IFtdO1xuICBpZiAodHlwZUNvdW50ID4gMCkgcGFydHMucHVzaChgJHt0eXBlQ291bnR9IFRZUCR7dHlwZUNvdW50ID09PSAxID8gXCJcIiA6IFwiZW5cIn1gKTtcbiAgaWYgKHN1YnR5cGVDb3VudCA+IDApIHBhcnRzLnB1c2goYCR7c3VidHlwZUNvdW50fSBTdWJ0eXAke3N1YnR5cGVDb3VudCA9PT0gMSA/IFwiXCIgOiBcImVuXCJ9YCk7XG4gIGlmIChvcmRlckNoYW5nZWQpIHBhcnRzLnB1c2goXCJnbG9iYWxlciBSZWloZW5mb2xnZVwiKTtcbiAgbmV3IE5vdGljZShgVFlQLVN5c3RlbTogXHUyMDFFJHtvbGRLZXl9XHUyMDFDIFx1MjE5MiBcdTIwMUUke25ld0tleX1cdTIwMUMgaW4gJHtwYXJ0cy5qb2luKFwiIHVuZCBcIil9IHVtYmVuYW5udC5gKTtcbn1cblxuLy8gT2JzaWRpYW5zIFwiQWxsIHByb3BlcnRpZXNcIi1BbnNpY2h0IChhY2NlcHRSZW5hbWUpIHVuZCBCYXNlcyAoTmFtZW5zZmVsZCBlaW5lclxuLy8gbmV1IGFuZ2VsZWd0ZW4gTm90aXotUHJvcGVydHkpIGJlbmVubmVuIFByb3BlcnRpZXMgdmF1bHQtd2VpdCBhdXNzY2hsaWVcdTAwREZsaWNoXG4vLyBcdTAwRkNiZXIgYXBwLmZpbGVNYW5hZ2VyLnJlbmFtZVByb3BlcnR5KGFsdCwgbmV1KSB1bSAoc2llaGUgZ2ViYXV0ZXMgYXBwLmpzKSAtXG4vLyBlaW4gV3JhcHBlciBnZW5hdSBkb3J0IGVyZmFzc3QgYWxzbyBqZWRlIGVjaHRlIFVtYmVuZW5udW5nLCBvaG5lIGRpZVxuLy8gamV3ZWlsaWdlbiBWaWV3cyBzZWxic3QgYW5mYXNzZW4genUgbVx1MDBGQ3NzZW4uIEJhc2VzJyBcIkRpc3BsYXkgbmFtZVwiIGZcdTAwRkNyXG4vLyBiZXN0ZWhlbmRlIFByb3BlcnRpZXMgXHUwMEU0bmRlcnQgbnVyIGRpZSAuYmFzZS1EYXRlaSwgbmljaHQgZGllIE5vdGl6ZW4sIHVuZFxuLy8gbFx1MDBFNHVmdCBkZXNoYWxiIChyaWNodGlnZXJ3ZWlzZSkgbmljaHQgaGllciBkdXJjaC5cbmZ1bmN0aW9uIHJlZ2lzdGVyUHJvcGVydHlSZW5hbWVTeW5jKHBsdWdpbikge1xuICBjb25zdCBmaWxlTWFuYWdlciA9IHBsdWdpbi5hcHAuZmlsZU1hbmFnZXI7XG4gIGlmIChmaWxlTWFuYWdlci5fX2ZyZWRUeXBSZW5hbWVTeW5jUGF0Y2hlZCkgcmV0dXJuO1xuICBmaWxlTWFuYWdlci5fX2ZyZWRUeXBSZW5hbWVTeW5jUGF0Y2hlZCA9IHRydWU7XG5cbiAgY29uc3Qgb3JpZ2luYWwgPSBmaWxlTWFuYWdlci5yZW5hbWVQcm9wZXJ0eTtcbiAgZmlsZU1hbmFnZXIucmVuYW1lUHJvcGVydHkgPSBhc3luYyBmdW5jdGlvbiAob2xkS2V5LCBuZXdLZXksIC4uLnJlc3QpIHtcbiAgICAvLyBXaXJmdCBkYXMgT3JpZ2luYWwgKGFjY2VwdFJlbmFtZSBmXHUwMEU0bmd0IGRhcyBzZWxic3QgYWIpLCBibGVpYmVuIGRpZVxuICAgIC8vIFBsdWdpbi1FaW5zdGVsbHVuZ2VuIHVudmVyXHUwMEU0bmRlcnQuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgb3JpZ2luYWwuY2FsbCh0aGlzLCBvbGRLZXksIG5ld0tleSwgLi4ucmVzdCk7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHN5bmNSZW5hbWUocGx1Z2luLCBvbGRLZXksIG5ld0tleSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJUWVAtU3lzdGVtOiBQcm9wZXJ0eS1VbWJlbmVubnVuZyBuaWNodCBcdTAwRkNiZXJub21tZW5cIiwgZXJyb3IpO1xuICAgICAgbmV3IE5vdGljZShgVFlQLVN5c3RlbTogVW1iZW5lbm51bmcgdm9uIFx1MjAxRSR7b2xkS2V5fVx1MjAxQyBuaWNodCBcdTAwRkNiZXJub21tZW4gXHUyMDEzICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfTtcblxuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4ge1xuICAgIGZpbGVNYW5hZ2VyLnJlbmFtZVByb3BlcnR5ID0gb3JpZ2luYWw7XG4gICAgZGVsZXRlIGZpbGVNYW5hZ2VyLl9fZnJlZFR5cFJlbmFtZVN5bmNQYXRjaGVkO1xuICB9KTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyUHJvcGVydHlSZW5hbWVTeW5jIH07XG4iLCAiY29uc3QgeyBGdXp6eVN1Z2dlc3RNb2RhbCwgTm90aWNlLCBwcmVwYXJlRnV6enlTZWFyY2ggfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgREVGQVVMVF9UWVBFX0NPTE9SLCBjb21wYXJlVHlwZXMsIERFRkFVTFRfU09SVF9PUkRFUiB9ID0gcmVxdWlyZShcIi4vdHlwLXZpZXdcIik7XG5cbi8vIE5hdGl2ZXIgRXJzYXR6IGZcdTAwRkNyIFRlbXBsYXRlcnMgdHAuc3lzdGVtLnN1Z2dlc3RlciBiZWkgZGVyIFRZUC1BdXN3YWhsIChzaWVoZVxuLy8gX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qcyk6IGJhdXQgYXVmIE9ic2lkaWFucyBlaWdlbmVtXG4vLyBGdXp6eVN1Z2dlc3RNb2RhbCBhdWYgKGRpZXNlbGJlIEJhc2lzLCBhdWYgZGVyIGF1Y2ggVGVtcGxhdGVycyBTdWdnZXN0ZXJcbi8vIHNlbGJzdCBiZXJ1aHQpLCB6ZWlndCB6dXNcdTAwRTR0emxpY2ggYWJlciBUWVAtRmFyYmUvLVB1bmt0LCBCZXNjaHJlaWJ1bmcgdW5kXG4vLyBOb3Rpei1BbnphaGwgamUgWmVpbGUuIE5pY2h0IGVyZmFzc3RlIChpdGVtLnVucmVnaXN0ZXJlZCkgVFlQZW4gd2VyZGVuIHN0YXR0XG4vLyBpbiBpaHJlciAobmljaHQgZXhpc3RpZXJlbmRlbikgRmFyYmUgbXV0ZWQgZGFyZ2VzdGVsbHQsIGFuYWxvZyB6dXJcbi8vIFRZUC1MaXN0ZSBzZWxic3QgKHNpZWhlIC5mcmVkLXR5cC11bnJlZ2lzdGVyZWQgaW4gdHlwLXZpZXcuanMpLlxuY2xhc3MgVHlwUGlja2VyTW9kYWwgZXh0ZW5kcyBGdXp6eVN1Z2dlc3RNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKGFwcCwgcGx1Z2luLCBpdGVtcywgcmVzb2x2ZSkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gICAgdGhpcy5pdGVtcyA9IGl0ZW1zO1xuICAgIHRoaXMucmVzb2x2ZSA9IHJlc29sdmU7XG4gICAgdGhpcy5jaG9zZW4gPSBmYWxzZTtcbiAgICB0aGlzLnNldFBsYWNlaG9sZGVyKFwiRVNDIGZcdTAwRkNyIEFiYnJ1Y2hcIik7XG4gIH1cblxuICBnZXRJdGVtcygpIHtcbiAgICByZXR1cm4gdGhpcy5pdGVtcztcbiAgfVxuXG4gIC8vIEZ1enp5LVN1Y2hlIGdyZWlmdCBhdWNoIGF1ZiBkaWUgQmVzY2hyZWlidW5nLCBuaWNodCBudXIgYXVmIGRlbiBUWVAtTmFtZW4uXG4gIGdldEl0ZW1UZXh0KGl0ZW0pIHtcbiAgICByZXR1cm4gaXRlbS5kZXNjcmlwdGlvbiA/IGAke2l0ZW0udHlwZX0gJHtpdGVtLmRlc2NyaXB0aW9ufWAgOiBpdGVtLnR5cGU7XG4gIH1cblxuICByZW5kZXJTdWdnZXN0aW9uKG1hdGNoLCBlbCkge1xuICAgIGNvbnN0IGl0ZW0gPSBtYXRjaC5pdGVtO1xuICAgIGVsLmFkZENsYXNzKFwiZnJlZC10eXAtcGlja2VyLXN1Z2dlc3Rpb25cIik7XG4gICAgaWYgKGl0ZW0udW5yZWdpc3RlcmVkKSBlbC5hZGRDbGFzcyhcImZyZWQtdHlwLXBpY2tlci11bnJlZ2lzdGVyZWRcIik7XG5cbiAgICBpZiAoaXRlbS51bnJlZ2lzdGVyZWQpIHtcbiAgICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtcGlja2VyLW5hbWVcIiwgdGV4dDogaXRlbS50eXBlIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnJlbmRlckNvbG9yZWROYW1lKGVsLCBpdGVtLnR5cGUsIGl0ZW0udHlwZSk7XG4gICAgfVxuXG4gICAgaWYgKGl0ZW0uZGVzY3JpcHRpb24pIHtcbiAgICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZnJlZC10eXAtcGlja2VyLWRlc2NcIiwgdGV4dDogaXRlbS5kZXNjcmlwdGlvbiB9KTtcbiAgICB9XG5cbiAgICBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLXBpY2tlci1jb3VudFwiLCB0ZXh0OiBTdHJpbmcoaXRlbS5jb3VudCkgfSk7XG4gIH1cblxuICAvLyBOYW1lIGluIGRlciBGYXJiZSB2b24gY29sb3JUeXBlIC0gamUgbmFjaCBFaW5zdGVsbHVuZyBcIlRZUCBWaWV3IGVpbmZcdTAwRTRyYmVuXCJcbiAgLy8gYWxzIGVpbmdlZlx1MDBFNHJidGVyIFRleHQgb2RlciBtaXQgdm9yYW5nZXN0ZWxsdGVtIEZhcmJwdW5rdC5cbiAgcmVuZGVyQ29sb3JlZE5hbWUoZWwsIHRleHQsIGNvbG9yVHlwZSkge1xuICAgIGNvbnN0IGNvbG9yID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwZUNvbG9yc1tjb2xvclR5cGVdID8/IERFRkFVTFRfVFlQRV9DT0xPUjtcbiAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0KSB7XG4gICAgICBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLXBpY2tlci1uYW1lXCIsIHRleHQgfSkuc3R5bGUuY29sb3IgPSBjb2xvcjtcbiAgICB9IGVsc2Uge1xuICAgICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1waWNrZXItZG90XCIgfSkuc3R5bGUuYmFja2dyb3VuZENvbG9yID0gY29sb3I7XG4gICAgICBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLXBpY2tlci1uYW1lXCIsIHRleHQgfSk7XG4gICAgfVxuICB9XG5cbiAgLy8gT2JzaWRpYW5zIFN1Z2dlc3RNb2RhbC5zZWxlY3RTdWdnZXN0aW9uKCkgcnVmdCBpbnRlcm4gZXJzdCB0aGlzLmNsb3NlKClcbiAgLy8gYXVmIHVuZCBkYW5hY2ggZXJzdCBvbkNob29zZVN1Z2dlc3Rpb24oKS9vbkNob29zZUl0ZW0oKSAtIFwiY2hvc2VuXCIgaGllciB6dVxuICAvLyBzZXR6ZW4gKHN0YXR0IGluIG9uQ2hvb3NlSXRlbSkgaXN0IGRhaGVyIG5pY2h0IGJsb1x1MDBERiBHZXNjaG1hY2tzc2FjaGU6IHdcdTAwRkNyZGVcbiAgLy8gZXMgZXJzdCBpbiBvbkNob29zZUl0ZW0gZ2VzZXR6dCwgaFx1MDBFNHR0ZSBkYXMgY2xvc2UoKS1hdXNnZWxcdTAwRjZzdGUgb25DbG9zZSgpXG4gIC8vIHVudGVuIFwiY2hvc2VuXCIgbm9jaCBhbHMgZmFsc2UgZ2VzZWhlbiB1bmQgZGFzIFByb21pc2UgZlx1MDBFNGxzY2hsaWNoIHNjaG9uIG1pdFxuICAvLyBudWxsIGF1ZmdlbFx1MDBGNnN0LCBiZXZvciBkZXIgZWlnZW50bGljaGUgb25DaG9vc2VJdGVtLUF1ZnJ1ZiBcdTAwRkNiZXJoYXVwdCBsaWVmIC1cbiAgLy8gZGFzIHp3ZWl0ZSByZXNvbHZlKCkgZ3JlaWZ0IGRhbm4gbmljaHQgbWVociAoZWluIFByb21pc2UgbFx1MDBGNnN0IG51ciBlaW5tYWxcbiAgLy8gYXVmKSwgZGFzIEVyZ2VibmlzIHdhciB1bmFiaFx1MDBFNG5naWcgdm9uIGRlciBBdXN3YWhsIGltbWVyIG51bGwuXG4gIHNlbGVjdFN1Z2dlc3Rpb24oaXRlbSwgZXZ0KSB7XG4gICAgdGhpcy5jaG9zZW4gPSB0cnVlO1xuICAgIHN1cGVyLnNlbGVjdFN1Z2dlc3Rpb24oaXRlbSwgZXZ0KTtcbiAgfVxuXG4gIG9uQ2hvb3NlSXRlbShpdGVtKSB7XG4gICAgdGhpcy5yZXNvbHZlKGl0ZW0udHlwZSk7XG4gIH1cblxuICAvLyBFU0MgKG9kZXIgS2xpY2sgZGFuZWJlbikgc2NobGllXHUwMERGdCBkYXMgTW9kYWwgb2huZSBzZWxlY3RTdWdnZXN0aW9uIC0gZGFublxuICAvLyBzdGF0dCBlaW5lcyBoXHUwMEU0bmdlbmRlbiBQcm9taXNlIG1pdCBudWxsIGF1ZmxcdTAwRjZzZW4sIGFuYWxvZyB6dVxuICAvLyB0cC5zeXN0ZW0uc3VnZ2VzdGVyLlxuICBvbkNsb3NlKCkge1xuICAgIHN1cGVyLm9uQ2xvc2UoKTtcbiAgICBpZiAoIXRoaXMuY2hvc2VuKSB0aGlzLnJlc29sdmUobnVsbCk7XG4gIH1cbn1cblxuLy8gQXVzd2FobCBlaW5lcyBTdWJ0eXBzIGZcdTAwRkNyIGVpbmVuIGJlcmVpdHMgZ2V3XHUwMEU0aGx0ZW4gVFlQIChzaWVoZSBwaWNrU3VidHlwZSkuXG4vLyBXaWUgVHlwUGlja2VyTW9kYWwsIHp1c1x1MDBFNHR6bGljaCBtaXQgZWluZW0gYXVzZ2VncmF1dGVuIEVpbnRyYWcgXCJLZWluXG4vLyBTdWJ0eXBcIiBhbSBFbmRlIChpdGVtLm5vbmUpLiBFU0MgbFx1MDBGNnN0IG1pdCBudWxsIGF1ZiAtIFRZUC5qcyBrZWhydCBkYW5uIHp1clxuLy8gVFlQLUF1c3dhaGwgenVyXHUwMEZDY2suIFN1YnR5cGVuIGhhYmVuIGtlaW5lIGVpZ2VuZSBGYXJiZSBvZGVyIEJlc2NocmVpYnVuZyxcbi8vIGRlciBOYW1lIHN0ZWh0IGRhaGVyIG5ldXRyYWwgbWl0IE5vdGl6LUFuemFobC5cbmNsYXNzIFN1YnR5cFBpY2tlck1vZGFsIGV4dGVuZHMgVHlwUGlja2VyTW9kYWwge1xuICBjb25zdHJ1Y3RvcihhcHAsIHBsdWdpbiwgdHlwZSwgaXRlbXMsIHJlc29sdmUpIHtcbiAgICBzdXBlcihhcHAsIHBsdWdpbiwgaXRlbXMsIHJlc29sdmUpO1xuICAgIHRoaXMuc2V0UGxhY2Vob2xkZXIoYFN1YnR5cCBmXHUwMEZDciAke3R5cGV9IFx1MjAxMyBFU0MgZlx1MDBGQ3IgenVyXHUwMEZDY2tgKTtcbiAgfVxuXG4gIHJlbmRlclN1Z2dlc3Rpb24obWF0Y2gsIGVsKSB7XG4gICAgY29uc3QgaXRlbSA9IG1hdGNoLml0ZW07XG4gICAgZWwuYWRkQ2xhc3MoXCJmcmVkLXR5cC1waWNrZXItc3VnZ2VzdGlvblwiKTtcbiAgICBpZiAoaXRlbS5ub25lKSBlbC5hZGRDbGFzcyhcImZyZWQtdHlwLXBpY2tlci11bnJlZ2lzdGVyZWRcIik7XG4gICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1waWNrZXItbmFtZVwiLCB0ZXh0OiBpdGVtLnR5cGUgfSk7XG4gICAgZWwuY3JlYXRlU3Bhbih7IGNsczogXCJmcmVkLXR5cC1waWNrZXItY291bnRcIiwgdGV4dDogU3RyaW5nKGl0ZW0uY291bnQpIH0pO1xuICB9XG5cbiAgb25DaG9vc2VJdGVtKGl0ZW0pIHtcbiAgICB0aGlzLnJlc29sdmUoaXRlbS5ub25lID8gXCJcIiA6IGl0ZW0udHlwZSk7XG4gIH1cbn1cblxuLy8gVFlQLVBpY2tlciBtaXQgZGVuIFN1YnR5cGVuIGRpcmVrdCBlaW5nZXJcdTAwRkNja3QgdW50ZXIgaWhyZW0gVFlQIChTdGFuZGFyZCxcbi8vIHNvbGFuZ2UgXCJTdWJ0eXAtUGlja2VyIHNlcGFyYXRcIiBpbiBkZW4gRWluc3RlbGx1bmdlbiBhdXMgaXN0LCBzaWVoZVxuLy8gcGlja1R5cGVBbmRTdWJ0eXBlKS4gRGllIFRZUC1aZWlsZSBzZWxic3Qgc3RlaHQgZlx1MDBGQ3IgXCJUWVAgb2huZSBTdWJ0eXBcIi5cbi8vIEdlc3VjaHQgd2lyZCBncnVwcGVud2Vpc2Ugc3RhdHQgamUgWmVpbGUsIGRhbWl0IGVpbiBTdWJ0eXAgbmllIG9obmUgc2VpbmVuXG4vLyBUWVAgZGFyXHUwMEZDYmVyIGVyc2NoZWludDogcGFzc3QgZGllIFN1Y2hlIGF1ZiBkZW4gVFlQLCBibGVpYmVuIGFsbGUgc2VpbmVcbi8vIFN1YnR5cGVuIHN0ZWhlbjsgcGFzc3Qgc2llIG51ciBhdWYgZWluemVsbmUgU3VidHlwZW4sIGJsZWliZW4gZGllc2Ugc2FtdFxuLy8gaWhyZW0gVFlQIHN0ZWhlbi4gRGllIEdydXBwZW4gc29ydGllcmVuIHNpY2ggbmFjaCBpaHJlbSBiZXN0ZW4gVHJlZmZlcixcbi8vIGlubmVyaGFsYiBlaW5lciBHcnVwcGUgYmxlaWJ0IGRpZSBCbG9jay1SZWloZW5mb2xnZS5cbmNsYXNzIFR5cFN1YnR5cFBpY2tlck1vZGFsIGV4dGVuZHMgVHlwUGlja2VyTW9kYWwge1xuICBjb25zdHJ1Y3RvcihhcHAsIHBsdWdpbiwgZ3JvdXBzLCByZXNvbHZlKSB7XG4gICAgc3VwZXIoYXBwLCBwbHVnaW4sIGdyb3Vwcy5tYXAoKGdyb3VwKSA9PiBncm91cC5pdGVtKSwgcmVzb2x2ZSk7XG4gICAgdGhpcy5ncm91cHMgPSBncm91cHM7XG4gIH1cblxuICBnZXRTdWdnZXN0aW9ucyhxdWVyeSkge1xuICAgIGNvbnN0IHNlYXJjaCA9IHF1ZXJ5LnRyaW0oKSA/IHByZXBhcmVGdXp6eVNlYXJjaChxdWVyeS50cmltKCkpIDogbnVsbDtcbiAgICBjb25zdCBub01hdGNoID0geyBzY29yZTogMCwgbWF0Y2hlczogW10gfTtcbiAgICBjb25zdCByZXN1bHRzID0gW107XG4gICAgZm9yIChjb25zdCB7IGl0ZW0sIHN1YnR5cGVzIH0gb2YgdGhpcy5ncm91cHMpIHtcbiAgICAgIGNvbnN0IHR5cGVNYXRjaCA9IHNlYXJjaCA/IHNlYXJjaCh0aGlzLmdldEl0ZW1UZXh0KGl0ZW0pKSA6IG5vTWF0Y2g7XG4gICAgICBsZXQgc3VidHlwZU1hdGNoZXMgPSBzdWJ0eXBlcy5tYXAoKHN1YnR5cGUpID0+ICh7IGl0ZW06IHN1YnR5cGUsIG1hdGNoOiBzZWFyY2ggPyBzZWFyY2goc3VidHlwZS5zdWJ0eXBlKSA6IG5vTWF0Y2ggfSkpO1xuICAgICAgaWYgKCF0eXBlTWF0Y2gpIHN1YnR5cGVNYXRjaGVzID0gc3VidHlwZU1hdGNoZXMuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkubWF0Y2gpO1xuICAgICAgaWYgKCF0eXBlTWF0Y2ggJiYgc3VidHlwZU1hdGNoZXMubGVuZ3RoID09PSAwKSBjb250aW51ZTtcblxuICAgICAgY29uc3Qgc2NvcmVzID0gW3R5cGVNYXRjaCwgLi4uc3VidHlwZU1hdGNoZXMubWFwKChlbnRyeSkgPT4gZW50cnkubWF0Y2gpXS5maWx0ZXIoQm9vbGVhbikubWFwKChtYXRjaCkgPT4gbWF0Y2guc2NvcmUpO1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc2NvcmU6IE1hdGgubWF4KC4uLnNjb3JlcyksXG4gICAgICAgIHJvd3M6IFt7IGl0ZW0sIG1hdGNoOiB0eXBlTWF0Y2ggPz8gbm9NYXRjaCB9LCAuLi5zdWJ0eXBlTWF0Y2hlcy5tYXAoKGVudHJ5KSA9PiAoeyBpdGVtOiBlbnRyeS5pdGVtLCBtYXRjaDogZW50cnkubWF0Y2ggPz8gbm9NYXRjaCB9KSldLFxuICAgICAgfSk7XG4gICAgfVxuICAgIGlmIChzZWFyY2gpIHJlc3VsdHMuc29ydCgoYSwgYikgPT4gYi5zY29yZSAtIGEuc2NvcmUpO1xuICAgIHJldHVybiByZXN1bHRzLmZsYXRNYXAoKGdyb3VwKSA9PiBncm91cC5yb3dzKTtcbiAgfVxuXG4gIHJlbmRlclN1Z2dlc3Rpb24obWF0Y2gsIGVsKSB7XG4gICAgY29uc3QgaXRlbSA9IG1hdGNoLml0ZW07XG4gICAgaWYgKCFpdGVtLnN1YnR5cGUpIHtcbiAgICAgIHN1cGVyLnJlbmRlclN1Z2dlc3Rpb24obWF0Y2gsIGVsKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZWwuYWRkQ2xhc3MoXCJmcmVkLXR5cC1waWNrZXItc3VnZ2VzdGlvblwiLCBcImZyZWQtdHlwLXBpY2tlci1zdWJ0eXBlXCIpO1xuICAgIHRoaXMucmVuZGVyQ29sb3JlZE5hbWUoZWwsIGl0ZW0uc3VidHlwZSwgaXRlbS50eXBlKTtcbiAgICBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcImZyZWQtdHlwLXBpY2tlci1jb3VudFwiLCB0ZXh0OiBTdHJpbmcoaXRlbS5jb3VudCkgfSk7XG4gIH1cblxuICBvbkNob29zZUl0ZW0oaXRlbSkge1xuICAgIHRoaXMucmVzb2x2ZSh7IHR5cGU6IGl0ZW0udHlwZSwgc3VidHlwZTogaXRlbS5zdWJ0eXBlID8/IG51bGwgfSk7XG4gIH1cbn1cblxuLy8gRlx1MDBGQ3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qczogXHUwMEY2ZmZuZXQgZGVuIFN1YnR5cC1QaWNrZXIsIHNvYmFsZFxuLy8gZGVyIFRZUCBtaW5kZXN0ZW5zIGVpbmVuIHJlZ2lzdHJpZXJ0ZW4gU3VidHlwIGhhdCAoaW4gZGVyIFJlaWhlbmZvbGdlIGRlclxuLy8gQmxcdTAwRjZja2UgaW4gZGVyIFRZUC1EZXRhaWxhbnNpY2h0KS4gTFx1MDBGNnN0IGF1ZiBtaXRcbi8vICAtIGRlbSBnZXdcdTAwRTRobHRlbiBTdWJ0eXAsXG4vLyAgLSBcIlwiIGZcdTAwRkNyIFwiS2VpbiBTdWJ0eXBcIiAtIGJ6dy4gc29mb3J0LCBvaG5lIFBpY2tlciwgd2VubiBkZXIgVFlQIGdhciBrZWluZVxuLy8gICAgU3VidHlwZW4gaGF0LFxuLy8gIC0gbnVsbCBiZWkgRVNDIChUWVAuanMga2VocnQgZGFubiB6dXIgVFlQLUF1c3dhaGwgenVyXHUwMEZDY2spLlxuZnVuY3Rpb24gcGlja1N1YnR5cGUoYXBwLCBwbHVnaW4sIHR5cGUpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgY29uc3QgaXRlbXMgPSBwbHVnaW4uZ2V0U3VidHlwZXModHlwZSkubWFwKCh7IHN1YnR5cGUsIGNvdW50IH0pID0+ICh7IHR5cGU6IHN1YnR5cGUsIGRlc2NyaXB0aW9uOiBcIlwiLCBjb3VudCB9KSk7XG4gICAgaWYgKGl0ZW1zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmVzb2x2ZShcIlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3Qgbm9uZUNvdW50ID0gcGx1Z2luLnR5cEluZGV4LnN1YnR5cGVCdWNrZXQodHlwZSkubm9TdWJ0eXBlO1xuICAgIGl0ZW1zLnB1c2goeyB0eXBlOiBcIktlaW4gU3VidHlwXCIsIGRlc2NyaXB0aW9uOiBcIlwiLCBjb3VudDogbm9uZUNvdW50LCBub25lOiB0cnVlIH0pO1xuICAgIG5ldyBTdWJ0eXBQaWNrZXJNb2RhbChhcHAsIHBsdWdpbiwgdHlwZSwgaXRlbXMsIHJlc29sdmUpLm9wZW4oKTtcbiAgfSk7XG59XG5cbi8vIE5pY2h0IGluIHBsdWdpbi5zZXR0aW5ncy50eXBlcyByZWdpc3RyaWVydGUgVFlQZW4sIGRpZSBhYmVyIHRhdHNcdTAwRTRjaGxpY2ggaW5cbi8vIE5vdGl6ZW4gdm9ya29tbWVuIC0gYW5hbG9nIHp1IGRlbiBcInVucmVnaXN0cmllcnRlblwiIFplaWxlbiBkZXIgVFlQLUxpc3RlXG4vLyAoc2llaGUgdW5yZWdpc3RlcmVkUm93cyBpbiB0eXAtdmlldy5qcykuIEtlaW5lIEJlc2NocmVpYnVuZy9GYXJiZSwgZGEgZlx1MDBGQ3Jcbi8vIHNpZSBuaWNodHMgZGVyZ2xlaWNoZW4gZ2VwZmxlZ3QgaXN0LiBMaXN0ZW4gdW5kIFdlcnRlIG1pdCBSYW5kbGVlcnplaWNoZW5cbi8vIChzaWVoZSBpc0NsZWFuS2V5IGluIHR5cC1pbmRleC5qcykgYmxlaWJlbiBhdVx1MDBERmVuIHZvciAtIGRlciBnZXdcdTAwRTRobHRlIFdlcnRcbi8vIHdpcmQgaW4gZWluZSBuZXVlIE5vdGl6IGdlc2NocmllYmVuIHVuZCBzb2xsIGRvcnQga2VpbiBBdWZyXHUwMEU0dW1mYWxsIHNlaW4uXG5mdW5jdGlvbiB1bnJlZ2lzdGVyZWRJdGVtcyhhcHAsIHBsdWdpbikge1xuICBjb25zdCByZWdpc3RlcmVkID0gbmV3IFNldChwbHVnaW4uc2V0dGluZ3MudHlwZXMpO1xuICBjb25zdCB7IGNvdW50cyB9ID0gcGx1Z2luLnR5cEluZGV4LnR5cGVDb3VudHMoKTtcbiAgY29uc3Qgc29ydE9yZGVyID0gcGx1Z2luLnNldHRpbmdzLnR5cFNvcnRPcmRlciA/PyBERUZBVUxUX1NPUlRfT1JERVI7XG4gIHJldHVybiBbLi4uY291bnRzLmtleXMoKV1cbiAgICAuZmlsdGVyKCh0eXBlKSA9PiAhcmVnaXN0ZXJlZC5oYXModHlwZSkgJiYgcGx1Z2luLnR5cEluZGV4LmlzQ2xlYW5LZXkodHlwZSkpXG4gICAgLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVUeXBlcyhzb3J0T3JkZXIsIGEsIGIsIGNvdW50cywgcGx1Z2luLnNldHRpbmdzLnR5cGVDb2xvcnMpKVxuICAgIC5tYXAoKHR5cGUpID0+ICh7IHR5cGUsIGRlc2NyaXB0aW9uOiBcIlwiLCBjb3VudDogY291bnRzLmdldCh0eXBlKSA/PyAwLCB1bnJlZ2lzdGVyZWQ6IHRydWUgfSkpO1xufVxuXG4vLyBGXHUwMEZDciBfb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzIHNvd2llIFx1MDBGQ2JlcmFsbCBzb25zdCBpbSBQbHVnaW4sIHdvXG4vLyBlaW4gZWluemVsbmVyIFRZUCBhdXNnZXdcdTAwRTRobHQgd2VyZGVuIG11c3MuIGluY2x1ZGVNYW51YWxPZmYgd2llIGJlaVxuLy8gcGx1Z2luLmdldFR5cGVzKCk6IFRZUGVuIG1pdCBkZWFrdGl2aWVydGVtIFwiTWFudWVsbGVyIFRZUFwiLVNjaGFsdGVyIHNpbmRcbi8vIHN0YW5kYXJkbVx1MDBFNFx1MDBERmlnIGF1c2dla2xhbW1lcnQuIGluY2x1ZGVVbnJlZ2lzdGVyZWQgZXJnXHUwMEU0bnp0IHp1c1x1MDBFNHR6bGljaCBUWVBlbixcbi8vIGRpZSBpbiBOb3RpemVuIHZvcmtvbW1lbiwgYWJlciBuaWNodCBpbiBkZXIgVFlQLUxpc3RlIHJlZ2lzdHJpZXJ0IHNpbmQgLVxuLy8gbXV0ZWQgZGFyZ2VzdGVsbHQsIGRhIGZcdTAwRkNyIHNpZSBrZWluZSBGYXJiZS9CZXNjaHJlaWJ1bmcgZXhpc3RpZXJ0LiBMXHUwMEY2c3QgbWl0XG4vLyBkZW0gZ2V3XHUwMEU0aGx0ZW4gVFlQIGF1Ziwgb2RlciBtaXQgbnVsbCBiZWkgQWJicnVjaCBiencuIGZhbGxzIGVzIChhdWNoIG1pdFxuLy8gZGVuIGdld1x1MDBFNGhsdGVuIE9wdGlvbmVuKSBrZWluZSBhbnp1emVpZ2VuZGVuIFRZUGVuIGdpYnQuXG5mdW5jdGlvbiBwaWNrVHlwZShhcHAsIHBsdWdpbiwgb3B0aW9ucyA9IHt9KSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgIGNvbnN0IGl0ZW1zID0gdHlwZUl0ZW1zKGFwcCwgcGx1Z2luLCBvcHRpb25zKTtcbiAgICBpZiAoIWl0ZW1zKSB7XG4gICAgICByZXNvbHZlKG51bGwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBuZXcgVHlwUGlja2VyTW9kYWwoYXBwLCBwbHVnaW4sIGl0ZW1zLCByZXNvbHZlKS5vcGVuKCk7XG4gIH0pO1xufVxuXG4vLyBHZW1laW5zYW1lIFRZUC1MaXN0ZSBmXHUwMEZDciBwaWNrVHlwZS9waWNrVHlwZUFuZFN1YnR5cGUgLSBudWxsIHNhbXQgTm90aWNlLFxuLy8gZmFsbHMgZXMgKGF1Y2ggbWl0IGRlbiBnZXdcdTAwRTRobHRlbiBPcHRpb25lbikga2VpbmUgVFlQZW4gZ2lidC5cbmZ1bmN0aW9uIHR5cGVJdGVtcyhhcHAsIHBsdWdpbiwgeyBpbmNsdWRlTWFudWFsT2ZmID0gZmFsc2UsIGluY2x1ZGVVbnJlZ2lzdGVyZWQgPSBmYWxzZSB9ID0ge30pIHtcbiAgY29uc3QgaXRlbXMgPSBwbHVnaW4uZ2V0VHlwZXMoeyBpbmNsdWRlTWFudWFsT2ZmIH0pLm1hcCgoaXRlbSkgPT4gKHsgLi4uaXRlbSwgdW5yZWdpc3RlcmVkOiBmYWxzZSB9KSk7XG4gIGlmIChpbmNsdWRlVW5yZWdpc3RlcmVkKSBpdGVtcy5wdXNoKC4uLnVucmVnaXN0ZXJlZEl0ZW1zKGFwcCwgcGx1Z2luKSk7XG4gIGlmIChpdGVtcy5sZW5ndGggPiAwKSByZXR1cm4gaXRlbXM7XG4gIG5ldyBOb3RpY2UoXCJLZWluZSBUWVBlbiB2b3JoYW5kZW4uXCIpO1xuICByZXR1cm4gbnVsbDtcbn1cblxuLy8gRlx1MDBGQ3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qczogVFlQIHVuZCBTdWJ0eXAgaW4gZWluZW0gWnVnLiBKZVxuLy8gbmFjaCBFaW5zdGVsbHVuZyBzZXBhcmF0ZVN1YnR5cGVQaWNrZXIgZW50d2VkZXIgZWluIGVpbnppZ2VyIFBpY2tlciBtaXQgZGVuXG4vLyBTdWJ0eXBlbiBlaW5nZXJcdTAwRkNja3QgdW50ZXIgaWhyZW0gVFlQIChTdGFuZGFyZCksIG9kZXIgd2llIGZyXHUwMEZDaGVyIGVyc3QgZGVyXG4vLyBUWVAtUGlja2VyIHVuZCBkYW5hY2gsIGZhbGxzIGRlciBUWVAgU3VidHlwZW4gaGF0LCBkZXIgU3VidHlwLVBpY2tlciAoRVNDXG4vLyBkb3J0IGZcdTAwRkNocnQgenVyXHUwMEZDY2sgenVyIFRZUC1BdXN3YWhsKS4gT3B0aW9uZW4gd2llIGJlaSBwaWNrVHlwZS4gTFx1MDBGNnN0IGF1ZiBtaXRcbi8vIHsgdHlwZSwgc3VidHlwZSB9IChzdWJ0eXBlIG51bGwgZlx1MDBGQ3IgXCJvaG5lIFN1YnR5cFwiKSwgb2RlciBtaXQgbnVsbCBiZWlcbi8vIEFiYnJ1Y2guXG5hc3luYyBmdW5jdGlvbiBwaWNrVHlwZUFuZFN1YnR5cGUoYXBwLCBwbHVnaW4sIG9wdGlvbnMgPSB7fSkge1xuICBpZiAocGx1Z2luLnNldHRpbmdzLnNlcGFyYXRlU3VidHlwZVBpY2tlcikge1xuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBjb25zdCB0eXBlID0gYXdhaXQgcGlja1R5cGUoYXBwLCBwbHVnaW4sIG9wdGlvbnMpO1xuICAgICAgaWYgKCF0eXBlKSByZXR1cm4gbnVsbDtcbiAgICAgIGNvbnN0IHN1YnR5cGUgPSBhd2FpdCBwaWNrU3VidHlwZShhcHAsIHBsdWdpbiwgdHlwZSk7XG4gICAgICBpZiAoc3VidHlwZSAhPT0gbnVsbCkgcmV0dXJuIHsgdHlwZSwgc3VidHlwZTogc3VidHlwZSB8fCBudWxsIH07XG4gICAgfVxuICB9XG5cbiAgY29uc3QgaXRlbXMgPSB0eXBlSXRlbXMoYXBwLCBwbHVnaW4sIG9wdGlvbnMpO1xuICBpZiAoIWl0ZW1zKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgZ3JvdXBzID0gaXRlbXMubWFwKChpdGVtKSA9PiAoe1xuICAgIGl0ZW0sXG4gICAgc3VidHlwZXM6IHBsdWdpbi5nZXRTdWJ0eXBlcyhpdGVtLnR5cGUpLm1hcCgoeyBzdWJ0eXBlLCBjb3VudCB9KSA9PiAoeyB0eXBlOiBpdGVtLnR5cGUsIHN1YnR5cGUsIGNvdW50IH0pKSxcbiAgfSkpO1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IG5ldyBUeXBTdWJ0eXBQaWNrZXJNb2RhbChhcHAsIHBsdWdpbiwgZ3JvdXBzLCByZXNvbHZlKS5vcGVuKCkpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcGlja1R5cGUsIHBpY2tTdWJ0eXBlLCBwaWNrVHlwZUFuZFN1YnR5cGUgfTtcbiIsICJjb25zdCB7IFBsdWdpbiB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBERUZBVUxUX1NFVFRJTkdTLCBUeXBTeXN0ZW1TZXR0aW5nVGFiIH0gPSByZXF1aXJlKFwiLi9zZXR0aW5nc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJDb21tYW5kcyB9ID0gcmVxdWlyZShcIi4vY29tbWFuZHNcIik7XG5jb25zdCB7IHJlZ2lzdGVyVHlwVmlldywgc29ydFR5cGVzQnlNb2RlLCBERUZBVUxUX1NPUlRfT1JERVIgfSA9IHJlcXVpcmUoXCIuL3R5cC12aWV3XCIpO1xuY29uc3QgeyBUeXBJbmRleCwgc2V0Q2Fub25pY2FsUHJvcGVydHksIGRlbGV0ZVByb3BlcnR5LCBUWVBfUFJPUEVSVFksIFNVQlRZUF9QUk9QRVJUWSB9ID0gcmVxdWlyZShcIi4vdHlwLWluZGV4XCIpO1xuY29uc3QgeyBnZXRTdWJ0eXBlLCBnZXRTdWJ0eXBlTmFtZXMsIGVuZm9yY2VVbmlxdWVLZXlzIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBlc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJGaWxlRXhwbG9yZXJDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL2ZpbGUtZXhwbG9yZXItY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlckdyYXBoQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9ncmFwaC1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyU2VhcmNoQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9zZWFyY2gtY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlclJlY2VudEZpbGVzQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9yZWNlbnQtZmlsZXMtY29sb3JzXCIpO1xuY29uc3QgeyByZWdpc3RlckJhY2tsaW5rQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9iYWNrbGluay1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyQm9va21hcmtzQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9ib29rbWFyay1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL2FjdGl2ZS10aXRsZS1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyTGlua0NvbG9ycyB9ID0gcmVxdWlyZShcIi4vbGluay1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyRnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0IH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1kZWZhdWx0LWhpZ2hsaWdodFwiKTtcbmNvbnN0IHsgcmVnaXN0ZXJQcm9wZXJ0eVJlbmFtZVN5bmMgfSA9IHJlcXVpcmUoXCIuL3Byb3BlcnR5LXJlbmFtZS1zeW5jXCIpO1xuY29uc3QgeyBub3JtYWxpemVHbG9iYWxPcmRlciwgc29ydEZyb250bWF0dGVyRm9yIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1zb3J0XCIpO1xuY29uc3QgeyByZXNvbHZlRnJvbnRtYXR0ZXJQbGFjZWhvbGRlcnMsIERZTkFNSUNfUExBQ0VIT0xERVJfUEFUVEVSTiB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItcGxhY2Vob2xkZXJzXCIpO1xuY29uc3Qge1xuICBwaWNrVHlwZTogcGlja1R5cGVNb2RhbCxcbiAgcGlja1N1YnR5cGU6IHBpY2tTdWJ0eXBlTW9kYWwsXG4gIHBpY2tUeXBlQW5kU3VidHlwZTogcGlja1R5cGVBbmRTdWJ0eXBlTW9kYWwsXG59ID0gcmVxdWlyZShcIi4vdHlwZS1waWNrZXJcIik7XG5jb25zdCB7IHJlZ2lzdGVyUGxhY2Vob2xkZXJTdWdnZXN0IH0gPSByZXF1aXJlKFwiLi9wbGFjZWhvbGRlci1zdWdnZXN0XCIpO1xuXG4vLyBNaWdyaWVydCBCZXN0YW5kc2luc3RhbGxhdGlvbmVuIHZvbiBkZXIgYWx0ZW4sIHNlcGFyYXRlblxuLy8gdHlwZUZsb2F0aW5nRnJvbnRtYXR0ZXItTGlzdGUgKGVpZ2VuZXMgRGljdCBqZSBUeXAsIGltbWVyIGhpbnRlciBkZXJcbi8vIFN0YW5kYXJkbGlzdGUgc29ydGllcnQpIGF1ZiBkaWUgbmV1ZSB0eXBlRmxvYXRpbmdLZXlzLU1hcmtpZXJ1bmcgaW5uZXJoYWxiXG4vLyBkZXJzZWxiZW4gdHlwZURlZmF1bHRGcm9udG1hdHRlci1MaXN0ZSAoc2llaGUgS29tbWVudGFyIGFuIHR5cGVGbG9hdGluZ0tleXNcbi8vIGluIHNldHRpbmdzLmpzKSAtIGRpZSBGbG9hdGluZyBQcm9wZXJ0aWVzIGxhbmRlbiBkYWJlaSB1bnZlclx1MDBFNG5kZXJ0IGRpcmVrdFxuLy8gaW0gQW5zY2hsdXNzIGFuIGRpZSBiaXNoZXJpZ2UgU3RhbmRhcmRsaXN0ZSwgZ2VuYXUgd2llIHp1dm9yLlxuZnVuY3Rpb24gbWlncmF0ZUZsb2F0aW5nRnJvbnRtYXR0ZXIoc2V0dGluZ3MpIHtcbiAgaWYgKCFzZXR0aW5ncy50eXBlRmxvYXRpbmdGcm9udG1hdHRlcikgcmV0dXJuO1xuICBmb3IgKGNvbnN0IFt0eXBlLCBmbG9hdGluZ10gb2YgT2JqZWN0LmVudHJpZXMoc2V0dGluZ3MudHlwZUZsb2F0aW5nRnJvbnRtYXR0ZXIpKSB7XG4gICAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKGZsb2F0aW5nKS5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBcIlwiKTtcbiAgICBpZiAoa2V5cy5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgIHNldHRpbmdzLnR5cGVEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwZV0gPSB7IC4uLihzZXR0aW5ncy50eXBlRGVmYXVsdEZyb250bWF0dGVyW3R5cGVdID8/IHt9KSwgLi4uZmxvYXRpbmcgfTtcbiAgICBzZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdID0gWy4uLm5ldyBTZXQoWy4uLihzZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdID8/IFtdKSwgLi4ua2V5c10pXTtcbiAgfVxuICBkZWxldGUgc2V0dGluZ3MudHlwZUZsb2F0aW5nRnJvbnRtYXR0ZXI7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gY2xhc3MgVHlwU3lzdGVtUGx1Z2luIGV4dGVuZHMgUGx1Z2luIHtcbiAgYXN5bmMgb25sb2FkKCkge1xuICAgIGF3YWl0IHRoaXMubG9hZFNldHRpbmdzKCk7XG5cbiAgICAvLyBWb3IgYWxsZW4gXHUwMEZDYnJpZ2VuIE1vZHVsZW46IGRpZSByZWdpc3RyaWVyZW4gc2ljaCBhdWYgZGVzc2VuIFwiY2hhbmdlXCItXG4gICAgLy8gRXZlbnQgdW5kIGxlc2VuIFRZUC9TVUJUWVAgYXVzc2NobGllXHUwMERGbGljaCBkYXJcdTAwRkNiZXIgKHNpZWhlIHR5cC1pbmRleC5qcykuXG4gICAgdGhpcy50eXBJbmRleCA9IG5ldyBUeXBJbmRleCh0aGlzKTtcbiAgICB0aGlzLnR5cEluZGV4LnJlZ2lzdGVyKCk7XG5cbiAgICByZWdpc3RlckNvbW1hbmRzKHRoaXMpO1xuICAgIHRoaXMuYWRkU2V0dGluZ1RhYihuZXcgVHlwU3lzdGVtU2V0dGluZ1RhYih0aGlzLmFwcCwgdGhpcykpO1xuICAgIC8vIFVtYmVuZW5udW5nZW4gXHUwMEZDYmVyIFwiQWxsIHByb3BlcnRpZXNcIi9CYXNlcyBhdWNoIGlucyBTdGFuZGFyZC1Gcm9udG1hdHRlclxuICAgIC8vIGRlciBUeXBlbiBcdTAwRkNiZXJuZWhtZW4gKHNpZWhlIHByb3BlcnR5LXJlbmFtZS1zeW5jLmpzKS5cbiAgICByZWdpc3RlclByb3BlcnR5UmVuYW1lU3luYyh0aGlzKTtcbiAgICByZWdpc3RlclBsYWNlaG9sZGVyU3VnZ2VzdCh0aGlzKTtcblxuICAgIC8vIFNlcGFyYXQgZ2VoYWx0ZW4gKG5pY2h0IG51ciBUZWlsIHZvbiByZWZyZXNoRm5zKTogZGllIFRZUC1EZXRhaWxhbnNpY2h0XG4gICAgLy8gYnJhdWNodCBuYWNoIGRlbSBNb3VudGVuIGlocmVzIFN0YW5kYXJkLUZyb250bWF0dGVyLUVkaXRvcnMgZ2V6aWVsdCBudXJcbiAgICAvLyBkaWVzZW4gZWluZW4gUmVmcmVzaCAoRmV0dC1NYXJraWVydW5nIGRlciBQcm9wZXJ0eS1aZWlsZW4pIC0gZGFzIGdhbnplXG4gICAgLy8gcmVmcmVzaFR5cENvbG9ycygpLUJcdTAwRkNuZGVsIHdcdTAwRkNyZGUgZG9ydCBhdWNoIHVublx1MDBGNnRpZyByZWdpc3RlclR5cFZpZXcnc1xuICAgIC8vIGVpZ2VuZW4gUmVuZGVyLVJlZnJlc2ggbWl0YW5zdG9cdTAwREZlbiB1bmQgc2ljaCBkYW1pdCBzZWxic3QgcmVrdXJzaXZcbiAgICAvLyBlcm5ldXQgcmVuZGVybiAoZlx1MDBGQ2hydGUgenUgZWluZW0gU3RhY2sgT3ZlcmZsb3cgYmVpIGplZGVtIFRZUC1cdTAwRDZmZm5lbikuXG4gICAgdGhpcy5yZWZyZXNoRnJvbnRtYXR0ZXJIaWdobGlnaHQgPSByZWdpc3RlckZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodCh0aGlzKTtcblxuICAgIGNvbnN0IHJlZnJlc2hGbnMgPSBbXG4gICAgICByZWdpc3RlclR5cFZpZXcodGhpcyksXG4gICAgICByZWdpc3RlckZpbGVFeHBsb3JlckNvbG9ycyh0aGlzKSxcbiAgICAgIHJlZ2lzdGVyR3JhcGhDb2xvcnModGhpcyksXG4gICAgICByZWdpc3RlclNlYXJjaENvbG9ycyh0aGlzKSxcbiAgICAgIHJlZ2lzdGVyUmVjZW50RmlsZXNDb2xvcnModGhpcyksXG4gICAgICByZWdpc3RlckJhY2tsaW5rQ29sb3JzKHRoaXMpLFxuICAgICAgcmVnaXN0ZXJCb29rbWFya3NDb2xvcnModGhpcyksXG4gICAgICByZWdpc3RlckFjdGl2ZVRpdGxlQ29sb3JzKHRoaXMpLFxuICAgICAgcmVnaXN0ZXJMaW5rQ29sb3JzKHRoaXMpLFxuICAgICAgdGhpcy5yZWZyZXNoRnJvbnRtYXR0ZXJIaWdobGlnaHQsXG4gICAgXTtcbiAgICB0aGlzLnJlZnJlc2hUeXBDb2xvcnMgPSAoKSA9PiByZWZyZXNoRm5zLmZvckVhY2goKGZuKSA9PiBmbigpKTtcbiAgfVxuXG4gIG9udW5sb2FkKCkge31cblxuICAvLyBGXHUwMEZDciBfb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzOiBsaWVmZXJ0IGRpZSBpbSBUWVAtVmlldyB1bnRlclxuICAvLyBcIlN0YW5kYXJkLUZyb250bWF0dGVyXCIgaGludGVybGVndGVuIFByb3BlcnRpZXMgZlx1MDBGQ3IgZGVuIGdlZ2ViZW5lbiBUWVAsIGRhbWl0XG4gIC8vIFRlbXBsYXRlciBzaWUgYmVpbSBBbmxlZ2VuIGVpbmVyIG5ldWVuIE5vdGl6IFx1MDBGQ2Jlcm5laG1lbiBrYW5uLCBzdGF0dCBzaWUgZG9ydFxuICAvLyBlaW4gendlaXRlcyBNYWwgenUgcGZsZWdlbi4gV2VydGUgd2llIFwie3t0b2RheX19XCIgd2VyZGVuIGRhYmVpIGVyc3QgaGllclxuICAvLyBhdWZnZWxcdTAwRjZzdCAoc2llaGUgZnJvbnRtYXR0ZXItcGxhY2Vob2xkZXJzLmpzKSwgbmljaHQgc2Nob24gYmVpbSBTcGVpY2hlcm4gLVxuICAvLyBsaWVmZXJ0IGFsc28gYmVpIGplZGVtIEF1ZnJ1ZiBmcmlzY2ggYmVyZWNobmV0ZSBXZXJ0ZS4gS29waWUgc3RhdHQgZGlyZWt0ZXJcbiAgLy8gUmVmZXJlbnosIGRhbWl0IGVpbiBBdWZydWZlciBkaWUgenVyXHUwMEZDY2tnZWdlYmVuZW4gV2VydGUgZ2VmYWhybG9zIG11dGllcmVuXG4gIC8vIGthbm4sIG9obmUgZGllIFBsdWdpbi1TZXR0aW5ncyB6dSB2ZXJcdTAwRTRuZGVybi5cbiAgLy9cbiAgLy8gaW5jbHVkZUZsb2F0aW5nIChTdGFuZGFyZDogZmFsc2UpIGxcdTAwRTRzc3QgZGllIGFscyBcIkZsb2F0aW5nIFByb3BlcnR5XCJcbiAgLy8gbWFya2llcnRlbiBLZXlzICh0eXBlRmxvYXRpbmdLZXlzKSBpbiBkZXIgTGlzdGUgLSBhbmRlcnMgYWxzIGRpZSBcdTAwRkNicmlnZW5cbiAgLy8gU3RhbmRhcmQtUHJvcGVydGllcyB3ZXJkZW4gZGllc2UgTklDSFQgYXV0b21hdGlzY2ggYmVpIGplZGVyIG5ldWVuIE5vdGl6XG4gIC8vIGFuZ2VsZWd0IChzaWUgelx1MDBFNGhsZW4gendhciBmXHUwMEZDciBkaWUgRnJvbnRtYXR0ZXItU29ydGllcnVuZyBtaXQsIHNpZWhlXG4gIC8vIG9yZGVyZWREZWZhdWx0S2V5cyBpbiBmcm9udG1hdHRlci1zb3J0LmpzLCBzb2xsZW4gYWJlciBudXIgYmVpIEJlZGFyZlxuICAvLyBleHBsaXppdCB2b24gZWluZW0gVGVtcGxhdGVyLVNrcmlwdCBhYmdlZ3JpZmZlbiB3ZXJkZW4pLlxuICAvL1xuICAvLyBmaWxlIChvcHRpb25hbCkgd2lyZCBhbiByZXNvbHZlRnJvbnRtYXR0ZXJQbGFjZWhvbGRlcnMoKSBkdXJjaGdlcmVpY2h0IC1cbiAgLy8gbnVyIGZcdTAwRkNyIGRlbiBcInt7Y3JlYXRlZH19XCItUGxhdHpoYWx0ZXIgcmVsZXZhbnQsIGRlciBkYXMgRXJzdGVsbHVuZ3NkYXR1bVxuICAvLyBkZXIgWmllbC1EYXRlaSBzdGF0dCBkZXMgQXVmcnVmemVpdHB1bmt0cyBsaWVmZXJ0LlxuICAvL1xuICAvLyBzdWJ0eXBlIChvcHRpb25hbCk6IGVyZ1x1MDBFNG56dCBkYXMgU3RhbmRhcmQtRnJvbnRtYXR0ZXIgdW0gZGVuIEJsb2NrIGRpZXNlc1xuICAvLyBTdWJ0eXBzIChzaWVoZSBzdWJ0eXBlcy5qcyksIGRlc3NlbiBLZXlzIGZvbGdlbiBkYWhpbnRlciAtIGJ6dy4gc3RlaGVuXG4gIC8vIGRhdm9yLCB3ZW5uIGRlciBTdWJ0eXAtQmxvY2sgXHUwMEZDYmVyIGRlbSBTdGFuZGFyZC1Gcm9udG1hdHRlciBsaWVndFxuICAvLyAoYWJvdmVTdGFuZGFyZDsgd2ljaHRpZyBmXHUwMEZDciBkaWUgUmVpaGVuZm9sZ2UgZGVyIHRwLi1QbGF0emhhbHRlcikuIEplZGVyXG4gIC8vIEtleSBnZWhcdTAwRjZydCB6dSBnZW5hdSBlaW5lbSBCbG9jayAoc2llaGUgZW5mb3JjZVVuaXF1ZUtleXMpIC0ga1x1MDBFNG1lIGVyIGRvY2hcbiAgLy8gZG9wcGVsdCB2b3IsIGJsaWViZSBzZWluZSBlcnN0ZSBQb3NpdGlvbiwgV2VydCB1bmQgRmxvYXRpbmctTWFya2llcnVuZ1xuICAvLyBrXHUwMEU0bWVuIGF1cyBkZW0gc3BcdTAwRTR0ZXJlbiBCbG9jay5cbiAgZ2V0VHlwZURlZmF1bHRzKHR5cGUsIHsgaW5jbHVkZUZsb2F0aW5nID0gZmFsc2UsIGZpbGUsIHN1YnR5cGUgPSBudWxsIH0gPSB7fSkge1xuICAgIGNvbnN0IGRlZmF1bHRzID0ge307XG4gICAgY29uc3QgaXNGbG9hdGluZyA9IG5ldyBNYXAoKTtcbiAgICBjb25zdCBhZGRCbG9jayA9IChmcm9udG1hdHRlciwgZmxvYXRpbmdLZXlzKSA9PiB7XG4gICAgICBjb25zdCBhY3R1YWxLZXlzID0gbmV3IE1hcChPYmplY3Qua2V5cyhkZWZhdWx0cykubWFwKChrZXkpID0+IFtrZXkudG9Mb3dlckNhc2UoKSwga2V5XSkpO1xuICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoZnJvbnRtYXR0ZXIgPz8ge30pKSB7XG4gICAgICAgIGlmIChrZXkgPT09IFwiXCIpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCB0YXJnZXQgPSBhY3R1YWxLZXlzLmdldChrZXkudG9Mb3dlckNhc2UoKSkgPz8ga2V5O1xuICAgICAgICBkZWZhdWx0c1t0YXJnZXRdID0gdmFsdWU7XG4gICAgICAgIGlzRmxvYXRpbmcuc2V0KHRhcmdldCwgKGZsb2F0aW5nS2V5cyA/PyBbXSkuaW5jbHVkZXMoa2V5KSk7XG4gICAgICB9XG4gICAgfTtcbiAgICBjb25zdCBzdWJ0eXBlRGF0YSA9IHN1YnR5cGUgPyBnZXRTdWJ0eXBlKHRoaXMuc2V0dGluZ3MsIHR5cGUsIHN1YnR5cGUpIDogbnVsbDtcbiAgICBpZiAoc3VidHlwZURhdGE/LmFib3ZlU3RhbmRhcmQpIGFkZEJsb2NrKHN1YnR5cGVEYXRhLmZyb250bWF0dGVyLCBzdWJ0eXBlRGF0YS5mbG9hdGluZ0tleXMpO1xuICAgIGFkZEJsb2NrKHRoaXMuc2V0dGluZ3MudHlwZURlZmF1bHRGcm9udG1hdHRlclt0eXBlXSwgdGhpcy5zZXR0aW5ncy50eXBlRmxvYXRpbmdLZXlzW3R5cGVdKTtcbiAgICBpZiAoc3VidHlwZURhdGEgJiYgIXN1YnR5cGVEYXRhLmFib3ZlU3RhbmRhcmQpIGFkZEJsb2NrKHN1YnR5cGVEYXRhLmZyb250bWF0dGVyLCBzdWJ0eXBlRGF0YS5mbG9hdGluZ0tleXMpO1xuXG4gICAgaWYgKCFpbmNsdWRlRmxvYXRpbmcpIHtcbiAgICAgIGZvciAoY29uc3QgW2tleSwgZmxvYXRpbmddIG9mIGlzRmxvYXRpbmcpIGlmIChmbG9hdGluZykgZGVsZXRlIGRlZmF1bHRzW2tleV07XG4gICAgfVxuICAgIHJldHVybiByZXNvbHZlRnJvbnRtYXR0ZXJQbGFjZWhvbGRlcnMoZGVmYXVsdHMsIGZpbGUpO1xuICB9XG5cbiAgLy8gRlx1MDBGQ3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qczogcmVnaXN0cmllcnRlIFN1YnR5cGVuIGVpbmVzIFRZUHMgaW5cbiAgLy8gZGVyIFJlaWhlbmZvbGdlIGlocmVyIEJsXHUwMEY2Y2tlLCBzYW10IE5vdGl6LUFuemFobC5cbiAgZ2V0U3VidHlwZXModHlwZSkge1xuICAgIGNvbnN0IHsgY291bnRzIH0gPSB0aGlzLnR5cEluZGV4LnN1YnR5cGVCdWNrZXQodHlwZSk7XG4gICAgcmV0dXJuIGdldFN1YnR5cGVOYW1lcyh0aGlzLnNldHRpbmdzLCB0eXBlKS5tYXAoKHN1YnR5cGUpID0+ICh7IHN1YnR5cGUsIGNvdW50OiBjb3VudHMuZ2V0KHN1YnR5cGUpID8/IDAgfSkpO1xuICB9XG5cbiAgLy8gRlx1MDBGQ3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qczogU3VidHlwLVBpY2tlciAoc2llaGVcbiAgLy8gdHlwZS1waWNrZXIuanMpLiBMXHUwMEY2c3QgbWl0IGRlbSBnZXdcdTAwRTRobHRlbiBTdWJ0eXAgYXVmLCBtaXQgXCJcIiBmXHUwMEZDciBcIktlaW5cbiAgLy8gU3VidHlwXCIgKGJ6dy4gb2huZSBQaWNrZXIsIHdlbm4gZGVyIFRZUCBrZWluZSBTdWJ0eXBlbiBoYXQpLCBvZGVyIG1pdFxuICAvLyBudWxsIGJlaSBFU0MgKFRZUC5qcyBrZWhydCBkYW5uIHp1ciBUWVAtQXVzd2FobCB6dXJcdTAwRkNjaykuXG4gIHBpY2tTdWJ0eXBlKHR5cGUpIHtcbiAgICByZXR1cm4gcGlja1N1YnR5cGVNb2RhbCh0aGlzLmFwcCwgdGhpcywgdHlwZSk7XG4gIH1cblxuICAvLyBGXHUwMEZDciBfb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzLCBpbm5lcmhhbGIgdm9uIHByb2Nlc3NGcm9udE1hdHRlcjpcbiAgLy8gc2V0enQgVFlQIHVuZCBTVUJUWVAgaW4gZWluaGVpdGxpY2hlciBTY2hyZWlid2Vpc2UgLSBlaW5lIGFid2VpY2hlbmRcbiAgLy8gZ2VzY2hyaWViZW5lIFByb3BlcnR5IChcInR5cFwiLCBcIlN1YnR5cFwiKSB3aXJkIGFuIGlocmVyIFN0ZWxsZSB1bWJlbmFubnRcbiAgLy8gc3RhdHQgdmVyZG9wcGVsdC4gc3VidHlwZSBudWxsIGVudGZlcm50IGVpbmVuIHZvcmhhbmRlbmVuIFNVQlRZUC5cbiAgYXBwbHlUeXBlUHJvcGVydGllcyhmcm9udG1hdHRlciwgdHlwZSwgc3VidHlwZSkge1xuICAgIHNldENhbm9uaWNhbFByb3BlcnR5KGZyb250bWF0dGVyLCBUWVBfUFJPUEVSVFksIHR5cGUpO1xuICAgIGlmIChzdWJ0eXBlKSBzZXRDYW5vbmljYWxQcm9wZXJ0eShmcm9udG1hdHRlciwgU1VCVFlQX1BST1BFUlRZLCBzdWJ0eXBlKTtcbiAgICBlbHNlIGRlbGV0ZVByb3BlcnR5KGZyb250bWF0dGVyLCBTVUJUWVBfUFJPUEVSVFkpO1xuICB9XG5cbiAgLy8gRlx1MDBGQ3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qcywgaW5uZXJoYWxiIHZvbiBwcm9jZXNzRnJvbnRNYXR0ZXJcbiAgLy8gdW5kIG5hY2ggYWxsZW4gXHUwMEZDYnJpZ2VuIFx1MDBDNG5kZXJ1bmdlbjogYnJpbmd0IGRhcyBGcm9udG1hdHRlciBpbiBkaWVcbiAgLy8gUmVpaGVuZm9sZ2UgZGVyIEZyb250bWF0dGVyLVNvcnRpZXJ1bmcgKGdsb2JhbGUgUmVpaGVuZm9sZ2UsIFRZUC1cbiAgLy8gRnJvbnRtYXR0ZXIgc2FtdCBTdWJ0eXAtQmxvY2spIC0gc29uc3QgbGFuZGVuIG5ldSBlcmdcdTAwRTRuenRlIFByb3BlcnRpZXNcbiAgLy8gKHouIEIuIFNVQlRZUCBpbiBlaW5lciBiZXN0ZWhlbmRlbiBOb3RpeikgYW0gRW5kZS5cbiAgc29ydEZyb250bWF0dGVyKGZyb250bWF0dGVyLCB0eXBlLCBzdWJ0eXBlID0gbnVsbCkge1xuICAgIHJldHVybiBzb3J0RnJvbnRtYXR0ZXJGb3IodGhpcywgZnJvbnRtYXR0ZXIsIHR5cGUsIHN1YnR5cGUpO1xuICB9XG5cbiAgLy8gRlx1MDBGQ3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qczogZXJrZW5udCBlaW5lbiBkeW5hbWlzY2hlblxuICAvLyBcInt7dHAuPFNrcmlwdG5hbWU+fX1cIi1QbGF0emhhbHRlciAoc2llaGUgZnJvbnRtYXR0ZXItcGxhY2Vob2xkZXJzLmpzKSBpblxuICAvLyBlaW5lbSBTdGFuZGFyZC1Gcm9udG1hdHRlci1XZXJ0IHVuZCBsaWVmZXJ0IGRlbiByZWZlcmVuemllcnRlbiBTa3JpcHRuYW1lbixcbiAgLy8gc29uc3QgbnVsbC4gRGllIGVpZ2VudGxpY2hlIEF1ZmxcdTAwRjZzdW5nIChBdWZydWYgdm9uIHRwLnVzZXIuPFNrcmlwdG5hbWU+KVxuICAvLyBrYW5uIG51ciBUZW1wbGF0ZXIgc2VsYnN0IFx1MDBGQ2Jlcm5laG1lbiAtIGRhcyBQbHVnaW4gaGF0IGtlaW5lbiB0cC1adWdyaWZmLFxuICAvLyBkYWhlciBoaWVyIGJld3Vzc3QgbnVyIEVya2VubnVuZyBzdGF0dCBBdWZsXHUwMEY2c3VuZyB3aWUgYmVpIGdldFR5cGVEZWZhdWx0cygpLlxuICBtYXRjaER5bmFtaWNQbGFjZWhvbGRlcih2YWx1ZSkge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwic3RyaW5nXCIpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IG1hdGNoID0gdmFsdWUubWF0Y2goRFlOQU1JQ19QTEFDRUhPTERFUl9QQVRURVJOKTtcbiAgICByZXR1cm4gbWF0Y2ggPyBtYXRjaFsxXS50cmltKCkgOiBudWxsO1xuICB9XG5cbiAgLy8gRlx1MDBGQ3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qczogZGllIGltIFRZUC1WaWV3IHJlZ2lzdHJpZXJ0ZW4gVFlQZW5cbiAgLy8gc2FtdCBpaHJlciBkb3J0IGdlcGZsZWd0ZW4gQmVzY2hyZWlidW5nLCBzdGF0dCBzaWUgYXVzIF9vYnNpZGlhbi9UeXBlbi5tZCB6dSBwYXJzZW4gLVxuICAvLyBpbiBkZXJzZWxiZW4gUmVpaGVuZm9sZ2UsIGluIGRlciBzaWUgYXVjaCBpbiBkZXIgVFlQLUxpc3RlIHNlbGJzdCBlcnNjaGVpbmVuXG4gIC8vIChha3R1ZWxsZSBTb3J0aWVyZWluc3RlbGx1bmcgZG9ydCwgei4gQi4gSFx1MDBFNHVmaWdrZWl0IG9kZXIgTmFtZSkuXG4gIC8vXG4gIC8vIFRZUGVuIG1pdCBkZWFrdGl2aWVydGVtIFwiTWFudWVsbGVyIFRZUFwiLVNjaGFsdGVyIChzaWVoZSBUWVAtRGV0YWlsYW5zaWNodClcbiAgLy8gc2luZCBuaWNodCBmXHUwMEZDciBkaWUgbWFudWVsbGUgQXVzd2FobCBnZWRhY2h0ICh6LiBCLiBiZWltIEFubGVnZW4gZWluZXIgbmV1ZW5cbiAgLy8gTm90aXopIHVuZCB3ZXJkZW4gZGVzaGFsYiBzdGFuZGFyZG1cdTAwRTRcdTAwREZpZyBhdXNnZWtsYW1tZXJ0IC0gQXVmcnVmZXIsIGRpZVxuICAvLyB0cm90emRlbSBhbGxlIFRZUGVuIGJyYXVjaGVuLCBcdTAwRkNiZXJnZWJlbiBpbmNsdWRlTWFudWFsT2ZmOiB0cnVlLlxuICBnZXRUeXBlcyh7IGluY2x1ZGVNYW51YWxPZmYgPSBmYWxzZSB9ID0ge30pIHtcbiAgICBjb25zdCB7IGNvdW50cyB9ID0gdGhpcy50eXBJbmRleC50eXBlQ291bnRzKCk7XG4gICAgY29uc3Qgc29ydE9yZGVyID0gdGhpcy5zZXR0aW5ncy50eXBTb3J0T3JkZXIgPz8gREVGQVVMVF9TT1JUX09SREVSO1xuICAgIHJldHVybiBzb3J0VHlwZXNCeU1vZGUodGhpcy5zZXR0aW5ncy50eXBlcywgc29ydE9yZGVyLCBjb3VudHMsIHRoaXMuc2V0dGluZ3MudHlwZUNvbG9ycylcbiAgICAgIC5maWx0ZXIoKHR5cGUpID0+IGluY2x1ZGVNYW51YWxPZmYgfHwgKHRoaXMuc2V0dGluZ3MudHlwZU1hbnVhbCA/PyB7fSlbdHlwZV0gIT09IGZhbHNlKVxuICAgICAgLm1hcCgodHlwZSkgPT4gKHtcbiAgICAgICAgdHlwZSxcbiAgICAgICAgZGVzY3JpcHRpb246IHRoaXMuc2V0dGluZ3MudHlwZURlc2NyaXB0aW9uc1t0eXBlXSA/PyBcIlwiLFxuICAgICAgICBjb3VudDogY291bnRzLmdldCh0eXBlKSA/PyAwLFxuICAgICAgfSkpO1xuICB9XG5cbiAgLy8gRlx1MDBGQ3IgX29ic2lkaWFuL3RlbXBsYXRlci1zY3JpcHRzL1RZUC5qczogbmF0aXZlciBUWVAtUGlja2VyIChzaWVoZVxuICAvLyB0eXBlLXBpY2tlci5qcykgc3RhdHQgZGVyIHJlaW5lbiBUZXh0LUxpc3RlIGF1cyBnZXRUeXBlcygpICtcbiAgLy8gdHAuc3lzdGVtLnN1Z2dlc3RlciAtIG1pdCBUWVAtRmFyYmUvLVB1bmt0LCBCZXNjaHJlaWJ1bmcgdW5kIE5vdGl6LUFuemFobFxuICAvLyBqZSBaZWlsZS4gaW5jbHVkZU1hbnVhbE9mZiB3aWUgYmVpIGdldFR5cGVzKCkuIExcdTAwRjZzdCBtaXQgZGVtIGdld1x1MDBFNGhsdGVuIFRZUFxuICAvLyBhdWYsIG9kZXIgbWl0IG51bGwgYmVpIEFiYnJ1Y2ggKEVTQykuXG4gIHBpY2tUeXBlKG9wdGlvbnMpIHtcbiAgICByZXR1cm4gcGlja1R5cGVNb2RhbCh0aGlzLmFwcCwgdGhpcywgb3B0aW9ucyk7XG4gIH1cblxuICAvLyBGXHUwMEZDciBfb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzOiBUWVAgdW5kIFN1YnR5cCBpbiBlaW5lbSBadWcgKHNpZWhlXG4gIC8vIHR5cGUtcGlja2VyLmpzKSAtIGplIG5hY2ggRWluc3RlbGx1bmcgXCJTdWJ0eXAtUGlja2VyIHNlcGFyYXRcIiBlaW4gZWluemlnZXJcbiAgLy8gUGlja2VyIG1pdCBlaW5nZXJcdTAwRkNja3RlbiBTdWJ0eXBlbiBvZGVyIGJlaWRlIFBpY2tlciBuYWNoZWluYW5kZXIuIE9wdGlvbmVuXG4gIC8vIHdpZSBiZWkgcGlja1R5cGUoKS4gTFx1MDBGNnN0IG1pdCB7IHR5cGUsIHN1YnR5cGUgfSBhdWYgKHN1YnR5cGUgbnVsbCBmXHUwMEZDciBcIm9obmVcbiAgLy8gU3VidHlwXCIpLCBvZGVyIG1pdCBudWxsIGJlaSBBYmJydWNoIChFU0MpLlxuICBwaWNrVHlwZUFuZFN1YnR5cGUob3B0aW9ucykge1xuICAgIHJldHVybiBwaWNrVHlwZUFuZFN1YnR5cGVNb2RhbCh0aGlzLmFwcCwgdGhpcywgb3B0aW9ucyk7XG4gIH1cblxuICBhc3luYyBsb2FkU2V0dGluZ3MoKSB7XG4gICAgdGhpcy5zZXR0aW5ncyA9IE9iamVjdC5hc3NpZ24oe30sIERFRkFVTFRfU0VUVElOR1MsIGF3YWl0IHRoaXMubG9hZERhdGEoKSk7XG4gICAgLy8gT2JqZWN0LmFzc2lnbiBlcnNldHp0IHZlcnNjaGFjaHRlbHRlIE9iamVrdGUgYWxzIEdhbnplcyAtIHNwXHUwMEU0dGVyXG4gICAgLy8gaGluenVnZWtvbW1lbmUgQW5zaWNodGVuICh6LiBCLiBjb2xvclZpZXdzLmxpbmtzKSBmZWhsdGVuIGluIGJlcmVpdHNcbiAgICAvLyBnZXNwZWljaGVydGVuIEVpbnN0ZWxsdW5nZW4gc29uc3QgdW5kIHdcdTAwRTRyZW4gc3RpbGxzY2h3ZWlnZW5kIGF1cy5cbiAgICB0aGlzLnNldHRpbmdzLmNvbG9yVmlld3MgPSB7IC4uLkRFRkFVTFRfU0VUVElOR1MuY29sb3JWaWV3cywgLi4udGhpcy5zZXR0aW5ncy5jb2xvclZpZXdzIH07XG4gICAgLy8gTWlncmllcnQgQmVzdGFuZHNpbnN0YWxsYXRpb25lbiwgZGVyZW4gZ2xvYmFsUHJvcGVydHlPcmRlciBub2NoIGF1cyBkZXJcbiAgICAvLyBaZWl0IHZvciBcIlRZUCBhbHMgTGlzdGVuZWludHJhZ1wiIHN0YW1tdCAoc2llaGUgZnJvbnRtYXR0ZXItc29ydC5qcykuXG4gICAgdGhpcy5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyID0gbm9ybWFsaXplR2xvYmFsT3JkZXIodGhpcy5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyKTtcbiAgICBtaWdyYXRlRmxvYXRpbmdGcm9udG1hdHRlcih0aGlzLnNldHRpbmdzKTtcbiAgICAvLyBKZWRlciBLZXkgbnVyIGluIGVpbmVtIEJsb2NrIGplIFRZUCAoc2llaGUgZW5mb3JjZVVuaXF1ZUtleXMpIC0gclx1MDBFNHVtdFxuICAgIC8vIERhdGVuIGF1cyBkZXIgWmVpdCBhdWYsIGFscyBTdWJ0eXBlbiBLZXlzIG5vY2ggXHUwMEZDYmVyc2NocmVpYmVuIGtvbm50ZW4uXG4gICAgZm9yIChjb25zdCB0eXBlIG9mIE9iamVjdC5rZXlzKHRoaXMuc2V0dGluZ3MudHlwZVN1YnR5cGVzID8/IHt9KSkgZW5mb3JjZVVuaXF1ZUtleXModGhpcy5zZXR0aW5ncywgdHlwZSk7XG4gIH1cblxuICBhc3luYyBzYXZlU2V0dGluZ3MoKSB7XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcbiAgfVxufTtcbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7OztBQUFBO0FBQUEscUJBQUFBLFVBQUFDLFNBQUE7QUFBQSxRQUFNLEVBQUUsUUFBUSxPQUFPLFNBQVMsSUFBSSxRQUFRLFVBQVU7QUFFdEQsUUFBTUMsZ0JBQWU7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T0FBTyxPQUFPLElBQUksSUFBSSxLQUFLO0FBQUEsSUFDN0IsRUFBRTtBQUFBLEVBQ047QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFPQSxTQUFTLFNBQVM7QUFDaEIsV0FBTyxjQUFjLEtBQUssS0FBSyxNQUFNLE9BQU87QUFBQSxFQUM5QztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQU9BLG1CQUFtQixTQUFTO0FBQzFCLFdBQU8sd0JBQXdCLEtBQUssS0FBSyxNQUFNLE9BQU87QUFBQSxFQUN4RDtBQUFBLEVBRUEsTUFBTSxlQUFlO0FBQ25CLFNBQUssV0FBVyxPQUFPLE9BQU8sQ0FBQyxHQUFHLGtCQUFrQixNQUFNLEtBQUssU0FBUyxDQUFDO0FBSXpFLFNBQUssU0FBUyxhQUFhLEVBQUUsR0FBRyxpQkFBaUIsWUFBWSxHQUFHLEtBQUssU0FBUyxXQUFXO0FBR3pGLFNBQUssU0FBUyxzQkFBc0IscUJBQXFCLEtBQUssU0FBUyxtQkFBbUI7QUFDMUYsK0JBQTJCLEtBQUssUUFBUTtBQUd4QyxlQUFXLFFBQVEsT0FBTyxLQUFLLEtBQUssU0FBUyxnQkFBZ0IsQ0FBQyxDQUFDLEVBQUcsbUJBQWtCLEtBQUssVUFBVSxJQUFJO0FBQUEsRUFDekc7QUFBQSxFQUVBLE1BQU0sZUFBZTtBQUNuQixVQUFNLEtBQUssU0FBUyxLQUFLLFFBQVE7QUFBQSxFQUNuQztBQUNGOyIsCiAgIm5hbWVzIjogWyJleHBvcnRzIiwgIm1vZHVsZSIsICJUWVBfUFJPUEVSVFkiLCAiU1VCVFlQX1BST1BFUlRZIiwgInNldENhbm9uaWNhbFByb3BlcnR5IiwgImRlbGV0ZVByb3BlcnR5IiwgIlR5cEluZGV4IiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInNldENhbm9uaWNhbFByb3BlcnR5IiwgIlNVQlRZUF9QUk9QRVJUWSIsICJnZXRTdWJ0eXBlTmFtZXMiLCAiZ2V0U3VidHlwZSIsICJlbmZvcmNlVW5pcXVlS2V5cyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXBlIiwgIlRZUF9QUk9QRVJUWSIsICJTVUJUWVBfUFJPUEVSVFkiLCAibm9ybWFsaXplR2xvYmFsT3JkZXIiLCAic29ydEZyb250bWF0dGVyRm9yIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgIlRZUF9QUk9QRVJUWSIsICJTVUJUWVBfUFJPUEVSVFkiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiREVGQVVMVF9TRVRUSU5HUyIsICJUeXBTeXN0ZW1TZXR0aW5nVGFiIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyQ29tbWFuZHMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiRFlOQU1JQ19QTEFDRUhPTERFUl9QQVRURVJOIiwgInJlc29sdmVGcm9udG1hdHRlclBsYWNlaG9sZGVycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlclBsYWNlaG9sZGVyU3VnZ2VzdCIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXBlIiwgIlRZUF9QUk9QRVJUWSIsICJTVUJUWVBfUFJPUEVSVFkiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZ2V0U3VidHlwZU5hbWVzIiwgImdldFN1YnR5cGUiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAic29ydFR5cGVzQnlNb2RlIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImdldFN1YnR5cGVOYW1lcyIsICJnZXRTdWJ0eXBlIiwgInNvcnRUeXBlc0J5TW9kZSIsICJzZXRDYW5vbmljYWxQcm9wZXJ0eSIsICJUWVBfUFJPUEVSVFkiLCAiU1VCVFlQX1BST1BFUlRZIiwgIkRFRkFVTFRfU09SVF9PUkRFUiIsICJyZWdpc3RlclR5cFZpZXciLCAibGVhZiIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlckZpbGVFeHBsb3JlckNvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlckdyYXBoQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyU2VhcmNoQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyUmVjZW50RmlsZXNDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJCYWNrbGlua0NvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlckJvb2ttYXJrc0NvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlckFjdGl2ZVRpdGxlQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyTGlua0NvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXBlTmFtZXMiLCAiZ2V0U3VidHlwZSIsICJUWVBfUFJPUEVSVFkiLCAiZmxvYXRpbmciLCAicmVnaXN0ZXJGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZ2V0U3VidHlwZU5hbWVzIiwgIlRZUF9QUk9QRVJUWSIsICJTVUJUWVBfUFJPUEVSVFkiLCAicmVnaXN0ZXJQcm9wZXJ0eVJlbmFtZVN5bmMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiREVGQVVMVF9TT1JUX09SREVSIl0KfQo=
