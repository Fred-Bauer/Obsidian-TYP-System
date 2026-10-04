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

// src/frontmatter-sort.js
var require_frontmatter_sort = __commonJS({
  "src/frontmatter-sort.js"(exports2, module2) {
    var { Notice } = require("obsidian");
    var { getSubtyp: getSubtyp2 } = require_subtyps();
    var { typKeyOf, propertyValue, TYP_PROPERTY: TYP_PROPERTY2, SUBTYP_PROPERTY: SUBTYP_PROPERTY2 } = require_typ_index();
    var { plural } = require_typ_utils();
    var { ConfirmModal, typNameNode } = require_confirm_modal();
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
    function cacheNeedsSorting(app, file, globalOrder, typDefaultKeys) {
      const cachedKeys = cachedFrontmatterKeys(app, file);
      if (!cachedKeys || cachedKeys.length <= 1) return false;
      const cachedSorted = computeSortedKeys(cachedKeys, globalOrder, typDefaultKeys);
      return !cachedSorted.every((key, i) => key === cachedKeys[i]);
    }
    async function sortFileFrontmatter(app, file, globalOrder, typDefaultKeys) {
      if (!cacheNeedsSorting(app, file, globalOrder, typDefaultKeys)) return false;
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
    var LARGE_SORT_THRESHOLD = 50;
    var PROGRESS_STEP = 10;
    function sortCandidates(app, plugin, onlyTyp) {
      const globalOrder = normalizeGlobalOrder2(plugin.settings.globalPropertyOrder);
      let checked = 0;
      const candidates = [];
      for (const file of app.vault.getMarkdownFiles()) {
        if (!plugin.settings.includeIgnoredFiles && app.metadataCache.isUserIgnored(file.path)) continue;
        const typ = plugin.typIndex.typOf(file);
        if (onlyTyp && typ !== onlyTyp) continue;
        const typDefaultKeys = orderedDefaultKeys(plugin, typ, plugin.typIndex.subtypOf(file));
        checked++;
        if (cacheNeedsSorting(app, file, globalOrder, typDefaultKeys)) candidates.push({ file, typDefaultKeys });
      }
      return { checked, candidates, globalOrder };
    }
    async function sortAllFrontmatter(app, plugin, onlyTyp) {
      const { checked, candidates, globalOrder } = sortCandidates(app, plugin, onlyTyp);
      const hasTypDefaults = onlyTyp ? orderedDefaultKeys(plugin, onlyTyp) !== null : null;
      const label = onlyTyp ? `Frontmatter sorting ${onlyTyp}` : "Frontmatter sorting";
      const progressText = (done) => `${label}: ${done} of ${plural(candidates.length, "note")}\u2026`;
      const notice = candidates.length >= LARGE_SORT_THRESHOLD ? new Notice(progressText(0), 0) : null;
      let changed = 0;
      try {
        for (const [index, { file, typDefaultKeys }] of candidates.entries()) {
          if (await sortFileFrontmatter(app, file, globalOrder, typDefaultKeys)) changed++;
          if (notice && (index + 1) % PROGRESS_STEP === 0) notice.setMessage(progressText(index + 1));
        }
      } finally {
        notice?.hide();
      }
      return { checked, changed, hasTypDefaults };
    }
    function confirmLargeSort(plugin, onlyTyp, count, checked) {
      const noun = checked === 1 ? "note" : "notes";
      const title = onlyTyp ? [`Re-sort ${count} of ${checked} `, typNameNode(plugin, onlyTyp, plugin.settings.typColors[onlyTyp] ?? null), ` ${noun}?`] : `Re-sort ${count} of ${checked} ${noun}?`;
      return new Promise(
        (resolve) => new ConfirmModal(plugin.app, {
          title,
          body: ["Only the order of their properties changes, values stay as they are."],
          confirmText: "Sort",
          // Like "Rename and update notes": Enter confirms the run just asked for.
          focus: "confirm",
          onConfirm: () => resolve(true),
          onCancel: () => resolve(false)
        }).open()
      );
    }
    async function runFrontmatterSort(plugin, onlyTyp = null) {
      const { checked, candidates } = sortCandidates(plugin.app, plugin, onlyTyp);
      if (candidates.length >= LARGE_SORT_THRESHOLD && !await confirmLargeSort(plugin, onlyTyp, candidates.length, checked)) return;
      const { changed, hasTypDefaults, checked: checkedNow } = await sortAllFrontmatter(plugin.app, plugin, onlyTyp);
      let message = sortSummary(onlyTyp ? `Frontmatter sorting ${onlyTyp}` : "Frontmatter sorting", checkedNow, changed);
      if (hasTypDefaults === false) {
        message += ` Note: ${onlyTyp} has no TYP-Frontmatter, so only the global order was applied.`;
      }
      new Notice(message);
    }
    function sortSummary(label, checked, changed) {
      return changed > 0 ? `${label}: checked ${plural(checked, "note")}, sorted ${changed}.` : `${label}: checked ${plural(checked, "note")}, all already sorted.`;
    }
    module2.exports = {
      sortSingleFileFrontmatter,
      runFrontmatterSort,
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
    var { TYP_PROPERTY: TYP_PROPERTY2, SUBTYP_PROPERTY: SUBTYP_PROPERTY2, runFrontmatterSort } = require_frontmatter_sort();
    var PLACEHOLDER_LABELS = {
      typValue: "TYP",
      subtypValue: "SUBTYP",
      typ: "TYP-Frontmatter",
      other: "Other properties"
    };
    var PLACEHOLDER_DESCRIPTIONS = {
      typValue: "The TYP property itself.",
      subtypValue: "The SUBTYP property itself.",
      typ: "The TYP's TYP-Frontmatter list, followed by the note's Subtyp block.",
      other: "Every property not placed by another row."
    };
    function mountGlobalOrderEditor(containerEl, plugin) {
      const header = containerEl.createDiv({ cls: "typ-frontmatter-header" });
      const titleGroup = header.createDiv({ cls: "typ-frontmatter-title-group" });
      const applyBtn = titleGroup.createDiv({ cls: "clickable-icon", attr: { "aria-label": "Apply to all notes" } });
      setIcon(applyBtn, "play");
      applyBtn.addEventListener("click", async () => {
        try {
          await runFrontmatterSort(plugin, null);
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
            row.createDiv({
              cls: "typ-order-label",
              text: PLACEHOLDER_LABELS[entry.kind],
              attr: { "aria-label": PLACEHOLDER_DESCRIPTIONS[entry.kind] }
            });
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
        new SettingGroup(containerEl).setHeading("General").addSetting(
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
        ).addSetting(
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
            text: `Order applied by the "Sort frontmatter" commands; values are never changed. Pin single properties such as cssclasses or aliases. Drag to reorder; hover a placeholder row for what it stands for. Placeholder rows can't be removed.`
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
    var { ButtonComponent, Modal, Setting } = require("obsidian");
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
      constructor(plugin, target, preview, initial, resolve) {
        super(plugin.app);
        this.plugin = plugin;
        this.target = target;
        this.preview = preview;
        this.resolve = resolve;
        this.options = { floating: false, allSubtyps: false, tags: false, ...initial };
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
    function askColumnOptions(plugin, target, preview, initial = null) {
      return new Promise((resolve) => new ColumnOptionsModal(plugin, target, preview, initial, resolve).open());
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
        this.titleEl.setText(`Remove columns from "${this.viewName}"?`);
        contentEl.createEl("p", {
          cls: "typ-base-removal-intro",
          text: "These columns don't belong to the TYP. Unchecked ones are kept."
        });
        for (const id of this.columns) {
          const setting = new Setting(contentEl).setName(columnLabel(id));
          const label = setting.controlEl.createEl("label", { cls: "typ-base-removal-check" });
          const checkbox = label.createEl("input", { type: "checkbox" });
          checkbox.checked = true;
          label.appendText("Remove");
          checkbox.addEventListener("change", () => {
            if (checkbox.checked) this.marked.add(id);
            else this.marked.delete(id);
            this.updateConfirm();
          });
        }
        contentEl.createEl("p", {
          cls: "typ-base-removal-note",
          text: "Cancel discards the whole update, including adding and reordering columns."
        });
        const buttonRow = contentEl.createDiv({ cls: "modal-button-container" });
        this.cancelButton = new ButtonComponent(buttonRow).setButtonText("Cancel").onClick(() => this.close());
        this.confirmButton = new ButtonComponent(buttonRow).onClick(() => {
          this.confirmed = true;
          this.close();
        });
        this.updateConfirm();
      }
      // Focus on Cancel, as in the plugin's delete dialogs: Enter then only drops
      // the run instead of removing columns from the file. Here, not in onOpen:
      // Modal.open() focuses the first input (the first checkbox) after onOpen.
      open() {
        super.open();
        this.cancelButton?.buttonEl.focus();
      }
      // "Remove 3 columns" in red while anything goes, "Keep all columns" as a
      // plain confirmation once nothing is checked. setWarning() is
      // setDestructive() plus setCta() since Obsidian 1.13 - the red button of
      // ConfirmModal - and has no counterpart, hence the reset by class.
      updateConfirm() {
        const count = this.marked.size;
        const button = this.confirmButton;
        button.buttonEl.removeClass("mod-cta", "mod-destructive");
        if (count > 0) button.setButtonText(`Remove ${plural(count, "column")}`).setWarning();
        else button.setButtonText("Keep all columns").setCta();
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
    function optionsFromColumns(plugin, target, currentIds) {
      const present = new Set(currentIds.map((id) => id.toLowerCase()));
      const hasColumn = (key) => present.has(noteId(key).toLowerCase());
      const fixed = new Set(
        targetKeys(plugin, target, { floating: false, allSubtyps: false }).main.map((key) => key.toLowerCase())
      );
      const floatingKeys = targetKeys(plugin, target, { floating: true, allSubtyps: false }).main.filter(
        (key) => !fixed.has(key.toLowerCase())
      );
      const options = {
        floating: floatingKeys.some(hasColumn),
        allSubtyps: false,
        tags: hasColumn(TAGS_PROPERTY)
      };
      if (target.typ && !target.subtyp) {
        options.allSubtyps = targetKeys(plugin, target, { floating: true, allSubtyps: true }).others.some(hasColumn);
      }
      return options;
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
    function caseVariants(app, name) {
      const lower = name.toLowerCase();
      return app.vault.getRoot().children.filter((file) => file.name !== name && file.name.toLowerCase() === lower);
    }
    function basePath(plugin, target) {
      if (target.typ) return `${target.typ}.${BASE_EXTENSION}`;
      const subtyp = target.subtyp;
      const lower = subtyp.toLowerCase();
      const typClash = plugin.settings.typs.some((typ) => typ.toLowerCase() === lower);
      const fileClash = caseVariants(plugin.app, `${subtyp}.${BASE_EXTENSION}`).length > 0;
      return typClash || fileClash ? `${subtyp} (Subtyp).${BASE_EXTENSION}` : `${subtyp}.${BASE_EXTENSION}`;
    }
    async function createBase(plugin, target, path, options) {
      const app = plugin.app;
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
      const path = basePath(plugin, target);
      const variant = plugin.app.vault.getAbstractFileByPath(path) ? null : caseVariants(plugin.app, path)[0];
      if (variant) {
        new Notice(`"${variant.name}" already exists in a different case \u2013 rename or delete it first.`);
        return;
      }
      const options = await askColumnOptions(plugin, target, (current) => columnIds(plugin, target, current));
      if (!options) return;
      await createBase(plugin, target, path, options);
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
      let pendingFilter = null;
      if (!target) {
        const choice = await plugin.pickTypAndSubtyp({ includeManualOff: true });
        if (!choice) return;
        target = { typ: choice.typ, subtyp: choice.subtyp };
        const and = [equalsFilter(TYP_PROPERTY2, choice.typ)];
        if (choice.subtyp) and.push(equalsFilter(SUBTYP_PROPERTY2, choice.subtyp));
        pendingFilter = { and };
      }
      const initial = optionsFromColumns(plugin, target, Array.isArray(cfg.order) ? cfg.order : []);
      const options = await askColumnOptions(plugin, target, (current2) => columnIds(plugin, target, current2), initial);
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
      if (pendingFilter) query.setViewFilters(cfg.name, pendingFilter);
      const filterNote = pendingFilter ? "filter set, " : "";
      if (newOrder.length === current.length && newOrder.every((id, index) => id === current[index])) {
        new Notice(`View "${cfg.name}": ${filterNote}columns are already up to date.`);
        return;
      }
      const added = desired.filter((id) => !current.some((existing) => sameId(existing, id))).length;
      const removed = extras.length - kept.length;
      cfg.setOrder(newOrder);
      new Notice(`View "${cfg.name}": ${filterNote}added ${plural(added, "column")}, removed ${removed}.`);
    }
    module2.exports = {
      isBasesEnabled,
      createBaseCommand,
      createBaseFor,
      activeBaseView,
      updateActiveView,
      // Exposed for testing single building blocks
      basePath,
      columnIds,
      optionsFromColumns,
      readTarget,
      targetViews
    };
  }
});

// src/commands.js
var require_commands = __commonJS({
  "src/commands.js"(exports2, module2) {
    var { Notice } = require("obsidian");
    var { runFrontmatterSort, sortSingleFileFrontmatter } = require_frontmatter_sort();
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
        // Asks first when the run is large, see runFrontmatterSort.
        callback: runOrReportError("Frontmatter sorting", () => runFrontmatterSort(plugin, null))
      });
      plugin.addCommand({
        id: "sort-frontmatter-typ",
        name: "Sort frontmatter for one TYP",
        callback: runOrReportError("Frontmatter sorting", async () => {
          const typ = await plugin.pickTyp({ includeManualOff: true, includeUnregistered: true });
          if (!typ) return;
          await runFrontmatterSort(plugin, typ);
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
    var { runFrontmatterSort } = require_frontmatter_sort();
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
          (item) => item.setTitle("Sort frontmatter for this TYP").setIcon("arrow-down-up").onClick(runOrReportError("Frontmatter sorting", () => runFrontmatterSort(this.plugin, typ)))
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL3R5cC1pbmRleC5qcyIsICJzcmMvc3VidHlwcy5qcyIsICJzcmMvdHlwLXV0aWxzLmpzIiwgInNyYy90eXAtY29sb3JzLmpzIiwgInNyYy9jb25maXJtLW1vZGFsLmpzIiwgInNyYy9mcm9udG1hdHRlci1zb3J0LmpzIiwgInNyYy9mcm9udG1hdHRlci1vcmRlci1lZGl0b3IuanMiLCAic3JjL3NldHRpbmdzLmpzIiwgInNyYy9iYXNlLWRpYWxvZ3MuanMiLCAic3JjL2Jhc2VzLmpzIiwgInNyYy9jb21tYW5kcy5qcyIsICJzcmMvdW5kby5qcyIsICJzcmMvc2hvcnRjdXRzLmpzIiwgInNyYy9zaG9ydGN1dC1waWNrZXIuanMiLCAic3JjL3R5cC1mcm9udG1hdHRlci1lZGl0b3IuanMiLCAic3JjL2Zyb250bWF0dGVyLWJsb2Nrcy5qcyIsICJzcmMvdHlwLXNldHRpbmdzLmpzIiwgInNyYy90eXAtcGFuZS5qcyIsICJzcmMvZmlsZS1leHBsb3Jlci1jb2xvcnMuanMiLCAic3JjL2dyYXBoLWNvbG9ycy5qcyIsICJzcmMvc2VhcmNoLWNvbG9ycy5qcyIsICJzcmMvcmVjZW50LWZpbGVzLWNvbG9ycy5qcyIsICJzcmMvYmFja2xpbmstY29sb3JzLmpzIiwgInNyYy9ib29rbWFyay1jb2xvcnMuanMiLCAic3JjL2FjdGl2ZS10aXRsZS1jb2xvcnMuanMiLCAic3JjL2xpbmstY29sb3JzLmpzIiwgInNyYy9mcm9udG1hdHRlci1kZWZhdWx0LWhpZ2hsaWdodC5qcyIsICJzcmMvcHJvcGVydHktcmVuYW1lLXN5bmMuanMiLCAic3JjL3R5cC1waWNrZXIuanMiLCAic3JjL3Nob3J0Y3V0LXNjcmlwdHMuanMiLCAic3JjL21haW4uanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IHsgRXZlbnRzLCBURmlsZSwgZGVib3VuY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcblxuY29uc3QgVFlQX1BST1BFUlRZID0gXCJUWVBcIjtcbmNvbnN0IFNVQlRZUF9QUk9QRVJUWSA9IFwiU1VCVFlQXCI7XG5jb25zdCBFTVBUWV9FTlRSWSA9IE9iamVjdC5mcmVlemUoeyB0eXBLZXk6IG51bGwsIHJhd1R5cDogbnVsbCwgc3VidHlwS2V5OiBudWxsLCByYXdTdWJ0eXA6IG51bGwgfSk7XG5cbi8vIENvbGxlY3RzIGNoYW5nZXMgdG8gbWFueSBmaWxlcyAocmVuYW1pbmcgYSBUWVAgaW4gbWFueSBub3Rlcywgc3luYykgaW50byBvbmVcbi8vIFwiY2hhbmdlXCIgZXZlbnQuIE5vIHJlc2V0VGltZXIsIHNvIGEgY29uc3RhbnQgc3RyZWFtIHN0aWxsIGdldHMgdGhyb3VnaFxuLy8gcmVndWxhcmx5LlxuY29uc3QgRkxVU0hfREVMQVlfTVMgPSAxMDA7XG5cbmZ1bmN0aW9uIHJhd0l0ZW0odmFsdWUpIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBcIlwiO1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSBcIm9iamVjdFwiID8gSlNPTi5zdHJpbmdpZnkodmFsdWUpIDogU3RyaW5nKHZhbHVlKTtcbn1cblxuLy8gSG93IHRoZSB3aG9sZSBwbHVnaW4gcmVhZHMgYSBUWVAgdmFsdWU6IGRlbGliZXJhdGVseSBOT1Qgbm9ybWFsaXplZCAtIHRoZVxuLy8gcmF3IGZvcm0gaXMgdGhlIGtleS4gQSBUWVAgaXMgZXhhY3RseSBvbmUgY2xlYW4gdmFsdWU7IGFueXRoaW5nIGVsc2UgKHBhZGRlZCxcbi8vIGxvd2VyY2FzZSwgYSBsaXN0IC0gZXZlbiB3aXRoIG9uZSBpdGVtKSBiZWNvbWVzIGl0cyBvd24ga2V5IHRoYXQgbWF0Y2hlcyBub1xuLy8gcmVnaXN0ZXJlZCBUWVA6IG5vIGNvbG9yLCBub3QgY291bnRlZCBmb3IgdGhlIFwicmVhbFwiIFRZUCwgYW5kIGxpc3RlZCBpbiB0aGVcbi8vIFRZUC1QYW5lIGFzIGFuIHVucmVnaXN0ZXJlZCBlbnRyeSB0aGF0IGEgY2xpY2sgY2xlYW5zIHVwIChzZWUgcmVnaXN0ZXJUeXAgaW5cbi8vIHR5cC1wYW5lLmpzKS4gTGlzdHMgc2hvdyBhcyBcIltBLCBCXVwiIGFuZCBuZXZlciBjb2luY2lkZSB3aXRoIGEgdmFsdWUgXCJBLCBCXCIuXG4vLyBudWxsID0gbm8gVFlQIChtaXNzaW5nLCBlbXB0eSwgYmxhbmssIGVtcHR5IGxpc3QpLlxuZnVuY3Rpb24gdHlwS2V5T2YodmFsdWUpIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgY29uc3QgaXRlbXMgPSB2YWx1ZS5tYXAocmF3SXRlbSk7XG4gICAgaWYgKGl0ZW1zLmV2ZXJ5KChpdGVtKSA9PiBpdGVtLnRyaW0oKSA9PT0gXCJcIikpIHJldHVybiBudWxsO1xuICAgIHJldHVybiBgWyR7aXRlbXMuam9pbihcIiwgXCIpfV1gO1xuICB9XG4gIGNvbnN0IHRleHQgPSByYXdJdGVtKHZhbHVlKTtcbiAgcmV0dXJuIHRleHQudHJpbSgpID09PSBcIlwiID8gbnVsbCA6IHRleHQ7XG59XG5cbi8vIE9ic2lkaWFuIHRyZWF0cyBwcm9wZXJ0eSBuYW1lcyBjYXNlLWluc2Vuc2l0aXZlbHkgKFwiU3VidHlwXCIgYW5kIFwiU1VCVFlQXCJcbi8vIGFyZSBvbmUgcHJvcGVydHkgaW4gXCJBbGwgcHJvcGVydGllc1wiKSwgc28gVFlQIGFuZCBTVUJUWVAgYXJlIHJlYWQgdGhlIHNhbWVcbi8vIHdheS4gVGhlIGV4YWN0IHNwZWxsaW5nIHdpbnMgaWYgYSBub3RlICh3cm9uZ2x5KSBoYXMgc2V2ZXJhbC5cbmZ1bmN0aW9uIHByb3BlcnR5S2V5T2YoZnJvbnRtYXR0ZXIsIG5hbWUpIHtcbiAgaWYgKCFmcm9udG1hdHRlcikgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChmcm9udG1hdHRlciwgbmFtZSkpIHJldHVybiBuYW1lO1xuICBjb25zdCBsb3dlciA9IG5hbWUudG9Mb3dlckNhc2UoKTtcbiAgcmV0dXJuIE9iamVjdC5rZXlzKGZyb250bWF0dGVyKS5maW5kKChrZXkpID0+IGtleS50b0xvd2VyQ2FzZSgpID09PSBsb3dlcik7XG59XG5cbmZ1bmN0aW9uIHByb3BlcnR5VmFsdWUoZnJvbnRtYXR0ZXIsIG5hbWUpIHtcbiAgY29uc3Qga2V5ID0gcHJvcGVydHlLZXlPZihmcm9udG1hdHRlciwgbmFtZSk7XG4gIHJldHVybiBrZXkgPT09IHVuZGVmaW5lZCA/IHVuZGVmaW5lZCA6IGZyb250bWF0dGVyW2tleV07XG59XG5cbi8vIFdyaXRlcyB2YWx1ZSB1bmRlciB0aGUgY2Fub25pY2FsIHNwZWxsaW5nIGBuYW1lYCAoZS5nLiBcIlNVQlRZUFwiKSBpbnRvIHRoZVxuLy8gcHJvY2Vzc0Zyb250TWF0dGVyIG9iamVjdC4gQSBkaWZmZXJlbnRseSBzcGVsbGVkIHZhcmlhbnQgKFwiU3VidHlwXCIpIGlzXG4vLyByZW5hbWVkIGluIHBsYWNlIC0gaW5zZXJ0aW9uIG9yZGVyIGlzIFlBTUwgb3JkZXIsIHNvIGFsbCBrZXlzIGFyZSByZS1hZGRlZFxuLy8gaW4gdGhlaXIgb3JkZXIgaWYgbmVlZGVkIChhcyBpbiBmcm9udG1hdHRlci1zb3J0LmpzKS5cbmZ1bmN0aW9uIHNldENhbm9uaWNhbFByb3BlcnR5KGZyb250bWF0dGVyLCBuYW1lLCB2YWx1ZSkge1xuICBjb25zdCBsb3dlciA9IG5hbWUudG9Mb3dlckNhc2UoKTtcbiAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKGZyb250bWF0dGVyKTtcbiAgaWYgKCFrZXlzLnNvbWUoKGtleSkgPT4ga2V5ICE9PSBuYW1lICYmIGtleS50b0xvd2VyQ2FzZSgpID09PSBsb3dlcikpIHtcbiAgICBmcm9udG1hdHRlcltuYW1lXSA9IHZhbHVlO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBzbmFwc2hvdCA9IHsgLi4uZnJvbnRtYXR0ZXIgfTtcbiAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykgZGVsZXRlIGZyb250bWF0dGVyW2tleV07XG4gIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICBpZiAoa2V5LnRvTG93ZXJDYXNlKCkgIT09IGxvd2VyKSBmcm9udG1hdHRlcltrZXldID0gc25hcHNob3Rba2V5XTtcbiAgICBlbHNlIGlmICghKG5hbWUgaW4gZnJvbnRtYXR0ZXIpKSBmcm9udG1hdHRlcltuYW1lXSA9IHZhbHVlO1xuICB9XG59XG5cbi8vIFJlbW92ZXMgYG5hbWVgIGluIGFueSBzcGVsbGluZyBmcm9tIHRoZSBwcm9jZXNzRnJvbnRNYXR0ZXIgb2JqZWN0LlxuZnVuY3Rpb24gZGVsZXRlUHJvcGVydHkoZnJvbnRtYXR0ZXIsIG5hbWUpIHtcbiAgY29uc3QgbG93ZXIgPSBuYW1lLnRvTG93ZXJDYXNlKCk7XG4gIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGZyb250bWF0dGVyKSkge1xuICAgIGlmIChrZXkudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXIpIGRlbGV0ZSBmcm9udG1hdHRlcltrZXldO1xuICB9XG59XG5cbi8vIFNVQlRZUCBpcyByZWFkIHRoZSBzYW1lIHdheSAodHlwS2V5T2YpOiBhdCBtb3N0IG9uZSBjbGVhbiB2YWx1ZSBwZXIgbm90ZSxcbi8vIGFueXRoaW5nIGVsc2UgaXMgaXRzIG93biB1bnJlZ2lzdGVyZWQga2V5LlxuZnVuY3Rpb24gc2FtZUVudHJ5KGEsIGIpIHtcbiAgcmV0dXJuICEhYSAmJiAhIWIgJiYgYS50eXBLZXkgPT09IGIudHlwS2V5ICYmIGEuc3VidHlwS2V5ID09PSBiLnN1YnR5cEtleTtcbn1cblxuLy8gQ2VudHJhbCBUWVAvU1VCVFlQIGluZGV4IG92ZXIgYWxsIG1hcmtkb3duIGZpbGVzIChwYXRoIC0+IHZhbHVlcykuXG4vL1xuLy8gbWV0YWRhdGFDYWNoZSBcImNoYW5nZWRcIi9cInJlc29sdmVkXCIgZmlyZSBvbiBFVkVSWSBlZGl0IHRvIGFueSBub3RlIChhYm91dFxuLy8gZXZlcnkgdHdvIHNlY29uZHMgd2hpbGUgdHlwaW5nKS4gVGhlIGluZGV4IGNvbXBhcmVzIHBlciBmaWxlIHdoZXRoZXIgVFlQIG9yXG4vLyBTVUJUWVAgcmVhbGx5IGNoYW5nZWQgKG9yIGEgbm90ZSBhcHBlYXJlZC9kaXNhcHBlYXJlZCkgYW5kIG9ubHkgdGhlbiBmaXJlc1xuLy8gaXRzIG93biBcImNoYW5nZVwiIGV2ZW50IChhcmd1bWVudDogc2V0IG9mIGFmZmVjdGVkIHBhdGhzKS4gQWxsIGNvbG9yaW5nIGhhbmdzXG4vLyBvbiB0aGlzIGV2ZW50LCBzbyBub3JtYWwgdHlwaW5nIHRyaWdnZXJzIG5vIHJlY29sb3JpbmcuXG4vL1xuLy8gSXQgYWxzbyBjYWNoZXMgdGhlIHZhdWx0LXdpZGUgY291bnRzIChUWVAtTGlzdCwgU3VidHlwIGxpc3QsIHBpY2tlcnMsXG4vLyBnZXRUeXBzKCkpIGluc3RlYWQgb2YgcmVzY2FubmluZyBldmVyeSBub3RlIG9uIGVhY2ggY2FsbC5cbmNsYXNzIFR5cEluZGV4IGV4dGVuZHMgRXZlbnRzIHtcbiAgY29uc3RydWN0b3IocGx1Z2luKSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgICB0aGlzLmFwcCA9IHBsdWdpbi5hcHA7XG4gICAgdGhpcy5lbnRyaWVzID0gbmV3IE1hcCgpO1xuICAgIHRoaXMuYnVpbHQgPSBmYWxzZTtcbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsO1xuICAgIHRoaXMucGVuZGluZ1BhdGhzID0gbmV3IFNldCgpO1xuICAgIHRoaXMuZmx1c2ggPSBkZWJvdW5jZSgoKSA9PiB7XG4gICAgICBjb25zdCBwYXRocyA9IHRoaXMucGVuZGluZ1BhdGhzO1xuICAgICAgdGhpcy5wZW5kaW5nUGF0aHMgPSBuZXcgU2V0KCk7XG4gICAgICB0aGlzLnRyaWdnZXIoXCJjaGFuZ2VcIiwgcGF0aHMpO1xuICAgIH0sIEZMVVNIX0RFTEFZX01TKTtcbiAgfVxuXG4gIHJlZ2lzdGVyKCkge1xuICAgIGNvbnN0IHsgcGx1Z2luLCBhcHAgfSA9IHRoaXM7XG4gICAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoYXBwLm1ldGFkYXRhQ2FjaGUub24oXCJjaGFuZ2VkXCIsIChmaWxlKSA9PiB0aGlzLnVwZGF0ZShmaWxlKSkpO1xuICAgIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC5tZXRhZGF0YUNhY2hlLm9uKFwiZGVsZXRlZFwiLCAoZmlsZSkgPT4gdGhpcy5yZW1vdmUoZmlsZS5wYXRoKSkpO1xuICAgIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC52YXVsdC5vbihcInJlbmFtZVwiLCAoZmlsZSwgb2xkUGF0aCkgPT4gdGhpcy5yZW5hbWUoZmlsZSwgb2xkUGF0aCkpKTtcbiAgICAvLyBcIkV4Y2x1ZGVkIGZpbGVzXCIgY2hhbmdlZDogdGhlIGVudHJpZXMgc3RheSB2YWxpZCwgb25seSB0aGUgZmlsdGVyZWRcbiAgICAvLyBjb3VudHMgZG9uJ3QuXG4gICAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoYXBwLnZhdWx0Lm9uKFwiY29uZmlnLWNoYW5nZWRcIiwgKCkgPT4gKHRoaXMuYWdncmVnYXRlcyA9IG51bGwpKSk7XG5cbiAgICAvLyBBdCBzdGFydHVwIHRoZSBmaXJzdCAobGF6eSkgYWNjZXNzIGNhbiBjb21lIGJlZm9yZSB0aGUgbWV0YWRhdGEgY2FjaGUgaXNcbiAgICAvLyBmdWxseSBsb2FkZWQuIFJlYnVpbGQgb25jZSBhZnRlciBpdHMgZmlyc3QgY29tcGxldGUgcmVzb2x2ZTsgZGlmZmVyZW5jZXNcbiAgICAvLyBnbyBvdXQgdGhyb3VnaCB0aGUgXCJjaGFuZ2VcIiBldmVudCBsaWtlIGFueSBvdGhlciBjaGFuZ2UuXG4gICAgY29uc3QgcmVzb2x2ZWRSZWYgPSBhcHAubWV0YWRhdGFDYWNoZS5vbihcInJlc29sdmVkXCIsICgpID0+IHtcbiAgICAgIGFwcC5tZXRhZGF0YUNhY2hlLm9mZnJlZihyZXNvbHZlZFJlZik7XG4gICAgICB0aGlzLnJlYnVpbGQoKTtcbiAgICB9KTtcbiAgICBwbHVnaW4ucmVnaXN0ZXJFdmVudChyZXNvbHZlZFJlZik7XG5cbiAgICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4gdGhpcy5mbHVzaC5jYW5jZWwoKSk7XG4gIH1cblxuICByZWFkKGZpbGUpIHtcbiAgICBjb25zdCBmcm9udG1hdHRlciA9IHRoaXMuYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0RmlsZUNhY2hlKGZpbGUpPy5mcm9udG1hdHRlcjtcbiAgICBjb25zdCByYXdUeXAgPSBwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBUWVBfUFJPUEVSVFkpID8/IG51bGw7XG4gICAgY29uc3QgcmF3U3VidHlwID0gcHJvcGVydHlWYWx1ZShmcm9udG1hdHRlciwgU1VCVFlQX1BST1BFUlRZKSA/PyBudWxsO1xuICAgIHJldHVybiB7IHR5cEtleTogdHlwS2V5T2YocmF3VHlwKSwgcmF3VHlwLCBzdWJ0eXBLZXk6IHR5cEtleU9mKHJhd1N1YnR5cCksIHJhd1N1YnR5cCB9O1xuICB9XG5cbiAgZW5zdXJlQnVpbHQoKSB7XG4gICAgaWYgKCF0aGlzLmJ1aWx0KSB0aGlzLnJlYnVpbGQoKTtcbiAgfVxuXG4gIHJlYnVpbGQoKSB7XG4gICAgY29uc3QgcHJldmlvdXMgPSB0aGlzLmVudHJpZXM7XG4gICAgY29uc3Qgd2FzQnVpbHQgPSB0aGlzLmJ1aWx0O1xuICAgIHRoaXMuZW50cmllcyA9IG5ldyBNYXAoKTtcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpKSB0aGlzLmVudHJpZXMuc2V0KGZpbGUucGF0aCwgdGhpcy5yZWFkKGZpbGUpKTtcbiAgICB0aGlzLmJ1aWx0ID0gdHJ1ZTtcbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsO1xuICAgIGlmICghd2FzQnVpbHQpIHJldHVybjtcblxuICAgIGZvciAoY29uc3QgW3BhdGgsIGVudHJ5XSBvZiB0aGlzLmVudHJpZXMpIHtcbiAgICAgIGlmICghc2FtZUVudHJ5KHByZXZpb3VzLmdldChwYXRoKSwgZW50cnkpKSB0aGlzLnBlbmRpbmdQYXRocy5hZGQocGF0aCk7XG4gICAgfVxuICAgIGZvciAoY29uc3QgcGF0aCBvZiBwcmV2aW91cy5rZXlzKCkpIHtcbiAgICAgIGlmICghdGhpcy5lbnRyaWVzLmhhcyhwYXRoKSkgdGhpcy5wZW5kaW5nUGF0aHMuYWRkKHBhdGgpO1xuICAgIH1cbiAgICBpZiAodGhpcy5wZW5kaW5nUGF0aHMuc2l6ZSA+IDApIHRoaXMuZmx1c2goKTtcbiAgfVxuXG4gIG1hcmtDaGFuZ2VkKHBhdGgpIHtcbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSBudWxsO1xuICAgIHRoaXMucGVuZGluZ1BhdGhzLmFkZChwYXRoKTtcbiAgICB0aGlzLmZsdXNoKCk7XG4gIH1cblxuICB1cGRhdGUoZmlsZSkge1xuICAgIC8vIEJlZm9yZSB0aGUgZmlyc3QgYWNjZXNzIHRoZXJlIGlzIG5vdGhpbmcgc3RhbGU7IHRoZSBsYXp5IGJ1aWxkIHJlYWRzXG4gICAgLy8gZnJlc2ggZnJvbSB0aGUgY2FjaGUgYW55d2F5LlxuICAgIGlmICghdGhpcy5idWlsdCB8fCAhKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkgfHwgZmlsZS5leHRlbnNpb24gIT09IFwibWRcIikgcmV0dXJuO1xuICAgIGNvbnN0IG5leHQgPSB0aGlzLnJlYWQoZmlsZSk7XG4gICAgaWYgKHNhbWVFbnRyeSh0aGlzLmVudHJpZXMuZ2V0KGZpbGUucGF0aCksIG5leHQpKSByZXR1cm47XG4gICAgdGhpcy5lbnRyaWVzLnNldChmaWxlLnBhdGgsIG5leHQpO1xuICAgIHRoaXMubWFya0NoYW5nZWQoZmlsZS5wYXRoKTtcbiAgfVxuXG4gIHJlbW92ZShwYXRoKSB7XG4gICAgaWYgKCF0aGlzLmJ1aWx0IHx8ICF0aGlzLmVudHJpZXMuZGVsZXRlKHBhdGgpKSByZXR1cm47XG4gICAgdGhpcy5tYXJrQ2hhbmdlZChwYXRoKTtcbiAgfVxuXG4gIHJlbmFtZShmaWxlLCBvbGRQYXRoKSB7XG4gICAgaWYgKCF0aGlzLmJ1aWx0KSByZXR1cm47XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLmVudHJpZXMuZ2V0KG9sZFBhdGgpO1xuICAgIGlmIChlbnRyeSkge1xuICAgICAgdGhpcy5lbnRyaWVzLmRlbGV0ZShvbGRQYXRoKTtcbiAgICAgIHRoaXMubWFya0NoYW5nZWQob2xkUGF0aCk7XG4gICAgfVxuICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZpbGUgJiYgZmlsZS5leHRlbnNpb24gPT09IFwibWRcIikge1xuICAgICAgdGhpcy5lbnRyaWVzLnNldChmaWxlLnBhdGgsIGVudHJ5ID8/IHRoaXMucmVhZChmaWxlKSk7XG4gICAgICB0aGlzLm1hcmtDaGFuZ2VkKGZpbGUucGF0aCk7XG4gICAgfVxuICB9XG5cbiAgZW50cnlGb3IoZmlsZSkge1xuICAgIGlmICghZmlsZSkgcmV0dXJuIEVNUFRZX0VOVFJZO1xuICAgIHRoaXMuZW5zdXJlQnVpbHQoKTtcbiAgICByZXR1cm4gdGhpcy5lbnRyaWVzLmdldChmaWxlLnBhdGgpID8/IEVNUFRZX0VOVFJZO1xuICB9XG5cbiAgLy8gVFlQIGtleSAoc2VlIHR5cEtleU9mKSBvciBudWxsOyBmb3IgYSBjbGVhbiB2YWx1ZSBzaW1wbHkgdGhlIFRZUCBuYW1lLlxuICB0eXBPZihmaWxlKSB7XG4gICAgcmV0dXJuIHRoaXMuZW50cnlGb3IoZmlsZSkudHlwS2V5O1xuICB9XG5cbiAgLy8gU1VCVFlQIGtleSAoc2VlIHR5cEtleU9mKSBvciBudWxsLlxuICBzdWJ0eXBPZihmaWxlKSB7XG4gICAgcmV0dXJuIHRoaXMuZW50cnlGb3IoZmlsZSkuc3VidHlwS2V5O1xuICB9XG5cbiAgLy8gQW4gYWN0dWFsIGZyb250bWF0dGVyIHZhbHVlIGZvciBhIGtleSAtIGZvciBkaXNwbGF5LCBzZWFyY2ggYW5kIGNsZWFuaW5nXG4gIC8vIHVwIHVucmVnaXN0ZXJlZCBlbnRyaWVzIChhbGwgbm90ZXMgb2YgYSBrZXkgc2hhcmUgdGhlIHNhbWUgcmF3IGZvcm0pLlxuICByYXdWYWx1ZU9mKHR5cEtleSkge1xuICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZSgpLnJhd0J5S2V5LmdldCh0eXBLZXkpO1xuICB9XG5cbiAgLy8gQ2xlYW4gPSBhIHNpbmdsZSB2YWx1ZSB3aXRob3V0IHBhZGRpbmcuIExvd2VyY2FzZSBjb3VudHMgYXMgY2xlYW4gKGEgdmFsaWRcbiAgLy8gVFlQIG5hbWUsIGp1c3Qgbm90IHJlZ2lzdGVyZWQgeWV0KTsgbGlzdHMgYW5kIHBhZGRpbmcgZG9uJ3QuXG4gIGlzQ2xlYW5LZXkodHlwS2V5KSB7XG4gICAgY29uc3QgcmF3ID0gdGhpcy5yYXdWYWx1ZU9mKHR5cEtleSk7XG4gICAgcmV0dXJuIHJhdyAhPT0gdW5kZWZpbmVkICYmICFBcnJheS5pc0FycmF5KHJhdykgJiYgdHlwS2V5ID09PSB0eXBLZXkudHJpbSgpO1xuICB9XG5cbiAgLy8gRmlsZXMgd2l0aCBleGFjdGx5IHRoaXMgVFlQIGtleSwgaG9ub3JpbmcgdGhlIGV4Y2x1ZGVkLWZpbGVzIHNldHRpbmcuXG4gIGZpbGVzV2l0aFR5cCh0eXBLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5maWxlc01hdGNoaW5nKChlbnRyeSkgPT4gZW50cnkudHlwS2V5ID09PSB0eXBLZXkpO1xuICB9XG5cbiAgLy8gRmlsZXMgd2l0aCBleGFjdGx5IHRoaXMgVFlQIGFuZCBTVUJUWVAga2V5LlxuICBmaWxlc1dpdGhTdWJ0eXAodHlwS2V5LCBzdWJ0eXBLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5maWxlc01hdGNoaW5nKChlbnRyeSkgPT4gZW50cnkudHlwS2V5ID09PSB0eXBLZXkgJiYgZW50cnkuc3VidHlwS2V5ID09PSBzdWJ0eXBLZXkpO1xuICB9XG5cbiAgZmlsZXNNYXRjaGluZyhwcmVkaWNhdGUpIHtcbiAgICB0aGlzLmVuc3VyZUJ1aWx0KCk7XG4gICAgY29uc3QgaW5jbHVkZUlnbm9yZWQgPSAhIXRoaXMucGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXM7XG4gICAgY29uc3QgZmlsZXMgPSBbXTtcbiAgICBmb3IgKGNvbnN0IFtwYXRoLCBlbnRyeV0gb2YgdGhpcy5lbnRyaWVzKSB7XG4gICAgICBpZiAoIXByZWRpY2F0ZShlbnRyeSkpIGNvbnRpbnVlO1xuICAgICAgaWYgKCFpbmNsdWRlSWdub3JlZCAmJiB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmlzVXNlcklnbm9yZWQocGF0aCkpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChwYXRoKTtcbiAgICAgIGlmIChmaWxlIGluc3RhbmNlb2YgVEZpbGUpIGZpbGVzLnB1c2goZmlsZSk7XG4gICAgfVxuICAgIHJldHVybiBmaWxlcztcbiAgfVxuXG4gIC8vIEhvbm9ycyBPYnNpZGlhbidzIFwiRXhjbHVkZWQgZmlsZXNcIiAod2hlcmUgSGlkZSBGb2xkZXJzIGFsc28gcHV0cyBoaWRkZW5cbiAgLy8gZm9sZGVycykgdW5sZXNzIFwiSW5jbHVkZSBleGNsdWRlZCBmaWxlc1wiIGlzIG9uLiBBIG5vdGUgd2l0aG91dCBhIFRZUCBoYXNcbiAgLy8gbm8gU1VCVFlQIGNvbnRleHQuXG4gIGFnZ3JlZ2F0ZSgpIHtcbiAgICB0aGlzLmVuc3VyZUJ1aWx0KCk7XG4gICAgY29uc3QgaW5jbHVkZUlnbm9yZWQgPSAhIXRoaXMucGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXM7XG4gICAgaWYgKHRoaXMuYWdncmVnYXRlcz8uaW5jbHVkZUlnbm9yZWQgPT09IGluY2x1ZGVJZ25vcmVkKSByZXR1cm4gdGhpcy5hZ2dyZWdhdGVzO1xuXG4gICAgY29uc3QgY291bnRzID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IHJhd0J5S2V5ID0gbmV3IE1hcCgpO1xuICAgIGNvbnN0IHN1YnR5cHNCeVR5cCA9IG5ldyBNYXAoKTtcbiAgICBsZXQgbm9UeXAgPSAwO1xuICAgIGZvciAoY29uc3QgW3BhdGgsIHsgdHlwS2V5LCByYXdUeXAsIHN1YnR5cEtleSwgcmF3U3VidHlwIH1dIG9mIHRoaXMuZW50cmllcykge1xuICAgICAgaWYgKCFpbmNsdWRlSWdub3JlZCAmJiB0aGlzLmFwcC5tZXRhZGF0YUNhY2hlLmlzVXNlcklnbm9yZWQocGF0aCkpIGNvbnRpbnVlO1xuICAgICAgaWYgKHR5cEtleSA9PT0gbnVsbCkge1xuICAgICAgICBub1R5cCsrO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvdW50cy5zZXQodHlwS2V5LCAoY291bnRzLmdldCh0eXBLZXkpID8/IDApICsgMSk7XG4gICAgICBpZiAoIXJhd0J5S2V5Lmhhcyh0eXBLZXkpKSByYXdCeUtleS5zZXQodHlwS2V5LCByYXdUeXApO1xuICAgICAgbGV0IGJ1Y2tldCA9IHN1YnR5cHNCeVR5cC5nZXQodHlwS2V5KTtcbiAgICAgIGlmICghYnVja2V0KSB7XG4gICAgICAgIGJ1Y2tldCA9IHsgY291bnRzOiBuZXcgTWFwKCksIG5vU3VidHlwOiAwLCByYXdCeUtleTogbmV3IE1hcCgpIH07XG4gICAgICAgIHN1YnR5cHNCeVR5cC5zZXQodHlwS2V5LCBidWNrZXQpO1xuICAgICAgfVxuICAgICAgaWYgKHN1YnR5cEtleSA9PT0gbnVsbCkge1xuICAgICAgICBidWNrZXQubm9TdWJ0eXArKztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGJ1Y2tldC5jb3VudHMuc2V0KHN1YnR5cEtleSwgKGJ1Y2tldC5jb3VudHMuZ2V0KHN1YnR5cEtleSkgPz8gMCkgKyAxKTtcbiAgICAgICAgaWYgKCFidWNrZXQucmF3QnlLZXkuaGFzKHN1YnR5cEtleSkpIGJ1Y2tldC5yYXdCeUtleS5zZXQoc3VidHlwS2V5LCByYXdTdWJ0eXApO1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmFnZ3JlZ2F0ZXMgPSB7IGluY2x1ZGVJZ25vcmVkLCBjb3VudHMsIG5vVHlwLCByYXdCeUtleSwgc3VidHlwc0J5VHlwIH07XG4gICAgcmV0dXJuIHRoaXMuYWdncmVnYXRlcztcbiAgfVxuXG4gIC8vIENhY2hlZCAtIGRvbid0IG1vZGlmeSB0aGUgcmV0dXJuZWQgbWFwcy5cbiAgdHlwQ291bnRzKCkge1xuICAgIGNvbnN0IHsgY291bnRzLCBub1R5cCB9ID0gdGhpcy5hZ2dyZWdhdGUoKTtcbiAgICByZXR1cm4geyBjb3VudHMsIG5vVHlwIH07XG4gIH1cblxuICAvLyBUWVAgLT4geyBjb3VudHM6IE1hcChTVUJUWVAga2V5IC0+IGNvdW50KSwgbm9TdWJ0eXAsIHJhd0J5S2V5IH0uXG4gIC8vIENhY2hlZCAtIGRvbid0IG1vZGlmeS5cbiAgc3VidHlwQ291bnRzKCkge1xuICAgIHJldHVybiB0aGlzLmFnZ3JlZ2F0ZSgpLnN1YnR5cHNCeVR5cDtcbiAgfVxuXG4gIHN1YnR5cEJ1Y2tldCh0eXBLZXkpIHtcbiAgICByZXR1cm4gdGhpcy5zdWJ0eXBDb3VudHMoKS5nZXQodHlwS2V5KSA/PyBFTVBUWV9CVUNLRVQ7XG4gIH1cbn1cblxuY29uc3QgRU1QVFlfQlVDS0VUID0gT2JqZWN0LmZyZWV6ZSh7IGNvdW50czogbmV3IE1hcCgpLCBub1N1YnR5cDogMCwgcmF3QnlLZXk6IG5ldyBNYXAoKSB9KTtcblxubW9kdWxlLmV4cG9ydHMgPSB7IFR5cEluZGV4LCB0eXBLZXlPZiwgcHJvcGVydHlWYWx1ZSwgc2V0Q2Fub25pY2FsUHJvcGVydHksIGRlbGV0ZVByb3BlcnR5LCBUWVBfUFJPUEVSVFksIFNVQlRZUF9QUk9QRVJUWSB9O1xuIiwgImNvbnN0IHsgdHlwS2V5T2YsIHByb3BlcnR5VmFsdWUsIHNldENhbm9uaWNhbFByb3BlcnR5LCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcblxuLy8gU3VidHlwIG5hbWVzIGFyZSB0aXRsZSBjYXNlIHBlciB3b3JkICh1bmxpa2UgVFlQIG5hbWVzLCBzZWVcbi8vIG5vcm1hbGl6ZVR5cE5hbWUpOiBcImt1cnogR0VTQ0hJQ0hURVwiIC0+IFwiS3VyeiBHZXNjaGljaHRlXCIuIFRoZSBTVUJUWVBcbi8vIHByb3BlcnR5IGl0c2VsZiBzdGF5cyB1cHBlcmNhc2UuIFwiZGVcIiBsb2NhbGUgYmVjYXVzZSB0aGUgbmFtZXMgYXJlIEdlcm1hbi5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVN1YnR5cE5hbWUocmF3KSB7XG4gIHJldHVybiByYXcudHJpbSgpLnJlcGxhY2UoL1xcUysvZywgKHdvcmQpID0+IHdvcmQuY2hhckF0KDApLnRvTG9jYWxlVXBwZXJDYXNlKFwiZGVcIikgKyB3b3JkLnNsaWNlKDEpLnRvTG9jYWxlTG93ZXJDYXNlKFwiZGVcIikpO1xufVxuXG4vLyBSZWdpc3RlcmVkIFN1YnR5cHMgcGVyIFRZUCAoc2V0dGluZ3MudHlwU3VidHlwcyk6XG4vLyAgIHsgW1RZUF06IHsgW1NVQlRZUF06IHsgZnJvbnRtYXR0ZXI6IHsuLi59LCBmbG9hdGluZ0tleXM6IFsuLi5dLCBzaG9ydGN1dHM6IHsuLi59LCBtYW51YWw/OiBmYWxzZSB9IH0gfVxuLy8gQSBTdWJ0eXAgYmVsb25ncyB0byBleGFjdGx5IG9uZSBUWVAsIHRob3VnaCB0aGUgc2FtZSBuYW1lIG1heSBhbHNvIGV4aXN0XG4vLyB1bmRlciBhbm90aGVyIFRZUC4gS2V5IG9yZGVyIGlzIHRoZSBibG9jayBvcmRlciBpbiB0aGUgVFlQLVBhbmUsIGFsd2F5c1xuLy8gYmVsb3cgdGhlIFRZUC1Gcm9udG1hdHRlci4gZnJvbnRtYXR0ZXIgYWRkcyB0byBvciBvdmVycmlkZXMgdGhlXG4vLyBUWVAtRnJvbnRtYXR0ZXI7IGZsb2F0aW5nS2V5cyBhbmQgc2hvcnRjdXRzIHdvcmsgbGlrZSB0eXBGbG9hdGluZ0tleXMgYW5kXG4vLyB0eXBTaG9ydGN1dHMuIE9sZGVyIGRhdGEgbGFja3Mgc2hvcnRjdXRzLCBzbyByZWFkZXJzIHRyZWF0IGl0IGFzIG9wdGlvbmFsLlxuLy8gbWFudWFsIHdvcmtzIGxpa2UgdHlwTWFudWFsOiBvbmx5IHRoZSBkZXZpYXRpb24gKGZhbHNlKSBpcyBzdG9yZWQuXG4vL1xuLy8gVGhlIHNhbWUga2V5IG1heSBhcHBlYXIgaW4gc2V2ZXJhbCBibG9ja3Mgb2Ygb25lIFRZUCAob25seSB3aXRoaW4gT05FIGJsb2NrXG4vLyBpcyBpdCBuZWNlc3NhcmlseSB1bmlxdWUpOlxuLy8gICAtIGluIHR3byBTdWJ0eXAgYmxvY2tzOiBubyBjb25mbGljdCwgYSBub3RlIGhhcyBhdCBtb3N0IG9uZSBTVUJUWVA7XG4vLyAgIC0gaW4gdGhlIFRZUC1Gcm9udG1hdHRlciBBTkQgYSBTdWJ0eXAgYmxvY2s6IHRoZSBTdWJ0eXAgb3ZlcnJpZGVzIHZhbHVlXG4vLyAgICAgYW5kIGZsb2F0aW5nIGZsYWcsIHRoZSByb3cga2VlcHMgdGhlIFRZUC1Gcm9udG1hdHRlciBwb3NpdGlvbi4gZ2V0VHlwRGVmYXVsdHNcbi8vICAgICAobWFpbi5qcykgYW5kIG9yZGVyZWREZWZhdWx0S2V5cyAoZnJvbnRtYXR0ZXItc29ydC5qcykgbXVzdCB1c2UgdGhlIHNhbWVcbi8vICAgICBydWxlLCBvciBzb3J0aW5nIHdvdWxkIHJlLXNvcnQgYSBmcmVzaGx5IGNyZWF0ZWQgbm90ZSByaWdodCBhd2F5LlxuXG4vLyBcIlN0aWxsIHRvIGJlIGZpbGxlZFwiOiB3aGVuIHR3byBibG9ja3Mgb3IgdHdvIHByb3BlcnRpZXMgbWVyZ2UsIHN1Y2ggYSB2YWx1ZVxuLy8gaXMgZmlsbGVkIGZyb20gdGhlIG90aGVyIGluc3RlYWQgb2Ygb3ZlcndyaXRpbmcgdGhlIGV4aXN0aW5nIGVudHJ5IChzZWVcbi8vIG1lcmdlU3VidHlwcyBoZXJlIGFuZCByZW5hbWVJblN0b3JlIGluIHByb3BlcnR5LXJlbmFtZS1zeW5jLmpzKS5cbmZ1bmN0aW9uIGlzRW1wdHlWYWx1ZSh2YWx1ZSkge1xuICByZXR1cm4gdmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gXCJcIjtcbn1cblxuZnVuY3Rpb24gZ2V0U3VidHlwTmFtZXMoc2V0dGluZ3MsIHR5cCkge1xuICByZXR1cm4gT2JqZWN0LmtleXMoc2V0dGluZ3MudHlwU3VidHlwcz8uW3R5cF0gPz8ge30pO1xufVxuXG5mdW5jdGlvbiBnZXRTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgc3VidHlwKSB7XG4gIHJldHVybiBzZXR0aW5ncy50eXBTdWJ0eXBzPy5bdHlwXT8uW3N1YnR5cF0gPz8gbnVsbDtcbn1cblxuZnVuY3Rpb24gZW5zdXJlU3VidHlwKHNldHRpbmdzLCB0eXAsIHN1YnR5cCkge1xuICBpZiAoIXNldHRpbmdzLnR5cFN1YnR5cHMpIHNldHRpbmdzLnR5cFN1YnR5cHMgPSB7fTtcbiAgaWYgKCFzZXR0aW5ncy50eXBTdWJ0eXBzW3R5cF0pIHNldHRpbmdzLnR5cFN1YnR5cHNbdHlwXSA9IHt9O1xuICBjb25zdCBieU5hbWUgPSBzZXR0aW5ncy50eXBTdWJ0eXBzW3R5cF07XG4gIGlmICghYnlOYW1lW3N1YnR5cF0pIHtcbiAgICBieU5hbWVbc3VidHlwXSA9IHsgZnJvbnRtYXR0ZXI6IHt9LCBmbG9hdGluZ0tleXM6IFtdLCBzaG9ydGN1dHM6IHt9IH07XG4gICAgLy8gQSBuZXcgU3VidHlwIG9mIGEgVFlQIHRoYXQgaXNuJ3QgbWFudWFsbHkgY3JlYXRhYmxlIGlzbid0IGVpdGhlciAoc2VlXG4gICAgLy8gaXNTdWJ0eXBNYW51YWwpLlxuICAgIGlmIChzZXR0aW5ncy50eXBNYW51YWw/Llt0eXBdID09PSBmYWxzZSkgYnlOYW1lW3N1YnR5cF0ubWFudWFsID0gZmFsc2U7XG4gIH1cbiAgcmV0dXJuIGJ5TmFtZVtzdWJ0eXBdO1xufVxuXG4vKiAtLS0gXCJNYW51YWxseSBjcmVhdGFibGVcIiBwZXIgU3VidHlwIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICogTGlrZSB0eXBNYW51YWwgZm9yIFRZUCBlbnRyaWVzOiBvbmx5IHN3aXRjaGluZyBvZmYgaXMgc3RvcmVkXG4gKiAobWFudWFsOiBmYWxzZSk7IG5vIGVudHJ5IG9yIHRydWUgbWVhbnMgb24uIERlY2lkZXMgd2hldGhlciB0aGUgU3VidHlwXG4gKiBzaG93cyB1cCBpbiBnZXRTdWJ0eXBzKCkgKG1haW4uanMpIGFuZCB0aHVzIGluIHRoZSBTdWJ0eXAtUGlja2VyLlxuICpcbiAqIFRZUCBhbmQgU3VidHlwIGFyZSBsaW5rZWQsIGJlY2F1c2UgdGhlIHBpY2tlciBvbmx5IHJlYWNoZXMgYSBTdWJ0eXAgdGhyb3VnaFxuICogaXRzIFRZUDogc3dpdGNoaW5nIGEgVFlQIG9mZiBzd2l0Y2hlcyBhbGwgaXRzIFN1YnR5cHMgb2ZmLCBzd2l0Y2hpbmcgaXQgb25cbiAqIHN3aXRjaGVzIHRoZW0gYWxsIG9uIChzZXRBbGxTdWJ0eXBzTWFudWFsKSwgYW5kIHN3aXRjaGluZyBhIHNpbmdsZSBTdWJ0eXAgb25cbiAqIGFsc28gc3dpdGNoZXMgaXRzIFRZUCBvbiwgbGVhdmluZyB0aGUgb3RoZXIgU3VidHlwcyBhbG9uZSAoc2VlXG4gKiByZW5kZXJTdWJ0eXBNYW51YWxUb2dnbGUgaW4gdHlwLXBhbmUuanMpLiBTbyBhIFN1YnR5cCBpcyBvbmx5IGV2ZXIgbWFudWFsbHlcbiAqIGNyZWF0YWJsZSBpZiBpdHMgVFlQIGlzLlxuICogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5mdW5jdGlvbiBpc1N1YnR5cE1hbnVhbChzZXR0aW5ncywgdHlwLCBzdWJ0eXApIHtcbiAgcmV0dXJuIGdldFN1YnR5cChzZXR0aW5ncywgdHlwLCBzdWJ0eXApPy5tYW51YWwgIT09IGZhbHNlO1xufVxuXG5mdW5jdGlvbiBzZXRTdWJ0eXBNYW51YWwoc2V0dGluZ3MsIHR5cCwgc3VidHlwLCBvbikge1xuICBjb25zdCBkYXRhID0gZ2V0U3VidHlwKHNldHRpbmdzLCB0eXAsIHN1YnR5cCk7XG4gIGlmICghZGF0YSkgcmV0dXJuO1xuICBpZiAob24pIGRlbGV0ZSBkYXRhLm1hbnVhbDtcbiAgZWxzZSBkYXRhLm1hbnVhbCA9IGZhbHNlO1xufVxuXG5mdW5jdGlvbiBzZXRBbGxTdWJ0eXBzTWFudWFsKHNldHRpbmdzLCB0eXAsIG9uKSB7XG4gIGZvciAoY29uc3Qgc3VidHlwIG9mIGdldFN1YnR5cE5hbWVzKHNldHRpbmdzLCB0eXApKSBzZXRTdWJ0eXBNYW51YWwoc2V0dGluZ3MsIHR5cCwgc3VidHlwLCBvbik7XG59XG5cbi8vIFdoZW4gYSBUWVAgaXMgcmVuYW1lZCwgaXRzIFN1YnR5cHMgbW92ZSB0byB0aGUgbmV3IG5hbWUuXG5mdW5jdGlvbiBtb3ZlVHlwU3VidHlwcyhzZXR0aW5ncywgb2xkVHlwLCBuZXdUeXApIHtcbiAgaWYgKCFzZXR0aW5ncy50eXBTdWJ0eXBzPy5bb2xkVHlwXSkgcmV0dXJuO1xuICBzZXR0aW5ncy50eXBTdWJ0eXBzW25ld1R5cF0gPSBzZXR0aW5ncy50eXBTdWJ0eXBzW29sZFR5cF07XG4gIGRlbGV0ZSBzZXR0aW5ncy50eXBTdWJ0eXBzW29sZFR5cF07XG59XG5cbmZ1bmN0aW9uIGRlbGV0ZVR5cFN1YnR5cHMoc2V0dGluZ3MsIHR5cCkge1xuICBpZiAoc2V0dGluZ3MudHlwU3VidHlwcykgZGVsZXRlIHNldHRpbmdzLnR5cFN1YnR5cHNbdHlwXTtcbn1cblxuLy8gTWVyZ2luZyB0d28gVFlQIGVudHJpZXM6IFN1YnR5cHMgb25seSBpbiBzb3VyY2UgbW92ZSBvdmVyLiBCbG9ja3Mgd2l0aCB0aGVcbi8vIHNhbWUgbmFtZSBhcmUgY29tYmluZWQgLSBmb3IgYSBzaGFyZWQga2V5IHRoZSB0YXJnZXQncyB2YWx1ZSBhbmQgZmxvYXRpbmdcbi8vIGZsYWcgd2luLCBrZXlzIG9ubHkgaW4gc291cmNlIGFyZSBhcHBlbmRlZC4gQSBtb3ZlZCBrZXkgdGhhdCBpcyBhbHNvIGluIHRoZVxuLy8gdGFyZ2V0J3MgVFlQLUZyb250bWF0dGVyIHN0YXlzIGluIGJvdGgsIHdoaWNoIGlzIHRoZSBub3JtYWwgb3ZlcnJpZGUuXG5mdW5jdGlvbiBtZXJnZVR5cFN1YnR5cHMoc2V0dGluZ3MsIHNvdXJjZSwgdGFyZ2V0KSB7XG4gIGNvbnN0IHNvdXJjZVN1YnR5cHMgPSBzZXR0aW5ncy50eXBTdWJ0eXBzPy5bc291cmNlXTtcbiAgaWYgKCFzb3VyY2VTdWJ0eXBzKSByZXR1cm47XG4gIGZvciAoY29uc3QgW25hbWUsIHNvdXJjZURhdGFdIG9mIE9iamVjdC5lbnRyaWVzKHNvdXJjZVN1YnR5cHMpKSB7XG4gICAgY29uc3QgdGFyZ2V0RGF0YSA9IGdldFN1YnR5cChzZXR0aW5ncywgdGFyZ2V0LCBuYW1lKTtcbiAgICBpZiAoIXRhcmdldERhdGEpIHtcbiAgICAgIGVuc3VyZVN1YnR5cChzZXR0aW5ncywgdGFyZ2V0LCBuYW1lKTtcbiAgICAgIHNldHRpbmdzLnR5cFN1YnR5cHNbdGFyZ2V0XVtuYW1lXSA9IHNvdXJjZURhdGE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgdGFyZ2V0TG93ZXIgPSBuZXcgU2V0KE9iamVjdC5rZXlzKHRhcmdldERhdGEuZnJvbnRtYXR0ZXIpLm1hcCgoa2V5KSA9PiBrZXkudG9Mb3dlckNhc2UoKSkpO1xuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHNvdXJjZURhdGEuZnJvbnRtYXR0ZXIpKSB7XG4gICAgICBpZiAoa2V5ID09PSBcIlwiIHx8IHRhcmdldExvd2VyLmhhcyhrZXkudG9Mb3dlckNhc2UoKSkpIGNvbnRpbnVlO1xuICAgICAgdGFyZ2V0RGF0YS5mcm9udG1hdHRlcltrZXldID0gdmFsdWU7XG4gICAgICBpZiAoc291cmNlRGF0YS5mbG9hdGluZ0tleXMuaW5jbHVkZXMoa2V5KSkgdGFyZ2V0RGF0YS5mbG9hdGluZ0tleXMucHVzaChrZXkpO1xuICAgICAgLy8gVGhlIHNob3J0Y3V0IGJlbG9uZ3MgdG8gdGhlIGtleSBhbmQgbW92ZXMgd2l0aCBpdC5cbiAgICAgIGNvbnN0IHNob3J0Y3V0ID0gc291cmNlRGF0YS5zaG9ydGN1dHM/LltrZXldO1xuICAgICAgaWYgKHNob3J0Y3V0KSAodGFyZ2V0RGF0YS5zaG9ydGN1dHMgPz89IHt9KVtrZXldID0gc2hvcnRjdXQ7XG4gICAgfVxuICB9XG4gIGRlbGV0ZSBzZXR0aW5ncy50eXBTdWJ0eXBzW3NvdXJjZV07XG59XG5cbi8vIFJlbmFtZXMgYSBTdWJ0eXAgd2l0aGluIGl0cyBUWVA7IHRoZSBibG9jayBrZWVwcyBpdHMgcG9zaXRpb24gKGRpc3BsYXlcbi8vIG9yZGVyID0ga2V5IG9yZGVyKS5cbmZ1bmN0aW9uIHJlbmFtZVN1YnR5cChzZXR0aW5ncywgdHlwLCBvbGROYW1lLCBuZXdOYW1lKSB7XG4gIGNvbnN0IGJ5TmFtZSA9IHNldHRpbmdzLnR5cFN1YnR5cHM/Llt0eXBdO1xuICBpZiAoIWJ5TmFtZT8uW29sZE5hbWVdIHx8IG9sZE5hbWUgPT09IG5ld05hbWUpIHJldHVybjtcbiAgc2V0dGluZ3MudHlwU3VidHlwc1t0eXBdID0gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgIE9iamVjdC5lbnRyaWVzKGJ5TmFtZSkubWFwKChbbmFtZSwgZGF0YV0pID0+IFtuYW1lID09PSBvbGROYW1lID8gbmV3TmFtZSA6IG5hbWUsIGRhdGFdKVxuICApO1xufVxuXG4vLyBPcmRlciBvZiBhbGwgYmxvY2tzIG9mIGEgVFlQLCBudWxsID0gVFlQLUZyb250bWF0dGVyIChhbHdheXMgZmlyc3QpLCB0aGVuXG4vLyB0aGUgU3VidHlwcyBpbiBrZXkgb3JkZXIuIERyaXZlcyB0aGUgVFlQLVBhbmUgYXMgd2VsbCBhcyBmcm9udG1hdHRlclxuLy8gc29ydGluZyAoc2VlIG9yZGVyZWREZWZhdWx0S2V5cykuXG5mdW5jdGlvbiBnZXRTZWN0aW9uT3JkZXIoc2V0dGluZ3MsIHR5cCkge1xuICByZXR1cm4gW251bGwsIC4uLmdldFN1YnR5cE5hbWVzKHNldHRpbmdzLCB0eXApXTtcbn1cblxuLy8gTmV3IGJsb2NrIG9yZGVyIGZyb20gZHJhZyAmIGRyb3AgaW4gdGhlIFRZUC1QYW5lLCBzaGFwZWQgbGlrZVxuLy8gZ2V0U2VjdGlvbk9yZGVyOyB0aGUgbGVhZGluZyBudWxsIGlzIGlnbm9yZWQgKHRoZSBUWVAtRnJvbnRtYXR0ZXIgY2FuJ3Rcbi8vIG1vdmUpLiBTdWJ0eXBzIG5vdCBsaXN0ZWQgc3RheSBhdCB0aGUgZW5kLlxuZnVuY3Rpb24gcmVvcmRlclN1YnR5cHMoc2V0dGluZ3MsIHR5cCwgb3JkZXIpIHtcbiAgY29uc3QgYnlOYW1lID0gc2V0dGluZ3MudHlwU3VidHlwcz8uW3R5cF07XG4gIGlmICghYnlOYW1lKSByZXR1cm47XG4gIGNvbnN0IG5hbWVzID0gb3JkZXIuZmlsdGVyKChuYW1lKSA9PiBuYW1lICE9PSBudWxsICYmIGJ5TmFtZVtuYW1lXSk7XG4gIGNvbnN0IG9yZGVyZWQgPSBbLi4ubmFtZXMsIC4uLk9iamVjdC5rZXlzKGJ5TmFtZSkuZmlsdGVyKChuYW1lKSA9PiAhbmFtZXMuaW5jbHVkZXMobmFtZSkpXTtcbiAgc2V0dGluZ3MudHlwU3VidHlwc1t0eXBdID0gT2JqZWN0LmZyb21FbnRyaWVzKG9yZGVyZWQubWFwKChuYW1lKSA9PiBbbmFtZSwgYnlOYW1lW25hbWVdXSkpO1xufVxuXG5mdW5jdGlvbiBkZWxldGVTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgbmFtZSkge1xuICBjb25zdCBieU5hbWUgPSBzZXR0aW5ncy50eXBTdWJ0eXBzPy5bdHlwXTtcbiAgaWYgKCFieU5hbWUpIHJldHVybjtcbiAgZGVsZXRlIGJ5TmFtZVtuYW1lXTtcbiAgaWYgKE9iamVjdC5rZXlzKGJ5TmFtZSkubGVuZ3RoID09PSAwKSBkZWxldGUgc2V0dGluZ3MudHlwU3VidHlwc1t0eXBdO1xufVxuXG4vLyBNZXJnaW5nIHR3byBTdWJ0eXBzIG9mIG9uZSBUWVA6IHNvdXJjZSdzIHByb3BlcnRpZXMgZ28gdG8gdGhlIGVuZCBvZiB0aGVcbi8vIHRhcmdldCBibG9jaywgc291cmNlIGRpc2FwcGVhcnMuIElmIHRoZSB0YXJnZXQgYWxyZWFkeSBoYXMgYSBrZXksIGl0IGtlZXBzXG4vLyBwb3NpdGlvbiwgdmFsdWUgYW5kIGZsb2F0aW5nIGZsYWc7IG9ubHkgYW4gZW1wdHkgdGFyZ2V0IHZhbHVlIGlzIGZpbGxlZFxuLy8gZnJvbSBzb3VyY2UgKHNhbWUgcGF0dGVybiBhcyByZW5hbWVJblN0b3JlIGluIHByb3BlcnR5LXJlbmFtZS1zeW5jLmpzKS5cbmZ1bmN0aW9uIG1lcmdlU3VidHlwcyhzZXR0aW5ncywgdHlwLCBzb3VyY2UsIHRhcmdldCkge1xuICBjb25zdCBzb3VyY2VEYXRhID0gZ2V0U3VidHlwKHNldHRpbmdzLCB0eXAsIHNvdXJjZSk7XG4gIGNvbnN0IHRhcmdldERhdGEgPSBnZXRTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgdGFyZ2V0KTtcbiAgaWYgKCFzb3VyY2VEYXRhIHx8ICF0YXJnZXREYXRhIHx8IHNvdXJjZSA9PT0gdGFyZ2V0KSByZXR1cm47XG5cbiAgY29uc3QgdGFyZ2V0S2V5cyA9IG5ldyBNYXAoT2JqZWN0LmtleXModGFyZ2V0RGF0YS5mcm9udG1hdHRlcikubWFwKChrZXkpID0+IFtrZXkudG9Mb3dlckNhc2UoKSwga2V5XSkpO1xuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhzb3VyY2VEYXRhLmZyb250bWF0dGVyKSkge1xuICAgIGlmIChrZXkgPT09IFwiXCIpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGV4aXN0aW5nID0gdGFyZ2V0S2V5cy5nZXQoa2V5LnRvTG93ZXJDYXNlKCkpO1xuICAgIGlmIChleGlzdGluZyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0YXJnZXREYXRhLmZyb250bWF0dGVyW2tleV0gPSB2YWx1ZTtcbiAgICAgIHRhcmdldEtleXMuc2V0KGtleS50b0xvd2VyQ2FzZSgpLCBrZXkpO1xuICAgICAgaWYgKHNvdXJjZURhdGEuZmxvYXRpbmdLZXlzLmluY2x1ZGVzKGtleSkgJiYgIXRhcmdldERhdGEuZmxvYXRpbmdLZXlzLmluY2x1ZGVzKGtleSkpIHRhcmdldERhdGEuZmxvYXRpbmdLZXlzLnB1c2goa2V5KTtcbiAgICAgIC8vIFRoZSBzaG9ydGN1dCBiZWxvbmdzIHRvIHRoZSBrZXkgYW5kIG1vdmVzIHdpdGggaXQuXG4gICAgICBjb25zdCBzaG9ydGN1dCA9IHNvdXJjZURhdGEuc2hvcnRjdXRzPy5ba2V5XTtcbiAgICAgIGlmIChzaG9ydGN1dCkgKHRhcmdldERhdGEuc2hvcnRjdXRzID8/PSB7fSlba2V5XSA9IHNob3J0Y3V0O1xuICAgIH0gZWxzZSBpZiAoaXNFbXB0eVZhbHVlKHRhcmdldERhdGEuZnJvbnRtYXR0ZXJbZXhpc3RpbmddKSkge1xuICAgICAgdGFyZ2V0RGF0YS5mcm9udG1hdHRlcltleGlzdGluZ10gPSB2YWx1ZTtcbiAgICB9XG4gIH1cbiAgZGVsZXRlU3VidHlwKHNldHRpbmdzLCB0eXAsIHNvdXJjZSk7XG59XG5cbi8vIFJld3JpdGVzIHRoZSBTVUJUWVAgb2YgZXZlcnkgbm90ZSB3aXRoIFRZUCBrZXkgYHR5cGAgYW5kIFNVQlRZUCBrZXkgb2xkS2V5XG4vLyB0byB0aGUgc2luZ2xlIHZhbHVlIG5ld1ZhbHVlIC0gbGlrZSByZW5hbWVUeXBJbk5vdGVzKCkgaW4gdHlwLXBhbmUuanMuXG5hc3luYyBmdW5jdGlvbiByZW5hbWVTdWJ0eXBJbk5vdGVzKHBsdWdpbiwgdHlwLCBvbGRLZXksIG5ld1ZhbHVlKSB7XG4gIGxldCBjaGFuZ2VkID0gMDtcbiAgZm9yIChjb25zdCBmaWxlIG9mIHBsdWdpbi50eXBJbmRleC5maWxlc1dpdGhTdWJ0eXAodHlwLCBvbGRLZXkpKSB7XG4gICAgbGV0IG1hdGNoZWQgPSBmYWxzZTtcbiAgICBhd2FpdCBwbHVnaW4uYXBwLmZpbGVNYW5hZ2VyLnByb2Nlc3NGcm9udE1hdHRlcihmaWxlLCAoZnJvbnRtYXR0ZXIpID0+IHtcbiAgICAgIGlmICh0eXBLZXlPZihwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBTVUJUWVBfUFJPUEVSVFkpKSAhPT0gb2xkS2V5KSByZXR1cm47XG4gICAgICBzZXRDYW5vbmljYWxQcm9wZXJ0eShmcm9udG1hdHRlciwgU1VCVFlQX1BST1BFUlRZLCBuZXdWYWx1ZSk7XG4gICAgICBtYXRjaGVkID0gdHJ1ZTtcbiAgICB9KTtcbiAgICBpZiAobWF0Y2hlZCkgY2hhbmdlZCsrO1xuICB9XG4gIHJldHVybiBjaGFuZ2VkO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgbm9ybWFsaXplU3VidHlwTmFtZSxcbiAgaXNFbXB0eVZhbHVlLFxuICBnZXRTdWJ0eXBOYW1lcyxcbiAgZ2V0U3VidHlwLFxuICBlbnN1cmVTdWJ0eXAsXG4gIGlzU3VidHlwTWFudWFsLFxuICBzZXRTdWJ0eXBNYW51YWwsXG4gIHNldEFsbFN1YnR5cHNNYW51YWwsXG4gIG1vdmVUeXBTdWJ0eXBzLFxuICBkZWxldGVUeXBTdWJ0eXBzLFxuICBtZXJnZVR5cFN1YnR5cHMsXG4gIHJlbmFtZVN1YnR5cCxcbiAgZ2V0U2VjdGlvbk9yZGVyLFxuICByZW9yZGVyU3VidHlwcyxcbiAgZGVsZXRlU3VidHlwLFxuICBtZXJnZVN1YnR5cHMsXG4gIHJlbmFtZVN1YnR5cEluTm90ZXMsXG59O1xuIiwgIi8vIFN0YXRlbGVzcyBoZWxwZXJzIGFyb3VuZCBUWVAgbmFtZXMsIHNvcnRpbmcgYW5kIG1lc3NhZ2UgdGV4dC5cblxuLy8gVFlQIG5hbWVzIHR5cGVkIGludG8gdGhlIGxpc3QgYXJlIGFsd2F5cyB1cHBlcmNhc2UuIFZhbHVlcyB3cml0dGVuIGRpcmVjdGx5XG4vLyBpbnRvIGEgbm90ZSdzIGZyb250bWF0dGVyIGFyZSBsZWZ0IGFsb25lIChzZWUgdGhlIHVucmVnaXN0ZXJlZCByb3dzIGluXG4vLyB0eXAtcGFuZS5qcykuXG5mdW5jdGlvbiBub3JtYWxpemVUeXBOYW1lKHJhdykge1xuICByZXR1cm4gcmF3LnRyaW0oKS50b1VwcGVyQ2FzZSgpO1xufVxuXG4vLyBcIjEgbm90ZVwiLCBcIjMgbm90ZXNcIi4gd29yZCBpcyB0aGUgRW5nbGlzaCBzaW5ndWxhcjsgaXJyZWd1bGFyIHBsdXJhbHMgYXJlXG4vLyBwYXNzZWQgZXhwbGljaXRseS5cbmZ1bmN0aW9uIHBsdXJhbChjb3VudCwgd29yZCwgcGx1cmFsV29yZCA9IGAke3dvcmR9c2ApIHtcbiAgcmV0dXJuIGAke2NvdW50fSAke2NvdW50ID09PSAxID8gd29yZCA6IHBsdXJhbFdvcmR9YDtcbn1cblxuLy8gXCJhXCIsIFwiYSBhbmQgYlwiLCBcImEsIGIgYW5kIGNcIi5cbmZ1bmN0aW9uIGpvaW5BbmQocGFydHMpIHtcbiAgcmV0dXJuIHBhcnRzLmxlbmd0aCA8PSAxID8gcGFydHMuam9pbihcIlwiKSA6IGAke3BhcnRzLnNsaWNlKDAsIC0xKS5qb2luKFwiLCBcIil9IGFuZCAke3BhcnRzW3BhcnRzLmxlbmd0aCAtIDFdfWA7XG59XG5cbi8vIEtleSBoaW50cyBhdCB0aGUgYm90dG9tIG9mIGEgcGlja2VyLCB3b3JkZWQgbGlrZSB0aG9zZSBvZiBPYnNpZGlhbidzIG93blxuLy8gc3VnZ2VzdGVycy4gZXNjUHVycG9zZTogdGhlIFN1YnR5cC1QaWNrZXIgc2F5cyBcInRvIGdvIGJhY2tcIiwgc2luY2UgRVNDIHRoZXJlXG4vLyByZXR1cm5zIHRvIHRoZSBUWVAgY2hvaWNlLlxuZnVuY3Rpb24gcGlja2VySW5zdHJ1Y3Rpb25zKGVzY1B1cnBvc2UgPSBcInRvIGNhbmNlbFwiKSB7XG4gIHJldHVybiBbXG4gICAgeyBjb21tYW5kOiBcIlx1MjE5MVx1MjE5M1wiLCBwdXJwb3NlOiBcInRvIG5hdmlnYXRlXCIgfSxcbiAgICB7IGNvbW1hbmQ6IFwiXHUyMUI1XCIsIHB1cnBvc2U6IFwidG8gY2hvb3NlXCIgfSxcbiAgICB7IGNvbW1hbmQ6IFwiZXNjXCIsIHB1cnBvc2U6IGVzY1B1cnBvc2UgfSxcbiAgXTtcbn1cblxuLy8gSHVlICgwLTM2MFx1MDBCMCkgb2YgYSBoZXggY29sb3IsIHNvIGNvbG9ycyBzb3J0IGFsb25nIHRoZSBzcGVjdHJ1bSBpbnN0ZWFkIG9mIGJ5XG4vLyBoZXggc3RyaW5nLiBBY2hyb21hdGljIGNvbG9ycyAoZ3JheS9ibGFjay93aGl0ZSkgaGF2ZSBubyBodWUgYW5kIHJldHVybiBudWxsO1xuLy8gY29tcGFyZVR5cHMga2VlcHMgdGhlbSBsYXN0IGluIGJvdGggZGlyZWN0aW9ucy5cbmZ1bmN0aW9uIGhleFRvSHVlKGhleCkge1xuICBjb25zdCBtYXRjaCA9IC9eIz8oWzAtOWEtZl17Nn0pJC9pLmV4ZWMoaGV4ID8/IFwiXCIpO1xuICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgaW50ID0gcGFyc2VJbnQobWF0Y2hbMV0sIDE2KTtcbiAgY29uc3QgciA9ICgoaW50ID4+IDE2KSAmIDI1NSkgLyAyNTU7XG4gIGNvbnN0IGcgPSAoKGludCA+PiA4KSAmIDI1NSkgLyAyNTU7XG4gIGNvbnN0IGIgPSAoaW50ICYgMjU1KSAvIDI1NTtcbiAgY29uc3QgbWF4ID0gTWF0aC5tYXgociwgZywgYik7XG4gIGNvbnN0IG1pbiA9IE1hdGgubWluKHIsIGcsIGIpO1xuICBjb25zdCBkZWx0YSA9IG1heCAtIG1pbjtcbiAgaWYgKGRlbHRhID09PSAwKSByZXR1cm4gbnVsbDtcblxuICBsZXQgaHVlO1xuICBpZiAobWF4ID09PSByKSBodWUgPSAoKGcgLSBiKSAvIGRlbHRhKSAlIDY7XG4gIGVsc2UgaWYgKG1heCA9PT0gZykgaHVlID0gKGIgLSByKSAvIGRlbHRhICsgMjtcbiAgZWxzZSBodWUgPSAociAtIGcpIC8gZGVsdGEgKyA0O1xuICBodWUgKj0gNjA7XG4gIHJldHVybiBodWUgPCAwID8gaHVlICsgMzYwIDogaHVlO1xufVxuXG4vLyBTaGFyZWQgY29tcGFyaXNvbiBmb3IgVFlQIGFuZCBTVUJUWVAgbGlzdHMuIHR5cENvbG9ycyBtYXkgYmUgZW1wdHkgKGEgU3VidHlwXG4vLyBoYXMgbm8gY29sb3Igb2YgaXRzIG93bik7IHRoZSBcImNvbG9yXCIgbW9kZSBpcyB0aGVuIG5ldmVyIHNlbGVjdGVkLlxuZnVuY3Rpb24gY29tcGFyZVR5cHMobW9kZSwgYSwgYiwgY291bnRzLCB0eXBDb2xvcnMpIHtcbiAgY29uc3QgW2tleSwgZGlyXSA9IG1vZGUuc3BsaXQoXCItXCIpO1xuICBsZXQgY21wO1xuICBpZiAoa2V5ID09PSBcImNvdW50XCIpIHtcbiAgICBjbXAgPSAoY291bnRzLmdldChhKSA/PyAwKSAtIChjb3VudHMuZ2V0KGIpID8/IDApO1xuICAgIGlmIChkaXIgPT09IFwiZGVzY1wiKSBjbXAgPSAtY21wO1xuICB9IGVsc2UgaWYgKGtleSA9PT0gXCJjb2xvclwiKSB7XG4gICAgY29uc3QgaHVlQSA9IGhleFRvSHVlKHR5cENvbG9yc1thXSA/PyBudWxsKTtcbiAgICBjb25zdCBodWVCID0gaGV4VG9IdWUodHlwQ29sb3JzW2JdID8/IG51bGwpO1xuICAgIC8vIEFjaHJvbWF0aWMgY29sb3JzIHN0YXkgYXQgdGhlIGVuZCBpbiBib3RoIGRpcmVjdGlvbnMuXG4gICAgaWYgKGh1ZUEgPT09IG51bGwgJiYgaHVlQiA9PT0gbnVsbCkgY21wID0gMDtcbiAgICBlbHNlIGlmIChodWVBID09PSBudWxsKSBjbXAgPSAxO1xuICAgIGVsc2UgaWYgKGh1ZUIgPT09IG51bGwpIGNtcCA9IC0xO1xuICAgIGVsc2Uge1xuICAgICAgY21wID0gaHVlQSAtIGh1ZUI7XG4gICAgICBpZiAoZGlyID09PSBcImRlc2NcIikgY21wID0gLWNtcDtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgY21wID0gYS5sb2NhbGVDb21wYXJlKGIpO1xuICAgIGlmIChkaXIgPT09IFwiZGVzY1wiKSBjbXAgPSAtY21wO1xuICB9XG4gIHJldHVybiBjbXAgfHwgYS5sb2NhbGVDb21wYXJlKGIpO1xufVxuXG4vLyBcIm1hbnVhbFwiIGtlZXBzIHRoZSBnaXZlbiBvcmRlcjogaXQgaXMgdGhlIHN0b3JlZCBvcmRlciAoc2V0dGluZ3MudHlwcyxcbi8vIHJlYXJyYW5nZWQgYnkgZHJhZyAmIGRyb3ApLCB3aGljaCBubyBwYWlyd2lzZSBjb21wYXJpc29uIGNvdWxkIGRlcml2ZS5cbi8vIFVzZWQgYnkgbWFpbi5qcyAoZ2V0VHlwcykgYW5kIHR5cC1wYW5lLmpzIHNvIGJvdGggc2hvdyB0aGUgc2FtZSBvcmRlci5cbmZ1bmN0aW9uIHNvcnRUeXBzQnlNb2RlKHR5cHMsIG1vZGUsIGNvdW50cywgdHlwQ29sb3JzKSB7XG4gIGlmIChtb2RlID09PSBcIm1hbnVhbFwiKSByZXR1cm4gWy4uLnR5cHNdO1xuICByZXR1cm4gWy4uLnR5cHNdLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVUeXBzKG1vZGUsIGEsIGIsIGNvdW50cywgdHlwQ29sb3JzKSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBub3JtYWxpemVUeXBOYW1lLCBwbHVyYWwsIGpvaW5BbmQsIHBpY2tlckluc3RydWN0aW9ucywgaGV4VG9IdWUsIGNvbXBhcmVUeXBzLCBzb3J0VHlwc0J5TW9kZSB9O1xuIiwgImNvbnN0IHsgZ2V0U3VidHlwIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBzXCIpO1xuXG4vLyBDb2xvciBvZiBhIFRZUCB3aXRob3V0IGl0cyBvd24gY29sb3IuIExpdmVzIGhlcmUgYmVjYXVzZSBjb2RlIGJlbG93IHRoZVxuLy8gdmlldyBuZWVkcyBpdCAoc2VlIG5hbWVDb2xvcik7IHR5cC1wYW5lLmpzIHJlLWV4cG9ydHMgaXQuXG5jb25zdCBERUZBVUxUX1RZUF9DT0xPUiA9IFwiIzg4ODg4OFwiO1xuXG4vLyAtLS0gU3VidHlwIGNvbG9ycyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBBIFN1YnR5cCBzdG9yZXMgbm8gY29sb3IsIG9ubHkgYW4gb2Zmc2V0IGZyb20gaXRzIFRZUCdzIGNvbG9yXG4vLyAoc2V0dGluZ3MudHlwU3VidHlwc1tUWVBdW1NVQlRZUF0uY29sb3IgPSB7IGgsIGwgfSkuIFRoZSByZWFsIGNvbG9yIGlzXG4vLyBjb21wdXRlZCBmcm9tIHRoZSBjdXJyZW50IFRZUCBjb2xvciBldmVyeSB0aW1lLCBzbyB3aGVuIHRoYXQgY2hhbmdlcyBhbGxcbi8vIFN1YnR5cHMgZm9sbG93IGFuZCBzdGF5IGluIHRoZSBmYW1pbHkuXG4vLyBUaGUgbWF0aCBydW5zIGluIE9LTENILCB3aGVyZSBhIGxpZ2h0bmVzcyBjaGFuZ2UgbG9va3MgYWJvdXQgZXF1YWxseSBzdHJvbmdcbi8vIGFjcm9zcyBodWVzIChpbiBIU0wgeWVsbG93IHdvdWxkIGJlIGZhciBicmlnaHRlciB0aGFuIGJsdWUpLiBXaXRob3V0IGFuXG4vLyBvZmZzZXQgYSBTdWJ0eXAgaGFzIHRoZSBUWVAgY29sb3IuXG4vLyAgIGg6IGh1ZSwgc2hpZnRlZCBpbiBkZWdyZWVzO1xuLy8gICBsOiBsaWdodG5lc3MgYXMgJSBvZiB0aGUgd2F5IHRvIHdoaXRlICgrKSBvciBibGFjayAoLSkuXG4vLyBUaGUgYWxsb3dlZCByYW5nZSBpcyBhIHNldHRpbmcgKHNldHRpbmdzLnN1YnR5cENvbG9yUmFuZ2VzKTsgYSBsYXJnZXIgc3RvcmVkXG4vLyBvZmZzZXQgaXMgY2xhbXBlZCB0byBpdC5cbi8vXG4vLyBUaGlzIGxpc3QgaXMgdGhlIHNpbmdsZSBzb3VyY2UgZm9yIHRoZSBwb3BvdmVyIHNsaWRlcnMsIHRoZSBzZXR0aW5nIGxpbWl0c1xuLy8gYW5kIHRoZSBjbGFtcGluZzsgY29tbWVudGluZyBhIGNoYW5uZWwgb3V0IHJlbW92ZXMgaXQgZXZlcnl3aGVyZS5cbi8vXG4vLyBTYXR1cmF0aW9uIGlzIGRpc2FibGVkLiBJdCBvbmNlIGNvbXBlbnNhdGVkIGZvciBjaHJvbWEgdGhhdCBsaWdodG5lc3MgYW5kXG4vLyBodWUgdG9vayBhd2F5OyBzaW5jZSBib3RoIG5vdyBjYXJyeSBjaHJvbWEgYWxvbmcgKHNlZSBjb21wdXRlQ29sb3JPZmZzZXQpLFxuLy8gaXQgY291bGQgb25seSBzYXkgXCJ0aGlzIFN1YnR5cCBob2xkcyBiYWNrXCIsIG5vdCB3b3J0aCBhIHRoaXJkIHNsaWRlci4gVG9cbi8vIHJldml2ZSBpdCwgdW5jb21tZW50IGl0IGhlcmUsIGluIERFRkFVTFRfU1VCVFlQX0NPTE9SX1JBTkdFUywgaW5cbi8vIGNvbXB1dGVDb2xvck9mZnNldCBhbmQgYXQgcmFuZ2VNYXgvcmFuZ2VEZXNjIGluIHNldHRpbmdzLmpzLlxuLy8gZG93bk9ubHk6IHRoZSBzbGlkZXIgb25seSBnb2VzIGZyb20gLWxpbWl0IHRvIDAgLSBhIFN1YnR5cCBtYXkgaG9sZCBiYWNrIGJ1dFxuLy8gbmV2ZXIgYmUgbG91ZGVyIHRoYW4gaXRzIFRZUC5cbmNvbnN0IFNVQlRZUF9DT0xPUl9DSEFOTkVMUyA9IFtcbiAgeyBrZXk6IFwiaFwiLCBsYWJlbDogXCJIdWVcIiwgdW5pdDogXCJcdTAwQjBcIiB9LFxuICAvLyB7IGtleTogXCJzXCIsIGxhYmVsOiBcIlNhdHVyYXRpb25cIiwgdW5pdDogXCIlXCIsIGRvd25Pbmx5OiB0cnVlIH0sXG4gIHsga2V5OiBcImxcIiwgbGFiZWw6IFwiTGlnaHRuZXNzXCIsIHVuaXQ6IFwiJVwiIH0sXG5dO1xuLy8gU3VidHlwcyBzaG91bGQgYWJvdmUgYWxsIGJlIGRpc3Rpbmd1aXNoYWJsZTogaHVlIGNvbnRyaWJ1dGVzIG1vc3QgYW5kIGdldHNcbi8vIHRoZSB3aWRlc3QgcmFuZ2UsIGxpZ2h0bmVzcyBhcyB0aGUgc2Vjb25kIGNsZWFyIGF4aXMgZ2V0cyBwbGVudHkgdG9vLlxuY29uc3QgREVGQVVMVF9TVUJUWVBfQ09MT1JfUkFOR0VTID0geyBoOiAzNSwgLyogczogNDAsICovIGw6IDQwIH07XG5cbmZ1bmN0aW9uIGNvbG9yUmFuZ2Uoc2V0dGluZ3MsIGtleSkge1xuICBjb25zdCB2YWx1ZSA9IE51bWJlcihzZXR0aW5ncy5zdWJ0eXBDb2xvclJhbmdlcz8uW2tleV0pO1xuICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKHZhbHVlKSAmJiB2YWx1ZSA+PSAwID8gdmFsdWUgOiBERUZBVUxUX1NVQlRZUF9DT0xPUl9SQU5HRVNba2V5XTtcbn1cblxuLy8gU2xpZGVyIHJhbmdlIC0gb25lIHBsYWNlIGZvciBwb3BvdmVyLCBjbGFtcGluZyBhbmQgZ3JhZGllbnQgcHJldmlldyBzbyB0aGV5XG4vLyBjYW4ndCBkcmlmdCBhcGFydC5cbmZ1bmN0aW9uIGNoYW5uZWxCb3VuZHMoc2V0dGluZ3MsIGtleSkge1xuICBjb25zdCByYW5nZSA9IGNvbG9yUmFuZ2Uoc2V0dGluZ3MsIGtleSk7XG4gIHJldHVybiBTVUJUWVBfQ09MT1JfQ0hBTk5FTFMuZmluZCgoY2hhbm5lbCkgPT4gY2hhbm5lbC5rZXkgPT09IGtleSk/LmRvd25Pbmx5ID8gWy1yYW5nZSwgMF0gOiBbLXJhbmdlLCByYW5nZV07XG59XG5cbi8vIEEgU3VidHlwJ3Mgb2Zmc2V0LCBjbGFtcGVkIHRvIHRoZSBjb25maWd1cmVkIGxpbWl0cy5cbmZ1bmN0aW9uIGNsYW1wZWRPZmZzZXQoc2V0dGluZ3MsIG9mZnNldCkge1xuICBpZiAoIW9mZnNldCkgcmV0dXJuIG51bGw7XG4gIGNvbnN0IHJlc3VsdCA9IHt9O1xuICBmb3IgKGNvbnN0IHsga2V5IH0gb2YgU1VCVFlQX0NPTE9SX0NIQU5ORUxTKSB7XG4gICAgY29uc3QgW21pbiwgbWF4XSA9IGNoYW5uZWxCb3VuZHMoc2V0dGluZ3MsIGtleSk7XG4gICAgcmVzdWx0W2tleV0gPSBNYXRoLm1pbihtYXgsIE1hdGgubWF4KG1pbiwgTnVtYmVyKG9mZnNldFtrZXldKSB8fCAwKSk7XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuY29uc3QgdG9MaW5lYXIgPSAoYykgPT4gKGMgPD0gMC4wNDA0NSA/IGMgLyAxMi45MiA6ICgoYyArIDAuMDU1KSAvIDEuMDU1KSAqKiAyLjQpO1xuY29uc3QgdG9HYW1tYSA9IChjKSA9PiAoYyA8PSAwLjAwMzEzMDggPyAxMi45MiAqIGMgOiAxLjA1NSAqIGMgKiogKDEgLyAyLjQpIC0gMC4wNTUpO1xuXG5mdW5jdGlvbiBoZXhUb09rbGNoKGhleCkge1xuICBjb25zdCBtYXRjaCA9IC9eIz8oWzAtOWEtZl17Nn0pJC9pLmV4ZWMoaGV4ID8/IFwiXCIpO1xuICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgaW50ID0gcGFyc2VJbnQobWF0Y2hbMV0sIDE2KTtcbiAgY29uc3QgW3IsIGcsIGJdID0gWyhpbnQgPj4gMTYpICYgMjU1LCAoaW50ID4+IDgpICYgMjU1LCBpbnQgJiAyNTVdLm1hcCgoYykgPT4gdG9MaW5lYXIoYyAvIDI1NSkpO1xuICBjb25zdCBsID0gTWF0aC5jYnJ0KDAuNDEyMjIxNDcwOCAqIHIgKyAwLjUzNjMzMjUzNjMgKiBnICsgMC4wNTE0NDU5OTI5ICogYik7XG4gIGNvbnN0IG0gPSBNYXRoLmNicnQoMC4yMTE5MDM0OTgyICogciArIDAuNjgwNjk5NTQ1MSAqIGcgKyAwLjEwNzM5Njk1NjYgKiBiKTtcbiAgY29uc3QgcyA9IE1hdGguY2JydCgwLjA4ODMwMjQ2MTkgKiByICsgMC4yODE3MTg4Mzc2ICogZyArIDAuNjI5OTc4NzAwNSAqIGIpO1xuICBjb25zdCBMID0gMC4yMTA0NTQyNTUzICogbCArIDAuNzkzNjE3Nzg1ICogbSAtIDAuMDA0MDcyMDQ2OCAqIHM7XG4gIGNvbnN0IEEgPSAxLjk3Nzk5ODQ5NTEgKiBsIC0gMi40Mjg1OTIyMDUgKiBtICsgMC40NTA1OTM3MDk5ICogcztcbiAgY29uc3QgQiA9IDAuMDI1OTA0MDM3MSAqIGwgKyAwLjc4Mjc3MTc2NjIgKiBtIC0gMC44MDg2NzU3NjYgKiBzO1xuICByZXR1cm4geyBMLCBDOiBNYXRoLmh5cG90KEEsIEIpLCBIOiAoKE1hdGguYXRhbjIoQiwgQSkgKiAxODApIC8gTWF0aC5QSSArIDM2MCkgJSAzNjAgfTtcbn1cblxuLy8gTGluZWFyIHNSR0I7IGNoYW5uZWxzIG1heSBmYWxsIG91dHNpZGUgMC4uMSAob3V0IG9mIGdhbXV0KS5cbmZ1bmN0aW9uIG9rbGNoVG9MaW5lYXIoeyBMLCBDLCBIIH0pIHtcbiAgY29uc3QgQSA9IEMgKiBNYXRoLmNvcygoSCAqIE1hdGguUEkpIC8gMTgwKTtcbiAgY29uc3QgQiA9IEMgKiBNYXRoLnNpbigoSCAqIE1hdGguUEkpIC8gMTgwKTtcbiAgY29uc3QgbCA9IChMICsgMC4zOTYzMzc3Nzc0ICogQSArIDAuMjE1ODAzNzU3MyAqIEIpICoqIDM7XG4gIGNvbnN0IG0gPSAoTCAtIDAuMTA1NTYxMzQ1OCAqIEEgLSAwLjA2Mzg1NDE3MjggKiBCKSAqKiAzO1xuICBjb25zdCBzID0gKEwgLSAwLjA4OTQ4NDE3NzUgKiBBIC0gMS4yOTE0ODU1NDggKiBCKSAqKiAzO1xuICByZXR1cm4gW1xuICAgIDQuMDc2NzQxNjYyMSAqIGwgLSAzLjMwNzcxMTU5MTMgKiBtICsgMC4yMzA5Njk5MjkyICogcyxcbiAgICAtMS4yNjg0MzgwMDQ2ICogbCArIDIuNjA5NzU3NDAxMSAqIG0gLSAwLjM0MTMxOTM5NjUgKiBzLFxuICAgIC0wLjAwNDE5NjA4NjMgKiBsIC0gMC43MDM0MTg2MTQ3ICogbSArIDEuNzA3NjE0NzAxICogcyxcbiAgXTtcbn1cblxuY29uc3QgaW5HYW11dCA9IChyZ2IpID0+IHJnYi5ldmVyeSgoYykgPT4gYyA+PSAtMC4wMDAxICYmIGMgPD0gMS4wMDAxKTtcblxuLy8gTGFyZ2VzdCBjaHJvbWEgc1JHQiBjYW4gc2hvdyBhdCB0aGlzIGxpZ2h0bmVzcyBhbmQgaHVlLiBUaGUgbGltaXQgdmFyaWVzIGFcbi8vIGxvdCAocHVyZSB5ZWxsb3cgb25seSBjYXJyaWVzIG11Y2ggY2hyb21hIGp1c3QgYmVsb3cgd2hpdGUsIGJsdWUgaW4gdGhlXG4vLyBtaWRkbGUpLCB3aGljaCBpcyBleGFjdGx5IHdoZXJlIGFueSBtYXRoIGhvbGRpbmcgY2hyb21hIGFic29sdXRlIGJyZWFrcy5cbmZ1bmN0aW9uIG1heENocm9tYShMLCBIKSB7XG4gIGxldCBsb3cgPSAwO1xuICBsZXQgaGlnaCA9IDAuNDsgLy8gYWJvdmUgdGhlIHNSR0IgbWF4aW11bSAofjAuMzIpXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgMjA7IGkrKykge1xuICAgIGNvbnN0IG1pZCA9IChsb3cgKyBoaWdoKSAvIDI7XG4gICAgaWYgKGluR2FtdXQob2tsY2hUb0xpbmVhcih7IEwsIEM6IG1pZCwgSCB9KSkpIGxvdyA9IG1pZDtcbiAgICBlbHNlIGhpZ2ggPSBtaWQ7XG4gIH1cbiAgcmV0dXJuIGxvdztcbn1cblxuLy8gT3V0LW9mLWdhbXV0IGNvbG9ycyBsb3NlIGNocm9tYSB1bnRpbCB0aGV5IGZpdDsgaHVlIGFuZCBsaWdodG5lc3Mgc3RheS5cbi8vIEZvciBhcHBseUNvbG9yT2Zmc2V0IG9ubHkgYSBzYWZldHkgbmV0LCBzaW5jZSBjaHJvbWEgaXMgYWxyZWFkeSBhIHNoYXJlIG9mXG4vLyB0aGUgZGlzcGxheWFibGUgbWF4aW11bSB0aGVyZS5cbmZ1bmN0aW9uIG9rbGNoVG9IZXgoY29sb3IpIHtcbiAgbGV0IHJnYiA9IG9rbGNoVG9MaW5lYXIoY29sb3IpO1xuICBpZiAoIWluR2FtdXQocmdiKSkgcmdiID0gb2tsY2hUb0xpbmVhcih7IC4uLmNvbG9yLCBDOiBtYXhDaHJvbWEoY29sb3IuTCwgY29sb3IuSCkgfSk7XG4gIHJldHVybiAoXG4gICAgXCIjXCIgK1xuICAgIHJnYlxuICAgICAgLm1hcCgoYykgPT4gTWF0aC5yb3VuZChNYXRoLm1pbigxLCBNYXRoLm1heCgwLCB0b0dhbW1hKE1hdGgubWluKDEsIE1hdGgubWF4KDAsIGMpKSkpKSAqIDI1NSkpXG4gICAgICAubWFwKChjKSA9PiBjLnRvU3RyaW5nKDE2KS5wYWRTdGFydCgyLCBcIjBcIikpXG4gICAgICAuam9pbihcIlwiKVxuICApO1xufVxuXG4vLyBMaWdodG5lc3Mgb2YgYSBodWUncyBjdXNwLCB3aGVyZSBpdCBjYXJyaWVzIHRoZSBtb3N0IGNocm9tYS4gbWF4Q2hyb21hIHJpc2VzXG4vLyB1cCB0byBpdCBhbmQgZmFsbHMgYWZ0ZXIsIHNvIHRoZSBwZWFrIGNhbiBiZSBuYXJyb3dlZCBkb3duLiBPbmUgdmFsdWUgcGVyXG4vLyBodWUgYW5kIHRoZSBzZWFyY2ggaXMgY29zdGx5LCBzbyBpdCBpcyBjYWNoZWQgcGVyIHdob2xlIGRlZ3JlZS5cbmNvbnN0IGN1c3BDYWNoZSA9IG5ldyBNYXAoKTtcblxuLy8gQWJvdmUgdGhpcyBhIGNvbG9yIGNvdW50cyBhcyBjaHJvbWF0aWMuIEEgcHVyZSBncmF5IGNvbWVzIGJhY2sgZnJvbVxuLy8gaGV4VG9Pa2xjaCB3aXRoIGNocm9tYSBhcm91bmQgMmUtOCBhbmQgYW4gYXJiaXRyYXJ5IGh1ZSAocm91bmRlZCBtYXRyaXhcbi8vIGNvbnN0YW50cyk7IHRlc3RpbmcgXCI+IDBcIiBtYWRlIGEgZ3JheSBmb2xsb3cgdGhlIGN1c3Agb2YgYSBodWUgaXQgZG9lc24ndFxuLy8gaGF2ZS4gRmFyIGJlbG93IGFueXRoaW5nIHZpc2libGUgaW4gOCBiaXQgKG9uZSBzdGVwIGlzIGFib3V0IDAuMDAyKS5cbmNvbnN0IE5FVVRSQUxfQ0hST01BID0gMWUtNDtcblxuZnVuY3Rpb24gY3VzcExpZ2h0bmVzcyhIKSB7XG4gIGNvbnN0IGtleSA9IE1hdGgucm91bmQoSCkgJSAzNjA7XG4gIGNvbnN0IGNhY2hlZCA9IGN1c3BDYWNoZS5nZXQoa2V5KTtcbiAgaWYgKGNhY2hlZCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gY2FjaGVkO1xuICBsZXQgbG93ID0gMDtcbiAgbGV0IGhpZ2ggPSAxO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDI0OyBpKyspIHtcbiAgICBjb25zdCB0aGlyZCA9IChoaWdoIC0gbG93KSAvIDM7XG4gICAgaWYgKG1heENocm9tYShsb3cgKyB0aGlyZCwga2V5KSA8IG1heENocm9tYShoaWdoIC0gdGhpcmQsIGtleSkpIGxvdyArPSB0aGlyZDtcbiAgICBlbHNlIGhpZ2ggLT0gdGhpcmQ7XG4gIH1cbiAgY29uc3QgcmVzdWx0ID0gKGxvdyArIGhpZ2gpIC8gMjtcbiAgY3VzcENhY2hlLnNldChrZXksIHJlc3VsdCk7XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbi8vIFRoZSBzYW1lIGxpZ2h0bmVzcywgbWVhc3VyZWQgYWdhaW5zdCB0aGUgdGFyZ2V0IGh1ZSdzIGN1c3AgaW5zdGVhZCBvZiBpdHNcbi8vIG93bjogY3VzcCBtYXBzIHRvIGN1c3AsIGJsYWNrIHRvIGJsYWNrLCB3aGl0ZSB0byB3aGl0ZSwgbGluZWFyIGluIGJldHdlZW4uXG4vLyBXaXRob3V0IGEgaHVlIHNoaWZ0IEwgY29tZXMgYmFjayB1bmNoYW5nZWQuXG5mdW5jdGlvbiByZW1hcFRvQ3VzcChMLCBmcm9tSCwgdG9IKSB7XG4gIGNvbnN0IGZyb20gPSBjdXNwTGlnaHRuZXNzKGZyb21IKTtcbiAgY29uc3QgdG8gPSBjdXNwTGlnaHRuZXNzKHRvSCk7XG4gIGlmIChMIDw9IGZyb20pIHJldHVybiBmcm9tID4gMCA/IChMIC8gZnJvbSkgKiB0byA6IHRvO1xuICByZXR1cm4gZnJvbSA8IDEgPyB0byArICgoTCAtIGZyb20pIC8gKDEgLSBmcm9tKSkgKiAoMSAtIHRvKSA6IHRvO1xufVxuXG4vLyBUaGUgdHdvIGdhbXV0IHNlYXJjaGVzIGNvc3QgYWJvdXQgMTAgXHUwMEI1cyBwZXIgY29sb3IgLSB0b28gbXVjaCB3aGVuIHRoZSBmaWxlXG4vLyB0cmVlIG9yIGdyYXBoIGFza3MgZm9yIGV2ZXJ5IGZpbGUgKHNlZSBjb2xvckZvckZpbGUpLiBUaGVyZSBhcmUgb25seSBhXG4vLyBoYW5kZnVsIG9mIGRpc3RpbmN0IGNvbG9ycywgc28gYSBjYWNoZSBzdWZmaWNlczsgZHJhZ2dpbmcgYSBzbGlkZXIgYWRkc1xuLy8gZXZlcnkgaW50ZXJtZWRpYXRlIHZhbHVlLCBoZW5jZSB0aGUgb2NjYXNpb25hbCByZXNldC5cbmNvbnN0IG9mZnNldENhY2hlID0gbmV3IE1hcCgpO1xuXG5mdW5jdGlvbiBhcHBseUNvbG9yT2Zmc2V0KGhleCwgb2Zmc2V0KSB7XG4gIGlmICghb2Zmc2V0KSByZXR1cm4gaGV4O1xuICBjb25zdCBjYWNoZUtleSA9IGhleCArIFwifFwiICsgKG9mZnNldC5oID8/IDApICsgXCJ8XCIgKyAob2Zmc2V0LmwgPz8gMCk7XG4gIGNvbnN0IGNhY2hlZCA9IG9mZnNldENhY2hlLmdldChjYWNoZUtleSk7XG4gIGlmIChjYWNoZWQgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGNhY2hlZDtcbiAgY29uc3QgcmVzdWx0ID0gY29tcHV0ZUNvbG9yT2Zmc2V0KGhleCwgb2Zmc2V0KTtcbiAgaWYgKG9mZnNldENhY2hlLnNpemUgPiA1MDApIG9mZnNldENhY2hlLmNsZWFyKCk7XG4gIG9mZnNldENhY2hlLnNldChjYWNoZUtleSwgcmVzdWx0KTtcbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLy8gQm90aCBzbGlkZXJzIGFjdCByZWxhdGl2ZSB0byB0aGUgVFlQIGNvbG9yIHNvIHRoZSBTdWJ0eXAgc3RheXMgaW4gdGhlXG4vLyBmYW1pbHkuIEFic29sdXRlIHZhbHVlcyBkb24ndCBrZWVwIHRoZWlyIHByb21pc2UsIGJlY2F1c2UgaG93IG11Y2ggY29sb3Jcbi8vIHNSR0IgYWxsb3dzIGRlcGVuZHMgb24gbGlnaHRuZXNzIEFORCBodWU6XG4vLyAgIGw6IHNoYXJlIG9mIHRoZSB3YXkgdG8gd2hpdGUgKCspIG9yIGJsYWNrICgtKS4gQWJzb2x1dGUgT0tMQ0ggcG9pbnRzIHJhbiBhXG4vLyAgICAgIGxpZ2h0IFRZUCBjb2xvciBpbnRvIHB1cmUgd2hpdGUgaW4gdGhlIGZpcnN0IGhhbGYgb2YgdGhlIHNsaWRlci5cbi8vICAgaDogZGVncmVlcyAtIHRoZSBvbmx5IGFic29sdXRlIG9uZSwgQlVUIGl0IGNhcnJpZXMgbGlnaHRuZXNzIGFsb25nIChzZWVcbi8vICAgICAgcmVtYXBUb0N1c3ApLiBFYWNoIGh1ZSBwZWFrcyBhdCBhIGRpZmZlcmVudCBsaWdodG5lc3MgKHllbGxvdyBhdCBMIDAuOTIsXG4vLyAgICAgIG9yYW5nZSAwLjc4LCBibHVlIDAuNDkpLiBUdXJuaW5nIGEgbGlnaHQgeWVsbG93IHRvIG9yYW5nZSBhdCBmaXhlZFxuLy8gICAgICBsaWdodG5lc3MgbGFuZHMgZmFyIGFib3ZlIG9yYW5nZSdzIGN1c3AsIHdoZXJlIHRoZXJlIGlzIGhhcmRseSBhbnlcbi8vICAgICAgY2hyb21hIGxlZnQ6IGEgd2FzaGVkLW91dCBwYXN0ZWwuIEZvbGxvd2luZyB0aGUgY3VzcCBrZWVwcyB0aGUgY29sb3Jcbi8vICAgICAgc3RyZW5ndGggbmVhcmx5IGNvbnN0YW50IHRocm91Z2ggdGhlIHR1cm4uXG4vLyBDaHJvbWEgaXMgdGhlbiBzaW1wbHkgYSBzaGFyZSBvZiB0aGUgY2VpbGluZyAoYmFzZS5DIC8gbWF4Q2hyb21hIGF0IHRoZVxuLy8gc3RhcnQsIHRpbWVzIG1heENocm9tYSBhdCB0aGUgdGFyZ2V0KTsgb25seSB3aXRoIHJlbGF0ZWQgbGlnaHRuZXNzZXMgYXJlXG4vLyB0d28gaHVlcycgY2VpbGluZ3MgY29tcGFyYWJsZS5cbi8vXG4vLyBOb3RlIHdoYXQgdGhhdCBzaGFyZSBpczogYSBzdGF0ZW1lbnQgYWJvdXQgc1JHQiwgbm90IGFib3V0IHBlcmNlcHRpb24uIEl0XG4vLyBrZWVwcyBcImVxdWFsbHkgZXhoYXVzdGVkXCIsIG5vdCBcImVxdWFsbHkgY29sb3JmdWxcIiAoY29uc3RhbnQgQykgbm9yIFwiZXF1YWxseVxuLy8gc2F0dXJhdGVkXCIgKGNvbnN0YW50IEMvTCkuIFNvIHRoZSBtb2RlbCBpcyB0aWVkIHRvIHNSR0I7IGFmdGVyIGEgaHVlIHR1cm4gYVxuLy8gU3VidHlwIGlzIGVxdWFsbHkgZW1waGF0aWMgcmF0aGVyIHRoYW4gZXF1YWxseSBsaWdodCAoYSBkZXNpZ24gY2hvaWNlKTsgYW5kXG4vLyBjaHJvbWEgaXNuJ3QgbW9ub3RvbmljIGluIGxpZ2h0bmVzcyAtIGFib3ZlIGl0cyBjdXNwIGEgVFlQIGNvbG9yIGZpcnN0IGdhaW5zXG4vLyBjaHJvbWEgZ29pbmcgZG93biwgdGhlbiBsb3NlcyBpdCAoIzc4NzhkYyBoYXMgbW9yZSBhdCAtMjAgJSB0aGFuIGF0IDAgJSBvclxuLy8gLTQwICUpLiBGaW5lIGZvciBjb2xvcmVkIGZpbGUgbmFtZXM7IGEgc3RyaWN0ZXIgbW9kZWwgbmVlZHMgYSBkaWZmZXJlbnRcbi8vIHJlZmVyZW5jZSwgbm90IHBhdGNoZWQgZm9ybXVsYXMuXG4vL1xuLy8gT0tMYWIgaXRzZWxmIGlzIG9mZiBpbiB0aGUgYmx1ZSByYW5nZSAoSCAyNjAtMjkwKTogYmx1ZSBkcmlmdHMgdG93YXJkIHZpb2xldFxuLy8gd2hlbiBsaWdodGVuZWQgd2hpbGUgdGhlIG51bWJlcnMgc2F5IHRoZSBodWUgaXMgY29uc3RhbnQuIENoZWNrIHN1Y2ggVFlQXG4vLyBjb2xvcnMgYnkgZXllLlxuZnVuY3Rpb24gY29tcHV0ZUNvbG9yT2Zmc2V0KGhleCwgb2Zmc2V0KSB7XG4gIGNvbnN0IGJhc2UgPSBoZXhUb09rbGNoKGhleCk7XG4gIGlmICghYmFzZSkgcmV0dXJuIGhleDtcbiAgY29uc3QgSCA9IChiYXNlLkggKyAob2Zmc2V0LmggPz8gMCkgKyAzNjApICUgMzYwO1xuICBjb25zdCBiYXNlQ2VpbGluZyA9IG1heENocm9tYShiYXNlLkwsIGJhc2UuSCk7XG4gIC8vIEEgZ3JheSBUWVAgY29sb3Igc3RheXMgZ3JheTsgaXRzIGh1ZSBtZWFucyBub3RoaW5nLCBzbyB0aGVyZSBpcyBubyBjdXNwIHRvXG4gIC8vIGZvbGxvdyBlaXRoZXIuXG4gIGNvbnN0IG5ldXRyYWwgPSBiYXNlLkMgPCBORVVUUkFMX0NIUk9NQSB8fCBiYXNlQ2VpbGluZyA8PSAwO1xuICBjb25zdCByZWxhdGl2ZSA9IG5ldXRyYWwgPyAwIDogYmFzZS5DIC8gYmFzZUNlaWxpbmc7XG4gIGNvbnN0IHNoaWZ0ZWQgPSBuZXV0cmFsID8gYmFzZS5MIDogcmVtYXBUb0N1c3AoYmFzZS5MLCBiYXNlLkgsIEgpO1xuICBjb25zdCBzaGFyZSA9IChvZmZzZXQubCA/PyAwKSAvIDEwMDtcbiAgY29uc3QgTCA9IE1hdGgubWluKDEsIE1hdGgubWF4KDAsIHNoaWZ0ZWQgKyBzaGFyZSAqIChzaGFyZSA+PSAwID8gMSAtIHNoaWZ0ZWQgOiBzaGlmdGVkKSkpO1xuICBjb25zdCBDID0gcmVsYXRpdmUgKiBtYXhDaHJvbWEoTCwgSCk7IC8qICogKDEgKyAob2Zmc2V0LnMgPz8gMCkgLyAxMDApIC0gc2F0dXJhdGlvbiBkaXNhYmxlZCAqL1xuICByZXR1cm4gb2tsY2hUb0hleCh7IEwsIEM6IE1hdGgubWF4KDAsIEMpLCBIIH0pO1xufVxuXG5mdW5jdGlvbiBoYXNDb2xvck9mZnNldChvZmZzZXQpIHtcbiAgcmV0dXJuICEhb2Zmc2V0ICYmIFNVQlRZUF9DT0xPUl9DSEFOTkVMUy5zb21lKCh7IGtleSB9KSA9PiAob2Zmc2V0W2tleV0gPz8gMCkgIT09IDApO1xufVxuXG4vLyBBIFN1YnR5cCdzIGNvbG9yICh0aGUgVFlQJ3Mgd2hpbGUgaXQgaGFzIG5vIG9mZnNldCk7IG51bGwgaWYgdGhlIFRZUCBpdHNlbGZcbi8vIGhhcyBubyBjb2xvci5cbmZ1bmN0aW9uIHN1YnR5cENvbG9yKHNldHRpbmdzLCB0eXAsIHN1YnR5cCkge1xuICBjb25zdCB0eXBDb2xvciA9IHNldHRpbmdzLnR5cENvbG9yc1t0eXBdID8/IG51bGw7XG4gIGlmICghdHlwQ29sb3IgfHwgIXN1YnR5cCkgcmV0dXJuIHR5cENvbG9yO1xuICBjb25zdCBvZmZzZXQgPSBjbGFtcGVkT2Zmc2V0KHNldHRpbmdzLCBnZXRTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgc3VidHlwKT8uY29sb3IpO1xuICByZXR1cm4gaGFzQ29sb3JPZmZzZXQob2Zmc2V0KSA/IGFwcGx5Q29sb3JPZmZzZXQodHlwQ29sb3IsIG9mZnNldCkgOiB0eXBDb2xvcjtcbn1cblxuLy8gRG9lcyB0aGUgU3VidHlwIGhhdmUgYW4gb2Zmc2V0IG9mIGl0cyBvd24gKGVmZmVjdGl2ZSB3aXRoaW4gdGhlIGxpbWl0cyk/XG5mdW5jdGlvbiBzdWJ0eXBIYXNPd25Db2xvcihzZXR0aW5ncywgdHlwLCBzdWJ0eXApIHtcbiAgcmV0dXJuIGhhc0NvbG9yT2Zmc2V0KGNsYW1wZWRPZmZzZXQoc2V0dGluZ3MsIGdldFN1YnR5cChzZXR0aW5ncywgdHlwLCBzdWJ0eXApPy5jb2xvcikpO1xufVxuXG4vLyBDb2xvciBvZiBhIFRZUCBvciBTdWJ0eXAgbmFtZSAtIHNoYXJlZCBieSB0aGUgcGlja2VyICh0eXAtcGlja2VyLmpzKSBhbmQgdGhlXG4vLyBTdWJ0eXAgcHJldmlldyBpbiB0aGUgVFlQLUxpc3Qgc28gdGhleSBjYW4ndCBkcmlmdCBhcGFydC4gV2l0aCBzdWJ0eXAsIHRoZVxuLy8gU3VidHlwIGNvbG9yLCBidXQgb25seSBpZiB0aGUgXCJTdWJ0eXBcIiBzdWItdG9nZ2xlIG9mIFwiVFlQLVBhbmVcIiBhbGxvd3MgaXQuXG4vLyBpc0RlZmF1bHQgbWVhbnMgYSBob2xsb3cgcmluZyBpbnN0ZWFkIG9mIGEgZmlsbGVkIGRvdCAoc2VlIHBhaW50Q29sb3JEb3QpLlxuZnVuY3Rpb24gbmFtZUNvbG9yKHNldHRpbmdzLCB0eXAsIHN1YnR5cCA9IG51bGwpIHtcbiAgY29uc3QgdXNlU3VidHlwID0gISFzdWJ0eXAgJiYgc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0U3VidHlwO1xuICBjb25zdCB0eXBDb2xvciA9IHNldHRpbmdzLnR5cENvbG9yc1t0eXBdID8/IG51bGw7XG4gIHJldHVybiB7XG4gICAgY29sb3I6ICh1c2VTdWJ0eXAgPyBzdWJ0eXBDb2xvcihzZXR0aW5ncywgdHlwLCBzdWJ0eXApIDogdHlwQ29sb3IpID8/IERFRkFVTFRfVFlQX0NPTE9SLFxuICAgIGlzRGVmYXVsdDogIXR5cENvbG9yIHx8ICh1c2VTdWJ0eXAgJiYgIXN1YnR5cEhhc093bkNvbG9yKHNldHRpbmdzLCB0eXAsIHN1YnR5cCkpLFxuICB9O1xufVxuXG4vLyBDb2xvciBkb3QgKFRZUC1MaXN0LCBkZXRhaWwgdmlldywgcGlja2VycywgZGlhbG9ncyk6IGZpbGxlZCBmb3IgYW4gb3duXG4vLyBjb2xvciwgYSBob2xsb3cgcmluZyBmb3IgdGhlIGRlZmF1bHQgLSBncmF5IGZvciBhIFRZUCB3aXRob3V0IGEgY29sb3IsIHRoZVxuLy8gaW5oZXJpdGVkIFRZUCBjb2xvciBmb3IgYSBTdWJ0eXAgd2l0aG91dCBhbiBvZmZzZXQuXG5mdW5jdGlvbiBwYWludENvbG9yRG90KGVsLCBjb2xvciwgaXNEZWZhdWx0KSB7XG4gIGVsLnN0eWxlLmJhY2tncm91bmRDb2xvciA9IGlzRGVmYXVsdCA/IFwidHJhbnNwYXJlbnRcIiA6IGNvbG9yO1xuICBlbC5zdHlsZS5ib3hTaGFkb3cgPSBpc0RlZmF1bHQgPyBgaW5zZXQgMCAwIDAgbWF4KDEuNXB4LCAwLjE1ZW0pICR7Y29sb3J9YCA6IFwiXCI7XG59XG5cbi8vIHZpZXdLZXkgKG9wdGlvbmFsKTogdGhlIHZpZXcncyBrZXkgaW4gY29sb3JWaWV3cy4gSWYgaXRzIFwiPHZpZXdLZXk+U3VidHlwXCJcbi8vIHN1Yi10b2dnbGUgaXMgb24sIHRoZSBub3RlJ3MgU3VidHlwIGNvbG9yIGlzIHVzZWQgaW5zdGVhZCBvZiBpdHMgVFlQJ3MuXG5mdW5jdGlvbiBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCB2aWV3S2V5ID0gbnVsbCkge1xuICBjb25zdCB0eXAgPSBwbHVnaW4udHlwSW5kZXgudHlwT2YoZmlsZSk7XG4gIGlmICghdHlwKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgeyBzZXR0aW5ncyB9ID0gcGx1Z2luO1xuICBpZiAoIXZpZXdLZXkgfHwgIXNldHRpbmdzLmNvbG9yVmlld3NbYCR7dmlld0tleX1TdWJ0eXBgXSkgcmV0dXJuIHNldHRpbmdzLnR5cENvbG9yc1t0eXBdID8/IG51bGw7XG4gIHJldHVybiBzdWJ0eXBDb2xvcihzZXR0aW5ncywgdHlwLCBwbHVnaW4udHlwSW5kZXguc3VidHlwT2YoZmlsZSkpO1xufVxuXG4vLyAtLS0gSW5saW5lIGNvbG9ycyBpbiBvdGhlciB2aWV3cyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBFeHBsb3Jlciwgc2VhcmNoLCBSZWNlbnQgRmlsZXMsIGJhY2tsaW5rcywgYm9va21hcmtzLCB0aGUgbm90ZSB0aXRsZSBhbmRcbi8vIFwiQWxsIHByb3BlcnRpZXNcIiBhcmUgY29sb3JlZCB0aHJvdWdoIHN0eWxlLmNvbG9yIG9uIE9ic2lkaWFuJ3Mgb3duXG4vLyBlbGVtZW50cy4gVGhvc2Ugdmlld3Mgb25seSByZS1yZW5kZXIgbm93IGFuZCB0aGVuLCBzbyB0aGUgY29sb3JzIHdvdWxkIHN0YXlcbi8vIGFmdGVyIHRoZSBwbHVnaW4gaXMgZGlzYWJsZWQuIEV2ZXJ5IGVsZW1lbnQgY29sb3JlZCB0aGlzIHdheSBpcyBtYXJrZWQsIGFuZFxuLy8gb24gdW5sb2FkIGV4YWN0bHkgdGhlIG1hcmtlZCBvbmVzIGFyZSBjbGVhcmVkIC0gbmV2ZXIgYW4gaW5saW5lIGNvbG9yIHNvbWVcbi8vIG90aGVyIHBsdWdpbiBvciB0aGVtZSBwdXQgdGhlcmUuXG5jb25zdCBDT0xPUkVEX0FUVFIgPSBcImRhdGEtdHlwLWNvbG9yZWRcIjtcblxuLy8gY29sb3IgbnVsbC9cIlwiIHJlbW92ZXMgdGhlIGNvbG9yLCBidXQgb25seSBmcm9tIGFuIGVsZW1lbnQgd2UgY29sb3JlZC5cbi8vIHByaW9yaXR5OiBcImltcG9ydGFudFwiIHdoZXJlIGEgQ1NTIHJ1bGUgd2l0aCAhaW1wb3J0YW50IGNvbXBldGVzLlxuZnVuY3Rpb24gc2V0SW5saW5lQ29sb3IoZWwsIGNvbG9yLCBwcmlvcml0eSA9IFwiXCIpIHtcbiAgaWYgKGNvbG9yKSB7XG4gICAgZWwuc3R5bGUuc2V0UHJvcGVydHkoXCJjb2xvclwiLCBjb2xvciwgcHJpb3JpdHkpO1xuICAgIGVsLnNldEF0dHJpYnV0ZShDT0xPUkVEX0FUVFIsIFwiXCIpO1xuICB9IGVsc2UgaWYgKGVsLmhhc0F0dHJpYnV0ZShDT0xPUkVEX0FUVFIpKSB7XG4gICAgZWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJjb2xvclwiKTtcbiAgICBlbC5yZW1vdmVBdHRyaWJ1dGUoQ09MT1JFRF9BVFRSKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBjbGVhcklubGluZUNvbG9ycyhkb2MpIHtcbiAgZm9yIChjb25zdCBlbCBvZiBkb2MucXVlcnlTZWxlY3RvckFsbChgWyR7Q09MT1JFRF9BVFRSfV1gKSkgc2V0SW5saW5lQ29sb3IoZWwsIG51bGwpO1xufVxuXG4vLyBUaGUgZG9jdW1lbnRzIG9mIGFsbCB3aW5kb3dzIChwb3Atb3V0cyBpbmNsdWRlZCksIGNvbGxlY3RlZCB0aHJvdWdoIHRoZWlyXG4vLyBsZWF2ZXMuXG5mdW5jdGlvbiBhbGxEb2N1bWVudHMoYXBwKSB7XG4gIGNvbnN0IGRvY3MgPSBuZXcgU2V0KCk7XG4gIGFwcC53b3Jrc3BhY2UuaXRlcmF0ZUFsbExlYXZlcygobGVhZikgPT4gZG9jcy5hZGQobGVhZi52aWV3LmNvbnRhaW5lckVsLm93bmVyRG9jdW1lbnQpKTtcbiAgcmV0dXJuIGRvY3M7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBzZXRJbmxpbmVDb2xvcixcbiAgY2xlYXJJbmxpbmVDb2xvcnMsXG4gIGFsbERvY3VtZW50cyxcbiAgY29sb3JGb3JGaWxlLFxuICBuYW1lQ29sb3IsXG4gIERFRkFVTFRfVFlQX0NPTE9SLFxuICBzdWJ0eXBDb2xvcixcbiAgYXBwbHlDb2xvck9mZnNldCxcbiAgaGFzQ29sb3JPZmZzZXQsXG4gIHN1YnR5cEhhc093bkNvbG9yLFxuICBwYWludENvbG9yRG90LFxuICBjb2xvclJhbmdlLFxuICBjaGFubmVsQm91bmRzLFxuICBjbGFtcGVkT2Zmc2V0LFxuICBTVUJUWVBfQ09MT1JfQ0hBTk5FTFMsXG4gIERFRkFVTFRfU1VCVFlQX0NPTE9SX1JBTkdFUyxcbn07XG4iLCAiY29uc3QgeyBDb25maXJtYXRpb25Nb2RhbCwgUGxhdGZvcm0gfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgbmFtZUNvbG9yLCBwYWludENvbG9yRG90LCBERUZBVUxUX1RZUF9DT0xPUiB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxuLy8gQSBUWVAgbmFtZSBpbiBydW5uaW5nIHRleHQgKGRpYWxvZ3MpOiBjb2xvcmVkIHdoZW4gXCJUWVAtUGFuZVwiIGNvbG9yaW5nIGlzIG9uXG4vLyAoY29sb3JWaWV3cy50eXBMaXN0KSwgb3RoZXJ3aXNlIGEgZG90IGJlZm9yZSBwbGFpbiB0ZXh0IC0gdGhlIHNhbWUgc3dpdGNoIGFzXG4vLyBpbiB0aGUgcGlja2VyIGFuZCB0aGUgbGlzdC4gVGhlIGNhbGxlciBwYXNzZXMgY29sb3Igc28gYSByZW5hbWUgY2FuIHVzZSB0aGVcbi8vIHNhbWUgKG9sZCkgY29sb3IgZm9yIG9sZCBhbmQgbmV3IG5hbWUuIGNvbG9yIG51bGwgPSBUWVAgd2l0aG91dCBhIGNvbG9yLlxuZnVuY3Rpb24gYXBwZW5kVHlwTmFtZShwYXJlbnRFbCwgcGx1Z2luLCB0eXAsIGNvbG9yKSB7XG4gIGlmIChwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0KSB7XG4gICAgY29uc3QgbmFtZUVsID0gcGFyZW50RWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtaW5saW5lLW5hbWVcIiwgdGV4dDogdHlwIH0pO1xuICAgIGlmIChjb2xvcikgbmFtZUVsLnN0eWxlLmNvbG9yID0gY29sb3I7XG4gIH0gZWxzZSB7XG4gICAgcGFpbnRDb2xvckRvdChwYXJlbnRFbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1pbmxpbmUtZG90XCIgfSksIGNvbG9yID8/IERFRkFVTFRfVFlQX0NPTE9SLCAhY29sb3IpO1xuICAgIHBhcmVudEVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLWlubGluZS1uYW1lXCIsIHRleHQ6IHR5cCB9KTtcbiAgfVxufVxuXG4vLyBMaWtlIGFwcGVuZFR5cE5hbWUgZm9yIGEgU3VidHlwIG9mIHR5cCwgaW4gdGhlIFN1YnR5cCBjb2xvciAoc2VlIG5hbWVDb2xvclxuLy8gaW4gdHlwLWNvbG9ycy5qcywgd2hpY2ggYWxzbyBob25vcnMgdGhlIFwiU3VidHlwXCIgc3ViLXRvZ2dsZSBvZiBcIlRZUC1QYW5lXCIpLlxuLy8gY29sb3JTdWJ0eXAgaXMgdGhlIFN1YnR5cCB3aG9zZSBjb2xvciBpcyB1c2VkIC0gYSByZW5hbWUgc2hvd3MgdGhlIG5ldyBuYW1lLFxuLy8gd2hpY2ggaGFzIG5vIGVudHJ5IHlldCwgaW4gdGhlIG9sZCBvbmUncyBjb2xvci4gQXMgd2l0aCBhcHBlbmRUeXBOYW1lLCBhIFRZUFxuLy8gd2l0aG91dCBhIGNvbG9yIGxlYXZlcyB0aGUgdGV4dCB1bmNvbG9yZWQuXG5mdW5jdGlvbiBhcHBlbmRTdWJ0eXBOYW1lKHBhcmVudEVsLCBwbHVnaW4sIHR5cCwgbmFtZSwgY29sb3JTdWJ0eXAgPSBuYW1lKSB7XG4gIGNvbnN0IHsgY29sb3IsIGlzRGVmYXVsdCB9ID0gbmFtZUNvbG9yKHBsdWdpbi5zZXR0aW5ncywgdHlwLCBjb2xvclN1YnR5cCk7XG4gIGlmIChwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0KSB7XG4gICAgY29uc3QgbmFtZUVsID0gcGFyZW50RWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtaW5saW5lLW5hbWVcIiwgdGV4dDogbmFtZSB9KTtcbiAgICBpZiAocGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdKSBuYW1lRWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcbiAgfSBlbHNlIHtcbiAgICBwYWludENvbG9yRG90KHBhcmVudEVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLWlubGluZS1kb3RcIiB9KSwgY29sb3IsIGlzRGVmYXVsdCk7XG4gICAgcGFyZW50RWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtaW5saW5lLW5hbWVcIiwgdGV4dDogbmFtZSB9KTtcbiAgfVxufVxuXG4vLyBUaGUgc2FtZSBhcyBub2RlcyBmb3IgYSBDb25maXJtTW9kYWwgdGl0bGUgb3IgYm9keS5cbmNvbnN0IHR5cE5hbWVOb2RlID0gKHBsdWdpbiwgdHlwLCBjb2xvcikgPT4gY3JlYXRlRnJhZ21lbnQoKGYpID0+IGFwcGVuZFR5cE5hbWUoZiwgcGx1Z2luLCB0eXAsIGNvbG9yKSk7XG5jb25zdCBzdWJ0eXBOYW1lTm9kZSA9IChwbHVnaW4sIHR5cCwgbmFtZSwgY29sb3JTdWJ0eXAgPSBuYW1lKSA9PlxuICBjcmVhdGVGcmFnbWVudCgoZikgPT4gYXBwZW5kU3VidHlwTmFtZShmLCBwbHVnaW4sIHR5cCwgbmFtZSwgY29sb3JTdWJ0eXApKTtcblxuLy8gRmlsbHMgZWwgd2l0aCBhIHN0cmluZyBvciBhbiBhcnJheSBvZiBzdHJpbmdzIGFuZCBub2Rlcy5cbmZ1bmN0aW9uIGFwcGVuZFBhcnRzKGVsLCBwYXJ0cykge1xuICBmb3IgKGNvbnN0IHBhcnQgb2YgQXJyYXkuaXNBcnJheShwYXJ0cykgPyBwYXJ0cyA6IFtwYXJ0c10pIHtcbiAgICBpZiAodHlwZW9mIHBhcnQgPT09IFwic3RyaW5nXCIpIGVsLmFwcGVuZFRleHQocGFydCk7XG4gICAgZWxzZSBlbC5hcHBlbmRDaGlsZChwYXJ0KTtcbiAgfVxufVxuXG4vLyBUaGUgb25lIGNvbmZpcm1hdGlvbiBkaWFsb2cgb2YgdGhlIHBsdWdpbiwgYnVpbHQgb24gT2JzaWRpYW4ncyBvd25cbi8vIENvbmZpcm1hdGlvbk1vZGFsIC0gdGhlIGJhc2Ugb2YgaXRzIFwiRGVsZXRlIGZpbGVcIiBldGMuIC0gc28gbG9vaywgYnV0dG9uXG4vLyBvcmRlciBbQ2FuY2VsXSBbQWN0aW9uXSwgYm90dG9tIHNoZWV0IG9uIHBob25lcyBhbmQga2V5Ym9hcmQgZm9jdXMgbWF0Y2hcbi8vIE9ic2lkaWFuJ3MgZGlhbG9ncyBleGFjdGx5LlxuLy9cbi8vIExpa2UgT2JzaWRpYW4ncyBcIk1lcmdlIHByb3BlcnR5IC4uLiB3aXRoIC4uLj9cIiAoQWxsIHByb3BlcnRpZXMpLCB0aGVcbi8vIHF1ZXN0aW9uIGl0c2VsZiBpcyB0aGUgdGl0bGUgYW5kIHRoZSB0ZXh0IG9ubHkgYWRkcyB3aGF0IHRoZSB0aXRsZSBkb2Vzbid0XG4vLyBzYXkgLSBvZnRlbiBub3RoaW5nLlxuLy9cbi8vICAgdGl0bGUgICAgICAgLSB0aGUgcXVlc3Rpb24gKFwiRGVsZXRlIFRFUk1JTj9cIik7IGEgc3RyaW5nIG9yIGFuIGFycmF5IG9mXG4vLyAgICAgICAgICAgICAgICAgc3RyaW5ncyBhbmQgbm9kZXMgKGZvciBjb2xvcmVkIG5hbWVzLCBzZWUgYXBwZW5kVHlwTmFtZS9cbi8vICAgICAgICAgICAgICAgICBhcHBlbmRTdWJ0eXBOYW1lKVxuLy8gICBib2R5ICAgICAgICAtIG9wdGlvbmFsIHBhcmFncmFwaHMsIGVhY2ggc2hhcGVkIGxpa2UgdGl0bGVcbi8vICAgY29uZmlybVRleHQgLSBsYWJlbCBvZiB0aGUgYWN0aW9uIGJ1dHRvblxuLy8gICB3YXJuaW5nICAgICAtIGRlc3RydWN0aXZlIGFjdGlvbiAocmVkIGJ1dHRvbilcbi8vICAgZm9jdXMgICAgICAgLSBcImNvbmZpcm1cIiBvciBcImNhbmNlbFwiOiB3aGljaCBidXR0b24gRW50ZXIgdHJpZ2dlcnMuIFJlbmFtZVxuLy8gICAgICAgICAgICAgICAgIGZvY3VzZXMgdGhlIGFjdGlvbiwgZGVsZXRlIGFuZCBtZXJnZSBmb2N1cyBDYW5jZWwuXG4vLyAgIG9uQ29uZmlybSAvIG9uQ2FuY2VsIC0gb25DYW5jZWwgYWxzbyBjb3ZlcnMgRXNjYXBlIGFuZCBhIGNsaWNrIG91dHNpZGUuXG4vLyAgIGRvbnRBc2tBZ2FpbiAtIG9wdGlvbmFsOiBzaG93cyBPYnNpZGlhbidzIFwiRG9uJ3QgYXNrIGFnYWluXCIgY2hlY2tib3ggKGFzXG4vLyAgICAgICAgICAgICAgICAgaW4gaXRzIFwiRGVsZXRlIGZpbGVcIiwgZGVza3RvcCBvbmx5KSBhbmQgcGFzc2VzIGl0cyBzdGF0ZSB0b1xuLy8gICAgICAgICAgICAgICAgIG9uQ29uZmlybShkb250QXNrQWdhaW4pLiBPbmx5IGZvciBkaWFsb2dzIHRoYXQgbWF5IGJlXG4vLyAgICAgICAgICAgICAgICAgc3dpdGNoZWQgb2ZmLCBpLmUuIGFjdGlvbnMgdGhhdCBjYW4gYmUgdW5kb25lLlxuLy9cbi8vIEJvdGggY2FsbGJhY2tzIHJ1biBmcm9tIG9uQ2xvc2UsIGkuZS4gb25jZSB0aGUgZGlhbG9nIGlzIGdvbmUgLSBhcyBiZWZvcmVcbi8vIHRoZSBzd2l0Y2ggdG8gQ29uZmlybWF0aW9uTW9kYWwsIGFuZCBzbyBhIGxvbmcgb25Db25maXJtIChyZXdyaXRpbmcgbWFueVxuLy8gbm90ZXMpIG5laXRoZXIga2VlcHMgdGhlIGRpYWxvZyBvcGVuIG5vciBydW5zIHR3aWNlLlxuY2xhc3MgQ29uZmlybU1vZGFsIGV4dGVuZHMgQ29uZmlybWF0aW9uTW9kYWwge1xuICBjb25zdHJ1Y3RvcihhcHAsIHsgdGl0bGUsIGJvZHkgPSBbXSwgY29uZmlybVRleHQsIHdhcm5pbmcgPSBmYWxzZSwgZm9jdXMgPSBcImNvbmZpcm1cIiwgZG9udEFza0FnYWluID0gZmFsc2UsIG9uQ29uZmlybSwgb25DYW5jZWwgfSkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy50aXRsZSA9IHRpdGxlO1xuICAgIHRoaXMuYm9keSA9IGJvZHk7XG4gICAgdGhpcy5vbkNvbmZpcm0gPSBvbkNvbmZpcm07XG4gICAgdGhpcy5vbkNhbmNlbCA9IG9uQ2FuY2VsO1xuICAgIHRoaXMuY29uZmlybWVkID0gZmFsc2U7XG4gICAgdGhpcy5kb250QXNrQWdhaW4gPSBmYWxzZTtcblxuICAgIC8vIEJlZm9yZSB0aGUgYnV0dG9ucywgc28gaXQgc2l0cyBvbiB0aGUgbGVmdCBhcyBpbiBPYnNpZGlhbidzIGRpYWxvZ3MuXG4gICAgaWYgKGRvbnRBc2tBZ2FpbiAmJiAhUGxhdGZvcm0uaXNNb2JpbGUpIHtcbiAgICAgIHRoaXMuYWRkQ2hlY2tib3goXCJEb24ndCBhc2sgYWdhaW5cIiwgKGNoZWNrZWQpID0+IHtcbiAgICAgICAgdGhpcy5kb250QXNrQWdhaW4gPSBjaGVja2VkO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gQnV0dG9ucyBhbHJlYWR5IGhlcmUsIG5vdCBpbiBvbk9wZW46IENvbmZpcm1hdGlvbk1vZGFsLm9wZW4oKSBsb29rcyBmb3JcbiAgICAvLyB0aGUgaW5pdGlhbC1mb2N1cyBidXR0b24gYmVmb3JlIGl0IGNhbGxzIG9uT3Blbi5cbiAgICB0aGlzLmFkZEJ1dHRvbigoYnV0dG9uKSA9PiB7XG4gICAgICBidXR0b24uc2V0QnV0dG9uVGV4dChcIkNhbmNlbFwiKS5zZXRDYW5jZWwoKTtcbiAgICAgIGlmIChmb2N1cyA9PT0gXCJjYW5jZWxcIikgYnV0dG9uLnNldEluaXRpYWxGb2N1cygpO1xuICAgIH0pO1xuICAgIHRoaXMuYWRkQnV0dG9uKChidXR0b24pID0+IHtcbiAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KGNvbmZpcm1UZXh0KS5zZXRDdGEoKTtcbiAgICAgIGlmICh3YXJuaW5nKSBidXR0b24uc2V0RGVzdHJ1Y3RpdmUoKTtcbiAgICAgIGlmIChmb2N1cyA9PT0gXCJjb25maXJtXCIpIGJ1dHRvbi5zZXRJbml0aWFsRm9jdXMoKTtcbiAgICAgIC8vIEJyYWNlcywgbm8gcmV0dXJuIHZhbHVlOiBDb25maXJtYXRpb25CdXR0b24ga2VlcHMgdGhlIGRpYWxvZyBvcGVuIGlmXG4gICAgICAvLyB0aGUgaGFuZGxlciByZXR1cm5zIHNvbWV0aGluZyB0cnV0aHksIGFuZCB3YWl0cyBmb3IgYSBwcm9taXNlLlxuICAgICAgYnV0dG9uLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICB0aGlzLmNvbmZpcm1lZCA9IHRydWU7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICBhcHBlbmRQYXJ0cyh0aGlzLnRpdGxlRWwsIHRoaXMudGl0bGUpO1xuICAgIGZvciAoY29uc3QgcGFyYWdyYXBoIG9mIHRoaXMuYm9keSkgYXBwZW5kUGFydHModGhpcy5jb250ZW50RWwuY3JlYXRlRWwoXCJwXCIpLCBwYXJhZ3JhcGgpO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICBzdXBlci5vbkNsb3NlKCk7XG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcbiAgICBpZiAodGhpcy5jb25maXJtZWQpIHRoaXMub25Db25maXJtPy4odGhpcy5kb250QXNrQWdhaW4pO1xuICAgIGVsc2UgdGhpcy5vbkNhbmNlbD8uKCk7XG4gIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IENvbmZpcm1Nb2RhbCwgYXBwZW5kVHlwTmFtZSwgYXBwZW5kU3VidHlwTmFtZSwgdHlwTmFtZU5vZGUsIHN1YnR5cE5hbWVOb2RlIH07XG4iLCAiY29uc3QgeyBOb3RpY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgZ2V0U3VidHlwIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBzXCIpO1xuY29uc3QgeyB0eXBLZXlPZiwgcHJvcGVydHlWYWx1ZSwgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcbmNvbnN0IHsgcGx1cmFsIH0gPSByZXF1aXJlKFwiLi90eXAtdXRpbHNcIik7XG5jb25zdCB7IENvbmZpcm1Nb2RhbCwgdHlwTmFtZU5vZGUgfSA9IHJlcXVpcmUoXCIuL2NvbmZpcm0tbW9kYWxcIik7XG5cbi8vIFRoZSBmb3VyIHBsYWNlaG9sZGVycyBvZiB0aGUgZ2xvYmFsIG9yZGVyOyB0aGUgb3JkZXIgZWRpdG9yIGxldHMgeW91IG1vdmVcbi8vIHRoZW0gYnV0IG5vdCByZW1vdmUgdGhlbS4gXCJ0eXBWYWx1ZVwiIGlzIHRoZSBUWVAgcHJvcGVydHkgaXRzZWxmLFxuLy8gXCJzdWJ0eXBWYWx1ZVwiIHRoZSBTVUJUWVAgcHJvcGVydHksIFwidHlwXCIgdGhlIFRZUC1Gcm9udG1hdHRlciBsaXN0LFxuLy8gXCJvdGhlclwiIGV2ZXJ5dGhpbmcgZWxzZS5cbmNvbnN0IERFRkFVTFRfR0xPQkFMX09SREVSID0gW3sga2luZDogXCJ0eXBWYWx1ZVwiIH0sIHsga2luZDogXCJzdWJ0eXBWYWx1ZVwiIH0sIHsga2luZDogXCJ0eXBcIiB9LCB7IGtpbmQ6IFwib3RoZXJcIiB9XTtcblxuLy8gRW5zdXJlcyBleGFjdGx5IG9uZSBlbnRyeSBwZXIgcGxhY2Vob2xkZXIuIE9sZGVyIHNhdmVkIG9yZGVycyBwcmVkYXRlIHNvbWVcbi8vIG9mIHRoZW07IG1pc3Npbmcgb25lcyBhcmUgYWRkZWQgYXQgYSBzZW5zaWJsZSBzcG90IChcInN1YnR5cFZhbHVlXCIgcmlnaHRcbi8vIGFmdGVyIFwidHlwVmFsdWVcIiwgdGhlIG90aGVycyBhdCB0aGUgZWRnZXMpIHdpdGhvdXQgdG91Y2hpbmcgdGhlIG9yZGVyIHRoZVxuLy8gdXNlciBhcnJhbmdlZC5cbmZ1bmN0aW9uIG5vcm1hbGl6ZUdsb2JhbE9yZGVyKG9yZGVyKSB7XG4gIGNvbnN0IHJlc3VsdCA9IEFycmF5LmlzQXJyYXkob3JkZXIpID8gb3JkZXIuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkgJiYgdHlwZW9mIGVudHJ5ID09PSBcIm9iamVjdFwiKSA6IFtdO1xuICBjb25zdCBoYXNLaW5kID0gKGtpbmQpID0+IHJlc3VsdC5zb21lKChlbnRyeSkgPT4gZW50cnkua2luZCA9PT0ga2luZCk7XG4gIGlmICghaGFzS2luZChcInR5cFZhbHVlXCIpKSByZXN1bHQudW5zaGlmdCh7IGtpbmQ6IFwidHlwVmFsdWVcIiB9KTtcbiAgaWYgKCFoYXNLaW5kKFwic3VidHlwVmFsdWVcIikpIHtcbiAgICBjb25zdCB0eXBWYWx1ZUluZGV4ID0gcmVzdWx0LmZpbmRJbmRleCgoZW50cnkpID0+IGVudHJ5LmtpbmQgPT09IFwidHlwVmFsdWVcIik7XG4gICAgcmVzdWx0LnNwbGljZSh0eXBWYWx1ZUluZGV4ICsgMSwgMCwgeyBraW5kOiBcInN1YnR5cFZhbHVlXCIgfSk7XG4gIH1cbiAgaWYgKCFoYXNLaW5kKFwidHlwXCIpKSByZXN1bHQucHVzaCh7IGtpbmQ6IFwidHlwXCIgfSk7XG4gIGlmICghaGFzS2luZChcIm90aGVyXCIpKSByZXN1bHQucHVzaCh7IGtpbmQ6IFwib3RoZXJcIiB9KTtcbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gKiBGcm9udG1hdHRlciBzb3J0aW5nXG4gKiBQdXRzIHRoZSBwcm9wZXJ0aWVzIGEgbm90ZSBIQVMgaW50byBhIGZpeGVkIG9yZGVyIGJ1aWx0IGZyb21cbiAqIGdsb2JhbFByb3BlcnR5T3JkZXI6IHBpbm5lZCBzaW5nbGUgcHJvcGVydGllcywgdGhlIFRZUCBhbmRcbiAqIFNVQlRZUCBwcm9wZXJ0aWVzLCB0aGUgXCJUWVAtRnJvbnRtYXR0ZXJcIiBibG9jayAodGhlIFRZUCdzIGxpc3RcbiAqIGZvbGxvd2VkIGJ5IGl0cyBTdWJ0eXAgYmxvY2spIGFuZCBcIk90aGVyIHByb3BlcnRpZXNcIi4gTmV2ZXIgYWRkc1xuICogcHJvcGVydGllcyBvciBjaGFuZ2VzIHZhbHVlcy5cbiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqL1xuXG4vLyBLZXkgb3JkZXIgb2YgYSBUWVAncyBmcm9udG1hdHRlciwgZmxvYXRpbmcga2V5cyBpbmNsdWRlZCBhdCB0aGVpciBsaXN0XG4vLyBwb3NpdGlvbiAoZ2V0VHlwRGVmYXVsdHMgbGVhdmVzIHRoZW0gb3V0LCBidXQgYSBub3RlIHRoYXQgaGFzIG9uZSBzaG91bGRcbi8vIHN0aWxsIGdldCBpdCBpbiBwbGFjZSkuIFdpdGhvdXQgVFlQL1NVQlRZUCBhbmQgdGhlIGVkaXRvcidzIGJsYW5rIHJvdy5cbi8vIG51bGwgaWYgdGhlcmUgaXMgbm8gVFlQIG9yIG5vIGxpc3QuXG4vL1xuLy8gV2l0aCBzdWJ0eXAsIHRoZSBrZXlzIG9mIGl0cyBibG9jayBmb2xsb3cuIEEga2V5IGluIEJPVEggYmxvY2tzIGtlZXBzIHRoZVxuLy8gVFlQLUZyb250bWF0dGVyIHBvc2l0aW9uIC0gdGhlIHNhbWUgcnVsZSBhcyBjb2xsZWN0QmxvY2tzIGluIG1haW4uanMsIG9yIGFcbi8vIGZyZXNobHkgY3JlYXRlZCBub3RlIHdvdWxkIGJlIHJlLXNvcnRlZCByaWdodCBhd2F5LlxuZnVuY3Rpb24gb3JkZXJlZERlZmF1bHRLZXlzKHBsdWdpbiwgdHlwLCBzdWJ0eXAgPSBudWxsKSB7XG4gIGlmICghdHlwKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgaXNTeXN0ZW1LZXkgPSAoa2V5KSA9PiBrZXkgPT09IFwiXCIgfHwgW1RZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZXS5zb21lKChwKSA9PiBrZXkudG9Mb3dlckNhc2UoKSA9PT0gcC50b0xvd2VyQ2FzZSgpKTtcbiAgY29uc3Qgc3VidHlwRGF0YSA9IHN1YnR5cCA/IGdldFN1YnR5cChwbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKSA6IG51bGw7XG4gIGNvbnN0IGJsb2NrcyA9IFtwbHVnaW4uc2V0dGluZ3MudHlwRGVmYXVsdEZyb250bWF0dGVyW3R5cF0sIHN1YnR5cERhdGE/LmZyb250bWF0dGVyXTtcbiAgY29uc3Qga2V5cyA9IFtdO1xuICBjb25zdCBzZWVuID0gbmV3IFNldCgpO1xuICBmb3IgKGNvbnN0IGJsb2NrIG9mIGJsb2Nrcykge1xuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGJsb2NrID8/IHt9KSkge1xuICAgICAgaWYgKGlzU3lzdGVtS2V5KGtleSkgfHwgc2Vlbi5oYXMoa2V5LnRvTG93ZXJDYXNlKCkpKSBjb250aW51ZTtcbiAgICAgIGtleXMucHVzaChrZXkpO1xuICAgICAgc2Vlbi5hZGQoa2V5LnRvTG93ZXJDYXNlKCkpO1xuICAgIH1cbiAgfVxuICByZXR1cm4ga2V5cy5sZW5ndGggPiAwID8ga2V5cyA6IG51bGw7XG59XG5cbi8vIFRhcmdldCBvcmRlciBvZiBhIG5vdGUncyBleGlzdGluZyBwcm9wZXJ0aWVzLCBmdWxseSBkZWZpbmVkIGJ5IGdsb2JhbE9yZGVyLlxuLy9cbi8vIFdoaWNoIGJsb2NrIGNsYWltcyBhIHByb3BlcnR5IGlzIGRlY2lkZWQgQkVGT1JFIHRoZSBvcmRlciBpcyBidWlsdCAocGlubmVkLFxuLy8gVFlQIGJsb2NrIGFuZCByZXN0IGFyZSBkaXNqb2ludCksIHNvIHRoZSByZXN1bHQgZG9lc24ndCBkZXBlbmQgb24gd2hlcmUgdGhlXG4vLyBibG9ja3Mgc2l0IGluIGdsb2JhbE9yZGVyOiBhIHBpbm5lZCBwcm9wZXJ0eSBuZXZlciBhbHNvIGxhbmRzIGluIHRoZSBUWVBcbi8vIGJsb2NrLCBhbmQgXCJvdGhlclwiIG9ubHkgZXZlciBob2xkcyB0cnVlIGxlZnRvdmVycy5cbmZ1bmN0aW9uIGNvbXB1dGVTb3J0ZWRLZXlzKGV4aXN0aW5nS2V5cywgZ2xvYmFsT3JkZXIsIHR5cERlZmF1bHRLZXlzKSB7XG4gIGNvbnN0IGxvd2VyVG9BY3R1YWwgPSBuZXcgTWFwKGV4aXN0aW5nS2V5cy5tYXAoKGtleSkgPT4gW2tleS50b0xvd2VyQ2FzZSgpLCBrZXldKSk7XG4gIGNvbnN0IHJlc29sdmUgPSAobmFtZSkgPT4gbG93ZXJUb0FjdHVhbC5nZXQobmFtZS50b0xvd2VyQ2FzZSgpKTtcblxuICBjb25zdCBwaW5uZWQgPSBuZXcgU2V0KFxuICAgIGdsb2JhbE9yZGVyXG4gICAgICAuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkua2luZCA9PT0gXCJwcm9wZXJ0eVwiKVxuICAgICAgLm1hcCgoZW50cnkpID0+IHJlc29sdmUoZW50cnkubmFtZSkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICk7XG4gIGNvbnN0IHR5cEtleSA9IHJlc29sdmUoVFlQX1BST1BFUlRZKTtcbiAgY29uc3Qgc3VidHlwS2V5ID0gcmVzb2x2ZShTVUJUWVBfUFJPUEVSVFkpO1xuICBjb25zdCB0eXBCbG9ja0tleXMgPSBuZXcgU2V0KFxuICAgICh0eXBEZWZhdWx0S2V5cyA/PyBbXSkubWFwKHJlc29sdmUpLmZpbHRlcigoa2V5KSA9PiBrZXkgJiYga2V5ICE9PSB0eXBLZXkgJiYgIXBpbm5lZC5oYXMoa2V5KSlcbiAgKTtcbiAgY29uc3QgY2xhaW1lZCA9IG5ldyBTZXQocGlubmVkKTtcbiAgZm9yIChjb25zdCBrZXkgb2YgdHlwQmxvY2tLZXlzKSBjbGFpbWVkLmFkZChrZXkpO1xuICBpZiAodHlwS2V5KSBjbGFpbWVkLmFkZCh0eXBLZXkpO1xuICBpZiAoc3VidHlwS2V5KSBjbGFpbWVkLmFkZChzdWJ0eXBLZXkpO1xuXG4gIGNvbnN0IHNvcnRlZEtleXMgPSBbXTtcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQoKTtcbiAgY29uc3QgcHVzaCA9IChrZXkpID0+IHtcbiAgICBpZiAoa2V5ICYmICFzZWVuLmhhcyhrZXkpKSB7XG4gICAgICBzb3J0ZWRLZXlzLnB1c2goa2V5KTtcbiAgICAgIHNlZW4uYWRkKGtleSk7XG4gICAgfVxuICB9O1xuXG4gIGZvciAoY29uc3QgZW50cnkgb2YgZ2xvYmFsT3JkZXIpIHtcbiAgICBpZiAoZW50cnkua2luZCA9PT0gXCJwcm9wZXJ0eVwiKSBwdXNoKHJlc29sdmUoZW50cnkubmFtZSkpO1xuICAgIGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwidHlwVmFsdWVcIikgcHVzaCh0eXBLZXkpO1xuICAgIGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwic3VidHlwVmFsdWVcIikgcHVzaChzdWJ0eXBLZXkpO1xuICAgIGVsc2UgaWYgKGVudHJ5LmtpbmQgPT09IFwidHlwXCIpIHtcbiAgICAgIGZvciAoY29uc3QgbmFtZSBvZiB0eXBEZWZhdWx0S2V5cyA/PyBbXSkge1xuICAgICAgICBjb25zdCBrZXkgPSByZXNvbHZlKG5hbWUpO1xuICAgICAgICBpZiAoa2V5ICYmIHR5cEJsb2NrS2V5cy5oYXMoa2V5KSkgcHVzaChrZXkpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoZW50cnkua2luZCA9PT0gXCJvdGhlclwiKSB7XG4gICAgICBmb3IgKGNvbnN0IGtleSBvZiBleGlzdGluZ0tleXMpIHtcbiAgICAgICAgaWYgKCFjbGFpbWVkLmhhcyhrZXkpKSBwdXNoKGtleSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gU2FmZXR5IG5ldCBmb3IgYW4gaW5jb21wbGV0ZSBnbG9iYWxPcmRlciAoY29ycnVwdCBzZXR0aW5ncykuXG4gIGZvciAoY29uc3Qga2V5IG9mIGV4aXN0aW5nS2V5cykgcHVzaChrZXkpO1xuICByZXR1cm4gc29ydGVkS2V5cztcbn1cblxuLy8gXCJwb3NpdGlvblwiIGlzIE9ic2lkaWFuJ3MgbG9jYXRpb24gb2YgdGhlIGZyb250bWF0dGVyIGJsb2NrLCBwcmVzZW50IG9ubHkgaW5cbi8vIHRoZSBjYWNoZSBvYmplY3QsIG5vdCBhIHByb3BlcnR5LlxuZnVuY3Rpb24gY2FjaGVkRnJvbnRtYXR0ZXJLZXlzKGFwcCwgZmlsZSkge1xuICBjb25zdCBmcm9udG1hdHRlciA9IGFwcC5tZXRhZGF0YUNhY2hlLmdldEZpbGVDYWNoZShmaWxlKT8uZnJvbnRtYXR0ZXI7XG4gIGlmICghZnJvbnRtYXR0ZXIpIHJldHVybiBudWxsO1xuICByZXR1cm4gT2JqZWN0LmtleXMoZnJvbnRtYXR0ZXIpLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IFwicG9zaXRpb25cIik7XG59XG5cbi8vIENoZWFwIHByZS1jaGVjayBhZ2FpbnN0IHRoZSBpbi1tZW1vcnkgY2FjaGU6IG1vc3Qgbm90ZXMgYXJlIGFscmVhZHkgc29ydGVkLFxuLy8gYW5kIHRoaXMgc2tpcHMgb3BlbmluZyB0aGVtIGF0IGFsbCAtIHRoYXQgaXMgd2hlcmUgcmVwZWF0ZWQgdmF1bHQgcnVucyBnZXRcbi8vIHRoZWlyIHNwZWVkLiBBbHNvIHdoYXQgdGhlIHBsYXkgYnV0dG9uIGNvdW50cyB3aXRoIGJlZm9yZSBpdCBhc2tzLlxuZnVuY3Rpb24gY2FjaGVOZWVkc1NvcnRpbmcoYXBwLCBmaWxlLCBnbG9iYWxPcmRlciwgdHlwRGVmYXVsdEtleXMpIHtcbiAgY29uc3QgY2FjaGVkS2V5cyA9IGNhY2hlZEZyb250bWF0dGVyS2V5cyhhcHAsIGZpbGUpO1xuICBpZiAoIWNhY2hlZEtleXMgfHwgY2FjaGVkS2V5cy5sZW5ndGggPD0gMSkgcmV0dXJuIGZhbHNlO1xuICBjb25zdCBjYWNoZWRTb3J0ZWQgPSBjb21wdXRlU29ydGVkS2V5cyhjYWNoZWRLZXlzLCBnbG9iYWxPcmRlciwgdHlwRGVmYXVsdEtleXMpO1xuICByZXR1cm4gIWNhY2hlZFNvcnRlZC5ldmVyeSgoa2V5LCBpKSA9PiBrZXkgPT09IGNhY2hlZEtleXNbaV0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzb3J0RmlsZUZyb250bWF0dGVyKGFwcCwgZmlsZSwgZ2xvYmFsT3JkZXIsIHR5cERlZmF1bHRLZXlzKSB7XG4gIC8vIHByb2Nlc3NGcm9udE1hdHRlciBzdGF5cyB0aGUgc291cmNlIG9mIHRydXRoIGZvciB0aGUgYWN0dWFsIHdyaXRlLCBzaW5jZVxuICAvLyB0aGUgY2FjaGUgY2FuIGxhZyBiZWhpbmQuXG4gIGlmICghY2FjaGVOZWVkc1NvcnRpbmcoYXBwLCBmaWxlLCBnbG9iYWxPcmRlciwgdHlwRGVmYXVsdEtleXMpKSByZXR1cm4gZmFsc2U7XG5cbiAgbGV0IGNoYW5nZWQgPSBmYWxzZTtcbiAgYXdhaXQgYXBwLmZpbGVNYW5hZ2VyLnByb2Nlc3NGcm9udE1hdHRlcihmaWxlLCAoZnJvbnRtYXR0ZXIpID0+IHtcbiAgICBjaGFuZ2VkID0gc29ydEZyb250bWF0dGVyT2JqZWN0KGZyb250bWF0dGVyLCBnbG9iYWxPcmRlciwgdHlwRGVmYXVsdEtleXMpO1xuICB9KTtcbiAgcmV0dXJuIGNoYW5nZWQ7XG59XG5cbi8vIFNvcnRzIHRoZSBwcm9jZXNzRnJvbnRNYXR0ZXIgb2JqZWN0IGluIHBsYWNlOiBpbnNlcnRpb24gb3JkZXIgYmVjb21lcyB0aGVcbi8vIFlBTUwgb3JkZXIsIHNvIGFsbCBrZXlzIGFyZSBkZWxldGVkIGFuZCByZS1hZGRlZC4gUmV0dXJucyB0cnVlIG9uIGEgY2hhbmdlLlxuZnVuY3Rpb24gc29ydEZyb250bWF0dGVyT2JqZWN0KGZyb250bWF0dGVyLCBnbG9iYWxPcmRlciwgdHlwRGVmYXVsdEtleXMpIHtcbiAgY29uc3QgZXhpc3RpbmdLZXlzID0gT2JqZWN0LmtleXMoZnJvbnRtYXR0ZXIpO1xuICBpZiAoZXhpc3RpbmdLZXlzLmxlbmd0aCA8PSAxKSByZXR1cm4gZmFsc2U7XG5cbiAgY29uc3Qgc29ydGVkS2V5cyA9IGNvbXB1dGVTb3J0ZWRLZXlzKGV4aXN0aW5nS2V5cywgZ2xvYmFsT3JkZXIsIHR5cERlZmF1bHRLZXlzKTtcbiAgaWYgKHNvcnRlZEtleXMuZXZlcnkoKGtleSwgaSkgPT4ga2V5ID09PSBleGlzdGluZ0tleXNbaV0pKSByZXR1cm4gZmFsc2U7XG5cbiAgY29uc3Qgc25hcHNob3QgPSB7IC4uLmZyb250bWF0dGVyIH07XG4gIGZvciAoY29uc3Qga2V5IG9mIGV4aXN0aW5nS2V5cykgZGVsZXRlIGZyb250bWF0dGVyW2tleV07XG4gIGZvciAoY29uc3Qga2V5IG9mIHNvcnRlZEtleXMpIGZyb250bWF0dGVyW2tleV0gPSBzbmFwc2hvdFtrZXldO1xuICByZXR1cm4gdHJ1ZTtcbn1cblxuLy8gRm9yIGNhbGxlcnMgYWxyZWFkeSBpbnNpZGUgcHJvY2Vzc0Zyb250TWF0dGVyIChUWVAuanMpOiBUWVAgYW5kIFN1YnR5cCBhcmVcbi8vIHBhc3NlZCBleHBsaWNpdGx5LCBiZWNhdXNlIGluZGV4IGFuZCBjYWNoZSBkb24ndCBrbm93IHRoZSB2YWx1ZXMganVzdFxuLy8gd3JpdHRlbiB5ZXQuXG5mdW5jdGlvbiBzb3J0RnJvbnRtYXR0ZXJGb3IocGx1Z2luLCBmcm9udG1hdHRlciwgdHlwLCBzdWJ0eXApIHtcbiAgY29uc3QgZ2xvYmFsT3JkZXIgPSBub3JtYWxpemVHbG9iYWxPcmRlcihwbHVnaW4uc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcik7XG4gIHJldHVybiBzb3J0RnJvbnRtYXR0ZXJPYmplY3QoZnJvbnRtYXR0ZXIsIGdsb2JhbE9yZGVyLCBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCB0eXAsIHN1YnR5cCkpO1xufVxuXG4vLyBNb3ZlcyBvbmx5IGBrZXlgIHRvIGl0cyBzb3J0ZWQgcGxhY2UgYW5kIGxlYXZlcyBldmVyeSBvdGhlciBrZXkgd2hlcmUgaXQgaXNcbi8vIC0gZm9yIGNhbGxlcnMgdGhhdCBqdXN0IGFkZGVkIGEgcHJvcGVydHkgKEZyZWQncyBwcm9wZXJ0eSBiYWNrbGlua2luZykgYW5kXG4vLyBzaG91bGRuJ3QgcmVzaHVmZmxlIGEgZGVsaWJlcmF0ZWx5IGRpZmZlcmVudCBvcmRlci4gVFlQL1NVQlRZUCBhcmUgcmVhZCBmcm9tXG4vLyB0aGUgb2JqZWN0IGl0c2VsZjsgaW5kZXggYW5kIGNhY2hlIG1heSBzdGlsbCBiZSBiZWhpbmQuXG4vL1xuLy8gVGhlIHBsYWNlIGlzIHJpZ2h0IGFmdGVyIGtleSdzIG5lYXJlc3QgcHJlZGVjZXNzb3IgaW4gdGhlIGZ1bGx5IHNvcnRlZFxuLy8gb3JkZXIgKGZpcnN0IGlmIHRoZXJlIGlzIG5vbmUpLiBSZXR1cm5zIHRydWUgb24gYSBjaGFuZ2UuXG5mdW5jdGlvbiBwbGFjZVByb3BlcnR5Rm9yKHBsdWdpbiwgZnJvbnRtYXR0ZXIsIGtleSkge1xuICBjb25zdCBleGlzdGluZ0tleXMgPSBPYmplY3Qua2V5cyhmcm9udG1hdHRlcik7XG4gIGNvbnN0IGFjdHVhbEtleSA9IGV4aXN0aW5nS2V5cy5maW5kKChrKSA9PiBrLnRvTG93ZXJDYXNlKCkgPT09IGtleS50b0xvd2VyQ2FzZSgpKTtcbiAgaWYgKCFhY3R1YWxLZXkgfHwgZXhpc3RpbmdLZXlzLmxlbmd0aCA8PSAxKSByZXR1cm4gZmFsc2U7XG5cbiAgY29uc3QgZ2xvYmFsT3JkZXIgPSBub3JtYWxpemVHbG9iYWxPcmRlcihwbHVnaW4uc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcik7XG4gIGNvbnN0IHR5cCA9IHR5cEtleU9mKHByb3BlcnR5VmFsdWUoZnJvbnRtYXR0ZXIsIFRZUF9QUk9QRVJUWSkpO1xuICBjb25zdCBzdWJ0eXAgPSB0eXBLZXlPZihwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBTVUJUWVBfUFJPUEVSVFkpKTtcbiAgY29uc3Qgc29ydGVkS2V5cyA9IGNvbXB1dGVTb3J0ZWRLZXlzKGV4aXN0aW5nS2V5cywgZ2xvYmFsT3JkZXIsIG9yZGVyZWREZWZhdWx0S2V5cyhwbHVnaW4sIHR5cCwgc3VidHlwKSk7XG5cbiAgY29uc3QgcmVzdCA9IGV4aXN0aW5nS2V5cy5maWx0ZXIoKGspID0+IGsgIT09IGFjdHVhbEtleSk7XG4gIGNvbnN0IHByZWRlY2Vzc29yID0gc29ydGVkS2V5cy5zbGljZSgwLCBzb3J0ZWRLZXlzLmluZGV4T2YoYWN0dWFsS2V5KSkucG9wKCk7XG4gIGNvbnN0IG5ld0tleXMgPSBbLi4ucmVzdF07XG4gIG5ld0tleXMuc3BsaWNlKHByZWRlY2Vzc29yID09PSB1bmRlZmluZWQgPyAwIDogcmVzdC5pbmRleE9mKHByZWRlY2Vzc29yKSArIDEsIDAsIGFjdHVhbEtleSk7XG4gIGlmIChuZXdLZXlzLmV2ZXJ5KChrLCBpKSA9PiBrID09PSBleGlzdGluZ0tleXNbaV0pKSByZXR1cm4gZmFsc2U7XG5cbiAgY29uc3Qgc25hcHNob3QgPSB7IC4uLmZyb250bWF0dGVyIH07XG4gIGZvciAoY29uc3QgayBvZiBleGlzdGluZ0tleXMpIGRlbGV0ZSBmcm9udG1hdHRlcltrXTtcbiAgZm9yIChjb25zdCBrIG9mIG5ld0tleXMpIGZyb250bWF0dGVyW2tdID0gc25hcHNob3Rba107XG4gIHJldHVybiB0cnVlO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzb3J0U2luZ2xlRmlsZUZyb250bWF0dGVyKGFwcCwgcGx1Z2luLCBmaWxlKSB7XG4gIGNvbnN0IGdsb2JhbE9yZGVyID0gbm9ybWFsaXplR2xvYmFsT3JkZXIocGx1Z2luLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIpO1xuICAvLyBBbiB1bmNsZWFuIFRZUCB2YWx1ZSAobGlzdCwgcGFkZGVkKSBoYXMgbm8gVFlQLUZyb250bWF0dGVyOyBvbmx5IHRoZSBnbG9iYWxcbiAgLy8gb3JkZXIgYXBwbGllcyB0aGVuIChzZWUgdHlwS2V5T2YgaW4gdHlwLWluZGV4LmpzKS5cbiAgY29uc3QgdHlwID0gcGx1Z2luLnR5cEluZGV4LnR5cE9mKGZpbGUpO1xuICBjb25zdCB0eXBEZWZhdWx0S2V5cyA9IG9yZGVyZWREZWZhdWx0S2V5cyhwbHVnaW4sIHR5cCwgcGx1Z2luLnR5cEluZGV4LnN1YnR5cE9mKGZpbGUpKTtcbiAgcmV0dXJuIHNvcnRGaWxlRnJvbnRtYXR0ZXIoYXBwLCBmaWxlLCBnbG9iYWxPcmRlciwgdHlwRGVmYXVsdEtleXMpO1xufVxuXG4vLyBGcm9tIHRoaXMgbWFueSBub3RlcyB0byByZS1zb3J0IG9uLCBhIHJ1biBpcyBcImxhcmdlXCI6IGl0IGFza3MgZmlyc3QgKHNlZVxuLy8gcnVuRnJvbnRtYXR0ZXJTb3J0KSBhbmQgc2hvd3MgaXRzIHByb2dyZXNzIGluIGEgbm90aWNlLCB1cGRhdGVkIGV2ZXJ5XG4vLyBQUk9HUkVTU19TVEVQIG5vdGVzLiBPbmUgbnVtYmVyIGZvciBib3RoLCBzbyBhIHJ1biB0aGF0IGFza2VkIGFsc28gc2hvd3Ncbi8vIGhvdyBmYXIgaXQgZ290LCBhbmQgYSBzbWFsbCBvbmUgZG9lcyBuZWl0aGVyLlxuY29uc3QgTEFSR0VfU09SVF9USFJFU0hPTEQgPSA1MDtcbmNvbnN0IFBST0dSRVNTX1NURVAgPSAxMDtcblxuLy8gRmlyc3QgaGFsZiBvZiBhIHJ1biwgZnJvbSB0aGUgbWV0YWRhdGEgY2FjaGUgYWxvbmUgKG5vIG5vdGUgaXMgb3BlbmVkKTogaG93XG4vLyBtYW55IG5vdGVzIHRoZSBydW4gY2hlY2tzIGFuZCB3aGljaCBvZiB0aGVtIGl0IHdvdWxkIHJlLXNvcnQuXG4vLyBydW5Gcm9udG1hdHRlclNvcnQgY291bnRzIHdpdGggaXQgYmVmb3JlIGFza2luZzsgc29ydEFsbEZyb250bWF0dGVyIHdyaXRlc1xuLy8gZXhhY3RseSB0aGVzZSBjYW5kaWRhdGVzLlxuLy9cbi8vIG9ubHlUeXAgKG9wdGlvbmFsKSBsaW1pdHMgdGhlIHJ1biB0byBub3RlcyBvZiB0aGF0IFRZUC4gV2l0aG91dCBpdCBldmVyeVxuLy8gbm90ZSBpcyBjaGVja2VkLCBpbmNsdWRpbmcgbm90ZXMgd2l0aG91dCBhIFRZUDogcGlubmVkIHByb3BlcnRpZXMgc3VjaCBhc1xuLy8gY3NzY2xhc3NlcyBhcHBseSByZWdhcmRsZXNzIG9mIFRZUC5cbmZ1bmN0aW9uIHNvcnRDYW5kaWRhdGVzKGFwcCwgcGx1Z2luLCBvbmx5VHlwKSB7XG4gIGNvbnN0IGdsb2JhbE9yZGVyID0gbm9ybWFsaXplR2xvYmFsT3JkZXIocGx1Z2luLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIpO1xuICBsZXQgY2hlY2tlZCA9IDA7XG4gIGNvbnN0IGNhbmRpZGF0ZXMgPSBbXTtcblxuICBmb3IgKGNvbnN0IGZpbGUgb2YgYXBwLnZhdWx0LmdldE1hcmtkb3duRmlsZXMoKSkge1xuICAgIGlmICghcGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXMgJiYgYXBwLm1ldGFkYXRhQ2FjaGUuaXNVc2VySWdub3JlZChmaWxlLnBhdGgpKSBjb250aW51ZTtcblxuICAgIGNvbnN0IHR5cCA9IHBsdWdpbi50eXBJbmRleC50eXBPZihmaWxlKTtcbiAgICBpZiAob25seVR5cCAmJiB0eXAgIT09IG9ubHlUeXApIGNvbnRpbnVlO1xuXG4gICAgY29uc3QgdHlwRGVmYXVsdEtleXMgPSBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCB0eXAsIHBsdWdpbi50eXBJbmRleC5zdWJ0eXBPZihmaWxlKSk7XG4gICAgY2hlY2tlZCsrO1xuICAgIGlmIChjYWNoZU5lZWRzU29ydGluZyhhcHAsIGZpbGUsIGdsb2JhbE9yZGVyLCB0eXBEZWZhdWx0S2V5cykpIGNhbmRpZGF0ZXMucHVzaCh7IGZpbGUsIHR5cERlZmF1bHRLZXlzIH0pO1xuICB9XG5cbiAgcmV0dXJuIHsgY2hlY2tlZCwgY2FuZGlkYXRlcywgZ2xvYmFsT3JkZXIgfTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc29ydEFsbEZyb250bWF0dGVyKGFwcCwgcGx1Z2luLCBvbmx5VHlwKSB7XG4gIC8vIENvdW50ZWQgYWZyZXNoLCBub3QgdGFrZW4gb3ZlciBmcm9tIHJ1bkZyb250bWF0dGVyU29ydCdzIHF1ZXN0aW9uOiB0aGVcbiAgLy8gZGlhbG9nIG1heSBoYXZlIGJlZW4gb3BlbiBmb3IgYSB3aGlsZS5cbiAgY29uc3QgeyBjaGVja2VkLCBjYW5kaWRhdGVzLCBnbG9iYWxPcmRlciB9ID0gc29ydENhbmRpZGF0ZXMoYXBwLCBwbHVnaW4sIG9ubHlUeXApO1xuICAvLyBPbmx5IG1lYW5pbmdmdWwgZm9yIGEgc2luZ2xlIFRZUDogbGV0cyB0aGUgY29tbWFuZCBleHBsYWluIGEgcnVuIHRoYXRcbiAgLy8gY2hhbmdlZCBub3RoaW5nIGJlY2F1c2UgdGhlIFRZUCBoYXMgbm8gVFlQLUZyb250bWF0dGVyLlxuICBjb25zdCBoYXNUeXBEZWZhdWx0cyA9IG9ubHlUeXAgPyBvcmRlcmVkRGVmYXVsdEtleXMocGx1Z2luLCBvbmx5VHlwKSAhPT0gbnVsbCA6IG51bGw7XG5cbiAgY29uc3QgbGFiZWwgPSBvbmx5VHlwID8gYEZyb250bWF0dGVyIHNvcnRpbmcgJHtvbmx5VHlwfWAgOiBcIkZyb250bWF0dGVyIHNvcnRpbmdcIjtcbiAgY29uc3QgcHJvZ3Jlc3NUZXh0ID0gKGRvbmUpID0+IGAke2xhYmVsfTogJHtkb25lfSBvZiAke3BsdXJhbChjYW5kaWRhdGVzLmxlbmd0aCwgXCJub3RlXCIpfVx1MjAyNmA7XG4gIC8vIER1cmF0aW9uIDA6IHN0YXlzIHVudGlsIGhpZGRlbiBiZWxvdywgYSB0aW1lZCBvbmUgY291bGQgdmFuaXNoIG1pZC1ydW4uXG4gIGNvbnN0IG5vdGljZSA9IGNhbmRpZGF0ZXMubGVuZ3RoID49IExBUkdFX1NPUlRfVEhSRVNIT0xEID8gbmV3IE5vdGljZShwcm9ncmVzc1RleHQoMCksIDApIDogbnVsbDtcblxuICBsZXQgY2hhbmdlZCA9IDA7XG4gIHRyeSB7XG4gICAgZm9yIChjb25zdCBbaW5kZXgsIHsgZmlsZSwgdHlwRGVmYXVsdEtleXMgfV0gb2YgY2FuZGlkYXRlcy5lbnRyaWVzKCkpIHtcbiAgICAgIC8vIHNvcnRGaWxlRnJvbnRtYXR0ZXIgY2hlY2tzIHRoZSBjYWNoZSBvbmNlIG1vcmUgLSBhIG5vdGUgbWF5IGhhdmUgYmVlblxuICAgICAgLy8gc29ydGVkIG9yIGVkaXRlZCBzaW5jZSB0aGUgY291bnQuXG4gICAgICBpZiAoYXdhaXQgc29ydEZpbGVGcm9udG1hdHRlcihhcHAsIGZpbGUsIGdsb2JhbE9yZGVyLCB0eXBEZWZhdWx0S2V5cykpIGNoYW5nZWQrKztcbiAgICAgIGlmIChub3RpY2UgJiYgKGluZGV4ICsgMSkgJSBQUk9HUkVTU19TVEVQID09PSAwKSBub3RpY2Uuc2V0TWVzc2FnZShwcm9ncmVzc1RleHQoaW5kZXggKyAxKSk7XG4gICAgfVxuICB9IGZpbmFsbHkge1xuICAgIG5vdGljZT8uaGlkZSgpO1xuICB9XG5cbiAgcmV0dXJuIHsgY2hlY2tlZCwgY2hhbmdlZCwgaGFzVHlwRGVmYXVsdHMgfTtcbn1cblxuLy8gUmVzb2x2ZXMgdHJ1ZSBmb3IgXCJTb3J0XCIsIGZhbHNlIGZvciBDYW5jZWwsIEVzY2FwZSBvciBhIGNsaWNrIG91dHNpZGUuXG5mdW5jdGlvbiBjb25maXJtTGFyZ2VTb3J0KHBsdWdpbiwgb25seVR5cCwgY291bnQsIGNoZWNrZWQpIHtcbiAgY29uc3Qgbm91biA9IGNoZWNrZWQgPT09IDEgPyBcIm5vdGVcIiA6IFwibm90ZXNcIjtcbiAgY29uc3QgdGl0bGUgPSBvbmx5VHlwXG4gICAgPyBbYFJlLXNvcnQgJHtjb3VudH0gb2YgJHtjaGVja2VkfSBgLCB0eXBOYW1lTm9kZShwbHVnaW4sIG9ubHlUeXAsIHBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbb25seVR5cF0gPz8gbnVsbCksIGAgJHtub3VufT9gXVxuICAgIDogYFJlLXNvcnQgJHtjb3VudH0gb2YgJHtjaGVja2VkfSAke25vdW59P2A7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT5cbiAgICBuZXcgQ29uZmlybU1vZGFsKHBsdWdpbi5hcHAsIHtcbiAgICAgIHRpdGxlLFxuICAgICAgYm9keTogW1wiT25seSB0aGUgb3JkZXIgb2YgdGhlaXIgcHJvcGVydGllcyBjaGFuZ2VzLCB2YWx1ZXMgc3RheSBhcyB0aGV5IGFyZS5cIl0sXG4gICAgICBjb25maXJtVGV4dDogXCJTb3J0XCIsXG4gICAgICAvLyBMaWtlIFwiUmVuYW1lIGFuZCB1cGRhdGUgbm90ZXNcIjogRW50ZXIgY29uZmlybXMgdGhlIHJ1biBqdXN0IGFza2VkIGZvci5cbiAgICAgIGZvY3VzOiBcImNvbmZpcm1cIixcbiAgICAgIG9uQ29uZmlybTogKCkgPT4gcmVzb2x2ZSh0cnVlKSxcbiAgICAgIG9uQ2FuY2VsOiAoKSA9PiByZXNvbHZlKGZhbHNlKSxcbiAgICB9KS5vcGVuKClcbiAgKTtcbn1cblxuLy8gVGhlIG9uZSBlbnRyeSBwb2ludCBvZiBldmVyeSBzb3J0aW5nIHJ1biBvdmVyIG1hbnkgbm90ZXM6IHRoZSBjb21tYW5kcyBcIlNvcnRcbi8vIGZyb250bWF0dGVyIGluIGFsbCBub3Rlc1wiIGFuZCBcIlNvcnQgZnJvbnRtYXR0ZXIgZm9yIG9uZSBUWVBcIiAoYWZ0ZXIgaXRzXG4vLyBwaWNrZXIpLCB0aGUgcGxheSBidXR0b24gb2YgdGhlIGdsb2JhbCBvcmRlciBhbmQgdGhlIFRZUC1QYW5lJ3MgY29udGV4dFxuLy8gbWVudS4gb25seVR5cCBudWxsID0gYWxsIG5vdGVzLlxuLy9cbi8vIEEgbGFyZ2UgcnVuIChMQVJHRV9TT1JUX1RIUkVTSE9MRCBub3RlcyB0byByZS1zb3J0LCBjb3VudGVkIGZyb20gdGhlIGNhY2hlKVxuLy8gYXNrcyBmaXJzdDsgdGhlIHF1ZXN0aW9uIGNhbid0IGJlIHN3aXRjaGVkIG9mZiwgdGhlIHJ1biByZXdyaXRlcyBub3RlcyBhbmRcbi8vIGhhcyBubyB1bmRvLiBBIHNtYWxsIG9uZSBqdXN0IHJ1bnMuIEVpdGhlciB3YXkgYSBub3RpY2UgcmVwb3J0cyB0aGUgcmVzdWx0LlxuYXN5bmMgZnVuY3Rpb24gcnVuRnJvbnRtYXR0ZXJTb3J0KHBsdWdpbiwgb25seVR5cCA9IG51bGwpIHtcbiAgY29uc3QgeyBjaGVja2VkLCBjYW5kaWRhdGVzIH0gPSBzb3J0Q2FuZGlkYXRlcyhwbHVnaW4uYXBwLCBwbHVnaW4sIG9ubHlUeXApO1xuICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPj0gTEFSR0VfU09SVF9USFJFU0hPTEQgJiYgIShhd2FpdCBjb25maXJtTGFyZ2VTb3J0KHBsdWdpbiwgb25seVR5cCwgY2FuZGlkYXRlcy5sZW5ndGgsIGNoZWNrZWQpKSkgcmV0dXJuO1xuXG4gIGNvbnN0IHsgY2hhbmdlZCwgaGFzVHlwRGVmYXVsdHMsIGNoZWNrZWQ6IGNoZWNrZWROb3cgfSA9IGF3YWl0IHNvcnRBbGxGcm9udG1hdHRlcihwbHVnaW4uYXBwLCBwbHVnaW4sIG9ubHlUeXApO1xuICBsZXQgbWVzc2FnZSA9IHNvcnRTdW1tYXJ5KG9ubHlUeXAgPyBgRnJvbnRtYXR0ZXIgc29ydGluZyAke29ubHlUeXB9YCA6IFwiRnJvbnRtYXR0ZXIgc29ydGluZ1wiLCBjaGVja2VkTm93LCBjaGFuZ2VkKTtcbiAgLy8gTm90IGFuIGVycm9yLCBidXQgZXhwbGFpbnMgd2h5IG5vdGhpbmcgbWF5IGhhdmUgY2hhbmdlZC5cbiAgaWYgKGhhc1R5cERlZmF1bHRzID09PSBmYWxzZSkge1xuICAgIG1lc3NhZ2UgKz0gYCBOb3RlOiAke29ubHlUeXB9IGhhcyBubyBUWVAtRnJvbnRtYXR0ZXIsIHNvIG9ubHkgdGhlIGdsb2JhbCBvcmRlciB3YXMgYXBwbGllZC5gO1xuICB9XG4gIG5ldyBOb3RpY2UobWVzc2FnZSk7XG59XG5cbi8vIFJlc3VsdCBub3RpY2Ugb2YgYSBzb3J0aW5nIHJ1biBvdmVyIG1hbnkgbm90ZXMgKHJ1bkZyb250bWF0dGVyU29ydCkuXG5mdW5jdGlvbiBzb3J0U3VtbWFyeShsYWJlbCwgY2hlY2tlZCwgY2hhbmdlZCkge1xuICByZXR1cm4gY2hhbmdlZCA+IDBcbiAgICA/IGAke2xhYmVsfTogY2hlY2tlZCAke3BsdXJhbChjaGVja2VkLCBcIm5vdGVcIil9LCBzb3J0ZWQgJHtjaGFuZ2VkfS5gXG4gICAgOiBgJHtsYWJlbH06IGNoZWNrZWQgJHtwbHVyYWwoY2hlY2tlZCwgXCJub3RlXCIpfSwgYWxsIGFscmVhZHkgc29ydGVkLmA7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBzb3J0U2luZ2xlRmlsZUZyb250bWF0dGVyLFxuICBydW5Gcm9udG1hdHRlclNvcnQsXG4gIHNvcnRGcm9udG1hdHRlckZvcixcbiAgcGxhY2VQcm9wZXJ0eUZvcixcbiAgbm9ybWFsaXplR2xvYmFsT3JkZXIsXG4gIERFRkFVTFRfR0xPQkFMX09SREVSLFxuICBUWVBfUFJPUEVSVFksXG4gIFNVQlRZUF9QUk9QRVJUWSxcbn07XG4iLCAiY29uc3QgeyBzZXRJY29uLCBOb3RpY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFksIHJ1bkZyb250bWF0dGVyU29ydCB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItc29ydFwiKTtcblxuLy8gTGFiZWxzIG9mIHRoZSBmb3VyIHBsYWNlaG9sZGVyIHJvd3M7IGNvbXB1dGVTb3J0ZWRLZXlzIGluIGZyb250bWF0dGVyLXNvcnQuanNcbi8vIHJlc29sdmVzIHdoYXQgZWFjaCBvbmUgc3RhbmRzIGZvci5cbmNvbnN0IFBMQUNFSE9MREVSX0xBQkVMUyA9IHtcbiAgdHlwVmFsdWU6IFwiVFlQXCIsXG4gIHN1YnR5cFZhbHVlOiBcIlNVQlRZUFwiLFxuICB0eXA6IFwiVFlQLUZyb250bWF0dGVyXCIsXG4gIG90aGVyOiBcIk90aGVyIHByb3BlcnRpZXNcIixcbn07XG5cbi8vIFdoYXQgZWFjaCBwbGFjZWhvbGRlciByb3cgc3RhbmRzIGZvciwgYXMgaXRzIHRvb2x0aXAgLSB0aGUgc2V0dGluZydzXG4vLyBkZXNjcmlwdGlvbiBiZWxvdyB0aGUgbGlzdCBzdGF5cyBzaG9ydCB0aGF0IHdheS5cbmNvbnN0IFBMQUNFSE9MREVSX0RFU0NSSVBUSU9OUyA9IHtcbiAgdHlwVmFsdWU6IFwiVGhlIFRZUCBwcm9wZXJ0eSBpdHNlbGYuXCIsXG4gIHN1YnR5cFZhbHVlOiBcIlRoZSBTVUJUWVAgcHJvcGVydHkgaXRzZWxmLlwiLFxuICB0eXA6IFwiVGhlIFRZUCdzIFRZUC1Gcm9udG1hdHRlciBsaXN0LCBmb2xsb3dlZCBieSB0aGUgbm90ZSdzIFN1YnR5cCBibG9jay5cIixcbiAgb3RoZXI6IFwiRXZlcnkgcHJvcGVydHkgbm90IHBsYWNlZCBieSBhbm90aGVyIHJvdy5cIixcbn07XG5cbi8vIEVkaXRvciBmb3Igc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcjogYSBwbGFpbiBsaXN0IG9mIG5hbWVzIHdpdGggZHJhZyAmXG4vLyBkcm9wLiBJdCBob2xkcyBubyB2YWx1ZXMsIHNvIHVubGlrZSB0eXAtZnJvbnRtYXR0ZXItZWRpdG9yLmpzIGl0IG5lZWRzIG5vXG4vLyBkZXRvdXIgdGhyb3VnaCBPYnNpZGlhbidzIHByaXZhdGUgcHJvcGVydHkgd2lkZ2V0LiBUaGUgcGxhY2Vob2xkZXIgcm93cyBjYW5cbi8vIGJlIG1vdmVkIGJ1dCBub3QgcmVtb3ZlZC5cbmZ1bmN0aW9uIG1vdW50R2xvYmFsT3JkZXJFZGl0b3IoY29udGFpbmVyRWwsIHBsdWdpbikge1xuICBjb25zdCBoZWFkZXIgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLWhlYWRlclwiIH0pO1xuXG4gIC8vIEJ1dHRvbiBhbmQgdGl0bGUgc2hhcmUgYSBncm91cDogdGhlIGhlYWRlciB1c2VzIHNwYWNlLWJldHdlZW4sIHNvIGEgdGhpcmRcbiAgLy8gZGlyZWN0IGNoaWxkIHdvdWxkIGZsb2F0IGluIHRoZSBtaWRkbGUgaW5zdGVhZCBvZiBuZXh0IHRvIHRoZSB0aXRsZS5cbiAgY29uc3QgdGl0bGVHcm91cCA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLXRpdGxlLWdyb3VwXCIgfSk7XG5cbiAgLy8gU2FtZSBydW4gYXMgdGhlIFwiU29ydCBmcm9udG1hdHRlciBpbiBhbGwgbm90ZXNcIiBjb21tYW5kLCBpbmNsdWRpbmcgaXRzXG4gIC8vIHF1ZXN0aW9uIGJlZm9yZSBhIGxhcmdlIHJ1biAoc2VlIHJ1bkZyb250bWF0dGVyU29ydCkuXG4gIGNvbnN0IGFwcGx5QnRuID0gdGl0bGVHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb25cIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJBcHBseSB0byBhbGwgbm90ZXNcIiB9IH0pO1xuICBzZXRJY29uKGFwcGx5QnRuLCBcInBsYXlcIik7XG4gIGFwcGx5QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHJ1bkZyb250bWF0dGVyU29ydChwbHVnaW4sIG51bGwpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiW0Zyb250bWF0dGVyIHNvcnRpbmddXCIsIGVycm9yKTtcbiAgICAgIG5ldyBOb3RpY2UoYEZyb250bWF0dGVyIHNvcnRpbmcgZmFpbGVkOiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgfVxuICB9KTtcblxuICB0aXRsZUdyb3VwLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZGV0YWlsLXNlY3Rpb24tdGl0bGVcIiwgdGV4dDogXCJHbG9iYWwgcHJvcGVydHkgb3JkZXJcIiB9KTtcblxuICBjb25zdCBhZGRCdG4gPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uXCIsIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiQWRkIHByb3BlcnR5XCIgfSB9KTtcbiAgc2V0SWNvbihhZGRCdG4sIFwicGx1c1wiKTtcblxuICBjb25zdCBsaXN0RWwgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLW9yZGVyLWxpc3RcIiB9KTtcblxuICBjb25zdCBvcmRlciA9ICgpID0+IHBsdWdpbi5zZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyO1xuXG4gIC8vIEEgbmV3IHJvdyBvbmx5IGpvaW5zIGdsb2JhbFByb3BlcnR5T3JkZXIgb25jZSBpdCBoYXMgYSB2YWxpZCBuYW1lLiBVbnRpbFxuICAvLyB0aGVuIGl0IGlzIGEgbG9jYWwgZHJhZnQgYXBwZW5kZWQgb24gcmVuZGVyLCBzbyBhbiBlbXB0eSBuYW1lIG5ldmVyIGVuZHNcbiAgLy8gdXAgaW4gdGhlIHNldHRpbmdzLCBldmVuIGlmIHNvbWV0aGluZyBlbHNlIHNhdmVzIGluIGJldHdlZW4uXG4gIGxldCBkcmFmdEVudHJ5ID0gbnVsbDtcblxuICBjb25zdCBpc0R1cGxpY2F0ZU5hbWUgPSAodmFsdWUsIG93bkVudHJ5KSA9PiB7XG4gICAgY29uc3QgbG93ZXIgPSB2YWx1ZS50b0xvd2VyQ2FzZSgpO1xuICAgIGlmIChsb3dlciA9PT0gVFlQX1BST1BFUlRZLnRvTG93ZXJDYXNlKCkgfHwgbG93ZXIgPT09IFNVQlRZUF9QUk9QRVJUWS50b0xvd2VyQ2FzZSgpKSByZXR1cm4gdHJ1ZTtcbiAgICByZXR1cm4gb3JkZXIoKS5zb21lKChvdGhlcikgPT4gb3RoZXIgIT09IG93bkVudHJ5ICYmIG90aGVyLmtpbmQgPT09IFwicHJvcGVydHlcIiAmJiBvdGhlci5uYW1lLnRvTG93ZXJDYXNlKCkgPT09IGxvd2VyKTtcbiAgfTtcblxuICBjb25zdCByZW5kZXIgPSAoKSA9PiB7XG4gICAgbGlzdEVsLmVtcHR5KCk7XG4gICAgY29uc3QgZW50cmllcyA9IGRyYWZ0RW50cnkgPyBbLi4ub3JkZXIoKSwgZHJhZnRFbnRyeV0gOiBvcmRlcigpO1xuXG4gICAgZW50cmllcy5mb3JFYWNoKChlbnRyeSwgaW5kZXgpID0+IHtcbiAgICAgIGNvbnN0IGlzRHJhZnQgPSBlbnRyeSA9PT0gZHJhZnRFbnRyeTtcbiAgICAgIGNvbnN0IGlzUGxhY2Vob2xkZXIgPSBlbnRyeS5raW5kICE9PSBcInByb3BlcnR5XCI7XG4gICAgICBjb25zdCByb3dDbHMgPVxuICAgICAgICBcInR5cC1vcmRlci1yb3dcIiArIChpc1BsYWNlaG9sZGVyID8gXCIgaXMtcGxhY2Vob2xkZXJcIiA6IFwiXCIpICsgKGVudHJ5LmtpbmQgPT09IFwidHlwXCIgPyBcIiBpcy10eXAtZGVmYXVsdHNcIiA6IFwiXCIpO1xuICAgICAgY29uc3Qgcm93ID0gbGlzdEVsLmNyZWF0ZURpdih7IGNsczogcm93Q2xzIH0pO1xuXG4gICAgICBjb25zdCBkcmFnSGFuZGxlID0gcm93LmNyZWF0ZURpdih7IGNsczogXCJ0eXAtb3JkZXItZHJhZ1wiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkRyYWcgdG8gbW92ZVwiIH0gfSk7XG4gICAgICBzZXRJY29uKGRyYWdIYW5kbGUsIFwiZ3JpcC12ZXJ0aWNhbFwiKTtcblxuICAgICAgaWYgKGlzUGxhY2Vob2xkZXIpIHtcbiAgICAgICAgLy8gT24gdGhlIGxhYmVsLCBub3QgdGhlIHJvdzogdGhlIGRyYWcgaGFuZGxlIGhhcyBhIHRvb2x0aXAgb2YgaXRzIG93bi5cbiAgICAgICAgcm93LmNyZWF0ZURpdih7XG4gICAgICAgICAgY2xzOiBcInR5cC1vcmRlci1sYWJlbFwiLFxuICAgICAgICAgIHRleHQ6IFBMQUNFSE9MREVSX0xBQkVMU1tlbnRyeS5raW5kXSxcbiAgICAgICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBQTEFDRUhPTERFUl9ERVNDUklQVElPTlNbZW50cnkua2luZF0gfSxcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBpbnB1dCA9IHJvdy5jcmVhdGVFbChcImlucHV0XCIsIHtcbiAgICAgICAgICB0eXBlOiBcInRleHRcIixcbiAgICAgICAgICBjbHM6IFwidHlwLW9yZGVyLW5hbWUtaW5wdXRcIixcbiAgICAgICAgICBhdHRyOiB7IHBsYWNlaG9sZGVyOiBcIlByb3BlcnR5IG5hbWVcIiB9LFxuICAgICAgICB9KTtcbiAgICAgICAgaW5wdXQudmFsdWUgPSBlbnRyeS5uYW1lO1xuXG4gICAgICAgIC8vIFwiYmx1clwiLCBub3QgXCJjaGFuZ2VcIjogY2hhbmdlIGRvZXNuJ3QgZmlyZSBmb3IgYSBmaWVsZCBsZWZ0IGVtcHR5LCBzb1xuICAgICAgICAvLyB0aGUgZHJhZnQgd291bGQgbmV2ZXIgYmUgY2xlYW5lZCB1cC5cbiAgICAgICAgaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImJsdXJcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IHZhbHVlID0gaW5wdXQudmFsdWUudHJpbSgpO1xuXG4gICAgICAgICAgaWYgKCF2YWx1ZSkge1xuICAgICAgICAgICAgaWYgKGlzRHJhZnQpIHtcbiAgICAgICAgICAgICAgZHJhZnRFbnRyeSA9IG51bGw7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBvcmRlcigpLnNwbGljZShvcmRlcigpLmluZGV4T2YoZW50cnkpLCAxKTtcbiAgICAgICAgICAgICAgYXdhaXQgcGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVuZGVyKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGlzRHVwbGljYXRlTmFtZSh2YWx1ZSwgaXNEcmFmdCA/IG51bGwgOiBlbnRyeSkpIHtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoYFwiJHt2YWx1ZX1cIiBpcyBhbHJlYWR5IGluIHRoZSBsaXN0LmApO1xuICAgICAgICAgICAgaW5wdXQudmFsdWUgPSBlbnRyeS5uYW1lO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGVudHJ5Lm5hbWUgPSB2YWx1ZTtcbiAgICAgICAgICBpZiAoaXNEcmFmdCkge1xuICAgICAgICAgICAgb3JkZXIoKS5wdXNoKGVudHJ5KTtcbiAgICAgICAgICAgIGRyYWZ0RW50cnkgPSBudWxsO1xuICAgICAgICAgIH1cbiAgICAgICAgICBhd2FpdCBwbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgcmVuZGVyKCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0IHJlbW92ZUJ0biA9IHJvdy5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLW9yZGVyLXJlbW92ZSBjbGlja2FibGUtaWNvblwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlJlbW92ZVwiIH0gfSk7XG4gICAgICAgIHNldEljb24ocmVtb3ZlQnRuLCBcInhcIik7XG4gICAgICAgIHJlbW92ZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGlmIChpc0RyYWZ0KSB7XG4gICAgICAgICAgICBkcmFmdEVudHJ5ID0gbnVsbDtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgb3JkZXIoKS5zcGxpY2Uob3JkZXIoKS5pbmRleE9mKGVudHJ5KSwgMSk7XG4gICAgICAgICAgICBhd2FpdCBwbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJlbmRlcigpO1xuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgLy8gQSBkcmFmdCBoYXMgbm8gcGxhY2UgaW4gdGhlIHJlYWwgbGlzdCB5ZXQsIHNvIGl0IGNhbid0IGJlIG1vdmVkLlxuICAgICAgaWYgKGlzRHJhZnQpIHJldHVybjtcblxuICAgICAgcm93LmRyYWdnYWJsZSA9IHRydWU7XG4gICAgICByb3cuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdzdGFydFwiLCAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQuZGF0YVRyYW5zZmVyLmVmZmVjdEFsbG93ZWQgPSBcIm1vdmVcIjtcbiAgICAgICAgZXZlbnQuZGF0YVRyYW5zZmVyLnNldERhdGEoXCJ0ZXh0L3BsYWluXCIsIFN0cmluZyhpbmRleCkpO1xuICAgICAgICByb3cuY2xhc3NMaXN0LmFkZChcImlzLWRyYWdnaW5nXCIpO1xuICAgICAgfSk7XG4gICAgICByb3cuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdlbmRcIiwgKCkgPT4gcm93LmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcmFnZ2luZ1wiKSk7XG4gICAgICByb3cuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdvdmVyXCIsIChldmVudCkgPT4ge1xuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAvLyBVcHBlciBvciBsb3dlciBoYWxmIGRlY2lkZXMgYmVmb3JlL2FmdGVyIC0gb3RoZXJ3aXNlIG5vdGhpbmcgY291bGRcbiAgICAgICAgLy8gYmUgZHJvcHBlZCBiZWxvdyB0aGUgbGFzdCByb3cuXG4gICAgICAgIGNvbnN0IHJlY3QgPSByb3cuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICAgIGNvbnN0IGlzQWZ0ZXIgPSBldmVudC5jbGllbnRZIC0gcmVjdC50b3AgPiByZWN0LmhlaWdodCAvIDI7XG4gICAgICAgIHJvdy5jbGFzc0xpc3QudG9nZ2xlKFwiaXMtZHJvcC1iZWZvcmVcIiwgIWlzQWZ0ZXIpO1xuICAgICAgICByb3cuY2xhc3NMaXN0LnRvZ2dsZShcImlzLWRyb3AtYWZ0ZXJcIiwgaXNBZnRlcik7XG4gICAgICB9KTtcbiAgICAgIHJvdy5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ2xlYXZlXCIsICgpID0+IHJvdy5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJvcC1iZWZvcmVcIiwgXCJpcy1kcm9wLWFmdGVyXCIpKTtcbiAgICAgIHJvdy5hZGRFdmVudExpc3RlbmVyKFwiZHJvcFwiLCBhc3luYyAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgY29uc3QgaXNBZnRlciA9IHJvdy5jbGFzc0xpc3QuY29udGFpbnMoXCJpcy1kcm9wLWFmdGVyXCIpO1xuICAgICAgICByb3cuY2xhc3NMaXN0LnJlbW92ZShcImlzLWRyb3AtYmVmb3JlXCIsIFwiaXMtZHJvcC1hZnRlclwiKTtcblxuICAgICAgICBjb25zdCBmcm9tSW5kZXggPSBOdW1iZXIoZXZlbnQuZGF0YVRyYW5zZmVyLmdldERhdGEoXCJ0ZXh0L3BsYWluXCIpKTtcbiAgICAgICAgaWYgKE51bWJlci5pc05hTihmcm9tSW5kZXgpKSByZXR1cm47XG5cbiAgICAgICAgLy8gVGFyZ2V0IGluZGV4IGNvdW50ZWQgYmVmb3JlIGZyb21JbmRleCBpcyByZW1vdmVkLlxuICAgICAgICBsZXQgaW5zZXJ0QmVmb3JlID0gaXNBZnRlciA/IGluZGV4ICsgMSA6IGluZGV4O1xuICAgICAgICBpZiAoZnJvbUluZGV4IDwgaW5zZXJ0QmVmb3JlKSBpbnNlcnRCZWZvcmUgLT0gMTtcblxuICAgICAgICBjb25zdCBbbW92ZWRdID0gb3JkZXIoKS5zcGxpY2UoZnJvbUluZGV4LCAxKTtcbiAgICAgICAgb3JkZXIoKS5zcGxpY2UoaW5zZXJ0QmVmb3JlLCAwLCBtb3ZlZCk7XG4gICAgICAgIGF3YWl0IHBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgcmVuZGVyKCk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfTtcblxuICBhZGRCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICBpZiAoIWRyYWZ0RW50cnkpIHtcbiAgICAgIGRyYWZ0RW50cnkgPSB7IGtpbmQ6IFwicHJvcGVydHlcIiwgbmFtZTogXCJcIiB9O1xuICAgICAgcmVuZGVyKCk7XG4gICAgfVxuICAgIGNvbnN0IGlucHV0cyA9IGxpc3RFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLnR5cC1vcmRlci1uYW1lLWlucHV0XCIpO1xuICAgIGlucHV0c1tpbnB1dHMubGVuZ3RoIC0gMV0/LmZvY3VzKCk7XG4gIH0pO1xuXG4gIHJlbmRlcigpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgbW91bnRHbG9iYWxPcmRlckVkaXRvciB9O1xuIiwgImNvbnN0IHsgUGx1Z2luU2V0dGluZ1RhYiwgU2V0dGluZ0dyb3VwLCBUb2dnbGVDb21wb25lbnQsIERyb3Bkb3duQ29tcG9uZW50LCBkZWJvdW5jZSB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBtb3VudEdsb2JhbE9yZGVyRWRpdG9yIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1vcmRlci1lZGl0b3JcIik7XG5jb25zdCB7IERFRkFVTFRfR0xPQkFMX09SREVSIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1zb3J0XCIpO1xuY29uc3QgeyBTVUJUWVBfQ09MT1JfQ0hBTk5FTFMsIERFRkFVTFRfU1VCVFlQX0NPTE9SX1JBTkdFUywgY29sb3JSYW5nZSB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxuY29uc3QgREVGQVVMVF9TRVRUSU5HUyA9IHtcbiAgdHlwczogW10sXG4gIHR5cENvbG9yczoge30sXG4gIHR5cERlc2NyaXB0aW9uczoge30sXG4gIHR5cERlZmF1bHRGcm9udG1hdHRlcjoge30sXG4gIC8vIEtleXMgb2YgdHlwRGVmYXVsdEZyb250bWF0dGVyW3R5cF0gbWFya2VkIGFzIGZsb2F0aW5nLiBUaGV5IHNoYXJlIHRoZSBsaXN0XG4gIC8vIGFuZCBpdHMgb3JkZXIgKHdoaWNoIGZyb250bWF0dGVyIHNvcnRpbmcgdXNlcyksIGJ1dCBnZXRUeXBEZWZhdWx0cygpIGxlYXZlc1xuICAvLyB0aGVtIG91dCB1bmxlc3MgYXNrZWQgd2l0aCBpbmNsdWRlRmxvYXRpbmcsIHNvIG5ldyBub3RlcyBkb24ndCBnZXQgdGhlbVxuICAvLyBhdXRvbWF0aWNhbGx5LlxuICB0eXBGbG9hdGluZ0tleXM6IHt9LFxuICAvLyBTaG9ydGN1dHMgcGVyIGtleSBvZiB0eXBEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwXTpcbiAgLy8gICB7IFtUWVBdOiB7IFtQcm9wZXJ0eV06IHsgbmFtZTogXCJ0b2RheVwiIHwgXCJ0cC48c2NyaXB0PlwiIH0gfSB9XG4gIC8vIEtlcHQgTkVYVCBUTyB0aGUgZnJvbnRtYXR0ZXIsIG5vdCBhcyBpdHMgdmFsdWUgLSBzZWUgc2hvcnRjdXRzLmpzLlxuICB0eXBTaG9ydGN1dHM6IHt9LFxuICB0eXBNYW51YWw6IHt9LFxuICAvLyBSZWdpc3RlcmVkIFN1YnR5cHMgcGVyIFRZUCB3aXRoIHRoZWlyIG93biBmcm9udG1hdHRlciBibG9jaywgc2VlIHN1YnR5cHMuanMuXG4gIHR5cFN1YnR5cHM6IHt9LFxuICAvLyBQaW5uZWQgc2luZ2xlIHByb3BlcnRpZXMgKGtpbmQ6IFwicHJvcGVydHlcIikgcGx1cyB0aGUgZm91ciBmaXhlZFxuICAvLyBwbGFjZWhvbGRlcnMgXCJ0eXBWYWx1ZVwiLCBcInN1YnR5cFZhbHVlXCIsIFwidHlwXCIgYW5kIFwib3RoZXJcIiAtIHNlZVxuICAvLyBmcm9udG1hdHRlci1zb3J0LmpzLlxuICBnbG9iYWxQcm9wZXJ0eU9yZGVyOiBERUZBVUxUX0dMT0JBTF9PUkRFUixcbiAgLy8gSG93IHRoZSBvcGVuIG5vdGUgc2hvd3MgaXRzIFRZUCAoc2VlIGFjdGl2ZS10aXRsZS1jb2xvcnMuanMpOiBcIm5vbmVcIixcbiAgLy8gXCJkb3RcIiBvciBcImJhZGdlXCIuIFRoZSB0aHJlZSBiYWRnZSBzZXR0aW5ncyBiZWxvdyBvbmx5IG1hdHRlciBmb3IgXCJiYWRnZVwiLlxuICAvLyBjb2xvclZpZXdzLm5vdGVUaXRsZUNvbG9yICh0aGUgdGl0bGUgdGV4dCBpdHNlbGYpIGlzIGluZGVwZW5kZW50LlxuICBub3RlVGl0bGVTdHlsZTogXCJkb3RcIixcbiAgLy8gQmFkZ2UgY29sb3JlZCAoVFlQIGNvbG9yKSBvciBuZXV0cmFsICh0ZXh0LW11dGVkKS5cbiAgbm90ZVRpdGxlQmFkZ2VDb2xvcmVkOiB0cnVlLFxuICAvLyBCYWRnZSBsYWJlbDogXCJ0eXBcIiAoW1RZUF0pLCBcInR5cC1zdWJ0eXBcIiAoW1RZUC9TdWJ0eXBdKSBvciBcInN1YnR5cFwiXG4gIC8vIChbU3VidHlwXTsgbm8gYmFkZ2Ugd2l0aG91dCBhIFN1YnR5cCkuIENvbG9yZWQgaW4gdGhlIFRZUCBvciBTdWJ0eXAgY29sb3I7XG4gIC8vIGZvciBcInR5cC1zdWJ0eXBcIiBjaG9zZW4gd2l0aCBjb2xvclZpZXdzLm5vdGVUaXRsZU1hcmtlclN1YnR5cC5cbiAgbm90ZVRpdGxlQmFkZ2VMYWJlbDogXCJ0eXBcIixcbiAgLy8gXCJ0aXRsZVwiIChuZXh0IHRvIHRoZSBpbmxpbmUgdGl0bGUpIG9yIFwiYmxvY2tcIiAobGVmdCBvZiB0aGUgcHJvcGVydHlcbiAgLy8gYmxvY2ssIHR1cm5lZCA5MFx1MDBCMCkuXG4gIG5vdGVUaXRsZUJhZGdlUG9zaXRpb246IFwidGl0bGVcIixcbiAgLy8gRm9yIHBvc2l0aW9uIFwiYmxvY2tcIjogdG9wIG9yIGJvdHRvbSBlZGdlIG9mIHRoZSBwcm9wZXJ0eSBibG9jay5cbiAgbm90ZVRpdGxlVmVydGljYWxBbGlnbjogXCJ0b3BcIixcbiAgdHlwU29ydE9yZGVyOiBcImNvdW50LWRlc2NcIixcbiAgLy8gV2hhdCB0aGUgVFlQLUxpc3Qgc2hvd3MgbmV4dCB0byB0aGUgbmFtZTogXCJzdWJ0eXBzXCIsIFwiZGVzY3JpcHRpb25cIiBvclxuICAvLyBcIm5vbmVcIi4gU3dpdGNoZWQgYnkgdGhlIGhlYWRlciBidXR0b24gbmV4dCB0byBzb3J0aW5nIChTRUNPTkRBUllfTU9ERVMgaW5cbiAgLy8gdHlwLXBhbmUuanMpLCBub3QgaGVyZTogbGlrZSB0aGUgc29ydCBvcmRlciBpdCBvbmx5IGNvbmNlcm5zIHRoYXQgbGlzdC5cbiAgdHlwTGlzdFNlY29uZGFyeTogXCJzdWJ0eXBzXCIsXG4gIC8vIFNlZSBwaWNrVHlwQW5kU3VidHlwIGluIHR5cC1waWNrZXIuanM6IGZhbHNlID0gZWFjaCBTdWJ0eXAgaW5kZW50ZWQgaW4gdGhlXG4gIC8vIFRZUC1QaWNrZXIsIHRydWUgPSBhIHNlcGFyYXRlIFN1YnR5cC1QaWNrZXIgYWZ0ZXIgdGhlIFRZUCBjaG9pY2UuXG4gIHNlcGFyYXRlU3VidHlwUGlja2VyOiBmYWxzZSxcbiAgaW5jbHVkZUlnbm9yZWRGaWxlczogZmFsc2UsXG4gIC8vIEFzayBiZWZvcmUgZGVsZXRpbmcgYSBUWVAgb3IgYSBTdWJ0eXAgd2l0aCBwcm9wZXJ0aWVzLiBPbmx5IGRlbGV0aW9ucyB0aGF0XG4gIC8vIHRvdWNoIG5vdGhpbmcgYnV0IHRoZXNlIHNldHRpbmdzIGNhbiBiZSBzd2l0Y2hlZCBvZmYgKFwiRG9uJ3QgYXNrIGFnYWluXCIgaW5cbiAgLy8gdGhlIGRpYWxvZykgLSB0aGV5IGNhbiBiZSB1bmRvbmUgKHVuZG8uanMpLiBBbnl0aGluZyB0aGF0IHJld3JpdGVzIG5vdGVzXG4gIC8vIG9yIGZpbGVzIGFsd2F5cyBhc2tzLlxuICBjb25maXJtRGVsZXRpb246IHRydWUsXG4gIC8vIE93biB0YWcvYXR0YWNobWVudCBjb2xvcnMgaW4gdGhlIGdyYXBoIGRpc2FibGVkICgyMDI2LTA5LTMwKTogdGhlIE1pbmltYWxcbiAgLy8gdGhlbWUncyBTdHlsZSBTZXR0aW5ncyBjb3ZlciBib3RoLCBzZWUgZ3JhcGgtY29sb3JzLmpzLlxuICAvLyBncmFwaFRhZ0NvbG9yRW5hYmxlZDogZmFsc2UsXG4gIC8vIGdyYXBoVGFnQ29sb3I6IFwiXCIsXG4gIC8vIGdyYXBoQXR0YWNobWVudENvbG9yRW5hYmxlZDogZmFsc2UsXG4gIC8vIGdyYXBoQXR0YWNobWVudENvbG9yOiBcIlwiLFxuICAvLyBIb3cgZmFyIGEgU3VidHlwJ3MgY29sb3IgbWF5IGRpZmZlciBmcm9tIGl0cyBUWVAncyAoXHUwMEIxKSwgc2VlIHR5cC1jb2xvcnMuanM6XG4gIC8vIGh1ZSBpbiBkZWdyZWVzLCBsaWdodG5lc3MgaW4gJSBvZiB0aGUgd2F5IHRvIHdoaXRlIG9yIGJsYWNrLlxuICBzdWJ0eXBDb2xvclJhbmdlczogeyAuLi5ERUZBVUxUX1NVQlRZUF9DT0xPUl9SQU5HRVMgfSxcbiAgY29sb3JWaWV3czoge1xuICAgIGZpbGVFeHBsb3JlcjogdHJ1ZSxcbiAgICBncmFwaDogdHJ1ZSxcbiAgICBzZWFyY2g6IHRydWUsXG4gICAgcmVjZW50RmlsZXM6IHRydWUsXG4gICAgYmFja2xpbmtzOiB0cnVlLFxuICAgIGJvb2ttYXJrczogdHJ1ZSxcbiAgICAvLyBcIjx2aWV3PlN1YnR5cFwiIHN1Yi10b2dnbGVzOiB1c2UgYSBub3RlJ3MgU3VidHlwIGNvbG9yIGluc3RlYWQgb2YgaXRzXG4gICAgLy8gVFlQJ3MgKHNlZSBjb2xvckZvckZpbGUgaW4gdHlwLWNvbG9ycy5qcykuXG4gICAgZmlsZUV4cGxvcmVyU3VidHlwOiB0cnVlLFxuICAgIGdyYXBoU3VidHlwOiB0cnVlLFxuICAgIHNlYXJjaFN1YnR5cDogdHJ1ZSxcbiAgICByZWNlbnRGaWxlc1N1YnR5cDogdHJ1ZSxcbiAgICBiYWNrbGlua3NTdWJ0eXA6IHRydWUsXG4gICAgYm9va21hcmtzU3VidHlwOiB0cnVlLFxuICAgIGxpbmtzU3VidHlwOiB0cnVlLFxuICAgIHR5cExpc3RTdWJ0eXA6IHRydWUsXG4gICAgbm90ZVRpdGxlQ29sb3JTdWJ0eXA6IHRydWUsXG4gICAgbm90ZVRpdGxlTWFya2VyU3VidHlwOiB0cnVlLFxuICAgIGZyb250bWF0dGVyRGVmYXVsdHM6IHRydWUsXG4gICAgLy8gU3ViLXRvZ2dsZSBvZiBmcm9udG1hdHRlckRlZmF1bHRzIGFuZCBhbGxQcm9wZXJ0aWVzOiBpbmNsdWRlIHRoZSBTdWJ0eXBcbiAgICAvLyBibG9ja3MgKHNlZSBmcm9udG1hdHRlci1kZWZhdWx0LWhpZ2hsaWdodC5qcyk7IGZvciBhbGxQcm9wZXJ0aWVzIGFsc28gaW5cbiAgICAvLyB0aGUgU3VidHlwIGNvbG9yLlxuICAgIGZyb250bWF0dGVyRGVmYXVsdHNTdWJ0eXA6IHRydWUsXG4gICAgdHlwTGlzdDogdHJ1ZSxcbiAgICBhbGxQcm9wZXJ0aWVzOiB0cnVlLFxuICAgIGFsbFByb3BlcnRpZXNTdWJ0eXA6IHRydWUsXG4gICAgbm90ZVRpdGxlQ29sb3I6IHRydWUsXG4gICAgbGlua3M6IHRydWUsXG4gIH0sXG59O1xuXG5jbGFzcyBUeXBTeXN0ZW1TZXR0aW5nVGFiIGV4dGVuZHMgUGx1Z2luU2V0dGluZ1RhYiB7XG4gIGNvbnN0cnVjdG9yKGFwcCwgcGx1Z2luKSB7XG4gICAgc3VwZXIoYXBwLCBwbHVnaW4pO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICB9XG5cbiAgLy8gRWFjaCBzZWN0aW9uIGlzIGEgU2V0dGluZ0dyb3VwIChoZWFkaW5nIHBsdXMgb25lIGJveCwgZW50cmllcyBzZXBhcmF0ZWQgYnlcbiAgLy8gbGluZXMpLCBsaWtlIE9ic2lkaWFuJ3MgY29yZSBzZXR0aW5ncy4gU2V0dGluZ3MgY3JlYXRlZCBvbmUgYnkgb25lIHdpdGhcbiAgLy8gbmV3IFNldHRpbmcoY29udGFpbmVyRWwpIHdvdWxkIGVhY2ggZ2V0IHRoZWlyIG93biBzbWFsbCBib3guXG4gIGRpc3BsYXkoKSB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICAvLyBLZWVwIHRoZSBzY3JvbGwgcG9zaXRpb24gYWNyb3NzIHJlYnVpbGRzICh0b2dnbGVzIHdpdGggc3ViLW9wdGlvbnMgY2FsbFxuICAgIC8vIGRpc3BsYXkoKSk6IHRoZSBUWVAgbWFya2VyIGRyb3Bkb3duIG1lYXN1cmVzIGl0c2VsZiBvbiBzZXRWYWx1ZSgpIGFuZFxuICAgIC8vIGZvcmNlcyBhIGxheW91dCB3aGlsZSB0aGUgcGFnZSBpcyBvbmx5IHBhcnRseSBidWlsdCwgc28gdGhlIGJyb3dzZXJcbiAgICAvLyBjbGFtcHMgc2Nyb2xsVG9wIHRvIHRoYXQgaGVpZ2h0IGFuZCB0aGUgcGFnZSB3b3VsZCBqdW1wIHVwLlxuICAgIGNvbnN0IHsgc2Nyb2xsVG9wIH0gPSBjb250YWluZXJFbDtcbiAgICBjb250YWluZXJFbC5lbXB0eSgpO1xuXG4gICAgbmV3IFNldHRpbmdHcm91cChjb250YWluZXJFbClcbiAgICAgIC5zZXRIZWFkaW5nKFwiR2VuZXJhbFwiKVxuICAgICAgLmFkZFNldHRpbmcoKHNldHRpbmcpID0+XG4gICAgICAgIHNldHRpbmdcbiAgICAgICAgICAuc2V0TmFtZShcIkluY2x1ZGUgZXhjbHVkZWQgZmlsZXNcIilcbiAgICAgICAgICAuc2V0RGVzYyhcbiAgICAgICAgICAgIFwiQ291bnQgbm90ZXMgZnJvbSBPYnNpZGlhbidzIFxcXCJFeGNsdWRlZCBmaWxlc1xcXCIgKGUuZy4gZm9sZGVycyBoaWRkZW4gYnkgSGlkZSBGb2xkZXJzKSBpbiBUWVAgY291bnRzLCB0aGUgVFlQLVBpY2tlciBhbmQgZnJvbnRtYXR0ZXIgc29ydGluZy5cIlxuICAgICAgICAgIClcbiAgICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgICAgICB0b2dnbGUuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuaW5jbHVkZUlnbm9yZWRGaWxlcykub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmluY2x1ZGVJZ25vcmVkRmlsZXMgPSB2YWx1ZTtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICApXG4gICAgICApXG4gICAgICAuYWRkU2V0dGluZygoc2V0dGluZykgPT5cbiAgICAgICAgc2V0dGluZ1xuICAgICAgICAgIC5zZXROYW1lKFwiQ29uZmlybSBkZWxldGlvblwiKVxuICAgICAgICAgIC5zZXREZXNjKFxuICAgICAgICAgICAgXCJBc2sgYmVmb3JlIGRlbGV0aW5nIGEgVFlQIG9yIGEgU3VidHlwIHdpdGggcHJvcGVydGllcy4gV2hlbiBvZmYsIHRoZXkgYXJlIGRlbGV0ZWQgYXQgb25jZTsgZWl0aGVyIHdheSB0aGUgbm90aWNlIGFmdGVyd2FyZHMgb2ZmZXJzIFVuZG8uIERpYWxvZ3MgdGhhdCByZXdyaXRlIG5vdGVzIChyZW5hbWUgYW5kIHVwZGF0ZSBub3RlcywgbWVyZ2UpIGFsd2F5cyBhc2suXCJcbiAgICAgICAgICApXG4gICAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbmZpcm1EZWxldGlvbikub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbmZpcm1EZWxldGlvbiA9IHZhbHVlO1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgKVxuICAgICAgKVxuICAgICAgLmFkZFNldHRpbmcoKHNldHRpbmcpID0+XG4gICAgICAgIHNldHRpbmdcbiAgICAgICAgICAuc2V0TmFtZShcIlNlcGFyYXRlIFN1YnR5cC1QaWNrZXJcIilcbiAgICAgICAgICAuc2V0RGVzYyhcbiAgICAgICAgICAgIFwiQWZ0ZXIgY2hvb3NpbmcgYSBUWVAsIGNob29zZSB0aGUgU3VidHlwIGluIGEgc2Vjb25kIHBpY2tlci4gV2hlbiBvZmYsIGVhY2ggU3VidHlwIGlzIGxpc3RlZCBpbmRlbnRlZCBiZWxvdyBpdHMgVFlQLlwiXG4gICAgICAgICAgKVxuICAgICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgICAgIHRvZ2dsZS5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5zZXBhcmF0ZVN1YnR5cFBpY2tlcikub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnNlcGFyYXRlU3VidHlwUGlja2VyID0gdmFsdWU7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgICAgfSlcbiAgICAgICAgICApXG4gICAgICApO1xuXG4gICAgLy8gc3VidHlwS2V5IChvcHRpb25hbCk6IHR3byBsYWJlbGVkIHRvZ2dsZXMgaW5zdGVhZCBvZiBvbmUgLSBcIlRZUFwiIGZvciB0aGVcbiAgICAvLyBzZXR0aW5nIGl0c2VsZiBhbmQgYmVsb3cgaXQgXCJTdWJ0eXBcIiwgc2hvd24gb25seSB3aGlsZSBcIlRZUFwiIGlzIG9uLiBUaGVcbiAgICAvLyBkZWZhdWx0IHRvb2x0aXBzIGZpdCB0aGUgY29sb3JpbmcgdG9nZ2xlcy5cbiAgICBjb25zdCBjb2xvclZpZXdUb2dnbGUgPSAoXG4gICAgICBncm91cCxcbiAgICAgIGtleSxcbiAgICAgIG5hbWUsXG4gICAgICBkZXNjLFxuICAgICAgc3VidHlwS2V5ID0gbnVsbCxcbiAgICAgIHsgdHlwVG9vbHRpcCA9IFwiQ29sb3IgYnkgVFlQXCIsIHN1YnR5cFRvb2x0aXAgPSBcIlVzZSBTdWJ0eXAgY29sb3IgaW5zdGVhZCBvZiBUWVAgY29sb3JcIiB9ID0ge31cbiAgICApID0+XG4gICAgICBncm91cC5hZGRTZXR0aW5nKChzZXR0aW5nKSA9PiB7XG4gICAgICAgIHNldHRpbmcuc2V0TmFtZShuYW1lKS5zZXREZXNjKGRlc2MpO1xuICAgICAgICBjb25zdCBzYXZlID0gYXN5bmMgKHNldHRpbmdLZXksIHZhbHVlKSA9PiB7XG4gICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3c1tzZXR0aW5nS2V5XSA9IHZhbHVlO1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICB9O1xuXG4gICAgICAgIGlmICghc3VidHlwS2V5KSB7XG4gICAgICAgICAgc2V0dGluZy5hZGRUb2dnbGUoKHRvZ2dsZSkgPT4gdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Nba2V5XSkub25DaGFuZ2UoKHZhbHVlKSA9PiBzYXZlKGtleSwgdmFsdWUpKSk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgc2V0dGluZy5zZXR0aW5nRWwuYWRkQ2xhc3MoXCJ0eXAtbm90ZS10aXRsZS1zZXR0aW5nXCIpO1xuICAgICAgICBjb25zdCBhZGRSb3cgPSAobGFiZWwsIHRvb2x0aXAsIHNldHRpbmdLZXksIG9uQ2hhbmdlZCkgPT4ge1xuICAgICAgICAgIGNvbnN0IHJvdyA9IHNldHRpbmcuY29udHJvbEVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtbm90ZS10aXRsZS10b2dnbGUtcm93XCIgfSk7XG4gICAgICAgICAgcm93LmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLW5vdGUtdGl0bGUtdG9nZ2xlLWxhYmVsXCIsIHRleHQ6IGxhYmVsIH0pO1xuICAgICAgICAgIG5ldyBUb2dnbGVDb21wb25lbnQocm93KVxuICAgICAgICAgICAgLnNldFRvb2x0aXAodG9vbHRpcClcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzW3NldHRpbmdLZXldKVxuICAgICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgICBhd2FpdCBzYXZlKHNldHRpbmdLZXksIHZhbHVlKTtcbiAgICAgICAgICAgICAgb25DaGFuZ2VkPy4oKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9O1xuICAgICAgICBhZGRSb3coXCJUWVBcIiwgdHlwVG9vbHRpcCwga2V5LCAoKSA9PiB0aGlzLmRpc3BsYXkoKSk7XG4gICAgICAgIGlmICh0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzW2tleV0pIGFkZFJvdyhcIlN1YnR5cFwiLCBzdWJ0eXBUb29sdGlwLCBzdWJ0eXBLZXkpO1xuICAgICAgfSk7XG5cbiAgICBjb25zdCBjb2xvcmluZ0dyb3VwID0gbmV3IFNldHRpbmdHcm91cChjb250YWluZXJFbCkuc2V0SGVhZGluZyhcIkNvbG9yaW5nXCIpO1xuXG4gICAgY29sb3JWaWV3VG9nZ2xlKGNvbG9yaW5nR3JvdXAsIFwiZmlsZUV4cGxvcmVyXCIsIFwiRmlsZSBleHBsb3JlclwiLCBcIkNvbG9yIG5vdGUgbmFtZXMgaW4gdGhlIGZpbGUgZXhwbG9yZXIuXCIsIFwiZmlsZUV4cGxvcmVyU3VidHlwXCIpO1xuICAgIGNvbG9yVmlld1RvZ2dsZShjb2xvcmluZ0dyb3VwLCBcImdyYXBoXCIsIFwiR3JhcGhcIiwgXCJDb2xvciBub2RlcyBpbiB0aGUgZ2xvYmFsIGFuZCBsb2NhbCBncmFwaC5cIiwgXCJncmFwaFN1YnR5cFwiKTtcbiAgICBjb2xvclZpZXdUb2dnbGUoY29sb3JpbmdHcm91cCwgXCJzZWFyY2hcIiwgXCJTZWFyY2hcIiwgXCJDb2xvciByZXN1bHQgdGl0bGVzIGluIHNlYXJjaC5cIiwgXCJzZWFyY2hTdWJ0eXBcIik7XG4gICAgY29sb3JWaWV3VG9nZ2xlKGNvbG9yaW5nR3JvdXAsIFwicmVjZW50RmlsZXNcIiwgXCJSZWNlbnQgRmlsZXNcIiwgXCJDb2xvciBlbnRyaWVzIGluIHRoZSBSZWNlbnQgRmlsZXMgcGx1Z2luLlwiLCBcInJlY2VudEZpbGVzU3VidHlwXCIpO1xuICAgIGNvbG9yVmlld1RvZ2dsZShcbiAgICAgIGNvbG9yaW5nR3JvdXAsXG4gICAgICBcImxpbmtzXCIsXG4gICAgICBcIkxpbmtzIGluIG5vdGVzXCIsXG4gICAgICBcIkNvbG9yIGludGVybmFsIGxpbmtzIGJ5IHRoZSBUWVAgb2YgdGhlaXIgdGFyZ2V0IChyZWFkaW5nIHZpZXcsIExpdmUgUHJldmlldywgaG92ZXIgcHJldmlldykuIFVucmVzb2x2ZWQgbGlua3Mgc3RheSBhcyB0aGV5IGFyZS5cIixcbiAgICAgIFwibGlua3NTdWJ0eXBcIlxuICAgICk7XG4gICAgY29sb3JWaWV3VG9nZ2xlKGNvbG9yaW5nR3JvdXAsIFwidHlwTGlzdFwiLCBcIlRZUC1QYW5lXCIsIFwiQ29sb3IgbmFtZXMgaW4gdGhlIFRZUC1QYW5lIGFuZCBUWVAtUGlja2VyLlwiLCBcInR5cExpc3RTdWJ0eXBcIik7XG4gICAgY29sb3JWaWV3VG9nZ2xlKFxuICAgICAgY29sb3JpbmdHcm91cCxcbiAgICAgIFwibm90ZVRpdGxlQ29sb3JcIixcbiAgICAgIFwiQ29sb3Igbm90ZSB0aXRsZVwiLFxuICAgICAgXCJDb2xvciB0aGUgaW5saW5lIHRpdGxlIG9mIHRoZSBvcGVuIG5vdGUuXCIsXG4gICAgICBcIm5vdGVUaXRsZUNvbG9yU3VidHlwXCJcbiAgICApO1xuXG4gICAgLy8gUHJvZ3Jlc3NpdmUgZGlzY2xvc3VyZTogXCJiYWRnZVwiIGFkZHMgdG9nZ2xlcyAoY29sb3IsIHBvc2l0aW9uKSB0byB0aGlzXG4gICAgLy8gb25lIHNldHRpbmcgcm93LCBwb3NpdGlvbiBcImJsb2NrXCIgb25lIG1vcmUgKGFsaWdubWVudCkuIEVhY2ggcmUtcmVuZGVyc1xuICAgIC8vIHZpYSBkaXNwbGF5KCkgc28gb25seSB0aGUgcmVsZXZhbnQgb25lcyBzaG93LlxuICAgIGNvbnN0IGlzQmFkZ2UgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVTdHlsZSA9PT0gXCJiYWRnZVwiO1xuICAgIGNvbnN0IGlzQmxvY2tQb3NpdGlvbiA9IHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlUG9zaXRpb24gPT09IFwiYmxvY2tcIjtcblxuICAgIGNvbG9yaW5nR3JvdXAuYWRkU2V0dGluZygobm90ZVRpdGxlU2V0dGluZykgPT4ge1xuICAgICAgbm90ZVRpdGxlU2V0dGluZ1xuICAgICAgICAuc2V0TmFtZShcIlRZUCBtYXJrZXIgaW4gbm90ZVwiKVxuICAgICAgICAuc2V0RGVzYyhpc0JhZGdlID8gXCJCYWRnZSBvcHRpb25zOiBsYWJlbCwgY29sb3IsIHBvc2l0aW9uLlwiIDogXCJIb3cgdGhlIG9wZW4gbm90ZSBzaG93cyBpdHMgVFlQLlwiKVxuICAgICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PlxuICAgICAgICAgIGRyb3Bkb3duXG4gICAgICAgICAgICAuYWRkT3B0aW9uKFwibm9uZVwiLCBcIk5vbmVcIilcbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJkb3RcIiwgXCJEb3QgYXQgdGl0bGVcIilcbiAgICAgICAgICAgIC5hZGRPcHRpb24oXCJiYWRnZVwiLCBcIkJhZGdlIHdpdGggVFlQIG5hbWVcIilcbiAgICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVTdHlsZSlcbiAgICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlU3R5bGUgPSB2YWx1ZTtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICk7XG5cbiAgICAgIC8vIFwiU3VidHlwXCIgKFN1YnR5cCBjb2xvciBpbnN0ZWFkIG9mIFRZUCBjb2xvcikgb25seSB3aGlsZSB0aGUgbWFya2VyIGlzXG4gICAgICAvLyBjb2xvcmVkIGF0IGFsbDogYWx3YXlzIGZvciB0aGUgZG90LCBmb3IgdGhlIGJhZGdlIG9ubHkgd2l0aCBcIkNvbG9yZWRcIlxuICAgICAgLy8gYW5kIGxhYmVsIFtUWVAvU3VidHlwXSAtIHdpdGggW1RZUF0gb3IgW1N1YnR5cF0gdGhlIGNvbG9yIGZvbGxvd3MgdGhlXG4gICAgICAvLyBsYWJlbC5cbiAgICAgIGNvbnN0IGJhZGdlTGFiZWwgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUxhYmVsID8/IFwidHlwXCI7XG4gICAgICBjb25zdCBzaG93U3VidHlwID1cbiAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlU3R5bGUgPT09IFwiZG90XCIgfHxcbiAgICAgICAgKGlzQmFkZ2UgJiYgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VDb2xvcmVkICYmIGJhZGdlTGFiZWwgPT09IFwidHlwLXN1YnR5cFwiKTtcbiAgICAgIGlmICghaXNCYWRnZSAmJiAhc2hvd1N1YnR5cCkgcmV0dXJuO1xuXG4gICAgICAvLyBTdGFja3MgdGhlIGV4dHJhIHRvZ2dsZXMgaW5zdGVhZCBvZiBPYnNpZGlhbidzIHNpZGUtYnktc2lkZSBsYXlvdXQsXG4gICAgICAvLyBzZWUgLnR5cC1ub3RlLXRpdGxlLXNldHRpbmcgaW4gc3R5bGVzLmNzcy5cbiAgICAgIG5vdGVUaXRsZVNldHRpbmcuc2V0dGluZ0VsLmFkZENsYXNzKFwidHlwLW5vdGUtdGl0bGUtc2V0dGluZ1wiKTtcblxuICAgICAgLy8gQSBzbWFsbCBsYWJlbCBwZXIgdG9nZ2xlIC0gYWRkVG9nZ2xlKCkgYWxvbmUgYWRkcyBhIGJhcmUgc3dpdGNoLlxuICAgICAgY29uc3QgYWRkTGFiZWxlZFRvZ2dsZSA9IChsYWJlbCwgdG9vbHRpcCwgdmFsdWUsIG9uQ2hhbmdlKSA9PiB7XG4gICAgICAgIGNvbnN0IHJvdyA9IG5vdGVUaXRsZVNldHRpbmcuY29udHJvbEVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtbm90ZS10aXRsZS10b2dnbGUtcm93XCIgfSk7XG4gICAgICAgIHJvdy5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1ub3RlLXRpdGxlLXRvZ2dsZS1sYWJlbFwiLCB0ZXh0OiBsYWJlbCB9KTtcbiAgICAgICAgbmV3IFRvZ2dsZUNvbXBvbmVudChyb3cpLnNldFRvb2x0aXAodG9vbHRpcCkuc2V0VmFsdWUodmFsdWUpLm9uQ2hhbmdlKG9uQ2hhbmdlKTtcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGFkZFN1YnR5cFRvZ2dsZSA9IChsYWJlbCkgPT5cbiAgICAgICAgYWRkTGFiZWxlZFRvZ2dsZShcbiAgICAgICAgICBsYWJlbCxcbiAgICAgICAgICBcIlVzZSBTdWJ0eXAgY29sb3IgaW5zdGVhZCBvZiBUWVAgY29sb3JcIixcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLm5vdGVUaXRsZU1hcmtlclN1YnR5cCxcbiAgICAgICAgICBhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Mubm90ZVRpdGxlTWFya2VyU3VidHlwID0gdmFsdWU7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICAgIH1cbiAgICAgICAgKTtcblxuICAgICAgaWYgKCFpc0JhZGdlKSB7XG4gICAgICAgIGFkZFN1YnR5cFRvZ2dsZShcIlN1YnR5cFwiKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBsYWJlbFJvdyA9IG5vdGVUaXRsZVNldHRpbmcuY29udHJvbEVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtbm90ZS10aXRsZS10b2dnbGUtcm93XCIgfSk7XG4gICAgICBsYWJlbFJvdy5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1ub3RlLXRpdGxlLXRvZ2dsZS1sYWJlbFwiLCB0ZXh0OiBcIkxhYmVsXCIgfSk7XG4gICAgICBuZXcgRHJvcGRvd25Db21wb25lbnQobGFiZWxSb3cpXG4gICAgICAgIC5hZGRPcHRpb24oXCJ0eXBcIiwgXCJbVFlQXVwiKVxuICAgICAgICAuYWRkT3B0aW9uKFwidHlwLXN1YnR5cFwiLCBcIltUWVAvU3VidHlwXVwiKVxuICAgICAgICAuYWRkT3B0aW9uKFwic3VidHlwXCIsIFwiW1N1YnR5cF1cIilcbiAgICAgICAgLnNldFZhbHVlKGJhZGdlTGFiZWwpXG4gICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUxhYmVsID0gdmFsdWU7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgIH0pO1xuXG4gICAgICBhZGRMYWJlbGVkVG9nZ2xlKFwiQ29sb3JlZFwiLCBcIkNvbG9yZWQgaW5zdGVhZCBvZiBuZXV0cmFsXCIsIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlQ29sb3JlZCwgYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlQ29sb3JlZCA9IHZhbHVlO1xuICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgfSk7XG4gICAgICBpZiAoc2hvd1N1YnR5cCkgYWRkU3VidHlwVG9nZ2xlKFwiU3VidHlwIGNvbG9yXCIpO1xuXG4gICAgICBhZGRMYWJlbGVkVG9nZ2xlKFwiQXQgcHJvcGVydHkgYmxvY2tcIiwgXCJBdCB0aGUgcHJvcGVydHkgYmxvY2sgKHJvdGF0ZWQpIGluc3RlYWQgb2YgdGhlIHRpdGxlXCIsIGlzQmxvY2tQb3NpdGlvbiwgYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZUJhZGdlUG9zaXRpb24gPSB2YWx1ZSA/IFwiYmxvY2tcIiA6IFwidGl0bGVcIjtcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoaXNCbG9ja1Bvc2l0aW9uKSB7XG4gICAgICAgIGFkZExhYmVsZWRUb2dnbGUoXG4gICAgICAgICAgXCJUb3AgaW5zdGVhZCBvZiBib3R0b21cIixcbiAgICAgICAgICBcIlRvcCBvZiB0aGUgcHJvcGVydHkgYmxvY2sgaW5zdGVhZCBvZiBib3R0b21cIixcbiAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy5ub3RlVGl0bGVWZXJ0aWNhbEFsaWduID09PSBcInRvcFwiLFxuICAgICAgICAgIGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3Mubm90ZVRpdGxlVmVydGljYWxBbGlnbiA9IHZhbHVlID8gXCJ0b3BcIiA6IFwiYm90dG9tXCI7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgICAgICAgIH1cbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGNvbG9yVmlld1RvZ2dsZShcbiAgICAgIGNvbG9yaW5nR3JvdXAsXG4gICAgICBcImJhY2tsaW5rc1wiLFxuICAgICAgXCJCYWNrbGlua3NcIixcbiAgICAgIFwiQ29sb3IgcmVzdWx0cyBpbiB0aGUgYmFja2xpbmtzIHBhbmUgYW5kIGluIGVtYmVkZGVkIGJhY2tsaW5rcywgaW5jbHVkaW5nIHVubGlua2VkIG1lbnRpb25zLlwiLFxuICAgICAgXCJiYWNrbGlua3NTdWJ0eXBcIlxuICAgICk7XG4gICAgY29sb3JWaWV3VG9nZ2xlKGNvbG9yaW5nR3JvdXAsIFwiYm9va21hcmtzXCIsIFwiQm9va21hcmtzXCIsIFwiQ29sb3IgYm9va21hcmtzIHRoYXQgcG9pbnQgZGlyZWN0bHkgdG8gYSBub3RlLlwiLCBcImJvb2ttYXJrc1N1YnR5cFwiKTtcbiAgICBjb2xvclZpZXdUb2dnbGUoXG4gICAgICBjb2xvcmluZ0dyb3VwLFxuICAgICAgXCJhbGxQcm9wZXJ0aWVzXCIsXG4gICAgICBcIkFsbCBQcm9wZXJ0aWVzXCIsXG4gICAgICBcIkluIE9ic2lkaWFuJ3MgXFxcIkFsbCBwcm9wZXJ0aWVzXFxcIiB2aWV3LCBjb2xvciBwcm9wZXJ0eSBuYW1lcyB0aGF0IGJlbG9uZyB0byBleGFjdGx5IG9uZSBUWVAtRnJvbnRtYXR0ZXIsIG9yIGJvbGQgdGhlbSBpZiBtb3JlIHRoYW4gb25lIFRZUCB1c2VzIHRoZW0uIFdpdGggU3VidHlwLCBTdWJ0eXAgYmxvY2tzIGNvdW50IGFzIHdlbGwsIGluIHRoZSBTdWJ0eXAgY29sb3IuXCIsXG4gICAgICBcImFsbFByb3BlcnRpZXNTdWJ0eXBcIixcbiAgICAgIHsgdHlwVG9vbHRpcDogXCJUWVAtRnJvbnRtYXR0ZXJcIiwgc3VidHlwVG9vbHRpcDogXCJJbmNsdWRlIFN1YnR5cCBibG9ja3MsIGluIFN1YnR5cCBjb2xvclwiIH1cbiAgICApO1xuXG4gICAgLy8gTGltaXRzIG9mIHRoZSBzbGlkZXJzIGEgU3VidHlwIGRlcml2ZXMgaXRzIGNvbG9yIHdpdGggKGRvdCBhdCB0aGUgYm90dG9tXG4gICAgLy8gb2YgYSBTdWJ0eXAgYmxvY2ssIHNlZSB0eXAtY29sb3JzLmpzKS4gQSBsYXJnZXIgc3RvcmVkIG9mZnNldCBpcyBjbGFtcGVkXG4gICAgLy8gdG8gdGhlIG5ldyBsaW1pdC5cbiAgICBjb25zdCBzdWJ0eXBDb2xvckdyb3VwID0gbmV3IFNldHRpbmdHcm91cChjb250YWluZXJFbCkuc2V0SGVhZGluZyhcIlN1YnR5cCBjb2xvcnNcIik7XG4gICAgY29uc3QgcmFuZ2VNYXggPSB7IGg6IDE4MCwgLyogczogMTAwLCAqLyBsOiAxMDAgfTtcbiAgICBjb25zdCByYW5nZURlc2MgPSB7XG4gICAgICBoOiBcIk1heGltdW0gaHVlIGRpZmZlcmVuY2UgYmV0d2VlbiBhIFN1YnR5cCBhbmQgaXRzIFRZUC5cIixcbiAgICAgIC8vIHM6IFwiTWF4aW11bSBzaGFyZSBieSB3aGljaCBhIFN1YnR5cCBtYXkgYmUgcGFsZXIgdGhhbiBpdHMgVFlQLiBPbmx5IGdvZXMgZG93biAtIGEgU3VidHlwIHNob3VsZG4ndCBiZSBsb3VkZXIgdGhhbiBpdHMgVFlQLlwiLFxuICAgICAgbDogXCJNYXhpbXVtIGxpZ2h0bmVzcyBkaWZmZXJlbmNlIGJldHdlZW4gYSBTdWJ0eXAgYW5kIGl0cyBUWVAsIGFzIGEgc2hhcmUgb2YgdGhlIHdheSB0byB3aGl0ZSBvciBibGFjay5cIixcbiAgICB9O1xuICAgIC8vIFRoZSBzbGlkZXIgcmVwb3J0cyBldmVyeSBzdGVwOyB0aGUgb3RoZXIgdmlld3Mgb25seSBmb2xsb3cgb25jZSBpdCByZXN0cy5cbiAgICBjb25zdCByZWZyZXNoQ29sb3JzU29vbiA9IGRlYm91bmNlKCgpID0+IHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpLCAzMDAsIHRydWUpO1xuICAgIGZvciAoY29uc3QgeyBrZXksIGxhYmVsLCB1bml0LCBkb3duT25seSB9IG9mIFNVQlRZUF9DT0xPUl9DSEFOTkVMUykge1xuICAgICAgc3VidHlwQ29sb3JHcm91cC5hZGRTZXR0aW5nKChzZXR0aW5nKSA9PlxuICAgICAgICBzZXR0aW5nXG4gICAgICAgICAgLnNldE5hbWUoYCR7bGFiZWx9ICgke2Rvd25Pbmx5ID8gXCJcdTIyMTJcIiA6IFwiXHUwMEIxXCJ9ICR7dW5pdH0pYClcbiAgICAgICAgICAuc2V0RGVzYyhyYW5nZURlc2Nba2V5XSlcbiAgICAgICAgICAuYWRkU2xpZGVyKChzbGlkZXIpID0+XG4gICAgICAgICAgICBzbGlkZXJcbiAgICAgICAgICAgICAgLnNldExpbWl0cygwLCByYW5nZU1heFtrZXldLCAxKVxuICAgICAgICAgICAgICAuc2V0VmFsdWUoY29sb3JSYW5nZSh0aGlzLnBsdWdpbi5zZXR0aW5ncywga2V5KSlcbiAgICAgICAgICAgICAgLnNldER5bmFtaWNUb29sdGlwKClcbiAgICAgICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnN1YnR5cENvbG9yUmFuZ2VzID0geyAuLi5ERUZBVUxUX1NVQlRZUF9DT0xPUl9SQU5HRVMsIC4uLnRoaXMucGx1Z2luLnNldHRpbmdzLnN1YnR5cENvbG9yUmFuZ2VzLCBba2V5XTogdmFsdWUgfTtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgICByZWZyZXNoQ29sb3JzU29vbigpO1xuICAgICAgICAgICAgICB9KVxuICAgICAgICAgIClcbiAgICAgICAgICAuYWRkRXh0cmFCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgICAgIGJ1dHRvblxuICAgICAgICAgICAgICAuc2V0SWNvbihcInJvdGF0ZS1jY3dcIilcbiAgICAgICAgICAgICAgLnNldFRvb2x0aXAoYFJlc2V0IHRvICR7REVGQVVMVF9TVUJUWVBfQ09MT1JfUkFOR0VTW2tleV19YClcbiAgICAgICAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnN1YnR5cENvbG9yUmFuZ2VzID0geyAuLi5ERUZBVUxUX1NVQlRZUF9DT0xPUl9SQU5HRVMsIC4uLnRoaXMucGx1Z2luLnNldHRpbmdzLnN1YnR5cENvbG9yUmFuZ2VzLCBba2V5XTogREVGQVVMVF9TVUJUWVBfQ09MT1JfUkFOR0VTW2tleV0gfTtcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzPy4oKTtcbiAgICAgICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICApXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIEdyb3VwIFwiR3JhcGhcIiAodGFnL2F0dGFjaG1lbnQgY29sb3JzKSBkaXNhYmxlZCAoMjAyNi0wOS0zMCk6IHRoZSBNaW5pbWFsXG4gICAgLy8gdGhlbWUncyBTdHlsZSBTZXR0aW5ncyBjb3ZlciBib3RoLCBzZWUgZ3JhcGgtY29sb3JzLmpzLiBDb2xvcmluZyBub3RlXG4gICAgLy8gbm9kZXMgYnkgVFlQIHN0YXlzLCB1bmRlciBcIkNvbG9yaW5nXCIgXHUyMTkyIFwiR3JhcGhcIi5cbiAgICAvLyAgICAgY29uc3QgZ3JhcGhHcm91cCA9IG5ldyBTZXR0aW5nR3JvdXAoY29udGFpbmVyRWwpLnNldEhlYWRpbmcoXCJHcmFwaFwiKTtcbiAgICAvL1xuICAgIC8vICAgICAvLyBPbmUgc2V0dGluZyBwZXIgbm9kZSBraW5kIHRoZSBncmFwaCBlbmdpbmUga25vd3MsIHNhbWUgbGF5b3V0XG4gICAgLy8gICAgIC8vICh0b2dnbGUgKyBjb2xvciBwaWNrZXIgKyByZXNldCkgZm9yIGVhY2guXG4gICAgLy8gICAgIGNvbnN0IGdyYXBoQ29sb3JTZXR0aW5nID0gKGVuYWJsZWRLZXksIGNvbG9yS2V5LCBkZWZhdWx0Q29sb3IsIG5hbWUsIGRlc2MpID0+XG4gICAgLy8gICAgICAgZ3JhcGhHcm91cC5hZGRTZXR0aW5nKChzZXR0aW5nKSA9PlxuICAgIC8vICAgICAgICAgc2V0dGluZ1xuICAgIC8vICAgICAgICAgICAuc2V0TmFtZShuYW1lKVxuICAgIC8vICAgICAgICAgICAuc2V0RGVzYyhkZXNjKVxuICAgIC8vICAgICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgLy8gICAgICAgICAgICAgdG9nZ2xlLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzW2VuYWJsZWRLZXldKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAvLyAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzW2VuYWJsZWRLZXldID0gdmFsdWU7XG4gICAgLy8gICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAvLyAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgIC8vICAgICAgICAgICAgIH0pXG4gICAgLy8gICAgICAgICAgIClcbiAgICAvLyAgICAgICAgICAgLmFkZENvbG9yUGlja2VyKChwaWNrZXIpID0+XG4gICAgLy8gICAgICAgICAgICAgcGlja2VyLnNldFZhbHVlKHRoaXMucGx1Z2luLnNldHRpbmdzW2NvbG9yS2V5XSB8fCBkZWZhdWx0Q29sb3IpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgIC8vICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4uc2V0dGluZ3NbY29sb3JLZXldID0gdmFsdWU7XG4gICAgLy8gICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAvLyAgICAgICAgICAgICAgIHRoaXMucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xuICAgIC8vICAgICAgICAgICAgIH0pXG4gICAgLy8gICAgICAgICAgIClcbiAgICAvLyAgICAgICAgICAgLmFkZEV4dHJhQnV0dG9uKChidXR0b24pID0+XG4gICAgLy8gICAgICAgICAgICAgYnV0dG9uXG4gICAgLy8gICAgICAgICAgICAgICAuc2V0SWNvbihcInJvdGF0ZS1jY3dcIilcbiAgICAvLyAgICAgICAgICAgICAgIC5zZXRUb29sdGlwKFwiUmVzZXQgdG8gZGVmYXVsdCBjb2xvclwiKVxuICAgIC8vICAgICAgICAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgIC8vICAgICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5nc1tjb2xvcktleV0gPSBcIlwiO1xuICAgIC8vICAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAvLyAgICAgICAgICAgICAgICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG4gICAgLy8gICAgICAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgIC8vICAgICAgICAgICAgICAgfSlcbiAgICAvLyAgICAgICAgICAgKVxuICAgIC8vICAgICAgICk7XG4gICAgLy9cbiAgICAvLyAgICAgZ3JhcGhDb2xvclNldHRpbmcoXG4gICAgLy8gICAgICAgXCJncmFwaFRhZ0NvbG9yRW5hYmxlZFwiLFxuICAgIC8vICAgICAgIFwiZ3JhcGhUYWdDb2xvclwiLFxuICAgIC8vICAgICAgIFwiIzg4ODg4OFwiLFxuICAgIC8vICAgICAgIFwiVGFnIGNvbG9yXCIsXG4gICAgLy8gICAgICAgXCJPd24gY29sb3IgZm9yIHRhZyBub2RlcyBpbiB0aGUgZ2xvYmFsIGFuZCBsb2NhbCBncmFwaC4gQ29sb3IgZ3JvdXBzIHN0aWxsIHRha2UgcHJlY2VkZW5jZS5cIlxuICAgIC8vICAgICApO1xuICAgIC8vICAgICBncmFwaENvbG9yU2V0dGluZyhcbiAgICAvLyAgICAgICBcImdyYXBoQXR0YWNobWVudENvbG9yRW5hYmxlZFwiLFxuICAgIC8vICAgICAgIFwiZ3JhcGhBdHRhY2htZW50Q29sb3JcIixcbiAgICAvLyAgICAgICBcIiNlMGFjMDBcIixcbiAgICAvLyAgICAgICBcIkF0dGFjaG1lbnQgY29sb3JcIixcbiAgICAvLyAgICAgICBcIk93biBjb2xvciBmb3IgYXR0YWNobWVudCBub2RlcyAobm9uLW1hcmtkb3duIGZpbGVzIHN1Y2ggYXMgaW1hZ2VzIG9yIFBERnMpIGluIHRoZSBncmFwaC5cIlxuICAgIC8vICAgICApO1xuXG4gICAgY29uc3QgZnJvbnRtYXR0ZXJHcm91cCA9IG5ldyBTZXR0aW5nR3JvdXAoY29udGFpbmVyRWwpLnNldEhlYWRpbmcoXCJUWVAtRnJvbnRtYXR0ZXJcIik7XG5cbiAgICBjb2xvclZpZXdUb2dnbGUoXG4gICAgICBmcm9udG1hdHRlckdyb3VwLFxuICAgICAgXCJmcm9udG1hdHRlckRlZmF1bHRzXCIsXG4gICAgICBcIkJvbGQgVFlQIHByb3BlcnRpZXNcIixcbiAgICAgIFwiU2hvdyBUWVAtRnJvbnRtYXR0ZXIgcHJvcGVydHkgbmFtZXMgaW4gYm9sZCBpbiBub3RlcyBhbmQgdGhlIHByb3BlcnRpZXMgc2lkZWJhci4gV2l0aCBTdWJ0eXAsIHRoZSBub3RlJ3MgU3VidHlwIGJsb2NrIGNvdW50cyBhcyB3ZWxsLlwiLFxuICAgICAgXCJmcm9udG1hdHRlckRlZmF1bHRzU3VidHlwXCIsXG4gICAgICB7IHR5cFRvb2x0aXA6IFwiVFlQLUZyb250bWF0dGVyXCIsIHN1YnR5cFRvb2x0aXA6IFwiSW5jbHVkZSBTdWJ0eXAgYmxvY2tzXCIgfVxuICAgICk7XG5cbiAgICAvLyBUaGUgb3JkZXIgZWRpdG9yIGJyaW5ncyBpdHMgb3duIGhlYWRpbmcgYW5kIGJ1dHRvbnMsIHNvIGl0IGdvZXMgc3RyYWlnaHRcbiAgICAvLyBpbnRvIGluZm9FbCBpbnN0ZWFkIG9mIHNldE5hbWUvc2V0RGVzYyAoc2VlIC50eXAtb3JkZXItc2V0dGluZykuXG4gICAgZnJvbnRtYXR0ZXJHcm91cC5hZGRTZXR0aW5nKChzZXR0aW5nKSA9PiB7XG4gICAgICBzZXR0aW5nLnNldHRpbmdFbC5hZGRDbGFzcyhcInR5cC1vcmRlci1zZXR0aW5nXCIpO1xuICAgICAgbW91bnRHbG9iYWxPcmRlckVkaXRvcihzZXR0aW5nLmluZm9FbCwgdGhpcy5wbHVnaW4pO1xuICAgICAgc2V0dGluZy5pbmZvRWwuY3JlYXRlRGl2KHtcbiAgICAgICAgY2xzOiBcInNldHRpbmctaXRlbS1kZXNjcmlwdGlvblwiLFxuICAgICAgICB0ZXh0OlxuICAgICAgICAgICdPcmRlciBhcHBsaWVkIGJ5IHRoZSBcIlNvcnQgZnJvbnRtYXR0ZXJcIiBjb21tYW5kczsgdmFsdWVzIGFyZSBuZXZlciBjaGFuZ2VkLiBQaW4gc2luZ2xlIHByb3BlcnRpZXMgc3VjaCBhcyBjc3NjbGFzc2VzIG9yIGFsaWFzZXMuIERyYWcgdG8gcmVvcmRlcjsgaG92ZXIgYSBwbGFjZWhvbGRlciByb3cgZm9yIHdoYXQgaXQgc3RhbmRzIGZvci4gUGxhY2Vob2xkZXIgcm93cyBjYW5cXCd0IGJlIHJlbW92ZWQuJyxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgY29udGFpbmVyRWwuc2Nyb2xsVG9wID0gc2Nyb2xsVG9wO1xuICB9XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBERUZBVUxUX1NFVFRJTkdTLCBUeXBTeXN0ZW1TZXR0aW5nVGFiIH07XG4iLCAiY29uc3QgeyBCdXR0b25Db21wb25lbnQsIE1vZGFsLCBTZXR0aW5nIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IHBsdXJhbCB9ID0gcmVxdWlyZShcIi4vdHlwLXV0aWxzXCIpO1xuXG4vKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAqIFRoZSB0d28gZGlhbG9ncyBvZiB0aGUgQmFzZSBjb21tYW5kcyAoc2VlIGJhc2VzLmpzKTpcbiAqICAtIGNvbHVtbiBvcHRpb25zIGJlZm9yZSBjcmVhdGluZy91cGRhdGluZ1xuICogIC0gY29uZmlybWluZyByZW1vdmFscyB3aGVuIHVwZGF0aW5nXG4gKiA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0gKi9cblxuY29uc3QgTk9URV9QUkVGSVggPSBcIm5vdGUuXCI7XG5cbi8vIENvbHVtbiBsYWJlbDogdGhlIHNob3J0IGZvcm0gdGhlIHByb3BlcnR5IGhhcyBpbiB0aGUgLmJhc2UgZmlsZVxuLy8gKFwiVGl0ZWxcIiBpbnN0ZWFkIG9mIFwibm90ZS5UaXRlbFwiKS5cbmZ1bmN0aW9uIGNvbHVtbkxhYmVsKGlkKSB7XG4gIHJldHVybiBpZC5zdGFydHNXaXRoKE5PVEVfUFJFRklYKSA/IGlkLnNsaWNlKE5PVEVfUFJFRklYLmxlbmd0aCkgOiBpZDtcbn1cblxuZnVuY3Rpb24gdGFyZ2V0TGFiZWwodGFyZ2V0KSB7XG4gIGlmICghdGFyZ2V0LnR5cCkgcmV0dXJuIGBTdWJ0eXAgJHt0YXJnZXQuc3VidHlwfWA7XG4gIHJldHVybiB0YXJnZXQuc3VidHlwID8gYCR7dGFyZ2V0LnR5cH0gLyAke3RhcmdldC5zdWJ0eXB9YCA6IGBUWVAgJHt0YXJnZXQudHlwfWA7XG59XG5cbi8qIC0tLSBDb2x1bW4gb3B0aW9ucyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuLy8gVGhyZWUgdG9nZ2xlcyB3aXRoIGEgbGl2ZSBwcmV2aWV3IG9mIHRoZSByZXN1bHRpbmcgY29sdW1ucyBzbyBhIHRvZ2dsZSdzXG4vLyBlZmZlY3QgbmVlZG4ndCBiZSBndWVzc2VkLiBcIkFsbCBTdWJ0eXAgcHJvcGVydGllc1wiIG9ubHkgc2hvd3MgZm9yIGEgVFlQXG4vLyB0YXJnZXQ6IGluIGEgU3VidHlwIHZpZXcgdGhlIG90aGVyIFN1YnR5cCBibG9ja3Mgd291bGQgc3RheSBlbXB0eS5cbi8vXG4vLyBpbml0aWFsIHByZXNldHMgdGhlIHRvZ2dsZXMuIENyZWF0aW5nIHBhc3NlcyBub3RoaW5nIC0gYWxsIG9mZiwgZmlsZS5uYW1lXG4vLyBwbHVzIFRZUC1Gcm9udG1hdHRlciBpcyB0aGUgbm9ybWFsIGNhc2UuIFVwZGF0aW5nIHBhc3NlcyB3aGF0IHRoZSB2aWV3J3Ncbi8vIGN1cnJlbnQgY29sdW1ucyBzdWdnZXN0IChvcHRpb25zRnJvbUNvbHVtbnMgaW4gYmFzZXMuanMpOyBvdGhlcndpc2UgdGhlXG4vLyByZW1vdmFsIGRpYWxvZyB3b3VsZCBvZmZlciBleGFjdGx5IHRoZSBjb2x1bW5zIGNob3NlbiB3aGVuIHRoZSBCYXNlIHdhc1xuLy8gY3JlYXRlZC5cbmNsYXNzIENvbHVtbk9wdGlvbnNNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgY29uc3RydWN0b3IocGx1Z2luLCB0YXJnZXQsIHByZXZpZXcsIGluaXRpYWwsIHJlc29sdmUpIHtcbiAgICBzdXBlcihwbHVnaW4uYXBwKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgICB0aGlzLnRhcmdldCA9IHRhcmdldDtcbiAgICB0aGlzLnByZXZpZXcgPSBwcmV2aWV3O1xuICAgIHRoaXMucmVzb2x2ZSA9IHJlc29sdmU7XG4gICAgdGhpcy5vcHRpb25zID0geyBmbG9hdGluZzogZmFsc2UsIGFsbFN1YnR5cHM6IGZhbHNlLCB0YWdzOiBmYWxzZSwgLi4uaW5pdGlhbCB9O1xuICAgIHRoaXMuY29uZmlybWVkID0gZmFsc2U7XG4gIH1cblxuICBvbk9wZW4oKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgdGhpcy5tb2RhbEVsLmFkZENsYXNzKFwidHlwLWJhc2Utb3B0aW9ucy1tb2RhbFwiKTtcbiAgICB0aGlzLnRpdGxlRWwuc2V0VGV4dChgQ29sdW1ucyBmb3IgJHt0YXJnZXRMYWJlbCh0aGlzLnRhcmdldCl9YCk7XG5cbiAgICBjb25zdCB0b2dnbGUgPSAobmFtZSwgZGVzY3JpcHRpb24sIGtleSkgPT4ge1xuICAgICAgbmV3IFNldHRpbmcoY29udGVudEVsKVxuICAgICAgICAuc2V0TmFtZShuYW1lKVxuICAgICAgICAuc2V0RGVzYyhkZXNjcmlwdGlvbilcbiAgICAgICAgLmFkZFRvZ2dsZSgoY29udHJvbCkgPT5cbiAgICAgICAgICBjb250cm9sLnNldFZhbHVlKHRoaXMub3B0aW9uc1trZXldKS5vbkNoYW5nZSgodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMub3B0aW9uc1trZXldID0gdmFsdWU7XG4gICAgICAgICAgICB0aGlzLnJlbmRlclByZXZpZXcoKTtcbiAgICAgICAgICB9KVxuICAgICAgICApO1xuICAgIH07XG5cbiAgICB0b2dnbGUoXCJGbG9hdGluZyBwcm9wZXJ0aWVzXCIsIFwiSW5jbHVkZSB0aGUgYmxvY2sncyBmbG9hdGluZyAoaXRhbGljKSBwcm9wZXJ0aWVzLlwiLCBcImZsb2F0aW5nXCIpO1xuICAgIGlmICghdGhpcy50YXJnZXQuc3VidHlwKSB7XG4gICAgICB0b2dnbGUoXCJBbGwgU3VidHlwIHByb3BlcnRpZXNcIiwgXCJBbHNvIGluY2x1ZGUgdGhlIHByb3BlcnRpZXMgb2YgZXZlcnkgU3VidHlwIGJsb2NrIG9mIHRoaXMgVFlQLlwiLCBcImFsbFN1YnR5cHNcIik7XG4gICAgfVxuICAgIHRvZ2dsZShcInRhZ3NcIiwgXCJBZGQgdGhlIHRhZ3MgcHJvcGVydHkgYXMgYSBjb2x1bW4uXCIsIFwidGFnc1wiKTtcblxuICAgIHRoaXMucHJldmlld0VsID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtYmFzZS1wcmV2aWV3XCIgfSk7XG4gICAgdGhpcy5yZW5kZXJQcmV2aWV3KCk7XG5cbiAgICBjb25zdCBidXR0b25Sb3cgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcIm1vZGFsLWJ1dHRvbi1jb250YWluZXJcIiB9KTtcbiAgICBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyB0ZXh0OiBcIkNhbmNlbFwiIH0pLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlKCkpO1xuICAgIGNvbnN0IGNvbmZpcm0gPSBidXR0b25Sb3cuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IFwibW9kLWN0YVwiLCB0ZXh0OiBcIkFwcGx5XCIgfSk7XG4gICAgY29uZmlybS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5jb25maXJtZWQgPSB0cnVlO1xuICAgICAgdGhpcy5jbG9zZSgpO1xuICAgIH0pO1xuICB9XG5cbiAgcmVuZGVyUHJldmlldygpIHtcbiAgICBjb25zdCBpZHMgPSB0aGlzLnByZXZpZXcodGhpcy5vcHRpb25zKTtcbiAgICB0aGlzLnByZXZpZXdFbC5lbXB0eSgpO1xuICAgIHRoaXMucHJldmlld0VsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtYmFzZS1wcmV2aWV3LXRpdGxlXCIsIHRleHQ6IHBsdXJhbChpZHMubGVuZ3RoLCBcImNvbHVtblwiKSB9KTtcbiAgICBjb25zdCBsaXN0ID0gdGhpcy5wcmV2aWV3RWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1iYXNlLXByZXZpZXctbGlzdFwiIH0pO1xuICAgIGZvciAoY29uc3QgaWQgb2YgaWRzKSBsaXN0LmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLWJhc2UtcHJldmlldy1jb2x1bW5cIiwgdGV4dDogY29sdW1uTGFiZWwoaWQpIH0pO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIC8vIEVTQyBvciBhIGNsaWNrIG91dHNpZGUgY291bnRzIGFzIGNhbmNlbC5cbiAgICB0aGlzLnJlc29sdmUodGhpcy5jb25maXJtZWQgPyB0aGlzLm9wdGlvbnMgOiBudWxsKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBhc2tDb2x1bW5PcHRpb25zKHBsdWdpbiwgdGFyZ2V0LCBwcmV2aWV3LCBpbml0aWFsID0gbnVsbCkge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IG5ldyBDb2x1bW5PcHRpb25zTW9kYWwocGx1Z2luLCB0YXJnZXQsIHByZXZpZXcsIGluaXRpYWwsIHJlc29sdmUpLm9wZW4oKSk7XG59XG5cbi8qIC0tLSBDb25maXJtIHJlbW92YWxzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuLy8gQWRkaW5nIGFuZCByZW9yZGVyaW5nIGNvbHVtbnMgaGFwcGVuIHNpbGVudGx5OyBvbmx5IHJlbW92aW5nIGlzIHNob3duLFxuLy8gYmVjYXVzZSBvbmx5IHRoYXQgbG9zZXMgc29tZXRoaW5nLiBFdmVyeSBlbnRyeSBzdGFydHMgY2hlY2tlZDsgYW4gdW5jaGVja2VkXG4vLyBjb2x1bW4gaXMga2VwdCAoYXQgdGhlIGZyb250LCBzZWUgdXBkYXRlQWN0aXZlVmlldykuXG4vL1xuLy8gVGhlIHF1ZXN0aW9uIGlzIHRoZSB0aXRsZSwgYXMgaW4gdGhlIHBsdWdpbidzIG90aGVyIGNvbmZpcm1hdGlvbnNcbi8vIChjb25maXJtLW1vZGFsLmpzKS4gTm90IGJ1aWx0IG9uIENvbmZpcm1Nb2RhbCwgdGhvdWdoOiB0aGUgYWN0aW9uIGJ1dHRvblxuLy8gZm9sbG93cyB0aGUgY2hlY2tlZCBjb2x1bW5zIGluIGxhYmVsIGFuZCBjb2xvci4gTGlrZSBldmVyeSBkaWFsb2cgdGhhdFxuLy8gcmV3cml0ZXMgYSBmaWxlLCBpdCBjYW4ndCBiZSBzd2l0Y2hlZCBvZmYuXG5jbGFzcyBSZW1vdmFsTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKHBsdWdpbiwgY29sdW1ucywgdmlld05hbWUsIHJlc29sdmUpIHtcbiAgICBzdXBlcihwbHVnaW4uYXBwKTtcbiAgICB0aGlzLmNvbHVtbnMgPSBjb2x1bW5zO1xuICAgIHRoaXMudmlld05hbWUgPSB2aWV3TmFtZTtcbiAgICB0aGlzLnJlc29sdmUgPSByZXNvbHZlO1xuICAgIHRoaXMubWFya2VkID0gbmV3IFNldChjb2x1bW5zKTtcbiAgICB0aGlzLmNvbmZpcm1lZCA9IGZhbHNlO1xuICB9XG5cbiAgb25PcGVuKCkge1xuICAgIGNvbnN0IHsgY29udGVudEVsIH0gPSB0aGlzO1xuICAgIHRoaXMubW9kYWxFbC5hZGRDbGFzcyhcInR5cC1iYXNlLXJlbW92YWwtbW9kYWxcIik7XG4gICAgdGhpcy50aXRsZUVsLnNldFRleHQoYFJlbW92ZSBjb2x1bW5zIGZyb20gXCIke3RoaXMudmlld05hbWV9XCI/YCk7XG4gICAgY29udGVudEVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICBjbHM6IFwidHlwLWJhc2UtcmVtb3ZhbC1pbnRyb1wiLFxuICAgICAgdGV4dDogXCJUaGVzZSBjb2x1bW5zIGRvbid0IGJlbG9uZyB0byB0aGUgVFlQLiBVbmNoZWNrZWQgb25lcyBhcmUga2VwdC5cIixcbiAgICB9KTtcblxuICAgIC8vIENoZWNrYm94ZXMgcmF0aGVyIHRoYW4gdG9nZ2xlczogYSB0b2dnbGUgcmVhZHMgYXMgYSBzZXR0aW5nIHRoYXQgc3RheXMsXG4gICAgLy8gYSBjaGVja2JveCBhcyBhIGNob2ljZSBmb3IgdGhpcyBvbmUgcnVuLlxuICAgIGZvciAoY29uc3QgaWQgb2YgdGhpcy5jb2x1bW5zKSB7XG4gICAgICBjb25zdCBzZXR0aW5nID0gbmV3IFNldHRpbmcoY29udGVudEVsKS5zZXROYW1lKGNvbHVtbkxhYmVsKGlkKSk7XG4gICAgICBjb25zdCBsYWJlbCA9IHNldHRpbmcuY29udHJvbEVsLmNyZWF0ZUVsKFwibGFiZWxcIiwgeyBjbHM6IFwidHlwLWJhc2UtcmVtb3ZhbC1jaGVja1wiIH0pO1xuICAgICAgY29uc3QgY2hlY2tib3ggPSBsYWJlbC5jcmVhdGVFbChcImlucHV0XCIsIHsgdHlwZTogXCJjaGVja2JveFwiIH0pO1xuICAgICAgY2hlY2tib3guY2hlY2tlZCA9IHRydWU7XG4gICAgICBsYWJlbC5hcHBlbmRUZXh0KFwiUmVtb3ZlXCIpO1xuICAgICAgY2hlY2tib3guYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICAgIGlmIChjaGVja2JveC5jaGVja2VkKSB0aGlzLm1hcmtlZC5hZGQoaWQpO1xuICAgICAgICBlbHNlIHRoaXMubWFya2VkLmRlbGV0ZShpZCk7XG4gICAgICAgIHRoaXMudXBkYXRlQ29uZmlybSgpO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gQ2FuY2VsIGRyb3BzIHRoZSB3aG9sZSBydW4gKHVwZGF0ZUFjdGl2ZVZpZXcgd3JpdGVzIG5vdGhpbmcpLCB3aGljaFxuICAgIC8vIHRoZSBkaWFsb2cgaXRzZWxmIHdvdWxkbid0IG90aGVyd2lzZSB0ZWxsLlxuICAgIGNvbnRlbnRFbC5jcmVhdGVFbChcInBcIiwge1xuICAgICAgY2xzOiBcInR5cC1iYXNlLXJlbW92YWwtbm90ZVwiLFxuICAgICAgdGV4dDogXCJDYW5jZWwgZGlzY2FyZHMgdGhlIHdob2xlIHVwZGF0ZSwgaW5jbHVkaW5nIGFkZGluZyBhbmQgcmVvcmRlcmluZyBjb2x1bW5zLlwiLFxuICAgIH0pO1xuXG4gICAgY29uc3QgYnV0dG9uUm93ID0gY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJtb2RhbC1idXR0b24tY29udGFpbmVyXCIgfSk7XG4gICAgdGhpcy5jYW5jZWxCdXR0b24gPSBuZXcgQnV0dG9uQ29tcG9uZW50KGJ1dHRvblJvdykuc2V0QnV0dG9uVGV4dChcIkNhbmNlbFwiKS5vbkNsaWNrKCgpID0+IHRoaXMuY2xvc2UoKSk7XG4gICAgdGhpcy5jb25maXJtQnV0dG9uID0gbmV3IEJ1dHRvbkNvbXBvbmVudChidXR0b25Sb3cpLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgdGhpcy5jb25maXJtZWQgPSB0cnVlO1xuICAgICAgdGhpcy5jbG9zZSgpO1xuICAgIH0pO1xuICAgIHRoaXMudXBkYXRlQ29uZmlybSgpO1xuICB9XG5cbiAgLy8gRm9jdXMgb24gQ2FuY2VsLCBhcyBpbiB0aGUgcGx1Z2luJ3MgZGVsZXRlIGRpYWxvZ3M6IEVudGVyIHRoZW4gb25seSBkcm9wc1xuICAvLyB0aGUgcnVuIGluc3RlYWQgb2YgcmVtb3ZpbmcgY29sdW1ucyBmcm9tIHRoZSBmaWxlLiBIZXJlLCBub3QgaW4gb25PcGVuOlxuICAvLyBNb2RhbC5vcGVuKCkgZm9jdXNlcyB0aGUgZmlyc3QgaW5wdXQgKHRoZSBmaXJzdCBjaGVja2JveCkgYWZ0ZXIgb25PcGVuLlxuICBvcGVuKCkge1xuICAgIHN1cGVyLm9wZW4oKTtcbiAgICB0aGlzLmNhbmNlbEJ1dHRvbj8uYnV0dG9uRWwuZm9jdXMoKTtcbiAgfVxuXG4gIC8vIFwiUmVtb3ZlIDMgY29sdW1uc1wiIGluIHJlZCB3aGlsZSBhbnl0aGluZyBnb2VzLCBcIktlZXAgYWxsIGNvbHVtbnNcIiBhcyBhXG4gIC8vIHBsYWluIGNvbmZpcm1hdGlvbiBvbmNlIG5vdGhpbmcgaXMgY2hlY2tlZC4gc2V0V2FybmluZygpIGlzXG4gIC8vIHNldERlc3RydWN0aXZlKCkgcGx1cyBzZXRDdGEoKSBzaW5jZSBPYnNpZGlhbiAxLjEzIC0gdGhlIHJlZCBidXR0b24gb2ZcbiAgLy8gQ29uZmlybU1vZGFsIC0gYW5kIGhhcyBubyBjb3VudGVycGFydCwgaGVuY2UgdGhlIHJlc2V0IGJ5IGNsYXNzLlxuICB1cGRhdGVDb25maXJtKCkge1xuICAgIGNvbnN0IGNvdW50ID0gdGhpcy5tYXJrZWQuc2l6ZTtcbiAgICBjb25zdCBidXR0b24gPSB0aGlzLmNvbmZpcm1CdXR0b247XG4gICAgYnV0dG9uLmJ1dHRvbkVsLnJlbW92ZUNsYXNzKFwibW9kLWN0YVwiLCBcIm1vZC1kZXN0cnVjdGl2ZVwiKTtcbiAgICBpZiAoY291bnQgPiAwKSBidXR0b24uc2V0QnV0dG9uVGV4dChgUmVtb3ZlICR7cGx1cmFsKGNvdW50LCBcImNvbHVtblwiKX1gKS5zZXRXYXJuaW5nKCk7XG4gICAgZWxzZSBidXR0b24uc2V0QnV0dG9uVGV4dChcIktlZXAgYWxsIGNvbHVtbnNcIikuc2V0Q3RhKCk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gICAgdGhpcy5yZXNvbHZlKHRoaXMuY29uZmlybWVkID8gdGhpcy5tYXJrZWQgOiBudWxsKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBhc2tSZW1vdmFscyhwbHVnaW4sIGNvbHVtbnMsIHZpZXdOYW1lKSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gbmV3IFJlbW92YWxNb2RhbChwbHVnaW4sIGNvbHVtbnMsIHZpZXdOYW1lLCByZXNvbHZlKS5vcGVuKCkpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgYXNrQ29sdW1uT3B0aW9ucywgYXNrUmVtb3ZhbHMgfTtcbiIsICJjb25zdCB7IE5vdGljZSwgVEZpbGUsIHN0cmluZ2lmeVlhbWwgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgZ2V0U3VidHlwTmFtZXMgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cHNcIik7XG5jb25zdCB7IG5vcm1hbGl6ZUdsb2JhbE9yZGVyLCBUWVBfUFJPUEVSVFksIFNVQlRZUF9QUk9QRVJUWSB9ID0gcmVxdWlyZShcIi4vZnJvbnRtYXR0ZXItc29ydFwiKTtcbmNvbnN0IHsgYXNrQ29sdW1uT3B0aW9ucywgYXNrUmVtb3ZhbHMgfSA9IHJlcXVpcmUoXCIuL2Jhc2UtZGlhbG9nc1wiKTtcbmNvbnN0IHsgcGx1cmFsIH0gPSByZXF1aXJlKFwiLi90eXAtdXRpbHNcIik7XG5cbi8qID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICogQmFzZXMgZnJvbSBhIFRZUFxuICogQ3JlYXRlcyBhIC5iYXNlIGluIHRoZSB2YXVsdCByb290IGZvciBhIFRZUCAob3IgYSBTdWJ0eXAgbmFtZSk6XG4gKiBhIFRZUCBmaWx0ZXIsIG9uZSB0YWJsZSB2aWV3IHBlciBTdWJ0eXAsIGFuZCBjb2x1bW5zIGZyb20gdGhlXG4gKiBUWVAtRnJvbnRtYXR0ZXIgcGx1cyB0aGUgZ2xvYmFsIHByb3BlcnR5IG9yZGVyLiBUaGUgc2Vjb25kXG4gKiBjb21tYW5kIGJyaW5ncyB0aGUgY29sdW1ucyBvZiBhbiBleGlzdGluZyB2aWV3IHVwIHRvIGRhdGUuXG4gKlxuICogV3JpdGVzIG9ubHkgdGhyb3VnaCBPYnNpZGlhbidzIG93biBCYXNlcyBBUEkgYW5kIHNlcmlhbGl6YXRpb25cbiAqIChzZWUgYXBwZW5kVmlld3MpLCBuZXZlciB0aHJvdWdoIHNlbGYtcGFyc2VkIFlBTUwgLSBmb3JtdWxhXG4gKiBibG9ja3MgYW5kIHNwZWNpYWwga2V5cyB3b3VsZG4ndCByZWxpYWJseSBzdXJ2aXZlIHRoZSByb3VuZCB0cmlwLlxuICogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09ICovXG5cbi8vIFZpZXcgcHJvcGVydHkgaWRzIGFyZSBmdWxseSBxdWFsaWZpZWQgaW4gbWVtb3J5IChcIm5vdGUuVGl0ZWxcIiwgXCJmaWxlLm5hbWVcIixcbi8vIFwiZm9ybXVsYS5YXCIpIGJ1dCBzdG9yZWQgd2l0aG91dCBcIm5vdGUuXCIgaW4gdGhlIGZpbGUuIGNmZy5zZXRPcmRlcigpIHdhbnRzXG4vLyB0aGUgcXVhbGlmaWVkIGZvcm0sIGEgdmlldyBvYmplY3QgYnVpbHQgZm9yIHRoZSBmaWxlIHRoZSBzaG9ydCBvbmUgLVxuLy8gc2VyaWFsaXplSWQoKSBjb252ZXJ0cy5cbmNvbnN0IEZJTEVfTkFNRV9JRCA9IFwiZmlsZS5uYW1lXCI7XG5jb25zdCBOT1RFX1BSRUZJWCA9IFwibm90ZS5cIjtcbmNvbnN0IFRBR1NfUFJPUEVSVFkgPSBcInRhZ3NcIjtcbmNvbnN0IEJBU0VfRVhURU5TSU9OID0gXCJiYXNlXCI7XG4vLyBJZCBvZiB0aGUgQmFzZXMgY29yZSBwbHVnaW4gKGFzIGluIC5vYnNpZGlhbi9jb3JlLXBsdWdpbnMuanNvbikuXG5jb25zdCBCQVNFU19QTFVHSU5fSUQgPSBcImJhc2VzXCI7XG5cbi8vIFdpdGhvdXQgdGhlIEJhc2VzIGNvcmUgcGx1Z2luIGEgLmJhc2UgZmlsZSBjYW4ndCBiZSBvcGVuZWQsIHNvIGNyZWF0aW5nIG9uZVxuLy8gd291bGQgb25seSBsZWF2ZSBhIGRlYWQgZmlsZSBiZWhpbmQgKHNlZSBcImNyZWF0ZS1iYXNlLWZvci10eXBcIiBpblxuLy8gY29tbWFuZHMuanMpLlxuZnVuY3Rpb24gaXNCYXNlc0VuYWJsZWQoYXBwKSB7XG4gIHJldHVybiAhIWFwcC5pbnRlcm5hbFBsdWdpbnM/LmdldEVuYWJsZWRQbHVnaW5CeUlkPy4oQkFTRVNfUExVR0lOX0lEKTtcbn1cblxuZnVuY3Rpb24gbm90ZUlkKGtleSkge1xuICByZXR1cm4gTk9URV9QUkVGSVggKyBrZXk7XG59XG5cbmZ1bmN0aW9uIHNlcmlhbGl6ZUlkKGlkKSB7XG4gIHJldHVybiBpZC5zdGFydHNXaXRoKE5PVEVfUFJFRklYKSA/IGlkLnNsaWNlKE5PVEVfUFJFRklYLmxlbmd0aCkgOiBpZDtcbn1cblxuZnVuY3Rpb24gc2FtZUlkKGEsIGIpIHtcbiAgcmV0dXJuIGEudG9Mb3dlckNhc2UoKSA9PT0gYi50b0xvd2VyQ2FzZSgpO1xufVxuXG4vLyBBIGZpbHRlciBleHByZXNzaW9uIHRoZSB3YXkgQmFzZXMgd3JpdGVzIGl0OiBUWVAgPT0gXCJNRURJQVwiLiBKU09OLnN0cmluZ2lmeVxuLy8gcXVvdGVzIGNvcnJlY3RseSBldmVuIGlmIHRoZSBuYW1lIGNvbnRhaW5zIGEgcXVvdGUuXG5mdW5jdGlvbiBlcXVhbHNGaWx0ZXIocHJvcGVydHksIHZhbHVlKSB7XG4gIHJldHVybiBgJHtwcm9wZXJ0eX0gPT0gJHtKU09OLnN0cmluZ2lmeShTdHJpbmcodmFsdWUpKX1gO1xufVxuXG4vKiAtLS0gUmVhZGluZyBUWVAvU3VidHlwIGZyb20gYW4gZXhpc3RpbmcgZmlsdGVyIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gKiBBIGdlbmVyYXRlZCB2aWV3IGNhcnJpZXMgaXRzIFRZUCBpbiB0aGUgcm9vdCBvciB2aWV3IGZpbHRlcjsgdGhlIHVwZGF0ZVxuICogY29tbWFuZCByZWFkcyBpdCBmcm9tIHRoZXJlIGluc3RlYWQgb2YgYXNraW5nLiBPbmx5IHVuYW1iaWd1b3VzIGZpbHRlcnNcbiAqIGNvdW50OiBhIHB1cmUgQU5EIHdpdGggZXhhY3RseSBvbmUgVFlQIG9yIFNVQlRZUCBjb21wYXJpc29uLiBBbiBPUiBncm91cFxuICogZG9lc24ndCBuZWNlc3NhcmlseSByZXN0cmljdCwgYW5kIGEgc2Vjb25kLCBkaWZmZXJlbnQgdmFsdWUgY29udHJhZGljdHMgLVxuICogYm90aCBnaXZlIG51bGwgYW5kIHRoZSBjb21tYW5kIGFza3MgaW5zdGVhZCAoc2VlIHVwZGF0ZUFjdGl2ZVZpZXcpLlxuICogLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5jb25zdCBFUVVBTFNfUEFUVEVSTiA9IG5ldyBSZWdFeHAoYF5cXFxccyooJHtUWVBfUFJPUEVSVFl9fCR7U1VCVFlQX1BST1BFUlRZfSlcXFxccyo9PVxcXFxzKiguKz8pXFxcXHMqJGAsIFwiaVwiKTtcblxuZnVuY3Rpb24gZmlsdGVyTGl0ZXJhbChyYXcpIHtcbiAgaWYgKHJhdy5sZW5ndGggPj0gMiAmJiByYXdbMF0gPT09ICdcIicgJiYgcmF3LmVuZHNXaXRoKCdcIicpKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBKU09OLnBhcnNlKHJhdyk7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH1cbiAgaWYgKHJhdy5sZW5ndGggPj0gMiAmJiByYXdbMF0gPT09IFwiJ1wiICYmIHJhdy5lbmRzV2l0aChcIidcIikpIHJldHVybiByYXcuc2xpY2UoMSwgLTEpO1xuICByZXR1cm4gbnVsbDtcbn1cblxuZnVuY3Rpb24gY29sbGVjdEVxdWFscyhub2RlLCBmb3VuZCkge1xuICBpZiAoIW5vZGUpIHJldHVybjtcbiAgaWYgKHR5cGVvZiBub2RlID09PSBcInN0cmluZ1wiKSB7XG4gICAgY29uc3QgbWF0Y2ggPSBFUVVBTFNfUEFUVEVSTi5leGVjKG5vZGUpO1xuICAgIGlmICghbWF0Y2gpIHJldHVybjtcbiAgICBjb25zdCB2YWx1ZSA9IGZpbHRlckxpdGVyYWwobWF0Y2hbMl0pO1xuICAgIGlmICh2YWx1ZSAhPT0gbnVsbCkgZm91bmRbbWF0Y2hbMV0udG9VcHBlckNhc2UoKV0uYWRkKHZhbHVlKTtcbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKEFycmF5LmlzQXJyYXkobm9kZSkpIHtcbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIG5vZGUpIGNvbGxlY3RFcXVhbHMoZW50cnksIGZvdW5kKTtcbiAgICByZXR1cm47XG4gIH1cbiAgLy8gQU5EIG9ubHk6IGFuIE9SL05PVCBncm91cCBzYXlzIG5vdGhpbmcgcmVsaWFibGUgYWJvdXQgdGhlIFRZUCBvZiB0aGUgaGl0cy5cbiAgaWYgKG5vZGUuYW5kKSBjb2xsZWN0RXF1YWxzKG5vZGUuYW5kLCBmb3VuZCk7XG59XG5cbmZ1bmN0aW9uIHJlYWRUYXJnZXQoLi4uZmlsdGVyR3JvdXBzKSB7XG4gIGNvbnN0IGZvdW5kID0geyBbVFlQX1BST1BFUlRZXTogbmV3IFNldCgpLCBbU1VCVFlQX1BST1BFUlRZXTogbmV3IFNldCgpIH07XG4gIGZvciAoY29uc3QgZ3JvdXAgb2YgZmlsdGVyR3JvdXBzKSBjb2xsZWN0RXF1YWxzKGdyb3VwLCBmb3VuZCk7XG4gIGNvbnN0IHR5cHMgPSBbLi4uZm91bmRbVFlQX1BST1BFUlRZXV07XG4gIGNvbnN0IHN1YnR5cHMgPSBbLi4uZm91bmRbU1VCVFlQX1BST1BFUlRZXV07XG4gIGlmICh0eXBzLmxlbmd0aCA+IDEgfHwgc3VidHlwcy5sZW5ndGggPiAxKSByZXR1cm4gbnVsbDtcbiAgaWYgKHR5cHMubGVuZ3RoID09PSAwICYmIHN1YnR5cHMubGVuZ3RoID09PSAwKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHsgdHlwOiB0eXBzWzBdID8/IG51bGwsIHN1YnR5cDogc3VidHlwc1swXSA/PyBudWxsIH07XG59XG5cbi8qIC0tLSBDb2x1bW5zIG9mIGEgdGFyZ2V0IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuLy8gVFlQIGFuZCBTVUJUWVAgbmV2ZXIgYmVjb21lIGNvbHVtbnMgKGZpbHRlciBhbmQgZ3JvdXBpbmcgYWxyZWFkeSBzaG93XG4vLyB0aGVtKSwgbm9yIGRvZXMgdGhlIGVkaXRvcidzIGJsYW5rIHJvdy5cbmZ1bmN0aW9uIGlzU3lzdGVtS2V5KGtleSkge1xuICByZXR1cm4ga2V5ID09PSBcIlwiIHx8IHNhbWVJZChrZXksIFRZUF9QUk9QRVJUWSkgfHwgc2FtZUlkKGtleSwgU1VCVFlQX1BST1BFUlRZKTtcbn1cblxuLy8gQSBibG9jaydzIHByb3BlcnRpZXMgaW4gc3RvcmVkIG9yZGVyLCB2aWEgY29sbGVjdEJsb2NrcygpIChtYWluLmpzKSwgc28gdGhlXG4vLyBzYW1lIHJ1bGVzIGFwcGx5OiB0aGUgU3VidHlwIGJsb2NrIGZvbGxvd3MgdGhlIFRZUC1Gcm9udG1hdHRlciwgYSBrZXkgaW4gYm90aFxuLy8ga2VlcHMgdGhlIFRZUC1Gcm9udG1hdHRlciBwb3NpdGlvbiwgYW5kIHRoZSBTdWJ0eXAncyBmbG9hdGluZyBmbGFnIHdpbnMgLSBhXG4vLyBTdWJ0eXAgY2FuIGtlZXAgYSBzdGFuZGFyZCBwcm9wZXJ0eSBvdXQgb2YgaXRzIHZpZXcgdGhhdCB3YXkuXG5mdW5jdGlvbiBibG9ja0tleXMocGx1Z2luLCB0eXAsIHN1YnR5cCwgaW5jbHVkZUZsb2F0aW5nKSB7XG4gIGNvbnN0IHsgZGVmYXVsdHMgfSA9IHBsdWdpbi5jb2xsZWN0QmxvY2tzKHR5cCwgc3VidHlwLCBpbmNsdWRlRmxvYXRpbmcpO1xuICByZXR1cm4gT2JqZWN0LmtleXMoZGVmYXVsdHMpLmZpbHRlcigoa2V5KSA9PiAhaXNTeXN0ZW1LZXkoa2V5KSk7XG59XG5cbi8vIEV2ZXJ5IFRZUCB0aGF0IGhhcyBhIFN1YnR5cCBvZiB0aGlzIG5hbWUsIGluIFRZUC1MaXN0IG9yZGVyLiBUaGUgc2FtZVxuLy8gU3VidHlwIG5hbWUgbWF5IGV4aXN0IHVuZGVyIHNldmVyYWwgVFlQIGVudHJpZXM7IGEgc3RhbmRhbG9uZSBTdWJ0eXAgQmFzZVxuLy8gZmlsdGVycyBieSBTVUJUWVAgb25seSBhbmQgc28gc2hvd3MgYWxsIG9mIHRoZW0uXG5mdW5jdGlvbiB0eXBzRm9yU3VidHlwKHBsdWdpbiwgc3VidHlwKSB7XG4gIHJldHVybiBwbHVnaW4uc2V0dGluZ3MudHlwcy5maWx0ZXIoKHR5cCkgPT4gZ2V0U3VidHlwTmFtZXMocGx1Z2luLnNldHRpbmdzLCB0eXApLmluY2x1ZGVzKHN1YnR5cCkpO1xufVxuXG4vLyBBIHRhcmdldCBpcyB7IHR5cCwgc3VidHlwIH06XG4vLyAgIHsgdHlwLCBzdWJ0eXA6IG51bGwgfSAgLSB0aGUgVFlQIGl0c2VsZlxuLy8gICB7IHR5cCwgc3VidHlwIH0gICAgICAgIC0gYSBTdWJ0eXAgd2l0aGluIGl0cyBUWVBcbi8vICAgeyB0eXA6IG51bGwsIHN1YnR5cCB9ICAtIGEgU3VidHlwIG5hbWUgbm90IGJvdW5kIHRvIGEgVFlQIChzdGFuZGFsb25lXG4vLyAgICAgICAgICAgICAgICAgICAgICAgICAgICBTdWJ0eXAgQmFzZSwgY29sdW1ucyBtZXJnZWQgYWNyb3NzIFRZUCBlbnRyaWVzKVxuZnVuY3Rpb24gdGFyZ2V0S2V5cyhwbHVnaW4sIHRhcmdldCwgb3B0aW9ucykge1xuICBjb25zdCBzZWVuID0gbmV3IFNldCgpO1xuICBjb25zdCBtYWluID0gW107XG4gIGNvbnN0IG90aGVycyA9IFtdO1xuICBjb25zdCBhZGQgPSAobGlzdCwga2V5cykgPT4ge1xuICAgIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIHtcbiAgICAgIGNvbnN0IGxvd2VyID0ga2V5LnRvTG93ZXJDYXNlKCk7XG4gICAgICBpZiAoc2Vlbi5oYXMobG93ZXIpKSBjb250aW51ZTtcbiAgICAgIHNlZW4uYWRkKGxvd2VyKTtcbiAgICAgIGxpc3QucHVzaChrZXkpO1xuICAgIH1cbiAgfTtcblxuICBpZiAoIXRhcmdldC50eXApIHtcbiAgICBmb3IgKGNvbnN0IHR5cCBvZiB0eXBzRm9yU3VidHlwKHBsdWdpbiwgdGFyZ2V0LnN1YnR5cCkpIHtcbiAgICAgIGFkZChtYWluLCBibG9ja0tleXMocGx1Z2luLCB0eXAsIHRhcmdldC5zdWJ0eXAsIG9wdGlvbnMuZmxvYXRpbmcpKTtcbiAgICB9XG4gICAgcmV0dXJuIHsgbWFpbiwgb3RoZXJzIH07XG4gIH1cblxuICBhZGQobWFpbiwgYmxvY2tLZXlzKHBsdWdpbiwgdGFyZ2V0LnR5cCwgdGFyZ2V0LnN1YnR5cCwgb3B0aW9ucy5mbG9hdGluZykpO1xuICAvLyBPbmx5IGZvciB0aGUgVFlQIHZpZXc6IGluIGEgU3VidHlwIHZpZXcgdGhlIG90aGVyIGJsb2NrcyB3b3VsZCBzdGF5IGVtcHR5LFxuICAvLyBzaW5jZSBhIG5vdGUgaGFzIGF0IG1vc3Qgb25lIFNVQlRZUC4gS2V5cyBhbHJlYWR5IGluIG1haW4gZHJvcCBvdXQgdmlhXG4gIC8vIFwic2VlblwiLlxuICBpZiAob3B0aW9ucy5hbGxTdWJ0eXBzICYmICF0YXJnZXQuc3VidHlwKSB7XG4gICAgZm9yIChjb25zdCBzdWJ0eXAgb2YgZ2V0U3VidHlwTmFtZXMocGx1Z2luLnNldHRpbmdzLCB0YXJnZXQudHlwKSkge1xuICAgICAgYWRkKG90aGVycywgYmxvY2tLZXlzKHBsdWdpbiwgdGFyZ2V0LnR5cCwgc3VidHlwLCBvcHRpb25zLmZsb2F0aW5nKSk7XG4gICAgfVxuICB9XG4gIHJldHVybiB7IG1haW4sIG90aGVycyB9O1xufVxuXG4vLyBUaGUgY29sdW1uIG9wdGlvbnMgYSB2aWV3J3MgY3VycmVudCBjb2x1bW5zIHN1Z2dlc3QsIHRvIHByZXNldCB0aGUgY29sdW1uXG4vLyBkaWFsb2cgd2hlbiB1cGRhdGluZyAoY3VycmVudElkcyBxdWFsaWZpZWQsIFwibm90ZS54XCIpLiBXaXRob3V0IHRoaXMgdGhlXG4vLyBkaWFsb2cgd291bGQgc3RhcnQgYWxsIG9mZiBhbmQgdGhlIHJlbW92YWwgZGlhbG9nIHdvdWxkIG9mZmVyIGV4YWN0bHkgdGhlXG4vLyBjb2x1bW5zIGNob3NlbiB3aGVuIHRoZSBCYXNlIHdhcyBjcmVhdGVkLlxuLy8gICB0YWdzICAgICAgIC0gdGhlIHRhZ3MgY29sdW1uIGV4aXN0c1xuLy8gICBmbG9hdGluZyAgIC0gYSBmbG9hdGluZyBwcm9wZXJ0eSBvZiB0aGUgdGFyZ2V0IGV4aXN0cyBhcyBhIGNvbHVtblxuLy8gICBhbGxTdWJ0eXBzIC0gKFRZUCB0YXJnZXQgb25seSkgYSBwcm9wZXJ0eSBvZiBhbm90aGVyIFN1YnR5cCBibG9jayBleGlzdHNcbi8vICAgICAgICAgICAgICAgIGFzIGEgY29sdW1uXG4vLyBBIGhldXJpc3RpYywgb24gcHVycG9zZTogdGhlIHZpZXcga2VlcHMgbm8gcmVjb3JkIG9mIHRoZSBvcHRpb25zIGl0IHdhc1xuLy8gYnVpbHQgd2l0aC5cbmZ1bmN0aW9uIG9wdGlvbnNGcm9tQ29sdW1ucyhwbHVnaW4sIHRhcmdldCwgY3VycmVudElkcykge1xuICBjb25zdCBwcmVzZW50ID0gbmV3IFNldChjdXJyZW50SWRzLm1hcCgoaWQpID0+IGlkLnRvTG93ZXJDYXNlKCkpKTtcbiAgY29uc3QgaGFzQ29sdW1uID0gKGtleSkgPT4gcHJlc2VudC5oYXMobm90ZUlkKGtleSkudG9Mb3dlckNhc2UoKSk7XG5cbiAgY29uc3QgZml4ZWQgPSBuZXcgU2V0KFxuICAgIHRhcmdldEtleXMocGx1Z2luLCB0YXJnZXQsIHsgZmxvYXRpbmc6IGZhbHNlLCBhbGxTdWJ0eXBzOiBmYWxzZSB9KS5tYWluLm1hcCgoa2V5KSA9PiBrZXkudG9Mb3dlckNhc2UoKSlcbiAgKTtcbiAgY29uc3QgZmxvYXRpbmdLZXlzID0gdGFyZ2V0S2V5cyhwbHVnaW4sIHRhcmdldCwgeyBmbG9hdGluZzogdHJ1ZSwgYWxsU3VidHlwczogZmFsc2UgfSkubWFpbi5maWx0ZXIoXG4gICAgKGtleSkgPT4gIWZpeGVkLmhhcyhrZXkudG9Mb3dlckNhc2UoKSlcbiAgKTtcblxuICBjb25zdCBvcHRpb25zID0ge1xuICAgIGZsb2F0aW5nOiBmbG9hdGluZ0tleXMuc29tZShoYXNDb2x1bW4pLFxuICAgIGFsbFN1YnR5cHM6IGZhbHNlLFxuICAgIHRhZ3M6IGhhc0NvbHVtbihUQUdTX1BST1BFUlRZKSxcbiAgfTtcbiAgaWYgKHRhcmdldC50eXAgJiYgIXRhcmdldC5zdWJ0eXApIHtcbiAgICBvcHRpb25zLmFsbFN1YnR5cHMgPSB0YXJnZXRLZXlzKHBsdWdpbiwgdGFyZ2V0LCB7IGZsb2F0aW5nOiB0cnVlLCBhbGxTdWJ0eXBzOiB0cnVlIH0pLm90aGVycy5zb21lKGhhc0NvbHVtbik7XG4gIH1cbiAgcmV0dXJuIG9wdGlvbnM7XG59XG5cbi8vIFRoZSBmaW5hbCBjb2x1bW4gbGlzdDogZmlsZS5uYW1lIGZpcnN0LCB0aGVuIHRoZSBnbG9iYWwgcHJvcGVydHkgb3JkZXIgYXNcbi8vIHRoZSBmcmFtZS4gSXRzIHBsYWNlaG9sZGVycyBtZWFuIGhlcmU6XG4vLyAgIFwidHlwXCIgICAgICAgICAgICAgICAgICAgICAtIFRZUC1Gcm9udG1hdHRlciBwbHVzIHRoZSB0YXJnZXQncyBTdWJ0eXAgYmxvY2tcbi8vICAgXCJvdGhlclwiICAgICAgICAgICAgICAgICAgIC0gdGhlIHByb3BlcnRpZXMgb2YgdGhlIG90aGVyIFN1YnR5cCBibG9ja3Ncbi8vICAgXCJ0eXBWYWx1ZVwiL1wic3VidHlwVmFsdWVcIiAgLSBza2lwcGVkLCBUWVAvU1VCVFlQIGFyZSBubyBjb2x1bW5zXG4vLyBPZiB0aGUgcGlubmVkIHByb3BlcnRpZXMgb25seSB0YWdzIGNvdW50cyAoYW5kIG9ubHkgd2hlbiBjaGVja2VkKTpcbi8vIGNzc2NsYXNzZXMgb3IgYWxpYXNlcyBtYWtlIG5vIHNlbnNlIGFzIGNvbHVtbnMgb2YgYW4gb3ZlcnZpZXcgdGFibGUuXG5mdW5jdGlvbiBjb2x1bW5JZHMocGx1Z2luLCB0YXJnZXQsIG9wdGlvbnMpIHtcbiAgY29uc3QgeyBtYWluLCBvdGhlcnMgfSA9IHRhcmdldEtleXMocGx1Z2luLCB0YXJnZXQsIG9wdGlvbnMpO1xuICBjb25zdCBpZHMgPSBbXTtcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQoKTtcbiAgY29uc3QgcHVzaCA9IChpZCkgPT4ge1xuICAgIGNvbnN0IGxvd2VyID0gaWQudG9Mb3dlckNhc2UoKTtcbiAgICBpZiAoc2Vlbi5oYXMobG93ZXIpKSByZXR1cm47XG4gICAgc2Vlbi5hZGQobG93ZXIpO1xuICAgIGlkcy5wdXNoKGlkKTtcbiAgfTtcblxuICBwdXNoKEZJTEVfTkFNRV9JRCk7XG4gIGxldCB0YWdzUGxhY2VkID0gZmFsc2U7XG4gIGZvciAoY29uc3QgZW50cnkgb2Ygbm9ybWFsaXplR2xvYmFsT3JkZXIocGx1Z2luLnNldHRpbmdzLmdsb2JhbFByb3BlcnR5T3JkZXIpKSB7XG4gICAgaWYgKGVudHJ5LmtpbmQgPT09IFwicHJvcGVydHlcIikge1xuICAgICAgaWYgKG9wdGlvbnMudGFncyAmJiBlbnRyeS5uYW1lICYmIHNhbWVJZChlbnRyeS5uYW1lLCBUQUdTX1BST1BFUlRZKSkge1xuICAgICAgICBwdXNoKG5vdGVJZChlbnRyeS5uYW1lKSk7XG4gICAgICAgIHRhZ3NQbGFjZWQgPSB0cnVlO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoZW50cnkua2luZCA9PT0gXCJ0eXBcIikge1xuICAgICAgZm9yIChjb25zdCBrZXkgb2YgbWFpbikgcHVzaChub3RlSWQoa2V5KSk7XG4gICAgfSBlbHNlIGlmIChlbnRyeS5raW5kID09PSBcIm90aGVyXCIpIHtcbiAgICAgIGZvciAoY29uc3Qga2V5IG9mIG90aGVycykgcHVzaChub3RlSWQoa2V5KSk7XG4gICAgfVxuICB9XG4gIC8vIFNhZmV0eSBuZXQ6IGlmIHRhZ3MgaXNuJ3QgaW4gdGhlIGdsb2JhbCBvcmRlciwgaXQgc3RpbGwgZ29lcyBsYXN0LlxuICBpZiAob3B0aW9ucy50YWdzICYmICF0YWdzUGxhY2VkKSBwdXNoKG5vdGVJZChUQUdTX1BST1BFUlRZKSk7XG4gIHJldHVybiBpZHM7XG59XG5cbi8qIC0tLSBWaWV3cyBvZiBhIHRhcmdldCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuLy8gc2NvcGVkOiB3aGV0aGVyIGVhY2ggdmlldyBtdXN0IGNhcnJ5IGl0cyBmdWxsIGZpbHRlci4gSW4gYSBuZXcgQmFzZSB0aGUgVFlQXG4vLyBzaXRzIGluIHRoZSByb290IGZpbHRlciBhbmQgU3VidHlwIHZpZXdzIG9ubHkgYWRkIFNVQlRZUC4gVmlld3MgYXBwZW5kZWQgdG9cbi8vIGFuIGV4aXN0aW5nIEJhc2UgbGVhdmUgaXRzIHJvb3QgZmlsdGVyIGFsb25lIGFuZCBmaWx0ZXIgdGhlbXNlbHZlcy5cbmZ1bmN0aW9uIHRhcmdldFZpZXdzKHBsdWdpbiwgdGFyZ2V0LCBvcHRpb25zLCB7IHNjb3BlZCB9KSB7XG4gIGlmICghdGFyZ2V0LnR5cCkge1xuICAgIGNvbnN0IHZpZXcgPSB7XG4gICAgICB0eXBlOiBcInRhYmxlXCIsXG4gICAgICBuYW1lOiB0YXJnZXQuc3VidHlwLFxuICAgICAgb3JkZXI6IGNvbHVtbklkcyhwbHVnaW4sIHRhcmdldCwgb3B0aW9ucyksXG4gICAgfTtcbiAgICBpZiAoc2NvcGVkKSB2aWV3LmZpbHRlcnMgPSB7IGFuZDogW2VxdWFsc0ZpbHRlcihTVUJUWVBfUFJPUEVSVFksIHRhcmdldC5zdWJ0eXApXSB9O1xuICAgIC8vIFNldmVyYWwgVFlQIGVudHJpZXMgd2l0aCB0aGlzIFN1YnR5cCBuYW1lOiBncm91cGluZyBzZXBhcmF0ZXMgdGhlbVxuICAgIC8vIHdpdGhvdXQgYSB2aWV3IHBlciBUWVAuXG4gICAgaWYgKHR5cHNGb3JTdWJ0eXAocGx1Z2luLCB0YXJnZXQuc3VidHlwKS5sZW5ndGggPiAxKSB7XG4gICAgICB2aWV3Lmdyb3VwQnkgPSB7IHByb3BlcnR5OiBub3RlSWQoVFlQX1BST1BFUlRZKSwgZGlyZWN0aW9uOiBcIkFTQ1wiIH07XG4gICAgfVxuICAgIHJldHVybiBbdmlld107XG4gIH1cblxuICBjb25zdCB0eXAgPSB0YXJnZXQudHlwO1xuICBjb25zdCBzdWJ0eXBzID0gZ2V0U3VidHlwTmFtZXMocGx1Z2luLnNldHRpbmdzLCB0eXApO1xuICBjb25zdCBtYWluID0ge1xuICAgIHR5cGU6IFwidGFibGVcIixcbiAgICBuYW1lOiB0eXAsXG4gICAgb3JkZXI6IGNvbHVtbklkcyhwbHVnaW4sIHsgdHlwLCBzdWJ0eXA6IG51bGwgfSwgb3B0aW9ucyksXG4gIH07XG4gIGlmIChzY29wZWQpIG1haW4uZmlsdGVycyA9IHsgYW5kOiBbZXF1YWxzRmlsdGVyKFRZUF9QUk9QRVJUWSwgdHlwKV0gfTtcbiAgLy8gV2l0aG91dCBhbnkgU3VidHlwLCBncm91cGluZyBieSBhbiBhbHdheXMtZW1wdHkgcHJvcGVydHkgd291bGQgb25seSBnaXZlXG4gIC8vIG9uZSBcIm5vIHZhbHVlXCIgZ3JvdXAuXG4gIGlmIChzdWJ0eXBzLmxlbmd0aCA+IDApIG1haW4uZ3JvdXBCeSA9IHsgcHJvcGVydHk6IG5vdGVJZChTVUJUWVBfUFJPUEVSVFkpLCBkaXJlY3Rpb246IFwiQVNDXCIgfTtcblxuICBjb25zdCB2aWV3cyA9IFttYWluXTtcbiAgZm9yIChjb25zdCBzdWJ0eXAgb2Ygc3VidHlwcykge1xuICAgIHZpZXdzLnB1c2goe1xuICAgICAgdHlwZTogXCJ0YWJsZVwiLFxuICAgICAgbmFtZTogc3VidHlwLFxuICAgICAgLy8gYWxsU3VidHlwcyBpcyBhbHdheXMgb2ZmIGluIGEgU3VidHlwIHZpZXcgKHNlZSB0YXJnZXRLZXlzKS5cbiAgICAgIG9yZGVyOiBjb2x1bW5JZHMocGx1Z2luLCB7IHR5cCwgc3VidHlwIH0sIHsgLi4ub3B0aW9ucywgYWxsU3VidHlwczogZmFsc2UgfSksXG4gICAgICBmaWx0ZXJzOiB7XG4gICAgICAgIGFuZDogc2NvcGVkXG4gICAgICAgICAgPyBbZXF1YWxzRmlsdGVyKFRZUF9QUk9QRVJUWSwgdHlwKSwgZXF1YWxzRmlsdGVyKFNVQlRZUF9QUk9QRVJUWSwgc3VidHlwKV1cbiAgICAgICAgICA6IFtlcXVhbHNGaWx0ZXIoU1VCVFlQX1BST1BFUlRZLCBzdWJ0eXApXSxcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cbiAgcmV0dXJuIHZpZXdzO1xufVxuXG4vLyBBIHZpZXcgb2JqZWN0IGFzIGl0IGFwcGVhcnMgaW4gdGhlIGZpbGU6IHdpdGhvdXQgXCJub3RlLlwiIGFuZCB3aXRoIHRoZSBrZXlcbi8vIG9yZGVyIEJhc2VzIGl0c2VsZiB3cml0ZXMuXG5mdW5jdGlvbiBzZXJpYWxpemVWaWV3KHZpZXcpIHtcbiAgY29uc3Qgb3V0ID0geyB0eXBlOiB2aWV3LnR5cGUsIG5hbWU6IHZpZXcubmFtZSB9O1xuICBpZiAodmlldy5maWx0ZXJzKSBvdXQuZmlsdGVycyA9IHZpZXcuZmlsdGVycztcbiAgaWYgKHZpZXcub3JkZXIpIG91dC5vcmRlciA9IHZpZXcub3JkZXIubWFwKHNlcmlhbGl6ZUlkKTtcbiAgaWYgKHZpZXcuZ3JvdXBCeSkge1xuICAgIG91dC5ncm91cEJ5ID0geyBwcm9wZXJ0eTogc2VyaWFsaXplSWQodmlldy5ncm91cEJ5LnByb3BlcnR5KSwgZGlyZWN0aW9uOiB2aWV3Lmdyb3VwQnkuZGlyZWN0aW9uIH07XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cblxuLyogLS0tIE9wZW5pbmcgYW5kIHdyaXRpbmcgdGhlIGZpbGUgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSAqL1xuXG5mdW5jdGlvbiB3YWl0Rm9yKG1zKSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gd2luZG93LnNldFRpbWVvdXQocmVzb2x2ZSwgbXMpKTtcbn1cblxuLy8gT3BlbnMgdGhlIEJhc2UgYW5kIHdhaXRzIHVudGlsIGl0cyBxdWVyeSBpcyBwYXJzZWQ7IG9ubHkgdGhlbiBjYW4gaXQgYmVcbi8vIHJlYWQgYW5kIHdyaXR0ZW4uIFJldXNlcyBhIHRhYiB0aGF0IGFscmVhZHkgc2hvd3MgdGhlIGZpbGUuXG5hc3luYyBmdW5jdGlvbiBvcGVuQmFzZShhcHAsIGZpbGUpIHtcbiAgY29uc3Qgb3BlbiA9IGFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwiYmFzZXNcIikuZmluZCgobGVhZikgPT4gbGVhZi52aWV3Py5maWxlPy5wYXRoID09PSBmaWxlLnBhdGgpO1xuICBjb25zdCBsZWFmID0gb3BlbiA/PyBhcHAud29ya3NwYWNlLmdldExlYWYoXCJ0YWJcIik7XG4gIGlmIChvcGVuKSBhcHAud29ya3NwYWNlLnJldmVhbExlYWYobGVhZik7XG4gIGVsc2UgYXdhaXQgbGVhZi5vcGVuRmlsZShmaWxlLCB7IGFjdGl2ZTogdHJ1ZSB9KTtcbiAgZm9yIChsZXQgYXR0ZW1wdCA9IDA7IGF0dGVtcHQgPCA0MCAmJiAhbGVhZi52aWV3Py5xdWVyeTsgYXR0ZW1wdCsrKSBhd2FpdCB3YWl0Rm9yKDI1KTtcbiAgcmV0dXJuIGxlYWYudmlldz8ucXVlcnkgPyBsZWFmLnZpZXcgOiBudWxsO1xufVxuXG4vLyBBcHBlbmRzIHZpZXdzIHRvIGFuIGV4aXN0aW5nIEJhc2UuIGdldFNlcmlhbGl6YWJsZSgpIHJldHVybnMgZXhhY3RseSB3aGF0XG4vLyBCYXNlcyB3cml0ZXMgd2hlbiBpdCBzYXZlcyAodmVyaWZpZWQ6IHRoZSByb3VuZCB0cmlwIHJlcHJvZHVjZXMgZXhpc3Rpbmdcbi8vIGZpbGVzIGJ5dGUgZm9yIGJ5dGUsIGZvcm11bGEgYmxvY2tzIGFuZCBzcGVjaWFsIGtleXMgaW5jbHVkZWQpOyBvbmx5IHRoZVxuLy8gdmlld3MgbGlzdCBpcyB0b3VjaGVkLlxuLy9cbi8vIHZhdWx0LnByb2Nlc3MgcmF0aGVyIHRoYW4gdmF1bHQubW9kaWZ5LCBhcyBPYnNpZGlhbiByZWNvbW1lbmRzIGZvciBjaGFuZ2VzXG4vLyB0byBhIGZpbGUgdGhhdCBtYXkgYmUgb3BlbjogaXQgd3JpdGVzIGF0b21pY2FsbHkuIFRoZSBjYWxsYmFjayBpZ25vcmVzIHRoZVxuLy8gZmlsZSB0ZXh0IG9uIHB1cnBvc2UgLSBkYXRhIGNvbWVzIGZyb20gdGhlIHBhcnNlZCBxdWVyeSwgd2hpY2ggdGhlIG9wZW5cbi8vIEJhc2Uga2VlcHMgaW4gc3RlcCB3aXRoIHRoZSBmaWxlLlxuYXN5bmMgZnVuY3Rpb24gYXBwZW5kVmlld3MoYXBwLCB2aWV3LCB2aWV3cykge1xuICBjb25zdCBkYXRhID0gdmlldy5xdWVyeS5nZXRTZXJpYWxpemFibGUoKTtcbiAgZGF0YS52aWV3cyA9IFsuLi4oZGF0YS52aWV3cyA/PyBbXSksIC4uLnZpZXdzLm1hcChzZXJpYWxpemVWaWV3KV07XG4gIGF3YWl0IGFwcC52YXVsdC5wcm9jZXNzKHZpZXcuZmlsZSwgKCkgPT4gc3RyaW5naWZ5WWFtbChkYXRhKSk7XG59XG5cbi8qIC0tLSBDb21tYW5kOiBDcmVhdGUgQmFzZSBmb3IgVFlQIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gKi9cblxuLy8gRmlsZXMgYW5kIGZvbGRlcnMgb2YgdGhlIHZhdWx0IHJvb3Qgd2hvc2UgbmFtZSBtYXRjaGVzIG5hbWUgaWdub3JpbmcgY2FzZVxuLy8gYnV0IG5vdCBleGFjdGx5LiBnZXRBYnN0cmFjdEZpbGVCeVBhdGgoKSBpcyBjYXNlLXNlbnNpdGl2ZSwgd2hpbGUgV2luZG93c1xuLy8gYW5kIG1hY09TIHRyZWF0IFwiQlVDSC5iYXNlXCIgYW5kIFwiQnVjaC5iYXNlXCIgYXMgdGhlIHNhbWUgZmlsZSAtIGFuZCBTeW5jXG4vLyB3b3VsZCBjb2xsaWRlIHRoZW0gb24gZXZlcnkgb3RoZXIgZGV2aWNlLlxuZnVuY3Rpb24gY2FzZVZhcmlhbnRzKGFwcCwgbmFtZSkge1xuICBjb25zdCBsb3dlciA9IG5hbWUudG9Mb3dlckNhc2UoKTtcbiAgcmV0dXJuIGFwcC52YXVsdC5nZXRSb290KCkuY2hpbGRyZW4uZmlsdGVyKChmaWxlKSA9PiBmaWxlLm5hbWUgIT09IG5hbWUgJiYgZmlsZS5uYW1lLnRvTG93ZXJDYXNlKCkgPT09IGxvd2VyKTtcbn1cblxuLy8gPFRZUD4uYmFzZSwgb3IgPFN1YnR5cD4uYmFzZSBmb3IgYSBzdGFuZGFsb25lIFN1YnR5cCBCYXNlLiBBIFRZUCBCVUNIIGFuZFxuLy8gYSBTdWJ0eXAgQnVjaCB3b3VsZCBzaGFyZSBvbmUgZmlsZSBvbiBXaW5kb3dzLCBzbyB0aGUgU3VidHlwIEJhc2UgZ2V0c1xuLy8gXCIgKFN1YnR5cClcIiAtIGJ1dCBvbmx5IHdoZW4gdGhlcmUgYWN0dWFsbHkgaXMgYSBjbGFzaDogYSBUWVAgb2YgdGhhdCBuYW1lXG4vLyAocmVnaXN0ZXJlZCwgd2hldGhlciBvciBub3QgaXRzIEJhc2UgZXhpc3RzIHlldCkgb3IgYSByb290IC5iYXNlIGZpbGUgd2hvc2Vcbi8vIG5hbWUgZGlmZmVycyBvbmx5IGluIGNhc2UuIFRoZW4gb25seSB0aGUgbmV3IG5hbWUgY291bnRzLCB3aXRoIG5vIGZhbGxiYWNrXG4vLyB0byBcIkJ1Y2guYmFzZVwiIC0gdGhhdCBvbmUgYmVsb25ncyB0byB0aGUgVFlQLlxuZnVuY3Rpb24gYmFzZVBhdGgocGx1Z2luLCB0YXJnZXQpIHtcbiAgaWYgKHRhcmdldC50eXApIHJldHVybiBgJHt0YXJnZXQudHlwfS4ke0JBU0VfRVhURU5TSU9OfWA7XG4gIGNvbnN0IHN1YnR5cCA9IHRhcmdldC5zdWJ0eXA7XG4gIGNvbnN0IGxvd2VyID0gc3VidHlwLnRvTG93ZXJDYXNlKCk7XG4gIGNvbnN0IHR5cENsYXNoID0gcGx1Z2luLnNldHRpbmdzLnR5cHMuc29tZSgodHlwKSA9PiB0eXAudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXIpO1xuICBjb25zdCBmaWxlQ2xhc2ggPSBjYXNlVmFyaWFudHMocGx1Z2luLmFwcCwgYCR7c3VidHlwfS4ke0JBU0VfRVhURU5TSU9OfWApLmxlbmd0aCA+IDA7XG4gIHJldHVybiB0eXBDbGFzaCB8fCBmaWxlQ2xhc2ggPyBgJHtzdWJ0eXB9IChTdWJ0eXApLiR7QkFTRV9FWFRFTlNJT059YCA6IGAke3N1YnR5cH0uJHtCQVNFX0VYVEVOU0lPTn1gO1xufVxuXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVCYXNlKHBsdWdpbiwgdGFyZ2V0LCBwYXRoLCBvcHRpb25zKSB7XG4gIGNvbnN0IGFwcCA9IHBsdWdpbi5hcHA7XG4gIGNvbnN0IGV4aXN0aW5nID0gYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChwYXRoKTtcblxuICBpZiAoZXhpc3RpbmcgJiYgIShleGlzdGluZyBpbnN0YW5jZW9mIFRGaWxlKSkge1xuICAgIG5ldyBOb3RpY2UoYFwiJHtwYXRofVwiIGlzIG5vdCBhIGZpbGUgXHUyMDEzIEJhc2Ugbm90IGNyZWF0ZWQuYCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgaWYgKCFleGlzdGluZykge1xuICAgIGNvbnN0IHZpZXdzID0gdGFyZ2V0Vmlld3MocGx1Z2luLCB0YXJnZXQsIG9wdGlvbnMsIHsgc2NvcGVkOiBmYWxzZSB9KTtcbiAgICBjb25zdCByb290ID0gdGFyZ2V0LnR5cFxuICAgICAgPyB7IGFuZDogW2VxdWFsc0ZpbHRlcihUWVBfUFJPUEVSVFksIHRhcmdldC50eXApXSB9XG4gICAgICA6IHsgYW5kOiBbZXF1YWxzRmlsdGVyKFNVQlRZUF9QUk9QRVJUWSwgdGFyZ2V0LnN1YnR5cCldIH07XG4gICAgY29uc3QgZmlsZSA9IGF3YWl0IGFwcC52YXVsdC5jcmVhdGUocGF0aCwgc3RyaW5naWZ5WWFtbCh7IGZpbHRlcnM6IHJvb3QsIHZpZXdzOiB2aWV3cy5tYXAoc2VyaWFsaXplVmlldykgfSkpO1xuICAgIGF3YWl0IG9wZW5CYXNlKGFwcCwgZmlsZSk7XG4gICAgbmV3IE5vdGljZShgQ3JlYXRlZCAke3BhdGh9IHdpdGggJHtwbHVyYWwodmlld3MubGVuZ3RoLCBcInZpZXdcIil9LmApO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIFRoZSBmaWxlIGV4aXN0czogYWRkIHdoYXQgaXMgbWlzc2luZy4gQSB2aWV3IHdpdGggdGhlIHNhbWUgbmFtZSBzdGF5c1xuICAvLyB1bnRvdWNoZWQgLSBpdCBtYXkgYmUgaGFuZC1tYWRlLCBhbmQgb3ZlcndyaXRpbmcgaXQgd291bGQgYmUgYSBzaWxlbnQgbG9zcy5cbiAgY29uc3QgdmlldyA9IGF3YWl0IG9wZW5CYXNlKGFwcCwgZXhpc3RpbmcpO1xuICBpZiAoIXZpZXcpIHtcbiAgICBuZXcgTm90aWNlKGBDb3VsZG4ndCByZWFkICR7cGF0aH0gXHUyMDEzIEJhc2Ugbm90IHVwZGF0ZWQuYCk7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHByZXNlbnQgPSBuZXcgU2V0KHZpZXcucXVlcnkudmlld3MubWFwKChjZmcpID0+IGNmZy5uYW1lKSk7XG4gIGNvbnN0IHdhbnRlZCA9IHRhcmdldFZpZXdzKHBsdWdpbiwgdGFyZ2V0LCBvcHRpb25zLCB7IHNjb3BlZDogdHJ1ZSB9KTtcbiAgY29uc3QgdG9BZGQgPSB3YW50ZWQuZmlsdGVyKChlbnRyeSkgPT4gIXByZXNlbnQuaGFzKGVudHJ5Lm5hbWUpKTtcbiAgY29uc3Qgc2tpcHBlZCA9IHdhbnRlZC5maWx0ZXIoKGVudHJ5KSA9PiBwcmVzZW50LmhhcyhlbnRyeS5uYW1lKSkubWFwKChlbnRyeSkgPT4gZW50cnkubmFtZSk7XG5cbiAgaWYgKHRvQWRkLmxlbmd0aCA+IDApIGF3YWl0IGFwcGVuZFZpZXdzKGFwcCwgdmlldywgdG9BZGQpO1xuXG4gIGNvbnN0IHBhcnRzID0gW107XG4gIHBhcnRzLnB1c2godG9BZGQubGVuZ3RoID4gMCA/IGAke3BhdGh9OiBhZGRlZCAke3BsdXJhbCh0b0FkZC5sZW5ndGgsIFwidmlld1wiKX0uYCA6IGAke3BhdGh9OiBub3RoaW5nIHRvIGFkZC5gKTtcbiAgaWYgKHNraXBwZWQubGVuZ3RoID4gMCkgcGFydHMucHVzaChgQWxyZWFkeSBwcmVzZW50LCBsZWZ0IHVuY2hhbmdlZDogJHtza2lwcGVkLmpvaW4oXCIsIFwiKX0uYCk7XG4gIG5ldyBOb3RpY2UocGFydHMuam9pbihcIiBcIikpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVCYXNlQ29tbWFuZChwbHVnaW4pIHtcbiAgLy8gaW5jbHVkZU1hbnVhbE9mZjogYSBCYXNlIGlzIGVzcGVjaWFsbHkgdXNlZnVsIGZvciBUWVAgZW50cmllcyB0aGF0IGFyZW4ndFxuICAvLyBzZXQgYnkgaGFuZCAoS09OVEFLVCwgTUVESUEsIEVYVEVSTikuIFVucmVnaXN0ZXJlZCB2YWx1ZXMgYXJlIGxlZnQgb3V0IC1cbiAgLy8gdGhleSBoYXZlIG5vIFRZUC1Gcm9udG1hdHRlciBhbmQgc28gbm8gY29sdW1ucy5cbiAgY29uc3QgY2hvaWNlID0gYXdhaXQgcGx1Z2luLnBpY2tUeXBBbmRTdWJ0eXAoeyBpbmNsdWRlTWFudWFsT2ZmOiB0cnVlIH0pO1xuICBpZiAoIWNob2ljZSkgcmV0dXJuO1xuXG4gIC8vIEEgU3VidHlwIHBpY2tlZCBoZXJlIG1lYW5zIHRoZSBzdGFuZGFsb25lIFN1YnR5cCBCYXNlOiBpdCBmaWx0ZXJzIGJ5XG4gIC8vIFNVQlRZUCBvbmx5IGFuZCBtZXJnZXMgdGhlIGNvbHVtbnMgb2YgZXZlcnkgVFlQIHdpdGggdGhhdCBTdWJ0eXAgbmFtZS5cbiAgY29uc3QgdGFyZ2V0ID0gY2hvaWNlLnN1YnR5cCA/IHsgdHlwOiBudWxsLCBzdWJ0eXA6IGNob2ljZS5zdWJ0eXAgfSA6IHsgdHlwOiBjaG9pY2UudHlwLCBzdWJ0eXA6IG51bGwgfTtcbiAgYXdhaXQgY3JlYXRlQmFzZUZvcihwbHVnaW4sIHRhcmdldCk7XG59XG5cbi8vIFRoZSBjb21tYW5kIGFmdGVyIGl0cyBwaWNrZXIsIGFsc28gdGhlIGVudHJ5IHdpdGggYSBmaXhlZCB0YXJnZXQgKGNvbnRleHRcbi8vIG1lbnUgb2YgdGhlIFRZUC1MaXN0KTogY29sdW1uIG9wdGlvbnMsIHRoZW4gY3JlYXRlIG9yIGNvbXBsZXRlIHRoZSBmaWxlLlxuYXN5bmMgZnVuY3Rpb24gY3JlYXRlQmFzZUZvcihwbHVnaW4sIHRhcmdldCkge1xuICBjb25zdCBwYXRoID0gYmFzZVBhdGgocGx1Z2luLCB0YXJnZXQpO1xuICAvLyBPbmx5IGEgZmlsZSBpbiBhIGRpZmZlcmVudCBjYXNlIGV4aXN0cyAoYW4gb2xkIFN1YnR5cCBCYXNlIFwiQnVjaC5iYXNlXCJcbiAgLy8gd2hlbiBjcmVhdGluZyBcIkJVQ0guYmFzZVwiLCBzYXkpOiBjcmVhdGluZyB3b3VsZCBmYWlsIG9uIFdpbmRvd3MsIGFuZFxuICAvLyB3cml0aW5nIGludG8gaXQgd291bGQgZmlsbCBzb21lb25lIGVsc2UncyBCYXNlLiBMZWF2ZSB0aGUgZGVjaXNpb24gdG8gdGhlXG4gIC8vIHVzZXIgLSBjaGVja2VkIGJlZm9yZSB0aGUgZGlhbG9nLCBzbyBubyBvcHRpb25zIGFyZSBjaG9zZW4gaW4gdmFpbi5cbiAgY29uc3QgdmFyaWFudCA9IHBsdWdpbi5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHBhdGgpID8gbnVsbCA6IGNhc2VWYXJpYW50cyhwbHVnaW4uYXBwLCBwYXRoKVswXTtcbiAgaWYgKHZhcmlhbnQpIHtcbiAgICBuZXcgTm90aWNlKGBcIiR7dmFyaWFudC5uYW1lfVwiIGFscmVhZHkgZXhpc3RzIGluIGEgZGlmZmVyZW50IGNhc2UgXHUyMDEzIHJlbmFtZSBvciBkZWxldGUgaXQgZmlyc3QuYCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3Qgb3B0aW9ucyA9IGF3YWl0IGFza0NvbHVtbk9wdGlvbnMocGx1Z2luLCB0YXJnZXQsIChjdXJyZW50KSA9PiBjb2x1bW5JZHMocGx1Z2luLCB0YXJnZXQsIGN1cnJlbnQpKTtcbiAgaWYgKCFvcHRpb25zKSByZXR1cm47XG4gIGF3YWl0IGNyZWF0ZUJhc2UocGx1Z2luLCB0YXJnZXQsIHBhdGgsIG9wdGlvbnMpO1xufVxuXG4vKiAtLS0gQ29tbWFuZDogVXBkYXRlIGNvbHVtbnMgb2YgQmFzZSB2aWV3IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG5cbi8vIFRoZSBtb3N0IHJlY2VudCBsZWFmIG9mIHRoZSBtYWluIGFyZWEsIG5vdCB3b3Jrc3BhY2UuYWN0aXZlTGVhZiAoZGVwcmVjYXRlZCk6XG4vLyB0aGF0IGlzIGFsc28gYSBzaWRlYmFyIGxlYWYsIGUuZy4gdGhlIFRZUC1QYW5lIHdoZW4gaXQgd2FzIGNsaWNrZWQgbGFzdC5cbmZ1bmN0aW9uIGFjdGl2ZUJhc2VWaWV3KHBsdWdpbikge1xuICBjb25zdCBsZWFmID0gcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TW9zdFJlY2VudExlYWYoKTtcbiAgY29uc3QgdmlldyA9IGxlYWY/LnZpZXc7XG4gIGlmICghdmlldyB8fCB0eXBlb2Ygdmlldy5nZXRWaWV3VHlwZSAhPT0gXCJmdW5jdGlvblwiIHx8IHZpZXcuZ2V0Vmlld1R5cGUoKSAhPT0gXCJiYXNlc1wiKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHZpZXcucXVlcnkgPyB2aWV3IDogbnVsbDtcbn1cblxuZnVuY3Rpb24gc2VyaWFsaXplRmlsdGVycyhmaWx0ZXJzKSB7XG4gIHJldHVybiB0eXBlb2YgZmlsdGVycz8uc2VyaWFsaXplID09PSBcImZ1bmN0aW9uXCIgPyBmaWx0ZXJzLnNlcmlhbGl6ZSgpIDogbnVsbDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gdXBkYXRlQWN0aXZlVmlldyhwbHVnaW4sIHZpZXcpIHtcbiAgY29uc3QgcXVlcnkgPSB2aWV3LnF1ZXJ5O1xuICBjb25zdCB2aWV3TmFtZSA9IHZpZXcuY29udHJvbGxlcj8udmlld05hbWU7XG4gIGNvbnN0IGNmZyA9ICh2aWV3TmFtZSA/IHF1ZXJ5LmdldFZpZXdDb25maWcodmlld05hbWUpIDogbnVsbCkgPz8gcXVlcnkudmlld3NbMF07XG4gIGlmICghY2ZnKSB7XG4gICAgbmV3IE5vdGljZShcIk5vIGFjdGl2ZSB2aWV3LlwiKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBsZXQgdGFyZ2V0ID0gcmVhZFRhcmdldChzZXJpYWxpemVGaWx0ZXJzKHF1ZXJ5LmZpbHRlcnMpLCBzZXJpYWxpemVGaWx0ZXJzKGNmZy5maWx0ZXJzKSk7XG4gIC8vIFdyaXR0ZW4gb25seSBvbmNlIGV2ZXJ5IGRpYWxvZyBpcyBjb25maXJtZWQ6IGNhbmNlbGxpbmcgbXVzdCBsZWF2ZSB0aGVcbiAgLy8gdmlldyBleGFjdGx5IGFzIGl0IHdhcywgZmlsdGVyIGluY2x1ZGVkLlxuICBsZXQgcGVuZGluZ0ZpbHRlciA9IG51bGw7XG4gIGlmICghdGFyZ2V0KSB7XG4gICAgLy8gTm8gdW5hbWJpZ3VvdXMgVFlQIGluIHRoZSBmaWx0ZXIgKGhhbmQtd3JpdHRlbiBPUiBncm91cCwgbm8gZmlsdGVyIGF0XG4gICAgLy8gYWxsKTogYXNrLCBhbmQgc3RvcmUgdGhlIGFuc3dlciBhcyBhIGZpbHRlciBzbyB0aGUgbmV4dCBydW4gcmVhZHMgaXQuXG4gICAgY29uc3QgY2hvaWNlID0gYXdhaXQgcGx1Z2luLnBpY2tUeXBBbmRTdWJ0eXAoeyBpbmNsdWRlTWFudWFsT2ZmOiB0cnVlIH0pO1xuICAgIGlmICghY2hvaWNlKSByZXR1cm47XG4gICAgdGFyZ2V0ID0geyB0eXA6IGNob2ljZS50eXAsIHN1YnR5cDogY2hvaWNlLnN1YnR5cCB9O1xuICAgIGNvbnN0IGFuZCA9IFtlcXVhbHNGaWx0ZXIoVFlQX1BST1BFUlRZLCBjaG9pY2UudHlwKV07XG4gICAgaWYgKGNob2ljZS5zdWJ0eXApIGFuZC5wdXNoKGVxdWFsc0ZpbHRlcihTVUJUWVBfUFJPUEVSVFksIGNob2ljZS5zdWJ0eXApKTtcbiAgICBwZW5kaW5nRmlsdGVyID0geyBhbmQgfTtcbiAgfVxuXG4gIC8vIFByZXNldCBmcm9tIHRoZSB2aWV3J3MgY29sdW1ucywgc28gdGhlIG9wdGlvbnMgaXQgd2FzIGJ1aWx0IHdpdGggYXJlbid0XG4gIC8vIG9mZmVyZWQgZm9yIHJlbW92YWwuXG4gIGNvbnN0IGluaXRpYWwgPSBvcHRpb25zRnJvbUNvbHVtbnMocGx1Z2luLCB0YXJnZXQsIEFycmF5LmlzQXJyYXkoY2ZnLm9yZGVyKSA/IGNmZy5vcmRlciA6IFtdKTtcbiAgY29uc3Qgb3B0aW9ucyA9IGF3YWl0IGFza0NvbHVtbk9wdGlvbnMocGx1Z2luLCB0YXJnZXQsIChjdXJyZW50KSA9PiBjb2x1bW5JZHMocGx1Z2luLCB0YXJnZXQsIGN1cnJlbnQpLCBpbml0aWFsKTtcbiAgaWYgKCFvcHRpb25zKSByZXR1cm47XG5cbiAgY29uc3QgZGVzaXJlZCA9IGNvbHVtbklkcyhwbHVnaW4sIHRhcmdldCwgb3B0aW9ucyk7XG4gIGNvbnN0IGRlc2lyZWRMb3dlciA9IG5ldyBTZXQoZGVzaXJlZC5tYXAoKGlkKSA9PiBpZC50b0xvd2VyQ2FzZSgpKSk7XG4gIC8vIEEgdmlldyB3aXRob3V0IGl0cyBvd24gb3JkZXIgc2hvd3MgZXZlcnkgcHJvcGVydHkgLSBub3RoaW5nIHRvIHJlbW92ZSxcbiAgLy8gdGhlIGdlbmVyYXRlZCBsaXN0IHNpbXBseSB0YWtlcyBpdHMgcGxhY2UuXG4gIGNvbnN0IGN1cnJlbnQgPSBBcnJheS5pc0FycmF5KGNmZy5vcmRlcikgPyBbLi4uY2ZnLm9yZGVyXSA6IFtdO1xuICBjb25zdCBleHRyYXMgPSBjdXJyZW50LmZpbHRlcigoaWQpID0+ICFkZXNpcmVkTG93ZXIuaGFzKGlkLnRvTG93ZXJDYXNlKCkpKTtcblxuICBsZXQga2VwdCA9IFtdO1xuICBpZiAoZXh0cmFzLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCByZW1vdmFscyA9IGF3YWl0IGFza1JlbW92YWxzKHBsdWdpbiwgZXh0cmFzLCBjZmcubmFtZSk7XG4gICAgaWYgKCFyZW1vdmFscykgcmV0dXJuO1xuICAgIGtlcHQgPSBleHRyYXMuZmlsdGVyKChpZCkgPT4gIXJlbW92YWxzLmhhcyhpZCkpO1xuICB9XG5cbiAgLy8gS2VwdCBjb2x1bW5zIHN0YXkgdXAgZnJvbnQsIHJpZ2h0IGFmdGVyIGZpbGUubmFtZTogaGFuZC1hZGRlZCBvbmVzXG4gIC8vIChmb3JtdWxhIGNvbHVtbnMsIHNheSkgc2hvdWxkbid0IHNsaWRlIHRvIHRoZSBlbmQuXG4gIGNvbnN0IG5ld09yZGVyID0gW1xuICAgIEZJTEVfTkFNRV9JRCxcbiAgICAuLi5rZXB0LmZpbHRlcigoaWQpID0+ICFzYW1lSWQoaWQsIEZJTEVfTkFNRV9JRCkpLFxuICAgIC4uLmRlc2lyZWQuZmlsdGVyKChpZCkgPT4gIXNhbWVJZChpZCwgRklMRV9OQU1FX0lEKSksXG4gIF07XG5cbiAgLy8gRmlsdGVyIGJlZm9yZSBvcmRlciwgYXMgYmVmb3JlOiBib3RoIGNoYW5nZSB0aGUgc2FtZSBwYXJzZWQgcXVlcnksIGVhY2hcbiAgLy8gY2FsbCBzYXZlcyBpdC5cbiAgaWYgKHBlbmRpbmdGaWx0ZXIpIHF1ZXJ5LnNldFZpZXdGaWx0ZXJzKGNmZy5uYW1lLCBwZW5kaW5nRmlsdGVyKTtcbiAgY29uc3QgZmlsdGVyTm90ZSA9IHBlbmRpbmdGaWx0ZXIgPyBcImZpbHRlciBzZXQsIFwiIDogXCJcIjtcblxuICBpZiAobmV3T3JkZXIubGVuZ3RoID09PSBjdXJyZW50Lmxlbmd0aCAmJiBuZXdPcmRlci5ldmVyeSgoaWQsIGluZGV4KSA9PiBpZCA9PT0gY3VycmVudFtpbmRleF0pKSB7XG4gICAgbmV3IE5vdGljZShgVmlldyBcIiR7Y2ZnLm5hbWV9XCI6ICR7ZmlsdGVyTm90ZX1jb2x1bW5zIGFyZSBhbHJlYWR5IHVwIHRvIGRhdGUuYCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgYWRkZWQgPSBkZXNpcmVkLmZpbHRlcigoaWQpID0+ICFjdXJyZW50LnNvbWUoKGV4aXN0aW5nKSA9PiBzYW1lSWQoZXhpc3RpbmcsIGlkKSkpLmxlbmd0aDtcbiAgY29uc3QgcmVtb3ZlZCA9IGV4dHJhcy5sZW5ndGggLSBrZXB0Lmxlbmd0aDtcbiAgY2ZnLnNldE9yZGVyKG5ld09yZGVyKTtcbiAgbmV3IE5vdGljZShgVmlldyBcIiR7Y2ZnLm5hbWV9XCI6ICR7ZmlsdGVyTm90ZX1hZGRlZCAke3BsdXJhbChhZGRlZCwgXCJjb2x1bW5cIil9LCByZW1vdmVkICR7cmVtb3ZlZH0uYCk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBpc0Jhc2VzRW5hYmxlZCxcbiAgY3JlYXRlQmFzZUNvbW1hbmQsXG4gIGNyZWF0ZUJhc2VGb3IsXG4gIGFjdGl2ZUJhc2VWaWV3LFxuICB1cGRhdGVBY3RpdmVWaWV3LFxuICAvLyBFeHBvc2VkIGZvciB0ZXN0aW5nIHNpbmdsZSBidWlsZGluZyBibG9ja3NcbiAgYmFzZVBhdGgsXG4gIGNvbHVtbklkcyxcbiAgb3B0aW9uc0Zyb21Db2x1bW5zLFxuICByZWFkVGFyZ2V0LFxuICB0YXJnZXRWaWV3cyxcbn07XG4iLCAiY29uc3QgeyBOb3RpY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgcnVuRnJvbnRtYXR0ZXJTb3J0LCBzb3J0U2luZ2xlRmlsZUZyb250bWF0dGVyIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1zb3J0XCIpO1xuY29uc3QgeyBpc0Jhc2VzRW5hYmxlZCwgY3JlYXRlQmFzZUNvbW1hbmQsIGFjdGl2ZUJhc2VWaWV3LCB1cGRhdGVBY3RpdmVWaWV3IH0gPSByZXF1aXJlKFwiLi9iYXNlc1wiKTtcblxuLy8gT2JzaWRpYW4gbmVpdGhlciBhd2FpdHMgYSBjb21tYW5kIGNhbGxiYWNrIChvciBhIG1lbnUgaXRlbSdzIG9uQ2xpY2spIG5vclxuLy8gY2F0Y2hlcyBpdHMgZXJyb3JzLCBzbyBhbiBleGNlcHRpb24gd291bGQgdmFuaXNoIGludG8gdGhlIGNvbnNvbGUuIFRoZXNlXG4vLyBhY3Rpb25zIGFsd2F5cyBlbmQgaW4gYSBub3RpY2UgaW5zdGVhZC4gQWxzbyB1c2VkIGJ5IHRoZSBUWVAtUGFuZSdzIGNvbnRleHRcbi8vIG1lbnUuXG5jb25zdCBydW5PclJlcG9ydEVycm9yID0gKGxhYmVsLCBmbikgPT4gYXN5bmMgKCkgPT4ge1xuICB0cnkge1xuICAgIGF3YWl0IGZuKCk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcihgWyR7bGFiZWx9XWAsIGVycm9yKTtcbiAgICBuZXcgTm90aWNlKGAke2xhYmVsfSBmYWlsZWQ6ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgfVxufTtcblxuZnVuY3Rpb24gcmVnaXN0ZXJDb21tYW5kcyhwbHVnaW4pIHtcblxuICBwbHVnaW4uYWRkQ29tbWFuZCh7XG4gICAgaWQ6IFwic29ydC1mcm9udG1hdHRlci1hbGxcIixcbiAgICBuYW1lOiBcIlNvcnQgZnJvbnRtYXR0ZXIgaW4gYWxsIG5vdGVzXCIsXG4gICAgLy8gQXNrcyBmaXJzdCB3aGVuIHRoZSBydW4gaXMgbGFyZ2UsIHNlZSBydW5Gcm9udG1hdHRlclNvcnQuXG4gICAgY2FsbGJhY2s6IHJ1bk9yUmVwb3J0RXJyb3IoXCJGcm9udG1hdHRlciBzb3J0aW5nXCIsICgpID0+IHJ1bkZyb250bWF0dGVyU29ydChwbHVnaW4sIG51bGwpKSxcbiAgfSk7XG5cbiAgcGx1Z2luLmFkZENvbW1hbmQoe1xuICAgIGlkOiBcInNvcnQtZnJvbnRtYXR0ZXItdHlwXCIsXG4gICAgbmFtZTogXCJTb3J0IGZyb250bWF0dGVyIGZvciBvbmUgVFlQXCIsXG4gICAgY2FsbGJhY2s6IHJ1bk9yUmVwb3J0RXJyb3IoXCJGcm9udG1hdHRlciBzb3J0aW5nXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIFNvcnRpbmcgbWFrZXMgc2Vuc2UgZm9yIGFueSBUWVAsIG1hbnVhbGx5IGNyZWF0YWJsZSBvciBub3QsIHJlZ2lzdGVyZWRcbiAgICAgIC8vIG9yIG5vdC5cbiAgICAgIGNvbnN0IHR5cCA9IGF3YWl0IHBsdWdpbi5waWNrVHlwKHsgaW5jbHVkZU1hbnVhbE9mZjogdHJ1ZSwgaW5jbHVkZVVucmVnaXN0ZXJlZDogdHJ1ZSB9KTtcbiAgICAgIGlmICghdHlwKSByZXR1cm47XG4gICAgICBhd2FpdCBydW5Gcm9udG1hdHRlclNvcnQocGx1Z2luLCB0eXApO1xuICAgIH0pLFxuICB9KTtcblxuICBwbHVnaW4uYWRkQ29tbWFuZCh7XG4gICAgaWQ6IFwic29ydC1mcm9udG1hdHRlci1hY3RpdmUtbm90ZVwiLFxuICAgIG5hbWU6IFwiU29ydCBmcm9udG1hdHRlciBvZiBhY3RpdmUgbm90ZVwiLFxuICAgIGNoZWNrQ2FsbGJhY2s6IChjaGVja2luZykgPT4ge1xuICAgICAgY29uc3QgZmlsZSA9IHBsdWdpbi5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICAgIGlmICghZmlsZSB8fCBmaWxlLmV4dGVuc2lvbiAhPT0gXCJtZFwiKSByZXR1cm4gZmFsc2U7XG4gICAgICBpZiAoY2hlY2tpbmcpIHJldHVybiB0cnVlO1xuXG4gICAgICBydW5PclJlcG9ydEVycm9yKFwiRnJvbnRtYXR0ZXIgc29ydGluZ1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnN0IGNoYW5nZWQgPSBhd2FpdCBzb3J0U2luZ2xlRmlsZUZyb250bWF0dGVyKHBsdWdpbi5hcHAsIHBsdWdpbiwgZmlsZSk7XG4gICAgICAgIG5ldyBOb3RpY2UoY2hhbmdlZCA/IGBTb3J0ZWQgZnJvbnRtYXR0ZXIgb2YgXCIke2ZpbGUuYmFzZW5hbWV9XCIuYCA6IGBGcm9udG1hdHRlciBvZiBcIiR7ZmlsZS5iYXNlbmFtZX1cIiB3YXMgYWxyZWFkeSBzb3J0ZWQuYCk7XG4gICAgICB9KSgpO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSxcbiAgfSk7XG5cbiAgLy8gQ3JlYXRlcyBhIC5iYXNlIGZvciB0aGUgY2hvc2VuIFRZUCBvciBTdWJ0eXAgaW4gdGhlIHZhdWx0IHJvb3QsIHNlZSBiYXNlcy5qcy5cbiAgLy8gSGlkZGVuIHdoaWxlIHRoZSBCYXNlcyBjb3JlIHBsdWdpbiBpcyBvZmY6IHRoZSBmaWxlIGNvdWxkbid0IGJlIG9wZW5lZC5cbiAgcGx1Z2luLmFkZENvbW1hbmQoe1xuICAgIGlkOiBcImNyZWF0ZS1iYXNlLWZvci10eXBcIixcbiAgICBuYW1lOiBcIkNyZWF0ZSBCYXNlIGZvciBUWVBcIixcbiAgICBjaGVja0NhbGxiYWNrOiAoY2hlY2tpbmcpID0+IHtcbiAgICAgIGlmICghaXNCYXNlc0VuYWJsZWQocGx1Z2luLmFwcCkpIHJldHVybiBmYWxzZTtcbiAgICAgIGlmIChjaGVja2luZykgcmV0dXJuIHRydWU7XG5cbiAgICAgIHJ1bk9yUmVwb3J0RXJyb3IoXCJDcmVhdGUgQmFzZVwiLCAoKSA9PiBjcmVhdGVCYXNlQ29tbWFuZChwbHVnaW4pKSgpO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSxcbiAgfSk7XG5cbiAgLy8gQnJpbmdzIHRoZSBjb2x1bW5zIG9mIHRoZSB2aXNpYmxlIEJhc2UgdmlldyBpbiBsaW5lIHdpdGggaXRzIFRZUC4gV2l0aG91dFxuICAvLyBhbiBvcGVuIEJhc2UgdGhlIGNvbW1hbmQgaGFzIG5vIHRhcmdldCBhbmQgaXMgaGlkZGVuLlxuICBwbHVnaW4uYWRkQ29tbWFuZCh7XG4gICAgaWQ6IFwidXBkYXRlLWJhc2Utdmlldy1jb2x1bW5zXCIsXG4gICAgbmFtZTogXCJVcGRhdGUgY29sdW1ucyBvZiBCYXNlIHZpZXdcIixcbiAgICBjaGVja0NhbGxiYWNrOiAoY2hlY2tpbmcpID0+IHtcbiAgICAgIGNvbnN0IHZpZXcgPSBhY3RpdmVCYXNlVmlldyhwbHVnaW4pO1xuICAgICAgaWYgKCF2aWV3KSByZXR1cm4gZmFsc2U7XG4gICAgICBpZiAoY2hlY2tpbmcpIHJldHVybiB0cnVlO1xuXG4gICAgICBydW5PclJlcG9ydEVycm9yKFwiVXBkYXRlIEJhc2VcIiwgKCkgPT4gdXBkYXRlQWN0aXZlVmlldyhwbHVnaW4sIHZpZXcpKSgpO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSxcbiAgfSk7XG5cbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyQ29tbWFuZHMsIHJ1bk9yUmVwb3J0RXJyb3IgfTtcbiIsICJjb25zdCB7IE5vdGljZSB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuXG4vLyBVbmRvIGZvciB0aGUgYWN0aW9ucyB0aGF0IHJ1biB3aXRob3V0IGFza2luZyAoZGVsZXRlIGEgU3VidHlwLCByZW1vdmUgYVxuLy8gc2hvcnRjdXQsIHRvZ2dsZSBmbG9hdGluZywgcmVzZXQgYSBjb2xvcik6IGEgbm90aWNlIHdpdGggYW4gXCJVbmRvXCIgYnV0dG9uXG4vLyByaWdodCBhZnRlciB0aGUgYWN0aW9uLiBPbmx5IHBsdWdpbiBzZXR0aW5ncywgbmV2ZXIgbm90ZXMsIGFuZCBvbmx5IHRoZVxuLy8gTEFTVCBhY3Rpb24gLSBhIG5ldyBvZmZlciByZXBsYWNlcyB0aGUgcHJldmlvdXMgb25lLCBzbyB0aGVyZSBpcyBubyBoaXN0b3J5XG4vLyBhbmQgbm8gY29tbWFuZC5cbi8vXG4vLyBQYXR0ZXJuIGF0IHRoZSBjYWxsIHNpdGU6IHNuYXBzaG90ID0gc25hcHNob3RTZXR0aW5ncyhwbHVnaW4pIGJlZm9yZSB0aGVcbi8vIGNoYW5nZSwgdGhlbiB0aGUgYWN0aW9uIGFzIHVzdWFsIChpbmNsdWRpbmcgc2F2ZVNldHRpbmdzKCkpLCB0aGVuXG4vLyBvZmZlclVuZG8oKS4gb2ZmZXJVbmRvKCkgbXVzdCBjb21lIGFmdGVyIHNhdmVTZXR0aW5ncygpIGhhcyBiZWVuIENBTExFRCAobm90XG4vLyBuZWNlc3NhcmlseSBhd2FpdGVkKSwgc2luY2UgdGhhdCBpcyB3aGF0IGJ1bXBzIHNldHRpbmdzUmV2aXNpb24uXG5cbmNvbnN0IFVORE9fTk9USUNFX0RVUkFUSU9OID0gODAwMDtcblxuLy8geyB0b2tlbiwgcmV2aXNpb24sIHNuYXBzaG90IH0gb2YgdGhlIGxhc3QgYWN0aW9uLCBvciBudWxsLlxubGV0IGN1cnJlbnQgPSBudWxsO1xuXG4vLyBUaGUgc2V0dGluZ3MgYXJlIHBsYWluIEpTT04sIHNvIHN0cnVjdHVyZWRDbG9uZSBpcyBhIGNvbXBsZXRlIGNvcHkuXG5mdW5jdGlvbiBzbmFwc2hvdFNldHRpbmdzKHBsdWdpbikge1xuICByZXR1cm4gc3RydWN0dXJlZENsb25lKHBsdWdpbi5zZXR0aW5ncyk7XG59XG5cbmZ1bmN0aW9uIG9mZmVyVW5kbyhwbHVnaW4sIG1lc3NhZ2UsIHNuYXBzaG90KSB7XG4gIGNvbnN0IHRva2VuID0ge307XG4gIC8vIHNldHRpbmdzUmV2aXNpb24gY291bnRzIGV2ZXJ5IHNhdmUgYW5kIGV2ZXJ5IGV4dGVybmFsIHJlbG9hZCAoc2VlXG4gIC8vIHNhdmVTZXR0aW5ncyBpbiBtYWluLmpzKS4gSWYgaXQgbW92ZWQgb24gYnkgdGhlIHRpbWUgVW5kbyBpcyBjbGlja2VkLFxuICAvLyBzb21ldGhpbmcgZWxzZSBjaGFuZ2VkIHRoZSBzZXR0aW5ncyBpbiBiZXR3ZWVuIC0gcmVzdG9yaW5nIHRoZSBzbmFwc2hvdFxuICAvLyB3b3VsZCBzaWxlbnRseSByZXZlcnQgdGhhdCB0b28uXG4gIGN1cnJlbnQgPSB7IHRva2VuLCByZXZpc2lvbjogcGx1Z2luLnNldHRpbmdzUmV2aXNpb24gPz8gMCwgc25hcHNob3QgfTtcbiAgY29uc3QgZnJhZ21lbnQgPSBjcmVhdGVGcmFnbWVudCgoZikgPT4ge1xuICAgIGYuYXBwZW5kVGV4dChtZXNzYWdlKTtcbiAgICAvLyBPYnNpZGlhbiBoaWRlcyB0aGUgbm90aWNlIG9uIGFueSBjbGljayBpbnNpZGUgaXQsIHRoZSBidXR0b24gaW5jbHVkZWQuXG4gICAgY29uc3QgYnV0dG9uID0gZi5jcmVhdGVFbChcImJ1dHRvblwiLCB7IGNsczogXCJ0eXAtdW5kby1idXR0b25cIiwgdGV4dDogXCJVbmRvXCIgfSk7XG4gICAgYnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB1bmRvKHBsdWdpbiwgdG9rZW4pKTtcbiAgfSk7XG4gIG5ldyBOb3RpY2UoZnJhZ21lbnQsIFVORE9fTk9USUNFX0RVUkFUSU9OKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gdW5kbyhwbHVnaW4sIHRva2VuKSB7XG4gIGlmIChjdXJyZW50Py50b2tlbiAhPT0gdG9rZW4gfHwgKHBsdWdpbi5zZXR0aW5nc1JldmlzaW9uID8/IDApICE9PSBjdXJyZW50LnJldmlzaW9uKSB7XG4gICAgbmV3IE5vdGljZShcIkNhbid0IHVuZG8gXHUyMDEzIHRoZSBzZXR0aW5ncyBoYXZlIGNoYW5nZWQgc2luY2UuXCIpO1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCB7IHNuYXBzaG90IH0gPSBjdXJyZW50O1xuICBjdXJyZW50ID0gbnVsbDtcbiAgLy8gSW4gcGxhY2UsIHNvIGV2ZXJ5IHJlZmVyZW5jZSB0byBwbHVnaW4uc2V0dGluZ3Mgc3RheXMgdmFsaWQuIFRoZSBzbmFwc2hvdFxuICAvLyBpcyB1c2VkIG9ubHkgb25jZSwgbm8gc2Vjb25kIGNvcHkgbmVlZGVkLlxuICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhwbHVnaW4uc2V0dGluZ3MpKSBkZWxldGUgcGx1Z2luLnNldHRpbmdzW2tleV07XG4gIE9iamVjdC5hc3NpZ24ocGx1Z2luLnNldHRpbmdzLCBzbmFwc2hvdCk7XG4gIGF3YWl0IHBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgLy8gVGhlIGZ1bGwgcmVmcmVzaCBvbiBwdXJwb3NlOiBpdCByZS1yZW5kZXJzIHRoZSBUWVAtUGFuZSwgd2hvc2UgZnJvbnRtYXR0ZXJcbiAgLy8gZWRpdG9ycyBvbmx5IHJlYWQgdGhlIHNldHRpbmdzIHdoZW4gbW91bnRlZC5cbiAgcGx1Z2luLnJlZnJlc2hUeXBDb2xvcnM/LigpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgc25hcHNob3RTZXR0aW5ncywgb2ZmZXJVbmRvIH07XG4iLCAiY29uc3QgeyBtb21lbnQgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcblxuLy8gQSBzaG9ydGN1dCBpcyBhIHZhbHVlIGNvbXB1dGVkIG9ubHkgd2hlbiBhIG5vdGUgaXMgY3JlYXRlZC4gSXQgaXMgc3RvcmVkXG4vLyBORVhUIFRPIHRoZSBwcm9wZXJ0eSdzIGZyb250bWF0dGVyIHZhbHVlLCBub3QgaW4gaXQ6IGluXG4vLyBzZXR0aW5ncy50eXBTaG9ydGN1dHNbVFlQXVtrZXldIGZvciB0aGUgVFlQLUZyb250bWF0dGVyLCBvciBpbiB0aGUgc2hvcnRjdXRzXG4vLyBvYmplY3Qgb2YgYSBTdWJ0eXAgYmxvY2sgKHNlZSBzdWJ0eXBzLmpzKTpcbi8vICAgeyBuYW1lOiBcInRvZGF5XCIgfSAgICAgICAgICAgIC0gZml4ZWQgdG9rZW4sIHJlc29sdmVkIGJ5IHRoZSBwbHVnaW5cbi8vICAgeyBuYW1lOiBcInRwLjxzY3JpcHQ+XCIgfSAgICAgIC0gVGVtcGxhdGVyIHNjcmlwdCwgb25seSBUWVAuanMgY2FuIHJlc29sdmUgaXRcbi8vICAgeyBuYW1lOiBcInRwLjxzY3JpcHQ+XCIsIGFyZ3M6IHsgZm9sZGVyOiBcIkxpdGVyYXR1clwiLCB5ZWFyOiAyMDI0IH0gfVxuLy8gICAgIC0gdGhlIHNhbWUgd2l0aCBhcmd1bWVudHMuIFRoZSBzY3JpcHQgZGVjbGFyZXMgdGhlIHBhcmFtZXRlciBuYW1lcyBpblxuLy8gICAgICAgaXRzIEB0eXAtc2hvcnRjdXQgbWFya2VyIChzZWUgc2hvcnRjdXQtc2NyaXB0cy5qcyk7IFRZUC5qcyBwYXNzZXMgdGhlXG4vLyAgICAgICBvYmplY3Qgb24gYXMgY3R4LmFyZ3MuIEZpeGVkIHRva2VucyBuZXZlciBoYXZlIGFyZ3VtZW50cy5cbi8vXG4vLyBXaHkgbmV4dCB0byB0aGUgdmFsdWU6IE9ic2lkaWFuIHBpY2tzIGEgcm93J3MgaW5wdXQgZnJvbSB0aGUgcHJvcGVydHkgdHlwZVxuLy8gaW4gdHlwZXMuanNvbi4gQSBkYXRlL251bWJlci9jaGVja2JveCBwcm9wZXJ0eSBjYW4ndCB0YWtlIGEgdG9rZW4gbGlrZVxuLy8gXCJ7e3RvZGF5fX1cIiBhdCBhbGwsIGEgc3RvcmVkIG9uZSB0cmlnZ2VycyB0aGUgXCJUeXBlIG1pc21hdGNoXCIgd2FybmluZywgYW5kXG4vLyB0aGUgbGlzdCB3aWRnZXQgc2lsZW50bHkgdHVybnMgYSBzdHJpbmcgaW50byBhbiBhcnJheSBvbiBmaXJzdCBlZGl0LiBLZXB0XG4vLyBhcGFydCwgdGhlIHZhbHVlIHN0YXlzIHR5cGUtY2xlYW4gYW5kIHRoZSBuYXRpdmUgd2lkZ2V0IHVudG91Y2hlZC5cbi8vXG4vLyBUaGUgZnJvbnRtYXR0ZXIgdmFsdWUgc3RheXMgYW5kIHNlcnZlcyBhcyBGQUxMQkFDSzogaWYgdGhlIHNjcmlwdCBpcyBtaXNzaW5nXG4vLyBvciB0aHJvd3MsIFRZUC5qcyB3cml0ZXMgaXQgaW5zdGVhZCBvZiBhbiBlbXB0eSB2YWx1ZS4gQSBzY3JpcHQgdGhhdFxuLy8gZGVsaWJlcmF0ZWx5IHJldHVybnMgbnVsbC9cIlwiIChlLmcuIEVTQyBpbiBhIHBpY2tlcikgaXMgbm90IGEgZmFpbHVyZSBhbmRcbi8vIGxlYXZlcyB0aGUgcHJvcGVydHkgZW1wdHkuXG5cbi8vIFRva2VucyB0aGUgcGx1Z2luIHJlc29sdmVzIGl0c2VsZiwgd2l0aG91dCBUZW1wbGF0ZXIgLSBzbyBnZXRUeXBEZWZhdWx0cygpXG4vLyBmaWxscyB0aGVtIGluLiBSZXNvbHZlZCBvbiBlYWNoIGNhbGwsIG5vdCB3aGVuIHNldCwgc28gXCJ0b2RheVwiIGlzIHRoZSBkYXlcbi8vIHRoZSBub3RlIGlzIGNyZWF0ZWQuXG5jb25zdCBGSVhFRF9TSE9SVENVVFMgPSBbXG4gIHtcbiAgICBuYW1lOiBcInRvZGF5XCIsXG4gICAgZGVzY3JpcHRpb246IFwiVG9kYXkncyBkYXRlIChZWVlZLU1NLUREKVwiLFxuICAgIHJlc29sdmU6ICgpID0+IG1vbWVudCgpLmZvcm1hdChcIllZWVktTU0tRERcIiksXG4gIH0sXG4gIHtcbiAgICBuYW1lOiBcIm5vd1wiLFxuICAgIGRlc2NyaXB0aW9uOiBcIkN1cnJlbnQgZGF0ZSBhbmQgdGltZSAoWVlZWS1NTS1ERCBISDptbSlcIixcbiAgICByZXNvbHZlOiAoKSA9PiBtb21lbnQoKS5mb3JtYXQoXCJZWVlZLU1NLUREIEhIOm1tXCIpLFxuICB9LFxuICB7XG4gICAgLy8gVGhlIGZpbGUncyBjcmVhdGlvbiBkYXRlIChmaWxlLnN0YXQuY3RpbWUpLCBub3QgdGhlIGNhbGwgdGltZTsgZmFsbHNcbiAgICAvLyBiYWNrIHRvIG5vdyB3aXRob3V0IGEgZmlsZS5cbiAgICBuYW1lOiBcImNyZWF0ZWRcIixcbiAgICBkZXNjcmlwdGlvbjogXCJUaGUgZmlsZSdzIGNyZWF0aW9uIGRhdGUgKFlZWVktTU0tREQpXCIsXG4gICAgcmVzb2x2ZTogKGZpbGUpID0+IG1vbWVudChmaWxlPy5zdGF0Py5jdGltZSA/PyBEYXRlLm5vdygpKS5mb3JtYXQoXCJZWVlZLU1NLUREXCIpLFxuICB9LFxuXTtcblxuLy8gU2NyaXB0IHNob3J0Y3V0cyBjYXJyeSB0aGlzIHByZWZpeCBzbyBhIHNjcmlwdCBjYW4gbmV2ZXIgY29sbGlkZSB3aXRoIGFcbi8vIGZpeGVkIHRva2VuLCBub3QgZXZlbiBhIFwidG9kYXkuanNcIiBpbiB0aGUgc2NyaXB0IGZvbGRlci5cbmNvbnN0IFNDUklQVF9QUkVGSVggPSBcInRwLlwiO1xuXG5mdW5jdGlvbiBmaW5kRml4ZWRTaG9ydGN1dChuYW1lKSB7XG4gIHJldHVybiBGSVhFRF9TSE9SVENVVFMuZmluZCgoc2hvcnRjdXQpID0+IHNob3J0Y3V0Lm5hbWUgPT09IG5hbWUpID8/IG51bGw7XG59XG5cbi8vIFNjcmlwdCBuYW1lIG9mIGEgXCJ0cC48c2NyaXB0PlwiIHNob3J0Y3V0LCBvdGhlcndpc2UgbnVsbC4gVGhlIHNjcmlwdCBuYW1lIGlzXG4vLyB0aGUgZmlsZSBuYW1lIHdpdGhvdXQgXCIuanNcIiwgc28gdW1sYXV0cywgXCItXCIgYW5kIHNwYWNlcyBhcmUgYWxsb3dlZC5cbmZ1bmN0aW9uIHNjcmlwdE5hbWVPZihuYW1lKSB7XG4gIHJldHVybiB0eXBlb2YgbmFtZSA9PT0gXCJzdHJpbmdcIiAmJiBuYW1lLnN0YXJ0c1dpdGgoU0NSSVBUX1BSRUZJWCkgPyBuYW1lLnNsaWNlKFNDUklQVF9QUkVGSVgubGVuZ3RoKSA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIGlzU2NyaXB0U2hvcnRjdXQocmVjb3JkKSB7XG4gIHJldHVybiBzY3JpcHROYW1lT2YocmVjb3JkPy5uYW1lKSAhPT0gbnVsbDtcbn1cblxuLy8gRGlzcGxheSBmb3JtIGluIHRoZSBwcm9wZXJ0eSByb3cgKGNoaXApIGFuZCB0aGUgcGlja2VyOiB0aGUgYmFyZSBuYW1lIHBsdXNcbi8vIGl0cyBhcmd1bWVudHMuIFRoZSBjaGlwIGl0c2VsZiBtYXJrcyBpdCBhcyBhIHNob3J0Y3V0LCBzbyBubyBicmFjZXMuXG5mdW5jdGlvbiBzaG9ydGN1dExhYmVsKHJlY29yZCkge1xuICBpZiAoIXJlY29yZD8ubmFtZSkgcmV0dXJuIFwiXCI7XG4gIGNvbnN0IHZhbHVlcyA9IE9iamVjdC52YWx1ZXMocmVjb3JkLmFyZ3MgPz8ge30pLmZpbHRlcigodmFsdWUpID0+IHZhbHVlICE9PSB1bmRlZmluZWQpO1xuICByZXR1cm4gdmFsdWVzLmxlbmd0aCA+IDAgPyBgJHtyZWNvcmQubmFtZX06ICR7dmFsdWVzLmpvaW4oXCIsIFwiKX1gIDogcmVjb3JkLm5hbWU7XG59XG5cbi8vIENvbnZlcnRzIGEgdHlwZWQgYXJndW1lbnQgdG8gdGhlIHR5cGUgaXQgb2J2aW91c2x5IG1lYW5zLCBzbyBhIHNjcmlwdCBnZXRzXG4vLyA1IGFzIGEgbnVtYmVyIGFuZCB0cnVlIGFzIGEgYm9vbGVhbiAobWF0dGVycyB3aGVuIHRoZSB2YWx1ZSBsYW5kcyBpbiBhXG4vLyBudW1iZXIgcHJvcGVydHkpLiBEZWxpYmVyYXRlbHkgdGhlc2UgZmV3IGNhc2VzIGluc3RlYWQgb2YgSlNPTi5wYXJzZSwgd2hpY2hcbi8vIHdvdWxkIGZhaWwgb24gXCJMaXRlcmF0dXJcIi4gQW4gZW1wdHkgZmllbGQgbWVhbnMgXCJub3Qgc2V0XCIgKHVuZGVmaW5lZCkgYW5kXG4vLyBkcm9wcyBvdXQgb2YgdGhlIGFyZ3VtZW50IG9iamVjdCwgc28gXCJhcmdzLnllYXIgPz8gZmFsbGJhY2tcIiB3b3Jrcy5cbmZ1bmN0aW9uIHBhcnNlQXJnVmFsdWUocmF3KSB7XG4gIGNvbnN0IHRleHQgPSBTdHJpbmcocmF3ID8/IFwiXCIpLnRyaW0oKTtcbiAgaWYgKHRleHQgPT09IFwiXCIpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmICh0ZXh0ID09PSBcInRydWVcIikgcmV0dXJuIHRydWU7XG4gIGlmICh0ZXh0ID09PSBcImZhbHNlXCIpIHJldHVybiBmYWxzZTtcbiAgaWYgKHRleHQgPT09IFwibnVsbFwiKSByZXR1cm4gbnVsbDtcbiAgaWYgKC9eLT9cXGQrKD86XFwuXFxkKyk/JC8udGVzdCh0ZXh0KSkgcmV0dXJuIE51bWJlcih0ZXh0KTtcbiAgcmV0dXJuIHRleHQ7XG59XG5cbi8vIFBhcmFtZXRlciBuYW1lcyB3aG9zZSB2YWx1ZXMgdGhlIHBsdWdpbiBvciBUWVAuanMgYWxyZWFkeSBrbm93OyB0aGV5IGFyZVxuLy8gZmlsbGVkIGluIGF0IGNhbGwgdGltZSwgbm90IGFza2VkIGZvcjpcbi8vICAgbmV3RmlsZSAgdGhlIG5ld2x5IGNyZWF0ZWQgbm90ZVxuLy8gICBjdHggICAgICB0aGUgY29udGV4dCB7IHR5cCwgc3VidHlwLCBrZXksIHZhbHVlcywgYWZ0ZXIsIGFyZ3MgfVxuLy8gICBrZXkgICAgICB0aGUgcHJvcGVydHkgdGhlIHNob3J0Y3V0IHNpdHMgb24sIHNvIGEgc2NyaXB0IGxpa2UgcmVsYXRpb24uanNcbi8vICAgICAgICAgICAgZ2V0cyB0aGUgcmlnaHQgb25lIHdoZXJldmVyIHRoZSBzaG9ydGN1dCBpcyB1c2VkXG4vLyBcInRwXCIgYWx3YXlzIGNvbWVzIGZpcnN0IGFuZCBuZWVkbid0IGJlIGRlY2xhcmVkOyBpZiBpdCBpcywgaXQgaXMgc2tpcHBlZC5cbmNvbnN0IFJFU0VSVkVEX1BBUkFNUyA9IFtcIm5ld0ZpbGVcIiwgXCJjdHhcIiwgXCJrZXlcIl07XG5cbi8vIFBhcmFtZXRlcnMgdGhhdCBnZXQgYW4gaW5wdXQgZmllbGQ6IGV2ZXJ5dGhpbmcgbm90IHJlc2VydmVkLiBwYXJhbXMgPT09IG51bGxcbi8vIChtYXJrZXIgd2l0aG91dCBwYXJlbnRoZXNlcykgbWVhbnMgdGhlIGNsYXNzaWMgY2FsbCwgYWxzbyB3aXRob3V0IGZpZWxkcy5cbmZ1bmN0aW9uIGlucHV0UGFyYW1zKHBhcmFtcykge1xuICByZXR1cm4gKHBhcmFtcyA/PyBbXSkuZmlsdGVyKChuYW1lKSA9PiBuYW1lICE9PSBcInRwXCIgJiYgIVJFU0VSVkVEX1BBUkFNUy5pbmNsdWRlcyhuYW1lKSk7XG59XG5cbi8vIElucHV0cyAob25lIHN0cmluZyBwZXIgcGFyYW1ldGVyKSB0byB0aGUgc3RvcmVkIGFyZ3VtZW50IG9iamVjdCwgaW4gdGhlXG4vLyBkZWNsYXJlZCBvcmRlciBzbyBzaG9ydGN1dExhYmVsKCkgc2hvd3MgdGhlbSB0aGF0IHdheS4gRW1wdHkgZmllbGRzIGFyZSBsZWZ0XG4vLyBvdXQuXG5mdW5jdGlvbiBidWlsZEFyZ3MocGFyYW1zLCBpbnB1dHMpIHtcbiAgY29uc3QgYXJncyA9IHt9O1xuICBmb3IgKGNvbnN0IG5hbWUgb2YgaW5wdXRQYXJhbXMocGFyYW1zKSkge1xuICAgIGNvbnN0IHZhbHVlID0gcGFyc2VBcmdWYWx1ZShpbnB1dHNbbmFtZV0pO1xuICAgIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkKSBhcmdzW25hbWVdID0gdmFsdWU7XG4gIH1cbiAgcmV0dXJuIGFyZ3M7XG59XG5cbi8vIEJ1aWxkcyB0aGUgYXJndW1lbnRzIGZvciBmKHRwLCAuLi5oZXJlKSBmcm9tIHRoZSBkZWNsYXJlZCBwYXJhbWV0ZXIgbGlzdC5cbi8vIENhbGxlZCBmcm9tIFRZUC5qcywgdGhlIG9ubHkgcGxhY2UgdGhhdCBrbm93cyBuZXdGaWxlIGFuZCBjdHguXG4vL1xuLy8gV2l0aG91dCBwYXJlbnRoZXNlcyAocGFyYW1zID09PSBudWxsKSBpdCBzdGF5cyB0aGUgY2xhc3NpYyBmKHRwLCBuZXdGaWxlLFxuLy8gY3R4KS4gT3RoZXJ3aXNlIGVhY2ggZW50cnkgcmVzb2x2ZXMgdG8gdGhlIHBhc3NlZCB2YWx1ZSAocmVzZXJ2ZWQgbmFtZXMpIG9yXG4vLyB0aGUgdHlwZWQgYXJndW1lbnQuXG4vL1xuLy8gQSBkb3R0ZWQgbmFtZSAoXCJvcHRpb25zLnR5cFwiKSBpcyBhIEZJRUxEIG9mIGFuIG9iamVjdCBhcmd1bWVudDogYWxsXG4vLyBcIm9wdGlvbnMuKlwiIGNvbGxlY3QgaW50byBvbmUgb2JqZWN0IGF0IHRoZSBwb3NpdGlvbiBvZiB0aGUgZmlyc3Qgb25lLiBUaGlzXG4vLyBzZXJ2ZXMgc2NyaXB0cyB0aGF0IHRha2UgYW4gb3B0aW9ucyBvYmplY3Qgd2l0aG91dCB0eXBpbmcgSlNPTi4gT25lIGxldmVsXG4vLyBvbmx5IC0gXCJhLmIuY1wiIGdpdmVzIGEgZmllbGQgbGl0ZXJhbGx5IG5hbWVkIFwiYi5jXCIuXG5mdW5jdGlvbiByZXNvbHZlQ2FsbEFyZ3MocGFyYW1zLCBhcmdzLCByZXNlcnZlZCA9IHt9KSB7XG4gIGlmIChwYXJhbXMgPT09IG51bGwgfHwgcGFyYW1zID09PSB1bmRlZmluZWQpIHJldHVybiBbcmVzZXJ2ZWQubmV3RmlsZSwgcmVzZXJ2ZWQuY3R4XTtcblxuICBjb25zdCBjYWxsQXJncyA9IFtdO1xuICBjb25zdCBvYmplY3RJbmRleCA9IG5ldyBNYXAoKTtcbiAgZm9yIChjb25zdCBuYW1lIG9mIHBhcmFtcykge1xuICAgIGlmIChuYW1lID09PSBcInRwXCIpIGNvbnRpbnVlO1xuICAgIGlmIChSRVNFUlZFRF9QQVJBTVMuaW5jbHVkZXMobmFtZSkpIHtcbiAgICAgIGNhbGxBcmdzLnB1c2gocmVzZXJ2ZWRbbmFtZV0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGNvbnN0IGRvdCA9IG5hbWUuaW5kZXhPZihcIi5cIik7XG4gICAgaWYgKGRvdCA9PT0gLTEpIHtcbiAgICAgIGNhbGxBcmdzLnB1c2goYXJncz8uW25hbWVdKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBjb25zdCBiYXNlID0gbmFtZS5zbGljZSgwLCBkb3QpO1xuICAgIGlmICghb2JqZWN0SW5kZXguaGFzKGJhc2UpKSB7XG4gICAgICBvYmplY3RJbmRleC5zZXQoYmFzZSwgY2FsbEFyZ3MubGVuZ3RoKTtcbiAgICAgIGNhbGxBcmdzLnB1c2goe30pO1xuICAgIH1cbiAgICBjb25zdCB2YWx1ZSA9IGFyZ3M/LltuYW1lXTtcbiAgICBpZiAodmFsdWUgIT09IHVuZGVmaW5lZCkgY2FsbEFyZ3Nbb2JqZWN0SW5kZXguZ2V0KGJhc2UpXVtuYW1lLnNsaWNlKGRvdCArIDEpXSA9IHZhbHVlO1xuICB9XG4gIHJldHVybiBjYWxsQXJncztcbn1cblxuLy8gV2hldGhlciB0eXBlcy5qc29uIChvciwgaWYgdW5zZXQsIHRoZSBwcm9wZXJ0eSdzIHVzYWdlKSBkZWNsYXJlcyBhIGxpc3QuXG4vLyBUaGVuIGEgcmVzb2x2ZWQgc2hvcnRjdXQgdmFsdWUgaXMgd3JhcHBlZCBpbiBhIG9uZS1lbGVtZW50IGFycmF5IHRvIG1hdGNoLlxuLy8gV2l0aG91dCBhcHAgKHRlc3RzKSBub3RoaW5nIGlzIHdyYXBwZWQuXG5mdW5jdGlvbiBpc0xpc3RQcm9wZXJ0eShhcHAsIGtleSkge1xuICByZXR1cm4gYXBwPy5tZXRhZGF0YVR5cGVNYW5hZ2VyPy5nZXRUeXBlSW5mbz8uKGtleSk/LmV4cGVjdGVkPy50eXBlID09PSBcIm11bHRpdGV4dFwiO1xufVxuXG4vLyBDb3B5IG9mIGZyb250bWF0dGVyIGluIHdoaWNoIGV2ZXJ5IGtleSB3aXRoIGEgc2hvcnRjdXQgY2FycmllcyBpdHMgdmFsdWU6XG4vLyAgIC0gZml4ZWQgdG9rZW4gLT4gcmVzb2x2ZWQgKHdyYXBwZWQgZm9yIGxpc3QgcHJvcGVydGllcyksXG4vLyAgIC0gXCJ0cC48c2NyaXB0PlwiIC0+IG51bGw7IG9ubHkgVGVtcGxhdGVyIGNhbiByZXNvbHZlIGl0LCBUWVAuanMgZ2V0cyB0aGVzZVxuLy8gICAgIGtleXMgZnJvbSBnZXRUeXBTaG9ydGN1dHMoKSBhbmQgZmlsbHMgdGhlbSBpbiBpdHNlbGYuXG4vLyBLZXlzIHdpdGhvdXQgYSBzaG9ydGN1dCBzdGF5IGFzIHRoZXkgYXJlLiBUaGUgc3RvcmVkIHZhbHVlIG9mIGEga2V5IFdJVEggYVxuLy8gc2hvcnRjdXQgaXMgb25seSBvdmVycmlkZGVuIGhlcmUsIG5ldmVyIGRlbGV0ZWQgLSBpdCBpcyB0aGUgZmFsbGJhY2suXG5mdW5jdGlvbiByZXNvbHZlU2hvcnRjdXRzKGZyb250bWF0dGVyLCBzaG9ydGN1dHMsIHsgZmlsZSwgYXBwIH0gPSB7fSkge1xuICBjb25zdCByZXNvbHZlZCA9IHt9O1xuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhmcm9udG1hdHRlcikpIHtcbiAgICBjb25zdCByZWNvcmQgPSBzaG9ydGN1dHM/LltrZXldO1xuICAgIGNvbnN0IGZpeGVkID0gcmVjb3JkID8gZmluZEZpeGVkU2hvcnRjdXQocmVjb3JkLm5hbWUpIDogbnVsbDtcbiAgICBpZiAoZml4ZWQpIHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGZpeGVkLnJlc29sdmUoZmlsZSk7XG4gICAgICByZXNvbHZlZFtrZXldID0gaXNMaXN0UHJvcGVydHkoYXBwLCBrZXkpID8gW3Jlc3VsdF0gOiByZXN1bHQ7XG4gICAgfSBlbHNlIGlmIChpc1NjcmlwdFNob3J0Y3V0KHJlY29yZCkpIHtcbiAgICAgIHJlc29sdmVkW2tleV0gPSBudWxsO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXNvbHZlZFtrZXldID0gdmFsdWU7XG4gICAgfVxuICB9XG4gIHJldHVybiByZXNvbHZlZDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIEZJWEVEX1NIT1JUQ1VUUyxcbiAgU0NSSVBUX1BSRUZJWCxcbiAgZmluZEZpeGVkU2hvcnRjdXQsXG4gIHNjcmlwdE5hbWVPZixcbiAgaXNTY3JpcHRTaG9ydGN1dCxcbiAgc2hvcnRjdXRMYWJlbCxcbiAgcGFyc2VBcmdWYWx1ZSxcbiAgYnVpbGRBcmdzLFxuICBpbnB1dFBhcmFtcyxcbiAgcmVzb2x2ZUNhbGxBcmdzLFxuICBSRVNFUlZFRF9QQVJBTVMsXG4gIHJlc29sdmVTaG9ydGN1dHMsXG59O1xuIiwgImNvbnN0IHsgRnV6enlTdWdnZXN0TW9kYWwsIE1vZGFsLCBTZXR0aW5nLCByZW5kZXJNYXRjaGVzIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IEZJWEVEX1NIT1JUQ1VUUywgU0NSSVBUX1BSRUZJWCwgYnVpbGRBcmdzLCBpbnB1dFBhcmFtcyB9ID0gcmVxdWlyZShcIi4vc2hvcnRjdXRzXCIpO1xuY29uc3QgeyBwaWNrZXJJbnN0cnVjdGlvbnMgfSA9IHJlcXVpcmUoXCIuL3R5cC11dGlsc1wiKTtcblxuLy8gTGlzdCBsYWJlbDogdGhlIG5hbWUsIHBsdXMgdGhlIGRlY2xhcmVkIHBhcmFtZXRlciBuYW1lcyBmb3IgYSBzY3JpcHQsIHNvXG4vLyB0aGUgcGlja2VyIGFscmVhZHkgc2hvd3MgdGhhdCAoYW5kIGhvdykgaXQgdGFrZXMgYXJndW1lbnRzLlxuZnVuY3Rpb24gaXRlbUxhYmVsKGl0ZW0pIHtcbiAgcmV0dXJuIGl0ZW0ucGFyYW1zID8gYCR7aXRlbS5uYW1lfSgke2l0ZW0ucGFyYW1zLmpvaW4oXCIsIFwiKX0pYCA6IGl0ZW0ubmFtZTtcbn1cblxuLy8gUGlja3MgYSBzaG9ydGN1dCBmb3IgYSBUWVAtRnJvbnRtYXR0ZXIgcHJvcGVydHkgKGJ1dHRvbiBvciBjaGlwIGluIHRoZSByb3csXG4vLyBzZWUgdHlwLWZyb250bWF0dGVyLWVkaXRvci5qcykuIFNlYXJjaGFibGUsIGFuZCBzY3JpcHRzIHNob3cgdGhlIGRlc2NyaXB0aW9uXG4vLyBmcm9tIHRoZWlyIEB0eXAtc2hvcnRjdXQgbWFya2VyLiBOZXZlciBmcmVlIHRleHQ6IHRoZSBsaXN0IGlzIHRoZSBzb3VyY2Ugb2Zcbi8vIHRydXRoLCBzbyBhIHR5cG8gaW4gYSBzY3JpcHQgbmFtZSBpcyBpbXBvc3NpYmxlLlxuY2xhc3MgU2hvcnRjdXRQaWNrZXJNb2RhbCBleHRlbmRzIEZ1enp5U3VnZ2VzdE1vZGFsIHtcbiAgY29uc3RydWN0b3IoYXBwLCBrZXksIGl0ZW1zLCByZXNvbHZlKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLml0ZW1zID0gaXRlbXM7XG4gICAgdGhpcy5yZXNvbHZlID0gcmVzb2x2ZTtcbiAgICB0aGlzLmNob3NlbiA9IGZhbHNlO1xuICAgIHRoaXMuc2V0UGxhY2Vob2xkZXIoYENob29zZSBzaG9ydGN1dCBmb3IgXCIke2tleX1cIlx1MjAyNmApO1xuICAgIHRoaXMuc2V0SW5zdHJ1Y3Rpb25zKHBpY2tlckluc3RydWN0aW9ucygpKTtcbiAgfVxuXG4gIGdldEl0ZW1zKCkge1xuICAgIHJldHVybiB0aGlzLml0ZW1zO1xuICB9XG5cbiAgLy8gRnV6enkgc2VhcmNoIGFsc28gY292ZXJzIHRoZSBkZXNjcmlwdGlvbjogXCJjcmVhdGlvblwiIGZpbmRzIFwiY3JlYXRlZFwiLlxuICBnZXRJdGVtVGV4dChpdGVtKSB7XG4gICAgY29uc3QgbGFiZWwgPSBpdGVtTGFiZWwoaXRlbSk7XG4gICAgcmV0dXJuIGl0ZW0uZGVzY3JpcHRpb24gPyBgJHtsYWJlbH0gJHtpdGVtLmRlc2NyaXB0aW9ufWAgOiBsYWJlbDtcbiAgfVxuXG4gIC8vIE1hdGNoZWQgY2hhcmFjdGVycyBtYXJrZWQgbGlrZSBpbiBPYnNpZGlhbidzIG93biBzdWdnZXN0ZXJzLiBUaGUgcmFuZ2VzXG4gIC8vIHJlZmVyIHRvIHRoZSB3aG9sZSBzZWFyY2ggdGV4dCAoZ2V0SXRlbVRleHQpLCBzbyB0aGUgZGVzY3JpcHRpb24ncyBhcmVcbiAgLy8gc2hpZnRlZCBiYWNrIGJ5IHRoZSBsYWJlbCBhbmQgdGhlIHNwYWNlIGJlZm9yZSBpdC5cbiAgcmVuZGVyU3VnZ2VzdGlvbihtYXRjaCwgZWwpIHtcbiAgICBjb25zdCBpdGVtID0gbWF0Y2guaXRlbTtcbiAgICBjb25zdCBsYWJlbCA9IGl0ZW1MYWJlbChpdGVtKTtcbiAgICBjb25zdCBtYXRjaGVzID0gbWF0Y2gubWF0Y2g/Lm1hdGNoZXM/Lmxlbmd0aCA/IG1hdGNoLm1hdGNoLm1hdGNoZXMgOiBudWxsO1xuICAgIGVsLmFkZENsYXNzKFwidHlwLXNob3J0Y3V0LXN1Z2dlc3Rpb25cIik7XG4gICAgcmVuZGVyTWF0Y2hlcyhlbC5jcmVhdGVFbChcImNvZGVcIiwgeyBjbHM6IFwidHlwLXNob3J0Y3V0LXN1Z2dlc3Rpb24tbmFtZVwiIH0pLCBsYWJlbCwgbWF0Y2hlcywgMCk7XG4gICAgaWYgKGl0ZW0uZGVzY3JpcHRpb24pIHtcbiAgICAgIHJlbmRlck1hdGNoZXMoZWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtc2hvcnRjdXQtc3VnZ2VzdGlvbi1kZXNjXCIgfSksIGl0ZW0uZGVzY3JpcHRpb24sIG1hdGNoZXMsIC0obGFiZWwubGVuZ3RoICsgMSkpO1xuICAgIH1cbiAgfVxuXG4gIC8vIE9ic2lkaWFuJ3Mgc2VsZWN0U3VnZ2VzdGlvbigpIGNhbGxzIGNsb3NlKCkgQkVGT1JFIG9uQ2hvb3NlSXRlbSgpLCBzb1xuICAvLyBcImNob3NlblwiIG11c3QgYmUgc2V0IGhlcmUgLSBvdGhlcndpc2Ugb25DbG9zZSgpIHJlc29sdmVzIHdpdGggbnVsbCBmaXJzdFxuICAvLyBhbmQgdGhlIGNob2ljZSBpcyBsb3N0LiBTYW1lIGFzIGluIFR5cFBpY2tlck1vZGFsICh0eXAtcGlja2VyLmpzKS5cbiAgc2VsZWN0U3VnZ2VzdGlvbihpdGVtLCBldnQpIHtcbiAgICB0aGlzLmNob3NlbiA9IHRydWU7XG4gICAgc3VwZXIuc2VsZWN0U3VnZ2VzdGlvbihpdGVtLCBldnQpO1xuICB9XG5cbiAgb25DaG9vc2VJdGVtKGl0ZW0pIHtcbiAgICB0aGlzLnJlc29sdmUoaXRlbSk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHN1cGVyLm9uQ2xvc2UoKTtcbiAgICBpZiAoIXRoaXMuY2hvc2VuKSB0aGlzLnJlc29sdmUobnVsbCk7XG4gIH1cbn1cblxuLy8gQXNrcyBmb3IgdGhlIGFyZ3VtZW50cyBvZiBhIHNjcmlwdCB0aGF0IGRlY2xhcmVzIHNvbWU6IG9uZSBkaWFsb2cgd2l0aCBhbGxcbi8vIGZpZWxkcywgbmFtZWQgYWZ0ZXIgdGhlIHNjcmlwdCdzIHBhcmFtZXRlcnMgYW5kIHByZWZpbGxlZCB3aXRoIHRoZSBzdG9yZWRcbi8vIHZhbHVlcywgc28gcGlja2luZyB0aGUgc2FtZSBzY3JpcHQgYWdhaW4gaXMgaG93IHNpbmdsZSB2YWx1ZXMgZ2V0IGZpeGVkLlxuLy8gQW4gZW1wdHkgZmllbGQgbWVhbnMgXCJub3Qgc2V0XCIgKHNlZSBidWlsZEFyZ3MpOyB0aGVyZSBpcyBubyB2YWxpZGF0aW9uLFxuLy8gc2luY2Ugb25seSB0aGUgc2NyaXB0IGtub3dzIHdoYXQgaXQgbmVlZHMuXG5jbGFzcyBTaG9ydGN1dEFyZ3NNb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgY29uc3RydWN0b3IoYXBwLCBpdGVtLCBleGlzdGluZywgcmVzb2x2ZSkge1xuICAgIHN1cGVyKGFwcCk7XG4gICAgdGhpcy5pdGVtID0gaXRlbTtcbiAgICB0aGlzLnJlc29sdmUgPSByZXNvbHZlO1xuICAgIHRoaXMuZmllbGRzID0gaW5wdXRQYXJhbXMoaXRlbS5wYXJhbXMpO1xuICAgIHRoaXMuaW5wdXRzID0ge307XG4gICAgZm9yIChjb25zdCBuYW1lIG9mIHRoaXMuZmllbGRzKSB7XG4gICAgICBjb25zdCB2YWx1ZSA9IGV4aXN0aW5nPy5bbmFtZV07XG4gICAgICB0aGlzLmlucHV0c1tuYW1lXSA9IHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IG51bGwgPyBcIlwiIDogU3RyaW5nKHZhbHVlKTtcbiAgICB9XG4gICAgdGhpcy5jb25maXJtZWQgPSBmYWxzZTtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICB0aGlzLnRpdGxlRWwuc2V0VGV4dChgQXJndW1lbnRzIGZvciAke3RoaXMuaXRlbS5uYW1lfWApO1xuICAgIGlmICh0aGlzLml0ZW0uZGVzY3JpcHRpb24pIHtcbiAgICAgIHRoaXMuY29udGVudEVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtc2hvcnRjdXQtYXJncy1kZXNjXCIsIHRleHQ6IHRoaXMuaXRlbS5kZXNjcmlwdGlvbiB9KTtcbiAgICB9XG4gICAgZm9yIChjb25zdCBuYW1lIG9mIHRoaXMuZmllbGRzKSB7XG4gICAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRlbnRFbCkuc2V0TmFtZShuYW1lKS5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0XG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMuaW5wdXRzW25hbWVdKVxuICAgICAgICAgIC5vbkNoYW5nZSgodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMuaW5wdXRzW25hbWVdID0gdmFsdWU7XG4gICAgICAgICAgfSlcbiAgICAgICAgICAvLyBFbnRlciBzdWJtaXRzLCBsaWtlIE9ic2lkaWFuJ3Mgb3duIHJlbmFtZSBkaWFsb2dzLlxuICAgICAgICAgIC5pbnB1dEVsLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIChldmVudCkgPT4ge1xuICAgICAgICAgICAgaWYgKGV2ZW50LmtleSA9PT0gXCJFbnRlclwiICYmICFldmVudC5pc0NvbXBvc2luZykge1xuICAgICAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgICB0aGlzLnN1Ym1pdCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pXG4gICAgICApO1xuICAgIH1cbiAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRlbnRFbCkuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICBidXR0b25cbiAgICAgICAgLnNldEJ1dHRvblRleHQoXCJBcHBseVwiKVxuICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgLm9uQ2xpY2soKCkgPT4gdGhpcy5zdWJtaXQoKSlcbiAgICApO1xuICB9XG5cbiAgc3VibWl0KCkge1xuICAgIHRoaXMuY29uZmlybWVkID0gdHJ1ZTtcbiAgICB0aGlzLmNsb3NlKCk7XG4gIH1cblxuICBvbkNsb3NlKCkge1xuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gICAgLy8gRVNDIG9yIGEgY2xpY2sgb3V0c2lkZSBrZWVwcyB0aGUgY3VycmVudCBzaG9ydGN1dCAtIGFuIGFjY2lkZW50YWwgY2xvc2VcbiAgICAvLyBtdXN0IG5vdCBzaWxlbnRseSBsb3NlIGRhdGEuXG4gICAgdGhpcy5yZXNvbHZlKHRoaXMuY29uZmlybWVkID8gYnVpbGRBcmdzKHRoaXMuZmllbGRzLCB0aGlzLmlucHV0cykgOiBudWxsKTtcbiAgfVxufVxuXG4vLyBPcGVucyB0aGUgcGlja2VyIGZvciBwcm9wZXJ0eSBga2V5YC4gZ2V0U2NyaXB0cyBpcyB0aGUgYWNjZXNzb3IgZnJvbVxuLy8gcmVnaXN0ZXJTaG9ydGN1dFNjcmlwdHMoKTsgY3VycmVudCBpcyB0aGUgc2hvcnRjdXQgc2V0IG5vdyAodG8gcHJlZmlsbCB0aGVcbi8vIGFyZ3VtZW50cykuIFJlc29sdmVzIHdpdGggdGhlIG5ldyByZWNvcmQgKHsgbmFtZSB9IG9yIHsgbmFtZSwgYXJncyB9KSwgb3Jcbi8vIG51bGwgb24gY2FuY2VsIC0gYWxzbyB3aGVuIGEgc2NyaXB0IHdhcyBwaWNrZWQgYnV0IGl0cyBhcmd1bWVudCBkaWFsb2cgd2FzXG4vLyBjYW5jZWxsZWQuXG5hc3luYyBmdW5jdGlvbiBwaWNrU2hvcnRjdXQoYXBwLCBrZXksIGdldFNjcmlwdHMsIGN1cnJlbnQgPSBudWxsKSB7XG4gIGNvbnN0IGl0ZW1zID0gW1xuICAgIC4uLkZJWEVEX1NIT1JUQ1VUUy5tYXAoKHsgbmFtZSwgZGVzY3JpcHRpb24gfSkgPT4gKHsgbmFtZSwgZGVzY3JpcHRpb24sIHBhcmFtczogbnVsbCB9KSksXG4gICAgLi4uZ2V0U2NyaXB0cygpLm1hcCgoeyBuYW1lLCBwYXJhbXMsIGRlc2NyaXB0aW9uIH0pID0+ICh7IG5hbWU6IFNDUklQVF9QUkVGSVggKyBuYW1lLCBwYXJhbXMsIGRlc2NyaXB0aW9uIH0pKSxcbiAgXTtcblxuICBjb25zdCBpdGVtID0gYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IG5ldyBTaG9ydGN1dFBpY2tlck1vZGFsKGFwcCwga2V5LCBpdGVtcywgcmVzb2x2ZSkub3BlbigpKTtcbiAgaWYgKCFpdGVtKSByZXR1cm4gbnVsbDtcbiAgLy8gTm8gZmllbGRzIHRvIGFzayBmb3IgKGZpeGVkIHRva2Vucywgb3Igb25seSByZXNlcnZlZCBuYW1lcyBsaWtlXG4gIC8vIFwiKG5ld0ZpbGUpXCIpOiBubyBzZWNvbmQgc3RlcC5cbiAgaWYgKGlucHV0UGFyYW1zKGl0ZW0ucGFyYW1zKS5sZW5ndGggPT09IDApIHJldHVybiB7IG5hbWU6IGl0ZW0ubmFtZSB9O1xuXG4gIC8vIFByZWZpbGwgb25seSBmb3IgdGhlIHNhbWUgc2NyaXB0OyBvbGQgdmFsdWVzIG1lYW4gbm90aGluZyB0byBhbm90aGVyIG9uZS5cbiAgY29uc3QgcHJlZmlsbCA9IGN1cnJlbnQ/Lm5hbWUgPT09IGl0ZW0ubmFtZSA/IGN1cnJlbnQuYXJncyA6IG51bGw7XG4gIGNvbnN0IGFyZ3MgPSBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4gbmV3IFNob3J0Y3V0QXJnc01vZGFsKGFwcCwgaXRlbSwgcHJlZmlsbCwgcmVzb2x2ZSkub3BlbigpKTtcbiAgaWYgKGFyZ3MgPT09IG51bGwpIHJldHVybiBudWxsO1xuICByZXR1cm4gT2JqZWN0LmtleXMoYXJncykubGVuZ3RoID4gMCA/IHsgbmFtZTogaXRlbS5uYW1lLCBhcmdzIH0gOiB7IG5hbWU6IGl0ZW0ubmFtZSB9O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcGlja1Nob3J0Y3V0IH07XG4iLCAiY29uc3QgeyBNYXJrZG93blZpZXcsIE1lbnUsIFdvcmtzcGFjZUxlYWYsIHNldEljb24gfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgc2hvcnRjdXRMYWJlbCwgc2NyaXB0TmFtZU9mIH0gPSByZXF1aXJlKFwiLi9zaG9ydGN1dHNcIik7XG5jb25zdCB7IHBpY2tTaG9ydGN1dCB9ID0gcmVxdWlyZShcIi4vc2hvcnRjdXQtcGlja2VyXCIpO1xuY29uc3QgeyBnZXRTdWJ0eXAsIGVuc3VyZVN1YnR5cCB9ID0gcmVxdWlyZShcIi4vc3VidHlwc1wiKTtcbmNvbnN0IHsgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcbmNvbnN0IHsgc25hcHNob3RTZXR0aW5ncywgb2ZmZXJVbmRvIH0gPSByZXF1aXJlKFwiLi91bmRvXCIpO1xuXG4vLyBNYXJrcyB0aGUgVFlQLUZyb250bWF0dGVyIGVkaXRvcidzIGNvbnRhaW5lciBzbyB0aGUgc2hvcnRjdXQgcnVsZXMgaW5cbi8vIHN0eWxlcy5jc3MgYXBwbHkgb25seSBoZXJlLCBuZXZlciBpbiByZWFsIG5vdGVzLlxuY29uc3QgRURJVE9SX0NMQVNTID0gXCJ0eXAtZnJvbnRtYXR0ZXItZWRpdG9yXCI7XG5cbmNvbnN0IFNZU1RFTV9QUk9QRVJUSUVTID0gW1RZUF9QUk9QRVJUWS50b0xvd2VyQ2FzZSgpLCBTVUJUWVBfUFJPUEVSVFkudG9Mb3dlckNhc2UoKV07XG5cbi8vIFRoZSB2YWx1ZSBvZiBUWVAvU1VCVFlQIGlzIGJ5IGRlZmluaXRpb24gdGhlIFRZUCBvciBTdWJ0eXAgbmFtZSBpdHNlbGY7IGFzXG4vLyBhIHN0YW5kYXJkIHByb3BlcnR5IGl0IHdvdWxkIGJlIHJlZHVuZGFudCBhbmQgY291bGQgc2lsZW50bHkgZHJpZnQgZnJvbSB0aGVcbi8vIHJlYWwgbmFtZSBhZnRlciBhIHJlbmFtZSwgc28gaXQgbmV2ZXIgYXBwZWFycyBhcyBhIHJvdyBoZXJlLlxuLy8gTXV0YXRlcyBpbiBwbGFjZSBpbnN0ZWFkIG9mIHJldHVybmluZyBhIGNvcHk6IE9ic2lkaWFuJ3MgcHJvcGVydHkgZWRpdG9yXG4vLyBzZWVtcyB0byByZWx5IG9uIGEgc3RhYmxlIG9iamVjdCByZWZlcmVuY2UgaW4gc3luY2hyb25pemUoKTsgYSBmcmVzaCBjb3B5XG4vLyBjYXVzZWQgYSBzdGFjayBvdmVyZmxvdyBpbiBpdHMgcmVuZGVyUHJvcGVydHkoKSBwaXBlbGluZSBvbiBmaXJzdCByZW5kZXIuXG5mdW5jdGlvbiBzdHJpcFR5cFByb3BlcnR5KGZyb250bWF0dGVyKSB7XG4gIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGZyb250bWF0dGVyKSkge1xuICAgIGlmIChTWVNURU1fUFJPUEVSVElFUy5pbmNsdWRlcyhrZXkudHJpbSgpLnRvTG93ZXJDYXNlKCkpKSBkZWxldGUgZnJvbnRtYXR0ZXJba2V5XTtcbiAgfVxuICByZXR1cm4gZnJvbnRtYXR0ZXI7XG59XG5cbi8vIFdoZXJlIGEgZnJvbnRtYXR0ZXIgYmxvY2sgbGl2ZXMgaW4gdGhlIHNldHRpbmdzOiBhIFRZUCdzIFRZUC1Gcm9udG1hdHRlclxuLy8gKHR5cERlZmF1bHRGcm9udG1hdHRlci90eXBGbG9hdGluZ0tleXMvdHlwU2hvcnRjdXRzKSBvciBvbmUgb2YgaXRzIFN1YnR5cFxuLy8gYmxvY2tzICh0eXBTdWJ0eXBzLCBzZWUgc3VidHlwcy5qcykuIEVkaXRvciwgZmxvYXRpbmcgbWVudSwgc2hvcnRjdXQgYnV0dG9uXG4vLyBhbmQgcHJvcGVydHkgcmVuYW1lIG9ubHkgdXNlIHRoaXMgaW50ZXJmYWNlIGFuZCBuZWVkbid0IGtub3cgd2hpY2guXG4vL1xuLy8gZ2V0U2hvcnRjdXRzL3NldFNob3J0Y3V0cyBob2xkIHRoZSBzaG9ydGN1dCByZWNvcmRzIHBlciBrZXkgKHNlZVxuLy8gc2hvcnRjdXRzLmpzKSAtIG5leHQgdG8gdGhlIGZyb250bWF0dGVyLCBub3QgaW4gaXQsIHNvIHRoZSB2YWx1ZSBzdGF5c1xuLy8gdHlwZS1jbGVhbi4gV2l0aCBhIHNob3J0Y3V0IHNldCwgdGhlIHZhbHVlIHJlbWFpbnMgYXMgZmFsbGJhY2suXG5mdW5jdGlvbiB0eXBTdG9yZShwbHVnaW4sIHR5cCkge1xuICByZXR1cm4ge1xuICAgIHR5cCxcbiAgICBzdWJ0eXA6IG51bGwsXG4gICAgZ2V0RnJvbnRtYXR0ZXI6ICgpID0+IHBsdWdpbi5zZXR0aW5ncy50eXBEZWZhdWx0RnJvbnRtYXR0ZXJbdHlwXSA/PyB7fSxcbiAgICBzZXRGcm9udG1hdHRlcjogKGZyb250bWF0dGVyKSA9PiB7XG4gICAgICBwbHVnaW4uc2V0dGluZ3MudHlwRGVmYXVsdEZyb250bWF0dGVyW3R5cF0gPSBmcm9udG1hdHRlcjtcbiAgICB9LFxuICAgIGdldEZsb2F0aW5nOiAoKSA9PiBwbHVnaW4uc2V0dGluZ3MudHlwRmxvYXRpbmdLZXlzW3R5cF0gPz8gW10sXG4gICAgc2V0RmxvYXRpbmc6IChrZXlzKSA9PiB7XG4gICAgICBpZiAoa2V5cy5sZW5ndGggPiAwKSBwbHVnaW4uc2V0dGluZ3MudHlwRmxvYXRpbmdLZXlzW3R5cF0gPSBrZXlzO1xuICAgICAgZWxzZSBkZWxldGUgcGx1Z2luLnNldHRpbmdzLnR5cEZsb2F0aW5nS2V5c1t0eXBdO1xuICAgIH0sXG4gICAgZ2V0U2hvcnRjdXRzOiAoKSA9PiBwbHVnaW4uc2V0dGluZ3MudHlwU2hvcnRjdXRzW3R5cF0gPz8ge30sXG4gICAgc2V0U2hvcnRjdXRzOiAoc2hvcnRjdXRzKSA9PiB7XG4gICAgICBpZiAoT2JqZWN0LmtleXMoc2hvcnRjdXRzKS5sZW5ndGggPiAwKSBwbHVnaW4uc2V0dGluZ3MudHlwU2hvcnRjdXRzW3R5cF0gPSBzaG9ydGN1dHM7XG4gICAgICBlbHNlIGRlbGV0ZSBwbHVnaW4uc2V0dGluZ3MudHlwU2hvcnRjdXRzW3R5cF07XG4gICAgfSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gc3VidHlwU3RvcmUocGx1Z2luLCB0eXAsIHN1YnR5cCkge1xuICByZXR1cm4ge1xuICAgIHR5cCxcbiAgICBzdWJ0eXAsXG4gICAgZ2V0RnJvbnRtYXR0ZXI6ICgpID0+IGdldFN1YnR5cChwbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKT8uZnJvbnRtYXR0ZXIgPz8ge30sXG4gICAgc2V0RnJvbnRtYXR0ZXI6IChmcm9udG1hdHRlcikgPT4ge1xuICAgICAgZW5zdXJlU3VidHlwKHBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApLmZyb250bWF0dGVyID0gZnJvbnRtYXR0ZXI7XG4gICAgfSxcbiAgICBnZXRGbG9hdGluZzogKCkgPT4gZ2V0U3VidHlwKHBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApPy5mbG9hdGluZ0tleXMgPz8gW10sXG4gICAgc2V0RmxvYXRpbmc6IChrZXlzKSA9PiB7XG4gICAgICBlbnN1cmVTdWJ0eXAocGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCkuZmxvYXRpbmdLZXlzID0ga2V5cztcbiAgICB9LFxuICAgIGdldFNob3J0Y3V0czogKCkgPT4gZ2V0U3VidHlwKHBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApPy5zaG9ydGN1dHMgPz8ge30sXG4gICAgc2V0U2hvcnRjdXRzOiAoc2hvcnRjdXRzKSA9PiB7XG4gICAgICBlbnN1cmVTdWJ0eXAocGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCkuc2hvcnRjdXRzID0gc2hvcnRjdXRzO1xuICAgIH0sXG4gIH07XG59XG5cbi8vIE9ic2lkaWFuJ3MgcHJvcGVydGllcyB3aWRnZXQgaXMgbm8gb2ZmaWNpYWwgQVBJLiBJbnRlcm5hbGx5IGl0IGlzIGFcbi8vIGNvbXBvbmVudCBjbGFzcyAobWluaWZpZWQgXCJNZXRhZGF0YUVkaXRvclwiKSB0aGF0IGV2ZXJ5IE1hcmtkb3duVmlldyBhbmQgdGhlXG4vLyBmaWxlIHByb3BlcnRpZXMgcGFuZSBpbnN0YW50aWF0ZSBhcyB2aWV3Lm1ldGFkYXRhRWRpdG9yLiBJdCBpc24ndCBleHBvcnRlZCxcbi8vIGJ1dCBhbnkgaW5zdGFuY2UgcmVhY2hlcyBpdCB2aWEgLmNvbnN0cnVjdG9yLCBhbmQgaXQgaXMgc3RhYmxlIGZvciB0aGVcbi8vIHNlc3Npb24gLSBncmFiYmluZyBpdCBvbmNlIGlzIGVub3VnaC5cbmxldCBjYWNoZWRFZGl0b3JDbGFzcyA9IG51bGw7XG5cbmZ1bmN0aW9uIGdldE1ldGFkYXRhRWRpdG9yQ2xhc3MoYXBwKSB7XG4gIGlmIChjYWNoZWRFZGl0b3JDbGFzcykgcmV0dXJuIGNhY2hlZEVkaXRvckNsYXNzO1xuXG4gIGNvbnN0IGFjdGl2ZSA9IGFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xuICBpZiAoYWN0aXZlPy5tZXRhZGF0YUVkaXRvcikge1xuICAgIGNhY2hlZEVkaXRvckNsYXNzID0gYWN0aXZlLm1ldGFkYXRhRWRpdG9yLmNvbnN0cnVjdG9yO1xuICAgIHJldHVybiBjYWNoZWRFZGl0b3JDbGFzcztcbiAgfVxuICBmb3IgKGNvbnN0IGxlYWYgb2YgYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xuICAgIGlmIChsZWFmLnZpZXc/Lm1ldGFkYXRhRWRpdG9yKSB7XG4gICAgICBjYWNoZWRFZGl0b3JDbGFzcyA9IGxlYWYudmlldy5tZXRhZGF0YUVkaXRvci5jb25zdHJ1Y3RvcjtcbiAgICAgIHJldHVybiBjYWNoZWRFZGl0b3JDbGFzcztcbiAgICB9XG4gIH1cbiAgY2FjaGVkRWRpdG9yQ2xhc3MgPSBoYXJ2ZXN0RWRpdG9yQ2xhc3MoYXBwKTtcbiAgcmV0dXJuIGNhY2hlZEVkaXRvckNsYXNzO1xufVxuXG4vLyBCZWZvcmUgYW55IG5vdGUgd2FzIG9wZW4gdGhpcyBzZXNzaW9uIHRoZXJlIGlzIG5vIGluc3RhbmNlIHRvIHJlYWNoIHRoZVxuLy8gY2xhc3MgdGhyb3VnaC4gVGhlbiB3ZSBidWlsZCBvbmU6IGEgZnJlZSBXb3Jrc3BhY2VMZWFmIChubyBwYXJlbnQsIG5ldmVyIGluXG4vLyB0aGUgRE9NKSB3aXRoIGEgTWFya2Rvd25WaWV3IGZyb20gT2JzaWRpYW4ncyB2aWV3IHJlZ2lzdHJ5LCB3aG9zZVxuLy8gY29uc3RydWN0b3IgY3JlYXRlcyBtZXRhZGF0YUVkaXRvci4gT25seSB0aGUgY2xhc3MgaXMgbmVlZGVkOyB0aGUgdmlldyBpc1xuLy8gdW5sb2FkZWQgcmlnaHQgYXdheS4gRGVsaWJlcmF0ZWx5IE5PVCBsZWFmLmRldGFjaCgpOiB0aGF0IGV4cGVjdHMgYSBwYXJlbnRcbi8vIHRoaXMgbGVhZiBuZXZlciBoYWQuXG5mdW5jdGlvbiBoYXJ2ZXN0RWRpdG9yQ2xhc3MoYXBwKSB7XG4gIGxldCB2aWV3ID0gbnVsbDtcbiAgdHJ5IHtcbiAgICBjb25zdCBjcmVhdGVWaWV3ID0gYXBwLnZpZXdSZWdpc3RyeT8uZ2V0Vmlld0NyZWF0b3JCeVR5cGU/LihcIm1hcmtkb3duXCIpO1xuICAgIGlmICghY3JlYXRlVmlldykgcmV0dXJuIG51bGw7XG4gICAgdmlldyA9IGNyZWF0ZVZpZXcobmV3IFdvcmtzcGFjZUxlYWYoYXBwKSk7XG4gICAgcmV0dXJuIHZpZXcubWV0YWRhdGFFZGl0b3I/LmNvbnN0cnVjdG9yID8/IG51bGw7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcihcIlt0eXAtc3lzdGVtXSBjb3VsZG4ndCBmaW5kIHRoZSBNZXRhZGF0YUVkaXRvciBjbGFzc1wiLCBlcnJvcik7XG4gICAgcmV0dXJuIG51bGw7XG4gIH0gZmluYWxseSB7XG4gICAgdHJ5IHtcbiAgICAgIHZpZXc/LnVubG9hZCgpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiW3R5cC1zeXN0ZW1dIGNvdWxkbid0IGRpc2NhcmQgdGhlIGhlbHBlciBNYXJrZG93blZpZXdcIiwgZXJyb3IpO1xuICAgIH1cbiAgfVxufVxuXG4vLyBMaWtlIGdldE1ldGFkYXRhRWRpdG9yQ2xhc3M6IHRoZSBwcml2YXRlIHByb3BlcnR5IHJvdyBjbGFzcywgdGFrZW4gZnJvbSBhblxuLy8gYWxyZWFkeSByZW5kZXJlZCByb3cuIE9ubHkgZW5zdXJlUHJvcGVydHlNZW51UGF0Y2goKSBuZWVkcyBpdCwgYW5kIGBlZGl0b3JgXG4vLyB1c3VhbGx5IGhhcyBhIHJvdyBieSB0aGVuLCBzbyBpdCBpcyB0cmllZCBmaXJzdC5cbmxldCBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzID0gbnVsbDtcblxuZnVuY3Rpb24gZ2V0UHJvcGVydHlSb3dDbGFzcyhhcHAsIGVkaXRvcikge1xuICBpZiAoY2FjaGVkUHJvcGVydHlSb3dDbGFzcykgcmV0dXJuIGNhY2hlZFByb3BlcnR5Um93Q2xhc3M7XG4gIGlmIChlZGl0b3I/LnJlbmRlcmVkPy5bMF0pIHtcbiAgICBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzID0gZWRpdG9yLnJlbmRlcmVkWzBdLmNvbnN0cnVjdG9yO1xuICAgIHJldHVybiBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzO1xuICB9XG4gIGNvbnN0IGFjdGl2ZSA9IGFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xuICBpZiAoYWN0aXZlPy5tZXRhZGF0YUVkaXRvcj8ucmVuZGVyZWQ/LlswXSkge1xuICAgIGNhY2hlZFByb3BlcnR5Um93Q2xhc3MgPSBhY3RpdmUubWV0YWRhdGFFZGl0b3IucmVuZGVyZWRbMF0uY29uc3RydWN0b3I7XG4gICAgcmV0dXJuIGNhY2hlZFByb3BlcnR5Um93Q2xhc3M7XG4gIH1cbiAgZm9yIChjb25zdCBsZWFmIG9mIGFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikpIHtcbiAgICBpZiAobGVhZi52aWV3Py5tZXRhZGF0YUVkaXRvcj8ucmVuZGVyZWQ/LlswXSkge1xuICAgICAgY2FjaGVkUHJvcGVydHlSb3dDbGFzcyA9IGxlYWYudmlldy5tZXRhZGF0YUVkaXRvci5yZW5kZXJlZFswXS5jb25zdHJ1Y3RvcjtcbiAgICAgIHJldHVybiBjYWNoZWRQcm9wZXJ0eVJvd0NsYXNzO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLy8gQWRkcyBhIFwiRmxvYXRpbmdcIiB0b2dnbGUgYXQgdGhlIHZlcnkgdG9wIG9mIGEgcHJvcGVydHkgcm93J3MgY29udGV4dCBtZW51IC1cbi8vIG9ubHkgZm9yIHJvd3Mgb2YgdGhlIHBsdWdpbidzIG93biBUWVAtUGFuZSAocmVjb2duaXplZCBieSBvd25lci50eXBTdG9yZSksXG4vLyBuZXZlciBpbiByZWFsIG5vdGVzLiBVbmxpa2UgdGhlIGV4dHJhIFwiK1wiIGJ1dHRvbiAodHlwUGVuZGluZ0Zsb2F0aW5nQWRkKSxcbi8vIHdoaWNoIG9ubHkgYWZmZWN0cyBhIE5FVyBwcm9wZXJ0eSwgdGhpcyB3b3JrcyBvbiBhbnkgZXhpc3Rpbmcgb25lLCBib3RoIHdheXMuXG4vL1xuLy8gVGhlIHByb3BlcnR5IG1lbnUgaXMgbm8gb2ZmaWNpYWwgZXh0ZW5zaW9uIHBvaW50OiBvbiBkZXNrdG9wIGl0IGJ1aWxkcyBhXG4vLyBOQVRJVkUgRWxlY3Ryb24gbWVudSBmcm9tIGFuIGludGVybmFsIE1lbnUgYW5kIHNob3dzIGl0IHdpdGhpblxuLy8gc2hvd1Byb3BlcnR5TWVudSgpIGluIG9uZSBzeW5jaHJvbm91cyBjYWxsIC0gbm8gd29ya3NwYWNlIGV2ZW50LCBubyBET01cbi8vIHBvcHVwIHRvIGFtZW5kIGFmdGVyd2FyZHMuIFNvIHRoZSBwcml2YXRlIHJvdyBjbGFzcyBpcyBwYXRjaGVkLCBhcyBuYXJyb3dseVxuLy8gYXMgcG9zc2libGU6IGZvciBvdXIgcm93cywgcmlnaHQgYmVmb3JlIE9ic2lkaWFuIHNob3dzIGl0cyBmaW5pc2hlZCBtZW51LFxuLy8gb25lIGFkZEl0ZW0oKSBpcyBzbGlwcGVkIGluIHRocm91Z2ggYSBwYXRjaCBvbiBNZW51LnByb3RvdHlwZS5zaG93QXRNb3VzZUV2ZW50XG4vLyB0aGF0IHJlc2V0cyBpdHNlbGYgYWZ0ZXIgdGhpcyBvbmUgY2FsbCAoc2FmZSwgSlMgaXMgc2luZ2xlLXRocmVhZGVkKS4gVGhlXG4vLyByZXN0IG9mIHRoZSBuYXRpdmUgbWVudSBzdGF5cyB1bnRvdWNoZWQuXG5sZXQgdW5kb1Byb3BlcnR5TWVudVBhdGNoID0gbnVsbDtcblxuZnVuY3Rpb24gZW5zdXJlUHJvcGVydHlNZW51UGF0Y2goYXBwLCBlZGl0b3IpIHtcbiAgY29uc3QgUm93Q2xhc3MgPSBnZXRQcm9wZXJ0eVJvd0NsYXNzKGFwcCwgZWRpdG9yKTtcbiAgaWYgKCFSb3dDbGFzcyB8fCBSb3dDbGFzcy5fdHlwU3lzdGVtTWVudVBhdGNoZWQpIHJldHVybjtcbiAgUm93Q2xhc3MuX3R5cFN5c3RlbU1lbnVQYXRjaGVkID0gdHJ1ZTtcblxuICBjb25zdCBvcmlnaW5hbFNob3dQcm9wZXJ0eU1lbnUgPSBSb3dDbGFzcy5wcm90b3R5cGUuc2hvd1Byb3BlcnR5TWVudTtcbiAgdW5kb1Byb3BlcnR5TWVudVBhdGNoID0gKCkgPT4ge1xuICAgIFJvd0NsYXNzLnByb3RvdHlwZS5zaG93UHJvcGVydHlNZW51ID0gb3JpZ2luYWxTaG93UHJvcGVydHlNZW51O1xuICAgIGRlbGV0ZSBSb3dDbGFzcy5fdHlwU3lzdGVtTWVudVBhdGNoZWQ7XG4gIH07XG4gIFJvd0NsYXNzLnByb3RvdHlwZS5zaG93UHJvcGVydHlNZW51ID0gZnVuY3Rpb24gKGV2ZW50KSB7XG4gICAgY29uc3Qgb3duZXIgPSB0aGlzLm1ldGFkYXRhRWRpdG9yPy5vd25lcjtcbiAgICBpZiAoIW93bmVyPy50eXBTdG9yZSkgcmV0dXJuIG9yaWdpbmFsU2hvd1Byb3BlcnR5TWVudS5jYWxsKHRoaXMsIGV2ZW50KTtcblxuICAgIGNvbnN0IHJvdyA9IHRoaXM7XG4gICAgY29uc3Qgb3JpZ2luYWxTaG93QXRNb3VzZUV2ZW50ID0gTWVudS5wcm90b3R5cGUuc2hvd0F0TW91c2VFdmVudDtcbiAgICBNZW51LnByb3RvdHlwZS5zaG93QXRNb3VzZUV2ZW50ID0gZnVuY3Rpb24gKG1vdXNlRXZlbnQpIHtcbiAgICAgIE1lbnUucHJvdG90eXBlLnNob3dBdE1vdXNlRXZlbnQgPSBvcmlnaW5hbFNob3dBdE1vdXNlRXZlbnQ7XG4gICAgICBjb25zdCBpc0Zsb2F0aW5nID0gb3duZXIudHlwU3RvcmUuZ2V0RmxvYXRpbmcoKS5pbmNsdWRlcyhyb3cuZW50cnkua2V5KTtcbiAgICAgIC8vIFwidGl0bGVcIiBpcyB0aGUgZmlyc3Qgc2VjdGlvbiBzaG93UHJvcGVydHlNZW51IHJlZ2lzdGVycyBhbmQgaXMgZW1wdHlcbiAgICAgIC8vIG9uIGRlc2t0b3AsIHNvIHRoaXMgbGFuZHMgcmVsaWFibHkgb24gdG9wLiBcInBpbi1vZmZcIiA9IG5vdCBwaW5uZWQgPVxuICAgICAgLy8gZmxvYXRpbmcuXG4gICAgICB0aGlzLmFkZEl0ZW0oKGl0ZW0pID0+XG4gICAgICAgIGl0ZW1cbiAgICAgICAgICAuc2V0VGl0bGUoXCJGbG9hdGluZ1wiKVxuICAgICAgICAgIC5zZXRJY29uKFwicGluLW9mZlwiKVxuICAgICAgICAgIC5zZXRDaGVja2VkKGlzRmxvYXRpbmcpXG4gICAgICAgICAgLnNldFNlY3Rpb24oXCJ0aXRsZVwiKVxuICAgICAgICAgIC5vbkNsaWNrKCgpID0+IHRvZ2dsZUZsb2F0aW5nUHJvcGVydHkob3duZXIudHlwUGFuZSwgb3duZXIudHlwU3RvcmUsIHJvdy5lbnRyeS5rZXkpKVxuICAgICAgKTtcbiAgICAgIHJldHVybiBvcmlnaW5hbFNob3dBdE1vdXNlRXZlbnQuY2FsbCh0aGlzLCBtb3VzZUV2ZW50KTtcbiAgICB9O1xuXG4gICAgcmV0dXJuIG9yaWdpbmFsU2hvd1Byb3BlcnR5TWVudS5jYWxsKHRoaXMsIGV2ZW50KTtcbiAgfTtcbn1cblxuLy8gT24gdW5sb2FkOyBvdGhlcndpc2UgdGhlIHBhdGNoIHdvdWxkIG91dGxpdmUgYSBob3QgcmVsb2FkIHdpdGggdGhlIG9sZFxuLy8gbW9kdWxlJ3MgY2xvc3VyZXMuXG5mdW5jdGlvbiByZW1vdmVQcm9wZXJ0eU1lbnVQYXRjaCgpIHtcbiAgdW5kb1Byb3BlcnR5TWVudVBhdGNoPy4oKTtcbiAgdW5kb1Byb3BlcnR5TWVudVBhdGNoID0gbnVsbDtcbn1cblxuZnVuY3Rpb24gdG9nZ2xlRmxvYXRpbmdQcm9wZXJ0eSh2aWV3LCBzdG9yZSwga2V5KSB7XG4gIGNvbnN0IGZsb2F0aW5nID0gc3RvcmUuZ2V0RmxvYXRpbmcoKTtcbiAgc3RvcmUuc2V0RmxvYXRpbmcoZmxvYXRpbmcuaW5jbHVkZXMoa2V5KSA/IGZsb2F0aW5nLmZpbHRlcigoaykgPT4gayAhPT0ga2V5KSA6IFsuLi5mbG9hdGluZywga2V5XSk7XG4gIHZpZXcucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAvLyBVcGRhdGVzIHRoZSBib2xkL2l0YWxpYyBtYXJrcyBhdCBvbmNlLCBoZXJlIChyZWZyZXNoRnJvbnRtYXR0ZXJIaWdobGlnaHRcbiAgLy8gY292ZXJzIHRoZSBUWVAtUGFuZSdzIG93biBlZGl0b3JzKSBhbmQgaW4gb3BlbiBub3RlcyAtIHdpdGhvdXRcbiAgLy8gcmUtcmVuZGVyaW5nIHRoaXMgVFlQLVBhbmUsIHNlZSByZWZyZXNoVHlwQ29sb3JzRXhjZXB0IGluIG1haW4uanMuXG4gIHZpZXcucGx1Z2luLnJlZnJlc2hUeXBDb2xvcnNFeGNlcHQ/Lih2aWV3KTtcbn1cblxuLy8gS2V5Ym9hcmQgbmF2aWdhdGlvbiBiZXlvbmQgb25lIGVkaXRvciBpbnN0YW5jZSAoc2VlIGZyb250bWF0dGVyLWJsb2Nrcy5qcyk6XG4vLyBPYnNpZGlhbiBtb3ZlcyBmb2N1cyBvbmx5IHdpdGhpbiBpdHMgb3duIHJvdyBsaXN0LCBhbmQgYXQgZWl0aGVyIGVuZCBvbnRvXG4vLyB0aGUgZWRpdG9yJ3MgaGVhZGluZyBvciBcIkFkZCBwcm9wZXJ0eVwiIGJ1dHRvbiAtIGJvdGggaGlkZGVuIGhlcmUgYnkgQ1NTLCBzb1xuLy8gdGhlIGNoYWluIHN0b3BwZWQgYXQgdGhlIGJsb2NrIGVkZ2UuXG4vL1xuLy8gb3duZXIuc2hpZnRGb2N1c0JlZm9yZS9BZnRlciBhcmUgb25seSByZWFjaGVkIHRocm91Z2ggZXhhY3RseSB0aG9zZSBoaWRkZW5cbi8vIGVsZW1lbnRzLCBzbyBpbnN0ZWFkIGEgY2FwdHVyZS1waGFzZSBoYW5kbGVyIHJ1bnMgQkVGT1JFIHRoZSByb3cncyBvd24uIEl0XG4vLyBvbmx5IGFjdHMgd2hpbGUgdGhlIHJvdyBJVFNFTEYgaGFzIGZvY3VzIChldmVudC50YXJnZXQgaXMgdGhlIHJvdydzXG4vLyBjb250YWluZXIpIC0gdGhlIHNhbWUgY29uZGl0aW9uIHVuZGVyIHdoaWNoIE9ic2lkaWFuIGFsbG93cyBqL2ssIHNvIG5ldmVyXG4vLyB3aGlsZSB0eXBpbmcgaW4gYSBmaWVsZC5cbmZ1bmN0aW9uIHJlZ2lzdGVyRm9jdXNDaGFpbihlZGl0b3IsIG9uU2hpZnRGb2N1cykge1xuICBlZGl0b3IuY29udGFpbmVyRWwuYWRkRXZlbnRMaXN0ZW5lcihcbiAgICBcImtleWRvd25cIixcbiAgICAoZXZlbnQpID0+IHtcbiAgICAgIGlmIChldmVudC5pc0NvbXBvc2luZyB8fCBldmVudC5kZWZhdWx0UHJldmVudGVkKSByZXR1cm47XG4gICAgICAvLyBNdWx0aS1zZWxlY3Rpb246IE9ic2lkaWFuIGV4dGVuZHMgdGhlIHNlbGVjdGlvbiBpbnN0ZWFkIG9mIG1vdmluZy5cbiAgICAgIGlmIChlZGl0b3Iuc2VsZWN0ZWRMaW5lcz8uc2l6ZSA+IDEpIHJldHVybjtcbiAgICAgIGlmIChldmVudC5zaGlmdEtleSAmJiAoZXZlbnQua2V5ID09PSBcIkFycm93VXBcIiB8fCBldmVudC5rZXkgPT09IFwiQXJyb3dEb3duXCIpKSByZXR1cm47XG5cbiAgICAgIGNvbnN0IGluZGV4ID0gZWRpdG9yLnJlbmRlcmVkLmZpbmRJbmRleCgocm93KSA9PiByb3cuY29udGFpbmVyRWwgPT09IGV2ZW50LnRhcmdldCk7XG4gICAgICBpZiAoaW5kZXggPT09IC0xKSByZXR1cm47XG5cbiAgICAgIGNvbnN0IHVwID0gZXZlbnQua2V5ID09PSBcIkFycm93VXBcIiB8fCBldmVudC5rZXkgPT09IFwia1wiIHx8IChldmVudC5rZXkgPT09IFwiVGFiXCIgJiYgZXZlbnQuc2hpZnRLZXkpO1xuICAgICAgY29uc3QgZG93biA9IGV2ZW50LmtleSA9PT0gXCJBcnJvd0Rvd25cIiB8fCBldmVudC5rZXkgPT09IFwialwiIHx8IChldmVudC5rZXkgPT09IFwiVGFiXCIgJiYgIWV2ZW50LnNoaWZ0S2V5KTtcbiAgICAgIGxldCBzdGVwID0gMDtcbiAgICAgIGlmICh1cCAmJiBpbmRleCA9PT0gMCkgc3RlcCA9IC0xO1xuICAgICAgZWxzZSBpZiAoZG93biAmJiBpbmRleCA9PT0gZWRpdG9yLnJlbmRlcmVkLmxlbmd0aCAtIDEpIHN0ZXAgPSAxO1xuICAgICAgaWYgKHN0ZXAgPT09IDAgfHwgIW9uU2hpZnRGb2N1cyhzdGVwKSkgcmV0dXJuO1xuXG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgfSxcbiAgICB0cnVlXG4gICk7XG59XG5cbi8vIFRoZSB3aWRnZXQgdGFrZXMgYW4gXCJvd25lclwiIGFzIHNlY29uZCBjb25zdHJ1Y3RvciBhcmd1bWVudCAtIHRoZSBvbmx5IHRoaW5nXG4vLyBiaW5kaW5nIGl0IHRvIGEgZmlsZS4gSGVyZSBpdCBpcyBib3VuZCB0byBhIHBsYWluIG9iamVjdCBpbiB0aGUgc2V0dGluZ3M6XG4vLyBzYXZlRnJvbnRtYXR0ZXIob2JqKSBnZXRzIHRoZSBmdWxsIHByb3BlcnR5IHNldCBvbiBldmVyeSBjaGFuZ2UuXG4vLyBzaGlmdEZvY3VzQmVmb3JlL0FmdGVyIG1heSBiZSBuby1vcHMuIGdldEZpbGUoKSBpcyBjYWxsZWQgYnkgZXZlcnkgcm93IHdoaWxlXG4vLyByZW5kZXJpbmcgKGZvciBzb3VyY2VQYXRoKTsgdGhlcmUgaXMgbm8gcmVhbCBmaWxlLCBidXQgdGhlIG1ldGhvZCBtdXN0IGV4aXN0XG4vLyBvciB0aGUgd2lkZ2V0IGNyYXNoZXMuXG4vL1xuLy8gT25lIGVkaXRvciBwZXIgYmxvY2sgKFRZUCBvciBTdWJ0eXApLCBib3VuZCB0byBgc3RvcmVgLiBTdGFuZGFyZCBhbmRcbi8vIGZsb2F0aW5nIHByb3BlcnRpZXMgc2hhcmUgb25lIGxpc3QgYW5kIG9yZGVyOyBnZXRUeXBEZWZhdWx0cygpIGp1c3QgbGVhdmVzXG4vLyB0aGUgZmxvYXRpbmcgb25lcyBvdXQuIGVkaXRvci50eXBQZW5kaW5nRmxvYXRpbmdBZGQsIHNldCBiZWZvcmVcbi8vIGFkZEJsYW5rUHJvcGVydHkoKSwgbWFya3MgdGhlIG5leHQgYWRkZWQgKG9yIHJlbmFtZWQpIHByb3BlcnR5IGFzIGZsb2F0aW5nIC1cbi8vIHNlZSBzYXZlRnJvbnRtYXR0ZXIuXG5mdW5jdGlvbiBtb3VudEZyb250bWF0dGVyRWRpdG9yKHZpZXcsIGNvbnRhaW5lckVsLCBzdG9yZSwgeyBvblNoaWZ0Rm9jdXMgfSA9IHt9KSB7XG4gIGNvbnN0IGFwcCA9IHZpZXcuYXBwO1xuICBjb25zdCBFZGl0b3JDbGFzcyA9IGdldE1ldGFkYXRhRWRpdG9yQ2xhc3MoYXBwKTtcbiAgaWYgKCFFZGl0b3JDbGFzcykge1xuICAgIGNvbnRhaW5lckVsLmNyZWF0ZUVsKFwicFwiLCB7XG4gICAgICBjbHM6IFwidHlwLWZyb250bWF0dGVyLXVuYXZhaWxhYmxlXCIsXG4gICAgICB0ZXh0OiBcIk9wZW4gYSBub3RlIG9uY2UgdG8gaW5pdGlhbGl6ZSB0aGUgZWRpdG9yLlwiLFxuICAgIH0pO1xuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgY29uc3Qgb3duZXIgPSB7XG4gICAgYXBwLFxuICAgIC8vIExldHMgZW5zdXJlUHJvcGVydHlNZW51UGF0Y2goKSByZWNvZ25pemUgcm93cyBvZiB0aGlzIGVkaXRvciBhbmQgZ2l2ZXNcbiAgICAvLyB0aGUgZ2xvYmFsIG1lbnUgcGF0Y2ggdGhlIHN0b3JlIGFuZCB2aWV3IHBlciByb3cgKHRoZSBwYXRjaCBpdHNlbGYgaXNcbiAgICAvLyBpbnN0YWxsZWQgb25seSBvbmNlKS5cbiAgICB0eXBTdG9yZTogc3RvcmUsXG4gICAgdHlwUGFuZTogdmlldyxcbiAgICBnZXRGaWxlKCkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfSxcbiAgICAvLyBPbmx5IGZvciBPYnNpZGlhbidzIGhvdmVyIHByZXZpZXcgb2YgaW50ZXJuYWwgbGlua3MgaW4gYSB2YWx1ZTsgYW55XG4gICAgLy8gc3RyaW5nIHdpbGwgZG8uXG4gICAgZ2V0SG92ZXJTb3VyY2UoKSB7XG4gICAgICByZXR1cm4gXCJ0eXAtZnJvbnRtYXR0ZXJcIjtcbiAgICB9LFxuICAgIHNoaWZ0Rm9jdXNCZWZvcmUoKSB7fSxcbiAgICBzaGlmdEZvY3VzQWZ0ZXIoKSB7fSxcbiAgICAvLyBDYWxsZWQgb25jZSBwZXIgY29tcGxldGVkIGNoYW5nZSAoYSByZW5hbWUgb25seSBvbiBibHVyIG9mIHRoZSBrZXlcbiAgICAvLyBpbnB1dCksIHNvIGVhY2ggY2FsbCBhZGRzIGFuZC9vciByZW1vdmVzIGF0IG1vc3Qgb25lIG5vbi1lbXB0eSBwcm9wZXJ0eSxcbiAgICAvLyBleGNlcHQgYSBtdWx0aS1kZWxldGUuIFRoYXQga2VlcHMgdGhlIGZsb2F0aW5nIGZsYWcgZWFzeSB0byB0cmFja1xuICAgIC8vIHdpdGhvdXQgZm9sbG93aW5nIGludGVybWVkaWF0ZSB0eXBpbmcgc3RhdGVzLlxuICAgIHNhdmVGcm9udG1hdHRlcihmcm9udG1hdHRlcikge1xuICAgICAgLy8gQSByb3cganVzdCBuYW1lZCBcIlRZUFwiL1wiU1VCVFlQXCIgaXNuJ3Qgc2F2ZWQuIEl0IHN0YXlzIHZpc2libGUgdW50aWxcbiAgICAgIC8vIHRoZSBuZXh0IG1vdW50IChubyBzeW5jaHJvbml6ZSgpIGhlcmUsIHNlZSBzdHJpcFR5cFByb3BlcnR5KS5cbiAgICAgIHN0cmlwVHlwUHJvcGVydHkoZnJvbnRtYXR0ZXIpO1xuXG4gICAgICBjb25zdCBwcmV2aW91cyA9IHN0b3JlLmdldEZyb250bWF0dGVyKCk7XG4gICAgICBjb25zdCBwcmV2aW91c0tleXMgPSBPYmplY3Qua2V5cyhwcmV2aW91cykuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gXCJcIik7XG4gICAgICBjb25zdCBjdXJyZW50S2V5cyA9IE9iamVjdC5rZXlzKGZyb250bWF0dGVyKS5maWx0ZXIoKGtleSkgPT4ga2V5ICE9PSBcIlwiKTtcbiAgICAgIGNvbnN0IHJlbW92ZWRLZXlzID0gcHJldmlvdXNLZXlzLmZpbHRlcigoa2V5KSA9PiAhY3VycmVudEtleXMuaW5jbHVkZXMoa2V5KSk7XG4gICAgICBjb25zdCBhZGRlZEtleXMgPSBjdXJyZW50S2V5cy5maWx0ZXIoKGtleSkgPT4gIXByZXZpb3VzS2V5cy5pbmNsdWRlcyhrZXkpKTtcbiAgICAgIC8vIERlbGV0aW5nIHJvd3MgbG9zZXMgdmFsdWUsIHNob3J0Y3V0IGFuZCBmbG9hdGluZyBmbGFnIGF0IG9uY2UgLSB0aGVcbiAgICAgIC8vIG9uZSBjaGFuZ2UgaGVyZSB0aGF0IGdldHMgYW4gdW5kbyAoc2VlIHVuZG8uanMpLiBTbmFwc2hvdCBiZWZvcmUgYW55XG4gICAgICAvLyBzdG9yZSB3cml0ZSwgYW5kIG9ubHkgZm9yIGEgZGVsZXRpb24gLSBubyBmdWxsIGNvcHkgb24gZXZlcnkgZWRpdC5cbiAgICAgIGNvbnN0IHJlbW92ZWRPbmx5ID0gcmVtb3ZlZEtleXMubGVuZ3RoID4gMCAmJiBhZGRlZEtleXMubGVuZ3RoID09PSAwO1xuICAgICAgY29uc3QgdW5kb1NuYXBzaG90ID0gcmVtb3ZlZE9ubHkgPyBzbmFwc2hvdFNldHRpbmdzKHZpZXcucGx1Z2luKSA6IG51bGw7XG5cbiAgICAgIGxldCBmbG9hdGluZyA9IHN0b3JlLmdldEZsb2F0aW5nKCk7XG4gICAgICBpZiAocmVtb3ZlZEtleXMubGVuZ3RoID09PSAxICYmIGFkZGVkS2V5cy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgLy8gQSByZW5hbWU6IHRoZSBmbG9hdGluZyBmbGFnIG1vdmVzIGFsb25nLlxuICAgICAgICBmbG9hdGluZyA9IGZsb2F0aW5nLm1hcCgoa2V5KSA9PiAoa2V5ID09PSByZW1vdmVkS2V5c1swXSA/IGFkZGVkS2V5c1swXSA6IGtleSkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKHJlbW92ZWRLZXlzLmxlbmd0aCA+IDApIGZsb2F0aW5nID0gZmxvYXRpbmcuZmlsdGVyKChrZXkpID0+ICFyZW1vdmVkS2V5cy5pbmNsdWRlcyhrZXkpKTtcbiAgICAgICAgaWYgKGVkaXRvci50eXBQZW5kaW5nRmxvYXRpbmdBZGQgJiYgYWRkZWRLZXlzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAgIGZsb2F0aW5nID0gWy4uLmZsb2F0aW5nLCBhZGRlZEtleXNbMF1dO1xuICAgICAgICAgIGVkaXRvci50eXBQZW5kaW5nRmxvYXRpbmdBZGQgPSBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgLy8gU2hvcnRjdXRzIGJlbG9uZyB0byB0aGUga2V5IHRvbzogdGhleSBtb3ZlIG9uIHJlbmFtZSBhbmQgZ28gb24gZGVsZXRlLlxuICAgICAgY29uc3Qgc2hvcnRjdXRzID0geyAuLi5zdG9yZS5nZXRTaG9ydGN1dHMoKSB9O1xuICAgICAgaWYgKHJlbW92ZWRLZXlzLmxlbmd0aCA9PT0gMSAmJiBhZGRlZEtleXMubGVuZ3RoID09PSAxKSB7XG4gICAgICAgIGlmIChzaG9ydGN1dHNbcmVtb3ZlZEtleXNbMF1dKSB7XG4gICAgICAgICAgc2hvcnRjdXRzW2FkZGVkS2V5c1swXV0gPSBzaG9ydGN1dHNbcmVtb3ZlZEtleXNbMF1dO1xuICAgICAgICAgIGRlbGV0ZSBzaG9ydGN1dHNbcmVtb3ZlZEtleXNbMF1dO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmb3IgKGNvbnN0IGtleSBvZiByZW1vdmVkS2V5cykgZGVsZXRlIHNob3J0Y3V0c1trZXldO1xuICAgICAgfVxuXG4gICAgICBzdG9yZS5zZXRGcm9udG1hdHRlcihmcm9udG1hdHRlcik7XG4gICAgICBzdG9yZS5zZXRGbG9hdGluZyhmbG9hdGluZyk7XG4gICAgICBzdG9yZS5zZXRTaG9ydGN1dHMoc2hvcnRjdXRzKTtcbiAgICAgIHZpZXcucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgaWYgKHVuZG9TbmFwc2hvdCkge1xuICAgICAgICBjb25zdCBibG9ja05hbWUgPSBzdG9yZS5zdWJ0eXAgPz8gc3RvcmUudHlwO1xuICAgICAgICBvZmZlclVuZG8oXG4gICAgICAgICAgdmlldy5wbHVnaW4sXG4gICAgICAgICAgcmVtb3ZlZEtleXMubGVuZ3RoID09PSAxXG4gICAgICAgICAgICA/IGBQcm9wZXJ0eSBcIiR7cmVtb3ZlZEtleXNbMF19XCIgcmVtb3ZlZCBmcm9tICR7YmxvY2tOYW1lfS5gXG4gICAgICAgICAgICA6IGAke3JlbW92ZWRLZXlzLmxlbmd0aH0gcHJvcGVydGllcyByZW1vdmVkIGZyb20gJHtibG9ja05hbWV9LmAsXG4gICAgICAgICAgdW5kb1NuYXBzaG90XG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICAvLyBBIG5ld2x5IG5hbWVkIHJvdyBnZXRzIGl0cyBidXR0b24sIGEgZGVsZXRlZCBvbmUgdGFrZXMgaXQgYWxvbmcuXG4gICAgICByZW5kZXJTaG9ydGN1dENvbnRyb2xzKHZpZXcsIGVkaXRvciwgc3RvcmUpO1xuICAgICAgLy8gQm9sZC9pdGFsaWMgbWFya3MgaW4gb3BlbiBub3RlcyBmb2xsb3cgdGhlIGNoYW5nZWQgbGlzdCBhdCBvbmNlLiBOb3RcbiAgICAgIC8vIHRoZSBmdWxsIHJlZnJlc2hUeXBDb2xvcnMoKTogaXQgd291bGQgcmUtcmVuZGVyIHRoaXMgVFlQLVBhbmUsIGFuZFxuICAgICAgLy8gdGhlIGVkaXQgdGhhdCBjYWxsZWQgc2F2ZUZyb250bWF0dGVyIHdvdWxkIGxvc2UgaXRzIGZvY3VzIChUYWIgdG8gdGhlXG4gICAgICAvLyBuZXh0IHJvdyB3ZW50IG5vd2hlcmUpIC0gdGhlIGVkaXRvciBhbHJlYWR5IHNob3dzIHRoZSBjaGFuZ2UuXG4gICAgICB2aWV3LnBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzRXhjZXB0Py4odmlldyk7XG4gICAgfSxcbiAgfTtcblxuICBjb25zdCBlZGl0b3IgPSBuZXcgRWRpdG9yQ2xhc3MoYXBwLCBvd25lcik7XG4gIGVkaXRvci50eXBQZW5kaW5nRmxvYXRpbmdBZGQgPSBmYWxzZTtcbiAgaWYgKG9uU2hpZnRGb2N1cykgcmVnaXN0ZXJGb2N1c0NoYWluKGVkaXRvciwgb25TaGlmdEZvY3VzKTtcbiAgZWRpdG9yLmNvbnRhaW5lckVsLmFkZENsYXNzKEVESVRPUl9DTEFTUyk7XG4gIGNvbnRhaW5lckVsLmFwcGVuZENoaWxkKGVkaXRvci5jb250YWluZXJFbCk7XG4gIHZpZXcuYWRkQ2hpbGQoZWRpdG9yKTtcblxuICBlZGl0b3Iuc3luY2hyb25pemUoc3RvcmUuZ2V0RnJvbnRtYXR0ZXIoKSk7XG4gIHJlbmRlclNob3J0Y3V0Q29udHJvbHModmlldywgZWRpdG9yLCBzdG9yZSk7XG4gIC8vIE9ubHkgYWZ0ZXIgdGhlIGZpcnN0IHN5bmNocm9uaXplKCkgKHNlZSBnZXRQcm9wZXJ0eVJvd0NsYXNzKS4gQSBuby1vcCBmb3JcbiAgLy8gYSBzdGlsbCBlbXB0eSBUWVA7IHRoZSBuZXh0IG5vbi1lbXB0eSBvbmUgKG9yIGFuIG9wZW4gbm90ZSkgc3VwcGxpZXMgdGhlXG4gIC8vIGNsYXNzLlxuICBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaChhcHAsIGVkaXRvcik7XG4gIHJldHVybiBlZGl0b3I7XG59XG5cbmNvbnN0IENISVBfQ0xBU1MgPSBcInR5cC1zaG9ydGN1dC1jaGlwXCI7XG5jb25zdCBDSElQX1RFWFRfQ0xBU1MgPSBcInR5cC1zaG9ydGN1dC1jaGlwLXRleHRcIjtcbmNvbnN0IEJVVFRPTl9DTEFTUyA9IFwidHlwLXNob3J0Y3V0LWJ1dHRvblwiO1xuY29uc3QgUk9XX0NMQVNTID0gXCJ0eXAtaGFzLXNob3J0Y3V0XCI7XG5jb25zdCBXQVJOSU5HX0NMQVNTID0gXCJ0eXAtc2hvcnRjdXQtYmxvY2tlZFwiO1xuY29uc3QgTUlTU0lOR19DTEFTUyA9IFwidHlwLXNob3J0Y3V0LW1pc3NpbmdcIjtcblxuLy8gVGhlIGJ1dHRvbidzIHRocmVlIGxvb2tzLiBcIm1pc3NpbmdcIjogYSBcInRwLlwiIHNob3J0Y3V0IHdob3NlIFRlbXBsYXRlclxuLy8gc2NyaXB0IGlzIGdvbmUgKGRlbGV0ZWQsIHJlbmFtZWQsIG1hcmtlciByZW1vdmVkKSAtIFRZUC5qcyB3b3VsZCB3cml0ZSB0aGVcbi8vIGZhbGxiYWNrIHZhbHVlLiBTYW1lIHRyaWFuZ2xlIGFzIE9ic2lkaWFuJ3MgdHlwZSB3YXJuaW5nLCBhbmQgYSBjbGlja1xuLy8gcmVtb3ZlcyB0aGUgc2hvcnRjdXQgbGlrZSB0aGUgXCJ4XCIgKHRoZSBjaGlwIHN0aWxsIGNoYW5nZXMgaXQpLlxuY29uc3QgQlVUVE9OX1NUQVRFUyA9IHtcbiAgbm9uZTogeyBpY29uOiBcInNxdWFyZS1mdW5jdGlvblwiLCBsYWJlbDogXCJTZXQgc2hvcnRjdXRcIiB9LFxuICBzZXQ6IHsgaWNvbjogXCJ4XCIsIGxhYmVsOiBcIlJlbW92ZSBzaG9ydGN1dFwiIH0sXG4gIG1pc3Npbmc6IHsgaWNvbjogXCJhbGVydC10cmlhbmdsZVwiLCBsYWJlbDogXCJTY3JpcHQgbm90IGZvdW5kIFx1MjAxMyB0aGUgZmFsbGJhY2sgdmFsdWUgd2lsbCBiZSB1c2VkLiBDbGljayB0byByZW1vdmUgdGhlIHNob3J0Y3V0LlwiIH0sXG59O1xuXG4vLyBCdXR0b24gYW5kIGNoaXAgcGVyIHByb3BlcnR5IHJvdy4gQm90aCBoYW5nIG9uIHRoZSByb3cncyBjb250YWluZXJFbCwgTk9UIGl0c1xuLy8gdmFsdWVFbDogcmVuZGVyUHJvcGVydHkoKSBvbmx5IGV2ZXIgZW1wdGllcyB2YWx1ZUVsLCBzbyBhbnl0aGluZyBhdHRhY2hlZCB0b1xuLy8gY29udGFpbmVyRWwgc3Vydml2ZXMgZXZlcnkgdHlwZSBvciB2YWx1ZSBjaGFuZ2Ugd2l0aG91dCB0b3VjaGluZ1xuLy8gT2JzaWRpYW4ncyByZW5kZXIgcGlwZWxpbmUuXG4vL1xuLy8gVGhlIGJ1dHRvbiB0b2dnbGVzOiB3aXRob3V0IGEgc2hvcnRjdXQgaXQgb3BlbnMgdGhlIHBpY2tlciAoXCJzcXVhcmUtZnVuY3Rpb25cIiksXG4vLyB3aXRoIG9uZSBpdCByZW1vdmVzIGl0IChcInhcIiwgb3IgdGhlIHdhcm5pbmcgdHJpYW5nbGUgaWYgdGhlIHNjcmlwdCBpc1xuLy8gbWlzc2luZyAtIHNlZSBCVVRUT05fU1RBVEVTKS4gVGhlIGNoaXAgaXRzZWxmIGlzIGZvciBDSEFOR0lORyBpdC4gQ1NTIHNob3dzXG4vLyB0aGUgYnV0dG9uIG9ubHkgb24gcm93IGhvdmVyL2ZvY3VzIChhbmQgcGVybWFuZW50bHkgd2hpbGUgYSBzaG9ydGN1dCBpc1xuLy8gc2V0KSAtIG90aGVyd2lzZSBldmVyeSByb3cgd291bGQgY2FycnkgYSBjb250cm9sIG1vc3QgbmV2ZXIgbmVlZC5cbi8vXG4vLyBDYWxsZWQgYWdhaW4gd2hlbmV2ZXIgdGhlIHNjcmlwdCBsaXN0IGNoYW5nZXMgKHNlZSByZWZyZXNoU2hvcnRjdXRDb250cm9sc1xuLy8gaW4gdHlwLXBhbmUuanMpLCBzbyB0aGUgd2FybmluZyBmb2xsb3dzIGEgc2NyaXB0IGJlaW5nIHJlbmFtZWQgb3IgcmVzdG9yZWQuXG4vL1xuLy8gSGlkaW5nIHRoZSB2YWx1ZSBmaWVsZCB3aGlsZSBhIHNob3J0Y3V0IGlzIHNldCBpcyBwdXJlIENTUyAoUk9XX0NMQVNTIGluXG4vLyBzdHlsZXMuY3NzKTsgdGhlIG5hdGl2ZSB3aWRnZXQga2VlcHMgcmVuZGVyaW5nIHVuZGVybmVhdGguIFNldHRpbmcgYW5kXG4vLyByZW1vdmluZyBpcyBqdXN0IGEgY2xhc3MgdG9nZ2xlLCBubyByZW5kZXJQcm9wZXJ0eSgpL3N5bmNocm9uaXplKCkgLSB3aGljaFxuLy8gd291bGQgYmUgcmlza3kgaGVyZSBhbnl3YXkgKHNlZSBzdHJpcFR5cFByb3BlcnR5KS5cbmZ1bmN0aW9uIHJlbmRlclNob3J0Y3V0Q29udHJvbHModmlldywgZWRpdG9yLCBzdG9yZSkge1xuICBjb25zdCBzaG9ydGN1dHMgPSBzdG9yZS5nZXRTaG9ydGN1dHMoKTtcbiAgLy8gQmVmb3JlIHRoZSBzY3JpcHQgZm9sZGVyIHdhcyByZWFkIG9uY2UsIG5vdGhpbmcgY291bnRzIGFzIG1pc3NpbmcgLVxuICAvLyBvdGhlcndpc2UgZXZlcnkgXCJ0cC5cIiBzaG9ydGN1dCB3b3VsZCBmbGFzaCB0aGUgd2FybmluZyBvbiBzdGFydHVwLlxuICBjb25zdCBnZXRTY3JpcHRzID0gdmlldy5wbHVnaW4uZ2V0U2hvcnRjdXRTY3JpcHRzO1xuICBjb25zdCBzY3JpcHROYW1lcyA9IGdldFNjcmlwdHM/LmlzTG9hZGVkPy4oKSA/IG5ldyBTZXQoZ2V0U2NyaXB0cygpLm1hcCgoc2NyaXB0KSA9PiBzY3JpcHQubmFtZSkpIDogbnVsbDtcbiAgZm9yIChjb25zdCByb3cgb2YgZWRpdG9yLnJlbmRlcmVkID8/IFtdKSB7XG4gICAgY29uc3QgY29udGFpbmVyRWwgPSByb3cuY29udGFpbmVyRWw7XG4gICAgY29uc3Qga2V5ID0gcm93LmVudHJ5Py5rZXkgPz8gXCJcIjtcbiAgICAvLyBBbiB1bm5hbWVkIHJvdyBjYW4ndCBjYXJyeSBhIHNob3J0Y3V0IC0gdGhlcmUgaXMgbm8ga2V5IHRvIHN0b3JlIGl0XG4gICAgLy8gdW5kZXIuIFRoZSBidXR0b24gYXBwZWFycyBvbmNlIGl0IGhhcyBhIG5hbWUgKGV2ZXJ5IGNoYW5nZSBwYXNzZXNcbiAgICAvLyB0aHJvdWdoIHNhdmVGcm9udG1hdHRlciBhbmQgc28gdGhyb3VnaCBoZXJlKS5cbiAgICBjb25zdCByZWNvcmQgPSBrZXkgPT09IFwiXCIgPyBudWxsIDogc2hvcnRjdXRzW2tleV0gPz8gbnVsbDtcbiAgICBjb250YWluZXJFbC50b2dnbGVDbGFzcyhST1dfQ0xBU1MsICEhcmVjb3JkKTtcblxuICAgIC8vIE9ic2lkaWFuJ3Mgd2FybmluZyB0cmlhbmdsZSBzaXRzIGFic29sdXRlbHkgYXQgdGhlIHJvdydzIHJpZ2h0IGVkZ2UgLVxuICAgIC8vIGV4YWN0bHkgd2hlcmUgdGhlIHNob3J0Y3V0IGJ1dHRvbiBnb2VzLiBJZiB0aGUgcm93IHNob3dzIGEgdHlwZSB3YXJuaW5nXG4gICAgLy8gYW5kIGhhcyBOTyBzaG9ydGN1dCwgdGhlIGJ1dHRvbiBnaXZlcyB3YXkuIFdpdGggYSBzaG9ydGN1dCBzZXQsIHRoZVxuICAgIC8vIGJ1dHRvbiBzdGF5cyAoaXQgaXMgdGhlIG9ubHkgd2F5IHRvIHJlbW92ZSB0aGUgc2hvcnRjdXQpIGFuZCB0aGVcbiAgICAvLyB0cmlhbmdsZSBnaXZlcyB3YXkgaW5zdGVhZCAoc3R5bGVzLmNzcyk6IGl0IHdvdWxkIHRoZW4gcmVmZXIgdG8gdGhlXG4gICAgLy8gaGlkZGVuIGZhbGxiYWNrIHZhbHVlLCB3aGljaCBjYW4ndCBiZSBmaXhlZCB0aGVyZSBhbnl3YXkuXG4gICAgY29uc3QgbWlzbWF0Y2ggPSAhIXJvdy50eXBlSW5mbyAmJiByb3cudHlwZUluZm8uZXhwZWN0ZWQgIT09IHJvdy50eXBlSW5mby5pbmZlcnJlZDtcbiAgICBjb250YWluZXJFbC50b2dnbGVDbGFzcyhXQVJOSU5HX0NMQVNTLCBtaXNtYXRjaCAmJiAhcmVjb3JkKTtcblxuICAgIGxldCBidXR0b25FbCA9IGNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3IoYDpzY29wZSA+IC4ke0JVVFRPTl9DTEFTU31gKTtcbiAgICBpZiAoa2V5ID09PSBcIlwiKSB7XG4gICAgICBidXR0b25FbD8ucmVtb3ZlKCk7XG4gICAgICBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKGA6c2NvcGUgPiAuJHtDSElQX0NMQVNTfWApPy5yZW1vdmUoKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoIWJ1dHRvbkVsKSB7XG4gICAgICAvLyBJY29uIGFuZCBsYWJlbCBmb2xsb3cgYmVsb3csIHBlciBzdGF0ZS5cbiAgICAgIGJ1dHRvbkVsID0gY29udGFpbmVyRWwuY3JlYXRlRGl2KHsgY2xzOiBgY2xpY2thYmxlLWljb24gJHtCVVRUT05fQ0xBU1N9YCB9KTtcbiAgICAgIC8vIFJlYWQgdGhlIGtleSBvbiBjbGljaywgbm90IGhlcmU6IGEgcmVuYW1lIGNoYW5nZXMgcm93LmVudHJ5LmtleVxuICAgICAgLy8gd2l0aG91dCByZWNyZWF0aW5nIHRoZSByb3cuXG4gICAgICBidXR0b25FbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgICBpZiAoc3RvcmUuZ2V0U2hvcnRjdXRzKClbcm93LmVudHJ5Py5rZXkgPz8gXCJcIl0pIHJlbW92ZVNob3J0Y3V0KHZpZXcsIGVkaXRvciwgc3RvcmUsIHJvdyk7XG4gICAgICAgIGVsc2Ugb3BlblNob3J0Y3V0UGlja2VyKHZpZXcsIGVkaXRvciwgc3RvcmUsIHJvdyk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgY29uc3Qgc2NyaXB0TmFtZSA9IHJlY29yZCA/IHNjcmlwdE5hbWVPZihyZWNvcmQubmFtZSkgOiBudWxsO1xuICAgIGNvbnN0IG1pc3NpbmcgPSBzY3JpcHROYW1lICE9PSBudWxsICYmIHNjcmlwdE5hbWVzICE9PSBudWxsICYmICFzY3JpcHROYW1lcy5oYXMoc2NyaXB0TmFtZSk7XG4gICAgY29uc3Qgc3RhdGUgPSAhcmVjb3JkID8gXCJub25lXCIgOiBtaXNzaW5nID8gXCJtaXNzaW5nXCIgOiBcInNldFwiO1xuICAgIC8vIE9ubHkgb24gYSBjaGFuZ2U6IHNldEljb24gd291bGQgcmVwbGFjZSB0aGUgU1ZHIG9uIGV2ZXJ5IGNhbGwuXG4gICAgaWYgKGJ1dHRvbkVsLmRhdGFzZXQudHlwU3RhdGUgIT09IHN0YXRlKSB7XG4gICAgICBidXR0b25FbC5kYXRhc2V0LnR5cFN0YXRlID0gc3RhdGU7XG4gICAgICBzZXRJY29uKGJ1dHRvbkVsLCBCVVRUT05fU1RBVEVTW3N0YXRlXS5pY29uKTtcbiAgICAgIGJ1dHRvbkVsLnNldEF0dHIoXCJhcmlhLWxhYmVsXCIsIEJVVFRPTl9TVEFURVNbc3RhdGVdLmxhYmVsKTtcbiAgICAgIGJ1dHRvbkVsLnRvZ2dsZUNsYXNzKE1JU1NJTkdfQ0xBU1MsIHN0YXRlID09PSBcIm1pc3NpbmdcIik7XG4gICAgfVxuXG4gICAgbGV0IGNoaXBFbCA9IGNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3IoYDpzY29wZSA+IC4ke0NISVBfQ0xBU1N9YCk7XG4gICAgaWYgKCFyZWNvcmQpIHtcbiAgICAgIGNoaXBFbD8ucmVtb3ZlKCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKCFjaGlwRWwpIHtcbiAgICAgIGNoaXBFbCA9IGNyZWF0ZUVsKFwiY29kZVwiLCB7IGNsczogQ0hJUF9DTEFTUyB9KTtcbiAgICAgIC8vIFRleHQgaW4gaXRzIG93biBzcGFuOiB0aGUgY2hpcCBpcyBhIGZsZXggY29udGFpbmVyICh2ZXJ0aWNhbFxuICAgICAgLy8gY2VudGVyaW5nIGxpa2UgdGhlIHJlYWwgdmFsdWUgZmllbGQpLCBhbmQgdGV4dC1vdmVyZmxvdzogZWxsaXBzaXNcbiAgICAgIC8vIG9ubHkgd29ya3Mgb24gYSBibG9jayBlbGVtZW50LlxuICAgICAgY2hpcEVsLmNyZWF0ZVNwYW4oeyBjbHM6IENISVBfVEVYVF9DTEFTUyB9KTtcbiAgICAgIGNoaXBFbC5zZXRBdHRyKFwiYXJpYS1sYWJlbFwiLCBcIkNoYW5nZSBzaG9ydGN1dFwiKTtcbiAgICAgIGNoaXBFbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gb3BlblNob3J0Y3V0UGlja2VyKHZpZXcsIGVkaXRvciwgc3RvcmUsIHJvdykpO1xuICAgICAgLy8gQmVmb3JlIHRoZSBidXR0b24sIHNvIHRoZSByb3cgYWx3YXlzIHJlYWRzIFwibmFtZSB8IGNoaXAgfCBidXR0b25cIi5cbiAgICAgIGNvbnRhaW5lckVsLmluc2VydEJlZm9yZShjaGlwRWwsIGJ1dHRvbkVsKTtcbiAgICB9XG4gICAgY2hpcEVsLmZpcnN0RWxlbWVudENoaWxkLnNldFRleHQoc2hvcnRjdXRMYWJlbChyZWNvcmQpKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBvcGVuU2hvcnRjdXRQaWNrZXIodmlldywgZWRpdG9yLCBzdG9yZSwgcm93KSB7XG4gIGNvbnN0IGtleSA9IHJvdy5lbnRyeT8ua2V5ID8/IFwiXCI7XG4gIGlmIChrZXkgPT09IFwiXCIpIHJldHVybjtcbiAgLy8gUGFzc2luZyB0aGUgY3VycmVudCByZWNvcmQgcHJlZmlsbHMgdGhlIGFyZ3VtZW50IGRpYWxvZyB3aGVuIHRoZSBzYW1lXG4gIC8vIHNjcmlwdCBpcyBwaWNrZWQgYWdhaW4gLSB0aGF0IGlzIGhvdyBzaW5nbGUgYXJndW1lbnRzIGdldCBjb3JyZWN0ZWQuXG4gIGNvbnN0IHJlY29yZCA9IGF3YWl0IHBpY2tTaG9ydGN1dCh2aWV3LmFwcCwga2V5LCB2aWV3LnBsdWdpbi5nZXRTaG9ydGN1dFNjcmlwdHMsIHN0b3JlLmdldFNob3J0Y3V0cygpW2tleV0gPz8gbnVsbCk7XG4gIGlmICghcmVjb3JkKSByZXR1cm47XG4gIC8vIFRoZSBwcm9wZXJ0eSBtYXkgaGF2ZSB2YW5pc2hlZCB3aGlsZSB0aGUgZGlhbG9nIHdhcyBvcGVuICh2aWV3IHJlYnVpbHQpLlxuICAvLyBXaXRob3V0IHRoaXMgY2hlY2sgdGhlIHNob3J0Y3V0IHdvdWxkIGJlIGFuIGludmlzaWJsZSBvcnBoYW4gaW4gdGhlXG4gIC8vIHNldHRpbmdzIHRoYXQgbm90aGluZyBldmVyIGNsZWFucyB1cC5cbiAgaWYgKCFPYmplY3QuaGFzT3duKHN0b3JlLmdldEZyb250bWF0dGVyKCksIGtleSkpIHJldHVybjtcbiAgc3RvcmUuc2V0U2hvcnRjdXRzKHsgLi4uc3RvcmUuZ2V0U2hvcnRjdXRzKCksIFtrZXldOiByZWNvcmQgfSk7XG4gIHNhdmVTaG9ydGN1dHModmlldywgZWRpdG9yLCBzdG9yZSk7XG59XG5cbmZ1bmN0aW9uIHJlbW92ZVNob3J0Y3V0KHZpZXcsIGVkaXRvciwgc3RvcmUsIHJvdykge1xuICBjb25zdCBrZXkgPSByb3cuZW50cnk/LmtleSA/PyBcIlwiO1xuICBjb25zdCBzaG9ydGN1dHMgPSB7IC4uLnN0b3JlLmdldFNob3J0Y3V0cygpIH07XG4gIGlmICghKGtleSBpbiBzaG9ydGN1dHMpKSByZXR1cm47XG4gIGNvbnN0IHNuYXBzaG90ID0gc25hcHNob3RTZXR0aW5ncyh2aWV3LnBsdWdpbik7XG4gIGRlbGV0ZSBzaG9ydGN1dHNba2V5XTtcbiAgc3RvcmUuc2V0U2hvcnRjdXRzKHNob3J0Y3V0cyk7XG4gIHNhdmVTaG9ydGN1dHModmlldywgZWRpdG9yLCBzdG9yZSk7XG4gIG9mZmVyVW5kbyh2aWV3LnBsdWdpbiwgYFNob3J0Y3V0IHJlbW92ZWQgZnJvbSBcIiR7a2V5fVwiLmAsIHNuYXBzaG90KTtcbn1cblxuZnVuY3Rpb24gc2F2ZVNob3J0Y3V0cyh2aWV3LCBlZGl0b3IsIHN0b3JlKSB7XG4gIHZpZXcucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICByZW5kZXJTaG9ydGN1dENvbnRyb2xzKHZpZXcsIGVkaXRvciwgc3RvcmUpO1xufVxuXG4vLyBBIHNpbXBsZSBcImFkZCBwcm9wZXJ0eVwiIGluc3RlYWQgb2YgdGhlIGludGVybmFsIGVkaXRvci5hZGRQcm9wZXJ0eSgpOiBhZGRzXG4vLyBhbiBlbXB0eSBrZXkgd2l0aCB2YWx1ZSBudWxsIGFuZCBsZXRzIHRoZSB3aWRnZXQgcmVuZGVyIGl0IG5vcm1hbGx5IChzYW1lXG4vLyBsb29rIGFzIGluIGEgbm90ZSwgc2luY2Ugc3luY2hyb25pemUoKSBydW5zIE9ic2lkaWFuJ3Mgb3duIHBpcGVsaW5lKSwgdGhlblxuLy8gZm9jdXNlcyB0aGUgbmV3IGtleSBmaWVsZC5cbmZ1bmN0aW9uIGFkZEJsYW5rUHJvcGVydHkoZWRpdG9yKSB7XG4gIGlmICghZWRpdG9yKSByZXR1cm47XG4gIGNvbnN0IGN1cnJlbnQgPSBlZGl0b3Iuc2VyaWFsaXplKCk7XG4gIGlmICghY3VycmVudC5oYXNPd25Qcm9wZXJ0eShcIlwiKSkge1xuICAgIGN1cnJlbnRbXCJcIl0gPSBudWxsO1xuICAgIGVkaXRvci5zeW5jaHJvbml6ZShjdXJyZW50KTtcbiAgICAvLyBFeGlzdGluZyByb3dzIGtlZXAgdGhlaXIgYnV0dG9uIChpdCBzaXRzIG9uIGNvbnRhaW5lckVsKSwgdGhlIG5ldyBvbmVcbiAgICAvLyBuZWVkcyBvbmUuXG4gICAgcmVuZGVyU2hvcnRjdXRDb250cm9scyhlZGl0b3Iub3duZXIudHlwUGFuZSwgZWRpdG9yLCBlZGl0b3Iub3duZXIudHlwU3RvcmUpO1xuICB9XG4gIGVkaXRvci5mb2N1c0tleShcIlwiKTtcbiAgLy8gQ292ZXJzIHRoZSBjYXNlIHdoZXJlIG1vdW50RnJvbnRtYXR0ZXJFZGl0b3IoKSBmb3VuZCBubyByb3cgY2xhc3MgdG8gcGF0Y2hcbiAgLy8gKGVtcHR5IFRZUCwgbm8gb3BlbiBub3RlKSAtIG5vdyB0aGVyZSBpcyBhdCBsZWFzdCBvbmUgcm93LlxuICBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaChlZGl0b3Iub3duZXIuYXBwLCBlZGl0b3IpO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgbW91bnRGcm9udG1hdHRlckVkaXRvcixcbiAgYWRkQmxhbmtQcm9wZXJ0eSxcbiAgcmVuZGVyU2hvcnRjdXRDb250cm9scyxcbiAgZW5zdXJlUHJvcGVydHlNZW51UGF0Y2gsXG4gIHJlbW92ZVByb3BlcnR5TWVudVBhdGNoLFxuICB0eXBTdG9yZSxcbiAgc3VidHlwU3RvcmUsXG59O1xuIiwgImNvbnN0IHsgbW91bnRGcm9udG1hdHRlckVkaXRvciwgYWRkQmxhbmtQcm9wZXJ0eSwgdHlwU3RvcmUsIHN1YnR5cFN0b3JlIH0gPSByZXF1aXJlKFwiLi90eXAtZnJvbnRtYXR0ZXItZWRpdG9yXCIpO1xuY29uc3QgeyBnZXRTZWN0aW9uT3JkZXIsIGlzRW1wdHlWYWx1ZSB9ID0gcmVxdWlyZShcIi4vc3VidHlwc1wiKTtcblxuLyogPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gKiBUaGUgZnJvbnRtYXR0ZXIgYmxvY2tzIG9mIGEgVFlQIGluIHRoZSBUWVAtUGFuZSBkZXRhaWwgKHNlZVxuICogcmVuZGVyVHlwU2V0dGluZ3MgaW4gdHlwLXBhbmUuanMpOiB0aGUgVFlQLUZyb250bWF0dGVyIG9uIHRvcCxcbiAqIGJlbG93IGl0IG9uZSBibG9jayBwZXIgcmVnaXN0ZXJlZCBTdWJ0eXAuXG4gKlxuICogRWFjaCBibG9jayBoYXMgaXRzIG93biBpbnN0YW5jZSBvZiBPYnNpZGlhbidzIHByb3BlcnR5IGVkaXRvcixcbiAqIGJvdW5kIHRvIHR5cFN0b3JlIG9yIHN1YnR5cFN0b3JlIChzZWUgdHlwLWZyb250bWF0dGVyLWVkaXRvci5qcykuXG4gKiBUaGF0IGlzIHdoYXQgbGV0cyB0aGUgc2FtZSBrZXkgYXBwZWFyIGluIHNldmVyYWwgYmxvY2tzIC0gb25lXG4gKiBzaGFyZWQgZWRpdG9yIHdvdWxkIGhvbGQgZXZlcnl0aGluZyBpbiBhIHNpbmdsZSBmbGF0IG9iamVjdC5cbiAqXG4gKiBPYnNpZGlhbidzIHJvdyBkcmFnIG9ubHkgd29ya3Mgd2l0aGluIG9uZSBpbnN0YW5jZSwgc29cbiAqIHJlZ2lzdGVyUHJvcGVydHlEcmFnKCkgYmVsb3cgYnVpbGRzIG9uIHRoYXQgZHJhZyB0byBtb3ZlIGFcbiAqIHByb3BlcnR5IGJldHdlZW4gYmxvY2tzLiBLZXlib2FyZCBuYXZpZ2F0aW9uIGFjcm9zcyBibG9ja3MgaXNcbiAqIHJlZ2lzdGVyRm9jdXNDaGFpbigpIGluIHR5cC1mcm9udG1hdHRlci1lZGl0b3IuanMuXG4gKlxuICogU2VjdGlvbjogbnVsbCA9IFRZUC1Gcm9udG1hdHRlciwgb3RoZXJ3aXNlIHRoZSBTdWJ0eXAgbmFtZS5cbiAqID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PSAqL1xuXG4vLyBBIHdob2xlIGJsb2NrIGNhbiBiZSBncmFiYmVkIGFueXdoZXJlIG91dHNpZGUgaXRzIHByb3BlcnR5IHJvd3MgLSBoZWFkaW5nLFxuLy8gZm9vdGVyLCBzaWRlIG1hcmdpbnMuIENvbnRyb2xzIGFuZCBhIHRpdGxlIGJlaW5nIGVkaXRlZCBhcmUgZXhjbHVkZWQuXG5mdW5jdGlvbiBpc0dyYWJUYXJnZXQodGFyZ2V0KSB7XG4gIGlmICh0YXJnZXQuY2xvc2VzdChcIi5jbGlja2FibGUtaWNvbiwgLnR5cC1zdWJ0eXAtY29sb3ItZG90LCBbY29udGVudGVkaXRhYmxlPSd0cnVlJ10sIGlucHV0LCB0ZXh0YXJlYVwiKSkgcmV0dXJuIGZhbHNlO1xuICByZXR1cm4gIXRhcmdldC5jbG9zZXN0KFwiLm1ldGFkYXRhLXByb3BlcnR5XCIpO1xufVxuXG4vLyByZW5kZXJIZWFkZXIoc2VjdGlvbiwgZWwsIGJsb2NrcykgLyByZW5kZXJGb290ZXIoc2VjdGlvbiwgZWwsIGJsb2NrcykgZmlsbCBhXG4vLyBibG9jaydzIGhlYWRpbmcgYW5kIGZvb3Rlci4gb25Nb3ZlU2VjdGlvbihvcmRlcikgcmVwb3J0cyB0aGUgbmV3IGJsb2NrIG9yZGVyXG4vLyBhZnRlciBhIGJsb2NrIGRyYWcgKHNoYXBlZCBsaWtlIGdldFNlY3Rpb25PcmRlciwgbGVhZGluZyBudWxsIGluY2x1ZGVkKS5cbmZ1bmN0aW9uIG1vdW50RnJvbnRtYXR0ZXJCbG9ja3ModmlldywgY29udGFpbmVyRWwsIHR5cCwgeyByZW5kZXJIZWFkZXIsIHJlbmRlckZvb3Rlciwgb25Nb3ZlU2VjdGlvbiB9KSB7XG4gIGNvbnN0IHdyYXBwZXIgPSBjb250YWluZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWJsb2Nrc1wiIH0pO1xuICBjb25zdCBzZWN0aW9ucyA9IGdldFNlY3Rpb25PcmRlcih2aWV3LnBsdWdpbi5zZXR0aW5ncywgdHlwKTtcbiAgY29uc3QgZWRpdG9ycyA9IG5ldyBNYXAoKTtcbiAgY29uc3QgYmxvY2tFbHMgPSBuZXcgTWFwKCk7XG4gIGNvbnN0IHN0b3JlcyA9IG5ldyBNYXAoKTtcblxuICBjb25zdCBhcGkgPSB7XG4gICAgLy8gQWxsIGVkaXRvciBpbnN0YW5jZXMgaW4gYmxvY2sgb3JkZXI7IHR5cC1wYW5lLmpzIGFkZHMgdGhlbSBhcyBjb21wb25lbnRcbiAgICAvLyBjaGlsZHJlbiBhbmQgdW5sb2FkcyB0aGVtIGJlZm9yZSBlYWNoIHJlYnVpbGQuXG4gICAgZWRpdG9yczogW10sXG4gICAgLy8gQWRkcyBhIGJsYW5rIHJvdyBhdCB0aGUgZW5kIG9mIHRoZSBibG9jayB3aXRoIGZvY3VzIGluIHRoZSBrZXkgZmllbGRcbiAgICAvLyAoc2VlIGFkZEJsYW5rUHJvcGVydHkpLiBmbG9hdGluZyBtYXJrcyB0aGUgbmV4dCBuYW1lZCBwcm9wZXJ0eSBhc1xuICAgIC8vIGZsb2F0aW5nLlxuICAgIGFkZEJsYW5rKHNlY3Rpb24sIGZsb2F0aW5nID0gZmFsc2UpIHtcbiAgICAgIGNvbnN0IGVkaXRvciA9IGVkaXRvcnMuZ2V0KHNlY3Rpb24pO1xuICAgICAgaWYgKCFlZGl0b3IpIHJldHVybjtcbiAgICAgIGVkaXRvci50eXBQZW5kaW5nRmxvYXRpbmdBZGQgPSBmbG9hdGluZztcbiAgICAgIGFkZEJsYW5rUHJvcGVydHkoZWRpdG9yKTtcbiAgICB9LFxuICB9O1xuXG4gIC8vIE5leHQgYmxvY2sgaW4gZGlyZWN0aW9uIHN0ZXAgdGhhdCBoYXMgYSByb3cgdG8ganVtcCB0bzsgZW1wdHkgYmxvY2tzIGFyZVxuICAvLyBza2lwcGVkLlxuICBjb25zdCBmb2N1c05laWdoYm9yID0gKHNlY3Rpb24sIHN0ZXApID0+IHtcbiAgICBmb3IgKGxldCBpID0gc2VjdGlvbnMuaW5kZXhPZihzZWN0aW9uKSArIHN0ZXA7IGkgPj0gMCAmJiBpIDwgc2VjdGlvbnMubGVuZ3RoOyBpICs9IHN0ZXApIHtcbiAgICAgIGNvbnN0IGVkaXRvciA9IGVkaXRvcnMuZ2V0KHNlY3Rpb25zW2ldKTtcbiAgICAgIGlmICghZWRpdG9yIHx8IGVkaXRvci5yZW5kZXJlZC5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuICAgICAgZWRpdG9yLmZvY3VzUHJvcGVydHlBdEluZGV4KHN0ZXAgPiAwID8gMCA6IC0xKTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH07XG5cbiAgZm9yIChjb25zdCBzZWN0aW9uIG9mIHNlY3Rpb25zKSB7XG4gICAgY29uc3QgaXNTdWIgPSBzZWN0aW9uICE9PSBudWxsO1xuICAgIGNvbnN0IGJsb2NrRWwgPSB3cmFwcGVyLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwidHlwLWJsb2NrXCIgKyAoaXNTdWIgPyBcIiB0eXAtZnJvbnRtYXR0ZXItYmxvY2sgdHlwLXN1YnR5cC1ibG9ja1wiIDogXCJcIiksXG4gICAgfSk7XG4gICAgYmxvY2tFbHMuc2V0KHNlY3Rpb24sIGJsb2NrRWwpO1xuICAgIGJsb2NrRWwudHlwU2VjdGlvbiA9IHNlY3Rpb247XG5cbiAgICBjb25zdCBoZWFkZXIgPSBibG9ja0VsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZnJvbnRtYXR0ZXItaGVhZGVyIHR5cC1zZWN0aW9uLWhlYWRlclwiIH0pO1xuICAgIGhlYWRlci50b2dnbGVDbGFzcyhcInR5cC1zZWN0aW9uLXN1YlwiLCBpc1N1Yik7XG5cbiAgICBjb25zdCBzdG9yZSA9IHNlY3Rpb24gPT09IG51bGwgPyB0eXBTdG9yZSh2aWV3LnBsdWdpbiwgdHlwKSA6IHN1YnR5cFN0b3JlKHZpZXcucGx1Z2luLCB0eXAsIHNlY3Rpb24pO1xuICAgIHN0b3Jlcy5zZXQoc2VjdGlvbiwgc3RvcmUpO1xuICAgIGNvbnN0IGVkaXRvciA9IG1vdW50RnJvbnRtYXR0ZXJFZGl0b3IodmlldywgYmxvY2tFbCwgc3RvcmUsIHtcbiAgICAgIG9uU2hpZnRGb2N1czogKHN0ZXApID0+IGZvY3VzTmVpZ2hib3Ioc2VjdGlvbiwgc3RlcCksXG4gICAgfSk7XG4gICAgaWYgKGVkaXRvcikge1xuICAgICAgZWRpdG9ycy5zZXQoc2VjdGlvbiwgZWRpdG9yKTtcbiAgICAgIGFwaS5lZGl0b3JzLnB1c2goZWRpdG9yKTtcbiAgICB9XG5cbiAgICBjb25zdCBmb290ZXIgPSBibG9ja0VsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtc2VjdGlvbi1mb290ZXJcIiB9KTtcbiAgICBmb290ZXIudG9nZ2xlQ2xhc3MoXCJ0eXAtc2VjdGlvbi1zdWJcIiwgaXNTdWIpO1xuICAgIHJlbmRlckhlYWRlcihzZWN0aW9uLCBoZWFkZXIsIGFwaSk7XG4gICAgcmVuZGVyRm9vdGVyPy4oc2VjdGlvbiwgZm9vdGVyLCBhcGkpO1xuXG4gICAgaWYgKCFpc1N1YikgY29udGludWU7XG4gICAgYmxvY2tFbC5hZGRFdmVudExpc3RlbmVyKFwibW91c2Vkb3duXCIsIChldmVudCkgPT4gc3RhcnRCbG9ja0RyYWcoZXZlbnQsIHNlY3Rpb24pKTtcbiAgfVxuXG4gIC8vIE1vdXNlIGRyYWcgaW5zdGVhZCBvZiBIVE1MNSBkcmFnZ2FibGU6IGEgZHJhZ2dhYmxlIGFuY2VzdG9yIGJyb2tlIHRleHRcbiAgLy8gc2VsZWN0aW9uIGluIHRoZSByb3cgaW5wdXRzLiBTdGFydHMgYWZ0ZXIgYSBmZXcgcGl4ZWxzOyBhbiBhY2NlbnQgbGluZVxuICAvLyBzaG93cyB0aGUgdGFyZ2V0IGdhcCwgRXNjYXBlIGNhbmNlbHMuIFRoZSBUWVAtRnJvbnRtYXR0ZXIgaXMgZml4ZWQgb24gdG9wXG4gIC8vIChzZWUgZ2V0U2VjdGlvbk9yZGVyKSwgc28gdGFyZ2V0IDAgZG9lc24ndCBleGlzdC5cbiAgZnVuY3Rpb24gc3RhcnRCbG9ja0RyYWcoZXZlbnQsIHNlY3Rpb24pIHtcbiAgICBpZiAoZXZlbnQuYnV0dG9uICE9PSAwIHx8ICFpc0dyYWJUYXJnZXQoZXZlbnQudGFyZ2V0KSkgcmV0dXJuO1xuICAgIGNvbnN0IHdpbiA9IHdyYXBwZXIud2luO1xuICAgIGNvbnN0IHN0YXJ0WSA9IGV2ZW50LmNsaWVudFk7XG4gICAgbGV0IGRyYWdnaW5nID0gZmFsc2U7XG4gICAgbGV0IGluZGljYXRvciA9IG51bGw7XG4gICAgbGV0IGJveGVzID0gW107XG4gICAgbGV0IHRhcmdldEluZGV4ID0gbnVsbDtcblxuICAgIGNvbnN0IG1lYXN1cmUgPSAoKSA9PiB7XG4gICAgICBjb25zdCBiYXNlID0gd3JhcHBlci5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgIGJveGVzID0gc2VjdGlvbnMubWFwKChuYW1lKSA9PiB7XG4gICAgICAgIGNvbnN0IHJlY3QgPSBibG9ja0Vscy5nZXQobmFtZSkuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICAgIHJldHVybiB7IHNlY3Rpb246IG5hbWUsIHRvcDogcmVjdC50b3AgLSBiYXNlLnRvcCwgYm90dG9tOiByZWN0LmJvdHRvbSAtIGJhc2UudG9wIH07XG4gICAgICB9KTtcbiAgICB9O1xuXG4gICAgY29uc3Qgb25Nb3ZlID0gKG1vdmVFdmVudCkgPT4ge1xuICAgICAgaWYgKCFkcmFnZ2luZykge1xuICAgICAgICBpZiAoTWF0aC5hYnMobW92ZUV2ZW50LmNsaWVudFkgLSBzdGFydFkpIDwgNCkgcmV0dXJuO1xuICAgICAgICBkcmFnZ2luZyA9IHRydWU7XG4gICAgICAgIHdyYXBwZXIuZG9jLmJvZHkuYWRkQ2xhc3MoXCJ0eXAtYmxvY2stZHJhZ2dpbmdcIik7XG4gICAgICAgIHdpbi5nZXRTZWxlY3Rpb24oKT8ucmVtb3ZlQWxsUmFuZ2VzKCk7XG4gICAgICAgIGJsb2NrRWxzLmdldChzZWN0aW9uKS5hZGRDbGFzcyhcImlzLWRyYWdnaW5nXCIpO1xuICAgICAgICBtZWFzdXJlKCk7XG4gICAgICAgIGluZGljYXRvciA9IHdyYXBwZXIuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1ibG9jay1kcm9wLWluZGljYXRvclwiIH0pO1xuICAgICAgfVxuICAgICAgbW92ZUV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBjb25zdCB5ID0gbW92ZUV2ZW50LmNsaWVudFkgLSB3cmFwcGVyLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpLnRvcDtcbiAgICAgIHRhcmdldEluZGV4ID0gTWF0aC5tYXgoMSwgYm94ZXMuZmlsdGVyKChib3gpID0+IChib3gudG9wICsgYm94LmJvdHRvbSkgLyAyIDwgeSkubGVuZ3RoKTtcbiAgICAgIGNvbnN0IGZyb20gPSBib3hlcy5maW5kSW5kZXgoKGJveCkgPT4gYm94LnNlY3Rpb24gPT09IHNlY3Rpb24pO1xuICAgICAgaW5kaWNhdG9yLnRvZ2dsZSh0YXJnZXRJbmRleCAhPT0gZnJvbSAmJiB0YXJnZXRJbmRleCAhPT0gZnJvbSArIDEpO1xuICAgICAgLy8gTWlkZGxlIG9mIHRoZSBnYXAgYmV0d2VlbiB0d28gYmxvY2tzIChzZWUgLnR5cC1ibG9jayArIC50eXAtYmxvY2sgaW5cbiAgICAgIC8vIHN0eWxlcy5jc3MpLlxuICAgICAgY29uc3QgaGFsZkdhcCA9IDY7XG4gICAgICBjb25zdCBnYXBZID1cbiAgICAgICAgdGFyZ2V0SW5kZXggPT09IGJveGVzLmxlbmd0aFxuICAgICAgICAgID8gYm94ZXNbYm94ZXMubGVuZ3RoIC0gMV0uYm90dG9tICsgaGFsZkdhcFxuICAgICAgICAgIDogKGJveGVzW3RhcmdldEluZGV4IC0gMV0uYm90dG9tICsgYm94ZXNbdGFyZ2V0SW5kZXhdLnRvcCkgLyAyO1xuICAgICAgaW5kaWNhdG9yLnN0eWxlLnRvcCA9IGAke2dhcFkgLSAxfXB4YDtcbiAgICB9O1xuXG4gICAgY29uc3QgZW5kID0gKGNvbW1pdCkgPT4ge1xuICAgICAgd2luLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJtb3VzZW1vdmVcIiwgb25Nb3ZlKTtcbiAgICAgIHdpbi5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2V1cFwiLCBvblVwKTtcbiAgICAgIHdpbi5yZW1vdmVFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCBvbktleSwgdHJ1ZSk7XG4gICAgICBpZiAoIWRyYWdnaW5nKSByZXR1cm47XG4gICAgICB3cmFwcGVyLmRvYy5ib2R5LnJlbW92ZUNsYXNzKFwidHlwLWJsb2NrLWRyYWdnaW5nXCIpO1xuICAgICAgYmxvY2tFbHMuZ2V0KHNlY3Rpb24pLnJlbW92ZUNsYXNzKFwiaXMtZHJhZ2dpbmdcIik7XG4gICAgICBpbmRpY2F0b3I/LnJlbW92ZSgpO1xuXG4gICAgICBjb25zdCBvcmRlciA9IGJveGVzLm1hcCgoYm94KSA9PiBib3guc2VjdGlvbik7XG4gICAgICBjb25zdCBmcm9tID0gb3JkZXIuaW5kZXhPZihzZWN0aW9uKTtcbiAgICAgIGlmICghY29tbWl0IHx8IHRhcmdldEluZGV4ID09PSBudWxsIHx8IHRhcmdldEluZGV4ID09PSBmcm9tIHx8IHRhcmdldEluZGV4ID09PSBmcm9tICsgMSkgcmV0dXJuO1xuICAgICAgb3JkZXIuc3BsaWNlKGZyb20sIDEpO1xuICAgICAgb3JkZXIuc3BsaWNlKGZyb20gPCB0YXJnZXRJbmRleCA/IHRhcmdldEluZGV4IC0gMSA6IHRhcmdldEluZGV4LCAwLCBzZWN0aW9uKTtcbiAgICAgIG9uTW92ZVNlY3Rpb24/LihvcmRlcik7XG4gICAgfTtcbiAgICBjb25zdCBvblVwID0gKCkgPT4gZW5kKHRydWUpO1xuICAgIGNvbnN0IG9uS2V5ID0gKGtleUV2ZW50KSA9PiB7XG4gICAgICBpZiAoa2V5RXZlbnQua2V5ICE9PSBcIkVzY2FwZVwiKSByZXR1cm47XG4gICAgICBrZXlFdmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAga2V5RXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICBlbmQoZmFsc2UpO1xuICAgIH07XG4gICAgd2luLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZW1vdmVcIiwgb25Nb3ZlKTtcbiAgICB3aW4uYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNldXBcIiwgb25VcCk7XG4gICAgd2luLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIG9uS2V5LCB0cnVlKTtcbiAgfVxuXG4gIHJlZ2lzdGVyUHJvcGVydHlEcmFnKCk7XG4gIHJldHVybiBhcGk7XG5cbiAgLyogLS0tIERyYWdnaW5nIGEgcHJvcGVydHkgaW50byBhbm90aGVyIGJsb2NrIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICogQnVpbHQgb24gT2JzaWRpYW4ncyBvd24gcm93IGRyYWcgcmF0aGVyIHRoYW4gYSBzZWNvbmQgb25lIG5leHQgdG8gaXQ6XG4gICAqIGl0IHN0YXJ0cyBhdCB0aGUgcm93J3MgdHlwZSBpY29uLCBwdXRzIGEgLmRyYWctcmVvcmRlci1naG9zdCBvbiB0aGVcbiAgICogYm9keSAoc28gaXQgZm9sbG93cyB0aGUgY3Vyc29yIGFjcm9zcyBibG9ja3MgYW55d2F5KSBhbmQgbWFya3MgdGhlXG4gICAqIHNvdXJjZSByb3cgd2l0aCAuZHJhZy1naG9zdC1oaWRkZW4sIHRoZSBhY2NlbnQgYm94IHNob3dpbmcgdGhlIGRyb3BcbiAgICogc3BvdC4gV2l0aGluIG9uZSBibG9jayBPYnNpZGlhbiBkb2VzIGV2ZXJ5dGhpbmcgYXMgdXN1YWwuIEFkZGVkIGhlcmU6XG4gICAqXG4gICAqICAtIGFuIGVtcHR5IGV4dHJhIGNoaWxkIGluIHRoZSBsaXN0IHdoaWxlIGRyYWdnaW5nOiBvdGhlcndpc2UgT2JzaWRpYW5cbiAgICogICAgZG9lc24ndCBzdGFydCB0aGUgZHJhZyBpbiBhIGJsb2NrIHdpdGggYSBzaW5nbGUgcm93IChpdHMgbW91c2Vkb3duXG4gICAqICAgIGNoZWNrcyBuLmZpcnN0Q2hpbGQgIT09IG4ubGFzdENoaWxkKTtcbiAgICogIC0gYSBwbGFjZWhvbGRlciB3aXRoIHRoZSBzYW1lIC5kcmFnLWdob3N0LWhpZGRlbiBjbGFzcyBpbiB0aGUgdGFyZ2V0XG4gICAqICAgIGJsb2NrIG9uY2UgdGhlIGN1cnNvciByZWFjaGVzIGFub3RoZXIgYmxvY2s7IHRoZSBzb3VyY2Ugcm93IGlzXG4gICAqICAgIGhpZGRlbiBtZWFud2hpbGUgc28gdGhlcmUgYXJlbid0IHR3byBib3hlcztcbiAgICogIC0gYSByZW9yZGVyS2V5IHBlciBpbnN0YW5jZSB0aGF0IG1vdmVzIHRoZSBwcm9wZXJ0eSB0byB0aGUgb3RoZXJcbiAgICogICAgYmxvY2sgb24gZHJvcCBpbnN0ZWFkIG9mIHNvcnRpbmcgd2l0aGluIGl0cyBvd24uXG4gICAqXG4gICAqIE91ciBoYW5kbGVycyBydW4gaW4gdGhlIGNhcHR1cmUgcGhhc2Ugb24gdGhlIHdpbmRvdywgYmVmb3JlIE9ic2lkaWFuJ3NcbiAgICogKHdoaWNoIGl0IGFkZHMgdG8gd2luZG93IGluIGl0cyBtb3VzZWRvd24gaGFuZGxlcikuXG4gICAqIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tICovXG4gIGZ1bmN0aW9uIHJlZ2lzdGVyUHJvcGVydHlEcmFnKCkge1xuICAgIC8vIFdpdGhvdXQgYSBzZWNvbmQgYmxvY2sgdGhlcmUgaXMgbm8gdGFyZ2V0OyBPYnNpZGlhbidzIGRyYWcgc3RheXMgYXMgaXMuXG4gICAgY29uc3QgYW5jaG9yID0gYXBpLmVkaXRvcnNbMF07XG4gICAgaWYgKCFhbmNob3IgfHwgc2VjdGlvbnMubGVuZ3RoIDwgMikgcmV0dXJuO1xuXG4gICAgLy8gU3RhdGUgb2YgYSBydW5uaW5nIGRyYWc7IGRyb3Aga2VlcHMgdGhlIHRhcmdldCBmb3IgdGhlIHJlb3JkZXJLZXkgY2FsbFxuICAgIC8vIHRoYXQgZm9sbG93cyB0aGUgbW91c2V1cC5cbiAgICBsZXQgZHJhZyA9IG51bGw7XG4gICAgbGV0IGRyb3AgPSBudWxsO1xuXG4gICAgY29uc3Qgc2VjdGlvbkF0ID0gKGNsaWVudFkpID0+XG4gICAgICBzZWN0aW9ucy5maW5kKChzZWN0aW9uKSA9PiB7XG4gICAgICAgIGNvbnN0IHJlY3QgPSBibG9ja0Vscy5nZXQoc2VjdGlvbikuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICAgIHJldHVybiBjbGllbnRZID49IHJlY3QudG9wICYmIGNsaWVudFkgPD0gcmVjdC5ib3R0b207XG4gICAgICB9KTtcblxuICAgIGNvbnN0IGNsZWFyUGxhY2Vob2xkZXIgPSAoKSA9PiB7XG4gICAgICBkcmFnLnBsYWNlaG9sZGVyPy5yZW1vdmUoKTtcbiAgICAgIGRyYWcucGxhY2Vob2xkZXIgPSBudWxsO1xuICAgICAgZHJhZy5yb3dFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShcImRpc3BsYXlcIik7XG4gICAgICBkcmFnLnRhcmdldCA9IG51bGw7XG4gICAgfTtcblxuICAgIHdyYXBwZXIuYWRkRXZlbnRMaXN0ZW5lcihcbiAgICAgIFwibW91c2Vkb3duXCIsXG4gICAgICAoZXZlbnQpID0+IHtcbiAgICAgICAgaWYgKGV2ZW50LmJ1dHRvbiAhPT0gMCkgcmV0dXJuO1xuICAgICAgICBjb25zdCByb3dFbCA9IGV2ZW50LnRhcmdldC5jbG9zZXN0KFwiLm1ldGFkYXRhLXByb3BlcnR5LWljb25cIik/LmNsb3Nlc3QoXCIubWV0YWRhdGEtcHJvcGVydHlcIik7XG4gICAgICAgIGNvbnN0IHNlY3Rpb24gPSByb3dFbD8uY2xvc2VzdChcIi50eXAtYmxvY2tcIik/LnR5cFNlY3Rpb247XG4gICAgICAgIGNvbnN0IGVkaXRvciA9IHNlY3Rpb24gPT09IHVuZGVmaW5lZCA/IG51bGwgOiBlZGl0b3JzLmdldChzZWN0aW9uKTtcbiAgICAgICAgY29uc3Qga2V5ID0gZWRpdG9yPy5yZW5kZXJlZC5maW5kKChyb3cpID0+IHJvdy5jb250YWluZXJFbCA9PT0gcm93RWwpPy5lbnRyeS5rZXk7XG4gICAgICAgIC8vIEFuIHVubmFtZWQgcm93IGhhcyBubyBidXNpbmVzcyBpbiBhbm90aGVyIGJsb2NrOyBPYnNpZGlhbiBzb3J0cyBpdC5cbiAgICAgICAgaWYgKCFrZXkpIHJldHVybjtcbiAgICAgICAgZHJhZyA9IHtcbiAgICAgICAgICBzZWN0aW9uLFxuICAgICAgICAgIGtleSxcbiAgICAgICAgICByb3dFbCxcbiAgICAgICAgICAvLyBNZWFzdXJlZCBub3c6IG9uY2UgaGlkZGVuIGZvciB0aGUgcGxhY2Vob2xkZXIsIG9mZnNldEhlaWdodCBpcyAwLlxuICAgICAgICAgIGhlaWdodDogcm93RWwub2Zmc2V0SGVpZ2h0LFxuICAgICAgICAgIHNwYWNlcjogZWRpdG9yLnByb3BlcnR5TGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZHJhZy1zcGFjZXJcIiB9KSxcbiAgICAgICAgICBwbGFjZWhvbGRlcjogbnVsbCxcbiAgICAgICAgICB0YXJnZXQ6IG51bGwsXG4gICAgICAgIH07XG4gICAgICAgIGRyb3AgPSBudWxsO1xuICAgICAgfSxcbiAgICAgIHRydWVcbiAgICApO1xuXG4gICAgLy8gT24gdGhlIHdpbmRvdyBzbyBhIGRyYWcgaXMgdHJhY2tlZCBvdXRzaWRlIHRoZSBibG9ja3MgdG9vOyByZW1vdmVkIHdpdGhcbiAgICAvLyB0aGUgZmlyc3QgZWRpdG9yLCB3aGljaCB1bmxvYWRzIG9uIHRoZSBuZXh0IHJlYnVpbGQgb2YgdGhlIGRldGFpbCB2aWV3LlxuICAgIGNvbnN0IG9uV2luTW92ZSA9IChldmVudCkgPT4ge1xuICAgICAgaWYgKCFkcmFnKSByZXR1cm47XG4gICAgICBjb25zdCB0YXJnZXQgPSBzZWN0aW9uQXQoZXZlbnQuY2xpZW50WSk7XG4gICAgICBpZiAodGFyZ2V0ID09PSB1bmRlZmluZWQgfHwgdGFyZ2V0ID09PSBkcmFnLnNlY3Rpb24pIHtcbiAgICAgICAgaWYgKGRyYWcucGxhY2Vob2xkZXIpIGNsZWFyUGxhY2Vob2xkZXIoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBsaXN0ID0gZWRpdG9ycy5nZXQodGFyZ2V0KS5wcm9wZXJ0eUxpc3RFbDtcbiAgICAgIGlmICghZHJhZy5wbGFjZWhvbGRlcikge1xuICAgICAgICBkcmFnLnJvd0VsLnN0eWxlLmRpc3BsYXkgPSBcIm5vbmVcIjtcbiAgICAgICAgZHJhZy5wbGFjZWhvbGRlciA9IGNyZWF0ZURpdih7IGNsczogXCJtZXRhZGF0YS1wcm9wZXJ0eSBkcmFnLWdob3N0LWhpZGRlbiB0eXAtZHJhZy1wbGFjZWhvbGRlclwiIH0pO1xuICAgICAgICBkcmFnLnBsYWNlaG9sZGVyLnN0eWxlLmhlaWdodCA9IGAke2RyYWcuaGVpZ2h0fXB4YDtcbiAgICAgIH1cbiAgICAgIC8vIERyb3Agc3BvdCBhcyBPYnNpZGlhbiBkb2VzIGl0OiBiZWZvcmUgdGhlIGZpcnN0IHJvdyB3aG9zZSBtaWRkbGUgaXNcbiAgICAgIC8vIGJlbG93IHRoZSBjdXJzb3IuXG4gICAgICBjb25zdCByb3dzID0gWy4uLmxpc3QuY2hpbGRyZW5dLmZpbHRlcigoZWwpID0+IGVsICE9PSBkcmFnLnBsYWNlaG9sZGVyICYmIGVsICE9PSBkcmFnLnNwYWNlcik7XG4gICAgICBjb25zdCBiZWZvcmUgPSByb3dzLmZpbmQoKGVsKSA9PiB7XG4gICAgICAgIGNvbnN0IHJlY3QgPSBlbC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgICAgcmV0dXJuIGV2ZW50LmNsaWVudFkgPCByZWN0LnRvcCArIHJlY3QuaGVpZ2h0IC8gMjtcbiAgICAgIH0pO1xuICAgICAgZHJhZy50YXJnZXQgPSB7IHNlY3Rpb246IHRhcmdldCwgaW5kZXg6IGJlZm9yZSA/IHJvd3MuaW5kZXhPZihiZWZvcmUpIDogcm93cy5sZW5ndGggfTtcbiAgICAgIGxpc3QuaW5zZXJ0QmVmb3JlKGRyYWcucGxhY2Vob2xkZXIsIGJlZm9yZSA/PyBudWxsKTtcbiAgICB9O1xuXG4gICAgY29uc3Qgb25XaW5VcCA9ICgpID0+IHtcbiAgICAgIGlmICghZHJhZykgcmV0dXJuO1xuICAgICAgY29uc3QgeyBzcGFjZXIsIHBsYWNlaG9sZGVyLCByb3dFbCwgdGFyZ2V0IH0gPSBkcmFnO1xuICAgICAgZHJhZyA9IG51bGw7XG4gICAgICBkcm9wID0gdGFyZ2V0O1xuICAgICAgcGxhY2Vob2xkZXI/LnJlbW92ZSgpO1xuICAgICAgcm93RWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoXCJkaXNwbGF5XCIpO1xuICAgICAgLy8gT25seSBhZnRlciBPYnNpZGlhbiBmaW5pc2hlcyBpdHMgZHJhZzogaXQgc3RpbGwgcmVhZHMgdGhlIGRyb3Agc3BvdFxuICAgICAgLy8gaW4gdGhlIHNvdXJjZSBibG9jayBmcm9tIHRoZSBjaGlsZCBsaXN0LCB3aGVyZSB0aGUgc3BhY2VyIG1hcmtzIHRoZVxuICAgICAgLy8gbGFzdCBwb3NpdGlvbi5cbiAgICAgIHdyYXBwZXIud2luLnNldFRpbWVvdXQoKCkgPT4gc3BhY2VyLnJlbW92ZSgpLCAwKTtcbiAgICB9O1xuXG4gICAgd3JhcHBlci53aW4uYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlbW92ZVwiLCBvbldpbk1vdmUsIHRydWUpO1xuICAgIHdyYXBwZXIud2luLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZXVwXCIsIG9uV2luVXAsIHRydWUpO1xuICAgIGFuY2hvci5yZWdpc3RlcigoKSA9PiB7XG4gICAgICB3cmFwcGVyLndpbi5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2Vtb3ZlXCIsIG9uV2luTW92ZSwgdHJ1ZSk7XG4gICAgICB3cmFwcGVyLndpbi5yZW1vdmVFdmVudExpc3RlbmVyKFwibW91c2V1cFwiLCBvbldpblVwLCB0cnVlKTtcbiAgICB9KTtcblxuICAgIGZvciAoY29uc3QgW3NlY3Rpb24sIGVkaXRvcl0gb2YgZWRpdG9ycykge1xuICAgICAgY29uc3Qgb3JpZ2luYWxSZW9yZGVyS2V5ID0gZWRpdG9yLnJlb3JkZXJLZXk7XG4gICAgICBlZGl0b3IucmVvcmRlcktleSA9IGZ1bmN0aW9uIChlbnRyeSwgaW5kZXgpIHtcbiAgICAgICAgY29uc3QgdGFyZ2V0ID0gZHJvcDtcbiAgICAgICAgZHJvcCA9IG51bGw7XG4gICAgICAgIGlmICghdGFyZ2V0KSByZXR1cm4gb3JpZ2luYWxSZW9yZGVyS2V5LmNhbGwodGhpcywgZW50cnksIGluZGV4KTtcbiAgICAgICAgbW92ZVByb3BlcnR5KHNlY3Rpb24sIHRhcmdldC5zZWN0aW9uLCBlbnRyeS5rZXksIHRhcmdldC5pbmRleCk7XG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIC8vIE1vdmVzIGtleSBmcm9tIGJsb2NrIGBmcm9tYCB0byBibG9jayBgdG9gIGF0IHBvc2l0aW9uIGluZGV4LiBJZiB0aGUgdGFyZ2V0XG4gIC8vIGFscmVhZHkgaGFzIHRoZSBuYW1lICh1bmlxdWUgd2l0aGluIGEgYmxvY2spLCB0aGUgdHdvIG1lcmdlOiB0aGUgZXhpc3RpbmdcbiAgLy8gZW50cnkga2VlcHMgcG9zaXRpb24sIHZhbHVlLCBmbG9hdGluZyBmbGFnIGFuZCBzaG9ydGN1dDsgb25seSBhbiBlbXB0eVxuICAvLyB2YWx1ZSBpcyBmaWxsZWQgZnJvbSB0aGUgZHJhZ2dlZCBvbmUgLSBzYW1lIHJ1bGUgYXMgbWVyZ2VTdWJ0eXBzXG4gIC8vIChzdWJ0eXBzLmpzKSBhbmQgcmVuYW1lSW5TdG9yZSAocHJvcGVydHktcmVuYW1lLXN5bmMuanMpLlxuICBhc3luYyBmdW5jdGlvbiBtb3ZlUHJvcGVydHkoZnJvbSwgdG8sIGtleSwgaW5kZXgpIHtcbiAgICBjb25zdCBzb3VyY2UgPSBzdG9yZXMuZ2V0KGZyb20pO1xuICAgIGNvbnN0IHRhcmdldCA9IHN0b3Jlcy5nZXQodG8pO1xuICAgIGlmICghc291cmNlIHx8ICF0YXJnZXQgfHwgZnJvbSA9PT0gdG8pIHJldHVybjtcblxuICAgIGNvbnN0IHNvdXJjZUZyb250bWF0dGVyID0geyAuLi5zb3VyY2UuZ2V0RnJvbnRtYXR0ZXIoKSB9O1xuICAgIGNvbnN0IHZhbHVlID0gc291cmNlRnJvbnRtYXR0ZXJba2V5XTtcbiAgICBjb25zdCB3YXNGbG9hdGluZyA9IHNvdXJjZS5nZXRGbG9hdGluZygpLmluY2x1ZGVzKGtleSk7XG4gICAgLy8gVGhlIHNob3J0Y3V0IGJlbG9uZ3MgdG8gdGhlIGtleSBhbmQgbW92ZXMgd2l0aCBpdC5cbiAgICBjb25zdCBzb3VyY2VTaG9ydGN1dHMgPSB7IC4uLnNvdXJjZS5nZXRTaG9ydGN1dHMoKSB9O1xuICAgIGNvbnN0IHNob3J0Y3V0ID0gc291cmNlU2hvcnRjdXRzW2tleV0gPz8gbnVsbDtcbiAgICBkZWxldGUgc291cmNlU2hvcnRjdXRzW2tleV07XG4gICAgZGVsZXRlIHNvdXJjZUZyb250bWF0dGVyW2tleV07XG4gICAgc291cmNlLnNldEZyb250bWF0dGVyKHNvdXJjZUZyb250bWF0dGVyKTtcbiAgICBzb3VyY2Uuc2V0RmxvYXRpbmcoc291cmNlLmdldEZsb2F0aW5nKCkuZmlsdGVyKChrKSA9PiBrICE9PSBrZXkpKTtcbiAgICBzb3VyY2Uuc2V0U2hvcnRjdXRzKHNvdXJjZVNob3J0Y3V0cyk7XG5cbiAgICBjb25zdCB0YXJnZXRGcm9udG1hdHRlciA9IHRhcmdldC5nZXRGcm9udG1hdHRlcigpO1xuICAgIGNvbnN0IGV4aXN0aW5nID0gT2JqZWN0LmtleXModGFyZ2V0RnJvbnRtYXR0ZXIpLmZpbmQoKGspID0+IGsudG9Mb3dlckNhc2UoKSA9PT0ga2V5LnRvTG93ZXJDYXNlKCkpO1xuICAgIGlmIChleGlzdGluZyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAoaXNFbXB0eVZhbHVlKHRhcmdldEZyb250bWF0dGVyW2V4aXN0aW5nXSkpIHRhcmdldC5zZXRGcm9udG1hdHRlcih7IC4uLnRhcmdldEZyb250bWF0dGVyLCBbZXhpc3RpbmddOiB2YWx1ZSB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKHRhcmdldEZyb250bWF0dGVyKTtcbiAgICAgIGNvbnN0IGF0ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oaW5kZXgsIGtleXMubGVuZ3RoKSk7XG4gICAgICBjb25zdCBuZXh0ID0ge307XG4gICAgICBmb3IgKGNvbnN0IGsgb2Yga2V5cy5zbGljZSgwLCBhdCkpIG5leHRba10gPSB0YXJnZXRGcm9udG1hdHRlcltrXTtcbiAgICAgIG5leHRba2V5XSA9IHZhbHVlO1xuICAgICAgZm9yIChjb25zdCBrIG9mIGtleXMuc2xpY2UoYXQpKSBuZXh0W2tdID0gdGFyZ2V0RnJvbnRtYXR0ZXJba107XG4gICAgICB0YXJnZXQuc2V0RnJvbnRtYXR0ZXIobmV4dCk7XG4gICAgICBpZiAod2FzRmxvYXRpbmcpIHRhcmdldC5zZXRGbG9hdGluZyhbLi4udGFyZ2V0LmdldEZsb2F0aW5nKCksIGtleV0pO1xuICAgICAgaWYgKHNob3J0Y3V0KSB0YXJnZXQuc2V0U2hvcnRjdXRzKHsgLi4udGFyZ2V0LmdldFNob3J0Y3V0cygpLCBba2V5XTogc2hvcnRjdXQgfSk7XG4gICAgfVxuXG4gICAgYXdhaXQgdmlldy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgLy8gQm90aCBibG9ja3MgY2hhbmdlZCwgc28gdGhpcyBkZXRhaWwgdmlldyBpcyByZWJ1aWx0IGZyb20gdGhlIHNldHRpbmdzO1xuICAgIC8vIHRoZSBvdGhlciB2aWV3cyBvbmx5IG5lZWQgdGhlaXIgY29sb3JzIGFuZCBtYXJrcyByZWZyZXNoZWQuXG4gICAgdmlldy5wbHVnaW4ucmVmcmVzaFR5cENvbG9yc0V4Y2VwdD8uKHZpZXcpO1xuICAgIHZpZXcucmVuZGVyKCk7XG4gIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IG1vdW50RnJvbnRtYXR0ZXJCbG9ja3MgfTtcbiIsICJjb25zdCB7IG1vdmVUeXBTdWJ0eXBzLCBkZWxldGVUeXBTdWJ0eXBzIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBzXCIpO1xuXG4vLyBUaGUgcGVyLVRZUCB0YWJsZXMgb2YgdGhlIHNldHRpbmdzLCBlYWNoIGtleWVkIGJ5IFRZUCBuYW1lIC0gdGhlIG9uZSBsaXN0XG4vLyB0aGF0IHJlbmFtaW5nLCBtZXJnaW5nIGFuZCBkZWxldGluZyBhIFRZUCBnbyB0aHJvdWdoLCBzbyBhIHRhYmxlIGFkZGVkIGxhdGVyXG4vLyBjYW4ndCBiZSBmb3Jnb3R0ZW4gaW4gb25lIG9mIHRoZW0uIHR5cFN1YnR5cHMgaXMgaGFuZGxlZCBzZXBhcmF0ZWx5IChzZWVcbi8vIHN1YnR5cHMuanMpOiBhIG1lcmdlIGNvbWJpbmVzIFN1YnR5cCBibG9ja3MgaW5zdGVhZCBvZiBkcm9wcGluZyB0aGVtLlxuLy8gdHlwTWFudWFsIG1heSBiZSBtaXNzaW5nIGluIG9sZGVyIHNldHRpbmdzLCBzbyBhIHRhYmxlIGlzIG9ubHkgY3JlYXRlZCB3aGVuXG4vLyB0aGVyZSBpcyBzb21ldGhpbmcgdG8gbW92ZSBpbnRvIGl0LlxuY29uc3QgVFlQX1NFVFRJTkdfVEFCTEVTID0gW1xuICBcInR5cENvbG9yc1wiLFxuICBcInR5cERlc2NyaXB0aW9uc1wiLFxuICBcInR5cERlZmF1bHRGcm9udG1hdHRlclwiLFxuICBcInR5cEZsb2F0aW5nS2V5c1wiLFxuICBcInR5cFNob3J0Y3V0c1wiLFxuICBcInR5cE1hbnVhbFwiLFxuXTtcblxuLy8gUmVuYW1pbmcgaW4gdGhlIHNldHRpbmdzOiB0aGUgVFlQIGtlZXBzIGl0cyBwbGFjZSBpbiBzZXR0aW5ncy50eXBzICh0aGVcbi8vIG1hbnVhbCBvcmRlciksIGV2ZXJ5IHRhYmxlIGVudHJ5IGFuZCB0aGUgU3VidHlwcyBtb3ZlIHRvIHRoZSBuZXcgbmFtZS5cbmZ1bmN0aW9uIG1vdmVUeXBTZXR0aW5ncyhzZXR0aW5ncywgZnJvbSwgdG8pIHtcbiAgY29uc3QgaW5kZXggPSBzZXR0aW5ncy50eXBzLmluZGV4T2YoZnJvbSk7XG4gIGlmIChpbmRleCAhPT0gLTEpIHNldHRpbmdzLnR5cHNbaW5kZXhdID0gdG87XG4gIGZvciAoY29uc3QgdGFibGUgb2YgVFlQX1NFVFRJTkdfVEFCTEVTKSB7XG4gICAgaWYgKHNldHRpbmdzW3RhYmxlXT8uW2Zyb21dID09PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xuICAgIHNldHRpbmdzW3RhYmxlXSA/Pz0ge307XG4gICAgc2V0dGluZ3NbdGFibGVdW3RvXSA9IHNldHRpbmdzW3RhYmxlXVtmcm9tXTtcbiAgICBkZWxldGUgc2V0dGluZ3NbdGFibGVdW2Zyb21dO1xuICB9XG4gIG1vdmVUeXBTdWJ0eXBzKHNldHRpbmdzLCBmcm9tLCB0byk7XG59XG5cbi8vIFJlbW92ZXMgdGhlIFRZUCBmcm9tIHRoZSBsaXN0IGFuZCBmcm9tIGV2ZXJ5IHRhYmxlLCBTdWJ0eXBzIGluY2x1ZGVkLlxuZnVuY3Rpb24gZGVsZXRlVHlwU2V0dGluZ3Moc2V0dGluZ3MsIHR5cCkge1xuICBzZXR0aW5ncy50eXBzID0gc2V0dGluZ3MudHlwcy5maWx0ZXIoKHQpID0+IHQgIT09IHR5cCk7XG4gIGZvciAoY29uc3QgdGFibGUgb2YgVFlQX1NFVFRJTkdfVEFCTEVTKSB7XG4gICAgaWYgKHNldHRpbmdzW3RhYmxlXSkgZGVsZXRlIHNldHRpbmdzW3RhYmxlXVt0eXBdO1xuICB9XG4gIGRlbGV0ZVR5cFN1YnR5cHMoc2V0dGluZ3MsIHR5cCk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyBUWVBfU0VUVElOR19UQUJMRVMsIG1vdmVUeXBTZXR0aW5ncywgZGVsZXRlVHlwU2V0dGluZ3MgfTtcbiIsICJjb25zdCB7IEl0ZW1WaWV3LCBNZW51LCBOb3RpY2UsIHNldEljb24sIGRlYm91bmNlIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IENvbmZpcm1Nb2RhbCwgdHlwTmFtZU5vZGUsIHN1YnR5cE5hbWVOb2RlIH0gPSByZXF1aXJlKFwiLi9jb25maXJtLW1vZGFsXCIpO1xuY29uc3QgeyBzbmFwc2hvdFNldHRpbmdzLCBvZmZlclVuZG8gfSA9IHJlcXVpcmUoXCIuL3VuZG9cIik7XG5jb25zdCB7IG1vdW50RnJvbnRtYXR0ZXJCbG9ja3MgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLWJsb2Nrc1wiKTtcbmNvbnN0IHsgcmVuZGVyU2hvcnRjdXRDb250cm9scyB9ID0gcmVxdWlyZShcIi4vdHlwLWZyb250bWF0dGVyLWVkaXRvclwiKTtcbmNvbnN0IHsgbW92ZVR5cFNldHRpbmdzLCBkZWxldGVUeXBTZXR0aW5ncyB9ID0gcmVxdWlyZShcIi4vdHlwLXNldHRpbmdzXCIpO1xuY29uc3QgeyBydW5PclJlcG9ydEVycm9yIH0gPSByZXF1aXJlKFwiLi9jb21tYW5kc1wiKTtcbmNvbnN0IHsgaXNCYXNlc0VuYWJsZWQsIGNyZWF0ZUJhc2VGb3IgfSA9IHJlcXVpcmUoXCIuL2Jhc2VzXCIpO1xuY29uc3QgeyBydW5Gcm9udG1hdHRlclNvcnQgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLXNvcnRcIik7XG5jb25zdCB7XG4gIG5vcm1hbGl6ZVN1YnR5cE5hbWUsXG4gIGdldFN1YnR5cE5hbWVzLFxuICBlbnN1cmVTdWJ0eXAsXG4gIG1lcmdlVHlwU3VidHlwcyxcbiAgZ2V0U3VidHlwLFxuICBpc1N1YnR5cE1hbnVhbCxcbiAgc2V0U3VidHlwTWFudWFsLFxuICBzZXRBbGxTdWJ0eXBzTWFudWFsLFxuICByZW5hbWVTdWJ0eXAsXG4gIHJlb3JkZXJTdWJ0eXBzLFxuICBkZWxldGVTdWJ0eXAsXG4gIG1lcmdlU3VidHlwcyxcbiAgcmVuYW1lU3VidHlwSW5Ob3Rlcyxcbn0gPSByZXF1aXJlKFwiLi9zdWJ0eXBzXCIpO1xuY29uc3QgeyBub3JtYWxpemVUeXBOYW1lLCBjb21wYXJlVHlwcywgc29ydFR5cHNCeU1vZGUsIHBsdXJhbCwgam9pbkFuZCB9ID0gcmVxdWlyZShcIi4vdHlwLXV0aWxzXCIpO1xuY29uc3QgeyB0eXBLZXlPZiwgcHJvcGVydHlWYWx1ZSwgc2V0Q2Fub25pY2FsUHJvcGVydHksIFRZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZIH0gPSByZXF1aXJlKFwiLi90eXAtaW5kZXhcIik7XG5jb25zdCB7XG4gIHN1YnR5cENvbG9yLFxuICBhcHBseUNvbG9yT2Zmc2V0LFxuICBoYXNDb2xvck9mZnNldCxcbiAgc3VidHlwSGFzT3duQ29sb3IsXG4gIHBhaW50Q29sb3JEb3QsXG4gIG5hbWVDb2xvcixcbiAgY2hhbm5lbEJvdW5kcyxcbiAgY2xhbXBlZE9mZnNldCxcbiAgU1VCVFlQX0NPTE9SX0NIQU5ORUxTLFxuICBERUZBVUxUX1RZUF9DT0xPUixcbn0gPSByZXF1aXJlKFwiLi90eXAtY29sb3JzXCIpO1xuXG5jb25zdCBWSUVXX1RZUEVfVFlQX1BBTkUgPSBcInR5cC1zeXN0ZW0tcGFuZVwiO1xuY29uc3QgREVGQVVMVF9TT1JUX09SREVSID0gXCJjb3VudC1kZXNjXCI7XG5jb25zdCBERUZBVUxUX1NFQ09OREFSWSA9IFwic3VidHlwc1wiO1xuXG4vLyBXaGF0IHRoZSBUWVAtTGlzdCBzaG93cyBuZXh0IHRvIHRoZSBuYW1lIChzZXR0aW5ncy50eXBMaXN0U2Vjb25kYXJ5KSxcbi8vIGN5Y2xlZCBieSBhIGhlYWRlciBidXR0b24gbmV4dCB0byBzb3J0aW5nIChzZWUgY3ljbGVTZWNvbmRhcnkpIC0gdG9vIGZldyxcbi8vIHRvbyBpbW1lZGlhdGVseSB2aXNpYmxlIHN0YXRlcyBmb3IgYSBtZW51LlxuLy8gICBzdWJ0eXBzICAgICAtIHRoZSBUWVAncyBTdWJ0eXBzIGluIGJyYWNrZXRzLCBlYWNoIGluIGl0cyBjb2xvciAobGlrZSB0aGVcbi8vICAgICAgICAgICAgICAgICBwcmV2aWV3IGluIHRoZSBzZXBhcmF0ZSBUWVAtUGlja2VyKVxuLy8gICBkZXNjcmlwdGlvbiAtIHRleHQgZmllbGQgdG8gZWRpdCB0aGUgVFlQIGRlc2NyaXB0aW9uXG4vLyAgIG5vbmUgICAgICAgIC0gbm90aGluZywgdGhlIG5hbWUgZ2V0cyB0aGUgd2hvbGUgcm93XG4vLyBUaGUgb3JkZXIgaXMgYWxzbyB0aGUgY3ljbGUgb3JkZXI7IHRoZSBmaXJzdCBpcyB0aGUgZGVmYXVsdDogdGhlIFN1YnR5cHNcbi8vIGFwcGVhciBub3doZXJlIGVsc2UgaW4gdGhlIGxpc3QsIHRoZSBkZXNjcmlwdGlvbiBhbHNvIGluIHRoZSBkZXRhaWwgdmlldy5cbmNvbnN0IFNFQ09OREFSWV9NT0RFUyA9IFtcbiAgeyBtb2RlOiBcInN1YnR5cHNcIiwgdGl0bGU6IFwiU3VidHlwIGxpc3RcIiwgaWNvbjogXCJsaXN0LXRyZWVcIiB9LFxuICB7IG1vZGU6IFwiZGVzY3JpcHRpb25cIiwgdGl0bGU6IFwiRGVzY3JpcHRpb25cIiwgaWNvbjogXCJ0ZXh0LWN1cnNvci1pbnB1dFwiIH0sXG4gIHsgbW9kZTogXCJub25lXCIsIHRpdGxlOiBcIk5vdGhpbmdcIiwgaWNvbjogXCJtaW51c1wiIH0sXG5dO1xuXG5jb25zdCBTT1JUX09QVElPTlMgPSBbXG4gIC8vIFVubGlrZSB0aGUgb3RoZXJzLCBcIm1hbnVhbFwiIGhhcyBubyBjb21wYXJpc29uOiB0aGUgb3JkZXIgb2Ygc2V0dGluZ3MudHlwc1xuICAvLyBpdHNlbGYgaXMgdGhlIHN0b3JhZ2UgKHNlZSByZW5kZXIoKSBhbmQgcmVuZGVyUmVnaXN0ZXJlZEl0ZW0oKSBmb3IgdGhlXG4gIC8vIGRyYWcgJiBkcm9wIHJlbmRlcmluZyBidWlsdCBvbiBpdCkuIEZpcnN0IG9uIHB1cnBvc2UgLSBpdHMgb3duIGdyb3VwIGF0XG4gIC8vIHRoZSB0b3Agb2YgdGhlIG1lbnUgKHNlZSBzaG93U29ydE1lbnUpLlxuICB7IG1vZGU6IFwibWFudWFsXCIsIHRpdGxlOiBcIk1hbnVhbCAoZHJhZyAmIGRyb3ApXCIgfSxcbiAgeyBtb2RlOiBcImNvdW50LWRlc2NcIiwgdGl0bGU6IFwiTW9zdCBub3RlcyBmaXJzdFwiIH0sXG4gIHsgbW9kZTogXCJjb3VudC1hc2NcIiwgdGl0bGU6IFwiRmV3ZXN0IG5vdGVzIGZpcnN0XCIgfSxcbiAgeyBtb2RlOiBcIm5hbWUtYXNjXCIsIHRpdGxlOiBcIk5hbWUgKEEgdG8gWilcIiB9LFxuICB7IG1vZGU6IFwibmFtZS1kZXNjXCIsIHRpdGxlOiBcIk5hbWUgKFogdG8gQSlcIiB9LFxuICB7IG1vZGU6IFwiY29sb3ItYXNjXCIsIHRpdGxlOiBcIkNvbG9yIChyZWQgXHUyMTkyIHZpb2xldClcIiB9LFxuICB7IG1vZGU6IFwiY29sb3ItZGVzY1wiLCB0aXRsZTogXCJDb2xvciAodmlvbGV0IFx1MjE5MiByZWQpXCIgfSxcbl07XG5cbi8vIFJld3JpdGVzIHRoZSBUWVAgb2YgZXZlcnkgbm90ZSB3aXRoIGtleSBvbGRLZXkgKHNlZSB0eXBLZXlPZiBpblxuLy8gdHlwLWluZGV4LmpzIC0gdGhlIFRZUCBuYW1lIGZvciBhIGNsZWFuIHZhbHVlLCBvdGhlcndpc2UgdGhlIHJhdyBmb3JtIGxpa2Vcbi8vIFwiIGJ1Y2hcIiBvciBcIltQRVJTT04sIEJVQ0hdXCIpIHRvIHRoZSBzaW5nbGUgdmFsdWUgbmV3VmFsdWUuIFVzZWQgZm9yXG4vLyByZWdpc3RlclR5cCgpIChjbGVhbnVwKSwgcmVuYW1pbmcgYW5kIG1lcmdpbmcuIE1hdGNoaW5nIGlzIGV4YWN0IG9uIHRoZSBrZXksXG4vLyBzbyBhIGxpc3QgaXMgcmVwbGFjZWQgYXMgYSB3aG9sZS4gQSBkaWZmZXJlbnRseSBzcGVsbGVkIHByb3BlcnR5IChcInR5cFwiKVxuLy8gYmVjb21lcyBcIlRZUFwiLlxuYXN5bmMgZnVuY3Rpb24gcmVuYW1lVHlwSW5Ob3RlcyhwbHVnaW4sIG9sZEtleSwgbmV3VmFsdWUpIHtcbiAgbGV0IGNoYW5nZWQgPSAwO1xuICBmb3IgKGNvbnN0IGZpbGUgb2YgcGx1Z2luLnR5cEluZGV4LmZpbGVzV2l0aFR5cChvbGRLZXkpKSB7XG4gICAgbGV0IG1hdGNoZWQgPSBmYWxzZTtcbiAgICBhd2FpdCBwbHVnaW4uYXBwLmZpbGVNYW5hZ2VyLnByb2Nlc3NGcm9udE1hdHRlcihmaWxlLCAoZnJvbnRtYXR0ZXIpID0+IHtcbiAgICAgIGlmICh0eXBLZXlPZihwcm9wZXJ0eVZhbHVlKGZyb250bWF0dGVyLCBUWVBfUFJPUEVSVFkpKSAhPT0gb2xkS2V5KSByZXR1cm47XG4gICAgICBzZXRDYW5vbmljYWxQcm9wZXJ0eShmcm9udG1hdHRlciwgVFlQX1BST1BFUlRZLCBuZXdWYWx1ZSk7XG4gICAgICBtYXRjaGVkID0gdHJ1ZTtcbiAgICB9KTtcbiAgICBpZiAobWF0Y2hlZCkgY2hhbmdlZCsrO1xuICB9XG4gIHJldHVybiBjaGFuZ2VkO1xufVxuXG4vLyBDbGVhbmVkIGZvcm0gb2YgYSByYXcgdmFsdWUgZm9yIHJlZ2lzdGVyVHlwKCk6IGEgc2luZ2xlIHZhbHVlIHRyaW1tZWQgYW5kXG4vLyB1cHBlcmNhc2VkOyBhIGxpc3QgaXMgZGVsaWJlcmF0ZWx5IE5PVCByZWR1Y2VkIHRvIG9uZSBpdGVtIGJ1dCBqb2luZWQgaW50b1xuLy8gb25lIHZhbHVlIFwiQSwgQlwiIC0gd2hpY2ggYSByZW5hbWUgY2FuIHRoZW4gdHVybiBpbnRvIGFub3RoZXIgVFlQIChzZWVcbi8vIHN0YXJ0RGV0YWlsUmVuYW1lL3Nob3dNZXJnZUNvbmZpcm0pLiBub3JtYWxpemUgc3BlbGxzIHRoZSBzaW5nbGUgbmFtZXMgLVxuLy8gbm9ybWFsaXplU3VidHlwTmFtZSBmb3IgU3VidHlwcy5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVJhd1R5cChyYXcsIG5vcm1hbGl6ZSA9IG5vcm1hbGl6ZVR5cE5hbWUpIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkocmF3KSkge1xuICAgIHJldHVybiByYXdcbiAgICAgIC5tYXAoKHYpID0+IG5vcm1hbGl6ZShTdHJpbmcodiA/PyBcIlwiKSkpXG4gICAgICAuZmlsdGVyKEJvb2xlYW4pXG4gICAgICAuam9pbihcIiwgXCIpO1xuICB9XG4gIHJldHVybiBub3JtYWxpemUoU3RyaW5nKHJhdykpO1xufVxuXG4vLyBXaGVyZSB0eXBpbmcgaGFwcGVucyBpbiB0aGUgcGFuZTogdGV4dCBmaWVsZHMsIGNvbnRlbnRlZGl0YWJsZSBuYW1lcyBhbmRcbi8vIE9ic2lkaWFuJ3MgcHJvcGVydHkgZWRpdG9yIChpdHMgcm93cyB0aGVtc2VsdmVzIGFyZSBmb2N1cyBzdG9wcyBvZiBpdHNcbi8vIGtleWJvYXJkIG5hdmlnYXRpb24gLSBUYWIgZnJvbSBhIHZhbHVlIGxhbmRzIG9uIHRoZSBuZXh0IHJvdykuIFRoZSBuYXRpdmVcbi8vIGNvbG9yIHBpY2tlciBkb2Vzbid0IGNvdW50OiBpdCBrZWVwcyB0aGUgZm9jdXMgYWZ0ZXIgY2xvc2luZywgd2hpY2ggd291bGRcbi8vIGhvbGQgYmFjayBldmVyeSByZWZyZXNoLCBhbmQgYSByZWZyZXNoIHdoaWxlIGl0IGlzIG9wZW4gb25seSBjbG9zZXMgaXQuXG5jb25zdCBGSUVMRF9TRUxFQ1RPUiA9ICdpbnB1dCwgdGV4dGFyZWEsIFtjb250ZW50ZWRpdGFibGU9XCJ0cnVlXCJdLCBbY29udGVudGVkaXRhYmxlPVwiXCJdLCAubWV0YWRhdGEtcHJvcGVydHknO1xuY29uc3QgaXNGaWVsZCA9IChlbCkgPT4gISFlbD8ubWF0Y2hlcz8uKEZJRUxEX1NFTEVDVE9SKSAmJiAhZWwubWF0Y2hlcygnaW5wdXRbdHlwZT1cImNvbG9yXCJdJyk7XG5cbi8vIFNob3dzIGFuIHVucmVnaXN0ZXJlZCBrZXk6IHBhZGRpbmcgd291bGQgYmUgaW52aXNpYmxlIGFzIHBsYWluIHRleHQsIHNvIGl0XG4vLyBnZXRzIHF1b3Rlcy4gTGlzdHMgYWxyZWFkeSBjYXJyeSB0aGVpciBicmFja2V0cyBpbiB0aGUga2V5LlxuZnVuY3Rpb24gZGlzcGxheVR5cEtleSh0eXBLZXkpIHtcbiAgcmV0dXJuIHR5cEtleSAhPT0gdHlwS2V5LnRyaW0oKSA/IGBcIiR7dHlwS2V5fVwiYCA6IHR5cEtleTtcbn1cblxuY2xhc3MgVHlwUGFuZSBleHRlbmRzIEl0ZW1WaWV3IHtcbiAgY29uc3RydWN0b3IobGVhZiwgcGx1Z2luKSB7XG4gICAgc3VwZXIobGVhZik7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cblxuICBnZXRWaWV3VHlwZSgpIHtcbiAgICByZXR1cm4gVklFV19UWVBFX1RZUF9QQU5FO1xuICB9XG5cbiAgZ2V0RGlzcGxheVRleHQoKSB7XG4gICAgcmV0dXJuIFwiVFlQXCI7XG4gIH1cblxuICBnZXRJY29uKCkge1xuICAgIHJldHVybiBcInNoYXBlc1wiO1xuICB9XG5cbiAgYXN5bmMgb25PcGVuKCkge1xuICAgIHRoaXMuaXNFZGl0aW5nID0gZmFsc2U7XG4gICAgdGhpcy5zZWxlY3RlZFR5cCA9IG51bGw7XG4gICAgdGhpcy5mcm9udG1hdHRlckJsb2NrcyA9IG51bGw7XG4gICAgdGhpcy5mcm9udG1hdHRlckVkaXRvcnMgPSBbXTtcblxuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gICAgdGhpcy5jb250ZW50RWwuYWRkQ2xhc3MoXCJ0eXAtc3lzdGVtLXBhbmVcIik7XG5cbiAgICAvLyBBIHJlZnJlc2ggZnJvbSBvdXRzaWRlIHRoYXQgd2FpdGVkIGZvciBhIGZpZWxkIChzZWUgcmVxdWVzdFJlbmRlcikgcnVuc1xuICAgIC8vIG9uY2UgdGhlIGZvY3VzIGhhcyBsZWZ0IHRoZSBmaWVsZHMgb2YgdGhpcyBwYW5lIC0gY2hlY2tlZCBhIHRpY2sgbGF0ZXIsXG4gICAgLy8gd2hlbiB0aGUgZm9jdXMgaGFzIHNldHRsZWQuIE1vdmluZyBmcm9tIGZpZWxkIHRvIGZpZWxkIChUYWIpIGtlZXBzXG4gICAgLy8gd2FpdGluZy5cbiAgICB0aGlzLnJlZ2lzdGVyRG9tRXZlbnQodGhpcy5jb250ZW50RWwsIFwiZm9jdXNvdXRcIiwgKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoIXRoaXMuX3JlbmRlclBlbmRpbmcgfHwgaXNGaWVsZChldmVudC5yZWxhdGVkVGFyZ2V0KSkgcmV0dXJuO1xuICAgICAgd2luZG93LnNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICBpZiAodGhpcy5fcmVuZGVyUGVuZGluZyAmJiAhdGhpcy5oYXNGaWVsZEZvY3VzKCkpIHRoaXMucmVuZGVyKCk7XG4gICAgICB9LCAwKTtcbiAgICB9KTtcblxuICAgIHRoaXMucmVnaXN0ZXJEb21FdmVudCh0aGlzLmNvbnRlbnRFbCwgXCJrZXlkb3duXCIsIChldmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmtleSA9PT0gXCJFc2NhcGVcIiAmJiB0aGlzLnNlbGVjdGVkVHlwICE9PSBudWxsKSB0aGlzLmNsb3NlVHlwU2V0dGluZ3MoKTtcbiAgICB9KTtcbiAgICB0aGlzLnJlbmRlcigpO1xuICB9XG5cbiAgYXN5bmMgb25DbG9zZSgpIHtcbiAgICB0aGlzLmNsb3NlU3VidHlwQ29sb3JQb3BvdmVyPy4oKTtcbiAgfVxuXG4gIG9wZW5TZWFyY2godHlwKSB7XG4gICAgY29uc3QgZ2xvYmFsU2VhcmNoID0gdGhpcy5wbHVnaW4uYXBwLmludGVybmFsUGx1Z2lucy5nZXRQbHVnaW5CeUlkKFwiZ2xvYmFsLXNlYXJjaFwiKTtcbiAgICBpZiAoIWdsb2JhbFNlYXJjaCkgcmV0dXJuO1xuICAgIC8vIFwiTm8gVFlQXCIgd2l0aG91dCBhIGZpbHRlciB3b3VsZCBhbHNvIG1hdGNoIGV2ZXJ5IG5vbi1tYXJrZG93biBmaWxlLFxuICAgIC8vIHdoaWNoIGNhbid0IGhhdmUgZnJvbnRtYXR0ZXIgLSBoZW5jZSBmaWxlOi5tZC5cbiAgICBjb25zdCBxdWVyeSA9IHR5cCA9PT0gbnVsbCA/IGAtW1wiJHtUWVBfUFJPUEVSVFl9XCJdIGZpbGU6Lm1kYCA6IHRoaXMudHlwQ2xhdXNlKHR5cCk7XG4gICAgZ2xvYmFsU2VhcmNoLmluc3RhbmNlLm9wZW5HbG9iYWxTZWFyY2gocXVlcnkpO1xuICB9XG5cbiAgLy8gU2VhcmNoIGNsYXVzZSBmb3IgYSBUWVAga2V5LiBBIGxpc3QgKHVucmVnaXN0ZXJlZCBrZXkgXCJbQSwgQl1cIikgaGFzIG5vXG4gIC8vIGV4YWN0IHN5bnRheCwgc28gaXQgc2VhcmNoZXMgbm90ZXMgY2FycnlpbmcgYWxsIGl0cyBpdGVtcy4gQWxzbyB1c2VkIGJ5XG4gIC8vIG9wZW5TdWJ0eXBTZWFyY2goKSwgd2hpY2ggY2FuIHJlY2VpdmUgYW4gdW5yZWdpc3RlcmVkICh1bmNsZWFuKSBUWVAga2V5LlxuICB0eXBDbGF1c2UodHlwKSB7XG4gICAgY29uc3QgcmF3ID0gdGhpcy5wbHVnaW4udHlwSW5kZXgucmF3VmFsdWVPZih0eXApO1xuICAgIHJldHVybiBBcnJheS5pc0FycmF5KHJhdylcbiAgICAgID8gcmF3Lm1hcCgodikgPT4gYFtcIiR7VFlQX1BST1BFUlRZfVwiOlwiJHtTdHJpbmcodiA/PyBcIlwiKS50cmltKCl9XCJdYCkuam9pbihcIiBcIilcbiAgICAgIDogYFtcIiR7VFlQX1BST1BFUlRZfVwiOlwiJHt0eXB9XCJdYDtcbiAgfVxuXG4gIC8vIHR5cEtleSBjb21lcyBzdHJhaWdodCBmcm9tIGZyb250bWF0dGVyIHZhbHVlcyAoc2VlIHVucmVnaXN0ZXJlZFJvd3MgaW5cbiAgLy8gcmVuZGVyKCkgYW5kIHR5cEtleU9mKSAtIHBvc3NpYmx5IGxvd2VyY2FzZSwgcGFkZGVkIG9yIGEgbGlzdC4gVFlQIGVudHJpZXNcbiAgLy8gYXJlIGFsd2F5cyBjbGVhbiB1cHBlcmNhc2UgdmFsdWVzLCBzbyB0aGUgY2xlYW5lZCBmb3JtIGlzIHJlZ2lzdGVyZWQgKHNlZVxuICAvLyBub3JtYWxpemVSYXdUeXApIGFuZCB0aGUgYWZmZWN0ZWQgbm90ZXMgYXJlIHJld3JpdHRlbiByaWdodCBhd2F5LCBzbyB0aGV5XG4gIC8vIG5vIGxvbmdlciBzaG93IHVwIGFzIHVucmVnaXN0ZXJlZC5cbiAgYXN5bmMgcmVnaXN0ZXJUeXAodHlwS2V5KSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5hcHBseVR5cFJlZ2lzdHJhdGlvbih0eXBLZXkpO1xuICAgIGlmICghcmVzdWx0KSByZXR1cm47XG5cbiAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICB0aGlzLnJlbmRlcigpO1xuICAgIHRoaXMucmVmcmVzaE90aGVyVmlld3MoKTtcblxuICAgIGlmIChyZXN1bHQucmVuYW1lZCA+IDApIHtcbiAgICAgIG5ldyBOb3RpY2UoYFRZUCAke3Jlc3VsdC50eXB9IHJlZ2lzdGVyZWQsICR7cGx1cmFsKHJlc3VsdC5yZW5hbWVkLCBcIm5vdGVcIil9IHVwZGF0ZWQuYCk7XG4gICAgfVxuICB9XG5cbiAgLy8gVGhlIGNvcmUgb2YgcmVnaXN0ZXJUeXAoKSB3aXRob3V0IHNhdmluZywgcmUtcmVuZGVyaW5nIGFuZCBub3RpY2UsIHNvXG4gIC8vIHJlZ2lzdGVyVHlwV2l0aFN1YnR5cCgpIGNhbiByZWdpc3RlciBUWVAgYW5kIFN1YnR5cCBpbiB0dXJuIGFuZCB0aGVuIHNhdmVcbiAgLy8gYW5kIG5vdGlmeSBPTkNFLiBSZXR1cm5zIHsgdHlwLCByZW5hbWVkIH0sIG9yIG51bGwgaWYgbm90aGluZyB1c2FibGUgaXNcbiAgLy8gbGVmdC5cbiAgYXN5bmMgYXBwbHlUeXBSZWdpc3RyYXRpb24odHlwS2V5KSB7XG4gICAgY29uc3QgcmF3ID0gdGhpcy5wbHVnaW4udHlwSW5kZXgucmF3VmFsdWVPZih0eXBLZXkpO1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVSYXdUeXAocmF3ID09PSB1bmRlZmluZWQgPyB0eXBLZXkgOiByYXcpO1xuICAgIGlmICghbm9ybWFsaXplZCkgcmV0dXJuIG51bGw7XG4gICAgaWYgKCF0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBzLmluY2x1ZGVzKG5vcm1hbGl6ZWQpKSB7XG4gICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBzLnB1c2gobm9ybWFsaXplZCk7XG4gICAgfVxuICAgIGNvbnN0IHJlbmFtZWQgPSBub3JtYWxpemVkICE9PSB0eXBLZXkgPyBhd2FpdCByZW5hbWVUeXBJbk5vdGVzKHRoaXMucGx1Z2luLCB0eXBLZXksIG5vcm1hbGl6ZWQpIDogMDtcbiAgICByZXR1cm4geyB0eXA6IG5vcm1hbGl6ZWQsIHJlbmFtZWQgfTtcbiAgfVxuXG4gIC8vIENvbG9ycyBhbmQgbWFya3Mgb2YgZXZlcnkgb3RoZXIgdmlldyBhZnRlciBhIGNoYW5nZSBtYWRlIGluIHRoaXMgcGFuZVxuICAvLyAoc2VlIHJlZnJlc2hUeXBDb2xvcnNFeGNlcHQgaW4gbWFpbi5qcykuIFRoaXMgcGFuZSB1cGRhdGVzIGl0c2VsZjogZWl0aGVyXG4gIC8vIHRoZSBjaGFuZ2UgaXMgYWxyZWFkeSB2aXNpYmxlIChhIHByb3BlcnR5IGVkaXQpIG9yIHRoZSBjYWxsZXIgcmVuZGVycy5cbiAgcmVmcmVzaE90aGVyVmlld3MoKSB7XG4gICAgdGhpcy5wbHVnaW4ucmVmcmVzaFR5cENvbG9yc0V4Y2VwdD8uKHRoaXMpO1xuICB9XG5cbiAgLy8gQSBuZXcsIGVtcHR5IHRyZWUgaXRlbSBzdHJhaWdodCBpbiBlZGl0IG1vZGUgLSBsaWtlIE9ic2lkaWFuJ3Mgb3duIHZpZXdzXG4gIC8vIChhIG5ldyBib29rbWFyayBncm91cCwgc2F5KS5cbiAgc3RhcnRBZGQoKSB7XG4gICAgaWYgKHRoaXMuaXNFZGl0aW5nKSByZXR1cm47XG5cbiAgICBjb25zdCB0cmVlSXRlbSA9IHRoaXMubGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW1cIiB9KTtcbiAgICBpZiAodGhpcy5zZXBhcmF0b3JFbCkgdGhpcy5saXN0RWwuaW5zZXJ0QmVmb3JlKHRyZWVJdGVtLCB0aGlzLnNlcGFyYXRvckVsKTtcbiAgICBjb25zdCBzZWxmID0gdHJlZUl0ZW0uY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1zZWxmIGlzLWNsaWNrYWJsZVwiIH0pO1xuICAgIGNvbnN0IGlubmVyID0gc2VsZi5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLWlubmVyXCIgfSk7XG5cbiAgICB0aGlzLnN0YXJ0SW5saW5lRWRpdChpbm5lciwge1xuICAgICAgY2xhc3NFbDogc2VsZixcbiAgICAgIG9uRmluaXNoOiBhc3luYyAoY29tbWl0LCB0ZXh0KSA9PiB7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gbm9ybWFsaXplVHlwTmFtZSh0ZXh0KTtcbiAgICAgICAgaWYgKGNvbW1pdCAmJiB2YWx1ZSkge1xuICAgICAgICAgIC8vIExpa2UgYSBTdWJ0eXAgdGhhdCBhbHJlYWR5IGV4aXN0cyAoc2VlIHN0YXJ0QWRkU3VidHlwKTogc2F5IHNvXG4gICAgICAgICAgLy8gaW5zdGVhZCBvZiBsZXR0aW5nIHRoZSBpbnB1dCB2YW5pc2ggd2l0aG91dCBhIHdvcmQuXG4gICAgICAgICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBzLmZpbmQoKHQpID0+IHQudG9Mb3dlckNhc2UoKSA9PT0gdmFsdWUudG9Mb3dlckNhc2UoKSk7XG4gICAgICAgICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICAgICAgICBuZXcgTm90aWNlKGBUWVAgJHtleGlzdGluZ30gYWxyZWFkeSBleGlzdHMuYCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cHMucHVzaCh2YWx1ZSk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgIHRoaXMucmVmcmVzaE90aGVyVmlld3MoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICAvLyBFdmVyeSBpbmxpbmUgaW5wdXQgb2YgdGhlIHBhbmUgLSBhIG5ldyBUWVAgb3IgU3VidHlwLCByZW5hbWluZyBvbmUgaW4gdGhlXG4gIC8vIGxpc3QsIHRoZSBkZXRhaWwgdGl0bGUgb3IgYSBibG9jayBoZWFkaW5nIC0gd29ya3MgdGhlIHNhbWUgd2F5LCBsaWtlXG4gIC8vIE9ic2lkaWFuJ3MgdHJlZSBpdGVtczogbm8gZXh0cmEgaW5wdXQsIHRoZSB0ZXh0IGVsZW1lbnQgaXRzZWxmIGJlY29tZXNcbiAgLy8gY29udGVudGVkaXRhYmxlLiBFbnRlciBjb21taXRzLCBFc2NhcGUgY2FuY2VscywgbGVhdmluZyB0aGUgZmllbGQgKGJsdXIpXG4gIC8vIGNvbW1pdHMgdG9vLiBvbkZpbmlzaChjb21taXQsIHRleHQpIGRvZXMgdGhlIHJlc3Q7IGl0IHNob3VsZCBlbmQgaW5cbiAgLy8gcmVuZGVyKCkgb3IgYSBkaWFsb2cgd2hvc2UgY2FsbGJhY2tzIHJlbmRlci5cbiAgLy9cbiAgLy8gICBjbGFzc0VsICAgICAtIGdldHMgdGhlIGNsYXNzZXMgKHRoZSB3aG9sZSByb3cgaW4gdGhlIGxpc3QpXG4gIC8vICAgY2xhc3NlcyAgICAgLSBtYXJrcyB0aGUgaW5wdXQgc3RhdGUgKHN0eWxlcy5jc3MsIG1ha2VTZWFyY2hhYmxlKVxuICAvLyAgIHN0b3BBbGxLZXlzIC0ga2VlcHMgZXZlcnkga2V5IGZyb20gdGhlIHN1cnJvdW5kaW5ncywgbm90IG9ubHkgRW50ZXIgYW5kXG4gIC8vICAgICAgICAgICAgICAgICBFc2NhcGUgKGEgYmxvY2sgaGVhZGluZyBpbnNpZGUgdGhlIHByb3BlcnR5IGVkaXRvcnMsXG4gIC8vICAgICAgICAgICAgICAgICB3aG9zZSBrZXlib2FyZCBuYXZpZ2F0aW9uIHdvdWxkIHJlYWN0IHRvbylcbiAgLy9cbiAgLy8gV2hpbGUgdGhlIGlucHV0IHJ1bnMsIHJlbmRlcigpIGlzIGRlZmVycmVkIChzZWUgdGhlcmUpIC0gYSByZWJ1aWxkIHdvdWxkXG4gIC8vIHJlbW92ZSB0aGUgZWxlbWVudCwgYW5kIHRoZSBibHVyIHRoYXQgZm9sbG93cyB3b3VsZCBjb21taXQgYSBoYWxmLXR5cGVkIG9yXG4gIC8vIGVtcHR5IG5hbWUuXG4gIHN0YXJ0SW5saW5lRWRpdChlbCwgeyBjbGFzc0VsID0gZWwsIGNsYXNzZXMgPSBbXCJpcy1iZWluZy1yZW5hbWVkXCJdLCBzdG9wQWxsS2V5cyA9IGZhbHNlLCBvbkZpbmlzaCB9KSB7XG4gICAgaWYgKHRoaXMuaXNFZGl0aW5nKSByZXR1cm4gZmFsc2U7XG4gICAgdGhpcy5pc0VkaXRpbmcgPSB0cnVlO1xuXG4gICAgaWYgKGNsYXNzZXMubGVuZ3RoID4gMCkgY2xhc3NFbC5hZGRDbGFzcyguLi5jbGFzc2VzKTtcbiAgICBlbC5zZXRBdHRyaWJ1dGUoXCJjb250ZW50ZWRpdGFibGVcIiwgXCJ0cnVlXCIpO1xuICAgIGVsLnNldEF0dHJpYnV0ZShcInNwZWxsY2hlY2tcIiwgXCJmYWxzZVwiKTtcbiAgICBlbC5mb2N1cygpO1xuXG4gICAgY29uc3QgcmFuZ2UgPSBlbC5kb2MuY3JlYXRlUmFuZ2UoKTtcbiAgICByYW5nZS5zZWxlY3ROb2RlQ29udGVudHMoZWwpO1xuICAgIGNvbnN0IHNlbGVjdGlvbiA9IGVsLndpbi5nZXRTZWxlY3Rpb24oKTtcbiAgICBzZWxlY3Rpb24ucmVtb3ZlQWxsUmFuZ2VzKCk7XG4gICAgc2VsZWN0aW9uLmFkZFJhbmdlKHJhbmdlKTtcblxuICAgIGxldCBkb25lID0gZmFsc2U7XG4gICAgY29uc3QgZmluaXNoID0gYXN5bmMgKGNvbW1pdCkgPT4ge1xuICAgICAgaWYgKGRvbmUpIHJldHVybjtcbiAgICAgIGRvbmUgPSB0cnVlO1xuICAgICAgdGhpcy5pc0VkaXRpbmcgPSBmYWxzZTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IG9uRmluaXNoKGNvbW1pdCwgZWwudGV4dENvbnRlbnQgPz8gXCJcIik7XG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICAvLyBBIHJlbmRlciByZXF1ZXN0ZWQgZHVyaW5nIHRoZSBpbnB1dCB3YXMgb25seSBkZWZlcnJlZC4gb25GaW5pc2hcbiAgICAgICAgLy8gdXN1YWxseSByZW5kZXJlZCBhbHJlYWR5ICh3aGljaCBjbGVhcnMgdGhlIGZsYWcpOyBpZiBpdCBsZWZ0IHRoZVxuICAgICAgICAvLyB2aWV3IHRvIGEgZGlhbG9nLCBjYXRjaCB1cCBub3cuXG4gICAgICAgIGlmICh0aGlzLl9yZW5kZXJQZW5kaW5nKSB0aGlzLnJlbmRlcigpO1xuICAgICAgfVxuICAgIH07XG5cbiAgICBlbC5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGlmIChzdG9wQWxsS2V5cykgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVudGVyXCIpIHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgIGZpbmlzaCh0cnVlKTtcbiAgICAgIH0gZWxzZSBpZiAoZXZlbnQua2V5ID09PSBcIkVzY2FwZVwiKSB7XG4gICAgICAgIC8vIHN0b3BQcm9wYWdhdGlvbiwgb3IgdGhlIGRldGFpbCB2aWV3J3Mgb3duIEVzY2FwZSBoYW5kbGVyIChzZWVcbiAgICAgICAgLy8gb25PcGVuKSB3b3VsZCBsZWF2ZSBpdCBhcyB3ZWxsLlxuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgZmluaXNoKGZhbHNlKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICAvLyBBIGJsdXIgYmVjYXVzZSB0aGUgZWxlbWVudCBsZWZ0IHRoZSBET00gKHRoZSB2aWV3IGNsb3NlZCwgc2F5KSBpcyBub1xuICAgIC8vIGRlY2lzaW9uIG9mIHRoZSB1c2VyJ3MgYW5kIG11c3Qgbm90IGNvbW1pdC4gQ2hlY2tlZCBhIG1pY3JvdGFzayBsYXRlcjpcbiAgICAvLyB3aGlsZSBpdCBpcyBiZWluZyByZW1vdmVkLCB0aGUgZWxlbWVudCBtYXkgc3RpbGwgY291bnQgYXMgY29ubmVjdGVkLlxuICAgIGVsLmFkZEV2ZW50TGlzdGVuZXIoXCJibHVyXCIsICgpID0+IHF1ZXVlTWljcm90YXNrKCgpID0+IGZpbmlzaChlbC5pc0Nvbm5lY3RlZCkpKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8vIFN3aXRjaGluZyBiZXR3ZWVuIGxpc3QgYW5kIGRldGFpbCB2aWV3IHN0YXJ0cyBhdCB0aGUgdG9wOyBldmVyeSBvdGhlclxuICAvLyByZW5kZXIoKSBrZWVwcyB0aGUgc2Nyb2xsIHBvc2l0aW9uIChzZWUgdGhlcmUpLlxuICBvcGVuVHlwU2V0dGluZ3ModHlwKSB7XG4gICAgdGhpcy5zZWxlY3RlZFR5cCA9IHR5cDtcbiAgICB0aGlzLl9yZXNldFNjcm9sbCA9IHRydWU7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgfVxuXG4gIGNsb3NlVHlwU2V0dGluZ3MoKSB7XG4gICAgdGhpcy5zZWxlY3RlZFR5cCA9IG51bGw7XG4gICAgdGhpcy5fcmVzZXRTY3JvbGwgPSB0cnVlO1xuICAgIHRoaXMucmVuZGVyKCk7XG4gIH1cblxuICAvLyBUaGUgZWRpdG9ycyBhcmUgY29tcG9uZW50IGNoaWxkcmVuIChzZWUgbW91bnRGcm9udG1hdHRlckVkaXRvcikgYW5kIG11c3RcbiAgLy8gYmUgdW5sb2FkZWQgYmVmb3JlIGV2ZXJ5IHJlYnVpbGQgLSBjb250ZW50RWwuZW1wdHkoKSBhbG9uZSB3b3VsZCByZW1vdmUgdGhlXG4gIC8vIERPTSBidXQgbGVhdmUgZWFjaCBlZGl0b3IncyBtZXRhZGF0YVR5cGVNYW5hZ2VyIGxpc3RlbmVyIGJlaGluZC5cbiAgLy8gZnJvbnRtYXR0ZXJCbG9ja3MgY29udHJvbHMgYWxsIGJsb2NrcyAodXNlZCBieSBcIkFkZCBUWVAtRnJvbnRtYXR0ZXJcbiAgLy8gcHJvcGVydHlcIiksIGZyb250bWF0dGVyRWRpdG9ycyBob2xkcyBldmVyeSBlZGl0b3IgaW5jbC4gU3VidHlwIGJsb2Nrcy5cbiAgZGVzdHJveUZyb250bWF0dGVyRWRpdG9yKCkge1xuICAgIGZvciAoY29uc3QgZWRpdG9yIG9mIHRoaXMuZnJvbnRtYXR0ZXJFZGl0b3JzID8/IFtdKSB0aGlzLnJlbW92ZUNoaWxkKGVkaXRvcik7XG4gICAgdGhpcy5mcm9udG1hdHRlckVkaXRvcnMgPSBbXTtcbiAgICB0aGlzLmZyb250bWF0dGVyQmxvY2tzID0gbnVsbDtcbiAgfVxuXG4gIC8vIFRoZSBsaXN0IG9mIFRlbXBsYXRlciBzY3JpcHRzIGNoYW5nZWQgKHNlZSByZWdpc3RlclR5cFBhbmUpOiBvbmx5IHRoZVxuICAvLyBzaG9ydGN1dCBidXR0b25zIG9mIHRoZSBvcGVuIGVkaXRvcnMgZm9sbG93IC0gdGhlaXIgXCJzY3JpcHQgbm90IGZvdW5kXCJcbiAgLy8gd2FybmluZyBkZXBlbmRzIG9uIGl0LiBObyByZW5kZXIoKTogbm90aGluZyBlbHNlIGNoYW5nZWQsIGFuZCBhIHJlYnVpbGRcbiAgLy8gd291bGQgY29zdCB0aGUgZm9jdXMgb2YgYSBmaWVsZCBiZWluZyB0eXBlZCBpbi5cbiAgcmVmcmVzaFNob3J0Y3V0Q29udHJvbHMoKSB7XG4gICAgZm9yIChjb25zdCBlZGl0b3Igb2YgdGhpcy5mcm9udG1hdHRlckVkaXRvcnMgPz8gW10pIHtcbiAgICAgIGNvbnN0IHN0b3JlID0gZWRpdG9yLm93bmVyPy50eXBTdG9yZTtcbiAgICAgIGlmIChzdG9yZSkgcmVuZGVyU2hvcnRjdXRDb250cm9scyh0aGlzLCBlZGl0b3IsIHN0b3JlKTtcbiAgICB9XG4gIH1cblxuICAvLyBGb2N1cyBpbiBvbmUgb2YgdGhlIHBhbmUncyBmaWVsZHMgKHNlZSBpc0ZpZWxkKS5cbiAgaGFzRmllbGRGb2N1cygpIHtcbiAgICBjb25zdCBhY3RpdmUgPSB0aGlzLmNvbnRlbnRFbC5kb2MuYWN0aXZlRWxlbWVudDtcbiAgICByZXR1cm4gISFhY3RpdmUgJiYgdGhpcy5jb250ZW50RWwuY29udGFpbnMoYWN0aXZlKSAmJiBpc0ZpZWxkKGFjdGl2ZSk7XG4gIH1cblxuICAvLyBBIHJlYnVpbGQgcmVxdWVzdGVkIGZyb20gb3V0c2lkZSAocmVnaXN0ZXJUeXBQYW5lOiByZWZyZXNoVHlwQ29sb3JzKCksIGFuXG4gIC8vIGluZGV4IGNoYW5nZSwgU3luYywgVW5kbykuIFdoaWxlIHNvbWVvbmUgdHlwZXMgaW4gdGhpcyBwYW5lIC0gYVxuICAvLyBkZXNjcmlwdGlvbiwgYSBwcm9wZXJ0eSwgYW4gaW5saW5lIG5hbWUgLSBpdCB3b3VsZCB0aHJvdyB0aGUgZmllbGQgYXdheVxuICAvLyB3aXRoIHRleHQsIGN1cnNvciBhbmQgZm9jdXMsIHNvIGl0IHdhaXRzIHVudGlsIHRoZSBmb2N1cyBsZWF2ZXMgdGhlXG4gIC8vIGZpZWxkcyAoc2VlIG9uT3Blbikgb3IgdGhlIGlubGluZSBpbnB1dCBlbmRzIChzZWUgc3RhcnRJbmxpbmVFZGl0KS4gVGhlXG4gIC8vIHBhbmUncyBvd24gYWN0aW9ucyBjYWxsIHJlbmRlcigpIGRpcmVjdGx5IGFuZCB0YWtlIGVmZmVjdCBhdCBvbmNlLlxuICByZXF1ZXN0UmVuZGVyKCkge1xuICAgIGlmICh0aGlzLmhhc0ZpZWxkRm9jdXMoKSkge1xuICAgICAgdGhpcy5fcmVuZGVyUGVuZGluZyA9IHRydWU7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMucmVuZGVyKCk7XG4gIH1cblxuICByZW5kZXIoKSB7XG4gICAgLy8gUmVlbnRyYW5jeSBndWFyZDogYSByZW5kZXIgcmVhY2hlZCBmcm9tIGluc2lkZSByZW5kZXIoKSBtdXN0IG5vdFxuICAgIC8vIHJlYnVpbGQgdGhlIGhhbGYtYnVpbHQgdmlldy4gSXQgb25jZSByZWN1cnNlZCBpbnRvIGEgc3RhY2sgb3ZlcmZsb3cgb25cbiAgICAvLyBldmVyeSBUWVAgb3BlbmVkLCB3aGVuIHJlbmRlclR5cFNldHRpbmdzKCkgc3RpbGwgZW5kZWQgd2l0aCB0aGUgZnVsbFxuICAgIC8vIHJlZnJlc2hUeXBDb2xvcnMoKSAoaXQgbm93IGNhbGxzIG9ubHkgcmVmcmVzaEZyb250bWF0dGVySGlnaGxpZ2h0KS5cbiAgICBpZiAodGhpcy5fcmVuZGVyaW5nKSByZXR1cm47XG4gICAgLy8gQW4gaW5saW5lIGlucHV0IGlzIHJ1bm5pbmcgKHNlZSBzdGFydElubGluZUVkaXQpOiBhIHJlYnVpbGQgbm93IHdvdWxkXG4gICAgLy8gdGhyb3cgaXQgYXdheSBtaWQtdHlwaW5nIC0gYW5kIGNvbW1pdCBpdCB0aHJvdWdoIHRoZSBibHVyLiBTbyB0aGUgcmVuZGVyXG4gICAgLy8gKGFuIGluZGV4IGNoYW5nZSwgYSByZWZyZXNoIGZyb20gZWxzZXdoZXJlKSB3YWl0cyBmb3IgdGhlIGlucHV0IHRvIGVuZC5cbiAgICBpZiAodGhpcy5pc0VkaXRpbmcpIHtcbiAgICAgIHRoaXMuX3JlbmRlclBlbmRpbmcgPSB0cnVlO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLl9yZW5kZXJQZW5kaW5nID0gZmFsc2U7XG4gICAgdGhpcy5fcmVuZGVyaW5nID0gdHJ1ZTtcbiAgICAvLyBUaGUgcmVidWlsZCBrZWVwcyB0aGUgc2Nyb2xsIHBvc2l0aW9uLCBzbyBhIGxvbmcgVFlQIGRvZXNuJ3QganVtcCB0byB0aGVcbiAgICAvLyB0b3AgYWZ0ZXIgZXZlcnkgY2hhbmdlOyBvbmx5IHN3aXRjaGluZyBiZXR3ZWVuIGxpc3QgYW5kIGRldGFpbCB2aWV3XG4gICAgLy8gc3RhcnRzIGF0IHRoZSB0b3AgKG9wZW5UeXBTZXR0aW5ncy9jbG9zZVR5cFNldHRpbmdzKS5cbiAgICBjb25zdCBzY3JvbGxUb3AgPSB0aGlzLl9yZXNldFNjcm9sbCA/IDAgOiB0aGlzLmNvbnRlbnRFbC5zY3JvbGxUb3A7XG4gICAgdGhpcy5fcmVzZXRTY3JvbGwgPSBmYWxzZTtcbiAgICB0cnkge1xuICAgICAgdGhpcy5kZXN0cm95RnJvbnRtYXR0ZXJFZGl0b3IoKTtcbiAgICAgIGlmICh0aGlzLnNlbGVjdGVkVHlwICE9PSBudWxsKSB7XG4gICAgICAgIHRoaXMucmVuZGVyVHlwU2V0dGluZ3ModGhpcy5zZWxlY3RlZFR5cCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgICBjb250ZW50RWwuZW1wdHkoKTtcblxuICAgICAgY29uc3QgeyBjb3VudHMsIG5vVHlwIH0gPSB0aGlzLnBsdWdpbi50eXBJbmRleC50eXBDb3VudHMoKTtcbiAgICAgIGNvbnN0IHJlZ2lzdGVyZWQgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBzO1xuICAgICAgY29uc3QgdHlwQ29sb3JzID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzO1xuICAgICAgY29uc3Qgc29ydE9yZGVyID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwU29ydE9yZGVyID8/IERFRkFVTFRfU09SVF9PUkRFUjtcbiAgICAgIGNvbnN0IGlzTWFudWFsU29ydCA9IHNvcnRPcmRlciA9PT0gXCJtYW51YWxcIjtcbiAgICAgIGNvbnN0IGJ5Q3VycmVudE9yZGVyID0gKGEsIGIpID0+IGNvbXBhcmVUeXBzKHNvcnRPcmRlciwgYSwgYiwgY291bnRzLCB0eXBDb2xvcnMpO1xuXG4gICAgICB0aGlzLnJlbmRlckxpc3RIZWFkZXIoY29udGVudEVsKTtcblxuICAgICAgY29uc3QgdW5yZWdpc3RlcmVkUm93cyA9IFsuLi5jb3VudHMua2V5cygpXVxuICAgICAgICAuZmlsdGVyKCh0eXApID0+ICFyZWdpc3RlcmVkLmluY2x1ZGVzKHR5cCkpXG4gICAgICAgIC5zb3J0KGJ5Q3VycmVudE9yZGVyKVxuICAgICAgICAubWFwKCh0eXApID0+ICh7IHR5cCwgY291bnQ6IGNvdW50cy5nZXQodHlwKSA/PyAwIH0pKTtcbiAgICAgIGNvbnN0IHVucmVnaXN0ZXJlZFN1YnR5cFJvd3MgPSB0aGlzLnVucmVnaXN0ZXJlZFN1YnR5cFJvd3MoKTtcblxuICAgICAgLy8gV2l0aG91dCBhIHNlY29uZCBjb2x1bW4gdGhlIG5hbWUgbWF5IHRha2UgdGhlIHdob2xlIHJvdyAoc2VlXG4gICAgICAvLyAudHlwLWxpc3Qtbm8tc2Vjb25kYXJ5IGluIHN0eWxlcy5jc3MpLlxuICAgICAgY29uc3QgbGlzdENscyA9IFwidHlwLWxpc3QgbmF2LWZpbGVzLWNvbnRhaW5lclwiICsgKHRoaXMuc2Vjb25kYXJ5TW9kZSgpID09PSBcIm5vbmVcIiA/IFwiIHR5cC1saXN0LW5vLXNlY29uZGFyeVwiIDogXCJcIik7XG4gICAgICB0aGlzLmxpc3RFbCA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IGxpc3RDbHMgfSk7XG4gICAgICB0aGlzLnNlcGFyYXRvckVsID0gbnVsbDtcblxuICAgICAgLy8gSW4gbWFudWFsIG1vZGUgc29ydFR5cHNCeU1vZGUoKSBrZWVwcyB0aGUgb3JkZXIgb2Ygc2V0dGluZ3MudHlwcyxcbiAgICAgIC8vIHdoaWNoIGRyYWcgJiBkcm9wIGluIHJlbmRlclJlZ2lzdGVyZWRJdGVtKCkgcmVhcnJhbmdlczsgaW5kZXggaXMgdGhlXG4gICAgICAvLyBwb3NpdGlvbiBpbiB0aGF0IG9yZGVyLlxuICAgICAgY29uc3QgcmVnaXN0ZXJlZE9yZGVyID0gc29ydFR5cHNCeU1vZGUocmVnaXN0ZXJlZCwgc29ydE9yZGVyLCBjb3VudHMsIHR5cENvbG9ycyk7XG4gICAgICByZWdpc3RlcmVkT3JkZXIuZm9yRWFjaCgodHlwLCBpbmRleCkgPT4ge1xuICAgICAgICB0aGlzLnJlbmRlclJlZ2lzdGVyZWRJdGVtKHR5cCwgY291bnRzLmdldCh0eXApID8/IDAsIHsgZHJhZ2dhYmxlOiBpc01hbnVhbFNvcnQsIGluZGV4IH0pO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIEJlbG93IHRoZSBzZXBhcmF0b3IgdGhyZWUgb3B0aW9uYWwgc2VjdGlvbnM6IHVucmVnaXN0ZXJlZCBUWVAgdmFsdWVzLFxuICAgICAgLy8gdW5yZWdpc3RlcmVkIFN1YnR5cHMsIFwiW05PIFRZUF1cIi4gVGhlIFN1YnR5cHMgZ2V0IHRoZWlyIG93biBzZXBhcmF0b3JcbiAgICAgIC8vIGJlY2F1c2UgdGhleSBzb3J0IGJ5IGEgZGlmZmVyZW50IHJ1bGUgKGNvdW50LCBub3QgdGhlIHNvcnQgYnV0dG9uKSAtXG4gICAgICAvLyB3aXRob3V0IGEgdmlzaWJsZSBjdXQgaXQgd291bGQgbG9vayBsaWtlIGJyb2tlbiBzb3J0aW5nLiBcIltOTyBUWVBdXCIgaXNcbiAgICAgIC8vIG5vIHJlYWwgVFlQLCB0YWtlcyBubyBwYXJ0IGluIHNvcnRpbmcgYW5kIGFsd2F5cyBjb21lcyBsYXN0LCB3aXRob3V0IGFcbiAgICAgIC8vIHRoaXJkIGxpbmUuXG4gICAgICAvL1xuICAgICAgLy8gdGhpcy5zZXBhcmF0b3JFbCBzdGF5cyB0aGUgRklSU1QgbGluZTogc3RhcnRBZGQoKSBpbnNlcnRzIHRoZSBuZXcgaXRlbVxuICAgICAgLy8gYmVmb3JlIGl0LCBhbmQgYSBuZXcgVFlQIGJlbG9uZ3MgYWZ0ZXIgdGhlIHJlZ2lzdGVyZWQgb25lcy5cbiAgICAgIGNvbnN0IHNlcGFyYXRvciA9ICgpID0+IHtcbiAgICAgICAgY29uc3QgZWwgPSB0aGlzLmxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLXNlcGFyYXRvclwiIH0pO1xuICAgICAgICB0aGlzLnNlcGFyYXRvckVsID0gdGhpcy5zZXBhcmF0b3JFbCA/PyBlbDtcbiAgICAgIH07XG5cbiAgICAgIGlmICh1bnJlZ2lzdGVyZWRSb3dzLmxlbmd0aCA+IDAgfHwgdW5yZWdpc3RlcmVkU3VidHlwUm93cy5sZW5ndGggPiAwIHx8IG5vVHlwID4gMCkgc2VwYXJhdG9yKCk7XG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiB1bnJlZ2lzdGVyZWRSb3dzKSB0aGlzLnJlbmRlclVucmVnaXN0ZXJlZEl0ZW0ocm93LnR5cCwgcm93LmNvdW50KTtcblxuICAgICAgaWYgKHVucmVnaXN0ZXJlZFN1YnR5cFJvd3MubGVuZ3RoID4gMCkge1xuICAgICAgICBpZiAodW5yZWdpc3RlcmVkUm93cy5sZW5ndGggPiAwKSBzZXBhcmF0b3IoKTtcbiAgICAgICAgZm9yIChjb25zdCByb3cgb2YgdW5yZWdpc3RlcmVkU3VidHlwUm93cykgdGhpcy5yZW5kZXJVbnJlZ2lzdGVyZWRTdWJ0eXBJdGVtKHJvdyk7XG4gICAgICB9XG5cbiAgICAgIGlmIChub1R5cCA+IDApIHRoaXMucmVuZGVyTm9UeXBJdGVtKG5vVHlwKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5jb250ZW50RWwuc2Nyb2xsVG9wID0gc2Nyb2xsVG9wO1xuICAgICAgdGhpcy5fcmVuZGVyaW5nID0gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgLy8gTGlrZSB0aGUgXCJDaGFuZ2Ugc29ydCBvcmRlclwiIGJ1dHRvbiBpbiBPYnNpZGlhbidzIHRhZ3MgYW5kIGFsbC1wcm9wZXJ0aWVzXG4gIC8vIHZpZXdzLlxuICByZW5kZXJMaXN0SGVhZGVyKGNvbnRlbnRFbCkge1xuICAgIGNvbnN0IGhlYWRlciA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwibmF2LWhlYWRlclwiIH0pO1xuICAgIGNvbnN0IGJ1dHRvbnNDb250YWluZXIgPSBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcIm5hdi1idXR0b25zLWNvbnRhaW5lclwiIH0pO1xuXG4gICAgY29uc3QgYWRkQnRuID0gYnV0dG9uc0NvbnRhaW5lci5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIG5hdi1hY3Rpb24tYnV0dG9uXCIsXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkFkZCBUWVBcIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24oYWRkQnRuLCBcInBsdXNcIik7XG4gICAgYWRkQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnN0YXJ0QWRkKCkpO1xuXG4gICAgY29uc3Qgc29ydEJ0biA9IGJ1dHRvbnNDb250YWluZXIuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiBuYXYtYWN0aW9uLWJ1dHRvblwiLFxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJDaGFuZ2Ugc29ydCBvcmRlclwiIH0sXG4gICAgfSk7XG4gICAgc2V0SWNvbihzb3J0QnRuLCBcImx1Y2lkZS1zb3J0LWFzY1wiKTtcbiAgICBzb3J0QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IHRoaXMuc2hvd1NvcnRNZW51KGV2ZW50KSk7XG5cbiAgICAvLyBTZWNvbmQgY29sdW1uOiBhIGJ1dHRvbiBjeWNsaW5nIHRoZSB0aHJlZSBtb2RlcyByYXRoZXIgdGhhbiBhIG1lbnUgLVxuICAgIC8vIHdpdGggc28gZmV3IHN0YXRlcyB3aG9zZSBlZmZlY3Qgc2hvd3MgcmlnaHQgYmVsb3csIGNsaWNraW5nIHRocm91Z2ggaXNcbiAgICAvLyBmYXN0ZXIuIEljb24gYW5kIHRvb2x0aXAgc2hvdyB0aGUgY3VycmVudCBtb2RlLlxuICAgIGNvbnN0IGN1cnJlbnQgPSBTRUNPTkRBUllfTU9ERVNbdGhpcy5zZWNvbmRhcnlJbmRleCgpXTtcbiAgICBjb25zdCBzZWNvbmRhcnlCdG4gPSBidXR0b25zQ29udGFpbmVyLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gbmF2LWFjdGlvbi1idXR0b25cIixcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IGBOZXh0IHRvIG5hbWU6ICR7Y3VycmVudC50aXRsZX1gIH0sXG4gICAgfSk7XG4gICAgc2V0SWNvbihzZWNvbmRhcnlCdG4sIGN1cnJlbnQuaWNvbik7XG4gICAgc2Vjb25kYXJ5QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmN5Y2xlU2Vjb25kYXJ5KCkpO1xuICB9XG5cbiAgLy8gc2V0dGluZ3MudHlwTGlzdFNlY29uZGFyeSwgYnV0IGFsd2F5cyBhIHZhbGlkIG1vZGUgLSBvbGRlciBkYXRhIG1heSBsYWNrXG4gIC8vIHRoZSBrZXksIGFuZCBhIG1vZGUgcmVtb3ZlZCBsYXRlciBzaG91bGRuJ3QgbGVhdmUgdGhlIGxpc3QgZW1wdHkuXG4gIHNlY29uZGFyeU1vZGUoKSB7XG4gICAgY29uc3QgbW9kZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cExpc3RTZWNvbmRhcnk7XG4gICAgcmV0dXJuIFNFQ09OREFSWV9NT0RFUy5zb21lKChlbnRyeSkgPT4gZW50cnkubW9kZSA9PT0gbW9kZSkgPyBtb2RlIDogREVGQVVMVF9TRUNPTkRBUlk7XG4gIH1cblxuICBzZWNvbmRhcnlJbmRleCgpIHtcbiAgICByZXR1cm4gU0VDT05EQVJZX01PREVTLmZpbmRJbmRleCgoZW50cnkpID0+IGVudHJ5Lm1vZGUgPT09IHRoaXMuc2Vjb25kYXJ5TW9kZSgpKTtcbiAgfVxuXG4gIGFzeW5jIGN5Y2xlU2Vjb25kYXJ5KCkge1xuICAgIGNvbnN0IG5leHQgPSBTRUNPTkRBUllfTU9ERVNbKHRoaXMuc2Vjb25kYXJ5SW5kZXgoKSArIDEpICUgU0VDT05EQVJZX01PREVTLmxlbmd0aF07XG4gICAgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwTGlzdFNlY29uZGFyeSA9IG5leHQubW9kZTtcbiAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAvLyBPbmx5IHRoaXMgbGlzdCBjaGFuZ2VzLCBzbyBubyByZWZyZXNoVHlwQ29sb3JzKCkgYWNyb3NzIGFsbCB2aWV3cy5cbiAgICB0aGlzLnJlbmRlcigpO1xuICB9XG5cbiAgc2hvd1NvcnRNZW51KGV2ZW50KSB7XG4gICAgY29uc3QgY3VycmVudCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cFNvcnRPcmRlciA/PyBERUZBVUxUX1NPUlRfT1JERVI7XG4gICAgY29uc3QgbWVudSA9IG5ldyBNZW51KCk7XG5cbiAgICBjb25zdCBhZGRHcm91cCA9IChzdGFydCwgZW5kKSA9PiB7XG4gICAgICBmb3IgKGxldCBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgICAgICBjb25zdCB7IG1vZGUsIHRpdGxlIH0gPSBTT1JUX09QVElPTlNbaV07XG4gICAgICAgIG1lbnUuYWRkSXRlbSgoaXRlbSkgPT5cbiAgICAgICAgICBpdGVtXG4gICAgICAgICAgICAuc2V0VGl0bGUodGl0bGUpXG4gICAgICAgICAgICAuc2V0Q2hlY2tlZChjdXJyZW50ID09PSBtb2RlKVxuICAgICAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBTb3J0T3JkZXIgPSBtb2RlO1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfTtcblxuICAgIGFkZEdyb3VwKDAsIDEpO1xuICAgIG1lbnUuYWRkU2VwYXJhdG9yKCk7XG4gICAgYWRkR3JvdXAoMSwgMyk7XG4gICAgbWVudS5hZGRTZXBhcmF0b3IoKTtcbiAgICBhZGRHcm91cCgzLCA1KTtcbiAgICBtZW51LmFkZFNlcGFyYXRvcigpO1xuICAgIGFkZEdyb3VwKDUsIDcpO1xuXG4gICAgbWVudS5zaG93QXRNb3VzZUV2ZW50KGV2ZW50KTtcbiAgfVxuXG4gIHJlbmRlck5vVHlwSXRlbShjb3VudCkge1xuICAgIGNvbnN0IHRyZWVJdGVtID0gdGhpcy5saXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbVwiIH0pO1xuICAgIGNvbnN0IHNlbGYgPSB0cmVlSXRlbS5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLXNlbGYgaXMtY2xpY2thYmxlIHR5cC11bnJlZ2lzdGVyZWRcIiB9KTtcbiAgICBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0taW5uZXJcIiwgdGV4dDogXCJbTk8gVFlQXVwiIH0pO1xuICAgIHRoaXMucmVuZGVyQ291bnRGbGFpcihzZWxmLCBjb3VudCk7XG5cbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLm9wZW5TZWFyY2gobnVsbCkpO1xuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNvbnRleHRtZW51XCIsIChldmVudCkgPT4ge1xuICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgdGhpcy5vcGVuU2VhcmNoKG51bGwpO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gQ2hyb21pdW0ncyBpbnB1dFt0eXBlPWNvbG9yXSBoYXMgYSBtaW5pbXVtIHN3YXRjaCB0aGF0IHdvbid0IHNjYWxlIGJlbG93XG4gIC8vIHRleHQgc2l6ZSwgc28gaXQgaXMgb25seSBhbiBpbnZpc2libGUgdHJpZ2dlciBvdmVyIGEgZnJlZWx5IHNjYWxhYmxlIGRvdC5cbiAgLy8gV2l0aG91dCBhIGNvbG9yIHRoZSBkb3QgaXMgYSBob2xsb3cgZ3JheSByaW5nIChzZWUgcGFpbnRDb2xvckRvdCk7IHdpdGhcbiAgLy8gc2hvd1Jlc2V0IChkZXRhaWwgdmlldykgYSB0b29sdGlwIG5hbWVzIHRoZSBzdGF0ZSBhbmQgdGhlIHJlc2V0IGJ1dHRvbiBpc1xuICAvLyBncmF5ZWQgb3V0LlxuICByZW5kZXJDb2xvclBpY2tlcihwYXJlbnQsIHR5cCwgb25DaGFuZ2UsIHsgc2hvd1Jlc2V0ID0gZmFsc2UgfSA9IHt9KSB7XG4gICAgY29uc3QgY3VycmVudENvbG9yID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPz8gREVGQVVMVF9UWVBfQ09MT1I7XG4gICAgY29uc3QgY29sb3JXcmFwID0gcGFyZW50LmNyZWF0ZURpdih7IGNsczogXCJ0eXAtY29sb3Itd3JhcFwiIH0pO1xuICAgIGNvbnN0IGNvbG9yRG90ID0gY29sb3JXcmFwLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtY29sb3ItZG90XCIgfSk7XG4gICAgbGV0IHJlc2V0QnRuID0gbnVsbDtcbiAgICBjb25zdCBzaG93U3RhdGUgPSAoY29sb3IsIGlzRGVmYXVsdCkgPT4ge1xuICAgICAgcGFpbnRDb2xvckRvdChjb2xvckRvdCwgY29sb3IsIGlzRGVmYXVsdCk7XG4gICAgICBpZiAoIXNob3dSZXNldCkgcmV0dXJuO1xuICAgICAgY29sb3JXcmFwLnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgaXNEZWZhdWx0ID8gXCJEZWZhdWx0IChubyBjb2xvcilcIiA6IFwiQ2hhbmdlIGNvbG9yXCIpO1xuICAgICAgcmVzZXRCdG4/LnRvZ2dsZUNsYXNzKFwiaXMtZGlzYWJsZWRcIiwgaXNEZWZhdWx0KTtcbiAgICB9O1xuXG4gICAgY29uc3QgY29sb3JJbnB1dCA9IGNvbG9yV3JhcC5jcmVhdGVFbChcImlucHV0XCIsIHsgdHlwZTogXCJjb2xvclwiLCBjbHM6IFwidHlwLWNvbG9yLWlucHV0XCIgfSk7XG4gICAgY29sb3JJbnB1dC52YWx1ZSA9IGN1cnJlbnRDb2xvcjtcblxuICAgIC8vIFwiaW5wdXRcIiBmaXJlcyBmb3IgZXZlcnkgaW50ZXJtZWRpYXRlIGNvbG9yIHdoaWxlIHRoZSBuYXRpdmUgcGlja2VyIGlzXG4gICAgLy8gb3BlbiAtIG9ubHkgYSBsb2NhbCBwcmV2aWV3IGhlcmUuIFJlZnJlc2hpbmcgdGhlIHZpZXdzIHdvdWxkIHJlLXJlbmRlclxuICAgIC8vIHRoaXMgb25lLCByZW1vdmUgdGhpcyA8aW5wdXQgdHlwZT1jb2xvcj4gYW5kIGNsb3NlIHRoZSBuYXRpdmUgcGlja2VyXG4gICAgLy8gYmVmb3JlIGEgY29sb3IgY291bGQgZXZlbiBiZSBjaG9zZW4uXG4gICAgLy9cbiAgICAvLyBTYXZpbmcgaXMgYnVuZGxlZDogZGF0YS5qc29uIGlzIHdyaXR0ZW4gb25jZSB0aGUgcG9pbnRlciByZXN0cyBmb3IgYVxuICAgIC8vIG1vbWVudCAoc2F2ZVNvb24pIGFuZCBhdCB0aGUgbGF0ZXN0IG9uIFwiY2hhbmdlXCIsIG5vdCBvbiBldmVyeVxuICAgIC8vIGludGVybWVkaWF0ZSBjb2xvci5cbiAgICAvL1xuICAgIC8vIE9uZSB1bmRvIHNuYXBzaG90IHBlciBwaWNrZXIgc2Vzc2lvbjogdGFrZW4gYmVmb3JlIHRoZSBmaXJzdFxuICAgIC8vIGludGVybWVkaWF0ZSBjb2xvciwgb2ZmZXJlZCBvbmNlIHRoZSBjaG9pY2UgaXMgY29uZmlybWVkIChcImNoYW5nZVwiKS5cbiAgICAvLyBDbGVhcmVkIHdoZW4gdGhlIHBpY2tlciBvcGVucywgc28gYSBzZXNzaW9uIHRoYXQgZW5kZWQgd2l0aG91dCBcImNoYW5nZVwiXG4gICAgLy8gKGJhY2sgdG8gdGhlIG9sZCBjb2xvciwgb3IgY2FuY2VsbGVkKSBsZWF2ZXMgbm8gc3RhbGUgc25hcHNob3QgYmVoaW5kLlxuICAgIGNvbnN0IHNhdmVTb29uID0gZGVib3VuY2UoKCkgPT4gdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCksIDQwMCwgdHJ1ZSk7XG4gICAgbGV0IHVuZG9TbmFwc2hvdCA9IG51bGw7XG4gICAgY29sb3JJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHVuZG9TbmFwc2hvdCA9IG51bGw7XG4gICAgfSk7XG4gICAgY29sb3JJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiaW5wdXRcIiwgKCkgPT4ge1xuICAgICAgdW5kb1NuYXBzaG90ID8/PSBzbmFwc2hvdFNldHRpbmdzKHRoaXMucGx1Z2luKTtcbiAgICAgIHNob3dTdGF0ZShjb2xvcklucHV0LnZhbHVlLCBmYWxzZSk7XG4gICAgICB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdHlwXSA9IGNvbG9ySW5wdXQudmFsdWU7XG4gICAgICBvbkNoYW5nZT8uKGNvbG9ySW5wdXQudmFsdWUpO1xuICAgICAgc2F2ZVNvb24oKTtcbiAgICB9KTtcblxuICAgIC8vIE9uY2UgdGhlIGNob2ljZSBpcyBjb25maXJtZWQgYW5kIHRoZSBwaWNrZXIgY2xvc2VkLCBhIHJlLXJlbmRlciBjYW4ndFxuICAgIC8vIGJyZWFrIGFueXRoaW5nIGFueSBtb3JlLiBUaGUgcGVuZGluZyBzYXZlIGlzIGRvbmUgcmlnaHQgaGVyZSBpbnN0ZWFkIC1cbiAgICAvLyBiZWZvcmUgb2ZmZXJVbmRvKCksIHdoaWNoIHJlY29yZHMgdGhlIHNldHRpbmdzIHJldmlzaW9uIG9mIHRoaXMgc2F2ZVxuICAgIC8vIChhIGxhdGVyIGRlYm91bmNlZCBzYXZlIHdvdWxkIHZvaWQgdGhlIHVuZG8gYXQgb25jZSkuXG4gICAgY29sb3JJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIHNhdmVTb29uLmNhbmNlbCgpO1xuICAgICAgY29uc3Qgc25hcHNob3QgPSB1bmRvU25hcHNob3Q7XG4gICAgICB1bmRvU25hcHNob3QgPSBudWxsO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICBpZiAoc25hcHNob3QgJiYgc25hcHNob3QudHlwQ29sb3JzW3R5cF0gIT09IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdKSB7XG4gICAgICAgIG9mZmVyVW5kbyh0aGlzLnBsdWdpbiwgYENvbG9yIG9mICR7dHlwfSBjaGFuZ2VkLmAsIHNuYXBzaG90KTtcbiAgICAgIH1cbiAgICAgIHRoaXMucmVmcmVzaE90aGVyVmlld3MoKTtcbiAgICAgIC8vIFRoZSBTdWJ0eXAgY29sb3JzIChsaXN0IHByZXZpZXcsIGJsb2NrIGRvdHMpIGRlcml2ZSBmcm9tIHRoaXMgY29sb3IuXG4gICAgICB0aGlzLnJlbmRlcigpO1xuICAgIH0pO1xuXG4gICAgaWYgKHNob3dSZXNldCkge1xuICAgICAgcmVzZXRCdG4gPSBwYXJlbnQuY3JlYXRlRGl2KHtcbiAgICAgICAgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1jb2xvci1yZXNldFwiLFxuICAgICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlJlc2V0IGNvbG9yXCIgfSxcbiAgICAgIH0pO1xuICAgICAgc2V0SWNvbihyZXNldEJ0biwgXCJyb3RhdGUtY2N3XCIpO1xuICAgICAgcmVzZXRCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGFzeW5jICgpID0+IHtcbiAgICAgICAgLy8gTm8gdW5kbyBvZmZlciBmb3IgYSBuby1vcCAodGhlIGJ1dHRvbiBpcyBvbmx5IGdyYXllZCBvdXQpLlxuICAgICAgICBpZiAodGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPT09IHVuZGVmaW5lZCkgcmV0dXJuO1xuICAgICAgICBjb25zdCBzbmFwc2hvdCA9IHNuYXBzaG90U2V0dGluZ3ModGhpcy5wbHVnaW4pO1xuICAgICAgICBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF07XG4gICAgICAgIGNvbG9ySW5wdXQudmFsdWUgPSBERUZBVUxUX1RZUF9DT0xPUjtcbiAgICAgICAgc2hvd1N0YXRlKERFRkFVTFRfVFlQX0NPTE9SLCB0cnVlKTtcbiAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICAgIG9mZmVyVW5kbyh0aGlzLnBsdWdpbiwgYENvbG9yIG9mICR7dHlwfSByZXNldC5gLCBzbmFwc2hvdCk7XG4gICAgICAgIG9uQ2hhbmdlPy4oREVGQVVMVF9UWVBfQ09MT1IpO1xuICAgICAgICB0aGlzLnJlZnJlc2hPdGhlclZpZXdzKCk7XG4gICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgc2hvd1N0YXRlKGN1cnJlbnRDb2xvciwgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPT09IHVuZGVmaW5lZCk7XG5cbiAgICByZXR1cm4gY29sb3JXcmFwO1xuICB9XG5cbiAgLy8gR3VhcmRzIHNldHRpbmdzIG9iamVjdHMgbG9hZGVkIGJlZm9yZSB0eXBNYW51YWwgZXhpc3RlZCAoYSBydW5uaW5nXG4gIC8vIHNlc3Npb24gYWNyb3NzIGEgaG90IHJlbG9hZCwgc2F5KSAtIG90aGVyd2lzZSBldmVyeSBhY2Nlc3MgYmVsb3cgd291bGRcbiAgLy8gdGhyb3cgYW5kIHRha2UgdGhlIHJlc3Qgb2YgcmVuZGVyVHlwU2V0dGluZ3MoKSBkb3duIHdpdGggaXQuXG4gIGVuc3VyZVR5cE1hbnVhbCgpIHtcbiAgICBpZiAoIXRoaXMucGx1Z2luLnNldHRpbmdzLnR5cE1hbnVhbCkgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwTWFudWFsID0ge307XG4gICAgcmV0dXJuIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cE1hbnVhbDtcbiAgfVxuXG4gIC8vIFRoZSBzaGFyZWQgXCJNYW51YWxseSBjcmVhdGFibGVcIiBidXR0b24gb2YgVFlQIChyZW5kZXJNYW51YWxUb2dnbGUpIGFuZFxuICAvLyBTdWJ0eXAgKHJlbmRlclN1YnR5cE1hbnVhbFRvZ2dsZSksIGVhY2ggYmV0d2VlbiByZW5hbWUgYW5kIGRlbGV0ZS4gQW5cbiAgLy8gaWNvbiBidXR0b24gcmF0aGVyIHRoYW4gYSBsYWJlbGVkIHRvZ2dsZSAtIHRvbyBzbWFsbCBhIHNldHRpbmcgZm9yIGl0cyBvd25cbiAgLy8gcm93LiBTdGF0ZSB2aWEgYSBjbGFzcyAoaXMtYWN0aXZlLCBzZWUgc3R5bGVzLmNzcyksIG1lYW5pbmcgaW4gdGhlIHRvb2x0aXA7XG4gIC8vIHJvbGUvYXJpYS1jaGVja2VkIGtlZXAgaXQgcmVhZGFibGUgYXMgYSBzd2l0Y2guXG4gIC8vXG4gIC8vIG9uVG9nZ2xlIGdldHMgdGhlIG5ldyBzdGF0ZSwgc2F2ZXMgaXQgYW5kIHVwZGF0ZXMgdGhlIGRlcGVuZGVudCBidXR0b25zXG4gIC8vIChzZWUgc3luY01hbnVhbFRvZ2dsZXMpIC0gdGhlIGNsaWNrIGRvZXNuJ3QgcGFpbnQgaXRzZWxmLCBzaW5jZSBhIHRvZ2dsZVxuICAvLyBoZXJlIG5ldmVyIGFmZmVjdHMganVzdCB0aGlzIG9uZSBidXR0b24uXG4gIHJlbmRlck1hbnVhbEljb24ocGFyZW50LCBjbHMsIGlzT24sIG9uVG9nZ2xlKSB7XG4gICAgY29uc3QgYnRuID0gcGFyZW50LmNyZWF0ZURpdih7XG4gICAgICBjbHM6IGBjbGlja2FibGUtaWNvbiB0eXAtbWFudWFsLWljb24gJHtjbHN9YCxcbiAgICAgIGF0dHI6IHsgdGFiaW5kZXg6IFwiMFwiLCByb2xlOiBcImNoZWNrYm94XCIgfSxcbiAgICB9KTtcbiAgICBzZXRJY29uKGJ0biwgXCJmaWxlLXBlbi1saW5lXCIpO1xuXG4gICAgYnRuLnR5cFNob3dNYW51YWxTdGF0ZSA9IChvbikgPT4ge1xuICAgICAgYnRuLnRvZ2dsZUNsYXNzKFwiaXMtYWN0aXZlXCIsIG9uKTtcbiAgICAgIGJ0bi5zZXRBdHRyaWJ1dGUoXCJhcmlhLWNoZWNrZWRcIiwgU3RyaW5nKG9uKSk7XG4gICAgICBidG4uc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCBvbiA/IFwiTWFudWFsbHkgY3JlYXRhYmxlXCIgOiBcIk5vdCBtYW51YWxseSBjcmVhdGFibGVcIik7XG4gICAgfTtcbiAgICBidG4udHlwU2hvd01hbnVhbFN0YXRlKGlzT24pO1xuXG4gICAgY29uc3QgdG9nZ2xlID0gKCkgPT4gb25Ub2dnbGUoIWJ0bi5oYXNDbGFzcyhcImlzLWFjdGl2ZVwiKSk7XG4gICAgYnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCB0b2dnbGUpO1xuICAgIGJ0bi5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCAoZXZlbnQpID0+IHtcbiAgICAgIGlmIChldmVudC5rZXkgPT09IFwiRW50ZXJcIiB8fCBldmVudC5rZXkgPT09IFwiIFwiKSB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIHRvZ2dsZSgpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGJ0bjtcbiAgfVxuXG4gIC8vIFRoZSBUWVAncyBcIk1hbnVhbGx5IGNyZWF0YWJsZVwiLCBpbiB0aGUgZGV0YWlsIGhlYWRlciBiZXR3ZWVuIHJlbmFtZSBhbmRcbiAgLy8gZGVsZXRlLiBPbiBieSBkZWZhdWx0LCBzbyBvbmx5IFwib2ZmXCIgKGZhbHNlKSBpcyBzdG9yZWQuIERlY2lkZXMgd2hldGhlclxuICAvLyBnZXRUeXBzKCkgKG1haW4uanMpIHJldHVybnMgdGhlIFRZUC5cbiAgLy9cbiAgLy8gVGhlIFRZUCBhbHdheXMgdGFrZXMgaXRzIFN1YnR5cHMgYWxvbmc6IHRoZSBwaWNrZXIgb25seSByZWFjaGVzIHRoZW1cbiAgLy8gdGhyb3VnaCBpdCwgc28gYSBUWVAgc3dpdGNoZWQgb2ZmIHdvdWxkIHNpbGVudGx5IG1ha2UgdGhlbSB1bnJlYWNoYWJsZVxuICAvLyAoc2VlIHNldEFsbFN1YnR5cHNNYW51YWwgaW4gc3VidHlwcy5qcykuXG4gIHJlbmRlck1hbnVhbFRvZ2dsZShwYXJlbnQsIHR5cCkge1xuICAgIHJldHVybiB0aGlzLnJlbmRlck1hbnVhbEljb24ocGFyZW50LCBcInR5cC1tYW51YWwtdHlwXCIsIHRoaXMuZW5zdXJlVHlwTWFudWFsKClbdHlwXSAhPT0gZmFsc2UsIGFzeW5jIChvbikgPT4ge1xuICAgICAgaWYgKG9uKSBkZWxldGUgdGhpcy5lbnN1cmVUeXBNYW51YWwoKVt0eXBdO1xuICAgICAgZWxzZSB0aGlzLmVuc3VyZVR5cE1hbnVhbCgpW3R5cF0gPSBmYWxzZTtcbiAgICAgIHNldEFsbFN1YnR5cHNNYW51YWwodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgb24pO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICB0aGlzLnN5bmNNYW51YWxUb2dnbGVzKHR5cCk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBBIFN1YnR5cCdzIFwiTWFudWFsbHkgY3JlYXRhYmxlXCIsIGluIGl0cyBibG9jayBmb290ZXIgYmV0d2VlbiByZW5hbWUgYW5kXG4gIC8vIGRlbGV0ZSAoc2VlIHJlbmRlclNlY3Rpb25Gb290ZXIpLiBVbmxpa2UgdGhlIFRZUCBidXR0b24gaXQgcHVsbHMgb25seSBvbmVcbiAgLy8gd2F5OiBzd2l0Y2hpbmcgYSBTdWJ0eXAgb24gYWxzbyBzd2l0Y2hlcyBpdHMgVFlQIG9uIChlbHNlIGl0IHdvdWxkIGJlXG4gIC8vIHVucmVhY2hhYmxlKSwgdGhlIG90aGVyIFN1YnR5cHMgc3RheSBhcyB0aGV5IGFyZSAtIHRoYXQgaXMgdGhlIHBvaW50LlxuICByZW5kZXJTdWJ0eXBNYW51YWxUb2dnbGUocGFyZW50LCB0eXAsIHN1YnR5cCkge1xuICAgIGNvbnN0IGJ0biA9IHRoaXMucmVuZGVyTWFudWFsSWNvbihcbiAgICAgIHBhcmVudCxcbiAgICAgIFwidHlwLW1hbnVhbC1zdWJ0eXBcIixcbiAgICAgIGlzU3VidHlwTWFudWFsKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCksXG4gICAgICBhc3luYyAob24pID0+IHtcbiAgICAgICAgc2V0U3VidHlwTWFudWFsKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCwgb24pO1xuICAgICAgICBpZiAob24pIGRlbGV0ZSB0aGlzLmVuc3VyZVR5cE1hbnVhbCgpW3R5cF07XG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB0aGlzLnN5bmNNYW51YWxUb2dnbGVzKHR5cCk7XG4gICAgICB9XG4gICAgKTtcbiAgICBidG4udHlwU3VidHlwID0gc3VidHlwO1xuICAgIHJldHVybiBidG47XG4gIH1cblxuICAvLyBSZXBhaW50cyBldmVyeSBtYW51YWwgYnV0dG9uIG9mIHRoZSBkZXRhaWwgdmlldyBhZnRlciBvbmUgY2hhbmdlZCB0aGVcbiAgLy8gb3RoZXJzLiBPbmx5IHRoZSBidXR0b25zLCBub3QgcmVuZGVyKCk6IGEgcmVidWlsZCB3b3VsZCByZWNyZWF0ZSBldmVyeVxuICAvLyBibG9jaydzIGVkaXRvcnMsIGluY2x1ZGluZyBhIHJvdyBiZWluZyBlZGl0ZWQuIEZvdW5kIHZpYSB0aGUgRE9NIGxpa2UgdGhlXG4gIC8vIFN1YnR5cCBjb2xvciBkb3RzIC0gZnJvbnRtYXR0ZXItYmxvY2tzLmpzIGJ1aWxkcyB0aGUgZm9vdGVycywgbm8gbGlzdCBvZlxuICAvLyB0aGVtIGxpdmVzIGhlcmUuXG4gIHN5bmNNYW51YWxUb2dnbGVzKHR5cCkge1xuICAgIHRoaXMuY29udGVudEVsLnF1ZXJ5U2VsZWN0b3IoXCIudHlwLW1hbnVhbC10eXBcIik/LnR5cFNob3dNYW51YWxTdGF0ZSh0aGlzLmVuc3VyZVR5cE1hbnVhbCgpW3R5cF0gIT09IGZhbHNlKTtcbiAgICBmb3IgKGNvbnN0IGVsIG9mIHRoaXMuY29udGVudEVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIudHlwLW1hbnVhbC1zdWJ0eXBcIikpIHtcbiAgICAgIGVsLnR5cFNob3dNYW51YWxTdGF0ZShpc1N1YnR5cE1hbnVhbCh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBlbC50eXBTdWJ0eXApKTtcbiAgICB9XG4gIH1cblxuICByZW5kZXJSZWdpc3RlcmVkSXRlbSh0eXAsIGNvdW50LCB7IGRyYWdnYWJsZSA9IGZhbHNlLCBpbmRleCA9IC0xIH0gPSB7fSkge1xuICAgIGNvbnN0IHRyZWVJdGVtID0gdGhpcy5saXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbVwiIH0pO1xuICAgIGNvbnN0IHNlbGYgPSB0cmVlSXRlbS5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLXNlbGYgaXMtY2xpY2thYmxlXCIgfSk7XG5cbiAgICBsZXQgbmFtZUVsO1xuICAgIHRoaXMucmVuZGVyQ29sb3JQaWNrZXIoc2VsZiwgdHlwLCAobmV3Q29sb3IpID0+IHtcbiAgICAgIGlmIChuYW1lRWwgJiYgdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0KSBuYW1lRWwuc3R5bGUuY29sb3IgPSBuZXdDb2xvcjtcbiAgICB9KTtcblxuICAgIG5hbWVFbCA9IHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1pbm5lclwiLCB0ZXh0OiB0eXAgfSk7XG4gICAgY29uc3QgY29sb3IgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnR5cExpc3QgPyB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdHlwXSA6IG51bGw7XG4gICAgaWYgKGNvbG9yKSBuYW1lRWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcblxuICAgIC8vIFNlY29uZCBjb2x1bW4sIGN5Y2xlZCBieSB0aGUgaGVhZGVyIGJ1dHRvbiAoc2VlIFNFQ09OREFSWV9NT0RFUykuXG4gICAgY29uc3Qgc2Vjb25kYXJ5ID0gdGhpcy5zZWNvbmRhcnlNb2RlKCk7XG4gICAgaWYgKHNlY29uZGFyeSA9PT0gXCJkZXNjcmlwdGlvblwiKSB0aGlzLnJlbmRlckRlc2NyaXB0aW9uSW5wdXQoc2VsZiwgdHlwKTtcbiAgICBlbHNlIGlmIChzZWNvbmRhcnkgPT09IFwic3VidHlwc1wiKSB0aGlzLnJlbmRlclN1YnR5cFByZXZpZXcoc2VsZiwgdHlwKTtcblxuICAgIHRoaXMucmVuZGVyQ291bnRGbGFpcihzZWxmLCBjb3VudCk7XG5cbiAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICBpZiAodGhpcy5pc0VkaXRpbmcpIHJldHVybjtcbiAgICAgIHRoaXMub3BlblR5cFNldHRpbmdzKHR5cCk7XG4gICAgfSk7XG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY29udGV4dG1lbnVcIiwgKGV2ZW50KSA9PiB7XG4gICAgICAvLyBXaGlsZSByZW5hbWluZywgdGhlIHRleHQgZmllbGQncyBvd24gbWVudSAoY29weSwgcGFzdGUpIGFwcGxpZXMuXG4gICAgICBpZiAodGhpcy5pc0VkaXRpbmcpIHJldHVybjtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIHRoaXMuc2hvd1R5cE1lbnUoZXZlbnQsIHR5cCwgc2VsZiwgbmFtZUVsKTtcbiAgICB9KTtcblxuICAgIC8vIE9ubHkgaW4gbWFudWFsIHNvcnQgbW9kZSAoc2VlIHJlbmRlcigpKTogdGhlIHdob2xlIHJvdyBjYW4gYmUgZHJhZ2dlZFxuICAgIC8vIChhIGRyYWcgc3RhcnRpbmcgb24gdGhlIGRvdCBvciBpbiB0aGUgZGVzY3JpcHRpb24gZmllbGQgZG9lc24ndCBjb3VudCAtXG4gICAgLy8gdGhvc2UgdGFrZSB0aGUgbW91c2Vkb3duIHRoZW1zZWx2ZXMpLiBNb3ZlcyBlbnRyaWVzIGluIHNldHRpbmdzLnR5cHMsXG4gICAgLy8gdGhlIGxpc3QgdGhhdCBpcyB0aGUgZGlzcGxheSBvcmRlciBpbiBtYW51YWwgbW9kZS5cbiAgICBpZiAoZHJhZ2dhYmxlKSB7XG4gICAgICBzZWxmLmRyYWdnYWJsZSA9IHRydWU7XG4gICAgICBzZWxmLmFkZEV2ZW50TGlzdGVuZXIoXCJkcmFnc3RhcnRcIiwgKGV2ZW50KSA9PiB7XG4gICAgICAgIGV2ZW50LmRhdGFUcmFuc2Zlci5lZmZlY3RBbGxvd2VkID0gXCJtb3ZlXCI7XG4gICAgICAgIGV2ZW50LmRhdGFUcmFuc2Zlci5zZXREYXRhKFwidGV4dC9wbGFpblwiLCBTdHJpbmcoaW5kZXgpKTtcbiAgICAgICAgc2VsZi5jbGFzc0xpc3QuYWRkKFwiaXMtZHJhZ2dpbmdcIik7XG4gICAgICB9KTtcbiAgICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdlbmRcIiwgKCkgPT4gc2VsZi5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJhZ2dpbmdcIikpO1xuICAgICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiZHJhZ292ZXJcIiwgKGV2ZW50KSA9PiB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGNvbnN0IHJlY3QgPSBzZWxmLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgICBjb25zdCBpc0FmdGVyID0gZXZlbnQuY2xpZW50WSAtIHJlY3QudG9wID4gcmVjdC5oZWlnaHQgLyAyO1xuICAgICAgICBzZWxmLmNsYXNzTGlzdC50b2dnbGUoXCJpcy1kcm9wLWJlZm9yZVwiLCAhaXNBZnRlcik7XG4gICAgICAgIHNlbGYuY2xhc3NMaXN0LnRvZ2dsZShcImlzLWRyb3AtYWZ0ZXJcIiwgaXNBZnRlcik7XG4gICAgICB9KTtcbiAgICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImRyYWdsZWF2ZVwiLCAoKSA9PiBzZWxmLmNsYXNzTGlzdC5yZW1vdmUoXCJpcy1kcm9wLWJlZm9yZVwiLCBcImlzLWRyb3AtYWZ0ZXJcIikpO1xuICAgICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiZHJvcFwiLCBhc3luYyAoZXZlbnQpID0+IHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgY29uc3QgaXNBZnRlciA9IHNlbGYuY2xhc3NMaXN0LmNvbnRhaW5zKFwiaXMtZHJvcC1hZnRlclwiKTtcbiAgICAgICAgc2VsZi5jbGFzc0xpc3QucmVtb3ZlKFwiaXMtZHJvcC1iZWZvcmVcIiwgXCJpcy1kcm9wLWFmdGVyXCIpO1xuXG4gICAgICAgIGNvbnN0IGZyb21JbmRleCA9IE51bWJlcihldmVudC5kYXRhVHJhbnNmZXIuZ2V0RGF0YShcInRleHQvcGxhaW5cIikpO1xuICAgICAgICBpZiAoTnVtYmVyLmlzTmFOKGZyb21JbmRleCkgfHwgZnJvbUluZGV4ID09PSBpbmRleCkgcmV0dXJuO1xuXG4gICAgICAgIGxldCBpbnNlcnRCZWZvcmUgPSBpc0FmdGVyID8gaW5kZXggKyAxIDogaW5kZXg7XG4gICAgICAgIGlmIChmcm9tSW5kZXggPCBpbnNlcnRCZWZvcmUpIGluc2VydEJlZm9yZSAtPSAxO1xuXG4gICAgICAgIGNvbnN0IHR5cHMgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBzO1xuICAgICAgICBjb25zdCBbbW92ZWRdID0gdHlwcy5zcGxpY2UoZnJvbUluZGV4LCAxKTtcbiAgICAgICAgdHlwcy5zcGxpY2UoaW5zZXJ0QmVmb3JlLCAwLCBtb3ZlZCk7XG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB0aGlzLnJlbmRlcigpO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgLy8gUmlnaHQtY2xpY2sgb24gYSByZWdpc3RlcmVkIFRZUDogdGhlIGFjdGlvbnMgb2YgdGhlIGRldGFpbCBoZWFkZXIgcGx1c1xuICAvLyBzZWFyY2gsIEJhc2UgYW5kIHNvcnRpbmcsIHdpdGhvdXQgb3BlbmluZyB0aGUgZGV0YWlsIHZpZXcuIFwiTWFudWFsbHlcbiAgLy8gY3JlYXRhYmxlXCIgc3RheXMgaW4gdGhlIGRldGFpbCB2aWV3IC0gYSBzdGF0ZSwgbm90IGFuIGFjdGlvbi4gVGhlIHJvd3NcbiAgLy8gYmVsb3cgdGhlIHNlcGFyYXRvciBrZWVwIHJpZ2h0LWNsaWNrID0gc2VhcmNoOiB0aGV5IGhhdmUgbm8gc2V0dGluZ3MgdG9cbiAgLy8gYWN0IG9uLlxuICBzaG93VHlwTWVudShldmVudCwgdHlwLCBzZWxmLCBuYW1lRWwpIHtcbiAgICBjb25zdCBtZW51ID0gbmV3IE1lbnUoKTtcbiAgICBtZW51LmFkZEl0ZW0oKGl0ZW0pID0+IGl0ZW0uc2V0VGl0bGUoXCJTZWFyY2ggbm90ZXNcIikuc2V0SWNvbihcInNlYXJjaFwiKS5vbkNsaWNrKCgpID0+IHRoaXMub3BlblNlYXJjaCh0eXApKSk7XG4gICAgbWVudS5hZGRTZXBhcmF0b3IoKTtcbiAgICBtZW51LmFkZEl0ZW0oKGl0ZW0pID0+XG4gICAgICBpdGVtXG4gICAgICAgIC5zZXRUaXRsZShcIlJlbmFtZVwiKVxuICAgICAgICAuc2V0SWNvbihcInBlbmNpbFwiKVxuICAgICAgICAub25DbGljaygoKSA9PiB0aGlzLnN0YXJ0TGlzdFJlbmFtZSh0eXAsIHNlbGYsIG5hbWVFbCkpXG4gICAgKTtcbiAgICBtZW51LmFkZEl0ZW0oKGl0ZW0pID0+XG4gICAgICBpdGVtXG4gICAgICAgIC5zZXRUaXRsZShcIlJlbmFtZSBhbmQgdXBkYXRlIG5vdGVzXCIpXG4gICAgICAgIC5zZXRJY29uKFwicGVuY2lsXCIpXG4gICAgICAgIC5vbkNsaWNrKCgpID0+IHRoaXMuc3RhcnRMaXN0UmVuYW1lKHR5cCwgc2VsZiwgbmFtZUVsLCB7IHVwZGF0ZU5vdGVzOiB0cnVlIH0pKVxuICAgICk7XG4gICAgbWVudS5hZGRJdGVtKChpdGVtKSA9PlxuICAgICAgaXRlbVxuICAgICAgICAuc2V0VGl0bGUoXCJEZWxldGVcIilcbiAgICAgICAgLnNldEljb24oXCJ0cmFzaFwiKVxuICAgICAgICAuc2V0V2FybmluZyh0cnVlKVxuICAgICAgICAub25DbGljaygoKSA9PiB0aGlzLnNob3dEZWxldGVDb25maXJtKHR5cCkpXG4gICAgKTtcbiAgICBtZW51LmFkZFNlcGFyYXRvcigpO1xuICAgIC8vIExpa2UgdGhlIGNvbW1hbmQ6IHdpdGhvdXQgdGhlIEJhc2VzIGNvcmUgcGx1Z2luIHRoZSBmaWxlIGNvdWxkbid0IGJlXG4gICAgLy8gb3BlbmVkLlxuICAgIGlmIChpc0Jhc2VzRW5hYmxlZCh0aGlzLmFwcCkpIHtcbiAgICAgIG1lbnUuYWRkSXRlbSgoaXRlbSkgPT5cbiAgICAgICAgaXRlbVxuICAgICAgICAgIC5zZXRUaXRsZShcIkNyZWF0ZSBCYXNlXCIpXG4gICAgICAgICAgLnNldEljb24oXCJ0YWJsZVwiKVxuICAgICAgICAgIC5vbkNsaWNrKHJ1bk9yUmVwb3J0RXJyb3IoXCJDcmVhdGUgQmFzZVwiLCAoKSA9PiBjcmVhdGVCYXNlRm9yKHRoaXMucGx1Z2luLCB7IHR5cCwgc3VidHlwOiBudWxsIH0pKSlcbiAgICAgICk7XG4gICAgfVxuICAgIG1lbnUuYWRkSXRlbSgoaXRlbSkgPT5cbiAgICAgIGl0ZW1cbiAgICAgICAgLnNldFRpdGxlKFwiU29ydCBmcm9udG1hdHRlciBmb3IgdGhpcyBUWVBcIilcbiAgICAgICAgLnNldEljb24oXCJhcnJvdy1kb3duLXVwXCIpXG4gICAgICAgIC5vbkNsaWNrKHJ1bk9yUmVwb3J0RXJyb3IoXCJGcm9udG1hdHRlciBzb3J0aW5nXCIsICgpID0+IHJ1bkZyb250bWF0dGVyU29ydCh0aGlzLnBsdWdpbiwgdHlwKSkpXG4gICAgKTtcbiAgICBtZW51LnNob3dBdE1vdXNlRXZlbnQoZXZlbnQpO1xuICB9XG5cbiAgLy8gQSByZWFsIGlucHV0LCBzbyB0aGUgZGVzY3JpcHRpb24gY2FuIGJlIGVkaXRlZCByaWdodCBpbiB0aGUgbGlzdC4gSXRzXG4gIC8vIGNsaWNrIG11c3QgTk9UIHRyaWdnZXIgdGhlIHJvdyAod2hpY2ggd291bGQgb3BlbiB0aGUgZGV0YWlsIHZpZXcpLlxuICByZW5kZXJEZXNjcmlwdGlvbklucHV0KHNlbGYsIHR5cCkge1xuICAgIGNvbnN0IGRlc2NJbnB1dCA9IHNlbGYuY3JlYXRlRWwoXCJpbnB1dFwiLCB7XG4gICAgICB0eXBlOiBcInRleHRcIixcbiAgICAgIGNsczogXCJ0eXAtbGlzdC1kZXNjcmlwdGlvbi1pbnB1dFwiLFxuICAgIH0pO1xuICAgIGRlc2NJbnB1dC52YWx1ZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlc2NyaXB0aW9uc1t0eXBdID8/IFwiXCI7XG4gICAgZGVzY0lucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpKTtcbiAgICBkZXNjSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCB2YWx1ZSA9IGRlc2NJbnB1dC52YWx1ZS50cmltKCk7XG4gICAgICBpZiAodmFsdWUpIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlc2NyaXB0aW9uc1t0eXBdID0gdmFsdWU7XG4gICAgICBlbHNlIGRlbGV0ZSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBEZXNjcmlwdGlvbnNbdHlwXTtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gXCIoU3VidHlwIDEsIFN1YnR5cCAyKVwiIGluc3RlYWQgb2YgdGhlIGRlc2NyaXB0aW9uIC0gdGhlIHNhbWUgbG9vayBhcyB0aGVcbiAgLy8gcHJldmlldyBpbiB0aGUgc2VwYXJhdGUgVFlQLVBpY2tlciAoc2hhcmVkIG5hbWVDb2xvciBpbiB0eXAtY29sb3JzLmpzKTpcbiAgLy8gYnJhY2tldHMgYW5kIGNvbW1hcyBtdXRlZCwgZWFjaCBuYW1lIGluIGl0cyBTdWJ0eXAgY29sb3IuIE9ubHkgcmVnaXN0ZXJlZFxuICAvLyBTdWJ0eXBzIGFuZCBubyBjb3VudHMgLSB1bnJlZ2lzdGVyZWQgdmFsdWVzIGhhdmUgbm8gY29sb3IsIGFuZCBjb3VudHNcbiAgLy8gd291bGQgbWFrZSB0aGUgcm93IHVucmVhZGFibGUuIERpc3BsYXkgb25seTsgY2xpY2sgYW5kIHJpZ2h0LWNsaWNrIGJlbG9uZ1xuICAvLyB0byB0aGUgcm93LiBMZWZ0IG9yIHJpZ2h0IGFsaWdubWVudCBpcyBhIFN0eWxlIFNldHRpbmdzIGJvZHkgY2xhc3MgKHNlZVxuICAvLyBAc2V0dGluZ3MgYW5kIC50eXAtbGlzdC1zdWJ0eXBzIGluIHN0eWxlcy5jc3MpOyB0aGUgbWFya3VwIGlzIHRoZSBzYW1lLlxuICByZW5kZXJTdWJ0eXBQcmV2aWV3KHNlbGYsIHR5cCkge1xuICAgIGNvbnN0IHN1YnR5cHMgPSBnZXRTdWJ0eXBOYW1lcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwKTtcbiAgICBpZiAoc3VidHlwcy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgIGNvbnN0IGNvbG9yaXplID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0O1xuICAgIGNvbnN0IHdyYXAgPSBzZWxmLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLWxpc3Qtc3VidHlwc1wiIH0pO1xuICAgIHdyYXAuYXBwZW5kVGV4dChcIihcIik7XG4gICAgc3VidHlwcy5mb3JFYWNoKChzdWJ0eXAsIGluZGV4KSA9PiB7XG4gICAgICBpZiAoaW5kZXggPiAwKSB3cmFwLmFwcGVuZFRleHQoXCIsIFwiKTtcbiAgICAgIGNvbnN0IHNwYW4gPSB3cmFwLmNyZWF0ZVNwYW4oeyB0ZXh0OiBzdWJ0eXAgfSk7XG4gICAgICBpZiAoY29sb3JpemUpIHNwYW4uc3R5bGUuY29sb3IgPSBuYW1lQ29sb3IodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKS5jb2xvcjtcbiAgICB9KTtcbiAgICB3cmFwLmFwcGVuZFRleHQoXCIpXCIpO1xuICB9XG5cbiAgcmVuZGVyVW5yZWdpc3RlcmVkSXRlbSh0eXAsIGNvdW50KSB7XG4gICAgY29uc3QgdHJlZUl0ZW0gPSB0aGlzLmxpc3RFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtXCIgfSk7XG4gICAgY29uc3Qgc2VsZiA9IHRyZWVJdGVtLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW0tc2VsZiBpcy1jbGlja2FibGUgdHlwLXVucmVnaXN0ZXJlZFwiIH0pO1xuICAgIHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1pbm5lclwiLCB0ZXh0OiBkaXNwbGF5VHlwS2V5KHR5cCkgfSk7XG4gICAgdGhpcy5yZW5kZXJDb3VudEZsYWlyKHNlbGYsIGNvdW50KTtcblxuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMucmVnaXN0ZXJUeXAodHlwKSk7XG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY29udGV4dG1lbnVcIiwgKGV2ZW50KSA9PiB7XG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICB0aGlzLm9wZW5TZWFyY2godHlwKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIEV2ZXJ5IFNVQlRZUCB2YWx1ZSB0aGF0IG9jY3VycyBpbiBub3RlcyBidXQgaXNuJ3QgcmVnaXN0ZXJlZCB1bmRlciBpdHMgVFlQXG4gIC8vIC0gYWNyb3NzIHRoZSB2YXVsdCwgdW5saWtlIHJlbmRlclVucmVnaXN0ZXJlZFN1YnR5cHMoKSBpbiB0aGUgZGV0YWlsIHZpZXcuXG4gIC8vIFRoZSBpbmRleCBrZWVwcyBidWNrZXRzIGZvciBBTEwgVFlQIGtleXMsIHVucmVnaXN0ZXJlZCBvbmVzIGluY2x1ZGVkLCBzb1xuICAvLyB0aGVpciBTdWJ0eXBzIGNvbWUgYWxvbmcgKGEgY2xpY2sgdGhlbiByZWdpc3RlcnMgYm90aCwgc2VlXG4gIC8vIHJlZ2lzdGVyVHlwV2l0aFN1YnR5cCkuXG4gIC8vXG4gIC8vIFNvcnRlZCBieSBjb3VudCwgdGhlbiBieSByb3cgdGV4dCAoVFlQLCB0aGVuIFN1YnR5cCkgLSBsaWtlIHRoZSBkZXRhaWxcbiAgLy8gdmlldy4gRGVsaWJlcmF0ZWx5IE5PVCBieSB0aGUgbGlzdCdzIHNvcnQgYnV0dG9uOiBcImNvbG9yXCIgYW5kIFwibWFudWFsXCJcbiAgLy8gbWVhbiBub3RoaW5nIGZvciB1bnJlZ2lzdGVyZWQgdmFsdWVzLlxuICAvL1xuICAvLyBBIG5vdGUgd2l0aG91dCBhIFRZUCBpcyBsZWZ0IG91dDogdGhlIGluZGV4IGRyb3BzIGl0cyBTVUJUWVAgYWxyZWFkeSAoc2VlXG4gIC8vIGFnZ3JlZ2F0ZSgpIGluIHR5cC1pbmRleC5qcyksIGEgU1VCVFlQIHdpdGhvdXQgYSBUWVAgaGFzIG5vIGNvbnRleHQuXG4gIHVucmVnaXN0ZXJlZFN1YnR5cFJvd3MoKSB7XG4gICAgY29uc3QgcmVnaXN0ZXJlZCA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cHM7XG4gICAgY29uc3Qgcm93cyA9IFtdO1xuICAgIGZvciAoY29uc3QgW3R5cCwgYnVja2V0XSBvZiB0aGlzLnBsdWdpbi50eXBJbmRleC5zdWJ0eXBDb3VudHMoKSkge1xuICAgICAgY29uc3Qga25vd24gPSBnZXRTdWJ0eXBOYW1lcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwKTtcbiAgICAgIGZvciAoY29uc3QgW3N1YnR5cCwgY291bnRdIG9mIGJ1Y2tldC5jb3VudHMpIHtcbiAgICAgICAgaWYgKGtub3duLmluY2x1ZGVzKHN1YnR5cCkpIGNvbnRpbnVlO1xuICAgICAgICByb3dzLnB1c2goeyB0eXAsIHN1YnR5cCwgY291bnQsIHR5cFJlZ2lzdGVyZWQ6IHJlZ2lzdGVyZWQuaW5jbHVkZXModHlwKSB9KTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJvd3Muc29ydCgoYSwgYikgPT4gYi5jb3VudCAtIGEuY291bnQgfHwgYS50eXAubG9jYWxlQ29tcGFyZShiLnR5cCkgfHwgYS5zdWJ0eXAubG9jYWxlQ29tcGFyZShiLnN1YnR5cCkpO1xuICB9XG5cbiAgLy8gXCJOT1RJWiAvIEt1cnogR2VzY2hpY2h0ZVwiIC0gdGhlIFN1YnR5cCBhbG9uZSB3b3VsZCBiZSBhbWJpZ3VvdXMsIHRoZSBzYW1lXG4gIC8vIG5hbWUgY2FuIGV4aXN0IHVuZGVyIHNldmVyYWwgVFlQIGVudHJpZXMuIElmIHRoZSBUWVAgaXMgcmVnaXN0ZXJlZCwgaXRzXG4gIC8vIHBhcnQgY2FycmllcyBpdHMgY29sb3IgKG9yIGEgZG90LCBkZXBlbmRpbmcgb24gXCJUWVAtUGFuZVwiIGNvbG9yaW5nKSxcbiAgLy8gdG9uZWQgZG93biBieSB0aGUgU3R5bGUgU2V0dGluZyBcIkNvbG9yIGluIHVucmVnaXN0ZXJlZCBTdWJ0eXAgcm93c1wiIHNvXG4gIC8vIHRoZXNlIHJvd3Mgc3RheSBiZWhpbmQgdGhlIHJlZ2lzdGVyZWQgZW50cmllcyBhYm92ZS4gSWYgdGhlIFRZUCBpc24ndFxuICAvLyByZWdpc3RlcmVkIGVpdGhlciwgdGhlIHdob2xlIHJvdyBpcyBtdXRlZCBsaWtlIHRoZSBlbnRyaWVzIGFib3ZlIGl0LlxuICByZW5kZXJVbnJlZ2lzdGVyZWRTdWJ0eXBJdGVtKHsgdHlwLCBzdWJ0eXAsIGNvdW50LCB0eXBSZWdpc3RlcmVkIH0pIHtcbiAgICBjb25zdCB0cmVlSXRlbSA9IHRoaXMubGlzdEVsLmNyZWF0ZURpdih7IGNsczogXCJ0cmVlLWl0ZW1cIiB9KTtcbiAgICBjb25zdCBzZWxmID0gdHJlZUl0ZW0uY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1zZWxmIGlzLWNsaWNrYWJsZSB0eXAtdW5yZWdpc3RlcmVkXCIgfSk7XG5cbiAgICBjb25zdCBjb2xvcml6ZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdDtcbiAgICBjb25zdCB7IGNvbG9yLCBpc0RlZmF1bHQgfSA9IG5hbWVDb2xvcih0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwKTtcbiAgICBpZiAodHlwUmVnaXN0ZXJlZCAmJiAhY29sb3JpemUpIHtcbiAgICAgIGNvbnN0IHdyYXAgPSBzZWxmLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtY29sb3Itd3JhcCB0eXAtdW5yZWdpc3RlcmVkLXN1YnR5cC1jb2xvclwiIH0pO1xuICAgICAgcGFpbnRDb2xvckRvdCh3cmFwLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtY29sb3ItZG90XCIgfSksIGNvbG9yLCBpc0RlZmF1bHQpO1xuICAgIH1cblxuICAgIGNvbnN0IGlubmVyID0gc2VsZi5jcmVhdGVEaXYoeyBjbHM6IFwidHJlZS1pdGVtLWlubmVyXCIgfSk7XG4gICAgY29uc3QgdHlwRWwgPSBpbm5lci5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC11bnJlZ2lzdGVyZWQtc3VidHlwLXR5cFwiLCB0ZXh0OiBkaXNwbGF5VHlwS2V5KHR5cCkgfSk7XG4gICAgaWYgKHR5cFJlZ2lzdGVyZWQgJiYgY29sb3JpemUgJiYgIWlzRGVmYXVsdCkge1xuICAgICAgdHlwRWwuc3R5bGUuY29sb3IgPSBjb2xvcjtcbiAgICAgIHR5cEVsLmFkZENsYXNzKFwidHlwLXVucmVnaXN0ZXJlZC1zdWJ0eXAtY29sb3JcIik7XG4gICAgfVxuICAgIGlubmVyLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXVucmVnaXN0ZXJlZC1zdWJ0eXAtc2xhc2hcIiwgdGV4dDogXCIgLyBcIiB9KTtcbiAgICBpbm5lci5jcmVhdGVTcGFuKHsgdGV4dDogZGlzcGxheVR5cEtleShzdWJ0eXApIH0pO1xuXG4gICAgdGhpcy5yZW5kZXJDb3VudEZsYWlyKHNlbGYsIGNvdW50KTtcblxuICAgIHNlbGYuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMucmVnaXN0ZXJUeXBXaXRoU3VidHlwKHR5cCwgc3VidHlwKSk7XG4gICAgc2VsZi5hZGRFdmVudExpc3RlbmVyKFwiY29udGV4dG1lbnVcIiwgKGV2ZW50KSA9PiB7XG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgZXZlbnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICB0aGlzLm9wZW5TdWJ0eXBTZWFyY2godHlwLCBzdWJ0eXApO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gQ2xpY2tpbmcgc3VjaCBhIHJvdyByZWdpc3RlcnMgdGhlIFN1YnR5cCBhbmQsIGlmIG5lZWRlZCwgaXRzIFRZUC4gVFlQXG4gIC8vIGZpcnN0LCB0aGVuIFN1YnR5cCAtIG5lY2Vzc2FyaWx5OiByZWdpc3RlcmluZyBhIFRZUCBjYW4gY2xlYW4gaXRzIHZhbHVlIGluXG4gIC8vIHRoZSBub3RlcyAoXCIgYnVjaFwiIC0+IFwiQlVDSFwiKSwgYW5kIHRoZSBTdWJ0eXAgcGFzcyBtdXN0IHRoZW4gdXNlIHRoZSBORVdcbiAgLy8gVFlQIG5hbWUgb3IgcmVuYW1lU3VidHlwSW5Ob3RlcygpIGZpbmRzIG5vIGZpbGUuXG4gIC8vXG4gIC8vIE5vIGNvbmZpcm1hdGlvbjogaXQgb25seSByZWdpc3RlcnMuIE5vdGVzIGNoYW5nZSBvbmx5IHdoZW4gYSByYXcgdmFsdWUgd2FzXG4gIC8vIHVuY2xlYW4gYW5kIGdldHMgY2xlYW5lZCAtIGEgY2xlYW4gdmFsdWUgdG91Y2hlcyBubyBmaWxlLlxuICBhc3luYyByZWdpc3RlclR5cFdpdGhTdWJ0eXAodHlwS2V5LCBzdWJ0eXBLZXkpIHtcbiAgICBjb25zdCBidWNrZXQgPSB0aGlzLnBsdWdpbi50eXBJbmRleC5zdWJ0eXBCdWNrZXQodHlwS2V5KTtcbiAgICBjb25zdCB0eXBSZXN1bHQgPSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBzLmluY2x1ZGVzKHR5cEtleSlcbiAgICAgID8geyB0eXA6IHR5cEtleSwgcmVuYW1lZDogMCB9XG4gICAgICA6IGF3YWl0IHRoaXMuYXBwbHlUeXBSZWdpc3RyYXRpb24odHlwS2V5KTtcbiAgICBpZiAoIXR5cFJlc3VsdCkgcmV0dXJuO1xuXG4gICAgY29uc3Qgc3VidHlwUmVzdWx0ID0gYXdhaXQgdGhpcy5hcHBseVN1YnR5cFJlZ2lzdHJhdGlvbih0eXBSZXN1bHQudHlwLCBzdWJ0eXBLZXksIGJ1Y2tldCk7XG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgdGhpcy5yZW5kZXIoKTtcbiAgICB0aGlzLnJlZnJlc2hPdGhlclZpZXdzKCk7XG5cbiAgICBpZiAoIXN1YnR5cFJlc3VsdCkgcmV0dXJuO1xuICAgIGNvbnN0IHBhcnRzID0gW107XG4gICAgaWYgKHR5cFJlc3VsdC50eXAgIT09IHR5cEtleSkgcGFydHMucHVzaChgVFlQICR7dHlwUmVzdWx0LnR5cH1gKTtcbiAgICBwYXJ0cy5wdXNoKGBTdWJ0eXAgJHtzdWJ0eXBSZXN1bHQuc3VidHlwfWApO1xuICAgIGNvbnN0IGNoYW5nZWQgPSB0eXBSZXN1bHQucmVuYW1lZCArIHN1YnR5cFJlc3VsdC5yZW5hbWVkO1xuICAgIG5ldyBOb3RpY2UoYCR7am9pbkFuZChwYXJ0cyl9IHJlZ2lzdGVyZWQke2NoYW5nZWQgPiAwID8gYCwgJHtwbHVyYWwoY2hhbmdlZCwgXCJub3RlXCIpfSB1cGRhdGVkYCA6IFwiXCJ9LmApO1xuICB9XG5cbiAgcmVuZGVyVHlwU2V0dGluZ3ModHlwKSB7XG4gICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XG4gICAgY29udGVudEVsLmVtcHR5KCk7XG5cbiAgICBjb25zdCBoZWFkZXIgPSBjb250ZW50RWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1kZXRhaWwtaGVhZGVyXCIgfSk7XG4gICAgY29uc3QgYmFja0J0biA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWJhY2tcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJCYWNrXCIgfSB9KTtcbiAgICBzZXRJY29uKGJhY2tCdG4sIFwiYXJyb3ctbGVmdFwiKTtcbiAgICBiYWNrQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmNsb3NlVHlwU2V0dGluZ3MoKSk7XG5cbiAgICBjb25zdCB0aXRsZUVsID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZGV0YWlsLXRpdGxlXCIsIHRleHQ6IHR5cCB9KTtcbiAgICBjb25zdCB0aXRsZUNvbG9yID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0ID8gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gOiBudWxsO1xuICAgIC8vIEEgY3VzdG9tIHByb3BlcnR5IGluc3RlYWQgb2YgY29sb3I6IGFuIGlubGluZSBjb2xvciBiZWF0cyBldmVyeVxuICAgIC8vIHN0eWxlc2hlZXQgcnVsZSwgYW5kIHRoZSBhY2NlbnQgY29sb3Igb24gaG92ZXIgKC50eXAtc2VhcmNoYWJsZSkgd291bGRcbiAgICAvLyBuZWVkICFpbXBvcnRhbnQuXG4gICAgaWYgKHRpdGxlQ29sb3IpIHRpdGxlRWwuc3R5bGUuc2V0UHJvcGVydHkoXCItLXR5cC1uYW1lLWNvbG9yXCIsIHRpdGxlQ29sb3IpO1xuICAgIHRoaXMubWFrZVNlYXJjaGFibGUodGl0bGVFbCwgKCkgPT4gdGhpcy5vcGVuU2VhcmNoKHR5cCkpO1xuXG4gICAgY29uc3QgeyBjb3VudHMgfSA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnR5cENvdW50cygpO1xuICAgIGhlYWRlci5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1kZXRhaWwtY291bnRcIiwgdGV4dDogU3RyaW5nKGNvdW50cy5nZXQodHlwKSA/PyAwKSB9KTtcblxuICAgIC8vIExlZnQgb2YgdGhlIHBsYWluIHJlbmFtZSBidXR0b24sIGhpZ2hsaWdodGVkIGluIGFjY2VudCBjb2xvcjogdGhpcyBvbmVcbiAgICAvLyBhbHNvIHJld3JpdGVzIHRoZSBUWVAgb2YgZXZlcnkgYWZmZWN0ZWQgbm90ZSAoYWZ0ZXIgY29uZmlybWF0aW9uLCBzZWVcbiAgICAvLyBzdGFydERldGFpbFJlbmFtZSkuXG4gICAgY29uc3QgcmVuYW1lV2l0aE5vdGVzQnRuID0gaGVhZGVyLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWRldGFpbC1yZW5hbWUtbm90ZXNcIixcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiUmVuYW1lIGFuZCB1cGRhdGUgbm90ZXNcIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24ocmVuYW1lV2l0aE5vdGVzQnRuLCBcInBlbmNpbFwiKTtcbiAgICByZW5hbWVXaXRoTm90ZXNCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuc3RhcnREZXRhaWxSZW5hbWUodHlwLCB0aXRsZUVsLCB7IHVwZGF0ZU5vdGVzOiB0cnVlIH0pKTtcblxuICAgIGNvbnN0IHJlbmFtZUJ0biA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWRldGFpbC1yZW5hbWVcIiwgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJSZW5hbWVcIiB9IH0pO1xuICAgIHNldEljb24ocmVuYW1lQnRuLCBcInBlbmNpbFwiKTtcbiAgICByZW5hbWVCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuc3RhcnREZXRhaWxSZW5hbWUodHlwLCB0aXRsZUVsKSk7XG5cbiAgICAvLyBCZXR3ZWVuIHJlbmFtZSBhbmQgZGVsZXRlLCBpbiB0aGUgc2FtZSBzcG90IGFzIGZvciBhIFN1YnR5cCAoc2VlXG4gICAgLy8gcmVuZGVyU2VjdGlvbkZvb3RlcikuXG4gICAgdGhpcy5yZW5kZXJNYW51YWxUb2dnbGUoaGVhZGVyLCB0eXApO1xuXG4gICAgY29uc3QgZGVsZXRlQnRuID0gaGVhZGVyLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtZGV0YWlsLWRlbGV0ZVwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkRlbGV0ZVwiIH0gfSk7XG4gICAgc2V0SWNvbihkZWxldGVCdG4sIFwidHJhc2hcIik7XG4gICAgZGVsZXRlQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnNob3dEZWxldGVDb25maXJtKHR5cCkpO1xuXG4gICAgY29uc3QgYm9keSA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWRldGFpbC1ib2R5XCIgfSk7XG5cbiAgICAvLyBPbmUgcm93IGJlbG93IHRoZSBoZWFkZXI6IHRoZSBUWVAgY29sb3Igb24gdGhlIGxlZnQsIHRoZSBkZXNjcmlwdGlvblxuICAgIC8vIGZpbGxpbmcgdGhlIHJlc3QuXG4gICAgY29uc3Qgb3B0aW9uc0hlYWRlciA9IGJvZHkuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci1oZWFkZXIgdHlwLW9wdGlvbnMtaGVhZGVyXCIgfSk7XG5cbiAgICBjb25zdCBjb2xvclJvdyA9IG9wdGlvbnNIZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1kZXRhaWwtY29sb3Itcm93XCIgfSk7XG4gICAgdGhpcy5yZW5kZXJDb2xvclBpY2tlcihcbiAgICAgIGNvbG9yUm93LFxuICAgICAgdHlwLFxuICAgICAgKG5ld0NvbG9yKSA9PiB7XG4gICAgICAgIGlmICghdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0KSByZXR1cm47XG4gICAgICAgIC8vIFNhbWUgY3VzdG9tIHByb3BlcnR5IGFzIGFib3ZlLCBub3Qgc3R5bGUuY29sb3IgKHNlZSB0aGVyZSkuXG4gICAgICAgIHRpdGxlRWwuc3R5bGUuc2V0UHJvcGVydHkoXCItLXR5cC1uYW1lLWNvbG9yXCIsIG5ld0NvbG9yKTtcbiAgICAgIH0sXG4gICAgICB7IHNob3dSZXNldDogdHJ1ZSB9XG4gICAgKTtcblxuICAgIC8vIFNpbmdsZS1saW5lIGlucHV0IG5leHQgdG8gdGhlIGNvbG9yLCBsaWtlIHRoZSBvbmUgaW4gdGhlIFRZUC1MaXN0LiBOb1xuICAgIC8vIGhlYWRpbmc6IHdoaWxlIGVtcHR5LCBpdHMgZmFkZWQgcGxhY2Vob2xkZXIgc2F5cyB3aGF0IGl0IGlzLlxuICAgIGNvbnN0IGRlc2NJbnB1dCA9IG9wdGlvbnNIZWFkZXIuY3JlYXRlRWwoXCJpbnB1dFwiLCB7XG4gICAgICB0eXBlOiBcInRleHRcIixcbiAgICAgIGNsczogXCJ0eXAtZGVzY3JpcHRpb24taW5wdXRcIixcbiAgICAgIGF0dHI6IHsgcGxhY2Vob2xkZXI6IFwiRGVzY3JpcHRpb25cIiB9LFxuICAgIH0pO1xuICAgIGRlc2NJbnB1dC52YWx1ZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cERlc2NyaXB0aW9uc1t0eXBdID8/IFwiXCI7XG4gICAgZGVzY0lucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgdmFsdWUgPSBkZXNjSW5wdXQudmFsdWUudHJpbSgpO1xuICAgICAgaWYgKHZhbHVlKSB0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBEZXNjcmlwdGlvbnNbdHlwXSA9IHZhbHVlO1xuICAgICAgZWxzZSBkZWxldGUgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwRGVzY3JpcHRpb25zW3R5cF07XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICB9KTtcblxuICAgIC8vIFNlcGFyYXRlcyB0aGUgZnJvbnRtYXR0ZXIgYmxvY2tzIGZyb20gdGhlIFRZUCdzIG90aGVyIHNldHRpbmdzLlxuICAgIGJvZHkuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1kZXRhaWwtc2VwYXJhdG9yXCIgfSk7XG5cbiAgICAvLyBUWVAtRnJvbnRtYXR0ZXIgYW5kIG9uZSBibG9jayBwZXIgcmVnaXN0ZXJlZCBTdWJ0eXAgYmVsb3csIGVhY2ggd2l0aCBpdHNcbiAgICAvLyBvd24gZWRpdG9yIChzZWUgZnJvbnRtYXR0ZXItYmxvY2tzLmpzKSwgc28gdGhlIHNhbWUga2V5IG1heSBhcHBlYXIgaW5cbiAgICAvLyBzZXZlcmFsIGJsb2Nrcy4gQSBTdWJ0eXAgYmxvY2sgYWRkcyB0byB0aGUgVFlQLUZyb250bWF0dGVyIGZvciBub3RlcyB3aXRoXG4gICAgLy8gdGhhdCBTVUJUWVAgYW5kIG92ZXJyaWRlcyBzYW1lLW5hbWVkIHByb3BlcnRpZXMgKHNlZSBzdWJ0eXBzLmpzKS5cbiAgICBjb25zdCBidWNrZXQgPSB0aGlzLnBsdWdpbi50eXBJbmRleC5zdWJ0eXBCdWNrZXQodHlwKTtcbiAgICB0aGlzLmZyb250bWF0dGVyQmxvY2tzID0gbW91bnRGcm9udG1hdHRlckJsb2Nrcyh0aGlzLCBib2R5LCB0eXAsIHtcbiAgICAgIHJlbmRlckhlYWRlcjogKHNlY3Rpb24sIGVsLCBibG9ja3MpID0+IHRoaXMucmVuZGVyU2VjdGlvbkhlYWRlcihlbCwgdHlwLCBzZWN0aW9uLCBidWNrZXQsIGJsb2NrcyksXG4gICAgICByZW5kZXJGb290ZXI6IChzZWN0aW9uLCBlbCkgPT4ge1xuICAgICAgICBpZiAoc2VjdGlvbiAhPT0gbnVsbCkgdGhpcy5yZW5kZXJTZWN0aW9uRm9vdGVyKGVsLCB0eXAsIHNlY3Rpb24pO1xuICAgICAgfSxcbiAgICAgIG9uTW92ZVNlY3Rpb246IGFzeW5jIChvcmRlcikgPT4ge1xuICAgICAgICByZW9yZGVyU3VidHlwcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBvcmRlcik7XG4gICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICB0aGlzLnJlbmRlcigpO1xuICAgICAgfSxcbiAgICB9KTtcbiAgICB0aGlzLmZyb250bWF0dGVyRWRpdG9ycy5wdXNoKC4uLnRoaXMuZnJvbnRtYXR0ZXJCbG9ja3MuZWRpdG9ycyk7XG5cbiAgICAvLyBGdWxsIHdpZHRoIGFuZCBhY2NlbnQgY29sb3IsIHRvIHN0YW5kIGFwYXJ0IGZyb20gdGhlIGJsb2Nrcycgc21hbGwgaWNvblxuICAgIC8vIGJ1dHRvbnMuXG4gICAgdGhpcy5zdWJ0eXBBZGRCdG5FbCA9IGJvZHkuY3JlYXRlRWwoXCJidXR0b25cIiwgeyBjbHM6IFwibW9kLWN0YSB0eXAtc3VidHlwLWFkZFwiIH0pO1xuICAgIHNldEljb24odGhpcy5zdWJ0eXBBZGRCdG5FbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1zdWJ0eXAtYWRkLWljb25cIiB9KSwgXCJwbHVzXCIpO1xuICAgIHRoaXMuc3VidHlwQWRkQnRuRWwuY3JlYXRlU3Bhbih7IHRleHQ6IFwiQWRkIFN1YnR5cFwiIH0pO1xuICAgIHRoaXMuc3VidHlwQWRkQnRuRWwuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMuc3RhcnRBZGRTdWJ0eXAodHlwKSk7XG5cbiAgICB0aGlzLnJlbmRlclVucmVnaXN0ZXJlZFN1YnR5cHMoYm9keSwgdHlwLCBidWNrZXQpO1xuXG4gICAgYm9keS5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWRldGFpbC1zZXBhcmF0b3JcIiB9KTtcbiAgICB0aGlzLnJlbmRlckZsb2F0aW5nSGludChib2R5KTtcbiAgICAvLyBUaGUgYm9sZCBtYXJrcyAoZnJvbnRtYXR0ZXItZGVmYXVsdC1oaWdobGlnaHQuanMpIG9ubHkgcmVhY3QgdG8gbWV0YWRhdGFcbiAgICAvLyBhbmQgbGF5b3V0IGV2ZW50czsgb3BlbmluZyB0aGlzIHZpZXcgZmlyZXMgbm9uZSwgc28gcmVmcmVzaCBoZXJlLiBPbmx5XG4gICAgLy8gdGhpcyBvbmUgcmVmcmVzaCwgbm90IHRoZSBmdWxsIHJlZnJlc2hUeXBDb2xvcnMoKSwgd2hpY2ggd291bGQgY2FsbFxuICAgIC8vIHJlbmRlcigpIG9uIHRoaXMgdmlldyB3aGlsZSBpdCBpcyBzdGlsbCByZW5kZXJpbmcuXG4gICAgdGhpcy5wbHVnaW4ucmVmcmVzaEZyb250bWF0dGVySGlnaGxpZ2h0Py4oKTtcbiAgfVxuXG4gIC8vIEEgYmxvY2sncyBoZWFkaW5nIChzZWUgZnJvbnRtYXR0ZXItYmxvY2tzLmpzKTogdGl0bGUgd2l0aCBub3RlIGNvdW50IChmb3JcbiAgLy8gdGhlIFRZUC1Gcm9udG1hdHRlciB0aGUgbm90ZXMgd2l0aG91dCBTVUJUWVAsIHRoZSBvbmx5IG9uZXMgaXQgYXBwbGllcyB0b1xuICAvLyBhbG9uZSksIHNlYXJjaCBvbiBjbGljaywgYW5kIHRoZSB0d28gYWRkIGJ1dHRvbnMgZm9yIGEgYmxhbmsgcm93IGluIHRoaXNcbiAgLy8gYmxvY2suXG4gIHJlbmRlclNlY3Rpb25IZWFkZXIoZWwsIHR5cCwgc2VjdGlvbiwgYnVja2V0LCBibG9ja3MpIHtcbiAgICBjb25zdCB0aXRsZUdyb3VwID0gZWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci10aXRsZS1ncm91cFwiIH0pO1xuICAgIC8vIE5ldmVyIGNvbG9yZWQsIHVubGlrZSB0aGUgZGV0YWlsIHRpdGxlIGFib3ZlOiBhIGJsb2NrJ3MgY29sb3Igc2l0cyBpblxuICAgIC8vIGl0cyBmb290ZXIgZG90IChzZWUgcmVuZGVyU2VjdGlvbkZvb3RlcikuXG4gICAgY29uc3QgdGl0bGVFbCA9IHRpdGxlR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1kZXRhaWwtc2VjdGlvbi10aXRsZVwiLCB0ZXh0OiBzZWN0aW9uID8/IGAke3R5cH0tRnJvbnRtYXR0ZXJgIH0pO1xuICAgIGNvbnN0IGNvdW50ID0gc2VjdGlvbiA9PT0gbnVsbCA/IGJ1Y2tldC5ub1N1YnR5cCA6IGJ1Y2tldC5jb3VudHMuZ2V0KHNlY3Rpb24pID8/IDA7XG4gICAgdGl0bGVHcm91cC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1zdWJ0eXAtY291bnRcIiwgdGV4dDogU3RyaW5nKGNvdW50KSB9KTtcbiAgICB0aGlzLm1ha2VTZWFyY2hhYmxlKHRpdGxlRWwsICgpID0+IHRoaXMub3BlblN1YnR5cFNlYXJjaCh0eXAsIHNlY3Rpb24pKTtcblxuICAgIC8vIEZsb2F0aW5nIHByb3BlcnRpZXMgc2hhcmUgdGhlIGxpc3QgYW5kIG9yZGVyIG9mIHRoZSBvdGhlcnMgKHdoaWNoXG4gICAgLy8gZnJvbnRtYXR0ZXIgc29ydGluZyByZWxpZXMgb24pLCBzbyB0aGV5IGxhbmQgd2hlcmV2ZXIgZHJhZyAmIGRyb3AgcHV0c1xuICAgIC8vIHRoZW0gaW5zdGVhZCBvZiBhdCB0aGUgZW5kIG9mIGEgc2Vjb25kIGxpc3QuXG4gICAgY29uc3QgYWRkQnV0dG9ucyA9IGVsLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZnJvbnRtYXR0ZXItYWRkLWdyb3VwXCIgfSk7XG5cbiAgICAvLyBMZWZ0IG9mIHRoZSBwbGFpbiBidXR0b24sIGluIGFjY2VudCBjb2xvcjogbWFya3MgdGhlIG5leHQgYWRkZWQgKG9yLFxuICAgIC8vIHVudGlsIHNhdmVkLCByZW5hbWVkKSBwcm9wZXJ0eSBhcyBmbG9hdGluZyAoc2VlXG4gICAgLy8gZWRpdG9yLnR5cFBlbmRpbmdGbG9hdGluZ0FkZCkuIEZsb2F0aW5nIHByb3BlcnRpZXMgYXJlbid0IGNyZWF0ZWQgZm9yIG5ld1xuICAgIC8vIG5vdGVzIChzZWUgZ2V0VHlwRGVmYXVsdHMoKSkgYW5kIHNob3cgaW4gaXRhbGljcyB3aGVyZSBwcmVzZW50LlxuICAgIGNvbnN0IGFkZEZsb2F0aW5nUHJvcGVydHlCdG4gPSBhZGRCdXR0b25zLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWZyb250bWF0dGVyLWFkZC1mbG9hdGluZ1wiLFxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogXCJBZGQgZmxvYXRpbmcgcHJvcGVydHlcIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24oYWRkRmxvYXRpbmdQcm9wZXJ0eUJ0biwgXCJwbHVzXCIpO1xuICAgIGFkZEZsb2F0aW5nUHJvcGVydHlCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IGJsb2Nrcy5hZGRCbGFuayhzZWN0aW9uLCB0cnVlKSk7XG5cbiAgICBjb25zdCBhZGRQcm9wZXJ0eUJ0biA9IGFkZEJ1dHRvbnMuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtZnJvbnRtYXR0ZXItYWRkXCIsXG4gICAgICBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkFkZCBwcm9wZXJ0eVwiIH0sXG4gICAgfSk7XG4gICAgc2V0SWNvbihhZGRQcm9wZXJ0eUJ0biwgXCJwbHVzXCIpO1xuICAgIGFkZFByb3BlcnR5QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiBibG9ja3MuYWRkQmxhbmsoc2VjdGlvbiwgZmFsc2UpKTtcbiAgfVxuXG4gIC8vIEZvb3RlciBvZiBhIFN1YnR5cCBibG9jazogb24gdGhlIGxlZnQgdGhlIFN1YnR5cCBjb2xvciAoYSBkb3Qgb3BlbmluZyB0aGVcbiAgLy8gc2xpZGVycywgcmVzZXQgbmV4dCB0byBpdCksIG9uIHRoZSByaWdodCB0aGUgc2FtZSBhY3Rpb25zIGluIHRoZSBzYW1lIG9yZGVyXG4gIC8vIGFzIHRoZSBkZXRhaWwgaGVhZGVyIChyZW5hbWUgYW5kIHVwZGF0ZSBub3RlcywgcmVuYW1lLCBtYW51YWxseSBjcmVhdGFibGUsXG4gIC8vIGRlbGV0ZSkuIFRoZSBUWVAtRnJvbnRtYXR0ZXIgaGFzIG5vIGZvb3Rlci4gVGhlIHRpdGxlIGlzIGxvb2tlZCB1cCBvblxuICAvLyBjbGljayAtIGhlYWRpbmcgYW5kIGZvb3RlciBhcmUgcmVidWlsdCBvbiBldmVyeSBzeW5jaHJvbml6ZSgpLlxuICByZW5kZXJTZWN0aW9uRm9vdGVyKGVsLCB0eXAsIHN1YnR5cCkge1xuICAgIGVsLmFkZENsYXNzKFwidHlwLXN1YnR5cC1hY3Rpb25zXCIpO1xuICAgIGNvbnN0IGNvbG9yR3JvdXAgPSBlbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLXN1YnR5cC1jb2xvci1ncm91cFwiIH0pO1xuICAgIC8vIEEgcmluZyBhbHNvIHdoaWxlIHRoZSBUWVAgaXRzZWxmIGhhcyBubyBjb2xvciAtIHRoZW4gYW4gb2Zmc2V0IGNvbG9yc1xuICAgIC8vIG5vdGhpbmcgYW55d2hlcmUuXG4gICAgY29uc3Qgb3duQ29sb3IgPSBzdWJ0eXBIYXNPd25Db2xvcih0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApO1xuICAgIGNvbnN0IHR5cEhhc0NvbG9yID0gISF0aGlzLnBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnNbdHlwXTtcbiAgICBjb25zdCBjb2xvckRvdCA9IGNvbG9yR3JvdXAuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJ0eXAtc3VidHlwLWNvbG9yLWRvdFwiLFxuICAgICAgYXR0cjogeyBcImFyaWEtbGFiZWxcIjogIXR5cEhhc0NvbG9yID8gXCJUWVAgaGFzIG5vIGNvbG9yXCIgOiBvd25Db2xvciA/IFwiQWRqdXN0IGNvbG9yXCIgOiBcIlVzZXMgVFlQIGNvbG9yXCIgfSxcbiAgICB9KTtcbiAgICBjb2xvckRvdC50eXBTdWJ0eXAgPSBzdWJ0eXA7XG4gICAgcGFpbnRDb2xvckRvdChjb2xvckRvdCwgc3VidHlwQ29sb3IodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKSA/PyBERUZBVUxUX1RZUF9DT0xPUiwgIW93bkNvbG9yIHx8ICF0eXBIYXNDb2xvcik7XG4gICAgY29sb3JEb3QuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMub3BlblN1YnR5cENvbG9yUG9wb3Zlcihjb2xvckRvdCwgdHlwLCBzdWJ0eXApKTtcbiAgICBjb25zdCByZXNldEJ0biA9IGNvbG9yR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1jb2xvci1yZXNldFwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlJlc2V0IGNvbG9yXCIgfSB9KTtcbiAgICByZXNldEJ0bi50b2dnbGVDbGFzcyhcImlzLWRpc2FibGVkXCIsICFvd25Db2xvcik7XG4gICAgc2V0SWNvbihyZXNldEJ0biwgXCJyb3RhdGUtY2N3XCIpO1xuICAgIHJlc2V0QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBkYXRhID0gZ2V0U3VidHlwKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCk7XG4gICAgICBpZiAoIWRhdGE/LmNvbG9yKSByZXR1cm47XG4gICAgICBjb25zdCBzbmFwc2hvdCA9IHNuYXBzaG90U2V0dGluZ3ModGhpcy5wbHVnaW4pO1xuICAgICAgZGVsZXRlIGRhdGEuY29sb3I7XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgIG9mZmVyVW5kbyh0aGlzLnBsdWdpbiwgYENvbG9yIG9mIFN1YnR5cCAke3N1YnR5cH0gcmVzZXQuYCwgc25hcHNob3QpO1xuICAgICAgdGhpcy5yZWZyZXNoT3RoZXJWaWV3cygpO1xuICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICB9KTtcblxuICAgIGNvbnN0IGFjdGlvbnMgPSBlbC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLXN1YnR5cC1hY3Rpb24tZ3JvdXBcIiB9KTtcbiAgICBjb25zdCB0aXRsZUVsID0gKCkgPT4ge1xuICAgICAgbGV0IHNpYmxpbmcgPSBlbC5wcmV2aW91c0VsZW1lbnRTaWJsaW5nO1xuICAgICAgd2hpbGUgKHNpYmxpbmcgJiYgIXNpYmxpbmcuaGFzQ2xhc3MoXCJ0eXAtc2VjdGlvbi1oZWFkZXJcIikpIHNpYmxpbmcgPSBzaWJsaW5nLnByZXZpb3VzRWxlbWVudFNpYmxpbmc7XG4gICAgICByZXR1cm4gc2libGluZz8ucXVlcnlTZWxlY3RvcihcIi50eXAtZGV0YWlsLXNlY3Rpb24tdGl0bGVcIikgPz8gbnVsbDtcbiAgICB9O1xuICAgIGNvbnN0IHJlbmFtZSA9ICh1cGRhdGVOb3RlcykgPT4ge1xuICAgICAgY29uc3QgdGFyZ2V0ID0gdGl0bGVFbCgpO1xuICAgICAgaWYgKHRhcmdldCkgdGhpcy5zdGFydFN1YnR5cFJlbmFtZSh0eXAsIHN1YnR5cCwgdGFyZ2V0LCB7IHVwZGF0ZU5vdGVzIH0pO1xuICAgIH07XG5cbiAgICBjb25zdCByZW5hbWVXaXRoTm90ZXNCdG4gPSBhY3Rpb25zLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWRldGFpbC1yZW5hbWUtbm90ZXNcIixcbiAgICAgIGF0dHI6IHsgXCJhcmlhLWxhYmVsXCI6IFwiUmVuYW1lIGFuZCB1cGRhdGUgbm90ZXNcIiB9LFxuICAgIH0pO1xuICAgIHNldEljb24ocmVuYW1lV2l0aE5vdGVzQnRuLCBcInBlbmNpbFwiKTtcbiAgICByZW5hbWVXaXRoTm90ZXNCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHJlbmFtZSh0cnVlKSk7XG5cbiAgICBjb25zdCByZW5hbWVCdG4gPSBhY3Rpb25zLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtZGV0YWlsLXJlbmFtZVwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIlJlbmFtZVwiIH0gfSk7XG4gICAgc2V0SWNvbihyZW5hbWVCdG4sIFwicGVuY2lsXCIpO1xuICAgIHJlbmFtZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gcmVuYW1lKGZhbHNlKSk7XG5cbiAgICB0aGlzLnJlbmRlclN1YnR5cE1hbnVhbFRvZ2dsZShhY3Rpb25zLCB0eXAsIHN1YnR5cCk7XG5cbiAgICBjb25zdCBkZWxldGVCdG4gPSBhY3Rpb25zLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtZGV0YWlsLWRlbGV0ZVwiLCBhdHRyOiB7IFwiYXJpYS1sYWJlbFwiOiBcIkRlbGV0ZVwiIH0gfSk7XG4gICAgc2V0SWNvbihkZWxldGVCdG4sIFwidHJhc2hcIik7XG4gICAgZGVsZXRlQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLmRlbGV0ZVN1YnR5cFdpdGhDb25maXJtKHR5cCwgc3VidHlwKSk7XG4gIH1cblxuICAvLyBQb3BvdmVyIGJlbG93IGEgU3VidHlwIGJsb2NrJ3MgZG90OiBvbmUgc2xpZGVyIHBlciBjaGFubmVsLCBsaW1pdGVkIHRvIHRoZVxuICAvLyByYW5nZSBmcm9tIHRoZSBzZXR0aW5ncyAoc2VlIHR5cC1jb2xvcnMuanMpLCBlYWNoIHRyYWNrIHNob3dpbmcgdGhlIGNvbG9yc1xuICAvLyBpdCBjYW4gcmVhY2guIERyYWdnaW5nIG9ubHkgdXBkYXRlcyB0aGUgZG90IGhlcmU7IHNhdmluZywgdXBkYXRpbmcgdGhlXG4gIC8vIG90aGVyIHZpZXdzIGFuZCByZS1yZW5kZXJpbmcgdGhpcyBvbmUgaGFwcGVuIG9uIGNsb3NlIChjbGljayBvdXRzaWRlIG9yXG4gIC8vIEVzY2FwZSksIGFuZCBvbmx5IGlmIHRoZSBjb2xvciBjaGFuZ2VkLlxuICAvL1xuICAvLyBBIFN1YnR5cCBjb2xvciBpcyBhbiBvZmZzZXQgZnJvbSB0aGUgVFlQIGNvbG9yOiB3aGlsZSB0aGUgVFlQIGhhcyBub25lLFxuICAvLyB0aGVyZSBpcyBub3RoaW5nIHRvIG9mZnNldCwgc28gdGhlIHBvcG92ZXIgc2F5cyBzbyBhbmQgdGhlIHNsaWRlcnMgYXJlXG4gIC8vIGxvY2tlZCAodGhlIGRvdCBzdGF5cyBhIGhvbGxvdyByaW5nLCBzZWUgcmVuZGVyU2VjdGlvbkZvb3RlcikuXG4gIG9wZW5TdWJ0eXBDb2xvclBvcG92ZXIoYW5jaG9yRWwsIHR5cCwgc3VidHlwKSB7XG4gICAgdGhpcy5jbG9zZVN1YnR5cENvbG9yUG9wb3Zlcj8uKCk7XG4gICAgY29uc3QgeyBzZXR0aW5ncyB9ID0gdGhpcy5wbHVnaW47XG4gICAgY29uc3QgZGF0YSA9IGdldFN1YnR5cChzZXR0aW5ncywgdHlwLCBzdWJ0eXApO1xuICAgIGlmICghZGF0YSkgcmV0dXJuO1xuICAgIGNvbnN0IHR5cEhhc0NvbG9yID0gISFzZXR0aW5ncy50eXBDb2xvcnNbdHlwXTtcbiAgICBjb25zdCB0eXBDb2xvciA9IHNldHRpbmdzLnR5cENvbG9yc1t0eXBdID8/IERFRkFVTFRfVFlQX0NPTE9SO1xuICAgIC8vIFdpdGhvdXQgYW4gb2Zmc2V0IGV2ZXJ5IHNsaWRlciBzdGFydHMgYXQgMDsgU1VCVFlQX0NPTE9SX0NIQU5ORUxTIGFsb25lXG4gICAgLy8gc2F5cyB3aGljaCBleGlzdC5cbiAgICBjb25zdCBvZmZzZXQgPSBjbGFtcGVkT2Zmc2V0KHNldHRpbmdzLCBkYXRhLmNvbG9yKSA/PyBPYmplY3QuZnJvbUVudHJpZXMoU1VCVFlQX0NPTE9SX0NIQU5ORUxTLm1hcCgoeyBrZXkgfSkgPT4gW2tleSwgMF0pKTtcbiAgICBjb25zdCBkb2MgPSBhbmNob3JFbC5kb2M7XG4gICAgY29uc3QgcG9wb3ZlciA9IGRvYy5ib2R5LmNyZWF0ZURpdih7IGNsczogXCJtZW51IHR5cC1zdWJ0eXAtY29sb3ItcG9wb3ZlclwiIH0pO1xuICAgIGlmICghdHlwSGFzQ29sb3IpIHBvcG92ZXIuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zdWJ0eXAtY29sb3ItaGludFwiLCB0ZXh0OiBgU2V0IGEgY29sb3IgZm9yICR7dHlwfSBmaXJzdC5gIH0pO1xuXG4gICAgY29uc3Qgcm93cyA9IFtdO1xuICAgIGNvbnN0IHVwZGF0ZSA9ICgpID0+IHtcbiAgICAgIGNvbnN0IGNvbG9yID0gYXBwbHlDb2xvck9mZnNldCh0eXBDb2xvciwgb2Zmc2V0KTtcbiAgICAgIGZvciAoY29uc3QgZWwgb2YgdGhpcy5jb250ZW50RWwucXVlcnlTZWxlY3RvckFsbChcIi50eXAtc3VidHlwLWNvbG9yLWRvdFwiKSkge1xuICAgICAgICBpZiAoZWwudHlwU3VidHlwID09PSBzdWJ0eXApIHBhaW50Q29sb3JEb3QoZWwsIGNvbG9yLCAhaGFzQ29sb3JPZmZzZXQob2Zmc2V0KSB8fCAhc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0pO1xuICAgICAgfVxuICAgICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykgcm93KCk7XG4gICAgfTtcblxuICAgIGZvciAoY29uc3QgeyBrZXksIGxhYmVsLCB1bml0IH0gb2YgU1VCVFlQX0NPTE9SX0NIQU5ORUxTKSB7XG4gICAgICBjb25zdCBbbWluLCBtYXhdID0gY2hhbm5lbEJvdW5kcyhzZXR0aW5ncywga2V5KTtcbiAgICAgIGNvbnN0IHJvdyA9IHBvcG92ZXIuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zdWJ0eXAtY29sb3Itcm93XCIgfSk7XG4gICAgICByb3cuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtc3VidHlwLWNvbG9yLWxhYmVsXCIsIHRleHQ6IGxhYmVsIH0pO1xuICAgICAgY29uc3QgaW5wdXQgPSByb3cuY3JlYXRlRWwoXCJpbnB1dFwiLCB7IHR5cGU6IFwicmFuZ2VcIiwgY2xzOiBcInNsaWRlciB0eXAtc3VidHlwLWNvbG9yLXNsaWRlclwiIH0pO1xuICAgICAgaW5wdXQubWluID0gU3RyaW5nKG1pbik7XG4gICAgICBpbnB1dC5tYXggPSBTdHJpbmcobWF4KTtcbiAgICAgIGlucHV0LnN0ZXAgPSBcIjFcIjtcbiAgICAgIGlucHV0LnZhbHVlID0gU3RyaW5nKG9mZnNldFtrZXldKTtcbiAgICAgIGlucHV0LmRpc2FibGVkID0gbWluID09PSBtYXggfHwgIXR5cEhhc0NvbG9yO1xuICAgICAgY29uc3QgdmFsdWVFbCA9IHJvdy5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1zdWJ0eXAtY29sb3ItdmFsdWVcIiB9KTtcbiAgICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJpbnB1dFwiLCAoKSA9PiB7XG4gICAgICAgIG9mZnNldFtrZXldID0gTnVtYmVyKGlucHV0LnZhbHVlKTtcbiAgICAgICAgdXBkYXRlKCk7XG4gICAgICB9KTtcbiAgICAgIHJvd3MucHVzaCgoKSA9PiB7XG4gICAgICAgIGNvbnN0IHN0ZXBzID0gODtcbiAgICAgICAgY29uc3Qgc3RvcHMgPSBbXTtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPD0gc3RlcHM7IGkrKykge1xuICAgICAgICAgIHN0b3BzLnB1c2goYXBwbHlDb2xvck9mZnNldCh0eXBDb2xvciwgeyAuLi5vZmZzZXQsIFtrZXldOiBtaW4gKyAoKG1heCAtIG1pbikgKiBpKSAvIHN0ZXBzIH0pKTtcbiAgICAgICAgfVxuICAgICAgICBpbnB1dC5zdHlsZS5zZXRQcm9wZXJ0eShcIi0tdHlwLXRyYWNrXCIsIGBsaW5lYXItZ3JhZGllbnQodG8gcmlnaHQsICR7c3RvcHMuam9pbihcIiwgXCIpfSlgKTtcbiAgICAgICAgdmFsdWVFbC5zZXRUZXh0KGAke29mZnNldFtrZXldID4gMCA/IFwiK1wiIDogXCJcIn0ke29mZnNldFtrZXldfSR7dW5pdH1gKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICB1cGRhdGUoKTtcblxuICAgIC8vIEJlbG93IHRoZSBkb3QsIGJ1dCBpbnNpZGUgdGhlIHdpbmRvdy5cbiAgICBjb25zdCByZWN0ID0gYW5jaG9yRWwuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgY29uc3Qgd2luID0gZG9jLmRlZmF1bHRWaWV3O1xuICAgIGNvbnN0IHdpZHRoID0gcG9wb3Zlci5vZmZzZXRXaWR0aDtcbiAgICBjb25zdCBoZWlnaHQgPSBwb3BvdmVyLm9mZnNldEhlaWdodDtcbiAgICBwb3BvdmVyLnN0eWxlLmxlZnQgPSBgJHtNYXRoLm1heCg4LCBNYXRoLm1pbihyZWN0LmxlZnQsIHdpbi5pbm5lcldpZHRoIC0gd2lkdGggLSA4KSl9cHhgO1xuICAgIHBvcG92ZXIuc3R5bGUudG9wID0gYCR7cmVjdC5ib3R0b20gKyA2ICsgaGVpZ2h0ID4gd2luLmlubmVySGVpZ2h0IC0gOCA/IHJlY3QudG9wIC0gNiAtIGhlaWdodCA6IHJlY3QuYm90dG9tICsgNn1weGA7XG5cbiAgICBjb25zdCBvblBvaW50ZXJEb3duID0gKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoIXBvcG92ZXIuY29udGFpbnMoZXZlbnQudGFyZ2V0KSkgY2xvc2UoKTtcbiAgICB9O1xuICAgIGNvbnN0IG9uS2V5RG93biA9IChldmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmtleSAhPT0gXCJFc2NhcGVcIikgcmV0dXJuO1xuICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGV2ZW50LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgY2xvc2UoKTtcbiAgICB9O1xuICAgIGNvbnN0IGNsb3NlID0gYXN5bmMgKCkgPT4ge1xuICAgICAgdGhpcy5jbG9zZVN1YnR5cENvbG9yUG9wb3ZlciA9IG51bGw7XG4gICAgICBkb2MucmVtb3ZlRXZlbnRMaXN0ZW5lcihcIm1vdXNlZG93blwiLCBvblBvaW50ZXJEb3duLCB0cnVlKTtcbiAgICAgIGRvYy5yZW1vdmVFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCBvbktleURvd24sIHRydWUpO1xuICAgICAgcG9wb3Zlci5yZW1vdmUoKTtcbiAgICAgIGNvbnN0IGN1cnJlbnQgPSBnZXRTdWJ0eXAoc2V0dGluZ3MsIHR5cCwgc3VidHlwKTtcbiAgICAgIGlmICghY3VycmVudCkgcmV0dXJuO1xuICAgICAgLy8gVW5jaGFuZ2VkIChqdXN0IGxvb2tlZCwgb3Igc2xpZCBiYWNrKTogbm90aGluZyB0byBzYXZlLCBhbmQgbm9cbiAgICAgIC8vIHJlLXJlbmRlciB0aGF0IGNvdWxkIG1vdmUgYW55dGhpbmcuXG4gICAgICBjb25zdCBuZXh0ID0gaGFzQ29sb3JPZmZzZXQob2Zmc2V0KSA/IHsgLi4ub2Zmc2V0IH0gOiBudWxsO1xuICAgICAgaWYgKEpTT04uc3RyaW5naWZ5KG5leHQpID09PSBKU09OLnN0cmluZ2lmeShjdXJyZW50LmNvbG9yID8/IG51bGwpKSByZXR1cm47XG4gICAgICAvLyBUaGUgc2xpZGVycyBvbmx5IHRvdWNoZWQgdGhlIGRvdCBzbyBmYXIsIHNvIGEgc25hcHNob3QgdGFrZW4gbm93IGlzXG4gICAgICAvLyBzdGlsbCB0aGUgc3RhdGUgZnJvbSBvcGVuaW5nIC0gd2l0aG91dCByZXZlcnRpbmcgYW55dGhpbmcgc2F2ZWRcbiAgICAgIC8vIGVsc2V3aGVyZSBpbiB0aGUgbWVhbnRpbWUuXG4gICAgICBjb25zdCBzbmFwc2hvdCA9IHNuYXBzaG90U2V0dGluZ3ModGhpcy5wbHVnaW4pO1xuICAgICAgaWYgKG5leHQpIGN1cnJlbnQuY29sb3IgPSBuZXh0O1xuICAgICAgZWxzZSBkZWxldGUgY3VycmVudC5jb2xvcjtcbiAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgb2ZmZXJVbmRvKHRoaXMucGx1Z2luLCBgQ29sb3Igb2YgU3VidHlwICR7c3VidHlwfSBjaGFuZ2VkLmAsIHNuYXBzaG90KTtcbiAgICAgIHRoaXMucmVmcmVzaE90aGVyVmlld3MoKTtcbiAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgfTtcbiAgICB0aGlzLmNsb3NlU3VidHlwQ29sb3JQb3BvdmVyID0gY2xvc2U7XG4gICAgZG9jLmFkZEV2ZW50TGlzdGVuZXIoXCJtb3VzZWRvd25cIiwgb25Qb2ludGVyRG93biwgdHJ1ZSk7XG4gICAgZG9jLmFkZEV2ZW50TGlzdGVuZXIoXCJrZXlkb3duXCIsIG9uS2V5RG93biwgdHJ1ZSk7XG4gIH1cblxuICAvLyBEZWxldGVzIHRoZSBTdWJ0eXAgYmxvY2sgd2l0aCBpdHMgcHJvcGVydGllcy4gTm90ZXMga2VlcCB0aGVpciBTVUJUWVBcbiAgLy8gdmFsdWUgKGl0IHRoZW4gc2hvd3MgYXMgdW5yZWdpc3RlcmVkIGJlbG93KSwgc28gY29uZmlybWF0aW9uIGlzIG9ubHlcbiAgLy8gbmVlZGVkIHdoZW4gcHJvcGVydGllcyB3b3VsZCBiZSBsb3N0LiBFaXRoZXIgd2F5IGFuIHVuZG8gaXMgb2ZmZXJlZFxuICAvLyBhZnRlcndhcmRzIChzZWUgdW5kby5qcykuXG4gIGRlbGV0ZVN1YnR5cFdpdGhDb25maXJtKHR5cCwgc3VidHlwKSB7XG4gICAgY29uc3QgYXBwbHkgPSBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBzbmFwc2hvdCA9IHNuYXBzaG90U2V0dGluZ3ModGhpcy5wbHVnaW4pO1xuICAgICAgZGVsZXRlU3VidHlwKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCk7XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgIG9mZmVyVW5kbyh0aGlzLnBsdWdpbiwgYFN1YnR5cCAke3N1YnR5cH0gZGVsZXRlZC5gLCBzbmFwc2hvdCk7XG4gICAgICB0aGlzLnJlZnJlc2hPdGhlclZpZXdzKCk7XG4gICAgICB0aGlzLnJlbmRlcigpO1xuICAgIH07XG4gICAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKGdldFN1YnR5cCh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCBzdWJ0eXApPy5mcm9udG1hdHRlciA/PyB7fSkuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gXCJcIik7XG4gICAgaWYgKGtleXMubGVuZ3RoID09PSAwKSB7XG4gICAgICBhcHBseSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB7IHBsdWdpbiB9ID0gdGhpcztcbiAgICB0aGlzLmNvbmZpcm1EZWxldGlvbihcbiAgICAgIHtcbiAgICAgICAgdGl0bGU6IFtcbiAgICAgICAgICBcIkRlbGV0ZSBcIixcbiAgICAgICAgICBzdWJ0eXBOYW1lTm9kZShwbHVnaW4sIHR5cCwgc3VidHlwKSxcbiAgICAgICAgICBcIiBvZiBcIixcbiAgICAgICAgICB0eXBOYW1lTm9kZShwbHVnaW4sIHR5cCwgcGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdID8/IG51bGwpLFxuICAgICAgICAgIFwiP1wiLFxuICAgICAgICBdLFxuICAgICAgICBib2R5OiBbXG4gICAgICAgICAga2V5cy5sZW5ndGggPT09IDFcbiAgICAgICAgICAgID8gYEl0cyBwcm9wZXJ0eSAke2tleXNbMF19IHdpbGwgYmUgbG9zdC5gXG4gICAgICAgICAgICA6IGBJdHMgJHtrZXlzLmxlbmd0aH0gcHJvcGVydGllcyAke2tleXMuam9pbihcIiwgXCIpfSB3aWxsIGJlIGxvc3QuYCxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgICBhcHBseVxuICAgICk7XG4gIH1cblxuICAvLyBcIkRlbGV0ZSBUWVBcIiBhbmQgXCJEZWxldGUgU3VidHlwXCIgY2hhbmdlIG5vdGhpbmcgYnV0IHRoZSBzZXR0aW5ncyBhbmQgb2ZmZXJcbiAgLy8gVW5kbyBhZnRlcndhcmRzLCBzbyAtIHVubGlrZSBldmVyeSBkaWFsb2cgdGhhdCByZXdyaXRlcyBub3RlcyAtIHRoZWlyXG4gIC8vIGNvbmZpcm1hdGlvbiBjYW4gYmUgc3dpdGNoZWQgb2ZmOiBzZXR0aW5nIFwiQ29uZmlybSBkZWxldGlvblwiLCBvciBcIkRvbid0XG4gIC8vIGFzayBhZ2FpblwiIGluIHRoZSBkaWFsb2cgaXRzZWxmLiBXaXRob3V0IGl0IGFwcGx5KCkgcnVucyBhdCBvbmNlLlxuICBjb25maXJtRGVsZXRpb24oeyB0aXRsZSwgYm9keSB9LCBhcHBseSkge1xuICAgIGlmICghdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29uZmlybURlbGV0aW9uKSB7XG4gICAgICBhcHBseSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBuZXcgQ29uZmlybU1vZGFsKHRoaXMuYXBwLCB7XG4gICAgICB0aXRsZSxcbiAgICAgIGJvZHksXG4gICAgICBjb25maXJtVGV4dDogXCJEZWxldGVcIixcbiAgICAgIHdhcm5pbmc6IHRydWUsXG4gICAgICBmb2N1czogXCJjYW5jZWxcIixcbiAgICAgIGRvbnRBc2tBZ2FpbjogdHJ1ZSxcbiAgICAgIG9uQ29uZmlybTogKGRvbnRBc2tBZ2FpbikgPT4ge1xuICAgICAgICAvLyBTZXQgYmVmb3JlIGFwcGx5KCksIHdoaWNoIHNhdmVzIGl0IGFsb25nIHdpdGggdGhlIGRlbGV0aW9uIGFuZFxuICAgICAgICAvLyB0YWtlcyBpdHMgdW5kbyBzbmFwc2hvdCBvbmx5IGFmdGVyd2FyZHMgLSBVbmRvIGRvZXNuJ3QgYnJpbmcgdGhlXG4gICAgICAgIC8vIGRpYWxvZyBiYWNrLlxuICAgICAgICBpZiAoZG9udEFza0FnYWluKSB0aGlzLnBsdWdpbi5zZXR0aW5ncy5jb25maXJtRGVsZXRpb24gPSBmYWxzZTtcbiAgICAgICAgYXBwbHkoKTtcbiAgICAgIH0sXG4gICAgfSkub3BlbigpO1xuICB9XG5cbiAgLy8gTGlrZSBzdGFydERldGFpbFJlbmFtZSgpLCBvbiBhIFN1YnR5cCBibG9jaydzIHRpdGxlLiBUaGUgYmxvY2sga2VlcHMgaXRzXG4gIC8vIHBvc2l0aW9uOyB1cGRhdGVOb3RlczogdHJ1ZSBhbHNvIHJld3JpdGVzIHRoZSBTVUJUWVAgb2YgdGhlIGFmZmVjdGVkIG5vdGVzXG4gIC8vIGFmdGVyIGNvbmZpcm1hdGlvbi4gQW4gZXhpc3RpbmcgbmFtZSBvZmZlcnMgYSBtZXJnZSBpbnN0ZWFkICh3aGljaCBhbHdheXNcbiAgLy8gcmV3cml0ZXMgdGhlIG5vdGVzKS5cbiAgc3RhcnRTdWJ0eXBSZW5hbWUodHlwLCBzdWJ0eXAsIHRpdGxlRWwsIHsgdXBkYXRlTm90ZXMgPSBmYWxzZSB9ID0ge30pIHtcbiAgICB0aGlzLnN0YXJ0SW5saW5lRWRpdCh0aXRsZUVsLCB7XG4gICAgICBjbGFzc2VzOiBbXCJ0eXAtc3VidHlwLW5hbWUtaW5wdXRcIiwgXCJpcy1iZWluZy1yZW5hbWVkXCJdLFxuICAgICAgLy8gVGhlIHRpdGxlIHNpdHMgYW1vbmcgT2JzaWRpYW4ncyBwcm9wZXJ0eSBlZGl0b3JzLCB3aG9zZSBrZXlib2FyZFxuICAgICAgLy8gbmF2aWdhdGlvbiB3b3VsZCByZWFjdCB0b28uXG4gICAgICBzdG9wQWxsS2V5czogdHJ1ZSxcbiAgICAgIG9uRmluaXNoOiAoY29tbWl0LCB0ZXh0KSA9PlxuICAgICAgICBjb21taXQgPyB0aGlzLmNvbW1pdFN1YnR5cFJlbmFtZSh0eXAsIHN1YnR5cCwgdGV4dCwgeyB1cGRhdGVOb3RlcyB9KSA6IHRoaXMucmVuZGVyKCksXG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBjb21taXRTdWJ0eXBSZW5hbWUodHlwLCBzdWJ0eXAsIHJhd1RleHQsIHsgdXBkYXRlTm90ZXMgfSkge1xuICAgIGNvbnN0IHZhbHVlID0gbm9ybWFsaXplU3VidHlwTmFtZShyYXdUZXh0KTtcbiAgICBpZiAoIXZhbHVlIHx8IHZhbHVlID09PSBzdWJ0eXApIHtcbiAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgY291bnRPZiA9IChuYW1lKSA9PiB0aGlzLnBsdWdpbi50eXBJbmRleC5zdWJ0eXBCdWNrZXQodHlwKS5jb3VudHMuZ2V0KG5hbWUpID8/IDA7XG4gICAgY29uc3QgYXBwbHlSZW5hbWUgPSBhc3luYyAoeyB3aXRoTm90ZXMgfSkgPT4ge1xuICAgICAgcmVuYW1lU3VidHlwKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCwgdmFsdWUpO1xuICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgICBjb25zdCByZW5hbWVkID0gd2l0aE5vdGVzID8gYXdhaXQgcmVuYW1lU3VidHlwSW5Ob3Rlcyh0aGlzLnBsdWdpbiwgdHlwLCBzdWJ0eXAsIHZhbHVlKSA6IDA7XG4gICAgICB0aGlzLnJlZnJlc2hPdGhlclZpZXdzKCk7XG4gICAgICBpZiAod2l0aE5vdGVzKSBuZXcgTm90aWNlKGBTdWJ0eXAgJHt2YWx1ZX06ICR7cGx1cmFsKHJlbmFtZWQsIFwibm90ZVwiKX0gdXBkYXRlZC5gKTtcbiAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgfTtcblxuICAgIGNvbnN0IGV4aXN0aW5nID0gZ2V0U3VidHlwTmFtZXModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCkuZmluZChcbiAgICAgIChuYW1lKSA9PiBuYW1lLnRvTG93ZXJDYXNlKCkgPT09IHZhbHVlLnRvTG93ZXJDYXNlKCkgJiYgbmFtZSAhPT0gc3VidHlwXG4gICAgKTtcbiAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgIG5ldyBDb25maXJtTW9kYWwodGhpcy5hcHAsIHtcbiAgICAgICAgdGl0bGU6IFtcbiAgICAgICAgICBcIk1lcmdlIFwiLFxuICAgICAgICAgIHN1YnR5cE5hbWVOb2RlKHRoaXMucGx1Z2luLCB0eXAsIHN1YnR5cCksXG4gICAgICAgICAgXCIgaW50byBcIixcbiAgICAgICAgICBzdWJ0eXBOYW1lTm9kZSh0aGlzLnBsdWdpbiwgdHlwLCBleGlzdGluZyksXG4gICAgICAgICAgXCI/XCIsXG4gICAgICAgIF0sXG4gICAgICAgIGJvZHk6IFtcbiAgICAgICAgICBgJHtleGlzdGluZ30gYWxyZWFkeSBleGlzdHMgaW4gJHt0eXB9LiBgICtcbiAgICAgICAgICAgIGAke3BsdXJhbChjb3VudE9mKHN1YnR5cCksIFwibm90ZVwiKX0gJHtjb3VudE9mKHN1YnR5cCkgPT09IDEgPyBcIm1vdmVzXCIgOiBcIm1vdmVcIn0gdG8gaXQsIGAgK1xuICAgICAgICAgICAgYGFuZCB0aGUgcHJvcGVydGllcyBvZiAke3N1YnR5cH0gbW92ZSBpbnRvIGl0cyBibG9jay5gLFxuICAgICAgICBdLFxuICAgICAgICBjb25maXJtVGV4dDogXCJNZXJnZVwiLFxuICAgICAgICB3YXJuaW5nOiB0cnVlLFxuICAgICAgICBmb2N1czogXCJjYW5jZWxcIixcbiAgICAgICAgb25Db25maXJtOiBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgbWVyZ2VTdWJ0eXBzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXAsIHN1YnR5cCwgZXhpc3RpbmcpO1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgICAgICAgIGNvbnN0IHJlbmFtZWQgPSBhd2FpdCByZW5hbWVTdWJ0eXBJbk5vdGVzKHRoaXMucGx1Z2luLCB0eXAsIHN1YnR5cCwgZXhpc3RpbmcpO1xuICAgICAgICAgIHRoaXMucmVmcmVzaE90aGVyVmlld3MoKTtcbiAgICAgICAgICBuZXcgTm90aWNlKGBTdWJ0eXAgJHtzdWJ0eXB9IG1lcmdlZCBpbnRvICR7ZXhpc3Rpbmd9LCAke3BsdXJhbChyZW5hbWVkLCBcIm5vdGVcIil9IHVwZGF0ZWQuYCk7XG4gICAgICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgICAgfSxcbiAgICAgICAgb25DYW5jZWw6ICgpID0+IHRoaXMucmVuZGVyKCksXG4gICAgICB9KS5vcGVuKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCF1cGRhdGVOb3Rlcykge1xuICAgICAgYXdhaXQgYXBwbHlSZW5hbWUoeyB3aXRoTm90ZXM6IGZhbHNlIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICAvLyBTYW1lIGNvbG9yIGZvciBvbGQgYW5kIG5ldyBuYW1lOiB0aGUgbmV3IG9uZSB0YWtlcyBvdmVyIHRoZSBvbGQgb25lJ3NcbiAgICAvLyBvZmZzZXQgKHNlZSByZW5hbWVTdWJ0eXApLlxuICAgIG5ldyBDb25maXJtTW9kYWwodGhpcy5hcHAsIHtcbiAgICAgIHRpdGxlOiBbXG4gICAgICAgIFwiUmVuYW1lIFwiLFxuICAgICAgICBzdWJ0eXBOYW1lTm9kZSh0aGlzLnBsdWdpbiwgdHlwLCBzdWJ0eXApLFxuICAgICAgICBcIiB0byBcIixcbiAgICAgICAgc3VidHlwTmFtZU5vZGUodGhpcy5wbHVnaW4sIHR5cCwgdmFsdWUsIHN1YnR5cCksXG4gICAgICAgIFwiP1wiLFxuICAgICAgXSxcbiAgICAgIGJvZHk6IFtgJHtwbHVyYWwoY291bnRPZihzdWJ0eXApLCBcIm5vdGVcIil9IHdpbGwgYmUgdXBkYXRlZC5gXSxcbiAgICAgIGNvbmZpcm1UZXh0OiBcIlJlbmFtZVwiLFxuICAgICAgZm9jdXM6IFwiY29uZmlybVwiLFxuICAgICAgb25Db25maXJtOiAoKSA9PiBhcHBseVJlbmFtZSh7IHdpdGhOb3RlczogdHJ1ZSB9KSxcbiAgICAgIG9uQ2FuY2VsOiAoKSA9PiB0aGlzLnJlbmRlcigpLFxuICAgIH0pLm9wZW4oKTtcbiAgfVxuXG4gIC8vIExpa2UgdGhlIHVucmVnaXN0ZXJlZCBlbnRyaWVzIG9mIHRoZSBUWVAtTGlzdDogU1VCVFlQIHZhbHVlcyBvZiB0aGlzIFRZUCdzXG4gIC8vIG5vdGVzIHRoYXQgaGF2ZSBubyBibG9jayB5ZXQgKG5vdGVzIHdpdGhvdXQgYW55IFNVQlRZUCBjb3VudCBmb3IgdGhlXG4gIC8vIFRZUC1Gcm9udG1hdHRlciBpbnN0ZWFkKS4gU2hvd24gbGlrZSBTdWJ0eXAgYmxvY2tzLCBidXQgb25seSBoZWFkaW5nIGFuZFxuICAvLyBjb3VudC4gQSBjbGljayBvbiB0aGUgYmxvY2sgcmVnaXN0ZXJzIHRoZSB2YWx1ZTsgYSBjbGljayBvbiB0aGUgbmFtZSBvcGVuc1xuICAvLyB0aGUgc2VhcmNoIGluc3RlYWQgLSBjaGVja2luZyB3aGF0IGEgdmFsdWUgaG9sZHMgYmVmb3JlIHJlZ2lzdGVyaW5nIGl0IGlzXG4gIC8vIHRoZSBjb21tb24gY2FzZS4gVGhlIG5hbWUgbGlnaHRzIHVwIGluIGFjY2VudCBjb2xvciBvbiBob3ZlciB0byBzaG93IGl0XG4gIC8vIGRvZXMgc29tZXRoaW5nIGRpZmZlcmVudCBmcm9tIHRoZSBhcmVhIGFyb3VuZCBpdC5cbiAgcmVuZGVyVW5yZWdpc3RlcmVkU3VidHlwcyhwYXJlbnQsIHR5cCwgYnVja2V0KSB7XG4gICAgY29uc3QgcmVnaXN0ZXJlZCA9IGdldFN1YnR5cE5hbWVzKHRoaXMucGx1Z2luLnNldHRpbmdzLCB0eXApO1xuICAgIGNvbnN0IHVucmVnaXN0ZXJlZCA9IFsuLi5idWNrZXQuY291bnRzLmtleXMoKV1cbiAgICAgIC5maWx0ZXIoKGtleSkgPT4gIXJlZ2lzdGVyZWQuaW5jbHVkZXMoa2V5KSlcbiAgICAgIC5zb3J0KChhLCBiKSA9PiBidWNrZXQuY291bnRzLmdldChiKSAtIGJ1Y2tldC5jb3VudHMuZ2V0KGEpIHx8IGEubG9jYWxlQ29tcGFyZShiKSk7XG4gICAgaWYgKHVucmVnaXN0ZXJlZC5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgIGNvbnN0IGxpc3RFbCA9IHBhcmVudC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLXN1YnR5cC11bnJlZ2lzdGVyZWQtbGlzdFwiIH0pO1xuICAgIGZvciAoY29uc3Qga2V5IG9mIHVucmVnaXN0ZXJlZCkge1xuICAgICAgY29uc3QgYmxvY2sgPSBsaXN0RWwuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci1ibG9jayB0eXAtc3VidHlwLWJsb2NrIHR5cC1zdWJ0eXAtdW5yZWdpc3RlcmVkXCIgfSk7XG4gICAgICBjb25zdCBoZWFkZXIgPSBibG9jay5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLWhlYWRlclwiIH0pO1xuICAgICAgY29uc3QgdGl0bGVHcm91cCA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLXRpdGxlLWdyb3VwXCIgfSk7XG4gICAgICBjb25zdCB0aXRsZUVsID0gdGl0bGVHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlXCIsIHRleHQ6IGRpc3BsYXlUeXBLZXkoa2V5KSB9KTtcbiAgICAgIHRpdGxlR3JvdXAuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtc3VidHlwLWNvdW50XCIsIHRleHQ6IFN0cmluZyhidWNrZXQuY291bnRzLmdldChrZXkpKSB9KTtcbiAgICAgIGJsb2NrLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnJlZ2lzdGVyU3VidHlwKHR5cCwga2V5LCBidWNrZXQpKTtcbiAgICAgIC8vIHN0b3BQcm9wYWdhdGlvbiwgb3IgdGhlIHNhbWUgY2xpY2sgd291bGQgYWxzbyByZWdpc3RlciB0aGUgdmFsdWUgb25lXG4gICAgICAvLyBvbmx5IHdhbnRlZCB0byBsb29rIHVwLlxuICAgICAgdGhpcy5tYWtlU2VhcmNoYWJsZSh0aXRsZUVsLCAoKSA9PiB0aGlzLm9wZW5TdWJ0eXBTZWFyY2godHlwLCBrZXkpLCB7IHN0b3BQcm9wYWdhdGlvbjogdHJ1ZSB9KTtcbiAgICB9XG4gIH1cblxuICAvLyBBIG5hbWUgd2hvc2UgY2xpY2sgb3BlbnMgdGhlIHNlYXJjaDogcG9pbnRlciBjdXJzb3IgYW5kIGFjY2VudCBjb2xvciBvblxuICAvLyBob3ZlciAoLnR5cC1zZWFyY2hhYmxlKSwgc28gdGhlIHZpZXcgaXRzZWxmIHNob3dzIHdoZXJlIHNvbWV0aGluZyBoYXBwZW5zLlxuICAvLyBUaGUgbmFtZSBpcyB3aGVyZSBvbmUgZXhwZWN0cyBcInNob3cgbWUgdGhlc2Ugbm90ZXNcIi4gV2hpbGUgcmVuYW1pbmcsIHRoZVxuICAvLyBlbGVtZW50IGlzIGFuIGlucHV0IChpcy1iZWluZy1yZW5hbWVkKSBhbmQgYSBjbGljayBqdXN0IHBsYWNlcyB0aGUgY3Vyc29yLlxuICBtYWtlU2VhcmNoYWJsZShlbCwgb25TZWFyY2gsIHsgc3RvcFByb3BhZ2F0aW9uID0gZmFsc2UgfSA9IHt9KSB7XG4gICAgZWwuYWRkQ2xhc3MoXCJ0eXAtc2VhcmNoYWJsZVwiKTtcbiAgICBlbC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB7XG4gICAgICBpZiAoZWwuaGFzQ2xhc3MoXCJpcy1iZWluZy1yZW5hbWVkXCIpKSByZXR1cm47XG4gICAgICBpZiAoc3RvcFByb3BhZ2F0aW9uKSBldmVudC5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgIG9uU2VhcmNoKCk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBzdWJ0eXBLZXkgPT09IG51bGwgbWVhbnMgbm90ZXMgb2YgdGhpcyBUWVAgd2l0aG91dCBTVUJUWVAuIEEgbGlzdCBoYXMgbm9cbiAgLy8gZXhhY3Qgc2VhcmNoIHN5bnRheCAoYXMgaW4gb3BlblNlYXJjaCgpKSwgc28gaXQgc2VhcmNoZXMgbm90ZXMgY2FycnlpbmcgYWxsXG4gIC8vIGl0cyBpdGVtcy5cbiAgb3BlblN1YnR5cFNlYXJjaCh0eXAsIHN1YnR5cEtleSkge1xuICAgIGNvbnN0IGdsb2JhbFNlYXJjaCA9IHRoaXMucGx1Z2luLmFwcC5pbnRlcm5hbFBsdWdpbnMuZ2V0UGx1Z2luQnlJZChcImdsb2JhbC1zZWFyY2hcIik7XG4gICAgaWYgKCFnbG9iYWxTZWFyY2gpIHJldHVybjtcbiAgICBjb25zdCB0eXBDbGF1c2UgPSB0aGlzLnR5cENsYXVzZSh0eXApO1xuICAgIGxldCBzdWJ0eXBDbGF1c2U7XG4gICAgaWYgKHN1YnR5cEtleSA9PT0gbnVsbCkge1xuICAgICAgc3VidHlwQ2xhdXNlID0gYC1bXCIke1NVQlRZUF9QUk9QRVJUWX1cIl1gO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCByYXcgPSB0aGlzLnBsdWdpbi50eXBJbmRleC5zdWJ0eXBCdWNrZXQodHlwKS5yYXdCeUtleS5nZXQoc3VidHlwS2V5KTtcbiAgICAgIHN1YnR5cENsYXVzZSA9IEFycmF5LmlzQXJyYXkocmF3KVxuICAgICAgICA/IHJhdy5tYXAoKHYpID0+IGBbXCIke1NVQlRZUF9QUk9QRVJUWX1cIjpcIiR7U3RyaW5nKHYgPz8gXCJcIikudHJpbSgpfVwiXWApLmpvaW4oXCIgXCIpXG4gICAgICAgIDogYFtcIiR7U1VCVFlQX1BST1BFUlRZfVwiOlwiJHtzdWJ0eXBLZXl9XCJdYDtcbiAgICB9XG4gICAgZ2xvYmFsU2VhcmNoLmluc3RhbmNlLm9wZW5HbG9iYWxTZWFyY2goYCR7dHlwQ2xhdXNlfSAke3N1YnR5cENsYXVzZX1gKTtcbiAgfVxuXG4gIC8vIExpa2UgcmVnaXN0ZXJUeXAoKTogcmVnaXN0ZXJzIHRoZSBjbGVhbmVkIGZvcm0gKHRpdGxlIGNhc2UsIGEgbGlzdCBhcyBvbmVcbiAgLy8gdmFsdWUgXCJBLCBCXCIpIGFzIGEgU3VidHlwIG9mIHRoaXMgVFlQIGFuZCByZXdyaXRlcyB0aGUgU1VCVFlQIG9mIHRoZVxuICAvLyBhZmZlY3RlZCBub3Rlcy4gSWYgdGhlIFN1YnR5cCBleGlzdHMgaW4gYW5vdGhlciBzcGVsbGluZywgdGhlIG5vdGVzIGdvXG4gIC8vIHRoZXJlLlxuICBhc3luYyByZWdpc3RlclN1YnR5cCh0eXAsIHN1YnR5cEtleSwgYnVja2V0KSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5hcHBseVN1YnR5cFJlZ2lzdHJhdGlvbih0eXAsIHN1YnR5cEtleSwgYnVja2V0KTtcbiAgICBpZiAoIXJlc3VsdCkgcmV0dXJuO1xuXG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVNldHRpbmdzKCk7XG4gICAgdGhpcy5yZWZyZXNoT3RoZXJWaWV3cygpO1xuICAgIHRoaXMucmVuZGVyKCk7XG4gICAgaWYgKHJlc3VsdC5yZW5hbWVkID4gMCkgbmV3IE5vdGljZShgU3VidHlwICR7cmVzdWx0LnN1YnR5cH0gcmVnaXN0ZXJlZCwgJHtwbHVyYWwocmVzdWx0LnJlbmFtZWQsIFwibm90ZVwiKX0gdXBkYXRlZC5gKTtcbiAgfVxuXG4gIC8vIExpa2UgYXBwbHlUeXBSZWdpc3RyYXRpb246IHRoZSBjb3JlIHdpdGhvdXQgc2F2aW5nIGFuZCBub3RpY2UsIHNvXG4gIC8vIHJlZ2lzdGVyVHlwV2l0aFN1YnR5cCgpIGNhbiBidW5kbGUgaXQuIFJldHVybnMgeyBzdWJ0eXAsIHJlbmFtZWQgfSBvciBudWxsLlxuICBhc3luYyBhcHBseVN1YnR5cFJlZ2lzdHJhdGlvbih0eXAsIHN1YnR5cEtleSwgYnVja2V0KSB7XG4gICAgY29uc3QgcmF3ID0gYnVja2V0LnJhd0J5S2V5LmdldChzdWJ0eXBLZXkpO1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVSYXdUeXAocmF3ID09PSB1bmRlZmluZWQgPyBzdWJ0eXBLZXkgOiByYXcsIG5vcm1hbGl6ZVN1YnR5cE5hbWUpO1xuICAgIGlmICghbm9ybWFsaXplZCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgZXhpc3RpbmcgPSBnZXRTdWJ0eXBOYW1lcyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwKS5maW5kKChuYW1lKSA9PiBuYW1lLnRvTG93ZXJDYXNlKCkgPT09IG5vcm1hbGl6ZWQudG9Mb3dlckNhc2UoKSk7XG4gICAgY29uc3Qgc3VidHlwID0gZXhpc3RpbmcgPz8gbm9ybWFsaXplZDtcbiAgICBlbnN1cmVTdWJ0eXAodGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCwgc3VidHlwKTtcblxuICAgIGNvbnN0IHJlbmFtZWQgPSBzdWJ0eXAgIT09IHN1YnR5cEtleSA/IGF3YWl0IHJlbmFtZVN1YnR5cEluTm90ZXModGhpcy5wbHVnaW4sIHR5cCwgc3VidHlwS2V5LCBzdWJ0eXApIDogMDtcbiAgICByZXR1cm4geyBzdWJ0eXAsIHJlbmFtZWQgfTtcbiAgfVxuXG4gIC8vIEEgbmV3LCBlbXB0eSBTdWJ0eXAgYmxvY2sgcmlnaHQgYWJvdmUgdGhlIFwiQWRkIFN1YnR5cFwiIGJ1dHRvbiwgaXRzIG5hbWVcbiAgLy8gdHlwZWQgaW5saW5lIChsaWtlIHN0YXJ0QWRkKCkgaW4gdGhlIGxpc3QpLlxuICBzdGFydEFkZFN1YnR5cCh0eXApIHtcbiAgICBpZiAodGhpcy5pc0VkaXRpbmcgfHwgIXRoaXMuc3VidHlwQWRkQnRuRWwpIHJldHVybjtcblxuICAgIC8vIEJ1aWx0IGxpa2UgdGhlIGZpbmlzaGVkIChlbXB0eSkgYmxvY2ssIHdpdGggdGhlIFwiK1wiIGJ1dHRvbnMgYW5kIGZvb3RlclxuICAgIC8vIGFjdGlvbnMgdGhhdCBkbyBub3RoaW5nIHlldCwganVzdCB3aXRob3V0IGEgY291bnQgLSBzbyBub3RoaW5nIGp1bXBzXG4gICAgLy8gd2hlbiB0aGUgaW5wdXQgaXMgZG9uZSAoc2VlIC50eXAtc3VidHlwLXBlbmRpbmcpLlxuICAgIGNvbnN0IGJsb2NrID0gY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mcm9udG1hdHRlci1ibG9jayB0eXAtc3VidHlwLWJsb2NrIHR5cC1zdWJ0eXAtcGVuZGluZ1wiIH0pO1xuICAgIHRoaXMuc3VidHlwQWRkQnRuRWwucGFyZW50RWxlbWVudC5pbnNlcnRCZWZvcmUoYmxvY2ssIHRoaXMuc3VidHlwQWRkQnRuRWwpO1xuICAgIGNvbnN0IGhlYWRlciA9IGJsb2NrLmNyZWF0ZURpdih7IGNsczogXCJ0eXAtZnJvbnRtYXR0ZXItaGVhZGVyXCIgfSk7XG4gICAgY29uc3QgdGl0bGVHcm91cCA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLXRpdGxlLWdyb3VwXCIgfSk7XG4gICAgY29uc3QgbmFtZUVsID0gdGl0bGVHcm91cC5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWRldGFpbC1zZWN0aW9uLXRpdGxlIHR5cC1zdWJ0eXAtbmFtZS1pbnB1dCBpcy1iZWluZy1yZW5hbWVkXCIgfSk7XG4gICAgY29uc3QgYWRkQnV0dG9ucyA9IGhlYWRlci5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLWZyb250bWF0dGVyLWFkZC1ncm91cFwiIH0pO1xuICAgIHNldEljb24oYWRkQnV0dG9ucy5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWZyb250bWF0dGVyLWFkZC1mbG9hdGluZ1wiIH0pLCBcInBsdXNcIik7XG4gICAgc2V0SWNvbihhZGRCdXR0b25zLmNyZWF0ZURpdih7IGNsczogXCJjbGlja2FibGUtaWNvbiB0eXAtZnJvbnRtYXR0ZXItYWRkXCIgfSksIFwicGx1c1wiKTtcbiAgICBjb25zdCBmb290ZXIgPSBibG9jay5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLXNlY3Rpb24tZm9vdGVyIHR5cC1zdWJ0eXAtYWN0aW9uc1wiIH0pO1xuICAgIGNvbnN0IGNvbG9yR3JvdXAgPSBmb290ZXIuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zdWJ0eXAtY29sb3ItZ3JvdXBcIiB9KTtcbiAgICBwYWludENvbG9yRG90KGNvbG9yR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1zdWJ0eXAtY29sb3ItZG90XCIgfSksIHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cENvbG9yc1t0eXBdID8/IERFRkFVTFRfVFlQX0NPTE9SLCB0cnVlKTtcbiAgICBzZXRJY29uKGNvbG9yR3JvdXAuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1jb2xvci1yZXNldCBpcy1kaXNhYmxlZFwiIH0pLCBcInJvdGF0ZS1jY3dcIik7XG4gICAgY29uc3QgYWN0aW9ucyA9IGZvb3Rlci5jcmVhdGVEaXYoeyBjbHM6IFwidHlwLXN1YnR5cC1hY3Rpb24tZ3JvdXBcIiB9KTtcbiAgICBzZXRJY29uKGFjdGlvbnMuY3JlYXRlRGl2KHsgY2xzOiBcImNsaWNrYWJsZS1pY29uIHR5cC1kZXRhaWwtcmVuYW1lLW5vdGVzXCIgfSksIFwicGVuY2lsXCIpO1xuICAgIHNldEljb24oYWN0aW9ucy5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWRldGFpbC1yZW5hbWVcIiB9KSwgXCJwZW5jaWxcIik7XG4gICAgLy8gVGhlIHN0YXRlIGVuc3VyZVN1YnR5cCB3aWxsIGdpdmUgdGhlIG5ldyBTdWJ0eXA6IHRoYXQgb2YgaXRzIFRZUC5cbiAgICBjb25zdCBtYW51YWxDbHMgPSBcImNsaWNrYWJsZS1pY29uIHR5cC1tYW51YWwtaWNvblwiICsgKHRoaXMuZW5zdXJlVHlwTWFudWFsKClbdHlwXSAhPT0gZmFsc2UgPyBcIiBpcy1hY3RpdmVcIiA6IFwiXCIpO1xuICAgIHNldEljb24oYWN0aW9ucy5jcmVhdGVEaXYoeyBjbHM6IG1hbnVhbENscyB9KSwgXCJmaWxlLXBlbi1saW5lXCIpO1xuICAgIHNldEljb24oYWN0aW9ucy5jcmVhdGVEaXYoeyBjbHM6IFwiY2xpY2thYmxlLWljb24gdHlwLWRldGFpbC1kZWxldGVcIiB9KSwgXCJ0cmFzaFwiKTtcblxuICAgIHRoaXMuc3RhcnRJbmxpbmVFZGl0KG5hbWVFbCwge1xuICAgICAgLy8gbmFtZUVsIGNhcnJpZXMgdGhlIGlucHV0IGNsYXNzZXMgZnJvbSB0aGUgc3RhcnQuXG4gICAgICBjbGFzc2VzOiBbXSxcbiAgICAgIG9uRmluaXNoOiBhc3luYyAoY29tbWl0LCB0ZXh0KSA9PiB7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gbm9ybWFsaXplU3VidHlwTmFtZSh0ZXh0KTtcbiAgICAgICAgaWYgKGNvbW1pdCAmJiB2YWx1ZSkge1xuICAgICAgICAgIGNvbnN0IGV4aXN0aW5nID0gZ2V0U3VidHlwTmFtZXModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCkuZmluZCgobmFtZSkgPT4gbmFtZS50b0xvd2VyQ2FzZSgpID09PSB2YWx1ZS50b0xvd2VyQ2FzZSgpKTtcbiAgICAgICAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoYCR7dHlwfSBhbHJlYWR5IGhhcyBTdWJ0eXAgJHtleGlzdGluZ30uYCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGVuc3VyZVN1YnR5cCh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCB2YWx1ZSk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICAvLyBOb3RlcyBrZWVwIHRoZWlyIFRZUCAoaXQgdGhlbiBzaG93cyBhcyB1bnJlZ2lzdGVyZWQpLCBzbyB0aGlzIG9ubHkgY2hhbmdlc1xuICAvLyBzZXR0aW5nczogVW5kbyBhZnRlcndhcmRzLCBhbmQgdGhlIGNvbmZpcm1hdGlvbiBjYW4gYmUgc3dpdGNoZWQgb2ZmIChzZWVcbiAgLy8gY29uZmlybURlbGV0aW9uKS4gRnJvbSB0aGUgZGV0YWlsIGhlYWRlciBvciB0aGUgbGlzdCdzIGNvbnRleHQgbWVudS5cbiAgc2hvd0RlbGV0ZUNvbmZpcm0odHlwKSB7XG4gICAgY29uc3QgYXBwbHkgPSBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBzbmFwc2hvdCA9IHNuYXBzaG90U2V0dGluZ3ModGhpcy5wbHVnaW4pO1xuICAgICAgZGVsZXRlVHlwU2V0dGluZ3ModGhpcy5wbHVnaW4uc2V0dGluZ3MsIHR5cCk7XG4gICAgICAvLyBCYWNrIHRvIHRoZSBsaXN0IChvciB0aGUgbGlzdCByZWJ1aWx0KSByaWdodCBhd2F5LCBzbyB0aGUgZGVsZXRlZFxuICAgICAgLy8gVFlQJ3Mgbm93IGVtcHR5IGRldGFpbCB2aWV3IG5ldmVyIHNob3dzLlxuICAgICAgaWYgKHRoaXMuc2VsZWN0ZWRUeXAgPT09IHR5cCkgdGhpcy5jbG9zZVR5cFNldHRpbmdzKCk7XG4gICAgICBlbHNlIHRoaXMucmVuZGVyKCk7XG4gICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU2V0dGluZ3MoKTtcbiAgICAgIG9mZmVyVW5kbyh0aGlzLnBsdWdpbiwgYFRZUCAke3R5cH0gZGVsZXRlZC5gLCBzbmFwc2hvdCk7XG4gICAgICB0aGlzLnJlZnJlc2hPdGhlclZpZXdzKCk7XG4gICAgfTtcbiAgICB0aGlzLmNvbmZpcm1EZWxldGlvbihcbiAgICAgIHsgdGl0bGU6IFtcIkRlbGV0ZSBcIiwgdHlwTmFtZU5vZGUodGhpcy5wbHVnaW4sIHR5cCwgdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPz8gbnVsbCksIFwiP1wiXSB9LFxuICAgICAgYXBwbHlcbiAgICApO1xuICB9XG5cbiAgLy8gXCJSZW5hbWVcIiAvIFwiUmVuYW1lIGFuZCB1cGRhdGUgbm90ZXNcIiBmcm9tIHRoZSBsaXN0J3MgY29udGV4dCBtZW51OiB0aGVcbiAgLy8gbmFtZSBpbiB0aGUgcm93IGJlY29tZXMgdGhlIGlucHV0LCB0aGUgcmVzdCBpcyB0aGUgc2FtZSBhcyBpbiB0aGUgZGV0YWlsXG4gIC8vIHZpZXcgKGNvbW1pdFR5cFJlbmFtZSkuXG4gIHN0YXJ0TGlzdFJlbmFtZSh0eXAsIHNlbGYsIG5hbWVFbCwgb3B0aW9ucyA9IHt9KSB7XG4gICAgaWYgKHRoaXMuaXNFZGl0aW5nKSByZXR1cm47XG4gICAgLy8gQSBkcmFnZ2FibGUgcm93IChtYW51YWwgc29ydGluZykgd291bGQgdGFrZSB0aGUgbW91c2UgYXdheSBmcm9tIHRoZVxuICAgIC8vIHRleHQgLSBubyBjdXJzb3IgcGxhY2VtZW50IG9yIHNlbGVjdGlvbiBpbiB0aGUgbmFtZS4gcmVuZGVyKCkgcmVidWlsZHNcbiAgICAvLyB0aGUgcm93IGFmdGVyd2FyZHMuXG4gICAgc2VsZi5kcmFnZ2FibGUgPSBmYWxzZTtcbiAgICB0aGlzLnN0YXJ0SW5saW5lRWRpdChuYW1lRWwsIHtcbiAgICAgIGNsYXNzRWw6IHNlbGYsXG4gICAgICBvbkZpbmlzaDogKGNvbW1pdCwgdGV4dCkgPT4gKGNvbW1pdCA/IHRoaXMuY29tbWl0VHlwUmVuYW1lKHR5cCwgdGV4dCwgb3B0aW9ucykgOiB0aGlzLnJlbmRlcigpKSxcbiAgICB9KTtcbiAgfVxuXG4gIC8vIFRoZSByZW5hbWUgYnV0dG9ucyBvZiB0aGUgZGV0YWlsIGhlYWRlciwgb24gdGhlIHRpdGxlLlxuICBzdGFydERldGFpbFJlbmFtZSh0eXAsIHRpdGxlRWwsIG9wdGlvbnMgPSB7fSkge1xuICAgIHRoaXMuc3RhcnRJbmxpbmVFZGl0KHRpdGxlRWwsIHtcbiAgICAgIG9uRmluaXNoOiAoY29tbWl0LCB0ZXh0KSA9PiAoY29tbWl0ID8gdGhpcy5jb21taXRUeXBSZW5hbWUodHlwLCB0ZXh0LCBvcHRpb25zKSA6IHRoaXMucmVuZGVyKCkpLFxuICAgIH0pO1xuICB9XG5cbiAgLy8gVGhlIHJlbmFtZSBpdHNlbGYsIHNoYXJlZCBieSBsaXN0IGFuZCBkZXRhaWwgdmlldy4gdXBkYXRlTm90ZXM6IHRydWUgKHRoZVxuICAvLyBoaWdobGlnaHRlZCBidXR0b24pIGFsc28gcmV3cml0ZXMgdGhlIFRZUCBvZiBldmVyeSBhZmZlY3RlZCBub3RlIGFmdGVyXG4gIC8vIGNvbmZpcm1hdGlvbiAoc2VlIHJlbmFtZVR5cEluTm90ZXMpIGluc3RlYWQgb2Ygb25seSB0aGUgc2V0dGluZ3MuIEFuXG4gIC8vIGV4aXN0aW5nIG5hbWUgb2ZmZXJzIGEgbWVyZ2UgKHNob3dNZXJnZUNvbmZpcm0pLlxuICBhc3luYyBjb21taXRUeXBSZW5hbWUodHlwLCByYXdUZXh0LCB7IHVwZGF0ZU5vdGVzID0gZmFsc2UgfSA9IHt9KSB7XG4gICAgY29uc3QgdmFsdWUgPSBub3JtYWxpemVUeXBOYW1lKHJhd1RleHQpO1xuICAgIGlmICghdmFsdWUgfHwgdmFsdWUgPT09IHR5cCkge1xuICAgICAgdGhpcy5yZW5kZXIoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBleGlzdGluZyA9IHRoaXMucGx1Z2luLnNldHRpbmdzLnR5cHMuZmluZCgodCkgPT4gdC50b0xvd2VyQ2FzZSgpID09PSB2YWx1ZS50b0xvd2VyQ2FzZSgpICYmIHQgIT09IHR5cCk7XG4gICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICB0aGlzLnNob3dNZXJnZUNvbmZpcm0odHlwLCBleGlzdGluZyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCF1cGRhdGVOb3Rlcykge1xuICAgICAgYXdhaXQgdGhpcy5yZW5hbWVUeXBTZXR0aW5ncyh0eXAsIHZhbHVlKTtcbiAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gQSBidWxrIHdyaXRlIGFjcm9zcyBwb3NzaWJseSBtYW55IGZpbGVzIC0gY29uZmlybSBmaXJzdC4gU2FtZSBjb2xvciBmb3JcbiAgICAvLyBvbGQgYW5kIG5ldyBuYW1lOiB0aGUgbmV3IG9uZSBoYXMgbm8gdHlwQ29sb3JzIGVudHJ5IHlldCBidXQgdGFrZXMgb3ZlclxuICAgIC8vIHRoZSBvbGQgb25lJ3MgKHNlZSByZW5hbWVUeXBTZXR0aW5ncykuXG4gICAgY29uc3QgeyBjb3VudHMgfSA9IHRoaXMucGx1Z2luLnR5cEluZGV4LnR5cENvdW50cygpO1xuICAgIGNvbnN0IGNvbG9yID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gPz8gbnVsbDtcbiAgICBuZXcgQ29uZmlybU1vZGFsKHRoaXMuYXBwLCB7XG4gICAgICB0aXRsZTogW1wiUmVuYW1lIFwiLCB0eXBOYW1lTm9kZSh0aGlzLnBsdWdpbiwgdHlwLCBjb2xvciksIFwiIHRvIFwiLCB0eXBOYW1lTm9kZSh0aGlzLnBsdWdpbiwgdmFsdWUsIGNvbG9yKSwgXCI/XCJdLFxuICAgICAgYm9keTogW2Ake3BsdXJhbChjb3VudHMuZ2V0KHR5cCkgPz8gMCwgXCJub3RlXCIpfSB3aWxsIGJlIHVwZGF0ZWQuYF0sXG4gICAgICBjb25maXJtVGV4dDogXCJSZW5hbWVcIixcbiAgICAgIGZvY3VzOiBcImNvbmZpcm1cIixcbiAgICAgIG9uQ29uZmlybTogYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLnJlbmFtZVR5cFNldHRpbmdzKHR5cCwgdmFsdWUpO1xuICAgICAgICBjb25zdCByZW5hbWVkID0gYXdhaXQgcmVuYW1lVHlwSW5Ob3Rlcyh0aGlzLnBsdWdpbiwgdHlwLCB2YWx1ZSk7XG4gICAgICAgIG5ldyBOb3RpY2UoYFRZUCAke3ZhbHVlfTogJHtwbHVyYWwocmVuYW1lZCwgXCJub3RlXCIpfSB1cGRhdGVkLmApO1xuICAgICAgICB0aGlzLnJlbmRlcigpO1xuICAgICAgfSxcbiAgICAgIG9uQ2FuY2VsOiAoKSA9PiB0aGlzLnJlbmRlcigpLFxuICAgIH0pLm9wZW4oKTtcbiAgfVxuXG4gIC8vIE1vdmVzIG9ubHkgdGhlIHNldHRpbmdzIChsaXN0IHBvc2l0aW9uLCBjb2xvciwgZGVzY3JpcHRpb24sXG4gIC8vIFRZUC1Gcm9udG1hdHRlciwgbWFudWFsIHRvZ2dsZSwgU3VidHlwcyAtIHNlZSB0eXAtc2V0dGluZ3MuanMpIHRvIHRoZSBuZXdcbiAgLy8gbmFtZTsgdG91Y2hlcyBubyBub3Rlcy4gQW4gb3BlbiBkZXRhaWwgdmlldyBmb2xsb3dzIHRoZSBuZXcgbmFtZSwgYVxuICAvLyByZW5hbWUgZnJvbSB0aGUgbGlzdCBzdGF5cyBpbiB0aGUgbGlzdC5cbiAgYXN5bmMgcmVuYW1lVHlwU2V0dGluZ3ModHlwLCB2YWx1ZSkge1xuICAgIG1vdmVUeXBTZXR0aW5ncyh0aGlzLnBsdWdpbi5zZXR0aW5ncywgdHlwLCB2YWx1ZSk7XG4gICAgaWYgKHRoaXMuc2VsZWN0ZWRUeXAgPT09IHR5cCkgdGhpcy5zZWxlY3RlZFR5cCA9IHZhbHVlO1xuICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgIHRoaXMucmVmcmVzaE90aGVyVmlld3MoKTtcbiAgfVxuXG4gIC8vIFJlbmFtaW5nIHRvIHRoZSBuYW1lIG9mIGFuIGFscmVhZHkgcmVnaXN0ZXJlZCBUWVAgKHNlZSBjb21taXRUeXBSZW5hbWUpXG4gIC8vIG9mZmVycyB0byBtZXJnZSBib3RoIChzZWUgbWVyZ2VUeXApIGluc3RlYWQgb2Ygc2lsZW50bHkgZHJvcHBpbmcgdGhlXG4gIC8vIHJlbmFtZS4gSXQgYWx3YXlzIHJld3JpdGVzIHRoZSBub3Rlcywgd2hpY2hldmVyIHJlbmFtZSBidXR0b24gc3RhcnRlZCBpdDpcbiAgLy8gYSBtZXJnZSBpbiB0aGUgc2V0dGluZ3Mgb25seSB3b3VsZCBsZWF2ZSB0aGUgc291cmNlIFRZUCdzIG5vdGVzIGFzIGFuXG4gIC8vIHVucmVnaXN0ZXJlZCBlbnRyeS5cbiAgc2hvd01lcmdlQ29uZmlybShzb3VyY2UsIHRhcmdldCkge1xuICAgIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHRoaXMucGx1Z2luO1xuICAgIGNvbnN0IGNvdW50ID0gdGhpcy5wbHVnaW4udHlwSW5kZXgudHlwQ291bnRzKCkuY291bnRzLmdldChzb3VyY2UpID8/IDA7XG4gICAgbmV3IENvbmZpcm1Nb2RhbCh0aGlzLmFwcCwge1xuICAgICAgdGl0bGU6IFtcbiAgICAgICAgXCJNZXJnZSBcIixcbiAgICAgICAgdHlwTmFtZU5vZGUodGhpcy5wbHVnaW4sIHNvdXJjZSwgc2V0dGluZ3MudHlwQ29sb3JzW3NvdXJjZV0gPz8gbnVsbCksXG4gICAgICAgIFwiIGludG8gXCIsXG4gICAgICAgIHR5cE5hbWVOb2RlKHRoaXMucGx1Z2luLCB0YXJnZXQsIHNldHRpbmdzLnR5cENvbG9yc1t0YXJnZXRdID8/IG51bGwpLFxuICAgICAgICBcIj9cIixcbiAgICAgIF0sXG4gICAgICBib2R5OiBbXG4gICAgICAgIGAke3RhcmdldH0gYWxyZWFkeSBleGlzdHMuICR7cGx1cmFsKGNvdW50LCBcIm5vdGVcIil9ICR7Y291bnQgPT09IDEgPyBcIm1vdmVzXCIgOiBcIm1vdmVcIn0gdG8gaXQuIGAgK1xuICAgICAgICAgIGBUaGUgY29sb3IsIGRlc2NyaXB0aW9uIGFuZCBUWVAtRnJvbnRtYXR0ZXIgb2YgJHtzb3VyY2V9IGFyZSBkcm9wcGVkLiBgICtcbiAgICAgICAgICBgRXZlcnkgU3VidHlwIG1vdmVzIGFsb25nOyBibG9ja3Mgd2l0aCB0aGUgc2FtZSBuYW1lIGFyZSBtZXJnZWQuYCxcbiAgICAgIF0sXG4gICAgICBjb25maXJtVGV4dDogXCJNZXJnZVwiLFxuICAgICAgd2FybmluZzogdHJ1ZSxcbiAgICAgIGZvY3VzOiBcImNhbmNlbFwiLFxuICAgICAgb25Db25maXJtOiAoKSA9PiB0aGlzLm1lcmdlVHlwKHNvdXJjZSwgdGFyZ2V0KSxcbiAgICAgIG9uQ2FuY2VsOiAoKSA9PiB0aGlzLnJlbmRlcigpLFxuICAgIH0pLm9wZW4oKTtcbiAgfVxuXG4gIC8vIE1lcmdlcyBzb3VyY2UgaW50byB0YXJnZXQ6IG5vdGVzIGFyZSByZXdyaXR0ZW4gdG8gdGFyZ2V0LCBzb3VyY2UgbGVhdmVzXG4gIC8vIHRoZSBsaXN0IHdpdGggaXRzIHNldHRpbmdzICh0YXJnZXQga2VlcHMgaXRzIG93bikuIFNvdXJjZSdzIFN1YnR5cHMgbW92ZVxuICAvLyBvdmVyIGZpcnN0LCBzYW1lLW5hbWVkIGJsb2NrcyBhcmUgY29tYmluZWQgKHNlZSBtZXJnZVR5cFN1YnR5cHMgaW5cbiAgLy8gc3VidHlwcy5qcyk7IHRoZW4gdGhlIHJlc3Qgb2Ygc291cmNlIGdvZXMgbGlrZSBhIGRlbGV0ZWQgVFlQLlxuICAvL1xuICAvLyBcIk1hbnVhbGx5IGNyZWF0YWJsZVwiIGlzIHdoZXJlIGEgbWVyZ2UgZG9lcyBtb3JlIHRoYW4gbW92ZSBkYXRhOiB0aGUgbW92ZWRcbiAgLy8gU3VidHlwcyBicmluZyBzb3VyY2UncyB0b2dnbGVzIGJ1dCBlbmQgdXAgdW5kZXIgdGFyZ2V0J3MuIFdpdGggc291cmNlIG9uXG4gIC8vIGFuZCB0YXJnZXQgb2ZmIHRoZXkgd291bGQgYmUgc3dpdGNoZWQtb24gU3VidHlwcyB1bmRlciBhIHN3aXRjaGVkLW9mZiBUWVAsXG4gIC8vIHVucmVhY2hhYmxlIGluIHRoZSBwaWNrZXIuIFNvIGEgc3dpdGNoZWQtb2ZmIHRhcmdldCBzd2l0Y2hlcyB0aGVtIG9mZiB0b28sXG4gIC8vIGFzIGl0cyBvd24gYnV0dG9uIHdvdWxkIChzZWUgcmVuZGVyTWFudWFsVG9nZ2xlKS4gV2l0aCB0YXJnZXQgb24gdGhleSBzdGF5XG4gIC8vIGFzIHRoZXkgd2VyZS5cbiAgLy9cbiAgLy8gQW4gb3BlbiBkZXRhaWwgdmlldyBvZiBzb3VyY2UgbW92ZXMgdG8gdGFyZ2V0OyBhIG1lcmdlIHN0YXJ0ZWQgZnJvbSB0aGVcbiAgLy8gbGlzdCBzdGF5cyBpbiB0aGUgbGlzdC5cbiAgYXN5bmMgbWVyZ2VUeXAoc291cmNlLCB0YXJnZXQpIHtcbiAgICBjb25zdCBzZXR0aW5ncyA9IHRoaXMucGx1Z2luLnNldHRpbmdzO1xuICAgIGNvbnN0IHJlbmFtZWQgPSBhd2FpdCByZW5hbWVUeXBJbk5vdGVzKHRoaXMucGx1Z2luLCBzb3VyY2UsIHRhcmdldCk7XG5cbiAgICBtZXJnZVR5cFN1YnR5cHMoc2V0dGluZ3MsIHNvdXJjZSwgdGFyZ2V0KTtcbiAgICBkZWxldGVUeXBTZXR0aW5ncyhzZXR0aW5ncywgc291cmNlKTtcbiAgICBpZiAodGhpcy5lbnN1cmVUeXBNYW51YWwoKVt0YXJnZXRdID09PSBmYWxzZSkgc2V0QWxsU3VidHlwc01hbnVhbChzZXR0aW5ncywgdGFyZ2V0LCBmYWxzZSk7XG5cbiAgICBpZiAodGhpcy5zZWxlY3RlZFR5cCA9PT0gc291cmNlKSB0aGlzLnNlbGVjdGVkVHlwID0gdGFyZ2V0O1xuICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICAgIHRoaXMucmVmcmVzaE90aGVyVmlld3MoKTtcbiAgICBuZXcgTm90aWNlKGBUWVAgJHtzb3VyY2V9IG1lcmdlZCBpbnRvICR7dGFyZ2V0fSwgJHtwbHVyYWwocmVuYW1lZCwgXCJub3RlXCIpfSB1cGRhdGVkLmApO1xuICAgIHRoaXMucmVuZGVyKCk7XG4gIH1cblxuICByZW5kZXJDb3VudEZsYWlyKHNlbGYsIGNvdW50KSB7XG4gICAgY29uc3QgZmxhaXJPdXRlciA9IHNlbGYuY3JlYXRlRGl2KHsgY2xzOiBcInRyZWUtaXRlbS1mbGFpci1vdXRlclwiIH0pO1xuICAgIGZsYWlyT3V0ZXIuY3JlYXRlU3Bhbih7IGNsczogXCJ0cmVlLWl0ZW0tZmxhaXJcIiwgdGV4dDogU3RyaW5nKGNvdW50KSB9KTtcbiAgfVxuXG4gIC8vIEV4cGxhaW5zIHRoZSBmbG9hdGluZyB0b2dnbGUgKHJpZ2h0LWNsaWNrIG9uIGEgcHJvcGVydHkgYWJvdmUsIHNlZVxuICAvLyBlbnN1cmVQcm9wZXJ0eU1lbnVQYXRjaCkuIE5vIGhlYWRpbmcgLSByaWdodCBiZWxvdyB0aGUgbGlzdCBpdCBpcyBjbGVhclxuICAvLyB3aGF0IGl0IHJlZmVycyB0by5cbiAgcmVuZGVyRmxvYXRpbmdIaW50KHBhcmVudCkge1xuICAgIGNvbnN0IHNlY3Rpb24gPSBwYXJlbnQuY3JlYXRlRGl2KHsgY2xzOiBcInR5cC1mbG9hdGluZy1oaW50LXNlY3Rpb25cIiB9KTtcbiAgICBzZWN0aW9uLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwidHlwLWZsb2F0aW5nLWhpbnRcIixcbiAgICAgIHRleHQ6IFwiUmlnaHQtY2xpY2sgYSBwcm9wZXJ0eSB0byBtYWtlIGl0IGZsb2F0aW5nLlwiLFxuICAgIH0pO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlZ2lzdGVyVHlwUGFuZShwbHVnaW4pIHtcbiAgcGx1Z2luLnJlZ2lzdGVyVmlldyhWSUVXX1RZUEVfVFlQX1BBTkUsIChsZWFmKSA9PiBuZXcgVHlwUGFuZShsZWFmLCBwbHVnaW4pKTtcblxuICBwbHVnaW4uYWRkQ29tbWFuZCh7XG4gICAgaWQ6IFwib3Blbi10eXAtcGFuZVwiLFxuICAgIG5hbWU6IFwiT3BlbiBUWVAtUGFuZVwiLFxuICAgIGNhbGxiYWNrOiAoKSA9PiBhY3RpdmF0ZVR5cFBhbmUocGx1Z2luKSxcbiAgfSk7XG5cbiAgcGx1Z2luLmFkZENvbW1hbmQoe1xuICAgIGlkOiBcImFkZC10eXAtcHJvcGVydHlcIixcbiAgICBuYW1lOiBcIkFkZCBUWVAtRnJvbnRtYXR0ZXIgcHJvcGVydHlcIixcbiAgICBjYWxsYmFjazogKCkgPT4gYWRkVHlwUHJvcGVydHlDb21tYW5kKHBsdWdpbiksXG4gIH0pO1xuXG4gIC8vIE9uIGhvdCByZWxvYWQgdGhlIG9sZCBsZWFmIG9iamVjdCBzdXJ2aXZlcyAob25seSBvdXIgbW9kdWxlIHJlbG9hZHMpLCBidXRcbiAgLy8gXCJpbnN0YW5jZW9mIFR5cFBhbmVcIiBmYWlscyBhZ2FpbnN0IHRoZSByZWxvYWRlZCBjbGFzcywgYW5kIGdldFZpZXdUeXBlKClcbiAgLy8gY29tZXMgZnJvbSBsZWFmLnZpZXcgYWxvbmUuIGBhcHBgIHN1cnZpdmVzIHVuY2hhbmdlZCwgc28gdGhlIGxlYWZcbiAgLy8gcmVmZXJlbmNlIGlzIGtlcHQgdGhlcmUuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4gb3BlblR5cFBhbmVPblN0YXJ0KHBsdWdpbikpO1xuXG4gIC8vIGV4Y2VwdFZpZXc6IHRoZSBUWVAtUGFuZSB0aGF0IG1hZGUgdGhlIGNoYW5nZSBhbmQgdXBkYXRlcyBpdHNlbGYgKHNlZVxuICAvLyByZWZyZXNoVHlwQ29sb3JzRXhjZXB0IGluIG1haW4uanMpLlxuICBjb25zdCByZWZyZXNoID0gKGV4Y2VwdFZpZXcgPSBudWxsKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShWSUVXX1RZUEVfVFlQX1BBTkUpKSB7XG4gICAgICBpZiAobGVhZi52aWV3ID09PSBleGNlcHRWaWV3KSBjb250aW51ZTtcbiAgICAgIC8vIHJlbmRlcigpIGZvciBhIHZpZXcgb2YgdGhlIG1vZHVsZSBiZWZvcmUgYSBob3QgcmVsb2FkLlxuICAgICAgaWYgKGxlYWYudmlldz8ucmVxdWVzdFJlbmRlcikgbGVhZi52aWV3LnJlcXVlc3RSZW5kZXIoKTtcbiAgICAgIGVsc2UgbGVhZi52aWV3Py5yZW5kZXI/LigpO1xuICAgIH1cbiAgfTtcblxuICAvLyBLZWVwcyB0aGUgY291bnRzIGN1cnJlbnQgb24gZXZlcnkgVFlQLXJlbGV2YW50IGNoYW5nZSBlbHNld2hlcmUgKG5ldyBvclxuICAvLyBkZWxldGVkIG5vdGUsIFRZUCBvciBTVUJUWVAgY2hhbmdlZCkuIFRoZSBpbmRleCdzIFwiY2hhbmdlXCIgZmlyZXMgb25seSBmb3JcbiAgLy8gdGhvc2UsIG5vdCBvbiBldmVyeSBhdXRvc2F2ZS4gRGVib3VuY2VkIGFueXdheSBzaW5jZSByZW5kZXJpbmcgdGhlIGxpc3QgaXNcbiAgLy8gcmVsYXRpdmVseSBjb3N0bHk7IHJlc2V0VGltZXIgY29sbGVjdHMgYSBidXJzdCAoYnVsayBpbXBvcnQpIGludG8gb25lLlxuICAvLyBXaXRob3V0IHRoZSBldmVudCdzIGFyZ3VtZW50cywgd2hpY2ggYXJlbid0IGEgdmlldyB0byBsZWF2ZSBvdXQuXG4gIGNvbnN0IGRlYm91bmNlZFJlZnJlc2ggPSBkZWJvdW5jZSgoKSA9PiByZWZyZXNoKCksIDUwMCwgdHJ1ZSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCBkZWJvdW5jZWRSZWZyZXNoKSk7XG4gIC8vIFRoZSBcIkV4Y2x1ZGVkIGZpbGVzXCIgbGlzdCBjaGFuZ2VkIChIaWRlIEZvbGRlcnMgdG9nZ2xpbmcgYSBmb2xkZXIsIHNheSkuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAudmF1bHQub24oXCJjb25maWctY2hhbmdlZFwiLCBkZWJvdW5jZWRSZWZyZXNoKSk7XG5cbiAgLy8gQSBUZW1wbGF0ZXIgc2NyaXB0IGFwcGVhcmVkLCB2YW5pc2hlZCBvciB3YXMgcmVuYW1lZDogdGhlIHNob3J0Y3V0XG4gIC8vIGJ1dHRvbnMgdXBkYXRlIHRoZWlyIFwic2NyaXB0IG5vdCBmb3VuZFwiIHdhcm5pbmcgKHJlZnJlc2hTaG9ydGN1dENvbnRyb2xzKS5cbiAgLy8gVGhlIGxpc3QgaXMgcmVhZCBvbmNlIHRoZSBsYXlvdXQgaXMgcmVhZHkgLSBvbmx5IHRoZW4gZG9lcyB0aGUgd2FybmluZ1xuICAvLyBzaG93IGF0IGFsbCAoc2VlIHJlbmRlclNob3J0Y3V0Q29udHJvbHMpLlxuICBjb25zdCBvZmZTY3JpcHRzID0gcGx1Z2luLmdldFNob3J0Y3V0U2NyaXB0cz8ub25DaGFuZ2U/LigoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShWSUVXX1RZUEVfVFlQX1BBTkUpKSBsZWFmLnZpZXc/LnJlZnJlc2hTaG9ydGN1dENvbnRyb2xzPy4oKTtcbiAgfSk7XG4gIGlmIChvZmZTY3JpcHRzKSBwbHVnaW4ucmVnaXN0ZXIob2ZmU2NyaXB0cyk7XG5cbiAgLy8gRm9yIHBsdWdpbi5yZWZyZXNoVHlwQ29sb3JzKEV4Y2VwdCk6IHJlLXJlbmRlcnMgdGhlIGxpc3Qgb3IgdGhlIGRldGFpbFxuICAvLyB2aWV3LlxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxuLy8gbG9jYWxTdG9yYWdlIGtleSAocGVyIHZhdWx0LCBzZWUgb3BlblR5cFBhbmVPblN0YXJ0KS5cbmNvbnN0IFBBTkVfQ1JFQVRFRF9LRVkgPSBcInR5cC1zeXN0ZW0tcGFuZS1jcmVhdGVkXCI7XG5cbi8vIFRoZSBhdXRvbWF0aWMgY2FsbCBvbmNlIHRoZSBsYXlvdXQgaXMgcmVhZHksIG9uIGV2ZXJ5IHN0YXJ0IGFuZCBob3QgcmVsb2FkLlxuLy8gTm9ybWFsbHkgaXQgb25seSByZWNvbm5lY3RzIGFuIGV4aXN0aW5nIGxlYWYgb3JwaGFuZWQgYnkgaG90IHJlbG9hZFxuLy8gKGNyZWF0ZUlmTWlzc2luZzogZmFsc2UpLCBzbyBhIHBhbmUgdGhhdCB3YXMgY2xvc2VkIHN0YXlzIGNsb3NlZC4gT25seSBvbiB0aGVcbi8vIHZlcnkgZmlyc3Qgc3RhcnQgaW4gdGhpcyB2YXVsdCAobm8gZGF0YS5qc29uIHlldCwgcGx1Z2luLmlzRmlyc3RSdW4pIGl0XG4vLyBjcmVhdGVzIHRoZSBwYW5lIGluIHRoZSBsZWZ0IHNpZGViYXIgYW5kIHJldmVhbHMgaXQsIHNvIGEgbmV3IHVzZXIgZmluZHMgaXRcbi8vIHdpdGhvdXQga25vd2luZyB0aGUgY29tbWFuZC5cbi8vIFwiQWxyZWFkeSBjcmVhdGVkXCIgaXMgcmVtZW1iZXJlZCBpbiB0aGlzIGRldmljZSdzIGxvY2FsU3RvcmFnZSBmb3IgdGhlIHZhdWx0XG4vLyAoYXBwLnNhdmVMb2NhbFN0b3JhZ2UpLCBub3QgaW4gZGF0YS5qc29uOiBkYXRhLmpzb24gaXMgc3RpbGwgbWlzc2luZyB0aGVuLFxuLy8gc28gYSBob3QgcmVsb2FkIHdvdWxkIG90aGVyd2lzZSBvcGVuIHRoZSBwYW5lIGFnYWluLiBXcml0aW5nIGRhdGEuanNvbiBqdXN0XG4vLyBmb3IgdGhpcyBtYXJrZXIgY291bGQgbGV0IFN5bmMgcHV0IGRlZmF1bHRzIG92ZXIgdGhlIHJlYWwgc2V0dGluZ3Mgb24gYVxuLy8gc2Vjb25kIGRldmljZSB3aGVyZSB0aGUgcGx1Z2luIGFycml2ZXMgYmVmb3JlIGl0cyBkYXRhLmpzb24uXG5hc3luYyBmdW5jdGlvbiBvcGVuVHlwUGFuZU9uU3RhcnQocGx1Z2luKSB7XG4gIGNvbnN0IGFwcCA9IHBsdWdpbi5hcHA7XG4gIGNvbnN0IGZpcnN0UnVuID0gcGx1Z2luLmlzRmlyc3RSdW4gJiYgIWFwcC5sb2FkTG9jYWxTdG9yYWdlKFBBTkVfQ1JFQVRFRF9LRVkpO1xuICBhd2FpdCBhY3RpdmF0ZVR5cFBhbmUocGx1Z2luLCBmaXJzdFJ1biwgZmlyc3RSdW4pO1xuICBpZiAoZmlyc3RSdW4pIGFwcC5zYXZlTG9jYWxTdG9yYWdlKFBBTkVfQ1JFQVRFRF9LRVksIHRydWUpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBhY3RpdmF0ZVR5cFBhbmUocGx1Z2luLCByZXZlYWwgPSB0cnVlLCBjcmVhdGVJZk1pc3NpbmcgPSB0cnVlKSB7XG4gIGNvbnN0IGFwcCA9IHBsdWdpbi5hcHA7XG4gIGNvbnN0IHsgd29ya3NwYWNlIH0gPSBhcHA7XG5cbiAgY29uc3QgY2FuZGlkYXRlcyA9IFtdO1xuICB3b3Jrc3BhY2UuaXRlcmF0ZUFsbExlYXZlcygobGVhZikgPT4ge1xuICAgIGlmIChcbiAgICAgIGxlYWYgPT09IGFwcC5fX3R5cFN5c3RlbUxlYWYgfHxcbiAgICAgIChsZWFmLnZpZXcgJiYgbGVhZi52aWV3LmdldFZpZXdUeXBlKCkgPT09IFZJRVdfVFlQRV9UWVBfUEFORSlcbiAgICApIHtcbiAgICAgIGNhbmRpZGF0ZXMucHVzaChsZWFmKTtcbiAgICB9XG4gIH0pO1xuXG4gIGxldCBsZWFmID0gY2FuZGlkYXRlcy5zaGlmdCgpID8/IG51bGw7XG4gIGZvciAoY29uc3QgZXh0cmEgb2YgY2FuZGlkYXRlcykgZXh0cmEuZGV0YWNoKCk7XG5cbiAgaWYgKCFsZWFmKSB7XG4gICAgaWYgKCFjcmVhdGVJZk1pc3NpbmcpIHJldHVybjtcbiAgICBsZWFmID0gd29ya3NwYWNlLmdldExlZnRMZWFmKGZhbHNlKTtcbiAgICBhd2FpdCBsZWFmLnNldFZpZXdTdGF0ZSh7IHR5cGU6IFZJRVdfVFlQRV9UWVBfUEFORSwgYWN0aXZlOiB0cnVlIH0pO1xuICB9IGVsc2UgaWYgKCEobGVhZi52aWV3IGluc3RhbmNlb2YgVHlwUGFuZSkpIHtcbiAgICAvLyBhY3RpdmU6IGZhbHNlIC0ganVzdCByZWNvbm5lY3RpbmcuIG9uTGF5b3V0UmVhZHkgZmlyZXMgYXQgb25jZSBvbmNlIHRoZVxuICAgIC8vIGxheW91dCBpcyByZWFkeSwgc28gYWN0aXZlOiB0cnVlIHdvdWxkIHN0ZWFsIGZvY3VzIG9uIGV2ZXJ5IGhvdCByZWxvYWQuXG4gICAgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoeyB0eXBlOiBWSUVXX1RZUEVfVFlQX1BBTkUsIGFjdGl2ZTogZmFsc2UgfSk7XG4gIH1cblxuICBhcHAuX190eXBTeXN0ZW1MZWFmID0gbGVhZjtcbiAgaWYgKHJldmVhbCkgd29ya3NwYWNlLnJldmVhbExlYWYobGVhZik7XG59XG5cbi8vIFByZWZlcnMgYW4gb3BlbiBUWVAtUGFuZSBkZXRhaWwgKGV4YWN0bHkgbGlrZSBpdHMgXCIrXCIgYnV0dG9uKTsgb3RoZXJ3aXNlXG4vLyBvcGVucyB0aGUgZGV0YWlsIHZpZXcgZm9yIHRoZSBhY3RpdmUgbm90ZSdzIFRZUCBhbmQgYWRkcyB0aGUgcHJvcGVydHkgdGhlcmUuXG4vLyBXaXRob3V0IGFuIG9wZW4gbm90ZSBvciBUWVAsIGEgVFlQLVBhbmUgc2hvd2luZyBhIGRldGFpbCB2aWV3IC0gZXZlblxuLy8gdW5mb2N1c2VkIC0gaXMgdGhlIGZhbGxiYWNrLiBUaGUgYmFyZSBsaXN0IGRvZXNuJ3QgY291bnQ6IGl0IGhhcyBubyBlZGl0b3Jcbi8vIHRvIGFkZCB0by5cbmFzeW5jIGZ1bmN0aW9uIGFkZFR5cFByb3BlcnR5Q29tbWFuZChwbHVnaW4pIHtcbiAgY29uc3QgYXBwID0gcGx1Z2luLmFwcDtcblxuICBjb25zdCBhY3RpdmVUeXBQYW5lID0gYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKFR5cFBhbmUpO1xuICBpZiAoYWN0aXZlVHlwUGFuZSAmJiBhY3RpdmVUeXBQYW5lLnNlbGVjdGVkVHlwICE9PSBudWxsKSB7XG4gICAgYWN0aXZlVHlwUGFuZS5mcm9udG1hdHRlckJsb2Nrcz8uYWRkQmxhbmsobnVsbCk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgZmlsZSA9IGFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xuICBjb25zdCB0eXAgPSBwbHVnaW4udHlwSW5kZXgudHlwT2YoZmlsZSk7XG4gIGlmICghdHlwKSB7XG4gICAgY29uc3Qgb3BlbkxlYWYgPSBhcHAud29ya3NwYWNlXG4gICAgICAuZ2V0TGVhdmVzT2ZUeXBlKFZJRVdfVFlQRV9UWVBfUEFORSlcbiAgICAgIC5maW5kKChsZWFmKSA9PiBsZWFmLnZpZXcgaW5zdGFuY2VvZiBUeXBQYW5lICYmIGxlYWYudmlldy5zZWxlY3RlZFR5cCAhPT0gbnVsbCk7XG4gICAgaWYgKG9wZW5MZWFmKSB7XG4gICAgICBhd2FpdCBhcHAud29ya3NwYWNlLnJldmVhbExlYWYob3BlbkxlYWYpO1xuICAgICAgb3BlbkxlYWYudmlldy5mcm9udG1hdHRlckJsb2Nrcz8uYWRkQmxhbmsobnVsbCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIG5ldyBOb3RpY2UoXG4gICAgICBmaWxlXG4gICAgICAgID8gXCJUaGUgYWN0aXZlIG5vdGUgaGFzIG5vIFRZUCwgYW5kIG5vIFRZUCBpcyBvcGVuIGluIHRoZSBUWVAtUGFuZS5cIlxuICAgICAgICA6IFwiTm8gbm90ZSBpcyBvcGVuLCBhbmQgbm8gVFlQIGlzIG9wZW4gaW4gdGhlIFRZUC1QYW5lLlwiXG4gICAgKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBhd2FpdCBhY3RpdmF0ZVR5cFBhbmUocGx1Z2luKTtcbiAgY29uc3QgdmlldyA9IGFwcC5fX3R5cFN5c3RlbUxlYWY/LnZpZXc7XG4gIGlmICghKHZpZXcgaW5zdGFuY2VvZiBUeXBQYW5lKSkgcmV0dXJuO1xuICB2aWV3Lm9wZW5UeXBTZXR0aW5ncyh0eXApO1xuICB2aWV3LmZyb250bWF0dGVyQmxvY2tzPy5hZGRCbGFuayhudWxsKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyVHlwUGFuZSwgVklFV19UWVBFX1RZUF9QQU5FLCBjb21wYXJlVHlwcywgc29ydFR5cHNCeU1vZGUsIERFRkFVTFRfU09SVF9PUkRFUiwgREVGQVVMVF9UWVBfQ09MT1IgfTtcbiIsICJjb25zdCB7IFRGaWxlLCBURm9sZGVyIH0gPSByZXF1aXJlKFwib2JzaWRpYW5cIik7XG5jb25zdCB7IGNvbG9yRm9yRmlsZSwgc2V0SW5saW5lQ29sb3IgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5cbmNvbnN0IEZJTEVfRVhQTE9SRVJfVklFV19UWVBFID0gXCJmaWxlLWV4cGxvcmVyXCI7XG5jb25zdCBGT0xERVJfTk9URVNfUExVR0lOX0lEID0gXCJmb2xkZXItbm90ZXNcIjtcblxuLy8gRm9sZGVyIE5vdGVzIHNob3dzIGEgbm90ZSBhcyBpdHMgZm9sZGVyIGluc3RlYWQgb2YgYXMgaXRzIG93biByb3cuIEl0IGhhcyBub1xuLy8gcHVibGljIEFQSSBmb3IgdGhpcywgc28gdGhlIGZpbGUgbmFtZSBpcyByZWJ1aWx0IGZyb20gaXRzIGxpdmUgc2V0dGluZ3MuXG5mdW5jdGlvbiBnZXRGb2xkZXJOb3RlRmlsZShwbHVnaW4sIGZvbGRlcikge1xuICBjb25zdCBmb2xkZXJOb3RlcyA9IHBsdWdpbi5hcHAucGx1Z2lucy5wbHVnaW5zW0ZPTERFUl9OT1RFU19QTFVHSU5fSURdO1xuICBjb25zdCBzZXR0aW5ncyA9IGZvbGRlck5vdGVzPy5zZXR0aW5ncztcbiAgaWYgKCFzZXR0aW5ncykgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgZmlsZU5hbWUgPVxuICAgIChzZXR0aW5ncy5mb2xkZXJOb3RlTmFtZSB8fCBcInt7Zm9sZGVyX25hbWV9fVwiKS5yZXBsYWNlKFwie3tmb2xkZXJfbmFtZX19XCIsIGZvbGRlci5uYW1lKSArXG4gICAgKHNldHRpbmdzLmZvbGRlck5vdGVUeXBlIHx8IFwiLm1kXCIpO1xuICBjb25zdCBkaXJQYXRoID0gc2V0dGluZ3Muc3RvcmFnZUxvY2F0aW9uID09PSBcInBhcmVudEZvbGRlclwiID8gZm9sZGVyLnBhcmVudD8ucGF0aCA/PyBcIlwiIDogZm9sZGVyLnBhdGg7XG4gIGNvbnN0IHBhdGggPSBkaXJQYXRoID8gYCR7ZGlyUGF0aH0vJHtmaWxlTmFtZX1gIDogZmlsZU5hbWU7XG5cbiAgY29uc3QgZmlsZSA9IHBsdWdpbi5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHBhdGgpO1xuICByZXR1cm4gZmlsZSBpbnN0YW5jZW9mIFRGaWxlID8gZmlsZSA6IG51bGw7XG59XG5cbmZ1bmN0aW9uIGFwcGx5Q29sb3JUb1RpdGxlKHBsdWdpbiwgdGl0bGVFbCwgZmlsZSkge1xuICBjb25zdCBjb250ZW50RWwgPSB0aXRsZUVsLnF1ZXJ5U2VsZWN0b3IoXCIubmF2LWZpbGUtdGl0bGUtY29udGVudCwgLm5hdi1mb2xkZXItdGl0bGUtY29udGVudFwiKTtcbiAgaWYgKCFjb250ZW50RWwpIHJldHVybjtcblxuICBjb25zdCBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmZpbGVFeHBsb3JlciA/IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIFwiZmlsZUV4cGxvcmVyXCIpIDogbnVsbDtcbiAgc2V0SW5saW5lQ29sb3IoY29udGVudEVsLCBjb2xvcik7XG59XG5cbmZ1bmN0aW9uIGFwcGx5RmlsZUV4cGxvcmVyQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEZJTEVfRVhQTE9SRVJfVklFV19UWVBFKSkge1xuICAgIGNvbnN0IGZpbGVUaXRsZUVscyA9IGxlYWYudmlldy5jb250YWluZXJFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLm5hdi1maWxlLXRpdGxlW2RhdGEtcGF0aF1cIik7XG4gICAgZm9yIChjb25zdCB0aXRsZUVsIG9mIGZpbGVUaXRsZUVscykge1xuICAgICAgY29uc3QgZmlsZSA9IHBsdWdpbi5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHRpdGxlRWwuZ2V0QXR0cmlidXRlKFwiZGF0YS1wYXRoXCIpKTtcbiAgICAgIGFwcGx5Q29sb3JUb1RpdGxlKHBsdWdpbiwgdGl0bGVFbCwgZmlsZSBpbnN0YW5jZW9mIFRGaWxlID8gZmlsZSA6IG51bGwpO1xuICAgIH1cblxuICAgIGNvbnN0IGZvbGRlclRpdGxlRWxzID0gbGVhZi52aWV3LmNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIubmF2LWZvbGRlci10aXRsZVtkYXRhLXBhdGhdXCIpO1xuICAgIGZvciAoY29uc3QgdGl0bGVFbCBvZiBmb2xkZXJUaXRsZUVscykge1xuICAgICAgY29uc3QgZm9sZGVyID0gcGx1Z2luLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgodGl0bGVFbC5nZXRBdHRyaWJ1dGUoXCJkYXRhLXBhdGhcIikpO1xuICAgICAgY29uc3Qgbm90ZUZpbGUgPSBmb2xkZXIgaW5zdGFuY2VvZiBURm9sZGVyID8gZ2V0Rm9sZGVyTm90ZUZpbGUocGx1Z2luLCBmb2xkZXIpIDogbnVsbDtcbiAgICAgIGFwcGx5Q29sb3JUb1RpdGxlKHBsdWdpbiwgdGl0bGVFbCwgbm90ZUZpbGUpO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlckZpbGVFeHBsb3JlckNvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5RmlsZUV4cGxvcmVyQ29sb3JzKHBsdWdpbik7XG5cbiAgLy8gVGhlIGV4cGxvcmVyIHJlLXJlbmRlcnMgcm93cyB3aGVuIGZvbGRlcnMgZXhwYW5kIG9yIGNvbGxhcHNlLlxuICBjb25zdCBvYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKHJlZnJlc2gpO1xuICBjb25zdCBvYnNlcnZlRXhwbG9yZXJMZWF2ZXMgPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShGSUxFX0VYUExPUkVSX1ZJRVdfVFlQRSkpIHtcbiAgICAgIG9ic2VydmVyLm9ic2VydmUobGVhZi52aWV3LmNvbnRhaW5lckVsLCB7IGNoaWxkTGlzdDogdHJ1ZSwgc3VidHJlZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiBvYnNlcnZlci5kaXNjb25uZWN0KCkpO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAudmF1bHQub24oXCJyZW5hbWVcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChcbiAgICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgb2JzZXJ2ZUV4cGxvcmVyTGVhdmVzKCk7XG4gICAgICByZWZyZXNoKCk7XG4gICAgfSlcbiAgKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICBvYnNlcnZlRXhwbG9yZXJMZWF2ZXMoKTtcbiAgICByZWZyZXNoKCk7XG4gIH0pO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJGaWxlRXhwbG9yZXJDb2xvcnMgfTtcbiIsICJjb25zdCB7IGNvbG9yRm9yRmlsZSB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxuY29uc3QgR1JBUEhfVklFV19UWVBFUyA9IFtcImdyYXBoXCIsIFwibG9jYWxncmFwaFwiXTtcblxuZnVuY3Rpb24gaGV4VG9JbnQoaGV4KSB7XG4gIHJldHVybiBwYXJzZUludChoZXgucmVwbGFjZShcIiNcIiwgXCJcIiksIDE2KTtcbn1cblxuLy8gZW5naW5lLnJlbmRlcigpIG9ubHkgY29uc3VsdHMgaXRzIGZpbGVGaWx0ZXIgb25jZSBhIGNvbG9yIGdyb3VwIGV4aXN0cztcbi8vIHdpdGhvdXQgb25lIGV2ZXJ5IGZpbGUganVzdCBnZXRzIGNvbG9yOnRydWUuIFNvIHdlIHBhdGNoIHJlbmRlcmVyLnNldERhdGEsXG4vLyByaWdodCBiZWZvcmUgdGhlIG5vZGUgZGF0YSByZWFjaGVzIHRoZSBXZWJHTCByZW5kZXJlciAtIHRoZSBzYW1lIHNwb3QgdGhlXG4vLyBjb21tdW5pdHkgcGx1Z2luIGdyYXBoLW5lc3RlZC10YWdzIHVzZXMuIE5vZGVzIGFscmVhZHkgY29sb3JlZCBieSBhIGNvbG9yXG4vLyBncm91cCBhcmUgbGVmdCBhbG9uZS5cbmZ1bmN0aW9uIHBhdGNoUmVuZGVyZXIocGx1Z2luLCByZW5kZXJlcikge1xuICBpZiAocmVuZGVyZXIuX190eXBTeXN0ZW1Db2xvclBhdGNoZWQpIHJldHVybjtcbiAgcmVuZGVyZXIuX190eXBTeXN0ZW1Db2xvclBhdGNoZWQgPSB0cnVlO1xuXG4gIGNvbnN0IG9yaWdpbmFsID0gcmVuZGVyZXIuc2V0RGF0YTtcbiAgcmVuZGVyZXIuc2V0RGF0YSA9IGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgZm9yIChjb25zdCBwYXRoIGluIGRhdGEubm9kZXMpIHtcbiAgICAgIGNvbnN0IG5vZGUgPSBkYXRhLm5vZGVzW3BhdGhdO1xuICAgICAgaWYgKG5vZGUuY29sb3IpIGNvbnRpbnVlO1xuXG4gICAgICBpZiAobm9kZS50eXBlID09PSBcInRhZ1wiKSB7XG4gICAgICAgIC8vIE93biB0YWcgY29sb3IgZGlzYWJsZWQgKDIwMjYtMDktMzApOiB0aGUgTWluaW1hbCB0aGVtZSdzIFN0eWxlXG4gICAgICAgIC8vIFNldHRpbmdzIGFscmVhZHkgY292ZXIgaXQgKEdyYXBocyBcdTIxOTIgVGFnIG5vZGUgY29sb3IpLlxuICAgICAgICAvLyBpZiAocGx1Z2luLnNldHRpbmdzLmdyYXBoVGFnQ29sb3JFbmFibGVkICYmIHBsdWdpbi5zZXR0aW5ncy5ncmFwaFRhZ0NvbG9yKSB7XG4gICAgICAgIC8vICAgbm9kZS5jb2xvciA9IHsgYTogMSwgcmdiOiBoZXhUb0ludChwbHVnaW4uc2V0dGluZ3MuZ3JhcGhUYWdDb2xvcikgfTtcbiAgICAgICAgLy8gfVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgZmlsZSA9IHBsdWdpbi5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKHBhdGgpO1xuICAgICAgbGV0IGNvbG9yID0gbnVsbDtcblxuICAgICAgaWYgKGZpbGUgJiYgZmlsZS5leHRlbnNpb24gIT09IFwibWRcIikge1xuICAgICAgICAvLyBPd24gYXR0YWNobWVudCBjb2xvciBkaXNhYmxlZCAoMjAyNi0wOS0zMCksIHNlZSB0YWcgY29sb3IgYWJvdmVcbiAgICAgICAgLy8gKEdyYXBocyBcdTIxOTIgQXR0YWNobWVudCBub2RlIGNvbG9yKS5cbiAgICAgICAgLy8gaWYgKHBsdWdpbi5zZXR0aW5ncy5ncmFwaEF0dGFjaG1lbnRDb2xvckVuYWJsZWQgJiYgcGx1Z2luLnNldHRpbmdzLmdyYXBoQXR0YWNobWVudENvbG9yKSB7XG4gICAgICAgIC8vICAgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuZ3JhcGhBdHRhY2htZW50Q29sb3I7XG4gICAgICAgIC8vIH1cbiAgICAgIH0gZWxzZSBpZiAocGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MuZ3JhcGgpIHtcbiAgICAgICAgY29sb3IgPSBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCBcImdyYXBoXCIpO1xuICAgICAgfVxuXG4gICAgICBpZiAoY29sb3IpIG5vZGUuY29sb3IgPSB7IGE6IDEsIHJnYjogaGV4VG9JbnQoY29sb3IpIH07XG4gICAgfVxuICAgIHJldHVybiBvcmlnaW5hbC5jYWxsKHRoaXMsIGRhdGEpO1xuICB9O1xuXG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiB7XG4gICAgcmVuZGVyZXIuc2V0RGF0YSA9IG9yaWdpbmFsO1xuICAgIGRlbGV0ZSByZW5kZXJlci5fX3R5cFN5c3RlbUNvbG9yUGF0Y2hlZDtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGdldEdyYXBoTGVhdmVzKGFwcCkge1xuICBjb25zdCBsZWF2ZXMgPSBbXTtcbiAgZm9yIChjb25zdCB2aWV3VHlwZSBvZiBHUkFQSF9WSUVXX1RZUEVTKSBsZWF2ZXMucHVzaCguLi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZSh2aWV3VHlwZSkpO1xuICByZXR1cm4gbGVhdmVzO1xufVxuXG5mdW5jdGlvbiByZWdpc3RlckdyYXBoQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBnZXRHcmFwaExlYXZlcyhwbHVnaW4uYXBwKSkge1xuICAgICAgaWYgKGxlYWYudmlldz8ucmVuZGVyZXIpIHBhdGNoUmVuZGVyZXIocGx1Z2luLCBsZWFmLnZpZXcucmVuZGVyZXIpO1xuICAgICAgLy8gVGhlIGdsb2JhbCBncmFwaCBrZWVwcyBpdHMgZW5naW5lIGluIHZpZXcuZGF0YUVuZ2luZSwgdGhlIGxvY2FsIG9uZSBpblxuICAgICAgLy8gdmlldy5lbmdpbmUuXG4gICAgICAobGVhZi52aWV3Py5kYXRhRW5naW5lID8/IGxlYWYudmlldz8uZW5naW5lKT8ucmVuZGVyKCk7XG4gICAgfVxuICB9O1xuXG4gIC8vIFJlZ2lzdGVyZWQgYmVmb3JlIGFueSBwYXRjaFJlbmRlcmVyKCkgY2xlYW51cCwgc28gaXQgcnVucyBhZnRlciB0aGVtIG9uXG4gIC8vIHVubG9hZCAoT2JzaWRpYW4gcnVucyB0aGVzZSBjYWxsYmFja3MgbGFzdC1pbiwgZmlyc3Qtb3V0KTogd2l0aCBzZXREYXRhXG4gIC8vIGJhY2sgdG8gdGhlIG9yaWdpbmFsLCBvbmUgcmVuZGVyKCkgZHJhd3MgdGhlIGdyYXBoIHdpdGhvdXQgVFlQIGNvbG9ycyBhdFxuICAvLyBvbmNlIGluc3RlYWQgb2Ygb24gaXRzIG5leHQgY2hhbmdlLlxuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBnZXRHcmFwaExlYXZlcyhwbHVnaW4uYXBwKSkgKGxlYWYudmlldz8uZGF0YUVuZ2luZSA/PyBsZWFmLnZpZXc/LmVuZ2luZSk/LnJlbmRlcigpO1xuICB9KTtcblxuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4udHlwSW5kZXgub24oXCJjaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KHJlZnJlc2gpO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJHcmFwaENvbG9ycyB9O1xuIiwgImNvbnN0IHsgY29sb3JGb3JGaWxlLCBzZXRJbmxpbmVDb2xvciB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxuY29uc3QgU0VBUkNIX1ZJRVdfVFlQRSA9IFwic2VhcmNoXCI7XG5cbi8vIFNlYXJjaCByZXN1bHQgcm93cyBoYXZlIG5vIGRhdGEtcGF0aCwgYnV0IHRoZSB2aWV3IGtlZXBzIGEgVEZpbGUgLT4gcmVzdWx0XG4vLyBET00gbWFwIChkb20ucmVzdWx0RG9tTG9va3VwKSB0aGF0IGxpbmtzIGZpbGUgYW5kIHJvdyBkaXJlY3RseS5cbmZ1bmN0aW9uIGFwcGx5U2VhcmNoQ29sb3JzKHBsdWdpbikge1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFNFQVJDSF9WSUVXX1RZUEUpKSB7XG4gICAgY29uc3QgcmVzdWx0RG9tTG9va3VwID0gbGVhZi52aWV3Py5kb20/LnJlc3VsdERvbUxvb2t1cDtcbiAgICBpZiAoIXJlc3VsdERvbUxvb2t1cCkgY29udGludWU7XG5cbiAgICBmb3IgKGNvbnN0IFtmaWxlLCByZXN1bHREb21dIG9mIHJlc3VsdERvbUxvb2t1cCkge1xuICAgICAgY29uc3QgdGl0bGVFbCA9IHJlc3VsdERvbS5lbD8ucXVlcnlTZWxlY3RvcihcIi5zZWFyY2gtcmVzdWx0LWZpbGUtdGl0bGUgLnRyZWUtaXRlbS1pbm5lclwiKTtcbiAgICAgIGlmICghdGl0bGVFbCkgY29udGludWU7XG5cbiAgICAgIGNvbnN0IGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Muc2VhcmNoID8gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSwgXCJzZWFyY2hcIikgOiBudWxsO1xuICAgICAgc2V0SW5saW5lQ29sb3IodGl0bGVFbCwgY29sb3IpO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlclNlYXJjaENvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5U2VhcmNoQ29sb3JzKHBsdWdpbik7XG5cbiAgLy8gUmVzdWx0cyBhcmUgcmVidWlsdCBvbiBldmVyeSBrZXlzdHJva2UuXG4gIGNvbnN0IG9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIocmVmcmVzaCk7XG4gIGNvbnN0IG9ic2VydmVMZWF2ZXMgPSAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShTRUFSQ0hfVklFV19UWVBFKSkge1xuICAgICAgb2JzZXJ2ZXIub2JzZXJ2ZShsZWFmLnZpZXcuY29udGFpbmVyRWwsIHsgY2hpbGRMaXN0OiB0cnVlLCBzdWJ0cmVlOiB0cnVlIH0pO1xuICAgIH1cbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IG9ic2VydmVyLmRpc2Nvbm5lY3QoKSk7XG5cbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLnR5cEluZGV4Lm9uKFwiY2hhbmdlXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoXG4gICAgcGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJsYXlvdXQtY2hhbmdlXCIsICgpID0+IHtcbiAgICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICAgIHJlZnJlc2goKTtcbiAgICB9KVxuICApO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICByZWZyZXNoKCk7XG4gIH0pO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJTZWFyY2hDb2xvcnMgfTtcbiIsICJjb25zdCB7IGNvbG9yRm9yRmlsZSwgc2V0SW5saW5lQ29sb3IgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5cbmNvbnN0IFJFQ0VOVF9GSUxFU19WSUVXX1RZUEUgPSBcInJlY2VudC1maWxlc1wiO1xuXG4vLyBSZWNlbnQgRmlsZXMgcm93cyBoYXZlIG5vIGRhdGEtcGF0aCwgYnV0IHRoZSBsaXN0IGlzIHJlbmRlcmVkIHN0cmFpZ2h0IGZyb21cbi8vIGRhdGEucmVjZW50RmlsZXMgd2l0aG91dCBza2lwcGluZyBlbnRyaWVzLCBzbyB0aGUgaW5kZXggbWFwcyByb3cgdG8gcGF0aC5cbmZ1bmN0aW9uIGFwcGx5UmVjZW50RmlsZXNDb2xvcnMocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoUkVDRU5UX0ZJTEVTX1ZJRVdfVFlQRSkpIHtcbiAgICBjb25zdCByZWNlbnRGaWxlcyA9IGxlYWYudmlldz8uZGF0YT8ucmVjZW50RmlsZXM7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHJlY2VudEZpbGVzKSkgY29udGludWU7XG5cbiAgICBjb25zdCB0aXRsZUVscyA9IGxlYWYudmlldy5jb250YWluZXJFbC5xdWVyeVNlbGVjdG9yQWxsKFwiLnJlY2VudC1maWxlcy10aXRsZSAubmF2LWZpbGUtdGl0bGUtY29udGVudFwiKTtcbiAgICB0aXRsZUVscy5mb3JFYWNoKCh0aXRsZUVsLCBpbmRleCkgPT4ge1xuICAgICAgY29uc3QgZW50cnkgPSByZWNlbnRGaWxlc1tpbmRleF07XG4gICAgICBjb25zdCBmaWxlID0gZW50cnkgPyBwbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChlbnRyeS5wYXRoKSA6IG51bGw7XG4gICAgICBjb25zdCBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLnJlY2VudEZpbGVzID8gY29sb3JGb3JGaWxlKHBsdWdpbiwgZmlsZSwgXCJyZWNlbnRGaWxlc1wiKSA6IG51bGw7XG4gICAgICBzZXRJbmxpbmVDb2xvcih0aXRsZUVsLCBjb2xvcik7XG4gICAgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJSZWNlbnRGaWxlc0NvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5UmVjZW50RmlsZXNDb2xvcnMocGx1Z2luKTtcblxuICBjb25zdCBvYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKHJlZnJlc2gpO1xuICBjb25zdCBvYnNlcnZlTGVhdmVzID0gKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoUkVDRU5UX0ZJTEVTX1ZJRVdfVFlQRSkpIHtcbiAgICAgIG9ic2VydmVyLm9ic2VydmUobGVhZi52aWV3LmNvbnRhaW5lckVsLCB7IGNoaWxkTGlzdDogdHJ1ZSwgc3VidHJlZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiBvYnNlcnZlci5kaXNjb25uZWN0KCkpO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KFxuICAgIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgICByZWZyZXNoKCk7XG4gICAgfSlcbiAgKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgcmVmcmVzaCgpO1xuICB9KTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyUmVjZW50RmlsZXNDb2xvcnMgfTtcbiIsICJjb25zdCB7IGNvbG9yRm9yRmlsZSwgc2V0SW5saW5lQ29sb3IgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5cbmNvbnN0IEJBQ0tMSU5LX1ZJRVdfVFlQRSA9IFwiYmFja2xpbmtcIjtcblxuLy8gVGhlIGJhY2tsaW5rcyBwYW5lIHJlbmRlcnMgcmVzdWx0cyB3aXRoIHRoZSBzYW1lIFNlYXJjaFJlc3VsdERvbSBjbGFzcyBhc1xuLy8gc2VhcmNoLiBMaW5rZWQgYW5kIHVubGlua2VkIG1lbnRpb25zIGFyZSB0d28gcmVzdWx0RG9tTG9va3VwIG1hcHMgb24gdGhlXG4vLyByZW5kZXJlciAodmlldy5iYWNrbGluaykuIFRoZSBmaWVsZCBuYW1lcyBhcmUgdW5kb2N1bWVudGVkLCBzbyBzZXZlcmFsXG4vLyBrbm93biBwYXRocyBhcmUgdHJpZWQuXG5mdW5jdGlvbiBnZXRSZXN1bHREb21Mb29rdXBzKHZpZXcpIHtcbiAgY29uc3QgcmVuZGVyZXIgPSB2aWV3Py5iYWNrbGluaztcbiAgY29uc3QgY2FuZGlkYXRlcyA9IFtyZW5kZXJlcj8uYmFja2xpbmtEb20sIHJlbmRlcmVyPy51bmxpbmtlZERvbSwgdmlldz8uYmFja2xpbmtEb20sIHZpZXc/LnVubGlua2VkRG9tLCB2aWV3Py5kb21dO1xuXG4gIGNvbnN0IGxvb2t1cHMgPSBbXTtcbiAgZm9yIChjb25zdCBkb20gb2YgY2FuZGlkYXRlcykge1xuICAgIGlmIChkb20/LnJlc3VsdERvbUxvb2t1cCBpbnN0YW5jZW9mIE1hcCkgbG9va3Vwcy5wdXNoKGRvbS5yZXN1bHREb21Mb29rdXApO1xuICB9XG4gIHJldHVybiBsb29rdXBzO1xufVxuXG5mdW5jdGlvbiBjb2xvclRpdGxlRWwocGx1Z2luLCBlbCwgZmlsZSkge1xuICBjb25zdCBjb2xvciA9IHBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmJhY2tsaW5rcyA/IGNvbG9yRm9yRmlsZShwbHVnaW4sIGZpbGUsIFwiYmFja2xpbmtzXCIpIDogbnVsbDtcbiAgc2V0SW5saW5lQ29sb3IoZWwsIGNvbG9yKTtcbn1cblxuZnVuY3Rpb24gYXBwbHlCYWNrbGlua1BhbmVDb2xvcnMocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoQkFDS0xJTktfVklFV19UWVBFKSkge1xuICAgIGZvciAoY29uc3QgbG9va3VwIG9mIGdldFJlc3VsdERvbUxvb2t1cHMobGVhZi52aWV3KSkge1xuICAgICAgZm9yIChjb25zdCBbZmlsZSwgcmVzdWx0RG9tXSBvZiBsb29rdXApIHtcbiAgICAgICAgY29uc3QgdGl0bGVFbCA9IHJlc3VsdERvbS5lbD8ucXVlcnlTZWxlY3RvcihcIi5zZWFyY2gtcmVzdWx0LWZpbGUtdGl0bGUgLnRyZWUtaXRlbS1pbm5lclwiKTtcbiAgICAgICAgaWYgKHRpdGxlRWwpIGNvbG9yVGl0bGVFbChwbHVnaW4sIHRpdGxlRWwsIGZpbGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG4vLyBCYWNrbGlua3MgaW4gdGhlIGRvY3VtZW50IGFyZSBub3QgYSBsZWFmIG9mIHRoZWlyIG93biBidXQgZW1iZWRkZWQgYXQgdGhlXG4vLyBib3R0b20gb2YgdGhlIG1hcmtkb3duIHZpZXcgKC5lbWJlZGRlZC1iYWNrbGlua3MpLiBSb3dzIGhhdmUgbm8gZGF0YS1wYXRoLFxuLy8gc28gdGhlIGZpbGUgaXMgcmVzb2x2ZWQgZnJvbSB0aGUgc2hvd24gbmFtZSwgdGhlIHdheSBPYnNpZGlhbiByZXNvbHZlcyBsaW5rcy5cbmZ1bmN0aW9uIGFwcGx5RW1iZWRkZWRCYWNrbGlua0NvbG9ycyhwbHVnaW4pIHtcbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpKSB7XG4gICAgY29uc3QgcGFuZUVsID0gbGVhZi52aWV3LmNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3IoXCIuZW1iZWRkZWQtYmFja2xpbmtzIC5iYWNrbGluay1wYW5lXCIpO1xuICAgIGlmICghcGFuZUVsKSBjb250aW51ZTtcblxuICAgIGNvbnN0IHNvdXJjZVBhdGggPSBsZWFmLnZpZXcuZmlsZT8ucGF0aCA/PyBcIlwiO1xuICAgIGNvbnN0IHRpdGxlRWxzID0gcGFuZUVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCIuc2VhcmNoLXJlc3VsdC1maWxlLXRpdGxlIC50cmVlLWl0ZW0taW5uZXJcIik7XG4gICAgZm9yIChjb25zdCB0aXRsZUVsIG9mIHRpdGxlRWxzKSB7XG4gICAgICBjb25zdCBiYXNlbmFtZSA9IHRpdGxlRWwudGV4dENvbnRlbnQ7XG4gICAgICBjb25zdCBmaWxlID0gYmFzZW5hbWUgPyBwbHVnaW4uYXBwLm1ldGFkYXRhQ2FjaGUuZ2V0Rmlyc3RMaW5rcGF0aERlc3QoYmFzZW5hbWUsIHNvdXJjZVBhdGgpIDogbnVsbDtcbiAgICAgIGNvbG9yVGl0bGVFbChwbHVnaW4sIHRpdGxlRWwsIGZpbGUpO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBhcHBseUJhY2tsaW5rQ29sb3JzKHBsdWdpbikge1xuICBhcHBseUJhY2tsaW5rUGFuZUNvbG9ycyhwbHVnaW4pO1xuICBhcHBseUVtYmVkZGVkQmFja2xpbmtDb2xvcnMocGx1Z2luKTtcbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJCYWNrbGlua0NvbG9ycyhwbHVnaW4pIHtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IGFwcGx5QmFja2xpbmtDb2xvcnMocGx1Z2luKTtcblxuICAvLyBPbmx5IHRoZSBzbWFsbCBzaWRlYmFyIHBhbmUgaXMgb2JzZXJ2ZWQsIG5ldmVyIGEgbWFya2Rvd24gdmlldzogYSBzdWJ0cmVlXG4gIC8vIG9ic2VydmVyIG5lYXIgdGhlIGVkaXRvciBmaXJlcyBvbiBldmVyeSBrZXlzdHJva2UgYW5kIG9uY2UgZnJvemUgdGhpc1xuICAvLyB2YXVsdC4gVGhlIGVtYmVkZGVkIGJhY2tsaW5rcyBvbmx5IGNoYW5nZSB3aGVuIGxpbmtzIGNoYW5nZSAoXCJyZXNvbHZlZFwiKVxuICAvLyBvciB0aGUgbm90ZSBjaGFuZ2VzIChsYXlvdXQtY2hhbmdlL2FjdGl2ZS1sZWFmLWNoYW5nZSksIGJvdGggY292ZXJlZCBiZWxvdy5cbiAgY29uc3Qgb2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcihyZWZyZXNoKTtcbiAgY29uc3Qgb2JzZXJ2ZUxlYXZlcyA9ICgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEJBQ0tMSU5LX1ZJRVdfVFlQRSkpIHtcbiAgICAgIG9ic2VydmVyLm9ic2VydmUobGVhZi52aWV3LmNvbnRhaW5lckVsLCB7IGNoaWxkTGlzdDogdHJ1ZSwgc3VidHJlZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiBvYnNlcnZlci5kaXNjb25uZWN0KCkpO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAubWV0YWRhdGFDYWNoZS5vbihcInJlc29sdmVkXCIsICgpID0+IGFwcGx5RW1iZWRkZWRCYWNrbGlua0NvbG9ycyhwbHVnaW4pKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KFxuICAgIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgICByZWZyZXNoKCk7XG4gICAgfSlcbiAgKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJhY3RpdmUtbGVhZi1jaGFuZ2VcIiwgcmVmcmVzaCkpO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgIG9ic2VydmVMZWF2ZXMoKTtcbiAgICByZWZyZXNoKCk7XG4gIH0pO1xuXG4gIHJldHVybiByZWZyZXNoO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJCYWNrbGlua0NvbG9ycyB9O1xuIiwgImNvbnN0IHsgY29sb3JGb3JGaWxlLCBzZXRJbmxpbmVDb2xvciB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxuY29uc3QgQk9PS01BUktTX1ZJRVdfVFlQRSA9IFwiYm9va21hcmtzXCI7XG5jb25zdCBCT09LTUFSS1NfUExVR0lOX0lEID0gXCJib29rbWFya3NcIjtcblxuLy8gQm9va21hcmsgcm93cyBoYXZlIG5vIGRhdGEtcGF0aC4gVGhlIHZpZXcga2VlcHMgYSBXZWFrTWFwICh2aWV3Lml0ZW1Eb21zOlxuLy8gaXRlbSAtPiB0cmVlIGl0ZW0gd2l0aCAudGl0bGVFbCksIHdoaWNoIGNhbid0IGJlIGl0ZXJhdGVkLCBzbyB3ZSB3YWxrIHRoZVxuLy8gcGx1Z2luJ3Mgb3duIGl0ZW0gdHJlZSAoYWx3YXlzIGNvbXBsZXRlLCB3aGF0ZXZlciBpcyBjb2xsYXBzZWQpIGFuZCBsb29rIHVwXG4vLyBlYWNoIGl0ZW0ncyByb3cgd2l0aCAuZ2V0KCkuXG5mdW5jdGlvbiBmb3JFYWNoRmlsZUJvb2ttYXJrKGl0ZW1zLCBjYWxsYmFjaykge1xuICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMgPz8gW10pIHtcbiAgICBpZiAoaXRlbS50eXBlID09PSBcImZpbGVcIikgY2FsbGJhY2soaXRlbSk7XG4gICAgZWxzZSBpZiAoaXRlbS50eXBlID09PSBcImdyb3VwXCIpIGZvckVhY2hGaWxlQm9va21hcmsoaXRlbS5pdGVtcywgY2FsbGJhY2spO1xuICB9XG59XG5cbmZ1bmN0aW9uIGFwcGx5Qm9va21hcmtzQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCBib29rbWFya3NQbHVnaW4gPSBwbHVnaW4uYXBwLmludGVybmFsUGx1Z2lucy5nZXRFbmFibGVkUGx1Z2luQnlJZChCT09LTUFSS1NfUExVR0lOX0lEKTtcbiAgaWYgKCFib29rbWFya3NQbHVnaW4pIHJldHVybjtcblxuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEJPT0tNQVJLU19WSUVXX1RZUEUpKSB7XG4gICAgY29uc3QgaXRlbURvbXMgPSBsZWFmLnZpZXc/Lml0ZW1Eb21zO1xuICAgIGlmICghaXRlbURvbXMpIGNvbnRpbnVlO1xuXG4gICAgZm9yRWFjaEZpbGVCb29rbWFyayhib29rbWFya3NQbHVnaW4uaXRlbXMsIChpdGVtKSA9PiB7XG4gICAgICBjb25zdCB0aXRsZUVsID0gaXRlbURvbXMuZ2V0KGl0ZW0pPy50aXRsZUVsO1xuICAgICAgaWYgKCF0aXRsZUVsKSByZXR1cm47XG5cbiAgICAgIGNvbnN0IGZpbGUgPSBwbHVnaW4uYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChpdGVtLnBhdGgpO1xuICAgICAgY29uc3QgY29sb3IgPSBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5ib29rbWFya3MgPyBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCBcImJvb2ttYXJrc1wiKSA6IG51bGw7XG4gICAgICBzZXRJbmxpbmVDb2xvcih0aXRsZUVsLCBjb2xvcik7XG4gICAgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJCb29rbWFya3NDb2xvcnMocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseUJvb2ttYXJrc0NvbG9ycyhwbHVnaW4pO1xuXG4gIC8vIFJvd3MgYXJlIHJlLXJlbmRlcmVkIHdoZW4gZ3JvdXBzIGV4cGFuZC9jb2xsYXBzZSBvciBib29rbWFya3MgY2hhbmdlLlxuICBjb25zdCBvYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyKHJlZnJlc2gpO1xuICBjb25zdCBvYnNlcnZlTGVhdmVzID0gKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoQk9PS01BUktTX1ZJRVdfVFlQRSkpIHtcbiAgICAgIG9ic2VydmVyLm9ic2VydmUobGVhZi52aWV3LmNvbnRhaW5lckVsLCB7IGNoaWxkTGlzdDogdHJ1ZSwgc3VidHJlZTogdHJ1ZSB9KTtcbiAgICB9XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiBvYnNlcnZlci5kaXNjb25uZWN0KCkpO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KFxuICAgIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgICByZWZyZXNoKCk7XG4gICAgfSlcbiAgKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KCgpID0+IHtcbiAgICBvYnNlcnZlTGVhdmVzKCk7XG4gICAgcmVmcmVzaCgpO1xuICB9KTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyQm9va21hcmtzQ29sb3JzIH07XG4iLCAiY29uc3QgeyBURmlsZSB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBjb2xvckZvckZpbGUsIHN1YnR5cENvbG9yLCBzdWJ0eXBIYXNPd25Db2xvciwgc2V0SW5saW5lQ29sb3IgfSA9IHJlcXVpcmUoXCIuL3R5cC1jb2xvcnNcIik7XG5jb25zdCB7IGdldFN1YnR5cCB9ID0gcmVxdWlyZShcIi4vc3VidHlwc1wiKTtcblxuY29uc3QgRE9UX0NMQVNTID0gXCJ0eXAtdGl0bGUtZG90XCI7XG5jb25zdCBET1RfSE9MTE9XX0NMQVNTID0gXCJ0eXAtdGl0bGUtZG90LWhvbGxvd1wiO1xuLy8gU2FtZSBhcyBERUZBVUxUX1RZUF9DT0xPUiBpbiB0eXAtcGFuZS5qcyAoYSBUWVAgd2l0aG91dCBpdHMgb3duIGNvbG9yKS5cbmNvbnN0IERFRkFVTFRfRE9UX0NPTE9SID0gXCIjODg4ODg4XCI7XG5jb25zdCBCQURHRV9DTEFTUyA9IFwidHlwLXRpdGxlLWJhZGdlXCI7XG5jb25zdCBCQURHRV9QTEFJTl9DTEFTUyA9IFwidHlwLXRpdGxlLWJhZGdlLXBsYWluXCI7XG5jb25zdCBDT0xPUl9WQVIgPSBcIi0tdHlwLXRpdGxlLWNvbG9yXCI7XG5cbmNvbnN0IEJMT0NLX0JBREdFX0NMQVNTID0gXCJ0eXAtYmxvY2stYmFkZ2VcIjtcbmNvbnN0IEJMT0NLX0JBREdFX1BMQUlOX0NMQVNTID0gXCJ0eXAtYmxvY2stYmFkZ2UtcGxhaW5cIjtcbmNvbnN0IEJMT0NLX0FMSUdOX1RPUF9DTEFTUyA9IFwidHlwLWJsb2NrLWJhZGdlLXRvcFwiO1xuY29uc3QgQkxPQ0tfQUxJR05fQk9UVE9NX0NMQVNTID0gXCJ0eXAtYmxvY2stYmFkZ2UtYm90dG9tXCI7XG5jb25zdCBCTE9DS19DT0xPUl9WQVIgPSBcIi0tdHlwLWJsb2NrLWNvbG9yXCI7XG5cbi8vIG5vdGVUaXRsZVN0eWxlOiBcIm5vbmVcIiB8IFwiZG90XCIgfCBcImJhZGdlXCIuIEZvciBcImJhZGdlXCIsIG5vdGVUaXRsZUJhZGdlQ29sb3JlZFxuLy8gYW5kIG5vdGVUaXRsZUJhZGdlUG9zaXRpb24gKFwidGl0bGVcIiB8IFwiYmxvY2tcIiwgcGx1cyBub3RlVGl0bGVWZXJ0aWNhbEFsaWduXG4vLyBmb3IgXCJibG9ja1wiKSByZWZpbmUgaXQuIGNvbG9yVmlld3Mubm90ZVRpdGxlQ29sb3IgKHRoZSB0aXRsZSB0ZXh0IGl0c2VsZikgaXNcbi8vIGluZGVwZW5kZW50IGFuZCBjb21iaW5lcyB3aXRoIGFueSBvZiB0aGVzZS5cbmZ1bmN0aW9uIHJlc29sdmVNYXJrZXIocGx1Z2luLCBmaWxlKSB7XG4gIGNvbnN0IHN0eWxlID0gcGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVN0eWxlO1xuICBpZiAoc3R5bGUgPT09IFwibm9uZVwiKSByZXR1cm4geyBraW5kOiBcIm5vbmVcIiB9O1xuICBpZiAoc3R5bGUgPT09IFwiZG90XCIpIHJldHVybiB7IGtpbmQ6IFwiZG90XCIsIC4uLnJlc29sdmVEb3QocGx1Z2luLCBmaWxlKSB9O1xuXG4gIC8vIFwiYmFkZ2VcIjogY29sb3JlZCwgYSByZWdpc3RlcmVkIFRZUCB3aXRob3V0IGEgY29sb3IgZ2V0cyB0aGUgZ3JheSBkZWZhdWx0XG4gIC8vIChsaWtlIHRoZSByaW5nIGluIHJlc29sdmVEb3QpOyBhbiB1bnJlZ2lzdGVyZWQgVFlQIGdldHMgbm8gY29sb3JlZCBiYWRnZSxcbiAgLy8ganVzdCBhcyBpdCBnZXRzIG5vIGRvdC5cbiAgY29uc3QgeyBzZXR0aW5ncyB9ID0gcGx1Z2luO1xuICBjb25zdCB0eXAgPSBwbHVnaW4udHlwSW5kZXgudHlwT2YoZmlsZSk7XG4gIGlmICghdHlwKSByZXR1cm4geyBraW5kOiBcIm5vbmVcIiB9O1xuICBjb25zdCBjb2xvcmVkID0gc2V0dGluZ3Mubm90ZVRpdGxlQmFkZ2VDb2xvcmVkO1xuICBpZiAoY29sb3JlZCAmJiAhc2V0dGluZ3MudHlwQ29sb3JzW3R5cF0gJiYgIXNldHRpbmdzLnR5cHMuaW5jbHVkZXModHlwKSkgcmV0dXJuIHsga2luZDogXCJub25lXCIgfTtcbiAgY29uc3QgdHlwQ29sb3IgPSBzZXR0aW5ncy50eXBDb2xvcnNbdHlwXSA/PyBERUZBVUxUX0RPVF9DT0xPUjtcblxuICBjb25zdCBsYWJlbCA9IGJhZGdlTGFiZWwocGx1Z2luLCBmaWxlLCB0eXApO1xuICBpZiAoIWxhYmVsKSByZXR1cm4geyBraW5kOiBcIm5vbmVcIiB9O1xuICBjb25zdCB7IHRleHQsIHVzZVN1YnR5cENvbG9yLCBzdWJ0eXAgfSA9IGxhYmVsO1xuICBjb25zdCBjb2xvciA9IGNvbG9yZWQgPyAodXNlU3VidHlwQ29sb3IgPyBzdWJ0eXBDb2xvcihzZXR0aW5ncywgdHlwLCBzdWJ0eXApID8/IHR5cENvbG9yIDogdHlwQ29sb3IpIDogbnVsbDtcbiAgY29uc3QgcG9zaXRpb24gPSBzZXR0aW5ncy5ub3RlVGl0bGVCYWRnZVBvc2l0aW9uO1xuICByZXR1cm4geyBraW5kOiBwb3NpdGlvbiA9PT0gXCJibG9ja1wiID8gXCJibG9jay1iYWRnZVwiIDogXCJ0aXRsZS1iYWRnZVwiLCBjb2xvcmVkLCBjb2xvciwgdHlwTmFtZTogdGV4dCB9O1xufVxuXG4vLyBCYWRnZSBsYWJlbCAobm90ZVRpdGxlQmFkZ2VMYWJlbCkgd2l0aCBpdHMgY29sb3I6IFtUWVBdIGluIHRoZSBUWVAgY29sb3IsXG4vLyBbU3VidHlwXSBpbiB0aGUgU3VidHlwIGNvbG9yIChubyBiYWRnZSB3aXRob3V0IGEgU3VidHlwKSwgW1RZUC9TdWJ0eXBdXG4vLyBkZXBlbmRpbmcgb24gdGhlIFwiU3VidHlwIGNvbG9yXCIgdG9nZ2xlIChjb2xvclZpZXdzLm5vdGVUaXRsZU1hcmtlclN1YnR5cCkuXG4vLyBBbiB1bnJlZ2lzdGVyZWQgU1VCVFlQIHZhbHVlIGlzIHNob3duIGJ1dCBoYXMgbm8gY29sb3Igb2YgaXRzIG93blxuLy8gKHN1YnR5cENvbG9yIHRoZW4gcmV0dXJucyB0aGUgVFlQIGNvbG9yKS5cbmZ1bmN0aW9uIGJhZGdlTGFiZWwocGx1Z2luLCBmaWxlLCB0eXApIHtcbiAgY29uc3QgeyBzZXR0aW5ncyB9ID0gcGx1Z2luO1xuICBjb25zdCBzdWJ0eXAgPSBwbHVnaW4udHlwSW5kZXguc3VidHlwT2YoZmlsZSk7XG4gIGNvbnN0IG1vZGUgPSBzZXR0aW5ncy5ub3RlVGl0bGVCYWRnZUxhYmVsID8/IFwidHlwXCI7XG4gIGlmIChtb2RlID09PSBcInN1YnR5cFwiKSByZXR1cm4gc3VidHlwID8geyB0ZXh0OiBzdWJ0eXAsIHVzZVN1YnR5cENvbG9yOiB0cnVlLCBzdWJ0eXAgfSA6IG51bGw7XG4gIGlmICghc3VidHlwIHx8IG1vZGUgPT09IFwidHlwXCIpIHJldHVybiB7IHRleHQ6IHR5cCwgdXNlU3VidHlwQ29sb3I6IGZhbHNlLCBzdWJ0eXAgfTtcbiAgcmV0dXJuIHsgdGV4dDogYCR7dHlwfS8ke3N1YnR5cH1gLCB1c2VTdWJ0eXBDb2xvcjogISFzZXR0aW5ncy5jb2xvclZpZXdzLm5vdGVUaXRsZU1hcmtlclN1YnR5cCwgc3VidHlwIH07XG59XG5cbi8vIERvdCBhdCB0aGUgdGl0bGUuIExpa2UgdGhlIGRvdHMgaW4gdGhlIFRZUC1QYW5lIChwYWludENvbG9yRG90IGluXG4vLyB0eXAtY29sb3JzLmpzKSwgYSBkZWZhdWx0IGlzIHNob3duIGFzIGEgaG9sbG93IHJpbmc6IGdyYXkgZm9yIGEgcmVnaXN0ZXJlZFxuLy8gVFlQIHdpdGhvdXQgYSBjb2xvciwgdGhlIGluaGVyaXRlZCBUWVAgY29sb3IgZm9yIGEgU3VidHlwIHdpdGhvdXQgaXRzIG93bi5cbi8vIFVucmVnaXN0ZXJlZCBUWVAgdmFsdWVzIGdldCBubyBkb3QsIGFzIGluIHRoZSBUWVAtTGlzdC5cbmZ1bmN0aW9uIHJlc29sdmVEb3QocGx1Z2luLCBmaWxlKSB7XG4gIGNvbnN0IHR5cCA9IHBsdWdpbi50eXBJbmRleC50eXBPZihmaWxlKTtcbiAgaWYgKCF0eXApIHJldHVybiB7IGNvbG9yOiBudWxsLCBob2xsb3c6IGZhbHNlIH07XG4gIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHBsdWdpbjtcbiAgY29uc3QgdHlwQ29sb3IgPSBzZXR0aW5ncy50eXBDb2xvcnNbdHlwXTtcbiAgaWYgKCF0eXBDb2xvcikge1xuICAgIHJldHVybiBzZXR0aW5ncy50eXBzLmluY2x1ZGVzKHR5cCkgPyB7IGNvbG9yOiBERUZBVUxUX0RPVF9DT0xPUiwgaG9sbG93OiB0cnVlIH0gOiB7IGNvbG9yOiBudWxsLCBob2xsb3c6IGZhbHNlIH07XG4gIH1cbiAgY29uc3Qgc3VidHlwID0gcGx1Z2luLnR5cEluZGV4LnN1YnR5cE9mKGZpbGUpO1xuICBpZiAoc2V0dGluZ3MuY29sb3JWaWV3cy5ub3RlVGl0bGVNYXJrZXJTdWJ0eXAgJiYgc3VidHlwICYmIGdldFN1YnR5cChzZXR0aW5ncywgdHlwLCBzdWJ0eXApKSB7XG4gICAgcmV0dXJuIHsgY29sb3I6IHN1YnR5cENvbG9yKHNldHRpbmdzLCB0eXAsIHN1YnR5cCksIGhvbGxvdzogIXN1YnR5cEhhc093bkNvbG9yKHNldHRpbmdzLCB0eXAsIHN1YnR5cCkgfTtcbiAgfVxuICByZXR1cm4geyBjb2xvcjogdHlwQ29sb3IsIGhvbGxvdzogZmFsc2UgfTtcbn1cblxuLy8gVGhlIG5vdGUncyBpbmxpbmUgdGl0bGUuIERvbmUgYXMgOjpiZWZvcmUgKHNlZSBzdHlsZXMuY3NzKSwgbm90IGFzIGFuIGV4dHJhXG4vLyBlbGVtZW50IG9yIHdyYXBwZXI6IHNldmVyYWwgdGhlbWVzIChNaW5pbWFsIGFtb25nIHRoZW0pIHN0eWxlIC5pbmxpbmUtdGl0bGVcbi8vIHdpdGggY2hpbGQgc2VsZWN0b3JzLCB3aGljaCBhbiBleHRyYSBlbGVtZW50IHdvdWxkIGJyZWFrLiBBIDo6YmVmb3JlIGNhbid0XG4vLyBiZSBnaXZlbiBhIGNvbG9yIG9yIHRleHQgZGlyZWN0bHksIGhlbmNlIHRoZSBDU1MgdmFyaWFibGUgYW5kIHRoZSBkYXRhXG4vLyBhdHRyaWJ1dGUgdGhhdCBpdHMgcnVsZXMgcmVhZCAodmFyKCkvYXR0cigpKS5cbmZ1bmN0aW9uIGFwcGx5U3R5bGVUb1RpdGxlKHRpdGxlRWwsIG1hcmtlcikge1xuICBjb25zdCBpc0RvdCA9IG1hcmtlci5raW5kID09PSBcImRvdFwiICYmICEhbWFya2VyLmNvbG9yO1xuICBjb25zdCBpc0JhZGdlID0gbWFya2VyLmtpbmQgPT09IFwidGl0bGUtYmFkZ2VcIjtcblxuICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoRE9UX0NMQVNTLCBpc0RvdCk7XG4gIHRpdGxlRWwuY2xhc3NMaXN0LnRvZ2dsZShET1RfSE9MTE9XX0NMQVNTLCBpc0RvdCAmJiAhIW1hcmtlci5ob2xsb3cpO1xuICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoQkFER0VfQ0xBU1MsIGlzQmFkZ2UgJiYgbWFya2VyLmNvbG9yZWQpO1xuICB0aXRsZUVsLmNsYXNzTGlzdC50b2dnbGUoQkFER0VfUExBSU5fQ0xBU1MsIGlzQmFkZ2UgJiYgIW1hcmtlci5jb2xvcmVkKTtcblxuICBpZiAoaXNCYWRnZSkgdGl0bGVFbC5kYXRhc2V0LnR5cCA9IG1hcmtlci50eXBOYW1lO1xuICBlbHNlIGRlbGV0ZSB0aXRsZUVsLmRhdGFzZXQudHlwO1xuXG4gIGNvbnN0IG1hcmtlckNvbG9yID0gKGlzRG90ICYmIG1hcmtlci5jb2xvcikgfHwgKGlzQmFkZ2UgJiYgbWFya2VyLmNvbG9yZWQgJiYgbWFya2VyLmNvbG9yKSA/IG1hcmtlci5jb2xvciA6IG51bGw7XG4gIGlmIChtYXJrZXJDb2xvcikgdGl0bGVFbC5zdHlsZS5zZXRQcm9wZXJ0eShDT0xPUl9WQVIsIG1hcmtlckNvbG9yKTtcbiAgZWxzZSB0aXRsZUVsLnN0eWxlLnJlbW92ZVByb3BlcnR5KENPTE9SX1ZBUik7XG59XG5cbi8vIFRoZSBub3RlJ3MgcHJvcGVydHkgYmxvY2sgKC5tZXRhZGF0YS1jb250YWluZXIpLCBmb3IgcG9zaXRpb24gXCJibG9ja1wiOiB0aGVcbi8vIHNhbWUgYmFkZ2UsIHR1cm5lZCA5MFx1MDBCMCAod3JpdGluZy1tb2RlIHJhdGhlciB0aGFuIHJvdGF0ZSgpLCBzbyBpdCBncm93cyB3aXRoXG4vLyB0aGUgdGV4dCBpbiB0aGUgcmlnaHQgZGlyZWN0aW9uKSBhbmQgYW5jaG9yZWQgbGVmdCBhdCB0aGUgYmxvY2ssIHRvcCBvclxuLy8gYm90dG9tLiBBcyBhIDo6YmVmb3JlIGl0IGhpZGVzIGFuZCBzaG93cyB3aXRoIHRoZSBibG9jayAoUHJvcGVydHktQmxvY2suY3NzKS5cbmZ1bmN0aW9uIGFwcGx5U3R5bGVUb0Jsb2NrKHBsdWdpbiwgYmxvY2tFbCwgbWFya2VyKSB7XG4gIGNvbnN0IGlzQmxvY2tCYWRnZSA9IG1hcmtlci5raW5kID09PSBcImJsb2NrLWJhZGdlXCI7XG5cbiAgYmxvY2tFbC5jbGFzc0xpc3QudG9nZ2xlKEJMT0NLX0JBREdFX0NMQVNTLCBpc0Jsb2NrQmFkZ2UgJiYgbWFya2VyLmNvbG9yZWQpO1xuICBibG9ja0VsLmNsYXNzTGlzdC50b2dnbGUoQkxPQ0tfQkFER0VfUExBSU5fQ0xBU1MsIGlzQmxvY2tCYWRnZSAmJiAhbWFya2VyLmNvbG9yZWQpO1xuXG4gIGNvbnN0IGFsaWduID0gcGx1Z2luLnNldHRpbmdzLm5vdGVUaXRsZVZlcnRpY2FsQWxpZ247XG4gIGJsb2NrRWwuY2xhc3NMaXN0LnRvZ2dsZShCTE9DS19BTElHTl9UT1BfQ0xBU1MsIGlzQmxvY2tCYWRnZSAmJiBhbGlnbiAhPT0gXCJib3R0b21cIik7XG4gIGJsb2NrRWwuY2xhc3NMaXN0LnRvZ2dsZShCTE9DS19BTElHTl9CT1RUT01fQ0xBU1MsIGlzQmxvY2tCYWRnZSAmJiBhbGlnbiA9PT0gXCJib3R0b21cIik7XG5cbiAgaWYgKGlzQmxvY2tCYWRnZSkgYmxvY2tFbC5kYXRhc2V0LnR5cCA9IG1hcmtlci50eXBOYW1lO1xuICBlbHNlIGRlbGV0ZSBibG9ja0VsLmRhdGFzZXQudHlwO1xuXG4gIGNvbnN0IGJsb2NrQ29sb3IgPSBpc0Jsb2NrQmFkZ2UgJiYgbWFya2VyLmNvbG9yZWQgJiYgbWFya2VyLmNvbG9yID8gbWFya2VyLmNvbG9yIDogbnVsbDtcbiAgaWYgKGJsb2NrQ29sb3IpIGJsb2NrRWwuc3R5bGUuc2V0UHJvcGVydHkoQkxPQ0tfQ09MT1JfVkFSLCBibG9ja0NvbG9yKTtcbiAgZWxzZSBibG9ja0VsLnN0eWxlLnJlbW92ZVByb3BlcnR5KEJMT0NLX0NPTE9SX1ZBUik7XG59XG5cbmZ1bmN0aW9uIGFwcGx5QWN0aXZlVGl0bGVDb2xvcnMocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xuICAgIGNvbnN0IGNvbnRhaW5lckVsID0gbGVhZi52aWV3LmNvbnRhaW5lckVsO1xuICAgIGNvbnN0IGZpbGUgPSBsZWFmLnZpZXcuZmlsZTtcbiAgICBjb25zdCB0eXBlZEZpbGUgPSBmaWxlIGluc3RhbmNlb2YgVEZpbGUgPyBmaWxlIDogbnVsbDtcbiAgICBjb25zdCBtYXJrZXIgPSByZXNvbHZlTWFya2VyKHBsdWdpbiwgdHlwZWRGaWxlKTtcblxuICAgIGNvbnN0IHRpdGxlRWwgPSBjb250YWluZXJFbC5xdWVyeVNlbGVjdG9yKFwiLmlubGluZS10aXRsZVwiKTtcbiAgICBpZiAodGl0bGVFbCkge1xuICAgICAgYXBwbHlTdHlsZVRvVGl0bGUodGl0bGVFbCwgbWFya2VyKTtcblxuICAgICAgY29uc3QgdGV4dENvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3Mubm90ZVRpdGxlQ29sb3IgPyBjb2xvckZvckZpbGUocGx1Z2luLCB0eXBlZEZpbGUsIFwibm90ZVRpdGxlQ29sb3JcIikgOiBudWxsO1xuICAgICAgc2V0SW5saW5lQ29sb3IodGl0bGVFbCwgdGV4dENvbG9yKTtcbiAgICB9XG5cbiAgICBjb25zdCBibG9ja0VsID0gY29udGFpbmVyRWwucXVlcnlTZWxlY3RvcihcIi5tZXRhZGF0YS1jb250YWluZXJcIik7XG4gICAgaWYgKGJsb2NrRWwpIGFwcGx5U3R5bGVUb0Jsb2NrKHBsdWdpbiwgYmxvY2tFbCwgbWFya2VyKTtcbiAgfVxufVxuXG5mdW5jdGlvbiByZWdpc3RlckFjdGl2ZVRpdGxlQ29sb3JzKHBsdWdpbikge1xuICBjb25zdCByZWZyZXNoID0gKCkgPT4gYXBwbHlBY3RpdmVUaXRsZUNvbG9ycyhwbHVnaW4pO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwiZmlsZS1vcGVuXCIsIHJlZnJlc2gpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQocGx1Z2luLmFwcC53b3Jrc3BhY2Uub24oXCJhY3RpdmUtbGVhZi1jaGFuZ2VcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLndvcmtzcGFjZS5vbihcImxheW91dC1jaGFuZ2VcIiwgcmVmcmVzaCkpO1xuXG4gIHBsdWdpbi5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkocmVmcmVzaCk7XG5cbiAgLy8gRG90LCBiYWRnZSBhbmQgdGhlaXIgZGF0YSBhdHRyaWJ1dGUgYW5kIGNvbG9yIHZhcmlhYmxlcyB3b3VsZCBvdGhlcndpc2VcbiAgLy8gc3RheSBvbiBvcGVuIG5vdGVzIGFmdGVyIHRoZSBwbHVnaW4gaXMgZGlzYWJsZWQsIHVudGlsIHRoZSBub3RlIGlzXG4gIC8vIHJlLXJlbmRlcmVkLiBUaGUgdGl0bGUgdGV4dCBjb2xvciBpcyBjbGVhcmVkIHdpdGggdGhlIG90aGVyIGlubGluZSBjb2xvcnNcbiAgLy8gKGNsZWFySW5saW5lQ29sb3JzLCBzZWUgbWFpbi5qcykuXG4gIHBsdWdpbi5yZWdpc3RlcigoKSA9PiB7XG4gICAgY29uc3Qgbm9uZSA9IHsga2luZDogXCJub25lXCIgfTtcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIikpIHtcbiAgICAgIGNvbnN0IGNvbnRhaW5lckVsID0gbGVhZi52aWV3LmNvbnRhaW5lckVsO1xuICAgICAgY29uc3QgdGl0bGVFbCA9IGNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3IoXCIuaW5saW5lLXRpdGxlXCIpO1xuICAgICAgaWYgKHRpdGxlRWwpIGFwcGx5U3R5bGVUb1RpdGxlKHRpdGxlRWwsIG5vbmUpO1xuICAgICAgY29uc3QgYmxvY2tFbCA9IGNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3IoXCIubWV0YWRhdGEtY29udGFpbmVyXCIpO1xuICAgICAgaWYgKGJsb2NrRWwpIGFwcGx5U3R5bGVUb0Jsb2NrKHBsdWdpbiwgYmxvY2tFbCwgbm9uZSk7XG4gICAgfVxuICB9KTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyQWN0aXZlVGl0bGVDb2xvcnMgfTtcbiIsICJjb25zdCB7IGVkaXRvckluZm9GaWVsZCwgZ2V0TGlua3BhdGggfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgVmlld1BsdWdpbiwgRGVjb3JhdGlvbiB9ID0gcmVxdWlyZShcIkBjb2RlbWlycm9yL3ZpZXdcIik7XG5jb25zdCB7IFByZWMsIFJhbmdlU2V0QnVpbGRlciwgU3RhdGVFZmZlY3QgfSA9IHJlcXVpcmUoXCJAY29kZW1pcnJvci9zdGF0ZVwiKTtcbmNvbnN0IHsgc3ludGF4VHJlZSB9ID0gcmVxdWlyZShcIkBjb2RlbWlycm9yL2xhbmd1YWdlXCIpO1xuY29uc3QgeyBjb2xvckZvckZpbGUsIGFsbERvY3VtZW50cyB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcblxuLy8gQ29sb3JzIGxpbmtzIGluIG5vdGUgdGV4dCBieSB0aGUgVFlQIG9mIHRoZWlyIHRhcmdldC4gT2JzaWRpYW4gY29sb3JzXG4vLyBpbnRlcm5hbCBsaW5rcyB0aHJvdWdoIHZhcigtLWxpbmstY29sb3IpLCBzbyBvbmx5IHRoYXQgdmFyaWFibGUgaXMgc2V0IHBlclxuLy8gbGluay4gLS1saW5rLWNvbG9yLWhvdmVyIHN0YXlzIHVudG91Y2hlZCAoaG92ZXIgc2hvd3MgdGhlIG5vcm1hbCBsaW5rIGNvbG9yKSxcbi8vIGFuZCB1bmRlcmxpbmUgYW5kIHRoZW1lIHR3ZWFrcyBrZWVwIHdvcmtpbmcuXG4vL1xuLy8gVHdvIHNlcGFyYXRlIHBhdGhzLCBiZWNhdXNlIHRoZSB0d28gcmVuZGVyaW5ncyBoYXZlIG5vdGhpbmcgaW4gY29tbW9uOlxuLy8gIC0gUmVhZGluZyB2aWV3LCBob3ZlciBwcmV2aWV3IGFuZCByZW5kZXJlZCBibG9ja3MgaW4gTGl2ZSBQcmV2aWV3ICh0YWJsZXMsXG4vLyAgICBjYWxsb3V0cyk6IHJlYWwgPGEgY2xhc3M9XCJpbnRlcm5hbC1saW5rXCIgZGF0YS1ocmVmPiBlbGVtZW50cyAtPlxuLy8gICAgbWFya2Rvd24gcG9zdC1wcm9jZXNzb3IsIG9uY2UgcGVyIGxpbmsgd2hlbiByZW5kZXJlZC5cbi8vICAtIExpdmUgUHJldmlldy9zb3VyY2UgbW9kZTogb25seSBDb2RlTWlycm9yIHNwYW5zIG92ZXIgdGhlIHJhdyB0ZXh0IC0+XG4vLyAgICBhIFZpZXdQbHVnaW4gdGhhdCBsb29rcyBhdCB0aGUgdmlzaWJsZSByYW5nZSBvbmx5LlxuLy9cbi8vIFJlY29sb3Jpbmcgb3RoZXJ3aXNlIG9ubHkgaGFwcGVucyBvbiBhIHJlYWwgVFlQIGNoYW5nZSAodHlwSW5kZXggXCJjaGFuZ2VcIilcbi8vIG9yIGEgc2V0dGluZ3MgY2hhbmdlLCBub3Qgb24gZXZlcnkgc2F2ZS5cblxuY29uc3QgQ09MT1JfVkFSID0gXCItLWxpbmstY29sb3JcIjtcbmNvbnN0IFNPVVJDRV9BVFRSID0gXCJkYXRhLXR5cC1zcmNcIjtcblxuLy8gW1t0YXJnZXRdXSwgW1t0YXJnZXR8YWxpYXNdXSwgW1t0YXJnZXQjaGVhZGluZ11dLiBFbWJlZHMgKCFbW1x1MjAyNl1dKSBhcmUgbm90XG4vLyBsaW5rcy4gSW5zaWRlIHRhYmxlcyB0aGUgYWxpYXMgcGlwZSBpcyBlc2NhcGVkIChcIlxcfFwiKS5cbmNvbnN0IFdJS0lMSU5LX1BBVFRFUk4gPSAvKD88ISEpXFxbXFxbKFteW1xcXV0rPylcXF1cXF0vZztcblxuZnVuY3Rpb24gY29sb3JGb3JMaW5rdGV4dChwbHVnaW4sIGxpbmt0ZXh0LCBzb3VyY2VQYXRoKSB7XG4gIGNvbnN0IHRhcmdldCA9IGxpbmt0ZXh0LnNwbGl0KC9cXFxcP1xcfC8pWzBdLnRyaW0oKTtcbiAgY29uc3QgbGlua3BhdGggPSBnZXRMaW5rcGF0aCh0YXJnZXQpO1xuICBpZiAoIWxpbmtwYXRoKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgZmlsZSA9IHBsdWdpbi5hcHAubWV0YWRhdGFDYWNoZS5nZXRGaXJzdExpbmtwYXRoRGVzdChsaW5rcGF0aCwgc291cmNlUGF0aCk7XG4gIHJldHVybiBjb2xvckZvckZpbGUocGx1Z2luLCBmaWxlLCBcImxpbmtzXCIpO1xufVxuXG4vLyAtLS0gUmVhZGluZyB2aWV3IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZnVuY3Rpb24gYXBwbHlUb0FuY2hvcihwbHVnaW4sIGFuY2hvckVsKSB7XG4gIGNvbnN0IGhyZWYgPSBhbmNob3JFbC5nZXRBdHRyaWJ1dGUoXCJkYXRhLWhyZWZcIik7XG4gIGNvbnN0IGNvbG9yID1cbiAgICBwbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy5saW5rcyAmJiBocmVmICYmICFhbmNob3JFbC5jbGFzc0xpc3QuY29udGFpbnMoXCJpcy11bnJlc29sdmVkXCIpXG4gICAgICA/IGNvbG9yRm9yTGlua3RleHQocGx1Z2luLCBocmVmLCBhbmNob3JFbC5nZXRBdHRyaWJ1dGUoU09VUkNFX0FUVFIpID8/IFwiXCIpXG4gICAgICA6IG51bGw7XG4gIGlmIChjb2xvcikgYW5jaG9yRWwuc3R5bGUuc2V0UHJvcGVydHkoQ09MT1JfVkFSLCBjb2xvcik7XG4gIGVsc2UgYW5jaG9yRWwuc3R5bGUucmVtb3ZlUHJvcGVydHkoQ09MT1JfVkFSKTtcbn1cblxuLy8gUmVjb2xvcnMgbGlua3MgdGhhdCBhcmUgYWxyZWFkeSByZW5kZXJlZC4gVGhlIHBvc3QtcHJvY2Vzc29yIHN0b3JlcyBlYWNoXG4vLyBsaW5rJ3Mgc291cmNlIG5vdGUgb24gaXQsIHdoaWNoIGFtYmlndW91cyBsaW5rIHRleHQgbmVlZHMgdG8gcmVzb2x2ZS5cbi8vIENvdmVycyBhbGwgd2luZG93cyAocG9wLW91dHMgaW5jbHVkZWQpLlxuZnVuY3Rpb24gcmVmcmVzaFJlbmRlcmVkTGlua3MocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgZG9jIG9mIGFsbERvY3VtZW50cyhwbHVnaW4uYXBwKSkge1xuICAgIGZvciAoY29uc3QgYW5jaG9yRWwgb2YgZG9jLnF1ZXJ5U2VsZWN0b3JBbGwoYGEuaW50ZXJuYWwtbGlua1ske1NPVVJDRV9BVFRSfV1gKSkgYXBwbHlUb0FuY2hvcihwbHVnaW4sIGFuY2hvckVsKTtcbiAgfVxufVxuXG4vLyAtLS0gTGl2ZSBQcmV2aWV3IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuY29uc3QgcmVmcmVzaEVmZmVjdCA9IFN0YXRlRWZmZWN0LmRlZmluZSgpO1xuXG5mdW5jdGlvbiBidWlsZExpbmtWaWV3UGx1Z2luKHBsdWdpbikge1xuICBjb25zdCBkZWNvcmF0aW9uc0J5Q29sb3IgPSBuZXcgTWFwKCk7XG4gIGNvbnN0IGRlY29yYXRpb25Gb3IgPSAoY29sb3IpID0+IHtcbiAgICBsZXQgZGVjb3JhdGlvbiA9IGRlY29yYXRpb25zQnlDb2xvci5nZXQoY29sb3IpO1xuICAgIGlmICghZGVjb3JhdGlvbikge1xuICAgICAgZGVjb3JhdGlvbiA9IERlY29yYXRpb24ubWFyayh7XG4gICAgICAgIGNsYXNzOiBcInR5cC1saW5rXCIsXG4gICAgICAgIGF0dHJpYnV0ZXM6IHsgc3R5bGU6IGAke0NPTE9SX1ZBUn06ICR7Y29sb3J9O2AgfSxcbiAgICAgIH0pO1xuICAgICAgZGVjb3JhdGlvbnNCeUNvbG9yLnNldChjb2xvciwgZGVjb3JhdGlvbik7XG4gICAgfVxuICAgIHJldHVybiBkZWNvcmF0aW9uO1xuICB9O1xuXG4gIGNvbnN0IGJ1aWxkID0gKHZpZXcpID0+IHtcbiAgICBpZiAoIXBsdWdpbi5zZXR0aW5ncy5jb2xvclZpZXdzLmxpbmtzKSByZXR1cm4gRGVjb3JhdGlvbi5ub25lO1xuICAgIGNvbnN0IHNvdXJjZVBhdGggPSB2aWV3LnN0YXRlLmZpZWxkKGVkaXRvckluZm9GaWVsZCwgZmFsc2UpPy5maWxlPy5wYXRoID8/IFwiXCI7XG4gICAgY29uc3QgdHJlZSA9IHN5bnRheFRyZWUodmlldy5zdGF0ZSk7XG4gICAgY29uc3QgYnVpbGRlciA9IG5ldyBSYW5nZVNldEJ1aWxkZXIoKTtcblxuICAgIGZvciAoY29uc3QgeyBmcm9tLCB0byB9IG9mIHZpZXcudmlzaWJsZVJhbmdlcykge1xuICAgICAgY29uc3QgdGV4dCA9IHZpZXcuc3RhdGUuc2xpY2VEb2MoZnJvbSwgdG8pO1xuICAgICAgV0lLSUxJTktfUEFUVEVSTi5sYXN0SW5kZXggPSAwO1xuICAgICAgZm9yIChsZXQgbWF0Y2g7IChtYXRjaCA9IFdJS0lMSU5LX1BBVFRFUk4uZXhlYyh0ZXh0KSk7ICkge1xuICAgICAgICBjb25zdCBzdGFydCA9IGZyb20gKyBtYXRjaC5pbmRleDtcbiAgICAgICAgLy8gT25seSB3aGF0IE9ic2lkaWFuJ3MgcGFyc2VyIHRyZWF0cyBhcyBhbiBpbnRlcm5hbCBsaW5rLCB3aGljaCBydWxlc1xuICAgICAgICAvLyBvdXQgW1tcdTIwMjZdXSBpbiBjb2RlIGJsb2NrcyBhbmQgaW5saW5lIGNvZGUuXG4gICAgICAgIGlmICghdHJlZS5yZXNvbHZlSW5uZXIoc3RhcnQgKyAyLCAxKS5uYW1lLmluY2x1ZGVzKFwiaG1kLWludGVybmFsLWxpbmtcIikpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBjb2xvciA9IGNvbG9yRm9yTGlua3RleHQocGx1Z2luLCBtYXRjaFsxXSwgc291cmNlUGF0aCk7XG4gICAgICAgIGlmIChjb2xvcikgYnVpbGRlci5hZGQoc3RhcnQsIHN0YXJ0ICsgbWF0Y2hbMF0ubGVuZ3RoLCBkZWNvcmF0aW9uRm9yKGNvbG9yKSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBidWlsZGVyLmZpbmlzaCgpO1xuICB9O1xuXG4gIHJldHVybiBWaWV3UGx1Z2luLmZyb21DbGFzcyhcbiAgICBjbGFzcyB7XG4gICAgICBjb25zdHJ1Y3Rvcih2aWV3KSB7XG4gICAgICAgIHRoaXMuZGVjb3JhdGlvbnMgPSBidWlsZCh2aWV3KTtcbiAgICAgIH1cblxuICAgICAgLy8gVGhlIHBhcnNlciBtYXkgd29yayB0aHJvdWdoIHRoZSB2aXNpYmxlIHJhbmdlIGJpdCBieSBiaXQsIHNvIGEgbmV3XG4gICAgICAvLyBzeW50YXggdHJlZSBhbHNvIHRyaWdnZXJzIGEgcmVidWlsZC5cbiAgICAgIHVwZGF0ZSh1cGRhdGUpIHtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIHVwZGF0ZS5kb2NDaGFuZ2VkIHx8XG4gICAgICAgICAgdXBkYXRlLnZpZXdwb3J0Q2hhbmdlZCB8fFxuICAgICAgICAgIHN5bnRheFRyZWUodXBkYXRlLnN0YXJ0U3RhdGUpICE9PSBzeW50YXhUcmVlKHVwZGF0ZS5zdGF0ZSkgfHxcbiAgICAgICAgICB1cGRhdGUudHJhbnNhY3Rpb25zLnNvbWUoKHRyKSA9PiB0ci5lZmZlY3RzLnNvbWUoKGVmZmVjdCkgPT4gZWZmZWN0LmlzKHJlZnJlc2hFZmZlY3QpKSlcbiAgICAgICAgKSB7XG4gICAgICAgICAgdGhpcy5kZWNvcmF0aW9ucyA9IGJ1aWxkKHVwZGF0ZS52aWV3KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0sXG4gICAgeyBkZWNvcmF0aW9uczogKHZhbHVlKSA9PiB2YWx1ZS5kZWNvcmF0aW9ucyB9XG4gICk7XG59XG5cbi8vIFJldHVybnMgc2NoZWR1bGUoKTogYXNrcyBldmVyeSBlZGl0b3IgdG8gcmVidWlsZCBpdHMgbGluayBkZWNvcmF0aW9ucywgYXRcbi8vIG1vc3Qgb25jZSBwZXIgYW5pbWF0aW9uIGZyYW1lLlxuLy9cbi8vIE5ldmVyIGRpc3BhdGNoZWQgc3luY2hyb25vdXNseTogYSByZWZyZXNoIGNhbiBhcnJpdmUgd2hpbGUgYW4gZWRpdG9yIGlzIGluXG4vLyB0aGUgbWlkZGxlIG9mIGl0cyBvd24gdXBkYXRlIChDb2RlTWlycm9yIHRoZW4gdGhyb3dzIFwiQ2FsbHMgdG9cbi8vIEVkaXRvclZpZXcudXBkYXRlIGFyZSBub3QgYWxsb3dlZCB3aGlsZSBhbiB1cGRhdGUgaXMgaW4gcHJvZ3Jlc3NcIiksIGZvclxuLy8gaW5zdGFuY2Ugd2hlbiBzb21ldGhpbmcgYW4gdXBkYXRlIHNldHMgb2ZmIGVuZHMgaW4gcmVmcmVzaFR5cENvbG9ycygpLiBUaGVcbi8vIGZyYW1lIGFsc28gYnVuZGxlcyBidXJzdHMgb2YgcmVmcmVzaGVzIC0gZHJhZ2dpbmcgYSBjb2xvciBzbGlkZXIgc2VuZHMgb25lXG4vLyBwZXIgaW5wdXQgZXZlbnQuIEFuIGVkaXRvciBzdGlsbCBidXN5IHdoZW4gdGhlIGZyYW1lIGNvbWVzICh1cGRhdGVTdGF0ZSBpc1xuLy8gQ29kZU1pcnJvcidzIGludGVybmFsIGZsYWcsIDAgPSBpZGxlOyBpdCBpcyBhbHNvIG5vbi16ZXJvIHdoaWxlIG1lYXN1cmluZylcbi8vIGlzIHJldHJpZWQgYSBmcmFtZSBsYXRlci5cbmZ1bmN0aW9uIGNyZWF0ZUVkaXRvclJlZnJlc2hlcihwbHVnaW4pIHtcbiAgbGV0IGZyYW1lID0gbnVsbDtcbiAgY29uc3QgcnVuID0gKCkgPT4ge1xuICAgIGZyYW1lID0gbnVsbDtcbiAgICBsZXQgYnVzeSA9IGZhbHNlO1xuICAgIHBsdWdpbi5hcHAud29ya3NwYWNlLml0ZXJhdGVBbGxMZWF2ZXMoKGxlYWYpID0+IHtcbiAgICAgIGNvbnN0IGNtID0gbGVhZi52aWV3Py5lZGl0b3I/LmNtO1xuICAgICAgaWYgKCFjbSkgcmV0dXJuO1xuICAgICAgaWYgKGNtLnVwZGF0ZVN0YXRlICE9PSAwKSB7XG4gICAgICAgIGJ1c3kgPSB0cnVlO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICB0cnkge1xuICAgICAgICBjbS5kaXNwYXRjaCh7IGVmZmVjdHM6IHJlZnJlc2hFZmZlY3Qub2YobnVsbCkgfSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAvLyBPbmUgZWRpdG9yIGZhaWxpbmcgbXVzdCBub3Qga2VlcCB0aGUgb3RoZXJzIGZyb20gcmVmcmVzaGluZy5cbiAgICAgICAgY29uc29sZS5lcnJvcihcIltUWVAgbGluayBjb2xvcnNdXCIsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBpZiAoYnVzeSkgc2NoZWR1bGUoKTtcbiAgfTtcbiAgY29uc3Qgc2NoZWR1bGUgPSAoKSA9PiB7XG4gICAgaWYgKGZyYW1lID09PSBudWxsKSBmcmFtZSA9IHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUocnVuKTtcbiAgfTtcbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IHtcbiAgICBpZiAoZnJhbWUgIT09IG51bGwpIHdpbmRvdy5jYW5jZWxBbmltYXRpb25GcmFtZShmcmFtZSk7XG4gICAgZnJhbWUgPSBudWxsO1xuICB9KTtcbiAgcmV0dXJuIHNjaGVkdWxlO1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZnVuY3Rpb24gcmVnaXN0ZXJMaW5rQ29sb3JzKHBsdWdpbikge1xuICBwbHVnaW4ucmVnaXN0ZXJNYXJrZG93blBvc3RQcm9jZXNzb3IoKGVsLCBjdHgpID0+IHtcbiAgICAvLyBTdG9yZSB0aGUgc291cmNlIGV2ZW4gd2hpbGUgY29sb3JpbmcgaXMgb2ZmLCBzbyB0dXJuaW5nIGl0IG9uIGxhdGVyXG4gICAgLy8gYWxzbyBjb3ZlcnMgbGlua3MgdGhhdCBhcmUgYWxyZWFkeSByZW5kZXJlZC5cbiAgICBmb3IgKGNvbnN0IGFuY2hvckVsIG9mIGVsLnF1ZXJ5U2VsZWN0b3JBbGwoXCJhLmludGVybmFsLWxpbmtcIikpIHtcbiAgICAgIGFuY2hvckVsLnNldEF0dHJpYnV0ZShTT1VSQ0VfQVRUUiwgY3R4LnNvdXJjZVBhdGgpO1xuICAgICAgYXBwbHlUb0FuY2hvcihwbHVnaW4sIGFuY2hvckVsKTtcbiAgICB9XG4gIH0pO1xuICAvLyBPYnNpZGlhbidzIFwiLmNtLWhtZC1pbnRlcm5hbC1saW5rXCIgc3BhbiBhbHdheXMgZW5kcyB1cCBvdXRzaWRlIG91ciBtYXJrLFxuICAvLyB3aGF0ZXZlciB0aGUgcHJpb3JpdHksIHNvIGEgcnVsZSBpbiBzdHlsZXMuY3NzICgudHlwLWxpbmspIHNldHMgdGhlIGNvbG9yLlxuICAvLyBMb3dlc3QgcHJpb3JpdHkgYXQgbGVhc3Qgd3JhcHMgXCIuY20tdW5kZXJsaW5lXCIsIGNvdmVyaW5nIHRoZSB3aG9sZSB0ZXh0LlxuICBwbHVnaW4ucmVnaXN0ZXJFZGl0b3JFeHRlbnNpb24oUHJlYy5sb3dlc3QoYnVpbGRMaW5rVmlld1BsdWdpbihwbHVnaW4pKSk7XG5cbiAgY29uc3QgcmVmcmVzaEVkaXRvcnMgPSBjcmVhdGVFZGl0b3JSZWZyZXNoZXIocGx1Z2luKTtcbiAgY29uc3QgcmVmcmVzaCA9ICgpID0+IHtcbiAgICByZWZyZXNoUmVuZGVyZWRMaW5rcyhwbHVnaW4pO1xuICAgIHJlZnJlc2hFZGl0b3JzKCk7XG4gIH07XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi50eXBJbmRleC5vbihcImNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIC8vIEVkaXRvciBkZWNvcmF0aW9ucyBnbyBhd2F5IHdpdGggdGhlIGV4dGVuc2lvbiBvbiB1bmxvYWQsIHRoZSBpbmxpbmVcbiAgLy8gdmFyaWFibGVzIG9uIHJlbmRlcmVkIGxpbmtzIGRvbid0LlxuICBwbHVnaW4ucmVnaXN0ZXIoKCkgPT4ge1xuICAgIHBsdWdpbi5hcHAud29ya3NwYWNlLml0ZXJhdGVBbGxMZWF2ZXMoKGxlYWYpID0+IHtcbiAgICAgIGZvciAoY29uc3QgYW5jaG9yRWwgb2YgbGVhZi52aWV3LmNvbnRhaW5lckVsLnF1ZXJ5U2VsZWN0b3JBbGwoYGEuaW50ZXJuYWwtbGlua1ske1NPVVJDRV9BVFRSfV1gKSkge1xuICAgICAgICBhbmNob3JFbC5zdHlsZS5yZW1vdmVQcm9wZXJ0eShDT0xPUl9WQVIpO1xuICAgICAgfVxuICAgIH0pO1xuICB9KTtcbiAgcmV0dXJuIHJlZnJlc2g7XG59XG5cbm1vZHVsZS5leHBvcnRzID0geyByZWdpc3RlckxpbmtDb2xvcnMgfTtcbiIsICJjb25zdCB7IGdldFN1YnR5cE5hbWVzLCBnZXRTdWJ0eXAgfSA9IHJlcXVpcmUoXCIuL3N1YnR5cHNcIik7XG5jb25zdCB7IHN1YnR5cENvbG9yLCBzZXRJbmxpbmVDb2xvciwgYWxsRG9jdW1lbnRzIH0gPSByZXF1aXJlKFwiLi90eXAtY29sb3JzXCIpO1xuY29uc3QgeyBWSUVXX1RZUEVfVFlQX1BBTkUgfSA9IHJlcXVpcmUoXCIuL3R5cC1wYW5lXCIpO1xuXG5jb25zdCBBTExfUFJPUEVSVElFU19WSUVXX1RZUEUgPSBcImFsbC1wcm9wZXJ0aWVzXCI7XG5jb25zdCBISUdITElHSFRfQ0xBU1MgPSBcInR5cC1kZWZhdWx0LXByb3BlcnR5XCI7XG4vLyBGbG9hdGluZyBwcm9wZXJ0aWVzIGFyZSBtYXJrZWQgaXRhbGljIGluc3RlYWQgb2YgYm9sZC5cbmNvbnN0IEZMT0FUSU5HX0NMQVNTID0gXCJ0eXAtZmxvYXRpbmctcHJvcGVydHlcIjtcblxuLy8gT2JzaWRpYW4gYWx3YXlzIGxvd2VyY2FzZXMgZGF0YS1wcm9wZXJ0eS1rZXksIHNvIGNvbXBhcmlzb25zIGlnbm9yZSBjYXNlLlxuZnVuY3Rpb24gcmF3S2V5c0ZvclR5cCh0eXAsIGRlZmF1bHRzKSB7XG4gIGlmICghdHlwIHx8ICFkZWZhdWx0cykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyhkZWZhdWx0cykuZmlsdGVyKChrZXkpID0+IGtleSAhPT0gXCJcIik7XG4gIHJldHVybiBrZXlzLmxlbmd0aCA+IDAgPyBrZXlzLm1hcCgoa2V5KSA9PiBrZXkudG9Mb3dlckNhc2UoKSkgOiBudWxsO1xufVxuXG4vLyBBIFRZUCdzIGZyb250bWF0dGVyIGJsb2NrcyBhcyBbeyBzZWN0aW9uLCBrZXlzLCBmbG9hdGluZyB9XSAobG93ZXJjYXNlKTpcbi8vIHRoZSBUWVAtRnJvbnRtYXR0ZXIgZmlyc3QsIHRoZW4gb3B0aW9uYWxseSBvbmUgU3VidHlwJ3MgYmxvY2sgb3IsIHdpdGhcbi8vIEFMTF9TVUJUWVBTLCBldmVyeSBTdWJ0eXAncyBibG9jayAoc2VlIHN1YnR5cHMuanMpLlxuY29uc3QgQUxMX1NVQlRZUFMgPSBTeW1ib2woXCJhbGwtc3VidHlwc1wiKTtcblxuZnVuY3Rpb24gYmxvY2tPZihkZWZhdWx0cywgZmxvYXRpbmdLZXlzLCBzZWN0aW9uID0gbnVsbCkge1xuICBjb25zdCBrZXlzID0gcmF3S2V5c0ZvclR5cCh0cnVlLCBkZWZhdWx0cykgPz8gW107XG4gIHJldHVybiB7IHNlY3Rpb24sIGtleXMsIGZsb2F0aW5nOiBuZXcgU2V0KChmbG9hdGluZ0tleXMgPz8gW10pLm1hcCgoa2V5KSA9PiBrZXkudG9Mb3dlckNhc2UoKSkpIH07XG59XG5cbmZ1bmN0aW9uIGJsb2Nrc0ZvclR5cChwbHVnaW4sIHR5cCwgc3VidHlwKSB7XG4gIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHBsdWdpbjtcbiAgY29uc3QgYmxvY2tzID0gW2Jsb2NrT2Yoc2V0dGluZ3MudHlwRGVmYXVsdEZyb250bWF0dGVyW3R5cF0sIHNldHRpbmdzLnR5cEZsb2F0aW5nS2V5c1t0eXBdLCBudWxsKV07XG4gIGNvbnN0IHN1YnR5cE5hbWVzID0gc3VidHlwID09PSBBTExfU1VCVFlQUyA/IGdldFN1YnR5cE5hbWVzKHNldHRpbmdzLCB0eXApIDogc3VidHlwID8gW3N1YnR5cF0gOiBbXTtcbiAgZm9yIChjb25zdCBuYW1lIG9mIHN1YnR5cE5hbWVzKSB7XG4gICAgY29uc3QgZGF0YSA9IGdldFN1YnR5cChzZXR0aW5ncywgdHlwLCBuYW1lKTtcbiAgICBpZiAoZGF0YSkgYmxvY2tzLnB1c2goYmxvY2tPZihkYXRhLmZyb250bWF0dGVyLCBkYXRhLmZsb2F0aW5nS2V5cywgbmFtZSkpO1xuICB9XG4gIHJldHVybiBibG9ja3M7XG59XG5cbi8vIFNlcGFyYXRlIHNldHMgb2YgbmFtZXMgdG8gYm9sZCAoXCJzdGFuZGFyZFwiKSBhbmQgdG8gaXRhbGljaXplIChcImZsb2F0aW5nXCIpLlxuLy8gQSBmbG9hdGluZyBrZXkgbmV2ZXIgYWxzbyBjb3VudHMgYXMgc3RhbmRhcmQuIElmIGEga2V5IGlzIGluIHNldmVyYWwgYmxvY2tzLFxuLy8gdGhlIGxhdGVyIGJsb2NrIGRlY2lkZXMgLSBmb3IgYSBub3RlIHRoYXQgaXMgaXRzIFN1YnR5cCBibG9jaywgdGhlIHNhbWUgcnVsZVxuLy8gYXMgZm9yIHRoZSB2YWx1ZSBpbiBnZXRUeXBEZWZhdWx0cyAobWFpbi5qcykuXG5mdW5jdGlvbiBzcGxpdEtleXMoYmxvY2tzKSB7XG4gIGNvbnN0IGlzRmxvYXRpbmcgPSBuZXcgTWFwKCk7XG4gIGZvciAoY29uc3QgeyBrZXlzLCBmbG9hdGluZyB9IG9mIGJsb2Nrcykge1xuICAgIGZvciAoY29uc3Qga2V5IG9mIGtleXMpIGlzRmxvYXRpbmcuc2V0KGtleSwgZmxvYXRpbmcuaGFzKGtleSkpO1xuICB9XG4gIGNvbnN0IHN0YW5kYXJkID0gbmV3IFNldCgpO1xuICBjb25zdCBmbG9hdGluZyA9IG5ldyBTZXQoKTtcbiAgZm9yIChjb25zdCBba2V5LCBmbGFnXSBvZiBpc0Zsb2F0aW5nKSAoZmxhZyA/IGZsb2F0aW5nIDogc3RhbmRhcmQpLmFkZChrZXkpO1xuICByZXR1cm4geyBzdGFuZGFyZDogc3RhbmRhcmQuc2l6ZSA+IDAgPyBzdGFuZGFyZCA6IG51bGwsIGZsb2F0aW5nOiBmbG9hdGluZy5zaXplID4gMCA/IGZsb2F0aW5nIDogbnVsbCB9O1xufVxuXG5jb25zdCBOT19LRVlTID0geyBzdGFuZGFyZDogbnVsbCwgZmxvYXRpbmc6IG51bGwgfTtcblxuZnVuY3Rpb24ga2V5c0ZvckZpbGUocGx1Z2luLCBmaWxlKSB7XG4gIGNvbnN0IHsgY29sb3JWaWV3cyB9ID0gcGx1Z2luLnNldHRpbmdzO1xuICBpZiAoIWNvbG9yVmlld3MuZnJvbnRtYXR0ZXJEZWZhdWx0cykgcmV0dXJuIE5PX0tFWVM7XG4gIGNvbnN0IHR5cCA9IHBsdWdpbi50eXBJbmRleC50eXBPZihmaWxlKTtcbiAgaWYgKCF0eXApIHJldHVybiBOT19LRVlTO1xuICBjb25zdCBzdWJ0eXAgPSBjb2xvclZpZXdzLmZyb250bWF0dGVyRGVmYXVsdHNTdWJ0eXAgPyBwbHVnaW4udHlwSW5kZXguc3VidHlwT2YoZmlsZSkgOiBudWxsO1xuICByZXR1cm4gc3BsaXRLZXlzKGJsb2Nrc0ZvclR5cChwbHVnaW4sIHR5cCwgc3VidHlwKSk7XG59XG5cbi8vIFRZUC1QYW5lIGRldGFpbCBlZGl0b3JzOiBvbmUgZWRpdG9yIHBlciBibG9jayAoc2VlIHR5cFN0b3JlL3N1YnR5cFN0b3JlIGluXG4vLyB0eXAtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKSwgc28gdGhlIG1hcmtzIHNob3cgZXhhY3RseSB0aGF0IGJsb2NrJ3Mga2V5cy5cbi8vIFN1YnR5cCBibG9ja3Mgb25seSB3aXRoIHRoZSBcIlN1YnR5cFwiIHN1Yi10b2dnbGUuXG5mdW5jdGlvbiBrZXlzRm9yU3RvcmUocGx1Z2luLCBzdG9yZSkge1xuICBjb25zdCB7IGNvbG9yVmlld3MgfSA9IHBsdWdpbi5zZXR0aW5ncztcbiAgaWYgKCFjb2xvclZpZXdzLmZyb250bWF0dGVyRGVmYXVsdHMgfHwgIXN0b3JlKSByZXR1cm4gTk9fS0VZUztcbiAgaWYgKHN0b3JlLnN1YnR5cCAmJiAhY29sb3JWaWV3cy5mcm9udG1hdHRlckRlZmF1bHRzU3VidHlwKSByZXR1cm4gTk9fS0VZUztcbiAgcmV0dXJuIHNwbGl0S2V5cyhbYmxvY2tPZihzdG9yZS5nZXRGcm9udG1hdHRlcigpLCBzdG9yZS5nZXRGbG9hdGluZygpKV0pO1xufVxuXG4vLyBQcm9wZXJ0eSBuYW1lIChsb3dlcmNhc2UpIC0+IHsgdHlwcywgYWxsRmxvYXRpbmcgfSBhY3Jvc3MgZXZlcnkgVFlQIHdob3NlXG4vLyBmcm9udG1hdHRlciAob3B0aW9uYWxseSB3aXRoIGl0cyBTdWJ0eXAgYmxvY2tzKSBoYXMgaXQuIFwiQWxsIHByb3BlcnRpZXNcIiBpc1xuLy8gdmF1bHQtd2lkZSB3aXRoIG5vIHNpbmdsZSBUWVAgY29udGV4dCwgc28gdGhlIGZ1bGwgbWFwcGluZyBpcyBjb2xsZWN0ZWQgdG9cbi8vIHRlbGwgXCJleGFjdGx5IG9uZSBUWVBcIiAoY29sb3IpIGZyb20gXCJzZXZlcmFsXCIgKGJvbGQpLiB0eXBzIG1hcHMgVFlQIC0+IHRoZVxuLy8gYmxvY2tzIGhvbGRpbmcgdGhlIGtleSAobnVsbCA9IHRoZSBUWVAtRnJvbnRtYXR0ZXIpOyBvbmx5IHRoZSB1bmFtYmlndW91c1xuLy8gY2FzZSBnZXRzIGNvbG9yZWQuIGFsbEZsb2F0aW5nIGlzIHRydWUgaWYgdGhlIGtleSBpcyBmbG9hdGluZyBpbiBFVkVSWSBibG9ja1xuLy8gb2YgRVZFUlkgVFlQIC0gYW55dGhpbmcgbGVzcyB3b3VsZCBtYWtlIGl0YWxpY3MgbWlzbGVhZGluZy5cbi8vXG4vLyBPd24gdG9nZ2xlIChjb2xvclZpZXdzLmFsbFByb3BlcnRpZXMpLCBpbmRlcGVuZGVudCBvZiBmcm9udG1hdHRlckRlZmF1bHRzLlxuLy8gQSBTdWJ0eXAgcHJvcGVydHkgY291bnRzIGZvciBpdHMgVFlQLlxuZnVuY3Rpb24gdHlwc1VzaW5nS2V5TWFwKHBsdWdpbikge1xuICBjb25zdCBtYXAgPSBuZXcgTWFwKCk7XG4gIGNvbnN0IHsgY29sb3JWaWV3cyB9ID0gcGx1Z2luLnNldHRpbmdzO1xuICBpZiAoIWNvbG9yVmlld3MuYWxsUHJvcGVydGllcykgcmV0dXJuIG1hcDtcbiAgY29uc3QgdHlwcyA9IG5ldyBTZXQoW1xuICAgIC4uLk9iamVjdC5rZXlzKHBsdWdpbi5zZXR0aW5ncy50eXBEZWZhdWx0RnJvbnRtYXR0ZXIpLFxuICAgIC4uLihjb2xvclZpZXdzLmFsbFByb3BlcnRpZXNTdWJ0eXAgPyBPYmplY3Qua2V5cyhwbHVnaW4uc2V0dGluZ3MudHlwU3VidHlwcyA/PyB7fSkgOiBbXSksXG4gIF0pO1xuICBmb3IgKGNvbnN0IHR5cCBvZiB0eXBzKSB7XG4gICAgY29uc3QgYmxvY2tzID0gYmxvY2tzRm9yVHlwKHBsdWdpbiwgdHlwLCBjb2xvclZpZXdzLmFsbFByb3BlcnRpZXNTdWJ0eXAgPyBBTExfU1VCVFlQUyA6IG51bGwpO1xuICAgIGZvciAoY29uc3QgeyBzZWN0aW9uLCBrZXlzLCBmbG9hdGluZyB9IG9mIGJsb2Nrcykge1xuICAgICAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykge1xuICAgICAgICBpZiAoIW1hcC5oYXMoa2V5KSkgbWFwLnNldChrZXksIHsgdHlwczogbmV3IE1hcCgpLCBhbGxGbG9hdGluZzogdHJ1ZSB9KTtcbiAgICAgICAgY29uc3QgZW50cnkgPSBtYXAuZ2V0KGtleSk7XG4gICAgICAgIGlmICghZW50cnkudHlwcy5oYXModHlwKSkgZW50cnkudHlwcy5zZXQodHlwLCBbXSk7XG4gICAgICAgIGVudHJ5LnR5cHMuZ2V0KHR5cCkucHVzaChzZWN0aW9uKTtcbiAgICAgICAgZW50cnkuYWxsRmxvYXRpbmcgPSBlbnRyeS5hbGxGbG9hdGluZyAmJiBmbG9hdGluZy5oYXMoa2V5KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIG1hcDtcbn1cblxuLy8gTWFya3Mgb25seSB0aGUgbmFtZSAoa2V5IGlucHV0KSwgbm90IHRoZSB2YWx1ZSAtIGluIG5vdGVzIChmcm9udG1hdHRlciBhbmRcbi8vIHByb3BlcnRpZXMgc2lkZWJhcikgYXMgd2VsbCBhcyBpbiB0aGUgcGx1Z2luJ3Mgb3duIFRZUC1QYW5lLlxuZnVuY3Rpb24gYXBwbHlUb0NvbnRhaW5lcihjb250YWluZXJFbCwgc3RhbmRhcmRLZXlzLCBmbG9hdGluZ0tleXMpIHtcbiAgaWYgKCFjb250YWluZXJFbCkgcmV0dXJuO1xuICBjb25zdCByb3dzID0gY29udGFpbmVyRWwucXVlcnlTZWxlY3RvckFsbChcIi5tZXRhZGF0YS1wcm9wZXJ0eVtkYXRhLXByb3BlcnR5LWtleV1cIik7XG4gIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICBjb25zdCBrZXlFbCA9IHJvdy5xdWVyeVNlbGVjdG9yKFwiLm1ldGFkYXRhLXByb3BlcnR5LWtleS1pbnB1dFwiKTtcbiAgICBpZiAoIWtleUVsKSBjb250aW51ZTtcbiAgICBjb25zdCBwcm9wZXJ0eUtleSA9IHJvdy5nZXRBdHRyaWJ1dGUoXCJkYXRhLXByb3BlcnR5LWtleVwiKTtcbiAgICBrZXlFbC5jbGFzc0xpc3QudG9nZ2xlKEhJR0hMSUdIVF9DTEFTUywgISFzdGFuZGFyZEtleXMgJiYgc3RhbmRhcmRLZXlzLmhhcyhwcm9wZXJ0eUtleSkpO1xuICAgIGtleUVsLmNsYXNzTGlzdC50b2dnbGUoRkxPQVRJTkdfQ0xBU1MsICEhZmxvYXRpbmdLZXlzICYmIGZsb2F0aW5nS2V5cy5oYXMocHJvcGVydHlLZXkpKTtcbiAgfVxufVxuXG4vLyBcIkFsbCBwcm9wZXJ0aWVzXCIgZG9lc24ndCB1c2UgdGhlIG1ldGFkYXRhIHdpZGdldCBidXQgaXRzIG93biB0cmVlIGl0ZW1zLFxuLy8gcmVhY2hhYmxlIHZpYSB2aWV3LmRvbXMgKG5hbWUgLT4gY29tcG9uZW50KTsgdGhlaXIgdGl0bGUgZWxlbWVudCBpc1xuLy8gLnRyZWUtaXRlbS1pbm5lci10ZXh0LlxuLy9cbi8vIE9uZSBUWVAgdXNpbmcgdGhlIHByb3BlcnR5OiB0aGUgbmFtZSBnZXRzIHRoYXQgVFlQJ3MgY29sb3IuIFNldmVyYWw6IGFcbi8vIHNpbmdsZSBjb2xvciB3b3VsZCBtaXNsZWFkLCBzbyBib2xkIGluc3RlYWQgKHNhbWUgbWFyayBhcyBpbiBhIG5vdGUpLlxuZnVuY3Rpb24gYXBwbHlUb0FsbFByb3BlcnRpZXNWaWV3KHBsdWdpbikge1xuICBjb25zdCB1c2FnZU1hcCA9IHR5cHNVc2luZ0tleU1hcChwbHVnaW4pO1xuICBmb3IgKGNvbnN0IGxlYWYgb2YgcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEFMTF9QUk9QRVJUSUVTX1ZJRVdfVFlQRSkpIHtcbiAgICBjb25zdCBkb21zID0gbGVhZi52aWV3Py5kb21zO1xuICAgIGlmICghZG9tcykgY29udGludWU7XG4gICAgZm9yIChjb25zdCBba2V5LCBkb21dIG9mIE9iamVjdC5lbnRyaWVzKGRvbXMpKSB7XG4gICAgICBjb25zdCB0aXRsZUVsID0gZG9tPy50aXRsZUVsO1xuICAgICAgaWYgKCF0aXRsZUVsKSBjb250aW51ZTtcblxuICAgICAgY29uc3QgZW50cnkgPSB1c2FnZU1hcC5nZXQoa2V5LnRvTG93ZXJDYXNlKCkpO1xuICAgICAgY29uc3QgdHlwcyA9IGVudHJ5Py50eXBzO1xuICAgICAgY29uc3QgY291bnQgPSB0eXBzID8gdHlwcy5zaXplIDogMDtcbiAgICAgIHRpdGxlRWwuY2xhc3NMaXN0LnRvZ2dsZShISUdITElHSFRfQ0xBU1MsIGNvdW50ID4gMSk7XG5cbiAgICAgIC8vIEl0YWxpYyBhcyBzb29uIGFzIGl0IGlzIGZsb2F0aW5nIEVWRVJZV0hFUkUuIFVubGlrZSBib2xkIHRoaXMgaXNuJ3RcbiAgICAgIC8vIGxpbWl0ZWQgdG8gb25lIFRZUCwgc28gYm90aCBjYW4gYXBwbHkgYXQgb25jZS5cbiAgICAgIHRpdGxlRWwuY2xhc3NMaXN0LnRvZ2dsZShGTE9BVElOR19DTEFTUywgY291bnQgPiAwICYmIGVudHJ5LmFsbEZsb2F0aW5nKTtcblxuICAgICAgLy8gV2l0aCBcIlN1YnR5cFwiLCB0aGUgY29sb3Igb2YgdGhlIFN1YnR5cCBibG9jayB0aGUgcHJvcGVydHkgY29tZXMgZnJvbSAtXG4gICAgICAvLyBidXQgb25seSBpZiBleGFjdGx5IG9uZSBibG9jayBvZiB0aGF0IFRZUCBoYXMgaXQuIE90aGVyd2lzZSB0aGUgY2hvaWNlXG4gICAgICAvLyB3b3VsZCBiZSBhcmJpdHJhcnkgYW5kIGNoYW5nZSB3aXRoIGJsb2NrIG9yZGVyLCBzbyB0aGUgVFlQIGNvbG9yXG4gICAgICAvLyAoc3VidHlwQ29sb3Igd2l0aCBudWxsKSBpcyB1c2VkLlxuICAgICAgaWYgKGNvdW50ID09PSAxKSB7XG4gICAgICAgIGNvbnN0IFtbb25seVR5cCwgc2VjdGlvbnNdXSA9IHR5cHM7XG4gICAgICAgIGNvbnN0IGNvbG9yID0gcGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MuYWxsUHJvcGVydGllc1N1YnR5cFxuICAgICAgICAgID8gc3VidHlwQ29sb3IocGx1Z2luLnNldHRpbmdzLCBvbmx5VHlwLCBzZWN0aW9ucy5sZW5ndGggPT09IDEgPyBzZWN0aW9uc1swXSA6IG51bGwpXG4gICAgICAgICAgOiBwbHVnaW4uc2V0dGluZ3MudHlwQ29sb3JzW29ubHlUeXBdO1xuICAgICAgICAvLyAhaW1wb3J0YW50LCBiZWNhdXNlIHRoZSBib2xkIHJ1bGUgaW4gc3R5bGVzLmNzcyBhbHNvIHNldHMgY29sb3JcbiAgICAgICAgLy8gIWltcG9ydGFudCBhbmQgY291bGQgc3RpbGwgYmUgYXR0YWNoZWQgZnJvbSBhbiBlYXJsaWVyIHN0YXRlLlxuICAgICAgICBzZXRJbmxpbmVDb2xvcih0aXRsZUVsLCBjb2xvciwgXCJpbXBvcnRhbnRcIik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzZXRJbmxpbmVDb2xvcih0aXRsZUVsLCBudWxsKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gYXBwbHlGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQocGx1Z2luKSB7XG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoXCJtYXJrZG93blwiKSkge1xuICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXc7XG4gICAgY29uc3QgeyBzdGFuZGFyZCwgZmxvYXRpbmcgfSA9IGtleXNGb3JGaWxlKHBsdWdpbiwgdmlldz8uZmlsZSk7XG4gICAgYXBwbHlUb0NvbnRhaW5lcih2aWV3Py5tZXRhZGF0YUVkaXRvcj8uY29udGFpbmVyRWwsIHN0YW5kYXJkLCBmbG9hdGluZyk7XG4gIH1cblxuICAvLyBUaGUgcHJvcGVydGllcyBzaWRlYmFyIGFsd2F5cyBzaG93cyB0aGUgYWN0aXZlIGZpbGUgYnV0IGtlZXBzIG5vIHJlbGlhYmxlXG4gIC8vIHJlZmVyZW5jZSB0byBpdCwgaGVuY2UgdGhlIGZhbGxiYWNrIHRvIHRoZSB3b3Jrc3BhY2UncyBhY3RpdmUgZmlsZS5cbiAgZm9yIChjb25zdCBsZWFmIG9mIHBsdWdpbi5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcImZpbGUtcHJvcGVydGllc1wiKSkge1xuICAgIGNvbnN0IHZpZXcgPSBsZWFmLnZpZXc7XG4gICAgY29uc3QgZmlsZSA9IHZpZXc/LmZpbGUgPz8gcGx1Z2luLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xuICAgIGNvbnN0IHsgc3RhbmRhcmQsIGZsb2F0aW5nIH0gPSBrZXlzRm9yRmlsZShwbHVnaW4sIGZpbGUpO1xuICAgIGFwcGx5VG9Db250YWluZXIodmlldz8ubWV0YWRhdGFFZGl0b3I/LmNvbnRhaW5lckVsLCBzdGFuZGFyZCwgZmxvYXRpbmcpO1xuICB9XG5cbiAgLy8gVGhlIFRZUC1QYW5lOiBlYWNoIGVkaXRvciBzaG93cyBleGFjdGx5IG9uZSBibG9jayAoVFlQIG9yIFN1YnR5cCkuXG4gIGZvciAoY29uc3QgbGVhZiBvZiBwbHVnaW4uYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoVklFV19UWVBFX1RZUF9QQU5FKSkge1xuICAgIGZvciAoY29uc3QgZWRpdG9yIG9mIGxlYWYudmlldz8uZnJvbnRtYXR0ZXJFZGl0b3JzID8/IFtdKSB7XG4gICAgICBjb25zdCB7IHN0YW5kYXJkLCBmbG9hdGluZyB9ID0ga2V5c0ZvclN0b3JlKHBsdWdpbiwgZWRpdG9yLm93bmVyPy50eXBTdG9yZSk7XG4gICAgICBhcHBseVRvQ29udGFpbmVyKGVkaXRvci5jb250YWluZXJFbCwgc3RhbmRhcmQsIGZsb2F0aW5nKTtcbiAgICB9XG4gIH1cblxuICBhcHBseVRvQWxsUHJvcGVydGllc1ZpZXcocGx1Z2luKTtcbn1cblxuZnVuY3Rpb24gcmVnaXN0ZXJGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQocGx1Z2luKSB7XG4gIGNvbnN0IHJlZnJlc2ggPSAoKSA9PiBhcHBseUZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodChwbHVnaW4pO1xuXG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAubWV0YWRhdGFDYWNoZS5vbihcImNoYW5nZWRcIiwgcmVmcmVzaCkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChwbHVnaW4uYXBwLm1ldGFkYXRhQ2FjaGUub24oXCJyZXNvbHZlZFwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwibGF5b3V0LWNoYW5nZVwiLCByZWZyZXNoKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KHBsdWdpbi5hcHAud29ya3NwYWNlLm9uKFwiYWN0aXZlLWxlYWYtY2hhbmdlXCIsIHJlZnJlc2gpKTtcblxuICBwbHVnaW4uYXBwLndvcmtzcGFjZS5vbkxheW91dFJlYWR5KHJlZnJlc2gpO1xuXG4gIC8vIEJvbGQvaXRhbGljIG1hcmtzIHdvdWxkIG90aGVyd2lzZSBzdGF5IG9uIHByb3BlcnR5IG5hbWVzIGluIG9wZW4gbm90ZXMsXG4gIC8vIHRoZSBwcm9wZXJ0aWVzIHNpZGViYXIgYW5kIFwiQWxsIHByb3BlcnRpZXNcIiBhZnRlciB0aGUgcGx1Z2luIGlzIGRpc2FibGVkLlxuICAvLyBUaGUgY29sb3IgaW4gXCJBbGwgcHJvcGVydGllc1wiIGdvZXMgd2l0aCB0aGUgb3RoZXIgaW5saW5lIGNvbG9yc1xuICAvLyAoY2xlYXJJbmxpbmVDb2xvcnMsIHNlZSBtYWluLmpzKS5cbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IHtcbiAgICBmb3IgKGNvbnN0IGRvYyBvZiBhbGxEb2N1bWVudHMocGx1Z2luLmFwcCkpIHtcbiAgICAgIGZvciAoY29uc3QgZWwgb2YgZG9jLnF1ZXJ5U2VsZWN0b3JBbGwoYC4ke0hJR0hMSUdIVF9DTEFTU30sIC4ke0ZMT0FUSU5HX0NMQVNTfWApKSB7XG4gICAgICAgIGVsLmNsYXNzTGlzdC5yZW1vdmUoSElHSExJR0hUX0NMQVNTLCBGTE9BVElOR19DTEFTUyk7XG4gICAgICB9XG4gICAgfVxuICB9KTtcblxuICByZXR1cm4gcmVmcmVzaDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyRnJvbnRtYXR0ZXJEZWZhdWx0SGlnaGxpZ2h0IH07XG4iLCAiY29uc3QgeyBOb3RpY2UgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgdHlwU3RvcmUsIHN1YnR5cFN0b3JlIH0gPSByZXF1aXJlKFwiLi90eXAtZnJvbnRtYXR0ZXItZWRpdG9yXCIpO1xuY29uc3QgeyBnZXRTdWJ0eXBOYW1lcywgaXNFbXB0eVZhbHVlIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBzXCIpO1xuY29uc3QgeyBwbHVyYWwsIGpvaW5BbmQgfSA9IHJlcXVpcmUoXCIuL3R5cC11dGlsc1wiKTtcbmNvbnN0IHsgVFlQX1BST1BFUlRZLCBTVUJUWVBfUFJPUEVSVFkgfSA9IHJlcXVpcmUoXCIuL3R5cC1pbmRleFwiKTtcblxuLy8gT2JzaWRpYW4gbG93ZXJjYXNlcyBwcm9wZXJ0eSBuYW1lcyBpbnRlcm5hbGx5LCBzbyBtYXRjaGluZyBpZ25vcmVzIGNhc2U7XG4vLyB0aGUgbmV3IG5hbWUgaXMga2VwdCBleGFjdGx5IGFzIHR5cGVkLlxuZnVuY3Rpb24gc2FtZUtleShhLCBiKSB7XG4gIHJldHVybiBhLnRvTG93ZXJDYXNlKCkgPT09IGIudG9Mb3dlckNhc2UoKTtcbn1cblxuLy8gUmVuYW1lcyBvbGRLZXkgaW4gb25lIGZyb250bWF0dGVyIGJsb2NrIChUWVAgb3IgU3VidHlwLCBzZWUgdHlwU3RvcmUvXG4vLyBzdWJ0eXBTdG9yZSBpbiB0eXAtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKSwga2VlcGluZyBpdHMgcG9zaXRpb24sIGFuZCBtb3Zlc1xuLy8gdGhlIGZsb2F0aW5nIGZsYWcgYWxvbmcuIElmIG5ld0tleSBhbHJlYWR5IGV4aXN0cyB0aGVyZSAoYSBtZXJnZSwgbGlrZVxuLy8gT2JzaWRpYW4ncyBvd24gbWVyZ2UgaW4gdGhlIG5vdGVzKSwgdGhlIGV4aXN0aW5nIGVudHJ5IGtlZXBzIGl0cyBwb3NpdGlvblxuLy8gYW5kIG9ubHkgdGFrZXMgdGhlIG9sZCB2YWx1ZSBpZiBpdHMgb3duIGlzIGVtcHR5LiBSZXR1cm5zIHRydWUgb24gYSBjaGFuZ2UuXG5mdW5jdGlvbiByZW5hbWVJblN0b3JlKHN0b3JlLCBvbGRLZXksIG5ld0tleSkge1xuICBjb25zdCBkZWZhdWx0cyA9IHN0b3JlLmdldEZyb250bWF0dGVyKCk7XG4gIGNvbnN0IGtleXMgPSBPYmplY3Qua2V5cyhkZWZhdWx0cyk7XG4gIGNvbnN0IHNvdXJjZUtleSA9IGtleXMuZmluZCgoa2V5KSA9PiBzYW1lS2V5KGtleSwgb2xkS2V5KSk7XG4gIGlmIChzb3VyY2VLZXkgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZhbHNlO1xuICAvLyBBIHB1cmUgY2hhbmdlIG9mIGNhc2UgZmluZHMgc291cmNlS2V5IGl0c2VsZiBmb3IgbmV3S2V5IC0gbm90IGEgbWVyZ2UuXG4gIGNvbnN0IHRhcmdldEtleSA9IGtleXMuZmluZCgoa2V5KSA9PiBrZXkgIT09IHNvdXJjZUtleSAmJiBzYW1lS2V5KGtleSwgbmV3S2V5KSk7XG4gIGlmICh0YXJnZXRLZXkgPT09IHVuZGVmaW5lZCAmJiBzb3VyY2VLZXkgPT09IG5ld0tleSkgcmV0dXJuIGZhbHNlO1xuXG4gIGNvbnN0IG5leHQgPSB7fTtcbiAgZm9yIChjb25zdCBrZXkgb2Yga2V5cykge1xuICAgIGlmIChrZXkgIT09IHNvdXJjZUtleSkge1xuICAgICAgbmV4dFtrZXldID0gZGVmYXVsdHNba2V5XTtcbiAgICB9IGVsc2UgaWYgKHRhcmdldEtleSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBuZXh0W25ld0tleV0gPSBkZWZhdWx0c1tzb3VyY2VLZXldO1xuICAgIH1cbiAgfVxuICBpZiAodGFyZ2V0S2V5ICE9PSB1bmRlZmluZWQgJiYgaXNFbXB0eVZhbHVlKG5leHRbdGFyZ2V0S2V5XSkpIG5leHRbdGFyZ2V0S2V5XSA9IGRlZmF1bHRzW3NvdXJjZUtleV07XG4gIHN0b3JlLnNldEZyb250bWF0dGVyKG5leHQpO1xuXG4gIGNvbnN0IGZsb2F0aW5nID0gc3RvcmUuZ2V0RmxvYXRpbmcoKTtcbiAgaWYgKGZsb2F0aW5nLmxlbmd0aCA+IDApIHtcbiAgICAvLyBPbiBhIG1lcmdlIHRoZSB0YXJnZXQncyBmbG9hdGluZyBmbGFnIHdpbnMuXG4gICAgc3RvcmUuc2V0RmxvYXRpbmcoXG4gICAgICB0YXJnZXRLZXkgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IGZsb2F0aW5nLmZpbHRlcigoa2V5KSA9PiBrZXkgIT09IHNvdXJjZUtleSlcbiAgICAgICAgOiBmbG9hdGluZy5tYXAoKGtleSkgPT4gKGtleSA9PT0gc291cmNlS2V5ID8gbmV3S2V5IDoga2V5KSlcbiAgICApO1xuICB9XG5cbiAgLy8gVGhlIHNob3J0Y3V0IGJlbG9uZ3MgdG8gdGhlIGtleSBhbmQgbW92ZXMgd2l0aCBpdDsgb24gYSBtZXJnZSB0aGVcbiAgLy8gdGFyZ2V0J3Mgd2lucywgYXMgd2l0aCBmbG9hdGluZy5cbiAgY29uc3Qgc2hvcnRjdXRzID0geyAuLi5zdG9yZS5nZXRTaG9ydGN1dHMoKSB9O1xuICBpZiAoc2hvcnRjdXRzW3NvdXJjZUtleV0pIHtcbiAgICBpZiAodGFyZ2V0S2V5ID09PSB1bmRlZmluZWQpIHNob3J0Y3V0c1tuZXdLZXldID0gc2hvcnRjdXRzW3NvdXJjZUtleV07XG4gICAgZGVsZXRlIHNob3J0Y3V0c1tzb3VyY2VLZXldO1xuICAgIHN0b3JlLnNldFNob3J0Y3V0cyhzaG9ydGN1dHMpO1xuICB9XG4gIHJldHVybiB0cnVlO1xufVxuXG4vLyBQaW5uZWQgZW50cmllcyBvZiB0aGUgZ2xvYmFsIG9yZGVyIGFsbG93IG5vIGR1cGxpY2F0ZXMsIHNvIGFuIGV4aXN0aW5nXG4vLyB0YXJnZXQgZW50cnkga2VlcHMgaXRzIHBvc2l0aW9uIGFuZCB0aGUgb2xkIG9uZSBnb2VzLlxuZnVuY3Rpb24gcmVuYW1lSW5HbG9iYWxPcmRlcihzZXR0aW5ncywgb2xkS2V5LCBuZXdLZXkpIHtcbiAgY29uc3Qgb3JkZXIgPSBzZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyO1xuICBjb25zdCBzb3VyY2UgPSBvcmRlci5maW5kKChlbnRyeSkgPT4gZW50cnkua2luZCA9PT0gXCJwcm9wZXJ0eVwiICYmIHNhbWVLZXkoZW50cnkubmFtZSwgb2xkS2V5KSk7XG4gIGlmICghc291cmNlKSByZXR1cm4gZmFsc2U7XG4gIGNvbnN0IHRhcmdldCA9IG9yZGVyLmZpbmQoKGVudHJ5KSA9PiBlbnRyeSAhPT0gc291cmNlICYmIGVudHJ5LmtpbmQgPT09IFwicHJvcGVydHlcIiAmJiBzYW1lS2V5KGVudHJ5Lm5hbWUsIG5ld0tleSkpO1xuICBpZiAodGFyZ2V0KSBzZXR0aW5ncy5nbG9iYWxQcm9wZXJ0eU9yZGVyID0gb3JkZXIuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkgIT09IHNvdXJjZSk7XG4gIGVsc2UgaWYgKHNvdXJjZS5uYW1lID09PSBuZXdLZXkpIHJldHVybiBmYWxzZTtcbiAgZWxzZSBzb3VyY2UubmFtZSA9IG5ld0tleTtcbiAgcmV0dXJuIHRydWU7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHN5bmNSZW5hbWUocGx1Z2luLCBvbGRLZXksIG5ld0tleSkge1xuICBpZiAodHlwZW9mIG9sZEtleSAhPT0gXCJzdHJpbmdcIiB8fCB0eXBlb2YgbmV3S2V5ICE9PSBcInN0cmluZ1wiKSByZXR1cm47XG4gIG5ld0tleSA9IG5ld0tleS50cmltKCk7XG4gIGlmIChvbGRLZXkgPT09IFwiXCIgfHwgbmV3S2V5ID09PSBcIlwiIHx8IG9sZEtleSA9PT0gbmV3S2V5KSByZXR1cm47XG4gIC8vIFRZUC9TVUJUWVAgYXJlIG5ldmVyIHBhcnQgb2YgYSBibG9jayAoc2VlIHN0cmlwVHlwUHJvcGVydHkgaW5cbiAgLy8gdHlwLWZyb250bWF0dGVyLWVkaXRvci5qcyksIHNvIHJlbmFtZXMgZnJvbSBvciB0byB0aGVtIGFyZSBpZ25vcmVkLlxuICBpZiAoW29sZEtleSwgbmV3S2V5XS5zb21lKChrZXkpID0+IHNhbWVLZXkoa2V5LCBUWVBfUFJPUEVSVFkpIHx8IHNhbWVLZXkoa2V5LCBTVUJUWVBfUFJPUEVSVFkpKSkgcmV0dXJuO1xuXG4gIGNvbnN0IHsgc2V0dGluZ3MgfSA9IHBsdWdpbjtcbiAgbGV0IHR5cENvdW50ID0gMDtcbiAgbGV0IHN1YnR5cENvdW50ID0gMDtcbiAgY29uc3QgY291bnQgPSAoc3RvcmUpID0+IChzdG9yZS5zdWJ0eXAgPyBzdWJ0eXBDb3VudCsrIDogdHlwQ291bnQrKyk7XG4gIGNvbnN0IHR5cHMgPSBuZXcgU2V0KFsuLi5PYmplY3Qua2V5cyhzZXR0aW5ncy50eXBEZWZhdWx0RnJvbnRtYXR0ZXIpLCAuLi5PYmplY3Qua2V5cyhzZXR0aW5ncy50eXBTdWJ0eXBzID8/IHt9KV0pO1xuICBmb3IgKGNvbnN0IHR5cCBvZiB0eXBzKSB7XG4gICAgY29uc3Qgc3RvcmVzID0gW3R5cFN0b3JlKHBsdWdpbiwgdHlwKSwgLi4uZ2V0U3VidHlwTmFtZXMoc2V0dGluZ3MsIHR5cCkubWFwKChzdWJ0eXApID0+IHN1YnR5cFN0b3JlKHBsdWdpbiwgdHlwLCBzdWJ0eXApKV07XG5cbiAgICAvLyBBIHZhdWx0LXdpZGUgcmVuYW1lIGhpdHMgRVZFUlkgYmxvY2sgaG9sZGluZyB0aGUga2V5IC0gdGhlIHNhbWUga2V5IG1heVxuICAgIC8vIGFwcGVhciBpbiBzZXZlcmFsIGJsb2NrcyAoc2VlIHR5cFN1YnR5cHMgaW4gc3VidHlwcy5qcykuIE9ubHkgd2l0aGluIG9uZVxuICAgIC8vIGJsb2NrIGNhbiB0aGUgbmV3IG5hbWUgY29sbGlkZTsgcmVuYW1lSW5TdG9yZSBtZXJnZXMgdGhlIHR3byB0aGVyZS5cbiAgICBmb3IgKGNvbnN0IHN0b3JlIG9mIHN0b3Jlcykge1xuICAgICAgaWYgKHJlbmFtZUluU3RvcmUoc3RvcmUsIG9sZEtleSwgbmV3S2V5KSkgY291bnQoc3RvcmUpO1xuICAgIH1cbiAgfVxuICBjb25zdCBvcmRlckNoYW5nZWQgPSByZW5hbWVJbkdsb2JhbE9yZGVyKHNldHRpbmdzLCBvbGRLZXksIG5ld0tleSk7XG4gIGlmICh0eXBDb3VudCA9PT0gMCAmJiBzdWJ0eXBDb3VudCA9PT0gMCAmJiAhb3JkZXJDaGFuZ2VkKSByZXR1cm47XG5cbiAgYXdhaXQgcGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuICBwbHVnaW4ucmVmcmVzaFR5cENvbG9ycz8uKCk7XG5cbiAgY29uc3QgcGFydHMgPSBbXTtcbiAgaWYgKHR5cENvdW50ID4gMCkgcGFydHMucHVzaChwbHVyYWwodHlwQ291bnQsIFwiVFlQIGJsb2NrXCIpKTtcbiAgaWYgKHN1YnR5cENvdW50ID4gMCkgcGFydHMucHVzaChwbHVyYWwoc3VidHlwQ291bnQsIFwiU3VidHlwIGJsb2NrXCIpKTtcbiAgaWYgKG9yZGVyQ2hhbmdlZCkgcGFydHMucHVzaChcInRoZSBnbG9iYWwgb3JkZXJcIik7XG4gIG5ldyBOb3RpY2UoYFRZUC1TeXN0ZW06IHJlbmFtZWQgXCIke29sZEtleX1cIiBcdTIxOTIgXCIke25ld0tleX1cIiBpbiAke2pvaW5BbmQocGFydHMpfS5gKTtcbn1cblxuLy8gT2JzaWRpYW4ncyBcIkFsbCBwcm9wZXJ0aWVzXCIgdmlldyBhbmQgQmFzZXMgKG5hbWluZyBhIG5ldyBub3RlIHByb3BlcnR5KVxuLy8gcmVuYW1lIHByb3BlcnRpZXMgdmF1bHQtd2lkZSBvbmx5IHRocm91Z2ggYXBwLmZpbGVNYW5hZ2VyLnJlbmFtZVByb3BlcnR5LFxuLy8gc28gd3JhcHBpbmcgdGhhdCBvbmUgbWV0aG9kIGNhdGNoZXMgZXZlcnkgcmVhbCByZW5hbWUuIEJhc2VzJyBcIkRpc3BsYXlcbi8vIG5hbWVcIiBvbmx5IGNoYW5nZXMgdGhlIC5iYXNlIGZpbGUsIG5vdCB0aGUgbm90ZXMsIGFuZCByaWdodGx5IGRvZXNuJ3QgcGFzc1xuLy8gdGhyb3VnaCBoZXJlLlxuZnVuY3Rpb24gcmVnaXN0ZXJQcm9wZXJ0eVJlbmFtZVN5bmMocGx1Z2luKSB7XG4gIGNvbnN0IGZpbGVNYW5hZ2VyID0gcGx1Z2luLmFwcC5maWxlTWFuYWdlcjtcbiAgaWYgKGZpbGVNYW5hZ2VyLl9fdHlwU3lzdGVtUmVuYW1lU3luY1BhdGNoZWQpIHJldHVybjtcbiAgZmlsZU1hbmFnZXIuX190eXBTeXN0ZW1SZW5hbWVTeW5jUGF0Y2hlZCA9IHRydWU7XG5cbiAgY29uc3Qgb3JpZ2luYWwgPSBmaWxlTWFuYWdlci5yZW5hbWVQcm9wZXJ0eTtcbiAgZmlsZU1hbmFnZXIucmVuYW1lUHJvcGVydHkgPSBhc3luYyBmdW5jdGlvbiAob2xkS2V5LCBuZXdLZXksIC4uLnJlc3QpIHtcbiAgICAvLyBJZiB0aGUgb3JpZ2luYWwgdGhyb3dzIChhY2NlcHRSZW5hbWUgaGFuZGxlcyB0aGF0KSwgc2V0dGluZ3Mgc3RheSBhc1xuICAgIC8vIHRoZXkgYXJlLlxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IG9yaWdpbmFsLmNhbGwodGhpcywgb2xkS2V5LCBuZXdLZXksIC4uLnJlc3QpO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBzeW5jUmVuYW1lKHBsdWdpbiwgb2xkS2V5LCBuZXdLZXkpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiVFlQLVN5c3RlbTogcHJvcGVydHkgcmVuYW1lIG5vdCBhcHBsaWVkXCIsIGVycm9yKTtcbiAgICAgIG5ldyBOb3RpY2UoYFRZUC1TeXN0ZW06IHJlbmFtZSBvZiBcIiR7b2xkS2V5fVwiIG5vdCBhcHBsaWVkIFx1MjAxMyAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH07XG5cbiAgcGx1Z2luLnJlZ2lzdGVyKCgpID0+IHtcbiAgICBmaWxlTWFuYWdlci5yZW5hbWVQcm9wZXJ0eSA9IG9yaWdpbmFsO1xuICAgIGRlbGV0ZSBmaWxlTWFuYWdlci5fX3R5cFN5c3RlbVJlbmFtZVN5bmNQYXRjaGVkO1xuICB9KTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHJlZ2lzdGVyUHJvcGVydHlSZW5hbWVTeW5jIH07XG4iLCAiY29uc3QgeyBGdXp6eVN1Z2dlc3RNb2RhbCwgTm90aWNlLCBwcmVwYXJlRnV6enlTZWFyY2gsIHJlbmRlck1hdGNoZXMgfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcbmNvbnN0IHsgY29tcGFyZVR5cHMsIERFRkFVTFRfU09SVF9PUkRFUiB9ID0gcmVxdWlyZShcIi4vdHlwLXBhbmVcIik7XG5jb25zdCB7IG5hbWVDb2xvciwgcGFpbnRDb2xvckRvdCB9ID0gcmVxdWlyZShcIi4vdHlwLWNvbG9yc1wiKTtcbmNvbnN0IHsgcGlja2VySW5zdHJ1Y3Rpb25zIH0gPSByZXF1aXJlKFwiLi90eXAtdXRpbHNcIik7XG5cbi8vIFRoZSBzZWFyY2ggdGV4dCBvZiBhIFRZUCByb3csIGFzIHRoZSBwYXJ0cyB0aGUgcm93IHJlbmRlcnMgc2VwYXJhdGVseTpcbi8vIFt7IGtleTogXCJ0eXBcIiB8IFwic3VidHlwc1wiIHwgXCJkZXNjcmlwdGlvblwiLCB0ZXh0LCBzdGFydCB9XSwgc3RhcnQgYmVpbmcgdGhlXG4vLyBwYXJ0J3MgcG9zaXRpb24gaW4gdGhlIHNlYXJjaCB0ZXh0LiBnZXRJdGVtVGV4dCBqb2lucyBleGFjdGx5IHRoZXNlIHdpdGhcbi8vIFwiIFwiLCBzbyB0aGlzIGlzIHRoZSBvbmUgcGxhY2UgdGhhdCBkZWZpbmVzIGl0IC0gdGhlIG1hdGNoIHJhbmdlcyBPYnNpZGlhblxuLy8gcmV0dXJucyByZWZlciB0byB0aGUgam9pbmVkIHRleHQgYW5kIGFyZSBzcGxpdCBiYWNrIG9udG8gdGhlIHBhcnRzIGJ5XG4vLyBzdGFydCAoc2VlIGhpZ2hsaWdodCkuIFRoZSBTdWJ0eXAgbmFtZXMgYXJlIG9uZSBwYXJ0LCBqb2luZWQgd2l0aCBcIiBcIiBhcyBpblxuLy8gdGhlIHNlYXJjaCB0ZXh0LCB0aG91Z2ggdGhlIHJvdyBzaG93cyB0aGVtIHdpdGggXCIsIFwiLlxuZnVuY3Rpb24gdGV4dFBhcnRzKGl0ZW0pIHtcbiAgY29uc3QgcGFydHMgPSBbXTtcbiAgbGV0IHN0YXJ0ID0gMDtcbiAgY29uc3QgYWRkID0gKGtleSwgdGV4dCkgPT4ge1xuICAgIGlmICghdGV4dCkgcmV0dXJuO1xuICAgIHBhcnRzLnB1c2goeyBrZXksIHRleHQsIHN0YXJ0IH0pO1xuICAgIHN0YXJ0ICs9IHRleHQubGVuZ3RoICsgMTtcbiAgfTtcbiAgYWRkKFwidHlwXCIsIGl0ZW0udHlwKTtcbiAgYWRkKFwic3VidHlwc1wiLCBpdGVtLnN1YnR5cHM/LmpvaW4oXCIgXCIpKTtcbiAgYWRkKFwiZGVzY3JpcHRpb25cIiwgaXRlbS5kZXNjcmlwdGlvbik7XG4gIHJldHVybiBwYXJ0cztcbn1cblxuLy8gV3JpdGVzIHRleHQgaW50byBlbCB3aXRoIHRoZSBtYXRjaGVkIGNoYXJhY3RlcnMgbWFya2VkIGxpa2UgaW4gT2JzaWRpYW4nc1xuLy8gb3duIHN1Z2dlc3RlcnMgKC5zdWdnZXN0aW9uLWhpZ2hsaWdodCkuIHN0YXJ0IGlzIHRoZSB0ZXh0J3MgcG9zaXRpb24gaW4gdGhlXG4vLyB3aG9sZSBzZWFyY2ggdGV4dDsgcmVuZGVyTWF0Y2hlcyBzaGlmdHMgZXZlcnkgcmFuZ2UgYnkgaXRzIG9mZnNldCBhbmRcbi8vIGNsaXBzIHdoYXQgZmFsbHMgb3V0c2lkZSwgc28gLXN0YXJ0IG1hcHMgdGhlIHJhbmdlcyBvbnRvIHRoaXMgcGFydC5cbmZ1bmN0aW9uIGhpZ2hsaWdodChlbCwgdGV4dCwgbWF0Y2hlcywgc3RhcnQgPSAwKSB7XG4gIHJlbmRlck1hdGNoZXMoZWwsIHRleHQsIG1hdGNoZXM/Lmxlbmd0aCA/IG1hdGNoZXMgOiBudWxsLCAtc3RhcnQpO1xufVxuXG4vLyBOYXRpdmUgcmVwbGFjZW1lbnQgZm9yIFRlbXBsYXRlcidzIHRwLnN5c3RlbS5zdWdnZXN0ZXIgd2hlbiBjaG9vc2luZyBhIFRZUFxuLy8gKHNlZSBfb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzKSwgYnVpbHQgb24gT2JzaWRpYW4nc1xuLy8gRnV6enlTdWdnZXN0TW9kYWwgbGlrZSBUZW1wbGF0ZXIncyBvd24sIGJ1dCBzaG93aW5nIGNvbG9yIG9yIGRvdCxcbi8vIGRlc2NyaXB0aW9uIGFuZCBub3RlIGNvdW50IHBlciByb3cuIFVucmVnaXN0ZXJlZCBlbnRyaWVzIGFyZSBtdXRlZCwgYXMgaW5cbi8vIHRoZSBUWVAtTGlzdC5cbmNsYXNzIFR5cFBpY2tlck1vZGFsIGV4dGVuZHMgRnV6enlTdWdnZXN0TW9kYWwge1xuICBjb25zdHJ1Y3RvcihhcHAsIHBsdWdpbiwgaXRlbXMsIHJlc29sdmUpIHtcbiAgICBzdXBlcihhcHApO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICAgIHRoaXMuaXRlbXMgPSBpdGVtcztcbiAgICB0aGlzLnJlc29sdmUgPSByZXNvbHZlO1xuICAgIHRoaXMuY2hvc2VuID0gZmFsc2U7XG4gICAgdGhpcy5zZXRQbGFjZWhvbGRlcihcIkNob29zZSBUWVBcdTIwMjZcIik7XG4gICAgdGhpcy5zZXRJbnN0cnVjdGlvbnMocGlja2VySW5zdHJ1Y3Rpb25zKCkpO1xuICB9XG5cbiAgZ2V0SXRlbXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuaXRlbXM7XG4gIH1cblxuICAvLyBTZWFyY2ggYWxzbyBjb3ZlcnMgdGhlIGRlc2NyaXB0aW9uIGFuZCwgd2hlcmUgc2hvd24gaW4gdGhlIHJvd1xuICAvLyAoc2hvd1N1YnR5cHMpLCB0aGUgU3VidHlwIG5hbWVzOiB3aGF0IHlvdSBzZWUgeW91IGV4cGVjdCB0byBiZSBhYmxlIHRvIHR5cGUuXG4gIGdldEl0ZW1UZXh0KGl0ZW0pIHtcbiAgICByZXR1cm4gdGV4dFBhcnRzKGl0ZW0pXG4gICAgICAubWFwKChwYXJ0KSA9PiBwYXJ0LnRleHQpXG4gICAgICAuam9pbihcIiBcIik7XG4gIH1cblxuICByZW5kZXJTdWdnZXN0aW9uKG1hdGNoLCBlbCkge1xuICAgIGNvbnN0IGl0ZW0gPSBtYXRjaC5pdGVtO1xuICAgIGNvbnN0IG1hdGNoZXMgPSBtYXRjaC5tYXRjaD8ubWF0Y2hlcyA/PyBbXTtcbiAgICBjb25zdCBwYXJ0cyA9IE9iamVjdC5mcm9tRW50cmllcyh0ZXh0UGFydHMoaXRlbSkubWFwKChwYXJ0KSA9PiBbcGFydC5rZXksIHBhcnRdKSk7XG4gICAgZWwuYWRkQ2xhc3MoXCJ0eXAtcGlja2VyLXN1Z2dlc3Rpb25cIik7XG4gICAgaWYgKGl0ZW0udW5yZWdpc3RlcmVkKSBlbC5hZGRDbGFzcyhcInR5cC1waWNrZXItdW5yZWdpc3RlcmVkXCIpO1xuXG4gICAgaWYgKGl0ZW0udW5yZWdpc3RlcmVkKSB7XG4gICAgICBoaWdobGlnaHQoZWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtcGlja2VyLW5hbWVcIiB9KSwgaXRlbS50eXAsIG1hdGNoZXMpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnJlbmRlckNvbG9yZWROYW1lKGVsLCBpdGVtLnR5cCwgaXRlbS50eXAsIG51bGwsIG1hdGNoZXMpO1xuICAgIH1cblxuICAgIGlmIChpdGVtLnN1YnR5cHM/Lmxlbmd0aCkgdGhpcy5yZW5kZXJTdWJ0eXBQcmV2aWV3KGVsLCBpdGVtLCBtYXRjaGVzLCBwYXJ0cy5zdWJ0eXBzLnN0YXJ0KTtcblxuICAgIGlmIChpdGVtLmRlc2NyaXB0aW9uKSB7XG4gICAgICBoaWdobGlnaHQoZWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtcGlja2VyLWRlc2NcIiB9KSwgaXRlbS5kZXNjcmlwdGlvbiwgbWF0Y2hlcywgcGFydHMuZGVzY3JpcHRpb24uc3RhcnQpO1xuICAgIH1cblxuICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXBpY2tlci1jb3VudFwiLCB0ZXh0OiBTdHJpbmcoaXRlbS5jb3VudCkgfSk7XG4gIH1cblxuICAvLyBOYW1lIGluIHRoZSBjb2xvciBvZiBjb2xvclR5cCAob3Igb2YgdGhlIFN1YnR5cCwgc2VlIG5hbWVDb2xvciBpblxuICAvLyB0eXAtY29sb3JzLmpzKSAtIGFzIGNvbG9yZWQgdGV4dCBvciB3aXRoIGEgZG90IGJlZm9yZSBpdCwgZGVwZW5kaW5nIG9uXG4gIC8vIHRoZSBcIlRZUC1QYW5lXCIgY29sb3Jpbmcgc2V0dGluZy4gbWF0Y2hlcy9zdGFydCBhcyBpbiBoaWdobGlnaHQoKS5cbiAgcmVuZGVyQ29sb3JlZE5hbWUoZWwsIHRleHQsIGNvbG9yVHlwLCBzdWJ0eXAgPSBudWxsLCBtYXRjaGVzID0gW10sIHN0YXJ0ID0gMCkge1xuICAgIGNvbnN0IHsgY29sb3IsIGlzRGVmYXVsdCB9ID0gbmFtZUNvbG9yKHRoaXMucGx1Z2luLnNldHRpbmdzLCBjb2xvclR5cCwgc3VidHlwKTtcbiAgICBjb25zdCBjb2xvcml6ZSA9IHRoaXMucGx1Z2luLnNldHRpbmdzLmNvbG9yVmlld3MudHlwTGlzdDtcbiAgICBpZiAoIWNvbG9yaXplKSBwYWludENvbG9yRG90KGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXBpY2tlci1kb3RcIiB9KSwgY29sb3IsIGlzRGVmYXVsdCk7XG4gICAgY29uc3QgbmFtZUVsID0gZWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtcGlja2VyLW5hbWVcIiB9KTtcbiAgICBpZiAoY29sb3JpemUpIG5hbWVFbC5zdHlsZS5jb2xvciA9IGNvbG9yO1xuICAgIGhpZ2hsaWdodChuYW1lRWwsIHRleHQsIG1hdGNoZXMsIHN0YXJ0KTtcbiAgfVxuXG4gIC8vIFwiVFlQIChTdWJ0eXAgMSwgU3VidHlwIDIpXCIgLSBzaG93cyB3aGF0IGxpZXMgYmVsb3cgdGhlIFRZUCBiZWZvcmUgdGhlXG4gIC8vIHNlcGFyYXRlIFN1YnR5cC1QaWNrZXIgY29tZXMuIEVhY2ggU3VidHlwIGluIGl0cyBvd24gY29sb3IsIGJyYWNrZXRzIGFuZFxuICAvLyBjb21tYXMgbXV0ZWQ7IHVuY29sb3JlZCBsaWtlIHRoZSBuYW1lIHdoZW4gXCJUWVAtUGFuZVwiIGNvbG9yaW5nIGlzIG9mZi5cbiAgLy8gc3RhcnQgaXMgd2hlcmUgdGhlIFN1YnR5cCBuYW1lcyBiZWdpbiBpbiB0aGUgc2VhcmNoIHRleHQ7IHRoZXJlIHRoZXkgYXJlXG4gIC8vIHNlcGFyYXRlZCBieSBvbmUgc3BhY2UgaW5zdGVhZCBvZiBcIiwgXCIsIHNvIGVhY2ggbmFtZSBzdGFydHMgb25lIGNoYXJhY3RlclxuICAvLyBhZnRlciB0aGUgZW5kIG9mIHRoZSBvbmUgYmVmb3JlLlxuICByZW5kZXJTdWJ0eXBQcmV2aWV3KGVsLCBpdGVtLCBtYXRjaGVzID0gW10sIHN0YXJ0ID0gMCkge1xuICAgIGNvbnN0IGNvbG9yaXplID0gdGhpcy5wbHVnaW4uc2V0dGluZ3MuY29sb3JWaWV3cy50eXBMaXN0O1xuICAgIGNvbnN0IHdyYXAgPSBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1waWNrZXItc3VidHlwc1wiIH0pO1xuICAgIHdyYXAuYXBwZW5kVGV4dChcIihcIik7XG4gICAgbGV0IHBvc2l0aW9uID0gc3RhcnQ7XG4gICAgaXRlbS5zdWJ0eXBzLmZvckVhY2goKHN1YnR5cCwgaW5kZXgpID0+IHtcbiAgICAgIGlmIChpbmRleCA+IDApIHdyYXAuYXBwZW5kVGV4dChcIiwgXCIpO1xuICAgICAgY29uc3Qgc3BhbiA9IHdyYXAuY3JlYXRlU3BhbigpO1xuICAgICAgaGlnaGxpZ2h0KHNwYW4sIHN1YnR5cCwgbWF0Y2hlcywgcG9zaXRpb24pO1xuICAgICAgcG9zaXRpb24gKz0gc3VidHlwLmxlbmd0aCArIDE7XG4gICAgICBpZiAoY29sb3JpemUpIHNwYW4uc3R5bGUuY29sb3IgPSBuYW1lQ29sb3IodGhpcy5wbHVnaW4uc2V0dGluZ3MsIGl0ZW0udHlwLCBzdWJ0eXApLmNvbG9yO1xuICAgIH0pO1xuICAgIHdyYXAuYXBwZW5kVGV4dChcIilcIik7XG4gIH1cblxuICAvLyBPYnNpZGlhbidzIHNlbGVjdFN1Z2dlc3Rpb24oKSBjYWxscyBjbG9zZSgpIEJFRk9SRSBvbkNob29zZUl0ZW0oKS4gU2V0XG4gIC8vIFwiY2hvc2VuXCIgYW55IGxhdGVyIGFuZCBvbkNsb3NlKCkgcmVzb2x2ZXMgd2l0aCBudWxsIGZpcnN0IC0gYSBwcm9taXNlIG9ubHlcbiAgLy8gcmVzb2x2ZXMgb25jZSwgc28gZXZlcnkgY2hvaWNlIHdvdWxkIGNvbWUgYmFjayBhcyBudWxsLlxuICBzZWxlY3RTdWdnZXN0aW9uKGl0ZW0sIGV2dCkge1xuICAgIHRoaXMuY2hvc2VuID0gdHJ1ZTtcbiAgICAvLyBXaGF0IHdhcyB0eXBlZCB3aGVuIGNob29zaW5nOyB0aGUgU3VidHlwLVBpY2tlciBzb3J0cyBieSBpdCAoc2VlXG4gICAgLy8gcGlja1R5cEVudHJ5L3NvcnRCeVF1ZXJ5KS5cbiAgICB0aGlzLnF1ZXJ5ID0gdGhpcy5pbnB1dEVsLnZhbHVlLnRyaW0oKTtcbiAgICBzdXBlci5zZWxlY3RTdWdnZXN0aW9uKGl0ZW0sIGV2dCk7XG4gIH1cblxuICBvbkNob29zZUl0ZW0oaXRlbSkge1xuICAgIHRoaXMucmVzb2x2ZShpdGVtLnR5cCk7XG4gIH1cblxuICAvLyBFU0Mgb3IgYSBjbGljayBvdXRzaWRlIGNsb3NlcyB3aXRob3V0IHNlbGVjdFN1Z2dlc3Rpb246IHJlc29sdmUgd2l0aCBudWxsXG4gIC8vIGluc3RlYWQgb2YgbGVhdmluZyB0aGUgcHJvbWlzZSBoYW5naW5nLCBsaWtlIHRwLnN5c3RlbS5zdWdnZXN0ZXIuXG4gIG9uQ2xvc2UoKSB7XG4gICAgc3VwZXIub25DbG9zZSgpO1xuICAgIGlmICghdGhpcy5jaG9zZW4pIHRoaXMucmVzb2x2ZShudWxsKTtcbiAgfVxufVxuXG4vLyBQaWNrcyBhIFN1YnR5cCBmb3IgYW4gYWxyZWFkeSBjaG9zZW4gVFlQIChzZWUgcGlja1N1YnR5cCkuIExpa2Vcbi8vIFR5cFBpY2tlck1vZGFsLCBwbHVzIGEgZmlyc3Qgcm93IFwiVFlQIChubyBTdWJ0eXApXCIgKGl0ZW0ubm9uZSkuIEVTQyByZXNvbHZlc1xuLy8gd2l0aCBudWxsLCBhbmQgVFlQLmpzIGdvZXMgYmFjayB0byB0aGUgVFlQIGNob2ljZS4gcXVlcnkgaXMgdGhlIHNlYXJjaCBmcm9tXG4vLyB0aGUgVFlQLVBpY2tlciB0aGF0IHByZS1zb3J0cyB0aGUgbGlzdC5cbmNsYXNzIFN1YnR5cFBpY2tlck1vZGFsIGV4dGVuZHMgVHlwUGlja2VyTW9kYWwge1xuICBjb25zdHJ1Y3RvcihhcHAsIHBsdWdpbiwgdHlwLCBpdGVtcywgcmVzb2x2ZSwgcXVlcnkgPSBcIlwiKSB7XG4gICAgc3VwZXIoYXBwLCBwbHVnaW4sIGl0ZW1zLCByZXNvbHZlKTtcbiAgICB0aGlzLnR5cCA9IHR5cDtcbiAgICB0aGlzLnNldFBsYWNlaG9sZGVyKGBDaG9vc2UgU3VidHlwIGZvciAke3R5cH1cdTIwMjZgKTtcbiAgICB0aGlzLnNldEluc3RydWN0aW9ucyhwaWNrZXJJbnN0cnVjdGlvbnMoXCJ0byBnbyBiYWNrXCIpKTtcbiAgICB0aGlzLml0ZW1zID0gc29ydEJ5UXVlcnkoaXRlbXMsIHF1ZXJ5LCAoaXRlbSkgPT4gdGhpcy5nZXRJdGVtVGV4dChpdGVtKSk7XG4gIH1cblxuICAvLyBUaGUgXCJubyBTdWJ0eXBcIiByb3cgaXMgYWxzbyBmb3VuZCBieSB0aGUgVFlQIG5hbWUgaXQgc2hvd3MsIHNvIFwiT1JHQVwiXG4gIC8vIHR5cGVkIGluIHRoZSBUWVAtUGlja2VyIGJyaW5ncyBpdCBiYWNrIHRvIHRoZSB0b3AuXG4gIGdldEl0ZW1UZXh0KGl0ZW0pIHtcbiAgICByZXR1cm4gaXRlbS5ub25lID8gYCR7dGhpcy50eXB9ICR7aXRlbS50eXB9YCA6IHN1cGVyLmdldEl0ZW1UZXh0KGl0ZW0pO1xuICB9XG5cbiAgcmVuZGVyU3VnZ2VzdGlvbihtYXRjaCwgZWwpIHtcbiAgICBjb25zdCBpdGVtID0gbWF0Y2guaXRlbTtcbiAgICBjb25zdCBtYXRjaGVzID0gbWF0Y2gubWF0Y2g/Lm1hdGNoZXMgPz8gW107XG4gICAgZWwuYWRkQ2xhc3MoXCJ0eXAtcGlja2VyLXN1Z2dlc3Rpb25cIik7XG4gICAgaWYgKGl0ZW0ubm9uZSkge1xuICAgICAgLy8gXCJPUkdBIChubyBTdWJ0eXApXCI6IHRoZSBUWVAgaW4gaXRzIGNvbG9yLCB0aGUgc3VmZml4IGluIG5vcm1hbCB0ZXh0XG4gICAgICAvLyBjb2xvciByYXRoZXIgdGhhbiBtdXRlZCAtIGl0IGlzIGEgcmVhbCBjaG9pY2UsIG5vdCBhIGdyYXllZC1vdXRcbiAgICAgIC8vIG5vbi1jaG9pY2UsIGFuZCBpdCBzdGFuZHMgYXBhcnQgZnJvbSB0aGUgU3VidHlwIHJvd3MgYmVsb3cuIFRoZVxuICAgICAgLy8gc2VhcmNoIHRleHQgaXMgXCJPUkdBIG5vIFN1YnR5cFwiIChzZWUgZ2V0SXRlbVRleHQpLCBzbyB0aGUgc3VmZml4XG4gICAgICAvLyBzdGFydHMgb25lIGNoYXJhY3RlciBhZnRlciB0aGUgVFlQIG5hbWUuXG4gICAgICB0aGlzLnJlbmRlckNvbG9yZWROYW1lKGVsLCB0aGlzLnR5cCwgdGhpcy50eXAsIG51bGwsIG1hdGNoZXMpO1xuICAgICAgY29uc3Qgbm9uZUVsID0gZWwuY3JlYXRlU3Bhbih7IGNsczogXCJ0eXAtcGlja2VyLW5vbmVcIiB9KTtcbiAgICAgIG5vbmVFbC5hcHBlbmRUZXh0KFwiKFwiKTtcbiAgICAgIGhpZ2hsaWdodChub25lRWwsIGl0ZW0udHlwLCBtYXRjaGVzLCB0aGlzLnR5cC5sZW5ndGggKyAxKTtcbiAgICAgIG5vbmVFbC5hcHBlbmRUZXh0KFwiKVwiKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5yZW5kZXJDb2xvcmVkTmFtZShlbCwgaXRlbS50eXAsIHRoaXMudHlwLCBpdGVtLnR5cCwgbWF0Y2hlcyk7XG4gICAgfVxuICAgIGVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwidHlwLXBpY2tlci1jb3VudFwiLCB0ZXh0OiBTdHJpbmcoaXRlbS5jb3VudCkgfSk7XG4gIH1cblxuICBvbkNob29zZUl0ZW0oaXRlbSkge1xuICAgIHRoaXMucmVzb2x2ZShpdGVtLm5vbmUgPyBcIlwiIDogaXRlbS50eXApO1xuICB9XG59XG5cbi8vIFRZUC1QaWNrZXIgd2l0aCBlYWNoIFN1YnR5cCBpbmRlbnRlZCBiZWxvdyBpdHMgVFlQICh0aGUgZGVmYXVsdCB3aGlsZVxuLy8gXCJTZXBhcmF0ZSBTdWJ0eXAtUGlja2VyXCIgaXMgb2ZmLCBzZWUgcGlja1R5cEFuZFN1YnR5cCkuIFRoZSBUWVAgcm93IGl0c2VsZlxuLy8gbWVhbnMgXCJubyBTdWJ0eXBcIi4gU2VhcmNoIHdvcmtzIHBlciBncm91cCBzbyBhIFN1YnR5cCBuZXZlciBhcHBlYXJzIHdpdGhvdXRcbi8vIGl0cyBUWVA6IGEgVFlQIG1hdGNoIGtlZXBzIGFsbCBpdHMgU3VidHlwcywgYSBTdWJ0eXAgbWF0Y2gga2VlcHMgdGhhdCBTdWJ0eXBcbi8vIHdpdGggaXRzIFRZUC4gR3JvdXBzIHNvcnQgYnkgdGhlaXIgYmVzdCBtYXRjaDsgd2l0aGluIGEgZ3JvdXAgYmxvY2sgb3JkZXJcbi8vIHN0YXlzLlxuY2xhc3MgVHlwU3VidHlwUGlja2VyTW9kYWwgZXh0ZW5kcyBUeXBQaWNrZXJNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKGFwcCwgcGx1Z2luLCBncm91cHMsIHJlc29sdmUpIHtcbiAgICBzdXBlcihhcHAsIHBsdWdpbiwgZ3JvdXBzLm1hcCgoZ3JvdXApID0+IGdyb3VwLml0ZW0pLCByZXNvbHZlKTtcbiAgICB0aGlzLmdyb3VwcyA9IGdyb3VwcztcbiAgICB0aGlzLnNldFBsYWNlaG9sZGVyKFwiQ2hvb3NlIFRZUCBvciBTdWJ0eXBcdTIwMjZcIik7XG4gIH1cblxuICBnZXRTdWdnZXN0aW9ucyhxdWVyeSkge1xuICAgIGNvbnN0IHNlYXJjaCA9IHF1ZXJ5LnRyaW0oKSA/IHByZXBhcmVGdXp6eVNlYXJjaChxdWVyeS50cmltKCkpIDogbnVsbDtcbiAgICBjb25zdCBub01hdGNoID0geyBzY29yZTogMCwgbWF0Y2hlczogW10gfTtcbiAgICBjb25zdCByZXN1bHRzID0gW107XG4gICAgZm9yIChjb25zdCB7IGl0ZW0sIHN1YnR5cHMgfSBvZiB0aGlzLmdyb3Vwcykge1xuICAgICAgY29uc3QgdHlwTWF0Y2ggPSBzZWFyY2ggPyBzZWFyY2godGhpcy5nZXRJdGVtVGV4dChpdGVtKSkgOiBub01hdGNoO1xuICAgICAgbGV0IHN1YnR5cE1hdGNoZXMgPSBzdWJ0eXBzLm1hcCgoc3VidHlwKSA9PiAoeyBpdGVtOiBzdWJ0eXAsIG1hdGNoOiBzZWFyY2ggPyBzZWFyY2goc3VidHlwLnN1YnR5cCkgOiBub01hdGNoIH0pKTtcbiAgICAgIGlmICghdHlwTWF0Y2gpIHN1YnR5cE1hdGNoZXMgPSBzdWJ0eXBNYXRjaGVzLmZpbHRlcigoZW50cnkpID0+IGVudHJ5Lm1hdGNoKTtcbiAgICAgIGlmICghdHlwTWF0Y2ggJiYgc3VidHlwTWF0Y2hlcy5sZW5ndGggPT09IDApIGNvbnRpbnVlO1xuXG4gICAgICBjb25zdCBzY29yZXMgPSBbdHlwTWF0Y2gsIC4uLnN1YnR5cE1hdGNoZXMubWFwKChlbnRyeSkgPT4gZW50cnkubWF0Y2gpXS5maWx0ZXIoQm9vbGVhbikubWFwKChtYXRjaCkgPT4gbWF0Y2guc2NvcmUpO1xuICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgc2NvcmU6IE1hdGgubWF4KC4uLnNjb3JlcyksXG4gICAgICAgIHJvd3M6IFt7IGl0ZW0sIG1hdGNoOiB0eXBNYXRjaCA/PyBub01hdGNoIH0sIC4uLnN1YnR5cE1hdGNoZXMubWFwKChlbnRyeSkgPT4gKHsgaXRlbTogZW50cnkuaXRlbSwgbWF0Y2g6IGVudHJ5Lm1hdGNoID8/IG5vTWF0Y2ggfSkpXSxcbiAgICAgIH0pO1xuICAgIH1cbiAgICBpZiAoc2VhcmNoKSByZXN1bHRzLnNvcnQoKGEsIGIpID0+IGIuc2NvcmUgLSBhLnNjb3JlKTtcbiAgICByZXR1cm4gcmVzdWx0cy5mbGF0TWFwKChncm91cCkgPT4gZ3JvdXAucm93cyk7XG4gIH1cblxuICByZW5kZXJTdWdnZXN0aW9uKG1hdGNoLCBlbCkge1xuICAgIGNvbnN0IGl0ZW0gPSBtYXRjaC5pdGVtO1xuICAgIGlmICghaXRlbS5zdWJ0eXApIHtcbiAgICAgIHN1cGVyLnJlbmRlclN1Z2dlc3Rpb24obWF0Y2gsIGVsKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZWwuYWRkQ2xhc3MoXCJ0eXAtcGlja2VyLXN1Z2dlc3Rpb25cIiwgXCJ0eXAtcGlja2VyLXN1YnR5cFwiKTtcbiAgICAvLyBNYXRjaGVkIGFnYWluc3QgdGhlIFN1YnR5cCBuYW1lIGFsb25lIChzZWUgZ2V0U3VnZ2VzdGlvbnMpLlxuICAgIHRoaXMucmVuZGVyQ29sb3JlZE5hbWUoZWwsIGl0ZW0uc3VidHlwLCBpdGVtLnR5cCwgaXRlbS5zdWJ0eXAsIG1hdGNoLm1hdGNoPy5tYXRjaGVzID8/IFtdKTtcbiAgICBlbC5jcmVhdGVTcGFuKHsgY2xzOiBcInR5cC1waWNrZXItY291bnRcIiwgdGV4dDogU3RyaW5nKGl0ZW0uY291bnQpIH0pO1xuICB9XG5cbiAgb25DaG9vc2VJdGVtKGl0ZW0pIHtcbiAgICB0aGlzLnJlc29sdmUoeyB0eXA6IGl0ZW0udHlwLCBzdWJ0eXA6IGl0ZW0uc3VidHlwID8/IG51bGwgfSk7XG4gIH1cbn1cblxuLy8gSW5pdGlhbCBvcmRlciBvZiBhIHBpY2tlciBsaXN0IGdpdmVuIGFuIGFscmVhZHkgdHlwZWQgcXVlcnkgKGZyb20gdGhlXG4vLyBUWVAtUGlja2VyLCBzZWUgcGlja1R5cEVudHJ5KTogbWF0Y2hlcyBmaXJzdCBieSBzY29yZSwgdGhlIHJlc3QgYWZ0ZXIgaW5cbi8vIHVuY2hhbmdlZCBvcmRlci4gSWYgbm90aGluZyBtYXRjaGVzIChhIGRlc2NyaXB0aW9uIHdhcyB0eXBlZCwgc2F5KSB0aGVcbi8vIGxpc3Qgc3RheXMgYXMgaXQgd2FzLiBUeXBpbmcgaW4gdGhlIHBpY2tlciBpdHNlbGYgdXNlcyBPYnNpZGlhbidzIHNlYXJjaC5cbmZ1bmN0aW9uIHNvcnRCeVF1ZXJ5KGl0ZW1zLCBxdWVyeSwgaXRlbVRleHQpIHtcbiAgY29uc3Qgc2VhcmNoID0gcXVlcnk/LnRyaW0oKSA/IHByZXBhcmVGdXp6eVNlYXJjaChxdWVyeS50cmltKCkpIDogbnVsbDtcbiAgaWYgKCFzZWFyY2gpIHJldHVybiBpdGVtcztcbiAgY29uc3Qgc2NvcmVkID0gaXRlbXMubWFwKChpdGVtLCBpbmRleCkgPT4gKHsgaXRlbSwgaW5kZXgsIHNjb3JlOiBzZWFyY2goaXRlbVRleHQoaXRlbSkpPy5zY29yZSA/PyBudWxsIH0pKTtcbiAgaWYgKHNjb3JlZC5ldmVyeSgoZW50cnkpID0+IGVudHJ5LnNjb3JlID09PSBudWxsKSkgcmV0dXJuIGl0ZW1zO1xuICBzY29yZWQuc29ydCgoYSwgYikgPT4ge1xuICAgIGlmIChhLnNjb3JlID09PSBudWxsIHx8IGIuc2NvcmUgPT09IG51bGwpIHJldHVybiBhLnNjb3JlID09PSBiLnNjb3JlID8gYS5pbmRleCAtIGIuaW5kZXggOiBhLnNjb3JlID09PSBudWxsID8gMSA6IC0xO1xuICAgIHJldHVybiBiLnNjb3JlIC0gYS5zY29yZSB8fCBhLmluZGV4IC0gYi5pbmRleDtcbiAgfSk7XG4gIHJldHVybiBzY29yZWQubWFwKChlbnRyeSkgPT4gZW50cnkuaXRlbSk7XG59XG5cbi8vIEZvciBUWVAuanM6IG9wZW5zIHRoZSBTdWJ0eXAtUGlja2VyIGlmIHRoZSBUWVAgaGFzIGF0IGxlYXN0IG9uZSByZWdpc3RlcmVkXG4vLyBTdWJ0eXAgKGluIGJsb2NrIG9yZGVyKS4gcXVlcnkgcHJlLXNvcnRzIHRoZSBsaXN0OiB0eXBpbmcgXCJMZWhydmVyYW5zdGFsdHVuZ1wiXG4vLyB0byByZWFjaCBPUkdBIG1lYW50IHRoYXQgU3VidHlwLCB3aGljaCB0aGVuIHNpdHMgb24gdG9wIC0gRW50ZXIgc3VmZmljZXMuXG4vLyBvcHRpb25zIGFzIGluIGdldFN1YnR5cHM6IFN1YnR5cHMgdGhhdCBhcmVuJ3QgbWFudWFsbHkgY3JlYXRhYmxlIGFyZSBsZWZ0XG4vLyBvdXQgYnkgZGVmYXVsdCwgbGlrZSBzdWNoIFRZUCBlbnRyaWVzIGJlZm9yZS4gUmVzb2x2ZXMgd2l0aFxuLy8gIC0gdGhlIGNob3NlbiBTdWJ0eXAsXG4vLyAgLSBcIlwiIGZvciBcIm5vIFN1YnR5cFwiICh0aGUgZmlyc3Qgcm93IHdpdGhvdXQgYSBxdWVyeSkgLSBvciByaWdodCBhd2F5LFxuLy8gICAgd2l0aG91dCBhIHBpY2tlciwgaWYgdGhlIFRZUCBoYXMgbm8gc2VsZWN0YWJsZSBTdWJ0eXAsXG4vLyAgLSBudWxsIG9uIEVTQyAoVFlQLmpzIGdvZXMgYmFjayB0byB0aGUgVFlQIGNob2ljZSkuXG5mdW5jdGlvbiBwaWNrU3VidHlwKGFwcCwgcGx1Z2luLCB0eXAsIHF1ZXJ5ID0gXCJcIiwgb3B0aW9ucyA9IHt9KSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgIGNvbnN0IGl0ZW1zID0gcGx1Z2luLmdldFN1YnR5cHModHlwLCBvcHRpb25zKS5tYXAoKHsgc3VidHlwLCBjb3VudCB9KSA9PiAoeyB0eXA6IHN1YnR5cCwgZGVzY3JpcHRpb246IFwiXCIsIGNvdW50IH0pKTtcbiAgICBpZiAoaXRlbXMubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXNvbHZlKFwiXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICAvLyBcIm5vIFN1YnR5cFwiIGZpcnN0OiBFbnRlciBwaWNrcyBpdCB3aXRob3V0IHR5cGluZywgYW5kIGl0IGlzIG1vcmUgY29tbW9uXG4gICAgLy8gdGhhbiBhbnkgc2luZ2xlIFN1YnR5cC5cbiAgICBjb25zdCBub25lQ291bnQgPSBwbHVnaW4udHlwSW5kZXguc3VidHlwQnVja2V0KHR5cCkubm9TdWJ0eXA7XG4gICAgaXRlbXMudW5zaGlmdCh7IHR5cDogXCJubyBTdWJ0eXBcIiwgZGVzY3JpcHRpb246IFwiXCIsIGNvdW50OiBub25lQ291bnQsIG5vbmU6IHRydWUgfSk7XG4gICAgbmV3IFN1YnR5cFBpY2tlck1vZGFsKGFwcCwgcGx1Z2luLCB0eXAsIGl0ZW1zLCByZXNvbHZlLCBxdWVyeSkub3BlbigpO1xuICB9KTtcbn1cblxuLy8gVFlQIHZhbHVlcyB0aGF0IG9jY3VyIGluIG5vdGVzIGJ1dCBhcmVuJ3QgaW4gc2V0dGluZ3MudHlwcywgbGlrZSB0aGVcbi8vIHVucmVnaXN0ZXJlZCByb3dzIG9mIHRoZSBUWVAtTGlzdC4gTGlzdHMgYW5kIHBhZGRlZCB2YWx1ZXMgKHNlZSBpc0NsZWFuS2V5KVxuLy8gYXJlIGxlZnQgb3V0OiB0aGUgY2hvc2VuIHZhbHVlIGlzIHdyaXR0ZW4gaW50byBhIG5ldyBub3RlIGFuZCBzaG91bGRuJ3QgYmUgYVxuLy8gY2xlYW51cCBjYXNlIHRoZXJlLlxuZnVuY3Rpb24gdW5yZWdpc3RlcmVkSXRlbXMoYXBwLCBwbHVnaW4pIHtcbiAgY29uc3QgcmVnaXN0ZXJlZCA9IG5ldyBTZXQocGx1Z2luLnNldHRpbmdzLnR5cHMpO1xuICBjb25zdCB7IGNvdW50cyB9ID0gcGx1Z2luLnR5cEluZGV4LnR5cENvdW50cygpO1xuICBjb25zdCBzb3J0T3JkZXIgPSBwbHVnaW4uc2V0dGluZ3MudHlwU29ydE9yZGVyID8/IERFRkFVTFRfU09SVF9PUkRFUjtcbiAgcmV0dXJuIFsuLi5jb3VudHMua2V5cygpXVxuICAgIC5maWx0ZXIoKHR5cCkgPT4gIXJlZ2lzdGVyZWQuaGFzKHR5cCkgJiYgcGx1Z2luLnR5cEluZGV4LmlzQ2xlYW5LZXkodHlwKSlcbiAgICAuc29ydCgoYSwgYikgPT4gY29tcGFyZVR5cHMoc29ydE9yZGVyLCBhLCBiLCBjb3VudHMsIHBsdWdpbi5zZXR0aW5ncy50eXBDb2xvcnMpKVxuICAgIC5tYXAoKHR5cCkgPT4gKHsgdHlwLCBkZXNjcmlwdGlvbjogXCJcIiwgY291bnQ6IGNvdW50cy5nZXQodHlwKSA/PyAwLCB1bnJlZ2lzdGVyZWQ6IHRydWUgfSkpO1xufVxuXG4vLyBQaWNrcyBhIHNpbmdsZSBUWVAsIGZvciBUWVAuanMgYW5kIGV2ZXJ5d2hlcmUgaW4gdGhlIHBsdWdpbi4gaW5jbHVkZU1hbnVhbE9mZlxuLy8gYXMgaW4gZ2V0VHlwcygpOyBpbmNsdWRlVW5yZWdpc3RlcmVkIGFkZHMgdmFsdWVzIHRoYXQgb2NjdXIgaW4gbm90ZXMgYnV0XG4vLyBhcmVuJ3QgcmVnaXN0ZXJlZCAobXV0ZWQpLiBzaG93U3VidHlwcyBwdXRzIHRoZSBTdWJ0eXAgbmFtZXMgYWZ0ZXIgdGhlIFRZUFxuLy8gbmFtZSwgZm9yIHRoZSBzZXBhcmF0ZSBmbG93IHdoZXJlIHRoZSBTdWJ0eXAtUGlja2VyIGNvbWVzIGFmdGVyd2FyZHMuXG4vLyBSZXNvbHZlcyB3aXRoIHRoZSBUWVAsIG9yIG51bGwgb24gY2FuY2VsIG9yIGlmIHRoZXJlIGlzIG5vdGhpbmcgdG8gc2hvdy5cbmZ1bmN0aW9uIHBpY2tUeXAoYXBwLCBwbHVnaW4sIG9wdGlvbnMgPSB7fSkge1xuICByZXR1cm4gcGlja1R5cEVudHJ5KGFwcCwgcGx1Z2luLCBvcHRpb25zKS50aGVuKChlbnRyeSkgPT4gZW50cnk/LnR5cCA/PyBudWxsKTtcbn1cblxuLy8gTGlrZSBwaWNrVHlwLCBidXQgcmVzb2x2ZXMgd2l0aCB7IHR5cCwgcXVlcnkgfSwgcXVlcnkgYmVpbmcgd2hhdCB3YXMgdHlwZWQuXG4vLyBPbmx5IGZvciBwaWNrVHlwQW5kU3VidHlwLCB3aGljaCBwYXNzZXMgaXQgb24gdG8gdGhlIFN1YnR5cC1QaWNrZXIuXG5mdW5jdGlvbiBwaWNrVHlwRW50cnkoYXBwLCBwbHVnaW4sIG9wdGlvbnMgPSB7fSkge1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICBjb25zdCBpdGVtcyA9IHR5cEl0ZW1zKGFwcCwgcGx1Z2luLCBvcHRpb25zKTtcbiAgICBpZiAoIWl0ZW1zKSB7XG4gICAgICByZXNvbHZlKG51bGwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBtb2RhbCA9IG5ldyBUeXBQaWNrZXJNb2RhbChhcHAsIHBsdWdpbiwgaXRlbXMsICh0eXApID0+IHJlc29sdmUodHlwID09PSBudWxsID8gbnVsbCA6IHsgdHlwLCBxdWVyeTogbW9kYWwucXVlcnkgfSkpO1xuICAgIG1vZGFsLm9wZW4oKTtcbiAgfSk7XG59XG5cbi8vIFNoYXJlZCBUWVAgbGlzdCBmb3IgcGlja1R5cC9waWNrVHlwQW5kU3VidHlwOyBudWxsIHBsdXMgYSBub3RpY2UgaWYgdGhlcmUgaXNcbi8vIG5vdGhpbmcgdG8gc2hvdyB3aXRoIHRoZXNlIG9wdGlvbnMuXG5mdW5jdGlvbiB0eXBJdGVtcyhhcHAsIHBsdWdpbiwgeyBpbmNsdWRlTWFudWFsT2ZmID0gZmFsc2UsIGluY2x1ZGVVbnJlZ2lzdGVyZWQgPSBmYWxzZSwgc2hvd1N1YnR5cHMgPSBmYWxzZSB9ID0ge30pIHtcbiAgY29uc3QgaXRlbXMgPSBwbHVnaW4uZ2V0VHlwcyh7IGluY2x1ZGVNYW51YWxPZmYgfSkubWFwKChpdGVtKSA9PiAoeyAuLi5pdGVtLCB1bnJlZ2lzdGVyZWQ6IGZhbHNlIH0pKTtcbiAgaWYgKGluY2x1ZGVVbnJlZ2lzdGVyZWQpIGl0ZW1zLnB1c2goLi4udW5yZWdpc3RlcmVkSXRlbXMoYXBwLCBwbHVnaW4pKTtcbiAgLy8gT25seSByZWdpc3RlcmVkIFRZUCBlbnRyaWVzIGhhdmUgU3VidHlwczsgdGhlIG90aGVycyBzdGF5IHVuY2hhbmdlZC5cbiAgaWYgKHNob3dTdWJ0eXBzKSB7XG4gICAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSBpdGVtLnN1YnR5cHMgPSBwbHVnaW4uZ2V0U3VidHlwcyhpdGVtLnR5cCwgeyBpbmNsdWRlTWFudWFsT2ZmIH0pLm1hcCgoeyBzdWJ0eXAgfSkgPT4gc3VidHlwKTtcbiAgfVxuICBpZiAoaXRlbXMubGVuZ3RoID4gMCkgcmV0dXJuIGl0ZW1zO1xuICBuZXcgTm90aWNlKFwiTm8gVFlQIGF2YWlsYWJsZS5cIik7XG4gIHJldHVybiBudWxsO1xufVxuXG4vLyBGb3IgVFlQLmpzOiBUWVAgYW5kIFN1YnR5cCBpbiBvbmUgZ28uIFdpdGggc2VwYXJhdGVTdWJ0eXBQaWNrZXIgb2ZmLCBvbmVcbi8vIHBpY2tlciB3aXRoIGVhY2ggU3VidHlwIGluZGVudGVkIGJlbG93IGl0cyBUWVA7IHdpdGggaXQgb24sIGZpcnN0IHRoZVxuLy8gVFlQLVBpY2tlciAoU3VidHlwIG5hbWVzIGFmdGVyIHRoZSBUWVAgbmFtZSkgYW5kIHRoZW4sIGlmIHRoZXJlIGlzIGFcbi8vIHNlbGVjdGFibGUgU3VidHlwLCB0aGUgU3VidHlwLVBpY2tlciBwcmUtc29ydGVkIGJ5IHRoZSBxdWVyeSAoRVNDIGdvZXMgYmFja1xuLy8gdG8gdGhlIFRZUCBjaG9pY2UpLiBpbmNsdWRlTWFudWFsT2ZmIGFsc28gYXBwbGllcyB0byB0aGUgU3VidHlwcy5cbi8vIFJlc29sdmVzIHdpdGggeyB0eXAsIHN1YnR5cCB9IChzdWJ0eXAgbnVsbCBmb3IgXCJubyBTdWJ0eXBcIiksIG9yIG51bGwgb25cbi8vIGNhbmNlbC5cbmFzeW5jIGZ1bmN0aW9uIHBpY2tUeXBBbmRTdWJ0eXAoYXBwLCBwbHVnaW4sIG9wdGlvbnMgPSB7fSkge1xuICBpZiAocGx1Z2luLnNldHRpbmdzLnNlcGFyYXRlU3VidHlwUGlja2VyKSB7XG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIGNvbnN0IGVudHJ5ID0gYXdhaXQgcGlja1R5cEVudHJ5KGFwcCwgcGx1Z2luLCB7IC4uLm9wdGlvbnMsIHNob3dTdWJ0eXBzOiB0cnVlIH0pO1xuICAgICAgaWYgKCFlbnRyeSkgcmV0dXJuIG51bGw7XG4gICAgICBjb25zdCBzdWJ0eXAgPSBhd2FpdCBwaWNrU3VidHlwKGFwcCwgcGx1Z2luLCBlbnRyeS50eXAsIGVudHJ5LnF1ZXJ5LCBvcHRpb25zKTtcbiAgICAgIGlmIChzdWJ0eXAgIT09IG51bGwpIHJldHVybiB7IHR5cDogZW50cnkudHlwLCBzdWJ0eXA6IHN1YnR5cCB8fCBudWxsIH07XG4gICAgfVxuICB9XG5cbiAgY29uc3QgaXRlbXMgPSB0eXBJdGVtcyhhcHAsIHBsdWdpbiwgb3B0aW9ucyk7XG4gIGlmICghaXRlbXMpIHJldHVybiBudWxsO1xuICBjb25zdCBncm91cHMgPSBpdGVtcy5tYXAoKGl0ZW0pID0+ICh7XG4gICAgaXRlbSxcbiAgICBzdWJ0eXBzOiBwbHVnaW4uZ2V0U3VidHlwcyhpdGVtLnR5cCwgb3B0aW9ucykubWFwKCh7IHN1YnR5cCwgY291bnQgfSkgPT4gKHsgdHlwOiBpdGVtLnR5cCwgc3VidHlwLCBjb3VudCB9KSksXG4gIH0pKTtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiBuZXcgVHlwU3VidHlwUGlja2VyTW9kYWwoYXBwLCBwbHVnaW4sIGdyb3VwcywgcmVzb2x2ZSkub3BlbigpKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7IHBpY2tUeXAsIHBpY2tTdWJ0eXAsIHBpY2tUeXBBbmRTdWJ0eXAgfTtcbiIsICJjb25zdCB7IFRGaWxlLCBWYXVsdCwgZGVib3VuY2UsIG5vcm1hbGl6ZVBhdGggfSA9IHJlcXVpcmUoXCJvYnNpZGlhblwiKTtcblxuLy8gT25seSBUZW1wbGF0ZXIgc2NyaXB0cyB3aXRoIHRoaXMgbWFya2VyIGluIGEgY29tbWVudCBhcmUgb2ZmZXJlZCBpbiB0aGVcbi8vIHNob3J0Y3V0IHBpY2tlcjsgaGVscGVyIHNjcmlwdHMgbWFrZSBubyBzZW5zZSBhcyBzaG9ydGN1dHMuIFRoZSB0ZXh0IGFmdGVyXG4vLyB0aGUgbWFya2VyIHVwIHRvIHRoZSBsaW5lIGVuZCBpcyB0aGUgZGVzY3JpcHRpb24gKGEgY2xvc2luZyBcIiovXCIgaXMgbm90XG4vLyBwYXJ0IG9mIGl0KS5cbi8vXG4vLyBBbiBvcHRpb25hbCBwYXJhbWV0ZXIgbGlzdCBpbiBwYXJlbnRoZXNlcyByaWdodCBhZnRlciB0aGUgbWFya2VyIGRlc2NyaWJlc1xuLy8gdGhlIENPTVBMRVRFIGFyZ3VtZW50IGxpc3QgYWZ0ZXIgXCJ0cFwiLCBpbmNsdWRpbmcgd2hlcmUgdGhlIHNjcmlwdCB3YW50cyB0aGVcbi8vIGZpbGUgb3IgY29udGV4dCAoc2VlIFJFU0VSVkVEX1BBUkFNUyBpbiBzaG9ydGN1dHMuanMpOlxuLy8gICAvLyBAdHlwLXNob3J0Y3V0KGZvbGRlciwgeWVhcikgICAgICAtPiBmKHRwLCBcIkxpdGVyYXR1clwiLCAyMDI0KVxuLy8gICAvLyBAdHlwLXNob3J0Y3V0KG5ld0ZpbGUsIHllYXIpICAgICAtPiBmKHRwLCBuZXdGaWxlLCAyMDI0KVxuLy8gICAvLyBAdHlwLXNob3J0Y3V0KHByb3BlcnR5KSAgICAgICAgICAtPiBmKHRwLCBcIkZhbWlsaWVcIilcbi8vICAgLy8gQHR5cC1zaG9ydGN1dCAgICAgICAgICAgICAgICAgICAgLT4gZih0cCwgbmV3RmlsZSwgY3R4KVxuLy8gTm8gcGFyZW50aGVzZXMgKHBhcmFtcyA9PT0gbnVsbCkgaXMgdGhlIGNsYXNzaWMgY2FsbCBmKHRwLCBuZXdGaWxlLCBjdHgpO1xuLy8gZW1wdHkgcGFyZW50aGVzZXMgKHBhcmFtcyA9PT0gW10pIHBhc3Mgb25seSB0cC5cbi8vXG4vLyBUaGUgbWFya2VyIG11c3Qgc3RhcnQgdGhlIGNvbW1lbnQuIEFsbG93aW5nIHRleHQgYmVmb3JlIGl0IG9uY2UgdHVybmVkXG4vLyBUWVAuanMgaW50byBhIHNob3J0Y3V0LCBqdXN0IGJlY2F1c2UgaXRzIGhlYWRlciBjb21tZW50IG1lbnRpb25zIHRoZSBtYXJrZXIuXG4vLyBcIlxcYlwiIGFmdGVyIHRoZSBuYW1lIHJlamVjdHMgXCJAdHlwLXNob3J0Y3V0WFlaXCIgYnV0IGFsbG93cyB0aGUgXCIoXCIuXG5jb25zdCBTSE9SVENVVF9NQVJLRVIgPSAvXlsgXFx0XSooPzpcXC9cXC8rfFxcL1xcKit8XFwqKVsgXFx0XSpAdHlwLXNob3J0Y3V0XFxiKD86XFwoKFteKV0qKVxcKSk/WyBcXHRdKiguKj8pWyBcXHRdKig/OlxcKlxcLyk/WyBcXHRdKiQvbTtcblxuLy8gUGFyYW1ldGVyIG5hbWVzIGZyb20gdGhlIG1hcmtlciwgaW4gZGVjbGFyZWQgb3JkZXIuIEVtcHR5IGVudHJpZXMgKFwiKClcIiwgYVxuLy8gc3RyYXkgY29tbWEpIGFyZSBkcm9wcGVkLCBkdXBsaWNhdGVzIGtlcHQgb25jZSAtIHR3byBmaWVsZHMgd3JpdGluZyB0aGUgc2FtZVxuLy8gZW50cnkgd291bGQgb25seSBjb25mdXNlLlxuZnVuY3Rpb24gcGFyc2VQYXJhbXMocmF3KSB7XG4gIGNvbnN0IG5hbWVzID0gKHJhdyA/PyBcIlwiKVxuICAgIC5zcGxpdChcIixcIilcbiAgICAubWFwKChuYW1lKSA9PiBuYW1lLnRyaW0oKSlcbiAgICAuZmlsdGVyKChuYW1lKSA9PiBuYW1lICE9PSBcIlwiKTtcbiAgcmV0dXJuIFsuLi5uZXcgU2V0KG5hbWVzKV07XG59XG5cbi8vIEtlZXBzIHRoZSBsaXN0IG9mIG1hcmtlZCBUZW1wbGF0ZXIgc2NyaXB0cyBjdXJyZW50LiBJdCBpcyByZWFkIGFoZWFkIG9mIHRpbWVcbi8vIGFuZCB1cGRhdGVkIG9uIGNoYW5nZXMsIHNvIHRoZSBwaWNrZXIgb3BlbnMgd2l0aG91dCB3YWl0aW5nIGFuZCB3aXRob3V0IGZpbGVcbi8vIGFjY2Vzcy4gUmV0dXJucyBhbiBhY2Nlc3NvciBmb3IgdGhlIGxpc3QgKFt7IG5hbWUsIHBhcmFtcywgZGVzY3JpcHRpb24gfV0sXG4vLyBzb3J0ZWQgYnkgbmFtZSksIHdpdGggdHdvIGFkZGl0aW9ucyBmb3IgdGhlIFwic2NyaXB0IG5vdCBmb3VuZFwiIHdhcm5pbmcgb2Zcbi8vIHRoZSBwcm9wZXJ0eSByb3dzIChzZWUgcmVuZGVyU2hvcnRjdXRDb250cm9scyBpbiB0eXAtZnJvbnRtYXR0ZXItZWRpdG9yLmpzKTpcbi8vICAgYWNjZXNzb3IuaXNMb2FkZWQoKSAgIGZhbHNlIHVudGlsIHRoZSBmb2xkZXIgd2FzIHJlYWQgb25jZSAtIGJlZm9yZSB0aGF0XG4vLyAgICAgICAgICAgICAgICAgICAgICAgICBhbiBlbXB0eSBsaXN0IG1lYW5zIFwibm90IGtub3duIHlldFwiLCBub3QgXCJtaXNzaW5nXCIsXG4vLyAgICAgICAgICAgICAgICAgICAgICAgICBhbmQgbm8gcm93IG1heSB3YXJuXG4vLyAgIGFjY2Vzc29yLm9uQ2hhbmdlKGZuKSBmbiBydW5zIGFmdGVyIHRoZSBmaXJzdCByZWFkIGFuZCB3aGVuZXZlciB0aGUgbGlzdFxuLy8gICAgICAgICAgICAgICAgICAgICAgICAgY2hhbmdlZDsgcmV0dXJucyBhIGZ1bmN0aW9uIHRoYXQgdW5zdWJzY3JpYmVzXG5mdW5jdGlvbiByZWdpc3RlclNob3J0Y3V0U2NyaXB0cyhwbHVnaW4pIHtcbiAgY29uc3QgeyBhcHAgfSA9IHBsdWdpbjtcblxuICBsZXQgc2NyaXB0Rm9sZGVyID0gbnVsbDtcbiAgbGV0IHNjcmlwdHMgPSBbXTtcbiAgbGV0IGxvYWRlZCA9IGZhbHNlO1xuICBjb25zdCBsaXN0ZW5lcnMgPSBuZXcgU2V0KCk7XG5cbiAgY29uc3QgY3VycmVudFNjcmlwdEZvbGRlciA9ICgpID0+IHtcbiAgICBjb25zdCBmb2xkZXIgPSBhcHAucGx1Z2lucy5wbHVnaW5zW1widGVtcGxhdGVyLW9ic2lkaWFuXCJdPy5zZXR0aW5ncz8udXNlcl9zY3JpcHRzX2ZvbGRlcjtcbiAgICByZXR1cm4gZm9sZGVyID8gbm9ybWFsaXplUGF0aChmb2xkZXIpIDogbnVsbDtcbiAgfTtcblxuICBjb25zdCBpc0luU2NyaXB0Rm9sZGVyID0gKHBhdGgpID0+ICEhc2NyaXB0Rm9sZGVyICYmICEhcGF0aCAmJiBwYXRoLnN0YXJ0c1dpdGgoc2NyaXB0Rm9sZGVyICsgXCIvXCIpO1xuXG4gIC8vIExpa2UgVGVtcGxhdGVyOiBldmVyeSAuanMgaW4gdGhlIHNjcmlwdCBmb2xkZXIgaW5jbHVkaW5nIHN1YmZvbGRlcnMsXG4gIC8vIHNjcmlwdCBuYW1lID0gZmlsZSBuYW1lIHdpdGhvdXQgZXh0ZW5zaW9uLlxuICBhc3luYyBmdW5jdGlvbiByZWZyZXNoU2NyaXB0cygpIHtcbiAgICBjb25zdCBmb2xkZXJQYXRoID0gY3VycmVudFNjcmlwdEZvbGRlcigpO1xuICAgIHNjcmlwdEZvbGRlciA9IGZvbGRlclBhdGg7XG4gICAgY29uc3QgZm9sZGVyID0gZm9sZGVyUGF0aCA/IGFwcC52YXVsdC5nZXRGb2xkZXJCeVBhdGgoZm9sZGVyUGF0aCkgOiBudWxsO1xuICAgIGNvbnN0IGZpbGVzID0gW107XG4gICAgaWYgKGZvbGRlcikge1xuICAgICAgVmF1bHQucmVjdXJzZUNoaWxkcmVuKGZvbGRlciwgKGNoaWxkKSA9PiB7XG4gICAgICAgIGlmIChjaGlsZCBpbnN0YW5jZW9mIFRGaWxlICYmIGNoaWxkLmV4dGVuc2lvbiA9PT0gXCJqc1wiKSBmaWxlcy5wdXNoKGNoaWxkKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICBjb25zdCBmb3VuZCA9IFtdO1xuICAgIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgbWF0Y2ggPSAoYXdhaXQgYXBwLnZhdWx0LmNhY2hlZFJlYWQoZmlsZSkpLm1hdGNoKFNIT1JUQ1VUX01BUktFUik7XG4gICAgICAgIC8vIG1hdGNoWzFdIGlzIHVuZGVmaW5lZCB3aXRob3V0IHBhcmVudGhlc2VzIGFuZCBcIlwiIHdpdGggZW1wdHkgb25lcztcbiAgICAgICAgLy8gdGhhdCBkaWZmZXJlbmNlIGRlY2lkZXMgdGhlIGNhbGwgZm9ybS5cbiAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgZm91bmQucHVzaCh7XG4gICAgICAgICAgICBuYW1lOiBmaWxlLmJhc2VuYW1lLFxuICAgICAgICAgICAgcGFyYW1zOiBtYXRjaFsxXSA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IHBhcnNlUGFyYW1zKG1hdGNoWzFdKSxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBtYXRjaFsyXSA/PyBcIlwiLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYFRZUC1TeXN0ZW06IGNhbid0IHJlYWQgVGVtcGxhdGVyIHNjcmlwdCAke2ZpbGUucGF0aH1gLCBlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gRm9sZGVyIGNoYW5nZWQgaW4gVGVtcGxhdGVyIG1lYW53aGlsZTogZHJvcCB0aGlzIHJlc3VsdCwgdGhlIHJ1biBmb3IgdGhlXG4gICAgLy8gbmV3IGZvbGRlciBpcyBhbHJlYWR5IHNjaGVkdWxlZC5cbiAgICBpZiAoZm9sZGVyUGF0aCAhPT0gc2NyaXB0Rm9sZGVyKSByZXR1cm47XG4gICAgZm91bmQuc29ydCgoYSwgYikgPT4gYS5uYW1lLmxvY2FsZUNvbXBhcmUoYi5uYW1lKSk7XG4gICAgLy8gRWRpdGluZyBhIHNjcmlwdCB0cmlnZ2VycyBhIHJlc2NhbiB0b287IG9ubHkgYSByZWFsIGNoYW5nZSAoYSBzY3JpcHRcbiAgICAvLyBhZGRlZCwgcmVtb3ZlZCwgcmVuYW1lZCBvciBpdHMgbWFya2VyIGNoYW5nZWQpIGlzIHBhc3NlZCBvbi5cbiAgICBjb25zdCBjaGFuZ2VkID0gIWxvYWRlZCB8fCBKU09OLnN0cmluZ2lmeShmb3VuZCkgIT09IEpTT04uc3RyaW5naWZ5KHNjcmlwdHMpO1xuICAgIHNjcmlwdHMgPSBmb3VuZDtcbiAgICBsb2FkZWQgPSB0cnVlO1xuICAgIGlmICghY2hhbmdlZCkgcmV0dXJuO1xuICAgIGZvciAoY29uc3QgbGlzdGVuZXIgb2YgbGlzdGVuZXJzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBsaXN0ZW5lcigpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihcIlRZUC1TeXN0ZW06IHNob3J0Y3V0IHNjcmlwdCBsaXN0ZW5lciBmYWlsZWRcIiwgZXJyb3IpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGNvbnN0IHNjaGVkdWxlUmVmcmVzaCA9IGRlYm91bmNlKHJlZnJlc2hTY3JpcHRzLCAzMDAsIHRydWUpO1xuICBjb25zdCBvbkZpbGVDaGFuZ2UgPSAoZmlsZSwgb2xkUGF0aCkgPT4ge1xuICAgIGlmIChpc0luU2NyaXB0Rm9sZGVyKGZpbGU/LnBhdGgpIHx8IGlzSW5TY3JpcHRGb2xkZXIob2xkUGF0aCkpIHNjaGVkdWxlUmVmcmVzaCgpO1xuICB9O1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJjcmVhdGVcIiwgb25GaWxlQ2hhbmdlKSk7XG4gIHBsdWdpbi5yZWdpc3RlckV2ZW50KGFwcC52YXVsdC5vbihcIm1vZGlmeVwiLCBvbkZpbGVDaGFuZ2UpKTtcbiAgcGx1Z2luLnJlZ2lzdGVyRXZlbnQoYXBwLnZhdWx0Lm9uKFwiZGVsZXRlXCIsIG9uRmlsZUNoYW5nZSkpO1xuICBwbHVnaW4ucmVnaXN0ZXJFdmVudChhcHAudmF1bHQub24oXCJyZW5hbWVcIiwgb25GaWxlQ2hhbmdlKSk7XG4gIGFwcC53b3Jrc3BhY2Uub25MYXlvdXRSZWFkeShyZWZyZXNoU2NyaXB0cyk7XG5cbiAgY29uc3QgYWNjZXNzb3IgPSAoKSA9PiB7XG4gICAgLy8gVGVtcGxhdGVyIGZvbGRlciBjaGFuZ2VkOiByZWxvYWQgZm9yIHRoZSBuZXh0IGNhbGwsIGFuc3dlciB3aXRoIHRoZVxuICAgIC8vIGN1cnJlbnQgbGlzdCBmb3Igbm93LlxuICAgIGlmIChjdXJyZW50U2NyaXB0Rm9sZGVyKCkgIT09IHNjcmlwdEZvbGRlcikgc2NoZWR1bGVSZWZyZXNoKCk7XG4gICAgcmV0dXJuIHNjcmlwdHM7XG4gIH07XG4gIGFjY2Vzc29yLmlzTG9hZGVkID0gKCkgPT4gbG9hZGVkO1xuICBhY2Nlc3Nvci5vbkNoYW5nZSA9IChsaXN0ZW5lcikgPT4ge1xuICAgIGxpc3RlbmVycy5hZGQobGlzdGVuZXIpO1xuICAgIHJldHVybiAoKSA9PiBsaXN0ZW5lcnMuZGVsZXRlKGxpc3RlbmVyKTtcbiAgfTtcbiAgcmV0dXJuIGFjY2Vzc29yO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHsgcmVnaXN0ZXJTaG9ydGN1dFNjcmlwdHMsIFNIT1JUQ1VUX01BUktFUiwgcGFyc2VQYXJhbXMgfTtcbiIsICJjb25zdCB7IFBsdWdpbiB9ID0gcmVxdWlyZShcIm9ic2lkaWFuXCIpO1xuY29uc3QgeyBERUZBVUxUX1NFVFRJTkdTLCBUeXBTeXN0ZW1TZXR0aW5nVGFiIH0gPSByZXF1aXJlKFwiLi9zZXR0aW5nc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJDb21tYW5kcyB9ID0gcmVxdWlyZShcIi4vY29tbWFuZHNcIik7XG5jb25zdCB7IHJlZ2lzdGVyVHlwUGFuZSwgc29ydFR5cHNCeU1vZGUsIERFRkFVTFRfU09SVF9PUkRFUiB9ID0gcmVxdWlyZShcIi4vdHlwLXBhbmVcIik7XG5jb25zdCB7IFR5cEluZGV4LCBzZXRDYW5vbmljYWxQcm9wZXJ0eSwgZGVsZXRlUHJvcGVydHksIFRZUF9QUk9QRVJUWSwgU1VCVFlQX1BST1BFUlRZIH0gPSByZXF1aXJlKFwiLi90eXAtaW5kZXhcIik7XG5jb25zdCB7IGdldFN1YnR5cCwgZ2V0U3VidHlwTmFtZXMsIGlzU3VidHlwTWFudWFsIH0gPSByZXF1aXJlKFwiLi9zdWJ0eXBzXCIpO1xuY29uc3QgeyByZWdpc3RlckZpbGVFeHBsb3JlckNvbG9ycyB9ID0gcmVxdWlyZShcIi4vZmlsZS1leHBsb3Jlci1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyR3JhcGhDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL2dyYXBoLWNvbG9yc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJTZWFyY2hDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL3NlYXJjaC1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyUmVjZW50RmlsZXNDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL3JlY2VudC1maWxlcy1jb2xvcnNcIik7XG5jb25zdCB7IHJlZ2lzdGVyQmFja2xpbmtDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL2JhY2tsaW5rLWNvbG9yc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJCb29rbWFya3NDb2xvcnMgfSA9IHJlcXVpcmUoXCIuL2Jvb2ttYXJrLWNvbG9yc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJBY3RpdmVUaXRsZUNvbG9ycyB9ID0gcmVxdWlyZShcIi4vYWN0aXZlLXRpdGxlLWNvbG9yc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJMaW5rQ29sb3JzIH0gPSByZXF1aXJlKFwiLi9saW5rLWNvbG9yc1wiKTtcbmNvbnN0IHsgcmVnaXN0ZXJGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQgfSA9IHJlcXVpcmUoXCIuL2Zyb250bWF0dGVyLWRlZmF1bHQtaGlnaGxpZ2h0XCIpO1xuY29uc3QgeyByZWdpc3RlclByb3BlcnR5UmVuYW1lU3luYyB9ID0gcmVxdWlyZShcIi4vcHJvcGVydHktcmVuYW1lLXN5bmNcIik7XG5jb25zdCB7IHJlbW92ZVByb3BlcnR5TWVudVBhdGNoIH0gPSByZXF1aXJlKFwiLi90eXAtZnJvbnRtYXR0ZXItZWRpdG9yXCIpO1xuY29uc3QgeyBub3JtYWxpemVHbG9iYWxPcmRlciwgc29ydEZyb250bWF0dGVyRm9yLCBwbGFjZVByb3BlcnR5Rm9yIH0gPSByZXF1aXJlKFwiLi9mcm9udG1hdHRlci1zb3J0XCIpO1xuY29uc3QgeyByZXNvbHZlU2hvcnRjdXRzLCBzY3JpcHROYW1lT2YsIHJlc29sdmVDYWxsQXJncyB9ID0gcmVxdWlyZShcIi4vc2hvcnRjdXRzXCIpO1xuY29uc3Qge1xuICBwaWNrVHlwOiBwaWNrVHlwTW9kYWwsXG4gIHBpY2tTdWJ0eXA6IHBpY2tTdWJ0eXBNb2RhbCxcbiAgcGlja1R5cEFuZFN1YnR5cDogcGlja1R5cEFuZFN1YnR5cE1vZGFsLFxufSA9IHJlcXVpcmUoXCIuL3R5cC1waWNrZXJcIik7XG5jb25zdCB7IHJlZ2lzdGVyU2hvcnRjdXRTY3JpcHRzIH0gPSByZXF1aXJlKFwiLi9zaG9ydGN1dC1zY3JpcHRzXCIpO1xuY29uc3QgeyBjbGVhcklubGluZUNvbG9ycywgYWxsRG9jdW1lbnRzIH0gPSByZXF1aXJlKFwiLi90eXAtY29sb3JzXCIpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGNsYXNzIFR5cFN5c3RlbVBsdWdpbiBleHRlbmRzIFBsdWdpbiB7XG4gIGFzeW5jIG9ubG9hZCgpIHtcbiAgICAvLyBSZWFkIG9uY2UgaGVyZTogbm8gZGF0YS5qc29uIChsb2FkRGF0YSgpIHJlc29sdmVzIG51bGwpIG1lYW5zIHRoZSBwbHVnaW5cbiAgICAvLyBpcyBsb2FkZWQgZm9yIHRoZSB2ZXJ5IGZpcnN0IHRpbWUgaW4gdGhpcyB2YXVsdCwgYW5kIHRoZSBUWVAtUGFuZSBvcGVuc1xuICAgIC8vIG9uIGl0cyBvd24gb25jZSAoc2VlIHJlZ2lzdGVyVHlwUGFuZSkuXG4gICAgY29uc3QgZGF0YSA9IGF3YWl0IHRoaXMubG9hZERhdGEoKTtcbiAgICB0aGlzLmlzRmlyc3RSdW4gPSBkYXRhID09IG51bGw7XG4gICAgYXdhaXQgdGhpcy5sb2FkU2V0dGluZ3MoZGF0YSk7XG5cbiAgICAvLyBEaXNhYmxpbmcgdGhlIHBsdWdpbiB0YWtlcyBpdHMgaW5saW5lIGNvbG9ycyBvdXQgb2YgdGhlIGV4cGxvcmVyLFxuICAgIC8vIHNlYXJjaCwgUmVjZW50IEZpbGVzLCBiYWNrbGlua3MsIGJvb2ttYXJrcywgbm90ZSB0aXRsZXMgYW5kIFwiQWxsXG4gICAgLy8gcHJvcGVydGllc1wiIChzZWUgc2V0SW5saW5lQ29sb3IgaW4gdHlwLWNvbG9ycy5qcyk7IHRob3NlIHZpZXdzIHdvdWxkXG4gICAgLy8ga2VlcCB0aGVtIHVudGlsIHRoZXkgaGFwcGVuIHRvIHJlLXJlbmRlci4gUmVnaXN0ZXJlZCBmaXJzdCBzbyBpdCBydW5zXG4gICAgLy8gbGFzdCBvbiB1bmxvYWQsIGFmdGVyIHRoZSBtb2R1bGVzIGhhdmUgc3RvcHBlZCBvYnNlcnZpbmcgYW5kIGxpc3RlbmluZy5cbiAgICB0aGlzLnJlZ2lzdGVyKCgpID0+IHtcbiAgICAgIGZvciAoY29uc3QgZG9jIG9mIGFsbERvY3VtZW50cyh0aGlzLmFwcCkpIGNsZWFySW5saW5lQ29sb3JzKGRvYyk7XG4gICAgfSk7XG5cbiAgICAvLyBCZWZvcmUgYWxsIG90aGVyIG1vZHVsZXM6IHRoZXkgbGlzdGVuIHRvIGl0cyBcImNoYW5nZVwiIGV2ZW50IGFuZCByZWFkXG4gICAgLy8gVFlQL1NVQlRZUCBvbmx5IHRocm91Z2ggaXQgKHNlZSB0eXAtaW5kZXguanMpLlxuICAgIHRoaXMudHlwSW5kZXggPSBuZXcgVHlwSW5kZXgodGhpcyk7XG4gICAgdGhpcy50eXBJbmRleC5yZWdpc3RlcigpO1xuXG4gICAgcmVnaXN0ZXJDb21tYW5kcyh0aGlzKTtcbiAgICB0aGlzLmFkZFNldHRpbmdUYWIobmV3IFR5cFN5c3RlbVNldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcbiAgICAvLyBDYXJyaWVzIHJlbmFtZXMgZnJvbSBcIkFsbCBwcm9wZXJ0aWVzXCIvQmFzZXMgaW50byB0aGUgVFlQLUZyb250bWF0dGVyLlxuICAgIHJlZ2lzdGVyUHJvcGVydHlSZW5hbWVTeW5jKHRoaXMpO1xuICAgIC8vIFRoZSBUWVAtUGFuZSBwYXRjaGVzIHRoZSBwcm9wZXJ0eSBtZW51IGxhemlseSAoZW5zdXJlUHJvcGVydHlNZW51UGF0Y2gpLlxuICAgIHRoaXMucmVnaXN0ZXIocmVtb3ZlUHJvcGVydHlNZW51UGF0Y2gpO1xuICAgIC8vIEFjY2Vzc29yIGZvciB0aGUgVGVtcGxhdGVyIHNjcmlwdHMgbWFya2VkIFwiQHR5cC1zaG9ydGN1dFwiLCB1c2VkIGJ5IHRoZVxuICAgIC8vIHNob3J0Y3V0IHBpY2tlciBvZiB0aGUgcHJvcGVydHkgcm93cy5cbiAgICB0aGlzLmdldFNob3J0Y3V0U2NyaXB0cyA9IHJlZ2lzdGVyU2hvcnRjdXRTY3JpcHRzKHRoaXMpO1xuXG4gICAgLy8gS2VwdCBzZXBhcmF0ZSBmcm9tIHJlZnJlc2hGbnM6IGFmdGVyIG1vdW50aW5nIGl0cyBlZGl0b3JzIHRoZSBUWVAtUGFuZVxuICAgIC8vIG5lZWRzIG9ubHkgdGhpcyByZWZyZXNoIChib2xkIHByb3BlcnR5IG5hbWVzKS4gVGhlIHdob2xlXG4gICAgLy8gcmVmcmVzaFR5cENvbG9ycygpIGJ1bmRsZSB3b3VsZCBhbHNvIHRyaWdnZXIgdGhlIHZpZXcncyBvd24gcmUtcmVuZGVyIGFuZFxuICAgIC8vIHJlY3Vyc2UgaW50byBhIHN0YWNrIG92ZXJmbG93IG9uIGV2ZXJ5IFRZUCBvcGVuZWQuXG4gICAgdGhpcy5yZWZyZXNoRnJvbnRtYXR0ZXJIaWdobGlnaHQgPSByZWdpc3RlckZyb250bWF0dGVyRGVmYXVsdEhpZ2hsaWdodCh0aGlzKTtcblxuICAgIC8vIFR3byB2YXJpYW50cywgbGlrZSByZWZyZXNoRnJvbnRtYXR0ZXJIaWdobGlnaHQgYWJvdmU6XG4gICAgLy8gIC0gcmVmcmVzaFR5cENvbG9ycygpIHJlZnJlc2hlcyBldmVyeSB2aWV3LCB0aGUgVFlQLVBhbmUgaW5jbHVkZWRcbiAgICAvLyAgICAocmUtcmVuZGVyZWQgZnJvbSB0aGUgc2V0dGluZ3MpIC0gZm9yIGNoYW5nZXMgbWFkZSBlbHNld2hlcmUgKHNldHRpbmdzXG4gICAgLy8gICAgdGFiLCBwcm9wZXJ0eSByZW5hbWUgc3luYywgU3luYywgVW5kbykuXG4gICAgLy8gIC0gcmVmcmVzaFR5cENvbG9yc0V4Y2VwdCh2aWV3KSBsZWF2ZXMgdGhhdCBvbmUgVFlQLVBhbmUgb3V0IC0gZm9yIGl0c1xuICAgIC8vICAgIG93biBhY3Rpb25zLiBBIGZ1bGwgcmUtcmVuZGVyIHRoZXJlIHdvdWxkIHRocm93IGF3YXkgZm9jdXMsIGFuIG9wZW5cbiAgICAvLyAgICBpbmxpbmUgaW5wdXQgb3IgdGhlIGVkaXRvciBiZWluZyB0eXBlZCBpbiwgc28gdGhlIHBhbmUgdXBkYXRlcyBpdHNlbGZcbiAgICAvLyAgICBhbmQgY2FsbHMgcmVuZGVyKCkgb25seSB3aGVyZSBpdCByZWFsbHkgaGFzIHRvIHJlYnVpbGQuIE90aGVyXG4gICAgLy8gICAgVFlQLVBhbmUgbGVhdmVzIChyYXJlIC0gc2VlIGFjdGl2YXRlVHlwUGFuZSkgYXJlIHN0aWxsIHJlLXJlbmRlcmVkLlxuICAgIGNvbnN0IHJlZnJlc2hUeXBQYW5lID0gcmVnaXN0ZXJUeXBQYW5lKHRoaXMpO1xuICAgIGNvbnN0IHJlZnJlc2hGbnMgPSBbXG4gICAgICByZWdpc3RlckZpbGVFeHBsb3JlckNvbG9ycyh0aGlzKSxcbiAgICAgIHJlZ2lzdGVyR3JhcGhDb2xvcnModGhpcyksXG4gICAgICByZWdpc3RlclNlYXJjaENvbG9ycyh0aGlzKSxcbiAgICAgIHJlZ2lzdGVyUmVjZW50RmlsZXNDb2xvcnModGhpcyksXG4gICAgICByZWdpc3RlckJhY2tsaW5rQ29sb3JzKHRoaXMpLFxuICAgICAgcmVnaXN0ZXJCb29rbWFya3NDb2xvcnModGhpcyksXG4gICAgICByZWdpc3RlckFjdGl2ZVRpdGxlQ29sb3JzKHRoaXMpLFxuICAgICAgcmVnaXN0ZXJMaW5rQ29sb3JzKHRoaXMpLFxuICAgICAgdGhpcy5yZWZyZXNoRnJvbnRtYXR0ZXJIaWdobGlnaHQsXG4gICAgXTtcbiAgICB0aGlzLnJlZnJlc2hUeXBDb2xvcnNFeGNlcHQgPSAoZXhjZXB0VmlldykgPT4ge1xuICAgICAgcmVmcmVzaFR5cFBhbmUoZXhjZXB0Vmlldyk7XG4gICAgICByZWZyZXNoRm5zLmZvckVhY2goKGZuKSA9PiBmbigpKTtcbiAgICB9O1xuICAgIHRoaXMucmVmcmVzaFR5cENvbG9ycyA9ICgpID0+IHRoaXMucmVmcmVzaFR5cENvbG9yc0V4Y2VwdChudWxsKTtcblxuICAgIC8vIFN0eWxlIFNldHRpbmdzIHJlYWRzIHN0eWxlc2hlZXRzIHdoZW4gaXQgbG9hZHMgYW5kIGFmdGVyd2FyZHMgb25seSBvblxuICAgIC8vIFwiY3NzLWNoYW5nZVwiLCB3aGljaCBmaXJlcyBmb3IgdGhlbWVzIGFuZCBzbmlwcGV0cyBidXQgbm90IGZvciBhIHBsdWdpbidzXG4gICAgLy8gc3R5bGVzLmNzcy4gQSBwbHVnaW4gbG9hZGVkIGxhdGVyIChvciBob3QtcmVsb2FkZWQpIHdvdWxkIGJlIG1pc3NpbmdcbiAgICAvLyB0aGVyZTsgXCJwYXJzZS1zdHlsZS1zZXR0aW5nc1wiIGlzIHRoZSBpbnRlbmRlZCBob29rLiBXaXRob3V0IFN0eWxlXG4gICAgLy8gU2V0dGluZ3Mgbm9ib2R5IGxpc3RlbnMgYW5kIG5vdGhpbmcgaGFwcGVucy5cbiAgICAvL1xuICAgIC8vIE5leHQgdGljaywgYmVjYXVzZSBPYnNpZGlhbiBhZGRzIGEgcGx1Z2luJ3Mgc3R5bGVzLmNzcyBvbmx5IEFGVEVSXG4gICAgLy8gb25sb2FkKCkuIG9uTGF5b3V0UmVhZHkgZG9lc24ndCBoZWxwOiBvbiBob3QgcmVsb2FkIHRoZSBsYXlvdXQgaXMgbG9uZ1xuICAgIC8vIHJlYWR5IGFuZCB0aGUgY2FsbGJhY2sgd291bGQgcnVuIGF0IG9uY2UsIGp1c3QgYXMgZWFybHkuXG4gICAgY29uc3QgcGFyc2VTdHlsZVNldHRpbmdzID0gd2luZG93LnNldFRpbWVvdXQoKCkgPT4gdGhpcy5hcHAud29ya3NwYWNlLnRyaWdnZXIoXCJwYXJzZS1zdHlsZS1zZXR0aW5nc1wiKSwgMCk7XG4gICAgdGhpcy5yZWdpc3RlcigoKSA9PiB3aW5kb3cuY2xlYXJUaW1lb3V0KHBhcnNlU3R5bGVTZXR0aW5ncykpO1xuICB9XG5cbiAgb251bmxvYWQoKSB7fVxuXG4gIC8vIEZvciBfb2JzaWRpYW4vdGVtcGxhdGVyLXNjcmlwdHMvVFlQLmpzOiB0aGUgVFlQLUZyb250bWF0dGVyIG9mIGEgVFlQLCBzb1xuICAvLyBUZW1wbGF0ZXIgY2FuIGFwcGx5IGl0IHRvIGEgbmV3IG5vdGUgaW5zdGVhZCBvZiBrZWVwaW5nIGEgc2Vjb25kIGNvcHkuIEFcbiAgLy8gY29weSwgc28gY2FsbGVycyBtYXkgY2hhbmdlIGl0IGZyZWVseS5cbiAgLy9cbiAgLy8gUHJvcGVydGllcyB3aXRoIGEgZml4ZWQgc2hvcnRjdXQgKHRvZGF5L25vdy9jcmVhdGVkLCBzZWUgc2hvcnRjdXRzLmpzKVxuICAvLyBjYXJyeSBpdHMgdmFsdWUsIGNvbXB1dGVkIGZyZXNoIG9uIGVhY2ggY2FsbC4gUHJvcGVydGllcyB3aXRoIGEgc2NyaXB0XG4gIC8vIHNob3J0Y3V0IGNhcnJ5IG51bGw6IG9ubHkgVGVtcGxhdGVyIGNhbiByZXNvbHZlIHRoZW0sIFRZUC5qcyBnZXRzIHRoZW0gdmlhXG4gIC8vIGdldFR5cFNob3J0Y3V0cygpIGFuZCBmaWxscyB0aGVtIGluLiBLZXkgYW5kIHBvc2l0aW9uIHN0YXkgZWl0aGVyIHdheS5cbiAgLy9cbiAgLy8gaW5jbHVkZUZsb2F0aW5nIChkZWZhdWx0IGZhbHNlKSBrZWVwcyBmbG9hdGluZyBrZXlzIGluIHRoZSByZXN1bHQ7IHRoZXlcbiAgLy8gYXJlIG5vdCBjcmVhdGVkIGZvciBldmVyeSBuZXcgbm90ZSwgb25seSB3aGVuIGEgc2NyaXB0IGFza3MgZm9yIHRoZW0uXG4gIC8vXG4gIC8vIGZpbGUgKG9wdGlvbmFsKSBnb2VzIHRvIHJlc29sdmVTaG9ydGN1dHMoKSBmb3IgXCJjcmVhdGVkXCIsIHdoaWNoIHJldHVybnNcbiAgLy8gdGhlIGZpbGUncyBjcmVhdGlvbiBkYXRlIGluc3RlYWQgb2YgdGhlIGNhbGwgdGltZS5cbiAgLy9cbiAgLy8gc3VidHlwIChvcHRpb25hbCkgYXBwZW5kcyB0aGF0IFN1YnR5cCdzIGJsb2NrLiBBIGtleSBpbiBCT1RIIGJsb2NrcyBrZWVwc1xuICAvLyB0aGUgVFlQLUZyb250bWF0dGVyIHBvc2l0aW9uLCBidXQgdmFsdWUsIGZsb2F0aW5nIGZsYWcgYW5kIHNob3J0Y3V0IGNvbWVcbiAgLy8gZnJvbSB0aGUgU3VidHlwLiBGcm9udG1hdHRlciBzb3J0aW5nIG11c3QgdXNlIHRoZSBzYW1lIHJ1bGUgKHNlZVxuICAvLyBvcmRlcmVkRGVmYXVsdEtleXMgaW4gZnJvbnRtYXR0ZXItc29ydC5qcyksIG9yIGl0IHdvdWxkIHJlLXNvcnQgYSBuZXcgbm90ZVxuICAvLyByaWdodCBhd2F5LlxuICBnZXRUeXBEZWZhdWx0cyh0eXAsIHsgaW5jbHVkZUZsb2F0aW5nID0gZmFsc2UsIGZpbGUsIHN1YnR5cCA9IG51bGwgfSA9IHt9KSB7XG4gICAgY29uc3QgeyBkZWZhdWx0cywgc2hvcnRjdXRzIH0gPSB0aGlzLmNvbGxlY3RCbG9ja3ModHlwLCBzdWJ0eXAsIGluY2x1ZGVGbG9hdGluZyk7XG4gICAgcmV0dXJuIHJlc29sdmVTaG9ydGN1dHMoZGVmYXVsdHMsIHNob3J0Y3V0cywgeyBmaWxlLCBhcHA6IHRoaXMuYXBwIH0pO1xuICB9XG5cbiAgLy8gU2hhcmVkIGJhc2Ugb2YgZ2V0VHlwRGVmYXVsdHMoKSBhbmQgZ2V0VHlwU2hvcnRjdXRzKCk6IHRoZSBUWVAtRnJvbnRtYXR0ZXJcbiAgLy8gcGx1cyB0aGUgU3VidHlwJ3MgYmxvY2suIEEga2V5IGluIEJPVEgga2VlcHMgdGhlIFRZUC1Gcm9udG1hdHRlciBwb3NpdGlvbjtcbiAgLy8gdmFsdWUsIGZsb2F0aW5nIGZsYWcgQU5EIHNob3J0Y3V0IGNvbWUgZnJvbSB0aGUgU3VidHlwIC0gXCJubyBzaG9ydGN1dFwiXG4gIC8vIGNvdW50cyBhcyB0aGUgU3VidHlwJ3MgY2hvaWNlIHRvbyBhbmQgY2FuY2VscyB0aGUgVFlQJ3MuXG4gIGNvbGxlY3RCbG9ja3ModHlwLCBzdWJ0eXAsIGluY2x1ZGVGbG9hdGluZykge1xuICAgIGNvbnN0IGRlZmF1bHRzID0ge307XG4gICAgY29uc3Qgc2hvcnRjdXRzID0ge307XG4gICAgY29uc3QgaXNGbG9hdGluZyA9IG5ldyBNYXAoKTtcbiAgICBjb25zdCBhZGRCbG9jayA9IChmcm9udG1hdHRlciwgZmxvYXRpbmdLZXlzLCBibG9ja1Nob3J0Y3V0cykgPT4ge1xuICAgICAgY29uc3QgYWN0dWFsS2V5cyA9IG5ldyBNYXAoT2JqZWN0LmtleXMoZGVmYXVsdHMpLm1hcCgoa2V5KSA9PiBba2V5LnRvTG93ZXJDYXNlKCksIGtleV0pKTtcbiAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGZyb250bWF0dGVyID8/IHt9KSkge1xuICAgICAgICBpZiAoa2V5ID09PSBcIlwiKSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgdGFyZ2V0ID0gYWN0dWFsS2V5cy5nZXQoa2V5LnRvTG93ZXJDYXNlKCkpID8/IGtleTtcbiAgICAgICAgZGVmYXVsdHNbdGFyZ2V0XSA9IHZhbHVlO1xuICAgICAgICBpc0Zsb2F0aW5nLnNldCh0YXJnZXQsIChmbG9hdGluZ0tleXMgPz8gW10pLmluY2x1ZGVzKGtleSkpO1xuICAgICAgICBjb25zdCByZWNvcmQgPSAoYmxvY2tTaG9ydGN1dHMgPz8ge30pW2tleV07XG4gICAgICAgIGlmIChyZWNvcmQpIHNob3J0Y3V0c1t0YXJnZXRdID0gcmVjb3JkO1xuICAgICAgICBlbHNlIGRlbGV0ZSBzaG9ydGN1dHNbdGFyZ2V0XTtcbiAgICAgIH1cbiAgICB9O1xuICAgIGNvbnN0IHN1YnR5cERhdGEgPSBzdWJ0eXAgPyBnZXRTdWJ0eXAodGhpcy5zZXR0aW5ncywgdHlwLCBzdWJ0eXApIDogbnVsbDtcbiAgICBhZGRCbG9jayhcbiAgICAgIHRoaXMuc2V0dGluZ3MudHlwRGVmYXVsdEZyb250bWF0dGVyW3R5cF0sXG4gICAgICB0aGlzLnNldHRpbmdzLnR5cEZsb2F0aW5nS2V5c1t0eXBdLFxuICAgICAgdGhpcy5zZXR0aW5ncy50eXBTaG9ydGN1dHNbdHlwXVxuICAgICk7XG4gICAgaWYgKHN1YnR5cERhdGEpIGFkZEJsb2NrKHN1YnR5cERhdGEuZnJvbnRtYXR0ZXIsIHN1YnR5cERhdGEuZmxvYXRpbmdLZXlzLCBzdWJ0eXBEYXRhLnNob3J0Y3V0cyk7XG5cbiAgICBpZiAoIWluY2x1ZGVGbG9hdGluZykge1xuICAgICAgZm9yIChjb25zdCBba2V5LCBmbG9hdGluZ10gb2YgaXNGbG9hdGluZykge1xuICAgICAgICBpZiAoIWZsb2F0aW5nKSBjb250aW51ZTtcbiAgICAgICAgZGVsZXRlIGRlZmF1bHRzW2tleV07XG4gICAgICAgIGRlbGV0ZSBzaG9ydGN1dHNba2V5XTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHsgZGVmYXVsdHMsIHNob3J0Y3V0cyB9O1xuICB9XG5cbiAgLy8gRm9yIFRZUC5qczogdGhlIHByb3BlcnRpZXMgb2YgdGhpcyBUWVAgd2hvc2UgdmFsdWUgY29tZXMgZnJvbSBhIFRlbXBsYXRlclxuICAvLyBzY3JpcHQsIGFzIHsgW3Byb3BlcnR5XTogeyBuYW1lLCBwYXJhbXMsIGFyZ3MsIGZhbGxiYWNrIH0gfSBpblxuICAvLyBUWVAtRnJvbnRtYXR0ZXIgb3JkZXIgKHRoZSBzY3JpcHRzIHJ1biBpbiB0dXJuIGFuZCBzZWUgZWFybGllciByZXN1bHRzKS5cbiAgLy9cbiAgLy8gICBuYW1lICAgICAgc2NyaXB0IG5hbWUgd2l0aG91dCBcInRwLlwiLCBpLmUuIHRwLnVzZXIuPG5hbWU+XG4gIC8vICAgcGFyYW1zICAgIHRoZSBwYXJhbWV0ZXIgbGlzdCBkZWNsYXJlZCBpbiB0aGUgQHR5cC1zaG9ydGN1dCBtYXJrZXIsIG9yXG4gIC8vICAgICAgICAgICAgIG51bGwgd2l0aG91dCBwYXJlbnRoZXNlcy4gVGFrZW4gZnJvbSB0aGUgY3VycmVudCBzY2FuLCBzbyBhXG4gIC8vICAgICAgICAgICAgIGNoYW5nZWQgZGVjbGFyYXRpb24gYXBwbGllcyBhdCBvbmNlLiBUWVAuanMgdHVybnMgaXQgaW50byB0aGVcbiAgLy8gICAgICAgICAgICAgY2FsbCdzIGFyZ3VtZW50cyB3aXRoIHJlc29sdmVTaG9ydGN1dEFyZ3MoKVxuICAvLyAgIGFyZ3MgICAgICB0aGUgdHlwZWQgYXJndW1lbnRzLCBuYW1lZCBhZnRlciB0aGUgbm9uLXJlc2VydmVkIHBhcmFtZXRlcnM7XG4gIC8vICAgICAgICAgICAgIGFuIGVtcHR5IGZpZWxkIGlzIG1pc3Npbmcgc28gXCJhcmdzLnggPz8gZmFsbGJhY2tcIiB3b3Jrc1xuICAvLyAgIGZhbGxiYWNrICB0aGUgZml4ZWQgdmFsdWUgc3RvcmVkIGZvciB0aGUgcHJvcGVydHkuIE9ubHkgYSBGQUxMQkFDSzpcbiAgLy8gICAgICAgICAgICAgVFlQLmpzIHdyaXRlcyBpdCBpZiB0aGUgc2NyaXB0IGlzIG1pc3Npbmcgb3IgdGhyb3dzLiBBIHNjcmlwdFxuICAvLyAgICAgICAgICAgICB0aGF0IGRlbGliZXJhdGVseSByZXR1cm5zIG51bGwvXCJcIiAoRVNDIGluIGEgcGlja2VyKSBoYXMgbm90XG4gIC8vICAgICAgICAgICAgIGZhaWxlZCAtIHRoZSBwcm9wZXJ0eSBzdGF5cyBlbXB0eSB0aGVuLlxuICAvL1xuICAvLyBGaXhlZCBzaG9ydGN1dHMgKHRvZGF5L25vdy9jcmVhdGVkKSBkb24ndCBhcHBlYXIgaGVyZTsgZ2V0VHlwRGVmYXVsdHMoKVxuICAvLyBhbHJlYWR5IHJlc29sdmVzIHRoZW0gYW5kIHJldHVybnMgdGhlIHNjcmlwdCBrZXlzIGFzIG51bGwuXG4gIC8vXG4gIC8vIE9wdGlvbnMgYXMgaW4gZ2V0VHlwRGVmYXVsdHMoKTsgaW5jbHVkZUZsb2F0aW5nIGRlZmF1bHRzIHRvIGZhbHNlIHNvIG5vXG4gIC8vIHNjcmlwdCBydW5zIHVuYXNrZWQgZm9yIGEgZmxvYXRpbmcgcHJvcGVydHkuXG4gIGdldFR5cFNob3J0Y3V0cyh0eXAsIHsgaW5jbHVkZUZsb2F0aW5nID0gZmFsc2UsIHN1YnR5cCA9IG51bGwgfSA9IHt9KSB7XG4gICAgY29uc3QgeyBkZWZhdWx0cywgc2hvcnRjdXRzIH0gPSB0aGlzLmNvbGxlY3RCbG9ja3ModHlwLCBzdWJ0eXAsIGluY2x1ZGVGbG9hdGluZyk7XG4gICAgY29uc3Qgc2NyaXB0cyA9IHRoaXMuZ2V0U2hvcnRjdXRTY3JpcHRzPy4oKSA/PyBbXTtcbiAgICBjb25zdCByZXN1bHQgPSB7fTtcbiAgICBmb3IgKGNvbnN0IFtrZXksIHJlY29yZF0gb2YgT2JqZWN0LmVudHJpZXMoc2hvcnRjdXRzKSkge1xuICAgICAgY29uc3QgbmFtZSA9IHNjcmlwdE5hbWVPZihyZWNvcmQubmFtZSk7XG4gICAgICBpZiAobmFtZSA9PT0gbnVsbCkgY29udGludWU7XG4gICAgICBjb25zdCBzY3JpcHQgPSBzY3JpcHRzLmZpbmQoKHMpID0+IHMubmFtZSA9PT0gbmFtZSk7XG4gICAgICByZXN1bHRba2V5XSA9IHtcbiAgICAgICAgbmFtZSxcbiAgICAgICAgcGFyYW1zOiBzY3JpcHQ/LnBhcmFtcyA/PyBudWxsLFxuICAgICAgICBhcmdzOiB7IC4uLihyZWNvcmQuYXJncyA/PyB7fSkgfSxcbiAgICAgICAgZmFsbGJhY2s6IGRlZmF1bHRzW2tleV0gPz8gbnVsbCxcbiAgICAgIH07XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICAvLyBGb3IgVFlQLmpzOiB0dXJucyBhIHNob3J0Y3V0J3MgcGFyYW1ldGVyIGxpc3QgaW50byB0aGUgYXJndW1lbnRzIG9mXG4gIC8vIHRwLnVzZXIuPG5hbWU+KHRwLCAuLi4pIC0gc2VlIHJlc29sdmVDYWxsQXJncyBpbiBzaG9ydGN1dHMuanMuIExpdmVzIGhlcmVcbiAgLy8gc28gdGhlIHJ1bGVzIChyZXNlcnZlZCBuYW1lcywgZG90dGVkIG5hbWVzKSBleGlzdCBpbiBvbmUgcGxhY2U7IG9ubHlcbiAgLy8gVFlQLmpzIGtub3dzIG5ld0ZpbGUgYW5kIGN0eCwgc28gaXQgcGFzc2VzIHRoZW0gaW4uXG4gIHJlc29sdmVTaG9ydGN1dEFyZ3MocGFyYW1zLCBhcmdzLCB7IG5ld0ZpbGUgPSBudWxsLCBjdHggPSBudWxsLCBrZXkgPSBudWxsIH0gPSB7fSkge1xuICAgIHJldHVybiByZXNvbHZlQ2FsbEFyZ3MocGFyYW1zLCBhcmdzLCB7IG5ld0ZpbGUsIGN0eCwga2V5IH0pO1xuICB9XG5cbiAgLy8gRm9yIFRZUC5qczogcmVnaXN0ZXJlZCBTdWJ0eXBzIG9mIGEgVFlQIGluIGJsb2NrIG9yZGVyLCB3aXRoIG5vdGUgY291bnRzLlxuICAvLyBTdWJ0eXBzIHRoYXQgYXJlbid0IG1hbnVhbGx5IGNyZWF0YWJsZSBhcmUgbGVmdCBvdXQgdW5sZXNzXG4gIC8vIGluY2x1ZGVNYW51YWxPZmYgaXMgc2V0LCBsaWtlIHN1Y2ggVFlQIGVudHJpZXMgaW4gZ2V0VHlwcygpLlxuICBnZXRTdWJ0eXBzKHR5cCwgeyBpbmNsdWRlTWFudWFsT2ZmID0gZmFsc2UgfSA9IHt9KSB7XG4gICAgY29uc3QgeyBjb3VudHMgfSA9IHRoaXMudHlwSW5kZXguc3VidHlwQnVja2V0KHR5cCk7XG4gICAgcmV0dXJuIGdldFN1YnR5cE5hbWVzKHRoaXMuc2V0dGluZ3MsIHR5cClcbiAgICAgIC5maWx0ZXIoKHN1YnR5cCkgPT4gaW5jbHVkZU1hbnVhbE9mZiB8fCBpc1N1YnR5cE1hbnVhbCh0aGlzLnNldHRpbmdzLCB0eXAsIHN1YnR5cCkpXG4gICAgICAubWFwKChzdWJ0eXApID0+ICh7IHN1YnR5cCwgY291bnQ6IGNvdW50cy5nZXQoc3VidHlwKSA/PyAwIH0pKTtcbiAgfVxuXG4gIC8vIEZvciBUWVAuanM6IHRoZSBTdWJ0eXAtUGlja2VyIChzZWUgdHlwLXBpY2tlci5qcykuIFJlc29sdmVzIHdpdGggdGhlXG4gIC8vIFN1YnR5cCwgXCJcIiBmb3IgXCJubyBTdWJ0eXBcIiAob3Igd2l0aG91dCBhIHBpY2tlciBpZiB0aGUgVFlQIGhhcyBub25lKSwgb3JcbiAgLy8gbnVsbCBvbiBFU0MgKFRZUC5qcyB0aGVuIGdvZXMgYmFjayB0byB0aGUgVFlQIGNob2ljZSkuIHF1ZXJ5IChvcHRpb25hbCk6XG4gIC8vIGFuIGFscmVhZHkgdHlwZWQgc2VhcmNoIHRoYXQgcHJlLXNvcnRzIHRoZSBsaXN0LiBvcHRpb25zIGFzIGluIGdldFN1YnR5cHMuXG4gIHBpY2tTdWJ0eXAodHlwLCBxdWVyeSA9IFwiXCIsIG9wdGlvbnMgPSB7fSkge1xuICAgIHJldHVybiBwaWNrU3VidHlwTW9kYWwodGhpcy5hcHAsIHRoaXMsIHR5cCwgcXVlcnksIG9wdGlvbnMpO1xuICB9XG5cbiAgLy8gRm9yIFRZUC5qcywgaW5zaWRlIHByb2Nlc3NGcm9udE1hdHRlcjogc2V0cyBUWVAgYW5kIFNVQlRZUCBpbiBjYW5vbmljYWxcbiAgLy8gc3BlbGxpbmcgLSBhIHZhcmlhbnQgbGlrZSBcInR5cFwiIG9yIFwiU3VidHlwXCIgaXMgcmVuYW1lZCBpbiBwbGFjZSByYXRoZXIgdGhhblxuICAvLyBkdXBsaWNhdGVkLiBzdWJ0eXAgbnVsbCByZW1vdmVzIGFuIGV4aXN0aW5nIFNVQlRZUC5cbiAgYXBwbHlUeXBQcm9wZXJ0aWVzKGZyb250bWF0dGVyLCB0eXAsIHN1YnR5cCkge1xuICAgIHNldENhbm9uaWNhbFByb3BlcnR5KGZyb250bWF0dGVyLCBUWVBfUFJPUEVSVFksIHR5cCk7XG4gICAgaWYgKHN1YnR5cCkgc2V0Q2Fub25pY2FsUHJvcGVydHkoZnJvbnRtYXR0ZXIsIFNVQlRZUF9QUk9QRVJUWSwgc3VidHlwKTtcbiAgICBlbHNlIGRlbGV0ZVByb3BlcnR5KGZyb250bWF0dGVyLCBTVUJUWVBfUFJPUEVSVFkpO1xuICB9XG5cbiAgLy8gRm9yIFRZUC5qcywgaW5zaWRlIHByb2Nlc3NGcm9udE1hdHRlciBhbmQgYWZ0ZXIgYWxsIG90aGVyIGNoYW5nZXM6IHB1dHMgdGhlXG4gIC8vIGZyb250bWF0dGVyIGludG8gc29ydGluZyBvcmRlciwgb3IgbmV3bHkgYWRkZWQgcHJvcGVydGllcyAoU1VCVFlQIGluIGFuXG4gIC8vIGV4aXN0aW5nIG5vdGUsIHNheSkgd291bGQgZW5kIHVwIGxhc3QuXG4gIHNvcnRGcm9udG1hdHRlcihmcm9udG1hdHRlciwgdHlwLCBzdWJ0eXAgPSBudWxsKSB7XG4gICAgcmV0dXJuIHNvcnRGcm9udG1hdHRlckZvcih0aGlzLCBmcm9udG1hdHRlciwgdHlwLCBzdWJ0eXApO1xuICB9XG5cbiAgLy8gSW5zaWRlIHByb2Nlc3NGcm9udE1hdHRlcjogbW92ZXMgb25seSBwcm9wZXJ0eSBga2V5YCB0byBpdHMgc29ydGVkIHBsYWNlXG4gIC8vIChUWVAvU1VCVFlQIHJlYWQgZnJvbSB0aGUgb2JqZWN0KSwgZXZlcnl0aGluZyBlbHNlIHN0YXlzIC0gZm9yIEZyZWQnc1xuICAvLyBwcm9wZXJ0eSBiYWNrbGlua2luZywgc28gYSBuZXcgcHJvcGVydHkgZG9lc24ndCBlbmQgdXAgbGFzdC5cbiAgcGxhY2VQcm9wZXJ0eShmcm9udG1hdHRlciwga2V5KSB7XG4gICAgcmV0dXJuIHBsYWNlUHJvcGVydHlGb3IodGhpcywgZnJvbnRtYXR0ZXIsIGtleSk7XG4gIH1cblxuICAvLyBGb3IgVFlQLmpzOiB0aGUgcmVnaXN0ZXJlZCBUWVAgZW50cmllcyB3aXRoIHRoZWlyIGRlc2NyaXB0aW9ucywgaW4gdGhlXG4gIC8vIG9yZGVyIG9mIHRoZSBUWVAtTGlzdCAoaXRzIGN1cnJlbnQgc29ydCBzZXR0aW5nKS4gVFlQIGVudHJpZXMgdGhhdCBhcmVuJ3RcbiAgLy8gbWFudWFsbHkgY3JlYXRhYmxlIGFyZSBsZWZ0IG91dCB1bmxlc3MgaW5jbHVkZU1hbnVhbE9mZiBpcyB0cnVlLlxuICBnZXRUeXBzKHsgaW5jbHVkZU1hbnVhbE9mZiA9IGZhbHNlIH0gPSB7fSkge1xuICAgIGNvbnN0IHsgY291bnRzIH0gPSB0aGlzLnR5cEluZGV4LnR5cENvdW50cygpO1xuICAgIGNvbnN0IHNvcnRPcmRlciA9IHRoaXMuc2V0dGluZ3MudHlwU29ydE9yZGVyID8/IERFRkFVTFRfU09SVF9PUkRFUjtcbiAgICByZXR1cm4gc29ydFR5cHNCeU1vZGUodGhpcy5zZXR0aW5ncy50eXBzLCBzb3J0T3JkZXIsIGNvdW50cywgdGhpcy5zZXR0aW5ncy50eXBDb2xvcnMpXG4gICAgICAuZmlsdGVyKCh0eXApID0+IGluY2x1ZGVNYW51YWxPZmYgfHwgKHRoaXMuc2V0dGluZ3MudHlwTWFudWFsID8/IHt9KVt0eXBdICE9PSBmYWxzZSlcbiAgICAgIC5tYXAoKHR5cCkgPT4gKHtcbiAgICAgICAgdHlwLFxuICAgICAgICBkZXNjcmlwdGlvbjogdGhpcy5zZXR0aW5ncy50eXBEZXNjcmlwdGlvbnNbdHlwXSA/PyBcIlwiLFxuICAgICAgICBjb3VudDogY291bnRzLmdldCh0eXApID8/IDAsXG4gICAgICB9KSk7XG4gIH1cblxuICAvLyBGb3IgVFlQLmpzOiB0aGUgbmF0aXZlIFRZUC1QaWNrZXIgKHNlZSB0eXAtcGlja2VyLmpzKSB3aXRoIGNvbG9yLFxuICAvLyBkZXNjcmlwdGlvbiBhbmQgbm90ZSBjb3VudC4gaW5jbHVkZU1hbnVhbE9mZiBhcyBpbiBnZXRUeXBzKCkuIFJlc29sdmVzXG4gIC8vIHdpdGggdGhlIFRZUCwgb3IgbnVsbCBvbiBFU0MuXG4gIHBpY2tUeXAob3B0aW9ucykge1xuICAgIHJldHVybiBwaWNrVHlwTW9kYWwodGhpcy5hcHAsIHRoaXMsIG9wdGlvbnMpO1xuICB9XG5cbiAgLy8gRm9yIFRZUC5qczogVFlQIGFuZCBTdWJ0eXAgaW4gb25lIGdvIChzZWUgdHlwLXBpY2tlci5qcykgLSBvbmUgcGlja2VyIHdpdGhcbiAgLy8gaW5kZW50ZWQgU3VidHlwcyBvciBib3RoIHBpY2tlcnMgaW4gdHVybiwgcGVyIFwiU2VwYXJhdGUgU3VidHlwLVBpY2tlclwiLlxuICAvLyBSZXNvbHZlcyB3aXRoIHsgdHlwLCBzdWJ0eXAgfSAoc3VidHlwIG51bGwgZm9yIFwibm8gU3VidHlwXCIpLCBvciBudWxsIG9uXG4gIC8vIEVTQy5cbiAgcGlja1R5cEFuZFN1YnR5cChvcHRpb25zKSB7XG4gICAgcmV0dXJuIHBpY2tUeXBBbmRTdWJ0eXBNb2RhbCh0aGlzLmFwcCwgdGhpcywgb3B0aW9ucyk7XG4gIH1cblxuICAvLyBkYXRhOiB3aGF0IGxvYWREYXRhKCkgcmV0dXJuZWQsIGlmIHRoZSBjYWxsZXIgYWxyZWFkeSBoYXMgaXQgKG9ubG9hZCk7XG4gIC8vIHdpdGhvdXQgaXQgKG9uRXh0ZXJuYWxTZXR0aW5nc0NoYW5nZSkgZGF0YS5qc29uIGlzIHJlYWQgaGVyZS5cbiAgYXN5bmMgbG9hZFNldHRpbmdzKGRhdGEpIHtcbiAgICBpZiAoZGF0YSA9PT0gdW5kZWZpbmVkKSBkYXRhID0gYXdhaXQgdGhpcy5sb2FkRGF0YSgpO1xuICAgIC8vIEEgZGVlcCBjb3B5IGFzIHRoZSBiYXNlOiB3aXRob3V0IGRhdGEuanNvbiAoYSBmcmVzaCBpbnN0YWxsKSBvciB3aXRoIGtleXNcbiAgICAvLyBtaXNzaW5nIGZyb20gaXQsIHNldHRpbmdzLnR5cHMsIHR5cENvbG9ycyBhbmQgc28gb24gd291bGQgb3RoZXJ3aXNlIEJFXG4gICAgLy8gdGhlIG9iamVjdHMgaW4gREVGQVVMVF9TRVRUSU5HUywgYW5kIGV2ZXJ5IGNoYW5nZSB3b3VsZCBhbHRlciB0aGVcbiAgICAvLyBkZWZhdWx0cyBhbG9uZyB3aXRoIHRoZW0uXG4gICAgdGhpcy5zZXR0aW5ncyA9IE9iamVjdC5hc3NpZ24oc3RydWN0dXJlZENsb25lKERFRkFVTFRfU0VUVElOR1MpLCBkYXRhKTtcbiAgICAvLyBPYmplY3QuYXNzaWduIHJlcGxhY2VzIG5lc3RlZCBvYmplY3RzIHdob2xlOyB2aWV3cyBhZGRlZCBsYXRlciAoZS5nLlxuICAgIC8vIGNvbG9yVmlld3MubGlua3MpIHdvdWxkIG90aGVyd2lzZSBiZSBzaWxlbnRseSBvZmYgaW4gb2xkZXIgc2V0dGluZ3MuXG4gICAgdGhpcy5zZXR0aW5ncy5jb2xvclZpZXdzID0geyAuLi5ERUZBVUxUX1NFVFRJTkdTLmNvbG9yVmlld3MsIC4uLnRoaXMuc2V0dGluZ3MuY29sb3JWaWV3cyB9O1xuICAgIHRoaXMuc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlciA9IG5vcm1hbGl6ZUdsb2JhbE9yZGVyKHRoaXMuc2V0dGluZ3MuZ2xvYmFsUHJvcGVydHlPcmRlcik7XG4gIH1cblxuICAvLyBzZXR0aW5nc1JldmlzaW9uIGNvdW50cyBldmVyeSBjaGFuZ2Ugb2YgdGhlIHNldHRpbmdzIChoZXJlIGFuZCBpblxuICAvLyBvbkV4dGVybmFsU2V0dGluZ3NDaGFuZ2UpLiBVbmRvICh1bmRvLmpzKSBjb21wYXJlcyBpdCB0byB0ZWxsIHdoZXRoZXJcbiAgLy8gYW55dGhpbmcgaGFwcGVuZWQgYWZ0ZXIgdGhlIGFjdGlvbiBpdCB3b3VsZCByZXZlcnQuIEJ1bXBlZCBzeW5jaHJvbm91c2x5LFxuICAvLyBiZWZvcmUgdGhlIGF3YWl0LCBzbyBhIGNhbGxlciB0aGF0IGRvZXNuJ3QgYXdhaXQgc3RpbGwgY291bnRzIGF0IG9uY2UuXG4gIGFzeW5jIHNhdmVTZXR0aW5ncygpIHtcbiAgICB0aGlzLnNldHRpbmdzUmV2aXNpb24gPSAodGhpcy5zZXR0aW5nc1JldmlzaW9uID8/IDApICsgMTtcbiAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKHRoaXMuc2V0dGluZ3MpO1xuICB9XG5cbiAgLy8gQ2FsbGVkIHdoZW4gZGF0YS5qc29uIGNoYW5nZXMgZnJvbSBvdXRzaWRlLCBpbiBwcmFjdGljZSB0aHJvdWdoIE9ic2lkaWFuXG4gIC8vIFN5bmMuIFdpdGhvdXQgaXQgdGhpcyBkZXZpY2Ugd291bGQga2VlcCBpdHMgb2xkIHNldHRpbmdzIGluIG1lbW9yeSBhbmRcbiAgLy8gb3ZlcndyaXRlIHRoZSBuZXcgb25lcyBvbiB0aGUgbmV4dCBzYXZlLiBPYnNpZGlhbiByZWJ1aWxkcyBhbiBvcGVuXG4gIC8vIHNldHRpbmdzIHRhYiBpdHNlbGY7IGNvbG9ycyBhbmQgdGhlIFRZUC1QYW5lIGFyZSByZWZyZXNoZWQgaGVyZS5cbiAgYXN5bmMgb25FeHRlcm5hbFNldHRpbmdzQ2hhbmdlKCkge1xuICAgIC8vIEludmFsaWRhdGVzIGEgcGVuZGluZyB1bmRvOiBpdHMgc25hcHNob3QgcHJlZGF0ZXMgdGhlIHN5bmNlZCBzZXR0aW5ncy5cbiAgICB0aGlzLnNldHRpbmdzUmV2aXNpb24gPSAodGhpcy5zZXR0aW5nc1JldmlzaW9uID8/IDApICsgMTtcbiAgICBhd2FpdCB0aGlzLmxvYWRTZXR0aW5ncygpO1xuICAgIHRoaXMucmVmcmVzaFR5cENvbG9ycygpO1xuICB9XG59O1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7O0FBQUE7QUFBQSxxQkFBQUEsVUFBQUMs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QUFNLGVBQWU7QUFDbkIsU0FBSyxvQkFBb0IsS0FBSyxvQkFBb0IsS0FBSztBQUN2RCxVQUFNLEtBQUssU0FBUyxLQUFLLFFBQVE7QUFBQSxFQUNuQztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFNQSxNQUFNLDJCQUEyQjtBQUUvQixTQUFLLG9CQUFvQixLQUFLLG9CQUFvQixLQUFLO0FBQ3ZELFVBQU0sS0FBSyxhQUFhO0FBQ3hCLFNBQUssaUJBQWlCO0FBQUEsRUFDeEI7QUFDRjsiLAogICJuYW1lcyI6IFsiZXhwb3J0cyIsICJtb2R1bGUiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJzZXRDYW5vbmljYWxQcm9wZXJ0eSIsICJkZWxldGVQcm9wZXJ0eSIsICJUeXBJbmRleCIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJzZXRDYW5vbmljYWxQcm9wZXJ0eSIsICJTVUJUWVBfUFJPUEVSVFkiLCAiZ2V0U3VidHlwTmFtZXMiLCAiZ2V0U3VidHlwIiwgImlzU3VidHlwTWFudWFsIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInNvcnRUeXBzQnlNb2RlIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImdldFN1YnR5cCIsICJjbGVhcklubGluZUNvbG9ycyIsICJhbGxEb2N1bWVudHMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZ2V0U3VidHlwIiwgIlRZUF9QUk9QRVJUWSIsICJTVUJUWVBfUFJPUEVSVFkiLCAibm9ybWFsaXplR2xvYmFsT3JkZXIiLCAic29ydEZyb250bWF0dGVyRm9yIiwgInBsYWNlUHJvcGVydHlGb3IiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJERUZBVUxUX1NFVFRJTkdTIiwgIlR5cFN5c3RlbVNldHRpbmdUYWIiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZ2V0U3VidHlwTmFtZXMiLCAibm9ybWFsaXplR2xvYmFsT3JkZXIiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJsZWFmIiwgImN1cnJlbnQiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJDb21tYW5kcyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJzY3JpcHROYW1lT2YiLCAicmVzb2x2ZUNhbGxBcmdzIiwgInJlc29sdmVTaG9ydGN1dHMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAic2NyaXB0TmFtZU9mIiwgImdldFN1YnR5cCIsICJUWVBfUFJPUEVSVFkiLCAiU1VCVFlQX1BST1BFUlRZIiwgInJlbW92ZVByb3BlcnR5TWVudVBhdGNoIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImdldFN1YnR5cE5hbWVzIiwgImdldFN1YnR5cCIsICJpc1N1YnR5cE1hbnVhbCIsICJzb3J0VHlwc0J5TW9kZSIsICJzZXRDYW5vbmljYWxQcm9wZXJ0eSIsICJUWVBfUFJPUEVSVFkiLCAiU1VCVFlQX1BST1BFUlRZIiwgIkRFRkFVTFRfU09SVF9PUkRFUiIsICJyZWdpc3RlclR5cFBhbmUiLCAibGVhZiIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlckZpbGVFeHBsb3JlckNvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlckdyYXBoQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyU2VhcmNoQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgInJlZ2lzdGVyUmVjZW50RmlsZXNDb2xvcnMiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJCYWNrbGlua0NvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJyZWdpc3RlckJvb2ttYXJrc0NvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJnZXRTdWJ0eXAiLCAicmVnaXN0ZXJBY3RpdmVUaXRsZUNvbG9ycyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJhbGxEb2N1bWVudHMiLCAicmVnaXN0ZXJMaW5rQ29sb3JzIiwgImV4cG9ydHMiLCAibW9kdWxlIiwgImdldFN1YnR5cE5hbWVzIiwgImdldFN1YnR5cCIsICJhbGxEb2N1bWVudHMiLCAiZmxvYXRpbmciLCAicmVnaXN0ZXJGcm9udG1hdHRlckRlZmF1bHRIaWdobGlnaHQiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAiZ2V0U3VidHlwTmFtZXMiLCAiVFlQX1BST1BFUlRZIiwgIlNVQlRZUF9QUk9QRVJUWSIsICJyZWdpc3RlclByb3BlcnR5UmVuYW1lU3luYyIsICJleHBvcnRzIiwgIm1vZHVsZSIsICJERUZBVUxUX1NPUlRfT1JERVIiLCAiZXhwb3J0cyIsICJtb2R1bGUiLCAicmVnaXN0ZXJTaG9ydGN1dFNjcmlwdHMiXQp9Cg==
